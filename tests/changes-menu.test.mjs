// 提交面板「变更」行的右键菜单（上游 `ChangesViewPopupMenu`，`VcsActions.xml:185-216`）。
//
// 上游那一组的行序（逐条抄过）：CheckinFiles · ChangesView.Revert · RevertFiles · Move ·
// Diff.ShowDiff · ShowStandaloneDiff · EditSource ·（CopyReferencePopupGroup）· —— · $Delete ·
// AddUnversioned · RemoveDeleted · Edit · —— ·（更改列表四项）· CreatePatch · CreatePatchToClipboard ·
// Shelve · —— · ChangesView.Refresh · —— · VersionControlsGroup
//
// 本仓的取舍（只列真有的动作，缺的逐条记在清单批 111）：
//   · 有：显示差异 · 复制路径/引用… · 回滚… · 暂存 / 取消暂存 · 添加到 VCS · 加入 .gitignore ·
//     从本地更改创建补丁… · 作为补丁复制到剪贴板 · 应用补丁… · 从剪贴板应用补丁 · 刷新；
//   · 缺：签出（Perforce 语义）、更改列表四项与"移到另一个更改列表"（本仓没有 changelist 这一层）、
//     搁置（本仓在 Git 菜单里）、在新标签页显示差异与跳转到源（都要宿主的"开标签页"通道，
//     面板当前只 emit notify）。
// 文案取随 IDE 发货的中文包 `ActionsBundle.properties`（键注在每一行旁），助记符标记去掉。
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { CHANGES_MENU_ROWS, changesMenuRows } from '../src/changesMenuActions.ts'

const read = rel => readFileSync(new URL(`../${rel}`, import.meta.url), 'utf8')

test('a tracked unstaged file gets diff / revert / stage / patch / refresh', () => {
  assert.deepEqual(changesMenuRows({ staged: false, untracked: false }).map(r => r.id),
    ['diff', 'copyPath', 'revert', 'stage', 'patch', 'patchClipboard', 'applyPatch', 'applyPatchClipboard', 'refresh'])
})

test('an untracked file gets add-to-VCS and ignore instead of revert', () => {
  assert.deepEqual(changesMenuRows({ staged: false, untracked: true }).map(r => r.id),
    ['diff', 'copyPath', 'stage', 'addToVcs', 'ignore', 'patch', 'patchClipboard', 'applyPatch', 'applyPatchClipboard', 'refresh'])
})

test('a staged file gets unstage instead of stage', () => {
  assert.deepEqual(changesMenuRows({ staged: true }).map(r => r.id),
    ['diff', 'copyPath', 'unstage', 'patch', 'patchClipboard', 'applyPatch', 'applyPatchClipboard', 'refresh'])
})

test('the labels are the shipped Chinese ones (mnemonics stripped)', () => {
  // 回滚只对有版本的文件出现，所以取"未暂存且非未跟踪"这一组来查它的文案。
  const labels = Object.fromEntries(changesMenuRows({ staged: false, untracked: true }).map(r => [r.id, r.label]))
  const tracked = Object.fromEntries(changesMenuRows({ staged: false }).map(r => [r.id, r.label]))
  assert.equal(labels.diff, '显示差异', 'ActionsBundle.properties:456 action.Diff.ShowDiff.text')
  assert.equal(tracked.revert, '回滚…', ':153 action.ChangesView.Revert.text 去掉助记符 (_R)')
  assert.equal(labels.addToVcs, '添加到 VCS', ':119 action.ChangesView.AddUnversioned.text')
  assert.equal(labels.refresh, '刷新', ':144 action.ChangesView.Refresh.text')
  assert.equal(labels.copyPath, '复制路径/引用…', 'ActionsBundle.properties:2561')
  assert.ok(!JSON.stringify(labels).includes('(_'), '助记符标记不许进标题')
})

test('the row order follows the upstream group', () => {
  const ids = CHANGES_MENU_ROWS.map(r => r.id)
  assert.ok(ids.indexOf('diff') < ids.indexOf('copyPath'), 'CopyReferencePopupGroup 在 ShowDiff 之后')
  assert.ok(ids.indexOf('copyPath') < ids.indexOf('revert'), '回滚在复制组之后')
  assert.ok(ids.indexOf('refresh') === ids.length - 1, '刷新是最后一条')
})

// —— 接线 ——

test('every row id the panel dispatches has a handler', () => {
  const panel = read('src/components/SourceControl.vue')
  for (const id of ['diff', 'revert', 'stage', 'unstage', 'addToVcs', 'ignore', 'applyPatch', 'applyPatchClipboard', 'refresh'])
    assert.match(panel, new RegExp(`case '${id}':`), `面板没有处理 ${id}`)
  assert.match(panel, /row\.id\.startsWith\('copyPath\.'\)/, '复制那一组按前缀分派')
})

test('the menu is opened from the change rows and closed by the backdrop', () => {
  const panel = read('src/components/SourceControl.vue')
  assert.equal((panel.match(/@contextmenu\.prevent="openRowMenu\(\$event, change\)"/g) ?? []).length, 2,
    '已暂存与未暂存两组行都要能右键')
  assert.match(panel, /<div v-if="rowMenu" class="tree-menu-backdrop" @pointerdown="rowMenu = null"/)
  assert.match(panel, /<AnchoredMenu :x="rowMenu\.x" :y="rowMenu\.y"/)
})

test('the copy group copies through the central clipboard helper', () => {
  const panel = read('src/components/SourceControl.vue')
  assert.match(panel, /copyPathMenuRows\(\{/)
  assert.match(panel, /copy: \(text: string\) => void copyToClipboard\(text\)/)
  // 真机抓到的：`pickRowMenu` 先把 `rowMenu` 清空，再去读依赖它的 `rowCopyRows` computed ——
  // 拿到的永远是"没有目标 ⇒ 禁用"，点了复制什么都没进剪贴板。复制要走**存下来的** `menu`。
  assert.match(panel, /findResultClipboardText\(action, \{ path, line: 1 \}, props\.root\)/)
  const pick = panel.slice(panel.indexOf('function pickRowMenu'), panel.indexOf('function pickRowMenu') + 900)
  assert.ok(!pick.includes('rowCopyRows.value'), '复制那一支不许再读 rowCopyRows.value（它的输入已被清空）')
})


test('an ignored file only gets diff / copy / apply / refresh (git cannot stage it)', () => {
  // git 对忽略的文件没有 diff、普通 `git add` 也不收 —— 菜单里不摆**按这个文件**会失败的那几条。
  // 两条补丁应用是项目级动作（上游 `ChangesViewPopupMenu` 里它们跟着通用行出现，跟选中哪个文件无关），
  // 所以对忽略的文件也照常出现；stage/revert/ignore 这类按文件的仍不出现。
  assert.deepEqual(changesMenuRows({ staged: false, ignored: true }).map(r => r.id),
    ['diff', 'copyPath', 'applyPatch', 'applyPatchClipboard', 'refresh'])
  // `staged + ignored` 是个**不可能的组合**（git 的 `!!` 记录永远是未跟踪/未暂存那一侧），
  // 所以不拿它当判据 —— 断言一个到不了的状态只会给人"这条管着什么"的错觉。
  assert.ok(!changesMenuRows({ ignored: true }).some(r => r.id === 'stage' || r.id === 'revert' || r.id === 'ignore'))
})

// —— 第一百一十四批：补丁那两条（`ChangesView.CreatePatch` / `CreatePatchToClipboard`）——

test('every change offers the two patch rows, ignored files do not', () => {
  const tracked = changesMenuRows({ staged: false }).map(r => r.id)
  assert.ok(tracked.includes('patch') && tracked.includes('patchClipboard'), '有版本的文件要有补丁两条')
  assert.ok(tracked.indexOf('patch') < tracked.indexOf('refresh'), '补丁在「刷新」之前（上游 :208-211 也是这一带）')
  const ignored = changesMenuRows({ ignored: true }).map(r => r.id)
  assert.ok(!ignored.includes('patch') && !ignored.includes('patchClipboard'), '忽略的文件不给补丁（git 也不认）')
})

test('the patch labels are the shipped Chinese ones', () => {
  const labels = Object.fromEntries(changesMenuRows({ staged: false }).map(r => [r.id, r.label]))
  assert.equal(labels.patch, '从本地更改创建补丁…', 'ActionsBundle.properties:127')
  assert.equal(labels.patchClipboard, '作为补丁复制到剪贴板', ':131')
})
