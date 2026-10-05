// 语言服务导入期的重试规则（`src/lspWarmup.ts`）。
//
// 规则来自真机取证：AE2 上 JDT 导入要 9.5 分钟，期间 `documentSymbol`/`semanticTokens` 一律
// 60 秒超时；调用方只发一次、失败被吞，于是导入完成后文件仍无颜色、结构面板仍空。
// 这些用例用假时钟把整条退避序列跑完，钉住四条性质：只在失败时重试、退避档固定、
// 成功即停（含撤掉在途重试）、cancel 之后不再回调。
import test from 'node:test'
import assert from 'node:assert/strict'
import { LspWarmup, WARMUP_DELAYS_MS } from '../src/lspWarmup.ts'

/** 可控时钟：`advance` 只跑到期的定时器。 */
function fakeClock() {
  let now = 0
  let nextHandle = 1
  const timers = new Map()
  return {
    now: () => now,
    setTimeout: (handler, ms) => { const handle = nextHandle++; timers.set(handle, { at: now + ms, handler }); return handle },
    clearTimeout: handle => { timers.delete(handle) },
    async advance(ms) {
      const target = now + ms
      for (;;) {
        const due = [...timers.entries()].filter(([, timer]) => timer.at <= target).sort((a, b) => a[1].at - b[1].at)[0]
        if (!due) break
        timers.delete(due[0])
        now = due[1].at
        due[1].handler()
        await Promise.resolve()   // 让 await 链推进
        await Promise.resolve()
      }
      now = target
      await Promise.resolve()
    },
  }
}

test('第一次就成功：不排重试、只有一次尝试', async () => {
  const clock = fakeClock()
  const runs = []
  const warmup = new LspWarmup({ run: ({ attempt }) => { runs.push(attempt); return true }, ...clock })
  warmup.start()
  await clock.advance(0)
  assert.deepEqual(runs, [1])
  assert.equal(warmup.pending, false)
  assert.equal(warmup.tries, 0)
})

test('失败才重试：退避档是 10s/20s/40s/80s/160s，五次之后放弃', async () => {
  const clock = fakeClock()
  const stamps = []
  const giveUps = []
  const warmup = new LspWarmup({
    run: () => { stamps.push(clock.now()); return false },
    onGiveUp: (reason, lastError) => giveUps.push([reason, lastError]),
    ...clock,
  })
  warmup.start()
  await clock.advance(0)
  await clock.advance(400_000)
  assert.equal(stamps.length, WARMUP_DELAYS_MS.length + 1, '首跑 + 五档重试 = 6 次')
  assert.deepEqual(stamps.slice(1), [10_000, 30_000, 70_000, 150_000, 310_000])
  assert.deepEqual(giveUps, [['exhausted', '']])
  assert.equal(warmup.pending, false)
})

test('中途成功即停：撤掉在途重试，不再有请求', async () => {
  const clock = fakeClock()
  let calls = 0
  const successes = []
  const warmup = new LspWarmup({
    run: () => { calls += 1; return calls >= 3 },
    onSuccess: attempt => successes.push(attempt),
    ...clock,
  })
  warmup.start()
  await clock.advance(0)
  await clock.advance(30_000)
  assert.equal(calls, 3)
  assert.deepEqual(successes, [3])
  assert.equal(warmup.pending, false, '成功后不该再有计划')
  await clock.advance(400_000)
  assert.equal(calls, 3, '成功后再怎么等也不该再发请求')
})

test('异常也算失败（错误消息进 lastError），且 cancel 之后不再回调', async () => {
  const clock = fakeClock()
  const errors = []
  let calls = 0
  const warmup = new LspWarmup({
    run: ({ lastError }) => { calls += 1; errors.push(lastError); throw new Error(`TIMEOUT ${calls}`) },
    onGiveUp: reason => errors.push(`giveup:${reason}`),
    ...clock,
  })
  warmup.start()
  await clock.advance(0)
  assert.deepEqual(errors, [''])
  await clock.advance(10_000)
  assert.deepEqual(errors.slice(1), ['TIMEOUT 1'])
  warmup.cancel()
  await clock.advance(400_000)
  assert.equal(calls, 2, 'cancel 后不该再发请求')
  assert.ok(!errors.some(value => String(value).startsWith('giveup')), '取消不算 exhausted')
})

test('重复 start 会先取消上一次计划（同一文件重新调度）', async () => {
  const clock = fakeClock()
  let calls = 0
  const warmup = new LspWarmup({ run: () => { calls += 1; return false }, ...clock })
  warmup.start()
  await clock.advance(0)
  await clock.advance(5_000)
  warmup.start()          // 5 秒后又调了一次
  await clock.advance(0)
  assert.equal(calls, 2)
  await clock.advance(10_000)   // 只应触发**第二次** start 排的那个计划
  assert.equal(calls, 3)
})
