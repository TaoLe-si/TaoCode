// dbg/actions 本轮补齐项与「协议挡住的项」的判据：
//   · `ShowExecutionPointAction` —— 跳到当前执行点（面板按钮 → jump 事件 → 编辑器）；
//   · `EvaluateInConsoleFromTreeAction` —— 行动作弹层的「在控制台中求值」写进调试控制台；
//   · `XAddToWatchesTreeAction` —— 行动作弹层的「添加到监视」；
//   · 反向单步等已有动作保持不变；强制单步 / Smart Step Into / 线程冻结在判词里写明被协议挡住。
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const panel = readFileSync('src/components/DebugPanel.vue', 'utf8')

test('显示执行点：优先用适配器报告的当前位置，退回选中帧；经 jump 事件交给宿主', () => {
  assert.match(panel, /function showExecutionPoint\(\)/)
  assert.match(panel, /const location = dapState\.currentLocation/)
  assert.match(panel, /if \(location\) emit\('jump', location\)/)
  assert.match(panel, /title="显示执行点（跳到当前停止位置）"/)
  assert.match(panel, /:disabled="!dapState\.currentLocation"/)
})

// 变量/监视行的行动作**清单**已抽到 `src/debugRowActions.ts`（DebugPanel 顶到 900 行上限，
// 7 条条目不能留在组件里），面板侧只留接线与「点了做什么」。所以这几条读模块、面板读接线。
const rowActions = readFileSync('src/debugRowActions.ts', 'utf8')

test('在控制台中求值：走 DAP repl 上下文，命令与结果都进调试控制台（上游 EvaluateInConsoleFromTreeAction）', () => {
  assert.match(panel, /async function evaluateInConsole\(expression: string\)/)
  assert.match(panel, /const result = await dapEvaluate\(text, 'repl', selectedFrame\.value\?\.id \?\? 0\)/)
  assert.match(panel, /dapConsole\.push\(\{ category: 'console', text: `> \$\{text\}` \}\)/)
  assert.match(panel, /dapConsole\.push\(\{ category: 'console', text: `\$\{result\.result\}/)
  assert.match(rowActions, /mode: 'console', label: '在控制台中求值',/)
  assert.match(rowActions, /disabled: !hasExpression \|\| !context\.paused,/, '没停住就不能在控制台求值')
  assert.match(panel, /function rowActions\(target: RowMenuTarget\) \{ return debugRowActions\(target, \{ paused: dapState\.paused \}\) \}/,
    '面板把「当前是否停住」作为上下文喂给清单')
})

test('添加到监视：弹层项复用同一份刷新链路（XAddToWatchesTreeAction）', () => {
  assert.match(rowActions, /mode: 'watch', label: '添加到监视',/)
  assert.match(rowActions, /disabled: !hasExpression,/)
  assert.match(panel, /if \(mode === 'watch'\) \{ addWatchText\(target\.expression\); return \}/)
  assert.match(panel, /function addWatchText\(text: string\)/)
})

test('监视名用适配器的 evaluateName（没有才退回变量名）', () => {
  assert.match(rowActions, /expression: row\.evaluateName \?\? \(row\.group \? '' : row\.apiName\)/)
})

test('动作的可用性来自行能力：组行没有表达式、不可展开的行不能按数组显示', () => {
  assert.match(rowActions, /reference: row\.reference,/)
  assert.match(rowActions, /canArray: row\.expandable && canViewAsArray\(children\)/)
  assert.match(rowActions, /disabled: !target\.arrayView && !target\.canArray/)
})

test('弹层项在独立组件里渲染，键鼠可走（role=menu/menuitem）', () => {
  const menu = readFileSync('src/components/DebugRowMenu.vue', 'utf8')
  assert.match(menu, /role="menu"/)
  assert.match(menu, /role="menuitem"/)
  assert.match(menu, /:disabled="item\.disabled"/)
  assert.match(menu, /if \(disabled\) return/)
})

test('协议挡住的项如实留缺：bridge 没有 stepInTargets（Smart Step Into），也没有线程冻结/强制单步形状', () => {
  const method = readFileSync('src/bridge.ts', 'utf8').match(/export type Method = '([\s\S]*?)'$/m)
  assert.ok(method)
  assert.ok(!method[1].includes('stepInTargets'), '没有 stepInTargets：Smart Step Into 的无客户端入口')
  assert.ok(!method[1].includes('freeze'), '没有线程冻结请求')
  // 已有的丢帧/重置帧走 restartFrame；DAP 里两者是同一个请求。
  assert.ok(method[1].includes('dap.restartFrame'))
})
