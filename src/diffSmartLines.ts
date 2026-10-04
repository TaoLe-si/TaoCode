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
// **没做的两步**（如实记在判决里）：上游在 compareSmart 之后还有 `optimizeLineChunks`
// （`ChunkOptimizer.LineChunkOptimizer`，按同一阈值合并行块）与 `expandRanges` /
// `correctChangesSecondStep`（把"策略意义下相等但原文不等"的行再修一遍）。
import { alignLines } from './diffAlign.ts'
import { expandBackward, expandForward } from './diffChunks.ts'

/** `DiffConfig.kt:12`：`UNIMPORTANT_LINE_CHAR_COUNT = 3`。 */
export const UNIMPORTANT_LINE_CHAR_COUNT = 3

/** 一行里非空白字符的个数（上游 `ByLineRt.Line.countNonSpaceChars`，`ByLineRt.kt:440-...`）。 */
export function nonSpaceChars(line: string): number {
  let n = 0
  for (const ch of line) if (!/\s/.test(ch)) n++
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
