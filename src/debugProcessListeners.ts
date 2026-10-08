// 调试进程监听（上游 `com.intellij.debugger.engine.DebugProcessListener` 的等价物）。
//
// 上游是什么：`java/debugger/openapi/src/com/intellij/debugger/engine/DebugProcessListener.java:29-57`
// 是一个八个默认空方法的 `EventListener`（`connectorIsReady`/`paused`/`resumed`/`processDetached`/
// `processAttached`/`attachException`/`threadStarted`/`threadStopped`）；上游把它挂在**每个
// `DebugProcess` 实例**上（`DebugProcess.addDebugProcessListener`），xdebugger 侧另有
// `XDebugSessionListener` 挂在会话上。两者都**不是 extension point**。
//
// 协调者新规（2026-10-06）：缺口功能要暴露成**插件可调用的接口**。本仓没有 `DebugProcess`/
// `XDebugSession` 对象可挂（调试统一走 DAP），所以把这条监听能力做成 **EP** ——
// EP id `com.intellij.xdebugger.debugProcessListener`（本仓自定，上游无此 EP，如实记），
// 方法名**逐字照上游 `DebugProcessListener`**，于是按上游接口写的监听器代码可以原样挂进来。
//
// 事件来源（DAP 会话状态 `src/bridge.ts` 的 `dapState`）：
//   · 会话开始/程序加载 → `processAttached`
//   · 停在断点/步进落点 → `paused`（带 `SuspendContext` 的 reason/threadId/位置）
//   · 继续/单步/运行到光标 → `resumed`
//   · 会话结束 → `processDetached`
//   线程级别的 `threadStarted`/`threadStopped` 在 DAP 里没有对应事件（`threads` 只有清单，
//   没有 started/stopped 通知）⇒ **不发**（不假造）；`connectorIsReady`/`attachException` 同理
//   没有触发点，保留方法面但不发。
//
// 纯数据层之外只 import vue（watch）与 bridge 的 dapState；判据 `tests/debug-process-listeners.test.mjs`。

import { watch, type WatchStopHandle } from 'vue'
import { APPLICATION_SCOPE, EXTENSIONS } from './extensionPoints.ts'

/** EP id（本仓自定：上游 `DebugProcessListener` 是 per-process 监听，不是 EP）。 */
export const DEBUG_PROCESS_LISTENER_EP = 'com.intellij.xdebugger.debugProcessListener'

/** 声明 EP（幂等）。 */
EXTENSIONS.declareExtensionPoint({
  id: DEBUG_PROCESS_LISTENER_EP, name: '调试进程监听', scope: APPLICATION_SCOPE, dynamic: true,
})

/** 调试进程的最小面（上游 `DebugProcess` 的等价物：程序名/会话 id/退出码）。 */
export interface DebugProcess {
  /** 程序名（DAP `process` 事件或运行配置名）。 */
  program: string | null
  /** 会话 id（本仓一次一个会话；为将来多会话留位）。 */
  sessionId: number
  exitCode: number | null
}

/** 挂起上下文（上游 `SuspendContext` 的等价物）。 */
export interface SuspendContext {
  /** 停下原因（DAP `stopped.reason`，如 breakpoint/step/exception）。 */
  reason: string
  threadId: number
  location: { path: string; line: number } | null
}

/**
 * 监听器（上游 `DebugProcessListener` 的方法名逐字相同）。
 * `threadStarted`/`threadStopped` 的 `ThreadReference` 收成 threadId（本仓没有 JDI 线程对象）。
 */
export interface DebugProcessListener {
  connectorIsReady?(): void
  paused?(context: SuspendContext): void
  resumed?(context: SuspendContext): void
  processDetached?(process: DebugProcess, closedByUser: boolean): void
  processAttached?(process: DebugProcess): void
  attachException?(cause: string): void
  threadStarted?(process: DebugProcess, threadId: number): void
  threadStopped?(process: DebugProcess, threadId: number): void
}

/** 注册一条插件贡献的调试进程监听（等价于上游 `addDebugProcessListener`，这里是 EP 贡献）。 */
export function registerDebugProcessListener(listener: DebugProcessListener, id?: string): () => void {
  const handle = EXTENSIONS.registerExtension<DebugProcessListener>(
    DEBUG_PROCESS_LISTENER_EP, id ?? `debugProcessListener.${++listenerSequence}`, listener, { source: 'user' },
  )
  return () => { handle.dispose() }
}
let listenerSequence = 0

export interface DebugProcessListenerError { phase: keyof DebugProcessListener; error: unknown }

/**
 * 调试进程监听的注册表。与 `src/executionListeners.ts` 同一形状：内联订阅 + 插件贡献（EP）合并发信，
 * 单个监听器抛错收进 `drainErrors()` 不打断其余监听器。
 */
export class DebugProcessListenerRegistry {
  private listeners = new Set<DebugProcessListener>()
  private errors: DebugProcessListenerError[] = []
  private external?: () => DebugProcessListener[]

  constructor(external?: () => DebugProcessListener[]) {
    this.external = external
  }

  subscribe(listener: DebugProcessListener): () => void {
    this.listeners.add(listener)
    return () => { this.listeners.delete(listener) }
  }

  get listenerCount(): number { return this.listeners.size + (this.external?.().length ?? 0) }

  drainErrors(): DebugProcessListenerError[] { const out = this.errors; this.errors = []; return out }

  private fire(phase: keyof DebugProcessListener, invoke: (listener: DebugProcessListener) => void): void {
    for (const listener of [...this.listeners, ...(this.external?.() ?? [])]) {
      try { invoke(listener) } catch (error) { this.errors.push({ phase, error }) }
    }
  }

  connectorIsReady(): void { this.fire('connectorIsReady', l => l.connectorIsReady?.()) }
  processAttached(process: DebugProcess): void { this.fire('processAttached', l => l.processAttached?.(process)) }
  paused(context: SuspendContext): void { this.fire('paused', l => l.paused?.(context)) }
  resumed(context: SuspendContext): void { this.fire('resumed', l => l.resumed?.(context)) }
  processDetached(process: DebugProcess, closedByUser: boolean): void { this.fire('processDetached', l => l.processDetached?.(process, closedByUser)) }
  attachException(cause: string): void { this.fire('attachException', l => l.attachException?.(cause)) }
  threadStarted(process: DebugProcess, threadId: number): void { this.fire('threadStarted', l => l.threadStarted?.(process, threadId)) }
  threadStopped(process: DebugProcess, threadId: number): void { this.fire('threadStopped', l => l.threadStopped?.(process, threadId)) }
}

/** 进程内唯一（上游 DebugProcess 每个一个；本仓一次一个会话 ⇒ 一份）。 */
export const debugProcessListeners = new DebugProcessListenerRegistry(
  () => EXTENSIONS.extensionsOf<DebugProcessListener>(DEBUG_PROCESS_LISTENER_EP),
)

/** 会话状态的只读形状（`dapState` 的子集），便于单测注入。 */
export interface DebugSessionState {
  running: boolean
  paused: boolean
  threadId: number
  reason: string | null
  program: string | null
  currentLocation: { path: string; line: number } | null
  exitCode: number | null
}

/**
 * 把 DAP 会话状态接到监听器上：状态跃迁 → 对应事件。返回停止句柄（测试用；生产只装一次）。
 * 只在跃迁时发（`running` 由假变真 → attached，`paused` 由假变真 → paused，反向 → resumed，
 * `running` 由真变假 → detached），不在同态内重复发 —— 否则每次位置更新都会多一条 paused。
 */
export function installDebugProcessDispatch(
  state: DebugSessionState,
  registry: DebugProcessListenerRegistry = debugProcessListeners,
  stopWatch?: (fn: () => void) => WatchStopHandle,
): WatchStopHandle {
  const snapshot = () => ({
    running: state.running,
    paused: state.paused,
    program: state.program,
    exitCode: state.exitCode,
    reason: state.reason,
    threadId: state.threadId,
    location: state.currentLocation,
  })
  const processOf = (): DebugProcess => ({ program: state.program, sessionId: 1, exitCode: state.exitCode })
  const contextOf = (): SuspendContext => ({
    reason: state.reason ?? 'unknown',
    threadId: state.threadId,
    location: state.currentLocation ? { ...state.currentLocation } : null,
  })
  let previous = snapshot()
  // 默认订阅 = 深监听注入的会话状态（生产里是 `dapState` 这个 reactive 对象，`dapRequests.ts`
  // 用无第三参的形式安装）。测试用 `stopWatch` 注入一个手动 tick，绕开 Vue 的调度。
  const handle = (stopWatch ?? ((fn: () => void) => watch(() => state, fn, { deep: true })))(() => {
    const next = snapshot()
    if (!previous.running && next.running) {
      registry.connectorIsReady()
      registry.processAttached(processOf())
    }
    if (!previous.paused && next.paused) registry.paused(contextOf())
    if (previous.paused && !next.paused && next.running) registry.resumed(contextOf())
    if (previous.running && !next.running) registry.processDetached(processOf(), false)
    previous = next
  })
  return handle
}
