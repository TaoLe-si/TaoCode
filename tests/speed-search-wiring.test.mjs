// 速度搜索的**接线**判据：Ctrl+F 归谁、齿轮里那一行、以及"树没挂上就不给这一行"。
//
// 上游：`SpeedSearchAction.kt:29-37`（`isVisible = 有 handler`）、
// `SpeedSearchActionPromoter.kt:9-11`（可用时排在 Find 前面）、
// `ToolWindowImpl.kt:869`（齿轮的第一条就是它）、
// `AbstractProjectViewPaneWithAsyncSupport.java:177`（项目视图装 `TreeSpeedSearch`）。
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createSSRApp, h } from 'vue'
import { renderToString } from 'vue/server-renderer'
import { loadSfc } from './vue-sfc-loader.mjs'
import { gearHostRows, speedSearchGearRow } from '../src/gearHostRows.ts'
import { TOOL_WINDOW_GEAR_SPEC } from '../src/menus/toolWindowGear.ts'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const read = relative => readFileSync(join(root, relative), 'utf8')

let opened = 0
const fakeTree = () => ({ openSpeedSearch: () => { opened++ } })

// 齿轮组的第一条是 `additionalGearActions`（该窗口自己那一组，`ToolWindowImpl.kt:859-868`），
// SpeedSearch 紧接在其后（`:869`）。第三十七批把用法视图的「视图选项」组接进来，所以
// SpeedSearch 不再是第 0 条 —— 判据改成"它就在 additionalGearActions 之后、CloseAll 之前"。
test('SpeedSearch 紧跟 additionalGearActions，且在 CloseAll 之前（ToolWindowImpl.kt:859-872）', () => {
  const order = TOOL_WINDOW_GEAR_SPEC.map(entry => entry.action)
  assert.deepEqual(order.slice(0, 2), ['usage.viewOptions', 'usage.groupBy'],
    'additionalGearActions 那一组在最前（用法视图的两组：`UsageViewContentManagerImpl.java:114-116` 的 gearActions 与 `UsageViewImpl.java:1089-1098` 的「分组」弹出组）')
  assert.equal(order[2], 'window.speedSearch', '顺序照源码：SpeedSearch 在 CloseAll 之前')
  assert.equal(order.indexOf('window.closeAllTabs'), 3)
  const search = TOOL_WINDOW_GEAR_SPEC[2]
  assert.equal(search.fromHost, true, '它不在菜单索引里，行由宿主给')
})

test('有可搜的列表才给这一行（isVisible = 有 handler）', () => {
  const tree = fakeTree()
  assert.equal(speedSearchGearRow('files', true, tree)?.id, 'window.speedSearch')
  assert.equal(speedSearchGearRow('files', false, tree), null, '没打开项目就没有 handler')
  assert.equal(speedSearchGearRow('outline', true, tree), null, '左侧栏不在项目视图上时树不在场')
  assert.equal(speedSearchGearRow('files', true, null), null, '树还没挂上')
})

test('点那一行真的会开搜索框', () => {
  const before = opened
  speedSearchGearRow('files', true, fakeTree()).run()
  assert.equal(opened, before + 1, '行存在却不干活 = 假控件')
})

test('键位与文案取自上游：Ctrl+F（use-shortcut-of="Find"）', () => {
  const row = speedSearchGearRow('files', true, fakeTree())
  assert.equal(row.keys, 'Ctrl F', 'intellij.platform.ide.impl.actions.xml:160 用的是 Find 的键位')
  assert.equal(row.title, '速度搜索')
})

test('项目树装上了搜索框：Ctrl+F、上下键、Enter/Esc 都有落点', () => {
  const tree = read('src/components/FileTree.vue')
  assert.match(tree, /@keydown\.ctrl\.f\.prevent\.stop="openSpeedSearch\(\)"/, '树上的 Ctrl+F 没有接线')
  assert.match(tree, /<SpeedSearchBar :open="searchOpen" :query="searchQuery" @input="onSearchInput" @keydown="onSearchKeydown" \/>/,
    '搜索框没有接上（渲染与按键都归它）')
  assert.match(tree, /@input="onSearchInput"/, '输入没有触发命中')
  assert.match(tree, /@keydown="onSearchKeydown"/, '按键没有按上游规则分流')
  assert.match(tree, /openSpeedSearch, selected, selection \}\)/, 'openSpeedSearch 没有暴露给宿主（齿轮那一行会点空）')
  // 命中跳转必须走 reveal：上游 selectElement 会展开折叠的祖先，本仓的等价物就是它。
  assert.match(tree, /reveal\(row\.entry\.path\)/, '命中没走 reveal = 折叠着的文件选不中')
})

test('宿主把行接进齿轮，且只有项目视图在场时才给', () => {
  const ui = read('src/menuUi.ts')
  assert.match(ui, /toolWindowGearLayout\(findMenuRow, undefined, false, gearHostRows\(\)\)/, '齿轮没有取宿主那几张行')
  const app = read('src/App.vue')
  assert.match(app, /gearHostRowMap\(leftView\.value, Boolean\(workspace\.value\), fileTreeRef\.value/,
    'App 没把三个前置条件传下去')
  // 两条宿主行合成一张表：速度搜索在场，别的宿主行（从侧栏移除）也各有各的条件。
  const rows = gearHostRows('files', true, { openSpeedSearch: () => {} }, false, () => {})
  assert.equal(rows['window.speedSearch'].id, 'window.speedSearch')
  assert.equal(rows['window.removeStripeButton'].id, 'window.removeStripeButton')
})

test('上下/Home/End 的可见行步进只有一处真源：内容下拉不许另写回绕数学', () => {
  // 上游：这一层列表的键盘导航同样走 `SpeedSearchBase.adjustSelection`（:683-693）→
  // findNextElement / findPreviousElement（:476-516），过滤串在场时只在**命中行**之间挪。
  const combo = read('src/components/ContentComboLabel.vue')
  assert.match(combo, /active\.value = stepVisibleIndex\(rows\.value, active\.value, step\.kind\)/,
    '高亮没走 stepVisibleIndex 这张可见表 ⇒ 组件里又抄了一份回绕数学（本批的错位就是这个）')
  // 反向门禁：出现就地取模就是第二套索引算术。
  assert.doesNotMatch(combo, /%\s*\w+\.length/, '组件里自己写取模回绕')
})

// 真渲染那个搜索框（关着时整段不出现、开着时有输入框且带上游的空提示）。
// 它是独立组件就是为了这条：SSR 拿不到 setup 内部状态，那就把"长什么样"抽出来单独渲染。
test('搜索框：关着不出现，开着带上游的空提示', async () => {
  const { component } = loadSfc('src/components/SpeedSearchBar.vue')
  const closed = await renderToString(createSSRApp({ render: () => h(component, { open: false, query: '' }) }))
  assert.equal(closed.includes('speed-search-input'), false, '关着时不该占位（上游是按需出现）')
  const open = await renderToString(createSSRApp({ render: () => h(component, { open: true, query: 'a' }) }))
  assert.ok(open.includes('class="speed-search-input"'), '开着时要有输入框')
  assert.ok(open.includes('placeholder="搜索"'), '空提示 = editorsearch.search.hint（ApplicationSearchBundle.properties:661）')
  assert.ok(open.includes('aria-label="搜索"'), '输入框要有可读名字')
})

// 「替换 vs 追加」这一档落到 DOM 上，靠的是**焦点是否进了搜索框**：
// 上游搜索框一出现就吃后续按键（`SpeedSearchBase.java:730-744` 的 insertString +
// `SpeedSearch.java:43-45` 的 `updatePattern(myString + letter)` ⇒ 追加），收起时焦点回列表
// （`:964-975`/`:976-980`）。SSR 拿不到焦点，所以按本文件既有的判法（源码钉接线，非字符串行为）核：
// 焦点的收放必须在**共享件**里，否则「打字即开」的宿主（书签/日志）每敲一个字符都会被列表容器的
// keydown 覆盖成最后一个字符，多字符追加丢失。
test('搜索框自己收放焦点：打开进框才追加、关闭交回列表（SpeedSearchBase.java:730-744 / :964-980）', () => {
  const bar = read('src/components/SpeedSearchBar.vue')
  assert.match(bar, /watch\(\(\) => props\.open,/, '没有随 open 变化处理焦点 ⇒ 追加这一档落不回 DOM')
  assert.match(bar, /el\.focus\(\)/, '打开时没把焦点收进输入框 ⇒ 列表仍持焦，逐字符各自替换')
  assert.match(bar, /setSelectionRange\(/, '打开后没把光标放到串尾 ⇒ 已种下的首字符之后会插到串首')
  assert.match(bar, /returnFocus\??\.focus\(\)/, '关闭时没把焦点交回列表（上游 :964-980 收起即回列表）')
  assert.match(bar, /typeof document === 'undefined'/, '无 DOM（SSR 渲染判据）环境要早退，否则 renderToString 抛')
})
