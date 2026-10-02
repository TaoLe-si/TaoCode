// 行级 diff 的对齐内核（`src/diffAlign.ts`，移植上游 `Diff` + `MyersLCS`）的判据。
//
// 为什么要带一个 DP 对照：LCS **不唯一**，所以不能断言"输出与 DP 逐项相同"——那会误伤。
// 能断言的是两条更强也更有意义的性质：
//   ① 公共行**长度**与 DP 最优解一致（⇒ 找的确实是最长公共子序列，不是随便一条能走通的路径）；
//   ② 输出是**合法**的公共子序列（下标严格升序、且逐行真的相等）。
// 下面 4000 组随机用例跑的就是这两条 —— 分治版 Myers 最容易错的地方（相遇点切分、
// 反向前沿的 k 平移）在重复行很多的小字母表上才会暴露，所以刻意用小字母表。
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { alignLines } from '../src/diffAlign.ts'
import { buildDiffRows, computeLCS, generateUnifiedDiff } from '../src/diffText.ts'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')

/** 教科书 DP 最长公共子序列，测试里当**最优性判据**用。 */
function dpLcsLength(a, b) {
  const m = a.length, n = b.length
  let prev = new Int32Array(n + 1)
  let cur = new Int32Array(n + 1)
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      cur[j] = a[i - 1] === b[j - 1] ? prev[j - 1] + 1 : Math.max(prev[j], cur[j - 1])
    }
    const swap = prev; prev = cur; cur = swap
    cur.fill(0)
  }
  return prev[n]
}

/** 输出必须是合法公共子序列：下标严格升序，且每对真的相等。 */
function assertValidSubsequence(a, b, pairs, label) {
  let lastFrom = -1, lastTo = -1
  for (const pair of pairs) {
    assert.ok(pair.from > lastFrom && pair.to > lastTo,
      `${label}: 下标没有严格升序 ${JSON.stringify(pair)}`)
    assert.equal(a[pair.from], b[pair.to], `${label}: ${a[pair.from]} ≠ ${b[pair.to]}`)
    lastFrom = pair.from
    lastTo = pair.to
  }
}

test('完全相同的两段全部成对', () => {
  const a = ['a', 'b', 'c']
  assert.deepEqual(alignLines(a, [...a]), [{ from: 0, to: 0 }, { from: 1, to: 1 }, { from: 2, to: 2 }])
})

test('空的一侧没有公共行', () => {
  assert.deepEqual(alignLines([], ['a']), [])
  assert.deepEqual(alignLines(['a'], []), [])
  assert.deepEqual(alignLines([], []), [])
})

test('掐公共前后缀：中间只有一行不同', () => {
  const a = ['h1', 'h2', 'body', 'f1', 'f2']
  const b = ['h1', 'h2', 'BODY', 'f1', 'f2']
  const pairs = alignLines(a, b)
  assert.deepEqual(pairs, [{ from: 0, to: 0 }, { from: 1, to: 1 }, { from: 3, to: 3 }, { from: 4, to: 4 }])
  assertValidSubsequence(a, b, pairs, '掐前后缀')
})

test('头部插入与尾部追加', () => {
  const a = ['b', 'c']
  assert.deepEqual(alignLines(a, ['a', 'b', 'c']), [{ from: 0, to: 1 }, { from: 1, to: 2 }])
  assert.deepEqual(alignLines(a, ['b', 'c', 'd']), [{ from: 0, to: 0 }, { from: 1, to: 1 }])
})

test('首行就不同：公共前缀掐不掉', () => {
  const a = ['x', 'b', 'c']
  const b = ['y', 'b', 'c']
  const pairs = alignLines(a, b)
  assert.deepEqual(pairs, [{ from: 1, to: 1 }, { from: 2, to: 2 }])
  assertValidSubsequence(a, b, pairs, '首行不同')
})

test('完全没有公共行', () => {
  const a = ['a1', 'a2', 'a3']
  const b = ['b1', 'b2', 'b3']
  assert.deepEqual(alignLines(a, b), [])
})

test('尾随空格算不同行（上游默认档 IgnorePolicy.DEFAULT = "Do not ignore"）', () => {
  // TextDiffSettingsHolder.kt:47 —— 本仓的逐行相等与默认档一致，不做 TrimUtil 那一档。
  assert.deepEqual(alignLines(['a '], ['a']), [])
  assert.deepEqual(alignLines(['a', 'b'], ['a', 'b ']), [{ from: 0, to: 0 }])
})

test('4000 组随机用例：公共行长度与 DP 最优解一致，且是合法公共子序列', () => {
  let seed = 20261002
  const rnd = () => {
    seed = (seed + 0x6D2B79F5) | 0
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
  for (let trial = 0; trial < 4000; trial++) {
    // 小字母表 ⇒ 大量重复行，这是分治版 Myers 最容易切错的地方。
    const alphabet = 1 + Math.floor(rnd() * 6)
    const a = Array.from({ length: Math.floor(rnd() * 40) }, () => 'L' + Math.floor(rnd() * alphabet))
    const b = Array.from({ length: Math.floor(rnd() * 40) }, () => 'L' + Math.floor(rnd() * alphabet))
    const pairs = alignLines(a, b)
    assertValidSubsequence(a, b, pairs, `第 ${trial} 组`)
    assert.equal(pairs.length, dpLcsLength(a, b),
      `第 ${trial} 组公共行长度不是最优：得到 ${pairs.length}，DP 说 ${dpLcsLength(a, b)}\n` +
      `a=${JSON.stringify(a)}\nb=${JSON.stringify(b)}`)
  }
})

test('大文件不会再炸：1 万行单点改动要在小堆里跑完', () => {
  const a = Array.from({ length: 10000 }, (_, i) => `line ${i}`)
  const b = [...a]
  b[5000] = 'changed'
  const started = Date.now()
  const pairs = alignLines(a, b)
  const elapsed = Date.now() - started
  assert.equal(pairs.length, 9999, '改掉的那一行不该成对，其余 9999 行都该成对')
  assert.ok(!pairs.some(p => a[p.from] === 'changed' && b[p.to] === 'changed'),
    '改掉的那一行不该被当成公共行')
  // 旧的 DP 实现在同样输入上是 1.4 秒 / 773 MB；这里留一个宽松但有意义的时间门。
  assert.ok(elapsed < 2000, `1 万行对齐用了 ${elapsed}ms，太慢`)
})

test('computeLCS 保持既有对外契约（形状不变，只换了内核）', () => {
  const pairs = computeLCS(['a', 'b', 'c'], ['a', 'x', 'c'])
  assert.deepEqual(pairs, [{ from: 0, to: 0 }, { from: 2, to: 2 }])
})

test('buildDiffRows 仍能把改动渲染成 change/equal 行', () => {
  const rows = buildDiffRows(['a', 'b', 'c'], ['a', 'B', 'c'])
  assert.deepEqual(rows.map(row => row.kind), ['equal', 'change', 'equal'])
  assert.equal(rows[1].left.text, 'b')
  assert.equal(rows[1].right.text, 'B')
})

test('generateUnifiedDiff 仍是文本形态', () => {
  const unified = generateUnifiedDiff(['a', 'b'], ['a', 'B'])
  assert.match(unified, /^-b$/m)
  assert.match(unified, /^\+B$/m)
  assert.match(unified, /^ a$/m)
})

test('内核文件里的上游行号不许漂移（判据的判据）', () => {
  const source = readFileSync(join(root, 'src/diffAlign.ts'), 'utf8')
  for (const cite of [
    'Diff.kt:29-41',     // buildChanges
    'Diff.kt:118-127',   // getStartShift
    'Diff.kt:129-141',   // getEndCut
    'Diff.kt:64-75',     // doBuildChangesFast
    'Diff.kt:96-101',    // patience 退路
    'MyersLCS.kt:96-190',  // execute 分治
    'MyersLCS.kt:38-42',   // V 数组全程复用（线性空间的由来）
    'MyersLCS.kt:64-70',   // 阈值公式
    'DiffConfig.kt:10',    // DELTA_THRESHOLD_SIZE
    'Enumerator.kt:16-25',
    'TextDiffSettingsHolder.kt:47',
  ]) {
    assert.ok(source.includes(cite), `diffAlign.ts 里少了上游引用 ${cite}`)
  }
})
