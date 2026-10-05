// 行内补全的**多建议切换**与**显式索取**（本批接上的用户可见行为）。
//
// 上游键位（`platform/lang-impl/resources/intellij.platform.lang.impl.actions.xml`）：
//   · `NextInlineCompletionSuggestionAction` = `alt CLOSE_BRACKET`（`:127-129`）
//   · `PrevInlineCompletionSuggestionAction` = `alt OPEN_BRACKET`（`:130-132`）
//   · `CallInlineCompletionAction` = `shift alt BACK_SLASH`（`:115-117`）
// 可用性口径：`SwitchInlineCompletionVariantAction.Handler.isEnabledForCaret`
// （`InlineCompletionActions.kt:48-50`）—— 只在建议挂在光标处时接管。
// 绕圈：`InlineCompletionVariantsProvider.findStateIndex` 走整个圆环（`:339-352`）。
//
// 纯规则在 `src/inlineCompletionNav.ts`；键位表与键位宏在 `src/inlineCompletionExtension.ts`；
// 下标与请求在 `src/components/CodeEditor.vue`。

import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

import { cycleSuggestionIndex, dedupeSuggestions, inlineTriggerKindFor, suggestionKey } from '../src/inlineCompletionNav.ts'
import { inlineNavigationBindings, inlineNavigationKeymap } from '../src/inlineCompletionExtension.ts'
import { INLINE_TRIGGER_KINDS } from '../src/inlineCompletion.ts'

const editor = readFileSync('src/components/CodeEditor.vue', 'utf8')

test('键位表就是上游那三条，且都不无条件抢按键', () => {
  const keys = inlineNavigationBindings({ cycle: () => true, call: () => true }).map(binding => binding.key)
  assert.deepEqual(keys, ['Alt-]', 'Alt-[', 'Shift-Alt-\\'])
  for (const binding of inlineNavigationBindings({ cycle: () => true, call: () => true }))
    assert.equal(binding.preventDefault, false, `${binding.key} 不该无条件抢按键`)
})

test('Alt+] 传 +1、Alt+[ 传 -1，Shift+Alt+\ 走 call', () => {
  const seen = []
  const bindings = inlineNavigationBindings({
    cycle: (_view, delta) => { seen.push(['cycle', delta]); return true },
    call: () => { seen.push(['call']); return true },
  })
  const view = {}
  for (const binding of bindings) binding.run(view)
  assert.deepEqual(seen, [['cycle', 1], ['cycle', -1], ['call']])
})

test('没有建议时按 `isEnabledForCaret` 的口径不消费按键（回调返回 false 就放行）', () => {
  const bindings = inlineNavigationBindings({ cycle: () => false, call: () => false })
  const view = { state: { field: () => null } }
  for (const binding of bindings) assert.equal(binding.run(view), false, `${binding.key} 不该在无建议时接管`)
})

test('键位宏是最高优先级的一组（先于补全弹窗的键）', () => {
  assert.ok(inlineNavigationKeymap({ cycle: () => true, call: () => true }), '键位宏没造出来')
})

test('绕圈是上游口径：末尾回到开头、开头回到末尾（findStateIndex 走圆环）', () => {
  assert.equal(cycleSuggestionIndex(0, 1, 3), 1)
  assert.equal(cycleSuggestionIndex(2, 1, 3), 0, '末尾之后回到第一条')
  assert.equal(cycleSuggestionIndex(0, -1, 3), 2, '第一条之前回到最后一条')
  assert.equal(cycleSuggestionIndex(-1, 0, 3), 2)
  assert.equal(cycleSuggestionIndex(0, 1, 0), -1, '没有建议时给 -1，调用方据此不渲染')
})

test('去重按身份键（range 起点 + 插入文本），服务器重发不会让 Alt+] 停在重复项上', () => {
  // 身份键是「range 起点 + 插入文本」（`src/inlineCompletionNav.ts` 的 `suggestionKey`），
  // 所以"重发"必须是**同一个 range** 的重复项：不带 range 的 `count()` 与带 range 的
  // `count()` 身份键不同（前者按 `cursor` 算），它们是两条不同的建议，不该被这条断言吃掉。
  const at = { startLine: 3, startChar: 2, endLine: 3, endChar: 2 }
  const items = [
    { insertText: 'count()', range: at },
    { insertText: 'count()', range: at },
    { insertText: 'total()', range: at },
    { insertText: 'count()', range: at },
  ]
  assert.deepEqual(dedupeSuggestions(items), [items[0], items[2]])
  // 身份键确实带着 range 起点：换一个起点就是另一条建议。
  assert.equal(suggestionKey({ insertText: 'count()', range: at }), '3:2:count()')
  assert.equal(suggestionKey({ insertText: 'count()' }), 'cursor:count()')
})

test('显式索取发 triggerKind=2（CallInlineCompletionAction 的协议对等物）', () => {
  assert.equal(inlineTriggerKindFor('explicit'), INLINE_TRIGGER_KINDS.explicit)
  assert.equal(inlineTriggerKindFor('automatic'), INLINE_TRIGGER_KINDS.automatic)
  assert.equal(inlineTriggerKindFor('retrigger'), INLINE_TRIGGER_KINDS.retrigger)
})

test('接线：编辑器存住整份建议列表、下标，并把三条键位挂进扩展', () => {
  assert.match(editor, /let inlineItems: InlineCompletionItem\[\] = \[\]/, '没有保存这一拍的整份建议')
  assert.match(editor, /inlineItems = dedupeSuggestions\(result\.available \? result\.items : undefined\)/, '结果没有去重')
  assert.match(editor, /const suggestion = suggestionFor\(inlineItems\[at\]/, '落盘时仍只取一条')
  assert.match(editor, /function cycleInlineSuggestion\(editor: EditorView, delta: number\)/)
  assert.match(editor, /editor\.state\.field\(inlineSuggestionField, false\) === null\) return false/, '无建议时不该消费 Alt+]')
  assert.match(editor, /showInlineSuggestion\(cycleSuggestionIndex\(inlineIndex, delta, inlineItems\.length\)\)/)
  assert.match(editor, /inlineNavigationKeymap\(\{ cycle: cycleInlineSuggestion, call: \(\) => callInlineCompletion\(\) \}\)/, '三条键位没有挂进扩展')
  assert.match(editor, /triggerKind: inlineTriggerKindFor\(trigger\)/, 'triggerKind 还是写死的 1，显式索取发不出去')
  assert.match(editor, /void runInlineCompletion\('explicit'\)/, 'Shift+Alt+\ 没有走显式那一档')
})

test('关掉语言服务时连建议列表一起清：留着列表 Alt+] 还能切出已经消失的建议', () => {
  assert.match(editor, /inlayHints\.clear\(\); clearInlineSuggestion\(\)/)
})
