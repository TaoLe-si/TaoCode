// 树节点展开/折叠动作（`src/treeNodeActions.ts`）的判据 ——
// 上游 `platform/platform-impl/src/com/intellij/ide/actions/tree/` 那一族（`ExpandTreeNodeAction`/
// `CollapseTreeNodeAction`/`FullyExpandTreeNodeAction` + `com.intellij.ui.TreeExpandCollapse`）。
import test from 'node:test'
import assert from 'node:assert/strict'
import {
  FULL_EXPAND_LEVEL_LIMIT,
  FULL_EXPAND_NODE_LIMIT,
  TREE_NODE_ACTION_CODES,
  TREE_NODE_ACTION_IDS,
  TREE_NODE_ACTION_LABELS,
  fullExpandTargets,
  fullyExpandPaths,
  isTreeExpandable,
  treeNodeActionFor,
  treeNodeActionTarget,
} from '../src/treeNodeActions.ts'

const dir = (path, parent = '', kind = 'directory') => ({ path, parent, kind })
const file = (path, parent = '', hasChildren = false) => ({ path, parent, kind: 'file', hasChildren })

test('三个动作 id 与键面照上游（intellij.platform.ide.impl.actions.xml:293-295、$default.xml:27-35）', () => {
  assert.deepEqual([...TREE_NODE_ACTION_IDS], ['ExpandTreeNode', 'CollapseTreeNode', 'FullyExpandTreeNode'])
  assert.deepEqual(TREE_NODE_ACTION_CODES, {
    FullyExpandTreeNode: 'NumpadMultiply', ExpandTreeNode: 'NumpadAdd', CollapseTreeNode: 'NumpadSubtract',
  })
  assert.deepEqual(TREE_NODE_ACTION_LABELS, { FullyExpandTreeNode: '全部展开', ExpandTreeNode: '展开', CollapseTreeNode: '折叠' })
})

test('上限照 TreeExpandCollapse.ExpandContext(300, 10)（:29）', () => {
  assert.equal(FULL_EXPAND_NODE_LIMIT, 300)
  assert.equal(FULL_EXPAND_LEVEL_LIMIT, 10)
})

test('键面 → 动作：裸小键盘键，带任何修饰键都不认（上游这三个绑定没有 modifier）', () => {
  assert.equal(treeNodeActionFor('NumpadMultiply'), 'FullyExpandTreeNode')
  assert.equal(treeNodeActionFor('NumpadAdd'), 'ExpandTreeNode')
  assert.equal(treeNodeActionFor('NumpadSubtract'), 'CollapseTreeNode')
  assert.equal(treeNodeActionFor('NumpadAdd', { ctrl: true }), null, 'Ctrl++ 不该被吞')
  assert.equal(treeNodeActionFor('NumpadMultiply', { shift: true }), null)
  assert.equal(treeNodeActionFor('Digit1'), null)
})

test('可展开性：目录与有嵌套子文件的文件行可展开，合成行不可（本仓 toggle 的口径）', () => {
  assert.equal(isTreeExpandable(dir('src')), true)
  assert.equal(isTreeExpandable(file('a.ts', '', true)), true)
  assert.equal(isTreeExpandable(file('a.ts')), false)
  assert.equal(isTreeExpandable(dir('\u0000libraries')), false, '合成行不是文件系统实体')
})

test('expand/collapse 的目标 = 当前选中行（getSelectionPath 取 lead path）', () => {
  const rows = [dir('src'), dir('src/main', 'src'), file('src/main/A.java', 'src/main')]
  assert.equal(treeNodeActionTarget(['src/main'], rows), 'src/main')
  assert.equal(treeNodeActionTarget([], rows), null)
  assert.equal(treeNodeActionTarget(['nope'], rows), null)
  // 多选时按行序取第一条（selection 是 Set，插入序与行序可能不同）。
  assert.equal(treeNodeActionTarget(['src/main/A.java', 'src'], rows), 'src')
})

test('fullExpandTargets：有选中取全部选中，无选中取第一行（根），空树为空', () => {
  const rows = [dir('src'), dir('lib')]
  assert.deepEqual(fullExpandTargets(['lib'], rows), ['lib'])
  assert.deepEqual(fullExpandTargets([], rows), ['src'])
  assert.deepEqual(fullExpandTargets([], []), [])
  assert.deepEqual(fullExpandTargets(['gone'], rows), ['src'], '选中项不在行表里 ⇒ 退回根')
})

test('fullyExpandPaths：逐层展开，只收可展开行，父不在时不下钻', () => {
  const rows = [
    dir('src'), dir('src/main', 'src'), file('src/main/A.java', 'src/main'),
    dir('src/test', 'src'), file('src/test/T.java', 'src/test'),
  ]
  const paths = fullyExpandPaths(['src'], rows)
  assert.deepEqual(paths, ['src', 'src/main', 'src/test'], '叶子文件不进展开集合')
})

test('fullyExpandPaths：节点上限截断（budget 跨目标共享，照 ExpandContext）', () => {
  const rows = []
  for (let i = 0; i < 10; i++) { rows.push(dir(`d${i}`)); for (let j = 0; j < 5; j++) rows.push(dir(`d${i}/c${j}`, `d${i}`)) }
  const paths = fullyExpandPaths(['d0', 'd1'], rows, 4, 10)
  assert.equal(paths.length, 4, '只开到预算用完')
})

test('fullyExpandPaths：层级上限截断（levelsLeft 含目标自己，照 ExpandContext）', () => {
  const rows = [dir('a')]
  let parent = 'a'
  for (let i = 1; i <= 15; i++) { const path = `${parent}/x`; rows.push(dir(path, parent)); parent = path }
  const paths = fullyExpandPaths(['a'], rows, 300, 3)
  assert.equal(paths.length, 3, '目标 + 往下 2 层 = 3 个节点（levelsLeft 从目标自己开始算）')
})

test('fullyExpandPaths：文件行有嵌套子文件时可展开（本仓 hasNested 的那一档）', () => {
  const rows = [file('component.ts', '', true), file('component.test.ts', 'component.ts')]
  // 目标行的 kind 是 file，但有子行 ⇒ 与 isTreeExpandable 同口径，可展开。
  assert.deepEqual(fullyExpandPaths(['component.ts'], rows), ['component.ts'])
})