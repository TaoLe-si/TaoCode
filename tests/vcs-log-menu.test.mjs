// Git 日志窗口**提交行右键菜单**的判据 —— 上游两组：
//   平台 `Vcs.Log.ContextMenu`（intellij.platform.vcs.log.impl.xml:274-284）
//   Git   `Git.Log.ContextMenu`（intellij.vcs.git.backend.xml:400-428，插在 Vcs.Log.GoToChild 之前）
// 本仓只上有落点的四条，其余在 src/vcsLogMenu.ts 的注释里逐条记了原因（补丁/提交↔提交比较/
// git revert/交互式变基那一族/以提交为起点开分支/图的父子导航）。
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { logCommitMenu, logRefMenu, adjacentCommits, goToCandidateText, COPY_REVISION_TITLE, COPY_REVISION_DESCRIPTION,
  RESET_TO_HERE_TITLE, UNCOMMIT_TITLE, UNCOMMIT_DESCRIPTION, UNCOMMIT_DISABLED_DESCRIPTION, CREATE_TAG_TITLE,
  CREATE_TAG_DESCRIPTION, DELETE_REF_TITLE, GO_TO_CHILD_TITLE, GO_TO_CHILD_DESCRIPTION, GO_TO_PARENT_TITLE,
  GO_TO_PARENT_DESCRIPTION } from '../src/vcsLogMenu.ts'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const read = relative => readFileSync(join(root, relative), 'utf8')
const head = { hash: 'a'.repeat(40), shortHash: 'aaaaaaaa', isHead: true }
const older = { hash: 'b'.repeat(40), shortHash: 'bbbbbbbb', isHead: false }
const noop = () => {}
const actions = (over = {}) => ({ copy: noop, reset: noop, uncommit: noop, createTag: noop, goTo: noop, ...over })

test('文案逐条等于随 IDE 发货的中文包', () => {
  assert.equal(COPY_REVISION_TITLE, '复制修订号', 'ActionsBundle action.Vcs.CopyRevisionNumberAction.text')
  assert.equal(COPY_REVISION_DESCRIPTION, '将选定提交的修订号复制到剪贴板', '同动作 .description')
  assert.equal(RESET_TO_HERE_TITLE, '将当前分支重置到此处…', 'GitBundle action.Git.Reset.In.Log.text')
  assert.equal(UNCOMMIT_TITLE, '撤消提交…', 'GitBundle action.Git.Uncommit.text')
  assert.equal(UNCOMMIT_DESCRIPTION, '撤消最后一次提交并将其更改放入所选更改列表', '同动作 .description')
  assert.equal(UNCOMMIT_DISABLED_DESCRIPTION, '所选提交不是当前分支中的最后一次提交', 'GitBundle git.undo.action.description（不可用时）')
  assert.equal(CREATE_TAG_TITLE, '新建标记…', 'GitBundle action.Git.CreateNewTag.text（包里是「标记」）')
  assert.equal(CREATE_TAG_DESCRIPTION, '创建指向此提交的新标签', '同动作 .description')
})

test('行序照上游：复制修订号 ─ 重置到此处 ─ 撤消提交 ─ 新建标记 ─ 转到子/父提交', () => {
  const rows = logCommitMenu(head, actions(), [head])
  assert.deepEqual(rows.map(row => row.action), [
    'Vcs.CopyRevisionNumberAction', 'Git.Reset.In.Log', 'Git.Uncommit', 'Git.CreateNewTag',
    'Vcs.Log.GoToChild', 'Vcs.Log.GoToParent',
  ])
  assert.deepEqual(rows.map(row => Boolean(row.separatorBefore)), [false, true, false, true, true, false], '分隔线照上游那几处')
})

test('「撤消提交」只对当前分支的最后一个提交可用（GitUncommitAction.update 的 isHeadCommit）', () => {
  const actionsObj = actions()
  const onHead = logCommitMenu(head, actionsObj, [head]).find(row => row.id === 'uncommit')
  assert.equal(onHead.disabled, false, 'HEAD 上可用')
  const onOlder = logCommitMenu(older, actionsObj, [head, older]).find(row => row.id === 'uncommit')
  assert.equal(onOlder.disabled, true, '别的提交上灰着')
  assert.equal(onOlder.description, UNCOMMIT_DISABLED_DESCRIPTION, '灰着时给上游那句理由')
  assert.equal(onHead.description, UNCOMMIT_DESCRIPTION)
})

test('跑得动的那三条都点在真原生请求上（不是空壳）', () => {
  const data = read('src/vcsLogData.ts')
  assert.match(data, /request\('git\.reset', \{ target: hash, mode \}\)/, '重置到此处 → git.reset（带模式）')
  assert.match(data, /request\('git\.reset', \{ target: 'HEAD~1', mode: 'soft' \}\)/, '撤消提交 → reset --soft HEAD~1')
  assert.match(data, /request\('git\.tag\.create', \{ name, target: hash \}\)/, '新建标记 → git.tag.create 带 target')
  const view = read('src/components/VcsLog.vue')
  assert.match(view, /@menu="openMenu"/, '表格把右键事件交给日志窗口')
  assert.match(view, /ref\.type === 'head'/, 'isHead 按引用判（原生 git.logFull 的 head 引用）')
  const table = read('src/components/VcsLogTable.vue')
  assert.match(table, /@contextmenu\.prevent\.stop="emit\('menu'/, '行上挂右键')
})

test('引用 chip 的菜单：标签给「删除」（GitDeleteRefAction），其余类型不给空菜单', () => {
  assert.equal(DELETE_REF_TITLE, '删除', 'GitBundle branches.action.delete = 删除(&D)（GitDeleteRefAction 的文案）')
  const calls = []
  const rows = logRefMenu({ name: 'v1.2', type: 'tag' }, { deleteTag: name => calls.push(name) })
  assert.equal(rows.length, 1)
  assert.equal(rows[0].action, 'GitDeleteRefAction')
  assert.equal(rows[0].title, '删除')
  assert.match(rows[0].description, /v1\.2/, '说明里带上标签名')
  rows[0].run?.()
  assert.deepEqual(calls, ['v1.2'], '真去删那个标签')
  for (const type of ['local', 'remote', 'head']) {
    assert.deepEqual(logRefMenu({ name: 'master', type }, { deleteTag: noop }), [],
      `${type} 不在日志里给这一列（分支的一族在分支弹窗，见 src/vcsLogMenu.ts 的说明）`)
  }
})

test('接线：chip 上挂右键、日志视图两套菜单共用一份渲染', () => {
  const table = read('src/components/VcsLogTable.vue')
  assert.match(table, /@contextmenu\.prevent\.stop="emitRefMenu\(chip, \$event\)"/, '引用 chip 上挂右键（组头那条引用）')
  assert.match(table, /emit\('refMenu', \{ name: chip\.head\.name, type: chip\.head\.type/,
    '菜单契约没改：交出去的还是那一条引用（chip 显示的是组名，可能不是组头之外的某一条）')
  const view = read('src/components/VcsLog.vue')
  assert.match(view, /@ref-menu="openRefMenu"/)
  assert.match(view, /logRefMenu\(\{ name: payload\.name, type: payload\.type \}/, '引用菜单由模型给出（空行就不开菜单）')
  assert.match(read('src/vcsLogData.ts'), /request\('git\.tag\.delete', \{ name \}\)/, '删除走原生 git.tag.delete')
})

test('面板里那条自造的标签行已删（新建在日志菜单、删除在引用 chip、列表=日志行的引用）', () => {
  const panel = read('src/components/SourceControl.vue')
  for (const gone of ['新标签名', '新建标签', '删除标签', 'sc-tag']) {
    assert.ok(!panel.includes(gone), `面板里不该再有「${gone}」`)
  }
  assert.ok(!read('src/style.css').includes('.sc-tag {'), '那套 chip 样式也删了')
})

// ── 第五十八批：转到子/父提交（上游 GoToParentOrChildAction.kt + Vcs.Log.ContextMenu 的尾组） ──

const graph = [
  { hash: 'c3', shortHash: 'c3', isHead: true, subject: 'third', author: 'Tao', dateText: '2026-09-30 10:00', parents: ['c2'] },
  { hash: 'c2', shortHash: 'c2', isHead: false, subject: 'second', author: 'Tao', dateText: '2026-09-30 09:00', parents: ['c1'] },
  { hash: 'c1', shortHash: 'c1', isHead: false, subject: 'first', author: 'Tao', dateText: '2026-09-30 08:00', parents: [] },
  { hash: 'm', shortHash: 'm', isHead: false, subject: 'side', author: 'Tao', dateText: '2026-09-30 07:00', parents: ['c1'] },
]

test('文案逐条等于 VcsLogBundle', () => {
  assert.equal(GO_TO_CHILD_TITLE, '转到子提交', 'action.Vcs.Log.GoToChild.text')
  assert.equal(GO_TO_CHILD_DESCRIPTION, '导航到提交图中的子行', '同动作 .description')
  assert.equal(GO_TO_PARENT_TITLE, '转到父提交', 'action.Vcs.Log.GoToParent.text')
  assert.equal(GO_TO_PARENT_DESCRIPTION, '导航到提交图中的父行', '同动作 .description')
  assert.equal(goToCandidateText('c2', 'second', 'Tao', '2026-09-30 09:00'), 'c2 "second"，作者 Tao，2026-09-30 09:00',
    'action.go.to.select.hash.subject.author.date.time = {0} {1}，作者 {2}，{3} {4}')
})

test('相邻提交：父 = 它的 parents 里已加载的，子 = 已加载里以它为父的', () => {
  assert.deepEqual(adjacentCommits(graph, 'c2', true).map(c => c.hash), ['c1'], 'c2 的父是 c1')
  assert.deepEqual(adjacentCommits(graph, 'c1', false).map(c => c.hash), ['c2', 'm'], 'c1 的子有 c2 与 m（按列表/图上的顺序）')
  assert.deepEqual(adjacentCommits(graph, 'c2', false).map(c => c.hash), ['c3'], 'c2 的子是 c3')
  assert.deepEqual(adjacentCommits(graph, 'c3', true).map(c => c.hash), ['c2'])
  assert.deepEqual(adjacentCommits(graph, 'c1', true), [], '根提交没有父')
  assert.deepEqual(adjacentCommits(graph, 'c3', false), [], '还没有子（m 指向 c1）')
  assert.deepEqual(adjacentCommits(graph, 'unknown', true), [], '未知 hash 不猜')
  assert.deepEqual(adjacentCommits(graph, '', false), [])
})

test('菜单尾组：有候选才可用；多候选时每个候选补一行（上游那个带编号的弹层）', () => {
  const actions = { copy: noop, reset: noop, uncommit: noop, createTag: noop, goTo: noop }
  const onC3 = logCommitMenu({ ...graph[0] }, actions, graph)
  const childRow = onC3.find(row => row.id === 'goToChild')
  const parentRow = onC3.find(row => row.id === 'goToParent')
  assert.equal(childRow.disabled, true, 'c3 还没有子提交 ⇒ 灰着（上游 isEnabled = getRowsToJump 非空）')
  assert.equal(parentRow.disabled, false, 'c3 的父是 c2')
  const picked = []
  const onC1 = logCommitMenu({ ...graph[2] }, { ...actions, goTo: hash => picked.push(hash) }, graph)
  assert.equal(onC1.find(row => row.id === 'goToChild').disabled, false)
  assert.equal(onC1.find(row => row.id === 'goToParent').disabled, true)
  const extras = onC1.filter(row => /^Vcs\.Log\.GoToChild:/.test(row.id))
  assert.deepEqual(extras.map(row => row.id), ['Vcs.Log.GoToChild:c2', 'Vcs.Log.GoToChild:m'], '两个子候选各一行')
  assert.match(extras[0].title, /^c2 "second"，作者 Tao，/, '候选行用上游那条格式')
  extras[1].run?.()
  assert.deepEqual(picked, ['m'], '点候选行真的跳过去')
})

test('接线：日志视图把已加载的提交与 jump 交给模型（跳转走既有的 navigate 那条路）', () => {
  const view = read('src/components/VcsLog.vue')
  assert.match(view, /logCommitMenu\(/, '菜单来自模型')
  assert.match(view, /commits\.value\.map\(c => \(\{ hash: c\.hash, shortHash: c\.shortHash, isHead: false/, '把已加载的提交整份给模型')
  assert.match(view, /goTo: hash => \{ closeMenu\(\); void jump\(hash\) \}/, '跳到某提交 = 既有的 jump')
})
