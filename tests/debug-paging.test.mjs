// DAP 分页（`stackTrace` 的 `startFrame`/`levels`、`variables` 的 `start`/`count`）与
// 求值结果展开（`evaluate` 的新回参）的判据 —— 规则在 `src/debugPaging.ts`，
// 取数封装在 `src/dapRequests.ts`。
//
// 上游依据：DAP 规范里这两组分页字段都可选，且 **<= 0 与"不指定"是两回事**
// （`native/dap_values.cpp:202-227` 逐字实现：只有 > 0 才发那个键）。
// 「可展开」的判据是 `variablesReference > 0`（与 DebugPanel 既有那一格同义）。
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

import {
  DEFAULT_STACK_PAGE, DEFAULT_VARIABLE_PAGE,
  evaluateResultExpandable, evaluateResultPageInfo, evaluateResultReference,
  hasMoreVariableChildren, mergeVariablePage, nextVariablePage, remainingVariableChildren,
  stackTracePageParams, variablePageInfo, variablePageParams,
} from '../src/debugPaging.ts'
import { setDapTransport, dapStackTracePage, dapVariablesPage } from '../src/dapRequests.ts'

const read = relative => readFileSync(new URL(`../${relative}`, import.meta.url), 'utf8')

test('分页参数：<=0 的字段不发（省略 = 不指定，与"第 0 帧 / 要 0 条"是两回事）', () => {
  assert.deepEqual(stackTracePageParams(), {})
  assert.deepEqual(stackTracePageParams({ startFrame: 0, levels: 0 }), {}, '0 不发键')
  assert.deepEqual(stackTracePageParams({ startFrame: -3, levels: -1 }), {}, '负数不发键')
  assert.deepEqual(stackTracePageParams({ startFrame: 5, levels: 10 }), { startFrame: 5, levels: 10 })
  assert.deepEqual(stackTracePageParams({ startFrame: 5.9 }), { startFrame: 5 }, '取整')
  assert.deepEqual(variablePageParams(), {})
  assert.deepEqual(variablePageParams({ start: 0, count: 0 }), {})
  assert.deepEqual(variablePageParams({ start: 100, count: 50 }), { start: 100, count: 50 })
  // 非数字不能漏进请求（`NaN` 发过去会被适配器当成非法参数）。
  assert.deepEqual(variablePageParams({ start: Number.NaN, count: Number.POSITIVE_INFINITY }), {})
})

test('分页规模：适配器不报总数就不说"还有多少"（不编造总量）', () => {
  assert.deepEqual(variablePageInfo(undefined), { named: 0, indexed: 0, total: 0, paged: false })
  assert.deepEqual(variablePageInfo({}), { named: 0, indexed: 0, total: 0, paged: false })
  assert.deepEqual(variablePageInfo({ namedVariables: 3, indexedVariables: 7 }), { named: 3, indexed: 7, total: 10, paged: true })
  // 非整数 / 负数 / 0 一律当没报。
  assert.equal(variablePageInfo({ namedVariables: -1, indexedVariables: 0 }).paged, false)
  assert.equal(variablePageInfo({ namedVariables: 2.5 }).named, 2)
  assert.equal(variablePageInfo({ indexedVariables: Number.NaN }).paged, false)
})

test('下一页：已取完 / 没报总数时是 null；有下一页时 start 正好接上、count 不超剩余', () => {
  const info = variablePageInfo({ indexedVariables: 250 })
  assert.deepEqual(nextVariablePage(0, info, 100), { start: 0, count: 100 })
  assert.deepEqual(nextVariablePage(100, info, 100), { start: 100, count: 100 })
  assert.deepEqual(nextVariablePage(200, info, 100), { start: 200, count: 50 }, '最后一页只取剩下的 50 条')
  assert.equal(nextVariablePage(250, info, 100), null, '取完了')
  assert.equal(nextVariablePage(300, info, 100), null, '超过总数也是取完')
  assert.equal(nextVariablePage(0, variablePageInfo({}), 100), null, '适配器没报总数 ⇒ 无法算下一页')
  assert.equal(remainingVariableChildren(200, info), 50)
  assert.equal(hasMoreVariableChildren(200, info), true)
  assert.equal(hasMoreVariableChildren(250, info), false)
  assert.equal(remainingVariableChildren(5, variablePageInfo({})), 0, '不知道就不说"还有"')
})

test('并页：start=0 整份替换；续页按 0 基下标追加，不覆盖已加载的区间', () => {
  const first = ['a', 'b', 'c']
  assert.deepEqual(mergeVariablePage(first, { start: 0, count: 3 }, ['x', 'y']), ['x', 'y'], '第一页整份替换')
  assert.deepEqual(mergeVariablePage(first, { start: 3, count: 2 }, ['d', 'e']), ['a', 'b', 'c', 'd', 'e'])
  // 续页带回来的下标已经加载过 ⇒ 保留先到的那一份（两页之间适配器改了容器内容时，
  // 不让后到的一页把前面的行搬走）。
  assert.deepEqual(mergeVariablePage(first, { start: 1, count: 3 }, ['B', 'C', 'D']), ['a', 'b', 'c', 'D'])
  assert.deepEqual(mergeVariablePage(undefined, { start: 0, count: 2 }, ['x']), ['x'])
})

test('求值结果展开：reference 优先、退回 variablesReference；>0 才可展开', () => {
  assert.equal(evaluateResultReference({ reference: 9, variablesReference: 9 }), 9)
  assert.equal(evaluateResultReference({ variablesReference: 7 }), 7, '只有 variablesReference 时用它')
  assert.equal(evaluateResultReference({ reference: 0, variablesReference: 4 }), 4, 'reference 为 0 时退回')
  assert.equal(evaluateResultReference({}), 0)
  assert.equal(evaluateResultReference(undefined), 0)
  assert.equal(evaluateResultExpandable({ result: '1', variablesReference: 3 }), true)
  assert.equal(evaluateResultExpandable({ result: '1' }), false, '标量结果不可展开')
  // 求值结果通常不报 named/indexed（适配器只在变量节点上报）⇒ paged 为假，不假装知道总量。
  assert.equal(evaluateResultPageInfo({ result: '[...]', variablesReference: 2 }).paged, false)
  assert.equal(evaluateResultPageInfo({ result: '[...]', variablesReference: 2, indexedVariables: 30 }).paged, true)
})

test('取数封装真的把分页参数发给桥接（走可注入通道验调用形状）', async () => {
  const calls = []
  setDapTransport({
    stackTrace: async (threadId, page) => { calls.push(['stack', threadId, page]); return { frames: [], totalFrames: 0 } },
    variables: async (reference, page) => { calls.push(['vars', reference, page]); return { variables: [] } },
  })
  await dapStackTracePage(4, { startFrame: 20, levels: 10 })
  await dapStackTracePage(4)
  await dapVariablesPage(77, { start: 100, count: DEFAULT_VARIABLE_PAGE })
  await dapVariablesPage(77)
  assert.deepEqual(calls, [
    ['stack', 4, { startFrame: 20, levels: 10 }],
    ['stack', 4, {}],
    ['vars', 77, { start: 100, count: DEFAULT_VARIABLE_PAGE }],
    ['vars', 77, {}],
  ])
  setDapTransport()
  assert.equal(DEFAULT_STACK_PAGE > 0, true)
})

test('接线：分页封装走 bridge 的 dapStackTrace/dapVariables（不是另开一条通道）', () => {
  const host = read('src/dapRequests.ts')
  assert.match(host, /stackTrace: dapStackTrace/, '默认通道就是桥接的 dapStackTrace')
  assert.match(host, /variables: dapVariables/, '默认通道就是桥接的 dapVariables')
  // 桥接侧两条封装必须真的收分页参数（`Method` 的参数形状）。
  const bridge = read('src/bridge.ts')
  assert.match(bridge, /dapStackTrace = \(threadId = dapCurrentThread\(\), page\?: \{ startFrame\?: number; levels\?: number \}\)/)
  assert.match(bridge, /dapVariables = \(reference: number, page\?: \{ start\?: number; count\?: number \}\)/)
  // 原生分派必须把这两个字段透传给会话（`native/dap_routes.cpp`）。
  const routes = read('native/dap_routes.cpp')
  assert.match(routes, /long_of\(params, "startFrame", 0\)/)
  assert.match(routes, /long_of\(params, "levels", 0\)/)
  assert.match(routes, /long_of\(params, "start", 0\)/)
  assert.match(routes, /long_of\(params, "count", 0\)/)
})