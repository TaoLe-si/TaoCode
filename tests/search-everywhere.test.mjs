// Search Everywhere 的纯逻辑：一个对话框多个供给者（IDEA 263 新分屏实现）。
// 对照依据：新 SE 的 tab 注册表
// `platform/searchEverywhere/frontend/resources/intellij.platform.searchEverywhere.frontend.xml:64-69`
// 与各 tab 的 `priority`（All/Classes/Files/Symbols/Actions/Text）、
// `ContributorDefinedTabsCustomizationStrategy.kt:5` 的 `@Deprecated`（旧 tab 体系已 sunset）、
// `commandSearch.ts` 的打分语义。
// **注意**：`IdeBundle.properties:1116-1120` 那批 `searcheverywhere.*.tab.name`
// （Project / IDE / Commands / Run Configurations / Autocompletion）不是新 SE 的 tab 名 ——
// Project/IDE 两个键全树无代码引用，Commands 只被旧 SE 用，Autocompletion 只被已废弃的类用。
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { shellSource } from './shell-source.mjs'
import ts from 'typescript'
import * as vue from 'vue'

import {
  FUZZY_FILES_ENABLED_DEFAULT,
  SEARCH_EVERYWHERE_LIMIT,
  SEARCH_EVERYWHERE_TABS,
  availableSearchEverywhereTabs,
  cycleSearchEverywhereTab,
  fuzzyTitleFragments,
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

test('tab 集合、名称与顺序照上游注册的 tabFactory 与各 tab 的 priority，不按记忆', () => {
  // 上游新 SE 的 tab 由扩展点 `searchEverywhere.tabFactory` 列出，本树里
  // `platform/searchEverywhere/frontend/resources/intellij.platform.searchEverywhere.frontend.xml:64-69`
  // 注册了六个：All / Classes / Files / Symbols / Actions / Text。
  // 顺序按各 tab 的 priority 降序：All `SeAllTab.kt:89` MAX、Classes `SeClassesTab.kt:50` 950、
  // Files `SeFilesTab.kt:52` 900、Symbols `SeSymbolsTab.kt:50` 850、Actions `SeActionsTab.kt:56` 800、
  // Text `SeTextTab.kt:56` 250。
  assert.deepEqual(SEARCH_EVERYWHERE_TABS.map(tab => tab.label),
    ['All', 'Classes', 'Project', 'Symbols', 'Actions', 'Run Configurations', 'Text'])
  assert.deepEqual(SEARCH_EVERYWHERE_TABS.map(tab => tab.id),
    ['all', 'classes', 'project', 'symbols', 'commands', 'runConfigs', 'text'])
  assert.deepEqual(SEARCH_EVERYWHERE_TABS[0].sources, ['project', 'symbols', 'commands', 'runConfigs', 'text'], 'All 必须是并集')
  // Classes = 只吃符号供给者，再按语言服务的 kind 收窄（不是按名字猜）。
  assert.deepEqual(SEARCH_EVERYWHERE_TABS[1].sources, ['symbols'])
  assert.equal(SEARCH_EVERYWHERE_TABS[1].classesOnly, true)
  // Project = 本仓的合成档（上游没有这一 tab），收项目文件 + 项目类/符号，取 Files(900) 的位次。
  assert.deepEqual(SEARCH_EVERYWHERE_TABS[2].sources, ['project', 'symbols'])
  // Symbols = 上游 850 那一档，本仓就是 LSP workspace/symbol 那一批。
  assert.deepEqual(SEARCH_EVERYWHERE_TABS[3].sources, ['symbols'])
  // **订正 2026-10-06（桶 9b）**：Text 档已经接上宿主 `search.run`（`src/searchEverywhereHost.ts`
  // 的 `refreshText`），所以上游 `SeTextTab(250)` 那一档在本仓不再是"有名字没供给者"。
  assert.equal(SEARCH_EVERYWHERE_TABS.some(tab => tab.label === 'Text'), true)
  assert.equal(SEARCH_EVERYWHERE_TABS[6].priority, 250, 'Text 档 priority 取上游那一档')
  // 真正还没供给者的两档：IDE / Autocompletion（上游 `AutoCompletionProvider.java:27-29` 已废弃）。
  assert.equal(SEARCH_EVERYWHERE_TABS.some(tab => /IDE|Autocompletion/i.test(tab.label)), false)
})

test('动作档叫 Actions —— 新 SE 那一档是 Actions，Commands 是旧 SE 的名字', () => {
  // `SeActionsTab.kt:54` → `IdeBundle.properties:1811` `search.everywhere.group.name.actions=Actions`。
  // `searcheverywhere.commands.tab.name` 只被**旧** SE 用（`SearchEverywhereUI.java:2042`），
  // 而旧 SE 已被 `ContributorDefinedTabsCustomizationStrategy.kt` 标 @Deprecated sunset。
  const actions = SEARCH_EVERYWHERE_TABS.find(tab => tab.id === 'commands')
  assert.equal(actions.label, 'Actions')
  assert.equal(SEARCH_EVERYWHERE_TABS.some(tab => tab.label === 'Commands'), false,
    'Commands 是抄了旧 SE 的键，必须换掉')
  // 内部 id 保持 'commands'：它标识的是同一批供给者（动作表），改名会牵动宿主与既有用例。
  assert.deepEqual(searchEverywhereResults(items, 'rebuild', 'commands').map(each => each.id), ['cmd'],
    '改名只动显示名，供给者链路不变')
})

test('Symbols 档只收符号，不收文件（上游 SeSymbolsTab 那一档）', () => {
  const withSymbol = [...items, item('sym', 'DemoClass#parse', 'symbols', { subtitle: 'DemoClass.java:12' })]
  assert.deepEqual(searchEverywhereResults(withSymbol, '', 'symbols').map(each => each.id), ['sym'])
  assert.deepEqual(searchEverywhereResults(items, 'rebuild', 'symbols'), [], '动作不该混进 Symbols')
  // 供给者没结果时那一档不进 tab 行（与「只渲染有真实供给者的」同一条规则）。
  // `items` 里没有任何 source==='symbols' 的项，所以 Classes 与 Symbols 两档都空。
  assert.deepEqual(availableSearchEverywhereTabs(items, ''),
    ['all', 'project', 'commands', 'runConfigs'], 'items 里没有 symbols 供给者')
  // 有 symbols 供给者时 Symbols 才进表，且位次按 priority 排在 Project 之后。
  // `sym` 没有 symbolKind（它是个方法 `DemoClass#parse`），所以 Classes 那档仍空 —— 这正是
  // `classesOnly` 的判据：不按名字猜，只认语言服务标的 Class/Interface/Enum/Struct。
  assert.deepEqual(availableSearchEverywhereTabs(withSymbol, ''),
    ['all', 'project', 'symbols', 'commands', 'runConfigs'])
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
    '只有文件时只剩 All 与 Project —— 不能留一个永远空着的 Actions')
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
  // 符号只在 All / Classes / Project / Symbols 里出现，Actions / Run Configurations 不该混进来。
  assert.deepEqual(searchEverywhereResults(withSymbol, 'parse', 'runConfigs'), [])
})

// Execute the production host with real Vue reactivity and a controlled native transport.
// As in scope-persistence.test.mjs, transpilation only replaces runtime imports.
const transpile = relative => ts.transpileModule(readFileSync(new URL(`../src/${relative}`, import.meta.url), 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS },
}).outputText
const hostJs = transpile('searchEverywhereHost.ts')
const classesJs = transpile('searchEverywhereClasses.ts')
const commandSearchJs = transpile('commandSearch.ts')
function loadTranspiled(source, resolve) {
  const exports = {}
  new Function('require', 'exports', source)(resolve, exports)
  return exports
}
function lifecycleHost(t) {
  t.mock.timers.enable({ apis: ['setTimeout'] })
  const fsChanges = vue.reactive({ version: 0, paths: [] })
  const calls = []
  const request = (method, params) => new Promise((resolve, reject) => calls.push({ method, params, resolve, reject }))
  const commandSearch = loadTranspiled(commandSearchJs, name => { throw new Error(`Unexpected commandSearch dependency: ${name}`) })
  const classes = loadTranspiled(classesJs, name => {
    if (name === './commandSearch.ts' || name === './commandSearch') return commandSearch
    throw new Error(`Unexpected classes dependency: ${name}`)
  })
  const exports = {}
  // Text 档的两个纯模块（无运行时依赖，`import type` 在 transpile 阶段已被擦掉）。
  const textTab = loadTranspiled(transpile('searchEverywhereText.ts'), name => {
    throw new Error(`Unexpected searchEverywhereText dependency: ${name}`)
  })
  const exclusions = loadTranspiled(transpile('searchExclusions.ts'), name => {
    throw new Error(`Unexpected searchExclusions dependency: ${name}`)
  })
  new Function('require', 'exports', hostJs)(name => {
    if (name === 'vue') return vue
    if (name === './bridge' || name === './bridge.ts') return { fsChanges, request }
    if (name === './searchEverywhereClasses.ts' || name === './searchEverywhereClasses') return classes
    if (name === './searchEverywhereText.ts') return textTab
    if (name === './searchExclusions.ts') return exclusions
    throw new Error(`Unexpected host dependency: ${name}`)
  }, exports)
  const deps = {
    isDesktop: true, menu: vue.ref(null), workspace: vue.ref({ root: 'project' }),
    activePath: vue.ref('Main.java'), lspReady: vue.ref(true), actionList: vue.ref([]), allRunConfigNames: vue.ref([]),
    openFile() {}, jumpSymbol() {}, runAction() {}, selectRunConfig() {}, runSelectedConfig() {}, baseName: path => path,
  }
  const scope = vue.effectScope()
  const host = scope.run(() => exports.createSearchEverywhereHost(deps))
  // 这几条测的是**文件与符号**两条通道的生命周期：把当前档切到 Project，
  // Text 档的整工作区扫描就不参与（`textWanted()` 认档），请求序列保持原样。
  host.setSearchEverywhereTab('project')
  t.after(() => scope.stop())
  return { ...host, deps, calls, fsChanges, scope,
    files: () => host.searchEverywhereItems.value.filter(item => item.source === 'project').map(item => item.title),
    symbols: () => host.searchEverywhereItems.value.filter(item => item.source === 'symbols').map(item => item.title),
  }
}
const symbolResult = name => ({ available: true, symbols: [{ name, path: 'Main.java', line: 0, character: 0 }] })

test('关闭时不请求宿主，关闭和卸载均取消待发出的刷新', t => {
  const h = lifecycleHost(t)
  h.fsChanges.version++
  h.onSearchEverywhereQuery('Main')
  t.mock.timers.tick(1000)
  assert.equal(h.calls.length, 0)
  h.openSearchEverywhere()
  assert.equal(h.calls.length, 1)
  h.onSearchEverywhereQuery('Main')
  h.fsChanges.version++
  h.searchEverywhereOpen.value = false
  h.fsChanges.version++
  t.mock.timers.tick(1000)
  assert.equal(h.calls.length, 1, '关闭必须取消文件与符号两个定时器')
  h.openSearchEverywhere()
  h.onSearchEverywhereQuery('Main')
  h.fsChanges.version++
  h.scope.stop()
  t.mock.timers.tick(1000)
  assert.equal(h.calls.length, 2, '卸载后不得继续请求')
})

test('文件变化防抖刷新清单并用同一查询词独立刷新符号；清单失败保留原结果', async t => {
  const h = lifecycleHost(t)
  h.openSearchEverywhere()
  h.calls[0].resolve({ files: ['Main.java'] })
  await Promise.resolve()
  h.onSearchEverywhereQuery(' Main ')
  t.mock.timers.tick(120)
  assert.deepEqual(h.calls[1].params, { kind: 'workspaceSymbol', path: 'Main.java', query: 'Main' })
  h.calls[1].resolve(symbolResult('Main'))
  await Promise.resolve()
  h.fsChanges.version++
  h.fsChanges.version++
  t.mock.timers.tick(119)
  assert.equal(h.calls.length, 2)
  t.mock.timers.tick(1)
  assert.equal(h.calls.length, 3, '符号刷新不等待清单请求')
  assert.deepEqual(h.calls[2].params, h.calls[1].params)
  t.mock.timers.tick(80)
  assert.equal(h.calls.length, 4, '连续文件事件只重取一次清单')
  assert.equal(h.calls[3].method, 'workspace.files')
  h.calls[3].reject(new Error('disk unavailable'))
  h.calls[2].resolve(symbolResult('MainUpdated'))
  await Promise.resolve()
  assert.deepEqual(h.files(), ['Main.java'])
  assert.deepEqual(h.symbols(), ['MainUpdated'])
})

test('同词重发后旧文件和符号响应不得覆盖新结果或在防抖期回填', async t => {
  const h = lifecycleHost(t)
  h.openSearchEverywhere()
  h.onSearchEverywhereQuery('Main')
  t.mock.timers.tick(120)
  const [oldFiles, oldSymbols] = h.calls
  h.fsChanges.version++
  oldSymbols.resolve(symbolResult('stale-before-debounce'))
  await Promise.resolve()
  assert.deepEqual(h.symbols(), [], '新查询开始即作废旧符号响应')
  t.mock.timers.tick(200)
  h.calls[2].resolve(symbolResult('fresh'))
  h.calls[3].resolve({ files: ['fresh.java'] })
  await Promise.resolve()
  oldFiles.resolve({ files: ['stale.java'] })
  await Promise.resolve()
  assert.deepEqual(h.files(), ['fresh.java'])
  assert.deepEqual(h.symbols(), ['fresh'])
  h.onSearchEverywhereQuery('Main')
  t.mock.timers.tick(120)
  const late = h.calls[4]
  h.onSearchEverywhereQuery('Main')
  t.mock.timers.tick(120)
  h.calls[5].resolve(symbolResult('newest'))
  await Promise.resolve()
  late.reject(new Error('obsolete failure'))
  await Promise.resolve()
  assert.deepEqual(h.symbols(), ['newest'], '旧请求失败也不得清空新结果')
})

for (const transition of ['close/reopen', 'workspace replacement']) {
  test(`${transition} 隔离旧会话的文件和符号响应`, async t => {
    const h = lifecycleHost(t)
    h.openSearchEverywhere()
    h.onSearchEverywhereQuery('Main')
    t.mock.timers.tick(120)
    const [oldFiles, oldSymbols] = h.calls
    if (transition === 'close/reopen') {
      h.searchEverywhereOpen.value = false
      h.openSearchEverywhere()
      h.onSearchEverywhereQuery('Main')
    } else {
      h.deps.workspace.value = { root: 'project' } // Same root, different workspace identity.
    }
    t.mock.timers.tick(120)
    h.calls[2].resolve({ files: ['current.java'] })
    h.calls[3].resolve(symbolResult('current'))
    await Promise.resolve()
    oldFiles.resolve({ files: ['old.java'] })
    oldSymbols.resolve(symbolResult('old'))
    await Promise.resolve()
    assert.deepEqual(h.files(), ['current.java'])
    assert.deepEqual(h.symbols(), ['current'])
  })
}

// ── 模糊文件匹配（Smith-Waterman）那一档 ────────────────────────────────────
//
// 上游：`SmithWatermanAlgorithm` + `SmithWatermanMatcher`（文件名优先，弱命中退到整条路径），
// 由 `SeFuzzyFileSearchProvider` 消费；那个 provider 由注册表键
// `search.everywhere.fuzzy.files.enabled` 门控，**默认 false**
// （`SeFuzzyFileSearchProviderFactory.kt:28-31`）。所以默认档必须与移植前逐字一致。
const fuzzyFile = (id, path) => item(id, path.split('/').pop(), 'project', { subtitle: path, keywords: path, fuzzyPath: path })

test('默认档不启用模糊匹配（上游注册表键默认 false），行为与移植前一致', () => {
  assert.equal(FUZZY_FILES_ENABLED_DEFAULT, false)
  // `gcf` 命中 GotoClassFile 的文件名，但按旧的 rankCommands 语义不命中 DemoClass / Main。
  const list = [fuzzyFile('gcf', 'src/GotoClassFile.kt'), fuzzyFile('main', 'src/demo/Main.java')]
  assert.deepEqual(searchEverywhereResults(list, 'gcf', 'project').map(each => each.id), ['gcf'])
})

test('启用后文件走 Smith-Waterman：驼峰缩写能命中，路径片段也能命中', () => {
  const list = [fuzzyFile('gcf', 'src/GotoClassFile.kt'), fuzzyFile('main', 'src/demo/Main.java')]
  assert.deepEqual(searchEverywhereResults(list, 'gcf', 'project', SEARCH_EVERYWHERE_LIMIT, true).map(each => each.id), ['gcf'])
  // 搜路径片段 `src/main`：文件名 `Main.java` 上对不上，退到整条路径才命中。
  assert.deepEqual(searchEverywhereResults(list, 'srcmain', 'project', SEARCH_EVERYWHERE_LIMIT, true).map(each => each.id), ['main'])
})

test('弱命中按 minScore 阈值丢掉（search.everywhere.fuzzy.files.min.score=6500）', () => {
  // `nothing` 只在路径里捞到 `i`+`n` 两个字符：分数为正但归一分 0.24，进不了结果。
  const list = [fuzzyFile('app', 'src/main/App.kt')]
  assert.deepEqual(searchEverywhereResults(list, 'nothing', 'project', SEARCH_EVERYWHERE_LIMIT, true), [])
})

test('启用模糊后文件与动作仍能放进同一个列表排序（两档换算到 0..10000 同一条数轴）', () => {
  const list = [fuzzyFile('app', 'src/main/App.kt'), item('cmd', 'App', 'commands')]
  const hits = searchEverywhereResults(list, 'app', 'all', SEARCH_EVERYWHERE_LIMIT, true).map(each => each.id)
  assert.equal(hits.length, 2, '两边都命中，都该出现')
  // 动作标题整段命中且在开头 → 词首权重 10000；模糊文件最高 9999（MAX_FUZZY_WEIGHT）——
  // 上游特意把模糊那档压在词首命中之下，所以这里动作排前面。
  assert.deepEqual(hits, ['cmd', 'app'])
})

test('命中字符高亮：升序下标并成连续段，且只在文件名那一档画（上游 indicesToFragments）', () => {
  const file = fuzzyFile('gcf', 'src/GotoClassFile.kt')
  assert.deepEqual(fuzzyTitleFragments(file, 'gcf', true), [[0, 1], [4, 5], [9, 10]])
  // 退到整条路径的那一档：下标落在 subtitle 上，标题里不画。
  assert.deepEqual(fuzzyTitleFragments(fuzzyFile('main', 'src/demo/Main.java'), 'srcmain', true), [])
  // 默认关闭时一律不画。
  assert.deepEqual(fuzzyTitleFragments(file, 'gcf', false), [])
})

// 接线守卫：三处都不能掉链子 —— 宿主填 fuzzyPath、外壳传开关、对话框把开关交给打分函数。
test('模糊匹配的接线三处都在', () => {
  const root = join(dirname(fileURLToPath(import.meta.url)), '..')
  const host = readFileSync(join(root, 'src', 'searchEverywhereHost.ts'), 'utf8')
  assert.match(host, /id: `file:\$\{path\}`[\s\S]{0,300}?fuzzyPath: path/, '文件项没有填 fuzzyPath，模糊匹配永远拿不到整条路径')
  const shell = shellSource()
  assert.match(shell, /<SearchEverywhereDialog[^>]*:fuzzy-files="generalSettings\.fuzzyFileSearch"/, '外壳没有把设置开关传给对话框')
  const dialog = readFileSync(join(root, 'src', 'components', 'SearchEverywhereDialog.vue'), 'utf8')
  // 第六个实参是作用域谓词（上游 `ScopeChooserAction`）—— 本批新加的，所以断言放宽到"开关在位"。
  assert.match(dialog, /searchEverywhereResults\(\s*props\.items, query\.value, tab\.value, SEARCH_EVERYWHERE_LIMIT, props\.fuzzyFiles, scopePredicate\.value/,
    '对话框没有把开关交给打分函数')
  // 原先这里钉的是「模板里直接调 `fuzzyTitleFragments(item, query, …)`」这一**形状**。
  // 现在实现把每行的命中区间收进 `fragmentCache`（一次算好、按行取用，文本档直接用 `hitRanges`），
  // 模板改成 `highlightParts(entry.title, fragmentCache[position])` —— 这是把 N 次重复计算收成一次，
  // 意图没变（命中下标仍然驱动高亮）。所以断言改成钉**意图**，但依旧精确：
  // ① 缓存的每一项仍由 `fuzzyTitleFragments(entry, query.value, props.fuzzyFiles)` 供数；
  // ② 标题渲染确实按命中下标包 `<mark class="se-hit">`。
  assert.match(dialog, /fragmentCache = computed\(\(\) => results\.value\.map\(entry =>[\s\S]{0,200}?fuzzyTitleFragments\(entry, query\.value, props\.fuzzyFiles\)/,
    '命中区间不再由 fuzzyTitleFragments 供数（模糊匹配的高亮会静默失效）')
  assert.match(dialog, /highlightParts\(entry\.title, fragmentCache\[position\][^\n]{0,40}\)[\s\S]{0,200}?<mark v-if="part\.hit" class="se-hit">/,
    '对话框没有按命中下标画高亮')
  const toggles = readFileSync(join(root, 'src', 'components', 'GeneralRegistryToggles.vue'), 'utf8')
  assert.match(toggles, /v-model="general\.fuzzyFileSearch"/, '设置页没有这个开关（注册表键的落点）')
  const settings = readFileSync(join(root, 'src', 'components', 'SettingsDialog.vue'), 'utf8')
  assert.match(settings, /<GeneralRegistryToggles :general="general" \/>/, '「常规」页没有挂上那两个注册表键开关')
})

test('来源副标签', () => {
  assert.equal(searchEverywhereSourceLabel('project'), 'File')
  assert.equal(searchEverywhereSourceLabel('symbols'), 'Symbol')
  // 动作那一档与 tab 名同源：新 SE 叫 Actions（`IdeBundle.properties:1811`），不是旧 SE 的 Commands。
  assert.equal(searchEverywhereSourceLabel('commands'), 'Actions')
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
  // Ctrl+Shift+A 现在由共享键位注册表承载（src/keymapBindings.ts；id → 动作的映射在 src/keymap.ts）。
  assert.match(shell, /'actions\.search': \(\) => openActionSearch\(\)/,
    'Ctrl+Shift+A 必须仍然是「查找操作」（分派映射）')
  assert.match(shell, /id: 'actions\.search'[\s\S]{0,200}key: 'a'[\s\S]{0,120}shift: true/,
    'Ctrl+Shift+A 的键位事实在键位注册表里不见了')
  assert.match(shell, /id: 'navigate\.actions'[\s\S]{0,200}openActionSearch/,
    '导航菜单的「查找操作」行不见了')
  // 三个供给者都真的接了数据源（不是空数组占位）。
  const host = shell.match(/src\/searchEverywhereHost\.ts[\s\S]*?id: `file:\$\{path\}`[\s\S]*?id: `cmd:\$\{entry\.id\}`[\s\S]*?id: `cfg:\$\{name\}`/)
  assert.ok(host, '三个供给者（文件 / 动作 / 运行配置）没有都接上')
  // 对话框真的挂在外壳上。
  assert.match(shell, /<SearchEverywhereDialog :open="searchEverywhereOpen"/, '对话框没有渲染到外壳里')
})

// 符号供给者的**前置条件**：`lspReady` 必须真的会失效（2026-10-01 第七十八批的真机缺陷）。
//
// 症状：打开文件后，导航菜单里的「转到符号/转到声明」全灰、Search Everywhere 搜不出任何符号、
// 「转到符号」对话框不弹 —— 切一次标签页就全好了。根因是 Vue 的代理陷阱：
// `openFile` 把 push 之前的**原始 tab 对象**交给 `startLsp`，而 `startCompletionSession` 往它上面写
// `lspRunning`；写原始对象不触发依赖，`lspReady`（computed）缓存着 false 不放，直到别的响应式变化
// 把它撞醒。修法：`startLsp` 入口处换回 `groups` 里的响应式代理再写。
test('startLsp 往响应式代理上写 lspRunning（写原始对象不触发 lspReady 失效）', () => {
  const navigation = readFileSync(join(dirname(fileURLToPath(import.meta.url)), '..', 'src', 'lspNavigation.ts'), 'utf8')
  assert.match(navigation,
    /const live = \(\[\.\.\.groups\[0\]\.tabs, \.\.\.groups\[1\]\.tabs\] as Tab\[\]\)\.find\(item => item\.path === tab\.path\) \?\? tab/,
    'startLsp 没有换回响应式代理：写原始 tab 对象不会让 lspReady 失效')
  assert.match(navigation, /starts\.set\(live\.path, token\)/, '后续登记都要用代理那一份')
  assert.match(navigation, /startCompletionSession\(live,/,
    'startCompletionSession 必须拿到代理，否则 lspRunning 永远写不进响应式世界')
  // 反向守卫：不能再用传进来的原始对象去跑会话（那样上面两条都会变成摆设）。
  assert.doesNotMatch(navigation, /startCompletionSession\(tab,/, '还在往原始对象上跑会话')
})
