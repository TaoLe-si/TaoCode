import test from 'node:test'
import assert from 'node:assert/strict'
import { createSSRApp, h } from 'vue'
import { renderToString } from 'vue/server-renderer'
import { loadSfc } from './vue-sfc-loader.mjs'

// 真实的 ToolWindowView（相对 .vue 依赖由夹具真加载，面板也是真的）。
//
// 曾经的错位：宿主传 `:active`（当前 dock 的可见性），而 ToolWindowView 没有声明这个 prop，
// 它的根又是 fragment + Teleport，属性无法自动透传（Vue 会警告 "Extraneous non-props attributes"），
// 于是每个面板读到的其实是 `ctx.active` —— 那是**左侧栏**的可见性。底部停靠的工具窗口
// （todo / vcslog / debug / tests）打开时，左栏一收，它们就跟着变成未激活。
//
// 判据：全局 mixin 记下每个声明了 `active` prop 的子组件**真正收到**的值 —— 面板渲染的
// HTML 在两种情况下可能一样（active 只驱动 watcher），所以要看 prop 本身。
const { component } = loadSfc('src/components/ToolWindowView.vue')

function ctx(active) {
  return {
    active, root: 'D:/project', workspace: { root: 'D:/project', name: 'demo', entries: [] },
    activePath: '', activeTabPath: '', lspReady: false, isDesktop: false, outline: [],
    sortedBookmarks: [], historyEpoch: 0, todoPatterns: [], todoSource: '',
    noticeLog: [], onClearNotices() {}, treeEntries: [], syntheticNodes: [], indentGuides: true,
    projectViewFileColor: () => null, projectTreeState: { state: {}, update() {}, status: {} },
    fileTreeRef: null, searchPanelRef: null, testRunnerRef: null, runConfigProgram: null, runConfigCwd: null,
    evaluateRequest: null, commitSettings: {}, activeFileText: '',
    bindSearchPanel() {}, bindTestRunner() {}, bindFileTree() {},
    onSearchOpen() {}, onSearchReplaced() {}, onReveal() {}, onBookmarkRemove() {}, onBookmarkAssign() {},
    onHistoryRevert() {}, onTreeContext() {}, onTreeOpen() {}, onTreeError() {},
    onSelectInProjectView() {}, onFoldAll() {}, onExpandAll() {}, onExpandRecursively() {},
    canExpandRecursively: () => false, onRefreshTree() {}, onToggleCompactIndits() {}, onToggleExpandWithSingleClick() {},
  }
}

/** 渲染一次，返回「每个声明了 active prop 的子组件收到的值」。 */
async function received(view, active, contextActive) {
  const seen = new Map()
  const app = createSSRApp({ render: () => h(component, { view, active, ctx: ctx(contextActive) }) })
  app.mixin({
    beforeCreate() {
      if (!this.$options?.props || !('active' in this.$options.props)) return
      const name = this.$.type?.name || this.$.type?.__name || 'anonymous'
      seen.set(name, this.$.props.active)
    },
  })
  await renderToString(app)
  return seen
}

// debug / tests / outline 的面板并不声明 `active`（它们用 `ready` / `active-path`），不在这个契约里。
for (const view of ['todo', 'vcslog', 'search', 'git']) {
  test(`${view} receives its own dock visibility, not the left explorer visibility`, async () => {
    const shown = await received(view, true, false)
    assert.equal(shown.size, 1, `${view} 没有渲染出声明 active 的面板：${[...shown.keys()].join(',') || '(无)'}`)
    for (const [name, value] of shown) assert.equal(value, true, `${name} 在宿主 active=true 时收到了 ${value}`)
    const hidden = await received(view, false, true)
    for (const [name, value] of hidden) assert.equal(value, false, `${name} 读的是 ctx.active（左栏状态），而不是宿主传入的 active`)
  })
}
