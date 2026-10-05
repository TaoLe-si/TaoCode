// `src/completionSort.ts` 的「匹配形状」这一档（IDEA `PrefixWeigher` 的等价物）：
// 服务器不给 `sortText`（或给了同一个）时，**打出来的前缀正好接上**的候选必须排在
// 只是包含关键字/完全不相关的候选前面 —— 否则用户打 `getN` 会看到 `aaaname` 排在 `getName` 前。
//
// 与 `tests/completion-sort.test.mjs` 同一模块，但那个文件锁的是原来的四档链；这里锁新增的一档。

import test from 'node:test'
import assert from 'node:assert/strict'

import { camelHumpMatch, completionMatchKind, completionMatchRank, sortCompletions } from '../src/completionSort.ts'

test('匹配形状的五个档位都有真实例子', () => {
  const cases = [
    ['getName', 'getN', 'exact'],
    ['GetName', 'getN', 'ignoreCase'],
    ['setName', 'name', 'substring'],
    ['getUserName', 'gUN', 'camel'],
    ['xyz', 'getN', 'none'],
    ['', 'x', 'none'],
    ['x', '', 'none'],
  ]
  for (const [label, typed, kind] of cases)
    assert.equal(completionMatchKind(label, typed), kind, `${label} / ${typed}`)
  // 序号与档位顺序一致，且严格递增。
  const ranked = [['getName', 'getN'], ['GetName', 'getN'], ['setName', 'name'], ['getUserName', 'gUN'], ['xyz', 'gN']]
  assert.deepEqual(ranked.map(([label, typed]) => completionMatchRank(label, typed)), [0, 1, 2, 3, 4])
})

test('驼峰命中：连续段与词边界都算，跳不过去就不算', () => {
  assert.equal(camelHumpMatch('getName', 'gN'), true, 'g 在串首、N 是驼峰')
  assert.equal(camelHumpMatch('getName', 'getN'), true, '前三个连续、N 在驼峰')
  assert.equal(camelHumpMatch('get_user_name', 'gun'), true, '分隔符之后也是词边界')
  assert.equal(camelHumpMatch('getName', 'Nm'), false, 'N 之后的 m 不能从头再找')
  assert.equal(camelHumpMatch('getName', ''), false)
  assert.equal(camelHumpMatch('', 'g'), false)
})

test('同样 sortText 下，前缀命中的候选排到不相关的后面去（本轮修的用户可见行为）', () => {
  const list = [
    { label: 'aaaname', sortText: '0', typedPrefix: 'getN' },
    { label: 'getName', sortText: '0', typedPrefix: 'getN' },
    { label: 'zzz', sortText: '0', typedPrefix: 'getN' },
  ]
  assert.deepEqual(sortCompletions(list).map(entry => entry.label), ['getName', 'aaaname', 'zzz'],
    '不相关（none）仍排在子串之后；ASCII 序不能让 aaaname 抢在 getName 前')
})

test('sortText 是服务器自己的分组，它不同的时候匹配形状不插嘴', () => {
  // 相关性这一档是**降序**（`LspCompletionWeigher.kt:38-40` 的 `ReverseComparableString`），
  // 所以给 getName 小的 sortText：两档结论**故意相反** —— 匹配形状那一档会因 `getN` 驼峰命中
  // 把 getName 排前面，sortText 这一档却要把 aaa 排前面。断言 aaa 在前，才证明插嘴的不是它。
  const list = [
    { label: 'getName', sortText: '1', typedPrefix: 'getN' },
    { label: 'aaa', sortText: '2', typedPrefix: 'getN' },
  ]
  assert.deepEqual(sortCompletions(list).map(entry => entry.label), ['aaa', 'getName'])
})

test('没有 typedPrefix（无上下文）时不启用这一档，退回原来的链', () => {
  assert.deepEqual(sortCompletions([{ label: 'b' }, { label: 'a' }]).map(entry => entry.label), ['a', 'b'])
  // 两边前缀不同（不该发生的混排）也整档跳过，避免拿两套输入互相比较。
  const mixed = [
    { label: 'getName', typedPrefix: 'getN' },
    { label: 'aaa', typedPrefix: 'x' },
  ]
  assert.deepEqual(sortCompletions(mixed).map(entry => entry.label), ['aaa', 'getName'])
})

test('预选仍然最优先，压过匹配形状', () => {
  const list = [
    { label: 'getName', typedPrefix: 'getN' },
    { label: 'zzz', preselected: true, typedPrefix: 'getN' },
  ]
  assert.deepEqual(sortCompletions(list).map(entry => entry.label), ['zzz', 'getName'])
})
