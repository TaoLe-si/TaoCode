// Run Anything（上游 `platform/lang-impl/src/com/intellij/ide/actions/runAnything/`：
// `RunAnythingAction` + `RunAnythingManagerImpl` 弹一个输入框，候选来自
// `RunAnythingRunConfigurationProvider`/`RunAnythingCommandLineProvider` 等
// `RunAnythingProvider`（IDEA 2026 版走 `activity/RunAnything*Provider`），
// 回车按选中项跑配置或把输入当命令行跑）。
//
// 本仓落点：`src/runAnything.ts`（候选装配 + 模糊排序 + 历史，纯逻辑）+ `RunAnythingDialog.vue`。
// 候选来源两类：
//   · 运行/调试配置（`configs`，来自 App 的 `runConfigs`）—— 与 Run 菜单的「选择并运行」同一条链；
//   · 原始命令行（输入非空即给一行 `> 运行命令: …`，App 走 `runExternalTool` 那条 run.start 通道）。
// 历史存 `localStorage`（与本仓其它应用级用户数据同族）。
//
// **明确不做**（上游有、本子集没有）：Gradle/Maven 任务作为一等候选（由第三方 RunAnythingProvider
// 按 EP 贡献，见下）、图标/快捷键提示列。
//
// **2026-10-06 本 lane 补**：`RunAnythingProvider` 插件点已有 EP 宿主 ——
// EP id `com.intellij.runAnything.executionProvider`（逐字取自上游
// `platform/lang-impl/resources/intellij.platform.lang.impl.xml:243` 的
// `qualifiedName="com.intellij.runAnything.executionProvider"`，
// interface `com.intellij.ide.actions.runAnything.activity.RunAnythingProvider` dynamic="true"）。
// 运行配置与命令行两条是 bundled 贡献者，第三方按同一 EP id 挂的 provider 由
// `buildRunAnythingRows()`（对话框的真实消费点）合并进候选。
import { APPLICATION_SCOPE, EXTENSIONS, type ExtensionHandle, type RegisterExtensionOptions } from './extensionPoints.ts'

export type RunAnythingKind = 'config' | 'command' | 'history' | 'more'

/** 候选分组（上游 `groups/RunAnythingRecentGroup`/`RunAnythingGeneralGroup` 的等价物）。 */
export type RunAnythingGroupId = 'recent' | 'general' | 'command'

export interface RunAnythingCandidate {
  kind: RunAnythingKind
  /** 显示名；`command` 行就是要执行的命令行原文。 */
  name: string
  detail: string
}

export interface RunAnythingRow extends RunAnythingCandidate {
  score: number
  indices: number[]
  group: RunAnythingGroupId
  /** 历史行的原始类别：命令历史必须仍然按命令行重跑，不能当成同名配置。 */
  sourceKind?: 'config' | 'command'
}

const HISTORY_KEY = 'taocode.runAnything.history'
const HISTORY_LIMIT = 12

/**
 * 每组初始最多显示多少条（上游 `RunAnythingGroupBase.getMaxInitialItems`：
 * 最近组 10、一般组 15；超出的部分折叠成一行 `RunAnythingMore`，点了才展开）。
 */
export const RUN_ANYTHING_GROUP_LIMITS: Record<'recent' | 'general', number> = { recent: 10, general: 15 }

/** 命令行的显示名：多行命令只显示第一行 + 行数（上游 `RunAnythingCommandFolding` 的占位文本）。 */
export function commandDisplayName(command: string): string {
  const lines = splitCommandLines(command)
  if (lines.length <= 1) return command.trim()
  return `${lines[0]} …（${lines.length} 行）`
}

/** 组标题（上游 `RunAnythingGroup.getTitle`）。 */
export const RUN_ANYTHING_GROUP_TITLES: Record<RunAnythingGroupId, string> = {
  recent: '最近',
  general: '运行配置',
  command: '命令行',
}

/** 多行命令的有效行：去空行、去行尾空白（首尾空白不影响命令语义）。 */
export function splitCommandLines(command: string): string[] {
  return command.split(/\r?\n/).map(line => line.trim()).filter(Boolean)
}

/** 历史（最近运行成功过的配置名/命令行）。localStorage 不可用时退化为仅会话内空列表。 */
export function loadRunAnythingHistory(): RunAnythingCandidate[] {
  try {
    const raw = typeof localStorage === 'undefined' ? null : localStorage.getItem(HISTORY_KEY)
    const parsed = raw ? JSON.parse(raw) : []
    if (!Array.isArray(parsed)) return []
    return parsed
      .filter((item): item is RunAnythingCandidate =>
        Boolean(item) && typeof item.name === 'string' &&
        (item.kind === 'config' || item.kind === 'command') && typeof item.detail === 'string')
      .slice(0, HISTORY_LIMIT)
  } catch {
    return []
  }
}

function saveRunAnythingHistory(items: RunAnythingCandidate[]) {
  try {
    if (typeof localStorage !== 'undefined') localStorage.setItem(HISTORY_KEY, JSON.stringify(items.slice(0, HISTORY_LIMIT)))
  } catch {
    // 存储不可用只影响下次会话的历史，不影响本次运行。
  }
}

/** 记一条历史（同 key 顶到最前）。`kind` 只有 config/command 会进历史。 */
export function pushRunAnythingHistory(item: RunAnythingCandidate): RunAnythingCandidate[] {
  if (item.kind === 'history') return loadRunAnythingHistory()
  const key = itemKey(item)
  const next = [item, ...loadRunAnythingHistory().filter(entry => itemKey(entry) !== key)]
  saveRunAnythingHistory(next)
  return next.slice(0, HISTORY_LIMIT)
}

export function itemKey(item: Pick<RunAnythingCandidate, 'kind' | 'name'>): string {
  return `${item.kind}:${item.name}`
}

/** 输入里的命令行：`>` 前缀是显式命令写法（IDEA 的 `run.anything.command.prefix`）。 */
export function commandFromQuery(query: string): string {
  const text = query.trim()
  return text.startsWith('>') ? text.slice(1).trim() : text
}

const configCandidate = (config: { name: string; type?: string }): RunAnythingCandidate => ({
  kind: 'config', name: config.name, detail: config.type ?? '运行配置',
})

/** 每组的显示上限与「更多」行（上游 `RunAnythingGroupBase.getMaxInitialItems` + `RunAnythingMore`）。 */
function capGroup(group: RunAnythingGroupId, items: RunAnythingRow[], expanded: boolean): RunAnythingRow[] {
  const limit = group === 'command' ? Number.POSITIVE_INFINITY : RUN_ANYTHING_GROUP_LIMITS[group]
  if (expanded || items.length <= limit) return items
  const hidden = items.length - limit
  const more: RunAnythingRow = {
    kind: 'more',
    name: `更多（还有 ${hidden} 个）`,
    detail: group === 'recent' ? '展开最近使用的条目' : '展开全部运行配置',
    score: 0,
    indices: [],
    group,
  }
  return [...items.slice(0, limit), more]
}

export interface RunAnythingRowsOptions {
  /** 已展开的组（点了「更多」之后由对话框持有）。 */
  expanded?: readonly RunAnythingGroupId[]
}

// ── `RunAnythingProvider` 扩展点宿主（上游 `com.intellij.runAnything.executionProvider`） ──

/** EP id（逐字取自上游 `intellij.platform.lang.impl.xml:243` 的 `qualifiedName`）。 */
export const RUN_ANYTHING_PROVIDER_EP = 'com.intellij.runAnything.executionProvider'

/** provider 取值时的上下文（上游 `RunAnythingProvider.getValues(context, pattern)` 的可移植子集）。 */
export interface RunAnythingProviderContext {
  /** 当前运行配置（上游是 `RunManager` 里的配置）。 */
  configs: Array<{ name: string; type?: string }>
  /** 原始查询串（含 `>` 前缀）。 */
  query: string
  /** 去掉 `>` 前缀的命令行。 */
  command: string
  /** 历史条目。 */
  history: RunAnythingCandidate[]
}

/**
 * 一个候选供给方（上游 `RunAnythingProvider`/`RunAnythingActivityProvider` 的可移植子集）：
 * 由它决定自己产出的候选落在哪个组、叫什么。命令名/配置名由 provider 自报。
 */
export interface RunAnythingProvider {
  /** 贡献 id（上游 EP 无 id，这里是本仓宿主要求的键）。 */
  id: string
  /** 产出候选落在哪个组。 */
  group: RunAnythingGroupId
  /** 产出候选（上游 `getValues`）。 */
  getValues: (context: RunAnythingProviderContext) => RunAnythingCandidate[]
}

/** 声明 EP（幂等）。 */
export function declareRunAnythingProviderExtensionPoint(): void {
  EXTENSIONS.declareExtensionPoint({ id: RUN_ANYTHING_PROVIDER_EP, name: 'Run Anything 候选供给方', scope: APPLICATION_SCOPE, dynamic: true })
}

/** 插件贡献一个候选供给方（等价于上游 plugin.xml 的一条 EP 贡献）。 */
export function registerRunAnythingProvider(provider: RunAnythingProvider, options: RegisterExtensionOptions = {}): ExtensionHandle {
  return EXTENSIONS.registerExtension(RUN_ANYTHING_PROVIDER_EP, provider.id, provider, options)
}

/** 注销一条候选供给方贡献。 */
export function unregisterRunAnythingProvider(id: string): boolean {
  return EXTENSIONS.unregisterExtension(RUN_ANYTHING_PROVIDER_EP, id)
}

/** 当前 EP 上的全部供给方（bundled + 第三方）。 */
export function runAnythingProviders(scope: string = APPLICATION_SCOPE): RunAnythingProvider[] {
  return EXTENSIONS.extensionsOf<RunAnythingProvider>(RUN_ANYTHING_PROVIDER_EP, scope)
}

/** bundled 运行配置供给方（上游 `RunAnythingRunConfigurationProvider`）。 */
export const RUN_CONFIGURATION_PROVIDER: RunAnythingProvider = {
  id: 'run-configurations',
  group: 'general',
  getValues: context => context.configs.map(configCandidate),
}

/** bundled 命令行供给方（上游 `RunAnythingCommandLineProvider`）：有命令才给一行。 */
export const COMMAND_LINE_PROVIDER: RunAnythingProvider = {
  id: 'command-line',
  group: 'command',
  getValues: context => context.command
    ? [{ kind: 'command', name: context.command, detail: '在项目根目录运行命令' }]
    : [],
}

/**
 * 装配候选并分组。分组顺序与上游 `RunAnythingSearchListModel` 一致：
 * 最近（`RunAnythingRecentGroup`）→ 一般（`RunAnythingGeneralGroup`）→ 命令行；
 * 空查询时最近组给历史、一般组给全部配置，非空查询按**大小写不敏感的子串**过滤
 * （上游就是 `containsIgnoreCase` + 前缀优先，不是模糊匹配）。
 * 每组初始条数上限见 `RUN_ANYTHING_GROUP_LIMITS`，超出的折叠成 `more` 行。
 */
export function buildRunAnythingRows(
  configs: Array<{ name: string; type?: string }>,
  query: string,
  history: RunAnythingCandidate[] = loadRunAnythingHistory(),
  options: RunAnythingRowsOptions = {},
  providers: readonly RunAnythingProvider[] = runAnythingProviders(),
): RunAnythingRow[] {
  const text = query.trim()
  const expanded = new Set(options.expanded ?? [])
  const recent: RunAnythingRow[] = []
  const general: RunAnythingRow[] = []
  const commandRows: RunAnythingRow[] = []
  const needle = text.toLowerCase()
  const scoreOf = (name: string): number => {
    if (!needle) return 0
    const index = name.toLowerCase().indexOf(needle)
    // 前缀命中优先，其次按命中位置靠前排序；两个字段都不需要高亮下标（列表整名显示）。
    return index < 0 ? -1 : index === 0 ? 2 : 1 / (index + 1)
  }
  for (const entry of history) {
    const score = scoreOf(entry.name)
    if (score < 0) continue
    // 行名保留原文（历史回写与执行都用它），多行的显示折叠在渲染侧做。
    recent.push({
      ...entry,
      kind: 'history',
      detail: `最近 · ${entry.detail}`,
      score,
      indices: [],
      group: 'recent',
      sourceKind: entry.kind === 'command' ? 'command' : 'config',
    })
  }
  // 候选来自 EP 上的供给方（bundled：运行配置 + 命令行；第三方按同一 EP id 挂）。
  const context: RunAnythingProviderContext = { configs, query: text, command: commandFromQuery(text), history }
  for (const provider of providers) {
    const isCommand = provider.group === 'command'
    for (const candidate of provider.getValues(context)) {
      // 命令行那一档不过查询过滤（它本身就是把输入当命令跑，上游同口径）。
      const score = isCommand ? 0 : scoreOf(candidate.name)
      if (score < 0) continue
      const row: RunAnythingRow = { ...candidate, score, indices: [], group: provider.group }
      if (provider.group === 'general') general.push(row)
      else if (provider.group === 'command') commandRows.push(row)
      else recent.push({ ...row, kind: 'history', sourceKind: candidate.kind === 'command' ? 'command' : 'config' })
    }
  }
  const rank = (rows: RunAnythingRow[]) => rows.sort((left, right) =>
    right.score - left.score || left.name.length - right.name.length || left.name.localeCompare(right.name))
  rank(recent)
  rank(general)
  return dedupe([
    ...capGroup('recent', recent, expanded.has('recent')),
    ...capGroup('general', general, expanded.has('general')),
    ...commandRows,
  ])
}

/** 同名同类型只留第一条（历史与配置可能撞名）。 */
function dedupe(rows: RunAnythingRow[]): RunAnythingRow[] {
  const seen = new Set<string>()
  const out: RunAnythingRow[] = []
  for (const row of rows) {
    const key = itemKey(row)
    if (seen.has(key)) continue
    seen.add(key)
    out.push(row)
  }
  return out
}

// bundled：运行配置与命令行两条供给方按上游 plugin.xml 的 `<com.intellij.runAnything.executionProvider/>`
// 形态登记在 EP 上；第三方按同一 EP id 挂的 provider 由 `buildRunAnythingRows` 合并。
declareRunAnythingProviderExtensionPoint()
for (const provider of [RUN_CONFIGURATION_PROVIDER, COMMAND_LINE_PROVIDER])
  EXTENSIONS.registerExtension(RUN_ANYTHING_PROVIDER_EP, provider.id, provider, { source: 'bundled' })
