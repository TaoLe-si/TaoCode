// 自动弹出补全的**触发条件**（`lp/editor-actions` 的 `CompletionAutoPopupHandler` /
// `TypedAutoPopupImpl` / `CompletionPhase.EmptyAutoPopup` 一族）在 `src/completionAutoPopup.ts`
// 里被移植，并在 `src/lspCompletion.ts` 的自动档上真的生效。
//
// 上游坐标（逐行开过）：`CompletionAutoPopupHandler.java:36-49`（查过 lookup 的那一档 + 字母数字
// 下划线 ⇒ `scheduleAutoPopup`）、`TypedAutoPopupImpl.java:30-37`（`.` ⇒ 弹；`/` 只在
// `ALLOW_AUTO_POPUP_FOR_SLASHES_IN_PATHS` 为真时弹）与 `:39-48`（`(`/`,` 是**参数提示**那条通道，
// 本仓没有）、`CompletionPhase.kt:588-614`（`EmptyAutoPopup.allowsSkippingNewAutoPopup` 三条闸）、
// `ActionTracker.kt:80-87`（`hasAnythingHappened`）、`CompletionProgressIndicator.java:899-918`
// （`shouldRestartCompletion`）、`:786-807`（`hideAutopopupIfMeaningless` + `isAlreadyInTheEditor`）、
// `CommandCompletionProvider.kt:263-280`（命令补全登记的两条重启条件）。
//
// 判据打两层：① 纯规则（含上游那几条判据的边界）；② 端到端 —— 用真 `EditorState` + 真源函数
// （`createLspCompletion`）确认「敲 `)` 一次请求都不发」「显式调用不受触发字符闸管」
// 「空结果之后继续打字不重查、动过光标就重查」。
import test from 'node:test'
import assert from 'node:assert/strict'
import { EditorState } from '@codemirror/state'
import { CompletionContext } from '@codemirror/autocomplete'
import { createLspCompletion } from '../src/lspCompletion.ts'
import {
  autoPopupKind, autoPopupMeaningless, commandRestartConditions, emptyAutoPopupAllowsSkipping,
  isAlreadyInTheEditor, shouldRestartCompletion, worthShowingInAutoPopup,
} from '../src/completionAutoPopup.ts'

// ── ① 触发字符那两档（`CompletionAutoPopupHandler.java:43` / `TypedAutoPopupImpl.java:31-32`） ──

test('触发字符：字母/数字/下划线 = word，`.` = member，其余一律 none', () => {
  for (const ch of ['a', 'Z', '0', '9', '_', '方', 'é']) {
    assert.equal(autoPopupKind(ch), 'word', `${ch} 该是 word（Character.isLetterOrDigit || '_'）`)
  }
  assert.equal(autoPopupKind('.'), 'member', '点是成员补全的触发字符（TypedAutoPopupImpl.java:31）')
  for (const ch of [')', ';', '(', ',', '"', ' ', '', '\n', '}']) {
    assert.equal(autoPopupKind(ch), 'none', `${JSON.stringify(ch)} 不排自动弹出`)
  }
})

test('斜杠只在 ALLOW_AUTO_POPUP_FOR_SLASHES_IN_PATHS 那一档才算触发（代码编辑器不置它）', () => {
  assert.equal(autoPopupKind('/'), 'none', '默认档：`/` 不弹（TypedAutoPopupImpl.java:32 的 user data 只是 Swing 文本框置的）')
  assert.equal(autoPopupKind('/', { allowSlash: true }), 'member')
})

// ── ② 「你已经打出来的那个词」那一档（`CompletionProgressIndicator.java:786-807`） ──────────────

test('isAlreadyInTheEditor：光标前 prefixLength 处开始就是候选文本（`:798-805`）', () => {
  assert.equal(isAlreadyInTheEditor('value', 3, 3, 'value'), true, 'doc[0..] = "value"，光标在 3')
  assert.equal(isAlreadyInTheEditor('value', 3, 3, 'valueOf'), false, '候选比正文长 ⇒ 不算已在编辑器里')
  assert.equal(isAlreadyInTheEditor('value', 3, 2, 'value'), false, '前缀长度 2 ⇒ start=1，"alue" 不以 "value" 开头')
  assert.equal(isAlreadyInTheEditor('value', 1, 3, 'value'), false, 'start 为负 ⇒ 不算（上游 `start >= 0`）')
  assert.equal(isAlreadyInTheEditor('value', 5, 0, ''), false, '空 lookupString 不算')
})

test('值得在自动弹出里显示 = 有尾部灰字（LookupElement.java:174-177 的默认实现）', () => {
  assert.equal(worthShowingInAutoPopup('int'), true)
  assert.equal(worthShowingInAutoPopup(''), false)
  assert.equal(worthShowingInAutoPopup(undefined), false)
  assert.equal(worthShowingInAutoPopup('   '), false)
})

test('整层无意义：每条都已在编辑器里且都不值得显示（`:786-799` 的两条 return false）', () => {
  const items = [{ lookupString: 'value' }]
  assert.equal(autoPopupMeaningless(items, 'value', 3, 3), true, '唯一候选就是你已经输入的那个词 ⇒ 藏层')
  assert.equal(autoPopupMeaningless([{ lookupString: 'value', detail: 'String' }], 'value', 3, 3), false,
    '有 detail（尾部灰字）⇒ 值得显示，不藏（Java 方法参数那一档）')
  assert.equal(autoPopupMeaningless([{ lookupString: 'valueOf' }], 'value', 3, 3), false, '有一条不在编辑器里 ⇒ 不藏')
  assert.equal(autoPopupMeaningless([], 'value', 3, 3), false, '空表不是这一档（那是 count == 0）')
})

// ── ③ 前缀重启条件（`shouldRestartCompletion` + `CommandCompletionProvider.kt:263-280`） ────────

test('shouldRestartCompletion：取 doc[start..caret) + 新字符去 match（`:899-918`）', () => {
  const conditions = [{ start: 3, endsWith: '..' }]
  assert.equal(shouldRestartCompletion('foo.b', 5, 'x', conditions), false, '前缀 ".b" 不以 ".." 结尾')
  assert.equal(shouldRestartCompletion('foo..', 5, '', conditions), true, '前缀就是 ".." ⇒ 命中')
  assert.equal(shouldRestartCompletion('foo..', 5, 'x', conditions), false, '"..x" 不以 ".." 结尾（toAppend 也要进前缀）')
  assert.equal(shouldRestartCompletion('foo', 3, 'x', [{ start: 9, endsWith: '..' }]), false, 'start 越过光标 ⇒ 该条不参与')
  assert.equal(shouldRestartCompletion('foo', 3, 'x', []), false, '没有条件 ⇒ 不重启')
  assert.equal(shouldRestartCompletion('foo', 3, 'x', undefined), false, '条件缺省 ⇒ 不重启')
})

test('命令补全登记的两条条件：endsWith(fullSuffix) + startsWith(调用后缀) 时的 equalTo（:271-279）', () => {
  const partial = commandRestartConditions({ suffix: '.', start: 3 })
  assert.deepEqual(partial, [{ start: 3, endsWith: '..' }, { start: 3, equals: '.' }])
  const full = commandRestartConditions({ suffix: '..', start: 3 })
  assert.deepEqual(full, [{ start: 3, endsWith: '..' }, { start: 3, equals: '' }],
    '全后缀档：patternToRestart = ".." - ".." = ""（上游同样是空串条件，实际不命中）')
  const line = commandRestartConditions({ suffix: '', start: 3 })
  assert.deepEqual(line, [{ start: 3, endsWith: '..' }, { start: 3, equals: '..' }])
  const readOnly = commandRestartConditions({ suffix: '.', start: 3 }, { readOnly: true })
  assert.deepEqual(readOnly, [{ start: 3, endsWith: '..' }, { start: 3, equals: '' }],
    '只读档 patternToCheck 取 filterSuffix（:275）')
})

// ── ④ 空结果那一档的三条闸（`CompletionPhase.kt:602-608`） ──────────────────────────────────────

/** 造一条「上一拍空结果」的记录 + 这一拍的输入（`Text` 用真 `EditorState` 造，避免手搓文档对象）。 */
function emptyRecord(doc, caret, restart = []) {
  return { path: 'src/Main.java', doc: EditorState.create({ doc }).doc, caret, restart }
}
function check(doc, caret, toType, path = 'src/Main.java') {
  return { path, doc: EditorState.create({ doc }).doc, caret, toType }
}

test('空结果之后继续打字：文档/光标只差这一个字符 ⇒ 跳过重查', () => {
  const record = emptyRecord('foo.b', 5)
  assert.equal(emptyAutoPopupAllowsSkipping(record, check('foo.ba', 6, 'a')), true, '只多敲了一个字母 ⇒ 跳过')
  assert.equal(emptyAutoPopupAllowsSkipping(null, check('foo.ba', 6, 'a')), false, '没有记录 ⇒ 不跳过')
  assert.equal(emptyAutoPopupAllowsSkipping(record, check('foo.ba', 6, 'a', 'src/Other.java')), false, '换了文件 ⇒ 不跳过')
  assert.equal(emptyAutoPopupAllowsSkipping(record, check('foo.bX', 5, 'X')), false, '光标没前进（插在光标后）⇒ 不跳过')
  assert.equal(emptyAutoPopupAllowsSkipping(record, check('foo.baZ', 6, 'a')), false, '正文别处也变了 ⇒ 不跳过')
  assert.equal(emptyAutoPopupAllowsSkipping(record, check('foo.b\na', 6, 'a')), false, '插了换行 ⇒ 不跳过')
  assert.equal(emptyAutoPopupAllowsSkipping(record, check('foo.ba', 6, '')), false, '没有新字符这一档不适用')
})

test('前缀命中重启条件 ⇒ 不跳过（第二条点一敲就把命令补全重新拉起来）', () => {
  // 上一拍：`foo.` 的成员补全查到空，这一轮登记的重启条件是命令补全那两条（start = 点的位置 4）。
  const restart = commandRestartConditions({ suffix: '.', start: 4 })
  const record = emptyRecord('foo.', 4, restart)
  assert.equal(emptyAutoPopupAllowsSkipping(record, check('foo.b', 5, 'b')), true, '普通字母：前缀 ".b" 不命中 ⇒ 继续跳过')
  assert.equal(emptyAutoPopupAllowsSkipping(record, check('foo..', 5, '.')), false, '第二个点：前缀 ".." 命中 endsWith ⇒ 必须重查')
})

// ── ⑤ 端到端：真源函数上的自动档 ────────────────────────────────────────────────────────────────

/** 一个假 view（与 tests/lsp-completion.test.mjs 同一套：EditorState + dispatch，不需要 DOM）。 */
function fakeEditor(doc, head) {
  const view = { state: EditorState.create({ doc, selection: { anchor: head ?? doc.length } }) }
  view.dispatch = spec => { view.state = view.state.update(spec).state }
  return view
}

/** 起一个真源函数；`send` 收下每一次请求。 */
function completionSource(doc, send, head) {
  const view = fakeEditor(doc, head)
  const calls = []
  const source = createLspCompletion({
    enabled: () => true, path: () => 'src/Main.java', view: () => view,
    request: async (method, params) => { calls.push({ method, params }); return send(method, params) },
    sync: async () => ({}), reportError: () => {},
  })
  return { view, calls, source }
}

test('端到端：非触发字符（`)` / `;`）在自动档一次请求都不发', async () => {
  for (const char of [')', ';', '(']) {
    const doc = `foo${char}`
    const h = completionSource(doc, async () => ({ available: true, items: [{ label: 'x', kind: 'method' }] }))
    const result = await h.source(new CompletionContext(h.view.state, doc.length, false))
    assert.equal(result, null, `${char} 不该弹`)
    assert.deepEqual(h.calls, [], `${char} 不该发请求（CompletionAutoPopupHandler.java:43-49 只认两档字符）`)
  }
})

test('端到端：显式调用（Ctrl+Space）不受触发字符闸管', async () => {
  const doc = 'foo)'
  const h = completionSource(doc, async () => ({ available: true, items: [{ label: 'x', kind: 'method' }] }))
  const result = await h.source(new CompletionContext(h.view.state, doc.length, true))
  assert.ok(result, '显式调用走 CompletionPhase，不经过 TypedHandler ⇒ 必须照常查')
  assert.deepEqual(h.calls.map(call => call.params.kind), ['completion'], '请求真的发出去了')
})

test('端到端：空结果之后继续打字不再重查；动过光标立刻重查', async () => {
  // 服务端一条候选都不给（`available: true, items: []`）⇒ 本仓的空表档（占位行），
  // 同时应记进 EmptyAutoPopup 那一档（上游 `:765-770` 的 count == 0）。
  const h = completionSource('foo.b', async () => ({ available: true, items: [] }))
  const first = await h.source(new CompletionContext(h.view.state, 5, false))
  assert.ok(first, '空表仍返回一行占位（本仓与上游的如实差异，写在 src/lspCompletion.ts 的注释里）')
  const afterFirst = h.calls.length
  assert.equal(afterFirst, 1, '第一次真发了补全请求')
  assert.equal(h.calls[0].params.kind, 'completion')
  // 继续打字：正文只多一个字母、光标前进一格 ⇒ 这一拍不查（`CompletionPhase.kt:602-608`）。
  h.view.dispatch({ changes: { from: 5, insert: 'a' } })
  const second = await h.source(new CompletionContext(h.view.state, 6, false))
  assert.equal(second, null, '空结果之后继续打字不重查')
  assert.equal(h.calls.length, afterFirst, '一条新请求都不该发')
  // 光标动到别处（正文没变）⇒ 文档/光标对账不过 ⇒ 重查。
  h.view.dispatch({ selection: { anchor: 4 } })
  h.view.dispatch({ changes: { from: 6, insert: 'b' } })
  await h.source(new CompletionContext(h.view.state, 7, false))
  assert.ok(h.calls.length > afterFirst, '动过光标之后要重新查')
})

test('端到端：`.` 触发成员补全（含服务端条目照常返回）', async () => {
  const item = { label: 'println', kind: 'method', raw: { label: 'println', data: { id: 1 } } }
  const h = completionSource('System.', async () => ({ available: true, items: [item] }))
  const result = await h.source(new CompletionContext(h.view.state, 7, false))
  assert.ok(result, '`.` 是触发字符（TypedAutoPopupImpl.java:31）')
  assert.deepEqual(result.options.map(option => option.label), ['println'])
})

test('端到端：显式档的空结果**不**进 EmptyAutoPopup —— 随后自动档的第一下敲键照常重查', async () => {
  // 上游这一格由 `CompletionProgressIndicator.isAutopopupCompletion()` 分开：显式档的空表走
  // `:961-977` 的 `handleEmptyLookup`（弹「无建议」），**不进** `EmptyAutoPopup` 这条 phase；
  // 只有自动档的 `count == 0`（`:762-776`）才建这条 phase。记错了会让一次 Ctrl+Space 的空结果
  // 把后面自动档的第一下敲键吞掉（`EmptyAutoPopup` 只看文档/光标，分不出来源）。
  const h = completionSource('foo.b', async () => ({ available: true, items: [] }), 5)
  const explicitResult = await h.source(new CompletionContext(h.view.state, 5, true))
  assert.ok(explicitResult, '显式档照常给占位行（`:961-977` 那一档，不是 EmptyAutoPopup）')
  const afterExplicit = h.calls.length
  assert.equal(afterExplicit, 1, '显式调用真发了补全请求')
  // 继续敲一个字母（自动档）：因为上一拍是**显式**档，这一下必须重新问源。
  h.view.dispatch({ changes: { from: 5, insert: 'a' } })
  const auto = await h.source(new CompletionContext(h.view.state, 6, false))
  assert.equal(h.calls.length, afterExplicit + 1, '显式档的空结果不该把自动档的第一下敲键吞掉（上游此时要重弹）')
  assert.ok(auto, '自动档照常查（哪怕这一拍也查到空）')
})
