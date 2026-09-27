// Search Everywhere 的纯逻辑：一个对话框多个供给者（IDEA 263 新分屏实现）。
// 对照依据：`IdeBundle.properties` 的 tab 名称键、`ContributorDefinedTabsCustomizationStrategy.kt:5`
// 的 `@Deprecated`（旧 tab 体系已 sunset）、`commandSearch.ts` 的打分语义。
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { shellSource } from './shell-source.mjs'

import {
  SEARCH_EVERYWHERE_LIMIT,
  SEARCH_EVERYWHERE_TABS,
  availableSearchEverywhereTabs,
  cycleSearchEverywhereTab,
  moveSearchEverywhereIndex,
  searchEverywhereResults,
  searchEverywhereSourceLabel,
} from '../src/searchEverywhere.ts'

const item = (id, title, source, extra = {}) => ({ id, title, source, open: () => { }, ...extra })

const items = [
  item('file', 'Main.java', 'project', { subtitle: 'src/demo/Main.java', keywords: 'entry point' }),
  item('class', 'DemoClass', 'project', { subtitle: 'src/demo/DemoClass.java' }),
  item('cmd', '重新构建项目', 'commands', { keywords: 'build rebuild rebuild 项目' }),
  item('cfg', 'Demo', 'runConfigs', { subtitle: 'Application' }),
]

test('tab 集合与顺序照 IdeBundle 的键，不按记忆', () => {
  // `searcheverywhere.*.tab.name` = All / Project / IDE / Commands / Run Configurations / Autocompletion。
  // 我们只渲染有真实供给者的四个：IDE 与 Autocompletion 还没有供给者，渲染出来就是放假控件。
  assert.deepEqual(SEARCH_EVERYWHERE_TABS.map(tab => tab.label), ['All', 'Project', 'Commands', 'Run Configurations'])
  assert.deepEqual(SEARCH_EVERYWHERE_TABS[0].sources, ['project', 'symbols', 'commands', 'runConfigs'], 'All 必须是并集')
  // Project = 项目文件 + 项目类/符号（IDEA 的 project scope 就是这两类）。
  assert.deepEqual(SEARCH_EVERYWHERE_TABS[1].sources, ['project', 'symbols'])
})

test('每个 tab 只显示自己供给者的项', () => {
  assert.deepEqual(searchEverywhereResults(items, '', 'project').map(each => each.id), ['file', 'class'])
  assert.deepEqual(searchEverywhereResults(items, '', 'commands').map(each => each.id), ['cmd'])
  assert.deepEqual(searchEverywhereResults(items, '', 'runConfigs').map(each => each.id), ['cfg'])
  assert.equal(searchEverywhereResults(items, '', 'all').length, 4, 'All 是三者并集')
})

test('排序走 rankCommands 的语义：整段命中压过散序子序列，关键词能命中', () => {
  const hits = searchEverywhereResults(items, 'Demo', 'all')
  assert.deepEqual(hits.map(each => each.id), ['class', 'cfg'], 'DemoClass 与 Demo 都在标题里整段命中')
  // 关键词别名（IDEA 的 keywords）也算命中：'rebuild' 只出现在动作的 keywords 里。
  assert.deepEqual(searchEverywhereResults(items, 'rebuild', 'commands').map(each => each.id), ['cmd'])
  // 供给者不匹配时，即便标题命中也不该出现（Project 里不该冒出动作）。
  assert.deepEqual(searchEverywhereResults(items, 'rebuild', 'project'), [])
})

test('结果有上限，避免大项目的文件清单全铺出来', () => {
  const many = Array.from({ length: SEARCH_EVERYWHERE_LIMIT + 20 }, (_, index) => item(`f${index}`, `f${index}.java`, 'project'))
  assert.equal(searchEverywhereResults(many, 'f', 'project').length, SEARCH_EVERYWHERE_LIMIT)
})

test('有结果的 tab 才进 tab 行（没有供给者的 tab 不渲染）', () => {
  assert.deepEqual(availableSearchEverywhereTabs(items, ''), ['all', 'project', 'commands', 'runConfigs'])
  const onlyFiles = [items[0]]
  assert.deepEqual(availableSearchEverywhereTabs(onlyFiles, ''), ['all', 'project'],
    '只有文件时只剩 All 与 Project —— 不能留一个永远空着的 Commands')
})

test('Tab / Shift+Tab 在有结果的 tab 之间循环并跳过空的', () => {
  const available = ['all', 'project']
  assert.equal(cycleSearchEverywhereTab('all', 1, available), 'project')
  assert.equal(cycleSearchEverywhereTab('project', 1, available), 'all', '要回绕')
  assert.equal(cycleSearchEverywhereTab('project', -1, available), 'all')
  // 当前 tab 已经没有结果（切走后再筛没）时，从第一个开始，而不是卡住。
  assert.equal(cycleSearchEverywhereTab('commands', 1, available), 'all')
  assert.equal(cycleSearchEverywhereTab('all', 1, []), 'all', '一个 tab 都没有时保持原样')
})

test('上下移动选中项会回绕', () => {
  assert.equal(moveSearchEverywhereIndex(0, 3, 1), 1)
  assert.equal(moveSearchEverywhereIndex(2, 3, 1), 0, '末尾往下要回到第一项')
  assert.equal(moveSearchEverywhereIndex(0, 3, -1), 2, '第一项往上要回到末尾')
  assert.equal(moveSearchEverywhereIndex(0, 0, 1), 0, '没有结果时不该算出非法下标')
})

test('符号与文件同属 Project tab（IDEA 的 project scope）', () => {
  const withSymbol = [...items, item('sym', 'DemoClass#parse', 'symbols', { subtitle: 'DemoClass.java:12' })]
  assert.deepEqual(searchEverywhereResults(withSymbol, '', 'project').map(each => each.id), ['file', 'class', 'sym'],
    'Project 收文件与符号，不收动作与运行配置')
  assert.deepEqual(searchEverywhereResults(withSymbol, '', 'commands').map(each => each.id), ['cmd'])
  // 符号只在 All 与 Project 里出现，Commands / Run Configurations 不该混进来。
  assert.deepEqual(searchEverywhereResults(withSymbol, 'parse', 'runConfigs'), [])
})

test('来源副标签', () => {
  assert.equal(searchEverywhereSourceLabel('project'), 'File')
  assert.equal(searchEverywhereSourceLabel('symbols'), 'Symbol')
  assert.equal(searchEverywhereSourceLabel('runConfigs'), 'Run Configuration')
})

// 这一组盯的是**接线**：改造前「随处搜索」的菜单行与 Shift+Shift 都调 `openActionSearch`
// （打开「查找操作」面板），也就是说菜单在、功能是空的。这里把三处入口都钉住。
test('三个入口都打开 Search Everywhere，而不是「查找操作」', () => {
  const shell = shellSource()
  // ① 导航菜单的「随处搜索」行（IDEA：GoToMenu 里的 SearchEverywhere，PlatformActions.xml:604）
  assert.match(shell, /id: 'navigate\.everywhere'[\s\S]{0,200}run: \(\) => ctx\.openSearchEverywhere\(\)/,
    '导航菜单的「随处搜索」还挂在「查找操作」上')
  // ② 双击 Shift（Search Everywhere 的默认手势；Ctrl+Shift+A 才是「查找操作」，两码事）
  assert.match(shell, /now - lastShiftAt < 400\) \{ lastShiftAt = 0; event\.preventDefault\(\); openSearchEverywhere\(\)/,
    '双击 Shift 没有打开 Search Everywhere')
  // ③ 主工具栏右段的放大镜 = `MainToolbarRight` 的 SearchEverywhere（PlatformActions.xml:850）
  //    注意 shellSource() 不含 src/components/*.vue，工具栏得单独读。
  const toolbar = readFileSync(join(dirname(fileURLToPath(import.meta.url)), '..', 'src', 'components', 'MainToolbar.vue'), 'utf8')
  assert.match(toolbar, /title="随处搜索 \(Shift\+Shift\)"/, '工具栏的放大镜不是 Search Everywhere')
  assert.match(toolbar, /@click="c\.openSearchEverywhere\(\)"/, '工具栏的放大镜没有接 Search Everywhere')
  // 反向守卫：这两个键位/行必须**不**被改成 Search Everywhere，否则就把「查找操作」弄丢了。
  assert.match(shell, /key\.toLowerCase\(\) === 'a' && event\.shiftKey\) \{ event\.preventDefault\(\); openActionSearch\(\)/,
    'Ctrl+Shift+A 必须仍然是「查找操作」')
  assert.match(shell, /id: 'navigate\.actions'[\s\S]{0,200}openActionSearch/,
    '导航菜单的「查找操作」行不见了')
  // 三个供给者都真的接了数据源（不是空数组占位）。
  const host = shell.match(/src\/searchEverywhereHost\.ts[\s\S]*?id: `file:\$\{path\}`[\s\S]*?id: `cmd:\$\{entry\.id\}`[\s\S]*?id: `cfg:\$\{name\}`/)
  assert.ok(host, '三个供给者（文件 / 动作 / 运行配置）没有都接上')
  // 对话框真的挂在外壳上。
  assert.match(shell, /<SearchEverywhereDialog :open="searchEverywhereOpen"/, '对话框没有渲染到外壳里')
})
