// 第二批 DAP 请求族的前端封装（`src/dapRequests.ts`）判据：
//   · 能力位门控 —— 规范里 `supportsDataBreakpoints` / `supportsFunctionBreakpoints` /
//     `supportsSourceRequest` **都默认 false**，没声明就**不发请求**（省一次必然失败的往返），
//     回一个带原因的降级结果（`supported:false` + `available:false`）；
//   · 优雅降级 —— 适配器嘴上说支持、实际回 `DAP_UNSUPPORTED`（原生能力门控）或
//     `DAP_NOT_RUNNING`（会话没了）时同样折成降级结果，不把错误抛给界面；
//   · 其余错误照抛（参数非法、适配器崩了），那些是真的要看一眼的问题。
//
// 上游依据：IDEA 的字段观察点 `JavaFieldBreakpointType`、方法断点 `JavaMethodBreakpointType`，
// 与「按 sourceReference 取源内容」（适配器动态生成的源）。原生侧的整形与门控在
// `native/dap_values.cpp:288-341`，路由在 `native/dap_routes.cpp`。
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

import {
  DATA_BREAKPOINTS_CAPABILITY, DAP_UNAVAILABLE_REASON, FUNCTION_BREAKPOINTS_CAPABILITY,
  SOURCE_REQUEST_CAPABILITY, capabilityUnsupportedReason, dapDataBreakpoints,
  dapFunctionBreakpointsSupported, dapSetDataBreakpoints, dapSetFunctionBreakpoints, dapSource,
  isDegradableDapError, setDapTransport,
} from '../src/dapRequests.ts'
import { BridgeError } from '../src/bridgeError.ts'

const read = relative => readFileSync(new URL(`../${relative}`, import.meta.url), 'utf8')

/** 每例换一套通道（能力位 + 请求都注入），例后还原。 */
function withTransport(capabilities, requestImpl) {
  setDapTransport({
    capability: name => capabilities[name] === true,
    request: requestImpl,
  })
}

test('能力位没声明 ⇒ 不发请求，直接回带原因的降级结果', async () => {
  let calls = 0
  withTransport({}, async () => { calls += 1; return {} })
  const data = await dapDataBreakpoints()
  const functions = await dapSetFunctionBreakpoints([{ name: 'main' }])
  const source = await dapSource({ sourceReference: 1 })
  assert.equal(calls, 0, '能力位没声明就一个请求都不该发')
  assert.deepEqual(data, { supported: false, available: false, reason: capabilityUnsupportedReason(DATA_BREAKPOINTS_CAPABILITY) })
  assert.deepEqual(functions, { supported: false, available: false, reason: capabilityUnsupportedReason(FUNCTION_BREAKPOINTS_CAPABILITY) })
  assert.deepEqual(source, { supported: false, available: false, reason: capabilityUnsupportedReason(SOURCE_REQUEST_CAPABILITY) })
  assert.match(data.reason, /supportsDataBreakpoints/)
  setDapTransport()
})

test('能力位声明了 ⇒ 真的发请求，并把回参整形成结果', async () => {
  const calls = []
  withTransport(
    { [DATA_BREAKPOINTS_CAPABILITY]: true, [FUNCTION_BREAKPOINTS_CAPABILITY]: true, [SOURCE_REQUEST_CAPABILITY]: true },
    async (method, params) => {
      calls.push([method, params])
      if (method === 'dap.dataBreakpoints') return { available: true, breakpoints: [{ dataId: 'counter', label: 'counter', accessType: 'write' }] }
      if (method === 'dap.setDataBreakpoints') return { breakpoints: [{ verified: true, dataId: 'counter' }] }
      if (method === 'dap.setFunctionBreakpoints') return { breakpoints: [{ verified: false, name: 'main', message: '未解析' }] }
      if (method === 'dap.source') return { available: true, content: 'int main() {}', mimeType: 'text/x-c' }
      return {}
    },
  )
  const data = await dapDataBreakpoints()
  assert.equal(data.supported, true)
  assert.deepEqual(data.breakpoints, [{ dataId: 'counter', label: 'counter', accessType: 'write' }])
  const setData = await dapSetDataBreakpoints([{ dataId: 'counter', accessType: 'write', condition: 'x > 1' }])
  assert.deepEqual(setData, { supported: true, breakpoints: [{ verified: true, dataId: 'counter' }] })
  const setFunctions = await dapSetFunctionBreakpoints([{ name: 'main' }])
  assert.equal(setFunctions.breakpoints[0].verified, false)
  const source = await dapSource({ sourceReference: 42 })
  assert.deepEqual(source, { supported: true, available: true, content: 'int main() {}', mimeType: 'text/x-c' })
  assert.deepEqual(calls, [
    ['dap.dataBreakpoints', undefined],
    ['dap.setDataBreakpoints', { breakpoints: [{ dataId: 'counter', accessType: 'write', condition: 'x > 1' }] }],
    ['dap.setFunctionBreakpoints', { breakpoints: [{ name: 'main' }] }],
    ['dap.source', { sourceReference: 42 }],
  ])
  setDapTransport()
})

test('空数组是有意义的答案（这个会话没有可观察位置），不是"不支持"', async () => {
  withTransport({ [DATA_BREAKPOINTS_CAPABILITY]: true }, async () => ({ available: true, breakpoints: [] }))
  const result = await dapDataBreakpoints()
  assert.deepEqual(result, { supported: true, available: true, breakpoints: [] })
  setDapTransport()
})

test('适配器答 DAP_UNSUPPORTED / DAP_NOT_RUNNING ⇒ 降级成结果，不抛给界面', async () => {
  for (const [code, expected] of [['DAP_UNSUPPORTED', /能力位/], ['DAP_NOT_RUNNING', /会话/]]) {
    withTransport({ [DATA_BREAKPOINTS_CAPABILITY]: true }, async () => { throw new BridgeError(code, 'x') })
    const result = await dapDataBreakpoints()
    assert.equal(result.supported, false, `${code} 必须降级`)
    assert.equal(result.available, false)
    assert.match(result.reason, expected)
    if (code === 'DAP_NOT_RUNNING') assert.equal(result.reason, DAP_UNAVAILABLE_REASON)
  }
  assert.equal(isDegradableDapError(new BridgeError('DAP_UNSUPPORTED', 'x')), true)
  assert.equal(isDegradableDapError(new BridgeError('DAP_NOT_RUNNING', 'x')), true)
  assert.equal(isDegradableDapError(new BridgeError('INVALID_REQUEST', 'x')), false, '参数错误不该降级')
  assert.equal(isDegradableDapError(new Error('boom')), false)
  setDapTransport()
})

test('其它错误照抛（参数非法 / 适配器崩了是真要看一眼的问题）', async () => {
  withTransport({ [DATA_BREAKPOINTS_CAPABILITY]: true }, async () => { throw new BridgeError('INVALID_REQUEST', '坏参数') })
  await assert.rejects(dapDataBreakpoints(), error => error.code === 'INVALID_REQUEST')
  setDapTransport()
})

test('source 两个入参至少给一个（规范）；都给时引用优先、路径也带上', async () => {
  const calls = []
  withTransport({ [SOURCE_REQUEST_CAPABILITY]: true }, async (method, params) => { calls.push([method, params]); return { available: false } })
  await assert.rejects(dapSource({}), error => error.code === 'INVALID_REQUEST', '两个都不给要当场拒绝')
  await dapSource({ path: 'src/main.cpp' })
  await dapSource({ sourceReference: 7, path: 'src/main.cpp' })
  assert.deepEqual(calls, [
    ['dap.source', { path: 'src/main.cpp' }],
    ['dap.source', { sourceReference: 7, path: 'src/main.cpp' }],
  ])
  // 适配器没给内容 ⇒ `available:false`（不是"空文件"）。
  const empty = await dapSource({ sourceReference: 7 })
  assert.deepEqual(empty, { supported: true, available: false })
  setDapTransport()
})

test('能力位查询读的是桥接的能力表（与 dapCapability 同一口径）', () => {
  setDapTransport({ capability: name => name === FUNCTION_BREAKPOINTS_CAPABILITY })
  assert.equal(dapFunctionBreakpointsSupported(), true)
  setDapTransport()
  assert.equal(dapFunctionBreakpointsSupported(), false, '还原后读真实能力表（测试进程里没起会话 ⇒ false）')
})

test('接线：四条新方法名在 bridge 的 Method union 与原生分派里逐字一致', () => {
  const bridge = read('src/bridge.ts')
  const routes = read('native/dap_routes.cpp')
  for (const name of ['dap.dataBreakpoints', 'dap.setDataBreakpoints', 'dap.setFunctionBreakpoints', 'dap.source']) {
    assert.ok(bridge.includes(`'${name}'`), `bridge 的 Method union 缺 ${name}`)
    assert.ok(routes.includes(`method == "${name}"`), `原生分派缺 ${name}`)
  }
  // 原生那四条要真的调到 Client 方法（不是空分支）。
  assert.match(routes, /session\.data_breakpoints\(answer_to\(host, id\)\)/)
  assert.match(routes, /session\.set_data_breakpoints\(requested, answer_to\(host, id\)\)/)
  assert.match(routes, /session\.set_function_breakpoints\(requested, answer_to\(host, id\)\)/)
  assert.match(routes, /session\.source\(reference, path, answer_to\(host, id\)\)/)
  // 前端封装走桥接的 `request`（不是另开一条通道）。
  const host = read('src/dapRequests.ts')
  assert.match(host, /request: \(method, params\) => request\(method as never, params\)/)
})