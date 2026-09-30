// 工具窗口内容宿主的上下文（`ToolWindowView` 的 `ctx`）—— 从 App.vue 搬出的一域（2026-09-27）。
//
// 为什么值得单独一个文件：它是**所有工具窗口面板的输入面**（files/git/vcslog/search/todo/outline/
// bookmarks/debug/history/tests/gradle 各自只读自己那几项），字段会随着每个面板的移植继续长；
// 放在宿主里既挤占了 App.vue，也让"某个面板到底依赖什么"看不出来。
//
// 做法沿用本仓已验证的「ctx 注入」：**注入宿主已有的 ref/函数本身**，内层对象字面量一个字都不用改
// （解构出同名标识符即可），所以字段里那句 `xxx.value` 的读写语义完全不变。
// 返回类型就写成 `ToolWindowViewContext`：每个箭头函数的参数类型靠它做**上下文推导**，
// 与搬过来之前一模一样（所以这里不需要手写任何 `any`）。
import { DEFAULT_BOOKMARKS_VIEW } from './bookmarksView.ts'
import { isDesktop, type BookmarksViewState } from './bridge.ts'
import { getProjectTreeState } from './projectTreeState'
import type { ToolWindowViewContext } from './components/ToolWindowView.vue'

/** 面板能从宿主拿到什么：每一项都是宿主里同名变量的**引用**（不是快照）。 */
export interface ToolViewContext {
  active: any
  activePath: any
  commitMessageSettings: any
  dropBookmark: any
  editorFor: any
  editorSettings: any
  evaluateRequest: any
  explorer: any
  fileTreeRef: any
  gitCompareWith: any
  gradleHost: any
  gradleViewContext: any
  historyEpoch: any
  leftView: any
  lspReady: any
  notify: any
  /** 面板的通知走这条（`src/notifications.ts` 的 `notifyFromPanel`：带 displayId 与动作按钮）。 */
  notifyFromPanel: any
  /** 激活某个工具窗口（上游 `showCommitCheckFailuresPanel` 那类"显示详细信息"的落点）。 */
  showToolWindow?: (id: string) => void
  onSearchOpen: any
  onSearchReplaced: any
  onTreeContext: any
  openFile: any
  openMnemonicPrompt: any
  openSettings: any
  outline: any
  projectSettings: any
  projectViewFileColor: (path: string, isDirectory?: boolean) => string | null
  refreshTree: any
  revealLocation: any
  revertHistory: any
  runConfigCwd: any
  runConfigProgram: any
  /** VCS 日志的显示开关写回（`project.settings.update` 那条通路）。 */
  saveVcsLog: (log: { showTagNames: boolean; showRootNames: boolean }) => unknown
  /** 还没保存的编辑器路径（宿主 `allTabs` 里 dirty 的那些）。 */
  dirtyPaths: () => string[]
  /** 保存某个路径（宿主 `save(findTab(path))`）。 */
  savePath: (path: string) => Promise<unknown>
  saveBookmarksView: any
  saveSettingsPatch: any
  searchPanelRef: any
  sortedAll: any
  syntheticNodes: any
  testRunnerRef: any
  todoSource: any
  /** 通知（IDEA 的 Notifications 工具窗口用它渲染列表）。 */
  noticeLog: any
  /** 通知中心在工具窗口里也有一份，动作按钮与 expire 都要能在那边跑。 */
  runNoticeAction?: (action: { label: string; run: () => void }) => void
  expireNotice?: (id: number) => void
  clearNotices: any
  workspace: any}

export function createToolViewContext(ctx: ToolViewContext): ToolWindowViewContext {
  const { active, activePath, runNoticeAction, expireNotice, commitMessageSettings, dropBookmark, editorFor, editorSettings, evaluateRequest, explorer, fileTreeRef, gitCompareWith, gradleHost, gradleViewContext, historyEpoch, leftView, lspReady, notify, notifyFromPanel, showToolWindow, onSearchOpen, onSearchReplaced, onTreeContext, openFile, openMnemonicPrompt, openSettings, outline, projectSettings, refreshTree, revealLocation, revertHistory, runConfigCwd, runConfigProgram, saveBookmarksView, saveSettingsPatch, saveVcsLog, dirtyPaths, savePath, searchPanelRef, sortedAll, syntheticNodes, testRunnerRef, todoSource, noticeLog, clearNotices, workspace } = ctx
  return {
  // Notifications 工具窗口（`intellij.platform.ide.impl.xml:1210`，anchor="right"）：
  // 复用状态栏那份通知列表，两个入口看到的是同一批 `notices`。
  noticeLog: noticeLog?.value ?? [], onClearNotices: clearNotices, onRunNoticeAction: runNoticeAction, onExpireNotice: expireNotice,
  root: workspace.value?.root ?? '',
  active: explorer.value && Boolean(workspace.value),
  workspace: workspace.value ? { root: workspace.value.root, name: workspace.value.name, entries: workspace.value.entries } : null,
  activePath: activePath.value,
  activeTabPath: active.value?.path ?? '',
  lspReady: lspReady.value,
  isDesktop,
  outline: outline.value,
  sortedBookmarks: sortedAll.value,
  historyEpoch: historyEpoch.value,
  todoPatterns: projectSettings.value.todoPatterns,
  todoSource: todoSource.value,
  treeEntries: workspace.value?.entries ?? [],
  syntheticNodes: syntheticNodes.value,
  indentGuides: editorSettings.value.showTreeIndentGuides,
  projectViewFileColor: ctx.projectViewFileColor,
  projectTreeState: getProjectTreeState(workspace.value?.root ?? ''),
  fileTreeRef: null,
  searchPanelRef: null,
  testRunnerRef: null,
  runConfigProgram: runConfigProgram.value,
  runConfigCwd: runConfigCwd.value,
  evaluateRequest: evaluateRequest.value,
  commitSettings: commitMessageSettings.value,
  activeFileText: active.value ? (editorFor(active.value.path)?.text() ?? active.value.content) : '',
  onSearchOpen: (payload: any) => onSearchOpen(payload as never),
  onSearchReplaced: payload => onSearchReplaced(payload as never),
  onReveal: target => { void revealLocation(target as never) },
  onBookmarkRemove: entry => dropBookmark(entry as never),
  onBookmarkAssign: () => openMnemonicPrompt(),
  onHistoryRevert: payload => revertHistory(payload as never),
  onTreeContext: payload => onTreeContext(payload as never),
  // 从树里打开：进不进预览标签由「用预览标签打开」开关定（IDEA `openInPreviewTabIfPossible`，
  // `UISettingsState.kt:75`）。树的 `behavior` 读的是同一份设置，两处不会各说各话。
  onTreeOpen: (path, preview: boolean) => void openFile(path, false, { preview }),
  onTreeError: message => notify(message, true),
  // 面板的通知与「显示详细信息」那条动作（上游 `notifyFromPanel` / `showCommitCheckFailuresPanel`）。
  notifyFromPanel, showToolWindow,
  bindSearchPanel: instance => { searchPanelRef.value = instance as never },
  bindFileTree: instance => { fileTreeRef.value = instance as never },
  diffContextLines: editorSettings.value.diffContextLines,
  vcsLogShowTagNames: projectSettings.value.vcsLog?.showTagNames ?? true,
  // 提交面板的两条宿主通道（第四十四批：`SaveCommittingDocumentsVetoer` 那一档要用）。
  dirtyPaths: () => dirtyPaths(),
  savePath: (path: string) => savePath(path),
  vcsLogShowRootNames: projectSettings.value.vcsLog?.showRootNames ?? true,
  // 日志窗口齿轮里的「标签名称」写回项目设置（与设置页那两个勾选项同一条通路）。
  onSetVcsLogTagNames: (value: boolean) => { void saveVcsLog({ showTagNames: value, showRootNames: projectSettings.value.vcsLog?.showRootNames ?? true }) },
  // Gradle 工具窗口（IDEA 的 `Gradle` tool window，默认停靠右侧）的 ctx：由状态域一次给出，
  // 免得这里抄十几行（`computed` 惰性求值，所以可以在 gradleHost 之前写这行）。
  ...gradleViewContext(gradleHost, { projectSettings, openSettings }),
  // 命名作用域（IDEA project.scopes）→ Find in Files 的范围下拉。
  scopes: projectSettings.value.scopes ?? [],
  moduleName: workspace.value?.name ?? '',
  gitCompareWith: gitCompareWith.value,
  bookmarksView: projectSettings.value.bookmarksView ?? DEFAULT_BOOKMARKS_VIEW,
  onUpdateBookmarksView: (patch: unknown) => { void saveBookmarksView(patch as Partial<BookmarksViewState>) },
  // 书签列表（上游 `ManagerState.groups`）：命名列表来自 `projectSettings.bookmarkLists`，
  // **默认列表**用历史字段 `bookmarks` 的内容（迁移规则：旧平铺列表 = 一张用项目名命名的默认列表，
  // 见 src/bookmarkLists.ts 的 `listsFromLegacy`）。
  bookmarkLists: [
    ...(projectSettings.value.bookmarkLists ?? []).filter((list: { isDefault: boolean }) => !list.isDefault)
      .map((list: { name: string; bookmarks: unknown[] }) => ({ name: list.name, isDefault: false, entries: list.bookmarks })),
    { name: workspace.value?.name ?? '默认', isDefault: true, entries: sortedAll.value },
  ],
  onFoldAll: () => fileTreeRef.value?.collapseAll(),
  onExpandAll: () => fileTreeRef.value?.expandAll(),
  onExpandRecursively: () => void fileTreeRef.value?.expandRecursively(),
  canExpandRecursively: () => fileTreeRef.value?.canExpandRecursively() ?? false,
  // IDEA 的 SelectInProjectView：把当前文件在项目视图里选中（必要时展开到它）。
  onSelectInProjectView: () => { if (!activePath.value) return; explorer.value = true; leftView.value = 'files'; void fileTreeRef.value?.reveal(activePath.value) },
  onRefreshTree: () => { void refreshTree() },
  compactIndents: editorSettings.value.compactTreeIndents,
  expandWithSingleClick: editorSettings.value.expandNodesWithSingleClick,
  onToggleCompactIndents: () => { void saveSettingsPatch({ compactTreeIndents: !editorSettings.value.compactTreeIndents }) },
  onToggleExpandWithSingleClick: () => { void saveSettingsPatch({ expandNodesWithSingleClick: !editorSettings.value.expandNodesWithSingleClick }) },
}
}
