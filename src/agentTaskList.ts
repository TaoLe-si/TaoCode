// Agent 任务管理面：侧栏任务列表的分区编排、分组、排序、归档、置顶、搜索与批量删除。
//
// 为什么单独一个模块：`src/agentSessions.ts` 只管「会话库里有哪些会话、当前是哪个」，
// 不管「这些会话在侧栏里怎么排、哪些置顶、哪些归档、按什么分组」。ZCode 把这两层分得很清：
// tasks-index 持有 pinned / archived 列与分组结构，sessions-index 只补实时 activity。
// 本仓的会话库就是任务行，管理面单独落在本文件，**不重复** `agentSessions.ts` 的任何 CRUD ——
// 任务行由它给，本模块只叠一层成员关系（pinned/archived/unread/status/group）与编排规则。
// 纯逻辑、零 Vue、零存储：落盘由调用方按自己的口径做，这里只出规则与结果。
//
// 逐条来源（行号以打开时为准，全部在 `.tools/ZCode`，相对 `packages/`）：
//   字段 `shared/src/zcode-task-types-core.ts:264-345`；视图模式 `ui/src/WorkspaceSidebar.tsx:207-221`；
//   工具栏可见位同文件 `:875-877`、`:1098-1120`；分区顺序/可见 `:610-616`、`:1361-1640`；
//   排序 `ui/src/lib/taskListOrdering.ts:12-71`；时间线分桶 `ui/src/lib/taskTimelineGroups.ts:36-133`；
//   分组视图 `ui/src/lib/buildGroupedTaskViewFromSessions.ts:43-194`；分组形状/颜色 `services/src/session/zcodeTaskListTypes.ts:31-73`；
//   系统组 `ui/src/workspace-grouped-tasks/group-title.ts:4-11`、`group-item.tsx:136-139`；
//   自动归档 `services/src/session/taskIndexRepo.ts:872-945` + 设置门 `services/src/zcode-agent/zcodeTaskServiceAdapter.ts:1083-1101`；
//   成员过滤 `services/src/session/taskIndexRepo.ts:1810-1848`；批量删除 `ui/src/DeleteAllArchivedTasksButton.tsx`、
//   `ui/src/lib/archivedTaskDeletion.ts`；搜索/摘要 `services/src/session/taskIndexRepo.ts:305-357`、`:1825-1833`；
//   文案全部取 `ui/src/i18n/locales/zh-CN.ts` 原文（键名即 i18n id，行号见 COPY）。
import { type AgentSessionRecord } from './agentSessions.ts'
import { TASK_AUTO_ARCHIVE_DAY_OPTIONS } from './agentSettings.ts'

/** 时间线/归档/置顶三个平铺列表的首屏条数与「显示更多」阶梯（各 Section 的 `collapsedLimit = 20`）。 */
export const TASK_LIST_COLLAPSED_LIMIT = 20

/** 项目视图每个 workspace 的首屏条数 `WORKSPACE_TASK_PAGE_SIZE`（`ui/src/lib/workspaceTaskPagination.ts:3`）。 */
export const WORKSPACE_TASK_PAGE_SIZE = 5

/** 自动归档天数档位，直接取设置模块的同一份真源。 */
export const TASK_ARCHIVE_DAY_OPTIONS = TASK_AUTO_ARCHIVE_DAY_OPTIONS

/** 搜索摘要半径（`taskIndexRepo.ts:151-154`）。 */
export const TASK_SEARCH_SNIPPET_PREFIX_RADIUS = 20
export const TASK_SEARCH_SNIPPET_SUFFIX_RADIUS = 72
export const TASK_SEARCH_SNIPPET_MAX_CHARS = 140
export const TASK_SEARCH_SNIPPET_LIMIT = 4

/** 一天毫秒数（`taskTimelineGroups.ts:3`、`archiveStaleTasks` 的 cutoff）。 */
const DAY_MS = 24 * 60 * 60 * 1000

/** 分组缺序补序步长 `GROUPED_TASK_ORDER_STEP`（`buildGroupedTaskViewFromSessions.ts:18`）。 */
const GROUPED_TASK_ORDER_STEP = 1000

/** 文案表。逐键取 zh-CN 原文，键名即 ZCode 的 i18n id（括号给行号）。只收本模块真的会产出的键。 */
export const TASK_LIST_COPY = {
  /** zh-CN.ts:1540 */ toggleArchivedTasks: '归档',
  /** zh-CN.ts:1731 / :1732 */ noTasks: '暂无任务', noArchivedTasks: '暂无归档任务',
  /** zh-CN.ts:1735 / :1736 */ showMore: '显示更多', showLess: '显示更少',
  /** zh-CN.ts:1737 */ pinnedSection: '已置顶',
  /** zh-CN.ts:1740-1743 / :1747 / :1751 */
  pin: '置顶任务', unpin: '取消置顶任务', rename: '重命名任务', archive: '归档任务',
  unarchive: '取消归档任务', markAsUnread: '标记为未读',
  /** zh-CN.ts:1739 */ delete: '删除任务',
  /** zh-CN.ts:1769 / :1730 */ untitled: '新任务', forkedUntitled: '新任务',
  /** zh-CN.ts:1787-1788 / :6076 */ newGroup: '新建分组', cronGroupName: '定时任务', offPeakGroupName: '闲时任务',
  /** zh-CN.ts:1791-1797 分组颜色 */
  colorGray: '灰色', colorRed: '红色', colorOrange: '橙色', colorYellow: '黄色',
  colorGreen: '绿色', colorBlue: '蓝色', colorPurple: '紫色',
  /** zh-CN.ts:1806-1813 时间线分组标题 */
  timelineToday: '今天', timelineYesterday: '昨天', timelineThisWeek: '本周', timelineLastWeek: '上周',
  timelineThisMonth: '本月', timelineLastMonth: '上月', timelineOlder: '更早',
  /** zh-CN.ts:485 / :490-492 批量删除归档（{count}/{deleted}/{skipped}/{failed}/{projects} 为占位符） */
  archivedTaskDeleteDescription: '任务将从任务列表和归档列表中移除。',
  deleteAllArchivedTitle: '删除 {count} 个归档任务？',
  deleteAllArchived: '删除所有归档任务',
  deleteAllArchivedResult: '已删除 {deleted} 个，跳过 {skipped} 个，失败 {failed} 个。',
  deleteAllArchivedUnavailable: '以下项目暂时无法处理：{projects}。连接恢复后可再次操作。',
} as const

/** 分组可选颜色，顺序与 `TASK_GROUP_COLORS` 一致（`workspace-grouped-tasks/types.ts:8-16`）。 */
export const TASK_GROUP_COLORS = ['gray', 'red', 'orange', 'yellow', 'green', 'blue', 'purple'] as const
export type AgentTaskGroupColor = (typeof TASK_GROUP_COLORS)[number]

/** ZCode 默认分组色 `DEFAULT_TASK_GROUP_COLOR = "gray"`（`taskIndexRepo.ts:157`）。 */
export const DEFAULT_TASK_GROUP_COLOR: AgentTaskGroupColor = 'gray'

/** 系统分组 id（`packages/shared/src/zcode-task-types.ts:46`、`:49`）。 */
export const CRON_DEFAULT_GROUP_ID = 'zcode-default-group-cron'
export const OFF_PEAK_DEFAULT_GROUP_ID = 'zcode-default-group-off-peak'

/** 时间线分组类型（`taskTimelineGroups.ts:5-13`）。 */
export type AgentTimelineGroupKind =
  | 'today' | 'yesterday' | 'daysAgo' | 'thisWeek' | 'lastWeek' | 'thisMonth' | 'lastMonth' | 'older'

export interface AgentTimelineGroupKey {
  kind: AgentTimelineGroupKind
  daysAgo?: number
}

/** 视图模式（`WorkspaceSidebar.tsx:161` 的 `SidebarTaskViewMode`）。 */
export type AgentTaskViewMode = 'grouped' | 'workspace' | 'timeline' | 'archived'

/** 一级组织方式（`lib/sidebarTaskPreferences.ts:4`）。 */
export type AgentTaskOrganizeBy = 'grouped' | 'project' | 'chronological'
export type AgentTaskSortBy = 'created' | 'updated'

/** 一级 Tab 只有两个值（`WorkspaceSidebar.tsx:160` 的 `PrimaryTaskMode`）。 */
export type AgentPrimaryTaskMode = 'workspace' | 'grouped'

/** 任务持久状态（`zcode-task-types-core.ts:173`）。 */
export type AgentTaskStatus = 'running' | 'completed' | 'error'

/** 工作区用途（`packages/shared/src/workspacePurpose.ts:2`）。 */
export type AgentWorkspacePurpose = 'project' | 'conversation'

/** 侧栏一行任务。字段名照 `ZCodeTaskMeta`（`zcode-task-types-core.ts:264-345`）里任务管理面用得到
 * 的那批；时间戳保持 epoch 毫秒（会话库那份 ISO 由 `taskFromSession` 换算）。 */
export interface AgentTaskRecord {
  /** `taskId`（`:266`）—— 本仓等于会话库 `id`；`title`（`:270`）等于会话库 `name`。 */
  taskId: string
  title: string
  /** `workspacePath`（`:279`）/ `workspaceIdentity`（`:286`，同路径不同远端主机的隔离键）/ `workspacePurpose`（`:288`，缺省 project）。 */
  workspacePath: string
  workspaceIdentity?: string
  workspacePurpose?: AgentWorkspacePurpose
  /** `createdAt` / `updatedAt`（`:289-290`），epoch 毫秒。 */
  createdAt: number
  updatedAt: number
  /** `status`（`:331`，自动归档要 `completed`）/ `unreadAt`（`:329`，非 null 即未读，自动归档排除项）。 */
  status?: AgentTaskStatus
  unreadAt?: number
  /** `forkedFromTaskId`（`:327`）—— 无标题时走 `forkedUntitled` 文案。 */
  forkedFromTaskId?: string
  /** tasks-index 的 `pinned` / `archived` 列（`queryTaskList`，`taskIndexRepo.ts:1818-1824`）。 */
  pinned: boolean
  archived: boolean
  /** 分组归属（无归属即顶层节点）/ `sortOrder`（`zcodeTaskListTypes.ts:63`、`:68`）/ `addedAt`（`:70`/`:95`，缺序时按它降序补序）。 */
  groupId?: string
  sortOrder?: number
  addedAt?: number
  /** 正文检索文本（`searchable_text`，`taskIndexRepo.ts:78`）；命中摘要从它切窗。 */
  searchableText?: string
}

/** 手动分组（`ZCodeTaskGroup`，`zcodeTaskListTypes.ts:40-46`）。 */
export interface AgentTaskGroup {
  id: string
  title: string
  color: AgentTaskGroupColor
  createdAt: number
  updatedAt: number
  /** 顶层节点排序位（`zcodeTaskListTypes.ts:63` 的 `sortOrder`）。 */
  sortOrder?: number
}

/** 分组顶层节点（`ZCodeGroupedTaskViewNode`，`zcodeTaskListTypes.ts:58-69`）。 */
export type AgentGroupedNode =
  | { type: 'group'; group: AgentTaskGroup; tasks: AgentTaskRecord[]; sortOrder?: number }
  | { type: 'task'; task: AgentTaskRecord; sortOrder?: number }

/** 侧栏一个分区的编排结果（渲染顺序见 `WorkspaceSidebar.tsx:1361-1640`）。 */
export interface AgentSidebarSection {
  id: 'pinned' | AgentTaskViewMode
  title: string | null
  visible: boolean
  tasks: AgentTaskRecord[]
}

/** 任务显示标题：空标题按 fork 与否走 `forkedUntitled` / `untitled`（`TaskListItem.tsx:245-249`）。 */
export function taskDisplayTitle(task: Pick<AgentTaskRecord, 'title' | 'forkedFromTaskId'>): string {
  if (task.title.trim()) return task.title
  return task.forkedFromTaskId ? TASK_LIST_COPY.forkedUntitled : TASK_LIST_COPY.untitled
}

/** 从会话库一行叠出一行任务。时间戳换算是**边界**：`AgentSessionRecord` 用 ISO（`agentSessions.ts:26-32`），
 * ZCode 用 epoch 毫秒（`zcode-task-types-core.ts:289-290`），排序谓词按毫秒算；坏时间戳给 NaN。 */
export function taskFromSession(
  session: AgentSessionRecord,
  meta: {
    pinned?: boolean
    archived?: boolean
    unreadAt?: number
    status?: AgentTaskStatus
    groupId?: string
    sortOrder?: number
  } | undefined,
  options: { workspacePath: string; workspaceIdentity?: string; workspacePurpose?: AgentWorkspacePurpose },
): AgentTaskRecord {
  return {
    taskId: session.id,
    title: session.name,
    workspacePath: options.workspacePath,
    ...(options.workspaceIdentity ? { workspaceIdentity: options.workspaceIdentity } : {}),
    ...(options.workspacePurpose ? { workspacePurpose: options.workspacePurpose } : {}),
    createdAt: Date.parse(session.createdAt),
    updatedAt: Date.parse(session.updatedAt),
    ...(meta?.status ? { status: meta.status } : {}),
    ...(typeof meta?.unreadAt === 'number' ? { unreadAt: meta.unreadAt } : {}),
    pinned: meta?.pinned === true,
    archived: meta?.archived === true,
    ...(meta?.groupId ? { groupId: meta.groupId } : {}),
    ...(typeof meta?.sortOrder === 'number' ? { sortOrder: meta.sortOrder } : {}),
    addedAt: Date.parse(session.createdAt),
    // 正文检索文本 = 会话名 + 全部转写正文，对齐 ZCode 的 `searchable_text`（title 之外还有正文）。
    searchableText: [session.name, ...session.entries.map(entry => entry.text)].join('\n'),
  }
}

// ── 成员关系转换（pinned / archived / group 归属）──────────────────────────────
// ZCode 的写入口是 `setTaskPinned` / `archiveTask` / `unarchiveTask` / `archiveStaleTasks`
// （`services/src/session/zcodeTaskService.ts:666-695`、`taskIndexRepo.ts:929-944`）。
// 这里只算新值，落盘由调用方做。

/** 置顶切换：只改 `pinned`，其余字段与顺序不动（`setTaskPinned`）。 */
export function withTaskPinned(
  tasks: readonly AgentTaskRecord[],
  taskId: string,
  pinned: boolean,
): AgentTaskRecord[] {
  return tasks.map(task => (task.taskId === taskId ? { ...task, pinned } : task))
}

/** 批量归档（`archiveStaleTasks` 的 UPDATE archived = 1）。返回改动的条数由调用方 diff。 */
export function withTasksArchived(
  tasks: readonly AgentTaskRecord[],
  taskIds: readonly string[],
): AgentTaskRecord[] {
  const target = new Set(taskIds)
  return tasks.map(task => (target.has(task.taskId) ? { ...task, archived: true } : task))
}

/** 取消归档（`unarchiveTask`）：`archived=false`，重新回到默认列表。 */
export function withTaskUnarchived(
  tasks: readonly AgentTaskRecord[],
  taskId: string,
): AgentTaskRecord[] {
  return tasks.map(task => (task.taskId === taskId ? { ...task, archived: false } : task))
}

/** 标记未读 / 清除未读（`setTaskUnread`，`:673-681`）：非 null 即未读，自动归档排除项。 */
export function withTaskUnread(
  tasks: readonly AgentTaskRecord[],
  taskId: string,
  unread: boolean,
  at: number,
): AgentTaskRecord[] {
  return tasks.map(task => {
    if (task.taskId !== taskId) return task
    const next = { ...task }
    if (unread) next.unreadAt = at
    else delete next.unreadAt
    return next
  })
}

/** 分组归属（`moveTaskByMenu` / `moveTaskToTopByMenu` 的成员侧，`workspace-grouped-tasks/view.ts:504-561`）。 */
export function withTaskGroup(
  tasks: readonly AgentTaskRecord[],
  taskId: string,
  groupId: string | undefined,
): AgentTaskRecord[] {
  return tasks.map(task => {
    if (task.taskId !== taskId) return task
    const next = { ...task }
    if (groupId) next.groupId = groupId
    else delete next.groupId
    return next
  })
}

// ── 排序（`ui/src/lib/taskListOrdering.ts`）──────────────────────────────────────────

/** `right.taskId.localeCompare(left.taskId)` 的原样转写（`:24`、`:33`、`:60`）。 */
function compareIdsDesc(rightId: string, leftId: string): number {
  return rightId.localeCompare(leftId)
}

/** 两层排序：**运行层整体置顶**，层内按 createdAt 降序、taskId 降序（禁用 updatedAt 决胜，否则流式
 * 事件会让两行互换）；非运行层服从时间偏好。对齐 `compareTaskListItemsWithRunningFirst`（`taskListOrdering.ts:44-63`）。 */
export function compareAgentTasks(
  left: AgentTaskRecord,
  right: AgentTaskRecord,
  sortBy: AgentTaskSortBy,
  isRunning: (task: AgentTaskRecord) => boolean,
): number {
  const leftRunning = isRunning(left)
  const rightRunning = isRunning(right)
  if (leftRunning !== rightRunning) return leftRunning ? -1 : 1
  if (leftRunning) {
    if (right.createdAt !== left.createdAt) return right.createdAt - left.createdAt
    return compareIdsDesc(right.taskId, left.taskId)
  }
  if (sortBy === 'created') {
    if (right.createdAt !== left.createdAt) return right.createdAt - left.createdAt
    if (right.updatedAt !== left.updatedAt) return right.updatedAt - left.updatedAt
    return compareIdsDesc(right.taskId, left.taskId)
  }
  if (right.updatedAt !== left.updatedAt) return right.updatedAt - left.updatedAt
  if (right.createdAt !== left.createdAt) return right.createdAt - left.createdAt
  return compareIdsDesc(right.taskId, left.taskId)
}

/** 运行层判定。ZCode 只采信 sessions-index 实时 phase 或后台工作（`isTaskListRowActive`，
 * `v4/taskListRowActivity.ts:40-55`）；本仓无 sidecar，用持久 `status === 'running'` 作唯一证据。 */
export function defaultIsTaskRunning(task: AgentTaskRecord): boolean {
  return task.status === 'running'
}

/** 按 `compareAgentTasks` 排序的副本；不原地改入参。 */
export function sortAgentTasks(
  tasks: readonly AgentTaskRecord[],
  sortBy: AgentTaskSortBy,
  isRunning: (task: AgentTaskRecord) => boolean = defaultIsTaskRunning,
): AgentTaskRecord[] {
  return [...tasks].sort((left, right) => compareAgentTasks(left, right, sortBy, isRunning))
}

// ── 视图模式与分区编排（`ui/src/WorkspaceSidebar.tsx`）────────────────────────────────

/** `resolveSidebarTaskViewMode`（`WorkspaceSidebar.tsx:207-221`）逐行照抄：归档开关优先 →
 * chronological 走时间线 → grouped 走分组 → 其余走项目视图。 */
export function resolveTaskViewMode(params: {
  showArchivedTasks: boolean
  organizeBy: AgentTaskOrganizeBy
}): AgentTaskViewMode {
  if (params.showArchivedTasks) return 'archived'
  if (params.organizeBy === 'chronological') return 'timeline'
  if (params.organizeBy === 'grouped') return 'grouped'
  return 'workspace'
}

/** 一级 Tab：grouped → grouped，其余归 workspace（`WorkspaceSidebar.tsx:872-873`）。 */
export function resolvePrimaryTaskMode(organizeBy: AgentTaskOrganizeBy): AgentPrimaryTaskMode {
  return organizeBy === 'grouped' ? 'grouped' : 'workspace'
}

/** 项目视图下的二级选择值：chronological → chronological，其余 project（`:874`）。 */
export function resolveWorkspaceTaskViewValue(
  organizeBy: AgentTaskOrganizeBy,
): 'project' | 'chronological' {
  return organizeBy === 'chronological' ? 'chronological' : 'project'
}

/** 工具栏可见位（`WorkspaceSidebar.tsx:875-877`、`:1098-1120`）：`showTaskViewFilter` = 一级 workspace
 * **或**归档态；`showWorkspaceViewOptions` = 一级 workspace 且**非**归档；`showTaskSortOptions` =
 * 一级 workspace **或**归档态；`showNewGroup` = 分组视图独有的「新建分组」按钮。 */
export function resolveTaskToolbarVisibility(mode: AgentTaskViewMode): {
  showTaskViewFilter: boolean
  showWorkspaceViewOptions: boolean
  showTaskSortOptions: boolean
  showNewGroup: boolean
} {
  const primary = mode === 'grouped' ? 'grouped' : 'workspace'
  const archived = mode === 'archived'
  return {
    showTaskViewFilter: primary === 'workspace' || archived,
    showWorkspaceViewOptions: primary === 'workspace' && !archived,
    showTaskSortOptions: primary === 'workspace' || archived,
    showNewGroup: mode === 'grouped',
  }
}

/** 置顶区可见条件（`WorkspaceSidebar.tsx:610-616`）：四种视图模式**全部**可见 —— 归档态也保持置顶区。 */
export function shouldShowPinnedTasks(_mode: AgentTaskViewMode): boolean {
  return true
}

/** 用途缺省 project（`lib/workspacePurpose.ts:4-6`：非 conversation 一律 project）。 */
function samePurpose(task: AgentTaskRecord, purpose: AgentWorkspacePurpose): boolean {
  return (task.workspacePurpose === 'conversation' ? 'conversation' : 'project') === purpose
}

/** 侧栏分区编排（`WorkspaceSidebar.tsx:1361-1640`）：工具栏之后先渲染置顶区，再渲染主体四选一
 * （archived / grouped / timeline / workspace）。返回**按渲染顺序**排好的分区；`visible=false` 的
 * 分区调用方不渲染。主体是 workspace 时按用途再分段，这里用 `purpose` 参数表达。 */
export function buildSidebarSections(params: {
  mode: AgentTaskViewMode
  tasks: readonly AgentTaskRecord[]
  sortBy: AgentTaskSortBy
  isRunning?: (task: AgentTaskRecord) => boolean
  purpose?: AgentWorkspacePurpose
}): AgentSidebarSection[] {
  const { mode, sortBy } = params
  const isRunning = params.isRunning ?? defaultIsTaskRunning
  const purpose = params.purpose ?? 'project'
  // 置顶区 = pinned 且未归档（`queryTaskList` pinned 分支，`taskIndexRepo.ts:1818-1819`）。
  const pinned = sortAgentTasks(
    params.tasks.filter(task => task.pinned && !task.archived && samePurpose(task, purpose)),
    sortBy,
    isRunning,
  )
  // 主体：pinned / archived 成员互斥（`:1818-1824`），各视图取各自子集。
  const active = sortAgentTasks(
    params.tasks.filter(task => !task.pinned && !task.archived && samePurpose(task, purpose)),
    sortBy,
    isRunning,
  )
  const archived = sortAgentTasks(
    params.tasks.filter(task => task.archived && samePurpose(task, purpose)),
    sortBy,
    isRunning,
  )
  return [
    {
      id: 'pinned',
      title: TASK_LIST_COPY.pinnedSection,
      visible: shouldShowPinnedTasks(mode) && pinned.length > 0,
      tasks: pinned,
    },
    { id: mode, title: null, visible: true, tasks: mode === 'archived' ? archived : active },
  ]
}

/** 工作区按用途分段（`partitionWorkspaceTabsByPurpose`，`ui/src/lib/workspacePurpose.ts:8-26`）。 */
export function partitionWorkspacesByPurpose<T extends { workspacePurpose?: AgentWorkspacePurpose }>(
  workspaces: readonly T[],
): { project: T[]; conversation: T[] } {
  const project: T[] = []
  const conversation: T[] = []
  for (const workspace of workspaces) {
    if (workspace.workspacePurpose === 'conversation') conversation.push(workspace)
    else project.push(workspace)
  }
  return { project, conversation }
}

// ── 时间线分组（`ui/src/lib/taskTimelineGroups.ts`）───────────────────────────

function startOfDay(timestamp: number): number {
  const date = new Date(timestamp)
  return new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime()
}

function startOfMonth(timestamp: number): number {
  const date = new Date(timestamp)
  return new Date(date.getFullYear(), date.getMonth(), 1).getTime()
}

/** 周起点：en-US 从周日，其余从周一（`taskTimelineGroups.ts:36-43`）。 */
function startOfWeek(timestamp: number, locale: string): number {
  const date = new Date(startOfDay(timestamp))
  const weekStartsOn = locale === 'en-US' ? 0 : 1
  date.setDate(date.getDate() - ((date.getDay() - weekStartsOn + 7) % 7))
  return date.getTime()
}

/** 一个时间戳落进哪个桶（`resolveTaskTimelineGroupKey`，`taskTimelineGroups.ts:45-86`）：today /
 * yesterday / daysAgo(≤3) / thisWeek / lastWeek / thisMonth / lastMonth / older。 */
export function resolveTimelineGroupKey(
  timestamp: number,
  now: number,
  locale: string,
): AgentTimelineGroupKey {
  const dayDiff = Math.floor((startOfDay(now) - startOfDay(timestamp)) / DAY_MS)
  if (dayDiff <= 0) return { kind: 'today' }
  if (dayDiff === 1) return { kind: 'yesterday' }
  if (dayDiff <= 3) return { kind: 'daysAgo', daysAgo: dayDiff }
  const itemDayStart = startOfDay(timestamp)
  const thisWeekStart = startOfWeek(now, locale)
  if (itemDayStart >= thisWeekStart) return { kind: 'thisWeek' }
  if (itemDayStart >= thisWeekStart - 7 * DAY_MS) return { kind: 'lastWeek' }
  if (itemDayStart >= startOfMonth(now)) return { kind: 'thisMonth' }
  const nowDate = new Date(now)
  const lastMonthStart = new Date(nowDate.getFullYear(), nowDate.getMonth() - 1, 1).getTime()
  if (itemDayStart >= lastMonthStart) return { kind: 'lastMonth' }
  return { kind: 'older' }
}

/** 桶序列化键：daysAgo 带天数，其余就是 kind（`serializeTaskTimelineGroupKey`，`:101-103`）。 */
export function timelineGroupKeyId(key: AgentTimelineGroupKey): string {
  return key.kind === 'daysAgo' ? `${key.kind}:${key.daysAgo ?? 0}` : key.kind
}

/** 桶标题文案（`getTaskTimelineGroupMessage`，`:88-99`；daysAgo 走 `{days} 天前`）。 */
export function timelineGroupLabel(key: AgentTimelineGroupKey): string {
  switch (key.kind) {
    case 'today': return TASK_LIST_COPY.timelineToday
    case 'yesterday': return TASK_LIST_COPY.timelineYesterday
    case 'daysAgo': return `${key.daysAgo ?? 0} 天前`
    case 'thisWeek': return TASK_LIST_COPY.timelineThisWeek
    case 'lastWeek': return TASK_LIST_COPY.timelineLastWeek
    case 'thisMonth': return TASK_LIST_COPY.timelineThisMonth
    case 'lastMonth': return TASK_LIST_COPY.timelineLastMonth
    default: return TASK_LIST_COPY.timelineOlder
  }
}

export interface AgentTimelineGroup {
  key: string
  label: AgentTimelineGroupKey
  tasks: AgentTaskRecord[]
}

/** 时间线分桶（`groupTaskTimelineItems`，`taskTimelineGroups.ts:105-133`）：分桶时间戳 = createdAt
 * （sortBy=created）或 updatedAt；保持入参顺序不重排（调用方先按 `sortAgentTasks` 排好）。 */
export function groupTasksByTimeline(
  tasks: readonly AgentTaskRecord[],
  options: { sortBy: AgentTaskSortBy; now: number; locale: string },
): AgentTimelineGroup[] {
  const groups: AgentTimelineGroup[] = []
  const byKey = new Map<string, AgentTimelineGroup>()
  for (const task of tasks) {
    const label = resolveTimelineGroupKey(
      options.sortBy === 'created' ? task.createdAt : task.updatedAt,
      options.now,
      options.locale,
    )
    const key = timelineGroupKeyId(label)
    const existing = byKey.get(key)
    if (existing) {
      existing.tasks.push(task)
      continue
    }
    const group: AgentTimelineGroup = { key, label, tasks: [task] }
    byKey.set(key, group)
    groups.push(group)
  }
  return groups
}

// ── 分组视图（手动分组，`ui/src/lib/buildGroupedTaskViewFromSessions.ts`）──────────────────

/** 分组标题：系统分组忽略 DB 占位标题，按语言本地化（`group-title.ts:4-11`）。 */
export function taskGroupDisplayTitle(group: Pick<AgentTaskGroup, 'id' | 'title'>): string {
  if (group.id === CRON_DEFAULT_GROUP_ID) return TASK_LIST_COPY.cronGroupName
  if (group.id === OFF_PEAK_DEFAULT_GROUP_ID) return TASK_LIST_COPY.offPeakGroupName
  return group.title
}

/** 系统分组（cron / 闲时）固定归类，禁止重命名与解散（`group-item.tsx:136-139`）。 */
export function isSystemTaskGroup(groupId: string): boolean {
  return groupId === CRON_DEFAULT_GROUP_ID || groupId === OFF_PEAK_DEFAULT_GROUP_ID
}

/** 分组名可改吗：系统组不行，空白名也不行（`renameTaskGroup` 的守卫，`TaskRenameDialog` 同口径）。 */
export function canRenameTaskGroup(groupId: string, title: string): boolean {
  return !isSystemTaskGroup(groupId) && title.trim().length > 0
}

/** 分组可解散吗：系统组不行（`ungroup` 对系统组关闭，`group-item.tsx:138-145`）。 */
export function canRemoveTaskGroup(groupId: string): boolean {
  return !isSystemTaskGroup(groupId)
}

/** 组内成员排序：有 sortOrder 用之；缺失的按 addedAt 降序在 max 之后补序（`:56-92`）。 */
function sortGroupTasks(tasks: readonly AgentTaskRecord[]): AgentTaskRecord[] {
  const resolvedOrder = new Map<string, number>()
  let maxOrder = 0
  const missing: Array<{ taskId: string; addedAt: number }> = []
  for (const task of tasks) {
    if (typeof task.sortOrder === 'number') {
      resolvedOrder.set(task.taskId, task.sortOrder)
      maxOrder = Math.max(maxOrder, task.sortOrder)
    } else {
      missing.push({ taskId: task.taskId, addedAt: task.addedAt ?? task.createdAt })
    }
  }
  missing.sort((left, right) =>
    right.addedAt !== left.addedAt ? right.addedAt - left.addedAt : left.taskId.localeCompare(right.taskId),
  )
  let nextOrder = maxOrder
  for (const entry of missing) {
    nextOrder += GROUPED_TASK_ORDER_STEP
    resolvedOrder.set(entry.taskId, nextOrder)
  }
  return [...tasks].sort((left, right) => {
    const leftOrder = resolvedOrder.get(left.taskId) ?? 0
    const rightOrder = resolvedOrder.get(right.taskId) ?? 0
    return leftOrder !== rightOrder ? leftOrder - rightOrder : left.taskId.localeCompare(right.taskId)
  })
}

function groupedNodeKey(node: AgentGroupedNode): string {
  return node.type === 'group' ? `group:${node.group.id}` : `task:${node.task.taskId}`
}

/** 顶层节点比较：先 sortOrder，再节点键（`compareGroupedNodes`，`:43-53`）。 */
function compareGroupedNodes(left: AgentGroupedNode, right: AgentGroupedNode): number {
  const leftOrder = left.sortOrder ?? 0
  const rightOrder = right.sortOrder ?? 0
  return leftOrder !== rightOrder
    ? leftOrder - rightOrder
    : groupedNodeKey(left).localeCompare(groupedNodeKey(right))
}

/** 由分组 + 任务拼出顶层节点（`buildGroupedTaskViewFromSessions`，`:108-194`）：1. **pinned / archived
 * 的 task 不进分组视图**（`:120-127`）；2. 任一组的成员都不出现在顶层（`:160-163`）；3. 顶层缺序节点
 * 按 createdAt 降序在 max 之后补序，最后按 sortOrder 排（`:173-193`）。分组是**手动**的。 */
export function buildGroupedNodes(
  groups: readonly AgentTaskGroup[],
  tasks: readonly AgentTaskRecord[],
): AgentGroupedNode[] {
  const groupIds = new Set(groups.map(group => group.id))
  const tasksByGroupId = new Map<string, AgentTaskRecord[]>()
  const topLevelTasks: AgentTaskRecord[] = []
  for (const task of tasks) {
    if (task.pinned || task.archived) continue
    const groupId = task.groupId && groupIds.has(task.groupId) ? task.groupId : null
    if (!groupId) {
      topLevelTasks.push(task)
      continue
    }
    const bucket = tasksByGroupId.get(groupId) ?? []
    bucket.push(task)
    tasksByGroupId.set(groupId, bucket)
  }
  const nodes: AgentGroupedNode[] = groups.map(group => ({
    type: 'group' as const,
    group,
    tasks: sortGroupTasks(tasksByGroupId.get(group.id) ?? []),
    ...(typeof group.sortOrder === 'number' ? { sortOrder: group.sortOrder } : {}),
  }))
  for (const task of topLevelTasks) {
    nodes.push({
      type: 'task',
      task,
      ...(typeof task.sortOrder === 'number' ? { sortOrder: task.sortOrder } : {}),
    })
  }
  const missing = nodes
    .filter(node => node.sortOrder === undefined)
    .sort((left, right) => {
      const leftCreated = left.type === 'group' ? left.group.createdAt : left.task.createdAt
      const rightCreated = right.type === 'group' ? right.group.createdAt : right.task.createdAt
      if (rightCreated !== leftCreated) return rightCreated - leftCreated
      return groupedNodeKey(left).localeCompare(groupedNodeKey(right))
    })
  let nextSortOrder = nodes.reduce((max, node) => Math.max(max, node.sortOrder ?? 0), 0)
  for (const node of missing) {
    nextSortOrder += GROUPED_TASK_ORDER_STEP
    node.sortOrder = nextSortOrder
  }
  return nodes.sort(compareGroupedNodes)
}

/** 分组列表的 group id 序列（`getGroupedTaskGroupIds`，`workspace-grouped-tasks/view.ts:170-172`）。 */
export function groupedTaskGroupIds(nodes: readonly AgentGroupedNode[]): string[] {
  return nodes.flatMap(node => (node.type === 'group' ? [node.group.id] : []))
}

// ── 自动归档（`taskIndexRepo.archiveStaleTasks` + 设置门）──────────────────────────────────

export interface AgentAutoArchiveConfig {
  enabled: boolean
  olderThanDays: number
}

/** 自动归档谓词，逐条对齐 `archiveStaleTasks` 的 WHERE（`taskIndexRepo.ts:879-889`）：`archived = 0` /
 * `pinned = 0` / `unread_at IS NULL` / `updated_at < cutoff` / `task_status = 'completed'`；
 * `cutoff = now - max(1, floor(days)) * 一天`，边界**严格早于**。`now` 注入时钟。 */
export function isAutoArchiveCandidate(
  task: AgentTaskRecord,
  olderThanDays: number,
  now: number,
): boolean {
  const cutoff = now - Math.max(1, Math.floor(olderThanDays)) * DAY_MS
  if (task.archived || task.pinned) return false
  if (typeof task.unreadAt === 'number') return false
  if (!(task.updatedAt < cutoff)) return false
  // 缺 status 的会话不满足 `task_status = 'completed'` —— 与 ZCode 的严格等值一致，不替它猜。
  return task.status === 'completed'
}

/** 设置门 + 候选挑选（`readTaskAutoArchiveConfig`，`zcodeTaskServiceAdapter.ts:1083-1101`）：开关关掉 →
 * 一步不动（返回空）；开着 → 天数缺省 7。阈值不合法（非有限 / ≤0）也一步不动。 */
export function selectAutoArchiveCandidates(
  tasks: readonly AgentTaskRecord[],
  config: AgentAutoArchiveConfig,
  now: number,
): AgentTaskRecord[] {
  if (!config.enabled) return []
  if (!Number.isFinite(config.olderThanDays) || config.olderThanDays <= 0) return []
  return tasks.filter(task => isAutoArchiveCandidate(task, config.olderThanDays, now))
}

/** 跑一轮自动归档（`runWorkspaceTaskAutoArchive`，`zcodeTaskServiceAdapter.ts:1103-1142`）：逐个挑候选
 * 并标 archived，返回归档后的任务行与实际条数；只改 `archived`，不动 pinned / unread / 分组归属。 */
export function runAutoArchive(
  tasks: readonly AgentTaskRecord[],
  config: AgentAutoArchiveConfig,
  now: number,
): { tasks: AgentTaskRecord[]; archivedCount: number } {
  const candidates = selectAutoArchiveCandidates(tasks, config, now)
  if (candidates.length === 0) return { tasks: [...tasks], archivedCount: 0 }
  return { tasks: withTasksArchived(tasks, candidates.map(task => task.taskId)), archivedCount: candidates.length }
}

// ── 批量删除归档（`ui/src/DeleteAllArchivedTasksButton.tsx` + `ui/src/lib/archivedTaskDeletion.ts`）──

export interface AgentArchivedDeletionTarget {
  workspacePath: string
  workspaceIdentity?: string
  taskId: string
}

/** 一个工作区的归档集合（`ArchivedTaskDeletionWorkspace`，`archivedTaskDeletion.ts:11-16`）。 */
export interface AgentArchivedDeletionWorkspace {
  workspacePath: string
  workspaceIdentity?: string
  label: string
  /** 读不到归档集合（服务不可用）时为 null —— 计入 unavailable，不静默漏掉。 */
  archivedTaskIds: string[] | null
}

export interface AgentArchivedDeletionSelection {
  targets: AgentArchivedDeletionTarget[]
  count: number
  /** 读不到集合的工作区标签，用于确认框的 unavailable 行（`:52-55`）。 */
  unavailableWorkspaces: string[]
}

/** workspaceKey = identity ?? path（`resolveWorkspaceStateKey`，`zcodeSessionStoreSelectors.ts:25-30`）。 */
export function taskWorkspaceKey(workspacePath: string, workspaceIdentity?: string): string {
  return workspaceIdentity?.trim() || workspacePath
}

/** 收集待删除的归档任务（`collectArchivedTaskDeletion`，`:18-56`）：按 workspaceKey 去重、taskId 去重、
 * **直接读完整归档集合**（不能用 UI 已折叠/过滤的 items）。读不到的工作区给 null，计入 unavailable。 */
export function collectArchivedDeletion(
  workspaces: readonly AgentArchivedDeletionWorkspace[],
): AgentArchivedDeletionSelection {
  const unique = new Map<string, AgentArchivedDeletionWorkspace>()
  for (const workspace of workspaces) {
    unique.set(taskWorkspaceKey(workspace.workspacePath, workspace.workspaceIdentity), workspace)
  }
  const targets: AgentArchivedDeletionTarget[] = []
  const unavailableWorkspaces: string[] = []
  for (const workspace of unique.values()) {
    if (workspace.archivedTaskIds === null) {
      unavailableWorkspaces.push(workspace.label)
      continue
    }
    for (const taskId of new Set(workspace.archivedTaskIds)) {
      targets.push({
        workspacePath: workspace.workspacePath,
        ...(workspace.workspaceIdentity ? { workspaceIdentity: workspace.workspaceIdentity } : {}),
        taskId,
      })
    }
  }
  return { targets, count: targets.length, unavailableWorkspaces }
}

/** 每工作区的删除结果（`ZCodeArchivedTaskDeletionResult`，`zcodeTaskService.ts:63-67`）。 */
export interface AgentArchivedDeletionResult {
  deletedTaskIds: string[]
  skippedTaskIds: string[]
  failedTaskIds: string[]
}

export interface AgentArchivedDeletionOutcome {
  deleted: number
  skipped: number
  failed: number
  unavailableWorkspaces: string[]
}

/** 按服务回包统计 deleted / skipped / failed（`deleteArchivedTaskSelection`，`:58-99`）：命中 deleted
 * 计数并回调 onDeleted，命中 skipped 计 skipped，其余（含整批失败）计 failed。 */
export function applyArchivedDeletion(
  selection: AgentArchivedDeletionSelection,
  resultFor: (target: AgentArchivedDeletionTarget) => AgentArchivedDeletionResult | null,
  onDeleted?: (target: AgentArchivedDeletionTarget) => void,
): AgentArchivedDeletionOutcome {
  let deleted = 0
  let skipped = 0
  let failed = 0
  for (const target of selection.targets) {
    const result = resultFor(target)
    if (!result) {
      // 整批失败：这一工作区的目标全计 failed（`archivedTaskDeletion.ts:76-83`）。
      failed += 1
    } else if (result.deletedTaskIds.includes(target.taskId)) {
      deleted += 1
      onDeleted?.(target)
    } else if (result.skippedTaskIds.includes(target.taskId)) {
      skipped += 1
    } else {
      failed += 1
    }
  }
  return { deleted, skipped, failed, unavailableWorkspaces: selection.unavailableWorkspaces }
}

/** 占位符替换（`{key}` → 值）；模板全部来自 zh-CN 原文。 */
function fill(template: string, values: Record<string, string>): string {
  return template.replace(/\{(\w+)\}/g, (_match, key: string) => values[key] ?? '')
}

function unavailableLine(workspaces: readonly string[]): string {
  if (workspaces.length === 0) return ''
  return fill(TASK_LIST_COPY.deleteAllArchivedUnavailable, { projects: workspaces.join('、') })
}

/** 批量删除确认框（`DeleteAllArchivedTasksButton.tsx:64-77`）：标题 `deleteAllArchivedTitle` 带 count；
 * 描述 = `archivedTaskDeleteDescription` 与 unavailable 行用空行拼接；确认按钮 variant=destructive。 */
export function buildDeleteAllArchivedConfirm(selection: AgentArchivedDeletionSelection): {
  title: string
  description: string
  confirmLabel: string
  confirmVariant: 'destructive'
} {
  return {
    title: fill(TASK_LIST_COPY.deleteAllArchivedTitle, { count: String(selection.count) }),
    description: [
      TASK_LIST_COPY.archivedTaskDeleteDescription,
      unavailableLine(selection.unavailableWorkspaces),
    ].filter(Boolean).join('\n\n'),
    confirmLabel: TASK_LIST_COPY.deleteAllArchived,
    confirmVariant: 'destructive',
  }
}

/** 批量删除结果文案（`DeleteAllArchivedTasksButton.tsx:80-90`）：`已删除 {deleted} 个，跳过 {skipped}
 * 个，失败 {failed} 个。` 后接 unavailable 行；一个都没删时按 `:60-63` 回「暂无归档任务」。 */
export function buildDeleteAllArchivedResult(outcome: AgentArchivedDeletionOutcome): string {
  const unavailable = unavailableLine(outcome.unavailableWorkspaces)
  if (outcome.deleted === 0 && outcome.skipped === 0 && outcome.failed === 0) {
    return unavailable || TASK_LIST_COPY.noArchivedTasks
  }
  const summary = fill(TASK_LIST_COPY.deleteAllArchivedResult, {
    deleted: String(outcome.deleted),
    skipped: String(outcome.skipped),
    failed: String(outcome.failed),
  })
  return [summary, unavailable].filter(Boolean).join('\n')
}

// ── 搜索（`services/src/session/taskIndexRepo.ts` 的 queryTaskList + buildSearchSnippets）────────────

/** 命中判定（`queryTaskList`，`taskIndexRepo.ts:1825-1833`）：`LOWER(title) LIKE %q% OR
 * LOWER(searchable_text) LIKE %q%`。空查询（trim 后）不算过滤（`params.search?.trim()`，`:1810`）。 */
export function matchesTaskQuery(task: AgentTaskRecord, query: string): boolean {
  const normalized = query.trim().toLocaleLowerCase()
  if (!normalized) return true
  if (task.title.toLocaleLowerCase().includes(normalized)) return true
  return (task.searchableText ?? '').toLocaleLowerCase().includes(normalized)
}

/** 摘要文本归一：空白折叠 + 截到 140 字符（`normalizeSearchSnippetText`，`:305-307`）。 */
function normalizeSnippetText(text: string): string {
  return text.replace(/\s+/g, ' ').trim().slice(0, TASK_SEARCH_SNIPPET_MAX_CHARS)
}

/** 正文摘要（`buildSearchSnippets`，`:312-357`）：以匹配点为中心切窗（前 20 / 后 72 字符）、去重相近
 * 窗口、最多 4 条；一条都没切出来（title 命中而正文没命中）时回退整段摘要。 */
export function buildSearchSnippets(searchableText: string, query: string): string[] {
  if (!query || !searchableText.trim()) return []
  const normalizedQuery = query.toLocaleLowerCase()
  const normalizedText = searchableText.toLocaleLowerCase()
  const snippets: string[] = []
  const ranges: Array<{ start: number; end: number }> = []
  let searchStart = 0
  while (snippets.length < TASK_SEARCH_SNIPPET_LIMIT && searchStart < normalizedText.length) {
    const matchIndex = normalizedText.indexOf(normalizedQuery, searchStart)
    if (matchIndex < 0) break
    const start = Math.max(0, matchIndex - TASK_SEARCH_SNIPPET_PREFIX_RADIUS)
    const end = Math.min(
      searchableText.length,
      matchIndex + normalizedQuery.length + TASK_SEARCH_SNIPPET_SUFFIX_RADIUS,
    )
    const head = start > 0 ? '...' : ''
    const tail = end < searchableText.length ? '...' : ''
    const snippet = normalizeSnippetText(`${head}${searchableText.slice(start, end)}${tail}`)
    const overlaps = ranges.some(range => Math.min(range.end, end) - Math.max(range.start, start) > 0)
    if (snippet && !overlaps) {
      snippets.push(snippet)
      ranges.push({ start, end })
    }
    searchStart = matchIndex + normalizedQuery.length
  }
  if (snippets.length === 0) {
    const fallback = normalizeSnippetText(searchableText)
    return fallback ? [fallback] : []
  }
  return snippets
}

/** 过滤 + 排序的搜索出口（列表查询的 `WHERE` + `ORDER BY`）。 */
export function searchTasks(
  tasks: readonly AgentTaskRecord[],
  query: string,
  sortBy: AgentTaskSortBy,
  isRunning: (task: AgentTaskRecord) => boolean = defaultIsTaskRunning,
): AgentTaskRecord[] {
  return sortAgentTasks(tasks.filter(task => matchesTaskQuery(task, query)), sortBy, isRunning)
}
