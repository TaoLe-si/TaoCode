// 控制台**字体**（上游配色方案里的 Console Font ⇄ `ConsoleViewUtil` 把控制台编辑器接到它上面）。
//
// 上游坐标（已核源码）：
//   · 字号/字体名/行距/字重是**配色方案**的一档，不在每个控制台身上：
//     `platform/editor-ui-api/src/com/intellij/openapi/editor/colors/EditorColorsScheme.java:121`
//     （`String getConsoleFontName()`）、`:125`（`int getConsoleFontSize()`）、`:130` 起
//     （`float getConsoleFontSize2D()`）；序列化键名
//     `platform/editor-ui-ex/src/com/intellij/openapi/editor/colors/impl/AbstractColorsScheme.java:76`
//     `CONSOLE_FONT_NAME` / `:91` `CONSOLE_FONT_SIZE` / `:74` `console-font`（`FontPreferences`）。
//   · 控制台**真的用它**：`platform/platform-impl/src/com/intellij/execution/impl/ConsoleViewUtil.java:128-161`
//     的 `updateConsoleColorScheme(scheme)` 把方案的编辑器字体整片改成控制台那档 ——
//     `getEditorFontSize() => getConsoleFontSize()`、`getEditorFontName() => getConsoleFontName()`、
//     `getLineSpacing() => getConsoleLineSpacing()`、`getFontPreferences() => getConsoleFontPreferences()`。
//   · 设置页面 = Settings › Editor › Color Scheme › **Console Font**：
//     `platform/platform-impl/src/com/intellij/application/options/colors/ConsoleFontOptions.java:27-124`
//     （`setFontSize(float) ⇒ getCurrentScheme().setConsoleFontSize(...)`、`getLineSpacing() ⇒
//     getConsoleLineSpacing()`、`setCurrentLineSpacing(...)`；「用编辑器字体」那条委托
//     `setUseEditorFontPreferencesInConsole()`）。
//   · 上下限 `platform/editor-ui-ex/src/com/intellij/application/options/EditorFontsConstants.java:11-17`
//     （字号 `scale(4)`–`ide.editor.max.font.size` 默认 40，与终端共用同一档）与 `:18-22`
//     （行距 `.6`–`3`）。默认字号 `getDefaultEditorFontSize() = scale(12)`（`:19-21`）。
//
// 本仓落点：设置档 = `src/consoleFont.ts`（localStorage，与 `src/consoleEncoding.ts` 的默认编码同一形状）；
// 消费点 `src/components/RunConsole.vue` 的输出节点 `.run-log`（`consoleFontCss` 出来的内联样式）。
// **未采用字体名/字重/连字**：本仓只有 `--font-mono` 一个等宽族令牌（`src/tokens.css:7`，本轮 `ui-reason` 独占），
// 也没有字体枚举通道，列出「可用字体」就是放假控件 ⇒ 只做字号与行距两档（见报告「仍缺」）。
//
// 与上游的两点差异（如实记录，不假装一致）：
//   · 上游把这三档写进配色方案文件、在 Console Font 页里改；本仓写在 localStorage、在控制台工具条上改
//     （`SettingsDialog.vue` 是共享组装层且有硬上限，本轮不改）；
//   · 上游默认行距是 `FontPreferences.DEFAULT_LINE_SPACING = 1.2`
//     （`platform/editor-ui-api/src/com/intellij/openapi/editor/colors/FontPreferences.java:23`），
//     本仓默认取 **1.6** —— 那正是改造前 `.run-log` 的 `font: 12px/1.6`，取 1.2 会改变既有渲染。
//
// 判据 tests/console-font.test.mjs。

import { FONT_SIZE_STEP_DOWN, FONT_SIZE_STEP_UP, MAX_TERMINAL_FONT_SIZE, MIN_TERMINAL_FONT_SIZE } from './terminalFontSize.ts'

/** 上游 `EditorFontsConstants.java:11-13`（`scale(4)`）—— 与终端同一档，边界只有一处实现。 */
export const MIN_CONSOLE_FONT_SIZE = MIN_TERMINAL_FONT_SIZE

/** 上游 `EditorFontsConstants.java:15-17`（`ide.editor.max.font.size` 默认 40）。 */
export const MAX_CONSOLE_FONT_SIZE = MAX_TERMINAL_FONT_SIZE

/** 上游 `EditorFontsConstants.java:18-20` 的 `getMinEditorLineSpacing() = .6f`。 */
export const MIN_CONSOLE_LINE_SPACING = 0.6

/** 上游 `EditorFontsConstants.java:21-22`（`getMaxEditorLineSpacing() = 3f`）。 */
export const MAX_CONSOLE_LINE_SPACING = 3

/** 工具条两枚按钮的步进（`FONT_SIZE_STEP_UP/DOWN`，与终端那对动作同一档）。 */
export const CONSOLE_FONT_SIZE_STEP_UP = FONT_SIZE_STEP_UP
export const CONSOLE_FONT_SIZE_STEP_DOWN = FONT_SIZE_STEP_DOWN

export interface ConsoleFontSettings {
  /** 字号（px）。 */
  size: number
  /** 行距倍数（上游 `FontPreferences` 的行距档）。 */
  lineSpacing: number
}

/**
 * 缺省档 = 改造前 `.run-log` 的 `font: 12px/1.6 var(--font-mono)`
 * （字号取上游 `EditorFontsConstants.getDefaultEditorFontSize()` 的 12，行距见文件头第二条差异）。
 */
export const DEFAULT_CONSOLE_FONT: ConsoleFontSettings = { size: 12, lineSpacing: 1.6 }

export const CONSOLE_FONT_KEY = 'taocode.consoleFont'

export interface ConsoleFontStore {
  getItem(key: string): string | null
  setItem(key: string, value: string): void
}

/** 字号：越界/坏值一律夹回 `[4, 40]`（上游那个组合框只列得下界内的值）。 */
export function clampConsoleFontSize(size: unknown): number {
  const value = typeof size === 'number' ? size : Number(size)
  if (!Number.isFinite(value)) return DEFAULT_CONSOLE_FONT.size
  return Math.min(MAX_CONSOLE_FONT_SIZE, Math.max(MIN_CONSOLE_FONT_SIZE, Math.round(value)))
}

/** 行距：越界/坏值夹回 `[.6, 3]`（上游 `EditorFontsConstants:18-22`）。 */
export function clampConsoleLineSpacing(spacing: unknown): number {
  const value = typeof spacing === 'number' ? spacing : Number(spacing)
  if (!Number.isFinite(value)) return DEFAULT_CONSOLE_FONT.lineSpacing
  return Math.min(MAX_CONSOLE_LINE_SPACING, Math.max(MIN_CONSOLE_LINE_SPACING, Math.round(value * 100) / 100))
}

/** 把读到的任意形状收成一份合法设置；缺键/坏键各回各的默认（不是整份丢掉）。 */
export function normalizeConsoleFontSettings(raw: unknown): ConsoleFontSettings {
  const record = raw && typeof raw === 'object' ? raw as Record<string, unknown> : {}
  const size = record.size === undefined ? DEFAULT_CONSOLE_FONT.size : clampConsoleFontSize(record.size)
  const lineSpacing = record.lineSpacing === undefined
    ? DEFAULT_CONSOLE_FONT.lineSpacing : clampConsoleLineSpacing(record.lineSpacing)
  return { size, lineSpacing }
}

/** 读 localStorage 里那串 JSON（不可解析时回默认）。 */
export function loadConsoleFontSettings(raw: string | null | undefined): ConsoleFontSettings {
  if (!raw) return { ...DEFAULT_CONSOLE_FONT }
  try {
    return normalizeConsoleFontSettings(JSON.parse(raw))
  } catch {
    return { ...DEFAULT_CONSOLE_FONT }
  }
}

export function readConsoleFontSettings(store?: ConsoleFontStore): ConsoleFontSettings {
  try {
    const source = store ?? (typeof localStorage !== 'undefined' ? localStorage : undefined)
    return loadConsoleFontSettings(source?.getItem(CONSOLE_FONT_KEY) ?? null)
  } catch {
    return { ...DEFAULT_CONSOLE_FONT }
  }
}

export function saveConsoleFontSettings(store: ConsoleFontStore | undefined, settings: ConsoleFontSettings): void {
  const normalized = normalizeConsoleFontSettings(settings)
  try {
    const target = store ?? (typeof localStorage !== 'undefined' ? localStorage : undefined)
    target?.setItem(CONSOLE_FONT_KEY, JSON.stringify(normalized))
  } catch { /* 存储不可用时只影响本次会话的持久化（与 consoleEncoding 同口径） */ }
}

/** 复位那一档的靶子（上游 Console Font 页的 reset 回到方案里的值 ⇒ 本仓回到缺省）。 */
export function resetConsoleFontSettings(): ConsoleFontSettings {
  return { ...DEFAULT_CONSOLE_FONT }
}

export function isDefaultConsoleFont(settings: ConsoleFontSettings): boolean {
  return settings.size === DEFAULT_CONSOLE_FONT.size && settings.lineSpacing === DEFAULT_CONSOLE_FONT.lineSpacing
}

/**
 * 输出节点的内联样式。**默认档返回空对象** ⇒ 不写任何内联样式，`.run-log` 那条
 * `font: 12px/1.6 var(--font-mono)` 照旧生效（改造前的渲染逐字不变）。
 * 字号只写 px 与行距倍数，字体族仍交给 `--font-mono` 令牌（本仓不做字体名覆盖，见文件头）。
 */
export function consoleFontCss(settings: ConsoleFontSettings): Record<string, string> {
  if (isDefaultConsoleFont(settings)) return {}
  return { fontSize: `${settings.size}px`, lineHeight: String(settings.lineSpacing) }
}

/** 工具条/aria 上那一句（带上下限，用户能看懂为什么点不动）。 */
export function consoleFontLabel(settings: ConsoleFontSettings): string {
  const bounds = `（字号 ${MIN_CONSOLE_FONT_SIZE}–${MAX_CONSOLE_FONT_SIZE}px，行距 ${MIN_CONSOLE_LINE_SPACING}–${MAX_CONSOLE_LINE_SPACING}）`
  const value = `控制台字体 ${settings.size}px · 行距 ${settings.lineSpacing}${bounds}`
  return isDefaultConsoleFont(settings) ? `${value} · 默认` : value
}

/** 步进后还能不能再放大/缩小（工具条两枚按钮的启用判定；越界那一档是"保持原值"）。 */
export function consoleFontSizeStep(size: number): { canIncrease: boolean; canDecrease: boolean } {
  return { canIncrease: size < MAX_CONSOLE_FONT_SIZE, canDecrease: size > MIN_CONSOLE_FONT_SIZE }
}

/** 改字号：越界**保持原值**（`EditorFontsConstants` 的界内语义，与终端 `changeTerminalFontSize` 同一条）。 */
export function changeConsoleFontSize(size: number, step: number): number {
  const next = clampConsoleFontSize(size) + step
  if (next < MIN_CONSOLE_FONT_SIZE || next > MAX_CONSOLE_FONT_SIZE) return clampConsoleFontSize(size)
  return next
}

/**
 * 编辑器的「Ctrl+滚轮缩放字号」语义（`platform/platform-impl/.../EditorImpl` 那条通用分支：
 * 门 = `EditorSettingsExternalizable.isWheelFontChangeEnabled()` **且** `EditorUtil.isChangeFontSize(e)`）。
 * 控制台正文在编辑器的位置 ⇒ 与终端面板同一个门与同一条步进（`FONT_SIZE_STEP_UP/DOWN`）；
 * 判定只在 `src/terminalFontSize.ts` 写一次，这里按控制台名义再导出，避免两处口径漂移。
 */
export function consoleFontZoomApplies(event: { ctrlKey?: boolean; metaKey?: boolean }, wheelEnabled: boolean): boolean {
  return wheelEnabled && (event.ctrlKey === true || event.metaKey === true)
}

/** 滚轮那一档：往下滚 = 小字号（上游 `newFontSize = 当前 - wheelRotation`，本仓 `deltaY` 同号）。 */
export function consoleFontSizeForWheel(size: number, deltaY: number): number {
  const rotation = deltaY > 0 ? 1 : deltaY < 0 ? -1 : 0
  if (rotation === 0) return clampConsoleFontSize(size)
  return changeConsoleFontSize(size, rotation > 0 ? CONSOLE_FONT_SIZE_STEP_DOWN : CONSOLE_FONT_SIZE_STEP_UP)
}
