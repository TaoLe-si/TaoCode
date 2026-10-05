// 日志过滤的持久化 —— 上游 `VcsLogUiPropertiesImpl`（`logUiState[filterName] = values`，
// 过滤值按 log UI 存进工程级状态），所以关掉再打开日志窗口时过滤条件还在。
//
// 上游把这一族摊在**三个** OptionTag 里：`FILTERS`（`VcsLogUiPropertiesImpl.kt:139-140`）、
// `GRAPH_OPTIONS`（`:127-128`）、`TEXT_FILTER_SETTINGS`（`:142-143`）。三者在同一个
// log UI 状态对象上，本仓合成一条 `localStorage` 记录（与列显隐/分栏比例同一族键，
// 见 VcsLog.vue 的 `taocode.vcs.log.<root>.*`）。这里只做**纯整形**：GitLogQuery ↔ 稳定 JSON。
// 两点口径：
//   · 只存非空字段，空字符串/空数组/关着的开关不进存档（否则"清除过滤"会在存档里留一堆空壳）；
//   · 读回时逐字段校验类型与条数（refs 上限与原生 `git.logFull` 的 100 一致），
//     坏存档一律退化成"没有过滤"而不是把垃圾喂给宿主。
//
// 开关的**缺省**不是"关"：`textRegex`/`matchCase` 缺省 false（`VcsLogUiPropertiesImpl`
// 的 `TextFilterSettings.isRegex/isMatchCase`），`sort` 缺省 `date`
// （`PermanentGraph.Options.Default = Base(SortType.Normal)`）。所以只有真的打开的开关
// 才进存档，`parseLogQuery` 读回来时缺省即上游缺省。

import type { GitLogQuery, GitLogSort } from './bridge'

/** refs 上限：与 `native/git_log.cpp` 的 `refs 必须是最多 100 项` 一致。 */
export const MAX_STORED_REFS = 100
/** 单个字符串字段的长度上限：过滤词是用户手输的，超长的直接判坏存档。 */
export const MAX_FILTER_TEXT = 500

/** 存档键（与 VcsLog.vue 的列/分栏键同一前缀，按仓库根区分）。 */
export function logFilterStorageKey(root: string): string {
  return `taocode.vcs.log.${encodeURIComponent(root)}.filters`
}

const TEXT_KEYS = ['text', 'author', 'since', 'until', 'path'] as const
/** 三个开关：值与键名一一对应，`true` 才进存档。 */
const FLAG_KEYS = ['textRegex', 'matchCase', 'firstParent', 'noMerges'] as const
/** 排序档的取值；`date` 是上游缺省（`PermanentGraph.Options.Default`），不记进存档。 */
const SORTS: readonly GitLogSort[] = ['topological']

/** 是否为空过滤（没有一条有效字段）。开了图选项的开关就是"有过滤"。 */
export function isEmptyLogQuery(query: GitLogQuery): boolean {
  return !TEXT_KEYS.some(key => Boolean(query[key]?.trim()))
    && !(query.refs ?? []).some(ref => ref.trim())
    && !FLAG_KEYS.some(key => query[key])
    && !SORTS.includes(query.sort as GitLogSort)
}

function cleanRefs(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return value.filter((item): item is string => typeof item === 'string' && item.trim() !== '')
    .map(item => item.trim()).slice(0, MAX_STORED_REFS)
}

/** 稳定序列化：字段顺序固定，只写非空项。 */
export function serializeLogQuery(query: GitLogQuery): string {
  const stored: Record<string, unknown> = {}
  for (const key of TEXT_KEYS) {
    const value = query[key]
    if (typeof value === 'string' && value.trim() !== '' && value.length <= MAX_FILTER_TEXT) stored[key] = value
  }
  const refs = cleanRefs(query.refs)
  if (refs.length) stored.refs = refs
  for (const key of FLAG_KEYS) if (query[key] === true) stored[key] = true
  if (SORTS.includes(query.sort as GitLogSort)) stored.sort = query.sort
  return JSON.stringify(stored)
}

/** 读回：坏 JSON / 坏字段全部丢掉，返回的一定是合法的 GitLogQuery。 */
export function parseLogQuery(raw: string | null | undefined): GitLogQuery {
  if (!raw) return {}
  let parsed: unknown
  try { parsed = JSON.parse(raw) } catch { return {} }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {}
  const source = parsed as Record<string, unknown>
  const query: GitLogQuery = {}
  for (const key of TEXT_KEYS) {
    const value = source[key]
    if (typeof value === 'string' && value.trim() !== '' && value.length <= MAX_FILTER_TEXT) query[key] = value
  }
  const refs = cleanRefs(source.refs)
  if (refs.length) query.refs = refs
  for (const key of FLAG_KEYS) if (source[key] === true) query[key] = true
  if (SORTS.includes(source.sort as GitLogSort)) query.sort = source.sort as GitLogSort
  return query
}
