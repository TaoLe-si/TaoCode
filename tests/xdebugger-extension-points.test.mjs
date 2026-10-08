// 判据 · xdebugger 域的扩展点宿主接线（`src/xdebuggerExtensionPoints.ts`）—— 上游本来就是 EP
// 的那几族（`XBreakpointType` / `XDebuggerSettings` / `DebuggerConfigurableProvider` /
// `TextValueVisualizer` / `XAttachDebuggerProvider` / `XBreakpointGroupingRule` / `DebuggerSupport` /
// `XAttachHostProvider`）以及它们的同名方法面。
//
// 钉五件事：
//   ① 八条 EP 的 id 逐字等于上游 qualifiedName，且都已在宿主里声明；
//   ② 任务书里写的 `xvaluePresenter` / `framePresentationProvider` / `xdebuggerExtension` 上游
//      **不存在**（本仓不造假 EP）；`debugProcessListener` 是本仓自定 id、落在
//      `src/debugProcessListeners.ts`（不在本模块声明）；
//   ③ 每条 EP 的贡献能按 id 注册/注销，消费函数看得见；
//   ④ `order="first"`（或分组规则的 priority）的插件贡献排在内建之前；
//   ⑤ bundled 默认贡献（line/exception 断点、调试器设置、plainText 可视化、dap 附加/支持、
//      按文件分组、本机 attach host）如实出现在 EP 里。
import test from 'node:test'
import assert from 'node:assert/strict'

import {
  DEBUGGER_CONFIGURABLE_PROVIDER_EP, TEXT_VALUE_VISUALIZER_EP, XATTACH_DEBUGGER_PROVIDER_EP,
  XATTACH_HOST_PROVIDER_EP, XBREAKPOINT_GROUPING_RULE_EP, XBREAKPOINT_TYPE_EP,
  XDEBUGGER_SETTINGS_EP, XDEBUGGER_SUPPORT_EP,
  attachHostSummary, availableAttachHosts, debuggerConfigurableProviders, debuggerConfigurablesFor,
  debuggerSupports, declareXdebuggerExtensionPoints, hasDebuggerSupport, registerDebuggerConfigurableProvider,
  registerDebuggerSupport, registerTextValueVisualizer, registerXAttachDebuggerProvider,
  registerXAttachHostProvider, registerXBreakpointGroupingRule, registerXBreakpointType,
  registerXDebuggerSettings, textValueVisualizers, unregisterXdebuggerExtension, visualizeTextValue,
  xattachDebuggerProviders, xattachDebuggerProvidersFor, xattachHostProviders,
  xbreakpointGroupingRules, xbreakpointTypeById, xbreakpointTypes, xdebuggerSettingsById,
  xdebuggerSettingsContributions,
} from '../src/xdebuggerExtensionPoints.ts'
import { EXTENSIONS } from '../src/extensionPoints.ts'

test('八条 EP 的 id 逐字取自上游，且已声明', () => {
  assert.equal(XBREAKPOINT_TYPE_EP, 'com.intellij.xdebugger.breakpointType')
  assert.equal(XDEBUGGER_SETTINGS_EP, 'com.intellij.xdebugger.settings')
  assert.equal(DEBUGGER_CONFIGURABLE_PROVIDER_EP, 'com.intellij.xdebugger.configurableProvider')
  assert.equal(TEXT_VALUE_VISUALIZER_EP, 'com.intellij.xdebugger.textValueVisualizer')
  assert.equal(XATTACH_DEBUGGER_PROVIDER_EP, 'com.intellij.xdebugger.attachDebuggerProvider')
  assert.equal(XBREAKPOINT_GROUPING_RULE_EP, 'com.intellij.xdebugger.breakpointGroupingRule')
  assert.equal(XDEBUGGER_SUPPORT_EP, 'com.intellij.xdebugger.debuggerSupport')
  assert.equal(XATTACH_HOST_PROVIDER_EP, 'com.intellij.xdebugger.attachHostProvider')
  for (const id of [XBREAKPOINT_TYPE_EP, XDEBUGGER_SETTINGS_EP, DEBUGGER_CONFIGURABLE_PROVIDER_EP,
    TEXT_VALUE_VISUALIZER_EP, XATTACH_DEBUGGER_PROVIDER_EP, XBREAKPOINT_GROUPING_RULE_EP,
    XDEBUGGER_SUPPORT_EP, XATTACH_HOST_PROVIDER_EP]) {
    assert.ok(EXTENSIONS.hasExtensionPoint(id), `${id} 应已声明`)
  }
  declareXdebuggerExtensionPoints()   // 幂等，不抛
})

test('任务书里 xvaluePresenter / framePresentationProvider / xdebuggerExtension 上游不存在 —— 不造假 EP', () => {
  for (const fake of [
    'com.intellij.xdebugger.xvaluePresenter',
    'com.intellij.xdebugger.framePresentationProvider',
    'com.intellij.xdebugger.xdebuggerExtension',
  ]) {
    assert.equal(EXTENSIONS.hasExtensionPoint(fake), false, `${fake} 上游不是 EP，不许声明`)
  }
  // `debugProcessListener` 是本仓自定 id（上游 `DebugProcessListener` 是 per-process 监听、
  // 不是 EP），它由 `src/debugProcessListeners.ts` 声明 —— 本模块（未 import 那个模块）里不该有。
  assert.equal(EXTENSIONS.hasExtensionPoint('com.intellij.xdebugger.debugProcessListener'), false,
    'debugProcessListener 的声明在 debugProcessListeners.ts，不在本模块')
})

test('bundled 默认贡献：断点类型、设置、可视化、附加/支持、分组、attach host 都在 EP 里', () => {
  assert.equal(xbreakpointTypeById('line')?.getTitle(), '行断点')
  assert.equal(xbreakpointTypeById('exception')?.getTitle(), '异常断点')
  assert.ok(xdebuggerSettingsContributions().some(settings => settings.id === 'taocode.debugger'))
  assert.deepEqual(debuggerConfigurablesFor('GENERAL'), ['taocode.debugger.general'])
  assert.ok(textValueVisualizers().some(visualizer => visualizer.id === 'plainText'))
  assert.ok(xattachDebuggerProviders().some(provider => provider.id === 'dap'))
  assert.ok(xbreakpointGroupingRules().some(rule => rule.id === 'byFile'))
  assert.equal(hasDebuggerSupport(), true, '内建 dap 支持已登记')
  assert.ok(debuggerSupports().some(support => support.id === 'dap'))
  assert.ok(availableAttachHosts().some(host => host.id === 'local'), '内建本机 attach host')
  assert.match(attachHostSummary(), /本机/)
})

test('XBreakpointType：第三方按 id 挂进来被 xbreakpointTypeById 取到，order=first 排最前', () => {
  const handle = registerXBreakpointType({
    id: 'plugin.java-exception', getTitle: () => 'Java 异常',
    isSuspendThreadSupported: () => true, getDefaultSuspendPolicy: () => 'THREAD',
  }, { order: 'first', source: 'user' })
  try {
    assert.equal(xbreakpointTypes()[0].id, 'plugin.java-exception')
    assert.equal(xbreakpointTypeById('plugin.java-exception')?.getTitle(), 'Java 异常')
  } finally { handle.dispose() }
  assert.equal(xbreakpointTypeById('plugin.java-exception'), undefined)
  assert.ok(xbreakpointTypeById('line'), '内建那条还在')
})

test('XDebuggerSettings / DebuggerConfigurableProvider：方法面 createConfigurables/getConfigurables', () => {
  const settings = registerXDebuggerSettings({
    id: 'plugin.settings', createConfigurables: category => (category === 'DATA_VIEWS' ? ['plugin.dataViews'] : []),
  }, { source: 'user' })
  const provider = registerDebuggerConfigurableProvider({
    id: 'plugin.configurable', getConfigurables: category => (category === 'DATA_VIEWS' ? ['plugin.dataViews'] : []),
  }, { source: 'user' })
  try {
    assert.equal(xdebuggerSettingsById('plugin.settings')?.id, 'plugin.settings')
    assert.ok(xdebuggerSettingsContributions().some(entry => entry.id === 'plugin.settings'))
    assert.ok(debuggerConfigurableProviders().some(entry => entry.id === 'plugin.configurable'))
    assert.ok(debuggerConfigurablesFor('DATA_VIEWS').includes('plugin.dataViews'))
  } finally { settings.dispose(); provider.dispose() }
  assert.equal(xdebuggerSettingsById('plugin.settings'), undefined)
})

test('TextValueVisualizer：visualize 出的页被 visualizeTextValue 收拢', () => {
  const handle = registerTextValueVisualizer({
    id: 'plugin.json',
    visualize: value => (value.startsWith('{') ? [{ name: 'JSON', id: 'json', content: value }] : []),
    detectFileType: () => 'json',
  }, { source: 'user' })
  try {
    const tabs = visualizeTextValue('{"a":1}')
    assert.ok(tabs.some(tab => tab.id === 'json' && tab.name === 'JSON'))
    // 内建 plainText 也总是给一页。
    assert.ok(tabs.some(tab => tab.id === 'plainText'))
    assert.deepEqual(visualizeTextValue('plain').filter(tab => tab.id === 'json'), [])
  } finally { handle.dispose() }
})

test('XAttachDebuggerProvider：isAttachHostApplicable 过滤 + getAvailableDebuggers', () => {
  const handle = registerXAttachDebuggerProvider({
    id: 'plugin.remote',
    isAttachHostApplicable: host => host === 'Remote',
    getAvailableDebuggers: process => [{ id: 'remote', displayName: `remote:${process.pid}` }],
    getGroupName: () => 'Remote',
  }, { source: 'user' })
  try {
    assert.equal(xattachDebuggerProvidersFor('Local').some(provider => provider.id === 'plugin.remote'), false)
    const remote = xattachDebuggerProvidersFor('Remote')
    assert.ok(remote.some(provider => provider.id === 'plugin.remote'))
    assert.equal(remote.find(provider => provider.id === 'plugin.remote')?.getAvailableDebuggers({ pid: 7, name: 'x' })[0].displayName, 'remote:7')
  } finally { handle.dispose() }
})

test('XBreakpointGroupingRule：priority 大的在前，getGroup 给分组', () => {
  const handle = registerXBreakpointGroupingRule({
    id: 'plugin.byGroup', getPresentableName: () => '按组', getPriority: () => 100,
    getGroup: breakpoint => (breakpoint.groupName ? { name: breakpoint.groupName } : null),
  }, { source: 'user' })
  try {
    const rules = xbreakpointGroupingRules()
    assert.equal(rules[0].id, 'plugin.byGroup', 'priority 100 排在内建 byFile(10) 之前')
    assert.deepEqual(rules[0].getGroup({ id: 'b', groupName: 'G' }), { name: 'G' })
    assert.equal(rules[0].getGroup({ id: 'b' }), null)
  } finally { handle.dispose() }
})

test('DebuggerSupport：身份表，注册/注销都看得见', () => {
  const handle = registerDebuggerSupport({ id: 'plugin.backend' }, { source: 'user' })
  try {
    assert.ok(debuggerSupports().some(support => support.id === 'plugin.backend'))
    assert.equal(hasDebuggerSupport(), true)
  } finally { handle.dispose() }
  assert.ok(!debuggerSupports().some(support => support.id === 'plugin.backend'))
})

test('XAttachHostProvider：availableAttachHosts / attachHostSummary 是消费面', () => {
  const handle = registerXAttachHostProvider({
    id: 'plugin.remoteHost',
    getPresentationGroup: () => '远程',
    getAvailableHosts: root => (root ? [{ id: 'ssh-1', host: 'Remote', displayName: 'ssh://build' }] : []),
  }, { source: 'user' })
  try {
    assert.ok(xattachHostProviders().some(provider => provider.id === 'plugin.remoteHost'))
    const hosts = availableAttachHosts('/proj')
    assert.ok(hosts.some(host => host.id === 'ssh-1'))
    assert.match(attachHostSummary('/proj'), /ssh:\/\/build/)
    assert.deepEqual(availableAttachHosts(null).filter(host => host.id === 'ssh-1'), [], 'root 为空时插件不给主机')
  } finally { handle.dispose() }
})

test('unregister 对未注册过的 id 返回 false（与宿主同口径）', () => {
  assert.equal(unregisterXdebuggerExtension(XBREAKPOINT_TYPE_EP, 'never.registered'), false)
})
