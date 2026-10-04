import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { shellSource } from './shell-source.mjs'
import { EditorState } from '@codemirror/state'
import { editingCommands, joinLinesCommand, toggleCaseCommand } from '../src/editorCommands.ts'
import { clipboardCommands } from '../src/editorClipboard.ts'

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
//
// 查找那一族**不能靠查表**：上游 `Find`/`Replace`/`FindNext`/`FindPrevious`/`FindWordAtCaret`/
// `FindPrevWordAtCaret`/`ToggleFindInSelection` 的落点是编辑器内那根查找栏
// （`SearchReplaceComponent` + `EditorSearchSession`），本仓在 `src/editorFindController.ts` +
// `CodeEditor.vue` 的 `editorActions` 里接管 —— 与 `editingCommands` 那张通用表无关。
// 加进这个集合的每一条都必须在 `src/components/CodeEditor.vue` 的 `editorActions` 里找得到，
// 否则「编辑器接管」就成了一个什么都装得下的口袋（下面有专门一条判据守着）。
const OWNED_BY_EDITOR = new Set([
  'completion', 'evaluate', 'template.expand',
  'find', 'replace', 'find.next', 'find.previous',
  'find.wordAtCaret', 'find.prevWordAtCaret', 'find.toggleInSelection',
])
// 复制/剪切由 `src/editorClipboard.ts` 的 `clipboardCommands` 提供（那边需要剪贴板通道，
// 而本模块要保持零相对依赖才能被直接 import）。这里**真的去问它有哪些命令**，
// 而不是把名字抄成白名单 —— 白名单会像旧版那样把菜单里的手误一起放绿。
const FROM_CLIPBOARD_MODULE = new Set(Object.keys(clipboardCommands(() => {})))

test('every editing command is a callable', () => {
  for (const [name, command] of Object.entries(editingCommands)) {
    assert.equal(typeof command, 'function', `${name} is not a command`)
  }
})

// The old version of this test compared the table against a hard-coded copy of the same
// table, so a typo in a *menu* entry (line.jion) stayed green while the menu row silently
// did nothing. It now reads the menu sources.
test('every name the menus offer is either an editing command or owned by the editor', () => {
  const sources = [shellSource(), readFileSync('src/components/CodeEditor.vue', 'utf8')]
  const offered = new Set()
  for (const source of sources)
    // 名字里可以带数字（`unfold.level1`）—— 早先的字符集漏了 0-9，那一族被当成 `unfold.level`。
    for (const [, name] of source.matchAll(/editable\('([a-zA-Z.0-9]+)'/g)) offered.add(name)

  assert.ok(offered.size >= 20, `expected the menus to offer many commands, saw ${offered.size}`)
  for (const name of offered) {
    const known = name in editingCommands || OWNED_BY_EDITOR.has(name) || FROM_CLIPBOARD_MODULE.has(name)
    assert.ok(known, `菜单提供了「${name}」，但命令表里没有它，也没有编辑器接管`)
  }
  // And the reverse: a command nobody can reach is dead weight.
  const unused = Object.keys(editingCommands).filter(name => !offered.has(name))
  assert.deepEqual(unused, [], `命令表里有菜单到不了的项：${unused.join(', ')}`)
  // 复制/剪切两个命令同样必须能从菜单走到（编辑菜单的 剪切 / 复制 两行就指向它们）。
  assert.deepEqual([...FROM_CLIPBOARD_MODULE].filter(name => !offered.has(name)), [],
    `剪贴板命令菜单到不了：${[...FROM_CLIPBOARD_MODULE].filter(name => !offered.has(name)).join(', ')}`)
})

// `OWNED_BY_EDITOR` 不能变成一个"什么都装得下"的口袋：里面每一条都必须在
// `src/components/CodeEditor.vue` 的 `editorActions` 里真的有一个实现。少了这一条，
// 上面那条判据对任何拼错的菜单名都会放绿 —— 正是它要防的事。
test('every name claimed to be editor-owned really has an implementation there', () => {
  const editor = readFileSync('src/components/CodeEditor.vue', 'utf8')
  const tableStart = editor.indexOf('const editorActions: Record<string, Command> = {')
  assert.ok(tableStart > 0, 'editorActions 表还在（判据的锚点）')
  const table = editor.slice(tableStart, editor.indexOf('\n}', tableStart))
  for (const name of OWNED_BY_EDITOR) {
    // `completion` / `evaluate` / `template.expand` 用的是裸键名，查找族是引号键名。
    const keyed = table.includes(`'${name}':`) || table.includes(`\n  ${name}:`) || table.includes(`${name}: `)
    assert.ok(keyed, `OWNED_BY_EDITOR 里的「${name}」在 editorActions 里没有实现`)
  }
})
