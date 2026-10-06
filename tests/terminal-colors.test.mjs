// `src/terminalColors.ts` 的判据：ANSI 色号 → 颜色的上游回退语义、256 色立方、xterm 主题映射。
//
// 上游依据：`TerminalColorPalette.kt:19-36` 的 getForegroundByColorIndex/getBackgroundByColorIndex
// （属性缺席时退回另一个颜色、再退回默认），`JBTerminalSchemeColorPalette.kt:14-26` 的默认前景/背景
// 来自配色方案，jediterm `ColorPalette` 的 0..255 色号。

import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

import {
  ANSI_DARK_COLORS, ANSI_LIGHT_COLORS, colorByAnsiIndex, getBackgroundByColorIndex, getForegroundByColorIndex,
  resolveTerminalThemeName, terminalPalette, terminalXtermTheme,
} from '../src/terminalColors.ts'

test('属性回退：前景 → 背景 → 默认前景；背景方向对称', () => {
  const palette = {
    defaultForeground: '#f0f0f0',
    defaultBackground: '#101010',
    attributes: { 1: { foreground: '#ff0000' }, 2: { background: '#00ff00' }, 3: {} },
  }
  assert.equal(getForegroundByColorIndex(palette, 1), '#ff0000')
  assert.equal(getForegroundByColorIndex(palette, 2), '#00ff00', '没有前景时退回背景')
  assert.equal(getForegroundByColorIndex(palette, 3), '#f0f0f0', '两者都没有用默认前景')
  assert.equal(getForegroundByColorIndex(palette, 9), '#f0f0f0', '色号缺席同样是默认前景')
  assert.equal(getBackgroundByColorIndex(palette, 1), '#ff0000', '背景方向：没有背景退回前景')
  assert.equal(getBackgroundByColorIndex(palette, 2), '#00ff00')
  assert.equal(getBackgroundByColorIndex(palette, 3), '#101010')
})

test('256 色：0..15 走调色板，16..231 是 6×6×6 立方，232..255 是灰阶', () => {
  const palette = terminalPalette('dark')
  assert.equal(colorByAnsiIndex(palette, 0), ANSI_DARK_COLORS[0])
  assert.equal(colorByAnsiIndex(palette, 15), ANSI_DARK_COLORS[15])
  assert.equal(colorByAnsiIndex({ ...palette, attributes: {} }, 1), palette.defaultForeground, '调色板坏掉时不许抛错')
  assert.equal(colorByAnsiIndex(palette, 16), '#000000')
  assert.equal(colorByAnsiIndex(palette, 21), '#0000ff')
  assert.equal(colorByAnsiIndex(palette, 231), '#ffffff')
  assert.equal(colorByAnsiIndex(palette, 232), '#080808')
  assert.equal(colorByAnsiIndex(palette, 255), '#eeeeee')
})

test('xterm 主题：16 键与默认色都从调色板来（亮色档 8..15 各归各位）', () => {
  const theme = terminalXtermTheme(terminalPalette('dark', '#e0e0e0', '#202020'))
  assert.equal(theme.background, '#202020')
  assert.equal(theme.foreground, '#e0e0e0')
  assert.equal(theme.cursor, '#e0e0e0')
  assert.equal(theme.cursorAccent, '#202020')
  assert.equal(theme.black, ANSI_DARK_COLORS[0])
  assert.equal(theme.brightWhite, ANSI_DARK_COLORS[15])
  assert.equal(theme.red, ANSI_DARK_COLORS[1])
  assert.equal(theme.brightBlue, ANSI_DARK_COLORS[12])
  const keys = Object.keys(theme)
  assert.equal(keys.length, 20)
  for (const key of keys) assert.match(theme[key], /^#[0-9a-f]{6}$/i, `${key} 必须是可渲染的颜色`)
})

test('深浅两套表不同；坏颜色串退回内置默认；主题名解析缺省浅色', () => {
  const dark = terminalPalette('dark', 'red', 'not-a-color')
  assert.equal(dark.defaultForeground, '#d4d4d4')
  assert.equal(dark.defaultBackground, '#1e1e1e')
  assert.notDeepEqual(ANSI_DARK_COLORS, ANSI_LIGHT_COLORS)
  assert.equal(terminalPalette('light').attributes[0].foreground, ANSI_LIGHT_COLORS[0])
  assert.equal(resolveTerminalThemeName('dark'), 'dark')
  assert.equal(resolveTerminalThemeName('light'), 'light')
  assert.equal(resolveTerminalThemeName(undefined), 'light', 'tokens.css 的 :root 是浅色面')
})

test('按色号覆盖（上游 JBTerminalSchemeColorPalette.kt:23-25 逐色号回方案取值）：只改被覆盖的那一号', () => {
  const overridden = terminalPalette('dark', undefined, undefined, { 1: '#123456', 15: '#abcdef' })
  assert.equal(overridden.attributes[1].foreground, '#123456')
  assert.equal(overridden.attributes[15].foreground, '#abcdef')
  assert.equal(overridden.attributes[0].foreground, ANSI_DARK_COLORS[0], '没给覆盖的色号仍是内置表')
  assert.equal(colorByAnsiIndex(overridden, 1), '#123456', ' ANSI 1 号的使用方（面板/控制台）跟着走')
  assert.equal(colorByAnsiIndex(overridden, 16), '#000000', '16 之后的立方色不吃这张表')
  // 用户可见效果：xterm 主题那 16 个键里对应的 red / brightWhite 换成覆盖值，其余不动。
  const theme = terminalXtermTheme(overridden)
  assert.equal(theme.red, '#123456')
  assert.equal(theme.brightWhite, '#abcdef')
  assert.equal(theme.green, ANSI_DARK_COLORS[2])
})

test('覆盖表里的坏值/坏键一律丢弃（不许把 xterm 主题写坏）', () => {
  const palette = terminalPalette('dark', undefined, undefined, { 1: 'red', 2: '', 3: '  ', 20: '#ffffff', 4: '#F0F0F0' })
  assert.equal(palette.attributes[1].foreground, ANSI_DARK_COLORS[1], '非 # 记法不是颜色')
  assert.equal(palette.attributes[2].foreground, ANSI_DARK_COLORS[2], '空串 = 不覆盖')
  assert.equal(palette.attributes[20], undefined, '16 号以后不进这张表（属性里根本没有那个键）')
  assert.equal(palette.attributes[4].foreground, '#F0F0F0', '合法值原样采用（只去掉首尾空白）')
})

test('不传覆盖表时与改造前逐字节一致（默认路径没有行为变化）', () => {
  assert.deepEqual(terminalPalette('dark').attributes, terminalPalette('dark', undefined, undefined, {}).attributes)
  assert.deepEqual(terminalPalette('light', '#111111', '#eeeeee').attributes, terminalPalette('light', '#111111', '#eeeeee', undefined).attributes)
})

test('消费链：TerminalPanel 新建终端带主题、换主题时应用到所有窗格', () => {
  const panel = readFileSync(new URL('../src/components/TerminalPanel.vue', import.meta.url), 'utf8')
  assert.match(panel, /theme: terminalXtermTheme\(currentPalette\(\)\)/, '新建窗格要把调色板交给 xterm')
  assert.match(panel, /pane\.instance\.options\.theme = theme/, '换主题要重设已有窗格')
  assert.match(panel, /attributeFilter: \['data-theme'\]/, '监听 data-theme 切换')
  assert.match(panel, /getPropertyValue\('--text'\)/, '默认前景取当前配色方案')
  assert.match(panel, /getPropertyValue\('--editor'\)/, '默认背景取当前配色方案')
})
