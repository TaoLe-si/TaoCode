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

/** 合成根里「临时文件与控制台」那一格用的图标名（`src/projectTreeModel.ts` 的 `SyntheticNode.icon`）。 */
export const SCRATCHES_NODE_ICON = 'scratches'

/**
 * 「显示临时文件和控制台」（`ProjectView.ShowScratchesAndConsoles`）：关掉时那一条**合成根本行**
 * 不出现在项目树里（外部库那一行不受它影响）。
 *
 * 上游四条坐标：
 *   · 齿轮 Appearance 组的成员与次序 ——
 *     `platform/projectView/shared/resources/intellij.platform.projectView.xml:81-84`
 *     （它排在 `ProjectView.CompactDirectories`（`:98-99`）与 `ProjectView.FileNesting`（`:101-102`）之前）；
 *   · 文案 —— `ActionsBundle.properties:1483` `action.ProjectView.ShowScratchesAndConsoles.text
 *     =Show Scratches and Consoles`（zh 语言包不在本地基准树里，界面用英文原文直译）；
 *   · 默认**开** —— `ViewSettings.java:54-56`（`ProjectViewSharedSettings.kt:28` 存的也是 true），
 *     所以「设置里没有这一项」= 显示；
 *   · 生效点 —— `ScratchTreeStructureProvider.java:199`（`if (!settings.isShowScratchesAndConsoles())
 *     return children;`：关着就不产出那一格）；写回之后
 *     `ProjectViewImpl.java:392-400` 的 `setSelected` 调的是 `updatePanes(true)` ⇒ **整棵窗格重建**
 *     （本仓对应 FileTree 那条「设置变更就 refresh 整树」的 watch）。
 *
 * 反过来，「显示库内容」这一格本仓**不做**，且理由不是「没有数据源」：上游 Project 窗格根本不支持它 ——
 * `ProjectViewPane.java:143-145` 把 `isShowLibraryContents()` 硬写 true，
 * `AbstractProjectViewPane.java:1029-1031` 的 `supportsShowLibraryContents()` 默认 false，
 * `ProjectViewImpl.java:491-495` 又按这个能力位决定这一格可不可点 ⇒ 在 Project 窗格里这一项是灰的。
 * 画一个按了什么都不改的复选框就违反「不放假控件」。
 */
export function visibleSyntheticNodes<T extends { icon: string }>(
  nodes: readonly T[], showScratchesAndConsoles: boolean | undefined,
): T[] {
  if (showScratchesAndConsoles ?? true) return [...nodes]
  return nodes.filter(node => node.icon !== SCRATCHES_NODE_ICON)
}

/**
 * 编辑器切换活动文件时，树要不要跟着选中它（`Always Select Opened File`）。
 * 没有打开任何文件（路径为空）时不动 —— 否则关掉所有标签会把树里的选中也清掉。
 */
export function shouldSelectInTree(behavior: ProjectViewBehavior, activePath: string): boolean {
  return behavior.autoscrollFromSource && Boolean(activePath)
}
