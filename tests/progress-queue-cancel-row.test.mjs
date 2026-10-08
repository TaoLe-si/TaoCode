// 后台任务队列那一行的**取消出口**（2026-10-06 progflow）。
//
// 缺陷形状（`docs/batch-2026-10-06-msgaudit.md` §2 的 B1，逐条在磁盘上重验过）：
//   · `src/progressPanel.ts` 给队列那一行写死 `cancellable: false` ⇒ `cancelBackgroundTask` 的
//     `'background'` 分支（里面那条 `cancelCurrentAndAwait()` + 等不到收尾时那句真话）**没有任何发出点**；
//   · `src/backgroundTasks.ts` 同时开着 `runningTitle`/`runningDetail`/`runningFraction`/
//     `runningCancellable`/`queuedCount`/`cancellingTitle`/`cancelCurrent` 七条零生产消费者的出口
//     （审计还点到早先删掉的 `runningSuspendedText`，本轮实测它确实已经不在了）。
// 两条一起收：那一行的可取消档由队列给（`queueRow.cancellable`），面板把它翻成 `'background'`；
// 上面那七条出口删掉，状态只剩 `queueRow` 一个通道。
//
// 上游依据（本轮逐条开文件数过行号）：
//   · 行上的取消按钮按**这条任务自己的**可取消档画：
//     `platform/platform-impl/src/com/intellij/openapi/wm/impl/status/InfoAndProgressPanel.kt:753`
//     （`cancelButton.setPainting(task.isCancellable())`）与 `:876`（`info.isCancellable() && !isStopping`）；
//   · 点下去打的是这条任务自己的 cancel：同文件 `:964`（`original!!.cancel()`），
//     取消回调由 `ProgressIndicatorModel.kt:32-34` 那个委托先调；
//   · 可取消那档的定义在 `ProgressIndicatorModel.kt:92`，不可取消那档是 `:23` 的 `nonCancellable()`；
//   · 挂起中的任务被取消时先放行再停：`ProgressSuspender.java:55-61` 的 `cancelled()` 监听。
// 本仓**不给**正在跑那条任务再开第二行：它的标题/进度由 producer 自己的行承担（Gradle 那一行、
// 检查那一行…），队列行只说"排队中 / 被挂起 / 正在取消"这三件只有队列知道的事。
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { nextTick } from 'vue'

import { backgroundTaskQueue } from '../src/backgroundTasks.ts'
import { createProgressPanel } from '../src/progressPanel.ts'
import { POWER_SAVE_SUSPEND_REASON } from '../src/notificationPowerSave.ts'

const settle = async () => { for (let i = 0; i < 12; i += 1) await nextTick() }
const read = relative => readFileSync(new URL(relative, import.meta.url), 'utf8')

/** 最小宿主上下文：面板只需要这几个惰性 getter（同 `tests/progress-task-cancel.test.mjs` 的形状）。 */
function mountPanel(overrides = {}) {
  return createProgressPanel({
    gitProgress: () => ({ running: false, queued: 0 }),
    cloneProgress: () => [],
    cancelling: () => false,
    runState: () => ({ running: false }),
    gradleSync: () => ({ running: false, command: '', startedAt: 0, output: '' }),
    lspProgress: () => [],
    autoShowPopup: () => false,
    notify: () => {},
    ...overrides,
  })
}

/** 单例队列的复位（用例之间不能互相留任务；心跳也要停表）。 */
const releaseQueue = async () => {
  backgroundTaskQueue.setSuspended(null)
  backgroundTaskQueue.clear()
  await settle()
  // 面板的心跳是**只在有任务时**开着的 setInterval；任务清空后那个 watch 要下一拍才停。
  await new Promise(resolve => { setTimeout(resolve, 0) })
}

const queueRowOf = panel => panel.backgroundTasks.value.find(row => row.title === '后台任务队列')

test('队列那一行的取消按钮接到正在跑的那条任务（「background」那一档终于有发出点）', async () => {
  const panel = mountPanel()
  let cancelled = 0
  let release
  try {
    const running = backgroundTaskQueue.run({
      title: '同步 Gradle 项目更改',
      onCancel: () => { cancelled += 1 },
      run: async indicator => {
        await new Promise(resolve => { release = resolve })
        indicator.checkCanceled() // 取消后这一句要抛，不该往下走
      },
    })
    const after = backgroundTaskQueue.run({ title: '第二条', run: () => {} })
    await settle()

    const row = queueRowOf(panel)
    assert.ok(row, '有人排队时队列那一行必须在面板里')
    assert.equal(row.cancellable, 'background', '按钮带的是队列那一档，不是 git/gradle 那类宿主请求')
    panel.cancelProgressRow(row)
    assert.equal(cancelled, 1, '点下去真的调到了那条任务自己的 onCancel（ProgressIndicatorModel.kt:33）')

    release()
    await running
    await after
    assert.equal(queueRowOf(panel), undefined, '队列空了那一行就该消失')
  } finally {
    release?.()
    await releaseQueue()
  }
})

test('不可取消档不发按钮：那一行的 cancellable 跟着任务自己的档位（:23/:92）', async () => {
  const panel = mountPanel()
  let cancelled = 0
  let release
  try {
    const running = backgroundTaskQueue.run({
      title: '不可取消的那条', cancellable: false,
      onCancel: () => { cancelled += 1 },
      run: async indicator => { await new Promise(resolve => { release = resolve }); assert.equal(indicator.cancelled, false) },
    })
    const after = backgroundTaskQueue.run({ title: '排队的第二条', run: () => {} })
    await settle()

    const row = queueRowOf(panel)
    assert.ok(row, '有排队时那一行仍然要出现（挂着的深度是用户要看见的）')
    assert.equal(row.cancellable, false, '不可取消那档不给按钮 —— 不给点不动的假控件')
    panel.cancelProgressRow(row) // 没有 cancellable 就什么都不会发生
    assert.equal(cancelled, 0)

    release()
    await running
    await after
  } finally {
    release?.()
    await releaseQueue()
  }
})

test('正在跑的那条**不开第二行**：标题与进度由 producer 自己的行承担', async () => {
  // 这条钉的是"不重复画"的不变量：面板里同一个操作出现两行（一行 Gradle 进程、一行队列任务）
  // 就是两个取消按钮指向同一件事，那是假控件的另一面。所以 `queueRow` 只在排队/挂起/取消时出现。
  const gradleRow = { running: true, command: 'gradlew projects tasks', startedAt: Date.now(), output: '' }
  const panel = mountPanel({ gradleSync: () => gradleRow })
  let release
  try {
    const running = backgroundTaskQueue.run({
      title: '同步 Gradle 项目更改',
      run: async () => { await new Promise(resolve => { release = resolve }) },
    })
    await settle()
    assert.equal(queueRowOf(panel), undefined, '没排队、没挂起、没取消时队列不画这一行')
    assert.equal(panel.backgroundTasks.value.filter(row => row.title === '正在同步 Gradle 项目').length, 1,
      '这个操作只有 producer 那一行')
    release()
    await running
  } finally {
    release?.()
    await releaseQueue()
  }
})

test('省电模式挂起时那颗取消按钮真能让任务体走出来（cancel 先 resume 再取消）', async () => {
  // 上游 `ProgressSuspender.java:55-61`：给指示器装的 `cancelled()` 监听先 `resumeProcess()` ——
  // 卡在自己等待里的任务被取消时必须让它走下去，不然它永远收不了尾（本仓 `Indicator.cancel()` 同形）。
  const panel = mountPanel()
  let proceed
  const gate = new Promise(resolve => { proceed = resolve })
  let cancelled = 0
  let wokeUp = false
  let walkedPast = false
  try {
    const running = backgroundTaskQueue.run({
      title: '索引',
      onCancel: () => { cancelled += 1 },
      run: async indicator => {
        await gate                      // 先进一个耗时点
        await indicator.awaitResumed()  // 挂起就卡在这一句
        wokeUp = true                   // 从等待里出来了（这一步才是"取消把任务放回来"）
        indicator.checkCanceled()       // 这一句要抛 BackgroundTaskCancelled
        walkedPast = true               // 抛了就不该到这里
      },
    })
    await settle()
    backgroundTaskQueue.setSuspended(POWER_SAVE_SUSPEND_REASON)
    proceed()
    await settle()
    assert.equal(wokeUp, false, '前置：挂起期间任务体不放行（否则这条用例是空的）')

    const row = queueRowOf(panel)
    assert.ok(row, '挂起时队列必须补那一行')
    assert.equal(row.cancellable, 'background', '挂起期间取消仍然点得着 —— 这是让卡住的任务走出来的一条路')
    panel.cancelProgressRow(row)
    await settle()
    assert.equal(cancelled, 1, 'onCancel 先调')
    assert.equal(wokeUp, true, '取消把任务体从 awaitResumed() 里放回来（ProgressSuspender.java:55-61 那一句）')
    assert.equal(walkedPast, false, '放回来之后仍要在下一个取消检查点停下，不是继续往下跑')
    await running
  } finally {
    proceed?.()
    await releaseQueue()
  }
})

test('接线（反证）：面板那一档的按钮来自队列的行，不再写死 false', () => {
  const panel = read('../src/progressPanel.ts')
  assert.match(panel, /cancellable: queueRow\.cancellable \? 'background' : false/,
    '队列那一行的取消档必须由队列给（写死 false = cancelCurrentAndAwait 没有出口）')
  assert.doesNotMatch(panel, /detail: queueRow\.detail, cancellable: false/,
    '不许把这一行重新写死成不可取消')
  const source = read('../src/backgroundTasks.ts')
  // `queueRow` 的三档都带 cancellable：正在取消那一档写死 false（`:876` 的 `!isStopping`），
  // 挂起档与排队档带的是正在跑那条任务自己的档位。
  assert.match(source, /cancellable: false,/, '正在取消那一段不给按钮（isCancellable() && !isStopping）')
  assert.equal((source.match(/^\s+cancellable,$/gm) ?? []).length, 2,
    '挂起档与排队档各带一次 cancellable —— 少一档就是那一档的按钮又没了')
})
