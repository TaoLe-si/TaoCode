// 语言服务状态面（`lsWidget` / `serviceView`）条目上的**动作**能不能真的执行。
//
// 上游那两件事（`platform/lsp/src/api/lsWidget/LspClientWidgetItem.kt:115-127` 的
// `createStopOrRestartAction()`，文案 `RestartLspServerAction`/`StopLspServerAction`
// 取 `platform/lsp/resources/messages/LspBundle.properties:26-27` 的中文包）在本仓只有一条通道：
// 宿主的 `lsp.stop`（`native/main.cpp:1079-1082`：不排队、就地收掉语言服务线程并换一条新的）。
// 这里验的是**执行面**的四条：不出动作的档一条请求都不发、先清表再 stop、清表之后新状态能进表、
// 收不掉时如实报错而不是假装成功。

import test, { afterEach } from 'node:test'
import assert from 'node:assert/strict'

import { applyLspLanguageStatus, lspSessionStates } from '../src/lsSessionState.ts'
import { lspWidgetItemFor, runLspWidgetItemAction } from '../src/lsSessionHost.ts'
import { RESTART_ACTION, STOP_ACTION } from '../src/lsFeaturesWidget.ts'

// 本文件是纯 JS（`package.json` 的 test 脚本不带 `--experimental-strip-types`）。

const reply = () => ({ language: 'Java', running: true, ready: true, configured: true })

function recorder(options = {}) {
  const sent = []
  const notes = []
  const request = async (method, params) => {
    sent.push({ method, params })
    if (options.fail) throw new Error(options.fail)
    if (options.hold) return options.hold
    return { ok: true }
  }
  // `runLspWidgetItemAction` 的 deps 就两项：发请求的通道 + 给用户说话的那张嘴。
  return { request, notify: message => { notes.push(message) }, notes, sent, method: () => notes.join('\n') }
}

/** 状态表是模块级的 reactive 单例：每条用例跑完都倒干净，免得互相看见对方的格子。 */
afterEach(() => { for (const key of Object.keys(lspSessionStates)) delete lspSessionStates[key] })

test('上游不出这个动作的那一档：一条请求都不发、一句话都不说（不放假控件）', async () => {
  const h = recorder()
  const outcome = await runLspWidgetItemAction(
    { language: 'java', presentableName: 'Java', stopOrRestart: null }, h)
  assert.equal(outcome, 'noop')
  assert.deepEqual(h.sent, [])
  assert.deepEqual(h.notes, [])
})

test('状态面自己算出来的条目（没配服务器）就是不出动作的那一档', async () => {
  const h = recorder()
  const item = lspWidgetItemFor('java')
  assert.equal(item.stopOrRestart, null, 'unconfigured 那一格对应上游 ShutdownNormally ⇒ 没有动作')
  assert.equal(await runLspWidgetItemAction(item, h), 'noop')
  assert.deepEqual(h.sent, [])
})

test('重启：先把状态表清干净，再发一次 lsp.stop，动作文案取上游那两个键', async () => {
  lspSessionStates.Java = 'running'
  const h = recorder()
  const outcome = await runLspWidgetItemAction(
    { language: 'java', presentableName: 'Java', stopOrRestart: 'restart' }, h)
  assert.equal(outcome, 'done')
  assert.deepEqual(h.sent.map(entry => entry.method), ['lsp.stop'])
  assert.equal('Java' in lspSessionStates, false, '整台服务器都停了 ⇒ 整张表清掉（宿主只有一条线程）')
  assert.match(h.method(), new RegExp(RESTART_ACTION))
})

test('停止档用「根据需要停止并自动运行服务器」那句文案，不复用重启的', async () => {
  const h = recorder()
  await runLspWidgetItemAction({ language: 'java', presentableName: 'Java', stopOrRestart: 'stop' }, h)
  assert.equal(h.notes.length, 1)
  assert.match(h.notes[0], new RegExp(STOP_ACTION))
  assert.doesNotMatch(h.notes[0], new RegExp(RESTART_ACTION))
})

test('清表这一步不是可选的：不清的话终态闸会拒掉重启回来的第一份 running', async () => {
  lspSessionStates.Java = 'shutdownUnexpectedly'
  assert.equal(applyLspLanguageStatus({ ...reply(), language: 'Java' }), false,
    '终态（`LspClientImpl.kt:83-84`）之后不会自己活 —— 这一格必须先换成新的客户端对象')
  const h = recorder()
  await runLspWidgetItemAction({ language: 'java', presentableName: 'Java', stopOrRestart: 'restart' }, h)
  assert.equal(applyLspLanguageStatus({ ...reply(), language: 'Java' }), true, '重启后新状态能进表')
  assert.equal(lspSessionStates.Java, 'running')
})

test('收不掉时如实报失败，而不是把清过的表说成重启成功', async () => {
  lspSessionStates.Java = 'running'
  const h = recorder({ fail: 'Language service thread is stuck' })
  const outcome = await runLspWidgetItemAction(
    { language: 'java', presentableName: 'Java', stopOrRestart: 'restart' }, h)
  assert.equal(outcome, 'failed')
  assert.match(h.method(), /失败：Language service thread is stuck/)
  assert.equal('Java' in lspSessionStates, false)
})

test('连点两次只发一条：在飞的那条没收完之前不再发第二条', async () => {
  let release
  const h = recorder({ hold: new Promise(resolve => { release = resolve }) })
  const first = runLspWidgetItemAction({ language: 'java', presentableName: 'Java', stopOrRestart: 'restart' }, h)
  await new Promise(resolve => setImmediate(resolve))
  const second = await runLspWidgetItemAction({ language: 'java', presentableName: 'Java', stopOrRestart: 'restart' }, h)
  assert.equal(second, 'noop')
  release({ ok: true })
  assert.equal(await first, 'done')
  assert.equal(h.sent.length, 1)
  // 在飞守卫放开后还能再点（否则一次失败就把这个按钮永久钉死）。
  const third = await runLspWidgetItemAction({ language: 'java', presentableName: 'Java', stopOrRestart: 'restart' }, h)
  assert.equal(third, 'done')
  assert.equal(h.sent.length, 2)
})
