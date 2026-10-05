// 提交选项的存档与「慢检查推后到提交后」决策（上游 `VcsConfiguration` 项目级配置、
// `CommitChecks.kt` 的 setter、`CommitOptionsPanel.kt:110-118` 的勾选框、
// `NonModalCommitWorkflowHandler.kt:398-407` 的 pendingPostCommitChecks）的判据。
import test from 'node:test'
import assert from 'node:assert/strict'
import {
  DEFAULT_COMMIT_OPTIONS, commitOptionsKey, postCommitCheckFailures, readCommitOptions,
  runsChecksAfterCommit, runsChecksBeforeCommit, saveCommitOptions,
} from '../src/commitOptions.ts'

/** 内存存储（node 里没有 localStorage）。 */
function memoryStorage(initial = {}) {
  const map = new Map(Object.entries(initial))
  return {
    getItem: key => (map.has(key) ? map.get(key) : null),
    setItem: (key, value) => { map.set(key, value) },
    dump: () => Object.fromEntries(map),
  }
}

test('默认档照上游：署名/预检关，慢检查推后开（VcsConfiguration.java:151）', () => {
  assert.deepEqual(DEFAULT_COMMIT_OPTIONS, { signoff: false, checkTodoBeforeCommit: false, postponeSlowChecks: true })
  assert.deepEqual(readCommitOptions('C:/repo', memoryStorage()), { ...DEFAULT_COMMIT_OPTIONS })
})

test('按工作区根分键，存取往返一致', () => {
  const storage = memoryStorage()
  assert.equal(commitOptionsKey('C:/repo'), 'taocode.commitOptions:C:/repo')
  saveCommitOptions('C:/repo', { signoff: true, checkTodoBeforeCommit: true, postponeSlowChecks: false }, storage)
  assert.deepEqual(readCommitOptions('C:/repo', storage), { signoff: true, checkTodoBeforeCommit: true, postponeSlowChecks: false })
  // 另一个根不受影响。
  assert.deepEqual(readCommitOptions('C:/other', storage), DEFAULT_COMMIT_OPTIONS)
})

test('坏存档不挡提交：落回默认而不是抛', () => {
  const broken = memoryStorage({ 'taocode.commitOptions:C:/repo': '{oops' })
  assert.deepEqual(readCommitOptions('C:/repo', broken), DEFAULT_COMMIT_OPTIONS)
  const wrongTypes = memoryStorage({ 'taocode.commitOptions:C:/repo': '{"signoff":"yes","postponeSlowChecks":null}' })
  assert.deepEqual(readCommitOptions('C:/repo', wrongTypes), { signoff: false, checkTodoBeforeCommit: false, postponeSlowChecks: true })
  // 存不下也不抛（storage 抛异常时静默）。
  assert.doesNotThrow(() => saveCommitOptions('C:/repo', DEFAULT_COMMIT_OPTIONS, { getItem: () => null, setItem: () => { throw new Error('quota') } }))
})

test('检查时机互斥：推后 ⇒ 提交后跑、不在提交前跑', () => {
  const postponed = { signoff: false, checkTodoBeforeCommit: true, postponeSlowChecks: true }
  assert.equal(runsChecksBeforeCommit(postponed), false)
  assert.equal(runsChecksAfterCommit(postponed), true)
  const sync = { ...postponed, postponeSlowChecks: false }
  assert.equal(runsChecksBeforeCommit(sync), true)
  assert.equal(runsChecksAfterCommit(sync), false)
})

test('提交后检查的说明句：提交已完成、问题逐条列出；没问题时为空', () => {
  assert.equal(postCommitCheckFailures([]), '')
  const text = postCommitCheckFailures(['2 个 TODO'])
  assert.match(text, /提交已完成/)
  assert.match(text, /提交后检查发现 1 个问题/)
  assert.match(text, /2 个 TODO/)
})
