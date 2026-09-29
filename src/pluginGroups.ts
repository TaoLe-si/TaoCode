// 插件页的**分组、类目与搜索查询** —— 对照 IDEA 源码：
//  · `platform/platform-impl/src/com/intellij/ide/plugins/PluginsGroupType.kt:7-21`
//     13 个分组类型枚举（BUNDLED_UPDATE…SUGGESTED）。
//  · `.../plugins/newui/PluginsGroup.kt:18-155`
//     组 = 标题 + 类型 + 成员；`titleWithCount()` 是 `前缀 (n)`；
//     `titleWithCount(enabled)` 是 `前缀 (已启用 n/m)`；`sortByName()` 用忽略大小写的名称比较。
//  · `.../plugins/InstalledPluginsTab.kt:81-339, 678-733`
//     已安装页的组构成：正在安装组（有成员才渲染）→ 用户安装组（标题带"已启用 n/m"）
//     → 内置插件按类目分组（缺省类目 "Other Tools" 排在最后，组间按名比较）；
//     类目组的组级动作是 `Enable all` / `Disable all`（`enabled == 0` 时显示 Enable all）。
//  · `.../plugins/newui/SearchQueryParser.kt:127-213`
//     搜索框的 `/xxx` 属性语法：`/enabled`、`/disabled`、`/invalid`、`/outdated`、
//     `/userInstalled`（别名 `/downloaded`）、`/bundled`、`/updatedBundled`，其余词是关键字。
//  · `platform/platform-api/resources/messages/IdeBundle.properties:1572-1671`  标题文案。
//
// 纯函数：不碰 RPC、不持状态，所以可以单独测（`tests/plugin-groups.test.mjs`）。
// 组件只负责渲染这些结构，判断规则全在这里。
//
// 插件清单的类型也定义在这里（数据与规则同处），`src/bridge.ts` 只做一次 `export type ... from`
// 转出，这样既有的 `import type { PluginInfo } from './bridge'` 一个都不用改。

// A plugin contributes entry points only — commands point at actions TaoCode already
// owns, templates are validated like any project custom template. No third-party code
// is ever loaded into the host.
export interface PluginCommand { id: string; title: string; action: string; group: string }
export interface PluginTemplate { key: string; body: string; description: string; languages: string[] }
export interface PluginInfo {
  id: string; name: string; version: string; description: string; path: string
  /** `plugin.json` 的 `category`（IDEA 的 `displayCategory`）；缺省归入 "Other Tools"。 */
  category?: string
  enabled: boolean; error?: string; commands: PluginCommand[]; templates: PluginTemplate[]
}
export interface PluginList { plugins: PluginInfo[] }

/** `PluginsGroupType.kt:7-21` 的 13 个类型，顺序照抄。 */
export const PLUGIN_GROUP_TYPES = [
  'BUNDLED_UPDATE',
  'UPDATE',
  'INSTALLING',
  'INSTALLED',
  'SEARCH_INSTALLED',
  'SEARCH',
  'STAFF_PICKS',
  'NEW_AND_UPDATED',
  'TOP_DOWNLOADS',
  'TOP_RATED',
  'CUSTOM_REPOSITORY',
  'INTERNAL',
  'SUGGESTED',
] as const
export type PluginGroupType = (typeof PLUGIN_GROUP_TYPES)[number]

/** 只出现在"已安装"页的组类型（`InstalledPluginsTab.kt` 用到的那几个）。 */
export const INSTALLED_GROUP_TYPES = ['INSTALLING', 'INSTALLED'] as const
export type InstalledGroupType = (typeof INSTALLED_GROUP_TYPES)[number]

/**
 * 缺省类目名 —— `IdeBundle.properties:1599` 的 `plugins.configurable.other.bundled`（"Other Tools"）。
 * `InstalledPluginsTab.kt:234, 245` 用它兜底没有 `displayCategory` 的插件，
 * 并在 `:283-288` 让它**排在其他类目之后**。
 */
export const PLUGIN_OTHER_CATEGORY = 'Other Tools'

/** 组标题前缀（`IdeBundle.properties:1602-1604`）。 */
export const PLUGIN_GROUP_PREFIX = {
  installing: '正在安装',
  userInstalled: '用户安装',
  bundledUpdates: '内置插件更新',
} as const

/** 本仓的插件都是用户装进配置文件目录的，没有 IDE 自带（bundled）插件这一层。 */
export function pluginCategory(plugin: PluginInfo): string {
  const category = (plugin.category ?? '').trim()
  return category || PLUGIN_OTHER_CATEGORY
}

// ---- 标题与计数（PluginsGroup.kt:58-79） ------------------------------------

/** `PluginsGroup.titleWithCount()`：`前缀 (n)`。 */
export function pluginGroupTitle(prefix: string, total: number): string {
  return `${prefix} (${total})`
}

/** `PluginsGroup.titleWithCount(enabled)`：`IdeBundle.properties:1671` 的 `{0} ({1} of {2} enabled)`。 */
export function pluginGroupTitleWithEnabled(prefix: string, enabled: number, total: number): string {
  return `${prefix}（已启用 ${enabled}/${total}）`
}

/** `ComparablePluginsGroup.titleWithCount`（`:714-718`）：全员未启用时按钮是 Enable all，否则 Disable all。 */
export function pluginGroupToggleLabel(enabledCount: number): string {
  return enabledCount === 0 ? '全部启用' : '全部禁用'
}

/** 组内"已启用"的判定 —— `InstalledPluginsTab.kt:696-708` 排除了读取失败的插件。 */
export function pluginIsEnabled(plugin: PluginInfo): boolean {
  return plugin.enabled && !plugin.error
}

export function pluginEnabledCount(plugins: readonly PluginInfo[]): number {
  return plugins.filter(pluginIsEnabled).length
}

// ---- 排序（PluginsGroup.kt:146-155 + InstalledPluginsTab.kt:264-290, 710-712） ----

/**
 * `StringUtil.compare(a, b, true)`（`platform/util/src/com/intellij/openapi/util/text/StringUtil.java:2706-2712`）
 * 就是 `String.compareToIgnoreCase` —— **按 UTF-16 码元**逐位比，不是按语言的 collation。
 * 所以这里不能用 `localeCompare('zh-CN')`：那套排序会把汉字塞到拉丁字母前面，
 * 而 IDEA 里 '中文类目' 一定排在 'AAA' 之后。
 */
export function compareText(left: string, right: string): number {
  const a = left.toLowerCase()
  const b = right.toLowerCase()
  const shared = Math.min(a.length, b.length)
  for (let index = 0; index < shared; index++) {
    const difference = a.charCodeAt(index) - b.charCodeAt(index)
    if (difference) return difference < 0 ? -1 : 1
  }
  return a.length - b.length
}

/** `InstalledPluginsTab.kt:710-712` 的 `ComparablePluginsGroup.compareTo`。 */
export function comparePluginGroups(left: { title: string }, right: { title: string }): number {
  return compareText(left.title, right.title)
}

/**
 * `InstalledPluginsTab.kt:264-290` 的排序：缺省类目（Other Tools）排最后，其余按标题比较。
 * 组标题里带了计数（`前缀（已启用 n/m）`），比较前要先剥掉，否则"1"和"10"会决定顺序。
 */
export function sortPluginGroups<T extends { title: string; prefix: string }>(groups: T[]): T[] {
  return [...groups].sort((left, right) => {
    const leftDefault = left.prefix === PLUGIN_OTHER_CATEGORY
    const rightDefault = right.prefix === PLUGIN_OTHER_CATEGORY
    if (leftDefault !== rightDefault) return leftDefault ? 1 : -1
    return compareText(left.prefix, right.prefix)
  })
}

/** 组内按名称排序（`PluginsGroup.sortByName`，缺名时退回 id）。 */
export function sortPluginsByName(plugins: readonly PluginInfo[]): PluginInfo[] {
  return [...plugins].sort((left, right) => compareText(left.name || left.id, right.name || right.id))
}

// ---- 已安装页的组构成（InstalledPluginsTab.kt:81-339） -----------------------

/** 组的组级动作：`PluggGroup.mainAction` / `secondaryActions`（`PluginsGroup.kt:25-27`）。 */
export interface PluginGroupAction {
  /** `enableAll` / `disableAll` 对应 `ComparablePluginsGroup.setEnabledState()`（`:720-722`）。 */
  kind: 'enableAll' | 'disableAll'
  label: string
  /** 动作作用的对象（组内**可切换**的插件，读取失败的排除）。 */
  ids: string[]
}

export interface PluginGroup {
  type: InstalledGroupType
  /** 组标题前缀（不含计数），排序与去重都用它。 */
  prefix: string
  /** 完整标题（含计数）。 */
  title: string
  plugins: PluginInfo[]
  /**
   * 只有"正在安装"组会用到：还没有清单数据的待装条目（安装源的名字）。
   * IDEA 那边同样是"把 id 先塞进组里"（`MyPluginModel.installingPlugins`），
   * 区别只是它能提前拿到插件 id，本仓要等解压完才解析出 `plugin.json`。
   */
  pending: string[]
  /** 组级动作；没有可切换成员时为 null（IDEA 同样把 mainAction 设为不可见）。 */
  action: PluginGroupAction | null
}

/**
 * 组装已安装页的分组。
 *
 * 与 IDEA 的差异（如实记录）：IDEA 把"用户安装"与"内置（按类目）"分成两组，
 * 因为它的插件分成自带的与用户装的；本仓的插件全部来自用户配置目录，
 * 所以只有"用户安装"一组 —— 但**类目仍然是真数据**（`plugin.json` 的 `category`），
 * 一旦宿主将来带上自带插件，`categoryGroups` 这一层就已经就位。
 *
 * `installing`：正在安装的条目（安装源的名字；本地安装要解压上百个文件才解析出清单，
 * 这期间把它们放进"正在安装"组，IDEA 的 `MyPluginModel.installingPlugins` 也是这么做的）。
 * `sorted`：组内是否按名称排（`PluginsGroup.sortByName`）；传 false 保留调用方的顺序，
 * 因为界面上还有一个"按目录顺序 / 按名称"的开关。
 */
export function buildInstalledGroups(
  plugins: readonly PluginInfo[],
  installing: readonly string[] = [],
  sorted = true,
): PluginGroup[] {
  const groups: PluginGroup[] = []
  const installingSet = new Set(installing)
  const order = (members: readonly PluginInfo[]) => (sorted ? sortPluginsByName(members) : [...members])

  const known = plugins.filter(plugin => installingSet.has(plugin.id))
  const pending = installing.filter(label => !plugins.some(plugin => plugin.id === label))
  const installingCount = known.length + pending.length
  if (installingCount) {
    // `InstalledPluginsTab.kt:200-204`：安装中的组只带计数，没有 Enable/Disable all。
    groups.push({
      type: 'INSTALLING',
      prefix: PLUGIN_GROUP_PREFIX.installing,
      title: pluginGroupTitle(PLUGIN_GROUP_PREFIX.installing, installingCount),
      plugins: order(known),
      pending,
      action: null,
    })
  }

  const installed = order(plugins.filter(plugin => !installingSet.has(plugin.id)))
  if (installed.length) {
    // `InstalledPluginsTab.kt:303-317`：用户安装组标题 = `前缀（已启用 n/m）`。
    const toggleable = installed.filter(plugin => !plugin.error)
    const enabled = pluginEnabledCount(installed)
    // `ComparablePluginsGroup` 在"没有可启停成员"时隐藏组级动作（`:690-692`）。
    groups.push({
      type: 'INSTALLED',
      prefix: PLUGIN_GROUP_PREFIX.userInstalled,
      title: pluginGroupTitleWithEnabled(PLUGIN_GROUP_PREFIX.userInstalled, enabled, installed.length),
      plugins: installed,
      pending: [],
      action: toggleable.length
        ? {
            kind: enabled === 0 ? 'enableAll' : 'disableAll',
            label: pluginGroupToggleLabel(enabled),
            ids: toggleable.map(plugin => plugin.id),
          }
        : null,
    })
  }

  return groups
}

/**
 * 按类目分组（`InstalledPluginsTab.kt:243-250` + `:319-325`）。
 * 单独导出，因为它是"内置插件"那一层的规则，宿主带上自带插件时直接可用。
 */
export function groupPluginsByCategory(plugins: readonly PluginInfo[]): PluginGroup[] {
  const buckets = new Map<string, PluginInfo[]>()
  for (const plugin of plugins) {
    const category = pluginCategory(plugin)
    const bucket = buckets.get(category)
    if (bucket) bucket.push(plugin)
    else buckets.set(category, [plugin])
  }
  const groups: PluginGroup[] = [...buckets.entries()].map(([category, members]) => {
    const sorted = sortPluginsByName(members)
    const toggleable = sorted.filter(plugin => !plugin.error)
    const enabled = pluginEnabledCount(sorted)
    return {
      type: 'INSTALLED' as InstalledGroupType,
      prefix: category,
      title: pluginGroupTitleWithEnabled(category, enabled, sorted.length),
      plugins: sorted,
      pending: [],
      action: toggleable.length
        ? { kind: enabled === 0 ? 'enableAll' as const : 'disableAll' as const, label: pluginGroupToggleLabel(enabled), ids: toggleable.map(plugin => plugin.id) }
        : null,
    }
  })
  return sortPluginGroups(groups)
}

// ---- 搜索框的 `/xxx` 语法（SearchQueryParser.kt:127-213） --------------------

/** `InstalledSearchOption`（`:725-733`）的 7 个选项，顺序照抄。 */
export const INSTALLED_SEARCH_OPTIONS = [
  'userInstalled',
  'needUpdate',
  'enabled',
  'disabled',
  'invalid',
  'bundled',
  'updatedBundled',
] as const
export type InstalledSearchOption = (typeof INSTALLED_SEARCH_OPTIONS)[number]

/**
 * 本仓**有真实数据**的选项。`needUpdate` / `bundled` / `updatedBundled` 依赖插件仓库
 * 与 IDE 自带插件这两样本仓还没有的东西，所以不渲染成控件（渲染了就是点不动的假筛选），
 * 已登记进 `docs/class-parity-todo.md` §10 #6。
 */
export const SUPPORTED_SEARCH_OPTIONS = ['userInstalled', 'enabled', 'disabled', 'invalid'] as const
export type SupportedSearchOption = (typeof SUPPORTED_SEARCH_OPTIONS)[number]

export const INSTALLED_OPTION_LABEL: Record<InstalledSearchOption, string> = {
  userInstalled: '用户安装',
  needUpdate: '需要更新',
  enabled: '已启用',
  disabled: '已禁用',
  invalid: '无效',
  bundled: '内置',
  updatedBundled: '已更新的内置',
}

/**
 * 选项对应的查询词（`:672-675`）：`NeedUpdate` 特例为 `/outdated`，
 * 其余是 `/` + 选项名首字母小写。
 */
export function installedSearchQuery(option: InstalledSearchOption): string {
  return option === 'needUpdate' ? '/outdated' : `/${option}`
}

/** `/downloaded` 是 `/userInstalled` 的历史别名（`:193`），`/pluginUpdateSource` 需要取值。 */
const OPTION_ALIASES: Record<string, InstalledSearchOption> = {
  '/enabled': 'enabled',
  '/disabled': 'disabled',
  '/bundled': 'bundled',
  '/updatedbundled': 'updatedBundled',
  '/downloaded': 'userInstalled',
  '/userinstalled': 'userInstalled',
  '/invalid': 'invalid',
  '/outdated': 'needUpdate',
}

export interface InstalledQuery {
  /** 非 `/` 开头的词，按空格拼回（`:14-21` 的 `searchQuery`）。 */
  keyword: string
  /** 命中的属性（同时为真时是**与**关系，`:177` 只用来判断"有没有属性"）。 */
  options: SupportedSearchOption[]
  /** 有没有任何属性词（决定要不要进搜索面板）。 */
  attributes: boolean
  /** `/xxx` 里本仓还不支持的（如 `/bundled`）：解析出来但不参与过滤，用于如实提示。 */
  unsupported: InstalledSearchOption[]
}

/**
 * 按 `splitQuery`（`:216-252`）分词：跳过空格、支持双引号、`:` 也算分隔符，
 * 然后按 `parse`（`:144-178`）分类。
 */
export function splitPluginQuery(text: string): string[] {
  const words: string[] = []
  const length = text.length
  let index = 0
  while (index < length) {
    const startCharacter = text[index++]
    if (startCharacter === ' ') continue
    if (startCharacter === '"') {
      const end = text.indexOf('"', index)
      if (end === -1) break
      words.push(text.slice(index, end))
      index = end + 1
      continue
    }
    const start = index - 1
    while (index <= length) {
      if (index === length) {
        words.push(text.slice(start))
        break
      }
      const nextCharacter = text[index++]
      if (nextCharacter === ':' || nextCharacter === ' ' || index === length) {
        words.push(text.slice(start, nextCharacter === ' ' ? index - 1 : index))
        break
      }
    }
  }
  return words
}

export function parseInstalledQuery(text: string): InstalledQuery {
  const words = splitPluginQuery(text)
  const keywords: string[] = []
  const options: SupportedSearchOption[] = []
  const unsupported: InstalledSearchOption[] = []
  for (const word of words) {
    if (!word.startsWith('/')) {
      keywords.push(word)
      continue
    }
    const option = OPTION_ALIASES[word.toLowerCase()]
    if (!option) continue
    if ((SUPPORTED_SEARCH_OPTIONS as readonly string[]).includes(option)) {
      const supported = option as SupportedSearchOption
      if (!options.includes(supported)) options.push(supported)
    } else if (!unsupported.includes(option)) {
      unsupported.push(option)
    }
  }
  return { keyword: keywords.join(' '), options, attributes: options.length > 0 || unsupported.length > 0, unsupported }
}

/**
 * 选项开关（`handleSearchOptionSelection`，`:486-515`）：把该选项的查询词加进/移出文本框，
 * 其余词原样保留 —— 所以点击筛选按钮等价于在搜索框里手打 `/enabled`。
 */
export function toggleInstalledSearchOption(text: string, option: InstalledSearchOption): string {
  const query = installedSearchQuery(option)
  const words = splitPluginQuery(text)
  const kept = words.filter(word => word.toLowerCase() !== query.toLowerCase())
  if (kept.length !== words.length) return kept.join(' ')
  return [...kept, query].join(' ')
}

/** 文本框里当前生效的选项（按钮高亮用，对应 `setState`，`:655-670`）。 */
export function installedQueryOptions(text: string): Set<SupportedSearchOption> {
  return new Set(parseInstalledQuery(text).options)
}

/** 一个插件是否命中查询 —— 属性是**与**关系；关键字匹配名称 / id / 描述。 */
export function matchesInstalledQuery(plugin: PluginInfo, query: InstalledQuery): boolean {
  if (query.options.includes('enabled') && !pluginIsEnabled(plugin)) return false
  if (query.options.includes('disabled') && !(!plugin.enabled && !plugin.error)) return false
  if (query.options.includes('invalid') && !plugin.error) return false
  // `userInstalled` 在本仓恒真：插件只能来自用户配置目录（见 `list()` 的实现）。
  if (!query.keyword) return true
  const needle = query.keyword.toLowerCase()
  return [plugin.name, plugin.id, plugin.description, plugin.version, plugin.category]
    .some(value => (value ?? '').toLowerCase().includes(needle))
}
