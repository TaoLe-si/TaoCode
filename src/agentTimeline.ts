// ZCode 对话时间线的编排层：轮次分组、工作段折叠、问题导航。纯逻辑：零 Vue / 零 DOM / 零状态。
// 每条规则在注释里给出 .tools/ZCode 的 文件:行号。
//
// 与 src/agentRowModel.ts 的分工（不是同一层）：
//   agentRowModel = 单行模型（行类型 / 角色 / 图标 / 动作 / **工具分组**）。它已逐行移植
//                   v4/conversationAssistantWorkItems.ts 的 buildAssistantWorkRenderItems
//                   （Explore/Terminal/Changes 三档 + Agent↔subagent 配对），导出 groupToolRows。
//   本文件        = 行流 → 轮（turn）的编排：轮边界、轮内可见行、工作段折叠边界、问题导航。
// 「连续工具调用聚成工作项」这一层**不在这里重实现**：buildAgentWorkItems 直接转发 groupToolRows，
// 只补时间线才知道的那一个入参 stageTailIsRunning。
//
// 上游锚点（.tools/ZCode/packages/ui/src）：v4/conversationTurnRenderUnits.ts（轮分组 + 折叠默认态）、
// v4/conversationTurnWorkSegments.ts（guide 工作段）、v4/conversationTurnFlowItems.ts（轮内交错顺序）、
// v4/conversationTimelineLiveTail.ts（运行尾拆分）、v4/conversationTurnNavigatorHelpers.ts（导航目录）、
// v4/ConversationTurnNavigator.tsx（rail 门与点击）、v4/ConversationTimeline.tsx（跳转计划）、
// v4/ConversationTurnGroup.tsx（折叠交互 + 工时文案）、v4/ConversationAgentToolCallRow.tsx（子会话下钻）、
// v4/ConversationRowView.tsx（turnHeader 兜底文案）、v4/chatLoadingVisibility.ts（轮尾 loading 门）、
// v4/conversationWorkDuration.ts（时长分档）、v4/workflowLaunchTurn.ts（启动轮）、
// i18n/locales/zh-CN.ts（chat.history.* / chat.turnNavigator.* / chat.scrollToBottom）。

import { groupToolRows } from './agentRowModel.ts'
import type { AgentToolGroupItem, GroupToolRowsOptions, ToolRowLike } from './agentRowModel.ts'

// ── 0. 输入形状 ─────────────────────────────────────────────────────────────

// ZCode ConversationRow 的结构子集。出处：shared/src/zcode-protocol-v4/rows.ts:12-38（rowBaseFields）、
// :58-96（turnHeader）、:100-149（userInput）、:156-166（assistantText）、:168-177（reasoning）、
// :191-198（toolCall）、:253-266（subagent）、:308-...（hookInvocation）、:410-417（timelineMarker）。
export interface AgentTimelineRow {
  rowId: number; turnId: string; kind: string; entityId?: string; productTurnId?: string; createdAt?: number
  actions?: { canFork?: boolean; canEdit?: boolean; canRetry?: boolean; canRewindFiles?: boolean }
  origin?: string; state?: string; executionKind?: string; startedAt?: number; endedAt?: number; activeMs?: number
  workSegments?: AgentTurnWorkSegmentFact[]
  fileChanges?: { additions: number; deletions: number; files: number; state?: string }
  originMeta?: { workId?: string; title?: string; backgroundSource?: string }; workflowLaunch?: unknown
  text?: string; guided?: boolean; assistantResponseId?: string
  toolCallId?: string; toolName?: string; status?: string; inputText?: string; input?: unknown
  backgrounded?: boolean; display?: { kind?: string; source?: string }
  parentToolCallId?: string; subagentType?: string; childSessionId?: string; summaryText?: string
  lane?: string; marker?: { type: string; status?: string; outcome?: string }
  hookInvocations?: { executions: { didExecute: boolean }[] }[]
}

// turnHeader.workSegments[] 的事实项。出处：rows.ts:39-53。
export interface AgentTurnWorkSegmentFact {
  segmentId: string; triggerEntityId?: string; startedAt: number; endedAt?: number; activeMs?: number
}

// 会话终态：只在缺 turnHeader 的冷恢复尾窗里做 running 回落。出处：conversationTurnRenderUnits.ts:212-216。
export type AgentSessionPhase = 'completedSuccess' | 'completedInterrupted' | 'error' | (string & {})

export interface BuildAgentTimelineOptions {
  nowMs?: number
  sessionPhase?: AgentSessionPhase
}

// ── 1. 行级可见性（render unit 边界）─────────────────────────────────────────

// reasoning 空文本与 EnterPlanMode 在 render-unit 边界被裁掉。出处：conversationTurnRenderUnits.ts:107-117
// （:108-112 reasoning.text.trim() 为空；:113-116 toolName === "EnterPlanMode"）。
export function isVisibleAssistantWorkRow(row: AgentTimelineRow): boolean {
  if (row.kind === 'reasoning' && (row.text ?? '').trim().length === 0) return false
  return row.kind !== 'toolCall' || row.toolName !== 'EnterPlanMode'
}

// userInput 恒真 / turnHeader 与 hookInvocation 恒不渲染 / 其余走 isVisibleAssistantWorkRow。
// 出处：conversationTurnRenderUnits.ts:119-124（:120/:121/:122/:123）。
export function isVisibleConversationRow(row: AgentTimelineRow): boolean {
  if (row.kind === 'userInput') return true
  if (row.kind === 'turnHeader' || row.kind === 'hookInvocation') return false
  return isVisibleAssistantWorkRow(row)
}

// lane 由 CLI 投影裁决，UI 不按 marker type 推断。出处：:126-130（turnTailBoundary）与 :174-176（lightBoundary）。
function isTurnEndingMarker(row: AgentTimelineRow): boolean {
  return row.kind === 'timelineMarker' && row.lane === 'turnTailBoundary'
}
function isLightBoundaryMarker(row: AgentTimelineRow): boolean {
  return row.kind === 'timelineMarker' && row.lane === 'lightBoundary'
}
// artifact 是分享投影追加到轮尾的产出物，按轮尾处理。出处：:142-144。
function isTurnTrailingArtifactRow(row: AgentTimelineRow): boolean {
  return row.kind === 'artifact'
}
// Browser 自动轮尾截图：display.kind==="node_repl_images" && display.source==="browser_turn_end"。出处：:164-172。
function isBrowserTurnEndRow(row: AgentTimelineRow): boolean {
  return row.kind === 'toolCall' && row.display?.kind === 'node_repl_images' && row.display?.source === 'browser_turn_end'
}

// 连续的真实轮尾后缀（turnTailBoundary / artifact）从 flow 拆出。出处：:146-162。
export function splitAgentTurnTailRows(rows: readonly AgentTimelineRow[]): {
  flowRows: AgentTimelineRow[]; tailRows: AgentTimelineRow[]
} {
  let tailStart = rows.length
  while (tailStart > 0 && (isTurnEndingMarker(rows[tailStart - 1]!) || isTurnTrailingArtifactRow(rows[tailStart - 1]!))) tailStart -= 1
  return { flowRows: rows.slice(0, tailStart), tailRows: rows.slice(tailStart) }
}

// ── 2. running / 工时 / 折叠默认态 ───────────────────────────────────────────

// 未完成的工作行是否阻塞轮完成。出处：:178-197 —— assistantText/reasoning state==="streaming"（:180-182）；
// toolCall backgrounded!==true 且 status ∈ inputStreaming/pendingApproval/running（:183-189）；
// subagent backgrounded!==true 且 status==="running"（:190-191）；timelineMarker marker.status==="running"（:192-193）。
export function isCompletionBlockingWorkRowRunning(row: AgentTimelineRow): boolean {
  if (row.kind === 'assistantText' || row.kind === 'reasoning') return row.state === 'streaming'
  if (row.kind === 'toolCall') {
    return row.backgrounded !== true && (row.status === 'inputStreaming' || row.status === 'pendingApproval' || row.status === 'running')
  }
  if (row.kind === 'subagent') return row.backgrounded !== true && row.status === 'running'
  if (row.kind === 'timelineMarker') return row.marker?.status === 'running'
  return false
}

// 轮是否 running。出处：:199-220 —— header 在场时 controlOnly 恒 false（:204），否则以
// header.state==="running" 为权威（:207，终态主轮不被同轮 background 行推回 running）；
// 无 header 时终态 sessionPhase 优先 false（:209-217）；仅旧投影回落 work 行（:219）。
export function resolveAgentTurnRunning(
  draft: { header?: AgentTimelineRow; assistantWorkRows: readonly AgentTimelineRow[] },
  options: BuildAgentTimelineOptions = {},
): boolean {
  if (draft.header) return draft.header.executionKind === 'controlOnly' ? false : draft.header.state === 'running'
  if (options.sessionPhase === 'completedSuccess' || options.sessionPhase === 'completedInterrupted' || options.sessionPhase === 'error') return false
  return draft.assistantWorkRows.some(isCompletionBlockingWorkRowRunning)
}

// 异常终态强制展开工作历史。出处：:222-230（header completedInterrupted/failed；无 header 回落 sessionPhase）。
export function shouldForceOpenAbnormalHistory(header: AgentTimelineRow | undefined, sessionPhase: AgentSessionPhase | undefined): boolean {
  if (header) return header.state === 'completedInterrupted' || header.state === 'failed'
  return sessionPhase === 'completedInterrupted' || sessionPhase === 'error'
}

export type AgentTurnWorkState = 'running' | 'completed' | 'interrupted'
export interface AgentTurnWorkStatus { state: AgentTurnWorkState; durationMs?: number }

// 轮级工作状态。出处：conversationTurnWorkSegments.ts:30-47 —— controlOnly → undefined（:37）；
// hasWork = isRunning || workRows>0 || (executionKind==="agent" ? durationMs!==undefined : (durationMs??0)>0)（:38-41）；
// state = running / interrupted / completed（:44）。
export function resolveAgentTurnWorkStatus(
  header: AgentTimelineRow | undefined, workRows: readonly AgentTimelineRow[],
  isRunning: boolean, durationMs: number | undefined, isInterrupted = false,
): AgentTurnWorkStatus | undefined {
  if (header?.executionKind === 'controlOnly') return undefined
  const hasWork = isRunning || workRows.length > 0 ||
    (header?.executionKind === 'agent' ? durationMs !== undefined : (durationMs ?? 0) > 0)
  if (!hasWork) return undefined
  return { state: isRunning ? 'running' : isInterrupted ? 'interrupted' : 'completed', ...(durationMs !== undefined ? { durationMs } : {}) }
}

// 轮工时。出处：:49-63 —— activeMs 优先（:55）；否则 endedAt-startedAt（:56）；仅 running 且给了 nowMs
// 才吃当前时钟（:59-61，完成态历史工时不得随时间增长）。
export function resolveAgentTurnWorkDurationMs(
  header: AgentTimelineRow | undefined, options: { nowMs?: number }, isRunning: boolean,
): number | undefined {
  if (!header) return undefined
  if (header.activeMs !== undefined) return header.activeMs
  if (header.endedAt !== undefined) return Math.max(header.endedAt - (header.startedAt ?? 0), 0)
  if (isRunning && options.nowMs !== undefined) return Math.max(options.nowMs - (header.startedAt ?? 0), 0)
  return undefined
}

// 单个视觉工作段的工时。出处：:96-132 —— 先按 triggerRow.entityId 命中 header.workSegments 的
// triggerEntityId（:106-110），否则按段序取（:110）；事实有 activeMs/endedAt 就用（:111-112）；
// 事实在场且段在跑且给 nowMs → nowMs-startedAt（:113-115）；单段回落轮工时（:116-122）；
// 旧 guide 快照按 triggerRow.createdAt→nextTriggerRow.createdAt（:125-127）或 nowMs-startedAt（:128-130）。
export function resolveAgentSegmentDurationMs(options: {
  header?: AgentTimelineRow; segmentIndex: number; triggerRow?: AgentTimelineRow; nextTriggerRow?: AgentTimelineRow
  segmentRunning: boolean; segmentCount: number; nowMs?: number
}): number | undefined {
  const fact = (options.triggerRow?.entityId
    ? options.header?.workSegments?.find((c) => c.triggerEntityId === options.triggerRow?.entityId)
    : undefined) ?? options.header?.workSegments?.[options.segmentIndex]
  if (fact?.activeMs !== undefined) return fact.activeMs
  if (fact?.endedAt !== undefined) return Math.max(0, fact.endedAt - fact.startedAt)
  if (fact && options.segmentRunning && options.nowMs !== undefined) return Math.max(0, options.nowMs - fact.startedAt)
  if (options.segmentCount === 1) return resolveAgentTurnWorkDurationMs(options.header, { nowMs: options.nowMs }, options.segmentRunning)
  const startedAt = options.triggerRow?.createdAt ?? options.header?.startedAt
  const endedAt = options.nextTriggerRow?.createdAt ?? options.header?.endedAt
  if (startedAt !== undefined && endedAt !== undefined) return Math.max(0, endedAt - startedAt)
  if (startedAt !== undefined && options.segmentRunning && options.nowMs !== undefined) return Math.max(0, options.nowMs - startedAt)
  return undefined
}

// ── 3. 工作段：guide 切段 + 折叠边界 ─────────────────────────────────────────

// 轮内交错项。出处：conversationTurnFlowItems.ts:11-16（userInput/assistantHistory/assistantText/assistantWork）。
export type AgentFlowItem =
  | { kind: 'userInput'; row: AgentTimelineRow }
  | { kind: 'assistantHistory'; rows: AgentTimelineRow[] }
  | { kind: 'assistantText'; row: AgentTimelineRow; latest: boolean }
  | { kind: 'assistantWork'; rows: AgentTimelineRow[] }

// 轮内工作段。出处：conversationTurnWorkSegments.ts:19-28。
export interface AgentTurnWorkSegment {
  key: string; triggerRow?: AgentTimelineRow; flowItems: AgentFlowItem[]
  assistantWorkRows: AgentTimelineRow[]; assistantHistoryRows: AgentTimelineRow[]; assistantFollowingRows: AgentTimelineRow[]
  assistantHistoryDefaultOpen: boolean; workStatus?: AgentTurnWorkStatus
}

// 按 accepted guide 切视觉工作段：guided 的 userInput 开启新段。出处：conversationTurnWorkSegments.ts:82-94
// （:86 `isUserInputRow(row) && row.guided === true && current.orderedRows.length > 0` 时先推入当前段，再以该行为 triggerRow 开新段）。
export function splitAgentVisualWorkSegments(rows: readonly AgentTimelineRow[]): { orderedRows: AgentTimelineRow[]; triggerRow?: AgentTimelineRow }[] {
  const segments: { orderedRows: AgentTimelineRow[]; triggerRow?: AgentTimelineRow }[] = []
  let current: { orderedRows: AgentTimelineRow[]; triggerRow?: AgentTimelineRow } = { orderedRows: [] }
  for (const row of rows) {
    if (row.kind === 'userInput' && row.guided === true && current.orderedRows.length > 0) {
      segments.push(current)
      current = { orderedRows: [], triggerRow: row }
    }
    current.orderedRows.push(row)
  }
  if (current.orderedRows.length > 0) segments.push(current)
  return segments
}

// 工作段构建：段内历史/跟随以「本段外置展示的最终正文」为界。出处：:134-226 —— 段 key 首段用 turn key、
// 后续 `${key}:guide:${entityId ?? rowId ?? index}`（:191-194）；segmentCompleted = 非末段 || !isRunning（:154）；
// visibleAssistantTextRow 取本段命中的 product latestAssistantTextRow，否则段已完成且末行是 assistantText 时取末行（:155-163）；
// 无可见正文 → 全段 history（:167-171）；有 → 其后 following（:172-173）；段 running = 末段 && isRunning（:174）；
// 段工时（:175-183）；段状态（:184-190）；默认展开（:216-222）。
export function buildAgentTurnWorkSegments(options: {
  key: string; header?: AgentTimelineRow; orderedRows: readonly AgentTimelineRow[]
  assistantTailRows: readonly AgentTimelineRow[]; latestAssistantTextRow?: AgentTimelineRow
  isRunning: boolean; isLastTurn: boolean; isInterrupted: boolean; forceOpenHistory: boolean; timelineOnly: boolean; nowMs?: number
}): AgentTurnWorkSegment[] {
  const visualDrafts = splitAgentVisualWorkSegments(options.orderedRows)
  const tailRowIds = new Set(options.assistantTailRows.map((row) => row.rowId))
  return visualDrafts.map((segment, segmentIndex) => {
    const segmentAssistantRows = segment.orderedRows.filter((row) => row.kind !== 'turnHeader' && row.kind !== 'userInput')
    const segmentTailRows = segmentAssistantRows.filter((row) => tailRowIds.has(row.rowId))
    const segmentFlowRows = segmentAssistantRows.filter((row) => !tailRowIds.has(row.rowId))
    const lastSegmentFlowRow = segmentFlowRows[segmentFlowRows.length - 1]
    const segmentCompleted = segmentIndex < visualDrafts.length - 1 || !options.isRunning
    const productLatest = options.latestAssistantTextRow
      ? segmentFlowRows.find((row) => row.rowId === options.latestAssistantTextRow?.rowId)
      : undefined
    const visibleAssistantTextRow =
      productLatest && productLatest.kind === 'assistantText' ? productLatest
        : segmentCompleted && lastSegmentFlowRow && lastSegmentFlowRow.kind === 'assistantText' ? lastSegmentFlowRow
          : undefined
    const visibleAssistantIndex = visibleAssistantTextRow ? segmentFlowRows.findIndex((row) => row.rowId === visibleAssistantTextRow.rowId) : -1
    const segmentHistoryRows = options.timelineOnly ? [] : visibleAssistantIndex < 0 ? segmentFlowRows : segmentFlowRows.slice(0, visibleAssistantIndex)
    const segmentFollowingRows = visibleAssistantIndex < 0 ? [] : segmentFlowRows.slice(visibleAssistantIndex + 1)
    const segmentRunning = segmentIndex === visualDrafts.length - 1 && options.isRunning
    const segmentDurationMs = resolveAgentSegmentDurationMs({
      header: options.header, segmentIndex, triggerRow: segment.triggerRow,
      nextTriggerRow: visualDrafts[segmentIndex + 1]?.triggerRow, segmentRunning, segmentCount: visualDrafts.length, nowMs: options.nowMs,
    })
    const segmentWorkStatus = resolveAgentTurnWorkStatus(options.header, segmentFlowRows, segmentRunning, segmentDurationMs,
      options.isInterrupted && segmentIndex === visualDrafts.length - 1)
    const segmentKey = segmentIndex === 0 ? options.key
      : `${options.key}:guide:${segment.triggerRow?.entityId ?? segment.triggerRow?.rowId ?? segmentIndex}`
    const flowItems = buildAgentFlowItems({
      orderedRows: segment.orderedRows, assistantHistoryRows: segmentHistoryRows,
      assistantFollowingRows: segmentFollowingRows, assistantTailRows: segmentTailRows,
      ...(visibleAssistantTextRow ? { visibleAssistantTextRow } : {}),
      ...(options.latestAssistantTextRow ? { latestAssistantTextRow: options.latestAssistantTextRow } : {}),
      timelineOnly: options.timelineOnly,
    })
    return {
      key: segmentKey, ...(segment.triggerRow ? { triggerRow: segment.triggerRow } : {}), flowItems,
      assistantWorkRows: segmentAssistantRows, assistantHistoryRows: segmentHistoryRows, assistantFollowingRows: segmentFollowingRows,
      assistantHistoryDefaultOpen: !options.timelineOnly && (options.forceOpenHistory ||
        (options.isLastTurn && segmentWorkStatus?.state === 'running') ||
        (visualDrafts.length === 1 && visibleAssistantTextRow === undefined && segmentFlowRows.length > 0)),
      ...(segmentWorkStatus ? { workStatus: segmentWorkStatus } : {}),
    }
  })
}

// ── 4. flow items（轮内交错顺序）─────────────────────────────────────────────

// 轮内可见顺序。出处：conversationTurnFlowItems.ts:43-91 —— 轮尾 boundary 不进 flow（:68）；assistantText
// 当且仅当它是本段外置正文，或不属于 history，且不属于 following/tail，且非 timelineOnly 时单独成项，
// latest 标记命中 product 最终正文（:69-82）；其余 assistant 工作行按 history/work 相邻同类合并（:83-87、:30-41）。
export function buildAgentFlowItems(options: {
  orderedRows: readonly AgentTimelineRow[]; assistantHistoryRows: readonly AgentTimelineRow[]
  assistantFollowingRows: readonly AgentTimelineRow[]; assistantTailRows: readonly AgentTimelineRow[]
  visibleAssistantTextRow?: AgentTimelineRow; latestAssistantTextRow?: AgentTimelineRow; timelineOnly: boolean
}): AgentFlowItem[] {
  const historyRowIds = new Set(options.assistantHistoryRows.map((row) => row.rowId))
  const followingRowIds = new Set(options.assistantFollowingRows.map((row) => row.rowId))
  const tailRowIds = new Set(options.assistantTailRows.map((row) => row.rowId))
  const items: AgentFlowItem[] = []
  const appendGrouped = (kind: 'assistantHistory' | 'assistantWork', row: AgentTimelineRow) => {
    const previous = items[items.length - 1]
    if (previous?.kind === kind) { previous.rows.push(row); return }
    items.push({ kind, rows: [row] })
  }
  for (const row of options.orderedRows) {
    if (row.kind === 'userInput') { items.push({ kind: 'userInput', row }); continue }
    if (row.kind === 'turnHeader') continue
    if (tailRowIds.has(row.rowId)) continue
    if (row.kind === 'assistantText' &&
      (row.rowId === options.visibleAssistantTextRow?.rowId || !historyRowIds.has(row.rowId)) &&
      !followingRowIds.has(row.rowId) && !tailRowIds.has(row.rowId) && !options.timelineOnly) {
      items.push({ kind: 'assistantText', row, latest: row.rowId === options.latestAssistantTextRow?.rowId })
      continue
    }
    appendGrouped(historyRowIds.has(row.rowId) && !options.timelineOnly ? 'assistantHistory' : 'assistantWork', row)
  }
  return items
}

// ── 5. 工具工作项：复用 agentRowModel 的分组，不重实现 ───────────────────────

// 折叠组内部的工作项。**与 agentRowModel 的复用点**：连续工具聚成 Explore/Terminal/Changes 三档 +
// Agent↔subagent 配对，规则与开关全在 agentRowModel.groupToolRows（移植自
// v4/conversationAssistantWorkItems.ts:272-428）。时间线只补一个它才知道的入参 stageTailIsRunning。
export function buildAgentWorkItems(
  rows: readonly AgentTimelineRow[], options: GroupToolRowsOptions & { stageTailIsRunning?: boolean } = {},
): AgentToolGroupItem[] {
  return groupToolRows(rows as unknown as ToolRowLike[], options)
}

// 段内最后一项是否是工作组且段在跑 —— 传给 buildAgentWorkItems 的 stageTailIsRunning。
// 出处：ConversationTurnGroup.tsx:667-670。
export function resolveStageTailIsRunning(segment: Pick<AgentTurnWorkSegment, 'flowItems' | 'workStatus'>, itemIndex: number): boolean {
  const item = segment.flowItems[itemIndex]
  return segment.workStatus?.state === 'running' && itemIndex === segment.flowItems.length - 1 &&
    (item?.kind === 'assistantHistory' || item?.kind === 'assistantWork')
}

// ── 6. 轮分组：buildAgentTimeline ───────────────────────────────────────────

// 时间线的渲染单元（一轮一个）。出处：conversationTurnRenderUnits.ts:32-70。
export interface AgentTurnRenderUnit {
  key: string; turnId: string; header?: AgentTimelineRow
  visibleUserInputs: AgentTimelineRow[]; assistantWorkRows: AgentTimelineRow[]
  assistantHistoryRows: AgentTimelineRow[]; assistantFollowingRows: AgentTimelineRow[]; assistantTailRows: AgentTimelineRow[]
  browserTurnEndRows: AgentTimelineRow[]; hookInvocations: AgentTimelineRow[]; assistantTextRows: AgentTimelineRow[]
  leadingBoundaryRows: AgentTimelineRow[]; latestAssistantTextRow?: AgentTimelineRow
  flowItems: AgentFlowItem[]; workSegments: AgentTurnWorkSegment[]; renderRows: AgentTimelineRow[]
  isLastTurn: boolean; isRunning: boolean; assistantHistoryDefaultOpen: boolean; timelineOnly: boolean
  workStatus?: AgentTurnWorkStatus; startedAt?: number; workflowLaunch?: unknown
}

interface DraftTurnUnit {
  key: string; turnId: string; header?: AgentTimelineRow
  userInputs: AgentTimelineRow[]; assistantWorkRows: AgentTimelineRow[]; hookInvocations: AgentTimelineRow[]; orderedRows: AgentTimelineRow[]
}

// 草稿单元 key 只依赖协议稳定的 turnId。出处：:360-372（:365 注释：补页时首个可见 rowId 会变，key 不能依赖它）。
function createDraftUnit(turnId: string): DraftTurnUnit {
  return { key: turnId, turnId, userInputs: [], assistantWorkRows: [], hookInvocations: [], orderedRows: [] }
}

// 启动轮的用户行由 run 卡代言，不进可见输入也不进流。出处：workflowLaunchTurn.ts:16-34 —— 元数据来自
// header.workflowLaunch 或首个带 workflowLaunch 的 userInput（:22-29）；isWorkflowLaunchUserInputRow =
// userInput && origin==="workflowLaunch"（:32-34）。
export function resolveAgentWorkflowLaunch(header: AgentTimelineRow | undefined, userInputs: readonly AgentTimelineRow[]): unknown | undefined {
  if (header?.origin !== 'workflowLaunch') return undefined
  return header.workflowLaunch ?? userInputs.find((row) => row.workflowLaunch !== undefined)?.workflowLaunch
}
function isWorkflowLaunchUserInputRow(row: AgentTimelineRow): boolean {
  return row.kind === 'userInput' && row.origin === 'workflowLaunch'
}

function materializeDraftUnit(draft: DraftTurnUnit, index: number, total: number, options: BuildAgentTimelineOptions): AgentTurnRenderUnit {
  const workflowLaunch = resolveAgentWorkflowLaunch(draft.header, draft.userInputs)
  const renderedRows = workflowLaunch === undefined ? draft.orderedRows : draft.orderedRows.filter((row) => !isWorkflowLaunchUserInputRow(row))
  const visibleUserInputs = renderedRows.filter((row) => row.kind === 'userInput')
  const visibleAssistantWorkRows = draft.assistantWorkRows.filter(isVisibleAssistantWorkRow)
  const visibleOrderedRows = renderedRows.filter(isVisibleConversationRow)
  // timelineOnly：无可见输入、有工作行、且工作行全是 timelineMarker（compact/modelChange 维护轮）。出处：:247-250。
  const timelineOnly = visibleUserInputs.length === 0 && visibleAssistantWorkRows.length > 0 &&
    visibleAssistantWorkRows.every((row) => row.kind === 'timelineMarker')
  // modelChange 是轮顶轻边界，渲染在 user 输入之前，不进工作流。出处：:252-259。
  const leadingBoundaryRows = timelineOnly ? [] : visibleAssistantWorkRows.filter(isLightBoundaryMarker)
  const leadingBoundaryRowIds = new Set(leadingBoundaryRows.map((row) => row.rowId))
  const bodyRows = timelineOnly ? visibleAssistantWorkRows : visibleAssistantWorkRows.filter((row) => !isLightBoundaryMarker(row))
  // Browser 自动截图越过 file diff 摘要成为最后内容块，先单独抽出。出处：:260-272。
  const browserTurnEndRows: AgentTimelineRow[] = []
  const nonBrowserRows: AgentTimelineRow[] = []
  if (!timelineOnly) {
    for (const row of bodyRows) { if (isBrowserTurnEndRow(row)) browserTurnEndRows.push(row); else nonBrowserRows.push(row) }
  }
  const { flowRows, tailRows: assistantTailRows } = timelineOnly
    ? { flowRows: [] as AgentTimelineRow[], tailRows: [] as AgentTimelineRow[] }
    : splitAgentTurnTailRows(nonBrowserRows)
  const isLastTurn = index === total - 1
  const isRunning = resolveAgentTurnRunning(draft, options)
  const isInterrupted = draft.header ? draft.header.state === 'completedInterrupted' : options.sessionPhase === 'completedInterrupted'
  const forceOpenHistory = shouldForceOpenAbnormalHistory(draft.header, options.sessionPhase)
  // product turn 的最终正文是唯一 action target：先取带 canFork/canRetry 的 assistantText；否则未在跑
  // 且 flow 末行是 assistantText 时取末行。出处：:289-297。
  const assistantTextRows = flowRows.filter((row) => row.kind === 'assistantText')
  const actionAssistantTextRow = assistantTextRows.find((row) => row.actions?.canFork === true || row.actions?.canRetry === true)
  const lastFlowRow = flowRows[flowRows.length - 1]
  const latestAssistantTextRow = actionAssistantTextRow ?? (!isRunning && lastFlowRow && lastFlowRow.kind === 'assistantText' ? lastFlowRow : undefined)
  const workDurationMs = resolveAgentTurnWorkDurationMs(draft.header, options, isRunning)
  const workStatus = resolveAgentTurnWorkStatus(draft.header, bodyRows, isRunning, workDurationMs, isInterrupted)
  const browserTurnEndRowIds = new Set(browserTurnEndRows.map((row) => row.rowId))
  const orderedBodyRows = visibleOrderedRows.filter((row) => !leadingBoundaryRowIds.has(row.rowId) && !browserTurnEndRowIds.has(row.rowId))
  const workSegments = buildAgentTurnWorkSegments({
    key: draft.key, header: draft.header, orderedRows: orderedBodyRows, assistantTailRows,
    ...(latestAssistantTextRow ? { latestAssistantTextRow } : {}), isRunning, isLastTurn, isInterrupted, forceOpenHistory, timelineOnly,
    ...(options.nowMs !== undefined ? { nowMs: options.nowMs } : {}),
  })
  const mustOpenHistory = workSegments[workSegments.length - 1]?.assistantHistoryDefaultOpen ?? false
  return {
    key: draft.key, turnId: draft.turnId, ...(draft.header ? { header: draft.header } : {}),
    visibleUserInputs, assistantWorkRows: bodyRows,
    assistantHistoryRows: workSegments.flatMap((segment) => segment.assistantHistoryRows),
    assistantFollowingRows: workSegments.flatMap((segment) => segment.assistantFollowingRows),
    assistantTailRows, browserTurnEndRows, hookInvocations: draft.hookInvocations, assistantTextRows, leadingBoundaryRows,
    ...(latestAssistantTextRow ? { latestAssistantTextRow } : {}),
    flowItems: workSegments.flatMap((segment) => segment.flowItems), workSegments, renderRows: visibleOrderedRows,
    isLastTurn, isRunning, assistantHistoryDefaultOpen: mustOpenHistory, timelineOnly,
    ...(workStatus ? { workStatus } : {}), ...(draft.header ? { startedAt: draft.header.startedAt } : {}),
    ...(workflowLaunch !== undefined ? { workflowLaunch } : {}),
  }
}

// 单元是否留下。出处：:374-386 —— 可见输入 / 工作行 / 有 didExecute 的 hook / 轻边界 / workflowLaunch / isRunning 任一在场即留。
export function shouldKeepAgentRenderUnit(unit: AgentTurnRenderUnit): boolean {
  return unit.visibleUserInputs.length > 0 || unit.assistantWorkRows.length > 0 ||
    unit.hookInvocations.some((row) => (row.hookInvocations ?? []).some((inv) => inv.executions.some((execution) => execution.didExecute))) ||
    unit.leadingBoundaryRows.length > 0 || unit.workflowLaunch !== undefined || unit.isRunning
}

// 位置归一：末轮标记与折叠默认态在 keep 过滤后重算。出处：:388-436 —— 段默认展开 = 非 timelineOnly &&
// (forceOpen || (末轮 && 段在跑) || (单段 && 无可见正文 && 段内有工作行))（:412-418）；单元默认展开取末段（:398-403），
// 无 workSegments 时用同一公式的轮级版本（:404-407）。
export function normalizeAgentRenderUnitPosition(
  unit: AgentTurnRenderUnit, index: number, total: number, options: BuildAgentTimelineOptions = {},
): AgentTurnRenderUnit {
  const isLastTurn = index === total - 1
  const forceOpenHistory = shouldForceOpenAbnormalHistory(unit.header, options.sessionPhase)
  const assistantHistoryDefaultOpen = unit.workSegments.length > 0
    ? !unit.timelineOnly && (forceOpenHistory ||
      (isLastTurn && unit.workSegments[unit.workSegments.length - 1]?.workStatus?.state === 'running') ||
      (unit.workSegments.length === 1 && unit.latestAssistantTextRow === undefined && unit.assistantWorkRows.length > 0))
    : !unit.timelineOnly && (forceOpenHistory || (isLastTurn && unit.workStatus?.state === 'running') ||
      (unit.latestAssistantTextRow === undefined && unit.assistantWorkRows.length > 0))
  const workSegments = unit.workSegments.map((segment, segmentIndex, segments) => segmentIndex === segments.length - 1
    ? { ...segment, assistantHistoryDefaultOpen: !unit.timelineOnly && (forceOpenHistory ||
        (isLastTurn && segment.workStatus?.state === 'running') ||
        (segments.length === 1 && unit.latestAssistantTextRow === undefined && segment.assistantWorkRows.length > 0)) }
    : segment)
  if (unit.isLastTurn === isLastTurn && unit.assistantHistoryDefaultOpen === assistantHistoryDefaultOpen) return unit
  return { ...unit, isLastTurn, assistantHistoryDefaultOpen, workSegments }
}

// 行流 → 轮渲染单元。出处：conversationTurnRenderUnits.ts:438-481 —— 按 row.turnId 建/取单元并保插入序（:443-454）；
// turnHeader 只做 header 不进行序（:458-461）；其余先进 orderedRows（:462）再分流：userInput → userInputs（:463-466）、
// hookInvocation → hookInvocations（:467-470）、否则工作行（:471）。
export function buildAgentTimeline(rows: readonly AgentTimelineRow[], options: BuildAgentTimelineOptions = {}): AgentTurnRenderUnit[] {
  const units: DraftTurnUnit[] = []
  const unitByTurnId = new Map<string, DraftTurnUnit>()
  const getOrCreateUnit = (turnId: string) => {
    const existing = unitByTurnId.get(turnId)
    if (existing) return existing
    const unit = createDraftUnit(turnId)
    units.push(unit); unitByTurnId.set(turnId, unit); return unit
  }
  for (const row of rows) {
    const unit = getOrCreateUnit(row.turnId)
    if (row.kind === 'turnHeader') { unit.header = row; continue }
    unit.orderedRows.push(row)
    if (row.kind === 'userInput') { unit.userInputs.push(row); continue }
    if (row.kind === 'hookInvocation') { unit.hookInvocations.push(row); continue }
    unit.assistantWorkRows.push(row)
  }
  const keptUnits = units.map((unit, index) => materializeDraftUnit(unit, index, units.length, options)).filter(shouldKeepAgentRenderUnit)
  return keptUnits.map((unit, index) => normalizeAgentRenderUnitPosition(unit, index, keptUnits.length, options))
}

// ── 7. 折叠语义 ─────────────────────────────────────────────────────────────

// 折叠开关状态。forcedOpen（默认展开）时 toggleable=false（onOpenChange 为 undefined），否则以用户交互为准，
// 且段/默认态变化时复位。出处：ConversationTurnGroup.tsx:645（useState(defaultOpen)）、:646-648（defaultOpen/segment.key
// 变化时 setHistoryOpen 复位）、:655（open = defaultOpen ? true : historyOpen）、:660（forcedOpen 时 onOpenChange undefined）。
export function resolveAgentHistoryFoldState(assistantHistoryDefaultOpen: boolean, userHistoryOpen: boolean): { open: boolean; toggleable: boolean } {
  return { open: assistantHistoryDefaultOpen ? true : userHistoryOpen, toggleable: !assistantHistoryDefaultOpen }
}

// 折叠触发器标签键。出处：ConversationTurnGroup.tsx:578-585（interrupted→stopped / running→workingFor / 有工时→workedFor / 否则 worked）。
export function agentHistoryStatusLabelKey(state: AgentTurnWorkState | undefined, hasDuration: boolean): string {
  if (state === 'interrupted') return 'chat.history.stopped'
  if (state === 'running') return 'chat.history.workingFor'
  return hasDuration ? 'chat.history.workedFor' : 'chat.history.worked'
}

// ── 8. 工时文案（时长分档）───────────────────────────────────────────────────

// 时长分档。出处：conversationWorkDuration.ts:16-39 —— totalSeconds = max(1, round(ms/1000))（:23）；
// 天/时/分/秒逐级取整（:24-27）；秒为 0 且无其它档时补 1 秒（:34-36）；只取前两档（:38）；
// zh-CN 单位前加空格、en 不加（:12）。
export function splitAgentWorkDurationMs(durationMs: number): { days: number; hours: number; minutes: number; seconds: number } {
  const totalSeconds = Math.max(1, Math.round(durationMs / 1000))
  return {
    days: Math.floor(totalSeconds / 86_400), hours: Math.floor((totalSeconds % 86_400) / 3_600),
    minutes: Math.floor((totalSeconds % 3_600) / 60), seconds: totalSeconds % 60,
  }
}

// 时长单位键（取值顺序即拼接顺序）。出处：conversationWorkDuration.ts:30-36。
export const AGENT_WORK_DURATION_UNIT_KEYS = [
  { key: 'days', messageId: 'chat.history.duration.day' }, { key: 'hours', messageId: 'chat.history.duration.hour' },
  { key: 'minutes', messageId: 'chat.history.duration.minute' }, { key: 'seconds', messageId: 'chat.history.duration.second' },
] as const

// ── 9. 运行尾拆分 ───────────────────────────────────────────────────────────

// 只把真正的最后一个 running unit 拆成 normal-flow live tail，其余（含陈旧 running）留在虚拟列表。
// 出处：conversationTimelineLiveTail.ts:15-28 —— liveUnitIndex = length-1（:18）；非 running 则原样（:20-22）；
// 否则 virtualizedUnits = slice(0, liveUnitIndex)（:24）。
export function splitAgentTimelineLiveTail(units: readonly AgentTurnRenderUnit[]): {
  virtualizedUnits: readonly AgentTurnRenderUnit[]; liveUnit: AgentTurnRenderUnit | null; liveUnitIndex: number | null
} {
  const liveUnitIndex = units.length - 1
  const liveUnit = units[liveUnitIndex]
  if (!liveUnit?.isRunning) return { virtualizedUnits: units, liveUnit: null, liveUnitIndex: null }
  return { virtualizedUnits: units.slice(0, liveUnitIndex), liveUnit, liveUnitIndex }
}

// ── 10. 问题导航目录 ────────────────────────────────────────────────────────

export const AGENT_TURN_NAVIGATOR_MIN_WIDTH_PX = 864 // 出处：conversationTurnNavigatorHelpers.ts:69。
export const AGENT_NAVIGATOR_MAX_PREVIEW_CHARS = 220 // 出处：:99。
export const AGENT_NAVIGATOR_MAX_PREVIEW_PARAGRAPHS = 2 // 出处：:100。
export type AgentNavigatorPreviewKind = 'empty' | 'running' | 'text'

export interface AgentTurnNavigatorItem {
  key: string; turnId: string; unitIndex: number; rowId: number
  userPreview: string; assistantPreview: string; assistantPreviewKind: AgentNavigatorPreviewKind; isRunning: boolean
}

// 段落归一：按空行分段、折叠空白、去空、取前 N 段。出处：:102-109。
export function normalizeNavigatorPreviewParagraphs(text: string, maxParagraphs: number): string[] {
  return text.trim().split(/\n\s*\n/u).map((p) => p.replace(/\s+/gu, ' ').trim()).filter(Boolean).slice(0, Math.max(1, maxParagraphs))
}

// 截断：上限最小 8，超出则截到 maxChars-3 去尾空白再加 "..."。出处：:111-117。
export function truncateNavigatorPreview(text: string, maxChars: number): string {
  const limit = Math.max(8, maxChars)
  return text.length <= limit ? text : `${text.slice(0, limit - 3).trimEnd()}...`
}

// 预览正文：无段落用 fallback。出处：:119-135。
export function buildNavigatorPreviewText(options: {
  texts: readonly string[]; fallback: string; maxPreviewChars: number; maxPreviewParagraphs: number
}): string {
  const paragraphs = normalizeNavigatorPreviewParagraphs(options.texts.join('\n\n'), options.maxPreviewParagraphs)
  return paragraphs.length === 0 ? options.fallback : truncateNavigatorPreview(paragraphs.join('\n'), options.maxPreviewChars)
}

// 助手预览：有正文→text，在跑→running，否则 empty。出处：:137-167。
export function buildNavigatorAssistantPreview(
  unit: Pick<AgentTurnRenderUnit, 'assistantTextRows' | 'isRunning'>,
  options: { assistantEmptyPreview: string; assistantRunningPreview: string; maxPreviewChars: number; maxPreviewParagraphs: number },
): { assistantPreview: string; assistantPreviewKind: AgentNavigatorPreviewKind } {
  if (unit.assistantTextRows.length > 0) {
    return { assistantPreviewKind: 'text', assistantPreview: buildNavigatorPreviewText({
      texts: unit.assistantTextRows.map((row) => row.text ?? ''), fallback: options.assistantEmptyPreview,
      maxPreviewChars: options.maxPreviewChars, maxPreviewParagraphs: options.maxPreviewParagraphs }) }
  }
  if (unit.isRunning) return { assistantPreview: options.assistantRunningPreview, assistantPreviewKind: 'running' }
  return { assistantPreview: options.assistantEmptyPreview, assistantPreviewKind: 'empty' }
}

// 导航目录项：每轮只按 realUser query 建项；timelineOnly / 无 realUser 的轮跳过。出处：:169-211 ——
// realUserInputs 过滤（:182）；timelineOnly 或无 realUser 返回 []（:183-185）；key = `${unit.key}:query:${entityId ?? rowId}`（:194）；
// isRunning 仅该轮最后一条 query（:206-208）。
export function buildAgentTurnNavigatorItems(units: readonly AgentTurnRenderUnit[], options: {
  assistantEmptyPreview: string; assistantRunningPreview: string; userFallbackPreview: string
  maxPreviewChars?: number; maxPreviewParagraphs?: number
}): AgentTurnNavigatorItem[] {
  const resolved = { ...options,
    maxPreviewChars: options.maxPreviewChars ?? AGENT_NAVIGATOR_MAX_PREVIEW_CHARS,
    maxPreviewParagraphs: options.maxPreviewParagraphs ?? AGENT_NAVIGATOR_MAX_PREVIEW_PARAGRAPHS }
  return units.flatMap((unit, unitIndex) => {
    const realUserInputs = unit.visibleUserInputs.filter((row) => row.origin === 'realUser')
    if (unit.timelineOnly || realUserInputs.length === 0) return []
    const { assistantPreview, assistantPreviewKind } = buildNavigatorAssistantPreview(unit, resolved)
    return realUserInputs.map((row, queryIndex) => ({
      key: `${unit.key}:query:${row.entityId ?? row.rowId}`, turnId: unit.turnId, unitIndex, rowId: row.rowId,
      userPreview: buildNavigatorPreviewText({ texts: [row.text ?? ''], fallback: resolved.userFallbackPreview,
        maxPreviewChars: resolved.maxPreviewChars, maxPreviewParagraphs: resolved.maxPreviewParagraphs }),
      assistantPreview, assistantPreviewKind, isRunning: unit.isRunning && queryIndex === realUserInputs.length - 1,
    }))
  })
}

// rail 渲染门：少于 2 项返回 null。出处：ConversationTurnNavigator.tsx:133-135。
export function shouldRenderAgentTurnNavigator(itemCount: number): boolean { return itemCount >= 2 }

// 目录补齐资格。出处：conversationTurnNavigatorHelpers.ts:77-89 —— canLoadOlder && !loadingOlder &&
// hasLoadHandler && containerWidthPx >= 864。
export function shouldHydrateAgentTurnNavigatorDirectory(params: {
  canLoadOlder: boolean; containerWidthPx: number; hasLoadHandler: boolean; loadingOlder: boolean
}): boolean {
  return params.canLoadOlder && !params.loadingOlder && params.hasLoadHandler &&
    params.containerWidthPx >= AGENT_TURN_NAVIGATOR_MIN_WIDTH_PX
}

// 补齐失败重试退避：1→250ms、2→1000ms，之后放弃。出处：:91-97。
export function resolveAgentTurnNavigatorHydrationRetryDelayMs(failedAttemptCount: number): number | null {
  if (failedAttemptCount === 1) return 250
  if (failedAttemptCount === 2) return 1_000
  return null
}

function finiteNonNegative(value: number): number { return Number.isFinite(value) ? Math.max(0, value) : 0 }
function findLastItem<T>(items: readonly T[], predicate: (item: T) => boolean): T | undefined {
  for (let index = items.length - 1; index >= 0; index -= 1) { const item = items[index]; if (item !== undefined && predicate(item)) return item }
  return undefined
}

export interface AgentNavigatorVirtualItem { index: number; start: number; size: number }

// 当前活动轮：取与视口相交且起点离视口顶最近的项所属 unitIndex；无交集时按顶部虚拟项就近回落。出处：:217-268。
export function resolveAgentTurnNavigatorActiveUnitIndex(params: {
  items: readonly AgentTurnNavigatorItem[]; virtualItems: readonly AgentNavigatorVirtualItem[]
  scrollOffsetPx: number; viewportHeightPx: number
}): number | undefined {
  if (params.items.length === 0) return undefined
  const itemByUnitIndex = new Map(params.items.map((item) => [item.unitIndex, item]))
  const viewportStart = finiteNonNegative(params.scrollOffsetPx)
  const viewportEnd = viewportStart + Math.max(1, finiteNonNegative(params.viewportHeightPx))
  let activeUnitIndex: number | undefined
  let activeDistance = Number.POSITIVE_INFINITY
  for (const virtualItem of params.virtualItems) {
    const item = itemByUnitIndex.get(virtualItem.index)
    if (!item) continue
    const rowStart = finiteNonNegative(virtualItem.start)
    const rowEnd = rowStart + Math.max(1, finiteNonNegative(virtualItem.size))
    if (rowEnd < viewportStart || rowStart > viewportEnd) continue
    const distanceToViewportStart = rowStart <= viewportStart ? 0 : rowStart - viewportStart
    if (distanceToViewportStart < activeDistance) { activeUnitIndex = item.unitIndex; activeDistance = distanceToViewportStart }
  }
  if (activeUnitIndex !== undefined) return activeUnitIndex
  const topVirtualIndex = params.virtualItems.find((item) => {
    const rowStart = finiteNonNegative(item.start)
    return rowStart + Math.max(1, finiteNonNegative(item.size)) >= viewportStart && rowStart <= viewportEnd
  })?.index
  if (topVirtualIndex === undefined) return params.items[0]?.unitIndex
  return params.items.find((item) => item.unitIndex >= topVirtualIndex)?.unitIndex ??
    findLastItem(params.items, (item) => item.unitIndex <= topVirtualIndex)?.unitIndex ?? params.items[0]?.unitIndex
}

export interface AgentNavigatorQueryPosition { rowId: number; start: number; end: number }

// 当前活动 query：与视口相交者里起点最接近视口顶的一条；无交集时取视口顶之前最后一条，再否则取之后第一条。出处：:270-305。
export function resolveAgentTurnNavigatorActiveQueryRowId(params: {
  positions: readonly AgentNavigatorQueryPosition[]; scrollOffsetPx: number; viewportHeightPx: number
}): number | undefined {
  if (params.positions.length === 0) return undefined
  const viewportStart = finiteNonNegative(params.scrollOffsetPx)
  const viewportEnd = viewportStart + Math.max(1, finiteNonNegative(params.viewportHeightPx))
  const normalized = params.positions.map((position) => {
    const start = finiteNonNegative(position.start)
    return { rowId: position.rowId, start, end: Math.max(start, finiteNonNegative(position.end)) }
  }).sort((left, right) => left.start - right.start || left.rowId - right.rowId)
  const visible = normalized.filter((position) => position.end >= viewportStart && position.start <= viewportEnd)
  if (visible.length > 0) {
    return visible.reduce((nearest, candidate) =>
      Math.abs(candidate.start - viewportStart) < Math.abs(nearest.start - viewportStart) ? candidate : nearest).rowId
  }
  return findLastItem(normalized, (position) => position.start <= viewportStart)?.rowId ??
    normalized.find((position) => position.start > viewportStart)?.rowId
}

export type AgentNavigatorBarTone = 'idle' | 'mid' | 'near' | 'peak'
export type AgentNavigatorBarColorTone = 'focus' | 'muted'
export interface AgentNavigatorBarVisualState { colorTone: AgentNavigatorBarColorTone; opacity: number; scaleX: number; tone: AgentNavigatorBarTone }

// rail 山峰视觉：焦点 scaleX 2.6/opacity 1，距离 1→1.7/0.86，距离 2→1.25/0.72，其余 1/0.58。出处：:307-326。
export function resolveAgentTurnNavigatorBarVisualState(params: { itemIndex: number; visualFocusItemIndex: number | undefined }): AgentNavigatorBarVisualState {
  if (params.visualFocusItemIndex === undefined) return { colorTone: 'muted', opacity: 0.58, scaleX: 1, tone: 'idle' }
  const distance = Math.abs(params.itemIndex - params.visualFocusItemIndex)
  if (distance === 0) return { colorTone: 'focus', opacity: 1, scaleX: 2.6, tone: 'peak' }
  if (distance === 1) return { colorTone: 'muted', opacity: 0.86, scaleX: 1.7, tone: 'near' }
  if (distance === 2) return { colorTone: 'muted', opacity: 0.72, scaleX: 1.25, tone: 'mid' }
  return { colorTone: 'muted', opacity: 0.58, scaleX: 1, tone: 'idle' }
}

// 视觉焦点 = 交互项（hover/focus），无交互即 undefined。出处：:328-332。
export function resolveAgentTurnNavigatorVisualFocusItemIndex(params: { interactionItemIndex: number | undefined }): number | undefined {
  return params.interactionItemIndex
}

// ── 11. 跳转语义 ────────────────────────────────────────────────────────────

export const AGENT_NAVIGATOR_ALIGN_RETRY_ATTEMPTS = 12 // query 锚点挂载重试上限（帧）。出处：ConversationTimeline.tsx:1334。

// 跳转计划。出处：ConversationTimeline.tsx:1283-1352 —— 目标 query 行已挂载则直接滚到该行（:1292-1312）；
// 否则若目标就是 live tail → 滚 live tail 顶（:1319-1326）；再否则 virtualizer.scrollToIndex(unitIndex,
// {align:"start", behavior:"auto"})（:1327-1332）；随后按帧重试对齐已挂载 query（:1334-1349）。
export function resolveAgentNavigatorJumpPlan(params: {
  target: { unitIndex: number; rowId: number }; liveUnitIndex: number | null; queryRowMounted: boolean
}): { kind: 'queryRow' } | { kind: 'liveTail' } | { kind: 'unitIndex'; align: 'start'; behavior: 'auto' } {
  if (params.queryRowMounted) return { kind: 'queryRow' }
  if (params.target.unitIndex === params.liveUnitIndex) return { kind: 'liveTail' }
  return { kind: 'unitIndex', align: 'start', behavior: 'auto' }
}

// 点击时的滚动动画由 prefers-reduced-motion 裁决。出处：ConversationTurnNavigator.tsx:193-198。
export function resolveAgentNavigatorJumpBehavior(prefersReducedMotion: boolean): 'auto' | 'smooth' {
  return prefersReducedMotion ? 'auto' : 'smooth'
}

// 滚到某一轮。出处：ConversationTimeline.tsx:1377-1401 —— 目标是 live tail 时滚 live tail 顶；
// 否则 virtualizer.scrollToIndex(unitIndex, {align:"start", behavior})。
export function resolveAgentScrollToUnitPlan(params: { unitIndex: number; liveUnitIndex: number | null }):
  { kind: 'liveTail' } | { kind: 'unitIndex'; align: 'start' } {
  return params.unitIndex === params.liveUnitIndex ? { kind: 'liveTail' } : { kind: 'unitIndex', align: 'start' }
}

// ── 12. 轮尾 loading 门 ─────────────────────────────────────────────────────

// 轮尾 ChatLoading 是否显示。出处：chatLoadingVisibility.ts:38-58 —— !isLastTurn || !isRunning ||
// blockedByActiveWork || blockedByInteraction → false（:51）；行级回落：有 pendingApproval 工具行、
// 或有 running 的 compact/goalVerify marker → false（:56-57）。
export function shouldShowAgentTurnChatLoading(params: {
  blockedByActiveWork: boolean; blockedByInteraction: boolean; isLastTurn: boolean; isRunning: boolean; rows: readonly AgentTimelineRow[]
}): boolean {
  if (!params.isLastTurn || !params.isRunning || params.blockedByActiveWork || params.blockedByInteraction) return false
  return !params.rows.some((row) => row.kind === 'toolCall' && row.status === 'pendingApproval') &&
    !params.rows.some((row) => row.kind === 'timelineMarker' &&
      ((row.marker?.type === 'compact' && row.marker.status === 'running') ||
        (row.marker?.type === 'goalVerify' && row.marker.outcome === 'running')))
}

// ── 13. turnHeader ──────────────────────────────────────────────────────────

// 轮头在时间线里**不作为行渲染**：isVisibleConversationRow 对 turnHeader 返回 false
// （conversationTurnRenderUnits.ts:121），TurnGroup 只把它当容器身份与状态源
// （ConversationTurnGroup.tsx:1303-1305 的 data-turn-id/data-turn-key）。若单独渲染
// （ConversationRowView 的行分发），文案是 `turn · {origin} · {state}`。出处：ConversationRowView.tsx:1627-1635（:1633）。
export function resolveAgentTurnHeaderDisplay(header: AgentTimelineRow | undefined): { origin: string; state: string; text: string } | null {
  if (!header || header.kind !== 'turnHeader') return null
  const origin = header.origin ?? ''
  const state = header.state ?? ''
  return { origin, state, text: `turn · ${origin} · ${state}` }
}
export const AGENT_TURN_HEADER_RENDERS_IN_FLOW = false // 出处：conversationTurnRenderUnits.ts:121。

// ── 14. Agent 工具行下钻 ────────────────────────────────────────────────────

export interface AgentSubagentDrilldownRequest {
  rootSessionId: string; parentSessionId: string; childSessionId: string; subagentType: string; title: string
}

// 子会话下钻请求。出处：ConversationAgentToolCallRow.tsx:10-37 —— 门是 childSessionId && context.sessionId &&
// context.onOpenSubagentSession（:25-27，:51-53 的 canOpenChildSession 同判据）；rootSessionId 回落 parentSessionId（:30）；
// 请求体含 subagentType 与 title（:29-35）。title 由 getAgentPrimaryText 从 toolCall 解析（:50），属渲染层能力，本层只透传。
export function resolveAgentSubagentDrilldown(params: {
  childSessionId?: string; parentSessionId?: string | null; rootSessionId?: string | null
  hasOpenHandler: boolean; subagentType: string; title: string
}): AgentSubagentDrilldownRequest | null {
  const parentSessionId = params.parentSessionId
  if (!params.childSessionId || !parentSessionId || !params.hasOpenHandler) return null
  return { rootSessionId: params.rootSessionId ?? parentSessionId, parentSessionId,
    childSessionId: params.childSessionId, subagentType: params.subagentType, title: params.title }
}

// 配对成功的 Agent 工具行才可下钻；配对的 subagent 行不再单独渲染。出处：conversationAssistantWorkItems.ts:317-333。
export function isAgentToolCallItem(item: AgentToolGroupItem): boolean { return item.kind === 'agentToolCall' }

// ── 15. 文案（zh-CN 原文）────────────────────────────────────────────────────

// 时间线用到的 zh-CN 文案。全部逐字取自 i18n/locales/zh-CN.ts：:4322-4325（chat.history.workingFor/workedFor/
// worked/stopped）、:4326-4329（时长单位）、:1882-1886（chat.turnNavigator.*）、:4272（chat.scrollToBottom）。
// 注：`chat.timeline.*` 与 `chat.turn.*` 两个键族在上游 zh-CN.ts 里**不存在**（grep 计数 0），时间线文案实际落在
// chat.history.* / chat.turnNavigator.* 下，故不造这两个族。
export const AGENT_TIMELINE_I18N = {
  'chat.history.workingFor': '工作中 {duration}', 'chat.history.workedFor': '已工作 {duration}',
  'chat.history.worked': '已处理', 'chat.history.stopped': '已停止',
  'chat.history.duration.day': '天', 'chat.history.duration.hour': '时',
  'chat.history.duration.minute': '分', 'chat.history.duration.second': '秒',
  'chat.turnNavigator.label': '对话问题导航', 'chat.turnNavigator.jumpToQuery': '跳转到第 {index} 条问题',
  'chat.turnNavigator.emptyAssistant': '暂无助手正文', 'chat.turnNavigator.runningAssistant': '助手仍在工作',
  'chat.turnNavigator.userFallback': '用户输入', 'chat.scrollToBottom': '滚动到底部',
} as const

// 导航 rail 的 aria/文案键。出处：ConversationTurnNavigator.tsx:139、:176-179、:63-71。
export const AGENT_NAVIGATOR_LABEL_KEYS = {
  label: 'chat.turnNavigator.label', jumpToQuery: 'chat.turnNavigator.jumpToQuery',
  emptyAssistant: 'chat.turnNavigator.emptyAssistant', runningAssistant: 'chat.turnNavigator.runningAssistant',
  userFallback: 'chat.turnNavigator.userFallback',
} as const

// ── 16. 无法核实 ────────────────────────────────────────────────────────────

// 指不到出处的项，不做实现。
export const AGENT_TIMELINE_UNVERIFIED = [
  '虚拟滚动本身（@tanstack/react-virtual、动态测高、scrollTop 锚定、prepend 平移、滚动记忆）：ConversationTimeline.tsx:722-1662 全是 React/DOM 实例状态，纯逻辑层无从复刻；本层只给跳转计划（resolveAgentNavigatorJumpPlan / resolveAgentScrollToUnitPlan）。',
  'Agent 工具行的 title：ConversationAgentToolCallRow.tsx:50 走 getAgentPrimaryText(toolCall)，是渲染层解析器；本层只透传 title。',
  'CUA 分组（conversationCuaGroups.ts:29-281）：它作用在 flow-items 层（prepareCuaGroupFlowItems），agentRowModel 只登记了 OFFICIAL_CUA_TOOL_PREFIXES 与开关，本层不做 CUA 分组。',
  '折叠动画与 gap 盒模型（ConversationTurnGroup.tsx:658-665 的 Radix Collapsible className）：纯样式，不进逻辑层。',
  '`chat.timeline.*` / `chat.turn.*` 键族：上游 zh-CN.ts 不存在（grep 计数 0），不造。',
] as const
