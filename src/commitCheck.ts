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

export type CommitBlockReason = 'no-changes' | 'no-message' | 'no-changes-no-message'

/** 「这次提交包含的变更」计数要看的三种行（结构上就是 `GitChange` / `CommitScopeRow`）。 */
export interface CommitIncludedRow {
  path: string
  staged: boolean
  untracked: boolean
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
 * 选中目录（`src`）算它下面的每一行（git 的 pathspec 就是这个语义）；未跟踪的行同样计入 ——
 * 上游那一条 `isCommitEmpty()` 专门把 unversioned 也算进来，所以"只选了新文件"不是空提交。
 * `scope` 为空/未给 ⇒ 返回 `null`（= 不做这一档，调用方按整份暂存区判）。
 */
export function commitIncludedCount(rows: readonly CommitIncludedRow[], scope?: readonly string[]): number | null {
  const selected = (scope ?? []).map(path => path.trim()).filter(Boolean)
  if (!selected.length) return null
  let count = 0
  for (const row of rows) {
    if (selected.some(path => row.path === path || row.path.startsWith(`${path}/`))) count++
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
