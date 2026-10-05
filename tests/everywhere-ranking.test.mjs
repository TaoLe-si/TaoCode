// Search Everywhere 的 **Top Hit 分组**（上游 `TopHitSEContributor`）与**跨供给者配额**
// （上游 `SeResultsCountBalancer`）与本仓的接线判据。上游坐标：
//   · `platform/lang-impl/src/com/intellij/ide/actions/searcheverywhere/TopHitSEContributor.java:53`
//     （TOP_HIT_ELEMENT_PRIORITY = 15000）、`:129-131`（每个元素都返回它 ⇒ 钉在最前，不是重打分）
//   · 同文件 `:73`（组名 `search.everywhere.group.name.top.hit`；中文包 `IdeBundle.properties:2313`「点击最多」）
//   · `platform/searchEverywhere/shared/src/utils/SeResultsCountBalancer.kt:129`（DIFFERENCE_LIMIT = 15）
//   · 同文件 `:63-69`（命令条目不参与配平）
//   · `platform/searchEverywhere/frontend/src/resultsProcessing/SeTabDelegate.kt:106-109`（三层归属）
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'

import {
  TOP_HIT_ELEMENT_PRIORITY,
  TOP_HIT_GROUP_NAME,
  TOP_HIT_LIMIT,
  TOP_HIT_SHOW_IN_FIND_RESULTS,
  TOP_HIT_SORT_WEIGHT,
  loadUsage,
  mergeUsage,
  pinTopHits,
  recordEverywhereUsage,
  topHitIds,
} from '../src/searchEverywhereTopHit.ts'
import { RESULTS_DIFFERENCE_LIMIT, balanceResults } from '../src/searchEverywhereBalancer.ts'
import { SE_PROVIDER_TIERS, SEARCH_EVERYWHERE_TABS, searchEverywhereResults } from '../src/searchEverywhere.ts'

const dialogSource = () => readFileSync(new URL('../src/components/SearchEverywhereDialog.vue', import.meta.url), 'utf8')

function withStorage(run) {
  const store = new Map()
  globalThis.localStorage = {
    getItem: key => (store.has(key) ? store.get(key) : null),
    setItem: (key, value) => { store.set(key, String(value)) },
    removeItem: key => { store.delete(key) },
  }
  try { return run(store) } finally { delete globalThis.localStorage }
}

const item = (id, source, title = id) => ({ id, title, source, open: () => undefined })
const many = (provider, count) => Array.from({ length: count }, (_unused, i) => ({ provider, title: `${provider}${i}` }))

test('Top Hit 的四个上游常量照抄', () => {
  assert.equal(TOP_HIT_ELEMENT_PRIORITY, 15000)
  assert.equal(TOP_HIT_SORT_WEIGHT, 50)
  assert.equal(TOP_HIT_SHOW_IN_FIND_RESULTS, false)
  assert.equal(TOP_HIT_GROUP_NAME, '点击最多')
})

test('mergeUsage：同 id 计数 +1、按"点得多"排序、截到上限', () => {
  const first = mergeUsage([], 'cmd:a', '动作 A', 'commands')
  assert.deepEqual(first, [{ id: 'cmd:a', title: '动作 A', source: 'commands', count: 1 }])
  const second = mergeUsage(first, 'cmd:a', '动作 A', 'commands')
  assert.equal(second[0].count, 2)
  assert.equal(second.length, 1, '同一条不能占两行')
  const third = mergeUsage(second, 'cmd:b', '动作 B', 'commands')
  assert.deepEqual(third.map(entry => entry.id), ['cmd:b', 'cmd:a'], '新的先记，但排序看计数')
  const crowded = mergeUsage(third, 'cmd:a', '动作 A', 'commands')
  assert.deepEqual(crowded.map(entry => entry.id), ['cmd:a', 'cmd:b'])
  assert.equal(mergeUsage(crowded, 'cmd:c', 'C', 'commands', 1).length, 1)
})

test('用量存档：读回时坏条目丢掉而不是整表作废', () => {
  withStorage(() => {
    assert.deepEqual(loadUsage(), [])
    recordEverywhereUsage({ id: 'file:a', title: 'a', source: 'project' })
    assert.equal(loadUsage()[0].count, 1)
    recordEverywhereUsage({ id: 'file:a', title: 'a', source: 'project' })
    assert.equal(loadUsage()[0].count, 2)
    localStorage.setItem('taocode.searchEverywhere.usage', JSON.stringify([{ id: 'x' }, 42, { id: 'cmd:a', title: 'A', source: 'commands', count: 3 }]))
    assert.deepEqual(loadUsage().map(entry => entry.id), ['cmd:a'], '缺 count/id 的条目不算数')
    localStorage.setItem('taocode.searchEverywhere.usage', '{{{')
    assert.deepEqual(loadUsage(), [])
  })
})

test('topHitIds：只在查询词非空时给，且必须是当前结果里真的有的那条', () => {
  const usage = [{ id: 'cmd:a', title: 'A', source: 'commands', count: 9 }, { id: 'cmd:z', title: 'Z', source: 'commands', count: 5 }]
  const items = [item('cmd:a', 'commands', '重新构建'), item('cmd:z', 'commands', '别的')]
  assert.deepEqual([...topHitIds(items, usage, '')], [], '空查询没有 pattern ⇒ 没有 Top Hit')
  assert.deepEqual([...topHitIds(items, usage, '重')], ['cmd:a'], '标题不含查询词的用量不能顶上来')
  assert.deepEqual([...topHitIds([item('cmd:a', 'commands', '重新构建')], usage, '重')], ['cmd:a'])
  const wide = [item('cmd:a', 'commands', 'A'), item('cmd:b', 'commands', 'B'), item('cmd:c', 'commands', 'C'), item('cmd:d', 'commands', 'D')]
  const counted = [
    { id: 'cmd:a', title: 'A', source: 'commands', count: 4 },
    { id: 'cmd:b', title: 'B', source: 'commands', count: 3 },
    { id: 'cmd:c', title: 'C', source: 'commands', count: 2 },
    { id: 'cmd:d', title: 'D', source: 'commands', count: 1 },
  ]
  assert.equal(topHitIds(wide, counted, '', TOP_HIT_LIMIT).size, 0)
  assert.equal(topHitIds(wide, counted, 'A B C D', TOP_HIT_LIMIT).size, 0, '标题里没这段的都不算命中')
})

test('pinTopHits：钉在最前，其它条目的相对顺序不动（:129-131 是优先级不是重打分）', () => {
  const items = [item('a', 'project'), item('b', 'project'), item('c', 'project')]
  assert.deepEqual(pinTopHits(items, new Set(['c'])).map(each => each.id), ['c', 'a', 'b'])
  assert.deepEqual(pinTopHits(items, new Set()).map(each => each.id), ['a', 'b', 'c'])
  assert.deepEqual(pinTopHits(items, new Set(['nope'])).map(each => each.id), ['a', 'b', 'c'])
})

test('配平：轮转到达序保证层内条数差不超过 DIFFERENCE_LIMIT，命令条目直通（:63-69）', () => {
  assert.equal(RESULTS_DIFFERENCE_LIMIT, 15)
  assert.equal(TOP_HIT_LIMIT, 3)
  const tiers = { files: 'high', symbols: 'high', commands: 'low' }
  const items = [...many('files', 40), ...many('symbols', 40), ...many('commands', 40).map(entry => ({ ...entry, command: true }))]
  const result = balanceResults(items, tiers)
  // 三层许可是"批次额度"（卡住了才补），最后每家都能出完；配平保证的是**任意前缀**里
  // 同层两家的小差 <= 15，以及某一档不能整段插队（这就是上游这个类存在的理由，:20-30）。
  assert.deepEqual(result.counts, { files: 40, symbols: 40, commands: 40 }, '命令条目不受配额')
  const head = result.taken.slice(0, 30)
  assert.equal(head.filter(entry => entry.provider === 'files').length, 10, '前三十条里文件档只占自己那 10 条')
  assert.equal(head.filter(entry => entry.provider === 'symbols').length, 10)
  assert.equal(head.filter(entry => entry.provider === 'commands').length, 10)
  const starved = balanceResults([...many('files', 40), ...many('symbols', 5)], tiers)
  assert.equal(starved.counts.symbols, 5, '只有 5 条的一家全出')
  assert.equal(starved.taken.slice(0, 10).filter(entry => entry.provider === 'files').length, 5,
    '前十条是两家轮转，文件档不能趁另一家出完就整段插队')
})

test('配平：全部卡住才补额度（balancePermits :99-111），补完继续出', () => {
  const tiers = { files: 'high', symbols: 'high' }
  const result = balanceResults([...many('files', 60), ...many('symbols', 60)], tiers, 2)
  assert.deepEqual(result.counts, { files: 60, symbols: 60 }, '两家都在跑 ⇒ 每轮补 2，直到出完')
  assert.equal(result.blocked, 0)
})

test('配平：nonBlocked 层不限流，low 层在两层都空了之后解除限流（:89-93）', () => {
  const result = balanceResults(
    [...many('files', 50), ...many('text', 50)],
    { files: 'nonBlocked', text: 'low' },
    3,
  )
  assert.equal(result.counts.files, 50)
  assert.equal(result.counts.text, 50, 'nonBlocked 一直在跑 ⇒ low 也在被喂额度（每轮 +3）')
})

test('层归属与本仓供给者的映射：essential 两档是 high，其余 low，nonBlocked 恒空', () => {
  assert.deepEqual(SE_PROVIDER_TIERS, {
    project: 'high', symbols: 'high', commands: 'low', runConfigs: 'low', text: 'low',
  })
  assert.ok(!Object.values(SE_PROVIDER_TIERS).includes('nonBlocked'),
    '本仓没有跨进程供给者（上游前端那份 nonBlocked = remoteEssentialProviders）')
})

test('All 档真的配平：文件铺满列表时其它档仍有机会，且没有一档能占满整张表', () => {
  const items = [
    ...Array.from({ length: 60 }, (_unused, i) => item(`file:${i}`, 'project', `alpha${i}`)),
    item('cmd:1', 'commands', 'alpha'),
    item('text:1', 'text', 'alpha'),
  ]
  const balanced = searchEverywhereResults(items, 'alpha', 'all')
  assert.equal(balanced.length, 50)
  assert.ok(balanced.some(each => each.source === 'commands'), '动作那一档被文件档整段挤掉了')
  assert.ok(balanced.some(each => each.source === 'text'), '文本命中被挤掉了')
  assert.ok(balanced.filter(each => each.source === 'project').length < 50, '文件档一条都没被限流')
  const single = searchEverywhereResults(items, 'alpha', 'project')
  assert.equal(single.filter(each => each.source === 'project').length, 50, '单档 tab 不参与配平')
})

test('其它档不受配平影响，配平开关可关（测试/复用用）', () => {
  const items = Array.from({ length: 40 }, (_unused, i) => item(`file:${i}`, 'project', `alpha${i}`))
  assert.equal(searchEverywhereResults(items, 'alpha', 'project').length, 40)
  assert.equal(searchEverywhereResults(items, 'alpha', 'all', 50, false, () => true, false, () => true, false).length, 40)
})

// ── 生产接线 ─────────────────────────────────────────────────────────────────────
test('对话框把 Top Hit 钉进列表并记一次用量', () => {
  const source = dialogSource()
  assert.match(source, /pinTopHits\(/, '列表没有钉 Top Hit')
  assert.match(source, /topHitIds\(untyped\.value, usage\.value, query\.value\)/, 'Top Hit 候选没有按当前批次与查询词算')
  assert.match(source, /recordEverywhereUsage\(\{ id: item\.id, title: item\.title, source: item\.source \}\)/,
    '选中没有记账 ⇒ 永远不会有 Top Hit')
  assert.match(source, /usage\.value = loadUsage\(\)/, '打开弹层没有读回用量表')
  assert.match(source, /topIds\.has\(entry\.id\) \? TOP_HIT_GROUP_NAME/, '钉住的行没有显示组名')
})

test('All 档的供给者集合与配平同源（tab 表里 all 是唯一并集档）', () => {
  assert.equal(SEARCH_EVERYWHERE_TABS.filter(def => def.sources.length > 3).map(def => def.id).join(','), 'all')
})
