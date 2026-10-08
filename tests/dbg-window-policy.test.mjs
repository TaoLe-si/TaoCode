// 调试器工具窗口的显示/隐藏策略（`src/debugWindowPolicy.ts`）—— 上游
// `XDebugSessionTab.onPause`（`platform/xdebugger-impl/ui/src/com/intellij/xdebugger/impl/ui/XDebugSessionTab.java:649-665`：
// `:651-653` 用户单步不吸引、`:654-656` `isShowDebuggerOnBreakpoint()` ⇒ `toFront(true, null)`、
// `:658-662` 顶帧没有源码位置 ⇒ `showView(getFramesContentId())`）
// 与进程结束那一段（同文件 `:320-325`：`isHideDebuggerOnProcessTermination()` ⇒
// `RunContentManager.hideRunContent(DefaultDebugExecutor..., getRunContentDescriptor())`）。
// 两格的默认档：`platform/xdebugger-impl/src/com/intellij/xdebugger/impl/settings/XDebuggerGeneralSettings.java:14-15`
// （`hideDebuggerOnProcessTermination` 无初值 = false；`myShowDebuggerOnBreakpoint = true`）。
//
// 消费点在 `src/App.vue`（保留文件）⇒ 本文件同时是「接线请求 X2 只需要一行」的证据：
// 策略与宿主动作的对应全在这里，App.vue 侧只把现成的三个函数塞进 host。
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import {
  applyDebuggerPause, applyDebuggerTermination, currentDebuggerWindowPolicy, isUserStepping, stoppedReasonOf,
} from '../src/debugWindowPolicy.ts'

/** 记账宿主：三条动作各自被调了几次，判据看的是「调用序列」而不是返回值。 */
function recordingHost() {
  const calls = []
  return {
    calls,
    bringDebuggerToFront() { calls.push('toFront') },
    showFramesView() { calls.push('frames') },
    hideDebuggerPage() { calls.push('hide') },
  }
}

test('stoppedReasonOf 拆 `"<reason>: <text>"`；空值/坏值给空串', () => {
  assert.equal(stoppedReasonOf('breakpoint: paused at 12'), 'breakpoint')
  assert.equal(stoppedReasonOf('step'), 'step')
  assert.equal(stoppedReasonOf('  exception : x = 1'), 'exception')
  assert.equal(stoppedReasonOf(null), '')
  assert.equal(stoppedReasonOf(undefined), '')
  assert.equal(stoppedReasonOf(''), '')
})

test('用户单步不吸引用户（XDebugSessionTab.java:651-653 的 `if (!pausedByUser) return;`）', () => {
  assert.equal(isUserStepping('step'), true)
  assert.equal(isUserStepping('step: hello'), true)
  for (const reason of ['breakpoint', 'exception', 'pause', 'entry', 'goto', null, '']) {
    assert.equal(isUserStepping(reason), false, `${reason} 不是单步`)
  }
  const host = recordingHost()
  const result = applyDebuggerPause(host, { reason: 'step', hasTopFrameSource: false })
  assert.deepEqual(host.calls, [], '单步时一条宿主动作都不许做')
  assert.deepEqual(result, { attracted: false, showedFrames: false })
})

test('停在断点：开了「显示调试器」带到前面；顶帧没源码位置时额外亮出调用堆栈（:654-662）', () => {
  const withSource = recordingHost()
  assert.deepEqual(applyDebuggerPause(withSource, { reason: 'breakpoint', hasTopFrameSource: true }),
    { attracted: true, showedFrames: false })
  assert.deepEqual(withSource.calls, ['toFront'])

  const withoutSource = recordingHost()
  assert.deepEqual(applyDebuggerPause(withoutSource, { reason: 'breakpoint', hasTopFrameSource: false }),
    { attracted: true, showedFrames: true })
  assert.deepEqual(withoutSource.calls, ['toFront', 'frames'], '两条都要做：先带前面，再亮堆栈')
})

test('关掉「显示调试器」：不带前面，但顶帧没源码仍亮堆栈（:658-662 与那格开关无关）', () => {
  const host = recordingHost()
  const result = applyDebuggerPause(host, {
    reason: 'pause', hasTopFrameSource: false,
    policy: { showDebuggerOnBreakpoint: false, hideDebuggerOnProcessTermination: false },
  })
  assert.deepEqual(result, { attracted: false, showedFrames: true })
  assert.deepEqual(host.calls, ['frames'])
})

test('默认档照抄上游：showDebuggerOnBreakpoint=true、hideDebuggerOnProcessTermination=false（XDebuggerGeneralSettings.java:14-15）', () => {
  assert.deepEqual(currentDebuggerWindowPolicy(), {
    showDebuggerOnBreakpoint: true,
    hideDebuggerOnProcessTermination: false,
  })
})

test('适配器报 preserveFocusHint ⇒ 不抢焦点（DAP `stopped.preserveFocusHint`，与"用户单步"同一条结果）', () => {
  const host = recordingHost()
  const result = applyDebuggerPause(host, { reason: 'breakpoint', hasTopFrameSource: true, preserveFocusHint: true })
  assert.deepEqual(result, { attracted: false, showedFrames: false }, '适配器明说别抢焦点 ⇒ 一条宿主动作都不做')
  assert.deepEqual(host.calls, [])
  // 没报这一位时行为不变（回归：默认档照旧带前面）。
  const plain = recordingHost()
  assert.deepEqual(applyDebuggerPause(plain, { reason: 'breakpoint', hasTopFrameSource: true }), { attracted: true, showedFrames: false })
  assert.deepEqual(plain.calls, ['toFront'])
})

test('进程结束：只有开了「隐藏调试器」才收掉这一页（:320-325）', () => {
  const hides = recordingHost()
  assert.equal(applyDebuggerTermination(hides, true), true)
  assert.deepEqual(hides.calls, ['hide'])
  const keeps = recordingHost()
  assert.equal(applyDebuggerTermination(keeps, false), false)
  assert.deepEqual(keeps.calls, [], '默认档是 false ⇒ 进程结束不许把调试页收掉（上游同一条默认）')
})

test('消费链：策略读设置页那一份存盘状态；App.vue 挂上宿主后两格才渲染（假控件禁令的两半）', () => {
  const policy = readFileSync(new URL('../src/debugWindowPolicy.ts', import.meta.url), 'utf8')
  assert.match(policy, /import \{ debuggerExtras \} from '\.\/debugSettingsStore\.ts'/,
    '策略没读设置页那一份单例 ⇒ 会出现「改了设置没效果」')
  assert.match(policy, /debuggerExtras\.showDebuggerOnBreakpoint/)
  assert.match(policy, /debuggerExtras\.hideDebuggerOnProcessTermination/)
  const store = readFileSync(new URL('../src/debugSettingsStore.ts', import.meta.url), 'utf8')
  assert.match(store, /hideDebuggerOnProcessTermination: false/, '存盘默认档被改（上游 :14 是无初值 = false）')
  assert.match(store, /showDebuggerOnBreakpoint: true/, '存盘默认档被改（上游 :15 = true）')
  // 宿主（2026-10-06 主代理接线；请求 12b W1 / 12c X2）：两个跳变各一条 watch，
  // 单步门控在策略内部（`USER_STEP_REASON`），外面不再加 if。
  const app = readFileSync(new URL('../src/App.vue', import.meta.url), 'utf8')
  assert.match(app, /applyDebuggerPause\(debuggerWindowHost, \{ reason: dapState\.reason, hasTopFrameSource: !!dapState\.currentLocation\?\.path \}\)/,
    '停在断点没有走策略 ⇒ `showDebuggerOnBreakpoint` 这格又是空的')
  assert.match(app, /applyDebuggerTermination\(debuggerWindowHost, currentDebuggerWindowPolicy\(\)\.hideDebuggerOnProcessTermination\)/,
    '进程结束没有走策略 ⇒ `hideDebuggerOnProcessTermination` 这格又是空的')
  // 设置页：有了真实消费点就必须画出来（不画就是「接了宿主却不给开关」）。
  const page = readFileSync(new URL('../src/components/DebuggerSettingsPage.vue', import.meta.url), 'utf8')
  assert.match(page, /v-model="debuggerExtras\.showDebuggerOnBreakpoint"/, '两格已可生效，设置页却没渲染')
  assert.match(page, /v-model="debuggerExtras\.hideDebuggerOnProcessTermination"/, '两格已可生效，设置页却没渲染')
})
