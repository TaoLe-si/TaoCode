// 求值历史（`src/debugEvaluateHistory.ts` + `DebugPanel.vue` 的接线）。
//
// 上游：`XDebuggerTreeWithHistory` 的表达式历史 —— Evaluate Expression 输入框保留刚求值过的
// 表达式。本仓作为 datalist 候选（与 DAP 补全同一个下拉）；这里钉规则与接线。
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const { EVALUATE_HISTORY_LIMIT, latestEvaluateExpression, pushEvaluateHistory } = await import('../src/debugEvaluateHistory.ts')

test('置顶 + 去重：重复求值同一个表达式只留最近一次的位置', () => {
  assert.deepEqual(pushEvaluateHistory(['a', 'b', 'c'], 'b'), ['b', 'a', 'c'])
  assert.deepEqual(pushEvaluateHistory(['b', 'a'], 'x'), ['x', 'b', 'a'])
})

test('blank 不入历史；不改原数组', () => {
  const history = ['a']
  assert.deepEqual(pushEvaluateHistory(history, '   '), ['a'])
  assert.deepEqual(pushEvaluateHistory(history, ' a '), ['a'], 'trim 后与已有条目相同也只置顶')
  assert.deepEqual(history, ['a'], '纯函数：原数组不动')
})

test('上限截断，最近的最先', () => {
  const full = Array.from({ length: EVALUATE_HISTORY_LIMIT }, (_, index) => `e${index}`)
  const next = pushEvaluateHistory(full, 'new')
  assert.equal(next.length, EVALUATE_HISTORY_LIMIT)
  assert.equal(next[0], 'new')
  assert.equal(latestEvaluateExpression(next), 'new')
  assert.equal(latestEvaluateExpression([]), '')
})

// —— 面板接线：成功求值后进历史；datalist 里历史与补全并存 ——

const panel = readFileSync('src/components/DebugPanel.vue', 'utf8')

test('求值成功后写历史（失败/空表达式不写）', () => {
  assert.match(panel, /exprHistory\.value = pushEvaluateHistory\(exprHistory\.value, text\)/)
  const runEvaluate = panel.slice(panel.indexOf('async function runEvaluate()'), panel.indexOf('function toggleExprRow'))
  assert.ok(runEvaluate.indexOf('pushEvaluateHistory') < runEvaluate.indexOf('catch'), '写历史在 try 成功路径里')
})

test('历史是 datalist 候选，与 DAP 补全同一通道', () => {
  assert.match(panel, /<option v-for="entry in exprHistory"/)
  assert.match(panel, /id="debug-completions"/)
})
