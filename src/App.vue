<script setup lang="ts">
import { computed, defineAsyncComponent, nextTick, onBeforeUnmount, onMounted, reactive, ref, unref, watch } from 'vue'
import { AnimatePresence, motion, useReducedMotion } from 'motion-v'
import {ArrowLeft, ArrowRight, Bookmark as BookmarkIcon, Braces, Bug, Check, ChevronDown, ChevronRight, ChevronsDownUp, ChevronsUpDown, CircleHelp, Code2, Columns2, Crosshair, FileCode2, Files, FlaskConical, FolderOpen, FolderTree, GitBranch, GitCommitHorizontal, GitGraph, Hammer, History, ListChecks, ListTree, Loader2, Lock, Menu, Moon, MoreHorizontal, MoreVertical, PanelBottom, PanelLeftClose, PanelLeftOpen, Pin, Play, Plus, RefreshCw, Rows3, Save, Search, ShieldCheck, SlidersHorizontal, Sparkles, Square, SquareTerminal, Sun, TerminalSquare, Trash2, Workflow, X, Zap} from 'lucide-vue-next'
import FileTree, { type SyntheticNode } from './components/FileTree.vue'; import TabEntryPoint from './components/TabEntryPoint.vue'
import SearchPanel from './components/SearchPanel.vue'
import SourceControl from './components/SourceControl.vue'
import VcsLog from './components/VcsLog.vue'
import OutlinePanel from './components/OutlinePanel.vue'
import DebugPanel from './components/DebugPanel.vue'
import DiffView from './components/DiffView.vue'
import TodoPanel from './components/TodoPanel.vue'
import HistoryPanel from './components/HistoryPanel.vue'
import TestRunnerPanel from './components/TestRunnerPanel.vue'
import BookmarksPanel from './components/BookmarksPanel.vue'
import TerminalPanel from './components/TerminalPanel.vue'
import MarkdownPreview from './components/MarkdownPreview.vue'
import WelcomePage from './components/WelcomePage.vue'
import PluginDialog from './components/PluginDialog.vue'
import RunConfigurationsDialog from './components/RunConfigurationsDialog.vue'
import ToolWindowView, { type ToolWindowViewContext } from './components/ToolWindowView.vue'
import SearchEverywhereDialog from './components/SearchEverywhereDialog.vue'
import SelectInPopup from './components/SelectInPopup.vue'
import ToolWindowAnchorMenu from './components/ToolWindowAnchorMenu.vue'; import EditorPopupMenu from './components/EditorPopupMenu.vue'; import ToolWindowGear from './components/ToolWindowGear.vue'
import ToolStripe from './components/ToolStripe.vue'
import { createSearchEverywhereHost } from './searchEverywhereHost'
import { createFileColorHost } from './fileColorsHost'
import ProjectDialog from './components/ProjectDialog.vue'
import ProjectStructureDialog from './components/ProjectStructureDialog.vue'
import MainToolbar, { type MainToolbarContext } from './components/MainToolbar.vue'
import BranchPopup from './components/BranchPopup.vue'
import SettingsDialog from './components/SettingsDialog.vue'
import ToolWindowHeader from './components/ToolWindowHeader.vue'
import NoticeList from './components/NoticeList.vue'
import { appFullScreen, appSetFullScreen, BridgeError, beginRun, clearLspDiagnostics, cloneProgress, gradleSync, lspProgressTasks, runningLspTasks, activeRunInstance, focusRunInstance, runInstanceList, dapBreakpoints, dapSetBreakpoints, dapStart, dapState, dapStep, dapGotoTargets, dapGoto, dapBreakpointLocations, defaultEditorSettings, defaultGeneralSettings, defaultJavaProjectSettings, breadcrumbsShownFor, defaultProjectSettings, endRun, encodingKeys, encodingLabels, fsChanges, gitProgress, historyNotes, isDesktop, lspDiagnostics, request, lspEdited, runOutput, runState, termOpened, watchStopped, setLspDiagnostics, setNativeDirty, setNativeTheme, traces, type AppState, type BinaryView, type Bookmark, type DiffRow, type DocumentData, type EditorSettings, type GeneralSettingsState, type EncodingKey, type Entry, type GitAheadBehind, type GitBlame, type GitBlameLine, type GitChange, type GitFileHistory, type GitShowCommit, type GitStatus, type GitSubmodule, type GitSubmodules, type GitWorktree, type GitWorktrees, type HistoryContent, type HistoryEntry, type JavaProjectSettings, type LspCodeAction, type LspCodeActionResults, type LspDocumentSymbol, type LspExecuteCommandResult, type LspFileEdits, type LspFormatResult, type LspHierarchyItem, type LspHierarchyResult, type LspHoverResult, type LspLocation, type LspOpenResult, type LspRange, type LspReferencesResult, type LspRenameResult, type LspSignatureHelpResult, type LspSymbolsResult, type BookmarksViewState, type LspPrepareRenameResult, type LspTextEdit, type NamedScopeSetting, type ProjectForm, type ProjectSettings, type PluginInfo, type PluginList, type ProcessMemory, type RecentProject, type RunConfig, type RunStartParams, type SaveResult, type TemplateSettings, type TodoPattern, type UsageResult, type Workspace, normalizeEditorSettings } from './bridge'
import { BreakpointLocationCache, breakpointPlacement } from './breakpointLocations'
import { classifyLinkTarget, describeLink, type DocumentLink } from './documentLinks'
import { runWorkspaceInspection } from './workspaceInspection'
import { describeNavigationBoundary, navigateFrom, navigationPoints } from './navigateInFile'
import { createDistractionFreeSession, createImmersiveMode } from './distractionFreeSession'
// 行级 diff 是纯函数，单独成模块（可直接单测，见 tests/diff-text.test.mjs）。
import { buildDiffRows, generateUnifiedDiff } from './diffText'
import { createProjectExtras } from './projectExtras'
import { createHierarchyView } from './hierarchyView'
import { createSettingsPersistence } from './settingsPersistence'
import { createSurroundTemplates } from './surroundTemplates'
import { createBookmarkActions } from './bookmarkActions'
import { createDiskSync } from './diskSync'
// 标签与编辑器句柄是**共享类型**（抽出的模块都要用，见 src/editorTab.ts）。
import type { EditorHandle, Tab } from './editorTab'
import { createExplorerActions } from './explorerActions'
import { createAppearanceActions } from './appearanceActions'
import { createLspNavigation, CLASS_KINDS, type SymbolEntry } from './lspNavigation'
import { createSemanticActions } from './semanticActions'
import { createMenuUi } from './menuUi'
import { createRunActions } from './runActions'
import { createKeymap } from './keymap'
import { createRunConfigurations } from './runConfigurations'
import { createWorkspaceLifecycle, type LeaveChoice } from './workspaceLifecycle'
import { createVcsActions } from './vcsActions'
import { createEditorFileOps } from './editorFileOps'
import { createTabDragDrop } from './tabDragDrop'
import { createTabStripView } from './tabStripView'
import { createPanelResize } from './panelResize'
import { createGenerateRefactor } from './generateRefactor'
import { createTreeActions } from './treeActions'
import { copyToClipboard } from './clipboard'
import { createPasteActions } from './pasteActions'
import { createGutterIconHost } from './gutterIconHost'
import { createHelpActions } from './helpActions'
import AboutDialog from './components/AboutDialog.vue'
import SpecialPathsDialog from './components/SpecialPathsDialog.vue'
import { createHelpMenuRows, type HelpMenuContext } from './menus/helpMenu'
import { createMacros } from './macroHost'
import { recordTypingStep } from './macroHost'
import MacrosDialog from './components/MacrosDialog.vue'
import { allProblems, severityClass, severityLabel } from './problems'
import { createGitWidget } from './gitWidget'
import { createRunIssues } from './runIssues'
import PasteHistoryDialog from './components/PasteHistoryDialog.vue'
import { createEditorSplits } from './editorSplits'
import { createToolLayouts } from './toolLayouts'
import { createNotifications } from './notifications'
import { createEditorSideViews } from './editorSideViews'
import type { Place } from './lspNavigation'
import { describeCopiedReference, primaryMoniker, referenceText, type MonikerResult } from './moniker'
import type { WorkspaceDiagnosticsResult } from './bridge'
import { clampPanelSize, initialTheme, projectTint, themeStorageKey, type Theme } from './appearance'
import { themeRipple } from './themeRipple'
import { parseAnyIssue } from './buildOutput'
import { COMMIT_MESSAGE_INSPECTION_STORAGE_KEY, resolveInspectionSettings, type CommitMessageInspectionSettings } from './commitMessageInspection'
import { rankCommands } from './commandSearch'
import { bookmarkOwner, nextBookmark as nextInList, placeBookmark, removeBookmark, sortedBookmarks } from './bookmarks'
import { createSplitModel, splitTabOutIn, unsplitModel, unsplitAllModel, closeTabInPane, dropTabOnGroup, swapGroups, tabClosingOrder, type Pane, type SplitModel } from './editorGroups'
import { dropSideFor, dropSidePutsNewGroupFirst, splitOrientationForSide, updateBoundsWithDropSide, type DropSide } from './tabDragSplit'
import { MIN_TAB_WIDTH, layoutSingleRow, preferredTabWidth, type TabStripLayout } from './tabStripLayout'
import { useSubmenuState } from './menus/submenuState'
import { createExitConfirmation } from './confirmations/exitConfirmation'
import { createProcessCloseConfirmation } from './confirmations/processClose'
import { errorMessage } from './errors'
import { applyTextEdits, offsetOf, wordAt } from './editorText'
import { foldConsoleLines } from './consoleFold'
import { TOOL_MNEMONIC_ALIASES, TOOL_MNEMONIC_BINDINGS, toolIcons, toolTitles, toolWindowMnemonic, toolWindowOrder, type BottomTabId, type ToolWindowId } from './toolWindowMeta'
import { listWidgets, showAllWidgets, showWidget, toggleWidget, widgetChecked, widgetClickable } from './statusWidgets'; import { statusLabel } from './statusBarText'
import { createSessionSnapshot, restorePrompt } from './sessionSnapshot'
import { createToolWindowActions, lastDockFocus, type ToolWindowActionsContext } from './toolWindowActions'
import { createToolStripeDrag } from './toolStripeDrag'
import { createToolWindowStripes, type Anchor } from './toolWindowStripes'
import { createGradleHost } from './gradleHost'; import { canLinkGradleProject } from './gradle'
import { createSettingsTransfer } from './settingsTransfer'
import { createHtmlExport } from './htmlExport'
import ExportToHtmlDialog from './components/ExportToHtmlDialog.vue'
import RunConsole from './components/RunConsole.vue'
import { gradleViewContext } from './gradleHost'
import { createProgressPanel } from './progressPanel'
import { createMemoryWidget } from './memoryWidget'
import type { MenuRow } from './menus/types'
import { createToolsMenuRows } from './menus/toolsMenu'
import { createFileMenuRows, type FileMenuContext } from './menus/fileMenu'
import { createWindowMenuRows } from './menus/windowMenu'
import { createToolViewContext } from './toolViewContext'
import { createEditMenuRows, type EditMenuContext } from './menus/editMenu'
import { createViewMenuRows, type ViewMenuContext } from './menus/viewMenu'
import { localHistoryMenuRow } from './menus/localHistory'
import { createNavigateMenuRows, type NavigateContext } from './menus/navigateMenu'
import { createCodeMenuRows, type CodeMenuContext } from './menus/codeMenu'
import { createAnalyzeMenuRows } from './menus/analyzeMenu'
import { createRefactorMenuRows, type RefactorMenuContext } from './menus/refactorMenu'
import { createBuildMenuRows, type BuildMenuContext } from './menus/buildMenu'
import { createRunMenuRows, type RunMenuContext } from './menus/runMenu'
import { createGitMenuRows, type GitMenuContext } from './menus/gitMenu'
import { PROCESS_CLOSE_LABELS, TERMINAL_CAN_DISCONNECT, confirmationResult, processClosePromptText, rememberedSetting, resolveProcessClose, type ProcessCloseChoice, type ProcessCloseConfirmation, type ProcessCloseResult } from './processClose'
import { locationSnippet } from './recentLocations'
import { effectiveTemplates, languageFor, type Template } from './templates'
import { DEFAULT_BOOKMARKS_VIEW } from './bookmarksView'
import { surroundTemplates, type SurroundTemplate } from './surround'
import { mnemonicBindings, mnemonicOf, sortedByTitle } from './toolWindows'
import { lastActiveId, nextContentIndex, pushActive } from './activeToolWindow'
import { FACTORY_LAYOUT_NAME, deleteLayout, emptyLayoutStore, isFactoryLayoutActive, layoutNameError, layoutNames, normalizeLayoutStore, renameLayout, resolveLayout, saveLayout, setActiveLayout, type ToolLayout, type ToolLayoutStore } from './toolLayout'
import { MAXIMIZE_SHORTCUT_CODE, MAXIMIZE_SHORTCUT_LABEL, canMaximize, reconcileMaximized, toggleMaximized, type ToolWindowSide } from './toolWindowHeader'
import { focusableWidgets, navigateWidget, resolveRestoreTarget, shouldFocusFirstWidget, type NavDirection } from './statusBarNav'
import { popupRows, showProgressWidget, updateFinishedLatch } from './processPopup'
import { filterProjects, groupProjects } from './projectWidget'
import { NOTICES_LABEL, noticeButtonText, noticeButtonVisible, noticeLevel, noticeTitle, pushNotice, type NoticeEntry } from './notices'
import { ACCESSIBLE_NAME_PREFIX, absolutePath, fileStatusKind, filenameWidgetLabel, filenameWidgetTooltip, filenameWidgetVisible, insideContentRoot, isFilenameWidgetCloseGesture, isSameFile, recentFilesPopupRows, uniqueFileName } from './filenameWidget'
import { references, referenceTabs } from './referenceContents'
import { gearHostRows as gearHostRowMap } from './gearHostRows'; import { usageViewGearRows } from './usageViewGear'
import { canCloseAllContents, canCloseOtherContents, canHideAllToolWindows, hasVisibleToolWindow, hideAllToolWindowsTitle, isCloseableToolTab, tabsCloseAllWouldRemove, tabsCloseOtherWouldRemove, type CloseableToolTabId, type ToolTabPresence, type ToolWindowChrome } from './toolTabs'
import { RESIZE_CHARS, resizeDirectionEnabled, stretchDelta, type ResizeDirection } from './toolWindowResize'
import { canToggleContentUiType, isTabbedContentUi, resolveContentUiType, toggledContentUiType, type ToolWindowContentUiType } from './toolWindowContentUi'

const CodeEditor = defineAsyncComponent(() => import('./components/CodeEditor.vue'))
const BinaryViewer = defineAsyncComponent(() => import('./components/BinaryViewer.vue'))
const reducedMotion = useReducedMotion()
const popupEnter = computed(() => reducedMotion.value ? { opacity: 1 } : { opacity: 0, y: -4, scale: 0.985 })
const popupExit = computed(() => ({ opacity: 0, y: reducedMotion.value ? 0 : -3, transition: { duration: reducedMotion.value ? 0 : 0.1 } }))
const popupTransition = computed(() => ({ duration: reducedMotion.value ? 0 : 0.16, ease: [0.16, 1, 0.3, 1] as const }))
const editorRefs = new Map<string, EditorHandle>()
// CodeEditor is v-show'd per open file; with "split same" one path lives in both
// panes, so refs are keyed by pane and the secondary instance never overwrites the primary.
function setEditorRef(pane: Pane, path: string, element: unknown) {
  const key = `${pane}:${path}`
  if (element) editorRefs.set(key, element as EditorHandle)
  else editorRefs.delete(key)
}
function editorFor(path: string) { return editorRefs.get(`0:${path}`) ?? editorRefs.get(`1:${path}`) }
function forgetEditorRefs(path: string) { editorRefs.delete(`0:${path}`); editorRefs.delete(`1:${path}`) }
const workspace = ref<Workspace | null>(null)
// IDEA's editor model: one tab group per split pane, each with its own open files and
// active tab; the two groups may contain the same file ("split same"). A Tab object is
// created once per path and shared by reference, so dirty/save state can never diverge.
// The transitions live in editorGroups.ts (pure + unit-tested) and mutate this model.
const splitModel = reactive<SplitModel<Tab>>({ ...createSplitModel(), groups: [{ tabs: [], activePath: '' }, { tabs: [], activePath: '' }] })
const groups = splitModel.groups
const focusedPane = computed({
  get: () => splitModel.focused,
  set: value => { splitModel.focused = value },
})
const allTabs = computed(() => [...groups[0].tabs, ...groups[1].tabs.filter(tab => !groups[0].tabs.includes(tab))])
function findTab(path: string) { return allTabs.value.find(tab => tab.path === path) }
function hasTabPath(path: string) { return groups[0].tabs.some(tab => tab.path === path) || groups[1].tabs.some(tab => tab.path === path) }
function closeAllPanes() {
  groups[0].tabs = []
  groups[0].activePath = ''
  groups[1].tabs = []
  groups[1].activePath = ''
  closedTabsPerPane[0] = []
  closedTabsPerPane[1] = []
  unsplitAllModel(splitModel)
}
// `active` follows the focused pane (every command and status readout flows through it).
const active = computed(() => groups[focusedPane.value].tabs.find(tab => tab.path === groups[focusedPane.value].activePath))
const focusedTab = active
// IDEA's auto-scroll-from-source feeds the TODO tree from the caret; the line is the
// editor's 1-based number, the same basis the scan reports.
const todoSource = computed(() => active.value ? { path: active.value.path, line: active.value.line } : null)
// Kept as the focused pane's selection so the dozens of existing readers (status bar,
// panels, watchers, prompts) all follow the pane that has focus — IDEA's behavior.
const activePath = computed({
  get: () => groups[focusedPane.value].activePath,
  set: value => { groups[focusedPane.value].activePath = value },
})
function groupActive(pane: Pane) { return groups[pane].tabs.find(tab => tab.path === groups[pane].activePath) }
const busy = ref(false)
const opening = reactive(new Set<string>())
let workspaceEpoch = 0
// 上次运行的参数：宿主更早的阶段（运行菜单、外观动作、重新运行）就要读写它，
// 所以它留在宿主 —— 运行动作模块通过 getter/setter 持有同一份。
let lastRunParams: any = null
// Bumped when a buffer must be rebuilt from its text (line-separator conversion).
const bufferEpoch = ref(0)
// 重命名/新建对话框的状态：宿主更早的阶段（文件菜单、快捷键）就要读写它，
// 所以它留在宿主 —— 树操作模块通过 ctx 拿到它。
// 上次运行的参数：宿主在启动/重跑后要写它，所以留在宿主（界面动作模块通过 ctx 读）。

// 断点可放置位置的缓存：断点校验与 LSP 导航模块都要用，声明在这一层。
const breakpointLocationCache = new BreakpointLocationCache()

// Markdown 预览的三个状态：LSP/导航模块与更早的菜单都要读它们，所以声明在这一层。
const markdownPreviewOn = ref(false)
const markdownCapable = computed(() => /\.md$/i.test(active.value?.path ?? ''))
const markdownSource = ref('')
const nameDialog = ref<{ mode: 'createFile' | 'createDir' | 'rename' | 'newLayout' | 'renameLayout'; dir: string; entry?: Entry; value: string; template?: string } | null>(null)
const nameInput = ref<HTMLInputElement>()

const explorer = ref(window.innerWidth >= 700)
const leftView = ref<ToolWindowId>('files')
const activity = ref(false)
const bottom = ref(false)
// 底部 dock 显示哪一格。要早于 `createToolWindowStripes`：那里按 `WindowInfo.isVisible` 恢复它（watch 建时会求值）。
const bottomTab = ref<BottomTabId | ToolWindowId>('output')
// IDEA 的 ToolWindowAnchor：每个工具窗口记住自己停在哪一侧（`Anchor` 由状态域定义，见下）。
// 工具窗口的停靠边 / 顺序 / 可用性是一个独立状态域，见 src/toolWindowStripes.ts
// （2026-09-27 加 Gradle 工具窗口时从中拆出）。`toolDisabled` / `bottomAnchoredIds` 由它导出。
const { toolAnchors, activeAnchor, setToolAnchor, saveToolAnchors, toolOrder, saveToolOrder, stripeOrder, hiddenStripeButtons, removeStripeButton, restoreStripeButton, toolDisabled, bottomAnchoredIds, activationTarget, anchorOf, stripeWidth, setStripeWidth, applyShowNamesWidths, moreButtonSide, moveMoreButtonTo, moreButtonRows, moreButtonVisible, contentUiType: stripeContentUiType, setContentUiType: setStripeContentUiType } = createToolWindowStripes({
    isDesktop, explorer,
    // `lspReady` / `gradleAvailable` 在宿主里声明得比这里晚（TDZ），只能惰性传。
    workspace: { get value() { return workspace.value } },
    lspReady: { get value() { return lspReady.value } },
    gradleAvailable: { get value() { return gradleAvailable.value } },
    activeView: { get value() { return leftView.value }, set value(id) { leftView.value = id } }, bottom, bottomTab,
    compactMode: { get value() { return editorSettings.value.compactMode } }, showNames: { get value() { return editorSettings.value.showToolWindowNames } },
  })
// 侧条（宽度的分隔线 / 「更多」按钮 / 空白处右键）都由 ToolStripe.vue 承担，这里只做转发。
function toggleToolWindowNames() { void saveSettingsPatch({ showToolWindowNames: !editorSettings.value.showToolWindowNames }) }
// IDEA's MaximizeToolWindow (MaximizeToolWindowAction.java:36 -> ToolWindowManagerImpl.setMaximized
// -> ToolWindowPane.kt:544-560 `stretch(toolWindow, MAX)`): the dock is stretched over the whole
// width and the previous size is remembered for the restore. Only one dock is stretched at a time;
// the CSS collapses the editor column, which is what `stretch` squeezes out. The state machine
// (toggle + the "a relocated window must not stay stretched" rule) lives in `src/toolWindowHeader.ts`.
const maximizedSide = ref<ToolWindowSide | null>(null)
function toggleToolMaximized(side: ToolWindowSide) {
  maximizedSide.value = toggleMaximized(maximizedSide.value, side)
}
function maximizeActiveToolWindow() {
  if (!canMaximize(Boolean(workspace.value), explorer.value) || zenMode.value) return
  const side = activeAnchor.value
  if (side === 'bottom') return // the bottom area is the output pane, not a maximise-able dock
  toggleToolMaximized(side)
}
// A hidden or relocated window must not leave the workbench stretched.
watch([activeAnchor, explorer], () => {
  const side = activeAnchor.value
  maximizedSide.value = reconcileMaximized(maximizedSide.value, side === 'bottom' ? null : side, explorer.value)
})
// The ⋮ options menu on a tool-window strip: Move to Left/Right/Bottom + Hide
// (UIBundle: tool.window.move.to.action.group.name, tool.window.hide.action.name).
const toolMenu = ref<ToolWindowId | null>(null)
function activateToolWindow(id: ToolWindowId) {
  if (toolDisabled(id)) return
  restoreStripeButton(id) // 激活即把侧条按钮放回来（上游 showToolWindowImpl:942）
  // 锚点先判（`activationTarget` 住在 toolWindowStripes.ts，只看锚点不看窗口种类）。
  // 原先 `files` / `outline` 两条专属分支排在锚点判断**之前**就 return，于是它们无视
  // `toolAnchors`：被 Move to Bottom 搬走后左栏没有入口，点击路径又只走 leftView/explorer，
  // 两侧都够不着 —— 窗口再也切不回来。IDEA 的 activate 一律按当前 ToolWindowAnchor 决定
  // dock（ToolWindowManagerImpl.activateToolWindow），与窗口种类无关。
  if (activationTarget(id).dock === 'bottom') {
    // 停靠在底部的工具窗口：显示在底部 dock（不占用左侧栏），再次点击即收起。
    const wasShown = bottom.value && bottomTab.value === id
    bottom.value = !wasShown
    bottomTab.value = id
    if (!wasShown) recordActiveToolWindow(id)
    return
  }
  if (id === 'files') { explorer.value = !explorer.value; leftView.value = 'files'; if (explorer.value) recordActiveToolWindow(id); return }
  if (id === 'outline') { toggleOutline(); if (explorer.value && leftView.value === 'outline') recordActiveToolWindow(id); return }
  explorer.value = true
  leftView.value = leftView.value === id ? 'files' : id
  // Only a click that *brings the window forward* counts as an activation; the second click hides
  // it, and hiding must leave the persistent stack alone (`setHiddenState`, :711-718).
  if (leftView.value === id) recordActiveToolWindow(id)
}
// A click on the tool window *header* is not a stripe click: ToolWindowHeader.kt:212-235 fires
// `fireActivated` and then `decorator.requestContentFocus()` ("Move focus to the context component"),
// so it always brings the window forward and puts the caret into its content — it never collapses
// the dock the way a second stripe click does. `showView` is the non-toggling half of
// `activateToolWindow`, reused here so both paths agree on where a bottom-anchored window goes.
function focusToolWindowContent(id: ToolWindowId) {
  if (toolDisabled(id)) return
  const anchor = toolAnchors[id] ?? 'left'
  showView(id)
  if (id === 'outline') void refreshOutline(activePath.value)
  if (anchor !== 'bottom') {
    // The dock panel itself carries tabindex="-1" so `requestContentFocus` has a real target.
    void nextTick(() => document.querySelector<HTMLElement>('.explorer-panel')?.focus())
  }
}
// --- last-active tool window (IDEA ActiveStack + JumpToLastWindowAction) -----------
// Only the *persistent* stack is kept (`ActiveStack.java:21-25`): it survives the editor taking
// focus, which is what F12 needs, and it is never cleared by a hide — `setHiddenState` (:711-718)
// calls `remove(entry, false)`, and `false` means "leave the persistent stack alone". There is no
// localStorage mirror because `ActiveStack` has no persistence of its own.
// `LeftViewId` / `BottomTabId` 都由 `src/toolWindowMeta.ts` 提供（唯一来源）——
// 这里原先各写了一份 `typeof xxx.value`，加窗口/加标签时必漏改。
const activeToolWindows = ref<string[]>([])
function recordActiveToolWindow(id: ToolWindowId | BottomTabId) {
  activeToolWindows.value = pushActive(activeToolWindows.value, id)
}
// The `isAvailable` filter behind `getLastActiveToolWindows` (:749-753). A docked window is
// available unless its content cannot be produced at all (`toolDisabled`); a bottom tab mirrors
// the `v-if` on its own tab button, so the jump can never land on an empty pane.
function toolWindowAvailable(id: string): boolean {
  if (isLeftToolWindowId(id)) return !toolDisabled(id)
  if (BOTTOM_TABS.includes(id as BottomTabId)) return bottomTabAvailable(id as BottomTabId)
  return false
}
// `JumpToLastWindowAction.java:17-30`: bring the last focused window forward, and do nothing at
// all when there is none (the action is disabled in that state, :32-44). `activateToolWindow` is
// deliberately not reused — it toggles, so a stripe click on the window that is already forward
// hides it, while the action always brings it forward (`activateToolWindow(id, null, true, …)`).
function jumpToLastToolWindow() {
  const id = lastActiveId(activeToolWindows.value, toolWindowAvailable)
  if (!id) return
  if (isLeftToolWindowId(id)) focusToolWindowContent(id)
  else showOutput(id as BottomTabId)
}
// --- tool window layouts (WindowMenu › LayoutsGroup, PlatformActions.xml:641-651) ---------
// `ToolWindowDefaultLayoutManager` keeps named snapshots plus one active name; the bookkeeping
// lives in `src/toolLayout.ts`. This block reads the live tool-window state into a snapshot and
// writes one back. Restoring goes through `setPanelSize`, so a stored size is clamped exactly like
// one the user dragged, and through `saveToolOrder`, so the stripe order is persisted too.
// `isLeftToolWindowId` 收窄到统一的 `ToolWindowId`（不再引用已删除的本地 `LeftViewId`）。
function isLeftToolWindowId(id: string): id is ToolWindowId { return id in toolAnchors }
// --- hide / cycle the tool windows (the rest of WindowMenu > ActiveToolwindowGroup) ---------
// The group in PlatformActions.xml:653-660 is: HideActiveWindow, HideSideWindows, HideBottomWindows,
// HideAllWindows, PinToolwindowTab, JumpToLastWindow, MaximizeToolWindow, DockToolWindow,
// separator, NextTab, PreviousTab, CloseActiveTab, TW.CloseOtherTabs.
/**
 * IDEA derives `activeToolWindowId` from the focus owner (ToolWindowManagerImpl), so the dock that
 * owns the focused element is the active window. Anything else — the editor, a stripe button, a
 * menu — means no tool window is active and the *last focused* one answers instead.
 */
// 工具窗口的停靠判定/隐藏/循环/关闭：见 src/toolWindowActions.ts（一组一文件）。
// lastDockFocus 由模块自持；内容条形态（contentUiType）住在项目的布局记录里（src/toolWindowStripes.ts）。
const { focusedDock, noteDockFocus, activeToolWindowDock, hideActiveToolWindow, hideSideToolWindows, hideBottomToolWindows, bottomTabAvailable, bottomContentCount, tabTargetCount, activeContentCount, bottomTabOptions, bottomTabLabel, selectReferenceTab, closeReferenceTab, pinReferenceTab, bottomSelectValue, pickBottomOption,
  selectNextTab, selectPreviousTab, cycleTab, toolTabPresence, clearToolTab, closeActiveTab, closeOtherToolTabs, closeOtherTabsTarget, closeAllToolTabs, closeAllTabsTarget, openToolMenu,
  anchorMenu, anchorMenuAnchor, bottomTabIsToolWindow, openAnchorMenu, closeAnchorMenu, moveAnchorTo, canPinToolwindowTab, pinTabTitle, togglePinToolwindowTab, contentUiType, toggleContentUiType } = createToolWindowActions({
  workspace: () => workspace,
  explorer, bottom,
  get bottomTab() { return bottomTab },
  get hierRoot() { return hierRoot },
  get hierTitle() { return hierTitle },
  get references() { return references },
  get active() { return active },
  get toolMenu() { return toolMenu },
  groups, focusedPane,
  lastActiveId: (...args: any[]) => (lastActiveId as any)(...args),
  activeToolWindows: () => activeToolWindows.value,
  bottomAnchoredIds: () => bottomAnchoredIds.value,
  toolWindowTitle: id => toolTitles[id as ToolWindowId] ?? String(id),
  toolWindowAvailable: id => toolWindowAvailable(id),
  isLeftToolWindowId: id => isLeftToolWindowId(id),
  closeTab: tab => closeTab(tab),
  switchTabIn: (pane, tab) => switchTabIn(pane, tab),
  showOutput: tab => showOutput(tab),
  resetHierarchy: () => resetHierarchy(),
  toolDisabled: id => toolDisabled(id), toolAnchors: () => toolAnchors, setToolAnchor, saveToolAnchors, showView, contentUiType: id => stripeContentUiType(id), setContentUiType: (id, type) => setStripeContentUiType(id, type),
  focusToolWindowContent: id => focusToolWindowContent(id),
})
// --- drag & drop of stripe buttons (IDEA AbstractDroppableStripe) -----------
// 工具窗口条按钮的拖放：见 src/toolStripeDrag.ts（状态自持）。
const { draggingTool, dropTarget, onToolDragStart, onToolDragOver, onToolDrop, onToolDragEnd, isDropBefore } = createToolStripeDrag({
  toolAnchors: () => toolAnchors,
  toolOrder: () => toolOrder,
  setToolAnchor: (id, side) => setToolAnchor(id as ToolWindowId, side),
  saveToolOrder: () => saveToolOrder(),
})
// 底部 dock 既能显示固定底部 tab，也能显示「停靠在底部的工具窗口」（IDEA 的任意停靠）。
const runCommand = ref('cmake --build build')
const runInput = ref<HTMLInputElement>()
const runLog = ref<HTMLElement>()
const treeVersion = ref(0)
const fileTreeRef = ref<InstanceType<typeof FileTree> | null>(null)
const terminalPanelRef = ref<InstanceType<typeof TerminalPanel> | null>(null)
const testRunnerRef = ref<InstanceType<typeof TestRunnerPanel> | null>(null)
const searchPanelRef = ref<InstanceType<typeof SearchPanel> | null>(null)
function openReplaceInPath() {
  explorer.value = true
  leftView.value = 'search'
  void nextTick(() => searchPanelRef.value?.focusReplace())
}
const theme = ref<Theme>(initialTheme())
const panelSizes = reactive({ explorer: 240, trace: 300, output: 180 })
const resizing = ref(false)
// Clearing the toast also drops its click action so a stale target can never fire.
const notice = computed({ get: () => noticeRaw.value, set: value => { noticeRaw.value = value; if (!value) noticeAction.value = null } })
const noticeRaw = ref('')
const noticeAction = ref<(() => void) | null>(null)
const noticeError = ref(false)
const palette = ref(false)
const query = ref('')
const paletteIndex = ref(0)
const queryInput = ref<HTMLInputElement>()
const helpClose = ref<HTMLButtonElement>()
const menu = ref<'file' | 'edit' | 'view' | 'navigate' | 'code' | 'refactor' | 'build' | 'run' | 'tools' | 'git' | 'window' | 'help' | null>(null)
const help = ref(false)
// ManageRecentProjectsAction mirrors JBPopupFactory.createComponentPopupBuilder:
// a focused modal that hosts the recent-project tree, search field, and the same
// multi-select remove behaviour. The popup is centred in the current window when
// it is created; TaoCode reuses the welcome-screen list inside a centered dialog.
const manageRecentsOpen = ref(false)
function openManageRecents() {
  menu.value = null
  manageRecentsOpen.value = true
}
function closeManageRecents() { manageRecentsOpen.value = false }
// RecentProjectFilteringTree + SearchTextField: same filter rules as the welcome
// screen (case-insensitive name/path match, empty query keeps everything). The
// ManageRecentProjectsAction source builds the tree with the same data, so the
// user sees an identical list inside the popup.
const manageRecentsQuery = ref('')
const manageRecentsSelection = ref<Set<string>>(new Set())
const manageRecentsInput = ref<HTMLInputElement>()
const manageRecentsFiltered = computed(() => {
  // Source: RecentProjectFilteringTree uses the parent FilteringTree's predicate
  // (FilteringTree.kt), which accepts a node when the search text matches any of
  // the strings its renderer prints. RecentProjectTreeItem.displayName() returns
  // `projectNameToDisplay`, which ReopenProjectAction.kt:140-148 builds from
  // displayName plus an optional branchName template
  // ("action.reopen.project.display.name.with.branch"). Mirror that here.
  const q = manageRecentsQuery.value.trim().toLowerCase()
  if (!q) return recentProjects.value
  return recentProjects.value.filter(project => {
    const haystacks = [project.name, project.path, project.displayName ?? '']
    if (project.branchName) haystacks.push(project.branchName)
    return haystacks.some(text => text.toLowerCase().includes(q))
  })
})
const manageRecentsSelectedProjects = computed(() => recentProjects.value.filter(project => manageRecentsSelection.value.has(project.path)))
function toggleManageRecentsSelection(project: RecentProject, event: MouseEvent) {
  if (!event.shiftKey && !event.ctrlKey && !event.metaKey) {
    if (manageRecentsSelection.value.size > 0) manageRecentsSelection.value = new Set()
    return
  }
  const next = new Set(manageRecentsSelection.value)
  if (next.has(project.path)) next.delete(project.path)
  else next.add(project.path)
  manageRecentsSelection.value = next
}
function openManageRecentsProject(project: RecentProject) {
  if (working.value || !project.available) return
  closeManageRecents()
  void openWorkspace(project.path)
}
function confirmForgetManage(projects: RecentProject[]) {
  if (projects.length === 0) return
  const ok = window.confirm(projects.length === 1
    ? `从最近项目列表移除「${projects[0]!.name}」？\n磁盘上的文件不会被删除。`
    : `从最近项目列表移除 ${projects.length} 项？\n磁盘上的文件不会被删除。`)
  if (!ok) return
  void forgetProjects(projects.map(project => project.path))
    .then(() => { manageRecentsSelection.value = new Set() })
}
watch(manageRecentsOpen, open => {
  if (open) {
    manageRecentsQuery.value = ''
    manageRecentsSelection.value = new Set()
    nextTick(() => manageRecentsInput.value?.focus())
  }
})
const loading = ref(true)
const appError = ref('')
const recentProjects = ref<RecentProject[]>([])
const editorSettings = ref<EditorSettings>({ ...defaultEditorSettings })
// Source: GeneralSettings.kt (ide.general.xml) — application-level System Settings state.
const generalSettings = ref<GeneralSettingsState>({ ...defaultGeneralSettings })
const projectSettings = ref<ProjectSettings>(structuredClone(defaultProjectSettings))
const gitAvailable = ref(false)
const defaultParent = ref('')
const projectMode = ref<'create' | 'clone' | null>(null)
const projectForm = ref<ProjectForm>({ parent: '', name: 'untitled', template: 'empty', source: '' })
const projectBusy = ref(false)
const projectError = ref('')
const cancelling = ref(false)
const settingsOpen = ref(false)
// IDEA's settings dialog intercepts ESC before the window does (SettingsDialog.java:255-261 asks the
// editor to cancel first), so the global handler delegates to the dialog before closing it.
const settingsDialogRef = ref<{ handleEscape: () => boolean } | null>(null)
const settingsBusy = ref(false)
const settingsError = ref('')
const leavePrompt = ref<{ title: string; paths: string[]; resolve: (choice: LeaveChoice) => void } | null>(null)
const leaveCancel = ref<HTMLButtonElement>()
const expandedTrace = ref<number | null>(null)
const reveal = ref<{ path: string; line: number; column?: number } | null>(null)
const navBack = ref<{ path: string; line: number }[]>([])
const navForward = ref<{ path: string; line: number }[]>([])
const historyEpoch = ref(0)
// IDEA 的 Local History 是 ShowHistoryAction 打开的**对话框**（VCS › Local History › Show History），
// 不是工具窗口 —— 严格对齐后磁贴上不再有它。状态与菜单行在 src/menus/localHistory.ts。
const historyDialog = ref(false)
const localHistoryState = { dialog: historyDialog, canShow: () => isDesktop && Boolean(workspace.value) && Boolean(activePath.value) }
const renamePrompt = ref<{ path: string; line: number; character: number; current: string } | null>(null)
const renameValue = ref('')
const renameInput = ref<HTMLInputElement>()
// IDEA's RenameInputValidator rejects names that are not identifiers before the
// dialog accepts OK; JDT would refuse them anyway.
const javaKeywords = new Set(['abstract','assert','boolean','break','byte','case','catch','char','class','const','continue','default','do','double','else','enum','extends','final','finally','float','for','goto','if','implements','import','instanceof','int','interface','long','native','new','package','private','protected','public','return','short','static','strictfp','super','switch','synchronized','this','throw','throws','transient','try','void','volatile','while','record','sealed','var'])
const invalidRenameName = computed(() => {
  const name = renameValue.value.trim()
  if (!name || !renamePrompt.value) return ''
  if (name === renamePrompt.value.current) return '新名称与当前名称相同。'
  if (!/^[A-Za-z_$][A-Za-z0-9_$]*$/.test(name)) return `“${name}”不是有效的标识符：只能包含字母、数字、下划线和 $，且不能以数字开头。`
  if (/\.java$/.test(active.value?.path ?? '') && javaKeywords.has(name)) return `“${name}”是 Java 关键字，不能作为标识符。`
  return ''
})
const outline = ref<LspDocumentSymbol[]>([])
// 粘性作用域行（IDEA `editor.stickyLines`）：从 documentSymbol（扁平列表）里找出**包含当前光标行**的符号，
// 按 startLine 升序取最内层 N 条 —— 外层作用域在上，最内层贴近编辑区顶边。
const stickyLines = computed(() => {
  const limit = editorSettings.value.stickyLinesLimit
  const line = active.value?.line ?? 1
  if (!editorSettings.value.showStickyLines || limit <= 0 || !active.value) return []
  return outline.value
    .filter(symbol => symbol.startLine < line && line <= symbol.endLine)
    .sort((left, right) => left.startLine - right.startLine)
    .slice(-limit)
})
const codeActions = ref<LspCodeAction[]>([])
const actionPrompt = ref<{ path: string } | null>(null)
// `SymbolEntry` / `CLASS_KINDS` 随符号搜索一起搬到 src/lspNavigation.ts（工作区符号索引的
// 类型与"哪几类 LSP kind 算类型"的过滤器）。
const symbolPrompt = ref<{ mode: 'file' | 'global' | 'class' } | null>(null)
const symbolQuery = ref('')
const symbolInput = ref<HTMLInputElement>()
const symbolResults = ref<SymbolEntry[]>([])
const symbolIndex = ref(0)
const dirty = computed(() => allTabs.value.some(tab => tab.dirty))
// IDEA's status bar shows the current Git branch with ahead/behind counters and a
// fetch/update widget. Poll the same bridge methods the 源代码管理 panel uses, only
// while a workspace is open on the desktop; SourceControl refreshes on its own too.
// 状态栏的 Git 部件是一个域（分支 / 领先落后 / 变更表 / 20 秒轮询都在模块里自持）。
const { gitHead, gitAheadBehind, gitChanges, gitBranches, refreshGitWidget, stopGitWidgetPolling } =
  createGitWidget({ isDesktop, workspace, gitAvailable, editorSettings })

// --- IDEA's main-toolbar filename widget -------------------------------------------------
// FilenameToolbarWidgetAction.kt:49-181, the New UI `MainToolbarCenter` region
// (PlatformActions.xml:846-848 -> `main.toolbar.Filename`): icon + name of the selected file,
// coloured by its VCS status, clicking lists the other recent files, middle-click closes it.
// IDEA also shows it while the editor tab strip is gone (`UISettings.TABS_NONE`); TaoCode always
// places its tabs on top and has no tab-placement setting, so that case cannot occur here.
const filenamePopup = ref(false)
const filenameShown = computed(() => Boolean(active.value) && filenameWidgetVisible(editorSettings.value.fullPathsInWindowHeader))
const filenameFullPath = computed(() => active.value ? absolutePath(workspace.value?.root ?? '', activePath.value) : '')
// getUniquePresentableNameForUI resolves the name against the *open* files
// (FilenameToolbarWidgetAction.kt:81); a second pane's tabs count as open too.
const filenameName = computed(() => active.value ? uniqueFileName(filenameFullPath.value, allTabs.value.map(tab => absolutePath(workspace.value?.root ?? '', tab.path))) : '')
// git reports repo-relative paths while an editor path may be absolute (an LSP location), so both
// sides are reduced to the absolute form before they are compared.
function gitChangeFor(path: string) {
  const root = workspace.value?.root ?? ''
  const absolute = absolutePath(root, path)
  return gitChanges.value.find(change => isSameFile(absolutePath(root, change.path), absolute))
}
const filenameStatusKind = computed(() => fileStatusKind(gitChangeFor(activePath.value)))
const filenameLabel = computed(() => active.value
  ? filenameWidgetLabel(filenameName.value, filenameFullPath.value, editorSettings.value.fullPathsInWindowHeader)
  : '')
const filenameTooltip = computed(() => active.value
  ? filenameWidgetTooltip(filenameFullPath.value, filenameName.value, editorSettings.value.fullPathsInWindowHeader, insideContentRoot(workspace.value?.root ?? '', activePath.value))
  : '')
// createPopup (:94-102): the recent-file history without the entry the widget is showing.
const filenameRecentRows = computed(() => recentFilesPopupRows(editorHistory.value) ?? [])
function toggleFilenamePopup() {
  if (filenameRecentRows.value.length === 0) return
  filenamePopup.value = !filenamePopup.value
}
// The widget's own close gesture — middle button or Shift+left (UIUtil.java:1843-1846).
function onFilenameMouseUp(event: MouseEvent) {
  if (!isFilenameWidgetCloseGesture(event.button, event.shiftKey)) return
  event.preventDefault()
  const tab = active.value
  if (tab) void closeTab(tab)
}
// The popup rows carry the same status colour as the widget itself (:166-168), taken from the
// change list already in memory so a row needs no extra git call.
function recentFileKind(path: string) {
  return fileStatusKind(gitChangeFor(path))
}
function pickRecentFile(path: string) {
  filenamePopup.value = false
  void openFile(path)
}
// 删除确认一族（Safe Delete 的用法扫描 + 回收站开关）：宿主更早的菜单/快捷键就要用它，
// 所以它留在宿主，树操作模块通过 ctx 与它的动作协作。
const deleteTarget = ref<Entry | null>(null)
// IDEA's Safe Delete: before removing a file, show what still refers to it. The
// scan is a real workspace search (file + line + preview), not a guess.
const deleteUsages = ref<UsageResult | null>(null)
const deleteUsagesError = ref('')
// IDEA puts the "Move files to the recycle bin instead of deleting permanently" checkbox in
// the confirm dialog and remembers the choice. It is GeneralSettings.isDeletingToBin
// (GeneralSettings.kt:55-60 -> state.deleteToBin, ide.general.xml), read by the delete paths
// as `TrashBin.isSupported() && isDeletingToBin()` — DeleteHandler.java:345,
// DeleteHandlerHelper.kt:30, FileDeleteAction.java:57, VirtualFileDeleteProvider.java:54.
// It used to live in the editor settings under the name `deleteToTrash`, which was a second
// name for this one option; the duplication is gone.
const trashSaving = ref(false)
const deleteToBin = computed({
  get: () => generalSettings.value.deleteToBin,
  set: value => {
    if (trashSaving.value) return
    const previous = generalSettings.value
    generalSettings.value = { ...previous, deleteToBin: value }
    trashSaving.value = true
    void (async () => {
      try { generalSettings.value = await request<GeneralSettingsState>('settings.general.update', { general: generalSettings.value }) }
      catch (error) {
        generalSettings.value = previous
        notify(`回收站选项没有保存成功：${errorMessage(error)}`, true)
      } finally { trashSaving.value = false }
    })()
  },
})
watch(deleteTarget, entry => {
  deleteUsages.value = null
  deleteUsagesError.value = ''
  if (!entry || entry.kind === 'directory' || !isDesktop) return
  const symbol = entry.path.split('/').pop() ?? ''
  const path = entry.path
  void (async () => {
    try {
      const result = await request<UsageResult>('file.usages', { path, symbol })
      if (deleteTarget.value?.path !== path) return   // a newer confirm owns the dialog
      deleteUsages.value = result
    } catch (error) { if (deleteTarget.value?.path === path) deleteUsagesError.value = errorMessage(error) }
  })()
})

const working = computed(() => loading.value || busy.value || projectBusy.value || allTabs.value.some(tab => tab.saving) || opening.size > 0)
// 状态栏中段文字：IDEA 的 `StatusBar.Info` 通道（规则与兜底在 src/statusBarText.ts）。后台任务见 src/progressPanel.ts。
const { backgroundTasks, progressOpen, allTasksFinishedOnce, progressRows, cancelProgressRow } = createProgressPanel({
  gitProgress: () => gitProgress, cloneProgress: () => cloneProgress, cancelling: () => cancelling.value,
  runState: () => runState, autoShowPopup: () => generalSettings.value.autoShowProcessPopup,
  gradleSync: () => gradleSync, lspProgress: () => runningLspTasks(lspProgressTasks),  // 都是惰性 getter：这两个通道在本块之后才组装
  notify: (message, error) => notify(message, error),  // 惰性：`notify` 声明在本块之后
})
// IDEA MemoryUsagePanel: "NNN of MMM M", refreshed on a timer. Reads the host
// process from the native side; nothing is shown in browser preview.
// 内存部件：见 src/memoryWidget.ts（状态自持 + 生命周期）。
const { processMemory, refreshMemory } = createMemoryWidget({ isDesktop, powerSaveEnabled: () => editorSettings.value.powerSaveMode })
// IDEA's ColumnSelectionModePanel: the status bar shows that the editor is in
// column-selection mode and clicking the widget turns it off again.
// 运行实例标签（IDEA 的 Run 工具窗口按实例开标签）：状态在 src/runInstances.ts。
const runTabs = computed(() => runInstanceList())
const columnMode = ref(false)
// IDEA PositionPanel: "N:M" normally, "N selected" (chars + lines spanned) with a
// selection, and it opens the Go to Line dialog on click.
const selectionInfo = ref<{ characters: number; lines: number } | null>(null)
// IDEA PositionPanel: with more than one caret it shows "N carets" instead of line:col.
const cursorCount = ref(1)
// IDEA PowerSaveStatusWidgetFactory: an icon widget that toggles the mode.
async function togglePowerSave() {
  await saveSettingsPatch({ powerSaveMode: !editorSettings.value.powerSaveMode })
  notify(editorSettings.value.powerSaveMode ? '已开启省电模式：语言服务与后台轮询暂停。' : '已关闭省电模式。')
}
// The welcome page's 自定义 tab writes single settings through the same channel the
// Settings dialog uses (IDEA: one settings model, several entry points).
// 「项目色」的调色板与取色规则在 src/appearance.ts（纯函数，可单测）—— 模板直接用 `projectTint(root)`。

async function saveSettingsPatch(patch: Partial<EditorSettings>) {
  if (settingsBusy.value) return
  settingsBusy.value = true
  try { editorSettings.value = await request<EditorSettings>('settings.update', { settings: { ...editorSettings.value, ...patch } }) }
  catch (error) { notify(errorMessage(error), true) }
  finally { settingsBusy.value = false }
}
// IDEA 的面包屑有三层开关（BreadcrumbsConfigurableUI.kt:44-70）：总开关、
// 位置（上方/下方，由模板里的 breadcrumbsPlacement 决定）、以及按语言的开关
// （isBreadcrumbsShownFor：没被单独配置过的语言按显示处理）。
function breadcrumbsOn(path: string) {
  return editorSettings.value.showBreadcrumbs && breadcrumbsShownFor(editorSettings.value, languageFor(path))
}

function toggleColumnModeFromStatusBar() {
  const editor = editorFor(activePath.value) as unknown as { toggleColumnSelection?: () => void } | null
  editor?.toggleColumnSelection?.()
}
// IDEA's ProcessPopup rows each carry a cancel button (cancelRequest -> cancel()).
// Each of TaoCode's background sources has a real stop: git.cancel terminates the
// running git child, project.clone.cancel aborts the clone, run.stop the runner.
const errors = computed(() => traces.filter(trace => trace.status === 'error').length)
const lspReady = computed(() => active.value ? lspOn(active.value) : false)
const editingSettingsLoading = computed(() => settingsBusy.value || working.value)
// IDEA's SmartModeIndicatorWidgetFactory shows a "dumb/scanning" icon while indexing
// has not finished and hides itself in smart mode. TaoCode's equivalent state is
// "the active file has a live language server"; while it is starting or absent an
// index state of 就绪/未就绪 is shown, and nothing is shown once everything is ready.
const smartModeLabel = computed(() => {
  if (!active.value) return ''
  if (editingSettingsLoading.value) return '正在载入设置'
  if (active.value.lspRunning === true) return ''
  if (!isDesktop) return ''
  // A language without a configured server is a normal state for this IDE (no server
  // is bundled), not 'indexing in progress' — IDEA also hides the indicator once the
  // project is smart, and never shows it for an unsupported file.
  if (!active.value.lspConfigured) return ''
  return '语言服务未就绪'
})
const splitOrientation = computed(() => splitModel.orientation)
// Secondary pane size in px; 0 means "50/50" until the user first drags it.
const splitSize = ref(0)
// Zen mode: hide all chrome except the editor.
const zenMode = ref(false)
// 编辑区的分栏与标签页开关是一个域（IDEA 的 SplitterAction + EditorWindow 标签页生命周期）。
const {
  otherPane, focusPane, splitTabOut, toggleSplit, unsplit, unsplitAll, splitFromTabMenu, openInOppositeGroup,
  keepTabOpen, onEditorTabDoubleClick, switchTabIn, editorHistory, touchHistory, enforceTabLimit, closeTabIn,
  closedTabsPerPane, reopenClosedTab, setSplitOrientation, moveTabToOtherPane,
} = createEditorSplits({
  // 惰性：`notify` 由通知模块提供（装配在本块之后）。
  notify: (...args) => notify(...args),
  splitModel, groups, active, activePath, findTab, editorFor, openFile, reveal, focusedPane,
  editorSettings, working, hasTabPath, rememberPlace, bufferEpoch, splitOrientation,
  // 惰性：下面几个来自本块之后装配的模块（文件树模块、LSP 模块、工作区生命周期模块）。
  tabMenu: { get value() { return tabMenu.value }, set value(v) { tabMenu.value = v } },
  rememberRecent: (...a) => rememberRecent(...a),
  stopLspFile: (...a) => stopLspFile(...a),
  confirmLeave: (...a) => confirmLeave(...a),
  onTabActivated: (...a) => syncTabOnActivation(...a), toggleMaximizeEditor, // 见 diskSync / editorTabDoubleClick
})
// --- Crash recovery (IDEA's workspace.xml editor state + unsaved drafts) ---
// The snapshot covers the split layout, each group's tabs and selections and, for
// dirty buffers only, the draft text. It is saved debounced after any layout or
// dirty change and cleared on a clean project close, so the restore prompt only
// appears after a crash or an abandoned exit.
// 崩溃恢复：状态与逻辑见 src/sessionSnapshot.ts（restorePrompt 由模块自持，模板直接引用）。
const { snapshotSession, scheduleSessionSave, cancelSessionSave, offerSessionRestore, restoreSession, discardSession } = createSessionSnapshot({
  isDesktop,
  workspace: () => workspace,
  workspaceEpoch: () => workspaceEpoch,
  splitModel: () => splitModel,
  groups: () => groups,
  reveal: () => reveal,
  editorFor: path => editorFor(path),
  findTab: path => findTab(path),
  notify: (message, error) => notify(message, error),
  touchHistory: path => touchHistory(path),
  rememberRecent: path => rememberRecent(path),
  startLsp: tab => startLsp(tab),
})
// 标签页的拖放是一个域（IDEA 的 TabbedPane 拖放 + TabsUtil 的拖到边缘即分屏）。
const {
  dragTab, tabDropSide, onTabDragStart, onTabDragOver, onStageDragOver, onStageDragLeave, onStageDrop,
  endTabDrag, onTabDrop, onTabStripDrop,
} = createTabDragDrop({
  editorSettings, groups, splitModel,
  // 惰性：`splitTabOut` 声明在本块之后（分栏动作的一部分）。
  splitTabOut: (...a) => splitTabOut(...a),
})
// 标签条布局是一个域：「显示一行」开 = ScrollableSingleRowLayout（裁切 + 「…」），关 = WrapMultiRowLayout（换行不裁切）。JBTabsImpl.kt:766-773
const { tabNaturalWidths, registerTabStrip, tabKeyOf, measureTabNaturalWidth, recomputeTabStrip, placedTabFor, isTabDropped, tabWidthStyle, tabStripStyle, tabStripWraps, onTabStripWheel, setTabStripHover, observeTabStrips } =
  createTabStripView({ groups, splitSize, splitOrientation, singleRow: () => editorSettings.value.tabsInOneRow, separatePinnedRow: () => editorSettings.value.pinnedTabsInSeparateRow })
// IDEA maps a file to its type by extension; a project can override that mapping
// ("Associate with File Type…"), and the override drives both the status-bar label
// and the editor's syntax highlighting.
const languageLabels: Record<string, string> = { java: 'Java', cpp: 'C++', typescript: 'TypeScript', other: '纯文本' }
function associationOf(path: string): string | undefined {
  const dot = path.lastIndexOf('.')
  const ext = dot < 0 ? '' : path.slice(dot + 1).toLowerCase()
  return projectSettings.value.fileAssociations[ext]
}
function languageOf(path: string): string {
  const mapped = associationOf(path)
  if (mapped) return languageLabels[mapped] ?? mapped
  if (/\.java$/.test(path)) return 'Java'
  if (/\.(c|cpp|h|hpp|cc|cxx)$/.test(path)) return 'C++'
  if (/\.vue$/.test(path)) return 'Vue'
  if (/\.tsx?$/.test(path)) return 'TypeScript'
  if (/\.[cm]?jsx?$/.test(path)) return 'JavaScript'
  if (/\.json$/.test(path)) return 'JSON'
  if (/CMakeLists\.txt$/i.test(path)) return 'CMake'
  return '纯文本'
}
const language = computed(() => languageOf(active.value?.path ?? ''))
const candidates = computed(() => {
  const paths = new Set([...allTabs.value.map(tab => tab.path), ...(workspace.value?.entries.filter(entry => entry.kind === 'file').map(entry => entry.path) ?? [])])
  return [...paths].filter(path => path.toLowerCase().includes(query.value.toLowerCase()))
})
// 分栏与面板尺寸是一个域（IDEA 的 WindowAction/ResizeToolWindowAction + SplitterAction）。
const {
  viewport, editorStageSize, setSplitSize, panelMax, setPanelSize, toolSizes, saveToolSizes, resizeKey,
  resizeTarget, resizeTargetFor, resizeStep, stretchToolWindow, resizeSplitKey, startSplitResize, startResize,
  onWindowResize, changeSplitOrientation, cancelResize,
} = createPanelResize({
  editorSettings, panelSizes, activity, explorer, leftView, toolAnchors, activeAnchor, bottom, bottomTab, workspace,
  zenMode, resizing, splitModel, splitSize, splitOrientation, activeToolWindowDock,
})
function currentChrome(): ToolWindowChrome {
  return { explorer: explorer.value, activity: activity.value, bottom: bottom.value }
}
/**
 * `HideAllToolWindowsAction.actionPerformed` (`:14-32`): with anything still visible, snapshot the
 * layout into `layoutToRestoreLater` and hide every window; with nothing visible, put the snapshot
 * back and clear the field (`:19-21` nulls it before `setLayout`). With neither, the action is
 * disabled (`:36, :48`) and this port does nothing rather than "restore" a layout it never took.
 */
function toggleMaximizeEditor() {
  const chrome = currentChrome()
  if (hasVisibleToolWindow(chrome)) {
    savedChrome.value = chrome
    explorer.value = false; activity.value = false; bottom.value = false
  }
  else {
    const saved = savedChrome.value
    if (!saved) return
    savedChrome.value = null
    explorer.value = saved.explorer; activity.value = saved.activity; bottom.value = saved.bottom
  }
}
const savedChrome = ref<ToolWindowChrome | null>(null)
function changeTheme(value: Theme, event?: MouseEvent) {
  menu.value = null
  themeRipple(event ?? null, value, () => {
    theme.value = value
  })
  try { localStorage.setItem(themeStorageKey, value) }
  catch { notify('主题已切换，但当前环境无法保存主题偏好。', true) }
}
function dismissMenu(event: PointerEvent) {
  // 子菜单浮层 Teleport 到了 body：点它的行不属于 .menu-anchor，必须单独放行，
  // 否则点子菜单项会被当成"点了菜单外"把整条菜单关掉。
  if (!(event.target as Element).closest('.menu-anchor, .menu-submenu, .hamburger-button')) {
    menu.value = null
    submenuRow.value = null   // 否则子菜单浮层会在主菜单收起后孤立地留在屏幕上
  }
  if (!(event.target as Element).closest('.tool-strip-heading')) toolMenu.value = null
  if (!(event.target as Element).closest('.project-widget')) projectWidgetOpen.value = false
  if (!(event.target as Element).closest('.filename-widget')) filenamePopup.value = false
}
function focusMenu(kind: NonNullable<typeof menu.value>, last = false) {
  menu.value = kind
  void nextTick(() => {
    const items = document.querySelectorAll<HTMLButtonElement>(`#menu-${kind} > button:not(:disabled)`)
    items[last ? items.length - 1 : 0]?.focus()
  })
}
function onMenuKeydown(event: KeyboardEvent, kind: NonNullable<typeof menu.value>) {
  if (!['ArrowDown', 'ArrowUp', 'ArrowLeft', 'ArrowRight', 'Home', 'End', 'Escape', 'Tab'].includes(event.key)) return
  event.stopPropagation()
  if (event.key === 'Tab') { menu.value = null; return }
  event.preventDefault()
  if (event.key === 'Escape') {
    menu.value = null
    document.querySelector<HTMLButtonElement>(`[aria-controls="menu-${kind}"]`)?.focus()
    return
  }
  if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
    const index = allMenuGroups.value.findIndex(group => group.menu === kind)
    const groups = allMenuGroups.value
    const next = groups[(index + (event.key === 'ArrowRight' ? 1 : -1) + groups.length) % groups.length]!
    focusMenu(next.menu)
    return
  }
  const items = [...document.querySelectorAll<HTMLButtonElement>(`#menu-${kind} > button:not(:disabled)`)]
  const index = items.indexOf(document.activeElement as HTMLButtonElement)
  const next = event.key === 'Home' ? 0 : event.key === 'End' ? items.length - 1
    : (index + (event.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length
  items[next]?.focus()
}
// 通知与状态栏键盘导航是一个域（IDEA 的通知中心 + IdeStatusBarImpl 的焦点遍历）。
const {
  noticeLog, noticeOpen, notify, notifyFromPanel, notifyProgress, noticeActions, runNoticeAction, runBalloonAction, expireNotice, statusBarRef, statusWidgets, focusStatusBar,
  restoreFocusFromStatusBar, onStatusBarKeydown, statusMenu, openStatusMenu, clearNotices, closeFirstNotification,
} = createNotifications({ notice, noticeError, noticeAction })
// --- IDEA's ToolWindowsWidget (status/ToolWindowsWidget.java:62-299) ---------
// It is built straight into the status bar's left panel (IdeStatusBarImpl.kt:286-297)
// instead of going through a StatusBarWidgetFactory, so it is *not* one of the widgets
// the components checklist can hide — it is always there while a project is open
// (isActive() == statusBar.getProject() != null, :242-244).
//   * clicking it flips UISettings.hideToolStripes (:206-212);
//   * hovering it for 300 ms lists every available tool window sorted by stripe title
//     (:163-168) with the mnemonic the keymap binds to its Activate… action (:288-296);
//     picking a row activates that window (:188-191).
const toolWindowsPopup = ref(false)
let toolWindowsPopupTimer: number | null = null
// The 300 ms is used in both directions: to arm the popup (:197) and to let the pointer
// travel from the widget into the popup without dismissing it (:138-142).
function scheduleToolWindowsPopup(open: boolean) {
  if (toolWindowsPopupTimer !== null) window.clearTimeout(toolWindowsPopupTimer)
  toolWindowsPopupTimer = window.setTimeout(() => { toolWindowsPopupTimer = null; toolWindowsPopup.value = open }, 300)
}
function closeToolWindowsPopup() {
  if (toolWindowsPopupTimer !== null) { window.clearTimeout(toolWindowsPopupTimer); toolWindowsPopupTimer = null }
  toolWindowsPopup.value = false
}
function toggleToolWindowStripes() {
  void saveSettingsPatch({ showToolWindowBars: !editorSettings.value.showToolWindowBars })
}
// StringUtil.naturalCompare treats embedded digit runs as numbers and everything else
// as plain code units — it is deliberately *not* a collation, so it is what IDEA sorts
// the stripe titles with (ToolWindowsWidget.java:168). See src/toolWindows.ts.
// isAvailable() && isShowStripeButton() (:163-167), then sorted by stripe title (:168).
const availableToolWindows = computed(() => sortedByTitle([...toolWindowOrder].filter(id => !toolDisabled(id)), id => toolTitles[id]))
// 状态栏"工具窗口"弹窗按停靠边分组（IDEA 的 ToolWindowsWidget 主体就是按 anchor 分组的列表）。
const groupedAvailableToolWindows = computed(() => {
  const groups: { anchor: Anchor; label: string; ids: ToolWindowId[] }[] = [
    { anchor: 'left', label: '左侧', ids: [] },
    { anchor: 'bottom', label: '底部', ids: [] },
    { anchor: 'right', label: '右侧', ids: [] },
  ]
  for (const group of groups) {
    group.ids = sortedByTitle(
      toolWindowOrder.filter(id => !toolDisabled(id) && (toolAnchors[id] ?? 'left') === group.anchor),
      id => toolTitles[id])
  }
  return groups.filter(group => group.ids.length > 0)
})
// 工具窗口内容宿主的上下文：见 src/toolViewContext.ts（它是**所有面板的输入面**，
// 字段清单在那边；注入的是宿主里同名变量的引用，`computed` 保证随状态变化）。
const toolViewCtx = computed<ToolWindowViewContext>(() => createToolViewContext({
  workspace, explorer, active, activePath, lspReady, outline, sortedAll, projectSettings, todoSource,
  syntheticNodes, editorSettings, projectViewFileColor, fileTreeRef, searchPanelRef, testRunnerRef, noticeLog, clearNotices, runNoticeAction, expireNotice, runConfigProgram, runConfigCwd,
  evaluateRequest, commitMessageSettings, editorFor, onSearchOpen, onSearchReplaced, revealLocation,
  dropBookmark, openMnemonicPrompt, revertHistory, onTreeContext, openFile, notify, refreshTree,
  historyEpoch, leftView, saveSettingsPatch, saveVcsLog, gitCompareWith, saveBookmarksView, gradleHost, gradleViewContext, openSettings,
}))
// IDEA's "Recent Places" collects every place the caret has been: files, symbols and
// bookmarks alike, most recent first.
const places = ref<Place[]>([])
// IdeDocumentHistory keeps navigation and change places as two rings; TaoCode records
// one list and flags the entries that came from an edit, so "Show edited only" (the
// checkbox in IDEA's RecentLocations) filters within it.
const changePlaces = ref<Place[]>([])
function rememberPlace(place: Place) {
  const rest = places.value.filter(item => !(item.path === place.path && item.line === place.line))
  places.value = [place, ...rest].slice(0, 60)
  if (place.edited) {
    const kept = changePlaces.value.filter(item => !(item.path === place.path && item.line === place.line))
    changePlaces.value = [place, ...kept].slice(0, 60)
  }
}
// IDEA remembers the last-edited configurable (project.structure.last.edited); the
// Window menu jumps straight into a section, so the dialog needs the hint.
// 设置的持久化与各页保存是一个域（190 行）；注入的是宿主已有的 ref，模板零改动。
const {
  settingsSectionHint, commitMessageSettings, openSettings, saveSettings, saveGeneralSettings, readCommitMessageSettings, saveCommitMessageSettings,
  saveProjectSettings, saveTemplateSettings, saveTodoPatterns, saveFileAssociations, saveVcsLog, saveBookmarksView,
  saveScopes, saveSettingsDraft, saveJavaSettings, browseStructureDir, saveBuildTools,
} = createSettingsPersistence({
  // 惰性：`startLsp` 由 LSP 模块提供（解构在更后面），这里只要一个引用。
  notify, isDesktop, startLsp: (...args) => startLsp(...args), settingsOpen, settingsBusy, settingsError,
  editorSettings, generalSettings, projectSettings,
  bookmarks: () => bookmarks.value, setBookmarks: value => { bookmarks.value = value },
  busy, menu, allTabs, bufferEpoch, treeVersion,
  workspaceEpoch: () => workspaceEpoch, working, workspace,
})
async function openFile(path: string, internal = false, options?: { preview?: boolean }) {
  if ((busy.value && !internal) || opening.has(path)) return
  const existing = findTab(path)
  if (existing) {
    // Clicking a preview tab twice, or opening it from Go to File, promotes it to a
    // normal tab — IDEA's pin-on-second-open.
    if (existing.preview && !options?.preview) existing.preview = false
    switchTabIn(focusedPane.value, existing); palette.value = false; return
  }
  const epoch = workspaceEpoch
  opening.add(path)
  try {
    const doc = await request<DocumentData>('file.read', { path })
    if (epoch !== workspaceEpoch) return
    const tab: Tab = { ...doc, saving: false, dirty: false, line: 1, column: 1, lspRunning: false, lspConfigured: false, readOnly: doc.readOnly }
    // IDEA opens tree selections as preview (italic) tabs that the next preview replaces.
    if (options?.preview) { const previous = groups[focusedPane.value].tabs.find(item => item.preview); if (previous) void closeTabIn(focusedPane.value, previous) }
    tab.preview = options?.preview === true
    groups[focusedPane.value].tabs.push(tab)
    groups[focusedPane.value].activePath = path
    touchHistory(path)
    enforceTabLimit(focusedPane.value, path)
    rememberRecent(path)
    // A freshly opened file sits at its first line until the caret says otherwise.
    rememberPlace({ kind: '文件', path, line: 0, label: path })
    palette.value = false
    if (doc.readOnly) await nextTick(), editorFor(path)?.setReadOnly(true)
    if (isDesktop) await startLsp(tab)
  } catch (error) {
    // A file the text layer refuses (NUL bytes) is still openable: IDEA shows it in
    // its binary/hex viewer instead of failing the navigation.
    if (isDesktop && (error as { code?: string })?.code === 'BINARY_FILE') { void openBinary(path); return }
    notify(errorMessage(error), true)
  }
  finally { opening.delete(path) }
}
// IDE-08/09: image preview + hex dump for everything the text editor cannot hold.
const binaryView = ref<{ path: string; data: BinaryView } | null>(null)
async function openBinary(path: string) {
  if (!isDesktop) { notify('浏览器预览不能读取磁盘二进制文件，请在桌面端使用。', true); return }
  try {
    const data = await request<BinaryView>('file.readBinary', { path })
    binaryView.value = { path, data }
    notify(`「${path.split('/').pop()}」以二进制方式打开（${data.kind}）。`)
  } catch (error) { notify(errorMessage(error), true) }
}
function closeBinary() { binaryView.value = null }
async function revealBinary() {
  const path = binaryView.value?.path
  if (!path) return
  try { await request('file.reveal', { path }) } catch (error) { notify(errorMessage(error), true) }
}
// EXT-01 plugin extension points: a plugin is a directory under the profile holding a
// plugin.json; it publishes commands and templates and is enabled/disabled by a
// `.disabled` marker. No third-party code is loaded into the host.
// 插件 / 工作树 / 子模块 / 文件历史是一个域（各自的 open/busy/数据都在模块里自持）。
const {
  pluginOpen, pluginBusy, pluginList, installingPlugins, openPlugins, togglePluginById, installPlugin, installPluginDirectory, setPluginsEnabled, uninstallPlugin, refreshPlugins, togglePlugin,
  worktreeOpen, worktreeBusy, worktrees, worktreePath, worktreeBranch, worktreeNewBranch, openWorktrees, addWorktree, removeWorktree,
  submoduleOpen, submoduleBusy, submodules, openSubmodules, updateSubmodules,
  fileHistoryOpen, fileHistoryBusy, fileHistory, fileHistoryCommit, fileHistorySelected, showFileHistory, showCommit,
} = createProjectExtras({ notify, isDesktop, workspace: () => workspace.value })
// 代码洞察的语义动作是一个域：`onSemantic` 是编辑器 `@semantic` 的唯一入口，它分发到的
// 重命名/格式化/签名帮助/代码动作/层级视图共享同一批弹窗状态（`signaturePopup` / `batchFixBusy`）。
// 审阅入口：src/semanticActions.ts。
const {
  signaturePopup, closeSignaturePopup, navigateSignature, batchFixBusy, fixAllInFile,
  onSemantic, runFormatting, runSignature, openCodeActions, caretPayload, runOrganizeImports,
  applyCodeAction, renameEntryWithReferences, applyEditsToFiles, submitRename, applyRename,
  toggleOutline, jumpDebugLocation,
} = createSemanticActions({
  notify, isDesktop, generalSettings, workspace: () => workspace.value, active, activePath, findTab, editorFor,
  lspReady, save, codeActions, actionPrompt, renamePrompt, renameValue, renameInput, invalidRenameName,
  baseName, explorer, leftView,
  // 惰性：这些能力的声明都在本块之后（LSP 模块、层级视图模块、底部面板、标签标题），互为上下游。
  lspOn: (...a) => lspOn(...a),
  prepareHierarchy: (...a) => prepareHierarchy(...a),
  showOutput: (...a) => showOutput(...a),
  refreshOutline: (...a) => refreshOutline(...a),
  revealLocation: (...a) => revealLocation(...a),
  retitleTab: (...a) => retitleTab(...a),
})
// Code Vision（LSP `codeLens`）的点击 —— IDEA 的 `CodeVisionProvider.handleClick`
// （platform/lang-impl/src/com/intellij/codeInsight/codeVision/CodeVisionProvider.kt:76）。
// 条目里的命令直接转成 `workspace/executeCommand`，复用既有链路。
async function runCodeLensCommand(payload: { command: string; arguments?: unknown[] }) {
  if (!payload?.command) return
  try {
    await request('lsp.request', {
      kind: 'executeCommand', path: activePath.value, line: 0, character: 0, command: payload.command,
      // `arguments` 是可选参数：没有就不发这个键（见 lsp_session.cpp 的整形）。
      ...(payload.arguments ? { arguments: payload.arguments } : {}),
    })
  } catch (error) { notify(errorMessage(error), true) }
}
// LSP `documentLink` 的 Ctrl+Click（IDEA 侧的 Ctrl+Click 跳转 = `GotoDeclarationHandler`，
// "点一下导航"的抽象 = `HyperlinkInfo.navigate`，见 `src/documentLinks.ts` 的模块注释）。
// 外部链接交给系统（`shell.openUrl`，宿主会拒绝没有协议前缀的字符串），
// 文件路径交给 IDE 自己打开 —— 这样才能定位到行、复用标签页。
async function openDocumentLink(link: DocumentLink) {
  const action = classifyLinkTarget(link.target)
  if (action.kind === 'none') { notify(describeLink(link), true); return }
  if (action.kind === 'external') {
    if (!isDesktop) { notify(`浏览器预览里不能打开外部链接：${action.url}`); return }
    try { await request('shell.openUrl', { url: action.url }) }
    catch (error) { notify(errorMessage(error), true) }
    return
  }
  // 绝对路径要落回工作区相对路径才能被 openFile 找到；落在工作区外的如实说明，
  // 而不是拿一个猜出来的路径去打开（那会开出完全不相关的文件）。
  const root = workspace.value?.root?.replace(/\\/g, '/').replace(/\/+$/, '')
  let path = action.path.replace(/\\/g, '/')
  if (root && (/^[A-Za-z]:/.test(path) || path.startsWith('/'))) {
    if (path.toLowerCase().startsWith(`${root.toLowerCase()}/`)) path = path.slice(root.length + 1)
    else { notify(`该链接指向工作区外的文件：${action.path}`, true); return }
  }
  // `#L12` 是 1 基的行号，`revealLocation` 用的是 0 基。
  await revealLocation({ path, line: Math.max(0, action.line - 1) })
}
// IDEA 的 `XLineBreakpointType.canPutAt` + `XDebuggerUtilImpl.getBreakpointTypeByPosition`
// （platform/xdebugger-api/src/com/intellij/xdebugger/breakpoints/XLineBreakpointType.java:50-52，
// platform/xdebugger-impl/src/com/intellij/xdebugger/impl/XDebuggerUtilImpl.java:111-121）：
// 没有任何断点类型说「这一行能放」时**拒绝**放断点（IDEA 报 "Cannot find appropriate
// breakpoint type"），而不是放一个永远不会命中的断点。
// DAP 的对应物是 `breakpointLocations`，但它只在会话里、且适配器声明了
// `supportsBreakpointLocationsRequest` 时才问得到答案 —— 问不到就跳过校验（不因为服务器
// 不支持就把功能禁掉），这个区分由 `breakpointPlacement` 的 `checked` 字段表达。
async function queryBreakpointPlacement(path: string, line: number) {
  try {
    const result = await dapBreakpointLocations(path, line)
    return result.available ? result.locations ?? [] : null
  } catch { return null }  // 没有会话 / 适配器没声明 / 请求失败 —— 一律算「问不到」
}
async function toggleBreakpointAt(path: string, line1: number) {
  if (!path || !isDesktop) return
  const current = dapBreakpoints.get(path) ?? []
  const existing = current.some(point => point.line === line1)
  if (!existing) {
    const answer = await breakpointPlacement(path, line1, breakpointLocationCache, queryBreakpointPlacement)
    if (answer.checked && !answer.canPlace) { notify(answer.message, true); return }
  }
  const next = existing
    ? current.filter(point => point.line !== line1)
    : [...current, { line: line1 }].sort((a, b) => a.line - b.line)
  if (next.length) dapBreakpoints.set(path, next); else dapBreakpoints.delete(path)
  try { await dapSetBreakpoints(path, next) }
  catch (error) { notify(`切换断点失败：${errorMessage(error)}`, true) }
}
function currentDebugLine(path: string) {
  return dapState.currentLocation && dapState.currentLocation.path === path ? dapState.currentLocation.line : 0
}
async function revertHistory(entry: HistoryEntry) {
  const path = activePath.value
  if (!path || !isDesktop) return
  try {
    const snapshot = await request<HistoryContent>('history.content', { path, id: entry.id })
    const open = findTab(path)
    if (open && !open.dirty && open.content === snapshot.content) { notify('该版本已是当前内容。'); return }
    let version = open?.version
    let encoding = open?.encoding ?? 'utf-8'
    let bom = open?.bom ?? false
    if (version === undefined) { const doc = await request<DocumentData>('file.read', { path }); version = doc.version; encoding = doc.encoding; bom = doc.bom }
    const saved = await request<SaveResult>('file.write', { path, content: snapshot.content, expectedVersion: version, encoding, bom, safeWrite: generalSettings.value.isUseSafeWrite })
    if (open) { open.content = snapshot.content; open.version = saved.version; open.dirty = false; editorFor(path)?.setDraft(snapshot.content) }
    if (isDesktop) void request('lsp.change', { path, text: snapshot.content }).catch(() => undefined)
    notify(`已回滚到 ${entry.time.replace('T', ' ').replace('Z', '')}`)
    historyEpoch.value++  // the rollback itself became a new "save" snapshot
  } catch (error) { notify(errorMessage(error), true) }
}
async function save(tab = active.value): Promise<boolean> {
  menu.value = null
  if (!tab || !tab.dirty) return true
  if (tab.saving || busy.value) return false
  tab.saving = true
  let content = editorFor(tab.path)?.text() ?? tab.content
  // IDEA's "Reformat code" in Actions on Save: format the buffer first and write what
  // the language service produced. The options come from the editor settings and are
  // forwarded by the bridge as top-level params (main.cpp's lsp.request branch).
  // A failure here must not block the save, and must not be swallowed either.
  if (editorSettings.value.formatOnSave && lspOn(tab)) {
    try {
      const formatted = await request<LspFormatResult>('lsp.request', {
        kind: 'formatting', path: tab.path, line: 0, character: 0,
        tabSize: editorSettings.value.tabSize,
        insertSpaces: !editorSettings.value.useTabCharacter,
      })
      const file = formatted.edits?.find(entry => entry.path === tab.path)
      if (file?.textEdits.length) {
        const next = applyTextEdits(content, file.textEdits)
        // The buffer has to match what lands on disk, otherwise the editor stays
        // dirty after a successful save.
        if (next !== content) { content = next; editorFor(tab.path)?.setDraft(next) }
      }
    } catch (error) { notify(`保存前格式化失败，按原样保存：${errorMessage(error)}`, true) }
  }
  try {
    const result = await request<SaveResult>('file.write', { path: tab.path, content, expectedVersion: tab.version, encoding: tab.encoding, bom: tab.bom, safeWrite: generalSettings.value.isUseSafeWrite })
    tab.content = content
    tab.version = result.version
    tab.dirty = false
    editorFor(tab.path)?.markSaved()
    notify(isDesktop ? `已保存 ${tab.path} · ${result.bytes} 字节 · ${encodingLabels[tab.encoding]}` : `示例已保存到内存 · ${result.bytes} 字节（未写入磁盘）`)
    // IDEA's FileStatusManager fires a status change on save, which repaints the toolbar
    // filename widget; refresh the change list it reads so the colour follows the file.
    if (isDesktop) void refreshGitWidget()
    return true
  } catch (error) {
    if (error instanceof BridgeError && error.code === 'CONFLICT') {
      // IDEA's "Reload from Disk / Keep Files": offer the choice instead of only a
      // message, so a disk change never forces a close-and-reopen.
      conflictPrompt.value = { path: tab.path }
      notify(`${tab.path} 在磁盘上已被外部修改，保存已阻止。可重新载入磁盘版本，或保留当前修改后另存。`, true)
    } else if (error instanceof BridgeError && error.code === 'READ_ONLY') {
      tab.readOnly = true
      editorFor(tab.path)?.setReadOnly(true)
      notify(`${tab.path} 是只读文件；用右键菜单「文件属性 → 切换只读」解除后再保存。`, true)
    } else notify(errorMessage(error), true)
    return false
  } finally { tab.saving = false }
}
// 编辑器的文件级操作是一个域（保存冲突 / 快速文档 / 复制引用 / 缩进 / 行尾 / 编码）。
const {
  conflictPrompt, conflictDiff, showConflictDiff, resolveConflictReload, resolveConflictKeep,
  quickDoc, showQuickDoc, closeQuickDoc, copyReference, showFileProperties,
  convertIndents, convertLineSeparators, encodingPrompt, encodingSelect, openEncoding,
  reloadWithEncoding, applyEncodingChoice,
} = createEditorFileOps({
  notify, isDesktop, active, findTab, editorFor, request, menu, editorSettings, bufferEpoch, lspReady,
  // 惰性：`toggleReadOnly` 由文件树模块提供（装配在本块之后）。
  toggleReadOnly: (...args) => toggleReadOnly(...args), buffer: () => bufferEpoch,
  // `treeMenu` 由文件树模块（装配在本块之后）自持 —— 用 getter/setter 共享同一份。
  treeMenu: { get value() { return treeMenu.value }, set value(v) { treeMenu.value = v } },
})
async function saveAll() {
  clearAutoSave()
  for (const tab of allTabs.value) if (!await save(tab)) return false
  return true
}
async function createScratch() {
  if (!workspace.value) return
  menu.value = null
  try {
    try { await request('file.create', { path: 'scratch', directory: true }) } catch { /* scratch/ may already exist */ }
    let index = 1
    let path = `scratch/scratch-${index}.txt`
    while (true) {
      try { await request('file.create', { path }); break }
      catch (e) { if (e instanceof BridgeError && e.code === 'EXISTS') { index++; path = `scratch/scratch-${index}.txt` } else throw e }
    }
    await refreshTree()
    await openFile(path)
    notify(`已创建临时文件 ${path}`)
  } catch (error) { notify(errorMessage(error), true) }
}
async function closeTab(tab: Tab) {
  const pane = (groups[0].tabs.includes(tab) ? 0 : 1) as 0 | 1
  await closeTabIn(pane, tab)
}
// 沉浸模式（演示 / 专注 / Zen）的来源与协调见 src/distractionFreeSession.ts ——
// Zen **不是**"隐藏一切"，而是"专注模式 + 全屏"（IDEA 的 ToggleZenModeAction.kt:59-80）。
// IDEA 的**专注模式**（`ToggleDistractionFreeModeAction`）：把一批编辑器/UI 设置**批量**换成专注值，
// 退出时把用户进之前的值恢复回去。双向语义（before/after）与 TaoCode 侧能映射的 6 项见
// `src/distractionFreeMode.ts` 的模块注释（那里有 applyAndSave 的行号）。
// 隐藏 chrome 的来源有**两个且相互独立**：Zen 与专注模式（IDEA 的专注模式也会 storeToolWindows，
// 见 ToggleDistractionFreeModeAction.java:72/84）。所以判断必须是"或"，不能共用一个 ref。
// 专注模式的会话状态在 `src/distractionFreeSession.ts`（自持三个 ref 的状态机）——
// App 只组装依赖、只读 `enabled`。加这块逻辑会把本文件顶到机检上限，所以它必须住在模块里。
const distractionFree = createDistractionFreeSession({
  read: () => editorSettings.value,
  write: patch => saveSettingsPatch(patch),
  onError: message => notify(message, true),
})
const distractionFreeMode = distractionFree.enabled
const toggleDistractionFreeMode = distractionFree.toggle

// 三种沉浸来源（演示模式 / 专注模式 / Zen）的协调也在那个模块里：Zen = **专注模式 + 全屏**
// （IDEA 的 `ToggleZenModeAction.kt:59-80`），不是"再叠一层隐藏"。
// 全屏状态由宿主持有，这里镜像一份给菜单勾选态与沉浸协调用（函数声明会提升，所以
// `toggleFullScreen` 留在下面定义没问题，ref 必须先声明）。
const fullScreen = ref(false)

const immersive = createImmersiveMode({
  distractionFree,
  zenFlag: zenMode,
  fullScreen,
  setFullScreen: async state => {
    if (!isDesktop) return null
    try { return (await appSetFullScreen(state)).fullScreen }
    // 全屏不可用时返回 null，让协调层保留其它部分的生效（对应 IDEA 的 isFullScreenApplicable）。
    catch { return null }
  },
  readFullScreen: async () => {
    try { return (await appFullScreen()).fullScreen } catch { return null }
  },
  presentationMode: () => editorSettings.value.presentationMode,
  exitPresentationMode: () => saveSettingsPatch({ presentationMode: false }),
})
const chromeHidden = immersive.chromeHidden
const hideChromeLabel = immersive.exitLabel
function toggleZenMode() { void immersive.toggleZen() }

// 退出"隐藏 chrome"的三种来源：演示模式（持久化设置）、专注模式、Zen。
// 演示模式必须写回设置 —— 只翻本地状态的话 watch 会把它覆盖回来，而且重启后设置仍为 true，
// 表现为"一打开就自动进入 Zen"。
function exitHideChrome() { void immersive.exitAll() }
// 编辑器侧视图（Markdown 预览）与项目视图定位是一个域。
const {
  cancelMarkdownRefresh, refreshMarkdownNow, refreshMarkdownSoon, toggleMarkdownPreview,
  refreshTree, openBreadcrumb, showNavBar,
  selectInOpen, selectInAt, selectInRows, openSelectIn, closeSelectIn, pickSelectIn,
} = createEditorSideViews({
  notify, workspace, busy, treeVersion, active, activePath, editorFor, findTab, explorer, leftView, fileTreeRef, workspaceRoot: () => workspace.value?.root ?? '',
  markdownPreviewOn, markdownCapable, markdownSource, isDesktop,
  // 惰性：`refreshSyntheticNodes` 由工作区生命周期模块提供（装配在本块之后）。
  refreshSyntheticNodes: (...a) => refreshSyntheticNodes(...a),
  breadcrumbsVisible: breadcrumbsOn, changeOf: gitChangeFor, focusToolWindow: focusToolWindowContent, openProjectStructure, // Select In 的四个落点由更晚装配的宿主函数提供（函数声明已提升）
})
// 文件树与标签的上下文操作是一个域（菜单坐标状态在模块里自持）。
const {
  nameDialogTitle, isLayoutDialog,
  treeMenu, treeSubmenu, fileClipboard, copyCollisionName, pasteFromClipboard, cutTreeEntry, copyTreeEntry, revealInExplorer,
  tabMenu, onTabContext, togglePinTab, closeOtherTabsIn, closeAllTabsIn, closeUnpinnedTabsIn, closeTabsToRightIn,
  closeTabsToLeftIn, hasTabsToRight, hasTabsToLeft, copyPathOfTab,
  goLinePrompt, goLineValue, goLineInput, goToLine, recentPrompt, recentQuery, recentInput, recentFiles,
  rememberRecent, recentFiltered, openRecent, tabEntryPointItems
} = createExplorerActions({
  notify, isDesktop, menu, generalSettings, workspace, groups, active, reveal, query, baseName, parentOf, refreshTree, nameDialog, nameInput,
  // 惰性：`revealLocation` 由 LSP/导航模块提供、`renameEntryWithReferences` 由语义动作模块提供
  // （两者都装配在本块之后），依赖互为上下游。
  revealLocation: (...args) => revealLocation(...args), openFile, closeTabIn, renameEntryWithReferences: (...args) => renameEntryWithReferences(...args),
  closedTabsPerPane, reopenClosedTab, unsplit, unsplitAll, splitOrientation: () => splitModel.orientation, changeSplitOrientation, openSettings: (s?: string) => openSettings(s as never), // 标签条「更多」下拉（成员表在 tabEntryPointMenu.ts）
})

// LSP 生命周期 + 导航 + 符号搜索是一个域（启动/停止语言服务与"跳到哪"共享同一批状态）。
const {
  startLsp, lspOn, autoSaveDelay, clearAutoSave, scheduleAutoSave, onWindowBlur, onEditorChange,
  jumpLastEditLocation, stopLspFile, resetLsp, revealLocation, goBack, goForward, openGoLine,
  openRecentFiles, placesPrompt, placesQuery, placesInput, placesEditedOnly, placesList, placeSnippet,
  placesFiltered, placesIndex, movePlace, openRecentPlaces, openPlace,
  fileSymbolEntries, globalSymbolEntries, openSymbol, onSymbolQuery, moveSymbol, jumpSymbol,
  onSearchOpen, onSearchReplaced, jumpMethod, refreshOutline,
} = createLspNavigation({
  notify, isDesktop, scheduleSessionSave, goLineValue, goLinePrompt, goLineInput, recentPrompt, recentQuery, recentInput, editorSettings, generalSettings, workspace, workspaceEpoch: () => workspaceEpoch, active, activePath, groups, findTab, hasTabPath,
  editorFor, refreshTree, refreshMarkdownSoon, markdownPreviewOn, menu, palette, outline, dirty, places, changePlaces,
  rememberPlace, navBack, navForward, openFile, save, saveAll, reveal, splitModel, symbolPrompt, symbolQuery, symbolInput,
  symbolResults, symbolIndex, breakpointLocationCache,
})
// 书签是一个域（书签表 + 助记符 + 跳转，状态在模块里自持）。
const {
  bookmarks, sortedAll, bookmarkLines, mnemonicPrompt, placeAt, toggleBookmark, openMnemonicPrompt, pickMnemonic,
  useProjectSettings, digits, bookmarkSave,
  jumpMnemonic, cycleBookmark, dropBookmark, mnemonicOwner, persistBookmarks,
} = createBookmarkActions({ notify, isDesktop, menu, projectSettings, workspace, active, language, baseName, rememberPlace, revealLocation })

// IDEA's Surround With popup: the same fuzzy finder the action list uses, over the
// language-neutral templates in surround.ts.
// 包围与模板选择器是一个域（提示/候选/应用三件套，状态在模块里自持）。
const {
  surroundPrompt, surroundQuery, surroundIndex, surroundInput, surroundChoices, openSurround, moveSurround, applySurround,
  templateChooser, templateQuery, templateIndex, templateInput, templateChoices, openTemplateChooser, moveTemplate, applyTemplate,
} = createSurroundTemplates({ notify, menu, projectSettings, workspace, active, editorFor, pluginList })
// 运行/调试配置是一个域（IDEA 的 RunManager + RunConfigurationsDialog，含草稿编辑表单）。
const {
  runConfigs, runConfigName, runWidgetTitle, configChooser, configIndex, openConfigChooser, moveConfig,
  applyConfigChoice, runConfigType, runConfigProgram, runConfigDebugAdapter, runConfigArgs, runConfigCwd,
  runConfigEnv, runConfigBefore, runConfigFolder, runConfigEditorOpen, runConfigDebug, runConfigsOpen,
  runConfigDraft, loadRunConfigDraft, saveRunConfigFromDialog, openRunConfigurations,
  linesToArray, arrayToLines, currentRunConfig, selectRunConfig, pickConfig, persistRunConfigs, allRunConfigNames,
  addBeforeLaunchStep, removeBeforeLaunchStep, removeRunConfigFromDialog, saveConfig, removeConfig,
} = createRunConfigurations({
  notify, workspace, projectSettings, runCommand, menu, isDesktop,
  // 惰性：`runSelectedConfig` 由运行动作模块提供（装配在本块之后）。
  runSelectedConfig: (...a) => runSelectedConfig(...a),
})
// IDEA「文件 › 项目结构…」（Ctrl+Alt+Shift+S）打开的是**独立对话框**（ShowStructureSettingsAction.java:26-32），
// 不是设置树里的一页 —— 所以它是独立状态。
const projectStructureOpen = ref(false)
function openProjectStructure() { projectStructureOpen.value = true; menu.value = null }
// IDEA 的 Run to Cursor（Alt+F9，`$default.xml:990-992`；ForceRunToCursor = Ctrl+Alt+F9）：
// DAP 里是两步 —— `gotoTargets` 问"这一行能停在哪儿"，再 `goto` 跳过去。适配器没声明
// `supportsGotoTargetsRequest` 时原生回 DAP_UNSUPPORTED，这里如实提示。
async function runToCursor() {
  if (!isDesktop || !workspace.value) { notify('桌面端才能运行到光标处。', true); return }
  if (!dapState.running) { notify('先启动调试会话（Shift+F9），再运行到光标处。', true); return }
  if (!dapState.paused) { notify('调试会话正在运行；运行到光标处需要先停在断点上。', true); return }
  const target = caretPayload()
  const line = target.line + 1   // 编辑器 0 基 → DAP 1 基
  try {
    const result = await dapGotoTargets(target.path, line, target.character)
    const first = result.targets?.[0]
    if (!first) { notify(`第 ${line} 行没有可执行的位置。`, true); return }
    await dapGoto(dapState.threadId, first.id)
    notify(`已运行到 ${target.path}:${first.line || line}。`)
  } catch (error) {
    const code = error instanceof BridgeError ? error.code : ''
    notify(code === 'DAP_UNSUPPORTED' ? '该调试适配器不支持运行到光标处。' : errorMessage(error), true)
  }
}
// 版本控制动作是一个域（IDEA 的 Git 菜单 + GitBranchesPopup + Annotate）。
const {
  branchPopupOpen, openBranchPopup, onBranchAction, refreshTreeVersion, gitCompareWith, compareWithBranch,
  blameEnabled, blameOf, clipboardDiff, showBlame, compareWithClipboard,
  updateProject, resetHeadDialog, pushWithConfirm, gitMenuAction,
} = createVcsActions({ notify, isDesktop, workspace, gitAvailable, refreshGitWidget, treeVersion, activePath, active, bottom, showOutput, showView,
  // 惰性：gradleHost 在更后面组装（VCS 更新要触发构建工具的自动重载，见 src/gradleHost.ts）。
  onVcsUpdated: () => onVcsUpdated() })
// 调用/类型层级视图是一个域（方向/根符号/节点树都在模块里自持）。
const {
  hierKind, hierRoot, hierItems, hierOrigin, hierBusy, hierError, hierDirection, hierOptions, hierTitle, hierRows,
  hierarchyKey, hierarchyNodes, hierarchyChildren, resetHierarchy, prepareHierarchy, loadHierarchy, toggleHierarchy, pickHierarchyDirection,
  callSiteTarget,
} = createHierarchyView({
  notify, bottom: () => bottom.value, loading: () => loading.value,
  setBottom: open => { bottom.value = open }, showOutput: id => showOutput(id),
})
// 生成 / 重构 / 文件移动是一个域（IDEA 的 Generate 菜单 + Refactor 菜单）。
const {
  copyFilePath, moveActiveFile, copyActiveFile, openGeneratePopup,
  refactorTitles, runRefactorFlow, extractVariable, extractConstant, extractMethod, inlineVariable,
} = createGenerateRefactor({
  notify, isDesktop, workspace, active, editorFor, lspReady, request, parentOf, baseName, refreshTree,
  renameEntryWithReferences, copyCollisionName, codeActions, actionPrompt, applyCodeAction,
})
function parentOf(path: string) { const index = path.lastIndexOf('/'); return index < 0 ? '' : path.slice(0, index) }
function baseName(path: string) { return path.slice(path.lastIndexOf('/') + 1) }
// 文件树的操作是一个域（IDEA 的 ProjectView 右键菜单动作）。
const {
  isSyntheticPath, toggleReadOnly, languageChoices, associateFileType, onTreeContext, findUsagesOf,
  beginCreate, beginRename, beginDelete, copyPath, openInTerminal,
} = createTreeActions({
  notify, isDesktop, menu, treeMenu, treeSubmenu, tabMenu, findTab, editorFor, request, projectSettings, allTabs,
  startLsp, bufferEpoch, languageLabels, openFile, refreshOutline, outline, onSemantic, nameDialog, nameInput,
  deleteTarget, workspace, terminalPanelRef, showOutput, parentOf, baseName,
})
// The menus drive the very functions the keymap binds: `runEditor` asks the active
// CodeEditor instance, `showView` moves the left dock. `null` from the editor means
// the buffer refused (nothing selected, or the panel is already open).
function runEditor(name: string) {
  menu.value = null
  const editor = activePath.value ? editorFor(activePath.value) : undefined
  if (!editor) { notify('请先打开一个文件。', true); return }
  if (!editor.command(name)) notify('该操作在当前选区没有可做的改动。', true)
}
function showView(view: typeof leftView.value) {
  const anchor = toolAnchors[view] ?? 'left'
  if (anchor === 'bottom') {
    // 停靠在底部的工具窗口（IDEA 的任意停靠）：打开底部 dock 并**选中它**。
    // 不能设 leftView —— 那会让左侧栏渲染一个属于底部的视图。
    bottom.value = true
    bottomTab.value = view
  } else {
    explorer.value = true
    leftView.value = view
  }
  recordActiveToolWindow(view)
  menu.value = null
}
// Alt+F8 in the editor opens the debugger tool window and hands the expression over.
// The nonce re-triggers the panel even when the same text is evaluated twice.
const evaluateRequest = ref<{ text: string; nonce: number } | null>(null)
function requestEvaluate(text: string) {
  const anchor = toolAnchors['debug'] ?? 'left'
  if (anchor === 'bottom') bottom.value = true
  else explorer.value = true
  leftView.value = 'debug'
  evaluateRequest.value = { text, nonce: (evaluateRequest.value?.nonce ?? 0) + 1 }
}function showOutput(tab: typeof bottomTab.value) { bottom.value = true; bottomTab.value = tab; recordActiveToolWindow(tab); menu.value = null }

const hasEditor = () => Boolean(active.value)
const editable = (name: string, title: string, keys?: string, keywords?: string): MenuRow => ({
  id: name, title, keys, keywords, enabled: hasEditor, run: () => runEditor(name),
})
const semantic = (name: string, title: string, keys: string, keywords: string): MenuRow => ({
  id: name, title, keys, keywords, enabled: () => Boolean(active.value) && lspReady.value, run: () => runEditor(name),
})
const toolWindow = (view: typeof leftView.value, title: string, keywords: string, needsDesktop = false): MenuRow => ({
  id: `view.${view}`, title, keywords, // 可用性含 toolDisabled（ActivateToolWindowAction.update :130-137，主菜单是灰着）
  enabled: () => Boolean(workspace.value) && (!needsDesktop || isDesktop) && !toolDisabled(view),
  run: () => showView(view),
})
const localHistoryDialogRow = localHistoryMenuRow(localHistoryState)
// 文件菜单：见 src/menus/fileMenu.ts（一组一文件）。
// 文件 › 导入/导出设置（IDEA `ExportImportGroup`）与「恢复默认设置」是一个域：见 src/settingsTransfer.ts。
const { exportSettings, importSettings, restoreDefaultSettings } = createSettingsTransfer({
  isDesktop, notify,
  // 两个刷新函数是惰性的（由别的域提供，装配顺序在后）；文件对话框与确认框由模块自己发。
  refreshAppState: () => refreshAppState(), refreshProjectSettings: () => refreshProjectSettings(),
})
const fileMenuContext: FileMenuContext = {
  working, dirty, active, activePath, allTabs, groups, focusedPane, closedTabsPerPane, recentProjects,
  isDesktop, hasEditor, beginProject: (...a) => beginProject(...a), openWorkspace: (...a) => openWorkspace(...a),
  openManageRecents, closeWorkspace: (...a) => closeWorkspace(...a), saveAll,
  createScratch, closeTab, reopenClosedTab, closeAllTabsIn, closeOtherTabsIn, openEncoding,
  toggleReadOnly, convertLineSeparators, openBinary, openPlugins, openSettings, quitApp,
  forceReloadFromDisk: () => forceReloadFromDisk(), notify, workspace, openProjectStructure,
  // ExportImportGroup 三项 + PowerSaveGroup 一项（省电模式与状态栏那颗芯片是同一个动作）。
  exportSettings: () => void exportSettings(), importSettings: () => void importSettings(),
  restoreDefaultSettings: () => void restoreDefaultSettings(), togglePowerSave: () => void togglePowerSave(),
  exportToHtml: () => openExportDialog(),
  powerSaveMode: { get value() { return editorSettings.value.powerSaveMode } },
}
// 文件 › 导出 › 导出到 HTML（IDEA `ExportToHTMLAction`）：引擎、对话框状态与设置落盘都在 src/htmlExport.ts。
// 「浏览…」选回来的目录：对话框把它回填进输出目录文本框（见 ExportToHtmlDialog 的 pickedDirectory）。
const exportPickedDirectory = ref('')
const { dialogOpen: exportDialogOpen, openExportDialog, closeExportDialog, exportToHtml: runExportToHtml, browseOutputDirectory } =
  createHtmlExport({
    isDesktop, notify, workspace, projectSettings,
    activePath: () => activePath.value,
    // 语法高亮与选区都从**编辑器已渲染的 DOM** 读（见 src/htmlExportDom.ts 的说明）。
    readEditor: () => {
      const handle = active.value ? editorFor(active.value.path) : null
      return handle ? { lines: handle.exportStyledLines(), selection: handle.selectionText() } : null
    },
    theme: () => {
      const style = getComputedStyle(document.documentElement)
      const read = (name: string, fallback: string) => style.getPropertyValue(name).trim() || fallback
      return { background: read('--panel', '#ffffff'), foreground: read('--text', '#000000'),
               fontFamily: read('--font-mono', 'monospace'), fontSize: editorSettings.value.fontSize }
    },
    openExternal: url => { void request('shell.openUrl', { url }) },
    pickDirectory: (title, initial) => request<string | null>('dialog.pickDirectory', { title, initial }),
  })

/** 导入设置后把当前项目的设置重新读一遍（包里可能换了它）；没开项目就是空操作。 */
async function refreshProjectSettings() {
  if (!workspace.value) return
  try { projectSettings.value = await request<ProjectSettings>('project.settings.get') }
  catch { /* 项目可能刚被关掉 */ }
}
const fileMenuRows = createFileMenuRows(fileMenuContext)
// 编辑菜单：见 src/menus/editMenu.ts（一组一文件）。
// 粘贴通道是一个域（IDEA $Paste / EditorPasteSimple / PasteMultiple + REFORMAT_ON_PASTE 后处理）。
const {
  pasteHistoryOpen, pasteHistoryEntries, pasteFromSystemClipboard, pasteAsPlainText, openPasteHistory,
  pickPasteHistoryEntry, removePasteHistoryEntry, onEditorPaste,
} = createPasteActions({ notify, active, editorFor, lspOn, editorSettings, runFormatting })
// 行内 gutter 图标层（IDEA `GutterIconRenderer`：诊断 / 断点 / 书签，可点击）。
const { gutterIcons, onGutterIcon } = createGutterIconHost({ active, editorSettings, diagnostics: lspDiagnostics, revealLocation, toggleBreakpointAt, notify, bookmarks: path => bookmarkLines.value[path] ?? [], breakpointLines: path => (dapBreakpoints.get(path) ?? []).map(point => point.line) })
// 帮助菜单的动作（IDEA HelpMenu 里能落地的那些；其余在 src/menus/helpMenu.ts 里逐条登记为待办）。
const {
  aboutOpen, aboutInfo, specialPathsOpen, specialPaths, collectBusy, showLog, showAbout, browseSpecialPaths,
  openSpecialPath, collectLogs, copyTroubleshooting, showKeymap,
} = createHelpActions({ notify, isDesktop, helpPanel: help, openActionSearch: () => openActionSearch() })
const helpMenuContext: HelpMenuContext = {
  openActionSearch: () => openActionSearch(), showKeymap, showLog, collectLogs, collectBusy, browseSpecialPaths, copyTroubleshooting, showAbout, isDesktop }
const helpMenuRows = createHelpMenuRows(helpMenuContext)
// 宏（录制/回放）：IDEA 的 `ActionMacroManager`。`resolveAction` 惰性读 Find Action 的清单
// （那份清单由 menuUi 装配在更后面，等价于源码的 `ActionManager.getAction(id)`）。
const {
  macros, namedMacros, macrosDialogOpen, openMacrosDialog, recording, playing, lastMacro,
  toggleMacroRecording, playMacro, playLastMacro, deleteMacro, renameMacro, deleteMacroStep,
} = createMacros({ notify, activePath, editorFor, resolveAction: id => actionList.value.find(entry => entry.id === id)?.run })
const macrosMenuContext = { macros, namedMacros, recording, playing, lastMacro, toggleMacroRecording, playLastMacro, playMacro, openMacrosDialog }
const editMenuContext: EditMenuContext = {
  copyReference: copySymbolReference, runEditor, convertIndents, hasEditor, editable, toolWindow,
  pasteFromSystemClipboard, pasteAsPlainText, openPasteHistory, macros: macrosMenuContext }
const editMenuRows = createEditMenuRows(editMenuContext)
// 视图菜单：见 src/menus/viewMenu.ts（一组一文件）。
// IDEA 的 ToggleFullScreen（View → Appearance → ToggleFullScreenGroup）：宿主把窗口切成
// "去装饰 + 铺满整个显示器"，退出时恢复原样式与位置（见 native/window_state.hpp）。
// 切换流程与沉浸协调同域，所以实现也在 `src/distractionFreeSession.ts` 的 `createImmersiveMode`。
async function toggleFullScreen() {
  if (!isDesktop) { notify('全屏需要桌面端窗口。'); return }
  await immersive.toggleFullScreen()
}
const viewMenuContext: ViewMenuContext = {
  distractionFreeMode, toggleDistractionFreeMode,
  fullScreen, toggleFullScreen, active, activity, bottom, changeTheme,
  // 惰性：`chooseBackgroundImage` 由下面的界面动作模块提供（解构在更后面）。
  chooseBackgroundImage: () => void chooseBackgroundImage(), editorSettings, explorer, fileTreeRef, saveSettingsPatch, showOutput, splitOrientation, splitTabOut, theme, togglePowerSave, toggleZenMode, unsplit, unsplitAll, workspace, zenMode, hasEditor, editable, toolWindow, localHistoryDialog: localHistoryDialogRow, changeSplitOrientation, isDesktop, activateToolWindow, toolDisabled }
const viewMenuRows = createViewMenuRows(viewMenuContext)
// 导航菜单：见 src/menus/navigateMenu.ts（一组一文件）。
const navigateMenuContext: NavigateContext = { active, cycleBookmark, goBack, goForward, hasEditor, jumpLastEditLocation, jumpMethod, lspReady, navBack, navForward, openActionSearch: () => openActionSearch(), openSearchEverywhere: () => openSearchEverywhere(), openGoLine, openMnemonicPrompt, openPalette, openRecentFiles, openRecentPlaces, openSymbol, runEditor, openSelectIn, showNavBar, showView, toggleBookmark, workspace }
const navigateMenuRows = createNavigateMenuRows(navigateMenuContext)
// 代码菜单：见 src/menus/codeMenu.ts（一组一文件）。
const codeMenuContext: CodeMenuContext = { hasEditor, active, lspReady, isDesktop, editable, semantic, openTemplateChooser, openSurround, openGeneratePopup, showQuickDoc, copyReference, runOrganizeImports, showBlame, blameEnabled: () => blameEnabled.value, compareWithClipboard, copyFilePath, workspace, caretPayload, openCodeActions, runWorkspaceInspection: runWorkspaceInspectionAction }
const codeMenuRows = createCodeMenuRows(codeMenuContext)
// 右键菜单的「分析」子菜单复用同一批行（上游 `AnalyzeMenu` = InspectCodeGroup + AnalyzeActions，
// 只挂在 ProjectViewPopupMenu / NavbarPopupMenu / EditorPopupMenu1 上）。
const analyzeMenuRows = createAnalyzeMenuRows(codeMenuContext)
// 重构菜单：见 src/menus/refactorMenu.ts（一组一文件）。
const refactorMenuContext: RefactorMenuContext = { active, lspReady, isDesktop, caretPayload, openCodeActions, extractVariable, extractConstant, extractMethod, inlineVariable, moveActiveFile, copyActiveFile, semantic }
const refactorMenuRows = createRefactorMenuRows(refactorMenuContext)
// 整工程检查（IDEA 的 Analyze → Inspect Code）：跨次保留每文件的 resultId，
// 这样服务器可以对没变的文件回 `unchanged`（见 src/workspaceInspection.ts）。
const workspaceDiagnosticIds = new Map<string, string>()
// 只做组装：跑一次检查、把结论报给用户。合并规则全在 workspaceInspection/workspaceDiagnostics 里。
async function runWorkspaceInspectionAction() {
  if (!isDesktop) { notify('整工程检查需要桌面端（语言服务）。'); return }
  try {
    const outcome = await runWorkspaceInspection({
      // 整工程检查不绑文件，path 传空串 —— 原生侧会挑一个在跑的服务器（见 WorkspaceInspectionDeps）。
      query: previousResultIds => request<WorkspaceDiagnosticsResult>('lsp.request',
        { kind: 'workspaceDiagnostic', path: '', line: 0, character: 0, previousResultIds }),
      diagnostics: lspDiagnostics,
      resultIds: workspaceDiagnosticIds,
    })
    notify(outcome.message, !outcome.ok)
  } catch (error) { notify(errorMessage(error), true) }
}
// IDEA 的 Copy Reference（Ctrl+Alt+Shift+C）：把当前位置的符号引用复制到剪贴板。
// 引用串由 LSP `textDocument/moniker` 提供（见 src/moniker.ts 的模块注释）——
// 剪贴板状态用户看不见，所以按"提示规范"这里**必须**给反馈。
async function copySymbolReference() {
  const tab = active.value
  if (!tab || !isDesktop) { notify('复制引用需要打开一个文件并使用语言服务。'); return }
  try {
    const result = await request<MonikerResult>('lsp.request', {
      kind: 'moniker', path: tab.path, line: Math.max(0, tab.line - 1), character: Math.max(0, tab.column - 1),
    })
    const moniker = primaryMoniker(result.available ? result.monikers : [])
    if (!moniker) { notify('当前位置没有可用的符号引用。'); return }
    await copyToClipboard(referenceText(moniker))
    notify(describeCopiedReference(moniker))
  } catch (error) { notify(errorMessage(error), true) }
}
// 构建菜单：见 src/menus/buildMenu.ts（一组一文件）。
const buildMenuContext: BuildMenuContext = { isDesktop, workspace, runState, startBuild: (...a) => startBuild(...a), stopRun: (...a) => stopRun(...a), showOutput }
const buildMenuRows = createBuildMenuRows(buildMenuContext)
// 运行菜单：见 src/menus/runMenu.ts（一组一文件）。
const runMenuContext: RunMenuContext = { active, dapState, explorer, leftView, runState, workspace, isDesktop, get lastRunParams() { return lastRunParams }, notify, runSelectedConfig: (...a) => runSelectedConfig(...a), runContextConfiguration: (...a) => runContextConfiguration(...a), openConfigChooser, rerunLast, stopRun: (...a) => stopRun(...a), showOutput, toolWindow, editable, openRunConfigurations, runToCursor }
const runMenuRows = createRunMenuRows(runMenuContext)
// Git 菜单：见 src/menus/gitMenu.ts（一组一文件）。
const gitMenuContext: GitMenuContext = { active, activePath, gitAvailable, working, workspace, isDesktop, beginProject: (...a) => beginProject(...a), gitMenuAction, openSettings, openBranchPopup, openSubmodules, openWorktrees, pushWithConfirm, resetHeadDialog, showBlame, blameEnabled: () => blameEnabled.value, showFileHistory, showView, updateProject, toolWindow, localHistoryDialog: localHistoryDialogRow }
const gitMenuRows = createGitMenuRows(gitMenuContext)
const menus: { menu: NonNullable<typeof menu.value>; label: string; rows: MenuRow[] }[] = [
  { menu: 'file' as const, label: '文件', rows: fileMenuRows },
  { menu: 'edit' as const, label: '编辑', rows: editMenuRows },
  { menu: 'view' as const, label: '视图', rows: viewMenuRows },
  { menu: 'navigate' as const, label: '导航', rows: navigateMenuRows },
  { menu: 'code' as const, label: '代码', rows: codeMenuRows },
  { menu: 'refactor' as const, label: '重构', rows: refactorMenuRows },
  // IDEA's Build menu (JavaActions.xml "Java.BuildMenu"): Build Project (CompileDirty,
  // Ctrl+F9), Rebuild (Compile, Ctrl+Shift+F9 — bound here to a full clean rebuild),
  // plus Stop Build. TaoCode builds through the configured shell command.
  { menu: 'build' as const, label: '构建', rows: buildMenuRows },
  { menu: 'run' as const, label: '运行', rows: runMenuRows },
  // IDEA's Git.MainMenu order (intellij.vcs.git.backend.xml): Commit, Push, Update
  // Project, Pull, Fetch | Merge, Rebase, Resolve Conflicts | Branches, New Branch,
  // Tag, Reset | Show Log | Stash/Shelf. Rows without a git4idea-equivalent backend
  // here (Fetch, Rebase, Tag dialog, Reset) are omitted rather than faked.
  { menu: 'git' as const, label: 'Git', rows: gitMenuRows },
  // IDEA 主菜单以「帮助」收尾（PlatformActions.xml:746 的 HelpMenu）。menuUi 会把「窗口」插到
  // Git 与帮助之间，得到 Git → Window → Help 的源码顺序。
  { menu: 'help' as const, label: '帮助', rows: helpMenuRows },
]
// IDEA 的 Window › LayoutsGroup 是一个**子菜单**（`<group id="LayoutsGroup" popup="true">`，
// PlatformActions.xml:641）：出厂默认 · 命名布局列表（每项是 toggle，点即应用）· 分隔 ·
// RestoreDefaultLayout(Shift+F12) · StoreDefaultLayout · StoreNewLayout。
// TaoCode 的菜单模型现在带 children，所以这一组保持为一个嵌套菜单，不再被拍平进「窗口」里。
// CustomLayoutActionGroup 每个布局名下的 Apply/Restore/Save/Rename/Delete 子菜单仍收敛为
// 「当前布局的重命名/删除」加两条全局 Store —— 这是一张菜单能表达的部分中不发明第二种点击含义的做法。
// 工具窗口的命名布局是一个域（IDEA 的 ToolWindowDefaultLayoutManager + LayoutsGroup 动作）。
const {
  LAYOUT_STORAGE_KEY, DEFAULT_TOOL_ORDER, BOTTOM_TABS, factoryToolLayout, toolLayoutStore, loadToolLayoutStore,
  persistToolLayouts, captureToolLayout, applyToolLayout, applyNamedToolLayout, useFactoryToolLayout,
  restoreCurrentToolLayout, storeCurrentToolLayout, openLayoutNameDialog, deleteCurrentToolLayout,
} = createToolLayouts({
  notify, menu, nameDialog, nameInput, explorer, bottom, leftView, bottomTab, panelSizes, toolAnchors, toolOrder,
  saveToolAnchors, saveToolOrder, setPanelSize, isLeftToolWindowId,
})
const layoutMenuRows = computed<MenuRow[]>(() => {
  const store = toolLayoutStore.value
  const children: MenuRow[] = [
    { id: 'window.factoryLayout', title: '默认布局', keywords: 'default tool window layout factory reset 默认布局 出厂', checked: () => isFactoryLayoutActive(store), run: useFactoryToolLayout },
    { id: 'window.ruleLayoutsList', rule: true },
  ]
  for (const name of layoutNames(store))
    children.push({ id: `window.layout.${name}`, title: name, keywords: `tool window layout ${name} 布局`, checked: () => store.active === name, run: () => applyNamedToolLayout(name) })
  children.push({ id: 'window.ruleLayoutsActions', rule: true })
  children.push({ id: 'window.restoreLayout', title: '恢复当前布局', keys: 'Shift F12', keywords: 'restore current layout reset 恢复布局 重置', run: restoreCurrentToolLayout })
  children.push({ id: 'window.storeLayout', title: '将更改保存到当前布局', keywords: 'save changes in current layout 保存布局', run: storeCurrentToolLayout })
  children.push({ id: 'window.storeLayoutAs', title: '将当前布局另存为新布局…', keywords: 'save current layout as new 另存为 新建布局', run: () => openLayoutNameDialog('newLayout') })
  // Rename/Delete only exist for a stored layout: the factory default is not an entry in the map,
  // which is also why `DeleteNamedLayoutAction` disables itself on the active layout.
  if (!isFactoryLayoutActive(store)) {
    children.push({ id: 'window.renameLayout', title: '重命名当前布局…', keywords: 'rename layout 重命名布局', run: () => openLayoutNameDialog('renameLayout') })
    children.push({ id: 'window.deleteLayout', title: '删除当前布局', keywords: 'delete layout remove 删除布局', run: deleteCurrentToolLayout })
  }
  return [{ id: 'window.layouts', title: '布局', keywords: 'layouts tool window layout 布局', children }]
})
// 「窗口」菜单：见 src/menus/windowMenu.ts（一组一文件；它是最后一个从宿主搬走的菜单域）。
const windowMenuRows = createWindowMenuRows({
  toolWindow, active, activeToolWindows, toolWindowAvailable, lastActiveId, jumpToLastToolWindow,
  hideActiveToolWindow, hideSideToolWindows, hideBottomToolWindows, focusedDock, currentChrome,
  savedChrome, hideAllToolWindowsTitle, canHideAllToolWindows, toggleMaximizeEditor, maximizedSide,
  canMaximize, maximizeActiveToolWindow, MAXIMIZE_SHORTCUT_LABEL, resizeTargetFor, stretchToolWindow,
  tabTargetCount, selectNextTab, selectPreviousTab, closeActiveTab, closeOtherTabsTarget, closeOtherToolTabs,
  closeAllTabsTarget, closeAllToolTabs, contentUiType, toggleContentUiType, isTabbedContentUi, canToggleContentUiType,
  activeContentCount, toggledContentUiType, progressOpen, noticeLog, closeFirstNotification, clearNotices,
  workspace, explorer, bottom, groups, allProblems, showOutput, openSettings,
  canPinToolwindowTab, pinTabTitle, togglePinToolwindowTab,
})
// IDEA's Tools menu (intellij.platform.ide.impl.actions.xml "ToolsMenu"): the platform
// rows are launcher-script creation plus OtherMenu (Terminal, task tools). Only rows
// backed by a real TaoCode feature appear — no fake plugin services.
// IDEA's menu order: File Edit View Navigate Code Refactor Analyze Build Run Tools Git Window Help.
// 工具菜单：见 src/menus/toolsMenu.ts（一组一文件）。
const toolsMenuRows = createToolsMenuRows({ isDesktop, hasWorkspace: () => Boolean(workspace.value), showOutput, showView,
  externalTools: () => generalSettings.value.externalTools ?? [],
  runExternalTool: (command, name) => { void runExternalTool(command, name) } })
// 主菜单栏的模型与交互是一个域：菜单组的组装与排序（`allMenuGroups`）、子菜单浮层、行点击分发
// （`pickMenuRow`）、主菜单里的「查找操作」（Find Action）、标题栏的项目部件 —— 共享 `menu` 开关与行构造。
const {
  allMenuGroups, rowTitle, rowEnabled, submenuRows, hasSubmenu, submenuRow, submenuPlacement, submenuStyle,
  openSubmenu, closeSubmenu, scheduleSubmenuClose, cancelSubmenuClose, pickMenuRow,
  projectWidgetOpen, projectWidgetQuery, projectWidgetGroups, toggleProjectWidget, pickProjectFromWidget,
  branchOfProject, openRecentProject, actionSearch, actionQuery, actionIndex, actionInput, actionList, actionResults,
  openActionSearch, moveAction, runAction, runActionResult, flattenMenuRows, editorPopup, editorPopupRows, openEditorPopup, closeEditorPopup, pickEditorPopup, toolWindowGearRows, bottomGearRows,
} = createMenuUi({
  notify, isDesktop, editorSettings, menu, workspace, menus, windowMenuRows, layoutMenuRows, toolsMenuRows, pluginList,
  digits, bookmarks, jumpMnemonic, focusStatusBar, recentProjects, working, bottomGearHostRows: () => usageViewGearRows(bottomTab.value),
  openWorkspace: (...a) => openWorkspace(...a), // 惰性：工作区生命周期模块装配在本块之后。
  // 只挂在弹出组上的动作：`Gradle.ImportExternalProject` 进项目树右键与 EditorPopupMenu，不进主菜单
  // （可见性判据与上游 `isVisible` 同一条：文件名 ∈ KNOWN_GRADLE_FILES 且该目录还没有链接设置）。
  popupExtras: () => canLinkGradleProject(activePath.value ?? '', gradleLinkedProjects.value) ? [{ id: 'gradle.link', title: '链接 Gradle 项目', keywords: 'link gradle project 链接 工程', enabled: () => Boolean(activePath.value), run: () => void linkGradleProject(activePath.value ?? '') }] : [],
  // 齿轮里那两条不在菜单索引的行（上游也只在齿轮里现造）：速度搜索 + 从侧栏移除。
  gearHostRows: () => gearHostRowMap(leftView.value, Boolean(workspace.value), fileTreeRef.value, hiddenStripeButtons.has(leftView.value), () => removeStripeButton(leftView.value)) })

// ---- Search Everywhere（IDEA 263 新分屏实现）----
// 改造前「随处搜索 Shift+Shift」打开的其实是**查找操作**面板（`openActionSearch`）——
// 菜单行与键位都在，但没有 Search Everywhere 本身，属于项目硬规则禁掉的放假控件。
// 装配在 src/searchEverywhereHost.ts（App.vue 是组装层，行数上限只降不升）。
const {
  searchEverywhereOpen, searchEverywhereItems, openSearchEverywhere, onSearchEverywhereQuery,
} = createSearchEverywhereHost({
  isDesktop, menu, workspace, activePath, lspReady, openFile, jumpSymbol, actionList, runAction,
  allRunConfigNames, selectRunConfig, runSelectedConfig: debug => runSelectedConfig(debug), baseName, readPreviewBuffer: path => findTab(path) ? (editorFor(path)?.text() ?? findTab(path)?.content) : undefined,
})

// 文件颜色（IDEA `com.intellij.ui.tabs` 的 File Colors / `EditorTabColorProviderImpl`）：
// 按作用域给标签页上色。算颜色的纯逻辑在 src/fileColors.ts，落点在 src/fileColorsHost.ts。
const { tabFileColor, tabFileColorScope, projectViewFileColor } = createFileColorHost({ editorSettings, projectSettings, workspace })

function closeAffectedTabs(path: string, isDir: boolean) {
  for (const pane of [0, 1] as const) {
    const group = groups[pane]
    for (const tab of [...group.tabs]) if (tab.path === path || (isDir && tab.path.startsWith(path + '/'))) { group.tabs.splice(group.tabs.indexOf(tab), 1); forgetEditorRefs(tab.path) }
    if (!group.tabs.some(tab => tab.path === group.activePath)) group.activePath = group.tabs[0]?.path ?? ''
  }
  // A file removed from disk closes in every pane; the LSP document goes once.
  if (!hasTabPath(path)) stopLspFile(path)
}
async function retitleTab(from: string, to: string) {
  for (const pane of [0, 1] as const) {
    const group = groups[pane]
    const tab = group.tabs.find(item => item.path === from)
    if (tab) { group.tabs.splice(group.tabs.indexOf(tab), 1); forgetEditorRefs(from) }
    if (group.activePath === from) group.activePath = group.tabs[0]?.path ?? ''
  }
  stopLspFile(from)
  await openFile(to)
}
async function applyNameDialog() {
  const dialog = nameDialog.value; if (!dialog) return
  const name = dialog.value.trim(); if (!name) return
  nameDialog.value = null
  try {
    if (dialog.mode === 'newLayout' || dialog.mode === 'renameLayout') {
      // `LayoutNameInputDialog.kt:84-118`: a taken or too long name keeps the field open with its
      // error, so a duplicate can neither be created nor renamed onto.
      const error = layoutNameError(name, layoutNames(toolLayoutStore.value))
      if (error) { nameDialog.value = dialog; notify(error, true); return }
      toolLayoutStore.value = dialog.mode === 'newLayout'
        ? saveLayout(toolLayoutStore.value, name, captureToolLayout())
        : renameLayout(toolLayoutStore.value, toolLayoutStore.value.active, name)
      persistToolLayouts()
      notify(dialog.mode === 'newLayout' ? `已保存布局「${name}」。` : `布局已重命名为「${name}」。`)
      return
    }
    if (dialog.mode === 'rename' && dialog.entry) {
      const target = dialog.dir ? `${dialog.dir}/${name}` : name
      if (target === dialog.entry.path) return
      // The file moves on disk while the tab still holds unsaved text: without this
      // gate the rename silently dropped the buffer's edits. Save/discard/cancel first.
      const affected = dialog.entry.kind === 'directory'
        ? allTabs.value.filter(tab => tab.dirty && (tab.path === dialog.entry!.path || tab.path.startsWith(`${dialog.entry!.path}/`)))
        : allTabs.value.filter(tab => tab.dirty && tab.path === dialog.entry!.path)
      if (affected.length && !await confirmLeave('重命名前处理未保存的修改', affected)) return
      await renameEntryWithReferences(dialog.entry.path, target)
      await refreshTree()
      notify(`已重命名 ${baseName(dialog.entry.path)} → ${name}`)
    } else {
      const target = dialog.dir ? `${dialog.dir}/${name}` : name
      await request('file.create', { path: target, directory: dialog.mode === 'createDir', template: dialog.template || undefined })
      await refreshTree()
      if (dialog.mode === 'createFile') await openFile(target)
      notify(dialog.mode === 'createDir' ? `已创建文件夹 ${name}` : `已创建文件 ${name}`)
    }
  } catch (error) { notify(errorMessage(error), true) }
}
async function confirmDelete() {
  const entry = deleteTarget.value; if (!entry) return
  deleteTarget.value = null
  const trash = deleteToBin.value
  // Same rule as rename: deleting a file with an unsaved buffer must not throw the
  // user's edits away without asking.
  const affected = entry.kind === 'directory'
    ? allTabs.value.filter(tab => tab.dirty && (tab.path === entry.path || tab.path.startsWith(`${entry.path}/`)))
    : allTabs.value.filter(tab => tab.dirty && tab.path === entry.path)
  if (affected.length && !await confirmLeave('删除前处理未保存的修改', affected)) return
  try {
    await request('file.delete', { path: entry.path, trash })
    closeAffectedTabs(entry.path, entry.kind === 'directory')
    await refreshTree()
    notify(trash ? `已把 ${baseName(entry.path)} 移到回收站` : `已删除 ${baseName(entry.path)}`)
  } catch (error) { notify(errorMessage(error), true) }
}
function openPalette() { query.value = ''; palette.value = true; menu.value = null }
// 控制台标签页里的构建动作是同一个域的另一半（含内联终端）。见 src/runActions.ts。
const {
  runStartParams, runToExit, startRun, runSelectedConfig, envArrayToObject, debugKindFor,
  runContextConfiguration, startBuild, runExternalTool, stopRun, debugButtonTitle, stopAnyProcess,
  sendRunInput,
} = createRunActions({
  notify, isDesktop, workspace, active, runCommand, runConfigProgram, runConfigName, runConfigs, projectSettings,
  currentRunConfig, showOutput, explorer, leftView, runInput,
  // 惰性：`saveAll` 是骨架里的函数（本块之后），必须延后调用。
  saveAll: () => saveAll(),
  // 宿主是 `let`，用 getter/setter 共享同一份；`gradleDetection` 同理（Gradle 宿主在本块之后装配）。
  lastRunParams: { get value() { return lastRunParams }, set value(v) { lastRunParams = v } }, saveJavaSettings, gradleDetection: { get value() { return gradleDetection.value } },
})
// 全局快捷键分派是一个域（IDEA 的 Keymap/KeymapImpl + $default.xml 的绑定表）。
const { onKey } = createKeymap({
  workspace, active, activePath, lspReady, lastRunParams: { get value() { return lastRunParams } }, runConfigs,
  explorer, leftView, actionPrompt, actionSearch, changePlaces, configChooser, configIndex, conflictPrompt,
  encodingPrompt, filenamePopup, gitAvailable, goLinePrompt, help, leavePrompt, menu, mnemonicPrompt, palette, places,
  placesEditedOnly, placesFiltered, placesIndex, placesPrompt, projectMode, projectWidgetOpen, quickDoc, recentPrompt,
  renamePrompt, settingsDialogRef, settingsOpen, signaturePopup, surroundPrompt, symbolPrompt, templateChooser, zenMode,
  answerLeave: (...a) => answerLeave(...a), applyConfigChoice, caretPayload, closeActiveTab, closeSignaturePopup, copyActiveFile, copyReference,
  createScratch, exitHideChrome, extractConstant, extractMethod, extractVariable, gitMenuAction, goBack, goForward,
  hideActiveToolWindow, inlineVariable, jumpLastEditLocation, jumpMnemonic, jumpToLastToolWindow, maximizeActiveToolWindow,
  moveActiveFile, moveConfig, movePlace, openActionSearch, openCodeActions, openConfigChooser, openGeneratePopup, openSearchEverywhere,
  openGoLine, openMnemonicPrompt, openPalette, openPlace, openProjectStructure, openRecentFiles, openRecentPlaces,
  openSettings, openSymbol, openWorkspace: (...a) => openWorkspace(...a), pickMnemonic, rerunLast, resolveConflictKeep, restoreCurrentToolLayout,
  openPasteHistory: (...a) => openPasteHistory(...a), pasteAsPlainText: (...a) => pasteAsPlainText(...a),
  copyPaths: () => copyFilePath(),
  runContextConfiguration, runSelectedConfig, runToCursor, save, saveAll, openSelectIn, showNavBar, selectNextTab, selectPreviousTab,
  showBlame, showOutput, showQuickDoc, showView, startBuild, stopRun, stretchToolWindow, toggleBookmark,
  toggleBreakpointAt, toggleMaximizeEditor, updateProject,
  // 惰性：这三个由本块之后装配的模块提供（磁盘同步模块、外观动作模块）。
  noteActivity: () => noteActivity(),
  forceReloadFromDisk: (...a) => forceReloadFromDisk(...a),
  focusToolWindowByNumber: (...a) => focusToolWindowByNumber(...a),
})
// IDEA's exit confirmation. ApplicationImpl.canExit (:1073, reached from :840) aborts the
// exit when the DoNotAskOption (:998-1018) says so, and that option is shown only when
// 退出确认与进程关闭确认：逻辑拆到 src/confirmations/（对应 ConfirmExitDialog 与
// TerminateRemoteProcessDialog 的带状态流程；纯决策在 src/processClose.ts），
// App 只保留模板绑定所需的同名变量。
const { exitPrompt, exitPromptDontAsk, shouldConfirmExit, confirmExit, resolveExit } = createExitConfirmation({
  generalSettings,
  hasOpenProject: () => Boolean(workspace.value),
  notify,
})
const { terminalClosePrompt, terminalCloseDontAsk, requestTerminalClose, resolveTerminalClose } = createProcessCloseConfirmation({
  generalSettings,
  notify,
})
async function quitApp() {
  if (!(await confirmExit())) return
  await request('app.quit').catch(() => undefined)
}
function onUnload(event: BeforeUnloadEvent) {
  // The window's own close has no room for IDEA's dialog, and the browser only offers its
  // standard prompt — so both reasons to hold the window back are folded into this guard:
  // unsaved buffers, and the exit confirmation of :1002-1004.
  if (dirty.value || shouldConfirmExit()) { event.preventDefault(); event.returnValue = '' }
}
// IDEA's "synchronize files on frame activation". Clean buffers follow the disk; a
// buffer with unsaved edits is never touched (its save still fails with CONFLICT),
// and large files are skipped so focusing the window stays instant.
//
// The switch is GeneralSettings.isSyncOnFrameActivation (ide.general.xml), which IDEA reads
// in two places: SaveAndSyncHandlerImpl.kt:221,326 gates the VFS refresh, and
// EditorWindow.kt:211 re-reads the file when its tab is activated. TaoCode has one path for
// both, so this is its single consumer. (The editor-page `syncOnFocus` key was a second name
// for the same option and has been removed.)
const syncLimit = 4 * 1024 * 1024
let syncing = false
// Gradle（IDEA Gradle 插件的「自动配置 / 同步 / 工具窗口」）是一个域，状态在 src/gradleHost.ts。
// 它必须在磁盘同步之前组装：文件监听那一侧要把"这一批变了哪些文件"交给它按 build.tools 的三档判定。
const gradleHost = createGradleHost({
  isDesktop, workspace, projectSettings, notify, notifyProgress,
  // 双击任务 = IDEA 的 `GradleRunConfiguration`；复用外部工具那条运行通道（run.start + 输出面板）。
  runInConsole: (command, label) => runExternalTool(command, label),
  isOpenInEditor: path => Boolean(findTab(path)),
  openSettings,
  // `ExternalSystem.OpenConfig`（打开构建脚本）与 `CreateRunConfiguration`（任务 → 运行配置）。
  openFile: path => openFile(path, false),
  addRunConfiguration: (name, command) => { void persistRunConfigs([...runConfigs.value, { name, command }], `已把 Gradle 任务保存为运行配置「${name}」`) },
  // 链接列表要落盘（IDEA 写的是 .idea/gradle.xml 里的 linkedProjectsSettings）。
  saveGradleSettings: async patch => { await saveBuildTools({ gradle: patch }) },
})
// 外壳只直接用这几项：可用性（工具窗口的禁用判据）、检测结果（设置页显示）、两条"外部事件"入口，
// 以及项目树右键「链接 Gradle 项目」那一条（`ImportProjectFromScriptAction`：判据 + 动作）。
// 其余动作都由 gradleViewContext 转给工具窗口，不在这里抄一份。
const { available: gradleAvailable, detection: gradleDetection, onBuildFilesChanged, onVcsUpdated, linkProject: linkGradleProject, linkedProjects: gradleLinkedProjects } = gradleHost
// 磁盘同步与后台刷新是一个域（计时器与版本号都在模块里自持）。
const {
  dispose: disposeDiskSync,
  performDiskSync, syncFromDisk, syncTabOnActivation, forceReloadFromDisk, noteActivity, backgroundRefreshOnce, startBackgroundRefresh, stopBackgroundRefresh, onWindowFocus, onVisibility, onFsChanges, trapFocus,
} = createDiskSync({
  notify, showOutput: id => showOutput(id), isDesktop, editorFor, findTab, refreshTree, menu, activity, theme, generalSettings, workspace, allTabs,
  treeVersion, dirty, syncing: () => syncing, setSyncing: value => { syncing = value }, syncLimit, terminalPanelRef,
  onBuildFilesChanged: paths => void onBuildFilesChanged(paths),
})
// 背景图与侧栏排布是一个域。
const {
  focusToolWindowByNumber,
  hamburgerOpen, stripHoverTitles, menuVisibleCount, menuButtonVisible,
  backgroundImage, applyBackground, chooseBackgroundImage, clearBackgroundImage,
  leftSideBySide, rightSideBySide,
} = createAppearanceActions({ notify, isDesktop, generalSettings, zenMode, panelSizes, setPanelSize, saveSettingsPatch,
  editorSettings, settingsBusy, settingsError, applyShowNamesWidths,
  lastRunParams: { get value() { return lastRunParams }, set value(v) { lastRunParams = v } } as any,
  toolDisabled, showView, gitHead, dirty, help, helpClose, leavePrompt, leaveCancel,
  menu, menus, palette, paletteIndex, query, queryInput, runLog, save, testRunnerRef,
  theme, workspace, explorer, saveGeneralSettings })
async function rerunLast() {
  if (!lastRunParams) { notify('还没有可重新运行的任务。', true); return }
  if (runState.running) { notify('已有任务在运行，请先停止。', true); return }
  beginRun(); showOutput('run')
  try { await request('run.start', { ...lastRunParams }) }
  catch (error) { endRun(); notify(`无法重新运行：${errorMessage(error)}`, true) }
}
async function startRunWith(command: string) {
  if (!command.trim() || runState.running) return
  beginRun(); showOutput('run')
  try { await request('run.start', { command, shell: true }) }
  catch (error) { endRun(); notify(`无法启动：${errorMessage(error)}`, true) }
}
// Build-output navigation: the parsers live in src/buildOutput.ts (unit-tested
// against MSVC, GCC/Clang/Rust, javac and CMake shapes); this only adapts them to
// the live console and the workspace root.
// 运行输出里的问题定位是一个域（IDEA BuildView 的"带问题的行" + 跳到问题）。
const {
  runLines, runIssueList, runIssueCount, jumpToIssue, nextRunIssue,
} = createRunIssues({ runOutput, workspace, generalSettings, notify, revealLocation: (...a) => revealLocation(...a) })
// IDEA raises a balloon when the build/run tool window is not focused: green on exit
// 0, red with "view detail" jumping to the console otherwise.
let lastRunExit: number | null | undefined
watch(() => runState.exit, value => {
  if (value === null || value === undefined || value === lastRunExit) return
  lastRunExit = value
  if (bottom.value && bottomTab.value === 'run') return
  notify(value === 0 ? '构建/运行完成（退出码 0）。' : `构建/运行失败（退出码 ${value}）。`, value !== 0, () => { showOutput('run'); notice.value = '' })
})
// 工作区/项目的生命周期是一个域（IDEA 的 ProjectManager + RecentProjectsManager）。
const {
  refreshAppState, refreshRecent, bootstrap, confirmLeave, answerLeave, activateWorkspace,
  syntheticNodes, refreshSyntheticNodes, openWorkspace, closeWorkspace, forgetProject, forgetProjects,
  defaultProjectParent, beginProject, browseParent, submitProject, cancelProject,
} = createWorkspaceLifecycle({
  notify, isDesktop, recentProjects, editorSettings, generalSettings, gitAvailable, defaultParent, appError,
  loading, pluginList, busy, working, leavePrompt, allTabs, save, resetLsp, resetHierarchy, workspace,
  closeAllPanes, navBack, navForward, treeVersion, places, projectSettings, bookmarks, runConfigName,
  selectRunConfig, useProjectSettings, offerSessionRestore, menu, palette, notice, binaryView,
  projectError, projectForm, projectMode, projectBusy, cancelling, openFile,
  // 宿主是 `let`（别处也自增它），用 getter/setter 共享同一份。
  workspaceEpoch: { get value() { return workspaceEpoch }, set value(v) { workspaceEpoch = v } },
})

onMounted(() => {
  // Capture phase: CodeMirror's keymap binds Ctrl+Shift+Backspace per buffer, but
  // IDEA's JumpToLastChange is project-wide, so the window handler wins first.
  window.addEventListener('keydown', onKey, true)
  window.addEventListener('beforeunload', onUnload)
  window.addEventListener('resize', onWindowResize)
  window.addEventListener('focus', onWindowFocus)
  window.addEventListener('blur', onWindowBlur)
  // IdleTracker's input signals: a click or a scroll is activity just like a keypress.
  window.addEventListener('pointerdown', noteActivity, true)
  window.addEventListener('wheel', noteActivity, { capture: true, passive: true })
  startBackgroundRefresh()
  document.addEventListener('visibilitychange', onVisibility)
  void bootstrap()
})
onBeforeUnmount(() => {
  answerLeave('cancel')
  resetLsp(true)
  cancelResize()
  window.removeEventListener('keydown', onKey, true)
  window.removeEventListener('beforeunload', onUnload)
  window.removeEventListener('resize', onWindowResize)
  window.removeEventListener('focus', onWindowFocus)
  window.removeEventListener('blur', onWindowBlur)
  window.removeEventListener('pointerdown', noteActivity, true)
  window.removeEventListener('wheel', noteActivity, { capture: true } as EventListenerOptions)
  stopBackgroundRefresh()
  document.removeEventListener('visibilitychange', onVisibility)
  clearAutoSave()
  if (bookmarkSave) window.clearTimeout(bookmarkSave)
  cancelSessionSave()
  cancelMarkdownRefresh()
  disposeDiskSync()
  stopGitWidgetPolling()
})
  // 主工具栏的 ctx —— 照 IDEA `MainToolbarNewUI` 的三段组织（左：项目/分支/运行 widget；中：文件名；右：搜索/设置）。
  // getter 一律用 `unref`：这样 ref 与普通值都能直接共享，不用逐个记哪个是 ref（写错就是"界面不刷新"那种隐蔽 bug）。
  const mainToolbarCtx = {
    get workspace() { return unref(workspace) }, get projectWidgetOpen() { return unref(projectWidgetOpen) }, get projectWidgetQuery() { return unref(projectWidgetQuery) }, get projectWidgetGroups() { return unref(projectWidgetGroups) }, toggleProjectWidget, closeProjectWidget: () => { projectWidgetOpen.value = false }, setProjectWidgetQuery: (value: string) => { projectWidgetQuery.value = value }, pickProjectFromWidget, branchOfProject, get gitHead() { return unref(gitHead) }, get gitAheadBehind() { return unref(gitAheadBehind) }, get branchPopupOpen() { return unref(branchPopupOpen) }, get gitBranches() { return unref(gitBranches) }, openBranchPopup, closeBranchPopup: () => { branchPopupOpen.value = false }, onBranchAction, get filenameShown() { return unref(filenameShown) }, get filenameLabel() { return unref(filenameLabel) }, get filenameStatusKind() { return unref(filenameStatusKind) }, get filenameTooltip() { return unref(filenameTooltip) }, get filenamePopup() { return unref(filenamePopup) }, toggleFilenamePopup, onFilenameMouseUp, get filenameRecentRows() { return unref(filenameRecentRows) }, pickRecentFile, recentFileKind, get runConfigName() { return unref(runConfigName) }, get configChooser() { return unref(configChooser) }, openConfigChooser, isDesktop, get runState() { return unref(runState) }, get runWidgetTitle() { return unref(runWidgetTitle) }, startBuild, stopRun, runSelectedConfig, get debugButtonTitle() { return unref(debugButtonTitle) }, get dapState() { return unref(dapState) }, stopAnyProcess, get working() { return unref(working) }, openSearchEverywhere, openSettings,
  } as unknown as MainToolbarContext
</script>

<template>
  <!-- Colour-vision filters (IDEA AppearanceConfigurable 'Adjust colors for colour
       vision deficiency'): real colour matrices applied through a root CSS filter. -->
  <svg class="color-blind-defs" aria-hidden="true" focusable="false" width="0" height="0">
    <defs>
      <filter id="cb-deuteranopia"><feColorMatrix type="matrix" values="0.625 0.375 0 0 0  0.7 0.3 0 0 0  0 0.3 0.7 0 0  0 0 0 1 0" /></filter>
      <filter id="cb-protanopia"><feColorMatrix type="matrix" values="0.567 0.433 0 0 0  0.558 0.442 0 0 0  0 0.242 0.758 0 0  0 0 0 1 0" /></filter>
      <filter id="cb-tritanopia"><feColorMatrix type="matrix" values="0.95 0.05 0 0 0  0 0.433 0.567 0 0  0 0.475 0.525 0 0  0 0 0 1 0" /></filter>
    </defs>
  </svg>
  <!-- AppearanceConfigurable cdDifferentiateProjects: a per-project toolbar tint
       ("Use project colours in the main toolbar"); the palette reuses the
       RecentProjectIconHelper gradient assigned by path hash. -->
  <div class="ide-shell" :class="{ 'is-resizing': resizing }" :style="{ '--explorer-width': `${panelSizes.explorer}px`, '--trace-width': `${panelSizes.trace}px`, '--output-height': `${panelSizes.output}px`, ...(editorSettings.differentiateProjects && workspace ? { '--project-tint': projectTint(workspace.root) } : {}) }" @pointerdown.capture="dismissMenu" @focusin="noteDockFocus">
    <header v-if="workspace && !chromeHidden" class="topbar">
      <!-- 行1：菜单栏。IDEA 的窗口顶部第一行就是菜单栏（File/Edit/…），应用名在标题栏上，不占这一行 ——
           原先这里还有一个「TaoCode」品牌标签，已按源码去掉。 -->
      <div class="topbar-menubar-row">
      <button v-if="menuButtonVisible" class="icon-button hamburger-button" :aria-expanded="hamburgerOpen" aria-haspopup="menu" title="主菜单" aria-label="主菜单" @click.stop="hamburgerOpen = !hamburgerOpen"><ChevronRight v-if="editorSettings.mainMenuDisplayMode === 'merged'" :size="20" /><Menu v-else :size="20" /></button><div v-if="hamburgerOpen" class="menu-expand-shadow" @pointerdown="hamburgerOpen = false" />
      <nav class="menubar" aria-label="主菜单">
        <div v-for="(group, groupIndex) in allMenuGroups" :key="group.menu" class="menu-anchor" :class="{ 'menu-folded': groupIndex >= menuVisibleCount }">
          <button class="menu-button" :aria-expanded="menu === group.menu" aria-haspopup="menu" :aria-controls="`menu-${group.menu}`" @click="menu = menu === group.menu ? null : group.menu; submenuRow = null" @keydown.down.prevent="focusMenu(group.menu)" @keydown.up.prevent="focusMenu(group.menu, true)">{{ group.label }}</button>
          <AnimatePresence>
            <motion.div v-if="menu === group.menu" :id="`menu-${group.menu}`" :key="group.menu" class="dropdown" role="menu" :aria-label="group.label" :initial="popupEnter" :animate="{ opacity: 1, y: 0, scale: 1 }" :exit="popupExit" :transition="popupTransition" @keydown="onMenuKeydown($event, group.menu)">
              <template v-for="row in group.rows" :key="row.id">
                <div v-if="row.rule" class="menu-rule" role="separator" />
                <div v-else-if="row.section" class="menu-section-label" role="presentation">{{ row.section }}</div>
                <template v-else-if="row.recent">
                  <button v-for="project in recentProjects.slice(0, 6)" :key="project.path" class="menu-item recent-menu-item" role="menuitem" :disabled="working || !project.available" :title="project.path" @click="openRecentProject(project)"><FolderOpen :size="14" class="menu-item-icon" /><span class="recent-menu-name">{{ project.name }}</span></button>
                  <span v-if="!recentProjects.length" class="menu-empty">暂无最近项目</span>
                </template>
                <div v-else-if="hasSubmenu(row)" class="menu-submenu-anchor" @mouseenter="openSubmenu(row, $event)" @mouseleave="scheduleSubmenuClose">
                  <button class="menu-item menu-submenu-trigger" role="menuitem" aria-haspopup="menu" :aria-expanded="submenuRow === row.id" :disabled="!rowEnabled(row)" @click.stop="pickMenuRow(row)">
                    <span class="menu-item-icon" /><span class="menu-item-title">{{ rowTitle(row) }}</span><ChevronRight :size="12" class="menu-submenu-caret" aria-hidden="true" />
                  </button>
                  <Teleport to="body">
                  <div v-if="submenuRow === row.id" class="dropdown menu-submenu" :class="{ 'menu-submenu-above': submenuPlacement === 'above' }" role="menu" :aria-label="rowTitle(row)" :style="submenuStyle" @mouseenter="cancelSubmenuClose" @mouseleave="scheduleSubmenuClose" @keydown.esc.stop="closeSubmenu()">
                    <template v-for="child in submenuRows(row)" :key="child.id">
                      <div v-if="child.rule" class="menu-rule" role="separator" />
                      <div v-else-if="child.section" class="menu-section-label" role="presentation">{{ child.section }}</div>
                      <button v-else class="menu-item" :role="child.checked ? 'menuitemcheckbox' : 'menuitem'" :aria-checked="child.checked ? child.checked() : undefined" :disabled="!rowEnabled(child)" @click="pickMenuRow(child)"><span class="menu-item-icon"><Check v-if="child.checked && child.checked()" :size="13" /></span><span class="menu-item-title">{{ rowTitle(child) }}</span><kbd v-if="child.keys">{{ child.keys }}</kbd></button>
                    </template>
                  </div>
                </Teleport>
                </div>
                <button v-else class="menu-item" :role="row.checked ? 'menuitemcheckbox' : 'menuitem'" :aria-checked="row.checked ? row.checked() : undefined" :disabled="!rowEnabled(row)" @click="pickMenuRow(row)"><span class="menu-item-icon"><Check v-if="row.checked && row.checked()" :size="13" /></span><span class="menu-item-title">{{ rowTitle(row) }}</span><kbd v-if="row.keys">{{ row.keys }}</kbd></button>
              </template>
            </motion.div>
          </AnimatePresence>
        </div>
      </nav>
      </div>
      <!-- 行2：主工具栏（IDEA `MainToolbarNewUI`，PlatformActions.xml:839-854）——
           左：项目 widget / 分支 / 运行 widget；中：文件名 widget；右：SearchEverywhere + SettingsEntryPoint。 -->
      <MainToolbar :ctx="mainToolbarCtx" />
    </header>

    <div v-if="configChooser && !chromeHidden" class="config-chooser" role="listbox" :aria-label="configChooser.debug ? '选择要调试的配置' : '选择要运行的配置'">
      <p class="config-chooser-title">{{ configChooser.debug ? '调试配置' : '运行配置' }}</p>
      <p v-if="!runConfigs.length" class="config-chooser-empty">还没有运行配置：在「运行」面板里填好并保存一个。</p>
      <button
        v-for="(config, index) in runConfigs" :key="config.name"
        class="menu-button config-chooser-row" role="option" :aria-selected="index === configIndex"
        :class="{ selected: index === configIndex }"
        @mouseenter="configIndex = index" @click="applyConfigChoice(config)"
      >
        <span class="config-chooser-name">{{ config.name }}</span>
        <span class="config-chooser-meta">{{ config.type ?? 'shell' }}<template v-if="config.program"> · {{ config.program }}</template></span>
      </button>
      <p class="config-chooser-hint">↑↓ 选择 · Enter 运行 · Esc 取消</p>
    </div>
    <div v-if="configChooser" class="config-chooser-backdrop" @click="configChooser = null" />
    <p v-if="generalSettings.supportScreenReaders" class="sr-live" role="status" aria-live="polite">{{ notice ?? '' }}</p>
    <div v-if="!isDesktop && !chromeHidden" class="preview-banner"><span class="preview-dot" />浏览器预览<span class="preview-description">示例文件仅保存在内存。运行 C++ 桌面端以访问本地工作区。</span><span class="banner-right">Vue 3 / WebView2 / C++20</span></div>

    <WelcomePage v-if="!workspace" :projects="recentProjects" :busy="working" :error="appError" :git-available="gitAvailable" :is-desktop="isDesktop" :plugin-count="pluginList.length" :theme="theme" :settings="editorSettings" :notices="noticeLog" :screen-reader-live="generalSettings.supportScreenReaders" @open="openWorkspace" @create="beginProject('create')" @clone="beginProject('clone')" @settings="openSettings()" @forget="forgetProject" @forget-batch="forgetProjects" @refresh="refreshRecent" @help="help = true" @option="id => id === 'about' ? showAbout() : id === 'paths' ? browseSpecialPaths() : collectLogs()" @plugins="openPlugins" @theme="changeTheme" @settings-change="saveSettingsPatch" @clear-notices="clearNotices" />

    <div v-else class="workbench" :class="{ 'zen-workbench': chromeHidden, 'tool-maximized': maximizedSide !== null }">
      <!-- Zen 模式的退出入口：IDEA 的 Zen/免打扰模式保留 Esc 与顶部浮出工具栏，这里给常驻悬浮按钮，
           否则唯一入口（视图 › 外观）随 header 一起 v-if 掉，用户会被困在空界面里。 -->
      <button v-if="chromeHidden" class="zen-exit" :title="`${hideChromeLabel}（Esc）`" :aria-label="hideChromeLabel" @click="exitHideChrome()"><X :size="13" />{{ hideChromeLabel }}</button>
      <!-- IDEA 的 Stripe（ToolWindowManagerImpl）跟工具窗口的**显示/隐藏**是分开的：隐藏窗口只是收起它的
           面板，条纹上的按钮仍在（再次点击即重新显示）—— 原先写成 `explorer && !chromeHidden`，于是
           「⋮ 隐藏」之后整条左条纹一起消失，用户再也点不回来。按钮/拖拽/拖宽的分隔线/「更多」都在
           src/components/ToolStripe.vue（上下两侧条是同一份结构，IDEA 也只是 Left/RightToolbar 两个薄子类）。 -->
      <ToolStripe
        v-if="!chromeHidden" side="left" :ids="stripeOrder('left')" :labels="toolTitles" :icons="toolIcons" :mnemonic-of="toolWindowMnemonic" :is-disabled="toolDisabled" :is-active="id => explorer && leftView === id" :dragging="draggingTool"
        :is-drop-before="isDropBefore" :drop-at-end="dropTarget?.side === 'left' && !dropTarget.before" :width="stripeWidth('left')" :more-ids="moreButtonRows" :show-names="editorSettings.showToolWindowNames" :compact="editorSettings.compactMode" :more-on-this-side="moreButtonVisible('left')"
        @activate="activateToolWindow" @menu="openToolMenu" @drag-start="onToolDragStart" @drag-over="(id, event) => onToolDragOver('left', id, event)" @drop="(id, event) => onToolDrop('left', id, event)" @drag-end="onToolDragEnd"
        @resize="width => setStripeWidth('left', width)" @toggle-names="toggleToolWindowNames" @more-pick="activateToolWindow" @move-more-to="moveMoreButtonTo"
      >
        <button class="activity-button" :class="{ active: activity }" title="处理记录" aria-label="切换处理记录" @click="activity = !activity"><Workflow :size="21" /></button>
        <div class="rail-divider" />
        <button class="activity-button" :class="{ active: bottom }" title="输出面板" aria-label="切换输出面板" @click="bottom = !bottom"><span class="activity-name">输出</span><TerminalSquare :size="20" /></button>
        <div class="rail-bottom"><button class="activity-button" title="设置 (Ctrl+Alt+S)" aria-label="设置" :disabled="working" @click="openSettings()"><SlidersHorizontal :size="20" /></button><span class="local-avatar" title="仅本地工作区">L</span></div>
      </ToolStripe>

      <aside v-if="explorer && !chromeHidden && activeAnchor === 'left'" class="explorer-panel" tabindex="-1">
        <ToolWindowHeader
          :id="leftView" :title="toolTitles[leftView] ?? '工具窗口'" anchor="left"
          :maximized="maximizedSide === 'left'" :menu-open="toolMenu === leftView"
          @activate="focusToolWindowContent(leftView)"
          @hide="explorer = false; toolMenu = null"
          @maximize="toggleToolMaximized('left')"
          @move="setToolAnchor(leftView, $event); toolMenu = null"
          @menu="toolMenu = $event ? leftView : null" :extra-rows="toolWindowGearRows" @pick-extra="pickEditorPopup($event); toolMenu = null"
        />
        <!-- 视图宿主：左侧栏与底部停靠共用同一批组件（对照 IDEA 的任意停靠）。 -->
        <ToolWindowView :view="leftView" :active="explorer" :ctx="toolViewCtx" />
        <!-- IDEA "Side-by-side layout on the left": the project view stays visible
             below the active left tool window instead of being replaced by it. -->
        <template v-if="leftSideBySide && leftView !== 'files' && workspace">
          <div class="dock-split" aria-hidden="true" />
          <div class="panel-heading"><span>{{ toolTitles.files }}</span></div>
          <div class="tree-scroll side-by-side-tree">
            <FileTree :key="workspace.root" :workspace-key="workspace.root" :project-name="workspace.name" :file-color="projectViewFileColor" :entries="workspace.entries" :active="activePath" :synthetic="syntheticNodes" :indent-guides="editorSettings.showTreeIndentGuides" :compact-indents="editorSettings.compactTreeIndents" :expand-with-single-click="editorSettings.expandNodesWithSingleClick" @open="(path, preview) => void openFile(path, false, { preview })" @error="notify($event, true)" @context="onTreeContext" />
          </div>
        </template>
      </aside>

      <!-- IDEA's right dock: a tool window anchored right renders in its own column
           (ToolWindowAnchor.RIGHT), with the same ⋮ options menu as the left dock. -->
      <aside v-if="explorer && !chromeHidden && activeAnchor === 'right'" class="explorer-panel right-dock" tabindex="-1">
        <ToolWindowHeader
          :id="leftView" :title="toolTitles[leftView] ?? '工具窗口'" anchor="right"
          :maximized="maximizedSide === 'right'" :menu-open="toolMenu === leftView"
          @activate="focusToolWindowContent(leftView)"
          @hide="explorer = false; toolMenu = null"
          @maximize="toggleToolMaximized('right')"
          @move="setToolAnchor(leftView, $event); toolMenu = null"
          @menu="toolMenu = $event ? leftView : null" :extra-rows="toolWindowGearRows" @pick-extra="pickEditorPopup($event); toolMenu = null"
        />
        <!-- 同一个视图宿主：右 dock 与左栏/底部共用（IDEA 的同一份 content 可停靠任意边）。 -->
        <ToolWindowView :view="leftView" :active="explorer" :ctx="toolViewCtx" />
      </aside>

      <!-- IDEA's right stripe (Stripe.java): a narrow rail listing the tool windows
           anchored right, clickable exactly like the left activity bar. -->
      <ToolStripe
        v-if="!chromeHidden && stripeOrder('right').length"
        side="right" :ids="stripeOrder('right')" :labels="toolTitles" :icons="toolIcons" :mnemonic-of="toolWindowMnemonic" :is-disabled="toolDisabled" :is-active="id => explorer && leftView === id" :dragging="draggingTool"
        :is-drop-before="isDropBefore" :drop-at-end="false" :width="stripeWidth('right')" :more-ids="moreButtonRows" :show-names="editorSettings.showToolWindowNames" :compact="editorSettings.compactMode" :more-on-this-side="moreButtonVisible('right')"
        @activate="activateToolWindow" @menu="openToolMenu" @drag-start="onToolDragStart" @drag-over="(id, event) => onToolDragOver('right', id, event)" @drop="(id, event) => onToolDrop('right', id, event)" @drag-end="onToolDragEnd"
        @resize="width => setStripeWidth('right', width)" @toggle-names="toggleToolWindowNames" @more-pick="activateToolWindow" @move-more-to="moveMoreButtonTo"
      />

      <div v-if="explorer && !chromeHidden" class="resize-handle resize-explorer" role="separator" aria-label="调整项目面板宽度" aria-orientation="vertical" :aria-valuenow="panelSizes.explorer" :aria-valuemin="180" :aria-valuemax="Math.max(180, panelMax('explorer'))" tabindex="0" @pointerdown="startResize($event, 'explorer')" @keydown="resizeKey($event, 'explorer')" />
      <main class="editor-column">
        <!-- 分屏只作用在编辑区：IDEA 的 split 是**编辑器组**之间的划分（EditorWindowSplitters），
             底部工具窗口条在它外面。原先 split-horizontal 直接落在 .editor-column 上，于是左右
             分屏会把底部输出面板也排成同一行（flex-direction: row 命中它）。 -->
        <div class="editor-groups" :class="{ 'split-horizontal': splitOrientation === 'horizontal', 'split-vertical': splitOrientation === 'vertical' }">
        <!-- IDEA: each pane is an editor group with its own tab bar; the focused group
             is marked by a stronger top border on its tabs. -->
        <template v-for="pane in ([0, 1] as const)" :key="pane">
          <template v-if="pane === 1 && splitOrientation !== 'none'">
            <div class="resize-handle split-divider" :class="splitOrientation === 'horizontal' ? 'resize-split-h' : 'resize-split-v'" role="separator" :aria-label="splitOrientation === 'horizontal' ? '调整左右分屏宽度' : '调整上下分屏高度'" :aria-orientation="splitOrientation === 'horizontal' ? 'vertical' : 'horizontal'" tabindex="0" @pointerdown="startSplitResize($event)" @keydown="resizeSplitKey($event)" />
          </template>
          <div v-if="pane === 0 || splitOrientation !== 'none'" class="editor-pane" :class="[pane === 0 ? 'primary-pane' : 'secondary-pane', { 'pane-focused': focusedPane === pane }]" :style="pane === 1 ? (splitOrientation === 'horizontal' ? { flex: `0 1 ${splitSize}px`, minWidth: '160px' } : { flex: `0 1 ${splitSize}px`, minHeight: '160px' }) : undefined" @pointerdown.capture="focusPane(pane)">
            <div class="editor-tabs" :class="{ 'tabs-wrapped': tabStripWraps(pane) }" :style="tabStripStyle(pane)" role="tablist" :ref="element => registerTabStrip(pane, element)" :aria-label="pane === 0 ? '编辑器标签组' : '第二标签组'" @dragover="onTabDragOver(pane, $event)" @drop="onTabStripDrop(pane, $event)" @wheel="onTabStripWheel(pane, $event)" @pointerenter="setTabStripHover(pane, true)" @pointerleave="setTabStripHover(pane, false)">
              <div v-for="(tab, index) in groups[pane].tabs" :key="`${pane}:${tab.path}`" class="file-tab" :class="{ selected: groups[pane].activePath === tab.path, pinned: tab.pinned, preview: tab.preview && groups[pane].activePath !== tab.path, dragging: dragTab?.pane === pane && dragTab.path === tab.path }" :style="[tabFileColor(tab.path) ? { background: tabFileColor(tab.path)!, color: 'var(--text)' } : undefined, tabWidthStyle(pane, index)]" draggable="true" @dragstart="onTabDragStart(pane, tab, $event)" @dragend="dragTab = null" @dragover="onTabDragOver(pane, $event)" @drop="onTabDrop(pane, tab.path, $event)" @contextmenu="onTabContext(pane, tab, $event)">
                <button class="tab-select" role="tab" :aria-selected="groups[pane].activePath === tab.path" :title="tabFileColorScope(tab.path) ? `作用域：${tabFileColorScope(tab.path)}` : tab.path" @click="switchTabIn(pane, tab)" @dblclick="onEditorTabDoubleClick(tab)"><FileCode2 :size="14" /><span>{{ tab.path.split('/').pop() }}</span><Pin v-if="tab.pinned" :size="11" class="pin-mark" aria-label="已固定" /><span v-if="tab.dirty" class="dirty-dot" aria-label="未保存" /></button>
                <button class="tab-close" :aria-label="`关闭 ${tab.path}`" :disabled="tab.saving" @click="closeTabIn(pane, tab)"><X :size="12" /></button>
              </div>
              <div v-if="!groups[pane].tabs.length" class="welcome-tab"><Braces :size="14" />工作台</div>
              <div class="tab-toolbar">
                <template v-if="pane === 0">
                  <button class="icon-button" title="后退 (Ctrl Alt ←)" aria-label="后退" :disabled="!navBack.length" @click="goBack"><ArrowLeft :size="16" /></button>
                  <button class="icon-button" title="前进 (Ctrl Alt →)" aria-label="前进" :disabled="!navForward.length" @click="goForward"><ArrowRight :size="16" /></button>
                  <button class="icon-button" title="保存文件 (Ctrl+S)" aria-label="保存文件" :disabled="!active || !active.dirty || active.saving" @click="save()"><Save :size="15" /></button>
                  <button class="icon-button" title="切换处理记录" aria-label="切换右侧处理记录" @click="activity = !activity"><span class="activity-name">处理记录</span><ListTree :size="16" /></button>
                  <!-- 标签条右端的常驻下拉：IDEA `EditorTabsEntryPoint`（PlatformActions.xml:804-816）。 --><TabEntryPoint :items="tabEntryPointItems(pane)" />
                </template>
                <template v-else>
                  <button class="icon-button" title="向右分屏（活动标签，Shift+Enter）" aria-label="向右分屏" :disabled="!focusedTab" @click="focusedTab && splitTabOut(focusedTab, 'horizontal')"><Columns2 :size="15" /></button>
                  <button class="icon-button" title="向下分屏（活动标签，Ctrl+Shift+Enter）" aria-label="向下分屏" :disabled="!focusedTab" @click="focusedTab && splitTabOut(focusedTab, 'vertical')"><Rows3 :size="15" /></button>
                  <button class="icon-button" title="取消分屏" aria-label="取消分屏" @click="unsplit"><X :size="14" /></button>
                </template>
              </div>
            </div>
            <div v-if="groupActive(pane) && editorSettings.breadcrumbsPlacement === 'top' && breadcrumbsOn(groupActive(pane)!.path)" class="breadcrumbs" :data-navbar="groupActive(pane)?.path === activePath ? 'active' : undefined"><button class="breadcrumb-seg" title="项目根" @click="explorer = true; leftView = 'files'">{{ workspace?.name }}</button><ChevronRight :size="12" /><template v-for="(seg, i) in groupActive(pane)!.path.split('/').slice(0, -1)" :key="i"><button class="breadcrumb-seg" :title="`转到 ${seg}`" @click="openBreadcrumb(i)">{{ seg }}</button><ChevronRight :size="12" /></template><span class="breadcrumb-file"><FileCode2 :size="12" />{{ groupActive(pane)!.path.split('/').pop() }}</span><span class="editor-save-state">{{ groupActive(pane)!.saving ? '保存中…' : groupActive(pane)!.dirty ? '有未保存修改' : isDesktop ? '已读取磁盘版本' : '内存示例' }}</span><button v-if="markdownCapable && focusedPane === pane && groupActive(pane)?.path === activePath" class="status-chip md-toggle" :class="{ active: markdownPreviewOn }" title="切换 Markdown 预览" aria-label="切换 Markdown 预览" @click="toggleMarkdownPreview">预览</button></div>
            <div class="editor-stage" :data-bidi="editorSettings.bidiTextDirection" :class="{ 'has-md-preview': markdownPreviewOn && markdownCapable && focusedPane === pane && groupActive(pane)?.path === activePath }">
              <!-- 粘性作用域行：覆盖在编辑区顶边（对应 IDEA 的 sticky lines 层）。 -->
              <div v-if="stickyLines.length && pane === focusedPane && !binaryView" class="sticky-lines" aria-hidden="true">
                <div v-for="symbol in stickyLines" :key="symbol.startLine" class="sticky-line">{{ symbol.name }}</div>
              </div>
              <BinaryViewer v-if="binaryView && pane === focusedPane" :path="binaryView.path" :data="binaryView.data" @close="closeBinary" @reveal="revealBinary" />
              <CodeEditor v-for="tab in groups[pane].tabs" v-show="groups[pane].activePath === tab.path" :key="`${workspaceEpoch}:${bufferEpoch}:${pane}:${tab.path}`" :ref="element => setEditorRef(pane, tab.path, element)" :content="tab.content" :path="tab.path" :language="associationOf(tab.path)" :theme="theme" :settings="editorSettings" :templates="projectSettings.templates" :plugin-templates="pluginList" :active="groups[pane].activePath === tab.path && focusedPane === pane" :lsp-enabled="lspOn(tab)" :reveal="pane === focusedPane && tab.path === reveal?.path ? reveal : null" :breakpoints="dapBreakpoints.get(tab.path) ?? []" :debug-line="currentDebugLine(tab.path)" :bookmarks="bookmarkLines[tab.path] ?? []" @change="onEditorChange(tab)" @cursor="(line, column) => { tab.line = line; tab.column = column }" @save="save(tab)" @error="notify($event, true)" @reveal="revealLocation" @semantic="onSemantic" @evaluate="requestEvaluate" @surround="openSurround" @breakpoint="line => toggleBreakpointAt(tab.path, line)" @link="openDocumentLink" @code-lens="runCodeLensCommand" @template-chooser="openTemplateChooser" @paste="onEditorPaste" @typing="recordTypingStep" :gutter-icons="gutterIcons" :blame="blameOf(tab.path)" @gutter-icon="onGutterIcon" @column-mode="active => { if (pane === focusedPane && tab.path === activePath) columnMode = active }" @selection="info => { if (pane === focusedPane && tab.path === activePath) selectionInfo = info }" @cursors="count => { if (pane === focusedPane && tab.path === activePath) cursorCount = count }" @contextmenu.prevent="openEditorPopup($event)" />
              <MarkdownPreview v-if="markdownPreviewOn && markdownCapable && focusedPane === pane && groupActive(pane)?.path === activePath" class="md-split" :path="activePath" :content="markdownSource" @open="path => void openFile(path, false, { preview: true })" @error="message => notify(message, true)" />
              <!-- IDEA's empty editor: a right-aligned shortcut list plus the
                   drag-and-drop hint (verified on screen: 随处搜索 Shift Shift /
                   转到文件 Ctrl+Shift+N / 最近的文件 Ctrl+E / 导航栏 Alt+Home /
                   将文件拖放到此处以打开). -->
              <div v-if="!groups[pane].tabs.length && !binaryView && pane === 0" class="welcome-screen">
                <ul class="empty-hints">
                  <li><button class="empty-hint" @click="openSearchEverywhere">随处搜索</button><span>Shift Shift</span></li>
                  <li><button class="empty-hint" @click="openPalette">转到文件</button><span>Ctrl+Shift+N</span></li>
                  <li><button class="empty-hint" @click="openRecentFiles">最近的文件</button><span>Ctrl+E</span></li>
                  <li><button class="empty-hint" @click="showNavBar">导航栏</button><span>Alt+Home</span></li>
                  <li class="empty-hint-drag">将文件拖放到此处以打开</li>
                </ul>
              </div>
            </div>
            <!-- 面包屑位置 = 底部（IDEA BreadcrumbsPlacement.BOTTOM）：同一行内容渲染在编辑区下方。 -->
            <div v-if="groupActive(pane) && editorSettings.breadcrumbsPlacement === 'bottom' && breadcrumbsOn(groupActive(pane)!.path)" class="breadcrumbs breadcrumbs-bottom" :data-navbar="groupActive(pane)?.path === activePath ? 'active' : undefined"><button class="breadcrumb-seg" title="项目根" @click="explorer = true; leftView = 'files'">{{ workspace?.name }}</button><ChevronRight :size="12" /><template v-for="(seg, i) in groupActive(pane)!.path.split('/').slice(0, -1)" :key="i"><button class="breadcrumb-seg" :title="`转到 ${seg}`" @click="openBreadcrumb(i)">{{ seg }}</button><ChevronRight :size="12" /></template><span class="breadcrumb-file"><FileCode2 :size="12" />{{ groupActive(pane)!.path.split('/').pop() }}</span></div>
          </div>
        </template>
        </div>
        <div v-if="bottom && !chromeHidden" class="resize-handle resize-output" role="separator" aria-label="调整输出面板高度" aria-orientation="horizontal" :aria-valuenow="panelSizes.output" :aria-valuemin="100" :aria-valuemax="panelMax('output')" tabindex="0" @pointerdown="startResize($event, 'output')" @keydown="resizeKey($event, 'output')" />
        <section v-if="bottom && !chromeHidden" class="output-panel">
          <div class="output-heading"><div v-if="isTabbedContentUi(contentUiType())" class="output-tabs"><button :class="{ selected: bottomTab === 'output' }" @click="showOutput('output')">操作输出 <span class="count-badge">{{ traces.length }}</span></button><button :class="{ selected: bottomTab === 'run' }" @click="showOutput('run')">{{ runConfigName ? `运行 '${runConfigName}'` : '运行' }} <span v-if="runState.running" class="count-badge">●</span><span v-else-if="runState.exit !== null" class="count-badge">exit {{ runState.exit }}</span></button><button :class="{ selected: bottomTab === 'problems' }" @click="showOutput('problems')">问题 <span class="count-badge">{{ allProblems.length }}</span></button><span v-for="tab in referenceTabs" :key="`ref:${tab.id}`" class="output-tab-closeable"><button :class="{ selected: bottomTab === 'references' && tab.selected }" :title="tab.tooltip" @click="selectReferenceTab(tab.id)">{{ tab.searching ? '正在查找…' : tab.label }} <span class="count-badge">{{ tab.count }}</span></button><button class="icon-button output-tab-pin" :class="{ pinned: tab.pinned }" :aria-pressed="tab.pinned" :aria-label="`${tab.pinned ? '取消钉住' : '钉住'}：${tab.label}`" :title="tab.pinned ? '取消钉住（钉住后不会被下一次搜索顶替）' : '钉住（钉住后不会被下一次搜索顶替）'" @click.stop="pinReferenceTab(tab.id)"><Pin :size="11" /></button><button class="icon-button output-tab-close" :aria-label="`关闭：${tab.label}`" title="关闭" @click.stop="closeReferenceTab(tab.id)"><X :size="11" /></button></span><button v-if="hierRoot" :class="{ selected: bottomTab === 'hierarchy' }" @click="showOutput('hierarchy')">{{ hierTitle }} <span class="count-badge">{{ hierItems.length }}</span></button><button :class="{ selected: bottomTab === 'terminal' }" @click="showOutput('terminal')"><SquareTerminal :size="11" /> 终端</button><!-- 停靠在底部的工具窗口（DEFAULT_TOOL_ANCHORS 里 vcslog/todo/debug/tests 默认就在底部）：
             IDEA 的底部工具窗口条列出该窗口的全部 content，TaoCode 的这条 tab 条就是那个入口 ——
             少了它，这四个窗口除了从条纹点进来之外没有任何常驻入口。 --><button v-for="id in bottomAnchoredIds" :key="`tool:${id}`" :class="{ selected: bottomTab === id }" :title="`${toolTitles[id]}（停靠在底部；右键可移回左侧/右侧）`" @click="showOutput(id)" @contextmenu.prevent="openAnchorMenu(id, $event)">{{ toolTitles[id] }}</button><button v-if="bottomTabIsToolWindow" class="icon-button output-tabs-options" aria-label="调整此工具窗口的停靠位置" title="调整此工具窗口的停靠位置（左侧 / 右侧 / 底部）" @click="openAnchorMenu(bottomTab, $event)"><MoreVertical :size="14" aria-hidden="true" /></button></div><select v-else class="output-content-select" aria-label="工具窗口内容" :value="bottomSelectValue" @change="pickBottomOption(($event.target as HTMLSelectElement).value)"><option v-for="option in bottomTabOptions" :key="option.id" :value="option.id">{{ option.label }}</option></select><div class="heading-actions"><span class="small-muted">{{ isDesktop ? 'C++ BRIDGE' : 'PREVIEW ADAPTER' }}</span><ToolWindowGear :rows="bottomGearRows" label="输出窗口选项" @pick="pickEditorPopup($event)" /><button class="icon-button" title="收起输出" aria-label="收起输出" @click="bottom = false"><X :size="14" /></button></div></div>
          <div v-if="bottomTab === 'output'" class="output-lines" role="log" aria-label="操作输出">
            <div v-if="!traces.length" class="output-placeholder">等待操作。原生请求的结果会显示在这里，不采集文件正文。</div>
            <div v-for="trace in traces.slice(0, 30)" :key="trace.id" class="output-line" :class="{ failure: trace.status === 'error' }"><span class="log-time">{{ trace.started }}</span><span class="log-id">#{{ String(trace.id).padStart(3, '0') }}</span><span class="log-method">{{ trace.method }}</span><span class="log-result">{{ trace.status === 'pending' ? '处理中…' : trace.message }} <span class="log-target">{{ trace.target }}</span></span></div>
          </div>
          <div v-else-if="bottomTab === 'run'" class="run-panel">
            <div class="run-configs">
              <select class="run-config-select" :value="runConfigName" aria-label="选择运行配置" @change="pickConfig(($event.target as HTMLSelectElement).value)"><option v-for="config in runConfigs" :key="config.name" :value="config.name">{{ config.name }}</option></select>
              <input v-model="runConfigName" class="run-config-name" aria-label="运行配置名称" placeholder="配置名" />
              <!-- IDEA's Run/Debug act on the selected configuration; a debug-type one
                   hands its command line to the DAP session instead of the shell. -->
              <label class="run-config-debug"><input v-model="runConfigDebug" type="checkbox" />调试（DAP）</label>
              <button class="subtle-button" :aria-expanded="runConfigEditorOpen" title="编辑程序、参数、工作目录、环境变量与启动前步骤" @click="runConfigEditorOpen = !runConfigEditorOpen">{{ runConfigEditorOpen ? '收起配置' : '配置…' }}</button>
              <button class="subtle-button" title="把当前配置保存/更新为命名配置" @click="saveConfig">存为配置</button>
              <button class="icon-button" title="删除当前配置" :disabled="runConfigs.length <= 1" @click="removeConfig"><Trash2 :size="14" /></button>
            </div>
            <!-- The full IDEA run-configuration shape: everything here is persisted
                 with the project and sent to `run.start`, not just the command. -->
            <div v-if="runConfigEditorOpen" class="run-config-editor">
              <div class="run-config-grid">
                <label class="run-field"><span>类型</span>
                  <select v-model="runConfigType" aria-label="运行类型">
                    <option value="shell">Shell 命令</option>
                    <option value="application">可执行程序</option>
                    <option value="debug">调试（DAP）</option>
                  </select>
                </label>
                <label class="run-field"><span>工作目录</span><input v-model="runConfigCwd" placeholder="相对项目根目录，留空为根目录" aria-label="工作目录" /></label>
                <label v-if="runConfigType === 'debug'" class="run-field"><span>调试适配器</span><input v-model="runConfigDebugAdapter" placeholder="cppvsdbg（对应 TaoCode.dap.json 的键）" aria-label="调试适配器" /></label>
                <label class="run-field run-field-wide"><span>命令（shell）</span><input v-model="runCommand" placeholder="cmake --build build" aria-label="Shell 命令" /></label>
                <label class="run-field run-field-wide"><span>可执行程序</span><input v-model="runConfigProgram" placeholder="留空则用上面的 shell 命令" aria-label="可执行程序" /></label>
              </div>
              <div class="run-config-columns">
                <label class="run-field"><span>程序参数（每行一个）</span><textarea v-model="runConfigArgs" rows="3" aria-label="程序参数" placeholder="--flag&#10;value" /></label>
                <label class="run-field"><span>环境变量（每行一个 KEY=VALUE）</span><textarea v-model="runConfigEnv" rows="3" aria-label="环境变量" placeholder="KEY=value" /></label>
              </div>
              <div class="run-before">
                <div class="run-before-head">
                  <span>启动前步骤（按顺序执行，任一失败则中止）</span>
                  <button class="subtle-button" title="添加启动前步骤" @click="addBeforeLaunchStep"><Plus :size="13" /> 添加</button>
                </div>
                <p v-if="!runConfigBefore.length" class="run-before-empty">没有启动前步骤。</p>
                <div v-for="(step, index) in runConfigBefore" :key="index" class="run-before-row">
                  <input v-model="step.name" class="run-before-name" placeholder="名称，如 Build" aria-label="启动前步骤名称" />
                  <input v-model="step.command" class="run-before-command" placeholder="命令，如 cmake --build build" aria-label="启动前步骤命令" />
                  <button class="icon-button" :title="`删除第 ${index + 1} 个启动前步骤`" :aria-label="`删除第 ${index + 1} 个启动前步骤`" @click="removeBeforeLaunchStep(index)"><Trash2 :size="13" /></button>
                </div>
              </div>
            </div>
            <div class="run-toolbar">
              <input v-model="runCommand" :disabled="runState.running" class="run-command" aria-label="运行命令" placeholder="在项目根目录执行的命令，如 cmake --build build" @keydown.enter.prevent="startRun" />
              <!-- IDEA's Run toolbar: Rerun / Stop. Rerun (Ctrl+F5) relaunches the
                   last content with identical parameters. -->
              <button v-if="!runState.running" class="primary-button" :disabled="!isDesktop || !workspace" :title="lastRunParams ? '重新运行上次任务 (Ctrl+F5)' : '运行'" @click="lastRunParams ? rerunLast() : startRun()">{{ lastRunParams ? '重新运行' : '运行' }}</button>
              <button v-else class="subtle-button" @click="stopRun">停止</button>
            </div>
            <!-- 控制台 + 实例标签：IDEA 的 Run 工具窗口按实例开 Content，见 src/components/RunConsole.vue。 -->
            <RunConsole ref="runLog" :instances="runTabs" :active="activeRunInstance" :lines="runLines" :is-desktop="isDesktop"
              @select="focusRunInstance" @stop="id => void request('run.stop', { instance: id })" @jump="jumpToIssue" />
            <div v-if="runIssueCount" class="run-issues">
              <span class="run-issue-count">输出里有 {{ runIssueCount }} 处可跳转的问题</span>
              <button class="subtle-button" title="跳到下一处问题" @click="nextRunIssue">下一处问题</button>
            </div>
            <div v-if="runState.running" class="run-stdin"><span>$</span><input ref="runInput" aria-label="向进程发送输入" placeholder="输入一行发送到进程 stdin，回车确认" @keydown.enter.prevent="sendRunInput" /></div>
            <!-- IDEA：测试结果长在 Run 工具窗口（SM test runner 树），无独立 Tests 窗口 --><TestRunnerPanel :ref="instance => { testRunnerRef = instance as InstanceType<typeof TestRunnerPanel> | null }" :active-path="activePath ?? ''" :file-text="active?.content ?? ''" :root="workspace?.root ?? ''" :ready="isDesktop && Boolean(workspace)" />
          </div>
          <div v-else-if="bottomTab === 'problems'" class="problems-list" role="list" aria-label="问题">
            <div class="problems-toolbar">
              <p v-if="!allProblems.length" class="ref-empty">没有问题。LSP 报告的编译错误与警告会汇总在这里。</p>
              <button v-else class="subtle-button" :disabled="batchFixBusy || !lspReady" title="对当前文件逐条应用无歧义的快速修复（Code Cleanup）" @click="fixAllInFile">{{ batchFixBusy ? '修复中…' : '批量修复当前文件' }}</button>
            </div>
            <button v-for="(p, index) in allProblems" :key="`${p.path}:${p.line}:${p.character}:${index}`" class="ref-item problem-row" @click="revealLocation({ path: p.path, line: p.line })"><span class="problem-sev" :class="severityClass(p.severity)">{{ severityLabel(p.severity) }}</span><span class="ref-path" :title="p.path">{{ p.path }}</span><span class="ref-pos">{{ p.line + 1 }}:{{ p.character + 1 }}</span><span class="problem-msg">{{ p.message }}</span><span v-if="p.source" class="problem-src">{{ p.source }}</span></button>
          </div>
          <div v-else-if="bottomTab === 'references'" class="ref-list" role="list" aria-label="符号引用">
            <p v-if="!references.length" class="ref-empty">没有找到引用。</p>
            <button v-for="(ref, index) in references" :key="`${ref.path}:${ref.line}:${ref.character}:${index}`" class="ref-item" @click="revealLocation({ path: ref.path, line: ref.line })"><FileCode2 :size="13" /><span class="ref-path" :title="ref.path">{{ ref.path }}</span><span class="ref-pos">{{ ref.line + 1 }}:{{ ref.character + 1 }}</span></button>
          </div>
          <div v-else-if="bottomTab === 'hierarchy'" class="call-panel">
            <div class="call-head">
              <span class="call-root" :title="hierRoot?.path">{{ hierRoot ? `${hierRoot.name} · ${hierRoot.path}` : hierTitle }}</span>
              <div class="call-direction" role="group" :aria-label="hierTitle">
                <button v-for="[direction, label] in hierOptions" :key="direction" :class="{ selected: hierDirection === direction }" @click="pickHierarchyDirection(direction)">{{ label }}</button>
              </div>
              <button class="icon-button" title="重新查询" :aria-label="`重新查询${hierTitle}`" @click="loadHierarchy"><RefreshCw :size="14" /></button>
            </div>
            <div class="call-rows" role="list" :aria-label="hierTitle" :aria-busy="hierBusy">
              <p v-if="hierBusy || hierError || !hierItems.length" class="call-empty" role="status">{{ hierBusy ? '正在查询…' : hierError || '没有结果。' }}</p>
              <div v-for="({ node, depth }, index) in hierRows" :key="index" class="call-row" role="listitem" :style="{ paddingLeft: `${depth * 18 + 8}px` }">
                <button class="icon-button" :aria-label="`${node.expanded ? '收起' : '展开'} ${node.item.name}`" :aria-expanded="node.expanded" :disabled="node.loading || node.recursive || node.children?.length === 0" @click="toggleHierarchy(node)">
                  <ChevronDown v-if="node.expanded" :size="14" /><ChevronRight v-else :size="14" />
                </button>
                <button class="call-jump" :disabled="!node.item.path" :title="`${node.item.path}:${(node.item.line ?? 0) + 1}`" @click="revealLocation({ path: node.item.path, line: node.item.line ?? 0 })">
                  <span class="call-name">{{ node.item.name }}</span>
                  <span v-if="node.item.detail" class="call-detail">{{ node.item.detail }}</span>
                  <span class="call-path">{{ node.item.path }}</span>
                  <span class="call-pos">{{ (node.item.line ?? 0) + 1 }}:{{ (node.item.character ?? 0) + 1 }}</span>
                </button>
                <span v-if="node.loading || node.recursive || node.error || node.children?.length === 0" class="call-detail" role="status">{{ node.loading ? '查询中…' : node.recursive ? '递归关系' : node.error || '没有下级' }}</span>
                <button v-if="node.item.callLine !== undefined" class="icon-button" :title="`调用点 ${(node.item.callLine ?? 0) + 1}:${(node.item.callChar ?? 0) + 1}`" aria-label="跳到调用点" @click="revealLocation(callSiteTarget(node))"><ArrowRight :size="14" /></button>
              </div>
            </div>
          </div>
          <!-- 停靠在底部的工具窗口内容：复用 ToolWindowView 宿主（同一份组件，任意停靠）。 -->
          <div v-else-if="bottomAnchoredIds.includes(bottomTab as ToolWindowId)" class="bottom-view-host">
            <ToolWindowView :view="bottomTab" :active="bottom" :ctx="toolViewCtx" />
          </div>
          <div v-show="bottomTab === 'terminal'" class="terminal-host-wrap"><TerminalPanel ref="terminalPanelRef" :active="bottomTab === 'terminal' && bottom" @focus-terminal="showOutput('terminal')" /></div>
        </section>
      </main>

      <div v-if="activity && !chromeHidden" class="resize-handle resize-trace" role="separator" aria-label="调整处理记录宽度" aria-orientation="vertical" :aria-valuenow="panelSizes.trace" :aria-valuemin="180" :aria-valuemax="Math.max(180, panelMax('trace'))" tabindex="0" @pointerdown="startResize($event, 'trace')" @keydown="resizeKey($event, 'trace')" />
      <aside v-if="activity && !chromeHidden" class="trace-panel">
        <div class="panel-heading"><span><Workflow :size="15" />处理记录</span><span class="observe-badge"><span class="status-dot" />可观察</span></div>
        <div class="trace-intro"><div class="eyebrow">NOT A BLACK BOX</div><h2>每一步，都有来处。</h2><p>请求、结果与错误保持可见。<br />你的代码不会在这里悄悄改变。</p></div>
        <div class="bridge-route"><div><span class="route-icon"><Code2 :size="16" /></span><strong>Vue 3</strong><span>交互</span></div><span class="route-line">JSON RPC</span><div><span class="route-icon native"><Braces :size="16" /></span><strong>{{ isDesktop ? 'C++' : '内存' }}</strong><span>{{ isDesktop ? '文件处理' : '预览适配' }}</span></div></div>
        <div class="trace-list-heading"><span>本次会话</span><span>{{ traces.length }} 条记录 <span v-if="errors">/ {{ errors }} 项错误</span></span></div>
        <div class="trace-list">
          <div v-if="!traces.length" class="trace-empty"><Workflow :size="24" /><p>还没有处理记录</p><span>打开工作区后，操作会依次出现在这里。</span></div>
          <article v-for="trace in traces" :key="trace.id" class="trace-item" :class="trace.status">
            <button class="trace-summary" :aria-expanded="expandedTrace === trace.id" @click="expandedTrace = expandedTrace === trace.id ? null : trace.id"><span class="trace-status"><Check v-if="trace.status === 'success'" :size="12" /><X v-else-if="trace.status === 'error'" :size="12" /><span v-else>·</span></span><span class="trace-title"><strong>{{ ({ 'workspace.open': '打开工作区', 'workspace.list': '读取目录', 'file.read': '读取文件', 'file.write': '保存文件' })[trace.method as 'file.read'] ?? trace.method }}</strong><span :title="trace.target">{{ trace.target }}</span></span><span class="trace-timing">{{ trace.durationMs === undefined ? '等待中' : `${trace.durationMs.toFixed(1)} ms` }}<ChevronDown :size="12" /></span></button>
            <div v-if="expandedTrace === trace.id" class="trace-detail"><p><span>请求</span><code>#{{ trace.id }} {{ trace.method }}</code></p><p><span>时间</span>{{ trace.started }}</p><p><span>结果</span>{{ trace.message ?? '等待原生处理完成' }}</p><p v-if="trace.code"><span>错误码</span><code>{{ trace.code }}</code></p></div>
          </article>
        </div>
        <div class="trace-retention">仅本会话最近 200 条 · 不记录文件正文</div>
        <div class="capabilities"><div class="capabilities-heading"><ShieldCheck :size="14" />清晰的能力边界</div><div><span>本地文件读写</span><span class="capability-ready">{{ isDesktop ? '已接入' : '桌面端可用' }}</span></div><div><span>Agent / 模型执行</span><span>未接入</span></div><div><span>语言服务</span><span :class="{ 'capability-ready': lspReady }">{{ lspReady ? '就绪' : '未就绪' }}</span></div><div><span>终端</span><span class="capability-ready">{{ isDesktop ? 'ConPTY' : '桌面端可用' }}</span></div><div><span>调试器</span><span class="capability-ready">{{ isDesktop ? 'DAP' : '桌面端可用' }}</span></div></div>
      </aside>
    </div>

    <AnimatePresence>
      <motion.div v-if="notice" key="workspace-notice" class="notice workspace-notice" :class="{ error: noticeError, clickable: Boolean(noticeAction) }" role="status" :title="noticeAction ? '点击查看运行控制台' : undefined" @click="noticeAction?.()" :initial="reducedMotion ? { opacity: 1 } : { opacity: 0, y: 8 }" :animate="{ opacity: 1, y: 0 }" :exit="popupExit" :transition="popupTransition"><Check v-if="!noticeError" :size="15" class="notice-icon" /><CircleHelp v-else :size="15" class="notice-icon" /><span>{{ notice }}</span><span v-if="noticeActions?.length" class="notice-actions"><button v-for="action in noticeActions" :key="action.label" class="subtle-button notice-action" @click.stop="runBalloonAction(action)">{{ action.label }}</button></span><button class="icon-button" title="关闭提示" aria-label="关闭提示" @click.stop="notice = ''"><X :size="13" /></button></motion.div>
    </AnimatePresence>
    <footer v-if="workspace && !chromeHidden && editorSettings.showStatusBar" ref="statusBarRef" class="statusbar" role="group" aria-label="状态栏" @contextmenu="openStatusMenu" @keydown="onStatusBarKeydown"><div class="status-left"><button class="status-toolwindows" :aria-label="editorSettings.showToolWindowBars ? '隐藏工具窗口条' : '显示工具窗口条'" :aria-expanded="toolWindowsPopup" @click="toggleToolWindowStripes" @mouseenter="scheduleToolWindowsPopup(true)" @mouseleave="scheduleToolWindowsPopup(false)"><PanelLeftClose v-if="editorSettings.showToolWindowBars" :size="13" /><PanelLeftOpen v-else :size="13" /></button><div v-if="toolWindowsPopup" class="status-toolwindows-popup" role="menu" aria-label="工具窗口" @mouseenter="scheduleToolWindowsPopup(true)" @mouseleave="scheduleToolWindowsPopup(false)" @keydown.esc.stop="closeToolWindowsPopup()"><template v-for="group in groupedAvailableToolWindows" :key="group.anchor"><span class="status-toolwindows-group" role="presentation">{{ group.label }}</span><button v-for="id in group.ids" :key="id" class="menu-button status-toolwindows-row" role="menuitem" @click="closeToolWindowsPopup(); showView(id)"><span class="menu-item-icon"><component :is="toolIcons[id]" :size="13" /></span><span class="status-toolwindows-name">{{ toolTitles[id] }}</span><span v-if="toolWindowMnemonic(id)" class="status-toolwindows-key">Alt+{{ toolWindowMnemonic(id) }}</span></button></template><p v-if="!availableToolWindows.length" class="status-toolwindows-empty">当前没有可用的工具窗口。</p></div><button v-if="active && showWidget('file')" class="status-file" :title="`在…中选择 ${active.path} (Alt+F1)`" @click="openSelectIn"><span class="status-file-root">{{ workspace?.name }}</span><ChevronRight :size="11" /><span>{{ active.path }}</span></button><button v-if="gitHead && showWidget('branch')" class="status-branch" :title="`当前分支 ${gitHead}（点击打开源代码管理）`" @click="showView('git')"><GitBranch :size="12" />{{ gitHead }}<span v-if="gitAheadBehind.available && gitAheadBehind.ahead" class="status-count">↑{{ gitAheadBehind.ahead }}</span><span v-if="gitAheadBehind.available && gitAheadBehind.behind" class="status-count">↓{{ gitAheadBehind.behind }}</span></button><span>{{ statusLabel(working) }}</span><span v-if="dirty" class="status-unsaved">有未保存修改</span></div><!-- IDEA's InfoAndProgressPanel: a compact indicator in the status bar; clicking it lists every running background task. --><div v-if="showProgressWidget(backgroundTasks.length > 0, progressOpen) && showWidget('progress')" class="status-progress" :class="{ open: progressOpen }"><button class="status-progress-toggle" :aria-expanded="progressOpen" :title="progressOpen ? '收起后台任务列表' : '查看所有运行中的进程'" aria-label="后台任务" @click.stop="progressOpen = !progressOpen"><Loader2 v-if="backgroundTasks.length" :size="12" class="status-spin" /><Check v-else :size="12" aria-hidden="true" /><span>{{ backgroundTasks.length ? `后台任务 ${backgroundTasks.length}` : '后台任务' }}</span></button><div v-if="progressOpen" class="status-progress-list" role="menu" aria-label="后台任务" @keydown.esc.stop="progressOpen = false"><p v-for="row in progressRows" :key="`${row.kind}:${row.title}`" class="status-progress-row" :class="[`status-progress-${row.kind}`, { 'has-separator': row.separator }]"><template v-if="row.kind === 'task'"><strong>{{ row.title }}</strong><span>{{ row.detail }}</span><span v-if="row.percent !== null" class="status-progress-track" role="progressbar" :aria-valuenow="row.percent" aria-valuemin="0" aria-valuemax="100" :title="`完成度 ${row.percent}%`"><i :style="{ width: `${row.percent}%` }" /></span><button v-if="row.cancellable" class="status-progress-cancel" :aria-label="`取消：${row.title}`" title="取消此任务" @click="cancelProgressRow(row)"><X :size="12" />取消</button></template><template v-else><Check v-if="row.kind === 'finished'" :size="13" aria-hidden="true" class="status-progress-check" /><span>{{ row.title }}</span></template></p></div></div><div class="status-right"><button v-if="smartModeLabel && showWidget('smartMode')" class="status-chip status-smart" :title="`${smartModeLabel}（IDEA 的 Smart Mode 指示器）`" aria-label="语言服务状态" @click="showView('outline')">{{ smartModeLabel }}</button><button v-if="showWidget('problems')" class="status-problems" title="打开问题面板" aria-label="打开问题面板" @click="showOutput('problems')"><span class="sev-error">{{ allProblems.filter(p => p.severity === 1).length }} 错误</span><span class="status-separator">|</span><span class="sev-warning">{{ allProblems.filter(p => p.severity === 2).length }} 警告</span></button><button v-if="active && showWidget('position')" class="status-chip status-position" :title="selectionInfo ? `已选中 ${selectionInfo.characters} 个字符，跨 ${selectionInfo.lines} 行；点击转到行` : '点击转到行 (Ctrl+G)'" aria-label="光标位置" @click="openGoLine()">{{ cursorCount > 1 ? `${cursorCount} 个光标` : selectionInfo ? `已选 ${selectionInfo.characters} 字符` : `${active.line}:${active.column}` }}</button><button v-if="active?.readOnly && showWidget('readonly')" class="status-chip status-locked" title="文件只读（点击切换为可写）" @click="void toggleReadOnly(active!.path)"><Lock :size="12" />只读</button><span v-if="active && showWidget('lineSeparator')">{{ active.content.includes('\r\n') ? 'CRLF' : 'LF' }}</span><button v-if="processMemory && showWidget('memory')" class="status-chip status-memory" :title="`进程工作集 ${processMemory.workingSetMb} MB（历史峰值 ${processMemory.peakWorkingSetMb} MB，提交 ${processMemory.privateMb} MB）。宿主没有 JVM 堆上限，峰值不是上限。`" aria-label="内存使用" @click="refreshMemory">{{ processMemory.workingSetMb }} MB</button><button v-if="active && isDesktop && showWidget('lineSeparator')" class="status-chip" title="转换行分隔符（点击在 Windows 与 Unix 之间切换）" aria-label="转换行分隔符" @click="convertLineSeparators(active.content.includes('\r\n') ? 'lf' : 'crlf')">转换行尾</button><button v-if="showWidget('encoding')" class="status-chip" title="文件编码（点击可重新读取或转换保存）" aria-label="文件编码" :disabled="!active" @click="openEncoding">{{ encodingLabels[active?.encoding ?? 'utf-8'] }}{{ active?.bom ? ' 带 BOM' : '' }}</button><button v-if="showWidget('indent')" class="status-chip" :title="editorSettings.useTabCharacter ? '使用制表符缩进，点击修改' : `使用 ${editorSettings.tabSize} 个空格缩进，点击修改`" aria-label="缩进设置" @click="openSettings('preferences.sourceCode.indents')">{{ editorSettings.useTabCharacter ? '制表符' : `${editorSettings.tabSize} 个空格` }}</button><button v-if="columnMode && showWidget('column')" class="status-chip status-column" title="列选择模式已开启（Alt+Shift+Insert 或点击此处关闭）" aria-label="列选择模式" @click="toggleColumnModeFromStatusBar">列选择</button><button v-if="noticeLog.length && showWidget('notices')" class="status-chip status-notices" :class="{ 'has-error': noticeLevel(noticeLog) === 'error' }" :aria-expanded="noticeOpen" :title="noticeTitle(noticeLog)" aria-label="通知中心" @click.stop="noticeOpen = !noticeOpen">{{ noticeLog.length }} 条通知</button><button v-if="editorSettings.powerSaveMode && showWidget('powerSave')" class="status-chip status-powersave" title="省电模式已开启：语言服务与后台轮询暂停，点击关闭" aria-label="省电模式" @click="togglePowerSave"><Zap :size="12" />省电模式</button><span>{{ active ? language : 'TaoCode 0.1' }}</span><button title="切换输出面板" aria-label="切换底部面板" @click="bottom = !bottom"><PanelBottom :size="13" /></button><NoticeList v-if="noticeOpen" :entries="noticeLog" :live="generalSettings.supportScreenReaders" @clear="clearNotices" @close="noticeOpen = false" @expire="expireNotice" @run="runNoticeAction" /></div><div v-if="statusMenu" class="status-widget-menu" role="menu" aria-label="状态栏组件" :style="{ left: `${statusMenu.x}px`, top: `${statusMenu.y}px` }"><span class="status-widget-title">状态栏组件</span><button v-for="widget in listWidgets()" :key="widget.id" class="menu-button status-widget-item" role="menuitemcheckbox" :disabled="!widgetClickable(widget.id, Boolean(active))" :aria-checked="widgetChecked(widget.id)" @click="toggleWidget(widget.id)"><span class="menu-item-icon"><Check v-if="widgetChecked(widget.id)" :size="13" /></span><span>{{ widget.displayName }}</span></button><div class="menu-rule" role="separator" /><button class="menu-button status-widget-item" role="menuitem" @click="showAllWidgets(); statusMenu = null">全部显示</button></div><div v-if="statusMenu" class="status-widget-backdrop" @click="statusMenu = null" @contextmenu.prevent="statusMenu = null" /></footer>

    <ExportToHtmlDialog v-if="exportDialogOpen" :settings="projectSettings.exportToHtml ?? { scope: 0, includeSubdirectories: false, printLineNumbers: false, openInBrowser: false, outputDirectory: '' }" :file-name="activePath ? activePath.split('/').pop() ?? '' : ''" :directory-name="activePath.includes('/') ? activePath.slice(0, activePath.lastIndexOf('/')) : (activePath ? '(工作区根目录)' : '')" :selection-available="Boolean(active) && Boolean(editorFor(activePath)?.hasSelection?.())" :busy="busy" @save="draft => void runExportToHtml(draft)" @browse="initial => void browseOutputDirectory(initial).then(path => { if (path) exportPickedDirectory = path })" :picked-directory="exportPickedDirectory" @close="closeExportDialog()" />
    <ProjectDialog v-if="projectMode" v-model:form="projectForm" :mode="projectMode" :busy="projectBusy || busy" :cancelling="cancelling" :error="projectError" :progress="cloneProgress" :git-available="gitAvailable" :is-desktop="isDesktop" @browse="browseParent" @submit="submitProject" @cancel="cancelProject" />
    <ProjectStructureDialog v-if="projectStructureOpen" :settings="workspace ? projectSettings : null" :root="workspace?.root ?? null" :busy="settingsBusy" @save-java="saveJavaSettings" @save-scopes="saveScopes" @save-project="saveProjectSettings" @browse="browseStructureDir" @close="projectStructureOpen = false" />
    <SettingsDialog v-if="settingsOpen" ref="settingsDialogRef" :settings="editorSettings" :project-settings="workspace ? projectSettings : null" :project-root="workspace?.root ?? null" :active-path="activePath" :theme="theme" :busy="settingsBusy" :error="settingsError" :initial-section="settingsSectionHint" :gradle-detection="gradleDetection" @save="saveSettings" @save-draft="saveSettingsDraft" @save-project="saveProjectSettings" @saveVcsLog="saveVcsLog" @save-build-tools="saveBuildTools" :module-name="workspace?.name ?? ''" @saveScopes="saveScopes" @saveTodoPatterns="saveTodoPatterns" @saveFileAssociations="saveFileAssociations" :commit-message-settings="commitMessageSettings" :general="generalSettings" @save-general="saveGeneralSettings" @save-commit-message="saveCommitMessageSettings" @save-templates="saveTemplateSettings" @save-java="saveJavaSettings" @theme="changeTheme" @pick-background="void chooseBackgroundImage()" @clear-background="void clearBackgroundImage()" @close="settingsOpen = false" />
    <div v-if="leavePrompt" class="modal-backdrop">
      <section class="help-dialog leave-dialog" role="dialog" aria-modal="true" aria-labelledby="leave-title" @keydown="trapFocus">
        <h2 id="leave-title">{{ leavePrompt.title }}</h2><p>以下文件尚未保存；保存失败时不会继续关闭或切换。</p>
        <ul class="unsaved-files"><li v-for="path in leavePrompt.paths" :key="path">{{ path }}</li></ul>
        <div class="leave-actions"><button ref="leaveCancel" class="subtle-button" @click="answerLeave('cancel')">取消</button><button class="subtle-button" @click="answerLeave('discard')">放弃修改并继续</button><button class="primary-button" @click="answerLeave('save')">保存并继续</button></div>
      </section>
    </div>

    <!-- ManageRecentProjectsAction.java (PlatformActions.xml:386): the IDE's
         File → Open Recent → Manage Recent Projects popup. TaoCode's equivalent
         is a centred dialog with the same filtered list + search field + the
         same Delete-key/multi-select remove behaviour as RemoveSelectedProjectsAction. -->
    <div v-if="manageRecentsOpen" class="modal-backdrop" @click.self="closeManageRecents">
      <section class="help-dialog manage-recents-dialog" role="dialog" aria-modal="true" aria-labelledby="manage-recents-title" @keydown.esc="closeManageRecents">
        <header class="manage-recents-head">
          <h2 id="manage-recents-title">Recent Projects</h2>
          <button type="button" class="icon-button" aria-label="关闭" title="关闭" @click="closeManageRecents"><X :size="15" /></button>
        </header>
        <input ref="manageRecentsInput" v-model="manageRecentsQuery" type="search" class="manage-recents-search" placeholder="Search projects" aria-label="Search projects" autocomplete="off" spellcheck="false" @keydown.esc="closeManageRecents" />
        <ul class="manage-recents-list" role="listbox" aria-label="最近项目">
          <li v-for="project in manageRecentsFiltered" :key="project.path" class="manage-recents-row" tabindex="-1" :class="{ 'is-selected': manageRecentsSelection.has(project.path) }" role="option" :aria-selected="manageRecentsSelection.has(project.path)" @click="toggleManageRecentsSelection(project, $event)">
            <FolderOpen :size="14" aria-hidden="true" />
            <span class="manage-recents-name">{{ project.name }}</span>
            <span class="manage-recents-path" :title="project.path">{{ project.path }}</span>
            <button type="button" class="subtle-button" :disabled="working || !project.available" @click.stop="openManageRecentsProject(project)">打开</button>
            <button type="button" class="subtle-button" :disabled="working" @click.stop="confirmForgetManage([project])">移除</button>
          </li>
          <li v-if="!manageRecentsFiltered.length" class="manage-recents-empty">没有匹配的项目。</li>
        </ul>
        <footer class="manage-recents-foot">
          <button type="button" class="subtle-button" :disabled="working || manageRecentsSelection.size === 0" @click="confirmForgetManage(manageRecentsSelectedProjects)">移除所选 {{ manageRecentsSelection.size }} 项</button>
          <button type="button" class="subtle-button" @click="closeManageRecents">关闭</button>
        </footer>
      </section>
    </div>

    <!-- IDEA ShowHistoryAction（LocalHistoryDialog）：按当前文件开的对话框，不占磁贴。 -->
    <div v-if="historyDialog" class="modal-backdrop" @click.self="historyDialog = false">
      <section class="help-dialog local-history-dialog" role="dialog" aria-modal="true" aria-label="本地历史" @keydown.esc.prevent="historyDialog = false">
        <h2>本地历史 <span class="small-muted">{{ activePath }}</span></h2>
        <HistoryPanel :key="`hist:${activePath}:${historyEpoch}`" :path="activePath ?? ''" :ready="isDesktop && Boolean(workspace)" @revert="revertHistory" />
        <div class="dialog-actions"><button class="primary-button" @click="historyDialog = false">关闭</button></div>
      </section>
    </div>
    <div v-if="goLinePrompt" class="modal-backdrop" @click.self="goLinePrompt = false">
      <section class="help-dialog rename-dialog" role="dialog" aria-modal="true" aria-label="转到行" @keydown="trapFocus">
        <h2>转到行</h2>
        <input ref="goLineInput" v-model="goLineValue" class="rename-input" type="text" inputmode="numeric" aria-label="行号或行列" placeholder="行号[:列]" @keydown.enter.prevent="goToLine" @keydown.esc.prevent="goLinePrompt = false" />
        <div class="dialog-actions"><button class="subtle-button" @click="goLinePrompt = false">取消</button><button class="primary-button" :disabled="!goLineValue" @click="goToLine">前往</button></div>
      </section>
    </div>
    <div v-if="conflictPrompt" class="modal-backdrop" @click.self="resolveConflictKeep()">
      <section class="help-dialog leave-dialog conflict-dialog" role="alertdialog" aria-modal="true" aria-labelledby="conflict-title" @keydown="trapFocus">
        <h2 id="conflict-title">保存冲突 · {{ conflictPrompt.path }}</h2>
        <p>磁盘上的文件在你上次读取之后被外部改动过；为避免覆盖对方的修改，保存已被阻止。</p>
        <div class="leave-actions">
          <button class="subtle-button" :disabled="Boolean(conflictDiff)" @click="void showConflictDiff()">{{ conflictDiff ? '已加载差异' : '查看差异' }}</button>
          <button class="subtle-button" @click="resolveConflictKeep()">保留当前修改</button>
          <button class="primary-button" :disabled="!isDesktop" @click="resolveConflictReload()">重新载入磁盘版本</button>
        </div>
        <div v-if="conflictDiff" class="conflict-diff">
          <DiffView :path="conflictPrompt.path" subtitle="磁盘版本 ↔ 当前缓冲（未保存）" :rows="conflictDiff.rows" :unified="conflictDiff.unified" />
        </div>
      </section>
    </div>
    <div v-if="encodingPrompt && active" class="modal-backdrop" @click.self="encodingPrompt = null">
      <section class="help-dialog rename-dialog" role="dialog" aria-modal="true" aria-label="文件编码" @keydown="trapFocus">
        <h2>文件编码 · {{ active.path }}</h2>
        <p class="dialog-hint">「重新读取」只改变字节的解释方式，不写盘；「转换保存」保留当前文本并按所选编码改写文件。</p>
        <select ref="encodingSelect" v-model="encodingPrompt.encoding" class="run-config-select encoding-select" aria-label="编码">
          <option v-for="key in encodingKeys" :key="key" :value="key">{{ encodingLabels[key] }}</option>
        </select>
        <label class="encoding-bom"><input v-model="encodingPrompt.bom" type="checkbox" :disabled="encodingPrompt.encoding === 'gbk' || encodingPrompt.encoding === 'cp1252' || encodingPrompt.encoding === 'system'" />写入字节顺序标记（BOM）</label>
        <div class="dialog-actions">
          <button class="subtle-button" @click="encodingPrompt = null">取消</button>
          <button class="subtle-button" :disabled="!isDesktop || active.dirty" :title="active.dirty ? '有未保存修改，先保存或撤销' : '用该编码重新读取磁盘字节'" @click="void reloadWithEncoding()">重新读取</button>
          <button class="primary-button" :disabled="!isDesktop" @click="applyEncodingChoice">转换保存</button>
        </div>
      </section>
    </div>
    <div v-if="clipboardDiff" class="modal-backdrop" @click.self="clipboardDiff = null">
      <section class="help-dialog diff-clipboard-dialog" role="dialog" aria-modal="true" aria-label="与剪贴板比较" @keydown="trapFocus">
        <DiffView :path="clipboardDiff.path" subtitle="当前文件 ↔ 剪贴板" :rows="clipboardDiff.rows" :unified="clipboardDiff.unified" closable @close="clipboardDiff = null" />
      </section>
    </div>
    <Teleport v-if="quickDoc" to="body">
      <div class="quickdoc-popup" :style="{ left: `${Math.min(quickDoc.x, viewport.width - 480)}px`, top: `${Math.min(quickDoc.y + 4, viewport.height - 320)}px` }" @pointerdown.stop>
        <div class="quickdoc-header"><span>快速文档</span><button class="icon-button" aria-label="关闭" @click="closeQuickDoc"><X :size="14" /></button></div>
        <pre class="quickdoc-body">{{ quickDoc.contents }}</pre>
      </div>
    </Teleport>
    <!-- Alt+F1 的目标列表（IDEA SelectInAction.java:62-72 `popup.showInBestPositionFor`）。 -->
    <Teleport v-if="anchorMenu" to="body"><ToolWindowAnchorMenu :anchor="anchorMenuAnchor" :x="anchorMenu.x" :y="anchorMenu.y" @move="moveAnchorTo($event)" @close="closeAnchorMenu()" /></Teleport>
    <Teleport v-if="selectInOpen" to="body"><SelectInPopup :rows="selectInRows" :x="selectInAt?.x" :y="selectInAt?.y" @pick="pickSelectIn($event)" @close="closeSelectIn()" /></Teleport>    <Teleport v-if="editorPopup" to="body"><EditorPopupMenu :rows="editorPopupRows" :x="editorPopup.x" :y="editorPopup.y" @pick="pickEditorPopup($event)" @close="closeEditorPopup()" /></Teleport>
    <!-- Signature help popup: IDEA's parameter info panel with overload navigation -->
    <Teleport v-if="signaturePopup" to="body">
      <div class="signature-popup" :style="{ left: `${Math.min(signaturePopup.x, viewport.width - 500)}px`, top: `${Math.min(signaturePopup.y + 4, viewport.height - 200)}px` }" @pointerdown.stop @keydown.up.prevent="navigateSignature(-1)" @keydown.down.prevent="navigateSignature(1)" @keydown.esc.prevent="closeSignaturePopup()" tabindex="-1">
        <div class="signature-header">
          <span class="signature-overload">{{ signaturePopup.activeIndex + 1 }}/{{ signaturePopup.signatures.length }}</span>
          <div class="signature-nav">
            <button class="icon-button" :disabled="signaturePopup.activeIndex === 0" aria-label="上一个重载" @click="navigateSignature(-1)"><ChevronDown :size="12" style="transform: rotate(180deg)" /></button>
            <button class="icon-button" :disabled="signaturePopup.activeIndex >= signaturePopup.signatures.length - 1" aria-label="下一个重载" @click="navigateSignature(1)"><ChevronDown :size="12" /></button>
          </div>
          <button class="icon-button" aria-label="关闭参数信息" @click="closeSignaturePopup()"><X :size="14" /></button>
        </div>
        <div class="signature-body">
          <code class="signature-label">{{ signaturePopup.signatures[signaturePopup.activeIndex]?.label }}</code>
          <p v-if="signaturePopup.signatures[signaturePopup.activeIndex]?.documentation" class="signature-doc">{{ signaturePopup.signatures[signaturePopup.activeIndex]?.documentation }}</p>
        </div>
      </div>
    </Teleport>
    <div v-if="recentPrompt" class="modal-backdrop" @click.self="recentPrompt = false">
    <MacrosDialog v-if="macrosDialogOpen" :macros="macros" :playing="playing" @play="playMacro(namedMacros.find(m => m.name === $event.name) ?? macros.find(m => m.name === $event.name) ?? null)" @remove="deleteMacro($event.name)" @rename="renameMacro($event.from, $event.to)" @remove-step="deleteMacroStep($event.name, $event.index)" @close="macrosDialogOpen = false" />
    <AboutDialog v-if="aboutOpen" :info="aboutInfo" @close="aboutOpen = false" />
    <SpecialPathsDialog v-if="specialPathsOpen" :paths="specialPaths" @pick="openSpecialPath($event.path)" @close="specialPathsOpen = false" />
    <PasteHistoryDialog v-if="pasteHistoryOpen" :entries="pasteHistoryEntries" @pick="pickPasteHistoryEntry($event.index)" @remove="removePasteHistoryEntry($event.index)" @close="pasteHistoryOpen = false" />
      <section class="command-palette" role="dialog" aria-modal="true" aria-label="最近文件" @keydown="trapFocus"><div class="palette-input"><FileCode2 :size="18" /><input ref="recentInput" v-model="recentQuery" placeholder="最近打开的文件…（回车打开第一个）" aria-label="最近文件" @keydown.enter="recentFiltered[0] && openRecent(recentFiltered[0]!)" /><button class="icon-button" aria-label="关闭最近文件" @click="recentPrompt = false"><X :size="16" /></button></div><div class="palette-results"><button v-for="path in recentFiltered" :key="path" @click="openRecent(path)"><FileCode2 :size="15" /><span>{{ path }}</span><ArrowRight :size="14" /></button><p v-if="!recentFiltered.length" class="palette-empty">暂无最近文件记录。</p></div></section>
    </div>
    <div v-if="treeMenu" class="tree-menu-backdrop" @pointerdown="treeMenu = null; treeSubmenu = null" @contextmenu.prevent="treeMenu = null; treeSubmenu = null">
      <div class="tree-menu" :style="{ left: `${Math.min(treeMenu.x, viewport.width - 216)}px`, top: `${Math.min(treeMenu.y, viewport.height - 330)}px` }" @pointerdown.stop>
        <!-- IDEA ProjectViewPopupMenu order: WeighingNewGroup, AssociateWithFileType |
             CutCopyPasteGroup, EditSource | FindUsages, FindInPath, ReplaceInPath |
             RenameElement | ModifyGroup ($Delete) | SplitRevealGroup, VersionControlsGroup,
             SynchronizeCurrentFile. -->
        <button class="has-sub" @click="treeSubmenu = treeSubmenu === 'new' ? null : 'new'">新建 ▸</button>
        <template v-if="treeSubmenu === 'new'">
          <button class="sub-item" @click="beginCreate('createFile')">文件…</button>
          <button class="sub-item" @click="beginCreate('createDir')">目录…</button>
        </template>
        <template v-if="treeMenu.entry.kind === 'file'"><button v-if="canLinkGradleProject(treeMenu.entry.path, gradleLinkedProjects)" title="链接由这个文件描述的 Gradle 项目" @click="linkGradleProject(treeMenu.entry.path); treeMenu = null">链接 Gradle 项目</button>
          <button class="has-sub" @click="treeSubmenu = treeSubmenu === 'filetype' ? null : 'filetype'">关联文件类型 ▸</button>
          <template v-if="treeSubmenu === 'filetype'">
            <button v-for="[choice, label] in languageChoices" :key="choice" class="sub-item" @click="associateFileType(treeMenu.entry.path, choice)">{{ label }}</button>
            <button class="sub-item" @click="associateFileType(treeMenu.entry.path, 'auto')">自动（按扩展名）</button>
          </template>
        </template>
        <div class="menu-rule" />
        <button :disabled="!treeMenu.entry.path" @click="cutTreeEntry()">剪切</button>
        <button :disabled="!treeMenu.entry.path" @click="copyTreeEntry()">复制</button>
        <button @click="copyPath()">复制路径</button>
        <button :disabled="!fileClipboard" @click="pasteFromClipboard()">粘贴</button>
        <div class="menu-rule" />
        <button v-if="treeMenu.entry.kind === 'file'" @click="openFile(treeMenu.entry.path); treeMenu = null; treeSubmenu = null">打开</button>
        <div class="menu-rule" />
        <button v-if="treeMenu.entry.kind === 'file'" :disabled="!lspReady" @click="findUsagesOf(treeMenu.entry.path)">查找用法…</button>
        <button @click="treeMenu = null; treeSubmenu = null; explorer = true; leftView = 'search'">在路径中查找…</button>
        <button @click="treeMenu = null; treeSubmenu = null; openReplaceInPath()">在路径中替换…（Replace in Path）</button>
        <!-- 上游把 `AnalyzeMenu` 挂在 ProjectViewPopupMenu 的 `ReplaceInPath` 之后
             （`JavaActions.xml:61-66`），所以这一格紧跟在「在路径中替换…」下面。 -->
        <button class="has-sub" @click="treeSubmenu = treeSubmenu === 'analyze' ? null : 'analyze'">分析 ▸</button>
        <template v-if="treeSubmenu === 'analyze'">
          <template v-for="row in analyzeMenuRows" :key="row.id">
            <div v-if="row.rule" class="menu-rule" role="separator" />
            <button v-else class="sub-item" :disabled="!rowEnabled(row)" :title="row.keys" @click="pickMenuRow(row); treeMenu = null; treeSubmenu = null">{{ rowTitle(row) }}</button>
          </template>
        </template>
        <div class="menu-rule" />
        <button :disabled="!treeMenu.entry.path" @click="beginRename()">重命名…</button>
        <div class="menu-rule" />
        <button class="menu-danger" :disabled="!treeMenu.entry.path" @click="beginDelete()">删除…</button>
        <div class="menu-rule" />
        <button v-if="isDesktop && treeMenu.entry.kind === 'file'" @click="showFileProperties()">{{ findTab(treeMenu.entry.path)?.readOnly ? '去掉只读属性' : '设为只读' }}</button>
        <button v-if="isDesktop" :disabled="!workspace" @click="openInTerminal()">在终端中打开</button>
        <button v-if="isDesktop" @click="revealInExplorer()">在资源管理器中显示</button>
        <div class="menu-rule" />
        <button @click="treeMenu = null; refreshTree()">刷新目录</button>
      </div>
    </div>
    <div v-if="tabMenu" class="tree-menu-backdrop" @pointerdown="tabMenu = null" @contextmenu.prevent="tabMenu = null">
      <div class="tree-menu" :style="{ left: `${Math.min(tabMenu.x, viewport.width - 210)}px`, top: `${Math.min(tabMenu.y, viewport.height - 260)}px` }" @pointerdown.stop>
        <template v-for="menu in [tabMenu]" :key="menu.path">
          <!-- IDEA's EditorTabPopupMenu order: Close group | Copy Paths | split rows |
               Pin / Keep / Configure. -->
          <button @click="const tab = findTab(menu.path); if (tab) void closeTabIn(menu.pane, tab); tabMenu = null">关闭</button>
          <button :disabled="groups[menu.pane].tabs.length < 2" @click="const tab = findTab(menu.path); if (tab) void closeOtherTabsIn(menu.pane, tab)">关闭其他标签页</button>
          <button :disabled="!hasTabsToRight(menu.pane, menu.path)" @click="const tab = findTab(menu.path); if (tab) void closeTabsToRightIn(menu.pane, tab)">关闭右侧标签页</button>
          <button :disabled="!hasTabsToLeft(menu.pane, menu.path)" @click="const tab = findTab(menu.path); if (tab) void closeTabsToLeftIn(menu.pane, tab)">关闭左侧标签页</button>
          <button :disabled="!groups[menu.pane].tabs.some(tab => !tab.pinned && tab.path !== menu.path)" @click="void closeUnpinnedTabsIn(menu.pane)">关闭所有未固定标签页</button>
          <button @click="void closeAllTabsIn(menu.pane)">全部关闭</button>
          <div class="menu-rule" />
          <button @click="const tab = findTab(menu.path); if (tab) copyPathOfTab(tab); tabMenu = null">复制路径</button>
          <button v-if="isDesktop" @click="toggleReadOnly(menu.path)">切换只读属性</button>
          <!-- AssociateWithFileTypeAction + FilePropertiesGroup rows for this tab. -->
          <template v-if="workspace">
            <button v-for="[choice, label] in languageChoices" :key="`filetype-${choice}`" @click="associateFileType(menu.path, choice)">关联文件类型：{{ label }}</button>
            <button @click="associateFileType(menu.path, 'auto')">恢复按扩展名识别</button>
          </template>
          <!-- FilePropertiesGroup > ChangeLineSeparators acts on the selected tab. -->
          <template v-if="isDesktop && findTab(menu.path)">
            <button @click="convertLineSeparators('crlf', findTab(menu.path))">转换为 Windows (CRLF) 行尾</button>
            <button @click="convertLineSeparators('lf', findTab(menu.path))">转换为 Unix and macOS (LF) 行尾</button>
          </template>
          <div class="menu-rule" />
          <!-- IDEA EditorTabPopupMenu (PlatformActions.xml:907-915) alternates
               Split Right / Split-and-Move Right / Split Down / Split-and-Move
               Down, then the opposite-group pair and the unsplit pair. -->
          <button @click="splitFromTabMenu(menu.pane, menu.path, 'horizontal')">向右拆分（Split Right）</button>
          <button @click="const tab = findTab(menu.path); if (tab) { focusPane(menu.pane); moveTabToOtherPane(menu.pane, tab, 'horizontal') }; tabMenu = null">拆分并移动到右侧（Split and Move Right）</button>
          <button @click="splitFromTabMenu(menu.pane, menu.path, 'vertical')">向下拆分（Split Down）</button>
          <button @click="const tab = findTab(menu.path); if (tab) { focusPane(menu.pane); moveTabToOtherPane(menu.pane, tab, 'vertical') }; tabMenu = null">拆分并移动到下方（Split and Move Down）</button>
          <button @click="const tab = findTab(menu.path); if (tab) { focusPane(menu.pane); moveTabToOtherPane(menu.pane, tab, splitModel.orientation === 'vertical' ? 'vertical' : 'horizontal') }; tabMenu = null">移动到另一侧编辑器组</button>
          <button @click="openInOppositeGroup(menu.path); tabMenu = null">在另一侧编辑器组中打开</button>
          <button :disabled="splitModel.orientation === 'none'" @click="changeSplitOrientation(); tabMenu = null">更改拆分方向</button>
          <button :disabled="splitModel.orientation === 'none'" @click="unsplit(); tabMenu = null">取消拆分</button>
          <button :disabled="splitModel.orientation === 'none'" @click="unsplitAll(); tabMenu = null">取消所有拆分</button>
          <div class="menu-rule" />
          <button @click="const tab = findTab(menu.path); if (tab) togglePinTab(menu.pane, tab); tabMenu = null">{{ findTab(menu.path)?.pinned ? '取消固定' : '固定标签页' }}</button>
          <button :disabled="!findTab(menu.path)?.preview" @click="const tab = findTab(menu.path); if (tab) keepTabOpen(tab); tabMenu = null">保持打开</button>
          <button @click="tabMenu = null; void openSettings('editor.preferences.tabs')">配置编辑器标签页…</button>
        </template>
      </div>
    </div>
    <div v-if="nameDialog" class="modal-backdrop" @click.self="nameDialog = null">
      <section class="help-dialog rename-dialog" role="dialog" aria-modal="true" :aria-label="nameDialogTitle" @keydown="trapFocus">
        <h2>{{ nameDialogTitle }}</h2>
        <p v-if="!isLayoutDialog" class="rename-target"><code>{{ nameDialog.dir || (workspace?.name ?? '.') }}</code> /</p>
        <input ref="nameInput" v-model="nameDialog.value" class="rename-input" aria-label="名称" spellcheck="false" @keydown.enter.prevent="applyNameDialog" @keydown.esc.prevent="nameDialog = null" />
        <select v-if="nameDialog.mode === 'createFile'" v-model="nameDialog.template" class="rename-input" style="margin-top: 8px;" aria-label="文件模板">
          <option value="">空文件</option>
          <option value="java-class">Java 类</option>
          <option value="java-interface">Java 接口</option>
          <option value="java-enum">Java 枚举</option>
          <option value="java-record">Java 记录</option>
          <option value="java-annotation">Java 注解</option>
          <option value="kotlin-class">Kotlin 类</option>
          <option value="kotlin-object">Kotlin 对象</option>
          <option value="kotlin-interface">Kotlin 接口</option>
          <option value="kotlin-data">Kotlin 数据类</option>
          <option value="typescript-class">TypeScript 类</option>
          <option value="typescript-interface">TypeScript 接口</option>
          <option value="typescript-enum">TypeScript 枚举</option>
          <option value="vue-component">Vue 组件</option>
          <option value="react-component">React 组件</option>
          <option value="html-file">HTML 文件</option>
          <option value="markdown-file">Markdown 文件</option>
        </select>
        <div class="dialog-actions"><button class="subtle-button" @click="nameDialog = null">取消</button><button class="primary-button" :disabled="!nameDialog.value.trim()" @click="applyNameDialog">确定</button></div>
      </section>
    </div>
    <div v-if="deleteTarget" class="modal-backdrop" @click.self="deleteTarget = null">
      <section class="help-dialog leave-dialog" role="alertdialog" aria-modal="true" aria-label="删除确认" @keydown="trapFocus">
        <!-- universal.file.chooser.action.delete.confirm: Delete "X"? /
             Delete "X" and all of its contents? -->
        <h2>删除 “{{ deleteTarget.path }}”{{ deleteTarget.kind === 'directory' ? ' 及其全部内容？' : '？' }}</h2>
        <p>{{ deleteTarget.kind === 'directory' ? '目录及其所有子项都会从磁盘移除，无法在 TaoCode 内撤销。' : (generalSettings.deleteToBin ? '该文件会移到系统回收站；如需找回也可用「本地历史」回滚旧版本。' : '该文件将从磁盘直接删除且无法撤销；如需找回只能用「本地历史」回滚旧版本。') }}</p>
        <!-- Safe Delete: IDEA lists the places that still reference the file so the
             decision is made with the callers in view. -->
        <div v-if="deleteTarget.kind === 'file'" class="delete-usages">
          <p v-if="deleteUsagesError" class="delete-usages-error">用法扫描失败：{{ deleteUsagesError }}</p>
          <template v-else-if="deleteUsages">
            <!-- file.usages is a workspace-wide TEXT scan, not a language-level Find
                 Usages: it has no PSI and no scope resolution. It is shown either way
                 because an empty list does not mean "no references" (binary files and
                 anything over the size cap are skipped) and a hit can be a namesake. -->
            <p class="delete-usages-scope">
              以下是「全工作区文本扫描」的结果，不是精确的引用分析：可能包含同名误报，也可能漏掉二进制文件与超大文件中的引用。
              <span v-if="deleteUsages.truncated" class="delete-usages-more">本次扫描已截断。</span>
            </p>
            <p v-if="!deleteUsages.hits.length" class="delete-usages-empty">已扫描 {{ deleteUsages.scanned }} 个文件，没有发现仍然引用「{{ deleteUsages.symbol }}」的位置——这不代表没有引用。</p>
            <template v-else>
              <p class="delete-usages-head">有 {{ deleteUsages.hits.length }} 处仍然引用「{{ deleteUsages.symbol }}」<span v-if="deleteUsages.truncated" class="delete-usages-more">（结果已截断）</span>：</p>
              <ul class="delete-usages-list">
                <li v-for="(hit, index) in deleteUsages.hits.slice(0, 12)" :key="`${hit.path}:${hit.line}:${hit.column}:${index}`">
                  <button class="delete-usage-row" :title="hit.preview" @click="deleteTarget = null; void openFile(hit.path)">{{ hit.path }}:{{ hit.line }}:{{ hit.column }}</button>
                </li>
              </ul>
            </template>
          </template>
          <p v-else class="delete-usages-empty">正在扫描引用…</p>
        </div>
                <div class="leave-actions"><button ref="leaveCancel" class="subtle-button" @click="deleteTarget = null">取消</button><button class="primary-button menu-danger-solid" @click="confirmDelete">{{ generalSettings.deleteToBin ? '移到回收站' : '删除' }}</button></div>
      </section>
    </div>
    <!-- EXT-01: plugins contribute commands and templates only; enabling one writes or
         removes a `.disabled` marker beside its manifest. -->
    <RunConfigurationsDialog v-if="runConfigsOpen" :configs="runConfigs" :draft="runConfigDraft" :busy="working" @save="saveRunConfigFromDialog" @remove="removeRunConfigFromDialog" @select="loadRunConfigDraft" @close="runConfigsOpen = false" />
    <PluginDialog v-if="pluginOpen" :plugins="pluginList" :installing="installingPlugins" :busy="pluginBusy" :is-desktop="isDesktop"
      @toggle="togglePluginById" @set-enabled="setPluginsEnabled" @install="installPlugin" @install-directory="installPluginDirectory" @uninstall="uninstallPlugin" @refresh="refreshPlugins" @close="pluginOpen = false" />
    <div v-if="fileHistoryOpen" class="modal-backdrop" @click.self="fileHistoryOpen = false">
      <section class="help-dialog file-history-dialog" role="dialog" aria-modal="true" aria-labelledby="file-history-title" @keydown="trapFocus">
        <h2 id="file-history-title">文件历史 · {{ fileHistory?.path }}</h2>
        <div class="file-history-body">
          <ul class="file-history-list" role="list">
            <li v-for="commit in fileHistory?.commits ?? []" :key="commit.hash">
              <button class="file-history-row" :class="{ selected: fileHistorySelected === commit.hash }" :disabled="fileHistoryBusy" @click="showCommit(commit.hash)">
                <span class="fh-hash">{{ commit.shortHash }}</span>
                <span class="fh-subject" :title="commit.subject">{{ commit.subject }}</span>
                <span class="fh-meta">{{ commit.author }} · {{ commit.date.slice(0, 10) }}</span>
                <span v-if="commit.paths.some(item => item.includes('(←'))" class="fh-rename">重命名</span>
              </button>
            </li>
            <li v-if="!fileHistory?.commits.length" class="plugin-empty">这个文件还没有提交历史。</li>
          </ul>
          <div class="file-history-detail">
            <p v-if="fileHistoryBusy" class="plugin-empty">读取中…</p>
            <template v-else-if="fileHistoryCommit">
              <p class="fh-detail-head">改动内容（{{ fileHistoryCommit.revision.slice(0, 8) }}）</p>
              <pre class="fh-patch">{{ fileHistoryCommit.patch || '（这次提交没有文件改动）' }}</pre>
            </template>
            <p v-else class="plugin-empty">选择一个提交查看它改了什么。</p>
          </div>
        </div>
        <div class="dialog-actions"><button class="subtle-button" @click="fileHistoryOpen = false">关闭</button></div>
      </section>
    </div>
    <div v-if="worktreeOpen" class="modal-backdrop" @click.self="worktreeOpen = false">
      <section class="help-dialog worktree-dialog" role="dialog" aria-modal="true" aria-labelledby="worktree-title" @keydown="trapFocus">
        <h2 id="worktree-title">Git 工作树</h2>
        <ul class="worktree-list">
          <li v-for="tree in worktrees" :key="tree.path" class="worktree-row">
            <span class="worktree-path" :title="tree.path">{{ tree.path }}</span>
            <span class="worktree-branch">{{ tree.branch }}</span>
            <span v-if="tree.locked" class="worktree-flag">已锁定</span>
            <span v-if="tree.prunable" class="worktree-flag">可清理</span>
            <button class="icon-button" :disabled="worktreeBusy || tree.bare" title="移除该工作树" aria-label="移除该工作树" @click="removeWorktree(tree.path)"><Trash2 :size="14" /></button>
          </li>
        </ul>
        <div class="worktree-add">
          <input v-model="worktreePath" placeholder="新工作树的绝对路径（必须在仓库之外）" aria-label="工作树路径" />
          <input v-model="worktreeBranch" placeholder="分支名，留空则按路径名创建" aria-label="分支名" />
          <label class="worktree-new"><input v-model="worktreeNewBranch" type="checkbox" />新建分支</label>
          <button class="subtle-button" :disabled="worktreeBusy || !worktreePath.trim()" @click="addWorktree">添加</button>
        </div>
        <div class="dialog-actions"><button class="subtle-button" @click="worktreeOpen = false">关闭</button></div>
      </section>
    </div>
    <div v-if="submoduleOpen" class="modal-backdrop" @click.self="submoduleOpen = false">
      <section class="help-dialog submodule-dialog" role="dialog" aria-modal="true" aria-labelledby="submodule-title" @keydown="trapFocus">
        <h2 id="submodule-title">Git 子模块</h2>
        <p v-if="!submodules.length" class="plugin-empty">这个仓库没有子模块。</p>
        <ul v-else class="submodule-list">
          <li v-for="module in submodules" :key="module.path" class="submodule-row">
            <span class="submodule-status" :class="{ dirty: module.status !== ' ' }">{{ module.status === ' ' ? '正常' : module.status.trim() || '有改动' }}</span>
            <span class="submodule-path" :title="module.path">{{ module.path }}</span>
            <span class="submodule-commit">{{ module.commit.slice(0, 8) }}</span>
          </li>
        </ul>
        <div class="dialog-actions"><button class="subtle-button" :disabled="submoduleBusy" @click="updateSubmodules">{{ submoduleBusy ? '更新中…' : '更新子模块' }}</button><button class="subtle-button" @click="submoduleOpen = false">关闭</button></div>
      </section>
    </div>
    <div v-if="restorePrompt" class="modal-backdrop">
      <section class="help-dialog leave-dialog" role="alertdialog" aria-modal="true" aria-labelledby="restore-title" @keydown="trapFocus">
        <h2 id="restore-title">恢复上次会话？</h2>
        <p>检测到 {{ restorePrompt.drafts }} 个文件有未保存的修改（上次可能未正常退出）。恢复后这些草稿会以未保存状态打开，不会写入磁盘。</p>
        <ul class="unsaved-files"><li v-for="tab in restorePrompt.state.tabs.filter(item => item.draft !== undefined)" :key="tab.path">{{ tab.path }}</li></ul>
        <div class="leave-actions"><button ref="leaveCancel" class="subtle-button" @click="discardSession">放弃草稿</button><button class="primary-button" @click="restoreSession(restorePrompt)">恢复会话</button></div>
      </section>
    </div>
    <div v-if="renamePrompt" class="modal-backdrop" @click.self="renamePrompt = null">
      <section class="help-dialog rename-dialog" role="dialog" aria-modal="true" aria-labelledby="rename-title" @keydown="trapFocus">
        <h2 id="rename-title">重命名符号</h2>
        <p class="rename-target">{{ renamePrompt.path }} · 第 {{ renamePrompt.line + 1 }} 行 · 当前：<code>{{ renamePrompt.current }}</code></p>
        <input ref="renameInput" v-model="renameValue" class="rename-input" aria-label="新的标识符" :aria-invalid="Boolean(invalidRenameName)" :placeholder="renamePrompt.current || '新的名称'" spellcheck="false" @keydown.enter.prevent="submitRename" @keydown.esc.prevent="renamePrompt = null" />
        <p v-if="invalidRenameName" class="rename-note" style="color: var(--error)">{{ invalidRenameName }}</p>
        <p class="rename-note">所有引用该符号的文件都会按语言服务给出的 WorkspaceEdit 写入磁盘。</p>
        <div class="dialog-actions"><button class="subtle-button" @click="renamePrompt = null">取消</button><button class="primary-button" :disabled="!renameValue.trim() || Boolean(invalidRenameName)" @click="submitRename">应用重命名</button></div>
      </section>
    </div>

    <div v-if="palette" class="modal-backdrop" @click.self="palette = false">
      <section class="command-palette" role="dialog" aria-modal="true" aria-label="转到文件" @keydown="trapFocus"><div class="palette-input"><Search :size="18" /><input ref="queryInput" v-model="query" placeholder="转到文件…" aria-label="搜索已打开或根目录文件" @keydown.down.prevent="paletteIndex = (paletteIndex + 1) % Math.max(1, candidates.length)" @keydown.up.prevent="paletteIndex = (paletteIndex + candidates.length - 1) % Math.max(1, candidates.length)" @keydown.enter="candidates[paletteIndex] && openFile(candidates[paletteIndex]!)" /><button class="icon-button" aria-label="关闭文件选择器" @click="palette = false"><X :size="16" /></button></div><div class="palette-scope">已打开文件与工作区根目录文件 · 子目录请在左侧展开</div><div class="palette-results"><button v-for="(path, index) in candidates" :key="path" :class="{ highlighted: index === paletteIndex }" @click="openFile(path)"><FileCode2 :size="15" /><span>{{ path }}</span><span v-if="path === activePath" class="small-muted">当前文件</span><ArrowRight :size="14" /></button><p v-if="!candidates.length" class="palette-empty">没有匹配的文件。先打开文件夹或在资源管理器中展开目录。</p></div></section>
    </div>
    <div v-if="mnemonicPrompt" class="modal-backdrop" @click.self="mnemonicPrompt = null">
      <section class="mnemonic-pop" role="dialog" aria-modal="true" aria-label="为书签编号" @keydown="trapFocus">
        <div class="palette-scope">给 {{ mnemonicPrompt.path }}:{{ mnemonicPrompt.line }} 贴一个 0-9 编号 · 直接按数字键，Ctrl+编号 随时跳回</div>
        <div class="mnemonic-grid"><button v-for="digit in digits" :key="digit" :title="mnemonicOwner(digit)" @click="pickMnemonic(digit)"><kbd>{{ digit }}</kbd><span>{{ mnemonicOwner(digit) }}</span></button></div>
        <div class="mnemonic-foot"><button class="subtle-button" @click="toggleBookmark(); mnemonicPrompt = null">不编号，只标记（F11）</button><button class="icon-button" aria-label="关闭编号选择" @click="mnemonicPrompt = null"><X :size="16" /></button></div>
      </section>
    </div>
    <div v-if="surroundPrompt" class="modal-backdrop" @click.self="surroundPrompt = false">
      <section class="command-palette" role="dialog" aria-modal="true" aria-label="用模板包裹" @keydown="trapFocus"><div class="palette-input"><Braces :size="18" /><input ref="surroundInput" v-model="surroundQuery" placeholder="包裹选中代码…（未选中则包裹当前行）" aria-label="选择包裹模板" @keydown.down.prevent="moveSurround(1)" @keydown.up.prevent="moveSurround(-1)" @keydown.enter.prevent="applySurround(surroundChoices[surroundIndex])" /><button class="icon-button" aria-label="关闭包裹选择" @click="surroundPrompt = false"><X :size="16" /></button></div><div class="palette-scope">Surround With · {{ surroundChoices.length }}/{{ surroundTemplates.length }} 个模板 · 回车应用，Ctrl Alt T 随时唤起</div><div class="palette-results"><button v-for="(template, index) in surroundChoices" :key="template.title" :class="{ highlighted: index === surroundIndex }" @click="applySurround(template)"><Braces :size="15" /><span>{{ template.title }}</span><span class="small-muted">{{ template.block ? '整块缩进' : '行内' }}</span><ArrowRight :size="14" /></button><p v-if="!surroundChoices.length" class="palette-empty">没有匹配的包裹模板。</p></div></section>
    </div>
    <!-- Live Template Chooser: lists the templates src/templates.ts offers for the current file -->
    <div v-if="templateChooser" class="modal-backdrop" @click.self="templateChooser = false">
      <section class="command-palette" role="dialog" aria-modal="true" aria-label="实时模板列表" @keydown="trapFocus"><div class="palette-input"><Sparkles :size="18" /><input ref="templateInput" v-model="templateQuery" placeholder="选择实时模板…（输入关键词过滤）" aria-label="搜索模板" @keydown.down.prevent="moveTemplate(1)" @keydown.up.prevent="moveTemplate(-1)" @keydown.enter.prevent="applyTemplate(templateChoices[templateIndex])" /><button class="icon-button" aria-label="关闭模板列表" @click="templateChooser = false"><X :size="16" /></button></div><div class="palette-scope">{{ language }} 可用 Live Templates · {{ templateChoices.length }} 个 · 回车在光标处展开</div><div class="palette-results"><button v-for="(choice, index) in templateChoices" :key="choice.id" :class="{ highlighted: index === templateIndex }" @click="applyTemplate(choice)"><Sparkles :size="15" /><span>{{ choice.template.postfix ? `receiver.${choice.title}` : choice.title }}</span><span class="small-muted">{{ choice.template.description }}</span><span v-if="choice.template.postfix" class="action-group">postfix</span><ArrowRight :size="14" /></button><p v-if="!templateChoices.length" class="palette-empty">当前语言没有可用的模板。可在 设置 → 实时模板 里启用或新建。</p></div></section>
    </div>
    <div v-if="actionSearch" class="modal-backdrop" @click.self="actionSearch = false">
      <section class="command-palette" role="dialog" aria-modal="true" aria-label="查找操作" @keydown="trapFocus"><div class="palette-input"><Search :size="18" /><input ref="actionInput" v-model="actionQuery" placeholder="查找操作…（名称、拼音提示或快捷键）" aria-label="查找操作" @keydown.down.prevent="moveAction(1)" @keydown.up.prevent="moveAction(-1)" @keydown.enter.prevent="runActionResult()" /><button class="icon-button" aria-label="关闭查找操作" @click="actionSearch = false"><X :size="16" /></button></div><div class="palette-scope">全部操作 · {{ actionResults.length }}/{{ actionList.length }} 项 · 回车执行</div><div class="palette-results"><button v-for="(entry, index) in actionResults" :key="entry.id" :class="{ highlighted: index === actionIndex, 'palette-disabled': !rowEnabled(entry) }" @click="runAction(entry)"><Sparkles :size="15" /><span>{{ entry.title }}</span><span class="action-group">{{ entry.group }}</span><kbd v-if="entry.keys">{{ entry.keys }}</kbd><ArrowRight :size="14" /></button><p v-if="!actionResults.length" class="palette-empty">没有匹配的操作。换个词试试，或清空输入框浏览全部命令。</p></div></section>
    </div>
    <SearchEverywhereDialog :open="searchEverywhereOpen" :items="searchEverywhereItems" :on-query="onSearchEverywhereQuery" @close="searchEverywhereOpen = false" />
<div v-if="placesPrompt" class="modal-backdrop" @click.self="placesPrompt = false">
      <section class="command-palette locations-dialog" role="dialog" aria-modal="true" aria-label="最近位置" @keydown="trapFocus"><div class="palette-input"><History :size="18" /><input ref="placesInput" v-model="placesQuery" placeholder="最近位置…（上下键选择，回车跳转）" aria-label="最近位置" @keydown.down.prevent="movePlace(1)" @keydown.up.prevent="movePlace(-1)" @keydown.enter.prevent="placesFiltered[placesIndex] && openPlace(placesFiltered[placesIndex]!)" /><button class="icon-button" aria-label="关闭最近位置" @click="placesPrompt = false"><X :size="16" /></button></div><div class="locations-header"><h2>{{ placesEditedOnly ? '最近更改的位置' : '最近位置' }} <span class="small-muted">({{ placesFiltered.length }})</span></h2><label class="locations-toggle"><input v-model="placesEditedOnly" type="checkbox" />仅显示已编辑的 <kbd>Ctrl E</kbd></label></div><div class="palette-results" role="listbox" aria-label="位置列表"><button v-for="(place, index) in placesFiltered" :key="`${place.kind}:${place.path}:${place.line}`" class="location-row" :class="{ highlighted: index === placesIndex }" role="option" :aria-selected="index === placesIndex" @click="openPlace(place)" @pointerenter="placesIndex = index"><component :is="place.kind === '书签' ? BookmarkIcon : place.kind === '符号' ? ListTree : FileCode2" :size="15" /><span class="location-main"><strong>{{ baseName(place.path) }}<template v-if="place.label !== place.path"> · {{ place.label }}</template></strong><pre v-if="placeSnippet(place).text" class="location-snippet">{{ placeSnippet(place).text }}</pre><span v-else class="location-snippet empty">{{ findTab(place.path) ? '空行' : '文件未打开：无代码预览' }}</span></span><span class="location-path">{{ place.path.split('/').slice(0, -1).join('/') }} · 第 {{ (placeSnippet(place).text ? placeSnippet(place).firstLine : place.line) + 1 }} 行</span></button><p v-if="!placesFiltered.length" class="palette-empty">没有找到最近位置</p></div></section>
    </div>
    <div v-if="symbolPrompt" class="modal-backdrop" @click.self="symbolPrompt = null">
      <section class="command-palette" role="dialog" aria-modal="true" :aria-label="symbolPrompt.mode === 'global' ? '转到符号（全局）' : '文件结构'" @keydown="trapFocus"><div class="palette-input"><Search :size="18" /><input ref="symbolInput" v-model="symbolQuery" :placeholder="symbolPrompt.mode === 'global' ? '转到符号…（全局，输入≥2字）' : '文件结构…（当前文件符号）'" aria-label="符号名称" @input="onSymbolQuery" @keydown.down.prevent="moveSymbol(1)" @keydown.up.prevent="moveSymbol(-1)" @keydown.enter="symbolResults[symbolIndex] && jumpSymbol(symbolResults[symbolIndex]!)" /><button class="icon-button" aria-label="关闭符号选择器" @click="symbolPrompt = null"><X :size="16" /></button></div><div class="palette-scope">{{ symbolPrompt.mode === 'global' ? '全局符号 · 由语言服务提供，需已就绪' : '当前文件符号 · ' + outline.length + ' 项' }}</div><div class="palette-results"><button v-for="(entry, index) in symbolResults" :key="`${entry.path}:${entry.line}:${entry.character}:${index}`" :class="{ highlighted: index === symbolIndex }" @click="jumpSymbol(entry)"><FileCode2 :size="15" /><span>{{ entry.name }}</span><span class="small-muted">{{ entry.path.split('/').pop() }}:{{ entry.line + 1 }}</span><ArrowRight :size="14" /></button><p v-if="!symbolResults.length" class="palette-empty">{{ symbolPrompt.mode === 'global' ? '输入至少两个字符以检索全局符号。' : '当前文件没有符号（或未启用语言服务）。' }}</p></div></section>
    </div>
    <div v-if="actionPrompt" class="modal-backdrop" @click.self="actionPrompt = null">
      <section class="command-palette" role="dialog" aria-modal="true" aria-label="代码操作" @keydown="trapFocus"><div class="palette-scope">代码操作 / 快速修复 · {{ actionPrompt.path }}</div><div class="palette-results"><button v-for="(action, index) in codeActions" :key="`${action.title}:${index}`" :class="{ highlighted: index === 0 }" @click="applyCodeAction(action)"><Sparkles :size="15" /><span>{{ action.title }}</span><span v-if="action.kind" class="small-muted">{{ action.kind }}</span><span v-if="action.command" class="small-muted">由语言服务执行</span><span v-else-if="!action.edits.length" class="small-muted">需解析</span></button></div></section>
    </div>
    <!-- 退出确认：IDEA 的 ConfirmExitDialog（确认 + “不再询问”写回 GeneralSettings.confirmExit） -->
    <div v-if="exitPrompt" class="modal-backdrop" @click.self="resolveExit(false)">
      <section class="help-dialog exit-dialog" role="alertdialog" aria-modal="true" aria-label="退出 TaoCode" @keydown="trapFocus">
        <h2>退出 TaoCode</h2>
        <p>确定要退出吗？未保存的修改会先全部保存。</p>
        <label class="checkbox-row"><input v-model="exitPromptDontAsk" type="checkbox" /><span>不再询问</span></label>
        <div class="leave-actions">
          <button class="subtle-button" @click="resolveExit(false)">取消</button>
          <button class="primary-button" @click="resolveExit(true)">退出</button>
        </div>
      </section>
    </div>
    <!-- TerminateRemoteProcessDialog（:66-71）：终端 canDisconnect=false，对话框只有 终止 / 取消 -->
    <div v-if="terminalClosePrompt" class="modal-backdrop" @click.self="resolveTerminalClose('cancel')">
      <section class="help-dialog exit-dialog" role="alertdialog" aria-modal="true" :aria-label="processClosePromptText(terminalClosePrompt.labels)?.title">
        <h2>{{ processClosePromptText(terminalClosePrompt.labels)?.title }}</h2>
        <p>{{ processClosePromptText(terminalClosePrompt.labels)?.message }}</p>
        <label class="checkbox-row"><input v-model="terminalCloseDontAsk" type="checkbox" /><span>不再询问</span></label>
        <div class="leave-actions">
          <button class="subtle-button" @click="resolveTerminalClose('cancel')">{{ PROCESS_CLOSE_LABELS.cancel }}</button>
          <button class="primary-button" @click="resolveTerminalClose('terminate')">{{ PROCESS_CLOSE_LABELS.terminate }}</button>
        </div>
      </section>
    </div>
    <div v-if="help" class="modal-backdrop" @click.self="help = false"><section class="help-dialog" role="dialog" aria-modal="true" aria-label="关于 TaoCode" @keydown="trapFocus"><button ref="helpClose" class="icon-button help-close" aria-label="关闭说明" @click="help = false"><X :size="18" /></button><h2>TaoCode <span>0.1 · Foundation</span></h2><p>Vue 3 界面 + CodeMirror 编辑器 + C++20 文件核心。<br />Windows 原生宿主复用系统 WebView2，不捆绑 Electron。</p><div class="help-grid"><span>打开文件夹</span><kbd>Ctrl Shift O</kbd><span>全部保存</span><kbd>Ctrl S</kbd><span>转到文件</span><kbd>Ctrl Shift N</kbd><span>转到类</span><kbd>Ctrl N</kbd><span>查找操作</span><kbd>Ctrl Shift A</kbd><span>转到行</span><kbd>Ctrl G</kbd><span>当前文件内查找</span><kbd>Ctrl F</kbd><span>转到定义</span><kbd>Ctrl B</kbd><span>重命名符号</span><kbd>Shift F6</kbd><span>查找用法</span><kbd>Alt F7</kbd><span>智能补全</span><kbd>Ctrl Space</kbd><span>代码操作</span><kbd>Alt Enter</kbd><span>用模板包裹</span><kbd>Ctrl Alt T</kbd><span>格式化（可带选区）</span><kbd>Ctrl Alt L</kbd><span>智能选区</span><kbd>Ctrl W</kbd><span>书签</span><kbd>F11</kbd><span>书签编号 / 跳转</span><kbd>Ctrl F11 · Ctrl 0-9</kbd><span>行断点</span><kbd>Ctrl F8</kbd><span>运行 / 调试配置</span><kbd>Shift F10 · Shift F9</kbd><span>运行 / 调试上下文</span><kbd>Ctrl Shift F10</kbd><span>选择运行/调试配置</span><kbd>Alt Shift F10 · Alt Shift F9</kbd><span>全部保存</span><kbd>Ctrl S</kbd><span>重新运行</span><kbd>Ctrl F5</kbd><span>关闭当前标签页</span><kbd>Ctrl Shift F4</kbd><span>隐藏当前工具窗口</span><kbd>Shift Esc</kbd><span>上一个 / 下一个标签页</span><kbd>Alt ← · Alt →</kbd><span>跳到上一个工具窗口</span><kbd>F12</kbd><span>恢复当前布局</span><kbd>Shift F12</kbd><span>隐藏全部工具窗口</span><kbd>Ctrl Shift F12</kbd><span>最大化编辑器</span><kbd>Ctrl Shift F12</kbd><span>后退 / 前进</span><kbd>Ctrl Alt ← · Ctrl Alt →</kbd></div><div class="help-note">当前已接通项目创建、打开、克隆、设置，桌面端语言服务（诊断、悬停、转到定义/实现/类型、补全、重命名、查找引用、符号大纲、代码操作含 resolve 解析、格式化与选区格式化、签名信息、文档内同符号高亮、智能选区、内联提示）、操作查找（Ctrl+Shift+A）、书签与 0-9 编号跳转、模板包裹（Ctrl+Alt+T）、随项目保存的运行配置、全局查找/替换、本地历史快照与回滚、Git 状态/暂存/提交/改写上次提交/分支/日志/储藏/拉取/推送/变基/摘取/标签/忽略/与分支比较/文件追溯/回滚文件/重置分支/按块暂存、集成终端（ConPTY + xterm，支持目录右键在终端打开）与调试器（DAP：启动/附加/异常断点/线程/监视），测试运行器（ctest/node:test/JUnit 发现、运行、失败重跑、定义跳转），构建控制台错误定位跳转；浏览器预览无语言服务、终端与调试器。尚无 AI Agent / 模型执行。处理记录仅保留当前会话，不是持久审计日志。</div></section></div>
  </div>
</template>
