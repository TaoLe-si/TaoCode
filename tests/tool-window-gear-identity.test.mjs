// 齿轮菜单「当前挂在哪个工具窗口上」这一位（接线请求 W-TW2-3 的组件侧）的判据。
//
// 上游那一份齿轮组**不是**宿主统一算好再发给两侧的：
//   · `platform/platform-impl/src/com/intellij/toolWindow/InternalDecoratorImpl.kt:290`
//     —— 每个标题栏拿到的是 `gearProducer = { toolWindow.createPopupGroup(true) }`，
//     取的是**这个头部自己那一份** `ToolWindow`（同目录 `ToolWindowHeader.kt:68` 的构造参数）；
//   · 于是组里那条 Close All 问的也是这个窗口的注册位：
//     `platform/platform-impl/src/com/intellij/ui/content/tabs/TabbedContentAction.java:145-149`
//     是 `setEnabledAndVisible(notForTheOnlyContent && myManager.canCloseAllContents())`，
//     而 `canCloseAllContents()` 的第一道闸
//     `platform/platform-impl/src/com/intellij/ui/content/impl/ContentManagerImpl.java:472-475`
//     就是 `if (!canCloseContents()) return false`；
//     那一位的值来自注册期：`platform/platform-impl/src/com/intellij/openapi/wm/impl/ToolWindowImpl.kt:647`。
// 本仓的行表由 `src/menuUi.ts` 统一算（`menuUi.ts:333` / `:336`），组件只渲染 ⇒
// "当前是哪个窗口"必须由**拿着 id 的那一层**补上：标题栏给自己的 `props.id`，
// 底部那一格的 id 在宿主（接线见 docs/wiring-requests-2026-10-06-tw3.md 的 R-1）。
//
// ⚠ 本文件里"换一个窗口结果要变"那两条就是这一位的判据：把闸写成不看窗口身份的
// （或者组件根本没收到 id），这两条当场变红。
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { GEAR_CLOSE_CONTENTS_ROWS, TOOL_WINDOW_GEAR_SPEC, gearRowsForWindow, toolWindowGearRows } from '../src/menus/toolWindowGear.ts'
import { canCloseContents } from '../src/toolWindowManager.ts'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const read = relative => readFileSync(join(root, relative), 'utf8')

// 底部 dock 那张行表里真实存在的两行（引用型，不走宿主行）：
// `window.closeAllTabs` = CloseAllAction（带注册表那道闸），
// `window.toggleContentUiType` = ToggleContentUiTypeAction（用的是 setEnabled，不受这一位管）。
const closeAll = { id: 'window.closeAllTabs', title: '关闭所有标签页', enabled: () => true, run: () => {} }
const uiType = { id: 'window.toggleContentUiType', title: '合并标签页', run: () => {} }
const table = [closeAll, uiType]
const ids = rows => rows.map(row => row.id)

test('闸要拦哪几行是从引用表派生的，不是第二份手抄清单', () => {
  assert.deepEqual([...GEAR_CLOSE_CONTENTS_ROWS],
    TOOL_WINDOW_GEAR_SPEC.filter(entry => entry.requiresClosableContents).map(entry => entry.action),
    '这份清单必须与 spec 里那一位同源，否则两处登记迟早漂成两个答案')
  assert.deepEqual([...GEAR_CLOSE_CONTENTS_ROWS], ['window.closeAllTabs'])
})

test('同一张行表换一个窗口身份，结果必须变（这一位真的按窗口走）', () => {
  // 注册表写了 `canCloseContents="true"` 的两条（出处见 src/toolWindowMeta.ts 的注释）⇒ 行还在。
  assert.deepEqual(ids(gearRowsForWindow(table, 'todo')), ['window.closeAllTabs', 'window.toggleContentUiType'])
  assert.deepEqual(ids(gearRowsForWindow(table, 'vcslog')), ['window.closeAllTabs', 'window.toggleContentUiType'])
  // 注册表写了但没给这一位的（= false）⇒ 整行不见（上游那是 setEnabledAndVisible，不是灰着）。
  assert.deepEqual(ids(gearRowsForWindow(table, 'files')), ['window.toggleContentUiType'])
  assert.deepEqual(ids(gearRowsForWindow(table, 'outline')), ['window.toggleContentUiType'])
  // 判据的另一半：这一位与注册表同一条来源，换窗口之所以要变就是因为注册表答得不一样。
  assert.equal(canCloseContents('todo'), true)
  assert.equal(canCloseContents('files'), false)
  // 答不出（底部那几格固定内容在本仓没有 `<toolWindow>` 注册记录）⇒ 保持现状，不猜 false。
  assert.equal(canCloseContents('references'), null)
  assert.deepEqual(ids(gearRowsForWindow(table, 'references')), ['window.closeAllTabs', 'window.toggleContentUiType'])
  assert.deepEqual(ids(gearRowsForWindow(table)), ['window.closeAllTabs', 'window.toggleContentUiType'],
    '宿主还没把这一格的身份传进来时，摘掉既有行为就是假闸')
  assert.deepEqual(ids(gearRowsForWindow(table, null)), ['window.closeAllTabs', 'window.toggleContentUiType'])
})

test('滤行返回新数组，不改调用方那份行表（宿主那份是 computed 缓存的）', () => {
  const filtered = gearRowsForWindow(table, 'files')
  assert.notEqual(filtered, table)
  assert.deepEqual(ids(table), ['window.closeAllTabs', 'window.toggleContentUiType'], '原表不许被就地改掉')
  assert.deepEqual(ids(filtered), ['window.toggleContentUiType'])
})

// 造行那一侧（`toolWindowGearRows` 的第 5 参）与渲染那一侧（`gearRowsForWindow`）必须是**同一道闸**：
// 否则会出现"造行时按 A 窗口、渲染时按 B 窗口"，两处各拦一半。
test('行表那一侧与组件那一侧同一条判据（滤两次与滤一次同值）', () => {
  const find = id => id === 'window.closeAllTabs' ? closeAll : id === 'window.toggleContentUiType' ? uiType : undefined
  const built = toolWindowGearRows(find, undefined, true, {}, 'files')
  assert.deepEqual(ids(built), ['window.toggleContentUiType'], '造行时按窗口拦过一次')
  assert.deepEqual(ids(gearRowsForWindow(built, 'files')), ids(built), '再按同一个窗口滤一次不该改变结果')
  const fromHostTable = gearRowsForWindow(toolWindowGearRows(find, undefined, true, {}, undefined), 'files')
  assert.deepEqual(ids(fromHostTable), ['window.toggleContentUiType'],
    '宿主没传 id 时算出来的行表，组件侧补上身份后拦的结果与造行时一致')
})

// ---------------------------------------------------------------------------
// 渲染层：这一族的历史缺陷就是"源码字符串看着对、真渲出来是空的/多一行"，所以两处都真渲一次。
// ---------------------------------------------------------------------------
const { loadSfc } = await import('./vue-sfc-loader.mjs')
const { createSSRApp, h } = await import('vue')
const { renderToString } = await import('vue/server-renderer')
const rowsRenderer = loadSfc('src/components/ToolWindowGearRows.vue').component
const gear = loadSfc('src/components/ToolWindowGear.vue').component

test('渲染层：行渲染器拿到窗口身份后，files 上没有「关闭所有标签页」、todo 上仍有', async () => {
  const files = await renderToString(createSSRApp({
    render: () => h(rowsRenderer, { rows: table, toolWindowId: 'files' }),
  }))
  assert.equal(files.includes('关闭所有标签页'), false, '注册表答 false 的窗口：整行不该在 DOM 里')
  assert.ok(files.includes('合并标签页'), '另一条（标签形态）不受这一位管，必须还在')
  const todo = await renderToString(createSSRApp({
    render: () => h(rowsRenderer, { rows: table, toolWindowId: 'todo' }),
  }))
  assert.ok(todo.includes('关闭所有标签页'), '注册表写了 canCloseContents="true" 的窗口：这一行要回来')
  const noId = await renderToString(createSSRApp({ render: () => h(rowsRenderer, { rows: table }) }))
  assert.ok(noId.includes('关闭所有标签页'), '没给身份 = 答不出，保持现状')
})

test('渲染层：唯一那一行被窗口身份摘掉时，齿轮按钮整个不画（不留点开是空的按钮）', async () => {
  const closed = await renderToString(createSSRApp({
    render: () => h(gear, { rows: [closeAll], toolWindowId: 'files', label: '输出窗口选项' }),
  }))
  assert.equal(closed.includes('tool-gear'), false, '行表滤完是空的 ⇒ 连按钮都不该出现')
  const open = await renderToString(createSSRApp({
    render: () => h(gear, { rows: [closeAll], toolWindowId: 'todo', label: '输出窗口选项' }),
  }))
  assert.match(open, /class="icon-button"[^>]*aria-label="输出窗口选项"/, '同一个齿轮换到 todo 上就要画出来')
})

test('接线：标题栏把**自己那个窗口 id**交给行渲染器，齿轮按过闸后的行数决定画不画', () => {
  const header = read('src/components/ToolWindowHeader.vue')
  assert.match(header, /<ToolWindowGearRows :tool-window-id="id" :rows="extraRows" @pick="pickExtra" \/>/,
    '标题栏的齿轮组按本窗口现取（上游 InternalDecoratorImpl.kt:290 那个 gearProducer 的形状）')
  const gearSrc = read('src/components/ToolWindowGear.vue')
  assert.match(gearSrc, /const shownRows = computed\(\(\) => gearRowsForWindow\(props\.rows, props\.toolWindowId\)\)/,
    '齿轮的可见行要过同一道闸，且用的是传入的身份')
  assert.match(gearSrc, /v-if="shownRows\.length"/, '按钮的画不画用滤后的行数')
  assert.match(gearSrc, /if \(!shownRows\.value\.length\) return/, '点开也拦一道：没有行就不开弹层')
  assert.match(gearSrc, /<ToolWindowGearRows :tool-window-id="props\.toolWindowId" :rows="shownRows" @pick="pick" \/>/,
    '身份要一路带到渲染器，不能在齿轮里滤完就不给了')
})
