// 判据 · 工具窗口事件面（`src/toolWindowManagerListener.ts` + `src/toolWindowStripes.ts` 的接线）——
// 上游 `ToolWindowManagerListener` 那条 MessageBus Topic 的同名回调面。
//
// 钉五件事：
//   ① EP id 逐字等于上游监听接口的全限定名，且已声明；
//   ② 四类事件的差异算法（注册/注销/隐藏/状态变化）逐条对上游那几个回调；
//   ③ 订阅 / 注销；同 id 重复订阅按上游 `replaceExtension` 口径覆盖；
//   ④ 快照折叠 `layoutSnapshotOf` 的形状；
//   ⑤ **真实消费点**：`toolWindowStripes` 在布局替换与可见性变化时真的广播（源码级钉接线）。
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

import {
  TOOL_WINDOW_MANAGER_LISTENER_EP, dispatchToolWindowStateChange, layoutSnapshotOf,
  onToolWindowManagerEvent, toolWindowManagerEvents, toolWindowManagerListeners,
} from '../src/toolWindowManagerListener.ts'
import { EXTENSIONS } from '../src/extensionPoints.ts'

const root = new URL('../', import.meta.url)
const read = rel => readFileSync(new URL(rel, root), 'utf8')

const snap = (over = {}) => ({
  registered: ['files', 'git'], visible: ['files'], anchors: { files: 'left', git: 'left' },
  order: { files: '0', git: '1' }, ...over,
})

test('EP id 逐字取自上游监听接口全限定名，且已声明', () => {
  assert.equal(TOOL_WINDOW_MANAGER_LISTENER_EP, 'com.intellij.openapi.wm.ex.ToolWindowManagerListener')
  assert.ok(EXTENSIONS.hasExtensionPoint(TOOL_WINDOW_MANAGER_LISTENER_EP), 'EP 应已声明')
  assert.deepEqual(toolWindowManagerListeners(), [], '没有订阅时 EP 上应是空的')
})

test('四类事件的差异算法逐条对上游回调', () => {
  // 注册
  const added = toolWindowManagerEvents(snap(), snap({ registered: ['files', 'git', 'debug'] }))
  assert.deepEqual(added.registered, ['debug'])
  assert.deepEqual(added.unregistered, [])
  // 注销
  const removed = toolWindowManagerEvents(snap(), snap({ registered: ['files'] }))
  assert.deepEqual(removed.unregistered, ['git'])
  // 隐藏
  const hidden = toolWindowManagerEvents(snap(), snap({ visible: [] }))
  assert.deepEqual(hidden.hidden, ['files'])
  // 状态变化：锚点变了（成员没变）
  const moved = toolWindowManagerEvents(snap(), snap({ anchors: { files: 'right', git: 'left' } }))
  assert.equal(moved.stateChanged, true)
  // 状态变化：顺序变了
  const reordered = toolWindowManagerEvents(snap(), snap({ order: { files: '1', git: '0' } }))
  assert.equal(reordered.stateChanged, true)
  // 完全一样：什么都不发
  assert.deepEqual(toolWindowManagerEvents(snap(), snap()),
    { registered: [], unregistered: [], hidden: [], stateChanged: false })
  // 有注册/注销时不再额外发 stateChanged（那两类已经表达）。
  assert.equal(toolWindowManagerEvents(snap(), snap({ registered: ['files', 'git', 'x'], anchors: { files: 'right' } })).stateChanged, false)
})

test('订阅 / 注销；四个同名回调都收到对应事件', () => {
  const seen = []
  const off = onToolWindowManagerEvent({
    toolWindowsRegistered: ids => seen.push(['registered', [...ids]]),
    toolWindowUnregistered: id => seen.push(['unregistered', id]),
    toolWindowsHidden: ids => seen.push(['hidden', [...ids]]),
    stateChanged: () => seen.push(['stateChanged']),
  })
  assert.equal(toolWindowManagerListeners().length, 1)
  const events = dispatchToolWindowStateChange(
    snap(),
    snap({ registered: ['files', 'git', 'x'], visible: [], anchors: { files: 'right', git: 'left' } }),
  )
  assert.deepEqual(events.registered, ['x'])
  assert.deepEqual(events.hidden, ['files'])
  // 这一批同时有注册 ⇒ 锚点变化不再额外发 stateChanged（那两类已经表达，见 `toolWindowManagerEvents`）。
  assert.deepEqual(seen, [['registered', ['x']], ['hidden', ['files']]])
  // 单独一次纯状态变化（成员不变）才发 stateChanged。
  dispatchToolWindowStateChange(snap(), snap({ anchors: { files: 'right', git: 'left' } }))
  assert.deepEqual(seen.at(-1), ['stateChanged'])
  off()
  assert.deepEqual(toolWindowManagerListeners(), [])
  assert.deepEqual(dispatchToolWindowStateChange(snap(), snap({ visible: [] })).hidden, ['files'])
})

test('快照折叠：按注册集取锚点与顺序', () => {
  const snapshot = layoutSnapshotOf({
    registered: ['files', 'git'],
    visible: ['files'],
    anchorOf: id => (id === 'git' ? 'bottom' : 'left'),
    orderOf: id => (id === 'git' ? '0' : '2'),
  })
  assert.deepEqual(snapshot, {
    registered: ['files', 'git'], visible: ['files'],
    anchors: { files: 'left', git: 'bottom' }, order: { files: '2', git: '0' },
  })
})

test('模块被真实消费（不是只被自己调）', () => {
  const stripes = read('src/toolWindowStripes.ts')
  assert.match(stripes, /from '\.\/toolWindowManagerListener\.ts'/, 'toolWindowStripes 要 import 事件面模块')
  assert.match(stripes, /dispatchToolWindowStateChange\(/, '布局变化要广播')
  // 两个发布点：整套布局替换（applyProjectLayout 末尾）与可见性变化（saveVisibility 里）。
  const publishes = stripes.match(/publishLayoutChange\(\)/g) ?? []
  assert.ok(publishes.length >= 3, `publishLayoutChange 应有定义 + 两处调用，实为 ${publishes.length}`)
  assert.match(stripes, /function currentLayoutSnapshot\(\)/, '快照要从真实状态折出')
})
