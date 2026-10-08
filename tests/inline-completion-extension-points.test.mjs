// 判据 · **行内补全的扩展点**（`src/inlineCompletionExtensionPoints.ts`，上游
// `InlineCompletionProvider` / `InlineCompletionPartialAcceptHandler` /
// `InlineCompletionSuppressStateSupplier` 一族）。
//
// 钉四件事：
//   ① 三条 EP 的 id 与上游各自的 `ExtensionPointName.create`（文件头逐行出处）逐字一致，且已声明；
//   ② 贡献者按 id 注册/注销生效；`selectInlineProvider` 按注册序取第一个 `isEnabled` 且支持该文件的；
//   ③ 消费面真的读 EP：`inlineSuggestionFor` / `inlineShouldRestart` / `inlineSuppressed`
//      （任一为真即抑制）/ `inlinePartialAcceptLengthFor`；
//   ④ LSP 那条 bundled 贡献（`lsp.inlineCompletion`）挂上后被 `selectInlineProvider` 选中并取到建议。
import test from 'node:test'
import assert from 'node:assert/strict'

import { EXTENSIONS } from '../src/extensionPoints.ts'
import {
  INLINE_COMPLETION_PROVIDER_EP,
  INLINE_PARTIAL_ACCEPT_HANDLER_EP,
  INLINE_SUPPRESS_STATE_SUPPLIER_EP,
  LSP_INLINE_PROVIDER_ID,
  inlineCompletionProviders,
  inlineItemOf,
  inlinePartialAcceptLengthFor,
  inlineShouldRestart,
  inlineSuggestionFor,
  inlineSuppressed,
  registerInlineCompletionProvider,
  registerInlinePartialAcceptHandler,
  registerInlineSuppressStateSupplier,
  registerLspInlineCompletionProvider,
  selectInlineProvider,
} from '../src/inlineCompletionExtensionPoints.ts'

const req = (over = {}) => ({ path: 'src/A.ts', language: 'typescript', line: 3, character: 5, reason: 'automatic', textBeforeCaret: 'const x = ', ...over })

test('三条 EP 已声明，id 与上游 qualifiedName 逐字一致', () => {
  assert.equal(INLINE_COMPLETION_PROVIDER_EP, 'com.intellij.inline.completion.provider')
  assert.equal(INLINE_PARTIAL_ACCEPT_HANDLER_EP, 'com.intellij.inline.completion.partial.accept.handler')
  assert.equal(INLINE_SUPPRESS_STATE_SUPPLIER_EP, 'com.intellij.inline.completion.suppress.state.supplier')
  for (const id of [INLINE_COMPLETION_PROVIDER_EP, INLINE_PARTIAL_ACCEPT_HANDLER_EP, INLINE_SUPPRESS_STATE_SUPPLIER_EP]) {
    assert.equal(EXTENSIONS.hasExtensionPoint(id), true, `${id} 未声明`)
  }
})

test('provider 按注册序选第一个 enabled 且支持该文件的', () => {
  const disabled = registerInlineCompletionProvider({
    id: { id: 'demo.disabled' }, isEnabled: () => false, getSuggestion: () => ({ insertText: 'no' }),
  })
  const tsOnly = registerInlineCompletionProvider({
    id: { id: 'demo.ts' }, supportedExtensions: ['.ts'], isEnabled: () => true, getSuggestion: () => ({ insertText: 'ts' }),
  })
  try {
    assert.ok(inlineCompletionProviders().some(p => p.id.id === 'demo.disabled'))
    assert.equal(selectInlineProvider(req()).id.id, 'demo.ts', 'disabled 的跳过、TS 文件选中 tsOnly')
    assert.equal(selectInlineProvider(req({ path: 'src/A.py' })), null, '不支持的文件类型不选中')
  } finally {
    disabled.dispose(); tsOnly.dispose()
  }
  assert.equal(inlineCompletionProviders().some(p => p.id.id === 'demo.ts'), false)
})

test('取建议 / 重触发 / 部分接受长度被消费面读到', async () => {
  const provider = registerInlineCompletionProvider({
    id: { id: 'demo.p' }, isEnabled: () => true,
    restartOn: r => r.reason === 'retrigger',
    getSuggestion: () => ({ insertText: 'hello world' }),
  })
  const handler = registerInlinePartialAcceptHandler({
    id: 'demo.partial', isApplicable: s => s.insertText.includes(' '),
    getTextLengthToReplace: s => s.insertText.indexOf(' ') + 1,
  })
  try {
    const suggestion = await inlineSuggestionFor(req())
    assert.deepEqual(suggestion, { insertText: 'hello world' })
    assert.equal(inlineShouldRestart(req({ reason: 'retrigger' })), true)
    assert.equal(inlineShouldRestart(req()), false)
    assert.equal(inlinePartialAcceptLengthFor(suggestion, req()), 'hello '.length, '处理器给的按词长度')
  } finally {
    provider.dispose(); handler.dispose()
  }
  assert.equal(await inlineSuggestionFor(req()), null)
  assert.equal(inlinePartialAcceptLengthFor({ insertText: 'abcd' }, req()), 4, '无处理器时退回整段长度')
})

test('抑制状态任一为真即抑制', () => {
  const a = registerInlineSuppressStateSupplier({ id: 'demo.sup.false', isSuppressed: () => false })
  const b = registerInlineSuppressStateSupplier({ id: 'demo.sup.true', isSuppressed: r => r.language === 'python' })
  try {
    assert.equal(inlineSuppressed(req()), false)
    assert.equal(inlineSuppressed(req({ language: 'python' })), true)
  } finally {
    a.dispose(); b.dispose()
  }
  assert.equal(inlineSuppressed(req({ language: 'python' })), false)
})

test('LSP bundled 贡献挂上后被选中并取到建议；inlineItemOf 折成幽灵文本条目', async () => {
  const calls = []
  const dispose = registerLspInlineCompletionProvider(
    request => { calls.push(request.path); return { insertText: 'suggestion' } },
  )
  try {
    assert.ok(inlineCompletionProviders().some(p => p.id.id === LSP_INLINE_PROVIDER_ID))
    const picked = selectInlineProvider(req())
    assert.equal(picked.id.id, LSP_INLINE_PROVIDER_ID)
    const suggestion = await inlineSuggestionFor(req())
    assert.deepEqual(suggestion, { insertText: 'suggestion' })
    assert.deepEqual(calls, ['src/A.ts'])

    const item = inlineItemOf(suggestion, req())
    assert.equal(item.insertText, 'suggestion')
    assert.deepEqual(item.range, { startLine: 3, startChar: 5, endLine: 3, endChar: 5 })
  } finally { dispose() }
  assert.equal(selectInlineProvider(req()), null)
})
