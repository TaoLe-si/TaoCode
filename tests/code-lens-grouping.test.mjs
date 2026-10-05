// `src/codeLens.ts` 的锚点归并规则 + `src/codeLensExtension.ts` 的接线：
//   · 同一个 LSP `range`（= 同一个符号）上多个 provider 的条目，上游放进**同一个 inlay 的列表**
//     用间隔逐个画（`CodeVisionListPainter.kt:37-49`、`DelimiterPainter.kt:26-28`），不是一行一条；
//   · 同一锚点可见条目的上限 5 来自 `CodeVisionHost.kt:85` 的 `defaultVisibleLenses`，
//     截断规则在 `CodeVisionListData.updateVisible()`（`CodeVisionListData.kt:45-57`）；
//   · `editor.codeVision.more.inlay` 缺省 false（`registry.properties:1759`），被截掉的条目没有入口。

import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { CODE_LENS_VISIBLE_MAX, anchoredLenses, groupAnchoredLenses } from '../src/codeLens.ts'

const lens = (line, title, extra = {}) => ({
  title, command: `cmd.${title}`,
  range: { startLine: line, startChar: 0, endLine: line, endChar: 1 }, ...extra,
})

test('同一锚点的条目归并成一行，顺序照适配器给的顺序', () => {
  const rows = groupAnchoredLenses(anchoredLenses([
    lens(3, 'usages'), lens(3, 'inheritors'), lens(3, 'problems'),
  ]))
  assert.equal(rows.length, 1)
  assert.equal(rows[0].line, 3)
  assert.deepEqual(rows[0].items.map(item => item.title), ['usages', 'inheritors', 'problems'])
  assert.equal(rows[0].hidden, 0)
})

test('同一行的两个不同锚点（startChar 不同）是两行，按 startChar 排序', () => {
  const rows = groupAnchoredLenses(anchoredLenses([
    { title: 'b', command: 'cmd.b', range: { startLine: 2, startChar: 20, endLine: 2, endChar: 25 } },
    { title: 'a', command: 'cmd.a', range: { startLine: 2, startChar: 4, endLine: 2, endChar: 8 } },
  ]))
  assert.deepEqual(rows.map(row => row.startChar), [4, 20])
  assert.deepEqual(rows.map(row => row.items.length), [1, 1])
})

test('可见上限是上游的 defaultVisibleLenses = 5，超出部分计入 hidden', () => {
  const items = Array.from({ length: 8 }, (_, index) => lens(0, `l${index}`))
  const rows = groupAnchoredLenses(anchoredLenses(items))
  assert.equal(CODE_LENS_VISIBLE_MAX, 5)
  assert.equal(rows[0].items.length, 5)
  assert.deepEqual(rows[0].items.map(item => item.title), ['l0', 'l1', 'l2', 'l3', 'l4'])
  assert.equal(rows[0].hidden, 3)
})

test('上限可覆盖（设置页的 anchorLimit 位）；非法上限退回缺省', () => {
  const items = Array.from({ length: 4 }, (_, index) => lens(0, `l${index}`))
  const rows = groupAnchoredLenses(anchoredLenses(items), 2)
  assert.equal(rows[0].items.length, 2)
  assert.equal(rows[0].hidden, 2)
  const many = Array.from({ length: 7 }, (_, index) => lens(0, `m${index}`))
  assert.equal(groupAnchoredLenses(anchoredLenses(many), 0)[0].items.length, CODE_LENS_VISIBLE_MAX)
})

test('行序稳定：不同行按行号排；同一锚点内不改顺序', () => {
  const rows = groupAnchoredLenses(anchoredLenses([lens(9, 'x'), lens(1, 'a'), lens(9, 'y'), lens(1, 'b')]))
  assert.deepEqual(rows.map(row => [row.line, row.items.map(item => item.title)]),
    [[1, ['a', 'b']], [9, ['x', 'y']]])
})

test('没有 range 的条目归并时也跳过（不编造位置）', () => {
  const rows = groupAnchoredLenses([{ line: 0, item: { title: 'x', command: 'cmd' } }, { line: 1, item: lens(1, 'ok') }])
  assert.deepEqual(rows.map(row => row.line), [1])
})

test('接线：CodeMirror 落点按锚点行渲染，并保留 codeLensCommand 的点击校验', () => {
  const extension = readFileSync('src/codeLensExtension.ts', 'utf8')
  assert.ok(extension.includes('groupAnchoredLenses(lenses)'), '渲染没有按锚点归并')
  assert.ok(extension.includes('const payload = codeLensCommand(this.lens.item)'), '点击没有复用 codeLensCommand')
  assert.ok(extension.includes("'.cm-code-lens-delimiter'"), '同锚点条目之间没有分隔（DelimiterPainter 的等价物）')
})
