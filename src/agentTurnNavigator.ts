// ZCode 对话「轮次导航」的**纯逻辑**复刻 —— 2026-10-07 从 `src/agentConversationChrome.ts`
// 按职责拆出（那一份把「头部 / 队列 / 引导 / 状态面板」与「轮次导航 / 额度条」挤在一个模块里）。
// 零 Vue / 零 DOM / 零 import：只放形状、派生与状态机，组件里只做接线。
// 每条规则都在注释里给 .tools/ZCode 的 文件:行号（逐条打开确认过那一行存在）。
// 上游（.tools/ZCode/packages/ui/src/v4）：ConversationTurnNavigator.tsx、
// conversationTurnNavigatorHelpers.ts、conversationTurnRenderUnits.ts。

// ── 6. 轮次导航（ConversationTurnNavigator + helpers）──────────────────────
/** rail 出现的最小容器宽（helpers:69；类名 @min-[864px]/conversation）。 */
export const AGENT_TURN_NAVIGATOR_MIN_WIDTH_PX = 864
/** 目录项少于两条整块不渲染（ConversationTurnNavigator.tsx:133-135）。 */
export function turnNavigatorVisible(itemCount: number): boolean {
  return itemCount >= 2
}
/** 预览截断口径（helpers:99-100）。 */
export const AGENT_TURN_NAVIGATOR_MAX_PREVIEW_CHARS = 220
export const AGENT_TURN_NAVIGATOR_MAX_PREVIEW_PARAGRAPHS = 2
/** 助手预览种类（helpers:3）。 */
export const AGENT_TURN_NAVIGATOR_ASSISTANT_PREVIEW_KINDS = ['empty', 'running', 'text'] as const
/** 目录项（helpers:5-14）。 */
export interface AgentTurnNavigatorItem {
  key: string
  turnId: string
  unitIndex: number
  rowId: number
  userPreview: string
  assistantPreview: string
  assistantPreviewKind: (typeof AGENT_TURN_NAVIGATOR_ASSISTANT_PREVIEW_KINDS)[number]
  isRunning: boolean
}
/** 渲染单元的最小可见子集（conversationTurnRenderUnits.ts:30-64）。 */
export interface AgentTurnRenderUnitLike {
  key: string
  turnId: string
  timelineOnly: boolean
  isRunning: boolean
  visibleUserInputs: readonly { rowId: number; entityId?: string; text: string; origin: string }[]
  assistantTextRows: readonly { text: string }[]
}
/** 目录项 key：`${unit.key}:query:${entityId ?? rowId}`（helpers:194）。 */
export function turnNavigatorItemKey(unitKey: string, row: { entityId?: string; rowId: number }): string {
  return `${unitKey}:query:${row.entityId ?? row.rowId}`
}
/** 建目录（helpers:169-211 逐行复刻）。timelineOnly 或没有 realUser 输入的单元整条跳过（provider 的
 *  role=user 还含 background / goal / mailbox 等系统上下文，只有 realUser 是用户主动 query）；导航
 *  粒度是**每条 query** 而非 product turn；同一 running turn 只有最后一条 query 带 running 强调。 */
export function buildTurnNavigatorItems(
  units: readonly AgentTurnRenderUnitLike[],
  previews: { assistantEmptyPreview: string; assistantRunningPreview: string; userFallbackPreview: string },
): AgentTurnNavigatorItem[] {
  const items: AgentTurnNavigatorItem[] = []
  units.forEach((unit, unitIndex) => {
    const realUserInputs = unit.visibleUserInputs.filter(row => row.origin === 'realUser')
    if (unit.timelineOnly || realUserInputs.length === 0) return
    const assistantPreviewKind = unit.assistantTextRows.length > 0 ? 'text' : unit.isRunning ? 'running' : 'empty'
    const assistantPreview = assistantPreviewKind === 'text'
      ? unit.assistantTextRows.map(row => row.text).join('\n\n')
      : assistantPreviewKind === 'running'
        ? previews.assistantRunningPreview
        : previews.assistantEmptyPreview
    realUserInputs.forEach((row, queryIndex) => {
      items.push({
        key: turnNavigatorItemKey(unit.key, row),
        turnId: unit.turnId,
        unitIndex,
        rowId: row.rowId,
        userPreview: row.text || previews.userFallbackPreview,
        assistantPreview,
        assistantPreviewKind,
        isRunning: unit.isRunning && queryIndex === realUserInputs.length - 1,
      })
    })
  })
  return items
}
/** 虚拟项（helpers:24-28）。 */
export interface AgentTurnNavigatorVirtualItem {
  index: number
  start: number
  size: number
}
/** 当前活动单元（helpers:217-268）：取与视口相交、且距视口顶最近的那一项所在 unit；都不相交时回退
 *  到第一条 unitIndex >= 顶部虚拟 index 的项，再退到首项。 */
export function resolveTurnNavigatorActiveUnitIndex(params: {
  items: readonly AgentTurnNavigatorItem[]
  virtualItems: readonly AgentTurnNavigatorVirtualItem[]
  scrollOffsetPx: number
  viewportHeightPx: number
}): number | undefined {
  if (params.items.length === 0) return undefined
  const itemByUnitIndex = new Map(params.items.map(item => [item.unitIndex, item]))
  const viewportStart = Math.max(0, params.scrollOffsetPx)
  const viewportEnd = viewportStart + Math.max(1, params.viewportHeightPx)
  let activeUnitIndex: number | undefined
  let activeDistance = Number.POSITIVE_INFINITY
  for (const virtualItem of params.virtualItems) {
    const item = itemByUnitIndex.get(virtualItem.index)
    if (!item) continue
    const rowStart = Math.max(0, virtualItem.start)
    const rowEnd = rowStart + Math.max(1, virtualItem.size)
    if (rowEnd < viewportStart || rowStart > viewportEnd) continue
    const distance = rowStart <= viewportStart ? 0 : rowStart - viewportStart
    if (distance < activeDistance) {
      activeUnitIndex = item.unitIndex
      activeDistance = distance
    }
  }
  if (activeUnitIndex !== undefined) return activeUnitIndex
  const topVirtualIndex = params.virtualItems.find(item => {
    const rowStart = Math.max(0, item.start)
    return rowStart + Math.max(1, item.size) >= viewportStart && rowStart <= viewportEnd
  })?.index
  if (topVirtualIndex === undefined) return params.items[0]?.unitIndex
  return (
    params.items.find(item => item.unitIndex >= topVirtualIndex)?.unitIndex ??
    [...params.items].reverse().find(item => item.unitIndex <= topVirtualIndex)?.unitIndex ??
    params.items[0]?.unitIndex
  )
}
/** 当前活动 query row（helpers:270-305）：优先取与视口相交且起点最接近视口顶的那条；都不相交时取
 *  最后一条起点在视口顶之前的，再退到之后第一条。 */
export function resolveTurnNavigatorActiveQueryRowId(params: {
  positions: readonly { rowId: number; start: number; end: number }[]
  scrollOffsetPx: number
  viewportHeightPx: number
}): number | undefined {
  if (params.positions.length === 0) return undefined
  const viewportStart = Math.max(0, params.scrollOffsetPx)
  const viewportEnd = viewportStart + Math.max(1, params.viewportHeightPx)
  const normalized = params.positions
    .map(position => {
      const start = Math.max(0, position.start)
      return { rowId: position.rowId, start, end: Math.max(start, Math.max(0, position.end)) }
    })
    .sort((left, right) => left.start - right.start || left.rowId - right.rowId)
  const visible = normalized.filter(position => position.end >= viewportStart && position.start <= viewportEnd)
  if (visible.length > 0) {
    return visible.reduce((nearest, candidate) =>
      Math.abs(candidate.start - viewportStart) < Math.abs(nearest.start - viewportStart) ? candidate : nearest,
    ).rowId
  }
  const before = [...normalized].reverse().find(position => position.start <= viewportStart)
  return before ? before.rowId : normalized.find(position => position.start > viewportStart)?.rowId
}
/** rail 条视觉态（helpers:307-326）：距离 0 是峰，1 / 2 逐级衰减，其余 idle。 */
export function resolveTurnNavigatorBarVisualState(params: { itemIndex: number; visualFocusItemIndex: number | undefined }): {
  colorTone: 'focus' | 'muted'
  opacity: number
  scaleX: number
  tone: 'idle' | 'mid' | 'near' | 'peak'
} {
  if (params.visualFocusItemIndex === undefined) return { colorTone: 'muted', opacity: 0.58, scaleX: 1, tone: 'idle' }
  const distance = Math.abs(params.itemIndex - params.visualFocusItemIndex)
  if (distance === 0) return { colorTone: 'focus', opacity: 1, scaleX: 2.6, tone: 'peak' }
  if (distance === 1) return { colorTone: 'muted', opacity: 0.86, scaleX: 1.7, tone: 'near' }
  if (distance === 2) return { colorTone: 'muted', opacity: 0.72, scaleX: 1.25, tone: 'mid' }
  return { colorTone: 'muted', opacity: 0.58, scaleX: 1, tone: 'idle' }
}
/** 视觉焦点 = 交互项（helpers:328-332 是恒等函数，留一层便于将来换语义）。 */
export function resolveTurnNavigatorVisualFocusItemIndex(interactionItemIndex: number | undefined): number | undefined {
  return interactionItemIndex
}
/** 跳转动作：reduced motion 时用 auto，否则 smooth（ConversationTurnNavigator.tsx:195-197）。 */
export function turnNavigatorJumpBehavior(prefersReducedMotion: boolean): 'auto' | 'smooth' {
  return prefersReducedMotion ? 'auto' : 'smooth'
}
/** 目录水合条件（helpers:77-89）：可加载更早、未在加载、有 handler、容器够宽。 */
export function shouldHydrateTurnNavigatorDirectory(params: {
  canLoadOlder: boolean
  containerWidthPx: number
  hasLoadHandler: boolean
  loadingOlder: boolean
}): boolean {
  return params.canLoadOlder && !params.loadingOlder && params.hasLoadHandler && params.containerWidthPx >= AGENT_TURN_NAVIGATOR_MIN_WIDTH_PX
}
/** 水合失败退避：第一次 250ms，第二次 1000ms，之后放弃（helpers:91-97）。 */
export function turnNavigatorHydrationRetryDelayMs(failedAttemptCount: number): number | null {
  if (failedAttemptCount === 1) return 250
  if (failedAttemptCount === 2) return 1000
  return null
}
