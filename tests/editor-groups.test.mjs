import { strict as assert } from 'node:assert'
import test from 'node:test'
// The module is TypeScript; strip types the way node 24 does for .ts imports.
const { createSplitModel, splitTabOutIn, unsplitModel, unsplitAllModel, closeTabInPane, dropTabOnGroup, otherPane, tabClosingOrder,
        swapGroups, paneOfGroup, jumpTargetPane } =
  await import('../src/editorGroups.ts')

const pathOf = tab => tab.path

function modelWith(...paths) {
  const model = createSplitModel()
  model.groups[0].tabs = paths.map(path => ({ path }))
  model.groups[0].activePath = paths[paths.length - 1]
  return model
}

test('otherPane alternates', () => {
  assert.equal(otherPane(0), 1)
  assert.equal(otherPane(1), 0)
})

test('split right moves the selected tab out and focuses the new group', () => {
  const model = modelWith('a.txt', 'b.txt')
  splitTabOutIn(model, pathOf, model.groups[0].tabs[1], 'horizontal')
  assert.equal(model.orientation, 'horizontal')
  assert.equal(model.focused, 1)
  assert.deepEqual(model.groups[0].tabs.map(pathOf), ['a.txt'])
  // IDEA's Split keeps the whole clone reachable in the new group.
  assert.deepEqual(model.groups[1].tabs.map(pathOf), ['a.txt', 'b.txt'])
  assert.equal(model.groups[1].activePath, 'b.txt')
  assert.equal(model.groups[0].activePath, 'a.txt')
})

test('splitting a single file shows it in both panes (split same)', () => {
  const model = modelWith('only.txt')
  splitTabOutIn(model, pathOf, model.groups[0].tabs[0], 'vertical')
  assert.equal(model.orientation, 'vertical')
  assert.deepEqual(model.groups[0].tabs.map(pathOf), ['only.txt'])
  assert.deepEqual(model.groups[1].tabs.map(pathOf), ['only.txt'])
})

test('unsplit merges the second group back without duplicating shared tabs', () => {
  const model = modelWith('a.txt', 'b.txt')
  splitTabOutIn(model, pathOf, model.groups[0].tabs[1], 'horizontal')
  // Open another file in the primary pane after the split.
  model.groups[0].tabs.push({ path: 'c.txt' })
  unsplitModel(model)
  assert.equal(model.orientation, 'none')
  assert.equal(model.focused, 0)
  assert.deepEqual(model.groups[0].tabs.map(pathOf), ['a.txt', 'c.txt', 'b.txt'])
  assert.deepEqual(model.groups[1].tabs, [])
})

test('changing orientation while split re-splits from the focused group', () => {
  const model = modelWith('a.txt', 'b.txt', 'c.txt')
  splitTabOutIn(model, pathOf, model.groups[0].tabs[2], 'horizontal')
  splitTabOutIn(model, pathOf, model.groups[1].tabs.find(tab => tab.path === 'b.txt'), 'vertical')
  assert.equal(model.orientation, 'vertical')
  // b.txt moves to the focused group and stays reachable in the clone; a.txt returns
  // to the primary group when the first split was undone.
  assert.ok(model.groups[1].tabs.some(tab => tab.path === 'b.txt'))
  assert.equal(model.groups[1].activePath, 'b.txt')
  assert.ok(!model.groups[0].tabs.some(tab => tab.path === 'b.txt'), 'the moved tab leaves the source group')
  assert.ok(model.groups[0].tabs.some(tab => tab.path === 'a.txt'), 'the other files stay reachable')
})

test('closeTabIn keeps the buffer alive while the other pane still shows it', () => {
  const model = modelWith('only.txt')
  splitTabOutIn(model, pathOf, model.groups[0].tabs[0], 'horizontal')
  const tab = model.groups[0].tabs[0]
  assert.equal(closeTabInPane(model, pathOf, 0, tab), false, 'still visible in pane 1')
  assert.equal(model.groups[1].activePath, 'only.txt')
  assert.equal(closeTabInPane(model, pathOf, 1, tab), true, 'gone from both panes')
})

test('closing the active tab selects its neighbour in the same group only', () => {
  const model = modelWith('a.txt', 'b.txt')
  splitTabOutIn(model, pathOf, model.groups[0].tabs[1], 'horizontal')
  model.groups[0].activePath = 'a.txt'
  closeTabInPane(model, pathOf, 0, model.groups[0].tabs.find(tab => tab.path === 'a.txt'))
  assert.equal(model.groups[0].activePath, '')
  assert.equal(model.groups[1].activePath, 'b.txt', 'the other pane never loses its selection')
})

test('splitTabOut ignores tabs that are not in the focused group', () => {
  const model = modelWith('a.txt')
  const foreign = { path: 'ghost.txt' }
  splitTabOutIn(model, pathOf, foreign, 'horizontal')
  assert.equal(model.orientation, 'none')
})

test('unsplitAll drops the second group even with unique tabs', () => {
  const model = modelWith('a.txt', 'b.txt')
  splitTabOutIn(model, pathOf, model.groups[0].tabs[1], 'horizontal')
  model.groups[1].tabs.push({ path: 'extra.txt' })
  unsplitAllModel(model)
  assert.deepEqual(model.groups[1].tabs, [])
  assert.equal(model.focused, 0)
})

const dirtyOf = tab => tab.dirty === true

test('closing order prefers untouched tabs, then clean history least-recent first', () => {
  const a = { path: 'a' }, b = { path: 'b', dirty: true }, c = { path: 'c' }, d = { path: 'd' }
  // History most-recent-first: d was selected last after c; b is dirty and must stay.
  const order = tabClosingOrder([a, b, c, d], 'd', ['d', 'c', 'a'], pathOf, dirtyOf)
  assert.deepEqual(order.map(pathOf), ['a', 'c'])
})

test('the just-opened tab and modified tabs are never in the closing order', () => {
  const a = { path: 'a', dirty: true }, b = { path: 'b' }
  const order = tabClosingOrder([a, b], 'b', ['b'], pathOf, dirtyOf)
  assert.deepEqual(order.map(pathOf), [])
})

test('tabs outside the history close before least-recent history entries', () => {
  const fresh = { path: 'fresh' }, old1 = { path: 'old1' }, old2 = { path: 'old2' }, active = { path: 'act' }
  const order = tabClosingOrder([old2, old1, fresh, active], 'act', ['old1', 'old2'], pathOf, dirtyOf)
  assert.deepEqual(order.map(pathOf), ['fresh', 'old2', 'old1'])
})

// --- dropTabOnGroup: IDEA's tab drag & drop transitions ---

test('dropping a tab before another tab in the same group reorders it', () => {
  const model = modelWith('a', 'b', 'c')
  const tab = model.groups[0].tabs.find(item => item.path === 'c')
  dropTabOnGroup(model, pathOf, 0, tab, 0, 'a')
  assert.deepEqual(model.groups[0].tabs.map(item => item.path), ['c', 'a', 'b'])
  assert.equal(model.groups[0].activePath, 'c')
})

test('dropping onto the strip end appends and selects', () => {
  const model = modelWith('a', 'b', 'c')
  const tab = model.groups[0].tabs.find(item => item.path === 'a')
  dropTabOnGroup(model, pathOf, 0, tab, 0)
  assert.deepEqual(model.groups[0].tabs.map(item => item.path), ['b', 'c', 'a'])
  assert.equal(model.groups[0].activePath, 'a')
})

test('dropping a tab onto the other group while split moves and selects it', () => {
  const model = modelWith('a', 'b')
  splitTabOutIn(model, pathOf, model.groups[0].tabs[0], 'horizontal')
  const moved = model.groups[0].tabs[0]
  const from = model.groups[0].tabs.includes(moved) ? 0 : 1
  const to = otherPane(from)
  const before = model.groups[from].tabs.length
  dropTabOnGroup(model, pathOf, from, moved, to)
  assert.ok(!model.groups[from].tabs.includes(moved), 'the tab left the source group')
  assert.ok(model.groups[to].tabs.includes(moved), 'the tab arrived in the target group')
  assert.equal(model.groups[to].activePath, moved.path)
  assert.equal(model.focused, to)
  assert.equal(model.groups[from].tabs.length, before - 1)
})

test('a cross-group drop without a split splits first (IDEA drag-to-split)', () => {
  const model = modelWith('a', 'b')
  const tab = model.groups[0].tabs.find(item => item.path === 'b')
  dropTabOnGroup(model, pathOf, 0, tab, 1)
  assert.equal(model.orientation, 'horizontal')
  assert.equal(model.groups[1].activePath, 'b')
})

test('dropping onto itself leaves the order unchanged', () => {
  const model = modelWith('a', 'b', 'c')
  const tab = model.groups[0].tabs.find(item => item.path === 'b')
  dropTabOnGroup(model, pathOf, 0, tab, 0, 'b')
  assert.deepEqual(model.groups[0].tabs.map(item => item.path), ['a', 'b', 'c'])
})

// —— 一次跳转落在哪一栏（nav3 一批补的用户可见行为：Back / Forward / 最近位置回原来那一栏）——
// 上游依据（2026-10-06 逐行开参考树自数核对）：
//   · `PlaceInfo` 记着自己当时所在的编辑器窗口：
//     `platform/platform-impl/src/com/intellij/openapi/fileEditor/impl/IdeDocumentHistoryImpl.kt:685-694`
//     （`:689` 的 `window: EditorWindow?` 形参、`:694` 用 `WeakReference` 存），取用是 `:712` 的 `getWindow()`；
//   · 跳回去时把这个窗口原样交给 `openFile`：同文件 `:572-579`
//     （`val window = if (openMode != NEW_WINDOW) info.getWindow() else null`）
//     ⇒ 窗口还在就回原来那一栏，窗口已经没了（弱引用指空）才落当前栏。
test('paneOfGroup：认对象不认别的东西，未分栏时第二栏不算在屏幕上', () => {
  const model = createSplitModel()
  assert.equal(paneOfGroup(model, null), null, '没记住 = null')
  assert.equal(paneOfGroup(model, { tabs: [], activePath: '' }), null, '不属于这两栏的对象 = null')
  model.orientation = 'horizontal'
  assert.equal(paneOfGroup(model, model.groups[0]), 0)
  assert.equal(paneOfGroup(model, model.groups[1]), 1, '分栏中：第二栏在屏幕上')
  model.orientation = 'none'
  assert.equal(paneOfGroup(model, model.groups[1]), null, '未分栏：第二栏对象还在数组里，但它不在屏幕上（= 上游窗口已 Dispose）')
})

test('jumpTargetPane：记住的那栏还在就回那一栏，没了才落当前栏', () => {
  const model = createSplitModel()
  model.orientation = 'horizontal'
  model.focused = 0
  assert.equal(jumpTargetPane(model, pathOf, 'x.ts', model.groups[1]), 1, '跳转落在记住的第二栏')
  model.orientation = 'none'
  assert.equal(jumpTargetPane(model, pathOf, 'x.ts', model.groups[1]), 0, '那栏没了 ⇒ 回落当前栏（不猜、不开新栏）')
  model.focused = 1
  assert.equal(jumpTargetPane(model, pathOf, 'x.ts', null), 1, '压根没记住 ⇒ 当前栏')
})

test('jumpTargetPane：文件已经在哪一栏开着，那一栏优先于记住的栏', () => {
  const model = createSplitModel()
  model.orientation = 'horizontal'
  model.groups[0].tabs = [{ path: 'a.ts' }]
  assert.equal(jumpTargetPane(model, pathOf, 'a.ts', model.groups[1]), 0, '本仓一个文件不会在两栏各开一份编辑器状态')
})

test('jumpTargetPane 记的是对象：拖到左缘换序（swapGroups）之后仍跟着那一栏走', () => {
  const model = createSplitModel()
  model.orientation = 'vertical'
  const second = model.groups[1]
  assert.equal(jumpTargetPane(model, pathOf, 'x.ts', second), 1)
  swapGroups(model)
  assert.equal(jumpTargetPane(model, pathOf, 'x.ts', second), 0, '两栏内容对调 ⇒ 同一窗口对象现在排在前头，跳转跟着对象走')
})
