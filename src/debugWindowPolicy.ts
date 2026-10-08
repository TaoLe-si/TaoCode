// 调试器工具窗口的显示/隐藏策略 —— 上游 `XDebugSessionTab` 的两格设置消费点。
//
// 上游坐标：
//   · `platform/xdebugger-impl/ui/src/com/intellij/xdebugger/impl/ui/XDebugSessionTab.java:650-663`
//     —— `onPause(pausedByUser, topFramePositionAbsent)`：
//        `:651-653` 注释写明「只在事件自己发生（程序停在断点/被暂停）时吸引用户，
//        用户在单步时不要」，紧接着 `if (!pausedByUser) return;`；
//        `:654-656` `isShowDebuggerOnBreakpoint()` ⇒ `toFront(true, null)`（把调试这一页带到前面）；
//        `:658-662` 拿不到顶帧源码位置时 ⇒ `showView(framesContentId)`（至少把调用堆栈亮出来）。
//   · 同文件 `:318-326` —— 进程结束时：非单测模式且 `isHideDebuggerOnProcessTermination()` ⇒
//        `RunContentManager.hideRunContent(debugExecutor, descriptor)`（把这一页收掉）。
//   · 两格的定义与默认值：`.../settings/XDebuggerGeneralSettings.java:14`（隐藏，默认 false）、
//     `:15`（停在断点时显示，默认 **true**）。
//
// 一处无法核实：`pausedByUser` 的**生产方**（后端 `XDebugSessionImpl` 一侧）不在本 checkout 里
// —— 全仓 `pausedByUser` 只有 3 处（上面那段 UI 代码、`rpc/.../XDebugSessionTabApi.kt:56` 的
// `XDebugSessionPausedInfo`、`frontend/.../FrontendXDebuggerSession.kt:471` 的转发），
// 所以本仓按上面那条注释的口径把它落到 DAP 的 `stopped.reason` 上：
// `reason === 'step'`（用户按 F7/F8/Shift+F8 之后适配器报的那次停）算「用户在单步」⇒ 不吸引；
// `breakpoint` / `exception` / `pause` / `entry` / `goto` 算事件自己发生 ⇒ 吸引。
//
// 为什么这个模块没有 UI：这两格是**行为开关**，不是控件；控件在
// `src/components/DebuggerSettingsPage.vue`（本桶名下），消费点在 `src/App.vue`（保留文件）
// ⇒ 见 `docs/wiring-requests-2026-10-06-bucket12.md` 的请求 W1/W2，本模块把两条调用点写成
// 一行可照抄的形式，App.vue 里不留逻辑。

import { debuggerExtras } from './debugSettingsStore.ts'

/** 上游 `pausedByUser` 在本仓的落点：DAP `stopped.reason` 里的 `step` 表示用户单步。 */
export const USER_STEP_REASON = 'step'

/** `dapState.reason` 的形状是 `"<reason>: <text>"` 或裸 `<reason>`（`src/bridge.ts:657-659`）。 */
export function stoppedReasonOf(reason: string | null | undefined): string {
  if (!reason) return ''
  const colon = reason.indexOf(':')
  return (colon > -1 ? reason.slice(0, colon) : reason).trim()
}

/** 这次停是不是用户自己单步带出来的（上游 `:651-653` 那条注释的口径）。 */
export function isUserStepping(reason: string | null | undefined): boolean {
  return stoppedReasonOf(reason) === USER_STEP_REASON
}

/** 策略的两格；默认取 `src/debugSettingsStore.ts` 里那份（上游默认档）。 */
export interface DebuggerWindowPolicy {
  showDebuggerOnBreakpoint: boolean
  hideDebuggerOnProcessTermination: boolean
}

export function currentDebuggerWindowPolicy(): DebuggerWindowPolicy {
  return {
    showDebuggerOnBreakpoint: debuggerExtras.showDebuggerOnBreakpoint,
    hideDebuggerOnProcessTermination: debuggerExtras.hideDebuggerOnProcessTermination,
  }
}

/** 宿主能做的三件事（App.vue 已经有对应的现成函数，接线请求里点名）。 */
export interface DebuggerWindowHost {
  /** 上游 `toFront(true, null)`：把调试这一页/这个工具窗口带到前面并聚焦。 */
  bringDebuggerToFront(): void
  /** 上游 `showView(framesContentId)`：拿不到顶帧源码位置时至少显示调用堆栈。 */
  showFramesView(): void
  /** 上游 `hideRunContent(...)`：进程结束时把这一页收掉。 */
  hideDebuggerPage(): void
}

/**
 * 会话停住（上游 `onPause`）。返回做了哪几件事，测试与调用方都能看到判据：
 *   · 用户单步 ⇒ 什么都不做（`:653`）；
 *   · 适配器报 `preserveFocusHint` ⇒ 什么都不做（**别抢焦点**）：
 *     DAP 规范里 `StoppedEvent.preserveFocusHint` 的原文是「客户端**不**应该让编辑器/窗口
 *     抢焦点（例如命中的是日志断点、或用户正在别处打字）」—— 与上游那条「用户单步时不要吸引
 *     用户」是同一件事的两个来源（一个是本仓推断的 reason，一个是适配器明说的旗标），
 *     适配器明说时以它为准；
 *   · `showDebuggerOnBreakpoint` 关掉 ⇒ 不带前面（`:654`）；
 *   · 顶帧没有源码位置 ⇒ 额外亮出调用堆栈（`:658-662`）。
 */
export function applyDebuggerPause(host: DebuggerWindowHost, info: {
  reason: string | null | undefined
  hasTopFrameSource: boolean
  /** 适配器请求"别抢焦点"（DAP `stopped.preserveFocusHint`，见 `src/dapEventFields.ts`）。 */
  preserveFocusHint?: boolean
  policy?: DebuggerWindowPolicy
}): { attracted: boolean; showedFrames: boolean } {
  const policy = info.policy ?? currentDebuggerWindowPolicy()
  if (isUserStepping(info.reason)) return { attracted: false, showedFrames: false }
  if (info.preserveFocusHint === true) return { attracted: false, showedFrames: false }
  if (policy.showDebuggerOnBreakpoint) host.bringDebuggerToFront()
  const showedFrames = !info.hasTopFrameSource
  if (showedFrames) host.showFramesView()
  return { attracted: policy.showDebuggerOnBreakpoint, showedFrames }
}

/**
 * 被调试进程结束（上游 `processExited` → `:318-326`）。
 * 上游还排掉了单测模式（`!isUnitTestMode`）—— 本仓没有那条路径，靠开关本身门控。
 */
export function applyDebuggerTermination(host: DebuggerWindowHost, hideOnTermination: boolean): boolean {
  if (!hideOnTermination) return false
  host.hideDebuggerPage()
  return true
}
