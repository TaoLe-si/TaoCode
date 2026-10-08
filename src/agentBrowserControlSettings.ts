import {
  defaultSettingsStorage,
  readSettingsJson,
  writeSettingsJson,
  type SettingsStorage,
} from './agentSettingsStore.ts'

// ---------------------------------------------------------------- 浏览器控制设置项

/** 官方浏览器控制插件 id（`BrowserSettingsSection.tsx:30`）。 */
export const ZCODE_BROWSER_USE_PLUGIN_ID = 'browser-use@zcode-plugins-official'

/** 浏览器控制设置的存储键（本仓用 localStorage；ZCode 存应用设置，见文件头）。 */
export const AGENT_BROWSER_CONTROL_STORAGE_KEY = 'taocode.agent.browserControl'

/** 一节里的一个设置项。 */
export interface AgentBrowserSettingDescriptor {
  /** 稳定字段名（宿主接线用）。 */
  key: string
  /** ZCode 的 i18n message id。 */
  messageId: string
  /** zh-CN 原文标签。 */
  label: string
  /** zh-CN 原文描述。 */
  description: string
  /** 控件类型。 */
  kind: 'plugin-toggle' | 'boolean-switch' | 'action' | 'confirm-action'
  /** 布尔项的默认值（`validationAppSettings.ts:432` 等）；非布尔为 null。 */
  defaultValue: boolean | null
}

/**
 * 「浏览器控制」节的全部设置项，字段名 / 文案 / 默认值逐条照源码。
 * 文案行号见各条注释（`zh-CN.ts`）。
 */
export function agentBrowserSettingDescriptors(): AgentBrowserSettingDescriptor[] {
  return [
    {
      key: 'browserControlEnabled',
      messageId: 'settings.browser.control.title',
      label: '开启内置浏览器控制',
      description: '启用 Browser Use 官方插件，让新会话可以通过内置浏览器访问和操作网页。',
      kind: 'plugin-toggle',
      // 开关就是官方插件 browser-use@zcode-plugins-official 的启用态
      // （BrowserSettingsSection.tsx:30, 153-157, 241-242）；默认未启用。
      defaultValue: false,
    },
    {
      key: 'allowInsecureCertificates',
      messageId: 'settings.embeddedBrowserAllowInsecureCertificates',
      label: '忽略证书校验',
      description: '开启后内置浏览器不再校验 HTTPS 证书，仅影响内置浏览器。修改后需重启生效。',
      kind: 'boolean-switch',
      // 默认 false（validationAppSettings.ts:432；BrowserSettingsSection.tsx:79）。
      defaultValue: false,
    },
    {
      key: 'importChromeData',
      messageId: 'settings.browser.import.action',
      label: '导入浏览器数据',
      description: '一次性把 Chrome 登录状态带到内置浏览器，AI 就能直接打开你已经登录的网站，操作更流畅。',
      kind: 'action',
      defaultValue: null,
    },
    {
      key: 'clearCache',
      messageId: 'settings.browser.clearCache.action',
      label: '清除缓存',
      description: '清除 HTTP 缓存、Cache Storage 和 Service Worker，保留 Cookie 和本地站点数据。',
      kind: 'action',
      defaultValue: null,
    },
    {
      key: 'clearAll',
      messageId: 'settings.browser.clearAll.action',
      label: '清除全部',
      description: '删除内置浏览器中的 Cookie、站点数据和缓存。此操作不可撤销。',
      kind: 'confirm-action',
      defaultValue: null,
    },
  ]
}

/** 「浏览器控制」节的分区标题（`zh-CN.ts:2273` / `:2279`）。 */
export const AGENT_BROWSER_SECURITY_SECTION_TITLE = '安全'
export const AGENT_BROWSER_DATA_SECTION_TITLE = '浏览器数据'

/** 非桌面宿主的整块替换文案（`BrowserSettingsSection.tsx:335-339`，`zh-CN.ts:2280`）。 */
export const AGENT_BROWSER_DESKTOP_ONLY_NOTICE = '浏览器数据只能在 ZCode 桌面端管理。'

/**
 * 导入入口是否展示（`BrowserSettingsSection.tsx:270-273`）：
 * Windows 桌面隐藏（App-Bound 导入链路未开放），其余平台展示。
 */
export function shouldShowBrowserImportEntry(platform: { isWindowsDesktop?: boolean } = {}): boolean {
  return platform.isWindowsDesktop !== true
}

/** 原生数据动作是否可用（`BrowserSettingsSection.tsx:107-110`）。 */
export function browserNativeActionsAvailable(platform: {
  isDesktop?: boolean
  hasImportChromeBrowserData?: boolean
  hasClearEmbeddedBrowserData?: boolean
} = {}): boolean {
  return (
    platform.isDesktop === true &&
    platform.hasImportChromeBrowserData === true &&
    platform.hasClearEmbeddedBrowserData === true
  )
}

// ---------------------------------------------------------------- 浏览器控制存储

/** 本仓落盘的浏览器控制设置。 */
export interface AgentBrowserControlSettings {
  /** 总开关（= 官方插件启用态）。 */
  browserControlEnabled: boolean
  /** 忽略证书校验，默认 false。 */
  allowInsecureCertificates: boolean
}

export function defaultAgentBrowserControlSettings(): AgentBrowserControlSettings {
  return { browserControlEnabled: false, allowInsecureCertificates: false }
}

/**
 * 归一化：**永不抛、永不返回坏值** —— 逐字段救，救不了的退该字段默认
 * （本仓铁律：不许按字段数量判损坏）。
 */
export function normalizeAgentBrowserControlSettings(input: unknown): AgentBrowserControlSettings {
  const defaults = defaultAgentBrowserControlSettings()
  if (!input || typeof input !== 'object') {
    return defaults
  }
  const raw = input as Record<string, unknown>
  return {
    browserControlEnabled:
      typeof raw.browserControlEnabled === 'boolean' ? raw.browserControlEnabled : defaults.browserControlEnabled,
    allowInsecureCertificates:
      typeof raw.allowInsecureCertificates === 'boolean'
        ? raw.allowInsecureCertificates
        : defaults.allowInsecureCertificates,
  }
}

/** 读存档（缺省走 localStorage；坏档 / 无存储退默认，永不抛）。 */
export function loadAgentBrowserControlSettings(
  storage: SettingsStorage | null = defaultSettingsStorage(),
): AgentBrowserControlSettings {
  return readSettingsJson(storage, AGENT_BROWSER_CONTROL_STORAGE_KEY, normalizeAgentBrowserControlSettings)
}

/** 写存档。返回**有没有真的落盘**（配额满 / 隐私模式静默降级）。 */
export function saveAgentBrowserControlSettings(
  settings: AgentBrowserControlSettings,
  storage: SettingsStorage | null = defaultSettingsStorage(),
): boolean {
  return writeSettingsJson(storage, AGENT_BROWSER_CONTROL_STORAGE_KEY, settings)
}
