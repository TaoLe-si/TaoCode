// 公平迭代器的**可校验契约**（上游 `DiffIterableUtil` 的 Verification 那一段）：
// `platform/util/diff/src/com/intellij/diff/comparison/iterables/DiffIterableUtil.kt:146-207`
//   · `:148` `setVerifyEnabled`（`@TestOnly`）/ `:152` `isVerifyEnabled` / `:159` 开关关时整段跳过；
//   · `:158-165` `verify(iterable)` = 逐段查 + `verifyFullCover`；
//   · `:178-185` 三条 check：`start1 <= end1`、`start2 <= end2`、两侧不许同时为空；
//   · `:187-207` `verifyFullCover`：`:196-198` 段与段必须**首尾衔接**且等/不等严格交替，
//                `:205-206` 两侧都必须**恰好铺满**；
//   · `:168-176` `verifyFair` = 上面全部 + `:174` 每个 unchanged 段两侧**等长**（"fair" 的定义）。
// 挂载点：上游 `fair()`（`:110-114`）里 `verifyFair(wrapper)`；`ChunkOptimizer.build` 的返回值
// 正是 `fair(createUnchanged(…))`（`platform/util/diff/src/com/intellij/diff/comparison/ChunkOptimizer.kt:25`）
// ⇒ 本仓挂在 `optimizeSpans` 的出口（`src/diffChunks.ts`）。
import test from 'node:test'
import assert from 'node:assert/strict'
import { changedSpans, optimizeSpans, pairsToSpans, setVerifyEnabled, verifyFairSpans, wordShift } from '../src/diffChunks.ts'
import { alignLines } from '../src/diffAlign.ts'
import { compareLineMatch, smartLineMatch } from '../src/diffSmartLines.ts'
import { comparisonKeys } from '../src/diffComparison.ts'

/** 造一段 `MatchSpan`（上游 `Range` 的本仓形状：两侧各一个半开区间）。 */
const span = (a1, a2, b1, b2) => ({ a: { start: a1, end: a2 }, b: { start: b1, end: b2 } })

/** 开关默认必须是**关**的：上游那里 `SHOULD_VERIFY_ITERABLE` 默认 false，这条判据守的是"生产行为没变"。 */
test('校验开关默认关：同一批坏段表在关着的时候一个都不抛', () => {
  setVerifyEnabled(false)
  for (const bad of [
    [span(2, 1, 0, 1)],          // 区间反向
    [span(1, 1, 1, 1)],          // 两侧皆空
    [span(0, 2, 0, 3)],          // 两侧不等长（非 fair）
    [span(2, 3, 2, 3), span(0, 1, 0, 1)], // 乱序 ⇒ 接不上
  ]) {
    assert.doesNotThrow(() => verifyFairSpans(bad, 5, 5), '开关没开时校验必须是空操作')
  }
})

test('开关打开：四类违约段表逐类必抛（每一条都对应上游一句 check）', () => {
  setVerifyEnabled(true)
  try {
    // 1) `:181`/`:182` 区间反向
    assert.throws(() => verifyFairSpans([span(2, 1, 0, 1)], 5, 5), /区间反向/)
    // 2) `:183` 两侧同时为空
    assert.throws(() => verifyFairSpans([span(1, 1, 1, 1)], 5, 5), /空段/)
    // 3) `:174` fair 的定义：unchanged 两侧必须等长（这里铺满合法，只有长度不等这一条违约）
    assert.throws(() => verifyFairSpans([span(0, 2, 0, 3), span(3, 5, 3, 5)], 5, 5), /两侧不等长/)
    // 4) 乱序/重叠的段表：补集那一段立刻反向或塌成空段 ⇒ 由 `:181-183` 那三条 check 抓到
    //    （上游 `createUnchanged` 同样是从 unchanged 段表反推 changes，所以断裂在这里露馅）。
    assert.throws(() => verifyFairSpans([span(2, 3, 2, 3), span(0, 1, 0, 1)], 5, 5), /区间反向/)
    assert.throws(() => verifyFairSpans([span(0, 1, 0, 1), span(0, 1, 0, 1)], 5, 5), /空段|区间反向/)
  } finally {
    setVerifyEnabled(false)
  }
})

test('合法段表：铺满、交替、两侧等长 —— 全过', () => {
  setVerifyEnabled(true)
  try {
    // a = [ X X y y Z ]，b = [ X X z Z ]：unchanged 三段（2 + 1 行），changes 两段，两侧都铺满。
    const unchanged = [span(0, 2, 0, 2), span(3, 4, 3, 4)]
    assert.doesNotThrow(() => verifyFairSpans(unchanged, 5, 4))
    // 纯插入/纯删除（一侧为空）也是合法的：changes 里那一段另一侧长度为 0。
    assert.doesNotThrow(() => verifyFairSpans([span(1, 2, 1, 2)], 3, 2))
    assert.deepEqual(changedSpans(unchanged, 5, 4), [span(2, 3, 2, 3), span(4, 5, 4, 4)],
      '改动段是未更改段的补（上游 `createUnchanged`，`DiffIterableUtil.kt:96` 的同一条账）')
  } finally {
    setVerifyEnabled(false)
  }
})

test('本仓真实产出链在开着校验的情况下必须全绿（这条把"语义等价"变成可断言的东西）', () => {
  setVerifyEnabled(true)
  try {
    const policies = ['default', 'trimWhitespaces', 'ignoreWhitespaces', 'ignoreWhitespacesChunks']
    const pairs = [
      [['keep', 'old one', 'old two', 'tail', 'tail2'], ['keep', 'new one', 'tail', 'tail2', 'added']],
      [['a', 'b', 'c'], []],
      [[], ['x', 'y']],
      [['x'], ['x']],
      [['1.0.123 1.0.155'], ['1.0.123 1.0.134 1.0.155']],
      [['A', '', 'B', '', 'C'], ['A', 'B', '', 'C', '']],
    ]
    for (const [left, right] of pairs) {
      for (const policy of policies) {
        const matches = compareLineMatch(left, right, policy)
        assert.doesNotThrow(() => verifyFairSpans(pairsToSpans(matches), left.length, right.length, `${policy}`),
          `compareLineMatch(${policy}) 的产出必须是公平迭代器`)
        const keys1 = comparisonKeys(left, policy), keys2 = comparisonKeys(right, policy)
        const smart = smartLineMatch(keys1, keys2, left, right)
        assert.doesNotThrow(() => verifyFairSpans(pairsToSpans(smart), keys1.length, keys2.length, 'smartLineMatch'),
          'smartLineMatch 的产出必须是公平迭代器')
        const raw = alignLines(left, right)
        assert.doesNotThrow(() => verifyFairSpans(pairsToSpans(raw), left.length, right.length, 'alignLines'),
          'alignLines 的产出必须是公平迭代器')
      }
    }
  } finally {
    setVerifyEnabled(false)
  }
})

test('优化器出口也挂在校验上：optimizeSpans 开着校验跑一遍真实词表，结果不变', () => {
  // 词表用 diffWords 的同一套分词（`ShiftToken` 要的是**字符下标**，不是数组下标）。
  const leftText = 'one two three four'
  const rightText = 'one 2 three 4'
  const left = leftText.split(' ')
  const right = rightText.split(' ')
  const tokens = (text) => {
    const out = []
    let at = 0
    for (const word of text.split(' ')) { out.push({ start: at, text: word }); at += word.length + 1 }
    return out
  }
  const shift = wordShift(tokens(leftText), tokens(rightText), leftText, rightText)
  const equals = (i, j) => left[i] === right[j]
  const spans = pairsToSpans(alignLines(left, right))
  const plain = optimizeSpans(spans, left.length, right.length, equals, shift)
  setVerifyEnabled(true)
  try {
    const checked = optimizeSpans(spans, left.length, right.length, equals, shift)
    assert.deepEqual(checked, plain, '开着校验的结果必须与关着时逐段相同（校验不改产出）')
    assert.ok(checked.length > 0 && checked.length <= spans.length, '优化只会让段数不变或变少')
  } finally {
    setVerifyEnabled(false)
  }
})
