// Pure logic behind IDEA's post-commit notification.
// Source: platform/vcs-impl/src/com/intellij/vcs/commit/ShowNotificationCommitResultHandler.kt
// and the message keys in platform/vcs-api/vcs-api-core/resources/messages/VcsBundle.properties.

/**
 * `ShowNotificationCommitResultHandler.kt:97` calls `expirePreviousAndNotify`, so only the latest
 * commit result is ever shown — TaoCode keys the notification with this id to replace the previous
 * one instead of piling them up in the notification centre.
 */
export const COMMIT_NOTIFICATION_ID = 'vcs.commit'

/** `VcsBundle.properties:956` — `vcs.commit.canceled`. */
export const COMMIT_CANCELED = '提交已取消'

export type CommitNotificationLevel = 'info' | 'warning' | 'error'

export interface CommitOutcome {
  /** Distinct changes that were committed. */
  committed: number
  /** Original exception count — warnings plus errors, exactly like `commitExceptions.size`. */
  exceptions: number
  /** `collectErrors(exceptions).size`. */
  errors: number
}

/**
 * `CommitNotificationType` (`:118-126`): errors win, then warnings, then success — with a separate
 * "initial commit" variant that only changes the display id, not the text.
 */
export function commitNotificationLevel(outcome: CommitOutcome): CommitNotificationLevel {
  if (outcome.errors > 0) return 'error'
  if (outcome.exceptions - outcome.errors > 0) return 'warning'
  return 'info'
}

/**
 * `:54-58` — the title is a plural choice: `message.text.commit.failed.with.error` (`VcsBundle:103`),
 * `message.text.commit.finished.with.warning` (`:104`) or `vcs.commit.files.committed` (`:952`,
 * whose first choice is the special "No files committed" wording). Chinese does not inflect, so the
 * `{0,choice,…}` cardinality only changes the numeral.
 */
export function commitNotificationTitle(outcome: CommitOutcome): string {
  const warnings = outcome.exceptions - outcome.errors
  if (outcome.errors > 0) return `提交失败：${outcome.errors} 个错误`
  if (warnings > 0) return `提交完成，但有 ${warnings} 个警告`
  if (outcome.committed <= 0) return '没有文件已提交'
  return `已提交 ${outcome.committed} 个文件`
}

/**
 * `getCommitSummary()` (`:100-116`): the commit message first, then each `feedback` line on its own
 * row, then the failure messages — but the exceptions are skipped entirely when they are *all*
 * warnings (`hasOnlyWarnings`, `:112`), because those are already named in the title.
 */
export function commitNotificationRows(commitMessage: string, feedback: readonly string[], errorMessages: readonly string[]): string[] {
  const rows: string[] = []
  if (commitMessage.trim()) rows.push(commitMessage.trim())
  for (const line of feedback) if (line.trim()) rows.push(line.trim())
  for (const line of errorMessages) if (line.trim()) rows.push(line.trim())
  return rows
}

// 2026-10-06 partialcommit 收尾删掉这里的 `countCommittedPaths()`：它数的是"**路径**去重后有几条"，
// 而上游 `ShowNotificationCommitResultHandler.kt:42-43` + `:128` 数的是 `HashSet(changes).size` =
// **这次包含的变更**条数。一次重命名交出去是两朵 pathspec、一条变更 ⇒ 按路径数会把它报成"2 个文件已提交"。
// 面板唯一的调用点（`SourceControl.vue` 的 `reportCommitResult`）已改走 `src/commitScope.ts` 的
// `committedChangeCount`（同一份 `HashSet` 口径，判据在 `tests/commit-scope.test.mjs`），
// 这里留着它就是一个没有生产消费方的第二把尺子。
