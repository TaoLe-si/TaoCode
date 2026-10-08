// 判据 · 启动运行实例时的**夺焦判定与宿主动作**（exec2 R3）。
//
// 上游：`RunContentManagerImpl.kt:432-435` 选中新 Content 之后，`:439-441` 按
// `isActivateToolWindowWhenAdded` 决定碰不碰面板、`:450-457` 按 `isAutoFocusContent`（或「整个应用
// 没有焦点所有者」）决定 `focus`，`:458` 调 `activate(callback, focus, focus)`。
// 判定是纯函数（`src/runStartupFocus.ts`），本判据钉**调用时机**（`handleRunStarted` 里新实例选中之后）
// 与**宿主回调注入**（`setRunStartupFocusHost`）：注入后按判定真的调 `focusRunToolWindow`，
// 不注入时 `applyRunStartupFocus` 返回 null 且无副作用。
import test from 'node:test'
import assert from 'node:assert/strict'

import {
  activeRunInstance, applyRunStartupFocus, handleRunStarted, runInstances,
  setRunStartupFocusHost,
} from '../src/runInstances.ts'

const reset = () => { runInstances.clear(); activeRunInstance.value = 0; setRunStartupFocusHost(null) }

test('注入宿主回调后，focus 开关为真 ⇒ 启动实例时真实调 focusRunToolWindow', () => {
  reset()
  let focused = 0
  setRunStartupFocusHost({
    flagsFor: () => ({ activateToolWindowBeforeRun: true, focusToolWindowBeforeRun: true }),
    focusRunToolWindow: () => { focused += 1 },
    focusOwnerMissing: () => false,
  })
  try {
    assert.equal(handleRunStarted({ instance: 101, label: 'focus-on' }), true)
    assert.equal(activeRunInstance.value, 101, '新实例仍被选中（原本的行为不变）')
    assert.equal(focused, 1, '没有把键盘焦点移进面板')
  } finally { reset() }
})

test('focus 关着且焦点所有者在场 ⇒ 不夺焦（与上游默认一致）', () => {
  reset()
  let focused = 0
  setRunStartupFocusHost({
    flagsFor: () => ({ activateToolWindowBeforeRun: true, focusToolWindowBeforeRun: false }),
    focusRunToolWindow: () => { focused += 1 },
    focusOwnerMissing: () => false,
  })
  try {
    handleRunStarted({ instance: 102, label: 'no-focus' })
    assert.equal(focused, 0)
    const decision = applyRunStartupFocus(runInstances.get(102))
    assert.equal(decision.takeFocus, false)
    assert.equal(decision.activateToolWindow, true, '面板仍要打开')
  } finally { reset() }
})

test('focus 关着但整个应用没有焦点所有者 ⇒ 强制夺焦（RunContentManagerImpl.kt:451-457）', () => {
  reset()
  let focused = 0
  setRunStartupFocusHost({
    flagsFor: () => ({ activateToolWindowBeforeRun: true, focusToolWindowBeforeRun: false }),
    focusRunToolWindow: () => { focused += 1 },
    focusOwnerMissing: () => true,
  })
  try {
    handleRunStarted({ instance: 103, label: 'missing-owner' })
    assert.equal(focused, 1, '焦点所有者缺失时上游强制夺焦')
  } finally { reset() }
})

test('未注入宿主回调时不改变既有行为（applyRunStartupFocus 返回 null）', () => {
  reset()
  handleRunStarted({ instance: 104, label: 'no-host' })
  assert.equal(applyRunStartupFocus(runInstances.get(104)), null)
  reset()
})
