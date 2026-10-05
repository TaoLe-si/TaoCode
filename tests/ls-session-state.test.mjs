// `ls/session` 的状态机判据（`src/lsSessionState.ts` 的迁移闸）。
//
// 上游依据：`platform/lsp-impl/src/impl/LspClientImpl.kt:79-90` —— `state` 的私有 setter：
//   · `:81` `value == Initializing` ⇒ 非法（没有任何迁移能回到握手中）；
//   · `:82` `field != Initializing && value == Running` ⇒ 非法（只有握手中能直接进就绪）；
//   · `:83-84` `field == ShutdownNormally || field == ShutdownUnexpectedly` ⇒ 终态，非法；
//   · `:85-87` 非法时 `logger.error("Incorrect state change: …")` 并**原样返回**（表不动、
//     `serverStateChanged` 不广播）；`:88-89` 合法才写字段并广播。
// 枚举本身：`platform/lsp/src/api/LspServerState.kt:7-25`。
import test from 'node:test'
import assert from 'node:assert/strict'
import {
  applyLspLanguageStatus, canTransitionLspState, isLspLanguageFailed, isLspLanguageReady,
  isTerminalLspState, lspServerState, lspSessionStates, parseLspLanguageStatus,
} from '../src/lsSessionState.ts'

test('四态分类照宿主回包三个布尔（lsp_capability_queries.cpp:139-144）', () => {
  assert.equal(lspServerState({ running: true, ready: true, configured: true, language: 'java' }), 'running')
  assert.equal(lspServerState({ running: true, ready: false, configured: true, language: 'java' }), 'initializing')
  assert.equal(lspServerState({ running: false, ready: false, configured: true, language: 'java', error: { code: 'LSP_CLOSED' } }), 'shutdownUnexpectedly')
  assert.equal(lspServerState({ running: false, ready: false, configured: false, language: 'java' }), 'unconfigured')
  assert.equal(lspServerState(null), 'unconfigured')
  assert.equal(parseLspLanguageStatus({ language: '' }), null, '没有 language 的回包不算状态')
})

test('迁移闸：四条非法迁移逐条照 LspClientImpl.kt:81-84', () => {
  // `:81` 没有任何迁移能回到握手中（闸无条件，**同状态重放也算非法**）
  for (const from of ['initializing', 'running', 'shutdownUnexpectedly']) {
    assert.equal(canTransitionLspState(from, 'initializing'), false, `${from} -> initializing 应当被拒`)
  }
  // `:82` 只有握手中能直接进就绪
  assert.equal(canTransitionLspState('initializing', 'running'), true)
  assert.equal(canTransitionLspState('running', 'running'), false, '同状态重放在上游也是非法迁移（:81/:82 无条件）')
  assert.equal(canTransitionLspState('shutdownUnexpectedly', 'running'), false, '终态不会自己活过来')
  // `:83-84` 终态
  assert.equal(isTerminalLspState('shutdownUnexpectedly'), true)
  assert.equal(isTerminalLspState('running'), false)
  // 首迁与 unconfigured（上游那一格不存在，见 src/lsSessionState.ts 头注）
  assert.equal(canTransitionLspState(undefined, 'initializing'), true, '首次上报')
  assert.equal(canTransitionLspState('unconfigured', 'initializing'), true, '配好服务器后的第一份状态必须是握手中')
  assert.equal(canTransitionLspState('unconfigured', 'running'), true)
})

test('合法的那几条：握手中/就绪 → 停机', () => {
  assert.equal(canTransitionLspState('initializing', 'shutdownUnexpectedly'), true)
  assert.equal(canTransitionLspState('running', 'shutdownUnexpectedly'), true)
  assert.equal(canTransitionLspState('initializing', 'unconfigured'), true, '配置被摘掉可以回到这一格')
})

test('闸装在写表之前：非法迁移不改表（对应上游「原样返回」）', () => {
  const language = 'gate-probe'
  delete lspSessionStates[language]
  assert.equal(applyLspLanguageStatus({ running: true, ready: true, configured: true, language }), true)
  assert.equal(lspSessionStates[language], 'running')

  // 已就绪 ⇒ 停机：合法，表跟着变
  assert.equal(applyLspLanguageStatus({ running: false, ready: false, configured: true, language, error: { code: 'LSP_CLOSED' } }), true)
  assert.equal(lspSessionStates[language], 'shutdownUnexpectedly')

  // 终态 ⇒ 就绪：**不合法**，表必须原地不动
  assert.equal(applyLspLanguageStatus({ running: true, ready: true, configured: true, language }), false)
  assert.equal(lspSessionStates[language], 'shutdownUnexpectedly', '非法迁移把表改了')
  delete lspSessionStates[language]
})

test('形状不对仍然返回 false（调用方继续往下的分支）', () => {
  assert.equal(applyLspLanguageStatus(null), false)
  assert.equal(applyLspLanguageStatus({ ready: true }), false)
})

test('就绪/失败两问（上游只有 Running 能接请求）', () => {
  assert.equal(isLspLanguageReady('running'), true)
  assert.equal(isLspLanguageReady('initializing'), false)
  assert.equal(isLspLanguageFailed('shutdownUnexpectedly'), true)
  assert.equal(isLspLanguageFailed('unconfigured'), true)
  assert.equal(isLspLanguageFailed('initializing'), false, '握手中不算失败')
})
