// 「弹层开着时，数据变了就地刷新」—— 上游
// `platform/lang-impl/src/com/intellij/ui/popup/PopupUpdateProcessor.java` 的可移植核心。
//
// 判决表对这一条的判词（`verdict-ui-tabs-popup.md` 族三）是：
// 「**『数据变了刷新已开的弹层』是真实缺口** —— 本仓的弹层都是一次性快照
//   （Search Everywhere 重新打开才看到新数据）；三个触发源本仓无」，
// 并给了落点建议：「可移植成一个 `while open: 监听数据源 → 重算 → 原地刷新` 的通道」。
//
// 核对原文后，把上游真正可移植的三条规则逐条抄下来（`PopupUpdateProcessor.java`）：
//   1. **监听是在弹层显示那一刻才挂的**，不是构造时（`beforeShown` 在 `:32`，整段逻辑都在里面）；
//   2. 事件到了先问「弹层还可见吗」—— 可见才刷新（`:38` `if (windowEvent.asPopup().isVisible())`），
//      不可见就**把监听摘掉**（`:46-48` `activeLookup.removeLookupListener(this)`），
//      也就是上游靠"第一次不可见事件"顺手做了退订；
//   3. 事件里**没有新条目就不刷新**（`:39-40` `if (item != null)`）——
//      选中项被取消/清空时，弹层内容保持原样，不是清空。
//
// 上游那一段还包着三个触发源（`DocumentationManager` / `LookupManager` / `QuickSearchComponent`，
//   `:5-13` 的 import 与 `:33-61` 的三个分支），本仓这三样都没有对应物，
//   所以这里只承接**通道**：`subscribe` 由调用方接上自己那一档数据源。
// 三个触发源与「本仓有什么对应物」的登记见 `docs/inventory/verdict-ui-tabs-popup.md` 族三。

import { ref, type Ref } from 'vue'

export interface LivePopupSourceOptions<T> {
  /** 第一次渲染与每次事件后的重算。**必须现取** —— 这就是"就地刷新"里"重算"那一步。 */
  read: () => T
  /**
   * 挂监听；返回退订函数。
   * `listener` 收到的 `payload` 是数据源那一拍带来的条目；
   * **`null`/`undefined` 表示"这一拍没有新条目"**，按上游 `:40` 的 `item != null` 不刷新。
   */
  subscribe: (listener: (payload: T | null | undefined) => void) => () => void
  /** 每次真正刷新后调一次（给"内容变了"的日志/音效用；不是必须）。 */
  onRefresh?: (value: T, previous: T | undefined) => void
}

export interface LivePopupSource<T> {
  /** 弹层当前该渲染的内容。读它就是"渲染时取数"，不需要调用方自己存快照。 */
  readonly value: Ref<T>
  /** 显示弹层：取一次数 + 挂监听（上游 `beforeShown`）。幂等（已开着时什么都不做）。 */
  open(): void
  /** 关掉弹层：退订（上游 `dispose` 那侧）。幂等。 */
  close(): void
  isOpen(): boolean
  /** 已经真正刷新过几次（判据用；不含 `open()` 里的首次取数）。 */
  revisions(): number
  /** 监听是否还挂着（上游 `removeLookupListener` 的可观测面）。 */
  isSubscribed(): boolean
}

export function createLivePopupSource<T>(options: LivePopupSourceOptions<T>): LivePopupSource<T> {
  // `undefined` = 还没取过数。`open()` 之前 value 是 undefined，调用方不该渲染这个状态。
  const value = ref(undefined) as Ref<T | undefined>
  let open = false
  let unsubscribe: (() => void) | null = null
  let revisions = 0

  function detach() {
    if (!unsubscribe) return
    const stop = unsubscribe
    unsubscribe = null
    stop()
  }

  function refresh() {
    const next = options.read()
    const previous = value.value
    value.value = next
    revisions++
    options.onRefresh?.(next, previous)
  }

  function onEvent(payload: T | null | undefined) {
    // 上游 :38 —— 弹层不可见就不刷新；顺手把监听摘掉（:46-48）。
    if (!open) { detach(); return }
    // 上游 :40 —— 这一拍没有新条目，弹层内容保持原样。
    if (payload === null || payload === undefined) return
    refresh()
  }

  return {
    value: value as Ref<T>,
    open() {
      if (open) return
      open = true
      value.value = options.read()
      unsubscribe = options.subscribe(onEvent)
    },
    close() {
      open = false
      detach()
    },
    isOpen: () => open,
    revisions: () => revisions,
    isSubscribed: () => unsubscribe !== null,
  }
}

/**
 * 一步式弹层的默认「就地把内容刷掉」回调形状。
 *
 * 上游那三个触发源都是"变了就 `updatePopup(...)`"（`:44`），
 * 本仓的对应面就是**把弹层依赖的那个 computed / ref 换掉**：
 * 把它挂在 `onRefresh` 上，弹层开着时数据一变就重算一次。
 */
export type LiveRefreshHook = () => void
