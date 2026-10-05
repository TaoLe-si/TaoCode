import test from 'node:test'
import { readFileSync } from 'node:fs'
import { shellSource } from './shell-source.mjs'
import assert from 'node:assert/strict'
import {
  FACTORY_LAYOUT_NAME,
  INITIAL_LAYOUT_NAME,
  MAX_LAYOUT_NAME_LENGTH,
  deleteLayout,
  emptyLayoutStore,
  isFactoryLayoutActive,
  layoutNameError,
  layoutNames,
  normalizeLayoutStore,
  normalizeToolLayout,
  renameLayout,
  resolveLayout,
  saveLayout,
  setActiveLayout,
} from '../src/toolLayout.ts'

const factory = {
  explorer: true,
  bottom: false,
  view: 'files',
  tab: 'output',
  anchors: { files: 'left', git: 'right' },
  order: { left: ['files'], right: ['git'] },
  sizes: { explorer: 240, trace: 300, output: 180 },
}
const userLayout = { ...factory, view: 'git', explorer: false, sizes: { ...factory.sizes, explorer: 400 } }

// ToolWindowDefaultLayoutManager.kt:47 — the factory default is addressed by the empty name and is
// never one of the stored layouts.
test('a fresh store has the factory layout active and no named layouts', () => {
  const store = emptyLayoutStore()
  assert.deepEqual(store, { active: FACTORY_LAYOUT_NAME, layouts: {} })
  assert.equal(isFactoryLayoutActive(store), true)
  assert.deepEqual(layoutNames(store), [])
  assert.equal(resolveLayout(store, factory), factory)
})

// :117 — a blank name (or a missing active name) means the factory default, and a layout stored
// under that name is dropped instead of lingering as an addressable ghost.
test('a store parsed from corrupted storage falls back to the factory default', () => {
  assert.deepEqual(normalizeLayoutStore(null), emptyLayoutStore())
  assert.deepEqual(normalizeLayoutStore('nonsense'), emptyLayoutStore())
  assert.deepEqual(normalizeLayoutStore({ active: 'gone', layouts: { A: userLayout } }), { active: FACTORY_LAYOUT_NAME, layouts: { A: userLayout } })
  assert.deepEqual(normalizeLayoutStore({ active: 'A', layouts: { A: userLayout, '': userLayout } }), { active: 'A', layouts: { A: userLayout } })
  // An active name that no longer exists cannot be honoured.
  assert.deepEqual(normalizeLayoutStore({ active: 'missing', layouts: {} }), { active: FACTORY_LAYOUT_NAME, layouts: {} })
})

// normalizeToolLayout is field-by-field: one bad field must not throw the whole snapshot away.
test('a partly corrupted layout keeps the fields that are still readable', () => {
  const layout = normalizeToolLayout({ ...userLayout, explorer: 'yes', sizes: { explorer: -5, output: 200 }, anchors: { files: 'middle', git: 'right', search: 'left' } }, factory)
  assert.equal(layout.explorer, factory.explorer)          // "yes" is not a boolean
  assert.equal(layout.sizes.explorer, factory.sizes.explorer)  // sizes must be positive
  assert.equal(layout.sizes.output, 200)                   // the usable one is kept
  assert.equal(layout.sizes.trace, factory.sizes.trace)    // absent keys keep the fallback
  assert.deepEqual(layout.anchors, { files: 'left', git: 'right', search: 'left' })  // 'middle' falls back
  assert.equal(layout.view, 'git')
})

test('normalization preserves bottom anchors rather than replacing them with fallback sides', () => {
  const layout = normalizeToolLayout({ anchors: { files: 'bottom', git: 'bottom', tests: 'bottom' } }, factory)
  assert.deepEqual(layout.anchors, { files: 'bottom', git: 'bottom', tests: 'bottom' })
})

// :70-82 — setLayout writes the current state into the *named* layout and makes it active; saving
// over the factory default renames it to INITIAL_LAYOUT_NAME ("Custom") so the default survives.
test('saving over the factory default moves it to a named layout', () => {
  const saved = saveLayout(emptyLayoutStore(), FACTORY_LAYOUT_NAME, userLayout)
  assert.equal(saved.active, INITIAL_LAYOUT_NAME)
  assert.deepEqual(layoutNames(saved), [INITIAL_LAYOUT_NAME])
  assert.equal(isFactoryLayoutActive(saved), false)
  assert.equal(resolveLayout(saved, factory), userLayout)
  // Saving the *same* snapshot again replaces it in place instead of adding a second layout.
  const again = saveLayout(saved, INITIAL_LAYOUT_NAME, factory)
  assert.deepEqual(layoutNames(again), [INITIAL_LAYOUT_NAME])
  assert.equal(resolveLayout(again, factory), factory)
})

// StoreNamedLayoutAction.kt:22-25 — "Save Changes in Current Layout" targets the active layout,
// which is exactly what saveLayout(store, store.active, …) does.
test('saving into the active layout leaves the name alone', () => {
  let store = saveLayout(emptyLayoutStore(), 'Wide', userLayout)
  store = setActiveLayout(store, 'Wide')
  store = saveLayout(store, store.active, { ...userLayout, bottom: true })
  assert.equal(store.active, 'Wide')
  assert.equal(resolveLayout(store, factory).bottom, true)
})

// RestoreFactoryDefaultLayoutAction.kt:29-35 — switching the active name to the factory default
// is not a deletion: the custom layouts stay in the list.
test('switching to the factory default keeps every stored layout', () => {
  const store = saveLayout(saveLayout(emptyLayoutStore(), 'Wide', userLayout), 'Narrow', factory)
  const backToFactory = setActiveLayout(store, FACTORY_LAYOUT_NAME)
  assert.equal(isFactoryLayoutActive(backToFactory), true)
  assert.equal(resolveLayout(backToFactory, factory), factory)
  assert.deepEqual(layoutNames(backToFactory), ['Wide', 'Narrow'])
  // An unknown name is ignored rather than leaving a dangling active layout.
  assert.equal(setActiveLayout(store, 'missing'), store)
})

test('renaming moves the snapshot and follows it when it was the active layout', () => {
  const store = saveLayout(emptyLayoutStore(), 'Wide', userLayout)
  const renamed = renameLayout(store, 'Wide', 'Very Wide')
  assert.deepEqual(layoutNames(renamed), ['Very Wide'])
  assert.equal(renamed.active, 'Very Wide')
  assert.equal(resolveLayout(renamed, factory), userLayout)
  // Blank, unknown and unchanged names are no-ops.
  assert.equal(renameLayout(store, 'Wide', '  '), store)
  assert.equal(renameLayout(store, 'nope', 'X'), store)
  assert.equal(renameLayout(store, 'Wide', 'Wide'), store)
})

// DeleteNamedLayoutAction: deleting the active layout is refused (its update() disables the action
// in exactly that case), so the store can never point at a layout that no longer exists.
test('deleting a layout never leaves the active name dangling', () => {
  const store = setActiveLayout(saveLayout(saveLayout(emptyLayoutStore(), 'Wide', userLayout), 'Narrow', factory), 'Wide')
  assert.equal(deleteLayout(store, 'Wide'), store)              // active -> refused
  const removed = deleteLayout(store, 'Narrow')
  assert.deepEqual(layoutNames(removed), ['Wide'])
  assert.equal(removed.active, 'Wide')
  assert.equal(deleteLayout(store, 'nothing'), store)
  // Deleting from the factory layout is fine — the factory default is not a stored entry.
  const factoryActive = deleteLayout(setActiveLayout(saveLayout(emptyLayoutStore(), 'Wide', userLayout), FACTORY_LAYOUT_NAME), 'Wide')
  assert.deepEqual(layoutNames(factoryActive), [])
  assert.equal(isFactoryLayoutActive(factoryActive), true)
})

// LayoutNameInputDialog.kt:84-118 — blank disables OK (no message), too long complains while
// typing, and an existing name complains when OK is pressed.
test('the layout name validator mirrors the dialog', () => {
  assert.equal(layoutNameError('', ['Wide']), null)
  assert.equal(layoutNameError('   ', ['Wide']), null)
  assert.equal(layoutNameError('Wide', ['Wide']), '同名布局已存在。')
  assert.equal(layoutNameError('Narrow', ['Wide']), null)
  assert.equal(layoutNameError('x'.repeat(MAX_LAYOUT_NAME_LENGTH), []), null)
  assert.equal(layoutNameError('x'.repeat(MAX_LAYOUT_NAME_LENGTH + 1), []), `名称最多 ${MAX_LAYOUT_NAME_LENGTH} 个字符。`)
  // The length limit comes from registry.properties:2198 and is 50.
  assert.equal(MAX_LAYOUT_NAME_LENGTH, 50)
})

// The wiring, checked against App.vue. Shift+F12 has to be handled before the handler's
// "needs Ctrl or Alt" bail-out, which a Shift-only chord also fails.
test('Shift+F12 restores the layout and the Window menu offers the whole group', () => {
  // Shift+F12 的绑定与菜单组的组装都在 2026-09-27 离开了 App.vue（src/keymap.ts / src/menuUi.ts），
  // 所以这条「接线」用例读整个外壳；三段代码的相对顺序保持不变。
  const app = shellSource()
  const lines = app.split('\n')
  const find = (...checks) => lines.findIndex(line => checks.every(check => line.includes(check)))

  const restore = find("event.key === 'F12'", 'event.shiftKey', 'restoreCurrentToolLayout()')
  assert.ok(restore >= 0, 'Shift+F12 does not restore the layout')
  const bail = lines.findIndex(line => line.includes('if (!(event.ctrlKey || event.metaKey) && !event.altKey) return'))
  assert.ok(bail >= 0 && restore < bail, 'Shift+F12 sits below the modifier bail-out and can never fire')
  // Bare F12 must still exclude Shift (`$default.xml:846-848`), or the two chords collide.
  const bare = find("!event.shiftKey && !event.metaKey && workspace.value", 'jumpToLastToolWindow()')
  assert.ok(bare >= 0, 'the bare-F12 branch no longer excludes Shift')

  for (const id of ['window.factoryLayout', 'window.restoreLayout', 'window.storeLayout', 'window.storeLayoutAs', 'window.renameLayout', 'window.deleteLayout'])
    assert.ok(app.includes(`id: '${id}'`), `the Window menu has no ${id} row`)
  // RestoreDefaultLayout keeps its keymap shortcut in the row, like every other row.
  const row = lines.find(line => line.includes("id: 'window.restoreLayout'"))
  assert.ok(row.includes("keys: 'Shift F12'"), 'the 恢复当前布局 row shows the wrong shortcut')
  // The layout list is dynamic, so the group is assembled into the Window menu at render time.
  // 菜单组的组装在 2026-09-27 从 App.vue 拆到 src/menuUi.ts（`allMenuGroups`），所以这条
  // 「行为存在」的断言改用 shellSource()（App.vue + 各拆分模块）而不是只读 App.vue。
  //
  // 钉的是**位置不变量**而不是某一行写法：布局组必须在窗口菜单最顶部
  // （`PlatformActions.xml:637-651`，前面那三条 Minimize/Zoom/MoveWindow 是 macOS 动作，本仓没有）。
  // 原先这里钉的是 `windowRows.splice(afterSearch, 0, ...)` —— 而 `afterSearch` 来自一个全仓不存在的
  // id（`window.searchEverywhere`），findIndex 得 −1、`+1` 变 0 才"碰巧"插对位置；实现换写法就误报。
  assert.match(shellSource(), /\[\.\.\.layoutMenuRows\.value, \.\.\.windowMenuRows\]/,
    'the layout group is not at the top of the Window menu')
})

// A snapshot is only worth restoring if it covers what the layout actually is, and only worth
// storing if restoring writes those same places back.
test('a snapshot covers every piece of the layout and is written back in full', () => {
  // 快照的读写（captureToolLayout / applyToolLayout）在 2026-09-27 搬到 src/toolLayouts.ts，
  // 所以这条用例读整个外壳。
  const app = shellSource()
  const capture = app.slice(app.indexOf('function captureToolLayout'), app.indexOf('function applyToolLayout'))
  const apply = app.slice(app.indexOf('function applyToolLayout'), app.indexOf('function applyNamedToolLayout'))
  for (const field of ['explorer', 'bottom', 'view', 'tab', 'anchors', 'order', 'sizes'])
    assert.ok(capture.includes(`${field}:`), `the snapshot does not capture ${field}`)
  // `hidden`/`uiTypes` 在返回字面量里是简写属性（`hidden,`），所以按"作为键出现"匹配。
  for (const field of ['hidden', 'uiTypes'])
    assert.ok(new RegExp(`\\b${field},`).test(capture), `the snapshot does not capture ${field}`)
  // Restoring reuses the existing setters so a stored value is clamped and persisted like a drag.
  assert.ok(apply.includes('setPanelSize(panel, size)'), 'a restored panel size bypasses the clamp')
  assert.ok(apply.includes('saveToolOrder()'), 'a restored stripe order is not persisted')
  assert.ok(apply.includes('isLeftToolWindowId(layout.view)'), 'a restored view id is not validated')
  // 每窗口状态（摘掉的侧条按钮 / 标签形态）也必须写回 —— 上游 setLayout 换的是整份 WindowInfo。
  assert.ok(apply.includes('applyStripeButtons(layout.hidden)'), 'removed stripe buttons are not restored')
  assert.ok(apply.includes('applyContentUiTypes(layout.uiTypes)'), 'explicit content-ui types are not restored')
})
