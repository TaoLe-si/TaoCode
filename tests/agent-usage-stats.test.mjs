// AG-09 记账层判据：估算 / 账单分列、token 口径、命中率分母、错误率、时延、重试、
// 模型占比、格式化规则、存档与淘汰。存储用内存 Map，不碰真 localStorage。
import test from 'node:test'
import assert from 'node:assert/strict'
import {
  AGENT_USAGE_RECORD_LIMIT,
  AGENT_USAGE_STATS_STORAGE_KEY,
  BILLING_LABEL,
  ESTIMATED_TOKEN_CHAR_DIVISOR,
  ESTIMATION_LABEL,
  buildUsageStatItems,
  cacheHitRate,
  createAgentUsageStatsStore,
  formatCompactNumber,
  formatCompactTokenUsage,
  formatDays,
  formatDuration,
  formatLatency,
  formatPercent,
  formatRate,
  formatSourceProvider,
  formatSummaryCompactTokenUsage,
  formatTrend,
  formatUsageOriginLabel,
  inputSideTokens,
  recordFromUsageRecord,
  resolveModelLabel,
  summarizeAgentUsage,
  summarizeModels,
  totalTokens,
  usageTimestamp,
} from '../src/agentUsageStats.ts'

function memoryStorage(initial = {}) {
  const map = new Map(Object.entries(initial))
  return {
    map,
    getItem: key => (map.has(key) ? map.get(key) : null),
    setItem: (key, value) => { map.set(key, value) },
  }
}

/** 可控时钟：每次调用往前走 1 秒，`at` 的先后不会撞在同一毫秒上。 */
function clock(start = '2026-10-07T00:00:00.000Z') {
  let tick = Date.parse(start)
  return () => new Date(tick += 1000)
}

function record(overrides = {}) {
  return {
    at: '2026-10-07T00:00:00.000Z',
    origin: 'billing',
    modelId: 'zai/glm-4.6',
    providerId: 'zai',
    providerReported: true,
    inputTokens: 100,
    outputTokens: 40,
    reasoningTokens: 10,
    cacheCreationTokens: 20,
    cacheReadTokens: 50,
    providerTotalTokens: null,
    retryCount: 0,
    timeToFirstTokenMs: null,
    durationMs: null,
    requestCount: 1,
    errorCount: 0,
    credits: 0,
    ...overrides,
  }
}

test('输入侧 token：input 已给就是 total input，cache 只作 breakdown 不再叠', () => {
  // usage-stats-builder.ts:89-95 的注释：命中率分母不能再加 cacheRead/cacheCreation。
  assert.equal(inputSideTokens({ inputTokens: 100, cacheCreationTokens: 20, cacheReadTokens: 50 }), 100)
  // input 缺省才退到 cache 之和。
  assert.equal(inputSideTokens({ inputTokens: 0, cacheCreationTokens: 20, cacheReadTokens: 50 }), 70)
  assert.equal(inputSideTokens({ inputTokens: 0, cacheCreationTokens: 0, cacheReadTokens: 0 }), 0)
})

test('总 token：优先供应商总量，缺省用输入侧 + 输出，reasoning 不并进来', () => {
  // repositories/usage.ts:21-27 的 computedTotalTokens = inputSide + output。
  assert.equal(totalTokens(record({ inputTokens: 100, outputTokens: 40, reasoningTokens: 999 })), 140)
  assert.equal(totalTokens(record({ inputTokens: 100, outputTokens: 40, providerTotalTokens: 500 })), 500)
  // input 缺省时输入侧退到 cache 之和。
  assert.equal(totalTokens(record({ inputTokens: 0, cacheCreationTokens: 20, cacheReadTokens: 50, outputTokens: 5 })), 75)
})

test('Cache 命中率：分母只取输入侧，没有分母时为 0', () => {
  assert.equal(cacheHitRate({ inputTokens: 100, cacheCreationTokens: 20, cacheReadTokens: 50 }), 0.5)
  assert.equal(cacheHitRate({ inputTokens: 0, cacheCreationTokens: 0, cacheReadTokens: 0 }), 0)
  // 叠 cache 会把命中率压低：70/170 ≈ 0.41，正确口径是 50/100。
  assert.notEqual(cacheHitRate({ inputTokens: 100, cacheCreationTokens: 20, cacheReadTokens: 50 }), 70 / 170)
})

test('汇总按 origin 分开标记：估算不会拿到账单文案，反之亦然', () => {
  const estimated = summarizeAgentUsage([record({ origin: 'estimated', providerReported: false })], 'estimated')
  const billing = summarizeAgentUsage([record({ origin: 'billing' })], 'billing')
  assert.equal(estimated.label, ESTIMATION_LABEL)
  assert.equal(billing.label, BILLING_LABEL)
  assert.notEqual(estimated.label, billing.label)
  assert.equal(formatUsageOriginLabel('estimated'), ESTIMATION_LABEL)
  assert.equal(formatUsageOriginLabel('billing'), BILLING_LABEL)
})

test('汇总口径：错误率按请求数，重试照存，时延拿不到就是 null 不是 0', () => {
  const summary = summarizeAgentUsage([
    record({ requestCount: 4, errorCount: 1, retryCount: 2, timeToFirstTokenMs: 800, durationMs: 60_000 }),
    record({ requestCount: 0, errorCount: 0, retryCount: 1, timeToFirstTokenMs: 1200, durationMs: 120_000 }),
  ], 'billing')
  assert.equal(summary.requestCount, 4)
  assert.equal(summary.errorCount, 1)
  assert.equal(summary.errorRate, 0.25)
  assert.equal(summary.retryCount, 3)
  assert.equal(summary.avgTimeToFirstTokenMs, 1000)
  assert.equal(summary.avgDurationMs, 90_000)
  // 一条时延都没有时是 null（SQL avg() 的口径），不是 0。
  assert.equal(summarizeAgentUsage([record()], 'billing').avgTimeToFirstTokenMs, null)
  assert.equal(summarizeAgentUsage([], 'billing').avgDurationMs, null)
})

test('汇总 token 分列：输入 / 输出 / reasoning / 缓存写读各自独立', () => {
  const summary = summarizeAgentUsage([
    record({ inputTokens: 100, outputTokens: 40, reasoningTokens: 10, cacheCreationTokens: 20, cacheReadTokens: 50 }),
    record({ inputTokens: 100, outputTokens: 10, reasoningTokens: 0, cacheCreationTokens: 0, cacheReadTokens: 50 }),
  ], 'billing')
  assert.equal(summary.inputTokens, 200)
  assert.equal(summary.outputTokens, 50)
  assert.equal(summary.reasoningTokens, 10)
  assert.equal(summary.cacheCreationTokens, 20)
  assert.equal(summary.cacheReadTokens, 100)
  assert.equal(summary.cacheHitRate, 0.5)
  assert.equal(summary.totalTokens, 250)
})

test('模型维度：按 totalTokens 倒序，share 是占比，null 模型归未知且排在后面', () => {
  const models = summarizeModels([
    record({ modelId: 'b', inputTokens: 50, outputTokens: 0, cacheCreationTokens: 0, cacheReadTokens: 0 }),
    record({ modelId: 'a', inputTokens: 100, outputTokens: 0, cacheCreationTokens: 0, cacheReadTokens: 0 }),
    record({ modelId: null, inputTokens: 50, outputTokens: 0, cacheCreationTokens: 0, cacheReadTokens: 0 }),
  ])
  assert.deepEqual(models.map(model => model.modelId), ['a', 'b', null])
  assert.equal(models[0].totalTokens, 100)
  assert.equal(models[0].share, 0.5)
  assert.equal(models[0].requestCount, 1)
  assert.equal(resolveModelLabel(models[2].modelId), '未知模型')
  // 全是 0 token 时 share 不除零。
  assert.equal(summarizeModels([record({ inputTokens: 0, outputTokens: 0, cacheCreationTokens: 0, cacheReadTokens: 0 })])[0].share, 0)
})

test('格式化：紧凑数字与 token 的阈值、非有限数回退各不相同', () => {
  // usageStatsUiParts.tsx:11-19：非有限回 '--'。
  assert.equal(formatCompactNumber('en-US', Number.NaN), '--')
  assert.equal(formatCompactNumber('en-US', Number.POSITIVE_INFINITY), '--')
  assert.equal(formatCompactNumber('en-US', 999), '999')
  assert.equal(formatCompactNumber('en-US', 1500), '1.5K')
  // tokenNumberFormat.ts：非有限回空串（不是 '--'）。
  assert.equal(formatCompactTokenUsage('en-US', Number.NaN), '')
  assert.equal(formatCompactTokenUsage('en-US', 999), '999')
  assert.equal(formatCompactTokenUsage('en-US', 1500), '1.5K')
  assert.equal(formatCompactTokenUsage('en-US', 1_000_000), '1M')
})

test('格式化：中文摘要补万/亿前的空格，英文不加', () => {
  // usageStatsUiParts.tsx:25-30 的 replace(/(?<=\d)(?=[万亿])/u, ' ')。
  assert.equal(formatSummaryCompactTokenUsage('zh-CN', 12_000), '1.2 万')
  assert.equal(formatSummaryCompactTokenUsage('en-US', 12_000), '12K')
})

test('格式化：百分比与费率的小数位规则', () => {
  // usageStatsUiParts.tsx:32-37：≥10% 不留小数。
  assert.equal(formatPercent('en-US', 0.25), '25%')
  assert.equal(formatPercent('en-US', 0.055), '5.5%')
  // CodingPlanUsagePanel.tsx:1007-1017：null/非有限回 '--'，>1 视为百分数先除 100。
  assert.equal(formatRate('en-US', null), '--')
  assert.equal(formatRate('en-US', Number.NaN), '--')
  assert.equal(formatRate('en-US', 0.755), '75.5%')
  assert.equal(formatRate('en-US', 78), '78%')
  // CodingPlanUsagePanel.tsx:1034-1040：显式带符号，0 不带。
  assert.equal(formatTrend('en-US', 0.12), '+12%')
  assert.equal(formatTrend('en-US', -0.12), '-12%')
  assert.equal(formatTrend('en-US', 0), '0%')
})

test('格式化：时长向下取整到分钟，全零也要出「0 分钟」', () => {
  // AppUsagePanel.tsx:187-206 的 minutes > 0 || parts.length === 0 分支。
  assert.equal(formatDuration(0), '0 分钟')
  assert.equal(formatDuration(59_999), '0 分钟')
  assert.equal(formatDuration(60_000), '1 分钟')
  assert.equal(formatDuration(3 * 3_600_000 + 25 * 60_000), '3 小时 25 分钟')
  assert.equal(formatDuration(26 * 3_600_000), '1 天 2 小时')
  assert.equal(formatDays('en-US', 3), '3 天')
  assert.equal(formatLatency(null), '--')
  assert.equal(formatLatency(1200), '0 分钟')
  assert.equal(formatSourceProvider('zai'), '来源：zai')
  assert.equal(formatSourceProvider(''), '来源：未知模型')
})

test('展示行标签取 zh-CN 原文，账单才带积分', () => {
  const billing = buildUsageStatItems(summarizeAgentUsage([record({ credits: 12 })], 'billing'), 'en-US')
  assert.deepEqual(billing.map(item => item.label), ['tokens 用量', 'Cache 命中率', '调用次数', '模型用量', '积分总数'])
  const estimated = buildUsageStatItems(summarizeAgentUsage([record({ origin: 'estimated' })], 'estimated'), 'en-US')
  assert.deepEqual(estimated.map(item => item.label), ['tokens 用量', 'Cache 命中率', '调用次数', '模型用量'])
})

test('从 src/agent.ts 的 UsageRecord 转估算记录：字符按估算除数折算，不是账单', () => {
  const usage = recordFromUsageRecord({ calls: 3, promptChars: 300, completionChars: 90 }, { at: '2026-10-07T00:00:00.000Z', modelId: 'm' })
  assert.equal(usage.origin, 'estimated')
  assert.equal(usage.providerReported, false)
  assert.equal(usage.inputTokens, 100)
  assert.equal(usage.outputTokens, 30)
  assert.equal(usage.requestCount, 3)
  assert.equal(usage.providerTotalTokens, null)
  assert.equal(ESTIMATED_TOKEN_CHAR_DIVISOR, 3)
  // 与本仓 agent.ts 的 estimatedTokens（除数 2）刻意不同，所以只当估算标记用。
  assert.equal(totalTokens(usage), 130)
})

test('存档：追加后可读回，落盘是窄形状 records 数组', () => {
  const storage = memoryStorage()
  const store = createAgentUsageStatsStore(storage, clock())
  store.record(record())
  assert.equal(store.list().length, 1)
  const saved = JSON.parse(storage.getItem(AGENT_USAGE_STATS_STORAGE_KEY))
  assert.deepEqual(Object.keys(saved), ['records'])
  assert.equal(saved.records.length, 1)
  assert.equal(saved.records[0].origin, 'billing')
})

test('存档：坏档永不抛 —— 非 JSON / 非对象 / records 非数组整库当空', () => {
  for (const bad of ['{oops', '[]', '"str"', '{"records":"nope"}', 'null']) {
    const store = createAgentUsageStatsStore(memoryStorage({ [AGENT_USAGE_STATS_STORAGE_KEY]: bad }), clock())
    assert.deepEqual(store.list(), [])
  }
  // 单条坏记录丢掉，好的留下。
  const storage = memoryStorage({
    [AGENT_USAGE_STATS_STORAGE_KEY]: JSON.stringify({
      records: [record(), { at: 'nope', origin: 'billing' }, { at: '2026-10-07T00:00:00.000Z', origin: 'other' }, null],
    }),
  })
  const store = createAgentUsageStatsStore(storage, clock())
  assert.equal(store.list().length, 1)
})

test('存档：缺字段补 0 / null，不是按字段数量判损坏', () => {
  const storage = memoryStorage({
    [AGENT_USAGE_STATS_STORAGE_KEY]: JSON.stringify({
      records: [{ at: '2026-10-07T00:00:00.000Z', origin: 'estimated' }],
    }),
  })
  const store = createAgentUsageStatsStore(storage, clock())
  const only = store.list()[0]
  assert.equal(only.inputTokens, 0)
  assert.equal(only.outputTokens, 0)
  assert.equal(only.providerTotalTokens, null)
  assert.equal(only.timeToFirstTokenMs, null)
  assert.equal(only.modelId, null)
  assert.equal(only.providerReported, false)
})

test('存档：超过上限淘汰 at 最旧的，读进来的超长档也裁到上限', () => {
  // 预置满库（避免逐条写 2000 次的序列化开销），再追加 5 条触发淘汰。
  const seeded = Array.from({ length: AGENT_USAGE_RECORD_LIMIT }, (_, index) =>
    record({ at: new Date(Date.parse('2026-10-01T00:00:00.000Z') + index * 1000).toISOString(), modelId: `seed${index}` }),
  )
  const storage = memoryStorage({ [AGENT_USAGE_STATS_STORAGE_KEY]: JSON.stringify({ records: seeded }) })
  const store = createAgentUsageStatsStore(storage, clock())
  for (let index = 0; index < 5; index += 1) {
    store.record(record({ at: new Date(Date.parse('2026-11-01T00:00:00.000Z') + index * 1000).toISOString(), modelId: `new${index}` }))
  }
  const kept = store.list()
  assert.equal(kept.length, AGENT_USAGE_RECORD_LIMIT)
  // 最早的 5 条走了，新的 5 条在末尾。
  assert.equal(kept[0].modelId, 'seed5')
  assert.equal(kept[kept.length - 1].modelId, 'new4')

  // 直接读一个超长档也要裁到上限。
  const oversized = memoryStorage({
    [AGENT_USAGE_STATS_STORAGE_KEY]: JSON.stringify({ records: [...seeded, ...seeded] }),
  })
  assert.equal(createAgentUsageStatsStore(oversized, clock()).list().length, AGENT_USAGE_RECORD_LIMIT)
})

test('存档：record 拒收没有 ISO at / 非法 origin 的记录', () => {
  const store = createAgentUsageStatsStore(memoryStorage(), clock())
  assert.throws(() => store.record(record({ at: '不是时间' })), TypeError)
  assert.throws(() => store.record(record({ origin: 'guess' })), TypeError)
  assert.equal(store.list().length, 0)
})

test('汇总按 origin 取数：估算与账单永不混算', () => {
  const store = createAgentUsageStatsStore(memoryStorage(), clock())
  store.record(record({ origin: 'estimated', inputTokens: 10, outputTokens: 0 }))
  store.record(record({ origin: 'billing', inputTokens: 100, outputTokens: 0 }))
  assert.equal(store.summary('estimated').totalTokens, 10)
  assert.equal(store.summary('billing').totalTokens, 100)
  assert.equal(store.summary('estimated').label, ESTIMATION_LABEL)
  assert.equal(store.summary('billing').label, BILLING_LABEL)
})

test('summaryForModel 只取该来源该模型；无记录仍是零值汇总', () => {
  const store = createAgentUsageStatsStore(memoryStorage(), clock())
  store.record(record({ origin: 'billing', modelId: 'a', inputTokens: 100, outputTokens: 0 }))
  store.record(record({ origin: 'billing', modelId: 'b', inputTokens: 7, outputTokens: 0 }))
  store.record(record({ origin: 'estimated', modelId: 'a', inputTokens: 3, outputTokens: 0 }))
  assert.equal(store.summaryForModel('billing', 'a').totalTokens, 100)
  assert.equal(store.summaryForModel('billing', 'a').label, BILLING_LABEL)
  const missing = store.summaryForModel('billing', 'nope')
  assert.equal(missing.totalTokens, 0)
  assert.equal(missing.cacheHitRate, 0)
  assert.equal(missing.avgTimeToFirstTokenMs, null)
  assert.deepEqual(missing.models, [])
})

test('clear 清空并落盘；recordUsage 走同一条追加路径', () => {
  const storage = memoryStorage()
  const store = createAgentUsageStatsStore(storage, clock())
  store.recordUsage({ calls: 1, promptChars: 30, completionChars: 6 }, { at: usageTimestamp(clock()) })
  assert.equal(store.list().length, 1)
  assert.equal(store.summary('estimated').requestCount, 1)
  store.clear()
  assert.deepEqual(store.list(), [])
  assert.equal(JSON.parse(storage.getItem(AGENT_USAGE_STATS_STORAGE_KEY)).records.length, 0)
})

test('list 返回副本：改返回值不动库', () => {
  const store = createAgentUsageStatsStore(memoryStorage(), clock())
  store.record(record({ modelId: 'keep' }))
  const first = store.list()[0]
  first.modelId = 'tampered'
  first.inputTokens = 99999
  assert.equal(store.list()[0].modelId, 'keep')
  assert.equal(store.list()[0].inputTokens, 100)
})

test('内存模式（storage=null）不抛，读写在内存里完成', () => {
  const store = createAgentUsageStatsStore(null, clock())
  store.record(record())
  assert.equal(store.list().length, 1)
  assert.equal(store.summary('billing').requestCount, 1)
})

test('localStorage 读写抛异常时退化为内存，不向上抛', () => {
  const hostile = {
    getItem: () => { throw new Error('blocked') },
    setItem: () => { throw new Error('quota') },
  }
  const store = createAgentUsageStatsStore(hostile, clock())
  assert.deepEqual(store.list(), [])
  assert.doesNotThrow(() => store.record(record()))
  assert.equal(store.list().length, 1)
})