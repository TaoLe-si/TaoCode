// 行内补全的**部分接受**（IDEA `InsertInlineCompletionWordAction` / `InsertInlineCompletionLineAction`）：
//   · 粒度纯规则在 `src/inlineCompletion.ts`（`inlinePartialAcceptLength` / `truncateSuggestion`）；
//   · 键位（Ctrl+→ 按词、End 按行）与命令在 `src/inlineCompletionExtension.ts`。
// 上游：`InlineCompletionPartialAcceptHandlerImpl.kt:200-225`（word = 移到下一个词尾；line = 取到换行），
// `intellij.platform.lang.impl.actions.xml:121-126`（两个动作 use-shortcut-of EditorNextWord / EditorLineEnd）。
import test from 'node:test'
import assert from 'node:assert/strict'

import { inlinePartialAcceptLength, truncateSuggestion } from '../src/inlineCompletion.ts'
import { nextWordEnd, partialAccept } from '../src/inlineCompletionNav.ts'
import { acceptInlineSuggestionPartially, inlineCompletionBindings, inlineSuggestionField, setInlineSuggestion } from '../src/inlineCompletionExtension.ts'

test('按词：跨过前导空白后走完一个词；没有词时等于整段接受', () => {
  assert.equal(inlinePartialAcceptLength('count()', 'word'), 5)
  assert.equal(inlinePartialAcceptLength('  count()', 'word'), 7, '前导空白一起吃掉')
  assert.equal(inlinePartialAcceptLength('foo.bar', 'word'), 3, '点号停住，下一次接受再处理')
  assert.equal(inlinePartialAcceptLength('()', 'word'), 2, '没有下一个词尾，停点就是文本末尾')
  assert.equal(inlinePartialAcceptLength('\n    foo', 'word'), 8, '空白（含换行）与词一起（WORD_END 停点）')
  assert.equal(inlinePartialAcceptLength('   ', 'word'), 3, '全是空白时吃完（没有词可停）')
  assert.equal(inlinePartialAcceptLength('', 'word'), 0)
})

test('词规则与 src/inlineCompletionNav.ts 的 nextWordEnd 同口径（两份定义不许漂移）', () => {
  for (const text of ['count()', '  count()', 'foo.bar', '()', '中文方法(', '   ', 'x', '\n  foo'])
    assert.equal(inlinePartialAcceptLength(text, 'word'), nextWordEnd(text), JSON.stringify(text))
  const item = { insertText: 'count()' }
  assert.equal(partialAccept(item)?.insert, 'count')
})

test('按行：取到换行之前；补全以换行开头时吃掉这个换行', () => {
  assert.equal(inlinePartialAcceptLength('first line\nsecond', 'line'), 10)
  assert.equal(inlinePartialAcceptLength('\nsecond', 'line'), 1)
  assert.equal(inlinePartialAcceptLength('no newline', 'line'), 10, '单行建议一次全接受（上游 handler.insert()）')
  assert.equal(inlinePartialAcceptLength('', 'line'), 0)
})

test('剩余建议：削掉前缀、幽灵文本落在新光标处，接受区间是零宽', () => {
  const suggestion = { text: 'count()', insertText: 'count()', span: { startLine: 2, startChar: 4, endLine: 2, endChar: 4 } }
  const rest = truncateSuggestion(suggestion, 5)
  assert.deepEqual(rest, { text: '()', insertText: '()', span: { startLine: 2, startChar: 9, endLine: 2, endChar: 9 } })
})

test('剩余建议：显示文本与插入文本不同源时，削不动就回落到剩余插入文本', () => {
  const suggestion = { text: 'display-only', insertText: 'count()', span: { startLine: 0, startChar: 0, endLine: 0, endChar: 0 } }
  assert.deepEqual(truncateSuggestion(suggestion, 5)?.text, '()')
})

test('前缀吃掉整段（或带换行）时不返回剩余建议 —— 调用方走整段接受', () => {
  const suggestion = { text: 'ab', insertText: 'ab', span: { startLine: 0, startChar: 0, endLine: 0, endChar: 0 } }
  assert.equal(truncateSuggestion(suggestion, 2), null)
  assert.equal(truncateSuggestion(suggestion, 0), null)
  const multiline = { text: 'a\nb', insertText: 'a\nb', span: { startLine: 0, startChar: 0, endLine: 0, endChar: 0 } }
  assert.equal(truncateSuggestion(multiline, 2), null, '前缀带换行时坐标不能简单平移')
})

test('键位：Ctrl+→ 按词、End 按行，都挂在行内补全的键位表里', () => {
  const word = inlineCompletionBindings.find(binding => binding.key === 'Ctrl-ArrowRight')
  const line = inlineCompletionBindings.find(binding => binding.key === 'End')
  assert.ok(word, 'Ctrl+→ 必须在表里')
  assert.ok(line, 'End 必须在表里')
  assert.equal(word.preventDefault, false)
  assert.equal(line.preventDefault, false)
})

test('命令：没有建议时返回 false（按键继续走普通的词/行导航）', () => {
  const view = fakeView(null, 'count()')
  assert.equal(acceptInlineSuggestionPartially(view, 'word'), false)
})

test('命令：部分接受后剩下的建议仍在，且光标落在插入前缀之后', () => {
  const view = fakeView({ text: 'count()', insertText: 'count()', span: { startLine: 0, startChar: 0, endLine: 0, endChar: 0 } }, 'count()')
  assert.equal(acceptInlineSuggestionPartially(view, 'word'), true)
  assert.equal(view.dispatched.length, 1)
  const spec = view.dispatched[0]
  assert.deepEqual(spec.changes, { from: 0, to: 0, insert: 'count' })
  assert.deepEqual(spec.selection, { anchor: 5 })
  const effect = spec.effects
  assert.equal(effect.is(setInlineSuggestion), true)
  assert.deepEqual(effect.value, { text: '()', insertText: '()', span: { startLine: 0, startChar: 5, endLine: 0, endChar: 5 } })
})

test('命令：前缀覆盖整段时等价于整段接受并清掉建议', () => {
  const view = fakeView({ text: 'ab', insertText: 'ab', span: { startLine: 0, startChar: 0, endLine: 0, endChar: 0 } }, 'ab')
  assert.equal(acceptInlineSuggestionPartially(view, 'line'), true, '单行建议按行 = 全接受')
  const spec = view.dispatched[0]
  assert.deepEqual(spec.changes, { from: 0, to: 0, insert: 'ab' })
  assert.equal(spec.effects.value, null, '整段接受后建议清空')
})

/** 单行文档的最小假 view：只需 field / doc.lineAt / doc.lines / dispatch。 */
function fakeView(suggestion, docText) {
  const line = { from: 0, to: docText.length, number: 1 }
  return {
    state: {
      doc: { lines: 1, length: docText.length, lineAt: () => line, line: () => line },
      field: field => (field === inlineSuggestionField ? suggestion : null),
    },
    dispatched: [],
    dispatch(spec) { this.dispatched.push(spec) },
  }
}
