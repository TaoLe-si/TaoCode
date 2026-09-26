import test from 'node:test'
import assert from 'node:assert/strict'
import {
  COMMIT_CANCELED,
  COMMIT_NOTIFICATION_ID,
  commitNotificationLevel,
  commitNotificationRows,
  commitNotificationTitle,
  countCommittedPaths,
} from '../src/commitNotification.ts'

const outcome = (committed, exceptions = 0, errors = 0) => ({ committed, exceptions, errors })

// ShowNotificationCommitResultHandler.kt:47-52
test('errors beat warnings, warnings beat success', () => {
  assert.equal(commitNotificationLevel(outcome(3, 2, 2)), 'error')
  assert.equal(commitNotificationLevel(outcome(3, 2, 0)), 'warning')
  assert.equal(commitNotificationLevel(outcome(3)), 'info')
  assert.equal(commitNotificationLevel(outcome(0)), 'info')
})

// VcsBundle.properties:103,104,952 + :54-58
test('the title names the worst outcome with its count', () => {
  assert.equal(commitNotificationTitle(outcome(2, 1, 1)), '提交失败：1 个错误')
  assert.equal(commitNotificationTitle(outcome(2, 3, 2)), '提交失败：2 个错误')
  assert.equal(commitNotificationTitle(outcome(2, 1, 0)), '提交完成，但有 1 个警告')
  assert.equal(commitNotificationTitle(outcome(2, 4, 0)), '提交完成，但有 4 个警告')
})

// vcs.commit.files.committed = "{0,choice,0#No files|1#{0} file|2#{0} files} committed"
test('a clean commit reports how many files went in', () => {
  assert.equal(commitNotificationTitle(outcome(1)), '已提交 1 个文件')
  assert.equal(commitNotificationTitle(outcome(7)), '已提交 7 个文件')
  assert.equal(commitNotificationTitle(outcome(0)), '没有文件已提交')
})

// getCommitSummary():100-116
test('the body starts with the commit message, then the feedback lines', () => {
  const rows = commitNotificationRows('修正登录跳转', ['已运行 3 个检查', '已推送到 origin'], [])
  assert.deepEqual(rows, ['修正登录跳转', '已运行 3 个检查', '已推送到 origin'])
})

test('a blank message contributes no row at all', () => {
  assert.deepEqual(commitNotificationRows('   ', ['仅反馈'], []), ['仅反馈'])
  assert.deepEqual(commitNotificationRows('', [], []), [])
})

// hasOnlyWarnings (:112) — warnings are named in the title already, so they are not repeated.
test('the failure messages follow the feedback lines', () => {
  assert.deepEqual(commitNotificationRows('msg', ['ok'], ['push 失败：权限不足']), ['msg', 'ok', 'push 失败：权限不足'])
})

test('blank lines are dropped', () => {
  assert.deepEqual(commitNotificationRows('msg', [' ', 'x'], [' ', '']), ['msg', 'x'])
})

// countChangesIgnoringChangeLists (:128) — HashSet(changes).size
test('the same path in two change lists is counted once', () => {
  assert.equal(countCommittedPaths(['a', 'b', 'a']), 2)
  assert.equal(countCommittedPaths([]), 0)
})

// notifyMinorWarning(COMMIT_CANCELED, "", message("vcs.commit.canceled")) — empty content (:30)
test('a cancelled commit is a content-free warning', () => {
  assert.equal(COMMIT_CANCELED, '提交已取消')
})

// expirePreviousAndNotify (:97)
test('commit notifications share one id so the previous one is replaced', () => {
  assert.equal(COMMIT_NOTIFICATION_ID, 'vcs.commit')
})
