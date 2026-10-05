// 终端字号的**放大 / 缩小 / 复位**（上游 `TerminalIncreaseFontSize` / `TerminalDecreaseFontSize` /
// `TerminalResetFontSize` 三条动作 + 它们背后的字号提供者）。
//
// 上游坐标（已核源码）：
//   · 动作登记 `platform/execution-impl/resources/intellij.platform.execution.impl.actions.xml:34-45`
//     —— 三条 id 分别指向 `TerminalChangeFontSizeAction$IncreaseEditorFontSize` /
//     `$DecreaseEditorFontSize` / `TerminalResetFontSizeAction`，键位 `use-shortcut-of` 编辑器的
//     `EditorIncreaseFontSize` / `EditorDecreaseFontSize` / `EditorResetFontSize`
//     （`platform/platform-impl/resources/intellij.platform.ide.impl.actions.xml:267-268`，
//     `$default` 里**没有**给这三条编辑器动作配键，只有第三方键映射才配 ——
//     `platform/platform-resources/src/keymaps/Sublime Text.xml:186-189` 是 `control ADD` /
//     `control EQUALS`）。所以本仓的键盘入口不能"照抄一个上游没有的键"；
//     真实存在的键盘/鼠标入口是下面这条滚轮：
//   · 滚轮缩放 `platform/execution-impl/src/com/intellij/terminal/JBTerminalPanel.java:381-390`：
//     `isWheelFontChangeEnabled()`（Settings › Editor › General › 「Change font size with Ctrl+Mouse Wheel」）
//     **且** `EditorUtil.isChangeFontSize(e)`（= Ctrl + 滚轮）时
//     `newFontSize = getTerminalFontSize() - e.getWheelRotation()`，
//     落在 `[getMinEditorFontSize(), getMaxEditorFontSize()]` 内才写入，否则**这次滚动什么也不做**；
//     并且这条分支 `return` 掉 —— 缩放时**不再滚动缓冲区**。
//   · 上下限 `platform/editor-ui-ex/src/com/intellij/application/options/EditorFontsConstants.java:11-17`
//     —— 最小 `scale(4)`、最大 `scale(ide.editor.max.font.size 默认 40)`。
//   · 动作侧的步进 `platform/execution-impl/src/com/intellij/openapi/editor/actions/TerminalChangeFontSizeAction.kt:26-28`
//     —— `Increase(1f)` / `Decrease(-1f)`；`:57-64` 同样是"越界就不改"；
//     `:66-68` `resetTerminalFontSize()` = 交回提供者。
//   · 「临时」语义 `platform/execution-impl/src/com/intellij/terminal/TerminalFontSizeProvider.kt:16-25`
//     —— `setFontSize` 的注释写明「Sets temporary font size **without changing the size in the settings**，
//     useful for temporary Zoom」，`resetFontSize()` 回到设置里的那一档；
//     `TerminalUiSettingsManager.kt:104-132` 是那份存储（`fontSize` 缓存 + `detectFontSize()` 从
//     控制台字号/演示模式取基准）。
//
// 本仓落点：基准字号 = `src/terminalFontSize.ts` 的 `TERMINAL_BASE_FONT_SIZE`（面板一直用的 13px），
// 缩放是**会话内临时**的（不写设置、不写 localStorage），复位回到基准。
// 消费方 `src/components/TerminalPanel.vue`：Ctrl+滚轮缩放、工具条上的「字号」两枚按钮与「复位」，
// 三条都走这里的纯函数，判据 tests/terminal-font-size.test.mjs。

/** `EditorFontsConstants.java:11-13` 的 `getMinEditorFontSize()`（scale(4)，本仓没有 UI 缩放 ⇒ 4）。 */
export const MIN_TERMINAL_FONT_SIZE = 4

/** `EditorFontsConstants.java:15-17` 的 `getMaxEditorFontSize()`（`ide.editor.max.font.size` 默认 40）。 */
export const MAX_TERMINAL_FONT_SIZE = 40

/** `TerminalChangeFontSizeAction.kt:26-28` 的两档步进。 */
export const FONT_SIZE_STEP_UP = 1
export const FONT_SIZE_STEP_DOWN = -1

/** 本仓终端面板一直使用的基准字号（`TerminalPanel.vue` 建 xterm 时的 `fontSize`，也是复位的靶子）。 */
export const TERMINAL_BASE_FONT_SIZE = 13

/**
 * `JBTerminalPanel.java:382-387` 的判定：新字号越界就**保持原值**（上游不夹、直接不改）。
 * 动作侧同一条规则在 `TerminalChangeFontSizeAction.kt:60-63`。
 */
export function changeTerminalFontSize(current: number, step: number,
                                       min = MIN_TERMINAL_FONT_SIZE, max = MAX_TERMINAL_FONT_SIZE): number {
  const next = current + step
  if (!Number.isFinite(next) || next < min || next > max) return current
  return next
}

/**
 * 滚轮那一档：`newFontSize = 当前字号 - e.getWheelRotation()`（`JBTerminalPanel.java:383`）。
 * 上游 wheelRotation 正值 = 往下滚（往小字号），所以是减号；本仓 WebView 的 `deltaY` 同号。
 */
export function terminalFontSizeForWheel(current: number, deltaY: number, min = MIN_TERMINAL_FONT_SIZE,
                                         max = MAX_TERMINAL_FONT_SIZE): number {
  const rotation = deltaY > 0 ? 1 : deltaY < 0 ? -1 : 0
  return changeTerminalFontSize(current, -rotation, min, max)
}

/** 复位的靶子 = 设置里的那一档（上游 `resetFontSize()` ⇒ `detectFontSize()`，见 `TerminalUiSettingsManager.kt:123-132`）。 */
export function resetTerminalFontSize(base: number = TERMINAL_BASE_FONT_SIZE): number {
  return base
}

/**
 * `JBTerminalPanel.java:382` 的门：`isWheelFontChangeEnabled()`（编辑器总闸）
 * **且** `EditorUtil.isChangeFontSize(e)`（Ctrl + 滚轮）。两个条件缺一个就照常滚缓冲区。
 */
export function terminalWheelZoomApplies(event: { ctrlKey?: boolean; metaKey?: boolean }, wheelEnabled: boolean): boolean {
  return wheelEnabled && (event.ctrlKey === true || event.metaKey === true)
}

/** 缩放后还能不能再放大/缩小（工具条两枚按钮的启用判定，越界那一档上游是"保持原值"，这里把原因说明白）。 */
export function terminalFontSizeReason(size: number): { canIncrease: boolean; canDecrease: boolean } {
  return { canIncrease: size < MAX_TERMINAL_FONT_SIZE, canDecrease: size > MIN_TERMINAL_FONT_SIZE }
}

/** 字号提示文案（工具条 title / aria-label 用，带上下限，用户能看懂为什么点不动）。 */
export function terminalFontSizeTitle(size: number, base: number): string {
  const bounds = `（范围 ${MIN_TERMINAL_FONT_SIZE}–${MAX_TERMINAL_FONT_SIZE}px）`
  return size === base ? `终端字号 ${size}px${bounds}` : `终端字号 ${size}px · 临时缩放${bounds}`
}
