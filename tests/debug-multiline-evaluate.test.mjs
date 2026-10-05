// 多行求值对话框（上游 `XExpressionDialog` / `XDebuggerMultilineEditor`）与求值历史面板。
// 口径：DAP `evaluate` 只收单条表达式 ⇒ 多行按**逐行、同帧、按顺序**求值，失败行不阻断后续行
// （规则在 src/debugMultilineEvaluate.ts）。
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import {
  MULTILINE_MAX_LINES, multilineResultText, planMultilineEvaluate,
} from '../src/debugMultilineEvaluate.ts'

test('行计划：去空行/trim/保序，注释行原样交给适配器裁决', () => {
  const plan = planMultilineEvaluate('  a + 1  \n\n// note\n  b * 2\n')
  assert.deepEqual(plan.lines, ['a + 1', '// note', 'b * 2'])
  assert.equal(plan.skipped, 2, '两个空行')
  assert.equal(plan.truncated, 0)
})

test('行计划：超过上限截断并报被截断的行数', () => {
  const text = Array.from({ length: MULTILINE_MAX_LINES + 5 }, (_, index) => `v${index}`).join('\n')
  const plan = planMultilineEvaluate(text)
  assert.equal(plan.lines.length, MULTILINE_MAX_LINES)
  assert.equal(plan.truncated, 5)
  assert.equal(planMultilineEvaluate('').lines.length, 0)
})

test('结果文本与单行求值框同一格式：expr = value : type', () => {
  assert.equal(multilineResultText('a', '1'), 'a = 1')
  assert.equal(multilineResultText('a', '1', 'int'), 'a = 1 : int')
})

test('对话框组件：模式、逐行提交、历史面板三件事都在', () => {
  const dialog = readFileSync('src/components/DebugEvaluateDialog.vue', 'utf8')
  assert.match(dialog, /defineProps<\{\n\s*mode: 'expression' \| 'codeFragment'/)
  assert.match(dialog, /emit\('run', plan\.lines\)/)
  assert.match(dialog, /planMultilineEvaluate\(text\.value\)/)
  assert.match(dialog, /aria-label="求值历史"/)
  assert.match(dialog, /emit\('remove-history', entry\)/)
  assert.match(dialog, /emit\('clear-history'\)/)
  assert.match(dialog, /每行必须是一条可求值的表达式/)
})

test('面板接线：逐行求值真的走 dapEvaluate，成功行进历史，失败行标红不中断', () => {
  const panel = readFileSync('src/components/DebugPanel.vue', 'utf8')
  assert.match(panel, /async function runMultiline\(lines: string\[\]\)/)
  assert.match(panel, /const result = await dapEvaluate\(line, 'watch', frame\)/)
  assert.match(panel, /results\.push\(\{ expression: line, text: multilineResultText\(line, result\.result, result\.type\), error: false \}\)/)
  assert.match(panel, /catch \(caught\) \{\n\s*results\.push\(\{ expression: line, text: `\$\{line\}：\$\{message\(caught\)\}`, error: true \}\)/)
  assert.match(panel, /exprHistory\.value = pushEvaluateHistory\(exprHistory\.value, line\)/)
  assert.match(panel, /<DebugEvaluateDialog/)
  assert.match(panel, /:mode="dataView\.evaluationMode \?\? 'expression'"/, '对话框形态来自设置 debuggerEvaluationMode')
  assert.match(panel, /function removeHistory\(text: string\)/)
  assert.match(panel, /function clearHistory\(\)/)
})
