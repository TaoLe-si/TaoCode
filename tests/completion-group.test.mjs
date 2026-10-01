import test from 'node:test'
import assert from 'node:assert/strict'

import { groupCompletions, groupKeyOf, separatorBefore } from '../src/completionGroup.ts'

test('组键 = sortText 的首字符（第一档能区分开的键）；没 sortText 落默认组', () => {
  assert.equal(groupKeyOf({ label: 'a', sortText: '09foo' }), '0')
  assert.equal(groupKeyOf({ label: 'a', sortText: '1bar' }), '1')
  assert.equal(groupKeyOf({ label: 'a' }), '', '没有 sortText ⇒ 默认组')
})

test('同一前缀的候选归一堆，组内顺序保持原样（排序由 sortCompletions 先定）', () => {
  const list = [{ label: 'a', sortText: '09b' }, { label: 'b', sortText: '1x' }, { label: 'c', sortText: '09a' }]
  const groups = groupCompletions(list)
  assert.deepEqual(groups.map(group => group.key), ['0', '1'])
  assert.deepEqual(groups[0].items.map(item => item.label), ['a', 'c'], '组内保持进来的顺序')
})

test('分隔符只在多组时画（单组不加分隔）', () => {
  const one = groupCompletions([{ label: 'a' }, { label: 'b' }])
  assert.equal(separatorBefore(one, 0), false)
  const two = groupCompletions([{ label: 'a', sortText: '0' }, { label: 'b', sortText: '1' }])
  assert.equal(separatorBefore(two, 0), false, '第一组前面不画')
  assert.equal(separatorBefore(two, 1), true)
})
