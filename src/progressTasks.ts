// 并发后台任务的**调度与心跳** —— 上游 `ide-core-impl/openapi/progress/util` 一族
// （`BackgroundTaskUtil`/`PingProgress`/`ProgressIndicatorUtils`/`ConcurrentTasksProgressManager`/
// `SubTaskProgressIndicator`）在 DOM 宿主里的等价物。
//
// 逐条对照：
//   · `ConcurrentTasksProgressManager` —— 多个任务共用一个指示器：任务表按加入顺序，
//     `ConcurrentTasksProgressManager` 把**后加入的任务**挂在最上面（指示器显示当前任务），
//     全体都有 fraction 时才给得出合并的进度。本仓同形：`tasks()` 按开始时间，
//     `aggregatePercent()` 全部有百分比才给平均值，否则 `-1`（不确定式）。
//   · `PingProgress` —— 心跳式进度：任务长时间没有新消息时，靠周期性的 `ping()` 保持"活着"。
//     本仓的显示层（`src/progressPanel.ts` 的秒表、`src/progressNotices.ts` 的耗时行）就是它的消费者：
//     面板只在数据变化时重算，"跑一分钟不动的构建"不变化任何东西，所以要一条只在有任务时开着的心跳。
//   · `SubTaskProgressIndicator` —— 子任务占父任务的一个分数区间（`startFraction`/`endFraction`），
//     子进度按 `start + (end - start) * fraction` 折进父指示器。本仓给纯函数 + 一个小状态类。
//   · `BackgroundTaskUtil` —— `executeWithProgress`/`runUnderProgress`：起任务、跑、无论如何收尾。
//     本仓的 `runBackgroundTask` 同语义：异常也把任务从表里收掉（否则界面里永远留一行）。
//
// 消费链路：`src/workspaceInspection.ts` 的整工程检查（Analyze → Inspect Code）在
// `backgroundTaskManager` 里登记一行，`src/progressPanel.ts` 把它渲染进状态栏的后台任务列表，
// 并用 `createPingProgress` 驱动"已用多久"那一拍。

import { reactive } from 'vue'

export interface ProgressTaskSnapshot {
  id: string
  title: string
  detail: string
  /** 0-100；`-1` = 不确定式（拿不到总量，不编数字 —— 与 LSP `$/progress` 同口径）。 */
  percent: number
  /** 有取消回调的任务才给取消按钮。 */
  cancellable: boolean
  /** 毫秒时间戳（begin 那一刻）。 */
  startedAt: number
}

export interface ProgressTaskOptions {
  detail?: string
  percent?: number
  /**
   * 可取消档（`ProgressIndicatorModel.kt:16` 的 `cancellation: TaskCancellation`，
   * `:23` 的 `TaskCancellation.nonCancellable()` 那一档）。不给就按有没有 `onCancel` 推。
   */
  cancellable?: boolean
  /**
   * 取消回调。照 `ProgressIndicatorModel` 那个 `onCancel` 构造（`:25-37`）：
   * 装成一个 `cancel()` 的委托，**先调它**（`:33` `onCancel.invoke()`）**再**真取消（`:34`
   * `super.cancel()`）。本仓的"真取消"就是把这一行从表里收掉。
   */
  onCancel?: () => void
  now?: () => number
}

/**
 * `ConcurrentTasksProgressManager` 的等价物：一个任务表 + 一个"当前任务"的选择规则。
 * 表用 reactive 包着（状态栏面板直接读它，和 `lspProgressTasks` 一个用法）。
 */
export class ConcurrentTasksProgressManager {
  private readonly table = reactive<Record<string, ProgressTaskSnapshot>>({})
  /**
   * 取消回调不进 `reactive` 表：它不是可渲染的数据（上游把它装成指示器的委托，
   * `ProgressIndicatorModel.kt:31-36`），混进快照会让"渲染用 computed"跟着一个函数身份变化而重算。
   */
  private readonly cancelHandlers = new Map<string, () => void>()
  private readonly now: () => number

  constructor(now: () => number = () => Date.now()) {
    this.now = now
  }

  /** 起任务（同 id 再 begin = 只覆盖标题，不重置开始时间 —— 上游合并并发任务时不重置）。 */
  begin(id: string, title: string, options: ProgressTaskOptions = {}): ProgressTaskSnapshot {
    const existing = this.table[id]
    if (existing) {
      existing.title = title
      if (options.detail !== undefined) existing.detail = options.detail
      if (options.percent !== undefined) existing.percent = options.percent
      if (options.cancellable !== undefined) existing.cancellable = options.cancellable
      if (options.onCancel !== undefined) this.cancelHandlers.set(id, options.onCancel)
      return existing
    }
    const snapshot: ProgressTaskSnapshot = {
      id,
      title,
      detail: options.detail ?? '',
      percent: options.percent ?? -1,
      // `:23` 那一档：显式给了就照给的；没给但给了回调，回调存在就意味着可取消。
      cancellable: options.cancellable ?? options.onCancel !== undefined,
      startedAt: this.now(),
    }
    if (options.onCancel) this.cancelHandlers.set(id, options.onCancel)
    this.table[id] = snapshot
    return snapshot
  }

  /** 只覆盖发出来的字段（`?:` 语义，与 LSP progress 的 report 同一约定）。 */
  update(id: string, patch: { title?: string; detail?: string; percent?: number }): void {
    const task = this.table[id]
    if (!task) return
    if (patch.title !== undefined) task.title = patch.title
    if (patch.detail !== undefined) task.detail = patch.detail
    if (patch.percent !== undefined) task.percent = patch.percent
  }

  get(id: string): ProgressTaskSnapshot | null {
    return this.table[id] ?? null
  }

  /** 走 `end`（没有这条任务也不报错 —— 收尾要幂等）。 */
  end(id: string): void {
    delete this.table[id]
    this.cancelHandlers.delete(id)
  }

  /**
   * 取消这一条（`ProgressIndicatorModel.cancel()`，`:79-80` `progressIndicator.cancel()`）。
   * 顺序照那个 `onCancel` 委托（`:32-34`）：**先调回调、再把这一行收掉**。
   * 回调抛错也要把行收掉 —— 否则界面里永远留一条转不掉的行。
   * 返回有没有真的取消掉一条（没有这条任务 / 不可取消 ⇒ false）。
   */
  cancel(id: string): boolean {
    const task = this.table[id]
    if (!task || !task.cancellable) return false
    const onCancel = this.cancelHandlers.get(id)
    try {
      onCancel?.()
    } finally {
      this.end(id)
    }
    return true
  }

  /** 正在跑的任务，按开始时间（稳定顺序 = 加入顺序）。 */
  tasks(): ProgressTaskSnapshot[] {
    return Object.values(this.table).sort((a, b) => a.startedAt - b.startedAt)
  }

  /** 当前任务（最早开始的那个；上游指示器显示的就是它）。 */
  primaryTask(): ProgressTaskSnapshot | null {
    return this.tasks()[0] ?? null
  }

  get size(): number {
    return Object.keys(this.table).length
  }

  clear(): void {
    for (const key of Object.keys(this.table)) delete this.table[key]
    this.cancelHandlers.clear()
  }
}

/** 进程级任务表（与 `lspProgressTasks` 同一模式：模块级 reactive 表 + 直接 import 的消费者）。 */
export const backgroundTaskManager = new ConcurrentTasksProgressManager()

export function beginBackgroundTask(id: string, title: string, options: ProgressTaskOptions = {}): ProgressTaskSnapshot {
  return backgroundTaskManager.begin(id, title, options)
}

export function reportBackgroundTask(id: string, patch: { title?: string; detail?: string; percent?: number }): void {
  backgroundTaskManager.update(id, patch)
}

export function endBackgroundTask(id: string): void {
  backgroundTaskManager.end(id)
}

/** 多个任务合并后的百分比：全体都有百分比才给平均，否则 -1（`ConcurrentTasksProgressManager` 的合并面）。 */
export function aggregatePercent(tasks: readonly ProgressTaskSnapshot[]): number {
  if (!tasks.length) return -1
  if (tasks.some(task => task.percent < 0)) return -1
  return Math.round(tasks.reduce((sum, task) => sum + task.percent, 0) / tasks.length)
}

// ── `PingProgress`：心跳 ─────────────────────────────────────────────────────────────────

export interface PingProgressOptions {
  /** 心跳间隔（毫秒）。上游 `PingProgress` 的 ping 周期同量级（1 秒）。 */
  intervalMs?: number
  onTick: () => void
  setIntervalFn?: (handler: () => void, timeout: number) => unknown
  clearIntervalFn?: (handle: unknown) => void
}

export interface PingProgress {
  /** 最近一次心跳的时刻（0 = 没跑过）。 */
  lastPingAt: () => number
  /** 现在有没有在跳。 */
  isRunning: () => boolean
  start: () => void
  /** 手动跳一次（停表后补一拍；判据里也用它，不开真定时器）。 */
  tick: () => void
  stop: () => void
}

export const PING_INTERVAL_MS = 1000

/**
 * 心跳式进度：只在有任务时开着，每隔 `intervalMs` 叫一次 `onTick`（面板据此重算"已用 N 秒"）。
 * `start` 幂等（重复 start 不会叠出两条定时器）。
 */
export function createPingProgress(options: PingProgressOptions): PingProgress {
  const intervalMs = options.intervalMs ?? PING_INTERVAL_MS
  const setIntervalFn = options.setIntervalFn ?? ((handler, timeout) => setInterval(handler, timeout))
  const clearIntervalFn = options.clearIntervalFn ?? (handle => clearInterval(handle as ReturnType<typeof setInterval>))
  let handle: unknown = null
  let lastPingAt = 0
  const tick = () => { lastPingAt = Date.now(); options.onTick() }
  return {
    lastPingAt: () => lastPingAt,
    isRunning: () => handle !== null,
    start() {
      if (handle !== null) return
      tick()
      handle = setIntervalFn(tick, intervalMs)
    },
    tick,
    stop() {
      if (handle !== null) { clearIntervalFn(handle); handle = null }
    },
  }
}

// ── `SubTaskProgressIndicator`：子任务占父任务的一个分数区间 ───────────────────────────────

export interface SubTaskRange {
  start: number
  end: number
}

/** 子任务的分数区间（0..1）；越界参数夹住（上游 `startFraction`/`endFraction` 也要合法）。 */
export function subTaskRange(start: number, end: number): SubTaskRange {
  const lo = Math.min(Math.max(0, start), 1)
  const hi = Math.min(Math.max(lo, end), 1)
  return { start: lo, end: hi }
}

/** 子进度折进父指示器：`start + (end - start) * fraction`，fraction 夹在 0..1。 */
export function mapSubFraction(range: SubTaskRange, fraction: number): number {
  const value = Math.min(Math.max(0, fraction), 1)
  return range.start + (range.end - range.start) * value
}

/** 一个子任务的指示器状态：多次 report 取最后一次（上游 `setFraction` 同理）。 */
export class SubTaskProgress {
  readonly range: SubTaskRange
  private lastFraction: number

  constructor(start: number, end: number, initial = 0) {
    this.range = subTaskRange(start, end)
    this.lastFraction = Math.min(Math.max(0, initial), 1)
  }

  setFraction(fraction: number): number {
    this.lastFraction = Math.min(Math.max(0, fraction), 1)
    return this.parentFraction()
  }

  parentFraction(): number {
    return mapSubFraction(this.range, this.lastFraction)
  }

  /** 子任务结束时把父进度推到区间右端（上游子任务 finish 后父进度落在 endFraction）。 */
  finish(): number {
    return this.setFraction(1)
  }
}

// ── `BackgroundTaskUtil`：起/跑/收尾 ───────────────────────────────────────────────────

export interface BackgroundTaskOptions<T> {
  id: string
  title: string
  detail?: string
  cancellable?: boolean
  manager?: ConcurrentTasksProgressManager
  /** 任务体：`report` 更新表里那一行；`signal` 在取消时 abort。 */
  task: (report: (patch: { detail?: string; percent?: number }) => void, signal: AbortSignal) => Promise<T>
}

/**
 * `BackgroundTaskUtil.executeWithProgress` 的等价物：登记一行 → 跑 → **无论如何**收掉那一行
 * （异常也收；否则界面里永远留一条在转的行 —— 上游用 try/finally 保这一条）。
 */
export async function runBackgroundTask<T>(options: BackgroundTaskOptions<T>): Promise<T> {
  const manager = options.manager ?? backgroundTaskManager
  const controller = new AbortController()
  manager.begin(options.id, options.title, { detail: options.detail, cancellable: options.cancellable })
  try {
    return await options.task(patch => manager.update(options.id, patch), controller.signal)
  } finally {
    manager.end(options.id)
  }
}
