// Editor operations that CodeMirror does not ship: IDEA's Join Lines and Toggle
// Case, plus the single map the keymap AND the 编辑 menu both read from, so a menu
// entry can never point at something the keyboard does not do.
import {
  addCursorAbove, addCursorBelow, copyLineDown, deleteLine, moveLineDown, moveLineUp,
  redo, selectAll, toggleBlockComment, toggleLineComment, undo,
} from '@codemirror/commands'
import { foldCode, unfoldCode, foldAll, unfoldAll } from '@codemirror/language'
import { findNext, findPrevious, openSearchPanel, replaceAll, replaceNext, selectMatches, selectNextOccurrence } from '@codemirror/search'
import { EditorSelection, type StateCommand } from '@codemirror/state'
import type { Command } from '@codemirror/view'

// StateCommand only needs {state, dispatch}, which an EditorView satisfies.
const fromState = (command: StateCommand): Command => view => command(view)

export const joinLinesCommand: Command = view => {
  const { state } = view
  const edit = state.changeByRange(range => {
    const first = state.doc.lineAt(range.from)
    const endLine = range.empty ? first.number + 1 : state.doc.lineAt(range.to).number
    if (endLine > state.doc.lines || endLine <= first.number) return { range, effects: [] }
    let joined = first.text.trimEnd()
    for (let line = first.number + 1; line <= endLine; ++line) {
      const text = state.doc.line(line).text.trim()
      if (text) joined += (joined ? ' ' : '') + text
    }
    return {
      changes: { from: first.from, to: state.doc.line(endLine).to, insert: joined },
      range: EditorSelection.cursor(first.from + joined.length),
    }
  })
  view.dispatch(edit, { scrollIntoView: true, userEvent: 'delete.join' })
  return true
}

export const toggleCaseCommand: Command = view => {
  const changes: { from: number; to: number; insert: string }[] = []
  for (const range of view.state.selection.ranges) {
    const span = range.empty ? view.state.wordAt(range.head) : { from: range.from, to: range.to }
    if (!span || span.to <= span.from) continue
    const text = view.state.sliceDoc(span.from, span.to)
    const next = flipCase(text)
    if (next !== text) changes.push({ from: span.from, to: span.to, insert: next })
  }
  if (!changes.length) return false
  view.dispatch({ changes, userEvent: 'input.changeCase' })
  return true
}

// All-lower (or caseless) text goes up; anything with a capital goes down.
export function flipCase(text: string) {
  return text === text.toLowerCase() ? text.toUpperCase() : text.toLowerCase()
}

// Names are the contract: the keymap, the 编辑/查找 menus and the offline test all
// address these commands by the same string.
export const editingCommands: Record<string, Command> = {
  undo, redo, selectAll,
  'line.duplicate': copyLineDown, 'line.delete': deleteLine, 'line.moveUp': moveLineUp, 'line.moveDown': moveLineDown,
  'line.join': joinLinesCommand, 'case.toggle': toggleCaseCommand,
  'cursor.above': addCursorAbove, 'cursor.below': addCursorBelow, 'occurrence.select': selectMatches,
  // Ctrl+D belongs to "duplicate line" here (IDEA), so CM's own Mod-d binding is
  // replaced and "add next occurrence" moves to Alt+J (also IDEA's).
  'occurrence.next': fromState(selectNextOccurrence),
  find: openSearchPanel,
  'find.next': findNext,
  'find.previous': findPrevious,
  'replace.next': replaceNext,
  'replace.all': replaceAll,
  'comment.line': toggleLineComment, 'comment.block': toggleBlockComment,
  fold: foldCode, unfold: unfoldCode, foldAll, unfoldAll,
}
