// 「插件」节（ZCode section id `plugin`，图标 Blocks）的**纯逻辑层** —— 2026-10-07。
//
// 为什么单独一个文件：这一节在 ZCode 那边是**四个 Tab 合一**（插件 / MCP / 技能 / 命令，
// `zh-CN.ts:3698-3701`），背后还有 marketplace、scope 菜单、组件详情、启停确认四条支线。
// 塞进 `src/pluginGroups.ts` 会让那份「IDEA 对照的分组/搜索规则」背上本机状态；
// 塞进 `src/agentSettings.ts` 又会让设置面假装自己拥有插件运行时。本模块只放**规则**：
// 能力投影、来源标签、启停闸门、覆盖层持久化。判定全在这里，组件只负责渲染。
//
// 字段与 ZCode 出处（逐条，便于对账）：
//   · `id` / `name`      必填非空串 —— `zcode-protocol/index.ts:2537-2538`
//   · `description` / `version` 可选 —— `index.ts:2539, 2540`
//   · `enabled`          布尔，权威 —— `index.ts:2541`
//   · `source`           非空串；`official` = 官方内置那一族 —— `index.ts:2542` + `pluginCapabilityProjection.ts:24`
//   · `marketplace`      非空串 —— `index.ts:2543`；展示名由 `pluginSourceLabel.ts:8-14` 解析
//   · `components`       **权威组件清单**（名称 + 可选描述），与启用态无关 —— `index.ts:2551-2553`
//   · `mcpServerNames`   必填数组 —— `index.ts:2556`
//   · `rootPath`         必填 —— `index.ts:2558`
//   · `packageStatus`    缺省 = 可用；`missing` = 已声明但目标 Host 尚未物化 —— `index.ts:2561-2562`
//   · `rootSource` / `enabledSource` / `optionSources` 作用域 —— `index.ts:2563-2565`
//
// **本仓独有的那一半（ZCode 没有对应物，如实标注）**：
//   `vendor` / `category` / `changeNotes` 与整块依赖面（`depends` / `optionalDepends` /
//   `missingDependencies` / `disabledDependencies` / `requiredBy` / `dependencyCycle` / `broken`）
//   来自本仓 `src/pluginGroups.ts:57-87`（`PluginInfo`，清单 `plugin.json` 由 `native/plugins.cpp` 读）。
//   ZCode 的插件启停**没有依赖图**（`pluginEnabledChange.ts` 全文只做「RPC 成功才继续」），
//   所以 `applyPluginEnabledChange` 的 `available` 闸门是**本仓加的更严一档**：
//   依赖没满足时直接拒绝启用，而不是让用户在运行期撞上加载失败。依据见 `src/pluginGroups.ts:82-87`
//   （必需依赖成环 → 上游判为不可加载，`PluginManagerStateService.kt:175-202`）。
import {
  defaultSettingsStorage,
  readSettingsJson,
  writeSettingsJson,
  type SettingsStorage,
} from './agentSettingsStore.ts'

/** 存储键。与 `src/agentSettings.ts` 同一族（localStorage）。 */
export const AGENT_PLUGINS_STORAGE_KEY = 'taocode.agent.plugins.settings'

/** 节 id 与图标对应的设置页锚点（`settingsPageConfig.ts:88-93`：id `plugin` / icon `Blocks`）。 */
export const AGENT_PLUGINS_SECTION_ID = 'plugin'

/** 节标题（ZCode `zh-CN.ts:3695` `"settings.plugins.title": "插件"`）。 */
export const AGENT_PLUGINS_TITLE = '插件'

/** 四个 Tab（ZCode `zh-CN.ts:3698-3701`）。 */
export const AGENT_PLUGIN_TABS = ['plugins', 'mcps', 'skills', 'commands'] as const
export type AgentPluginTab = (typeof AGENT_PLUGIN_TABS)[number]

/** 组件类型与展示顺序（ZCode `zcode-protocol/index.ts:2515-2518`、`pluginManagedResourceGroups.ts:22-28`）。 */
export const AGENT_PLUGIN_COMPONENT_KINDS = ['agent', 'command', 'skill', 'hook', 'mcp'] as const
export type AgentPluginComponentKind = (typeof AGENT_PLUGIN_COMPONENT_KINDS)[number]

/** 组件类型的中文标签（ZCode `zh-CN.ts:3864-3868`）。 */
export const AGENT_PLUGIN_COMPONENT_LABELS: Record<AgentPluginComponentKind, string> = {
  agent: 'Agents',
  command: '命令',
  skill: '技能',
  hook: 'Hooks',
  mcp: 'MCP 服务器',
}

/** 两个分组标题（ZCode `zh-CN.ts:3703-3704`；分组规则 `pluginCapabilityProjection.ts:36-47`）。 */
export const AGENT_PLUGIN_GROUP_LABELS = { installed: '已安装', builtIn: '内置' } as const
export type AgentPluginGroup = keyof typeof AGENT_PLUGIN_GROUP_LABELS

/** 两个作用域（ZCode `zcode-protocol/index.ts:2485-2486`；菜单 `PluginScopeMenu.tsx:71-72`）。 */
export const AGENT_PLUGIN_SCOPES = ['user', 'workspace'] as const
export type AgentPluginScope = (typeof AGENT_PLUGIN_SCOPES)[number]

/** 作用域标签（ZCode `zh-CN.ts:3696-3697`）。 */
export const AGENT_PLUGIN_SCOPE_LABELS: Record<AgentPluginScope, string> = { user: '用户', workspace: '工作区' }

/** ZCode 官方 marketplace id（`shared/src/plugin-marketplaces.ts:10`）。 */
export const ZCODE_OFFICIAL_PLUGIN_MARKETPLACE_ID = 'zcode-plugins-official'

/**
 * 官方文档类插件的置顶顺序（ZCode `shared/src/pluginStoreOrdering.ts:14-24`）。
 * 未命中的 id 排到 `order.size` 之后（`compareRanks`，`:76-79`），所以这四张卡在「内置」组里靠前。
 */
export const ZCODE_DOCUMENT_PLUGIN_ORDER = ['pdf', 'presentations', 'spreadsheets', 'documents'] as const

const DOCUMENT_PLUGIN_RANKS = new Map(
  ZCODE_DOCUMENT_PLUGIN_ORDER.map((name, index) => [`${name}@${ZCODE_OFFICIAL_PLUGIN_MARKETPLACE_ID}`, index]),
)

/** ZCode 内置浏览器控制的官方插件 id（`BrowserSettingsSection.tsx:30`）—— 供「浏览器控制」节判定用。 */
export const ZCODE_BROWSER_USE_PLUGIN_ID = 'browser-use@zcode-plugins-official'

// ---- 形状 --------------------------------------------------------------------

export interface AgentPluginComponentItem {
  name: string
  /** 描述缺失时省略，不伪造（ZCode `index.ts:2523-2524` 的注释就是这么要求的）。 */
  description?: string
}

export interface AgentPluginComponentGroup {
  kind: AgentPluginComponentKind
  items: AgentPluginComponentItem[]
}

/** 一个 marketplace 概览（`pluginSourceLabel.ts:8-14` 的入参 `ZCodePluginMarketplaceSummary` 的两格）。 */
export interface AgentPluginMarketplace {
  id: string
  name: string
}

/**
 * 一条插件条目 = 设置页消费的那份投影。
 *
 * 前半段是 ZCode `ZCodePluginInfo` 的逐字平移，后半段是本仓 `PluginInfo` 独有的依赖面
 * （见文件头）。宿主手上那份更宽的 `PluginInfo` 由上层负责裁剪成本形状。
 */
export interface AgentPluginEntry {
  id: string
  name: string
  description?: string
  version?: string
  enabled: boolean
  /** `official` = 官方内置那一族（`pluginCapabilityProjection.ts:24` 的判据）。 */
  source: string
  marketplace: string
  components?: AgentPluginComponentGroup[]
  mcpServerNames: string[]
  rootPath: string
  packageStatus?: 'missing'
  rootSource?: AgentPluginScope
  enabledSource?: AgentPluginScope
  // —— 以下为本仓 `src/pluginGroups.ts:57-87` 独有，ZCode 无对应字段 ——
  vendor?: string
  category?: string
  changeNotes?: string
  depends?: string[]
  optionalDepends?: string[]
  missingDependencies?: string[]
  disabledDependencies?: string[]
  requiredBy?: string[]
  dependencyCycle?: string[]
  /** 依赖不满足时的一句话原因；非空即不可启用、也不加载。 */
  broken?: string
}

/** 插件节的持久化面：条目 + 分组/来源/作用域的辅助表 + UI 偏好。 */
export interface AgentPluginsSettings {
  entries: AgentPluginEntry[]
  /** 划入「内置」组的插件 id（ZCode `partitionPluginsForSettings` 的第二入参，`:36-47`）。 */
  builtInPluginIds: string[]
  /** marketplace 概览（`pluginSourceLabel.ts:8-14`）。 */
  marketplaces: AgentPluginMarketplace[]
  /** 四个 Tab 里当前那一个（`zh-CN.ts:3698-3701`）。 */
  tab: AgentPluginTab
  /** 作用域（`index.ts:2485-2486`）。 */
  scope: AgentPluginScope
  /** 作用域选择器当前选中的 key（`PluginScopeMenu.tsx:17-19` 的 `workspaceKey`，或 user 槽位）。 */
  scopeKey: string
  /** 搜索词（`zh-CN.ts:3709` `"搜索插件…"`）。 */
  query: string
}

/** 出厂默认：空清单 + 空辅助表 + 第一个 Tab + 用户作用域。 */
export function defaultAgentPluginsSettings(): AgentPluginsSettings {
  return {
    entries: [],
    builtInPluginIds: [],
    marketplaces: [],
    tab: 'plugins',
    scope: 'user',
    scopeKey: 'user',
    query: '',
  }
}

// ---- 能力投影 ---------------------------------------------------------------

export interface AgentPluginDisplayGroup {
  kind: AgentPluginComponentKind
  /** 权威数量：取 items.length（`PluginComponentGroups.tsx:16-18`；`pluginManagedResourceGroups.ts:43`）。 */
  count: number
  items: AgentPluginComponentItem[]
  /** 组件类型标签（`PluginComponentGroups.tsx:29-35` 的 `COMPONENT_LABEL_IDS` 对应中文）。 */
  label: string
}

export interface AgentPluginCapability {
  /** ZCode 只展示**已物化**的插件：`packageStatus === 'missing'` 的投影不进分组
   *  （`pluginCapabilityProjection.ts:32-47`，注释写明否则会出现「已安装分组 + 未安装状态」的矛盾行）。 */
  materialized: boolean
  /** 落在哪一组（`pluginCapabilityProjection.ts:42-46`）。 */
  group: AgentPluginGroup
  groupLabel: string
  /** 官方文档卡的置顶序（`pluginStoreOrdering.ts:14-24`）；未命中 = 该长度。 */
  documentRank: number
  /** 组件展示分组：固定顺序、省略空组、数量 = items.length（`pluginManagedResourceGroups.ts:63-81`）。 */
  componentGroups: AgentPluginDisplayGroup[]
  /** 组件总数（页脚能力摘要的分子，ZCode `zh-CN.ts:3798`）。 */
  componentCount: number
  /** 组件为空时显示什么（`zh-CN.ts:3862-3863`：停用插件 → 「启用插件后查看其组件。」）。 */
  componentEmptyHint: string
  /** 依赖是否满足。**不满足时禁止启用**（本仓加严，依据见文件头）。 */
  dependencySatisfied: boolean
  /** 不可启用的原因（`pluginGroups.ts:87` 的 `broken`；或依赖面推出来的一句话）。 */
  blockedReason: string
  /** 能不能拨启用开关：物化 + 依赖满足。 */
  canEnable: boolean
  /** 来源标签（`pluginSourceLabelOf` 的结果，模板直接渲染）。 */
  sourceLabel: string
}

function normalizeStringList(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined
  const list = value.filter((item): item is string => typeof item === 'string').map((item) => item.trim()).filter(Boolean)
  return list.length > 0 ? list : undefined
}

function normalizeComponentGroups(value: unknown): AgentPluginComponentGroup[] | undefined {
  if (!Array.isArray(value)) return undefined
  const groups: AgentPluginComponentGroup[] = []
  for (const group of value) {
    if (!group || typeof group !== 'object') continue
    const groupRaw = group as Record<string, unknown>
    if (!(AGENT_PLUGIN_COMPONENT_KINDS as readonly string[]).includes(String(groupRaw.kind))) continue
    if (!Array.isArray(groupRaw.items)) continue
    const items: AgentPluginComponentItem[] = []
    for (const item of groupRaw.items) {
      if (!item || typeof item !== 'object') continue
      const itemRaw = item as Record<string, unknown>
      const name = typeof itemRaw.name === 'string' ? itemRaw.name.trim() : ''
      if (!name) continue
      const description = typeof itemRaw.description === 'string' ? itemRaw.description : ''
      items.push(description ? { name, description } : { name })
    }
    if (items.length === 0) continue
    groups.push({ kind: groupRaw.kind as AgentPluginComponentKind, items })
  }
  return groups.length > 0 ? groups : undefined
}

/** 单条归一化。id/name 为空即不可救 → 返回 null（调用方丢单条，不丢整表）。 */
function normalizePluginEntry(item: unknown): AgentPluginEntry | null {
  if (!item || typeof item !== 'object') return null
  const raw = item as Record<string, unknown>
  const id = typeof raw.id === 'string' ? raw.id.trim() : ''
  if (!id) return null
  const name = typeof raw.name === 'string' && raw.name.trim() ? raw.name.trim() : id
  const entry: AgentPluginEntry = {
    id,
    name,
    // ZCode 的 enabled 是必填布尔（`index.ts:2541`）；缺键时按**停用**救 ——
    // 默认启用等于替用户做了授权决定，那比默认停用危险得多。
    enabled: raw.enabled === true,
    source: typeof raw.source === 'string' && raw.source.trim() ? raw.source.trim() : 'local',
    marketplace: typeof raw.marketplace === 'string' ? raw.marketplace.trim() : '',
    mcpServerNames: normalizeStringList(raw.mcpServerNames) ?? [],
    rootPath: typeof raw.rootPath === 'string' ? raw.rootPath.trim() : '',
  }
  if (typeof raw.description === 'string') entry.description = raw.description
  if (typeof raw.version === 'string' && raw.version.trim()) entry.version = raw.version.trim()
  const components = normalizeComponentGroups(raw.components)
  if (components) entry.components = components
  if (raw.packageStatus === 'missing') entry.packageStatus = 'missing'
  if (raw.rootSource === 'user' || raw.rootSource === 'workspace') entry.rootSource = raw.rootSource
  if (raw.enabledSource === 'user' || raw.enabledSource === 'workspace') entry.enabledSource = raw.enabledSource
  if (typeof raw.vendor === 'string' && raw.vendor.trim()) entry.vendor = raw.vendor.trim()
  if (typeof raw.category === 'string' && raw.category.trim()) entry.category = raw.category.trim()
  if (typeof raw.changeNotes === 'string' && raw.changeNotes.trim()) entry.changeNotes = raw.changeNotes
  for (const key of ['depends', 'optionalDepends', 'missingDependencies', 'disabledDependencies', 'requiredBy', 'dependencyCycle'] as const) {
    const list = normalizeStringList(raw[key])
    if (list) entry[key] = list
  }
  if (typeof raw.broken === 'string' && raw.broken.trim()) entry.broken = raw.broken.trim()
  return entry
}

/**
 * 把任意输入归一成一份合法设置。**永不抛、永不返回坏值**，逐字段救
 * （本仓铁律：不许按字段数量判损坏 —— `src/agentSettings.ts:132-135`）。
 */
export function normalizeAgentPluginsSettings(input: unknown): AgentPluginsSettings {
  const defaults = defaultAgentPluginsSettings()
  if (!input || typeof input !== 'object') return defaults
  const raw = input as Record<string, unknown>
  const entries: AgentPluginEntry[] = []
  // 同 id 去重：id 是插件主键（`index.ts:2537`），重复行只会让「已启用 n/m」的分母虚高。
  // 与 `src/agentSubagents.ts` 的差别是有意的 —— 那边两条条目是**两个磁盘文件**，
  // 同 id 是真实的文件冲突，必须报给用户；这边只是一个列表里的重复投影，读路径上丢掉就对了。
  const seen = new Set<string>()
  for (const item of Array.isArray(raw.entries) ? raw.entries : []) {
    const entry = normalizePluginEntry(item)
    if (!entry || seen.has(entry.id)) continue
    seen.add(entry.id)
    entries.push(entry)
  }
  const builtInPluginIds: string[] = []
  for (const id of Array.isArray(raw.builtInPluginIds) ? raw.builtInPluginIds : []) {
    if (typeof id !== 'string') continue
    const trimmed = id.trim()
    if (trimmed && !builtInPluginIds.includes(trimmed)) builtInPluginIds.push(trimmed)
  }
  const marketplaces: AgentPluginMarketplace[] = []
  for (const item of Array.isArray(raw.marketplaces) ? raw.marketplaces : []) {
    if (!item || typeof item !== 'object') continue
    const itemRaw = item as Record<string, unknown>
    const id = typeof itemRaw.id === 'string' ? itemRaw.id.trim() : ''
    if (!id) continue
    marketplaces.push({ id, name: typeof itemRaw.name === 'string' && itemRaw.name.trim() ? itemRaw.name.trim() : id })
  }
  const tab = (AGENT_PLUGIN_TABS as readonly string[]).includes(String(raw.tab))
    ? raw.tab as AgentPluginTab
    : defaults.tab
  const scope: AgentPluginScope = raw.scope === 'workspace' ? 'workspace' : defaults.scope
  return {
    entries,
    builtInPluginIds,
    marketplaces,
    tab,
    scope,
    scopeKey: typeof raw.scopeKey === 'string' && raw.scopeKey.trim() ? raw.scopeKey.trim() : defaults.scopeKey,
    query: typeof raw.query === 'string' ? raw.query : defaults.query,
  }
}

// ---- 校验 --------------------------------------------------------------------

function escapesPluginRoot(path: string): boolean {
  return path.split(/[\\/]+/u).some((segment) => segment === '..')
}

/**
 * 保存前的校验。四类硬问题（分工同 `src/agentSettings.ts:214-220`）：
 *   1. 空 id / 空名 —— `zcode-protocol/index.ts:2537-2538` 要求非空串。
 *   2. 重名 —— 两条同 id 就是同一个插件（`index.ts:2537` 是主键）。
 *   3. 路径越界 —— `..` 段会让卸载/写盘打到插件根之外。
 *   4. 依赖缺失 —— 启用了却缺必需依赖的插件运行期必然加载失败，
 *      必须在保存时就说出来（依据 `src/pluginGroups.ts:76-87`）。
 */
export function validateAgentPluginsSettings(settings: AgentPluginsSettings): string[] {
  const problems: string[] = []
  const seen = new Set<string>()
  for (const entry of settings.entries) {
    const id = entry.id.trim()
    if (!id) { problems.push('插件 id 不能为空。'); continue }
    if (!entry.name.trim()) problems.push(`插件「${id}」的名称不能为空。`)
    if (seen.has(id)) problems.push(`插件「${id}」重名：同 id 只能是同一个插件。`)
    seen.add(id)
    if (entry.rootPath.trim() && escapesPluginRoot(entry.rootPath)) {
      problems.push(`插件「${entry.name}」的路径越出插件目录：${entry.rootPath}`)
    }
    if (entry.enabled && !entry.packageStatus) {
      const blockers = [
        ...(entry.dependencyCycle ?? []),
        ...(entry.missingDependencies ?? []),
        ...(entry.disabledDependencies ?? []),
      ]
      if (blockers.length > 0) {
        problems.push(`插件「${entry.name}」已启用但依赖没满足：${[...new Set(blockers)].join('、')}。`)
      }
    }
    if (entry.packageStatus === 'missing' && entry.enabled) {
      problems.push(`插件「${entry.name}」在本机尚未物化（packageStatus=missing），不能处于启用态。`)
    }
  }
  for (const id of settings.builtInPluginIds) {
    if (settings.entries.some((entry) => entry.id === id)) continue
    problems.push(`内置插件「${id}」不在当前清单里，分组会对不上。`)
  }
  return problems
}

// ---- 持久化 ------------------------------------------------------------------

export function loadAgentPluginsSettings(
  storage: SettingsStorage | null = defaultSettingsStorage(),
): AgentPluginsSettings {
  return readSettingsJson(storage, AGENT_PLUGINS_STORAGE_KEY, normalizeAgentPluginsSettings)
}

export function saveAgentPluginsSettings(
  settings: AgentPluginsSettings,
  storage: SettingsStorage | null = defaultSettingsStorage(),
): boolean {
  return writeSettingsJson(storage, AGENT_PLUGINS_STORAGE_KEY, settings)
}

// ---- 能力投影与来源标签 ------------------------------------------------------

/**
 * marketplace id → 展示名（ZCode `pluginSourceLabel.ts:8-14`）：优先用概览里的 name，
 * 缺失时**回落到原始 id**（那句 `?? marketplaceId` 就是回落，不许编一个名字）。
 */
export function resolveMarketplaceDisplayName(
  marketplaceId: string,
  marketplaces: readonly AgentPluginMarketplace[],
): string {
  const matched = marketplaces.find((marketplace) => marketplace.id === marketplaceId)
  return matched?.name ?? marketplaceId
}

/**
 * 来源标签（ZCode `zh-CN.ts:3796-3797`：「内置」/「从 {marketplace} 安装」）。
 *
 * 内置那一支的判据取 `pluginCapabilityProjection.ts:24` 的 `plugin.source === "official"`；
 * `settings.plugins.source.*` 这两个 i18n key 在 `packages/ui/src` 里**没有调用点**
 * （2026-10-07 grep 只在 zh-CN / en-US 两份 locale 命中）—— 措辞照抄原文，使用点无法核实。
 */
export function pluginSourceLabelOf(entry: AgentPluginEntry, marketplaces: readonly AgentPluginMarketplace[] = []): string {
  if (entry.source === 'official') return '内置'
  const name = resolveMarketplaceDisplayName(entry.marketplace, marketplaces)
  return name ? `从 ${name} 安装` : `从 ${entry.id} 安装`
}

/** 一条插件的能力投影 —— 模板据此决定渲染哪些控件、哪些灰掉。 */
export function pluginCapabilityProjectionOf(
  entry: AgentPluginEntry,
  builtInPluginIds: readonly string[] = [],
  marketplaces: readonly AgentPluginMarketplace[] = [],
): AgentPluginCapability {
  // `pluginManagedResourceGroups.ts:63-81`：按固定顺序、省略空组、数量 = items.length。
  const byKind = new Map<AgentPluginComponentKind, AgentPluginDisplayGroup>()
  for (const group of entry.components ?? []) {
    if (group.items.length === 0) continue
    byKind.set(group.kind, {
      kind: group.kind,
      count: group.items.length,
      items: group.items.map((item) => (item.description ? { name: item.name, description: item.description } : { name: item.name })),
      label: AGENT_PLUGIN_COMPONENT_LABELS[group.kind],
    })
  }
  const componentGroups = AGENT_PLUGIN_COMPONENT_KINDS
    .map((kind) => byKind.get(kind))
    .filter((group): group is AgentPluginDisplayGroup => group !== undefined)
  const group: AgentPluginGroup = builtInPluginIds.includes(entry.id) ? 'builtIn' : 'installed'
  const blockers = [
    ...(entry.dependencyCycle ?? []),
    ...(entry.missingDependencies ?? []),
    ...(entry.disabledDependencies ?? []),
  ]
  const dependencySatisfied = blockers.length === 0
  return {
    materialized: entry.packageStatus !== 'missing',
    group,
    groupLabel: AGENT_PLUGIN_GROUP_LABELS[group],
    // 未命中的 id 排到 order.size 之后（`pluginStoreOrdering.ts:76-79` 的 compareRanks）。
    documentRank: DOCUMENT_PLUGIN_RANKS.get(entry.id) ?? DOCUMENT_PLUGIN_RANKS.size,
    componentGroups,
    componentCount: componentGroups.reduce((sum, group_) => sum + group_.count, 0),
    componentEmptyHint: entry.enabled ? '无组件' : '启用插件后查看其组件。',
    dependencySatisfied,
    blockedReason: entry.broken ?? (dependencySatisfied ? '' : `依赖没满足：${[...new Set(blockers)].join('、')}`),
    canEnable: entry.packageStatus !== 'missing' && dependencySatisfied,
    sourceLabel: pluginSourceLabelOf(entry, marketplaces),
  }
}

// ---- 启停闸门 ---------------------------------------------------------------

/** 启停被拒的原因。`ok` = 已应用；其余都表示**没有**进入后续的授权引导/运行态刷新。 */
export type AgentPluginEnabledChangeReason = 'ok' | 'dependency-missing' | 'not-materialized' | 'unknown-plugin' | 'unchanged'

export interface AgentPluginEnabledChangeResult {
  entries: AgentPluginEntry[]
  /** 这次启停是否真的落到了列表上。false 时调用方**不许**继续授权引导。 */
  applied: boolean
  reason: AgentPluginEnabledChangeReason
  /** 人类可读的原因（中文 UI 直接渲染）。 */
  message: string
}

/**
 * 启用/停用一条插件。**依赖没满足时不允许启用**。
 *
 * 契约照 ZCode `pluginEnabledChange.ts:13-25`（`runAfterSuccessfulPluginEnabledChange`）：
 * 「只有当前这次插件启停已经由服务端确认成功，才允许继续授权引导或运行态刷新」。
 * ZCode 那边是 `await submit()` 之后看 `succeeded && isCurrent()`；纯函数没有 RPC，
 * 所以把那两个条件拆成调用方给的 `available`（依赖已满足）与本函数自己的存在性/状态判定。
 * 返回 `applied === false` 就是「服务端没确认成功」的等价信号 —— 页面据此不许弹授权窗，
 * 避免 ZCode 那条注释里说的「插件未启用但已授权」的分裂状态（`pluginEnabledChange.ts:10-11`）。
 */
export function applyPluginEnabledChange(
  list: readonly AgentPluginEntry[],
  id: string,
  enabled: boolean,
  available: boolean,
): AgentPluginEnabledChangeResult {
  const entries = [...list]
  const index = entries.findIndex((entry) => entry.id === id)
  if (index < 0) {
    return { entries, applied: false, reason: 'unknown-plugin', message: `插件「${id}」不在当前清单里，没有改动。` }
  }
  const target = entries[index]!
  if (target.enabled === enabled) {
    return { entries, applied: false, reason: 'unchanged', message: `插件「${target.name}」已经是${enabled ? '启用' : '停用'}态，没有改动。` }
  }
  if (enabled) {
    // 依赖没满足 → 拒绝，不许先把开关拨过去再在运行期报错。
    if (!available) {
      const capability = pluginCapabilityProjectionOf(target)
      return {
        entries,
        applied: false,
        reason: 'dependency-missing',
        message: capability.blockedReason
          ? `插件「${target.name}」依赖没满足，未能启用：${capability.blockedReason}`
          : `插件「${target.name}」依赖没满足，未能启用。`,
      }
    }
    if (target.packageStatus === 'missing') {
      return {
        entries,
        applied: false,
        reason: 'not-materialized',
        message: `插件「${target.name}」在本机尚未物化（packageStatus=missing），不能启用。`,
      }
    }
  }
  entries[index] = { ...target, enabled }
  return { entries, applied: true, reason: 'ok', message: `已${enabled ? '启用' : '停用'}插件「${target.name}」。` }
}
