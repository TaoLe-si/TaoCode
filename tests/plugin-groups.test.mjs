// 插件页的**分组、类目与搜索查询**（IDEA `PluginsGroupType` / `PluginsGroup` /
// `InstalledPluginsTab` / `SearchQueryParser` 的行为）。
//
// 这里只测不碰 RPC 的那一半规则；原生侧（清单解析、zip 安装、启停）由 `native/plugins_test.cpp` 覆盖。
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import {
  PLUGIN_GROUP_TYPES,
  PLUGIN_OTHER_CATEGORY,
  PLUGIN_GROUP_PREFIX,
  SUPPORTED_SEARCH_OPTIONS,
  INSTALLED_SEARCH_OPTIONS,
  INSTALLED_OPTION_LABEL,
  buildInstalledGroups,
  groupPluginsByCategory,
  installedQueryOptions,
  installedSearchQuery,
  matchesInstalledQuery,
  parseInstalledQuery,
  pluginCategory,
  pluginEnabledCount,
  pluginGroupTitle,
  pluginGroupTitleWithEnabled,
  pluginGroupToggleLabel,
  pluginIsEnabled,
  sortPluginGroups,
  sortPluginsByName,
  splitPluginQuery,
  toggleInstalledSearchOption,
} from '../src/pluginGroups.ts'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const read = relative => readFileSync(join(root, relative), 'utf8')

function plugin(overrides = {}) {
  return {
    id: 'alpha', name: 'Alpha', version: '1.0', description: '第一个插件', path: 'C:/p/alpha',
    enabled: true, commands: [], templates: [], ...overrides,
  }
}

test('分组类型枚举与 IDEA 的 PluginsGroupType 逐项一致（PluginsGroupType.kt:7-21）', () => {
  assert.deepEqual(PLUGIN_GROUP_TYPES, [
    'BUNDLED_UPDATE', 'UPDATE', 'INSTALLING', 'INSTALLED', 'SEARCH_INSTALLED', 'SEARCH', 'STAFF_PICKS',
    'NEW_AND_UPDATED', 'TOP_DOWNLOADS', 'TOP_RATED', 'CUSTOM_REPOSITORY', 'INTERNAL', 'SUGGESTED',
  ])
  assert.equal(PLUGIN_GROUP_TYPES.length, 13)
})

test('组标题照 PluginsGroup.kt 的两种形态：计数与“已启用 n/m”', () => {
  // titleWithCount()：前缀 + " (n)"
  assert.equal(pluginGroupTitle(PLUGIN_GROUP_PREFIX.installing, 3), '正在安装 (3)')
  // titleWithCount(enabled)：IdeBundle.properties:1671 的 "{0} ({1} of {2} enabled)"
  assert.equal(
    pluginGroupTitleWithEnabled(PLUGIN_GROUP_PREFIX.userInstalled, 2, 5),
    '用户安装（已启用 2/5）',
  )
})

test('组级动作文案随“是否全员未启用”翻转（ComparablePluginsGroup:714-718）', () => {
  assert.equal(pluginGroupToggleLabel(0), '全部启用')
  assert.equal(pluginGroupToggleLabel(1), '全部禁用')
  assert.equal(pluginGroupToggleLabel(7), '全部禁用')
})

test('缺省类目是 Other Tools（IdeBundle.properties:1599）', () => {
  assert.equal(PLUGIN_OTHER_CATEGORY, 'Other Tools')
  assert.equal(pluginCategory(plugin()), PLUGIN_OTHER_CATEGORY)
  assert.equal(pluginCategory(plugin({ category: '   ' })), PLUGIN_OTHER_CATEGORY)
  assert.equal(pluginCategory(plugin({ category: ' 版本控制 ' })), '版本控制')
})

test('“已启用”的判定排除清单读取失败的插件（InstalledPluginsTab.kt:696-708）', () => {
  assert.equal(pluginIsEnabled(plugin()), true)
  assert.equal(pluginIsEnabled(plugin({ enabled: false })), false)
  assert.equal(pluginIsEnabled(plugin({ error: '缺少 plugin.json' })), false)
  assert.equal(pluginEnabledCount([
    plugin(), plugin({ id: 'b', enabled: false }), plugin({ id: 'c', error: '坏清单' }),
  ]), 1)
})

test('正在安装组：有成员才出现，且没有启停动作；安装完就消失', () => {
  const plugins = [plugin({ id: 'alpha' }), plugin({ id: 'beta', name: 'Beta' })]
  assert.deepEqual(buildInstalledGroups(plugins, []).map(group => group.type), ['INSTALLED'])
  const groups = buildInstalledGroups(plugins, ['beta'])
  assert.deepEqual(groups.map(group => group.type), ['INSTALLING', 'INSTALLED'])
  assert.equal(groups[0].title, '正在安装 (1)')
  assert.deepEqual(groups[0].plugins.map(item => item.id), ['beta'])
  assert.equal(groups[0].action, null)
  assert.deepEqual(groups[1].plugins.map(item => item.id), ['alpha'])
  // 安装源还没解开清单时只有名字：待装条目进 pending，计数照样算
  const [pending] = buildInstalledGroups(plugins, ['my-plugin-1.0.zip'])
  assert.equal(pending.title, '正在安装 (1)')
  assert.deepEqual(pending.pending, ['my-plugin-1.0.zip'])
  assert.deepEqual(pending.plugins, [])
  // `sorted = false` 时保留调用方顺序（界面上的“按目录顺序”开关）
  const unsorted = buildInstalledGroups(
    [plugin({ id: 'c', name: 'cherry' }), plugin({ id: 'a', name: 'Apple' })], [], false,
  )
  assert.deepEqual(unsorted[0].plugins.map(item => item.id), ['c', 'a'])
})

test('用户安装组：标题带“已启用 n/m”，坏插件既不计入启用也不进动作的 ids', () => {
  const plugins = [
    plugin({ id: 'alpha', name: 'Alpha' }),
    plugin({ id: 'beta', name: 'Beta', enabled: false }),
    plugin({ id: 'gamma', name: 'Gamma', error: 'plugin.json 不是合法 JSON' }),
  ]
  const [group] = buildInstalledGroups(plugins)
  assert.equal(group.title, '用户安装（已启用 1/3）')
  assert.deepEqual(group.plugins.map(item => item.id), ['alpha', 'beta', 'gamma'])
  assert.equal(group.action.kind, 'disableAll')
  assert.deepEqual(group.action.ids, ['alpha', 'beta'])
  assert.equal(group.action.label, '全部禁用')
})

test('全部禁用时组级动作变成“全部启用”', () => {
  const [group] = buildInstalledGroups([plugin({ id: 'alpha', enabled: false })])
  assert.equal(group.title, '用户安装（已启用 0/1）')
  assert.equal(group.action.kind, 'enableAll')
  assert.equal(group.action.label, '全部启用')
})

test('组内按名称排序（PluginsGroup.kt:146-155，忽略大小写）', () => {
  const sorted = sortPluginsByName([
    plugin({ id: 'c', name: 'cherry' }), plugin({ id: 'a', name: 'Apple' }), plugin({ id: 'b', name: 'banana' }),
  ])
  assert.deepEqual(sorted.map(item => item.id), ['a', 'b', 'c'])
  // 没有 name 时退回 id（本仓的坏清单就是这种）
  const fallback = sortPluginsByName([plugin({ id: 'zeta', name: '' }), plugin({ id: 'alpha', name: '' })])
  assert.deepEqual(fallback.map(item => item.id), ['alpha', 'zeta'])
})

test('类目分组：缺省类目排在最后（InstalledPluginsTab.kt:283-288）', () => {
  const groups = groupPluginsByCategory([
    plugin({ id: 'x', name: 'X', category: '中文类目' }),
    plugin({ id: 'y', name: 'Y' }),
    plugin({ id: 'z', name: 'Z', category: 'AAA' }),
  ])
  assert.deepEqual(groups.map(group => group.prefix), ['AAA', '中文类目', 'Other Tools'])
  const other = groups.find(group => group.prefix === PLUGIN_OTHER_CATEGORY)
  assert.deepEqual(other.plugins.map(item => item.id), ['y'])
})

test('组排序：缺省类目永远最后，其余按标题前缀比较', () => {
  const sorted = sortPluginGroups([
    { title: 'Other Tools（已启用 0/1）', prefix: 'Other Tools' },
    { title: 'beta（已启用 0/1）', prefix: 'beta' },
    { title: 'Alpha（已启用 0/1）', prefix: 'Alpha' },
  ])
  assert.deepEqual(sorted.map(group => group.prefix), ['Alpha', 'beta', 'Other Tools'])
})

test('分词照 splitQuery：双引号成组，冒号也是分隔符（SearchQueryParser.kt:216-252）', () => {
  assert.deepEqual(splitPluginQuery('alpha beta'), ['alpha', 'beta'])
  assert.deepEqual(splitPluginQuery('  alpha   beta '), ['alpha', 'beta'])
  assert.deepEqual(splitPluginQuery('"two words" beta'), ['two words', 'beta'])
  // `/tag:java` 切成 `/tag:` + `java`（SearchWords.kt:10 的 TAG 值本身就带冒号）
  assert.deepEqual(splitPluginQuery('/tag:java'), ['/tag:', 'java'])
  // 未闭合的引号直接停住（源码 `if (end == -1) break`）
  assert.deepEqual(splitPluginQuery('alpha "unterminated'), ['alpha'])
})

test('查询词与 IDEA 一致，NeedUpdate 是 /outdated 特例', () => {
  assert.equal(installedSearchQuery('enabled'), '/enabled')
  assert.equal(installedSearchQuery('disabled'), '/disabled')
  assert.equal(installedSearchQuery('invalid'), '/invalid')
  assert.equal(installedSearchQuery('userInstalled'), '/userInstalled')
  assert.equal(installedSearchQuery('needUpdate'), '/outdated')
  assert.equal(installedSearchQuery('bundled'), '/bundled')
  assert.equal(installedSearchQuery('updatedBundled'), '/updatedBundled')
  assert.equal(INSTALLED_SEARCH_OPTIONS.length, 7)
  assert.equal(INSTALLED_OPTION_LABEL.needUpdate, '需要更新')
})

test('解析 /xxx：支持 /downloaded 别名与大小写，属性与关键字分开', () => {
  const parsed = parseInstalledQuery('/enabled /DOWNLOADED foo bar')
  assert.deepEqual(parsed.options, ['enabled', 'userInstalled'])
  assert.equal(parsed.keyword, 'foo bar')
  assert.equal(parsed.attributes, true)
  // /bundled 本仓没有数据源：解析出来但不参与过滤，如实报给 UI；/outdated 已有真实数据源
  // （市场页的本地仓库目录，见 tests/plugin-market.test.mjs 与 matchesInstalledQuery 的 updateIds）。
  const unsupported = parseInstalledQuery('/outdated /bundled alpha')
  assert.deepEqual(unsupported.options, ['needUpdate'])
  assert.deepEqual(unsupported.unsupported, ['bundled'])
  assert.equal(unsupported.attributes, true)
  // 认不出的 /xyz 既不报错也不当关键字
  const unknown = parseInstalledQuery('/nope alpha')
  assert.deepEqual(unknown.options, [])
  assert.deepEqual(unknown.unsupported, [])
  assert.equal(unknown.keyword, 'alpha')
  assert.equal(unknown.attributes, false)
})

test('筛选按钮 = 往搜索框里加减 /xxx（handleSearchOptionSelection:486-515）', () => {
  assert.equal(toggleInstalledSearchOption('', 'enabled'), '/enabled')
  assert.equal(toggleInstalledSearchOption('alpha', 'disabled'), 'alpha /disabled')
  // 再点一次是取消，其余词保留
  assert.equal(toggleInstalledSearchOption('/enabled alpha', 'enabled'), 'alpha')
  assert.equal(toggleInstalledSearchOption('/enabled /disabled', 'disabled'), '/enabled')
  // 大小写不同的同一选项也要能被去掉
  assert.equal(toggleInstalledSearchOption('/ENABLED', 'enabled'), '')
})

test('按钮高亮状态从文本框反推（InstalledSearchOptionAction.setState:655-670）', () => {
  assert.deepEqual([...installedQueryOptions('/enabled alpha')], ['enabled'])
  assert.deepEqual([...installedQueryOptions('alpha')], [])
  // 不支持的选项不会点亮任何按钮
  assert.deepEqual([...installedQueryOptions('/bundled')], [])
})

test('过滤：属性是与关系，关键字匹配名称/id/描述/类目', () => {
  const enabled = plugin({ id: 'alpha', name: 'Alpha', category: 'AAA' })
  const disabled = plugin({ id: 'beta', name: 'Beta', enabled: false })
  const broken = plugin({ id: 'gamma', name: 'Gamma', error: '坏清单' })
  const ids = plugins => plugins.map(item => item.id)

  assert.deepEqual(ids([enabled, disabled, broken].filter(item => matchesInstalledQuery(item, parseInstalledQuery('/enabled')))), ['alpha'])
  assert.deepEqual(ids([enabled, disabled, broken].filter(item => matchesInstalledQuery(item, parseInstalledQuery('/disabled')))), ['beta'])
  assert.deepEqual(ids([enabled, disabled, broken].filter(item => matchesInstalledQuery(item, parseInstalledQuery('/invalid')))), ['gamma'])
  // userInstalled 在本仓恒真（插件只能来自用户配置目录）
  assert.deepEqual(ids([enabled, disabled, broken].filter(item => matchesInstalledQuery(item, parseInstalledQuery('/userInstalled')))), ['alpha', 'beta', 'gamma'])
  // 两个属性是与关系
  assert.deepEqual(ids([enabled, disabled].filter(item => matchesInstalledQuery(item, parseInstalledQuery('/enabled /disabled')))), [])
  assert.deepEqual(ids([enabled, disabled].filter(item => matchesInstalledQuery(item, parseInstalledQuery('beta')))), ['beta'])
  assert.deepEqual(ids([enabled, disabled].filter(item => matchesInstalledQuery(item, parseInstalledQuery('AAA')))), ['alpha'])
  // 属性 + 关键字也是与关系
  assert.deepEqual(ids([enabled, disabled].filter(item => matchesInstalledQuery(item, parseInstalledQuery('/disabled beta')))), ['beta'])
})

test('本仓有真实数据源的搜索选项：四项本机状态 + needUpdate（市场清单），余两项登记为待办', () => {
  assert.deepEqual(SUPPORTED_SEARCH_OPTIONS, ['userInstalled', 'needUpdate', 'enabled', 'disabled', 'invalid'])
  const todo = read('docs/class-parity-todo.md')
  assert.match(todo, /插件/)
})

test('接线：对话框按分组渲染，宿主侧批量启停走同一条 plugin.setEnabled 路由', () => {
  const dialog = read('src/components/PluginDialog.vue')
  assert.match(dialog, /buildInstalledGroups/)
  const extras = read('src/projectExtras.ts')
  assert.match(extras, /plugin\.setEnabled/)
})

// 清单字段 `<change-notes>` 的全链：原生解析 → JSON → 前端类型 → 详情面板。
// 上游同一族字段：元素名 `PluginXmlConst.kt:42`、读取 `XmlReader.kt:193`、
// getter `IdeaPluginDescriptorImpl.kt:195`、展示 `PluginDetailsPageComponent.kt:1394`
// （那块面板 `:847-862` 建，内容为 null 就整块不可见 ⇒ 本仓「没写不渲染」不是自创）。
// 这一条把五段各钉死：任何一段被删/改名，这里就红（原生侧的解析口径由 `native/plugins_test.cpp` 管）。
test('接线：变更说明（changeNotes）从原生解析一路走到详情面板，且没写就不渲染', () => {
  assert.match(read('native/plugins.hpp'), /^ {4}std::string change_notes;$/m, 'Plugin 结构里要有这一格，否则 JSON 无从填')
  assert.match(read('native/plugins.cpp'),
    /plugin\.change_notes = text_or\(document, "changeNotes", 1200\);/,
    '清单里的键名固定是 changeNotes（本仓 manifest 用 camelCase，与 fileNames / optionalDepends 同形制）')
  assert.match(read('native/plugins.cpp'), /\{"changeNotes", plugin\.change_notes\}/, 'to_json 要把它带给前端')
  assert.match(read('src/pluginGroups.ts'), /^ {2}changeNotes\?: string$/m, '前端 PluginInfo 要带这个可选字段')
  const dialog = read('src/components/PluginDialog.vue')
  assert.match(dialog, /<p v-if="selected\.changeNotes" class="plugin-detail-desc">变更说明：\{\{ selected\.changeNotes \}\}<\/p>/,
    '详情面板那一行只在清单真写了说明时出现（不放空控件）')
  assert.match(read('native/plugins_test.cpp'),
    /check\(find_plugin\(plugins, "long_notes"\)\.change_notes\.empty\(\)/,
    '「超过 1200 字符 = 没写」这条口径要有原生判据守着')
})
