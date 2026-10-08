// 判据 · **独立编辑器窗口**（`src/editorWindows.ts` + `src/detachedEditorsHost.ts`）——
// 上游 `DockableEditorTabbedContainer` / `EditSourceInNewWindowAction` / `getOpenMode` 一族在本仓的还原。
//
// 钉四件事：
//   ① `getOpenMode` 的鼠标/键盘两档（Shift+点击 = 新窗口；带其它修饰键不算）；
//   ② 摘出/放回的迁移（源栏去掉、关掉浮层按原栏原下标放回）与几何夹取；
//   ③ 宿主能力探测（浮层容器不在 DOM / WebView2 里 `window.open` 被取消 ⇒ 这一档不画）；
//   ④ 三条真实消费链路：标签下拉的 `EditSourceInNewWindow` 行、拖拽的"拖出成独立窗口"、
//      宿主状态的摘出/放回（`detachedEditorsHost`）。
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

import {
  ACTION_OPEN_IN_NEW_WINDOW, ACTION_OPEN_IN_RIGHT_SPLIT, DETACHED_DEFAULT_SIZE, DETACHED_MIN_SIZE,
  DETACHED_OFFSET, EDIT_SOURCE_IN_NEW_WINDOW_ACTION, EDIT_SOURCE_IN_NEW_WINDOW_KEYS, EDITOR_OVERLAY_HOST_ID,
  canDetachEditor, clampDetachedGeometry, detachTab, detachedGeometry, detachedPathFromUrl,
  detachedWindowCapability, detachedWindowFeatures, detachedWindowUrl, dropDetachesTab, openModeForEvent,
  reattachTab,
} from '../src/editorWindows.ts'
import { createDetachedEditors } from '../src/detachedEditorsHost.ts'
import { createTabEntryPoint, tabEntryPointItems } from '../src/tabEntryPointMenu.ts'
import { dropDetachesTab as dropDetachesFromModule } from '../src/editorWindows.ts'

const read = rel => readFileSync(new URL(`../${rel}`, import.meta.url), 'utf8')

test('getOpenMode：Shift+点击 = 新窗口；带其它修饰键不算（上游比的是 modifiersEx 恰为 SHIFT）', () => {
  assert.equal(openModeForEvent({ type: 'click', shiftKey: true }), 'newWindow')
  assert.equal(openModeForEvent({ type: 'mousedown', shiftKey: true }), 'newWindow')
  assert.equal(openModeForEvent({ type: 'mouseup', shiftKey: true }), 'newWindow')
  assert.equal(openModeForEvent({ type: 'click', shiftKey: true, ctrlKey: true }), 'default', 'Ctrl+Shift 不是新窗口档')
  assert.equal(openModeForEvent({ type: 'click' }), 'default')
  assert.equal(openModeForEvent({ type: 'keydown', key: 'Enter' }), 'default')
  // 键盘档：按下的键位映射到的动作里有那两个 id。
  assert.equal(openModeForEvent({ type: 'keydown', actionIds: [ACTION_OPEN_IN_NEW_WINDOW] }), 'newWindow')
  assert.equal(openModeForEvent({ type: 'keydown', actionIds: [ACTION_OPEN_IN_RIGHT_SPLIT] }), 'rightSplit')
  assert.equal(openModeForEvent({ type: 'keydown', actionIds: ['EditSource'] }), 'default')
  assert.equal(openModeForEvent(null), 'default')
  assert.equal(EDIT_SOURCE_IN_NEW_WINDOW_ACTION, 'EditSourceInNewWindow')
  assert.equal(EDIT_SOURCE_IN_NEW_WINDOW_KEYS, 'Shift F4', '默认键位照 $default.xml:729-731')
})

test('摘出：源栏去掉那一条，浮层几何居中 + 错开并夹进视口', () => {
  const plan = detachTab([['a.ts', 'b.ts'], ['c.ts']], 'b.ts', 0, { width: 1600, height: 900 })
  assert.equal(plan.reason, null)
  assert.deepEqual(plan.groups, [['a.ts'], ['c.ts']], '源栏去掉 b.ts')
  assert.deepEqual(plan.detached.path, 'b.ts')
  assert.equal(plan.detached.pane, 0)
  assert.equal(plan.detached.index, 1, '记住原位下标')
  assert.equal(plan.detached.width, DETACHED_DEFAULT_SIZE.width)
  assert.ok(plan.detached.x >= 0 && plan.detached.y >= 0)
  // 多个浮层错开摆放。
  const second = detachTab([['a.ts'], []], 'a.ts', 0, { width: 1600, height: 900 }, 1)
  assert.ok(second.detached.x > plan.detached.x, '第二个浮层再错开一格')
  // 拒绝档：路径不在那一栏里 / 空路径。
  assert.ok(detachTab([['a.ts'], []], 'zz.ts', 0).reason)
  assert.ok(detachTab([['a.ts'], []], '', 0).reason)
  // 视口很小：夹到下限，不会缩成看不见。
  const tiny = detachedGeometry({ width: 200, height: 150 })
  assert.equal(tiny.width, DETACHED_MIN_SIZE.width)
  assert.equal(tiny.height, DETACHED_MIN_SIZE.height)
})

test('放回：按原栏原下标插回；原位下标超了就夹取；已在栏里就不重复插', () => {
  const detached = { path: 'b.ts', pane: 0, index: 1, x: 0, y: 0, width: 1, height: 1 }
  assert.deepEqual(reattachTab([['a.ts'], ['c.ts']], detached), [['a.ts', 'b.ts'], ['c.ts']], '插回原位')
  assert.deepEqual(reattachTab([['a.ts', 'z.ts', 'y.ts'], []], detached), [['a.ts', 'b.ts', 'z.ts', 'y.ts'], []], '按原下标 1 插回')
  assert.deepEqual(reattachTab([['a.ts', 'b.ts'], []], detached), [['a.ts', 'b.ts'], []], '已经在栏里就不重复插')
})

test('几何夹取：拖动/缩放后不让浮层跑出视口（至少留 32px 标题栏）', () => {
  const viewport = { width: 1200, height: 800 }
  assert.deepEqual(clampDetachedGeometry({ x: -500, y: -100, width: 400, height: 300 }, viewport),
    { x: 32 - 400, y: 0, width: 400, height: 300 }, '左上越界夹回（宽度全出去时留 32px 标题栏）')
  assert.deepEqual(clampDetachedGeometry({ x: 5000, y: 5000, width: 400, height: 300 }, viewport),
    { x: 1200 - 32, y: 800 - 32, width: 400, height: 300 }, '右下越界夹回')
  assert.equal(clampDetachedGeometry({ x: 0, y: 0, width: 10, height: 10 }, viewport).width, DETACHED_MIN_SIZE.width, '缩到下限')
  // 没有视口（无 DOM）：只夹尺寸，不动位置。
  assert.deepEqual(clampDetachedGeometry({ x: -5, y: -5, width: 10, height: 10 }, null),
    { x: -5, y: -5, width: DETACHED_MIN_SIZE.width, height: DETACHED_MIN_SIZE.height })
})

test('宿主能力：浮层容器在不在 DOM、浏览器档能不能开（WebView2 里 window.open 被取消）', () => {
  const docWith = { getElementById: id => (id === EDITOR_OVERLAY_HOST_ID ? {} : null) }
  const docWithout = { getElementById: () => null }
  const openFn = { open: () => ({}) }
  assert.deepEqual(detachedWindowCapability({ doc: docWith, isDesktop: true, win: openFn }),
    { overlayHostPresent: true, browserWindowSupported: false }, '桌面端不算浏览器档')
  assert.deepEqual(detachedWindowCapability({ doc: docWithout, isDesktop: false, win: openFn }),
    { overlayHostPresent: false, browserWindowSupported: true })
  assert.deepEqual(detachedWindowCapability({ doc: docWithout, isDesktop: false, win: null }),
    { overlayHostPresent: false, browserWindowSupported: false }, '没有 window.open 就不算')
  assert.equal(canDetachEditor({ overlayHostPresent: true, browserWindowSupported: false }), true)
  assert.equal(canDetachEditor({ overlayHostPresent: false, browserWindowSupported: true }), true)
  assert.equal(canDetachEditor({ overlayHostPresent: false, browserWindowSupported: false }), false, '两个都没有 ⇒ 这一档不画')
})

test('浏览器档：URL 带 ?detached=<路径>、features 带尺寸位置；从 search 读回来', () => {
  const url = detachedWindowUrl('https://taocode.local/index.html', 'src/a b.ts')
  assert.match(url, /\?detached=src%2Fa%20b\.ts$/)
  const withQuery = detachedWindowUrl('https://x/index.html?v=1', 'a.ts')
  assert.match(withQuery, /&detached=a\.ts$/, '已有 query 时用 &')
  assert.equal(detachedPathFromUrl('?detached=src%2Fa.ts'), 'src/a.ts')
  assert.equal(detachedPathFromUrl('?v=1&detached=a.ts'), 'a.ts')
  assert.equal(detachedPathFromUrl(''), null)
  assert.equal(detachedPathFromUrl('?other=1'), null)
  const features = detachedWindowFeatures({ x: 10, y: 20, width: 800, height: 600 })
  assert.match(features, /width=800/)
  assert.match(features, /height=600/)
  assert.match(features, /left=10/)
  assert.match(features, /top=20/)
})

test('拖拽档：落点在编辑区矩形之外才摘出，矩形内仍走分屏（不抢同一落点）', () => {
  const bounds = { x: 100, y: 100, width: 800, height: 600 }
  assert.equal(dropDetachesTab({ x: 50, y: 300 }, bounds), true, '左侧外面')
  assert.equal(dropDetachesTab({ x: 300, y: 40 }, bounds), true, '上方外面')
  assert.equal(dropDetachesTab({ x: 950, y: 300 }, bounds), true, '右侧外面')
  assert.equal(dropDetachesTab({ x: 300, y: 750 }, bounds), true, '下方外面')
  assert.equal(dropDetachesTab({ x: 300, y: 300 }, bounds), false, '矩形内不摘')
  assert.equal(dropDetachesTab({ x: 95, y: 300 }, bounds, 10), false, 'margin 内算矩形里')
  assert.equal(dropDetachesFromModule({ x: 90, y: 300 }, bounds, 10), false, 'margin 参数生效')
})

test('宿主状态：摘出/放回真改栏表，重复摘同一个是 no-op，关掉后放回原位', () => {
  const groups = {
    0: { tabs: [{ path: 'a.ts' }, { path: 'b.ts' }], activePath: 'b.ts' },
    1: { tabs: [{ path: 'c.ts' }], activePath: 'c.ts' },
  }
  const notes = []
  const host = createDetachedEditors({
    groups, isDesktop: true, notify: message => notes.push(message),
    win: () => null, viewport: () => ({ width: 1600, height: 900 }),
  })
  // 桌面端 + 无浮层容器 ⇒ 这一档不可用（宿主能力探测；App.vue 还没挂容器）。
  assert.equal(host.available(), false)
  // 摘出仍然改栏表（浮层渲染面由 UI lane 挂，状态这一半是真的）。
  assert.equal(host.detach(0, 'b.ts'), true)
  assert.deepEqual(groups[0].tabs.map(tab => tab.path), ['a.ts'], '源栏去掉')
  assert.equal(groups[0].activePath, 'a.ts', '活动标签回退')
  assert.deepEqual(host.detached.value.map(item => item.path), ['b.ts'])
  assert.equal(host.detach(0, 'b.ts'), false, '重复摘同一个是 no-op')
  assert.equal(host.detach(0, 'zz.ts'), false, '不在栏里的路径摘不出')
  assert.ok(notes.length >= 1, '摘不出时如实提示')
  // 拖动夹取。
  host.move('b.ts', { x: -999, y: -999, width: 400, height: 300 })
  assert.ok(host.detached.value[0].x <= 0, '夹到视口内（左侧留 32px 标题栏）')
  // 关掉：放回原栏原下标。
  assert.equal(host.close('b.ts'), true)
  assert.deepEqual(groups[0].tabs.map(tab => tab.path), ['a.ts', 'b.ts'], '放回原位下标 1')
  assert.equal(groups[0].activePath, 'b.ts', '放回后成为活动标签')
  assert.deepEqual(host.detached.value, [])
  assert.equal(host.close('b.ts'), false, '已经关掉了')
})

test('消费者一：标签下拉有 EditSourceInNewWindow 行，能力不足时整行不画', () => {
  const items = tabEntryPointItems({
    closedCount: 0, tabCount: 1, hasUnpinned: false, split: false, canDetach: true,
    reopenClosedTab: () => {}, closeAllTabs: () => {}, closeUnpinnedTabs: () => {},
    unsplit: () => {}, unsplitAll: () => {}, changeSplitOrientation: () => {}, openTabSettings: () => {},
    openInNewWindow: () => {},
  })
  assert.ok(items.some(item => item.id === 'EditSourceInNewWindow'))
  const noCap = tabEntryPointItems({
    closedCount: 0, tabCount: 1, hasUnpinned: false, split: false, canDetach: false,
    reopenClosedTab: () => {}, closeAllTabs: () => {}, closeUnpinnedTabs: () => {},
    unsplit: () => {}, unsplitAll: () => {}, changeSplitOrientation: () => {}, openTabSettings: () => {},
    openInNewWindow: () => {},
  })
  assert.equal(noCap.find(item => item.id === 'EditSourceInNewWindow').enabled, false, '能力不足 ⇒ 不可用 ⇒ 不出现')
  // 工厂那条路：`canDetach`/`detachActive` 注入后按活动标签判。
  const factory = createTabEntryPoint({
    groups: { 0: { tabs: [{ path: 'a.ts' }], activePath: 'a.ts' }, 1: { tabs: [], activePath: '' } },
    closedTabsPerPane: [[], []], split: () => 'none',
    reopenClosedTab: () => {}, closeAllTabsIn: () => {}, closeUnpinnedTabsIn: () => {},
    unsplit: () => {}, unsplitAll: () => {}, changeSplitOrientation: () => {}, openSettings: () => {},
    canDetach: () => true, detachActive: () => {},
  })
  assert.equal(factory(0).find(item => item.id === 'EditSourceInNewWindow').enabled, true, '有活动标签 ⇒ 可用')
  assert.equal(factory(1).find(item => item.id === 'EditSourceInNewWindow').enabled, false, '空栏 ⇒ 不可用')
  const noInjection = createTabEntryPoint({
    groups: { 0: { tabs: [{ path: 'a.ts' }], activePath: 'a.ts' }, 1: { tabs: [], activePath: '' } },
    closedTabsPerPane: [[], []], split: () => 'none',
    reopenClosedTab: () => {}, closeAllTabsIn: () => {}, closeUnpinnedTabsIn: () => {},
    unsplit: () => {}, unsplitAll: () => {}, changeSplitOrientation: () => {}, openSettings: () => {},
  })
  assert.equal(noInjection(0).find(item => item.id === 'EditSourceInNewWindow').enabled, false, '没注入就不画')
})

test('消费者二/三：tabDragDrop 接了拖出档、detachedEditorsHost 真 import 规则模块', () => {
  const drag = read('src/tabDragDrop.ts')
  assert.match(drag, /from '\.\/editorWindows\.ts'/)
  assert.match(drag, /dropDetachesTab/)
  assert.match(drag, /detachTabOut/)
  const host = read('src/detachedEditorsHost.ts')
  assert.match(host, /from '\.\/editorWindows\.ts'/)
  assert.match(host, /detachTab/)
  assert.match(host, /reattachTab/)
  assert.match(host, /clampDetachedGeometry/)
})