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

// 语言服务线程卡死时的恢复（真机上见过：大工程握手之后那条线程不再接活，请求永不回包）。
// 这一条盯三件事：① 状态查询有上限，不会永远挂着；② 没响应时先用 `lsp.stop`（原生不排队）重启；
// ③ 重启之后重来一次，第二次再没响应就如实报错，不再重试。
test('状态查询没响应：重启语言服务一次并重来', async () => {
  const calls = []
  const notices = []
  let statusCalls = 0
  const tab = { path: 'src/A.java', content: 'class A {}' }
  const deps = {
    request: async (method, params) => {
      calls.push(method + (params.kind ? ':' + params.kind : ''))
      if (method === 'lsp.open') return { running: true, ready: false, configured: true, language: 'java' }
      if (method === 'lsp.stop') return { ok: true }
      statusCalls += 1
      // 第一次启动：永远不回（模拟卡死）；重启之后：回一个就绪
      if (statusCalls <= 1) return new Promise(() => {})
      return { running: true, ready: true, configured: true, language: 'java' }
    },
    notify: (message, error) => notices.push({ message, error }),
    current: () => true,
    pause: async () => {},
  }
  await startCompletionSession(tab, deps)
  assert.equal(tab.lspRunning, true, '重启之后应当就绪')
  assert.deepEqual(calls, ['lsp.open', 'lsp.request:status', 'lsp.stop', 'lsp.open', 'lsp.request:status'], '顺序：查询 → 重启 → 重来')
  assert.ok(notices.some(n => /没有响应/.test(n.message) && !n.error), '重启时给一条提示（不是错误）')
})

test('重启之后仍然没响应：如实报错并且不再重试', async () => {
  const calls = []
  const notices = []
  const tab = { path: 'src/A.java', content: 'class A {}' }
  const deps = {
    request: async (method, params) => {
      calls.push(method + (params.kind ? ':' + params.kind : ''))
      if (method === 'lsp.open') return { running: true, ready: false, configured: true, language: 'java' }
      if (method === 'lsp.stop') return { ok: true }
      return new Promise(() => {})
    },
    notify: (message, error) => notices.push({ message, error }),
    current: () => true,
    pause: async () => {},
  }
  await startCompletionSession(tab, deps)
  assert.equal(tab.lspRunning, false)
  assert.equal(calls.filter(c => c === 'lsp.stop').length, 1, '只重启一次')
  assert.ok(notices.some(n => n.error && /没有响应/.test(n.message)), '第二次报错')
})
