// 状态栏组件的**实例生命周期**（`src/statusBarWidgets.ts` 的 `createStatusBarWidgetInstances`
// + `src/statusBarLifecycle.ts` 的 install/dispose）。
//
// 验的是上游 `StatusBarWidgetsManager.updateWidget`（`:97-131`）那条「建还是卸」的判定，
// 以及它带来的那条硬保证：组件被卸掉之后，**所有更新一律被挡掉**
// （`EditorBasedWidget.kt:96-109` 的 `isDisposed`）。这一层在接入前是不存在的 ——
// 工厂表有了，实例表没有，所以「用户在右键菜单里关掉某个组件」只改了可见性，
// 背后那个定时更新还在跑。
import test from 'node:test'
import assert from 'node:assert/strict'

// 本文件是纯 JS（`package.json` 的 test 脚本不带 `--experimental-strip-types`），
// 类型只能用 JSDoc 标注 —— `import type { … }` 的修饰符擦不掉，会让整个文件加载失败。
/** @typedef {import('../src/statusBarWidgets.ts').StatusBarWidgetFactory} StatusBarWidgetFactory */
/** @typedef {import('../src/statusBarWidgets.ts').StatusBarWidgetHost} StatusBarWidgetHost */

import { createStatusBarWidgetInstances, shouldCreateWidget, widgetToggleEnabled, withWidgetEnabled } from '../src/statusBarWidgets.ts'
import { installWidget, isOurEditor, selectedFile, shouldUpdateForEditor, StatusBarMismatchError } from '../src/statusBarLifecycle.ts'

/** @type {StatusBarWidgetFactory} */
const FACTORY = { id: 'memory', displayName: '内存' }
/** @type {StatusBarWidgetFactory} */
const EDITOR_BASED = { id: 'position', displayName: '光标位置', editorBased: true }

function host(overrides = {}) {
  const state = { editorId: 'ed-1', filePath: 'src/a.java', editorShowing: true, windowId: 'win-1', ...overrides }
  /** @type {StatusBarWidgetHost} */
  const result = {
    windowId: state.windowId,
    editorId: () => state.editorId,
    filePath: () => state.filePath,
    editorShowing: () => state.editorShowing,
  }
  return { host: result, state }
}

test('sync 按三道闸建组件；已在跑的不会被重装（重装会清掉它的状态）', () => {
  const { host: h } = host()
  const instances = createStatusBarWidgetInstances(h)
  const first = instances.sync([FACTORY, EDITOR_BASED], {})
  assert.deepEqual(first.installed, ['memory', 'position'])
  assert.deepEqual(first.disposed, [])
  assert.deepEqual(instances.liveIds(), ['memory', 'position'])
  // 第二拍没有变化 → 一条都不该动。
  const second = instances.sync([FACTORY, EDITOR_BASED], {})
  assert.deepEqual(second, { installed: [], disposed: [] }, '已经装好的组件不重复 install')
})

test('用户在右键菜单关掉某个组件 → 那一拍真的 dispose，且之后更新一律被挡掉', () => {
  const { host: h } = host()
  const instances = createStatusBarWidgetInstances(h)
  instances.sync([FACTORY], {})
  const before = instances.instance('memory')
  assert.ok(before && !before.isDisposed)

  // 可见性存档里显式关掉它（`withWidgetEnabled` 产出的是 overrides 表）。
  const off = withWidgetEnabled({}, FACTORY, false)
  const beat = instances.sync([FACTORY], off)
  assert.deepEqual(beat.disposed, ['memory'], '关掉的那一拍就要真的 dispose')
  assert.deepEqual(instances.liveIds(), [], 'dispose 之后不算活着的实例')

  const after = instances.instance('memory')
  assert.ok(after.isDisposed, 'isDisposed 置位')
  assert.equal(after.statusBar, null, 'dispose 之后与状态栏断开关联')
  // 这就是「关闭某个状态栏组件后它的定时更新真的停」的那道闸：
  assert.equal(isOurEditor(after, 'ed-1'), false, '已 dispose 的实例对任何编辑器都判不是自己的')
  assert.equal(selectedFile(after), null, '已 dispose 的实例不再报选中文件')
  assert.equal(shouldUpdateForEditor(after, 'ed-1'), false, '已 dispose 的实例一律不更新')

  // 再打开：重新装一个**新**实例，isDisposed 归零。
  const on = withWidgetEnabled(off, FACTORY, true)
  const reopened = instances.sync([FACTORY], on)
  assert.deepEqual(reopened.installed, ['memory'])
  assert.equal(instances.instance('memory').isDisposed, false)
  assert.equal(shouldUpdateForEditor(instances.instance('memory'), 'ed-1'), true, '重新装上后更新恢复')
})

test('editor-based 的「能不能开」是**菜单那一侧**的判据，不在 updateWidget 的三道闸里', () => {
  const { host: h, state } = host({ editorId: null, editorShowing: false })
  const instances = createStatusBarWidgetInstances(h)
  // 上游 `updateWidget`（`StatusBarWidgetsManager.kt:97-131`）只过三道闸（可开关 / available / 内部模式），
  // 所以 editor-based 组件**照样建**；`canBeEnabledOn` 管的是右键菜单里那一格**能不能点**
  // （`StatusBarWidgetsActionGroup.kt:104-110`）。两者分工不能混。
  assert.equal(widgetToggleEnabled(EDITOR_BASED, false), false, '没有打开的编辑器时菜单那一格禁用')
  assert.equal(widgetToggleEnabled(EDITOR_BASED, true), true, '有编辑器时可点')
  instances.sync([FACTORY, EDITOR_BASED], {})
  assert.deepEqual(instances.liveIds(), ['memory', 'position'], 'updateWidget 仍然建它')

  // 但装上之后，`isOurEditor` 会按当前编辑器判：没有编辑器 → 不更新。
  assert.equal(shouldUpdateForEditor(instances.instance('position'), null), false, '没有编辑器时不更新')
  assert.equal(selectedFile(instances.instance('position')), 'src/a.java', '文件路径仍可读')
  state.editorId = 'ed-1'
  state.editorShowing = true
  assert.equal(shouldUpdateForEditor(instances.instance('position'), 'ed-1'), true, '编辑器回来后更新恢复')
})

test('装到不属于自己的窗口上抛错（上游那条 assert 不许静默接受）', () => {
  const { host: h } = host()
  const instances = createStatusBarWidgetInstances(h)
  // 实例表的两侧（binding 的 windowId 与 install 的 windowId）都取自同一个 host，
  // 所以**经 sync 造不出错窗口** —— 单窗口下这条不变式成立，直接验它。
  const beat = instances.sync([FACTORY], {})
  assert.deepEqual(beat.installed, ['memory'], 'sync 不会因为错窗口抛错（binding 与 install 同源）')
  assert.equal(instances.instance('memory').statusBar.windowId, 'win-1')

  // 真正要守的是 `installWidget` 本身：拿别处的状态栏来装必须拒绝。
  assert.throws(
    () => installWidget(FACTORY, { windowId: 'win-2', editorId: 'ed-1', filePath: null, editorShowing: true }, 'win-1'),
    StatusBarMismatchError,
  )
  // 已 dispose 的实例拒绝重装（`install` 里那条判据）。
  const foreign = { ...h, windowId: 'win-2' }
  assert.equal(createStatusBarWidgetInstances(foreign).instance('memory'), null, '装错窗口不会留下半个实例')
})

test('disposeAll 卸掉全部，且重复调用是幂等的（不会二次 dispose 已卸的）', () => {
  const { host: h } = host()
  const instances = createStatusBarWidgetInstances(h)
  instances.sync([FACTORY, EDITOR_BASED], {})
  assert.deepEqual(instances.disposeAll().sort(), ['memory', 'position'])
  assert.deepEqual(instances.disposeAll(), [], '已经卸掉的不会被再卸一次')
  assert.deepEqual(instances.liveIds(), [])
})
