// `agent/automation-rules` 判据：ZCode「自动化」节的规则层 —— 调度摘要、必填校验、状态分组、
// 模板目录、闲时六态与编辑规则、存储往返与坏档救。
//
// 出处速查（ZCode，只读参照 `.tools/ZCode`；路径前缀省略）：
//   · cron builder/摘要/时间  packages/ui/src/settings/automationFormat.ts
//   · 卡片摘要取舍            packages/ui/src/settings/automationCardSchedule.ts
//   · 必填三字段              packages/ui/src/settings/automationEditValidation.ts:3-13
//   · 脏字段                   packages/ui/src/settings/automationEditDirtyState.ts:12-21
//   · 筛选档位与分组          packages/ui/src/settings/automationStatusFilter.ts
//   · 模板目录                packages/ui/src/settings/automationTemplateCatalog.ts
//   · 闲时六态/展示           packages/shared/src/off-peak-types.ts、packages/ui/src/settings/offPeakUiPresentation.ts
//   · 闲时编辑规则            packages/ui/src/settings/OffPeakEditView.tsx、OffPeakHistoryTab.tsx、OffPeakTaskList.tsx
//   · 项目候选                packages/ui/src/settings/automationWorkspaceOptions.ts
//   · 运行配置                packages/ui/src/settings/automationAgentConfigOptions.ts
//   · 节级规则                packages/ui/src/settings/AutomationsSection.tsx
//   · 文案                    packages/ui/src/i18n/locales/zh-CN.ts
import test from 'node:test'
import assert from 'node:assert/strict'
import {
  AUTOMATION_CARD_RELATIVE_NEXT_RUN_THRESHOLD_MS, AUTOMATION_DEFAULT_MODE, AUTOMATION_MODE_VALUES,
  AUTOMATION_STATUS_FILTERS, DEFAULT_AUTOMATION_STATUS_FILTER, OFFPEAK_LIST_SCROLL_THRESHOLD,
  OFF_PEAK_CREATE_TOOLTIP_CLASSNAME, OFF_PEAK_STATUSES, OFF_PEAK_TERMINAL_STATUSES, WEEKDAY_ORDER,
  automationLifecycleLabelId, automationPromptSummary, buildAutomationModeOption,
  buildAutomationThoughtLevelOption, buildAutomationWorkspaceOptions, buildCronExpr,
  buildOffPeakSubmissionModelSelection, canRestartAutomation, canToggleAutomation,
  canVisualizeCronInAutomationEditor, clearAutomationEditRequiredFieldError,
  defaultAgentAutomationRules, describeAutomationCardSchedule, describeCron, describeCronBuilder,
  filterAutomationsByStatus, filterOffPeakTasksByStatus, findAutomationWorkspaceOptionByKey,
  formatAutomationCardNextRun, formatDateTime, formatDuration, formatOffPeakRemainingWait,
  formatRelativeToNow, getAutomationActionErrorToastId, getAutomationRunNowToastId,
  hasAutomationFailureState, hasOffPeakHistory, isOffPeakTerminalStatus, loadAgentAutomationRules,
  mapClientScenesToAutomationTemplates, materializeOffPeakTemplateDraft, materializeScheduledTemplateDraft,
  normalizeAgentAutomationRules, normalizeTemplateId, offPeakHistoryDurationMinutes,
  offPeakTemplateIcon, parseCronToBuilder, reconcileAutomationWorkspaceSelectionKey,
  resolveAutomationEditRequiredFieldErrors, resolveAutomationStatusFilterKind,
  resolveAutomationStatusKind, resolveAutomationTabState, resolveAutomationTemplateText,
  resolveAutomationTemplateVisibility, resolveChangedAutomationEditFields,
  resolveFailedOffPeakQueueFooter, resolveLocalizedOffPeakCreateTitle,
  resolveOffPeakCreateBlockReason, resolveOffPeakEditCanSubmit, resolveOffPeakEditDirty,
  resolveOffPeakEditReadOnly, resolveOffPeakHistoryStatus, resolveOffPeakStatusFilterKind,
  resolveOffPeakStatusFooter, resolveOffPeakTemplateText, resolveVisibleAutomationTabs,
  saveAgentAutomationRules, scheduleRuleToBuilder, scheduledTemplateIcon, shouldShowOffPeakModelSelectionIssue,
  sortOffPeakTasksByCreatedAt, t, workspaceLabelFromPath,
} from '../src/agentAutomationRules.ts'
import { AGENT_OFFPEAK_TASKS_STORAGE_KEY } from '../src/agentAutomationRules.ts'
import { createMemoryStorage, createThrowingStorage } from '../src/agentSettingsStore.ts'

const builder = (over = {}) => ({
  frequency: 'daily', hour: 9, minute: 0, weekdays: [1], dayOfMonth: 1, rawExpr: '',
  customInterval: 1, customUnit: 'daily', customWeekdays: [1], customMonthDays: [1],
  customMonth: 1, customMonthlyMode: 'date', ...over,
})

const offPeak = (over = {}) => ({
  offPeakTaskId: 'offpeak-1', title: '夜间重构', prompt: '整理本周改动', permissionMode: 'build',
  workspaceKey: 'D:/proj', workspacePath: 'D:/proj', workspaceIdentity: '',
  status: 'queued', queuedAt: 1, createdAt: 1, updatedAt: 1, startedAt: null, endedAt: null,
  failureReason: '', historyDeletedAt: null, queuePosition: null, sessionId: '', sessionTitle: '',
  modelSelectionIssue: false, ...over,
})

// ---------------------------------------------------------------- 文案
test('文案逐字取 zh-CN（zh-CN.ts:6085-6312）', () => {
  assert.equal(t('automations.statusFilter.all'), '全部', 'zh-CN:6085')
  assert.equal(t('automations.statusFilter.inProgress'), '进行中', 'zh-CN:6086')
  assert.equal(t('automations.statusFilter.completed'), '已完成', 'zh-CN:6087')
  assert.equal(t('automations.statusFilter.failed'), '失败', 'zh-CN:6088')
  assert.equal(t('automations.lifecycle.active'), '运行中', 'zh-CN:6189')
  assert.equal(t('automations.lifecycle.failed'), '已失败', 'zh-CN:6192')
  assert.equal(t('offPeak.status.queued'), '等待闲时算力', 'zh-CN:6099')
  assert.equal(t('offPeak.status.cancelled'), '已取消', 'zh-CN:6104')
  assert.equal(t('automations.frequency.custom'), '自定义', 'zh-CN:6211')
  assert.equal(t('automations.weekday.separator'), '、', 'zh-CN:6219')
  assert.equal(t('automations.schedule.monthly', { day: '1', time: '09:00' }), '每月 1 号 09:00', 'zh-CN:6224')
  assert.equal(t('automations.time.in', { amount: '2 小时' }), '2 小时后', 'zh-CN:6240')
  assert.equal(t('automations.time.ago', { amount: '3 天' }), '3 天前', 'zh-CN:6241')
  assert.equal(t('offPeak.badge.pausedPosition', { position: '2' }), '#2 已暂停', 'zh-CN:6095')
  // 未知 id 原样返回（不编造文案）
  assert.equal(t('automations.nope'), 'automations.nope')
})

// ---------------------------------------------------------------- 调度
test('buildCronExpr 六种频率与降级（automationFormat.ts:81-135）', () => {
  assert.equal(buildCronExpr(builder({ frequency: 'hourly', minute: 5 })), '5 * * * *', ':85-87')
  assert.equal(buildCronExpr(builder()), '0 9 * * *', ':88')
  assert.equal(buildCronExpr(builder({ frequency: 'weekdays' })), '0 9 * * 1-5', ':90')
  assert.equal(buildCronExpr(builder({ frequency: 'weekly', weekdays: [3, 1] })), '0 9 * * 1,3', ':92 排序')
  assert.equal(buildCronExpr(builder({ frequency: 'weekly', weekdays: [] })), '0 9 * * *', ':92 空则 *')
  assert.equal(buildCronExpr(builder({ frequency: 'monthly', dayOfMonth: 15 })), '0 9 15 * *', ':96')
  // 三处故意降级：步长超 cron 表达能力时只留合法候选
  assert.equal(buildCronExpr(builder({ frequency: 'custom', customUnit: 'minute', customInterval: 30 })), '*/30 * * * *', ':102')
  assert.equal(buildCronExpr(builder({ frequency: 'custom', customUnit: 'minute', customInterval: 61 })), '* * * * *', ':102 上限 59')
  assert.equal(buildCronExpr(builder({ frequency: 'custom', customUnit: 'hourly', customInterval: 31, minute: 7 })), '7 * * * *', ':107 上限 24')
  assert.equal(buildCronExpr(builder({ frequency: 'custom', customUnit: 'daily', customInterval: 32 })), '0 9 * * *', ':112 上限 31')
  assert.equal(buildCronExpr(builder({ frequency: 'custom', customUnit: 'monthly', customMonthDays: [1, 15] })), '0 9 1,15 * *', ':124')
  assert.equal(buildCronExpr(builder({ frequency: 'custom', customUnit: 'monthly', customMonthlyMode: 'weekday', customWeekdays: [5] })), '0 9 * * 5#1', ':122')
  assert.equal(buildCronExpr(builder({ frequency: 'custom', customUnit: 'yearly', customMonth: 3, customMonthDays: [8] })), '0 9 8 3 *', ':128-130')
  assert.equal(buildCronExpr(builder({ frequency: 'custom', customUnit: 'yearly', customMonth: 99, customMonthDays: [8] })), '0 9 8 12 *', ':128 clamp 1-12')
})

test('parseCronToBuilder 分支顺序（automationFormat.ts:138-244）', () => {
  assert.equal(parseCronToBuilder('*/30 * * * *').customUnit, 'minute', ':164')
  assert.equal(parseCronToBuilder('5 */2 * * *').customUnit, 'hourly', ':174')
  assert.equal(parseCronToBuilder('5 9 */3 * *').customUnit, 'daily', ':184')
  assert.equal(parseCronToBuilder('5 * * * *').frequency, 'hourly', ':197')
  assert.equal(parseCronToBuilder('5 9 * * *').frequency, 'daily', ':201')
  assert.equal(parseCronToBuilder('5 9 * * 1-5').frequency, 'weekdays', ':205')
  assert.deepEqual(parseCronToBuilder('5 9 * * 1,3').weekdays, [1, 3], ':209')
  // 带月份的先于每月判（否则每月被当每年）
  assert.equal(parseCronToBuilder('5 9 8 3 *').customUnit, 'yearly', ':219')
  assert.equal(parseCronToBuilder('5 9 8 * *').frequency, 'monthly', ':234')
  assert.equal(parseCronToBuilder('nonsense').frequency, 'custom', ':243 兜底')
  assert.equal(parseCronToBuilder('1 2 3 4 5 6').frequency, 'custom', ':154 非五段')
})

test('describeCronBuilder / describeCron 与回退（automationFormat.ts:251-376）', () => {
  assert.equal(describeCronBuilder(builder({ frequency: 'hourly', minute: 5 })), '每小时的第 05 分', ':255')
  assert.equal(describeCronBuilder(builder()), '每天 09:00', ':260')
  assert.equal(describeCronBuilder(builder({ frequency: 'weekdays' })), '每工作日 09:00', ':262')
  // weekly 按 WEEKDAY_ORDER（周一在前、周日在末）排序
  assert.equal(describeCronBuilder(builder({ frequency: 'weekly', weekdays: [0, 1] })), '每周一、日 09:00', ':263-268')
  assert.equal(describeCronBuilder(builder({ frequency: 'monthly', dayOfMonth: 15 })), '每月 15 号 09:00', ':271')
  assert.equal(describeCronBuilder(builder({ frequency: 'custom', customUnit: 'minute', customInterval: 4 })), '每 4 分钟', ':277')
  // hourly 不复用通用时间模板（否则默认 hour=9 会被误显成 09:00）
  assert.equal(describeCronBuilder(builder({ frequency: 'custom', customUnit: 'hourly', customInterval: 2, minute: 7 })), '每 2 小时的第 07 分', ':285-291')
  assert.equal(describeCronBuilder(builder({ frequency: 'custom', customUnit: 'weekly', customInterval: 2, customWeekdays: [1, 3], hour: 18, minute: 30 })), '每 2 周的周一、三，18:30', ':297')
  assert.equal(describeCronBuilder(builder({ frequency: 'custom', customUnit: 'monthly', customInterval: 1, customMonthDays: [1, 15] })), '每 1 个月的 1, 15 日，09:00', ':313')
  assert.equal(describeCronBuilder(builder({ frequency: 'custom', customUnit: 'monthly', customMonthlyMode: 'weekday', customInterval: 1, customWeekdays: [5] })), '每 1 个月的第一个周五，09:00', ':304')
  assert.equal(describeCronBuilder(builder({ frequency: 'custom', customUnit: 'yearly', customInterval: 1, customMonth: 3, customMonthDays: [8] })), '每 1 年的 3 月 8 日，09:00', ':323')
  // 未识别的 custom 落 daily 兜底
  assert.equal(describeCronBuilder(builder({ frequency: 'custom', customUnit: 'daily', customInterval: 3 })), '每 3 天，09:00', ':334-342')

  assert.equal(describeCron('*/4 * * * *'), '每 4 分钟', ':352-358')
  // 固定月日 / 步长月日一律「自定义」：五段 cron 不带年份，猜不出单次还是年度重复
  assert.equal(describeCron('0 9 15 6 *'), '自定义', ':362')
  assert.equal(describeCron('0 9 15 */2 *'), '自定义', ':366')
  assert.equal(describeCron('0 9 * * 1-5'), '每工作日 09:00', ':375')
  assert.equal(describeCron('5 4 * * *'), '每天 04:05', ':375')
  // 无法识别的表达式 → 自定义（不把 09:00 默认值当真实调度）
  assert.equal(describeCron('0 9 1,15 * 3'), '自定义', ':372')
})

test('canVisualizeCronInAutomationEditor（automationFormat.ts:379-385）', () => {
  assert.equal(canVisualizeCronInAutomationEditor('0 9 * * *'), true)
  assert.equal(canVisualizeCronInAutomationEditor('0 9 * * 1-5'), true)
  assert.equal(canVisualizeCronInAutomationEditor('0 9 15 6 *'), false, ':381 固定月日不可视化')
  assert.equal(canVisualizeCronInAutomationEditor('0 9 15 */2 *'), false, ':382 步长月日不可视化')
  assert.equal(canVisualizeCronInAutomationEditor('0 9 1,15 * 3'), false, ':384 build 回去不一致')
})

test('一次性任务与 scheduleRule 优先（automationCardSchedule.ts:27-47）', () => {
  // 相对时间一次性任务被存成 minute rule，不能误显为「每 4 分钟」
  assert.equal(describeAutomationCardSchedule({ cronExpr: '*/4 * * * *', recurring: false, maxRuns: 1 }), '自定义', ':39-41')
  assert.equal(describeAutomationCardSchedule({ cronExpr: '*/4 * * * *', recurring: false, maxRuns: 5 }), '每 4 分钟', ':39 只 maxRuns<=1')
  // 有 scheduleRule 用 rule，不反解析 cron（rule 走 custom 分支，故带「每 N 天」）
  const rule = { unit: 'daily', interval: 1, hour: 8, minute: 30, anchorAt: Date.UTC(2026, 0, 1), weekdays: [1], monthDays: [1] }
  assert.equal(describeAutomationCardSchedule({ cronExpr: '0 9 * * *', scheduleRule: rule }), '每 1 天，08:30', ':43-44 custom 分支')
  assert.equal(describeAutomationCardSchedule({ cronExpr: '0 9 * * *' }), '每天 09:00', ':46')
})

test('scheduleRuleToBuilder（automationCardSchedule.ts:9-24）', () => {
  const state = scheduleRuleToBuilder({ hour: 8, minute: 5, interval: 2, unit: 'weekly', weekdays: [3], monthDays: [], anchorAt: Date.UTC(2026, 5, 1) })
  assert.equal(state.frequency, 'custom', ':11')
  assert.equal(state.customUnit, 'weekly')
  assert.equal(state.customInterval, 2)
  assert.deepEqual(state.customWeekdays, [3])
  assert.equal(state.customMonthlyMode, 'date', ':22 缺省')
  // yearly 缺 months 时回退 anchorAt 的月份
  const yearly = scheduleRuleToBuilder({ hour: 0, minute: 0, interval: 1, unit: 'yearly', anchorAt: Date.UTC(2026, 5, 1) })
  assert.equal(yearly.customMonth, 6, ':21 new Date(anchorAt).getMonth()+1')
})

// ---------------------------------------------------------------- 时间
test('时间格式化（automationFormat.ts:387-458）', () => {
  assert.equal(formatDateTime(undefined), '-', ':399')
  const ts = new Date(2026, 9, 7, 9, 5).getTime()
  assert.equal(formatDateTime(ts), '2026-10-07 09:05', ':401')
  assert.equal(formatRelativeToNow(undefined, 0), '-', ':406')
  assert.equal(formatRelativeToNow(30_000, 0), '1 分钟内', ':417 soon')
  assert.equal(formatRelativeToNow(-30_000, 0), '刚刚', ':417 justNow')
  assert.equal(formatRelativeToNow(2 * 3_600_000, 0), '2 小时后', ':422-432')
  assert.equal(formatRelativeToNow(-3 * 86_400_000, 0), '3 天前', ':427-432')
  assert.equal(AUTOMATION_CARD_RELATIVE_NEXT_RUN_THRESHOLD_MS, 30 * 24 * 60 * 60 * 1000, ':72')
  assert.equal(formatAutomationCardNextRun(0, 100), null, ':444 无值')
  assert.equal(formatAutomationCardNextRun(50, 100), null, ':444 过期不展示')
  assert.equal(formatAutomationCardNextRun(100 + 60_000, 100), '1 分钟后', ':445-447 一个月内相对')
  const far = new Date(2027, 0, 1, 0, 0).getTime()
  assert.equal(formatAutomationCardNextRun(far, new Date(2026, 0, 1).getTime()), formatDateTime(far), ':445-447 更远用绝对')
  assert.equal(formatDuration(undefined, 1000), '-', ':452')
  assert.equal(formatDuration(2000, 1000), '-', ':452 逆序')
  assert.equal(formatDuration(0, 3000), '-', ':452 0 视为无')
  assert.equal(formatDuration(1000, 4000), '3s', ':456')
  assert.equal(formatDuration(1000, 81_000), '1m 20s', ':457')
})

// ---------------------------------------------------------------- 校验
test('必填三字段（automationEditValidation.ts:3-13）', () => {
  assert.deepEqual(resolveAutomationEditRequiredFieldErrors({ title: '', cronExpr: '', prompt: '' }), ['title', 'schedule', 'prompt'], ':9-11 顺序')
  assert.deepEqual(resolveAutomationEditRequiredFieldErrors({ title: ' a ', cronExpr: '0 9 * * *', prompt: '\t' }), ['prompt'], ':10 只判空')
  // 调度判的是 cronExpr 空，不是「cron 是否合法」
  assert.deepEqual(resolveAutomationEditRequiredFieldErrors({ title: 'a', cronExpr: 'garbage', prompt: 'b' }), [], ':10 非法但非空')
})

test('撤销字段告警：集合不变返回原对象（automationEditValidation.ts:16-24）', () => {
  const errors = new Set(['title', 'prompt'])
  assert.equal(clearAutomationEditRequiredFieldError(errors, 'schedule'), errors, ':20 未含则原对象')
  const next = clearAutomationEditRequiredFieldError(errors, 'title')
  assert.notEqual(next, errors, ':22 新集合')
  assert.deepEqual([...next], ['prompt'], ':23 只删该字段')
})

test('脏字段只比用户碰过的（automationEditDirtyState.ts:12-21）', () => {
  const current = { title: 'b', prompt: 'p', schedule: 's', mode: 'build', thoughtLevel: 'high', model: 'm' }
  const baseline = { title: 'a', prompt: 'p', schedule: 's', mode: 'build', thoughtLevel: 'high', model: 'm' }
  assert.deepEqual(resolveChangedAutomationEditFields({ touchedFields: new Set(['title']), current, baseline }), ['title'], ':17-20')
  // 未碰过的字段即使值不同也不算改动
  assert.deepEqual(resolveChangedAutomationEditFields({ touchedFields: new Set(), current, baseline }), [], ':17')
  // baseline 缺该字段不算改动
  assert.deepEqual(resolveChangedAutomationEditFields({ touchedFields: new Set(['model']), current, baseline: {} }), [], ':19')
})

// ---------------------------------------------------------------- 状态
test('失败徽章与生命周期是两件事（automationFormat.ts:25-41）', () => {
  assert.equal(hasAutomationFailureState({ lifecycleStatus: 'active' }), false, ':25-31')
  assert.equal(hasAutomationFailureState({ lifecycleStatus: 'failed' }), true, ':27')
  assert.equal(hasAutomationFailureState({ lifecycleStatus: 'active', dispatchStatus: 'failed_to_dispatch' }), true, ':28')
  assert.equal(hasAutomationFailureState({ lifecycleStatus: 'active', lastError: '  boom ' }), true, ':29 非空即失败')
  assert.equal(hasAutomationFailureState({ lifecycleStatus: 'active', lastError: '   ' }), false, ':29 空白不算')

  assert.equal(resolveAutomationStatusKind({ lifecycleStatus: 'failed', enabled: true }), 'failed', ':37 终态优先')
  assert.equal(resolveAutomationStatusKind({ lifecycleStatus: 'completed', enabled: true }), 'completed', ':38')
  assert.equal(resolveAutomationStatusKind({ lifecycleStatus: 'active', enabled: false }), 'paused', ':39 未启用算 paused')
  assert.equal(resolveAutomationStatusKind({ lifecycleStatus: 'paused', enabled: true }), 'paused', ':39')
  assert.equal(resolveAutomationStatusKind({ lifecycleStatus: 'active', enabled: true }), 'active', ':40')
})

test('筛选档位与分组口径（automationStatusFilter.ts）', () => {
  assert.deepEqual([...AUTOMATION_STATUS_FILTERS], ['all', 'inProgress', 'completed', 'failed'], ':15-20')
  assert.equal(DEFAULT_AUTOMATION_STATUS_FILTER, 'all', ':13')

  // 定时：先看失败徽章，再看 lifecycle 终态，其余进行中
  assert.equal(resolveAutomationStatusFilterKind({ lifecycleStatus: 'active', enabled: true }), 'inProgress', ':45')
  assert.equal(resolveAutomationStatusFilterKind({ lifecycleStatus: 'completed', enabled: true }), 'completed', ':45')
  assert.equal(resolveAutomationStatusFilterKind({ lifecycleStatus: 'active', enabled: true, lastError: 'x' }), 'failed', ':44 失败徽章优先')
  assert.equal(resolveAutomationStatusFilterKind({ lifecycleStatus: 'paused', enabled: false }), 'inProgress', ':45 paused 仍在进行中')

  // 闲时六态 → 三组：取消并入失败
  assert.equal(resolveOffPeakStatusFilterKind({ status: 'queued' }), 'inProgress', ':32')
  assert.equal(resolveOffPeakStatusFilterKind({ status: 'paused' }), 'inProgress', ':32')
  assert.equal(resolveOffPeakStatusFilterKind({ status: 'running' }), 'inProgress', ':32')
  assert.equal(resolveOffPeakStatusFilterKind({ status: 'completed' }), 'completed', ':28')
  assert.equal(resolveOffPeakStatusFilterKind({ status: 'failed' }), 'failed', ':30')
  assert.equal(resolveOffPeakStatusFilterKind({ status: 'cancelled' }), 'failed', ':31')

  const automations = [
    { lifecycleStatus: 'active', enabled: true },
    { lifecycleStatus: 'completed', enabled: true },
    { lifecycleStatus: 'active', enabled: true, lastError: 'x' },
  ]
  assert.equal(filterAutomationsByStatus(automations, 'all'), automations, ':60 all 原样返回')
  assert.equal(filterAutomationsByStatus(automations, 'failed').length, 1, ':61')
  assert.equal(filterAutomationsByStatus(automations, 'inProgress').length, 1, ':61')
  assert.equal(filterAutomationsByStatus(automations, 'completed').length, 1, ':61')

  const tasks = [{ status: 'queued' }, { status: 'cancelled' }, { status: 'completed' }]
  assert.equal(filterOffPeakTasksByStatus(tasks, 'all'), tasks, ':52 all 原样返回')
  assert.deepEqual(filterOffPeakTasksByStatus(tasks, 'failed').map(x => x.status), ['cancelled'], ':53')
})

test('tab 与筛选同居一个状态（automationStatusFilter.ts:66-82）', () => {
  const previous = { tab: 'scheduled', filter: 'failed' }
  assert.equal(resolveAutomationTabState(previous, 'scheduled'), previous, ':80 tab 未变返回原对象')
  assert.deepEqual(resolveAutomationTabState(previous, 'idle'), { tab: 'idle', filter: 'all' }, ':81 tab 变了重置筛选')
})

// ---------------------------------------------------------------- 闲时任务
test('闲时六态与终态集合（off-peak-types.ts:14-29）', () => {
  assert.deepEqual([...OFF_PEAK_STATUSES], ['queued', 'paused', 'running', 'completed', 'failed', 'cancelled'], ':14-20')
  assert.deepEqual([...OFF_PEAK_TERMINAL_STATUSES], ['completed', 'failed', 'cancelled'], ':23')
  assert.equal(isOffPeakTerminalStatus('completed'), true, ':27')
  assert.equal(isOffPeakTerminalStatus('cancelled'), true, ':27')
  assert.equal(isOffPeakTerminalStatus('running'), false, ':27')
})

test('列表按创建时间倒序、不按状态分组（OffPeakTaskList.tsx:63-70）', () => {
  const sorted = sortOffPeakTasksByCreatedAt([{ createdAt: 1 }, { createdAt: 3 }, { createdAt: 2 }])
  assert.deepEqual(sorted.map(x => x.createdAt), [3, 2, 1], ':66 b.createdAt - a.createdAt')
  assert.equal(OFFPEAK_LIST_SCROLL_THRESHOLD, 8, ':70 最多露 8 张')
})

test('闲时卡片状态 footer（offPeakUiPresentation.ts:99-180）', () => {
  assert.deepEqual(resolveOffPeakStatusFooter(offPeak({ status: 'queued' })), { icon: 'moon', className: 'text-idle-task', labelId: 'offPeak.status.queued' }, ':112-116')
  // 带位次用不同 label，不把 paused 误画成 queued 月亮
  assert.deepEqual(resolveOffPeakStatusFooter(offPeak({ status: 'queued', queuePosition: 2 })), { icon: 'moon', className: 'text-idle-task', labelId: 'offPeak.badge.queuePosition', labelValues: { position: '2' } }, ':105-110')
  assert.deepEqual(resolveOffPeakStatusFooter(offPeak({ status: 'paused', queuePosition: 3 })), { icon: 'pause', className: 'text-idle-task', labelId: 'offPeak.badge.pausedPosition', labelValues: { position: '3' } }, ':118-125')
  assert.deepEqual(resolveOffPeakStatusFooter(offPeak({ status: 'running' })), { icon: 'spinner', className: 'text-success', labelId: 'offPeak.status.running' }, ':132-135')
  // completed 用 foreground-subtle，不用 success 高亮
  assert.deepEqual(resolveOffPeakStatusFooter(offPeak({ status: 'completed' })), { icon: 'success', className: 'text-foreground-subtle', labelId: 'offPeak.status.completed' }, ':139-142')
  assert.deepEqual(resolveOffPeakStatusFooter(offPeak({ status: 'failed' })), { icon: 'warning', className: 'text-destructive', labelId: 'offPeak.status.failed' }, ':145-148')
  assert.deepEqual(resolveOffPeakStatusFooter(offPeak({ status: 'cancelled' })), { icon: 'stopped', className: 'text-foreground-subtle', labelId: 'offPeak.status.cancelled' }, ':151-154')

  // 失败态额外保留队列上下文
  assert.equal(resolveFailedOffPeakQueueFooter(offPeak({ status: 'failed', queuePosition: null })), null, ':173')
  assert.deepEqual(resolveFailedOffPeakQueueFooter(offPeak({ status: 'failed', queuePosition: 4 })), { icon: 'moon', className: 'text-idle-task', labelId: 'offPeak.badge.queuePosition', labelValues: { position: '4' } }, ':174-179')
  assert.equal(resolveFailedOffPeakQueueFooter(offPeak({ status: 'running', queuePosition: 4 })), null, ':173 仅 failed')

  // 终态不显示「模型待修复」
  assert.equal(shouldShowOffPeakModelSelectionIssue('queued'), true, ':163')
  assert.equal(shouldShowOffPeakModelSelectionIssue('running'), true, ':163')
  assert.equal(shouldShowOffPeakModelSelectionIssue('completed'), false, ':163')
})

test('History 行状态与时长（OffPeakHistoryTab.tsx:23-59）', () => {
  assert.equal(resolveOffPeakHistoryStatus(offPeak({ status: 'completed' })), 'succeeded', ':33')
  assert.equal(resolveOffPeakHistoryStatus(offPeak({ status: 'failed' })), 'failed', ':34')
  assert.equal(resolveOffPeakHistoryStatus(offPeak({ status: 'cancelled' })), 'skipped', ':35')
  assert.equal(resolveOffPeakHistoryStatus(offPeak({ status: 'queued' })), 'running', ':36')

  // 无 startedAt 或已删 History → 无记录
  assert.equal(hasOffPeakHistory(offPeak({ startedAt: null })), false, ':50')
  assert.equal(hasOffPeakHistory(offPeak({ startedAt: 1, historyDeletedAt: 2 })), false, ':50')
  assert.equal(hasOffPeakHistory(offPeak({ startedAt: 1 })), true, ':50')

  assert.equal(offPeakHistoryDurationMinutes(offPeak({ startedAt: null }), 100), null, ':50 无 startedAt')
  assert.equal(offPeakHistoryDurationMinutes(offPeak({ startedAt: 0 }), 100), null, ':50 0 视为无')
  // 终态用 endedAt；非终态用 now
  assert.equal(offPeakHistoryDurationMinutes(offPeak({ status: 'completed', startedAt: 1_000, endedAt: 121_000 }), 999), 2, ':58')
  assert.equal(offPeakHistoryDurationMinutes(offPeak({ status: 'running', startedAt: 1_000 }), 121_000), 2, ':58 用 now')
  // 至少 1 分钟
  assert.equal(offPeakHistoryDurationMinutes(offPeak({ status: 'completed', startedAt: 1_000, endedAt: 1_001 }), 0), 1, ':59 Math.max(1, …)')
})

test('闲时创建准入 fail-closed（offPeakUiPresentation.ts:12-30）', () => {
  assert.equal(resolveOffPeakCreateBlockReason({ availabilityStatus: 'ready', canTakeNumber: true, grayEnabled: true, noPlan: false }), null, ':29')
  assert.equal(resolveOffPeakCreateBlockReason({ availabilityStatus: 'ready', canTakeNumber: true, grayEnabled: false, noPlan: true }), null, ':23 灰度关不拦')
  assert.equal(resolveOffPeakCreateBlockReason({ availabilityStatus: 'loading', canTakeNumber: true, grayEnabled: true, noPlan: false }), 'unavailable', ':25')
  assert.equal(resolveOffPeakCreateBlockReason({ availabilityStatus: 'error', canTakeNumber: true, grayEnabled: true, noPlan: false }), 'unavailable', ':25')
  assert.equal(resolveOffPeakCreateBlockReason({ availabilityStatus: 'idle', canTakeNumber: true, grayEnabled: true, noPlan: false }), 'unavailable', ':28 未 ready')
  assert.equal(resolveOffPeakCreateBlockReason({ availabilityStatus: 'ready', canTakeNumber: true, grayEnabled: true, noPlan: true }), 'plan', ':27')
  assert.equal(resolveOffPeakCreateBlockReason({ availabilityStatus: 'ready', canTakeNumber: false, grayEnabled: true, noPlan: false }), 'quota', ':29')
  assert.equal(resolveOffPeakCreateBlockReason({ availabilityStatus: 'ready', canTakeNumber: undefined, grayEnabled: true, noPlan: false }), 'quota', ':29 非 true 即 quota')
})

test('闲时剩余等待向上取整（offPeakUiPresentation.ts:32-57）', () => {
  assert.equal(formatOffPeakRemainingWait(0, 100), '不到 1 分钟', ':40 已过期')
  assert.equal(formatOffPeakRemainingWait(100 + 30_000, 100), '1 分钟', ':47 向上取整')
  assert.equal(formatOffPeakRemainingWait(100 + 3_600_000, 100), '1 小时', ':54')
  assert.equal(formatOffPeakRemainingWait(100 + 3_600_000 + 120_000, 100), '1 小时 2 分钟', ':51')
})

test('闲时创建标题只在未触碰时跟随 locale（offPeakUiPresentation.ts:74-97）', () => {
  const base = { currentTitle: '未命名', hasInitialTitle: false, isEditing: false, nextDefaultTitle: 'Untitled', previousDefaultTitle: '未命名', titleTouched: false }
  assert.equal(resolveLocalizedOffPeakCreateTitle(base), 'Untitled', ':96')
  assert.equal(resolveLocalizedOffPeakCreateTitle({ ...base, titleTouched: true }), '未命名', ':93')
  assert.equal(resolveLocalizedOffPeakCreateTitle({ ...base, isEditing: true }), '未命名', ':93')
  assert.equal(resolveLocalizedOffPeakCreateTitle({ ...base, hasInitialTitle: true }), '未命名', ':93')
  assert.equal(resolveLocalizedOffPeakCreateTitle({ ...base, currentTitle: '自定义' }), '自定义', ':93 用户已改')
})

test('闲时编辑只读/可提交/脏（OffPeakEditView.tsx:266-303）', () => {
  assert.equal(resolveOffPeakEditReadOnly(null), false, ':292 新建可编辑')
  assert.equal(resolveOffPeakEditReadOnly({ status: 'queued' }), false, ':292')
  assert.equal(resolveOffPeakEditReadOnly({ status: 'paused' }), false, ':292')
  assert.equal(resolveOffPeakEditReadOnly({ status: 'running' }), true, ':292 running 起锁定')
  assert.equal(resolveOffPeakEditReadOnly({ status: 'completed' }), true, ':292 终态只读')

  const can = { title: 'a', prompt: 'b', workspacePath: 'D:/p', model: 'm', effectiveThoughtLevel: 'high', saving: false, createBlocked: false, readOnly: false }
  assert.equal(resolveOffPeakEditCanSubmit(can), true, ':295-303')
  assert.equal(resolveOffPeakEditCanSubmit({ ...can, title: '  ' }), false, ':296')
  assert.equal(resolveOffPeakEditCanSubmit({ ...can, prompt: '' }), false, ':297')
  assert.equal(resolveOffPeakEditCanSubmit({ ...can, workspacePath: '' }), false, ':298')
  assert.equal(resolveOffPeakEditCanSubmit({ ...can, model: '' }), false, ':299')
  assert.equal(resolveOffPeakEditCanSubmit({ ...can, effectiveThoughtLevel: undefined }), false, ':300')
  assert.equal(resolveOffPeakEditCanSubmit({ ...can, saving: true }), false, ':301')
  assert.equal(resolveOffPeakEditCanSubmit({ ...can, createBlocked: true }), false, ':302')
  assert.equal(resolveOffPeakEditCanSubmit({ ...can, readOnly: true }), false, ':303')

  const current = { title: 'a', prompt: 'b', mode: 'build', model: 'm', thoughtLevel: 'high', workspacePath: 'D:/p' }
  assert.equal(resolveOffPeakEditDirty({ current, baseline: current, isEditing: false }), false, ':266-272')
  assert.equal(resolveOffPeakEditDirty({ current: { ...current, title: 'x' }, baseline: current, isEditing: false }), true, ':267')
  // 项目只在新建成态比较
  assert.equal(resolveOffPeakEditDirty({ current: { ...current, workspacePath: 'D:/q' }, baseline: current, isEditing: true }), false, ':272 编辑态忽略项目')
  assert.equal(resolveOffPeakEditDirty({ current: { ...current, workspacePath: 'D:/q' }, baseline: current, isEditing: false }), true, ':272 新建态比较项目')
  assert.equal(resolveOffPeakEditDirty({ current: { ...current, thoughtLevel: undefined }, baseline: current, isEditing: false }), true, ':271')
})

test('闲时提交模型选择只带非空 reasoning（OffPeakEditView.tsx:64-75）', () => {
  assert.deepEqual(buildOffPeakSubmissionModelSelection('p', 'm', undefined), { providerId: 'p', modelId: 'm' }, ':73')
  assert.deepEqual(buildOffPeakSubmissionModelSelection('p', 'm', '  '), { providerId: 'p', modelId: 'm' }, ':69 trim')
  assert.deepEqual(buildOffPeakSubmissionModelSelection('p', 'm', 'high'), { providerId: 'p', modelId: 'm', options: { reasoningLevel: 'high' } }, ':72')
})

// ---------------------------------------------------------------- 模板目录
test('模板图标分派（automationTemplateCatalog.ts:53-95）', () => {
  assert.equal(normalizeTemplateId('item-morning-report'), 'morning-report', ':54 去 item- 前缀')
  assert.equal(normalizeTemplateId('item_ci_watch'), 'ci_watch', ':54 去 item_ 前缀')
  assert.equal(scheduledTemplateIcon('item-morning-standup'), 'target', ':70')
  assert.equal(scheduledTemplateIcon('risk-scan'), 'activity', ':71')
  assert.equal(scheduledTemplateIcon('release-notes'), 'file', ':72')
  assert.equal(scheduledTemplateIcon('anything'), 'list', ':73')
  assert.equal(offPeakTemplateIcon('x', true), 'customize', ':77')
  assert.equal(offPeakTemplateIcon('git-summary'), 'standupGitSummary', ':80')
  assert.equal(offPeakTemplateIcon('flaky-tests'), 'ciFlakyReport', ':82')
  assert.equal(offPeakTemplateIcon('documentation-sync'), 'documentationSyncCheck', ':84')
  assert.equal(offPeakTemplateIcon('follow-up'), 'followUpMonitor', ':86')
})

test('远端场景 → 模板目录（automationTemplateCatalog.ts:125-188）', () => {
  const scenes = [
    {
      scene: 'scheduled-task',
      options: {
        cronExpr: { items: [{ id: 'c1', contents: { cn: '0 9 * * 1-5', en: '0 9 * * 1-5' } }] },
        prompts: {
          items: [
            { id: 'item-standup', contents: { cn: '站会摘要', en: 'Standup' }, labels: { cn: '站会', en: 'Standup' }, defaults: { cronExpr: ['c1'] } },
            { id: 'item-noTitle', contents: { cn: 'x', en: 'x' }, labels: {} }, // 无标题 → 拒绝
            { id: 'item-badCron', contents: { cn: 'y', en: 'y' }, labels: { cn: '有标题', en: 'Has' }, defaults: { cronExpr: ['missing'] } }, // cron 缺 → 拒绝
          ],
        },
      },
    },
    {
      scene: 'off-peak-task',
      options: {
        prompts: {
          items: [
            { id: 'customize', contents: { cn: '自定义', en: 'Custom' }, labels: { cn: '自定义', en: 'Custom' } },
            { id: 'git-summary', contents: { cn: '总结提交', en: 'Summarize' }, labels: { cn: '提交总结', en: 'Git' }, descs: { cn: '说明', en: 'Desc' } },
          ],
        },
      },
    },
  ]
  const catalog = mapClientScenesToAutomationTemplates(scenes, () => true)
  assert.equal(catalog.scheduled.length, 1, ':146-154')
  assert.equal(catalog.scheduled[0].cronExpr, '0 9 * * 1-5', ':118')
  assert.equal(catalog.scheduled[0].icon, 'target', ':153')
  assert.deepEqual(catalog.rejectedScheduledTemplateIds, ['item-noTitle', 'item-badCron'], ':137,:142 拒绝清单')
  assert.equal(catalog.offPeak.length, 2, ':162')
  assert.equal(catalog.offPeak[0].customize, true, ':90')
  assert.equal(catalog.offPeak[0].icon, 'customize', ':77')
  assert.deepEqual(catalog.offPeak[1].homepageDescription, { cn: '说明', en: 'Desc' }, ':64-66')
})

test('模板 cron 必须 locale 同值且可无损编辑（automationTemplateCatalog.ts:97-123）', () => {
  const scene = (cn, en) => [{
    scene: 'scheduled-task',
    options: {
      cronExpr: { items: [{ id: 'c1', contents: { cn, en } }] },
      prompts: { items: [{ id: 'p1', contents: { cn: 't', en: 't' }, labels: { cn: '标题', en: 'Title' }, defaults: { cronExpr: ['c1'] } }] },
    },
  }]
  // locale 同值 + 可编辑 → 接受
  assert.equal(mapClientScenesToAutomationTemplates(scene('0 9 * * *', '0 9 * * *'), () => true).scheduled.length, 1, ':118')
  // locale 不同值 → 拒绝
  assert.equal(mapClientScenesToAutomationTemplates(scene('0 9 * * *', '5 9 * * *'), () => true).scheduled.length, 0, ':115')
  // service 校验不过 → 拒绝
  assert.equal(mapClientScenesToAutomationTemplates(scene('0 9 * * *', '0 9 * * *'), () => false).scheduled.length, 0, ':118')
  // 无法无损编辑（固定月日）→ 拒绝
  assert.equal(mapClientScenesToAutomationTemplates(scene('0 9 15 6 *', '0 9 15 6 *'), () => true).scheduled.length, 0, ':118')
  // 无 scheduled-task 场景 → 空目录
  assert.deepEqual(mapClientScenesToAutomationTemplates([], () => true), { scheduled: [], offPeak: [], rejectedScheduledTemplateIds: [] }, ':131')
})

test('模板文案与草稿（automationTemplateCatalog.ts:190-238）', () => {
  assert.equal(resolveAutomationTemplateText({ cn: '中', en: 'En' }, 'zh-CN'), '中', ':194-197')
  assert.equal(resolveAutomationTemplateText({ cn: '中', en: 'En' }, 'en-US'), 'En', ':194-197')
  assert.equal(resolveAutomationTemplateText({ cn: '  ', en: 'En' }, 'zh-CN'), 'En', ':197 主语言空回退')
  assert.equal(resolveAutomationTemplateText({}, 'zh-CN'), '', ':197 全空')

  const scheduled = { id: 'item-standup', title: { cn: '站会', en: 'Standup' }, description: { cn: 'd', en: 'd' }, prompt: { cn: '提示', en: 'Prompt' }, cronExpr: '0 9 * * 1-5', icon: 'target' }
  assert.deepEqual(materializeScheduledTemplateDraft(scheduled, 'zh-CN'), { templateId: 'item-standup', title: '站会', cronExpr: '0 9 * * 1-5', prompt: '提示' }, ':221-226')

  const custom = { id: 'customize', title: {}, description: {}, prompt: { cn: '', en: '' }, customize: true, icon: 'customize' }
  const zhMessages = { 'offPeak.newTask.template.customize.title': '自定义', 'offPeak.newTask.template.customize.description': '跳过模板，直接告诉它你想做什么。' }
  assert.equal(resolveOffPeakTemplateText(custom, 'title', 'zh-CN', ({ id }) => zhMessages[id]), '自定义', ':208')
  assert.equal(resolveOffPeakTemplateText(custom, 'homepageDescription', 'zh-CN', ({ id }) => zhMessages[id]), '跳过模板，直接告诉它你想做什么。', ':207 homepage 走 description')
  assert.deepEqual(materializeOffPeakTemplateDraft({ id: 'git', title: { cn: '提交总结' }, description: {}, prompt: { cn: '总结' }, customize: false, icon: 'standupGitSummary' }, 'zh-CN'), { templateId: 'git', title: '提交总结', prompt: '总结' }, ':232-236')
})

// ---------------------------------------------------------------- 项目候选
test('项目候选（automationWorkspaceOptions.ts）', () => {
  assert.equal(workspaceLabelFromPath('D:/a/b/proj'), 'proj', ':49')
  assert.equal(workspaceLabelFromPath('D:\\a\\b\\proj'), 'proj', ':49 反斜杠')
  const tabs = [
    { kind: 'workspace', workspacePath: 'D:/a' },
    { kind: 'workspace', workspacePath: 'D:/a' }, // 重复 key → 去重
    { kind: 'workspace', workspacePath: 'D:/conv', workspacePurpose: 'conversation' }, // 排除
    { kind: 'workspace', workspacePath: 'D:/gone', availability: 'unavailable-local-directory' }, // 排除只读
    { kind: 'settings', workspacePath: 'D:/s' }, // 非 workspace 排除
    { kind: 'workspace', workspacePath: 'D:/b', workspaceIdentity: 'ssh://host/b', label: '远端' },
  ]
  const options = buildAutomationWorkspaceOptions(tabs)
  assert.deepEqual(options.map(o => o.workspacePath), ['D:/a', 'D:/b'], ':62-81')
  assert.equal(options[0].label, 'a', ':79 无 label 用路径末段')
  assert.equal(options[1].label, '远端', ':79')

  // key = workspaceIdentity?.trim() || workspacePath
  assert.equal(findAutomationWorkspaceOptionByKey(options, 'ssh://host/b')?.workspacePath, 'D:/b', ':22')
  assert.equal(findAutomationWorkspaceOptionByKey(options, 'D:/a')?.workspacePath, 'D:/a', ':22')
  assert.equal(findAutomationWorkspaceOptionByKey(options, null), undefined, ':23')

  // 保留仍有效选择 → 回落默认 → 回落首个 → null
  assert.equal(reconcileAutomationWorkspaceSelectionKey(options, 'D:/a'), 'D:/a', ':35')
  assert.equal(reconcileAutomationWorkspaceSelectionKey(options, 'gone', { workspacePath: 'D:/b', workspaceIdentity: 'ssh://host/b' }), 'ssh://host/b', ':41')
  assert.equal(reconcileAutomationWorkspaceSelectionKey(options, 'gone'), 'D:/a', ':45 首个')
  assert.equal(reconcileAutomationWorkspaceSelectionKey([], null), null, ':45 无候选')
})

// ---------------------------------------------------------------- 运行配置
test('权限与推理档位 option（automationAgentConfigOptions.ts）', () => {
  assert.equal(AUTOMATION_DEFAULT_MODE, 'build', ':15')
  assert.deepEqual([...AUTOMATION_MODE_VALUES], ['build', 'edit', 'plan', 'yolo'], ':25')
  const mode = buildAutomationModeOption('plan')
  assert.equal(mode.id, 'mode', ':40')
  assert.equal(mode.category, 'mode', ':42')
  assert.equal(mode.currentValue, 'plan')
  assert.deepEqual(mode.options.map(o => o.value), ['build', 'edit', 'plan', 'yolo'], ':46')

  assert.equal(buildAutomationThoughtLevelOption(undefined, 'high'), null, ':132 无候选')
  assert.equal(buildAutomationThoughtLevelOption({ options: [] }, 'high'), null, ':132 空候选')
  const option = buildAutomationThoughtLevelOption({ name: 'Effort', options: [{ value: 'high', name: 'High' }] }, 'low')
  // 候选刷新不是用户选择，失效档位清空而非改成默认/最高档
  assert.equal(option.currentValue, '', ':135')
  assert.equal(buildAutomationThoughtLevelOption({ options: [{ value: 'high', name: 'High' }] }, 'high').currentValue, 'high', ':135 有效保留')
})

// ---------------------------------------------------------------- 节级规则
test('节级 tab 与模板可见性（AutomationsSection.tsx:237-296）', () => {
  assert.deepEqual(resolveVisibleAutomationTabs({ hasAnyTasks: false, offPeakVisible: true }), [], ':250 无任务不出 tab')
  assert.deepEqual(resolveVisibleAutomationTabs({ hasAnyTasks: true, offPeakVisible: true }), ['scheduled', 'idle'], ':251')
  assert.deepEqual(resolveVisibleAutomationTabs({ hasAnyTasks: true, offPeakVisible: false }), ['scheduled'], ':251 闲时不可见')

  // 无任务时两类模板并列
  assert.deepEqual(resolveAutomationTemplateVisibility({ hasAnyTasks: false, offPeakCreationEnabled: true, tab: 'scheduled' }), { showOffPeakTemplates: true, showScheduledTemplates: true }, ':291-294')
  assert.deepEqual(resolveAutomationTemplateVisibility({ hasAnyTasks: true, offPeakCreationEnabled: true, tab: 'scheduled' }), { showOffPeakTemplates: false, showScheduledTemplates: true }, ':293-294')
  assert.deepEqual(resolveAutomationTemplateVisibility({ hasAnyTasks: true, offPeakCreationEnabled: true, tab: 'idle' }), { showOffPeakTemplates: true, showScheduledTemplates: false }, ':293-294')
  assert.deepEqual(resolveAutomationTemplateVisibility({ hasAnyTasks: true, offPeakCreationEnabled: false, tab: 'idle' }), { showOffPeakTemplates: false, showScheduledTemplates: false }, ':293 灰度关')
})

test('卡片摘要/动作门槛（AutomationsSection.tsx:309-335）', () => {
  assert.equal(automationPromptSummary('  a\n b  '), 'a b', ':310 空白折叠')
  assert.equal(automationPromptSummary('   '), ' ', ':311 全空给空格')
  assert.equal(canRestartAutomation({ lifecycleStatus: 'failed' }), true, ':315')
  assert.equal(canRestartAutomation({ lifecycleStatus: 'completed' }), false, ':315 只有 failed 可重启')
  assert.equal(canToggleAutomation({ lifecycleStatus: 'active' }), true, ':319')
  assert.equal(canToggleAutomation({ lifecycleStatus: 'completed' }), false, ':319')
  assert.equal(canToggleAutomation({ lifecycleStatus: 'failed' }), false, ':319')
  assert.equal(getAutomationRunNowToastId('queued'), 'automations.runNowQueued', ':325')
  assert.equal(getAutomationRunNowToastId('duplicate'), 'automations.runNowAlreadyRunning', ':326')
  assert.equal(getAutomationRunNowToastId('failed'), 'automations.runNowFailed', ':327')
  assert.equal(getAutomationActionErrorToastId('create'), 'automations.error.create', ':334')
  assert.equal(getAutomationActionErrorToastId('restart'), 'automations.error.restart', ':334')
  assert.equal(automationLifecycleLabelId('failed'), 'automations.lifecycle.failed', ':1775')
  assert.equal(OFF_PEAK_CREATE_TOOLTIP_CLASSNAME.includes('max-w-[220px]'), true, 'offPeakUiPresentation.ts:9')
  assert.equal(WEEKDAY_ORDER.join(','), '1,2,3,4,5,6,0', 'automationFormat.ts:69')
})

// ---------------------------------------------------------------- 存储
test('存储往返 + 坏档永不抛（agentSettingsStore.ts 机制）', () => {
  assert.deepEqual(defaultAgentAutomationRules(), { offPeakTasks: [] }, '出厂无闲时任务')
  const storage = createMemoryStorage()
  const task = offPeak({ startedAt: 100, endedAt: 200 })
  assert.equal(saveAgentAutomationRules({ offPeakTasks: [task] }, storage), true, '写成功')
  assert.deepEqual(loadAgentAutomationRules(storage).offPeakTasks[0], task, '往返一致')
  assert.ok(JSON.parse(storage.dump()[AGENT_OFFPEAK_TASKS_STORAGE_KEY]).offPeakTasks.length === 1, '落盘键')

  // 坏档逐字段救，永不抛
  const bad = createMemoryStorage({ [AGENT_OFFPEAK_TASKS_STORAGE_KEY]: '{not json' })
  assert.deepEqual(loadAgentAutomationRules(bad), { offPeakTasks: [] }, '非 JSON 退回默认')
  assert.deepEqual(loadAgentAutomationRules(createThrowingStorage()), { offPeakTasks: [] }, '存储抛也退回默认')
  assert.deepEqual(loadAgentAutomationRules(null), { offPeakTasks: [] }, '无存储退回默认')
  assert.equal(saveAgentAutomationRules(defaultAgentAutomationRules(), createThrowingStorage()), false, '存不下返回 false')

  const rescued = normalizeAgentAutomationRules({
    offPeakTasks: [
      { offPeakTaskId: 't1', status: 'nonsense', queuePosition: -5, startedAt: 0 },
      { offPeakTaskId: '', title: '无 id' }, // 丢弃
      null,
      { offPeakTaskId: 't2', workspaceIdentity: ' ssh://h ', workspacePath: 'D:/p' },
    ],
  })
  assert.equal(rescued.offPeakTasks.length, 2, 'id 空/非对象丢弃')
  assert.equal(rescued.offPeakTasks[0].status, 'queued', '非法 status 退 queued')
  assert.equal(rescued.offPeakTasks[0].queuePosition, 1, '非法位次夹到 1（Math.max(1, …)）')
  assert.equal(rescued.offPeakTasks[0].startedAt, null, '0 时间戳退 null')
  assert.equal(rescued.offPeakTasks[0].permissionMode, 'build', '缺权限退默认')
  assert.equal(rescued.offPeakTasks[1].workspaceKey, 'ssh://h', 'key = identity 优先')
})
