// 市场页搜索框的 `/xxx` 属性词，以及两页之间的搜索交接。
//
// 上游依据（相对 `intellij-community-master/`，行号本轮实数）：
//  · `platform/platform-impl/src/com/intellij/ide/plugins/newui/SearchWords.kt:9-16`
//    词面表：`VENDOR("/vendor:")` :9、`TAG("/tag:")` :10、`SORT_BY("/sortBy:")` :11、
//    `REPOSITORY("/repository:")` :12、`STAFF_PICKS("/staffPicks")` :13、`SUGGESTED("/suggested")` :14、
//    `INTERNAL("/internal")` :15
//  · `platform/platform-impl/src/com/intellij/ide/plugins/newui/SearchQueryParser.kt:24-124`
//    `Marketplace` 的解析：单词早退 :45-48、`:` 结尾吃取值 :53-56、取值缺失退回整条 :57-60、
//    三个布尔词在 addToSearchQuery 的重写里拦下 :68-75、`handleAttribute` 只认四个词 :77-84
//  · `platform/platform-impl/src/com/intellij/ide/plugins/newui/SearchQueryParser.kt:254-257`
//    `getTagQuery`：`/tag:` + 标签名，含空格时包双引号
//  · 排序状态由解析结果决定这条在 `platform/platform-impl/src/com/intellij/ide/plugins/MarketplacePluginsTab.kt:748-755`
//    （`MarketplaceSortByAction.setState`），`/sortBy:` 的词面同时是市场页分组标题写进搜索框的东西
//    （同文件 `:287,298,309`）
//  · 已安装页 → 市场页的交接：`platform/platform-impl/src/com/intellij/ide/plugins/InstalledPluginsTabSearchResultPanel.kt:53-70`
//    （空态正文 :54、八个属性词的排除条件 :56-63、链接文字与回调 :64-69）
//  · 两页选中与启用：`platform/platform-impl/src/com/intellij/ide/plugins/PluginManagerConfigurable.kt:397-401`
//    与 `platform/platform-impl/src/com/intellij/ide/plugins/PluginManagerConfigurablePanel.kt:490-514`
//  · 厂商/标签徽章点出来的词：`platform/platform-impl/src/com/intellij/ide/plugins/newui/PluginDetailsPageComponent.kt:1336`、
//    `platform/platform-impl/src/com/intellij/ide/plugins/newui/PluginTagBadge.kt:29`、
//    点击动作是整框替换 `platform/platform-impl/src/com/intellij/ide/plugins/newui/PluginsTab.kt:271`
//  · 文案键：`platform/platform-api/resources/messages/IdeBundle.properties:1620`（Search in Marketplace）、
//    `:1621`（Nothing found.）、`:1601`（Internal plugins）、`:1605`（Suggested）、
//    `:1618`（Staff Picks）、`:1619`（Repository: {0}）
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import {
  offersMarketplaceSearch,
  parseInstalledQuery,
  vendorQueryWord,
} from '../src/pluginGroups.ts'
import {
  marketplaceEffectiveSort,
  matchesMarketplaceQuery,
  parseMarketplaceQuery,
  tagQueryWord,
} from '../src/pluginMarket.ts'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const read = relative => readFileSync(join(root, relative), 'utf8')

function entry(overrides = {}) {
  return { id: 'demo', name: 'Demo', version: '1.0', file: 'demo.zip', tags: [], ...overrides }
}

test('解析：单个词只能是关键字（SearchQueryParser.kt:45-48 的 size==1 早退）', () => {
  const plain = parseMarketplaceQuery('editor')
  assert.equal(plain.keyword, 'editor')
  assert.deepEqual(plain.vendors, [])
  assert.equal(plain.sortBy, null)
  assert.deepEqual(plain.deferred, [])
  // 空串什么都不产（:42-44）
  assert.equal(parseMarketplaceQuery('').keyword, '')
})

test('解析：/vendor: 与 /tag: 收集取值，重复取值只收一次，含空格的取值走引号', () => {
  const vendors = parseMarketplaceQuery('/vendor:acme /vendor:acme /vendor:beta')
  assert.deepEqual(vendors.vendors, ['acme', 'beta'])
  assert.equal(vendors.keyword, '')

  const quoted = parseMarketplaceQuery('/vendor:"JetBrains s.r.o."')
  assert.deepEqual(quoted.vendors, ['JetBrains s.r.o.'])

  const tags = parseMarketplaceQuery('/tag:editor code')
  // `/tag:` 吃掉的只有紧跟的那一个词，`code` 仍是关键字（:53-56 每次只 index++ 一次）
  assert.deepEqual(tags.tags, ['editor'])
  assert.equal(tags.keyword, 'code')
})

test('解析：/sortBy: 的取值按逐字匹配，认不得就是 null，后一次覆盖前一次（:80 + MarketplaceTabSearchSortByOptions.kt:16-18）', () => {
  assert.equal(parseMarketplaceQuery('/sortBy:downloads').sortBy, 'downloads')
  assert.equal(parseMarketplaceQuery('/sortBy:updated').sortBy, 'updateDate')
  assert.equal(parseMarketplaceQuery('/sortBy:relevance').sortBy, 'relevance')
  // 上游拿 `it.query == query` 逐字比，所以大小写不对就不认
  assert.equal(parseMarketplaceQuery('/sortBy:Updated').sortBy, null)
  assert.equal(parseMarketplaceQuery('/sortBy:bogus').sortBy, null)
  // 赋值语义：后面那条赢
  assert.equal(parseMarketplaceQuery('/sortBy:name /sortBy:rating').sortBy, 'rating')
})

test('解析：取值缺失时整条原样退回关键字并停止（:57-60），不认识的 xxx: 词吃掉取值后什么都不做（:77-84 没有 else）', () => {
  const dangling = parseMarketplaceQuery('foo /tag:')
  assert.deepEqual(dangling.tags, [])
  assert.equal(dangling.keyword, 'foo /tag:')

  const unknown = parseMarketplaceQuery('/foo:bar baz')
  assert.equal(unknown.keyword, 'baz')
  assert.deepEqual(unknown.vendors, [])
})

test('解析：/suggested /internal /staffPicks 是布尔词，不进关键字也不吃取值（:68-75）', () => {
  const suggested = parseMarketplaceQuery('/suggested editor')
  assert.equal(suggested.suggested, true)
  assert.equal(suggested.keyword, 'editor')

  const internal = parseMarketplaceQuery('internal')
  assert.equal(internal.internal, false, '少了斜杠就不是这个词')

  const picks = parseMarketplaceQuery('/staffPicks')
  assert.equal(picks.staffPicks, true)
  assert.equal(picks.keyword, '')
})

test('解析：/repository: 与三个布尔词认识但没有数据源，deferred 里逐条说明', () => {
  const repository = parseMarketplaceQuery('/repository:"Custom Host"')
  assert.deepEqual(repository.repositories, ['Custom Host'])
  assert.deepEqual(repository.deferred, ['仓库主机（/repository:）'])

  const mixed = parseMarketplaceQuery('/suggested /internal /staffPicks')
  assert.deepEqual(mixed.deferred, ['官方精选（/staffPicks）', '推荐（/suggested）', '内部插件（/internal）'])
})

test('排序：查询里的 /sortBy: 覆盖下拉框，没有它时下拉框说了算（MarketplaceSortByAction.setState:748-755）', () => {
  assert.equal(marketplaceEffectiveSort('name', parseMarketplaceQuery('/sortBy:downloads')), 'downloads')
  assert.equal(marketplaceEffectiveSort('name', parseMarketplaceQuery('editor')), 'name')
})

test('标签徽章点出来的词：含空格才加引号（SearchQueryParser.kt:254-257）', () => {
  assert.equal(tagQueryWord('editor'), '/tag:editor')
  assert.equal(tagQueryWord('Code Vision'), '/tag:"Code Vision"')
  // 点出来的词必须能被解析回去（同一套分词器）
  assert.deepEqual(parseMarketplaceQuery(tagQueryWord('Code Vision')).tags, ['Code Vision'])
})

test('过滤：/vendor: 与 /tag: 是叠加收窄，标签按全等（InstalledPluginsTabSearchResultPanel.kt:100 的 intersects）', () => {
  const acme = entry({ id: 'a', name: 'A', vendor: 'Acme Tools', tags: ['editor', 'Code Vision'] })
  const beta = entry({ id: 'b', name: 'B', vendor: 'Beta', tags: ['debugging'] })
  const none = entry({ id: 'c', name: 'C' })
  const all = [acme, beta, none]
  const query = text => ({ keyword: '', category: '', scope: 'all', ...text })
  const ids = list => list.map(item => item.id)

  assert.deepEqual(ids(all.filter(item => matchesMarketplaceQuery(item, query({ vendors: ['acme'] }), []))), ['a'])
  assert.deepEqual(ids(all.filter(item => matchesMarketplaceQuery(item, query({ vendors: ['acme', 'beta'] }), []))), ['a', 'b'])
  // 标签是全等：`editor` 匹配不到 `Code Vision`，反过来也一样
  assert.deepEqual(ids(all.filter(item => matchesMarketplaceQuery(item, query({ tags: ['editor'] }), []))), ['a'])
  assert.deepEqual(ids(all.filter(item => matchesMarketplaceQuery(item, query({ tags: ['code'] }), []))), [])
  assert.deepEqual(ids(all.filter(item => matchesMarketplaceQuery(item, query({ tags: ['Code Vision'] }), []))), ['a'])
  // 与关键字叠加：既要厂商命中，也要关键字命中
  assert.deepEqual(ids(all.filter(item => matchesMarketplaceQuery(item, query({ keyword: 'A', vendors: ['acme'] }), []))), ['a'])
  assert.deepEqual(ids(all.filter(item => matchesMarketplaceQuery(item, query({ keyword: 'B', vendors: ['acme'] }), []))), [])
  // 整条链路：搜索框文本 → 解析 → 过滤
  const parsed = parseMarketplaceQuery('/vendor:acme /tag:editor')
  assert.deepEqual(ids(all.filter(item => matchesMarketplaceQuery(item, {
    keyword: parsed.keyword, category: '', scope: 'all', vendors: parsed.vendors, tags: parsed.tags,
  }, []))), ['a'])
})

test('已安装页空态：什么时候才挂「在市场页搜这个」（InstalledPluginsTabSearchResultPanel.kt:56-63）', () => {
  assert.equal(offersMarketplaceSearch('editor'), true)
  assert.equal(offersMarketplaceSearch('  '), false, '空查询没有可交接的东西')
  // 八个属性词有一个在场就不挂（那已经是筛选，不是找不到）
  for (const word of ['/enabled', '/disabled', '/invalid', '/outdated', '/bundled', '/updatedBundled', '/userInstalled', '/downloaded']) {
    assert.equal(offersMarketplaceSearch(`${word} editor`), false, word)
  }
  // 上游是区分大小写的 contains，本仓照此口径（大写形式仍会给出链接）
  assert.equal(offersMarketplaceSearch('/ENABLED'), true)
})

test('厂商链接点出来的词：含空格才加引号，且能被已安装页解析回去（PluginDetailsPageComponent.kt:1336）', () => {
  assert.equal(vendorQueryWord('Acme'), '/vendor:Acme')
  assert.equal(vendorQueryWord('JetBrains s.r.o.'), '/vendor:"JetBrains s.r.o."')
  assert.deepEqual(parseInstalledQuery(vendorQueryWord('JetBrains s.r.o.')).vendors, ['JetBrains s.r.o.'])
})

test('接线：市场页真的吃解析结果，两页之间的交接都挂着', () => {
  const market = read('src/components/PluginMarketPanel.vue')
  assert.match(market, /const search = computed\(\(\) => parseMarketplaceQuery\(query\.value\)\)/)
  assert.match(market, /vendors: search\.value\.vendors,/)
  assert.match(market, /tags: search\.value\.tags,/)
  assert.match(market, /sortMarketplaceEntries\(filtered, effectiveSort\.value\)/)
  assert.match(market, /:disabled="Boolean\(search\.sortBy\)"/)
  // 徽章点一下 = 整框替换（上游是 setTextIgnoreEvents）
  assert.match(market, /@click="applyQueryWord\(tagQueryWord\(tag\)\)"/)
  assert.equal(/<span v-if="entry\.vendor">/.test(market), false, '没写厂商时不该渲染厂商那一格（上游同处显示 (not specified)）')
  assert.match(market, /<button v-if="entry\.vendor" type="button" class="market-link"[\s\S]{0,120}@click="applyQueryWord\(vendorQueryWord\(entry\.vendor\)\)"/)
  assert.match(market, /query\.value = word/)
  // 已安装/无效的徽章把插件 id 交回父组件
  assert.match(market, /\(event: 'focusPlugin', id: string\): void/)
  assert.match(market, /@click="emit\('focusPlugin', entry\.id\)"/)
  // 没有数据源的词在界面上说清楚，而不是静默失效
  assert.match(market, /const deferredNote = computed/)

  const dialog = read('src/components/PluginDialog.vue')
  // 空态链接 → 切到市场页并把整条查询递过去
  assert.match(dialog, /v-if="offersMarketplaceSearch\(query\)".*@click="searchInMarketplace"/)
  assert.match(dialog, /marketSeed\.value = \{ text: query\.value, stamp: marketSeedStamp \}/)
  assert.match(dialog, /:seed="marketSeed"/)
  assert.match(dialog, /@focus-plugin="focusInstalledPlugin"/)
  // 详情面板的厂商是个可点的链接
  assert.match(dialog, /@click="query = vendorQueryWord\(selected\.vendor \?\? ''\)"/)
  // 外部定位入口的**接收侧**已就绪（调用侧在宿主，见 docs/wiring-requests-2026-10-06-plugins.md P-1）
  assert.match(dialog, /focusPlugin\?: string/)
  assert.match(dialog, /watch\(\(\) => props\.focusPlugin, id => \{[\s\S]{0,60}focusInstalledPlugin\(id\)/)

  // 交接之后不能两头都不动：面板侧确实接了 seed
  assert.match(market, /watch\(\(\) => props\.seed, value => \{/)
})

test('不做假控件：市场页的远程词只有一句话说明，没有渲染成点得动的筛选项', () => {
  const market = read('src/components/PluginMarketPanel.vue')
  // 范围按钮只有 全部/可更新/已安装 三个（来自 MARKETPLACE_SCOPE_LABELS），没有"精选/推荐/内部"的假按钮
  assert.equal(/<button[^>]*>\s*(官方精选|Staff Picks|推荐|Suggested|内部插件|Internal)/.test(market), false)
  // 那四个词只出现在 deferredNote 这一条说明里
  assert.equal(market.includes('deferredNote'), true)
  assert.match(market, /deferredNote[\s\S]{0,80}role="status"/)
})
