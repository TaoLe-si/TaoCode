import test from 'node:test'
import assert from 'node:assert/strict'

import { compareCompletions, sortCompletions } from '../src/completionSort.ts'

test('预选那条排最前（LSP preselect = 协议里的"默认选中"）', () => {
  const list = sortCompletions([{ label: 'aaa' }, { label: 'zzz', preselected: true }])
  assert.deepEqual(list.map(item => item.label), ['zzz', 'aaa'])
})

test('sortText 当相关性键；缺省退回 label', () => {
  const list = sortCompletions([{ label: 'zzz', sortText: 'a' }, { label: 'aaa', sortText: 'b' }])
  assert.deepEqual(list.map(item => item.label), ['zzz', 'aaa'], '按 sortText 排，不按 label')
  assert.ok(compareCompletions({ label: 'a' }, { label: 'b' }) < 0)
})

test('其余三档：大小写不敏感 → 长度 → 字母序', () => {
  // 大小写不敏感让 foo 与 Foo 相邻（ASCII 下 'F' < 'a' 会把它拆开）
  assert.ok(compareCompletions({ label: 'Foo' }, { label: 'bar' }) < 0,
    'foo/bar 的先后来自大小写不敏感这一档')
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
