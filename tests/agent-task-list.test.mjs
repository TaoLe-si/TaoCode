// 任务管理面判据：字段映射、排序（运行层优先）、视图模式/分区、时间线分桶、
// 手动分组、自动归档、置顶、批量删除归档、搜索与摘要。
//
// 每条只钉一件事，来源行号写在用例名里（`.tools/ZCode`）。纯 JS + JSDoc，不碰真 localStorage。
import test from 'node:test'
import assert from 'node:assert/strict'
import {
  CRON_DEFAULT_GROUP_ID,
  DEFAULT_TASK_GROUP_COLOR,
  OFF_PEAK_DEFAULT_GROUP_ID,
  TASK_GROUP_COLORS,
  TASK_LIST_COLLAPSED_LIMIT,
  TASK_LIST_COPY,
  WORKSPACE_TASK_PAGE_SIZE,
  applyArchivedDeletion,
  buildDeleteAllArchivedConfirm,
  buildDeleteAllArchivedResult,
  buildGroupedNodes,
  buildSearchSnippets,
  buildSidebarSections,
  canRemoveTaskGroup,
  canRenameTaskGroup,
  collectArchivedDeletion,
  compareAgentTasks,
  defaultIsTaskRunning,
  groupTasksByTimeline,
  groupedTaskGroupIds,
  isAutoArchiveCandidate,
  isSystemTaskGroup,
  matchesTaskQuery,
  partitionWorkspacesByPurpose,
  resolvePrimaryTaskMode,
  resolveTaskToolbarVisibility,
  resolveTaskViewMode,
  resolveTimelineGroupKey,
  resolveWorkspaceTaskViewValue,
  runAutoArchive,
  searchTasks,
  selectAutoArchiveCandidates,
  shouldShowPinnedTasks,
  sortAgentTasks,
  taskDisplayTitle,
  taskFromSession,
  taskGroupDisplayTitle,
  taskWorkspaceKey,
  timelineGroupKeyId,
  timelineGroupLabel,
  withTaskGroup,
  withTaskPinned,
  withTaskUnarchived,
  withTaskUnread,
  withTasksArchived,
} from '../src/agentTaskList.ts'

const DAY = 24 * 60 * 60 * 1000

/** 本地时刻的毫秒值，避免时区把「今天/昨天」判据打歪。 */
function at(year, month, day, hour = 12) {
  return new Date(year, month - 1, day, hour).getTime()
}

/** 一行任务的最小形状（ZCodeTaskMeta 的任务管理面子集）。 */
function task(overrides = {}) {
  return {
    taskId: 't1',
    title: '任务',
    workspacePath: '/w',
    createdAt: at(2026, 10, 7),
    updatedAt: at(2026, 10, 7),
    pinned: false,
    archived: false,
    ...overrides,
  }
}

function session(overrides = {}) {
  return {
    id: 's1',
    name: '会话 1',
    createdAt: '2026-10-07T00:00:00.000Z',
    updatedAt: '2026-10-07T00:00:03.000Z',
    entries: [],
    ...overrides,
  }
}

// ── 字段映射（ZCodeTaskMeta → AgentTaskRecord）───────────────────────────────

test('taskFromSession：ISO 转 epoch 毫秒，id/name 映射 taskId/title（zcode-task-types-core.ts:264-290）', () => {
  const record = taskFromSession(session(), undefined, { workspacePath: '/w' })
  assert.equal(record.taskId, 's1')
  assert.equal(record.title, '会话 1')
  assert.equal(record.workspacePath, '/w')
  assert.equal(record.createdAt, Date.parse('2026-10-07T00:00:00.000Z'))
  assert.equal(record.updatedAt, Date.parse('2026-10-07T00:00:03.000Z'))
  assert.equal(record.addedAt, record.createdAt)
  assert.equal(record.pinned, false)
  assert.equal(record.archived, false)
})

test('taskFromSession：成员关系叠在会话行上，缺省 pinned/archived 为 false', () => {
  const record = taskFromSession(session(), {
    pinned: true,
    archived: true,
    unreadAt: 123,
    status: 'completed',
    groupId: 'g1',
    sortOrder: 5,
  }, { workspacePath: '/w', workspaceIdentity: 'ssh://h/w', workspacePurpose: 'conversation' })
  assert.equal(record.pinned, true)
  assert.equal(record.archived, true)
  assert.equal(record.unreadAt, 123)
  assert.equal(record.status, 'completed')
  assert.equal(record.groupId, 'g1')
  assert.equal(record.sortOrder, 5)
  assert.equal(record.workspaceIdentity, 'ssh://h/w')
  assert.equal(record.workspacePurpose, 'conversation')
})

test('taskFromSession：searchableText = 名字 + 全部转写正文（taskIndexRepo.ts:78 的 searchable_text）', () => {
  const record = taskFromSession(session({
    entries: [
      { at: '2026-10-07T00:00:01.000Z', kind: 'user', text: '找一份报告' },
      { at: '2026-10-07T00:00:02.000Z', kind: 'assistant', text: '好的' },
    ],
  }), undefined, { workspacePath: '/w' })
  assert.equal(record.searchableText.includes('会话 1'), true)
  assert.equal(record.searchableText.includes('找一份报告'), true)
  assert.equal(record.searchableText.includes('好的'), true)
})

test('taskFromSession：坏时间戳给 NaN 而不是抛（比较器按 !== 语义排后面）', () => {
  const record = taskFromSession(session({ createdAt: '不是日期', updatedAt: '也不是' }), undefined, { workspacePath: '/w' })
  assert.equal(Number.isNaN(record.createdAt), true)
  assert.equal(Number.isNaN(record.updatedAt), true)
})

test('taskDisplayTitle：空标题按 fork 与否走 forkedUntitled / untitled（TaskListItem.tsx:245-249）', () => {
  assert.equal(taskDisplayTitle({ title: '真名', forkedFromTaskId: 'x' }), '真名')
  assert.equal(taskDisplayTitle({ title: '   ', forkedFromTaskId: 'x' }), TASK_LIST_COPY.forkedUntitled)
  assert.equal(taskDisplayTitle({ title: '', forkedFromTaskId: undefined }), TASK_LIST_COPY.untitled)
  assert.equal(TASK_LIST_COPY.untitled, '新任务')
  assert.equal(TASK_LIST_COPY.forkedUntitled, '新任务')
})

test('常量：平铺列表首屏 20（各 Section collapsedLimit），项目视图分页 5（workspaceTaskPagination.ts:3）', () => {
  assert.equal(TASK_LIST_COLLAPSED_LIMIT, 20)
  assert.equal(WORKSPACE_TASK_PAGE_SIZE, 5)
})

test('常量：分组颜色与默认色（workspace-grouped-tasks/types.ts:8-16、taskIndexRepo.ts:157）', () => {
  assert.deepEqual([...TASK_GROUP_COLORS], ['gray', 'red', 'orange', 'yellow', 'green', 'blue', 'purple'])
  assert.equal(DEFAULT_TASK_GROUP_COLOR, 'gray')
  assert.equal(CRON_DEFAULT_GROUP_ID, 'zcode-default-group-cron')
  assert.equal(OFF_PEAK_DEFAULT_GROUP_ID, 'zcode-default-group-off-peak')
})

// ── 排序（lib/taskListOrdering.ts）────────────────────────────────────────────

test('排序：运行层整体置顶，层内按 createdAt 降序、taskId 降序（taskListOrdering.ts:44-63）', () => {
  const runningOld = task({ taskId: 'a', status: 'running', createdAt: at(2026, 1, 1), updatedAt: at(2026, 10, 7) })
  const runningNew = task({ taskId: 'b', status: 'running', createdAt: at(2026, 9, 1), updatedAt: at(2026, 1, 1) })
  const idle = task({ taskId: 'c', updatedAt: at(2026, 12, 1) })
  const sorted = sortAgentTasks([runningOld, idle, runningNew], 'updated')
  assert.deepEqual(sorted.map(item => item.taskId), ['b', 'a', 'c'])
  assert.equal(defaultIsTaskRunning(runningNew), true)
  assert.equal(defaultIsTaskRunning(idle), false)
})

test('排序：运行层禁用 updatedAt 决胜 —— 同 createdAt 按 taskId 降序，流式事件不换位（:55-61）', () => {
  const left = task({ taskId: 'a', status: 'running', createdAt: at(2026, 5, 1), updatedAt: 1 })
  const right = task({ taskId: 'b', status: 'running', createdAt: at(2026, 5, 1), updatedAt: 999 })
  assert.deepEqual(sortAgentTasks([left, right], 'updated').map(item => item.taskId), ['b', 'a'])
})

test('排序：非运行层按 updated 降序、created 次之、taskId 再降（:27-33）', () => {
  const a = task({ taskId: 'a', createdAt: at(2026, 1, 1), updatedAt: at(2026, 3, 1) })
  const b = task({ taskId: 'b', createdAt: at(2026, 1, 1), updatedAt: at(2026, 3, 1) })
  const c = task({ taskId: 'c', createdAt: at(2026, 2, 1), updatedAt: at(2026, 3, 1) })
  assert.deepEqual(sortAgentTasks([a, b, c], 'updated').map(item => item.taskId), ['c', 'b', 'a'])
})

test('排序：sortBy=created 时主键是 createdAt，次键 updatedAt（:17-25）', () => {
  const old = task({ taskId: 'a', createdAt: at(2026, 1, 1), updatedAt: at(2026, 12, 1) })
  const fresh = task({ taskId: 'b', createdAt: at(2026, 6, 1), updatedAt: at(2026, 1, 1) })
  assert.deepEqual(sortAgentTasks([old, fresh], 'created').map(item => item.taskId), ['b', 'a'])
})

test('排序：不改入参（返回副本）', () => {
  const rows = [task({ taskId: 'a', updatedAt: 1 }), task({ taskId: 'b', updatedAt: 2 })]
  const sorted = sortAgentTasks(rows, 'updated')
  assert.notEqual(sorted, rows)
  assert.equal(rows[0].taskId, 'a')
})

test('compareAgentTasks：可注入 isRunning，不看持久 status（v4/taskListRowActivity.ts:38-55）', () => {
  const idle = task({ taskId: 'a', status: 'completed' })
  const other = task({ taskId: 'b', status: 'completed', updatedAt: idle.updatedAt + 1 })
  const sorted = sortAgentTasks([other, idle], 'updated', item => item.taskId === 'a')
  assert.deepEqual(sorted.map(item => item.taskId), ['a', 'b'])
  assert.equal(compareAgentTasks(idle, idle, 'updated', defaultIsTaskRunning), 0)
})

// ── 视图模式与工具栏（WorkspaceSidebar.tsx）──────────────────────────────────

test('resolveTaskViewMode：归档优先，再 chronological/grouped，其余项目（WorkspaceSidebar.tsx:207-221）', () => {
  assert.equal(resolveTaskViewMode({ showArchivedTasks: true, organizeBy: 'grouped' }), 'archived')
  assert.equal(resolveTaskViewMode({ showArchivedTasks: false, organizeBy: 'chronological' }), 'timeline')
  assert.equal(resolveTaskViewMode({ showArchivedTasks: false, organizeBy: 'grouped' }), 'grouped')
  assert.equal(resolveTaskViewMode({ showArchivedTasks: false, organizeBy: 'project' }), 'workspace')
})

test('一级 Tab 与项目视图二级值（WorkspaceSidebar.tsx:872-874）', () => {
  assert.equal(resolvePrimaryTaskMode('grouped'), 'grouped')
  assert.equal(resolvePrimaryTaskMode('project'), 'workspace')
  assert.equal(resolvePrimaryTaskMode('chronological'), 'workspace')
  assert.equal(resolveWorkspaceTaskViewValue('chronological'), 'chronological')
  assert.equal(resolveWorkspaceTaskViewValue('grouped'), 'project')
})

test('工具栏可见位：chronological 归 workspace 一级，故筛选/排序仍可见（:872-877）', () => {
  assert.deepEqual(resolveTaskToolbarVisibility('workspace'), {
    showTaskViewFilter: true, showWorkspaceViewOptions: true, showTaskSortOptions: true, showNewGroup: false,
  })
  assert.deepEqual(resolveTaskToolbarVisibility('archived'), {
    showTaskViewFilter: true, showWorkspaceViewOptions: false, showTaskSortOptions: true, showNewGroup: false,
  })
  // timeline 的 organizeBy 是 chronological，activePrimaryTaskMode 仍是 workspace。
  assert.deepEqual(resolveTaskToolbarVisibility('timeline'), {
    showTaskViewFilter: true, showWorkspaceViewOptions: true, showTaskSortOptions: true, showNewGroup: false,
  })
  // 只有 grouped 一级才隐藏筛选/排序，改挂「新建分组」。
  assert.deepEqual(resolveTaskToolbarVisibility('grouped'), {
    showTaskViewFilter: false, showWorkspaceViewOptions: false, showTaskSortOptions: false, showNewGroup: true,
  })
})

test('置顶区四种视图全部可见（WorkspaceSidebar.tsx:610-616）', () => {
  for (const mode of ['workspace', 'grouped', 'timeline', 'archived']) {
    assert.equal(shouldShowPinnedTasks(mode), true)
  }
})

// ── 分区编排 ─────────────────────────────────────────────────────────────────

test('buildSidebarSections：置顶区在前，主体在后；成员互斥（taskIndexRepo.ts:1818-1824）', () => {
  const pinned = task({ taskId: 'p', pinned: true })
  const pinnedArchived = task({ taskId: 'pa', pinned: true, archived: true })
  const active = task({ taskId: 'a' })
  const archived = task({ taskId: 'z', archived: true })
  const sections = buildSidebarSections({
    mode: 'workspace', tasks: [pinned, pinnedArchived, active, archived], sortBy: 'updated',
  })
  assert.equal(sections.length, 2)
  assert.equal(sections[0].id, 'pinned')
  assert.equal(sections[0].title, TASK_LIST_COPY.pinnedSection)
  assert.equal(sections[0].visible, true)
  assert.deepEqual(sections[0].tasks.map(item => item.taskId), ['p'])
  assert.equal(sections[1].id, 'workspace')
  assert.deepEqual(sections[1].tasks.map(item => item.taskId), ['a'])
})

test('buildSidebarSections：归档态主体给 archived，置顶区仍在前', () => {
  const archived = task({ taskId: 'z', archived: true })
  const sections = buildSidebarSections({ mode: 'archived', tasks: [archived], sortBy: 'updated' })
  assert.equal(sections[0].id, 'pinned')
  assert.equal(sections[0].visible, false)
  assert.equal(sections[1].id, 'archived')
  assert.deepEqual(sections[1].tasks.map(item => item.taskId), ['z'])
})

test('buildSidebarSections：purpose 分段 —— conversation 任务不进 project 视图（lib/workspacePurpose.ts:4-6）', () => {
  const proj = task({ taskId: 'p', workspacePurpose: 'project' })
  const conv = task({ taskId: 'c', workspacePurpose: 'conversation' })
  const defaultSections = buildSidebarSections({ mode: 'workspace', tasks: [proj, conv], sortBy: 'updated' })
  assert.deepEqual(defaultSections[1].tasks.map(item => item.taskId), ['p'])
  const convSections = buildSidebarSections({ mode: 'workspace', tasks: [proj, conv], sortBy: 'updated', purpose: 'conversation' })
  assert.deepEqual(convSections[1].tasks.map(item => item.taskId), ['c'])
})

test('partitionWorkspacesByPurpose：非 conversation 一律 project（lib/workspacePurpose.ts:7-25）', () => {
  const { project, conversation } = partitionWorkspacesByPurpose([
    { workspacePath: '/a' },
    { workspacePath: '/b', workspacePurpose: 'conversation' },
    { workspacePath: '/c', workspacePurpose: 'project' },
  ])
  assert.deepEqual(project.map(item => item.workspacePath), ['/a', '/c'])
  assert.deepEqual(conversation.map(item => item.workspacePath), ['/b'])
})

// ── 时间线分桶（lib/taskTimelineGroups.ts）────────────────────────────────────

test('时间线桶：today/yesterday/daysAgo≤3（taskTimelineGroups.ts:45-86）', () => {
  const now = at(2026, 10, 7, 15)
  assert.equal(resolveTimelineGroupKey(at(2026, 10, 7, 9), now, 'zh-CN').kind, 'today')
  assert.equal(resolveTimelineGroupKey(at(2026, 10, 6, 9), now, 'zh-CN').kind, 'yesterday')
  const twoDays = resolveTimelineGroupKey(at(2026, 10, 5, 9), now, 'zh-CN')
  assert.equal(twoDays.kind, 'daysAgo')
  assert.equal(twoDays.daysAgo, 2)
})

test('时间线桶：thisWeek / lastWeek 按周起点分（en-US 周日，其余周一，:36-43）', () => {
  // 2026-10-16 是周五。zh-CN 周起点 = 10-12（周一），en-US 周起点 = 10-11（周日）。
  const now = at(2026, 10, 16, 15)
  assert.equal(resolveTimelineGroupKey(at(2026, 10, 12, 9), now, 'zh-CN').kind, 'thisWeek')
  assert.equal(resolveTimelineGroupKey(at(2026, 10, 11, 9), now, 'zh-CN').kind, 'lastWeek')
  // 同一个 10-11：en-US 从周日算，仍在「本周」。
  assert.equal(resolveTimelineGroupKey(at(2026, 10, 11, 9), now, 'en-US').kind, 'thisWeek')
  assert.equal(resolveTimelineGroupKey(at(2026, 10, 10, 9), now, 'en-US').kind, 'lastWeek')
})

test('时间线桶：thisMonth / lastMonth / older（:74-85）', () => {
  const now = at(2026, 10, 25, 15)
  assert.equal(resolveTimelineGroupKey(at(2026, 10, 5, 9), now, 'zh-CN').kind, 'thisMonth')
  assert.equal(resolveTimelineGroupKey(at(2026, 9, 25, 9), now, 'zh-CN').kind, 'lastMonth')
  assert.equal(resolveTimelineGroupKey(at(2026, 8, 20, 9), now, 'zh-CN').kind, 'older')
})

test('时间线桶键与文案：daysAgo 带天数，其余就是 kind（:88-103）', () => {
  assert.equal(timelineGroupKeyId({ kind: 'daysAgo', daysAgo: 3 }), 'daysAgo:3')
  assert.equal(timelineGroupKeyId({ kind: 'today' }), 'today')
  assert.equal(timelineGroupLabel({ kind: 'today' }), '今天')
  assert.equal(timelineGroupLabel({ kind: 'daysAgo', daysAgo: 2 }), '2 天前')
  assert.equal(timelineGroupLabel({ kind: 'older' }), '更早')
})

test('groupTasksByTimeline：按 createdAt/updatedAt 分桶，保持入参顺序（:105-133）', () => {
  const now = at(2026, 10, 7, 15)
  const a = task({ taskId: 'a', updatedAt: at(2026, 10, 7, 9) })
  const b = task({ taskId: 'b', updatedAt: at(2026, 10, 6, 9) })
  const c = task({ taskId: 'c', updatedAt: at(2026, 10, 7, 10) })
  const groups = groupTasksByTimeline([a, b, c], { sortBy: 'updated', now, locale: 'zh-CN' })
  assert.deepEqual(groups.map(group => group.key), ['today', 'yesterday'])
  assert.deepEqual(groups[0].tasks.map(item => item.taskId), ['a', 'c'])
  assert.deepEqual(groups[1].tasks.map(item => item.taskId), ['b'])
  const byCreated = groupTasksByTimeline([task({ taskId: 'x', createdAt: at(2026, 10, 6, 9), updatedAt: now })], { sortBy: 'created', now, locale: 'zh-CN' })
  assert.equal(byCreated[0].key, 'yesterday')
})

// ── 手动分组（buildGroupedTaskViewFromSessions.ts）───────────────────────────

test('buildGroupedNodes：pinned / archived 不进分组视图（:120-127）', () => {
  const groups = [{ id: 'g1', title: '甲组', color: 'blue', createdAt: 1, updatedAt: 1 }]
  const nodes = buildGroupedNodes(groups, [
    task({ taskId: 'a', groupId: 'g1' }),
    task({ taskId: 'p', groupId: 'g1', pinned: true }),
    task({ taskId: 'z', groupId: 'g1', archived: true }),
  ])
  assert.equal(nodes.length, 1)
  assert.equal(nodes[0].type, 'group')
  assert.deepEqual(nodes[0].tasks.map(item => item.taskId), ['a'])
})

test('buildGroupedNodes：组成员不进顶层，无归属任务进顶层（:160-171）', () => {
  const groups = [{ id: 'g1', title: '甲组', color: 'blue', createdAt: 1, updatedAt: 1 }]
  const nodes = buildGroupedNodes(groups, [
    task({ taskId: 'a', groupId: 'g1' }),
    task({ taskId: 'free' }),
    task({ taskId: 'ghost', groupId: '不存在' }),
  ])
  const top = nodes.filter(node => node.type === 'task').map(node => node.task.taskId)
  assert.deepEqual(top.sort(), ['free', 'ghost'])
})

test('buildGroupedNodes：组内缺 sortOrder 按 addedAt 降序补序，已有 sortOrder 优先（:56-92）', () => {
  const groups = [{ id: 'g1', title: '甲组', color: 'blue', createdAt: 1, updatedAt: 1 }]
  const nodes = buildGroupedNodes(groups, [
    task({ taskId: 'fixed', groupId: 'g1', sortOrder: 1 }),
    task({ taskId: 'newer', groupId: 'g1', addedAt: at(2026, 10, 7) }),
    task({ taskId: 'older', groupId: 'g1', addedAt: at(2026, 10, 1) }),
  ])
  assert.deepEqual(nodes[0].tasks.map(item => item.taskId), ['fixed', 'newer', 'older'])
})

test('buildGroupedNodes：顶层节点按 sortOrder 排，缺序按 createdAt 降序补（:173-193）', () => {
  const nodes = buildGroupedNodes([], [
    task({ taskId: 'old', createdAt: at(2026, 1, 1) }),
    task({ taskId: 'new', createdAt: at(2026, 9, 1) }),
  ])
  assert.deepEqual(nodes.map(node => node.task.taskId), ['new', 'old'])
})

test('groupedTaskGroupIds：只取 group 节点的 id（workspace-grouped-tasks/view.ts:170-172）', () => {
  const groups = [
    { id: 'g1', title: '甲组', color: 'blue', createdAt: 1, updatedAt: 1 },
    { id: 'g2', title: '乙组', color: 'red', createdAt: 2, updatedAt: 2 },
  ]
  const nodes = buildGroupedNodes(groups, [task({ taskId: 'free' })])
  assert.deepEqual(groupedTaskGroupIds(nodes).sort(), ['g1', 'g2'])
})

test('分组标题与系统组：cron/闲时忽略 DB 占位标题，禁改名禁解散（group-title.ts:4-11、group-item.tsx:133-138）', () => {
  assert.equal(taskGroupDisplayTitle({ id: CRON_DEFAULT_GROUP_ID, title: 'cron' }), '定时任务')
  assert.equal(taskGroupDisplayTitle({ id: OFF_PEAK_DEFAULT_GROUP_ID, title: 'off-peak' }), '闲时任务')
  assert.equal(taskGroupDisplayTitle({ id: 'g1', title: '甲组' }), '甲组')
  assert.equal(isSystemTaskGroup(CRON_DEFAULT_GROUP_ID), true)
  assert.equal(isSystemTaskGroup(OFF_PEAK_DEFAULT_GROUP_ID), true)
  assert.equal(isSystemTaskGroup('g1'), false)
  assert.equal(canRenameTaskGroup(CRON_DEFAULT_GROUP_ID, '改名'), false)
  assert.equal(canRenameTaskGroup('g1', '   '), false)
  assert.equal(canRenameTaskGroup('g1', '新名'), true)
  assert.equal(canRemoveTaskGroup(CRON_DEFAULT_GROUP_ID), false)
  assert.equal(canRemoveTaskGroup('g1'), true)
})

// ── 自动归档（archiveStaleTasks + 设置门）────────────────────────────────────

test('自动归档谓词：archived/pinned/未读/未完成/未超期 全部排除（taskIndexRepo.ts:879-889）', () => {
  const now = at(2026, 10, 7)
  const old = at(2026, 9, 20)
  assert.equal(isAutoArchiveCandidate(task({ taskId: 'ok', updatedAt: old, status: 'completed' }), 7, now), true)
  assert.equal(isAutoArchiveCandidate(task({ taskId: 'a', updatedAt: old, status: 'completed', archived: true }), 7, now), false)
  assert.equal(isAutoArchiveCandidate(task({ taskId: 'b', updatedAt: old, status: 'completed', pinned: true }), 7, now), false)
  assert.equal(isAutoArchiveCandidate(task({ taskId: 'c', updatedAt: old, status: 'completed', unreadAt: 1 }), 7, now), false)
  assert.equal(isAutoArchiveCandidate(task({ taskId: 'd', updatedAt: old, status: 'error' }), 7, now), false)
  assert.equal(isAutoArchiveCandidate(task({ taskId: 'e', updatedAt: old }), 7, now), false)
  assert.equal(isAutoArchiveCandidate(task({ taskId: 'f', updatedAt: at(2026, 10, 5), status: 'completed' }), 7, now), false)
})

test('自动归档：cutoff 边界严格早于，正好等于截止时刻不算（taskIndexRepo.ts:879-880）', () => {
  const now = at(2026, 10, 7)
  const cutoff = now - 7 * DAY
  assert.equal(isAutoArchiveCandidate(task({ updatedAt: cutoff, status: 'completed' }), 7, now), false)
  assert.equal(isAutoArchiveCandidate(task({ updatedAt: cutoff - 1, status: 'completed' }), 7, now), true)
})

test('自动归档：天数被夹到 ≥1（floor + max，:879）', () => {
  const now = at(2026, 10, 7)
  // 0.5 天 -> 夹到 1 天：半年前的任务仍算超期。
  assert.equal(isAutoArchiveCandidate(task({ updatedAt: now - 2 * DAY, status: 'completed' }), 0.5, now), true)
})

test('自动归档设置门：开关关掉一步不动；阈值不合法也一步不动（zcodeTaskServiceAdapter.ts:1083-1101）', () => {
  const now = at(2026, 10, 7)
  const rows = [task({ taskId: 'old', updatedAt: at(2026, 1, 1), status: 'completed' })]
  assert.deepEqual(selectAutoArchiveCandidates(rows, { enabled: false, olderThanDays: 7 }, now), [])
  assert.deepEqual(selectAutoArchiveCandidates(rows, { enabled: true, olderThanDays: 0 }, now), [])
  assert.deepEqual(selectAutoArchiveCandidates(rows, { enabled: true, olderThanDays: -7 }, now), [])
  assert.deepEqual(selectAutoArchiveCandidates(rows, { enabled: true, olderThanDays: Number.NaN }, now), [])
  assert.deepEqual(selectAutoArchiveCandidates(rows, { enabled: true, olderThanDays: Number.POSITIVE_INFINITY }, now), [])
  assert.equal(selectAutoArchiveCandidates(rows, { enabled: true, olderThanDays: 7 }, now).length, 1)
})

test('runAutoArchive：只改 archived，pinned/unread/分组归属不动（zcodeTaskServiceAdapter.ts:1103-1142）', () => {
  const now = at(2026, 10, 7)
  const rows = [
    task({ taskId: 'old', updatedAt: at(2026, 1, 1), status: 'completed', groupId: 'g1' }),
    task({ taskId: 'fresh', updatedAt: at(2026, 10, 6), status: 'completed' }),
  ]
  const result = runAutoArchive(rows, { enabled: true, olderThanDays: 7 }, now)
  assert.equal(result.archivedCount, 1)
  const archived = result.tasks.find(item => item.taskId === 'old')
  assert.equal(archived.archived, true)
  assert.equal(archived.groupId, 'g1')
  assert.equal(result.tasks.find(item => item.taskId === 'fresh').archived, false)
  // 关掉开关：返回同样内容且零归档。
  const off = runAutoArchive(rows, { enabled: false, olderThanDays: 7 }, now)
  assert.equal(off.archivedCount, 0)
  assert.equal(off.tasks.find(item => item.taskId === 'old').archived, false)
})

// ── 成员关系转换 ─────────────────────────────────────────────────────────────

test('成员关系转换：pinned / archived / unread / group 各自只改自己的列', () => {
  const rows = [task({ taskId: 'a', updatedAt: 5 }), task({ taskId: 'b' })]
  assert.equal(withTaskPinned(rows, 'a', true)[0].pinned, true)
  assert.equal(withTaskPinned(rows, 'a', true)[1].pinned, false)
  assert.equal(withTasksArchived(rows, ['a', 'b']).every(item => item.archived), true)
  assert.equal(withTaskUnarchived([task({ taskId: 'a', archived: true })], 'a')[0].archived, false)
  const unread = withTaskUnread(rows, 'a', true, 999)[0]
  assert.equal(unread.unreadAt, 999)
  assert.equal('unreadAt' in withTaskUnread([unread], 'a', false, 0)[0], false)
  assert.equal(withTaskGroup(rows, 'a', 'g1')[0].groupId, 'g1')
  assert.equal('groupId' in withTaskGroup([task({ taskId: 'a', groupId: 'g1' })], 'a', undefined)[0], false)
})

test('成员关系转换：不改入参', () => {
  const rows = [task({ taskId: 'a' })]
  withTaskPinned(rows, 'a', true)
  assert.equal(rows[0].pinned, false)
})

// ── 批量删除归档（DeleteAllArchivedTasksButton.tsx + lib/archivedTaskDeletion.ts）──

test('collectArchivedDeletion：按 workspaceKey 去重（后者覆盖）、taskId 去重、unavailable 单列（archivedTaskDeletion.ts:18-56）', () => {
  const selection = collectArchivedDeletion([
    { workspacePath: '/a', label: '甲', archivedTaskIds: ['t1', 't1', 't2'] },
    { workspacePath: '/a', label: '甲重复', archivedTaskIds: ['t3'] },
    { workspacePath: '/b', workspaceIdentity: 'ssh://h/b', label: '乙', archivedTaskIds: null },
  ])
  // Map 以 workspaceKey 为键，同名后者覆盖前者。
  assert.equal(selection.count, 1)
  assert.deepEqual(selection.targets.map(target => target.taskId), ['t3'])
  assert.deepEqual(selection.unavailableWorkspaces, ['乙'])
  // 去掉重复工作区后两条各自去重。
  const two = collectArchivedDeletion([
    { workspacePath: '/a', label: '甲', archivedTaskIds: ['t1', 't1', 't2'] },
    { workspacePath: '/b', label: '乙', archivedTaskIds: ['t3'] },
  ])
  assert.equal(two.count, 3)
  assert.deepEqual(two.targets.map(target => target.taskId), ['t1', 't2', 't3'])
})

test('taskWorkspaceKey：identity 优先于 path（zcodeSessionStoreSelectors.ts:25-30）', () => {
  assert.equal(taskWorkspaceKey('/w', 'ssh://h/w'), 'ssh://h/w')
  assert.equal(taskWorkspaceKey('/w'), '/w')
  assert.equal(taskWorkspaceKey('/w', '   '), '/w')
})

test('applyArchivedDeletion：deleted 回调、skipped 计数、整批失败计 failed（:58-99）', () => {
  const selection = collectArchivedDeletion([
    { workspacePath: '/a', label: '甲', archivedTaskIds: ['t1', 't2', 't3'] },
    { workspacePath: '/b', label: '乙', archivedTaskIds: ['t4'] },
  ])
  const deleted = []
  const outcome = applyArchivedDeletion(selection, target => {
    if (target.workspacePath === '/b') return null
    return { deletedTaskIds: ['t1'], skippedTaskIds: ['t2'], failedTaskIds: ['t3'] }
  }, target => deleted.push(target.taskId))
  assert.equal(outcome.deleted, 1)
  assert.equal(outcome.skipped, 1)
  assert.equal(outcome.failed, 2)
  assert.deepEqual(deleted, ['t1'])
})

test('批量删除确认框：标题带 count，描述带 unavailable 空行分隔（DeleteAllArchivedTasksButton.tsx:64-77）', () => {
  const selection = collectArchivedDeletion([
    { workspacePath: '/a', label: '甲', archivedTaskIds: ['t1'] },
    { workspacePath: '/b', label: '乙', archivedTaskIds: null },
  ])
  const confirm = buildDeleteAllArchivedConfirm(selection)
  assert.equal(confirm.title, '删除 1 个归档任务？')
  assert.equal(confirm.confirmLabel, '删除所有归档任务')
  assert.equal(confirm.confirmVariant, 'destructive')
  assert.equal(confirm.description.startsWith('任务将从任务列表和归档列表中移除。'), true)
  assert.equal(confirm.description.includes('乙'), true)
})

test('批量删除结果文案：全零回「暂无归档任务」，否则出三段计数（:60-90）', () => {
  const empty = buildDeleteAllArchivedResult({ deleted: 0, skipped: 0, failed: 0, unavailableWorkspaces: [] })
  assert.equal(empty, TASK_LIST_COPY.noArchivedTasks)
  const some = buildDeleteAllArchivedResult({ deleted: 2, skipped: 1, failed: 3, unavailableWorkspaces: [] })
  assert.equal(some, '已删除 2 个，跳过 1 个，失败 3 个。')
  const withUnavailable = buildDeleteAllArchivedResult({ deleted: 0, skipped: 0, failed: 0, unavailableWorkspaces: ['甲'] })
  assert.equal(withUnavailable.includes('甲'), true)
})

// ── 搜索与摘要（taskIndexRepo.ts）────────────────────────────────────────────

test('matchesTaskQuery：title 或 searchable_text 命中即匹配，空查询不过滤（taskIndexRepo.ts:1810-1833）', () => {
  const row = task({ title: '报表任务', searchableText: '正文里有 关键字' })
  assert.equal(matchesTaskQuery(row, ''), true)
  assert.equal(matchesTaskQuery(row, '   '), true)
  assert.equal(matchesTaskQuery(row, '报表'), true)
  assert.equal(matchesTaskQuery(row, '关键字'), true)
  assert.equal(matchesTaskQuery(row, '找不到的词'), false)
})

test('matchesTaskQuery：大小写不敏感（LOWER(...) LIKE，:1828）', () => {
  const row = task({ title: 'Report Task' })
  assert.equal(matchesTaskQuery(row, 'report'), true)
  assert.equal(matchesTaskQuery(row, 'REPORT'), true)
})

test('buildSearchSnippets：以匹配点为中心切窗（前 20 / 后 72），最多 4 条（:312-357）', () => {
  const text = 'a'.repeat(30) + 'TARGET' + 'b'.repeat(30)
  const snippets = buildSearchSnippets(text, 'target')
  assert.equal(snippets.length, 1)
  assert.equal(snippets[0].includes('TARGET'), true)
  // 匹配点前有 30 个字符 > 前半径 20，所以带前省略号；命中点之后到文末不足 72 字符，无后省略号。
  assert.equal(snippets[0].startsWith('...'), true)
  assert.equal(snippets[0].endsWith('...'), false)
  assert.equal(snippets[0].length, 3 + (66 - 10))
})

test('buildSearchSnippets：同一关键词多次命中给多条，重叠窗口去重，上限 4（:323-347）', () => {
  // 命中点间隔 200 字符（远超前 20 + 后 72 的窗口），窗口不重叠 → 各自成条。
  const text = 'HIT' + 'x'.repeat(200) + 'HIT' + 'y'.repeat(200) + 'HIT' + 'z'.repeat(200) + 'HIT'
  const snippets = buildSearchSnippets(text, 'hit')
  assert.equal(snippets.length, 4)
  assert.equal(snippets.every(snippet => snippet.includes('HIT')), true)
  // 命中点紧邻时窗口高度重叠，被合并成一条。
  assert.equal(buildSearchSnippets('HIT '.repeat(10), 'hit').length, 1)
})

test('buildSearchSnippets：无匹配回退整段摘要（截 140 字符），空输入给空数组（:305-307、:350-354）', () => {
  assert.deepEqual(buildSearchSnippets('一段正文', ''), [])
  assert.deepEqual(buildSearchSnippets('   ', 'x'), [])
  const fallback = buildSearchSnippets('一段没有命中的正文', '不存在')
  assert.equal(fallback.length, 1)
  assert.equal(fallback[0], '一段没有命中的正文')
  const long = buildSearchSnippets('字'.repeat(300), '不存在')
  assert.equal(long[0].length, 140)
})

test('searchTasks：过滤 + 排序一起出（列表查询 WHERE + ORDER BY）', () => {
  const rows = [
    task({ taskId: 'a', title: '报表', updatedAt: at(2026, 1, 1) }),
    task({ taskId: 'b', title: '报表', updatedAt: at(2026, 5, 1) }),
    task({ taskId: 'c', title: '别的', updatedAt: at(2026, 9, 1) }),
  ]
  assert.deepEqual(searchTasks(rows, '报表', 'updated').map(item => item.taskId), ['b', 'a'])
  assert.deepEqual(searchTasks(rows, '', 'updated').map(item => item.taskId), ['c', 'b', 'a'])
})

// ── 文案（zh-CN 原文）────────────────────────────────────────────────────────

test('文案：全部取 zh-CN 原文，不是自编', () => {
  assert.equal(TASK_LIST_COPY.pinnedSection, '已置顶')
  assert.equal(TASK_LIST_COPY.toggleArchivedTasks, '归档')
  assert.equal(TASK_LIST_COPY.noArchivedTasks, '暂无归档任务')
  assert.equal(TASK_LIST_COPY.showMore, '显示更多')
  assert.equal(TASK_LIST_COPY.showLess, '显示更少')
  assert.equal(TASK_LIST_COPY.newGroup, '新建分组')
  assert.equal(TASK_LIST_COPY.timelineToday, '今天')
  assert.equal(TASK_LIST_COPY.colorGray, '灰色')
  assert.equal(TASK_LIST_COPY.deleteAllArchivedResult, '已删除 {deleted} 个，跳过 {skipped} 个，失败 {failed} 个。')
})
