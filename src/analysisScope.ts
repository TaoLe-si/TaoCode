// 分析范围 —— 上游 `analysis` 包的 `BaseAnalysisAction` / `BaseAnalysisActionDialog` /
// `AnalysisUIOptions` 与 `ide/util/scopeChooser/ScopeIdMapper` 在本仓的落点。
//
// 上游的用户可见行为：Analyze → Inspect Code 先弹 `BaseAnalysisActionDialog`（范围单选 + 自定义
// 范围树 `ModelScopeItemView` + 「包含测试代码」那一档 `scope.option.include.test.sources`，
// `BaseAnalysisActionDialog.java:100` 与 `:220-222`），跑分析时只在范围内找问题。
//
// 本仓没有 PSI/模块作用域对象，范围落成三档：
//   · `project` —— 全部工作区文件（默认，与 `AnalysisScope.PROJECT` 同义）；
//   · `custom` —— include/exclude 两行 glob（与 `CustomScopeItem` 的自定义范围同层；匹配用
//     与 `src/analysisIgnore.ts` 同一套 glob 规则：`**` 跨目录、`*` 段内、`?` 单字符，
//     exclude 优先）。`CustomScopeItemPresenter` 的那棵树本仓不搬。
//   · `named` —— 工程里的**命名作用域**（`ScopeChooserConfigurable` 那一族，模式语言在 `src/scopes.ts`）。
//     存的是**序列化 id**（作用域名），显示时才过 `src/scopeIdMapper.ts` —— 这正是判词里
//     「`ScopeIdMapper` 的 scope→id 映射（本仓直接存模式文本）」那一条缺口的落点；
//     上游同名机制见 `AnalysisUIOptions.java:43` 的 `CUSTOM_SCOPE_NAME`。
//   命名作用域表由消费方注入（`setAnalysisScopeNamedScopes`，设置页读到 `ProjectSettings.scopes` 后喂进来）：
//   本模块是同步求值，不能自己去发请求。注入的同时会把这张表缓存到 `taocode.analysisNamedScopes`，
//   模块初始化时同步读回 —— 否则"重启后还没进过设置页"的那段时间里 `named` 档会一个文件都不命中。
// 状态按 `AnalysisUIOptions` 的口径持久化（IDEA 存 workspace.xml；本仓 localStorage，
// **应用级单键**：改成按工作区根分键要动 `src/workspaceInspection.ts` 的调用签名，那边在别人名下）。
// 消费方：`src/workspaceInspection.ts` 在把整工程报告写进诊断表**之前**按范围过滤；
// 选择面：问题面板的 include/exclude（`src/components/ProblemsPanel.vue`）+
// 设置 › 作用域页的「分析」一节（`src/components/ScopesSettingsPage.vue`：命名作用域单选 + 包含测试代码）。
//
// **明确不做**（上游有、本仓没有，逐条给原因）：`BaseAnalysisActionDialog` 的对话框本体与
// `ModelScopeItemView`/`ModuleScopeItem`/`OtherScopeItem` 那棵树（本仓没有对话框宿主，模块只有一档）；
// `ANALYZE_INJECTED_CODE`（没有注入语言的 PSI 片段可查）；`PerformAnalysisInBackgroundOption`
// （宿主请求本就是异步）。
import { ref } from 'vue'
// 带 `.ts` 后缀：本模块被 `tests/*.mjs` 经 workspaceInspection.ts 间接载入，Node 不做扩展名推断。
import { globToRegExp } from './analysisIgnore.ts'
import { compileScopeText, scopeMatches, scopeLookup, type ScopeContext } from './scopes.ts'
import { classifyFile } from './packageDepsView.ts'

export const ANALYSIS_SCOPE_KEY = 'taocode.analysisScope'
/** `AnalysisUIOptions` 那一族开关的存档键（上游 `@Storage(PRODUCT_WORKSPACE_FILE)`，`:29`）。 */
export const ANALYSIS_UI_OPTIONS_KEY = 'taocode.analysisUiOptions'
/**
 * 命名作用域表的**解析缓存**键。
 *
 * 为什么要有这一层（本仓架构补的，上游没有）：上游 `AnalysisUIOptions.java:43` 只存作用域**名字**，
 * 求值时现取 `ProjectScopeService`（同步的服务）。本仓的表来自 `project.settings.get`（**异步**请求），
 * 而 `pathInAnalysisScope` 是同步判定 —— 于是"重启后没进过设置页"的那段时间里表是空的，
 * `kind === 'named'` 的范围会**一个文件都不命中**（用户看到的就是"分析扫了 0 个文件"）。
 * 这一层就是把上一次注入的表顺手存下来，模块初始化时同步读回：
 *   · 持久化的**身份**仍然是名字（照上游），这张缓存只是解析辅助；
 *   · 消费方一注入真表（`setAnalysisScopeNamedScopes`）就立刻覆盖它，读到新设置后不会有陈旧窗口；
 *   · 坏 JSON / 错形状一律退回空表，永不抛（与那两个存档键同一条纪律）。
 */
export const ANALYSIS_NAMED_SCOPES_KEY = 'taocode.analysisNamedScopes'

export interface AnalysisScope {
  kind: 'project' | 'custom' | 'named'
  /** 每行一条 glob（`#` 开头是注释）；空 include = 全部。 */
  include: string[]
  exclude: string[]
  /** `kind === 'named'` 时是那条命名作用域的名字（= 序列化 id，不是显示名）。 */
  namedScope?: string
}

export const PROJECT_SCOPE: AnalysisScope = { kind: 'project', include: [], exclude: [] }

/**
 * `AnalysisUIOptions` 的六个可持久化项（默认值逐条照 `AnalysisUIOptions.java:35-40`：
 * `AUTOSCROLL_TO_SOURCE=false`、`SPLITTER_PROPORTION=0.5`、`GROUP_BY_SEVERITY=false`、
 * `FILTER_RESOLVED_ITEMS=true`、`ANALYZE_TEST_SOURCES=true`、`ANALYZE_INJECTED_CODE=true`）。
 * 本仓真正生效的只有 `analyzeTestSources`（过滤链在 `filterByAnalysisScope` 里）；
 * 其余四项的状态先存起来，控件在问题面板那一侧（`src/components/ProblemsPanel.vue`，桶 2 名下）
 * ⇒ 已提接线请求，**不在这里渲染没有消费者的控件**。
 */
export interface AnalysisUiOptions {
  autoScrollToSource: boolean
  splitterProportion: number
  groupBySeverity: boolean
  filterResolvedItems: boolean
  analyzeTestSources: boolean
  analyzeInjectedCode: boolean
}

export const DEFAULT_ANALYSIS_UI_OPTIONS: AnalysisUiOptions = {
  autoScrollToSource: false,
  splitterProportion: 0.5,
  groupBySeverity: false,
  filterResolvedItems: true,
  analyzeTestSources: true,
  analyzeInjectedCode: true,
}

function read(scopeStorage?: AnalysisScopeStorage): AnalysisScope {
  try {
    const raw = (scopeStorage ?? globalStorage())?.getItem(ANALYSIS_SCOPE_KEY)
    if (!raw) return PROJECT_SCOPE
    const parsed = JSON.parse(raw) as Partial<AnalysisScope>
    // 旧存档只有 custom/project 两档：认不出的 kind 一律退回"全部项目"（不炸、不猜）。
    if (parsed?.kind !== 'custom' && parsed?.kind !== 'named') return PROJECT_SCOPE
    const include = normalizeLines(parsed.include)
    const exclude = normalizeLines(parsed.exclude)
    // `namedScope` 是 `kind === 'named'` 才有的判别字段：**只有 named 档才带它**。
    // 早先这里无条件补 `namedScope: ''`，于是「旧的两档存档」读回来会多出一个键 ——
    // 往返不幂等（写进去的形状 ≠ 读出来的形状），下游做整形状比较/再次序列化时会把它当成
    // "存档坏了"处理。判别式联合的可选字段按上游 `AnalysisUIOptions.java:42-43` 的口径也是分开的
    // 两列（`SCOPE_TYPE` / `CUSTOM_SCOPE_NAME`），只有 CUSTOM 档那一列才写名字。
    return parsed.kind === 'named'
      ? { kind: 'named', include, exclude, namedScope: typeof parsed.namedScope === 'string' ? parsed.namedScope : '' }
      : { kind: 'custom', include, exclude }
  } catch {
    return PROJECT_SCOPE
  }
}

function readOptions(optionsStorage?: AnalysisScopeStorage): AnalysisUiOptions {
  try {
    const raw = (optionsStorage ?? globalStorage())?.getItem(ANALYSIS_UI_OPTIONS_KEY)
    if (!raw) return { ...DEFAULT_ANALYSIS_UI_OPTIONS }
    const parsed = JSON.parse(raw) as Partial<AnalysisUiOptions>
    const flag = (value: unknown, fallback: boolean) => (typeof value === 'boolean' ? value : fallback)
    const proportion = typeof parsed?.splitterProportion === 'number' && parsed.splitterProportion > 0 && parsed.splitterProportion < 1
      ? parsed.splitterProportion : DEFAULT_ANALYSIS_UI_OPTIONS.splitterProportion
    return {
      autoScrollToSource: flag(parsed?.autoScrollToSource, DEFAULT_ANALYSIS_UI_OPTIONS.autoScrollToSource),
      splitterProportion: proportion,
      groupBySeverity: flag(parsed?.groupBySeverity, DEFAULT_ANALYSIS_UI_OPTIONS.groupBySeverity),
      filterResolvedItems: flag(parsed?.filterResolvedItems, DEFAULT_ANALYSIS_UI_OPTIONS.filterResolvedItems),
      analyzeTestSources: flag(parsed?.analyzeTestSources, DEFAULT_ANALYSIS_UI_OPTIONS.analyzeTestSources),
      analyzeInjectedCode: flag(parsed?.analyzeInjectedCode, DEFAULT_ANALYSIS_UI_OPTIONS.analyzeInjectedCode),
    }
  } catch {
    return { ...DEFAULT_ANALYSIS_UI_OPTIONS }
  }
}

/** `localStorage` 的窄接口（测试传内存实现，同 `src/commitOptions.ts` 的口径）。 */
export interface AnalysisScopeStorage {
  getItem: (key: string) => string | null
  setItem: (key: string, value: string) => void
}

function globalStorage(): AnalysisScopeStorage | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage
  } catch {
    return null
  }
}

/** 从存档读范围（缺省走 `localStorage`；坏存档/旧形状退回"全部项目"，永不抛）。 */
export function loadAnalysisScope(scopeStorage?: AnalysisScopeStorage): AnalysisScope {
  return read(scopeStorage)
}

/** 从存档读那一族 UI 选项（坏数据退回上游缺省档）。 */
export function loadAnalysisUiOptions(optionsStorage?: AnalysisScopeStorage): AnalysisUiOptions {
  return readOptions(optionsStorage)
}

function normalizeLines(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return value.filter((line): line is string => typeof line === 'string' && line.trim() !== '' && !line.trim().startsWith('#'))
    .map(line => line.trim())
}

function write(scope: AnalysisScope, scopeStorage?: AnalysisScopeStorage) {
  const target = scopeStorage ?? globalStorage()
  try {
    target?.setItem(ANALYSIS_SCOPE_KEY, JSON.stringify(scope))
  } catch {
    // 存储不可用时只影响持久化，本次会话内照常生效。
  }
}

function writeOptions(options: AnalysisUiOptions, optionsStorage?: AnalysisScopeStorage) {
  const target = optionsStorage ?? globalStorage()
  try {
    target?.setItem(ANALYSIS_UI_OPTIONS_KEY, JSON.stringify(options))
  } catch {
    // 同上：存不下不影响本次分析。
  }
}

/** 当前范围（响应式；问题面板与 `runWorkspaceInspection` 读写同一份）。 */
export const analysisScope = ref<AnalysisScope>(read())
/** 当前那一族 UI 选项（响应式）。 */
export const analysisUiOptions = ref<AnalysisUiOptions>(readOptions())

/**
 * 命名作用域表（`ProjectSettings.scopes` 的那三列里取 name/pattern）。
 * 由知道工程设置的消费方注入 —— 本模块同步求值，发不了请求。
 * 初值 = 上一次注入时缓存下来的那张表（见 `ANALYSIS_NAMED_SCOPES_KEY` 那段：没有它，重启后没进过
 * 设置页的时间窗里 `kind === 'named'` 的范围会一个文件都不命中）。
 */
const namedScopeTable = ref<readonly { name: string; pattern: string }[]>(readNamedScopes())

/** 缓存里最多留几条作用域（防御：设置被改坏成几千条时不要把 localStorage 撑爆）。 */
const MAX_CACHED_NAMED_SCOPES = 200

function readNamedScopes(scopeStorage?: AnalysisScopeStorage): readonly { name: string; pattern: string }[] {
  try {
    const raw = (scopeStorage ?? globalStorage())?.getItem(ANALYSIS_NAMED_SCOPES_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw) as unknown
    if (!Array.isArray(parsed)) return []
    return parsed
      .filter((entry): entry is { name: string; pattern: string } => !!entry
        && typeof (entry as { name?: unknown }).name === 'string'
        && (entry as { name: string }).name.trim() !== ''
        && typeof (entry as { pattern?: unknown }).pattern === 'string')
      .slice(0, MAX_CACHED_NAMED_SCOPES)
      .map(entry => ({ name: entry.name, pattern: entry.pattern }))
  } catch {
    return []                                   // 坏缓存 = 没有缓存，绝不抛
  }
}

function writeNamedScopes(scopes: readonly { name: string; pattern: string }[], scopeStorage?: AnalysisScopeStorage): void {
  try {
    const target = scopeStorage ?? globalStorage()
    target?.setItem(ANALYSIS_NAMED_SCOPES_KEY, JSON.stringify(scopes.slice(0, MAX_CACHED_NAMED_SCOPES).map(
      entry => ({ name: entry.name, pattern: entry.pattern }))))
  } catch {
    // 存不下只影响"下一次重启的早期窗口"，本次会话的求值用的是注入进来的真表。
  }
}

/** 注入命名作用域表（真来源是项目设置），并把这张表缓存起来供下一次启动同步读回。 */
export function setAnalysisScopeNamedScopes(
  scopes: readonly { name: string; pattern: string }[], storage?: AnalysisScopeStorage,
): void {
  namedScopeTable.value = scopes
  writeNamedScopes(scopes, storage)
}

/**
 * 只从缓存读回那张表（不发请求、不碰真来源）：启动早期还没有 `project.settings.get` 结果时兜底。
 * 读到空数组时**不覆盖**现有表 —— 免得把已经注入的真表擦掉。
 */
export function loadAnalysisNamedScopes(storage?: AnalysisScopeStorage): readonly { name: string; pattern: string }[] {
  const cached = readNamedScopes(storage)
  if (cached.length) namedScopeTable.value = cached
  return cached
}

/** 把两段文本（问题面板的两个输入框）落成范围；两段都空 = 回到"全部项目"。 */
export function setAnalysisScopeFromText(includeText: string, excludeText: string, storage?: AnalysisScopeStorage): AnalysisScope {
  const include = normalizeLines(includeText.split(/\r?\n/))
  const exclude = normalizeLines(excludeText.split(/\r?\n/))
  const scope: AnalysisScope = include.length || exclude.length
    ? { kind: 'custom', include, exclude }
    : PROJECT_SCOPE
  analysisScope.value = scope
  write(scope, storage)
  return scope
}

/**
 * 选一条命名作用域作为分析范围（`BaseAnalysisActionDialog` 的"自定义范围"那一档在本仓的等价物；
 * 存的是名字 = 序列化 id，见文件头的 `ScopeIdMapper` 那一段）。传空串回到"全部项目"。
 */
export function setAnalysisScopeNamed(name: string, storage?: AnalysisScopeStorage): AnalysisScope {
  const scope: AnalysisScope = name ? { kind: 'named', include: [], exclude: [], namedScope: name } : PROJECT_SCOPE
  analysisScope.value = scope
  write(scope, storage)
  return scope
}

/** 改一个 UI 选项并落盘（`AnalysisUIOptions` 的 setter 面）。 */
export function setAnalysisUiOption<K extends keyof AnalysisUiOptions>(
  key: K, value: AnalysisUiOptions[K], storage?: AnalysisScopeStorage,
): AnalysisUiOptions {
  analysisUiOptions.value = { ...analysisUiOptions.value, [key]: value }
  writeOptions(analysisUiOptions.value, storage)
  return analysisUiOptions.value
}

export function resetAnalysisScope(storage?: AnalysisScopeStorage): void {
  analysisScope.value = PROJECT_SCOPE
  write(PROJECT_SCOPE, storage)
}

/** 作用域文本（编辑器回填用）。 */
export function scopeText(lines: readonly string[]): string {
  return lines.join('\n')
}

function matchesAny(patterns: readonly string[], path: string): boolean {
  return patterns.some(pattern => globToRegExp(pattern).test(path))
}

/**
 * 路径是否在范围内。判定顺序照范围语义：exclude 先否决，include 非空时必须命中一条
 * （`BaseAnalysisActionDialog` 的范围里"包含/排除"就是这个优先级）。
 * 「包含测试代码」这一档在上游是 `scope.setIncludeTestSource(...)`（`BaseAnalysisActionDialog.java:222`），
 * 关掉之后测试源根整个不进范围 —— 本仓按 `src/packageDepsView.ts` 的测试路径分类做同一件事。
 */
export function pathInAnalysisScope(path: string, scope: AnalysisScope = analysisScope.value): boolean {
  if (scope.kind === 'named') {
    return namedScopeContains(scope.namedScope ?? '', path) && testSourcesAllowed(path)
  }
  if (scope.kind !== 'custom') return testSourcesAllowed(path)
  const normalized = path.replace(/\\/g, '/')
  if (matchesAny(scope.exclude, normalized)) return false
  if (!scope.include.length) return testSourcesAllowed(normalized)
  return matchesAny(scope.include, normalized) && testSourcesAllowed(normalized)
}

/** 命名作用域的求值：查不到名字/模式编译不过 ⇒ 不在范围内（与 `scopes.ts` 的兜底一致）。 */
function namedScopeContains(name: string, path: string): boolean {
  if (!name) return false
  const normalized = path.replace(/\\/g, '/')
  const entry = namedScopeTable.value.find(scope => scope.name === name)
  if (!entry) return false
  const compiled = compileScopeText(entry.pattern)
  if (compiled.error) return false
  const context: ScopeContext = { lookup: scopeLookup(namedScopeTable.value) }
  return scopeMatches(compiled.set, normalized, false, context)
}

/** 「分析测试源码」关掉了就把测试文件挡在范围外（`AnalysisUIOptions.java:39` 默认 true ⇒ 默认不挡）。 */
function testSourcesAllowed(path: string): boolean {
  if (analysisUiOptions.value.analyzeTestSources) return true
  return classifyFile(path) !== 'test'
}

export interface ScopeFilterOutcome<T> { kept: T[]; skipped: number }

/** 按范围筛一遍报告（`runWorkspaceInspection` 用它把范围外的文件挡在诊断表之外）。 */
export function filterByAnalysisScope<T>(
  items: readonly T[], pathOf: (item: T) => string, scope: AnalysisScope = analysisScope.value,
): ScopeFilterOutcome<T> {
  const kept: T[] = []
  let skipped = 0
  for (const item of items) {
    if (pathInAnalysisScope(pathOf(item), scope)) kept.push(item)
    else ++skipped
  }
  return { kept, skipped }
}

/** 范围的一句话描述（回执与 UI 共用）。 */
export function scopeSummary(scope: AnalysisScope = analysisScope.value): string {
  if (scope.kind === 'named') return `命名作用域「${scope.namedScope ?? ''}」`
  if (scope.kind !== 'custom') return testSourcesSuffix('全部项目')
  const parts: string[] = []
  if (scope.include.length) parts.push(`包含 ${scope.include.join('、')}`)
  if (scope.exclude.length) parts.push(`排除 ${scope.exclude.join('、')}`)
  return testSourcesSuffix(parts.length ? parts.join('；') : '全部项目')
}

/** 「不含测试代码」那句话（上游勾选框文案 = `scope.option.include.test.sources` = 包含测试代码）。 */
function testSourcesSuffix(base: string): string {
  return analysisUiOptions.value.analyzeTestSources ? base : `${base}，不含测试代码`
}
