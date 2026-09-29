// Java 无代码提示的第一道关口：语言服务器到底有没有起来、起来到哪一步。
// 真实模块 src/lspCompletionStartup.ts（不是模型），原生形状见 native/lsp_session.cpp /
// `language_status()`：`{running, ready, configured, language, error?}`。

import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { startCompletionSession } from '../src/lspCompletionStartup.ts'

async function start(tab, request, errors) {
  await startCompletionSession(tab, { request, notify: message => errors.push(message), current: () => true })
}

test('Java without a configured server reports the missing dependency and configuration path', async () => {
  const tab = { path: 'Main.java', content: '', lspRunning: false }
  const errors = []
  await start(tab, async () => ({ running: false, ready: false, configured: false, language: 'java' }), errors)
  assert.equal(tab.lspRunning, false)
  assert.match(errors.join('\n'), /Java.*TaoCode\.lsp\.json/)
})

test('spawned is not initialized: startup waits for readiness before enabling code insight', async () => {
  const tab = { path: 'Main.java', content: '', lspRunning: false }
  const errors = []
  let statuses = 0
  await start(tab, async method => {
    if (method === 'lsp.open') return { running: true, ready: false, configured: true, language: 'java' }
    assert.equal(tab.lspRunning, false, 'UI must remain disabled during initialize')
    return { running: true, ready: ++statuses === 2, configured: true, language: 'java' }
  }, errors)
  assert.equal(statuses, 2)
  assert.equal(tab.lspRunning, true)
  assert.deepEqual(errors, [])
})

test('failed initialize preserves the real reason instead of claiming the server runs', async () => {
  const tab = { path: 'Main.java', content: '', lspRunning: false }
  const errors = []
  await start(tab, async method => method === 'lsp.open'
    ? { running: true, ready: false, configured: true, language: 'java' }
    : { running: false, ready: false, configured: true, language: 'java', error: { code: 'LSP_INITIALIZE', message: 'JDK runtime mismatch' } }, errors)
  assert.equal(tab.lspRunning, false)
  assert.match(errors.join('\n'), /JDK runtime mismatch/)
})

test('a server that exits mid-startup is reported instead of leaving completion silently off', async () => {
  const tab = { path: 'Main.java', content: '', lspRunning: false }
  const errors = []
  await start(tab, async method => method === 'lsp.open'
    ? { running: true, ready: false, configured: true, language: 'java' }
    : { running: false, ready: false, configured: true, language: 'java', error: { code: 'LSP_CLOSED', message: '语言服务器已退出' } }, errors)
  assert.equal(tab.lspRunning, false)
  assert.match(errors.join('\n'), /语言服务器已退出/)
})

test('a stale start (tab closed or project switched) never reports and never enables', async () => {
  const tab = { path: 'Main.java', content: '', lspRunning: false }
  const errors = []
  await startCompletionSession(tab, {
    request: async () => ({ running: true, ready: true, configured: true, language: 'java' }),
    notify: message => errors.push(message), current: () => false,
  })
  assert.equal(tab.lspRunning, false)
  assert.deepEqual(errors, [])
})

test('a legacy native host without `ready` cannot certify initialization', async () => {
  const tab = { path: 'Main.java', content: '', lspRunning: false }
  const errors = []
  await start(tab, async () => ({ running: true, configured: true, language: 'java' }), errors)
  assert.equal(tab.lspRunning, false)
  assert.match(errors.join('\n'), /语言服务器未就绪/)
})

test('native records the startup failure and reports running/ready separately', () => {
  const session = ['../native/lsp_session.cpp', '../native/lsp_host_bootstrap.cpp']
    .map(file => readFileSync(new URL(file, import.meta.url), 'utf8')).join(String.fromCharCode(10))
  const queries = readFileSync(new URL('../native/lsp_capability_queries.cpp', import.meta.url), 'utf8')
  assert.match(session, /startup_errors_\[language\] = invalid\(error\.code, error\.what\(\)\)/)
  // `running` = process alive, `ready` = initialize handshake done.
  assert.match(queries, /\{"ready", alive && failed == startup_errors_\.end\(\)/)
  // A retry has to drop the dead client, not reuse it.
  assert.match(session, /doomed->stop\(\)/)
})
