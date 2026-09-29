// 主菜单的「窗口」菜单（IDEA `WindowMenu`，`PlatformActions.xml:637-728`）——
// 从 App.vue 搬出的最后一个菜单域（此前 Edit/View/Navigate/Code/Refactor/Analyze/Build/Run/Tools/Git/Help
// 都已经各自成文件，只有 Window 还留在宿主里）。
//
// 为什么这次才拆：它引用的东西最多（停靠状态、标签页、布局、通知、进度面板、最大/还原、调整尺寸…），
// 而宿主此前一直贴着机检上限。做法沿用本仓已验证的「状态模块 + ctx 注入」：
// **注入的是宿主已有的变量本身**，块内代码一个字都不用改（解构出同名标识符即可），
// 这样"菜单行里那句注释指向源码哪一行"不会被搬运过程改坏。
//
// 行里的源码依据（每组都写在块内注释里）：LayoutsGroup `:641`、ActiveToolwindowGroup `:653-660`、
// EditorTabsGroup `:688-705`、BackgroundTasks `:637,723-726`、Notifications `:726-728`、
// ResizeToolWindowGroup `:680-686`、ToggleContentUiTypeMode `:680`，动作实现见
// `HideAllToolWindowsAction.kt:34-49`、`MaximizeToolWindowAction.java:26/59-62`、
// `ResizeToolWindowAction.java:96-98`、`WindowAction.java:113-131`。
import type { MenuRow } from './types'
import { referencesInNewTab } from '../referenceContents.ts'

export interface WindowMenuContext {
  /** 工具窗口行的工厂（宿主提供：它同时被别的菜单用）。 */
  toolWindow: (id: any, title: string, keywords: string, needsDesktop?: boolean) => MenuRow
  /** 工具窗口动作的状态与开关（`src/toolWindowActions.ts`）。 */
  active: { value: any }
  activeToolWindows: { value: string[] }
  toolWindowAvailable: (id: any) => boolean
  lastActiveId: (stack: readonly string[], available: (id: any) => boolean) => string | undefined
  jumpToLastToolWindow: () => unknown
  hideActiveToolWindow: () => unknown
  hideSideToolWindows: () => unknown
  hideBottomToolWindows: () => unknown
  focusedDock: () => 'bottom' | 'editor' | 'side'
  /** 隐藏全部工具窗口 / 恢复（两段文案的 toggle）。 */
  currentChrome: () => any
  savedChrome: { value: any }
  hideAllToolWindowsTitle: (current: any, saved: any) => string
  canHideAllToolWindows: (current: any, saved: any) => boolean
  toggleMaximizeEditor: () => unknown
  /** 最大化 / 还原当前工具窗口。 */
  maximizedSide: { value: any }
  canMaximize: (hasProject: boolean, explorerVisible: boolean) => boolean
  maximizeActiveToolWindow: () => unknown
  MAXIMIZE_SHORTCUT_LABEL: string
  /** 调整工具窗口尺寸（`src/toolWindowResize.ts`）。 */
  resizeTargetFor: (direction: 'left' | 'right' | 'up' | 'down') => unknown
  stretchToolWindow: (direction: 'left' | 'right' | 'up' | 'down') => unknown
  /** 工具窗口内的编辑器标签页动作。 */
  tabTargetCount: () => number
  selectNextTab: () => unknown
  selectPreviousTab: () => unknown
  closeActiveTab: () => unknown
  closeOtherTabsTarget: () => boolean
  closeOtherToolTabs: () => unknown
  closeAllTabsTarget: () => boolean
  closeAllToolTabs: () => unknown
  /** 底部 dock 的内容呈现方式（tabbed / combo）。 */
  /** 当前内容的内容条形态（`WindowInfo.contentUiType`，由 `src/toolWindowStripes.ts` 自持）。 */
  contentUiType: () => any
  /** 切**当前**内容的形态（上游 `ToggleContentUiTypeAction` 作用在活动工具窗口上）。 */
  toggleContentUiType: () => void
  isTabbedContentUi: (mode: any) => boolean
  canToggleContentUiType: (count: number) => boolean
  activeContentCount: () => number
  toggledContentUiType: (tabbed: boolean) => any
  /** 状态栏 / 进度面板 / 通知。 */
  progressOpen: { value: boolean }
  noticeLog: { value: readonly unknown[] }
  closeFirstNotification: () => unknown
  clearNotices: () => unknown
  /** 宿主已有的导航与开关。 */
  workspace: { value: unknown }
  explorer: { value: boolean }
  bottom: { value: boolean }
  groups: any
  allProblems: { value: readonly unknown[] }
  showOutput: (id: any) => unknown
  openSettings: (section?: any) => unknown
  /** `PinToolwindowTab`：标题按当前那条 content 的钉住状态换，只有引用内容可钉。 */
  pinTabTitle: () => string
  canPinToolwindowTab: () => boolean
  togglePinToolwindowTab: () => void
}

export function createWindowMenuRows(ctx: WindowMenuContext): MenuRow[] {
  // 解构出同名标识符：下面这块是从 App.vue **原样**搬过来的（除本行外一个字都没改）。
  const {
    toolWindow, active, activeToolWindows, toolWindowAvailable, lastActiveId, jumpToLastToolWindow,
    hideActiveToolWindow, hideSideToolWindows, hideBottomToolWindows, focusedDock, currentChrome,
    savedChrome, hideAllToolWindowsTitle, canHideAllToolWindows, toggleMaximizeEditor, maximizedSide,
    canMaximize, maximizeActiveToolWindow, MAXIMIZE_SHORTCUT_LABEL, resizeTargetFor, stretchToolWindow,
    tabTargetCount, selectNextTab, selectPreviousTab, closeActiveTab, closeOtherTabsTarget, closeOtherToolTabs,
    closeAllTabsTarget, closeAllToolTabs, contentUiType, toggleContentUiType, isTabbedContentUi, canToggleContentUiType,
    activeContentCount, toggledContentUiType, progressOpen, noticeLog, closeFirstNotification, clearNotices,
    workspace, explorer, bottom, groups, allProblems, showOutput, openSettings,
    pinTabTitle, canPinToolwindowTab, togglePinToolwindowTab,
  } = ctx
  return [
// IDEA's Window menu (PlatformActions.xml WindowMenu): layout switcher first,
// then the activate-* tool-window rows, editor-tabs group, notifications. Rows
// for search-everywhere/bookmarks live in Navigate/Code, not here.
  toolWindow('files', '激活 项目 工具窗口', 'activate project tool window 项目'),
  toolWindow('git', '激活 本地更改 工具窗口', 'activate commit changes tool window 本地更改'),
  toolWindow('search', '激活 查找 工具窗口', 'activate find in files tool window 查找'),
  toolWindow('outline', '激活 结构 工具窗口', 'activate structure tool window 结构'),
  toolWindow('todo', '激活 待办事项 工具窗口', 'activate todo tool window 待办'),
  toolWindow('bookmarks', '激活 书签 工具窗口', 'activate bookmarks tool window 书签'),
  toolWindow('debug', '激活 调试 工具窗口', 'activate debug tool window 调试', true),
  { id: 'window.activateTerminal', title: '激活 终端 工具窗口', keys: 'Alt F12', keywords: 'activate terminal tool window 终端', enabled: () => Boolean(workspace.value), run: () => showOutput('terminal') },
  { id: 'window.activateOutput', title: '激活 输出 工具窗口', keywords: 'activate output tool window 输出', enabled: () => Boolean(workspace.value), run: () => showOutput('output') },
  { id: 'window.activateProblems', title: '激活 问题 工具窗口', keywords: 'activate problems tool window 问题', enabled: () => allProblems.value.length > 0, run: () => showOutput('problems') },
  // WindowMenu › ActiveToolwindowGroup —— IDEA 里是**子菜单**（`<group id="ActiveToolwindowGroup" popup="true">`，PlatformActions.xml:652）：
  // 它自己有 25 项，本仓有落点的 8 项收在下面。2026-09-27 的 UI 位置审计发现它们原先**摊在窗口菜单顶层** —— 源码里那个 popup 被丢掉了。
  // 上面那批「激活 XX 工具窗口」**不**属于这里：`ActivateToolWindowActions`（PlatformActions.xml:1310）不带 popup，是内联组，本来就该摊平。
  { id: 'window.activeToolwindowGroup', title: '激活工具窗口', keywords: 'activate tool window hide maximize resize jump 激活工具窗口 隐藏 最大化 调整 拉伸', children: [
    // WindowMenu > ActiveToolwindowGroup (`PlatformActions.xml:653-656`): the three narrower hides
    // come before HideAllWindows. In TaoCode a dock shows one window at a time, so hiding the active
    // window and hiding its side coincide for a docked one - they still differ for a bottom window.
    { id: 'window.hideActiveWindow', title: '隐藏当前工具窗口', keys: 'Shift Esc', keywords: 'hide active tool window 隐藏当前工具窗口', enabled: () => (focusedDock() === 'bottom' ? bottom.value : focusedDock() === 'side' ? explorer.value : lastActiveId(activeToolWindows.value, toolWindowAvailable) !== undefined), run: hideActiveToolWindow },
    { id: 'window.hideSideWindows', title: '隐藏侧边工具窗口', keywords: 'hide side tool windows 隐藏侧边', enabled: () => explorer.value, run: hideSideToolWindows },
    { id: 'window.hideBottomWindows', title: '隐藏底部工具窗口', keywords: 'hide bottom tool windows 隐藏底部', enabled: () => bottom.value, run: hideBottomToolWindows },
    // `PinToolwindowTab`（`intellij.platform.ide.impl.actions.xml:455` = `PinActiveTabAction.TW`）就排在
    // HideAllWindows 之后（`PlatformActions.xml:657`）。它钉的是**工具窗口的内容**：钉住的那条不会被下一次
    // 搜索顶替（`UsageViewContentManagerImpl.java:158`）。本仓只有引用那一格有多条 content，所以只在那里可用。
    { id: 'window.pinToolwindowTab', title: pinTabTitle, keywords: 'pin tab keep results 钉住 固定标签', enabled: () => canPinToolwindowTab(), run: togglePinToolwindowTab },
    // `find.open.in.new.tab.action`（`FindBundle.properties:23` "Open Results in New Ta&b"）是 Find 窗口
    // 齿轮里的那个勾选项（`UsageViewContentManagerImpl.java:59-74` 造它，`:114-116` 挂进齿轮组），
    // 状态存在 `FindUsagesSettings.showResultsInSeparateView`。本仓它同时出现在 Window 菜单里，
    // 因为这一格的齿轮只挂"工具窗口自己的动作"，而它是**搜索**的设置。
    { id: 'window.referencesInNewTab', title: '在新标签页中打开结果', keywords: 'open results in new tab find usages separate view 新标签页 结果', checked: () => referencesInNewTab.value, run: () => { referencesInNewTab.value = !referencesInNewTab.value } },
    // WindowMenu › HideAllWindows = `HideAllToolWindowsAction`, a *two-text* toggle: "Hide All
    // Windows" while anything is still visible, "Restore Windows" once only the saved layout is left
    // (`HideAllToolWindowsAction.kt:34-49`, texts `IdeBundle.properties:384-385`), disabled when
    // there is neither (`:36, :48`). ViewMenu (`PlatformActions.xml:521-597`) has no maximize item,
    // so this is the action's only row — the copy that used to sit in the View menu was dropped.
    { id: 'window.hideAllWindows', title: () => hideAllToolWindowsTitle(currentChrome(), savedChrome.value), keys: 'Ctrl Shift F12', keywords: 'hide all tool windows restore windows 隐藏所有工具窗口 恢复', enabled: () => canHideAllToolWindows(currentChrome(), savedChrome.value), run: toggleMaximizeEditor },
    // WindowMenu › ActiveToolwindowGroup (`PlatformActions.xml:653-660`) lists JumpToLastWindow
    // between PinToolwindowTab and MaximizeToolWindow. The action disables itself when no tool
    // window is left to go back to (`JumpToLastWindowAction.java:32-44`), which is what `enabled`
    // repeats here so the row cannot fire a no-op.
    { id: 'window.jumpToLastWindow', title: '跳到上一个工具窗口', keys: 'F12', keywords: 'jump to last tool window activate 上一个 最后 工具窗口', enabled: () => lastActiveId(activeToolWindows.value, toolWindowAvailable) !== undefined, run: jumpToLastToolWindow },
    // MaximizeToolWindowAction.java:26/59-62 — the action is a Toggleable whose text flips between
    // ActionsBundle `action.ResizeToolWindowMaximize.text` ("Maximize Tool Window") and `.text.alternative`
    // ("Restore Tool Window Size"); `$default.xml:885-887` binds control shift QUOTE.
    { id: 'window.maximizeToolWindow', title: () => (maximizedSide.value ? '恢复工具窗口大小' : '最大化工具窗口'), keys: MAXIMIZE_SHORTCUT_LABEL, keywords: 'maximize tool window restore size 最大化 恢复 工具窗口', enabled: () => canMaximize(Boolean(workspace.value), explorer.value), run: maximizeActiveToolWindow },
    // WindowMenu › EditorTabsGroup —— IDEA 里是**子菜单**（`<group id="EditorTabsGroup" popup="true">`，
    // PlatformActions.xml:688-705）。子项顺序照源码：NextTab · PreviousTab · PinActiveEditorTab ·
    // KeepTabOpen · TabList · (分隔) · CloseEditorsGroup（**不带** popup，是内联组：CloseContent /
    // CloseAllEditorsButActive / CloseAllEditors / CloseAllUnpinnedEditors / CloseAllToTheLeft …）。
    // TaoCode 有对应物的五项都在下面；内联组用一条分隔线表达同一层。
    { id: 'window.editorTabsGroup', title: '编辑器标签页', keywords: 'editor tabs next previous close 编辑器标签页 下一个 上一个 关闭', children: [
      { id: 'window.nextTab', title: '选择下一个标签页', keys: 'Alt Right', keywords: 'select next tab activate 下一个标签页', enabled: () => tabTargetCount() > 1, run: selectNextTab },
      { id: 'window.previousTab', title: '选择上一个标签页', keys: 'Alt Left', keywords: 'select previous tab activate 上一个标签页', enabled: () => tabTargetCount() > 1, run: selectPreviousTab },
      { id: 'window.ruleCloseEditors', rule: true },
      { id: 'window.closeActiveTab', title: '关闭当前标签页', keys: 'Ctrl Shift F4', keywords: 'close active tab tool window 关闭当前标签页', enabled: () => Boolean(workspace.value), run: closeActiveTab },
      { id: 'window.closeOtherTabs', title: '关闭其他标签页', keywords: 'close other tabs tool window 关闭其他标签页', enabled: closeOtherTabsTarget, run: closeOtherToolTabs },
      // `PlatformActions.xml:666` mounts TW.CloseAllTabs right after TW.CloseOtherTabs. Its shortcut
      // comes from `use-shortcut-of="CloseAllEditors"` (`intellij.platform.ide.impl.actions.xml:462`),
      // which has no entry in `$default.xml` at all — so no key is shown and none is invented.
      { id: 'window.closeAllTabs', title: '关闭所有标签页', keywords: 'close all tabs tool window 关闭所有标签页', enabled: closeAllTabsTarget, run: closeAllToolTabs },
    ] },
    // `ActiveToolwindowGroup`'s split family (`PlatformActions.xml:668-675`: TW.SplitRight,
    // TW.SplitAndMoveRight, TW.SplitDown, TW.SplitAndMoveDown, TW.Unsplit, TW.MoveToNextSplitter,
    // TW.MoveToPreviousSplitter) is absent on purpose: every one of them is gated on
    // `toolWindow.canSplitTabs()` (`ToolWindowSplitActions.kt:25`, `ToolWindowSplitAndMoveActions.kt:22`,
    // `ToolWindowUnsplitAction.kt:21`) *and* on a `ToolWindowSplitContentProvider` registered for that
    // tool window's id (`ToolWindowSplitContentProviderBean.getForToolWindow`), which is an
    // `@ApiStatus.Experimental` extension point no platform tool window implements — in this source
    // tree only the terminal frontend plugin registers one
    // (`plugins/terminal/frontend/resources/intellij.terminal.frontend.xml:95`). A tool window without
    // a provider cannot split at all, so the rows would be permanently dead here.
    //
    // `PlatformActions.xml:680` — ToggleContentUiTypeMode, between TW.MoveToGroup and ShowContent.
    // `ToggleContentUiTypeAction.isSelected` (`:10-12`) makes the **checked** state TABBED, and the
    // toggle is enabled only with more than one content (`:19-21`) — in TaoCode that is the bottom
    // dock alone, so the row stays inert while a single-view side window is the active one.
    // The label is the action's own text (`ActionsBundle.properties:1167` "Group Tabs", description
    // "Toggle between tabbed/combo presentation of contents").
    { id: 'window.toggleContentUiType', title: '合并标签页', keywords: 'group tabs toggle tabbed combo presentation 合并标签页 内容呈现', checked: () => isTabbedContentUi(contentUiType()), enabled: () => canToggleContentUiType(activeContentCount()), run: () => toggleContentUiType() },
    // WindowMenu › ActiveToolwindowGroup › ResizeToolWindowGroup —— IDEA 里这一组是**子菜单**
    // (`<group id="ResizeToolWindowGroup" popup="true">`, PlatformActions.xml:680-686，子项依次是
    // ResizeToolWindowLeft/Right/Up/Down)。以前用 section 标题顶替，现在菜单模型有 children，就真的做成子菜单。
    // 四行各自带源码的步长 (`ResizeToolWindowAction.java:96-98`, `WindowAction.java:113-118`) 与
    // 启用规则 (`:127-131`, `:161-165`)，实现在 `src/toolWindowResize.ts`。
    { id: 'window.resizeToolWindow', title: '调整工具窗口', keywords: 'resize stretch tool window 调整工具窗口 拉伸', children: [
      { id: 'window.resizeToolWindowLeft', title: '向左拉伸', keys: 'Ctrl Alt Shift ArrowLeft', keywords: 'resize stretch tool window left 向左拉伸 调整工具窗口', enabled: () => resizeTargetFor('left') !== null, run: () => stretchToolWindow('left') },
      { id: 'window.resizeToolWindowRight', title: '向右拉伸', keys: 'Ctrl Alt Shift ArrowRight', keywords: 'resize stretch tool window right 向右拉伸 调整工具窗口', enabled: () => resizeTargetFor('right') !== null, run: () => stretchToolWindow('right') },
      { id: 'window.resizeToolWindowUp', title: '向上拉伸', keys: 'Ctrl Alt Shift ArrowUp', keywords: 'resize stretch tool window top 向上拉伸 调整工具窗口', enabled: () => resizeTargetFor('up') !== null, run: () => stretchToolWindow('up') },
      { id: 'window.resizeToolWindowDown', title: '向下拉伸', keys: 'Ctrl Alt Shift ArrowDown', keywords: 'resize stretch tool window bottom 向下拉伸 调整工具窗口', enabled: () => resizeTargetFor('down') !== null, run: () => stretchToolWindow('down') },
    ] },
  ] },
  { id: 'window.rule4', rule: true },
  // WindowMenu › BackgroundTasks (`PlatformActions.xml:637,723-726`): ShowProcessWindow +
  // AutoShowProcessWindow. TaoCode's menus are flat, so the group becomes a section header — the
  // same treatment the other WindowMenu popup groups get. `ShowProcessWindowAction.java:16-55` is a
  // ToggleAction whose selected state *is* "the process popup is open" (`isProcessWindowOpen`,
  // `InfoAndProgressPanel.kt:574-576`), so it renders as a checkbox row, not a 显示/隐藏 title.
  // The second item, `AutoShowProcessPopupAction` (`AutoShowProcessPopupAction.java:12-24`), only
  // flips the registry key `ide.windowSystem.autoShowProcessPopup` (`registry.properties:209-210`),
  // read once at `InfoAndProgressPanel.kt:319-321`; it is a developer registry entry with no UI in
  // TaoCode, so no fake setting is invented for it (default `false` = don't auto-open, which is also
  // the behaviour TaoCode already has).
  { id: 'window.sectionBackgroundTasks', section: '后台任务' },
  { id: 'window.showProcessWindow', title: '显示进程窗口', keywords: 'show hide processes window background tasks 进程窗口 后台任务 运行中', checked: () => progressOpen.value, enabled: () => Boolean(workspace.value), run: () => { progressOpen.value = !progressOpen.value } },
  // WindowMenu › Notifications —— IDEA 里是**子菜单**（`<group id="Notifications" popup="true">`，
  // PlatformActions.xml:726-728），两个子项：CloseFirstNotification / CloseAllNotifications。
  { id: 'window.notifications', title: '通知', keywords: 'notifications close clear 通知 关闭 清空', children: [
    { id: 'window.closeFirstNotification', title: '关闭最新通知', keywords: 'close first notification 最新 关闭通知', enabled: () => noticeLog.value.length > 0, run: closeFirstNotification },
    { id: 'window.closeAllNotifications', title: '关闭全部通知', keywords: 'close all notifications 清空 全部关闭', enabled: () => noticeLog.value.length > 0, run: clearNotices },
  ] },
  { id: 'window.rule3', rule: true },
  { id: 'window.configureTabs', title: '编辑器标签页选项…', keywords: 'editor tabs configure pin tab placement 标签页设置', run: () => openSettings('editor.preferences.tabs') },
  { id: 'window.activeToolList', title: '配置工具按钮列表…', keywords: 'configure buttons active tool list 工具按钮', run: () => openSettings('preferences.lookFeel') },
  ]
}
