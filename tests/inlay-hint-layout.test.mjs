// 内联提示的布局与去重（`src/inlayHintLayout.ts`）：开关过滤 → 排序 → 同位置去重/优先级 → 行内上限。
import test from 'node:test'
import assert from 'node:assert/strict'
import { hiddenInlayCount, inlayHintPriority, inlayHintsByLine, layoutInlayHints } from '../src/inlayHintLayout.ts'

const hint = (line, character, label, kind) => ({ line, character, label, kind })

test('排序：行 → 列 → 同位置优先级（参数名 > 类型）', () => {
  const result = layoutInlayHints([
    hint(2, 5, 'Type', 1),
    hint(0, 3, 'b', 2),
    hint(2, 5, 'name:', 2),
    hint(0, 1, 'a', 2),
  ])
  assert.deepEqual(result.hints.map(item => item.label), ['a', 'b', 'name:'])
  assert.equal(result.hidden.conflict, 1, '同位置的类型提示被参数名压掉')
})

test('完全重复只留一条；非法条目直接丢（不计数）', () => {
  const result = layoutInlayHints([
    hint(1, 2, 'x', 2), hint(1, 2, 'x', 2),
    { line: -1, character: 0, label: 'bad' },
    { line: 0, character: 0, label: '' },
    { line: 0.5, character: 0, label: 'frac' },
  ])
  assert.deepEqual(result.hints.map(item => item.label), ['x'])
  assert.equal(result.hidden.duplicate, 1)
  assert.equal(hiddenInlayCount(result), 1)
})

test('按类型开关：关掉 parameter 后只剩类型提示', () => {
  const result = layoutInlayHints(
    [hint(0, 0, 'name:', 2), hint(0, 5, 'int', 1), hint(0, 9, 'other')],
    { type: true, parameter: false, other: false },
  )
  assert.deepEqual(result.hints.map(item => item.label), ['int'])
  assert.equal(result.hidden.toggle, 2)
})

test('行内上限：超出按列序丢掉末尾，计数进 overflow', () => {
  const hints = [0, 1, 2, 3, 4].map(index => hint(1, index * 2, `h${index}`, 2))
  const result = layoutInlayHints(hints, { type: true, parameter: true, other: true }, { maxPerLine: 3 })
  assert.deepEqual(result.hints.map(item => item.label), ['h0', 'h1', 'h2'])
  assert.equal(result.hidden.overflow, 2)
  const unlimited = layoutInlayHints(hints, { type: true, parameter: true, other: true }, { maxPerLine: 100 })
  assert.equal(unlimited.hints.length, 5)
})

test('同位置只留一条：后到的（优先级低的）被压掉', () => {
  const result = layoutInlayHints([
    { line: 0, character: 1, label: 'x', kind: 2, paddingLeft: true },
    { line: 0, character: 1, label: 'x', kind: 2 },
  ])
  assert.equal(result.hints.length, 1, '同位置不同文本仍按优先级只留一条')
  assert.equal(result.hidden.conflict, 1)
})

test('inlayHintsByLine 分组；优先级函数直查', () => {
  const result = layoutInlayHints([hint(0, 0, 'a', 2), hint(0, 4, 'b', 1), hint(1, 0, 'c')])
  const byLine = inlayHintsByLine(result.hints)
  assert.deepEqual([...byLine.keys()], [0, 1])
  assert.equal(byLine.get(0).length, 2)
  assert.ok(inlayHintPriority(hint(0, 0, 'p', 2)) < inlayHintPriority(hint(0, 0, 't', 1)))
})
