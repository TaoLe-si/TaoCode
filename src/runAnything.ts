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
// **明确不做**（上游有、本子集没有）：Gradle/Maven 任务作为一等候选（上游是
// `RunAnythingProvider` 插件点，本仓运行面板已有任务树）、上下文目录选择（`RunAnythingContext`）、
// 图标/快捷键提示列。

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
): RunAnythingRow[] {
  const text = query.trim()
  const expanded = new Set(options.expanded ?? [])
  const configsList = configs.map(configCandidate)
  const recent: RunAnythingRow[] = []
  const general: RunAnythingRow[] = []
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
  for (const config of configsList) {
    const score = scoreOf(config.name)
    if (score < 0) continue
    general.push({ ...config, score, indices: [], group: 'general' })
  }
  const rank = (rows: RunAnythingRow[]) => rows.sort((left, right) =>
    right.score - left.score || left.name.length - right.name.length || left.name.localeCompare(right.name))
  rank(recent)
  rank(general)
  const command = commandFromQuery(text)
  const commandRows: RunAnythingRow[] = command
    ? [{ kind: 'command', name: command, detail: '在项目根目录运行命令', score: 0, indices: [], group: 'command' }]
    : []
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
