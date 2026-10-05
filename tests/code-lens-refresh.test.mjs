// Code Vision 的**刷新时机**（`src/codeLens.ts` 的延迟策略 + `src/codeLensExtension.ts` 的控制器）：
//   · 打开 / 编辑 / 重新获得焦点三档延迟；
//   · 请求在飞时的重复触发**排队补跑一次**（原来会被吞掉，编辑后条目一直不刷新）；
//   · `reset()`（切文件 / 关 LSP）之后，在飞的那次答案不再落盘。
//
// 控制器是自包含的（扩展自己带 updateListener），这里用假 view + 极短延迟驱动真实控制器；
// 只把 `window` 借给它（Node 里没有 DOM）。

import test from 'node:test'
import assert from 'node:assert/strict'

import { CODE_LENS_REFRESH, codeLensRefreshDelay } from '../src/codeLens.ts'
import { createCodeLens } from '../src/codeLensExtension.ts'

globalThis.window = { setTimeout, clearTimeout }

const FAST = { openMs: 1, changeMs: 1, focusMs: 1 }
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms))
const deferred = () => {
  let settle
  const promise = new Promise(resolve => { settle = resolve })
  return { promise, resolve: settle }
}

function fakeView() {
  const dispatched = []
  return { dispatched, dispatch: spec => { dispatched.push(spec) } }
}

function controller(query, view, overrides = {}) {
  return createCodeLens({
    query,
    enabled: overrides.enabled ?? (() => true),
    view: () => view,
    onCommand: () => {},
    policy: overrides.policy ?? FAST,
  })
}

test('刷新延迟按触发点分档：打开 0 / 编辑 400 / 焦点 700', () => {
  assert.deepEqual(CODE_LENS_REFRESH, { openMs: 0, changeMs: 400, focusMs: 700 })
  assert.equal(codeLensRefreshDelay('open'), 0)
  assert.equal(codeLensRefreshDelay('change'), 400)
  assert.equal(codeLensRefreshDelay('focus'), 700)
  assert.equal(codeLensRefreshDelay('focus', { openMs: 1, changeMs: 2, focusMs: 3 }), 3, '策略可覆盖')
})

test('去抖窗口里的重复触发只问一次，答案落进编辑器', async () => {
  const view = fakeView()
  let calls = 0
  const c = controller(async () => { calls++; return { available: true, items: [] } }, view)
  c.schedule('change')
  c.schedule('change')
  c.schedule('change')
  await sleep(30)
  assert.equal(calls, 1)
  assert.equal(view.dispatched.length, 1, '结果要 dispatch 进编辑器（假 view 只记录）')
})

test('请求在飞时的编辑触发排队补跑一次，不再丢刷新', async () => {
  const view = fakeView()
  const first = deferred()
  let calls = 0
  const c = controller(() => { calls++; return calls === 1 ? first.promise : Promise.resolve({ available: true, items: [] }) }, view)
  c.schedule('open')
  await sleep(15)
  assert.equal(calls, 1, '第一次请求已经发出、还在飞')
  c.schedule('change')            // 在飞期间的编辑
  first.resolve({ available: true, items: [] })
  await sleep(40)
  assert.equal(calls, 2, '补跑了一次，而不是把这次编辑吞掉')
  assert.equal(view.dispatched.length, 2)
})

test('disable 状态下不请求；dispose 后到点的定时器不再请求', async () => {
  const view = fakeView()
  let calls = 0
  const query = async () => { calls++; return { available: false, items: [] } }
  const off = controller(query, view, { enabled: () => false })
  off.schedule('change')
  await sleep(20)
  assert.equal(calls, 0)

  const c = controller(query, view)
  c.schedule('change')
  c.dispose()
  await sleep(20)
  assert.equal(calls, 0, 'dispose 清掉了未到点的定时器')
})

test('reset 之后，在飞的那次答案不再落盘', async () => {
  const view = fakeView()
  const first = deferred()
  let calls = 0
  const c = controller(() => { calls++; return first.promise }, view)
  c.schedule('open')
  await sleep(15)
  assert.equal(calls, 1)
  c.reset()
  const afterReset = view.dispatched.length
  first.resolve({ available: true, items: [] })
  await sleep(20)
  assert.equal(view.dispatched.length, afterReset, '过期的答案不许再 dispatch')
  assert.equal(calls, 1)
})
