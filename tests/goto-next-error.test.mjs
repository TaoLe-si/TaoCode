import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { shellSource } from './shell-source.mjs'
import { ERROR_TIER, NO_ERRORS_IN_FILE, WARNING_TIER, WEAK_WARNING_TIER, errorTier, nextErrorTarget } from '../src/gotoNextError.ts'

const diag = (line, character, severity) => ({ line, character, severity })
const at = item => (item ? [item.line, item.character] : null)

// LspDiagnosticsCustomizer.kt:80-85 — only LSP errors and warnings keep their IDEA level.
test('an LSP severity maps onto the same IDEA level the LSP client uses', () => {
  assert.equal(errorTier(1), ERROR_TIER)          // DiagnosticSeverity.Error   -> ERROR
  assert.equal(errorTier(2), WARNING_TIER)        // DiagnosticSeverity.Warning -> WARNING
  assert.equal(errorTier(3), WEAK_WARNING_TIER)   // Information                -> WEAK_WARNING
  assert.equal(errorTier(4), WEAK_WARNING_TIER)   // Hint                       -> WEAK_WARNING
  assert.equal(errorTier(0), WEAK_WARNING_TIER)   // a server that omits it
})

test('a file without diagnostics has nothing to navigate to', () => {
  assert.equal(nextErrorTarget([], { line: 0, character: 0 }, true), null)
  assert.equal(nextErrorTarget([], { line: 0, character: 0 }, false), null)
})

test('F2 goes to the next highlight after the caret', () => {
  const list = [diag(1, 4, 1), diag(5, 0, 1), diag(9, 2, 1)]
  assert.deepEqual(at(nextErrorTarget(list, { line: 3, character: 0 }, true)), [5, 0])
})

test('F2 wraps to the first highlight when the caret is past the last one', () => {
  const list = [diag(1, 4, 1), diag(5, 0, 1), diag(9, 2, 1)]
  assert.deepEqual(at(nextErrorTarget(list, { line: 9, character: 2 }, true)), [1, 4])
  assert.deepEqual(at(nextErrorTarget(list, { line: 40, character: 0 }, true)), [1, 4])
})

test('the highest severity present wins outright, however far away it is', () => {
  // Two warnings sit right next to the caret; the single error still owns the navigation
  // (gotoNextError walks ERROR before WARNING, :72-89).
  const list = [diag(0, 0, 2), diag(0, 1, 2), diag(30, 0, 1)]
  assert.deepEqual(at(nextErrorTarget(list, { line: 0, character: 0 }, true)), [30, 0])
  assert.deepEqual(at(nextErrorTarget(list, { line: 0, character: 0 }, false)), [30, 0])
})

test('warnings are navigated before weak warnings, mapping exactly as IDEA maps them', () => {
  const list = [diag(2, 0, 4), diag(7, 0, 2)]
  assert.deepEqual(at(nextErrorTarget(list, { line: 0, character: 0 }, true)), [7, 0])
})

// Within the winning level the order is the document's, so two errors at different columns
// of one line are two stops.
test('inside one level the search is positional and column-aware', () => {
  const list = [diag(3, 20, 1), diag(3, 4, 1)]
  assert.deepEqual(at(nextErrorTarget(list, { line: 3, character: 10 }, true)), [3, 20])
  assert.deepEqual(at(nextErrorTarget(list, { line: 3, character: 10 }, false)), [3, 4])
})

test('Shift+F2 stops on the largest highlight before the caret', () => {
  const list = [diag(1, 0, 1), diag(5, 0, 1), diag(9, 0, 1)]
  assert.deepEqual(at(nextErrorTarget(list, { line: 6, character: 0 }, false)), [5, 0])
})

// The backward branch of isBetterThan() (:130) prefers the candidate that fails
// `caretOffset <= offset`, i.e. one strictly earlier than the caret — so a caret sitting
// exactly on a highlight is not "here" going back either.
test('Shift+F2 with the caret on a highlight moves to the one before it', () => {
  const list = [diag(1, 0, 1), diag(5, 7, 1)]
  assert.deepEqual(at(nextErrorTarget(list, { line: 5, character: 7 }, false)), [1, 0])
})

// …and with nothing before it, the same wrap the forward direction has on the other end.
test('Shift+F2 on the first highlight wraps to the last one', () => {
  assert.deepEqual(at(nextErrorTarget([diag(5, 7, 1)], { line: 5, character: 7 }, false)), [5, 7])
})

test('Shift+F2 wraps to the last highlight when the caret is before the first one', () => {
  const list = [diag(4, 0, 1), diag(8, 0, 1)]
  assert.deepEqual(at(nextErrorTarget(list, { line: 0, character: 0 }, false)), [8, 0])
})

// processHighlights hands the highlights over in document order and isBetterThan() rejects a
// tie, so the earlier entry of two highlights at one offset is the one that wins.
test('two highlights at the same offset keep document order', () => {
  const first = diag(2, 3, 1)
  const second = diag(2, 3, 1)
  assert.equal(nextErrorTarget([first, second], { line: 0, character: 0 }, true), first)
  assert.equal(nextErrorTarget([first, second], { line: 0, character: 0 }, false), first)
})

test('the caller keeps its own diagnostic array', () => {
  const list = [diag(9, 0, 2), diag(1, 0, 1)]
  const snapshot = list.map(item => [item.line, item.character, item.severity])
  nextErrorTarget(list, { line: 0, character: 0 }, true)
  assert.deepEqual(list.map(item => [item.line, item.character, item.severity]), snapshot)
})

test('the empty-file message is the one IDEA shows', () => {
  assert.equal(NO_ERRORS_IN_FILE, '此文件中未发现错误。')
})

// The F2 action is bound in the editor and offered in the menu; these strings are the
// contract between the two (editorCommands.ts:58-59 makes the same point for the editing
// commands). Reading the sources keeps a rename from leaving a menu row pointing nowhere.
test('the editor binds F2 / Shift+F2 and the menu offers the same two actions', () => {
  // F2/Shift+F2 挂在 lspExtensions()（与 goToError 的语言服务门同处，仍在 CodeEditor.vue）；
  // 两个菜单动作名 2026-10-06 随动作表搬进 src/editorKeymap.ts。两处都钉，判据没有放松。
  const editor = readFileSync('src/components/CodeEditor.vue', 'utf8')
  const keymap = readFileSync('src/editorKeymap.ts', 'utf8')
  const app = shellSource()

  assert.match(editor, /key: 'F2'/, 'F2 ($default.xml:658-660) is not bound')
  assert.match(editor, /key: 'Shift-F2'/, 'Shift+F2 ($default.xml:679-681) is not bound')
  for (const name of ["'error.next'", "'error.previous'"])
    assert.ok(keymap.includes(name), `editorActions is missing ${name}`)

  for (const [id, keys, action] of [['navigate.nextError', 'F2', 'error.next'], ['navigate.previousError', 'Shift F2', 'error.previous']]) {
    const row = app.split('\n').find(line => line.includes(`id: '${id}'`))
    assert.ok(row, `the Navigate menu has no ${id} row`)
    assert.ok(row.includes(`keys: '${keys}'`), `${id} shows the wrong shortcut`)
    assert.ok(row.includes(`runEditor('${action}')`), `${id} does not run ${action}`)
  }
})

// IDEA binds F8 to StepOver only ($default.xml:849-851), which the window handler runs. The
// editor has to eat the key first, because @codemirror/lint's lintKeymap would otherwise also
// run nextDiagnostic for the same press. basicSetup is installed after this binding, so the
// editor's own keymap wins.
test('the editor shadows CodeMirror\u2019s F8 before pulling in basicSetup', () => {
  const editor = readFileSync('src/components/CodeEditor.vue', 'utf8')
  const shadow = editor.indexOf("key: 'F8'")
  const setup = editor.indexOf('basicSetup,')
  assert.ok(shadow >= 0, "no F8 binding — lintKeymap's nextDiagnostic would run")
  assert.ok(shadow < setup, 'the F8 binding must precede basicSetup to take precedence')
})
