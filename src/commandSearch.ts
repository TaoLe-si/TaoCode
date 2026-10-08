// IDEA's "Find Action" matching: a query has to appear as a subsequence, hits at the
// start of a word count for more, and a Latin alias (keywords) beats nothing at all.
// Kept separate from App.vue so the ranking can be checked without a DOM.
//
// **2026-10-06 本 lane 补**：这里还是 `com.intellij.gotoActionAliasMatcher` 的消费点 ——
// 名字/关键字两档都没命中时问一遍按 id 挂的别名匹配器（上游 `GotoActionModel.actionMatches`
// `:523-540` 的判定顺序：名字 → 描述 → 分组 → 别名），命中按 `MatchMode` 档位给分。
// 声明、six 档值与 `MatchMode.java:4` 的出处见 `src/ideShellExtensionPoints.ts`。
// bundled 匹配器恒 `NONE` ⇒ 没有第三方挂进来时打分与本文件此前逐字相同。
import { actionAliasMatch, aliasMatchScore, type GotoActionMatchMode } from './ideShellExtensionPoints.ts'

export interface Searchable {
  title: string
  keywords?: string
  /** 动作 id / 分组 / 描述（别名匹配器要它们；不给就走本仓原来的两档打分）。 */
  id?: string
  group?: string
  description?: string
}

const wordStarts = (value: string) => {
  const starts = new Set<number>([0])
  for (let index = 0; index < value.length; ++index)
    if (/\s|[（(/·]/.test(value[index]!)) starts.add(index + 1)
  return starts
}

/** Higher is better; 0 means the query does not match. */
export function scoreCommand(query: string, item: Searchable): number {
  const needle = query.trim().toLowerCase()
  if (!needle) return 1
  return Math.max(match(needle, item.title, 4), match(needle, item.keywords ?? '', 1), aliasScore(needle, item))
}

/**
 * 别名那一档（`com.intellij.gotoActionAliasMatcher`）：**任一**匹配器认了就算命中，
 * 按 `MatchMode` 给分 —— 刻意压在名字档（`60+`）之下：别名不该盖过可见文案
 * （与关键字档 `weight < 4` 的减分同一取向，上游 `MatchMode.SYNONYM` 也是最后那一档）。
 * 没有贡献或都不认返回 0（不改变原判断）。
 */
function aliasScore(needle: string, item: Searchable): number {
  const mode: GotoActionMatchMode = actionAliasMatch({
    id: item.id ?? item.title, text: item.title, group: item.group, description: item.description,
  }, needle)
  return aliasMatchScore(mode)
}

function match(needle: string, haystack: string, weight: number): number {
  const text = haystack.toLowerCase()
  const direct = text.indexOf(needle)
  const starts = wordStarts(text)
  if (direct >= 0) {
    // A literal run is worth more than a scattered subsequence of the same letters.
    let score = 60 + (starts.has(direct) ? 30 : 0) + (direct === 0 ? 20 : 0)
    if (weight < 4) score -= 25 // a keyword alias never outranks the visible name
    return score
  }
  let score = 0
  let cursor = -1
  let previous = -2
  for (const character of needle) {
    const found = text.indexOf(character, cursor + 1)
    if (found < 0) return 0
    score += found === previous + 1 ? 6 : 1
    if (starts.has(found)) score += 4
    previous = found
    cursor = found
  }
  return weight < 4 ? Math.max(1, score - 25) : score
}

export function rankCommands<T extends Searchable>(items: readonly T[], query: string, limit = 80): T[] {
  const needle = query.trim()
  if (!needle) return items.slice(0, limit)
  const scored: { item: T; score: number; index: number }[] = []
  items.forEach((item, index) => {
    const score = scoreCommand(needle, item)
    if (score > 0) scored.push({ item, score, index })
  })
  scored.sort((a, b) => b.score - a.score || a.index - b.index)
  return scored.slice(0, limit).map(entry => entry.item)
}
