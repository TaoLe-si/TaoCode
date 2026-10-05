// `pf/actions` 补的两条菜单入口（上游 `PlatformActions.xml:536-546` 的 `UIToggleActions`）：
//   · `ViewStatusBar`（`ViewStatusBarAction.java`：`isSelected = UISettings.showStatusBar`）
//   · `ViewToolButtons`（显示/隐藏工具窗口条）
// 两条都用宿主已有的 `editorSettings` + `saveSettingsPatch`，所以入口缺的是菜单行本身。
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { createViewMenuRows } from '../src/menus/viewMenu.ts'
import { defaultEditorSettings } from '../src/settingsModel.ts'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const read = relative => readFileSync(join(root, relative), 'utf8')

function makeContext() {
  const saved = []
  const ref = value => ({ value })
  const ctx = {
    workspace: ref({ root: 'D:/proj' }), editorSettings: ref({ ...defaultEditorSettings }),
    saveSettingsPatch: patch => { saved.push(patch) },
    explorer: ref(false), activity: ref(false), bottom: ref(false), splitOrientation: ref('none'),
    zenMode: ref(false), fullScreen: ref(false), distractionFreeMode: ref(false),
    active: ref(undefined), editable: ref(false), hasEditor: ref(false), theme: ref('light'), fileTreeRef: ref(null),
    showOutput: () => {}, changeTheme: () => {}, chooseBackgroundImage: () => {}, togglePowerSave: () => {},
    toggleZenMode: () => {}, unsplit: () => {}, unsplitAll: () => {}, splitTabOut: () => {}, toolWindow: () => ({}),
    toolDisabled: () => false, activateToolWindow: () => {},
    changeSplitOrientation: () => {}, toggleFullScreen: () => {}, toggleDistractionFreeMode: () => {}, isDesktop: true,
    localHistoryDialog: { id: 'vcs.localHistory.show', title: '显示本地历史', keywords: '', enabled: () => false, run: () => {} },
  }
  return { ctx, saved }
}

function findRow(rows, id) {
  for (const row of rows) {
    if (row.id === id) return row
    if (row.children) {
      const found = findRow(row.children, id)
      if (found) return found
    }
  }
  return null
}

test('ViewStatusBar：菜单里有一行，勾选态跟 showStatusBar 走，点一下取反', () => {
  const { ctx, saved } = makeContext()
  const rows = createViewMenuRows(ctx)
  const row = findRow(rows, 'view.statusBar')
  assert.ok(row, 'View 菜单里要有「状态栏」一行（PlatformActions.xml:544 的 ViewStatusBar）')
  assert.equal(row.checked(), true, '默认显示状态栏（settingsModel 的默认值 true）')
  row.run()
  assert.deepEqual(saved, [{ showStatusBar: false }], '点一下要把 showStatusBar 取反')
})

test('ViewToolButtons：勾选态跟 showToolWindowBars 走，点一下取反', () => {
  const { ctx, saved } = makeContext()
  const rows = createViewMenuRows(ctx)
  const row = findRow(rows, 'view.toolButtons')
  assert.ok(row, 'View 菜单里要有「工具窗口条」一行（ViewToolButtons）')
  assert.equal(row.checked(), true)
  row.run()
  assert.deepEqual(saved, [{ showToolWindowBars: false }])
})

test('两个设置都有真实消费者（不是死开关）', () => {
  assert.match(read('src/App.vue'), /editorSettings\.showStatusBar[\s\S]{0,80}statusbar/, 'showStatusBar 控制状态栏渲染')
  assert.match(read('src/toolWindowStripes.ts'), /showToolWindowBars|showNames/, 'showToolWindowBars 控制工具窗口条')
})
