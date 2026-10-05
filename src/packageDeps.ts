// 包依赖分析（上游 `platform/lang-impl/src/com/intellij/packageDependencies/` 与
// `platform/analysis-impl/src/com/intellij/packageDependencies/`：`PackageDependenciesProjectService`
// 在 PSI 引用图上建包图，`PackageDependenciesView` 展示、`actions/` 里是「分析依赖/发现循环」）。
//
// 本仓没有 PSI 引用图（lp/psi 族判 `[-]`），所以用**文本层**做真子集：扫描工作区源码里的
// import/require/#include/using 行（扫描走宿主 `search.run` 的正则通道），把能解析到本仓文件的
// 导入建到**目录级**依赖图上，再用 Tarjan 找强连通分量报告循环。
//
// 何时算「解析得到」：
//   · 相对路径（`./x`、`../x`）在导入文件所在目录上做路径归一 + 扩展名/index 兜底；
//   · 点分路径（Java/Kotlin 的 `a.b.C`）在文件清单里按后缀匹配；
//   · 带 `/` 的裸路径（路径别名、Go module 内路径）同样按后缀匹配。
// 解析不到的一律算外部依赖，不进图（不猜）。
//
// **明确不做**（上游有、本子集没有）：PSI 级的正向/反向引用（同包内的符号引用不计）、
// 通配/静态导入展开、按模块/面的分组、`packageDependencies` 的树视图交互与导出。
import type { SearchMatch } from './bridge'

/** 一次搜索能覆盖的导入语法（喂 `search.run` 的 `query`，`regex: true`）。 */
export const IMPORT_SCAN_QUERY =
  '(?:^\\s*import\\s+(?:type\\s+)?[^;\'"]*?from\\s*[\'"]|^\\s*import\\s*[\'"]|require\\s*\\(\\s*[\'"]|^\\s*import\\s*\\(\\s*[\'"]|^\\s*import\\s+(?:static\\s+)?[\\w.]+|^\\s*from\\s+[\\w.]+\\s+import|^\\s*#\\s*include\\s*[<"][^>"]+[>"]|^\\s*using\\s+[\\w.]+\\s*;|^\\s*import\\s+"[^"]+")'

export interface ImportRef {
  /** 导入方文件（工作区相对路径）。 */
  path: string
  /** 0 基行号（SearchMatch 的基准）。 */
  line: number
  /** 被导入的模块说明符（原文，未解析）。 */
  specifier: string
}

export interface PackageEdge {
  from: string
  to: string
  /** 产生这条边的导入行。 */
  path: string
  line: number
  specifier: string
}

export interface PackageGraph {
  /** 参与依赖的目录（含根目录，标签为空串）。 */
  packages: string[]
  edges: PackageEdge[]
  /** 解析不到、未进图的外部/不可达导入数。 */
  external: number
}

const EXTENSIONS = ['ts', 'tsx', 'js', 'jsx', 'mjs', 'cjs', 'vue', 'py', 'java', 'kt', 'kts', 'go', 'c', 'h', 'cpp', 'hpp', 'cc', 'cs', 'rs']

/** 从一行源码里抽出入模块说明符（一行最多一个；没有就返回空数组）。 */
export function extractImportSpecifiers(line: string): string[] {
  const text = line.trim()
  const patterns = [
    /^import\s+(?:type\s+)?[^'"]*?\bfrom\s*['"]([^'"]+)['"]/,   // ES import … from 'x'
    /^import\s*['"]([^'"]+)['"]/,                               // 副作用 import 'x'
    /^import\s*\(\s*['"]([^'"]+)['"]\s*\)/,                     // 动态 import('x')
    /\brequire\s*\(\s*['"]([^'"]+)['"]\s*\)/,                   // require('x')
    /^import\s+(?:static\s+)?([\w.]+)\s*(?:as\s+\w+)?;?$/,      // Java/Kotlin
    /^from\s+([\w.]+)\s+import\b/,                              // Python from x import y
    /^import\s+([\w.]+)\s*(?:as\s+\w+)?$/,                      // Python import x
    /^#\s*include\s*[<"]([^>"]+)[>"]/,                          // C/C++ #include "x"
    /^using\s+([\w.]+)\s*;/,                                    // C# using
    /^import\s+"([^"]+)"/,                                      // Go import "x"
  ]
  for (const pattern of patterns) {
    const match = pattern.exec(text)
    if (match) return [match[1]!]
  }
  return []
}

/** 把搜索命中整理成 ImportRef（命中行里没有可识别的导入就丢掉）。 */
export function collectImports(matches: SearchMatch[]): ImportRef[] {
  const refs: ImportRef[] = []
  for (const match of matches) {
    for (const specifier of extractImportSpecifiers(match.preview ?? '')) {
      refs.push({ path: match.path.replace(/\\/g, '/'), line: match.line, specifier })
    }
  }
  return refs
}

const normalizePath = (path: string): string => {
  const out: string[] = []
  for (const part of path.replace(/\\/g, '/').split('/')) {
    if (part === '' || part === '.') continue
    if (part === '..') out.pop()
    else out.push(part)
  }
  return out.join('/')
}

const dirname = (path: string) => {
  const index = path.lastIndexOf('/')
  return index < 0 ? '' : path.slice(0, index)
}

/** 目录级包名：文件所在目录（根目录是空串）。 */
export const packageOf = (path: string): string => dirname(path.replace(/\\/g, '/'))

const withCandidates = (base: string): string[] => [
  base,
  ...EXTENSIONS.map(extension => `${base}.${extension}`),
  ...EXTENSIONS.map(extension => `${base}/index.${extension}`),
]

/**
 * 把说明符解析到工作区里的一个文件（相对路径先按目录归一，再按文件清单兜底）。
 * 解析不到返回 null（调用方记为外部依赖）。
 */
export function resolveImport(fromPath: string, specifier: string, universe: string[]): string | null {
  if (!specifier) return null
  const files = universe.map(path => path.replace(/\\/g, '/'))
  if (specifier.startsWith('.')) {
    const base = normalizePath(`${dirname(fromPath)}/${specifier}`)
    const candidates = new Set(withCandidates(base))
    const hit = files.find(file => candidates.has(file))
    return hit ?? null
  }
  // 点分路径按后缀匹配（`a.b.C` ⇒ `a/b/C`）；带 `/` 的裸路径同理。
  const dotted = specifier.includes('.') && !specifier.includes('/')
  const tail = dotted ? specifier.replace(/\./g, '/') : normalizePath(specifier)
  if (!tail) return null
  const hit = files.find(file => {
    const noExtension = file.replace(/\.[A-Za-z0-9]+$/, '')
    return noExtension === tail || noExtension.endsWith(`/${tail}`)
  })
  return hit ?? null
}

/** 建目录级依赖图：同目录内不算边（上游包图同样只在包之间画依赖）。 */
export function buildPackageGraph(imports: ImportRef[], universe: string[]): PackageGraph {
  const packages = new Set<string>()
  const edges: PackageEdge[] = []
  let external = 0
  for (const ref of imports) {
    const from = packageOf(ref.path)
    const target = resolveImport(ref.path, ref.specifier, universe)
    if (!target) { ++external; continue }
    const to = packageOf(target)
    packages.add(from)
    packages.add(to)
    if (from === to) continue
    edges.push({ from, to, path: ref.path, line: ref.line, specifier: ref.specifier })
  }
  return { packages: [...packages].sort(), edges, external }
}

/** 找出目录级依赖图里的循环（Tarjan 强连通分量；含自环）。返回分量列表（每项按包名排序）。 */
export function findDependencyCycles(graph: PackageGraph): string[][] {
  const adjacency = new Map<string, string[]>()
  for (const name of graph.packages) adjacency.set(name, [])
  const selfLoops = new Set<string>()
  for (const edge of graph.edges) {
    if (edge.from === edge.to) { selfLoops.add(edge.from); continue }
    adjacency.get(edge.from)?.push(edge.to)
  }
  const index = new Map<string, number>()
  const low = new Map<string, number>()
  const stack: string[] = []
  const onStack = new Set<string>()
  const cycles: string[][] = []
  let counter = 0

  const strongConnect = (node: string) => {
    index.set(node, counter)
    low.set(node, counter)
    ++counter
    stack.push(node)
    onStack.add(node)
    for (const next of adjacency.get(node) ?? []) {
      if (!index.has(next)) { strongConnect(next); low.set(node, Math.min(low.get(node)!, low.get(next)!)) }
      else if (onStack.has(next)) low.set(node, Math.min(low.get(node)!, index.get(next)!))
    }
    if (low.get(node) !== index.get(node)) return
    const component: string[] = []
    for (;;) {
      const member = stack.pop()!
      onStack.delete(member)
      component.push(member)
      if (member === node) break
    }
    if (component.length > 1) cycles.push(component.sort())
  }

  for (const name of graph.packages) if (!index.has(name)) strongConnect(name)
  // 自环也算循环（上游 report 也把 package → 自身的依赖算进去）。
  for (const name of selfLoops) cycles.push([name])
  return cycles.sort((left, right) => left[0]!.localeCompare(right[0]!))
}

/** 在某条边的导入行上把文件与行号还给调用方（对话框点击跳转用）。 */
export function edgeLocation(edge: PackageEdge): { path: string; line: number } {
  return { path: edge.path, line: edge.line }
}
