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

export function loadProblemsPanelState(): ProblemsPanelState {
  try {
    const raw = typeof localStorage === 'undefined' ? null : localStorage.getItem(STORAGE_KEY)
    return parseProblemsPanelState(raw ? JSON.parse(raw) : null)
  } catch {
    return { ...DEFAULT_PROBLEMS_PANEL_STATE }
  }
}

export function saveProblemsPanelState(state: ProblemsPanelState): void {
  try {
    if (typeof localStorage !== 'undefined') localStorage.setItem(STORAGE_KEY, JSON.stringify(parseProblemsPanelState(state)))
  } catch {
    // 存储不可用时只影响持久化，当前会话内的取向照常生效。
  }
}
