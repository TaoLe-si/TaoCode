// 项目视图自己那三条行为（IDEA `additionalGearActions`，`ProjectViewImpl.java:1169`
// 把 `actionGroup` 交给 `toolWindow.setAdditionalGearActions`，内容来自
// `platform/projectView/shared/resources/intellij.platform.projectView.xml:43-60` 的 Behavior 组）。
//
// 这一块是纯逻辑：三个开关各自决定一条路径。规则照上游：
//   1) `autoscrollToSource`（`ActionsBundle.properties:1455` "Open Files with Single Click"）
//      = 单击文件即打开，不必双击（`ProjectViewSharedSettings.kt:33`，默认 false）。
//   2) `autoscrollFromSource`（`:1453` "Always Select Opened File"）= 编辑器切标签时在树里选中该文件
//      （`AutoScrollFromSourceHandler.java:80` `selectInAlarm`：`editor != null && isShowing() && isAutoScrollEnabled()`；
//      开关一翻**立刻**同步一次当前选择，`:117-120` `setSelected` 里的 `updateCurrentSelection()`）。
//   3) `openInPreviewTab`（`UISettingsState.kt:75` `openInPreviewTabIfPossible`，默认 false，
//      键 `OPEN_IN_PREVIEW_TAB_IF_POSSIBLE`）= 从树里打开的文件进预览标签；
//      关掉时是**持久标签**（本仓 `openFile` 的 `preview` 参数就是这一层）。
export interface ProjectViewBehavior {
  autoscrollToSource: boolean
  autoscrollFromSource: boolean
  openInPreviewTab: boolean
}

/** 单击/双击树行之后要不要打开它。目录不算（那由 `expandNodesWithSingleClick` 管）。 */
export type TreeOpenDecision = 'open' | 'select-only'

export function treeClickOpensFile(behavior: ProjectViewBehavior, kind: 'file' | 'directory',
                                   clickCount: number): TreeOpenDecision {
  if (kind !== 'file') return 'select-only'
  // 上游把"单击"与"双击"分开：开关打开时单击就开；关着时只有双击开（本仓的 dblclick 路径）。
  if (behavior.autoscrollToSource) return 'open'
  return clickCount >= 2 ? 'open' : 'select-only'
}

/** 从树里打开文件时要不要进预览标签（`openFile(path, false, { preview })` 的那个参数）。 */
export function treeOpenUsesPreviewTab(behavior: ProjectViewBehavior): boolean {
  return behavior.openInPreviewTab
}

/**
 * 编辑器切换活动文件时，树要不要跟着选中它（`Always Select Opened File`）。
 * 没有打开任何文件（路径为空）时不动 —— 否则关掉所有标签会把树里的选中也清掉。
 */
export function shouldSelectInTree(behavior: ProjectViewBehavior, activePath: string): boolean {
  return behavior.autoscrollFromSource && Boolean(activePath)
}
