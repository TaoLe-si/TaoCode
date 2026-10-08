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
import { presentationAssistantEnabled } from '../src/presentationAssistant.ts'

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
  // 2026-10-08 订正：原断言写的 `src/toolWindowStripes.ts` 里 `showToolWindowBars|showNames` ——
  // 那个文件里**没有** `showToolWindowBars`（命中的是另一个设置 `showToolWindowNames`），
  // 所以那条判据永远绿。按判决书 2026-10-06 的实况改成真正的消费者：`appearanceActions` 写
  // `html[data-tool-stripes]`、`style.css` 那道样式闸。
  assert.match(read('src/appearanceActions.ts'), /showToolWindowBars[\s\S]{0,200}dataset\.toolStripes/,
    'showToolWindowBars 的消费者是 appearanceActions（写 data-tool-stripes）')
  assert.ok(read('src/style.css').includes("html[data-tool-stripes='off']"), 'style.css 要有条纹关闭的样式闸')
  assert.ok(!read('src/toolWindowStripes.ts').includes('showToolWindowBars'),
    'toolWindowStripes.ts 管的是条纹注册表/可见集合，不是这个设置键（订正后的实况）')
})

test('TogglePresentationAssistantAction：UIToggleActions 的第一项也有一行，同一个开关本体', () => {
  const { ctx } = makeContext()
  const rows = createViewMenuRows(ctx)
  const row = findRow(rows, 'view.presentationAssistant')
  assert.ok(row, 'View › 外观 里要有演示助手一行（PlatformActions.xml:538）')
  const before = presentationAssistantEnabled()
  assert.equal(row.checked(), before, '勾选态 = 模块里的活状态，不是菜单另存一份')
  row.run()
  assert.equal(row.checked(), !before, '点一下要真的翻转模块状态')
  assert.equal(presentationAssistantEnabled(), !before)
  row.run()
  assert.equal(row.checked(), before, '再点一下翻回来（幂等一轮，测试不留副作用）')
})
