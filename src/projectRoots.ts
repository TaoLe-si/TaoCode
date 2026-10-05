// 项目根 / 源根 / 排除目录的**纯规则**（IDEA `openapi/roots` 一族的可移植子集）。
//
// 上游依据（逐条核过）：
//   · 源根类型与图标：`JavaModuleSourceRootEditHandler` / `JavaTestSourceRootEditHandler`
//     （`ModuleSourceRootEditHandler.getRootIcon`）—— 源根蓝 `#40B6E0`、测试根绿 `#62B543`、
//     生成根由 `JavaSourceRootProperties.isForGeneratedSources()` 再叠一层灰 `#9AA7B0`；
//   · 排除目录：`ProjectRootsUtil.isExcludedFromProject`（按**路径段**匹配被排除的目录名，
//     不是拿整条路径做前缀比较）；
//   · 不存在的根要显式标出：`ContentEntryEditor` 的树编辑器把磁盘上找不到的根渲染成告警态，
//     而不是静默留在列表里。
//
// 本仓的存储形态是 `JavaProjectSettings.sourcePaths: string[]`（扁平、**没有类型字段**）与
// `ProjectSettings.excludedDirs: string[]`（只存目录名）。所以这里判出的根类型是**按目录约定**
// 得到的显示口径 —— 不是"已存的根类型"（那个字段本仓没有，别把返回值当存储用）。
// 真要有类型存储，得先给项目设置加字段并同步原生 schema（见判决书里 lp/roots 的缺口）。

export type SourceRootKind = 'sources' | 'tests' | 'resources' | 'test-resources' | 'generated'

/** 行标签（`ModuleSourceRootEditHandler.getRootTypeName` 的中文口径，本仓只做显示）。 */
export const SOURCE_ROOT_LABELS: Record<SourceRootKind, string> = {
  'sources': '源代码',
  'tests': '测试',
  'resources': '资源',
  'test-resources': '测试资源',
  'generated': '生成',
}

/** 规范化：反斜杠换正斜杠、去掉首尾空白与尾部斜杠（存储口径是工作区相对路径）。 */
export function normalizeRootPath(path: string): string {
  return path.trim().replace(/\\/g, '/').replace(/\/+$/, '')
}

/** 路径是不是能当工作区相对根用（拒绝绝对路径、`..`、空）。 */
export function isUsableRootPath(path: string): boolean {
  const normalized = normalizeRootPath(path)
  if (!normalized || normalized.startsWith('/')) return false
  return normalized.split('/').every(segment => segment !== '' && segment !== '.' && segment !== '..')
}

const segmentsOf = (path: string) => normalizeRootPath(path).split('/').filter(Boolean).map(segment => segment.toLowerCase())

/**
 * 按目录约定判根类型（Maven/Gradle 布局）：
 *   `target/generated-sources/...` / `build/generated/...` / 名字里带 `generated` ⇒ 生成根；
 *   `src/test/resources` ⇒ 测试资源；`src/main/resources` ⇒ 资源；
 *   `src/test/**` ⇒ 测试；其余 ⇒ 源代码。
 * 生成根优先于其它（上游 `isForGeneratedSources` 是正交属性，放在判定链最前才不会漏）。
 */
export function classifySourceRoot(path: string): SourceRootKind {
  const segments = segmentsOf(path)
  if (segments.some(segment => segment === 'generated' || segment === 'generated-sources' || segment === 'generated-test-sources' || segment.startsWith('generated-')))
    return 'generated'
  const isTest = segments.some(segment => segment === 'test' || segment === 'tests')
  const isResources = segments.some(segment => segment === 'resources')
  if (isTest && isResources) return 'test-resources'
  if (isResources) return 'resources'
  if (isTest) return 'tests'
  return 'sources'
}

/**
 * `ProjectRootsUtil.isExcludedFromProject`：路径的**任一目录段**命中被排除的目录名就算排除。
 * 返回命中的那个名字（没有命中返回 null），调用方据此说清"被哪个名字排除的"。
 * 大小写敏感与桥接/原生一致（`excludedDirs.includes(part)`）。
 */
export function excludedByNames(path: string, excludedDirs: readonly string[]): string | null {
  if (!excludedDirs.length) return null
  for (const segment of normalizeRootPath(path).split('/')) if (excludedDirs.includes(segment)) return segment
  return null
}

export interface SourceRootStatus {
  path: string
  kind: SourceRootKind
  /** 根下面（含根本身作为文件）的文件数；0 表示磁盘上找不到这个根。 */
  fileCount: number
  /** 磁盘上不存在——上游把这种根渲染成告警态，不静默保留。 */
  missing: boolean
  /** 所在的目录名被 `excludedDirs` 排除了（根在被排除的子树里，等于白配）。 */
  excludedBy: string | null
}

/** 逐根核对：文件数、是否存在、是否踩在排除目录里。输入是 `workspace.files` 的全量清单。 */
export function validateSourceRoots(roots: readonly string[], files: readonly string[], excludedDirs: readonly string[] = []): SourceRootStatus[] {
  const seen = new Set<string>()
  const out: SourceRootStatus[] = []
  for (const raw of roots) {
    const path = normalizeRootPath(raw)
    if (!path || seen.has(path) || !isUsableRootPath(path)) continue
    seen.add(path)
    const prefix = `${path}/`
    const fileCount = files.reduce((count, file) => count + (file === path || file.startsWith(prefix) ? 1 : 0), 0)
    out.push({ path, kind: classifySourceRoot(path), fileCount, missing: fileCount === 0, excludedBy: excludedByNames(path, excludedDirs) })
  }
  return out
}

export interface DetectedSourceRoot {
  path: string
  kind: SourceRootKind
}

/**
 * 按 Maven/Gradle 目录约定从文件清单里发现**还没配置**的源根。
 *
 * 规则与 `ContentEntryEditor` 的"导入布局后源根就在那里"同一件事，只是这里由用户点一下添加：
 * 末段是 `java`/`kotlin`/`groovy`/`scala`/`resources` 且其父段是 `main`/`test`，或位于
 * `generated-sources`/`generated-test-sources` 之下。已被现有根覆盖（是某个根的子孙）的目录不再建议。
 */
export function detectSourceRoots(files: readonly string[], configured: readonly string[] = []): DetectedSourceRoot[] {
  const roots = configured.map(normalizeRootPath).filter(Boolean)
  const covered = (dir: string) => roots.some(root => dir === root || dir.startsWith(`${root}/`))
  const found = new Map<string, SourceRootKind>()
  for (const file of files) {
    let slash = file.lastIndexOf('/')
    while (slash > 0) {
      const dir = file.slice(0, slash)
      const kind = conventionalRootKind(dir)
      if (kind && !covered(dir)) found.set(dir, kind)
      slash = dir.lastIndexOf('/')
    }
  }
  return [...found.entries()].map(([path, kind]) => ({ path, kind })).sort((a, b) => a.path < b.path ? -1 : a.path > b.path ? 1 : 0)
}

const SOURCE_LEAF = new Set(['java', 'kotlin', 'groovy', 'scala', 'resources'])

function conventionalRootKind(dir: string): SourceRootKind | null {
  const segments = segmentsOf(dir)
  const last = segments[segments.length - 1]
  const parent = segments[segments.length - 2]
  if (!last) return null
  if (last === 'generated-sources' || last === 'generated-test-sources') return 'generated'
  if (SOURCE_LEAF.has(last) && (parent === 'main' || parent === 'test')) return classifySourceRoot(dir)
  // 末段是代码目录但父段不在 main/test 下（例如 `src/java`）时不猜——那可能是任意包目录。
  return null
}
