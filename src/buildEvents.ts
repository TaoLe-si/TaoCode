// 构建事件与进度树 —— 上游 `platform/lang-impl/src/com/intellij/build/events/` 与
// `.../build/progress/` 一族在本仓的**有界子集**。
//
// 上游是什么：`BuildProgressListener` 收 `BuildEvent`，`BuildRootProgressImpl`/`ChildBuildProgressImpl`
// 是发事件的那一侧（`start`/`progress`/`finish`/`fail`/`cancel`/`output`/`message`），
// `BuildEventDispatcher` 把它们分发给视图，`MultipleBuildsView`/`BuildTreeConsoleView` 按
// **parentId 组成的树**渲染（`BuildTreeViewModel`）。本仓是命令行输出流（`native/gradle.cpp` 把
// 子进程 stdout 原样回传），**没有事件对象**，所以这里做两件事：
//   1. 事件模型本体（`BuildEvent` / `EventResult` / `BuildProgressNode`）—— 照上游字段的形状，
//      可移植的那几档：id/parentId/time/message + progress(total/progress/unit) + result。
//   2. 一台**有界的输出→事件**折算器（`gradleBuildEvents`）：Gradle CLI 的输出里带任务边界
//      （`> Task :app:compileJava`）、结论（`UP-TO-DATE`/`FAILED`/`SKIPPED`）与总结果
//      （`BUILD SUCCESSFUL in 3s` / `FAILURE:`），足以还原出上游那棵**按任务分组的进度树**。
//      折算不出来的行一律当 `output` 事件挂在当前节点下（不猜任务边界）。
//      任务结论的两条补法（都属于"硬信号"）：无后缀的 `> Task` 只证明**开始执行**，下一条
//      任务 / Configure 行出现就反证它执行完了 ⇒ 补一条成功结论；收口时总结果行是
//      `BUILD SUCCESSFUL` **或进程退出码是 0**（`gradleSync.exit`，`cancelled` 不算）时，
//      最后那条无后缀的任务同样补成功。失败 / 取消 / 异常收口时
//      **不补**（没有证据），所以那种情况下最后一条任务会停在"没有结论"——如实留白，不编。
//
// 消费方：`src/components/GradlePanel.vue` 的同步输出区 —— 同步就是上游的一类 build
// （`ExternalSystemTaskProgressIndicatorUpdater` 把同步进度画成带 fraction 的进度条），
// 本仓把 `gradleSync.output` 折成树、逐任务显示状态与耗时；折不出事件时退回原来的平铺尾部
// （`gradleOutputTail`），行为与接入前一致。树的头部另有一条**进度条**（上游
// `build/console/BuildProgressStripe.java:37-56` 的判定表落在 `buildProgressStripe`，
// `(total, progress)` 由 `stripeProgressOf` 从这棵树现算：任务数 / 已有结论的任务数）。
//
// **如实说明做不到的**（判词里同样点名）：
//   · 上游 `BuildEventDispatcher.invokeOnCompletion` 的完成回调、`BuildProgress` 的
//     `startChildProgress`/`presentable` 与 `BuildViewSettingsProvider` —— 需要视图宿主，
//     本仓没有多视图与构建树控件；
//   · `BuildProgressStripe` 的 Swing 外壳（`ProgressBarLoadingDecorator` 的**延迟出现**与
//     不确定态的位移动画）：本仓只有一条静态条 + 面板上原有的"正在跑"行，不做假动画；
//   · 真实**增量**语义（`isUpToDate` 之外，Gradle 的 task outcome 只有 CLI 文本可读，
//     拿不到 Tooling API 的 `TaskOutcome` 对象）；
//   · `MessageEvent.Kind` 的 FILE/LOG/STATISTICS 细分与 `BuildIssue` 的快速修复
//     （本仓问题行只跳转到行列，见 `src/runIssues.ts`）。

/** `EventResult`（上游 `SuccessResult`/`FailureResult`/`SkippedResult`/`Failure` 四档）。 */
export type EventResultKind = 'success' | 'failure' | 'cancelled' | 'skipped'

export interface EventResult {
  kind: EventResultKind
  /** 上游 `SuccessResult.isUpToDate()`（Gradle 的 `UP-TO-DATE`）。 */
  upToDate?: boolean
  /** 失败/取消时的一句话（`FailureResultImpl.getError`）。 */
  message?: string
}

/** 事件种类（上游 `StartEvent`/`FinishEvent`/`ProgressBuildEvent`/`OutputBuildEvent`/`MessageEvent`）。 */
export type BuildEventKind = 'start' | 'finish' | 'progress' | 'output' | 'message'

export interface BuildEvent {
  /** 上游 `BuildEvent.getEventId`（与 `getParentId` 组成树）。 */
  id: string
  parentId: string | null
  kind: BuildEventKind
  /** 毫秒时间戳（本仓从同步起点按行序估：没有逐行时间，见文件头）。 */
  time: number
  message: string
  /** `progress` 档：上游 `ProgressBuildEvent.getTotal/getProgress/getUnit`。 */
  total?: number
  progress?: number
  unit?: string
  /** `finish` 档：上游 `FinishEvent.getResult`。 */
  result?: EventResult
  /** `output` 档：true = stdout，false = stderr（上游 `OutputBuildEvent.isStdOut`）。 */
  stdout?: boolean
}

/** 进度树的一个节点（`BuildTreeViewModel` 的一条；根是整次构建）。 */
export interface BuildProgressNode {
  id: string
  parentId: string | null
  message: string
  startedAt: number
  finishedAt: number | null
  result: EventResult | null
  /** 最新一次 `progress` 事件（没有就是 null）。 */
  progress: { total: number; progress: number; unit: string } | null
  /** 直接挂在这个节点下的输出行（`output` 事件）。 */
  output: string[]
  children: BuildProgressNode[]
}

/** 把一串事件按 id/parentId 折成树；没有任何 `start` 时返回 null（不是"空树"）。 */
export function buildProgressTree(events: readonly BuildEvent[]): BuildProgressNode | null {
  const nodes = new Map<string, BuildProgressNode>()
  const roots: BuildProgressNode[] = []
  const attach = (node: BuildProgressNode, parentId: string | null): void => {
    const parent = parentId === null ? null : nodes.get(parentId) ?? null
    if (parent) parent.children.push(node)
    else roots.push(node)
  }
  for (const event of events) {
    if (event.kind === 'start') {
      const node: BuildProgressNode = {
        id: event.id, parentId: event.parentId, message: event.message,
        startedAt: event.time, finishedAt: null, result: null, progress: null, output: [], children: [],
      }
      nodes.set(event.id, node)
      attach(node, event.parentId)
      continue
    }
    // 上游 `AbstractBuildProgress.event()` 给每条非 start 事件都带**同一个节点 id**
    // （`getStartId()`），parentId 另存 —— 所以先按 id 找节点，找不到再退回 parentId。
    const node = nodes.get(event.id) ?? (event.parentId ? nodes.get(event.parentId) ?? null : null)
    if (!node) continue
    if (event.kind === 'finish') {
      node.finishedAt = event.time
      node.result = event.result ?? { kind: 'success' }
      // `finish` 的 message 与 `start` 不同时以上游 `FinishEventImpl` 的语义显示收尾文案。
      if (event.message) node.message = node.message || event.message
    } else if (event.kind === 'progress') {
      node.progress = { total: event.total ?? -1, progress: event.progress ?? -1, unit: event.unit ?? '' }
    } else if (event.kind === 'output') {
      node.output.push(event.message)
    }
  }
  // 根取第一个（`BuildRootProgressImpl` 只发一次 start）；多根时按开始时间取最早那条。
  return roots.sort((left, right) => left.startedAt - right.startedAt)[0] ?? null
}

/** 一条 `progress` 事件的百分比（total <= 0 ⇒ -1，上游 `setIndeterminate`）。 */
export function progressPercent(node: BuildProgressNode): number {
  const value = node.progress
  if (!value || value.total <= 0) return -1
  return Math.max(0, Math.min(100, Math.round((value.progress / value.total) * 100)))
}

/** 子树里所有节点的扁平列表（前序），便于渲染。 */
export function flattenProgress(node: BuildProgressNode, depth = 0): { node: BuildProgressNode; depth: number }[] {
  return [{ node, depth }, ...node.children.flatMap(child => flattenProgress(child, depth + 1))]
}

/** 子树里的失败节点数（`FailureResult`/`Failure` 两档都算）。 */
export function countFailures(node: BuildProgressNode): number {
  const self = node.result?.kind === 'failure' ? 1 : 0
  return self + node.children.reduce((sum, child) => sum + countFailures(child), 0)
}

// ------------------------------------------------- 进度条（`build/console/BuildProgressStripe`）

/**
 * 进度条的两态（Swing 那边是 `JProgressBar` 的「值/不确定」）：
 *   · `loading` = `startLoading()`/`stopLoading()`（`:43-45`/`:59-65`）；
 *   · `determinate` = 这条进度条当前会不会给出百分比（`:48-55`）；
 *   · `percent` = `progress * 100 / total` 的**整数截断**（`:49` 的 `Math.toIntExact(progress * 100 / total)`）——
 *     与 `progressPercent` 的 `Math.round` 不同：那条算的是**单个节点自己的** progress 事件，
 *     这条算的是整条进度条（上游两处本来就不同源，不"统一"）。
 */
export interface BuildStripeState {
  /** 还在跑（`startLoading`）：`total === progress` 时收工（`stopLoading`）。 */
  loading: boolean
  /** `total > 0 && progress > 0`（`:46`）——**progress 为 0 不算 0%**，而是不确定态。 */
  determinate: boolean
  percent: number
}

/**
 * `BuildProgressStripe.updateProgress(total, progress)`（`BuildProgressStripe.java:37-56`）的判定表：
 *   · `total == progress` ⇒ 收工（`:38-41`）——空活儿（`0/0`）也走这一支（宿主的 `JProgressBar`
 *     初始不是不确定态，于是 `stopLoading` 把它置成 100，与上游逐字同形，不"顺手修正"）；
 *   · 否则确定态当且仅当 `total > 0 && progress > 0`，百分比整数截断；
 *   · 其余（`total <= 0` 或 `progress <= 0`）⇒ 不确定态（`:52-55` 的 `setIndeterminate(true)`）。
 */
export function buildProgressStripe(total: number, progress: number): BuildStripeState {
  if (total === progress) return { loading: false, determinate: true, percent: 100 }
  if (total > 0 && progress > 0) return { loading: true, determinate: true, percent: Math.trunc(progress * 100 / total) }
  return { loading: true, determinate: false, percent: 0 }
}

/**
 * 整次构建的 `(total, progress)`：本仓把它现算成**深度 > 0 的节点数 / 其中已有结论的节点数**
 * （`> Task` 与 `Configure project` 各算一条，根节点不算任务）。上游这两个数来自 `BuildProgress`
 * 的进度上报（`setProgress(progress, total)`），Gradle CLI 输出里没有数字，取这个等价物 ——
 * 折不出任务时 `total === progress === 0`，按上面的判定表就是「收工 + 满格」。
 */
export function stripeProgressOf(root: BuildProgressNode): { total: number; progress: number } {
  const nodes = flattenProgress(root).filter(row => row.depth > 0).map(row => row.node)
  return { total: nodes.length, progress: nodes.filter(node => node.finishedAt !== null).length }
}

// ---------------------------------------------------------------- 输出 → 事件（Gradle CLI）

/** `> Task :app:compileJava` 一族（`Task :` 后是任务路径，可带 `UP-TO-DATE`/`FAILED` 等后缀）。 */
const TASK_LINE = /^>\s*Task\s+(.+?)(?:\s+(UP-TO-DATE|FROM-CACHE|SKIPPED|NO-SOURCE|FAILED))?\s*$/
/** `> Configure project :app`（同步时最先出现的那一批）。 */
const CONFIGURE_LINE = /^>\s*Configure project\s+(.+?)\s*$/
/** `> Task :app:test FAILED` 之外的失败行：Gradle 的 `FAILURE:` 段。 */
const FAILURE_LINE = /^FAILURE:\s*(.*)$/
/** `BUILD SUCCESSFUL in 3s` / `BUILD FAILED in 1s`。 */
const BUILD_RESULT_LINE = /^BUILD (SUCCESSFUL|FAILED)(?:\s+in\s+(.+))?$/
/** `Deprecated Gradle features were used ...` 一族算 message（上游 MessageEvent）。 */
const WARNING_LINE = /^(Deprecated Gradle features|Configuration cache|warning:)\b/i

/** 任务后缀 → `EventResult`（`FAILED` 失败、其余都算跳过/最新）。 */
function taskResultOf(suffix: string | undefined): EventResult | undefined {
  if (!suffix) return undefined
  if (suffix === 'FAILED') return { kind: 'failure' }
  if (suffix === 'SKIPPED' || suffix === 'NO-SOURCE') return { kind: 'skipped' }
  return { kind: 'success', upToDate: true }   // UP-TO-DATE / FROM-CACHE
}

export interface GradleBuildEventsInput {
  /** 子进程累积输出（`gradleSync.output`）。 */
  output: string
  /** 同步起点毫秒时间戳（`gradleSync.startedAt`）。没有逐行时间，按行序估。 */
  startedAt: number
  /** 构建标签（根节点的 message，通常是 `gradle projects tasks`）。 */
  label: string
  /** 宿主给的失败文案（`gradleFailure(output)`）；有它时根节点结论按失败收口。 */
  error?: string
  /** 同步是否仍在进行（未结束时根节点不发 `finish`）。 */
  running?: boolean
  /** 结束时刻（`gradleSync.at`）；缺省用 startedAt。 */
  finishedAt?: number
  /** 同步进程的退出码（`gradleSync.exit`）。**0 = 干净退出**，与总结果行同级的一类硬信号。 */
  exitCode?: number | null
  /** 这次同步被取消了（`gradleSync.cancelled`）：取消时不补最后一条任务的结论。 */
  cancelled?: boolean
}

/**
 * Gradle CLI 输出 → 事件流。**有界**：只认任务边界、任务结论与总结果这三类硬信号，
 * 其余行都是挂在当前任务下的 `output`。空输出 ⇒ 只发一条根 `start`（不编任务）。
 */
export function gradleBuildEvents(input: GradleBuildEventsInput): BuildEvent[] {
  const events: BuildEvent[] = []
  const rootId = 'build:root'
  events.push({ id: rootId, parentId: null, kind: 'start', time: input.startedAt, message: input.label })
  /** 当前任务节点 id（`> Task` 之后的行挂在它下面）。 */
  let current: string | null = null
  /** 当前任务是不是已经有结论（带后缀的任务行自己就是结论，别再补第二条）。 */
  let concluded = false
  /**
   * 结掉当前任务：**无后缀的 `> Task` 只证明"开始执行"**，下一条任务/Configure 行出现就
   * 反证它执行完了（Gradle 只在任务失败或跳过时给后缀）⇒ 补一条成功结论。
   * 带后缀（已有结论）的任务在这里只清指针、**不覆盖**它的结论（FAILED 不能被改写成成功）。
   */
  const closeCurrent = (at: number): void => {
    if (current && !concluded) {
      events.push({ id: current, parentId: rootId, kind: 'finish', time: at, message: '', result: { kind: 'success' } })
    }
    current = null
    concluded = false
  }
  let sequence = 0
  let time = input.startedAt
  let result: EventResult | null = null
  const lines = input.output.split(/\r?\n/)
  for (const raw of lines) {
    // 行序当时间轴（每行 +1ms）：没有逐行时间戳，但顺序正确，进度树的先后关系不受影响。
    time += 1
    const line = raw.replace(/\u001B\[[0-9;]*[A-Za-z]/g, '').trimEnd()
    if (!line.trim()) continue
    const task = TASK_LINE.exec(line)
    if (task) {
      closeCurrent(time)
      const name = task[1]!.trim()
      const id = `task:${++sequence}:${name}`
      events.push({ id, parentId: rootId, kind: 'start', time, message: name })
      const verdict = taskResultOf(task[2])
      // 带后缀的任务行本身就是一条结论（Gradle 在任务行尾直接给 outcome）。
      if (verdict) {
        events.push({ id, parentId: rootId, kind: 'finish', time, message: '', result: verdict })
        concluded = true
      }
      current = id
      continue
    }
    const configure = CONFIGURE_LINE.exec(line)
    if (configure) {
      closeCurrent(time)
      const id = `configure:${++sequence}:${configure[1]!.trim()}`
      events.push({ id, parentId: rootId, kind: 'start', time, message: `Configure project ${configure[1]!.trim()}` })
      events.push({ id, parentId: rootId, kind: 'finish', time, message: '', result: { kind: 'success' } })
      continue
    }
    const outcome = BUILD_RESULT_LINE.exec(line)
    if (outcome) {
      result = outcome[1] === 'SUCCESSFUL' ? { kind: 'success' } : { kind: 'failure' }
      events.push({ id: rootId, parentId: null, kind: 'message', time, message: line.trim() })
      continue
    }
    const failure = FAILURE_LINE.exec(line)
    if (failure) {
      result = { kind: 'failure', message: failure[1]!.trim() }
      events.push({ id: rootId, parentId: null, kind: 'message', time, message: line.trim() })
      continue
    }
    if (WARNING_LINE.test(line)) {
      events.push({ id: rootId, parentId: null, kind: 'message', time, message: line.trim() })
      continue
    }
    events.push({ id: current ?? rootId, parentId: current ?? rootId, kind: 'output', time, message: line, stdout: true })
  }
  // 收口：宿主给了 error 就按失败；否则看 BUILD 结果行；都没有时（还在跑）不发 finish。
  if (input.error) result = { kind: 'failure', message: input.error }
  if (!input.running) {
    // 最后一条无后缀任务的收口证据：总结果行是成功，或进程**干净退出**（`exit === 0`）——
    // 两者都是"这次构建成功了"的硬信号。失败 / 取消 / 异常收口时不补（没有证据），宁可留白。
    const cleanSuccess = !input.cancelled && (result?.kind === 'success' || input.exitCode === 0)
    if (cleanSuccess) closeCurrent(input.finishedAt ?? time)
    events.push({
      id: rootId, parentId: null, kind: 'finish', time: input.finishedAt ?? time,
      message: '', result: result ?? { kind: 'success' },
    })
  }
  return events
}