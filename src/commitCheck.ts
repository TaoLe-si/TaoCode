// IDEA's commit check, ported from vcs/commit.
//
// NonModalCommitWorkflowHandler.checkCommit() (NonModalCommitWorkflowHandler.kt:177-184)
// decides whether a commit may run and, when it may not, records *which* precondition is
// missing:
//
//   isEmptyChanges = !isAmendWithoutChangesAllowed() && !executorWithoutChangesAllowed && isCommitEmpty()
//   isEmptyMessage = getCommitMessage().isBlank()
//
// Amending is exempt from the "changes" requirement (NonModalAmendCommitHandler.kt:51:
// `commitToAmend !is None && amendRoot != null`) because rewriting HEAD's message is a
// valid amend on its own.
//
// CommitProgressPanel.buildErrorText() (:321-328) turns those two flags into the label the
// panel shows above the commit actions, with the strings from VcsBundle.properties:17-19.
//
// Note the commit button itself does not depend on any of this — it only needs a VCS, no
// running commit and no loading amend handler (isReady(), NonModalCommitWorkflowHandler
// .kt:156-159). The reason is reported when the action runs, not by disabling the button.
//
// TaoCode deviation: amending with an empty message stays allowed (the native commit uses
// `git commit --amend --no-edit` to keep the previous subject), so an empty message only
// blocks a normal commit.

import { commitScopeCovers } from './commitScope.ts'

export type CommitBlockReason = 'no-changes' | 'no-message' | 'no-changes-no-message'

/**
 * 「这次提交包含的变更」计数要看的几种行（结构上就是 `GitChange` / `CommitScopeRow`）。
 * `renameFrom` / `ignored` 是 2026-10-06 partialcommit 收尾补的两件：
 *  · `renameFrom` —— 上游把一次重命名算作**一条**变更、**两朵**路径
 *    （`GitCheckinEnvironment.kt:403-404` 的 toCommitAdded=afterPath / toCommitRemoved=beforePath），
 *    范围里给的是旧路径那一半时，这一行同样算"被这次提交包含"。原来这里认不出它 ⇒
 *    面板明明补全出了两朵 pathspec（`expandCommitSelection`）、`commitPathsToSubmit` 也不拒，
 *    这一档却数出 0 ⇒ 提交按钮被「选择要提交的文件」按住，是一次假拒（判据见
 *    `tests/commit-scope.test.mjs` 边界一/边界三）；
 *  · `ignored` —— `CommonCheckinFilesAction.kt:75-78` 的 `isActionEnabled` 对 `FileStatus.IGNORED`
 *    直接不启用，被忽略的行进不了这次提交 ⇒ 不能再把它算成"有内容"。
 */
export interface CommitIncludedRow {
  path: string
  staged: boolean
  untracked: boolean
  renameFrom?: string
  ignored?: boolean
}

export interface CommitCheckInput {
  hasStagedChanges: boolean
  hasMessage: boolean
  amend: boolean
  /**
   * 部分提交（「提交文件…」）时**这次范围内**的变更数（`commitIncludedCount` 算出来的）。
   * 上游的"有没有内容"问的就是这个集合，而不是暂存区整份：
   *   `AbstractCommitWorkflowHandler.kt:82` `isCommitEmpty() = getIncludedChanges().isEmpty() &&
   *   getIncludedUnversionedFiles().isEmpty()`，被选范围由 `CheckinActionUtil.kt:135-136` 的
   *   `setCommitState(initialChangeList, included, …)` 定下来；`NonModalCommitWorkflowHandler.kt:177-185`
   *   再把它落到 `isEmptyChanges`。
   * 没给（`null`/未传）= 没有范围这一档 ⇒ 照旧看整份暂存区，行为与本批之前逐字一致。
   */
  includedCount?: number | null
}

/**
 * 这次提交包含的变更行数（上游 `getIncludedChanges() + getIncludedUnversionedFiles()`）。
 * 覆盖判定用 `src/commitScope.ts` 的 `commitScopeCovers` —— 全仓**唯一**的一份
 * （选中目录 `src` 算它下面的每一行、重命名的另一头也算、被忽略的行不算），
 * 这里原来自己写了一份 `row.path === path || row.path.startsWith(path + '/')`，
 * 少了后两件 ⇒ 与请求体那一层（`commitPathsToSubmit`）给出两个答案。
 * 未跟踪的行同样计入 —— 上游那一条 `isCommitEmpty()` 专门把 unversioned 也算进来
 * （`AbstractCommitWorkflowHandler.kt:82`），所以"只选了新文件"不是空提交。
 * `scope` 为空/未给 ⇒ 返回 `null`（= 不做这一档，调用方按整份暂存区判）。
 */
export function commitIncludedCount(rows: readonly CommitIncludedRow[], scope?: readonly string[]): number | null {
  const selected = (scope ?? []).map(path => path.trim()).filter(Boolean)
  if (!selected.length) return null
  let count = 0
  for (const row of rows) {
    if (row.ignored) continue
    if (selected.some(path => commitScopeCovers(path, row))) count++
  }
  return count
}

export function commitBlockReason(input: CommitCheckInput): CommitBlockReason | null {
  // "isCommitEmpty()" — an amend is allowed to carry no changes of its own.
  const hasChanges = input.includedCount === null || input.includedCount === undefined
    ? input.hasStagedChanges : input.includedCount > 0
  const changesOk = input.amend || hasChanges
  const messageOk = input.amend || input.hasMessage
  if (!changesOk && !messageOk) return 'no-changes-no-message'
  if (!changesOk) return 'no-changes'
  if (!messageOk) return 'no-message'
  return null
}

/**
 * `VcsBundle.properties:17-19` 的三条原文 —— 中文包逐字对照（`localization-zh`）：
 *   error.no.changes.to.commit        选择要提交的文件
 *   error.no.commit.message           指定提交消息
 *   error.no.changes.no.commit.message 选择要提交的文件并指定提交消息
 */
export function commitBlockMessage(reason: CommitBlockReason | null): string {
  switch (reason) {
    case 'no-changes': return '选择要提交的文件'
    case 'no-message': return '指定提交消息'
    case 'no-changes-no-message': return '选择要提交的文件并指定提交消息'
    default: return ''
  }
}
