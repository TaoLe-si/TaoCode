// B2 复核判据：状态栏组件注册表（`StatusBarWidgetsManager.findWidgetFactory`）与
// editor-based 工厂的开启闸（`StatusBarEditorBasedWidgetFactory.canBeEnabledOn`）。
//
// 这两条在 §G 里原判 `[~]`，行文本列的"缺"（另立容器对象 / 完整接口面）在本仓是**形态差异**，
// 行为面已齐；本轮把它们改判 `[x]` 后，用这份判据钉住"齐"是指哪些可数的事：
//   · 注册表 = `src/statusWidgets.ts` 的 `STATUS_WIDGETS`（含"哪些是 EP 工厂"的分档）+ 按 id 反查；
//   · editor-based 闸 = `src/statusBarWidgets.ts` 的 `widgetToggleEnabled` 与
//     `src/statusBarLifecycle.ts` 的 `canEnableOn` 说的是同一件事（有打开的编辑器）。
import test from 'node:test'
import assert from 'node:assert/strict'
import { findWidgetFactory, listWidgets, STATUS_WIDGETS, widgetChecked, widgetClickable, widgetToggleRows } from '../src/statusWidgets.ts'
import { configurableFactories, shouldCreateWidget, widgetToggleEnabled } from '../src/statusBarWidgets.ts'
import { canEnableOn } from '../src/statusBarLifecycle.ts'

test('注册表：id 唯一、按 id 反查、upstreamId 都在', () => {
  const ids = STATUS_WIDGETS.map(widget => widget.id)
  assert.equal(new Set(ids).size, ids.length, 'id 是持久化键，不能重复')
  for (const widget of STATUS_WIDGETS) {
    assert.equal(findWidgetFactory(widget.id), widget, `${widget.id} 要能按 id 反查回来`)
  }
  assert.equal(findWidgetFactory('nope'), undefined, '认不出的 id 不猜')
  const factories = STATUS_WIDGETS.filter(widget => widget.factory)
  assert.ok(factories.length >= 10, `EP 工厂那批要够厚（现在 ${factories.length}）`)
  for (const widget of factories) assert.ok(widget.upstreamId, `${widget.id} 缺 upstreamId`)
})

test('反查就是上游 findWidgetFactory(:139)：id→工厂，未知 id 无答案', () => {
  assert.equal(findWidgetFactory('position')?.displayName, '光标位置')
  assert.equal(findWidgetFactory('vfsRefresh')?.upstreamId, 'VfsRefresh')
  assert.equal(findWidgetFactory('memory')?.enabledByDefault, false, '默认关的组件也照样在注册表里')
})

test('可配置分档：configurable=false 的不进勾选清单', () => {
  const listed = listWidgets().map(widget => widget.id)
  const configurable = configurableFactories(STATUS_WIDGETS).map(widget => widget.id)
  assert.deepEqual(listed, configurable)
  assert.equal(shouldCreateWidget({ id: 'x', displayName: 'x', configurable: false, available: false }, {}), false,
    '不可配置 + 不可用 ⇒ 不建')
})

test('editor-based 的开启闸：有编辑器才可点，且与 canEnableOn 同判', () => {
  const editorBased = STATUS_WIDGETS.filter(widget => widget.editorBased).map(widget => widget.id)
  assert.ok(editorBased.includes('encoding') && editorBased.includes('lineSeparator') && editorBased.includes('readonly'))
  for (const id of editorBased) {
    assert.equal(widgetClickable(id, false), false, `${id} 没编辑器时不可点`)
    assert.equal(widgetClickable(id, true), true, `${id} 有编辑器时可点`)
  }
  assert.equal(widgetClickable('memory', false), true, '非 editor-based 与编辑器无关')
  assert.equal(widgetToggleEnabled({ id: 'encoding', displayName: 'e', editorBased: true }, false), false)
  // 生命周期侧给的是同一条判据（从状态栏绑定取权威值）。
  assert.equal(canEnableOn(null), false)
  assert.equal(canEnableOn({ windowId: 'w', editorId: null, filePath: null, editorShowing: false }), false)
  assert.equal(canEnableOn({ windowId: 'w', editorId: 'e1', filePath: 'a.ts', editorShowing: true }), true)
  assert.equal(canEnableOn({ windowId: 'w', editorId: 'e1', filePath: 'a.ts', editorShowing: false }), false, '编辑器不可见也不行')
})

test('「显示 <组件名>」那批只覆盖 EP 工厂（直接画进面板的四条不产生搜索命中）', () => {
  const rows = widgetToggleRows(true)
  const ids = rows.map(row => row.id)
  for (const direct of ['file', 'progress', 'bridge', 'problems']) {
    assert.equal(findWidgetFactory(direct)?.factory, false, `${direct} 不是工厂`)
    assert.ok(!ids.includes(`statusBar.widget.${direct}`), `${direct} 不该有搜索命中`)
  }
  for (const widget of STATUS_WIDGETS.filter(widget => widget.factory)) {
    assert.ok(ids.includes(`statusBar.widget.${widget.id}`), `${widget.id} 缺搜索命中`)
  }
  // 可点性：与右键勾选共用 widgetToggleEnabled（editor-based 无编辑器时不可点）。
  const noEditor = widgetToggleRows(false)
  assert.equal(noEditor.find(row => row.id === 'statusBar.widget.smartMode')?.enabled, false,
    '语言服务状态是 editor-based，无编辑器时不可开')
  assert.equal(rows.find(row => row.id === 'statusBar.widget.smartMode')?.enabled, true, '有编辑器就可开')
  assert.equal(noEditor.find(row => row.id === 'statusBar.widget.memory')?.enabled, true, '非 editor-based 不受影响')
  // 勾选态取持久化覆盖（这里只核默认回退：默认开的为 true）。
  assert.equal(widgetChecked('encoding'), true)
  assert.equal(widgetChecked('memory'), false, 'MemoryIndicatorWidgetFactory 默认关')
})
