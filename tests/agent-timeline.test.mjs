// `agent/timeline` 判据：把对话行流编排成轮（turn），给出折叠边界与问题导航。
//
// 起因：ZCode 的 ConversationTimeline 把「行」聚成「轮」再渲染（v4/conversationTurnRenderUnits.ts），
// 轮内再按 accepted guide 切工作段、按「已工作」折叠（conversationTurnWorkSegments.ts /
// ConversationTurnGroup.tsx），左侧还有一条问题导航 rail（ConversationTurnNavigator.tsx）。
// 本仓只有 src/agentRowModel.ts 的单行模型与工具分组，没有这一层编排。
//
// 每条规则都对应 `.tools/ZCode` 的源码行；出处写在 `src/agentTimeline.ts` 的注释里。
import test from 'node:test'
import assert from 'node:assert/strict'
import {
  AGENT_NAVIGATOR_ALIGN_RETRY_ATTEMPTS,
  AGENT_NAVIGATOR_LABEL_KEYS,
  AGENT_NAVIGATOR_MAX_PREVIEW_CHARS,
  AGENT_NAVIGATOR_MAX_PREVIEW_PARAGRAPHS,
  AGENT_TIMELINE_I18N,
  AGENT_TIMELINE_UNVERIFIED,
  AGENT_TURN_HEADER_RENDERS_IN_FLOW,
  AGENT_TURN_NAVIGATOR_MIN_WIDTH_PX,
  AGENT_WORK_DURATION_UNIT_KEYS,
  agentHistoryStatusLabelKey,
  buildAgentFlowItems,
  buildAgentTimeline,
  buildAgentTurnNavigatorItems,
  buildAgentTurnWorkSegments,
  buildAgentWorkItems,
  buildNavigatorAssistantPreview,
  buildNavigatorPreviewText,
  isAgentToolCallItem,
  isCompletionBlockingWorkRowRunning,
  isVisibleAssistantWorkRow,
  isVisibleConversationRow,
  normalizeAgentRenderUnitPosition,
  normalizeNavigatorPreviewParagraphs,
  resolveAgentHistoryFoldState,
  resolveAgentNavigatorJumpBehavior,
  resolveAgentNavigatorJumpPlan,
  resolveAgentScrollToUnitPlan,
  resolveAgentSegmentDurationMs,
  resolveAgentSubagentDrilldown,
  resolveAgentTurnHeaderDisplay,
  resolveAgentTurnNavigatorActiveQueryRowId,
  resolveAgentTurnNavigatorActiveUnitIndex,
  resolveAgentTurnNavigatorBarVisualState,
  resolveAgentTurnNavigatorHydrationRetryDelayMs,
  resolveAgentTurnNavigatorVisualFocusItemIndex,
  resolveAgentTurnRunning,
  resolveAgentTurnWorkDurationMs,
  resolveAgentTurnWorkStatus,
  resolveAgentWorkflowLaunch,
  resolveStageTailIsRunning,
  shouldForceOpenAbnormalHistory,
  shouldHydrateAgentTurnNavigatorDirectory,
  shouldKeepAgentRenderUnit,
  shouldRenderAgentTurnNavigator,
  shouldShowAgentTurnChatLoading,
  splitAgentTimelineLiveTail,
  splitAgentTurnTailRows,
  splitAgentWorkDurationMs,
  splitAgentVisualWorkSegments,
  truncateNavigatorPreview,
} from '../src/agentTimeline.ts'

// 行工厂。字段名对齐 shared/src/zcode-protocol-v4/rows.ts 的 rowBaseFields。
const row = (kind, rowId, turnId, extra = {}) => ({ kind, rowId, turnId, ...extra })
const header = (turnId, extra = {}) => row('turnHeader', 0, turnId, { state: 'completedSuccess', ...extra })
const user = (rowId, turnId, extra = {}) => row('userInput', rowId, turnId, { text: 'hi', origin: 'realUser', ...extra })
const text = (rowId, turnId, extra = {}) => row('assistantText', rowId, turnId, { text: 'answer', state: 'complete', ...extra })
const tool = (rowId, turnId, toolName, extra = {}) => row('toolCall', rowId, turnId, { toolName, toolCallId: `c${rowId}`, status: 'success', ...extra })

// ── 1. 行级可见性（render unit 边界）─────────────────────────────────────────

test('reasoning 空文本与 EnterPlanMode 在 render-unit 边界被裁掉', () => {
  // conversationTurnRenderUnits.ts:107-117
  assert.equal(isVisibleAssistantWorkRow(row('reasoning', 1, 't', { text: '   ', state: 'complete' })), false)
  assert.equal(isVisibleAssistantWorkRow(row('reasoning', 1, 't', { text: 'think', state: 'complete' })), true)
  assert.equal(isVisibleAssistantWorkRow(tool(1, 't', 'EnterPlanMode')), false)
  assert.equal(isVisibleAssistantWorkRow(tool(1, 't', 'Read')), true)
})

test('turnHeader / hookInvocation 不进可见行流，userInput 恒真', () => {
  // conversationTurnRenderUnits.ts:119-124
  assert.equal(isVisibleConversationRow(header('t')), false)
  assert.equal(isVisibleConversationRow(row('hookInvocation', 1, 't')), false)
  assert.equal(isVisibleConversationRow(user(1, 't')), true)
  assert.equal(AGENT_TURN_HEADER_RENDERS_IN_FLOW, false)
})

// ── 2. 轮分组 ───────────────────────────────────────────────────────────────

test('同 turnId 的行聚成一轮，插入序保留，turnHeader 只做 header', () => {
  // conversationTurnRenderUnits.ts:438-481（:443-454 建/取单元、:458-461 turnHeader、:462 进 orderedRows）
  const units = buildAgentTimeline([
    header('t1'), user(1, 't1'), tool(2, 't1', 'Read'), text(3, 't1'),
    header('t2'), user(4, 't2'), text(5, 't2'),
  ])
  assert.equal(units.length, 2)
  assert.equal(units[0].turnId, 't1')
  assert.equal(units[0].key, 't1') // key 只依赖稳定 turnId（:360-372）
  assert.deepEqual(units[0].visibleUserInputs.map((r) => r.rowId), [1])
  // assistantWorkRows = bodyRows，含 assistantText（AssistantWorkRow = 非 header/非 userInput）。出处：:337
  assert.deepEqual(units[0].assistantWorkRows.map((r) => r.rowId), [2, 3])
  assert.equal(units[1].turnId, 't2')
  assert.deepEqual(units[1].visibleUserInputs.map((r) => r.rowId), [4])
})

test('末轮标记按 keep 过滤后的位置重算', () => {
  // conversationTurnRenderUnits.ts:388-436
  const units = buildAgentTimeline([header('t1'), user(1, 't1'), text(2, 't1')])
  assert.equal(units.length, 1)
  assert.equal(units[0].isLastTurn, true)
})

test('空轮被丢弃；带 didExecute hook 的空轮保留', () => {
  // conversationTurnRenderUnits.ts:374-386
  const emptyUnit = {
    key: 't', turnId: 't', visibleUserInputs: [], assistantWorkRows: [], hookInvocations: [],
    assistantHistoryRows: [], assistantFollowingRows: [], assistantTailRows: [], browserTurnEndRows: [],
    assistantTextRows: [], leadingBoundaryRows: [], flowItems: [], workSegments: [], renderRows: [],
    isLastTurn: false, isRunning: false, assistantHistoryDefaultOpen: false, timelineOnly: false,
  }
  assert.equal(shouldKeepAgentRenderUnit(emptyUnit), false)
  assert.equal(shouldKeepAgentRenderUnit({
    ...emptyUnit,
    hookInvocations: [{ hookInvocations: [{ executions: [{ didExecute: true }] }] }],
  }), true)
  assert.equal(shouldKeepAgentRenderUnit({ ...emptyUnit, isRunning: true }), true)
})

// ── 3. 轮尾拆分与 timelineOnly ──────────────────────────────────────────────

test('连续的真实轮尾后缀（turnTailBoundary / artifact）从 flow 拆出', () => {
  // conversationTurnRenderUnits.ts:146-162
  const rows = [
    tool(1, 't', 'Read'),
    row('timelineMarker', 2, 't', { lane: 'turnTailBoundary', marker: { type: 'forkNotice' } }),
    row('artifact', 3, 't', {}),
  ]
  const { flowRows, tailRows } = splitAgentTurnTailRows(rows)
  assert.deepEqual(flowRows.map((r) => r.rowId), [1])
  assert.deepEqual(tailRows.map((r) => r.rowId), [2, 3])
  // 非轮尾的 marker 留在 flow
  const mid = splitAgentTurnTailRows([tool(1, 't', 'Read'), row('timelineMarker', 2, 't', { lane: 'assistantWork', marker: { type: 'compact', status: 'success' } })])
  assert.deepEqual(mid.tailRows, [])
})

test('timelineOnly：无可见输入、工作行全是 timelineMarker', () => {
  // conversationTurnRenderUnits.ts:247-250
  const units = buildAgentTimeline([header('t'), row('timelineMarker', 1, 't', { lane: 'assistantWork', marker: { type: 'compact', status: 'success' } })])
  assert.equal(units.length, 1)
  assert.equal(units[0].timelineOnly, true)
  assert.equal(units[0].assistantHistoryDefaultOpen, false)
})

test('modelChange 是轮顶轻边界，不进工作行', () => {
  // conversationTurnRenderUnits.ts:252-259
  const units = buildAgentTimeline([
    header('t'), row('timelineMarker', 1, 't', { lane: 'lightBoundary', marker: { type: 'modelChange' } }),
    user(2, 't'), text(3, 't'),
  ])
  assert.deepEqual(units[0].leadingBoundaryRows.map((r) => r.rowId), [1])
  // 轻边界不进工作行；assistantText 仍是工作行（:337）
  assert.deepEqual(units[0].assistantWorkRows.map((r) => r.rowId), [3])
})

test('Browser 自动轮尾截图单独抽出，不进工作行', () => {
  // conversationTurnRenderUnits.ts:164-172 与 :260-272
  const units = buildAgentTimeline([
    header('t'), user(1, 't'), text(2, 't'),
    tool(3, 't', 'mcp__computer-use__screenshot', { display: { kind: 'node_repl_images', source: 'browser_turn_end' } }),
  ])
  assert.deepEqual(units[0].browserTurnEndRows.map((r) => r.rowId), [3])
  // 截图不进工作行；assistantText 仍留在工作行（:337），截图从 bodyRows 抽走前已在场
  assert.deepEqual(units[0].assistantWorkRows.map((r) => r.rowId), [2, 3])
})

// ── 4. running / 工时 / 状态 ────────────────────────────────────────────────

test('running：header 权威，controlOnly 恒 false，无 header 才回落 work 行', () => {
  // conversationTurnRenderUnits.ts:199-220
  assert.equal(resolveAgentTurnRunning({ header: header('t', { state: 'running' }), assistantWorkRows: [] }), true)
  assert.equal(resolveAgentTurnRunning({ header: header('t', { state: 'completedSuccess', executionKind: 'controlOnly' }), assistantWorkRows: [] }), false)
  // 终态主轮不被同轮 running 的 background 行推回 running
  assert.equal(resolveAgentTurnRunning({ header: header('t'), assistantWorkRows: [tool(1, 't', 'Read', { status: 'running' })] }), false)
  // 无 header：终态 sessionPhase 优先
  assert.equal(resolveAgentTurnRunning({ assistantWorkRows: [tool(1, 't', 'Read', { status: 'running' })] }, { sessionPhase: 'completedSuccess' }), false)
  assert.equal(resolveAgentTurnRunning({ assistantWorkRows: [tool(1, 't', 'Read', { status: 'running' })] }), true)
})

test('阻塞完成的判定：streaming / 非 background 的 running / running marker', () => {
  // conversationTurnRenderUnits.ts:178-197
  assert.equal(isCompletionBlockingWorkRowRunning(row('assistantText', 1, 't', { state: 'streaming' })), true)
  assert.equal(isCompletionBlockingWorkRowRunning(row('assistantText', 1, 't', { state: 'complete' })), false)
  assert.equal(isCompletionBlockingWorkRowRunning(tool(1, 't', 'Read', { status: 'running' })), true)
  assert.equal(isCompletionBlockingWorkRowRunning(tool(1, 't', 'Read', { status: 'running', backgrounded: true })), false)
  assert.equal(isCompletionBlockingWorkRowRunning(row('subagent', 1, 't', { status: 'running' })), true)
  assert.equal(isCompletionBlockingWorkRowRunning(row('timelineMarker', 1, 't', { marker: { type: 'compact', status: 'running' } })), true)
})

test('异常终态强制展开', () => {
  // conversationTurnRenderUnits.ts:222-230
  assert.equal(shouldForceOpenAbnormalHistory(header('t', { state: 'completedInterrupted' }), undefined), true)
  assert.equal(shouldForceOpenAbnormalHistory(header('t', { state: 'failed' }), undefined), true)
  assert.equal(shouldForceOpenAbnormalHistory(header('t'), undefined), false)
  assert.equal(shouldForceOpenAbnormalHistory(undefined, 'error'), true)
})

test('轮工时：activeMs > endedAt-startedAt > 仅 running 才吃 nowMs', () => {
  // conversationTurnWorkSegments.ts:49-63
  assert.equal(resolveAgentTurnWorkDurationMs({ activeMs: 5000, startedAt: 0 }, {}, false), 5000)
  assert.equal(resolveAgentTurnWorkDurationMs({ startedAt: 100, endedAt: 400 }, {}, false), 300)
  assert.equal(resolveAgentTurnWorkDurationMs({ startedAt: 100 }, { nowMs: 1000 }, true), 900)
  // 完成态缺事实不得吃当前时钟
  assert.equal(resolveAgentTurnWorkDurationMs({ startedAt: 100 }, { nowMs: 1000 }, false), undefined)
})

test('轮状态：controlOnly 无状态；agent 轮 durationMs 在场即有工作', () => {
  // conversationTurnWorkSegments.ts:30-47
  assert.equal(resolveAgentTurnWorkStatus(header('t', { executionKind: 'controlOnly' }), [], false, undefined), undefined)
  assert.deepEqual(resolveAgentTurnWorkStatus(header('t', { executionKind: 'agent' }), [], false, 10), { state: 'completed', durationMs: 10 })
  assert.deepEqual(resolveAgentTurnWorkStatus(header('t'), [], true, undefined), { state: 'running' })
  assert.deepEqual(resolveAgentTurnWorkStatus(header('t'), [], false, 5, true), { state: 'interrupted', durationMs: 5 })
  assert.equal(resolveAgentTurnWorkStatus(header('t'), [], false, undefined), undefined)
})

test('段工时：按 triggerEntityId 命中事实，单段回落轮工时', () => {
  // conversationTurnWorkSegments.ts:96-132
  const withFact = header('t', { workSegments: [{ segmentId: 's', triggerEntityId: 'e1', startedAt: 0, activeMs: 777 }] })
  assert.equal(resolveAgentSegmentDurationMs({
    header: withFact, segmentIndex: 0, triggerRow: user(1, 't', { entityId: 'e1' }),
    segmentRunning: false, segmentCount: 2,
  }), 777)
  const plain = header('t', { startedAt: 100, endedAt: 400 })
  assert.equal(resolveAgentSegmentDurationMs({ header: plain, segmentIndex: 0, segmentRunning: false, segmentCount: 1 }), 300)
})

// ── 5. 工作段（guide）与折叠边界 ────────────────────────────────────────────

test('accepted guide 的 userInput 开启新的视觉工作段', () => {
  // conversationTurnWorkSegments.ts:82-94
  const segments = splitAgentVisualWorkSegments([
    user(1, 't'), tool(2, 't', 'Read'), user(3, 't', { guided: true }), tool(4, 't', 'Read'),
  ])
  assert.equal(segments.length, 2)
  assert.deepEqual(segments[0].orderedRows.map((r) => r.rowId), [1, 2])
  assert.equal(segments[0].triggerRow, undefined)
  assert.deepEqual(segments[1].orderedRows.map((r) => r.rowId), [3, 4])
  assert.equal(segments[1].triggerRow.rowId, 3)
})

test('多段 key：首段用 turn key，后续用 guide 身份', () => {
  // conversationTurnWorkSegments.ts:191-194
  const segments = buildAgentTurnWorkSegments({
    key: 't1', orderedRows: [user(1, 't1'), user(2, 't1', { guided: true, entityId: 'e2' })],
    assistantTailRows: [], isRunning: false, isLastTurn: true, isInterrupted: false, forceOpenHistory: false, timelineOnly: false,
  })
  assert.equal(segments.length, 2)
  assert.equal(segments[0].key, 't1')
  assert.equal(segments[1].key, 't1:guide:e2')
})

test('段内历史/跟随以本段外置正文为界', () => {
  // conversationTurnWorkSegments.ts:155-173
  const segments = buildAgentTurnWorkSegments({
    key: 't', orderedRows: [user(1, 't'), tool(2, 't', 'Read'), text(3, 't')],
    assistantTailRows: [], isRunning: false, isLastTurn: true, isInterrupted: false, forceOpenHistory: false, timelineOnly: false,
  })
  assert.deepEqual(segments[0].assistantHistoryRows.map((r) => r.rowId), [2])
  assert.deepEqual(segments[0].assistantFollowingRows, [])
})

test('折叠默认态：末轮在跑 → 展开；有最终正文 → 收起', () => {
  // conversationTurnWorkSegments.ts:216-222 与 conversationTurnRenderUnits.ts:396-403
  const running = buildAgentTurnWorkSegments({
    key: 't', orderedRows: [user(1, 't'), tool(2, 't', 'Read')], assistantTailRows: [],
    isRunning: true, isLastTurn: true, isInterrupted: false, forceOpenHistory: false, timelineOnly: false,
  })
  assert.equal(running[0].assistantHistoryDefaultOpen, true)
  const withAnswer = buildAgentTurnWorkSegments({
    key: 't', orderedRows: [user(1, 't'), tool(2, 't', 'Read'), text(3, 't')], assistantTailRows: [],
    isRunning: false, isLastTurn: true, isInterrupted: false, forceOpenHistory: false, timelineOnly: false,
  })
  assert.equal(withAnswer[0].assistantHistoryDefaultOpen, false)
})

test('单段且无最终正文 → 默认展开', () => {
  // conversationTurnWorkSegments.ts:220-222
  const segments = buildAgentTurnWorkSegments({
    key: 't', orderedRows: [user(1, 't'), tool(2, 't', 'Read')], assistantTailRows: [],
    isRunning: false, isLastTurn: false, isInterrupted: false, forceOpenHistory: false, timelineOnly: false,
  })
  assert.equal(segments[0].assistantHistoryDefaultOpen, true)
})

test('normalize 重算默认态与末轮标记', () => {
  // conversationTurnRenderUnits.ts:388-436
  const units = buildAgentTimeline([header('t1'), user(1, 't1'), text(2, 't1')])
  const normalized = normalizeAgentRenderUnitPosition(units[0], 0, 2, {})
  assert.equal(normalized.isLastTurn, false)
})

// ── 6. flow items ───────────────────────────────────────────────────────────

test('flow items：userInput 独立，history 相邻合并，最终正文单独成项', () => {
  // conversationTurnFlowItems.ts:43-91
  const items = buildAgentFlowItems({
    orderedRows: [user(1, 't'), tool(2, 't', 'Read'), tool(3, 't', 'Read'), text(4, 't')],
    assistantHistoryRows: [tool(2, 't', 'Read'), tool(3, 't', 'Read')],
    assistantFollowingRows: [], assistantTailRows: [],
    visibleAssistantTextRow: text(4, 't'), latestAssistantTextRow: text(4, 't'), timelineOnly: false,
  })
  assert.deepEqual(items.map((i) => i.kind), ['userInput', 'assistantHistory', 'assistantText'])
  assert.deepEqual(items[1].rows.map((r) => r.rowId), [2, 3])
  assert.equal(items[2].latest, true)
})

test('flow items：轮尾行不进 flow', () => {
  // conversationTurnFlowItems.ts:68
  const items = buildAgentFlowItems({
    orderedRows: [user(1, 't'), tool(2, 't', 'Read')],
    assistantHistoryRows: [], assistantFollowingRows: [], assistantTailRows: [tool(2, 't', 'Read')],
    timelineOnly: false,
  })
  assert.deepEqual(items.map((i) => i.kind), ['userInput'])
})

// ── 7. 与 agentRowModel 的分工：工具分组是复用，不是重实现 ──────────────────

test('buildAgentWorkItems 直接转发 agentRowModel.groupToolRows（连续 Read 聚成 exploreGroup）', () => {
  // conversationAssistantWorkItems.ts:272-428（分组规则已由 agentRowModel 移植）
  const items = buildAgentWorkItems([
    tool(1, 't', 'Read', { status: 'success' }), tool(2, 't', 'Grep', { status: 'success' }),
  ], { stageTailIsRunning: false })
  assert.equal(items.length, 1)
  assert.equal(items[0].kind, 'exploreGroup')
  assert.deepEqual(items[0].rows.map((r) => r.rowId), [1, 2])
  // 单项不建组（TOOL_GROUP_MIN_ROWS = 2）
  assert.equal(buildAgentWorkItems([tool(1, 't', 'Read')])[0].kind, 'row')
})

test('stageTailIsRunning 只在段末工作组且段在跑时为真', () => {
  // ConversationTurnGroup.tsx:667-670
  const segment = { flowItems: [{ kind: 'assistantWork', rows: [] }], workStatus: { state: 'running' } }
  assert.equal(resolveStageTailIsRunning(segment, 0), true)
  assert.equal(resolveStageTailIsRunning(segment, 1), false)
  assert.equal(resolveStageTailIsRunning({ ...segment, workStatus: { state: 'completed' } }, 0), false)
  assert.equal(resolveStageTailIsRunning({ flowItems: [{ kind: 'assistantText', row: text(1, 't') }], workStatus: { state: 'running' } }, 0), false)
})

// ── 8. 折叠语义 ─────────────────────────────────────────────────────────────

test('forcedOpen 时不可收起，否则以用户交互为准', () => {
  // ConversationTurnGroup.tsx:645-660
  assert.deepEqual(resolveAgentHistoryFoldState(true, false), { open: true, toggleable: false })
  assert.deepEqual(resolveAgentHistoryFoldState(false, true), { open: true, toggleable: true })
  assert.deepEqual(resolveAgentHistoryFoldState(false, false), { open: false, toggleable: true })
})

test('折叠标签键：interrupted→stopped / running→workingFor / 有工时→workedFor / 否则 worked', () => {
  // ConversationTurnGroup.tsx:578-585
  assert.equal(agentHistoryStatusLabelKey('interrupted', true), 'chat.history.stopped')
  assert.equal(agentHistoryStatusLabelKey('running', false), 'chat.history.workingFor')
  assert.equal(agentHistoryStatusLabelKey('completed', true), 'chat.history.workedFor')
  assert.equal(agentHistoryStatusLabelKey('completed', false), 'chat.history.worked')
})

// ── 9. 工时文案 ─────────────────────────────────────────────────────────────

test('时长分档与单位键', () => {
  // conversationWorkDuration.ts:16-39
  assert.deepEqual(splitAgentWorkDurationMs(0), { days: 0, hours: 0, minutes: 0, seconds: 1 })
  assert.deepEqual(splitAgentWorkDurationMs(90_000), { days: 0, hours: 0, minutes: 1, seconds: 30 })
  assert.deepEqual(splitAgentWorkDurationMs(86_400_000 + 3_600_000), { days: 1, hours: 1, minutes: 0, seconds: 0 })
  assert.deepEqual(AGENT_WORK_DURATION_UNIT_KEYS.map((u) => u.messageId), [
    'chat.history.duration.day', 'chat.history.duration.hour',
    'chat.history.duration.minute', 'chat.history.duration.second',
  ])
})

// ── 10. 运行尾拆分 ──────────────────────────────────────────────────────────

test('只把真正的最后一个 running unit 拆成 live tail', () => {
  // conversationTimelineLiveTail.ts:15-28
  const units = buildAgentTimeline([
    header('t1', { state: 'running' }), user(1, 't1'), text(2, 't1'),
    header('t2', { state: 'running' }), user(3, 't2'), text(4, 't2'),
  ])
  const split = splitAgentTimelineLiveTail(units)
  assert.equal(split.liveUnitIndex, 1)
  assert.equal(split.virtualizedUnits.length, 1)
  assert.equal(split.liveUnit.turnId, 't2')
  // 末轮不在跑 → 全进虚拟列表
  const idle = splitAgentTimelineLiveTail(buildAgentTimeline([header('t1'), user(1, 't1'), text(2, 't1')]))
  assert.equal(idle.liveUnit, null)
  assert.equal(idle.liveUnitIndex, null)
})

// ── 11. 问题导航目录 ────────────────────────────────────────────────────────

const navigatorOptions = {
  assistantEmptyPreview: '暂无助手正文',
  assistantRunningPreview: '助手仍在工作',
  userFallbackPreview: '用户输入',
}

test('导航项只按 realUser query 建，timelineOnly 的轮跳过', () => {
  // conversationTurnNavigatorHelpers.ts:169-211
  const units = buildAgentTimeline([
    header('t1'), user(1, 't1', { origin: 'realUser', entityId: 'e1' }), text(2, 't1'),
    header('t2'), user(3, 't2', { origin: 'backgroundResult' }), text(4, 't2'),
  ])
  const items = buildAgentTurnNavigatorItems(units, navigatorOptions)
  assert.equal(items.length, 1)
  assert.equal(items[0].key, 't1:query:e1')
  assert.equal(items[0].unitIndex, 0)
  assert.equal(items[0].rowId, 1)
  assert.equal(items[0].userPreview, 'hi')
  assert.equal(items[0].assistantPreviewKind, 'text')
})

test('同一轮多条 realUser query 各建一项，仅最后一条标 running', () => {
  // conversationTurnNavigatorHelpers.ts:190-208
  const units = buildAgentTimeline([
    header('t1', { state: 'running' }), user(1, 't1', { entityId: 'a' }),
    user(2, 't1', { entityId: 'b', guided: true }), tool(3, 't1', 'Read', { status: 'running' }),
  ])
  const items = buildAgentTurnNavigatorItems(units, navigatorOptions)
  assert.equal(items.length, 2)
  assert.equal(items[0].isRunning, false)
  assert.equal(items[1].isRunning, true)
})

test('rail 渲染门与目录补齐资格', () => {
  // ConversationTurnNavigator.tsx:133-135；conversationTurnNavigatorHelpers.ts:77-89
  assert.equal(shouldRenderAgentTurnNavigator(1), false)
  assert.equal(shouldRenderAgentTurnNavigator(2), true)
  assert.equal(AGENT_TURN_NAVIGATOR_MIN_WIDTH_PX, 864)
  assert.equal(shouldHydrateAgentTurnNavigatorDirectory({ canLoadOlder: true, containerWidthPx: 864, hasLoadHandler: true, loadingOlder: false }), true)
  assert.equal(shouldHydrateAgentTurnNavigatorDirectory({ canLoadOlder: true, containerWidthPx: 863, hasLoadHandler: true, loadingOlder: false }), false)
  assert.equal(shouldHydrateAgentTurnNavigatorDirectory({ canLoadOlder: true, containerWidthPx: 1200, hasLoadHandler: true, loadingOlder: true }), false)
})

test('补齐重试退避：250ms / 1000ms / 放弃', () => {
  // conversationTurnNavigatorHelpers.ts:91-97
  assert.equal(resolveAgentTurnNavigatorHydrationRetryDelayMs(1), 250)
  assert.equal(resolveAgentTurnNavigatorHydrationRetryDelayMs(2), 1000)
  assert.equal(resolveAgentTurnNavigatorHydrationRetryDelayMs(3), null)
})

test('活动轮：与视口相交且离视口顶最近', () => {
  // conversationTurnNavigatorHelpers.ts:217-268
  const items = [
    { unitIndex: 0 }, { unitIndex: 1 }, { unitIndex: 2 },
  ]
  const active = resolveAgentTurnNavigatorActiveUnitIndex({
    items, virtualItems: [{ index: 0, start: 0, size: 100 }, { index: 1, start: 100, size: 100 }],
    scrollOffsetPx: 150, viewportHeightPx: 400,
  })
  assert.equal(active, 1)
  assert.equal(resolveAgentTurnNavigatorActiveUnitIndex({ items: [], virtualItems: [], scrollOffsetPx: 0, viewportHeightPx: 100 }), undefined)
})

test('活动 query：相交者里起点最接近视口顶；无交集按前后就近', () => {
  // conversationTurnNavigatorHelpers.ts:270-305
  const positions = [{ rowId: 1, start: 0, end: 50 }, { rowId: 2, start: 100, end: 150 }]
  assert.equal(resolveAgentTurnNavigatorActiveQueryRowId({ positions, scrollOffsetPx: 90, viewportHeightPx: 100 }), 2)
  // 视口在两者之间：取视口顶之前最后一条
  assert.equal(resolveAgentTurnNavigatorActiveQueryRowId({ positions, scrollOffsetPx: 60, viewportHeightPx: 20 }), 1)
  assert.equal(resolveAgentTurnNavigatorActiveQueryRowId({ positions: [], scrollOffsetPx: 0, viewportHeightPx: 10 }), undefined)
})

test('rail 山峰视觉：焦点 2.6，距离 1/2 递减', () => {
  // conversationTurnNavigatorHelpers.ts:307-326
  assert.deepEqual(resolveAgentTurnNavigatorBarVisualState({ itemIndex: 3, visualFocusItemIndex: 3 }), { colorTone: 'focus', opacity: 1, scaleX: 2.6, tone: 'peak' })
  assert.equal(resolveAgentTurnNavigatorBarVisualState({ itemIndex: 3, visualFocusItemIndex: 4 }).scaleX, 1.7)
  assert.equal(resolveAgentTurnNavigatorBarVisualState({ itemIndex: 3, visualFocusItemIndex: 5 }).scaleX, 1.25)
  assert.equal(resolveAgentTurnNavigatorBarVisualState({ itemIndex: 3, visualFocusItemIndex: 9 }).scaleX, 1)
  assert.equal(resolveAgentTurnNavigatorBarVisualState({ itemIndex: 0, visualFocusItemIndex: undefined }).opacity, 0.58)
})

test('视觉焦点 = 交互项', () => {
  // conversationTurnNavigatorHelpers.ts:328-332
  assert.equal(resolveAgentTurnNavigatorVisualFocusItemIndex({ interactionItemIndex: 4 }), 4)
  assert.equal(resolveAgentTurnNavigatorVisualFocusItemIndex({ interactionItemIndex: undefined }), undefined)
})

test('预览：段落归一、截断、fallback', () => {
  // conversationTurnNavigatorHelpers.ts:102-135
  assert.deepEqual(normalizeNavigatorPreviewParagraphs('a\n\n\n  b  c \n\n d', 2), ['a', 'b c'])
  assert.equal(truncateNavigatorPreview('short', 220), 'short')
  assert.equal(truncateNavigatorPreview('x'.repeat(300), 220), `${'x'.repeat(217)}...`)
  assert.equal(buildNavigatorPreviewText({ texts: ['   '], fallback: 'fb', maxPreviewChars: 220, maxPreviewParagraphs: 2 }), 'fb')
  assert.equal(AGENT_NAVIGATOR_MAX_PREVIEW_CHARS, 220)
  assert.equal(AGENT_NAVIGATOR_MAX_PREVIEW_PARAGRAPHS, 2)
})

test('助手预览：正文→text / 在跑→running / 否则 empty', () => {
  // conversationTurnNavigatorHelpers.ts:137-167
  assert.equal(buildNavigatorAssistantPreview({ assistantTextRows: [text(1, 't')], isRunning: false }, { ...navigatorOptions, maxPreviewChars: 220, maxPreviewParagraphs: 2 }).assistantPreviewKind, 'text')
  assert.equal(buildNavigatorAssistantPreview({ assistantTextRows: [], isRunning: true }, { ...navigatorOptions, maxPreviewChars: 220, maxPreviewParagraphs: 2 }).assistantPreviewKind, 'running')
  assert.equal(buildNavigatorAssistantPreview({ assistantTextRows: [], isRunning: false }, { ...navigatorOptions, maxPreviewChars: 220, maxPreviewParagraphs: 2 }).assistantPreviewKind, 'empty')
})

// ── 12. 跳转语义 ────────────────────────────────────────────────────────────

test('跳转计划：已挂载 query → 滚该行；live tail → 滚尾部；否则 scrollToIndex(start)', () => {
  // ConversationTimeline.tsx:1283-1352
  assert.deepEqual(resolveAgentNavigatorJumpPlan({ target: { unitIndex: 0, rowId: 1 }, liveUnitIndex: 2, queryRowMounted: true }), { kind: 'queryRow' })
  assert.deepEqual(resolveAgentNavigatorJumpPlan({ target: { unitIndex: 2, rowId: 5 }, liveUnitIndex: 2, queryRowMounted: false }), { kind: 'liveTail' })
  assert.deepEqual(resolveAgentNavigatorJumpPlan({ target: { unitIndex: 1, rowId: 5 }, liveUnitIndex: 2, queryRowMounted: false }), { kind: 'unitIndex', align: 'start', behavior: 'auto' })
  assert.equal(AGENT_NAVIGATOR_ALIGN_RETRY_ATTEMPTS, 12)
})

test('跳转动画尊重 prefers-reduced-motion', () => {
  // ConversationTurnNavigator.tsx:193-198
  assert.equal(resolveAgentNavigatorJumpBehavior(true), 'auto')
  assert.equal(resolveAgentNavigatorJumpBehavior(false), 'smooth')
})

test('滚到某一轮：目标是 live tail 则滚尾部，否则 scrollToIndex(start)', () => {
  // ConversationTimeline.tsx:1377-1401
  assert.deepEqual(resolveAgentScrollToUnitPlan({ unitIndex: 1, liveUnitIndex: 1 }), { kind: 'liveTail' })
  assert.deepEqual(resolveAgentScrollToUnitPlan({ unitIndex: 0, liveUnitIndex: 1 }), { kind: 'unitIndex', align: 'start' })
})

// ── 13. 轮尾 loading 门 ─────────────────────────────────────────────────────

test('轮尾 loading：仅末轮在跑且未被交互/维护阻塞', () => {
  // chatLoadingVisibility.ts:38-58
  const base = { blockedByActiveWork: false, blockedByInteraction: false, isLastTurn: true, isRunning: true, rows: [] }
  assert.equal(shouldShowAgentTurnChatLoading(base), true)
  assert.equal(shouldShowAgentTurnChatLoading({ ...base, isLastTurn: false }), false)
  assert.equal(shouldShowAgentTurnChatLoading({ ...base, isRunning: false }), false)
  assert.equal(shouldShowAgentTurnChatLoading({ ...base, blockedByInteraction: true }), false)
  assert.equal(shouldShowAgentTurnChatLoading({ ...base, rows: [tool(1, 't', 'Bash', { status: 'pendingApproval' })] }), false)
  assert.equal(shouldShowAgentTurnChatLoading({ ...base, rows: [row('timelineMarker', 1, 't', { marker: { type: 'compact', status: 'running' } })] }), false)
})

// ── 14. turnHeader 与启动轮 ─────────────────────────────────────────────────

test('turnHeader 兜底文案 `turn · origin · state`', () => {
  // ConversationRowView.tsx:1627-1635（:1633）
  assert.deepEqual(resolveAgentTurnHeaderDisplay(header('t', { origin: 'userInput', state: 'running' })), { origin: 'userInput', state: 'running', text: 'turn · userInput · running' })
  assert.equal(resolveAgentTurnHeaderDisplay(user(1, 't')), null)
})

test('启动轮的用户行由 run 卡代言，不进可见输入', () => {
  // workflowLaunchTurn.ts:16-34
  const units = buildAgentTimeline([
    header('t', { origin: 'workflowLaunch', workflowLaunch: { runId: 'r1' } }),
    user(1, 't', { origin: 'workflowLaunch', workflowLaunch: { runId: 'r1' }, text: 'launch' }),
  ])
  assert.equal(units.length, 1)
  assert.deepEqual(units[0].visibleUserInputs, [])
  assert.deepEqual(units[0].workflowLaunch, { runId: 'r1' })
  assert.equal(resolveAgentWorkflowLaunch(header('t'), []), undefined)
  assert.deepEqual(resolveAgentWorkflowLaunch(header('t', { origin: 'workflowLaunch' }), [user(1, 't', { workflowLaunch: { runId: 'r2' } })]), { runId: 'r2' })
})

// ── 15. Agent 工具行下钻 ────────────────────────────────────────────────────

test('子会话下钻门：childSessionId && parentSessionId && handler', () => {
  // ConversationAgentToolCallRow.tsx:10-37、:51-53
  assert.deepEqual(resolveAgentSubagentDrilldown({
    childSessionId: 'child', parentSessionId: 'parent', rootSessionId: undefined,
    hasOpenHandler: true, subagentType: 'general-purpose', title: 'Fix bug',
  }), { rootSessionId: 'parent', parentSessionId: 'parent', childSessionId: 'child', subagentType: 'general-purpose', title: 'Fix bug' })
  assert.equal(resolveAgentSubagentDrilldown({ childSessionId: undefined, parentSessionId: 'parent', hasOpenHandler: true, subagentType: 'x', title: 'y' }), null)
  assert.equal(resolveAgentSubagentDrilldown({ childSessionId: 'child', parentSessionId: 'parent', hasOpenHandler: false, subagentType: 'x', title: 'y' }), null)
  // rootSessionId 在场时优先
  assert.equal(resolveAgentSubagentDrilldown({ childSessionId: 'c', parentSessionId: 'p', rootSessionId: 'root', hasOpenHandler: true, subagentType: 'x', title: 'y' }).rootSessionId, 'root')
  assert.equal(isAgentToolCallItem({ kind: 'agentToolCall' }), true)
  assert.equal(isAgentToolCallItem({ kind: 'row' }), false)
})

// ── 16. 文案 ────────────────────────────────────────────────────────────────

test('zh-CN 文案逐字取用', () => {
  // i18n/locales/zh-CN.ts:4322-4329、:1882-1886、:4272
  assert.equal(AGENT_TIMELINE_I18N['chat.history.workingFor'], '工作中 {duration}')
  assert.equal(AGENT_TIMELINE_I18N['chat.history.workedFor'], '已工作 {duration}')
  assert.equal(AGENT_TIMELINE_I18N['chat.history.worked'], '已处理')
  assert.equal(AGENT_TIMELINE_I18N['chat.history.stopped'], '已停止')
  assert.equal(AGENT_TIMELINE_I18N['chat.history.duration.day'], '天')
  assert.equal(AGENT_TIMELINE_I18N['chat.history.duration.hour'], '时')
  assert.equal(AGENT_TIMELINE_I18N['chat.history.duration.minute'], '分')
  assert.equal(AGENT_TIMELINE_I18N['chat.history.duration.second'], '秒')
  assert.equal(AGENT_TIMELINE_I18N['chat.turnNavigator.label'], '对话问题导航')
  assert.equal(AGENT_TIMELINE_I18N['chat.turnNavigator.jumpToQuery'], '跳转到第 {index} 条问题')
  assert.equal(AGENT_TIMELINE_I18N['chat.turnNavigator.emptyAssistant'], '暂无助手正文')
  assert.equal(AGENT_TIMELINE_I18N['chat.turnNavigator.runningAssistant'], '助手仍在工作')
  assert.equal(AGENT_TIMELINE_I18N['chat.turnNavigator.userFallback'], '用户输入')
  assert.equal(AGENT_TIMELINE_I18N['chat.scrollToBottom'], '滚动到底部')
  assert.equal(AGENT_NAVIGATOR_LABEL_KEYS.jumpToQuery, 'chat.turnNavigator.jumpToQuery')
})

test('未核实的项已登记', () => {
  assert.ok(AGENT_TIMELINE_UNVERIFIED.length >= 4)
  assert.ok(AGENT_TIMELINE_UNVERIFIED.some((item) => item.includes('虚拟滚动')))
})

// ── 17. 端到端：一轮的完整编排 ──────────────────────────────────────────────

test('一轮的完整编排：可见行 / 工作段 / 折叠 / 导航', () => {
  const units = buildAgentTimeline([
    header('t1', { state: 'completedSuccess', startedAt: 0, endedAt: 6000, origin: 'userInput' }),
    user(1, 't1', { entityId: 'q1', text: '看看这个 bug' }),
    row('reasoning', 2, 't1', { text: 'thinking', state: 'complete' }),
    tool(3, 't1', 'Read', { status: 'success' }),
    tool(4, 't1', 'Grep', { status: 'success' }),
    text(5, 't1', { text: '找到了', state: 'complete', actions: { canFork: true } }),
  ])
  assert.equal(units.length, 1)
  const unit = units[0]
  assert.equal(unit.timelineOnly, false)
  assert.equal(unit.isRunning, false)
  assert.equal(unit.latestAssistantTextRow.rowId, 5) // action target（:289-297）
  assert.deepEqual(unit.assistantHistoryRows.map((r) => r.rowId), [2, 3, 4])
  assert.deepEqual(unit.assistantTextRows.map((r) => r.rowId), [5])
  assert.deepEqual(unit.flowItems.map((i) => i.kind), ['userInput', 'assistantHistory', 'assistantText'])
  assert.equal(unit.assistantHistoryDefaultOpen, false)
  assert.deepEqual(unit.workStatus, { state: 'completed', durationMs: 6000 })
  // 折叠组内：Read+Grep 聚成 Explore
  const group = buildAgentWorkItems(unit.assistantHistoryRows.filter((r) => r.kind === 'toolCall'), {})
  assert.equal(group.length, 1)
  assert.equal(group[0].kind, 'exploreGroup')
  // 导航
  const items = buildAgentTurnNavigatorItems(units, navigatorOptions)
  assert.equal(items.length, 1)
  assert.equal(items[0].userPreview, '看看这个 bug')
  assert.equal(items[0].assistantPreview, '找到了')
})
