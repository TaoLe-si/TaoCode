// 全局弹层栈（IDEA 的 `PopupDispatcher` / `StackingPopupDispatcherImpl`）。
//
// 判词原文（docs/inventory/verdict-ui-tabs-popup.md）：
//   `PopupDispatcher.java` 「缺：全局弹层栈与批量收起」
//   `StackingPopupDispatcherImpl.java` 「缺 `:18-21` 的 `Stack` 全局栈与『关掉上层重开下层』逻辑」
// 上游那一层挂在 AWT 事件队列上（`PopupDispatcher.java:36-37` 的 `addAWTEventListener` /
// `addKeyEventDispatcher`），本仓没有 AWT，但**用户可见的行为**全部可以照抄：
//
//   · 弹层按打开顺序压栈、关闭时出栈 —— `StackingPopupDispatcherImpl.java:49-60`（onPopupShown）
//     与 `:63-74`（onPopupHidden）；
//   · 点击外部：从**最上层**往下走，落点在某层内就停、该层不许点外关也停，否则关掉它继续
//     —— `:116-164`（其中 `:130` 的 `bounds.contains(point) || !popup.isCancelOnClickOutside()`、
//     `:141` 的 `canClose()`）；
//   · Esc / 关闭请求只作用在**最上面那一个没被释放的层** —— `:181-193`（dispatchKeyEvent）
//     配合 `:168-178`（findPopup 会顺手丢掉已释放的栈顶）；
//   · 批量收起 = 逐个关到栈空，并且带"这一轮没关掉任何东西就停"的无进展保护 —— `:245-258`；
//   · 只收最上面那一层，且要它允许被窗口失焦收起 —— `:273-283`（closeActivePopup）；
//   · 持久弹层（`isPersistent`）不参与栈，失焦时整体隐藏/恢复 —— `:55-57`、`:77-92`；
//   · **Esc 是两段式的**，中间夹着速度搜索：这一层正被速度搜索过滤时，第一次 Esc 只清空过滤串、
//     弹层留着（`platform/platform-api/src/com/intellij/ui/speedSearch/SpeedSearch.java:77-81`
//     `isHoldingFilter()` ⇒ `updatePattern("")` + `e.consume()`），第二次 Esc 才取消弹层
//     （`AbstractPopup.java:3003-3010` 的取消分支带着 `!mySpeedSearch.isHoldingFilter()` 这道闸）；
//   · 弹层吃掉的那一次按键**不再放行给页面** —— `SpeedSearch.java:80` 的 `e.consume()`、
//     `PopupDispatcher.java:126-131` 经 `:169-172` 把 `dispatchKeyEvent` 的返回值交给 AWT 的
//     `KeyEventDispatcher`（true ⇒ 后续分发看不见这次按键）。本仓由 `PopupKeyEvent.consume()` 承接；
//   · 速度搜索装在弹层里是**默认档**，不是可选：工具窗口内容列表那层用的
//     `platform/platform-impl/src/com/intellij/openapi/wm/impl/content/SelectContentStep.kt:17`
//     就写着 `override fun isSpeedSearchEnabled(): Boolean = true`，
//     而 `platform/platform-impl/src/com/intellij/ui/popup/list/ListPopupImpl.java:1129` 按这一位装搜索。
//   · 「焦点/点击落在弹层里」这个判据，上游是 `JBPopupFactory.getParentBalloonFor`
//     （`ToolWindowManagerLifecycle.kt:131`），本仓由 `popupHasFocusWithin` 承接 ——
//     它是**工具窗口自动隐藏**（View Mode 的 Dock Unpinned / Undock）不收层的依据。
//
// 拆分口径：判定规则全在纯函数里（无 DOM，可单测）；`createPopupDispatcher` 只负责把
// DOM 事件与栈连起来，组件通过 `usePopupLayer` 注册自己。
//
// **消费方（2026-10-06 接线，判据 `tests/popup-layer-wiring.test.mjs`）**：
//   · `src/components/ToolWindowAnchorMenu.vue` —— 底部标签的「移动到…」菜单。它原先自己挂
//     `window` 的 pointerdown/keydown（DOM 菜单的土办法），现在整条交给这条栈：
//     一次点击/一次 Esc 只有一个所有者，两层弹层不会互相抢事件；
//   · `src/components/ContentComboLabel.vue` —— COMBO 形态的内容下拉，打开时压一层、收起时出栈；
//     它同时是**两段式 Esc 的那个消费者**：下拉列表带速度搜索（`SelectContentStep.kt:17`），
//     打了过滤串之后 Esc 先清串、列表不关，再按一次才收（判据在
//     `tests/popup-layer-wiring.test.mjs` 末尾那两条）；
//   · `src/toolWindowStripes.ts` —— 读 `popupHasFocusWithin` 回答「焦点进了弹层没有」
//     （`ToolWindowManagerLifecycle.kt:131`），auto-hide 的窗口据此**不**收面板。
//     这条在接线前是**死判据**：没有组件注册 ⇒ 栈恒空 ⇒ 永远答"没进弹层" ⇒ 开着菜单时
//     自动隐藏的窗口当场收掉。现在两处真实注册让它活了。
// 仍无消费者的部分（如实登记，不删）：`closeAll()`（批量收起，`:245-258`）与 `persistent`
// （`:55-57`/`:77-92`）—— 上游的批量收起由 `HideAllToolWindowsAction` 触发，本仓那条动作住在
// `src/toolTabs.ts` 里由 `src/App.vue`（保留文件）调用；接线请求见
// `docs/wiring-requests-2026-10-06-bucket8c.md`（上一任引用的 `…bucket8b.md` 从未落盘）。
import { onBeforeUnmount, ref, watch, type Ref } from 'vue'
import { pointInside, type Rect } from './popupPosition.ts'

/** 一个弹层的可判定快照（纯函数只看这些字段，不碰 DOM）。 */
export interface PopupLayerState {
  /** 栈内身份，越大越晚打开。 */
  readonly id: number
  /** 在屏幕上的位置；null = 还没量到（上游 `content.isShowing()` 为假那一支，`:123-126`）。 */
  bounds: Rect | null
  /** 已关闭/已释放：栈里遇到它就顺手丢掉（`findPopup`，`:169-175`）。 */
  readonly disposed?: boolean
  /** `JBPopup.isCancelOnClickOutside()`（`:130`）。 */
  readonly cancelOnClickOutside: boolean
  /** `JBPopup.canClose()`（`:141`）：模态/有校验的层不许被点外面关掉。 */
  readonly canClose: boolean
  /** `JBPopup.isCancelOnWindowDeactivation()`（`:277`）：失焦时收不收。 */
  readonly cancelOnDeactivation?: boolean
  /** `JBPopup.isPersistent()`（`:55`）：不进栈，整体隐藏/恢复。 */
  readonly persistent?: boolean
  /**
   * `SpeedSearch.isHoldingFilter()`（`platform/platform-api/src/com/intellij/ui/speedSearch/SpeedSearch.java:120`）：
   * 这一层里的速度搜索正压着过滤串 —— Esc 的第一段只做「清空过滤串」，**不**关这一层
   * （`SpeedSearch.java:77-81`；`AbstractPopup.java:3003` 的取消那一支带 `!mySpeedSearch.isHoldingFilter()` 闸）。
   */
  readonly holdingFilter?: boolean
}

export interface PopupStackApi {
  /** 注册一个弹层，返回栈内 id（`onPopupShown`，`:49-60`）。 */
  push: (layer: Omit<PopupLayerRegistration, 'id'>) => number
  remove: (id: number) => void
  /** 栈（自底向上）；已释放的栈顶先丢掉（`findPopup`，`:168-178`）。 */
  layers: () => PopupLayerState[]
  /** 最上面那一层（`getComponent()`，`:210-212`）；没有则 null。 */
  top: () => PopupLayerState | null
  /** 这一层是不是最上层：Esc / 关闭请求只该由最上层响应（`dispatchKeyEvent`，`:181-193`）。 */
  isTop: (id: number) => boolean
  depth: () => number
  /** 打开/关闭某一层时改状态，纯数据侧。 */
  setBounds: (id: number, bounds: Rect | null) => void
  /** 批量收起（`close()`，`:245-258`）：返回关掉的层数。 */
  closeAll: () => number
  /** 只关最上面那层（`closeActivePopup()`，`:273-283`）：返回是否关掉。 */
  closeTop: () => boolean
  /**
   * 键盘关闭请求该给谁并把它关掉（`StackingPopupDispatcherImpl.dispatchKeyEvent`，`:181-193`）：
   * 关闭请求（Esc）取 `findPopup()` 的栈顶，模态对话框里的层不算（`:186-190`）。
   * 栈空或目标被模态闸挡住 ⇒ 返回 false，这一次按键放行给页面。
   */
  closeRequest: (focusedId?: number | null) => boolean
  /** 落点是否落在任意弹层里（`bounds.contains(point)` 那一支，`:130`）。 */
  containsPoint: (x: number, y: number) => boolean
  /** 焦点是否落在某个弹层的 DOM 子树里（上游 `JBPopupFactory.getParentBalloonFor`，`ToolWindowManagerLifecycle.kt:131`）。 */
  hasFocusWithin: (active: Element | null) => boolean
}

/**
 * 点击外部的裁决（`StackingPopupDispatcherImpl.dispatchMouseEvent`，`:116-164`）。
 *
 * 栈自顶向下遍历，返回**要依次取消**的层 id（顺序即取消顺序）。停止条件逐条照上游：
 *  1. 落点在该层矩形内 ⇒ 停（`bounds.contains(point)`，`:130`，前面的层也不动）；
 *  2. 该层 `cancelOnClickOutside` 为假 ⇒ 停（同一行）；
 *  3. 该层 `canClose` 为假 ⇒ 停（`:141-143`）；
 *  4. 否则取消它，继续看下一层。
 * 已释放的层不入结果（`:161-163` 只是丢栈，不算一次取消）。
 */
export function popupsToCancelOnOutsidePress(layers: readonly PopupLayerState[],
                                             point: { x: number; y: number }): number[] {
  const toCancel: number[] = []
  for (let index = layers.length - 1; index >= 0; index--) {
    const layer = layers[index]!
    if (layer.disposed) continue
    // 上游 `:123-126`：内容不在屏幕上 ⇒ 直接 cancel 并结束整轮遍历。
    if (!layer.bounds) { toCancel.push(layer.id); return toCancel }
    if (pointInside(layer.bounds, point)) return toCancel
    if (!layer.cancelOnClickOutside) return toCancel
    if (!layer.canClose) return toCancel
    toCancel.push(layer.id)
  }
  return toCancel
}

/** 落点在矩形内：`pointInside` 住在 `src/popupPosition.ts`（与浮层命中判据共用一条规则）。 */

/** `findPopup()`（`:168-178`）：丢掉已释放的栈顶，返回最上面那个还活着的层。 */
export function findTopLayer(layers: readonly PopupLayerState[]): PopupLayerState | null {
  for (let index = layers.length - 1; index >= 0; index--) {
    const layer = layers[index]!
    if (!layer.disposed) return layer
  }
  return null
}

/**
 * Esc / 关闭请求该给谁（`dispatchKeyEvent`，`:181-193`）：
 * `isCloseRequest` 为真时用 `findPopup()`（最上层），否则用 `getFocusedPopup()`（焦点所在那层）。
 * 本仓没有"焦点不在栈内的独立弹层"这一态，故焦点层由调用方给出；两者都没有 ⇒ 不收。
 */
export function closeRequestTarget(layers: readonly PopupLayerState[], focusedId: number | null,
                                   isCloseRequest = true): PopupLayerState | null {
  if (isCloseRequest) return findTopLayer(layers)
  return layers.find(layer => layer.id === focusedId && !layer.disposed) ?? null
}

/**
 * 一次 Esc 落到栈顶那层之后**做哪一步**（两段式取消）：
 *   · `clear-filter` —— 这一层的速度搜索正压着过滤串：只把串清空，弹层留着
 *     （`SpeedSearch.java:77-81`：`isHoldingFilter()` ⇒ `updatePattern("")` + `e.consume()`，
 *     压根没走到取消弹层那一步；`AbstractPopup.java:3003` 的取消分支带着
 *     `!mySpeedSearch.isHoldingFilter()` 这道闸，同一个意思的另一种写法）；
 *   · `cancel` —— 没有在过滤 ⇒ `cancel(e)`（`AbstractPopup.java:3007-3009`）；
 *     这一层此刻不许关（`canClose()` 为假，`:141`/`:277`）就不算吃掉按键；
 *   · `none` —— 栈上没层，或这一层不许关且没在过滤 ⇒ 按键放行给页面
 *     （`StackingPopupDispatcherImpl.java:185` 的 `if (popup == null) return false`）。
 * 两种"吃掉按键"的结果都由调用方去 `consume()` —— 上游那两条都是 `return true`
 * （`SpeedSearch.java:80` 的 `e.consume()`、`PopupDispatcher.java:126-131` 经 `:171` 把 true 交给 AWT）。
 */
export function popupEscapeAction(target: PopupLayerState | null): 'none' | 'clear-filter' | 'cancel' {
  if (!target) return 'none'
  if (target.holdingFilter === true) return 'clear-filter'
  return target.canClose ? 'cancel' : 'none'
}

/**
 * 批量收起的序列（`close()`，`:245-258`）：反复 `closeActivePopup` 直到关不动为止。
 * 上游的无进展保护是「栈大小没变就 break」（`:248-256`）—— 这里等价成「这一层不许被失焦收起就停」，
 * 并且**同一层不会被关两次**（那是上游 size 相同那条防的死循环）。
 */
export function closeAllPlan(layers: readonly PopupLayerState[]): number[] {
  const closed: number[] = []
  const stack = layers.filter(layer => !layer.disposed && layer.persistent !== true)
  for (let index = stack.length - 1; index >= 0; index--) {
    const layer = stack[index]!
    // `closeActivePopup()`（`:277`）的三个条件：可见 + 允许随窗口失焦收起 + canClose。
    if (layer.cancelOnDeactivation === false || !layer.canClose) break
    if (closed.includes(layer.id)) break
    closed.push(layer.id)
  }
  return closed
}

/**
 * 持久弹层的隐藏/恢复（`hidePersistentPopups`/`restorePersistentPopups`，`:77-92`）：
 * 只对 `persistent` 且 `isNativePopup` 的那几个改 UI 可见性，**不销毁**。
 * 本仓的持久层 = 常驻的浮层（如钉住的列表面板），由宿主决定它收谁。
 */
export function persistentLayerIds(layers: readonly PopupLayerState[]): number[] {
  return layers.filter(layer => layer.persistent === true).map(layer => layer.id)
}

/** 组件注册一层时给的东西：状态字段 + 三个回调。 */
export interface PopupLayerRegistration extends PopupLayerState {
  /** 取消这一层（`popup.cancel(...)`，`:153`）。由组件提供，栈只调用。 */
  cancel: () => void
  /**
   * 每次判定现问一次的 `canClose`（上游 `popup.canClose()` 就在遍历里现场调，`:141`）。
   * 给了它，快照里的 `canClose` 就以它为准 —— 静态字段只当默认值。
   */
  canCloseNow?: () => boolean
  /**
   * 每次判定现问一次的 `isHoldingFilter()`（上游 `SpeedSearch.java:120`；
   * `AbstractPopup.java:3003` 与 `SpeedSearch.java:78` 都是在按键到达时**现场**问的，
   * 用户边打字边按 Esc 也算）。给了它，快照里的 `holdingFilter` 就以它为准。
   */
  holdingFilterNow?: () => boolean
  /**
   * 清空过滤串（`SpeedSearch.updatePattern("")`，`:79`）—— Esc 的第一段只做这一步，
   * 弹层保持打开。没有这一层（这一层没有速度搜索）时 `holdingFilter` 恒为假，走不到这里。
   */
  resetFilter?: () => void
  /** 每次判定前重新量一次尺寸（懒，避免打开后布局变化量不到）。 */
  measure?: () => Rect | null
  /** 这一层的 DOM 根节点（`hasFocusWithin` 用；上游是 `popup.getContent()`）。 */
  node?: () => HTMLElement | null | undefined
}

/**
 * 全局链上的一次按键（`PopupDispatcher.java:37` 的 `addKeyEventDispatcher` 收到的就是
 * 一个能问「已被消费」与「替我消费」的 `KeyEvent`）。
 */
export interface PopupKeyEvent {
  readonly key: string
  /** `SpeedSearch.java:58` 的 `e.isConsumed()`：别人已经吃掉这次按键 ⇒ 本链不再处理。 */
  readonly alreadyConsumed: boolean
  /** `e.consume()` / `KeyEventDispatcher` 返回 true：这一次按键到此为止，不再放行给页面。 */
  consume: () => void
}

/**
 * 把栈接到真实 DOM 上的那一层（本模块唯一碰 `window` 的部分）。
 * SSR/Node 下不安装监听器 —— `usePopupLayer` 只维护栈本身。
 */
export function createPopupDispatcher(host: {
  addPointerListener: (handler: (event: { clientX: number; clientY: number }) => void) => () => void
  /** 上游 `PopupDispatcher.java:37` 的 `addKeyEventDispatcher`：键盘关闭请求（Esc）也挂在同一条全局链上。 */
  addKeyListener?: (handler: (event: PopupKeyEvent) => void) => () => void
  /**
   * 现在拿着焦点的**模态对话框**根节点（上游 `:186-190`：焦点窗口是模态 `Dialog` 且弹层内容
   * 不在它里面 ⇒ 这一次关闭请求不归弹层）。没有模态框在给 null。
   */
  focusedModalRoot?: () => Element | null
}): PopupStackApi & {
  register: (layer: Omit<PopupLayerRegistration, 'id'>) => { id: number; dispose: () => void }
  dispose: () => void
} {
  const stack: PopupLayerRegistration[] = []
  let nextId = 1

  function snapshot(): PopupLayerState[] {
    return stack.map(layer => ({
      ...layer,
      bounds: layer.measure ? layer.measure() : layer.bounds,
      // `canClose` 现问（上游在遍历里现场调 `popup.canClose()`，`:141`）；没给谓词就用登记值。
      canClose: layer.canCloseNow ? layer.canCloseNow() : layer.canClose,
      // `isHoldingFilter()` 同样现问（`SpeedSearch.java:78` 就在按键分发里现场问）。
      holdingFilter: layer.holdingFilterNow ? layer.holdingFilterNow() : layer.holdingFilter === true,
    }))
  }
  function indexOf(id: number): number { return stack.findIndex(layer => layer.id === id) }

  const api: PopupStackApi = {
    push(layer) {
      const id = nextId++
      stack.push({ ...layer, id })
      return id
    },
    remove(id) {
      const at = indexOf(id)
      if (at >= 0) stack.splice(at, 1)
    },
    layers: snapshot,
    top() { return findTopLayer(snapshot()) },
    isTop(id) { const top = findTopLayer(snapshot()); return top !== null && top.id === id },
    depth() { return stack.length },
    setBounds(id, bounds) {
      const layer = stack[indexOf(id)]
      if (layer) layer.bounds = bounds
    },
    closeAll() {
      const plan = closeAllPlan(snapshot())
      for (const id of plan) {
        const layer = stack[indexOf(id)]
        layer?.cancel()
      }
      return plan.length
    },
    closeTop() {
      const layers = snapshot()
      const target = findTopLayer(layers)
      if (!target) return false
      // `closeActivePopup()`（`:277`）：失焦收起这条闸由层自己声明。
      if (target.cancelOnDeactivation === false || !target.canClose) return false
      const before = stack.length
      stack[indexOf(target.id)]?.cancel()
      return stack.length !== before || target.disposed === true
    },
    closeRequest(focusedId = null) {
      const layers = snapshot()
      // `dispatchKeyEvent`（`:183-185`）：closeRequest ⇒ `findPopup()`（丢掉已释放的栈顶）。
      const target = closeRequestTarget(layers, focusedId, true)
      if (!target) return false
      const layer = stack[indexOf(target.id)]
      if (!layer) return false
      // `:186-190` 的模态闸：焦点在模态对话框里，而这一层不是它的后代 ⇒ 不归弹层管。
      const modal = host.focusedModalRoot?.() ?? null
      const node = layer.node?.() ?? null
      if (modal && !(node && modal.contains(node))) return false
      // 两段式（`SpeedSearch.java:77-81` 在前、`AbstractPopup.java:3003-3010` 在后）：
      // 压着过滤串就先只清串，弹层不关；没在过滤才取消这一层。
      const action = popupEscapeAction(target)
      if (action === 'none') return false
      if (action === 'clear-filter') { layer.resetFilter?.(); return true }
      layer.cancel()
      return true
    },
    containsPoint(x, y) {
      return snapshot().some(layer => layer.bounds !== null && pointInside(layer.bounds, { x, y }))
    },
    hasFocusWithin(active) {
      if (!active) return false
      // 上游是 `JBPopupFactory.getParentBalloonFor(focusedComponent)`（`ToolWindowManagerLifecycle.kt:131`）：
      // 焦点组件只要是某个弹层内容树的后代，就算「焦点进了弹层」。
      return stack.some(layer => layer.node?.()?.contains(active) === true)
    },
  }
  /** 注册一层：返回的 dispose 同时负责出栈（`onPopupShown`/`onPopupHidden` 那一对）。 */
  function register(layer: Omit<PopupLayerRegistration, 'id'>): { id: number; dispose: () => void } {
    const id = api.push(layer)
    return { id, dispose: () => api.remove(id) }
  }
  // 点击外部：一次遍历决定要关哪几层（上游在 MOUSE_PRESSED 上做，`:95-106`）。
  const stopPointer = host.addPointerListener(event => {
    const layers = snapshot()
    if (!layers.length) return
    const toCancel = popupsToCancelOnOutsidePress(layers, { x: event.clientX, y: event.clientY })
    for (const id of toCancel) stack[indexOf(id)]?.cancel()
  })
  // 键盘关闭请求（Esc）：只给栈顶那层（`dispatchKeyEvent`，`:181-193`）。
  const stopKey = host.addKeyListener?.(event => {
    if (event.key !== 'Escape') return
    // `SpeedSearch.java:58` 的 `if (e.isConsumed() …) return`：这一次按键已经有人处理过就不再插手。
    if (event.alreadyConsumed) return
    // 上游吃按键的两处都是 `return true`：`SpeedSearch.java:80` 的 `e.consume()` 与
    // `PopupDispatcher.java:126-131` 经 `:171` 把 `dispatchKeyEvent` 的 true 交给 AWT 的
    // `KeyEventDispatcher`（返回 true ⇒ 这条链之外再也看不到这次按键）。
    // 本仓的等价物就是 consume()：不消费的话页面自己那条 Esc 链（backdrop 关别的层、
    // 速度搜索收搜索框）会在**同一次按键**里跟着执行 ⇒ 两段式塌成一段，一次 Esc 关掉两层。
    if (api.closeRequest()) event.consume()
  })
  return { ...api, register, dispose: () => { stopPointer(); stopKey?.() } }
}

export interface UsePopupLayerOptions {
  /** 这一层许不许点外面关掉（`isCancelOnClickOutside`）。 */
  cancelOnClickOutside?: boolean
  /** 现在能不能关（`canClose`）：有未提交校验的层给 false。 */
  canClose?: () => boolean
  /** 随窗口失焦收起（`isCancelOnWindowDeactivation`，`:277`）。 */
  cancelOnDeactivation?: boolean
  /** 持久层：不入栈、批量收起不动它（`:55-57`、`:77-92`）。 */
  persistent?: boolean
  /**
   * 这一层里的速度搜索正压着过滤串（`SpeedSearch.isHoldingFilter()`，`SpeedSearch.java:120`）。
   * 每次判定现问（`SpeedSearch.java:78` 就在按键分发里现场问），所以给的是谓词不是布尔。
   */
  holdingFilter?: () => boolean
  /** 清空过滤串（`SpeedSearch.updatePattern("")`，`:79`）：Esc 的第一段只做这一步。 */
  resetFilter?: () => void
}

/**
 * 组件侧接线：`open` 为真时压栈、为假或卸载时出栈 —— 与上游的
 * `onPopupShown`/`onPopupHidden` 一一对应（`:49-74`）。
 * 返回栈内 id 与 `isTop()`：Esc 只该由最上层响应（`dispatchKeyEvent`，`:181-193`）。
 *
 * 初始态**同步**入栈（不走 watch 的 `immediate`）：pre-flush 的回调要等调度器排空才跑，
 * 于是"setup 之后、第一次刷新之前"这窗口里的任何一次判定（包括 SSR 渲染、以及父组件
 * 同帧就读 `popupStackDepth()` 的宿主）都看不到这一层。上游没有这个问题 ——
 * `JBPopup.show()` 返回时 `onPopupShown` 已经进栈了（`:49-60`）。
 */
export function usePopupLayer(element: Ref<HTMLElement | null | undefined>, open: Ref<boolean>,
                              cancel: () => void, options: UsePopupLayerOptions = {}): {
  id: Ref<number | null>
  isTop: () => boolean
} {
  const id = ref<number | null>(null)
  const stack = popupDispatcher()
  function showLayer() {
    if (id.value !== null) return
    id.value = stack.push({
      bounds: null,
      cancelOnClickOutside: options.cancelOnClickOutside !== false,
      // `canClose` 每次判定现问（上游 `popup.canClose()` 就在遍历里调，`:141`）：
      // 调用方给谓词就用它，没给就等于「随时可以关」。
      canClose: options.canClose ? options.canClose() : true,
      canCloseNow: options.canClose,
      // 速度搜索的过滤串现问（`SpeedSearch.java:120`）+ 清空它的那一步（`:79`）。
      holdingFilter: false,
      holdingFilterNow: options.holdingFilter,
      resetFilter: options.resetFilter,
      cancelOnDeactivation: options.cancelOnDeactivation !== false,
      persistent: options.persistent === true,
      measure: () => {
        const box = element.value?.getBoundingClientRect()
        return box && box.width > 0 ? { x: box.left, y: box.top, width: box.width, height: box.height } : null
      },
      node: () => element.value,
      cancel,
    })
  }
  function hideLayer() {
    if (id.value === null) return
    stack.remove(id.value)
    id.value = null
  }
  if (open.value) showLayer()
  watch(open, showing => { if (showing) showLayer(); else hideLayer() })
  onBeforeUnmount(hideLayer)
  return { id, isTop: () => id.value !== null && stack.isTop(id.value) }
}

/**
 * 本进程唯一的一份弹层栈（与 `src/macroHost.ts` 的 activeSession、`toolWindowStripes.ts` 的
 * `activeToolWindowLayoutState()` 同一手法：宿主没有装配点，域自己持一份）。
 * 浏览器里才装监听器；SSR/Node 下退订函数是空的。
 *
 * **为什么挂在 `globalThis` 上而不是模块级变量**：上游这一份是类级的
 * `private static final PopupDispatcher ourInstance`（`PopupDispatcher.java:23-37`）——
 * 一个 AWT 事件队列上只有一条链，鼠标与键盘共用它。本仓的模块可以被求值两遍
 * （`tests/vue-sfc-loader.mjs:17-21/57` 有自己的一份 `.ts` 缓存，与 Node 的 ESM 注册表不是同一个实例；
 * 打包器的 SSR / 客户端双图也会各要一份），模块级变量在两遍求值下就是**两个栈**：
 * 组件把自己压进 A 栈，宿主查的是 B 栈 ⇒ 「焦点进了弹层」永远答否，auto-hide 照收不误。
 * 栈的身份是"进程级"的，所以存处也得是进程级。
 */
const DISPATCHER_GLOBAL = '__taocodePopupDispatcher'
export function popupDispatcher(): PopupStackApi & { dispose: () => void } {
  const registry = globalThis as Record<string, unknown>
  const existing = registry[DISPATCHER_GLOBAL] as (PopupStackApi & { dispose: () => void }) | undefined
  if (existing) return existing
  const inBrowser = typeof window !== 'undefined' && typeof document !== 'undefined'
  const dispatcher = createPopupDispatcher({
    addPointerListener: handler => {
      if (!inBrowser) return () => {}
      const wrapped = (event: PointerEvent) => handler({ clientX: event.clientX, clientY: event.clientY })
      // 捕获阶段：先决定关掉哪几层，再让页面自己的 handler 看到这一次点击
      //（上游的 AWTEventListener 同样是全局前置，`PopupDispatcher.java:36`）。
      window.addEventListener('pointerdown', wrapped, true)
      return () => window.removeEventListener('pointerdown', wrapped, true)
    },
    // 上游的键盘侧是同一条全局链（`PopupDispatcher.java:37` 的 `addKeyEventDispatcher`）。
    addKeyListener: handler => {
      if (!inBrowser) return () => {}
      // 把 DOM 事件包成 `PopupKeyEvent`：`alreadyConsumed` = `defaultPrevented`，
      // `consume()` = `preventDefault()` + `stopPropagation()`（捕获阶段拦在页面之前）。
      const wrapped = (event: KeyboardEvent) => handler({
        key: event.key,
        alreadyConsumed: event.defaultPrevented,
        consume: () => { event.preventDefault(); event.stopPropagation() },
      })
      window.addEventListener('keydown', wrapped, true)
      return () => window.removeEventListener('keydown', wrapped, true)
    },
    // 模态闸（`:186-190`）：本仓的模态框是 `<dialog>` / `role="dialog"` / `.modal-backdrop`
    // 三种形态（与 `src/toolWindowStripes.ts` 的 `focusGoesToDialog` 同一张选择器表）。
    focusedModalRoot: () => {
      if (!inBrowser) return null
      const active = document.activeElement
      return active?.closest('dialog, [role="dialog"], .modal-backdrop') ?? null
    },
  })
  registry[DISPATCHER_GLOBAL] = dispatcher
  return dispatcher
}

/** 焦点是不是落在某个弹层里（上游 `JBPopupFactory.getParentBalloonFor`）。 */
export function popupHasFocusWithin(active: Element | null): boolean {
  if (typeof document === 'undefined') return false
  return popupDispatcher().hasFocusWithin(active)
}

/** 栈上还有几层（`StackingPopupDispatcherImpl.java:104`/`:156` 的那两处 `myStack.isEmpty()`）。 */
export function popupStackDepth(): number { return popupDispatcher().depth() }
