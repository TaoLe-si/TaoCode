// 列选择模式里的 Delete（上游 `DeleteInColumnModeHandler`）判据。
// 规则来源：`platform/platform-impl/src/com/intellij/openapi/editor/actions/DeleteInColumnModeHandler.java`
// （:25 三道门槛、:30-34 逐光标「行尾且无选区的那一条不动手」、:37 其余交回原 handler），
// 注册位 `platform/platform-impl/resources/intellij.platform.ide.impl.xml:1084`（**只有** EditorDelete）。
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { EditorSelection, EditorState, Text } from '@codemirror/state'

import { columnBlockDeletePlan, columnBlockDeletable, deleteInColumnModeCommand, inColumnMode } from '../src/editorColumnMode.ts'

const docOf = lines => Text.of(lines)
const at = (from, to = from) => ({ from, to, head: to })

test('短行口径：切点在本行行尾且没有选区 ⇒ 不动手（:33 的 offset < lineEnd || hasSelection）', () => {
  // 'abcde'(0..5) 'ab'(6..8) 'abc'(9..12) —— 矩形第 3..5 列：第一行有选区，另两行被夹成行尾空光标。
  const doc = docOf(['abcde', 'ab', 'abc'])
  assert.deepEqual([at(3, 5), at(8), at(12)].map(range => columnBlockDeletable(range, doc)), [true, false, false])
  assert.equal(columnBlockDeletable(at(7), doc), true, '行中间的空光标要删（向后删一个字符）')
  assert.equal(columnBlockDeletable(at(8, 9), doc), true, '有选区就删，哪怕切点在行尾')
  assert.equal(columnBlockDeletable(at(3), docOf(['ab', '', 'cd'])), false, '中间那条空行：3 就是它的行尾 ⇒ 不动')
})

test('算式：只删能动的那些；落点按**改动后**的坐标回给 CodeMirror（selection 的约定）', () => {
  const plan = columnBlockDeletePlan([at(3, 5), at(8), at(12)], docOf(['abcde', 'ab', 'abc']))
  assert.deepEqual([...plan.changes], [{ from: 3, to: 5, insert: '' }], '只有第一行那条进 changes，行尾那两条不动')
  assert.deepEqual([...plan.heads], [3, 6, 10], '后两条原地不动 = 各减去前面那刀删掉的 2 个字符')
})

test('全部都能动手 ⇒ 返回 null，让键继续走 basicSetup（= 上游 :37 交回原 handler）', () => {
  assert.equal(columnBlockDeletePlan([at(1, 2), at(8, 9)], docOf(['abcde', 'abcdef'])), null)
})

function run (lines, spans, { column = true, multiple = true } = {}) {
  const doc = lines.join('\n')
  const selection = EditorSelection.create(spans.map(([from, to]) => EditorSelection.range(from, to)), 0)
  let state = EditorState.create({
    doc, selection,
    extensions: [EditorState.allowMultipleSelections.of(multiple), ...(column ? [inColumnMode.of(true)] : [])],
  })
  const view = { get state () { return state }, dispatch: (...specs) => { state = state.update(...specs).state } }
  return { ran: deleteInColumnModeCommand(view), text: state.doc.toString(), heads: state.selection.ranges.map(range => range.head) }
}

test('列模式 + 多光标：短行没被并上来，只有第一行的块被删（改动前三行会并成一行）', () => {
  const done = run(['abcde', 'ab', 'abc'], [[3, 5], [8, 8], [12, 12]])
  assert.equal(done.ran, true)
  assert.equal(done.text, 'abc\nab\nabc', '改动前走 CM 的 deleteCharForward ⇒ 两条短行的换行也被删掉，三行并成一行')
  assert.deepEqual(done.heads, [3, 6, 10])
})

test('门槛一：不在列模式 ⇒ 整条不接管（:25 的 isColumnMode）', () => {
  const done = run(['abcde', 'ab'], [[3, 5], [8, 8]], { column: false })
  assert.equal(done.ran, false)
  assert.equal(done.text, 'abcde\nab', '没进列模式时 Delete 还是 CM 的默认档，本命令一步都不做')
})

test('门槛二：只有一个光标 ⇒ 不接管（:25 的 caretCount > 1）', () => {
  const done = run(['abcde'], [[3, 5]], { multiple: false })
  assert.equal(done.ran, false)
  assert.equal(done.text, 'abcde')
})

test('有选区的那条删完光标停在选区头，行尾那条原地不动（:33 两支各走一边）', () => {
  const done = run(['abcdef', 'xyz'], [[2, 4], [10, 10]])
  assert.equal(done.text, 'abef\nxyz', '第二行行尾那条不动')
  assert.deepEqual(done.heads, [2, 8])
})

test('空光标且不在行尾 ⇒ 向后删一个字符（交回原 handler 的语义），行尾那条仍然不动', () => {
  const done = run(['abcde', 'ab', 'abc'], [[7, 7], [12, 12]])
  assert.equal(done.text, 'abcde\na\nabc')
  assert.deepEqual(done.heads, [7, 11])
})

test('接线：Delete 绑在这条命令上，并且**只有** Delete（上游只注册了 EditorDelete）', () => {
  const view = readFileSync(new URL('../src/components/CodeEditor.vue', import.meta.url), 'utf8')
  assert.match(view, /\{ key: 'Delete', preventDefault: true, run: columnSelection\.deleteForward \}/,
    '列模式的 Delete 那一档没绑键 ⇒ 命令是死代码')
  assert.ok(view.indexOf(`{ key: 'Delete'`) < view.indexOf('basicSetup,'),
    'Delete 排在 basicSetup 之后 ⇒ 默认档先赢，这一档永远问不到')
  assert.doesNotMatch(view, /key: 'Backspace'[^}]*deleteForward/,
    '上游没有给 Backspace 包这一档（ide.impl.xml:1084 只有 EditorDelete）⇒ 不许顺手加')
  // 模式位与 rectangularSelection 挂在同一个 Compartment 里，命令才问得到。
  assert.match(view, /import \{ splitLineCommand \} from '\.\.\/editorSplitLine'; import \{ createColumnSelection \} from '\.\.\/editorColumnMode'/)
  assert.match(view, /const columnSelection = createColumnSelection\(\(\) => view, active => emit\('columnMode', active\)\)/)
  assert.match(view, /columnSelection\.extension,/)
  const host = readFileSync(new URL('../src/editorColumnMode.ts', import.meta.url), 'utf8')
  assert.match(host, /rectangularSelection\(\{ eventFilter: event => event\.button === 0 \}\), columnModeMarker/,
    '模式位没跟着 rectangularSelection 一起 reconfigure ⇒ 命令永远看不见列模式')
})
