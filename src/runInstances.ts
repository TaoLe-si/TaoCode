// 运行/构建的**多实例**状态（IDEA 的 Run 工具窗口按"正在运行的实例"开标签）。
//
// 从 src/bridge.ts 拆出并扩容（2026-09-27）：原先只有一组 `runOutput` / `runState`（单实例），
// 现在已经支持多个并发实例（宿主侧 native/run_host.cpp 的 `isAllowRunningInParallel` 语义），
// 所以「事件 → 哪个实例」这件事需要独立的归属地；桥接那一层只留转发。
//
// 与 IDEA 的对应（`platform/execution-impl/src/com/intellij/execution/impl/`）：
//   · `RunContentDescriptor`（一个正在运行的实例）= 这里的 `RunInstanceRecord`；
//   · `RunContentManagerImpl` 的"每个实例一个 Content" = 这里的 `runInstances`（按 id 有序）；
//   · 新起一个实例会**切到它的标签**（`RunContentManagerImpl` 打开新 Content 即选中）= `focusRunInstance`。
//
// 两条兼容约束（既有代码大量使用它们，不能改形状）：
//   `runOutput` —— **当前选中实例**的输出行（控制台显示的就是它）；
//   `runState`  —— 聚合状态：`running` = 还有实例在跑，`exit` = 当前实例的退出码。
// 实例自己的缓冲是唯一事实来源，`runOutput` 是它的镜像（切换实例时整体换掉）。
import { reactive, ref } from 'vue'
import { fromBase64 } from './base64.ts'
import { runExitAnnouncement } from './processTerminated.ts'
import { parseProcessTree, type RunProcessEntry } from './processTree.ts'
import { createConsoleDecoder, readConsoleEncoding, writeConsoleEncoding } from './consoleEncoding.ts'
import type { CoverageSummary } from './coverageReport.ts'
import { executionEnvironmentOf, executionListeners, type ExecutionProcessHandler } from './executionListeners.ts'
// 实例的执行器显示名走 `com.intellij.executor` 注册表（上游 `Executor.getActionName()`）——
// 注册表在 `src/executors.ts`（只 import extensionPoints，不带 vue/DOM，纯数据层）。
import { executorById } from './executors.ts'
import { decideRunStartupFocus, type RunStartupFocusDecision, type RunStartupFocusFlags } from './runStartupFocus.ts'
// 执行域那两条 EP 的宿主（id 逐字见 `src/executionRunExtensionPoints.ts` 文件头）：
//   · `com.intellij.execution.processHandlerPidProvider` —— 插件自报 pid，宿主快照是兜底；
//   · `com.intellij.execution.consolePauseStateProvider` —— 运行控制台的暂停位在这里作为
//     **bundled 贡献**登记（上游那一格是 `XDebuggerConsolePauseStateProvider`）。
import {
  consolePausedByProviders, pidFromProcessHandlerProviders, registerBundledConsolePauseStateProvider,
} from './executionRunExtensionPoints.ts'

/** 输出保留的行数上限（与单实例时代一致，防止刷屏吃内存）。 */
export const RUN_OUTPUT_LIMIT = 4000

export interface RunInstanceRecord {
  id: number
  /** 运行配置名（宿主回传；空表示未命名的临时命令）。 */
  label: string
  running: boolean
  /** 结束后的退出码；`null` = 还在跑或还没结束。 */
  exit: number | null
  /** 起跑时间（毫秒时间戳），标签上显示"跑了多久"。 */
  startedAt: number
  /** 该实例的输出行（切换标签时整体镜像到 `runOutput`）。 */
  output: string[]
  /**
   * 该实例当前子进程的 OS pid（宿主 `run.instances` 快照回填；0 = 没在跑或还没问到）。
   * 与 `exit` 一样是**补充面**：运行态与输出仍以事件流为准。
   */
  pid: number
  /** 进程树里活着的后代 pid（宿主按 Toolhelp 快照算，见 native/run_host.cpp）。 */
  children: number[]
  /** 后代的父子结构 + 进程名（同一份快照；控制台的「进程」区画层级）。 */
  tree: RunProcessEntry[]
  /**
   * 该实例进程树里正在**监听**的 TCP 端口（宿主 `run.instances` 的 `ports`；IPv4+IPv6）。
   * 上游 `execution/portsWatcher` 的可见等价物：调试/服务进程开了哪个端口一眼能看到。
   */
  ports: number[]
  /** 解析出的覆盖率报告（JaCoCo/Kover XML；见 src/coverageReport.ts）。没有就是 null。 */
  coverage: CoverageSummary | null
  /**
   * 已经对这个实例发出过停止请求、进程还在结束途中（上游 `ProcessHandler.isProcessTerminating()`
   * 的那一档，见 `ShowRunningListAction.java:150-152` 换 KillProcess 图标的同一条判定）。
   * 退出事件到达时清掉；只是显示用的，运行态仍以事件流为准。
   */
  stopping: boolean
  /**
   * 视图已被「关闭视图」动作摘掉（上游 `CloseViewAction.perform` → `removeContent(content, true)`）。
   * 标签立刻消失，但记录**留到 `run.exit` 到达再删** —— 宿主 `Manager::stop` 一定会补一条
   * `run.exit{aborted:true}`（native/run_host.cpp:306-310），晚到的输出/退出因此不会把
   * `record()` 叫醒成一个"复活"的标签。已结束才关的（`running === false`）当场就删。
   */
  closed: boolean
  /**
   * 这一段（或这条链）**不是自己跑完的** —— 被 `run.stop` 停掉、或 Before launch 链因为
   * 上一步非 0 退出而中止（`native/run_host.cpp:313-330` 的 `advance` / `:306-326` 的
   * `stop_instance`，两处都置 `aborted` 并回 `run.exit{aborted:true}`）。
   *
   * 为什么要有这个字段（而不是只看 `exit === -1`）：`-1` 是宿主在"被停止"时用的**哨兵**，
   * 而链中止那条报的是上一步**真实的**非 0 退出码 —— 只看数字会把"跑完退出 1"与
   * "被停止/链中止"混成一档（上游 `ProcessAdapter.processTerminated` 与
   * `ExecutionListener.processTerminated` 正是把这两件事分开报的）。快照
   * （`run.instances` 的 `aborted`）也会带上它，所以 UI 重取清单时不靠事件流也能知道。
   */
  aborted: boolean
}

export const runInstances = reactive(new Map<number, RunInstanceRecord>())
/** 当前选中的实例 id（0 = 还没有实例）。 */
export const activeRunInstance = ref(0)
/** 当前实例的输出（**镜像**：真身在实例记录里）。 */
export const runOutput = reactive<string[]>([])
/** 聚合状态：还有实例在跑 / 当前实例的退出码。 */
export const runState = reactive<{ running: boolean; exit: number | null }>({ running: false, exit: null })

/**
 * 「解释器」那一档的可用性（上游 `ConsoleExecuteActionHandler` 的 `myUseProcessStdIn == false`，
 * `platform/lang-impl/src/com/intellij/execution/console/ConsoleExecuteAction.java:118-152`）。
 * 判定与命令拼装在 `src/consoleExecute.ts`；这里只存**这条实例有没有解释器命令**（启动时由
 * `src/runActions.ts` 按当前运行配置记下），RunConsole 据此决定那一行显不显示。
 * 与上游的如实差异：上游解释器来自运行配置里的 `GeneralCommandLine`，本仓没有那层模型，
 * 用「这条配置的可执行程序」当解释器（没有可执行程序的 shell 配置就没有这一档）。
 */
export const runInterpreterCommand = ref('')

// 输出按字节流解码：子进程用自己的代码页，分块边界可能切开一个多字节字符。
// 字符集可切换（上游的组合框在 **Editor › General › Console** 设置页，不是每个控制台一个：
// `platform/lang-impl/src/com/intellij/execution/console/ConsoleEncodingComboBox.kt:20-57`，
// 应用/取值在同目录 `ConsoleConfigurable.java:116-125` 与 `:157-159`，落的是
// `EncodingManagerImpl.setDefaultConsoleEncodingReference`）：选择存 localStorage，切换时先冲掉旧解码器的残留。
//
// **解码器按实例分**（控制台内容归哪个实例，取决于这一步）。上游一个 `RunContentDescriptor`
// 挂一个 `ConsoleView`，两个实例的字节流在两条互不相干的 stdout 管道上：
// `platform/execution-impl/src/com/intellij/execution/ui/RunContentManagerImpl.kt:308-312`
// 给每个 content 单独设 component/descriptor，A 实例的半个汉字不可能出现在 B 实例的下一块里。
// 本仓原先全仓共用一个 `TextDecoder`：两个实例并发输出时 A 的分块残段会被拼到 B 的下一块前面
// —— 内容跑到别的实例的标签里，还被拼成乱码。
//
// 那条**全局**的 `decoder` 留着不是历史包袱：桥接层调用 `decodeRunChunk(dataB64)` 时没有传
// `instance`（`src/bridge.ts:357`，保留文件 ⇒ 挂载见 docs/wiring-requests-2026-10-06-runinst.md R1），
// 不带实例 id 的分块只能走它，行为与拆之前一致。
let currentConsoleEncoding = readConsoleEncoding()
let decoder = createConsoleDecoder(currentConsoleEncoding)
/** 每个实例一套流式解码器（残段只可能拼回**同一个实例**的下一个分块）。 */
const instanceDecoders = new Map<number, TextDecoder>()
/** 当前控制台编码（RunConsole 的选择器绑定它）。 */
export const runConsoleEncoding = ref(currentConsoleEncoding)

function decoderFor(instance: number): TextDecoder {
  const found = instanceDecoders.get(instance)
  if (found) return found
  const created = createConsoleDecoder(currentConsoleEncoding)
  instanceDecoders.set(instance, created)
  return created
}

/**
 * 切换控制台编码（上游是应用级默认：`ConsoleConfigurable.java:157-159` 的 apply，
 * 没有 `ConsoleViewImpl.setEncoding` 这个方法 —— 本仓旧注释写的这个名字是错的，
 * 已按上游改成「设置页的默认控制台编码」，见 docs/batch-2026-10-06-runinst.md 的坐标更正）。
 * 旧解码器的残留按**旧编码**冲出来、写回**它自己那个实例**的控制台（无实例 id 的全局残留
 * 仍写当前实例，与拆之前一致），再整体换新解码器 —— 否则半个字符会等下一次输出、
 * 甚至被新编码解成乱码。
 */
export function setRunConsoleEncoding(id: string): void {
  if (id === currentConsoleEncoding) return
  for (const [instance, own] of instanceDecoders) {
    const leftover = own.decode()
    if (leftover) handleRunOutput(instance, leftover)
  }
  instanceDecoders.clear()
  const tail = decoder.decode()
  if (tail) handleRunOutput(undefined, tail)
  currentConsoleEncoding = id
  runConsoleEncoding.value = id
  writeConsoleEncoding(undefined, id)
  decoder = createConsoleDecoder(id)
}

/**
 * 输出暂停（上游 `PauseOutputAction`）：暂停的是**视图**（当前实例的镜像不再前移），
 * 实例缓冲照常累积 —— 恢复时镜像重新对齐当前实例，暂停期间的内容一条不少。
 */
export const runOutputPaused = ref(false)
export function setRunOutputPaused(paused: boolean): void {
  runOutputPaused.value = paused
  if (!paused) {
    const target = activeRunInstance.value ? runInstances.get(activeRunInstance.value) : undefined
    runOutput.splice(0, runOutput.length, ...(target ? target.output : []))
  }
}

/** 运行控制台在 EP 里的 id（`ConsoleRef.id`，上游 `ExecutionConsole` 的可移植面）。 */
export const RUN_CONSOLE_ID = 'run'

// 运行控制台的暂停位作为 `com.intellij.execution.consolePauseStateProvider` 的 **bundled 贡献**登记：
// 上游那一格是 `XDebuggerConsolePauseStateProvider`（调试会话暂停 ⇔ 控制台算暂停），本仓的同类
// 事实来源就是这里的 `runOutputPaused`（宿主 `native/run_host.cpp` 只管输出，暂停是前端视图态）。
registerBundledConsolePauseStateProvider({
  id: 'RunConsolePauseStateProvider',
  isPaused: console => console.id === RUN_CONSOLE_ID && runOutputPaused.value,
})

/**
 * 这个控制台算不算暂停（上游 `TestConsoleProperties.isPaused`：逐个问 EP、任一为真即为真）+ 本仓自己的
 * 暂停位。消费点 `src/components/RunConsole.vue` 的暂停按钮/提示行与 `setRunOutputPaused` 的两侧。
 * 无插件时 = `runOutputPaused.value`（bundled 那条就是它）⇒ 与接线前逐字一致。
 */
export function runOutputPausedState(): boolean {
  return runOutputPaused.value || consolePausedByProviders({ id: RUN_CONSOLE_ID })
}

/**
 * 运行实例 → 执行器/配置类型（用于 ExecutionListener 的 env；宿主只回 label，这两格由
 * `src/runActions.ts` 在发起运行时登记）。不响应式：只喂 `src/executionListeners.ts` 的事件。
 * 见 `exec/run-instances` 判词：`ExecutionListener` 主题已落（`src/executionListeners.ts`）。
 */
const instanceExecutors = new Map<number, { executorId: string; runProfileType?: string }>()

/** 登记某实例的执行器与配置类型（`runActions` 起跑后调用）。 */
export function setRunInstanceExecutor(id: number, executorId: string, runProfileType?: string): void {
  if (typeof id !== 'number' || id <= 0) return
  instanceExecutors.set(id, { executorId, runProfileType })
}

/**
 * 这条实例的执行器显示名（`Executor.getActionName()`，`com.intellij.executor` 表里的那条）。
 * 注册表把这个 id 认不出来时回落到 id 本身 —— 上游 `RunContentManager` 找不到执行器时也不会
 * 把内容藏起来（它只是拿不到图标/工具窗口），所以这里同样不返回空串。
 */
export function runInstanceExecutorName(id: number): string {
  const bound = instanceExecutors.get(id)
  if (!bound) return ''
  return executorById(bound.executorId)?.getActionName() ?? bound.executorId
}

function executorTitleFor(id: number): string {
  const bound = instanceExecutors.get(id)
  return bound ? runInstanceExecutorName(id) : ''
}

/** 为一条记录合成 ExecutionListener 的 env（上游 `ExecutionManagerImpl` 拿 `ExecutionEnvironment` 发信）。 */
function executionEnvFor(target: RunInstanceRecord, id: number) {
  const bound = instanceExecutors.get(id)
  return executionEnvironmentOf(id, target.label, bound?.executorId ?? 'Run', bound?.runProfileType)
}

/** 为一条记录合成 `ProcessHandler` 只读快照（见 src/executionListeners.ts 文件头差异 ②）。 */
function executionHandlerFor(target: RunInstanceRecord, id: number): ExecutionProcessHandler {
  return {
    instanceId: id,
    label: target.label,
    pid: target.pid,
    isRunning: target.running,
    isProcessTerminating: target.stopping,
    exitCode: target.exit,
  }
}

function record(id: number): RunInstanceRecord {
  const found = runInstances.get(id)
  if (found) return found
  // 新记录 ⇒ 这个 id 的解码状态从零开始：`runInstances.clear()`（切项目/重开窗口）之后宿主
  // 可能复用同一个 id，留着上一轮的残段会把半个字拼进新一轮的输出里。
  instanceDecoders.delete(id)
  // 事件可能比 `run.start` 的回包先到（两者是两条独立消息），所以这里要能"先建后填"。
  const created: RunInstanceRecord = { id, label: '', running: true, exit: null, startedAt: Date.now(), output: [], pid: 0, children: [], tree: [], ports: [], coverage: null, stopping: false, closed: false, aborted: false }
  runInstances.set(id, created)
  return created
}

function refreshAggregate(): void {
  runState.running = [...runInstances.values()].some(instance => instance.running)
  runState.exit = activeRunInstance.value ? runInstances.get(activeRunInstance.value)?.exit ?? null : null
}

/** 实例清单（按 id 升序 = 起跑顺序）。已被关闭的视图不进清单（`closed` 见字段注释）。 */
export function runInstanceList(): RunInstanceRecord[] {
  return [...runInstances.values()].filter(instance => !instance.closed).sort((left, right) => left.id - right.id)
}

/** 真正删掉一条记录，并把选中切到剩下的第一个（上游移除选中 Content 后会选到别的视图）。 */
function forget(id: number): void {
  runInstances.delete(id)
  instanceDecoders.delete(id)
  instanceExecutors.delete(id)
  if (activeRunInstance.value !== id) return
  const next = runInstanceList()[0]
  activeRunInstance.value = next?.id ?? 0
  runOutput.splice(0, runOutput.length, ...(next ? next.output : []))
  if (runOutputPaused.value) return
  refreshAggregate()
}

/**
 * 关掉一个视图（上游 `Runner.CloseView` / `CloseViewsActionBase.actionPerformed:22-31`）。
 *
 * 停进程是**宿主**那一步（调用方发 `run.stop {instance}`，语义与标签上的 × 相同）；
 * 这里只做视图侧：标签立刻摘掉（`closed = true`），记录等到 `run.exit` 再删 ——
 * 理由写在 `RunInstanceRecord.closed` 上。进程早就结束的视图当场删干净。
 */
export function closeRunView(id: number): void {
  const target = runInstances.get(id)
  if (!target || target.closed) return
  target.closed = true
  if (!target.running) { forget(id); return }
  refreshAggregate()
}

/** 切到某个实例（新实例起跑时自动调；控制台整体换成它的输出）。暂停时只切选中，不动视图。 */
export function focusRunInstance(id: number): void {
  if (!runInstances.has(id)) return
  activeRunInstance.value = id
  if (runOutputPaused.value) { refreshAggregate(); return }
  // 整体替换而不是 push：`runOutput` 是镜像，长度与内容都要与实例一致。
  runOutput.splice(0, runOutput.length, ...runInstances.get(id)!.output)
  refreshAggregate()
}

/**
 * 清空**当前实例**的控制台（IDEA 控制台的 Clear All / `ClearConsoleAction`）。
 *
 * 只清当前实例：实例缓冲与镜像一起清，保证切换走后回来看到的仍是空的；
 * 其它实例（各自的标签）不受影响。在跑的进程继续输出会接着写在新内容后面。
 */
export function clearRunOutput(): void {
  const target = activeRunInstance.value ? runInstances.get(activeRunInstance.value) : undefined
  if (target) target.output.splice(0, target.output.length)
  runOutput.splice(0, runOutput.length)
}

/**
 * 「启动一个运行实例时把键盘焦点移进运行面板」的**宿主回调**（exec2 R3）。
 *
 * 上游链路：`ExecutionManagerImpl.kt:290-293` 把配置上的 activate/focus 合成 descriptor 的
 * `isActivateToolWindowWhenAdded`/`isAutoFocusContent` → `RunContentManagerImpl.kt:432-435` 选中新 Content、
 * `:439-441` 不看面板就 return、`:450-457` 决定是否 `focus`、`:458` 交给 `activate(callback, focus, focus)`。
 * 判定本身是纯函数（`src/runStartupFocus.ts` 的 `decideRunStartupFocus`）；本模块只知道事件，
 * 所以要宿主补两件本层拿不到的事实：**这条配置的开关**与**当前有没有焦点所有者**，
 * 以及那一步真正的键盘焦点动作（`src/App.vue` 的 `focusToolWindowContent('run')`）。
 * 宿主未注入时 `applyRunStartupFocus` 什么都不做（不影响原有行为）。
 */
export interface RunStartupFocusHost {
  /** 这条实例对应的运行配置上那两个开关（上游 `RunnerAndConfigurationSettings.java:242`/`:256`，每条配置一份）。 */
  flagsFor: (instance: RunInstanceRecord) => RunStartupFocusFlags
  /** 把键盘焦点移进运行工具窗口（`RunContentManagerImpl.kt:458` 的 `activate(…, focus, focus)`）。 */
  focusRunToolWindow: () => void
  /** 此刻整个应用没有焦点所有者（`RunContentManagerImpl.kt:451-457` 那一档）。 */
  focusOwnerMissing?: () => boolean
}

let runStartupFocusHost: RunStartupFocusHost | null = null

/** 注入/清除宿主回调（宿主 bootstrap 时调；判据也用它）。 */
export function setRunStartupFocusHost(host: RunStartupFocusHost | null): void { runStartupFocusHost = host }

/** 当前宿主回调（排查用）。 */
export function runStartupFocusHostOf(): RunStartupFocusHost | null { return runStartupFocusHost }

/**
 * 新实例选中之后的那一步：按上游那三档算 `takeFocus`，为真就调宿主的夺焦动作。
 * `existingView` = 同一条配置原来那一格（`RunContentManagerImpl.kt:788-826` 的「复用还是新开」）；
 * 传 null 表示这条配置没有已有视图。返回判定结果（宿主没注入 ⇒ null，什么都没做）。
 */
export function applyRunStartupFocus(
  instance: RunInstanceRecord, existingView: RunInstanceRecord | null = null,
): RunStartupFocusDecision | null {
  const host = runStartupFocusHost
  if (!host) return null
  let flags: RunStartupFocusFlags
  try { flags = host.flagsFor(instance) } catch { return null }
  const decision = decideRunStartupFocus({
    ...flags,
    existingView: existingView
      ? { running: existingView.running, selected: existingView.id === activeRunInstance.value }
      : null,
    // `:451-457`：焦点原本就在被换掉的那块视图里 ⇒ 强制夺焦。宿主拿不到 document 时为 false。
    focusOwnerMissing: host.focusOwnerMissing?.() === true,
  })
  if (decision.takeFocus) host.focusRunToolWindow()
  return decision
}

/** 宿主报告新实例（`run.started`）。 */
export function handleRunStarted(data: { instance?: number; label?: string }): boolean {  if (typeof data.instance !== 'number') return false
  const label = typeof data.label === 'string' ? data.label : undefined
  // `existingView` 要在新实例建记录**之前**取：它指的是「同一条配置原来那一格」（按 label 找）。
  const sameName = label === undefined
    ? null
    : runInstanceList().find(instance => instance.id !== data.instance && instance.label === label) ?? null
  const created = record(data.instance)
  if (label !== undefined) created.label = label
  // 宿主事件与 run.start 回包可能先后到达；相同 id 只确认，不重置已收到的输出/退出。
  focusRunInstance(data.instance)   // IDEA 打开新 Content 时会选中它
  refreshAggregate()
  // ExecutionListener 主题：`ExecutionManagerImpl.kt:384` 在 `startNotify()` 之后发 processStarted。
  executionListeners.processStarted(executionEnvFor(created, data.instance), executionHandlerFor(created, data.instance))
  // R3：选中之后按上游那三档决定要不要把键盘焦点移进面板（宿主回调未注入 ⇒ 无副作用）。
  applyRunStartupFocus(created, sameName)
  return true
}

/**
 * 输出事件。`text` 已解码（桥接那一层负责解 base64）。
 * 当前实例的输出**同时**写进 `runOutput`，其它实例只进自己的缓冲。
 */
export function handleRunOutput(instance: number | undefined, text: string): void {
  const id = typeof instance === 'number' ? instance : activeRunInstance.value
  if (!id) return
  const target = record(id)
  target.output.push(text)
  if (target.output.length > RUN_OUTPUT_LIMIT) target.output.splice(0, target.output.length - RUN_OUTPUT_LIMIT)
  // 暂停只冻结视图（runOutput 镜像）：实例缓冲继续累积，恢复后一条不少。
  if (runOutputPaused.value) return
  if (id === activeRunInstance.value) {
    runOutput.push(text)
    if (runOutput.length > RUN_OUTPUT_LIMIT) runOutput.splice(0, runOutput.length - RUN_OUTPUT_LIMIT)
  }
}

/** 结束事件。`remaining > 0` 表示这条链还有后续步骤，整条配置仍算"在跑"。 */
export function handleRunExit(data: { instance?: number; code?: number; remaining?: number; aborted?: boolean }): boolean {
  if (typeof data.code !== 'number') return false
  const id = typeof data.instance === 'number' ? data.instance : activeRunInstance.value
  const remaining = typeof data.remaining === 'number' ? data.remaining : 0
  // 解码残留只属于**它自己那个实例**：A 的半个字不能在这条退出里冲进 B 的控制台。
  const tail = id ? flushInstanceDecoder(id, remaining === 0) : decoder.decode()
  // IDEA `ProcessTerminatedListener.processTerminated`（:59-66）：进程结束时**同一句话写两处** ——
  // 控制台一行（`notifyTextAvailable(..., SYSTEM)`）+ 状态栏一条（`StatusBar.Info.set`）。规则
  // （只在整条链结束时报、用户主动停止不报）在 src/processTerminated.ts。放在这里而不是桥接层：
  // 它是本函数收尾语义的一部分。与上游一致，这是**独立的一条**控制台文字（不并进解码残留里）。
  const finished = runExitAnnouncement({ code: data.code, remaining, aborted: data.aborted })
  const push = (text: string) => {
    if (id) {
      const target = record(id)
      target.output.push(text)
      if (target.output.length > RUN_OUTPUT_LIMIT) target.output.splice(0, target.output.length - RUN_OUTPUT_LIMIT)
      if (id === activeRunInstance.value && !runOutputPaused.value) {
        runOutput.push(text)
        if (runOutput.length > RUN_OUTPUT_LIMIT) runOutput.splice(0, runOutput.length - RUN_OUTPUT_LIMIT)
      }
    } else if (!runOutputPaused.value) {
      runOutput.push(text)
    }
  }
  if (tail) push(tail)
  if (finished !== null) push(finished)
  if (id) {
    const target = record(id)
    target.exit = data.code
    // `aborted` 与 `run.exit` 一起到（`native/run_host.cpp:306-326`）：它区分"自己跑完退出 N"
    // 与"被停止/链中止"。链中止时报的是上一步真实的非 0 码，所以这一位不能只看 `code === -1`。
    if (data.aborted === true) target.aborted = true
    if (remaining === 0) { target.running = false; target.stopping = false }
    // ExecutionListener 主题：`ExecutionManagerImpl.kt:1198` 发 processTerminated（带退出码）。
    // `aborted` 那条（被停止/链中止）上游同样走 processTerminated，只是退出码是哨兵/中止码。
    // 发在"关闭视图即 forget"之前：视图关掉不等于监听器不该知道它结束了。
    executionListeners.processTerminated(executionEnvFor(target, id), executionHandlerFor(target, id), data.code)
    // 关闭的视图：这条退出是宿主对 `run.stop` 的收尾（native/run_host.cpp:306-310），整条链走完
    // 才真正把记录删掉 —— 中间还有 before-launch 后续步骤时继续收（`remaining > 0`）。
    if (remaining === 0 && target.closed) { forget(id); return true }
  }
  refreshAggregate()
  return true
}

/**
 * 起跑入口，两个时机，**都不清空已有实例的输出**：
 *  - **不带 id**（`runActions` 在用户按下运行时调用）：此时还没有新实例，回包未到。
 *    控制台按实例分标签（RunConsole 的每个 Content），旧实例的输出要留着 ——
 *    提前清空就是抹掉上一轮的结果（见 tests/java-launch-regression.test.mjs）。
 *  - **带 id**（`run.start` 的回包 / 宿主 `run.started` 确认同一个实例）：只确认 id。
 *    宿主事件与回包可能先后到达，同一个 id 再确认一次同样不能清空 ——
 *    那会把这一轮已经收到的输出抹掉。
 * 真正「从空开始」的是**新实例 id**：`record()` 给它建空缓冲，`focusRunInstance()` 切过去。
 */
export function beginRun(instance?: number): void {
  if (typeof instance !== 'number') return
  handleRunStarted({ instance })
}

/** 发起失败时把状态收回来（`runActions` 的 catch 用它）。 */
export function endRun(instance?: number): void {
  const id = typeof instance === 'number' ? instance : activeRunInstance.value
  if (id) {
    const target = runInstances.get(id)
    if (target) { target.running = false; if (target.exit === null) target.exit = -1 }
  }
  refreshAggregate()
}

/**
 * 标记「已经对这个实例发过停止请求、进程还在结束途中」= 上游 `ProcessHandler.isProcessTerminating()`
 * 的那一档（`ShowRunningListAction.java:150-152` 与 `StopProcessAction.java:68-76` 都在读它）。
 *
 * 调用点是**真的**发了 `run.stop {instance}` 而视图还留着的那一处：工具条的停止
 * （`src/runActions.ts` 的 `stopRun`，它只停当前实例、不摘标签）。
 * 标签上那个 `×` 不用调它 —— `closeRunView` 已经把 `closed` 置上了，
 * `runningListRows` 认 `stopping || closed`，两条路殊途同归。
 *
 * **IDEA 侧没有对应的协议类/消息**：上游那个"正在结束"是 `ProcessHandler` 的内存字段，
 * 同一个 JVM 里直接读，不需要跨进程上报；本仓宿主与前端是两条进程，
 * 而 `native/run_host.cpp` 只在进程**结束时**补一条 `run.exit`（`:306-310` 的 aborted 那条），
 * 中间没有"开始结束"的事件 ⇒ 这一格只能由前端在发出请求时自己记，不能假造一条宿主消息。
 */
export function markRunInstanceStopping(id: number): void {
  const target = runInstances.get(id)
  if (target && target.running) {
    target.stopping = true
    // ExecutionListener 主题：`ExecutionManagerImpl.kt:1216` 发 processTerminating。
    executionListeners.processTerminating(executionEnvFor(target, id), executionHandlerFor(target, id))
  }
}

/**
 * 解码一段 base64 输出（桥接层用；放这里以便与**该实例自己的**解码器的分块状态保持一致）。
 *
 * `instance` 省略或为 0（桥接层今天的调用形状，见文件头）走全局解码器，与拆之前完全一致；
 * 带上实例 id 时走那个实例自己的解码器 —— 两个实例并发输出时，A 的分块残段只会等 A 的
 * 下一块，不会跑到 B 的控制台里。
 */
export function decodeRunChunk(dataB64: string, instance?: number): string {
  const bytes = fromBase64(dataB64)
  if (!instance) return decoder.decode(bytes, { stream: true })
  return decoderFor(instance).decode(bytes, { stream: true })
}

/** 冲掉**某个实例**解码器的分块残留；`drop = true`（整条运行链结束）时顺手把它的解码器丢掉。 */
function flushInstanceDecoder(instance: number, drop: boolean): string {
  const found = instanceDecoders.get(instance)
  if (!found) return ''
  const text = found.decode()
  if (drop) instanceDecoders.delete(instance)
  return text
}

/**
 * 冲掉解码器的分块残留（一次运行结束时要调，否则最后半个字符会等下一次）。
 * 带实例 id 冲那个实例的；不带 id 冲全局那条（桥接层今天的形状，同上）。
 */
export function flushRunDecoder(instance?: number): string {
  if (!instance) return decoder.decode()
  return flushInstanceDecoder(instance, true)
}

/**
 * 把宿主 `run.instances` 的快照合进记录（`RunConsole` 的「进程」区用它）。
 *
 * 只回填 pid / children 这两个**只有宿主知道**的字段；运行态与退出码仍以事件流为准 ——
 * 快照可能与事件交叠（例如快照在 run.exit 之后才回到），让快照覆盖会倒退回"运行中"。
 * 认领不了的 id（事件还没建记录，或已清理）跳过。返回认领的条数。
 */
export function applyRunInstanceSnapshot(rows: readonly unknown[]): number {
  if (!Array.isArray(rows)) return 0
  let claimed = 0
  for (const raw of rows) {
    if (!raw || typeof raw !== 'object') continue
    const row = raw as { id?: unknown; pid?: unknown; children?: unknown; tree?: unknown; ports?: unknown; exitCode?: unknown; aborted?: unknown; stopping?: unknown }
    if (typeof row.id !== 'number') continue
    const target = runInstances.get(row.id)
    if (!target) continue
    // pid：先问 EP（`com.intellij.execution.processHandlerPidProvider`，上游 `getPid(handler)` 逐个问、
    // 第一个非 null 的赢）—— 语言后端自报的 pid 比快照更权威；没有插件（上游平台内也没有内建贡献）
    // 时回落到宿主快照那一格，行为与接线前逐字一致。
    const providerPid = pidFromProcessHandlerProviders(executionHandlerFor(target, row.id))
    if (providerPid !== null) target.pid = providerPid
    else if (typeof row.pid === 'number' && Number.isFinite(row.pid) && row.pid >= 0) target.pid = row.pid
    if (Array.isArray(row.children)) target.children = row.children.filter((pid): pid is number => typeof pid === 'number')
    // `tree` 比 children 多出父子关系与进程名；老宿主没有这个字段时保留上一次的树。
    if (Array.isArray(row.tree)) target.tree = parseProcessTree(row.tree)
    // 监听端口（宿主 IpHelper 快照；老宿主没有这个字段时保留上一次的结果）。
    if (Array.isArray(row.ports)) target.ports = [...new Set(row.ports.filter((port): port is number => typeof port === 'number' && port > 0 && port < 65536))]
    // 退出码与 `aborted` 也**只作补充**（`native/run_host.cpp:488-492` 快照带的这两位）：
    // 它们只在事件流还没到达时才填得上（`target.exit === null`），一旦 `run.exit` 报过就
    // 以事件流为准 —— 否则一条迟到的快照会把已经报过的退出码/归因改回去（同 `running` 的取舍）。
    // `exitCode` 为 `null` 表示宿主那边还在跑 ⇒ 不写（不能把"还没结束"当成"退出码 0"）。
    if (target.exit === null && typeof row.exitCode === 'number' && Number.isFinite(row.exitCode)) target.exit = Math.trunc(row.exitCode)
    if (row.aborted === true) target.aborted = true
    // 「已请求优雅停止、进程还在跑」= 上游 `ProcessHandler.isProcessTerminating()` 的同一格。
    // 宿主快照带 `stopping`（`native/run_host.cpp` 的 `stop_requested`）⇒ 重取清单/刷新页面后
    // 那一格仍然是「正在结束」，不必等用户再按一次才显示。**只置位不清位**（与 `aborted` 同口径）：
    // 真的结束了由 `run.exit` 把 running/stopping 一起收掉（同文件 handleRunExit）。
    if (row.stopping === true) target.stopping = true
    claimed++
  }
  return claimed
}

/** 记录一个实例的覆盖率报告（RunConsole 读完报告后调用；见 src/coverageReport.ts）。 */
export function setInstanceCoverage(id: number, summary: CoverageSummary | null): void {
  const target = runInstances.get(id)
  if (target) target.coverage = summary
}

// ── 「正在运行」清单（上游 `ShowRunningListAction`，动作 id `ShowLiveRunConfigurations`） ────────
//
// 上游坐标（`platform/execution-impl/src/com/intellij/execution/actions/ShowRunningListAction.java`）：
//   · `:55-57` 动作本体 + `actionPerformed`；登记在
//     `platform/execution-impl/resources/intellij.platform.execution.impl.actions.xml:17`
//     （`<action id="ShowLiveRunConfigurations" class="com.intellij.execution.actions.ShowRunningListAction"/>`），
//     条目在 `platform/platform-impl/resources/idea/ExecutionActions.xml:102`
//     —— 那一行落在同文件 `:88` 打开的 `<group id="RunMenu" popup="true">` 里，也就是**IDE 主菜单 Run**，
//     与 `ChooseRunConfiguration` / `Stop` / `StopBackgroundProcesses` 同一组。
//     **本仓的落点不同**：菜单项要走 `src/actionRegistry.ts` + `src/App.vue`（两份保留文件）才有派发链路，
//     所以这条现在挂在运行控制台自己的工具条上（`src/components/RunConsole.vue`），
//     做的是同一件用户可见的事：一眼看到此刻在跑的是哪几个、点一下切过去。
//     要照上游位置进 Run 菜单 ⇒ 见 `docs/wiring-requests-2026-10-06-terminal.md` T2。
//   · `:131-174` `getCurrentState(projects)`：逐项目取 `getRunningDescriptors(alwaysTrue())`（**只列还在跑的**），
//     每条 descriptor × 每个 executor 画一个 `HyperlinkLabel(descriptor.getDisplayName())`（`:144-158`）；
//   · `:150-152` 图标：`processHandler.isProcessTerminating() && (handler as KillableProcess).canKillProcess()`
//     时换成 `AllIcons.Debugger.KillProcess`，否则用 executor 自己的图标 —— **只是图标，不是另一条动作**；
//   · `:162-165` 一条都没有时显示 `show.running.list.balloon.nothing`；
//     `:166-171` 有内容时底部加一句 `show.running.list.balloon.hint`；
//     `:84` 弹层标题 = `show.running.list.balloon.title`（三句文案在
//     `platform/execution/resources/messages/ExecutionBundle.properties:44-46`）；
//     动作文案在 `platform/platform-resources-en/src/messages/ActionsBundle.properties:945-946`
//     （`Show Running List` / `Show the list of Run Configurations running at the moment`）。
//   · `:95-115` 点击：`RunContentManager.toFrontRunContent(executor, descriptor)` —— **只是把那个视图切到前面**，
//     不新建、不停止；本仓等价物就是 `emit('select', id)`（宿主 App.vue:2283 那行接的是 `focusRunInstance`）。
//   · `:182-190` `update()`：任何一个开放项目有在跑的 descriptor 才启用，否则整条动作点不动。
//   `:63` 那条 250ms 定时器只是弹层期间刷新内容，本仓的行数据本来就是响应式的 ⇒ 不需要轮询。
//
// 与上游不等价的一处（照本仓架构，不编控件）：上游一行是「descriptor × executor」的笛卡尔积，
// 因为 IDEA 一个实例可以同时挂在 Run/Debug 等多个 Executor 下；本仓运行与调试是两条通道
// （DAP 会话不进 `runInstances`），所以**一行就是一个实例**，`runningListRows` 的 `id` 就是那格的位置。

/** 「正在运行」清单的一行（上游那个 `HyperlinkLabel`）。 */
export interface RunningListRow {
  id: number
  /** 显示名（上游 `descriptor.getDisplayName()`）。 */
  name: string
  /** `kill` = 上游那格换成了 KillProcess 图标（进程已在结束途中）。 */
  icon: 'run' | 'kill'
  /** 这一格当前就在看（上游没这条，本仓用它把「点过去」和「已经在这」分开，避免假高亮）。 */
  active: boolean
}

/** 三句文案：`ExecutionBundle.properties:44-46` 的直译（本地化包不在树里时按英文原文直译）。 */
export const RUNNING_LIST_LABELS = {
  /** `action.ShowLiveRunConfigurations.text`（ActionsBundle.properties:945）。 */
  action: '显示正在运行清单',
  /** `show.running.list.balloon.title`（ExecutionBundle.properties:44）。 */
  title: '正在运行',
  /** `show.running.list.balloon.nothing`（:45）。 */
  empty: '没有可显示的',
  /** `show.running.list.balloon.hint`（:46）。 */
  hint: '点击切换过去',
  /** `update()`（:182-190）没有可列的实例时写给 title 的原因。 */
  disabled: '现在没有正在运行的实例。',
} as const

/** 显示名：配置名优先，没有名字按起跑顺序给「运行 N」（与 `RunConsole` 标签同一规则）。 */
export function runInstanceDisplayName(instance: Pick<RunInstanceRecord, 'label'>, index: number): string {
  return instance.label || `运行 ${index + 1}`
}

/**
 * 清单的行：只列 `running === true` 的实例（`:137` 的 `getRunningDescriptors`），
 * 按起跑顺序（id 升序，与 `runInstanceList()` 同一口径）。
 * 「已经点了关闭视图、进程还在结束途中」的那条仍然在列 —— 上游那边 descriptor 还没从
 * running 表里摘掉，本仓 `closed && running` 正是同一件事，图标按 `:150-152` 换成 kill 形状。
 *
 * 行名不再是「本清单里的第几个」，而是**行模型**给的那一个（`runInstanceRows`）：上游两处
 * 读的是同一个字符串（`descriptor.getDisplayName()`，`ShowRunningListAction.java:144-158`
 * 与标签条 `RunContentManagerImpl.kt:312` 都从它来），所以「同一个实例在标签上叫运行 3、
 * 在清单里叫运行 2」这种按各自列表重新数一遍的写法本来就不对。
 */
export function runningListRows(activeId: number | null = null): RunningListRow[] {
  return runInstanceRows(activeId ?? 0)
    .filter(row => row.running)
    .map(row => ({
      id: row.id,
      name: row.title,
      icon: row.kill ? 'kill' as const : 'run' as const,
      active: row.active,
    }))
}

/** `update()`（`:182-190`）：没有在跑的实例就整条动作不可用。 */
export function runningListEnabled(rows: readonly RunningListRow[]): boolean {
  return rows.length > 0
}

// ── 实例列表的**行模型**（标签条、「正在运行」清单、停止动作三处共用） ────────────────────
//
// 上游一条实例 = 一个 `RunContentDescriptor`
// （`platform/execution/src/com/intellij/execution/ui/RunContentDescriptor.java:36`），它在 UI 上的
// 每一格都有源码位置，本行模型逐条对着它：
//   · **标题** = `descriptor.getDisplayName()`，起跑时取 `profile.getName()`
//     （`RunContentDescriptor.java:116-123` 构造、`:218-220` getter；content 的 displayName 由
//     `platform/execution-impl/src/com/intellij/execution/ui/RunContentManagerImpl.kt:312` 设上、
//     `:314-320` 跟着标题的 StateFlow 改）。**同名实例不做消歧**（上游没有 `#2` 那种后缀，
//     全树 grep 不到给 run 标签加序号的代码），所以 `duplicateTitle` 只是把「这行与上一行同名」
//     这件事告诉宿主，宿主据此决定要不要显示区分用的描述。
//   · **标签描述**：`process.id.tooltip=Process ID: {0,number,#}`
//     （`platform/execution/resources/messages/ExecutionBundle.properties:204`），**只在进程活着的时候设**
//     （`RunContentManagerImpl.kt:369-376`），进程结束时清成 null（`:389-405`，清那一句是 `:402`）——
//     这是上游区分两条同名标签的唯一手段。本仓的 pid 由宿主 `run.instances` 快照回填
//     （`native/run_host.cpp:439-449`），所以这条描述现在能真的算出来。
//   · **图标/存活**：在跑 ⇒ live 角标（`RunContentManagerImpl.kt:361-366`，`getLiveIndicator` 在 `:126-127`），
//     结束 ⇒ 置灰或透明图标（`:389-405`，具体那行是 `:401`）⇒ 落成 `live` / `dimmed` 两个字段。
//   · **选中**：新起一条会把选中切过去（`:432-435` 的 `isSelectContentWhenAdded`），本仓是 `focusRunInstance`。
//   · **停止这一格可不可点** = `StopAction.canBeStopped`
//     （`platform/execution-impl/src/com/intellij/execution/actions/StopAction.java:310-315`）：
//     进程没结束，**且**（不在结束途中 **或** 能被硬杀）。本仓宿主的 `run.stop` 按 Job Object
//     的 TerminateJobObject 杀整棵树（`native/run_host.cpp:413-428`，注释在 `:447`）⇒ 恒「能被硬杀」，
//     于是「正在结束途中」的那一格在上游会换成 **Kill process**（`StopAction.java:106-110` +
//     `ExecutionBundle.properties:203`/`:529`）而不是关掉，本仓落成 `kill` 字段。
//   · **内存**：上游一个控制台一份**有界**缓冲 —— `platform/execution-impl/src/com/intellij/execution/impl/ConsoleBuffer.java:8-22`
//     （默认 `idea.cycle.buffer.size=1024` KB；`useCycleBuffer()` 关掉时不设限）与
//     `platform/lang-impl/src/com/intellij/execution/impl/ConsoleViewImpl.kt:186-187`
//     （用它建 TokenBuffer）。**上游没有任何「按实例显示进程内存占用」的用户可见面**：
//     `platform/execution-impl/src/com/intellij/execution/` 与 `platform/execution/src/com/intellij/execution/`
//     两目录 grep `memory` 只命中 JNA 的 `MemorySegment`（portsWatcher）和 `createSmallMemoryFootprintSet`，
//     `platform/execution.dashboard` 也零命中 ⇒ 这里只带上游真有的「控制台缓冲」，不编一个工作集读数。
//     本仓的缓冲上限另有**行数**那道（`RUN_OUTPUT_LIMIT`，本模块 `:24`），两个都进 `truncated` 判定。

/** 宿主能不能硬杀这个进程（本仓恒真，理由见上面的 `run.stop` → TerminateJobObject）。 */
export const HOST_CAN_KILL_PROCESS = true

/** `ConsoleBuffer.java:20-22` 的默认循环缓冲：1024 KB × 1024 ⇒ 按**字符**算的上限。 */
export const RUN_CONSOLE_BUFFER_LIMIT_CHARS = 1024 * 1024

/** 退出码那一档（与 `src/runDashboard.ts:69-75` 的 `stateOf` 同一个规则，两处不能各说一遍）。 */
export type RunInstanceRowState = 'running' | 'ok' | 'failed' | 'stopped'

export interface RunInstanceRow {
  id: number
  /** 标题（上游 `descriptor.getDisplayName()`；无名按起跑序号兜底，规则见 `runInstanceDisplayName`）。 */
  title: string
  /** 列表里还有别的实例与它同名（上游不消歧，靠 `tabDescription` 里的 pid 分辨）。 */
  duplicateTitle: boolean
  /** 此刻就在看这一格（`activeRunInstance`）。 */
  active: boolean
  running: boolean
  /** 上游的 live 角标那一档（`RunContentManagerImpl.kt:361-366`）。 */
  live: boolean
  /** 结束后的置灰/透明那一档（`:401`）。 */
  dimmed: boolean
  exit: number | null
  state: RunInstanceRowState
  statusText: string
  /** 标签上的退出码徽标（本仓既有形状：`RunConsole.vue` 的 `exitLabel`，上游标签上没有这一段）。 */
  exitText: string
  /** 标签描述（上游 `process.id.tooltip`；没 pid 或已结束就是空串 ⇒ 宿主那一行不渲染）。 */
  tabDescription: string
  /** 这一格的「停止」可不可点（`StopAction.java:310-315` 的 `canBeStopped`）。 */
  stoppable: boolean
  /** 已发过停止请求、进程还在结束途中 ⇒ 停止按钮换成 Kill process（`StopAction.java:106-110`）。 */
  kill: boolean
  /** 该实例控制台缓冲已占用的字符数（上游 TokenBuffer 按字符计，见 `ConsoleViewImpl.kt:186-187`）。 */
  bufferChars: number
  /** 缓冲上限（字符）；`RUN_CONSOLE_BUFFER_LIMIT_CHARS`，`0` 表示不设限（`ConsoleBuffer.java:8-10`）。 */
  bufferLimitChars: number
  /** 缓冲是否已经截过头（行数上限或字符上限任一命中）。 */
  truncated: boolean
  /**
   * 这一段/这条链不是自己跑完的（宿主 `aborted`：被停止或 Before launch 链中止）。
   * 与 `state === 'stopped'` 不同源：`stopped` 也包含「宿主记了 -1 但没报 aborted」的旧形状
   * （`endRun` 的兜底），这一位只有宿主明确报过 `aborted` 才为真。
   */
  aborted: boolean
  /**
   * 这条实例挂在哪条执行器上（上游 `RunContentDescriptor` 一族由 `RunContentManager` 按
   * `Executor` 配对；本仓由 `src/runActions.ts` 起跑时登记）。值是执行器的
   * `Executor.getActionName()`（`Run` / `Debug`；第三方执行器按它自报的名字），
   * 认不出执行器时回落到 id。运行/调试两条通道并存时，控制台与仪表盘靠这一格分辨。
   */
  executor: string
}

/**
 * 退出码四档（与 `src/runDashboard.ts:69-75` 一致；被 `endRun` 记为 -1 的那些算 stopped）。
 *
 * 第三个参数是本轮补的**归因**位：`aborted === true` 表示这一段/这条链不是自己跑完的
 * （被 `run.stop` 停掉，或 Before launch 链因上一步非 0 退出而中止）。上游
 * `RunDashboardRunConfigurationStatus.getStatus` 的判据正是
 * `exitCode == 0 || TERMINATION_REQUESTED ⇒ STOPPED`（`:71-73`）—— 所以「被停止/链中止」
 * 应当落 `stopped`，**不管**它报的退出码是 0 还是别的（链中止报的是上一步真实的非 0 码，
 * 只看数字会把它当成程序自己失败）。缺省 `false` 时行为与拆分前逐字一致。
 */
export function runInstanceState(running: boolean, exit: number | null, aborted = false): RunInstanceRowState {
  if (running) return 'running'
  if (exit === null) return 'running'
  if (aborted) return 'stopped'
  if (exit === 0) return 'ok'
  if (exit === -1) return 'stopped'
  return 'failed'
}

/** 状态文案（沿用 `src/runDashboard.ts:77-84` 的四档措辞，两处保持一致）。 */
export function runInstanceStatusText(state: RunInstanceRowState, exit: number | null): string {
  switch (state) {
    case 'running': return '正在运行'
    case 'ok': return '已完成'
    case 'stopped': return '已停止'
    default: return `退出码 ${exit ?? '?'}`
  }
}

/**
 * 标签描述：`ExecutionBundle.properties:204` 的 `Process ID: {0,number,#}` 直译
 * （本地化包不在树里 ⇒ 按英文原文直译，见 .tools/agent-rules.md §3 文案那条）。
 * 上游只在进程活着时设、结束时清掉（`RunContentManagerImpl.kt:369-376` 与 `:402`），
 * 所以「已结束」或还没拿到 pid 时是空串 —— 宿主那行不渲染（铁律 §3：没有内容就不出现）。
 */
export function runInstanceTabDescription(instance: Pick<RunInstanceRecord, 'running' | 'pid'>): string {
  if (!instance.running || !(instance.pid > 0)) return ''
  return `进程 ID：${instance.pid}`
}

/**
 * 标签上的退出码徽标（保持 `RunConsole.vue:119-121` 今天的形状，宿主只是换成读模型）。
 *
 * `aborted` 的那一档**不写数字**：`-1` 是宿主在"被停止"时用的哨兵（`native/run_host.cpp`
 * 的 `stop_instance`），把它当退出码显示是编造一个进程没报过的数字。被停止/链中止那两条
 * 已经在控制台里有各自的整句（宿主写「链已中止…」、`src/processTerminated.ts` 写状态栏），
 * 徽标这一格只留 `已停止` 这一档词 —— 与 `runInstanceStatusText` 的 `stopped` 同一条措辞。
 */
export function runInstanceExitText(instance: Pick<RunInstanceRecord, 'running' | 'exit' | 'aborted'>): string {
  if (instance.running || instance.exit === null) return ''
  if (instance.aborted) return '已停止'
  return `exit ${instance.exit}`
}

/** 一格的可停性（`StopAction.java:310-315`）。 */
export function instanceStoppable(
  instance: Pick<RunInstanceRecord, 'running' | 'stopping'>,
  canKill: boolean = HOST_CAN_KILL_PROCESS,
): boolean {
  if (!instance.running) return false
  return !instance.stopping || canKill
}

/** 控制台缓冲的字符数（上游 TokenBuffer 按字符量计；换行按一个字符算）。 */
export function consoleBufferChars(lines: readonly string[]): number {
  let chars = 0
  for (const line of lines) chars += line.length + 1
  return chars
}

/**
 * 行模型：顺序 = 标签条顺序（id 升序 = 起跑顺序，与 `runInstanceList()` 同一口径）。
 * 名字按**全部记录**的起跑序号数（含已关视图但还在收尾的那些），这样同一条实例在标签条、
 * 「正在运行」清单、停止选择器里永远是一个名字。
 */
export function runInstanceRows(activeId: number = activeRunInstance.value): RunInstanceRow[] {
  const ordered = [...runInstances.values()].sort((left, right) => left.id - right.id)
  const titles = ordered.map((instance, index) => runInstanceDisplayName(instance, index))
  const titleCounts = new Map<string, number>()
  for (const title of titles) titleCounts.set(title, (titleCounts.get(title) ?? 0) + 1)
  return ordered.map((instance, index) => {
    const state = runInstanceState(instance.running, instance.exit, instance.aborted)
    const bufferChars = consoleBufferChars(instance.output)
    return {
      id: instance.id,
      title: titles[index],
      duplicateTitle: (titleCounts.get(titles[index]) ?? 0) > 1,
      active: instance.id === activeId,
      running: instance.running,
      live: instance.running,
      dimmed: !instance.running,
      exit: instance.exit,
      state,
      statusText: runInstanceStatusText(state, instance.exit),
      exitText: runInstanceExitText(instance),
      tabDescription: runInstanceTabDescription(instance),
      stoppable: instanceStoppable(instance),
      kill: instance.running && (instance.stopping || instance.closed),
      bufferChars,
      bufferLimitChars: RUN_CONSOLE_BUFFER_LIMIT_CHARS,
      truncated: instance.output.length >= RUN_OUTPUT_LIMIT || bufferChars > RUN_CONSOLE_BUFFER_LIMIT_CHARS,
      aborted: instance.aborted,
      executor: executorTitleFor(instance.id),
    }
  })
}

// ── 停止动作的装配（`StopAction`）已拆到 `src/runStopAction.ts`（纯函数，本文件贴 900 行上限）──
// 名字在这里原样再导出：调用方（RunConsole/MainToolbar/判据）一行没改。
export {
  STOP_LABELS, chooseReuseInstance, resolveStopActionTargets, stopActionState, stopChooserItems,
  stopCounterText, stoppableCandidates,
  type StopActionPlace, type StopActionState, type StopCandidate, type StopChooser,
  type StopChooserItem, type StopRowInput,
} from './runStopAction.ts'
