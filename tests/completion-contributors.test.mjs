// 补全的本地贡献者（`src/completionContributors.ts`）：光标前缀识别、文档词补全的排序与去噪、
// 贡献者注册表，以及与服务端候的合流口径（同名以服务端为准）。
import test from 'node:test'
import assert from 'node:assert/strict'
import {
  WORD_CONTRIBUTOR_ID, collectWordCompletions, createContributorRegistry, identifierPrefixAt, mergeWithServerItems, wordCompletionContributor,
} from '../src/completionContributors.ts'
import { LOCAL_SORT_PREFIX, localSortKey } from '../src/completionSort.ts'

test('前缀识别：标识符字符（含 $ 与 Unicode 字母），到非标识符为止', () => {
  assert.deepEqual(identifierPrefixAt('foo.ba', 6), { prefix: 'ba', from: 4 })
  assert.deepEqual(identifierPrefixAt('$x_1 + y', 4), { prefix: '$x_1', from: 0 })
  assert.deepEqual(identifierPrefixAt('调用中文方法', 6), { prefix: '调用中文方法', from: 0 })
  assert.deepEqual(identifierPrefixAt('a + b', 3), { prefix: '', from: 3 })
})

test('词补全：前缀过滤 + 出现次数降序 + 光标处整词排除', () => {
  const text = 'widget\nwidget\nwidget\nwobble\nwheel\nw'
  const items = collectWordCompletions(text, text.length, { minPrefix: 1 })
  assert.deepEqual(items.map(item => item.label), ['widget', 'wheel', 'wobble'], 'widget 出现 3 次排最前，同频按离光标近优先')
  assert.ok(items.every(item => item.label.startsWith('w')), '前缀之外的词不出现')
  assert.equal(items[0].detail, '3 次出现')
  // 前缀常量从 src/completionSort.ts 取，不要在这里写死字符 —— 那个模块的 LOCAL_SORT_PREFIX
  // 才是唯一真源（写死过一次 `~`，与实现漂移了）。
  assert.ok(items[0].sortText.startsWith(LOCAL_SORT_PREFIX), '本地条目带本地排序前缀，排在服务端候选之后')
  assert.equal(items[0].sortText, localSortKey(0, '0003widget'), '前缀 + 组号 0 + 载荷')
})

test('前缀最短长度与 limit 可调；单字符前缀默认不触发', () => {
  const text = 'gamma beta delta\nbe'
  assert.deepEqual(collectWordCompletions(text, text.length).map(item => item.label), ['beta'], 'default minPrefix=2 时 be 触发')
  assert.equal(collectWordCompletions(text, text.length, { minPrefix: 3 }).length, 0, 'minPrefix=3 时 be 不够长')
  assert.equal(collectWordCompletions('ab ac ad ae\nA', 13, { minPrefix: 1, limit: 2 }).length, 2)
})

test('大小写：忽略大小写匹配，与输入大小写形态一致的词优先', () => {
  const inside = collectWordCompletions('val Value value', 3)
  assert.equal(inside[0].label, 'value', '小写前缀先配全小写词')
  const upper = collectWordCompletions('Val Value value', 3)
  assert.equal(upper[0].label, 'Value', '大写前缀先配首字母大写词')
})

test('纯数字词不补，光标处正在打的词不补', () => {
  const items = collectWordCompletions('123 1234 foo12 fo', 2, { minPrefix: 2 })
  assert.deepEqual(items.map(item => item.label), [], '123 不是标识符')
  const current = collectWordCompletions('alpha alph', 10, { minPrefix: 2 })
  assert.deepEqual(current.map(item => item.label), ['alpha'], '正在打的 alph 自己不是候选')
})

test('驼峰命中（CamelHumpMatcher 子集）：gN 能补出 getName，非驼峰词不进来', () => {
  const text = 'getName getNumber gN'
  const out = collectWordCompletions(text, text.length, { minPrefix: 2 })
  assert.deepEqual(out.map(item => item.label).sort(), ['getName', 'getNumber'], 'gN 按驼峰命中两个 get*')
  const none = collectWordCompletions('setName foo gN', 13, { minPrefix: 2 })
  assert.deepEqual(none.map(item => item.label), [], '没有 get* 时 gN 不硬造候选')
  assert.equal(collectWordCompletions('getName gN', 10, { minPrefix: 3 }).length, 0, '前缀长度门禁照旧')
})

test('注册表：语言过滤 + accept 判定 + 同 id 覆盖', () => {
  const registry = createContributorRegistry()
  assert.deepEqual(registry.contributors().map(contributor => contributor.id), [WORD_CONTRIBUTOR_ID])
  const guarded = {
    id: 'only-comment',
    languages: ['typescript'],
    accept: context => context.inCommentOrString === true,
    contribute: () => [{ label: 'local', insertText: 'local', sortText: '~', detail: '', kind: 'word' }],
  }
  registry.register(guarded)
  assert.equal(registry.contributeAll({ text: 'abc', offset: 3, language: 'java', inCommentOrString: true }).filter(item => item.label === 'local').length, 0, '语言不匹配')
  assert.equal(registry.contributeAll({ text: 'abc', offset: 3, language: 'typescript', inCommentOrString: false }).filter(item => item.label === 'local').length, 0, 'accept 拒绝')
  assert.equal(registry.contributeAll({ text: 'abc', offset: 3, language: 'typescript', inCommentOrString: true }).filter(item => item.label === 'local').length, 1)
})

test('合流：同名（大小写不敏感）以服务端为准，本地只补空缺', () => {
  const server = [{ label: 'Widget', kind: 6 }, { label: 'alpha' }]
  const local = [
    { label: 'widget', insertText: 'widget', sortText: '~0002', detail: '2 次出现', kind: 'word' },
    { label: 'wombat', insertText: 'wombat', sortText: '~0001', detail: '1 次出现', kind: 'word' },
  ]
  const merged = mergeWithServerItems(server, local)
  assert.deepEqual(merged.map(item => item.label), ['Widget', 'alpha', 'wombat'])
  assert.equal(wordCompletionContributor().id, WORD_CONTRIBUTOR_ID)
})
