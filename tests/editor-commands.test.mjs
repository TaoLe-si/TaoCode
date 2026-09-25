import test from 'node:test'
import assert from 'node:assert/strict'
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

test('every name the menus offer maps to a command', () => {
  assert.deepEqual(Object.keys(editingCommands).sort(), [
    'case.toggle', 'comment.block', 'comment.line', 'cursor.above', 'cursor.below', 'find', 'find.next',
    'find.previous', 'fold', 'foldAll', 'line.delete', 'line.duplicate', 'line.join', 'line.moveDown',
    'line.moveUp', 'occurrence.next', 'occurrence.select', 'redo', 'replace.all', 'replace.next',
    'selectAll', 'undo', 'unfold', 'unfoldAll',
  ].sort())
  for (const command of Object.values(editingCommands)) assert.equal(typeof command, 'function')
})
