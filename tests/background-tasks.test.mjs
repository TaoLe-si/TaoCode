// `src/backgroundTasks.ts` 的判据：后台任务队列（`BackgroundTaskQueue` 的串行语义）
// 与进度指示模型（`ProgressIndicatorModel` 的 text/fraction/取消）。
//
// 上游依据（2026-10-06 progflow 重开源码数过行号；原来写的两处坐标是漂的）：
//   · `platform/platform-impl/src/com/intellij/openapi/progress/BackgroundTaskQueue.java:26`
//     「Runs backgroundable tasks one by one」+ 那条 `QueueProcessor`（`:43-46`）= 串行；
//     `clear()` 在 `:49-51`、`isEmpty()` 在 `:53-55`（原写 `:62-64`/`:66-68` 是错的）；
//   · `platform/platform-impl/src/com/intellij/openapi/progress/ProgressIndicatorModel.kt:39-49`
//     = setFraction/setText，`:25-37` = 带 `onCancel` 的构造器（`:33` 先调回调、`:34` 才真取消）；
//   · `TaskCancellation` 的不可取消档（`:23` `nonCancellable()`、`:92` `isCancellable()`）：
//     不可取消的任务取消不该生效。
//
// 队列对外面包（2026-10-06 progflow）：`runningTitle`/`runningDetail`/`runningFraction`/
// `runningCancellable`/`queuedCount`/`cancellingTitle`/`cancelCurrent` 七条零生产消费者的出口已删，
// 正在跑那条的状态只剩 `queueRow` 一个出口（键清单由 `tests/progress-queue-suspend.test.mjs` 钉死）。

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
  // 排队计数只有 `queueRow` 那一句出口（`queuedCount` 那条扁平 ref 是"只过自己测试的死出口"，已删）。
  assert.match(queue.queueRow.value.detail, /^还有 1 个任务排队中（下一个：二）/)
  // 正在跑的那条可取消 ⇒ 这一行给得出取消按钮（`ProgressIndicatorModel.kt:92` 那一档）。
  assert.equal(queue.queueRow.value.cancellable, true)
  assert.equal(queue.isEmpty(), false)
  release(); await first; await second; await settle()
  assert.deepEqual(events, ['start1', 'end1', 'start2'])
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
  assert.equal(await queue.cancelCurrentAndAwait(), true, '任务体走到了检查点')
  assert.equal(cancelled, 1, 'ProgressIndicatorModel 的 onCancel 要先调')
  await running
  await after
  assert.deepEqual(events, ['后继跑了'], '被取消的任务中断，队列继续')
})

test('不可取消的任务：cancel() 什么都不做，那一行也不给取消按钮（:23/:92 那一档）', async () => {
  const queue = createBackgroundTaskQueue()
  let cancelled = 0
  let release
  const running = queue.run({
    title: '不可取消', cancellable: false,
    onCancel: () => { cancelled += 1 },
    run: async indicator => { await new Promise(resolve => { release = resolve }); assert.equal(indicator.cancelled, false) },
  })
  // 第二条排队 ⇒ `queueRow` 出现（没排队时队列不画这一行，正在跑的那条自己的行由各功能承担）。
  const after = queue.run({ title: '后继', run: () => {} })
  await settle()
  assert.equal(queue.queueRow.value.cancellable, false,
    '不可取消档不发取消按钮（上游同一判据：InfoAndProgressPanel.kt:753 按 task.isCancellable() 画）')
  assert.equal(await queue.cancelCurrentAndAwait(10), false, '按下去不该让它收尾：cancel() 是空操作')
  assert.equal(cancelled, 0)
  release(); await running; await after
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
  assert.equal(queue.queueRow.value, null, '排队清空后这一行不再出现')
  release(); await running
  assert.deepEqual(events, ['跑着开始'])
})

test('指示模型：setText/setFraction/setIndeterminate 落在任务自己的指示器上；fraction 会被夹到 0..1', async () => {
  const queue = createBackgroundTaskQueue()
  let release
  const seen = []
  const task = queue.run({
    title: '带进度',
    cancellable: true,
    run: async indicator => {
      indicator.setText('读文件')
      indicator.setFraction(0.5)
      seen.push([indicator.title, indicator.text, indicator.fraction, indicator.cancellable, indicator.cancelled])
      await new Promise(resolve => { release = resolve })
    },
  })
  const waiting = queue.run({ title: '后继', run: () => {} })
  await settle()
  assert.deepEqual(seen, [['带进度', '读文件', 0.5, true, false]],
    'text/fraction 的写入面就是 ProgressIndicatorModel 的那两个 setter')
  const row = queue.queueRow.value
  assert.equal(row.percent, null,
    '队列那一行**不编百分比**：拿不到总量就是不确定式（上游 `total <= 0 ⇒ setIndeterminate(true)` 同口径）')
  assert.equal(row.cancellable, true)
  release(); await task; await waiting
  // 夹取：超出范围与 NaN 都不许写进 progress 条。
  const clamped = []
  await createBackgroundTaskQueue().run({
    title: '夹',
    run: indicator => {
      indicator.setFraction(3); clamped.push(indicator.fraction)
      indicator.setFraction(Number.NaN); clamped.push(indicator.fraction)
      indicator.setIndeterminate(); clamped.push(indicator.fraction)
    },
  })
  assert.deepEqual(clamped, [1, 0, null])
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
  const awaited = queue.cancelCurrentAndAwait(50)
  release()
  await task
  assert.equal(await awaited, true)
  assert.ok(seen instanceof BackgroundTaskCancelled)
})

test('消费链：进度面板画队列那一行，取消按钮接到队列', () => {
  const panel = readFileSync(new URL('../src/progressPanel.ts', import.meta.url), 'utf8')
  assert.match(panel, /backgroundTaskQueue\.queueRow\.value/, '面板要读队列那一行')
  assert.match(panel, /backgroundTaskQueue\.cancelCurrentAndAwait\(\)/,
    '取消走队列的 indicator 取消回调（协作式取消：按下去之后还要**等任务体真的收尾**，见 src/backgroundTasks.ts 的 cancelCurrentAndAwait）')
  assert.match(panel, /else if \(target === 'background'\)/, '取消目标要有 background 这一档')
})
