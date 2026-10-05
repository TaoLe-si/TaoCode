// 能力位的桥接口径：`dapCapabilities` 只由适配器在 initialize 里声明的布尔值喂，
// 会话结束（terminated）就清空 —— 面板据此决定反向调试 / 内存 / 反汇编入口渲不渲染。

import test from 'node:test'
import assert from 'node:assert/strict'

const bridge = await import('../src/bridge.ts')

test('能力位默认全关，非布尔值不算声明', () => {
  assert.equal(bridge.dapCapability('supportsStepBack'), false)
  assert.equal(bridge.dapCapability('supportsReadMemoryRequest'), false)
  assert.equal(bridge.dapCapability('supportsDisassembleRequest'), false)
  bridge.dapRememberCapabilities({
    supportsStepBack: true,
    supportsReadMemoryRequest: 1,
    supportsDisassembleRequest: 'true',
    supportsLoadedSourcesRequest: true,
  })
  assert.equal(bridge.dapCapability('supportsStepBack'), true)
  assert.equal(bridge.dapCapability('supportsReadMemoryRequest'), false, '数字 1 不是能力声明')
  assert.equal(bridge.dapCapability('supportsDisassembleRequest'), false, '字符串 "true" 不是能力声明')
  assert.equal(bridge.dapCapability('supportsLoadedSourcesRequest'), true)
  assert.equal(bridge.dapCapability('supportsModulesRequest'), false)
})

test('重新声明是整份覆盖：上一个会话的旧能力不残留', () => {
  bridge.dapRememberCapabilities({ supportsStepBack: true, supportsModulesRequest: true })
  bridge.dapRememberCapabilities({ supportsStepBack: true })
  assert.equal(bridge.dapCapability('supportsStepBack'), true)
  assert.equal(bridge.dapCapability('supportsModulesRequest'), false)
})

test('terminated 事件清空能力位', () => {
  bridge.dapRememberCapabilities({ supportsReadMemoryRequest: true })
  assert.equal(bridge.dapCapability('supportsReadMemoryRequest'), true)
  bridge.applyDapEvent({ event: 'terminated' })
  assert.equal(bridge.dapCapability('supportsReadMemoryRequest'), false)
  assert.equal(bridge.dapState.running, false)
})

test('新增的六个请求封装都导出了', () => {
  for (const name of ['dapLoadedSourcesRequest', 'dapModulesRequest', 'dapStepBack', 'dapReverseContinue', 'dapReadMemory', 'dapDisassemble'])
    assert.equal(typeof bridge[name], 'function', `${name} 必须从 bridge 导出`)
})
