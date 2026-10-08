// 后台任务队列与进度指示模型 —— 上游 `BackgroundTaskQueue`（platform-impl/openapi/progress）
// 加 `ProgressIndicatorModel`/`ProgressModel` 的 `TaskCancellation` 一档。
//
// 上游行为（2026-10-06 progflow 逐条重开源码数过行号，不是"看起来像"；原来写的几处坐标是漂的）：
//   · `BackgroundTaskQueue.java:26`「Runs backgroundable tasks one by one」= 队列**串行**，
//     串行由构造它的那条 `QueueProcessor`（`:43-46`，`ThreadToUse.AWT`）保证；
//     `run(Task.Backgroundable)` 入队在 `:61-63`，`clear()` 丢未跑的在 `:49-51`，
//     `isEmpty()` 是队列查询面在 `:53-55`，队列自己带 title（正在跑的任务没有标题时用它：
//     字段 `:35`，真正生效的那一句是 `:105-107`）。
//   · `ProgressIndicatorModel.kt:13-18`：title + cancellation + visibleInStatusBar，
//     写入面 `setFraction`（`:39-41`）/ `setText`（`:47-49`）/ `getFraction`（`:59-61`）；
//     带 `onCancel` 的构造器 `:25-37` 把回调装成 `cancel()` 的委托（`:33` 先调回调、`:34` 再 `super.cancel()`）。
//   · `TaskCancellation`：可取消 / 不可取消两档（`ProgressIndicatorModel.kt:23` 的 `nonCancellable()`、
//     `:92` 的 `isCancellable() = cancellation is TaskCancellation.Cancellable`）；
//     不可取消的任务取消不该生效（本仓的同一档在 `Indicator.cancel()`）。
//   · 行的**取消按钮**按任务自己的可取消档画，且正在停止时不画：
//     `InfoAndProgressPanel.kt:753`（`cancelButton.setPainting(task.isCancellable())`）与
//     `:876`（`info.isCancellable() && !isStopping`）；点下去打的是这条任务自己的
//     `original!!.cancel()`（`:964`）—— 本仓对应的就是 `queueRow.cancellable` + `cancelCurrentAndAwait`。
//
// 本仓的落点：`src/progressPanel.ts` 画各行，任务在各调用点自行执行、没有排队面。
// 这个模块补的就是那一层：串行队列 + 每任务一条可取消的 indicator + 排队计数。
// 第一个真实消费者是 `src/gradleHost.ts` 的「同步 Gradle 项目更改」：用户从外部系统通知里点出来的
// 重载走队列，连点两下排成一条；取消按钮走 `onCancel`（那条回调接到宿主的 `gradle.cancel`）。
// 进度面板**只开一行**（`queueRow`）：正在跑的那条自己的标题/进度由各功能自己的进度行承担
// （Gradle 那条 = `src/progressPanel.ts` 读 `ctx.gradleSync()` 的行），队列这一行只在
// **排队中 / 被挂起 / 正在取消**这三种"只有队列知道"的状态出现，并带上正在跑那条的
// 可取消档（`cancellable`）—— 取消按钮点的是 `cancelCurrentAndAwait()`，也就是正在跑的那条任务
// 自己的 `indicator.cancel()`，与上游 `InfoAndProgressPanel.kt:964` 同一个落点。
// 原来这里对外开着 `runningTitle`/`runningDetail`/`runningFraction`/`runningCancellable`/
// `queuedCount`/`cancellingTitle` 六条扁平出口 + 一条 `cancelCurrent()`：全仓零生产消费者
// （只有各自的测试读它们），且"再开一行正在跑的任务"会与上面那条 Producer 行重复 ——
// 2026-10-06 progflow 按铁律「死代码直接删」收掉，状态改由 `queueRow` 这一个出口承担。
//
// **挂起-恢复**（这一族判词里缺的那条）接在 `src/progressSuspender.ts` 上：队列给正在跑的
// 那条任务建一个挂起器，`setSuspended(reason)` / `setSuspended(null)` 由宿主触发（本仓的触发者是
// 省电模式，`src/notifications.ts:298`；理由与上游依据写在 progressSuspender.ts 的模块头）。
// 挂起器本身不存文案 —— 原因只有队列这一份（`queueSuspendReason`），显示它的那一行是 `queueRow`。
// 任务在耗时点 `await indicator.awaitResumed()`
// 就是上游 `checkCanceled()` 里那句 `myLock.wait()` 的等价物 —— 单线程 JS 不能真的阻塞，
// 改成"这一拍不往下走"。
//
// 协作式的**另一半在任务体里**：只有走到 `awaitResumed()` / `checkCanceled()` 的任务才会真的让路。
// 目前唯一的入队消费者（`src/gradleHost.ts:204-212` 的「同步 Gradle 项目更改」）两个检查点都接上了：
// 进 `sync()` 前一次、每个链接目录开始执行前一次（`gradleHost.ts` 的 `execute(job)` 开头）——
// 那条同步本身是宿主子进程，**进程内部**没有可让路的节拍，所以让路发生在"不再往下一个目录开新进程"
// 这一层；`queueRow` 挂起分支那句措辞按这个口径写（原写「正在跑的那条停在检查点上」= 把没做的事
// 说成做了，2026-10-06 桶 status2 订正过一次，本轮接上检查点后仍然只说"会在下一个检查点让路"）。
import { computed, ref, shallowRef } from 'vue'
import { createProgressSuspender, ProgressSuspenderTracker, type ProgressSuspender } from './progressSuspender.ts'

/** 任务被取消时在耗时点抛出的错误（上游 `checkCanceled` → `ProcessCanceledException` 的投影）。 */
export class BackgroundTaskCancelled extends Error {
  constructor() { super('后台任务已取消。'); this.name = 'BackgroundTaskCancelled' }
}

/** 队列给任务的那条进度指示（`ProgressIndicatorModel` 的最小可用面）。 */
export interface ProgressIndicatorModel {
  readonly title: string
  /** 第二行文字（上游 `ProgressIndicator.setText`）。 */
  readonly text: string
  /** 0..1；`null` = 不确定式（`setIndeterminate(true)` 那一档）。 */
  readonly fraction: number | null
  readonly cancellable: boolean
  readonly cancelled: boolean
  setText(text: string): void
  setFraction(fraction: number): void
  setIndeterminate(): void
  /** 被取消时抛 `BackgroundTaskCancelled`；任务在耗时点调用它。 */
  checkCanceled(): void
  cancel(): void
  /**
   * `ProgressSuspender.freezeIfNeeded`（`:154-181`）的等价物：挂起期间这一拍不往下走，
   * 恢复时 Promise 落地；没挂起 / 在不可挂起段内 ⇒ 立刻结束。
   */
  awaitResumed(): Promise<void>
  /** `executeNonSuspendableSection`（`:83-91`）：这一段不接受挂起。 */
  runNonSuspendable(body: () => void): void
}

/** 一条可入队的后台任务（`Task.Backgroundable` 的投影）。 */
export interface BackgroundQueueTask {
  title: string
  /** 缺省 true（上游 `Task.Backgroundable(project, title)` 默认 cancellable）。 */
  cancellable?: boolean
  /** `ProgressIndicatorModel(title, cancellation, visible, onCancel)` 里的那一个。 */
  onCancel?: () => void
  run: (indicator: ProgressIndicatorModel) => Promise<void> | void
}

interface QueueEntry {
  task: BackgroundQueueTask
  indicator: Indicator
  cancelledBeforeStart: boolean
  resolve: () => void
  /**
   * 这条任务**真的跑完**了（`pump` 的 finally 里落地）。
   * 取消是协作式的：`ProgressIndicator.cancel()` 只置位，任务体要走到下一个 `checkCanceled()`
   * 才停 —— 上游把这件事写得很明白（`platform/ide-core-impl/src/com/intellij/openapi/progress/util/
   * ProgressIndicatorUtils.java:313-314`：计算得"足够频繁地"调 checkCanceled，超时后才停得下来）。
   * 所以"取消"与"取消完了"是两个时刻，面板要分开显示。
   */
  done: Promise<void>
}

class Indicator implements ProgressIndicatorModel {
  readonly title: string
  readonly cancellable: boolean
  text = ''
  fraction: number | null = null
  cancelled = false
  /** 入队时还没有 id，起跑那一刻才发（`markSuspendable` 也是那一刻做的）。 */
  taskId = ''
  /** 挂起器由队列建好后回填（`markSuspendable` 是在任务起跑那一步做的）。 */
  suspender: ProgressSuspender | null = null
  private readonly waiters: Array<() => void> = []
  private readonly changed: () => void
  private readonly onCancel?: () => void

  constructor(title: string, cancellable: boolean, changed: () => void, onCancel?: () => void) {
    this.title = title
    this.cancellable = cancellable
    this.changed = changed
    this.onCancel = onCancel
  }

  setText(text: string): void { this.text = text; this.changed() }
  setFraction(fraction: number): void {
    this.fraction = Math.max(0, Math.min(1, Number.isFinite(fraction) ? fraction : 0))
    this.changed()
  }
  setIndeterminate(): void { this.fraction = null; this.changed() }
  checkCanceled(): void { if (this.cancelled) throw new BackgroundTaskCancelled() }
  cancel(): void {
    // 不可取消的任务：上游 `TaskCancellation.nonCancellable()` 下 `cancel()` 不改变任何东西。
    if (!this.cancellable || this.cancelled) return
    this.cancelled = true
    // 上游给指示器装的那条 `cancelled()` 监听会先 `resumeProcess()`（`ProgressSuspender.java:55-61`）：
    // 挂起中的任务被取消时必须让它走下去，不然它卡在自己的等待里收不了尾。
    this.suspender?.resume()
    this.resumeWaiters()
    this.onCancel?.()
    this.changed()
  }
  awaitResumed(): Promise<void> {
    if (!this.suspender) return Promise.resolve()
    const pending = this.suspender.waitWhileSuspended()
    if (!this.suspender.isSuspended() || this.suspender.inNonSuspendableSection()) return pending
    // 挂起中。**两条**路都得放行，少一条任务体就永远卡在这个检查点上：
    //   · 恢复：`waitWhileSuspended()` 那条 Promise 落地（上游 `freezeIfNeeded` 里 `myLock.wait()`
    //     被 `resumeProcess()` 叫醒的那一下，`ProgressSuspender.java:139-152`）；
    //   · 取消：`cancel()` 先 `suspender.resume()`（上游给指示器装的 `cancelled()` 监听，`:55-61`）
    //     再排空 `waiters`。
    // 原写这里只把 resolve 登记进 `waiters`、不接 `pending` ⇒ 省电模式关掉后任务并不往下走
    // （本轮实测出来的，判据 `tests/progress-queue-suspend.test.mjs`）。
    return new Promise<void>(resolve => {
      this.waiters.push(resolve)
      pending.then(() => this.resumeWaiters())
    })
  }
  runNonSuspendable(body: () => void): void {
    if (!this.suspender) { body(); return }
    this.suspender.runNonSuspendable(body)
  }
  /** 恢复（或取消）时放行所有等待这一拍的任务体。 */
  resumeWaiters(): void {
    const waiting = this.waiters.splice(0, this.waiters.length)
    for (const resolve of waiting) resolve()
  }
}

/**
 * 「取消」按下后**最多等**任务体收尾的时长（毫秒）。
 * 上游没有一个同名常数：`ProgressIndicatorUtils.withTimeout`（`:321-341`）的时长由调用方给，
 * 到点只把指示器取消掉、返回 null；`awaitWithCheckCanceled`（`:357-395`）等的是"可取消的等待"，
 * 中途取消就抛 ProcessCanceledException。本仓把两件事合成了「等一会儿，等不到就告诉用户」，
 * 取 5 秒是"用户还愿意等、又不至于以为界面死了"的那一档。
 */
export const CANCEL_WAIT_TIMEOUT_MS = 5000

export function createBackgroundTaskQueue() {
  /**
   * 「取消已经按下、任务体还没走到下一个 `checkCanceled()`」的那条任务（null = 没有）。
   * 协作式取消的两个时刻要分开画：点下去是一件事，任务真的收尾是另一件事
   * （`ProgressIndicatorUtils.java:313-314` 那句"计算得足够频繁地调 checkCanceled"说的就是这段距离）。
   */
  const cancellingEntry = shallowRef<QueueEntry | null>(null)
  const queue: QueueEntry[] = []
  const suspenders = new ProgressSuspenderTracker()
  /**
   * 队列级别的挂起请求（省电模式那类"外部要求让路"）：正在跑的与接下来要跑的都算。
   * 必须是 **ref**：`queueRow` 是 computed，挂起状态是它唯一的判据之一，用普通变量的话
   * "只是挂起/恢复"这一拍没有响应式依赖变化 ⇒ 那一行不会出现在面板里（本轮实测出来的，
   * 判据 `tests/progress-queue-suspend.test.mjs`）。
   */
  const queueSuspendReason = ref<string | null>(null)
  /**
   * 「队列里有什么变了」的**唯一**响应式信号：`current` / `queue` / `Indicator` 都是普通对象，
   * 它们的 text/fraction/取消状态变化本身不会触发重算。上游对应的是给指示器挂
   * `onProgressChange` 委托（`ProgressIndicatorModel.kt:83-90`）后把这一行标脏
   * （`InfoAndProgressPanel.kt:966-968` 的 `dirtyIndicators.add(this)`），DOM 侧就只剩"自增一次计数"。
   */
  const revision = ref(0)
  let current: QueueEntry | null = null
  let pumping = false
  let taskSeq = 0

  /** 任务状态变了：让读 `revision` 的那几条 computed（只有 `queueRow`）重新算一遍。 */
  const sync = () => {
    revision.value += 1
    // 挂起原因**不在这里另开一个出口**：上游那句是 `TaskManager.pauseTask(task, suspender.suspendedText,
    // Source.USER)`（`TaskInfoEntityCollector.kt:174`，恢复的对称面 `resumeTask` 在 `:177`）——
    // 暂停状态跟着那一行显示，本仓的那一行就是下面的 `queueRow`（面板读它）。
    // 原写在这里的 `runningSuspendedText`（`:154` 声明、`:181` 写、`:246` 导出）与同批那几条
    // `runningTitle`/`runningDetail`/`runningFraction`/`runningCancellable`/`queuedCount`/`cancellingTitle`
    // 全仓零生产消费者 = 铁律禁的"只过自己测试的死出口"，2026-10-06 桶 status2 与 progflow 分两批删除
    // （判据：`tests/progress-queue-suspend.test.mjs` 的那份精确键清单）。
  }

  /** 把队列级的挂起请求落到那条正在跑的任务上（挂起器的状态机不带文案，原因由这一层拿着）。 */
  const applySuspend = (indicator: Indicator) => {
    const suspender = suspenders.getSuspender(indicator.taskId)
    if (!suspender) return
    if (queueSuspendReason.value !== null) suspender.suspend()
    else suspender.resume()
  }

  async function pump(): Promise<void> {
    if (pumping) return
    pumping = true
    try {
      while (queue.length) {
        // 队列被挂起时**不开新任务**（上游：省电模式禁后台任务；这里是"让路"而不是"取消"）。
        while (queueSuspendReason.value !== null) await new Promise<void>(resolve => { resumeQueueWaiters.push(resolve) })
        // 挂起期间 `clear()` 可能把这一条已经摘走了（`clear()` 里 `queue.splice` + `resolve`），
        // 醒来时必须重新看一眼队列，不能拿着 `shift()` 的 undefined 往下走。
        if (!queue.length) break
        const entry = queue.shift()!
        if (entry.cancelledBeforeStart) { sync(); entry.resolve(); continue }
        current = entry
        sync()
        // `markSuspendable`（`ProgressSuspender.java:79-81`）：任务在跑的那一刻才挂挂起器
        //（上游那条 `assert progress.isRunning()` 就在 `:48`）。
        const taskId = `${entry.indicator.title}#${++taskSeq}`
        entry.indicator.taskId = taskId
        const suspender = suspenders.track(createProgressSuspender(
          // 上游 `markSuspendable(indicator, suspendedText)`（`ProgressSuspender.java:79-81`）的第二参是
          // "挂起那一行的兜底文案"（`TaskSuspension.kt:24-25`：
          // "a text message explaining the reason for the suspension, which is displayed in the progress bar"）。
          // 本仓**不接这一参**（这里原样传过一句「等待前台操作」，2026-10-06 桶 status2 删除）：
          // 队列这一路只在 `queueSuspendReason` 非 null 时才挂起（本文件 `applySuspend`），
          // 那句兜底没有能显示到它的调用点 = 只过自己测试的死出口。面板那一行读的是 `queueSuspendReason`
          // （见下面 `queueRow` 的挂起分支），口径与上游那三处 `suspendedText` 消费者一起写在
          // `src/progressSuspender.ts` 的文件头。要真接上兜底档，先要有一个"不给 reason 的挂起入口"——
          // 上游那一支是 `TaskStatus.Paused(reason)` 可空（`TaskInfoEntityCollector.kt:188`），本仓没有。
          taskId,
          { get running() { return current === entry && !entry.indicator.cancelled } },
        ))
        entry.indicator.suspender = suspender
        applySuspend(entry.indicator)
        try {
          entry.indicator.checkCanceled()
          await entry.task.run(entry.indicator)
          // 任务体自己结束（或被取消）之后把等待里的节拍放行，避免留一个永不落地的事务。
          entry.indicator.resumeWaiters()
        } catch {
          // 上游 `Task.Backgroundable.run` 不把异常抛给入队者（进度窗口负责显示失败）；
          // 本仓的任务自己把失败变成通知，这里只保证队列继续往下跑。
          entry.indicator.resumeWaiters()
        } finally {
          // `stopTracking` + `close()`（`TaskInfoEntityCollector.kt:198`、`ProgressSuspender.java:66-77`）。
          suspenders.untrack(taskId)
          entry.indicator.suspender = null
          current = null
          sync()
          entry.resolve()
        }
      }
    } finally {
      pumping = false
      sync()
    }
  }

  /** 等"队列恢复"的那些 `pump` 循环（`setSuspended(null)` 时统一放行）。 */
  const resumeQueueWaiters: Array<() => void> = []

  return {
    // 原写在这里还有一条 `currentSuspender()`（对的是上游 `ProgressSuspender.getSuspender(indicator)`
    // —— `ProgressSuspender.java:93-95` 查那张 `ourProgressToSuspenderMap` `:44`；上游拿它去反查挂起器的是
    // `UnindexedFilesIndexer.java:243`、`BridgeTaskSuspender.kt:37`/`:60`、`InfoAndProgressPanel.kt:404`/`:953`），
    // 全仓零消费者 ⇒ 与 `runningSuspendedText` 同批删除（挂起状态由 `queueRow` 那一行显示，
    // 队列内部用 `suspenders.getSuspender` 与 `Indicator.suspender` 两条私有通道，不需要对外再开一个）。
    // 2026-10-06 progflow 同批删掉的还有 `runningTitle`/`runningDetail`/`runningFraction`/
    // `runningCancellable`/`queuedCount`/`cancellingTitle`/`cancelCurrent` 七条：它们读到的状态
    // 全部由下面 `queueRow` 这一个出口带出去（标题、进度、排队数、可取消档、取消中间态），
    // 面板里也只需要那一行 —— 正在跑那条任务的标题/百分比由**它自己的功能行**承担
    // （Gradle = 面板读 `ctx.gradleSync()` 的那一行），队列再开一行就是把同一个操作画两遍。
    /**
     * 队列级挂起：`reason` 给字符串就是"让路"（正在跑的在它走到下一个检查点时让路、还没轮到的不开），
     * 给 null 就是恢复。**不是取消** —— 任务的进度、百分比、`onCancel` 都不动。
     */
    setSuspended(reason: string | null): void {
      queueSuspendReason.value = reason
      if (current) applySuspend(current.indicator)
      if (reason === null) {
        for (const entry of queue) if (entry.indicator.suspender) entry.indicator.suspender.resume()
        const waiting = resumeQueueWaiters.splice(0, resumeQueueWaiters.length)
        for (const resolve of waiting) resolve()
        void pump()
      }
      sync()
    },
    isSuspended: () => queueSuspendReason.value !== null,
    /** `BackgroundTaskQueue.run(...)`：入队并等它跑完（被取消也算"结束"）。 */
    run(task: BackgroundQueueTask): Promise<void> {
      return new Promise<void>(resolve => {
        // 入队者等的那条 Promise 同时是「这条任务真的收尾了」的信号（`cancelCurrentAndAwait`
        // 用它判"取消到底被响应了没有"）：`settle` 与 `resolve` 在同一个 finally 里落地。
        let settle: () => void = () => {}
        const done = new Promise<void>(finish => { settle = finish })
        const entry: QueueEntry = {
          task,
          cancelledBeforeStart: false,
          resolve: () => { settle(); resolve() },
          done,
          indicator: new Indicator(task.title, task.cancellable !== false, sync, task.onCancel),
        }
        queue.push(entry)
        sync()
        void pump()
      })
    },
    /** `BackgroundTaskQueue.clear()`：丢掉还没跑的任务（正在跑的仍由 `cancelCurrentAndAwait` 收）。 */
    clear(): void {
      for (const entry of queue.splice(0, queue.length)) {
        entry.cancelledBeforeStart = true
        entry.indicator.cancel()
        entry.resolve()
      }
      sync()
    },
    isEmpty: () => !current && queue.length === 0,
    /**
     * 取消正在跑的那条**并等它真的收尾**。
     * 返回 `false` 表示超时了任务体还没停 —— 上游对同一件事的处理是给指示器 `cancel()` 之后再
     * 等（`ProgressIndicatorUtils.java:321-341` 的 `withTimeout` 就是"到点取消、由计算自己停在
     * ProcessCanceledException 上"，超时则返回 null 继续往下走）；本仓没有线程可等，
     * 到点就把这件事**报给用户**（`src/progressPanel.ts` 那条通知），队列照旧不动。
     */
    async cancelCurrentAndAwait(timeoutMs = CANCEL_WAIT_TIMEOUT_MS): Promise<boolean> {
      const entry = current
      if (!entry) return true
      cancellingEntry.value = entry
      entry.indicator.cancel()
      // 任务**真的**收尾时清掉这一行 —— 不管是等了 3 秒还是 3 分钟（超时那一路也要收，
      // 否则面板会留下一行永远不消失的「正在取消」）。
      entry.done.then(() => { if (cancellingEntry.value === entry) cancellingEntry.value = null })
      // 句柄类型不写死 `number`：DOM 的 `setTimeout` 返 number，node 的返 `Timeout`，
      // `ReturnType<typeof setTimeout>` 两边都成立（本仓 `src/statusBarText.ts:105` 同一写法）。
      let timer: ReturnType<typeof setTimeout> | null = null
      const finished = await Promise.race([
        entry.done.then(() => true),
        new Promise<boolean>(resolve => { timer = setTimeout(() => resolve(false), timeoutMs) }),
      ])
      if (timer !== null) clearTimeout(timer)
      return finished
    },
    /**
     * 面板要的一行：有人排队、或队列正被挂起时出现（正在跑的那条由各功能自己的进度行承担）。
     * `cancellable` 带的是**正在跑那一条任务自己的可取消档**（`ProgressIndicatorModel.kt:92`
     * `isCancellable() = cancellation is TaskCancellation.Cancellable`），面板据此决定这一行给不给
     * 「取消」按钮（`src/progressPanel.ts` 的 `'background'` 那一档）。这一句以前在面板里写死
     * `cancellable: false` —— 队列里那条 `cancelCurrentAndAwait` 于是没有任何出口，按钮永远点不到
     * （2026-10-06 progflow 补）。正在停止的那一段不给按钮，与上游同一判据：
     * `InfoAndProgressPanel.kt:876` 的 `info.isCancellable() && !isStopping`。
     */
    queueRow: computed(() => {
      void revision.value // current / queue / Indicator 都不是 reactive，这一句是本行唯一的变化信号
      const queued = queue.length
      const cancellable = current !== null && current.indicator.cancellable && !current.indicator.cancelled
      // 「正在取消…」这一行是**必要**的：协作式取消里，按钮按下与任务体停在下一个
      // `checkCanceled()` 之间有一段真实的时间（上游 `ProgressIndicatorUtils.java:313-314` 那句
      // "计算得足够频繁地调用 checkCanceled，超时后才能停下"）。这段时间里界面必须说清发生了什么，
      // 不能看起来像按钮没生效。
      if (cancellingEntry.value && current === cancellingEntry.value) {
        return {
          title: '后台任务队列',
          detail: `正在取消：${cancellingEntry.value.indicator.title}（等任务体走到下一个取消检查点）`,
          cancellable: false,
          percent: null as number | null,
        }
      }
      // 挂起时这一行是**必要**的：省电模式让后台任务让路（上游那句正文「代码洞察和后台任务已禁用。」，
      // `power.save.mode.on.notification.content`），但正在跑的那条由各功能自己画（Gradle 行、
      // 检查行…），它们不知道队列被挂起了。所以挂起状态由队列自己补一行，而不是塞进别人的行。
      // 这一段里"能不能取消"尤其有用：卡在自己等待里的任务体只有 `cancel()` 那条路会先
      // `suspender.resume()`（`ProgressSuspender.java:55-61` 那个 `cancelled()` 监听）再放行。
      if (queueSuspendReason.value !== null && (queued > 0 || current !== null)) {
        return {
          title: '后台任务队列',
          detail: `已挂起：${queueSuspendReason.value}${queued > 0 ? `（还有 ${queued} 个排队中）` : '（正在跑的那条会在下一个检查点让路）'}`,
          cancellable,
          percent: null as number | null,
        }
      }
      if (queued <= 0) return null
      const head = queue[0]!
      return {
        title: '后台任务队列',
        detail: `还有 ${queued} 个任务排队中${head ? `（下一个：${head.task.title}）` : ''}`,
        cancellable,
        percent: null as number | null,
      }
    }),
  }
}

/**
 * 应用级单例：进度面板与各消费者共用同一条队列（上游也是每项目一个 QueueProcessor）。
 * 单例在这里而不是在组件里，是因为队列的**语义**就是"全局串行"。
 */
export const backgroundTaskQueue = createBackgroundTaskQueue()
