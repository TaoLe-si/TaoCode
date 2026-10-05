// 值窗口的历史栈（`src/debugValueHistory.ts`）—— 上游 `DebuggerTreeWithHistoryContainer`
// （`platform/xdebugger-impl/ui/src/com/intellij/xdebugger/impl/evaluate/quick/common/DebuggerTreeWithHistoryContainer.java`）。
import test from 'node:test'
import assert from 'node:assert/strict'
import {
  VALUE_HISTORY_SIZE, canGoBackward, canGoForward, canSetAsRoot, createValueHistory,
  currentValueHistoryEntry, goBackward, goForward, pushValueHistory,
} from '../src/debugValueHistory.ts'

test('打开时历史里只有根节点自己，index = -1（上游构造器 :48-52）', () => {
  const history = createValueHistory(100, 'user')
  assert.deepEqual(history.entries, [{ reference: 100, label: 'user' }])
  assert.equal(history.index, -1)
  // index 是 -1 时取第 0 项（窗口一打开就有东西可显示）。
  assert.equal(currentValueHistoryEntry(history)?.label, 'user')
})

test('「设为根」插到当前项之后并跳过去：第一次 index 变 1（上游 :78-85）', () => {
  const history = createValueHistory(100, 'user')
  const once = pushValueHistory(history, { reference: 7, label: 'name' })
  assert.equal(once.index, 1)
  assert.deepEqual(once.entries.map(entry => entry.label), ['user', 'name'])
  const twice = pushValueHistory(once, { reference: 9, label: 'address.city' })
  assert.equal(twice.index, 2)
  assert.deepEqual(twice.entries.map(entry => entry.label), ['user', 'name', 'address.city'])
})

test('往回/往前只看「长度 > 1」与 index 位置（上游 :120 / :145）', () => {
  const fresh = createValueHistory(100, 'user')
  assert.equal(canGoBackward(fresh), false)
  assert.equal(canGoForward(fresh), false)
  // index 停在 -1 时不能往回（上游 `myCurrentIndex > 0`）。
  const once = pushValueHistory(fresh, { reference: 7, label: 'name' })
  assert.equal(canGoBackward(once), true)
  assert.equal(canGoForward(once), false)
  const twice = pushValueHistory(once, { reference: 9, label: 'city' })
  // 刚钻到最新一项时前面没有可往前去的项（上游 `index < size - 1`）。
  assert.equal(canGoForward(twice), false)
  assert.equal(currentValueHistoryEntry(twice)?.label, 'city')
  const back = goBackward(twice)
  assert.equal(currentValueHistoryEntry(back)?.label, 'name')
  assert.equal(canGoForward(back), true)
  assert.equal(currentValueHistoryEntry(goForward(back))?.label, 'city')
})

test('往回走之后前向段仍可达，且不会被插入截断（上游 splice 的怪癖，如实照搬）', () => {
  let history = createValueHistory(100, 'user')
  history = pushValueHistory(history, { reference: 7, label: 'name' })
  history = pushValueHistory(history, { reference: 9, label: 'city' })
  history = goBackward(history)
  assert.equal(currentValueHistoryEntry(history)?.label, 'name')
  assert.equal(canGoForward(history), true)
  // 往回之后再钻进去：上游 `addToHistory` 用 splice 插入，前向项被顶到后面而不是丢掉。
  history = pushValueHistory(history, { reference: 11, label: 'zip' })
  assert.deepEqual(history.entries.map(entry => entry.label), ['user', 'name', 'zip', 'city'])
  assert.equal(currentValueHistoryEntry(history)?.label, 'zip')
  // 不可走的边界返回原对象（不改语义）。
  const end = goForward(history)
  assert.equal(currentValueHistoryEntry(end)?.label, 'city')
  assert.equal(goForward(end), end)
})

test('容量判据照搬上游 `index < HISTORY_SIZE`：最多 12 项，第 12 次 push 不生效', () => {
  assert.equal(VALUE_HISTORY_SIZE, 11)
  let history = createValueHistory(1, 'root')
  for (let n = 1; n <= VALUE_HISTORY_SIZE; n += 1) {
    history = pushValueHistory(history, { reference: 100 + n, label: `n${n}` })
  }
  assert.equal(history.index, VALUE_HISTORY_SIZE)
  assert.equal(history.entries.length, VALUE_HISTORY_SIZE + 1)
  const overflow = pushValueHistory(history, { reference: 999, label: 'over' })
  assert.equal(overflow, history)
  assert.equal(overflow.entries.length, VALUE_HISTORY_SIZE + 1)
})

test('「设为根」可用性：要有选中、深度超过根、且不是叶子（上游 :164-171）', () => {
  // 根可见：路径深度 > 1 才算（即至少选中了一个子节点）。
  assert.equal(canSetAsRoot(0, false), false)
  assert.equal(canSetAsRoot(1, false), false)
  assert.equal(canSetAsRoot(2, false), true)
  // 叶子不可设为根。
  assert.equal(canSetAsRoot(2, true), false)
  // 根不可见时阈值提到 2（上游 `pathCount > 2`）。
  assert.equal(canSetAsRoot(2, false, false), false)
  assert.equal(canSetAsRoot(3, false, false), true)
})
