import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { EditorState } from '@codemirror/state'
import { editingCommands, joinLinesCommand, toggleCaseCommand } from '../src/editorCommands.ts'

// A CodeMirror Command only ever reads view.state and calls view.dispatch, so the
// real functions run offline — no DOM, and no copy of the logic to keep in sync.
function run(command, doc, anchor, head = anchor) {
  let state = EditorState.create({ doc, selection: { anchor, head } })
  const view = { get state() { return state }, dispatch: (...specs) => { state = state.update(...specs).state } }
  return { ran: command(view), text: state.doc.toString() }
}

test('join lines merges the caret line with the next and trims the continuation', () => {
  assert.equal(run(joinLinesCommand, 'aaa\n  bbb\n\nccc\n', 0).text, 'aaa bbb\n\nccc\n')
})

test('join lines over a selection collapses blank lines', () => {
  assert.equal(run(joinLinesCommand, 'aaa\n  bbb\n\nccc\n', 0, 13).text, 'aaa bbb ccc\n')
})

test('join lines has nothing to do on the last line', () => {
  assert.equal(run(joinLinesCommand, 'two', 0).text, 'two')
})

test('toggle case follows the selection, in both directions', () => {
  assert.deepEqual(run(toggleCaseCommand, 'x = beta; y', 4, 8), { ran: true, text: 'x = BETA; y' })
  assert.deepEqual(run(toggleCaseCommand, 'x = BETA; y', 4, 8), { ran: true, text: 'x = beta; y' })
})

test('toggle case with an empty selection retypes the word at the caret', () => {
  assert.deepEqual(run(toggleCaseCommand, 'beta beta', 0, 0), { ran: true, text: 'BETA beta' })
})

test('toggle case refuses text that has no case at all', () => {
  assert.equal(run(toggleCaseCommand, '12345', 2, 2).ran, false)
})

// Names the menus use that are served by the editor's other bindings rather than by the
// editing-command table (the CodeEditor owns completion, evaluation and live templates).
const OWNED_BY_EDITOR = new Set(['completion', 'evaluate', 'template.expand'])

test('every editing command is a callable', () => {
  for (const [name, command] of Object.entries(editingCommands)) {
    assert.equal(typeof command, 'function', `${name} is not a command`)
  }
})

// The old version of this test compared the table against a hard-coded copy of the same
// table, so a typo in a *menu* entry (line.jion) stayed green while the menu row silently
// did nothing. It now reads the menu sources.
test('every name the menus offer is either an editing command or owned by the editor', () => {
  const sources = ['src/App.vue', 'src/components/CodeEditor.vue'].map(file => readFileSync(file, 'utf8'))
  const offered = new Set()
  for (const source of sources)
    for (const [, name] of source.matchAll(/editable\('([a-zA-Z.]+)'/g)) offered.add(name)

  assert.ok(offered.size >= 20, `expected the menus to offer many commands, saw ${offered.size}`)
  for (const name of offered) {
    const known = name in editingCommands || OWNED_BY_EDITOR.has(name)
    assert.ok(known, `菜单提供了「${name}」，但命令表里没有它，也没有编辑器接管`)
  }
  // And the reverse: a command nobody can reach is dead weight.
  const unused = Object.keys(editingCommands).filter(name => !offered.has(name))
  assert.deepEqual(unused, [], `命令表里有菜单到不了的项：${unused.join(', ')}`)
})
