// ZCode 对话「头部 / 队列 / 待办引导 / 状态面板 / 轮次导航 / 额度条」的**纯逻辑**复刻。
// 零 Vue / 零 DOM / 零 import：只放形状、派生与状态机，组件里只做接线。每条规则与文案都在
// 注释里给 .tools/ZCode 的 文件:行号（逐条打开确认过那一行存在）。
// 上游（.tools/ZCode/packages/）：ui/src/v4/{ConversationHeader,ConversationQueuePanel,pendingGuideProjection,
// ConversationPendingGuideList,ConversationStatusPanel,conversationStatusPanelModel,conversationLayout,
// ConversationTurnNavigator,conversationTurnNavigatorHelpers,ConversationQuotaBanner,sessionQuotaBannerState,
// SessionPane,ConversationComposer}.ts(x)、ui/src/v4/composer/followupModeSettings.ts、
// shared/src/protocol.ts、shared/src/zcode-protocol-v4/{input-intent,snapshot,command}.ts、
// shared/src/test-ids.ts、ui/src/i18n/locales/zh-CN.ts。

/** ZCode UI 源码根（相对仓库根）。 */
export const AGENT_CHROME_UI_SRC = '.tools/ZCode/packages/ui/src'
/** ZCode 共享包源码根（test-id 常量、命令表在这里）。 */
export const AGENT_CHROME_SHARED_SRC = '.tools/ZCode/packages/shared/src'
/** zh-CN 词条文件（相对仓库根）。 */
export const AGENT_CHROME_LOCALE_FILE = `${AGENT_CHROME_UI_SRC}/i18n/locales/zh-CN.ts`

// ── 文案表（键 / 原文 / 行号）──────────────────────────────────────────────
export interface AgentChromeTextEntry {
  readonly key: string
  readonly zh: string
  readonly at: string
  /** 消费方式。`literal` = 源码里有字面量键；`dynamic` = 模板串拼键；`none` = 全树无消费方。 */
  readonly consumer: 'literal' | 'dynamic' | 'none'
}
function t(key: string, zh: string, line: number, consumer: 'literal' | 'dynamic' | 'none' = 'literal'): AgentChromeTextEntry {
  return { key, zh, at: `${AGENT_CHROME_LOCALE_FILE}:${line}`, consumer }
}

export const AGENT_CHROME_TEXTS: readonly AgentChromeTextEntry[] = [
  // 头部 pane chrome：ConversationHeader.tsx:60,107,108 的 intl 实参
  t('v4Pane.remote', '远程', 1763),
  t('v4Pane.closePane', '关闭窗格', 1761),
  t('v4Pane.closePaneTitle', '关闭窗格（会话继续运行）', 1762),
  t('v4Pane.splitRight', '向右拆分', 1754),
  t('v4Pane.splitRightTitle', '在右侧拆分出新窗格（新会话）', 1758),
  t('v4Pane.splitDown', '向下拆分', 1759),
  t('v4Pane.splitDownTitle', '在下方拆分出新窗格（新会话）', 1760),
  // 队列：ConversationQueuePanel.tsx:183,191,232,236,243,252,259,339-345,354,359
  t('chat.queue.title', '待发送消息（{count}）', 4342, 'none'),
  t('chat.queue.enqueue', '加入队列', 4341),
  t('chat.queue.enqueue.description', '把当前草稿加入发送队列，等这一轮回复结束后自动继续。', 5446, 'none'),
  t('chat.queue.drag', '拖拽排序', 4343),
  t('chat.queue.sendNow', '立即', 4344),
  t('chat.queue.runNow', '立即', 4346),
  t('chat.queue.edit', '编辑', 4347),
  t('chat.queue.remove', '移除待发送消息', 4350),
  t('chat.queue.editDraftConflict', '请先发送或清空当前草稿，再编辑队列消息。', 4348),
  t('chat.queue.editRestoreFailed', '未能把队列消息退回输入框，请重试。', 4349),
  t('chat.queue.paused.stopped', '由于你中断了当前响应，队列已暂停', 4352),
  t('chat.queue.paused.error', '由于当前响应出错，队列已暂停（内容未丢失）', 4353),
  t('chat.queue.paused.generic', '队列已暂停', 4354),
  t('chat.queue.resume', '继续', 4355),
  t('chat.queue.resume.description', '继续按顺序自动发送队列中的内容', 4356),
  // held queue 确认框：ConversationComposer.tsx:2346,2350,2367,2378
  t('chat.queue.sendConfirm.title', '发送消息？', 4357),
  t('chat.queue.sendConfirm.description', '你即将发送一条消息。要清除之前已排队的 {count} 条消息吗？', 4358),
  t('chat.queue.sendConfirm.clear', '清空队列', 4359),
  t('chat.queue.sendConfirm.keep', '发送消息', 4360),
  // 待办引导 / turn steer：ConversationPendingGuideList.tsx:37
  t('chat.message.turnSteer.pending', '等待引导当前任务…', 4362),
  t('chat.message.turnSteer.guided', '已引导对话', 4361, 'none'),
  t('chat.queue.turnSteer.steering', '正在引导对话', 4351, 'none'),
  // queue / guide 两档：followupModeSettings.ts:81、settingsPageHelpers.tsx:674-692
  t('chat.followup.guideCurrent', '引导当前任务', 4363, 'none'),
  t('chat.followup.sendNow', '立即发送', 4364),
  t('chat.followup.addToQueue', '加入队列', 4365),
  t('settings.zcodeInteractionBehavior', '交互行为', 2111),
  t('settings.zcodeInteractionBehaviorDescription', '在 ZCode 运行时将后续操作加入队列，或引导至下一轮工具调用后运行。', 2112),
  t('settings.zcodeInteractionBehavior.option.queue', '队列', 2114, 'dynamic'),
  t('settings.zcodeInteractionBehavior.option.guide', '引导', 2115, 'dynamic'),
  // 轮次导航：ConversationTurnNavigator.tsx:63-71,139,177
  t('chat.turnNavigator.label', '对话问题导航', 1882),
  t('chat.turnNavigator.jumpToQuery', '跳转到第 {index} 条问题', 1883),
  t('chat.turnNavigator.emptyAssistant', '暂无助手正文', 1884),
  t('chat.turnNavigator.runningAssistant', '助手仍在工作', 1885),
  t('chat.turnNavigator.userFallback', '用户输入', 1886),
  // 状态面板分区标题：ConversationStatusPanel.tsx:392,530,826,889,2007,2017,2037
  t('chat.statusPanel.environment', 'Git 工具', 4476),
  t('chat.statusPanel.goal', '目标', 4481),
  t('chat.statusPanel.sessionPlans', '计划', 4482),
  t('chat.statusPanel.todo', '进程', 4485),
  t('chat.statusPanel.terminals', '终端', 4492),
  t('chat.statusPanel.workflows', '工作流', 4496),
  t('chat.statusPanel.agents', '智能体', 4493),
  // 面板行内 / 计数 / 页脚：:424,830,838,725-733,1072-1081,1174-1184,1368-1379,1303,1519
  t('chat.statusPanel.changes', '更改', 4477),
  t('chat.statusPanel.planFallback', '计划', 4483),
  t('chat.statusPanel.openPlan', '打开计划：{title}', 4484),
  t('chat.statusPanel.todoCompletedFold', '已完成 {count} 项', 4487),
  t('chat.statusPanel.todoEarlierFold', '前面 {count} 项', 4488),
  t('chat.statusPanel.todoLaterFold', '后面 {count} 项', 4489),
  t('chat.statusPanel.todoWaitingFold', '待处理 {count} 项', 4491),
  t('chat.statusPanel.runningStatusValue', '{count} 个后台运行', 4497),
  t('chat.statusPanel.runningStatusValuePlural', '{count} 个后台运行', 4498),
  t('chat.statusPanel.runningAgentsValue', '{count} 运行', 4499),
  t('chat.statusPanel.runningAgentsValuePlural', '{count} 运行', 4500),
  t('chat.statusPanel.runningStop', '停止', 4501),
  t('chat.statusPanel.endedAgents', '已结束', 910),
  t('chat.statusPanel.endedWorkflows', '已结束的工作流', 916),
  // 面板外壳 / 收起态 / 目标控制：:1573,1786,1880,1932,1947,167-169,1072-1080,936,490-521,549
  t('chat.summaryPanel.title', '状态', 4448),
  t('chat.summaryPanel.showPanel', '展开状态', 4453),
  t('chat.summaryPanel.showMini', '收起为胶囊', 4452),
  t('chat.summaryPanel.displayMode', '状态面板展开策略', 4454),
  t('chat.summaryPanel.displayModeAuto', '自动展开', 4455),
  t('chat.summaryPanel.duration.hours', '小时', 4449),
  t('chat.summaryPanel.duration.minutes', '分', 4450),
  t('chat.summaryPanel.duration.seconds', '秒', 4451),
  t('chat.summaryPanel.runningBackgroundTasksMiniValue', '{count} 后台', 4459),
  t('chat.summaryPanel.stopRunningBackgroundTask', '停止运行中的后台任务', 4461),
  t('chat.summaryPanel.openRunningSubagentSession', '打开子智能体会话', 4462),
  t('chat.summaryPanel.goalIterationValue', '第 {count} 次迭代', 4473),
  t('chat.goalVerification.complete', '目标已完成，任务结束', 4435),
  t('chat.target.pause', '暂停目标', 4445),
  t('chat.target.resume', '继续目标', 4446),
  // workflow 行复用 toolCall.workflow 词表：:1217,1264,1161,1258-1260
  t('chat.toolCall.workflow.fallbackName', '工作流脚本', 4712),
  t('chat.toolCall.workflow.card.steps', '{done}/{total} 步', 4778),
  t('chat.toolCall.workflow.openRunDetails', '查看实例详情', 5087),
  t('chat.toolCall.workflow.run.status.pending', '待启动', 5088, 'dynamic'),
  t('chat.toolCall.workflow.run.status.running', '运行中', 5089, 'dynamic'),
  t('chat.toolCall.workflow.run.status.completed', '已完成', 5090, 'dynamic'),
  t('chat.toolCall.workflow.run.status.errored', '出错', 5091, 'dynamic'),
  t('chat.toolCall.workflow.run.status.stopped', '已停止', 5092, 'dynamic'),
  t('bashOutput.open', '查看 {title} 的输出', 120),
  t('common.close', '关闭', 173),
  // 额度条：ConversationQuotaBanner.tsx:11-19,49；sessionQuotaBannerState.ts:214-266
  t('chat.quota.startPlan.bucketDailyLow', '{model} 今日额度剩余 {percent}（{remaining} tokens）。', 5510),
  t('chat.quota.startPlan.bucketActivityLow', '{model} 活动额度剩余 {percent}（{remaining} tokens）。', 5511),
  t('chat.quota.startPlan.modelVeryLow', '{model} 套餐额度剩余 {percent}（{remaining} tokens）。', 5513),
  t('chat.quota.startPlan.modelExhausted', '{model} 可用额度已用完，可切换其他模型或升级套餐。', 5514),
  t('chat.quota.startPlan.dailyExhausted', '体验套餐可用额度已用完，请升级套餐或等待额度恢复。', 5515),
  t('chat.quota.startPlan.concurrentLimit', '当前系统繁忙，请切换模型、升级账户，或稍后再试。', 5516),
  t('chat.quota.startPlan.concurrentLimit.retryExhausted', '当前系统繁忙，当前自动重试已达到最大次数，请稍后再试或升级账户。', 5517),
  t('chat.quota.mcp.quotaExhausted', 'ZCode MCP「{server}」今日额度已用完，明天自动恢复。', 5521),
  t('chat.quota.mcp.codingPlanRequired', '当前无 ZCode MCP「{server}」额度，请登录或开通 Coding Plan 使用。', 5522),
  t('chat.quota.providerLimited', '当前账户额度或套餐已达到使用限制。请升级或调整套餐后继续。', 5524),
  t('chat.quota.action.upgrade', '升级', 5525),
]

/** 按 key 取原文；键不在表里返回空串（不猜）。 */
export function agentChromeText(key: string): string {
  const entry = AGENT_CHROME_TEXTS.find(item => item.key === key)
  return entry ? entry.zh : ''
}

// ── 1. 头部（ConversationHeader.tsx）───────────────────────────────────────
/** workspace 归属徽标，逐字段同 ConversationHeader.tsx:13-20。 */
export interface AgentChromeWorkspaceBadge {
  label: string
  workspacePath: string
  remote: boolean
}
/** 头部元素。`online: false` = 上游已注释下线（:64-92），接口保留但产品不渲染。 */
export interface AgentChromeHeaderElement {
  readonly id: 'sessionTitle' | 'workspaceBadge' | 'splitRight' | 'splitDown' | 'closePane'
  readonly testId: string
  readonly online: boolean
  readonly labelKey: string
  readonly at: string
}
// testId 取自 shared/src/test-ids.ts:604,645,637,639,641 的常量与 ConversationHeader.tsx:45,53,70,84,98 的实参。
export const AGENT_CHROME_HEADER_ELEMENTS: readonly AgentChromeHeaderElement[] = [
  { id: 'sessionTitle', testId: 'v4-session-title', online: true, labelKey: '', at: `${AGENT_CHROME_UI_SRC}/v4/ConversationHeader.tsx:45` },
  { id: 'workspaceBadge', testId: 'v4-pane-workspace-badge', online: true, labelKey: 'v4Pane.remote', at: `${AGENT_CHROME_UI_SRC}/v4/ConversationHeader.tsx:52-62` },
  { id: 'splitRight', testId: 'v4-split-open', online: false, labelKey: 'v4Pane.splitRightTitle', at: `${AGENT_CHROME_UI_SRC}/v4/ConversationHeader.tsx:65-78` },
  { id: 'splitDown', testId: 'v4-split-down', online: false, labelKey: 'v4Pane.splitDownTitle', at: `${AGENT_CHROME_UI_SRC}/v4/ConversationHeader.tsx:79-92` },
  { id: 'closePane', testId: 'v4-split-close', online: true, labelKey: 'v4Pane.closePaneTitle', at: `${AGENT_CHROME_UI_SRC}/v4/ConversationHeader.tsx:93-113` },
]
/** 浮层出现条件：hasFloatingActions = Boolean(workspaceBadge) || Boolean(onClosePane)（:41）。 */
export function headerHasFloatingActions(badge: AgentChromeWorkspaceBadge | null, hasClosePane: boolean): boolean {
  return Boolean(badge) || Boolean(hasClosePane)
}
/** 徽标 tooltip = 完整路径，data-remote 由 remote 布尔投影，remote 时才补「远程」词（:54-60）。 */
export function headerBadgeAttributes(badge: AgentChromeWorkspaceBadge): { title: string; dataRemote: 'true' | 'false'; showsRemoteLabel: boolean } {
  return { title: badge.workspacePath, dataRemote: badge.remote ? 'true' : 'false', showsRemoteLabel: badge.remote }
}

// ── 2. 队列（queueItem / queueState / ConversationQueuePanel）──────────────
// 队列是 **CLI 投影权威态**，不是 renderer 本地列表（ConversationQueuePanel.tsx:271-274）。
/** 队列项 kind：compact 是可排队的维护意图，消费时不投影为 user row（input-intent.ts:44-45）。 */
export const AGENT_QUEUE_KINDS = ['sendText', 'sendGoalCommand', 'compact'] as const
export type AgentQueueKind = (typeof AGENT_QUEUE_KINDS)[number]
/** queueItem 覆盖后的 dispatch 闭集（snapshot.ts:210-212）。 */
export const AGENT_QUEUE_DISPATCH_STATES = ['queued', 'reserved', 'promoting'] as const
/** intent 层 dispatch 闭集，比 queueItem 多 admitted / drained 两态（input-intent.ts:32-37）。 */
export const AGENT_QUEUE_INTENT_DISPATCH_STATES = ['admitted', 'queued', 'reserved', 'promoting', 'drained'] as const
/** 暂停原因闭集（snapshot.ts:222）。 */
export const AGENT_QUEUE_PAUSE_REASONS = ['stopped', 'manual', 'error'] as const
export type AgentQueuePauseReason = (typeof AGENT_QUEUE_PAUSE_REASONS)[number]
/** 投递三元组：requested 多一个 auto，admitted 是 CLI 最终裁决（input-intent.ts:10-16）。 */
export const AGENT_QUEUE_DELIVERY_REQUESTED = ['auto', 'startNow', 'queue', 'guide'] as const
export const AGENT_QUEUE_DELIVERY_ADMITTED = ['startNow', 'queue', 'guide'] as const
/** turn-steer 相位（input-intent.ts:25-30）。fellBack = guide 不合格回退成 queue。 */
export const AGENT_QUEUE_STEER_STATES = ['notRequested', 'submitting', 'steering', 'guided', 'fellBack'] as const
/** 队列项最小形状（input-intent.ts:39-67 + snapshot.ts:209-215）。 */
export interface AgentQueueItemLike {
  queueItemId: string
  sourceCommandId: string
  clientId: string
  kind: AgentQueueKind
  text: string
  admittedAt: string
  order: { admissionSeq: number; queuePosition?: number }
  delivery: { requested: string; admitted: string; fallbackReasonCode?: string }
  steer: { state: string; reasonCode?: string }
  dispatch: { state: string }
}
/** 行锁：dispatch 非 queued，或这一行正在等编辑撤回 ACK（:133-134）。 */
export function queueRowLocked(item: Pick<AgentQueueItemLike, 'dispatch'>, editPending: boolean): boolean {
  return item.dispatch.state !== 'queued' || editPending
}
/** 行内文本：compact 恒显示 /compact，不显示用户文本（:207）。 */
export function queueRowLabel(item: Pick<AgentQueueItemLike, 'kind' | 'text'>): string {
  return item.kind === 'compact' ? '/compact' : item.text
}
/** 立即发送文案键：compact 走 runNow，其余 sendNow；两者原文都是「立即」（:232）。 */
export function queueSendNowLabelKey(item: Pick<AgentQueueItemLike, 'kind'>): string {
  return item.kind === 'compact' ? 'chat.queue.runNow' : 'chat.queue.sendNow'
}
/** 编辑按钮对 compact 缺席（:235）；sortable 是整表属性 Boolean(onMoveItem)（:378）。 */
export function queueRowCanEdit(item: Pick<AgentQueueItemLike, 'kind'>, hasEditHandler: boolean): boolean {
  return item.kind === 'compact' ? false : hasEditHandler
}
/** 暂停条文案键：stopped / error 有专文，其余（含 manual）走通用（:341-345）。 */
export function queuePausedMessageKey(pauseReason: AgentQueuePauseReason | undefined): string {
  if (pauseReason === 'stopped') return 'chat.queue.paused.stopped'
  if (pauseReason === 'error') return 'chat.queue.paused.error'
  return 'chat.queue.paused.generic'
}
/** 空队列整块不渲染（:321）。 */
export function queuePanelVisible(itemCount: number): boolean {
  return itemCount > 0
}
/** 拖拽落点 → reorderQueueItem 的锚点（ConversationQueuePanel.tsx:54-85 逐行复刻）。同 id 不动；
 *  向下拖时锚点取「移除自己后 over 的下一条」；beforeQueueItemId === null = 队尾（command.ts:168）。 */
export function resolveQueueReorderAnchor(
  items: readonly Pick<AgentQueueItemLike, 'queueItemId'>[],
  activeQueueItemId: string,
  overQueueItemId: string,
): { queueItemId: string; beforeQueueItemId: string | null } | null {
  if (activeQueueItemId === overQueueItemId) return null
  const fromIndex = items.findIndex(item => item.queueItemId === activeQueueItemId)
  const overIndex = items.findIndex(item => item.queueItemId === overQueueItemId)
  if (fromIndex < 0 || overIndex < 0) return null
  if (fromIndex < overIndex) {
    const afterRemoval = items.filter(item => item.queueItemId !== activeQueueItemId)
    const overIndexAfterRemoval = afterRemoval.findIndex(item => item.queueItemId === overQueueItemId)
    const next = afterRemoval[overIndexAfterRemoval + 1]
    return { queueItemId: activeQueueItemId, beforeQueueItemId: next ? next.queueItemId : null }
  }
  return { queueItemId: activeQueueItemId, beforeQueueItemId: overQueueItemId }
}
/** 恢复暂停队列的前置条件：autoDrain 已为真或队列为空时不动（SessionPane.tsx:3264）。 */
export function canResumePausedQueue(queue: { autoDrain: boolean; itemCount: number }): boolean {
  return !queue.autoDrain && queue.itemCount > 0
}
/** 撤回编辑的前置条件：队列项存在且不是 compact（SessionPane.tsx:457-458）。 */
export function canEditQueueItem(item: Pick<AgentQueueItemLike, 'kind'> | null | undefined): boolean {
  return Boolean(item) && item!.kind !== 'compact'
}
/** 草稿非空 / 忙时撤回被拒，只弹冲突提示（SessionPane.tsx:3167-3170）。 */
export function queueEditBlockedReason(composer: { hasContent: boolean; busy: boolean }): string | null {
  return composer.hasContent || composer.busy ? 'chat.queue.editDraftConflict' : null
}
/** 撤回只在 delete ACK 为 accepted / duplicate 时才恢复草稿（SessionPane.tsx:475-477）。 */
export function shouldRestoreQueueItemToComposer(ackStatus: string): boolean {
  return ackStatus === 'accepted' || ackStatus === 'duplicate'
}

// ── 3. queue / guide 两档的真实差异 ────────────────────────────────────────
/** 设置页档位（protocol.ts:81；默认 queue 见 validationAppSettings.ts:453）。 */
export const AGENT_INTERACTION_BEHAVIORS = ['queue', 'guide'] as const
export type AgentInteractionBehavior = (typeof AGENT_INTERACTION_BEHAVIORS)[number]
/** app 设置 → session followupMode；非 guide 一律归 queue（followupModeSettings.ts:4-9）。 */
export function resolveAppFollowupMode(settings: { zcodeInteractionBehavior?: string } | null | undefined): 'queue' | 'guide' | null {
  if (!settings) return null
  return settings.zcodeInteractionBehavior === 'guide' ? 'guide' : 'queue'
}
/** 修饰键（⌘/Ctrl + Enter）表达**单次反向**投递：guide 档下反向 = queue，queue 档下反向 = startNow
 *  （followupModeSettings.ts:11-16）。空闲时 CLI 自然 startNow，组合键不改 session 设置。 */
export function resolveOppositeFollowupDelivery(mode: 'queue' | 'guide'): 'startNow' | 'queue' {
  return mode === 'guide' ? 'queue' : 'startNow'
}
/** 修饰键提示：短接写 ⌘+Enter / Ctrl+Enter，标题键按反向投递取（followupModeSettings.ts:63-83）。 */
export function resolveFollowupModifierTooltip(params: {
  enabled: boolean
  canSend: boolean
  modifierPressed: boolean
  followupMode: 'queue' | 'guide' | null | undefined
  isApplePlatform: boolean
}): { delivery: 'startNow' | 'queue'; shortcut: string; titleId: string } | null {
  if (!params.enabled || !params.canSend || !params.modifierPressed || !params.followupMode) return null
  const delivery = resolveOppositeFollowupDelivery(params.followupMode)
  return {
    delivery,
    shortcut: params.isApplePlatform ? '⌘ + Enter' : 'Ctrl + Enter',
    titleId: delivery === 'startNow' ? 'chat.followup.sendNow' : 'chat.followup.addToQueue',
  }
}
/** inputRouting 裁决闭集（snapshot.ts:166）。choice 只在 held 下出现（:164-165）。 */
export const AGENT_INPUT_ROUTING_MODES = ['startNow', 'enqueue', 'guide', 'reject', 'choice'] as const
export type AgentInputRoutingMode = (typeof AGENT_INPUT_ROUTING_MODES)[number]
/** 会话 phase（snapshot.ts:28-37）。draft 是纯内存态、无 row、不落盘。 */
export const AGENT_SESSION_PHASES = ['draft', 'prewarming', 'running', 'completedSuccess', 'completedInterrupted', 'error'] as const
/** 队列按 admitted delivery 分流（pendingGuideProjection.ts:12-26）——两档差异的**读面落点**。
 *  guide 项与 future queue 共用同一份 CLI queue fact，但 admitted === "guide" 的那些等待 model-step
 *  注入，必须画在时间线尾部（ConversationPendingGuideList.tsx），不能混进 composer 上方的队列面板。 */
export function projectPendingGuideQueue(queue: { items: readonly AgentQueueItemLike[] }): {
  pendingGuides: AgentQueueItemLike[]
  visibleQueue: { items: AgentQueueItemLike[]; changed: boolean }
} {
  const pendingGuides: AgentQueueItemLike[] = []
  const visibleItems: AgentQueueItemLike[] = []
  for (const item of queue.items) {
    if (item.delivery.admitted === 'guide') pendingGuides.push(item)
    else visibleItems.push(item)
  }
  // 一条都没被分流时复用原列表（上游同款短路，:24-26）。
  return {
    pendingGuides,
    visibleQueue: { items: visibleItems, changed: visibleItems.length !== queue.items.length },
  }
}
/** guide 排队时输入框仍可提交（V4 曾把它当不可提交，ConversationComposer.tsx:1124-1126 记了回退）。 */
export function inputRoutingAllowsSend(routingMode: AgentInputRoutingMode, draftMode: boolean): boolean {
  return draftMode || routingMode !== 'reject'
}
/** 发送槽在「能停 且 草稿为空」时显示 Stop，否则显示发送键（ConversationComposer.tsx:1136）。 */
export function showStopControl(canStop: boolean, hasDraftContent: boolean): boolean {
  return canStop && !hasDraftContent
}
/** 发送键 tooltip：enqueue 路由写「加入队列」，其余写「发送」（ConversationComposer.tsx:1608）。 */
export function composerSendLabelKey(routingMode: AgentInputRoutingMode): string {
  return routingMode === 'enqueue' ? 'chat.queue.enqueue' : 'chat.send'
}
/** held（mode === "choice"）下普通输入与 /goal 必须先弹确认框（SessionPane.tsx:2608-2617）：
 *  清空队列后发送 / 保留队列立即发送；/compact 与 resumeGoal 一类控制命令不被截获。 */
export function requiresHeldQueueConfirmation(params: {
  routingMode: AgentInputRoutingMode
  heldQueueDisposition: 'clearQueueAndSend' | 'keepQueueAndSend' | null | undefined
  inputKind: 'plain' | 'goal' | 'other'
}): boolean {
  if (params.routingMode !== 'choice') return false
  if (params.heldQueueDisposition) return false
  return params.inputKind === 'plain' || params.inputKind === 'goal'
}
/** 确认框两个出口（command.ts:92；按钮文案 ConversationComposer.tsx:2367,2378）。 */
export const AGENT_HELD_QUEUE_DISPOSITIONS = ['clearQueueAndSend', 'keepQueueAndSend'] as const

// ── 4. 待办引导列表（ConversationPendingGuideList.tsx）──────────────────────
/** 待注入 guide → 时间线尾部 userInput 行（ConversationPendingGuideList.tsx:13-28）。rowId 取**负数**
 *  -(admissionSeq + 1)：真 user row 是正数，两空间不相交，不会撞 id；createdAtSeq 复用
 *  order.admissionSeq 保序。 */
export function pendingGuideRow(item: AgentQueueItemLike, turnId: string): {
  rowId: number
  turnId: string
  productTurnId: string
  entityId: string
  kind: 'userInput'
  text: string
  origin: 'realUser'
  sourceCommandId: string
  clientId: string
  createdAt: string
  createdAtSeq: number
} {
  return {
    rowId: -(item.order.admissionSeq + 1),
    turnId,
    productTurnId: turnId,
    entityId: item.queueItemId,
    kind: 'userInput',
    text: item.text,
    origin: 'realUser',
    sourceCommandId: item.sourceCommandId,
    clientId: item.clientId,
    createdAt: item.admittedAt,
    createdAtSeq: item.order.admissionSeq,
  }
}
/** 每行状态词恒为「等待引导当前任务…」（:37）；列表 key 用 sourceCommandId（:44）。 */
export const AGENT_PENDING_GUIDE_STATUS_KEY = 'chat.message.turnSteer.pending'
/** 空列表整块不渲染（:39）。 */
export function pendingGuideListVisible(count: number): boolean {
  return count > 0
}

// ── 5. 状态面板（ConversationStatusPanel / conversationStatusPanelModel）───
/** 分区闭集，顺序即渲染顺序（ConversationStatusPanel.tsx:228-235 与 :1966-2056 挂载序）。 */
export const AGENT_STATUS_SECTIONS = ['environment', 'goal', 'sessionPlans', 'plan', 'terminal', 'workflow', 'agent'] as const
export type AgentStatusSection = (typeof AGENT_STATUS_SECTIONS)[number]
/** 各分区折叠内容限高（ConversationStatusPanel.tsx:237-247，按类型表统一裁决）。 */
export const AGENT_STATUS_SECTION_SCROLL: Readonly<Record<AgentStatusSection, string | null>> = {
  environment: null, goal: 'max-h-48', sessionPlans: 'max-h-48', plan: 'max-h-80',
  terminal: 'max-h-48', workflow: 'max-h-48', agent: 'max-h-48',
}
/** 分区标题键（各 StatusSection 的 title 实参，行号见文案表里的分组注释）。 */
export const AGENT_STATUS_SECTION_TITLE_KEYS: Readonly<Record<AgentStatusSection, string>> = {
  environment: 'chat.statusPanel.environment', goal: 'chat.statusPanel.goal',
  sessionPlans: 'chat.statusPanel.sessionPlans', plan: 'chat.statusPanel.todo',
  terminal: 'chat.statusPanel.terminals', workflow: 'chat.statusPanel.workflows',
  agent: 'chat.statusPanel.agents',
}
/** 默认展开：只有 terminal / workflow / agent 三类实时活动默认收起（:1063,1165,1360）。 */
export const AGENT_STATUS_SECTION_DEFAULT_OPEN: Readonly<Record<AgentStatusSection, boolean>> = {
  environment: true, goal: true, sessionPlans: true, plan: true,
  terminal: false, workflow: false, agent: false,
}
/** 面板变体（conversationLayout.ts:11）。auto 必须保留到 DOM，由容器查询裁决。 */
export const AGENT_STATUS_PANEL_VARIANTS = ['auto', 'mini', 'panel'] as const
export type AgentStatusPanelVariant = (typeof AGENT_STATUS_PANEL_VARIANTS)[number]
/** 变体解析：override 缺省即 auto（conversationLayout.ts:25-31）。 */
export function resolveStatusPanelVariant(override: AgentStatusPanelVariant | null | undefined): AgentStatusPanelVariant {
  return override ?? 'auto'
}
/** 内联布局：有内容且不是 mini 胶囊（conversationLayout.ts:33-38）。 */
export function shouldUseStatusPanelInlineLayout(params: { hasContent: boolean; variant: AgentStatusPanelVariant }): boolean {
  return params.hasContent && params.variant !== 'mini'
}
/** 菜单值：自动模式写 "auto"，否则写实际变体（ConversationStatusPanel.tsx:1784）。 */
export function statusPanelMenuValue(isVariantAutomatic: boolean, variant: AgentStatusPanelVariant): string {
  return isVariantAutomatic ? 'auto' : variant
}
/** 菜单选择 → override：auto 归 null，panel / mini 落值，其余 undefined（:1813-1824）。 */
export function statusPanelMenuChange(value: string): AgentStatusPanelVariant | null | undefined {
  if (value === 'auto') return null
  if (value === 'panel' || value === 'mini') return value
  return undefined
}
/** 展开 / 收起胶囊数据属性：mini → collapsed，其余 expanded（:1881）。 */
export function statusPanelDataState(variant: AgentStatusPanelVariant): 'collapsed' | 'expanded' {
  return variant === 'mini' ? 'collapsed' : 'expanded'
}
/** 面板模型的可见子集（conversationStatusPanelModel.ts:109-118）。 */
export interface AgentStatusPanelModelLike {
  hasContent: boolean
  hasGit: boolean
  hasGoal: boolean
  hasSessionPlans: boolean
  hasPlan: boolean
  runningBashCount: number
  runningSubagentCount: number
  runningWorkflowCount: number
}
/** 卸载闸门：无内容且没有可渲染的已结束 workflow 时整块不渲染（:1858-1860）。 */
export function statusPanelVisible(hasContent: boolean, canRenderEndedWorkflowsFlag: boolean): boolean {
  return hasContent || canRenderEndedWorkflowsFlag
}
/** 已结束 workflow 目录入口开门条件（:1803-1805）：计数 > 0 且会话与回调都在。 */
export function canRenderEndedWorkflows(params: { endedWorkflowRunCount: number; hasParentSession: boolean; hasDirectoryHandler: boolean }): boolean {
  return params.endedWorkflowRunCount > 0 && params.hasParentSession && params.hasDirectoryHandler
}
/** 已结束 agent 目录入口同款门（:1807-1809）。 */
export function canRenderEndedAgents(params: { endedSubagentCount: number; hasParentSession: boolean; hasDirectoryHandler: boolean }): boolean {
  return params.endedSubagentCount > 0 && params.hasParentSession && params.hasDirectoryHandler
}
/** 分区可见性（ConversationStatusPanel.tsx:1796-1812）。 */
export function statusSectionVisibility(
  model: AgentStatusPanelModelLike,
  endedWorkflows: boolean,
  endedAgents: boolean,
): Readonly<Record<AgentStatusSection, boolean>> {
  return {
    environment: model.hasGit,
    goal: model.hasGoal,
    sessionPlans: model.hasSessionPlans,
    plan: model.hasPlan,
    terminal: model.runningBashCount > 0,
    workflow: model.runningWorkflowCount > 0 || endedWorkflows,
    agent: model.runningSubagentCount > 0 || endedAgents,
  }
}
/** 运行态计数合计（胶囊与面板共用同一份真值，:1598-1601）。 */
export function runningWorkCount(model: Pick<AgentStatusPanelModelLike, 'runningBashCount' | 'runningSubagentCount' | 'runningWorkflowCount'>): number {
  return model.runningBashCount + model.runningSubagentCount + model.runningWorkflowCount
}
/** 恰好一类沿用该类图标，混合才是 Activity（:1602-1612）。 */
export function runningSummaryIconKind(model: Pick<AgentStatusPanelModelLike, 'runningBashCount' | 'runningSubagentCount' | 'runningWorkflowCount'>): 'activity' | 'workflow' | 'terminal' | 'agent' {
  const hasBash = model.runningBashCount > 0
  const hasSubagent = model.runningSubagentCount > 0
  const hasWorkflow = model.runningWorkflowCount > 0
  if ([hasWorkflow, hasBash, hasSubagent].filter(Boolean).length > 1) return 'activity'
  if (hasWorkflow) return 'workflow'
  if (hasBash) return 'terminal'
  return 'agent'
}
/** 收起态胶囊的兜底链（:1613-1686），顺序即优先级。 */
export const AGENT_STATUS_SUMMARY_BRANCHES = [
  'currentPlanItem', 'activeGoal', 'gitChanges', 'doneGoal', 'completedPlanItem',
  'planCounts', 'latestSessionPlan', 'runningCount', 'endedWorkflows',
] as const
export type AgentStatusSummaryBranch = (typeof AGENT_STATUS_SUMMARY_BRANCHES)[number]
/** 胶囊分支选择：逐条按在场性短路，末条兜底已结束 workflow 计数（:1670-1686）。 */
export function resolveStatusSummaryBranch(input: {
  hasCurrentPlanItem: boolean
  hasGoalTitle: boolean
  isActiveGoal: boolean
  hasGitMiniSummary: boolean
  isDoneGoal: boolean
  hasCompletedPlanItem: boolean
  hasPlan: boolean
  hasLatestSessionPlan: boolean
  runningCount: number
  endedWorkflowRunCount: number
}): AgentStatusSummaryBranch | null {
  if (input.hasCurrentPlanItem) return 'currentPlanItem'
  if (input.hasGoalTitle && input.isActiveGoal) return 'activeGoal'
  if (input.hasGitMiniSummary) return 'gitChanges'
  if (input.hasGoalTitle && input.isDoneGoal) return 'doneGoal'
  if (input.hasCompletedPlanItem) return 'completedPlanItem'
  if (input.hasPlan) return 'planCounts'
  if (input.hasLatestSessionPlan) return 'latestSessionPlan'
  if (input.runningCount > 0) return 'runningCount'
  if (input.endedWorkflowRunCount > 0) return 'endedWorkflows'
  return null
}
/** 当前进行中的 Todo：优先 inProgress，其次第一条 pending（:1548-1554）。 */
export function getCurrentPlanItem<T extends { status: string }>(items: readonly T[]): T | null {
  return items.find(item => item.status === 'inProgress') ?? items.find(item => item.status === 'pending') ?? null
}
/** 最近一条已完成 Todo：从尾部往前找（:1556-1558）。 */
export function getCompletedPlanItem<T extends { status: string }>(items: readonly T[]): T | null {
  for (let i = items.length - 1; i >= 0; i -= 1) {
    const item = items[i]!
    if (item.status === 'completed') return item
  }
  return null
}
/** 目标状态闭集（snapshot.ts:428）。notSatisfied 与 failed 分离：前者是有效结论。 */
export const AGENT_GOAL_STATUSES = ['active', 'paused', 'verifying', 'verified', 'notSatisfied', 'failed'] as const
export type AgentGoalStatus = (typeof AGENT_GOAL_STATUSES)[number]
/** 可暂停：active / verifying / notSatisfied（:470-471）。 */
export function isPausableGoalStatus(status: AgentGoalStatus): boolean {
  return status === 'active' || status === 'verifying' || status === 'notSatisfied'
}
/** 胶囊里的「活目标」：active / notSatisfied / paused / verifying（:1582-1586，notSatisfied 曾漏掉）。 */
export function isActiveGoalStatus(status: AgentGoalStatus): boolean {
  return status === 'active' || status === 'notSatisfied' || status === 'paused' || status === 'verifying'
}
/** 目标控制：可暂停 → pause，暂停中 → resume，已验证 → done，其余无（:489-524）。 */
export function goalControlFor(status: AgentGoalStatus): 'pause' | 'resume' | 'done' | null {
  if (isPausableGoalStatus(status)) return 'pause'
  if (status === 'paused') return 'resume'
  if (status === 'verified') return 'done'
  return null
}
/** Todo 行图标：completed → 对勾，inProgress → 箭头，其余 → 空环（:584-607）。 */
export function planItemIconKind(status: string): 'check' | 'arrow' | 'circle' {
  if (status === 'completed') return 'check'
  if (status === 'inProgress') return 'arrow'
  return 'circle'
}
/** 折叠窗阈值与窗口大小（:609-610）。 */
export const AGENT_STATUS_COMPACT_TODO_THRESHOLD = 6
export const AGENT_STATUS_TODO_FOCUS_WINDOW_SIZE = 3
/** Todo 精简窗口（:619-648 逐行复刻）。焦点 = 正在跑的那条，否则第一条未完成，否则末尾三条；窗口
 *  起点从前面回补，保证项目数够时始终三条上下文，且**不改 snapshot 原序**。 */
export function planTodoFocusWindow<T extends { status: string }>(items: readonly T[]): {
  compact: boolean
  precedingItems: T[]
  focusItems: T[]
  followingItems: T[]
} {
  if (items.length <= AGENT_STATUS_COMPACT_TODO_THRESHOLD) {
    return { compact: false, precedingItems: [], focusItems: [...items], followingItems: [] }
  }
  const runningIndex = items.findIndex(item => item.status === 'inProgress')
  const firstUnfinishedIndex = items.findIndex(item => item.status !== 'completed')
  const focusIndex = runningIndex >= 0
    ? runningIndex
    : firstUnfinishedIndex >= 0
      ? firstUnfinishedIndex
      : Math.max(0, items.length - AGENT_STATUS_TODO_FOCUS_WINDOW_SIZE)
  const focusStart = Math.max(0, Math.min(focusIndex, items.length - AGENT_STATUS_TODO_FOCUS_WINDOW_SIZE))
  const focusEnd = Math.min(items.length, focusStart + AGENT_STATUS_TODO_FOCUS_WINDOW_SIZE)
  return {
    compact: true,
    precedingItems: items.slice(0, focusStart),
    focusItems: items.slice(focusStart, focusEnd),
    followingItems: items.slice(focusEnd),
  }
}
/** 隐藏组折叠文案键（:725-732）。 */
export function todoFoldMessageKey(group: 'preceding' | 'following', items: readonly { status: string }[]): string {
  if (group === 'preceding') {
    return items.every(item => item.status === 'completed') ? 'chat.statusPanel.todoCompletedFold' : 'chat.statusPanel.todoEarlierFold'
  }
  return items.every(item => item.status === 'pending') ? 'chat.statusPanel.todoWaitingFold' : 'chat.statusPanel.todoLaterFold'
}
/** Todo 全完成（:883）：totalCount 必须 > 0，空计划不算完成。 */
export function planIsCompleted(plan: { totalCount: number; completedCount: number }): boolean {
  return plan.totalCount > 0 && plan.completedCount >= plan.totalCount
}
/** 用时单位：零值省略，全零时补一个 0 秒（:159-182）。 */
export function formatStatusDurationParts(totalSeconds: number): { hours: number; minutes: number; seconds: number; showsSeconds: boolean } {
  const seconds = Math.max(0, Math.floor(totalSeconds))
  const hours = Math.floor(seconds / 3600)
  const minutes = Math.floor((seconds % 3600) / 60)
  const rest = seconds % 60
  const shown = (hours > 0 ? 1 : 0) + (minutes > 0 ? 1 : 0)
  return { hours, minutes, seconds: rest, showsSeconds: rest > 0 || shown === 0 }
}
/** git 分区只在有行级变化时出现：added + removed > 0（conversationStatusPanelModel.ts:149-151）。 */
export function hasGitMiniSummary(added: number, removed: number): boolean {
  return added + removed > 0
}
/** 计划为空即无模型（conversationStatusPanelModel.ts:172-174）。 */
export function planModelVisible(itemCount: number): boolean {
  return itemCount > 0
}
/** 会话计划行只认 ExitPlanMode 终态（success / error / cancelled），按 rowId 倒序（:192-198）。 */
export function isSessionPlanRow(row: { toolName: string; status: string }): boolean {
  return row.toolName === 'ExitPlanMode' && (row.status === 'success' || row.status === 'error' || row.status === 'cancelled')
}
/** workflow run 状态闭集（workflow-runs.ts:365）。 */
export const AGENT_WORKFLOW_RUN_STATUSES = ['pending', 'running', 'completed', 'errored', 'stopped'] as const
/** 分区只收活动态，pending 也算活动（conversationStatusPanelModel.ts:243）。 */
export function isActiveWorkflowRunStatus(status: string): boolean {
  return status === 'pending' || status === 'running'
}
/** run 状态词键（ConversationStatusPanel.tsx:1258-1260）。 */
export function workflowRunStatusTextKey(status: string): string {
  return `chat.toolCall.workflow.run.status.${status}`
}
/** 未命名判定：title ≡ runId 就是兜底到 taskId 的样子（:1211-1217）。 */
export function workflowRunDisplayName(title: string | undefined, runId: string, fallbackName: string): string {
  return title && title !== runId ? title : fallbackName
}
/** Stop 前提：有 workId 且 work 仍 running 且 cancellable !== false（:1284-1288）。 */
export function workflowRunCanStop(run: { workId?: string; cancellable?: boolean; workStatus?: string }): boolean {
  return Boolean(run.workId) && run.workStatus === 'running' && run.cancellable !== false
}
/** 行可点开详情：有 toolCallId（conversationStatusPanelModel.ts:98-107）。 */
export function workflowRunCanOpen(toolCallId: string | undefined): boolean {
  return Boolean(toolCallId)
}
/** 后台任务状态闭集（snapshot.ts:372）；resultPending = 已完成、结果等前台空闲。 */
export const AGENT_BACKGROUND_WORK_STATUSES = ['running', 'resultPending', 'failed', 'cancelled'] as const
/** 后台任务种类（snapshot.ts:368）。workflow run 与 bash 曾同列，现已分区。 */
export const AGENT_BACKGROUND_WORK_KINDS = ['bash', 'subagent', 'workflow'] as const
/** 子智能体运行态（snapshot.ts:391）。 */
export const AGENT_RUNNING_SUBAGENT_STATUSES = ['running', 'waiting', 'blocked'] as const
