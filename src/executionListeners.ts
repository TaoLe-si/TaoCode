// 运行/调试的**执行监听**（上游 `com.intellij.execution.ExecutionListener` +
// `ExecutionManager.EXECUTION_TOPIC`）。
//
// 上游是什么：`platform/execution/src/com/intellij/execution/ExecutionListener.java:11-53` 是一个
// 八个默认空方法的 `EventListener`；`ExecutionManagerImpl.kt` 在运行链的每个节点把它作为 **project
// messageBus 的 topic** 发出去（topic 名就是 `com.intellij.execution.ExecutionListener`，
// 注册见 `platform/execution-impl/resources/intellij.platform.execution.impl.xml:186-191` 的
// `<projectListeners>`；发信点：`:327` `processStartScheduled`、`:335` `processStarting(env)`、
// `:380` `processStarting(env, handler)`、`:384` `processStarted(env, handler)`、
// `:268` `processNotStarted`、`:1216` `processTerminating`、`:1198` `processTerminated`）。
//
// **插件可贡献面**（协调者新规 2026-10-06）：上游插件在 plugin.xml 里用
// `<projectListeners><listener class="..." topic="com.intellij.execution.ExecutionListener"/></projectListeners>`
// 挂自己的监听器。本仓等价物是扩展点宿主 `src/extensionPoints.ts`：EP id **逐字取上游 topic 名**，
// 插件/第三方用 `EXTENSIONS.registerExtension(EXECUTION_LISTENER_EP, id, listener)`（或本模块的
// `registerExecutionListener`）挂贡献；六个方法名与上游逐字相同
// （processStartScheduled/processStarting/processNotStarted/processStarted/processTerminating/processTerminated），
// 所以按上游接口写的监听器代码可以原样挂进来。
//
// 与上游的三处如实差异（写进 `exec/run-instances` 的族判词，不是缺口）：
//   ① 上游 env 是 `ExecutionEnvironment`（含 runProfile/runner/executor/`RunProfileState` 工厂）；
//      本仓的运行参数只有 `RunStartParams` 的扁平字段，env 收窄成「配置名 + 类型 + executorId + 项目根」，
//      没有 `RunnerAndConfigurationSettings`/`ProgramRunner` 对象可递。
//   ② 上游 handler 是 `ProcessHandler`（`destroy()`/`startNotify()`/`isProcessTerminating()` 等）；
//      本仓宿主进程与前端是两条进程，handler 是**只读快照**（instanceId/pid/isRunning/exitCode），
//      `destroy()` 落成可选的 `stop()` 回调（由调用点注入，不在这里直接发 `run.stop`，免生循环）。
//   ③ 上游是同步发信（`syncPublisher`），一个监听器抛异常会冒到调用栈；本仓把每个监听器的异常收进
//      `drainErrors()` 后继续发下一个 —— 运行链不该被一个坏监听器打断（等价于 messageBus 的日志而不中断）。
//
// 纯数据层：不 import vue/DOM/bridge，便于单测（与 `extensionPoints.ts` 同一纪律）。
//
// 判据：`tests/run-execution-listeners.test.mjs`。

import { APPLICATION_SCOPE, EXTENSIONS } from './extensionPoints.ts'

/** topic 名 = EP id（上游 `ExecutionManager.EXECUTION_TOPIC`，逐字取自 `ExecutionManager.java`）。 */
export const EXECUTION_TOPIC = 'com.intellij.execution.ExecutionListener'

/** EP id（= 上游 topic 名）：插件可贡献的入口。 */
export const EXECUTION_LISTENER_EP = EXECUTION_TOPIC

// 声明 EP（幂等）。上游这条是 `<projectListeners>` 的 topic；本仓用 EP 表承载同一件事。
EXTENSIONS.declareExtensionPoint({
  id: EXECUTION_LISTENER_EP, name: '执行监听', scope: APPLICATION_SCOPE, dynamic: true,
})

/** 运行配置的最小面（上游 `RunProfile` 的 name/type 两格）。 */
export interface RunExecutionProfile {
  name: string
  /** 配置类型 id（上游 `ConfigurationType.getId()`；本仓是 `RunConfig['type']`）。 */
  type?: string
}

/** 运行环境（上游 `ExecutionEnvironment` 的可移植子集，见文件头差异 ①）。 */
export interface RunExecutionEnvironment {
  runProfile: RunExecutionProfile
  /** 执行器 id（`Run` / `Debug`，照 `DefaultRunExecutor.EXECUTOR_ID` / `DefaultDebugExecutor.EXECUTOR_ID`）。 */
  executorId: string
  projectRoot?: string
  /** 本仓多实例模型里这条环境对应的实例 id（上游没有这格，一个 content 一个 env）。 */
  instanceId?: number
}

/** 进程句柄的只读快照（上游 `ProcessHandler` 的可移植子集，见文件头差异 ②）。 */
export interface ExecutionProcessHandler {
  instanceId: number
  label: string
  pid: number
  isRunning: boolean
  isProcessTerminating: boolean
  exitCode: number | null
  /** 主动杀进程（上游 `ProcessHandler.destroyProcess()`）；不发请求的地方可以没有。 */
  stop?: () => void
}

/** 一次 dispatch 里被某个监听器抛出的异常（上游靠 messageBus 记日志，本仓可断言）。 */
export interface ExecutionListenerError {
  phase: ExecutionListenerPhase
  error: unknown
}

export type ExecutionListenerPhase =
  | 'processStartScheduled'
  | 'processStarting'
  | 'processNotStarted'
  | 'processStarted'
  | 'processTerminating'
  | 'processTerminated'

/**
 * 监听器（上游 `ExecutionListener` 的八个默认空方法；`processStarting` 的两个重载合成一个可选 handler，
 * `Throwable cause` 收成可选 `cause: string`）。**方法名与上游逐字相同** ⇒ 按上游接口写的插件代码可原样挂。
 */
export interface ExecutionListener {
  processStartScheduled?(environment: RunExecutionEnvironment): void
  processStarting?(environment: RunExecutionEnvironment, handler?: ExecutionProcessHandler): void
  processNotStarted?(environment: RunExecutionEnvironment, cause?: string): void
  processStarted?(environment: RunExecutionEnvironment, handler: ExecutionProcessHandler): void
  processTerminating?(environment: RunExecutionEnvironment, handler: ExecutionProcessHandler): void
  processTerminated?(environment: RunExecutionEnvironment, handler: ExecutionProcessHandler, exitCode: number): void
}

/** 注册一条插件贡献的监听器（等价于 plugin.xml 的 `<projectListeners><listener .../>`）。 */
export function registerExecutionListener(listener: ExecutionListener, id?: string): () => void {
  const handle = EXTENSIONS.registerExtension<ExecutionListener>(
    EXECUTION_LISTENER_EP, id ?? `execution.listener.${++listenerSequence}`, listener, { source: 'user' },
  )
  return () => { handle.dispose() }
}
let listenerSequence = 0

/**
 * 执行监听主题的注册表。
 *
 * 订阅/退订 + 六个发信入口。发信**同步**、按注册顺序（上游 messageBus 的同步发布也是按订阅顺序），
 * 单个监听器抛错只记进 `drainErrors()` 不打断其余监听器与调用方。
 *
 * `external` 是**插件贡献来源**（生产用的单例指向扩展点宿主 `EXTENSIONS`；单测可传自定义来源，
 * 于是既能测纯注册表、又能测 EP 接线）。
 */
export class ExecutionListenerRegistry {
  private listeners = new Set<ExecutionListener>()
  private errors: ExecutionListenerError[] = []
  // 显式字段，不写 TS 参数属性（`constructor(private readonly …)` 是类型扩展语法，
  // `node --test` 的 strip-only 加载会直接 `ERR_UNSUPPORTED_TYPESCRIPT_SYNTAX`）。
  private external?: () => ExecutionListener[]

  constructor(external?: () => ExecutionListener[]) {
    this.external = external
  }

  /** 订阅（等价于 `messageBus.connect(disposable).subscribe(TOPIC, listener)`）。返回退订句柄。 */
  subscribe(listener: ExecutionListener): () => void {
    this.listeners.add(listener)
    return () => { this.listeners.delete(listener) }
  }

  /** 当前订阅数（含插件贡献；诊断/断言用）。 */
  get listenerCount(): number { return this.listeners.size + (this.external?.().length ?? 0) }

  unsubscribeAll(): void { this.listeners.clear() }

  /** 取走并清空累计的监听器异常（调用点决定要不要看，不静默丢）。 */
  drainErrors(): ExecutionListenerError[] {
    const drained = this.errors
    this.errors = []
    return drained
  }

  processStartScheduled(environment: RunExecutionEnvironment): void {
    this.fire('processStartScheduled', listener => listener.processStartScheduled?.(environment))
  }

  processStarting(environment: RunExecutionEnvironment, handler?: ExecutionProcessHandler): void {
    this.fire('processStarting', listener => listener.processStarting?.(environment, handler))
  }

  processNotStarted(environment: RunExecutionEnvironment, cause?: string): void {
    this.fire('processNotStarted', listener => listener.processNotStarted?.(environment, cause))
  }

  processStarted(environment: RunExecutionEnvironment, handler: ExecutionProcessHandler): void {
    this.fire('processStarted', listener => listener.processStarted?.(environment, handler))
  }

  processTerminating(environment: RunExecutionEnvironment, handler: ExecutionProcessHandler): void {
    this.fire('processTerminating', listener => listener.processTerminating?.(environment, handler))
  }

  processTerminated(environment: RunExecutionEnvironment, handler: ExecutionProcessHandler, exitCode: number): void {
    this.fire('processTerminated', listener => listener.processTerminated?.(environment, handler, exitCode))
  }

  /** 全部监听器 = 内联订阅 + 插件贡献（EP 表里的那批，已按 LoadingOrder 排好）。 */
  private all(): ExecutionListener[] {
    return [...this.listeners, ...(this.external?.() ?? [])]
  }

  private fire(phase: ExecutionListenerPhase, invoke: (listener: ExecutionListener) => void): void {
    for (const listener of this.all()) {
      try { invoke(listener) } catch (error) { this.errors.push({ phase, error }) }
    }
  }
}

/** 进程内唯一的主题（上游每个 project 一个 messageBus；本仓单工作区 ⇒ 一份）。插件贡献来自 EP 宿主。 */
export const executionListeners = new ExecutionListenerRegistry(
  () => EXTENSIONS.extensionsOf<ExecutionListener>(EXECUTION_LISTENER_EP),
)

/** 由运行实例记录拼一条 env（宿主只回 label，没有 executor/runProfile 时按 label 兜底）。 */
export function executionEnvironmentOf(
  instanceId: number,
  label: string,
  executorId: string,
  runProfileType?: string,
  projectRoot?: string,
): RunExecutionEnvironment {
  return {
    runProfile: { name: label || `Run #${instanceId}`, type: runProfileType },
    executorId,
    projectRoot,
    instanceId,
  }
}
