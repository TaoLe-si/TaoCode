// `IgnorePolicy` × `HighlightPolicy` 的**组合语义**判据。
//
// 上游两条策略不是一个下拉里的两个独立选项，它们在 `TwosideTextDiffProviderBase.java:74-77`
// 里合成两个布尔量：
//   squashFragments = highlightPolicy.isShouldSquash() && ignorePolicy.isShouldSquash()
//   trimFragments   = ignorePolicy.isShouldTrimChunks()
// 再加 `HighlightPolicy` 自己的 isShouldCompare() / getFragmentsPolicy()。
// 本仓把这张派生表放成纯函数（`src/diffComparison.ts` + `src/diffWords.ts`），这条判据钉它。
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { ignorePolicyDerivatives, ignorePolicyShouldSquash, shouldTrimChunks } from '../src/diffComparison.ts'
import { fragmentsPolicyOf, highlightIsFineFragments, highlightShouldCompare, highlightShouldSquash, marksFor, shouldSquashFragments } from '../src/diffWords.ts'

const read = rel => readFileSync(new URL(`../${rel}`, import.meta.url), 'utf8')
const POLICIES = ['default', 'trimWhitespaces', 'ignoreWhitespaces', 'ignoreWhitespacesChunks']
const HIGHLIGHTS = ['byLine', 'byWord', 'byWordSplit', 'byChar', 'doNotHighlight']

// —— IgnorePolicy：六项枚举的三条派生属性 ——

test('every selectable ignore policy keeps comparison/squash/trim in one table', () => {
  for (const policy of POLICIES) {
    const derived = ignorePolicyDerivatives(policy)
    // 上游 `getComparisonPolicy()`：`IGNORE_WHITESPACES_CHUNKS` 折成 `IGNORE_WHITESPACES`，
    // 其余原样（`:29-35`）。
    assert.equal(derived.comparison, policy)
    // `isShouldSquash()`：四项全 true（唯一 false 的 language-specific 没有语言侧规则，不列）。
    assert.equal(derived.squash, true)
    // `isShouldTrimChunks()`：只有第四档为 true（`:41-43`）。
    assert.equal(derived.trimChunks, policy === 'ignoreWhitespacesChunks')
  }
  assert.equal(shouldTrimChunks('ignoreWhitespacesChunks'), true)
  assert.equal(ignorePolicyShouldSquash('default'), true)
})

test('the four selectable policies stay in the upstream fold order', () => {
  // 行号与文案引用的稳定性：这一段注释是 §G 里 IgnorePolicy 一行的依据。
  const source = read('src/diffComparison.ts')
  for (const cite of ['IgnorePolicy.java:29-35', 'IgnorePolicy.java:37-39', 'IgnorePolicy.java:41-43']) {
    assert.ok(source.includes(cite), `diffComparison.ts 缺上游引用 ${cite}`)
  }
})

// —— HighlightPolicy：五档的三条正交属性（`HighlightPolicy.java:24-45`）——

test('highlight policies derive compare / squash / fragments orthogonally', () => {
  assert.deepEqual(HIGHLIGHTS.map(fragmentsPolicyOf), ['none', 'words', 'words', 'chars', 'none'])
  assert.deepEqual(HIGHLIGHTS.map(highlightShouldCompare), [true, true, true, true, false])
  assert.deepEqual(HIGHLIGHTS.map(highlightShouldSquash), [true, true, false, true, true])
  assert.deepEqual(HIGHLIGHTS.map(highlightIsFineFragments), [false, true, true, true, false])
})

test('squash combines the highlight and ignore sides', () => {
  // `TwosideTextDiffProviderBase.java:75` 的与运算：四个忽略档都不阻断 squash，
  // 于是结果只由高亮档决定（只有 split 档为 false）。
  for (const policy of POLICIES) {
    assert.equal(shouldSquashFragments('byWord', ignorePolicyShouldSquash(policy)), true)
    assert.equal(shouldSquashFragments('byWordSplit', ignorePolicyShouldSquash(policy)), false)
  }
  assert.equal(shouldSquashFragments('byChar', true), true)
})

test('marks follow the fragments policy, not the enum spelling', () => {
  const left = 'alpha beta'
  const right = 'alpha gamma'
  assert.deepEqual(marksFor('doNotHighlight', left, right), { left: [], right: [] })
  assert.deepEqual(marksFor('byLine', left, right), { left: [], right: [] })
  // split 档的粒度仍是词级（`getFragmentsPolicy` 把 BY_WORD/BY_WORD_SPLIT 都折成 WORDS）。
  assert.deepEqual(marksFor('byWordSplit', left, right), marksFor('byWord', left, right))
  assert.ok(marksFor('byChar', left, right).left.length > 0)
})

// —— 接线：DiffView 的五个选项与派生表同源 ——

test('DiffView offers all five highlight levels', () => {
  const view = read('src/components/DiffView.vue')
  for (const value of HIGHLIGHTS) assert.ok(view.includes(`value: '${value}'`), `DiffView 缺 ${value} 档`)
  assert.match(view, /HighlightPolicy\.java:11-15/, '五档的依据要写在注释里')
})
