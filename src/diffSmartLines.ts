// 行级 diff 的**两步比对**：先只比"大行"，再在两条大行之间的空隙里重比一遍。
//
// 上游这条链是 `ByLineRt.doCompare` → `compareSmart`（`ByLineRt.kt:335-348`）→
// `ChangeCorrector.SmartLineChangeCorrector`（`comparison/ChangeCorrector.kt:93-126`）：
//
//   1. **筛大行**：`nonSpaceChars > threshold` 的行才算"大行"（`getBigLines`，`ByLineRt.kt:350-362`），
//      阈值是常量 `DiffConfig.UNIMPORTANT_LINE_CHAR_COUNT = 3`（`util/diff/DiffConfig.kt:12`）——
//      `{` / `}` / `);` / 空行这类"不重要"的行**不参与第一步**；
//   2. **只比大行**（`DiffIterableUtil.diff(bigLines1, bigLines2)`）；
//   3. **补空隙**：对每一对相邻的已匹配大行，把它俩之间的那段（两侧各自的原始行区间）单独再比一次，
//      比之前先把两端本来就相等的行让出来（`TrimUtil.expand`，`TrimUtil.kt:323-339`：
//      前向 `expandForward`、后向 `expandBackward`，被让出来的行直接算相等）。
//
// 为什么值得这么做：全局 LCS 在大行之间出现"并列最优"时会随便挑一种配法，短行（括号、空行）就
// 可能被配到别处去；先钉住大行、再局部分辨空隙，结果稳定且更像人改的
// （上游注释里那组 `.{` / `..{` / `...{` 的例子在 `ByLineRt.kt:143-160`）。
//
// 本仓的接线在 `src/diffText.ts` 的 `buildDiffRows`：对齐那一步改用它。
// 完整入口 `compareLineMatch` 对应 `ByLineRt.doCompare`（`ByLineRt.kt:60-81`）：
// 忽略空白的两步比较 → 行块优化 → 按目标策略修正相等区间。
import { alignLines } from './diffAlign.ts'
import { expandBackward, expandForward, expandMatchGaps, optimizeSpans, pairsToSpans, spansToPairs, type ShiftFn } from './diffChunks.ts'
import { comparisonKeys, isDiffWhitespace, type ComparisonPolicy } from './diffComparison.ts'

/** `DiffConfig.kt:12`：`UNIMPORTANT_LINE_CHAR_COUNT = 3`。 */
export const UNIMPORTANT_LINE_CHAR_COUNT = 3

/** 一行里非空白字符的个数（上游 `ByLineRt.Line.countNonSpaceChars`，`ByLineRt.kt:440-...`）。 */
export function nonSpaceChars(line: string): number {
  let n = 0
  for (let i = 0; i < line.length; i++) if (!isDiffWhitespace(line[i]!)) n++
  return n
}

/** 大行的下标（上游 `getBigLines` 的 `indexes` 那一半）。 */
export function bigLineIndexes(lines: readonly string[], threshold = UNIMPORTANT_LINE_CHAR_COUNT): number[] {
  const out: number[] = []
  for (let i = 0; i < lines.length; i++) if (nonSpaceChars(lines[i]!) > threshold) out.push(i)
  return out
}

/** 一对已匹配的行（`from` 落在 before、`to` 落在 after）。与 `diffText.computeLCS` 同一形状。 */
export interface LineMatch { from: number; to: number }

/**
 * `compareSmart`：两步比对。
 *
 * `keys` 是两侧按比较策略折过的行（`comparisonKeys`）—— 判等用它、**筛大行用原文**
 * （上游 `Line.nonSpaceChars` 数的是 `content`，与 policy 无关；判等才走 policy，
 * 见 `ByLineRt.kt:418-430`）。
 *
 * 返回按 `from` 升序、互不重叠的匹配对，可直接喂给 `buildDiffRows` 的渲染循环。
 */
export function smartLineMatch(
  keysBefore: readonly string[],
  keysAfter: readonly string[],
  linesBefore: readonly string[] = keysBefore,
  linesAfter: readonly string[] = keysAfter,
  threshold = UNIMPORTANT_LINE_CHAR_COUNT,
): LineMatch[] {
  if (threshold === 0) return alignLines(keysBefore, keysAfter)
  const equals = (i: number, j: number): boolean => keysBefore[i] === keysAfter[j]
  const out: LineMatch[] = []

  const big1 = bigLineIndexes(linesBefore, threshold)
  const big2 = bigLineIndexes(linesAfter, threshold)
  // 第一步：只比大行。大行一个都没有时它退化成"整篇一个空隙"，由后面的 matchGap 全量再比一次
  //（上游同款退化：`compareSmart` 的注释与 `ByLineRt.kt:335-348`）。
  const coarse = alignLines(big1.map(i => keysBefore[i]!), big2.map(j => keysAfter[j]!))

  /**
   * 补一段空隙（上游 `SmartLineChangeCorrector.matchGap`，`ChangeCorrector.kt:101-115`）：
   * 让出两端本来就相等的行 → 中间那段做一次普通 LCS → 让出来的头尾也算相等。
   */
  const matchGap = (start1: number, start2: number, end1: number, end2: number): void => {
    const head = expandForward(start1, start2, end1, end2, equals)
    const inner1 = start1 + head
    const inner2 = start2 + head
    const tail = expandBackward(inner1, inner2, end1, end2, equals)
    const tail1 = end1 - tail
    const tail2 = end2 - tail
    for (let i = 0; i < head; i++) out.push({ from: start1 + i, to: start2 + i })
    if (inner1 < tail1 && inner2 < tail2) {
      const inner = alignLines(keysBefore.slice(inner1, tail1), keysAfter.slice(inner2, tail2))
      for (const m of inner) out.push({ from: inner1 + m.from, to: inner2 + m.to })
    }
    for (let i = 0; i < tail; i++) out.push({ from: tail1 + i, to: tail2 + i })
  }

  // `ChangeCorrector.execute()`（`ChangeCorrector.kt:27-50`）：遍历第一步的**已匹配**大行，
  // 每两对之间补空隙，大行本身也算相等。
  let last1 = 0
  let last2 = 0
  for (const c of coarse) {
    const m1 = big1[c.from]!
    const m2 = big2[c.to]!
    matchGap(last1, last2, m1, m2)
    out.push({ from: m1, to: m2 })
    last1 = m1 + 1
    last2 = m2 + 1
  }
  matchGap(last1, last2, keysBefore.length, keysAfter.length)
  return out
}

/** `ChunkOptimizer.kt:174-261`: empty boundaries precede merely unimportant boundaries. */
export function lineShift(lines1: readonly string[], lines2: readonly string[], threshold = UNIMPORTANT_LINE_CHAR_COUNT): ShiftFn {
  const counts = { a: lines1.map(nonSpaceChars), b: lines2.map(nonSpaceChars) }
  const find = (lines: readonly number[], offset: number, count: number, step: number, limit: number): number => {
    for (let i = 0; i < count; i++) if (lines[offset + step * i]! <= limit) return i
    return -1
  }
  const choose = (forward: number, backward: number): number | null => {
    if (forward === -1 && backward === -1) return null
    if (forward === 0 || backward === 0) return 0
    return forward !== -1 ? forward : -backward
  }
  return (side, forward, backward, first, second) => {
    const other = side === 'a' ? 'b' : 'a'
    for (const limit of [0, threshold]) {
      const unchanged = choose(
        find(counts[side], second[side].start, forward + 1, 1, limit),
        find(counts[side], second[side].start - 1, backward + 1, -1, limit),
      )
      if (unchanged !== null) return unchanged
      const changed = choose(
        find(counts[other], first[other].end, forward + 1, 1, limit),
        find(counts[other], second[other].start - 1, backward + 1, -1, limit),
      )
      if (changed !== null) return changed
    }
    return 0
  }
}

export function optimizeLineChunks(keys1: readonly string[], keys2: readonly string[], matches: readonly LineMatch[], lines1: readonly string[] = keys1, lines2: readonly string[] = keys2): LineMatch[] {
  return spansToPairs(optimizeSpans(pairsToSpans(matches), keys1.length, keys2.length,
    (i, j) => keys1[i] === keys2[j], lineShift(lines1, lines2)))
}

/** `ByLineRt.kt:268-319`: first maximum-weight monotone combination wins; search only up to 10. */
function bestAlignment(short: readonly number[], long: readonly number[], shortKeys: readonly string[], longKeys: readonly string[]): number[] {
  let best = short.map((_, i) => i)
  let bestWeight = 0
  const combination: number[] = []
  const search = (start: number): void => {
    if (combination.length === short.length) {
      let weight = 0
      for (let i = 0; i < short.length; i++) if (shortKeys[short[i]!] === longKeys[long[combination[i]!]!]) weight++
      if (weight > bestWeight) { bestWeight = weight; best = [...combination] }
      return
    }
    for (let i = start; i <= long.length - (short.length - combination.length); i++) {
      combination.push(i)
      search(i + 1)
      combination.pop()
    }
  }
  search(0)
  return best
}

/** `ByLineRt.kt:135-265`: preserve IW slots, maximise exact-policy matches within one IW sample. */
export function correctChangesSecondStep(keys1: readonly string[], keys2: readonly string[], iw1: readonly string[], iw2: readonly string[], matches: readonly LineMatch[]): LineMatch[] {
  const equal: LineMatch[] = []
  let sample: string | null = null
  let last1 = 0, last2 = 0
  let index1 = 0, index2 = 0
  const markEqual = (from: number, to: number): void => {
    equal.push({ from, to })
    index1 = from + 1
    index2 = to + 1
  }
  const flush = (end1: number, end2: number): void => {
    if (sample === null) return
    const sub1: number[] = [], sub2: number[] = []
    for (let i = Math.max(last1, index1); i < end1; i++) {
      if (iw1[i] === sample) { sub1.push(i); last1 = i + 1 }
    }
    for (let i = Math.max(last2, index2); i < end2; i++) {
      if (iw2[i] === sample) { sub2.push(i); last2 = i + 1 }
    }
    if (Math.max(sub1.length, sub2.length) > 10 || sub1.length === sub2.length) {
      for (let i = 0; i < Math.min(sub1.length, sub2.length); i++) {
        if (keys1[sub1[i]!] === keys2[sub2[i]!]) markEqual(sub1[i]!, sub2[i]!)
      }
    } else {
      const leftShorter = sub1.length < sub2.length
      const short = leftShorter ? sub1 : sub2
      const long = leftShorter ? sub2 : sub1
      const alignment = bestAlignment(short, long, leftShorter ? keys1 : keys2, leftShorter ? keys2 : keys1)
      for (let i = 0; i < short.length; i++) {
        const from = leftShorter ? short[i]! : long[alignment[i]!]!
        const to = leftShorter ? long[alignment[i]!]! : short[i]!
        if (keys1[from] === keys2[to]) markEqual(from, to)
      }
    }
    sample = null
  }
  for (const { from, to } of matches) {
    if (sample !== iw1[from]) {
      flush(from, to)
      if (keys1[from] === keys2[to]) markEqual(from, to)
      else sample = iw1[from]!
    }
  }
  flush(keys1.length, keys2.length)
  return expandMatchGaps(equal, keys1.length, keys2.length, (i, j) => keys1[i] === keys2[j])
}

/** Full two-way `ByLineRt.doCompare` (`ByLineRt.kt:60-81,364-377`). */
export function compareLineMatch(lines1: readonly string[], lines2: readonly string[], policy: ComparisonPolicy = 'default'): LineMatch[] {
  const keys1 = comparisonKeys(lines1, policy), keys2 = comparisonKeys(lines2, policy)
  const iw1 = comparisonKeys(lines1, 'ignoreWhitespaces'), iw2 = comparisonKeys(lines2, 'ignoreWhitespaces')
  const smart = smartLineMatch(iw1, iw2, lines1, lines2)
  const ignored = policy === 'ignoreWhitespaces' || policy === 'ignoreWhitespacesChunks'
  const optimized = optimizeLineChunks(ignored ? iw1 : keys1, ignored ? iw2 : keys2, smart, lines1, lines2)
  return ignored
    ? expandMatchGaps(optimized, keys1.length, keys2.length, (i, j) => keys1[i] === keys2[j])
    : correctChangesSecondStep(keys1, keys2, iw1, iw2, optimized)
}
