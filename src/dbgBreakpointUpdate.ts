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
//   · 那个 300ms 就是队列本体上的合并窗：同文件 `:79-83`
//     `MergingUpdateQueue.mergingUpdateQueue(name = "XLine breakpoints", mergingTimeSpan = 300, coroutineScope = cs)`；
//     `platform/ide-core/src/com/intellij/util/ui/update/MergingUpdateQueue.kt:70` 把 `mergingTimeSpan` 解释成
//     「time (in milliseconds) for which execution of tasks will be postponed」，`:505` `queue(update)` 入队，
//     `:618-620` `sendFlush() { restart(0) }` = 窗立刻到期 ⇒ 本仓的 `BREAKPOINT_MERGE_MS` / `queue(item)` / `flush()`
//     一一对上这三处。**窗不续期**（固定窗，不是 debounce）：一直改也每 300ms 落地一次，不会饿死。
//     续期与否不是我们随口选的：同文件 `:529-530` 是 `if (active && scheduledUpdates.isEmpty) { restartTimer() }`
//     ⇒ **只有队列为空（这一轮的第一条）才起表**，后续入队不动已跑的表；`:123` `restartOnAdd = false` 是默认值，
//     `:534-536` 只有显式 `setRestartTimerOnAdd(true)` 才每次入队重起 —— 断点那条队列没显式开过。
//     ⇒ 本仓 `openWindow` 的「已有窗就原样返回」就是 `:529-530` 的等价物（**不许**改成「每次入队重计时」，
//     那会变成按输入节奏无限推后 = 饿死）。
//   · 合并的方向也钉在同文件 `:549-567` `eatThisOrOthers` + `:574-582` `put`：同目标的旧那条被
//     `remove` + `setProcessed()`，末尾 `:545-547` `updatesToReject.forEachGuaranteed(Update::setRejected)`
//     ⇒ **最新那份载荷胜出，旧的直接被结算掉（不补跑、也不吊着等）**。本仓 `pending.set` 覆盖 +
//     `waiter.version <= held.version` 一起结算 + `applied` 标出「落地的那份是不是我的」= 同一套三条。
//   · 同文件 `:281-288` `breakpointChanged` 的分岔 + `:263-265` `isImmediateUiUpdateAllowed()`：
//     在 EDT 上且不在 `withImmediateUiUpdateDisabled` 块里才走 `updateBreakpointNow`，批量/非用户那一下的改动先进窗
//     ⇒ 本仓把「用户就在那一下点的」（装订线切换、面板加/删断点）标 `{ now: true }`，
//     逐字符进来的那些（条件/命中次数/日志/依赖四个输入、停在断点时的一串规则）走窗。
//   · 同文件 `:306-315` `queueAllBreakpointsUpdate()`：`for (breakpoint in manager.getAllBreakpoints())`
//     逐个重算 = **全量重发**；`:127` 在项目打开时跑一次。
//     末行 `:315` 是 `breakpointUpdateQueue.sendFlush()` ⇒ **全量重发自己就把窗冲掉**（注释原文
//     「// skip waiting」）：`resendAllFromRoot` 因此走 `{ now: true }`。只排队不冲的话，会话起来之后
//     适配器还要带着旧清单跑 300ms，这段窗口里程序真的会在旧断点上停住。
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

/** 断点条目就是桥接接口本身（`src/bridge.ts` 的 `DapBreakpoint` 已登记 `logMessage?`，2026-10-06 R1）。 */
export type BreakpointPoint = DapBreakpoint

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

/**
 * 「这一轮下发要用的前端状态」由持有它的那个组件登记给下发口 ——
 * 属性表 / 依赖表 / 已启用的依赖 / 静音这四位只活在 `DebugBreakpointsPane.vue` 的本地状态里，
 * 而写点不止它一个（App.vue 的装订线、将来的快捷键）。没有这一层，别的写点只能传 `{}`，
 * 于是「被依赖挡住的那条」会在装订线随手一下之后被重新发给适配器（面板与装订线各发一套 ⇒ 口径分叉）。
 * 没登记时退回 `{}`：只看断点对象上的字段 + 勾选位（勾选位在 `breakpointRefSendable` 里读的是模块单例，不受影响）。
 */
let sendRulesProvider: (() => BreakpointSendRules) | null = null

export function provideBreakpointSendRules(provider: (() => BreakpointSendRules) | null): void {
  sendRulesProvider = provider
}

/** 没登记时给 `{}`（= 只看断点对象上的字段 + 勾选位）；`queueFile` 走这一条，显式传 rules 的调用方不受影响。 */
export function currentSendRules(rules?: BreakpointSendRules): BreakpointSendRules {
  return rules ?? sendRulesProvider?.() ?? {}
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
  /** 只有 `applied` 为真时才可能非空：被合并掉的那一份在上游根本不 run，它的回调拿不到错。 */
  error: string | null
  /** 同上：只有 `applied` 为真时才可能非空（失败由**载荷主人**报那一次，界面因此不必再判 `applied`）。 */
  result: DapBreakpointsResult | null
  /** 落地的那一轮带的**就是这一份**载荷。被后来的改动合并掉时是 `false`，
   *  且此时 `error` 与 `result` 都是 `null`（等待者按版本结算，见 `pump`）⇒
   *  想问「我这轮到底成了没」必须先 `applied`，不然会把别人的载荷结果算到自己头上。 */
  applied: boolean
}

/** `queue` / `queueFile` 的可选口径。 */
export interface BreakpointQueueOptions {
  /** 跳过合并窗立刻发 = 上游 `updateBreakpointNow`（`:291-294`，queue + `sendFlush()`）：
   *  「用户就在那一下改的」（装订线点断点、面板加/删、静音、移除所有）不等。
   *  `sendFlush()` 是**整条队列**的表（`MergingUpdateQueue.kt:618-620` 的 `restart(0)`）
   *  ⇒ 这一档除了发自己，也把别的文件窗里正在合并的那份一起带出去（见 `queue` 末段）。 */
  now?: boolean
}

/** 上游 `MergingUpdateQueue.mergingUpdateQueue(mergingTimeSpan = 300)`
 *  （`FrontendXLineBreakpointVisualizationManager.kt:79-83`）的那道窗，单位 ms。 */
export const BREAKPOINT_MERGE_MS = 300

export interface BreakpointUpdaterOptions {
  /** 合并窗（ms）。`0` = 不设窗（只保留「同一文件一条串行流水线 + 在途最新载荷胜出」），
   *  给单测与自己管节奏的调用方用；生产那份单例走 `BREAKPOINT_MERGE_MS`。 */
  mergeMs?: number
}

export interface BreakpointUpdater {
  /** 把一轮改动交给队列；同一文件在窗内/在途的多次改动只保留最新那份载荷（合并），返回那一轮的结果。 */
  queue(item: BreakpointFileSend, options?: BreakpointQueueOptions): Promise<BreakpointRound>
  /** 便捷入口：算好这一轮再排队（写点只说「这个文件现在有哪些断点」，属性/依赖/静音那份状态问登记的提供者）。 */
  queueFile(path: string, points: readonly BreakpointPoint[], options?: BreakpointQueueOptions): Promise<BreakpointRound>
  /** 所有等待窗立刻到期并把排队项发完 = 上游 `sendFlush()`（`MergingUpdateQueue.kt:618-620`）+
   *  「等到全部执行完」。恢复执行（继续/单步/反向/重启）之前必须走一次，
   *  否则「刚点的断点」会排在 F9 之后到适配器（上游 `:290` 的注释就是同一句话）。 */
  flush(): Promise<void>
  /** 还在队列里没发出的文件。 */
  queuedPaths(): string[]
  /** 正在合并窗里等的文件（`queuedPaths` 的子集，多一条「为什么还没发」的口径）。 */
  waitingPaths(): string[]
  /** 正在发出的文件。 */
  busyPaths(): string[]
  /** 等到全部排队项（含窗里的）都发完（测试与「改完就要一致」的调用方用）。 */
  settled(): Promise<void>
}

/**
 * 每个文件一条串行流水线 + 「最新载荷胜出」的合并：
 * 在途/窗内时新改动只覆盖待发项（不追加第二次请求），这一轮结束后再发最新那份。
 * 上游 `queueBreakpointUpdate`（`:296-304`）合并的是「同一个断点的多次改动」，
 * 本仓的粒度是文件（DAP 的清单按文件整份重建），语义一致。
 */
export function createBreakpointUpdater(
  wire: (item: BreakpointFileSend) => Promise<DapBreakpointsResult> = sendBreakpointFile,
  options: BreakpointUpdaterOptions = {},
): BreakpointUpdater {
  const mergeMs = options.mergeMs ?? 0
  const pending = new Map<string, { item: BreakpointFileSend; version: number }>()
  // 「这个文件现在有泵活着」= 起泵/收泵两个动作**都必须同步**做完，所以放 Set 而不是 Map<路径,  Promise>：
  // `running.set(path, pump(path))` 那种写法在「泵在自己的同步段就退出」时会把一条已经落地的条目留在表里
  // （实参先算 ⇒ `pump` 的 finally 先删、`set` 后塞），那条文件从此再也起不了泵。
  const busy = new Set<string>()
  // 在途的泵只给 `settled()`/`flush()` 等，生命周期挂在微任务上无害。
  const pumps = new Set<Promise<void>>()
  const waiters = new Map<string, Array<{ version: number; done: (round: BreakpointRound) => void }>>()
  // 每个文件一份等待窗；`promise` 让 `settled()`/`flush()` 能等到窗到期（窗被撤时也要结算，否则会卡住）。
  const windows = new Map<string, { timer: ReturnType<typeof setTimeout>; done: () => void; promise: Promise<void> }>()
  let lastVersion = 0

  async function pump(path: string): Promise<void> {
    try {
      for (;;) {
        // 窗还没到期 ⇒ 这一轮不取载荷，等它 fire 之后 `start` 重新起泵。
        if (windows.has(path)) return
        const held = pending.get(path)
        if (!held) return
        pending.delete(path)
        const round: BreakpointRound = { error: null, result: null, applied: false }
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
          // **被合并掉的那一份既不拿结果、也不拿错**：上游同目标的旧 Update 是 `setProcessed()` +
          // `setRejected()` 之后**根本不 run**（`MergingUpdateQueue.kt:574-582` 的 `put` 里 `:579`，
          // `:545` `updatesToReject.forEachGuaranteed(Update::setRejected)`），而它的回调挂在 Update 自己身上
          // （`FrontendXLineBreakpointVisualizationManager.kt:296-304` 的 `callOnUpdate` 在 `run()` 里）
          // ⇒ 旧那一份的回调一次都不会被叫到。原来这里把 `round` 整份原样发给所有等待者，
          //   连排同一文件时「别人那份载荷的失败」会被说成自己这轮的失败（订正留痕见 dapfix 批次报告）。
          const mine = waiter.version === held.version
          if (waiter.version <= held.version) {
            waiter.done({ error: mine ? round.error : null, result: mine ? round.result : null, applied: mine })
          } else later.push(waiter)
        }
        waiters.set(path, later)
      }
    }
    finally {
      // 摘「在跑」标记必须**同步**发生在这一轮结束的那一刻（`finally` 体在 async 函数里是同步跑的），
      // 不能挂在泵的外面 —— `pump(path).finally(() => busy.delete(path))` 里那个回调是**微任务**：
      // 上面 `waiter.done(...)` 唤醒的等待者续体同样是微任务，而且**排在它前面**
      // ⇒ 「发完一轮、等待者醒来后再排同一文件」会看到 `busy.has(path)` 仍为真，于是再也没人起泵，
      //   这一份载荷就永远留在 `pending` 里（本轮实测：连排三次 `{ now: true }` 的改动就卡死）。
      // 上游不会出这个毛病：它的队列是「入队 + `sendFlush()` 各自同步做完」，没有「等续体回来再解锁」。
      busy.delete(path)
    }
  }

  /** 让这一份载荷进入流水线（有窗就先把窗撤掉）= 上游 `sendFlush()`（`MergingUpdateQueue.kt:618-620` 的 `restart(0)`）。 */
  function start(path: string): void {
    const held = windows.get(path)
    if (held) {
      clearTimeout(held.timer)
      windows.delete(path)
      held.done()
    }
    if (busy.has(path)) return
    // 先置位、后起泵：泵可能在同步段就退出（载荷为空），那时它的 `finally` 会把这一项摘掉 ⇒
    // 顺序反了就会留下一条「已经落地却永远占着名字」的条目。
    busy.add(path)
    const round = pump(path)
    pumps.add(round)
    // 这里**只**清理「等泵」用的那一份：`busy` 的摘除归 `pump` 自己的 `finally`（同步、且只摘自己这一轮）。
    // 在这条微任务里再删一次会误删**下一轮**刚置上的标记（一轮结束后等待者可能立刻又排同一文件）。
    void round.then(() => { pumps.delete(round) })
  }

  /** 撤掉**所有文件**的窗并让各自的载荷进流水线 = 上游那次全局 `sendFlush()`：
   *  队列是一条、表是全局的，所以「点一下装订线」在上游也会把别人窗里的那份一起带出去。 */
  function flushWindows(): void {
    for (const path of [...windows.keys()]) start(path)
  }

  function openWindow(path: string): void {
    // 已有窗 ⇒ **不重计时**（上游 `MergingUpdateQueue.kt:529-530` 只在队列为空时起表）。
    // 把它做成「每次入队重计时」＝ 用户一直敲条件就永远发不出去，见判据「窗不续期」。
    if (windows.has(path)) return
    let done!: () => void
    const promise = new Promise<void>(resolve => { done = resolve })
    const timer = setTimeout(() => {
      windows.delete(path)
      done()
      start(path)
    }, mergeMs)
    windows.set(path, { timer, done, promise })
  }

  function queue(item: BreakpointFileSend, queueOptions: BreakpointQueueOptions = {}): Promise<BreakpointRound> {
    const version = ++lastVersion
    pending.set(item.path, { item, version })
    const list = waiters.get(item.path) ?? []
    waiters.set(item.path, list)
    const settled = new Promise<BreakpointRound>(resolve => { list.push({ version, done: resolve }) })
    // 入队与起泵的顺序不能反：`pump` 会同步跑到 `wire`，等待者必须先登记好（上游同样先 `queue` 再 flush）。
    if (mergeMs > 0 && !queueOptions.now) openWindow(item.path)
    // `{ now: true }` = 上游 `updateBreakpointNow`（`:291-294`）= `queueBreakpointUpdate` + **`sendFlush()`**，
    // 而 `sendFlush()` 是 `restart(0)`（`MergingUpdateQueue.kt:618-620`）：表是**整条队列**共用的，
    // 所以它冲的是所有文件的窗，不是「只有我这一个」。本仓照这一条 ⇒ 先送自己，再把别人的窗一起带出去
    // （原来只起自己那个泵，注释里那句「sendFlush」就是假的：界面上按一次装订线，
    // 另一份还留在窗里的条件改动要再等满 300ms 才到适配器）。
    else { start(item.path); flushWindows() }
    return settled
  }

  return {
    queue,
    queueFile: (path, points, queueOptions) => queue(breakpointFileSend(path, points, currentSendRules()), queueOptions),
    flush: async () => {
      flushWindows()
      await settledAll()
    },
    queuedPaths: () => [...pending.keys()],
    waitingPaths: () => [...windows.keys()],
    busyPaths: () => [...busy],
    settled: settledAll,
  }

  async function settledAll(): Promise<void> {
    for (let guard = 0; guard < 1000 && (busy.size || windows.size || pending.size); guard += 1) {
      await Promise.allSettled([...pumps, ...[...windows.values()].map(entry => entry.promise)])
    }
  }
}

/**
 * 全仓共用的一份队列（面板与「查看断点…」对话框写的是同一批断点，必须共用一条流水线）。
 * 合并窗取上游那道 300ms（`BREAKPOINT_MERGE_MS`）：连续改动只发一次，
 * 而「用户就在那一下点的」写点用 `{ now: true }` 旁路、恢复执行前用 `flush()` 兜底。
 */
export const breakpointUpdater = createBreakpointUpdater(sendBreakpointFile, { mergeMs: BREAKPOINT_MERGE_MS })

/**
 * 全量重发（`queueAllBreakpointsUpdate` `:306-315` 的等价物）：把册子里**每个文件**都按当前
 * 前端状态重发一遍。用在会话起来之后 —— native 只记得「上次收到的那份」，
 * 而静音 / 取消勾选 / 依赖挡住的这些位是本仓前端才有的，不重发就会「界面说静音了、适配器却还带着断点」。
 */
export async function resendAllFromRoot(
  files: ReadonlyMap<string, readonly BreakpointPoint[]>, rules: BreakpointSendRules = {},
  updater: BreakpointUpdater = breakpointUpdater,
): Promise<string[]> {
  // `{ now: true }`：上游 `queueAllBreakpointsUpdate` 的末行就是 `sendFlush()`（`:315`，注释「skip waiting」）
  // ⇒ 全量重发不等窗。这里等一次就等于让适配器带着旧清单多跑 300ms。
  const rounds = await Promise.all(breakpointSendPlan(files, rules).map(item => updater.queue(item, { now: true })))
  return rounds.map(round => round.error).filter((text): text is string => Boolean(text))
}
