// 行内补全的导航（`src/inlineCompletionNav.ts`）：多建议循环、部分接受、触发类型、去重。
import test from 'node:test'
import assert from 'node:assert/strict'
import { cycleSuggestion, cycleSuggestionIndex, dedupeSuggestions, inlineTriggerKindFor, nextWordEnd, partialAccept, suggestionKey } from '../src/inlineCompletionNav.ts'

test('循环切换：两端环绕，空列表 -1', () => {
  assert.equal(cycleSuggestionIndex(0, 1, 3), 1)
  assert.equal(cycleSuggestionIndex(2, 1, 3), 0, '最后一条的下一条回到第一条')
  assert.equal(cycleSuggestionIndex(0, -1, 3), 2)
  assert.equal(cycleSuggestionIndex(5, 1, 0), -1)
  const items = [{ insertText: 'a' }, { insertText: 'b' }]
  assert.equal(cycleSuggestion(items, 1, 1)?.insertText, 'a')
  assert.equal(cycleSuggestion([], 0, 1), undefined)
})

test('部分接受：吃掉前导空白 + 下一个词，rest 是剩余', () => {
  assert.equal(nextWordEnd('foo bar'), 3)
  assert.equal(nextWordEnd('  foo()'), 5, '前导空白与词一起')
  assert.equal(nextWordEnd('中文方法('), 4)
  assert.equal(nextWordEnd('()'), 2, '开头不是词就整串吃')
  const accept = partialAccept({ insertText: 'getUser(id)' })
  assert.equal(accept.insert, 'getUser')
  assert.equal(accept.rest, '(id)')
  const second = partialAccept({ insertText: 'getUser(id)' }, accept.insert.length)
  assert.equal(second.insert, 'getUser(id)')
  assert.equal(second.rest, '')
  assert.equal(partialAccept({ insertText: '' }), null)
  assert.equal(partialAccept(undefined), null)
})

test('触发类型：automatic=1 / explicit=2 / retrigger=3', () => {
  assert.equal(inlineTriggerKindFor('automatic'), 1)
  assert.equal(inlineTriggerKindFor('explicit'), 2)
  assert.equal(inlineTriggerKindFor('retrigger'), 3)
})

test('身份键与去重：同区间同文本只留一条，畸形项丢掉', () => {
  const withRange = { insertText: 'x', range: { startLine: 1, startChar: 2, endLine: 1, endChar: 3 } }
  assert.equal(suggestionKey(withRange), '1:2:x')
  assert.equal(suggestionKey({ insertText: 'y' }), 'cursor:y')
  assert.equal(suggestionKey(null), '')
  const items = [withRange, { ...withRange }, { insertText: 'z' }, { insertText: '' }, null]
  assert.deepEqual(dedupeSuggestions(items).map(item => item.insertText), ['x', 'z'])
  assert.deepEqual(dedupeSuggestions(undefined), [])
})
