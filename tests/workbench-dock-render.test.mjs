import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { parse as parseSfc, compileTemplate } from '@vue/compiler-sfc'
import { parse } from '@vue/compiler-dom'
import { createSSRApp, h } from 'vue'
import { renderToString } from '@vue/server-renderer'
import ts from 'typescript'
import { loadSfc } from './vue-sfc-loader.mjs'

const { component: toolStripe } = loadSfc('src/components/ToolStripe.vue')

const require = createRequire(import.meta.url)
// 模板里 `:size="iconSize.<role>"` 是 setup 绑定；片段渲染只喂了手搓的 state，
// 少了这个绑定模板就会去读 undefined.xxx（第八十五批加图标尺寸梯子时踩到）。
const { iconSize } = require('../src/uiIcons.ts')
const { descriptor } = parseSfc(readFileSync(new URL('../src/App.vue', import.meta.url), 'utf8'))
function classIs(node, name) {
  return node.type === 1 && node.props.some(p => p.type === 6 && p.name === 'class' && p.value?.content.split(' ').includes(name))
}
function find(node, predicate) {
  if (predicate(node)) return node
  for (const child of node.children ?? []) { const match = find(child, predicate); if (match) return match }
}
async function renderPart(className, state) {
  const node = find(parse(descriptor.template.content), n => classIs(n, className))
  assert.ok(node, `missing ${className}`)
  const result = compileTemplate({ source: node.loc.source, filename: 'App.vue', id: 'dock-render', compilerOptions: { expressionPlugins: ['typescript'] } })
  assert.deepEqual(result.errors, [])
  const js = ts.transpileModule(result.code, { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText
  const exports = {}
  new Function('require', 'exports', js)(require, exports)
  const app = createSSRApp({ setup: () => ({ iconSize, ...state }), render: exports.render })
  // 片段里 `<IdeaTerminalIcon>` 这类组件经 `_resolveComponent` 找，不在 setup 绑定里 ——
  // 注册成全局组件才是真组件（`renderPart` 的默认 warnHandler 把"没解析到"当成失败）。
  app.component('IdeaTerminalIcon', require('../src/components/icons/toolWindowIcons.ts').IdeaTerminalIcon)
  app.config.warnHandler = message => { if (!message.startsWith('Failed to resolve component:')) throw new Error(message) }
  return parse(await renderToString(app))
}
const editorState = orientation => ({
  splitOrientation: orientation, splitSize: 200, focusedPane: 0,
  groups: [{ tabs: [], activePath: '' }, { tabs: [], activePath: '' }],
  navBack: [], navForward: [], active: null, focusedTab: null, activity: false,
  groupActive: () => null, editorSettings: { bidiTextDirection: 'ltr' },
  markdownPreviewOn: false, markdownCapable: false, activePath: '', stickyLines: [],
  binaryView: null, bottom: true, chromeHidden: false, panelSizes: { output: 180 },
  panelMax: () => 400, contentUiType: () => 'tabbed', isTabbedContentUi: () => true,
  bottomTab: 'output', traces: [], runConfigName: '', runState: { running: false, exit: null },
  allProblems: [], references: [], hierRoot: null, isDesktop: false,
  bottomAnchoredIds: [], toolMenu: null, bottomTabIsToolWindow: false, openAnchorMenu: () => {},
  // 标签条的单行布局（src/tabStripView.ts）：SSR 里没有真实尺寸，宽度与滚动偏移都是空操作。
  registerTabStrip: () => {}, tabWidthStyle: () => undefined,
  tabStripStyle: () => undefined, tabStripWraps: () => false,
  isTabDropped: () => false, onTabStripWheel: () => {}, setTabStripHover: () => {},
  // 底部 dock 标题条上的齿轮（src/components/ToolWindowGear.vue）：SSR 里没有可执行的行，空数组 = 连按钮都不画。
  bottomGearRows: [], toolWindowGearRows: [],
  // 工具窗口内容面板的输入面（src/toolViewContext.ts）：这些用例渲染的是 dock 片段，`<ToolWindowView>`
  // 在 SSR 里没注册 ⇒ 组件解析失败、不往下走，ctx 只作为模板绑定存在，空对象不参与任何断言。
  toolViewCtx: {},
  // 引用那一格的多条 content（src/referenceContents.ts）：SSR 默认"没有结果"，具体用例自己填。
  referenceTabs: [], selectReferenceTab: () => {}, closeReferenceTab: () => {},
  // 标签条右端的「更多」下拉（src/components/TabEntryPoint.vue）：SSR 里给一个空成员表。
  tabEntryPointItems: () => [],
  bottomSelectValue: 'output', pickBottomOption: () => {},
  // 输出标签条的「更多」下拉（App.vue 的 useToolContentTabs → hidden）：SSR 里没有可测量的可视区，
  // 隐藏列表恒为空，模板读这三个绑定。
  hiddenOutputTabs: [], hiddenTabsOpen: false, jumpToOutputTab: () => {},
  // 标签提醒（src/tabAlerts.ts）：SSR 里没有提醒；模板读这两个绑定（TabInfo.fireAlert）。
  tabAlerts: { visible: () => false, blinking: () => false },
  tabAlertKey: id => `bottom:${id}`,
})

for (const orientation of ['horizontal', 'vertical']) {
  test(`${orientation} editor split leaves output outside the split group`, async () => {
    const tree = await renderPart('editor-column', editorState(orientation))
    const split = find(tree, node => classIs(node, `split-${orientation}`))
    assert.ok(split, 'split group must exist')
    assert.ok(find(split, node => classIs(node, 'primary-pane')))
    assert.ok(find(split, node => classIs(node, 'secondary-pane')))
    assert.equal(Boolean(find(split, node => classIs(node, 'output-panel'))), false,
      'bottom output must not inherit the editor split axis')
    assert.ok(find(tree, node => classIs(node, 'output-panel')))
  })
}

// 侧条本体（`activity-bar`）现在住在 `src/components/ToolStripe.vue`：App.vue 那一层只留
// `<ToolStripe>` 调用（App.vue 顶在机检上限，见 tests/module-size.test.mjs）。所以这一条改成
// 直接渲真组件 —— 判定点没变：**隐藏面板不等于移除按钮**，dock 收起时侧条按钮仍然在。
// 组件自己的完整判据在 tests/stripe-resize-more.test.mjs。
test('hiding the project dock keeps its stripe button available to reopen it', async () => {
  const html = await renderToString(createSSRApp({
    render: () => h(toolStripe, {
      side: 'left', ids: ['files'], labels: { files: '项目' }, icons: { files: 'span' },
      mnemonicOf: () => '1', isDisabled: () => false, isActive: () => false, dragging: null,
      isDropBefore: () => false, dropAtEnd: false, width: 0, showNames: false, compact: false,
      moreIds: [], moreOnThisSide: true,
    }),
  }))
  assert.match(html, /aria-label="切换项目"/)
})

// DEFAULT_TOOL_ANCHORS（src/toolWindowMeta.ts:56-60）里 vcslog / todo / debug / tests 全部默认
// 停靠底部（上游 <toolWindow anchor="bottom">）。底部 dock 必须是它们的入口：IDEA 的底部工具
// 窗口条列出该窗口的各个 content，TaoCode 的 output-tabs 只列固定内容时，这四个窗口的正文
// 没有任何可点击的入口。
test('the bottom dock lists every tool window anchored to it', async () => {
  const tree = await renderPart('output-panel', {
    ...editorState('none'),
    bottomAnchoredIds: ['vcslog', 'todo'],
    toolTitles: { vcslog: 'VCS 日志', todo: '任务' },
    bottomTab: 'todo',
    toolViewCtx: {},
  })
  const labels = find(tree, node => classIs(node, 'output-tabs'))
  const buttons = find(labels, node => node.type === 1 && node.tag === 'button' && node.children.some(c => c.type === 2 && c.content.trim() === 'VCS 日志'))
  assert.ok(buttons, '底部工具窗口条必须列出停靠在底部的工具窗口')
  assert.ok(find(labels, node => node.type === 1 && node.tag === 'button' && node.children.some(c => c.type === 2 && c.content.trim() === '任务')))
})

// 一条搜索 = 标签条上一行（IDEA 的 Find 窗口就是 `ContentManager` 里的多条 content）。
// 这里渲染的是真组件模板，所以"两行"必须真的画出两个按钮，而不是源码里写着 v-for 就算数。
test('引用有几条 content，标签条就画几行，每行自带关闭', async () => {
  const tree = await renderPart('output-panel', {
    ...editorState('none'),
    bottomTab: 'references',
    referenceTabs: [
      { id: 1, label: '对“alpha”的引用', tooltip: 'A#alpha 在项目文件中', count: 2, pinned: false, searching: false, selected: false },
      { id: 2, label: '对“beta”的引用', tooltip: 'B#beta 在项目文件中', count: 0, pinned: false, searching: true, selected: true },
    ],
  })
  const tabs = find(tree, node => classIs(node, 'output-tabs'))
  assert.ok(tabs, '标签条没画出来')
  const texts = JSON.stringify(tabs)
  assert.ok(texts.includes('对“alpha”的引用'), '第一条 content 的标签没画')
  assert.ok(texts.includes('对“beta”的引用'), '第二条 content 的标签没画')
  assert.ok(texts.includes('正在查找…'), '还在搜的那条要说话，不能显示 0 条假装查完了')
  const count = name => {
    let found = 0
    const walk = node => {
      if (node.type === 1 && classIs(node, name)) found++
      for (const child of node.children ?? []) walk(child)
    }
    walk(tabs)
    return found
  }
  assert.equal(count('output-tab-close'), 2, '每条 content 都要有关自己的按钮')
  assert.equal(count('output-tab-pin'), 2, '每条 content 都要能钉住（PinToolwindowTab）')
})

// 底部标签条那一格「终端」的图标：上游是 `TerminalIcons.OpenTerminal_13x13`
// （`plugins/terminal/resources/icons/expui/toolwindow/terminal.svg`，`terminal.xml:4` 就是用它
// 注册 Terminal 窗口的）。原先这里是 lucide 的 `SquareTerminal`（24 格描边图），本批换成 expui 副本
// （`IdeaTerminalIcon`，出处登记在 `src/components/icons/index.ts` 的 `BOTTOM_CONTENT_IDEA_ICON`）。
// 这条是**真渲染**判据：看 HTML 里画出来的 viewBox 与 path，不是看源码字符串。
test('底部「终端」那一格画的是 IDEA 的 terminal.svg，不是 lucide 的 24 格图', async () => {
  const { IDEA_ICON_16 } = require('../src/components/icons/ideaIconData.ts')
  const tree = await renderPart('output-panel', { ...editorState('none'), bottomTab: 'output' })
  const tabs = find(tree, node => classIs(node, 'output-tabs'))
  assert.ok(tabs, '标签条没画出来')
  // 找到「终端」那一颗按钮。
  const terminal = find(tabs, node => node.type === 1 && node.tag === 'button' &&
    node.children?.some(c => c.type === 2 && c.content.includes('终端')))
  assert.ok(terminal, '「终端」那一格没画出来')
  const html = JSON.stringify(terminal)
  // 16 格那份的 viewBox 与 path 逐字节来自上游。
  assert.ok(html.includes('"0 0 16 16"'), '终端那一格不是 16 格图（还是 lucide 的 24 格？）')
  assert.ok(html.includes(JSON.stringify(IDEA_ICON_16.terminal.body[0]).slice(1, -1)) ||
            html.includes(IDEA_ICON_16.terminal.body[0]),
    '终端那一格画的不是上游 terminal.svg 那条 path')
  assert.ok(!html.includes('lucide'), '又混进 lucide 图标了')
})
