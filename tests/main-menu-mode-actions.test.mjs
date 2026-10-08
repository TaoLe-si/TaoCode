// `View › Appearance › UIToggleActions`（`PlatformActions.xml:536-547`）里
// `ChangeMainMenuModeActionGroup` 那一组在本仓的判据（2026-10-08 lane pf-actions）。
//
// 上游：`platform/platform-impl/src/com/intellij/ide/actions/ChangeMainMenuModeActionGroup.kt`
//   · `:32-33` `MainMenuDisplayMode.entries.map { ChangeMainMenuModeAction(it) }` ⇒ 一档一行，
//     顺序 = 枚举声明顺序（`MainMenuDisplayMode.kt:14-16`：UNDER_HAMBURGER_BUTTON /
//     MERGED_WITH_MAIN_TOOLBAR / SEPARATE_TOOLBAR）；
//   · `:57-58` `isSelected` 比当前档；`:60-61` `setSelected` 里 `if (!state) return` ⇒ 点已选中的
//     那一项什么都不做（单选语义）；
//   · `:38-40` 可见性 = 新 UI 且非 macOS。`ViewMainMenuAction.java:33-38` 恰好相反（`!isNewUI()`）⇒
//     **新 UI 下 `ViewMainMenu` 整个动作不适用**，本仓不生成那一行（如实不渲染，不是漏抄）。
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { createViewMenuRows } from '../src/menus/viewMenu.ts'
import { defaultEditorSettings } from '../src/settingsModel.ts'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const read = relative => readFileSync(join(root, relative), 'utf8')
const REF = 'D:/Backup/Downloads/intellij-community-master/intellij-community-master'

function makeContext(mode = 'hamburger') {
  const saved = []
  const ref = value => ({ value })
  const ctx = {
    workspace: ref({ root: 'D:/proj' }), editorSettings: ref({ ...defaultEditorSettings, mainMenuDisplayMode: mode }),
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

const MODES = ['hamburger', 'merged', 'separate']

/** 行标题必须等于设置页那三个 `<option>` 的中文取值（同一份上游 `CoreBundle.properties:157-159`）。 */
function settingsPageLabels() {
  const text = read('src/components/SettingsAppearanceSection.vue')
  const labels = {}
  for (const mode of MODES) {
    const match = new RegExp(`<option value="${mode}">([^<]+)</option>`).exec(text)
    labels[mode] = match ? match[1] : null
  }
  return labels
}

test('三档各一行：标题/顺序/文案与设置页同源，勾选态跟当前档走', () => {
  const { ctx } = makeContext('merged')
  const rows = createViewMenuRows(ctx)
  const labels = settingsPageLabels()
  for (const mode of MODES) {
    const row = findRow(rows, `view.mainMenuMode.${mode}`)
    assert.ok(row, `View 菜单里要有 \`view.mainMenuMode.${mode}\` 一行（ChangeMainMenuModeActionGroup.kt:32-33）`)
    assert.equal(row.title, labels[mode], `\`${mode}\` 的文案要与设置页同一个上游取值（CoreBundle.properties:157-159）`)
    assert.equal(row.checked(), mode === 'merged', `勾选态 = 当前档（isSelected，:57-58），当前是 merged`)
  }
  assert.equal(labels.hamburger, '隐藏在汉堡按钮下方')
  assert.equal(labels.merged, '与主工具栏合并')
  assert.equal(labels.separate, '显示在主工具栏上方')
})

test('单选语义：点已选中的那一项不写设置，点别的档才写（setSelected 的 `if (!state) return`）', () => {
  const { ctx, saved } = makeContext('merged')
  const rows = createViewMenuRows(ctx)
  findRow(rows, 'view.mainMenuMode.merged').run()
  assert.deepEqual(saved, [], '点当前档不许重复 saveSettingsPatch（上游 :60-61 直接 return）')
  findRow(rows, 'view.mainMenuMode.separate').run()
  assert.deepEqual(saved, [{ mainMenuDisplayMode: 'separate' }], '点另一档要写进设置')
})

test('三档不是死开关：设置真有消费者（写根节点属性 + CSS 分档 + 顶栏图标）', () => {
  const appearance = read('src/appearanceActions.ts')
  assert.match(appearance, /dataset\.mainMenu\s*=\s*mode/, 'appearanceActions 要把档位写成 html[data-main-menu]')
  const css = read('src/style.css')
  for (const mode of MODES) assert.ok(css.includes(`html[data-main-menu='${mode}']`), `style.css 要有 ${mode} 档的样式分支`)
  assert.match(read('src/App.vue'), /mainMenuDisplayMode === 'merged'/, '顶栏那枚按钮按 merged 档换图标')
})

test('ViewMainMenu 不生成：新 UI 下上游自己把它藏了（ViewMainMenuAction.java:33-38 的 `!isNewUI()`）', () => {
  const { ctx } = makeContext()
  const rows = createViewMenuRows(ctx)
  assert.equal(findRow(rows, 'view.mainMenu'), null, '本仓是新 UI ⇒ 上游那一行不可见，不生成也不假渲染')
})

test('macOS 档：整组不出现（ChangeMainMenuModeActionGroup.kt:38-40 的 `!SystemInfo.isMac`）', () => {
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, 'navigator')
  Object.defineProperty(globalThis, 'navigator', { value: { platform: 'MacIntel', userAgent: '' }, configurable: true })
  try {
    const { ctx } = makeContext()
    const rows = createViewMenuRows(ctx)
    for (const mode of MODES) {
      assert.equal(findRow(rows, `view.mainMenuMode.${mode}`), null, `macOS 下 ${mode} 那一行不该出现`)
    }
  } finally {
    if (descriptor) Object.defineProperty(globalThis, 'navigator', descriptor)
    else delete globalThis.navigator
  }
})

test('上游出处行真实存在（参考树在时核；不在则跳过）', () => {
  const xml = `${REF}/platform/platform-impl/resources/idea/PlatformActions.xml`
  const group = `${REF}/platform/platform-impl/src/com/intellij/ide/actions/ChangeMainMenuModeActionGroup.kt`
  const viewMainMenu = `${REF}/platform/platform-impl/src/com/intellij/ide/actions/ViewMainMenuAction.java`
  const enumFile = `${REF}/platform/editor-ui-api/src/com/intellij/ide/ui/MainMenuDisplayMode.kt`
  if (!existsSync(xml) || !existsSync(group) || !existsSync(viewMainMenu) || !existsSync(enumFile)) return
  const xmlText = readFileSync(xml, 'utf8')
  assert.ok(/<group id="UIToggleActions">[\s\S]*?<reference ref="ChangeMainMenuModeActionGroup"\/>/.test(xmlText),
    'UIToggleActions 里要引着 ChangeMainMenuModeActionGroup（PlatformActions.xml:541）')
  const groupText = readFileSync(group, 'utf8')
  assert.ok(groupText.includes('MainMenuDisplayMode.entries.map'), '子项 = 枚举每一项（:32-33）')
  assert.ok(/if \(!state\) return/.test(groupText), 'setSelected 的单选语义（:60-61）不在了')
  assert.ok(groupText.includes('!SystemInfo.isMac'), '非 macOS 的可见性门（:38-40）不在了')
  assert.ok(readFileSync(viewMainMenu, 'utf8').includes('!ExperimentalUI.isNewUI()'), 'ViewMainMenu 的新 UI 反向门不在了')
  assert.ok(readFileSync(enumFile, 'utf8').includes('UNDER_HAMBURGER_BUTTON'), '枚举档名变了')
})
