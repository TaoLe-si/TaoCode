// 填充段落（上游 `FillParagraphAction` / `ParagraphFillHandler`，
// 注册 `intellij.platform.lang.impl.actions.xml:340`，菜单次序 `PlatformActions.xml:494`）。
import test from 'node:test'
import assert from 'node:assert/strict'
import { EditorSelection, EditorState } from '@codemirror/state'
import { java } from '@codemirror/lang-java'
import { DEFAULT_PARAGRAPH_MARGIN, fillParagraph, fillParagraphCommand, paragraphAt, wrapToMargin } from '../src/editorFillParagraph.ts'

function run(command, doc, anchor, extensions = []) {
  let state = EditorState.create({ doc, selection: { anchor }, extensions })
  const view = { get state() { return state }, dispatch: (...specs) => { state = state.update(...specs).state } }
  return { ran: command(view), text: state.doc.toString() }
}

test('段落 = 光标上下到空行为止，起点跳过行首空白（ParagraphFillHandler.java:97-122、:128-148）', () => {
  const text = 'head\n\n  first line\n  second line\n\nfoot'
  assert.deepEqual(paragraphAt(text, text.indexOf('second')), { from: 8, to: 32 })
  assert.equal(paragraphAt(text, text.indexOf('head')), null, '单行段落上游也什么都不做')
  assert.equal(paragraphAt(text, text.indexOf('\n\nfoot') + 2), null, '空行里没有段落')
})

test('粘回去：逐行 trim、丢空行、单空格相接（:41-53）', () => {
  assert.equal(fillParagraph('aaa\n  bbb\nccc\n', 0, DEFAULT_PARAGRAPH_MARGIN).text, 'aaa bbb ccc\n')
})

test('折行按右边距，续行沿用原缩进（LineWrappingUtil.java:118-165）', () => {
  assert.equal(wrapToMargin('aaa bbb ccc', 11, ''), 'aaa bbb ccc')
  assert.equal(wrapToMargin('aaa bbb ccc', 9, ''), 'aaa bbb\nccc')
  assert.equal(wrapToMargin('aaa bbb ccc ddd', 9, '  '), 'aaa bbb\n  ccc ddd')
})

test('填完之后再折：整段重排不越过右边距', () => {
  const result = fillParagraph('alpha\nbravo\ncharlie\ndelta\necho\n\nnext', 0, 14)
  assert.equal(result.text, 'alpha bravo\ncharlie delta\necho\n\nnext')
  assert.equal(result.caret, 0, '光标落在段落起点')
})

test('续行沿用首行缩进（:154 的 emulateEnter）', () => {
  assert.equal(fillParagraph('  alpha\n  bravo charlie\n', 2, 12).text, '  alpha bravo\n  charlie\n')
})

test('一个词就越过右边距 ⇒ 不折（:145-150）；新行内容不比留下的部分长也不折（:157-158）', () => {
  assert.equal(wrapToMargin('aaaaaaaaaaaaaaaa', 6, '  '), 'aaaaaaaaaaaaaaaa')
  assert.equal(wrapToMargin('xx yyyyyyyy', 6, '    '), 'xx yyyyyyyy')
})

test('无可填段落 ⇒ null（命令据此不吞键）', () => {
  assert.equal(fillParagraph('one line only', 0), null)
  assert.equal(fillParagraph('\n\n', 1), null)
})

test('命令层：纯文本动手，配了语言（代码文件）不动手', () => {
  const text = 'alpha\nbravo\n\nnext'
  assert.deepEqual(run(fillParagraphCommand, text, 0), { ran: true, text: 'alpha bravo\n\nnext' })
  const coded = run(fillParagraphCommand, text, 0, [java()])
  assert.equal(coded.ran, false, '上游的 isAvailableForFile 只管纯文本（ParagraphFillHandler.java:208-210）')
  assert.equal(coded.text, text, '一个字都不该改')
})

test('命令层：只读文档与多光标不动手', () => {
  let state = EditorState.create({ doc: 'alpha\nbravo\n', selection: { anchor: 0 }, extensions: [EditorState.readOnly.of(true)] })
  const view = { get state() { return state }, dispatch: (...specs) => { state = state.update(...specs).state } }
  assert.equal(state.readOnly, true, '判据打的是真只读，不是配置里的假开关')
  assert.equal(fillParagraphCommand(view), false)
  state = EditorState.create({
    doc: 'alpha\nbravo\n',
    extensions: [EditorState.allowMultipleSelections.of(true)],
  }).update({
    selection: EditorSelection.create([EditorSelection.cursor(0), EditorSelection.cursor(6)], 0),
  }).state
  assert.equal(state.selection.ranges.length, 2, '判据真的是多光标')
  const multi = { get state() { return state }, dispatch: (...specs) => { state = state.update(...specs).state } }
  assert.equal(fillParagraphCommand(multi), false)
})
