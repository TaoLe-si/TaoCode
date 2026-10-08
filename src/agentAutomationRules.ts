// 「自动化」节的**规则层**：调度表达式、字段校验、状态分组、模板目录、闲时任务状态机与存储。
// 与 `src/agentAutomations.ts` 分工：那个文件管**一条 automation 的字段形状与归一化**；这里管 ZCode 散在多个
// 纯逻辑模块里的**规则**（全纯函数、零框架，故集中一个 `.ts`，组件只接线）：automationFormat.ts（cron builder/
// 摘要/时间）· automationCardSchedule.ts（卡片摘要取舍）· automationEditValidation.ts + automationEditDirtyState.ts
// （校验）· automationStatusFilter.ts（筛选口径）· automationTemplateCatalog.ts（模板目录）· offPeakUiPresentation.ts /
// OffPeakTaskList.tsx / OffPeakHistoryTab.tsx / OffPeakEditView.tsx（闲时六态与编辑规则）· automationAgentConfigOptions.ts /
// automationWorkspaceOptions.ts（运行配置与项目候选）。文案一律取 zh-CN 原文（`packages/ui/src/i18n/locales/zh-CN.ts`）；
// ZCode 用 `intl.formatMessage({id}, values)`，这里用 `t(id, values)` 做同等的 `{name}` 替换，纯函数不依赖 i18n 运行时。
import { isComputableCron } from './agentAutomations.ts'
import { defaultSettingsStorage, readSettingsJson, writeSettingsJson, type SettingsStorage } from './agentSettingsStore.ts'
// ---- zh-CN 文案（逐字取 `zh-CN.ts`，行号在每条后）----
const ZH: Record<string, string> = {
  'automations.frequency.hourly': '每小时', 'automations.frequency.daily': '每天', // :6206-6207
  'automations.frequency.weekdays': '每工作日', 'automations.frequency.weekly': '每周', // :6208-6209
  'automations.frequency.monthly': '每月', 'automations.frequency.custom': '自定义', // :6210-6211
  'automations.weekday.0': '日', 'automations.weekday.1': '一', 'automations.weekday.2': '二', // :6212-6214
  'automations.weekday.3': '三', 'automations.weekday.4': '四', 'automations.weekday.5': '五', // :6215-6217
  'automations.weekday.6': '六', 'automations.weekday.separator': '、', // :6218-6219
  'automations.schedule.hourly': '每小时的第 {minute} 分', 'automations.schedule.daily': '每天 {time}', // :6220-6221
  'automations.schedule.weekdays': '每工作日 {time}', 'automations.schedule.weekly': '每周{days} {time}', // :6222-6223
  'automations.schedule.monthly': '每月 {day} 号 {time}', 'automations.schedule.customMinutes': '每 {interval} 分钟', // :6224-6225
  'automations.schedule.customHourly': '每 {interval} 小时的第 {time} 分', 'automations.schedule.custom': '每 {interval} {unit}，{time}', // :6226,:6228
  'automations.schedule.customWeekly': '每 {interval} 周的周{days}，{time}', // :6229
  'automations.schedule.customMonthlyDates': '每 {interval} 个月的 {days} 日，{time}', // :6230
  'automations.schedule.customMonthlyWeekday': '每 {interval} 个月的第一个周{day}，{time}', // :6231
  'automations.schedule.customYearly': '每 {interval} 年的 {month} 月 {day} 日，{time}', // :6232
  'automations.customRepeat.unit.day': '天', 'automations.time.soon': '1 分钟内', // :6273,:6235
  'automations.time.justNow': '刚刚', 'automations.time.minutes': '{value} 分钟', // :6236-6237
  'automations.time.hours': '{value} 小时', 'automations.time.days': '{value} 天', // :6238-6239
  'automations.time.in': '{amount}后', 'automations.time.ago': '{amount}前', // :6240-6241
  'automations.statusFilter.all': '全部', 'automations.statusFilter.inProgress': '进行中', // :6085-6086
  'automations.statusFilter.completed': '已完成', 'automations.statusFilter.failed': '失败', // :6087-6088
  'automations.statusFilter.empty': '没有符合条件的任务', // :6089
  'automations.lifecycle.active': '运行中', 'automations.lifecycle.paused': '已暂停', // :6189-6190
  'automations.lifecycle.completed': '已完成', 'automations.lifecycle.failed': '已失败', // :6191-6192
  'automations.nextRun': '下次运行 {when}', 'automations.runCount': '已运行 {count} 次', // :6194-6195
  'offPeak.status.queued': '等待闲时算力', 'offPeak.status.paused': '已暂停', // :6099-6100
  'offPeak.status.running': '运行中', 'offPeak.status.completed': '已完成', // :6101-6102
  'offPeak.status.failed': '失败', 'offPeak.status.cancelled': '已取消', // :6103-6104
  'offPeak.badge.queuePosition': '排队第 {position} 位', 'offPeak.badge.pausedPosition': '#{position} 已暂停', // :6098,:6095
  'offPeak.list.empty': '还没有闲时任务。创建一个，让它在算力空闲时免费执行。', // :6094
  'offPeak.history.empty': '还没有历史记录。', 'offPeak.history.durationMinutes': '{count} 分钟', // :6147,:6150
  'offPeak.modelSelection.repairRequired': '模型配置需要更新，请重新选择后保存。', // :6122
  'offPeak.newTask.template.customize.title': '自定义', // :6081
  'offPeak.newTask.template.customize.description': '跳过模板，直接告诉它你想做什么。', // :6082
  'offPeak.create.remaining.hoursMinutes': '{hours} 小时 {minutes} 分钟', 'offPeak.create.remaining.hours': '{hours} 小时', // :6158-6159
  'offPeak.create.remaining.minutes': '{minutes} 分钟', 'offPeak.create.remaining.lessThanMinute': '不到 1 分钟', // :6160-6161
  'automations.runs.status.running': '进行中', 'automations.runs.status.succeeded': '成功', // :6307-6308
  'automations.runs.status.failed': '失败', 'automations.runs.status.stopped': '已停止', // :6309,:6311
  'automations.runs.status.skipped': '已跳过', // :6312
}
/** ICU 模板的 `{name}` 替换（对齐 `intl.formatMessage` 的最小契约，`automationFormat.ts:5-7`）。 */
export function t(id: string, values?: Record<string, string>): string {
  const template = ZH[id]
  if (template === undefined) return id
  if (!values) return template
  return template.replace(/\{(\w+)\}/g, (m, key: string) => (key in values ? values[key]! : m))
}
const pad2 = (value: number): string => String(value).padStart(2, '0')
// ---- 调度：cron builder（`automationFormat.ts:43-385`）----
export type CronFrequency = 'hourly' | 'daily' | 'weekdays' | 'weekly' | 'monthly' | 'custom' // :44
export type CustomRepeatUnit = 'minute' | 'hourly' | 'daily' | 'weekly' | 'monthly' | 'yearly' // :45
export type CustomMonthlyMode = 'date' | 'weekday' // :46

export interface CronBuilderState { // :48-67
  frequency: CronFrequency
  hour: number // daily/weekly/monthly 用：0-23
  minute: number // daily/weekly/monthly 用：0-59
  weekdays: number[] // weekly 用：0(周日)-6(周六)
  dayOfMonth: number // monthly 用：1-31
  rawExpr: string // custom 用：原始 5 段 cron
  customInterval: number; customUnit: CustomRepeatUnit; customWeekdays: number[]; customMonthDays: number[]
  customMonth: number // yearly 用：1-12（日期复用 customMonthDays[0]）
  customMonthlyMode: CustomMonthlyMode
}
/** 周的显示顺序：周一在首、周日在末（`automationFormat.ts:69`）。 */
export const WEEKDAY_ORDER = [1, 2, 3, 4, 5, 6, 0] as const
const weekdayLabel = (day: number): string => t(`automations.weekday.${day}`) // :246-248

/**
 * builder 状态 → 5 段 cron（分 时 日 月 周）。`automationFormat.ts:81-135`。三处**故意降级**照抄
 * （cron 表达不了真实间隔时只留合法候选，真实间隔由 scheduleRule 承载）：minute 步长>59→每分钟（croner
 * 上限 59，`:100-102`）；hourly>24→每时（`:105-107`）；daily>31→每日（`:110-112`）；monthly 的 interval
 * 不写进月份字段（月份只 1-12，`:119-121`）。`now` 仅供 yearly 缺省日取「今天」（`:129` 原读系统时钟），注入为可测。
 */
export function buildCronExpr(state: CronBuilderState, now: number = Date.now()): string {
  const { frequency, hour, minute, weekdays, dayOfMonth, rawExpr } = state
  switch (frequency) {
    case 'hourly': return `${minute} * * * *`
    case 'daily': return `${minute} ${hour} * * *`
    case 'weekdays': return `${minute} ${hour} * * 1-5`
    case 'weekly': return `${minute} ${hour} * * ${weekdays.length > 0 ? [...weekdays].sort((a, b) => a - b).join(',') : '*'}`
    case 'monthly': return `${minute} ${hour} ${dayOfMonth} * *`
    case 'custom': {
      const interval = Math.max(1, Math.floor(state.customInterval))
      if (state.customUnit === 'minute') return interval <= 59 ? `*/${interval} * * * *` : '* * * * *'
      if (state.customUnit === 'hourly') return interval <= 24 ? `${minute} */${interval} * * *` : `${minute} * * * *`
      if (state.customUnit === 'daily') return interval <= 31 ? `${minute} ${hour} */${interval} * *` : `${minute} ${hour} * * *`
      if (state.customUnit === 'weekly') return `${minute} ${hour} * * ${state.customWeekdays.length > 0 ? state.customWeekdays.join(',') : '1'}`
      if (state.customUnit === 'monthly') {
        if (state.customMonthlyMode === 'weekday') return `${minute} ${hour} * * ${state.customWeekdays[0] ?? 1}#1`
        return `${minute} ${hour} ${state.customMonthDays.length > 0 ? state.customMonthDays.join(',') : '1'} * *`
      }
      const yearMonth = Math.min(12, Math.max(1, Math.floor(state.customMonth)))
      return `${minute} ${hour} ${state.customMonthDays[0] ?? new Date(now).getDate()} ${yearMonth} *`
    }
    default: return rawExpr.trim()
  }
}
/**
 * cron → builder 状态（尽力反解析，不认识的落 custom）。`automationFormat.ts:138-244`。分支顺序是语义：
 * 先认三种「步长」（minute/hourly/daily，`:164-194`），再认固定时刻的 hourly/daily/weekdays/weekly
 * （`:197-217`），带月份的「M H DOM MON *」必须先于「M H DOM * *」判（否则每月被当每年，`:218-242`）。
 */
export function parseCronToBuilder(expr: string, now: number = Date.now()): CronBuilderState {
  const fallback: CronBuilderState = { // :139-152
    frequency: 'custom', hour: 9, minute: 0, weekdays: [1], dayOfMonth: 1, rawExpr: expr,
    customInterval: 1, customUnit: 'daily', customWeekdays: [1], customMonthDays: [1],
    customMonth: new Date(now).getMonth() + 1, customMonthlyMode: 'date',
  }
  const parts = expr.trim().split(/\s+/)
  if (parts.length !== 5) return fallback
  const [min, hr, dom, mon, dow] = parts as [string, string, string, string, string]
  const minNum = Number(min), hrNum = Number(hr)
  const isNum = (v: string): boolean => /^\d+$/.test(v)
  const minuteInterval = /^\*\/([1-9]\d*)$/.exec(min) // :164
  if (minuteInterval && hr === '*' && dom === '*' && mon === '*' && dow === '*') {
    return { ...fallback, customInterval: Number(minuteInterval[1]), customUnit: 'minute' }
  }
  const hourlyInterval = /^\*\/(\d+)$/.exec(hr) // :174
  if (isNum(min) && hourlyInterval && dom === '*' && mon === '*' && dow === '*') {
    return { ...fallback, minute: minNum, customInterval: Math.max(1, Number(hourlyInterval[1])), customUnit: 'hourly' }
  }
  const dailyInterval = /^\*\/(\d+)$/.exec(dom) // :184
  if (isNum(min) && isNum(hr) && dailyInterval && mon === '*' && dow === '*') {
    return { ...fallback, hour: hrNum, minute: minNum, customInterval: Math.max(1, Number(dailyInterval[1])), customUnit: 'daily' }
  }
  if (isNum(min) && hr === '*' && dom === '*' && mon === '*' && dow === '*') return { ...fallback, frequency: 'hourly', minute: minNum } // :197
  if (isNum(min) && isNum(hr) && dom === '*' && mon === '*' && dow === '*') return { ...fallback, frequency: 'daily', hour: hrNum, minute: minNum } // :201
  if (isNum(min) && isNum(hr) && dom === '*' && mon === '*' && dow === '1-5') return { ...fallback, frequency: 'weekdays', hour: hrNum, minute: minNum } // :205
  if (isNum(min) && isNum(hr) && dom === '*' && mon === '*' && dow !== '*') { // :209
    const days = dow.split(',').map(Number).filter(d => Number.isInteger(d) && d >= 0 && d <= 6)
    if (days.length > 0) return { ...fallback, frequency: 'weekly', hour: hrNum, minute: minNum, weekdays: days }
  }
  if (isNum(min) && isNum(hr) && isNum(dom) && isNum(mon) && dow === '*') { // :219
    const monthNum = Number(mon)
    if (monthNum >= 1 && monthNum <= 12) {
      return { ...fallback, hour: hrNum, minute: minNum, customUnit: 'yearly', customMonth: monthNum, customMonthDays: [Number(dom)] }
    }
  }
  if (isNum(min) && isNum(hr) && isNum(dom) && mon === '*' && dow === '*') return { ...fallback, frequency: 'monthly', hour: hrNum, minute: minNum, dayOfMonth: Number(dom) } // :234
  return fallback
}
/**
 * builder → 可读摘要。`automationFormat.ts:251-347`。custom 分支顺序有意义：minute 只显示「每 N 分钟」；
 * hourly **不复用**通用时间模板，否则 builder 为其它频率保留的默认 hour=9 会被误显成 09:00（`:283-285`）；
 * daily 是兜底（`:333-334`）。
 */
export function describeCronBuilder(state: CronBuilderState): string {
  const time = `${pad2(state.hour)}:${pad2(state.minute)}`
  switch (state.frequency) {
    case 'hourly': return t('automations.schedule.hourly', { minute: pad2(state.minute) })
    case 'daily': return t('automations.schedule.daily', { time })
    case 'weekdays': return t('automations.schedule.weekdays', { time })
    case 'weekly': {
      const days = [...state.weekdays]
        .sort((a, b) => WEEKDAY_ORDER.indexOf(a as never) - WEEKDAY_ORDER.indexOf(b as never)).map(weekdayLabel).join('、')
      return t('automations.schedule.weekly', { days, time })
    }
    case 'monthly': return t('automations.schedule.monthly', { day: String(state.dayOfMonth), time })
    case 'custom': {
      const interval = String(state.customInterval)
      if (state.customUnit === 'minute') return t('automations.schedule.customMinutes', { interval })
      if (state.customUnit === 'hourly') return t('automations.schedule.customHourly', { interval, time: pad2(state.minute) })
      if (state.customUnit === 'weekly') {
        const days = state.customWeekdays.map(weekdayLabel).join(t('automations.weekday.separator'))
        return t('automations.schedule.customWeekly', { interval, days, time })
      }
      if (state.customUnit === 'monthly') {
        if (state.customMonthlyMode === 'weekday') return t('automations.schedule.customMonthlyWeekday', { interval, day: weekdayLabel(state.customWeekdays[0] ?? 1), time })
        return t('automations.schedule.customMonthlyDates', { interval, days: state.customMonthDays.join(', '), time })
      }
      if (state.customUnit === 'yearly') {
        return t('automations.schedule.customYearly', { interval, month: String(state.customMonth), day: String(state.customMonthDays[0] ?? 1), time })
      }
      return t('automations.schedule.custom', { interval, unit: t('automations.customRepeat.unit.day'), time })
    }
    default: return state.rawExpr
  }
}
/**
 * cron → 可读摘要，识别不了回退「自定义」。`automationFormat.ts:350-376`。两条**不猜产品语义**：
 * 带月份的「M H DOM MON *」一律「自定义」（五段 cron 不带年份，分不出单次还是年度重复，`:360-364`）；
 * 「M H DOM 步长 *」一律「自定义」（编辑器无法稳定还原，`:365-367`）。反解析后 build 回去跟原串不一致
 * 说明是「未识别落到 09:00 默认值」的 custom，不能把默认值当真实调度（`:370-374`）。
 */
export function describeCron(expr: string): string {
  const normalizedExpr = expr.trim().replace(/\s+/g, ' ')
  const minuteInterval = /^\*\/([1-9]\d*) \* \* \* \*$/.exec(normalizedExpr) // :352
  if (minuteInterval) return t('automations.schedule.customMinutes', { interval: minuteInterval[1]! })
  if (/^\d+ \d+ \d+ \d+ \*$/.test(normalizedExpr)) return t('automations.frequency.custom') // :362
  if (/^\d+ \d+ \d+ \*\/\d+ \*$/.test(normalizedExpr)) return t('automations.frequency.custom') // :366
  const builder = parseCronToBuilder(normalizedExpr)
  if (builder.frequency === 'custom' && buildCronExpr(builder) !== normalizedExpr) return t('automations.frequency.custom') // :372
  return describeCronBuilder(builder)
}

/** builder 能否无损回显 cron（固定月日与未知表达式必须走「自定义」替换流程）。`automationFormat.ts:379-385`。 */
export function canVisualizeCronInAutomationEditor(expr: string): boolean {
  const normalizedExpr = expr.trim().replace(/\s+/g, ' ')
  if (/^\d+ \d+ \d+ \d+ \*$/.test(normalizedExpr)) return false
  if (/^\d+ \d+ \d+ \*\/\d+ \*$/.test(normalizedExpr)) return false
  return buildCronExpr(parseCronToBuilder(normalizedExpr)) === normalizedExpr
}

/** 权威 scheduleRule → builder 状态（卡片优先展示 rule，不反解析 cron）。`automationCardSchedule.ts:9-24`。 */
export function scheduleRuleToBuilder(rule: {
  hour: number; minute: number; interval: number; unit: CustomRepeatUnit
  weekdays?: number[]; monthDays?: number[]; months?: number[]; monthlyMode?: CustomMonthlyMode; anchorAt: number
}): CronBuilderState {
  return {
    frequency: 'custom', hour: rule.hour, minute: rule.minute, weekdays: rule.weekdays ?? [1],
    dayOfMonth: rule.monthDays?.[0] ?? 1, rawExpr: '', customInterval: rule.interval, customUnit: rule.unit,
    customWeekdays: rule.weekdays ?? [1], customMonthDays: rule.monthDays ?? [1],
    customMonth: rule.months?.[0] ?? new Date(rule.anchorAt).getMonth() + 1, customMonthlyMode: rule.monthlyMode ?? 'date',
  }
}

/**
 * 卡片上那句调度摘要。`automationCardSchedule.ts:27-47`。第一条**反直觉但必须照抄**：相对时间一次性任务
 * （「4 分钟后提醒」）被存成 minute scheduleRule 作兼容展示，直接描述会被误显为「每 4 分钟」的重复任务 ——
 * 它跑一次就结束、没有频率，故与固定日历一次性一致统一「自定义」，真实时机交给「下次运行」（`:37-41`）。
 * 其次：有 scheduleRule 用 rule（`:43-44`），否则才反解析 cron（`:46`）。
 */
export function describeAutomationCardSchedule(automation: {
  cronExpr: string; scheduleRule?: Parameters<typeof scheduleRuleToBuilder>[0]; recurring?: boolean; maxRuns?: number
}): string {
  if (automation.recurring === false && (automation.maxRuns ?? 1) <= 1) return t('automations.frequency.custom')
  if (automation.scheduleRule) return describeCronBuilder(scheduleRuleToBuilder(automation.scheduleRule))
  return describeCron(automation.cronExpr)
}
// ---- 时间格式化（`automationFormat.ts:387-458`）----
/** 毫秒时间戳 → 本地 `YYYY-MM-DD HH:MM`；0/undefined → "-"。`:398-402`。 */
export function formatDateTime(ts: number | undefined): string {
  if (!ts) return '-'
  const d = new Date(ts)
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())} ${pad2(d.getHours())}:${pad2(d.getMinutes())}`
}

/** 相对时间（「2 小时后」「3 天前」）。`:405-436`。1 分钟内用 soon/justNow，不显示 0 分钟。 */
export function formatRelativeToNow(ts: number | undefined, now: number): string {
  if (!ts) return '-'
  const diff = ts - now, abs = Math.abs(diff), future = diff >= 0
  const minute = 60_000, hour = 60 * minute, day = 24 * hour
  if (abs < minute) return t(future ? 'automations.time.soon' : 'automations.time.justNow')
  let value: number, unitId: string
  if (abs < hour) { value = Math.round(abs / minute); unitId = 'automations.time.minutes' }
  else if (abs < day) { value = Math.round(abs / hour); unitId = 'automations.time.hours' }
  else { value = Math.round(abs / day); unitId = 'automations.time.days' }
  const amount = t(unitId, { value: String(value) })
  return t(future ? 'automations.time.in' : 'automations.time.ago', { amount })
}

/** 卡片「下次运行」阈值：一个月内相对时间，更远用绝对时间（`:72, :439-448`）；过期（<= now）不展示。 */
export const AUTOMATION_CARD_RELATIVE_NEXT_RUN_THRESHOLD_MS = 30 * 24 * 60 * 60 * 1000
export function formatAutomationCardNextRun(ts: number | undefined, now: number): string | null {
  if (!ts || ts <= now) return null
  return ts - now <= AUTOMATION_CARD_RELATIVE_NEXT_RUN_THRESHOLD_MS ? formatRelativeToNow(ts, now) : formatDateTime(ts)
}

/** 运行时长 → 「1m 20s」/「3s」；缺任一端或逆序 → "-"。`:451-458`。 */
export function formatDuration(startTs: number | undefined, endTs: number | undefined): string {
  if (!startTs || !endTs || endTs < startTs) return '-'
  const totalSec = Math.round((endTs - startTs) / 1000), min = Math.floor(totalSec / 60), sec = totalSec % 60
  return min <= 0 ? `${sec}s` : `${min}m ${sec}s`
}
// ---- 校验（`automationEditValidation.ts` / `automationEditDirtyState.ts`）----
export type AutomationEditRequiredField = 'title' | 'schedule' | 'prompt' // automationEditValidation.ts:1

/**
 * 必填校验：标题 / 调度（cronExpr）/ 指令 三个空值各记一条。`automationEditValidation.ts:3-13`。
 * schedule 判的是 `cronExpr` 空，**不是**「cron 是否合法」—— 合法性由 service 侧 `isValidCronExpr` 负责
 * （`packages/services/src/session/automationCronValidation.ts:4`）。
 */
export function resolveAutomationEditRequiredFieldErrors(params: {
  title: string; cronExpr: string; prompt: string
}): AutomationEditRequiredField[] {
  const errors: AutomationEditRequiredField[] = []
  if (!params.title.trim()) errors.push('title')
  if (!params.cronExpr.trim()) errors.push('schedule')
  if (!params.prompt.trim()) errors.push('prompt')
  return errors
}

/** 撤销某字段已有的提交告警（正常编辑不主动产生新告警）；集合不变时返回原对象避免重渲染。`automationEditValidation.ts:16-24`。 */
export function clearAutomationEditRequiredFieldError(
  errors: ReadonlySet<AutomationEditRequiredField>, field: AutomationEditRequiredField,
): ReadonlySet<AutomationEditRequiredField> {
  if (!errors.has(field)) return errors
  const next = new Set(errors)
  next.delete(field)
  return next
}

export type AutomationEditDirtyField = 'title' | 'prompt' | 'schedule' | 'mode' | 'thoughtLevel' | 'model' // dirtyState:1-7
export type AutomationEditFieldSignatures = Record<AutomationEditDirtyField, string> // :9

/** 只比较**用户实际操作过**的字段，避免把表单初始化后的系统归一化误判为修改；baseline 缺该字段不算改动。`automationEditDirtyState.ts:12-21`。 */
export function resolveChangedAutomationEditFields(params: {
  touchedFields: ReadonlySet<AutomationEditDirtyField>
  current: AutomationEditFieldSignatures
  baseline: Partial<AutomationEditFieldSignatures>
}): AutomationEditDirtyField[] {
  return [...params.touchedFields].filter(
    field => params.baseline[field] !== undefined && params.current[field] !== params.baseline[field],
  )
}
// ---- 状态过滤（`automationStatusFilter.ts` + `automationFormat.ts:9-41`）----
export type AutomationStatusKind = 'active' | 'paused' | 'completed' | 'failed' // automationFormat.ts:9
export type AutomationStatusFilter = 'all' | 'inProgress' | 'completed' | 'failed' // statusFilter:9
export const DEFAULT_AUTOMATION_STATUS_FILTER: AutomationStatusFilter = 'all' // statusFilter:13
export const AUTOMATION_STATUS_FILTERS: readonly AutomationStatusFilter[] = ['all', 'inProgress', 'completed', 'failed'] // :15-20

/**
 * 是否展示失败徽章。`automationFormat.ts:25-31`：lifecycle=failed、派发失败、或有非空 lastError。
 * 注释里那句「循环任务本身仍保持 active 并继续调度」是这条存在的理由 —— **失败徽章与生命周期是两件事**。
 */
export function hasAutomationFailureState(automation: {
  lifecycleStatus: AutomationStatusKind
  dispatchStatus?: 'idle' | 'claimed' | 'dispatched' | 'failed_to_dispatch'
  dispatchAttempts?: number; retryAt?: number; lastError?: string
}): boolean {
  return automation.lifecycleStatus === 'failed' || automation.dispatchStatus === 'failed_to_dispatch'
    || Boolean(automation.lastError?.trim())
}

/** 生命周期展示状态：终态优先，其次 paused/未启用，最后 active。`automationFormat.ts:34-41`。 */
export function resolveAutomationStatusKind(automation: {
  lifecycleStatus: AutomationStatusKind; enabled: boolean
}): AutomationStatusKind {
  if (automation.lifecycleStatus === 'failed') return 'failed'
  if (automation.lifecycleStatus === 'completed') return 'completed'
  if (automation.lifecycleStatus === 'paused' || !automation.enabled) return 'paused'
  return 'active'
}

type StatusFilterKind = Exclude<AutomationStatusFilter, 'all'>
/** 闲时六态 → 三组。`automationStatusFilter.ts:22-35`：排队/暂停/运行都还会推进算进行中；取消与失败同为非正常结束并入失败。 */
export function resolveOffPeakStatusFilterKind(task: { status: OffPeakTaskStatus }): StatusFilterKind {
  switch (task.status) {
    case 'completed': return 'completed'
    case 'failed': case 'cancelled': return 'failed'
    default: return 'inProgress'
  }
}

/** 定时任务 → 三组：先看失败徽章，再看 lifecycle 终态，其余进行中。`automationStatusFilter.ts:40-46`。 */
export function resolveAutomationStatusFilterKind(
  automation: Parameters<typeof resolveAutomationStatusKind>[0] & Parameters<typeof hasAutomationFailureState>[0],
): StatusFilterKind {
  if (hasAutomationFailureState(automation)) return 'failed'
  return resolveAutomationStatusKind(automation) === 'completed' ? 'completed' : 'inProgress'
}

/** `all` 原样返回入参（不复制）。`automationStatusFilter.ts:48-54`。 */
export function filterOffPeakTasksByStatus<T extends { status: OffPeakTaskStatus }>(
  tasks: readonly T[], filter: AutomationStatusFilter,
): readonly T[] {
  if (filter === 'all') return tasks
  return tasks.filter(task => resolveOffPeakStatusFilterKind(task) === filter)
}

/** `all` 原样返回入参。`automationStatusFilter.ts:56-64`。 */
export function filterAutomationsByStatus<T extends Parameters<typeof resolveAutomationStatusFilterKind>[0]>(
  automations: readonly T[], filter: AutomationStatusFilter,
): readonly T[] {
  if (filter === 'all') return automations
  return automations.filter(automation => resolveAutomationStatusFilterKind(automation) === filter)
}

export interface AutomationTabState<Tab extends string> { tab: Tab; filter: AutomationStatusFilter } // :71-74

/** tab 与筛选同居一个状态：tab 未变保持原对象（避免无谓重渲染），tab 变了就重置筛选。`automationStatusFilter.ts:66-82`。 */
export function resolveAutomationTabState<Tab extends string>(
  previous: AutomationTabState<Tab>, nextTab: Tab,
): AutomationTabState<Tab> {
  return nextTab === previous.tab ? previous : { tab: nextTab, filter: DEFAULT_AUTOMATION_STATUS_FILTER }
}
// ---- 闲时任务（`off-peak-types.ts` / `offPeakUiPresentation.ts` / `OffPeakTaskList.tsx`）----
/** 客户端执行态六态。`packages/shared/src/off-peak-types.ts:14-20`。 */
export type OffPeakTaskStatus = 'queued' | 'paused' | 'running' | 'completed' | 'failed' | 'cancelled'
export const OFF_PEAK_STATUSES: readonly OffPeakTaskStatus[] = ['queued', 'paused', 'running', 'completed', 'failed', 'cancelled']
export const OFF_PEAK_TERMINAL_STATUSES = ['completed', 'failed', 'cancelled'] as const // :23

/** 终态集合：不可逆出（状态机不变量）。`off-peak-types.ts:25-29`。 */
export function isOffPeakTerminalStatus(status: OffPeakTaskStatus): status is 'completed' | 'failed' | 'cancelled' {
  return (OFF_PEAK_TERMINAL_STATUSES as readonly string[]).includes(status)
}

export interface AgentOffPeakTask { // off-peak-types.ts:102-165 的配置面/展示面子集
  offPeakTaskId: string; title: string; prompt: string; permissionMode: string
  workspaceKey: string; workspacePath: string; workspaceIdentity: string
  status: OffPeakTaskStatus; queuedAt: number; createdAt: number; updatedAt: number
  startedAt: number | null; endedAt: number | null; failureReason: string; historyDeletedAt: number | null
  queuePosition: number | null; sessionId: string; sessionTitle: string
  modelSelectionIssue: boolean // off-peak-types.ts:130-134
}

/** 按创建时间倒序。`OffPeakTaskList.tsx:63-67` —— 不按状态分组，否则任务切换状态时会跳位。 */
export function sortOffPeakTasksByCreatedAt<T extends { createdAt: number }>(tasks: readonly T[]): T[] {
  return [...tasks].sort((a, b) => b.createdAt - a.createdAt)
}
/** 设计规范最多露出 8 张卡片，超出由 grid 自身滚动。`OffPeakTaskList.tsx:69-70`。 */
export const OFFPEAK_LIST_SCROLL_THRESHOLD = 8

export type OffPeakStatusIconKind = 'moon' | 'pause' | 'spinner' | 'success' | 'warning' | 'stopped' // :59-65
export interface OffPeakStatusFooterPresentation {
  icon: OffPeakStatusIconKind
  className: string // ZCode 的 Tailwind 语义类（`offPeakUiPresentation.ts:100-157` 原值）；接线时映射到本仓 token
  labelId: string
  labelValues?: Record<string, string>
}

/**
 * 闲时卡片状态图标与文案的唯一映射。`offPeakUiPresentation.ts:99-157`。带位次的 queued/paused 用不同 label
 * （「排队第 N 位」/「#N 已暂停」），不能把带位次的 paused 误画成 queued 月亮；completed 用
 * foreground-subtle 而非 success 高亮（`:139-142`）。
 */
export function resolveOffPeakStatusFooter(
  task: Pick<AgentOffPeakTask, 'queuePosition' | 'status'>,
): OffPeakStatusFooterPresentation {
  const position = task.queuePosition
  switch (task.status) {
    case 'queued':
      return position ? { icon: 'moon', className: 'text-idle-task', labelId: 'offPeak.badge.queuePosition', labelValues: { position: String(position) } }
        : { icon: 'moon', className: 'text-idle-task', labelId: 'offPeak.status.queued' }
    case 'paused':
      return position ? { icon: 'pause', className: 'text-idle-task', labelId: 'offPeak.badge.pausedPosition', labelValues: { position: String(position) } }
        : { icon: 'pause', className: 'text-idle-task', labelId: 'offPeak.status.paused' }
    case 'running': return { icon: 'spinner', className: 'text-success', labelId: 'offPeak.status.running' }
    case 'completed': return { icon: 'success', className: 'text-foreground-subtle', labelId: 'offPeak.status.completed' }
    case 'failed': return { icon: 'warning', className: 'text-destructive', labelId: 'offPeak.status.failed' }
    case 'cancelled': return { icon: 'stopped', className: 'text-foreground-subtle', labelId: 'offPeak.status.cancelled' }
  }
}

/** 失败任务仍保留服务端排队位次时单独渲染弱化位次。`offPeakUiPresentation.ts:166-180`：主状态映射只能返回一个 footer，失败态需额外保留队列上下文。 */
export function resolveFailedOffPeakQueueFooter(
  task: Pick<AgentOffPeakTask, 'queuePosition' | 'status'>,
): OffPeakStatusFooterPresentation | null {
  if (task.status !== 'failed' || task.queuePosition === null) return null
  return { icon: 'moon', className: 'text-idle-task', labelId: 'offPeak.badge.queuePosition', labelValues: { position: String(task.queuePosition) } }
}

/** 终态任务不会再被调度，不能把历史选择失效显示成当前待修复错误。`offPeakUiPresentation.ts:159-164`。 */
export function shouldShowOffPeakModelSelectionIssue(status: OffPeakTaskStatus): boolean {
  return status === 'queued' || status === 'paused' || status === 'running'
}

/** History 行的状态档（六态收敛成四档显示）。`OffPeakHistoryTab.tsx:23-37`。 */
export function resolveOffPeakHistoryStatus(
  task: Pick<AgentOffPeakTask, 'status'>,
): 'succeeded' | 'failed' | 'skipped' | 'running' {
  if (task.status === 'completed') return 'succeeded'
  if (task.status === 'failed') return 'failed'
  if (task.status === 'cancelled') return 'skipped'
  return 'running'
}

/** 执行记录 = 首段派发起跑过（startedAt 存在）；删过 History 的也算无记录。`OffPeakHistoryTab.tsx:49-50`。 */
export function hasOffPeakHistory(task: Pick<AgentOffPeakTask, 'startedAt' | 'historyDeletedAt'>): boolean {
  return Boolean(task.startedAt) && task.historyDeletedAt === null
}

/** History 行时长（分钟，至少 1）。`OffPeakHistoryTab.tsx:57-59`。 */
export function offPeakHistoryDurationMinutes(
  task: Pick<AgentOffPeakTask, 'status' | 'startedAt' | 'endedAt'>, now: number,
): number | null {
  if (!task.startedAt) return null
  const endAt = isOffPeakTerminalStatus(task.status) ? (task.endedAt ?? now) : now
  return Math.max(1, Math.round((endAt - task.startedAt) / 60_000))
}

export type OffPeakCreateBlockReason = 'plan' | 'quota' | 'unavailable' // offPeakUiPresentation.ts:5
/** 闲时创建禁用原因属长提示，不能沿用通用短 Tooltip 单行布局。`offPeakUiPresentation.ts:7-9`。 */
export const OFF_PEAK_CREATE_TOOLTIP_CLASSNAME = 'max-w-[220px] [&>span]:break-words [&>span]:whitespace-normal [&>span]:text-wrap-pretty'

/** 只有服务端成功确认可取号才放行创建，其余资格与依赖状态全部 fail-closed；灰度关时不拦。`offPeakUiPresentation.ts:12-30`。 */
export function resolveOffPeakCreateBlockReason(params: {
  availabilityStatus: 'idle' | 'loading' | 'ready' | 'error'
  canTakeNumber: boolean | undefined; grayEnabled: boolean; noPlan: boolean
}): OffPeakCreateBlockReason | null {
  if (!params.grayEnabled) return null
  if (params.availabilityStatus === 'loading' || params.availabilityStatus === 'error') return 'unavailable'
  if (params.noPlan) return 'plan'
  if (params.availabilityStatus !== 'ready') return 'unavailable'
  return params.canTakeNumber === true ? null : 'quota'
}

/** 服务端绝对恢复点 → 本地化剩余时长；向上取整分钟，仍需等待几十秒时不能显示 0 分钟。`offPeakUiPresentation.ts:32-57`。 */
export function formatOffPeakRemainingWait(nextTakeAt: number, now: number): string {
  const remainingMs = nextTakeAt - now
  if (remainingMs <= 0) return t('offPeak.create.remaining.lessThanMinute')
  const totalMinutes = Math.ceil(remainingMs / 60_000), hours = Math.floor(totalMinutes / 60), minutes = totalMinutes % 60
  if (hours > 0 && minutes > 0) return t('offPeak.create.remaining.hoursMinutes', { hours: String(hours), minutes: String(minutes) })
  if (hours > 0) return t('offPeak.create.remaining.hours', { hours: String(hours) })
  return t('offPeak.create.remaining.minutes', { minutes: String(minutes) })
}

/** 只同步仍保持自动默认值的创建态标题；locale 切换后不能覆盖用户输入、模板草稿或已保存任务标题。`offPeakUiPresentation.ts:74-97`。 */
export function resolveLocalizedOffPeakCreateTitle(params: {
  currentTitle: string; hasInitialTitle: boolean; isEditing: boolean
  nextDefaultTitle: string; previousDefaultTitle: string; titleTouched: boolean
}): string {
  if (params.isEditing || params.hasInitialTitle || params.titleTouched || params.currentTitle !== params.previousDefaultTitle) return params.currentTitle
  return params.nextDefaultTitle
}

/** 闲时编辑页只读判据。`OffPeakEditView.tsx:291-292`：**queued/paused 全字段可编辑；running 起锁定、终态只读。** */
export function resolveOffPeakEditReadOnly(editing: { status: OffPeakTaskStatus } | null): boolean {
  return Boolean(editing && editing.status !== 'queued' && editing.status !== 'paused')
}

/** 闲时提交可否。`OffPeakEditView.tsx:295-303`：标题/指令非空、有项目、有模型、有有效推理档、不在保存中、未禁创建、非只读。 */
export function resolveOffPeakEditCanSubmit(params: {
  title: string; prompt: string; workspacePath: string; model: string
  effectiveThoughtLevel: string | undefined; saving: boolean; createBlocked: boolean; readOnly: boolean
}): boolean {
  return params.title.trim().length > 0 && params.prompt.trim().length > 0 && Boolean(params.workspacePath)
    && Boolean(params.model) && Boolean(params.effectiveThoughtLevel)
    && !params.saving && !params.createBlocked && !params.readOnly
}

/** 丢弃草稿守卫的 dirty 判据。`OffPeakEditView.tsx:266-272`：项目只在新建成态比较（编辑态项目锁定，不参与 dirty）。 */
export function resolveOffPeakEditDirty(params: {
  current: { title: string; prompt: string; mode: string; model: string; thoughtLevel: string | undefined; workspacePath: string }
  baseline: { title: string; prompt: string; mode: string; model: string; thoughtLevel: string | undefined; workspacePath: string }
  isEditing: boolean
}): boolean {
  const { current, baseline } = params
  return current.title !== baseline.title || current.prompt !== baseline.prompt || current.mode !== baseline.mode
    || current.model !== baseline.model || current.thoughtLevel !== baseline.thoughtLevel
    || (!params.isEditing && current.workspacePath !== baseline.workspacePath)
}

/** 提交时的模型选择：只有非空 reasoningLevel 才带 options。`OffPeakEditView.tsx:64-75`。 */
export function buildOffPeakSubmissionModelSelection(
  providerId: string, modelId: string, displayedReasoningLevel: string | undefined,
): { providerId: string; modelId: string; options?: { reasoningLevel: string } } {
  const reasoningLevel = displayedReasoningLevel?.trim()
  return { providerId, modelId, ...(reasoningLevel ? { options: { reasoningLevel } } : {}) }
}
// ---- 模板目录（`automationTemplateCatalog.ts`）----
export interface AutomationTemplateLocalizedText { cn?: string; en?: string } // :6-9
export interface ScheduledAutomationTemplate { // :19-22
  id: string; iconName?: string; title: AutomationTemplateLocalizedText
  description: AutomationTemplateLocalizedText; prompt: AutomationTemplateLocalizedText
  cronExpr: string; icon: 'target' | 'activity' | 'file' | 'list'
}
export interface OffPeakAutomationTemplate { // :24-28
  id: string; iconName?: string; title: AutomationTemplateLocalizedText
  description: AutomationTemplateLocalizedText; homepageDescription?: AutomationTemplateLocalizedText
  prompt: AutomationTemplateLocalizedText; customize: boolean
  icon: 'standupGitSummary' | 'ciFlakyReport' | 'documentationSyncCheck' | 'customize' | 'standupGitSummarySecondary' | 'followUpMonitor'
}
export interface AutomationTemplateCatalog { // :37-41
  scheduled: ScheduledAutomationTemplate[]; offPeak: OffPeakAutomationTemplate[]; rejectedScheduledTemplateIds: string[]
}
/** Customize 是本地保底入口，稳定文案由 locale 真源在渲染时解析。`automationTemplateCatalog.ts:32-51`。 */
export const CUSTOMIZE_TEMPLATE_MESSAGE_IDS = {
  title: 'offPeak.newTask.template.customize.title', description: 'offPeak.newTask.template.customize.description',
} as const
const CUSTOMIZE_TEMPLATE: OffPeakAutomationTemplate = { // :43-51
  id: 'customize', title: {}, description: {}, prompt: { cn: '', en: '' }, customize: true, icon: 'customize',
}

/** 去掉远端 id 的 `item-`/`item_` 前缀。`automationTemplateCatalog.ts:53-55`。 */
export function normalizeTemplateId(id: string): string { return id.replace(/^item[-_]?/i, '') }
/** 定时模板图标：按 id 关键词分派。`automationTemplateCatalog.ts:68-74`。 */
export function scheduledTemplateIcon(id: string): ScheduledAutomationTemplate['icon'] {
  const normalized = normalizeTemplateId(id).toLowerCase()
  if (normalized.includes('morning') || normalized.includes('standup')) return 'target'
  if (normalized.includes('risk') || normalized.includes('ci')) return 'activity'
  if (normalized.includes('release') || normalized.includes('file')) return 'file'
  return 'list'
}
/** 闲时模板图标：customize 固定，其余按 id 关键词分派。`automationTemplateCatalog.ts:76-87`。 */
export function offPeakTemplateIcon(id: string, customize: boolean): OffPeakAutomationTemplate['icon'] {
  if (customize) return 'customize'
  const normalized = normalizeTemplateId(id).toLowerCase()
  if (normalized.includes('standup') || normalized.includes('git')) return 'standupGitSummary'
  if (normalized.includes('ci') || normalized.includes('flaky')) return 'ciFlakyReport'
  if (normalized.includes('documentation') || normalized.includes('doc')) return 'documentationSyncCheck'
  return 'followUpMonitor'
}
const isCustomizeItem = (item: ClientSceneItem): boolean => normalizeTemplateId(item.id).toLowerCase() === 'customize' // :89-91
const hasLocalizedTitle = (item: ClientSceneItem): boolean => Boolean(item.labels.cn?.trim() || item.labels.en?.trim()) // :93-95

/**
 * 模板引用的 cron：必须所有 locale 同值、service 校验通过、且 builder 能无损编辑。`automationTemplateCatalog.ts:97-123`。
 * 两条拒绝理由原文：cron 不是自然语言，不同 locale 配不同表达式会让点击结果不可预测（`:114`）；
 * 只做 service 校验会让模板在用户尚未编辑时就被静默改写（`:116-117`）。
 */
function resolveReferencedCronExpr(
  scene: ClientSceneConfig, promptItem: ClientSceneItem, isValidCronExpr: (cronExpr: string) => boolean,
): string | null {
  const cronItemIds = promptItem.defaults?.cronExpr
  const cronItems = scene.options.cronExpr?.items
  if (!cronItemIds?.length || !cronItems) return null
  for (const cronItemId of cronItemIds) {
    const cronItem = cronItems.find(item => item.id === cronItemId)
    if (!cronItem) continue
    const localizedValues = [cronItem.contents.en, cronItem.contents.cn]
      .map(value => value?.trim()).filter((value): value is string => Boolean(value))
    const cronExpr = localizedValues[0]
    if (!cronExpr) continue
    if (localizedValues.some(value => value !== cronExpr)) return null
    if (isValidCronExpr(cronExpr) && canVisualizeCronInAutomationEditor(cronExpr)) return cronExpr
  }
  return null
}

function mapScheduledTemplates(
  scenes: readonly ClientSceneConfig[], isValidCronExpr: (cronExpr: string) => boolean,
): Pick<AutomationTemplateCatalog, 'scheduled' | 'rejectedScheduledTemplateIds'> {
  const scene = scenes.find(candidate => candidate.scene === 'scheduled-task') // :129
  if (!scene) return { scheduled: [], rejectedScheduledTemplateIds: [] }
  const scheduled: ScheduledAutomationTemplate[] = [], rejectedScheduledTemplateIds: string[] = []
  for (const item of scene.options.prompts?.items ?? []) {
    if (!hasLocalizedTitle(item)) { rejectedScheduledTemplateIds.push(item.id); continue }
    const cronExpr = resolveReferencedCronExpr(scene, item, isValidCronExpr)
    if (!cronExpr) { rejectedScheduledTemplateIds.push(item.id); continue }
    const iconName = item.img?.trim() || undefined
    scheduled.push({
      id: item.id, ...(iconName ? { iconName } : {}), title: item.labels, description: item.contents,
      prompt: item.contents, cronExpr, icon: scheduledTemplateIcon(item.id),
    })
  }
  return { scheduled, rejectedScheduledTemplateIds }
}

function mapOffPeakTemplates(scenes: readonly ClientSceneConfig[]): OffPeakAutomationTemplate[] {
  const scene = scenes.find(candidate => candidate.scene === 'off-peak-task') // :160
  return (scene?.options.prompts?.items ?? []).filter(hasLocalizedTitle).map((item): OffPeakAutomationTemplate => {
    const customize = isCustomizeItem(item)
    const iconName = item.img?.trim() || undefined
    return {
      id: item.id, ...(iconName ? { iconName } : {}),
      title: customize ? CUSTOMIZE_TEMPLATE.title : item.labels,
      description: customize ? CUSTOMIZE_TEMPLATE.description : item.contents,
      homepageDescription: customize ? CUSTOMIZE_TEMPLATE.description
        : { cn: item.descs?.cn?.trim() || item.contents.cn, en: item.descs?.en?.trim() || item.contents.en },
      prompt: item.contents, customize, icon: offPeakTemplateIcon(item.id, customize),
    }
  })
}

/** 远端 `ClientSceneConfig[]` → 模板目录。`automationTemplateCatalog.ts:180-188`。 */
export function mapClientScenesToAutomationTemplates(
  scenes: readonly ClientSceneConfig[], isValidCronExpr: (cronExpr: string) => boolean = isComputableCron,
): AutomationTemplateCatalog {
  return { ...mapScheduledTemplates(scenes, isValidCronExpr), offPeak: mapOffPeakTemplates(scenes) }
}

/** 按 locale 选主语言，主语言空则回退另一语言。`automationTemplateCatalog.ts:190-198`。 */
export function resolveAutomationTemplateText(text: AutomationTemplateLocalizedText, locale?: string): string {
  const isChinese = locale?.startsWith('zh') ?? false
  const primary = isChinese ? text.cn : text.en, fallback = isChinese ? text.en : text.cn
  return primary?.trim() || fallback?.trim() || ''
}

/** 闲时模板文案：customize 走 locale 真源，其余走模板自身；`homepageDescription` 缺省回退 `description`。`automationTemplateCatalog.ts:200-215`。 */
export function resolveOffPeakTemplateText(
  template: OffPeakAutomationTemplate, field: 'title' | 'description' | 'homepageDescription',
  locale: string, formatMessage: (descriptor: { id: string }) => string,
): string {
  if (template.customize) {
    const messageField = field === 'homepageDescription' ? 'description' : field
    return formatMessage({ id: CUSTOMIZE_TEMPLATE_MESSAGE_IDS[messageField] })
  }
  return resolveAutomationTemplateText(field === 'homepageDescription' ? (template.homepageDescription ?? template.description) : template[field], locale)
}

/** 定时模板 → 创建表单草稿。`automationTemplateCatalog.ts:217-227`。 */
export function materializeScheduledTemplateDraft(
  template: ScheduledAutomationTemplate, locale: string,
): { templateId: string; title: string; cronExpr: string; prompt: string } {
  return {
    templateId: template.id, title: resolveAutomationTemplateText(template.title, locale),
    cronExpr: template.cronExpr, prompt: resolveAutomationTemplateText(template.prompt, locale),
  }
}

/** 闲时模板 → 创建表单草稿。`automationTemplateCatalog.ts:229-238`。 */
export function materializeOffPeakTemplateDraft(
  template: OffPeakAutomationTemplate, locale: string,
): { templateId: string; title: string; prompt: string } {
  return {
    templateId: template.id, title: resolveAutomationTemplateText(template.title, locale),
    prompt: resolveAutomationTemplateText(template.prompt, locale),
  }
}

/** 远端 ClientScene 的结构面（`packages/services/src/client-scenes/clientScenes.ts:10-55`）。 */
export interface ClientSceneItem {
  id: string; type?: string; contents: Record<string, string>; descs?: Record<string, string>
  labels: Record<string, string>; img?: string | null; defaults?: Record<string, string[]>
}
export interface ClientSceneConfig {
  namespace?: string; scene: string
  options: Record<string, { id?: string; type?: string; items?: ClientSceneItem[] }>
}
// ---- 项目候选（`automationWorkspaceOptions.ts`）----
export interface AutomationWorkspaceOption { // :4-11
  workspacePath: string; workspaceIdentity?: string; remoteSessionId?: string
  remoteTarget?: unknown; label: string; workspacePurpose?: string
}
/** key = `workspaceIdentity?.trim() || workspacePath`（`task-realtime-core.ts:78-83`）。`:13-17`。 */
export function resolveAutomationWorkspaceSelectionKey(
  workspace: Pick<AutomationWorkspaceOption, 'workspacePath' | 'workspaceIdentity'>,
): string {
  return workspace.workspaceIdentity?.trim() || workspace.workspacePath
}
/** `automationWorkspaceOptions.ts:19-24`。 */
export function findAutomationWorkspaceOptionByKey(
  options: readonly AutomationWorkspaceOption[], workspaceKey: string | null,
): AutomationWorkspaceOption | undefined {
  return options.find(option => resolveAutomationWorkspaceSelectionKey(option) === workspaceKey)
}
/** 候选变化时保留仍有效的选择，否则依次回落到有效默认项目、首个有效项目或 null。`automationWorkspaceOptions.ts:26-46`。 */
export function reconcileAutomationWorkspaceSelectionKey(
  options: readonly AutomationWorkspaceOption[], currentWorkspaceKey: string | null,
  preferredWorkspace?: Pick<AutomationWorkspaceOption, 'workspacePath' | 'workspaceIdentity'>,
): string | null {
  const current = findAutomationWorkspaceOptionByKey(options, currentWorkspaceKey)
  if (current) return resolveAutomationWorkspaceSelectionKey(current)
  const preferredKey = preferredWorkspace ? resolveAutomationWorkspaceSelectionKey(preferredWorkspace) : null
  const preferred = findAutomationWorkspaceOptionByKey(options, preferredKey)
  if (preferred) return resolveAutomationWorkspaceSelectionKey(preferred)
  const first = options[0]
  return first ? resolveAutomationWorkspaceSelectionKey(first) : null
}
/** 路径末段当标签（同时兼容反斜杠）。`automationWorkspaceOptions.ts:48-50`。 */
export function workspaceLabelFromPath(path: string): string {
  return path.replace(/\\/g, '/').split('/').filter(Boolean).pop() ?? path
}
/** 构建纯项目候选。`automationWorkspaceOptions.ts:52-83`：排除非 workspace tab、conversation 用途与只读（目录不可用）tab，按 key 去重。 */
export function buildAutomationWorkspaceOptions(tabs: readonly {
  kind?: string; workspacePath: string; workspaceIdentity?: string; workspacePurpose?: string
  availability?: string; remoteSessionId?: string; remoteTarget?: unknown; label?: string
}[]): AutomationWorkspaceOption[] {
  const byKey = new Map<string, AutomationWorkspaceOption>()
  for (const tab of tabs) {
    if (tab.kind !== 'workspace' || tab.workspacePurpose === 'conversation' || tab.availability === 'unavailable-local-directory') continue
    const key = resolveAutomationWorkspaceSelectionKey(tab)
    if (byKey.has(key)) continue
    byKey.set(key, {
      workspacePath: tab.workspacePath,
      ...(tab.workspaceIdentity ? { workspaceIdentity: tab.workspaceIdentity } : {}),
      ...(tab.remoteSessionId ? { remoteSessionId: tab.remoteSessionId } : {}),
      ...(tab.remoteTarget ? { remoteTarget: tab.remoteTarget } : {}),
      label: tab.label || workspaceLabelFromPath(tab.workspacePath),
    })
  }
  return [...byKey.values()]
}
// ---- 运行配置候选（`automationAgentConfigOptions.ts`）----
/** 权限模式默认值：Ask before changes。`automationAgentConfigOptions.ts:14-15`。 */
export const AUTOMATION_DEFAULT_MODE = 'build'
/** 权限四档。`automationAgentConfigOptions.ts:25`。 */
export const AUTOMATION_MODE_VALUES = ['build', 'edit', 'plan', 'yolo'] as const

/** 权限 option（供会话侧共用选择器渲染）。`automationAgentConfigOptions.ts:39-48`。 */
export function buildAutomationModeOption(currentValue: string): {
  id: string; name: string; category: string; type: string; currentValue: string; options: { value: string; name: string }[]
} {
  return {
    id: 'mode', name: 'Mode', category: 'mode', type: 'select', currentValue,
    options: AUTOMATION_MODE_VALUES.map(value => ({ value, name: value })),
  }
}

/** 推理档位 option。`automationAgentConfigOptions.ts:127-145`：候选刷新不是用户选择，失效档位清空而非改成默认/最高档并保存（`:134-135`）。 */
export function buildAutomationThoughtLevelOption(
  runtimeOption: { name?: string; options?: { value: string; name: string }[] } | undefined, currentValue: string,
): { id: string; name: string; category: string; type: string; currentValue: string; options: { value: string; name: string }[] } | null {
  const options = runtimeOption?.options ?? []
  if (options.length === 0) return null
  return {
    id: 'thought_level', name: runtimeOption?.name ?? 'Effort', category: 'thought_level', type: 'select',
    currentValue: options.some(option => option.value === currentValue) ? currentValue : '',
    options: options.map(option => ({ ...option })),
  }
}
// ---- 节级规则（`AutomationsSection.tsx`）----
/** 主视图标签页：Scheduled 常驻，Idle-time 受灰度控制；不设 All 混排视图。`:237-238`。 */
export type AutomationsTab = 'scheduled' | 'idle'
/** 有任务才出 tab；闲时不可见时只有 scheduled。`:240-252`。 */
export function resolveVisibleAutomationTabs(params: { hasAnyTasks: boolean; offPeakVisible: boolean }): readonly AutomationsTab[] {
  if (!params.hasAnyTasks) return []
  return params.offPeakVisible ? ['scheduled', 'idle'] : ['scheduled']
}
/**
 * 模板可见性。`AutomationsSection.tsx:277-296`：无任务时两类模板并列展示；有任务后由 Scheduled / Idle tab 分流。
 * （移除 All tab 后空首页仍默认落在 Scheduled，否则闲时模板会被误隐藏，`:289-290`。）
 */
export function resolveAutomationTemplateVisibility(params: {
  hasAnyTasks: boolean; offPeakCreationEnabled: boolean; tab: AutomationsTab
}): { showOffPeakTemplates: boolean; showScheduledTemplates: boolean } {
  const showAllTemplates = !params.hasAnyTasks
  return {
    showOffPeakTemplates: params.offPeakCreationEnabled && (showAllTemplates || params.tab === 'idle'),
    showScheduledTemplates: showAllTemplates || params.tab === 'scheduled',
  }
}
/** 卡片正文摘要：空白折叠；全空时给一个空格，保证卡片高度不塌。`:309-312`。 */
export function automationPromptSummary(prompt: string): string {
  const normalized = prompt.replace(/\s+/g, ' ').trim()
  return normalized.length > 0 ? normalized : ' '
}
/** 只有 failed 是可恢复终态，允许 Restart。`:314-316`。 */
export function canRestartAutomation(automation: { lifecycleStatus: AutomationStatusKind }): boolean {
  return automation.lifecycleStatus === 'failed'
}
/** 终态任务不展示 pause/resume。`:318-320`。 */
export function canToggleAutomation(automation: { lifecycleStatus: AutomationStatusKind }): boolean {
  return automation.lifecycleStatus !== 'completed' && automation.lifecycleStatus !== 'failed'
}
/** 立即运行结果的 toast id。`:322-328`。 */
export function getAutomationRunNowToastId(
  result: 'queued' | 'duplicate' | 'failed',
): 'automations.runNowQueued' | 'automations.runNowAlreadyRunning' | 'automations.runNowFailed' {
  if (result === 'queued') return 'automations.runNowQueued'
  if (result === 'duplicate') return 'automations.runNowAlreadyRunning'
  return 'automations.runNowFailed'
}
/** 动作失败 toast id（原始错误留 logger，界面只展示可理解提示）。`:330-335`。 */
export function getAutomationActionErrorToastId(action: 'create' | 'update' | 'toggle' | 'restart' | 'delete'): string {
  return `automations.error.${action}`
}
/** 生命周期徽章文案 id。`:1775`。 */
export function automationLifecycleLabelId(status: AutomationStatusKind): string { return `automations.lifecycle.${status}` }
// ---- 存储（窄接口 + 坏档永不抛；机制复用 `src/agentSettingsStore.ts`）----
/** 闲时任务本机存档键。ZCode 落 `tasks-index.sqlite`（`off-peak-types.ts:5`），本仓无该库。 */
export const AGENT_OFFPEAK_TASKS_STORAGE_KEY = 'taocode.agent.offpeakTasks'
export interface AgentAutomationRulesSettings { offPeakTasks: AgentOffPeakTask[] }
/** 出厂默认：无闲时任务。 */
export function defaultAgentAutomationRules(): AgentAutomationRulesSettings { return { offPeakTasks: [] } }

const isOneOf = <T extends string>(value: unknown, list: readonly T[]): value is T =>
  typeof value === 'string' && (list as readonly string[]).includes(value)
const str = (value: unknown, fallback = ''): string => (typeof value === 'string' ? value : fallback)
const num = (value: unknown, fallback = 0): number => (typeof value === 'number' && Number.isFinite(value) ? value : fallback)
const optTs = (value: unknown): number | null =>
  (typeof value === 'number' && Number.isFinite(value) && value > 0 ? Math.round(value) : null)

/** 归一一条闲时任务：逐字段救，救不了的退默认；id 空则丢弃整条。 */
function normalizeOffPeakTask(value: unknown): AgentOffPeakTask | null {
  if (!value || typeof value !== 'object') return null
  const raw = value as Record<string, unknown>
  const offPeakTaskId = str(raw.offPeakTaskId).trim()
  if (!offPeakTaskId) return null
  const workspacePath = str(raw.workspacePath), workspaceIdentity = str(raw.workspaceIdentity)
  return {
    offPeakTaskId, title: str(raw.title), prompt: str(raw.prompt),
    permissionMode: str(raw.permissionMode, AUTOMATION_DEFAULT_MODE),
    workspaceKey: str(raw.workspaceKey) || workspaceIdentity.trim() || workspacePath,
    workspacePath, workspaceIdentity,
    status: isOneOf(raw.status, OFF_PEAK_STATUSES) ? raw.status : 'queued',
    queuedAt: num(raw.queuedAt), createdAt: num(raw.createdAt), updatedAt: num(raw.updatedAt),
    startedAt: optTs(raw.startedAt), endedAt: optTs(raw.endedAt), failureReason: str(raw.failureReason),
    historyDeletedAt: optTs(raw.historyDeletedAt),
    queuePosition: typeof raw.queuePosition === 'number' && Number.isFinite(raw.queuePosition) ? Math.max(1, Math.round(raw.queuePosition)) : null,
    sessionId: str(raw.sessionId), sessionTitle: str(raw.sessionTitle), modelSelectionIssue: Boolean(raw.modelSelectionIssue),
  }
}

/** 坏档/旧形状逐字段救，**永不抛**（铁律：不许把用户锁在设置外）。 */
export function normalizeAgentAutomationRules(input: unknown): AgentAutomationRulesSettings {
  if (!input || typeof input !== 'object') return defaultAgentAutomationRules()
  const raw = input as Record<string, unknown>
  const offPeakTasks: AgentOffPeakTask[] = []
  for (const item of Array.isArray(raw.offPeakTasks) ? raw.offPeakTasks : []) {
    const task = normalizeOffPeakTask(item)
    if (task) offPeakTasks.push(task)
  }
  return { offPeakTasks }
}

/** 从存储读（缺省走 `localStorage`；读不到/坏档退回默认）。 */
export function loadAgentAutomationRules(storage: SettingsStorage | null = defaultSettingsStorage()): AgentAutomationRulesSettings {
  return readSettingsJson(storage, AGENT_OFFPEAK_TASKS_STORAGE_KEY, normalizeAgentAutomationRules)
}
/** 写存储。存不下（配额满/隐私模式）静默降级，返回是否真的落盘。 */
export function saveAgentAutomationRules(
  settings: AgentAutomationRulesSettings, storage: SettingsStorage | null = defaultSettingsStorage(),
): boolean {
  return writeSettingsJson(storage, AGENT_OFFPEAK_TASKS_STORAGE_KEY, settings)
}
