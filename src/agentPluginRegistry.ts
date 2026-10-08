// Agent 设置「插件」节的**注册表（管理面）** —— 条目形状 / 校验 / 启停 / 组件分组 /
// 卸载确认 / 市场来源，纯逻辑，零 Vue、零 DOM、零网络。2026-10-07。
//
// 与 `src/agentPlugins.ts` 并存：那边是**只读投影面**（能力投影、来源标签、启停闸门、
// 覆盖层持久化；marketplace 只有 `{id, name}` 两格，`agentPlugins.ts:102-106`）。本节是
// **管理面**：`ZCodePluginInfo` 还带 hooks 明细 / userConfig / configuredOptions /
// optionSources / listing / 安装记录（`zcode-protocol/index.ts:2535-2566`），市场来源是完整的
// `ZCodePluginMarketplaceSummary`（`index.ts:3057-3078`），另有卸载确认状态机
// （`usePluginUninstall.ts:27-64`）与市场源增删（`PluginStoreSourcesDialog.tsx:41-151`）。
// 基础条目形状与逐字段救法、组件类型常量/标签、作用域常量、启停闸门、marketplace 展示名
// 全部**复用只读面**不重抄；存储机制复用 `agentSettingsStore.ts`。
//
// 与本仓既有的 IDEA 面插件体系（`pluginGroups.ts` / `pluginMarket.ts` / `pluginInfo.ts` /
// `pluginServices.ts`）**并存、不合并**：那几份对照 IDEA 的 `PluginInfo`
// （`pluginGroups.ts:47-87`）与 IDEA 仓库清单（`pluginMarket.ts:35-61`、`pluginMarketRemote.ts:34`），
// 字段名与语义不同（`marketplace` / `components` / `enabledSource` / `listing.requiresPaidPlan` /
// `packageStatus`…），合成一个类型会让「这一格是谁的」失去判据。两面真正该共用的只有存储机制
// 与 EP 宿主（`pluginServices.ts:31` 已在用后者）。
//
// 坏档一律救回默认，**永不抛**（本仓铁律：不许按字段数量判损坏 —— `agentSettingsStore.ts:9-11`）。
import {
  AGENT_PLUGIN_COMPONENT_KINDS, AGENT_PLUGIN_COMPONENT_LABELS, AGENT_PLUGIN_GROUP_LABELS,
  AGENT_PLUGIN_SCOPES, AGENT_PLUGIN_SCOPE_LABELS, AGENT_PLUGIN_TABS,
  ZCODE_OFFICIAL_PLUGIN_MARKETPLACE_ID, applyPluginEnabledChange, normalizeAgentPluginsSettings,
  pluginCapabilityProjectionOf, resolveMarketplaceDisplayName,
  type AgentPluginComponentItem, type AgentPluginComponentKind, type AgentPluginEntry,
  type AgentPluginScope, type AgentPluginTab,
} from './agentPlugins.ts'
import { defaultSettingsStorage, readSettingsJson, writeSettingsJson, type SettingsStorage } from './agentSettingsStore.ts'

/** 存储键。与 `agentPlugins.ts:37` / `agentSkillRegistry.ts:54` 同一族（localStorage）。 */
export const AGENT_PLUGIN_REGISTRY_STORAGE_KEY = 'taocode.agent.plugins.registry'
/** 组件分组顺序（已安装详情 / 共享分组组件）：`pluginManagedResourceGroups.ts:22-28`。 */
export const AGENT_PLUGIN_COMPONENT_ORDER: readonly AgentPluginComponentKind[] = ['agent', 'command', 'skill', 'hook', 'mcp']

// 本节文案，**逐字取 zh-CN 原文**；尾注 = i18n key + 行号，括号内是 ZCode 消费点。
export const AGENT_PLUGIN_MESSAGES = {
  sectionTitle: '插件', // settings.plugins.title zh-CN.ts:3695（PluginsSection.tsx:669）
  sectionDescription: '启用或停用已安装的插件。插件可打包技能、命令、Hooks 和 MCP 服务器。', // zh-CN.ts:3737-3738
  groupInstalled: AGENT_PLUGIN_GROUP_LABELS.installed, // zh-CN.ts:3703（PluginsSection.tsx:784）
  groupBuiltIn: AGENT_PLUGIN_GROUP_LABELS.builtIn, // zh-CN.ts:3704（PluginsSection.tsx:881）
  noWorkspace: '请先打开工作区以管理能力。', // zh-CN.ts:3730（PluginsSection.tsx:848）
  scopeUser: AGENT_PLUGIN_SCOPE_LABELS.user, // zh-CN.ts:3696（PluginScopeMenu.tsx:72）
  scopeWorkspaces: '工作区', // zh-CN.ts:3697（PluginScopeMenu.tsx:112）
  scopeUserDefault: 'User 默认', // zh-CN.ts:2534（PluginsSection.tsx:526）
  scopeInheritedUser: '继承 User 默认', // zh-CN.ts:2533（PluginsSection.tsx:530）
  scopeWorkspaceOverride: '本工作区覆盖', // zh-CN.ts:2535（PluginsSection.tsx:534）
  scopeRestored: '已将 {plugin} 恢复为 User 默认', // zh-CN.ts:2537（PluginsSection.tsx:361）
  scopeUnavailableFallback: '目标工作区已关闭或断开，已回退到用户插件配置。', // zh-CN.ts:3731（PluginsSection.tsx:1101）
  toggleEnable: '启用 {plugin}', // zh-CN.ts:2539（PluginsSection.tsx:619）
  toggleDisable: '停用 {plugin}', // zh-CN.ts:2540（PluginsSection.tsx:620）
  togglePending: '正在更新 {plugin}…', // zh-CN.ts:2541（PluginsSection.tsx:599）
  toggleEnabled: '已启用 {plugin}', // zh-CN.ts:2542（PluginsSection.tsx:340）
  toggleDisabled: '已停用 {plugin}', // zh-CN.ts:2543（PluginsSection.tsx:341）
  toggleWorkspaceEnabled: '已在当前工作区启用 {plugin}（覆盖 User 默认）', // zh-CN.ts:2544（PluginsSection.tsx:337）
  toggleWorkspaceDisabled: '已在当前工作区停用 {plugin}（覆盖 User 默认）', // zh-CN.ts:2545（PluginsSection.tsx:338）
  toggleFailed: '无法更新 {plugin}，请重试。', // zh-CN.ts:2546（PluginsSection.tsx:329）
  uninstallConfirmTitle: '卸载 {name}？', // zh-CN.ts:3844（PluginUninstallConfirmDialog.tsx:40）
  uninstallConfirmDescription: '将删除该插件的缓存文件、数据目录以及已保存的配置。此操作无法撤销。', // zh-CN.ts:3845-3846（同弹窗:45）
  uninstallConfirm: '卸载', // zh-CN.ts:3847（同弹窗:69）
  cancel: '取消', // common.cancel zh-CN.ts:171（同弹窗:55）
  sourcesPluginCount: '{count} 个插件', // zh-CN.ts:3771（PluginStoreSourcesDialog.tsx:91）
  sourcesLastUpdated: '更新于 {time}', // zh-CN.ts:3772（同弹窗:96）
  sourcesRefreshFailed: '刷新失败于 {time}', // zh-CN.ts:3773（同弹窗:31）
  sourcesUpdate: '刷新该市场', // zh-CN.ts:3774（同弹窗:112）
  sourcesRemove: '移除该市场', // zh-CN.ts:3775（同弹窗:131）
  detailItems: '{count} 项', // zh-CN.ts:3858（PluginComponentGroups.tsx:64）
  componentsEmpty: '无组件', // zh-CN.ts:3862
  componentsWhenEnabled: '启用插件后查看其组件。', // zh-CN.ts:3863
  hookDefaultMatcher: '默认 matcher', // zh-CN.ts:3875（InstalledPluginManagement.tsx:57）
  hookRunnable: '可运行', // zh-CN.ts:3877（同文件:63）
  hookDiagnosticOnly: '仅诊断展示', // zh-CN.ts:3876（同文件:66）
} as const

/** 模板替换（ZCode 走 `intl.formatMessage`；纯逻辑层用同名占位符手替）。 */
export function formatPluginMessage(template: string, params: Record<string, string> = {}): string {
  return template.replace(/\{(\w+)\}/gu, (whole, key: string) => (key in params ? params[key]! : whole))
}

// ── 形状（ZCode 字段逐条对齐 `zcode-protocol/index.ts:2535-2566`）──────────────

/** 一条 hook 明细（`zcodePluginHookDetailSchema`，`index.ts:2487-2502`）。 */
export interface AgentPluginHookDetail {
  event: string
  matcher?: string
  /** `command` | `process`（`index.ts:2491`）。 */
  type: string
  command: string
  args?: string[]
  async?: boolean
  /** `true` | shell 名（`index.ts:2494`）。 */
  shell?: string | true
  timeout?: number
  timeoutMs?: number
  statusMessage?: string
  sourcePath: string
  runnable: boolean
}

/** 一个 userConfig 配置项（`zcodePluginUserConfigOptionSchema`，`index.ts:2503-2512`）。 */
export interface AgentPluginUserConfigOption {
  default?: string | number | boolean
  description?: string
  required?: boolean
  sensitive?: boolean
  title?: string
  /** `string` | `number` | `boolean` | `directory` | `file`（`index.ts:2511`）。 */
  type?: string
}

/** 商店 listing（`zcodePluginStoreListingSchema`，`index.ts:3004-3026`）。 */
export interface AgentPluginStoreListing {
  displayName?: string
  displayNameI18n?: Record<string, string>
  descriptionI18n?: Record<string, string>
  icon?: string
  category?: string
  author?: string
  authorUrl?: string
  homepage?: string
  privacyPolicy?: string
  termsOfService?: string
  heroImage?: string
  examplePrompts?: string[]
  examplePromptsI18n?: Record<string, string[]>
  /** 「需要付费套餐才好用」的使用条件，不做安装门禁（`index.ts:3019-3024`）。 */
  requiresPaidPlan?: boolean
}

/** 已安装记录里本节消费的那几格（`zcodeInstalledPluginSummarySchema`，`index.ts:3094-3112`）。 */
export interface AgentPluginInstalledMeta {
  description?: string
  version?: string
  scope: AgentPluginScope
  installPath?: string
  installedAt?: string
  componentTypes?: string[]
  /** `none` | `update-available` | `version-changed`（`index.ts:3107`）。 */
  updateStatus?: 'none' | 'update-available' | 'version-changed'
  latestVersion?: string
}

/** 一个市场来源（`zcodePluginMarketplaceSummarySchema`，`index.ts:3057-3078`）。 */
export interface AgentPluginMarketplaceSource {
  id: string
  name: string
  /** 来源描述对象（GitHub 仓库 / Git URL / 目录；`index.ts:3061` 是 `jsonObjectSchema`）。 */
  source: Record<string, unknown>
  description?: string
  lastUpdated?: string
  pluginCount: number
  isOfficial?: boolean
  /** 目录顶层 featured 策展名单（`index.ts:3067`）。 */
  featured?: string[]
  refreshFailure?: { code: string; failedAt: string; message: string }
}

/** 注册表里的一条插件（只读面那半 + 管理面那半）。 */
export interface AgentPluginRegistryEntry extends AgentPluginEntry {
  author?: string
  authorUrl?: string
  homepage?: string
  skillCount?: number
  skillRootCount?: number
  commandRootCount?: number
  declaredMcpServerNames?: string[]
  hostMcpServerNames?: string[]
  hookDetails?: AgentPluginHookDetail[]
  userConfig?: Record<string, AgentPluginUserConfigOption>
  configuredOptions?: Record<string, string | number | boolean>
  optionSources?: Record<string, AgentPluginScope>
  listing?: AgentPluginStoreListing
  installedMeta?: AgentPluginInstalledMeta
}

/** 注册表设置：条目 + 分组/来源辅助表 + 当前视图（Tab / 作用域 / 搜索词）。 */
export interface AgentPluginRegistrySettings {
  entries: AgentPluginRegistryEntry[]
  /** 划入「内置」组的插件 id（`pluginCapabilityProjection.ts:36-47` 的第二入参）。 */
  builtInPluginIds: string[]
  marketplaces: AgentPluginMarketplaceSource[]
  tab: AgentPluginTab
  scope: AgentPluginScope
  /** 作用域选择器选中的 key（`PluginScopeMenu.tsx:17-19` 的 workspaceKey，或 `user` 槽位）。 */
  scopeKey: string
  query: string
}

export function defaultAgentPluginRegistry(): AgentPluginRegistrySettings {
  return { entries: [], builtInPluginIds: [], marketplaces: [], tab: 'plugins', scope: 'user', scopeKey: 'user', query: '' }
}

// ── 归一化（逐字段救，永不抛）────────────────────────────────────────────────

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
function text(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}
function optionalText(value: unknown): string | undefined {
  return text(value) || undefined
}
function nonNegativeInt(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0 ? value : undefined
}
function textList(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined
  const list = value.filter((item): item is string => typeof item === 'string').map((item) => item.trim()).filter(Boolean)
  return list.length > 0 ? list : undefined
}
function textRecord(value: unknown): Record<string, string> | undefined {
  if (!isRecord(value)) return undefined
  const out: Record<string, string> = {}
  for (const [key, item] of Object.entries(value)) if (typeof item === 'string') out[key] = item
  return Object.keys(out).length > 0 ? out : undefined
}
function stringListRecord(value: unknown): Record<string, string[]> | undefined {
  if (!isRecord(value)) return undefined
  const out: Record<string, string[]> = {}
  for (const [key, item] of Object.entries(value)) {
    const list = textList(item)
    if (list) out[key] = list
  }
  return Object.keys(out).length > 0 ? out : undefined
}
function scopeOf(value: unknown): AgentPluginScope | undefined {
  return value === 'user' || value === 'workspace' ? value : undefined
}
function optionValueOf(value: unknown): string | number | boolean | undefined {
  return typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean' ? value : undefined
}
/** 逐格拷可选文本字段：空串/非串一律不写（`index.ts` 各 optional 字段口径）。 */
function copyText(target: object, raw: Record<string, unknown>, keys: readonly string[]): void {
  const bag = target as Record<string, unknown>
  for (const key of keys) {
    const value = optionalText(raw[key])
    if (value) bag[key] = value
  }
}
function copyTextList(target: object, raw: Record<string, unknown>, keys: readonly string[]): void {
  const bag = target as Record<string, unknown>
  for (const key of keys) {
    const list = textList(raw[key])
    if (list) bag[key] = list
  }
}
/** 逐键救一个记录（值类型由 `pick` 决定；`null` / `undefined` 都丢该键）。 */
function recordOf<T>(value: unknown, pick: (item: unknown) => T | null | undefined): Record<string, T> | undefined {
  if (!isRecord(value)) return undefined
  const out: Record<string, T> = {}
  for (const [key, item] of Object.entries(value)) {
    const picked = pick(item)
    if (picked !== undefined && picked !== null) out[key] = picked
  }
  return Object.keys(out).length > 0 ? out : undefined
}

function normalizeStoreListing(input: unknown): AgentPluginStoreListing | undefined {
  if (!isRecord(input)) return undefined
  const listing: AgentPluginStoreListing = {}
  copyText(listing, input, ['displayName', 'icon', 'category', 'author', 'authorUrl', 'homepage', 'privacyPolicy', 'termsOfService', 'heroImage'])
  copyTextList(listing, input, ['examplePrompts'])
  const displayNameI18n = textRecord(input.displayNameI18n)
  if (displayNameI18n) listing.displayNameI18n = displayNameI18n
  const descriptionI18n = textRecord(input.descriptionI18n)
  if (descriptionI18n) listing.descriptionI18n = descriptionI18n
  const examplePromptsI18n = stringListRecord(input.examplePromptsI18n)
  if (examplePromptsI18n) listing.examplePromptsI18n = examplePromptsI18n
  if (typeof input.requiresPaidPlan === 'boolean') listing.requiresPaidPlan = input.requiresPaidPlan
  return Object.keys(listing).length > 0 ? listing : undefined
}

function normalizeHookDetail(input: unknown): AgentPluginHookDetail | null {
  if (!isRecord(input)) return null
  const event = text(input.event)
  const command = text(input.command)
  // event / command 是 nonEmptyString（`index.ts:2490,2492`），缺失即这条 hook 不成形，丢单条。
  if (!event || !command) return null
  const hook: AgentPluginHookDetail = { event, type: input.type === 'process' ? 'process' : 'command', command, sourcePath: text(input.sourcePath), runnable: input.runnable === true }
  copyText(hook, input, ['matcher', 'statusMessage'])
  copyTextList(hook, input, ['args'])
  if (typeof input.async === 'boolean') hook.async = input.async
  if (input.shell === true) hook.shell = true
  else if (optionalText(input.shell)) hook.shell = optionalText(input.shell)
  if (typeof input.timeout === 'number' && input.timeout > 0) hook.timeout = input.timeout
  if (typeof input.timeoutMs === 'number' && Number.isInteger(input.timeoutMs) && input.timeoutMs > 0) hook.timeoutMs = input.timeoutMs
  return hook
}

function normalizeUserConfigOption(input: unknown): AgentPluginUserConfigOption | null {
  if (!isRecord(input)) return null
  const option: AgentPluginUserConfigOption = {}
  copyText(option, input, ['description', 'title'])
  const value = optionValueOf(input.default)
  if (value !== undefined) option.default = value
  if (typeof input.required === 'boolean') option.required = input.required
  if (typeof input.sensitive === 'boolean') option.sensitive = input.sensitive
  if (['string', 'number', 'boolean', 'directory', 'file'].includes(String(input.type))) option.type = String(input.type)
  return Object.keys(option).length > 0 ? option : null
}

function normalizeInstalledMeta(input: unknown): AgentPluginInstalledMeta | undefined {
  if (!isRecord(input)) return undefined
  const meta: AgentPluginInstalledMeta = { scope: scopeOf(input.scope) ?? 'user' }
  copyText(meta, input, ['description', 'version', 'installPath', 'installedAt', 'latestVersion'])
  copyTextList(meta, input, ['componentTypes'])
  if (input.updateStatus === 'none' || input.updateStatus === 'update-available' || input.updateStatus === 'version-changed') meta.updateStatus = input.updateStatus
  return meta
}

/** 单条归一化。id/name 救不回来就丢单条（不丢整表）。基础字段（id / name / enabled / source / marketplace / components / mcpServerNames / rootPath / packageStatus / 作用域 / 依赖面）借只读面逐字段救法（`agentPlugins.ts:239-272`），本函数只补管理面那几格。 */
export function normalizeAgentPluginRegistryEntry(input: unknown): AgentPluginRegistryEntry | null {
  const base = normalizeAgentPluginsSettings({ entries: [input] }).entries[0]
  if (!base) return null
  const raw = isRecord(input) ? input : {}
  const entry: AgentPluginRegistryEntry = { ...base }
  copyText(entry, raw, ['author', 'authorUrl', 'homepage'])
  for (const key of ['skillCount', 'skillRootCount', 'commandRootCount'] as const) {
    const value = nonNegativeInt(raw[key])
    if (value !== undefined) entry[key] = value
  }
  copyTextList(entry, raw, ['declaredMcpServerNames', 'hostMcpServerNames'])
  if (Array.isArray(raw.hookDetails)) {
    const hooks = raw.hookDetails.map(normalizeHookDetail).filter((hook): hook is AgentPluginHookDetail => hook !== null)
    if (hooks.length > 0) entry.hookDetails = hooks
  }
  const userConfig = recordOf(raw.userConfig, normalizeUserConfigOption)
  if (userConfig) entry.userConfig = userConfig
  const configuredOptions = recordOf(raw.configuredOptions, optionValueOf)
  if (configuredOptions) entry.configuredOptions = configuredOptions
  const optionSources = recordOf(raw.optionSources, scopeOf)
  if (optionSources) entry.optionSources = optionSources
  const listing = normalizeStoreListing(raw.listing)
  if (listing) entry.listing = listing
  const installedMeta = normalizeInstalledMeta(raw.installedMeta)
  if (installedMeta) entry.installedMeta = installedMeta
  return entry
}

function normalizeMarketplaceSource(input: unknown): AgentPluginMarketplaceSource | null {
  if (!isRecord(input)) return null
  const id = text(input.id)
  if (!id) return null
  const market: AgentPluginMarketplaceSource = { id, name: text(input.name) || id, source: isRecord(input.source) ? input.source : {}, pluginCount: nonNegativeInt(input.pluginCount) ?? 0 }
  copyText(market, input, ['description', 'lastUpdated'])
  copyTextList(market, input, ['featured'])
  if (typeof input.isOfficial === 'boolean') market.isOfficial = input.isOfficial
  if (isRecord(input.refreshFailure)) {
    market.refreshFailure = { code: text(input.refreshFailure.code), failedAt: text(input.refreshFailure.failedAt), message: typeof input.refreshFailure.message === 'string' ? input.refreshFailure.message : '' }
  }
  return market
}

/** 把任意输入归一成一份合法注册表。**永不抛、永不返回坏值**。同 id 去重：id 是插件主键（`index.ts:2537`），重复行只会让「已启用 n/m」的分母虚高。 */
export function normalizeAgentPluginRegistry(input: unknown): AgentPluginRegistrySettings {
  const defaults = defaultAgentPluginRegistry()
  if (!isRecord(input)) return defaults
  const entries: AgentPluginRegistryEntry[] = []
  const seen = new Set<string>()
  for (const item of Array.isArray(input.entries) ? input.entries : []) {
    const entry = normalizeAgentPluginRegistryEntry(item)
    if (!entry || seen.has(entry.id)) continue
    seen.add(entry.id)
    entries.push(entry)
  }
  const builtInPluginIds: string[] = []
  for (const id of Array.isArray(input.builtInPluginIds) ? input.builtInPluginIds : []) {
    const trimmed = text(id)
    if (trimmed && !builtInPluginIds.includes(trimmed)) builtInPluginIds.push(trimmed)
  }
  const marketplaces: AgentPluginMarketplaceSource[] = []
  for (const item of Array.isArray(input.marketplaces) ? input.marketplaces : []) {
    const market = normalizeMarketplaceSource(item)
    if (!market || marketplaces.some((existing) => existing.id === market.id)) continue
    marketplaces.push(market)
  }
  return {
    entries,
    builtInPluginIds,
    marketplaces,
    tab: (AGENT_PLUGIN_TABS as readonly string[]).includes(String(input.tab)) ? (input.tab as AgentPluginTab) : defaults.tab,
    scope: input.scope === 'workspace' ? 'workspace' : defaults.scope,
    scopeKey: text(input.scopeKey) || defaults.scopeKey,
    query: typeof input.query === 'string' ? input.query : defaults.query,
  }
}

// ── 校验（保存前拦下用户敲进去的坏数据）──────────────────────────────────────

function escapesPluginRoot(path: string): boolean {
  return path.split(/[\\/]+/u).some((segment) => segment === '..')
}

/** 保存前校验。依据：空 id/空名（`index.ts:2537-2538`）；重名（id 是主键）；路径越界；启用了却没物化（`PluginsSection.tsx:544` 隐藏 missing 行菜单）；配置来源指向不存在的项（`index.ts:2565`）；市场源空/重复 id（`:3059`）；`builtInPluginIds` 指向不存在条目。 */
export function validateAgentPluginRegistry(settings: AgentPluginRegistrySettings): string[] {
  const problems: string[] = []
  const entries = Array.isArray(settings?.entries) ? settings.entries : []
  const seen = new Set<string>()
  for (const entry of entries) {
    const id = text(entry?.id)
    if (!id) {
      problems.push('插件 id 不能为空。')
      continue
    }
    if (!text(entry.name)) problems.push(`插件「${id}」的名称不能为空。`)
    if (seen.has(id)) problems.push(`插件「${id}」重名：同 id 只能是同一个插件。`)
    seen.add(id)
    const rootPath = text(entry.rootPath)
    if (rootPath && escapesPluginRoot(rootPath)) problems.push(`插件「${entry.name}」的路径越出插件目录：${rootPath}`)
    if (entry.packageStatus === 'missing' && entry.enabled) problems.push(`插件「${entry.name}」在本机尚未物化（packageStatus=missing），不能处于启用态。`)
    for (const key of Object.keys(entry.optionSources ?? {})) {
      if (!(entry.userConfig ?? {})[key]) problems.push(`插件「${entry.name}」的配置来源「${key}」没有对应的配置项。`)
    }
  }
  const marketIds = new Set<string>()
  for (const market of Array.isArray(settings?.marketplaces) ? settings.marketplaces : []) {
    const id = text(market?.id)
    if (!id) problems.push('市场源 id 不能为空。')
    else if (marketIds.has(id)) problems.push(`市场源「${id}」重复登记。`)
    else marketIds.add(id)
  }
  for (const id of Array.isArray(settings?.builtInPluginIds) ? settings.builtInPluginIds : []) {
    if (!entries.some((entry) => entry.id === id)) problems.push(`内置插件「${id}」不在当前清单里，分组会对不上。`)
  }
  return problems
}

// ── 持久化（窄接口 + 坏档永不抛）──────────────────────────────────────────────

export function loadAgentPluginRegistry(storage: SettingsStorage | null = defaultSettingsStorage()): AgentPluginRegistrySettings {
  return readSettingsJson(storage, AGENT_PLUGIN_REGISTRY_STORAGE_KEY, normalizeAgentPluginRegistry)
}
export function saveAgentPluginRegistry(settings: AgentPluginRegistrySettings, storage: SettingsStorage | null = defaultSettingsStorage()): boolean {
  return writeSettingsJson(storage, AGENT_PLUGIN_REGISTRY_STORAGE_KEY, settings)
}

// ── 分组、作用域、组件 ───────────────────────────────────────────────────────

/** 设置页只展示已物化的插件（`pluginCapabilityProjection.ts:32-47`）。 */
export function partitionAgentPluginRegistry(
  entries: readonly AgentPluginRegistryEntry[],
  builtInPluginIds: readonly string[],
): { installed: AgentPluginRegistryEntry[]; builtIn: AgentPluginRegistryEntry[] } {
  const builtIn = new Set(builtInPluginIds)
  const materialized = entries.filter((entry) => entry.packageStatus !== 'missing')
  return {
    installed: materialized.filter((entry) => !builtIn.has(entry.id)),
    // 内置组按官方文档插件置顶序（`pluginStoreOrdering.ts:14-24` + `pluginCapabilityProjection.ts:44-46`）。
    builtIn: materialized
      .filter((entry) => builtIn.has(entry.id))
      .slice()
      .sort((left, right) => pluginCapabilityProjectionOf(left).documentRank - pluginCapabilityProjectionOf(right).documentRank || left.id.localeCompare(right.id)),
  }
}

/** 作用域徽标（`PluginsSection.tsx:521-537`）：`scope` 取 `enabledSource ?? "default"`，`label` 只在三个分支里有值。 */
export function agentPluginScopeBadge(entry: AgentPluginRegistryEntry, configScope: AgentPluginScope): { scope: 'default' | 'user' | 'workspace'; label?: string } {
  const enabledSource = entry.enabledSource
  if (configScope === 'user' && enabledSource === 'user') return { scope: 'user', label: AGENT_PLUGIN_MESSAGES.scopeUserDefault }
  if (enabledSource === 'user') return { scope: 'user', label: AGENT_PLUGIN_MESSAGES.scopeInheritedUser }
  if (enabledSource === 'workspace') return { scope: 'workspace', label: AGENT_PLUGIN_MESSAGES.scopeWorkspaceOverride }
  return { scope: 'default' }
}

/** 启停开关的 aria-label（`PluginsSection.tsx:616-629`）。 */
export function agentPluginToggleLabel(entry: AgentPluginRegistryEntry): string {
  return formatPluginMessage(entry.enabled ? AGENT_PLUGIN_MESSAGES.toggleDisable : AGENT_PLUGIN_MESSAGES.toggleEnable, { plugin: entry.name })
}
/** 启停进行中的 aria-label（`PluginsSection.tsx:598-608`）。 */
export function agentPluginTogglePendingLabel(entry: AgentPluginRegistryEntry): string {
  return formatPluginMessage(AGENT_PLUGIN_MESSAGES.togglePending, { plugin: entry.name })
}
/** 能不能启用（本仓比 ZCode 严一档：ZCode 侧没有依赖图，见 `agentPlugins.ts:24-28`）。 */
export function agentPluginEnablement(entry: AgentPluginRegistryEntry): { canEnable: boolean; reason: string } {
  const projection = pluginCapabilityProjectionOf(entry)
  return { canEnable: projection.canEnable, reason: projection.blockedReason }
}

export interface AgentPluginComponentDisplayGroup {
  kind: AgentPluginComponentKind
  /** 权威数量：`items.length`（`PluginComponentGroups.tsx:16-18`、`pluginManagedResourceGroups.ts:43`）。 */
  count: number
  items: AgentPluginComponentItem[]
  label: string
}

/** 组件分组：固定顺序、省略空组（`pluginManagedResourceGroups.ts:63-81`）。 */
export function agentPluginComponentGroups(entry: AgentPluginRegistryEntry): AgentPluginComponentDisplayGroup[] {
  const byKind = new Map<AgentPluginComponentKind, AgentPluginComponentDisplayGroup>()
  for (const group of entry.components ?? []) {
    if (group.items.length === 0) continue
    byKind.set(group.kind, {
      kind: group.kind,
      count: group.items.length,
      items: group.items.map((item) => (item.description ? { name: item.name, description: item.description } : { name: item.name })),
      label: AGENT_PLUGIN_COMPONENT_LABELS[group.kind],
    })
  }
  return AGENT_PLUGIN_COMPONENT_ORDER.map((kind) => byKind.get(kind)).filter((group): group is AgentPluginComponentDisplayGroup => group !== undefined)
}
/** 组件项计数文案（`PluginComponentGroups.tsx:63-67`）。 */
export function agentPluginComponentCountLabel(count: number): string {
  return formatPluginMessage(AGENT_PLUGIN_MESSAGES.detailItems, { count: String(count) })
}
/** 组件空态（`zh-CN.ts:3862-3863`）：停用的插件提示先启用。 */
export function agentPluginComponentsEmptyHint(enabled: boolean): string {
  return enabled ? AGENT_PLUGIN_MESSAGES.componentsEmpty : AGENT_PLUGIN_MESSAGES.componentsWhenEnabled
}
/** 一条 hook 的命令行（`InstalledPluginManagement.tsx:141-144`）。 */
export function agentPluginHookCommand(hook: AgentPluginHookDetail): string {
  return !hook.args || hook.args.length === 0 ? hook.command : `${hook.command} ${hook.args.join(' ')}`
}
/** hook 的 matcher 显示（`InstalledPluginManagement.tsx:54-58`：缺省显示「默认 matcher」）。 */
export function agentPluginHookMatcher(hook: AgentPluginHookDetail): string {
  return hook.matcher ?? AGENT_PLUGIN_MESSAGES.hookDefaultMatcher
}
/** hook 能不能运行（`InstalledPluginManagement.tsx:60-68`）。 */
export function agentPluginHookRunnableLabel(hook: AgentPluginHookDetail): string {
  return hook.runnable ? AGENT_PLUGIN_MESSAGES.hookRunnable : AGENT_PLUGIN_MESSAGES.hookDiagnosticOnly
}
/** shell 字段显示（`InstalledPluginManagement.tsx:101-107`）。 */
export function agentPluginHookShell(hook: AgentPluginHookDetail): string {
  return hook.shell === true ? 'true' : String(hook.shell ?? '')
}
/** 组件分组的形状守卫（`zcodePluginComponentGroupSchema`，`index.ts:2527-2532`）。 */
export function isAgentPluginComponentGroup(value: unknown): boolean {
  if (!isRecord(value)) return false
  return (AGENT_PLUGIN_COMPONENT_KINDS as readonly string[]).includes(String(value.kind)) && Array.isArray(value.items)
}

// ── 启停 / 恢复 / 卸载 ────────────────────────────────────────────────────────

export type AgentPluginRegistryChangeReason = 'ok' | 'unknown-plugin' | 'unchanged' | 'dependency-missing' | 'not-materialized'

export interface AgentPluginRegistryChange {
  settings: AgentPluginRegistrySettings
  applied: boolean
  reason: AgentPluginRegistryChangeReason
  message: string
}

function change(settings: AgentPluginRegistrySettings, applied: boolean, reason: AgentPluginRegistryChangeReason, message: string): AgentPluginRegistryChange {
  return { settings, applied, reason, message }
}

/**
 * 拨一条插件的启用开关，**带作用域**。闸门与状态迁移复用只读面的 `applyPluginEnabledChange`
 * （`agentPlugins.ts:478-517`）；本函数只加两件：`enabledSource` 写成当前作用域
 * （`pluginManagementStoreEnabled.ts:64` 的乐观投影就这么写）；提示语按作用域分流
 * （`PluginsSection.tsx:334-342`）。
 */
export function setAgentPluginEnabled(
  settings: AgentPluginRegistrySettings,
  pluginId: string,
  enabled: boolean,
  scope: AgentPluginScope = 'user',
): AgentPluginRegistryChange {
  const base = settings ?? defaultAgentPluginRegistry()
  const target = (base.entries ?? []).find((entry) => entry.id === pluginId)
  if (!target) return change(base, false, 'unknown-plugin', formatPluginMessage(AGENT_PLUGIN_MESSAGES.toggleFailed, { plugin: pluginId }))
  // missing 的投影在设置页连菜单都不渲染（`PluginsSection.tsx:544`），启用态与它矛盾
  // （`agentPlugins.ts:358-360` 同判词）。先短路这一档，别让它落到「依赖没满足」的泛化分支上。
  if (enabled && target.packageStatus === 'missing') {
    return change(base, false, 'not-materialized', `插件「${target.name}」在本机尚未物化（packageStatus=missing），不能启用。`)
  }
  const result = applyPluginEnabledChange(base.entries, pluginId, enabled, agentPluginEnablement(target).canEnable)
  if (!result.applied) {
    const reason: AgentPluginRegistryChangeReason =
      result.reason === 'dependency-missing' ? 'dependency-missing'
      : result.reason === 'not-materialized' ? 'not-materialized'
      : result.reason === 'unchanged' ? 'unchanged'
      : 'unknown-plugin'
    return change(base, false, reason, result.message)
  }
  const entries = result.entries.map((entry) => (entry.id === pluginId ? { ...entry, enabledSource: scope } : entry))
  const template =
    scope === 'workspace'
      ? enabled ? AGENT_PLUGIN_MESSAGES.toggleWorkspaceEnabled : AGENT_PLUGIN_MESSAGES.toggleWorkspaceDisabled
      : enabled ? AGENT_PLUGIN_MESSAGES.toggleEnabled : AGENT_PLUGIN_MESSAGES.toggleDisabled
  return change({ ...base, entries }, true, 'ok', formatPluginMessage(template, { plugin: target.name }))
}

/** 清掉当前 Workspace 的显式配置，回退 User 默认（`PluginsSection.tsx:352` 的 `resetPluginConfig(..., "workspace")`；菜单只在 `:569` 出现；成功提示 `:361`）。抹掉 `enabledSource` 与 `optionSources` 里的 workspace 显式值。 */
export function resetAgentPluginWorkspaceOverride(settings: AgentPluginRegistrySettings, pluginId: string): AgentPluginRegistryChange {
  const base = settings ?? defaultAgentPluginRegistry()
  const target = (base.entries ?? []).find((entry) => entry.id === pluginId)
  if (!target) return change(base, false, 'unknown-plugin', formatPluginMessage(AGENT_PLUGIN_MESSAGES.toggleFailed, { plugin: pluginId }))
  const hasWorkspaceOption = Object.values(target.optionSources ?? {}).some((scope) => scope === 'workspace')
  if (target.enabledSource !== 'workspace' && !hasWorkspaceOption) {
    return change(base, false, 'unchanged', formatPluginMessage(AGENT_PLUGIN_MESSAGES.toggleFailed, { plugin: target.name }))
  }
  const entries = base.entries.map((entry) => {
    if (entry.id !== pluginId) return entry
    const next: AgentPluginRegistryEntry = { ...entry }
    delete next.enabledSource
    if (entry.optionSources) {
      const optionSources: Record<string, AgentPluginScope> = {}
      for (const [key, scope] of Object.entries(entry.optionSources)) if (scope !== 'workspace') optionSources[key] = scope
      if (Object.keys(optionSources).length > 0) next.optionSources = optionSources
      else delete next.optionSources
    }
    return next
  })
  return change({ ...base, entries }, true, 'ok', formatPluginMessage(AGENT_PLUGIN_MESSAGES.scopeRestored, { plugin: target.name }))
}
/** 恢复 User 默认菜单项该不该出现（`PluginsSection.tsx:569`）。 */
export function canResetAgentPluginWorkspaceOverride(entry: AgentPluginRegistryEntry, configScope: AgentPluginScope): boolean {
  return configScope === 'workspace' && entry.enabledSource === 'workspace'
}

/** 卸载确认的状态（ZCode 侧就是 `useState<string | null>`，`usePluginUninstall.ts:35`）。 */
export interface AgentPluginUninstallState {
  pendingPluginId: string | null
}
export function defaultAgentPluginUninstallState(): AgentPluginUninstallState {
  return { pendingPluginId: null }
}
/** 发起卸载（`usePluginUninstall.ts:48-50` 的 `requestUninstall`）。 */
export function requestAgentPluginUninstall(state: AgentPluginUninstallState, pluginId: string): AgentPluginUninstallState {
  const id = text(pluginId)
  return id ? { pendingPluginId: id } : state
}
/** 取消（`usePluginUninstall.ts:52-54`；弹窗关闭也走它，`PluginUninstallConfirmDialog.tsx:32-34`）。 */
export function cancelAgentPluginUninstall(state: AgentPluginUninstallState): AgentPluginUninstallState {
  return state?.pendingPluginId ? { pendingPluginId: null } : state
}
/**
 * 卸载进行中 = `operationId === "plugin:uninstall:" + pendingId`（`usePluginUninstall.ts:46`）。
 * 进行中时确认/取消两个按钮都禁用（`PluginUninstallConfirmDialog.tsx:53,62`）。
 */
export function isAgentPluginUninstalling(state: AgentPluginUninstallState, operationId: string | null): boolean {
  const id = state?.pendingPluginId
  return Boolean(id) && operationId === pluginOperationId('uninstall', id!)
}
/**
 * 确认卸载：返回要卸的 id 与卸载后的状态。
 * 照 `usePluginUninstall.ts:56-61`：没有 pending 就什么都不做；做完清 pending
 * （卸载是异步的，弹窗等结果才收起 —— `PluginUninstallConfirmDialog.tsx:64-66` 的 `preventDefault`）。
 */
export function confirmAgentPluginUninstall(
  state: AgentPluginUninstallState,
  operationId: string | null = null,
): { pluginId: string | null; state: AgentPluginUninstallState; blocked: boolean } {
  const pluginId = state?.pendingPluginId ?? null
  if (!pluginId) return { pluginId: null, state: defaultAgentPluginUninstallState(), blocked: false }
  return { pluginId, state: defaultAgentPluginUninstallState(), blocked: isAgentPluginUninstalling(state, operationId) }
}
/** 待确认的那条插件：先查安装记录，再回落到运行时清单（`usePluginUninstall.ts:37-44` 的顺序）。 */
export function agentPluginUninstallTarget(state: AgentPluginUninstallState, entries: readonly AgentPluginRegistryEntry[]): AgentPluginRegistryEntry | null {
  const id = state?.pendingPluginId
  return id ? (entries.find((entry) => entry.id === id) ?? null) : null
}
/** 弹窗文案（`PluginUninstallConfirmDialog.tsx:38-70`）。 */
export function agentPluginUninstallPrompt(pluginName: string): { title: string; description: string; confirm: string; cancel: string } {
  return {
    title: formatPluginMessage(AGENT_PLUGIN_MESSAGES.uninstallConfirmTitle, { name: pluginName }),
    description: AGENT_PLUGIN_MESSAGES.uninstallConfirmDescription,
    confirm: AGENT_PLUGIN_MESSAGES.uninstallConfirm,
    cancel: AGENT_PLUGIN_MESSAGES.cancel,
  }
}
/**
 * 一条插件能不能发起卸载。行内菜单在 `packageStatus === "missing"` 时整个不渲染
 * （`PluginsSection.tsx:544`）；商店卡片只在 `item.installed` 时给卸载项（`PluginStoreCard.tsx:168`）。
 */
export function canRequestAgentPluginUninstall(entry: AgentPluginRegistryEntry, options: { installed?: boolean } = {}): boolean {
  if (entry.packageStatus === 'missing') return false
  return options.installed !== false
}
/** 卸载成功后把条目从注册表摘掉（缓存/配置的清除在宿主侧，不在纯逻辑层）。 */
export function removeAgentPluginEntry(settings: AgentPluginRegistrySettings, pluginId: string): AgentPluginRegistrySettings {
  const base = settings ?? defaultAgentPluginRegistry()
  return {
    ...base,
    entries: (base.entries ?? []).filter((entry) => entry.id !== pluginId),
    builtInPluginIds: (base.builtInPluginIds ?? []).filter((id) => id !== pluginId),
  }
}

// ── 操作 id 与进行中判定 ─────────────────────────────────────────────────────

export type AgentPluginOperationKind =
  | 'install' | 'restore' | 'uninstall' | 'update' | 'resetConfig' | 'configure'
  | 'marketplaceAdd' | 'marketplaceUpdate' | 'marketplaceRemove' | 'marketplaceValidate'

/** 操作 id 的构造口径，逐条取自 ZCode（见各分支尾注）。 */
export function pluginOperationId(kind: AgentPluginOperationKind, target: string, marketplace = ''): string {
  switch (kind) {
    case 'install': return `plugin:install:${target}@${marketplace}` // PluginStoreCard.tsx:45
    case 'restore': return `plugin:restore:${target}` // PluginStoreCard.tsx:46
    case 'uninstall': return `plugin:uninstall:${target}` // PluginStoreCard.tsx:47
    case 'update': return `plugin:update:${target}` // PluginStoreCard.tsx:48
    case 'resetConfig': return `plugin:reset-config:${target}` // PluginStoreCard.tsx:49
    case 'configure': return `plugin:configure:${target}` // PluginConfigControls.tsx:40
    case 'marketplaceAdd': return `marketplace:add:${target}` // AddMarketplaceSourceDialog.tsx:35 / pluginManagementStore.ts:193
    case 'marketplaceUpdate': return `marketplace:update:${target || '__all__'}` // pluginManagementStore.ts:209
    case 'marketplaceRemove': return `marketplace:remove:${target}` // PluginStoreSourcesDialog.tsx:75
    default: return `marketplace:validate:${target}` // pluginManagementStore.ts:353
  }
}

/**
 * 条目是否在忙（`PluginStoreCard.tsx:43-52` 的 `isItemBusy`）：
 * 五种操作 id 命中该条目，或它的启停开关正在 pending。
 */
export function isAgentPluginItemBusy(
  item: { id: string; name: string; marketplace: string },
  operationId: string | null,
  togglingPluginId: string | null = null,
): boolean {
  if (!operationId) return togglingPluginId === item.id
  return (
    operationId === pluginOperationId('install', item.name, item.marketplace) ||
    operationId === pluginOperationId('restore', item.id) ||
    operationId === pluginOperationId('uninstall', item.id) ||
    operationId === pluginOperationId('update', item.id) ||
    operationId === pluginOperationId('resetConfig', item.id) ||
    togglingPluginId === item.id
  )
}

/**
 * 商店菜单里分隔线该不该出现（`PluginStoreCard.tsx:104-108`）。
 * `canToggleEnabled` = 有运行时 info 且宿主提供了 `onSetEnabled`（`:104`）。
 */
export function agentPluginMenuHasActionsBeforeUninstall(input: { canToggleEnabled: boolean; updatePending: boolean; hasResetConfig: boolean }): boolean {
  return Boolean(input?.canToggleEnabled) || Boolean(input?.updatePending) || Boolean(input?.hasResetConfig)
}

// ── 市场来源（形状 + 增删 + 排序）────────────────────────────────────────────

/** 公开分段（只有一个官方市场 id，`plugin-marketplaces.ts:45` + `:47-48`）。 */
export function isAgentPluginPublicMarketplace(id: string): boolean {
  return id === ZCODE_OFFICIAL_PLUGIN_MARKETPLACE_ID
}
/** 官方源不可移除（`PluginStoreSourcesDialog.tsx:12-15`：移除后启动会被重新补种）。 */
export function isAgentPluginMarketplaceRemovable(id: string): boolean {
  return !isAgentPluginPublicMarketplace(id)
}
/**
 * 市场源排序（`pluginStoreListing.ts:163-183`）：官方固定置顶；其余按最近刷新倒序，
 * 未刷新过的沉底；同刻用本地化名称稳定兜底。
 */
export function sortAgentPluginMarketplaceSources(
  marketplaces: readonly AgentPluginMarketplaceSource[],
  locale = 'zh-CN',
): AgentPluginMarketplaceSource[] {
  return [...marketplaces].sort((left, right) => {
    const leftOfficial = isAgentPluginPublicMarketplace(left.id)
    const rightOfficial = isAgentPluginPublicMarketplace(right.id)
    if (leftOfficial !== rightOfficial) return leftOfficial ? -1 : 1
    const leftAt = left.lastUpdated ?? ''
    const rightAt = right.lastUpdated ?? ''
    if (leftAt !== rightAt) return rightAt.localeCompare(leftAt)
    const byName = left.name.localeCompare(right.name, locale)
    return byName !== 0 ? byName : left.id.localeCompare(right.id, locale)
  })
}
/**
 * 归一化一个用户输入的市场来源串。ZCode 侧只做 `trim()`，空串时禁用提交按钮
 * （`AddMarketplaceSourceDialog.tsx:34,165`）—— **不在这里发明 URL 格式校验**
 * （github / git / URL / 本地目录四种都合法，`:12-13`）。
 */
export function normalizeAgentPluginMarketplaceSourceInput(value: unknown): string | null {
  return text(value) || null
}
/**
 * 添加一个市场源。id 用来源串本身（ZCode 的 `addPluginMarketplace` 只发 `source` 一个字段，
 * `pluginManagementStore.ts:188-199`；返回的概览带服务端 id，本仓离线时先用来源串当键）。
 * 已登记同一来源时原样返回，不产生重复行。
 */
export function addAgentPluginMarketplaceSource(
  settings: AgentPluginRegistrySettings,
  source: string,
): { settings: AgentPluginRegistrySettings; added: boolean; operationId: string | null } {
  const base = settings ?? defaultAgentPluginRegistry()
  const normalized = normalizeAgentPluginMarketplaceSourceInput(source)
  if (!normalized) return { settings: base, added: false, operationId: null }
  const operationId = pluginOperationId('marketplaceAdd', normalized)
  if (base.marketplaces.some((market) => market.id === normalized)) return { settings: base, added: false, operationId }
  const market: AgentPluginMarketplaceSource = { id: normalized, name: normalized, source: { kind: 'user', value: normalized }, pluginCount: 0 }
  return { settings: { ...base, marketplaces: [...base.marketplaces, market] }, added: true, operationId }
}
/** 移除一个市场源；官方源拒绝移除（`PluginStoreSourcesDialog.tsx:122-142`）。 */
export function removeAgentPluginMarketplaceSource(
  settings: AgentPluginRegistrySettings,
  marketplaceId: string,
): { settings: AgentPluginRegistrySettings; removed: boolean; operationId: string | null } {
  const base = settings ?? defaultAgentPluginRegistry()
  const id = text(marketplaceId)
  if (!id) return { settings: base, removed: false, operationId: null }
  const operationId = pluginOperationId('marketplaceRemove', id)
  if (!isAgentPluginMarketplaceRemovable(id)) return { settings: base, removed: false, operationId }
  const marketplaces = base.marketplaces.filter((market) => market.id !== id)
  return { settings: { ...base, marketplaces }, removed: marketplaces.length !== base.marketplaces.length, operationId }
}
/**
 * 刷新操作 id：单个源 → `marketplace:update:<id>`，全部 → `marketplace:update:__all__`
 * （`pluginManagementStore.ts:209`；顶栏刷新传 null，`PluginStorePage.tsx:306`）。
 */
export function agentPluginMarketplaceUpdateOperationId(marketplaceId?: string | null): string {
  return pluginOperationId('marketplaceUpdate', text(marketplaceId))
}
/** 时间显示（`PluginStoreSourcesDialog.tsx:153-157`：非法时间原样返回）。 */
export function formatPluginSourceTime(value: string): string {
  const time = new Date(value)
  return Number.isNaN(time.getTime()) ? value : time.toLocaleString()
}
/** 市场源一行的文案（`PluginStoreSourcesDialog.tsx:73-146`）。 */
export function agentPluginMarketplaceRow(
  market: AgentPluginMarketplaceSource,
  marketplaces: readonly AgentPluginMarketplaceSource[] = [],
): { id: string; name: string; pluginCountLabel: string; lastUpdatedLabel: string; refreshFailureLabel: string; removable: boolean; updateLabel: string; removeLabel: string } {
  return {
    id: market.id,
    name: resolveMarketplaceDisplayName(market.id, marketplaces),
    pluginCountLabel: formatPluginMessage(AGENT_PLUGIN_MESSAGES.sourcesPluginCount, { count: String(market.pluginCount) }),
    lastUpdatedLabel: market.lastUpdated
      ? formatPluginMessage(AGENT_PLUGIN_MESSAGES.sourcesLastUpdated, { time: formatPluginSourceTime(market.lastUpdated) })
      : '',
    refreshFailureLabel: market.refreshFailure
      ? `${formatPluginMessage(AGENT_PLUGIN_MESSAGES.sourcesRefreshFailed, { time: formatPluginSourceTime(market.refreshFailure.failedAt) })}: ${market.refreshFailure.message}`
      : '',
    removable: isAgentPluginMarketplaceRemovable(market.id),
    updateLabel: AGENT_PLUGIN_MESSAGES.sourcesUpdate,
    removeLabel: AGENT_PLUGIN_MESSAGES.sourcesRemove,
  }
}

// ── 作用域菜单 ───────────────────────────────────────────────────────────────

/** 一个可选作用域槽位（`PluginScopeMenu.tsx:62-68`）。 */
export interface AgentPluginScopeOption {
  key: string
  label: string
  remote: boolean
}
export interface AgentPluginWorkspaceTab {
  workspacePath: string
  workspaceIdentity?: string | null
  remoteTarget?: unknown
  remoteSessionId?: string
  availability?: string
  label?: string
}
/** workspace key = `workspaceIdentity?.trim() || workspacePath`（`PluginScopeMenu.tsx:17-19` → `lib/workspaceKey.ts:5-7`）。 */
export function agentPluginWorkspaceKey(tab: AgentPluginWorkspaceTab): string {
  return tab?.workspaceIdentity?.trim() || tab?.workspacePath || ''
}
/**
 * 断连/失效的 workspace 不进作用域菜单（`PluginScopeMenu.tsx:21-34`）：
 * 本地目录已失效 → 不可用；远端必须有当前 session。
 */
export function isAgentPluginScopeWorkspaceConnected(tab: AgentPluginWorkspaceTab): boolean {
  if (tab?.availability === 'unavailable-local-directory') return false
  const isRemote = Boolean(tab?.workspaceIdentity?.trim() || tab?.remoteTarget || tab?.remoteSessionId)
  if (!isRemote) return true
  return Boolean(tab?.remoteSessionId)
}
/** 菜单里的 workspace 选项（去重、过滤断连；`PluginsSection.tsx:968-997` 同口径）。 */
export function selectAgentPluginScopeOptions(tabs: readonly AgentPluginWorkspaceTab[]): AgentPluginScopeOption[] {
  const seen = new Set<string>()
  const options: AgentPluginScopeOption[] = []
  for (const tab of tabs ?? []) {
    if (!isAgentPluginScopeWorkspaceConnected(tab)) continue
    const key = agentPluginWorkspaceKey(tab)
    if (!key || seen.has(key)) continue
    seen.add(key)
    options.push({ key, label: text(tab.label) || key, remote: Boolean(tab.remoteTarget || tab.remoteSessionId) })
  }
  return options
}
/** 作用域菜单的固定项（`PluginScopeMenu.tsx:71-72`、`:100-138`）。 */
export const AGENT_PLUGIN_SCOPE_MENU_LABELS = { user: AGENT_PLUGIN_MESSAGES.scopeUser, workspaces: AGENT_PLUGIN_MESSAGES.scopeWorkspaces } as const
/**
 * 选中的作用域 key 落回哪个槽位。目标 workspace 已关闭或断连时**显式回退到 user 并提示**
 * （`PluginsSection.tsx:1091-1105`：静默回退会让用户误以为 Workspace 配置仍在展示）。
 */
export function resolveAgentPluginScopeSelection(
  pickedScopeKey: string,
  options: readonly AgentPluginScopeOption[],
): { key: string; scope: AgentPluginScope; fallbackMessage: string } {
  const key = text(pickedScopeKey) || 'user'
  if (key === 'user') return { key: 'user', scope: 'user', fallbackMessage: '' }
  if (options.some((option) => option.key === key)) return { key, scope: 'workspace', fallbackMessage: '' }
  return { key: 'user', scope: 'user', fallbackMessage: AGENT_PLUGIN_MESSAGES.scopeUnavailableFallback }
}
/** 生效的 scope 值（`PluginsSection.tsx:1288`：非 user 即 workspace）。 */
export function agentPluginConfigScope(scope: AgentPluginScope): AgentPluginScope {
  return scope === 'user' ? 'user' : 'workspace'
}
/** 作用域常量（`index.ts:2485-2486`）与组件类型常量（`index.ts:2517`）—— 断言用。 */
export const AGENT_PLUGIN_REGISTRY_SCOPES = AGENT_PLUGIN_SCOPES
export const AGENT_PLUGIN_REGISTRY_COMPONENT_KINDS = AGENT_PLUGIN_COMPONENT_KINDS