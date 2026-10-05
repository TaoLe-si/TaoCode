// 后台任务与进度面板（IDEA InfoAndProgressPanel / ProcessPopup）。
// 从 App.vue 拆出（桃 2026-09-26：模块化）；状态由模块自持，依赖经 ctx 惰性注入。
import { computed, onScopeDispose, ref, watch } from 'vue'
import { popupRows, updateFinishedLatch } from './processPopup.ts'
import { request } from './bridge.ts'
import { errorMessage } from './errors.ts'
import { gradleOutputTail } from './gradle.ts'
import { backgroundTaskQueue } from './backgroundTasks.ts'
import { lspProgressLabel } from './lspProgress.ts'
import type { LspProgressTask } from './lspProgress.ts'
// 并发任务表与心跳（上游 `ConcurrentTasksProgressManager`/`PingProgress`，见 src/progressTasks.ts）：
// 本地长任务（整工程检查等）登记在同一张表里，"已用多久"那一拍由心跳驱动。
import { backgroundTaskManager, createPingProgress } from './progressTasks.ts'

/**
 * 一行后面能挂的取消动作。`lsp` 那一条带的不是布尔而是**它自己要发回去的那对参数**：
 * LSP 的取消是 `window/workDoneProgress/cancel` + 当初那个 token，token 是服务器给的，
 * 只能跟着这一行走（上游也是这样：每行带自己的取消回调）。
 * `task` 那一档同理 —— 通用任务表里每条任务带自己的 `onCancel`
 * （`ProgressIndicatorModel.kt:25-37` 那个委托），只能按 id 找回它。
 */
export type ProgressCancel = 'git' | 'clone' | 'run' | 'gradle' | 'background' | { task: string } | { lsp: { language: string; token: string } }
export type ProgressCancelKind = false | ProgressCancel

export interface ProgressPanelContext {
  gitProgress: () => { running: boolean; queued: number }
  cloneProgress: () => string[]
  cancelling: () => boolean
  runState: () => { running: boolean }
  /** Gradle 同步（IDEA 的 ExternalSystem 进度：它**不占运行控制台**，所以在面板里单列一条）。 */
  gradleSync: () => { running: boolean; command: string; startedAt: number; output: string }
  /** 语言服务 `$/progress` 正在跑的那些任务（IDEA 同样把它们做成状态栏那一条带的行）。 */
  lspProgress: () => LspProgressTask[]
  autoShowPopup: () => boolean
  /** 取消失败时的提示（原生会回错误码，不能静默）。 */
  notify: (message: string, error?: boolean) => void
}

/** 已用秒数的文字（没有起点 = 空）。 */
export function elapsedLabel(since: number, now: number): string {
  if (!since || now < since) return ''
  const seconds = Math.floor((now - since) / 1000)
  if (seconds < 60) return `已 ${seconds} 秒`
  return `已 ${Math.floor(seconds / 60)} 分 ${seconds % 60} 秒`
}

export function createProgressPanel(ctx: ProgressPanelContext) {
  // IDEA's InfoAndProgressPanel collects the background tasks with a progress:
  // the git worker queue, the project clone, and a build/run. Indeterminate by
  // nature (a git command has no total), exactly like IDEA's spinner rows.
  //
  const backgroundTasks = computed(() => {
    const tasks: { title: string; detail: string; cancellable: ProgressCancelKind; percent: number | null }[] = []
    const git = ctx.gitProgress()
    if (git.running) tasks.push({ title: 'Git 操作进行中', detail: git.queued > 0 ? `队列中还有 ${git.queued} 个操作` : '正在执行 Git 命令', cancellable: 'git', percent: null })
    const clone = ctx.cloneProgress()
    if (ctx.cancelling() || clone.length) tasks.push({ title: '正在克隆项目', detail: clone.length ? clone[clone.length - 1].slice(0, 120) : '准备中', cancellable: 'clone', percent: null })
    if (ctx.runState().running) tasks.push({ title: '构建/运行进行中', detail: '输出在下方控制台', cancellable: 'run', percent: null })
    const gradle = ctx.gradleSync()
    // 「同步 Gradle 项目」在 IDEA 里也是后台任务（ExternalSystem 自己的进度），所以给一条可取消的行。
    // 百分比这一栏**如实留空**：CLI 那条通道没有 Tooling API 的 progress/total（对照
    // `ExternalSystemTaskProgressIndicatorUpdater.kt` 的 `total <= 0 ⇒ setIndeterminate(true)`），
    // 拿不到的东西不编 —— 能给的只有命令行、已用时间与最新一条输出。
    if (gradle.running) {
      const tail = gradleOutputTail(gradle.output, 1)[0] ?? ''
      tasks.push({
        title: '正在同步 Gradle 项目',
        detail: [elapsedLabel(gradle.startedAt, now.value), tail || gradle.command].filter(Boolean).join(' · ') || '准备中',
        cancellable: 'gradle',
        percent: null,
      })
    }
    // 后台任务队列的**排队深度**（`BackgroundTaskQueue` 在 `src/backgroundTasks.ts`；
    // 正在跑的那条由各功能自己的进度行承担 —— 队列这里只在有人排队时补一行，不然同一个操作会出现两行）。
    const queueRow = backgroundTaskQueue.queueRow.value
    if (queueRow) tasks.push({ title: queueRow.title, detail: queueRow.detail, cancellable: false, percent: queueRow.percent })
    // 语言服务的 `$/progress`：服务器给了百分比就是确定式的（带条），没给就跟着不确定式。
    for (const task of ctx.lspProgress()) {
      const elapsed = elapsedLabel(task.since, now.value)
      tasks.push({
        title: task.title,
        detail: [task.details, lspProgressLabel(task), elapsed].filter(Boolean).join(' · '),
          // 取消按钮只在服务器于 begin 里说了 `cancellable: true` 时才给（上游同一个判据：
        // `LspServerNotificationsHandlerImpl.kt:283`），点了就回发那条通知（:286-292）。
        cancellable: task.cancellable ? { lsp: { language: task.language, token: task.token } } : false,
        percent: task.percent >= 0 ? task.percent : null,
      })
    }
    // 并发任务表（`src/progressTasks.ts` 的 `ConcurrentTasksProgressManager`，上游同名类）：
    // 本地长任务（Analyze → Inspect Code 的整工程检查）在 `src/workspaceInspection.ts` 登记一行；
    // 拿不到总量的按不确定式显示，不编百分比。
    // 取消按钮跟着那一行自己的 `onCancel` 走（`ProgressIndicatorModel.kt:25-37` 那个委托）——
    // 之前这里写死 false，于是通用任务表登记的任务永远取消不掉，而模板与回调都是现成的。
    for (const task of backgroundTaskManager.tasks()) {
      const elapsed = elapsedLabel(task.startedAt, now.value)
      tasks.push({
        title: task.title,
        detail: [task.detail, elapsed].filter(Boolean).join(' · '),
        cancellable: task.cancellable ? { task: task.id } : false,
        percent: task.percent >= 0 ? task.percent : null,
      })
    }
    return tasks
  })
  // "已跑多久"要有个节拍：上游那条秒数不在这里自己跳 —— 面板只在 `backgroundTasks` 变化时重算，
  // 而跑一分钟不动的构建不会变化任何东西，所以给一条**只在有任务时**开着的心跳
  // （`PingProgress` 的 DOM 等价物，见 src/progressTasks.ts 的 `createPingProgress`）。
  const now = ref(Date.now())
  const heartbeat = createPingProgress({ onTick: () => { now.value = Date.now() } })
  watch(() => backgroundTasks.value.length > 0, running => {
    if (running) { heartbeat.start(); return }
    heartbeat.stop()
  })
  onScopeDispose(() => heartbeat.stop())

  const progressOpen = ref(false)
  // IDEA 的 ide.windowSystem.autoShowProcessPopup（registry.properties:209-210，默认 false；
  // InfoAndProgressPanel.kt:319-321 读一次）：有进程开始跑时自动弹出进度面板。TaoCode 没有注册表
  // 对话框，所以把它升格为持久化设置（系统设置页），语义与默认值都跟源码一致。
  watch(() => backgroundTasks.value.length, (count, previous) => {
    if (count > (previous ?? 0) && ctx.autoShowPopup()) progressOpen.value = true
  })
  // ProcessPopup.java:100-133 + TasksFinishedDecorator.kt:19-46 — the popup is a real list, not only a
  // running-task list: with nothing running it either says "all background tasks completed" (once
  // something has run) or "no processes are running" (nothing ever did), and ShowProcessWindow
  // (status/ShowProcessWindowAction.java:16-55) can open it while idle.
  const allTasksFinishedOnce = ref(false)
  watch(() => backgroundTasks.value.length, (count, previous) => {
    allTasksFinishedOnce.value = updateFinishedLatch(allTasksFinishedOnce.value, count > 0, (previous ?? 0) > 0)
  })
  const progressRows = computed(() => popupRows(backgroundTasks.value, allTasksFinishedOnce.value))
  // 「取消」按钮要发哪个请求，是**这一行自己的事**（IDEA 的 `ProcessPopup` 里每行也带自己的取消回调），
  // 所以这个 switch 放在面板里，而不是让宿主持有一张 kind → 请求的映射表。
  async function cancelBackgroundTask(target: ProgressCancel) {
    try {
      if (typeof target !== 'string') {
        // 通用任务表：走它自己那条的 `onCancel`（先调回调、再把那一行收掉）。
        if ('task' in target) { backgroundTaskManager.cancel(target.task); return }
        await request('lsp.cancelProgress', target.lsp)
        return
      }
      if (target === 'git') await request('git.cancel')
      else if (target === 'clone') await request('project.clone.cancel')
      else if (target === 'gradle') await request('gradle.cancel')
      // 队列里正在跑的那条：取消走它自己的 `onCancel`（`ProgressIndicatorModel` 的取消回调），
      // 不是又一条宿主请求 —— 入队者已经把它接到对应的宿主取消上。
      // 点完还要**等它真的收尾**（协作式取消：任务体走到下一个 `checkCanceled()` 才停，
      // 见 `ProgressIndicatorUtils.java:313-314`）；等不到就如实报一句，不假装按钮生效了。
      else if (target === 'background') {
        void backgroundTaskQueue.cancelCurrentAndAwait().then(done => {
          if (!done) ctx.notify('后台任务没有响应取消，仍在运行。', true)
        })
      }
      else await request('run.stop')
    } catch (error) { ctx.notify(errorMessage(error), true) }
  }
  function cancelProgressRow(row: { cancellable?: ProgressCancelKind }) {
    if (row.cancellable) void cancelBackgroundTask(row.cancellable)
  }
  return { backgroundTasks, progressOpen, allTasksFinishedOnce, progressRows, cancelProgressRow }
}
