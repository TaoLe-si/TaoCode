// 后台任务的**挂起-恢复**（`pf/progress` 族里缺的那一条）——
// 上游 `com.intellij.openapi.progress.impl.ProgressSuspender`
// （`platform/platform-impl/src/com/intellij/openapi/progress/impl/ProgressSuspender.java`）
// 在单线程 DOM 宿主里的等价物。
//
// 逐条对照（右列是本仓的承接方式）：
//   · `markSuspendable(indicator, suspendedText)`（`:79-81`，构造里 `assert progress.isRunning()` `:48`）
//     → `createProgressSuspender(running, suspendedText)`：只对"正在跑"的任务生效。
//   · `suspendProcess(reason)`（`:123-137`）：已挂起或已 close 时是空操作；`reason` **临时覆盖**显示文案。
//     → 同语义；`reason` 传 null 时用构造那一句给的 `suspendedText`。
//   · `getSuspendedText()`（`:106-110`：`myTempReason != null ? myTempReason : mySuspendedText`）
//     → `suspendedText()` 同一个优先级；面板把它拼成「已挂起：<原因>」画在任务那一行。
//   · `resumeProcess()`（`:139-152`）：没挂起时空操作；清掉 `myTempReason`。
//   · `isSuspended`（`:112-114`）/ `isClosed`（`:116-118`）/ `close()`（`:66-77`：置 closed、清 suspended、摘映射）。
//   · `attachToProgress(progress)`（`:97-104`）：一个挂起器可以管好几条指示器。
//   · `getSuspender(indicator)`（`:93-95`，`ourProgressToSuspenderMap` `:44`）→ `suspenderFor(taskId)`。
//   · `executeNonSuspendableSection(indicator, runnable)`（`:83-91`）：段落计数（同一指示器可以嵌套），
//     段内 `freezeIfNeeded` 直接返回 false（`:162-164`）⇒ **挂起请求打不断这一段**。
//   · 取消时先 resume（`:55-61` 那条 `ProgressIndicatorListener.cancelled()`）：
//     挂起中的任务被取消时必须让它走下去，否则卡在等待里永远收不了尾。
//   · `freezeIfNeeded`（`:154-181`）：`while (mySuspended) myLock.wait(10000)` ——
//     上游把调用线程**阻塞**在那儿。本仓是 JS：不能阻塞（一阻塞整个界面就没了），
//     等价物是 `await waitWhileSuspended()`：挂起期间这一拍不往下走，恢复时 Promise 落地。
//     上游那个 10 秒轮询在这里不需要（不是等锁，而是等回调），如实记在这。
//   · `SuspenderListener.suspendedStatusChanged`（`:192-204`）→ `onStateChanged` 回调；
//     消费它的正是 `TaskToProgressSuspenderSynchronizer`/`TaskInfoEntityCollector:164-172`
//     那两处的可见效果 —— 状态一变就把任务标成暂停并把文案推给 UI。
//
// **谁来挂起**：上游是写请求抢占 NonBlockingReadAction（`ProgressSuspender.java:136` 那句
// `invokeLater { WriteAction.run {} }`）与 `TaskStatus.Paused(reason)`
// （`TaskInfoEntityCollector.kt:183-192`）。本仓没有读写锁，能对应上"外部要求让路"的真实信号是
// **省电模式** —— 上游开省电时给的通知正文写着「代码洞察和后台任务已禁用。」
// （`lang-impl/src/com/intellij/ide/actions/PowerSaveModeNotifier.kt:33-47` +
// `IdeBundle.properties` 中文取值 `power.save.mode.on.notification.content` = `:2028`）。
// 所以本仓的触发者是省电模式：开 ⇒ 正在跑的后台任务挂起（不取消），关 ⇒ 继续。

/** 一条"正在跑"的任务能给出的那两件事。 */
export interface SuspendableTask {
  /** 任务是否还在跑（上游 `assert progress.isRunning()`）。 */
  readonly running: boolean
  /** 被取消时要把挂起状态清掉（上游给指示器装的 `cancelled()` 监听）。 */
  onCancel?: (resume: () => void) => void
}

export interface ProgressSuspender {
  /** 这条任务归哪个挂起器管（上游 `attachToProgress`）。 */
  readonly taskId: string
  readonly suspendedText: string
  isSuspended: () => boolean
  isClosed: () => boolean
  /** `getSuspendedText()`：临时原因优先，其次构造给的那句。 */
  text: () => string
  /** `suspendProcess(reason)`：已挂起 / 已 close 时空操作。 */
  suspend: (reason?: string | null) => void
  /** `resumeProcess()`：没挂起时空操作。 */
  resume: () => void
  /** `executeNonSuspendableSection`：段内不接受挂起（嵌套计数）。 */
  runNonSuspendable: (body: () => void) => void
  /** 段内是否有还在跑的段（`myProgressesInNonSuspendableSections` 的判据）。 */
  inNonSuspendableSection: () => boolean
  /** `freezeIfNeeded` 的等价物：挂起时给出一个到恢复才落地的 Promise；不允许挂起时立刻结束。 */
  waitWhileSuspended: () => Promise<void>
  /** `close()`：置 closed、清 suspended、摘掉监听。 */
  close: () => void
  /** `SuspenderListener.suspendedStatusChanged`（多个订阅者）。 */
  onStateChanged: (listener: (suspended: boolean) => void) => () => void
}

/**
 * 建一个挂起器。`task.running` 为 false 时按上游那条 assert 直接拒绝——
 * 给没在跑的任务挂"挂起"是没有意义的状态。
 */
export function createProgressSuspender(taskId: string, suspendedText: string, task: SuspendableTask): ProgressSuspender {
  if (!task.running) throw new Error(`任务 ${taskId} 没在跑，不能给它建挂起器`)
  let suspended = false
  let tempReason: string | null = null
  let closed = false
  let nonSuspendableDepth = 0
  const listeners = new Set<(suspended: boolean) => void>()
  const notify = () => { for (const listener of [...listeners]) listener(suspended) }
  const suspender: ProgressSuspender = {
    taskId,
    suspendedText,
    isSuspended: () => suspended,
    isClosed: () => closed,
    text: () => tempReason ?? suspendedText,
    suspend(reason = null) {
      // `:125` 那句 `if (mySuspended || myClosed) return`。
      if (suspended || closed) return
      suspended = true
      tempReason = reason
      notify()
    },
    resume() {
      if (!suspended) return
      suspended = false
      tempReason = null
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
      tempReason = null
      listeners.clear()
    },
    onStateChanged(listener) {
      listeners.add(listener)
      return () => { listeners.delete(listener) }
    },
  }
  // `:55-61`：取消 ⇒ resumeProcess()。挂起中的任务被取消时必须能走下去，
  // 否则它卡在自己的 `waitWhileSuspended()` 里永远收不了尾。
  task.onCancel?.(() => suspender.resume())
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

  /** `getSuspender(indicator)`。 */
  getSuspender(taskId: string): ProgressSuspender | null {
    return this.map.get(taskId) ?? null
  }

  /** 此刻挂起着的任务（面板据此把行标成「已挂起：<原因>」）。 */
  suspended(): ProgressSuspender[] {
    return [...this.map.values()].filter(suspender => !suspender.isClosed() && suspender.isSuspended())
  }

  suspendAll(reason: string | null = null): void {
    for (const suspender of this.map.values()) suspender.suspend(reason)
  }

  resumeAll(): void {
    for (const suspender of this.map.values()) suspender.resume()
  }

  /** 任务结束（`ProgressSuspenderTracker` 的 stopTracking + `close()`）。 */
  untrack(taskId: string): void {
    const suspender = this.map.get(taskId)
    if (!suspender) return
    this.map.delete(taskId)
    suspender.close()
  }

  clear(): void {
    for (const suspender of [...this.map.values()]) { this.map.delete(suspender.taskId); suspender.close() }
  }
}
