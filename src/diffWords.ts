// Two-way inline comparison: `ByWordRt.kt:28-58`（流水线）, `:637-683`（getInlineChunks）,
// `:695-878`（AdjustmentPunctuationMatcher）, `:880-906`（DefaultCorrector，`:890`/`:893` 两次让白）,
// `:939-963`（IgnoreSpacesCorrector）, `:989-1028`（TrimSpacesCorrector，用 `:590-623` 的 isLeading/TrailingSpace）。
// Words anchor punctuation gaps; the selected comparison policy then corrects whitespace.
import { alignLines } from './diffAlign.ts'
import { changedSpans, expandBackward, expandForward, optimizeSpans, pairsToSpans, wordShift, type MatchSpan } from './diffChunks.ts'
import { charMarks, comparePunctuationSpans, isDiffPunctuation, trimSpaceChanges } from './diffChars.ts'
import { comparisonKey, isDiffWhitespace, type ComparisonPolicy } from './diffComparison.ts'
export { charMarks } from './diffChars.ts'

export type HighlightPolicy = 'byLine' | 'byWord' | 'byWordSplit' | 'byChar' | 'doNotHighlight'
export const DEFAULT_HIGHLIGHT_POLICY: HighlightPolicy = 'byWord'
export interface Token { start: number; text: string }
export type Mark = [number, number]

/**
 * `HighlightPolicy` 五个枚举值的派生语义（上游 `HighlightPolicy.java:24-45`）。
 *
 * 上游那五个值不是"五档强弱"，各带三条正交属性：
 *   · `isShouldCompare()`：要不要做行内比较（`DO_NOT_HIGHLIGHT` 为 false）；
 *   · `isShouldSquash()`：要不要把相邻片段的内部片段合并（`BY_WORD_SPLIT` 为 false）；
 *   · `getFragmentsPolicy()`：行内片段的粒度（`WORDS` / `CHARS` / `NONE`）。
 * 本仓的 `marksFor` 只看粒度那一列；`isShouldSquash` 与忽略策略那条一起由
 * `shouldSquashFragments` 表达（见 `diffComparison.ts` 与下面的组合函数）。
 */
export function highlightIsFineFragments(policy: HighlightPolicy): boolean {
  return fragmentsPolicyOf(policy) !== 'none'
}

/** `isShouldCompare()`：不亮那一档连比较都不做。 */
export function highlightShouldCompare(policy: HighlightPolicy): boolean {
  return policy !== 'doNotHighlight'
}

/** `isShouldSquash()`：只有"按单词拆分"不合并相邻片段。 */
export function highlightShouldSquash(policy: HighlightPolicy): boolean {
  return policy !== 'byWordSplit'
}

/** `getFragmentsPolicy()`：`InnerFragmentsPolicy` 三档。 */
export function fragmentsPolicyOf(policy: HighlightPolicy): 'none' | 'words' | 'chars' {
  if (policy === 'byWord' || policy === 'byWordSplit') return 'words'
  if (policy === 'byChar') return 'chars'
  return 'none'
}

/**
 * `TwosideTextDiffProviderBase.java:75` 的组合式：
 * `squashFragments = highlightPolicy.isShouldSquash() && ignorePolicy.isShouldSquash()`。
 * `ignorePolicyShouldSquash` 从 `diffComparison.ts` 传入，避免这一层反向依赖比较策略。
 */
export function shouldSquashFragments(policy: HighlightPolicy, ignorePolicyShouldSquash: boolean): boolean {
  return highlightShouldSquash(policy) && ignorePolicyShouldSquash
}

/** `TrimUtil.kt:33-46`: continuous scripts are individual chunks; digits remain word parts. */
function continuousScript(ch: string): boolean {
  const code = ch.codePointAt(0)!
  if (code < 128 || /\p{Decimal_Number}/u.test(ch)) return false
  return code > 0xffff || /\p{Ideographic}/u.test(ch) || !/\p{Alphabetic}/u.test(ch) ||
    /[\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Thai}\p{Script=Javanese}]/u.test(ch)
}

/** `ByWordRt.getInlineChunks`: punctuation and spaces are gaps, LF is a matched chunk. */
export function tokenizeLine(line: string): Token[] {
  const tokens: Token[] = []
  let offset = 0, start = -1
  for (const ch of line) {
    const alpha = !isDiffWhitespace(ch) && !isDiffPunctuation(ch)
    const wordPart = alpha && !continuousScript(ch)
    if (wordPart) {
      if (start === -1) start = offset
    } else {
      if (start !== -1) { tokens.push({ start, text: line.slice(start, offset) }); start = -1 }
      if (alpha || ch === '\n') tokens.push({ start: offset, text: ch })
    }
    offset += ch.length
  }
  if (start !== -1) tokens.push({ start, text: line.slice(start) })
  return tokens
}

function appendSpan(spans: MatchSpan[], span: MatchSpan): void {
  const last = spans[spans.length - 1]
  if (last && last.a.end === span.a.start && last.b.end === span.b.start) {
    last.a.end = span.a.end
    last.b.end = span.b.end
  } else spans.push(span)
}

/** `AdjustmentPunctuationMatcher`: never match punctuation across unmatched words. */
function matchPunctuation(left: string, right: string, a: readonly Token[], b: readonly Token[], matches: readonly MatchSpan[]): MatchSpan[] {
  const spans: MatchSpan[] = []
  const start = (tokens: readonly Token[], index: number, length: number) => index === tokens.length ? length : tokens[index]!.start
  const end = (tokens: readonly Token[], index: number) => index === -1 ? 0 : tokens[index]!.start + tokens[index]!.text.length
  const gap = (i: number, j: number): MatchSpan => ({
    a: { start: end(a, i - 1), end: start(a, i, left.length) },
    b: { start: end(b, j - 1), end: start(b, j, right.length) },
  })
  const mark = (span: MatchSpan): void => appendSpan(spans, span)
  const simple = (range: MatchSpan): void => {
    for (const span of comparePunctuationSpans(left.slice(range.a.start, range.a.end), right.slice(range.b.start, range.b.end))) {
      mark({ a: { start: range.a.start + span.a.start, end: range.a.start + span.a.end },
        b: { start: range.b.start + span.b.start, end: range.b.start + span.b.end } })
    }
  }
  const complex = (first: MatchSpan, second: MatchSpan): void => {
    const sameLeft = first.a.start === second.a.start && first.a.end === second.a.end
    const sameRight = first.b.start === second.b.start && first.b.end === second.b.end
    if (!sameLeft && !sameRight) throw new Error('diff: invalid punctuation gap')
    const oneText = sameLeft ? left : right, twoText = sameLeft ? right : left
    const one = sameLeft ? first.a : first.b
    const two1 = sameLeft ? first.b : first.a, two2 = sameLeft ? second.b : second.a
    const prefixLength = two1.end - two1.start
    const joined = twoText.slice(two1.start, two1.end) + twoText.slice(two2.start, two2.end)
    for (const span of comparePunctuationSpans(oneText.slice(one.start, one.end), joined)) {
      for (const [from, to, base] of [
        [span.b.start, Math.min(span.b.end, prefixLength), two1.start],
        [Math.max(span.b.start, prefixLength), span.b.end, two2.start - prefixLength],
      ]) {
        if (from! >= to!) continue
        const single = { start: one.start + span.a.start + from! - span.b.start, end: one.start + span.a.start + to! - span.b.start }
        const double = { start: base! + from!, end: base! + to! }
        mark(sameLeft ? { a: single, b: double } : { a: double, b: single })
      }
    }
  }
  let pending = gap(0, 0)
  const backward = (i: number, j: number): void => {
    const current = gap(i, j)
    if (pending.a.start === current.a.start && pending.b.start === current.b.start) simple(current)
    else if (pending.a.start < current.a.start && pending.b.start < current.b.start) {
      simple(pending)
      simple(current)
    } else complex(pending, current)
  }
  for (const range of matches) {
    for (let k = 0; k < range.a.end - range.a.start; k++) {
      const i = range.a.start + k, j = range.b.start + k
      backward(i, j)
      mark({ a: { start: a[i]!.start, end: end(a, i) }, b: { start: b[j]!.start, end: end(b, j) } })
      pending = gap(i + 1, j + 1)
    }
  }
  backward(a.length, b.length)
  return spans
}

/**
 * 默认档 = 上游 `DefaultCorrector`（`ByWordRt.kt:880-895`）：`:890` 先 `expandWhitespacesBackward`、
 * `:893` 再 `expandWhitespacesForward`。忽略档 = `IgnoreSpacesCorrector`（`:939-963`）：
 * 先 `expandWhitespaces`（`TrimUtil.kt:126-131`，向前在前）再 trim 两侧。
 * 两个让白循环都带 `start1 < end1 && start2 < end2` 守卫（`TrimUtil.kt:401`/`:418`）——
 * 空半边（纯增/纯删）一步都让不动，所以那一段没被标点配上的空格会留在标记里。
 */
function correctWhitespace(changes: readonly MatchSpan[], left: string, right: string, policy: ComparisonPolicy): MatchSpan[] {
  const equals = (i: number, j: number) => left[i] === right[j] && isDiffWhitespace(left[i]!)
  const ignored = policy === 'ignoreWhitespaces' || policy === 'ignoreWhitespacesChunks'
  const trim = (text: string, range: MatchSpan['a']) => {
    let { start, end } = range
    while (start < end && isDiffWhitespace(text[start]!)) start++
    while (start < end && isDiffWhitespace(text[end - 1]!)) end--
    return { start, end }
  }
  const corrected = changes.flatMap(range => {
    const { start: start1, end: end1 } = range.a, { start: start2, end: end2 } = range.b
    const head = ignored ? expandForward(start1, start2, end1, end2, equals) : 0
    const tail = expandBackward(start1 + head, start2 + head, end1, end2, equals)
    const front = ignored ? head : expandForward(start1, start2, end1 - tail, end2 - tail, equals)
    let a = { start: start1 + front, end: end1 - tail }, b = { start: start2 + front, end: end2 - tail }
    if (ignored) {
      a = trim(left, a); b = trim(right, b)
      if (comparisonKey(left.slice(a.start, a.end), 'ignoreWhitespaces') === comparisonKey(right.slice(b.start, b.end), 'ignoreWhitespaces')) return []
    }
    return a.start === a.end && b.start === b.end ? [] : [{ a, b }]
  })
  return policy === 'trimWhitespaces' ? trimSpaceChanges(corrected, left, right) : corrected
}

export function compareWordChanges(left: string, right: string, policy: ComparisonPolicy = 'default'): MatchSpan[] {
  const a = tokenizeLine(left), b = tokenizeLine(right)
  const matches = pairsToSpans(alignLines(a.map(t => t.text), b.map(t => t.text)))
  const optimized = optimizeSpans(matches, a.length, b.length, (i, j) => a[i]!.text === b[j]!.text, wordShift(a, b, left, right))
  const punctuation = matchPunctuation(left, right, a, b, optimized)
  return correctWhitespace(changedSpans(punctuation, left.length, right.length), left, right, policy)
}

export function wordMarks(left: string, right: string, policy: ComparisonPolicy = 'default'): { left: Mark[]; right: Mark[] } {
  const changes = compareWordChanges(left, right, policy)
  const marks = (side: 'a' | 'b'): Mark[] => changes.flatMap(span => {
    const range = span[side]
    return range.end > range.start ? [[range.start, range.end - range.start] as Mark] : []
  })
  return { left: marks('a'), right: marks('b') }
}

export function marksFor(policy: HighlightPolicy, left: string, right: string, comparison: ComparisonPolicy = 'default'): { left: Mark[]; right: Mark[] } {
  const fragments = fragmentsPolicyOf(policy)
  if (fragments === 'none') return { left: [], right: [] }
  return fragments === 'chars' ? charMarks(left, right, comparison) : wordMarks(left, right, comparison)
}
