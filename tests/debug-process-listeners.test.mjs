// 调试进程监听（上游 `DebugProcessListener`）+ 本仓把它暴露成的 EP。
//
// 上游：`java/debugger/openapi/src/com/intellij/debugger/engine/DebugProcessListener.java:29-57`
// （八个默认空方法，per-process 挂）；上游 xdebugger 侧同类是 `XDebugSessionListener`。
// 本仓：EP `com.intellij.xdebugger.debugProcessListener`（`src/debugProcessListeners.ts`），
// DAP 会话状态跃迁驱动 attached/paused/resumed/detached。
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { reactive } from 'vue'

import { APPLICATION_SCOPE, EXTENSIONS } from '../src/extensionPoints.ts'
import {
  DEBUG_PROCESS_LISTENER_EP,
  DebugProcessListenerRegistry,
  debugProcessListeners,
  installDebugProcessDispatch,
  registerDebugProcessListener,
} from '../src/debugProcessListeners.ts'

const read = path => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8')

test('EP 已声明，且 id 是插件可挂的入口', () => {
  assert.equal(DEBUG_PROCESS_LISTENER_EP, 'com.intellij.xdebugger.debugProcessListener')
  assert.ok(EXTENSIONS.hasExtensionPoint(DEBUG_PROCESS_LISTENER_EP))
  assert.ok(EXTENSIONS.extensionPointIds().includes(DEBUG_PROCESS_LISTENER_EP))
})

test('插件经 EP 注册的监听器会被单例发到（attached/paused/resumed/detached）', () => {
  const seen = []
  const dispose = registerDebugProcessListener({
    processAttached: process => seen.push(['attached', process.program]),
    paused: context => seen.push(['paused', context.reason, context.threadId]),
    resumed: context => seen.push(['resumed', context.reason]),
    processDetached: (process, byUser) => seen.push(['detached', process.exitCode, byUser]),
  }, 'test.listener')
  try {
    debugProcessListeners.processAttached({ program: 'app', sessionId: 1, exitCode: null })
    debugProcessListeners.paused({ reason: 'breakpoint', threadId: 3, location: { path: 'a.ts', line: 9 } })
    debugProcessListeners.resumed({ reason: 'step', threadId: 3, location: null })
    debugProcessListeners.processDetached({ program: 'app', sessionId: 1, exitCode: 0 }, false)
    assert.deepEqual(seen, [
      ['attached', 'app'],
      ['paused', 'breakpoint', 3],
      ['resumed', 'step'],
      ['detached', 0, false],
    ])
  } finally { dispose() }
  assert.equal(debugProcessListeners.listenerCount, 0)
})

test('一个监听器抛错不打断其余监听器', () => {
  const registry = new DebugProcessListenerRegistry()
  const calls = []
  registry.subscribe({ paused: () => { throw new Error('bad') } })
  registry.subscribe({ paused: () => calls.push('second') })
  assert.doesNotThrow(() => registry.paused({ reason: 'x', threadId: 1, location: null }))
  assert.deepEqual(calls, ['second'])
  assert.equal(registry.drainErrors().length, 1)
})

test('会话状态跃迁驱动事件：只发跃迁、同态不重复', () => {
  const registry = new DebugProcessListenerRegistry()
  const seen = []
  registry.subscribe({
    connectorIsReady: () => seen.push('ready'),
    processAttached: () => seen.push('attached'),
    paused: () => seen.push('paused'),
    resumed: () => seen.push('resumed'),
    processDetached: () => seen.push('detached'),
  })
  const state = reactive({ running: false, paused: false, threadId: 0, reason: null, program: 'app', currentLocation: null, exitCode: null })
  let tick = null
  installDebugProcessDispatch(state, registry, fn => { tick = fn; return { stop() {} } })
  const fire = () => tick()

  state.running = true; fire()                 // 起会话
  state.running = true; fire()                 // 同态：不再 attached
  state.paused = true; state.threadId = 2; state.reason = 'breakpoint'; fire()
  state.currentLocation = { path: 'a.ts', line: 4 } // 位置更新但仍在暂停：不再 paused
  fire()
  state.paused = false; fire()                 // 继续
  state.paused = false; fire()                 // 同态：不再 resumed
  state.running = false; fire()                // 结束
  assert.deepEqual(seen, ['ready', 'attached', 'paused', 'resumed', 'detached'])
})

test('dapRequests 在活链路上安装监听分发（DebugPanel 消费该模块）', () => {
  const src = read('src/dapRequests.ts')
  assert.match(src, /installDebugProcessDispatch\(dapState\)/)
  assert.match(src, /import \{ installDebugProcessDispatch \} from '\.\/debugProcessListeners\.ts'/)
})
