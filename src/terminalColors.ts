// 终端配色 —— 上游 `TerminalColorPalette`/`JBTerminalSchemeColorPalette`（execution-impl/terminal）
// 加 jediterm 的 `ColorPalette`，以及 `BlockTerminalColors.kt` 的键表。
//
// 上游行为（已核源码）：
//   · `TerminalColorPalette.kt:12-36`：抽象基类把「ANSI 色号 → 颜色」定成一张属性表 ——
//     `getForegroundByColorIndex` = 属性的前景，**没有前景就退回背景**，两者都没有才用默认前景；
//     `getBackgroundByColorIndex` 对称（背景 → 前景 → 默认背景）。
//     `JBTerminalSchemeColorPalette.kt:14-26` 的实现是从当前编辑器配色方案
//     （`EditorColorsScheme` 的 ConsoleViewContentType 键与 `ColoredOutputTypeRegistryImpl` 的 ANSI 键）取值，
//     默认前景/背景取 `ConsoleViewContentType.NORMAL_OUTPUT_KEY` / `CONSOLE_BACKGROUND_KEY`。
//   · `BlockTerminalColors.kt:14-17` 另有一组块终端的默认前景/背景键（BLOCK_TERMINAL_*）。
//
// 本仓：xterm.js 自己解析 ANSI 流并按 `theme` 渲染，所以这一层要提供的就是**那套配色方案**：
// 16 个基本色 + 默认前景/背景（外加光标色）。默认色不写死 —— 由调用方从当前主题
// （`tokens.css` 的 `--text`/`--editor`）读出来传进来，对应上游"配色方案驱动"的口径；
// 16 色表分深/浅两套（本仓的配色是我们的，几何是源码的，见 tokens.css 的说明）。

/** 一个 ANSI 色号对应的属性（`TextAttributes` 的前景/背景两个字段）。 */
export interface TerminalTextAttributes {
  foreground?: string
  background?: string
}

/** `TerminalColorPalette` 的数据面：默认前景/背景 + 0..15 的属性表。 */
export interface TerminalColorPalette {
  defaultForeground: string
  defaultBackground: string
  attributes: Readonly<Record<number, TerminalTextAttributes>>
}

/** 标准 ANSI 16 色（深色底；xterm 的默认表）。 */
export const ANSI_DARK_COLORS: readonly string[] = [
  '#000000', '#cd0000', '#00cd00', '#cdcd00', '#0000ee', '#cd00cd', '#00cdcd', '#e5e5e5',
  '#7f7f7f', '#ff0000', '#00ff00', '#ffff00', '#5c5cff', '#ff00ff', '#00ffff', '#ffffff',
]

/** 浅色底的一套：基本色整体压暗、亮色只降到仍可读的档（白底上亮黄/亮青会看不见）。 */
export const ANSI_LIGHT_COLORS: readonly string[] = [
  '#000000', '#a80000', '#007d00', '#8a7000', '#0000c8', '#a800a8', '#007d7d', '#3f3f3f',
  '#666666', '#c80000', '#009500', '#a88a00', '#0000ff', '#c800c8', '#009595', '#101010',
]

/** 上游 `getForegroundByColorIndex`：前景 → 背景 → 默认前景。 */
export function getForegroundByColorIndex(palette: TerminalColorPalette, index: number): string {
  const attributes = palette.attributes[index]
  return attributes?.foreground ?? attributes?.background ?? palette.defaultForeground
}

/** 上游 `getBackgroundByColorIndex`：背景 → 前景 → 默认背景。 */
export function getBackgroundByColorIndex(palette: TerminalColorPalette, index: number): string {
  const attributes = palette.attributes[index]
  return attributes?.background ?? attributes?.foreground ?? palette.defaultBackground
}

/** ANSI 色号 0..255 → 前景色：16 色走调色板，16..231 是 6×6×6 色立方，232..255 是灰阶。 */
export function colorByAnsiIndex(palette: TerminalColorPalette, index: number): string {
  if (index < 16) return getForegroundByColorIndex(palette, Math.max(0, index))
  if (index < 232) {
    const cube = index - 16
    const levels = [0, 95, 135, 175, 215, 255]
    const toHex = (value: number) => value.toString(16).padStart(2, '0')
    return `#${toHex(levels[Math.floor(cube / 36) % 6]!)}${toHex(levels[Math.floor(cube / 6) % 6]!)}${toHex(levels[cube % 6]!)}`
  }
  const gray = 8 + (Math.min(index, 255) - 232) * 10
  const hex = gray.toString(16).padStart(2, '0')
  return `#${hex}${hex}${hex}`
}

/** 校验一个颜色串像不像颜色（空串/垃圾一律丢，免得把 xterm 主题写坏）。 */
function pickColor(value: string | undefined, fallback: string): string {
  return value && /^#([0-9a-f]{3}|[0-9a-f]{6}|[0-9a-f]{8})$/i.test(value.trim()) ? value.trim() : fallback
}

export type TerminalThemeName = 'light' | 'dark'

/** `document.documentElement.dataset.theme` 的取值解析：缺省是浅色（tokens.css `:root` 就是浅色面）。 */
export function resolveTerminalThemeName(value: string | undefined | null): TerminalThemeName {
  return value === 'dark' ? 'dark' : 'light'
}

/**
 * 当前主题的调色板。`foreground`/`background` 传当前配色方案（`--text`/`--editor`）；
 * 空串或坏值退回两套内置默认（上游 `colorsScheme.defaultForeground/defaultBackground` 那一档）。
 */
export function terminalPalette(theme: TerminalThemeName, foreground?: string, background?: string): TerminalColorPalette {
  const fallbackForeground = theme === 'dark' ? '#d4d4d4' : '#1f1f1f'
  const fallbackBackground = theme === 'dark' ? '#1e1e1e' : '#ffffff'
  const colors = theme === 'dark' ? ANSI_DARK_COLORS : ANSI_LIGHT_COLORS
  const attributes: Record<number, TerminalTextAttributes> = {}
  colors.forEach((color, index) => { attributes[index] = { foreground: color } })
  return {
    defaultForeground: pickColor(foreground, fallbackForeground),
    defaultBackground: pickColor(background, fallbackBackground),
    attributes,
  }
}

export interface TerminalXtermTheme {
  background: string
  foreground: string
  cursor: string
  cursorAccent: string
  black: string
  red: string
  green: string
  yellow: string
  blue: string
  magenta: string
  cyan: string
  white: string
  brightBlack: string
  brightRed: string
  brightGreen: string
  brightYellow: string
  brightBlue: string
  brightMagenta: string
  brightCyan: string
  brightWhite: string
}

/**
 * 调色板 → xterm 的 `theme`。每个键都经过 `getForegroundByColorIndex`（于是"属性缺席时退回默认"
 * 这套上游语义就在真实渲染路径上，而不是只活在测试里）。
 */
export function terminalXtermTheme(palette: TerminalColorPalette): TerminalXtermTheme {
  const color = (index: number) => getForegroundByColorIndex(palette, index)
  return {
    background: palette.defaultBackground,
    foreground: palette.defaultForeground,
    cursor: palette.defaultForeground,
    cursorAccent: palette.defaultBackground,
    black: color(0), red: color(1), green: color(2), yellow: color(3),
    blue: color(4), magenta: color(5), cyan: color(6), white: color(7),
    brightBlack: color(8), brightRed: color(9), brightGreen: color(10), brightYellow: color(11),
    brightBlue: color(12), brightMagenta: color(13), brightCyan: color(14), brightWhite: color(15),
  }
}
