// 「视图模式」这一族（`TW.ViewModeGroup`）的判据。
//
// 上游坐标（参考树 intellij-community-master）：
//   · `platform/ide-core/src/com/intellij/openapi/wm/ToolWindowType.java:4-6` —— 四值；
//   · `platform/platform-impl/src/com/intellij/ide/actions/ToolWindowViewModeAction.java:31-77` ——
//     五档模式与 (type, autoHide) 的正反读；`:138-141` 可用性；`:158-181` 组；
//   · `platform/platform-impl/src/com/intellij/openapi/wm/impl/ToolWindowManagerLifecycle.kt:108-138`
//     —— autoHide 到底什么时候收窗口；
//   · `platform/platform-impl/src/com/intellij/openapi/wm/impl/WindowInfoImpl.kt:35/46-47/74`
//     —— 默认值（DOCKED / autoHide=false / weight 0.33）。
import test from 'node:test'
import assert from 'node:assert/strict'
import {
  VIEW_MODES, VIEW_MODE_ACTION_IDS, VIEW_MODE_GROUP_TITLE, VIEW_MODE_LABELS,
  TOOL_WINDOW_OVERLAY_HOST_ID, applyViewMode, autoHidesWhenUnfocused, clampFloatingBounds,
  defaultFloatingBounds, floatingBoundsAfterDrag, floatingBoundsStored, isModeApplied, isViewModeRenderable,
  opensAsOverlay, shouldHideOnFocusLoss, viewModeCapabilityFromDom, viewModeOf, viewModeRows,
} from '../src/toolWindowViewMode.ts'

const VIEWPORT = { x: 0, y: 0, width: 1280, height: 800 }

test('五档模式的声明顺序与动作 id 照抄 ViewMode 枚举', () => {
  assert.deepEqual(VIEW_MODES, ['dockPinned', 'dockUnpinned', 'undock', 'float', 'window'])
  assert.deepEqual(VIEW_MODE_ACTION_IDS, {
    dockPinned: 'DockPinnedMode', dockUnpinned: 'DockUnpinnedMode', undock: 'UndockMode',
    float: 'FloatMode', window: 'WindowMode',
  })
})

test('文案取随 IDE 发货的中文包（ActionsBundle.properties 的那五条 text/description）', () => {
  assert.equal(VIEW_MODE_LABELS.dockPinned.title, '停靠固定')
  assert.equal(VIEW_MODE_LABELS.dockPinned.description, '使工具窗口停靠并固定')
  assert.equal(VIEW_MODE_LABELS.dockUnpinned.title, '停靠不固定')
  assert.equal(VIEW_MODE_LABELS.undock.title, '取消停靠')
  assert.equal(VIEW_MODE_LABELS.float.title, '浮动')
  assert.equal(VIEW_MODE_LABELS.window.title, '窗口')
  assert.equal(VIEW_MODE_GROUP_TITLE, '视图模式')
})

test('isApplied：每档只看 (type, autoHide)，DockPinned 与 DockUnpinned 差在 autoHide', () => {
  // ToolWindowViewModeAction.java:48-57 的五行逐条对上。
  assert.equal(isModeApplied('dockPinned', { type: 'docked', autoHide: false }), true)
  assert.equal(isModeApplied('dockPinned', { type: 'docked', autoHide: true }), false)
  assert.equal(isModeApplied('dockUnpinned', { type: 'docked', autoHide: true }), true)
  assert.equal(isModeApplied('undock', { type: 'sliding', autoHide: false }), true, 'Undock 只看类型（:53）')
  assert.equal(isModeApplied('undock', { type: 'sliding', autoHide: true }), true)
  assert.equal(isModeApplied('undock', { type: 'docked', autoHide: true }), false)
  assert.equal(isModeApplied('float', { type: 'floating', autoHide: true }), true)
  assert.equal(isModeApplied('window', { type: 'windowed', autoHide: false }), true)
})

test('fromWindowInfo ⇄ applyTo 往返：五档都能原读回', () => {
  for (const mode of VIEW_MODES) {
    const state = applyViewMode(mode)
    assert.equal(viewModeOf(state), mode, `${mode} 写下去再读回应是同一档`)
    assert.equal(isModeApplied(mode, state), true)
  }
  // :75 —— Undock 会自己把 autoHide 打开（isApplied 却不看它，所以这两条必须同时成立）。
  assert.deepEqual(applyViewMode('undock'), { type: 'sliding', autoHide: true })
  assert.deepEqual(applyViewMode('dockPinned'), { type: 'docked', autoHide: false })
  assert.deepEqual(applyViewMode('float'), { type: 'floating', autoHide: false })
  assert.deepEqual(applyViewMode('window'), { type: 'windowed', autoHide: false })
})

test('auto-hide 的窗口集合 = autoHide 为真 或 类型是 SLIDING（Lifecycle.kt:116）', () => {
  assert.equal(autoHidesWhenUnfocused({ type: 'docked', autoHide: true }), true)
  assert.equal(autoHidesWhenUnfocused({ type: 'docked', autoHide: false }), false)
  assert.equal(autoHidesWhenUnfocused({ type: 'sliding', autoHide: false }), true, '滑动窗口即使 autoHide 没置也收')
  assert.equal(autoHidesWhenUnfocused({ type: 'floating', autoHide: false }), false, '浮动不是自动隐藏形态')
})

test('shouldHideOnFocusLoss：六条例卫逐一生效（Lifecycle.kt:108-138 的顺序）', () => {
  const base = {
    visible: true, state: { type: 'docked', autoHide: true },
    focusedWindowId: 'editor-nothing', windowId: 'files',
  }
  assert.equal(shouldHideOnFocusLoss(base), true, '焦点真进了别处 ⇒ 收')
  assert.equal(shouldHideOnFocusLoss({ ...base, visible: false }), false, '窗口本来就没开 ⇒ 什么都不做（:112）')
  assert.equal(shouldHideOnFocusLoss({ ...base, state: { type: 'docked', autoHide: false } }), false, '固定停靠不收（:116）')
  assert.equal(shouldHideOnFocusLoss({ ...base, aboutToReceiveFocus: true }), false, '即将拿焦点 ⇒ 别抢（:124）')
  assert.equal(shouldHideOnFocusLoss({ ...base, focusedWindowId: 'files' }), false, '焦点还在同一个窗口里（:130）')
  assert.equal(shouldHideOnFocusLoss({ ...base, focusGoesToPopup: true }), false, '焦点进了弹层（:131）')
  assert.equal(shouldHideOnFocusLoss({ ...base, focusGoesToDialog: true }), false, '焦点进了对话框（:132）')
})

test('视图模式的行：没有工具窗口就没有这一组（ViewModeAction.java:138-141）', () => {
  const rows = viewModeRows({ state: () => null, capability: { overlayHostPresent: false, separateFrameSupported: false }, apply: () => {} })
  assert.deepEqual(rows, [])
})

test('能力探测：没有浮层宿主容器时「浮动」「窗口」整行不给，接上后自动出现', () => {
  const capability = { overlayHostPresent: false, separateFrameSupported: false }
  assert.equal(isViewModeRenderable('dockPinned', capability), true)
  assert.equal(isViewModeRenderable('undock', capability), true)
  assert.equal(isViewModeRenderable('float', capability), false)
  assert.equal(isViewModeRenderable('window', capability), false)
  assert.equal(isViewModeRenderable('float', { ...capability, overlayHostPresent: true }), true)
  // DOM 侧：读不到那个 id 就是没有。
  assert.equal(viewModeCapabilityFromDom(null).overlayHostPresent, false)
  assert.equal(viewModeCapabilityFromDom({ getElementById: id => (id === TOOL_WINDOW_OVERLAY_HOST_ID ? {} : null) }).overlayHostPresent, true)
  assert.equal(viewModeCapabilityFromDom({ getElementById: () => null }).separateFrameSupported, false,
    '第二个原生窗口：宿主没有该请求面 ⇒ 任何情况下都不给「窗口」这一行')
})

test('行的次序 = ViewMode.values() 的声明次序；radio 语义 + 已生效那档不再写一遍', () => {
  const applied = []
  const rows = viewModeRows({
    state: () => ({ type: 'docked', autoHide: true }),
    capability: { overlayHostPresent: false, separateFrameSupported: false },
    apply: mode => applied.push(mode),
  })
  assert.deepEqual(rows.map(row => row.id), ['window.viewMode.DockPinnedMode', 'window.viewMode.DockUnpinnedMode', 'window.viewMode.UndockMode'])
  assert.deepEqual(rows.map(row => row.checked?.()), [false, true, false])
  rows[1]?.run?.()
  assert.deepEqual(applied, [], `setSelected 的 isApplied 闸（:132-134）：已经是这一档就什么都不做`)
  rows[0]?.run?.()
  assert.deepEqual(applied, ['dockPinned'])
})

test('浮层几何：默认按 0.33 起、拖动与缩放都夹在视口内、全 0 矩形等于没存过', () => {
  const first = defaultFloatingBounds(VIEWPORT)
  assert.equal(first.width, Math.round(1280 * 0.33))
  assert.equal(first.height, Math.round(800 * 0.33))
  const dragged = floatingBoundsAfterDrag(first, VIEWPORT, 10_000, -10_000)
  assert.equal(dragged.x + dragged.width <= VIEWPORT.width, true, '右缘不许出视口')
  assert.equal(dragged.y, 0, '顶到上沿就停')
  const tiny = clampFloatingBounds({ x: -50, y: -50, width: 10, height: 10 }, VIEWPORT)
  assert.equal(tiny.width >= 240 && tiny.height >= 160, true, '有最小尺寸')
  assert.equal(tiny.x >= 0 && tiny.y >= 0, true, '负坐标夹回视口')
  assert.equal(floatingBoundsStored({ x: 0, y: 0, width: 0, height: 0 }), false, '全 0 = 未定义（WindowInfoImpl.kt:53）')
  assert.equal(floatingBoundsStored(null), false)
  assert.equal(floatingBoundsStored({ x: 4, y: 4, width: 300, height: 200 }), true)
})

test('浮动/窗口这两档才是"开成浮层"，停靠与滑动都不是', () => {
  assert.equal(opensAsOverlay({ type: 'floating', autoHide: false }), true)
  assert.equal(opensAsOverlay({ type: 'windowed', autoHide: false }), true)
  assert.equal(opensAsOverlay({ type: 'sliding', autoHide: true }), false)
  assert.equal(opensAsOverlay({ type: 'docked', autoHide: false }), false)
})
