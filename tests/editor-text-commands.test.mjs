// 文本操作四条命令的判据：复制整行 / 转置 / 交换选区边界 / 在当前行之前开始新行。
//
// 上游：动作注册 `platform/platform-impl/resources/intellij.platform.ide.impl.actions.xml:221,261,283,284`；
// 行为判据逐条对过上游自带测试 —— `platform/platform-tests/testSrc/com/intellij/openapi/editor/actions/`
// 的 `EditorActionTest.java:329-378`（Swap / DuplicateLines）与 `TransposeTest.kt:8-42`（Transpose 六条），
// 以及 `platform/platform-tests/testSrc/com/intellij/codeInsight/PlainTextEditingTest.java:140-170`
// （StartNewLineBefore）。断言体按这些用例复刻。
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { EditorState, EditorSelection } from '@codemirror/state'
import {
  duplicateLines, duplicateLinesCommand, duplicateLinesPlan, isAtLineStart, nextCodePointOffset,
  previousCodePointOffset, rotateSelections, startNewLineBefore, startNewLineBeforeCommand,
  swapSelectionBoundaries, swapSelectionBoundariesCommand, transpose, transposeCarets,
  transposeCommand,
} from '../src/editorTextCommands.ts'
import { lineStarts } from '../src/autoIndentLines.ts'

const MULTI = EditorState.allowMultipleSelections.of(true)

/** 造一个带多光标能力的 EditorState，并跑一条命令（与仓里 editor-caret-clone 的跑法同形状）。 */
function run(command, selection, doc) {
  let state = EditorState.create({ doc, selection, extensions: [MULTI] })
  const view = { get state() { return state }, dispatch: (...specs) => { state = state.update(...specs).state } }
  return { ran: command(view), state }
}

const cur = offset => EditorSelection.cursor(offset)
const sel = (from, to) => EditorSelection.range(from, to)

// ── 复制整行（`EditorDuplicateLines`，DuplicateLinesAction.java:17,24,43）──────────────────

test('复制整行：选区尾正好压在行首 ⇒ 尾拉回一格（DuplicateLinesAction.java:28-30）', () => {
  const text = 'a\nb\nc'
  const starts = lineStarts(text)
  assert.equal(isAtLineStart(text, starts, 4), true, '第 3 行行首是 4')
  assert.equal(isAtLineStart(text, starts, 3), false)
  // 上游 EditorActionTest.java:344-348：`a\n<selection>b\n</selection>c` → `a\nb\n<selection>b\n</selection>c`
  const plan = duplicateLinesPlan(text, starts, 2, 4, 4)
  assert.equal(text.slice(0, plan.at) + plan.insert + text.slice(plan.at), 'a\nb\nb\nc')
  assert.deepEqual(plan.selection, { from: 4, to: 6 }, '复制出来的 b\\n 被重新选中')
})

test('复制整行：末行（块不以 \\n 收尾）时补一个换行（DuplicateAction.java:71-75）', () => {
  // 上游 EditorActionTest.java:350-354：`a<selection>b\nc</selection>d` → `ab\ncd\n<selection>ab\ncd</selection>`
  const result = duplicateLines('ab\ncd', { from: 1, to: 4 })
  assert.equal(result.text, 'ab\ncd\nab\ncd')
  assert.deepEqual(result.selection, { anchor: 6, head: 11 })
})

test('复制整行：无选区时复制光标所在整行，光标落到副本行首（:36-39 + DuplicateAction.java:78）', () => {
  const result = duplicateLines('one\ntwo\nthree', { from: 4, to: 4 }, 4)
  assert.equal(result.text, 'one\ntwo\ntwo\nthree')
  assert.deepEqual(result.selection, { anchor: 8, head: 8 })
})

test('复制整行：多光标逐行各复制一次，靠后的光标先做（reverseCaretOrder :43）', () => {
  // 上游 EditorActionTest.java:356-378 的用例：三个光标各在行首，复制后各自停在副本行首。
  const doc = 'one\ntwo\nthree\n'
  const out = run(duplicateLinesCommand, EditorSelection.create([cur(0), cur(4), cur(8)], 0), doc)
  assert.equal(out.ran, true)
  assert.equal(out.state.doc.toString(), 'one\none\ntwo\ntwo\nthree\nthree\n')
  assert.deepEqual(out.state.selection.ranges.map(range => range.head), [4, 12, 22])
})

test('复制整行：只读文档不做事', () => {
  const state = EditorState.create({ doc: 'a\nb', extensions: [EditorState.readOnly.of(true)] })
  assert.equal(duplicateLinesCommand({ state }), false)
})

// ── 转置（`EditorTranspose`，TransposeAction.kt:13）—— 六条照 TransposeTest.kt:8-42 ──────────

test('转置：行中交换左右两个字符，光标落到右字符之后（TransposeTest.kt:8-12）', () => {
  const out = transposeCarets('abcd', [2])
  assert.equal(out.text, 'acbd')
  assert.deepEqual(out.carets, [3])
})

test('转置：光标离行尾还有字符时走行中一支（TransposeTest.kt:14-18）', () => {
  const out = transposeCarets('abcd\ndefg', [3])
  assert.equal(out.text, 'abdc\ndefg')
  assert.deepEqual(out.carets, [4])
})

test('转置：光标在行尾 ⇒ 换前两个字符、光标不动（TransposeTest.kt:20-24）', () => {
  const out = transposeCarets('abcd\nqwer', [4])
  assert.equal(out.text, 'abdc\nqwer')
  assert.deepEqual(out.carets, [4])
})

test('转置：光标在行首 ⇒ 换行尾换行符与首字符（TransposeTest.kt:26-30）', () => {
  const out = transposeCarets('abcd\nqwer', [5])
  assert.equal(out.text, 'abcdq\nwer')
  assert.deepEqual(out.carets, [6])
})

test('转置：单字符行的行尾只换得动一个（TransposeTest.kt:32-36）', () => {
  const out = transposeCarets('abc\nd\nqwer', [5])
  assert.equal(out.text, 'abcd\n\nqwer')
  assert.deepEqual(out.carets, [5])
})

test('转置：一个字符的文档里没有可换的 ⇒ 不做事（TransposeTest.kt:38-42）', () => {
  assert.equal(transposeCarets('a', [1]), null)
})

test('转置：码点边界按代理对走（DocumentUtil.java:115-143）', () => {
  assert.equal(previousCodePointOffset('a\u{1F600}b', 3), 1, '表情占两个 UTF-16 单元')
  assert.equal(nextCodePointOffset('a\u{1F600}b', 1), 3)
  assert.equal(transposeCarets('\u{1F600}x', [2]).text, 'x\u{1F600}', '整个表情与 x 交换，不切开')
})

test('转置：全有选区 ⇒ 轮转选区内容（TransposeAction.kt:55-78）', () => {
  const rotated = rotateSelections('aabbcc', [{ from: 0, to: 2 }, { from: 2, to: 4 }])
  assert.equal(rotated.text, 'bbaa' + 'cc', '降序排列后去首接尾：第二个选区拿到第一个的文本')
  assert.equal(rotateSelections('aabbcc', [{ from: 0, to: 2 }]), null, '少于两个选区不轮转（:60）')
})

test('转置：光标与选区混在一起时什么都不做（TransposeAction.kt:16-21 两条 isSuitable 都不成立）', () => {
  assert.equal(transpose('abcd', [{ anchor: 1, head: 1 }, { anchor: 2, head: 3 }]), null)
})

test('转置命令：无选区多光标各换一次', () => {
  const out = run(transposeCommand, EditorSelection.create([cur(1), cur(4)], 0), 'ab\ncd')
  assert.equal(out.ran, true)
  assert.equal(out.state.doc.toString(), 'ba\ndc')
  assert.deepEqual(out.state.selection.ranges.map(range => range.head), [2, 5])
})

// ── 交换选区边界（`EditorSwapSelectionBoundaries`，SwapSelectionBoundariesAction.java:18,26）──

test('交换选区边界：对调 anchor/head（:30-46）', () => {
  assert.deepEqual(swapSelectionBoundaries({ anchor: 1, head: 2 }), { anchor: 2, head: 1 })
  assert.deepEqual(swapSelectionBoundaries({ anchor: 2, head: 1 }), { anchor: 1, head: 2 })
})

test('交换选区边界：没有选区就什么都不做（:27-29）', () => {
  assert.equal(swapSelectionBoundaries({ anchor: 3, head: 3 }), null)
})

test('交换选区边界命令：逐光标各对调一次（ForEachCaret :24）', () => {
  const out = run(swapSelectionBoundariesCommand, EditorSelection.create([sel(1, 2), sel(5, 7)], 0), 'a\nbb\nccc')
  assert.equal(out.ran, true)
  assert.deepEqual(out.state.selection.ranges.map(range => [range.anchor, range.head]), [[2, 1], [7, 5]])
})

test('交换选区边界命令：全无选区 ⇒ 不吞键', () => {
  const out = run(swapSelectionBoundariesCommand, cur(2), 'abc')
  assert.equal(out.ran, false)
})

// ── 在当前行之前开始新行（`EditorStartNewLineBefore`，StartNewLineBeforeAction.java:17,25）──

test('在当前行之前开始新行：行首插一个空行、光标停在新空行（PlainTextEditingTest.java:140-170）', () => {
  const result = startNewLineBefore('  foo\nbar', 8)
  assert.equal(result.text, '  foo\n\nbar', '原行前多一个空行，原行缩进不动')
  assert.deepEqual(result.selection, { anchor: 6, head: 6 }, '光标停在新空行的行首（= 行尾，空行同偏移）')
})

test('在当前行之前开始新行：第一行与空文档', () => {
  assert.equal(startNewLineBefore('foo', 2).text, '\nfoo')
  assert.deepEqual(startNewLineBefore('foo', 2).selection, { anchor: 0, head: 0 })
  assert.equal(startNewLineBefore('', 0).text, '\n')
})

test('在当前行之前开始新行命令：选区先被清掉（StartNewLineBeforeAction.java:31）', () => {
  const out = run(startNewLineBeforeCommand, sel(4, 7), 'one\ntwo')
  assert.equal(out.ran, true)
  assert.equal(out.state.doc.toString(), 'one\n\ntwo')
  assert.equal(out.state.selection.main.empty, true, '落点是一个光标，不是选区')
})

test('在当前行之前开始新行命令：只读文档不做事', () => {
  const state = EditorState.create({ doc: 'a', extensions: [EditorState.readOnly.of(true)] })
  assert.equal(startNewLineBeforeCommand({ state }), false)
})

// ── 落点留痕：模块头必须引上游坐标（不然下次又被当成"IDEA 一般是…"）────────────────────────

test('模块头引了四个动作、两条测试与文案键位出处', () => {
  const src = readFileSync('src/editorTextCommands.ts', 'utf8')
  for (const anchor of [
    /intellij\.platform\.ide\.impl\.actions\.xml:221/,
    /:261/, /:283/, /:284/,
    /DuplicateLinesAction\.java:17,24,43/,
    /TransposeAction\.kt:13/,
    /SwapSelectionBoundariesAction\.java:18,26/,
    /StartNewLineBeforeAction\.java:17,25/,
    /EditorActionTest\.java:329-342/,
    /TransposeTest\.kt:8-42/,
    /PlainTextEditingTest\.java:140-170/,
    /ActionsBundle\.properties:132/,
    /:2698/,
    /localization-zh\.jar/,
    /keymaps\/\$default\.xml:550-552/,
  ]) {
    assert.match(src, anchor, `模块头缺上游坐标 ${anchor}`)
  }
})

test('落点留痕：不重复实现已存在的排序/去重/反串（那三条在 src/editorLineOps.ts）', () => {
  const src = readFileSync('src/editorTextCommands.ts', 'utf8')
  assert.match(src, /editorLineOps\.ts/, '模块头要写明排序那一族不在这里')
  assert.doesNotMatch(src, /export const sortLinesCommand/, '不许再导出第二份 sortLinesCommand')
})
