// 「从侧栏移除按钮」的判据（IDEA `RemoveStripeButtonAction`）。
//
// 上游：`ToolWindowImpl.kt:914-925`（`update` 里 `isEnabledAndVisible = isShowStripeButton`；
// 执行 = `hideToolWindow(id, removeFromStripe = true)`）、
// `ToolWindowManagerImpl.kt:849-853`（`info.isShowStripeButton = false` + `entry.removeStripeButton()`）、
// `:942`（`showToolWindowImpl` 里 `isShowStripeButton = true` ⇒ 再激活就回来）、
// 文案 `ActionsBundle.properties:1170-1171`。
//
// 关键区别（这一条最容易做错）：**移除 ≠ 隐藏**。隐藏只收面板，按钮留在侧条上；
// 移除是把按钮摘掉。所以判据要盯住"stripeOrder 里没有它了"，而不只是"面板收起了"。
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createToolWindowStripes } from '../src/toolWindowStripes.ts'
import { gearHostRows, removeStripeButtonGearRow } from '../src/gearHostRows.ts'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const read = relative => readFileSync(join(root, relative), 'utf8')

/** 干净的 localStorage 桩（模块读盘只在建实例时发生一次）。 */
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

function makeStripes() {
  return createToolWindowStripes({
    isDesktop: true,
    workspace: { value: { root: 'D:/p', name: 'p', entries: [] } },
    lspReady: { value: true },
    gradleAvailable: { value: true },
    explorer: { value: true },
    activeView: { value: 'files' },
  })
}

test('移除后侧条上真的没有这个按钮了（不是只收面板）', () => {
  withStorage(() => {
    const stripes = makeStripes()
    assert.ok(stripes.stripeOrder.value('left').includes('outline'), '前提：结构视图本来在左侧条上')
    stripes.removeStripeButton('outline')
    assert.equal(stripes.stripeOrder.value('left').includes('outline'), false, '按钮必须从侧条上消失')
    assert.equal(stripes.hiddenStripeButtons.has('outline'), true)
  })
})

test('停靠在底部的窗口被移除后，底部那一排 tab 也不再列它', () => {
  withStorage(() => {
    const stripes = makeStripes()
    assert.ok(stripes.bottomAnchoredIds.value.includes('todo'), '前提：TODO 默认停在底部')
    stripes.removeStripeButton('todo')
    assert.equal(stripes.bottomAnchoredIds.value.includes('todo'), false, 'isShowStripeButton 也管着底部那一排')
  })
})

test('再激活就回来（showToolWindowImpl 的 isShowStripeButton = true）', () => {
  withStorage(() => {
    const stripes = makeStripes()
    stripes.removeStripeButton('outline')
    stripes.restoreStripeButton('outline')
    assert.ok(stripes.stripeOrder.value('left').includes('outline'), '激活路径要把它放回侧条')
  })
})

test('移除是持久化的（机器偏好，与锚点/顺序同类）', () => {
  withStorage(store => {
    makeStripes().removeStripeButton('bookmarks')
    assert.equal(JSON.parse(store.get('taocode.toolLayout:D:/p')).windows.bookmarks?.showStripeButton, false,
      '要落盘（项目级布局里那条记录的 showStripeButton）')
    const reopened = makeStripes()
    assert.equal(reopened.stripeOrder.value('left').includes('bookmarks'), false, '重开之后仍然是移除状态')
  })
})

test('坏掉的存档不会让侧条变空（只认表里存在的窗口 id）', () => {
  withStorage(store => {
    store.set('taocode.toolLayout:D:/p', JSON.stringify({ windows: {
      outline: { showStripeButton: false }, '不存在的窗口': { showStripeButton: false },
    } }))
    const stripes = makeStripes()
    assert.deepEqual([...stripes.hiddenStripeButtons], ['outline'], '认不出的项丢掉，其余照收')
    assert.equal(stripes.stripeOrder.value('left').includes('files'), true, '与坏存档无关的窗口不受影响')
  })
})

test('那一行的文案与可见性照源码', () => {
  const already = removeStripeButtonGearRow(true, () => {})
  assert.equal(already, null, '按钮已经不在侧条上时这一行不出现（update: isEnabledAndVisible = isShowStripeButton）')
  let removed = 0
  const row = removeStripeButtonGearRow(false, () => { removed++ })
  assert.equal(row.title, '从侧栏移除', 'ActionsBundle.properties:1170 = Remove from Sidebar')
  row.run()
  assert.equal(removed, 1, '行在却不干活 = 假控件')
})

test('宿主把两行一起给齿轮，且移除作用在当前激活的窗口上', () => {
  const host = read('src/gearHostRows.ts')
  assert.match(host, /export function gearHostRows\(/, '两条宿主行要有同一个入口')
  // 2026-10-06：`activateToolWindow` 整段搬到 src/appToolWindowActivation.ts（逐字等价），
  // 所以读取面带上那一半；下面两条断言本体一字未改。
  const app = read('src/App.vue') + '\n' + read('src/appToolWindowActivation.ts')
  assert.match(app, /gearHostRowMap\(leftView\.value, Boolean\(workspace\.value\), fileTreeRef\.value, hiddenStripeButtons\.has\(leftView\.value\), \(\) => removeStripeButton\(leftView\.value\)\)/,
    '主菜单/齿轮的宿主行注入点')
  // 激活路径要复原按钮，否则"移除"是一条不归路。
  assert.match(app, /restoreStripeButton\(id\)/, 'activateToolWindow 里没有复原按钮')
  const spec = read('src/menus/toolWindowGear.ts')
  assert.match(spec, /\{ action: 'window\.removeStripeButton', fromHost: true \}/, '齿轮表里少了这一条')
})
