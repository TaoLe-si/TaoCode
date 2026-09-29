// `src/navigateInFile.ts`：IDEA 的 MethodDown / MethodUp（Navigate → Navigate in File）。
//
// 这个测试的重点是**忠实性**，不是"能跳就行"：
//   1. 名字叫 Method，但 `MethodUpDownUtil.addStructureViewElements:61-73` 收的是结构视图的**全部**元素
//      （类、字段、嵌套结构都算）—— 早先的实现按 kind 过滤只留方法，那是错的；
//   2. `offset > caretOffset` **且** `line > caretLine`（`MethodDownHandler:27-29`）——
//      同一行上更靠右的符号**不算**下一个方法。

import test from 'node:test'
import assert from 'node:assert/strict'

const { describeNavigationBoundary, navigateFrom, navigationPoints } =
  await import('../src/navigateInFile.ts')

test('收集所有结构元素，不按 kind 过滤', () => {
  // 类(5) / 方法(6) / 字段(8) / 构造函数(9) / 变量(13) —— IDEA 全都要。
  const symbols = [
    { name: 'Sample', kind: 5, startLine: 0 },
    { name: 'counter', kind: 8, startLine: 2 },
    { name: 'Sample', kind: 9, startLine: 5 },
    { name: 'run', kind: 6, startLine: 8 },
    { name: 'local', kind: 13, startLine: 9 },
  ]
  assert.deepEqual(navigationPoints(symbols).map(point => point.line), [0, 2, 5, 8, 9])
})

test('同一行多个符号只留一个（IDEA 用集合去重），并按行升序', () => {
  const symbols = [
    { name: 'b', startLine: 7 },
    { name: 'a', startLine: 2 },
    { name: 'c', startLine: 7 },   // 与 b 同一行
  ]
  const points = navigationPoints(symbols)
  assert.deepEqual(points.map(point => point.line), [2, 7])
  assert.equal(points[1].name, 'b', '去重时保留先出现的那条')
})

test('坏输入不会抛异常', () => {
  assert.deepEqual(navigationPoints(undefined), [])
  assert.deepEqual(navigationPoints([]), [])
  const symbols = [{ name: 'x' }, { name: 'y', startLine: -1 }, { name: 'z', startLine: 1.5 }, { startLine: 3 }]
  assert.deepEqual(navigationPoints(symbols).map(point => point.line), [3])
})

test('下一个 / 上一个：严格跨行，到头不绕回', () => {
  const points = navigationPoints([
    { name: 'a', startLine: 1 }, { name: 'b', startLine: 4 }, { name: 'c', startLine: 9 },
  ])
  assert.equal(navigateFrom(points, 0, 1)?.line, 1, '光标在第 0 行 → 下一个是第 1 行')
  assert.equal(navigateFrom(points, 4, 1)?.line, 9, '光标**就在**第 4 行的符号上 → 下一个是第 9 行（不是它自己）')
  assert.equal(navigateFrom(points, 9, 1), undefined, '已经是最后一个 → undefined（IDEA 的 handler 直接 return null）')
  assert.equal(navigateFrom(points, 9, -1)?.line, 4)
  assert.equal(navigateFrom(points, 4, -1)?.line, 1, '光标在第 4 行的符号上 → 上一个是第 1 行')
  assert.equal(navigateFrom(points, 1, -1), undefined, '已经是第一个 → undefined')
})

test('同一行内更靠右的符号不算「下一个方法」（IDEA 要求 line 严格更大）', () => {
  // 第 4 行上有两个符号（第 0 列与第 20 列）。光标在第 4 行第 0 列时，
  // 按 offset 第 20 列更大，但按 IDEA 的规则它**不算**下一个 —— 必须在行号上严格更大。
  const points = navigationPoints([{ name: 'x', startLine: 4 }, { name: 'y', startLine: 4 }, { name: 'z', startLine: 6 }])
  assert.equal(navigateFrom(points, 4, 1)?.line, 6, '同行的第 20 列被 line 条件排除')
})

test('边界提示文案', () => {
  assert.match(describeNavigationBoundary(1), /最后/)
  assert.match(describeNavigationBoundary(-1), /第一个/)
})
