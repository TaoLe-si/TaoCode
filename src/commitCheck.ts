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

export interface CommitCheckInput {
  hasStagedChanges: boolean
  hasMessage: boolean
  amend: boolean
}

export function commitBlockReason(input: CommitCheckInput): CommitBlockReason | null {
  // "isCommitEmpty()" — an amend is allowed to carry no changes of its own.
  const changesOk = input.amend || input.hasStagedChanges
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
