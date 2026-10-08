// Myers 超阈值后的 **Patience 退路**（上游 `platform/util/diff/src/com/intellij/util/diff/Diff.kt:88-97`：
// `try { MyersLCS(…).executeWithThreshold() } catch (_: FilesTooBigForDiffException) { PatienceIntLCS(…).execute(true) }`）。
//
// 三条上游口径都在这份判据里：
//   · 阈值 = `max(20000 + 10*sqrt(N), DELTA_THRESHOLD_SIZE)`，`MyersLCS.kt:76-78` +
//     `DiffConfig.kt:10`（`DELTA_THRESHOLD_SIZE = 20000`）—— 本用例先自己算一遍，钉住"这份输入确实破了阈值"，
//     否则测的就不是退路；
//   · Myers 跑不完时抛 `FilesTooBigForDiffException`（`MyersLCS.kt:188-190`）⇒ 本仓 `MyersAligner.run` 返回 false；
//   · Patience 只把**两侧各只出现一次**的行当锚点（`UniqueLCS.kt:29-57`），锚点之间再递归
//     （`PatienceIntLCS.kt:86-120`），一个锚点都没有才交给不限阈值的 Myers（`PatienceIntLCS.kt:73-76`，
//     `executeLinear` 在 `MyersLCS.kt:56`）。
//
// 换掉之前这里是"中间整段视作一块改动"（等行只剩掐出来的公共前后缀），所以第 2 条断言在旧实现下是 0。
import test from 'node:test'
import assert from 'node:assert/strict'
import { alignLines } from '../src/diffAlign.ts'
import { pairsToSpans, setVerifyEnabled, verifyFairSpans } from '../src/diffChunks.ts'

const ANCHORS = 2000
const JUNK = 6

/**
 * 两侧各 `2 + ANCHORS * (1 + JUNK)` 行：首尾各放一行**只在自己这边出现**的行（公共前后缀一行都掐不掉），
 * `A{i}` 是两侧各出现**一次**的公共锚点，跟着的 `LB*` / `RB*` 全是只在自己一侧出现过的行
 * ⇒ 公共行只有那些锚点，而且它们散布在整篇中间。
 */
function shuffledSides(anchors = ANCHORS, junk = JUNK, tag = '') {
  const left = [`HEAD-L${tag}`]
  const right = [`HEAD-R${tag}`]
  for (let i = 0; i < anchors; i++) {
    left.push(`A${i}${tag}`, ...Array.from({ length: junk }, (_, k) => `LB${i}_${k}${tag}`))
    right.push(`A${i}${tag}`, ...Array.from({ length: junk }, (_, k) => `RB${i}_${k}${tag}`))
  }
  left.push(`TAIL-L${tag}`)
  right.push(`TAIL-R${tag}`)
  return [left, right]
}

/** 上游那条阈值公式（`MyersLCS.kt:76-78` + `DiffConfig.kt:10`），本用例自己复算一遍好把"破了阈值"钉死。 */
function upstreamThreshold(count1, count2) {
  return Math.max(20000 + Math.floor(10 * Math.sqrt(count1 + count2)), 20000)
}

// 破阈值的那一份只算一次（实测本机 ~2.4 秒），下面几条判据共用同一批结果。
const [BIG_LEFT, BIG_RIGHT] = shuffledSides()
const bigStarted = performance.now()
const BIG_PAIRS = alignLines(BIG_LEFT, BIG_RIGHT)
const bigElapsed = performance.now() - bigStarted

test('触发条件自证：这份输入的编辑距离确实超过上游阈值（否则测的不是退路）', () => {
  const distance = (BIG_LEFT.length - ANCHORS) + (BIG_RIGHT.length - ANCHORS)
  assert.notEqual(BIG_LEFT[0], BIG_RIGHT[0], '首行必须不同')
  assert.notEqual(BIG_LEFT[BIG_LEFT.length - 1], BIG_RIGHT[BIG_RIGHT.length - 1], '尾行必须不同')
  assert.ok(distance > upstreamThreshold(BIG_LEFT.length, BIG_RIGHT.length),
    `编辑距离 ${distance} 必须超过阈值 ${upstreamThreshold(BIG_LEFT.length, BIG_RIGHT.length)}`)
})

test('超阈值时走 Patience：块中间散布的唯一锚点全部被配上行（旧实现这里是 0 行）', () => {
  assert.equal(BIG_PAIRS.length, ANCHORS, `Patience 应捞出全部 ${ANCHORS} 个唯一锚点（退化回"整段一块改动"就是 0）`)
  assert.ok(BIG_PAIRS.every(pair => BIG_LEFT[pair.from] === BIG_RIGHT[pair.to]), '每一对都必须是真等行')
  assert.ok(BIG_PAIRS.every((pair, index) => index === 0 || pair.from > BIG_PAIRS[index - 1].from), '按 from 严格升序')
  assert.ok(BIG_PAIRS.every(pair => pair.from > 0 && pair.from < BIG_LEFT.length - 1), '没有一对来自首尾行（前后缀一行都掐不掉）')
  assert.ok(BIG_PAIRS.some(pair => pair.from > 1 && pair.from < BIG_LEFT.length - 2), '至少有一对落在**中间**')
  // 退路不许把 UI 线程拖成十秒级（实测本机 ~2.4 秒；上限留到 15 秒只为挡住复杂度退化）。
  assert.ok(bigElapsed < 15000, `退路耗时 ${bigElapsed.toFixed(0)}ms 超过 15000ms`)
})

test('退路的输出仍是公平迭代器（挂在 §diff-fair 那套校验上跑一遍）', () => {
  setVerifyEnabled(true)
  try {
    assert.doesNotThrow(() => verifyFairSpans(pairsToSpans(BIG_PAIRS), BIG_LEFT.length, BIG_RIGHT.length, 'patience 退路'),
      'Patience 的等行段必须过 fair 校验（两侧等长 + 铺满 + 交替）')
  } finally {
    setVerifyEnabled(false)
  }
})

test('锚点之间没有唯一行的那一段由内层不限阈值的 Myers 处理（`PatienceIntLCS.kt:73-76`）', () => {
  // 两块之间只放重复出现的行（不是锚点），配不上就整段算改动：等行只能是那几个锚点。
  const [left, right] = shuffledSides(30, JUNK, '-dupgap')
  const pairs = alignLines(left, right)
  assert.equal(pairs.length, 30)
  assert.ok(pairs.every(pair => left[pair.from] === right[pair.to] && left[pair.from].startsWith('A')))
})

test('没破阈值的小输入一个字都不变（退路没被误触发）', () => {
  assert.deepEqual(alignLines(['a', 'b', 'c'], ['a', 'B', 'c']), [{ from: 0, to: 0 }, { from: 2, to: 2 }])
  assert.deepEqual(alignLines(['x'], ['x', 'y']), [{ from: 0, to: 0 }])
  assert.deepEqual(alignLines([], ['y']), [])
  const repeated = alignLines(['k', 'k', 'k', 'k'], ['k', 'k', 'q', 'k'])
  assert.ok(repeated.length >= 2, '重复行照样由 Myers 处理（4 个 `k` 至少配上 2 对）')
})
