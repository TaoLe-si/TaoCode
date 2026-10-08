// 补全插入处理器 / 尾类型的判据（实现：src/completionInsertHandlers.ts）。
//
// 本轮删掉了本文件曾经覆盖的一个出口 `planSpaceTail`：它既不是 `planTail` 的 switch 分支、
// 也不是 `tailForCompletion` 会产出的尾类型（`src/` 全域只有这里的判据在调它）⇒ 死代码，
// 按「死代码直接删」移除；它原先注释里那两条与上游相反的说法记在实现文件头的「订正留痕」。
// 「补一个空格」那一档**活着的实现**是关键字条目走的 `planCharTail(…, ' ', true)`，
// 下面第 3 条把它的行尾/空格/越界三档钉住（把行尾改成"不补"就红）。
import test from 'node:test'
import assert from 'node:assert/strict'

import {
  applyRelativeEdits,
  planCharTail,
  planCompletionTail,
  planHumbleSpace,
  planParensTail,
  tailForCompletion,
} from '../src/completionInsertHandlers.ts'

test('关键字条目的尾类型 = 补一个空格（活的那条路，不是被删的 planSpaceTail）', () => {
  assert.deepEqual(tailForCompletion('keyword', 'return'), { kind: 'char', char: ' ', overwrite: true })
  assert.deepEqual(planCompletionTail('foo', 'keyword', 'return'), { insert: ' ', caret: 1 })
})

test('AddSpaceInsertHandler / insertChar：行尾**要补**、后继同字符且 overwrite 才只越过', () => {
  // 上游两条判据同方向：`AddSpaceInsertHandler.java:68-72` 的 `isCharAtSpace` 在光标后面没有字符时
  // 是**假**（`getTextLength() > startOffset` 不成立）⇒ 走 `:51-53` 插入那一支；
  // `TailType.java:50-54` 的第一个条件就是 `tailOffset == textLength` ⇒ 插。
  assert.deepEqual(planCharTail('', ' ', true), { insert: ' ', caret: 1 },
    '行尾必须补 —— 旧实现里那份被删的 planSpaceTail 把这一格写成"不补"，与上游相反')
  assert.deepEqual(planCharTail(' ', ' ', true), { insert: '', caret: 1 }, '后继已是空格 ⇒ 光标越过去')
  assert.deepEqual(planCharTail('  x', ' ', true), { insert: '', caret: 1 }, '两个空格时只越过一个，不吞用户输入')
  assert.deepEqual(planCharTail('x', ' ', true), { insert: ' ', caret: 1 })
})

test('CharTailType：后继同字符且 overwrite ⇒ 不插入，只把光标后移', () => {
  assert.deepEqual(planCharTail(';', ';', true), { insert: '', caret: 1 })
  assert.deepEqual(planCharTail('', ';', true), { insert: ';', caret: 1 })
  assert.deepEqual(planCharTail(';', ';', false), { insert: ';', caret: 1 }, 'overwrite=false 时总是插')
})

test('HumbleSpaceBeforeWordTailType：空格后跟词/@ 不插，否则总是插', () => {
  assert.deepEqual(planHumbleSpace(' foo'), { insert: '', caret: 0 })
  assert.deepEqual(planHumbleSpace(' @Override'), { insert: '', caret: 0 })
  assert.deepEqual(planHumbleSpace('('), { insert: ' ', caret: 1 })
  assert.deepEqual(planHumbleSpace(' '), { insert: ' ', caret: 1 }, '空格后不是词 ⇒ 仍插（overwrite=false）')
})

test('方法条目补 () 且光标落在括号内；后继已是 ( 时只移进去', () => {
  assert.deepEqual(planParensTail(''), { insert: '()', caret: 1 })
  assert.deepEqual(planParensTail('foo'), { insert: '()', caret: 1 })
  assert.deepEqual(planParensTail('(x)'), { insert: '', caret: 1 })
})

test('按 LSP 条目种类选尾类型；带括号/空格的 insertText 不重复加工', () => {
  assert.deepEqual(tailForCompletion('keyword', 'return'), { kind: 'char', char: ' ', overwrite: true })
  assert.deepEqual(tailForCompletion('method', 'getName'), { kind: 'parens' })
  assert.deepEqual(tailForCompletion('function', 'f'), { kind: 'parens' })
  assert.deepEqual(tailForCompletion('method', 'getName()'), { kind: 'none' }, '服务端形状不许再加工')
  assert.deepEqual(tailForCompletion('variable', 'count'), { kind: 'none' })
  assert.deepEqual(planCompletionTail('x', 'keyword', 'return'), { insert: ' ', caret: 1 })
  assert.deepEqual(planCompletionTail('()', 'method', 'foo'), { insert: '', caret: 1 })
})

test('DeclarativeInsertHandler 相对编辑：偏移独立、禁用相交、光标按全部应用后算', () => {
  // 基准文本 '____'，插入点在 1；相对编辑 (0,0) 与 (2,2) 都换算回**原文本**坐标（1 与 3），
  // 从后往前套用，互不按对方已应用来推算。
  const plan = applyRelativeEdits('____', 1, [
    { from: 0, to: 0, insert: 'AA' },
    { from: 2, to: 2, insert: 'BB' },
  ], 0)
  assert.equal(plan.error, undefined)
  assert.equal(plan.text, '_AA__BB_')
  assert.equal(plan.caret, 1, 'caretOffset 相对插入点，按所有操作都应用后的坐标给')
  const overlap = applyRelativeEdits('abcd', 0, [{ from: 0, to: 2, insert: 'x' }, { from: 1, to: 3, insert: 'y' }], 0)
  assert.equal(overlap.error, '相对编辑区间相交')
  assert.equal(overlap.text, 'abcd', '契约被违反时不产生错乱文本')
  const outside = applyRelativeEdits('abcd', 0, [{ from: 0, to: 9, insert: 'x' }], 0)
  assert.equal(outside.error, '相对编辑越界')
})
