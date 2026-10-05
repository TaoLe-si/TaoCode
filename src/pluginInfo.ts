// 插件的**信息提供者与启用裁决**层 —— 对照 IDEA `platform/ide-core/plugins/`
// （`ic/plugins` 一族，5 个类）与 `platform/platform-impl` 的加载错误面：
//
//   · `UltimateDependencyChecker.kt:16-25`：`canBeEnabled(pluginId)` ——
//     「这个插件在当前 IDE 上下文里能不能被启用」。上游判的是 Ultimate 插件在不在，
//     本仓没有付费/发行版分层，所以判的是同一件事在本仓的真实条件：
//     清单读不出来、必需依赖缺装、必需依赖成环 —— 三种都**启用不了**（上游对应
//     `mark incompatible` / `Depends on plugin ''{0}'' which was marked as incompatible`
//     / `...form a dependency cycle`）。
//   · `PluginManagerStateService.kt:115-139`（`preparePluginErrors`）+ `CoreBundle.properties:29-72`：
//     逐插件的**用户可见加载错误**。上游把逐插件原因与全局原因（成环）分开列，
//     本仓照抄这个分法：`pluginLoadingError()` 给一个插件一条原因，
//     `pluginLoadingErrors()` 给整个列表的全局原因。
//   · `PluginFeatureService.kt:69-71`（`getPluginForFeature(featureType, implName)`）
//     与 `data.kt:50-59`（`PluginDataSet.get(implementationName)`）：
//     「某个实现名由哪些插件提供」的反向索引。本仓插件贡献两类入口点 —— 命令指向既有
//     **动作** id、模板带一个 **key**，所以 featureType 就是这两类。
//   · `CoreBundle.properties:42`（`Module {0} is declared by multiple plugins`）：
//     同一个入口点被多个插件声明是**错误**（上游是模块 id 冲突，本仓是动作/模板 id 被抢）。
//
// 纯函数：不 import bridge、不持状态（`canBeEnabled` 需要的判定全部来自 `native/plugins.cpp`
// 已经算好的 `broken` / `missingDependencies` / `dependencyCycle`），所以能单独测
// （`tests/plugin-info.test.mjs`）。渲染在 `src/components/PluginDialog.vue`。
import { compareText, pluginIsBroken, type PluginInfo } from './pluginGroups.ts'

// ── 启用裁决（`UltimateDependencyChecker.canBeEnabled`）─────────────────────────

export interface EnablementVerdict {
  /** 能不能启用。已启用着的插件仍然返回 true —— 这里判的是「执行一次启用会不会成功」。 */
  enabled: boolean
  /** 不能启用时的一句话原因（中文，界面直接显示）；能启用时是空串。 */
  reason: string
}

/**
 * 一个插件现在**能不能被启用**。上游的 `canBeEnabled` 只有一个布尔，
 * 但用户需要知道为什么复选框点不动，所以这里把原因一起返回（`reason`）。
 *
 * 三种判不到的情况（与 `CoreBundle.properties` 的三条短文案一一对应）：
 *   · 清单读不出来 → 上游 `File ''{0}'' contains invalid plugin descriptor`；
 *   · 必需依赖缺装 → 上游 `Plugin ''{0}'' requires plugin ''{1}'' to be installed`；
 *   · 必需依赖成环 → 上游 `Plugins {0} cannot be loaded because they form a dependency cycle`。
 *
 * **刻意不算一种情况**：必需依赖装着但被停用。上游也不拦（`PluginEnabler` 会连带把它启用），
 * 本仓的 `native/plugins.cpp` 的 `set_enabled` 同样会递归启用必需依赖，所以点得动。
 */
export function canBeEnabled(plugin: PluginInfo): EnablementVerdict {
  if (plugin.error) return { enabled: false, reason: `清单无法读取：${plugin.error}` }
  const cycle = plugin.dependencyCycle ?? []
  if (cycle.length)
    return { enabled: false, reason: `这些插件的必需依赖形成循环：${cycle.join('、')}（环上的插件都启用不了）` }
  const missing = plugin.missingDependencies ?? []
  if (missing.length)
    return { enabled: false, reason: `需要先安装依赖插件：${missing.join('、')}` }
  return { enabled: true, reason: '' }
}

// ── 用户可见的加载错误（`preparePluginErrors` + CoreBundle 文案）───────────────

/**
 * 单个插件的加载原因（上游 `PluginNonLoadReason.detailedMessage` 那一层）：
 * 清单坏 → 依赖成环 → 依赖缺装 → 依赖被停用 → 依赖方加载失败。
 * 空串 = 加载得起来。注意**停用的插件不算加载失败**（它就是被停用了），
 * 这与 `native/plugins.cpp` 的 `broken` 口径一致。
 */
export function pluginLoadingError(plugin: PluginInfo): string {
  if (plugin.error) return `清单无法读取：${plugin.error}`
  const cycle = plugin.dependencyCycle ?? []
  const parts: string[] = []
  if (cycle.length) parts.push(`必需依赖形成循环：${cycle.join('、')}`)
  const missing = plugin.missingDependencies ?? []
  if (missing.length) parts.push(`需要先安装依赖插件：${missing.join('、')}`)
  const disabled = plugin.disabledDependencies ?? []
  if (disabled.length) parts.push(`需要启用依赖插件：${disabled.join('、')}`)
  if (!parts.length) return ''
  // 上游 `Depends on plugin ''{0}'' which was marked as incompatible`：
  // 装载不起来的插件，它的依赖方同样起不来，所以把这一层也列出来。
  const dependents = (plugin.requiredBy ?? []).filter(id => !cycle.includes(id))
  if (dependents.length) parts.push(`依赖它的插件也起不来：${dependents.join('、')}`)
  return parts.join(' · ')
}

/**
 * 整列表的**全局**加载原因（上游 `preparePluginErrors:126-132` 的 `globalErrors`：
 * 成环错误是全局的，不按插件拆，一条环只报一次）。
 */
export function pluginLoadingErrors(plugins: readonly PluginInfo[]): string[] {
  const groups = new Map<string, string[]>()
  for (const plugin of plugins) {
    const cycle = plugin.dependencyCycle ?? []
    if (!cycle.length) continue
    const key = cycle.join('、')
    if (!groups.has(key)) groups.set(key, [])
    groups.get(key)!.push(plugin.name || plugin.id)
  }
  return [...groups.entries()]
    .sort((left, right) => compareText(left[0], right[0]))
    .map(([members]) => `这些插件无法加载，因为它们形成依赖循环：${members}`)
}

// ── 入口点的反向索引（`PluginFeatureService` / `PluginDataSet`）────────────────

/** 本仓插件贡献的入口点类型（上游 `featureType` 的对应物）。 */
export const PLUGIN_FEATURE_TYPES = ['action', 'template'] as const
export type PluginFeatureType = (typeof PLUGIN_FEATURE_TYPES)[number]

export const PLUGIN_FEATURE_LABELS: Record<PluginFeatureType, string> = {
  action: '动作',
  template: '模板',
}

/**
 * 某个入口点（动作 id / 模板 key）由哪些插件提供 —— 上游
 * `getPluginForFeature(featureType, implementationName)` 的语义：
 * **只看会真正被加载的插件**（上游的映射是在扩展点处理过程中登记的，未加载的插件不登记）。
 * 一个都没有返回空数组（上游返回 null，本仓用空数组，调用方少一层判空）。
 */
export function featureProviders(
  plugins: readonly PluginInfo[],
  featureType: PluginFeatureType,
  implementationName: string,
): PluginInfo[] {
  const providers: PluginInfo[] = []
  for (const plugin of plugins) {
    if (plugin.error || pluginIsBroken(plugin)) continue
    const hit = featureType === 'action'
      ? plugin.commands.some(command => command.action === implementationName)
      : plugin.templates.some(entry => entry.key === implementationName)
    if (hit) providers.push(plugin)
  }
  return providers
}

export interface DuplicateFeature {
  type: PluginFeatureType
  /** 被多个插件声明的入口点名（动作 id 或模板 key）。 */
  name: string
  /** 声明了它的插件（按名排序）。 */
  plugins: string[]
}

/**
 * 同一个入口点被**多个**插件声明（上游 `Module {0} is declared by multiple plugins`）。
 * 上游是模块 id 冲突（加载期错误），本仓的等价物是动作/模板 id 被抢：
 * 两个插件的命令会各自成一行菜单（`pluginCommands.ts` 的行 id 带插件 id，不冲突），
 * 但同一个动作被两处挂载意味着停掉一个插件功能就少一半；模板更糟 ——
 * `effectiveTemplates` 的遮蔽关系会让「谁盖了谁」随启用集合漂移。所以要报出来。
 *
 * 读不出清单的插件不计（它的声明没有意义）。**被停用的插件仍然计** ——
 * 上游的模块 id 冲突与启用状态无关。
 */
export function duplicateFeatures(plugins: readonly PluginInfo[]): DuplicateFeature[] {
  // 一个入口点一个桶（键 = 类型 + 名；类型与插件 id 都不会含 NUL，直接拼即可）。
  const buckets = new Map<string, { type: PluginFeatureType; name: string; owners: Set<string> }>()
  const collect = (type: PluginFeatureType, name: string, owner: string) => {
    if (!name) return
    const key = `${type}${name}`
    let bucket = buckets.get(key)
    if (!bucket) { bucket = { type, name, owners: new Set() }; buckets.set(key, bucket) }
    bucket.owners.add(owner)
  }
  for (const plugin of plugins) {
    if (plugin.error) continue
    const owner = plugin.name || plugin.id
    for (const command of plugin.commands) collect('action', command.action, owner)
    for (const entry of plugin.templates) collect('template', entry.key, owner)
  }
  const duplicates: DuplicateFeature[] = []
  for (const bucket of buckets.values()) {
    if (bucket.owners.size < 2) continue
    duplicates.push({ type: bucket.type, name: bucket.name, plugins: [...bucket.owners].sort(compareText) })
  }
  return duplicates.sort((left, right) =>
    left.type === right.type ? compareText(left.name, right.name) : compareText(left.type, right.type))
}
