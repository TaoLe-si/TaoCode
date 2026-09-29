// 标签右侧那组动作按钮（IDEA `ActionPanel` + `EditorTabbedContainer` 的两组合并）。
//
// 上游读过原文的两处：
//   · `ActionPanel.java`：标签右侧排**多个**动作按钮的容器。
//     `update()`（`:118-146`）对每个按钮跑一次 `AnAction.update`，`myInplaceButton.setVisible(p.isEnabled() && p.isVisible())`
//     —— **不可用或不可见的动作就整个不画**（不是灰着）；`myActionsIsVisible = anyVisible`，
//     `getPreferredSize()`（`:158-160`）在没有任何可见动作时返回 **0×0**（连位置都不占）。
//     悬停语义在 `setAutoHide`/`toggleShowActions`（`ActionButton.java:174-189`）：
//     `myAutoHide` 为真时按钮的 `painting` 跟着 show 走；为假时恒为 true（一直画）。
//   · `EditorTabbedContainer.kt:554-555`：每个编辑器标签挂
//     `DefaultActionGroup(editorActionGroup, closeTab)`；`:626-632` 里
//     `editorActionGroup = DefaultActionGroup(toolbarActions, source)`，其中
//     `toolbarActions` = `EditorTabsToolbarActions`（可被插件扩展的空组）、
//     `source` = `EditorTabsEntryPoint` —— 一个 `popup="true" icon="AllIcons.Actions.More"` 的
//     **常驻下拉**（`PlatformActions.xml:804-816`），成员是：
//     RecentFilesFallback · RecentLocations · GotoFile | CloseAllEditors · ReopenClosedTab |
//     Unsplit · UnsplitAll · ChangeSplitOrientation | ConfigureEditorTabs。
//
// 本仓的对应物：标签条右端一个常驻的 "更多" 下拉。成员只放**本仓真接得住**的那几条
// （其余登记不做，不放假行）—— 判定与「不可用时整行不画」的规则都在这里，UI 只负责渲染。
export interface TabEntryPointItem {
  id: string
  label: string
  /** 上游 `update()` 的 `p.isEnabled() && p.isVisible()`：为假时这一行整个不出现。 */
  enabled: boolean
  run: () => void
}

/**
 * 上游 `ActionPanel.getPreferredSize()`：一个可见动作都没有时返回 **0×0**（`:158-160`），
 * 也就是连那个"更多"按钮都不该画出来 —— 点了没反应的下拉同样是假控件。
 */
export function entryPointHasActions(items: readonly TabEntryPointItem[]): boolean {
  return items.some(item => item.enabled)
}

/**
 * 过滤出真正要画的成员 —— 上游是"逐个 `update()`，`visible = enabled && visible`"，
 * 所以**不可用的直接不出现**（与 `ToolWindowGearEntry.hideWhenDisabled` 同一条纪律）。
 */
export function visibleEntryPointItems(items: readonly TabEntryPointItem[]): TabEntryPointItem[] {
  return items.filter(item => item.enabled)
}
