import { strict as assert } from 'node:assert'
import test from 'node:test'
// The module is TypeScript; strip types the way node 24 does for .ts imports.
const { createSplitModel, splitTabOutIn, unsplitModel, unsplitAllModel, closeTabInPane, otherPane, tabClosingOrder } =
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
