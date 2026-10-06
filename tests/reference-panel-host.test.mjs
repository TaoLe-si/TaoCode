// `references` 到底有没有成为一条**真能被打开、有内容、可关闭**的工具窗口 content。
//
// 上一轮（`docs/batch-2026-10-06-hier3.md` §5）的结论是「组件侧齐了但挂不上」：
// `ToolWindowView.vue` 的视图链里没有 `references` 这一支 ⇒ 任何 `view='references'` 都会掉进
// 末尾那个 `<template v-else>`（项目视图），分组树**一个渲染点都没有**。
// 这一批补的就是那一层（`ReferencePanel.vue` + 宿主分支 + `toolViewContext.ts` 的数据源），
// 所以判据一律走 **SSR 真渲染**：断言的是渲染出来的行，不是源码里的字符串。
//
// 上游对照（本机参考树，逐行开过）：
//   · 每次搜索 = ContentManager 里的一条 Content：
//     `platform/lang-impl/src/com/intellij/usageView/impl/UsageViewContentManagerImpl.java:149-190`
//     （`:157-158` 选中的被钉住就新开、`:162-178` 从尾往前挑可顶替的、`:185-189` 先占位再删再选中）；
//   · 那条 Content 装的就是用法视图的组件：
//     `platform/usageView-impl/src/com/intellij/usages/impl/UsageViewManagerImpl.java:145-163`
//     （`addContent(...)` → `((UsageViewImpl)usageView).setContent(content)`），
//     组件本体 = 同目录 `UsageViewImpl.java:1651-1654`，挂上 Content = `:1667-1670`；
//   · 关掉那条 Content = `UsageViewImpl.java:1786-1791` 的 `close()` →
//     `UsageViewContentManagerImpl.java:219` 的 `removeContent(content, true)`；
//   · Find 窗口本身是**按需注册**的（`UsageViewContentManagerImpl.java:120-136`
//     的 `getOrRegisterFindToolWindow`，`:129` 那句 `registerToolWindow(ToolWindowId.FIND, …)`），
//     所以它不是注册表里的一条窗口 ⇒ 本仓的 `references` 也**不进** `TOOL_WINDOW_REGISTRY`：
//     它是底部那一格（本仓 ContentManager 的等价物）里的一条**内容**。
import test from 'node:test'
import assert from 'node:assert/strict'
import { nextTick, computed, createSSRApp, h, ref } from 'vue'
import { renderToString } from 'vue/server-renderer'
import { parse } from '@vue/compiler-dom'
import { loadSfc } from './vue-sfc-loader.mjs'
import { readFileSync } from 'node:fs'
import { createToolViewContext } from '../src/toolViewContext.ts'
import { createToolWindowActions } from '../src/toolWindowActions.ts'
import { usageGroupKey } from '../src/usageViewGrouping.ts'
import {
  closeReferences, finishReferences, hasReferences, referenceRows, referenceTabs, referencesInNewTab,
  referencesSpeedSearch, resetReferences, selectReferences, startReferences,
} from '../src/referenceContents.ts'

const read = relative => readFileSync(new URL(`../${relative}`, import.meta.url), 'utf8')
const { component: toolWindowView } = loadSfc('src/components/ToolWindowView.vue')

const at = (path, line, character = 0) => ({ path, line, character })
/** 三个目录四份文件、五条引用：默认档位（目录层关、没有符号源）= 4 个组行 + 5 个叶子 = 9 行。 */
const SAMPLE = [at('src/sub/y.ts', 4, 2), at('src/x.ts', 1), at('src/x.ts', 0, 7), at('README.md', 9), at('src/note.md', 2)]

function reset() {
  resetReferences()
  referencesInNewTab.value = false
  referencesSpeedSearch.value = ''
}

// ——— 宿主输入（ctx）与底部那一格的宿主（actions）：都用真模块，不手写面板数据 ———

/** `createToolViewContext` 的一份最小宿主输入（其余字段只被闭包读，这一批里跑不到）。 */
function hostCtx() {
  const noop = () => {}
  return {
    active: ref(null), activePath: ref(''), activeConfigured: ref(false), activeLspRunning: ref(false),
    commitMessageSettings: ref({}), dropBookmark: noop, editorFor: () => null,
    editorSettings: ref({ showTreeIndentGuides: true, diffContextLines: 3, compactTreeIndents: false, expandNodesWithSingleClick: false }),
    evaluateRequest: ref(null), explorer: ref(true), fileTreeRef: ref(null), gitCompareWith: ref(''),
    gradleHost: null, gradleViewContext: () => ({}), historyEpoch: ref(0), leftView: ref('files'),
    lspReady: ref(false), notify: noop, notifyFromPanel: noop, showToolWindow: noop,
    onSearchOpen: noop, onSearchReplaced: noop, onTreeContext: noop, onTreeRename: noop,
    openFile: noop, openMnemonicPrompt: noop, openSettings: noop, outline: ref([]),
    projectSettings: ref({ todoPatterns: [], scopes: [], bookmarkLists: [] }),
    projectViewFileColor: () => null, refreshTree: noop, revealLocation: noop, revertHistory: noop,
    runConfigCwd: ref(null), runConfigProgram: ref(null), runConfigDebugAdapter: ref(''),
    saveBookmarksView: noop, saveSettingsPatch: noop, saveVcsLog: noop,
    dirtyPaths: () => [], openTabPaths: () => [], savePath: async () => null,
    searchPanelRef: ref(null), sortedAll: ref([]), sortBookmarkGroup: noop, syntheticNodes: ref([]),
    testRunnerRef: ref(null), todoSource: ref(null), noticeLog: ref([]), clearNotices: noop,
    generalSettings: ref({}), workspace: ref({ root: 'D:/proj', name: 'proj', entries: [] }),
  }
}

/** 底部那一格的宿主环境：`showOutput` 真的写回 `bottomTab`，关到空那条才问得出来。 */
function actionsEnv() {
  const bottomTab = ref('references')
  const noop = () => {}
  return {
    bottomTab,
    ctx: {
      workspace: () => ({ value: { root: 'D:/proj' } }), explorer: ref(true), bottom: ref(true), bottomTab,
      references: ref([]), hierRoot: ref(null), hierTitle: ref('层级'), groups: {}, focusedPane: ref(0),
      active: ref(null), toolMenu: ref(null), lastActiveId: () => undefined, bottomAnchoredIds: () => [],
      toolWindowTitle: id => String(id), activeToolWindows: () => [], toolWindowAvailable: () => true,
      isLeftToolWindowId: () => false, closeTab: noop, switchTabIn: noop,
      showOutput: tab => { bottomTab.value = tab }, resetHierarchy: noop, toolDisabled: () => false,
      contentUiType: () => 'tabbed', setContentUiType: noop, focusToolWindowContent: noop,
      toolAnchors: () => ({}), setToolAnchor: noop, saveToolAnchors: noop, showView: noop,
    },
  }
}

// ——— SSR 结果的读法（真 HTML，不是源码字符串）———

function astNodes(html) {
  const out = []
  const walk = node => {
    if (node.type === 1) out.push(node)
    for (const child of node.children ?? []) walk(child)
  }
  for (const child of parse(html, { whitespace: 'condense' }).children ?? []) walk(child)
  return out
}
const classOf = node => node.props.find(p => p.type === 6 && p.name === 'class')?.value?.content?.split(' ') ?? []
const attrOf = (node, name) => node.props.find(p => p.type === 6 && p.name === name)?.value?.content ?? ''
const textOf = node => (node.children ?? [])
  .map(child => child.type === 2 ? child.content : child.type === 1 ? textOf(child) : '').join('')
/** 后代里第一个带某个类的节点（SSR 出来的 HTML 里 `.ref-path` 与 `.ref-pos` 是相邻的 flex 子项，
 *  中间**没有**文本空白（空隙是 CSS 的 `gap`），所以两者要分别读、不能拼成一个字符串比）。 */
function descendant(node, name) {
  for (const child of node.children ?? []) {
    if (child.type !== 1) continue
    if (classOf(child).includes(name)) return child
    const deeper = descendant(child, name)
    if (deeper) return deeper
  }
  return null
}

/** 渲染出来的引用行：`{pad, label, detail}`，顺序 = DOM 序。 */
function renderedRows(html) {
  return astNodes(html).filter(node => classOf(node).includes('ref-row')).map(node => ({
    pad: attrOf(node, 'style').match(/padding-left:\s*(\d+)px/)?.[1] ?? '0',
    label: textOf(descendant(node, 'ref-path') ?? { children: [] }).trim(),
    detail: descendant(node, 'ref-pos') ? textOf(descendant(node, 'ref-pos')).trim() : '',
  }))
}
/** 每行压成 `label[/detail]` 一条字符串，方便按行序比对。 */
const rowTexts = html => renderedRows(html).map(row => row.detail ? `${row.label} | ${row.detail}` : row.label)
/** 空态那一行（`.ref-empty`）的文字；没有这一行返回 null。 */
function emptyTextOf(html) {
  const node = astNodes(html).find(candidate => classOf(candidate).includes('ref-empty'))
  return node ? textOf(node).replace(/\s+/g, ' ').trim() : null
}

async function renderHost(ctx, view = 'references') {
  const app = createSSRApp({ render: () => h(toolWindowView, { view, active: true, ctx }) })
  app.config.warnHandler = message => { if (!message.startsWith('Failed to resolve component:')) throw new Error(message) }
  return await renderToString(app)
}

// ——— 1) 内容集合：references 这一格打得开、有内容 ———

test('打开 references：宿主渲出用法树（组行 + 叶子 + 计数 + 缩进），不是那张项目树', async () => {
  reset()
  try {
    const search = startReferences('alpha', 'com.example.A#alpha')
    finishReferences(search, SAMPLE)
    const html = await renderHost(createToolViewContext(hostCtx()))
    assert.deepEqual(rowTexts(html), [
      'README.md | 1 条结果', '10:1',
      'src/note.md | 1 条结果', '3:1',
      'src/sub/y.ts | 1 条结果', '5:3',
      'src/x.ts | 2 条结果', '1:8', '2:1',
    ], '行序 = flattenUsageTree 的深序；组行带 usage.view.counter（UsageViewBundle.properties:131），叶子是 1 基 行:列')
    assert.deepEqual(renderedRows(html).filter(row => row.detail).map(row => row.label),
      ['README.md', 'src/note.md', 'src/sub/y.ts', 'src/x.ts'], '只有组行有计数那一栏（叶子只有位置文本）')
    assert.deepEqual(renderedRows(html).map(row => row.pad), ['6', '18', '6', '18', '6', '18', '6', '18', '18'],
      '缩进按 depth 走（depth*12+6）⇒ 层级真的进了 DOM')
    // 补这一层之前，view='references' 掉进宿主末尾的 `<template v-else>`，画的是项目树。
    assert.equal(astNodes(html).some(node => classOf(node).includes('tree-scroll')), false,
      'references 不许再被 v-else 吃掉、渲成项目树')
    assert.equal(emptyTextOf(html), null, '有内容时不该有空态行')
  } finally { reset() }
})

test('上下文层把引用面板要的六栏全递出来（数据源就是 referenceContents 那一份）', () => {
  reset()
  try {
    const search = startReferences('alpha', 'com.example.A#alpha')
    finishReferences(search, SAMPLE)
    // ctx 是**快照**（宿主那边由 `computed` 每次重算，`src/App.vue:861`），所以每次动完状态都重新要一份。
    const ctx = createToolViewContext(hostCtx())
    assert.deepEqual(ctx.referenceRows, referenceRows.value, '行 = referenceRows（不在 ctx 里再算一棵树）')
    assert.equal(ctx.referenceCount, SAMPLE.length, '条数 = 选中的那条自己的 payload，不是几批结果的和')
    assert.equal(ctx.referenceSearching, false)
    assert.equal(ctx.referenceQuery, '')
    const fileKey = usageGroupKey('file', 'src/x.ts')
    ctx.onReferenceToggleGroup?.(fileKey)
    assert.equal(referenceRows.value.find(row => row.key === fileKey).collapsed, true, 'ctx 那个回调动的就是 referenceContents')
    ctx.onReferenceCollapseAll?.()
    assert.equal(referenceRows.value.filter(row => row.kind === 'usage').length, 0)
    ctx.onReferenceExpandAll?.()
    assert.equal(referenceRows.value.filter(row => row.kind === 'usage').length, 5)
    ctx.onReferenceSpeedSearch?.('note')
    assert.equal(referencesSpeedSearch.value, 'note')
    assert.deepEqual(createToolViewContext(hostCtx()).referenceRows.map(row => row.label), ['src/note.md', '3:1'])
  } finally { reset() }
})

test('宿主那份 ctx 挂在 computed 上就会随状态重算（不是建一次冻住）', () => {
  reset()
  try {
    referencesInNewTab.value = true
    const host = hostCtx()
    const ctx = computed(() => createToolViewContext(host))
    const first = startReferences('one', 'One')
    finishReferences(first, [at('src/a.ts', 0)])
    assert.deepEqual(ctx.value.referenceRows.map(row => row.label), ['src/a.ts', '1:1'])
    const second = startReferences('two', 'Two')
    finishReferences(second, [at('src/b.ts', 4)])
    assert.deepEqual(ctx.value.referenceRows.map(row => row.label), ['src/b.ts', '5:1'], '新起的那条被选中 ⇒ 立刻换掉面板行')
    assert.equal(ctx.value.referenceCount, 1)
    selectReferences(first.id)
    assert.deepEqual(ctx.value.referenceRows.map(row => row.label), ['src/a.ts', '1:1'], '切回第一条也跟着重算')
    assert.equal(second.id !== first.id, true)
  } finally { reset() }
})

test('标签条/combo 那一份内容集合里逐条列的是 content（`ContentComboLabel` 的形式），不是窗口名', () => {
  reset()
  try {
    referencesInNewTab.value = true
    const first = startReferences('one', 'One')
    finishReferences(first, [at('src/a.ts', 0)])
    const second = startReferences('two', 'Two')
    finishReferences(second, [at('src/b.ts', 1)])
    const actions = createToolWindowActions(actionsEnv().ctx)
    assert.deepEqual(actions.bottomTabOptions.value.filter(option => String(option.id).startsWith('references:')),
      [{ id: `references:${first.id}`, label: '对“one”的引用' }, { id: `references:${second.id}`, label: '对“two”的引用' }],
      '两条内容 = 两个选项（IDEA 的 combo 形式列得全才选得到）')
    assert.equal(actions.bottomTabLabel('references'), '对“two”的引用', '那一格的标题 = 选中的那条的 tabName')
  } finally { reset() }
})

// ——— 2) 有内容：选中的那条决定面板 ———

test('换看别条内容时渲的就是那一条的行', async () => {
  reset()
  try {
    referencesInNewTab.value = true
    const first = startReferences('one', 'One')
    finishReferences(first, [at('src/a.ts', 0), at('src/b.ts', 1)])
    const second = startReferences('two', 'Two')
    finishReferences(second, [at('src/c.ts', 5)])
    assert.deepEqual(rowTexts(await renderHost(createToolViewContext(hostCtx()))),
      ['src/c.ts | 1 条结果', '6:1'])
    selectReferences(first.id)
    assert.deepEqual(rowTexts(await renderHost(createToolViewContext(hostCtx()))),
      ['src/a.ts | 1 条结果', '1:1', 'src/b.ts | 1 条结果', '2:1'])
    assert.equal(createToolViewContext(hostCtx()).referenceCount, 2, '切回来就是第一条那两条引用')
    assert.equal(second.id !== first.id, true)
  } finally { reset() }
})

test('还在搜的那条：面板说「正在查找…」，而且它不会被下一次搜索顶替', async () => {
  reset()
  try {
    const first = startReferences('alpha', 'A#alpha')
    const html = await renderHost(createToolViewContext(hostCtx()))
    assert.equal(emptyTextOf(html), '正在查找…', '行还没回来，不能说"没有找到用法"')
    assert.deepEqual(renderedRows(html), [], '搜索期间不画假行')
    const second = startReferences('beta', 'B#beta')
    assert.equal(referenceTabs.value.length, 2, '正在搜的那条免于顶替（UsageViewContentManagerImpl.java:170-172）')
    assert.equal(referenceTabs.value.find(tab => tab.id === first.id).searching, true)
    finishReferences(second, [at('src/z.ts', 3)])
    assert.deepEqual(rowTexts(await renderHost(createToolViewContext(hostCtx()))),
      ['src/z.ts | 1 条结果', '4:1'])
    finishReferences(first, [at('src/a.ts', 0)])
    assert.equal(referenceTabs.value.length, 2, '第一条搜完还是两条，没被悄悄关掉')
  } finally { reset() }
})

// ——— 3) 可关闭：关到空就不占一格 ———

test('关到空：那一格不再占位、面板不画行，宿主也跳回输出', async () => {
  reset()
  const { bottomTab, ctx } = actionsEnv()
  const actions = createToolWindowActions(ctx)
  const search = startReferences('alpha', 'com.example.A#alpha')
  finishReferences(search, SAMPLE)
  // watch 是 pre-flush 的：一个 tick 内从 false 又回到 false 它**不会**回调（Vue 比的是刷新时的值），
  // 所以这里先让这一格真的"占上"一次，再关 —— 关的那次才是用户看得见的那次跳回。
  await nextTick()
  const before = actions.bottomContentCount()
  assert.equal(actions.bottomTabAvailable('references'), true)
  assert.ok(actions.bottomTabOptions.value.some(option => option.id === `references:${search.id}`))
  closeReferences(search.id)
  assert.equal(hasReferences.value, false)
  const html = await renderHost(createToolViewContext(hostCtx()))
  assert.deepEqual(renderedRows(html), [], '内容没了 ⇒ 一行都不画（没有假列表）')
  assert.equal(emptyTextOf(html), '没有找到用法', '空态文案 = usages.n 的 0#no usages 那一档（UsageViewBundle.properties:8）')
  assert.equal(actions.bottomContentCount(), before - 1, '关掉最后一条 ⇒ 底部那一格少一格')
  assert.equal(actions.bottomTabAvailable('references'), false)
  assert.deepEqual(actions.bottomTabOptions.value.filter(option => String(option.id).startsWith('references:')), [])
  await nextTick()
  assert.equal(bottomTab.value, 'output', '内容全关光就离开那一格（上游 setToHideOnEmptyContent(true)，UsageViewContentManagerImpl.java:57）')
})

test('只关掉选中的那条时选中标的退回邻居，面板跟着换成邻居的行', async () => {
  reset()
  try {
    referencesInNewTab.value = true
    const first = startReferences('one', 'One')
    finishReferences(first, [at('src/a.ts', 0)])
    const second = startReferences('two', 'Two')
    finishReferences(second, [at('src/b.ts', 1), at('src/c.ts', 2)])
    closeReferences(second.id)
    assert.equal(hasReferences.value, true, '还剩一条')
    assert.deepEqual(rowTexts(await renderHost(createToolViewContext(hostCtx()))),
      ['src/a.ts | 1 条结果', '1:1'], '选中标的退回第一条')
    assert.equal(createToolViewContext(hostCtx()).referenceCount, 1)
    assert.equal(first.id !== second.id, true)
  } finally { reset() }
})

test('有引用但过滤串一条不剩 ≠ 没有用法（两种空态不许说成同一句话）', async () => {
  reset()
  try {
    const search = startReferences('alpha', 'com.example.A#alpha')
    finishReferences(search, SAMPLE)
    referencesSpeedSearch.value = 'zzz'
    const html = await renderHost(createToolViewContext(hostCtx()))
    assert.deepEqual(renderedRows(html), [])
    assert.equal(emptyTextOf(html), '没有匹配的引用。')
    assert.equal(createToolViewContext(hostCtx()).referenceCount, SAMPLE.length, '过滤不改总条数：那条内容还在')
    referencesSpeedSearch.value = 'note'
    assert.deepEqual(rowTexts(await renderHost(createToolViewContext(hostCtx()))),
      ['src/note.md | 1 条结果', '3:1'], '过滤串回到有命中的值 ⇒ 立刻只剩那一棵')
  } finally { reset() }
})

// ——— 接线层（只钉「宿主分支还在」这一件事；行为由上面的 SSR 负责）———

test('宿主的引用分支与它的面板组件互为渲染点（不留假 import）', () => {
  const view = read('src/components/ToolWindowView.vue')
  const line = view.split('\n').find(entry => entry.includes('<ReferencePanel'))
  assert.ok(line, 'ToolWindowView 必须有 ReferencePanel 的挂载点')
  assert.match(line, /v-else-if="view === 'references'"/)
  assert.match(line, /:rows="ctx\.referenceRows/, '行从 ctx 来，面板自己不留状态')
  assert.match(line, /@open="target => ctx\.onReveal\(target\)"/, '单击导航走宿主那一条 revealLocation 通道')
  assert.match(read('src/toolViewContext.ts'), /referenceRows: referenceRows\.value/, '上下文层透传的就是那一份')
})
