// 编辑器查找栏的**替换历史**（上游 `SearchTextArea.ShowHistoryAction`，
// `platform/lang-impl/src/com/intellij/find/SearchTextArea.java:396-421`）。
//
// 上游形态逐条：
//   · 输入框上那个动作的标题按当前模式取 `find.search.history` / `find.replace.history`
//     （`:397-398`；中文包 =「搜索历史记录」/「替换历史记录」，两者都是 `FindBundle.properties`）；
//   · 它读的是 `FindInProjectSettings.getRecentFindStrings()` / `getRecentReplaceStrings()`
//     （`:412-413`）—— 两张**各管各**的表，替换历史与查找历史不混在一起；
//   · 表本身是 `FindInProjectSettingsBase` 的 `replaceStrings`：`addStringToReplace` 先删后追、
//     上限 300（`FindInProjectSettingsBase.java:22,27,73-90`）。
//
// 本仓的落点：编辑器栏的历史一直是**本地一份**（`src/editorFindController.ts` 的
// `taocode.findHistory`，上限 20），工程内那侧的 300 上限表在 `src/findInProjectRecents.ts`。
// 换历史按同一条本地路子补：键 `taocode.findReplaceHistory`、上限与查找历史一致（20）、
// 最新在**最前**（栏里的下拉直接按数组顺序画，与 `state.history` 同序）。
// 读/存都做防御：坏存档按空表，空串不入表（上游 `addRecentStringToList` 对 null 直接返回，
// 本仓对空串同样不入）。

/** 本仓的持久化键（与 `taocode.findHistory` 同族，见文件头）。 */
export const REPLACE_HISTORY_KEY = 'taocode.findReplaceHistory'

/** 上限与编辑器栏的查找历史一致（`src/editorFindController.ts` 的 `HISTORY_LIMIT = 20`）。 */
export const REPLACE_HISTORY_LIMIT = 20

/**
 * 记一条替换词：先删同值、再插到最前，超出上限从尾部丢。
 * 空串不入表（上游 `addRecentStringToList` 的 null 分支的等价物：没东西可记就什么都不做）。
 */
export function pushReplaceHistory(list: readonly string[], value: string): string[] {
  if (!value) return [...list]
  const next = list.filter(item => item !== value)
  next.unshift(value)
  while (next.length > REPLACE_HISTORY_LIMIT) next.pop()
  return next
}

/** 读回存档；坏 JSON / 非字符串项 / 空串都丢掉，并按上限截断。 */
export function parseReplaceHistory(raw: string | null | undefined): string[] {
  let parsed: unknown
  try { parsed = raw ? JSON.parse(raw) : null } catch { return [] }
  if (!Array.isArray(parsed)) return []
  const seen = new Set<string>()
  const out: string[] = []
  for (const item of parsed) {
    if (typeof item !== 'string' || !item || seen.has(item)) continue
    seen.add(item)
    out.push(item)
    if (out.length >= REPLACE_HISTORY_LIMIT) break
  }
  return out
}

/** 从 `localStorage` 读（`window` 不在时按空表 —— 单测/SSR 环境没有它）。 */
export function readReplaceHistory(): string[] {
  if (typeof localStorage === 'undefined') return []
  try { return parseReplaceHistory(localStorage.getItem(REPLACE_HISTORY_KEY)) } catch { return [] }
}

/** 写回 `localStorage`；写不进去（无 window / 隐私模式）就当会话内历史，不抛。 */
export function writeReplaceHistory(list: readonly string[]): void {
  if (typeof localStorage === 'undefined') return
  try { localStorage.setItem(REPLACE_HISTORY_KEY, JSON.stringify(list)) } catch { /* session-only */ }
}
