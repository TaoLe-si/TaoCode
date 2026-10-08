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
// 反向同理（2026-10-06 补齐）：移除**包含**隐藏 —— 上游是同一次 `hideToolWindow(removeFromStripe = true)`
// 里的两半，只盯第 ② 半会把"面板还开着"那一半漏掉，见下面「移除的**第 ① 半**」那三条。
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

// ── 移除的**第 ① 半**（收面板）：stripefix 2026-10-06 补的判据 ────────────────────────────
// 上游这"两半"是**同一次调用**：`ToolWindowImpl.kt:923-925` 的 `actionPerformed` →
// `ToolWindowManagerImpl.kt:833-868` 的 `hideToolWindow(…, removeFromStripe = true)`，
// 里面先 `setHiddenState`（`:712-719`，`info.isVisible = false` 在 `:716`）收面板，
// 再由 `mutation`（`:849-853`）写 `isShowStripeButton = false` + `entry.removeStripeButton()` 摘按钮。
// 上面那些判据只盯住了第 ② 半（"侧条上没有它了"），于是第 ① 半退回成"按钮没了、面板还开着"
// 那一格孤儿态 —— 上游 `ToolWindowManagerImpl.kt:1626-1627` 那句
// "A safety check: if the tool window is visible, we ignore isShowStripeButton" 防的就是它。
//
// 夹具说明：宿主那边是 `watch([explorer, bottom, bottomTab, activeView], saveVisibility)`
// （`src/toolWindowStripes.ts:767`）在维持"记录里的 visible = 此刻开着的那些"。单测里那几个 dep
// 是普通对象、没有响应式，所以每条用例先显式 `saveVisibility()` 打一次底 —— 之后记录里那一位的
// 变化就只能由**被清算的那次调用**产生，判据才有牙。
test('移除正在显示的那一格：面板跟着收起，visible 与 showStripeButton 同批落盘', () => {
  withStorage(store => {
    const explorer = { value: true }
    const stripes = makeStripes({ explorer, activeView: { value: 'outline' } })
    stripes.saveVisibility()
    assert.ok(stripes.stripeOrder.value('left').includes('outline'), '前提：结构视图在左侧条上')
    assert.equal(JSON.parse(store.get('taocode.toolLayout:D:/p')).windows.outline.visible, true,
      '前提：它此刻就是侧栏开着的那个')
    stripes.removeStripeButton('outline')
    assert.equal(explorer.value, false, '第 ① 半：面板必须收起（上游 setHiddenState，:712-719）')
    const record = JSON.parse(store.get('taocode.toolLayout:D:/p')).windows.outline
    assert.equal(record.showStripeButton, false, '第 ② 半：按钮摘掉')
    assert.equal(record.visible, false, '同一条记录里两半必须一致，否则就是"看得见却没有入口"')
  })
})

test('底部那一侧同理：移除当前选中的底部 tab 才收底部 dock', () => {
  withStorage(store => {
    const bottom = { value: true }
    const bottomTab = { value: 'todo' }
    const stripes = makeStripes({ bottom, bottomTab })
    stripes.saveVisibility()
    assert.ok(stripes.bottomAnchoredIds.value.includes('todo'), '前提：TODO 默认停在底部')
    assert.equal(JSON.parse(store.get('taocode.toolLayout:D:/p')).windows.todo.visible, true, '前提：底部开着它')
    stripes.removeStripeButton('todo')
    assert.equal(bottom.value, false, '底部 dock 开着且显示的就是它 ⇒ 一起收（同一条 setHiddenState）')
    assert.equal(JSON.parse(store.get('taocode.toolLayout:D:/p')).windows.todo.visible, false)
  })
})

test('只收它自己那一格：移除没在显示的窗口不许把别的窗口带下去', () => {
  withStorage(store => {
    const explorer = { value: true }
    const bottom = { value: true }
    const stripes = makeStripes({ explorer, activeView: { value: 'files' }, bottom, bottomTab: { value: 'todo' } })
    stripes.saveVisibility()
    stripes.removeStripeButton('outline')
    assert.equal(explorer.value, true, '侧栏此刻显示的是 files，outline 被移除不该收掉它')
    assert.equal(bottom.value, true, '底部同理')
    const windows = JSON.parse(store.get('taocode.toolLayout:D:/p')).windows
    assert.equal(windows.files.visible, true, 'files 仍开着')
    assert.equal(windows.todo.visible, true, 'todo 仍开着')
    assert.equal(windows.outline.showStripeButton, false, '被移除的那个仍然摘掉按钮')
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
