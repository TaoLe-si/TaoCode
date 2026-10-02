import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import ts from 'typescript'
import { parse, compileScript } from '@vue/compiler-sfc'
import { createRenderer, createSSRApp, defineComponent, h, nextTick, reactive } from 'vue'
import { renderToString } from '@vue/server-renderer'

const require = createRequire(import.meta.url)
const source = readFileSync(new URL('../src/components/MainToolbar.vue', import.meta.url), 'utf8')
const { descriptor } = parse(source)
const compiled = compileScript(descriptor, { id: 'main-toolbar-render', inlineTemplate: true })
const js = ts.transpileModule(compiled.content, { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText
const exports = {}
new Function('require', 'exports', js)(name => {
  if (name.endsWith('.vue')) return { default: defineComponent({ render: () => null }) }
  if (name === '../filenameWidget') return require('../src/filenameWidget.ts')
  // 工具栏的键盘判据（第三十九批加的 import）——与上面那条同一个路子。
  if (name === '../mainToolbarFocus.ts') return require('../src/mainToolbarFocus.ts')
  // 图标尺寸梯子（第八十五批）：模板里的 `:size="iconSize.<role>"` 要真模块才转得出值。
  if (name === '../uiIcons') return require('../src/uiIcons.ts')
  return require(name)
}, exports)
const MainToolbar = exports.default

function toolbarContext() {
  const calls = []
  const record = name => (...args) => calls.push([name, ...args])
  const ctx = reactive({
    workspace: { name: 'TaoCode', root: 'D:/TaoCode' },
    projectWidgetOpen: false, projectWidgetQuery: '', projectWidgetGroups: [],
    toggleProjectWidget: () => { ctx.projectWidgetOpen = !ctx.projectWidgetOpen },
    closeProjectWidget: () => { ctx.projectWidgetOpen = false },
    setProjectWidgetQuery: value => { ctx.projectWidgetQuery = value },
    pickProjectFromWidget: record('pickProjectFromWidget'), branchOfProject: () => '',
    gitHead: 'main', gitAheadBehind: { available: false, ahead: 0, behind: 0 },
    branchPopupOpen: false, gitBranches: [], openBranchPopup: record('openBranchPopup'),
    closeBranchPopup: record('closeBranchPopup'), onBranchAction: record('onBranchAction'),
    filenameShown: true, filenameLabel: 'MainToolbar.vue', filenameStatusKind: 'none',
    filenameTooltip: 'src/components/MainToolbar.vue', filenamePopup: false,
    toggleFilenamePopup: record('toggleFilenamePopup'), onFilenameMouseUp: record('onFilenameMouseUp'),
    filenameRecentRows: [], pickRecentFile: record('pickRecentFile'), recentFileKind: () => 'none',
    runConfigName: 'Toolbar test', configChooser: null, openConfigChooser: record('openConfigChooser'),
    isDesktop: true, runState: { running: false }, runWidgetTitle: '运行',
    startBuild: record('startBuild'), stopRun: record('stopRun'), runSelectedConfig: record('runSelectedConfig'),
    debugButtonTitle: '调试', dapState: { running: false }, stopAnyProcess: record('stopAnyProcess'),
    working: false, openSearchEverywhere: record('openSearchEverywhere'), openSettings: record('openSettings'),
  })
  return { ctx, calls }
}

// A minimal Vue host retains rendered props (including compiled key modifiers), without a DOM dependency.
function mountToolbar(ctx) {
  const node = (type, text = '') => ({ type, text, props: {}, children: [], parent: null })
  const detach = child => {
    if (child.parent) child.parent.children.splice(child.parent.children.indexOf(child), 1)
    child.parent = null
  }
  const renderer = createRenderer({
    createElement: type => node(type),
    createText: text => node('#text', text), createComment: text => node('#comment', text),
    setText: (target, text) => { target.text = text },
    setElementText: (target, text) => { target.text = text; target.children = [] },
    patchProp: (target, key, _previous, value) => { target.props[key] = value },
    insert(child, parent, anchor = null) {
      detach(child)
      child.parent = parent
      const index = anchor ? parent.children.indexOf(anchor) : -1
      parent.children.splice(index < 0 ? parent.children.length : index, 0, child)
    },
    remove: detach, parentNode: target => target.parent,
    nextSibling: target => target.parent?.children[target.parent.children.indexOf(target) + 1] ?? null,
  })
  const root = node('root')
  const app = renderer.createApp(MainToolbar, { ctx })
  app.mount(root)
  function find(label, target = root) {
    if (target.props['aria-label'] === label) return target
    for (const child of target.children) {
      const match = find(label, child)
      if (match) return match
    }
  }
  return { find, unmount: () => app.unmount() }
}

test('rendered toolbar places NewUiRunWidget in the right region after filename and before search', async () => {
  const { ctx } = toolbarContext()
  const html = await renderToString(createSSRApp({ render: () => h(MainToolbar, { ctx }) }))
  const filename = html.indexOf('aria-label="文件 MainToolbar.vue"')
  const right = html.indexOf('class="topbar-right"')
  const search = html.indexOf('aria-label="随处搜索"')
  assert.ok(filename >= 0 && right > filename && search > right)
  for (const label of ['选择运行配置', '构建项目', '运行', '调试', '停止']) {
    const position = html.indexOf(`aria-label="${label}"`)
    assert.ok(position > right && position < search, `${label} must render in the right region, after filename and before search`)
  }
  assert.ok(html.indexOf('aria-label="打开设置"') > search)
})

test('compiled Escape handler clears project search first, then closes the popup', async () => {
  const { ctx } = toolbarContext()
  ctx.projectWidgetOpen = true
  ctx.projectWidgetQuery = 'TaoCode'
  const toolbar = mountToolbar(ctx)
  try {
    let stopped = 0
    const keydown = key => toolbar.find('搜索项目').props.onKeydown({ key, stopPropagation: () => { stopped += 1 } })
    keydown('ArrowDown')
    assert.equal(ctx.projectWidgetQuery, 'TaoCode')
    assert.equal(stopped, 0, 'other keys are not intercepted')
    keydown('Escape')
    await nextTick()
    assert.equal(ctx.projectWidgetQuery, '')
    assert.equal(ctx.projectWidgetOpen, true)
    assert.equal(toolbar.find('搜索项目').props.value, '')
    assert.equal(stopped, 1, 'Escape does not bubble to the surrounding shell')
    keydown('Escape')
    await nextTick()
    assert.equal(ctx.projectWidgetOpen, false)
    assert.equal(toolbar.find('搜索项目'), undefined)
    assert.equal(stopped, 2)
  } finally { toolbar.unmount() }
})

test('rendered run controls retain their real context handlers and running-state behavior', async () => {
  const { ctx, calls } = toolbarContext()
  const toolbar = mountToolbar(ctx)
  try {
    for (const label of ['选择运行配置', '构建项目', '运行', '调试']) toolbar.find(label).props.onClick()
    assert.deepEqual(calls, [
      ['openConfigChooser', false], ['startBuild', false], ['runSelectedConfig', false], ['runSelectedConfig', true],
    ])
    assert.equal(toolbar.find('停止').props.disabled, true)
    ctx.runState.running = true
    ctx.dapState.running = true
    await nextTick()
    assert.equal(toolbar.find('构建项目').props.disabled, true)
    assert.equal(toolbar.find('调试').props.disabled, true)
    assert.equal(toolbar.find('停止').props.disabled, false)
    toolbar.find('运行').props.onClick()
    toolbar.find('停止').props.onClick()
    assert.deepEqual(calls.slice(-2), [['stopRun'], ['stopAnyProcess']])
  } finally { toolbar.unmount() }
})
