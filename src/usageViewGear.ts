// Find（引用）窗口自己的那一组齿轮项 —— 上游 `additionalGearActions` 的第二个落点
// （第一个是项目视图的「行为」组，见 `src/components/ToolWindowView.vue` 的 `view-gear-menu`）。
//
// 上游：`UsageViewContentManagerImpl.java:114-116`
//   `DefaultActionGroup.createPopupGroup(IdeBundle.messagePointer("group.view.options"))`
//   然后 `gearActions.addAll(toggleAutoscrollAction, toggleSortAction, toggleNewTabAction)`
//   —— 组标题 = 视图选项（`IdeBundle.properties` 的 `group.view.options`），三条成员按这个顺序：
//   一键导航（`UIBundle.properties:23` "Navigate with Single Click"）、按字母顺序排列成员
//   （`UsageViewBundle.properties` 的 `sort.alphabetically.action.text`，状态在
//   `UsageViewSettings.isSortAlphabetically`）、在新标签页中打开结果
//   （`find.open.in.new.tab.action`，状态在 `FindUsagesSettings.showResultsInSeparateView`）。
//   这一组挂在这个窗口上（`toolWindow.setAdditionalGearActions`），所以**窗口出现它就在** ——
//   当前文件一条引用都没有时也在（本仓没有"空用法视图"这个形态，但组本身不随结果数消失）。
//
// 三条里只接了后两条，第三条（一键导航）需要结果列表的**选择模型**（单击选中 / 双击导航），
// 本仓的引用行是单击即导航 —— 没有选择态就做不出那个开关，点了没反应的勾选项是假控件，
// 逐条登记在 `docs/source-todo.md` §10。这里只给真能接住的行。
import type { MenuRow } from './menus/types'
import {
  USAGE_GROUP_BY_DIRECTORY_TITLE, USAGE_GROUP_BY_FILE_STRUCTURE_TITLE,
  USAGE_OPEN_IN_NEW_TAB_TITLE, USAGE_SORT_TITLE, USAGE_VIEW_OPTIONS_TITLE,
  referencesGroupByDirectory, referencesGroupByFileStructure, referencesInNewTab,
  referencesSortAlphabetically, usageSymbolsAvailable,
} from './referenceContents.ts'

/** 上游那个弹出组的标题（`action.group.by.title` = "Group By"，`UsageViewBundle.properties:19`）。 */
export const USAGE_GROUP_BY_TITLE = '分组'

/**
 * 当前底部内容是不是「用法视图」（IDEA 的 Find 窗口）。本仓只有引用那一格是 ——
 * output/run/problems/terminal 都不是这个窗口的内容，它们不该拿到这一组。
 */
export function isUsageView(activeContent: string): boolean {
  return activeContent === 'references'
}

/**
 * 给齿轮的行（`Record<id, MenuRow>`，键 = `src/menus/toolWindowGear.ts` 引用表里的 action）。
 * 不是用法视图时返回空表：那一组不会出现，而不是出现一组点了没用的行。
 */
export function usageViewGearRows(activeContent: string): Record<string, MenuRow> {
  if (!isUsageView(activeContent)) return {}
  const rows: MenuRow[] = [
    {
      id: 'usage.sortAlphabetically',
      title: USAGE_SORT_TITLE,
      keywords: 'sort alphabetically usages 按字母顺序',
      checked: () => referencesSortAlphabetically.value,
      run: () => { referencesSortAlphabetically.value = !referencesSortAlphabetically.value },
    },
    {
      id: 'usage.openInNewTab',
      title: USAGE_OPEN_IN_NEW_TAB_TITLE,
      keywords: 'open results in new tab separate view 新标签页 结果',
      checked: () => referencesInNewTab.value,
      run: () => { referencesInNewTab.value = !referencesInNewTab.value },
    },
  ]
  return {
    'usage.viewOptions': {
      id: 'usage.viewOptions',
      title: USAGE_VIEW_OPTIONS_TITLE,
      keywords: 'view options usages 视图选项',
      children: rows,
    },
    // Find 窗口工具条上那个 Group By 弹出组（`UsageViewImpl.java:1089-1098`）：本仓的引用面板
    // 没有自己的工具条（那一格是个 div），而这一组本来就属于"挂着内容的那个窗口"，所以落点选齿轮，
    // 与上面那组同一个 `contentsScoped` 口径。给出的两档按**上游弹出组里的先后**排：
    // `UsageGroupingRuleProviderImpl.java:77-78` 先 `UsageGrouping.DirectoryStructure`
    // 再 `UsageGrouping.FileStructure`。
    //   · `GroupByDirectoryStructureAction`（`actions/GroupByDirectoryStructureAction.java:10-26`，
    //     状态 = `UsageViewSettings.kt:102-103` 的 `isGroupByDirectoryStructure`，默认 false（`:26`））；
    //   · `GroupByFileStructureAction`（`actions/GroupByFileStructureAction.java:12-25`，
    //     状态 = `UsageViewSettings.kt:21` 的 `isGroupByFileStructure`，默认 **true**）—— 这一档就是
    //     「文件之下再分类 / 方法」，**只有宿主把符号交进来才给行**（`usageSymbolsAvailable()`）：
    //     没有符号源时切了不会有任何变化，那是假控件，宁可不出现。
    // 其余几档（Module / Scope / Usage Type / Flatten Modules / Short File Path / Package）
    // 逐条登记在报告 §6 —— 没有对应的分组规则就没有行。
    'usage.groupBy': {
      id: 'usage.groupBy',
      title: USAGE_GROUP_BY_TITLE,
      keywords: 'group by usages directory structure 分组 目录结构',
      children: [
        {
          id: 'usage.groupByDirectory',
          title: USAGE_GROUP_BY_DIRECTORY_TITLE,
          keywords: 'group by directory structure 按目录分组 目录结构',
          checked: () => referencesGroupByDirectory.value,
          run: () => { referencesGroupByDirectory.value = !referencesGroupByDirectory.value },
        },
        ...(usageSymbolsAvailable() ? [{
          id: 'usage.groupByFileStructure',
          title: USAGE_GROUP_BY_FILE_STRUCTURE_TITLE,
          keywords: 'group by file structure class method 按符号分组 文件结构 类 方法',
          checked: () => referencesGroupByFileStructure.value,
          run: () => { referencesGroupByFileStructure.value = !referencesGroupByFileStructure.value },
        }] : []),
      ],
    },
  }
}
