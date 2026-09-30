// Editor operations that CodeMirror does not ship: IDEA's Join Lines and Toggle
// Case, plus the single map the keymap AND the 编辑 menu both read from, so a menu
// entry can never point at something the keyboard does not do.
import {
  addCursorAbove, addCursorBelow, copyLineDown, deleteLine, indentLess, indentMore, moveLineDown, moveLineUp,
  redo, selectAll, toggleBlockComment, toggleLineComment, undo,
} from '@codemirror/commands'
import { foldAll, unfoldAll } from '@codemirror/language'
import { expandAllToLevel, expandCaretToLevel, foldAtCaret, foldBlockAtCaret, foldDocComments, foldRecursively,
  toggleFoldAtCaret, toggleFoldSelection, unfoldAtCaret, unfoldDocComments, unfoldRecursively } from './editorFolding.ts'
import { findNext, findPrevious, openSearchPanel, replaceAll, replaceNext, selectMatches, selectNextOccurrence } from '@codemirror/search'
import { EditorSelection, type StateCommand } from '@codemirror/state'
import type { Command, EditorView } from '@codemirror/view'

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
  // Nothing to join is not "handled": returning true here swallowed the key and made
  // CodeMirror skip every later binding for it.
  if (edit.changes.empty) return false
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
function flipCase(text: string) {
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
  // 收起/展开 = 上游 `CollapseRegion` / `ExpandRegion`（在 `src/editorFolding.ts` 里按
  // `CollapseRegionAction` / `ExpandRegionAction` 的挑法实现）；`foldAll`/`unfoldAll` 用
  // CodeMirror 自带的那两条 —— 它们逐行问 `foldable`，LSP 区间照样进得来。
  fold: foldAtCaret, unfold: unfoldAtCaret, foldAll, unfoldAll,
  // B4（codeInsight/folding）那一族的其余命令：实现在 src/editorFolding.ts（纯逻辑 + 命令），
  // 名字与上游动作的对应写在那个模块头上，键位见 CodeEditor.vue 的 keymap。
  'fold.recursively': foldRecursively, 'unfold.recursively': unfoldRecursively,
  'fold.toggle': toggleFoldAtCaret, 'fold.block': foldBlockAtCaret,
  'fold.selection': toggleFoldSelection, 'fold.docs': foldDocComments, 'unfold.docs': unfoldDocComments,
  'unfold.level1': expandCaretToLevel(1), 'unfold.all.level1': expandAllToLevel(1),
  'unfold.level2': expandCaretToLevel(2), 'unfold.all.level2': expandAllToLevel(2),
  'unfold.level3': expandCaretToLevel(3), 'unfold.all.level3': expandAllToLevel(3),
  'unfold.level4': expandCaretToLevel(4), 'unfold.all.level4': expandAllToLevel(4),
  'unfold.level5': expandCaretToLevel(5), 'unfold.all.level5': expandAllToLevel(5),
  // IDEA's Code menu: 自动缩进 (Auto Indent, Ctrl+Alt+I) re-indents the selection
  // by one step per CodeMirror's indentUnit.
  'indent.selection': indentMore, 'indent.selection.less': indentLess,
  // 复制/剪切命令在 src/editorClipboard.ts（那里能 import 剪贴板通道而不污染本模块的零依赖）。
}

// 命令分派（编辑器组件只保留一行包装）：表里没有的名字返回 false，调用方据此提示"这个操作没做事"。
export function runEditorCommand(view: EditorView | undefined, table: Record<string, Command>, name: string): boolean {
  const run = table[name]
  return Boolean(view && run && run(view))
}
