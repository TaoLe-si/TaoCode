// 标签提醒态状态机（src/tabAlerts.ts）的判据。
//
// 每个数字都对到 `TabLabel.repaintAttraction`（`:640-690`）与 `JBTabsImpl.updateAttraction`
// （`:1910-1925`）：前 5 帧闪、第 5 帧清 requested 但**留在 attractions**、层常亮；
// 再 fire 只续两次（blinkCount 5→7 后拨回 5）；stop 才把计数归零、层关掉。
import test from 'node:test'
import assert from 'node:assert/strict'
import {
  BLINK_FRAME_MS, MAX_INITIAL_BLINK_COUNT, MAX_RE_FIRE_BLINK_COUNT,
  blinkTabAlert, createTabAlertRegistry, idleTabAlert, requestTabAlert, stopTabAlert, tabAlertBlinking,
} from '../src/tabAlerts.ts'

test('初始态：不在 attractions、图标层关闭', () => {
  const state = idleTabAlert()
  assert.deepEqual(state, { attraction: false, requested: false, blinkCount: 0, layerEnabled: false })
  assert.equal(tabAlertBlinking(state), false)
})

test('fireAlert 进入 attractions 并把 requested 置真，blinkCount 不动', () => {
  const state = requestTabAlert(idleTabAlert())
  assert.equal(state.attraction, true)
  assert.equal(state.requested, true)
  assert.equal(state.blinkCount, 0)
})

test('前 5 帧逐帧取反，第 5 帧后 requested 落、图标层常亮', () => {
  let state = requestTabAlert(idleTabAlert())
  const seen = []
  for (let i = 0; i < MAX_INITIAL_BLINK_COUNT; i++) {
    state = blinkTabAlert(state)
    seen.push(state.layerEnabled)
  }
  assert.deepEqual(seen, [true, false, true, false, true], '起始关闭 ⇒ 第 1 帧亮、逐帧取反')
  assert.equal(state.blinkCount, MAX_INITIAL_BLINK_COUNT)
  assert.equal(state.requested, false, '第 5 帧 resetAlertRequest 只清 requested')
  assert.equal(state.attraction, true, 'resetAlertRequest 不离开 attractions')
  assert.equal(tabAlertBlinking(state), false, '预算用完就不再闪')
  // 再走一帧仍是常亮（`else { setLayerEnabled(1, true) }`）。
  state = blinkTabAlert(state)
  assert.equal(state.layerEnabled, true)
  assert.equal(state.blinkCount, MAX_INITIAL_BLINK_COUNT)
})

test('预算用完后再次 fireAlert：只续两次闪，计数拨回 5（maxReFireBlinkCount）', () => {
  let state = requestTabAlert(idleTabAlert())
  for (let i = 0; i < MAX_INITIAL_BLINK_COUNT; i++) state = blinkTabAlert(state)
  assert.equal(state.layerEnabled, true)
  state = requestTabAlert(state)
  assert.equal(state.requested, true)
  assert.equal(state.blinkCount, MAX_INITIAL_BLINK_COUNT, '二次提醒不重置计数')
  state = blinkTabAlert(state)
  assert.equal(state.layerEnabled, false, '第 6 帧取反')
  state = blinkTabAlert(state)
  assert.equal(state.layerEnabled, true, '第 7 帧再取反')
  assert.equal(state.blinkCount, MAX_INITIAL_BLINK_COUNT, '到 7 后计数拨回 5')
  assert.equal(state.requested, false)
  assert.equal(state.attraction, true)
  assert.equal(MAX_RE_FIRE_BLINK_COUNT, 7)
})

test('stopAlerting：移出 attractions、计数归零、层关闭', () => {
  let state = requestTabAlert(idleTabAlert())
  state = blinkTabAlert(state)
  state = stopTabAlert(state)
  assert.deepEqual(state, idleTabAlert())
  assert.equal(blinkTabAlert(state).layerEnabled, false)
})

test('stop 后再 fire 是完整的一轮 5 次（Stop-Alert 重置 blinkCount 的后果）', () => {
  let state = stopTabAlert(requestTabAlert(idleTabAlert()))
  state = requestTabAlert(state)
  assert.equal(state.blinkCount, 0)
  for (let i = 0; i < MAX_INITIAL_BLINK_COUNT; i++) state = blinkTabAlert(state)
  assert.equal(state.requested, false)
  assert.equal(state.blinkCount, MAX_INITIAL_BLINK_COUNT)
})

test('动画定格：2 帧 / 500ms ⇒ 每 250ms 一帧', () => {
  assert.equal(BLINK_FRAME_MS, 250)
})

test('注册表：alert 只让目标标签进提醒，选中（stop）后立刻清零', () => {
  const registry = createTabAlertRegistry()
  try {
    assert.equal(registry.visible('bottom:run'), false)
    assert.equal(registry.blinking('bottom:run'), false)
    registry.alert('bottom:run')
    assert.equal(registry.blinking('bottom:run'), true)
    assert.equal(registry.blinking('bottom:debug'), false, '别的标签不受影响')
    registry.stop('bottom:run')
    assert.equal(registry.visible('bottom:run'), false)
    assert.equal(registry.blinking('bottom:run'), false)
  } finally { registry.dispose() }
})

test('注册表帧推进：定时器真的在消耗闪烁预算', async () => {
  const registry = createTabAlertRegistry({ intervalMs: 5 })
  try {
    registry.alert('bottom:debug')
    assert.equal(registry.blinking('bottom:debug'), true)
    // 不能赌固定墙钟：intervalMs=5 的 60ms 窗口在满载机器上装不下 12 次 tick
    // （8 路并发实测 2/8 挂）。改成轮询到「已经推过帧」为止，只留一个宽松上限兜死循环。
    const deadline = Date.now() + 1000
    let state = registry.state('bottom:debug')
    while (state.blinkCount <= 0 && Date.now() < deadline) {
      await new Promise(resolve => setTimeout(resolve, 5))
      state = registry.state('bottom:debug')
    }
    assert.ok(state.blinkCount > 0, `定时器没有推进帧（blinkCount=${state.blinkCount}）`)
    assert.equal(state.attraction, true, '预算用完仍在 attractions 里（图标常亮）')
    assert.equal(registry.visible('bottom:debug'), true)
  } finally { registry.dispose() }
})
