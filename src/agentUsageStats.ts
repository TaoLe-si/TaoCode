// AG-09 的记账层：模型 / 输入输出 token / 缓存 / 重试 / 时延 / 费用的记录与聚合。
//
// 为什么单独一个模块：ZCode「使用统计」节把**估算**（本地会话历史 / 本地用量库）与
// **供应商账单**（远端 monitor 接口）分成两套字段与两套文案，见
// `.tools/ZCode/packages/shared/src/usage-stats.ts:140-159`（UsageStatsSnapshot.source）与
// `.tools/ZCode/packages/shared/src/usage-stats.ts:241-251`（AppUsageSnapshot.source = "agent-db"）。
// 本仓要在同一份账里保留这个分界，所以每条记录都带 `origin`，聚合后**分开出**两个视图，
// 不把估算混进账单，也不把账单标成估算。
//
// 口径来源（逐条指到 .tools/ZCode，行号以打开时为准）：
//   · 字段名（inputTokens / outputTokens / reasoningTokens / cacheCreationTokens /
//     cacheReadTokens）—— `packages/shared/src/usage-stats.ts:171-192`
//   · 模型维度（totalTokens / inputTokens / outputTokens / requestCount / share）——
//     `packages/shared/src/usage-stats.ts:224-231`
//   · 命中率分母只取 input（不再叠 cache）—— `apps/zcode-cli/packages/bootstrap/src/
//     zcode-protocol/usage-stats-builder.ts:89-95`
//   · 错误率 modelErrorRate = modelErrorCount / modelRequestCount —— 同上 `:96-99`
//   · 时延 avgTimeToFirstTokenMs / avgTurnDurationMs / longestSessionMs ——
//     `packages/shared/src/usage-stats.ts:184-188`，SQL 口径见
//     `apps/zcode-cli/packages/adapters/src/storage/session-store/repositories/usage.ts:396-418`
//   · 重试字段 retryCount / modelRetryCount —— `apps/zcode-cli/packages/contracts/src/
//     interfaces/session-store.port.ts:912` / `:936` / `:974`（**页面不展示**，见下方注释）
//   · 估算除数 ESTIMATED_TOKEN_CHAR_DIVISOR = 3，中文按 2 个估算字符 ——
//     `packages/shared/src/usage-stats.ts:9` 与
//     `apps/zcode-cli/packages/core/src/context/utils.ts:11-18`
//   · 数值格式化（compact / 百分比 / 时长 / 天数）—— `packages/ui/src/settings/usage-stats/
//     usageStatsUiParts.tsx:11-37` 与 `packages/ui/src/settings/usage-stats/AppUsagePanel.tsx:177-206`
//
// 存档口径跟 `src/agentSettings.ts` / `src/agentSessions.ts` 同一族：窄的 storage 接口、
// 缺省 localStorage、取不到就内存模式、坏档永不抛，能救的留下、救不了的丢这一条。
//
// NOT WIRED YET (deliberate)：`src/agent.ts` 与两个 Agent 页面由主代理独占，本模块只交逻辑。
// 接线方式见交付说明；在接上之前，本文件只被 `tests/agent-usage-stats.test.mjs` 消费。
import { summarizeUsage, type UsageRecord } from './agent.ts'

/** 存储键。与 `taocode.agent.settings` / `taocode.agent.sessions` 同一族，不跟别的历史表抢键。 */
export const AGENT_USAGE_STATS_STORAGE_KEY = 'taocode.agent.usageStats'

/** 库里最多留多少条记录。满了淘汰 `at` 最旧的 —— 记账是流水，老的先走。 */
export const AGENT_USAGE_RECORD_LIMIT = 2000

/**
 * 估算除数：`packages/shared/src/usage-stats.ts:9` 的 `ESTIMATED_TOKEN_CHAR_DIVISOR`。
 * 本仓 `src/agent.ts:126` 用的是 2（CJK 混合），这里是 ZCode 的 3，两者都只用于**估算**，
 * 所以格式化成字符串时必须带「估算」标记，不能当账单数。
 */
export const ESTIMATED_TOKEN_CHAR_DIVISOR = 3

/** 估算标记：ZCode 用 `settings.usage.estimationHint`（zh-CN.ts:3400）。 */
export const ESTIMATION_LABEL = '根据本地会话历史估算'
/** 账单标记：ZCode 用 `settings.usage.remoteTokenHint`（zh-CN.ts:3224）。 */
export const BILLING_LABEL = '来自当前供应商模型用量接口'
/** 账单数值来源前缀：`settings.usage.modelChart.remoteTokens`（zh-CN.ts:3458）。 */
export const BILLING_TOKEN_HINT = '来自模型用量接口'
/** 来源展示：`settings.usage.sourceProvider`（zh-CN.ts:3232）。 */
export const SOURCE_PROVIDER_TEMPLATE = '来源：{provider}'
/** 未知模型：`settings.usage.unknownModel`（zh-CN.ts:3421）。 */
export const UNKNOWN_MODEL_LABEL = '未知模型'

/**
 * 记录来源。`estimated` 是本仓/本地会话历史算出来的；`billing` 是供应商用量接口回来的。
 * ZCode 的判别键是快照上的 `source`（`usage-stats.ts:154` / `:245`），本仓没有那两个快照类型，
 * 就把判别键下移到记录上。
 */
export type UsageOrigin = 'estimated' | 'billing'

/**
 * 一条记账记录。字段名照 ZCode 的用量库记录
 * （`apps/zcode-cli/packages/contracts/src/interfaces/session-store.port.ts:880-922`），
 * 只保留本仓能真的产生 / 真的展示的那些。
 *
 * `retryCount` 是 ZCode 存了但**页面不展示**的字段（`:912`，UI 侧无对应 i18n 键）：
 * 这里照存、照进汇总，但**不**给文案 —— 不编一个上游没有的标签。
 */
export interface AgentUsageRecord {
  /** 记账时刻（ISO）。 */
  at: string
  origin: UsageOrigin
  /** 模型 id。未知时用 null，展示走 `UNKNOWN_MODEL_LABEL`。 */
  modelId: string | null
  providerId: string | null
  /** 供应商是否返回了真实用量。false 时全部 token 字段为估算值。 */
  providerReported: boolean
  inputTokens: number
  outputTokens: number
  reasoningTokens: number
  cacheCreationTokens: number
  cacheReadTokens: number
  /** 供应商返回的总量；缺省时用输入侧 + 输出算出的 computedTotalTokens。 */
  providerTotalTokens: number | null
  retryCount: number
  /** 首 token 时延（ms）；拿不到为 null，不拿 0 冒充。 */
  timeToFirstTokenMs: number | null
  /** 这一轮总时长（ms）。 */
  durationMs: number | null
  requestCount: number
  errorCount: number
  /**
   * 费用（积分 / 计价单位）。ZCode 里费用来自远端 `totalCredits` / `creditsUsage`
   * （`packages/shared/src/usage-stats.ts:306-309`、`:321-334`），单位文案是
   * `settings.usage.creditUnit`（zh-CN.ts:3403）。本地估算拿不到计价，置 0。
   */
  credits: number
}

export interface AgentUsageStatsStorage {
  getItem(key: string): string | null
  setItem(key: string, value: string): void
}

/** 模型维度汇总，字段照 `usage-stats.ts:224-231`。 */
export interface AgentUsageModelSummary {
  modelId: string | null
  totalTokens: number
  inputTokens: number
  outputTokens: number
  requestCount: number
  share: number
}

/** 汇总视图。`label` 就是上面两个标记之一，调用方直接渲染，不再自己拼。 */
export interface AgentUsageSummary {
  origin: UsageOrigin
  label: string
  totalTokens: number
  inputTokens: number
  outputTokens: number
  reasoningTokens: number
  cacheCreationTokens: number
  cacheReadTokens: number
  cacheHitRate: number
  requestCount: number
  errorCount: number
  errorRate: number
  retryCount: number
  avgTimeToFirstTokenMs: number | null
  avgDurationMs: number | null
  credits: number
  models: AgentUsageModelSummary[]
}

/** 展示用的一行（标签 + 已格式化值），标签文案全部取 zh-CN 原文。 */
export interface AgentUsageStatItem {
  label: string
  value: string
}

const EMPTY = { records: [] as AgentUsageRecord[] }

function defaultStorage(): AgentUsageStatsStorage | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage
  } catch {
    // 隐私模式 / 沙箱里读 localStorage 本身就会抛，退回内存模式。
    return null
  }
}

function isIso(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0 && !Number.isNaN(Date.parse(value))
}

/** 有限非负数；非数 / NaN / Infinity / 负数一律归 0（沿用 ZCode `integer()` 的钳位口径）。 */
function nonNegative(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : 0
}

/** 可为空的有限数：用于时延这类「拿不到就是 null，不能拿 0 冒充」的字段。 */
function nullableNonNegative(value: unknown): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) return null
  return value
}

function normalizeRecord(value: unknown): AgentUsageRecord | null {
  if (!value || typeof value !== 'object') return null
  const raw = value as Record<string, unknown>
  if (!isIso(raw.at)) return null
  if (raw.origin !== 'estimated' && raw.origin !== 'billing') return null
  const modelId = typeof raw.modelId === 'string' && raw.modelId.trim() ? raw.modelId : null
  const providerId = typeof raw.providerId === 'string' && raw.providerId ? raw.providerId : null
  return {
    at: raw.at,
    origin: raw.origin,
    modelId,
    providerId,
    providerReported: raw.providerReported === true,
    inputTokens: nonNegative(raw.inputTokens),
    outputTokens: nonNegative(raw.outputTokens),
    reasoningTokens: nonNegative(raw.reasoningTokens),
    cacheCreationTokens: nonNegative(raw.cacheCreationTokens),
    cacheReadTokens: nonNegative(raw.cacheReadTokens),
    providerTotalTokens: nullableNonNegative(raw.providerTotalTokens),
    retryCount: nonNegative(raw.retryCount),
    timeToFirstTokenMs: nullableNonNegative(raw.timeToFirstTokenMs),
    durationMs: nullableNonNegative(raw.durationMs),
    requestCount: nonNegative(raw.requestCount),
    errorCount: nonNegative(raw.errorCount),
    credits: nonNegative(raw.credits),
  }
}

/** 读存档。非 JSON、非对象、records 不是数组：整库当空。单条坏记录丢掉，不整库作废。 */
function parseLibrary(raw: string | null): { records: AgentUsageRecord[] } {
  if (!raw) return { records: [] }
  let value: unknown
  try {
    value = JSON.parse(raw)
  } catch {
    return { records: [] }
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) return { records: [] }
  const body = value as Record<string, unknown>
  if (!Array.isArray(body.records)) return { records: [] }
  const records: AgentUsageRecord[] = []
  for (const item of body.records) {
    const record = normalizeRecord(item)
    if (record) records.push(record)
  }
  return { records: records.length > AGENT_USAGE_RECORD_LIMIT ? oldestFirst(records).slice(-AGENT_USAGE_RECORD_LIMIT) : records }
}

function oldestFirst(records: readonly AgentUsageRecord[]): AgentUsageRecord[] {
  return [...records].sort((a, b) => (a.at === b.at ? 0 : a.at < b.at ? -1 : 1))
}

function copyRecord(record: AgentUsageRecord): AgentUsageRecord {
  return { ...record }
}

/**
 * 输入侧 token。ZCode 的口径：`input_tokens` 若已 > 0 就是 total input，
 * cache 字段只是 breakdown，不能再叠（`usage-stats-builder.ts:89-94` 的注释与
 * `repositories/usage.ts` 的 `inputSideTokensFromStoredUsage`）。只有 input 缺省时才退到 cache 之和。
 */
export function inputSideTokens(record: Pick<AgentUsageRecord, 'inputTokens' | 'cacheCreationTokens' | 'cacheReadTokens'>): number {
  if (record.inputTokens > 0) return record.inputTokens
  return record.cacheCreationTokens + record.cacheReadTokens
}

/**
 * 总 token。优先供应商总量（providerTotalTokens），缺省用计算量。
 * 计算量 = 输入侧 + 输出，**不含 reasoning**：ZCode 的 `computedTotalTokens`
 * 就是 `inputSideTokens + outputTokens`（`repositories/usage.ts:21-27`），reasoning 单独一列。
 */
export function totalTokens(record: AgentUsageRecord): number {
  if (record.providerTotalTokens !== null && record.providerTotalTokens > 0) return record.providerTotalTokens
  return inputSideTokens(record) + record.outputTokens
}

/**
 * Cache 命中率。分母只取输入侧 —— 叠 cacheRead 会把命中率压低
 * （`usage-stats-builder.ts:89-95`）。没有分母时为 0。
 */
export function cacheHitRate(record: Pick<AgentUsageRecord, 'inputTokens' | 'cacheCreationTokens' | 'cacheReadTokens'>): number {
  const denominator = inputSideTokens(record)
  if (denominator <= 0) return 0
  return record.cacheReadTokens / denominator
}

/** 平均值：ZCode 的 SQL 用 `avg(...)`，分母为 0 时给 null（不是 0）。 */
function average(values: readonly number[]): number | null {
  if (values.length === 0) return null
  return values.reduce((sum, value) => sum + value, 0) / values.length
}

/** 按模型聚合，share = 该模型 totalTokens / 全部模型 totalTokens（`usage-stats-builder.ts:187-195`）。 */
export function summarizeModels(records: readonly AgentUsageRecord[]): AgentUsageModelSummary[] {
  const buckets = new Map<string, AgentUsageModelSummary>()
  let allTokens = 0
  for (const record of records) {
    const tokens = totalTokens(record)
    allTokens += tokens
    // null 模型归到 '' 桶，展示时走未知模型文案。
    const key = record.modelId ?? ''
    const bucket = buckets.get(key) ?? { modelId: record.modelId, totalTokens: 0, inputTokens: 0, outputTokens: 0, requestCount: 0, share: 0 }
    bucket.totalTokens += tokens
    bucket.inputTokens += inputSideTokens(record)
    bucket.outputTokens += record.outputTokens
    bucket.requestCount += record.requestCount
    buckets.set(key, bucket)
  }
  return [...buckets.values()]
    .map(bucket => ({ ...bucket, share: allTokens > 0 ? bucket.totalTokens / allTokens : 0 }))
    .sort((a, b) => (b.totalTokens - a.totalTokens) || (a.modelId === null ? 1 : b.modelId === null ? -1 : a.modelId < b.modelId ? -1 : 1))
}

/**
 * 汇总一批记录。`origin` 决定 `label`：估算与账单**分开标记**，调用方不必自己判。
 * 空输入时 label 仍按 origin 给出，数值全 0 —— 让页面渲染的是真数据，而不是一句空态。
 */
export function summarizeAgentUsage(records: readonly AgentUsageRecord[], origin: UsageOrigin): AgentUsageSummary {
  const inputTokens = records.reduce((sum, record) => sum + inputSideTokens(record), 0)
  const outputTokens = records.reduce((sum, record) => sum + record.outputTokens, 0)
  const cacheCreationTokens = records.reduce((sum, record) => sum + record.cacheCreationTokens, 0)
  const cacheReadTokens = records.reduce((sum, record) => sum + record.cacheReadTokens, 0)
  const requestCount = records.reduce((sum, record) => sum + record.requestCount, 0)
  const errorCount = records.reduce((sum, record) => sum + record.errorCount, 0)
  const ttfbs = records.map(record => record.timeToFirstTokenMs).filter((value): value is number => value !== null)
  const durations = records.map(record => record.durationMs).filter((value): value is number => value !== null)
  return {
    origin,
    label: origin === 'billing' ? BILLING_LABEL : ESTIMATION_LABEL,
    totalTokens: records.reduce((sum, record) => sum + totalTokens(record), 0),
    inputTokens,
    outputTokens,
    reasoningTokens: records.reduce((sum, record) => sum + record.reasoningTokens, 0),
    cacheCreationTokens,
    cacheReadTokens,
    cacheHitRate: cacheHitRate({ inputTokens, cacheCreationTokens, cacheReadTokens }),
    requestCount,
    errorCount,
    errorRate: requestCount > 0 ? errorCount / requestCount : 0,
    retryCount: records.reduce((sum, record) => sum + record.retryCount, 0),
    avgTimeToFirstTokenMs: average(ttfbs),
    avgDurationMs: average(durations),
    credits: records.reduce((sum, record) => sum + record.credits, 0),
    models: summarizeModels(records),
  }
}

// ── 格式化：规则逐条照 `usageStatsUiParts.tsx` / `AppUsagePanel.tsx` ────────────

/**
 * 紧凑数字。`usageStatsUiParts.tsx:11-19`：非有限数回 `--`；≥1000 走 compact 并留 1 位小数，
 * 否则标准格式、0 位小数。
 */
export function formatCompactNumber(locale: string, value: number): string {
  if (!Number.isFinite(value)) return '--'
  return new Intl.NumberFormat(locale, {
    notation: value >= 1000 ? 'compact' : 'standard',
    maximumFractionDigits: value >= 1000 ? 1 : 0,
  }).format(value)
}

/**
 * token 数值。`usageStatsUiParts.tsx:21-23` 转调 `tokenNumberFormat.ts`：
 * 非有限数回空串、≥1000 走 compact、最多 1 位小数。
 */
export function formatCompactTokenUsage(locale: string, value: number): string {
  if (!Number.isFinite(value)) return ''
  return new Intl.NumberFormat(locale || undefined, {
    notation: Math.abs(value) >= 1000 ? 'compact' : 'standard',
    maximumFractionDigits: 1,
    minimumFractionDigits: 0,
  }).format(value)
}

/** 摘要卡片用：中文 locale 下在万 / 亿前补一个空格（`usageStatsUiParts.tsx:25-30`）。 */
export function formatSummaryCompactTokenUsage(locale: string, value: number): string {
  const formatted = formatCompactTokenUsage(locale, value)
  return locale.startsWith('zh') ? formatted.replace(/(?<=\d)(?=[万亿])/u, ' ') : formatted
}

/** 百分比。`usageStatsUiParts.tsx:32-37`：≥10% 不留小数，否则 1 位。 */
export function formatPercent(locale: string, value: number): string {
  return new Intl.NumberFormat(locale, {
    style: 'percent',
    maximumFractionDigits: value >= 0.1 ? 0 : 1,
  }).format(value)
}

/**
 * 命中率 / 费率。`CodingPlanUsagePanel.tsx:1007-1017`：null / 非有限回 `--`，
 * 值 > 1 视为百分数先除 100，最多 1 位小数、不补零。
 */
export function formatRate(locale: string, value: number | null): string {
  if (value === null || !Number.isFinite(value)) return '--'
  const normalized = value > 1 ? value / 100 : value
  return new Intl.NumberFormat(locale, {
    maximumFractionDigits: 1,
    minimumFractionDigits: 0,
    style: 'percent',
  }).format(normalized)
}

/** 趋势。`CodingPlanUsagePanel.tsx:1034-1040`：显式带 +/- 号，0 不带号。 */
export function formatTrend(locale: string, value: number): string {
  const sign = value > 0 ? '+' : value < 0 ? '-' : ''
  return `${sign}${new Intl.NumberFormat(locale, { maximumFractionDigits: 0, style: 'percent' }).format(Math.abs(value))}`
}

/** 天数。`AppUsagePanel.tsx:177-185`：紧凑数字 + 空格 + `settings.usage.duration.day`。 */
export function formatDays(locale: string, days: number): string {
  return `${formatCompactNumber(locale, days)} 天`
}

/**
 * 时长。`AppUsagePanel.tsx:187-206`：向下取整到分钟，天 / 小时 / 分钟逐级拼；
 * 全为 0 时也要出「0 分钟」（`minutes > 0 || parts.length === 0` 那一条）。
 */
export function formatDuration(durationMs: number): string {
  const totalMinutes = Math.max(0, Math.floor(durationMs / 60_000))
  const days = Math.floor(totalMinutes / (24 * 60))
  const hours = Math.floor((totalMinutes % (24 * 60)) / 60)
  const minutes = totalMinutes % 60
  const parts: string[] = []
  if (days > 0) parts.push(`${days} 天`)
  if (hours > 0) parts.push(`${hours} 小时`)
  if (minutes > 0 || parts.length === 0) parts.push(`${minutes} 分钟`)
  return parts.join(' ')
}

/** 时延（ms → 可读）。走 `formatDuration`，所以 0 也显示「0 分钟」而不是空白。 */
export function formatLatency(ms: number | null): string {
  if (ms === null || !Number.isFinite(ms)) return '--'
  return formatDuration(ms)
}

/** 模型名。`usageStatsUiParts.tsx:83-88`：空白 id 走未知模型文案。 */
export function resolveModelLabel(modelId: string | null): string {
  return modelId?.trim() || UNKNOWN_MODEL_LABEL
}

/** 来源行。`usageStatsUiParts.tsx` 无此函数，模板取自 zh-CN.ts:3232 的 `sourceProvider`。 */
export function formatSourceProvider(providerId: string | null): string {
  return SOURCE_PROVIDER_TEMPLATE.replace('{provider}', providerId?.trim() || UNKNOWN_MODEL_LABEL)
}

/** 标记行：估算 / 账单二选一。这是 AG-09「分开标记」的落点。 */
export function formatUsageOriginLabel(origin: UsageOrigin): string {
  return origin === 'billing' ? BILLING_LABEL : ESTIMATION_LABEL
}

/**
 * 汇总 → 展示行。标签全部取 zh-CN 原文：
 * `totalTokens`(:3401) / `tokenUnit`(:3402) / `creditUnit`(:3403) / `cacheHitRate`(:3416) /
 * `calls`(:3225) / `modelUsageTitle`(:3442)。重试数照存但不给标签（上游没有对应文案）。
 */
export function buildUsageStatItems(summary: AgentUsageSummary, locale: string): AgentUsageStatItem[] {
  const items: AgentUsageStatItem[] = [
    { label: 'tokens 用量', value: `${formatSummaryCompactTokenUsage(locale, summary.totalTokens)} tokens` },
    { label: 'Cache 命中率', value: formatRate(locale, summary.cacheHitRate) },
    { label: '调用次数', value: formatCompactNumber(locale, summary.requestCount) },
    { label: '模型用量', value: `${formatCompactNumber(locale, summary.models.length)}` },
  ]
  if (summary.origin === 'billing') {
    items.push({ label: '积分总数', value: `${formatCompactNumber(locale, summary.credits)} 积分` })
  }
  return items
}

/** 记录工厂：把本仓 `src/agent.ts:117` 的 `UsageRecord` 估算转成一条 estimated 记录。 */
export function recordFromUsageRecord(
  usage: UsageRecord,
  options: { at: string; modelId?: string | null; providerId?: string | null },
): AgentUsageRecord {
  const summary = summarizeUsage([usage])
  const chars = usage.promptChars + usage.completionChars
  return {
    at: options.at,
    origin: 'estimated',
    modelId: options.modelId ?? null,
    providerId: options.providerId ?? null,
    providerReported: false,
    // promptChars 视作输入侧字符，completionChars 视作输出字符；两者都按估算除数折算。
    inputTokens: Math.ceil(usage.promptChars / ESTIMATED_TOKEN_CHAR_DIVISOR),
    outputTokens: Math.ceil(usage.completionChars / ESTIMATED_TOKEN_CHAR_DIVISOR),
    reasoningTokens: 0,
    cacheCreationTokens: 0,
    cacheReadTokens: 0,
    providerTotalTokens: null,
    retryCount: 0,
    timeToFirstTokenMs: null,
    durationMs: null,
    requestCount: summary.calls,
    errorCount: 0,
    credits: 0,
  }
}

export interface AgentUsageStatsStore {
  /** 全部记录，按 `at` 升序（旧的在前）。 */
  list(): AgentUsageRecord[]
  /** 追加一条。超上限先淘汰 `at` 最旧的。 */
  record(record: AgentUsageRecord): AgentUsageRecord
  /** 追加一条 estimated 记录（从 `src/agent.ts` 的 `UsageRecord` 转）。 */
  recordUsage(usage: UsageRecord, options: { at: string; modelId?: string | null; providerId?: string | null }): AgentUsageRecord
  /** 某个来源的汇总。 */
  summary(origin: UsageOrigin): AgentUsageSummary
  /** 某个来源、某个模型的汇总；没有记录时仍返回该 origin 的零值汇总。 */
  summaryForModel(origin: UsageOrigin, modelId: string | null): AgentUsageSummary
  /** 清空。 */
  clear(): void
}

/**
 * 建记账库。
 *
 * `storage` 不传：尝试 localStorage，取不到（Node、隐私模式）就只活在内存里。
 * 传 null：明确要内存模式。传了对象：读写都走它，测试用这个钉住落盘形状。
 * `now` 注入时钟，让 `at` 与淘汰顺序在测试里可断言。
 */
export function createAgentUsageStatsStore(
  storage?: AgentUsageStatsStorage | null,
  now?: () => Date,
): AgentUsageStatsStore {
  const clock = now ?? (() => new Date())
  const backing = storage === undefined ? defaultStorage() : storage
  let library = EMPTY

  if (backing) {
    try {
      library = parseLibrary(backing.getItem(AGENT_USAGE_STATS_STORAGE_KEY))
    } catch {
      library = { records: [] }
    }
  }

  const persist = (): void => {
    if (!backing) return
    try {
      backing.setItem(AGENT_USAGE_STATS_STORAGE_KEY, JSON.stringify({ records: library.records }))
    } catch {
      // 配额满 / 隐私模式：这一次没写上，内存里的库仍然是真的。下次能写再写。
    }
  }

  const append = (record: AgentUsageRecord): AgentUsageRecord => {
    const next = [...library.records, record]
    library = { records: next.length > AGENT_USAGE_RECORD_LIMIT ? oldestFirst(next).slice(-AGENT_USAGE_RECORD_LIMIT) : next }
    persist()
    return copyRecord(record)
  }

  return {
    list() {
      return oldestFirst(library.records).map(copyRecord)
    },
    record(record) {
      const normalized = normalizeRecord(record)
      // 坏记录直接拒收（不写进去再当读坏处理）：`at` / `origin` 是必填。
      if (!normalized) throw new TypeError('AgentUsageRecord requires an ISO `at` and origin estimated|billing')
      return append(normalized)
    },
    recordUsage(usage, options) {
      return append(recordFromUsageRecord(usage, options))
    },
    summary(origin) {
      return summarizeAgentUsage(library.records.filter(record => record.origin === origin), origin)
    },
    summaryForModel(origin, modelId) {
      const scoped = library.records.filter(record => record.origin === origin && record.modelId === modelId)
      return summarizeAgentUsage(scoped, origin)
    },
    clear() {
      library = { records: [] }
      persist()
    },
  }
}

/** 时钟缺省值，供调用方复用（记账条目的 `at`）。 */
export function usageTimestamp(now: () => Date = () => new Date()): string {
  return now().toISOString()
}