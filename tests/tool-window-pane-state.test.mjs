// 工具窗口 pane 的状态对象（B2：`ToolWindowPaneState` + `ToolWindowEntry`）。
//
// 上游三个对象里，本仓能兑现的是两件事（其余判 `[-]`，理由见判决 §G）：
//   ① "0 = 没存过"那条哨兵（`ToolWindowPaneState.getPreferredSplitProportion:20-29`）；
//   ② 侧条按钮挂/摘的**严格配对**（`ToolWindowEntry.stripeButton` 的 setter 断言，`:38-45`）。
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import {
  attachStripeButton, detachStripeButton, isMaximized, preferredSplitProportion, splitSizeOrDefault, stripeButtonKey, withSplitProportion,
} from '../src/toolWindowPaneState.ts'

const read = rel => readFileSync(new URL(`../${rel}`, import.meta.url), 'utf8')

// —— getPreferredSplitProportion（ToolWindowPaneState.kt:20-29）——

test('a stored proportion wins over the default', () => {
  assert.equal(preferredSplitProportion({ explorer: 0.3 }, 'explorer', 0.5), 0.3)
})

// `Object2FloatOpenHashMap` 对缺失键返回 0f —— 0 就是"没存过"。
test('zero means "never stored", so the default is used', () => {
  assert.equal(preferredSplitProportion({ explorer: 0 }, 'explorer', 0.5), 0.5)
  assert.equal(preferredSplitProportion({}, 'explorer', 0.5), 0.5)
})

test('a null id falls back to the default', () => {
  assert.equal(preferredSplitProportion({ explorer: 0.3 }, null, 0.5), 0.5)
})

// 同一语义的单值形态：本仓的编辑区分栏尺寸就是"一个数字，0 = 还没拖过"。
test('the single-value form has the same sentinel', () => {
  assert.equal(splitSizeOrDefault(0, 350), 350)
  assert.equal(splitSizeOrDefault(280, 350), 280)
  assert.equal(splitSizeOrDefault(-1, 350), -1, '只有 0 是哨兵 —— 负数交给 clamp 去管')
})

// —— addSplitProportion（:31-38）：只有分栏态才记 ——

test('a proportion is recorded only for a split window', () => {
  assert.deepEqual(withSplitProportion({}, 'explorer', 0.4, true), { explorer: 0.4 })
  assert.deepEqual(withSplitProportion({}, 'explorer', 0.4, false), {}, '单栏窗口记比例会污染下次读取')
})

test('recording keeps the other windows', () => {
  assert.deepEqual(withSplitProportion({ a: 0.2 }, 'b', 0.6, true), { a: 0.2, b: 0.6 })
})

// —— isMaximized（:41-44）：按窗口身份比 ——

test('maximized is compared by window identity', () => {
  assert.equal(isMaximized('explorer', 'explorer'), true)
  assert.equal(isMaximized('explorer', 'git'), false)
  assert.equal(isMaximized(null, 'explorer'), false)
})

// —— stripeButton 的挂/摘配对（ToolWindowEntry.kt:38-45）——

test('attaching twice is rejected', () => {
  const first = attachStripeButton(null, 'explorer')
  assert.deepEqual(first, { ok: true, next: 'explorer' })
  assert.deepEqual(attachStripeButton('explorer', 'git'), { ok: false, reason: 'already-attached' })
})

test('detaching what was never attached is rejected', () => {
  assert.deepEqual(detachStripeButton(null), { ok: false, reason: 'not-attached' })
  assert.deepEqual(detachStripeButton('explorer'), { ok: true, next: null })
})

// 一轮完整的挂→摘：两步都成功，且状态回到起点。
test('a full attach-detach round trip is balanced', () => {
  let current = null
  const attached = attachStripeButton(current, 'todo')
  assert.equal(attached.ok, true)
  if (attached.ok) current = attached.next
  const detached = detachStripeButton(current)
  assert.equal(detached.ok, true)
  if (detached.ok) current = detached.next
  assert.equal(current, null)
})

// 上游 `removeStripeButton()` 用的是窗口自己的锚点 —— 换边之后是另一个键。
test('the button key includes the anchor', () => {
  assert.equal(stripeButtonKey('explorer', 'left'), 'explorer:left')
  assert.notEqual(stripeButtonKey('explorer', 'left'), stripeButtonKey('explorer', 'right'))
})

// —— 接线 ——

test('the sentinel is used where the split size is restored', () => {
  const resize = read('src/panelResize.ts')
  assert.match(resize, /splitSizeOrDefault\(splitSize\.value, halfSize\)/, '两处内联的哨兵要收敛到命名函数')
  assert.equal((resize.match(/splitSizeOrDefault\(/g) ?? []).length, 2, '两处都要改（键盘与指针两条拖拽路径）')
  assert.doesNotMatch(resize, /if \(splitSize\.value === 0\)/, '内联写法应已删除')
})

test('the stripe button store enforces the pairing', () => {
  const stripes = read('src/toolWindowStripes.ts')
  assert.match(stripes, /if \(!detachStripeButton\(/, '移除按钮要走配对检查')
  assert.match(stripes, /if \(!attachStripeButton\(/, '恢复按钮要走配对检查')
})