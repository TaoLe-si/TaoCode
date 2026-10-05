// Pure logic behind IDEA's process popup (the list of background tasks under the status bar).
// Source: platform/platform-impl/src/com/intellij/openapi/wm/impl/status/ProcessPopup.java,
// TasksFinishedDecorator.kt and SeparatorDecorator.kt.

/** `IdeBundle.properties:3346` — `all.background.tasks.completed`. */
export const ALL_TASKS_FINISHED = '全部后台任务已完成'
/** `IdeBundle.properties:951` — `progress.window.empty.text`. */
export const NO_PROCESSES_RUNNING = '无进程正在运行。'

export interface RunningTask<C = unknown> {
  title: string
  detail: string
  /** Present when the task can be cancelled (`ProgressComponent.cancel`). */
  cancellable?: C
  /**
   * 0-100 的完成度；`null`/缺省 = **不确定式**（上游那条判据：`ExternalSystemTaskProgressIndicatorUpdater.kt`
   * 的 `if (total <= 0) indicator.setIndeterminate(true)` —— 拿不到总数就不画百分比，而不是编一个）。
   * 弹窗里每行本身就是一条进度条（`ProgressComponent.kt:55`/`:66` 的 `progress: JProgressBar`，
   * 不确定式 vs 确定式由 `ProgressComponent.kt:190-198` 决定）。
   */
  percent?: number | null
}

export type ProcessRowKind = 'task' | 'finished' | 'empty'

export interface ProcessRow<C = unknown> {
  kind: ProcessRowKind
  title: string
  detail: string
  cancellable?: C
  /** 从任务带过来：有数字才画条，null 就是那条转圈的（见 RunningTask.percent）。 */
  percent: number | null
  /** `SeparatorDecorator.placeSeparators` — only set when this row is a progress indicator. */
  separator: boolean
}

/**
 * The contents of the popup's indicator panel.
 *
 * `TasksFinishedDecorator.kt:23-32`: adding an indicator removes the "all tasks finished" label
 * (`indicatorAdded`), removing one puts it back **at index 0** — but only while no indicator
 * remains (`indicatorRemoved` returns early otherwise). So the label appears exactly when the list
 * is empty *and* something has already run; a panel that never saw a task stays empty and shows
 * `progress.window.empty.text` (`ProcessPopup.java:80`, `MyJBPanelWithEmptyText` at `:351-352`).
 *
 * `SeparatorDecorator.kt:31-43` walks the panel and enables a component's separator only when the
 * component *before* it was also a progress indicator (`ProcessPopup.java:258-260`), so the first
 * task row never draws one — and neither does the finished label, which additionally has its
 * separator switched off explicitly (`TasksFinishedDecorator.kt:42` -> `ProcessPopup.java:251-256`).
 */
export function popupRows<C>(tasks: readonly RunningTask<C>[], finishedOnce: boolean): ProcessRow<C>[] {
  if (tasks.length) {
    return tasks.map((task, index) => ({
      kind: 'task' as const,
      title: task.title,
      detail: task.detail,
      cancellable: task.cancellable,
      percent: task.percent ?? null,
      separator: index > 0,
    }))
  }
  if (finishedOnce) return [{ kind: 'finished', title: ALL_TASKS_FINISHED, detail: '', percent: null, separator: false }]
  return [{ kind: 'empty', title: NO_PROCESSES_RUNNING, detail: '', percent: null, separator: false }]
}

/**
 * `InfoAndProgressPanel` hides the inline indicator while nothing runs, but
 * `ShowProcessWindowAction` (`status/ShowProcessWindowAction.java:16-55`) opens the popup anyway —
 * so the widget that anchors the popup has to exist while the popup is open even with zero tasks.
 */
export function showProgressWidget(hasRunningTasks: boolean, popupOpen: boolean): boolean {
  return hasRunningTasks || popupOpen
}

/**
 * `TasksFinishedDecorator.kt:23-32` in state form. At startup the panel never saw an indicator, so
 * nothing has finished and the popup falls back to `progress.window.empty.text`. Adding an indicator
 * only removes the label (`indicatorAdded`, `:23-25`) while the next removal puts it straight back
 * (`indicatorRemoved`, `:27-32`), so the latch never goes back to false — `popupRows` is what hides
 * it again while tasks are running.
 */
export function updateFinishedLatch(latched: boolean, hasRunningTasks: boolean, hadRunningTasks: boolean): boolean {
  if (latched) return true
  return hadRunningTasks && !hasRunningTasks
}
