// 编辑器字号的**上下限**（IDEA `EditorFontsConstants` + `ChangeEditorFontSizeAction`）。
//
// 上游两处来源，**不是同一个区间** —— 这正是本仓原先写成 10–32 时踩错的地方：
//   · 设置页 / 配色方案的夹取：`EditorFontsConstants.getMinEditorFontSize()` = `scale(4)`、
//     `getMaxEditorFontSize()` = `scale(SystemProperties.getIntProperty("ide.editor.max.font.size", 40))`
//     （`platform/editor-ui-ex/src/com/intellij/application/options/EditorFontsConstants.java:11-17`）。
//     `AbstractColorsScheme.setEditorFontSize`（`:324-326`）对每一次写入都 `checkAndFixEditorFontSize`
//     （即 `round(min, max, size)`，`:29-35`）；设置页的输入框也按同一对边界 clamp
//     （`AbstractFontOptionsPanel.java:109`）。
//   · **菜单动作**多一道更严的下界：`ChangeEditorFontSizeAction.actionPerformed`
//     （`platform/platform-impl/src/com/intellij/openapi/editor/actions/ChangeEditorFontSizeAction.java:48`）
//     只在 `unscaledSize >= 8 && unscaledSize <= getMaxEditorFontSize()` 时才应用 ——
//     所以「增大/减小字号」在 8 到 40 之间动，**不会**把你带到设置页允许的 4。
//
// 本仓是 WebView2 + CSS px，没有 IDE scale 这一层（`JBUIScale.scale` 恒等），所以直接取整数值。

/** `ide.editor.max.font.size` 的默认值（`EditorFontsConstants.java:16`）。 */
export const MAX_EDITOR_FONT_SIZE = 40

/** 设置页 / 配色方案的写入门槛（`EditorFontsConstants.java:11` 的 `scale(4)`）。 */
export const MIN_EDITOR_FONT_SIZE = 4

/** 菜单「增大/减小字号」的下界（`ChangeEditorFontSizeAction.java:48` 的 `>= 8`）。 */
export const MIN_ACTION_FONT_SIZE = 8

/** `checkAndFixEditorFontSize`（`EditorFontsConstants.java:29-35`）：夹到 [4, 40]。 */
export function clampEditorFontSize(size: number): number {
  return Math.max(MIN_EDITOR_FONT_SIZE, Math.min(MAX_EDITOR_FONT_SIZE, size))
}

/**
 * 菜单动作能否应用（`ChangeEditorFontSizeAction.java:48`）：**目标值**落在 `[8, 40]` 才动。
 * 注意判的是目标值而不是当前值 —— 上游先算出 `size = 当前 + step` 再判，所以从 8 往下按会被拒。
 */
export function actionFontSizeApplies(size: number): boolean {
  return size >= MIN_ACTION_FONT_SIZE && size <= MAX_EDITOR_FONT_SIZE
}

/** 按步长求下一个字号；越界时返回 null（= 动作不应用，`enabled` 为假）。 */
export function stepEditorFontSize(current: number, step: 1 | -1): number | null {
  const next = current + step
  return actionFontSizeApplies(next) ? next : null
}
