// 提交面板那两个开关的**跨会话存档** —— 上游 `ChangesViewSettings`
// （`platform/vcs-impl/shared/src/com/intellij/platform/vcs/impl/shared/changes/ChangesViewSettings.kt`）。
//
// 上游形状（逐条核过）：
//   · 接口 `ChangesViewSettings`（`:17-25`）只有两个字段：`groupingKeys: Collection<String>`
//     与 `showIgnored: Boolean`；
//   · 实现 `ChangesViewSettingsImpl`（`:27-47`）是 `SimplePersistentStateComponent`，注解
//     `@State(name = "ChangesViewManager", storages = [Storage(StoragePathMacros.WORKSPACE_FILE)])`
//     （`:27`）—— 落在**工程工作区文件**里，所以是**按工程（工作区根）**存的，不是应用级；
//   · 两个缺省（`:43`、`:46`）：`groupingKeys` 缺省 `setOf(ChangesGroupingSupport.REPOSITORY_GROUPING)`、
//     `showIgnored` 缺省 `false`。注意缺省是**按仓库分组**，而本仓只有一个仓库
//     （理由逐条写在 `src/changesGrouping.ts` 的文件头：分出来永远一组），
//     所以本仓的等价缺省是**不分组**——见 `DEFAULT_GROUPING_KEYS` 的注释；
//   · `groupingKeys` 是**集合**语义（`toMutableSet()` / `stringSet`，`:32`、`:43`），多条可共存
//     （上游目录+模块+仓库可以叠加）。本仓 `ChangesGroupBy` 是互斥单选（只有「不分组」「目录」
//     两档），所以存档里仍按**集合**存，读回时取第一条已知键 —— 形状对齐上游，将来加档不用改存档格式。
//
// 本仓的存储通道：`localStorage`，键按工作区根分 —— 与日志窗口那一族
// （`src/vcsLogFilterStore.ts` 的 `taocode.vcs.log.<root>.*`、VcsLog.vue 的列/分栏键）同一套口径，
// 对应上游的 `WORKSPACE_FILE`（都是"跟着工程走"，都不是应用级）。
// 读侧对坏存档一律退回缺省，绝不抛（与 `vcsLogFilterStore.parseLogQuery` 同一纪律）。

import type { ChangesGroupBy } from './changesGrouping'

/** 存档键（对应上游 `@State(name = "ChangesViewManager")`，按工作区根区分）。 */
export function changesViewSettingsKey(workspaceRoot: string): string {
  return `taocode.vcs.changesView.${encodeURIComponent(workspaceRoot)}`
}

/** 上游 `ChangesGroupingSupport.REPOSITORY_GROUPING` 的键名（`ChangesViewSettings.kt:43`）。 */
export const REPOSITORY_GROUPING_KEY = 'ChangesView.GroupBy.Repository'
/** `ChangesView.GroupBy.Directory`（`intellij.platform.vcs.impl.shared.xml:134`）。 */
export const DIRECTORY_GROUPING_KEY = 'ChangesView.GroupBy.Directory'

/**
 * 本仓的缺省分组键集合。上游缺省是 `{REPOSITORY_GROUPING}`（`:43`），本仓的等价缺省是**空集**
 * （= 不分组）：`changesGrouping.ts` 的文件头逐条记了为什么「仓库」这一档在本仓分出来永远一组，
 * 与其留一个永远只有一组的档，不如显式不分组。存档里读到 `REPOSITORY_GROUPING` 时同样按空集处理。
 */
export const DEFAULT_GROUPING_KEYS: readonly string[] = []

/** 存档里认识的键 → 本仓那一档。未知键（含上游那两档本仓没有的）按"忽略"处理。 */
const KNOWN_KEYS: ReadonlyMap<string, ChangesGroupBy> = new Map([
  [DIRECTORY_GROUPING_KEY, 'directory'],
])

/** 两项设置（对应上游 `ChangesViewSettings` 的两个字段）。 */
export interface ChangesViewSettings {
  /** 分组键集合（上游是 `Collection<String>`；本仓读回时折成互斥的那一档）。 */
  groupingKeys: readonly string[]
  /** 「显示忽略的文件」。 */
  showIgnored: boolean
}

/** 缺省设置（`ChangesViewSettings.kt:43` + `:46`，理由见 `DEFAULT_GROUPING_KEYS`）。 */
export function defaultChangesViewSettings(): ChangesViewSettings {
  return { groupingKeys: [...DEFAULT_GROUPING_KEYS], showIgnored: false }
}

/** 分组键集合 → 本仓那一档（取第一条已知键；没有已知键 = 不分组）。 */
export function groupByOfKeys(keys: readonly string[]): ChangesGroupBy {
  for (const key of keys) {
    const known = KNOWN_KEYS.get(key)
    if (known) return known
  }
  return 'none'
}

/** 本仓那一档 → 分组键集合（「不分组」= 空集，照上游"没有键就是不分组"的口径）。 */
export function keysOfGroupBy(groupBy: ChangesGroupBy): string[] {
  return groupBy === 'none' ? [] : [groupBy === 'directory' ? DIRECTORY_GROUPING_KEY : REPOSITORY_GROUPING_KEY]
}

const MAX_KEYS = 16

/**
 * 稳定序列化：`{groupingKeys, show_ignored}`，只写非缺省项
 * （`show_ignored` 用上游 `@Attribute("show_ignored")` 的属性名，`:45`）。
 * 全是缺省时写空串 —— 与「清除过滤」在 `vcsLogFilterStore` 里的做法一致，不在存档里留空壳。
 */
export function serializeChangesViewSettings(settings: ChangesViewSettings): string {
  const stored: Record<string, unknown> = {}
  if (settings.groupingKeys.length) stored.groupingKeys = [...settings.groupingKeys].slice(0, MAX_KEYS)
  if (settings.showIgnored) stored.show_ignored = true
  return Object.keys(stored).length ? JSON.stringify(stored) : ''
}

/** 从存档读回；坏存档退回缺省（永不抛）。 */
export function parseChangesViewSettings(raw: string | null | undefined): ChangesViewSettings {
  if (!raw) return defaultChangesViewSettings()
  try {
    const parsed = JSON.parse(raw) as { groupingKeys?: unknown; show_ignored?: unknown; showIgnored?: unknown }
    const keys = Array.isArray(parsed?.groupingKeys)
      ? parsed.groupingKeys.filter((key): key is string => typeof key === 'string' && key !== '').slice(0, MAX_KEYS)
      : [...DEFAULT_GROUPING_KEYS]
    // 两个拼写都收：`show_ignored` 是上游属性名，`showIgnored` 是 Kotlin 字段名。
    const flag = parsed?.show_ignored ?? parsed?.showIgnored
    return { groupingKeys: keys, showIgnored: flag === true }
  } catch {
    return defaultChangesViewSettings()
  }
}
