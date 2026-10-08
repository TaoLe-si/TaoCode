// dbg/frames-vars：监视行级动作（`src/debugWatchActions.ts` + `DebugWatchesPane.vue`）的判据。
//
// 上游依据（`platform/xdebugger-impl/ui/src/com/intellij/xdebugger/impl/frame/actions/`）：
//   · `XMoveWatchUp.java:30-40` / `XMoveWatchDown.java:30-40` 的 isEnabled（不是首/末条）；
//   · `XRemoveAllWatchesAction.java:29-41`（`root.getChildCount() > 0`）；
//   · `XPauseWatchAction.kt:16-65`（canBePaused、暂停保留值、恢复重算、文案随状态变）；
//   · `XWatchesViewImpl.java:673-694`（removeAllWatches/moveWatchUp/moveWatchDown）。
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const {
  canMoveWatchUp, canMoveWatchDown, moveWatchUp, moveWatchDown,
  canRemoveAllWatches, removeAllWatches, canPauseWatch, toggleWatchPause,
  watchNeedsRecompute, pauseWatchActionLabel,
} = await import('../src/debugWatchActions.ts')
const { useDebugWatches } = await import('../src/debugWatchesStore.ts')

const read = rel => readFileSync(new URL(`../${rel}`, import.meta.url), 'utf8')
const list = (...texts) => texts.map(text => ({ text, value: `v:${text}` }))

test('上移/下移的可用性 = 不是第一条/最后一条（XMoveWatchUp/Down 的 isEnabled）', () => {
  const watches = list('a', 'b', 'c')
  assert.equal(canMoveWatchUp(watches, 'a'), false, '第一条不能上移')
  assert.equal(canMoveWatchUp(watches, 'b'), true)
  assert.equal(canMoveWatchDown(watches, 'c'), false, '最后一条不能下移')
  assert.equal(canMoveWatchDown(watches, 'b'), true)
  assert.equal(canMoveWatchUp(watches, 'missing'), false, '不在列表里不能上移')
  assert.equal(canMoveWatchDown(watches, 'missing'), false)
})

test('上移/下移真的换位，越界时原样返回且不改原数组', () => {
  const watches = list('a', 'b', 'c')
  assert.deepEqual(moveWatchUp(watches, 'c').map(w => w.text), ['a', 'c', 'b'])
  assert.deepEqual(moveWatchDown(watches, 'a').map(w => w.text), ['b', 'a', 'c'])
  assert.deepEqual(moveWatchUp(watches, 'a').map(w => w.text), ['a', 'b', 'c'])
  assert.deepEqual(moveWatchDown(watches, 'c').map(w => w.text), ['a', 'b', 'c'])
  assert.deepEqual(watches.map(w => w.text), ['a', 'b', 'c'], '原数组不动')
})

test('全清：空表不可用，清完是空数组（XRemoveAllWatchesAction）', () => {
  assert.equal(canRemoveAllWatches([]), false)
  assert.equal(canRemoveAllWatches(list('a')), true)
  assert.deepEqual(removeAllWatches(), [])
})

test('暂停求值：没算过值的不给暂停，暂停保留值、恢复清值触发重算', () => {
  assert.equal(canPauseWatch({ text: 'a', value: '' }), false, '正在求值（值还空）不给暂停')
  assert.equal(canPauseWatch({ text: 'a', value: 'v' }), true)
  const watches = [{ text: 'a', value: '1' }, { text: 'b', value: '2' }]
  const paused = toggleWatchPause(watches, 'a')
  assert.equal(paused[0].paused, true)
  assert.equal(paused[0].value, '1', '暂停保留已算出的值（XPauseWatchAction.kt:59-61）')
  assert.equal(paused[1].value, '2', '别的条不动')
  const resumed = toggleWatchPause(paused, 'a')
  assert.equal(resumed[0].paused, false)
  assert.equal(resumed[0].value, '', '恢复清值触发重算（:63-65 的 recomputePresentation）')
  assert.equal(watchNeedsRecompute({ text: 'a', value: '1' }), true)
  assert.equal(watchNeedsRecompute({ text: 'a', value: '1', paused: true }), false, '暂停的跳过重算')
})

test('文案随是否已暂停在暂停/恢复之间变（XPauseWatchAction.kt:33-40）', () => {
  assert.equal(pauseWatchActionLabel({ text: 'a', value: '1' }), '暂停监视求值')
  assert.equal(pauseWatchActionLabel({ text: 'a', value: '1', paused: true }), '恢复监视求值')
})

test('store：加/删/移/全清/暂停/改名都真的作用在列表上', () => {
  const saved = []
  const store = useDebugWatches({
    storage: { getItem: () => null, setItem: (key, value) => saved.push([key, value]) },
    root: () => 'D:/p', recompute: () => { calls += 1 }, onClear: () => { cleared += 1 },
  })
  let calls = 0, cleared = 0
  assert.equal(store.add('  x  '), true, '两端空白被 trim')
  assert.equal(store.add('x'), false, '重复不加')
  assert.equal(store.add('  '), false, '空串不加')
  assert.equal(calls, 1, '加一条立刻重算')
  store.add('y'); store.add('z')
  store.move('z', 'up')
  assert.deepEqual(store.watches.value.map(w => w.text), ['x', 'z', 'y'])
  // 先要有算出的值才给暂停（canPauseWatch）。
  store.setValue('x', '1')
  store.togglePause('x')
  assert.equal(store.watches.value[0].paused, true)
  assert.equal(store.watches.value[0].value, '1', '暂停保留已算出的值')
  store.setValue('x', 'new')
  assert.equal(store.watches.value[0].value, 'new')
  store.togglePause('x')
  assert.equal(store.watches.value[0].value, '', '恢复清值触发重算')
  assert.equal(store.rename('x', 'w'), true)
  assert.equal(store.rename('w', 'z'), false, '改名撞已有表达式就拒绝')
  assert.deepEqual(store.watches.value.map(w => w.text), ['w', 'z', 'y'])
  store.remove('z')
  assert.deepEqual(store.watches.value.map(w => w.text), ['w', 'y'])
  store.removeAll()
  assert.deepEqual(store.watches.value, [])
  assert.equal(cleared, 1, '全清要顺带撤行内监视（XWatchesViewImpl.removeAllWatches）')
})

test('接线：面板挂 DebugWatchesPane，四个动作都有按钮', () => {
  const panel = read('src/components/DebugPanel.vue')
  assert.match(panel, /<DebugWatchesPane/)
  assert.match(panel, /@move="\$event => moveWatch\(\$event\.text, \$event\.direction\)"/)
  assert.match(panel, /@remove-all="removeAllWatchEntries"/)
  assert.match(panel, /@toggle-pause="toggleWatchPauseEntry"/)
  const pane = read('src/components/DebugWatchesPane.vue')
  assert.match(pane, /Move Watch Up/)
  assert.match(pane, /Move Watch Down/)
  assert.match(pane, /Remove All Watches/)
  assert.match(pane, /pauseWatchActionLabel/)
})