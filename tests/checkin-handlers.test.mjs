// 提交期三条 EP（`src/checkinHandlers.ts`）的判据。
//
// 上游：`com.intellij.checkinHandlerFactory`（`platform/vcs-api/resources/intellij.platform.vcs.xml:24-26`，
// `CheckinHandlerFactory.java:17` 的 EP_NAME）、`com.intellij.vcsCheckinHandlerFactory`（同 xml `:27-29`）、
// `com.intellij.vcs.changes.localCommitExecutor`（`CommitExecutor.java:23-24` 的 ProjectExtensionPointName）。
// 本仓把三条登记在 `src/pluginApi.ts` 的 `UPSTREAM_EXTENSION_POINTS` 里（id 写错一个字符插件就挂不上）。
//
// 这组判据钉四件事：① 三条 id 与上游逐字一致且真的声明了；② 内建那道空判闸走 EP（bundled 贡献在表里）；
// ③ 第三方按同一 id 挂 handler 能真的挡下提交、注销后即失效；④ 执行器表与 executeCommit 的查找面。
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  BUILTIN_EMPTY_COMMIT_HANDLER_ID, BUILTIN_LOCAL_COMMIT_EXECUTOR_ID,
  CHECKIN_HANDLER_FACTORY_EP, LOCAL_COMMIT_EXECUTOR_EP, VCS_CHECKIN_HANDLER_FACTORY_EP,
  checkinHandlerFactories, commitExecutors, createCheckinHandlers, defaultCommitExecutor,
  executeCommit, runBeforeCheckin, runCheckinFailed, runCheckinSuccessful, userCommitExecutors,
} from '../src/checkinHandlers.ts'
import { commitBlockMessage } from '../src/commitCheck.ts'
import { EXTENSIONS, APPLICATION_SCOPE } from '../src/extensionPoints.ts'
import { UPSTREAM_EXTENSION_POINTS } from '../src/pluginApi.ts'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')

const panel = (overrides = {}) => ({
  root: 'D:/ws',
  message: 'feat: x',
  paths: ['src/a.ts'],
  amend: false,
  blockReason: null,
  ...overrides,
})

test('三条 EP id 与上游逐字一致，且都已在宿主里声明', () => {
  assert.equal(CHECKIN_HANDLER_FACTORY_EP, 'com.intellij.checkinHandlerFactory')
  assert.equal(VCS_CHECKIN_HANDLER_FACTORY_EP, 'com.intellij.vcsCheckinHandlerFactory')
  assert.equal(LOCAL_COMMIT_EXECUTOR_EP, 'com.intellij.vcs.changes.localCommitExecutor')
  for (const id of [CHECKIN_HANDLER_FACTORY_EP, VCS_CHECKIN_HANDLER_FACTORY_EP, LOCAL_COMMIT_EXECUTOR_EP]) {
    assert.ok(EXTENSIONS.hasExtensionPoint(id), `${id} 必须已声明`)
    const ref = UPSTREAM_EXTENSION_POINTS.find(entry => entry.id === id)
    assert.ok(ref, `${id} 没登记进 UPSTREAM_EXTENSION_POINTS`)
    assert.ok(ref.upstreamFile.length > 0 && ref.consumer.length > 0, `${id} 的出处行不完整`)
  }
})

test('内建那道空判/空信息闸是 bundled 贡献，结论经 EP 流回（文案与 commitBlockMessage 一致）', () => {
  const bundled = checkinHandlerFactories().find(factory => factory.id === BUILTIN_EMPTY_COMMIT_HANDLER_ID)
  assert.ok(bundled, '内建闸必须作为 bundled 贡献出现在 EP 表里')

  const ok = runBeforeCheckin(createCheckinHandlers(panel()))
  assert.deepEqual(ok, { result: 'COMMIT', handlerId: null, message: null })

  const blocked = runBeforeCheckin(createCheckinHandlers(panel({ blockReason: 'no-message' })))
  assert.equal(blocked.result, 'CANCEL')
  assert.equal(blocked.handlerId, BUILTIN_EMPTY_COMMIT_HANDLER_ID)
  assert.equal(blocked.message, commitBlockMessage('no-message'), '挡下时给的是内建闸的说明文字')
})

test('第三方按同一 id 挂 handler：能挡下提交（带自己的说明），注销后即失效', () => {
  const handle = EXTENSIONS.registerExtension(CHECKIN_HANDLER_FACTORY_EP, 'third.party.gate', {
    id: 'third.party.gate',
    createHandler: () => ({
      id: 'third.party.gate',
      beforeCheckin: () => 'CANCEL',
      cancelMessage: () => '第三方处理器说：先跑一遍 lint',
    }),
  }, { scope: APPLICATION_SCOPE, source: 'user' })
  const outcome = runBeforeCheckin(createCheckinHandlers(panel()))
  assert.equal(outcome.result, 'CANCEL')
  assert.equal(outcome.handlerId, 'third.party.gate')
  assert.equal(outcome.message, '第三方处理器说：先跑一遍 lint')
  handle.dispose()
  assert.deepEqual(runBeforeCheckin(createCheckinHandlers(panel())), { result: 'COMMIT', handlerId: null, message: null },
    '注销后不再参与')
})

test('提交结果的两条通知口把回调逐个投出去（checkinSuccessful / checkinFailed）', () => {
  const calls = []
  const handlers = [
    { id: 'a', checkinSuccessful: () => calls.push(['ok', 'a']), checkinFailed: errors => calls.push(['fail', 'a', errors]) },
    { id: 'b', checkinFailed: errors => calls.push(['fail', 'b', errors]) },
  ]
  runCheckinSuccessful(handlers)
  runCheckinFailed(handlers, ['git 拒绝'])
  assert.deepEqual(calls, [['ok', 'a'], ['fail', 'a', ['git 拒绝']], ['fail', 'b', ['git 拒绝']]])
})

test('执行器表：缺省那条是内建本地提交执行器，第三方挂的能被执行、找不到就明确报错', async () => {
  const all = commitExecutors()
  assert.equal(all.length, 1, '默认只有内建那一条')
  assert.equal(defaultCommitExecutor()?.id, BUILTIN_LOCAL_COMMIT_EXECUTOR_ID)
  assert.deepEqual(userCommitExecutors(), [], '没有第三方时渲染面为空（菜单/按钮不必多一行）')

  const handle = EXTENSIONS.registerExtension(LOCAL_COMMIT_EXECUTOR_EP, 'third.party.executor', {
    id: 'third.party.executor',
    getActionText: () => '提交到评审系统',
    execute: input => ({ ok: true, errors: [`收到 ${input.paths.length} 个路径`] }),
  }, { scope: APPLICATION_SCOPE, source: 'user' })
  const users = userCommitExecutors()
  assert.deepEqual(users.map(executor => executor.getId()), ['third.party.executor'], '第三方执行器带出 getId 缺省面')
  const result = await executeCommit('third.party.executor', {
    root: 'D:/ws', message: 'x', paths: ['src/a.ts', 'src/b.ts'], amend: false,
  })
  assert.deepEqual(result, { ok: true, errors: ['收到 2 个路径'] })
  assert.deepEqual(await executeCommit('missing.executor', { root: 'D:/ws', message: '', paths: [], amend: false }),
    { ok: false, errors: ['找不到提交执行器：missing.executor'] }, '不可静默回落成一次本地提交')
  handle.dispose()
})

test('生产消费点：提交路径上的闸真的走 EP（src/sourceControlCommitChecks.ts 的 passedCommitCheck）', () => {
  const checks = readFileSync(join(root, 'src/sourceControlCommitChecks.ts'), 'utf8')
  assert.match(checks, /import \{[^}]*runBeforeCheckin[^}]*\} from '\.\/checkinHandlers\.ts'/)
  assert.match(checks, /runBeforeCheckin\(createCheckinHandlers\(panel\)\)/, '闸要走 EP，不能只看内建的 reason')
  assert.match(checks, /blockReason: reason/, '内建的结论要作为 panel 传给 bundled handler')
})
