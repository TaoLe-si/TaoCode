// 后台任务的**挂起-恢复**（`pf/progress` 族里缺的那一条）——
// 上游 `com.intellij.openapi.progress.impl.ProgressSuspender`
// （`platform/platform-impl/src/com/intellij/openapi/progress/impl/ProgressSuspender.java`）
// 在单线程 DOM 宿主里的等价物。
//
// 逐条对照（右列是本仓的承接方式；行号 2026-10-06 桶 status2 本轮逐条开文件数过）：
//   · `markSuspendable(indicator, suspendedText)`（`:79-81`，构造里 `assert progress.isRunning()` `:48`）
//     → `createProgressSuspender(taskId, task)`：只对"正在跑"的任务生效。
//     **上游那个第二参 `suspendedText` 本仓不接**（这里原样留过一句「等待前台操作」，status2 删除）：
//     它在上游只有一个读者 `getSuspendedText()`（`:106-110`：`myTempReason != null ? myTempReason : mySuspendedText`），
//     而 `suspendedText` 的消费者读的都是"挂起那一行的文案"——
//     `InfoAndProgressPanel.kt:815`（`return if (suspender != null && suspender.isSuspended) suspender.suspendedText else text`）、
//     `TaskInfoEntityCollector.kt:174`（`TaskManager.pauseTask(task, suspender.suspendedText, TaskStatus.Source.USER)`）、
//     `TaskToProgressSuspenderSynchronizer.kt:57`（`taskSuspender.pause(suspender.suspendedText)`）。
//     本仓那一行的唯一拼装点是 `src/backgroundTasks.ts` 的 `queueRow`，而队列只在挂起原因**非空**时挂起
//     （同文件 `applySuspend`：`if (queueSuspendReason.value !== null) suspender.suspend()`）
//     ⇒ 那句兜底在本仓没有任何能显示到它的调用点。留着参数与 `text()` 出口 = 只过自己测试的死出口（铁律 §5），
//     挂起状态的可见文案只有 `queueRow` 那一份（判据 `tests/progress-queue-suspend.test.mjs`）。
//   · `suspendProcess(reason)`（`:123-137`）：已挂起或已 close 时是空操作（`:125`）；`reason` **临时覆盖**
//     显示文案（`:121` 那句 "if provided, is displayed in the UI … until the progress is resumed"）。
//     → `suspend()` 同语义，**不带 reason**：本仓唯一入口是省电模式（`src/notifications.ts:298`
//     的 `backgroundTaskQueue.setSuspended(那句正文)`），那句正文由队列存着并直接画进 `queueRow`；
//     挂起器再存一份就是第二个真相（原来那份 `tempReason` 除了 `text()` 没有读者，同批删）。
//   · `resumeProcess()`（`:139-152`）：没挂起时空操作；上游在 `:144` 清掉 `myTempReason`（本仓没有那一份）。
//   · `isSuspended`（`:112-114`）/ `close()`（`:66-77`：置 closed、清 suspended、摘映射）。
//     `isClosed()`（`:116-118`）**不对外开**：close 之后"suspend 是空操作"由 `suspend()` 自己守（`:125`），
//     队列也不反查关闭态（`untrack` 时先把 `Indicator.suspender` 置 null）。
//   · `attachToProgress(progress)`（`:97-104`，一个挂起器管多条指示器）**本仓没有这一档**：
//     一条队列任务只有一个 indicator；`taskId` 对的是上游那张映射表本身（`ourProgressToSuspenderMap` `:44`）。
//   · `getSuspender(indicator)`（`:93-95`，`ourProgressToSuspenderMap` `:44`）→ tracker 的 `getSuspender(taskId)`。
//     上游用它的是 `UnindexedFilesIndexer.java:243`、`BridgeTaskSuspender.kt:37`/`:60`、
//     `InfoAndProgressPanel.kt:404`/`:953` —— 都是"手里只有 indicator、要反查挂起器"的位置；
//     本仓的队列自己持有挂起器（`Indicator.suspender`），所以这条只是队列内部的按 id 查表，不开对外口。
//   · `executeNonSuspendableSection(indicator, runnable)`（`:83-91`）：段落计数（同一指示器可以嵌套），
//     段内 `freezeIfNeeded` 直接返回 false（`:162-164`）⇒ **挂起请求打不断这一段**。
//   · 取消时先 resume（`:55-61` 那条 `ProgressIndicatorListener.cancelled()` → `resumeProcess()`）：
//     挂起中的任务被取消时必须让它走下去，否则卡在等待里永远收不了尾。
//     **落点不在本模块**：本仓由队列的 `Indicator.cancel()` 直接 `this.suspender?.resume()`
//     （`src/backgroundTasks.ts:121`）。所以 `SuspendableTask` 不带 `onCancel` 回调 —— 原来留了这条可选钩子，
//     唯一的调用方（`src/backgroundTasks.ts:230` 的 `createProgressSuspender(…)`）从没传过它，同批删除。
//   · `freezeIfNeeded`（`:154-181`）：`while (mySuspended) myLock.wait(10000)` ——
//     上游把调用线程**阻塞**在那儿。本仓是 JS：不能阻塞（一阻塞整个界面就没了），
//     等价物是 `await waitWhileSuspended()`：挂起期间这一拍不往下走，恢复时 Promise 落地。
//     上游那个 10 秒轮询在这里不需要（不是等锁，而是等回调），如实记在这。
//   · `SuspenderListener.suspendedStatusChanged`（`:192-204`；`suspendProcess`/`resumeProcess`
//     各在 `:133`/`:151` 发一次）→ `onStateChanged` 回调。本仓唯一的订阅者是 `waitWhileSuspended()` 自己
//     （恢复那一刻放行等待里的节拍）。上游那套"状态一变就把任务标成暂停、再把文案推给 UI"的双向同步在
//     `TaskToProgressSuspenderSynchronizer.kt:13-63` 与 `TaskInfoEntityCollector.kt:162-166`/`:171-179`，
//     本仓没有 TaskManager 那一面 ⇒ tracker 不做监听分发，也就**没有**批量口的需要：
//     `ProgressSuspenderTracker.kt:20-34` 只有 `startTracking`/`stopTracking` 四个重载，
//     `suspendAll`/`resumeAll`/`suspended()` 在上游不存在、在本仓零调用方 ⇒ 同批删除。
//
// **谁来挂起**：上游是写请求抢占 NonBlockingReadAction（`ProgressSuspender.java:136` 那句
// `invokeLater { WriteAction.run {} }`）与 `TaskStatus.Paused(reason)`
// （`TaskInfoEntityCollector.kt:184-192`：`:188` 的 `is TaskStatus.Paused -> suspender.suspendProcess(status.reason)`）。
// 本仓没有读写锁，能对应上"外部要求让路"的真实信号是
// **省电模式** —— 上游开省电时给的通知正文写着「代码洞察和后台任务已禁用。」
// （`platform/lang-impl/src/com/intellij/ide/actions/PowerSaveModeNotifier.kt:34-38` 建这条通知，
// 正文键 `power.save.mode.on.notification.content`：英文原值在
// `platform/platform-api/resources/messages/IdeBundle.properties:2598`，
// 中文取值在 `localization-zh.jar` 的 `messages/IdeBundle.properties:2028`，本轮从
// `D:/IntelliJ IDEA 2026.2/plugins/localization-zh/lib/localization-zh.jar` 里读出该行逐字对过；
// 本仓那份常量是 `src/notificationPowerSave.ts` 的 `POWER_SAVE_SUSPEND_REASON`）。
// 所以本仓的触发者是省电模式：开 ⇒ 正在跑的后台任务挂起（不取消），关 ⇒ 继续。

/** 一条"正在跑"的任务对挂起器的唯一要求：确实在跑。 */
export interface SuspendableTask {
  /** 任务是否还在跑（上游 `assert progress.isRunning()` `:48`）。 */
  readonly running: boolean
}

export interface ProgressSuspender {
  /** 这条任务在 tracker 表里的键（上游 `ourProgressToSuspenderMap` `:44`）。 */
  readonly taskId: string
  isSuspended: () => boolean
  /** `suspendProcess(reason)`（`:123-137`）的挂起这一半：已挂起 / 已 close 时空操作（`:125`）。
   *  **不带 `reason` 参数**：上游那个 reason 是"临时覆盖显示文案"（`:121`），而本仓那一行的文案
   *  由队列自己持有（`src/backgroundTasks.ts` 的 `queueSuspendReason` ⇒ `queueRow`），
   *  挂起器这里再存一份就是第二个真相（也是没人读的字段）。 */
  suspend: () => void
  /** `resumeProcess()`（`:139-152`）：没挂起时空操作。 */
  resume: () => void
  /** `executeNonSuspendableSection`（`:83-91`）：段内不接受挂起（嵌套计数）。 */
  runNonSuspendable: (body: () => void) => void
  /** 段内是否有还在跑的段（`myProgressesInNonSuspendableSections` `:41` 的判据）。 */
  inNonSuspendableSection: () => boolean
  /** `freezeIfNeeded`（`:154-181`）的等价物：挂起时给出一个到恢复才落地的 Promise；不允许挂起时立刻结束。 */
  waitWhileSuspended: () => Promise<void>
  /** `close()`（`:66-77`）：置 closed、清 suspended、摘掉监听。 */
  close: () => void
  /** `SuspenderListener.suspendedStatusChanged`（`:192-204`）；本仓的订阅者只有 `waitWhileSuspended()`。 */
  onStateChanged: (listener: (suspended: boolean) => void) => () => void
}

/**
 * 建一个挂起器（上游 `markSuspendable(indicator, suspendedText)` `:79-81`；本仓不接那个兜底文案，
 * 理由与上游三处 `suspendedText` 消费者一起写在文件头）。
 * `task.running` 为 false 时按上游那条 assert 直接拒绝——
 * 给没在跑的任务挂"挂起"是没有意义的状态。
 */
export function createProgressSuspender(taskId: string, task: SuspendableTask): ProgressSuspender {
  if (!task.running) throw new Error(`任务 ${taskId} 没在跑，不能给它建挂起器`)
  let suspended = false
  let closed = false
  let nonSuspendableDepth = 0
  const listeners = new Set<(suspended: boolean) => void>()
  const notify = () => { for (const listener of [...listeners]) listener(suspended) }
  const suspender: ProgressSuspender = {
    taskId,
    isSuspended: () => suspended,
    suspend() {
      // `:125` 那句 `if (mySuspended || myClosed) return`。
      if (suspended || closed) return
      suspended = true
      notify()
    },
    resume() {
      if (!suspended) return
      suspended = false
      notify()
    },
    runNonSuspendable(body) {
      nonSuspendableDepth += 1
      try { body() } finally { nonSuspendableDepth = Math.max(0, nonSuspendableDepth - 1) }
    },
    inNonSuspendableSection: () => nonSuspendableDepth > 0,
    waitWhileSuspended() {
      // 段内 / 已 close / 没挂起 ⇒ 立刻过去（`:162-164` 那两个提前 return）。
      if (closed || nonSuspendableDepth > 0 || !suspended) return Promise.resolve()
      return new Promise<void>(resolve => {
        const listener = () => {
          if (!suspended) { off(); resolve() }
        }
        const off = suspender.onStateChanged(listener)
      })
    },
    close() {
      // `:67-77`：先置 closed 再清 suspended（清的时候不再广播状态变化给已摘掉的监听）。
      closed = true
      suspended = false
      listeners.clear()
    },
    onStateChanged(listener) {
      listeners.add(listener)
      return () => { listeners.delete(listener) }
    },
  }
  return suspender
}

/** 按任务 id 找挂起器（上游那张 `ourProgressToSuspenderMap`，`:44` + `getSuspender:93-95`）。 */
export class ProgressSuspenderTracker {
  private readonly map = new Map<string, ProgressSuspender>()

  /** `markSuspendable` + 登记（同 id 再来一次就换掉旧的，旧的先 close）。 */
  track(suspender: ProgressSuspender): ProgressSuspender {
    this.map.get(suspender.taskId)?.close()
    this.map.set(suspender.taskId, suspender)
    return suspender
  }

  /** `getSuspender(indicator)`（`:93-95`）。 */
  getSuspender(taskId: string): ProgressSuspender | null {
    return this.map.get(taskId) ?? null
  }

  /** 任务结束（上游 `TaskInfoEntityCollector.kt:198-199` 的 `stopTracking(suspender)` + `suspender.close()`）。 */
  untrack(taskId: string): void {
    const suspender = this.map.get(taskId)
    if (!suspender) return
    this.map.delete(taskId)
    suspender.close()
  }
}
