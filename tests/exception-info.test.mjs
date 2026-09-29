// `src/exceptionInfo.ts` 的规则来自 IDEA 的 `JavaStackFrame.createExceptionNodes`
// （java/debugger/impl/src/com/intellij/debugger/engine/JavaStackFrame.java:319-331）：
// 异常停住时把抛出的异常对象当成变量节点，**且只在最顶层帧**（`getUiIndex() != 0` 返回空）。
// 这些是纯函数，直接测；面板只负责渲染。

import test from 'node:test'
import assert from 'node:assert/strict'

const {
  exceptionBreakModeLabel,
  exceptionHeadline,
  exceptionValueExpression,
  flattenCauseChain,
  showsExceptionNode,
} = await import('../src/exceptionInfo.ts')

/** 深度可控的 cause 链夹具。 */
function chain(depth, message = 'boom') {
  let node = { typeName: 'Root', message, innerException: [] }
  for (let level = 0; level < depth; level++) node = { typeName: `Level${level}`, message, innerException: [node] }
  return node
}

test('异常节点只在最顶层帧出现（IDEA 的 getUiIndex() == 0 规则）', () => {
  assert.equal(showsExceptionNode(0), true)
  for (const index of [1, 2, 17, -1]) assert.equal(showsExceptionNode(index), false, `index ${index}`)
})

test('卡片标题优先 类型: 消息，其次类型，最后退回 description', () => {
  assert.equal(exceptionHeadline({ available: true, details: { typeName: 'IllegalStateException', message: 'boom' } }),
    'IllegalStateException: boom')
  // 没有 message 就只有类型 —— 不要在后面留一个孤零零的冒号。
  assert.equal(exceptionHeadline({ available: true, details: { typeName: 'IllegalStateException' } }), 'IllegalStateException')
  // details 缺失（适配器只给了必填字段）时退回 description。
  assert.equal(exceptionHeadline({ available: true, description: 'IllegalStateException: boom' }),
    'IllegalStateException: boom')
  // details 里没有 typeName 但有 exceptionId 时用后者当类型名。
  assert.equal(exceptionHeadline({ available: true, exceptionId: 'java.lang.Error', details: { message: 'bad' } }),
    'java.lang.Error: bad')
  // available:false / 空对象一律不渲染卡片。
  assert.equal(exceptionHeadline({ available: false, description: 'x' }), '')
  assert.equal(exceptionHeadline(null), '')
  assert.equal(exceptionHeadline(undefined), '')
})

test('cause 链按深度拍平，顺序是「先抛出的在前」', () => {
  const info = { available: true, details: { typeName: 'Outer', message: 'outer', stackTrace: 'at a', innerException: [
    { typeName: 'Middle', message: 'middle', fullTypeName: 'pkg.Middle', innerException: [
      { typeName: 'Inner', message: 'inner', evaluateName: 'this.cause' }] }] } }
  const causes = flattenCauseChain(info)
  assert.deepEqual(causes.map(cause => [cause.depth, cause.type, cause.message]),
    [[0, 'Outer', 'outer'], [1, 'Middle', 'middle'], [2, 'Inner', 'inner']])
  assert.equal(causes[0].stackTrace, 'at a', '每层的 stackTrace 跟着自己那层')
  assert.equal(causes[1].fullTypeName, 'pkg.Middle')
  assert.equal(causes[2].evaluateName, 'this.cause', '最内层也能带 evaluateName')
  assert.equal(causes[0].evaluateName, '', '缺字段回空串，前端据此不渲染空元素')
})

test('cause 链有深度上限：恶意或有环的响应不能把渲染线程拖死', () => {
  // 800 层，limit 默认 16。
  const causes = flattenCauseChain({ available: true, details: chain(800) })
  assert.equal(causes.length, 16)
  assert.equal(causes.at(-1).depth, 15)
  assert.equal(flattenCauseChain({ available: true, details: chain(800) }, 3).length, 3)
  assert.equal(flattenCauseChain({ available: true, details: chain(4) }, 0).length, 0, 'limit 0 表示不显示')
  // 真实深度小于上限时不该被截断。
  assert.equal(flattenCauseChain({ available: true, details: chain(3) }).length, 4)
})

test('cause 链的坏形状不会抛异常', () => {
  assert.deepEqual(flattenCauseChain({ available: false, details: { typeName: 'X' } }), [])
  assert.deepEqual(flattenCauseChain({ available: true }), [], 'no details means no rows')
  assert.deepEqual(flattenCauseChain(null), [])
  // innerException 不是数组（适配器写错）时忽略它，不崩。
  const causes = flattenCauseChain({ available: true, details: { typeName: 'X', innerException: 'nope' } })
  assert.equal(causes.length, 1)
})

test('breakMode 用中文标签，表外的值原样显示', () => {
  assert.equal(exceptionBreakModeLabel('always'), '总是')
  assert.equal(exceptionBreakModeLabel('unhandled'), '未捕获')
  assert.equal(exceptionBreakModeLabel('userUnhandled'), '用户未处理')
  // 服务器给了规范枚举之外的值：显示原文，不要静默吞掉。
  assert.equal(exceptionBreakModeLabel('sometimes'), 'sometimes')
  assert.equal(exceptionBreakModeLabel(undefined), '')
})

test('展开异常对象需要适配器给的 evaluateName', () => {
  assert.equal(exceptionValueExpression({ available: true, details: { evaluateName: 'this.cause' } }), 'this.cause')
  assert.equal(exceptionValueExpression({ available: true, details: { typeName: 'X' } }), '')
  assert.equal(exceptionValueExpression({ available: false, details: { evaluateName: 'this' } }), '')
  assert.equal(exceptionValueExpression(undefined), '')
})
