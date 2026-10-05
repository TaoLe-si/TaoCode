// dbg/frames-vars 本轮补齐的三件事的判据：
//   · Group by Type（上游 `XValueGroup`/`XValueGroupNodeImpl` 的等价物）；
//   · 「按数组显示」（任务书里的 ViewAsArray 语义：把索引形态的孩子按 `[i]` 呈现）；
//   · 库帧过滤（上游 `XDebuggerDataViewSettings.isShowLibraryStackFrames`）。
// 规则都在 `src/debugDataView.ts`（DebugPanel 只传开关），这里直接驱动它。
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import {
  canViewAsArray, collectVarRows, parseArrayIndex, visibleFrames,
} from '../src/debugDataView.ts'

const v = (name, value, reference = 0, named = true, type) => ({ name, value, reference, named, type })
const scopes = [{ name: 'Locals', reference: 1, variablesReference: 1, expensive: false }]

test('按数组显示：索引名判定与「可转成数组」判定', () => {
  assert.equal(parseArrayIndex('0'), 0)
  assert.equal(parseArrayIndex('12'), 12)
  assert.equal(parseArrayIndex(' 3 '), 3)
  assert.equal(parseArrayIndex('-1'), null)
  assert.equal(parseArrayIndex('x'), null)
  assert.equal(parseArrayIndex('1.5'), null)
  assert.equal(canViewAsArray([v('0', 'a'), v('1', 'b')]), true)
  assert.equal(canViewAsArray([v('0', 'a', 0, false)]), true, 'named:false 也是索引形态')
  assert.equal(canViewAsArray([v('size', '2'), v('0', 'a')]), false, '混着命名成员就不是纯数组')
  assert.equal(canViewAsArray([]), false)
})

test('按数组显示：数组视图下孩子名字变 [i]，原始下标不因隐藏/排序错位', () => {
  const values = { 1: [v('0', 'a'), v('1', 'null'), v('2', 'c')] }
  // 未开启数组视图时按适配器给的名字画。
  const plain = collectVarRows(scopes, values, { s0: true }, { hideNullValues: false, sortByName: false })
  assert.deepEqual(plain.map(row => row.name), ['Locals', '0', '1', '2'])
  // 开启后 `[i]` 用的是**原始下标**：隐藏掉的元素 1 不占位，元素 2 仍是 [2]。
  const arrayView = collectVarRows(scopes, values, { s0: true }, { hideNullValues: true, sortByName: false, arrayViews: [1] })
  assert.deepEqual(arrayView.map(row => row.name), ['Locals', '[0]', '[2]'])
})

test('Group by Type：同层按 type 聚组，组内保持原顺序，组外是无类型成员', () => {
  const children = [v('a', '1', 0, true, 'int'), v('b', 'x', 0, true, 'String'), v('c', '2', 0, true, 'int'), v('d', '3')]
  const values = { 1: children }
  const rows = collectVarRows(scopes, values, { s0: true }, { hideNullValues: false, sortByName: false, groupByType: true })
  assert.deepEqual(rows.map(row => row.name), ['Locals', 'int', 'String', 'd'], '组行（类型名）+ 组外成员')
  assert.equal(rows[1].group, true)
  assert.equal(rows[1].value, '2 项')
  assert.equal(rows[1].expandable, true)
  assert.equal(rows[1].expanded, false, '组默认收起')
  // 展开 int 组：两个孩子按原始顺序出现，深度比组多一层。
  const key = rows[1].key
  const expanded = collectVarRows(scopes, values, { s0: true, [key]: true }, { hideNullValues: false, sortByName: false, groupByType: true })
  assert.deepEqual(expanded.map(row => row.name), ['Locals', 'int', 'a', 'c', 'String', 'd'])
  assert.equal(expanded[2].depth, expanded[1].depth + 1)
  assert.equal(expanded[2].container, 1, '组内成员仍以作用域为容器（可改值）')
})

test('Group by Type 与按名排序可以叠加：组内也按名排序', () => {
  const values = { 1: [v('zeta', '1', 0, true, 'int'), v('alpha', '2', 0, true, 'int')] }
  const rows = collectVarRows(scopes, values, { s0: true, 's0-g|int': true }, { hideNullValues: false, sortByName: true, groupByType: true })
  assert.deepEqual(rows.map(row => row.name), ['Locals', 'int', 'alpha', 'zeta'])
})

test('库帧过滤：subtle 帧默认隐藏，选中的那一帧与普通帧保留', () => {
  const frames = [
    { id: 1, presentationHint: 'subtle' },
    { id: 2, presentationHint: 'normal' },
    { id: 3, presentationHint: 'subtle' },
  ]
  assert.deepEqual(visibleFrames(frames, false, 0).map(frame => frame.id), [1, 2], '选中的 subtle 帧保留')
  assert.deepEqual(visibleFrames(frames, false, 2).map(frame => frame.id), [2, 3])
  assert.deepEqual(visibleFrames(frames, true).map(frame => frame.id), [1, 2, 3], '开关打开就全显示')
})

test('DebugPanel 接线：分组开关、数组视图与库帧开关都真的接在渲染里', () => {
  const panel = readFileSync('src/components/DebugPanel.vue', 'utf8')
  assert.match(panel, /groupByType: groupByType\.value/, '分组开关进 options')
  assert.match(panel, /arrayViews: arrayViews\.value/, '数组视图集合进 options')
  assert.match(panel, /arrayViews\.value = \[\.\.\.new Set\(\[\.\.\.arrayViews\.value, target\.reference\]\)\]/, '「按数组显示」写入')
  assert.match(panel, /visibleFrames\(frames, dataView\.showLibraryFrames === true, selectedFrameIndex\)/, '堆栈按库帧开关过滤')
  const view = readFileSync('src/components/ToolWindowView.vue', 'utf8')
  assert.match(view, /:data-view="ctx\.debugView"/)
})
