// 已安装页的**厂商（vendor）**：清单里的 `<vendor>` → 宿主解析 → 详情面板 → `/vendor:` 搜索。
//
// 上游依据（相对 `intellij-community-master/`，行号本轮实数）：
//  · `platform/pluginSystem/parser/impl/src/com/intellij/platform/pluginSystem/parser/impl/PluginXmlConst.kt:36`
//    `const val VENDOR_ELEM: String = "vendor"`（同文件 `:31-34` 是 `idea-version` 一族）
//  · `platform/core-impl/src/com/intellij/ide/plugins/IdeaPluginDescriptorImpl.kt:224` `override fun getVendor(): String?`
//  · `platform/platform-impl/src/com/intellij/ide/plugins/newui/PluginUiModel.kt:52` `val vendor: String?`
//  · `platform/platform-impl/src/com/intellij/ide/plugins/newui/SearchWords.kt:9` `VENDOR("/vendor:")`
//  · `platform/platform-impl/src/com/intellij/ide/plugins/newui/SearchQueryParser.kt:144-213`
//    取值属性的解析（`:156-167`）与收集（`:202-204`），`:177` 的 `attributes` **不数 vendors**
//  · `platform/platform-impl/src/com/intellij/ide/plugins/InstalledPluginsTabSearchResultPanel.kt:87-94`
//    已安装页真的按 vendors 过滤
//  · `platform/platform-impl/src/com/intellij/ide/plugins/newui/MyPluginModel.kt:1348-1361` `isVendor` 的匹配口径
//  · `platform/platform-api/resources/messages/IdeBundle.properties:455` `plugin.status.not.specified`（没写厂商时的显示）
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import {
  UNSUPPORTED_ATTRIBUTE_WORDS,
  matchesInstalledQuery,
  parseInstalledQuery,
  pluginVendorMatches,
  splitPluginQuery,
} from '../src/pluginGroups.ts'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const read = relative => readFileSync(join(root, relative), 'utf8')

function plugin(overrides = {}) {
  return {
    id: 'demo', name: 'Demo', version: '1.0', description: '', path: 'C:/plugins/demo',
    enabled: true, commands: [], templates: [], ...overrides,
  }
}

test('分词：`/vendor:` 是带取值的属性词，取值与它分成两个词（SearchQueryParser.kt:216-252）', () => {
  assert.deepEqual(splitPluginQuery('/vendor:acme'), ['/vendor:', 'acme'])
  assert.deepEqual(splitPluginQuery('/vendor: acme'), ['/vendor:', 'acme'])
  // 带空格的厂商要引号（上游 `getTagQuery` 的同款写法：`:254-257` 用 StringUtil.wrapWithDoubleQuote）
  assert.deepEqual(splitPluginQuery('/vendor:"JetBrains s.r.o"'), ['/vendor:', 'JetBrains s.r.o'])
})

test('解析：/vendor: 的取值进 vendors，且不参与 attributes（SearchQueryParser.kt:177 只数布尔属性）', () => {
  const single = parseInstalledQuery('/vendor:acme')
  assert.deepEqual(single.vendors, ['acme'])
  assert.equal(single.keyword, '')
  assert.equal(single.attributes, false)
  assert.deepEqual(single.options, [])

  const many = parseInstalledQuery('/vendor:acme /vendor:beta')
  assert.deepEqual(many.vendors, ['acme', 'beta'])

  // 取值相同的重复声明只收一次（上游是 Set，`:128`）
  assert.deepEqual(parseInstalledQuery('/vendor:acme /vendor:acme').vendors, ['acme'])

  // 与布尔属性叠加时各归各的：attributes 仍由布尔属性决定
  const mixed = parseInstalledQuery('/vendor:acme /enabled')
  assert.deepEqual(mixed.vendors, ['acme'])
  assert.deepEqual(mixed.options, ['enabled'])
  assert.equal(mixed.attributes, true)
})

test('解析：取值缺失时整条查询退回关键字并停止解析（:163-166 的 addToSearchQuery(query) + break）', () => {
  const dangling = parseInstalledQuery('/vendor:')
  assert.deepEqual(dangling.vendors, [])
  assert.equal(dangling.keyword, '/vendor:')
  // 后面还有词时，上游把它**无条件当取值**吃掉（`:160-162` 只看 `index < size`，不认词形），
  // 所以 `/vendor: /enabled` 里的 `/enabled` 是厂商名，不是布尔属性。
  const consumes = parseInstalledQuery('/vendor: /enabled')
  assert.deepEqual(consumes.vendors, ['/enabled'])
  assert.deepEqual(consumes.options, [])
  assert.equal(consumes.keyword, '')
})

test('解析：/tag: 与 /updatesFrom: 认识但没有数据源，取值被吃掉且界面要如实说明', () => {
  const tags = parseInstalledQuery('/tag:editor')
  assert.deepEqual(tags.keyword, '')
  assert.deepEqual(tags.deferred, ['tag'])
  assert.deepEqual(tags.vendors, [])
  const source = parseInstalledQuery('/updatesFrom:custom')
  assert.deepEqual(source.deferred, ['updateSource'])
  assert.deepEqual(UNSUPPORTED_ATTRIBUTE_WORDS.length, 2)
})

test('匹配口径（MyPluginModel.kt:1348-1361）：空厂商永不匹配；相等或按忽略大小写包含算命中；多取值是或', () => {
  assert.equal(pluginVendorMatches(plugin({ vendor: 'Acme Tools' }), ['acme tools']), true)
  assert.equal(pluginVendorMatches(plugin({ vendor: '  Acme Tools  ' }), ['Acme Tools']), true)
  assert.equal(pluginVendorMatches(plugin({ vendor: 'Acme Tools' }), ['acme']), true)
  assert.equal(pluginVendorMatches(plugin({ vendor: 'Acme Tools' }), ['tools']), true)
  assert.equal(pluginVendorMatches(plugin({ vendor: 'Acme Tools' }), ['other']), false)
  // 没写厂商（上游 getVendor() 可为 null）：任何 /vendor: 都不匹配它
  assert.equal(pluginVendorMatches(plugin({}), ['acme']), false)
  assert.equal(pluginVendorMatches(plugin({ vendor: '   ' }), ['acme']), false)
  // 多个取值之间是**或**（`:1354-1358` 命中任意一个就 return true）
  assert.equal(pluginVendorMatches(plugin({ vendor: 'Acme' }), ['other', 'acme']), true)
})

test('过滤：已安装页按 vendors 收窄，且与布尔属性叠加（InstalledPluginsTabSearchResultPanel.kt:87-94）', () => {
  const acme = plugin({ id: 'a', name: 'A', vendor: 'Acme' })
  const beta = plugin({ id: 'b', name: 'B', vendor: 'Beta Corp' })
  const none = plugin({ id: 'c', name: 'C' })
  const all = [acme, beta, none]
  const ids = list => list.map(item => item.id)

  assert.deepEqual(ids(all.filter(item => matchesInstalledQuery(item, parseInstalledQuery('/vendor:acme')))), ['a'])
  assert.deepEqual(ids(all.filter(item => matchesInstalledQuery(item, parseInstalledQuery('/vendor:corp')))), ['b'])
  assert.deepEqual(ids(all.filter(item => matchesInstalledQuery(item, parseInstalledQuery('/vendor:acme /vendor:beta')))), ['a', 'b'])
  // 厂商 + 关键字是与关系
  assert.deepEqual(ids(all.filter(item => matchesInstalledQuery(item, parseInstalledQuery('/vendor:acme zz')))), [])
  // 没写 /vendor: 时厂商不参与关键字匹配（关键字仍只吃名称/id/描述/版本/类目/依赖）
  assert.deepEqual(ids(all.filter(item => matchesInstalledQuery(item, parseInstalledQuery('acme')))), [])
})

test('接线：厂商从清单解析、进 JSON、进详情面板与搜索语法', () => {
  const header = read('native/plugins.hpp')
  assert.match(header, /std::string vendor;/)
  const source = read('native/plugins.cpp')
  assert.match(source, /plugin\.vendor = text_or\(document, "vendor", 120\)/)
  assert.match(source, /\{"vendor", plugin\.vendor\}/)
  const dialog = read('src/components/PluginDialog.vue')
  assert.match(dialog, /selected\.vendor/)
  assert.match(dialog, /\/vendor:厂商/)
})
