// 判据 · lp/completion 的**排序器扩展点**（`CompletionSorter` / `LookupElementWeigher` 一族）。
//
// 钉三件事：
//   ① 默认链（`defaultWeighers`）与 `completionSort.ts` 的 `sortCompletions` **逐条同序** ——
//      扩展点是"把默认链拆成命名档位"，不是另起一套排序（否则两条链会各自漂）；
//   ② `weighBefore` / `weighAfter` / `weigh` / `withoutClassifiers` 的插入位次与上游一致
//      （锚点找不到时 `weighBefore` 落链首、`weighAfter` 落链尾）；
//   ③ 注册面 `registerCompletionWeigher` 的档位插在 `prefix` 之后（上游 `defaultSorter`
//      遍历 `getWeighers(RELEVANCE_KEY)` 的位次），且**只在有注册时才改链**。
import test from 'node:test'
import assert from 'node:assert/strict'

import { sortCompletions } from '../src/completionSort.ts'
import {
  DEFAULT_WEIGHER_IDS,
  RELEVANCE_KEY,
  clearCompletionWeighers,
  completionSorterFor,
  createCompletionSorter,
  defaultWeighers,
  registerCompletionWeigher,
  registeredWeighers,
  unregisterCompletionWeigher,
} from '../src/completionSorter.ts'

/** 一批覆盖各档位的候选（预选、sortText 有无、精确/忽略大小写/子串/驼峰/不命中、长短、大小写）。 */
function corpus() {
  return [
    { label: 'getName', sortText: 'b', typedPrefix: 'getN' },
    { label: 'getNumber', sortText: 'a', typedPrefix: 'getN' },
    { label: 'getN', typedPrefix: 'getN' },
    { label: 'GetName', preselected: true, typedPrefix: 'getN' },
    { label: 'setting', typedPrefix: 'getN' },
    { label: 'gn', typedPrefix: 'getN' },
    { label: 'get', typedPrefix: 'getN' },
    { label: 'getname', typedPrefix: 'getN' },
    { label: 'zzz', sortText: 'z', typedPrefix: 'getN' },
    { label: 'gN', typedPrefix: 'getN' },
  ]
}

test('默认链与 completionSort 的 sortCompletions 逐条同序（扩展点不许另起一套排序）', () => {
  const list = corpus()
  assert.deepEqual(
    completionSorterFor().sort(list).map(item => item.label),
    sortCompletions(list).map(item => item.label),
  )
  // 两两比较同号：拿 `sortCompletions([a, b])` 的顺序反推期望符号，逐对核对。
  const sorter = completionSorterFor()
  for (const a of list) for (const b of list) {
    if (a === b) continue
    const expected = sortCompletions([a, b])[0] === a ? -1 : 1
    assert.equal(Math.sign(sorter.compare(a, b)), expected, `${a.label} vs ${b.label}`)
  }
})

test('默认链的档位 id 与顺序就是那六档（预选 → 相关性 → 匹配形状 → 大小写 → 长度 → 字母序）', () => {
  assert.deepEqual(defaultWeighers().map(weigher => weigher.id), [...DEFAULT_WEIGHER_IDS])
})

test('weigh 追加到链尾；weighBefore 插到锚点前；weighAfter 插到锚点后', () => {
  const marker = id => ({ id, weigh: () => 0 })
  const base = createCompletionSorter()
  assert.deepEqual(base.weigh(marker('tail')).weighers().map(w => w.id).at(-1), 'tail')
  const before = base.weighBefore('prefix', marker('x'))
  assert.deepEqual(before.weighers().map(w => w.id).indexOf('x'), before.weighers().map(w => w.id).indexOf('prefix') - 1)
  const after = base.weighAfter('prefix', marker('y'))
  assert.deepEqual(after.weighers().map(w => w.id).indexOf('y'), after.weighers().map(w => w.id).indexOf('prefix') + 1)
  // 不改原链（不可变，与上游 withClassifier 返回新对象同一口径）。
  assert.equal(base.weighers().length, DEFAULT_WEIGHER_IDS.length)
})

test('锚点找不到：weighBefore 落链首、weighAfter 落链尾（上游 Math.max(0,i) / i+1）', () => {
  const marker = id => ({ id, weigh: () => 0 })
  const base = createCompletionSorter()
  assert.equal(base.weighBefore('does-not-exist', marker('x')).weighers()[0].id, 'x')
  assert.equal(base.weighAfter('does-not-exist', marker('y')).weighers().at(-1).id, 'y')
})

test('withoutClassifiers 按谓词删档', () => {
  const slim = createCompletionSorter().withoutClassifiers(weigher => weigher.id === 'liftShorter' || weigher.id === 'alpha')
  assert.deepEqual(slim.weighers().map(w => w.id), ['preselected', 'completion', 'prefix', 'casefold'])
})

test('negated 档位把该档比较取反（上游 LookupElementWeigher.myNegated）', () => {
  const ascending = createCompletionSorter([{ id: 'len', weigh: element => element.label.length }])
  const descending = createCompletionSorter([{ id: 'len', negated: true, weigh: element => element.label.length }])
  assert.equal(ascending.compare({ label: 'a' }, { label: 'bb' }) < 0, true)
  assert.equal(descending.compare({ label: 'a' }, { label: 'bb' }) > 0, true)
})

test('null 键 = 这一档不参与；一边 null 时那一边排后面（ComparingClassifier 的 nulls 桶）', () => {
  const sorter = createCompletionSorter([{ id: 'k', weigh: element => (element.label === 'x' ? null : 1) }])
  assert.ok(sorter.compare({ label: 'x' }, { label: 'y' }) > 0, '没有键的排后面')
  assert.ok(sorter.compare({ label: 'y' }, { label: 'x' }) < 0)
})

test('注册面：档位插在 prefix 之后，只在有注册时才改链', () => {
  clearCompletionWeighers()
  const plain = completionSorterFor(RELEVANCE_KEY).weighers().map(w => w.id)
  assert.deepEqual(plain, [...DEFAULT_WEIGHER_IDS], '没有注册档位 ⇒ 纯默认链')

  registerCompletionWeigher(RELEVANCE_KEY, { id: 'myWeigher', weigh: () => 0 })
  const withExtra = completionSorterFor(RELEVANCE_KEY).weighers().map(w => w.id)
  assert.deepEqual(withExtra.indexOf('myWeigher'), withExtra.indexOf('prefix') + 1, '插在 prefix 之后（上游 getWeighers 那一段的位次）')

  assert.equal(unregisterCompletionWeigher(RELEVANCE_KEY, 'myWeigher'), true)
  assert.deepEqual(completionSorterFor(RELEVANCE_KEY).weighers().map(w => w.id), [...DEFAULT_WEIGHER_IDS])
  assert.equal(unregisterCompletionWeigher(RELEVANCE_KEY, 'myWeigher'), false, '再删一次没有可删的')
  assert.deepEqual(registeredWeighers(RELEVANCE_KEY), [])
  clearCompletionWeighers()
})

test('注册的档位真的参与排序（同 id 后注册的覆盖前一个）', () => {
  clearCompletionWeighers()
  // 一个把 label 长的排前面的档位：注册后 getNumber 应排在 get 之前。
  registerCompletionWeigher(RELEVANCE_KEY, { id: 'longFirst', negated: true, weigh: element => element.label.length })
  const ordered = completionSorterFor(RELEVANCE_KEY).sort([{ label: 'get' }, { label: 'getNumber' }])
  assert.deepEqual(ordered.map(item => item.label), ['getNumber', 'get'])

  registerCompletionWeigher(RELEVANCE_KEY, { id: 'longFirst', weigh: element => element.label.length })
  const replaced = completionSorterFor(RELEVANCE_KEY).sort([{ label: 'get' }, { label: 'getNumber' }])
  assert.deepEqual(replaced.map(item => item.label), ['get', 'getNumber'], '同 id 覆盖：不再是长者先')
  clearCompletionWeighers()
})
