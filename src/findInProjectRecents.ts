// 工程内查找的**最近搜索**（上游 `FindInProjectSettingsBase`，
// `platform/analysis-impl/src/com/intellij/find/impl/FindInProjectSettingsBase.java:26-93`）。
//
// 上游形态逐条：
//   · 三张表（find / replace / dir），各 `MAX_RECENT_SIZE = 300`（`:27`）；
//   · `addRecentStringToList`（`:85-93`）：`remove(str)` 再 `add(str)` —— 去重是**精确匹配**，
//     最新一条在**末尾**，`getMostRecentFindString()` 取 `list.get(size - 1)`（`:77-79`）；
//   · 落盘在工程文件里（`FindInProjectRecents` 那个 `@State`）；本仓按同一族做法放 `localStorage`，
//     键 `taocode.findInProjectRecents`（与 `taocode.findHistory` / `taocode.findOptions` 同批）。
//
// 记录点（上游）：`FindManagerImpl.changeGlobalSettings`（`:116-125`）在一次查找执行后记 find、
// 替换态再记 replace；`FindPopupPanel.java:1237` 打开面板时若模型里没有查询词就用
// `getMostRecentFindString()` 预填。本仓由 `src/components/SearchPanel.vue` 在同样的两处调用。

/** `FindInProjectSettingsBase.MAX_RECENT_SIZE`（`:27`）。 */
export const MAX_RECENT_SIZE = 300

/** 本仓的持久化键（工程设置之外的本地一份，与 `taocode.findHistory` 同族）。 */
export const RECENTS_STORAGE_KEY = 'taocode.findInProjectRecents'

export interface FindInProjectRecents {
  /** 最近查找词，最新在末尾（上游 `findStrings`）。 */
  finds: string[]
  /** 最近替换词，最新在末尾（上游 `replaceStrings`）。 */
  replaces: string[]
}

export const EMPTY_RECENTS: FindInProjectRecents = Object.freeze({ finds: [], replaces: [] })

/**
 * `addRecentStringToList`（`:85-93`）：先删后追，超过 300 从头部丢。
 * 空串不进表（上游调用点都在"查找已执行"之后，字段为空时不会走到；本仓显式挡掉，免得存一堆空条目）。
 */
export function addRecent(list: readonly string[], value: string): string[] {
  if (!value) return [...list]
  const next = [...list]
  // 精确匹配、只删第一条（上游 `List.remove(Object)`；同值重复项在加载时已被 `initializeComponent` 去重）。
  const at = next.indexOf(value)
  if (at >= 0) next.splice(at, 1)
  next.push(value)
  while (next.length > MAX_RECENT_SIZE) next.shift()
  return next
}

/** `getMostRecentFindString`（`:77-79`）：空表返回空串，否则最后一条。 */
export function mostRecent(list: readonly string[]): string {
  return list.length ? list[list.length - 1]! : ''
}

/**
 * 读回存过的一份。上游 `initializeComponent`（`:39-51`）在加载时用 `LinkedHashSet` 去重
 * （保留**首次出现**的顺序），这里同样处理并按上限截断。
 */
export function parseRecents(raw: string | null | undefined): FindInProjectRecents {
  let parsed: unknown
  try { parsed = raw ? JSON.parse(raw) : null } catch { return { finds: [], replaces: [] } }
  const list = (value: unknown): string[] => {
    if (!Array.isArray(value)) return []
    const seen = new Set<string>()
    const out: string[] = []
    for (const item of value) {
      if (typeof item !== 'string' || !item || seen.has(item)) continue
      seen.add(item)
      out.push(item)
    }
    return out.slice(-MAX_RECENT_SIZE)
  }
  const record = parsed as Partial<FindInProjectRecents> | null
  return { finds: list(record?.finds), replaces: list(record?.replaces) }
}

/** 写盘前的序列化（`parseRecents` 必须能读回同一份）。 */
export function formatRecents(recents: FindInProjectRecents): string {
  return JSON.stringify({ finds: recents.finds, replaces: recents.replaces })
}
