// 后台任务队列**挂起可见性**的判据（2026-10-06 桶 status2）。
//
// 由来：`docs/batch-2026-10-06-statusbar.md` §6 记下一条零消费方的死出口
// `src/backgroundTasks.ts` 的 `runningSuspendedText`（同一次排查还查出 `currentSuspender` 也没有消费者）。
// 上游的口径是"挂起原因跟着那一行进度一起显示"，不是另开一条状态：
//   · platform/progress/shared/src/suspender/TaskSuspension.kt:24-28 —— `Suspendable(suspendText)`
//     的注释明写那句是 "a text message explaining the reason … displayed in the progress bar"；
//   · platform/platform-impl/src/com/intellij/openapi/progress/impl/TaskInfoEntityCollector.kt:174 ——
//     `TaskManager.pauseTask(task, suspender.suspendedText, TaskStatus.Source.USER)`（原因挂在任务行上）；
//   · 同文件 `:177` 的 `resumeTask` 是对称的那一半（恢复后那一行收掉）。
// 本仓的那一行就是队列的 `queueRow`，消费者是 `src/progressPanel.ts`。这里钉三件可数的事：
//   1. 队列对外只有那一份精确的键清单（死出口不许悄悄回来）；
//   2. 挂起时那一行带着原因、任务体停在 `awaitResumed()` 这个检查点上不放行；恢复后放行并把那一行收掉；
//   3. 面板只画队列拼好的那一行，不自己再拼第二套挂起文案；
//   4. （2026-10-06 status2defect 补）"**只**改挂起原因"这一件事单独钉一条：前后其余可见状态逐个不变、
//      而那一句文案真的从"不显示"变成"已挂起：<原因>"—— 钉的就是 `queueSuspendReason` 必须是响应式的
//      （`queueRow` 是 computed，原因用普通变量的话这一拍没有任何依赖变化 ⇒ 缓存留着、行永远出不来）。
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { nextTick } from 'vue'

import { createBackgroundTaskQueue } from '../src/backgroundTasks.ts'
import { POWER_SAVE_SUSPEND_REASON } from '../src/notificationPowerSave.ts'

const read = relative => readFileSync(new URL(relative, import.meta.url), 'utf8')
const settle = async () => { for (let i = 0; i < 10; i += 1) await nextTick() }

test('队列的对外状态是一份精确清单：没有零消费方的死出口', () => {
  // 上一版这里少两条（`runningSuspendedText`、`currentSuspender`），都是"写了、导出了、没人读"。
  // 深比较而不是 includes：新增一条没人消费的键也必须先在这里登记理由。
  assert.deepEqual(Object.keys(createBackgroundTaskQueue()).sort(), [
    'cancelCurrent', 'cancelCurrentAndAwait', 'cancellingTitle', 'clear', 'isEmpty', 'isSuspended',
    'queueRow', 'queuedCount', 'run', 'runningCancellable', 'runningDetail', 'runningFraction',
    'runningTitle', 'setSuspended',
  ])
  const source = read('../src/backgroundTasks.ts')
  assert.doesNotMatch(source, /const (runningSuspendedText|currentSuspender)\b/,
    '挂起状态只有一条通道（queueRow），不再对外开这两个口')
})

test('挂起时那一行带着原因（唯一通道 queueRow），任务卡在检查点上；恢复后放行并收行', async () => {
  const queue = createBackgroundTaskQueue()
  const beats = []
  // 任务先走到一个真正的耗时点（这里是 gate），再由挂起闸拦住下一个检查点：
  // `awaitResumed()` 没挂起时立刻落地（上游 `checkCanceled()` 里那句 `myLock.wait()` 的等价物只在挂起时等）。
  let proceed
  const gate = new Promise(resolve => { proceed = resolve })
  const running = queue.run({
    title: '索引',
    run: async indicator => {
      beats.push('第一段')
      await gate
      await indicator.awaitResumed()
      beats.push('第二段')
    },
  })
  await settle()
  assert.deepEqual(beats, ['第一段'], '任务应当正卡在耗时点上')
  assert.equal(queue.queueRow.value, null, '没排队、没挂起时不画队列行')

  queue.setSuspended('省电模式：代码洞察和后台任务已禁用')
  proceed()
  await settle()
  const row = queue.queueRow.value
  assert.ok(row, '挂起时队列必须补一行：正在跑的那条由各功能自己画，它不知道队列被挂起了')
  assert.equal(row.title, '后台任务队列')
  assert.match(row.detail, /^已挂起：省电模式：代码洞察和后台任务已禁用/, '原因要原样显示（上游那句 suspendText 就是给用户看的）')
  assert.match(row.detail, /正在跑的那条会在下一个检查点让路/, '没有排队任务时不能写成"还有 0 个排队中"，也不能说成"已经停住了"')
  assert.deepEqual(beats, ['第一段'], '挂起期间 awaitResumed() 不放行')

  queue.setSuspended(null)
  await settle()
  assert.deepEqual(beats, ['第一段', '第二段'], '恢复后任务走到下一个耗时点')
  assert.equal(queue.queueRow.value, null, '恢复后那一行收掉（上游 resumeTask 的对称面）')
  await running
})

test('挂起这一行只有一个拼装点：面板只画，不另拼一套文案', () => {
  const panel = read('../src/progressPanel.ts')
  const source = read('../src/backgroundTasks.ts')
  assert.match(panel, /backgroundTaskQueue\.queueRow\.value/, '面板要读队列那一行')
  assert.doesNotMatch(panel, /已挂起/, '「已挂起：…」这句只在队列里拼一次，面板不能自己再拼一套')
  assert.match(source, /`已挂起：/, '那句正文（含原因）在队列的 queueRow 里拼')
})

test('只改挂起原因这一件事：那一行的文案必须真的更新（响应式判据）', async () => {
  // 上一条用例把两件事混在一起了（挂起之后还 `proceed()` 放行任务体），钉不住"**只有**原因变了"；
  // 而这条缺陷的形态恰恰是：`queueRow` 是 computed，挂起原因若是普通变量，改原因那一拍没有依赖变化
  // ⇒ computed 不失效 ⇒ 「已挂起」那一行永远出不来（2026-10-06 桶 status2 实测过的那一条）。
  // 上游依据：挂起原因是**显示**在进度那一行上的文案，不是另开一条状态
  //   · platform/progress/shared/src/suspender/TaskSuspension.kt:24-25 —— suspendText 的注释
  //     "a text message explaining the reason for the suspension, which is displayed in the progress bar"；
  //   · platform/platform-impl/src/com/intellij/openapi/progress/impl/ProgressSuspender.java:121 ——
  //     `suspendProcess(reason)` 的 javadoc："if provided, is displayed in the UI …"；
  //   · platform/platform-impl/src/com/intellij/openapi/progress/impl/TaskInfoEntityCollector.kt:174,177 ——
  //     `pauseTask(task, suspender.suspendedText, Source.USER)` / 对称的 `resumeTask`（挂起→有那一行、恢复→收那一行）。
  // 这里给的理由用**真常量** `POWER_SAVE_SUSPEND_REASON`（= `src/notificationPowerSave.ts:48` 那句通知正文），
  // 不另编一句话；本仓唯一的生产触发点就是它（`src/notifications.ts:298`）。
  const queue = createBackgroundTaskQueue()
  let proceed
  const gate = new Promise(resolve => { proceed = resolve })
  const running = queue.run({
    title: '索引',
    // 任务体停在 gate 上：整条用例期间它一步都没走 ⇒ 它既不是响应式依赖，也不会顺带改到别的状态。
    run: async indicator => { await gate; await indicator.awaitResumed() },
  })
  await settle()

  // 队列"除挂起原因之外"的全部可见状态，逐个取一份快照。
  const visible = () => ({
    runningTitle: queue.runningTitle.value,
    runningDetail: queue.runningDetail.value,
    runningFraction: queue.runningFraction.value,
    runningCancellable: queue.runningCancellable.value,
    queuedCount: queue.queuedCount.value,
    cancellingTitle: queue.cancellingTitle.value,
  })
  const before = visible()
  assert.deepEqual(before, {
    runningTitle: '索引', runningDetail: '', runningFraction: null,
    runningCancellable: true, queuedCount: 0, cancellingTitle: '',
  }, '前置状态：有一条正在跑的任务、没有排队、没有取消中间态')

  // ① 没有挂起原因时，那一行不显示（读一次把 computed 的依赖集与缓存都建立起来）。
  assert.equal(queue.queueRow.value, null, '没挂起、没排队时不画队列行')

  // ② 只改挂起原因：除了它，可见状态一个都不许变。
  queue.setSuspended(POWER_SAVE_SUSPEND_REASON)
  assert.deepEqual(visible(), before, '这一步只该动挂起原因，别的一个都没变')
  assert.equal(queue.isSuspended(), true)
  const row = queue.queueRow.value
  assert.ok(row, '挂起时队列必须补一行（改原因必须让 computed 失效）')
  assert.equal(row.title, '后台任务队列')
  assert.equal(row.detail, `已挂起：${POWER_SAVE_SUSPEND_REASON}（正在跑的那条会在下一个检查点让路）`,
    '整句钉死：原因原样出现在那一行里，且没人排队时说的是"会在下一个检查点让路"')

  // ③ 恢复（原因回到 null）是那一句的对称面：那一行收掉。
  queue.setSuspended(null)
  assert.deepEqual(visible(), before, '恢复也只该动挂起原因')
  assert.equal(queue.isSuspended(), false)
  assert.equal(queue.queueRow.value, null, '恢复后那一行收掉')

  proceed()
  await running
})
