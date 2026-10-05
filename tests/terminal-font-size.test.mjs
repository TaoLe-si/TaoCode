// `src/terminalFontSize.ts` 的判据：越界保持原值、滚轮那一档、复位的靶子与 Ctrl+滚轮那道门。
//
// 上游依据：`platform/execution-impl/src/com/intellij/terminal/JBTerminalPanel.java:381-390`
// （Ctrl+滚轮缩放、越界不改、并且这条分支 return 掉不再滚缓冲区）、
// `platform/execution-impl/src/com/intellij/openapi/editor/actions/TerminalChangeFontSizeAction.kt:26-28`（±1 步进）、
// `:57-68`（越界不改 / 复位交回提供者）、`TerminalFontSizeProvider.kt:16-25`（临时缩放不写设置）、
// 上下限 `platform/editor-ui-ex/src/com/intellij/application/options/EditorFontsConstants.java:11-17`（4 / 40），
// 动作登记 `platform/execution-impl/resources/intellij.platform.execution.impl.actions.xml:34-45`。

import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

import {
  FONT_SIZE_STEP_DOWN, FONT_SIZE_STEP_UP, MAX_TERMINAL_FONT_SIZE, MIN_TERMINAL_FONT_SIZE,
  TERMINAL_BASE_FONT_SIZE, changeTerminalFontSize, resetTerminalFontSize, terminalFontSizeForWheel,
  terminalFontSizeReason, terminalFontSizeTitle, terminalWheelZoomApplies,
} from '../src/terminalFontSize.ts'

test('上下限是 4 与 40，步进 ±1（EditorFontsConstants.java:11-17、TerminalChangeFontSizeAction.kt:26-28）', () => {
  assert.equal(MIN_TERMINAL_FONT_SIZE, 4)
  assert.equal(MAX_TERMINAL_FONT_SIZE, 40)
  assert.equal(FONT_SIZE_STEP_UP, 1)
  assert.equal(FONT_SIZE_STEP_DOWN, -1)
})

test('越界是「保持原值」而不是夹到边界（JBTerminalPanel.java:384-386）', () => {
  assert.equal(changeTerminalFontSize(13, FONT_SIZE_STEP_UP), 14)
  assert.equal(changeTerminalFontSize(13, FONT_SIZE_STEP_DOWN), 12)
  assert.equal(changeTerminalFontSize(MAX_TERMINAL_FONT_SIZE, FONT_SIZE_STEP_UP), MAX_TERMINAL_FONT_SIZE)
  assert.equal(changeTerminalFontSize(MIN_TERMINAL_FONT_SIZE, FONT_SIZE_STEP_DOWN), MIN_TERMINAL_FONT_SIZE)
  assert.equal(changeTerminalFontSize(20, 100), 20, '一步跨过上限同样不改')
  assert.equal(changeTerminalFontSize(Number.NaN, 1), Number.NaN, '非有限值不当成一次有效缩放')
})

test('滚轮：往下滚 = 变小（newFontSize = 当前 - wheelRotation）', () => {
  assert.equal(terminalFontSizeForWheel(13, 1), 12)
  assert.equal(terminalFontSizeForWheel(13, -1), 14)
  assert.equal(terminalFontSizeForWheel(13, 0), 13, '没滚就不动')
  assert.equal(terminalFontSizeForWheel(4, 1), 4, '已在下限：这次滚动什么也不做')
  assert.equal(terminalFontSizeForWheel(40, -1), 40)
})

test('复位交回设置里那一档（TerminalFontSizeProvider 的 temporary zoom 反操作）', () => {
  assert.equal(resetTerminalFontSize(), TERMINAL_BASE_FONT_SIZE)
  assert.equal(resetTerminalFontSize(16), 16)
})

test('Ctrl+滚轮那道门要两个条件同时成立（JBTerminalPanel.java:382）', () => {
  assert.equal(terminalWheelZoomApplies({ ctrlKey: true }, true), true)
  assert.equal(terminalWheelZoomApplies({ metaKey: true }, true), true, 'mac 上是 Cmd')
  assert.equal(terminalWheelZoomApplies({ ctrlKey: true }, false), false, '总闸关掉 ⇒ 照常滚缓冲区')
  assert.equal(terminalWheelZoomApplies({ shiftKey: true }, true), false, '光滚不改字号')
})

test('启用判定与提示文案把上下限说清楚', () => {
  assert.deepEqual(terminalFontSizeReason(13), { canIncrease: true, canDecrease: true })
  assert.equal(terminalFontSizeReason(40).canIncrease, false)
  assert.equal(terminalFontSizeReason(4).canDecrease, false)
  assert.match(terminalFontSizeTitle(13, 13), /^终端字号 13px（范围 4–40px）$/)
  assert.match(terminalFontSizeTitle(18, 13), /临时缩放/, '缩放后要写明这是临时的')
})

test('消费链：面板挂 Ctrl+滚轮（越界不滚缓冲区）与工具条那三枚按钮', () => {
  const panel = readFileSync(new URL('../src/components/TerminalPanel.vue', import.meta.url), 'utf8')
  assert.match(panel, /terminalWheelZoomApplies\(event, WHEEL_FONT_ZOOM_ENABLED\)/, '先过上游那道双条件门')
  assert.match(panel, /event\.preventDefault\(\)/, '缩放时不再滚缓冲区（那条分支 return）')
  assert.match(panel, /terminalFontSizeForWheel\(pane\.fontSize, event\.deltaY\)/, '滚轮那一档走纯函数')
  assert.match(panel, /addEventListener\('wheel',.*\{ passive: false \}\)/, 'preventDefault 要 passive: false')
  assert.match(panel, /fontSize: TERMINAL_BASE_FONT_SIZE/, 'xterm 建实例的基准字号就是那个常量')
  assert.match(panel, /changeTerminalFontSize\(pane\.fontSize, step\)/, '工具条放大/缩小走纯函数')
  assert.match(panel, /resetTerminalFontSize\(TERMINAL_BASE_FONT_SIZE\)/, '复位交回基准')
  assert.match(panel, /terminalFontSizeTitle\(fontSizeShown/, '字号读数写明是否临时缩放')
  assert.doesNotMatch(panel, /localStorage/, '缩放是会话内的，不写设置也不写盘')
})
