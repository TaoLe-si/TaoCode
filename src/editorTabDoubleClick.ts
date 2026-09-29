// 编辑器标签上**双击**的真实语义（判决表原写"就地重命名标签"，核对上游后是误读）。
//
// 上游两处，都读过原文：
//   · `TabLabel.kt:151-153` —— 标签自己的 `mouseClicked` 只做 `handlePopup(e)`，没有编辑器/文本域，
//     整个 `ui/tabs` 包里搜不到 rename 字样。
//   · `EditorTabbedContainer.kt:348-361` 的 `doProcessDoubleClick`：
//       ① 命中**预览标签**时先把它晋升为常驻（`composite.isPreview = false`，`:349-356`）；
//       ② 之后按两个 advancedSetting 决定要不要"最大化"：
//          `editor.maximize.on.double.click`（`intellij.platform.ide.impl.xml:1511`，默认 **true**）
//            = Hide All Tool Windows / Restore Windows；
//          `editor.maximize.in.splits.on.double.click`（`:1512`，默认 **false**）
//            = Maximize Editor / Normalize Splits。
//          两个都关着就直接 return（`:358-361`）。
//   双击落在**标签之外的空白**才走 `EditorWindow` 的 maximize（`:186-193` 命中标签时先 return 的是那个监听器）。
export interface EditorTabDoubleClickSettings {
  /** `editor.maximize.on.double.click`（默认 true）。 */
  hideToolWindowsOnDoubleClick: boolean
  /** `editor.maximize.in.splits.on.double.click`（默认 false）。 */
  maximizeInSplitsOnDoubleClick: boolean
}

export type EditorTabDoubleClickAction = 'promote-preview' | 'hide-tool-windows' | 'maximize-in-splits' | 'none'

/**
 * 双击标签该干什么（按上游的判断顺序）。
 * `isPreview` 为真时**只**晋升预览标签、不继续做最大化 —— 上游在那一步就 `return` 了（`:354`）。
 */
export function editorTabDoubleClickAction(isPreview: boolean,
                                          settings: EditorTabDoubleClickSettings): EditorTabDoubleClickAction {
  if (isPreview) return 'promote-preview'
  if (settings.hideToolWindowsOnDoubleClick) return 'hide-tool-windows'
  if (settings.maximizeInSplitsOnDoubleClick) return 'maximize-in-splits'
  return 'none'
}
