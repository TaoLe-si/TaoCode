// 侧条（工具窗口停靠条）的**宽度**与**「更多」按钮** —— IDEA `ResizeStripeManager.kt` +
// `MoreSquareStripeButton.kt` 的判据。
//
// 上游两条能力的形状（都核过本机安装的 2026.2：`javap -c -p` 反编译
// `D:\IntelliJ IDEA 2026.2\lib\intellij.platform.ide.impl.jar`）：
//   1. 宽度：`ResizeStripeManager` 是 `Splittable`，侧条内沿一条 1px 分隔线，拖它改宽度；
//      `checkMinMax`（`:138-150`）下限 compact 33 / 常规 40、上限 100；宽度 > 0 才显示名称
//      （`updateView:173-182`）；开关名称 = 把宽度重置成两侧默认 / 0（`applyShowNames:215-228`）。
//      2026.2 的 `Companion.enabled()` 是常量 true ⇒ `isShowNames() = UISettings.showToolWindowsNames`，
//      也就是"名称开着才拖得动"。
//   2. 「更多」：`AbstractMoreSquareStripeButton.isAvailable`（`:142`）= 存在"没有侧条按钮的窗口"；
//      `MoreSquareStripeButton.isAvailable`（`:78-80`）再加一条"按钮当前停在这一侧"
//      （`getMoreButtonSide()`，存在 `ToolWindowManagerState` 里，默认 LEFT）。
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createSSRApp, h, nextTick, ref } from 'vue'
import { renderToString } from 'vue/server-renderer'
import {
  STRIPE_NAMES_DEFAULT_WIDTH, clampStripeWidth, startStripeResize, stripeRailWidth, stripeShowsName,
  stripeWidthAfterDrag, stripeWidthLimits, stripeWidthsAfterShowNames,
} from '../src/stripeResize.ts'
import { sortedByMnemonicThenId } from '../src/toolWindows.ts'
import { createToolWindowStripes } from '../src/toolWindowStripes.ts'
import { loadSfc } from './vue-sfc-loader.mjs'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const read = relative => readFileSync(join(root, relative), 'utf8')
const { component: ToolStripe } = loadSfc('src/components/ToolStripe.vue')

function withStorage(run) {
  const store = new Map()
  const previous = globalThis.localStorage
  globalThis.localStorage = {
    getItem: key => (store.has(key) ? store.get(key) : null),
    setItem: (key, value) => { store.set(key, String(value)) },
    removeItem: key => { store.delete(key) },
  }
  try { return run(store) } finally { globalThis.localStorage = previous }
}

/** 同上，但回调是 async —— finally 必须等它跑完才还原桩（否则测试摸到的是真 localStorage）。 */
async function withStorageAsync(run) {
  const store = new Map()
  const previous = globalThis.localStorage
  globalThis.localStorage = {
    getItem: key => (store.has(key) ? store.get(key) : null),
    setItem: (key, value) => { store.set(key, String(value)) },
    removeItem: key => { store.delete(key) },
  }
  try { return await run(store) } finally { globalThis.localStorage = previous }
}

function makeStripes(overrides = {}) {
  return createToolWindowStripes({
    isDesktop: true,
    workspace: { value: { root: 'D:/p', name: 'p', entries: [] } },
    lspReady: { value: true },
    gradleAvailable: { value: true },
    explorer: { value: true },
    activeView: { value: 'files' },
    ...overrides,
  })
}

// --- 宽度（`ResizeStripeManager`）------------------------------------------------------------

test('宽度上下限就是上游的 [40,100]，紧凑模式下限 33', () => {
  assert.deepEqual(stripeWidthLimits(false), { min: 40, max: 100 })
  assert.deepEqual(stripeWidthLimits(true), { min: 33, max: 100 })
  assert.equal(clampStripeWidth(12, false), 40, '低于下限压到 40')
  assert.equal(clampStripeWidth(12, true), 33, '紧凑模式压到 33')
  assert.equal(clampStripeWidth(180, false), 100, '高于上限压到 100')
  assert.equal(clampStripeWidth(72.4, false), 72, '取整')
  assert.equal(clampStripeWidth(Number.NaN, false), 40, '坏值退到下限，不猜中间值')
})

test('拖动方向：左条跟指针走，右条镜像（分隔线在内沿）', () => {
  assert.equal(stripeWidthAfterDrag('left', 66, 12, false), 78)
  assert.equal(stripeWidthAfterDrag('right', 66, 12, false), 54, '右条的分隔线在左沿 ⇒ 往右拖是变窄')
  assert.equal(stripeWidthAfterDrag('left', 66, 500, false), 100, '拖过头也停在 100')
  assert.equal(stripeWidthAfterDrag('right', 66, -500, false), 100)
  assert.equal(stripeWidthAfterDrag('left', 66, -500, true), 33)
})

test('名称跟着宽度走：0 = 没有自定义宽度 = 不显示名字', () => {
  assert.equal(stripeShowsName(0), false)
  assert.equal(stripeShowsName(40), true)
  assert.equal(stripeRailWidth(0), 31, '0 用回 CSS 的基准轨道宽度')
  assert.equal(stripeRailWidth(80), 80)
})

test('开关名称 = 把两侧宽度重置（applyShowNames）', () => {
  assert.deepEqual(stripeWidthsAfterShowNames(true), { left: STRIPE_NAMES_DEFAULT_WIDTH, right: STRIPE_NAMES_DEFAULT_WIDTH })
  assert.deepEqual(stripeWidthsAfterShowNames(false), { left: 0, right: 0 })
})

test('拖出来的宽度跨重启保留，名称开关变化时由宿主调 applyShowNames 重置', async () => {
  await withStorageAsync(async store => {
    const stripes = makeStripes({ showNames: { value: true } })
    stripes.setStripeWidth('left', 88)
    assert.equal(stripes.stripeWidth('left'), 88)
    assert.ok(store.get('taocode.stripeWidths').includes('88'), '宽度要落盘')
    const reopened = makeStripes({ showNames: { value: true } })
    assert.equal(reopened.stripeWidth('left'), 88, '重开之后还是用户拖出来的宽度')
    assert.equal(reopened.stripeWidth('right'), STRIPE_NAMES_DEFAULT_WIDTH, '没拖过的那一侧仍是默认宽度')
    // 上游 applyShowNames 是设置页 onApply / 动作触发，本仓由外观域在设置变化时调它
    //（开关与 apply 一起走：`src/appearanceActions.ts` 的 watch 同时改 data-tool-names 与宽度）。
    const flag = ref(true)
    const host = makeStripes({ showNames: flag })
    host.setStripeWidth('left', 88)
    flag.value = true
    host.applyShowNamesWidths(true)
    assert.equal(host.stripeWidth('left'), STRIPE_NAMES_DEFAULT_WIDTH, '再开一次名称/重新应用 = 回到默认宽度')
    flag.value = false
    host.applyShowNamesWidths(false)
    assert.equal(host.stripeWidth('left'), 0, '关掉名称 = 宽度清成 0（存档里的 88 被替换）')
  })
})

// 这条是**真缺陷回归**：非 immediate 的 `watch` 在创建时就会求值一次取 oldValue，于是
// 「建模块时挂一个读设置域的 watch」会在宿主里撞 TDZ（`editorSettings` 声明在本模块之后）。
// 实测过：真 exe 里报 `ReferenceError: Cannot access 'dt' before initialization`。
// 所以宽度这一域只读存档，设置开关由宿主推。
test('建模块时不许去读"宿主声明得更晚"的设置域（TDZ 回归）', () => {
  const stripes = read('src/toolWindowStripes.ts')
  assert.ok(!/watch\(/.test(stripes), '这一层不能挂 watch：创建时求值会撞 TDZ')
  assert.match(read('src/appearanceActions.ts'), /deps\.applyShowNamesWidths\?\.\(show\)/,
    'applyShowNames 要有宿主侧的触发点')
  assert.match(read('src/App.vue'), /applyShowNamesWidths/, '宿主要把这条接线接上')
})

test('名称关着时存档里的宽度不生效（上游 updateState 把 myCustomWidth 归零）', () => {
  withStorage(store => {
    store.set('taocode.stripeWidths', JSON.stringify({ left: 88, right: 88 }))
    // 上一轮开着名称时拖出来的宽度留在存档里，这一次设置说名称是关的 ⇒ 轨道必须回基准宽度，
    // 否则会出现"轨道很宽但没有名字"的中间态。
    const off = makeStripes({ showNames: { value: false } })
    assert.equal(off.stripeWidth('left'), 0)
    assert.equal(off.stripeWidth('right'), 0)
    const on = makeStripes({ showNames: { value: true } })
    assert.equal(on.stripeWidth('left'), 88, '名称开着才读存档，而且是用户拖出来的那个值')
  })
})

test('存档里的坏值不会把轨道撑坏（越界宽度按上下限收）', () => {
  withStorage(store => {
    store.set('taocode.stripeWidths', JSON.stringify({ left: 4000, right: '宽' }))
    const stripes = makeStripes({ showNames: { value: true } })
    assert.equal(stripes.stripeWidth('left'), 100, '越界值收到上限')
    assert.equal(stripes.stripeWidth('right'), STRIPE_NAMES_DEFAULT_WIDTH, '认不出的值当没存过 ⇒ 默认宽度')
  })
})

test('分隔线拖动每一帧都写状态，抬起后收掉监听', () => {
  const listeners = new Map()
  const applied = []
  const target = {
    setPointerCapture() {}, hasPointerCapture: () => false, releasePointerCapture() {},
    addEventListener: (name, fn) => listeners.set(name, fn),
    removeEventListener: name => listeners.delete(name),
  }
  startStripeResize({ button: 0, preventDefault() {}, currentTarget: target, clientX: 200, pointerId: 1 },
    'left', { width: () => 66, apply: w => applied.push(w), compact: () => false })
  listeners.get('pointermove')({ pointerId: 1, clientX: 230 })
  assert.deepEqual(applied, [96])
  listeners.get('pointerup')({})
  assert.equal(listeners.size, 0, '抬起后三个出口的监听都要摘掉')
})

// --- 「更多」按钮（`MoreSquareStripeButton`）--------------------------------------------------

test('「更多」只在「有窗口没有侧条按钮」时可用，且只在它停靠的那一侧', () => {
  withStorage(() => {
    const stripes = makeStripes()
    assert.equal(stripes.moreButtonAvailable(), false, '所有窗口都有按钮时不该有「更多」')
    assert.equal(stripes.moreButtonVisible('left'), false)
    stripes.removeStripeButton('outline')
    assert.equal(stripes.moreButtonAvailable(), true)
    assert.equal(stripes.moreButtonVisible('left'), true, '默认在左侧（ToolWindowManagerState.moreButton = LEFT）')
    assert.equal(stripes.moreButtonVisible('right'), false)
    stripes.moveMoreButtonTo('right')
    assert.equal(stripes.moreButtonVisible('left'), false)
    assert.equal(stripes.moreButtonVisible('right'), true)
  })
})

test('「更多」的行就是被移除的那些窗口，排序照 ToolWindowsGroup（助记符 → id）', () => {
  withStorage(() => {
    const stripes = makeStripes()
    stripes.removeStripeButton('bookmarks')
    stripes.removeStripeButton('outline')
    assert.deepEqual(stripes.moreButtonRows.value, ['outline', 'bookmarks'],
      '结构视图 Alt+6 排在书签 Alt+7 前（助记符序，不是标题序）')
  })
})

test('不可用的窗口不进「更多」的表（本仓不列假行）', () => {
  withStorage(() => {
    // 语言服务没就绪时结构视图不可用（`ToolWindowImpl.isAvailable` 的等价物）。
    const stripes = makeStripes({ lspReady: { value: false } })
    stripes.removeStripeButton('outline')
    stripes.removeStripeButton('bookmarks')
    assert.deepEqual(stripes.moreButtonRows.value, ['bookmarks'], '不可用的那个窗口不该出现在弹层里')
  })
})

test('moreButtonSide 的存档照上游只记"与默认不同"的那一档', () => {
  withStorage(store => {
    const stripes = makeStripes()
    assert.equal(stripes.moreButtonSide.value, 'left')
    assert.equal(store.has('taocode.moreButtonSide'), false, '默认值不写盘')
    stripes.moveMoreButtonTo('right')
    assert.equal(store.get('taocode.moreButtonSide'), 'right')
    stripes.moveMoreButtonTo('left')
    assert.equal(store.has('taocode.moreButtonSide'), false, '挪回默认档就把那一条删掉')
    const reopened = makeStripes()
    assert.equal(reopened.moreButtonSide.value, 'left')
  })
})

test('助记符优先、其次窗口 id（大小写不敏感）—— 上游两个比较器都在用', () => {
  const mnemonic = id => ({ files: '1', git: '2', outline: '3' })[id]
  assert.deepEqual(sortedByMnemonicThenId(['outline', 'gradle', 'files', 'notifications', 'git'], mnemonic),
    ['files', 'git', 'outline', 'gradle', 'notifications'], '没有助记符的按 id 排到最后')
  assert.deepEqual(sortedByMnemonicThenId(['B', 'a'], () => undefined), ['a', 'B'], '大小写不敏感')
})

// --- 组件渲染（真模板，不是源码字符串）-------------------------------------------------------

const stripeProps = overrides => ({
  side: 'left', ids: ['files'], labels: { files: '项目', gradle: 'Gradle' }, icons: { files: 'span', gradle: 'span' },
  mnemonicOf: () => '1', isDisabled: () => false, isActive: () => false, dragging: null,
  isDropBefore: () => false, dropAtEnd: false, width: 0, showNames: false, compact: false,
  moreIds: [], moreOnThisSide: true, ...overrides,
})

const render = props => renderToString(createSSRApp({ render: () => h(ToolStripe, props) }))

test('按钮、名称与助记符照画（侧条按钮的 Alt+数字来自 keymap）', async () => {
  const html = await render(stripeProps({}))
  assert.match(html, /aria-label="切换项目"/)
  assert.match(html, />项目</, '名称写在按钮里（`.activity-name`，名称开关由 CSS 控制显示）')
  assert.match(html, /class="activity-number">1</)
})

test('分隔线只在名称开着时挂（isShowNames 是宽度拖动的闸）', async () => {
  assert.ok(!(await render(stripeProps({}))).includes('stripe-resize-handle'), '名称关着不该有拖拽分隔线')
  const wide = await render(stripeProps({ showNames: true, width: 88 }))
  assert.match(wide, /class="stripe-resize-handle"/)
  assert.match(wide, /aria-valuenow="88"/)
  assert.match(wide, /class="activity-bar"[^>]*width:88px;min-width:88px/, '轨道宽度就是这一侧的自定义宽度')
})

test('「更多」按钮只在有行、且轮到自己那一侧时出现，弹层列出行', async () => {
  assert.ok(!(await render(stripeProps({ moreIds: ['gradle'], moreOnThisSide: false }))).includes('stripe-more"'), '轮到别的侧就别画按钮')
  const hidden = await render(stripeProps({ moreIds: [], moreOnThisSide: true }))
  assert.ok(!hidden.includes('stripe-more"'), '没有行就没有按钮')
  const shown = await render(stripeProps({ moreIds: ['gradle'], moreOnThisSide: true }))
  assert.match(shown, /class="activity-button stripe-more"/)
  assert.match(shown, /aria-label="更多"/, 'more.button.accessible.name = 更多')
  // 弹层本体只在点开时渲染（`moreOpen`），SSR 抓不到 —— 所以这一条盯源码里那个 v-for 的对象。
  const source = read('src/components/ToolStripe.vue')
  assert.match(source, /v-for="id in moreIds"/, '弹层必须逐行画 moreIds，否则按钮点开是空的')
  assert.match(source, /emit\('morePick', id\)/, '点一行要真的激活那个窗口')
})

test('侧条空白处右键给出「显示工具窗口名称」（ResizeStripeManager 挂的那条 PopupHandler）', async () => {
  const html = await render(stripeProps({ showNames: false }))
  assert.ok(!html.includes('显示工具窗口名称'), '没点开时不该有那一行')
  // 组件把这一条挂在轨道的 contextmenu 上；模板里必须真有那个入口，否则这条菜单永远打不开。
  const source = read('src/components/ToolStripe.vue')
  assert.match(source, /@contextmenu\.prevent="openNamesMenu"/)
  assert.match(source, /显示工具窗口名称/, 'ActionsBundle:2813 的中文文案')
})

// 真 exe 里踩到的第二个坑：按钮的 contextmenu 会**冒泡**到轨道，于是右键侧条按钮会同时弹出
// 齿轮菜单和「显示工具窗口名称」，后者的遮罩随后吞掉下一次点击（拖拽也就跟着失效）。
// 上游是按钮自己的 PopupHandler 吃掉事件（`checkSkipPressForEvent`），所以按钮这一侧要 stop。
test('侧条按钮的右键不许冒泡到轨道（两个菜单不能同时开）', () => {
  const source = read('src/components/ToolStripe.vue')
  assert.match(source, /@contextmenu\.prevent\.stop="emit\('menu', id, \$event\)"/,
    '按钮的 contextmenu 必须 .prevent.stop，否则轨道的名称开关菜单也会开')
  assert.match(source, /@contextmenu\.prevent="openNamesMenu"/, '轨道空白处仍要有名称开关那一份')
})

// --- 接线：宿主与组件不许各留一半 ------------------------------------------------------------

test('宿主把两条侧条都交给组件，宽度/名称/更多按钮都从状态域来', () => {
  const app = read('src/App.vue')
  assert.equal((app.match(/<ToolStripe/g) ?? []).length, 2, '左右两条侧条各一个组件')
  assert.ok(!app.includes('aria-label="工具栏"'), '轨道本体已经搬进组件，宿主里不该再有一份')
  assert.match(app, /:width="stripeWidth\('left'\)"/)
  assert.match(app, /@resize="width => setStripeWidth\('left', width\)"/)
  assert.match(app, /@move-more-to="moveMoreButtonTo"/)
  assert.match(app, /@toggle-names="toggleToolWindowNames"/)
  assert.match(app, /moreButtonVisible\('right'\)/)
  const css = read('src/style.css')
  assert.match(css, /\.stripe-resize-handle \{ position: absolute/, '分隔线要贴着轨道内沿')
  assert.match(css, /\.stripe-popup-more \{ min-width: 300px; \}/, 'ShowMoreToolWindowsAction.minPopupWidth = JBUI.scale(300)')
  assert.match(css, /\.stripe-list \{/, '按钮列表自己滚，轨道本体不能再滚（否则分隔线跟着内容滚）')
})
