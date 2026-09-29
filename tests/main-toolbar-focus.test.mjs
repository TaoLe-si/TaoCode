// 主工具栏**键盘焦点**的判据（IDEA `FocusMainToolbarAction` + `MainToolbarFocusSupport`）。
//
// 上游坐标写在 `src/mainToolbarFocus.ts` 的文件头（动作 id `FocusMainToolbar` =
// `intellij.platform.ide.impl.actions.xml:721`，文案 `ActionsBundle.properties:79-80`；
// 焦点支持的三个方法在 `MainToolbarFocusSupport.kt:51-61` / `:66-70` / `:87-101`，
// 遍历键 `:216-224`）。这一条盯四件事：
//   ① 纯判据与上游逐条对得上（守卫、取条目、回焦点的两支、←/→）；
//   ② 动作真的挂进了动作索引（与 `window.focusStatusBar` 同一处，且顺序照 PlatformActions.xml:1364/1366）；
//   ③ 工具栏真的处理 Esc 与 ←/→；
//   ④ 上游那条"走到头落到标题栏菜单按钮"的差异留在登记里（本仓直接回环）。
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  focusInsideToolbar, focusMainToolbar, focusableToolbarItems, moveToolbarFocus, nextToolbarItemIndex,
  resetMainToolbarFocusState, resolveToolbarRestoreTarget, restoreFocusFromMainToolbar, shouldFocusFirstToolbarItem,
} from '../src/mainToolbarFocus.ts'
import { pickEditorToFocus } from '../src/editorFocus.ts'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const read = relative => readFileSync(join(root, relative), 'utf8')

test('取条目：没显示或不可用的不参与（上游 getFocusableAndEnabledItems）', () => {
  const items = [
    { id: 'a', hidden: false, disabled: false },
    { id: 'b', hidden: true, disabled: false },   // 折叠起来的（offsetParent === null）
    { id: 'c', hidden: false, disabled: true },   // 灰着的
    { id: 'd', hidden: false, disabled: false },
  ]
  assert.deepEqual(focusableToolbarItems(items).map(item => item.id), ['a', 'd'])
  assert.deepEqual(focusableToolbarItems([]), [])
})

test('守卫：焦点已经在工具栏（或标题栏）里就不动（上游 actionPerformed:15-21）', () => {
  assert.equal(shouldFocusFirstToolbarItem(true, 3), null, '已经在里面 ⇒ 什么都不做')
  assert.equal(shouldFocusFirstToolbarItem(false, 3), 0, '在外面 ⇒ 聚焦第一个')
  assert.equal(shouldFocusFirstToolbarItem(false, 0), null, '一个可聚焦条目都没有 ⇒ 不动')
  // `isFocusInsideToolbar()`（:207-212）算的是"工具栏或它所在的标题栏"。
  const toolbar = { contains: element => element === 'item' }
  const header = { contains: element => element === 'menu' }
  assert.equal(focusInsideToolbar('item', toolbar), true)
  assert.equal(focusInsideToolbar('menu', toolbar), false)
  assert.equal(focusInsideToolbar('menu', header), true, '标题栏里的（菜单）也算"在内"')
  assert.equal(focusInsideToolbar(null, toolbar), false)
})

test('回焦点：记下的还在用就回它，否则回编辑器（上游 restoreFocusToPreviousComponent:87-101）', () => {
  assert.equal(resolveToolbarRestoreTarget(true, true), 'saved')
  assert.equal(resolveToolbarRestoreTarget(true, false), 'editor', '记下的元素没了/禁用了 ⇒ 回编辑器')
  assert.equal(resolveToolbarRestoreTarget(false, false), 'editor', '从没记过 ⇒ 回编辑器')
})

test('←/→ 在条目间移动，走到头回环（上游把这两键加进遍历键）', () => {
  assert.equal(nextToolbarItemIndex(0, 3, 1), 1)
  assert.equal(nextToolbarItemIndex(2, 3, 1), 0, '最后一条再往右回环到第一条')
  assert.equal(nextToolbarItemIndex(0, 3, -1), 2, '第一条再往左回环到最后一条')
  assert.equal(nextToolbarItemIndex(0, 1, 1), null, '只有一条就没什么可移的')
  assert.equal(nextToolbarItemIndex(-1, 3, 1), null, '焦点不在条目上 ⇒ 不动')
})

// --- DOM 入口的接线（假 DOM：这几个函数直接摸 document / 元素）-----------------------------

/**
 * 最小 DOM 桩：`document.activeElement` + `querySelector('.topbar-toolbar')` + 一批假条目。
 * 条目要能通过 `instanceof HTMLButtonElement` 那类判断，所以顺手把四个构造器挂到全局
 * （Node 里本来没有）—— 这不改行为，只是让"禁用"这一档在纯 Node 下可表达。
 */
function fakeDom(items) {
  const previous = {
    document: Object.getOwnPropertyDescriptor(globalThis, 'document'),
    HTMLButtonElement: globalThis.HTMLButtonElement,
    HTMLSelectElement: globalThis.HTMLSelectElement,
    HTMLInputElement: globalThis.HTMLInputElement,
    HTMLTextAreaElement: globalThis.HTMLTextAreaElement,
  }
  class FakeButton {}
  for (const name of ['HTMLButtonElement', 'HTMLSelectElement', 'HTMLInputElement', 'HTMLTextAreaElement']) globalThis[name] = FakeButton
  const element = (id, options = {}) => {
    const node = Object.assign(new FakeButton(), {
      id, disabled: options.disabled ?? false, offsetParent: options.hidden ? null : {}, isConnected: true,
      // 条目不在任何弹层里（`toolbarItemElements` 会用 closest 排掉菜单行）。
      closest: () => null,
      focus() { document.activeElement = node },
    })
    return node
  }
  const nodes = items.map(entry => (entry.element ? entry : element(entry.id, entry)))
  const toolbar = {
    id: 'toolbar',
    querySelectorAll: () => nodes,
    closest: () => header,
    contains: child => child === toolbar,
  }
  // 真实 DOM 里条目在工具栏里、工具栏在标题栏里 —— 守卫算的是「标题栏（或工具栏）以内」。
  const header = { id: 'header', contains: child => child === header || child === toolbar || nodes.includes(child) }
  const document = {
    activeElement: null,
    querySelector: selector => (selector === '.topbar-toolbar' ? toolbar : null),
  }
  Object.defineProperty(globalThis, 'document', { configurable: true, value: document })
  return {
    document, toolbar, nodes, element,
    restore() {
      for (const [name, descriptor] of [[ 'document', previous.document ]]) {
        if (descriptor) Object.defineProperty(globalThis, name, descriptor)
        else delete globalThis[name]
      }
      for (const name of ['HTMLButtonElement', 'HTMLSelectElement', 'HTMLInputElement', 'HTMLTextAreaElement']) {
        if (previous[name]) globalThis[name] = previous[name]
        else delete globalThis[name]
      }
    },
  }
}

test('进入：从编辑器进来 ⇒ 聚焦第一个条目并记下原来那个（上游 focusFirstItem:51-61）', () => {
  const dom = fakeDom([{ id: 'a' }, { id: 'b' }])
  try {
    const editor = dom.element('editor')      // 焦点在工具栏外（编辑器）
    dom.document.activeElement = editor
    const host = { toolbar: () => dom.toolbar, focusEditor: () => true }
    focusMainToolbar(host)
    assert.equal(dom.document.activeElement, dom.nodes[0], '聚焦第一个条目')
    // 再按一次：焦点已经在工具栏里，什么都不做（上游守卫 —— 也不该改写"记下的那个"）
    focusMainToolbar(host)
    assert.equal(dom.document.activeElement, dom.nodes[0])
    // Esc 回记下的那个（编辑器）
    restoreFocusFromMainToolbar(host)
    assert.equal(dom.document.activeElement, editor, 'Esc 回到进入工具栏之前那个元素')
  } finally { dom.restore(); resetMainToolbarFocusState() }
})

test('进入：不可用/隐藏的条目不算"第一个"（上游 getFocusableAndEnabledItems）', () => {
  const dom = fakeDom([{ id: 'a', disabled: true }, { id: 'b', hidden: true }, { id: 'c' }])
  try {
    dom.document.activeElement = dom.element('editor')
    focusMainToolbar({ toolbar: () => dom.toolbar, focusEditor: () => true })
    assert.equal(dom.document.activeElement, dom.nodes[2], '被禁用和折叠起来的那两个要跳过')
  } finally { dom.restore(); resetMainToolbarFocusState() }
})

test('没有焦点主时不记（上游 `focusOwner != null` 那一半）⇒ Esc 直接回编辑器', () => {
  const dom = fakeDom([{ id: 'a' }])
  try {
    dom.document.body = dom.element('body')     // 浏览器里"没有焦点"就是 activeElement === body
    dom.document.activeElement = dom.document.body
    let editorFocused = 0
    focusMainToolbar({ toolbar: () => dom.toolbar, focusEditor: () => { editorFocused++; return true } })
    assert.equal(dom.document.activeElement, dom.nodes[0])
    restoreFocusFromMainToolbar({ toolbar: () => dom.toolbar, focusEditor: () => { editorFocused++; return true } })
    assert.equal(editorFocused, 1, 'body 不算"记下的那个" ⇒ 回编辑器')
  } finally { dom.restore(); resetMainToolbarFocusState() }
})

test('回焦点：记下的那个没了 ⇒ 回编辑器（上游 restoreFocusToPreviousComponent:87-101）', () => {
  const dom = fakeDom([{ id: 'a' }])
  try {
    const editor = dom.element('editor')
    dom.document.activeElement = editor
    let editorFocused = 0
    const host = { toolbar: () => dom.toolbar, focusEditor: () => { editorFocused++; return true } }
    focusMainToolbar(host)
    editor.isConnected = false                       // 记下的那个（编辑器标签）已经不在文档里
    restoreFocusFromMainToolbar(host)
    assert.equal(editorFocused, 1, '拿不回来就回编辑器')
  } finally { dom.restore(); resetMainToolbarFocusState() }
})

// 「回编辑器」选择器这一条是**真 exe 抓到的坑**：`.editor-stage .cm-content` 在分屏/会话恢复时
// 有多个，隐藏的那个 `focus()` 无声失败（activeElement 不动、也没有 focus 事件），
// 主工具栏按 Esc 后焦点会留在按钮上。
test('回编辑器：挑**看得见**的那个候选（隐藏的 focus() 会无声失败）', () => {
  const visible = { offsetParent: {} }
  const hidden = { offsetParent: null }
  assert.equal(pickEditorToFocus([hidden, visible]), visible, '第一个是隐藏的 ⇒ 取下一个')
  assert.equal(pickEditorToFocus([visible, hidden]), visible)
  assert.equal(pickEditorToFocus([hidden]), hidden, '都看不见时退回第一个（不假装成功）')
  assert.equal(pickEditorToFocus([]), null)
})

test('回编辑器：两条路（状态栏 / 主工具栏）都走同一个助手', () => {
  assert.match(read('src/mainToolbarFocus.ts'), /focusEditor: \(\) => focusActiveEditor\(\),/)
  assert.match(read('src/notifications.ts'), /focusActiveEditor\(\)/, '状态栏那条同款写法也要换掉（同一个坑）')
  assert.match(read('src/editorFocus.ts'), /offsetParent !== null/, '判据是"真的在显示"')
})

test('←/→：在条目间移动并回环（上游遍历键）', () => {
  const dom = fakeDom([{ id: 'a' }, { id: 'b' }, { id: 'c' }])
  try {
    const host = { toolbar: () => dom.toolbar, focusEditor: () => true }
    dom.document.activeElement = dom.nodes[0]
    moveToolbarFocus(host, 1)
    assert.equal(dom.document.activeElement, dom.nodes[1])
    moveToolbarFocus(host, -1)
    assert.equal(dom.document.activeElement, dom.nodes[0])
    moveToolbarFocus(host, -1)
    assert.equal(dom.document.activeElement, dom.nodes[2], '第一条再往左回环到最后一条')
    // 焦点不在条目上（比如在工具栏里的菜单弹出行上）⇒ 不动
    dom.document.activeElement = 'popup-row'
    moveToolbarFocus(host, 1)
    assert.equal(dom.document.activeElement, 'popup-row')
  } finally { dom.restore(); resetMainToolbarFocusState() }
})

test('接线：动作在动作索引里，工具栏处理 Esc 与 ←/→', () => {
  const menu = read('src/menuUi.ts')
  const focus = menu.indexOf("id: 'window.focusMainToolbar'")
  const status = menu.indexOf("id: 'window.focusStatusBar'")
  assert.ok(focus > 0 && status > focus, '两条都在索引里，且 FocusMainToolbar 在前（PlatformActions.xml:1364/1366）')
  assert.match(menu, /id: 'window\.focusMainToolbar', title: '聚焦主工具栏', keys: ''/, '文案随 IDE 发货的中文包')
  assert.match(menu, /run: \(\) => focusMainToolbar\(mainToolbarFocusHost\)/)
  assert.match(menu, /enabled: \(\) => Boolean\(workspace\.value\)/, '上游 update：新 UI 且有项目才可用')

  const toolbar = read('src/components/MainToolbar.vue')
  assert.match(toolbar, /<div class="topbar-toolbar" @keydown="onToolbarKeydown">/, '键盘挂在工具栏根上（上游注册在 toolbar 上）')
  assert.match(toolbar, /event\.key === 'Escape' && !event\.defaultPrevented/, '被内层吞掉的 Esc 不再回焦点')
  assert.match(toolbar, /moveToolbarFocus\(mainToolbarFocusHost, event\.key === 'ArrowRight' \? 1 : -1\)/)
})

test('上游那条"走到头落到标题栏菜单按钮"的差异留在登记里', () => {
  const todo = read('docs/source-todo.md')
  const section = todo.split('## 14.')[1] ?? ''
  assert.match(section, /标题栏菜单按钮|menu button/, '要登记为什么本仓直接回环')
  assert.match(read('src/mainToolbarFocus.ts'), /本仓没有"标题栏菜单按钮"这一档可落/, '代码里也要写清')
})
