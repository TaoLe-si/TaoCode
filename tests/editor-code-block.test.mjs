// 代码块首尾移动（上游 `CodeBlockUtil.java` 的括号扫描那一支，
// 键位 `$default.xml:569-571`/`:315-317`/`:318-320`/`:824-826`）。
import test from 'node:test'
import assert from 'node:assert/strict'
import { EditorSelection, EditorState } from '@codemirror/state'
import { blockEndOffset, blockStartOffset, codeBlockTarget, structuralBraceTokens } from '../src/editorCodeBlock.ts'
import { editingCommands } from '../src/editorCommands.ts'

function run(name, doc, spec) {
  let state = EditorState.create({ doc, selection: spec })
  const view = { get state() { return state }, dispatch: (...specs) => { state = state.update(...specs).state } }
  return { ran: editingCommands[name](view), state }
}

test('字符串与注释里的括号不算结构括号', () => {
  // `f("a(b"); // x( }` ⇒ 只有真正的 `(` 与 `)`（偏移 1 与 7）。
  assert.deepEqual(structuralBraceTokens('f("a(b"); // x( }').map(t => `${t.from}${t.kind}`), ['1L', '7R'])
})

test('块内 ⇒ 右手边是关掉当前块的右括号，左手边是开出块的左括号之后（:144-173、:214-237）', () => {
  const text = '{ aaa\n  bbb\n}'
  assert.equal(blockEndOffset(text, 3), text.length - 1, '落在那个 } 的起始偏移')
  assert.equal(blockStartOffset(text, 3), 1, '落在那个 { 之后')
})

test('光标正好压在左括号上 ⇒ 块尾算到右括号**之后**（:173 的 isBeforeLBrace ? getEnd()）', () => {
  assert.equal(blockEndOffset('{aaa}', 0), 5)
})

test('光标压着的那个括号算「当前位置本身」，要再往外一层（:149 与 :220 的 if (moved)）', () => {
  // `f(g(a), b)`：光标停在 a 后面那个 `)` 上 ⇒ 那一对已经过去了，块尾是最外层的 `)`。
  assert.equal(blockEndOffset('f(g(a), b)', 5), 9)
  assert.equal(blockEndOffset('{a}}', 3), null, '再往外没有括号了')
  assert.equal(blockEndOffset('{a}}b}', 3), 5)
  // 左手边同理：光标压在 `(` 之后 ⇒ 那一个不算开块，往外找到 `f(` 的那个 `(` 之后。
  assert.equal(blockStartOffset('f(g(a), b)', 4), 2)
})

test('嵌套：块内光标只关掉当前这一层', () => {
  assert.equal(blockEndOffset('f(g(a), b)', 4), 5, '光标在 a 上：关掉 g( 的那一对')
  assert.equal(blockStartOffset('f(g(a), b)', 4, ), 2)
})

test('找不到块 ⇒ null（上游的 -1，命令据此不吞键）', () => {
  assert.equal(codeBlockTarget('no braces here', 3, true), null)
  assert.equal(codeBlockTarget('no braces here', 3, false), null)
  assert.equal(blockStartOffset('(', 0), null)
})

test('命令：光标移动不带选区，±Shift 从原 lead 选到落点（CodeBlockUtil.java:63-68、:100-105）', () => {
  const text = '{ aaa\n  bbb\n}'
  const moved = run('block.end', text, { anchor: 3 })
  assert.equal(moved.ran, true)
  assert.equal(moved.state.selection.main.head, text.length - 1)
  assert.equal(moved.state.selection.main.empty, true, '不带 Shift 时清掉选区')

  const selected = run('block.endSelect', text, { anchor: 3 })
  assert.equal(selected.state.selection.main.anchor, 3, 'anchor 停在原来的 lead 偏移')
  assert.equal(selected.state.selection.main.head, text.length - 1)

  assert.equal(run('block.start', text, { anchor: 8 }).state.selection.main.head, 1)
})

test('命令：多光标逐个算（上游 Handler 是 ForEachCaret，CodeBlockStartAction.java:22）', () => {
  const text = '{ a } b { c }'
  // 要开 `allowMultipleSelections`，否则 CodeMirror 先把两个光标折成一个（判据就成空转）。
  const base = EditorState.create({ doc: text, extensions: [EditorState.allowMultipleSelections.of(true)] })
  let state = base.update({
    selection: EditorSelection.create([EditorSelection.cursor(2), EditorSelection.cursor(10)], 0),
  }).state
  assert.equal(state.selection.ranges.length, 2, '判据真的是两个光标')
  const view = { get state() { return state }, dispatch: (...specs) => { state = state.update(...specs).state } }
  assert.equal(editingCommands['block.end'](view), true)
  assert.deepEqual(state.selection.ranges.map(range => range.head), [4, 12])
})

test('命令：没有块时不动也不吞键', () => {
  const result = run('block.end', 'plain text', { anchor: 3 })
  assert.equal(result.ran, false)
  assert.equal(result.state.selection.main.head, 3)
})
