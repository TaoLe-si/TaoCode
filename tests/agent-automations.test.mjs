// `agent/automations` 判据：ZCode「自动化」节的配置面 —— 出厂默认、坏存档逐字段救、
// 保存前校验、存储往返与降级、调度摘要、状态筛选、模板，以及 `automationNextRun` 的
// 跨月/跨年/夏令时/非法输入边界。
//
// 出处速查（ZCode，只读参照 `.tools/ZCode`）：
//   · 领域类型     packages/shared/src/automation-types.ts:65-101
//   · 生命周期四态 automation-types.ts:19；派发四态 :22-26
//   · 上限 20      automation-types.ts:10（AUTOMATION_CREATE_LIMIT）
//   · 必填三项     packages/ui/src/settings/automationEditValidation.ts:9-12
//   · 状态筛选     packages/ui/src/settings/automationStatusFilter.ts:9-20, :41-46
//   · 失败徽章     packages/ui/src/settings/automationFormat.ts:25-31
//   · 卡片调度摘要 packages/ui/src/settings/automationCardSchedule.ts:37-46
//   · 下次运行算法 packages/services/src/session/automationCron.ts:133-220
//   · Beta 徽标    zh-CN settings.automations.betaBadge = "Beta"（zh-CN.ts:6058）
import test from 'node:test'
import assert from 'node:assert/strict'
import {
  AGENT_AUTOMATIONS_BETA_BADGE, AGENT_AUTOMATIONS_MAX_ENTRIES, AGENT_AUTOMATIONS_STORAGE_KEY,
  AGENT_AUTOMATIONS_TITLE, AGENT_AUTOMATION_DEFAULT_STATUS_FILTER, AGENT_AUTOMATION_STATUS_FILTERS,
  automationNextRun, automationStatusFilterOf, defaultAgentAutomations,
  formatAutomationSchedule, hasAutomationFailure, isComputableCron, loadAgentAutomations,
  normalizeAgentAutomations, saveAgentAutomations, validateAgentAutomations,
} from '../src/agentAutomations.ts'
import { createMemoryStorage, createThrowingStorage } from '../src/agentSettingsStore.ts'

function automation(overrides = {}) {
  return {
    id: 'a1', title: '每日站会', prompt: '汇总今天的提交', cronExpr: '0 9 * * 1-5',
    scheduleRule: null, recurring: true, maxRuns: null, endAt: null, enabled: true,
    lifecycleStatus: 'active', dispatchStatus: 'idle', dispatchAttempts: 0, lastError: '',
    runCount: 0, nextRunAt: null, lastRunAt: null,
    workspaceKey: 'D:/proj', workspacePath: 'D:/proj', workspaceIdentity: '', templateId: '',
    ...overrides,
  }
}

const rule = (over = {}) => ({
  unit: 'daily', interval: 1, hour: 9, minute: 0, anchorAt: Date.UTC(2026, 0, 1),
  weekdays: [], monthDays: [], months: [], monthlyMode: 'date', ...over,
})

test('节标识与上限逐字对齐 ZCode（zh-CN:6056/6058、automation-types.ts:10）', () => {
  assert.equal(AGENT_AUTOMATIONS_TITLE, '自动化', 'zh-CN settings.automations.title')
  assert.equal(AGENT_AUTOMATIONS_BETA_BADGE, 'Beta', 'zh-CN settings.automations.betaBadge（Beta 徽标）')
  assert.equal(AGENT_AUTOMATIONS_MAX_ENTRIES, 20, 'automation-types.ts:10 的 AUTOMATION_CREATE_LIMIT')
  assert.deepEqual([...AGENT_AUTOMATION_STATUS_FILTERS], ['all', 'inProgress', 'completed', 'failed'],
    'automationStatusFilter.ts:15-20')
  assert.equal(AGENT_AUTOMATION_DEFAULT_STATUS_FILTER, 'all', 'automationStatusFilter.ts:13 的默认值')
  const defaults = defaultAgentAutomations()
  assert.deepEqual(defaults.automations, [], '出厂无任务')
  assert.deepEqual(defaults.templates, [], '模板来自远端配置源，本仓不预置假模板')
})

test('出厂默认逐字段：新建即开 + active（automation-types.ts:91-92 的形状）', () => {
  const saved = normalizeAgentAutomations({ automations: [{}] })
  const one = saved.automations[0]
  assert.equal(one.enabled, true, 'automation-types.ts:91 的 enabled')
  assert.equal(one.lifecycleStatus, 'active', 'automation-types.ts:92 的 lifecycleStatus')
  assert.equal(one.dispatchStatus, 'idle', 'automation-types.ts:95 的 dispatchStatus')
  assert.equal(one.recurring, true, 'automation-types.ts:83 的 recurring')
  assert.equal(one.runCount, 0)
  assert.equal(one.maxRuns, null, '缺 maxRuns 时是 null 不是 0（0 会被判成非法次数）')
  assert.equal(one.workspaceKey, '', '缺路径时 key 为空串')
})

test('坏存档逐字段救：非法生命周期/派发态退默认、越界计数夹回、垃圾条目只丢自己', () => {
  const saved = normalizeAgentAutomations({ automations: [
    null, '垃圾', 7,
    {
      lifecycleStatus: '乱写的', dispatchStatus: '乱写的', dispatchAttempts: -5, runCount: 1e12,
      enabled: 'true', maxRuns: 0, endAt: -1, nextRunAt: 0, statusFilterX: 1,
      workspaceIdentity: '  ', workspacePath: 'D:/p',
    },
  ] })
  assert.equal(saved.automations.length, 1, '三个垃圾条目各丢自己，合法条目保下')
  const one = saved.automations[0]
  assert.equal(one.lifecycleStatus, 'active', '非法生命周期退 active')
  assert.equal(one.dispatchStatus, 'idle', '非法派发态退 idle')
  assert.equal(one.dispatchAttempts, 0, '负数夹回 0')
  assert.equal(one.runCount, 1_000_000, '超大计数夹到上限')
  assert.equal(one.enabled, true, '非布尔退默认')
  assert.equal(one.maxRuns, 1, '0 次是非法值，夹到 1')
  assert.equal(one.endAt, null, '非正数时间戳退 null')
  assert.equal(one.nextRunAt, null, '0 不是合法时间戳（0 = epoch）')
  // key 规则：workspaceIdentity?.trim() || workspacePath（automation-types.ts:75）
  assert.equal(one.workspaceKey, 'D:/p', 'identity 为空白时回退 path')
})

test('scheduleRule 逐字段救：非法 unit 整体丢弃退回 cron、越界小时/分钟夹回、脏数组被清洗', () => {
  const bad = normalizeAgentAutomations({ automations: [{ scheduleRule: { unit: '每秒' }, cronExpr: '0 9 * * *' }] })
  assert.equal(bad.automations[0].scheduleRule, null, 'unit 非法时整条规则丢弃（每个算法分支都先认 unit）')
  const clamped = normalizeAgentAutomations({ automations: [{
    scheduleRule: { unit: 'daily', interval: 9999, hour: 99, minute: -3, anchorAt: Date.UTC(2026, 0, 1),
      weekdays: [0, 9, 'x', 6], monthDays: [0, 31, 45], months: [13, 1], monthlyMode: 'weekday' },
  }] })
  const r = clamped.automations[0].scheduleRule
  assert.equal(r.interval, 200, '间隔夹到上限 200（automation-types.ts:173 的 1–200）')
  assert.equal(r.hour, 23, '小时夹到 23')
  assert.equal(r.minute, 0, '分钟夹到 0')
  assert.deepEqual(r.weekdays, [0, 6], '越界与非数字被丢弃，剩下的排序去重')
  assert.deepEqual(r.monthDays, [31], '越界日期被丢弃')
  assert.deepEqual(r.months, [1], '越界月份被丢弃')
  assert.equal(r.monthlyMode, 'weekday', '合法 monthlyMode 保留')
})

test('保存前校验拦下：空标题 / 空提示词 / 空调度 / 非法 cron / 区间越界', () => {
  const noTitle = validateAgentAutomations({ automations: [automation({ title: '  ' })], statusFilter: 'all', templates: [] })
  assert.ok(noTitle.some(p => p.includes('标题不能为空')), `空标题被拦下：${JSON.stringify(noTitle)}`)
  const noPrompt = validateAgentAutomations({ automations: [automation({ prompt: '' })], statusFilter: 'all', templates: [] })
  assert.ok(noPrompt.some(p => p.includes('提示词不能为空')), '空提示词被拦下（automationEditValidation.ts:11）')
  const noSchedule = validateAgentAutomations({ automations: [automation({ cronExpr: '  ' })], statusFilter: 'all', templates: [] })
  assert.ok(noSchedule.some(p => p.includes('调度不能为空')), '空调度被拦下（automationEditValidation.ts:10）')
  const badCron = validateAgentAutomations({ automations: [automation({ cronExpr: '99 * * * *' })], statusFilter: 'all', templates: [] })
  assert.ok(badCron.some(p => p.includes('五段')), '越界 cron 字段被拦下')
  const shortCron = validateAgentAutomations({ automations: [automation({ cronExpr: '* * *' })], statusFilter: 'all', templates: [] })
  assert.ok(shortCron.some(p => p.includes('五段')), '三段 cron 被拦下')
  // 阳性对照：一条完全合法的配置必须零问题（证明上面几条不是恒真）。
  assert.deepEqual(validateAgentAutomations({ automations: [automation()], statusFilter: 'all', templates: [] }), [],
    '合法配置无问题（阳性对照）')
})

test('scheduleRule 区间越界被拦下，且有 scheduleRule 时不要求 cron 可算', () => {
  const base = { automations: [automation({ cronExpr: '', scheduleRule: rule() })], statusFilter: 'all', templates: [] }
  // 阳性对照：只有 scheduleRule、cronExpr 为空，是合法配置（cronExpr 只是兼容展示面）。
  assert.deepEqual(validateAgentAutomations(base), [], '有 scheduleRule 时 cron 可空（automation-types.ts:34）')
  const badInterval = validateAgentAutomations({ ...base, automations: [automation({ cronExpr: '', scheduleRule: rule({ interval: 0 }) })] })
  assert.ok(badInterval.some(p => p.includes('重复间隔')), '间隔越界被拦下')
  const badHour = validateAgentAutomations({ ...base, automations: [automation({ cronExpr: '', scheduleRule: rule({ hour: 24 }) })] })
  assert.ok(badHour.some(p => p.includes('小时必须在')), '小时越界被拦下')
  const badWeekday = validateAgentAutomations({ ...base, automations: [automation({ cronExpr: '', scheduleRule: rule({ unit: 'weekly', weekdays: [7] }) })] })
  assert.ok(badWeekday.some(p => p.includes('星期必须在')), '星期越界被拦下（0-6）')
  const badMonth = validateAgentAutomations({ ...base, automations: [automation({ cronExpr: '', scheduleRule: rule({ unit: 'yearly', months: [13] }) })] })
  assert.ok(badMonth.some(p => p.includes('月份必须在')), '月份越界被拦下（1-12）')
})

test('超过 20 条上限被拦下（automation-types.ts:10）', () => {
  const many = { automations: Array.from({ length: 21 }, (_, i) => automation({ id: `a${i}` })), statusFilter: 'all', templates: [] }
  assert.ok(validateAgentAutomations(many).some(p => p.includes('最多 20 条')), '第 21 条被拦下')
  // 阳性对照：正好 20 条通过。
  const exact = { ...many, automations: many.automations.slice(0, 20) }
  assert.deepEqual(validateAgentAutomations(exact), [], '正好 20 条通过（阳性对照）')
  // 归一化时也按上限截断，不让坏存档撑爆表。
  assert.equal(normalizeAgentAutomations(many).automations.length, 20, '归一化按上限截断')
})

test('存储往返 + 无存储/抛异常/坏 JSON 一律静默降级', () => {
  const storage = createMemoryStorage()
  const settings = { automations: [automation({ id: 'x1', title: '周报', scheduleRule: rule({ unit: 'weekly', weekdays: [1, 3] }) })], statusFilter: 'failed', templates: [] }
  assert.equal(saveAgentAutomations(settings, storage), true)
  assert.ok(storage.dump()[AGENT_AUTOMATIONS_STORAGE_KEY], `存档落在 ${AGENT_AUTOMATIONS_STORAGE_KEY}`)
  const back = loadAgentAutomations(storage)
  assert.equal(back.automations[0].title, '周报')
  assert.deepEqual(back.automations[0].scheduleRule.weekdays, [1, 3])
  assert.equal(back.statusFilter, 'failed', '筛选值也往返')
  assert.deepEqual(loadAgentAutomations(null), defaultAgentAutomations(), '无存储退默认')
  assert.deepEqual(loadAgentAutomations(createThrowingStorage()), defaultAgentAutomations(), 'getItem 抛异常退默认')
  assert.deepEqual(loadAgentAutomations(createMemoryStorage({ [AGENT_AUTOMATIONS_STORAGE_KEY]: '{坏' })), defaultAgentAutomations(), '坏 JSON 退默认')
  assert.equal(saveAgentAutomations(settings, createThrowingStorage()), false, '写不进去返回 false')
})

test('automationNextRun：daily 跨月与跨年都落在正确的墙上时间', () => {
  // 基准：2026-01-31 12:00 本地。跨月进位由 Date 归一化负责。
  const from = new Date(2026, 0, 31, 12, 0, 0, 0).getTime()
  const next = automationNextRun(automation({ scheduleRule: rule({ hour: 9, minute: 0 }) }), from)
  assert.equal(next, '2026-02-01 09:00', '下一次是次日同一墙上时间')
  // 跨年：12-31 之后进位到下一年 1 月 1 日。
  const yearEnd = new Date(2026, 11, 31, 12, 0, 0, 0).getTime()
  assert.equal(automationNextRun(automation({ scheduleRule: rule({ hour: 9, minute: 0 }) }), yearEnd), '2027-01-01 09:00',
    '跨年进位到下一年')
  // 严格晚于基准：正好命中同一分钟时必须推到下一天，不能返回等于 from 的时刻。
  const exact = new Date(2026, 0, 31, 9, 0, 0, 0).getTime()
  assert.equal(automationNextRun(automation({ scheduleRule: rule({ hour: 9, minute: 0 }) }), exact), '2026-02-01 09:00',
    '恰好命中当刻 ⇒ 推到下一次（严格晚于 from）')
})

test('automationNextRun：weekly / monthly / yearly 与非法输入', () => {
  const from = new Date(2026, 0, 5, 12, 0, 0, 0).getTime() // 周一
  // weekly：锚点周一，weekdays [1,3]（周一/周三）。基准是周一 12:00，
  // 而当天的 18:30 还没到 ⇒ 下一次就是**当天** 18:30，不是周三。
  const weekly = automationNextRun(automation({ scheduleRule: rule({ unit: 'weekly', hour: 18, minute: 30, weekdays: [1, 3], anchorAt: new Date(2026, 0, 5, 0, 0, 0).getTime() }) }), from)
  assert.equal(weekly, '2026-01-05 18:30', 'weekly 命中当天还没到的那一场（严格晚于 from）')
  // 同一规则换一个更晚的基准（周一 19:00）⇒ 周一那场已过，落到周三。
  const afterMonday = new Date(2026, 0, 5, 19, 0, 0, 0).getTime()
  const nextWednesday = automationNextRun(automation({ scheduleRule: rule({ unit: 'weekly', hour: 18, minute: 30, weekdays: [1, 3], anchorAt: new Date(2026, 0, 5, 0, 0, 0).getTime() }) }), afterMonday)
  assert.equal(nextWednesday, '2026-01-07 18:30', '当周那场已过 ⇒ 落到下一个匹配的星期三（阳性对照）')
  // monthly：每月 15 号。
  const monthly = automationNextRun(automation({ scheduleRule: rule({ unit: 'monthly', hour: 8, minute: 0, monthDays: [15], anchorAt: new Date(2026, 0, 1, 0, 0, 0).getTime() }) }), from)
  assert.equal(monthly, '2026-01-15 08:00', 'monthly 命中本月 15 号')
  // yearly：跨年。months=[1] monthDays=[2] ⇒ 从 2026 年内看，下一次是 2027-01-02。
  const yearly = automationNextRun(automation({ scheduleRule: rule({ unit: 'yearly', hour: 7, minute: 0, months: [1], monthDays: [2], anchorAt: new Date(2026, 0, 1, 0, 0, 0).getTime() }) }), from)
  assert.equal(yearly, '2027-01-02 07:00', 'yearly 跨年命中下一次 1 月 2 日')
  // yearly 溢出守卫（automationCron.ts:209,215）：2/30 在**任何**年份都不存在
  // （new Date(y,1,30) 恒滚到 3 月），所以永远排不出下一次 ⇒ null。
  const feb30 = automationNextRun(automation({ scheduleRule: rule({ unit: 'yearly', hour: 7, minute: 0, months: [2], monthDays: [30], anchorAt: new Date(2026, 0, 1, 0, 0, 0).getTime() }) }), from)
  assert.equal(feb30, null, '2/30 在任何年份都不存在 ⇒ null（溢出守卫逐个跳过）')
  // 真正的闰年守卫：2/29 在平年被跳过，落到下一个闰年 2028。
  const feb29 = automationNextRun(automation({ scheduleRule: rule({ unit: 'yearly', hour: 7, minute: 0, months: [2], monthDays: [29], anchorAt: new Date(2026, 0, 1, 0, 0, 0).getTime() }) }), from)
  assert.equal(feb29, '2028-02-29 07:00', '2/29 跳过 2026/2027 两个平年，落到闰年 2028（阳性对照）')
  // 非法输入一律 null，不抛。
  assert.equal(automationNextRun(automation({ cronExpr: '不是 cron' }), from), null, '非法 cron → null')
  assert.equal(automationNextRun(automation(), Number.NaN), null, '基准时刻非法 → null')
  assert.equal(automationNextRun(automation(), 0), null, '基准时刻为 0 → null')
  assert.equal(automationNextRun(automation({ cronExpr: '' }), from), null, '空 cron 且无规则 → null')
  // 终态不再排下一次（automationService.ts:385-390 的领域层口径）。
  assert.equal(automationNextRun(automation({ lifecycleStatus: 'completed', scheduleRule: rule() }), from), null, 'completed 不排下次')
  assert.equal(automationNextRun(automation({ lifecycleStatus: 'failed', scheduleRule: rule() }), from), null, 'failed 不排下次')
  // 阳性对照：active 一定排得出（证明上面的 null 不是恒真）。
  assert.notEqual(automationNextRun(automation({ scheduleRule: rule() }), from), null, 'active 排得出下一次（阳性对照）')
})

test('automationNextRun：夏令时切换日按本地墙上时间，不漂成 UTC 固定偏移', () => {
  // 用固定偏移构造的基准避免依赖运行机器的时区：直接验证「跨 DST 后墙上时间仍是 09:00」。
  // 2026-03-08 是 America/New_York 的春季跳钟日；该时区下 02:00 直接跳到 03:00。
  const originalTz = process.env.TZ
  try {
    process.env.TZ = 'America/New_York'
    // 2026-03-07 12:00 EST ⇒ 下一次 09:00 落在 2026-03-08（跳过的那天不存在 02:00，但我们排的是 09:00）。
    const beforeDst = new Date(Date.UTC(2026, 2, 7, 17, 0, 0)).getTime() // 12:00 EST
    const next = automationNextRun(automation({ scheduleRule: rule({ hour: 9, minute: 0, anchorAt: beforeDst }) }), beforeDst)
    assert.equal(next, '2026-03-08 09:00', 'DST 当天仍落在本地 09:00（不漂成 08:00 或 10:00）')
    // 春季跳钟日不存在 02:30：本地时间构造会自动归一化到 03:30 EDT，而不是崩掉或返回 02:30。
    const aroundGap = new Date(Date.UTC(2026, 2, 8, 6, 0, 0)).getTime() // 01:00 EST，跳钟前
    const gap = automationNextRun(automation({ scheduleRule: rule({ hour: 2, minute: 30, anchorAt: aroundGap }) }), aroundGap)
    assert.equal(gap, '2026-03-08 03:30', '跳钟缺口被归一化到 03:30（不返回不存在的 02:30）')
    // 阳性对照：同一函数在非跳钟日按预期给出 02:30（证明上一条不是恒真偏移）。
    // 基准取当天 00:00 EST（UTC 05:00），此时当天的 02:30 还没到。
    const normalFrom = new Date(Date.UTC(2026, 2, 10, 5, 0, 0)).getTime()
    const normal = automationNextRun(automation({ scheduleRule: rule({ hour: 2, minute: 30, anchorAt: normalFrom }) }), normalFrom)
    assert.equal(normal, '2026-03-10 02:30', '非跳钟日的 02:30 正常命中（阳性对照）')
  } finally {
    if (originalTz === undefined) delete process.env.TZ
    else process.env.TZ = originalTz
  }
})

test('automationNextRun：优先用 scheduleRule，缺省才用 cron（automationCron.ts:343-350）', () => {
  const from = new Date(2026, 0, 5, 12, 0, 0, 0).getTime()
  // 两者都在时：scheduleRule 权威（cron 会被忽略）。
  const both = automationNextRun(automation({
    cronExpr: '0 20 * * *', scheduleRule: rule({ hour: 9, minute: 0 }),
  }), from)
  assert.equal(both, '2026-01-06 09:00', '有 scheduleRule 时以它为准，cronExpr 只作兼容展示')
  // 没有 scheduleRule：走 cron。`0 20 * * *` 每天 20:00，基准是当天 12:00 ⇒ 当天 20:00。
  const cronOnly = automationNextRun(automation({ cronExpr: '0 20 * * *' }), from)
  assert.equal(cronOnly, '2026-01-05 20:00', '无 scheduleRule 时用 cronExpr')
  // 越过 endAt 不再触发（automationService.ts:381-384）。
  const ended = automationNextRun(automation({
    scheduleRule: rule({ hour: 9, minute: 0 }),
    endAt: new Date(2026, 0, 5, 13, 0, 0, 0).getTime(),
  }), from)
  assert.equal(ended, null, '下次运行越过截止时间 → null')
})

test('isComputableCron：五段合法 cron 通过，六段/七段/越界都拒绝', () => {
  for (const expr of ['0 9 * * 1-5', '*/5 * * * *', '30 8 1,15 * *', '0 0 29 2 *']) {
    assert.equal(isComputableCron(expr), true, `「${expr}」应可算`)
  }
  for (const expr of ['0 9 * *', '0 9 * * 1 2', '60 9 * * *', '0 24 * * *', '0 9 32 * *', '0 9 * 13 *', '0 9 * * 7', 'abc']) {
    assert.equal(isComputableCron(expr), false, `「${expr}」应被判不可算`)
  }
})

test('状态筛选口径：先看失败徽章，再看 completed，其余进行中（automationStatusFilter.ts:41-46）', () => {
  const settings = { automations: [], statusFilter: 'all', templates: [] }
  const list = [
    automation({ id: 'active' }),
    automation({ id: 'paused', lifecycleStatus: 'paused' }),
    automation({ id: 'done', lifecycleStatus: 'completed' }),
    automation({ id: 'failed', lifecycleStatus: 'failed' }),
    // 关键：active 但有错误信息 ⇒ 归「失败」组（automationFormat.ts:25-31 的失败徽章优先）。
    automation({ id: 'activeWithError', lastError: '上次派发失败' }),
    // active 但派发失败 ⇒ 同样归「失败」。
    automation({ id: 'activeDispatchFailed', dispatchStatus: 'failed_to_dispatch' }),
  ]
  assert.deepEqual(automationStatusFilterOf(settings, 'all', list).map(a => a.id), list.map(a => a.id),
    'all 原样返回')
  assert.deepEqual(automationStatusFilterOf(settings, 'completed', list).map(a => a.id), ['done'],
    'completed 只留终态')
  assert.deepEqual(automationStatusFilterOf(settings, 'failed', list).map(a => a.id),
    ['failed', 'activeWithError', 'activeDispatchFailed'],
    '失败组含 lifecycle 失败 + 有错误信息 + 派发失败')
  assert.deepEqual(automationStatusFilterOf(settings, 'inProgress', list).map(a => a.id), ['active', 'paused'],
    '其余归进行中（暂停也算进行中，automationStatusFilter.ts:22-23）')
  // 非法筛选值退回持久化值；持久化值也非法才退 all。
  assert.deepEqual(automationStatusFilterOf({ ...settings, statusFilter: 'completed' }, '乱写的', list).map(a => a.id), ['done'],
    '非法入参退 settings.statusFilter')
  assert.deepEqual(automationStatusFilterOf(settings, '乱写的', list).map(a => a.id), list.map(a => a.id),
    '两处都非法退 all（阳性对照）')
  assert.deepEqual(automationStatusFilterOf(settings, 'completed', []), [], '空列表返回空数组，不抛')
})

test('hasAutomationFailure：三条判据各自命中，空白错误信息不算失败', () => {
  assert.equal(hasAutomationFailure(automation({ lifecycleStatus: 'failed' })), true, 'lifecycle failed')
  assert.equal(hasAutomationFailure(automation({ dispatchStatus: 'failed_to_dispatch' })), true, '派发失败')
  assert.equal(hasAutomationFailure(automation({ lastError: 'boom' })), true, '有错误信息')
  assert.equal(hasAutomationFailure(automation({ lastError: '   ' })), false, '空白错误信息不算失败')
  assert.equal(hasAutomationFailure(automation()), false, '正常任务不算失败（阳性对照）')
})

test('调度摘要照 automationCardSchedule.ts:37-46 与 automationFormat.ts:6206-6232 的中文', () => {
  assert.equal(formatAutomationSchedule(automation({ recurring: false, maxRuns: 1, scheduleRule: rule({ unit: 'minute', interval: 4 }) })),
    '自定义', '一次性任务不显示频率（automationCardSchedule.ts:37-41：否则会误显为「每 4 分钟」）')
  assert.equal(formatAutomationSchedule(automation({ scheduleRule: rule({ hour: 9, minute: 0 }) })), '每天 09:00', 'daily')
  assert.equal(formatAutomationSchedule(automation({ scheduleRule: rule({ unit: 'minute', interval: 4 }) })), '每 4 分钟', 'customMinutes')
  assert.equal(formatAutomationSchedule(automation({ cronExpr: '0 9 * * 1-5', scheduleRule: null })), '每工作日 09:00', 'weekdays（zh-CN:6222）')
  assert.equal(formatAutomationSchedule(automation({ cronExpr: '*/10 * * * *', scheduleRule: null })), '每 10 分钟', '分钟步长（zh-CN:6225）')
  assert.equal(formatAutomationSchedule(automation({ cronExpr: '30 8 1 * *', scheduleRule: null })), '每月 1 号 08:30', 'monthly（zh-CN:6224）')
  assert.equal(formatAutomationSchedule(automation({ cronExpr: '30 18 * * 3', scheduleRule: null })), '每周三 18:30', 'weekly（zh-CN:6223「每周{days} {time}」）')
  // 固定月日 `M H DOM MON *` 不带年份，猜不出单次还是年度 ⇒ 一律「自定义」（automationFormat.ts:360-364）。
  assert.equal(formatAutomationSchedule(automation({ cronExpr: '0 9 1 1 *', scheduleRule: null })), '自定义',
    '固定月日 cron 不猜频率（automationFormat.ts:360-364）')
  // 不可解析的 cron 回退原始文本，不误导（automationFormat.ts:349-350 的承诺）。
  assert.equal(formatAutomationSchedule(automation({ cronExpr: '完全不是 cron', scheduleRule: null })), '完全不是 cron',
    '认不出的 cron 回退原文')
})