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
/**
 * `plugin.json` 的 `contributes.fileTypes` 一条 —— 上游 `com.intellij.fileType` EP 的
 * `<fileType>` 标签（`FileTypeBean.java` 的 `@Attribute`：name :93、extensions :101、
 * fileNames :108、patterns :116、fileNamesCaseInsensitive :123、language :132、hashBangs :144、
 * implementationClass :72、fieldName :84）。值是**分号分隔的原样字符串**，拆分与匹配器构造
 * 只在 `src/fileTypeRegistry.ts` 的 `parseFileTypeBean` 做一份。装载与回收见
 * `src/fileTypePluginBeans.ts`。
 */
export interface PluginFileType {
  name?: string
  language?: string
  extensions?: string
  fileNames?: string
  patterns?: string
  fileNamesCaseInsensitive?: string
  hashBangs?: string
  /** 非空 = 「声明一个新类型」；空 = 只给已有类型补关联（上游 `FileTypeBean.java:29-41` 的两种用法）。 */
  implementationClass?: string
  fieldName?: string
}
export interface PluginInfo {
  id: string; name: string; version: string; description: string; path: string
  /**
   * `plugin.json` 的 `changeNotes` —— 上游清单的 `<change-notes>` 元素
   * （`PluginXmlConst.kt:42` 的 `CHANGE_NOTES_ELEM`，读取面 `XmlReader.kt:193`，
   * getter `platform/core-impl/src/com/intellij/ide/plugins/IdeaPluginDescriptorImpl.kt:195`）。
   * 界面消费点是插件详情面板那段说明（上游 `PluginDetailsPageComponent.kt:1394`，空内容整块不可见）；
   * 本仓同样：空 / 缺省 = 不渲染那一行。原生侧超过 1200 字符按「没写」处理（`native/plugins.cpp` 的 `text_or`）。
   */
  changeNotes?: string
  /** `plugin.json` 的 `category`（IDEA 的 `displayCategory`）；缺省归入 "Other Tools"。 */
  category?: string
  /**
   * 插件厂商 —— 上游清单 `<vendor>` 元素（`platform/pluginSystem/parser/impl/src/com/intellij/platform/pluginSystem/parser/impl/PluginXmlConst.kt:36`
   * 的 `VENDOR_ELEM = "vendor"`，读取面 `platform/core-impl/src/com/intellij/ide/plugins/IdeaPluginDescriptorImpl.kt:224` 的
   * `getVendor()`），界面模型 `newui/PluginUiModel.kt:52` 的 `val vendor: String?`。
   * 上游允许没有（`IdeBundle.properties:455` 给的是 `(not specified)`），所以这里也是可选：
   * 缺省不渲染那一行，`/vendor:` 也匹配不上它（`newui/MyPluginModel.kt:1348-1352`：厂商为空直接 false）。
   */
  vendor?: string
  enabled: boolean; error?: string; commands: PluginCommand[]; templates: PluginTemplate[]
  /** 插件声明的文件类型（`native/plugins.cpp` 的 `read_file_types` 解析）。 */
  fileTypes?: PluginFileType[]
  /**
   * 依赖（`plugin.json` 的 `depends` / `optionalDepends`，由 `native/plugins.cpp` 解析）：
   * `depends` 是必需、`optionalDepends` 是可选；下面三格是原生在扫完插件目录后解出的
   * 状态 —— 缺装的必需依赖、装着但停用的必需依赖、以及把它列进 `depends` 的插件（反向引用）。
   * `broken` 是依赖不满足时的一句话原因（IDEA 里这类插件不会被加载）。
   */
  depends?: string[]
  optionalDepends?: string[]
  missingDependencies?: string[]
  disabledDependencies?: string[]
  requiredBy?: string[]
  /**
   * 必需依赖构成的循环（`native/plugins.cpp` 的 Tarjan 结果），成员按 id 排序。
   * 上游把成环的插件判为**不可加载**（`PluginManagerStateService.kt:175-202`，
   * `CoreBundle.properties:32`），所以非空即不可启用、也不加载。
   */
  dependencyCycle?: string[]
  broken?: string
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

/**
 * 依赖不满足（`broken` 非空）：IDEA 里这类插件**不会被加载**，贡献的命令/模板也不生效。
 * 缺装与被停用的必需依赖都算 —— 原生侧在 `list()` 里分别列进
 * `missingDependencies` / `disabledDependencies`。
 */
export function pluginIsBroken(plugin: PluginInfo): boolean {
  return Boolean(plugin.broken)
}

/** 组内"已启用"的判定 —— `InstalledPluginsTab.kt:696-708` 排除了读取失败的插件。 */
export function pluginIsEnabled(plugin: PluginInfo): boolean {
  return plugin.enabled && !plugin.error && !pluginIsBroken(plugin)
}

/**
 * 会真正加载的插件 = 清单可读 + 依赖齐 + 启用。命令与模板只从这些插件进来
 * （`src/pluginCommands.ts` 的 `enabledPlugins` 用同一个判定）。
 */
export function pluginIsLoadable(plugin: PluginInfo): boolean {
  return pluginIsEnabled(plugin)
}

/**
 * 详情面板那行依赖摘要（没声明依赖时是空串）：
 * 「必需：a、b · 可选：c · 缺少：d · 依赖它的：e」。
 * 只列真实存在的部分，不印「缺少：无」这种噪音。
 */
export function pluginDependencySummary(plugin: PluginInfo): string {
  const parts: string[] = []
  const required = plugin.depends ?? []
  const optional = plugin.optionalDepends ?? []
  const cycle = plugin.dependencyCycle ?? []
  const missing = plugin.missingDependencies ?? []
  const disabled = plugin.disabledDependencies ?? []
  const requiredBy = plugin.requiredBy ?? []
  if (required.length) parts.push(`必需：${required.join('、')}`)
  if (optional.length) parts.push(`可选：${optional.join('、')}`)
  if (cycle.length) parts.push(`循环：${cycle.join('、')}`)
  if (missing.length) parts.push(`缺少：${missing.join('、')}`)
  if (disabled.length) parts.push(`已停用：${disabled.join('、')}`)
  if (requiredBy.length) parts.push(`依赖它的：${requiredBy.join('、')}`)
  return parts.join(' · ')
}

/**
 * 复选框能不能点：清单读不出来、必需依赖缺装、或必需依赖成环时不能
 * （前两种启用必然失败；成环是**永远**失败 —— 上游同样不加载成环的插件，
 * 只能改清单，所以 `native/plugins.cpp` 的 `set_enabled` 直接抛 `DEPENDENCY_CYCLE`）。
 * 缺的「必需依赖装着但被停用」不在此列：启用会把它连带启用。
 */
export function pluginCanToggle(plugin: PluginInfo): boolean {
  if (plugin.error || (plugin.dependencyCycle?.length ?? 0) > 0) return false
  return (plugin.missingDependencies?.length ?? 0) === 0
}

export function pluginEnabledCount(plugins: readonly PluginInfo[]): number {
  return plugins.filter(pluginIsEnabled).length
}

// ---- 卸载前的「谁还依赖它」（UninstallAction 的那一段确认文案） ---------------------

/**
 * 依赖 `id` 的插件闭包 —— 上游 `newui/DefaultUiPluginManagerController.kt:1452-1479` 的 `getDependents`：
 *  1. 候选者跳过自己（`:1463`）、跳过**停用着的**候选者（`!descriptor.isEnabled()` → `:1464` continue）、
 *     跳过 essential / hidden（同两行；本仓没有"IDE 自带不可卸载的那一层"，见交付报告 §6）；
 *  2. 对每个候选者顺着它自己的**必需**依赖逐级下探（`PluginManagerCore.processAllNonOptionalDependencies`，
 *     `:1469`），探到 `id` 就收下（`:1470-1472` 的 TERMINATE）。
 * 探路**不看中间节点的启用状态**（上游只对候选者自己看 `isEnabled()`），
 * 所以「A 依赖着停用的 B、B 依赖 root」里的 A 仍算依赖者 —— 卸载 root 后 A 与 B 一起加载不了。
 * 本仓的 `requiredBy` 只有一层（`native/plugins.cpp` 的 `list()` 只算直接反向引用），故闭包在前端算。
 * 结果按名称排序（与 `PluginsGroup.sortByName` 同一口径）。
 */
export function pluginsDependingOn(id: string, plugins: readonly PluginInfo[]): PluginInfo[] {
  const byId = new Map(plugins.map(plugin => [plugin.id, plugin]))
  const reaches = (candidateId: string): boolean => {
    const seen = new Set<string>([candidateId])
    const queue: string[] = [candidateId]
    while (queue.length) {
      const current = queue.shift() as string
      for (const dependency of byId.get(current)?.depends ?? []) {
        if (dependency === id) return true
        if (!seen.has(dependency)) {
          seen.add(dependency)
          queue.push(dependency)
        }
      }
    }
    return false
  }
  return sortPluginsByName(plugins.filter(plugin => plugin.id !== id && plugin.enabled && reaches(plugin.id)))
}

export interface PluginUninstallPrompt {
  /** `IdeBundle.properties:459` 的 `title.plugin.uninstall`（"Uninstall Plugin?"）。 */
  title: string
  /** 正文：没有依赖者时是 `:457` 的 `prompt.uninstall.plugin`，有依赖者时是 `:2359` 的依赖者清单。 */
  message: string
  /** 会被牵连的插件（上游把名字逐个列进正文：`UninstallAction.kt:142-146`）。 */
  dependents: PluginInfo[]
}

/**
 * 卸载确认文案 —— 上游 `newui/UninstallAction.kt:91-103` 分两条路：
 * 没有依赖者走 `getUninstallAllMessage`（`:127-135`，`prompt.uninstall.plugin`），
 * 有依赖者走 `getUninstallDependentsMessage`（`:137-155`，`dialog.message.following.plugin.depend.on`）。
 * 中文是本仓按英文原文直译（本地化包不在基准树里）：
 *   `IdeBundle.properties:457` "Are you sure you want to uninstall the plugin ''{0}''{1, choice, 0#|1# update}?"
 *   `IdeBundle.properties:2359` "Following {0,choice,1#plugin|2#plugins} {0,choice,1#depends|2#depend} on {1}:<br>{2}<br>Continue to remove {1}?"
 * 英文的单复数（`{0,choice,1#plugin|2#plugins}`）在中文里没有对应形态，因此合并成一种说法。
 */
export function pluginUninstallPrompt(plugin: PluginInfo, plugins: readonly PluginInfo[]): PluginUninstallPrompt {
  const name = plugin.name || plugin.id
  const dependents = pluginsDependingOn(plugin.id, plugins)
  if (!dependents.length) {
    return { title: '卸载插件？', message: `确定要卸载插件「${name}」吗？`, dependents }
  }
  const listed = dependents.map(item => `  ${item.name || item.id}`).join('\n')
  return {
    title: '卸载插件？',
    message: `以下 ${dependents.length} 个插件依赖「${name}」：\n${listed}\n确定要移除「${name}」吗？`,
    dependents,
  }
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
    const toggleable = installed.filter(pluginCanToggle)
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
    const toggleable = sorted.filter(pluginCanToggle)
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
 * 本仓**有真实数据**的选项。`needUpdate`（`/outdated`）从市场页的本地仓库目录取数
 * （`src/pluginMarket.ts` 的 `marketplaceUpdates()`：已装版本 < 清单版本）；`bundled` /
 * `updatedBundled` 依赖 IDE 自带插件这一层（本仓插件全部来自用户配置目录），因此仍不渲染成
 * 控件（渲染了就是点不动的假筛选），登记在 `docs/class-parity-todo.md` §10 #6。
 */
export const SUPPORTED_SEARCH_OPTIONS = ['userInstalled', 'needUpdate', 'enabled', 'disabled', 'invalid'] as const
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

/**
 * 需要**跟一个取值**的属性词 —— `newui/SearchWords.kt:8-16` 的枚举（值就是搜索框里打的词）：
 * `VENDOR("/vendor:")` `:9`、`TAG("/tag:")` `:10`、`PLUGIN_UPDATE_SOURCE("/updatesFrom:")` `:16`。
 * 解析口径照 `newui/SearchQueryParser.kt:156-167`：词表里下一个词是它的取值；
 * **取值缺失**时上游把整条查询当关键字并停止解析（`:164` `addToSearchQuery(query)` + `break`）。
 */
const VALUE_ATTRIBUTE_WORDS: Record<string, 'vendor' | 'tag' | 'updateSource'> = {
  '/vendor:': 'vendor',
  '/tag:': 'tag',
  '/updatesfrom:': 'updateSource',
}

/** `SearchQueryParser.kt:128-130` 的三个集合里本仓**没有数据源**的两个（标签与更新源来自远端清单）。 */
export const UNSUPPORTED_ATTRIBUTE_WORDS = ['标签（/tag:）', '更新源（/updatesFrom:）'] as const

export interface InstalledQuery {
  /** 非 `/` 开头的词，按空格拼回（`:14-21` 的 `searchQuery`）。 */
  keyword: string
  /** 命中的属性（同时为真时是**与**关系，`:177` 只用来判断"有没有属性"）。 */
  options: SupportedSearchOption[]
  /** 有没有任何属性词（决定要不要进搜索面板）。 */
  attributes: boolean
  /** `/xxx` 里本仓还不支持的（如 `/bundled`）：解析出来但不参与过滤，用于如实提示。 */
  unsupported: InstalledSearchOption[]
  /**
   * `/vendor:` 的取值集合（`SearchQueryParser.kt:128` 的 `vendors` / `:202-204` 的收集）。
   * 多个取值之间是**或**关系 —— `MyPluginModel.kt:1354-1358` 是"命中其中任意一个就留下"。
   */
  vendors: string[]
  /**
   * 解析出来但本仓**没有数据源**的取值属性（`/tag:`、`/updatesFrom:`，`:129-130`）。
   * 与 `unsupported` 同一处置：吃掉取值词、不参与过滤、界面上如实说明。
   */
  deferred: string[]
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
  const vendors: string[] = []
  const deferred: string[] = []
  let index = 0
  while (index < words.length) {
    const word = words[index++]
    if (!word.startsWith('/')) {
      keywords.push(word)
      continue
    }
    const lowered = word.toLowerCase()
    const attribute = VALUE_ATTRIBUTE_WORDS[lowered]
    if (attribute) {
      // `SearchQueryParser.kt:156-167`：取值缺失（`/vendor:` 后面没有词了）时，上游把**整条查询**
      // 当关键字并停止解析；取值存在时把它从词表里吃掉（`handleAttribute(name, words[index++])`）。
      if (index >= words.length) return { keyword: text, options, attributes: options.length > 0 || unsupported.length > 0, unsupported, vendors, deferred }
      const value = words[index++]
      if (attribute === 'vendor') {
        if (!vendors.includes(value)) vendors.push(value)
      } else if (!deferred.includes(attribute)) {
        deferred.push(attribute)
      }
      continue
    }
    const option = OPTION_ALIASES[lowered]
    if (!option) continue
    if ((SUPPORTED_SEARCH_OPTIONS as readonly string[]).includes(option)) {
      const supported = option as SupportedSearchOption
      if (!options.includes(supported)) options.push(supported)
    } else if (!unsupported.includes(option)) {
      unsupported.push(option)
    }
  }
  return {
    keyword: keywords.join(' '),
    options,
    // `SearchQueryParser.kt:177` 的 `attributes` **只数布尔属性**（vendors / tags 不算），
    // 所以 `/vendor:xxx` 单用不会把界面推进"属性筛选"分支。
    attributes: options.length > 0 || unsupported.length > 0,
    unsupported,
    vendors,
    deferred,
  }
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

/**
 * 厂商文本匹配 —— `newui/MyPluginModel.kt:1348-1361` 的 `isVendor`：
 * 先把插件的厂商去空白，**空厂商直接不匹配**（`:1350-1352`）；命中条件是「忽略大小写相等」
 * **或**「插件厂商按忽略大小写包含查询词」（`:1355`）；多个查询词之间是**或**（`:1354` 的循环，
 * 命中任意一个就返回真）。消费点在已安装页：`InstalledPluginsTabSearchResultPanel.kt:87-94`。
 * 抽成「一段厂商文本」的形态，是因为市场页的条目（`src/pluginMarket.ts` 的 `MarketplacePlugin`）
 * 带的也是同一段文本，上游那边把 `/vendor:` 发给仓库服务端（`SearchQueryParser.kt:108-113` 的
 * `organization=`），本仓的仓库在本地，两侧共用这一条判定，不各写一份。
 */
export function vendorTextMatches(vendor: string | undefined, needles: readonly string[]): boolean {
  const text = (vendor ?? '').trim()
  if (!text) return false
  const haystack = text.toLowerCase()
  return needles.some(needle => {
    const target = needle.toLowerCase()
    return haystack === target || haystack.includes(target)
  })
}

export function pluginVendorMatches(plugin: PluginInfo, vendors: readonly string[]): boolean {
  return vendorTextMatches(plugin.vendor, vendors)
}

/**
 * 厂商点出来的查询词 —— 上游详情面板的厂商链接（`newui/PluginDetailsPageComponent.kt:1336`）：
 * `SearchWords.VENDOR.value + (organization 含空格时用双引号包住)`。
 * 必须按这条规则拼：分词器（`splitQuery`，`SearchQueryParser.kt:244`）把 `:` 和空格都当分隔符，
 * 不带引号的 "JetBrains s.r.o." 会被拆成取值 `JetBrains` + 关键字 `s.r.o.`。
 * 点击后的动作是**整框替换**（`newui/PluginsTab.kt:271` 的 `searchTextField.setTextIgnoreEvents(query)`），
 * 不是往后面追加。
 */
export function vendorQueryWord(vendor: string): string {
  return `/vendor:${vendor.includes(' ') ? `"${vendor}"` : vendor}`
}

/**
 * 上游 `InstalledPluginsTabSearchResultPanel.kt:56-63` 的 8 个属性词：查询里出现任何一个，
 * 空态就**不**给「在市场里搜索」这条链接（那已经是筛选而不是找不到了）。
 * 上游用的是原始字符串的 `contains`（区分大小写、不看词界），这里保持同一口径。
 */
const INSTALLED_ATTRIBUTE_WORDS = [
  '/downloaded',
  '/userInstalled',
  '/outdated',
  '/enabled',
  '/disabled',
  '/invalid',
  '/bundled',
  '/updatedBundled',
]

/**
 * 「什么都没搜到」时要不要在空态里挂出市场入口 —— 上游 `setupEmptyText`
 * （`InstalledPluginsTabSearchResultPanel.kt:53-70`）：空态正文是 `plugins.configurable.nothing.found`
 * （`IdeBundle.properties:1621` "Nothing found."），只要查询里没有属性词就在后面追加一条
 * 次级链接 `plugins.configurable.search.in.marketplace`（`IdeBundle.properties:1620`
 * "Search in Marketplace"），点击把**整个查询原样**交给市场页（`:68` 的 `accept(query)`）。
 * 中文是按英文原文直译（本地化包不在基准树里）。
 */
export function offersMarketplaceSearch(text: string): boolean {
  if (!text.trim()) return false
  return !INSTALLED_ATTRIBUTE_WORDS.some(word => text.includes(word))
}

/**
 * 一个插件是否命中查询 —— 属性是**与**关系；关键字匹配名称 / id / 描述。
 * `updateIds`：市场页从本地仓库算出的「有更新」插件 id（`marketplaceUpdates()` 的输出）。
 * 传了就参与 `/outdated` 过滤；没传 = 还没读仓库，此时 `/outdated` 匹配不到任何插件
 * （不是"没有更新"，是"还不知道"—— 界面上的计数同样是 0，读仓库后立刻有值）。
 */
export function matchesInstalledQuery(plugin: PluginInfo, query: InstalledQuery, updateIds?: readonly string[]): boolean {
  // 厂商过滤在布尔属性之前（上游 `InstalledPluginsTabSearchResultPanel.kt:87` 也是先过滤 vendors，
  // 布尔属性在 `:117-155` 才跑）；两者是叠加关系，先后不影响结果。
  if (query.vendors.length && !pluginVendorMatches(plugin, query.vendors)) return false
  if (query.options.includes('enabled') && !pluginIsEnabled(plugin)) return false
  // `/invalid`：清单读不出来，或必需依赖不满足 —— 两种都进不了加载（IDEA 同上）。
  if (query.options.includes('invalid') && !plugin.error && !pluginIsBroken(plugin)) return false
  if (query.options.includes('needUpdate') && !(updateIds ?? []).includes(plugin.id)) return false
  // `disabled`/`userInstalled` 的判定放在 needUpdate 之后（顺序不影响结果，属性是与关系）。
  if (query.options.includes('disabled') && !(!plugin.enabled && !plugin.error)) return false
  // `userInstalled` 在本仓恒真：插件只能来自用户配置目录（见 `list()` 的实现）。
  if (!query.keyword) return true
  const needle = query.keyword.toLowerCase()
  return [plugin.name, plugin.id, plugin.description, plugin.version, plugin.category, ...(plugin.depends ?? [])]
    .some(value => (value ?? '').toLowerCase().includes(needle))
}
