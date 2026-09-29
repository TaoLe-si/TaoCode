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
  assert.equal(order[0], 'usage.viewOptions', 'additionalGearActions 那一组在最前')
  assert.equal(order[1], 'window.speedSearch', '顺序照源码：SpeedSearch 在 CloseAll 之前')
  assert.equal(order.indexOf('window.closeAllTabs'), 2)
  const search = TOOL_WINDOW_GEAR_SPEC[1]
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
