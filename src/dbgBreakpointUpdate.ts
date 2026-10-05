// 断点写路径的**唯一下发口**（桶 12c 收口 `docs/wiring-requests-2026-10-06-bucket12b.md` 请求 2 的实质）。
//
// 本仓原来的形状：三个写点各发各的 `dap.setBreakpoints`（`src/App.vue:1085` 的装订线切换、
// `src/components/DebugBreakpointsPane.vue` 的 `syncBreakAt`、`src/components/BreakpointsDialog.vue`
// 的 `resend`），其中后两个还各自手写「这次发哪些 / 册子里记哪些」的规则 ——
// 于是 `src/debugBreakpointExtras.ts` 里的 `isEnabledByDependency`、`allBreakpointFiles`
// 只有测试在消费（`.tools/bucket-landing.mjs` + 逐符号自查核出来的），生产路径上是重复实现。
// 这里把它们收成一个口，规则层只剩一份。
//
// 上游（逐条在参考树里读过，不是我印象里的 IDEA）：
//   · `java/debugger/impl/src/com/intellij/debugger/engine/JavaBreakpointHandler.java:31-44`
//     `registerBreakpoint`：先取这条 XBreakpoint 上**已经挂着的**引擎断点（`BreakpointManager.getJavaBreakpoint`，
//     `:33` 的 userData 映射 = 本仓 `dapBreakpoints` 那份册子），没有才 `createJavaBreakpoint`（`:35-36`），
//     然后 `BreakpointManager.addBreakpoint(bpt)` + 把 `createRequest` 排到 manager 线程的高优先级
//     （`:40-42`，注释「use schedule not to block initBreakpoints」）。
//     ⇒ 本仓的等价物：一次 `setBreakpoints` 就是「把这一整份文件的重建请求排进去」。
//   · 同文件 `:46-54` `unregisterBreakpoint(breakpoint, temporary)` → `deleteRequest`（本仓 = 发更小的那份清单）。
//   · `platform/xdebugger-impl/frontend/src/com/intellij/platform/debugger/impl/frontend/FrontendXLineBreakpointVisualizationManager.kt:296-304`
//     `queueBreakpointUpdate`：改动先进队列（`breakpointUpdateQueue.queue(Update(breakpoint))`），
//     **同一目标在队列里只留一份**；同文件 `:291-294` `updateBreakpointNow` = queue + `sendFlush()`，
//     注释写明「Skip waiting 300ms … good for sync updates like enable/disable or create new breakpoint」
//     ⇒ 启用/停用/新建这类「用户就在那一下改的」动作不能等。
//   · 同文件 `:306-315` `queueAllBreakpointsUpdate()`：`for (breakpoint in manager.getAllBreakpoints())`
//     逐个重算 = **全量重发**；`::127` 在项目打开时跑一次。
//     注：接线请求里给的三条上游坐标（`XDebugProcessBase.java:129-136` 的 `breakpointMapping`、
//     `xdebugger/impl/frame/XBreakpoint.java:105-121` 的 `updateState`/`myUpdateRequested`、
//     `impl/projectView/XTreeRoot.java:51-57` 的 `updateFromRoot`）在本参考树里**都不存在**：
//     按文件名（Glob）、按包路径（`platform/xdebugger-api/.../breakpoints/`）、按语义
//     （`grep -rn "myUpdateRequested\|breakpointMapping"` 全树零命中）三条路各搜过；
//     `XBreakpoint` 真身在 `platform/xdebugger-api/src/com/intellij/xdebugger/breakpoints/XBreakpoint.java:21-66`
//     （纯接口，没有 updateState），`updateFromRoot` 只在**项目视图**那一族里。
//     ⇒ 上面的 frontend 队列那一族是本参考树里真实存在的合并/全量重发实现，按它做等价物。
//
// DAP 侧没有「一条断点一个 handler」的通道：`setBreakpoints` 是**按文件整份重建**
// （`native/dap.hpp:185` 的 `requested` 就是整份清单），所以这里的合并单位就是「文件」。

import { dapBreakpoints, dapSetBreakpoints, request, type DapBreakpoint, type DapBreakpointsResult } from './bridge.ts'
import {
  allBreakpointFiles, breakpointRef, isEnabledByDependency, sendableBreakpoints,
  type BreakpointDependencies, type BreakpointPropertiesState,
} from './debugBreakpointExtras.ts'
import { isBreakpointEnabled } from './breakpointGroups.ts'

/** `src/bridge.ts` 的 `DapBreakpoint` 接口本轮冻结、没有 `logMessage` 字段 ⇒ 本地投影（同面板那一处）。 */
export type BreakpointPoint = DapBreakpoint & { logMessage?: string }

/** 一次下发要用的三类前端状态（都不进 DAP，只在「发谁」这一层起作用）。 */
export interface BreakpointSendRules {
  /** 逐断点属性表（条件/命中次数/日志 + 条件启用位），见 `src/debugBreakpointExtras.ts:114`。 */
  properties?: Record<string, BreakpointPropertiesState>
  /** 依赖断点表 `dependent -> trigger`（`XDependentBreakpointManager.java:112` `setMasterBreakpoint`）。 */
  dependencies?: BreakpointDependencies
  /** 触发者已经命中、因此启用起来的依赖断点 ref。 */
  enabledDependents?: readonly string[]
  /** 静音（`XDebuggerMuteBreakpointsHandler.java:27-37` `setSelected` → `session.muteBreakpoints(state)`）。 */
  muted?: boolean
}

/** 一个文件这一轮的状态：`send` 给适配器，`record` 记进本仓册子（被依赖挡掉的那些仍要留着）；
 *  `record` 缺省 = 这一轮**不碰册子**（静音用：断点还在册子里，只是这一轮不进 VM，
 *  上游 `XDebuggerMuteBreakpointsHandler.java:27-37` 就是只改会话的 `areBreakpointsMuted()` 位）。 */
export interface BreakpointFileSend {
  path: string
  send: BreakpointPoint[]
  record?: BreakpointPoint[]
}

/** 这个 ref 这一轮到底发不发（三条门：依赖、用户在断点树上取消勾选、静音在上层处理）。 */
export function breakpointRefSendable(path: string, point: BreakpointPoint, rules: BreakpointSendRules): boolean {
  const ref = breakpointRef(path, point.line)
  return isEnabledByDependency(rules.dependencies ?? {}, rules.enabledDependents ?? [], ref)
    && isBreakpointEnabled(ref)
}

/**
 * 单个文件的下发内容：先把随项目存的属性并上去（`sendableBreakpoints`），按行号排序，
 * 再扣掉这一轮不该发的（依赖未启用 / 取消勾选）。没有需要扣的时候 `record` 与 `send`
 * 是**同一个数组引用** —— `sendBreakpointFile` 据此走桥接封装、不重复维护册子。
 */
export function breakpointFileSend(
  path: string, points: readonly BreakpointPoint[], rules: BreakpointSendRules = {},
): BreakpointFileSend {
  const decorated = sendableBreakpoints(path, points, rules.properties ?? {})
  const sorted = [...decorated].sort((a, b) => a.line - b.line)
  // 静音 = 给适配器发空数组、册子原样留着（上游也是「断点还在、只是暂时不进 VM」）。
  if (rules.muted) return { path, send: [] }
  const send = sorted.filter(point => breakpointRefSendable(path, point, rules))
  if (send.length === sorted.length) return { path, send, record: send }
  return { path, send, record: sorted }
}

/**
 * 全量重发的计划（`queueAllBreakpointsUpdate` 的等价物，`:306-315`）：遍历**册子里的每个文件**，
 * 没有断点的文件不产生请求。`allBreakpointFiles` 由此拿到生产消费方。
 */
export function breakpointSendPlan(
  files: ReadonlyMap<string, readonly BreakpointPoint[]>, rules: BreakpointSendRules = {},
): BreakpointFileSend[] {
  return allBreakpointFiles(files as ReadonlyMap<string, DapBreakpoint[]>)
    .filter(path => (files.get(path)?.length ?? 0) > 0)
    .map(path => breakpointFileSend(path, files.get(path) ?? [], rules))
}

/** 真的发出去：这一轮同时决定「适配器收到什么」与「册子里记什么」，两者分开是有意为之。 */
export async function sendBreakpointFile(item: BreakpointFileSend): Promise<DapBreakpointsResult> {
  // 没有 `record` 的那一轮（静音）不碰册子：断点仍是用户的那些。
  if (!item.record) return request<DapBreakpointsResult>('dap.setBreakpoints', { path: item.path, breakpoints: item.send })
  if (item.record === item.send) return dapSetBreakpoints(item.path, item.send)
  const result = await request<DapBreakpointsResult>('dap.setBreakpoints', { path: item.path, breakpoints: item.send })
  const verified = new Set(result.verifiedLines ?? [])
  // 册子按**全量**记（含这轮没发出去的那条），否则取消依赖/重新勾选以后就找不到它了。
  dapBreakpoints.set(item.path, item.record.map(point => ({ ...point, verified: result.deferred ? undefined : verified.has(point.line) })))
  return result
}

/** 一轮下发的结果：`error` 给界面用，`result` 给「有没有全部被验证」这类判据用。 */
export interface BreakpointRound {
  error: string | null
  result: DapBreakpointsResult | null
}

export interface BreakpointUpdater {
  /** 把一轮改动交给队列；同一文件的多次改动只保留最新那份载荷（合并），返回那一轮的结果。 */
  queue(item: BreakpointFileSend): Promise<BreakpointRound>
  /** 便捷入口：算好这一轮再排队（写点只说「这个文件现在有哪些断点」）。 */
  queueFile(path: string, points: readonly BreakpointPoint[], rules?: BreakpointSendRules): Promise<BreakpointRound>
  /** 还在队列里没发出的文件。 */
  queuedPaths(): string[]
  /** 正在发出的文件。 */
  busyPaths(): string[]
  /** 等到全部排队项都发完（测试与「改完就要一致」的调用方用）。 */
  settled(): Promise<void>
}

/**
 * 每个文件一条串行流水线 + 「最新载荷胜出」的合并：
 * 在途时新改动只覆盖待发项（不追加第二次请求），当前这轮结束后再发最新那份。
 * 上游 `queueBreakpointUpdate`（`:296-304`）合并的是「同一个断点的多次改动」，
 * 本仓的粒度是文件，语义一致。
 */
export function createBreakpointUpdater(
  wire: (item: BreakpointFileSend) => Promise<DapBreakpointsResult> = sendBreakpointFile,
): BreakpointUpdater {
  const pending = new Map<string, { item: BreakpointFileSend; version: number }>()
  const running = new Map<string, Promise<void>>()
  const waiters = new Map<string, Array<{ version: number; done: (round: BreakpointRound) => void }>>()
  let lastVersion = 0

  async function pump(path: string): Promise<void> {
    for (;;) {
      const held = pending.get(path)
      if (!held) return
      pending.delete(path)
      const round: BreakpointRound = { error: null, result: null }
      try {
        round.result = await wire(held.item)
      }
      catch (caught) {
        round.error = caught instanceof Error ? caught.message : String(caught)
      }
      const list = waiters.get(path) ?? []
      const later: typeof list = []
      for (const waiter of list) {
        // 这一轮带的是 `held.version` 那份载荷：不比它新的请求都算已经生效（含被合并掉的）。
        if (waiter.version <= held.version) waiter.done(round)
        else later.push(waiter)
      }
      waiters.set(path, later)
    }
  }

  function queue(item: BreakpointFileSend): Promise<BreakpointRound> {
    const version = ++lastVersion
    pending.set(item.path, { item, version })
    const list = waiters.get(item.path) ?? []
    waiters.set(item.path, list)
    return new Promise<BreakpointRound>(resolve => {
      list.push({ version, done: resolve })
      if (!running.has(item.path)) running.set(item.path, pump(item.path).finally(() => running.delete(item.path)))
    })
  }

  return {
    queue,
    queueFile: (path, points, rules) => queue(breakpointFileSend(path, points, rules)),
    queuedPaths: () => [...pending.keys()],
    busyPaths: () => [...running.keys()],
    settled: async () => {
      for (let guard = 0; guard < 1000 && (running.size || pending.size); guard += 1) {
        await Promise.allSettled([...running.values()])
      }
    },
  }
}

/** 全仓共用的一份队列（面板与「查看断点…」对话框写的是同一批断点，必须共用一条流水线）。 */
export const breakpointUpdater = createBreakpointUpdater()

/**
 * 全量重发（`queueAllBreakpointsUpdate` `:306-315` 的等价物）：把册子里**每个文件**都按当前
 * 前端状态重发一遍。用在会话起来之后 —— native 只记得「上次收到的那份」，
 * 而静音 / 取消勾选 / 依赖挡住的这些位是本仓前端才有的，不重发就会「界面说静音了、适配器却还带着断点」。
 */
export async function resendAllFromRoot(
  files: ReadonlyMap<string, readonly BreakpointPoint[]>, rules: BreakpointSendRules = {},
  updater: BreakpointUpdater = breakpointUpdater,
): Promise<string[]> {
  const rounds = await Promise.all(breakpointSendPlan(files, rules).map(item => updater.queue(item)))
  return rounds.map(round => round.error).filter((text): text is string => Boolean(text))
}
