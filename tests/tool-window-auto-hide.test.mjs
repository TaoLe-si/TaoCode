// 视图模式的**状态与持久化 + 自动隐藏**这一半（另一半在 tests/tool-window-view-mode.test.mjs）。
//
// 上游坐标（参考树 intellij-community-master）：
//   · 每窗口状态：`platform/platform-impl/src/com/intellij/openapi/wm/impl/WindowInfoImpl.kt:46-47`
//     （`auto_hide`，默认 false）、`:74`（`type`，默认 DOCKED）—— 两者都存在项目的那条
//     `<window_info>` 上（`ToolWindowManagerState.kt`）；
//   · 写入路径：`ToolWindowManagerImpl.kt:1742-1757`（setToolWindowAutoHide：**同值直接 return**）
//     与 `:1759-1769`（setToolWindowType：与出厂类型相同也直接 return）；
//   · 自动隐藏的触发链：`ToolWindowManagerLifecycle.kt:55-138`（焦点真的离开该 dock 才收，
//     焦点进弹层/对话框不收，焦点还在同一个窗口里不收）。
import test from 'node:test'
import assert from 'node:assert/strict'
import { ref } from 'vue'
import { createToolWindowStripes } from '../src/toolWindowStripes.ts'
import { popupDispatcher } from '../src/popupStack.ts'

const LAYOUT_KEY = root => `taocode.toolLayout:${root}`

function storage(t) {
  const values = new Map()
  const previous = Object.getOwnPropertyDescriptor(globalThis, 'localStorage')
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: {
    getItem: key => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, String(value)),
    removeItem: key => values.delete(key),
  } })
  // 装一个最小 `document`：弹层栈的 popupHasFocusWithin 与 stripes 的 focusin 监听都要它。
  const previousDocument = Object.getOwnPropertyDescriptor(globalThis, 'document')
  Object.defineProperty(globalThis, 'document', { configurable: true, value: {
    addEventListener() {}, removeEventListener() {}, getElementById: () => null,
  } })
  t.after(() => {
    if (previous) Object.defineProperty(globalThis, 'localStorage', previous)
    else delete globalThis.localStorage
    if (previousDocument) Object.defineProperty(globalThis, 'document', previousDocument)
    else delete globalThis.document
  })
  return values
}
function host(root = 'project') {
  const deps = {
    isDesktop: true, workspace: ref({ root }), lspReady: ref(true),
    gradleAvailable: ref(true), explorer: ref(false), activeView: ref('files'),
    bottom: ref(false), bottomTab: ref(''),
  }
  return { ...createToolWindowStripes(deps), deps }
}
/** 一个"在某个 dock 里"的假元素：只回答 closest()，够 dockOf 用。 */
function inDock(dockClass) {
  return { closest: selector => (selector === dockClass ? {} : null) }
}
const EDITOR = inDock('.editor-stage')
const SIDE = inDock('.explorer-panel')
const BOTTOM = inDock('.output-panel')

test('选一档视图模式 = 往那条 <window_info> 里写 type/auto_hide，且只写与默认不同的', t => {
  const values = storage(t)
  const h = host()
  assert.equal(h.setViewMode('files', 'dockUnpinned'), true)
  const saved = () => JSON.parse(values.get(LAYOUT_KEY('project')) ?? '{"windows":{}}').windows.files ?? {}
  assert.equal(saved().autoHide, true)
  assert.equal('type' in saved(), false, 'DOCKED 是默认值 ⇒ 不落盘（WindowInfoImpl 的 skip-if-default）')
  assert.equal(h.setViewMode('files', 'dockPinned'), true)
  assert.equal('autoHide' in saved(), false, '改回出厂档 ⇒ 这两栏又消失（不留下"和默认一样"的噪音）')
  assert.equal('type' in saved(), false)
  assert.equal(h.setViewMode('files', 'undock'), true)
  assert.deepEqual([saved().type, saved().autoHide], ['sliding', true], 'Undock 会自己把 autoHide 打开（ViewModeAction.java:75）')
})

test('同值再设一次不动盘、不重开面板（setToolWindowAutoHide/Type 的 :1746/:1763 那两条闸）', t => {
  storage(t)
  const h = host()
  assert.equal(h.setViewMode('files', 'float'), true)
  const snapshot = JSON.stringify(h.windowTypeState('files'))
  assert.equal(h.setViewMode('files', 'float'), false, '已经是这一档 ⇒ 返回 false')
  assert.equal(JSON.stringify(h.windowTypeState('files')), snapshot)
})

test('视图模式跟着项目走：A 项目浮动、B 项目照旧停靠，切回来还是浮动', t => {
  storage(t)
  const a = host('alpha')
  a.setViewMode('files', 'undock')
  const b = host('beta')
  assert.deepEqual(b.windowTypeState('files'), { type: 'docked', autoHide: false })
  const back = host('alpha')
  assert.deepEqual(back.windowTypeState('files'), { type: 'sliding', autoHide: true })
  assert.equal(back.viewModeOfId('files'), 'undock')
})

test('自动隐藏：焦点真离开那一侧 dock 才收，收的是**这一侧**的窗口', t => {
  storage(t)
  const h = host()
  h.setViewMode('files', 'dockUnpinned')
  h.deps.explorer.value = true
  h.deps.activeView.value = 'files'
  h.saveVisibility()
  h.hideAutoHideWindowsOnFocusChange(SIDE)
  assert.equal(h.deps.explorer.value, true, '焦点还在侧栏里 ⇒ 不收（Lifecycle.kt:129-130）')
  h.hideAutoHideWindowsOnFocusChange(EDITOR)
  assert.equal(h.deps.explorer.value, false, '焦点进了编辑器 ⇒ 收')
})

test('自动隐藏只管开了 autoHide 的那个窗口：固定停靠的窗口不受别人牵连', t => {
  storage(t)
  const h = host()
  h.deps.explorer.value = true
  h.deps.activeView.value = 'files'
  h.saveVisibility()
  h.hideAutoHideWindowsOnFocusChange(EDITOR)
  assert.equal(h.deps.explorer.value, true, 'files 还是默认的 DockPinned ⇒ 什么都不做（:116）')
  h.setViewMode('outline', 'undock')
  h.deps.activeView.value = 'outline'
  h.saveVisibility()
  h.hideAutoHideWindowsOnFocusChange(EDITOR)
  assert.equal(h.deps.explorer.value, false, '换成 sliding 的那一个就该收')
})

test('底部那一格的自动隐藏收的是底部 dock，不会去收侧栏（跨 dock 的同族错位）', t => {
  storage(t)
  const h = host()
  h.deps.explorer.value = true
  h.deps.activeView.value = 'files'
  h.setViewMode('todo', 'dockUnpinned')          // todo 默认停靠在底部
  h.deps.bottom.value = true
  h.deps.bottomTab.value = 'todo'
  h.saveVisibility()
  h.hideAutoHideWindowsOnFocusChange(EDITOR)
  assert.equal(h.deps.bottom.value, false, '底部的 todo 收了')
  assert.equal(h.deps.explorer.value, true, '侧栏的 files（固定停靠）一点没动')
})

test('焦点进了弹层就不收（上游 getParentBalloonFor，本仓由弹层栈回答）', t => {
  storage(t)
  const h = host()
  h.setViewMode('files', 'dockUnpinned')
  h.deps.explorer.value = true
  h.deps.activeView.value = 'files'
  h.saveVisibility()
  const stack = popupDispatcher()
  // 夹具要同时回答两件事：`dockOf` 用 `closest`（这块假节点不在任何 dock 里 ⇒ 编辑器），
  // `popupHasFocusWithin` 用 `contains`（上游 `getParentBalloonFor` 的"焦点是这个层内容树的后代"）。
  const menuNode = { contains: node => node === menuNode, closest: () => null }
  const id = stack.push({
    bounds: { x: 0, y: 0, width: 10, height: 10 },
    cancelOnClickOutside: true, canClose: true,
    node: () => menuNode, cancel: () => {},
  })
  h.hideAutoHideWindowsOnFocusChange(menuNode)
  assert.equal(h.deps.explorer.value, true, '焦点在弹层里 ⇒ 不收面板')
  stack.remove(id)
  h.hideAutoHideWindowsOnFocusChange(menuNode)
  assert.equal(h.deps.explorer.value, false, '弹层关掉后同一件事就该收了')
})

test('浮层矩形也落在同一条记录里，换项目后各读各的', t => {
  const values = storage(t)
  const h = host()
  h.setFloatingBounds('files', { x: 40, y: 60, width: 500, height: 320 })
  const saved = JSON.parse(values.get(LAYOUT_KEY('project'))).windows.files
  assert.deepEqual(saved.floatingBounds, { x: 40, y: 60, width: 500, height: 320 })
  assert.equal(JSON.stringify(h.floatingBoundsOfId('files')), JSON.stringify({ x: 40, y: 60, width: 500, height: 320 }))
  assert.equal(host('other').floatingBoundsOfId('files'), null, '别的项目没有这一栏')
})

test('坏存档不猜：认不出的 type 与全 0 的浮层矩形都回到默认', t => {
  const values = storage(t)
  values.set(LAYOUT_KEY('project'), JSON.stringify({ windows: {
    files: { type: 'sideways', autoHide: 'yes', floatingBounds: { x: 0, y: 0, width: 0, height: 0 } },
    git: { floatingBounds: { x: 1, y: 2, width: 3 } },
  } }))
  const h = host()
  assert.deepEqual(h.windowTypeState('files'), { type: 'docked', autoHide: false })
  assert.equal(h.floatingBoundsOfId('files'), null, '全 0 = 未定义（WindowInfoImpl.kt:53）')
  assert.equal(h.floatingBoundsOfId('git'), null, '少一个数就整栏作废，不拿 undefined 当坐标')
})

test('旧存档（没有这两栏）读出来仍是"停靠固定"，不会被判成损坏', t => {
  const values = storage(t)
  values.set(LAYOUT_KEY('project'), JSON.stringify({ windows: {
    files: { anchor: 'left', order: 0, showStripeButton: true, visible: true },
  } }))
  const h = host()
  assert.deepEqual(h.windowTypeState('files'), { type: 'docked', autoHide: false })
  assert.equal(h.viewModeOfId('files'), 'dockPinned')
  assert.equal(h.stripeOrder.value('left').includes('files'), true)
})
