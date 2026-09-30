// Git 日志窗口里**提交行的右键菜单** —— 上游平台组 `Vcs.Log.ContextMenu`
// （`platform/vcs-log/impl/resources/intellij.platform.vcs.log.impl.xml:274-284`）与 Git 追加的那一组
// `Git.Log.ContextMenu`（`plugins/git4idea/backend/resources/intellij.vcs.git.backend.xml:400-428`，
// 用 `add-to-group group-id="Vcs.Log.ContextMenu" relative-to-action="Vcs.Log.GoToChild" anchor="before"`
// 插在「跳到子提交」之前）。
//
// 上游顺序（两组合起来，本仓有落点的打 ✅）：
//
//   [platform] `Vcs.CopyRevisionNumberAction`  复制修订号                      ✅ 本仓的复制哈希
//              `ChangesView.CreatePatchFromChanges` 从变更创建补丁…            ❌ 本仓没有补丁后端
//              ─
//              `Vcs.Log.CompareRevisions` 比较版本                              ❌ 本仓的 compare 是"分支→工作区"，没有"提交↔提交"
//              `Vcs.ShowDiffWithLocal` 与本地比较                               ❌ 同上（`git.showCommit` 只出单侧内容）
//              ─
//   [git]      `Git.Reset.In.Log` 将当前分支重置到此处…                        ✅ `git.reset`（模式照上游那三档）
//              `Git.Revert.In.Log` 还原提交                                    ❌ 本仓的 `git.revert` 是"丢弃工作区改动"（IDEA 的 Rollback），没有 `git revert <commit>`
//              `Git.Uncommit` 撤消提交…                                        ✅ `git.reset --soft HEAD~1`；**只对当前分支最后一个提交可用**（`GitUncommitAction.update` 的 `isHeadCommit()`）
//              ─
//              `Git.Reword.Commit` / `Git.Fixup.To.Commit` / `Git.Squash.Into.Commit` /
//              `Git.Drop.Commits` / `Git.Squash.Commits` / `Git.Interactive.Rebase` / `Git.PushUpToCommit`
//                                                                              ❌ 全都建立在交互式变基上，本仓没有那条链路
//              ─
//              `Git.BranchOperationGroup` / `Git.CreateNewBranch.FromCommit`    ❌ 需要一个"以某次提交为起点"的分支操作（本仓 `git.branch.create` 只从 HEAD 开）
//              `Git.CreateNewTag` 新建标记…                                    ✅ `git.tag.create` 带 `target`（原生按 `checked_ref` 校验）
//              ─
//   [platform] `Vcs.Log.GoToChild` / `Vcs.Log.GoToParent` 跳到子/父提交         ❌ 本仓的导航是"后退/前进"历史（`canBack`/`travel`），不是图的父子
//
// 文案全部取随 IDE 发货的中文包（key 见每条常量），逐条可核。
export interface LogMenuCommit {
  hash: string
  shortHash: string
  /** 是不是当前分支的最后一个提交（`GitUncommitAction.update` 的 `isHeadCommit()`）。 */
  isHead: boolean
}

export interface LogMenuRow {
  id: string
  /** 上游动作 id（写在这里，免得以后有人凭手感改文案）。 */
  action: string
  title: string
  description?: string
  /** 行前有分隔线（照上游分组）。 */
  separatorBefore?: boolean
  disabled?: boolean
  run?: () => void
}

/** `action.Vcs.CopyRevisionNumberAction.text` / `.description`。 */
export const COPY_REVISION_TITLE = '复制修订号'
export const COPY_REVISION_DESCRIPTION = '将选定提交的修订号复制到剪贴板'
/** `action.Git.Reset.In.Log.text`（`GitBundle.properties`）。 */
export const RESET_TO_HERE_TITLE = '将当前分支重置到此处…'
/** `action.Git.Uncommit.text` / `.description`；后半句是**不可用**时的说明（`git.undo.action.description`）。 */
export const UNCOMMIT_TITLE = '撤消提交…'
export const UNCOMMIT_DESCRIPTION = '撤消最后一次提交并将其更改放入所选更改列表'
export const UNCOMMIT_DISABLED_DESCRIPTION = '所选提交不是当前分支中的最后一次提交'
/** `action.Git.CreateNewTag.text` / `.description`（包里就是「标记」，不是「标签」）。 */
export const CREATE_TAG_TITLE = '新建标记…'
export const CREATE_TAG_DESCRIPTION = '创建指向此提交的新标签'

export interface LogMenuActions {
  copy: () => void
  reset: () => void
  uncommit: () => void
  createTag: () => void
}

/** 按上游顺序给出这一行的菜单（只给有落点的四条，其余在上面的注释里逐条记了原因）。 */
export function logCommitMenu(commit: LogMenuCommit, actions: LogMenuActions): LogMenuRow[] {
  return [
    { id: 'copyRevision', action: 'Vcs.CopyRevisionNumberAction', title: COPY_REVISION_TITLE, description: COPY_REVISION_DESCRIPTION, run: actions.copy },
    { id: 'reset', action: 'Git.Reset.In.Log', title: RESET_TO_HERE_TITLE, separatorBefore: true, run: actions.reset },
    {
      id: 'uncommit', action: 'Git.Uncommit', title: UNCOMMIT_TITLE,
      description: commit.isHead ? UNCOMMIT_DESCRIPTION : UNCOMMIT_DISABLED_DESCRIPTION,
      disabled: !commit.isHead, run: actions.uncommit,
    },
    { id: 'createTag', action: 'Git.CreateNewTag', title: CREATE_TAG_TITLE, description: CREATE_TAG_DESCRIPTION, separatorBefore: true, run: actions.createTag },
  ]
}

/** `GitBundle` `branches.action.delete` = 删除(&D)（`GitDeleteRefAction` 的文案，用于分支/远端分支/标签）。 */
export const DELETE_REF_TITLE = '删除'

export type RefType = 'local' | 'remote' | 'tag' | 'head'

export interface LogMenuRef {
  name: string
  type: RefType
}

export interface LogRefMenuActions {
  deleteTag: (name: string) => void
}

/**
 * 右键一个**引用 chip**（日志行上的分支/标签小标签）时的菜单。上游是 `Git.Branch.Backend`
 * （`intellij.vcs.git.backend.xml:320-344`）那一族按引用类型过滤后的子集，其中
 * `GitDeleteRefAction`（`:341-343`，`use-shortcut-of="$Delete"`）对标签走 `brancher.deleteTag`。
 *
 * 本仓只给**标签**这一列（§17 的最后一条：面板里那条自造的"新标签名 + chips + 删除"要拆掉，
 * 删除得有个上游位置）。其余类型的落点：
 *   · 分支（local）：`Git.Branch.Backend` 那一族本仓在**分支弹窗**里已有（`src/branchPopup.ts` 的
 *     `BRANCH_ROW_ACTIONS`：checkout / compare / rebase / merge / push / delete），不在这里重复；
 *   · 远端分支：本仓没有 `deleteRemoteBranch` 的原生落点（只有 `git.push`）；
 *   · `head`：不是可操作对象（它就是 HEAD）。
 * 标签那一列里上游还有「推送标签」（`Git.Tag.Push`）与「与本地比较」（`Git.Ref.Diff.With.Local`）：
 * 前者要原生 `push <tag>`（只有 `git.push` = 推当前分支），后者要"引用↔工作区"的 diff 视图 —— 都还没落。
 */
export function logRefMenu(ref: LogMenuRef, actions: LogRefMenuActions): LogMenuRow[] {
  if (ref.type !== 'tag') return []
  return [{
    id: 'deleteRef', action: 'GitDeleteRefAction', title: DELETE_REF_TITLE,
    description: `删除标签 ${ref.name}`, run: () => actions.deleteTag(ref.name),
  }]
}
