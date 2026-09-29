// `src/breakpointLocations.ts` 的规则来自 IDEA 的 `XLineBreakpointType.canPutAt`
// （platform/xdebugger-api/.../XLineBreakpointType.java:50-52）与它的挑选逻辑
// （platform/xdebugger-impl/.../XDebuggerUtilImpl.java:111-121、134-136）。
// 关键区分：**「这一行不能放断点」和「问不到」是两件事** —— 前者按 IDEA 拒绝，
// 后者必须跳过校验（不能因为服务器不支持就把功能禁掉）。

import test from 'node:test'
import assert from 'node:assert/strict'

const { BreakpointLocationCache, breakpointPlacement, canPlaceBreakpoint, describeBreakpointPlacement } =
  await import('../src/breakpointLocations.ts')

const one = [{ line: 4 }]
const two = [{ line: 4, column: 3 }, { line: 4, endLine: 6, endColumn: 9 }]

test('canPlaceBreakpoint 等价于 IDEA 的 canPutBreakpointAt', () => {
  assert.equal(canPlaceBreakpoint(one), true)
  assert.equal(canPlaceBreakpoint(two), true)
  // 空数组 = "这一行没有可放置位置"，不是"没数据"。
  assert.equal(canPlaceBreakpoint([]), false)
  assert.equal(canPlaceBreakpoint(undefined), false)
})

test('文案区分「能放」「不能放」「有多个位置」', () => {
  assert.equal(describeBreakpointPlacement([], 7), '第 7 行没有可放置断点的位置')
  assert.equal(describeBreakpointPlacement(one, 7), '第 7 行可以放置断点')
  assert.equal(describeBreakpointPlacement(two, 7), '第 7 行有 2 个可放置断点的位置')
  assert.equal(describeBreakpointPlacement(undefined, 7), '第 7 行没有可放置断点的位置')
})

test('缓存按 文件:行 存，编辑后整体清空', () => {
  const cache = new BreakpointLocationCache()
  cache.put('src/a.cpp', 4, one)
  cache.put('src/b.cpp', 4, two)
  assert.deepEqual(cache.get('src/a.cpp', 4), one)
  assert.deepEqual(cache.get('src/b.cpp', 4), two, '同一个行号在不同文件里是两条')
  assert.equal(cache.get('src/a.cpp', 5), undefined)
  cache.clear()
  assert.equal(cache.size, 0)
  assert.equal(cache.get('src/a.cpp', 4), undefined)
})

test('缓存有上限，满了清空而不是无限增长', () => {
  const cache = new BreakpointLocationCache(3)
  cache.put('a', 1, one)
  cache.put('a', 2, one)
  cache.put('a', 3, one)
  assert.equal(cache.size, 3)
  cache.put('a', 4, one)
  assert.equal(cache.size, 1, '到上限后整体清空，只留新写的那条')
  assert.deepEqual(cache.get('a', 4), one)
})

test('命中缓存就不再往返（空结果同样缓存）', async () => {
  const cache = new BreakpointLocationCache()
  let calls = 0
  const query = async () => { calls++; return [] }   // 空数组：这一行不能放
  const first = await breakpointPlacement('src/a.cpp', 9, cache, query)
  const second = await breakpointPlacement('src/a.cpp', 9, cache, query)
  assert.equal(calls, 1, '空结果必须缓存，否则在一行上反复悬停会反复往返')
  assert.deepEqual(first, second)
  assert.equal(first.checked, true)
  assert.equal(first.canPlace, false)
  assert.match(first.message, /没有可放置断点/)
})

test('「问不到」不等于「不能放」，而且不进缓存', async () => {
  const cache = new BreakpointLocationCache()
  let calls = 0
  const query = async () => { calls++; return null }   // 没会话 / 适配器没声明 / 请求失败
  const unanswered = await breakpointPlacement('src/a.cpp', 9, cache, query)
  assert.equal(unanswered.checked, false, '调用方据此**跳过**校验，而不是拒绝放断点')
  assert.equal(canPlaceBreakpoint(unanswered.locations), false)
  assert.equal(cache.size, 0, '一次失败不该被记成答案')
  await breakpointPlacement('src/a.cpp', 9, cache, query)
  assert.equal(calls, 2, '会话起来之后应当重新问')
})

test('脏参数直接判为「没校验」，连请求都不发', async () => {
  const cache = new BreakpointLocationCache()
  let calls = 0
  const query = async () => { calls++; return one }
  for (const [path, line] of [['', 4], ['src/a.cpp', 0], ['src/a.cpp', -1]]) {
    const answer = await breakpointPlacement(path, line, cache, query)
    assert.equal(answer.checked, false, `${path || '(空路径)'}:${line}`)
  }
  assert.equal(calls, 0)
})

test('拿到位置后按 canPlace 判定，并把原始位置带回去给 UI', async () => {
  const cache = new BreakpointLocationCache()
  const answer = await breakpointPlacement('src/a.cpp', 4, cache, async () => two)
  assert.equal(answer.checked, true)
  assert.equal(answer.canPlace, true)
  assert.deepEqual(answer.locations, two, '位置本身要带出去（gutter 提示要用个数）')
  assert.equal(answer.message, '第 4 行有 2 个可放置断点的位置')
})
