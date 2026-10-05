// 全局弹层栈的判据（上游 `PopupDispatcher` / `StackingPopupDispatcherImpl`）。
//
// 上游坐标（参考树 intellij-community-master）：
//   · `platform/platform-impl/src/com/intellij/ui/popup/PopupDispatcher.java:36-37` —— 全局前置监听；
//   · `platform/platform-impl/src/com/intellij/ui/popup/StackingPopupDispatcherImpl.java`
//     `:49-74` 压栈/出栈、`:116-164` 点外面的自顶向下裁决、`:168-178` findPopup、
//     `:181-193` 关闭请求只给最上层、`:245-258` 批量收起（带无进展保护）、`:273-283` 只关一层、
//     `:55-57` 与 `:77-92` 持久层不入栈、整体隐藏/恢复。
import test from 'node:test'
import assert from 'node:assert/strict'
import {
  closeAllPlan, closeRequestTarget, createPopupDispatcher, findTopLayer,
  persistentLayerIds, popupEscapeAction, popupsToCancelOnOutsidePress,
} from '../src/popupStack.ts'
import { pointInside } from '../src/popupPosition.ts'

/** 造一层：矩形 + 三条闸，默认全开。 */
function layer(id, bounds, options = {}) {
  return {
    id,
    bounds,
    cancelOnClickOutside: options.cancelOnClickOutside !== false,
    canClose: options.canClose !== false,
    cancelOnDeactivation: options.cancelOnDeactivation !== false,
    persistent: options.persistent === true,
    disposed: options.disposed === true,
  }
}
const BOX_A = { x: 0, y: 0, width: 200, height: 100 }
const BOX_B = { x: 500, y: 200, width: 150, height: 80 }

test('点外面：落点在最上层里 ⇒ 一层都不关（:130 的 bounds.contains 先命中就 return false）', () => {
  const layers = [layer(1, BOX_A), layer(2, BOX_B)]
  assert.deepEqual(popupsToCancelOnOutsidePress(layers, { x: 520, y: 240 }), [])
})

test('点外面：落点在**下层**里 ⇒ 只关掉盖在它上面的那层（:116-164 的自顶向下）', () => {
  const layers = [layer(1, BOX_A), layer(2, BOX_B)]
  assert.deepEqual(popupsToCancelOnOutsidePress(layers, { x: 10, y: 10 }), [2])
})

test('点外面：两处都不在 ⇒ 整条链按从上到下的顺序关掉', () => {
  const layers = [layer(1, BOX_A), layer(2, BOX_B), layer(3, { x: 900, y: 600, width: 40, height: 40 })]
  assert.deepEqual(popupsToCancelOnOutsidePress(layers, { x: 400, y: 700 }), [3, 2, 1])
})

test('点外面：某层不许「点外关」就停在那一层，下面的层一起留着', () => {
  const layers = [layer(1, BOX_A), layer(2, BOX_B, { cancelOnClickOutside: false }), layer(3, { x: 900, y: 600, width: 40, height: 40 })]
  assert.deepEqual(popupsToCancelOnOutsidePress(layers, { x: 400, y: 700 }), [3])
})

test('点外面：某层 canClose 为假（有未提交校验）⇒ 停，且它自己也不算被关（:141-143）', () => {
  const layers = [layer(1, BOX_A), layer(2, BOX_B, { canClose: false }), layer(3, { x: 900, y: 600, width: 40, height: 40 })]
  assert.deepEqual(popupsToCancelOnOutsidePress(layers, { x: 400, y: 700 }), [3])
})

test('点外面：量不到矩形的层按「内容已不在屏幕上」处理 —— 关掉它并结束整轮（:123-126）', () => {
  const layers = [layer(1, BOX_A), layer(2, null), layer(3, BOX_B)]
  assert.deepEqual(popupsToCancelOnOutsidePress(layers, { x: 400, y: 700 }), [3, 2])
})

test('点外面：已释放的层不是一次取消（:161-163 只丢栈）', () => {
  const layers = [layer(1, BOX_A), layer(2, BOX_B, { disposed: true })]
  assert.deepEqual(popupsToCancelOnOutsidePress(layers, { x: 400, y: 700 }), [1])
})

test('findPopup：丢掉已释放的栈顶（:168-178）', () => {
  assert.equal(findTopLayer([layer(1, BOX_A), layer(2, BOX_B, { disposed: true })])?.id, 1)
  assert.equal(findTopLayer([layer(1, BOX_A, { disposed: true })]), null)
  assert.equal(findTopLayer([]), null)
})

test('关闭请求（Esc）只给最上层；非关闭请求给焦点所在那层（:181-193）', () => {
  const layers = [layer(1, BOX_A), layer(2, BOX_B)]
  assert.equal(closeRequestTarget(layers, 1)?.id, 2, 'Esc 给最上层，不给"焦点那层"')
  assert.equal(closeRequestTarget(layers, 1, false)?.id, 1, '普通按键给焦点所在的层')
  assert.equal(closeRequestTarget(layers, 99, false), null, '焦点不在栈里 ⇒ 什么都不做')
})

test('批量收起：自顶向下逐个关，遇到不许随失焦收起的那层就停（:245-258 + :273-283）', () => {
  assert.deepEqual(closeAllPlan([layer(1, BOX_A), layer(2, BOX_B)]), [2, 1])
  assert.deepEqual(closeAllPlan([layer(1, BOX_A, { cancelOnDeactivation: false }), layer(2, BOX_B)]), [2],
    '下层「不随失焦收起」⇒ 上层照关，走到下层那一轮停')
  assert.deepEqual(closeAllPlan([layer(1, BOX_A), layer(2, BOX_B, { canClose: false })]), [],
    '最上层不许关 ⇒ 无进展保护立刻生效（:250-255）')
})

test('批量收起：持久层不参与（它走 hidePersistentPopups 那条路，:77-92）', () => {
  const layers = [layer(1, BOX_A), layer(2, BOX_B, { persistent: true })]
  assert.deepEqual(closeAllPlan(layers), [1])
  assert.deepEqual(persistentLayerIds(layers), [2])
})

test('落点判据是左闭右开（同 java.awt.Rectangle.contains）', () => {
  assert.equal(pointInside(BOX_A, { x: 0, y: 0 }), true)
  assert.equal(pointInside(BOX_A, { x: 199.5, y: 99.5 }), true)
  assert.equal(pointInside(BOX_A, { x: 200, y: 50 }), false)
  assert.equal(pointInside(BOX_A, { x: 50, y: 100 }), false)
})

// --- 栈本身（用假宿主驱动，不碰 window）---------------------------------------------------------
function harness() {
  const events = []
  let pointerHandler = null
  const dispatcher = createPopupDispatcher({
    addPointerListener: handler => { pointerHandler = handler; return () => { pointerHandler = null } },
  })
  const opened = []
  function open(bounds, options = {}) {
    const id = dispatcher.push({
      bounds,
      cancelOnClickOutside: options.cancelOnClickOutside !== false,
      canClose: options.canClose !== false,
      cancelOnDeactivation: options.cancelOnDeactivation !== false,
      persistent: options.persistent === true,
      measure: () => bounds,
      node: options.node,
      cancel: () => { opened.push(idRef.value); dispatcher.remove(idRef.value) },
    })
    const idRef = { value: id }
    return id
  }
  return {
    dispatcher,
    events,
    open,
    press: (x, y) => pointerHandler?.({ clientX: x, clientY: y }),
  }
}

test('栈按打开顺序排；remove 后栈缩短，isTop 只认最上面那个', () => {
  const h = harness()
  const first = h.open(BOX_A)
  const second = h.open(BOX_B)
  assert.equal(h.dispatcher.depth(), 2)
  assert.deepEqual(h.dispatcher.layers().map(l => l.id), [first, second])
  assert.equal(h.dispatcher.isTop(second), true)
  assert.equal(h.dispatcher.isTop(first), false)
  h.dispatcher.remove(second)
  assert.equal(h.dispatcher.isTop(first), true)
  assert.equal(h.dispatcher.depth(), 1)
})

test('真实点击：只关掉裁决给出的那几层，下层留着（一次点外面不等于全关）', () => {
  const h = harness()
  const first = h.open(BOX_A)
  const second = h.open(BOX_B)
  h.press(10, 10)   // 落在下层里 ⇒ 只关上层
  assert.deepEqual(h.dispatcher.layers().map(l => l.id), [first])
  h.press(700, 700) // 现在唯一那层外面 ⇒ 关掉它
  assert.equal(h.dispatcher.depth(), 0)
})

test('closeAll 一次收干净并返回关掉了几层；空栈收不动', () => {
  const h = harness()
  h.open(BOX_A)
  h.open(BOX_B)
  assert.equal(h.dispatcher.closeAll(), 2)
  assert.equal(h.dispatcher.depth(), 0)
  assert.equal(h.dispatcher.closeAll(), 0)
  assert.equal(h.dispatcher.closeTop(), false, '栈空时 closeTop 直接 false（:274）')
})

test('hasFocusWithin 用 DOM 子树包含（上游 getParentBalloonFor），没有节点就不算', () => {
  const h = harness()
  const inner = { contains: node => node === inner }
  const other = { contains: () => false }
  h.open(BOX_A, { node: () => inner })
  assert.equal(h.dispatcher.hasFocusWithin(inner), true)
  assert.equal(h.dispatcher.hasFocusWithin(other), false)
  assert.equal(h.dispatcher.hasFocusWithin(null), false)
})

// ── Esc 的两段式：速度搜索压着过滤串时，第一次只清串（2026-10-06 补完的那一条）──────────
// 上游坐标（参考树 intellij-community-master）：
//   · `platform/platform-api/src/com/intellij/ui/speedSearch/SpeedSearch.java:77-81`
//     —— Esc 且 `isHoldingFilter()` ⇒ `updatePattern("")` + `e.consume()`，压根没走到取消弹层；
//     同文件 `:58` 的 `if (e.isConsumed() || !myEnabled) return` —— 已被消费的按键不再处理；
//   · `platform/platform-impl/src/com/intellij/ui/popup/AbstractPopup.java:3003-3010`
//     —— 取消那一支带着 `!mySpeedSearch.isHoldingFilter()` 这道闸，且返回 true（吃掉按键）；
//   · `platform/platform-impl/src/com/intellij/ui/popup/PopupDispatcher.java:126-131` 经 `:169-172`
//     把 `dispatchKeyEvent` 的返回值交给 AWT 的 `KeyEventDispatcher`：true ⇒ 页面看不到这次按键。
// 速度搜索装在弹层里是**默认档**：`platform/platform-impl/src/com/intellij/openapi/wm/impl/content/SelectContentStep.kt:17`
// `override fun isSpeedSearchEnabled(): Boolean = true`，`ListPopupImpl.java:1129` 按这一位装它。

/** 键侧的夹具：与 `harness()` 同一手法，把 `addKeyListener` 的 handler 攥住手动按。 */
function keyHarness() {
  const log = []
  let keyHandler = null
  const dispatcher = createPopupDispatcher({
    addPointerListener: () => () => {},
    addKeyListener: handler => { keyHandler = handler; return () => { keyHandler = null } },
  })
  /** 按一次 Esc：返回这一次有没有被弹层吃掉（上游的 `e.consume()` / dispatch 返回 true）。 */
  function pressEscape(alreadyConsumed = false) {
    let consumed = false
    keyHandler?.({ key: 'Escape', alreadyConsumed, consume: () => { consumed = true } })
    log.push(consumed)
    return consumed
  }
  function openLayer(options = {}) {
    const id = dispatcher.push({
      bounds: { x: 0, y: 0, width: 10, height: 10 },
      cancelOnClickOutside: true,
      canClose: options.canClose !== false,
      holdingFilter: false,
      holdingFilterNow: options.holdingFilterNow,
      resetFilter: options.resetFilter,
      measure: () => ({ x: 0, y: 0, width: 10, height: 10 }),
      cancel: () => { log.push('cancel'); dispatcher.remove(id) },
    })
    return id
  }
  return { dispatcher, pressEscape, openLayer, log }
}

test('popupEscapeAction：压着过滤串 ⇒ clear-filter，且与 canClose 无关（SpeedSearch.java:78-81 在取消闸之前）', () => {
  assert.equal(popupEscapeAction(null), 'none', '栈上没层 ⇒ 按键放行（StackingPopupDispatcherImpl.java:185）')
  assert.equal(popupEscapeAction({ id: 1, bounds: null, cancelOnClickOutside: true, canClose: true, holdingFilter: true }),
    'clear-filter')
  // 上游 `SpeedSearch.java:78-81` 只问 `isHoldingFilter()`，不问这一层许不许关：
  // 一个"有未提交校验所以不能关"的弹层，Esc 仍然只清过滤串。
  assert.equal(popupEscapeAction({ id: 1, bounds: null, cancelOnClickOutside: true, canClose: false, holdingFilter: true }),
    'clear-filter')
  assert.equal(popupEscapeAction({ id: 1, bounds: null, cancelOnClickOutside: true, canClose: true, holdingFilter: false }),
    'cancel', 'AbstractPopup.java:3007-3009 的 cancel(e)')
  assert.equal(popupEscapeAction({ id: 1, bounds: null, cancelOnClickOutside: true, canClose: false, holdingFilter: false }),
    'none', ':141/`:277` 的 canClose 闸挡住的取消不算吃掉按键')
})

test('两段式 Esc：第一次只清空过滤串、弹层留着；第二次才取消它（SpeedSearch.java:77-81 → AbstractPopup.java:3003-3010）', () => {
  const h = keyHarness()
  let filter = 'run'
  h.openLayer({ holdingFilterNow: () => filter !== '', resetFilter: () => { filter = '' } })
  assert.equal(h.pressEscape(), true, '清过滤串那一次也要吃掉按键（:80 的 e.consume()）')
  assert.equal(filter, '', '第一段做的是 updatePattern("")')
  assert.equal(h.log.includes('cancel'), false, '第一次 Esc 不该取消弹层')
  assert.equal(h.dispatcher.depth(), 1, '弹层还在')
  assert.equal(h.pressEscape(), true, '第二次 Esc 由弹层收走')
  assert.equal(h.log.includes('cancel'), true)
  assert.equal(h.dispatcher.depth(), 0, '第二次才真的收起这一层')
})

test('没有速度搜索的层：一次 Esc 就收起，并且按键不再放行给页面', () => {
  const h = keyHarness()
  h.openLayer()
  assert.equal(h.pressEscape(), true)
  assert.equal(h.dispatcher.depth(), 0)
})

test('这一层此刻不许关且没在过滤 ⇒ 按键归页面（不被弹层吃掉）', () => {
  const h = keyHarness()
  h.openLayer({ canClose: false })
  assert.equal(h.pressEscape(), false, 'closeRequest 返回 false ⇒ 不 consume')
  assert.equal(h.dispatcher.depth(), 1, '不许关的层留在栈上')
  assert.equal(h.log.includes('cancel'), false)
})

test('按键已经被别人消费过就不再插手（SpeedSearch.java:58 的 e.isConsumed()）', () => {
  const h = keyHarness()
  h.openLayer()
  let consumed = false
  h.dispatcher.layers()
  // 直接喂一个 alreadyConsumed 的事件：夹具的 pressEscape 只发未消费的，这里手动发第二次那种。
  const dispatcher = createPopupDispatcher({
    addPointerListener: () => () => {},
    addKeyListener: handler => { h.inner = handler; return () => {} },
  })
  dispatcher.push({
    bounds: null, cancelOnClickOutside: true, canClose: true, measure: () => null, cancel: () => { consumed = true },
  })
  h.inner({ key: 'Escape', alreadyConsumed: true, consume: () => { consumed = true } })
  assert.equal(consumed, false, '已消费的按键不该被弹层再吃一次')
  assert.equal(h.dispatcher.depth(), 1, '栈没动')
})
