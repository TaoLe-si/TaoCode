import test from 'node:test'
import assert from 'node:assert/strict'
import { createSSRApp, h } from 'vue'
import { renderToString } from '@vue/server-renderer'
import { loadSfc } from './vue-sfc-loader.mjs'

// 上游 PlatformActions.xml:839-853（MainToolbarNewUI）：
//   Left = main.toolbar.Project + MainToolbarGeneralActionsGroup
//   Center = main.toolbar.Filename
//   Right = SearchEverywhere + SettingsEntryPoint
// ExecutionActions.xml:117-118 / :133-134：NewUiRunWidget 与 ExecutionTargetsToolbarGroup
// 都 add-to-group MainToolbarRight（run widget anchor="first"）。
// git4idea 把分支 widget 挂到 MainToolbarLeft。
// 所以渲染顺序必须是：项目 → 分支 → 文件名 → 运行 → 搜索 → 设置。
const { component } = loadSfc(new URL('../src/components/MainToolbar.vue', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'))

function ctx(overrides = {}) {
  return {
    workspace: { name: 'taocode', root: 'D:/taocode' },
    projectWidgetOpen: false, projectWidgetQuery: '', projectWidgetGroups: [],
    toggleProjectWidget: () => {}, closeProjectWidget: () => {}, setProjectWidgetQuery: () => {}, pickProjectFromWidget: () => {}, branchOfProject: () => '',
    gitHead: 'main', gitAheadBehind: { available: false, ahead: 0, behind: 0 }, branchPopupOpen: false,
    gitBranches: [], openBranchPopup: () => {}, closeBranchPopup: () => {}, onBranchAction: () => {},
    filenameShown: true, filenameLabel: 'Main.java', filenameStatusKind: 'none', filenameTooltip: 'Main.java',
    filenamePopup: false, toggleFilenamePopup: () => {}, onFilenameMouseUp: () => {},
    filenameRecentRows: [], pickRecentFile: () => {}, recentFileKind: () => 'none',
    runConfigName: 'Main', configChooser: null, openConfigChooser: () => {}, isDesktop: true,
    runState: { running: false }, runWidgetTitle: '运行 Main', startBuild: () => {}, stopRun: () => {},
    runSelectedConfig: () => {}, debugButtonTitle: '调试 Main', dapState: { running: false }, stopAnyProcess: () => {},
    working: false, openSearchEverywhere: () => {}, openSettings: () => {}, ...overrides,
  }
}

async function order() {
  const html = await renderToString(createSSRApp({ render: () => h(component, { ctx: ctx() }) }))
  const at = label => { const i = html.indexOf(`aria-label="${label}"`); assert.ok(i >= 0, `工具栏缺少「${label}」`); return i }
  return {
    project: at('项目 taocode'), branch: at('Git 分支'), filename: at('文件 Main.java'),
    run: at('运行'), search: at('随处搜索'), settings: at('打开设置'),
  }
}

test('the run widget sits in the right region, after the filename widget', async () => {
  const places = await order()
  assert.ok(places.run > places.filename, '运行 widget 必须在文件名 widget 之后（上游 MainToolbarRight）')
  assert.ok(places.run < places.search, '运行 widget 必须在 SearchEverywhere 之前（anchor="first"）')
})

test('the branch widget stays in the left region, before the filename', async () => {
  const places = await order()
  assert.ok(places.branch < places.filename, '分支 widget 属于 MainToolbarLeft')
  assert.ok(places.project < places.branch, '项目 widget 是 MainToolbarLeft 的第一项')
})

test('the run widget is rendered by the real handlers, not a stub', async () => {
  const html = await renderToString(createSSRApp({ render: () => h(component, { ctx: ctx() }) }))
  for (const label of ['选择运行配置', '构建项目', '运行', '调试', '停止'])
    assert.ok(html.includes(`aria-label="${label}"`), `运行 widget 缺少「${label}」按钮`)
  assert.ok(html.includes('Main'), '配置选择器必须显示当前配置名')
})
