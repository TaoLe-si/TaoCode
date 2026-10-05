// 提交面板「变更」行的右键菜单（上游 `ChangesViewPopupMenu`，`VcsActions.xml:185-216`）。
import { APPLY_NON_CONFLICTS_TEXT, RESOLVE_SIMPLE_CONFLICTS_TEXT } from './mergeResolve.ts'
//
// 上游那一组的行序（逐条抄自源码）：
//   CheckinFiles · ChangesView.Revert · ChangesView.RevertFiles · ChangesView.Move ·
//   Diff.ShowDiff · Diff.ShowStandaloneDiff · ChangesView.EditSource ·（CopyReferencePopupGroup）·
//   —— · $Delete · ChangesView.AddUnversioned · ChangesView.RemoveDeleted · ChangesView.Edit ·
//   —— ·（更改列表四项）· CreatePatch · CreatePatchToClipboard · Shelve · —— · ChangesView.Refresh ·
//   —— · VersionControlsGroup
//
// 文案取随 IDE 发货的中文包 `ActionsBundle.properties`（键写在下面每一行旁边）。
// 上游文案里的助记符标记（`(_R)`）在本仓一律去掉 —— 菜单行的助记符由 `menuUi` 的 mnemonic 机制管，
// 不写在标题里（与既有菜单行一致）。
//
// **本仓只列真有的动作**（不放假菜单项），缺的逐条记在 `docs/ui-parity-checklist.md` 批 111：
//   · `ChangesView.Edit`（签出）：那是 Perforce 那类"只读文件先签出"的语义，git 下没有；
//   · 更改列表四项 / `ChangesView.Move`：本仓没有更改列表（changelist）这一层；
//   · `CreatePatch` / `CreatePatchToClipboard`：补丁导出还没做（`src/diffText.ts` 有 unified 文本，
//     但"整批变更 → 补丁文件/剪贴板"这条链没有）；
//   · `Shelve`：本仓的搁置在 Git 菜单里（`git.stash.save`），面板这一行没接；
//   · 忽略文件那一档的两条（从忽略列表移除 / 强制加入 VCS）：要 `.gitignore` 的编辑与 `git add -f`，
//     本仓的 `git.stage` 走的是普通 `git add`（对忽略文件会失败）—— 留作缺口，不摆会失败的菜单项；
//   · 补丁那两条本批（第一百一十四批）已落：`patch` = `git diff HEAD`（暂存 + 未暂存一起）落成 `.patch` 文件，
//     `patchClipboard` = 同一份文本进剪贴板。**未跟踪的文件不在补丁里**（git 的 diff 不认它们，
//     上游 `CreatePatchFromChangesAction` 会把它们当新文件加进去）—— 如实记作缺口；
//   · `Diff.ShowStandaloneDiff` / `ChangesView.EditSource`：都要宿主的"开标签页"通道，面板当前只 emit `notify`。
//   · 冲突那一档（上游 git4idea 的 `Git.ChangesView.Conflicts`，`intellij.vcs.git.backend.xml:482-489`，
//     `anchor="first"` 挂在 `ChangesViewPopupMenu` 最上面）：上游三条是「合并…」「接受他们的更改」
//     「接受您的更改」。**「合并…」不摆** —— 它在那边是打开三方合并窗口（`GitMergeConflictAction`
//     → `GitConflictsUtil.showMergeWindow`），本仓没有那张窗口，摆出来就是点了没反应的假控件。
//     另两条（整文件接受一侧）本批接了（`src/mergeResolveHost.ts` 的 `acceptConflictSide`），
//     后面两条是合并窗口工具栏那两个动作（`Diff.MagicResolveConflicts` / `Diff.ApplyNonConflicts`），
//     落到本仓的等价物是"把能自动合的合掉"（`src/mergeResolve.ts`）。

/** 一个变更（够菜单判可见性用）。 */
export interface ChangesMenuTarget { staged?: boolean; untracked?: boolean; ignored?: boolean; conflicted?: boolean }

/**
 * 这个变更是不是「未合并」（上游 `FileStatus.MERGED_WITH_CONFLICTS`，
 * `plugins/git4idea/backend/src/status/GitChangesCollector.java:275`）。
 *
 * 判定表照那棵树里 `reportConflict` 的全部落点抄：工作区侧是 `U`（`:103`）、`AU`/`AA`（`:134-139`）、
 * `DU`/`DD`（`:148-152`）、`UU`/`UA`/`UD`（`:168-176`）、`RT`（`:201`）。
 * 本仓不需要新的宿主字段：`git status --porcelain` 的 X/Y 两列已经在 `GitChange` 上
 * （`src/vcsLogTypes.ts:3`），这里纯前端算。
 */
export function isConflictedStatus(indexStatus: string, workStatus: string): boolean {
  if (workStatus === 'U' || indexStatus === 'U') return true
  if (indexStatus === 'A' && workStatus === 'A') return true
  if (indexStatus === 'D' && workStatus === 'D') return true
  return indexStatus === 'R' && workStatus === 'T'
}

export interface ChangesMenuRow {
  id: string
  /** 菜单行文案（上游 `action.*.text`，去掉助记符）。 */
  label: string
}

/** 与上游同序的行表；`available` 决定这一条在当前变更上出不出现。 */
export const CHANGES_MENU_ROWS: readonly (ChangesMenuRow & { available: (change: ChangesMenuTarget) => boolean })[] = [
  // 冲突那一档排在**最前**（上游 `Git.ChangesView.Conflicts` 的 `anchor="first"`）。上游第一条是
  // 「合并…」（开三方窗口），本仓没有那张窗口故不列 —— 见文件头的缺口说明。
  { id: 'acceptTheirs', label: '接受他们的更改', available: c => Boolean(c.conflicted) },           // conflicts.accept.theirs.action.text（GitBundle.properties:1541）
  { id: 'acceptYours', label: '接受您的更改', available: c => Boolean(c.conflicted) },              // conflicts.accept.yours.action.text（GitBundle.properties:1542）
  { id: 'resolveConflicts', label: RESOLVE_SIMPLE_CONFLICTS_TEXT, available: c => Boolean(c.conflicted) }, // action.Diff.MagicResolveConflicts.text
  { id: 'applyNonConflicts', label: APPLY_NON_CONFLICTS_TEXT, available: c => Boolean(c.conflicted) },      // action.Diff.ApplyNonConflicts.text
  { id: 'diff', label: '显示差异', available: () => true },                                  // action.Diff.ShowDiff.text:456
  { id: 'copyPath', label: '复制路径/引用…', available: () => true },                          // group.CopyReferencePopupGroup.text:2561
  // 忽略的文件：git 对它们没有 diff、`git add` 也不收（要 `-f`），所以这一档只有"看 + 复制 + 刷新"。
  // 上游那两条（从忽略列表移除 / 强制加入 VCS）本仓没有，理由写在本文件头的缺口清单里。
  { id: 'revert', label: '回滚…', available: c => !c.staged && !c.untracked && !c.ignored },    // action.ChangesView.Revert.text:153
  { id: 'stage', label: '暂存', available: c => !c.staged && !c.ignored },                     // 上游提交面板的暂存/取消暂存一对
  { id: 'unstage', label: '取消暂存', available: c => Boolean(c.staged) },
  { id: 'addToVcs', label: '添加到 VCS', available: c => Boolean(c.untracked) },               // action.ChangesView.AddUnversioned.text:119
  { id: 'ignore', label: '加入 .gitignore', available: c => Boolean(c.untracked) },            // 上游 VersionControlsGroup › 忽略
  // 补丁那两条（上游 `:208-211` 的 `CreatePatch` / `CreatePatchToClipboard`，在更改列表四项之后、
  // Shelve 之前 —— 本仓没有更改列表那一层，所以它们直接跟在忽略那一档后面）。
  { id: 'patch', label: '从本地更改创建补丁…', available: c => !c.ignored },                    // action.ChangesView.CreatePatch.text:127
  { id: 'patchClipboard', label: '作为补丁复制到剪贴板', available: c => !c.ignored },          // action.ChangesView.CreatePatchToClipboard.text:131
  // 补丁的**应用**那两条（上游 `VcsActions.xml:110-111` 与创建那两条同组，右键菜单 `:572-573` 里
  // 也是这个顺序）：`ApplyPatchAction` / `ApplyPatchFromClipboardAction`。
  { id: 'applyPatch', label: '应用补丁…', available: () => true },                             // action.ChangesView.ApplyPatch.text:1566
  { id: 'applyPatchClipboard', label: '从剪贴板应用补丁', available: () => true },              // action.ChangesView.ApplyPatchFromClipboard.text:1568
  { id: 'refresh', label: '刷新', available: () => true },                                    // action.ChangesView.Refresh.text:144
]

/** 当前变更上应该出现的行（顺序与上游一致）。 */
export function changesMenuRows(change: ChangesMenuTarget): ChangesMenuRow[] {
  return CHANGES_MENU_ROWS.filter(row => row.available(change)).map(({ id, label }) => ({ id, label }))
}
