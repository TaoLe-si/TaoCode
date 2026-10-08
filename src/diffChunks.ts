// 差异块的**再优化**（上游 `ChunkOptimizer` 的等价物，`platform/util/diff/src/com/intellij/diff/comparison/ChunkOptimizer.kt`）。
//
// 为什么要有这一层：逐 token 的 LCS 只保证"改动最少"，不保证"看起来最像人改的"。两种毛病：
//   1. **碎块太多**：`"AX[AB]"` vs `"[AB]"`（好）会退化成 `"[A]XA[B]"` vs `"[A][B]"`（差）；
//   2. **切错位置**：`"1.0.123 1.0.155"` vs `"1.0.123 1.0.134 1.0.155"` 会标成
//      `"[AX A][Z]"` vs `"[AX A]Y A[Z]"`（把词从中间劈开），更好的是 `"[AX] [AZ]"` vs `"[AX] AY [AZ]"`。
// 上游的 `ChunkOptimizer` 就是干这两件事的：**先合并能合并的块，再按"分词边界"微调**。
//
// 算法骨架逐条照抄 `ChunkOptimizer.build` / `processLastRanges`（`ChunkOptimizer.kt:23-84`）：
// 它在**未更改段**上工作，两两取相邻的一段；只有当两段在某一侧相接时才有文章可做（否则说明
// 输入不是 LCS，上游直接 return，本仓也一样 —— 宁可不动，也不猜）。
// 具体怎么微调由 `shift` 决定：词级用 `wordShift`，行级用 `diffSmartLines.lineShift`。
//
// 本仓的 token 化在 `src/diffWords.ts`（与 native `history.cpp` 同一条规则），
// 所以这里只吃"token 下标 + 取文本"这三样，不认识字符串以外的任何东西 —— 可单测。

import type { AlignedPair } from './diffAlign.ts'

/** 一侧的 token 区间（半开）。 */
export interface TokenSpan { start: number; end: number }

/** 一对**未更改**的 token 区间。 */
export interface MatchSpan { a: TokenSpan; b: TokenSpan }

/**
 * 微调回调：`0` = 不动，正数 = 往后挪，负数 = 往前挪（上游 `getShift` 的契约）。
 * `first` / `second` 是相邻的两段未更改区间。
 */
export type ShiftFn = (touchSide: 'a' | 'b', equalForward: number, equalBackward: number, first: MatchSpan, second: MatchSpan) => number

/** 从 `(from1, from2)` 起逐对比较，返回连续相等的个数（上游 `TrimUtil.kt:341-354`）。 */
export function expandForward(from1: number, from2: number, to1: number, to2: number, equals: (i: number, j: number) => boolean): number {
  let a = from1
  let b = from2
  while (a < to1 && b < to2 && equals(a, b)) { ++a; ++b }
  return a - from1
}

/** 从 `(to1, to2)` 往回逐对比较，返回连续相等的个数（上游 `TrimUtil.kt:355-368`）。 */
export function expandBackward(from1: number, from2: number, to1: number, to2: number, equals: (i: number, j: number) => boolean): number {
  let a = to1
  let b = to2
  while (from1 < a && from2 < b && equals(a - 1, b - 1)) { --a; --b }
  return to1 - a
}

/**
 * 优化一串未更改段：能合并的合并、能挪边界的挪边界。
 * 输入必须是**按顺序、互不相交**的未更改段（`diffWords` 那边从 LCS 回放出来就满足）。
 */
export function optimizeSpans(spans: readonly MatchSpan[], totalA: number, totalB: number, equals: (i: number, j: number) => boolean, shift: ShiftFn): MatchSpan[] {
  const result: MatchSpan[] = []
  /** 上游那段 `processLastRanges`：只看最后两段，动过就再跑一次（递归合并）。 */
  const processLast = (): void => {
    for (;;) {
      if (result.length < 2) return
      const first = result[result.length - 2]!
      const second = result[result.length - 1]!
      // 两侧都不相接 ⇒ 中间那段在两侧都不为空，说明输入不是 LCS：不动（上游同款早退）。
      if (first.a.end !== second.a.start && first.b.end !== second.b.start) return
      const count1 = first.a.end - first.a.start
      const count2 = second.a.end - second.a.start
      const equalForward = expandForward(first.a.end, first.b.end, first.a.end + count2, first.b.end + count2, equals)
      const equalBackward = expandBackward(second.a.start - count1, second.b.start - count1, second.a.start, second.b.start, equals)
      if (equalForward === 0 && equalBackward === 0) return
      // 合并左边：[A]B[B] -> [AB]B
      if (equalForward === count2) {
        result.splice(result.length - 2, 2, {
          a: { start: first.a.start, end: first.a.end + count2 },
          b: { start: first.b.start, end: first.b.end + count2 },
        })
        continue
      }
      // 合并右边：[A]A[B] -> A[AB]
      if (equalBackward === count1) {
        result.splice(result.length - 2, 2, {
          a: { start: second.a.start - count1, end: second.a.end },
          b: { start: second.b.start - count1, end: second.b.end },
        })
        continue
      }
      const touchSide: 'a' | 'b' = first.a.end === second.a.start ? 'a' : 'b'
      const move = shift(touchSide, equalForward, equalBackward, first, second)
      if (move !== 0) {
        result.splice(result.length - 2, 2,
          { a: { start: first.a.start, end: first.a.end + move }, b: { start: first.b.start, end: first.b.end + move } },
          { a: { start: second.a.start + move, end: second.a.end }, b: { start: second.b.start + move, end: second.b.end } })
      }
      return
    }
  }
  for (const span of spans) {
    result.push({ a: { ...span.a }, b: { ...span.b } })
    processLast()
  }
  for (const span of result) {
    if (span.a.start < 0 || span.b.start < 0 || span.a.end > totalA || span.b.end > totalB) {
      throw new RangeError('diff: optimized span outside input')
    }
  }
  // 上游在这里的位置是 `ChunkOptimizer.build` 的 `return fair(createUnchanged(myRanges, …))`
  // （`ChunkOptimizer.kt:25`），而 `fair()` 里挂的就是 `verifyFair`（`DiffIterableUtil.kt:113`）。
  // 本仓同一个位置：开关没开时这是一次空操作。
  verifyFairSpans(result, totalA, totalB, 'optimizeSpans')
  return result
}

export function pairsToSpans(pairs: readonly AlignedPair[]): MatchSpan[] {
  const spans: MatchSpan[] = []
  for (const { from, to } of pairs) {
    const last = spans[spans.length - 1]
    if (last && last.a.end === from && last.b.end === to) {
      last.a.end++
      last.b.end++
    } else {
      spans.push({ a: { start: from, end: from + 1 }, b: { start: to, end: to + 1 } })
    }
  }
  return spans
}

export function spansToPairs(spans: readonly MatchSpan[]): AlignedPair[] {
  const pairs: AlignedPair[] = []
  for (const span of spans) {
    for (let i = 0; i < span.a.end - span.a.start; i++) {
      pairs.push({ from: span.a.start + i, to: span.b.start + i })
    }
  }
  return pairs
}

export function changedSpans(spans: readonly MatchSpan[], totalA: number, totalB: number): MatchSpan[] {
  const changes: MatchSpan[] = []
  let a = 0, b = 0
  for (const span of spans) {
    if (a !== span.a.start || b !== span.b.start) {
      changes.push({ a: { start: a, end: span.a.start }, b: { start: b, end: span.b.start } })
    }
    a = span.a.end
    b = span.b.end
  }
  if (a !== totalA || b !== totalB) changes.push({ a: { start: a, end: totalA }, b: { start: b, end: totalB } })
  return changes
}

/** `ExpandChangeBuilder` (`DiffIterableUtil.kt:304-309`): trim equal edges of every change gap. */
export function expandMatchGaps(pairs: readonly AlignedPair[], totalA: number, totalB: number, equals: (i: number, j: number) => boolean): AlignedPair[] {
  const out: AlignedPair[] = []
  let a = 0, b = 0
  for (const pair of [...pairs, { from: totalA, to: totalB }]) {
    const head = expandForward(a, b, pair.from, pair.to, equals)
    for (let i = 0; i < head; i++) out.push({ from: a + i, to: b + i })
    const tail = expandBackward(a + head, b + head, pair.from, pair.to, equals)
    for (let i = tail; i > 0; i--) out.push({ from: pair.from - i, to: pair.to - i })
    if (pair.from < totalA) out.push(pair)
    a = pair.from + 1
    b = pair.to + 1
  }
  return out
}

/** 微调要看 token 在文本里的位置，所以这里要的不只是词串。 */
export interface ShiftToken { start: number; text: string }

/**
 * 词级微调：不让改动从词的中间劈开（`ChunkOptimizer.WordChunkOptimizer`，`ChunkOptimizer.kt:100-146`）。
 *
 * 三条规则逐条照抄：
 *   1. 两个块**已经被空白分开**（或者其中一个在行首/行尾）⇒ 不动 —— 已经很好看了；
 *   2. 否则往后找"词的边界"，找到就往前挪（`[X]A Y[A ZA]` → `[XA] YA [ZA]`）；
 *   3. 再往前找，找到就往后挪（`[AX A]Y A[Z]` → `[AX] AY [AZ]`）。
 */
export function wordShift(tokens1: readonly ShiftToken[], tokens2: readonly ShiftToken[], text1: string, text2: string): ShiftFn {
  /** 两个 token 之间隔着空白吗（越界当"隔着"，也就是不动）。 */
  const separated = (text: string, tokens: readonly ShiftToken[], left: number, right: number): boolean => {
    if (left < 0 || right < 0 || left >= tokens.length || right >= tokens.length) return true
    if (tokens[left]!.text === '\n' || tokens[right]!.text === '\n') return true
    const from = tokens[left]!.start + tokens[left]!.text.length
    const to = tokens[right]!.start
    // 相邻（甚至重叠）时 upstream 的 `for (i in offset1 until offset2)` 一次都不跑 ⇒ 不算分开。
    if (to <= from) return false
    for (let i = from; i < to; i++) {
      const ch = text[i]!
      if (ch === ' ' || ch === '\t' || ch === '\n') return true
    }
    return false
  }
  /** 从 `offset` 往某个方向找最近的词边界，返回要挪几格（`-1` = 没找到）。 */
  const edgeShift = (text: string, tokens: readonly ShiftToken[], offset: number, count: number, leftToRight: boolean): number => {
    for (let i = 0; i < count; i++) {
      const left = leftToRight ? offset + i : offset - i - 1
      const right = leftToRight ? offset + i + 1 : offset - i
      if (separated(text, tokens, left, right)) return i + 1
    }
    return -1
  }
  return (touchSide, equalForward, equalBackward, first, second) => {
    const tokens = touchSide === 'a' ? tokens1 : tokens2
    const text = touchSide === 'a' ? text1 : text2
    const touchStart = touchSide === 'a' ? second.a.start : second.b.start
    if (separated(text, tokens, touchStart - 1, touchStart)) return 0
    const left = edgeShift(text, tokens, touchStart, equalForward, true)
    if (left > 0) return left
    const right = edgeShift(text, tokens, touchStart - 1, equalBackward, false)
    if (right > 0) return -right
    return 0
  }
}

// ── 公平迭代器的可校验契约（上游 `DiffIterableUtil` 的 Verification 那一段）─────────────────
//
// 上游每个从 LCS/优化器出来的迭代器都要过一遍 `fair()`，而 `fair()` 里就挂着 `verifyFair`
// （`platform/util/diff/src/com/intellij/diff/comparison/iterables/DiffIterableUtil.kt:110-114`），
// 校验体在同文件 `:146-207`：`setVerifyEnabled`(`:148`) / `isVerifyEnabled`(`:152`) /
// `verify(iterable)`(`:158`) / `verifyFair`(`:168`) / `verify(Iterable<Range>)`(`:178`) /
// `verifyFullCover`(`:187`)。开关默认关（`SHOULD_VERIFY_ITERABLE`），只在测试里开 ——
// 所以它**不改生产行为**，只是把"这个迭代器是合法的公平迭代器"变成可断言的东西。
// `FairDiffIterable.kt:12` 的 `@see DiffIterableUtil.verifyFair` 说明这套校验就是那类对象的名片。
//
// 本仓的差异结果是 `{from,to}` 对 / `MatchSpan` 段表（`MatchSpan` 就是上游 `Range` 的两段形状），
// 所以这里把四条 check 逐条搬过来，挂在 `optimizeSpans` 的出口 —— 上游也正是挂在
// `ChunkOptimizer.build` 的返回值上（`ChunkOptimizer.kt:19-26`：`return fair(createUnchanged(myRanges, …))`）。

/** 上游 `DiffIterableUtil.SHOULD_VERIFY_ITERABLE`（`@TestOnly setVerifyEnabled`，`iterables/DiffIterableUtil.kt:146-150`）。 */
let shouldVerifyIterable = false

/** 上游 `DiffIterableUtil.setVerifyEnabled`（`iterables/DiffIterableUtil.kt:148`）：只在测试/自检里开。 */
export function setVerifyEnabled(value: boolean): void {
  shouldVerifyIterable = value
}

/** 上游 `DiffIterableUtil.isVerifyEnabled`（`:152-154`，私有）。 */
function isVerifyEnabled(): boolean {
  return shouldVerifyIterable
}

/**
 * 上游 `DiffIterableUtil.verify(Iterable<Range>)`（`:178-185`）的三条 check：
 * `:181` `start1 <= end1`、`:182` `start2 <= end2`、`:183` 两侧不许同时为空（空段根本不该出现）。
 */
function verifyRanges(ranges: readonly MatchSpan[], where: string): void {
  for (const { a, b } of ranges) {
    if (a.start > a.end) throw new Error(`diff.verify: 一侧区间反向 ${where}：a ${a.start}..${a.end}`)
    if (b.start > b.end) throw new Error(`diff.verify: 二侧区间反向 ${where}：b ${b.start}..${b.end}`)
    if (a.start === a.end && b.start === b.end) throw new Error(`diff.verify: 空段不该进迭代器 ${where}`)
  }
}

/**
 * 上游 `DiffIterableUtil.verifyFullCover`（`:187-207`）：按 `iterateAll` 的顺序走一遍，
 * `:196` 要求上一段的终点就是这一段的起点（**不许断裂、不许重叠、不许乱序**），
 * `:198` 要求等/不等严格交替，`:205-206` 要求两侧都恰好铺满。
 */
function verifyFullCover(unchanged: readonly MatchSpan[], changes: readonly MatchSpan[], totalA: number, totalB: number, where: string): void {
  let last1 = 0
  let last2 = 0
  let lastEquals: boolean | null = null
  for (const { span, equal } of iterateAllSpans(unchanged, changes)) {
    if (last1 !== span.a.start) throw new Error(`diff.verify: 一段的起点接不上前一段的终点 ${where}（a 侧 ${last1} vs ${span.a.start}）`)
    if (last2 !== span.b.start) throw new Error(`diff.verify: 二段的起点接不上前一段的终点 ${where}（b 侧 ${last2} vs ${span.b.start}）`)
    if (lastEquals === equal) throw new Error(`diff.verify: 等/不等没有交替 ${where}`)
    last1 = span.a.end
    last2 = span.b.end
    lastEquals = equal
  }
  if (last1 !== totalA) throw new Error(`diff.verify: 一段没有铺满 ${where}（到 ${last1}，应到 ${totalA}）`)
  if (last2 !== totalB) throw new Error(`diff.verify: 二段没有铺满 ${where}（到 ${last2}，应到 ${totalB}）`)
}

/** 上游 `DiffIterableUtil.iterateAll`（`:131-134`）+ `AllRangesIterator`（`:314-341`）：两侧段表按起点归并，空段跳过。 */
function* iterateAllSpans(unchanged: readonly MatchSpan[], changes: readonly MatchSpan[]): Generator<{ span: MatchSpan; equal: boolean }> {
  let i = 0
  let j = 0
  while (i < unchanged.length || j < changes.length) {
    const equal = unchanged[i] !== undefined && (changes[j] === undefined || unchanged[i]!.a.start <= changes[j]!.a.start)
    const span = equal ? unchanged[i++]! : changes[j++]!
    if (span.a.end > span.a.start || span.b.end > span.b.start) yield { span, equal }
  }
}

/**
 * 上游 `DiffIterableUtil.verifyFair`（`:168-176`）：先 `verify`（`:171`），再逐段查 unchanged 的
 * **两侧长度必须相等**（`:174` `check(range.end1 - range.start1 == range.end2 - range.start2)`) ——
 * 这一条就是"公平（fair）"的定义：等行段是一一配对的，不是"一段对一段"。
 * 开关没开时整个函数直接返回（`:169`），所以生产路径一字未变。
 */
export function verifyFairSpans(unchanged: readonly MatchSpan[], totalA: number, totalB: number, where = 'unchanged'): void {
  if (!isVerifyEnabled()) return
  const changes = changedSpans(unchanged, totalA, totalB)
  verifyRanges(changes, `${where}/changes`)
  verifyRanges(unchanged, `${where}/unchanged`)
  verifyFullCover(unchanged, changes, totalA, totalB, where)
  for (const { a, b } of unchanged) {
    if (a.end - a.start !== b.end - b.start) {
      throw new Error(`diff.verify: 等行段两侧不等长（fair 违约）${where}：a ${a.end - a.start} vs b ${b.end - b.start}`)
    }
  }
}
