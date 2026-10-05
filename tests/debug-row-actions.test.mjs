// 变量/监视行的**行动作清单**（`src/debugRowActions.ts`）—— 直接调它的行为判据。
// 之前这几条只以「面板源码里有这几行字」的形状断言存在，条目外置到本模块后那些断言钉不住行为；
// 这里补的是真调用：入参（VarRow + 孩子 + 按数组显示的容器集合）→ 清单条目与禁用原因。
import test from 'node:test'
import assert from 'node:assert/strict'
import { debugRowActions, debugRowTarget } from '../src/debugRowActions.ts'

const varRow = (over = {}) => ({ name: 'a', apiName: 'user', reference: 7, expandable: true, ...over })
const indexChildren = [{ name: '0', value: 'x', reference: 8 }, { name: '1', value: 'y', reference: 9 }]
const target = (over = {}, children = []) => debugRowTarget(varRow({ evaluateName: 'user', value: 'John' }), children, []) && {
  ...debugRowTarget(varRow({ evaluateName: 'user', value: 'John' }), children, []), ...over,
}
const item = (list, mode) => list.find(entry => entry.mode === mode)
const paused = { paused: true }

test('入参：expression 优先用适配器的 evaluateName，缺了才退回 apiName；组行没有可求值表达式', () => {
  assert.equal(debugRowTarget(varRow({ evaluateName: 'user.getName()' }), [], []).expression, 'user.getName()')
  assert.equal(debugRowTarget(varRow({ evaluateName: undefined, apiName: 'user' }), [], []).expression, 'user')
  // 组行的 apiName 是合成出来的名字，求值它没有意义
  assert.equal(debugRowTarget(varRow({ evaluateName: undefined, apiName: 'Locals', group: 'Locals' }), [], []).expression, '')
})

test('入参：reference / arrayView / canArray 都取自这一行的上下文（行对象 + 孩子 + 容器集合）', () => {
  const row = varRow({ evaluateName: 'user', value: 'John' })
  assert.equal(debugRowTarget(row, [], []).reference, 7)
  assert.equal(debugRowTarget(row, [], [7]).arrayView, true, '该行的 reference 在按数组显示的容器集合里')
  assert.equal(debugRowTarget(row, [], [9]).arrayView, false)
  assert.equal(debugRowTarget(row, indexChildren, []).canArray, true, '孩子加载了且全是索引形态')
  assert.equal(debugRowTarget(row, [], []).canArray, false, '孩子没加载')
  assert.equal(debugRowTarget(varRow({ expandable: false }), indexChildren, []).canArray, false, '不可展开的行没有索引孩子')
})

test('「在控制台中求值」：没停住就禁用并说明原因（上游 EvaluateInConsoleFromTreeAction 的 isEnabled）', () => {
  const row = target()
  assert.equal(item(debugRowActions(row, paused), 'console').disabled, false)
  const stopped = item(debugRowActions(row, { paused: false }), 'console')
  assert.equal(stopped.disabled, true)
  assert.equal(stopped.hint, '要先停在断点上')
  const noExpr = item(debugRowActions({ ...row, expression: '' }, paused), 'console')
  assert.equal(noExpr.disabled, true)
  assert.equal(noExpr.hint, '适配器没给可求值的表达式')
})

test('「添加到监视」：没有可求值表达式就禁用（组行）', () => {
  const list = debugRowActions({ ...target(), expression: '' }, paused)
  const watch = item(list, 'watch')
  assert.equal(watch.disabled, true)
  assert.equal(watch.hint, '适配器没给可求值的表达式')
  assert.equal(item(debugRowActions(target(), paused), 'watch').disabled, false)
})

test('「按数组显示」随当前状态切标签；不可用时禁用并说明（上游 ViewAsArray 语义）', () => {
  const off = item(debugRowActions(target({}, []), paused), 'array-on')
  assert.equal(off.label, '按数组显示')
  assert.equal(off.disabled, true)
  assert.equal(off.hint, '孩子还没加载，或不是索引形态')
  const on = item(debugRowActions(target({ arrayView: true }), paused), 'array-off')
  assert.equal(on.label, '取消按数组显示')
  assert.equal(on.disabled, false, '已经在按数组显示 ⇒ 这一条永远可点（用来取消）')
  assert.equal(item(debugRowActions(target({}, indexChildren), paused), 'array-on').disabled, false)
})

test('复制值 / 检查：组行不是变量 ⇒ 禁用并说明；与剪贴板比较要求这一行真有值', () => {
  const group = target({ isValue: false })
  assert.equal(item(debugRowActions(group, paused), 'copy-value').disabled, true)
  assert.equal(item(debugRowActions(group, paused), 'copy-value').hint, '这一行不是变量')
  assert.equal(item(debugRowActions(group, paused), 'inspect').disabled, true)
  assert.equal(item(debugRowActions(target(), paused), 'copy-value').disabled, false)
  const empty = item(debugRowActions(target({ value: '   ' }), paused), 'compare-clipboard')
  assert.equal(empty.disabled, true, '空白值没有可比的文本')
  assert.equal(item(debugRowActions(target(), paused), 'compare-clipboard').disabled, false)
  // 复制名称对任何行都可用（名称总是有的）
  assert.equal(item(debugRowActions(group, paused), 'copy-name').disabled, undefined)
})

test('上游「不可用就隐藏」的两项确实不渲染：显示引用对象 / 跳到类型源码（DAP 没有那两条通道）', () => {
  const modes = debugRowActions(target({}, indexChildren), paused).map(entry => entry.mode)
  for (const absent of ['show-referrers', 'jump-to-type-source']) assert.ok(!modes.includes(absent))
})

test('清单条目就是面板那一组，顺序固定（面板直接把它交给 DebugRowMenu 渲染）', () => {
  assert.deepEqual(debugRowActions(target(), paused).map(entry => entry.mode),
    ['copy-value', 'copy-name', 'watch', 'console', 'array-on', 'inspect', 'compare-clipboard'])
})
