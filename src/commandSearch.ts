// IDEA's "Find Action" matching: a query has to appear as a subsequence, hits at the
// start of a word count for more, and a Latin alias (keywords) beats nothing at all.
// Kept separate from App.vue so the ranking can be checked without a DOM.
export interface Searchable {
  title: string
  keywords?: string
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
  return Math.max(match(needle, item.title, 4), match(needle, item.keywords ?? '', 1))
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
