// 插件声明的**文件类型**（上游 `com.intellij.fileType` 扩展点 = `FileTypeBean` 那一条）在本仓的装载链。
//
// 上游形状（`platform/platform-impl/src/com/intellij/openapi/fileTypes/impl/FileTypeBean.java`）：
//   · 一个 `<fileType>` 标签有两种用法（`:26-43` 的类注释）：带 `implementationClass` = **声明一个新类型**
//     （`:29-30`），只给 `name` + 关联属性、省掉 `implementationClass` = **给别的插件已经声明的类型补关联**
//     （`:36-41`，被引用的类型必须已由别的标签注册，标签顺序无所谓）—— 这两档的口径**不能混**：
//     前者才有类实现，后者只是往已有类型上挂匹配器；
//   · 关联属性四个，都是**分号分隔**：`extensions`（`:101`）/ `fileNames`（`:108`）/
//     `patterns`（`:116`，「模式按文件名匹配、不能含 `/`」写在 `:114`）/
//     `fileNamesCaseInsensitive`（`:123`）；「只按**文件名**匹配」是 `:46-48` 那句；
//     `hashBangs`（`:144`）是唯一看内容的那一条，且**排在最后**：`FileTypeBean.java:140-143`
//     明确写它「在所有按名字的关联与所有 `FileTypeDetector` 都失败之后」才用；
//   · `name` 全 IDE 唯一，**两个类型重名是错误**（`:51-54`，装载时报 `PluginException`），
//     而 `name` 本身是 `@RequiredElement`（`:93`）；
//   · 声明方插件跟着走（`PluginAware`，`:59`）：冲突审批比厂商（`ConflictingFileTypeMappingTracker.java:107-114`），
//     覆盖列表拼「来自插件 X」的提示（`OverrideFileTypeAction.java:64-72`）。
//
// 本仓的等价物：插件清单 `plugin.json` 的 `contributes.fileTypes`（`native/plugins.cpp` 的
// `read_file_types` 解析，字段名与上游属性一一对应），装载时按上面两种用法灌进
// `src/fileTypeRegistry.ts` 那张进程内注册表；插件停用/卸载/清单坏掉时**连带回收**它贡献的
// 类型与关联（上游插件不加载就不再贡献，本仓同样不能留着）。
//
// 消费链路：
//   · `src/components/PluginDialog.vue` —— 启用/禁用/安装/卸载后立刻重算（下一次打开文件类型页
//     或试判某个文件时就能看到差别）；
//   · `src/fileTypeDetection.ts` —— 注册表就是它的判定来源；
//   · `src/fileTypeOverrides.ts` 的覆盖列表 —— 类型带上了插件厂商，重名时才填得出
//     「来自插件 X」那句（上游 `OverrideFileTypeAction.java:64-72`）。
import {
  fileTypeManager,
  parseFileTypeBean,
  presentableMatcher,
  STANDARD_FILE_TYPES,
  type FileNameMatcher,
  type FileTypeBeanSpec,
  type FileTypeConflict,
} from './fileTypeRegistry.ts'

/** 清单里的一条文件类型声明（字段名 = 上游 `FileTypeBean` 的 `@Attribute`）。 */
export interface PluginFileTypeBean extends FileTypeBeanSpec {}

/** `applyPluginFileTypes` 需要的最小插件形状（`PluginInfo` 天然满足，不必反向 import 插件模块）。 */
export interface PluginFileTypeSource {
  id: string
  name: string
  enabled?: boolean
  error?: string
  broken?: string
  fileTypes?: PluginFileTypeBean[]
}

/** 一次贡献的记录，插件停用/卸载时按它原样收回。 */
interface Contribution {
  pluginId: string
  pluginName: string
  typeId: string
  /** `type` = 这个类型是该插件带进来的（收回时整个注销）；`association` = 只是给已有类型补的关联。 */
  kind: 'type' | 'association'
  /** 登记时那份匹配子的**快照**：只被遍历（撤贡献时逐条 `removeAssociation`），从不原地改 ⇒ 只读。 */
  readonly matchers: readonly FileNameMatcher[]
  hashBangs: string[]
}

/** 一个插件的清单能不能被加载（与 `src/pluginInfo.ts` 的 `pluginLoadingError` 同口径的三条）。 */
export function pluginIsLoadable(plugin: PluginFileTypeSource): boolean {
  if (plugin.error) return false
  if (plugin.broken) return false
  return plugin.enabled !== false
}

const contributions = new Map<string, Contribution>()

function key(pluginId: string, typeName: string): string {
  return `${pluginId}\u0000${typeName}`
}

/** 平台自带的类型不能被插件贡献挤掉（上游重名时是 `PluginException`，本仓同样拒绝）。 */
function isStandardType(id: string): boolean {
  return STANDARD_FILE_TYPES.some(type => type.id === id)
}

/** 一次装载的结果，设置页与插件页都能拿它说一句人话。 */
export interface PluginFileTypeReport {
  /** 这次注册进来的类型（含只补关联的贡献）。 */
  added: { pluginName: string; typeName: string; kind: 'type' | 'association'; associations: string[] }[]
  /** 这次收回的类型/关联。 */
  removed: { typeName: string; kind: 'type' | 'association'; associations: string[] }[]
  /** 重名被拒的声明（上游 `:49-54` 那条错误）。 */
  rejected: { typeName: string; pluginName: string; reason: string }[]
  /** 装载过程中判出的关联冲突（上游 `ConflictingFileTypeMappingTracker` 的那一条链）。 */
  conflicts: FileTypeConflict[]
}

/**
 * 按当前插件集合重算文件类型注册表（幂等：同一份清单连调两次不会重复认领）。
 * `plugins` 是**整张**插件列表 —— 收回与认领都要看全表，才能发现「这个插件刚才被停用了」。
 */
export function applyPluginFileTypes(plugins: readonly PluginFileTypeSource[]): PluginFileTypeReport {
  const report: PluginFileTypeReport = { added: [], removed: [], rejected: [], conflicts: [] }
  const desired = new Map<string, { plugin: PluginFileTypeSource; bean: PluginFileTypeBean }>()
  const claimedNames = new Map<string, string>()   // 类型名 → 声明它的插件 id（重名判定用）

  for (const plugin of plugins) {
    if (!pluginIsLoadable(plugin)) continue
    for (const bean of plugin.fileTypes ?? []) {
      const typeName = (bean.name ?? '').trim()
      if (!typeName) {
        // 上游 `name` 是 `@RequiredElement`（`FileTypeBean.java:93`），缺它的标签装载即失败。
        report.rejected.push({ typeName: '(没有 name 的声明)', pluginName: plugin.name || plugin.id, reason: '文件类型声明缺少必填的 name。' })
        continue
      }
      const holder = claimedNames.get(typeName)
      if (holder && holder !== plugin.id) {
        // 上游：两个 `<fileType>` 用同一个 name 是错误（`FileTypeBean.java:52-53`；同一句 javadoc 的
        // `:49-51` 说的正是装载时报 `PluginException`），
        // 后到的那条装载失败。本仓同样只让第一条生效，并把这条列出来。
        report.rejected.push({
          typeName,
          pluginName: plugin.name || plugin.id,
          reason: `已经有插件声明了「${typeName}」这个文件类型，同一个名字只能有一个类型。`,
        })
        continue
      }
      claimedNames.set(typeName, plugin.id)
      desired.set(key(plugin.id, typeName), { plugin, bean })
    }
  }

  // 先收回已经不需要的（顺序很重要：`*.foo` 从 A 抢给 B 时，A 是插件类型就整体注销，
  // 若先认领再收回会把 B 刚拿到的关联一起删掉）。
  for (const [mapKey, contribution] of [...contributions]) {
    if (desired.has(mapKey)) continue
    contributions.delete(mapKey)
    report.removed.push(retract(contribution))
  }

  // 再认领新的。
  for (const [mapKey, entry] of desired) {
    if (contributions.has(mapKey)) continue
    const { plugin, bean } = entry
    const typeName = (bean.name ?? '').trim()
    if (isStandardType(typeName) && bean.implementationClass) {
      // 插件想**替换**平台自带的类型：上游会因重名直接报 `PluginException`，本仓同样拒绝
      // （标准类型表是编译期那张，没有类加载可以替换）。
      report.rejected.push({ typeName, pluginName: plugin.name || plugin.id, reason: '「' + typeName + '」是平台自带的类型，插件不能重新声明它。' })
      continue
    }
    const existed = fileTypeManager.getType(typeName) !== null
    let parsed
    try {
      parsed = parseFileTypeBean(bean)
    } catch (error) {
      report.rejected.push({ typeName: typeName || '(无名声明)', pluginName: plugin.name || plugin.id, reason: String(error instanceof Error ? error.message : error) })
      continue
    }
    const matchers = parsed.descriptor.matchers ?? []
    const conflict = fileTypeManager.registerBean(bean, {
      // 声明方插件名进 `vendor`：上游 `PluginAware` 带的就是这个（`FileTypeBean.java:59`
      // 的 `implements PluginAware`，取用口在 `:156-164`），
      // 冲突审批比厂商（`ConflictingFileTypeMappingTracker.java:107-108`）与覆盖列表的
      // 「来自插件 X」提示（`OverrideFileTypeAction.java:64-72`）都读它。
      bundled: false,
      core: false,
      vendor: plugin.name || plugin.id,
    })
    const hashBangs = parsed.hashBangs.filter(pattern => fileTypeManager.addHashBangPattern(typeName, pattern) === null)
    contributions.set(mapKey, {
      pluginId: plugin.id,
      pluginName: plugin.name || plugin.id,
      typeId: typeName,
      // 带 `implementationClass` = 新类型；否则是「给已有类型补关联」（`:36-41`）。
      kind: bean.implementationClass && !existed ? 'type' : 'association',
      matchers,
      hashBangs,
    })
    report.conflicts.push(...conflict)
    report.added.push({
      pluginName: plugin.name || plugin.id,
      typeName,
      kind: bean.implementationClass && !existed ? 'type' : 'association',
      associations: [...matchers.map(matcher => presentableMatcher(matcher)), ...hashBangs.map(pattern => `#!${pattern}`)],
    })
  }
  return report
}

/** 收回一条贡献（类型整体注销，或把补的关联与 hashbang 逐条摘掉）。 */
function retract(contribution: Contribution): { typeName: string; kind: 'type' | 'association'; associations: string[] } {
  const associations = [
    ...contribution.matchers.map(matcher => presentableMatcher(matcher)),
    ...contribution.hashBangs.map(pattern => `#!${pattern}`),
  ]
  if (contribution.kind === 'type' && !isStandardType(contribution.typeId)) {
    fileTypeManager.unregister(contribution.typeId)
    return { typeName: contribution.typeId, kind: 'type', associations }
  }
  for (const matcher of contribution.matchers) fileTypeManager.removeAssociation(contribution.typeId, matcher, true)
  for (const pattern of contribution.hashBangs) fileTypeManager.removeHashBangPattern(contribution.typeId, pattern)
  return { typeName: contribution.typeId, kind: 'association', associations }
}

/** 当前由插件带进来的类型（文件类型页据此标「来自插件」，也是本模块的真实状态出口）。 */
export function pluginFileTypeContributions(): { pluginName: string; typeName: string; kind: 'type' | 'association' }[] {
  return [...contributions.values()].map(entry => ({ pluginName: entry.pluginName, typeName: entry.typeId, kind: entry.kind }))
}

/** 一个类型名是谁（哪个插件）带来的；不是插件带来的返回空串。 */
export function pluginFileTypeOwner(typeName: string): string {
  for (const entry of contributions.values()) if (entry.typeId === typeName) return entry.pluginName
  return ''
}

/** 清空记账（测试与「重建设置页」用；不动注册表本身）。 */
export function resetPluginFileTypeContributions(): void {
  contributions.clear()
}
