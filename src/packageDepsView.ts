// 包依赖分析的**视图层纯规则**。上游对应的三块：
//   · 分析范围：`packageDependencies/DefaultScopesProvider`（ProjectFilesScope / All /
//     NonProjectFiles / Scratches）、`TestScopeProvider`（TestsScope）、
//     `GeneratedFilesScopeProvider`（GeneratedFilesScope）—— 选哪个 scope 就只把范围内的文件喂进包图；
//   · 视图设置：`DependencyUISettings`（UI_FILTER_OUT_OF_CYCLE_PACKAGES / UI_SHOW_FILES /
//     UI_GROUP_BY_SCOPE_TYPE 一族）—— 决定看全部包还是只看循环、是否显示文件、是否按范围分组；
//   · 依赖闭包：`FindDependencyUtil`（正向/反向查一个包依赖了谁 / 被谁依赖）。
//
// 本仓没有 PSI scope 对象，等价物按**路径模式**把工作区文件清单分类（纯文本，不猜语义）。
// 结果只影响「哪些文件进图、图上怎么显示」，不改变 import 解析本身（那在 src/packageDeps.ts）。
import type { PackageEdge, PackageGraph } from './packageDeps'

/** 分析范围（上游 NamedScope 的可选集，去掉本仓没有的 NonProjectFiles/Scratches）。 */
export type PackageScopeId = 'project' | 'tests' | 'generated' | 'all'

export interface PackageScopeOption {
  id: PackageScopeId
  title: string
  description: string
}

export const PACKAGE_SCOPES: PackageScopeOption[] = [
  { id: 'project', title: '项目文件', description: '工作区里除测试与生成物之外的源码（上游 ProjectFilesScope）' },
  { id: 'tests', title: '测试', description: '测试目录与测试文件（上游 TestsScope）' },
  { id: 'generated', title: '生成文件', description: '构建产物与生成目录（上游 GeneratedFilesScope）' },
  { id: 'all', title: '全部', description: '工作区清单里的全部文件（上游 All 范围）' },
]

const TEST_DIRS = ['/test/', '/tests/', '/__tests__/', '/spec/', '/specs/', '/testing/', '/testdata/']
const TEST_SUFFIXES = ['.test.ts', '.test.tsx', '.test.js', '.test.jsx', '.test.mjs', '.test.cjs', '.test.vue', '.spec.ts', '.spec.tsx', '.spec.js', '.spec.jsx', '_test.go', '_test.py', 'test.java', 'tests.java', 'test.kt', 'tests.kt', 'test.cpp', 'test.cc', 'test.c', 'test.cs']
const TEST_PREFIXES = ['test_', 'test-']
/**
 * 构建产物目录：只在**路径首段**命中时算生成物（`build/...`、`dist/...`），
 * 免得把 `src/build/Builder.java` 这种同名源码目录误判掉（上游按 PSI 的
 * GeneratedFilesScope 判断，本仓只有路径可看，取保守口径）。
 */
const GENERATED_ROOT_DIRS = ['build', 'dist', 'target', 'out', 'bin', 'obj', 'gen', 'generated', 'vendor', '.next', 'coverage']
/** 这些目录名无论出现在哪一段都算生成物（不会与源码目录撞名的缓存/依赖目录）。 */
const GENERATED_ANY_DIRS = ['/node_modules/', '/__pycache__/', '/.gradle/', '/.venv/', '/venv/', '/.idea/']
const GENERATED_SUFFIXES = ['.min.js', '.min.css', '.g.dart', '.pb.go', '_pb2.py', '.designer.cs', '.generated.cs']

/** 路径归一（与 packageDeps 同口径：反斜杠转正、补前导斜杠便于按目录匹配）。 */
function normalized(path: string): string {
  const text = path.replace(/\\/g, '/')
  return text.startsWith('/') ? text : `/${text}`
}

/** 测试文件（上游 TestsScope）：测试目录、`*.test.*`/`*_test.go`/`Test.java` 这类命名。 */
export function isTestPath(path: string): boolean {
  const text = normalized(path).toLowerCase()
  const base = text.slice(text.lastIndexOf('/') + 1)
  if (TEST_DIRS.some(dir => text.includes(dir))) return true
  if (TEST_SUFFIXES.some(suffix => base.endsWith(suffix))) return true
  return TEST_PREFIXES.some(prefix => base.startsWith(prefix))
}

/** 生成文件（上游 GeneratedFilesScope）：构建产物、依赖缓存、代码生成后缀。 */
export function isGeneratedPath(path: string): boolean {
  const text = normalized(path).toLowerCase().replace(/^\/+/, '')
  const base = text.slice(text.lastIndexOf('/') + 1)
  const root = text.slice(0, text.indexOf('/') < 0 ? text.length : text.indexOf('/'))
  if (GENERATED_ROOT_DIRS.includes(root)) return true
  if (GENERATED_ANY_DIRS.some(dir => `/${text}/`.includes(dir))) return true
  return GENERATED_SUFFIXES.some(suffix => base.endsWith(suffix))
}

/** 文件属于哪个范围类别（测试优先于生成物：`build/test-gen/...` 先算测试）。 */
export function classifyFile(path: string): 'test' | 'generated' | 'source' {
  if (isTestPath(path)) return 'test'
  if (isGeneratedPath(path)) return 'generated'
  return 'source'
}

/** 文件是否在所选 scope 内（`all` 恒真）。 */
export function fileInScope(path: string, scope: PackageScopeId): boolean {
  if (scope === 'all') return true
  if (scope === 'tests') return isTestPath(path)
  if (scope === 'generated') return isGeneratedPath(path)
  const kind = classifyFile(path)
  return kind !== 'test' && kind !== 'generated'
}

/** 按 scope 过滤工作区文件清单（喂给 `buildPackageGraph` 的 universe）。 */
export function scopeUniverse(files: readonly string[], scope: PackageScopeId): string[] {
  return files.filter(path => fileInScope(path, scope))
}

/** 标签：与对话框一致（根目录显示为 `(根目录)`）。 */
export function scopeLabel(id: PackageScopeId): string {
  return PACKAGE_SCOPES.find(option => option.id === id)?.title ?? id
}

/** 视图设置（上游 `DependencyUISettings` 的可映射子集）。 */
export interface PackageDepsSettings {
  /** 只看参与循环的包与它们之间的边（上游 UI_FILTER_OUT_OF_CYCLE_PACKAGES，`:22` 默认 true，
   *  但那是对**常驻工具窗口**的默认档；本仓对话框默认展示全图，见 `DEFAULT_PACKAGE_DEPS_SETTINGS`）。 */
  filterOutOfCyclePackages: boolean
  /** 边上显示产生依赖的文件与行（上游 UI_SHOW_FILES，`:18` 默认 true）。 */
  showFiles: boolean
  /** 边按来源文件的 scope 类别分组（上游 UI_GROUP_BY_SCOPE_TYPE，`:23` 默认 true）。 */
  groupByScopeType: boolean
  /**
   * 只看违反依赖规则的那些边（上游 UI_FILTER_LEGALS，`DependencyUISettings.java:21` 默认 **false**；
   * 工具栏动作 `action.show.illegals.only` = CodeInsightBundle:409「Show Illegals Only」，
   * 说明 `action.show.illegals.only.description` = :410）。
   * 规则为空时这条**不生效**（`src/dependencyRules.ts` 的 `filterLegalEdges`），与上游一致。
   */
  filterLegals: boolean
}

export const DEFAULT_PACKAGE_DEPS_SETTINGS: PackageDepsSettings = {
  filterOutOfCyclePackages: false,
  showFiles: true,
  groupByScopeType: false,
  filterLegals: false,
}

const SETTINGS_KEY = 'taocode.packageDeps.settings'

/** 读视图设置（localStorage 不可用/坏数据时退回默认）。 */
export function loadPackageDepsSettings(): PackageDepsSettings {
  try {
    const raw = typeof localStorage === 'undefined' ? null : localStorage.getItem(SETTINGS_KEY)
    const parsed = raw ? JSON.parse(raw) : null
    if (!parsed || typeof parsed !== 'object') return { ...DEFAULT_PACKAGE_DEPS_SETTINGS }
    return {
      filterOutOfCyclePackages: parsed.filterOutOfCyclePackages === true,
      showFiles: parsed.showFiles !== false,
      groupByScopeType: parsed.groupByScopeType === true,
      filterLegals: parsed.filterLegals === true,
    }
  } catch {
    return { ...DEFAULT_PACKAGE_DEPS_SETTINGS }
  }
}

export function savePackageDepsSettings(settings: PackageDepsSettings): void {
  try {
    if (typeof localStorage !== 'undefined') localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings))
  } catch {
    // 存储不可用只影响下次会话的视图选项，不影响本次分析。
  }
}

/** 参与循环的包集合（含自环）。 */
export function cyclePackages(cycles: readonly (readonly string[])[]): Set<string> {
  const members = new Set<string>()
  for (const cycle of cycles) for (const name of cycle) members.add(name)
  return members
}

/**
 * 把视图设置作用到图上：只看循环时保留循环成员之间的边；
 * 其余选项只影响渲染（对话框用），不改图。
 */
export function applyPackageDepsSettings(graph: PackageGraph, cycles: readonly (readonly string[])[], settings: PackageDepsSettings): PackageGraph {
  if (!settings.filterOutOfCyclePackages) return graph
  const members = cyclePackages(cycles)
  const edges = graph.edges.filter(edge => members.has(edge.from) && members.has(edge.to))
  const packages = [...new Set(edges.flatMap(edge => [edge.from, edge.to]))].sort()
  return { packages, edges, external: graph.external }
}

/** 按来源文件的范围类别分组（顺序固定：项目 → 测试 → 生成），组内保持原顺序。 */
export function groupEdgesByScope(edges: readonly PackageEdge[]): Array<{ scope: 'source' | 'test' | 'generated'; edges: PackageEdge[] }> {
  const buckets: Record<'source' | 'test' | 'generated', PackageEdge[]> = { source: [], test: [], generated: [] }
  for (const edge of edges) buckets[classifyFile(edge.path)].push(edge)
  return (['source', 'test', 'generated'] as const)
    .filter(scope => buckets[scope].length > 0)
    .map(scope => ({ scope, edges: buckets[scope] }))
}

export const SCOPE_KIND_TITLES: Record<'source' | 'test' | 'generated', string> = {
  source: '项目文件',
  test: '测试',
  generated: '生成文件',
}

/**
 * 正向/反向依赖闭包（上游 `FindDependencyUtil` 的「分析依赖/分析反向依赖」）：
 * forward = start 依赖到的所有包；backward = 依赖到 start 的所有包。结果不含 start 自身。
 */
export function dependencyClosure(graph: PackageGraph, start: string, direction: 'forward' | 'backward'): { packages: string[]; edges: PackageEdge[] } {
  const adjacency = new Map<string, PackageEdge[]>()
  for (const edge of graph.edges) {
    const key = direction === 'forward' ? edge.from : edge.to
    adjacency.set(key, [...(adjacency.get(key) ?? []), edge])
  }
  const seen = new Set<string>([start])
  const edges: PackageEdge[] = []
  const queue = [start]
  while (queue.length) {
    const current = queue.shift()!
    for (const edge of adjacency.get(current) ?? []) {
      edges.push(edge)
      const next = direction === 'forward' ? edge.to : edge.from
      if (seen.has(next)) continue
      seen.add(next)
      queue.push(next)
    }
  }
  seen.delete(start)
  return { packages: [...seen].sort(), edges }
}

/** 一个包在图里的直接依赖/被依赖（对话框点包名时显示的一跳）。 */
export function directDependencies(graph: PackageGraph, name: string): { outgoing: PackageEdge[]; incoming: PackageEdge[] } {
  return {
    outgoing: graph.edges.filter(edge => edge.from === name),
    incoming: graph.edges.filter(edge => edge.to === name),
  }
}

/** 包标签（对话框统一用；根目录是空串）。 */
export function packageDisplay(name: string): string {
  return name === '' ? '(根目录)' : name
}

// ── 包视图（上游 `ScopeViewTreeModel.visitPackages` 的 PSI 三档，本仓用符号模型还原） ─────────
// 判词 `pv/project-view-nodes` 里「包视图（`FlattenPackages`/`AbbreviatePackageNames`/
// `HideEmptyMiddlePackages`）需 PSI/Java 包模型」这一条，本批由 `src/symbolModel.ts` 的
// `packageTreeOf` 承接：声明的包名（`declaredPackageName`）＋目录归属建包树，三档选项照
// `ScopeViewTreeModel.java:586-655` 的 `flattenPackages`/`hideEmptyMiddlePackages` 与
// `GroupByTypeComparator.java:134` 的 `abbreviatePackageNames`。
//
// 为什么落在这里而不是项目树：项目树模型（`src/projectTreeModel.ts`）正在别的 lane 上改，
// 而本模块本来就是「包」这一层的视图规则（作用域/视图设置/依赖闭包），包视图的设置面与它同域。
// 面板挂载点：`src/components/PackageDepsDialog.vue` 的工具栏（一个「包视图」开关组）——
// 组件归 UI lane，接线请求见报告。

import { packageLabel, type PackageNode, type PackageViewSettings } from './symbolModel.ts'
// 「包/项目文件」两方言走上游 EP `com.intellij.patternDialectProvider`：内建两支作为 bundled 贡献
// 登记在 `src/projectViewExtensionPoints.ts`，第三方按同一 id 挂的方言能整体接管这棵树的建法。
import { PACKAGE_PATTERN_DIALECT, patternDialectTree } from './projectViewExtensionPoints.ts'

export type { PackageNode, PackageViewSettings } from './symbolModel.ts'

/** 包视图的三档（上游 `ProjectView` 的三个选项；标题取 zh 包同名键的意译）。 */
export const PACKAGE_VIEW_OPTIONS: Array<{ id: keyof PackageViewSettings; title: string; description: string }> = [
  { id: 'flattenPackages', title: '平铺包', description: '不建中间层节点，每个包直接列在顶层（上游 ProjectView.isFlattenPackages）' },
  { id: 'hideEmptyMiddlePackages', title: '隐藏空的中间包', description: '只有子包、没有文件的中间层并进它的父（上游 isHideEmptyMiddlePackages）' },
  { id: 'abbreviatePackageNames', title: '缩写包名', description: '包名按段取首字母（上游 isAbbreviatePackageNames）' },
]

export const DEFAULT_PACKAGE_VIEW_SETTINGS: PackageViewSettings = {
  flattenPackages: false, hideEmptyMiddlePackages: false, abbreviatePackageNames: false,
}

/** 包树的一行（渲染层用；`label` 已按缩写档算好）。 */
export interface PackageViewRow {
  name: string
  label: string
  depth: number
  /** 直接属于这个包的文件数（不含子包）。 */
  fileCount: number
  /** 子树合计文件数。 */
  totalFiles: number
  middle: boolean
}

function countFiles(node: PackageNode): number {
  return node.files.length + node.children.reduce((sum, child) => sum + countFiles(child), 0)
}

/**
 * 包树 → 行表（深度优先，父在子前）。`label` 走 `symbolModel.packageLabel`
 * （缩写档开着时缩写；空包名给「(根)」），所以「缩写包名」这一档只改显示、不改树形 ——
 * 与上游 `GroupByTypeComparator` 只换呈现文本同一口径。
 */
export function packageViewRows(roots: readonly PackageNode[], settings: PackageViewSettings = {}): PackageViewRow[] {
  const out: PackageViewRow[] = []
  const visit = (nodes: readonly PackageNode[], depth: number) => {
    for (const node of nodes) {
      out.push({ name: node.name, label: packageLabel(node.name, settings), depth, fileCount: node.files.length, totalFiles: countFiles(node), middle: node.middle })
      visit(node.children, depth + 1)
    }
  }
  visit(roots, 0)
  return out
}

/**
 * 由文件清单 + 声明包名表建包视图行表（面板一次调用拿到整棵树）：
 * `declared` 缺项按目录归属（`packageTreeOf` 的口径）。这是「包视图」在本仓的**入口**。
 *
 * `dialect` 走上游 `com.intellij.patternDialectProvider`（`PatternDialectProvider.java:24`）：
 * `package` 是内建方言（`packageTreeOf`），`file` 是内建的项目文件方言（按目录分层），
 * 第三方按同一 shortName 挂的方言会覆盖它并整体接管这棵树。
 */
export function buildPackageView(
  files: readonly string[],
  declared: ReadonlyMap<string, string | null> = new Map(),
  settings: PackageViewSettings = {},
  dialect: string = PACKAGE_PATTERN_DIALECT,
): PackageViewRow[] {
  return packageViewRows(patternDialectTree({ files, declared, settings }, dialect), settings)
}
