// `src/backgroundTasks.ts` 的判据：后台任务队列（`BackgroundTaskQueue` 的串行语义）
// 与进度指示模型（`ProgressIndicatorModel` 的 text/fraction/取消）。
//
// 上游依据：
//   · BackgroundTaskQueue.java:36-45 — 任务一个一个跑（串行），队列有 title，isEmpty/clear 是查询面；
//   · ProgressIndicatorModel.kt:34-59 — setText/setFraction，带 onCancel 的构造器在 cancel 时先调它；
//   · TaskCancellation — 不可取消的任务 cancel() 不生效。

import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { nextTick } from 'vue'

import { BackgroundTaskCancelled, createBackgroundTaskQueue } from '../src/backgroundTasks.ts'

const settle = async () => { for (let i = 0; i < 8; i += 1) await nextTick() }

test('串行：第二个任务在第一个结束前不会开始；排队计数与队列行跟着变', async () => {
  const queue = createBackgroundTaskQueue()
  const events = []
  let release
  const first = queue.run({ title: '一', run: async () => { events.push('start1'); await new Promise(resolve => { release = resolve }); events.push('end1') } })
  const second = queue.run({ title: '二', run: () => { events.push('start2') } })
  await settle()
  assert.deepEqual(events, ['start1'])
  assert.equal(queue.queuedCount.value, 1, '第二条应当还在排队')
  assert.ok(queue.queueRow.value, '有排队时面板要有一行')
  assert.match(queue.queueRow.value.detail, /还有 1 个任务排队中（下一个：二）/)
  assert.equal(queue.isEmpty(), false)
  release(); await first; await second; await settle()
  assert.deepEqual(events, ['start1', 'end1', 'start2'])
  assert.equal(queue.queuedCount.value, 0)
  assert.equal(queue.queueRow.value, null, '没人排队时不画队列行')
  assert.equal(queue.isEmpty(), true)
})

test('取消正在跑的任务：onCancel 被调用，checkCanceled 抛错，后面的任务继续', async () => {
  const queue = createBackgroundTaskQueue()
  const events = []
  let cancelled = 0
  const running = queue.run({
    title: '可取消',
    onCancel: () => { cancelled += 1 },
    run: async indicator => {
      await new Promise(resolve => setTimeout(resolve, 5))
      indicator.checkCanceled()
      events.push('不该到这里')
    },
  })
  const after = queue.run({ title: '后继', run: () => { events.push('后继跑了') } })
  await settle()
  queue.cancelCurrent()
  assert.equal(cancelled, 1, 'ProgressIndicatorModel 的 onCancel 要先调')
  await running
  await after
  assert.deepEqual(events, ['后继跑了'], '被取消的任务中断，队列继续')
})

test('不可取消的任务：cancel() 什么都不做', async () => {
  const queue = createBackgroundTaskQueue()
  let cancelled = 0
  let release
  const running = queue.run({
    title: '不可取消', cancellable: false,
    onCancel: () => { cancelled += 1 },
    run: async indicator => { await new Promise(resolve => { release = resolve }); assert.equal(indicator.cancelled, false) },
  })
  await settle()
  queue.cancelCurrent()
  assert.equal(cancelled, 0)
  release(); await running
})

test('clear 丢掉未跑的任务（它们的 promise 也结束），正在跑的不受影响', async () => {
  const queue = createBackgroundTaskQueue()
  const events = []
  let release
  const running = queue.run({ title: '跑着', run: async () => { events.push('跑着开始'); await new Promise(resolve => { release = resolve }) } })
  let pendingStarted = false
  const pending = queue.run({ title: '排队', run: () => { pendingStarted = true } })
  await settle()
  queue.clear()
  await pending
  assert.equal(pendingStarted, false, 'clear 之后排队的任务不能开始')
  assert.equal(queue.queuedCount.value, 0)
  release(); await running
  assert.deepEqual(events, ['跑着开始'])
})

test('指示模型：setText/setFraction/setIndeterminate 反映到队列状态；fraction 会被夹到 0..1', async () => {
  const queue = createBackgroundTaskQueue()
  let release
  const task = queue.run({
    title: '带进度',
    cancellable: true,
    run: async indicator => {
      indicator.setText('读文件')
      indicator.setFraction(0.5)
      await new Promise(resolve => { release = resolve })
    },
  })
  await settle()
  assert.equal(queue.runningTitle.value, '带进度')
  assert.equal(queue.runningDetail.value, '读文件')
  assert.equal(queue.runningFraction.value, 0.5)
  assert.equal(queue.runningCancellable.value, true)
  release(); await task
  assert.equal(queue.runningTitle.value, '')
  // 夹取：超出范围与 NaN 都不许写进 progress 条。
  const seen = []
  await createBackgroundTaskQueue().run({
    title: '夹',
    run: indicator => {
      indicator.setFraction(3); seen.push(indicator.fraction)
      indicator.setFraction(Number.NaN); seen.push(indicator.fraction)
      indicator.setIndeterminate(); seen.push(indicator.fraction)
    },
  })
  assert.deepEqual(seen, [1, 0, null])
})

test('checkCanceled 在取消后抛出可识别的 BackgroundTaskCancelled', async () => {
  const queue = createBackgroundTaskQueue()
  let seen = null
  let release
  const task = queue.run({
    title: '中断点',
    run: async indicator => {
      await new Promise(resolve => { release = resolve })
      try { indicator.checkCanceled() } catch (error) { seen = error }
    },
  })
  await settle()
  queue.cancelCurrent()
  release()
  await task
  assert.ok(seen instanceof BackgroundTaskCancelled)
})

test('消费链：进度面板画队列深度行，取消按钮接到队列', () => {
  const panel = readFileSync(new URL('../src/progressPanel.ts', import.meta.url), 'utf8')
  assert.match(panel, /backgroundTaskQueue\.queueRow\.value/, '面板要读队列那一行')
  assert.match(panel, /backgroundTaskQueue\.cancelCurrentAndAwait\(\)/,
    '取消走队列的 indicator 取消回调（协作式取消：按下去之后还要**等任务体真的收尾**，见 src/backgroundTasks.ts 的 cancelCurrentAndAwait）')
  assert.match(panel, /else if \(target === 'background'\)/, '取消目标要有 background 这一档')
})
