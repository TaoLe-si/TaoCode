// 提交面板「变更」行的右键菜单（上游 `ChangesViewPopupMenu`，`VcsActions.xml:185-216`）。
//
// 上游那一组的行序（逐条抄过）：CheckinFiles · ChangesView.Revert · RevertFiles · Move ·
// Diff.ShowDiff · ShowStandaloneDiff · EditSource ·（CopyReferencePopupGroup）· —— · $Delete ·
// AddUnversioned · RemoveDeleted · Edit · —— ·（更改列表四项）· CreatePatch · CreatePatchToClipboard ·
// Shelve · —— · ChangesView.Refresh · —— · VersionControlsGroup
//
// 本仓的取舍（只列真有的动作，缺的逐条记在清单批 111）：
//   · 有：提交文件… · 显示差异 · 复制路径/引用… · 回滚… · 暂存 / 取消暂存 · 添加到 VCS ·
//     加入 .gitignore · 从本地更改创建补丁… · 作为补丁复制到剪贴板 · 应用补丁… ·
//     从剪贴板应用补丁 · 刷新；
//   · 缺：签出（Perforce 语义）、更改列表的**新建/重命名/删除/设为默认**四项（那四项在上游是
//     `ChangesView.Changelists` 组里的动作，落在本仓面板的**变更列表选择器那一行**，
//     见 src/changeListSection.ts；菜单里只留「移到其他变更列表…」这一条 = `ChangesView.Move`）、
//     搁置（本仓在 Git 菜单里）、在新标签页显示差异与跳转到源（都要宿主的"开标签页"通道，
//     面板当前只 emit notify）。
// 文案取随 IDE 发货的中文包 `ActionsBundle.properties`（键注在每一行旁），助记符标记去掉。
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { CHANGES_MENU_ROWS, changesMenuRows } from '../src/changesMenuActions.ts'

const read = rel => readFileSync(new URL(`../${rel}`, import.meta.url), 'utf8')

// 首行是 `commitFile`（上游 `VcsActions.xml:187` 的 `CheckinFiles` 挂在组最上面，
// `CommonCheckinFilesAction.kt:37-53` 把选中路径设成这次提交的范围）—— 面板真在分派它
// （`src/components/SourceControl.vue` 的 `case 'commitFile': return setCommitScope(path)`），
// 忽略的文件不给（`CommonCheckinFilesAction.kt:75-78` 的 `isActionEnabled`）。
test('a tracked unstaged file gets commit-file / diff / revert / stage / patch / refresh', () => {
  assert.deepEqual(changesMenuRows({ staged: false, untracked: false }).map(r => r.id),
    ['commitFile', 'moveToChangeList', 'diff', 'copyPath', 'revert', 'stage', 'patch', 'patchClipboard', 'applyPatch', 'applyPatchClipboard', 'refresh'])
})

test('an untracked file gets commit-file, then add-to-VCS and ignore instead of revert', () => {
  assert.deepEqual(changesMenuRows({ staged: false, untracked: true }).map(r => r.id),
    ['commitFile', 'moveToChangeList', 'diff', 'copyPath', 'stage', 'addToVcs', 'ignore', 'patch', 'patchClipboard', 'applyPatch', 'applyPatchClipboard', 'refresh'])
})

test('a staged file gets unstage instead of stage', () => {
  assert.deepEqual(changesMenuRows({ staged: true }).map(r => r.id),
    ['commitFile', 'moveToChangeList', 'diff', 'copyPath', 'unstage', 'patch', 'patchClipboard', 'applyPatch', 'applyPatchClipboard', 'refresh'])
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

// —— merge3（2026-10-06）：两条自动合并动作的启用条件按**内容**判 ——
// 上游 `MagicResolvedConflictsAction.kt:17` 的 `setEnabled(viewer.model.hasAutoResolvableConflictedChanges())`
// 与 `ApplyNonConflictsAction.kt:31` 的 `setEnabled(viewer.model.hasNonConflictedChanges(side))`：
// 一处都合不掉时那颗按钮是**灰的**，不是"可点 + 事后提示"。
// 本仓的内容侧事实由 `src/mergeResolveHost.ts` 的 `conflictResolutionAvailability` 读一次文件算出，
// 落到菜单行的 `enabled` 上（`src/components/SourceControl.vue` 的 `:disabled="row.enabled === false"`）。
import { hasAutoResolvableBlock, hasNonConflictingBlock } from '../src/mergeResolve.ts'
import { conflictResolutionAvailability } from '../src/mergeResolveHost.ts'

const conflictBlock = (ours, theirs, base) => [
  '<<<<<<< HEAD', ...ours,
  ...(base ? ['||||||| merged common ancestors', ...base] : []),
  '=======', ...theirs, '>>>>>>> feature',
].join('\n')

test('内容侧判据：能自动合的块 vs 真冲突（照 MergeConflictModel.kt:146-152）', () => {
  // diff3 风格：ours 与 base 相同、theirs 改了 ⇒ 能自动合，且属于"不冲突"那一类。
  const oneSided = conflictBlock(['base'], ['changed'], ['base'])
  assert.equal(hasAutoResolvableBlock(oneSided), true, '一侧没动 ⇒ 能自动合')
  assert.equal(hasNonConflictingBlock(oneSided), true, '同一块也属于 hasNonConflictedChanges')
  // 两侧都改得不一样 ⇒ 真冲突：两条都不给。
  const real = conflictBlock(['ours'], ['theirs'], ['base'])
  assert.equal(hasAutoResolvableBlock(real), false, '真冲突 ⇒ 合不掉')
  assert.equal(hasNonConflictingBlock(real), false, '真冲突 ⇒ 不属于"不冲突"那一类')
  // 两侧改成一模一样 ⇒ 能合（取任一侧），也是"不冲突"。
  const same = conflictBlock(['same'], ['same'], ['base'])
  assert.equal(hasAutoResolvableBlock(same), true)
  assert.equal(hasNonConflictingBlock(same), true)
})

test('菜单行：enabled 缺省为真，内容判为 false 时那两条灰掉', () => {
  // 还没读内容（undefined）⇒ 保持可点，不误灰。
  const pending = Object.fromEntries(changesMenuRows({ conflicted: true }).map(r => [r.id, r.enabled]))
  assert.equal(pending.resolveConflicts, true, '内容没读回来之前可点（不把"没读"当"没有"）')
  assert.equal(pending.applyNonConflicts, true)
  // 读回来发现没有可自动合的块 ⇒ 两条都灰。
  const blocked = Object.fromEntries(changesMenuRows({ conflicted: true, autoResolvable: false, nonConflicting: false }).map(r => [r.id, r.enabled]))
  assert.equal(blocked.resolveConflicts, false, '一处都合不掉 ⇒ 灰（上游 setEnabled）')
  assert.equal(blocked.applyNonConflicts, false)
  // 有可自动合的块 ⇒ 两条都亮。
  const open = Object.fromEntries(changesMenuRows({ conflicted: true, autoResolvable: true, nonConflicting: true }).map(r => [r.id, r.enabled]))
  assert.equal(open.resolveConflicts, true)
  assert.equal(open.applyNonConflicts, true)
  // 非冲突行不受影响（`enabled` 缺省 true）。
  assert.equal(changesMenuRows({ staged: false }).every(r => r.enabled !== false), true)
})

test('组装层真读内容：SourceControl 打开冲突行的菜单时问一次 availability，并绑到 :disabled', () => {
  const panel = read('src/components/SourceControl.vue')
  assert.match(panel, /conflictResolutionAvailability/, '面板要 import 并用这个判据')
  assert.match(panel, /if \(!conflicted\) return\n\s*const token = \+\+rowMenuToken/, '只对冲突行问一次（非冲突行不问）')
  assert.match(panel, /Object\.assign\(rowMenu\.value\.change, availability\)/, '把内容判据落进菜单目标')
  assert.match(panel, /<button v-else role="menuitem" :disabled="row\.enabled === false"/, '菜单行绑 :disabled')
  const host = read('src/mergeResolveHost.ts')
  assert.match(host, /export async function conflictResolutionAvailability/, '判据实现在宿主链模块里')
  assert.match(host, /if \(!conflictsIn\(content\)\.length\) return \{\}/, '没有冲突标记就不给内容判据（保持可点）')
})

