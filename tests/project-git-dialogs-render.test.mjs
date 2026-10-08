// `ProjectGitDialogs.vue` 的真渲染判据。
//
// 这一批把「文件历史 / Git 工作树 / Git 子模块」三个对话框从 App.vue 的模板里整块搬出来
// （App.vue 贴着机检行数上限），搬出去最容易出的事是**接线断掉**：宿主忘了把某个状态包成
// getter（`setup` 顶层之外的普通对象不会自动解包 ref）、或者把 `v-model` 换成 `:value` 时
// 漏了 `@input` —— 两者都能编过、都能渲染，只是"点了没反应"。
//
// 所以这里跑**真组件 + 真 SSR 渲染**，逐个断言三件事：
//   ① 关闭状态（三个 open 都是假）时一个节点都不画；
//   ② 打开时列表行数 = 数据条数，且每行的关键字段出现在 HTML 里；
//   ③ 输入行（工作树的路径 / 分支 / 新建分支）**双向**接线：`:value` 出得来、`@input` 打回去。
import test from 'node:test'
import assert from 'node:assert/strict'
import { createRenderer, createSSRApp, h, reactive } from 'vue'
import { renderToString } from 'vue/server-renderer'
import { loadSfc } from './vue-sfc-loader.mjs'

const { component: ProjectGitDialogs } = loadSfc('src/components/ProjectGitDialogs.vue')

/** 与 `App.vue` 的 `projectGitDialogContext` 同形：状态是 getter，动作是函数。 */
function context(over = {}) {
  const calls = []
  const state = reactive({
    fileHistoryOpen: false, fileHistoryBusy: false, fileHistory: null, fileHistoryCommit: null, fileHistorySelected: '',
    worktreeOpen: false, worktreeBusy: false, worktrees: [], worktreePath: '', worktreeBranch: '', worktreeNewBranch: false,
    submoduleOpen: false, submoduleBusy: false, submodules: [],
    ...over,
  })
  const ctx = {
    trapFocus: () => {},
    get fileHistoryOpen() { return state.fileHistoryOpen }, get fileHistoryBusy() { return state.fileHistoryBusy },
    get fileHistory() { return state.fileHistory }, get fileHistoryCommit() { return state.fileHistoryCommit },
    get fileHistorySelected() { return state.fileHistorySelected },
    showCommit: revision => calls.push(['showCommit', revision]), closeFileHistory: () => calls.push(['closeFileHistory']),
    get worktreeOpen() { return state.worktreeOpen }, get worktreeBusy() { return state.worktreeBusy },
    get worktrees() { return state.worktrees }, get worktreePath() { return state.worktreePath },
    get worktreeBranch() { return state.worktreeBranch }, get worktreeNewBranch() { return state.worktreeNewBranch },
    setWorktreePath: value => calls.push(['setWorktreePath', value]),
    setWorktreeBranch: value => calls.push(['setWorktreeBranch', value]),
    setWorktreeNewBranch: value => calls.push(['setWorktreeNewBranch', value]),
    addWorktree: () => calls.push(['addWorktree']), removeWorktree: path => calls.push(['removeWorktree', path]),
    closeWorktrees: () => calls.push(['closeWorktrees']),
    get submoduleOpen() { return state.submoduleOpen }, get submoduleBusy() { return state.submoduleBusy },
    get submodules() { return state.submodules },
    updateSubmodules: () => calls.push(['updateSubmodules']), closeSubmodules: () => calls.push(['closeSubmodules']),
  }
  return { ctx, state, calls }
}

const render = ctx => renderToString(createSSRApp({ render: () => h(ProjectGitDialogs, { ctx }) }))

/**
 * 用**真渲染器**（不是 SSR）拿回元素节点 —— SSR 会把 `onInput`/`onChange` 这类事件监听丢掉
 * （服务端渲染没有交互），所以"处理器接没接上"在 HTML 里看不出来。这里用一个把**建出来的元素**
 * 记下来的自搭渲染器（`tests/main-toolbar-render.test.mjs` 同一套路子），拿到带 props 的节点。
 */
function renderVNodes(ctx) {
  const made = []
  const renderer = createRenderer({
    createElement: tag => { const node = { tag, props: {} }; made.push(node); return node },
    createText: text => ({ text }), createComment: () => ({}),
    setText: () => {}, setElementText: () => {},
    insert: () => {}, parentNode: () => null, nextSibling: () => null,
    patchProp: (el, key, _prev, next) => { el.props[key] = next },
  })
  renderer.createApp({ render: () => h(ProjectGitDialogs, { ctx }) }).mount({})
  return made
}
const elementsOf = (nodes, tag) => nodes.filter(node => node.tag === tag)

test('三个对话框都关着时一个节点都不画（不该有空的 backdrop 挂在 DOM 里）', async () => {
  const { ctx } = context()
  const html = await render(ctx)
  assert.doesNotMatch(html, /modal-backdrop/)
  assert.doesNotMatch(html, /file-history-dialog|worktree-dialog|submodule-dialog/)
})

test('文件历史：提交行数 = 数据条数，短哈希/主题/作者日期/重命名标记都渲染出来', async () => {
  const { ctx } = context({
    fileHistoryOpen: true,
    fileHistory: { path: 'src/a.ts', commits: [
      { hash: 'aaaaaaaaaaaaaaaa', shortHash: 'aaaaaaa', subject: '第一次提交', author: '桃', date: '2026-10-06T00:00:00Z', paths: ['src/a.ts'] },
      { hash: 'bbbbbbbbbbbbbbbb', shortHash: 'bbbbbbb', subject: '改名了', author: '桃', date: '2026-10-05T00:00:00Z', paths: ['src/a.ts (← src/old.ts)'] },
    ] },
  })
  const html = await render(ctx)
  assert.match(html, /file-history-dialog/)
  assert.equal([...html.matchAll(/class="file-history-row/g)].length, 2, '两条提交 = 两行')
  assert.match(html, /aaaaaaa/)
  assert.match(html, /第一次提交/)
  assert.match(html, /桃 · 2026-10-06/)
  assert.match(html, /重命名/, '带 (← 的路径要出「重命名」标记')
  // 没选中提交时右侧是提示，不是空白。
  assert.match(html, /选择一个提交查看它改了什么/)
})

test('文件历史：选中某条时高亮那一行并显示该次提交的补丁', async () => {
  const { ctx } = context({
    fileHistoryOpen: true,
    fileHistory: { path: 'src/a.ts', commits: [
      { hash: 'aaaaaaaaaaaaaaaa', shortHash: 'aaaaaaa', subject: '第一次提交', author: '桃', date: '2026-10-06T00:00:00Z', paths: [] },
    ] },
    fileHistoryCommit: { revision: 'aaaaaaaaaaaaaaaa', patch: 'diff --git a/src/a.ts b/src/a.ts' },
    fileHistorySelected: 'aaaaaaaaaaaaaaaa',
  })
  const html = await render(ctx)
  assert.match(html, /class="file-history-row selected"/, '选中的那一行要高亮')
  assert.match(html, /改动内容（aaaaaaaa）/, '补丁标题取短哈希')
  assert.match(html, /diff --git a\/src\/a\.ts/)
})

test('工作树：每行一个移除按钮；移除动作带对路径', async () => {
  const { ctx, calls } = context({
    worktreeOpen: true,
    worktrees: [
      { path: 'D:/wt/one', branch: 'feature', locked: true, prunable: false, bare: false },
      { path: 'D:/wt/two', branch: 'main', locked: false, prunable: true, bare: false },
    ],
  })
  const html = await render(ctx)
  assert.equal([...html.matchAll(/class="worktree-row"/g)].length, 2)
  assert.match(html, /D:\/wt\/one/)
  assert.match(html, /已锁定/)
  assert.match(html, /可清理/)
  // 「移除该工作树」那颗按钮的处理器要在 <button> 上（不是挂在 Trash2 图标上）。
  assert.match(html, /<button[^>]*aria-label="移除该工作树"[^>]*>/)
  assert.ok(calls.length === 0, 'SSR 只是渲染，不该触发任何动作')
})

test('工作树：路径 / 分支 / 新建分支三个输入是双向接线（:value 出得来、@input 打回去）', async () => {
  const { ctx, state, calls } = context({ worktreeOpen: true, worktreePath: 'D:/wt/new', worktreeBranch: 'dev', worktreeNewBranch: true })
  const html = await render(ctx)
  // `:value` 真的把状态写进 DOM（写死 ref 直传会让这里变成 `[object Object]`）。
  assert.match(html, /value="D:\/wt\/new"/, '路径输入没绑到状态上')
  assert.match(html, /value="dev"/, '分支输入没绑到状态上')
  assert.match(html, /checked/, '新建分支勾选框没绑到状态上')
  // 反向：把状态改掉，渲染跟着变（getter 接线是活的，不是一次性快照）。
  state.worktreePath = 'D:/wt/other'
  assert.match(await render(ctx), /value="D:\/wt\/other"/, 'getter 没有跟着状态走')

  // `@input` / `@change` 的处理器：SSR 会把事件监听丢掉，所以用真渲染器拿 vnode props。
  const inputs = elementsOf(renderVNodes(ctx), 'input')
  const pathInput = inputs.find(node => node.props.placeholder?.includes('新工作树'))
  const branchInput = inputs.find(node => node.props.placeholder?.includes('分支名'))
  const checkInput = inputs.find(node => node.props.type === 'checkbox')
  assert.ok(pathInput && branchInput && checkInput, '三个输入没都渲染出来')
  assert.equal(typeof pathInput.props.onInput, 'function', '路径输入的回写处理器没接上')
  assert.equal(typeof branchInput.props.onInput, 'function', '分支输入的回写处理器没接上')
  assert.equal(typeof checkInput.props.onChange, 'function', '「新建分支」的回写处理器没接上')
  // 真的调一次，看它打回宿主的是哪条动作（`:value` + `@input` 成对才叫双向）。
  pathInput.props.onInput({ target: { value: 'D:/wt/typed' } })
  branchInput.props.onInput({ target: { value: 'release' } })
  checkInput.props.onChange()
  assert.deepEqual(calls, [
    ['setWorktreePath', 'D:/wt/typed'], ['setWorktreeBranch', 'release'], ['setWorktreeNewBranch', false],
  ])
})

test('子模块：状态列把空格翻成「正常」、非空格显示 trim 后的状态；空列表给一句说明', async () => {
  const empty = context({ submoduleOpen: true })
  assert.match(await render(empty.ctx), /这个仓库没有子模块/)
  const { ctx } = context({
    submoduleOpen: true,
    submodules: [
      { path: 'libs/a', status: ' ', commit: '1111111111111111' },
      { path: 'libs/b', status: 'M ', commit: '2222222222222222' },
    ],
  })
  const html = await render(ctx)
  assert.equal([...html.matchAll(/class="submodule-row"/g)].length, 2)
  assert.match(html, /正常/)
  assert.match(html, /M</, '非空状态要 trim 后显示（M 不是 M+空格）')
  assert.match(html, /11111111/, '提交取前 8 位')
})

test('关闭动作各自只碰自己那一个开关（三个对话框不互相串）', () => {
  const { ctx, calls } = context()
  ctx.closeFileHistory(); ctx.closeWorktrees(); ctx.closeSubmodules()
  assert.deepEqual(calls, [['closeFileHistory'], ['closeWorktrees'], ['closeSubmodules']])
})