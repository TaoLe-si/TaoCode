// 视图菜单里刚补齐的两处（`ToolWindowsGroup` 与 `EditorResetFontSizeGlobal`），
// 以及一处**故意不补**的（Global 增减字号 —— 映射差异）的守卫。
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { createViewMenuRows } from '../src/menus/viewMenu.ts'
import { defaultEditorSettings } from '../src/settingsModel.ts'
import { TOOL_MNEMONIC_ORDER, toolTitles, toolWindowOrder } from '../src/toolWindowMeta.ts'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const read = relative => readFileSync(join(root, relative), 'utf8')

/** 一个够用的假 ctx：只实现被测行真正会碰到的成员。 */
function makeContext() {
  const activated = []
  const saved = []
  const ref = value => ({ value })
  const ctx = {
    workspace: ref({ root: 'D:/proj' }), editorSettings: ref({ ...defaultEditorSettings }),
    saveSettingsPatch: patch => { saved.push(patch) }, activateToolWindow: id => { activated.push(id) },
    explorer: ref(false), activity: ref(false), bottom: ref(false), splitOrientation: ref('none'),
    zenMode: ref(false), fullScreen: ref(false), distractionFreeMode: ref(false),
    active: ref(undefined), editable: ref(false), hasEditor: ref(false), theme: ref('light'), fileTreeRef: ref(null),
    showOutput: () => {}, changeTheme: () => {}, chooseBackgroundImage: () => {}, togglePowerSave: () => {},
    toggleZenMode: () => {}, unsplit: () => {}, unsplitAll: () => {}, splitTabOut: () => {}, toolWindow: () => ({}),
    // 默认所有工具窗口都可用；单独测不可用那一档时由调用方覆盖。
    toolDisabled: () => false,
    changeSplitOrientation: () => {}, toggleFullScreen: () => {}, toggleDistractionFreeMode: () => {}, isDesktop: true,
    // 本地历史是 IDEA 的 ShowHistoryAction **对话框**（不占磁贴），行由宿主注入。
    localHistoryDialog: { id: 'vcs.localHistory.show', title: '显示本地历史', keywords: '', enabled: () => false, run: () => {} },
  }
  return { ctx, activated, saved }
}

test('View 菜单第一项是「工具窗口」（ToolWindowsGroup，PlatformActions.xml:522）', () => {
  const { ctx, activated } = makeContext()
  const rows = createViewMenuRows(ctx)
  const group = rows[0]
  assert.equal(group.id, 'view.toolWindowsGroup', 'IDEA 里它是 ViewMenu 的第一个成员')
  assert.equal(group.title, '工具窗口')
  assert.ok(Array.isArray(group.children) && group.children.length === toolWindowOrder.length,
    '每个工具窗口一行，表来自 src/toolWindowMeta.ts')
  // 点一行 = 激活那个工具窗口；标题用同一张表的显示名
  const gradle = group.children.find(row => row.id === 'view.toolWindow.gradle')
  assert.ok(gradle, 'Gradle 工具窗口也要在（表里有它）')
  assert.match(gradle.title, new RegExp(toolTitles.gradle))
  gradle.run()
  assert.deepEqual(activated, ['gradle'])
  // 用户没打开项目时整组不可点（与「窗口」菜单里那批 activate-* 行同一口径）
  ctx.workspace.value = null
  assert.equal(group.children[0].enabled(), false)
})

test('重置编辑器字号：回到默认值，已在默认值时不可点', () => {
  const { ctx, saved } = makeContext()
  const rows = createViewMenuRows(ctx)
  const reset = rows.find(row => row.id === 'view.resetEditorFont')
  assert.ok(reset, 'ViewMenu 直接层的 EditorResetFontSizeGlobal（PlatformActions.xml:586）')
  assert.equal(reset.enabled(), false, '已经是默认字号时不该可点')
  ctx.editorSettings.value = { ...defaultEditorSettings, fontSize: 22 }
  assert.equal(reset.enabled(), true)
  reset.run()
  assert.deepEqual(saved, [{ fontSize: defaultEditorSettings.fontSize }])
})

test('源码顺序：重置字号在「编辑器开关」组之后（与 PlatformActions.xml 一致）', () => {
  const { ctx } = makeContext()
  const rows = createViewMenuRows(ctx)
  const index = id => rows.findIndex(row => row.id === id)
  assert.ok(index('view.editorToggleActions') >= 0 && index('view.resetEditorFont') > index('view.editorToggleActions'),
    '`:584-586` 在 EditorToggleActions 组之后')
  assert.ok(index('view.bidiTextDirection') > index('view.resetEditorFont'),
    '文本方向子菜单在重置字号之后（`:591-595`）')
})

test('增减字号**不**重复放：IDEA 的两套字号语义在本仓只有一套', () => {
  const { ctx } = makeContext()
  const rows = createViewMenuRows(ctx)
  const flatten = list => list.flatMap(row => [row, ...flatten(row.children ?? [])])
  const counts = flatten(rows).filter(row => /^(view\.(increase|decrease)EditorFont)$/.test(row.id ?? ''))
  assert.equal(counts.length, 2, `增减字号各只该有一行，实际 ${counts.map(row => row.id).join('、')}`)
  // 它们必须在「编辑器开关」组里（`EditorIncreaseFontSize`，:580-581），而不是 ViewMenu 直接层
  const toggles = rows.find(row => row.id === 'view.editorToggleActions')
  const ids = toggles.children.map(row => row.id)
  assert.ok(ids.includes('view.increaseEditorFont') && ids.includes('view.decreaseEditorFont'))
})

test('接线：宿主把 activateToolWindow 与 toolDisabled 注进了 viewMenu 的 ctx', () => {
  const app = read('src/App.vue')
  assert.match(app, /activateToolWindow, toolDisabled \}/, 'viewMenuContext 要传 activateToolWindow 与 toolDisabled')
})

test('子项顺序照 ToolWindowsGroup.getActionComparator：助记符优先，其余按 id', () => {
  const { ctx } = makeContext()
  const group = createViewMenuRows(ctx)[0]
  const ids = group.children.map(row => row.id)
  // `ToolWindowsGroup.java:78-87`：先比助记符（没有的排最后），再比 id（不区分大小写）
  const mnemonic = TOOL_MNEMONIC_ORDER.map(id => `view.toolWindow.${id}`)
  assert.deepEqual(ids.slice(0, mnemonic.length), mnemonic, '有 Alt+数字 的窗口在前，顺序就是注册顺序')
  const rest = ids.slice(mnemonic.length)
  assert.deepEqual(rest, [...rest].sort(), '没有助记符的按 id 排')
  assert.ok(rest.includes('view.toolWindow.gradle'), 'Gradle 没有助记符，排在后面')
  assert.equal(ids.length, toolWindowOrder.length, '每个工具窗口一行，不重不漏')
})

// 上游 `ActivateToolWindowAction.update`（`ActivateToolWindowAction.kt:130-137`）：不可用的工具窗口
// 在主菜单里是**灰着**（`isEnabled = available`），不是消失 —— 主菜单的 place 是 `ActionPlaces
// .MAIN_MENU`（`JMenuBasedIdeMenuBarHelper.kt:69`），而 place 会**原样传进子菜单**
// （`Utils.kt:708` 的 `ActionMenu(context, place, …)`），所以「视图 › 工具窗口」这一组走的是
// 灰着那一支，`ActionPlaces.POPUP` 的整行隐藏**不适用**于主菜单。
test('不可用的工具窗口在主菜单里是灰着（不是消失）—— ActivateToolWindowAction.kt:130-137', () => {
  const { ctx } = makeContext()
  // 让「结构」不可用（本仓它依赖语言服务就绪，见 src/toolWindowStripes.ts 的 toolDisabled）。
  ctx.toolDisabled = id => id === 'outline'
  const rows = createViewMenuRows(ctx)
  const group = rows[0]
  const outline = group.children.find(row => row.id === 'view.toolWindow.outline')
  const files = group.children.find(row => row.id === 'view.toolWindow.files')
  assert.ok(outline, '不可用的行仍然在（灰着而不是消失）')
  assert.equal(outline.enabled(), false, '不可用的行 enabled 为假 ⇒ 渲染成灰')
  assert.equal(files.enabled(), true, '可用的行照常可点')
})

test('工作区没打开时整组都不可用（原有的 workspace 门禁不能丢）', () => {
  const { ctx } = makeContext()
  ctx.workspace = { value: null }
  const group = createViewMenuRows(ctx)[0]
  for (const row of group.children) assert.equal(row.enabled(), false, `${row.id} 应不可用`)
})

// 同一个缺陷在 Window/Edit/Git/Run 菜单那份 `toolWindow` 助手里：它原先只看 `workspace`，
// 于是未就绪的工具窗口行看着可点、点下去被 `activateToolWindow` 的 `if (toolDisabled(id)) return`
// 静默吃掉（"看得见但点了没反应"）。助手的实现只有一份（App.vue 的 `toolWindow`），这里锁住它。
test('菜单里那批「激活 XX 工具窗口」也带 toolDisabled 门禁', () => {
  const app = read('src/App.vue')
  const helper = app.slice(app.indexOf('const toolWindow = (view:'), app.indexOf('const toolWindow = (view:') + 700)
  assert.match(helper, /&& !toolDisabled\(view\)/, 'toolWindow 助手的可用性要含 toolDisabled')
})
