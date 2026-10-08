// 问题面板的视图状态持久化 —— 上游 `ProblemsViewState`
// （`platform/problemsView/ui/src/com/intellij/analysis/problemsView/toolWindow/ProblemsViewState.kt:15-59`，
//   `@State(name = "ProblemsViewState", storages = [Storage(WORKSPACE_FILE)])`）
// 重开工具窗口时恢复上次的取向。
//
// 本仓的等价物：落 `localStorage`，面板挂载时读回。逐字段对照：
//   · `hideBySeverity`     → `hiddenSeverities`（被藏起来的严重度，勾选 = 显示）
//   · `sortFoldersFirst`   → 同名（默认 **true**，`:29`；比较器第一个参数，
//     `ProblemsViewPanel.java:523-529` 把三个开关一起递进去）
//   · `sortBySeverity`     → 同名（默认 `true`，`:30`）
//   · `sortByName`         → 同名（默认 `false`，`:31`）
//   · `groupByToolId`      → `grouping`（上游是一个开关，本仓与另几档统一成下拉）：
//     选中 `'inspection'` 就是上游那个开关的等价物（键 = 检查项身份，见 src/inspectionIdentity.ts），
//     `'source'`/`'code'` 是本仓把同一份身份拆成两列后各给的一档，
//     `'severity'` 承接的是 Inspect Code Results 那个同名开关
//     （`AnalysisUIOptions.java:37,70-93`，本仓的档清单与上游坐标见 `src/problemsView.ts` 的头注）。
//   · `collapsedGroups`    → **本仓多出来的**：上游的展开态是 `JTree` 的运行时对象
//     （`ProblemsViewPanel.java:212` `new Tree(new AsyncTreeModel(...))`）没有落进 `ProblemsViewState`，
//     本仓的树要能跨会话记住谁折着，就得给它一个可序列化的家。
// **每工程一份**（2026-10-08 lane daemon 补）：上游客是 `@Service(Service.Level.PROJECT)`
// `ProblemsViewStateManager`、存档走 `Storage(StoragePathMacros.WORKSPACE_FILE)`
// （`ProblemsViewState.kt:61-62`）⇒ 换工程看到的是**另一份**取向，不是把上一个工程的取向带过来。
// 本仓的落点 = 存档键按工作区根分桶，复用 `src/agentSessions.ts:210` 的 `storageKeyForProject`
// 归一化口径（与 `src/agentComposerDrafts.ts` 同一套键空间；没有工作区时退回裸键）。
// 旧版只有一份全局存档：第一次按工程读时把它**过继**给当前工程（读走 + 删掉全局键），
// 否则以后每开一个新工程都会继承上一个工程的取向（那正是上游没有的行为）。
//
// 没有承接的上游字段：`showPreview`（预览窗格在本仓没有消费面）、`proportion`（分隔比例归 App.vue
// 的布局）、`selectedTabId`（只有一个面板），以及 **`autoscrollToSource`**（`:25` 默认 false；消息窗口
// 同族的 `impl/ErrorTreeViewConfiguration.java:16,24,28` 是同一格的另一份）。这一条不是"做不到"而是
// **还接不动**：上游那格的触发点是**树的选中在行之间移动**（`ProblemsViewPanel.java:106-110` 的
// `mySelectionAlarm` → `:465-477 updateAutoscroll()`，书签那一族在本仓已经有可照抄的形态：
// `src/bookmarksView.ts:80` 的"键盘上下移动选中" + `src/components/BookmarksPanel.vue:184` 的跳转），
// 而问题面板的行只有 `tabindex="0"`（Tab 逐行走），没有 ↑/↓ 光标 —— 先给一个开关就会让"Tab 过一行
// 就把编辑器跳一次"，那是自造的语义。⇒ 要接就得连 ↑/↓ 导航一起接，见
// `docs/wiring-requests-2026-10-06-errtree.md` E1（含 `ProblemsPanel.vue` 的余量账）。
//
// 非法/损坏的存档逐字段回默认，不让一个坏字符串把面板卡死；旧版存档里的单选 `severity`
// 会在解析时迁移成隐藏集合（单选「只看警告」= 除警告外全藏）。
import { PROBLEM_GROUPINGS, PROBLEM_SEVERITIES, type ProblemGrouping, hiddenSeveritiesFor } from './problemsView.ts'
// 工作区存储键的归一化口径（`<base>.project.<encodeURIComponent(根路径)>`）：
// 与 `src/agentComposerDrafts.ts` 共用同一份实现，不在本模块再写一遍编码规则。
import { storageKeyForProject } from './agentSessions.ts'

export interface ProblemsPanelState {
  /** 被隐藏的严重度（空 = 全显示）。上游 `hideBySeverity` 的形状。 */
  hiddenSeverities: number[]
  /** 上游 `ProblemsViewState.kt:29`（默认 **true**）：同层的目录组排在本层文件组之前。 */
  sortFoldersFirst: boolean
  sortBySeverity: boolean
  sortByName: boolean
  grouping: ProblemGrouping
  query: string
  /** 折起来的组键（`groupProblems` 的 `key`）。空的/不存在的键渲染时忽略。 */
  collapsedGroups: string[]
}

export const DEFAULT_PROBLEMS_PANEL_STATE: ProblemsPanelState = {
  hiddenSeverities: [], sortFoldersFirst: true, sortBySeverity: true, sortByName: false,
  grouping: 'none', query: '', collapsedGroups: [],
}

const STORAGE_KEY = 'taocode.problemsPanel'
// 分组档的白名单直接取 `src/problemsView.ts` 的 `PROBLEM_GROUPINGS`（面板下拉也只有这些值）。
// 以前这里手写一份清单，漏一档就会让存档被 `includes` 判掉、静默退回 `none`（`code` 那档踩过）。
const GROUPINGS: readonly ProblemGrouping[] = PROBLEM_GROUPINGS

/**
 * 这份状态在**哪个工程**下（上游是工程级服务实例，见文件头）：
 * `projectRoot` 为空 = 没有打开工作区，退回裸键（旧行为逐字不变）。
 */
export function problemsPanelStorageKey(projectRoot?: string): string {
  return storageKeyForProject(STORAGE_KEY, projectRoot)
}

/** 只收四档里的、去重排序后的严重度。 */
function parseHiddenSeverities(raw: unknown): number[] {
  if (!Array.isArray(raw)) return []
  return PROBLEM_SEVERITIES.filter(severity => raw.includes(severity))
}

function parseCollapsedGroups(raw: unknown): string[] {
  if (!Array.isArray(raw)) return []
  return [...new Set(raw.filter((key): key is string => typeof key === 'string' && key !== ''))]
}

/**
 * 从 JSON 值解析状态：字段逐个校验，坏字段回默认（不整份丢）。
 * 旧存档的单选 `severity` 迁移成隐藏集合；新存档里 `hiddenSeverities` 优先。
 */
export function parseProblemsPanelState(value: unknown): ProblemsPanelState {
  if (!value || typeof value !== 'object') return { ...DEFAULT_PROBLEMS_PANEL_STATE }
  const raw = value as Partial<Record<keyof ProblemsPanelState, unknown>> & { severity?: unknown }
  const defaults = DEFAULT_PROBLEMS_PANEL_STATE
  const hiddenSeverities = raw.hiddenSeverities === undefined
    ? hiddenSeveritiesFor(raw.severity as number | null | undefined)
    : parseHiddenSeverities(raw.hiddenSeverities)
  return {
    hiddenSeverities,
    sortFoldersFirst: typeof raw.sortFoldersFirst === 'boolean' ? raw.sortFoldersFirst : defaults.sortFoldersFirst,
    sortBySeverity: typeof raw.sortBySeverity === 'boolean' ? raw.sortBySeverity : defaults.sortBySeverity,
    sortByName: typeof raw.sortByName === 'boolean' ? raw.sortByName : defaults.sortByName,
    grouping: GROUPINGS.includes(raw.grouping as ProblemGrouping) ? raw.grouping as ProblemGrouping : defaults.grouping,
    query: typeof raw.query === 'string' ? raw.query : defaults.query,
    collapsedGroups: parseCollapsedGroups(raw.collapsedGroups),
  }
}

/** 读一个键：缺席与坏值都回 `null`（坏值不当成「有一份空的」）。 */
function readStored(key: string): ProblemsPanelState | null {
  try {
    const raw = typeof localStorage === 'undefined' ? null : localStorage.getItem(key)
    return raw === null ? null : parseProblemsPanelState(JSON.parse(raw))
  } catch {
    return null
  }
}

/**
 * 读回**某个工程**的取向（上游 `ProblemsViewStateManager` 的工程级实例，见文件头）。
 * 该工程还没有存档、而旧版那份**全局**存档还在时，把它过继给当前工程（一次性迁移）——
 * 迁移只发生在真有工作区时，过继完就把全局键删掉，免得下一个工程再继承一次。
 * 没有工作区（`projectRoot` 空）= 裸键，行为与本轮之前逐字一致。
 */
export function loadProblemsPanelState(projectRoot?: string): ProblemsPanelState {
  const key = problemsPanelStorageKey(projectRoot)
  const own = readStored(key)
  if (own !== null) return own
  if (key === STORAGE_KEY) return { ...DEFAULT_PROBLEMS_PANEL_STATE }
  const legacy = readStored(STORAGE_KEY)
  if (legacy === null) return { ...DEFAULT_PROBLEMS_PANEL_STATE }
  saveProblemsPanelState(legacy, projectRoot)
  try {
    if (typeof localStorage !== 'undefined') localStorage.removeItem(STORAGE_KEY)
  } catch {
    // 删不掉只影响"下一个工程不会再继承一次"这条，当前取向已经拿到，不因此报错。
  }
  return legacy
}

export function saveProblemsPanelState(state: ProblemsPanelState, projectRoot?: string): void {
  try {
    if (typeof localStorage !== 'undefined')
      localStorage.setItem(problemsPanelStorageKey(projectRoot), JSON.stringify(parseProblemsPanelState(state)))
  } catch {
    // 存储不可用时只影响持久化，当前会话内的取向照常生效。
  }
}
