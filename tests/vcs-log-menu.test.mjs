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
import { logCommitMenu, logRefMenu, COPY_REVISION_TITLE, COPY_REVISION_DESCRIPTION, RESET_TO_HERE_TITLE,
  UNCOMMIT_TITLE, UNCOMMIT_DESCRIPTION, UNCOMMIT_DISABLED_DESCRIPTION, CREATE_TAG_TITLE, CREATE_TAG_DESCRIPTION,
  DELETE_REF_TITLE } from '../src/vcsLogMenu.ts'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const read = relative => readFileSync(join(root, relative), 'utf8')
const head = { hash: 'a'.repeat(40), shortHash: 'aaaaaaaa', isHead: true }
const older = { hash: 'b'.repeat(40), shortHash: 'bbbbbbbb', isHead: false }
const noop = () => {}

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

test('行序照上游：复制修订号 ─ 重置到此处 ─ 撤消提交 ─ 新建标记', () => {
  const rows = logCommitMenu(head, { copy: noop, reset: noop, uncommit: noop, createTag: noop })
  assert.deepEqual(rows.map(row => row.action), [
    'Vcs.CopyRevisionNumberAction', 'Git.Reset.In.Log', 'Git.Uncommit', 'Git.CreateNewTag',
  ])
  assert.deepEqual(rows.map(row => Boolean(row.separatorBefore)), [false, true, false, true], '分隔线照上游那两处')
})

test('「撤消提交」只对当前分支的最后一个提交可用（GitUncommitAction.update 的 isHeadCommit）', () => {
  const actions = { copy: noop, reset: noop, uncommit: noop, createTag: noop }
  const onHead = logCommitMenu(head, actions).find(row => row.id === 'uncommit')
  assert.equal(onHead.disabled, false, 'HEAD 上可用')
  const onOlder = logCommitMenu(older, actions).find(row => row.id === 'uncommit')
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
  assert.match(table, /@contextmenu\.prevent\.stop="emit\('refMenu'/, '引用 chip 上挂右键')
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
