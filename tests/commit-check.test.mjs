import test from 'node:test'
import assert from 'node:assert/strict'
import { commitBlockMessage, commitBlockReason } from '../src/commitCheck.ts'

// NonModalCommitWorkflowHandler.checkCommit() (:177-184) sets isEmptyChanges / isEmptyMessage.
test('nothing staged and no message reports both missing preconditions', () => {
  assert.equal(commitBlockReason({ hasStagedChanges: false, hasMessage: false, amend: false }), 'no-changes-no-message')
  assert.equal(commitBlockMessage('no-changes-no-message'), '选择要提交的文件并指定提交消息', 'VcsBundle error.no.changes.no.commit.message（中文包原文）')
})

test('a staged file with no message only complains about the message', () => {
  assert.equal(commitBlockReason({ hasStagedChanges: true, hasMessage: false, amend: false }), 'no-message')
  assert.equal(commitBlockMessage('no-message'), '指定提交消息', 'VcsBundle error.no.commit.message（中文包原文）')
})

test('a message with nothing staged only complains about the files', () => {
  assert.equal(commitBlockReason({ hasStagedChanges: false, hasMessage: true, amend: false }), 'no-changes')
  assert.equal(commitBlockMessage('no-changes'), '选择要提交的文件')
})

test('a staged file plus a message passes the check', () => {
  assert.equal(commitBlockReason({ hasStagedChanges: true, hasMessage: true, amend: false }), null)
  assert.equal(commitBlockMessage(null), '')
})

// NonModalAmendCommitHandler.kt:51 — an amend is exempt from the changes requirement.
test('amending needs no staged changes but still needs a message', () => {
  assert.equal(commitBlockReason({ hasStagedChanges: false, hasMessage: false, amend: true }), null)
  assert.equal(commitBlockReason({ hasStagedChanges: false, hasMessage: true, amend: true }), null)
  assert.equal(commitBlockReason({ hasStagedChanges: true, hasMessage: true, amend: true }), null)
})

test('every reason has a label and passing has none', () => {
  const reasons = ['no-changes', 'no-message', 'no-changes-no-message']
  for (const reason of reasons) assert.notEqual(commitBlockMessage(reason), '')
  assert.equal(commitBlockMessage(null), '')
})
