// 行级 diff 的两步比对（上游 `ByLineRt.compareSmart` + `ChangeCorrector.SmartLineChangeCorrector`）。
//
// 判据直接取上游的三条事实：
//   1. **阈值是 3 且是常量**：`DiffConfig.UNIMPORTANT_LINE_CHAR_COUNT = 3`（`util/diff/DiffConfig.kt:12`），
//      "大行" = `nonSpaceChars > threshold`（`ByLineRt.getBigLines`，`ByLineRt.kt:350-362`）；
//   2. **第一步只比大行**，然后按 `ChangeCorrector.execute()`（`ChangeCorrector.kt:27-50`）在
//      每两对相邻的已匹配大行之间补空隙；
//   3. **补空隙前先把两端相等的行让出来**（`TrimUtil.expand`，`TrimUtil.kt:323-339`：
//      前向、后向各一次，让出来的行算相等）。
//
// 本仓的 `alignLines`（Myers）在多次并列最优时挑哪一条是算法细节，所以这里除了钉住
// 具体结果，还钉住一条**性质**：大行的配对必须与"只比大行"的结果一致。
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { alignLines } from '../src/diffAlign.ts'
import { bigLineIndexes, compareLineMatch, correctChangesSecondStep, lineShift, nonSpaceChars, optimizeLineChunks, smartLineMatch, UNIMPORTANT_LINE_CHAR_COUNT } from '../src/diffSmartLines.ts'
import { comparisonKeys } from '../src/diffComparison.ts'
import { expandMatchGaps, pairsToSpans } from '../src/diffChunks.ts'
import { buildDiffRows } from '../src/diffText.ts'

const read = rel => readFileSync(new URL(`../${rel}`, import.meta.url), 'utf8')
const pairs = (m) => m.map(x => [x.from, x.to])

// —— 阈值与大行筛选（DiffConfig.kt:12 + ByLineRt.kt:350-362）——

test('the threshold is the upstream constant 3', () => {
  assert.equal(UNIMPORTANT_LINE_CHAR_COUNT, 3, 'DiffConfig.kt:12 UNIMPORTANT_LINE_CHAR_COUNT = 3')
})

test('nonSpaceChars counts non-whitespace characters', () => {
  assert.equal(nonSpaceChars(''), 0)
  assert.equal(nonSpaceChars('   \t '), 0)
  assert.equal(nonSpaceChars('  a b  '), 2)
  assert.equal(nonSpaceChars('a=b'), 3)
  assert.equal(nonSpaceChars('abcd'), 4)
})

// 边界正是"大于"：3 个非空白字符**不算**大行（`line.nonSpaceChars > threshold`）。
test('a line is big only when it has more than 3 non-space characters', () => {
  assert.deepEqual(bigLineIndexes(['a=b', 'ab', 'abcd', '   ', 'int x = 1;']), [2, 4])
})

// —— 退化：没有大行时整篇走一次普通 LCS（上游同款退化）——

test('with no big lines the whole input is one gap (plain LCS)', () => {
  const a = ['{', '}', '{']
  const b = ['{', '{', '}']
  assert.deepEqual(pairs(smartLineMatch(a, b)), pairs(alignLines(a, b)),
    '一条大行都没有 ⇒ 第一步空 ⇒ matchGap 覆盖全篇 ⇒ 就是普通 LCS')
})

// —— 大行被钉住：短行不再被"随便配" ——

test('big lines are pinned, the unimportant line falls into the gap', () => {
  const before = ['int a = 1;', '}', 'int b = 2;']
  const after = ['}', 'int a = 1;', 'int b = 2;']
  assert.deepEqual(pairs(smartLineMatch(before, after)), [[0, 1], [2, 2]],
    '两条大行各就各位；多出来的 `}` 是 after 侧的新增（插在开头）')
})

// 这一条是两段空隙的合约：头段让出 `{`、尾段让出 `}`，中间那段新增 `}`。
test('a gap is expanded at both ends before the inner compare', () => {
  const before = ['head();', '{', 'body();', '}']
  const after = ['head();', '{', '}', 'body();', '}']
  assert.deepEqual(pairs(smartLineMatch(before, after)), [[0, 0], [1, 1], [2, 3], [3, 4]],
    '让出来的 `{`（1,1）与 `}`（3,4）算相等，after[2] 的 `}` 落在空隙中间')
})

test('every big-line pair in the result matches the coarse (big-lines-only) alignment', () => {
  const before = ['alpha();', '}', 'beta();', '', 'gamma();']
  const after = ['}', 'alpha();', 'beta();', 'gamma();']
  const big1 = bigLineIndexes(before)
  const big2 = bigLineIndexes(after)
  const coarse = alignLines(big1.map(i => before[i]), big2.map(j => after[j]))
  const coarsePairs = coarse.map(c => [big1[c.from], big2[c.to]])
  const got = pairs(smartLineMatch(before, after))
  for (const p of coarsePairs) assert.ok(got.some(g => g[0] === p[0] && g[1] === p[1]),
    `大行配对 ${JSON.stringify(p)} 必须出现在结果里（它是第一步钉住的）`)
})

// —— 判等用**策略键**，筛大行用**原文**（ByLineRt.kt:418-430）——

test('equality uses the comparison keys, the big-line filter uses the raw text', () => {
  const raw1 = ['  int a = 1;  ', '   abc   ']
  const raw2 = ['int a = 1;', '   abc   ']
  const keys1 = raw1.map(l => l.replace(/\s+/g, ''))
  const keys2 = raw2.map(l => l.replace(/\s+/g, ''))
  // `abc` 那行原文 3 个非空白字符 ⇒ 不是大行（筛选用原文）；
  // `int a = 1;` 折过之后相等 ⇒ 判等用键。
  assert.deepEqual(pairs(smartLineMatch(keys1, keys2, raw1, raw2)), [[0, 0], [1, 1]])
  assert.deepEqual(bigLineIndexes(raw1), [0], 'abc 行非空白 3 个，不算大行')
})

// —— 接线：`buildDiffRows` 的那一步必须走两步比对 ——

test('buildDiffRows aligns through the two-step compare', () => {
  const src = read('src/diffText.ts')
  assert.match(src, /compareLineMatch\(beforeLines, afterLines, comparison\)/, '对齐走完整的上游两步修正链')
  assert.doesNotMatch(src, /const lcs = comparison === 'default'\s*\n\s*\? computeLCS/,
    '不再是"default 走 computeLCS、其它走 alignLines"的老写法')
})

// 行为层面再钉一次：`buildDiffRows` 出来的行里，大行必须对齐，而且**动的是短行**。
//
// 这一条是上游 `ByLineRt.kt:143-160` 那段注释的同类：在那组 `.`/`{` 的例子里面两步比对
// 会认"括号挪了"，而普通 LCS 会认"语句挪了"（实测两者的配对数**一样**，所以那条
// "不许少配"的保底不会把它换回 LCS）。本仓渲染上就是"新增一行 `}` + 删掉一行 `}`"。
test('buildDiffRows keeps the big lines aligned', () => {
  const rows = buildDiffRows(['int a = 1;', '}', 'int b = 2;'], ['}', 'int a = 1;', 'int b = 2;'])
  const equal = rows.filter(r => r.kind === 'equal').map(r => [r.left.text, r.right.text])
  assert.deepEqual(equal, [['int a = 1;', 'int a = 1;'], ['int b = 2;', 'int b = 2;']],
    '两条大行都渲染成 equal —— 挪动的是括号那条短行')
  assert.deepEqual(rows.map(r => r.kind), ['insert', 'equal', 'delete', 'equal'])
})

// 语句挪位那一组：两步比对认"语句没动"，LCS 会认成"括号没动、语句动了"。
test('a moved brace does not make the statement look moved', () => {
  const before = ['if (x) {', '  a();', '}', 'if (y) {', '  b();', '}']
  const after = ['if (x) {', '}', '  a();', 'if (y) {', '  b();', '}']
  const rows = buildDiffRows(before, after)
  const matched = rows.filter(r => r.kind === 'equal').map(r => r.left.text)
  assert.deepEqual(matched, ['if (x) {', '  a();', 'if (y) {', '  b();', '}'],
    '`a();` 与 `b();` 都要是相等的行')
})

// 上游为什么**允许**少配（独立验收 S3 要的坐标，逐行开过参考树）：
//   · `ByLineRt.kt:335-348` `compareSmart`：`threshold != 0` 时**只对"大行"做 LCS**
//     （`getBigLines` 在 `:350-362`，非空白字符数 > 3 才算大行），短行根本不进第一轮比对；
//   · `ChangeCorrector.kt:26-50` `execute`：把大行的配对映回原序列后，逐个 `matchGap(last1, start1, last2, start2)`
//     （`:42` 与收尾的 `:49`；`matchGap` 本身是 `:53` 的抽象方法）—— 空隙是**成对**补比的，跨不过去一个锚点。
//     本例 `alpha();` 是唯一大行，锚在 (0,3)，
//     于是 `a` 的三条 `}` 落在锚点**之后**的空隙、`b` 的三条落在锚点**之前**的空隙，
//     两边各自与空侧比对 ⇒ 谁都配不上，全局 LCS 的那 3 对在上游这里同样不存在；
//   · `ByLineRt.kt:74-81` `doCompare` 的 DEFAULT 分支：`compareSmart → optimizeLineChunks →
//     correctChangesSecondStep` 一条道走到底，**没有任何"少配就退回普通 LCS"的判据**。
//   ⇒ 所以"无保底"是上游行为，不是本仓自便；`correctChangesSecondStep` 的 `:150`
//     「we don't want to reduce number of IW-matched lines」管的是**第二步**不许再把第一步的配对剪少，
//     与第一步按大行锚定这件事不冲突。
test('upstream semantic anchors can deliberately match fewer lines than plain LCS', () => {
  const a = ['alpha();', '}', '}', '}']
  const b = ['}', '}', '}', 'alpha();']
  assert.equal(alignLines(a, b).length, 3)
  assert.deepEqual(pairs(compareLineMatch(a, b)), [[0, 3]])
  assert.deepEqual(buildDiffRows(a, b).filter(r => r.kind === 'equal').map(r => r.left.text), ['alpha();'])
  assert.doesNotMatch(read('src/diffText.ts'), /smart\.length >= plain\.length/)
})

test('the strict second step shifts indentation variants instead of trusting the IW prefix', () => {
  assert.deepEqual(pairs(compareLineMatch([' {', '  {', '   {'], ['  {', '   {'])), [[1, 0], [2, 1]])
  assert.deepEqual(pairs(compareLineMatch(['  {', '   {'], [' {', '  {', '   {'])), [[0, 1], [1, 2]])
})

test('equal-size IW groups preserve slots rather than rematching reversed indentation', () => {
  const a = [' {', '  {', '   {'], b = ['   {', '  {', ' {']
  assert.deepEqual(pairs(compareLineMatch(a, b)), [[1, 1]])
  assert.deepEqual(pairs(compareLineMatch(a, b, 'trimWhitespaces')), [[0, 0], [1, 1], [2, 2]])
})

test('big-line character counts are UTF-16 units and ignore only space/tab/LF', () => {
  assert.equal(nonSpaceChars('😀😀'), 4)
  assert.equal(nonSpaceChars(' \t\n\r\u00a0\u3000'), 3)
  assert.deepEqual(bigLineIndexes(['😀😀', 'abc\u00a0', 'abc ']), [0, 1])
})

test('threshold zero bypasses smart filtering exactly as upstream', () => {
  const a = ['alpha();', '}', '}'], b = ['}', '}', 'alpha();']
  assert.deepEqual(smartLineMatch(a, b, a, b, 0), alignLines(a, b))
})

const seam = { a: { start: 0, end: 3 }, b: { start: 0, end: 3 } }
const next = { a: { start: 3, end: 6 }, b: { start: 5, end: 8 } }

test('line shifts prefer unchanged empty boundaries and forward over backward', () => {
  const a = ['head', '', 'tail', 'next', '', 'end']
  const b = Array(8).fill('important')
  assert.equal(lineShift(a, b)('a', 2, 2, seam, next), 1)
  assert.equal(lineShift(a, b)('a', 0, 2, seam, next), -1)
  a[2] = ''
  assert.equal(lineShift(a, b)('a', 2, 2, seam, next), 0)
  assert.equal(lineShift(b, a)('b', 2, 2, { a: seam.b, b: seam.a }, { a: next.b, b: next.a }), 0)
})

test('changed empty boundaries outrank unchanged unimportant boundaries', () => {
  const a = ['head', 'body', 'tail', '}', 'next', 'end']
  const b = ['head', 'body', 'tail', 'modified', '', 'changed', '}', 'next', 'end']
  const wider = { a: next.a, b: { start: 6, end: 9 } }
  assert.equal(lineShift(a, b)('a', 2, 2, seam, wider), 1)
  b[4] = 'modified'
  assert.equal(lineShift(a, b)('a', 2, 2, seam, wider), 0)
})

test('ExpandChangeBuilder matches equal gap edges but does not run another global LCS', () => {
  const a = ['same', 'X', 'middle', 'Y', 'tail']
  const b = ['same', 'Y', 'middle', 'X', 'tail']
  assert.deepEqual(pairs(expandMatchGaps([], a.length, b.length, (i, j) => a[i] === b[j])), [[0, 0], [4, 4]])
})

test('combination matching uses the first maximum and stops brute force above ten', () => {
  const a = [' {', '  {'], b = [' {', ' {', '  {']
  assert.deepEqual(pairs(compareLineMatch(a, b)), [[0, 0], [1, 2]])
  const eleven = Array.from({ length: 11 }, (_, i) => ' '.repeat(i + 1) + '{')
  assert.deepEqual(pairs(compareLineMatch(eleven, eleven.slice(1, -1))), [])
  assert.deepEqual(pairs(compareLineMatch(eleven.slice(1, -1), eleven)), [])
})

function random(seed) {
  return () => { seed = Math.imul(seed, 1664525) + 1013904223 | 0; return (seed >>> 0) / 4294967296 }
}

function validMatches(a, b, matches, policy) {
  const keys1 = comparisonKeys(a, policy), keys2 = comparisonKeys(b, policy)
  let from = -1, to = -1
  for (const m of matches) {
    assert.ok(m.from > from && m.to > to && m.from < a.length && m.to < b.length)
    assert.equal(keys1[m.from], keys2[m.to])
    from = m.from; to = m.to
  }
}

test('2000 repeated-line cases: all policies preserve ordered fair matches and every raw row', () => {
  const rnd = random(116)
  const alphabet = ['alpha();', 'beta();', '{', '}', '', ' {', '  {', 'a b', 'ab', '\t', '😀😀', '\u00a0']
  for (let trial = 0; trial < 2000; trial++) {
    const make = () => Array.from({ length: Math.floor(rnd() * 18) }, () => alphabet[Math.floor(rnd() * alphabet.length)])
    const a = make(), b = make()
    for (const policy of ['default', 'trimWhitespaces', 'ignoreWhitespaces', 'ignoreWhitespacesChunks']) {
      validMatches(a, b, compareLineMatch(a, b, policy), policy)
      const rows = buildDiffRows(a, b, { comparison: policy, highlight: 'byLine' })
      assert.deepEqual(rows.flatMap(r => r.left ? [r.left] : []), a.map((text, i) => ({ no: i + 1, text })))
      assert.deepEqual(rows.flatMap(r => r.right ? [r.right] : []), b.map((text, i) => ({ no: i + 1, text })))
    }
    const initial = smartLineMatch(a, b)
    const optimized = optimizeLineChunks(a, b, initial)
    validMatches(a, b, optimized, 'default')
    assert.equal(optimized.length, initial.length)
    assert.ok(pairsToSpans(optimized).length <= pairsToSpans(initial).length)
  }
})

test('500 small IW groups agree with independent exhaustive maximum-weight combinations', () => {
  const rnd = random(117)
  for (let trial = 0; trial < 500; trial++) {
    const make = () => Array.from({ length: 1 + Math.floor(rnd() * 8) }, () => ' '.repeat(1 + Math.floor(rnd() * 4)) + '{')
    const a = make(), b = make()
    const initial = Array.from({ length: Math.min(a.length, b.length) }, (_, i) => ({ from: i, to: i }))
    const shortIsA = a.length <= b.length, short = shortIsA ? a : b, long = shortIsA ? b : a
    let best = short.map((_, i) => i), weight = 0
    if (a.length !== b.length) {
      for (let mask = 0; mask < 1 << long.length; mask++) {
        const positions = Array.from({ length: long.length }, (_, i) => i).filter(i => mask & 1 << i)
        if (positions.length !== short.length) continue
        const w = short.reduce((sum, text, i) => sum + (text === long[positions[i]]), 0)
        const lexEarlier = positions.some((p, i) => p < best[i] && positions.slice(0, i).every((q, j) => q === best[j]))
        if (w > weight || w === weight && w > 0 && lexEarlier) { weight = w; best = positions }
      }
    }
    const selected = best.flatMap((j, i) => short[i] === long[j] ? [{ from: shortIsA ? i : j, to: shortIsA ? j : i }] : [])
    const expected = expandMatchGaps(selected, a.length, b.length, (i, j) => a[i] === b[j])
    const actual = correctChangesSecondStep(a, b, a.map(() => '{'), b.map(() => '{'), initial)
    assert.deepEqual(actual, expected, JSON.stringify({ a, b }))
  }
})
