// ZCode 对话「额度条」的**纯逻辑**复刻 —— 2026-10-07 从 `src/agentConversationChrome.ts`
// 按职责拆出（那一份把「头部 / 队列 / 引导 / 状态面板」与「轮次导航 / 额度条」挤在一个模块里）。
// 零 Vue / 零 DOM / 零 import：只放形状、派生与状态机，组件里只做接线。
// 每条规则都在注释里给 .tools/ZCode 的 文件:行号（逐条打开确认过那一行存在）。
// 上游（.tools/ZCode/packages/ui/src/v4）：ConversationQuotaBanner.tsx、sessionQuotaBannerState.ts。

// ── 7. 额度条（ConversationQuotaBanner / sessionQuotaBannerState）──────────
/** 额度条种类（sessionQuotaBannerState.ts:20-27）。 */
export const AGENT_QUOTA_BANNER_KINDS = [
  'model-very-low', 'model-exhausted', 'daily-exhausted', 'concurrent-limit',
  'provider-limited', 'mcp-quota-exhausted', 'mcp-plan-required',
] as const
export type AgentQuotaBannerKind = (typeof AGENT_QUOTA_BANNER_KINDS)[number]
/** 每种 kind 的固定文案键（ConversationQuotaBanner.tsx:11-19）。 */
export const AGENT_QUOTA_MESSAGE_IDS: Readonly<Record<AgentQuotaBannerKind, string>> = {
  'model-very-low': 'chat.quota.startPlan.modelVeryLow',
  'model-exhausted': 'chat.quota.startPlan.modelExhausted',
  'daily-exhausted': 'chat.quota.startPlan.dailyExhausted',
  'concurrent-limit': 'chat.quota.startPlan.concurrentLimit',
  'provider-limited': 'chat.quota.providerLimited',
  'mcp-quota-exhausted': 'chat.quota.mcp.quotaExhausted',
  'mcp-plan-required': 'chat.quota.mcp.codingPlanRequired',
}
/** 消息键解析（ConversationQuotaBanner.tsx:21-35）：低额度按桶周期换键，并发限制按重试原因换键。 */
export function resolveQuotaMessageId(state: {
  kind: AgentQuotaBannerKind | null
  quotaPeriod?: string
  concurrentLimitReason?: string
}): string {
  if (state.kind === 'model-very-low') {
    if (state.quotaPeriod === 'daily') return 'chat.quota.startPlan.bucketDailyLow'
    if (state.quotaPeriod === 'one_time') return 'chat.quota.startPlan.bucketActivityLow'
    return 'chat.quota.startPlan.modelVeryLow'
  }
  if (state.kind === 'concurrent-limit') {
    return state.concurrentLimitReason === 'retry-exhausted-busy'
      ? 'chat.quota.startPlan.concurrentLimit.retryExhausted'
      : 'chat.quota.startPlan.concurrentLimit'
  }
  return state.kind ? AGENT_QUOTA_MESSAGE_IDS[state.kind] : ''
}
/** 优先级（sessionQuotaBannerState.ts:125,148,173,199,220,239,265 各分支的 priority 字面量）。 */
export const AGENT_QUOTA_PRIORITY: Readonly<Record<AgentQuotaBannerKind, number>> = {
  'concurrent-limit': 60, 'daily-exhausted': 50, 'provider-limited': 45, 'model-exhausted': 40,
  'model-very-low': 30, 'mcp-plan-required': 8, 'mcp-quota-exhausted': 6,
}
/** 低额度阈值：剩余比例 ≤ 0.1 才提醒（sessionQuotaBannerState.ts:241-251）。 */
export const AGENT_QUOTA_LOW_RATIO_THRESHOLD = 0.1
export function isQuotaVeryLow(remainingRatio: number | null): boolean {
  return remainingRatio !== null && remainingRatio > 0 && remainingRatio <= AGENT_QUOTA_LOW_RATIO_THRESHOLD
}
/** 整块渲染条件：visible 且 kind 在场（ConversationQuotaBanner.tsx:80）。 */
export function quotaBannerVisible(state: { visible: boolean; kind: AgentQuotaBannerKind | null }): boolean {
  return state.visible && state.kind !== null
}
/** 是否带升级入口（sessionQuotaBannerState.ts:304-306）。mcp-quota-exhausted 明确不带：今日额度用完
 *  只能等自然日重置，升级按钮是误导。 */
export function shouldOfferQuotaUpgrade(kind: AgentQuotaBannerKind | null): boolean {
  return kind !== 'mcp-quota-exhausted'
}
/** 关闭按钮只在 dismissible 时出现（ConversationQuotaBanner.tsx:124）。 */
export function quotaBannerDismissible(state: { dismissible: boolean }): boolean {
  return state.dismissible
}
