// 字符输入 / 退格这两条链上的**扩展点问法**是不是真的被问到（`src/editorActionExtensionPoints.ts`
// 声明、`src/editorTyping.ts` 与 `src/lspCompletion.ts` 消费）。
//
// 上游坐标（`platform/lang-api/src/com/intellij/codeInsight/editorActions/TypedHandlerDelegate.java`）：
//   `checkAutoPopup`（`:32`）在 `TypedHandler.java:169-173` 的 `fireCheckAutoPopup` 里问、
//   `beforeSelectionRemoved`（`:41`）在 `:184-186` 问、`newTypingStarted`（`:50`）在
//   `TypedDelegateImpl.fireNewTypingStarted`（`TypedDelegateImpl.java:36-44`）里逐个通知、
//   `beforeCharTyped`（`:57`）在 `:189` 问、`beforeClosingQuoteInserted`（`:85`）在
//   `TypedQuoteImpl.java:104-108`/`:117-118` 问、`charTyped`（`:65`）在 `TypedHandler.java:205` 问；
//   退格那一侧是 `BackspaceHandlerDelegate.java:23`/`:33`（`src/editorTyping.ts` 的 `runBackspaceKey`）。
//
// 这一层此前只有「注册表本身」的判据（`tests/editor-action-extension-points.test.mjs`）：
// 本文件问的是**消费链路**——按 EP id 挂一个委托，然后走真的键位体（`runQuoteKey` /
// `runBackspaceKey`）与真的自动弹出闸（`autoPopupHandedToDelegate`），断言行为跟着变；
// 注销之后必须回到原来的行为。bundled 的 passthrough 委托不改变任何一条既有行为。
import test from 'node:test'
import assert from 'node:assert/strict'
import { EditorSelection, EditorState } from '@codemirror/state'
import { runQuoteKey, runBackspaceKey } from '../src/editorTyping.ts'
import { autoPopupHandedToDelegate } from '../src/lspCompletion.ts'
import { registerBackspaceHandlerDelegate, registerTypedHandlerDelegate } from '../src/editorActionExtensionPoints.ts'

const PATH = 'src/Main.java'

/** 假 view（与 `tests/editor-enter-switches.test.mjs` 同一套：EditorState + dispatch，不需要 DOM）。 */
function fakeView(doc, caret) {
  let state = EditorState.create({ doc, selection: { anchor: caret ?? doc.length } })
  const view = { get state() { return state }, dispatch: (...specs) => { state = state.update(...specs).state } }
  return view
}

function stateOf(doc, caret) {
  return EditorState.create({ doc, selection: { anchor: caret ?? doc.length } })
}

/** 敲一次引号（java 有引号表）：返回「这个键有没有被本模块吃掉」与落定后的文档/光标。 */
function typeQuote(doc, caret) {
  const view = fakeView(doc, caret)
  const handled = runQuoteKey(view, '"', () => 'java', () => true)
  return { handled, doc: view.state.doc.toString(), caret: view.state.selection.main.head }
}

// ── checkAutoPopup（`TypedHandler.java:169-173`；消费点 = `src/lspCompletion.ts`） ──────────────

test('checkAutoPopup：按 EP id 挂的委托能接管自动弹出，注销后回到原样', () => {
  const before = stateOf('System.out.', 11)
  assert.equal(autoPopupHandedToDelegate(before, 11, PATH), false, '没有第三方委托时不该接管（bundled 是 CONTINUE）')
  const seen = []
  const handle = registerTypedHandlerDelegate({
    id: 'demo.typed.autopopup',
    checkAutoPopup: input => { seen.push(input); return 'STOP' },
  })
  try {
    assert.equal(autoPopupHandedToDelegate(before, 11, PATH), true, '有委托返回 STOP ⇒ 这一拍不弹')
    assert.equal(seen.length, 1)
    // 委托看到的输入就是「光标前那个字符」+ 当前正文（`lspCompletion.ts` 的 pos-1 口径）。
    assert.equal(seen[0].char, '.')
    assert.equal(seen[0].text, 'System.out.')
    assert.equal(seen[0].line, 0)
    assert.equal(seen[0].character, 11)
    assert.equal(seen[0].language, 'java')
    assert.equal(seen[0].fileType, 'JAVA')
    assert.equal(seen[0].path, PATH)
  } finally { handle.dispose() }
  assert.equal(autoPopupHandedToDelegate(before, 11, PATH), false, '注销之后必须回到原样')
})

test('checkAutoPopup：语言收窄生效（只挂 typescript 的委托不接管 java 文件）', () => {
  const state = stateOf('const a = b.', 12)
  const handle = registerTypedHandlerDelegate({
    id: 'demo.typed.autopopup.ts', languages: ['typescript'],
    checkAutoPopup: () => 'STOP',
  })
  try {
    assert.equal(autoPopupHandedToDelegate(state, 12, 'src/a.ts'), true, 'ts 文件上生效')
    assert.equal(autoPopupHandedToDelegate(state, 12, PATH), false, 'java 文件上不生效（按语言过滤）')
  } finally { handle.dispose() }
})

test('checkAutoPopup 返回 CONTINUE 时不接管（只有 STOP 说了算）', () => {
  const state = stateOf('foo.', 4)
  const handle = registerTypedHandlerDelegate({
    id: 'demo.typed.autopopup.continue', checkAutoPopup: () => 'CONTINUE',
  })
  try {
    assert.equal(autoPopupHandedToDelegate(state, 4, PATH), false)
  } finally { handle.dispose() }
})

// ── 引号键那一串问法（`TypedHandler.doExecute` 的次序） ───────────────────────────────────────

test('newTypingStarted 与 beforeCharTyped：前者逐个通知，后者 STOP ⇒ 整键被吃掉、文档不动', () => {
  const started = []
  const face = registerTypedHandlerDelegate({
    id: 'demo.typed.before', newTypingStarted: input => { started.push(input.char) },
    beforeCharTyped: () => 'STOP',
  })
  try {
    const out = typeQuote('String s = ', 11)
    assert.deepEqual(started, ['"'], 'newTypingStarted 一次输入通知一次（`TypedDelegateImpl.java:36-44`）')
    assert.equal(out.handled, true, 'beforeCharTyped 返回 STOP ⇒ 这个键到此为止（`TypedHandler.java:189-191`）')
    assert.equal(out.doc, 'String s = ', '什么都没插（连配对也没补）')
    assert.equal(out.caret, 11)
  } finally { face.dispose() }
  const after = typeQuote('String s = ', 11)
  assert.equal(after.doc, 'String s = ""', '注销之后回到原行为（补一对）')
})

test('charTyped：本仓补完一对之后问一次；返回 STOP 不影响已经落定的正文', () => {
  const seen = []
  const face = registerTypedHandlerDelegate({
    id: 'demo.typed.charted', charTyped: input => { seen.push(input.char); return 'STOP' },
  })
  try {
    const out = typeQuote('String s = ', 11)
    assert.deepEqual(seen, ['"'], '补完一对之后问一次 charTyped（`TypedHandler.java:205-207`）')
    assert.equal(out.doc, 'String s = ""')
    assert.equal(out.caret, 12)
  } finally { face.dispose() }
  assert.deepEqual(seen, ['"'])
})

test('beforeSelectionRemoved：有选区时先问；STOP ⇒ 选区原样、什么都不插', () => {
  const face = registerTypedHandlerDelegate({
    id: 'demo.typed.selection', beforeSelectionRemoved: () => 'STOP',
  })
  const view = fakeView('String s = abc', 11)
  view.dispatch({ selection: { anchor: 11, head: 14 } })
  try {
    const handled = runQuoteKey(view, '"', () => 'java', () => true)
    assert.equal(handled, true, '委托接管（`TypedHandler.java:184-186` 的 handled ⇒ 直接 return）')
    assert.equal(view.state.doc.toString(), 'String s = abc', '正文没动')
    assert.equal(view.state.selection.main.from, 11, '选区还在（既不删也不包）')
    assert.equal(view.state.selection.main.to, 14)
  } finally { face.dispose() }
  // 注销之后：同一份选区会走「用引号包住」那一支。
  const again = fakeView('String s = abc', 11)
  again.dispatch({ selection: { anchor: 11, head: 14 } })
  assert.equal(runQuoteKey(again, '"', () => 'java', () => true), true)
  assert.equal(again.state.doc.toString(), 'String s = "abc"')
})

test('beforeClosingQuoteInserted：STOP ⇒ 只落开引号（正文里已经有一个开引号，char 是收尾引号串）', () => {
  const seen = []
  const face = registerTypedHandlerDelegate({
    id: 'demo.typed.closingquote',
    beforeClosingQuoteInserted: input => { seen.push(input); return 'STOP' },
  })
  try {
    const out = typeQuote('String s = ', 11)
    assert.equal(out.doc, 'String s = "', '委托接管 ⇒ 不补收尾（`TypedQuoteImpl.java:117-118`）')
    assert.equal(out.caret, 12)
    assert.equal(seen.length, 1)
    assert.equal(seen[0].char, '"', '第一个参数就是收尾引号串')
    assert.equal(seen[0].text, 'String s = "', '委托看到的正文里已经有那个开引号（上游先 typeChar 再问）')
    assert.equal(seen[0].character, 12, '光标在那个开引号之后')
  } finally { face.dispose() }
  assert.equal(typeQuote('String s = ', 11).doc, 'String s = ""', '注销之后回到补配对的旧行为')
})

// ── 退格那一侧（`BackspaceHandlerDelegate.java:23`/`:33`） ──────────────────────────────────

test('runBackspaceKey：charDeleted 说接管才吃这一键，否则交回 CodeMirror 的默认退格', () => {
  const before = []
  const face = registerBackspaceHandlerDelegate({
    id: 'demo.backspace.take', beforeCharDeleted: input => { before.push(input.char) },
    charDeleted: () => true,
  })
  try {
    const view = fakeView('f()', 2)
    assert.equal(runBackspaceKey(view, () => 'java'), true, '委托接管 ⇒ 本模块替它删掉一个字符')
    assert.equal(view.state.doc.toString(), 'f)', '删的是光标前那一个字符')
    assert.equal(view.state.selection.main.head, 1)
    assert.deepEqual(before, ['('], 'beforeCharDeleted 先被通知一次（`:23`）')
  } finally { face.dispose() }
  const view = fakeView('f()', 2)
  assert.equal(runBackspaceKey(view, () => 'java'), false, '没有委托接管 ⇒ 返回 false，默认退格照旧')
  assert.equal(view.state.doc.toString(), 'f()', '本模块不动正文')
})

test('runBackspaceKey：多光标 / 有选区 / 行首三档都不接管（`selection.ranges.length !== 1` 等前置）', () => {
  const multi = { state: EditorState.create({
    doc: 'f()', selection: EditorSelection.create([EditorSelection.cursor(1), EditorSelection.cursor(2)]),
  }) }
  const selected = fakeView('f()', 2)
  selected.dispatch({ selection: { anchor: 2, head: 3 } })
  for (const view of [multi, selected, fakeView('f()', 0)]) {
    const before = view.state.doc.toString()
    assert.equal(runBackspaceKey(view, () => 'java'), false)
    assert.equal(view.state.doc.toString(), before, '不接管就不许动正文')
  }
})

// ── 如实登记：还没派发点的两问（不是「没实现」，是这两条路在本仓不经过这个模块） ─────────────────

test('beforeClosingParenInserted / isImmediatePaintingEnabled：本仓没有派发点（如实登记）', () => {
  const face = registerTypedHandlerDelegate({
    id: 'demo.typed.paren', beforeClosingParenInserted: () => 'STOP', isImmediatePaintingEnabled: () => true,
  })
  try {
    // 圆括号的插入由 CodeMirror `basicSetup` 的 `closeBrackets` inputHandler 做（不经本模块），
    // 所以引号键这条路上根本问不到它 —— 敲引号不会触发 beforeClosingParenInserted。
    let asked = false
    const probe = registerTypedHandlerDelegate({
      id: 'demo.typed.paren.probe', beforeClosingParenInserted: () => { asked = true; return 'CONTINUE' },
    })
    try { typeQuote('String s = ', 11) } finally { probe.dispose() }
    assert.equal(asked, false, '引号键这条路不问圆括号那一问')
  } finally { face.dispose() }
})
