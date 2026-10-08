// **工具窗口事件面** —— 上游 `ToolWindowManagerListener`（`platform/platform-api/src/com/intellij/
// openapi/wm/ex/ToolWindowManagerListener.java`）在本仓的插件入口。
//
// 上游是什么（逐字开过参考树）：
//   · `ToolWindowManagerListener` 是一个**项目级 MessageBus Topic**
//     （`TOPIC = new Topic<>(ToolWindowManagerListener.class, Topic.BroadcastDirection.TO_PARENT)`），
//     回调面：`toolWindowRegistered(id)`（已废弃）/ `toolWindowsRegistered(ids, manager)` /
//     `toolWindowUnregistered(id, toolWindow)` / `stateChanged()` / `toolWindowShown(toolWindow)`
//     / `toolWindowsHidden(ids)` / `toolWindowStripeButtonClicked(id)`；
//   · `ToolWindowManagerImpl` 在注册/注销/状态变化/显隐/点条纹时 `bus.syncPublisher(TOPIC).…` 广播。
//     插件用 `project.getMessageBus().connect().subscribe(TOPIC, listener)` 订阅 ——
//     这是**第三方能观察工具窗口的唯一官方口子**。本仓此前只有响应式状态本身
//     （`toolAnchors`/`toolOrder`/`hiddenStripeButtons`），判词 `docs/inventory/verdict-toolwindow-openapi.md`
//     的 `ToolWindowManagerListener` 行记的就是「没有订阅者角色」。
//
// 本文件补上那一层，形状与上游逐条对齐：
//   · 主题名按监听接口的全限定名承载（与 `src/bookmarkListener.ts` 的 `BOOKMARKS_LISTENER_EP` /
//     `src/extensionPoints.ts` 的 `FILE_EDITOR_MANAGER_LISTENER_EP` 同一口径）；
//   · 四个**同名**回调 `toolWindowsRegistered` / `toolWindowUnregistered` / `stateChanged` /
//     `toolWindowsHidden`（缺省都不做事，照上游 default 方法）；
//   · 订阅口 `onToolWindowManagerEvent(listener)` 返回注销函数（上游 `subscribe` 的 `Disposable`）；
//   · 广播口 `dispatchToolWindowStateChange(prev, next)` 按**布局的前后两份**算出注册/注销/状态变化/
//     隐藏四类事件再逐个投给订阅者 —— 上游逐次显式调用那几种，本仓由差异算出，语义等价。
//
// 纯数据层：只 import `src/extensionPoints.ts`（EP 宿主）与 `src/toolWindowManager.ts`（类型），
// 不 import vue/DOM/bridge，便于 `node --test` 直测。
//
// 判据：`tests/tool-window-manager-listener.test.mjs`。

import { APPLICATION_SCOPE, EXTENSIONS, type ExtensionHandle } from './extensionPoints.ts'

/**
 * 工具窗口事件主题。上游是 `Topic<ToolWindowManagerListener>`；本仓按监听接口的全限定名承载
 * （与 `FILE_EDITOR_MANAGER_LISTENER_EP` 同一口径，便于按 id 挂贡献）。
 */
export const TOOL_WINDOW_MANAGER_LISTENER_EP = 'com.intellij.openapi.wm.ex.ToolWindowManagerListener'

declareBundledExtensionPoints()

/** 该 EP 的声明（模块加载即声明，第三方贡献按同一 id 挂）。 */
function declareBundledExtensionPoints(): void {
  EXTENSIONS.declareExtensionPoint({
    id: TOOL_WINDOW_MANAGER_LISTENER_EP,
    name: '工具窗口事件监听',
    scope: APPLICATION_SCOPE,
    dynamic: true,
  })
}

/**
 * 上游 `ToolWindowManagerListener` 的可移植子集：四个回调都可选（上游是 default 空方法）。
 */
export interface ToolWindowManagerListener {
  /** 一批窗口注册了（上游 `toolWindowsRegistered(ids, manager)`）。 */
  toolWindowsRegistered?: (ids: readonly string[]) => void
  /** 一个窗口注销了（上游 `toolWindowUnregistered(id, toolWindow)`）。 */
  toolWindowUnregistered?: (id: string) => void
  /** 窗口状态变了：可见性 / 锚点 / 顺序 / 自动隐藏 / 最大化（上游 `stateChanged()`）。 */
  stateChanged?: () => void
  /** 一批窗口被藏起来（上游 `toolWindowsHidden(ids)`）。 */
  toolWindowsHidden?: (ids: readonly string[]) => void
}

/** 一份可比较的窗口布局快照（上游没有这个对象 —— 上游逐次显式广播；本仓由前后两份算差异）。 */
export interface ToolWindowLayoutSnapshot {
  /** 全部注册窗口的 id（`ToolWindowManager.toolWindowIds()`）。 */
  registered: readonly string[]
  /** 此刻可见的窗口 id（`WindowInfo.isVisible`）。 */
  visible: readonly string[]
  /** 每个窗口的锚点（`WindowInfo.anchor`）。 */
  anchors: Readonly<Record<string, string>>
  /** 每个窗口在侧条上的顺序（`WindowInfo.order`）。 */
  order: Readonly<Record<string, string>>
}

/** 一次布局变化算出来的四类事件（上游四次广播的可判等价物）。 */
export interface ToolWindowManagerEvents {
  registered: string[]
  unregistered: string[]
  hidden: string[]
  stateChanged: boolean
}

/**
 * 由布局的前后两份算出四类事件。
 *   · `registered` / `unregistered`：按注册集做集合差；
 *   · `hidden`：上一刻可见、这一刻不可见的那些（上游 `toolWindowsHidden`）；
 *   · `stateChanged`：锚点或顺序有变 —— 有注册/注销时状态变化由那两类表达，不额外发
 *     （与上游"注册/注销是独立动作"同口径）。
 */
export function toolWindowManagerEvents(
  prev: ToolWindowLayoutSnapshot,
  next: ToolWindowLayoutSnapshot,
): ToolWindowManagerEvents {
  const prevRegistered = new Set(prev.registered)
  const nextRegistered = new Set(next.registered)
  const registered = next.registered.filter(id => !prevRegistered.has(id))
  const unregistered = prev.registered.filter(id => !nextRegistered.has(id))
  const nextVisible = new Set(next.visible)
  const hidden = prev.visible.filter(id => !nextVisible.has(id))
  const membershipSame = registered.length === 0 && unregistered.length === 0
  const sameAnchors = Object.keys(prev.anchors).every(id => prev.anchors[id] === next.anchors[id])
    && Object.keys(next.anchors).every(id => prev.anchors[id] === next.anchors[id])
  const sameOrder = Object.keys(prev.order).every(id => prev.order[id] === next.order[id])
    && Object.keys(next.order).every(id => prev.order[id] === next.order[id])
  return { registered, unregistered, hidden, stateChanged: membershipSame && !(sameAnchors && sameOrder) }
}

/**
 * 订阅工具窗口事件。返回注销函数（上游 `connect().subscribe(…)` 的 `Disposable` 在本仓是函数）。
 * 订阅是一条 EP 贡献（`source: 'user'`），所以第三方插件的监听器与内建的走同一条分派链。
 */
export function onToolWindowManagerEvent(listener: ToolWindowManagerListener, scope: string = APPLICATION_SCOPE): () => void {
  const id = `toolwindow.listener.${listenerSequence++}`
  const handle: ExtensionHandle = EXTENSIONS.registerExtension(TOOL_WINDOW_MANAGER_LISTENER_EP, id, listener, {
    scope, source: 'user',
  })
  return () => { handle.dispose() }
}

let listenerSequence = 0

/** 当前作用域下已订阅的全部监听器（已按 EP 的 `LoadingOrder` 排序）。 */
export function toolWindowManagerListeners(scope: string = APPLICATION_SCOPE): ToolWindowManagerListener[] {
  return EXTENSIONS.extensionsOf<ToolWindowManagerListener>(TOOL_WINDOW_MANAGER_LISTENER_EP, scope)
}

/**
 * 把一次布局变化投给所有订阅者，并回传算出来的事件（调用方/判据可核）。
 * 逐条 id 逐个回调 —— 上游也是每条 `syncPublisher(...)` 一次。
 */
export function dispatchToolWindowStateChange(
  prev: ToolWindowLayoutSnapshot,
  next: ToolWindowLayoutSnapshot,
  scope: string = APPLICATION_SCOPE,
): ToolWindowManagerEvents {
  const events = toolWindowManagerEvents(prev, next)
  const listeners = toolWindowManagerListeners(scope)
  if (listeners.length) {
    for (const listener of listeners) {
      if (events.registered.length) listener.toolWindowsRegistered?.(events.registered)
      for (const id of events.unregistered) listener.toolWindowUnregistered?.(id)
      if (events.hidden.length) listener.toolWindowsHidden?.(events.hidden)
      if (events.stateChanged) listener.stateChanged?.()
    }
  }
  return events
}

/** 从门面那份聚合对象（`src/toolWindowManager.ts` 的 `ToolWindowInfo`）折出一份可比较快照。 */
export function layoutSnapshotOf(input: {
  registered: readonly string[]
  visible: readonly string[]
  anchorOf: (id: string) => string
  orderOf: (id: string) => string
}): ToolWindowLayoutSnapshot {
  const anchors: Record<string, string> = {}
  const order: Record<string, string> = {}
  for (const id of input.registered) {
    anchors[id] = input.anchorOf(id)
    order[id] = input.orderOf(id)
  }
  return { registered: [...input.registered], visible: [...input.visible], anchors, order }
}
