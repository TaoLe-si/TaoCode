// 取消的「等收尾」那一段 —— 上游 `ProgressIndicatorUtils.withTimeout`
// （`platform/ide-core-impl/src/com/intellij/openapi/progress/util/ProgressIndicatorUtils.java:310-341`，
// 到点只把指示器取消、由计算自己停在 ProcessCanceledException 上）与
// `awaitWithCheckCanceled`（同文件 `:357-395`，等的时候仍然听取消）的 DOM 等价物：
// `backgroundTaskQueue.cancelCurrentAndAwait()`。消费方是 `src/progressPanel.ts` 的那颗「取消」按钮。
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

import {
  BackgroundTaskCancelled, CANCEL_WAIT_TIMEOUT_MS, createBackgroundTaskQueue,
} from '../src/backgroundTasks.ts'

function read(path) {
  return readFileSync(new URL(path, import.meta.url), 'utf8')
}

const tick = (ms = 0) => new Promise(resolve => { setTimeout(resolve, ms) })

test('取消是协作式的：任务体走到下一个 checkCanceled 才算收尾', async () => {
  const queue = createBackgroundTaskQueue()
  let reachedEnd = false
  void queue.run({
    title: '慢任务',
    run: async indicator => {
      await tick(10)
      indicator.checkCanceled()   // 这里抛 BackgroundTaskCancelled
      reachedEnd = true
    },
  })
  await tick(0)
  assert.equal(queue.cancellingTitle.value, '', '没点取消时不该有中间态')
  const done = queue.cancelCurrentAndAwait()
  assert.equal(queue.cancellingTitle.value, '慢任务', '按下去到收尾之间面板要有一行「正在取消」')
  assert.match(queue.queueRow.value.detail, /正在取消：慢任务/)
  assert.equal(await done, true, '任务在超时前停了就该返回 true')
  assert.equal(queue.cancellingTitle.value, '', '收尾后那一行必须消失')
  assert.equal(reachedEnd, false, '取消检查点之后的代码不该再跑')
  assert.equal(queue.isEmpty(), true)
})

test('任务不理取消：等到超时返回 false，那一行留着，直到它真的结束才收', async () => {
  const queue = createBackgroundTaskQueue()
  let finished = false
  void queue.run({
    title: 'Stubborn',
    cancellable: true,
    // 故意跑得比超时档长得多：并行跑整个测试目录时事件循环会被别的用例拖住，
    // 这里靠"300 毫秒 vs 20 毫秒"这个比例活下来，而不是靠掐表。
    run: async () => { await tick(300); finished = true },
  })
  await tick(0)
  const started = Date.now()
  const done = await queue.cancelCurrentAndAwait(20)
  assert.equal(done, false, '任务体不检查取消时不该谎称已经取消')
  assert.ok(Date.now() - started < 250, '超时就该先返回，不等任务跑完')
  assert.equal(queue.cancellingTitle.value, 'Stubborn', '它还在跑，这一行不能凭空消失')
  await tick(450)
  assert.equal(finished, true)
  assert.equal(queue.cancellingTitle.value, '', '真的收尾后要把「正在取消」收掉')
})

test('没有正在跑的任务时取消是空操作，等到的是"已完成"', async () => {
  const queue = createBackgroundTaskQueue()
  assert.equal(await queue.cancelCurrentAndAwait(5), true)
  assert.equal(queue.cancellingTitle.value, '')
})

test('取消回调照旧只调一次，队列继续往下走', async () => {
  const queue = createBackgroundTaskQueue()
  let cancels = 0
  void queue.run({ title: 'A', onCancel: () => { cancels += 1 }, run: async indicator => { await tick(10); indicator.checkCanceled() } })
  await tick(0)
  await queue.cancelCurrentAndAwait(50)
  assert.equal(cancels, 1, '取消回调被重复触发')
  void queue.run({ title: 'B', run: async () => { await tick(30) } })
  await tick(0)
  assert.equal(queue.isEmpty(), false)
  await tick(50)
  assert.equal(queue.isEmpty(), true, '第一条被取消后队列没有继续跑第二条')
})

test('超时档是模块常数，面板接的是等收尾的那条路', () => {
  assert.equal(typeof CANCEL_WAIT_TIMEOUT_MS, 'number')
  assert.ok(CANCEL_WAIT_TIMEOUT_MS > 0)
  assert.equal(BackgroundTaskCancelled.name, 'BackgroundTaskCancelled')
  const panel = read('../src/progressPanel.ts')
  assert.match(panel, /cancelCurrentAndAwait\(\)/, '面板还在用不等收尾的 cancelCurrent')
  assert.match(panel, /没有响应取消/, '等不到收尾时必须给用户一句真话')
  assert.doesNotMatch(panel, /cancelCurrent\(\)/, '面板不该留两条取消路径（一条等、一条不等）')
})
