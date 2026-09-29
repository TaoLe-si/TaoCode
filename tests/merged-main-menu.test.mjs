// `MERGED_WITH_MAIN_TOOLBAR` 档的顶层菜单溢出折叠（IDEA `MainMenuWithButton.kt:62-131`）。
//
// 这个域的两类事故都要靠测试钉住：
//   1. **算术**：折叠预算里漏掉溢出按钮自身的宽度、或者允许把项折光，界面上都看不出来，
//      只有在窗口刚好窄到那个宽度时才露馅 —— 所以逐条按上游的判定写成断言；
//   2. **接线**：`planMergedMenu` 算得再对，只要 App.vue 没消费 `menuVisibleCount`，
//      就是一个「只在运行时暴露的空功能」（本仓同类坑已踩过三次，见 routing-parity 的开头注释）。
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { MAIN_MENU_BUTTON_WIDTH, MAIN_MENU_INSETS, planMergedMenu } from '../src/mergedMainMenu.ts'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const read = relative => readFileSync(join(root, relative), 'utf8')

test('上游的两个常量：按钮 30、余量 20', () => {
  assert.equal(MAIN_MENU_BUTTON_WIDTH, 30, 'JBUI.java:1276 defaultExperimentalToolbarButtonSize = 30x30')
  assert.equal(MAIN_MENU_INSETS, 20, 'MainMenuWithButton.kt:59 toolbarInsetsConst = 20')
})

test('宽度够 → 一项都不折，也不显示溢出按钮', () => {
  const plan = planMergedMenu({ rowWidth: 1000, toolbarWidth: 300, itemWidths: [60, 60, 60] })
  assert.deepEqual(plan, { visibleCount: 3, showOverflow: false })
})

test('差一项的宽度 → 从尾部折，折完刚好放得下', () => {
  // 三项要 180 + 工具栏 300 + 余量 20 = 500；两项 + 溢出按钮要 120 + 30 + 320 = 470。
  const plan = planMergedMenu({ rowWidth: 470, toolbarWidth: 300, itemWidths: [60, 60, 60] })
  assert.deepEqual(plan, { visibleCount: 2, showOverflow: true })
})

test('溢出按钮自身的宽度必须计入预算（漏掉它就会永远差一像素）', () => {
  // 同一个 455：把按钮算成零宽就能多摆一项 —— 差的那 30px 正是按钮自己。
  const ignoresButton = planMergedMenu({ rowWidth: 455, toolbarWidth: 300, itemWidths: [60, 60, 60], buttonWidth: 0 })
  assert.deepEqual(ignoresButton, { visibleCount: 2, showOverflow: true })
  const countsButton = planMergedMenu({ rowWidth: 455, toolbarWidth: 300, itemWidths: [60, 60, 60] })
  assert.deepEqual(countsButton, { visibleCount: 1, showOverflow: true })
})

test('一项都放不下也留着一项，且不折第二项以外的东西', () => {
  const plan = planMergedMenu({ rowWidth: 100, toolbarWidth: 300, itemWidths: [60, 60, 60] })
  assert.deepEqual(plan, { visibleCount: 1, showOverflow: true }, 'MainMenuWithButton.kt:95 `size <= 1` 就 break')
})

test('只有一项时即使放不下也不显示溢出按钮（没有东西可折）', () => {
  const plan = planMergedMenu({ rowWidth: 10, toolbarWidth: 300, itemWidths: [60] })
  assert.deepEqual(plan, { visibleCount: 1, showOverflow: false })
})

test('空菜单：既不摆项也不出按钮', () => {
  assert.deepEqual(planMergedMenu({ rowWidth: 500, toolbarWidth: 300, itemWidths: [] }),
    { visibleCount: 0, showOverflow: false })
})

test('折叠只能是尾部前缀：省地方的那一项在最前面也不能被折掉', () => {
  // 折掉首项（200）能省最多，但上游是把菜单横向摆在行面左侧、只从**末尾**收（:94 `indices.reversed()`），
  // 所以这里的结果必须是「留 1 项 + 出按钮」，而不是「留后两项」。
  const plan = planMergedMenu({ rowWidth: 360, toolbarWidth: 300, itemWidths: [200, 10, 10] })
  assert.deepEqual(plan, { visibleCount: 1, showOverflow: true })
})

// ---- 接线：算出来的东西真的被模板消费，否则整块折叠是死代码 ----

test('merged 折叠已接进顶栏（App.vue 消费可见项数，appearanceActions 提供溢出按钮）', () => {
  const app = read('src/App.vue')
  const actions = read('src/appearanceActions.ts')
  const style = read('src/style.css')
  assert.match(app, /class="menu-anchor"[^>]*'menu-folded': groupIndex >= menuVisibleCount/,
    '菜单栏不再按可见项数折叠 —— 溢出按钮会亮着但行面仍然溢出')
  assert.match(app, /v-if="menuButtonVisible"/, '汉堡/溢出按钮不再由 menuButtonVisible 驱动')
  assert.match(actions, /useMergedMainMenu\(\{/, 'appearanceActions 没有挂上折叠测量')
  assert.match(actions, /menuVisibleCount: mergedMenu\.visibleCount, menuButtonVisible: mergedMenu\.menuButtonVisible/,
    '折叠结果没有回传给 App.vue')
  assert.match(style, /\.menu-folded \{ display: none; \}/, '缺少折叠样式：被折掉的菜单项仍会占位')
  assert.match(style, /html\[data-main-menu='merged'\]\[data-menu-expanded='on'\] \.menubar/,
    '溢出按钮点开的是完整菜单弹层 —— merged 档缺这条就弹不出来')
})
