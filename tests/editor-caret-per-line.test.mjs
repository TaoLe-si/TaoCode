// 在所选各行行尾加光标（上游 `EditorAddCaretPerSelectedLine`）的判据。
// 规则来源：`platform/platform-impl/src/com/intellij/openapi/editor/actions/AddCaretPerSelectedLineAction.java`
// （:27-31 取行与「选区尾压行首不算」、:33-36 上限、:40 primary、:41-51 每行行尾、:53 删原光标）。
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { EditorSelection, EditorState } from '@codemirror/state'

import { caretPerLinePlan } from '../src/editorCaretPerLine.ts'
import { MAX_CARET_COUNT } from '../src/editorCaretClone.ts'
import { editingCommands } from '../src/editorCommands.ts'

function linesOf (doc) {
  const lineStarts = []
  const lineEnds = []
  let at = 0
  for (const line of doc.split('\n')) {
    lineStarts.push(at)
    lineEnds.push(at + line.length)
    at += line.length + 1
  }
  return { lineStarts, lineEnds }
}
const input = (doc, ranges, maxCarets) => ({ ...linesOf(doc), ranges, maxCarets })
const heads = plan => plan.ranges.map(range => range.head)

function run (name, selection, doc) {
  // CodeMirror 默认不允许多光标 ⇒ 与 `tests/editor-caret-clone.test.mjs` 同款夹具要开这一档。
  let state = EditorState.create({ doc, selection, extensions: [EditorState.allowMultipleSelections.of(true)] })
  const view = { get state () { return state }, dispatch: (...specs) => { state = state.update(...specs).state } }
  return {
    ran: editingCommands[name](view),
    heads: state.selection.ranges.map(range => range.head),
    main: state.selection.main.head,
  }
}

test('整段选中 ⇒ 每个选中行行尾一个光标，原来的那一个被删掉（:41-51 + :53）', () => {
  const plan = caretPerLinePlan(input('abc\ndef\nghi', [{ anchor: 0, head: 11 }]))
  assert.deepEqual(heads(plan), [3, 7, 11])
  assert.equal(plan.mainIndex, 2, '光标停在选区尾 ⇒ 最后加的那个接管焦点（:40）')
})

test('选区尾正好压在下一行行首 ⇒ 那一行不算（:31）', () => {
  const touching = caretPerLinePlan(input('abc\ndef\nghi', [{ anchor: 0, head: 8 }]))
  assert.deepEqual(heads(touching), [3, 7], '第 2 行只是被行首那个偏移擦到，不加光标')
  const onePast = caretPerLinePlan(input('abc\ndef\nghi', [{ anchor: 0, head: 9 }]))
  assert.deepEqual(heads(onePast), [3, 7, 11], '再多一个字符就落在第 2 行里 ⇒ 那一行要加（点在行尾，不是 9）')
})

test('空选区 ⇒ 光标跳到本行行尾（只有一条，主光标就是它）', () => {
  const plan = caretPerLinePlan(input('abc\ndef\nghi', [{ anchor: 5, head: 5 }]))
  assert.deepEqual(heads(plan), [7])
  assert.equal(plan.mainIndex, 0)
})

test('反向选区（光标停在选区头）⇒ 没有 primary，焦点退回第一条（:40）', () => {
  const plan = caretPerLinePlan(input('abc\ndef\nghi', [{ anchor: 11, head: 0 }]))
  assert.deepEqual(heads(plan), [3, 7, 11])
  assert.equal(plan.mainIndex, 0)
})

test('多个已有光标各算一遍（ForEachCaret，:22）；撞在同一行行尾时去重（CaretModel.java:236-241）', () => {
  const plan = caretPerLinePlan(input('aaa\nbbbb\ncccc', [{ anchor: 0, head: 6 }, { anchor: 6, head: 11 }]))
  assert.deepEqual(heads(plan), [3, 8, 13], '第 1 行的行尾被两段各要一次 ⇒ 只留一个')
  assert.equal(plan.mainIndex, 2, '焦点给最后那个 primary（上游逐段 addCaret(makePrimary) 的最后一个）')
})

test('上限：超过 editor.max.caret.count 整条不做事（:33-36，本仓 1000 复用 src/editorCaretClone.ts）', () => {
  assert.equal(MAX_CARET_COUNT, 1000)
  const doc = 'a\nb\nc\nd'
  assert.deepEqual(heads(caretPerLinePlan(input(doc, [{ anchor: 0, head: 7 }]))), [1, 3, 5, 7])
  assert.equal(caretPerLinePlan(input(doc, [{ anchor: 0, head: 7 }], 3)), null,
    '四行 > 上限 3 ⇒ null（上游是那一个光标不做事 + balloon；本仓一次 dispatch ⇒ 整条不动，且静默）')
})

test('命令：走命令表里的 caret.perLine（菜单行与将来的键位都指同一个名字）', () => {
  const done = run('caret.perLine', EditorSelection.range(0, 11), 'abc\ndef\nghi')
  assert.equal(done.ran, true)
  assert.deepEqual(done.heads, [3, 7, 11])
  assert.equal(done.main, 11)
})

test('接线：命令名、菜单行、键位栏为空（键位面是保留文件，摘到键之前不放假加速键）', () => {
  const commands = readFileSync('src/editorCommands.ts', 'utf8')
  assert.match(commands, /'caret\.perLine': addCaretPerSelectedLineCommand,/)
  assert.match(commands, /from '\.\/editorCaretPerLine\.ts'/)
  const menu = readFileSync('src/menus/editMenu.ts', 'utf8')
  const row = menu.match(/ctx\.editable\('caret\.perLine', '([^']*)', '([^']*)', '([^']*)'\)/)
  assert.ok(row, '编辑菜单里没有 caret.perLine 那一行（上游 PlatformActions.xml:485-487 紧跟 $SelectAll）')
  assert.equal(row[2], '', '键位注册（keymapBindings/CodeEditor 都是保留文件）没落地之前，这一行不许写 Shift Alt G')
  // 位置：上游 `PlatformActions.xml:485-487` 的 `EditSelectGroup` 里 `$SelectAll` 之后**紧跟**这一条。
  assert.match(menu, /ctx\.editable\('selectAll'[^\n]*\n(?:\s*\/\/[^\n]*\n)*\s*ctx\.editable\('caret\.perLine'/,
    '这一行必须紧跟在「全选」之后（允许中间只有注释行）')
})
