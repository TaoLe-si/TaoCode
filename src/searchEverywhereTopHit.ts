// Search Everywhere 的 **Top Hit 分组**（上游
// `platform/lang-impl/src/com/intellij/ide/actions/searcheverywhere/TopHitSEContributor.java`）。
//
// 上游那一档的形状（逐条抄）：
//   · 元素优先级 `TOP_HIT_ELEMENT_PRIORITY = 15000`（`:53`），`getElementPriority()`
//     对**每个**元素都返回它（`:129-131`）—— 所以 Top Hit 永远排在其它供给者的条目之上，
//     不是"分数高一点"而是压到另一个数轴上；
//   · 组名 `IdeBundle.message("search.everywhere.group.name.top.hit")`（`:73`），
//     中文包里是「点击最多」（`localization-zh` 的 `messages/IdeBundle.properties:2313`，
//     英文原文 `platform/platform-api/resources/messages/IdeBundle.properties:1809` `Top Hit`）；
//   · 供给者自己的排序权重 `getSortWeight() = 50`（`:77-79`）；
//   · `showInFindResults() = false`（`:81-83`）—— 这一档**不进**「在文件中查找」的
//     贡献者列表；
//   · 取候选的两条路（`:137-160`）：先 `fillActions`（按 **缩写** 找动作，
//     `AbbreviationManager.findActions(pattern)`），命中了就**不再**问扩展点；
//     否则 `fillFromExtensions`：逐个 `SearchTopHitProvider.consumeTopHits(pattern, …)`，
//     下游 processor 返回 false 就整条中断（`:153-157`）；
//   · 前缀让位：查询词以 `getTopHitAccelerator()` 开头且不含空格时直接不填
//     （`:138-140`）—— 那是"用户在按 Top Hit 的加速键"，让给别的档。
//
// 本仓的等价物：没有 `AbbreviationManager`（动作缩写表），也没有
// `SearchTopHitProvider` 扩展点；但"用户点得最多的那几条"是有真实数据的 ——
// 本仓已经在 `localStorage` 里记 SE 的选中历史（见 `recordEverywhereUsage`）。
// 所以这里做的是**同一套分组与优先级规则**，候选来源换成本仓真实存在的"点得最多"表：
//   · 优先级常量与组名照抄（15000 / 「点击最多」）；
//   · 只在查询词非空时给 Top Hit（空查询时上游也是按 pattern 问扩展点，没有 pattern 就没候选）；
//   · 条数上限由调用方给（本仓用 `SEARCH_EVERYWHERE_LIMIT` 的一小截）。

/** `TopHitSEContributor.java:53`。 */
export const TOP_HIT_ELEMENT_PRIORITY = 15000
/** `TopHitSEContributor.java:77-79`。 */
export const TOP_HIT_SORT_WEIGHT = 50
/** `TopHitSEContributor.java:81-83`：这一档不进「在文件中查找」。 */
export const TOP_HIT_SHOW_IN_FIND_RESULTS = false
/** 组名：zh `IdeBundle.properties:2313`（英文 `:1809` `Top Hit`）。 */
export const TOP_HIT_GROUP_NAME = '点击最多'
/** 一条最多顶几级 Top Hit（上游没有硬上限，本仓给一个：Top Hit 挤满列表就没别的可看了）。 */
export const TOP_HIT_LIMIT = 3

const USAGE_KEY = 'taocode.searchEverywhere.usage'

export interface UsageEntry {
  id: string
  title: string
  source: string
  count: number
}

/** 纯合并：同 id 计数 +1，按"点得多 → 最近"排序，截到上限。 */
export function mergeUsage(existing: readonly UsageEntry[], id: string, title: string, source: string, limit = 40): UsageEntry[] {
  const hit = existing.find(entry => entry.id === id)
  const rest = existing.filter(entry => entry.id !== id)
  const next: UsageEntry = { id, title, source, count: (hit?.count ?? 0) + 1 }
  return [next, ...rest.sort((a, b) => b.count - a.count)].slice(0, limit)
}

export function loadUsage(): UsageEntry[] {
  try {
    const raw = typeof localStorage === 'undefined' ? null : localStorage.getItem(USAGE_KEY)
    const parsed = raw ? JSON.parse(raw) : []
    if (!Array.isArray(parsed)) return []
    return parsed.filter((entry): entry is UsageEntry =>
      Boolean(entry) && typeof entry.id === 'string' && typeof entry.count === 'number')
  } catch {
    return []
  }
}

/** 选中一条就记一次（`open()` 的副作用；记不上不影响本次打开）。 */
export function recordEverywhereUsage(entry: Pick<UsageEntry, 'id' | 'title' | 'source'>): UsageEntry[] {
  const next = mergeUsage(loadUsage(), entry.id, entry.title, entry.source)
  try {
    if (typeof localStorage !== 'undefined') localStorage.setItem(USAGE_KEY, JSON.stringify(next))
  } catch { /* 存不下只是下次没有 Top Hit。 */ }
  return next
}

/**
 * 顶到列表最前面的那几条（同一份 `items` 里按 id 命中"点得最多"表）。
 *
 * `matches` 用调用方给的判定（本仓 = 标题里含查询词，大小写不敏感）——
 * 上游那条"缩写优先"在这里没有对应物，所以不假装支持。
 */
export function topHitIds<T extends { id: string; title: string; source: string }>(
  items: readonly T[],
  usage: readonly UsageEntry[],
  query: string,
  limit = TOP_HIT_LIMIT,
): Set<string> {
  const needle = query.trim().toLowerCase()
  if (!needle) return new Set()
  const byId = new Map(items.map(item => [item.id, item]))
  const out = new Set<string>()
  for (const entry of [...usage].sort((a, b) => b.count - a.count)) {
    const item = byId.get(entry.id)
    if (!item) continue
    if (!item.title.toLowerCase().includes(needle)) continue
    out.add(entry.id)
    if (out.size >= limit) break
  }
  return out
}

/**
 * 把 Top Hit 钉在最前：其它条目的相对顺序不动（上游靠 `getElementPriority` 而不是重打分，
 * `:129-131` 对每个元素返回同一个常数）。
 */
export function pinTopHits<T extends { id: string }>(items: readonly T[], top: ReadonlySet<string>): T[] {
  if (!top.size) return [...items]
  return [...items.filter(item => top.has(item.id)), ...items.filter(item => !top.has(item.id))]
}
