// 插件页搜索框的「属性词 / 取值建议浮层」判据。
//
// 上游依据（相对 `intellij-community-master/`，行号本轮实数）：
//  · `platform/platform-impl/src/com/intellij/ide/plugins/newui/SearchPopupController.java`
//    `handleShowPopup` :40-64（光标决定弹不弹 :45-54、弹词还是弹取值 :56-63）
//    `parseAttributeInQuery` :70-100（往左先遇 `:` 还是先遇空格）
//    `showAttributesPopup` :102-122（选中词名后接着开取值表 :117-119）
//    `handleShowAttributeValuesPopup` :124-148（取值表为空就不弹 :125-129、选中值走 wrapAttribute :144）
//    `noPrefixSearchValues` :184-210（空白前缀不过滤 :185-187、前缀与词**完全相等**时收起 :191-194、
//    忽略大小写前缀留删 :196-201、筛空退回搜索面板 :204-207）
//    `appendSearchText` :234-259（前缀只在候选确实以它开头时才删 :251-253、光标落回插入段之后 :258）
//    `handleEnter` :261-268、`handleUpDown` :273-284（第一次 Down 选中第 0 项 :275-277）
//  · `platform/platform-impl/src/com/intellij/ide/plugins/newui/PluginsTab.kt`
//    Ctrl+Space :118-125（空文本给整张词表）、浮层已开时不再开 :190-193
//    Enter :144-153、Esc :162-184（先收浮层，没浮层才清文本）、打字后重算 :217-236
//  · 词表：`platform/platform-impl/src/com/intellij/ide/plugins/InstalledPluginsTab.kt:404-419`
//    与 `platform/platform-impl/src/com/intellij/ide/plugins/MarketplacePluginsTab.kt:378-392`
//  · 取值表：`InstalledPluginsTab.kt:421-435` 与 `MarketplacePluginsTab.kt:394-408`
//  · 厂商集合的排序：`platform/platform-impl/src/com/intellij/ide/plugins/newui/MyPluginModel.kt:838-849`
//    （计数多的在前，同数按名字忽略大小写倒序）与 `:1336-1345`（trim、空白丢掉、按插件计数）
//  · 标签集合：`newui/MyPluginModel.kt:851-860`（`TreeSet(CASE_INSENSITIVE_ORDER)`）与
//    `MarketplacePluginsTab.kt:504-527`（HashSet 去重 + `String.CASE_INSENSITIVE_ORDER` 排）
//  · 厂商取值不排序：`MarketplacePluginsTab.kt:483-502`（`LinkedHashSet`）
//  · 词面表：`newui/SearchWords.kt:9-16`；`/sortBy:` 的四个取值：
//    `MarketplacePluginsTab.kt:398-403` 的 query（`MarketplaceTabSearchSortByOptions.kt:11-15`）
//  · `newui/SearchQueryParser.kt:259-262` `wrapAttribute`：含空格、逗号、冒号才包双引号
//  · 上游自己按数据条件裁剪词表：`InstalledPluginsTab.kt:415-417`、`MarketplacePluginsTab.kt:383-390`
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import {
  INSTALLED_SUGGEST_WORDS,
  MARKETPLACE_SORT_BY_VALUES,
  MARKETPLACE_SUGGEST_WORDS,
  NO_SUGGESTION,
  applySuggestion,
  attributeTokenAtCaret,
  filterWordsByPrefix,
  installedVendorValues,
  marketplaceTagValues,
  marketplaceVendorValues,
  moveSuggestion,
  showsAttributesAtCaret,
  suggestionKeyAction,
  suggestionState,
  wrapAttributeValue,
} from '../src/pluginSearchSuggest.ts'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const read = relative => readFileSync(join(root, relative), 'utf8')

/** 已安装页的取值表：`InstalledPluginsTab.kt:421-435` 只有 `/vendor:` 给得出集合。 */
const installedValues = vendorsByWord => attribute => (attribute === '/vendor:' ? vendorsByWord : [])
/** 市场页的取值表：`MarketplacePluginsTab.kt:394-408` 给 tag / sortBy / vendor 三个。 */
const marketValues = data => attribute => {
  if (attribute === '/tag:') return data.tags
  if (attribute === '/sortBy:') return data.sorts
  if (attribute === '/vendor:') return data.vendors
  return []
}

test('词表：两条页各按上游顺序，且只留本仓有数据的词', () => {
  // `InstalledPluginsTab.kt:406-414` 的次序；`/bundled` `:411-412` 与 `/tag:` `:414`、
  // `/updatesFrom:` `:415-417` 本仓没有数据源，上游自己也是按条件往里加的，所以不进表。
  assert.deepEqual([...INSTALLED_SUGGEST_WORDS], ['/userInstalled', '/outdated', '/enabled', '/disabled', '/invalid', '/vendor:'])
  // `MarketplacePluginsTab.kt:380-382` 的次序（`/repository:` `:383-385`、`/staffPicks` `:386`、
  // `/suggested` `:387`、`/internal` `:388-390` 同理没有数据源）。
  assert.deepEqual([...MARKETPLACE_SUGGEST_WORDS], ['/tag:', '/sortBy:', '/vendor:'])
  assert.equal(INSTALLED_SUGGEST_WORDS.some(word => word.includes('bundled')), false)
  assert.equal(MARKETPLACE_SUGGEST_WORDS.some(word => /staffPicks|suggested|internal|repository/.test(word)), false)
  // `/sortBy:` 的取值是四条、顺序照 `:398-403`，**不含 relevance**（`MarketplaceTabSearchSortByOptions.kt:11-15` 有五条）。
  assert.deepEqual([...MARKETPLACE_SORT_BY_VALUES], ['downloads', 'name', 'rating', 'updated'])
})

test('光标前那一段：先遇冒号算取值，先遇空格算词名（parseAttributeInQuery :70-100）', () => {
  assert.deepEqual(attributeTokenAtCaret('/ven', 4), { name: '/ven', value: null, start: 0 })
  assert.deepEqual(attributeTokenAtCaret('/vendor:', 8), { name: '/vendor:', value: '', start: 8 })
  assert.deepEqual(attributeTokenAtCaret('/vendor:Jo', 10), { name: '/vendor:', value: 'Jo', start: 8 })
  // 光标停在词中间时只看它左边那一段（上游从 `end - 1` 往左扫，不看当前那位）。
  assert.deepEqual(attributeTokenAtCaret('/vendor:Acme', 5), { name: '/vend', value: null, start: 0 })
  // 前一个词已经完整时，起点是空格后一位（`:82-86` 的第二个 while）。
  assert.deepEqual(attributeTokenAtCaret('/enabled /ve', 12), { name: '/ve', value: null, start: 9 })
  assert.deepEqual(attributeTokenAtCaret('/enabled /vendor:Jo', 19), { name: '/vendor:', value: 'Jo', start: 17 })
  // 取值里已有的引号属于前缀的一部分（`value = substring(index + 1, end)` 是从冒号后一位起算的）。
  assert.deepEqual(attributeTokenAtCaret('/tag:"Lin', 9), { name: '/tag:', value: '"Lin', start: 5 })
})

test('光标决定弹不弹（handleShowPopup :45-54）', () => {
  assert.equal(showsAttributesAtCaret('/ven', 4), true)
  assert.equal(showsAttributesAtCaret('/vendor:Acme', 5), false, '光标在词中间（那位不是空格）：交给搜索面板那支')
  assert.equal(showsAttributesAtCaret('/enabled ', 9), false, '末尾是空格：交给搜索面板那支')
  assert.equal(showsAttributesAtCaret('/enabled ', 8), true, '光标后正好是空格：接着弹（前缀是左边那段）')
  assert.equal(showsAttributesAtCaret('/a /b', 2), true, '光标后正好是空格：弹（前缀是左边那段）')
})

test('前缀筛词（noPrefixSearchValues :184-210）', () => {
  assert.deepEqual(filterWordsByPrefix(['/vendor:', '/tag:'], null), { words: ['/vendor:', '/tag:'], hide: false, empty: false })
  assert.deepEqual(filterWordsByPrefix(['/vendor:', '/tag:'], '  '), { words: ['/vendor:', '/tag:'], hide: false, empty: false })
  // 前缀与某个词**完全相等**：收起浮层（`:191-194`），不是筛出一条留着。
  assert.deepEqual(filterWordsByPrefix(['/vendor:', '/tag:'], '/vendor:'), { words: [], hide: true, empty: false })
  // 忽略大小写的前缀留删（`:196`）。
  assert.deepEqual(filterWordsByPrefix(['/vendor:', '/tag:', '/sortBy:'], '/V').words, ['/vendor:'])
  assert.deepEqual(filterWordsByPrefix(['/vendor:'], '/zz'), { words: [], hide: false, empty: true })
})

test('一次完整的建议：词表 / 取值表 / 退回搜索面板 / 空文本', () => {
  const values = installedValues(['Acme Labs', 'Beta'])
  // 空文本打字不弹（`PluginsTab.kt:229-231` 是收起），Ctrl+Space 才给整张词表（`:119-121`）。
  assert.deepEqual(suggestionState('', 0, INSTALLED_SUGGEST_WORDS, values), NO_SUGGESTION)
  assert.deepEqual(suggestionState('', 0, INSTALLED_SUGGEST_WORDS, values, true),
    { kind: 'attributes', words: [...INSTALLED_SUGGEST_WORDS], prefix: null, attribute: '', start: 0 })
  // 词名前缀 → 词表，只留对得上的。
  assert.equal(suggestionState('/v', 2, INSTALLED_SUGGEST_WORDS, values).kind, 'attributes')
  assert.deepEqual(suggestionState('/v', 2, INSTALLED_SUGGEST_WORDS, values).words, ['/vendor:'])
  // 完整词名 → 收起（上游那条 equals 早退）。
  assert.equal(suggestionState('/enabled', 8, INSTALLED_SUGGEST_WORDS, values).kind, 'none')
  // 冒号后 → 取值表；取值集合空时退回搜索面板（`SearchPopupController.java:125-129`）。
  assert.deepEqual(suggestionState('/vendor:', 8, INSTALLED_SUGGEST_WORDS, values),
    { kind: 'values', words: ['Acme Labs', 'Beta'], prefix: '', attribute: '/vendor:', start: 8 })
  assert.equal(suggestionState('/vendor:', 8, INSTALLED_SUGGEST_WORDS, installedValues([])).kind, 'query')
  assert.deepEqual(suggestionState('/vendor:A', 9, INSTALLED_SUGGEST_WORDS, values).words, ['Acme Labs'])
  // 布尔词没有冒号，永远走词表那支；取值表只由带冒号的词决定。
  assert.equal(suggestionState('/outdated', 9, INSTALLED_SUGGEST_WORDS, values).kind, 'none')
  // 市场页：`/sortBy:` 的取值是那四条。
  const mv = marketValues({ tags: ['Linter'], sorts: MARKETPLACE_SORT_BY_VALUES, vendors: ['Acme Labs'] })
  assert.deepEqual(suggestionState('/sortBy:', 8, MARKETPLACE_SUGGEST_WORDS, mv).words, [...MARKETPLACE_SORT_BY_VALUES])
  assert.deepEqual(suggestionState('/sortBy:d', 9, MARKETPLACE_SUGGEST_WORDS, mv).words, ['downloads'])
  assert.deepEqual(suggestionState('/tag:', 5, MARKETPLACE_SUGGEST_WORDS, mv).words, ['Linter'])
})

test('wrapAttribute：含空格 / 逗号 / 冒号才加引号（SearchQueryParser.kt:259-262）', () => {
  assert.equal(wrapAttributeValue('Acme'), 'Acme')
  assert.equal(wrapAttributeValue('John Doe'), '"John Doe"')
  assert.equal(wrapAttributeValue('a,b'), '"a,b"')
  assert.equal(wrapAttributeValue('a:b'), '"a:b"')
})

test('接上选中项：替换前缀、接回残留、光标落回插入段之后（appendSearchText :234-259）', () => {
  // 词名前缀：`/ven` 换成 `/vendor:`，光标停在新词之后。
  assert.deepEqual(applySuggestion('/ven', 4, '/vendor:', '/ven'), { text: '/vendor:', caret: 8 })
  // 前缀为空（刚打完冒号）：直接接在光标处。
  assert.deepEqual(applySuggestion('/vendor:', 8, 'Acme', ''), { text: '/vendor:Acme', caret: 12 })
  // 光标后有残留时原样接回（`:243-246`）。
  assert.deepEqual(applySuggestion('/vendor: tag:x', 8, 'Acme', ''), { text: '/vendor:Acme tag:x', caret: 12 })
  // 前缀对不上候选：原样插在光标处，不删任何东西。
  assert.deepEqual(applySuggestion('/tag:Li', 7, 'Linter', 'Li'), { text: '/tag:Linter', caret: 11 })
  // 取值本身带引号时，「用户已经打了引号」与「还没打」两种都照顾到（`:251` 的两个条件）。
  assert.deepEqual(applySuggestion('/vendor:"Jo', 11, '"John Doe"', '"Jo'), { text: '/vendor:"John Doe"', caret: 18 })
  assert.deepEqual(applySuggestion('/vendor:Jo', 10, '"John Doe"', 'Jo'), { text: '/vendor:"John Doe"', caret: 18 })
  assert.deepEqual(applySuggestion('/vendor:Zz', 10, 'Acme', 'Zz'), { text: '/vendor:ZzAcme', caret: 14 })
})

test('取值集合的形状：厂商按插件数排（同数按名倒序）、标签忽略大小写排、市场厂商不排序', () => {
  // `MyPluginModel.kt:1336-1345`：trim 后空白不算厂商；`:838-849`：计数多的在前，同数按名字忽略大小写**倒序**。
  const plugins = [
    { vendor: 'Beta' }, { vendor: 'Beta' }, { vendor: 'Acme' },
    { vendor: '   ' }, {}, { vendor: ' zeta ' },
  ]
  assert.deepEqual(installedVendorValues(plugins), ['Beta', 'zeta', 'Acme'])
  // 同数且只差大小写的两种写法在那个 TreeSet 里是同一个元素（`:844` 的比较器返回 0）→ 只留先进去的。
  assert.deepEqual(installedVendorValues([{ vendor: 'Alpha' }, { vendor: 'ALPHA' }]), ['Alpha'])
  // 计数不同的两种写法比较器非 0 → 两个都留，按计数排。
  assert.deepEqual(installedVendorValues([{ vendor: 'Beta' }, { vendor: 'Beta' }, { vendor: 'BETA' }]), ['Beta', 'BETA'])
  // 市场页标签：`MarketplacePluginsTab.kt:508`（HashSet 只去**完全相同**的，`linter` 与 `Linter` 都留）
  // + `:524`（`String.CASE_INSENSITIVE_ORDER` 排，差的相等时稳定排序按先见的在前）。
  assert.deepEqual(marketplaceTagValues([{ tags: ['linter', 'Async', 'async', 'Babel'] }, { tags: ['Linter'] }]),
    ['Async', 'async', 'Babel', 'linter', 'Linter'])
  // 市场页厂商：`:483-502` 的 LinkedHashSet —— 去重相同写法、**不排序**、空白丢掉。
  assert.deepEqual(marketplaceVendorValues([{ vendor: 'JetBrains' }, { vendor: 'acme' }, { vendor: 'JetBrains' }, { vendor: ' ' }]),
    ['JetBrains', 'acme'])
})

test('上下键：第一次 Down 选中第 0 项，表内钳位（SearchPopupController.java:273-284）', () => {
  assert.equal(moveSuggestion(-1, 5, 'down'), 0)
  assert.equal(moveSuggestion(0, 5, 'down'), 1)
  assert.equal(moveSuggestion(4, 5, 'down'), 4, '到底停住（本仓选择：DOM 没有 JList 的焦点转移语义）')
  assert.equal(moveSuggestion(2, 5, 'up'), 1)
  assert.equal(moveSuggestion(0, 5, 'up'), 0)
  // 没有选中项时按 Up 不凭空选中最后一项 —— 上游那一路是把事件丢给 JList，参考树里看不到结果。
  assert.equal(moveSuggestion(-1, 5, 'up'), -1)
  assert.equal(moveSuggestion(-1, 0, 'down'), -1)
})

test('按键分派：Ctrl+Space / 方向键 / Enter / Esc 各按上游那一支', () => {
  const attributeState = { kind: 'attributes', words: ['/vendor:', '/invalid'], prefix: '/v', attribute: '', start: 0 }
  const valueState = { kind: 'values', words: ['Acme', 'Beta'], prefix: '', attribute: '/vendor:', start: 8 }
  // Ctrl+Space：浮层没开时才要（`PluginsTab.kt:190-193`）。
  assert.deepEqual(suggestionKeyAction({ key: ' ', ctrlKey: true, query: '', caret: 0, state: NO_SUGGESTION, index: -1 }),
    { caret: 0, index: -1, dismiss: false, clear: false, completesBlank: true, consumed: true })
  assert.equal(suggestionKeyAction({ key: ' ', ctrlKey: true, query: '/v', caret: 2, state: attributeState, index: -1 }).completesBlank, false)
  // 浮层没开时方向键不拦（`SearchUpDownPopupController.java:31-38` 那一路是交给插件列表）。
  assert.equal(suggestionKeyAction({ key: 'ArrowDown', ctrlKey: false, query: '', caret: 0, state: NO_SUGGESTION, index: -1 }).consumed, false)
  assert.equal(suggestionKeyAction({ key: 'ArrowDown', ctrlKey: false, query: '/v', caret: 2, state: attributeState, index: -1 }).index, 0)
  // Enter 有选中项：把候选接进文本；选中的是**取值**时浮层收起（`:145` 的 handleShowPopupForQuery）。
  const accepted = suggestionKeyAction({ key: 'Enter', ctrlKey: false, query: '/vendor:', caret: 8, state: valueState, index: 1 })
  assert.equal(accepted.text, '/vendor:Beta')
  assert.equal(accepted.caret, 12)
  assert.equal(accepted.dismiss, true)
  assert.equal(accepted.index, -1)
  assert.equal(accepted.consumed, true)
  // 选中词名：不收起，等着接取值表（`:117-119`）。
  const named = suggestionKeyAction({ key: 'Enter', ctrlKey: false, query: '/v', caret: 2, state: attributeState, index: 0 })
  assert.equal(named.text, '/vendor:')
  assert.equal(named.dismiss, false)
  // Enter 没有选中项：收浮层并按当前文本搜（`PluginsTab.kt:145-150`）；空文本时上游什么都不做。
  assert.deepEqual(suggestionKeyAction({ key: 'Enter', ctrlKey: false, query: '/vendor:Acme', caret: 12, state: NO_SUGGESTION, index: -1 }),
    { caret: 12, index: -1, dismiss: true, clear: false, completesBlank: false, consumed: true })
  assert.equal(suggestionKeyAction({ key: 'Enter', ctrlKey: false, query: '', caret: 0, state: NO_SUGGESTION, index: -1 }).dismiss, false)
  // Esc：有浮层只收浮层，没浮层且文本非空才清文本（`PluginsTab.kt:162-184`，文本空时那个动作是 disabled 的）。
  assert.deepEqual(suggestionKeyAction({ key: 'Escape', ctrlKey: false, query: '/v', caret: 2, state: attributeState, index: 0 }),
    { caret: 2, index: 0, dismiss: true, clear: false, completesBlank: false, consumed: true })
  assert.equal(suggestionKeyAction({ key: 'Escape', ctrlKey: false, query: '/vendor:Acme', caret: 12, state: NO_SUGGESTION, index: -1 }).clear, true)
  assert.equal(suggestionKeyAction({ key: 'Escape', ctrlKey: false, query: '', caret: 0, state: NO_SUGGESTION, index: -1 }).clear, false)
})

test('接线：两页的搜索框都挂着建议浮层，取值只来自本页真实数据', () => {
  const dialog = read('src/components/PluginDialog.vue')
  const market = read('src/components/PluginMarketPanel.vue')
  // 词表与取值表按页接好：已安装页只答 `/vendor:`（标签与更新源没有数据源）。
  assert.match(dialog, /from '\.\.\/pluginSearchSuggest'/)
  assert.match(dialog, /suggestionState\(query\.value, caret\.value, INSTALLED_SUGGEST_WORDS, installedSuggestValues, blankCompletes\.value\)/)
  assert.match(dialog, /attribute === SEARCH_WORD_VENDOR \? installedVendorValues\(props\.plugins\) : \[\]/)
  // 市场页三张取值表都从读出来的清单取。
  assert.match(market, /from '\.\.\/pluginSearchSuggest'/)
  assert.match(market, /suggestionState\(query\.value, caret\.value, MARKETPLACE_SUGGEST_WORDS, marketplaceSuggestValues, blankCompletes\.value\)/)
  assert.match(market, /marketplaceTagValues\(catalog\.value\)/)
  assert.match(market, /marketplaceVendorValues\(catalog\.value\)/)
  // 两个框的键盘与鼠标入口都在，且浮层没有候选时整块不渲染（不放假控件）。
  for (const source of [dialog, market]) {
    assert.match(source, /@keydown="onSearchKeydown"/)
    assert.match(source, /@keyup="onSearchKeyup"/)
    assert.match(source, /@input="syncSuggestCaret"/)
    assert.match(source, /suggestionKeyAction\(\{ key: event\.key/)
    assert.match(source, /v-if="suggestVisible"/)
    assert.match(source, /@mousedown\.prevent="acceptSuggestion\(word\)"/)
    assert.match(source, /role="listbox"/)
    assert.match(source, /role="option"/)
  }
  // 取值走 wrapAttribute，带空格的厂商/标签才会被引号包住（与解析端同一口径）。
  assert.match(dialog, /current\.kind === 'values' \? wrapAttributeValue\(word\) : word/)
  assert.match(market, /current\.kind === 'values' \? wrapAttributeValue\(word\) : word/)
})
