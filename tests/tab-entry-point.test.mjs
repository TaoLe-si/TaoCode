// 标签条右端那个「更多」下拉的判据（IDEA `ActionPanel` + `EditorTabsEntryPoint`）。
//
// 上游：`ActionPanel.java:118-160`（`visible = p.isEnabled() && p.isVisible()`，
// 一个可见动作都没有时 `getPreferredSize()` 返回 0×0）、
// `ActionButton.java:174-189`（`setAutoHide`/`toggleShowActions` 的悬停语义）、
// `EditorTabbedContainer.kt:554-555` + `:626-632`（标签挂 `DefaultActionGroup(editorActionGroup, closeTab)`，
// `editorActionGroup` = `EditorTabsToolbarActions` + `EditorTabsEntryPoint`）、
// `PlatformActions.xml:804-816`（EntryPoint 的成员与顺序）。
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { entryPointHasActions, visibleEntryPointItems } from '../src/tabEntryPoint.ts'
import { tabEntryPointItems } from '../src/tabEntryPointMenu.ts'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const read = relative => readFileSync(join(root, relative), 'utf8')

const ctx = (over = {}) => ({
  closedCount: 0, tabCount: 0, hasUnpinned: false, split: false, canDetach: false,
  reopenClosedTab: () => {}, closeAllTabs: () => {}, closeUnpinnedTabs: () => {},
  unsplit: () => {}, unsplitAll: () => {}, changeSplitOrientation: () => {}, openTabSettings: () => {},
  openInNewWindow: () => {},
  ...over,
})

test('不可用的动作整个不画（ActionPanel.update 的 visible = enabled && visible）', () => {
  const items = [
    { id: 'a', label: 'A', enabled: true, run: () => {} },
    { id: 'b', label: 'B', enabled: false, run: () => {} },
  ]
  assert.deepEqual(visibleEntryPointItems(items).map(item => item.id), ['a'], '灰着留在原位不是这里的语义，是不出现')
})

test('一条可见动作都没有时连按钮都不该画（getPreferredSize 返回 0×0）', () => {
  assert.equal(entryPointHasActions([]), false)
  assert.equal(entryPointHasActions([{ id: 'a', label: 'A', enabled: false, run: () => {} }]), false)
  assert.equal(entryPointHasActions([{ id: 'a', label: 'A', enabled: true, run: () => {} }]), true)
})

test('成员表照上游顺序，且只列本仓真接得住的那几条', () => {
  const items = tabEntryPointItems(ctx({ closedCount: 2, tabCount: 3, hasUnpinned: true, split: true, canDetach: true }))
  assert.deepEqual(items.map(item => item.id), [
    'CloseAllEditors', 'ReopenClosedTab', 'CloseUnpinnedTabs', 'EditSourceInNewWindow', 'Unsplit', 'UnsplitAll',
    'ChangeSplitOrientation', 'ConfigureEditorTabs',
  ])
  // 上游那组里 RecentFilesFallback / RecentLocations / GotoFile 是**全局找回**，不属于"标签这一格"，
  // 本仓留在各自的键位与菜单里，不在这里重复挂一行。
  for (const id of ['RecentFilesFallback', 'RecentLocations', 'GotoFile']) {
    assert.equal(items.some(item => item.id === id), false, `${id} 不该出现在标签下拉里`)
  }
  // `EditSourceInNewWindow`（PlatformActions.xml:919）排在 KeepTabOpen 之后、Unsplit 之前。
  const ids = items.map(item => item.id)
  assert.ok(ids.indexOf('EditSourceInNewWindow') > ids.indexOf('CloseUnpinnedTabs'), '排在关闭组之后')
  assert.ok(ids.indexOf('EditSourceInNewWindow') < ids.indexOf('Unsplit'), '排在拆分组之前')
})

test('「在独立窗口中打开」：宿主能力不足时整行不画（不放假控件）', () => {
  const noCapability = tabEntryPointItems(ctx({ tabCount: 2, canDetach: false }))
  assert.equal(noCapability.find(item => item.id === 'EditSourceInNewWindow').enabled, false, '能力不足 ⇒ 不可用 ⇒ 不出现')
  const noTab = tabEntryPointItems(ctx({ tabCount: 0, canDetach: true }))
  assert.equal(noTab.find(item => item.id === 'EditSourceInNewWindow').enabled, false, '没有标签时也不可用')
  const ok = tabEntryPointItems(ctx({ tabCount: 1, canDetach: true }))
  assert.equal(ok.find(item => item.id === 'EditSourceInNewWindow').enabled, true)
})

test('每一条的可用性跟着真实状态走', () => {
  const none = tabEntryPointItems(ctx())
  const byId = Object.fromEntries(none.map(item => [item.id, item.enabled]))
  assert.equal(byId.CloseAllEditors, false, '没有标签时不能"关所有"')
  assert.equal(byId.ReopenClosedTab, false, '没有关过的标签时不能"重新打开"')
  assert.equal(byId.CloseUnpinnedTabs, false, '全是固定标签时没有可关的')
  assert.equal(byId.Unsplit, false, '没分屏时不能取消拆分')
  assert.equal(byId.ChangeSplitOrientation, false)
  assert.equal(byId.ConfigureEditorTabs, true, '配置页永远可用')
  const some = tabEntryPointItems(ctx({ closedCount: 1, tabCount: 2, hasUnpinned: true, split: true, canDetach: true }))
  assert.deepEqual(some.filter(item => item.enabled).map(item => item.id),
    ['CloseAllEditors', 'ReopenClosedTab', 'CloseUnpinnedTabs', 'EditSourceInNewWindow', 'Unsplit', 'UnsplitAll', 'ChangeSplitOrientation', 'ConfigureEditorTabs'])
})

test('点每一行都真的干活（行在却不干活 = 假控件）', () => {
  const ran = []
  const items = tabEntryPointItems(ctx({
    closedCount: 1, tabCount: 1, hasUnpinned: true, split: true, canDetach: true,
    reopenClosedTab: () => ran.push('reopen'), closeAllTabs: () => ran.push('closeAll'),
    closeUnpinnedTabs: () => ran.push('closeUnpinned'), unsplit: () => ran.push('unsplit'),
    unsplitAll: () => ran.push('unsplitAll'), changeSplitOrientation: () => ran.push('orient'),
    openTabSettings: () => ran.push('settings'), openInNewWindow: () => ran.push('detach'),
  }))
  for (const item of items) item.run()
  assert.deepEqual(ran, ['closeAll', 'reopen', 'closeUnpinned', 'detach', 'unsplit', 'unsplitAll', 'orient', 'settings'])
})

test('接线：组件读的是过滤后的行、按钮按"有没有可见动作"出现', () => {
  const vue = read('src/components/TabEntryPoint.vue')
  assert.match(vue, /const rows = computed\(\(\) => visibleEntryPointItems\(props\.items\)\)/, '没有按上游规则过滤')
  assert.match(vue, /const showButton = computed\(\(\) => entryPointHasActions\(props\.items\)\)/, '没有"一条可见都没有就不画按钮"')
  assert.match(vue, /<div v-if="showButton" class="tab-entry-point">/, '按钮没按 showButton 出现')
  assert.match(vue, /v-for="item in rows"/, '渲染的是未过滤的 items')
  // 浮层要 Teleport：标签条那层是 overflow:hidden，弹在里面会被裁掉。
  assert.match(vue, /<Teleport to="body">/, '浮层没 Teleport 出去')
})

test('装配在 explorerActions（那边已有全部动作），App.vue 只留一行组件', () => {
  const actions = read('src/explorerActions.ts')
  assert.match(actions, /const tabEntryPointItems = createTabEntryPoint\(\{/, '装配没落在动作域里')
  assert.match(actions, /reopenClosedTab, closeAllTabsIn, closeUnpinnedTabsIn,/, '动作没接上')
  const app = read('src/App.vue')
  assert.match(app, /<TabEntryPoint :items="tabEntryPointItems\(pane\)" \/>/, '标签条里没挂这个下拉')
  assert.match(app, /openRecent, tabEntryPointItems/, '没从动作域解构出来')
  // 外观不另立配方：复用浮层族的 .dropdown（那条门禁在 tests/moon-palette.test.mjs）。
  assert.match(read('src/components/TabEntryPoint.vue'), /class="dropdown tab-entry-point-menu"/, '浮层没复用 .dropdown 族')
})
