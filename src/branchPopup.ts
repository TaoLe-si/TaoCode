// 分支弹窗的纯逻辑（IDEA `GitBranchesPopup` + `main.toolbar.git.Branches` widget）。
//
// 逐条对照的源码：
//   plugins/git4idea/shared/src/com/intellij/vcs/git/branch/popup/GitBranchesPopup.kt
//     弹窗本体：顶部 speed-search 输入框 + 顶层动作区 + 分支树（本地/远端分组）
//   .../GitBranchesPopupActions.kt   动作组 id：`Git.Branches.List`（顶层）、`Git.Branches.Popup.SpeedSearch`
//   plugins/git4idea/backend/resources/intellij.vcs.git.backend.xml:303-333
//     顶层 `Git.Branches.List` = GitHub 上的：`Git.CreateNewBranch` / `Git.CreateNewWorkingTree` /
//     `GitCheckoutFromInputAction`（外加正在进行的 rebase 动作组）
//     分支行 `Git.Branch.Backend` = `Git.Ref.Compare.With` / `Git.Ref.Diff.With.Local` /
//     `GitRebaseBranchAction` / `GitMergeRefAction` / `GitUpdateSelectedBranchAction` /
//     `GitPushBranchAction`（+ 删除/重命名等由 ref 动作提供）
//
// 哪些动作在 TaoCode 有真实落点：检出（git.checkout）、新建分支（git.branch.create）、
// 删除（git.branch.delete）、比较（git.compare）、变基（git.rebase）、合并（git.merge）、
// 推送（git.push）。**重命名 / 更新选中分支 / 工作树动作**在原生侧没有对应命令，登记在
// docs/class-parity-todo.md，不渲染假按钮。

/** 弹窗里的一个动作：`ideaAction` 是它在 IDEA 里的动作 id 或类名，便于回溯。 */
export interface BranchAction {
  id: string
  title: string
  ideaAction: string
}

/** 顶层动作区（`Git.Branches.List`）。 */
export const BRANCH_TOP_ACTIONS: readonly BranchAction[] = [
  { id: 'create', title: '新建分支…', ideaAction: 'Git.CreateNewBranch' },
  { id: 'checkoutInput', title: '从输入检出…', ideaAction: 'GitCheckoutFromInputAction' },
]

/** 每个分支行上的动作（`Git.Branch.Backend` 的子集，只列有原生落点的）。 */
export const BRANCH_ROW_ACTIONS: readonly BranchAction[] = [
  { id: 'checkout', title: '检出', ideaAction: 'GitCheckoutAction' },
  { id: 'compare', title: '与当前分支比较…', ideaAction: 'Git.Ref.Compare.With' },
  { id: 'rebase', title: '将当前分支变基到所选分支', ideaAction: 'GitRebaseBranchAction' },
  { id: 'merge', title: '将所选分支合并到当前分支', ideaAction: 'GitMergeRefAction' },
  { id: 'push', title: '推送所选分支', ideaAction: 'GitPushBranchAction' },
  { id: 'delete', title: '删除', ideaAction: 'Git.Delete.Branch' },
]

/**
 * 排序：当前分支置顶，其余按名字（`GitBranchesPopupBase` 把当前分支单独标出并排在前面）。
 * 用 `localeCompare` 的 numeric 选项，`v1.9` 排在 `v1.10` 前（IDEA 用自然序）。
 */
export function sortBranches(branches: readonly string[], current: string): string[] {
  return [...branches].sort((a, b) => {
    if (a === current) return -1
    if (b === current) return 1
    return a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' })
  })
}

/**
 * speed search（`GitBranchesPopupBase.kt:352` 装的就是平台的 `SpeedSearch`）：忽略大小写的子串匹配，
 * 先按「匹配位置靠前」再按「名字短」排序 —— 与平台的匹配顺序观感一致。
 */
export function filterBranches(branches: readonly string[], query: string): string[] {
  const needle = query.trim().toLowerCase()
  if (!needle) return [...branches]
  return branches
    .map(branch => ({ branch, at: branch.toLowerCase().indexOf(needle) }))
    .filter(entry => entry.at >= 0)
    .sort((a, b) => a.at - b.at || a.branch.length - b.branch.length || a.branch.localeCompare(b.branch))
    .map(entry => entry.branch)
}

/** 分支名合法性：与 `git check-ref-format` 的核心约束一致（原生侧会再让 git 判定一次）。 */
export function validateBranchName(name: string): string | null {
  const value = name.trim()
  if (!value) return '分支名不能为空。'
  if (/[\s~^:?*[\\]/.test(value)) return '分支名不能包含空格或 ~ ^ : ? * [ \\ 这些字符。'
  if (value.startsWith('-') || value.startsWith('/') || value.endsWith('/') || value.endsWith('.') || value.endsWith('.lock'))
    return '分支名不能以 - 或 / 开头，也不能以 / 或 . 结尾。'
  if (value.includes('..') || value.includes('@{') || value.includes('//')) return '分支名里不能出现 ..、@{ 或 //。'
  return null
}
