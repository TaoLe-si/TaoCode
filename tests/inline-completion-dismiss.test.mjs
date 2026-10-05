// 行内补全的 **Esc 收起**（本轮接上的用户可见行为）与它的优先级：
//   · `shouldDismissInlineSuggestion` 是纯判定（`src/inlineCompletion.ts`）；
//   · `inlineCompletionBindings` 是真正挂进编辑器的键位表（`src/inlineCompletionExtension.ts`），
//     这里直接驱动绑定表本身，锁住"Tab 接受 / Esc 收起、且都不吞别人的按键"。
//
// 判定表单独的模块（`tests/inline-completion.test.mjs` 锁的是显示与接受区间）；这个文件锁键位接线。

import test from 'node:test'
import assert from 'node:assert/strict'

import { shouldDismissInlineSuggestion } from '../src/inlineCompletion.ts'
import { inlineCompletionBindings, inlineSuggestionField, setInlineSuggestion } from '../src/inlineCompletionExtension.ts'

test('Esc 判定：有建议且补全弹窗没开才收；否则不消费这次按键', () => {
  assert.equal(shouldDismissInlineSuggestion(true, false), true)
  assert.equal(shouldDismissInlineSuggestion(true, true), false, '弹窗先收')
  assert.equal(shouldDismissInlineSuggestion(false, false), false, '没有建议，Esc 去干别的')
  assert.equal(shouldDismissInlineSuggestion(false, true), false)
})

test('绑定表里有 Tab / Esc / Ctrl+→ 接受下一个词 / End 接受下一行，且都允许按键继续往下传', () => {
  const keys = inlineCompletionBindings.map(binding => binding.key).sort()
  assert.deepEqual(keys, ['Ctrl-ArrowRight', 'End', 'Escape', 'Tab'])
  for (const binding of inlineCompletionBindings)
    assert.equal(binding.preventDefault, false, `${binding.key} 不该无条件抢按键`)
})

test('Esc 绑定：没有建议时返回 false；有建议时收掉并返回 true', () => {
  const escape = inlineCompletionBindings.find(binding => binding.key === 'Escape')
  const dispatched = []
  // 假 view：控制器只碰 `state.field`（要按 field 身份回答）与 `dispatch`（真实 EditorState 在这里不需要）。
  const makeView = suggestion => ({
    state: { field: field => (field === inlineSuggestionField ? suggestion : null) },
    dispatch: spec => { dispatched.push(spec) },
  })
  assert.equal(escape.run(makeView(null)), false, '没有建议 → 不消费')
  assert.equal(dispatched.length, 0)
  const suggestion = { text: 'count()', insertText: 'count()', span: { startLine: 0, startChar: 0, endLine: 0, endChar: 0 } }
  assert.equal(escape.run(makeView(suggestion)), true, '有建议 → 收起')
  assert.equal(dispatched.length, 1)
  const effect = dispatched[0].effects
  assert.equal(effect.is(setInlineSuggestion), true, '派发的是"清空建议"这一个 effect')
  assert.equal(effect.value, null)
})
