// 回车那一族的**三把开关**是否真的接进行为（`lp/editor-actions` 判决第②条）。
//
// 判据问的不是「模块里有没有 `if`」，而是**用户能看见的那一层**：关掉 ⇒ 行为必须变。
// 本仓的编辑器挂着 `basicSetup`（`src/components/CodeEditor.vue:3`），它自带
// `closeBrackets()`（`node_modules/codemirror/dist/index.js:61`），而 closeBrackets 是一个
// **inputHandler**（`node_modules/@codemirror/autocomplete/dist/index.js:1830-1832` = `[inputHandler, bracketState]`，
// `:1844-1856` 的 inputHandler 对任何用户输入调 `insertBracket`（`:1851`），`:1795` 的 `defaults.brackets` 含 `"`，
// `:1990-1994` 的 `handleSame` 补出 `""`）⇒ 键位 `return false`（= 「本模块不接管」）**不等于**
// 「文档里只多一个引号」：放行给 CodeMirror 之后它照样补一对。上游没有这层兜底 ——
// `TypedQuoteImpl.java:66-68` 关掉开关就是普通输入。
//
// 上游三把开关（`platform/analysis-impl/src/com/intellij/codeInsight/CodeInsightSettings.java`，
// 默认值 2026-10-06 逐行打开核对）：`:130 INSERT_BRACE_ON_ENTER`、`:132 CLOSE_COMMENT_ON_ENTER`、
// `:140 AUTOINSERT_PAIR_QUOTE`（同文件 `:137 SURROUND_SELECTION_ON_QUOTE_TYPED` 是**另一条**，本仓没有那一格设置）。
// 把关点：`enter/EnterAfterUnmatchedBraceHandler.java:84-86`、`enter/EnterInBlockCommentHandler.java:62`、
// `TypedQuoteImpl.java:66-68`。
//
// 次序那一族（判决第①条）的判据在 `tests/editor-enter-order.test.mjs`，本文件不重复。
import test from 'node:test'
import assert from 'node:assert/strict'
import { EditorState } from '@codemirror/state'
import { closeBrackets, insertBracket } from '@codemirror/autocomplete'
import { runQuoteKey, smartQuotes, LANGUAGE_QUOTES } from '../src/editorTyping.ts'
import { smartEnterCommand, smartEnterLanguageForView } from '../src/enterHandlers.ts'

const QUOTE = '"'

/** 与 `tests/editor-enter-handlers.test.mjs:37-41` 同一套假 view（EditorState + dispatch，不需要 DOM）。 */
function fakeView(doc, caret) {
  let state = EditorState.create({ doc, selection: { anchor: caret } })
  const view = { get state() { return state }, dispatch: (...specs) => { state = state.update(...specs).state } }
  return view
}

/** 敲一次引号：返回「这个键有没有被本模块吃掉」与落定后的文档/光标。 */
function typeQuote(doc, caret, opts = {}) {
  // 用 `in` 而不是解构默认值：`{ language: undefined }` 是「宿主拿不到语言 id」这一档，
  // 解构默认值会把它偷偷变成 `'java'`。
  const language = 'language' in opts ? opts.language : 'java'
  const autoInsertPairQuote = 'autoInsertPairQuote' in opts ? opts.autoInsertPairQuote : true
  const view = fakeView(doc, caret)
  const handled = runQuoteKey(view, QUOTE, () => language, () => autoInsertPairQuote)
  return { handled, doc: view.state.doc.toString(), caret: view.state.selection.main.head }
}

// ── 前提：本模块放行 ⇒ CodeMirror 的兜底配对仍然成立（这条是「return false 不算关掉」的依据） ──
test('前提：CodeMirror 的 closeBrackets 兜底仍会补一对（放行不等于不配对）', () => {
  const state = EditorState.create({
    doc: 'String s = ', selection: { anchor: 11 }, extensions: [closeBrackets()],
  })
  const tr = insertBracket(state, QUOTE)
  assert.ok(tr, '键位 return false 时输入仍会走 closeBrackets 的 inputHandler（dist/index.js:1844-1856）')
  assert.equal(tr.newDoc.toString(), 'String s = ""', '兜底补出来的就是配对引号')
  assert.equal(tr.selection.main.head, 12, '光标夹在中间')
})

// ── AUTOINSERT_PAIR_QUOTE（:140）：关掉 ⇒ 敲进去的是一个普通字符 ────────────────────────
test('AUTOINSERT_PAIR_QUOTE 关掉 ⇒ 键被本模块吃掉、文档只多一个引号（判据：行为必须变）', () => {
  const on = typeQuote('String s = ', 11, { autoInsertPairQuote: true })
  assert.equal(on.handled, true, '开着 ⇒ 补一对')
  assert.equal(on.doc, 'String s = ""')

  const off = typeQuote('String s = ', 11, { autoInsertPairQuote: false })
  // 这两条就是「真设置 vs 只存不生效」的分界：改动前这里是 handled=false + 文档没动，
  // 而真实编辑器里键位落回 basicSetup ⇒ 仍然补出 `""`（上一条已实测）⇒ 用户看不出开关按过。
  assert.equal(off.handled, true,
    '关掉 ⇒ 这个键必须由本模块自己落定；return false 会让 basicSetup 的 closeBrackets 再补一对（上一条）')
  assert.equal(off.doc, 'String s = "', 'TypedQuoteImpl.java:66-68：关掉后插的就是一个普通字符')
  assert.equal(off.caret, 12)

  // 跳过收尾引号那一档（`QuoteHandler.java:40` 的 isClosingQuote）也归这条开关管（同一个 handleQuote）。
  // 光标停在收尾那个 `"` **上面**（下标 16 = `lastIndexOf`，不是行尾 17）。
  const closing = 'String s = "abcd"'.lastIndexOf(QUOTE)
  const skipOn = typeQuote('String s = "abcd"', closing, { autoInsertPairQuote: true })
  assert.equal(skipOn.doc, 'String s = "abcd"', '开着 ⇒ 只挪光标、文档不变')
  assert.equal(skipOn.caret, closing + 1)
  const skipOff = typeQuote('String s = "abcd"', closing, { autoInsertPairQuote: false })
  assert.equal(skipOff.doc, 'String s = "abcd""', '关掉 ⇒ 不跳过收尾引号，照普通输入插进去')
  assert.equal(skipOff.caret, closing + 1)
})

test('AUTOINSERT_PAIR_QUOTE 关掉不影响的两处：包住选区（另一条开关）与不在表里的语言', () => {
  // `SelectionQuotingTypedHandler.java:47` 问的是 SURROUND_SELECTION_ON_QUOTE_TYPED（本仓没有那一格 ⇒ 恒开）。
  const view = fakeView('String s = abcd', 0)
  let state = view.state.update({ selection: { anchor: 11, head: 15 } }).state
  const wrapped = { get state() { return state }, dispatch: (...specs) => { state = state.update(...specs).state } }
  assert.equal(runQuoteKey(wrapped, QUOTE, () => 'java', () => false), true, '有选区时仍由 wrap 那一支接管')
  assert.equal(state.doc.toString(), 'String s = "abcd"', '包住选区不受 AUTOINSERT_PAIR_QUOTE 影响')

  // 表里没有的语言（C++/TS/纯文本）：本模块整条不接管，交回 CodeMirror（与开关无关，见模块头）。
  assert.equal(typeQuote('let s = ', 8, { language: 'typescript', autoInsertPairQuote: false }).handled, false)
  assert.equal(typeQuote('let s = ', 8, { language: undefined, autoInsertPairQuote: false }).handled, false)
})

// ── 键名 → 行为的那一段装配：两把回车开关要从 EditorSettings 的键名走到 EnterLanguage 的字段 ──
test('settingsModel 的那三把键名在装配层真的被读（closeCommentOnEnter / insertBraceOnEnter）', () => {
  const view = fakeView('/*abc', 3)
  const on = smartEnterLanguageForView(view, 'A.java', 'java', { closeCommentOnEnter: true, insertBraceOnEnter: true })
  assert.equal(on.blockCloseOnEnter, true)
  assert.equal(on.insertBraceOnEnter, true)
  const off = smartEnterLanguageForView(view, 'A.java', 'java', { closeCommentOnEnter: false, insertBraceOnEnter: false })
  assert.equal(off.blockCloseOnEnter, false)
  assert.equal(off.insertBraceOnEnter, false)
  // 宿主没给设置 ⇒ 按上游默认 true（`CodeInsightSettings.java:130`/`:132`）。
  const unset = smartEnterLanguageForView(view, 'A.java', 'java')
  assert.equal(unset.blockCloseOnEnter, true)
  assert.equal(unset.insertBraceOnEnter, true)
  assert.equal(unset.line, '//', '注释词法仍由 commentStyleFor 按文件名给（装配没漏）')
})

test('CLOSE_COMMENT_ON_ENTER 端到端：关掉 ⇒ 没闭合的块注释不再补闭尾（:132 问在 :62）', () => {
  const run = settings => {
    const view = fakeView('/*abc', 3)
    const handled = smartEnterCommand(
      () => smartEnterLanguageForView(view, 'A.java', 'java', settings))(view)
    return { handled, doc: view.state.doc.toString() }
  }
  assert.equal(run({ closeCommentOnEnter: true }).doc, '/*a\nbc\n */', '开着 ⇒ 行尾补出 ` */`')
  assert.equal(run({ closeCommentOnEnter: false }).handled, false,
    '关掉 ⇒ 整条不接管（交回默认回车），文档里不出现闭尾')
  assert.ok(!run({ closeCommentOnEnter: false }).doc.includes('*/'), '关掉后不该有任何 */')
})

test('INSERT_BRACE_ON_ENTER 端到端：关掉 ⇒ 光标后的那个 `}` 不再补出来（:130 问在 :84-86）', () => {
  const run = settings => {
    const view = fakeView('if (x) {', 8)
    const handled = smartEnterCommand(
      () => smartEnterLanguageForView(view, 'A.java', 'java', settings))(view)
    return { handled, doc: view.state.doc.toString() }
  }
  assert.equal(run({ insertBraceOnEnter: true }).doc, 'if (x) {\n\n}')
  assert.equal(run({ insertBraceOnEnter: false }).handled, false,
    '关掉 ⇒ getMaxRBraceCount 返回 0 ⇒ 整条 Continue（交回默认回车）')
})

// ── 接线：开关的取值口必须挂在宿主扩展面上（否则上面这些只是模块内部的自证） ──────────────
test('宿主把两把回车开关与引号开关都传进了编辑器（不是只过自己测试的死设置）', () => {
  const source = smartQuotes.toString()
  assert.match(source, /runQuoteKey\(view, ch, getLanguage, autoInsertPairQuote\)/,
    'smartQuotes 的键位没走 runQuoteKey ⇒ 判据驱动的是另一份代码')
  assert.equal(typeof LANGUAGE_QUOTES.java.concat, 'string', 'Java 的连接符表还在（回车切字面量那一条要用）')
})
