// **状态栏事件面** —— 上游 `StatusBarListener`（`platform/ide-core/src/com/intellij/openapi/wm/
// StatusBarListener.java`）在本仓的插件入口。
//
// 上游是什么（逐字开过参考树）：
//   · `StatusBarListener extends EventListener`，三个 default 空方法：
//     `widgetAdded(StatusBarWidget widget, String anchor)` / `widgetUpdated(String id)` /
//     `widgetRemoved(String id)`；
//   · `StatusBar` 的实现在增删/更新组件后 `bus.syncPublisher(StatusBarListener.TOPIC).…` 广播
//     （`StatusBar.java` 的 `TOPIC`）。插件用 `messageBus.connect().subscribe(TOPIC, listener)` 订阅 ——
//     这是**第三方能观察状态栏组件增删/更新的唯一官方口子**。本仓此前只有渲染模型的固定表 +
//     响应式状态，判词 `docs/inventory/verdict-toolwindow-openapi.md` 的 `StatusBarListener` 行记的
//     就是「没有『谁来订阅』的角色」。
//
// 本文件补上那一层，形状与上游逐条对齐：
//   · 主题名按监听接口的全限定名承载（与 `src/bookmarkListener.ts` / `src/toolWindowManagerListener.ts`
//     同一口径）；
//   · 三个**同名**回调（缺省都不做事，照上游 default 方法）；
//   · 订阅口 `onStatusBarEvent(listener)` 返回注销函数（上游 `subscribe` 的 `Disposable`）；
//   · 广播口 `dispatchStatusBarChange(prev, next)` 按**组件表的前后两份**算出增/删/更新三类事件
//     再逐个投给订阅者 —— 上游逐次显式调用那三种，本仓由差异算出，语义等价（同 id 视为同一个组件）。
//
// 纯数据层：只 import `src/extensionPoints.ts`（EP 宿主），不 import vue/DOM/bridge，
// 便于 `node --test` 直测。
//
// 判据：`tests/status-bar-listener.test.mjs`。

import { APPLICATION_SCOPE, EXTENSIONS, type ExtensionHandle } from './extensionPoints.ts'

/**
 * 状态栏事件主题。上游是 `StatusBarListener.TOPIC`；本仓按监听接口的全限定名承载
 * （与 `FILE_EDITOR_MANAGER_LISTENER_EP` 同一口径，便于按 id 挂贡献）。
 */
export const STATUS_BAR_LISTENER_EP = 'com.intellij.openapi.wm.StatusBarListener'

declareBundledExtensionPoints()

/** 该 EP 的声明（模块加载即声明，第三方贡献按同一 id 挂）。 */
function declareBundledExtensionPoints(): void {
  EXTENSIONS.declareExtensionPoint({
    id: STATUS_BAR_LISTENER_EP,
    name: '状态栏事件监听',
    scope: APPLICATION_SCOPE,
    dynamic: true,
  })
}

/**
 * 上游 `StatusBarListener` 的可移植子集：三个回调都可选（上游是 default 空方法）。
 */
export interface StatusBarListener {
  /** 装了一个组件（上游 `widgetAdded(widget, anchor)`；本仓给 id 与锚点）。 */
  widgetAdded?: (id: string, anchor: string | null) => void
  /** 某个组件更新了（上游 `widgetUpdated(id)`）。 */
  widgetUpdated?: (id: string) => void
  /** 摘掉了一个组件（上游 `widgetRemoved(id)`）。 */
  widgetRemoved?: (id: string) => void
}

/** 状态栏上的一格组件（上游 `StatusBarWidget` 在本仓的等价物：id + 锚点 + 此刻装没装上）。 */
export interface StatusBarWidgetEntry {
  id: string
  /**
   * 组件所在的分段（上游 `widgetAdded` 的 `anchor` 参数）。本仓的状态栏组件模型没有锚点字段
   * （分段由 App.vue 的模板决定），所以生产侧传 null —— 不凭空编一个。
   */
  anchor: string | null
}

/**
 * 一份可比较的状态栏快照（上游没有这个对象 —— 上游逐次显式广播；本仓由前后两份算差异）。
 * `installed` 是**此刻真的装在状态栏上**的那些（上游 `widgetAdded`/`widgetRemoved` 的语义：
 * 设置里关掉的组件在 IDEA 里就是被 `StatusBarWidgetsManager.updateWidget` dispose 掉的，
 * 所以"显示/隐藏"与"装上/摘下"是同一件事）。
 */
export interface StatusBarSnapshot {
  installed: readonly StatusBarWidgetEntry[]
}

/** 一次组件表变化算出来的三类事件（上游三次广播的可判等价物）。 */
export interface StatusBarEvents {
  added: StatusBarWidgetEntry[]
  removed: StatusBarWidgetEntry[]
  updated: StatusBarWidgetEntry[]
}

/**
 * 由快照的前后两份算出三类事件。
 *   · `added` / `removed`：按 id 做集合差（新装上的 / 摘掉的）；
 *   · `updated`：同 id 但锚点变了（本仓组件内容由响应式状态驱动，唯一"更新"得出来的就是锚点）。
 */
export function statusBarChangeEvents(prev: StatusBarSnapshot, next: StatusBarSnapshot): StatusBarEvents {
  const prevById = new Map(prev.installed.map(entry => [entry.id, entry]))
  const nextById = new Map(next.installed.map(entry => [entry.id, entry]))
  const added = next.installed.filter(entry => !prevById.has(entry.id))
  const removed = prev.installed.filter(entry => !nextById.has(entry.id))
  const updated = next.installed.filter(entry => {
    const before = prevById.get(entry.id)
    return before !== undefined && before.anchor !== entry.anchor
  })
  return { added, removed, updated }
}

/**
 * 订阅状态栏事件。返回注销函数（上游 `connect().subscribe(…)` 的 `Disposable` 在本仓是函数）。
 * 订阅是一条 EP 贡献（`source: 'user'`），所以第三方插件的监听器与内建的走同一条分派链。
 */
export function onStatusBarEvent(listener: StatusBarListener, scope: string = APPLICATION_SCOPE): () => void {
  const id = `statusbar.listener.${listenerSequence++}`
  const handle: ExtensionHandle = EXTENSIONS.registerExtension(STATUS_BAR_LISTENER_EP, id, listener, {
    scope, source: 'user',
  })
  return () => { handle.dispose() }
}

let listenerSequence = 0

/** 当前作用域下已订阅的全部监听器（已按 EP 的 `LoadingOrder` 排序）。 */
export function statusBarListeners(scope: string = APPLICATION_SCOPE): StatusBarListener[] {
  return EXTENSIONS.extensionsOf<StatusBarListener>(STATUS_BAR_LISTENER_EP, scope)
}

/**
 * 把一次组件表变化投给所有订阅者，并回传算出来的事件（调用方/判据可核）。
 * 逐条组件逐个回调 —— 上游也是每条 `syncPublisher(...)` 一次。
 *
 * 收前后两份**快照**（与 `statusBarChangeEvents` 同一形状）：调用方手上本来就是快照，
 * 让它自己拆成数组再在这里包回来是多余的一步，也容易两边形状走偏。
 */
export function dispatchStatusBarChange(
  prev: StatusBarSnapshot,
  next: StatusBarSnapshot,
  scope: string = APPLICATION_SCOPE,
): StatusBarEvents {
  const events = statusBarChangeEvents(prev, next)
  const listeners = statusBarListeners(scope)
  if (listeners.length) {
    for (const listener of listeners) {
      for (const entry of events.added) listener.widgetAdded?.(entry.id, entry.anchor)
      for (const entry of events.updated) listener.widgetUpdated?.(entry.id)
      for (const entry of events.removed) listener.widgetRemoved?.(entry.id)
    }
  }
  return events
}
