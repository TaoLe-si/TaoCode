// 工具窗口齿轮菜单（IDEA `ToolWindowImpl.createPopupGroup` + `GearActionGroup`）的判据。
//
// 与编辑器右键菜单同一套设计：**齿轮组只登记引用**，标题/快捷键/可用性都回主菜单动作索引拿。
// 于是这条门禁要盯两件事 —— 引用的 id 必须存在（改名会让齿轮静默少行），
// 以及"上游有但我们接不住"的那几项必须留在登记里，而不是悄悄变成一个假控件。
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { TOOL_WINDOW_GEAR_SPEC, toolWindowGearRows } from '../src/menus/toolWindowGear.ts'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const read = relative => readFileSync(join(root, relative), 'utf8')

function knownActionIds() {
  const found = new Set()
  for (const file of readdirSync(join(root, 'src/menus'))) {
    const source = readFileSync(join(root, 'src/menus', file), 'utf8')
    for (const match of source.matchAll(/id:\s*'([^']+)'/g)) found.add(match[1])
    for (const match of source.matchAll(/\b(?:editable|semantic)\('(\w[\w.]*)'/g)) found.add(match[1])
  }
  return found
}

test('齿轮引用表就是本仓真能接住的那几条（顺序即上游 GearActionGroup）', () => {
  assert.deepEqual(TOOL_WINDOW_GEAR_SPEC.map(entry => entry.action),
    ['usage.viewOptions', 'usage.groupBy', 'window.speedSearch', 'window.closeAllTabs', 'window.toggleContentUiType', 'window.resizeToolWindow', 'window.removeStripeButton'],
    'additionalGearActions 在最前（`ToolWindowImpl.kt:859-868`）—— 本仓把用法视图的两组都放这一档：'
    + '「视图选项」= `UsageViewContentManagerImpl.java:114-116` 的 gearActions，'
    + '「分组」= `UsageViewImpl.java:1089-1098` 的弹出组（上游在工具条上，本仓引用面板没有那一层，落点见 `src/usageViewGear.ts`）；'
    + 'SpeedSearch 次之（:869）、RemoveStripeButton 在最后（:889），中间三条照 :872-887')
  const known = knownActionIds()
  // `window.speedSearch` 不在菜单索引里（上游 `PlatformActions.xml:146` 只是顶层 `<reference>`），
  // 它由宿主按"焦点处有没有可搜的列表"提供 —— 所以只核**引用型**那几条。
  const missing = TOOL_WINDOW_GEAR_SPEC.filter(entry => !entry.fromHost).map(entry => entry.action).filter(id => !known.has(id))
  assert.deepEqual(missing, [], `这些 id 在主菜单里不存在，齿轮会静默少行：${missing.join(', ')}`)
})

// 内容动作只属于"挂着内容的那个窗口"。本仓的内容条（引用 / 层次）在底部 dock，
// 侧栏齿轮要是也给出"关闭所有标签页"，点一下清的是别人的标签 —— 那是假控件的另一种形态。
test('内容那一组只在挂着内容的窗口上出现', () => {
  const row = id => ({ id, title: `标题-${id}`, run: () => {} })
  assert.deepEqual(toolWindowGearRows(row).map(item => item.id), ['window.resizeToolWindow'],
    '侧栏齿轮：只有"调整工具窗口"这一条与内容无关（SpeedSearch 是宿主给的，不是引用型）')
  assert.deepEqual(toolWindowGearRows(row, undefined, true).map(item => item.id),
    ['window.closeAllTabs', 'window.toggleContentUiType', 'window.resizeToolWindow'])
  // 宿主给了 SpeedSearch 行时它在最前，且**侧栏/底部两侧都给**（上游那个 action 对每个窗口都加）。
  const host = { 'window.speedSearch': { id: 'window.speedSearch', title: '速度搜索', run: () => {} } }
  assert.deepEqual(toolWindowGearRows(row, undefined, false, host).map(item => item.id),
    ['window.speedSearch', 'window.resizeToolWindow'])
  assert.deepEqual(toolWindowGearRows(row, undefined, true, host).map(item => item.id),
    ['window.speedSearch', 'window.closeAllTabs', 'window.toggleContentUiType', 'window.resizeToolWindow'])
})

test('取不到的引用不进菜单（不渲染假控件）', () => {
  const row = id => ({ id, title: `标题-${id}`, run: () => {} })
  assert.equal(toolWindowGearRows(row, undefined, true).length, 3)
  assert.deepEqual(toolWindowGearRows(() => undefined, undefined, true), [])
  // 宿主没有可搜的列表时不传这一行 —— 与"引用一个不存在的动作"同样整行不见。
  assert.deepEqual(toolWindowGearRows(() => undefined, undefined, true, {}), [])
  // 只少一条时其余仍在，且不会留下一行空白占位。
  const partial = toolWindowGearRows(id => id === 'window.resizeToolWindow' ? undefined : row(id), undefined, true)
  assert.deepEqual(partial.map(item => item.id), ['window.closeAllTabs', 'window.toggleContentUiType'])
})

// CloseAllAction 的 update() 用的是 setEnabledAndVisible（TabbedContentAction.java:146-151），
// 而 ToggleContentUiTypeAction 用的是 setEnabled（:19-21）：前者不适用时整行不见，
// 后者灰着留在原位。混成一种就是照着源码抄错了。
test('不可关内容时「关闭所有标签页」整条消失，「标签形态」只是灰着', () => {
  const rows = {
    'window.closeAllTabs': { id: 'window.closeAllTabs', title: '关闭所有标签页', enabled: () => false, run: () => {} },
    'window.toggleContentUiType': { id: 'window.toggleContentUiType', title: '合并标签页', enabled: () => false, run: () => {} },
    'window.resizeToolWindow': { id: 'window.resizeToolWindow', title: '调整工具窗口', run: () => {} },
  }
  const found = toolWindowGearRows(id => rows[id], undefined, true).map(item => item.id)
  assert.deepEqual(found, ['window.toggleContentUiType', 'window.resizeToolWindow'],
    '没有可关内容时 Close All 必须整条不见（setEnabledAndVisible(false)）')
  // 有可关内容时这一条回来；同时"标签形态"仍然不可用（只有一类内容时）但**留在原位灰着**。
  const mixed = toolWindowGearRows(id => id === 'window.closeAllTabs' ? { ...rows[id], enabled: () => true } : rows[id], undefined, true)
  assert.deepEqual(mixed.map(item => item.id), ['window.closeAllTabs', 'window.toggleContentUiType', 'window.resizeToolWindow'])
  assert.equal(mixed[0].enabled?.(), true, 'Close All 跟着 canCloseAllContents() 走')
  assert.equal(mixed[1].enabled?.(), false, '标签形态那条留在原位但灰着')
})

test('接线：齿轮行由 menuUi 解析、标题栏只负责渲染与回抛', () => {
  const ui = read('src/menuUi.ts')
  assert.match(ui, /toolWindowGearLayout\(findMenuRow, undefined, false, gearHostRows\(\)\)/,
    '齿轮行必须走同一张动作索引（findMenuRow），否则又是一处复制的标题；宿主行额外合成一份')
  assert.match(ui, /gearHostRows\?: \(\) => Record<string, MenuRow>/, '两条宿主行（速度搜索 / 从侧栏移除）走同一个入口')
  const header = read('src/components/ToolWindowHeader.vue')
  assert.match(header, /extraRows\.length/, '没有可用引用时整段（含分隔线）都不该出现')
  // 原写 `:rows="extraRows" @pick="pickExtra"`（没有窗口身份那一位）；W-TW2-3 的组件侧给渲染器
  // 加了 `:tool-window-id="id"` —— 上游那份齿轮组本来就是按**这个头部自己的 `ToolWindow`** 现取的
  // （`InternalDecoratorImpl.kt:290`），断言仍是逐字整段匹配，严格度没降。
  assert.match(header, /<ToolWindowGearRows :tool-window-id="id" :rows="extraRows" @pick="pickExtra" \/>/,
    '行列表要交给共用的渲染器（底部 dock 的齿轮用的是同一个），并且把本窗口的身份一起递下去')
  assert.match(header, /emit\('pickExtra', row\)[\s\S]{0,80}focusHeader\(\)/,
    '点完要把焦点还给标题栏，不然键盘焦点掉在已关闭的浮层上')
  const shared = read('src/components/ToolWindowGearRows.vue')
  assert.match(shared, /class="menu-button tool-menu-item is-child"/, '组行成员要缩进一档，和父行区分开')

  const app = read('src/App.vue')
  // 左右两个 dock 共用同一个头部组件，但左右分栏后**各有各的窗口** ⇒ 各拿各的行
  // （原先右侧也读左栏那份 toolWindowGearRows，齿轮里出现的是左栏视图的动作 —— 耦合 bug）。
  assert.equal((app.match(/:extra-rows="toolWindowGearRows"/g) ?? []).length, 1)
  assert.match(app, /:extra-rows="rightToolWindowGearRows"/, '右 dock 的齿轮要拿右栏自己那份行')
  assert.match(read('src/menuUi.ts'), /rightToolWindowGearRows = computed\(\(\) => toolWindowGearLayout\(findMenuRow, undefined, false, \(rightGearHostRows \?\? gearHostRows\)\(\)\)\)/,
    '右栏那份同样走动作索引 + 自己的宿主行（rightGearHostRows 跟着 rightView 算）')
  assert.match(app, /@pick-extra="pickEditorPopup\(\$event\); toolMenu = null"/,
    '齿轮项的执行必须复用 runAction 那条链（可用性提示 + 宏记录都在那里），并关掉菜单')
  // 底部 dock 的标题条以前没有齿轮：内容动作只能从主菜单进，而同样的动作侧栏一点就开。
  assert.match(app, /<ToolWindowGear :tool-window-id="bottomTab" :rows="bottomGearRows" label="输出窗口选项" @pick="pickEditorPopup\(\$event\)" \/>/,
    '底部 dock 的标题条要有同一个齿轮，走同一条执行链，并把「当前选中哪一格」交给它（齿轮行的关闭组按窗口身份滤，见 tool-window-gear-identity）')
  assert.match(read('src/menuUi.ts'), /bottomGearRows = computed\(\(\) => toolWindowGearLayout\(findMenuRow, undefined, true, bottomGearHostRows\(\)\)\)/,
    '底部那一份要显式声明"这是挂着内容的窗口"，并把宿主行（用法视图的「视图选项」组）一起算进来')
  assert.match(read('src/components/ToolWindowGear.vue'), /Teleport v-if="open" to="body"/,
    '弹层要 Teleport 到 body：`.output-panel` 是 overflow:hidden，长在里面的菜单会被裁掉')
  assert.match(read('src/style.css'), /\.tool-gear-menu \{ position: fixed/, '同上：fixed 定位才躲得开裁剪')

  // 上游有、本仓暂时接不住的：必须留在登记里，而不是被悄悄画成一行假的。
  const docs = read('docs/class-parity-todo.md')
  for (const name of ['SpeedSearch', 'ViewMode', 'RemoveStripeButton']) {
    assert.ok(docs.includes(name), `齿轮里缺「${name}」这件事没有登记在 docs/class-parity-todo.md`)
  }
})

// ---------------------------------------------------------------------------
// 渲染层（SSR）：判据只看字符串接线的话，"按钮在但点开是空的"、"没有行还画一个按钮"
// 这类形状都会漏过去 —— 底部 dock 那个齿轮是新写的 DOM，必须真渲一次。
// ---------------------------------------------------------------------------
const { loadSfc } = await import('./vue-sfc-loader.mjs')
const { createSSRApp, h } = await import('vue')
const { renderToString } = await import('vue/server-renderer')
const gear = loadSfc('src/components/ToolWindowGear.vue').component
const gearRows = loadSfc('src/components/ToolWindowGearRows.vue').component
// 标题与快捷键都用本仓真有的那些：`window.closeActiveTab` 的 Ctrl Shift F4
// （src/menus/windowMenu.ts:134），组行的形状照 `window.resizeToolWindow`（它自带 children）。
const sampleRows = [
  { id: 'a', title: '关闭所有标签页', run: () => {} },
  { id: 'b', title: () => '合并标签页', run: () => {}, children: [{ id: 'b1', title: '关闭当前标签页', keys: 'Ctrl Shift F4', run: () => {} }] },
]
const render = props => renderToString(createSSRApp({ render: () => h(gear, props) }))

test('齿轮按钮：有行才画，点开之前没有浮层', async () => {
  const html = await render({ rows: sampleRows, label: '输出窗口选项' })
  assert.match(html, /class="icon-button"[^>]*aria-label="输出窗口选项"/, '按钮要有一句话说明（⋮ 自己看不出是什么）')
  assert.equal(html.includes('tool-gear-menu'), false, '没点开就不该有弹层 DOM')
  assert.equal((await render({ rows: [] })).includes('tool-gear'), false, '一行都没有时连按钮都不画')
})

test('内容组渲染：函数标题、快捷键与不可用的行各自到位', async () => {
  const html = await renderToString(createSSRApp({ render: () => h(gearRows, { rows: sampleRows }) }))
  assert.ok(html.includes('关闭所有标签页'), '普通行')
  assert.ok(html.includes('合并标签页'), 'title 是函数时要调用它')
  assert.ok(html.includes('<kbd>Ctrl Shift F4</kbd>'), '组行成员要把快捷键带上（标题栏那几条靠这个对齐）')
  const child = html.match(/<button[^>]*is-child[\s\S]*?<\/button>/)
  assert.ok(child, '组行成员缩进一档（is-child 才是缩进的载体，不是文字前面多几个空格）')
  assert.ok(child[0].includes('关闭当前标签页'), '组行成员是那条带快捷键的行')
  assert.ok(child[0].includes('menu-item-icon'), '成员行与普通行走同一个 14px 槽，两种行字首才对得齐')
  const disabled = await renderToString(createSSRApp({
    render: () => h(gearRows, { rows: [{ id: 'x', title: '关闭所有标签页', enabled: () => false, run: () => {} }] }),
  }))
  assert.match(disabled, /disabled/, 'enabled() 为假时按钮必须禁用（菜单行的可用性在动作自己那里）')
})
