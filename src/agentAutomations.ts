// Agent 设置「自动化」节（ZCode section id `automations`，图标 AlarmClock，标题带 Beta 徽标）的配置面。
//
// 为什么单独一个文件：这一节与 `src/agentSettings.ts` 的「模型/权限/预算」不是一件事 —— 它有
// **自己的调度语义**（cron + 权威 scheduleRule）、自己的**状态机**（四态生命周期 + 四态派发）
// 和自己的**上限**（20 条）。塞进主设置会让 `normalizeAgentSettings` 背上 cron 解析。
//
// 字段出处（ZCode，只读参照 `.tools/ZCode`；`automation-types.ts` = `packages/shared/src/automation-types.ts`）：
//   · `title` / `prompt` / `enabled` —— `automation-types.ts:67,70,91`。前两个是必填三选一里的两个：
//     `packages/ui/src/settings/automationEditValidation.ts:9-12` 把 title/schedule/prompt 的空值记为字段级错误。
//   · `cronExpr` —— 五段 cron、本地时区（`automation-types.ts:68`）。**它是兼容展示面**：
//     `automation-types.ts:34` 写明「cronExpr 保留为兼容展示，调度以本字段为权威」（指 scheduleRule）。
//   · `scheduleRule` —— `automation-types.ts:35-46`（unit/interval/hour/minute/anchorAt/weekdays/
//     monthDays/months/monthlyMode）。`recurring`/`maxRuns`/`endAt` —— `:83-86`。
//   · `lifecycleStatus` 四态 —— `automation-types.ts:19`；`dispatchStatus` 四态 —— `:22-26`。
//   · `lastError` —— `:98`；失败徽章判据见 `packages/ui/src/settings/automationFormat.ts:25-31`
//     的 `hasAutomationFailureState`。`runCount`/`nextRunAt`/`lastRunAt` —— `:90,93,94`。
//   · `workspacePath`/`workspaceIdentity`/`workspaceKey` —— `automation-types.ts:76-78`
//     （key = `workspaceIdentity?.trim() || workspacePath`，`:75` 的注释）；候选构建见
//     `packages/ui/src/settings/automationWorkspaceOptions.ts:57-83`（排除 conversation 用途与只读 tab、按 key 去重）。
//   · `statusFilter` —— `packages/ui/src/settings/automationStatusFilter.ts:9-20`；分组口径同文件
//     `:41-46`：**先看失败徽章，再看 lifecycle 终态，其余进行中**。
//   · `templates` —— `packages/ui/src/settings/automationTemplateCatalog.ts`：定时模板带 `cronExpr`
//     （`:19-22`）、闲时模板带 `customize`（`:24-28`），共用 `{id,title,description,prompt}`（`:11-17`）。
//   · `beta` —— zh-CN `settings.automations.betaBadge` = "Beta"（`zh-CN.ts:6058`）；节定义见
//     `packages/ui/src/settings/settingsPageConfig.ts:112-118`（`titleBadgeId`）。
//
// **本仓只做配置面 + 纯计算，不做调度器**：ZCode 的真正触发由 services 侧 scheduler 轮询
// `automation_runs` 承担（`packages/services/src/session/automationCron.ts:51-53` 的注释：
// 「不用 croner 做实际调度——调度循环由 scheduler 自己轮询」），数据落在 `tasks-index.sqlite`
// （`automation-types.ts:6-7`）。本仓两者皆无，所以「启用」只保存配置，**不会真的到点跑**。
import {
  defaultSettingsStorage, readSettingsJson, writeSettingsJson,
  type SettingsStorage,
} from './agentSettingsStore.ts'

/** 存储键。与 `src/agentSettings.ts` 同一族，但独立成键（这一节有独立生命周期与 20 条上限）。 */
export const AGENT_AUTOMATIONS_STORAGE_KEY = 'taocode.agent.automations'

/** 标题上的 Beta 徽标原文（zh-CN `settings.automations.betaBadge` = "Beta"，`zh-CN.ts:6058`）。 */
export const AGENT_AUTOMATIONS_BETA_BADGE = 'Beta'

/** 节标题原文（zh-CN `settings.automations.title` = "自动化"，`zh-CN.ts:6056`）。 */
export const AGENT_AUTOMATIONS_TITLE = '自动化'

/** 单个本地任务索引允许保留的定时任务总数（ZCode `AUTOMATION_CREATE_LIMIT`，`automation-types.ts:10`）。 */
export const AGENT_AUTOMATIONS_MAX_ENTRIES = 20

/** 生命周期四态（`automation-types.ts:19`）。顺序照展示文案 zh-CN `automations.lifecycle.*`（`:6189-6192`）。 */
export const AGENT_AUTOMATION_LIFECYCLE_STATUSES = ['active', 'paused', 'completed', 'failed'] as const

export type AgentAutomationLifecycleStatus = (typeof AGENT_AUTOMATION_LIFECYCLE_STATUSES)[number]

/** 派发四态（`automation-types.ts:22-26`）。 */
export const AGENT_AUTOMATION_DISPATCH_STATUSES = [
  'idle', 'claimed', 'dispatched', 'failed_to_dispatch',
] as const

export type AgentAutomationDispatchStatus = (typeof AGENT_AUTOMATION_DISPATCH_STATUSES)[number]

/** 状态筛选四值（`automationStatusFilter.ts:9`）。 */
export const AGENT_AUTOMATION_STATUS_FILTERS = ['all', 'inProgress', 'completed', 'failed'] as const

export type AgentAutomationStatusFilter = (typeof AGENT_AUTOMATION_STATUS_FILTERS)[number]

/** 默认筛选 = 不过滤（`automationStatusFilter.ts:13` 的 `DEFAULT_AUTOMATION_STATUS_FILTER`）。 */
export const AGENT_AUTOMATION_DEFAULT_STATUS_FILTER: AgentAutomationStatusFilter = 'all'

/** 自定义重复的六种单位（`automation-types.ts:36` 的 `unit`）。 */
export const AGENT_AUTOMATION_SCHEDULE_UNITS = [
  'minute', 'hourly', 'daily', 'weekly', 'monthly', 'yearly',
] as const

export type AgentAutomationScheduleUnit = (typeof AGENT_AUTOMATION_SCHEDULE_UNITS)[number]

/** interval 的合法区间：ZCode 注释「1–200 的整数间隔」（`automation-types.ts:173`）。 */
export const AGENT_AUTOMATION_INTERVAL_MIN = 1
export const AGENT_AUTOMATION_INTERVAL_MAX = 200

/** 自定义重复规则（`automation-types.ts:35-46`）。`anchorAt` 是权威锚点（毫秒时间戳）。 */
export interface AgentAutomationScheduleRule {
  unit: AgentAutomationScheduleUnit
  interval: number
  /** 0-23。 */
  hour: number
  /** 0-59。 */
  minute: number
  /** 锚点时刻（毫秒时间戳）。 */
  anchorAt: number
  /** weekly 用：0(周日)-6(周六)。 */
  weekdays: number[]
  /** monthly/yearly 用：1-31。 */
  monthDays: number[]
  /** yearly 用：1-12。缺省回退 anchorAt 的月份（`automation-types.ts:43`）。 */
  months: number[]
  monthlyMode: 'date' | 'weekday'
}

/** 模板条目（`automationTemplateCatalog.ts:11-28` 的共用基座 + 两个分支的专有字段）。 */
export interface AgentAutomationTemplate {
  id: string
  title: string
  description: string
  prompt: string
  /** 定时模板带 cron；闲时模板为 null（`ScheduledAutomationTemplate.cronExpr` vs 闲时无此字段）。 */
  cronExpr: string | null
  /** 闲时模板的「自定义」入口（`OffPeakAutomationTemplate.customize`，`automationTemplateCatalog.ts:25`）。 */
  customize: boolean
}

/** 一条定时任务（`ZCodeAutomation` 的配置面子集，`automation-types.ts:65-101`）。 */
export interface AgentAutomation {
  id: string
  title: string
  prompt: string
  /** 五段 cron，本地时区。兼容展示面（`automation-types.ts:34,68`）。 */
  cronExpr: string
  /** 权威调度规则。缺省时以 cronExpr 为准（`automation-types.ts:87`）。 */
  scheduleRule: AgentAutomationScheduleRule | null
  /** true=无限循环；false=有限次（配合 maxRuns，`automation-types.ts:83-84`）。 */
  recurring: boolean
  maxRuns: number | null
  /** 截止时间（毫秒时间戳）。越过即不再触发（`automation-types.ts:86`）。 */
  endAt: number | null
  enabled: boolean
  lifecycleStatus: AgentAutomationLifecycleStatus
  dispatchStatus: AgentAutomationDispatchStatus
  dispatchAttempts: number
  lastError: string
  runCount: number
  nextRunAt: number | null
  lastRunAt: number | null
  /** `workspaceIdentity?.trim() || workspacePath`（`automation-types.ts:75-76`）。 */
  workspaceKey: string
  workspacePath: string
  workspaceIdentity: string
  /** 来源模板 id（`materializeScheduledTemplateDraft` 的 `templateId`，`automationTemplateCatalog.ts:220`）。 */
  templateId: string
}

/** 自动化节的状态面。 */
export interface AgentAutomationsSettings {
  automations: AgentAutomation[]
  /** 列表筛选的持久化值（`automationStatusFilter.ts:9`）。 */
  statusFilter: AgentAutomationStatusFilter
  templates: AgentAutomationTemplate[]
}

const MAX_TITLE_CHARS = 120
const MAX_PROMPT_CHARS = 4_000
const MAX_ERROR_CHARS = 500

/** 出厂默认：空列表、无模板。ZCode 的模板来自远端 `ClientSceneConfig`（`automationTemplateCatalog.ts:180-188`），
 *  本仓没有那条配置源，**不预置假模板**（不放假控件）。 */
export function defaultAgentAutomations(): AgentAutomationsSettings {
  return { automations: [], statusFilter: AGENT_AUTOMATION_DEFAULT_STATUS_FILTER, templates: [] }
}

const pad2 = (value: number): string => String(value).padStart(2, '0')

function isOneOf<T extends string>(value: unknown, list: readonly T[]): value is T {
  return typeof value === 'string' && (list as readonly string[]).includes(value)
}

const text = (value: unknown, fallback: string, max: number) =>
  typeof value === 'string' ? value.slice(0, max) : fallback

const flag = (value: unknown, fallback: boolean) => (typeof value === 'boolean' ? value : fallback)

const whole = (value: unknown, fallback: number, min: number, max: number) => {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback
  return Math.min(max, Math.max(min, Math.round(value)))
}

const timestamp = (value: unknown): number | null =>
  typeof value === 'number' && Number.isFinite(value) && value > 0 ? Math.round(value) : null

/** 整数组：只保留区间内的整数，去重排序。空数组是合法值（调用方决定回退）。 */
function intList(value: unknown, min: number, max: number): number[] {
  if (!Array.isArray(value)) return []
  const out = new Set<number>()
  for (const item of value) {
    if (typeof item !== 'number' || !Number.isInteger(item) || item < min || item > max) continue
    out.add(item)
  }
  return [...out].sort((left, right) => left - right)
}

/** 归一 scheduleRule：逐字段救，救不了的退该字段默认。整体不可救时返回 null（退回 cronExpr）。 */
function normalizeScheduleRule(value: unknown): AgentAutomationScheduleRule | null {
  if (!value || typeof value !== 'object') return null
  const raw = value as Record<string, unknown>
  const unit = isOneOf(raw.unit, AGENT_AUTOMATION_SCHEDULE_UNITS) ? raw.unit : null
  // unit 非法就没有任何可算的语义（`automationCron.ts:140-218` 每个分支都先认 unit），直接丢。
  if (!unit) return null
  const anchorAt = timestamp(raw.anchorAt) ?? 0
  return {
    unit,
    interval: whole(raw.interval, 1, AGENT_AUTOMATION_INTERVAL_MIN, AGENT_AUTOMATION_INTERVAL_MAX),
    hour: whole(raw.hour, new Date(anchorAt).getHours(), 0, 23),
    minute: whole(raw.minute, new Date(anchorAt).getMinutes(), 0, 59),
    // anchorAt 缺失时用 0：ZCode 的算法把它当创建时刻用（`automationCron.ts:144-145`），
    // 0 会让间隔规则算出一个早已过去的锚点，从而返回 null —— 诚实，不猜一个假时间。
    anchorAt,
    weekdays: intList(raw.weekdays, 0, 6),
    monthDays: intList(raw.monthDays, 1, 31),
    months: intList(raw.months, 1, 12),
    monthlyMode: raw.monthlyMode === 'weekday' ? 'weekday' : 'date',
  }
}

/**
 * 把任意输入归一成一份合法设置。**永不抛、永不返回坏值**。
 *
 * 逐字段救，救不了的退**该字段**默认（不按字段数量判损坏 —— 本仓铁律）。
 * 垃圾条目只丢自己：一条 `null` 不会带走整张表。
 */
export function normalizeAgentAutomations(input: unknown): AgentAutomationsSettings {
  const defaults = defaultAgentAutomations()
  if (!input || typeof input !== 'object') return defaults
  const raw = input as Record<string, unknown>

  const automationsRaw = Array.isArray(raw.automations) ? raw.automations : []
  const automations: AgentAutomation[] = []
  for (const item of automationsRaw) {
    if (automations.length >= AGENT_AUTOMATIONS_MAX_ENTRIES) break
    if (!item || typeof item !== 'object') continue
    const entry = item as Record<string, unknown>
    const workspaceIdentity = text(entry.workspaceIdentity, '', 512).trim()
    const workspacePath = text(entry.workspacePath, '', 4096)
    // key 规则逐字取 `automation-types.ts:75` 的注释。
    const workspaceKey = workspaceIdentity || workspacePath
    const maxRuns = entry.maxRuns === null || entry.maxRuns === undefined
      ? null
      : whole(entry.maxRuns, 1, 1, AGENT_AUTOMATIONS_MAX_ENTRIES * 1_000)
    automations.push({
      id: typeof entry.id === 'string' && entry.id.trim() ? entry.id : `automation-${automations.length + 1}`,
      title: text(entry.title, '', MAX_TITLE_CHARS),
      prompt: text(entry.prompt, '', MAX_PROMPT_CHARS),
      cronExpr: text(entry.cronExpr, '', 200).trim(),
      scheduleRule: normalizeScheduleRule(entry.scheduleRule),
      recurring: flag(entry.recurring, true),
      maxRuns,
      endAt: timestamp(entry.endAt),
      enabled: flag(entry.enabled, true),
      lifecycleStatus: isOneOf(entry.lifecycleStatus, AGENT_AUTOMATION_LIFECYCLE_STATUSES)
        ? entry.lifecycleStatus
        : 'active',
      dispatchStatus: isOneOf(entry.dispatchStatus, AGENT_AUTOMATION_DISPATCH_STATUSES)
        ? entry.dispatchStatus
        : 'idle',
      dispatchAttempts: whole(entry.dispatchAttempts, 0, 0, 1_000_000),
      lastError: text(entry.lastError, '', MAX_ERROR_CHARS),
      runCount: whole(entry.runCount, 0, 0, 1_000_000),
      nextRunAt: timestamp(entry.nextRunAt),
      lastRunAt: timestamp(entry.lastRunAt),
      workspaceKey,
      workspacePath,
      workspaceIdentity,
      templateId: text(entry.templateId, '', 200),
    })
  }

  const templatesRaw = Array.isArray(raw.templates) ? raw.templates : []
  const templates: AgentAutomationTemplate[] = []
  for (const item of templatesRaw) {
    if (!item || typeof item !== 'object') continue
    const entry = item as Record<string, unknown>
    if (typeof entry.id !== 'string' || !entry.id.trim()) continue
    templates.push({
      id: entry.id,
      title: text(entry.title, '', MAX_TITLE_CHARS),
      description: text(entry.description, '', 1_000),
      prompt: text(entry.prompt, '', MAX_PROMPT_CHARS),
      // 定时模板必须带一条本仓能算的 cron，否则点了模板会得到一条永远不触发的任务
      // （ZCode 对不可解析的 cron 是直接拒绝该模板的，`automationTemplateCatalog.ts:140-144`）。
      cronExpr: typeof entry.cronExpr === 'string' && entry.cronExpr.trim() ? entry.cronExpr.trim() : null,
      customize: flag(entry.customize, false),
    })
  }

  return {
    automations,
    statusFilter: isOneOf(raw.statusFilter, AGENT_AUTOMATION_STATUS_FILTERS)
      ? raw.statusFilter
      : defaults.statusFilter,
    templates,
  }
}

/** cron 五段字段的取值集合。只支持标准五段（分 时 日 月 周）。 */
interface CronField {
  minutes: Set<number>
  hours: Set<number>
  days: Set<number>
  months: Set<number>
  weekdays: Set<number>
  /** 日/周是否都是通配（决定 AND/OR 语义）。 */
  dayWildcard: boolean
  weekdayWildcard: boolean
}

const CRON_RANGES: ReadonlyArray<[min: number, max: number]> = [
  [0, 59], [0, 23], [1, 31], [1, 12], [0, 6],
]

/**
 * 解析一段 cron 字段。支持 `*`、`n`、`a-b`、`a-b/n`、逗号列表。
 * 越界/非法返回 null（调用方决定回退，不猜）。
 */
function parseCronField(spec: string, index: number): Set<number> | null {
  const [min, max] = CRON_RANGES[index]!
  const out = new Set<number>()
  for (const part of spec.split(',')) {
    const piece = part.trim()
    if (!piece) return null
    const [rangePart, stepPart] = piece.split('/')
    if (stepPart !== undefined && !/^[1-9]\d*$/.test(stepPart)) return null
    const step = stepPart === undefined ? 1 : Number(stepPart)
    let start: number
    let end: number
    if (rangePart === '*') {
      start = min
      end = max
    } else if (/^\d+$/.test(rangePart)) {
      start = Number(rangePart)
      // `5/10` 这种「从 5 开始每 10」按 croner 的常规解释一路到字段上界。
      end = stepPart === undefined ? start : max
    } else {
      const range = /^(\d+)-(\d+)$/.exec(rangePart)
      if (!range) return null
      start = Number(range[1])
      end = Number(range[2])
    }
    if (start < min || end > max || start > end) return null
    for (let value = start; value <= end; value += step) out.add(value)
  }
  return out.size ? out : null
}

/** 解析五段 cron。段数不对或任一段非法都返回 null。 */
export function parseAutomationCron(cronExpr: string): CronField | null {
  const parts = cronExpr.trim().split(/\s+/)
  if (parts.length !== 5) return null
  const minutes = parseCronField(parts[0]!, 0)
  const hours = parseCronField(parts[1]!, 1)
  const days = parseCronField(parts[2]!, 2)
  const months = parseCronField(parts[3]!, 3)
  const weekdays = parseCronField(parts[4]!, 4)
  if (!minutes || !hours || !days || !months || !weekdays) return null
  return {
    minutes, hours, days, months, weekdays,
    dayWildcard: parts[2]!.trim() === '*',
    weekdayWildcard: parts[4]!.trim() === '*',
  }
}

/** cron 是否能在本仓算出下次时间。不可算的（非法段数/非法字段）返回 false。 */
export function isComputableCron(cronExpr: string): boolean {
  return parseAutomationCron(cronExpr) !== null
}

const atTime = (date: Date, hour: number, minute: number): Date =>
  new Date(date.getFullYear(), date.getMonth(), date.getDate(), hour, minute, 0, 0)

function firstWeekdayOfMonth(year: number, month: number, weekday: number): Date {
  const first = new Date(year, month, 1)
  return new Date(year, month, 1 + ((weekday - first.getDay() + 7) % 7))
}

/**
 * scheduleRule 的下一次运行。**逐段移植 ZCode 的 `computeScheduleRuleNextRunAt`**
 * （`packages/services/src/session/automationCron.ts:133-220`），包括它那些刻意的边界：
 *   · minute 从 `anchorAt` 起算、不对齐墙钟（`:142-145`）；
 *   · monthly 的搜索上界是 `<= 1200`（`:191`，注释解释了「旧的严格小于只检查 offset=0」这个 bug）；
 *   · yearly 溢出守卫 `date.getMonth() !== targetMonth` 跳过该年（`:209,215`），2/30 不会误触发。
 *
 * 唯一改动：`from` **必填**（ZCode 缺省 `Date.now()`）。本仓不允许读系统时钟 ——
 * 判据必须用注入的基准时刻，否则会偶发红。
 */
function nextRunFromScheduleRule(rule: AgentAutomationScheduleRule, from: number): number | null {
  const interval = Math.max(1, Math.floor(rule.interval))
  const anchor = new Date(rule.anchorAt)
  if (Number.isNaN(anchor.getTime())) return null

  if (rule.unit === 'minute') {
    const step = interval * 60 * 1_000
    const steps = Math.max(1, Math.floor((from - rule.anchorAt) / step) + 1)
    return rule.anchorAt + steps * step
  }
  if (rule.unit === 'hourly') {
    const base = new Date(anchor)
    base.setMinutes(rule.minute, 0, 0)
    const step = interval * 60 * 60 * 1_000
    const steps = Math.max(0, Math.floor((from - base.getTime()) / step) + 1)
    return base.getTime() + steps * step
  }
  if (rule.unit === 'daily') {
    for (let index = 0; index < 36_600; index += 1) {
      const date = new Date(anchor.getFullYear(), anchor.getMonth(), anchor.getDate() + index * interval)
      const candidate = atTime(date, rule.hour, rule.minute).getTime()
      if (candidate > from) return candidate
    }
    return null
  }
  if (rule.unit === 'weekly') {
    const anchorWeek = new Date(anchor.getFullYear(), anchor.getMonth(), anchor.getDate())
    anchorWeek.setDate(anchorWeek.getDate() - ((anchorWeek.getDay() + 6) % 7))
    const weekdays = [...(rule.weekdays.length ? rule.weekdays : [1])].sort((a, b) => a - b)
    for (let week = 0; week < 5_220; week += interval) {
      for (const weekday of weekdays) {
        const dayOffset = (weekday + 6) % 7
        const date = new Date(
          anchorWeek.getFullYear(), anchorWeek.getMonth(),
          anchorWeek.getDate() + week * 7 + dayOffset,
        )
        const candidate = atTime(date, rule.hour, rule.minute).getTime()
        if (candidate > from) return candidate
      }
    }
    return null
  }
  if (rule.unit === 'monthly') {
    for (let offset = 0; offset <= 1_200; offset += interval) {
      const month = new Date(anchor.getFullYear(), anchor.getMonth() + offset, 1)
      const candidates = rule.monthlyMode === 'weekday'
        ? [firstWeekdayOfMonth(month.getFullYear(), month.getMonth(), rule.weekdays[0] ?? 1)]
        : [...(rule.monthDays.length ? rule.monthDays : [1])]
            .sort((a, b) => a - b)
            .map(day => new Date(month.getFullYear(), month.getMonth(), day))
            .filter(date => date.getMonth() === month.getMonth())
      for (const date of candidates) {
        const candidate = atTime(date, rule.hour, rule.minute).getTime()
        if (candidate > from) return candidate
      }
    }
    return null
  }
  // yearly：`months[0]` 优先、缺省回退锚点月份（`automation-types.ts:43`）。
  const targetMonth = rule.months.length
    ? (((rule.months[0]! - 1) % 12) + 12) % 12
    : anchor.getMonth()
  const targetDay = rule.monthDays[0] ?? anchor.getDate()
  for (let offset = 0; offset < 400; offset += interval) {
    const date = new Date(anchor.getFullYear() + offset, targetMonth, targetDay)
    if (date.getMonth() !== targetMonth) continue
    const candidate = atTime(date, rule.hour, rule.minute).getTime()
    if (candidate > from) return candidate
  }
  return null
}

/** cron 的下一次运行（本地时区）。只在「严格晚于 from」时返回。 */
function nextRunFromCron(field: CronField, from: number): number | null {
  const start = new Date(from)
  start.setSeconds(0, 0)
  start.setMinutes(start.getMinutes() + 1)
  // 时/分集合只排一次序：放在日循环里排会把同一份数组复制 372 次。
  const hours = [...field.hours].sort((a, b) => a - b)
  const minutes = [...field.minutes].sort((a, b) => a - b)
  // 搜索上界 5 年：cron 最稀疏的合法形态（`0 0 29 2 *`）在非闰年要等 4 年才命中。
  for (let year = start.getFullYear(); year <= start.getFullYear() + 5; year += 1) {
    for (let month = 1; month <= 12; month += 1) {
      if (!field.months.has(month)) continue
      for (let day = 1; day <= 31; day += 1) {
        const date = new Date(year, month - 1, day)
        // 溢出守卫：2/30 会滚到 3/2，必须跳过（与 `automationCron.ts:215` 同理）。
        if (date.getMonth() !== month - 1 || date.getDate() !== day) continue
        const matchesDay = field.days.has(day)
        const weekday = date.getDay()
        const matchesWeekday = field.weekdays.has(weekday) || (weekday === 0 && field.weekdays.has(7))
        // 标准 cron 语义：日与周都被限定时取并集，否则取交集。
        const dayOk = field.dayWildcard && field.weekdayWildcard
          ? true
          : field.dayWildcard ? matchesWeekday
            : field.weekdayWildcard ? matchesDay
              : matchesDay || matchesWeekday
        if (!dayOk) continue
        for (const hour of hours) {
          for (const minute of minutes) {
            const candidate = atTime(date, hour, minute).getTime()
            if (candidate > from) return candidate
          }
        }
      }
    }
  }
  return null
}

/**
 * 下一次触发时间。**纯函数：基准时刻由调用方注入**（本模块不读系统时钟）。
 *
 * 优先级与 ZCode 的 `computeAutomationNextRunAt` 逐字一致
 * （`automationCron.ts:343-350`）：**有 scheduleRule 用 scheduleRule，没有才用 cronExpr**。
 * 外加两条本仓补的收口，都来自 ZCode 的领域层：
 *   · 越过 `endAt` 返回 null（`automationService.ts:381-384` 会把生命周期改成 completed）；
 *   · 非 active 生命周期（completed/failed）不再排下一次（同上 `:385-390`）。
 *
 * 返回**本地日历时间**字符串 `YYYY-MM-DD HH:MM`（对齐 zh-CN `automations.nextRun` = 「下次运行 {when}」
 * 那个 `{when}` 的位置，`zh-CN.ts:6194`；格式化照 `automationFormat.ts:398-402` 的 `formatDateTime`）。
 * 夏令时：所有构造都走 `new Date(y, m, d, h, min)`，由 JS 本地时区规则决定墙上时间，
 * 与 ZCode 的做法相同（`automationCron.ts:123-125` 的 `atTime` 也是这么写的）。
 */
export function automationNextRun(automation: AgentAutomation, from: number): string | null {
  if (!Number.isFinite(from) || from <= 0) return null
  if (automation.lifecycleStatus === 'completed' || automation.lifecycleStatus === 'failed') return null
  if (automation.endAt !== null && automation.endAt > 0 && automation.endAt <= from) return null
  let next: number | null
  if (automation.scheduleRule) {
    next = nextRunFromScheduleRule(automation.scheduleRule, from)
  } else {
    const field = parseAutomationCron(automation.cronExpr)
    next = field ? nextRunFromCron(field, from) : null
  }
  if (next === null) return null
  if (automation.endAt !== null && automation.endAt > 0 && next > automation.endAt) return null
  const date = new Date(next)
  if (Number.isNaN(date.getTime())) return null
  return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())} `
    + `${pad2(date.getHours())}:${pad2(date.getMinutes())}`
}

/**
 * 是否展示失败徽章。逐字对齐 `hasAutomationFailureState`（`automationFormat.ts:25-31`）：
 * lifecycle=failed、派发失败、或有非空 lastError 三者之一即算失败。
 * 注释里那句「循环任务本身仍保持 active 并继续调度」是本函数存在的理由：
 * 失败徽章与生命周期是**两件事**，UI 不许拿其中一个当另一个。
 */
export function hasAutomationFailure(automation: AgentAutomation): boolean {
  return automation.lifecycleStatus === 'failed'
    || automation.dispatchStatus === 'failed_to_dispatch'
    || Boolean(automation.lastError.trim())
}

/**
 * 列表状态筛选。分组口径逐字对齐 `resolveAutomationStatusFilterKind`
 * （`automationStatusFilter.ts:41-46`）：**先看失败徽章（含派发失败/有错误信息）**，
 * 再看 lifecycle 终态 completed，其余一律进行中。
 *
 * 参数 `filter` 非法时退回 `settings.statusFilter`（持久化值），再非法退 `all`。
 * `all` 直接原样返回入参（`automationStatusFilter.ts:52`）。
 */
export function automationStatusFilterOf(
  settings: AgentAutomationsSettings,
  filter: AgentAutomationStatusFilter | string,
  list: readonly AgentAutomation[],
): AgentAutomation[] {
  const effective = isOneOf(filter, AGENT_AUTOMATION_STATUS_FILTERS)
    ? filter
    : isOneOf(settings.statusFilter, AGENT_AUTOMATION_STATUS_FILTERS)
      ? settings.statusFilter
      : AGENT_AUTOMATION_DEFAULT_STATUS_FILTER
  if (effective === 'all') return [...list]
  return list.filter(automation => {
    if (hasAutomationFailure(automation)) return effective === 'failed'
    return effective === (automation.lifecycleStatus === 'completed' ? 'completed' : 'inProgress')
  })
}

const WEEKDAY_LABELS = ['日', '一', '二', '三', '四', '五', '六'] as const

/**
 * 调度摘要（卡片上那句「每天 09:00」）。zh-CN 文案逐字取 `zh-CN.ts:6206-6232`
 * 的 `automations.frequency.*` / `automations.schedule.*`。
 *
 * 三条回退规则照 ZCode：
 *   · 一次性任务（`recurring === false && maxRuns <= 1`）**不显示频率**，显示「自定义」
 *     —— `automationCardSchedule.ts:37-41`：相对时间一次性被存成 minute scheduleRule，
 *     不特殊处理会被误显为「每 4 分钟」重复任务；
 *   · 有 scheduleRule 时从 rule 生成（`:43-44`），没有才从 cron 反解析（`:46`）；
 *   · `M H DOM MON *`（固定月日）一律「自定义」—— `automationFormat.ts:360-364`：
 *     五段 cron 不带年份，猜不出是单次还是年度重复。
 */
export function formatAutomationSchedule(automation: AgentAutomation): string {
  if (automation.recurring === false && (automation.maxRuns ?? 1) <= 1) return '自定义'
  const rule = automation.scheduleRule
  if (rule) {
    const time = `${pad2(rule.hour)}:${pad2(rule.minute)}`
    if (rule.unit === 'minute') return `每 ${rule.interval} 分钟`
    if (rule.unit === 'hourly') return `每 ${rule.interval} 小时的第 ${pad2(rule.minute)} 分`
    if (rule.unit === 'daily') return `每天 ${time}`
    if (rule.unit === 'weekly') {
      const days = rule.weekdays.length ? rule.weekdays : [1]
      return `每周${days.map(day => WEEKDAY_LABELS[day]).join('、')} ${time}`
    }
    if (rule.unit === 'monthly') {
      if (rule.monthlyMode === 'weekday') {
        return `每 ${rule.interval} 个月的第一个周${WEEKDAY_LABELS[rule.weekdays[0] ?? 1]}，${time}`
      }
      return `每 ${rule.interval} 个月的 ${rule.monthDays.join(', ')} 日，${time}`
    }
    return `每 ${rule.interval} 年的 ${rule.months[0] ?? 1} 月 ${rule.monthDays[0] ?? 1} 日，${time}`
  }
  const normalized = automation.cronExpr.trim().replace(/\s+/g, ' ')
  const minutes = /^\*\/([1-9]\d*) \* \* \* \*$/.exec(normalized)
  if (minutes) return `每 ${minutes[1]} 分钟`
  if (/^\d+ \d+ \d+ \d+ \*$/.test(normalized)) return '自定义'
  if (/^\d+ \d+ \d+ \*\/\d+ \*$/.test(normalized)) return '自定义'
  const field = parseAutomationCron(normalized)
  if (!field) return normalized || '自定义'
  const minuteList = [...field.minutes].sort((a, b) => a - b)
  const time = `${pad2([...field.hours].sort((a, b) => a - b)[0] ?? 0)}:${pad2(minuteList[0] ?? 0)}`
  // 只有一个时刻（分+时都唯一）才敢显示「几点几分」；否则退回更粗的频率文案。
  const atOneTime = minuteList.length === 1 && field.hours.size === 1
  const everyDay = field.months.size === 12
  if (atOneTime && everyDay && field.days.size === 31 && field.dayWildcard && field.weekdayWildcard) return '每天'
  if (atOneTime && everyDay && field.dayWildcard && !field.weekdayWildcard && field.weekdays.size === 5) {
    return `每工作日 ${time}`
  }
  if (atOneTime && everyDay && field.dayWildcard && field.weekdays.size === 1) {
    return `每周${WEEKDAY_LABELS[[...field.weekdays][0]!]} ${time}`
  }
  if (atOneTime && everyDay && field.weekdayWildcard && !field.dayWildcard && field.days.size === 1) {
    return `每月 ${[...field.days][0]} 号 ${time}`
  }
  if (minuteList.length === 1 && field.hours.size === 24) return `每小时的第 ${pad2(minuteList[0]!)} 分`
  return '自定义'
}

/** 保存前校验：返回问题清单（空数组 = 可以保存）。分工照 `src/agentSettings.ts:214-220`。 */
export function validateAgentAutomations(settings: AgentAutomationsSettings): string[] {
  const problems: string[] = []
  if (settings.automations.length > AGENT_AUTOMATIONS_MAX_ENTRIES) {
    problems.push(`定时任务最多 ${AGENT_AUTOMATIONS_MAX_ENTRIES} 条（ZCode 的上限，暂停/已完成/失败都计入），当前 ${settings.automations.length} 条。`)
  }
  const seen = new Set<string>()
  settings.automations.forEach((automation, index) => {
    const at = `第 ${index + 1} 条`
    if (seen.has(automation.id)) problems.push(`${at}：id「${automation.id}」重复。`)
    seen.add(automation.id)
    if (!automation.title.trim()) problems.push(`${at}：标题不能为空。`)
    else if (automation.title.length > MAX_TITLE_CHARS) problems.push(`${at}：标题最长 ${MAX_TITLE_CHARS} 个字符。`)
    if (!automation.prompt.trim()) problems.push(`${at}：提示词不能为空。`)
    else if (automation.prompt.length > MAX_PROMPT_CHARS) problems.push(`${at}：提示词最长 ${MAX_PROMPT_CHARS} 个字符。`)
    // 调度必填（`automationEditValidation.ts:10` 把空 cronExpr 记为 schedule 字段错误），
    // 且有 scheduleRule 时 cronExpr 只作兼容展示，不要求它可算。
    if (!automation.cronExpr.trim() && !automation.scheduleRule) {
      problems.push(`${at}：调度不能为空（填 cron 表达式或自定义重复规则）。`)
    } else if (!automation.scheduleRule && !isComputableCron(automation.cronExpr)) {
      problems.push(`${at}：cron 表达式必须是五段（分 时 日 月 周），例如「0 9 * * 1-5」。`)
    }
    const rule = automation.scheduleRule
    if (rule) {
      // 逐项区间检查写成表：每个条件 + 那句中文，ZCode 那边没有这层（本仓自定的护栏），
      // 但逐条留在这里是为了「哪一项越界」能一眼定位，而不是只丢一句笼统的「调度非法」。
      const ranges: Array<[boolean, string]> = [
        [rule.interval < AGENT_AUTOMATION_INTERVAL_MIN || rule.interval > AGENT_AUTOMATION_INTERVAL_MAX,
          `重复间隔必须是 ${AGENT_AUTOMATION_INTERVAL_MIN} 到 ${AGENT_AUTOMATION_INTERVAL_MAX} 的整数。`],
        [rule.hour < 0 || rule.hour > 23, '小时必须在 0 到 23 之间。'],
        [rule.minute < 0 || rule.minute > 59, '分钟必须在 0 到 59 之间。'],
        [rule.unit === 'weekly' && rule.weekdays.some(day => day < 0 || day > 6),
          '星期必须在 0（周日）到 6（周六）之间。'],
        [(rule.unit === 'monthly' || rule.unit === 'yearly') && rule.monthDays.some(day => day < 1 || day > 31),
          '日期必须在 1 到 31 之间。'],
        [rule.unit === 'yearly' && rule.months.some(month => month < 1 || month > 12), '月份必须在 1 到 12 之间。'],
      ]
      for (const [invalid, message] of ranges) {
        if (invalid) problems.push(`${at}：${message}`)
      }
    }
    if (automation.maxRuns !== null && automation.maxRuns < 1) {
      problems.push(`${at}：最多运行次数至少为 1。`)
    }
    if (automation.endAt !== null && automation.endAt > 0 && automation.nextRunAt !== null && automation.nextRunAt > automation.endAt) {
      problems.push(`${at}：下次运行时间已超过截止时间。`)
    }
  })
  return problems
}

/** 从存储读自动化（缺省走 `localStorage`；坏存档/旧形状退回默认，永不抛）。 */
export function loadAgentAutomations(storage: SettingsStorage | null = defaultSettingsStorage()): AgentAutomationsSettings {
  return readSettingsJson(storage, AGENT_AUTOMATIONS_STORAGE_KEY, normalizeAgentAutomations)
}

/** 写自动化。存不下（配额满/隐私模式）时静默降级 —— 只丢持久化，不打断本次会话。 */
export function saveAgentAutomations(settings: AgentAutomationsSettings, storage: SettingsStorage | null = defaultSettingsStorage()): boolean {
  return writeSettingsJson(storage, AGENT_AUTOMATIONS_STORAGE_KEY, settings)
}
