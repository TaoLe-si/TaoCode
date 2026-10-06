// 后台任务队列与进度指示模型 —— 上游 `BackgroundTaskQueue`（platform-impl/openapi/progress）
// 加 `ProgressIndicatorModel`/`ProgressModel` 的 `TaskCancellation` 一档。
//
// 上游行为（都核过源码，不是"看起来像"）：
//   · `BackgroundTaskQueue.java:36-45`：Runs backgroundable tasks one by one —— 队列**串行**，
//     `run(Task.Backgroundable)` 入队；`clear()` 丢未跑的（:62-64），`isEmpty()` 是队列查询面（:66-68），
//     队列自己带 title（正在跑的任务没有标题时用它，:39-40）。
//   · `ProgressIndicatorModel.kt:34-59`：title + text + fraction + cancellation；
//     `setFraction`/`setText` 是任务的写入面；带 `onCancel` 的构造器在 `cancel()` 时先调用户回调。
//   · `TaskCancellation`：可取消 / 不可取消两档；不可取消的任务取消不该生效
//     （非取消档的 `cancel()` 是空操作，`ProgressIndicatorBase` 的 `isCancellable` 门控）。
//
// 本仓的落点：`src/progressPanel.ts` 只画"当前正在跑的任务"，任务在各调用点自行执行、
// 没有排队面。这个模块补的就是那一层：串行队列 + 每任务一条可取消的 indicator + 排队计数。
// 第一个真实消费者是 `src/gradleHost.ts` 的「同步 Gradle 项目更改」：用户从外部系统通知里点出来的
// 重载走队列，连点两下排成一条；取消按钮走 `onCancel`（接到宿主的 `gradle.cancel`）。
// 进度面板把**排队深度**画成一行（正在跑的那条由各功能自己的进度行承担，不重复画）。
//
// **挂起-恢复**（这一族判词里缺的那条）接在 `src/progressSuspender.ts` 上：队列给正在跑的
// 那条任务建一个挂起器，`suspend(reason)` / `resume()` 由宿主触发（本仓的触发者是省电模式，
// 理由与上游依据写在 progressSuspender.ts 的模块头）。任务在耗时点 `await indicator.awaitResumed()`
// 就是上游 `checkCanceled()` 里那句 `myLock.wait()` 的等价物 —— 单线程 JS 不能真的阻塞，
// 改成"这一拍不往下走"。
//
// 协作式的**另一半在任务体里**：只有走到 `awaitResumed()` / `checkCanceled()` 的任务才会真的让路。
// 目前唯一的入队消费者（`src/gradleHost.ts:203` 的「同步 Gradle 项目更改」）只用了 `onCancel`
// —— 那条同步是宿主子进程，中途没有可让路的节拍 ⇒ 挂起对它的实际效果是"不再开新任务"。
// `queueRow` 那句措辞按这个口径写（原写「正在跑的那条停在检查点上」= 把没做的事说成做了，本批订正），
// 给 gradleHost 的接线请求见 `docs/wiring-requests-2026-10-06-status2.md`。
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
  const runningTitle = ref('')
  const runningDetail = ref('')
  const runningFraction = ref<number | null>(null)
  const runningCancellable = ref(false)
  const queuedCount = ref(0)
  /**
   * 「取消已经按下、任务体还没走到下一个 `checkCanceled()`」的那条任务的标题（空串 = 没有）。
   * 协作式取消的两个时刻要分开画：点下去是一件事，任务真的收尾是另一件事
   * （`ProgressIndicatorUtils.java:313-314` 那句"计算得足够频繁地调 checkCanceled"说的就是这段距离）。
   */
  const cancellingEntry = shallowRef<QueueEntry | null>(null)
  /** 面板读的那句标题（没有中间态就是空串）。 */
  const cancellingTitle = computed(() => cancellingEntry.value?.indicator.title ?? '')
  const queue: QueueEntry[] = []
  const suspenders = new ProgressSuspenderTracker()
  /**
   * 队列级别的挂起请求（省电模式那类"外部要求让路"）：正在跑的与接下来要跑的都算。
   * 必须是 **ref**：`queueRow` 是 computed，挂起状态是它唯一的判据之一，用普通变量的话
   * "只是挂起/恢复"这一拍没有响应式依赖变化 ⇒ 那一行不会出现在面板里（本轮实测出来的，
   * 判据 `tests/progress-queue-suspend.test.mjs`）。
   */
  const queueSuspendReason = ref<string | null>(null)
  let current: QueueEntry | null = null
  let pumping = false
  let taskSeq = 0

  /** 队列的三个查询面（`isEmpty`/`clear`）加面板读的那几个 ref。 */
  const sync = () => {
    queuedCount.value = queue.length
    runningTitle.value = current?.indicator.title ?? ''
    runningDetail.value = current?.indicator.text ?? ''
    runningFraction.value = current?.indicator.fraction ?? null
    runningCancellable.value = Boolean(current?.indicator.cancellable && !current.indicator.cancelled)
    // 挂起原因**不在这里另开一个出口**：上游那句是 `TaskManager.pauseTask(task, suspender.suspendedText,
    // Source.USER)`（`TaskInfoEntityCollector.kt:174`，恢复的对称面 `resumeTask` 在 `:177`；上一批写的
    // `:164-168` 是那段函数的起始行，本轮重开该文件逐行数过）—— 暂停状态跟着那一行显示，
    // 本仓的那一行就是下面的 `queueRow`（面板读它）。原写在这里的 `runningSuspendedText`
    // （`:154` 声明、`:181` 写、`:246` 导出）全仓零消费者 = 铁律 §5 禁的"只过自己测试的死出口"，
    // 2026-10-06 桶 status2 删除（判据：`tests/progress-queue-suspend.test.mjs`）。
  }

  /** 把队列级的挂起请求落到那条正在跑的任务上。 */
  const applySuspend = (indicator: Indicator) => {
    const suspender = suspenders.getSuspender(indicator.taskId)
    if (!suspender) return
    if (queueSuspendReason.value !== null) suspender.suspend(queueSuspendReason.value)
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
          // 上游那句 `suspendText` 是"这条任务可以被挂起，原因写在这里"（`TaskSuspension.kt:24-25`）；
          // 它是构造给挂起器的那句**兜底**文案（上游优先级在 `ProgressSuspender.java:106-110`：临时 reason 优先）。
          // 原写「没有具体 reason 时用它兜底，面板拼成「已挂起：<这句>」」= 把没发生的事说成发生过了：
          // 队列这一路 `applySuspend` 只在 reason 非 null 时才往下传（本文件 :208），所以这句兜底
          // **当前显示不到**（面板读的是 `queueRow` 里的 `queueSuspendReason.value`，:364-367）。
          // 2026-10-06 桶 status2defect 核对后按实情订正；要真接上兜底口径的线见交付报告 §7。
          taskId, '等待前台操作',
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
    runningTitle, runningDetail, runningFraction, runningCancellable, queuedCount,
    // 原写在这里还有一条 `currentSuspender()`（对应上游 `ProgressSuspenderTracker.getSuspender`），
    // 全仓零消费者 ⇒ 与 `runningSuspendedText` 同批删除（挂起状态由 `queueRow` 那一行显示，
    // 队列内部用 `suspenders.getSuspender` 与 `Indicator.suspender` 两条私有通道，不需要对外再开一个）。
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
    /** `BackgroundTaskQueue.clear()`：丢掉还没跑的任务（正在跑的仍由 `cancelCurrent` 收）。 */
    clear(): void {
      for (const entry of queue.splice(0, queue.length)) {
        entry.cancelledBeforeStart = true
        entry.indicator.cancel()
        entry.resolve()
      }
      sync()
    },
    isEmpty: () => !current && queue.length === 0,
    /** 正在跑的那条的取消中间态（面板画「正在取消…」用；没有就是空串）。 */
    cancellingTitle,
    /** 取消正在跑的那条（面板「取消」按钮的落点）。 */
    cancelCurrent(): void { current?.indicator.cancel() },
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
    /** 面板要的一行：有人排队、或队列正被挂起时出现（正在跑的那条由各功能自己的进度行承担）。 */
    queueRow: computed(() => {
      // 「正在取消…」这一行是**必要**的：协作式取消里，按钮按下与任务体停在下一个
      // `checkCanceled()` 之间有一段真实的时间（上游 `ProgressIndicatorUtils.java:313-314` 那句
      // "计算得足够频繁地调用 checkCanceled，超时后才能停下"）。这段时间里界面必须说清发生了什么，
      // 不能看起来像按钮没生效。
      if (cancellingEntry.value && current === cancellingEntry.value) {
        return {
          title: '后台任务队列',
          detail: `正在取消：${cancellingEntry.value.indicator.title}（等任务体走到下一个取消检查点）`,
          percent: null as number | null,
        }
      }
      // 挂起时这一行是**必要**的：省电模式让后台任务让路（上游那句正文「代码洞察和后台任务已禁用。」，
      // `power.save.mode.on.notification.content`），但正在跑的那条由各功能自己画（Gradle 行、
      // 检查行…），它们不知道队列被挂起了。所以挂起状态由队列自己补一行，而不是塞进别人的行。
      if (queueSuspendReason.value !== null && (queuedCount.value > 0 || current !== null)) {
        return {
          title: '后台任务队列',
          detail: `已挂起：${queueSuspendReason.value}${queuedCount.value > 0 ? `（还有 ${queuedCount.value} 个排队中）` : '（正在跑的那条会在下一个检查点让路）'}`,
          percent: null as number | null,
        }
      }
      if (queuedCount.value <= 0) return null
      const head = queue[0]!
      return {
        title: '后台任务队列',
        detail: `还有 ${queuedCount.value} 个任务排队中${head ? `（下一个：${head.task.title}）` : ''}`,
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
