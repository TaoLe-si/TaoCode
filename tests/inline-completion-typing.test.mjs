// 行内补全的**打字续接**：用户照着幽灵文本打字时，建议不该失效，而是削掉已打出的那个字符。
//
// 上游 `InlineCompletionSuggestionUpdateManager.isValidTyping`（`:229-236`）：
// `TypingEvent.OneSymbol` 且 `textToInsert.startsWith(typed)` → 保留建议并 `truncateFirstSymbol`
// （`:239-253`）；对不上（或删除/粘贴）→ 作废。纯规则在 `src/inlineCompletion.ts`，
// 落点是 `src/inlineCompletionExtension.ts` 的 `inlineSuggestionField.update`。
import test from 'node:test'
import assert from 'node:assert/strict'
import { EditorState } from '@codemirror/state'

import { advanceSuggestionOnTyping } from '../src/inlineCompletion.ts'
import { inlineSuggestionField, setInlineSuggestion } from '../src/inlineCompletionExtension.ts'

const zeroWidth = (line, char) => ({ startLine: line, startChar: char, endLine: line, endChar: char })
const suggestion = (text, insertText = text, span = zeroWidth(0, 2)) => ({ text, insertText, span })

test('打中建议的下一个字符：建议缩短一个字符，接受区间跟着光标右移一格', () => {
  const advanced = advanceSuggestionOnTyping(suggestion('unt()'), 'u')
  assert.deepEqual(advanced, { text: 'nt()', insertText: 'nt()', span: zeroWidth(0, 3) })
})

test('显示文本与插入文本不同源时都要求以该字符开头', () => {
  const filtered = { text: 'unt()', insertText: 'count()', span: zeroWidth(0, 2) }
  assert.equal(advanceSuggestionOnTyping(filtered, 'u'), null, 'insertText 不是 u 开头 → 不猜，作废')
  const aligned = { text: 'count()', insertText: 'count()', span: zeroWidth(0, 2) }
  assert.deepEqual(advanceSuggestionOnTyping(aligned, 'c'), { text: 'ount()', insertText: 'ount()', span: zeroWidth(0, 3) })
})

test('对不上、不是单字符、打完最后一段都返回 null（= 按旧行为作废）', () => {
  assert.equal(advanceSuggestionOnTyping(suggestion('count()'), 'x'), null)
  assert.equal(advanceSuggestionOnTyping(suggestion('count()'), ''), null)
  assert.equal(advanceSuggestionOnTyping(suggestion('count()'), 'co'), null, '一次输入多个字符不猜')
  assert.equal(advanceSuggestionOnTyping(suggestion('c'), 'c'), null, '整段都打完了，幽灵文本收场')
  assert.equal(advanceSuggestionOnTyping(null, 'c'), null)
})

test('带 range 的建议不续接（坐标随打字移动，交给下一次请求重算）', () => {
  const ranged = suggestion('unt()', 'unt()', { startLine: 0, startChar: 1, endLine: 0, endChar: 2 })
  assert.equal(advanceSuggestionOnTyping(ranged, 'u'), null)
})

test('state field：打字命中时保留并缩短；不命中/粘贴/移动光标时清掉', () => {
  const base = () => EditorState.create({ doc: 'co', extensions: [inlineSuggestionField] })
  const withSuggestion = state => state.update({
    effects: setInlineSuggestion.of(suggestion('unt()')),
  }).state
  const type = (state, text) => state.update({
    changes: { from: 2, to: 2, insert: text },
    selection: { anchor: 2 + text.length },
  }).state

  let state = withSuggestion(base())
  state = type(state, 'u')
  const kept = state.field(inlineSuggestionField)
  assert.equal(kept.insertText, 'nt()', '命中的字符不该让建议消失')
  assert.equal(kept.span.startChar, 3, '剩余建议显示在新光标处')

  // 不命中的字符：作废（等价于旧行为）。
  let missed = withSuggestion(base())
  missed = type(missed, 'x')
  assert.equal(missed.field(inlineSuggestionField), null)

  // 多字符（粘贴）：不猜，作废。
  let pasted = withSuggestion(base())
  pasted = type(pasted, 'unt')
  assert.equal(pasted.field(inlineSuggestionField), null)

  // 删除：作废。
  const deleted = withSuggestion(EditorState.create({ doc: 'cou', extensions: [inlineSuggestionField] }))
    .update({ changes: { from: 2, to: 3 } }).state
  assert.equal(deleted.field(inlineSuggestionField), null)

  // 只移动光标（没改文档）：作废。
  const moved = withSuggestion(base()).update({ selection: { anchor: 1 } }).state
  assert.equal(moved.field(inlineSuggestionField), null)
})
