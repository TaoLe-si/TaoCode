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
import { bigLineIndexes, nonSpaceChars, smartLineMatch, UNIMPORTANT_LINE_CHAR_COUNT } from '../src/diffSmartLines.ts'
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
  assert.match(src, /smartLineMatch\(/, '对齐要用两步比对')
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

// 保底：两步比对的配对数**不许**比普通 LCS 少（上游靠 `correctChangesSecondStep` 兜的这一层，
// 本仓用"少配就退回 LCS"来兜）。
test('the two-step alignment never matches fewer lines than the plain LCS', () => {
  const fixtures = [
    [['int a = 1;', '}', 'int b = 2;'], ['}', 'int a = 1;', 'int b = 2;']],
    [['.{', '..{', '...{'], ['..{', '...{', '...{']],
    [['alpha();', '', 'beta();'], ['', 'alpha();', 'beta();']],
    [['if (x) {', '  a();', '}', 'if (y) {', '  b();', '}'], ['if (x) {', '}', '  a();', 'if (y) {', '  b();', '}']],
    [['/*', ' * x', ' */', 'a();'], ['/*', ' * x', ' */', '', 'a();']],
  ]
  for (const [a, b] of fixtures) {
    assert.ok(smartLineMatch(a, b).length >= alignLines(a, b).length,
      `两步比对的配对数不许比 LCS 少：${JSON.stringify(a)}`)
  }
})

test('buildDiffRows keeps that guard wired', () => {
  assert.match(read('src/diffText.ts'), /smart\.length >= plain\.length/,
    '少配就退回普通 LCS —— 这条保底必须在')
})
