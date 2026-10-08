// 浏览器控制设置判据。
import test from 'node:test'
import assert from 'node:assert/strict'
import {
  AGENT_BROWSER_CONTROL_STORAGE_KEY,
  AGENT_BROWSER_DATA_SECTION_TITLE,
  AGENT_BROWSER_DESKTOP_ONLY_NOTICE,
  AGENT_BROWSER_SECURITY_SECTION_TITLE,
  ZCODE_BROWSER_USE_PLUGIN_ID,
  agentBrowserSettingDescriptors,
  browserNativeActionsAvailable,
  defaultAgentBrowserControlSettings,
  loadAgentBrowserControlSettings,
  normalizeAgentBrowserControlSettings,
  saveAgentBrowserControlSettings,
  shouldShowBrowserImportEntry,
} from '../src/agentBrowserControlSettings.ts'
import { createMemoryStorage, createThrowingStorage } from '../src/agentSettingsStore.ts'
// ---------------------------------------------------------------- 浏览器控制设置项

test('设置项字段名 / 文案 / 默认值照源码', () => {
  // zh-CN.ts:2268-2335；validationAppSettings.ts:432；BrowserSettingsSection.tsx:30, 79, 107-110
  const items = agentBrowserSettingDescriptors()
  assert.deepEqual(
    items.map(item => item.key),
    ['browserControlEnabled', 'allowInsecureCertificates', 'importChromeData', 'clearCache', 'clearAll'],
  )
  const cert = items.find(item => item.key === 'allowInsecureCertificates')
  assert.equal(cert.label, '忽略证书校验')
  assert.equal(cert.defaultValue, false)
  const toggle = items.find(item => item.key === 'browserControlEnabled')
  assert.equal(toggle.label, '开启内置浏览器控制')
  assert.equal(toggle.kind, 'plugin-toggle')
  assert.equal(toggle.defaultValue, false)
  const clearAll = items.find(item => item.key === 'clearAll')
  assert.equal(clearAll.kind, 'confirm-action')
  assert.equal(clearAll.label, '清除全部')
})

test('Windows 桌面隐藏导入入口；原生动作需桌面 + 两条通道', () => {
  // BrowserSettingsSection.tsx:270-273 与 :107-110
  assert.equal(shouldShowBrowserImportEntry({ isWindowsDesktop: false }), true)
  assert.equal(shouldShowBrowserImportEntry({ isWindowsDesktop: true }), false)
  assert.equal(browserNativeActionsAvailable({
    isDesktop: true, hasImportChromeBrowserData: true, hasClearEmbeddedBrowserData: true,
  }), true)
  assert.equal(browserNativeActionsAvailable({ isDesktop: true, hasImportChromeBrowserData: true }), false)
})

// ---------------------------------------------------------------- 存储（窄接口 + 坏档永不抛）

test('浏览器控制默认值：两格都关', () => {
  assert.deepEqual(defaultAgentBrowserControlSettings(), {
    browserControlEnabled: false, allowInsecureCertificates: false,
  })
})

test('归一化逐字段救，垃圾退默认', () => {
  assert.deepEqual(normalizeAgentBrowserControlSettings(null), defaultAgentBrowserControlSettings())
  assert.deepEqual(normalizeAgentBrowserControlSettings({ allowInsecureCertificates: true }), {
    browserControlEnabled: false, allowInsecureCertificates: true,
  })
  assert.deepEqual(normalizeAgentBrowserControlSettings({ browserControlEnabled: 'yes', allowInsecureCertificates: 1 }), {
    browserControlEnabled: false, allowInsecureCertificates: false,
  })
})

test('存档往返：写进去读得回来', () => {
  const storage = createMemoryStorage()
  assert.equal(saveAgentBrowserControlSettings({ browserControlEnabled: true, allowInsecureCertificates: true }, storage), true)
  assert.deepEqual(loadAgentBrowserControlSettings(storage), {
    browserControlEnabled: true, allowInsecureCertificates: true,
  })
  assert.ok(storage.dump()[AGENT_BROWSER_CONTROL_STORAGE_KEY])
})

test('坏档 / 无存储 / getItem 抛 —— 一律退默认，永不抛', () => {
  assert.deepEqual(loadAgentBrowserControlSettings(null), defaultAgentBrowserControlSettings())
  assert.deepEqual(
    loadAgentBrowserControlSettings(createMemoryStorage({ [AGENT_BROWSER_CONTROL_STORAGE_KEY]: '{坏 JSON' })),
    defaultAgentBrowserControlSettings(),
  )
  assert.deepEqual(loadAgentBrowserControlSettings(createThrowingStorage()), defaultAgentBrowserControlSettings())
  assert.equal(saveAgentBrowserControlSettings(defaultAgentBrowserControlSettings(), createThrowingStorage()), false)
})