// 状态栏的两层（B2 §C）：**组件实例生命周期**（`EditorBasedWidget`）与
// **可搜索的显隐动作**（`StatusBarWidgetsOptionProvider`）。
//
// 上游把这两件事分在两个地方：
//   · `EditorBasedWidget.kt:68-109`：组件实例的 `install` / `dispose` / `isDisposed` /
//     `isOurEditor` / `getSelectedFile`；
//   · `StatusBarWidgetsOptionProvider.kt:13-41`：一个 `SearchTopHitProvider`，把每个
//     `canBeEnabledOnStatusBar` 为真的工厂折成「显示 {0}」（`IdeBundle.properties:2402`）
//     的**搜索命中** —— 于是"查找操作"里搜组件名就能开关它，与右键勾选共用一份状态。
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import {
  StatusBarMismatchError, canEnableOn, disposeWidget, installWidget, isOurEditor, selectedFile, shouldUpdateForEditor,
} from '../src/statusBarLifecycle.ts'
import { SHOW_WIDGET_LABEL, widgetToggleRows } from '../src/statusWidgets.ts'
import { widgetEnabled } from '../src/statusBarWidgets.ts'

const read = rel => readFileSync(new URL(`../${rel}`, import.meta.url), 'utf8')
const factory = { id: 'position', displayName: '光标位置', editorBased: true }
const bar = { windowId: 'w1', editorId: 'e1', filePath: 'src/A.java', editorShowing: true }

// —— 实例生命周期 ——

test('installing binds the widget to a status bar', () => {
  const widget = installWidget(factory, bar, 'w1')
  assert.equal(widget.isDisposed, false)
  assert.equal(widget.statusBar, bar)
})

// 上游 `install` 里的断言（`:97-99`）：不许把某个窗口的组件装到另一个窗口的状态栏上。
test('installing onto another window throws instead of silently accepting', () => {
  assert.throws(() => installWidget(factory, bar, 'other'), StatusBarMismatchError)
})

// `dispose()`（`:104-108`）：置位 + 断开关联。
test('disposing marks the instance and drops the status bar', () => {
  const widget = disposeWidget(installWidget(factory, bar, 'w1'))
  assert.equal(widget.isDisposed, true)
  assert.equal(widget.statusBar, null)
})

// `isOurEditor`（`:57-64`）：非空 + 可见 + 属于本状态栏。
test('isOurEditor needs a visible editor that belongs to this bar', () => {
  const widget = installWidget(factory, bar, 'w1')
  assert.equal(isOurEditor(widget, 'e1'), true)
  assert.equal(isOurEditor(widget, 'other'), false, '别的编辑器不算')
  assert.equal(isOurEditor(widget, null), false, '没有编辑器不算')
  assert.equal(isOurEditor(widget, 'e1', { ...bar, editorShowing: false }), false, '不可见不算（UIUtil.isShowing）')
})

// 卸载之后一切判据都要关门 —— 这正是"更新跑在已 dispose 的组件上"那个真机缺陷的防线。
test('a disposed widget refuses every query', () => {
  const widget = disposeWidget(installWidget(factory, bar, 'w1'))
  assert.equal(isOurEditor(widget, 'e1'), false)
  assert.equal(selectedFile(widget), null)
  assert.equal(shouldUpdateForEditor(widget, 'e1'), false)
})

test('updates are gated on "this is my editor and I am alive"', () => {
  const widget = installWidget(factory, bar, 'w1')
  assert.equal(shouldUpdateForEditor(widget, 'e1'), true)
  assert.equal(shouldUpdateForEditor(widget, 'other'), false)
})

// `getSelectedFile()`（`:91-95`）。
test('the selected file comes from the bound status bar', () => {
  const widget = installWidget(factory, bar, 'w1')
  assert.equal(selectedFile(widget), 'src/A.java')
  assert.equal(selectedFile(widget, { ...bar, filePath: null }), null)
})

// `StatusBarEditorBasedWidgetFactory.canBeEnabledOn`（`:14-16`）：有文本编辑器才可开。
test('canEnableOn follows the editor-based factory rule', () => {
  assert.equal(canEnableOn(bar), true)
  assert.equal(canEnableOn({ ...bar, editorId: null }), false)
  assert.equal(canEnableOn({ ...bar, editorShowing: false }), false)
  assert.equal(canEnableOn(null), false)
})

// —— 可搜索的显隐动作 ——

test('every configurable widget gets a "show <name>" row', () => {
  const rows = widgetToggleRows(true)
  assert.ok(rows.length >= 8, `条目太少：${rows.length}`)
  for (const row of rows) {
    assert.match(row.title, new RegExp(`^${SHOW_WIDGET_LABEL} `), `标题要照 label.show.status.bar.widget：${row.title}`)
    assert.match(row.id, /^statusBar\.widget\./)
  }
  assert.ok(rows.some(row => row.title === `${SHOW_WIDGET_LABEL} 光标位置`))
})

// 不可配置的组件（上游 `FatalErrorWidgetFactory.isConfigurable = false`）不该出现在这一批里。
test('non-configurable widgets are not offered', () => {
  const ids = widgetToggleRows(true).map(row => row.id)
  // 本仓的 `file`/`progress`/`bridge`/`problems` 不是 EP 工厂，本来就不在 `configurableFactories` 的输入里。
  assert.ok(!ids.includes('statusBar.widget.file'))
  assert.ok(!ids.includes('statusBar.widget.bridge'))
})

// 可点性与右键勾选**同一条判据**（上游过滤与 `ToggleWidgetAction.update` 用的是同一个方法）。
test('the row is disabled exactly when the checkbox is', () => {
  const withEditor = widgetToggleRows(true)
  const withoutEditor = widgetToggleRows(false)
  // `Encoding` 是 `StatusBarEditorBasedWidgetFactory` 的子类（`EncodingPanelWidgetFactory.java:15`）。
  assert.equal(withEditor.find(row => row.id === 'statusBar.widget.encoding')?.enabled, true)
  assert.equal(withoutEditor.find(row => row.id === 'statusBar.widget.encoding')?.enabled, false, 'editor-based 且没有编辑器 ⇒ 不可点')
  // 非 editor-based 的两档不受影响（`Position` 与 `Notifications` 都直接实现接口）。
  for (const id of ['statusBar.widget.position', 'statusBar.widget.notices'])
    assert.equal(withoutEditor.find(row => row.id === id)?.enabled, true, `${id} 不该被编辑器影响`)
})

// 中文文案取自随 IDE 发货的语言包，不是自己译的。
test('the label comes from the shipped Chinese bundle', () => {
  assert.equal(SHOW_WIDGET_LABEL, '显示', 'IdeBundle.properties:1403 label.show.status.bar.widget')
})

// —— 接线 ——

test('the rows reach the action index that Find Action and Commands search', () => {
  const menu = read('src/menuUi.ts')
  assert.match(menu, /for \(const row of widgetToggleRows\(deps\.hasEditor\(\)\)\)/, '动作索引里要挂上这批')
  assert.match(menu, /hasEditor: \(\) => boolean/, 'deps 要有 hasEditor')
  assert.match(read('src/App.vue'), /focusStatusBar, hasEditor, recentProjects/, '宿主没把 hasEditor 传进去')
})
// —— 「文件系统同步」（`VfsRefreshIndicatorWidgetFactory`）——

// 上游 `:53-59` 的两条硬事实：显示名取 `status.bar.vfs.refresh.widget.name`（中文包 =「文件系统同步」）、
// `isEnabledByDefault() = false`（默认关，用户在勾选清单里打开）。
test('the vfs refresh widget is registered off by default', () => {
  const registry = read('src/statusWidgets.ts')
  assert.ok(registry.includes("{ id: 'vfsRefresh', displayName: '文件系统同步', factory: true, upstreamId: 'VfsRefresh', enabledByDefault: false }"),
    '显示名与默认值都要照上游')
  assert.equal(widgetEnabled({}, { id: 'vfsRefresh', displayName: '文件系统同步', enabledByDefault: false }), false, '默认不显示')
})

// 它读的那个"正在同步"标志必须是响应式的 —— 原先是个普通 let，接线时才发现驱动不了界面。
test('the syncing flag is reactive and drives the chip', () => {
  const app = read('src/App.vue')
  assert.match(app, /const syncing = ref\(false\)/, '要 ref 才能进 v-if')
  assert.match(app, /syncing: \(\) => syncing\.value, setSyncing: value => \{ syncing\.value = value \}/)
  assert.match(app, /showWidget\('vfsRefresh'\)/, '芯片要按组件开关渲染')
  assert.match(app, /class="status-vfs-idle"/, '空闲态是一个不转的图标（上游的空图标等价物）')
})
