// 格式化结果合并的判据（实现：src/formattingMerge.ts，上游 DocumentMerger 的接缝语义）。
import test from 'node:test'
import assert from 'node:assert/strict'

import { diffRegion, mergeFormattingResult } from '../src/formattingMerge.ts'

test('缓冲区没被动过 ⇒ 直接采用格式化结果', () => {
  const original = 'if(x){\nreturn 1\n}\n'
  const formatted = 'if (x) {\n  return 1\n}\n'
  const merged = mergeFormattingResult({ originalText: original, currentText: original, formattedText: formatted })
  assert.deepEqual(merged, { text: formatted, merged: true, reason: 'unchanged' })
})

test('格式化结果与原文一样 ⇒ 保留用户文本（无事可做）', () => {
  const original = 'a\n'
  const merged = mergeFormattingResult({ originalText: original, currentText: 'a\nb\n', formattedText: original })
  assert.equal(merged.merged, true)
  assert.equal(merged.reason, 'no-change')
  assert.equal(merged.text, 'a\nb\n')
})

test('用户在格式化区间之后打字 ⇒ 直接套用，用户输入保留', () => {
  const original = 'x=1\ny=2\n'
  const formatted = 'x = 1\ny = 2\n'
  const current = 'x=1\ny=2\nz=3\n'
  const merged = mergeFormattingResult({ originalText: original, currentText: current, formattedText: formatted })
  assert.equal(merged.merged, true)
  assert.equal(merged.text, 'x = 1\ny = 2\nz=3\n')
})

test('用户在格式化区间之前打字 ⇒ 格式化落到位移后的位置', () => {
  const original = 'a=1\nb=2\n'
  const formatted = 'a = 1\nb = 2\n'
  const current = '// note\na=1\nb=2\n'
  const merged = mergeFormattingResult({ originalText: original, currentText: current, formattedText: formatted })
  assert.equal(merged.merged, true)
  assert.equal(merged.reason, 'shifted')
  assert.equal(merged.text, '// note\na = 1\nb = 2\n')
})

test('用户改在格式化区间内 ⇒ 拒绝合并，保留用户文本（不覆盖正在编辑的内容）', () => {
  const original = 'x=1\ny=2\n'
  const formatted = 'x = 1\ny = 2\n'
  const current = 'x=9\ny=2\n'
  const merged = mergeFormattingResult({ originalText: original, currentText: current, formattedText: formatted })
  assert.equal(merged.merged, false)
  assert.equal(merged.reason, 'conflict')
  assert.equal(merged.text, current, '冲突时绝不写回格式化结果')
})

test('用户零宽插入落在格式化区间边界 ⇒ 也拒绝（坐标先后无法判定）', () => {
  const original = 'x=1\n'
  const formatted = 'x = 1\n'
  const merged = mergeFormattingResult({ originalText: original, currentText: 'x=1\n// c\n', formattedText: formatted })
  assert.equal(merged.merged, true, '区间之后插入是安全的')
  const boundary = mergeFormattingResult({ originalText: original, currentText: 'xZ=1\n', formattedText: formatted })
  assert.equal(boundary.merged, false, '插入落在格式化区间内 ⇒ 保守拒绝')
})

test('单区间 diff：公共前后缀之间就是要替换的段', () => {
  assert.deepEqual(diffRegion('abcdef', 'abXYef'), { start: 2, end: 4, replacement: 'XY' })
  assert.deepEqual(diffRegion('abc', 'abc'), { start: 3, end: 3, replacement: '' })
  assert.deepEqual(diffRegion('abc', 'abcd'), { start: 3, end: 3, replacement: 'd' })
})
