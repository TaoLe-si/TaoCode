// 判据 · xdebugger 域 EP 的**真实消费点**（xdebugger EP lane，2026-10-07）。
//
// 上游那几条 `com.intellij.xdebugger.*` EP 的宿主已在 `src/xdebuggerExtensionPoints.ts`
// （id 逐字取自上游 xml），`com.intellij.xdebugger.debugProcessListener` 在
// `src/debugProcessListeners.ts`。这条判据钉的是「宿主之外那一半」——第三方按 id 注册后，
// 贡献**确实流进了本仓在跑的链路**：
//   ① `debuggerSupport` 的贡献是 `src/debugRowActions.ts` 行动作清单可用性闸的真源
//      （拔掉 bundled 支持 ⇒ 整份清单置灰；装回 ⇒ 恢复）。上游同口径：
//      `XDebuggerActionBase.kt` 的 `update`（`:20-36`）→ `isEnabled(project, event)`（`:57-59`）→
//      `getHandler()`（`:53-55` 递归到 `getHandler(DebuggerSupport())`），没有 DebuggerSupport
//      可解析这组动作就不可用。
//   ② `attachDebuggerProvider` / `attachHostProvider` 的第三方贡献进
//      `src/debugAttach.ts` 的 `attachGuidance()`（DebugStartPane 显示的那句附加提示）。
//   ③ `debugProcessListener` 装在 `src/dapRequests.ts` 的活链路上（DAP 会话状态驱动）。
//   ④ 任务书里 `xvaluePresenter` / `framePresentationProvider` / `xdebuggerExtension` /
//      `valueLookup` / `evaluation` 这些上游**不存在**的 EP 名，本仓不声明（不造假 EP）。
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

import { debugRowActions } from '../src/debugRowActions.ts'
import { EXTENSIONS } from '../src/extensionPoints.ts'
import {
  XATTACH_DEBUGGER_PROVIDER_EP, XATTACH_HOST_PROVIDER_EP, XDEBUGGER_SUPPORT_EP,
  debuggerSupportRegistry, debuggerSupports, hasDebuggerSupport, registerBundledDebuggerSupport,
  registerXAttachDebuggerProvider, registerXAttachHostProvider,
} from '../src/xdebuggerExtensionPoints.ts'
import { DEBUG_PROCESS_LISTENER_EP } from '../src/debugProcessListeners.ts'
import { attachGuidance, availableLocalAttachDebuggers } from '../src/debugAttach.ts'

const target = { expression: 'user', reference: 7, isValue: true, value: 'John', arrayView: false, canArray: false }
const paused = { paused: true }

test('debuggerSupport EP 是行动作清单可用性闸的真源（拔掉 bundled ⇒ 整份置灰）', () => {
  assert.equal(XDEBUGGER_SUPPORT_EP, 'com.intellij.xdebugger.debuggerSupport')
  // 内建 bundled dap 支持在 ⇒ 默认现读注册表那一支判可用。
  assert.equal(hasDebuggerSupport(), true)
  assert.ok(debugRowActions(target, paused).some(item => item.disabled === false), '有支持时至少一条可点')

  // 显式注入「没有支持」⇒ 全部置灰，且原因写进 hint。
  const off = debugRowActions(target, { paused: true, debuggerSupported: false })
  assert.ok(off.length > 0)
  assert.ok(off.every(item => item.disabled === true), '一个支持都没有时整组不可用')
  assert.ok(off.every(item => /调试器支持/.test(item.hint ?? '')), '每一条都把原因说出来')

  // 拔掉注册表里那条 bundled 支持（走注册表的 unregister，内部表与 EP 表一起清）
  // ⇒ **默认那条路**也置灰，证明缺省真的现读 EP 注册表。
  assert.equal(debuggerSupportRegistry.unregister('dap'), true)
  try {
    assert.equal(hasDebuggerSupport(), false)
    assert.ok(debugRowActions(target, paused).every(item => item.disabled === true))
  } finally {
    registerBundledDebuggerSupport({ id: 'dap' })
  }
  assert.equal(hasDebuggerSupport(), true)
  assert.ok(debugRowActions(target, paused).some(item => item.disabled === false))
})

test('第三方按 id 注册 DebuggerSupport 后被 debuggerSupports 拿到、注销即消失', () => {
  const handle = registerBundledDebuggerSupport({ id: 'plugin.backend' })
  try {
    assert.ok(debuggerSupports().some(support => support.id === 'plugin.backend'))
    assert.equal(hasDebuggerSupport(), true)
  } finally { handle.dispose() }
  assert.ok(!debuggerSupports().some(support => support.id === 'plugin.backend'))
  assert.ok(debuggerSupports().some(support => support.id === 'dap'), '内建那条仍在')
})

test('attachDebuggerProvider：按 host 过滤的第三方提供者进 attachGuidance 的「可用调试器」', () => {
  assert.equal(XATTACH_DEBUGGER_PROVIDER_EP, 'com.intellij.xdebugger.attachDebuggerProvider')
  assert.match(attachGuidance('cppvsdbg'), /可用调试器：DAP/, '内建 dap 提供者如实出现在提示里')

  const handle = registerXAttachDebuggerProvider({
    id: 'plugin.localDap',
    isAttachHostApplicable: host => host === 'Local',
    getAvailableDebuggers: () => [{ id: 'plugin', displayName: 'PluginDAP' }],
    getGroupName: () => 'PluginDAP',
  })
  try {
    assert.ok(availableLocalAttachDebuggers().includes('PluginDAP'))
    assert.match(attachGuidance('cppvsdbg'), /PluginDAP/)
  } finally { handle.dispose() }
  assert.ok(!availableLocalAttachDebuggers().includes('PluginDAP'))
})

test('只认 Remote 的提供者不出现在本机附加提示里（isAttachHostApplicable 真的在过滤）', () => {
  const handle = registerXAttachDebuggerProvider({
    id: 'plugin.remoteOnly',
    isAttachHostApplicable: host => host === 'Remote',
    getAvailableDebuggers: () => [],
    getGroupName: () => 'RemoteOnly',
  })
  try {
    assert.ok(!availableLocalAttachDebuggers().includes('RemoteOnly'))
    assert.ok(!attachGuidance('cppvsdbg').includes('RemoteOnly'))
  } finally { handle.dispose() }
})

test('attachHostProvider：第三方挂的 host 进 attachGuidance 的「可用目标」', () => {
  assert.equal(XATTACH_HOST_PROVIDER_EP, 'com.intellij.xdebugger.attachHostProvider')
  assert.match(attachGuidance('cppvsdbg'), /可用目标：本机/, '内建本机 host 在提示里')
  const handle = registerXAttachHostProvider({
    id: 'plugin.remoteHost',
    getPresentationGroup: () => '远程',
    getAvailableHosts: () => [{ id: 'ssh', host: 'Remote', displayName: 'ssh://build' }],
  })
  try {
    assert.match(attachGuidance('cppvsdbg'), /ssh:\/\/build/)
  } finally { handle.dispose() }
  assert.ok(!attachGuidance('cppvsdbg').includes('ssh://build'))
})

test('debugProcessListener：EP 已在宿主声明，且装在 dapRequests 的活链路上', () => {
  assert.equal(DEBUG_PROCESS_LISTENER_EP, 'com.intellij.xdebugger.debugProcessListener')
  assert.equal(EXTENSIONS.hasExtensionPoint(DEBUG_PROCESS_LISTENER_EP), true)
  const source = readFileSync('src/dapRequests.ts', 'utf8')
  assert.match(source, /installDebugProcessDispatch\(dapState\)/, '安装点在 DAP 请求链上')
})

test('上游不存在的 EP 名不声明（xvaluePresenter / framePresentationProvider / xdebuggerExtension / valueLookup / evaluation）', () => {
  for (const fake of [
    'com.intellij.xdebugger.xvaluePresenter',
    'com.intellij.xdebugger.framePresentationProvider',
    'com.intellij.xdebugger.xdebuggerExtension',
    'com.intellij.xdebugger.valueLookup',
    'com.intellij.xdebugger.evaluation',
  ]) {
    assert.equal(EXTENSIONS.hasExtensionPoint(fake), false, `${fake} 上游不是 EP，不许声明`)
  }
})
