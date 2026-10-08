// Search Everywhere 的**会话级搜索历史**（上游 `SearchHistoryList` + `HistoryIterator` +
// `SearchEverywhereManagerImpl.saveSearchText/showHistoryItem`）。
//
// 上游逐条（本机参考树 `platform/lang-impl/src/com/intellij/ide/actions/searcheverywhere/`）：
//   · `SearchHistoryList.kt:8` `HISTORY_LIMIT = 50`；表里存 `HistoryItem(searchText, contributorID)`
//     —— 历史**按 tab 分家**（`:11`），同一个词在不同 tab 各记一笔；
//   · `saveText(text, contributorID)`（`:21-33`）：先按 `(text, contributorID)` **去重删旧**，
//     再追加（`isReversedOrder=false` ⇒ 追加到尾部，最新在尾），然后**按 tab 截到 50**；
//   · `getHistoryForContributor`（`:35-44`）：All 档拿**全部**历史（跨 tab）的最后 50 条，
//     其余档只拿自己那些；`filteredHistory`（`:46-53`）最后还做一次 `distinct()`；
//   · `HistoryIterator`（`HistoryIterator.kt:10-42`）：`index` 从 **-1** 起，`prev()` 先减再取
//     （越界回绕到尾部）、`next()` 先加再取（越界回绕到头部）—— 所以**打开时 `prev()` 给的是
//     最近一条**（`SearchEverywhereManagerImpl.java:128` `searchText = myHistoryIterator.prev()`），
//     而 `next()` 从"最近一条再往前"开始（`:465-472` 的 `showHistoryItem(next)`）；
//   · 两个入口（`:423-427`）：`Alt+Down` = `next()`、`Alt+Up` = `prev()`，就是
//     `SearchTextField.SHOW_HISTORY_SHORTCUT`/`ALT_SHOW_HISTORY_SHORTCUT`
//     （`platform/platform-api/src/com/intellij/ui/SearchTextField.java:64-67`：
//     `Alt+Down` / `Alt+Up`）；
//   · 记录时机 = **关弹层时**（`:138-141` 的 `setCancelCallback` → `saveSearchText()` `:439-448`），
//     且空串不记（`:446`）。
//
// 本仓落点：本模块只放**规则**（纯函数，可单测）。UI 那一半（Alt+Up/Down 把历史填回输入框）
// 需要 `src/components/SearchEverywhereDialog.vue` 里的键盘分支 —— 那归 UI 审查 lane 独占，
// 已登记为接线请求（见本模块末尾那段与 `docs/wiring-requests-2026-10-06-b1b7verdict.md`）。

/** `SearchHistoryList.kt:8` 的 `HISTORY_LIMIT`。 */
export const SEARCH_HISTORY_LIMIT = 50

/** 一条历史（`HistoryItem`，`:14`）：词 + 记它的 tab。 */
export interface SearchHistoryItem {
  text: string
  /** 记这一笔时的 tab id（上游 `contributorID`）。 */
  tab: string
}

/** All 档的 tab id（上游 `SearchEverywhereManagerImpl.ALL_CONTRIBUTORS_GROUP_ID`）。 */
export const ALL_CONTRIBUTORS_TAB = 'all'

/**
 * `saveText`（`:21-33`）：去重删旧 → 追加到尾部 → 按 tab 截到 50。
 * 空串不入表（上游 `saveSearchText` `:446` 的 `!searchText.isEmpty()`）。
 * 返回新表（不改入参 —— 本仓状态是 Vue ref）。
 */
export function saveSearchHistory(
  history: readonly SearchHistoryItem[],
  text: string,
  tab: string,
): SearchHistoryItem[] {
  const trimmed = text.trim()
  if (!trimmed) return [...history]
  // 先按 (text, tab) 去重（`:22-24` 的 find/remove）。
  const without = history.filter(item => !(item.text === trimmed && item.tab === tab))
  without.push({ text: trimmed, tab })
  // 按 tab 截到 50：上游是从**头**删（`:29-32` 找该 tab 的第一条 remove）—— 也就是丢最旧的。
  const own = without.filter(item => item.tab === tab)
  if (own.length <= SEARCH_HISTORY_LIMIT) return without
  const drop = own.length - SEARCH_HISTORY_LIMIT
  const dropped = new Set(own.slice(0, drop))
  return without.filter(item => !dropped.has(item))
}

/**
 * `getHistoryForContributor`（`:35-44`）：某一档能看到的词表（旧 → 新）。
 * All 档 = 全部历史（跨 tab）的最后 50 条；其余档 = 自己那些；最后都 `distinct()`（`:50`）。
 */
export function searchHistoryFor(
  history: readonly SearchHistoryItem[],
  tab: string,
): string[] {
  const scoped = tab === ALL_CONTRIBUTORS_TAB
    ? history.slice(Math.max(0, history.length - SEARCH_HISTORY_LIMIT))
    : history.filter(item => item.tab === tab)
  // `:50` 的 `.distinct()`：保序去重（同一词在 All 档可能来自多个 tab）。
  const seen = new Set<string>()
  const out: string[] = []
  for (const item of scoped) {
    if (seen.has(item.text)) continue
    seen.add(item.text)
    out.push(item.text)
  }
  return out
}

/**
 * `HistoryIterator`（`HistoryIterator.kt:10-42`）的**游标**：`index` 从 -1 起，
 * `prev()` 先减再取（越界回绕到尾部）、`next()` 先加再取（越界回绕到头部）。
 * 返回 `{ index, text }`（空表给空串，与上游 `:23-25`/`:33-35` 一致）。
 */
export interface HistoryCursor {
  index: number
  text: string
}

/** `prev()`（`:33-42`）：打开弹层时取"最近一条"。 */
export function historyPrev(list: readonly string[], index: number): HistoryCursor {
  if (!list.length) return { index, text: '' }
  let next = index - 1
  if (next < 0) next = list.length - 1
  return { index: next, text: list[next]! }
}

/** `next()`（`:23-31`）：Alt+Down 往后走，越界回绕到头部。 */
export function historyNext(list: readonly string[], index: number): HistoryCursor {
  if (!list.length) return { index, text: '' }
  let next = index + 1
  if (next >= list.length) next = 0
  return { index: next, text: list[next]! }
}

/** 打开弹层时该预填的词（`SearchEverywhereManagerImpl.java:128` 的 `myHistoryIterator.prev()`）。 */
export function historyOpenText(history: readonly SearchHistoryItem[], tab: string): string {
  const list = searchHistoryFor(history, tab)
  return list.length ? list[list.length - 1]! : ''
}

/** 一个 tab 的历史（`HistoryIterator` 的身份）：换 tab 就换游标（`:484-489` 的 `updateHistoryIterator`）。 */
export function historyCursorFor(history: readonly SearchHistoryItem[], tab: string): { list: string[]; cursor: HistoryCursor } {
  const list = searchHistoryFor(history, tab)
  return { list, cursor: { index: -1, text: '' } }
}

// ── 持久化（本仓形态；上游是 `SearchEverywhereManagerImpl` 的 properties 存档）──────────────
//
// 上游 `SearchEverywhereManagerImpl` 的历史存在应用级组件里（`SearchHistoryList` 的实例），
// 本仓没有组件容器，按既有一族做法存 `localStorage`（`taocode.findHistory`/`taocode.findReplaceHistory`
// 同族）。读/存都做防御：坏存档按空表，只收形状合法的条目。

/** 本仓的持久化键。 */
export const SEARCH_EVERYWHERE_HISTORY_KEY = 'taocode.searchEverywhereHistory'

/** 解析存档（坏 JSON / 非数组 / 坏条目一律丢弃，不抛）。 */
export function parseSearchHistory(raw: string | null | undefined): SearchHistoryItem[] {
  if (!raw) return []
  let value: unknown
  try { value = JSON.parse(raw) } catch { return [] }
  if (!Array.isArray(value)) return []
  const out: SearchHistoryItem[] = []
  for (const entry of value) {
    if (!entry || typeof entry !== 'object') continue
    const item = entry as Record<string, unknown>
    if (typeof item.text !== 'string' || typeof item.tab !== 'string') continue
    if (!item.text.trim()) continue
    out.push({ text: item.text, tab: item.tab })
  }
  return out.slice(-SEARCH_HISTORY_LIMIT)
}

/** 序列化（写 `localStorage` 之前）。 */
export function serializeSearchHistory(history: readonly SearchHistoryItem[]): string {
  return JSON.stringify(history)
}

/** 读存档（SSR/Node 无 localStorage 时给空表）。 */
export function loadSearchHistory(): SearchHistoryItem[] {
  try {
    if (typeof localStorage === 'undefined') return []
    return parseSearchHistory(localStorage.getItem(SEARCH_EVERYWHERE_HISTORY_KEY))
  } catch { return [] }
}

/** 写存档（存不了就只在内存里 —— 与 `src/keymapEditor.ts` 同一条防御）。 */
export function storeSearchHistory(history: readonly SearchHistoryItem[]): void {
  try {
    if (typeof localStorage === 'undefined') return
    localStorage.setItem(SEARCH_EVERYWHERE_HISTORY_KEY, serializeSearchHistory(history))
  } catch { /* 存不了就只在内存里 */ }
}