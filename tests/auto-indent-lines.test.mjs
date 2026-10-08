// 自动缩进整行的判据 —— `src/autoIndentLines.ts`。
//
// 上游依据（逐条核过）：
//   · `platform/lang-impl/src/com/intellij/codeInsight/generation/AutoIndentLinesHandler.java:29-66`
//     —— 有选区取 `[selectionStart, selectionEnd - 1]`，无选区两点都取光标偏移；
//     `line1` = startOffset 所在行，`col` = 光标的逻辑列。
//   · `:68-82` `adjustLineIndent`：无选区只看一行、先过 `isLineToBeIndented`，
//     有选区对 `[lineStartOffset(startOffset), endOffset]` 整体重算 —— 调的是
//     `CodeStyleManager.adjustLineIndent`（**重算**行首空白，不是加一级）。
//   · `:57-65` 收尾：无选区且不在最后一行时，光标移到下一行同一列，列超长夹到行尾。
//   · `platform/code-style-impl/.../CodeStyleManagerImpl.java:368-400` `isLineToBeIndented`：
//     纯空白行（shiftForward 到 EOF）、WHITE_SPACE、PLAIN_TEXT 三档都返回 false。
// 动作注册 `platform/lang-impl/resources/intellij.platform.lang.impl.actions.xml:200`，
// 键位 `$default.xml` 的 `AutoIndentLines`。
import test from 'node:test'
import assert from 'node:assert/strict'

import {
  autoIndentCaretAfter, autoIndentEdits, autoIndentTarget, expectedIndentLevel,
  indentText, leadingWhitespace, lineAt, lineStarts, lineToBeIndented,
} from '../src/autoIndentLines.ts'
import { depthProfile } from '../src/structuralCodeBlock.ts'

const SP = '    '

test('lineStarts / lineAt：行首偏移与偏移→行号', () => {
  const text = 'a\nbb\n\nccc'
  assert.deepEqual(lineStarts(text), [0, 2, 5, 6])
  assert.equal(lineAt(lineStarts(text), 0), 0)
  assert.equal(lineAt(lineStarts(text), 2), 1)
  assert.equal(lineAt(lineStarts(text), 6), 3)
})

test('leadingWhitespace：行首空白区间', () => {
  assert.deepEqual(leadingWhitespace('   x', 0), { to: 3, indent: '   ' })
  assert.deepEqual(leadingWhitespace('\tx', 0), { to: 1, indent: '\t' })
  assert.deepEqual(leadingWhitespace('x', 0), { to: 0, indent: '' })
})

test('lineToBeIndented：纯空白行 / 字符串注释里的首字符不缩进', () => {
  const text = 'if (a) {\n\n  // c\n}\n'
  const p = depthProfile(text)
  const starts = lineStarts(text)
  // 第 2 行（索引 1）是空行
  assert.equal(lineToBeIndented(text, starts[1], starts[2] - 1, p.trivia), false)
  // 第 3 行首字符在行注释里 ⇒ 不缩进
  const l3 = starts[2] + 2 // 跳过两个空格到 `//`
  assert.equal(lineToBeIndented(text, l3, starts[3] - 1, p.trivia), false)
})

test('expectedIndentLevel：按括号深度；闭括号行退一级', () => {
  const text = 'a {\n    b\n}\n'
  const p = depthProfile(text)
  const starts = lineStarts(text)
  assert.equal(expectedIndentLevel(text, starts[1], p.depth), 1)      // `b` 在 `{` 内
  assert.equal(expectedIndentLevel(text, starts[2], p.depth), 0)      // `}` 退一级
  assert.equal(indentText(2, SP), '        ')
})

test('autoIndentEdits：重算行首空白，不改已经是正确缩进的行', () => {
  const text = 'if (a) {\nwrong\n}\n'
  const edits = autoIndentEdits(text, 0, text.length - 1, SP)
  // 第 1 行（`if`）已顶格、不动；第 2 行 `wrong` 应缩进 4；第 3 行 `}` 顶格不动
  assert.deepEqual(edits, [{ from: 9, to: 9, insert: SP, level: 1 }])
})

test('autoIndentEdits：把过深的缩进拨回来', () => {
  const text = 'a {\n        b\n}\n'
  const edits = autoIndentEdits(text, 0, text.length - 1, SP)
  assert.deepEqual(edits, [{ from: 4, to: 12, insert: SP, level: 1 }])
})

test('autoIndentEdits：空行与注释行跳过', () => {
  const text = 'a {\n\n    // note\n}\n'
  const edits = autoIndentEdits(text, 0, text.length - 1, SP)
  assert.deepEqual(edits, [], '空行不动、注释行首字符在注释里也不动')
})

test('autoIndentTarget：有选区取 [start, end-1]；无选区取光标', () => {
  assert.deepEqual(autoIndentTarget({ hasSelection: true, selectionStart: 3, selectionEnd: 10, caret: 4, column: 1 }),
    { from: 3, to: 9, line: 0, column: 1 })
  assert.deepEqual(autoIndentTarget({ hasSelection: false, selectionStart: 7, selectionEnd: 7, caret: 7, column: 2 }),
    { from: 7, to: 7, line: 0, column: 2 })
})

test('autoIndentCaretAfter：移到下一行同一列，超长夹到行尾', () => {
  const text = 'long line here\nshort\nlast\n'
  // 末尾的 `\n` 让文档有第 4 行（空行）；上游 `line1 < getLineCount() - 1` 为真 ⇒ 移到它。
  assert.deepEqual(autoIndentCaretAfter(text, 0, 10), { line: 1, column: 5 })
  assert.deepEqual(autoIndentCaretAfter(text, 2, 3), { line: 3, column: 0 })
  // 没有末尾换行时 `last` 就是最后一行（`getLineCount() - 1 == 2`）⇒ 不动光标。
  assert.equal(autoIndentCaretAfter('long line here\nshort\nlast', 2, 0), null, '最后一行不动光标')
})

test('autoIndentEdits：有选区时只重算选区覆盖的行', () => {
  const text = 'a {\nbad\nbad2\n}\n'
  // 选区从第 2 行行首到第 3 行行尾
  const from = 5
  const to = 12
  const edits = autoIndentEdits(text, from, to, SP)
  assert.deepEqual(edits.map(e => e.level), [1, 1])
})