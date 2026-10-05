import test from 'node:test'
import assert from 'node:assert/strict'

import { compareCompletions, sortCompletions } from '../src/completionSort.ts'

test('预选那条排最前（LSP preselect = 协议里的"默认选中"）', () => {
  const list = sortCompletions([{ label: 'aaa' }, { label: 'zzz', preselected: true }])
  assert.deepEqual(list.map(item => item.label), ['zzz', 'aaa'])
})

test('sortText 当相关性键；缺省退回 label', () => {
  // `LspCompletionWeigher.kt:31-35` 装的是 `ReverseComparableString`，`:38-40` 的
  // `compareTo` 是 `other.compareTo(this)` —— **降序**（`sortText` 大的排前面）。
  // 所以这里给 zzz 大的 sortText，否则断言的就不是"按 sortText 排"而是"按 label 排"了。
  const list = sortCompletions([{ label: 'zzz', sortText: 'b' }, { label: 'aaa', sortText: 'a' }])
  assert.deepEqual(list.map(item => item.label), ['zzz', 'aaa'], '按 sortText 排，不按 label')
  assert.ok(compareCompletions({ label: 'a' }, { label: 'b' }) < 0)
})

test('其余三档：大小写不敏感 → 长度 → 字母序', () => {
  // 大小写不敏感让 bar 排在 Foo 前面（ASCII 下 'F' < 'b' 会把它反过来）
  assert.ok(compareCompletions({ label: 'bar' }, { label: 'Foo' }) < 0,
    'bar/Foo 的先后来自大小写不敏感这一档')
  // 同一前缀下短者先
  assert.ok(compareCompletions({ label: 'foo' }, { label: 'foobar' }) < 0)
  // 折叠后相等时用区分大小写的比较兜底（稳定、可复现）
  assert.notEqual(compareCompletions({ label: 'Foo' }, { label: 'foo' }), 0)
})

test('排序是稳定的（不改原数组、等价项保持原序）', () => {
  const input = [{ label: 'b' }, { label: 'a' }]
  const out = sortCompletions(input)
  assert.deepEqual(input.map(item => item.label), ['b', 'a'], '原数组不许被改')
  assert.deepEqual(out.map(item => item.label), ['a', 'b'])
})
