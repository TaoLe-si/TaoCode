// 依赖分析器模型（上游 `openapi/externalSystem/dependency/analyzer` 一族的可移植子集）。
//
// 上游逐类：
//   · `DependencyAnalyzerDependency.kt`：`Data`（Module / Artifact）、`Scope`（name/title/type）、
//     `Status`（Omitted / Warning(message)）、`parent` 链。
//   · `DependencyUiUtil.kt:DependencyGroup`（:204-220）：把**同一坐标**的多次出现收成一组 ——
//     `dependency` = 第一条非 omitted、`scopes` = 出现过的配置集合、`parents` = 出现过的父依赖集合、
//     `status`/`warnings` = 各 variance 的并集、`isOmitted` = 全部 omitted、`hasWarnings` = 任一告警；
//     单元格文本 = `artifactId:version`，打开「显示 groupId」时给 `groupId:artifactId:version`
//     （`:47-53 getDisplayText`）。
//   · `GradleDependencyAnalyzerContributor.kt:140-160 getStatus`：UNRESOLVED → 告警；
//     selectionReason 以 "between versions" 开头 → **版本冲突**告警（带另一个版本号）。
//     本仓的数据源是 `gradle dependencies --console=plain` 的文本（`src/gradle.ts` 的
//     `parseGradleDependencies`），CLI 把这两件事分别打成 `(n)` 与 `group:name:X -> Y`
//     —— 所以两种告警都能如实还原。
//   · `DependencyAnalyzerViewImpl.kt:186-198 filterDependencies`：文本过滤（显示文本的子串）
//     + 按配置过滤（勾选的 scope 集合）+ 「只看告警」开关，三者依次叠加。
//   · `:244-263`：过滤后的 variance 重新成组、重画列表与树。
//   · `:350-365 getTreePath`：从根依赖到目标的 parent 链 = usages 树。
//
// 本仓拿不到 Gradle Tooling API 的 `DependencyNode`，所以：
//   · `Data.Module` 只认 CLI 的 `project :path` 写法；
//   · 上游 `Status.Omitted`（`ResolutionState.OMITTED`，被冲突淘汰的版本）在 CLI 输出里
//     **看不到** —— Gradle 只打印被选中的结果，所以这里没有 omitted 数据源（诚实缺口，
//     不造假状态）；`(c)` 约束行如实记为 constraint 状态；
//   · 上游 `DependencyAnalyzerGoToAction` 跳声明位置要用 Tooling API 的坐标→脚本行号映射，
//     CLI 文本没有，故不做（判词里写明）。
//
// 消费者：Gradle 工具窗口的「依赖分析…」对话框（`src/components/DependencyAnalyzerDialog.vue`），
// 对应上游 `DependencyAnalyzerAction` 打开的 `DependencyAnalyzerVirtualFile` 编辑器页。

import type { GradleDependency, GradleDependencyScope } from './gradle.ts'

/** `DependencyAnalyzerDependency.Data.Artifact`。 */
export interface AnalyzerArtifact {
  kind: 'artifact'
  groupId: string
  artifactId: string
  version: string
}

/** `DependencyAnalyzerDependency.Data.Module`（CLI 的 `project :x`）。 */
export interface AnalyzerModule {
  kind: 'module'
  name: string
}

export type AnalyzerData = AnalyzerArtifact | AnalyzerModule

/** `DependencyAnalyzerDependency.Scope`（type 决定过滤器的标准/自定义分组）。 */
export interface AnalyzerScope {
  name: string
  title: string
  type: 'STANDARD' | 'CUSTOM'
}

/** `DependencyAnalyzerDependency.Status` 的可移植两种 + 约束。 */
export type AnalyzerStatus =
  | { kind: 'unresolved'; title: string; message: string }
  | { kind: 'versionConflict'; title: string; message: string; requested: string; resolved: string }
  | { kind: 'constraint'; title: string; message: string }

export interface AnalyzerDependency {
  data: AnalyzerData
  scope: AnalyzerScope
  parent: AnalyzerDependency | null
  status: AnalyzerStatus[]
}

/** `DependencyGroup`（DependencyUiUtil.kt:204-220）的字段逐条对应。 */
export interface AnalyzerDependencyGroup {
  variances: AnalyzerDependency[]
  /** 第一条非 omitted 的 variance；本仓没有 omitted 数据源，等价于第一条。 */
  dependency: AnalyzerDependency
  data: AnalyzerData
  scopes: AnalyzerScope[]
  parents: AnalyzerDependency[]
  status: AnalyzerStatus[]
  warnings: Extract<AnalyzerStatus, { kind: 'versionConflict' | 'unresolved' }>[]
  hasWarnings: boolean
  isOmitted: boolean
}

/** `GradleDependencyAnalyzerContributor.kt:186-193` 的六个标准配置。 */
export const STANDARD_DEPENDENCY_SCOPES = [
  'annotationProcessor', 'compileClasspath', 'runtimeClasspath',
  'testAnnotationProcessor', 'testCompileClasspath', 'testRuntimeClasspath',
] as const

/** 上游 `DAScope` 的默认作用域名（根模块那条虚构依赖用它）。 */
export const ANALYZER_DEFAULT_SCOPE_NAME = 'default'

/** `ScopeUiUtil`：标准配置归 STANDARD，其余 CUSTOM（顺序保持数据顺序）。 */
export function analyzerScope(name: string): AnalyzerScope {
  const standard = (STANDARD_DEPENDENCY_SCOPES as readonly string[]).includes(name)
  return { name, title: name, type: standard ? 'STANDARD' : 'CUSTOM' }
}

/**
 * CLI 坐标 → Data。认三种写法：`group:artifact:version`、`group:artifact`（版本空）、
 * `project :path`（工程依赖 → Module）。认不出返回 null（调用方跳过，不编造坐标）。
 */
export function analyzerDataOf(name: string, version = ''): AnalyzerData | null {
  const text = name.trim()
  if (!text) return null
  if (text.startsWith('project ')) return { kind: 'module', name: text.slice('project '.length).trim() }
  const parts = text.split(':')
  if (parts.length >= 3 && parts[0] && parts[1]) {
    return { kind: 'artifact', groupId: parts[0], artifactId: parts[1], version: version || parts.slice(2).join(':') }
  }
  if (parts.length === 2 && parts[0] && parts[1]) return { kind: 'artifact', groupId: parts[0], artifactId: parts[1], version }
  return null
}

/** `getDisplayText`（DependencyUiUtil.kt:47-53）：artifactId[:version] 或完整坐标（显示 groupId 时）。 */
export function analyzerDisplayText(data: AnalyzerData, showGroupId = false): string {
  if (data.kind === 'module') return data.name
  const short = data.version ? `${data.artifactId}:${data.version}` : data.artifactId
  return showGroupId ? `${data.groupId}:${short}` : short
}

/** 同一坐标的稳定键（成组用；上游按 Data 的相等性成组）。 */
export function analyzerGroupKey(data: AnalyzerData, showGroupId = true): string {
  if (data.kind === 'module') return `module:${data.name}`
  return showGroupId ? `artifact:${data.groupId}:${data.artifactId}:${data.version}` : `artifact::${data.artifactId}:${data.version}`
}

/** `getStatus`：`(n)` → unresolved；`X -> Y` → versionConflict；`(c)` → constraint。 */
export function analyzerStatusOf(dependency: GradleDependency): AnalyzerStatus[] {
  const status: AnalyzerStatus[] = []
  if (dependency.unresolved) {
    status.push({
      kind: 'unresolved',
      title: '无法解析',
      message: `${dependency.name} 无法解析（Gradle 标记 (n)）。`,
    })
  }
  if (dependency.resolved) {
    status.push({
      kind: 'versionConflict',
      title: `版本冲突：解析为 ${dependency.resolved}`,
      message: `${dependency.name} 请求的版本被解析为 ${dependency.resolved}。`,
      requested: dependency.name,
      resolved: dependency.resolved,
    })
  }
  if (dependency.constraint) {
    status.push({ kind: 'constraint', title: '约束', message: `${dependency.name} 是依赖约束而不是实际依赖（Gradle 标记 (c)）。` })
  }
  return status
}

/**
 * 把一次「加载依赖」的结果展成上游的依赖列表：每个配置一棵树 + 一条根模块依赖
 * （上游 `GradleDependencyAnalyzerContributor.getDependencies:106-120`：先加 `DAModule` 根，
 * 再逐 scope 递归 addDependencies）。`depth` 决定父子：depth 0 挂在根上，
 * 否则父 = 上一个 depth-1 的依赖（CLI 树就是按缩进打印的）。
 */
export function buildAnalyzerDependencies(scopes: readonly GradleDependencyScope[], moduleName: string): AnalyzerDependency[] {
  const out: AnalyzerDependency[] = []
  const root: AnalyzerDependency = {
    data: { kind: 'module', name: moduleName },
    scope: analyzerScope(ANALYZER_DEFAULT_SCOPE_NAME),
    parent: null,
    status: [],
  }
  out.push(root)
  for (const scope of scopes) {
    const analyzerScopeEntry = analyzerScope(scope.configuration)
    const stack: AnalyzerDependency[] = []
    for (const dependency of scope.dependencies) {
      const data = analyzerDataOf(dependency.name)
      // 坐标认不出（Gradle 偶尔打印说明行）→ 跳过，不编造节点。
      if (!data) continue
      const depth = Math.max(0, Math.min(dependency.depth, stack.length + 1))
      const parent = depth === 0 ? root : (stack[depth - 1] ?? root)
      const node: AnalyzerDependency = { data, scope: analyzerScopeEntry, parent, status: analyzerStatusOf(dependency) }
      stack[depth] = node
      stack.length = depth + 1
      out.push(node)
    }
  }
  return out
}

/** 从依赖集合取整棵树（含所有 parent 链）；上游 `collectAllDependencies`。 */
export function collectAllDependencies(dependencies: readonly AnalyzerDependency[]): AnalyzerDependency[] {
  return [...dependencies]
}

/** `DependencyGroup` 成组（DependencyUiUtil.kt:204-220 逐字段）。 */
export function createDependencyGroups(dependencies: readonly AnalyzerDependency[]): AnalyzerDependencyGroup[] {
  const groups = new Map<string, AnalyzerDependency[]>()
  for (const dependency of dependencies) {
    const key = analyzerGroupKey(dependency.data)
    const list = groups.get(key)
    if (list) list.push(dependency)
    else groups.set(key, [dependency])
  }
  return [...groups.values()].map(variances => dependencyGroup(variances))
}

/** 单组构造（过滤后重组成组时复用，见 `DependencyAnalyzerViewImpl.kt:244-251`）。 */
export function dependencyGroup(variances: AnalyzerDependency[]): AnalyzerDependencyGroup {
  const status = variances.flatMap(variance => variance.status)
  const warnings = status.filter((entry): entry is Extract<AnalyzerStatus, { kind: 'versionConflict' | 'unresolved' }> =>
    entry.kind === 'versionConflict' || entry.kind === 'unresolved')
  const scopes: AnalyzerScope[] = []
  const parents: AnalyzerDependency[] = []
  for (const variance of variances) {
    if (!scopes.some(scope => scope.name === variance.scope.name)) scopes.push(variance.scope)
    if (variance.parent && !parents.includes(variance.parent)) parents.push(variance.parent)
  }
  return {
    variances,
    dependency: variances[0]!,
    data: variances[0]!.data,
    scopes,
    parents,
    status,
    warnings,
    hasWarnings: warnings.length > 0,
    isOmitted: false,      // CLI 看不到被淘汰的版本（文件头说明），不谎报 omitted
  }
}

export interface AnalyzerFilter {
  /** 文本过滤：显示文本的子串（大小写不敏感）。 */
  dataFilter?: string
  /** 勾选的配置名；空数组 = 没有选中任何配置（与上游勾选模型一致）。 */
  scopes?: readonly string[]
  /** 「只看告警」开关（`showDependencyWarningsProperty`）。 */
  showWarningsOnly?: boolean
  showGroupId?: boolean
}

/** `filterDependencies`（:186-198）：文本 → 配置 → 只看告警，依次叠加。 */
export function filterAnalyzerDependencies(dependencies: readonly AnalyzerDependency[], filter: AnalyzerFilter = {}): AnalyzerDependency[] {
  const query = (filter.dataFilter ?? '').trim().toLocaleLowerCase()
  // 不给 scopes = 不做配置过滤；给了空数组 = 没有勾选任何配置 → 什么都不匹配（上游勾选模型）。
  const scopeNames = filter.scopes === undefined ? null : new Set(filter.scopes)
  return dependencies.filter(dependency => {
    if (query && !analyzerDisplayText(dependency.data, filter.showGroupId).toLocaleLowerCase().includes(query)) return false
    if (scopeNames && !scopeNames.has(dependency.scope.name)) return false
    if (filter.showWarningsOnly && !dependency.status.some(entry => entry.kind === 'versionConflict' || entry.kind === 'unresolved')) return false
    return true
  })
}

/** 过滤 → 重新成组（`:244-251`）。 */
export function filterAnalyzerGroups(groups: readonly AnalyzerDependencyGroup[], filter: AnalyzerFilter = {}): AnalyzerDependencyGroup[] {
  return groups
    .map(group => filterAnalyzerDependencies(group.variances, filter))
    .filter(variances => variances.length > 0)
    .map(variances => dependencyGroup(variances))
}

/** `getTreePath`（:350-365）：根 → … → 目标 的 parent 链。 */
export function analyzerTreePath(dependency: AnalyzerDependency): AnalyzerDependency[] {
  const path: AnalyzerDependency[] = []
  let current: AnalyzerDependency | null = dependency
  while (current) { path.unshift(current); current = current.parent }
  return path
}

/** usages 树：选中的坐标在哪些位置出现（每条 variance 一条根到叶的路径）。 */
export function analyzerUsagesTree(group: AnalyzerDependencyGroup): AnalyzerDependency[][] {
  return group.variances
    .map(variance => analyzerTreePath(variance))
    .filter(path => path.length > 0)
}

export interface AnalyzerSummary {
  groups: number
  dependencies: number
  conflicts: number
  unresolved: number
  /** 出现 >1 个配置的坐标数。 */
  multiScope: number
}

/** 列表头部的汇总（上游没有这一行；对话框用它给「加载完了没有告警」一个即时答案）。 */
export function analyzerSummary(groups: readonly AnalyzerDependencyGroup[]): AnalyzerSummary {
  let dependencies = 0
  let conflicts = 0
  let unresolved = 0
  let multiScope = 0
  for (const group of groups) {
    dependencies += group.variances.length
    conflicts += group.warnings.filter(warning => warning.kind === 'versionConflict').length
    unresolved += group.warnings.filter(warning => warning.kind === 'unresolved').length
    if (group.scopes.length > 1) ++multiScope
  }
  return { groups: groups.length, dependencies, conflicts, unresolved, multiScope }
}

/** `ScopeUiUtil` 的勾选模型：标准配置在前、自定义在后，默认全选。 */
export function analyzerScopeItems(scopes: readonly GradleDependencyScope[]): Array<AnalyzerScope & { selected: boolean }> {
  const seen: AnalyzerScope[] = []
  for (const scope of scopes) {
    const entry = analyzerScope(scope.configuration)
    if (!seen.some(item => item.name === entry.name)) seen.push(entry)
  }
  seen.sort((left, right) => Number(right.type === 'STANDARD') - Number(left.type === 'STANDARD'))
  return seen.map(entry => ({ ...entry, selected: true }))
}
