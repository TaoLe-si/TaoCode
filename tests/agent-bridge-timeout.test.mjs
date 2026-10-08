// `agent/bridge-timeout` 判据：宿主文件桥的等待上限。
//
// 起因（交接件 §四.1，真实故障）：真机上对着 untitled 示例项目发一条消息，面板 `busy` 永久卡在
// true、`messages` 停在 0 —— 一次 `await file.read` 不返回，审批门之后每一段都在等它。
// 所以这里钉住三件事：超时**如实收场**而不是抛、收场的值就是调用方要的「读不到」、
// 以及计时器在两条路上都被清掉（挂着不清会让 Node 进程退不出去）。
import test from 'node:test'
import assert from 'node:assert/strict'
import { AGENT_BRIDGE_TIMEOUT_MS, withBridgeTimeout } from '../src/agentBridgeTimeout.ts'

test('上限是个具体数字（不许写成 Infinity 或省略 —— 省略就没有兜底可言）', () => {
  assert.equal(typeof AGENT_BRIDGE_TIMEOUT_MS, 'number')
  assert.ok(Number.isFinite(AGENT_BRIDGE_TIMEOUT_MS), '不能是 Infinity')
  assert.ok(AGENT_BRIDGE_TIMEOUT_MS >= 1_000 && AGENT_BRIDGE_TIMEOUT_MS <= 30_000,
    `上限要在 1s..30s 之间，实际 ${AGENT_BRIDGE_TIMEOUT_MS}`)
})

test('真值先到：拿真值，超时回调一次都不该被调用', async () => {
  let called = 0
  const got = await withBridgeTimeout(Promise.resolve('ok'), () => { called += 1; return 'late' }, 50)
  assert.equal(got, 'ok')
  assert.equal(called, 0, '按时返回了就不该再走超时那一支')
})

test('永不返回的 Promise：到点按 onTimeout 收场，而不是把 await 悬死', async () => {
  const started = Date.now()
  // 一个永远 pending 的 Promise —— 这正是真机上 `file.read` 挂起时的形状。
  const got = await withBridgeTimeout(new Promise(() => {}), () => 'timeout-value', 20)
  assert.equal(got, 'timeout-value', '收场的值就是调用方要的那个结论')
  assert.ok(Date.now() - started < 5_000, '到点就收场，不许等到天荒地老')
})

test('慢但会返回：慢到超过上限时收超时（宁可说「读不到」，也不让面板卡住）', async () => {
  const slow = new Promise(resolve => { setTimeout(() => resolve('slow'), 200) })
  assert.equal(await withBridgeTimeout(slow, () => 'timeout-value', 20), 'timeout-value')
})

test('reject 也如实往外抛：这一层只管时限，不管错误语义', async () => {
  await assert.rejects(
    () => withBridgeTimeout(Promise.reject(new Error('宿主拒绝')), () => 'timeout-value', 50),
    /宿主拒绝/,
    '失败不能被超时兜底吞成「读不到」—— 那是两种不同的病',
  )
})

test('计时器在两条路上都被清掉（挂着不清会让 Node 进程退不出去）', async () => {
  const before = process.getActiveResourcesInfo().filter(kind => kind === 'Timeout').length
  await withBridgeTimeout(Promise.resolve(1), () => 2, 60_000)
  await withBridgeTimeout(new Promise(() => {}), () => 3, 5)
  // 给已触发的那个宏任务一拍，让 clearTimeout 有机会生效。
  await new Promise(resolve => { setTimeout(resolve, 5) })
  const after = process.getActiveResourcesInfo().filter(kind => kind === 'Timeout').length
  assert.ok(after <= before + 1,
    `长上限那条必须被清掉：调用前 ${before} 个 Timeout 句柄、调用后 ${after} 个`)
})