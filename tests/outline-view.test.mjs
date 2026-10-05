import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

import { arrange, outlineKey, treeOf } from '../src/outlineView.ts'

const read = relative => readFileSync(fileURLToPath(new URL(relative, import.meta.url)), 'utf8')

const sym = (name, kind, startLine, endLine, startChar = 0, detail = '') => ({
  name, kind, detail, startLine, startChar, endLine, endChar: startChar + name.length,
})

// What the native layer hands over: the server's tree, flattened depth-first.
const symbols = [
  sym('Sample', 5, 4, 20),
  sym('run', 6, 6, 9, 4, 'void'),
  sym('nested', 13, 7, 8, 8),
  sym('calc', 6, 12, 15, 4, 'int'),
  sym('main', 12, 25, 30),
]
const tree = treeOf(symbols)
// "trail" plus depth is what the row shows, so the helper prints both.
const names = list => list.map(entry => `${entry.trail ? entry.trail + '.' : ''}${entry.symbol.name}:d${entry.depth}`)

test('the flattened answer is nested again by containment', () => {
  assert.equal(tree.length, 2)
  assert.equal(tree[0].symbol.name, 'Sample')
  assert.deepEqual(tree[0].children.map(node => node.symbol.name), ['run', 'calc'])
  assert.deepEqual(tree[0].children[0].children.map(node => node.symbol.name), ['nested'])
  assert.equal(tree[1].symbol.name, 'main')
})

test('the default view keeps document order and depth', () => {
  assert.deepEqual(names(arrange(tree, { sort: false, flat: false, filter: '' })), [
    'Sample:d0', 'Sample.run:d1', 'Sample.run.nested:d2', 'Sample.calc:d1', 'main:d0',
  ])
})

test('alphabetical order reorders siblings only', () => {
  assert.deepEqual(names(arrange(tree, { sort: true, flat: false, filter: '' })), [
    'main:d0', 'Sample:d0', 'Sample.calc:d1', 'Sample.run:d1', 'Sample.run.nested:d2',
  ])
})

test('the flat view drops the indentation but keeps the container path', () => {
  assert.deepEqual(names(arrange(tree, { sort: false, flat: true, filter: '' })), [
    'Sample:d0', 'Sample.run:d0', 'Sample.run.nested:d0', 'Sample.calc:d0', 'main:d0',
  ])
})

test('the filter keeps an ancestor while a descendant still matches', () => {
  assert.deepEqual(names(arrange(tree, { sort: false, flat: false, filter: 'nest' })), [
    'Sample:d0', 'Sample.run:d1', 'Sample.run.nested:d2',
  ])
  assert.deepEqual(arrange(tree, { sort: false, flat: false, filter: 'zzz' }), [])
  assert.deepEqual(names(arrange(tree, { sort: false, flat: false, filter: '  CALC  ' })), [
    'Sample:d0', 'Sample.calc:d1',
  ], 'surrounding spaces and case are ignored, the parent stays as context')
})

test('grouping by symbol kind orders members before fields, per level', () => {
  const mixed = treeOf([
    sym('C', 5, 0, 10),
    sym('bField', 8, 1, 2, 2),
    sym('zMethod', 6, 3, 4, 2),
    sym('aConst', 14, 5, 6, 2),
  ])
  assert.deepEqual(names(arrange(mixed, { sort: false, flat: false, filter: '' })), [
    'C:d0', 'C.bField:d1', 'C.zMethod:d1', 'C.aConst:d1',
  ], 'document order without grouping')
  assert.deepEqual(names(arrange(mixed, { sort: false, flat: false, group: true, filter: '' })), [
    'C:d0', 'C.zMethod:d1', 'C.bField:d1', 'C.aConst:d1',
  ], 'methods (rank 1) before fields/constants (rank 2), original order inside a rank')
  assert.deepEqual(names(arrange(mixed, { sort: true, flat: false, group: true, filter: '' })), [
    'C:d0', 'C.zMethod:d1', 'C.aConst:d1', 'C.bField:d1',
  ], 'name sort applies inside the kind group')
})

// 折叠（上游 `StructureViewComponent` 的树展开态）—— 判据在 src/outlineView.ts 的
// `OutlineEntry.hasChildren`/`collapsed` 与 `OutlineView.collapsed`。
test('collapsing a node hides its descendants and marks the caret state', () => {
  const runKey = outlineKey(symbols[1])                       // Sample.run
  const rows = arrange(tree, { sort: false, flat: false, filter: '', collapsed: new Set([runKey]) })
  assert.deepEqual(names(rows), ['Sample:d0', 'Sample.run:d1', 'Sample.calc:d1', 'main:d0'])
  const sample = rows[0]
  assert.equal(sample.hasChildren, true, 'Sample 还有子节点，要画箭头')
  assert.equal(sample.collapsed, false)
  const run = rows[1]
  assert.equal(run.key, runKey)
  assert.equal(run.hasChildren, true)
  assert.equal(run.collapsed, true)
  assert.equal(rows[2].symbol.name, 'calc', '被收起的子节点之后，后面的兄弟照常显示')
})

test('a node without children has no caret and collapsing it is a no-op', () => {
  const nestedKey = outlineKey(symbols[2])                    // Sample.run.nested（叶子）
  const rows = arrange(tree, { sort: false, flat: false, filter: '', collapsed: new Set([nestedKey]) })
  assert.deepEqual(names(rows), [
    'Sample:d0', 'Sample.run:d1', 'Sample.run.nested:d2', 'Sample.calc:d1', 'main:d0',
  ])
  assert.equal(rows[2].hasChildren, false)
  assert.equal(rows[2].collapsed, false)
})

test('the flat view ignores collapse state entirely', () => {
  const runKey = outlineKey(symbols[1])
  const rows = arrange(tree, { sort: false, flat: true, filter: '', collapsed: new Set([runKey]) })
  assert.deepEqual(names(rows), [
    'Sample:d0', 'Sample.run:d0', 'Sample.run.nested:d0', 'Sample.calc:d0', 'main:d0',
  ])
  assert.equal(rows.some(entry => entry.hasChildren), false, '平铺列表没有树，不画箭头')
})

test('an active filter auto-expands collapsed branches', () => {
  const runKey = outlineKey(symbols[1])
  const rows = arrange(tree, { sort: false, flat: false, filter: 'nest', collapsed: new Set([runKey]) })
  assert.deepEqual(names(rows), ['Sample:d0', 'Sample.run:d1', 'Sample.run.nested:d2'],
    '过滤命中在折叠的分支里时，路径要展开（IDEA speed search 同则）')
  assert.equal(rows[1].collapsed, false)
  assert.equal(rows[1].hasChildren, true)
})

test('outline keys identify a symbol by name and position', () => {
  const a = { name: 'run', kind: 6, startLine: 6, startChar: 4, endLine: 9, endChar: 8 }
  assert.notEqual(outlineKey(a), outlineKey({ ...a, startLine: 30 }), '同名不同位置的符号不能撞键')
  assert.equal(outlineKey(a), outlineKey({ ...a }), '同一个符号每次得到同一个键')
})

// 「不放假控件」的门禁：跟随编辑器光标那一格要真数据（编辑器光标）才画。
// 挂载点（src/components/ToolWindowView.vue 的 <OutlinePanel>）目前不传 `source`
// ⇒ 按钮必须带 `v-if="source"`。把 v-if 删掉（画一个点了没反应的开关）这条就红。
test('the follow-editor toggle is not rendered without caret data', () => {
  const panel = read('../src/components/OutlinePanel.vue')
  const row = panel.split('\n').find(line => line.includes('aria-label="跟随编辑器光标"'))
  assert.ok(row, '跟随编辑器光标那一格必须存在（上游 StructureViewComponent.java:804 的开关）')
  assert.match(row, /v-if="source"/, '没有编辑器光标数据时整格不渲染，不能留假开关')
  const mount = read('../src/components/ToolWindowView.vue')
  const tag = mount.split('\n').find(line => line.includes('<OutlinePanel'))
  assert.ok(tag, '结构视图必须挂在工具窗口里')
  if (!tag.includes(':source=')) {
    assert.match(row, /v-if="source"/, '挂载点没喂 source ⇒ 开关只能按 source 条件渲染（接线请求 W1）')
  }
})
