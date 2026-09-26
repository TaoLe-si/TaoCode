<script setup lang="ts">
import { computed, defineAsyncComponent, nextTick, onBeforeUnmount, onMounted, reactive, ref, watch } from 'vue'
import { AnimatePresence, motion, useReducedMotion } from 'motion-v'
import { ArrowLeft, ArrowRight, Braces, FlaskConical, Bookmark as BookmarkIcon, Bug, Check, ChevronDown, ChevronRight, ChevronsDownUp, ChevronsUpDown, CircleHelp, Code2, Columns2, Crosshair, FileCode2, Files, FolderOpen, FolderTree, GitBranch, GitCommitHorizontal, GitGraph, History, ListChecks, ListTree, Loader2, Lock, Menu, Zap, Moon, PanelBottom, PanelLeftClose, PanelLeftOpen, Pin, Play, Plus, RefreshCw, Square,  Rows3, Save, Search, ShieldCheck, SlidersHorizontal, Sparkles, SquareTerminal, Sun, TerminalSquare, Trash2, Workflow, X } from 'lucide-vue-next'
import FileTree, { type SyntheticNode } from './components/FileTree.vue'
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
import ProjectDialog from './components/ProjectDialog.vue'
import SettingsDialog from './components/SettingsDialog.vue'
import ToolWindowHeader from './components/ToolWindowHeader.vue'
import NoticeList from './components/NoticeList.vue'
import { BridgeError, beginRun, clearLspDiagnostics, cloneProgress, dapBreakpoints, dapSetBreakpoints, dapStart, dapState, dapStep, defaultEditorSettings, defaultJavaProjectSettings, defaultProjectSettings, endRun, encodingKeys, encodingLabels, fsChanges, gitProgress, isDesktop, lspDiagnostics, request, lspEdited, runOutput, runState, termOpened, watchStopped, setLspDiagnostics, setNativeDirty, setNativeTheme, traces, type AppState, type BinaryView, type Bookmark, type DiffRow, type DocumentData, type EditorSettings, type EncodingKey, type Entry, type GitAheadBehind, type GitBlame, type GitBlameLine, type GitChange, type GitFileHistory, type GitShowCommit, type GitStatus, type GitSubmodule, type GitSubmodules, type GitWorktree, type GitWorktrees, type HistoryContent, type HistoryEntry, type JavaProjectSettings, type LspCodeAction, type LspCodeActionResults, type LspDocumentSymbol, type LspFileEdits, type LspFormatResult, type LspHierarchyItem, type LspHierarchyResult, type LspHoverResult, type LspLocation, type LspOpenResult, type LspRange, type LspReferencesResult, type LspRenameResult, type LspSignatureHelpResult, type LspSymbolsResult, type LspTextEdit, type ProjectForm, type ProjectSettings, type PluginInfo, type PluginList, type ProcessMemory, type RecentProject, type RunConfig, type RunStartParams, type SaveResult, type TemplateSettings, type TodoPattern, type UsageResult, type Workspace } from './bridge'
import { clampPanelSize, initialTheme, themeStorageKey, type Theme } from './appearance'
import { parseAnyIssue } from './buildOutput'
import { COMMIT_MESSAGE_INSPECTION_STORAGE_KEY, resolveInspectionSettings, type CommitMessageInspectionSettings } from './commitMessageInspection'
import { rankCommands } from './commandSearch'
import { bookmarkOwner, nextBookmark as nextInList, placeBookmark, removeBookmark, sortedBookmarks } from './bookmarks'
import { createSplitModel, splitTabOutIn, unsplitModel, unsplitAllModel, closeTabInPane, dropTabOnGroup, tabClosingOrder, type Pane, type SplitModel } from './editorGroups'
import { locationSnippet } from './recentLocations'
import { effectiveTemplates, type Template } from './templates'
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
import { canCloseAllContents, canCloseOtherContents, canHideAllToolWindows, hasVisibleToolWindow, hideAllToolWindowsTitle, isCloseableToolTab, tabsCloseAllWouldRemove, tabsCloseOtherWouldRemove, type CloseableToolTabId, type ToolTabPresence, type ToolWindowChrome } from './toolTabs'
import { RESIZE_CHARS, resizeDirectionEnabled, stretchDelta, type ResizeDirection } from './toolWindowResize'
import { canToggleContentUiType, isTabbedContentUi, resolveContentUiType, toggledContentUiType, type ToolWindowContentUiType } from './toolWindowContentUi'

const CodeEditor = defineAsyncComponent(() => import('./components/CodeEditor.vue'))
const BinaryViewer = defineAsyncComponent(() => import('./components/BinaryViewer.vue'))
const reducedMotion = useReducedMotion()
const popupEnter = computed(() => reducedMotion.value ? { opacity: 1 } : { opacity: 0, y: -4, scale: 0.985 })
const popupExit = computed(() => ({ opacity: 0, y: reducedMotion.value ? 0 : -3, transition: { duration: reducedMotion.value ? 0 : 0.1 } }))
const popupTransition = computed(() => ({ duration: reducedMotion.value ? 0 : 0.16, ease: [0.16, 1, 0.3, 1] as const }))
interface Tab extends DocumentData { saving: boolean; dirty: boolean; line: number; column: number; lspRunning?: boolean; lspConfigured?: boolean; pinned?: boolean; preview?: boolean }
interface EditorHandle { text(): string; markSaved(): void; setDraft(value: string): void; command(name: string): boolean; expandAtCursor(text: string): boolean; hasSelection(): boolean; setReadOnly(value: boolean): void; surroundWith(template: SurroundTemplate): void; getCursor(): { line: number; ch: number }; getCursorCoords(): { left: number; top: number; bottom: number } | null }
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
// Bumped when a buffer must be rebuilt from its text (line-separator conversion).
const bufferEpoch = ref(0)
const explorer = ref(window.innerWidth >= 700)
const leftView = ref<'files' | 'git' | 'vcslog' | 'search' | 'todo' | 'outline' | 'bookmarks' | 'debug' | 'history' | 'tests'>('files')
const activity = ref(false)
const bottom = ref(false)
// IDEA's ToolWindowAnchor: every tool window remembers the stripe it lives on
// (left/right; top is unused by TaoCode's panels) and the layout renders one
// column per side. `showView` reads the anchor to decide which dock opens.
// A stored 'bottom' is dropped: nothing sets it, and a docked bottom window would have no header to
// move it back with (the bottom area is the output/problems/terminal panel, not a tool-window dock).
type ToolWindowId = typeof leftView.value
type Anchor = 'left' | 'right' | 'bottom'
const toolAnchors = reactive<Record<ToolWindowId, Anchor>>({
  files: 'left', git: 'left', vcslog: 'left', search: 'left', todo: 'left',
  outline: 'left', bookmarks: 'left', debug: 'left', history: 'left', tests: 'left',
})
try {
  const saved = JSON.parse(localStorage.getItem('taocode.toolAnchors') ?? '{}') as Partial<Record<ToolWindowId, Anchor>>
  for (const key of Object.keys(toolAnchors) as ToolWindowId[])
    if (saved[key] === 'left' || saved[key] === 'right') toolAnchors[key] = saved[key]!
} catch { /* corrupted state falls back to defaults */ }
function setToolAnchor(id: ToolWindowId, anchor: Anchor) {
  toolAnchors[id] = anchor
  try { localStorage.setItem('taocode.toolAnchors', JSON.stringify(toolAnchors)) } catch { /* storage unavailable: kept for this session */ }
  // Moving to a side the panel is not shown on would leave it invisible.
  explorer.value = anchor !== 'bottom' ? true : explorer.value
}
const activeAnchor = computed<Anchor>(() => toolAnchors[leftView.value] ?? 'left')

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
// IDEA tool-window titles (UIBundle tool.window.name.*); TaoCode names its own.
const toolTitles: Record<ToolWindowId, string> = {
  files: '资源管理器', git: '源代码管理', vcslog: 'VCS 日志', search: '搜索', todo: '任务',
  outline: '结构', bookmarks: '书签', debug: '调试', history: '本地历史', tests: '测试',
}
const toolIcons: Record<ToolWindowId, unknown> = {
  files: Files, git: GitBranch, vcslog: GitGraph, search: Search, todo: ListChecks,
  outline: FolderTree, bookmarks: BookmarkIcon, debug: Bug, history: History, tests: FlaskConical,
}
// IDEA binds Alt+<digit> to a tool window through the *keymap* — ActivateToolWindowAction
// .Manager.getMnemonicForToolWindow reads the shortcut of `Activate<Id>ToolWindow`
// (ActivateToolWindowAction.kt:88-111) and StripeButton prints it as "<digit>: <title>"
// (StripeButton.kt:287-298). The number therefore belongs to the tool window and never to
// its position on the stripe: dragging stripe buttons around must not renumber anything.
// TaoCode keeps one stable order for the mnemonics, separate from the draggable
// `toolOrder` that only decides where a button is drawn.
const toolWindowOrder: ToolWindowId[] = ['files', 'git', 'vcslog', 'search', 'todo', 'outline', 'bookmarks', 'debug', 'history', 'tests']
// IDEA's keymap also binds Alt+0 to the Commit tool window; TaoCode's 源代码管理 panel
// *is* the commit tool window (message box + changes + commit actions), so it answers
// Alt+0 in addition to its own stripe number (ActivateToolWindowAction.kt:88-111).
const TOOL_MNEMONIC_ALIASES: Record<string, ToolWindowId> = { '0': 'git' }
const TOOL_MNEMONIC_BINDINGS = mnemonicBindings(toolWindowOrder, TOOL_MNEMONIC_ALIASES)
function toolWindowMnemonic(id: ToolWindowId): string | undefined {
  return mnemonicOf(toolWindowOrder, id)
}
// The ⋮ options menu on a tool-window strip: Move to Left/Right/Bottom + Hide
// (UIBundle: tool.window.move.to.action.group.name, tool.window.hide.action.name).
const toolMenu = ref<ToolWindowId | null>(null)
// IDEA's AbstractDroppableStripe lets a stripe button be dragged to another stripe
// (finishDrop -> setSideToolAndAnchor) or reordered in place. The order is a machine
// preference, so it persists next to the anchors.
const toolOrder = ref<Record<Anchor, ToolWindowId[]>>({
  left: ['files', 'git', 'vcslog', 'search', 'todo', 'outline', 'bookmarks', 'debug', 'history'],
  right: [],
  bottom: [],
})
try {
  const saved = JSON.parse(localStorage.getItem('taocode.toolOrder') ?? 'null') as Partial<Record<Anchor, ToolWindowId[]>> | null
  if (saved) {
    for (const side of ['left', 'right', 'bottom'] as const) {
      const list = saved[side]
      if (!Array.isArray(list)) continue
      const valid = list.filter((id): id is ToolWindowId => typeof id === 'string' && id in toolAnchors)
      const rest = (Object.keys(toolAnchors) as ToolWindowId[]).filter(id => !valid.includes(id))
      toolOrder.value[side] = side === 'left' ? [...valid, ...rest] : valid
    }
  }
} catch { /* corrupted state falls back to the default order */ }
function saveToolOrder() {
  try { localStorage.setItem('taocode.toolOrder', JSON.stringify(toolOrder.value)) } catch { /* session-only */ }
}
const stripeOrder = computed(() => (side: Anchor) => toolOrder.value[side].filter(id => (toolAnchors[id] ?? 'left') === side))
// Which tool windows can be opened right now (IDEA disables an unavailable window
// instead of hiding it, so the stripe keeps a stable layout).
function toolDisabled(id: ToolWindowId): boolean {
  if (id === 'outline') return !lspReady.value
  if (id === 'vcslog' || id === 'history') return !isDesktop || !workspace.value
  return false
}
function activateToolWindow(id: ToolWindowId) {
  if (toolDisabled(id)) return
  if (id === 'files') { explorer.value = !explorer.value; leftView.value = 'files'; if (explorer.value) recordActiveToolWindow(id); return }
  if (id === 'outline') { toggleOutline(); if (explorer.value && leftView.value === 'outline') recordActiveToolWindow(id); return }
  const anchor = toolAnchors[id] ?? 'left'
  if (anchor === 'bottom') bottom.value = true
  else explorer.value = true
  leftView.value = leftView.value === id && anchor !== 'bottom' ? 'files' : id
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
type LeftViewId = typeof leftView.value
type BottomTabId = typeof bottomTab.value
const activeToolWindows = ref<string[]>([])
function recordActiveToolWindow(id: LeftViewId | BottomTabId) {
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
const LAYOUT_STORAGE_KEY = 'taocode.toolWindowLayouts'
/** The order the stripes start with — the same list `toolOrder` is initialised from. */
const DEFAULT_TOOL_ORDER: readonly LeftViewId[] = ['files', 'git', 'vcslog', 'search', 'todo', 'outline', 'bookmarks', 'debug', 'history']
const BOTTOM_TABS: readonly BottomTabId[] = ['output', 'run', 'problems', 'references', 'hierarchy', 'terminal', 'blame', 'about']
/**
 * `getFactoryDefaultLayoutCopy()` (`ToolWindowDefaultLayoutManager.kt:64`): the layout that always
 * answers to the empty name. The dock is visible in it (IDEA's factory default shows the project
 * tool window) even though a *fresh* session may start with it collapsed on a narrow window.
 */
function factoryToolLayout(): ToolLayout {
  return {
    explorer: true,
    bottom: false,
    view: 'files',
    tab: 'output',
    anchors: { files: 'left', git: 'left', vcslog: 'left', search: 'left', todo: 'left', outline: 'left', bookmarks: 'left', debug: 'left', history: 'left' },
    order: { left: [...DEFAULT_TOOL_ORDER], right: [], bottom: [] },
    sizes: { explorer: 240, trace: 300, output: 180 },
  }
}
function isLeftToolWindowId(id: string): id is LeftViewId { return id in toolAnchors }
const toolLayoutStore = ref<ToolLayoutStore>(loadToolLayoutStore())
function loadToolLayoutStore(): ToolLayoutStore {
  try { return normalizeLayoutStore(JSON.parse(localStorage.getItem(LAYOUT_STORAGE_KEY) ?? 'null')) }
  catch { return emptyLayoutStore() }
}
function persistToolLayouts() {
  try { localStorage.setItem(LAYOUT_STORAGE_KEY, JSON.stringify(toolLayoutStore.value)) } catch { /* storage unavailable: session-only */ }
}
function captureToolLayout(): ToolLayout {
  // A 'bottom' anchor is not snapshot-able: nothing sets one (see the `ToolWindowId` note above),
  // and the bottom area is a panel, not a tool-window dock.
  const anchors: Record<string, ToolWindowSide> = {}
  for (const id of Object.keys(toolAnchors) as LeftViewId[]) {
    const side = toolAnchors[id]
    if (side === 'left' || side === 'right') anchors[id] = side
  }
  return {
    explorer: explorer.value,
    bottom: bottom.value,
    view: leftView.value,
    tab: bottomTab.value,
    anchors,
    order: { left: [...toolOrder.value.left], right: [...toolOrder.value.right], bottom: [...toolOrder.value.bottom] },
    sizes: { ...panelSizes },
  }
}
/** `ToolWindowManagerEx.setLayout` — write a snapshot back, ignoring ids that no longer exist. */
function applyToolLayout(layout: ToolLayout) {
  explorer.value = layout.explorer
  bottom.value = layout.bottom
  if (isLeftToolWindowId(layout.view)) leftView.value = layout.view
  if (BOTTOM_TABS.includes(layout.tab as BottomTabId)) bottomTab.value = layout.tab as BottomTabId
  for (const id of Object.keys(toolAnchors) as LeftViewId[]) {
    const side = layout.anchors[id]
    if (side === 'left' || side === 'right') toolAnchors[id] = side
  }
  for (const side of ['left', 'right'] as const) {
    const list = (layout.order[side] ?? []).filter(isLeftToolWindowId)
    // A window the snapshot never heard of stays reachable: it is appended to the left stripe,
    // which is what the order loader does for a stored list that lost an entry.
    const rest = (Object.keys(toolAnchors) as LeftViewId[]).filter(id => !list.includes(id))
    toolOrder.value[side] = side === 'left' ? [...list, ...rest] : list
  }
  saveToolOrder()
  for (const panel of ['explorer', 'trace', 'output'] as const) {
    const size = layout.sizes[panel]
    if (typeof size === 'number' && size > 0) setPanelSize(panel, size)
  }
}
/** `activeLayoutName = name` + `setLayout(getLayoutCopy())` (`CustomLayoutsActionGroup` Apply). */
function applyNamedToolLayout(name: string) {
  toolLayoutStore.value = setActiveLayout(toolLayoutStore.value, name)
  persistToolLayouts()
  applyToolLayout(resolveLayout(toolLayoutStore.value, factoryToolLayout()))
}
/** `RestoreFactoryDefaultLayoutAction.kt:29-35` — also the 「默认布局」 row's toggle. */
function useFactoryToolLayout() { applyNamedToolLayout(FACTORY_LAYOUT_NAME) }
/** `RestoreDefaultLayoutAction.java:41-47`, bound to Shift+F12 (`$default.xml:864-866`). */
function restoreCurrentToolLayout() {
  applyToolLayout(resolveLayout(toolLayoutStore.value, factoryToolLayout()))
}
/** `StoreNamedLayoutAction.kt:22-25` ("Save Changes in Current Layout"). */
function storeCurrentToolLayout() {
  const name = toolLayoutStore.value.active
  toolLayoutStore.value = saveLayout(toolLayoutStore.value, name, captureToolLayout())
  persistToolLayouts()
  notify(`布局「${name}」已保存。`)
}
function openLayoutNameDialog(mode: 'newLayout' | 'renameLayout') {
  menu.value = null
  nameDialog.value = { mode, dir: '', value: mode === 'renameLayout' ? toolLayoutStore.value.active : '' }
  void nextTick(() => { nameInput.value?.focus(); if (mode === 'renameLayout') nameInput.value?.select() })
}
/** `DeleteNamedLayoutAction` — the active layout cannot be deleted, so the row is hidden for it. */
function deleteCurrentToolLayout() {
  const name = toolLayoutStore.value.active
  const next = deleteLayout(toolLayoutStore.value, name)
  if (next === toolLayoutStore.value) return
  toolLayoutStore.value = next
  persistToolLayouts()
  notify(`布局「${name}」已删除。`)
}
// --- hide / cycle the tool windows (the rest of WindowMenu > ActiveToolwindowGroup) ---------
// The group in PlatformActions.xml:653-660 is: HideActiveWindow, HideSideWindows, HideBottomWindows,
// HideAllWindows, PinToolwindowTab, JumpToLastWindow, MaximizeToolWindow, DockToolWindow,
// separator, NextTab, PreviousTab, CloseActiveTab, TW.CloseOtherTabs.
/**
 * IDEA derives `activeToolWindowId` from the focus owner (ToolWindowManagerImpl), so the dock that
 * owns the focused element is the active window. Anything else — the editor, a stripe button, a
 * menu — means no tool window is active and the *last focused* one answers instead.
 */
function dockOf(element: Element | null): 'side' | 'bottom' | 'editor' {
  if (element?.closest('.output-panel')) return 'bottom'
  if (element?.closest('.explorer-panel')) return 'side'
  return 'editor'
}
function focusedDock(): 'side' | 'bottom' | 'editor' {
  return dockOf(document.activeElement)
}
/**
 * A Swing menu does **not** take focus, so IDEA's `getActiveToolWindowId()` still answers with the
 * dock the user was in while the Window menu is open. A DOM menu button does take it, which would
 * grey out every row that needs the active tool window exactly when its own menu opens — so while
 * the focus sits in the top bar, the last dock that really held focus answers instead. Focus
 * anywhere else (the editor, the status bar) keeps the strict answer: no active tool window.
 */
const lastDockFocus = ref<'side' | 'bottom' | 'editor'>('editor')
function noteDockFocus(event: FocusEvent) {
  lastDockFocus.value = dockOf(event.target as Element | null)
}
function activeToolWindowDock(): 'side' | 'bottom' | null {
  const live = focusedDock()
  if (live !== 'editor') return live
  const inTopBar = Boolean((document.activeElement as Element | null)?.closest('.topbar'))
  const dock = inTopBar ? lastDockFocus.value : 'editor'
  return dock === 'editor' ? null : dock
}
/** HideToolWindowAction.kt:21-29 — hide `activeToolWindowId ?: lastActiveToolWindowId`. */
function hideActiveToolWindow() {
  const dock = focusedDock()
  if (dock === 'bottom') { bottom.value = false; return }
  if (dock === 'side') { explorer.value = false; return }
  const id = lastActiveId(activeToolWindows.value, toolWindowAvailable)
  if (id === undefined) return
  if (isLeftToolWindowId(id)) explorer.value = false
  else bottom.value = false
}
/** HideSideWindowsAction.kt:18-25 — "Hide all windows on this side" (ActionsBundle:1136). */
function hideSideToolWindows() { explorer.value = false }
/** HideBottomToolWindowsAction.kt:19-24 — "Hide bottom tool windows" (ActionsBundle:1138). */
function hideBottomToolWindows() { bottom.value = false }
/**
 * The `v-if` on a bottom panel's own tab button is also its availability test, so a tab that cannot
 * be shown is never the target of a jump or a cycle. `blame` keeps its own clause: it stays a tab
 * while it is the one on screen, which is what its button does.
 */
function bottomTabAvailable(tab: BottomTabId): boolean {
  if (tab === 'references') return references.value.length > 0
  if (tab === 'hierarchy') return hierRoot.value !== null
  if (tab === 'blame') return blameLines.value.length > 0 || bottomTab.value === 'blame'
  return true
}
/**
 * `TabNavigationActionBase.java:187-201`: the action is enabled only when the context it would act
 * on has more than one tab, which is why the two rows below are greyed out on a single tab.
 */
function tabTargetCount(): number {
  if (!workspace.value) return 0
  if (focusedDock() === 'editor') return groups[focusedPane.value].tabs.length
  return bottomContentCount()
}
/** The bottom dock's contents: the tab buttons' own `v-if`s are its availability test. */
function bottomContentCount(): number {
  return BOTTOM_TABS.filter(bottomTabAvailable).length
}
/**
 * `ToggleContentUiTypeMode` / `ShowContent` both ask `getActiveToolWindowId()` for the window they
 * act on, and neither falls back to a "last active" one. A side window shows one view, the bottom
 * dock holds the rest, and the editor means no tool window is active at all.
 */
function activeContentCount(): number {
  const dock = activeToolWindowDock()
  if (!dock) return 0
  return dock === 'side' ? 1 : bottomContentCount()
}
/**
 * `WindowInfo.contentUiType` (`ToolWindowImpl.kt:521`) travels with the window layout, so the choice
 * is remembered. `ToolWindowContentUiType.getInstance` (`:33-45`) falls back to TABBED on anything
 * unexpected, which is the `resolveContentUiType` default too.
 */
const bottomContentUiType = ref<ToolWindowContentUiType>(readStoredContentUiType())
function readStoredContentUiType(): ToolWindowContentUiType {
  try { return resolveContentUiType(localStorage.getItem('taocode.toolWindowContentUi')) }
  catch { return 'tabbed' }
}
watch(bottomContentUiType, type => {
  try { localStorage.setItem('taocode.toolWindowContentUi', type) }
  catch { /* storage unavailable: session-only */ }
})
/**
 * The combo form of the same list (`ContentComboLabel.java`) — the tab strip's own labels, in strip
 * order. The names are asserted against the strip's buttons in `tests/tool-window-content-ui.test.mjs`
 * so the two cannot drift apart.
 */
const bottomTabOptions = computed<{ id: BottomTabId; label: string }[]>(() =>
  BOTTOM_TABS.filter(bottomTabAvailable).map(id => ({ id, label: bottomTabLabel(id) })))
function bottomTabLabel(tab: BottomTabId): string {
  if (tab === 'output') return '操作输出'
  if (tab === 'run') return '运行'
  if (tab === 'problems') return '问题'
  if (tab === 'references') return '引用'
  if (tab === 'hierarchy') return hierTitle.value
  if (tab === 'terminal') return '终端'
  if (tab === 'blame') return '追溯'
  return '工作区说明'
}
/** TabNavigationActionBase.java:71-78 — the editor answers when it has focus, the tool window else. */
function selectNextTab() { cycleTab(1) }
function selectPreviousTab() { cycleTab(-1) }
function cycleTab(step: 1 | -1) {
  if (!workspace.value) return
  if (focusedDock() === 'editor') {
    // Editor branch (:130-147): the tabs of the *current* editor window, wrapping around.
    const pane = focusedPane.value
    const tabs = groups[pane].tabs
    const index = nextContentIndex(tabs.length, tabs.findIndex(tab => tab.path === groups[pane].activePath), step)
    if (index === undefined) return
    switchTabIn(pane, tabs[index]!)
    return
  }
  // Tool-window branch (:156-171): selectNextContent / selectPreviousContent on the contents of the
  // active window, which is the bottom panel's tab strip here.
  const tabs = BOTTOM_TABS.filter(bottomTabAvailable)
  const index = nextContentIndex(tabs.length, tabs.indexOf(bottomTab.value), step)
  if (index === undefined) return
  showOutput(tabs[index]!)
}
/**
 * The strip's closeable contents as `Content.isCloseable()` sees them (`ContentImpl.java:237-239`):
 * references / hierarchy / blame hold real content, the five fixed tabs never do. This is the one
 * place that answers the question, so CloseActiveTab / CloseOtherTabs / CloseAllTabs cannot end up
 * disagreeing about which tabs are removable.
 */
function toolTabPresence(): ToolTabPresence {
  return { references: references.value.length > 0, hierarchy: hierRoot.value !== null, blame: blameLines.value.length > 0 }
}
/** `ContentManager.removeContent(cur, true)` for one content. */
function clearToolTab(tab: CloseableToolTabId) {
  if (tab === 'references') references.value = []
  else if (tab === 'hierarchy') resetHierarchy()
  else blameLines.value = []
}
/**
 * CloseActiveTabAction.java:39-58 — close the selected content when it is closeable, otherwise hide
 * the whole tool window. In TaoCode only references / hierarchy / blame have content that can go
 * away, so those are the closeable ones; the fixed tabs fall through to hiding the panel.
 */
function closeActiveTab() {
  if (!workspace.value) return
  if (focusedDock() !== 'editor') {
    const current = bottomTab.value
    if (isCloseableToolTab(current) && toolTabPresence()[current]) { clearToolTab(current); return }
    bottom.value = false
    return
  }
  const tab = active.value
  if (tab) void closeTab(tab)
}
/**
 * ToolWindowCloseOtherTabsAction.kt:11-19 — remove every content of the tool window except the
 * active one, then re-select the active one. `bottomTab` is the selected content even when it is a
 * permanent tab (Output, …): `cur !== content` then matches every closeable content, so all of them
 * go — only the one the action was invoked on is spared.
 */
function closeOtherToolTabs() {
  for (const tab of tabsCloseOtherWouldRemove(bottomTab.value, toolTabPresence())) clearToolTab(tab)
}
/** ToolWindowCloseOtherTabsAction.kt:21-27 — enabled only when another content is closeable. */
function closeOtherTabsTarget(): boolean {
  return canCloseOtherContents(bottomTab.value, toolTabPresence())
}
/**
 * ToolWindowCloseAllTabsAction.kt:11-18 — remove every closeable content of the tool window,
 * *including* the one on screen (the only difference from CloseOtherTabs). `PlatformActions.xml:666`
 * mounts it directly after `TW.CloseOtherTabs`; it borrows the shortcut of `CloseAllEditors`
 * (`intellij.platform.ide.impl.actions.xml:462`), which has no binding in `$default.xml`, so the
 * row has no key here either — none is invented.
 */
function closeAllToolTabs() {
  for (const tab of tabsCloseAllWouldRemove(toolTabPresence())) clearToolTab(tab)
}
/** ToolWindowCloseAllTabsAction.kt:20-23 -> ContentManagerImpl.java:472-481. */
function closeAllTabsTarget(): boolean {
  return canCloseAllContents(toolTabPresence())
}
// The stripe button's context menu is the *tool window's* gear group (ToolWindowHeader.kt:345-368
// `ShowOptionsAction` shows `gearProducer.get()`), so a right click must first make that window the
// shown one — otherwise `toolMenu` would name a window whose header is not on screen.
function openToolMenu(id: ToolWindowId) {
  if (toolDisabled(id)) return
  focusToolWindowContent(id)
  toolMenu.value = id
}
// --- drag & drop of stripe buttons (IDEA AbstractDroppableStripe) -----------
const draggingTool = ref<ToolWindowId | null>(null)
const dropTarget = ref<{ side: Anchor | null; before: ToolWindowId | null } | null>(null)
function onToolDragStart(id: ToolWindowId, event: DragEvent) {
  draggingTool.value = id
  event.dataTransfer?.setData('text/plain', id)
  if (event.dataTransfer) event.dataTransfer.effectAllowed = 'move'
}
function onToolDragOver(side: Anchor, before: ToolWindowId | null, event: DragEvent) {
  if (!draggingTool.value) return
  event.preventDefault()
  dropTarget.value = { side, before }
  if (event.dataTransfer) event.dataTransfer.dropEffect = 'move'
}
function onToolDrop(side: Anchor, before: ToolWindowId | null, event: DragEvent) {
  event.preventDefault()
  const id = draggingTool.value
  draggingTool.value = null
  dropTarget.value = null
  if (!id) return
  // Dropping onto a stripe both moves the window to that side and reorders it there.
  if ((toolAnchors[id] ?? 'left') !== side) setToolAnchor(id, side)
  const order = toolOrder.value[side].filter(item => item !== id)
  const index = before ? order.indexOf(before) : -1
  if (index >= 0) order.splice(index, 0, id)
  else order.push(id)
  toolOrder.value[side] = order
  saveToolOrder()
}
function onToolDragEnd() { draggingTool.value = null; dropTarget.value = null }
function isDropBefore(side: Anchor, id: ToolWindowId) {
  return dropTarget.value?.side === side && dropTarget.value.before === id && draggingTool.value !== id
}
const bottomTab = ref<'output' | 'run' | 'problems' | 'references' | 'hierarchy' | 'terminal' | 'blame' | 'about'>('output')
const runCommand = ref('cmake --build build')
const runInput = ref<HTMLInputElement>()
const runLog = ref<HTMLElement>()
const treeVersion = ref(0)
const fileTreeRef = ref<InstanceType<typeof FileTree> | null>(null)
const terminalPanelRef = ref<InstanceType<typeof TerminalPanel> | null>(null)
const testRunnerRef = ref<InstanceType<typeof TestRunnerPanel> | null>(null)
const theme = ref<Theme>(initialTheme())
const panelSizes = reactive({ explorer: 240, trace: 300, output: 180 })
const resizing = ref(false)
let resizeCleanup: (() => void) | undefined
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
const menu = ref<'file' | 'edit' | 'view' | 'navigate' | 'code' | 'refactor' | 'analyze' | 'build' | 'run' | 'tools' | 'git' | 'window' | null>(null)
const help = ref(false)
const loading = ref(true)
const appError = ref('')
const recentProjects = ref<RecentProject[]>([])
const editorSettings = ref<EditorSettings>({ ...defaultEditorSettings })
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
type LeaveChoice = 'save' | 'discard' | 'cancel'
const leavePrompt = ref<{ title: string; paths: string[]; resolve: (choice: LeaveChoice) => void } | null>(null)
const leaveCancel = ref<HTMLButtonElement>()
const expandedTrace = ref<number | null>(null)
const reveal = ref<{ path: string; line: number; column?: number } | null>(null)
const navBack = ref<{ path: string; line: number }[]>([])
const navForward = ref<{ path: string; line: number }[]>([])
const historyEpoch = ref(0)
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
const references = ref<LspLocation[]>([])
const outline = ref<LspDocumentSymbol[]>([])
const codeActions = ref<LspCodeAction[]>([])
const actionPrompt = ref<{ path: string } | null>(null)
interface SymbolEntry { name: string; kind: number; path: string; line: number; character: number }
// IDEA's "Go to Class" (Ctrl+N) and "Go to Symbol" (Ctrl+Shift+Alt+N) are different
// filters over the same workspace-symbol index; the class filter is the LSP kinds that
// denote a type.
const CLASS_KINDS = new Set([5, 11, 13, 19, 23, 26])
const symbolPrompt = ref<{ mode: 'file' | 'global' | 'class' } | null>(null)
const symbolQuery = ref('')
const symbolInput = ref<HTMLInputElement>()
const symbolResults = ref<SymbolEntry[]>([])
const symbolIndex = ref(0)
let symbolTimer: number | undefined
const dirty = computed(() => allTabs.value.some(tab => tab.dirty))
// IDEA's status bar shows the current Git branch with ahead/behind counters and a
// fetch/update widget. Poll the same bridge methods the 源代码管理 panel uses, only
// while a workspace is open on the desktop; SourceControl refreshes on its own too.
const gitHead = ref('')
const gitAheadBehind = ref<GitAheadBehind>({ available: false, ahead: 0, behind: 0 })
// The per-file change list behind `git.status`. IDEA colours the toolbar filename widget with
// FileStatusManager's FileStatus for the selected file (FilenameToolbarWidgetAction.kt:63-73);
// the change list gives the same information without a second round trip.
const gitChanges = ref<GitChange[]>([])
let gitStatusTimer: number | undefined
async function refreshGitWidget() {
  if (!isDesktop || !workspace.value || !gitAvailable.value) { gitHead.value = ''; gitChanges.value = []; return }
  try {
    const status = await request<GitStatus>('git.status')
    gitHead.value = status.head ?? ''
    gitChanges.value = status.changes ?? []
    gitAheadBehind.value = await request<GitAheadBehind>('git.aheadBehind')
  } catch { gitHead.value = ''; gitChanges.value = [] }
}
watch(workspace, value => {
  if (gitStatusTimer !== undefined) { window.clearInterval(gitStatusTimer); gitStatusTimer = undefined }
  if (!value) { gitHead.value = ''; gitChanges.value = []; return }
  void refreshGitWidget()
  gitStatusTimer = window.setInterval(() => { if (!document.hidden && !editorSettings.value.powerSaveMode) void refreshGitWidget() }, 30000)
})
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
const working = computed(() => loading.value || busy.value || projectBusy.value || allTabs.value.some(tab => tab.saving) || opening.size > 0)
// IDEA's InfoAndProgressPanel collects the background tasks with a progress:
// the git worker queue, the project clone, and a build/run. Indeterminate by
// nature (a git command has no total), exactly like IDEA's spinner rows.
const backgroundTasks = computed(() => {
  const tasks: { title: string; detail: string; cancellable: false | 'git' | 'clone' | 'run' }[] = []
  if (gitProgress.running) tasks.push({ title: 'Git 操作进行中', detail: gitProgress.queued > 0 ? `队列中还有 ${gitProgress.queued} 个操作` : '正在执行 Git 命令', cancellable: 'git' })
  if (cancelling.value || cloneProgress.length) tasks.push({ title: '正在克隆项目', detail: cloneProgress.length ? cloneProgress[cloneProgress.length - 1].slice(0, 120) : '准备中', cancellable: 'clone' })
  if (runState.running) tasks.push({ title: '构建/运行进行中', detail: '输出在下方控制台', cancellable: 'run' })
  return tasks
})
const progressOpen = ref(false)
// ProcessPopup.java:100-133 + TasksFinishedDecorator.kt:19-46 — the popup is a real list, not only a
// running-task list: with nothing running it either says "all background tasks completed" (once
// something has run) or "no processes are running" (nothing ever did), and ShowProcessWindow
// (status/ShowProcessWindowAction.java:16-55) can open it while idle.
const allTasksFinishedOnce = ref(false)
watch(() => backgroundTasks.value.length, (now, before) => {
  allTasksFinishedOnce.value = updateFinishedLatch(allTasksFinishedOnce.value, now > 0, (before ?? 0) > 0)
})
const progressRows = computed(() => popupRows(backgroundTasks.value, allTasksFinishedOnce.value))
function cancelProgressRow(row: { cancellable?: false | 'git' | 'clone' | 'run' }) {
  if (row.cancellable) void cancelBackgroundTask(row.cancellable)
}
// IDEA MemoryUsagePanel: "NNN of MMM M", refreshed on a timer. Reads the host
// process from the native side; nothing is shown in browser preview.
const processMemory = ref<ProcessMemory | null>(null)
let memoryTimer: number | undefined
async function refreshMemory() {
  if (!isDesktop || document.hidden || editorSettings.value.powerSaveMode) return
  try {
    const memory = await request<ProcessMemory>('app.memory')
    if (memory.available) processMemory.value = memory
  } catch { /* the widget simply keeps its last value */ }
}
onMounted(() => { if (isDesktop) { void refreshMemory(); memoryTimer = window.setInterval(() => void refreshMemory(), 5000) } })
onBeforeUnmount(() => { if (memoryTimer !== undefined) window.clearInterval(memoryTimer) })
// IDEA's ColumnSelectionModePanel: the status bar shows that the editor is in
// column-selection mode and clicking the widget turns it off again.
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
async function saveSettingsPatch(patch: Partial<EditorSettings>) {
  if (settingsBusy.value) return
  settingsBusy.value = true
  try { editorSettings.value = await request<EditorSettings>('settings.update', { settings: { ...editorSettings.value, ...patch } }) }
  catch (error) { notify(errorMessage(error), true) }
  finally { settingsBusy.value = false }
}
function toggleColumnModeFromStatusBar() {
  const editor = editorFor(activePath.value) as unknown as { toggleColumnSelection?: () => void } | null
  editor?.toggleColumnSelection?.()
}
// IDEA's ProcessPopup rows each carry a cancel button (cancelRequest -> cancel()).
// Each of TaoCode's background sources has a real stop: git.cancel terminates the
// running git child, project.clone.cancel aborts the clone, run.stop the runner.
async function cancelBackgroundTask(kind: 'git' | 'clone' | 'run') {
  try {
    if (kind === 'git') await request('git.cancel')
    else if (kind === 'clone') await request('project.clone.cancel')
    else await request('run.stop')
  } catch (error) { notify(errorMessage(error), true) }
}
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
function otherPane(pane: Pane): Pane { return pane === 0 ? 1 : 0 }
function focusPane(pane: Pane) { splitModel.focused = pane }
// IDEA's Split Right / Split Down act on the *selected* tab of the focused group.
function splitTabOut(tab: Tab, orientation: 'horizontal' | 'vertical') {
  splitTabOutIn(splitModel, (tab: Tab) => tab.path, tab, orientation)
}
function toggleSplit(orientation?: 'horizontal' | 'vertical') {
  if (splitModel.orientation !== 'none') { unsplit(); return }
  const selected = active.value
  if (!selected) { notify('先打开一个文件再分屏。', true); return }
  splitTabOut(selected, orientation ?? 'horizontal')
}
function unsplit() { unsplitModel(splitModel) }
function unsplitAll() { unsplitAllModel(splitModel) }
// EditorTabPopupMenu rows act on the right-clicked tab, not the focused one.
function splitFromTabMenu(pane: Pane, path: string, orientation: 'horizontal' | 'vertical') {
  tabMenu.value = null
  const tab = groups[pane].tabs.find(item => item.path === path)
  if (tab) splitTabOut(tab, orientation)
}
// OpenEditorInOppositeTabGroup: show the same file in both groups ("split same").
function openInOppositeGroup(path: string) {
  const other = otherPane(splitModel.focused)
  if (groups[other].tabs.some(tab => tab.path === path)) return
  const tab = groups[splitModel.focused].tabs.find(item => item.path === path) ?? findTab(path)
  if (tab) splitTabOutIn(splitModel, (item: Tab) => item.path, tab, splitModel.orientation === 'none' ? 'horizontal' : splitModel.orientation)
}
// KeepTabOpen: a preview tab stops being replaceable by the next preview. The row
// only makes sense while the tab is one, so it disables otherwise.
function keepTabOpen(tab: Tab) { tab.preview = false }
// IDEA's preview tab: opening from the tree replaces the previous preview; editing,
// pinning or second-opening promotes it to a normal tab.
function switchTabIn(pane: Pane, tab: Tab) {
  splitModel.focused = pane
  groups[pane].activePath = tab.path
  if (tab.preview) tab.preview = false
  rememberRecent(tab.path)
  touchHistory(tab.path)
  // The caret only moves through the editor's own cursor event; re-selecting the tab
  // that already had focus would otherwise stamp line 1 into Recent Locations.
  rememberPlace({ kind: '文件', path: tab.path, line: Math.max(0, tab.line - 1), label: tab.path })
}
// EditorHistoryManager.fileList, most recent first; drives the tab-limit closing order.
const editorHistory = ref<string[]>([])
function touchHistory(path: string) {
  editorHistory.value = [path, ...editorHistory.value.filter(item => item !== path)].slice(0, 120)
}
async function enforceTabLimit(pane: Pane, justOpened: string) {
  const limit = editorSettings.value.tabLimit
  const group = groups[pane]
  if (group.tabs.length <= limit) return
  const history = [...editorHistory.value.filter(path => path !== justOpened), justOpened]
  for (const victim of tabClosingOrder(group.tabs, justOpened, history, (tab: Tab) => tab.path, (tab: Tab) => tab.dirty)) {
    if (group.tabs.length <= limit) break
    await closeTabIn(pane, victim)
  }
}
async function closeTabIn(pane: Pane, tab: Tab) {
  if (working.value) return
  if (tab.dirty && !await confirmLeave(`关闭 ${tab.path}`, [tab])) return
  const index = groups[pane].tabs.indexOf(tab)
  // The buffer may still be visible in the other pane ("split same"); only release
  // the LSP document once no pane references it.
  if (closeTabInPane(splitModel, (tab: Tab) => tab.path, pane, tab)) stopLspFile(tab.path)
  // EditorWindow.removedTabs: remember what was here and where, so Reopen Closed Tab
  // restores it to the original position (RemovedTabInfo carries the index).
  if (index >= 0) {
    const history = closedTabsPerPane[pane]
    history.unshift({ path: tab.path, line: tab.line, index })
    if (history.length > 20) history.pop()
  }
}
const closedTabsPerPane = reactive<[ClosedTab[], ClosedTab[]]>([[], []])
interface ClosedTab { path: string; line: number; index: number }
// --- Crash recovery (IDEA's workspace.xml editor state + unsaved drafts) ---
// The snapshot covers the split layout, each group's tabs and selections and, for
// dirty buffers only, the draft text. It is saved debounced after any layout or
// dirty change and cleared on a clean project close, so the restore prompt only
// appears after a crash or an abandoned exit.
interface SessionState { tabs: Array<{ path: string; line: number; column: number; pane: number; draft?: string }>; active: [string, string]; orientation: 'none' | 'horizontal' | 'vertical'; focused: Pane }
const restorePrompt = ref<{ state: SessionState; drafts: number } | null>(null)
let sessionTimer: number | undefined
function sessionKey() {
  return JSON.stringify([splitModel.orientation, splitModel.focused,
    groups.map(group => [group.activePath, group.tabs.map(tab => `${tab.path}${tab.dirty ? '*' : ''}`)])])
}
function snapshotSession(): SessionState {
  const tabs: SessionState['tabs'] = []
  for (const pane of [0, 1] as const)
    for (const tab of groups[pane].tabs) {
      if (pane === 1 && groups[0].tabs.includes(tab)) continue  // shared buffer, already listed
      const draft = tab.dirty ? editorFor(tab.path)?.text() ?? tab.content : undefined
      tabs.push({ path: tab.path, line: tab.line, column: tab.column, pane, ...(draft !== undefined ? { draft } : {}) })
    }
  return { tabs, active: [groups[0].activePath, groups[1].activePath], orientation: splitModel.orientation, focused: splitModel.focused }
}
function scheduleSessionSave() {
  if (!isDesktop || !workspace.value) return
  if (sessionTimer) window.clearTimeout(sessionTimer)
  sessionTimer = window.setTimeout(() => {
    sessionTimer = undefined
    if (!workspace.value) return
    void request('session.save', { state: snapshotSession() }).catch(() => undefined)
  }, 1500)
}
watch(sessionKey, () => scheduleSessionSave())
// IDEA rewrites workspace.xml the moment an editor is removed instead of waiting for
// the 1.5 s debounce: a crash inside that window would otherwise restore a tab the
// user has just closed, still carrying the draft it had while it was open. Closing a
// dirty tab goes through confirmLeave first, so the draft was either written to disk
// or deliberately discarded by then — which is why this only has to flush the layout.
watch(() => groups[0].tabs.length + groups[1].tabs.length, (next, previous) => {
  if (next >= previous) return
  if (!isDesktop || !workspace.value) return
  if (sessionTimer) { window.clearTimeout(sessionTimer); sessionTimer = undefined }
  void request('session.save', { state: snapshotSession() }).catch(() => undefined)
})
async function offerSessionRestore() {
  if (!isDesktop) return
  try {
    const saved = await request<{ found: boolean; corrupt?: boolean; state?: SessionState }>('session.load')
    if (!saved.found) return
    if (saved.corrupt || !saved.state) {
      notify('上次会话的恢复数据已损坏，无法恢复未保存内容。', true)
      void request('session.clear').catch(() => undefined)
      return
    }
    const tabs = saved.state.tabs ?? []
    if (!tabs.length) { void request('session.clear').catch(() => undefined); return }
    // IDEA reopens a project's editors from workspace.xml silently; unsaved drafts
    // only exist after a crash, and those are what deserve the prompt.
    const drafts = tabs.filter(tab => tab.draft !== undefined).length
    if (!drafts) { await restoreSession({ state: saved.state, drafts: 0 }); return }
    restorePrompt.value = { state: saved.state, drafts }
  } catch { /* sessions are best-effort */ }
}
async function restoreSession(prompt: { state: SessionState; drafts: number }) {
  restorePrompt.value = null
  const epoch = workspaceEpoch
  const restored: Tab[] = []
  for (const entry of prompt.state.tabs) {
    try {
      const doc = await request<DocumentData>('file.read', { path: entry.path })
      if (epoch !== workspaceEpoch) return
      const tab: Tab = { ...doc, saving: false, dirty: false, line: Math.max(1, entry.line), column: Math.max(1, entry.column) }
      if (entry.draft !== undefined && entry.draft !== doc.content) { tab.content = entry.draft; tab.dirty = true }
      const pane = entry.pane === 1 ? 1 : 0
      if (!groups[pane].tabs.some(item => item.path === tab.path)) groups[pane].tabs.push(tab)
      restored.push(tab)
    } catch { /* the file vanished since the crash; skip it */ }
  }
  if (epoch !== workspaceEpoch) return
  splitModel.orientation = prompt.state.orientation
  splitModel.focused = prompt.state.focused
  groups[0].activePath = groups[0].tabs.some(tab => tab.path === prompt.state.active[0]) ? prompt.state.active[0] : groups[0].tabs[0]?.path ?? ''
  groups[1].activePath = groups[1].tabs.some(tab => tab.path === prompt.state.active[1]) ? prompt.state.active[1] : groups[1].tabs[0]?.path ?? ''
  for (const tab of restored) {
    touchHistory(tab.path)
    rememberRecent(tab.path)
    if (tab.dirty) await nextTick(), editorFor(tab.path)?.setDraft(tab.content)
    if (isDesktop) void startLsp(tab)
  }
  const first = findTab(groups[splitModel.focused].activePath) ?? restored[0]
  if (first) reveal.value = { path: first.path, line: Math.max(0, first.line - 1) }
  notify(`已恢复 ${restored.length} 个文件${prompt.drafts ? `（含 ${prompt.drafts} 个未保存草稿）` : ''}`)
}
function discardSession() {
  restorePrompt.value = null
  void request('session.clear').catch(() => undefined)
}
// ReopenClosedTabAction (Windows/Linux default: Ctrl+Shift+F4): restore the focused
// window's most recently closed file at its old tab position and selection.
async function reopenClosedTab() {
  const history = closedTabsPerPane[focusedPane.value]
  const last = history.shift()
  if (!last) { notify('没有最近关闭的标签页。', true); return }
  if (hasTabPath(last.path)) { activePath.value = last.path; return }
  await openFile(last.path)
  const tab = findTab(last.path)
  if (!tab) return
  const group = groups[focusedPane.value]
  const moved = group.tabs.indexOf(tab)
  if (moved >= 0 && moved !== last.index) {
    group.tabs.splice(moved, 1)
    group.tabs.splice(Math.min(last.index, group.tabs.length), 0, tab)
  }
  tab.line = last.line
  reveal.value = { path: last.path, line: Math.max(0, last.line - 1) }
}
// Moving a tab to the other group honours the direction the menu promised: "to the
// right" keeps/creates a horizontal split, "below" forces the vertical one.
// The split axis is the only thing that has to change for "below" vs "right": both
// groups already exist, so the layout follows the model.
function setSplitOrientation(orientation: 'horizontal' | 'vertical') {
  if (splitModel.orientation !== 'none' && splitModel.orientation !== orientation) splitModel.orientation = orientation
}
function moveTabToOtherPane(pane: Pane, tab: Tab, orientation: 'horizontal' | 'vertical' = 'horizontal') {
  if (splitOrientation.value !== orientation) {
    if (splitOrientation.value === 'none') toggleSplit(orientation)
    else setSplitOrientation(orientation)
  }
  if (splitModel.orientation === 'none') { toggleSplit('horizontal'); return }
  const from = groups[pane]
  const to = groups[otherPane(pane)]
  const index = from.tabs.indexOf(tab)
  if (index < 0) return
  from.tabs.splice(index, 1)
  to.tabs.push(tab)
  to.activePath = tab.path
  from.activePath = from.tabs[Math.min(index, from.tabs.length - 1)]?.path ?? ''
  splitModel.focused = otherPane(pane)
}
// IDEA's tab drag & drop: the strip itself is the drop target (reorder before the
// tab under the pointer); dropping on the other group's strip moves the tab there.
const dragTab = ref<{ pane: Pane; path: string } | null>(null)
function onTabDragStart(pane: Pane, tab: Tab, event: DragEvent) {
  // IDEA "Drag-and-drop with Alt pressed only": without Alt the drag never starts,
  // so a slip of the mouse cannot reorder tabs.
  if (editorSettings.value.dndWithPressedAltOnly && !event.altKey) {
    event.preventDefault()
    return
  }
  dragTab.value = { pane, path: tab.path }
  event.dataTransfer?.setData('text/plain', tab.path)
  if (event.dataTransfer) event.dataTransfer.effectAllowed = 'move'
}
function onTabDragOver(pane: Pane, event: DragEvent) {
  if (!dragTab.value) return
  event.preventDefault()
  if (event.dataTransfer) event.dataTransfer.dropEffect = 'move'
}
function onTabDrop(pane: Pane, path: string, event: DragEvent) {
  const dragged = dragTab.value
  dragTab.value = null
  if (!dragged) return
  event.preventDefault()
  const tab = groups[dragged.pane].tabs.find(item => item.path === dragged.path)
  if (!tab) return
  if (dragged.pane === pane && dragged.path === path) return
  dropTabOnGroup(splitModel, (tab: Tab) => tab.path, dragged.pane, tab, pane, path)
}
// Dropping on the strip's empty tail (or the pane body) appends at the group's end.
function onTabStripDrop(pane: Pane, event: DragEvent) {
  if (event.defaultPrevented) return  // a tab row already handled this drop
  const dragged = dragTab.value
  dragTab.value = null
  if (!dragged) return
  event.preventDefault()
  const tab = groups[dragged.pane].tabs.find(item => item.path === dragged.path)
  if (!tab) return
  dropTabOnGroup(splitModel, (tab: Tab) => tab.path, dragged.pane, tab, pane)
}
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
const viewport = reactive({ width: window.innerWidth, height: window.innerHeight })
type Panel = keyof typeof panelSizes
function editorStageSize(axis: 'x' | 'y') {
  const stage = document.querySelector<HTMLElement>('.editor-column')
  if (!stage) return axis === 'x' ? viewport.width : viewport.height
  const rect = stage.getBoundingClientRect()
  return axis === 'x' ? rect.width : rect.height
}
// The split divider sizes the secondary pane (0 = 50/50 until first dragged).
function setSplitSize(value: number) {
  const max = Math.max(200, editorStageSize(splitOrientation.value === 'vertical' ? 'y' : 'x') - 200)
  splitSize.value = clampPanelSize(value, 160, max)
}
function panelMax(panel: Panel) {
  // IDEA "Widescreen tool window layout": maximizes the height of the vertical tool
  // windows by limiting how tall the bottom (horizontal) one may grow — 40% of the
  // window instead of everything but 300px.
  if (panel === 'output') {
    const limit = editorSettings.value.wideScreenSupport
      ? Math.round(viewport.height * 0.4)
      : viewport.height - 300
    return Math.max(120, limit)
  }
  const other = panel === 'explorer' ? (activity.value && viewport.width >= 1000 ? panelSizes.trace : 0) : (explorer.value ? panelSizes.explorer : 0)
  return Math.min(520, viewport.width - other - 340)
}
function setPanelSize(panel: Panel, value: number) {
  const size = clampPanelSize(value, panel === 'output' ? 100 : 180, panelMax(panel))
  panelSizes[panel] = size
  // IDEA "Remember size for each tool window": with it on, dragging the dock edge
  // resizes the tool window you are looking at, not the shared stripe.
  if (editorSettings.value.rememberSizeForEachToolWindow && panel !== 'trace') {
    const key = panel === 'output' ? 'bottom' : 'side'
    toolSizes[`${leftView.value}:${key}`] = size
    saveToolSizes()
  }
}
// Per-tool-window sizes, keyed "<window>:side" / "<window>:bottom".
const toolSizes = reactive<Record<string, number>>({})
try {
  const saved = JSON.parse(localStorage.getItem('taocode.toolSizes') ?? '{}') as Record<string, number>
  for (const [key, value] of Object.entries(saved)) if (typeof value === 'number' && value >= 100 && value <= 900) toolSizes[key] = Math.round(value)
} catch { /* corrupted state: fall back to the shared size */ }
function saveToolSizes() {
  try { localStorage.setItem('taocode.toolSizes', JSON.stringify(toolSizes)) } catch { /* storage unavailable: session-only */ }
}
// Apply the remembered size whenever the shown tool window (or its anchor) changes.
watch([leftView, () => toolAnchors[leftView.value]], ([view, anchor]) => {
  if (!editorSettings.value.rememberSizeForEachToolWindow) return
  const key = `${view}:${anchor === 'bottom' ? 'bottom' : 'side'}`
  const stored = toolSizes[key]
  if (typeof stored !== 'number') return
  if (anchor === 'bottom') panelSizes.output = clampPanelSize(stored, 100, panelMax('output'))
  else panelSizes.explorer = clampPanelSize(stored, 180, panelMax('explorer'))
})
function resizeKey(event: KeyboardEvent, panel: Panel) {
  // A modified arrow belongs to the window-level shortcuts (Ctrl+Alt+Shift+arrows resize the active
  // tool window); without this the separator would also move while the chord fired.
  if (event.altKey || event.ctrlKey || event.metaKey) return
  const previous = panel === 'output' ? 'ArrowDown' : panel === 'trace' ? 'ArrowRight' : 'ArrowLeft'
  const next = panel === 'output' ? 'ArrowUp' : panel === 'trace' ? 'ArrowLeft' : 'ArrowRight'
  if (event.key !== previous && event.key !== next) return
  event.preventDefault()
  setPanelSize(panel, panelSizes[panel] + (event.key === next ? 16 : -16))
}
/**
 * `ResizeToolWindowAction.update` (`:93-118`): the action acts on the active tool window
 * (`getToolWindow` `:83-87` = the window the action was invoked on, else the last active one), and
 * it hides itself the moment an *editor* holds the focus (`:52-56` `isActiveEditorPresented`), or
 * the window is unavailable / invisible (`:67-80`). `focusedDock()` answers both: a dock only
 * answers when it is the one with focus, and the editor answers when neither is.
 */
function resizeTarget(): { panel: Panel; anchor: 'left' | 'right' | 'bottom' } | null {
  if (!workspace.value || zenMode.value) return null
  const dock = activeToolWindowDock()
  if (!dock) return null
  if (dock === 'bottom') return bottom.value ? { panel: 'output', anchor: 'bottom' } : null
  const anchor = activeAnchor.value
  return explorer.value && (anchor === 'left' || anchor === 'right') ? { panel: 'explorer', anchor } : null
}
/** The active tool window when `direction` is one of the two the anchor enables, else nothing. */
function resizeTargetFor(direction: ResizeDirection): { panel: Panel; anchor: 'left' | 'right' | 'bottom' } | null {
  const target = resizeTarget()
  return target && resizeDirectionEnabled(target.anchor, direction) ? target : null
}
/**
 * `WindowAction.getPreferredDelta()` (`:113-118`) is the preferred size of a `JLabel("W")` — the UI
 * font's own metrics — multiplied by the registry's `ide.windowSystem.hScrollChars` /
 * `vScrollChars` (`:96-98`; both 5, `registry.properties:205-208`). So the step is measured from the
 * font the chrome actually renders with instead of being a hard-coded pixel count, and it follows
 * the 界面字体 setting for free.
 */
let resizeProbe: HTMLSpanElement | null = null
function resizeStep(horizontal: boolean): number {
  if (!resizeProbe || !resizeProbe.isConnected) {
    resizeProbe = document.createElement('span')
    resizeProbe.textContent = 'W'
    resizeProbe.setAttribute('aria-hidden', 'true')
    resizeProbe.style.cssText = 'position:fixed;left:-9999px;top:0;visibility:hidden;white-space:pre'
    document.body.appendChild(resizeProbe)
  }
  const font = getComputedStyle(document.body)
  resizeProbe.style.fontFamily = font.fontFamily
  resizeProbe.style.fontSize = font.fontSize
  resizeProbe.style.fontWeight = font.fontWeight
  resizeProbe.style.lineHeight = font.lineHeight
  const box = resizeProbe.getBoundingClientRect()
  return Math.max(1, Math.round((horizontal ? box.width : box.height) * RESIZE_CHARS))
}
/** `ResizeToolWindowAction.actionPerformed` -> `stretch` (`:107-121`), through the shared clamp. */
function stretchToolWindow(direction: ResizeDirection) {
  const target = resizeTargetFor(direction)
  if (!target) return
  const horizontal = direction === 'left' || direction === 'right'
  setPanelSize(target.panel, panelSizes[target.panel] + stretchDelta(target.anchor, direction, resizeStep(horizontal)))
}
function resizeSplitKey(event: KeyboardEvent) {
  // Same guard as `resizeKey`: a chord-carrying arrow is the window-level shortcut's, not the
  // separator's.
  if (event.altKey || event.ctrlKey || event.metaKey) return
  const vertical = splitOrientation.value === 'vertical'
  const shrink = vertical ? 'ArrowDown' : 'ArrowRight'
  const grow = vertical ? 'ArrowUp' : 'ArrowLeft'
  if (event.key !== shrink && event.key !== grow) return
  event.preventDefault()
  if (splitSize.value === 0) splitSize.value = Math.round(editorStageSize(vertical ? 'y' : 'x') / 2)
  setSplitSize(splitSize.value + (event.key === grow ? -16 : 16))
}
function startSplitResize(event: PointerEvent) {
  if (event.button !== 0) return
  resizeCleanup?.()
  event.preventDefault()
  const target = event.currentTarget as HTMLElement
  const vertical = splitOrientation.value === 'vertical'
  if (splitSize.value === 0) splitSize.value = Math.round(editorStageSize(vertical ? 'y' : 'x') / 2)
  const origin = vertical ? event.clientY : event.clientX
  const size = splitSize.value
  const move = (next: PointerEvent) => {
    if (next.pointerId !== event.pointerId) return
    // Dragging the divider away from the secondary pane grows it.
    const position = vertical ? next.clientY : next.clientX
    setSplitSize(size + (vertical ? origin - position : position - origin))
  }
  const stop = () => {
    for (const type of ['pointermove', 'pointerup', 'pointercancel', 'lostpointercapture'] as const) target.removeEventListener(type, stop as EventListener)
    if (target.hasPointerCapture(event.pointerId)) target.releasePointerCapture(event.pointerId)
    resizing.value = false
    resizeCleanup = undefined
  }
  target.focus()
  target.setPointerCapture(event.pointerId)
  target.addEventListener('pointermove', move)
  target.addEventListener('pointerup', stop)
  target.addEventListener('pointercancel', stop)
  target.addEventListener('lostpointercapture', stop)
  resizing.value = true
  resizeCleanup = stop
}
function startResize(event: PointerEvent, panel: Panel) {
  if (event.button !== 0) return
  resizeCleanup?.()
  event.preventDefault()
  const target = event.currentTarget as HTMLElement
  const origin = panel === 'output' ? event.clientY : event.clientX
  const size = panelSizes[panel]
  const move = (next: PointerEvent) => {
    if (next.pointerId !== event.pointerId) return
    const position = panel === 'output' ? next.clientY : next.clientX
    setPanelSize(panel, size + (position - origin) * (panel === 'explorer' ? 1 : -1))
  }
  const stop = () => {
    target.removeEventListener('pointermove', move)
    target.removeEventListener('pointerup', stop)
    target.removeEventListener('pointercancel', stop)
    target.removeEventListener('lostpointercapture', stop)
    if (target.hasPointerCapture(event.pointerId)) target.releasePointerCapture(event.pointerId)
    resizing.value = false
    resizeCleanup = undefined
  }
  target.focus()
  target.setPointerCapture(event.pointerId)
  target.addEventListener('pointermove', move)
  target.addEventListener('pointerup', stop)
  target.addEventListener('pointercancel', stop)
  target.addEventListener('lostpointercapture', stop)
  resizing.value = true
  resizeCleanup = stop
}
function onWindowResize() {
  viewport.width = window.innerWidth
  viewport.height = window.innerHeight
  for (const panel of ['explorer', 'trace', 'output'] as const) setPanelSize(panel, panelSizes[panel])
  if (splitSize.value) setSplitSize(splitSize.value)
}
// IDEA's editor-layout menu: Unsplit / Unsplit All / Split Right / Split Down act on
// the selected tab; Move/Clone to Opposite Group shuffle tabs between panes.
// SplitterAction.ChangeOrientation: rotate the divider between left/right and
// up/down without touching either group's tabs.
function changeSplitOrientation() {
  if (splitModel.orientation === 'none') return
  splitModel.orientation = splitModel.orientation === 'horizontal' ? 'vertical' : 'horizontal'
  splitSize.value = 0
}
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
function changeTheme(value: Theme) {
  theme.value = value
  menu.value = null
  try { localStorage.setItem(themeStorageKey, value) }
  catch { notify('主题已切换，但当前环境无法保存主题偏好。', true) }
}
function dismissMenu(event: PointerEvent) {
  if (!(event.target as Element).closest('.menu-anchor')) menu.value = null
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
// IDEA keeps every notification in a log the status-bar widgets and the welcome screen's
// notification toolbar list (Notifications widget / `createNotificationToolbar`): the transient
// balloon is not the only place a message lives. `notice` stays the balloon; `noticeLog` is that
// history, and its rules live in src/notices.ts so both surfaces share one definition.
const noticeLog = ref<NoticeEntry[]>([])
let noticeSeq = 0
function notify(message: string, error = false, onClick?: () => void, detail?: string[], displayId?: string) {
  notice.value = message
  noticeError.value = error
  noticeAction.value = onClick ?? null
  const entry: NoticeEntry = { id: ++noticeSeq, message, error, at: new Date().toLocaleTimeString('zh-CN', { hour12: false }), detail, displayId }
  // `pushNotice` carries IDEA's `expirePreviousAndNotify` rule (ShowNotificationCommitResultHandler
  // .kt:97): the notification with the same display id is expired first, so repeated commits replace
  // one entry instead of filling the notification centre with history.
  noticeLog.value = pushNotice(noticeLog.value, entry)
}
// The commit panel reports its result through `notify` with a display id, so its handler ignores
// the channel's transient-click action.
function notifyFromPanel(message: string, error = false, displayId?: string, detail?: string[]) {
  notify(message, error, undefined, detail, displayId)
}
const noticeOpen = ref(false)
// IDEA's status bar answers a right click with ViewStatusBarWidgetsGroup: a checklist
// of every registered widget plus "hide current". TaoCode keeps the same list and
// remembers the unchecked ones across restarts.
const STATUS_WIDGETS: { key: string; label: string }[] = [
  { key: 'file', label: '当前文件' },
  { key: 'branch', label: 'Git 分支' },
  { key: 'bridge', label: '桥接状态' },
  { key: 'progress', label: '后台任务' },
  { key: 'smartMode', label: '语言服务状态' },
  { key: 'problems', label: '问题计数' },
  { key: 'position', label: '光标位置' },
  { key: 'readonly', label: '只读' },
  { key: 'lineSeparator', label: '行分隔符' },
  { key: 'memory', label: '内存' },
  { key: 'encoding', label: '文件编码' },
  { key: 'indent', label: '缩进' },
  { key: 'column', label: '列选择' },
  { key: 'powerSave', label: '省电模式' },
  { key: 'notices', label: '通知中心' },
]
const hiddenWidgets = ref<Set<string>>(new Set())
try {
  const saved = JSON.parse(localStorage.getItem('taocode.hiddenStatusWidgets') ?? '[]') as unknown
  if (Array.isArray(saved)) hiddenWidgets.value = new Set(saved.filter((key): key is string => typeof key === 'string' && STATUS_WIDGETS.some(widget => widget.key === key)))
} catch { /* corrupted state falls back to "everything visible" */ }
function showWidget(key: string) { return !hiddenWidgets.value.has(key) }
function toggleWidget(key: string) {
  const next = new Set(hiddenWidgets.value)
  if (next.has(key)) next.delete(key)
  else next.add(key)
  hiddenWidgets.value = next
  try { localStorage.setItem('taocode.hiddenStatusWidgets', JSON.stringify([...next])) } catch { /* session-only */ }
}
function showAllWidgets() {
  hiddenWidgets.value = new Set()
  try { localStorage.setItem('taocode.hiddenStatusWidgets', '[]') } catch { /* session-only */ }
}
// --- Status bar keyboard navigation (IdeStatusBarImpl.kt:313-323,863-872,952-962) -------------
// IDEA makes the status bar a focus cycle root (:313) whose traversal order is the visible+enabled
// widgets in visual order (:874-880,901-902,953), adds RIGHT/LEFT to the traversal keys (:317-322)
// and wraps at both ends (:955-959). `focusFirstWidget` (:863-872) — reached through
// `FocusStatusBarAction` (status/FocusStatusBarAction.kt:10-21) — enters the bar; Escape walks back
// out through `restoreFocusToPreviousComponent` (:579-596). The rules themselves live in
// `src/statusBarNav.ts` so they are testable without a DOM.
const statusBarRef = ref<HTMLElement>()
let statusBarFocusBefore: HTMLElement | null = null
const STATUS_WIDGET_SELECTOR = '.statusbar button:not([disabled]), .statusbar [tabindex="0"]:not([disabled])'
// Rows *inside* a popup are not widgets: IDEA's traversal walks the components injected into the
// three panels, and the popup contents are reached through the popup's own focus cycle
// (ProcessPopup.java:98-100 sets up its own FocusTraversalPolicy).
const STATUS_POPUP_SELECTOR = '.status-progress-list, .status-toolwindows-popup, .status-widget-menu, .status-notice-list'
function statusWidgets(): HTMLElement[] {
  const root = statusBarRef.value
  if (!root) return []
  const candidates = [...root.querySelectorAll<HTMLElement>(STATUS_WIDGET_SELECTOR)]
    .filter(element => !element.closest(STATUS_POPUP_SELECTOR))
    .map(element => ({ element, hidden: element.offsetParent === null, disabled: element instanceof HTMLButtonElement && element.disabled }))
  return focusableWidgets(candidates).map(entry => entry.element)
}
function focusStatusBar() {
  const widgets = statusWidgets()
  const active = document.activeElement as HTMLElement | null
  const inside = Boolean(active && statusBarRef.value?.contains(active))
  if (!shouldFocusFirstWidget(inside, widgets.length)) return
  if (!inside) statusBarFocusBefore = active
  widgets[0].focus()
}
function restoreFocusFromStatusBar() {
  const saved = statusBarFocusBefore
  statusBarFocusBefore = null
  const usable = Boolean(saved?.isConnected && !(saved as HTMLButtonElement).disabled)
  if (resolveRestoreTarget(Boolean(saved), usable) === 'previous' && saved) { saved.focus(); return }
  // `:583-590` — the saved owner is gone, so the focus goes back to the editor component.
  document.querySelector<HTMLElement>('.editor-stage .cm-content, .editor-stage textarea')?.focus()
}
function onStatusBarKeydown(event: KeyboardEvent) {
  if (event.key === 'Escape' && !event.defaultPrevented) { restoreFocusFromStatusBar(); return }
  if (event.key !== 'ArrowRight' && event.key !== 'ArrowLeft') return
  const widgets = statusWidgets()
  if (widgets.length < 2) return
  const active = document.activeElement as HTMLElement | null
  const direction: NavDirection = event.key === 'ArrowRight' ? 'next' : 'previous'
  const next = navigateWidget(active ? widgets.indexOf(active) : -1, widgets.length, direction)
  if (next < 0) return
  event.preventDefault()
  widgets[next].focus()
}
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
const statusMenu = ref<{ x: number; y: number } | null>(null)
function openStatusMenu(event: MouseEvent) {
  // Never hijack the menu while a status chip has its own action menu open.
  event.preventDefault()
  statusMenu.value = { x: event.clientX, y: event.clientY }
}
function clearNotices() { noticeLog.value = []; noticeOpen.value = false }
function errorMessage(error: unknown) { return error instanceof Error ? error.message : String(error) }
// IDEA's "Recent Places" collects every place the caret has been: files, symbols and
// bookmarks alike, most recent first.
interface Place { kind: '文件' | '符号' | '书签'; path: string; line: number; label: string; edited?: boolean }
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
async function refreshAppState() {
  const state = await request<AppState>('app.state')
  recentProjects.value = state.recentProjects
  editorSettings.value = state.settings
  gitAvailable.value = state.gitAvailable
  defaultParent.value = state.defaultParent
  appError.value = ''
  return state
}
async function refreshRecent() {
  if (working.value) return
  busy.value = true
  try { await refreshAppState() }
  catch (error) { appError.value = errorMessage(error) }
  finally { busy.value = false }
}
async function bootstrap() {
  try {
    const state = await refreshAppState()
    loading.value = false
    // The welcome page shows the installed-plugin count next to its nav entry, so
    // the list is read once at startup; openPlugins() refreshes it afterwards.
    if (isDesktop) {
      try { pluginList.value = (await request<PluginList>('plugin.list')).plugins }
      catch { pluginList.value = [] }
    }
    if (state.settings.restoreLastProject && state.lastProject) await openWorkspace(state.lastProject)
  } catch (error) { appError.value = errorMessage(error) }
  finally { loading.value = false }
}
async function confirmLeave(title: string, scope = allTabs.value.filter(tab => tab.dirty)): Promise<boolean> {
  if (!scope.length) return true
  if (leavePrompt.value) return false
  const choice = await new Promise<LeaveChoice>(resolve => { leavePrompt.value = { title, paths: scope.map(tab => tab.path), resolve } })
  if (choice === 'cancel') return false
  if (choice === 'discard') return true
  for (const tab of scope) if (!await save(tab)) return false
  return true
}
function answerLeave(choice: LeaveChoice) {
  const prompt = leavePrompt.value
  leavePrompt.value = null
  prompt?.resolve(choice)
}
async function activateWorkspace(result: Workspace) {
  resetLsp()
  resetHierarchy()
  workspaceEpoch++
  workspace.value = result
  closeAllPanes()
  navBack.value = []
  navForward.value = []
  treeVersion.value++
  places.value = []
  useProjectSettings(structuredClone(defaultProjectSettings))
  try {
    useProjectSettings(await request<ProjectSettings>('project.settings.get'))
    await refreshAppState()
    selectRunConfig()
  } catch (error) { notify(`项目已打开，但读取设置失败：${errorMessage(error)}`, true) }
  await refreshSyntheticNodes()
  void offerSessionRestore()
}
// IDEA's Project view keeps two synthetic nodes below the module (ProjectFileNodeImpl):
// "External Libraries" and "Scratches and Consoles". TaoCode has no SDK index, so the
// libraries node lists the configured JAR globs as leaf entries; scratches is the real
// scratch/ folder. Both stay empty when the folder/globs do not exist.
const syntheticNodes = ref<SyntheticNode[]>([])
async function refreshSyntheticNodes() {
  // IDEA's Project view "External Libraries" shows glob strings as leaves (they
  // do not exist on disk to expand), so the synthetic rows must report kind:'file'
  // to stop FileTree from recursively listing them. The "Scratches and Consoles"
  // list under the scratch/ folder keeps the real entries; the leading "scratch/"
  // prefix is added by workspace.list itself, not here.
  const nodes: SyntheticNode[] = [{ path: '\u0000libraries', label: '外部库', icon: 'libraries', entries: [] }]
  for (const glob of projectSettings.value.java.referencedLibraries)
    nodes[0]!.entries.push({ name: glob, path: `\u0000lib:${glob}`, kind: 'file' })
  try {
    const scratches = await request<Entry[]>('workspace.list', { path: 'scratch' })
    nodes.push({ path: '\u0000scratches', label: '临时文件与控制台', icon: 'scratches', entries: scratches.map(item => ({ ...item, path: item.path })) })
  } catch { /* scratch/ may not exist yet */ }
  syntheticNodes.value = nodes
}
async function openWorkspace(path?: string) {
  menu.value = null
  if (working.value || !await confirmLeave('切换项目')) return
  busy.value = true
  try {
    const result = await request<Workspace | null>('workspace.open', path ? { path } : {})
    if (!result) return
    await activateWorkspace(result)
    notify(isDesktop ? `已打开 ${result.root}` : '已打开内存示例；保存不会写入磁盘。')
  } catch (error) { appError.value = errorMessage(error); notify(errorMessage(error), true) }
  finally { busy.value = false }
}
async function closeWorkspace() {
  menu.value = null
  if (working.value || !await confirmLeave('关闭项目并返回欢迎页')) return
  busy.value = true
  try {
    // The user settled every dirty buffer on the way out (save or discard), so the
    // crash-recovery session must not survive as a phantom prompt. Cleared before
    // workspace.close empties the native root.
    if (isDesktop) void request('session.clear').catch(() => undefined)
    await request('workspace.close')
    resetLsp()
    resetHierarchy()
    workspaceEpoch++
    workspace.value = null
    closeAllPanes()
    projectSettings.value = structuredClone(defaultProjectSettings)
    bookmarks.value = []
    places.value = []
    runConfigName.value = ''
    binaryView.value = null
    palette.value = false
    notice.value = ''
    await refreshAppState()
  } catch (error) { notify(errorMessage(error), true) }
  finally { busy.value = false }
}
async function forgetProject(path: string) {
  if (working.value) return
  busy.value = true
  try {
    const state = await request<AppState>('projects.forget', { path })
    recentProjects.value = state.recentProjects
    notify('已从最近项目列表移除，磁盘文件未删除。')
  } catch (error) { appError.value = errorMessage(error) }
  finally { busy.value = false }
}
async function beginProject(mode: 'create' | 'clone') {
  menu.value = null
  if (working.value || !await confirmLeave(mode === 'create' ? '创建并打开新项目' : '克隆并打开项目')) return
  projectError.value = ''
  cloneProgress.splice(0)
  projectForm.value = { parent: defaultParent.value, name: 'untitled', template: 'empty', source: '' }
  projectMode.value = mode
}
async function browseParent() {
  if (busy.value || projectBusy.value) return
  busy.value = true
  try {
    const path = await request<string | null>('dialog.pickDirectory')
    if (path) projectForm.value.parent = path
  } catch (error) { projectError.value = errorMessage(error) }
  finally { busy.value = false }
}
async function submitProject() {
  if (projectBusy.value || busy.value || !projectMode.value) return
  if (!isDesktop) { projectError.value = '请在桌面端创建或克隆项目，浏览器不访问磁盘。'; return }
  const mode = projectMode.value
  const form = { ...projectForm.value }
  projectBusy.value = true
  projectError.value = ''
  try {
    const result = await request<Workspace>(mode === 'create' ? 'project.create' : 'project.clone', form)
    await activateWorkspace(result)
    projectMode.value = null
    notify(`${mode === 'create' ? '已创建' : '已克隆'}并打开 ${result.root}`)
    if (mode === 'create' && form.template === 'java') await openFile('src/Main.java', true)
  } catch (error) { projectError.value = errorMessage(error) }
  finally { projectBusy.value = false; cancelling.value = false }
}
async function cancelProject() {
  if (!projectBusy.value) { projectMode.value = null; return }
  if (projectMode.value !== 'clone' || cancelling.value) return
  cancelling.value = true
  try { await request('project.clone.cancel') }
  catch (error) { projectError.value = errorMessage(error); cancelling.value = false }
}
// IDEA remembers the last-edited configurable (project.structure.last.edited); the
// Window menu jumps straight into a section, so the dialog needs the hint.
const settingsSectionHint = ref<'editor' | 'appearance' | null>(null)
async function openSettings(section?: 'editor' | 'appearance') {
  settingsSectionHint.value = section ?? null
  menu.value = null
  if (working.value) return
  settingsError.value = ''
  settingsOpen.value = true
  if (workspace.value) {
    settingsBusy.value = true
    try { projectSettings.value = await request<ProjectSettings>('project.settings.get') }
    catch (error) { settingsError.value = errorMessage(error) }
    finally { settingsBusy.value = false }
  }
}
// `close` is false for the dialog's 应用 (Apply) button: IDEA's Apply commits the changes and
// keeps the dialog open, only OK closes it (SettingsDialog.java's OK/Apply triple).
async function saveSettings(settings: EditorSettings, close = true) {
  if (settingsBusy.value) return
  settingsBusy.value = true
  settingsError.value = ''
  try {
    editorSettings.value = await request<EditorSettings>('settings.update', { settings })
    if (close) settingsOpen.value = false
    notify(isDesktop ? '编辑器设置已保存并生效。' : '编辑器设置已应用于当前预览会话。')
  } catch (error) { settingsError.value = errorMessage(error) }
  finally { settingsBusy.value = false }
}
// IDEA's commit-message inspections live in Settings › Version Control › Commit
// (CommitDialogConfigurable.kt:66-77) and are stored per project in vcs.xml; the values are
// project-agnostic here, so they persist next to the other `taocode.*` front-end keys.
const commitMessageSettings = ref<CommitMessageInspectionSettings>(readCommitMessageSettings())
function readCommitMessageSettings(): CommitMessageInspectionSettings {
  try { return resolveInspectionSettings(JSON.parse(localStorage.getItem(COMMIT_MESSAGE_INSPECTION_STORAGE_KEY) ?? 'null')) }
  catch { return resolveInspectionSettings(null) }
}
function saveCommitMessageSettings(next: CommitMessageInspectionSettings, close = true) {
  commitMessageSettings.value = resolveInspectionSettings(next)
  try { localStorage.setItem(COMMIT_MESSAGE_INSPECTION_STORAGE_KEY, JSON.stringify(commitMessageSettings.value)) }
  catch { /* storage unavailable: session-only */ }
  if (close) settingsOpen.value = false
  notify('提交信息检查设置已保存。')
}
async function saveProjectSettings(patch: { excludedDirs: string[]; todoPatterns: TodoPattern[] }) {
  if (settingsBusy.value || !workspace.value) return
  settingsBusy.value = true
  settingsError.value = ''
  try {
    const result = await request<{ settings: ProjectSettings; entries: Entry[] }>('project.settings.update', patch)
    projectSettings.value = result.settings
    workspace.value.entries = result.entries
    treeVersion.value++
    settingsOpen.value = false
    notify('项目设置已更新；已打开文件不会关闭。')
  } catch (error) { settingsError.value = errorMessage(error) }
  finally { settingsBusy.value = false }
}
async function saveTemplateSettings(templates: TemplateSettings) {
  if (!workspace.value || settingsBusy.value) return
  const epoch = workspaceEpoch
  settingsBusy.value = true
  settingsError.value = ''
  try {
    const result = await request<{ settings: ProjectSettings }>('project.settings.update', { templates })
    if (epoch !== workspaceEpoch) return
    projectSettings.value = { ...projectSettings.value, templates: result.settings.templates }
    notify('实时模板设置已保存。')
  } catch (error) { if (epoch === workspaceEpoch) settingsError.value = errorMessage(error) }
  finally { settingsBusy.value = false }
}
async function saveJavaSettings(java: JavaProjectSettings) {
  if (!workspace.value || settingsBusy.value) return
  const epoch = workspaceEpoch
  settingsBusy.value = true
  settingsError.value = ''
  try {
    const result = await request<{ settings: ProjectSettings }>('project.settings.update', { java })
    if (epoch !== workspaceEpoch) return
    projectSettings.value = result.settings
    bookmarks.value = [...result.settings.bookmarks]
    notify('Java 项目设置已保存并交给语言服务。')
  } catch (error) { if (epoch === workspaceEpoch) settingsError.value = errorMessage(error) }
  finally { settingsBusy.value = false }
}
// The Project Structure pane's Edit/Browse buttons: pick a directory with the native
// dialog and write it straight into the stored Java settings.
async function browseStructureDir(field: 'jdkHome' | 'outputPath') {
  if (busy.value || settingsBusy.value || !isDesktop) return
  busy.value = true
  try {
    const path = await request<string | null>('dialog.pickDirectory')
    if (path && workspace.value) await saveJavaSettings({ ...projectSettings.value.java, [field]: path })
  } catch (error) { notify(errorMessage(error), true) }
  finally { busy.value = false }
}
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
const pluginOpen = ref(false)
const pluginBusy = ref(false)
const pluginList = ref<PluginInfo[]>([])
async function openPlugins() {
  if (!isDesktop) { notify('浏览器预览不能读取本机插件目录，请在桌面端使用。', true); return }
  pluginBusy.value = true
  try { pluginList.value = (await request<PluginList>('plugin.list')).plugins; pluginOpen.value = true }
  catch (error) { notify(errorMessage(error), true) }
  finally { pluginBusy.value = false }
}
async function togglePlugin(plugin: PluginInfo) {
  try {
    const result = await request<PluginList>('plugin.setEnabled', { id: plugin.id, enabled: !plugin.enabled })
    pluginList.value = result.plugins
    notify(`${plugin.enabled ? '已停用' : '已启用'}插件「${plugin.name || plugin.id}」`)
  } catch (error) { notify(errorMessage(error), true) }
}
// VCS-01/03: worktrees and submodules are two Git views the 源代码管理 tool window
// does not cover, so they get their own dialogs.
const worktreeOpen = ref(false)
const worktreeBusy = ref(false)
const worktrees = ref<GitWorktree[]>([])
const worktreePath = ref('')
const worktreeBranch = ref('')
const worktreeNewBranch = ref(false)
async function openWorktrees() {
  if (!workspace.value || !isDesktop) { notify('请先打开一个 Git 项目。', true); return }
  worktreeBusy.value = true
  try { worktrees.value = (await request<GitWorktrees>('git.worktree.list')).worktrees; worktreeOpen.value = true }
  catch (error) { notify(errorMessage(error), true) }
  finally { worktreeBusy.value = false }
}
async function addWorktree() {
  const path = worktreePath.value.trim()
  if (!path) { notify('请填写工作树路径。', true); return }
  worktreeBusy.value = true
  try {
    const result = await request<GitWorktrees>('git.worktree.add', { path, branch: worktreeBranch.value.trim(), newBranch: worktreeNewBranch.value })
    worktrees.value = result.worktrees
    worktreePath.value = ''; worktreeBranch.value = ''
    notify('已添加工作树。')
  } catch (error) { notify(errorMessage(error), true) }
  finally { worktreeBusy.value = false }
}
async function removeWorktree(path: string) {
  worktreeBusy.value = true
  try { worktrees.value = (await request<GitWorktrees>('git.worktree.remove', { path })).worktrees; notify('已移除工作树。') }
  catch (error) { notify(errorMessage(error), true) }
  finally { worktreeBusy.value = false }
}
const submoduleOpen = ref(false)
const submoduleBusy = ref(false)
const submodules = ref<GitSubmodule[]>([])
async function openSubmodules() {
  if (!workspace.value || !isDesktop) { notify('请先打开一个 Git 项目。', true); return }
  submoduleBusy.value = true
  try { submodules.value = (await request<GitSubmodules>('git.submodules')).submodules; submoduleOpen.value = true }
  catch (error) { notify(errorMessage(error), true) }
  finally { submoduleBusy.value = false }
}
async function updateSubmodules() {
  submoduleBusy.value = true
  try { submodules.value = (await request<GitSubmodules>('git.submodule.update')).submodules; notify('已更新子模块。') }
  catch (error) { notify(errorMessage(error), true) }
  finally { submoduleBusy.value = false }
}
// VCS-01 "Show History for File": `--follow` keeps the log going across renames, and
// picking a commit shows what that commit actually changed.
const fileHistoryOpen = ref(false)
const fileHistoryBusy = ref(false)
const fileHistory = ref<GitFileHistory | null>(null)
const fileHistoryCommit = ref<GitShowCommit | null>(null)
const fileHistorySelected = ref('')
async function showFileHistory(path: string) {
  if (!isDesktop) { notify('浏览器预览不能读取 Git 历史，请在桌面端使用。', true); return }
  fileHistoryBusy.value = true
  fileHistoryCommit.value = null
  fileHistorySelected.value = ''
  try { fileHistory.value = await request<GitFileHistory>('git.fileHistory', { path }); fileHistoryOpen.value = true }
  catch (error) { notify(errorMessage(error), true) }
  finally { fileHistoryBusy.value = false }
}
async function showCommit(revision: string) {
  fileHistoryBusy.value = true
  fileHistorySelected.value = revision
  try { fileHistoryCommit.value = await request<GitShowCommit>('git.showCommit', { revision }) }
  catch (error) { notify(errorMessage(error), true) }
  finally { fileHistoryBusy.value = false }
}
async function startLsp(tab: Tab) {
  setLspDiagnostics(tab.path, [])
  try {
    const opened = await request<LspOpenResult>('lsp.open', { path: tab.path, text: tab.content })
    tab.lspRunning = opened.running
    tab.lspConfigured = opened.configured === true
  }
  catch { tab.lspRunning = false }
  if (tab.path === activePath.value) void refreshOutline(tab.path)
}
function lspOn(tab: Tab) {
  // IDEA PowerSaveMode: code insight is switched off entirely while it is on.
  if (editorSettings.value.powerSaveMode) return false
  return isDesktop && tab.lspRunning === true && tab.content.length <= 5 * 1024 * 1024
}
// IDEA's "save files when the application is idle". Only buffers that actually
// changed are written, and a failed save still surfaces through save()'s own error.
const autoSaveDelay = 5000
let autoSaveTimer: number | undefined
function clearAutoSave() { if (autoSaveTimer) { window.clearTimeout(autoSaveTimer); autoSaveTimer = undefined } }
function scheduleAutoSave() {
  clearAutoSave()
  if (!editorSettings.value.autoSave || !isDesktop || !dirty.value) return
  autoSaveTimer = window.setTimeout(() => { autoSaveTimer = undefined; if (editorSettings.value.autoSave && dirty.value) void saveAll() }, autoSaveDelay)
}
function onEditorChange(tab: Tab) {
  tab.dirty = true
  tab.preview = false
  // IdeDocumentHistory.placeChanged(EditorEvent.DocumentChange): every user edit
  // pushes the caret line onto the "changed places" ring.
  rememberPlace({ kind: '文件', path: tab.path, line: Math.max(0, (editorFor(tab.path)?.getCursor().line ?? tab.line - 1)), label: tab.path, edited: true })
  if (markdownPreviewOn.value && tab.path === activePath.value) refreshMarkdownSoon()
  scheduleAutoSave()
  scheduleSessionSave()  // drafts change on every keystroke, not just on dirty-flip
}
// IDEA's "Last Edit Location" is project-wide (JumpToLastChangeAction reads
// IdeDocumentHistory.changePlaces), so Ctrl+Shift+Backspace follows edits across
// files; the per-editor handler only covers jumps inside one buffer.
function jumpLastEditLocation() {
  const current = active.value
  const here = current ? `${current.path}:${Math.max(0, (editorFor(current.path)?.getCursor().line ?? current.line - 1))}` : ''
  const place = changePlaces.value.find(item => `${item.path}:${item.line}` !== here)
  if (!place) { notify('没有上次编辑位置。', true); return }
  void revealLocation(place)
}
function stopLspFile(path: string) {
  clearLspDiagnostics(path)
  if (isDesktop) void request('lsp.close', { path }).catch(() => undefined)
}
function resetLsp() {
  for (const path of [...lspDiagnostics.keys()]) clearLspDiagnostics(path)
  if (isDesktop) void request('lsp.stop').catch(() => undefined)
}
async function revealLocation(target: { path: string; line: number; column?: number; kind?: Place['kind']; label?: string }, record = true) {
  const epoch = workspaceEpoch
  if (record && activePath.value && (activePath.value !== target.path || (active.value?.line ?? 1) - 1 !== target.line)) {
    navBack.value.push({ path: activePath.value, line: Math.max(0, (active.value?.line ?? 1) - 1) })
    if (navBack.value.length > 100) navBack.value.shift()
    navForward.value = []
  }
  if (!hasTabPath(target.path)) {
    await openFile(target.path)
    if (epoch !== workspaceEpoch) return
    if (!hasTabPath(target.path)) { notify(`无法打开定义位置 ${target.path}`, true); return }
    // openFile records the fresh file at line 0; a jump owns the real destination.
    places.value = places.value.filter(item => item.path !== target.path)
  }
  // IDEA jumps in whichever pane already shows the file; otherwise the focused pane.
  const pane = groups[0].tabs.some(tab => tab.path === target.path) ? 0 as const : groups[1].tabs.some(tab => tab.path === target.path) ? 1 as const : splitModel.focused
  splitModel.focused = pane
  groups[pane].activePath = target.path
  await nextTick()
  if (epoch !== workspaceEpoch) return
  reveal.value = { path: target.path, line: target.line, ...(target.column ? { column: target.column } : {}) }
  rememberPlace({ kind: target.kind ?? '文件', path: target.path, line: target.line, label: target.label ?? target.path })
}
async function goBack() {
  const from = navBack.value.pop()
  if (!from) return
  navForward.value.push({ path: activePath.value, line: Math.max(0, (active.value?.line ?? 1) - 1) })
  await revealLocation(from, false)
}
async function goForward() {
  const to = navForward.value.pop()
  if (!to) return
  navBack.value.push({ path: activePath.value, line: Math.max(0, (active.value?.line ?? 1) - 1) })
  await revealLocation(to, false)
}
// Menu and keyboard reach the two prompts through the same opener, which owns the
// focus/selection step the prompt needs.
function openGoLine() { goLineValue.value = ''; goLinePrompt.value = true; void nextTick(() => goLineInput.value?.select()) }
function openRecentFiles() { recentQuery.value = ''; recentPrompt.value = true; void nextTick(() => recentInput.value?.focus()) }
const placesPrompt = ref(false)
const placesQuery = ref('')
const placesInput = ref<HTMLInputElement>()
// RecentLocationsAction: the checkbox toggles navigation places vs change places, and
// the popup title follows it ("Recent Locations" / "Recently Edited Locations").
const placesEditedOnly = ref(false)
const placesList = computed(() => placesEditedOnly.value ? changePlaces.value : places.value)
// RecentLocationsRenderer shows the caret line's snippet; buffers are live in memory.
function placeSnippet(place: Place): { text: string; firstLine: number } {
  const tab = findTab(place.path)
  if (!tab) return { text: '', firstLine: 0 }
  return locationSnippet(tab.content.split(/\r?\n/), Math.min(place.line, Math.max(0, tab.content.split(/\r?\n/).length - 1)))
}
const placesFiltered = computed(() => {
  const query = placesQuery.value.trim().toLowerCase()
  return query ? placesList.value.filter(place => place.label.toLowerCase().includes(query) || place.path.toLowerCase().includes(query)) : placesList.value
})
// ScrollingUtil.installActions + ENTER: the list keeps a highlighted row, Enter jumps.
const placesIndex = ref(0)
function movePlace(step: number) {
  const size = Math.max(1, placesFiltered.value.length)
  placesIndex.value = (placesIndex.value + step + size) % size
}
watch(placesQuery, () => { placesIndex.value = 0 })
watch(placesEditedOnly, () => { placesIndex.value = 0 })
function openRecentPlaces() {
  placesQuery.value = ''
  menu.value = null
  palette.value = false; symbolPrompt.value = null; recentPrompt.value = false
  placesPrompt.value = true
  void nextTick(() => placesInput.value?.focus())
}
function openPlace(place: Place) { placesPrompt.value = false; void revealLocation(place) }
function fileSymbolEntries(query: string): SymbolEntry[] {
  const path = activePath.value
  if (!path) return []
  const q = query.trim().toLowerCase()
  return outline.value
    .filter(symbol => !q || symbol.name.toLowerCase().includes(q))
    .slice(0, 200)
    .map(symbol => ({ name: symbol.name, kind: symbol.kind, path, line: symbol.startLine, character: symbol.startChar }))
}
async function globalSymbolEntries(query: string) {
  const q = query.trim()
  if (!isDesktop || !workspace.value || q.length < 2) { symbolResults.value = []; return }
  try {
    const result = await request<{ available: boolean; symbols?: SymbolEntry[] }>('lsp.request', { kind: 'workspaceSymbol', path: activePath.value ?? '', query: q })
    const all = result.symbols ?? []
    symbolResults.value = (symbolPrompt.value?.mode === 'class' ? all.filter(entry => CLASS_KINDS.has(entry.kind)) : all).slice(0, 200)
  } catch { symbolResults.value = [] }
}
function openSymbol(mode: 'file' | 'global' | 'class') {
  menu.value = null
  if (!active.value) return
  symbolPrompt.value = { mode }
  symbolQuery.value = ''
  symbolResults.value = mode === 'file' ? fileSymbolEntries('') : []
  // 'class' needs two characters typed (the same threshold as the LSP query), so the
  // list starts empty and fills as the user types.
  symbolIndex.value = 0
  void nextTick(() => symbolInput.value?.focus())
}
function onSymbolQuery() {
  symbolIndex.value = 0
  if (symbolPrompt.value?.mode === 'file') { symbolResults.value = fileSymbolEntries(symbolQuery.value); return }
  if (symbolTimer !== undefined) clearTimeout(symbolTimer)
  symbolTimer = window.setTimeout(() => void globalSymbolEntries(symbolQuery.value), 250)
}
function moveSymbol(delta: number) {
  const count = symbolResults.value.length
  if (!count) return
  symbolIndex.value = (symbolIndex.value + delta + count) % count
}
async function jumpSymbol(entry: SymbolEntry) {
  symbolPrompt.value = null
  await revealLocation({ path: entry.path, line: entry.line, kind: '符号', label: entry.name })
}
async function onSearchOpen(payload: { path: string; line: number }) {
  await revealLocation({ path: payload.path, line: Math.max(0, payload.line - 1) })
}
// A replace rewrites files behind the editors' backs: reload every open buffer whose
// path was touched, then refresh the tree so the UI never shows stale content.
async function onSearchReplaced(payload: { paths: string[] }) {
  for (const path of payload.paths) {
    const tab = findTab(path)
    if (!tab || tab.dirty) continue   // never clobber unsaved edits
    try {
      const doc = await request<DocumentData>('file.read', { path })
      tab.content = doc.content
      tab.version = doc.version
      tab.readOnly = doc.readOnly
      // The editor holds its own buffer, so the new text has to be pushed into it.
      editorFor(path)?.setDraft(doc.content)
    } catch { /* the file may have been moved mid-replace */ }
  }
  await refreshTree()
}
function wordAt(text: string, line0: number, char0: number) {
  const line = text.split('\n')[line0] ?? ''
  const head = /[A-Za-z0-9_$]*$/.exec(line.slice(0, char0))?.[0] ?? ''
  const tail = /^[A-Za-z0-9_$]*/.exec(line.slice(char0))?.[0] ?? ''
  return head + tail
}
function offsetOf(lines: string[], line: number, character: number) {
  let offset = 0
  for (let i = 0; i < line; i++) offset += (lines[i]?.length ?? 0) + 1
  return offset + Math.min(character, lines[line]?.length ?? 0)
}
// LSP TextEdits are 0-based half-open ranges; applied last→first so earlier
// offsets stay valid. Ranges come from the language service, disjoint by design.
function applyTextEdits(content: string, edits: LspTextEdit[]) {
  const lines = content.split('\n')
  return edits
    .map(edit => ({ text: edit.text, from: offsetOf(lines, edit.startLine, edit.startChar), to: offsetOf(lines, edit.endLine, edit.endChar) }))
    .sort((a, b) => b.from - a.from)
    .reduce((text, edit) => text.slice(0, edit.from) + edit.text + text.slice(edit.to), content)
}
async function refreshOutline(path: string) {
  const tab = findTab(path)
  if (!tab || !lspOn(tab)) { outline.value = []; return }
  try {
    const result = await request<{ available: boolean; symbols?: LspDocumentSymbol[] }>('lsp.request', { kind: 'documentSymbol', path })
    outline.value = result.available ? result.symbols ?? [] : []
  } catch { outline.value = [] }
}
async function onSemantic(payload: { kind: 'rename' | 'references' | 'codeAction' | 'format' | 'signature' | 'implementation' | 'callHierarchy' | 'typeHierarchy'; path: string; line: number; character: number; range?: LspRange }) {
  const tab = findTab(payload.path)
  if (!tab || !lspOn(tab)) { notify('该文件未启用语言服务。', true); return }
  if (payload.kind === 'rename') {
    if (tab.dirty && !await save(tab)) return
    renamePrompt.value = { path: payload.path, line: payload.line, character: payload.character, current: wordAt(tab.content, payload.line, payload.character) }
    renameValue.value = renamePrompt.value.current
    await nextTick()
    renameInput.value?.select()
    return
  }
  if (payload.kind === 'format') { await runFormatting(payload.path, payload.range); return }
  if (payload.kind === 'signature') { await runSignature(payload); return }
  if (payload.kind === 'codeAction') { await openCodeActions(payload); return }
  if (payload.kind === 'callHierarchy') { await prepareHierarchy('call', payload); return }
  if (payload.kind === 'typeHierarchy') { await prepareHierarchy('type', payload); return }
  try {
    // references and implementation share the same "go to a list of locations" UI.
    showOutput('references')
    references.value = []
    const result = await request<LspReferencesResult>('lsp.request', { kind: payload.kind, path: payload.path, line: payload.line, character: payload.character })
    references.value = result.refs ?? []
    if (!references.value.length) notify('没有找到结果。')
  } catch (error) { notify(errorMessage(error), true) }
}
// Reformat: a live selection goes through rangeFormatting (IDEA's "reformat the
// selected lines"), otherwise the whole buffer.
async function runFormatting(path: string, range?: LspRange) {
  try {
    const result = await request<LspFormatResult>('lsp.request', {
      kind: range ? 'rangeFormatting' : 'formatting', path, line: 0, character: 0, ...(range ? { range } : {}),
    })
    if (!result.available || !result.edits?.length) { notify(range ? '所选内容无需格式化，或语言服务不支持选区格式化。' : '无需格式化，或语言服务不支持格式化。'); return }
    let touched = 0
    for (const file of result.edits) {
      const open = findTab(file.path)
      if (!open) continue  // formatting only makes sense on an open buffer
      const base = editorFor(file.path)?.text() ?? open.content
      const next = applyTextEdits(base, file.textEdits)
      if (next === base) continue
      editorFor(file.path)?.setDraft(next)
      open.dirty = true  // buffer preview; user reviews then Ctrl+S
      ++touched
    }
    notify(touched ? '已格式化当前缓冲（未保存），检查后按 Ctrl+S 保存。' : '格式已是最新。')
  } catch (error) { notify(errorMessage(error), true) }
}
async function runSignature(payload: { path: string; line: number; character: number }) {
  try {
    const result = await request<LspSignatureHelpResult>('lsp.request', { kind: 'signatureHelp', path: payload.path, line: payload.line, character: payload.character })
    if (!result.available || !result.signatures?.length) { notify('此处没有可用的签名信息。', true); return }
    // Show as a persistent popup near the cursor instead of a transient toast.
    const editor = editorFor(payload.path)
    const rect = editor?.getCursorCoords()
    signaturePopup.value = {
      signatures: result.signatures,
      activeIndex: result.activeSignature ?? 0,
      activeParam: result.activeParameter ?? 0,
      x: rect?.left ?? 200,
      y: rect?.bottom ?? 200,
    }
  } catch (error) { notify(errorMessage(error), true) }
}
// Signature help popup state: IDEA's parameter info panel with overload navigation.
const signaturePopup = ref<{ signatures: { label: string; documentation?: string }[]; activeIndex: number; activeParam: number; x: number; y: number } | null>(null)
function closeSignaturePopup() { signaturePopup.value = null }
function navigateSignature(delta: number) {
  if (!signaturePopup.value) return
  const total = signaturePopup.value.signatures.length
  signaturePopup.value.activeIndex = (signaturePopup.value.activeIndex + delta + total) % total
}
// IDEA's Code Cleanup / batch quick-fix: walk the file's diagnostics and apply the
// single unambiguous preferred fix per problem, looping while new diagnostics with
// fixes keep appearing (bounded, so a fixer that keeps re-triggering cannot loop).
const batchFixBusy = ref(false)
async function fixAllInFile() {
  const tab = active.value
  if (!tab || !lspOn(tab) || batchFixBusy.value) { notify('批量修复需要语言服务。', true); return }
  batchFixBusy.value = true
  let applied = 0
  try {
    for (let pass = 0; pass < 25; ++pass) {
      const problems = (lspDiagnostics.get(tab.path) ?? []).filter(item => item.severity <= 2)
      if (!problems.length) break
      let fixedThisPass = 0
      for (const problem of problems) {
        const diagnostics = (lspDiagnostics.get(tab.path) ?? []).filter(item => item.line === problem.line).map(item => ({
          range: { start: { line: item.line, character: item.character }, end: { line: item.endLine ?? item.line, character: item.endCharacter ?? item.character } },
          severity: item.severity, message: item.message, ...(item.source ? { source: item.source } : {}) }))
        const result = await request<LspCodeActionResults>('lsp.request', { kind: 'codeAction', path: tab.path, line: problem.line, character: problem.character, diagnostics })
        const fixes = (result.actions ?? []).filter(action => action.preferred || action.linkedDiagnostics)
        if (fixes.length !== 1) continue  // ambiguous or nothing: leave for Alt+Enter
        actionPrompt.value = { path: tab.path }
        codeActions.value = fixes
        await applyCodeAction(fixes[0]!)
        actionPrompt.value = null
        ++fixedThisPass
        break  // diagnostics shifted under us; restart the pass from the new state
      }
      if (!fixedThisPass) break
      applied += fixedThisPass
    }
    notify(applied ? `批量修复：已应用 ${applied} 处修复，剩余问题可在 Alt+Enter 中逐个处理。` : '没有可自动应用的快速修复（存在需要人工选择的操作）。')
  } catch (error) { notify(errorMessage(error), true) }
  finally { batchFixBusy.value = false }
}
async function openCodeActions(payload: { path: string; line: number; character: number }, onlyFixes = false) {
  const diagnostics = (lspDiagnostics.get(payload.path) ?? []).filter(item => item.line === payload.line).map(item => ({
    range: { start: { line: item.line, character: item.character }, end: { line: item.endLine ?? item.line, character: item.endCharacter ?? item.character } },
    severity: item.severity, message: item.message, ...(item.source ? { source: item.source } : {}) }))
  try {
    const result = await request<LspCodeActionResults>('lsp.request', { kind: 'codeAction', path: payload.path, line: payload.line, character: payload.character, diagnostics })
    // IDEA's "Show Fix…" variants keep only actions that actually fix a diagnostic;
    // the server marks those with `isPreferred` or a `diagnostics` backlink.
    let actions = result.actions ?? []
    if (onlyFixes) actions = actions.filter(action => action.preferred || action.linkedDiagnostics)
    if (!actions.length) { notify(onlyFixes ? '当前行没有与问题关联的快速修复。' : '此处没有可用的代码操作。'); return }
    if (actions.length === 1) { await applyCodeAction(actions[0]!); return }
    codeActions.value = actions
    actionPrompt.value = { path: payload.path }
  } catch (error) { notify(errorMessage(error), true) }
}
// Menu rows without an event payload ask for the caret position of the active file.
function caretPayload() {
  const tab = active.value!
  const cursor = editorFor(tab.path)?.getCursor() ?? { line: tab.line - 1, ch: 0 }
  return { path: tab.path, line: cursor.line, character: cursor.ch }
}
async function applyCodeAction(action: LspCodeAction) {
  const path = actionPrompt.value?.path ?? activePath.value
  actionPrompt.value = null
  let edits = action.edits ?? []
  if (!edits.length) {
    if (!action.resolvable || !path) { notify('该操作没有可应用的编辑。', true); return }
    // The server listed the action without its edit; codeAction/resolve hands it over.
    try {
      const resolved = await request<LspFormatResult>('lsp.request', { kind: 'codeActionResolve', path, line: 0, character: 0, index: action.index })
      edits = resolved.edits ?? []
    } catch (error) { notify(errorMessage(error), true); return }
    if (!edits.length) { notify(`语言服务没有为「${action.title}」返回编辑（它可能需要执行命令）。`, true); return }
  }
  await applyEditsToFiles(edits, `已应用代码操作：${action.title}`)
}
// Apply a WorkspaceEdit (from rename or a code action) across files: write each
// through the normal safe-save path, then refresh any open buffer + the server.
// Each file keeps the encoding it was read with — otherwise refactoring one GBK file
// would silently rewrite it as UTF-8.
async function applyEditsToFiles(edits: LspFileEdits[], doneMessage: string) {
  let count = 0
  for (const file of edits) {
    const open = findTab(file.path)
    let content = open?.content
    let version = open?.version
    let encoding = open?.encoding ?? 'utf-8'
    let bom = open?.bom ?? false
    if (content === undefined || version === undefined) {
      const doc = await request<DocumentData>('file.read', { path: file.path })
      content = doc.content; version = doc.version; encoding = doc.encoding; bom = doc.bom
    }
    const next = applyTextEdits(content, file.textEdits)
    if (next === content) continue
    const saved = await request<SaveResult>('file.write', { path: file.path, content: next, expectedVersion: version, encoding, bom })
    if (open) { open.content = next; open.version = saved.version; open.dirty = false; editorFor(file.path)?.setDraft(next) }
    if (isDesktop) void request('lsp.change', { path: file.path, text: next }).catch(() => undefined)
    ++count
  }
  notify(`${doneMessage} · 更新 ${count} 个文件`)
  return count
}
function submitRename() {
  const target = renamePrompt.value
  const next = renameValue.value.trim()
  if (!target || !next) return
  if (invalidRenameName.value) { notify(invalidRenameName.value, true); return }
  renamePrompt.value = null
  void applyRename(target, next)
}
async function applyRename(target: { path: string; line: number; character: number; current: string }, newName: string) {
  try {
    const result = await request<LspRenameResult>('lsp.request', { kind: 'rename', path: target.path, line: target.line, character: target.character, newName })
    if (!result.available || !result.edits?.length) { notify('语言服务无法重命名此符号。', true); return }
    await applyEditsToFiles(result.edits, `已重命名为 ${newName}`)
    if (target.path === activePath.value) await refreshOutline(target.path)
  } catch (error) { notify(errorMessage(error), true) }
}
function toggleOutline() {
  explorer.value = true
  if (leftView.value === 'outline') { leftView.value = 'files'; return }
  leftView.value = 'outline'
  void refreshOutline(activePath.value)
}
async function jumpDebugLocation(target: { path?: string; line: number }) {
  const path = target.path ?? activePath.value
  if (!path) return
  await revealLocation({ path, line: Math.max(0, target.line - 1) })  // DAP is 1-based; reveal is 0-based
}
async function toggleBreakpointAt(path: string, line1: number) {
  if (!path || !isDesktop) return
  const current = dapBreakpoints.get(path) ?? []
  const next = current.some(point => point.line === line1)
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
    const saved = await request<SaveResult>('file.write', { path, content: snapshot.content, expectedVersion: version, encoding, bom })
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
    const result = await request<SaveResult>('file.write', { path: tab.path, content, expectedVersion: tab.version, encoding: tab.encoding, bom: tab.bom })
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
const conflictPrompt = ref<{ path: string } | null>(null)
async function resolveConflictReload() {
  const target = conflictPrompt.value
  conflictPrompt.value = null
  if (!target) return
  const tab = findTab(target.path)
  if (!tab || !isDesktop) return
  try {
    const doc = await request<DocumentData>('file.read', { path: tab.path, encoding: tab.encoding })
    Object.assign(tab, { content: doc.content, version: doc.version, encoding: doc.encoding, bom: doc.bom, dirty: false })
    editorFor(tab.path)?.setDraft(doc.content)
    editorFor(tab.path)?.markSaved()
    if (tab.lspRunning) void request('lsp.change', { path: tab.path, text: doc.content }).catch(() => undefined)
    notify(`已重新载入磁盘上的 ${tab.path}`)
  } catch (error) { notify(errorMessage(error), true) }
}
function resolveConflictKeep() {
  const target = conflictPrompt.value
  conflictPrompt.value = null
  if (target) notify(`已保留 ${target.path} 的当前修改；外部改动不会被覆盖，下次保存前请先自行核对。`)
}
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
// IDEA's Quick Documentation (Ctrl+Q): fetches hover at the caret and shows it in a
// persistent popup instead of the transient tooltip. The popup closes on Escape or
// any click outside, matching IDEA's own dismiss behavior.
const quickDoc = ref<{ contents: string; x: number; y: number } | null>(null)
async function showQuickDoc() {
  const tab = active.value
  if (!tab || !lspReady.value) { notify('请先打开一个有语言服务的文件。', true); return }
  menu.value = null
  const editor = editorFor(tab.path)
  if (!editor) return
  const pos = editor.getCursor()
  try {
    const result = await request<LspHoverResult>('lsp.request', { kind: 'hover', path: tab.path, line: pos.line, character: pos.ch })
    if (!result.available || !result.contents) { notify('此处没有文档。', true); return }
    const rect = editorFor(tab.path)?.getCursorCoords()
    quickDoc.value = { contents: result.contents, x: rect?.left ?? 200, y: rect?.bottom ?? 200 }
  } catch (error) { notify(errorMessage(error), true) }
}
function closeQuickDoc() { quickDoc.value = null }
// IDEA's Copy Reference (Ctrl+Alt+Shift+C): copies the qualified name of the symbol
// at the caret when LSP provides it, otherwise copies the file path.
async function copyReference() {
  const tab = active.value
  if (!tab) return
  menu.value = null
  try {
    if (lspReady.value) {
      const editor = editorFor(tab.path)
      if (editor) {
        const pos = editor.getCursor()
        const symbols = await request<LspSymbolsResult>('lsp.request', { kind: 'documentSymbol', path: tab.path })
        if (symbols.available && symbols.symbols) {
          const match = symbols.symbols.find(s => 'startLine' in s && s.startLine === pos.line)
          if (match) { void navigator.clipboard?.writeText(match.name); notify(`已复制：${match.name}`); return }
        }
      }
    }
    void navigator.clipboard?.writeText(tab.path)
    notify(`已复制路径：${tab.path}`)
  } catch { notify('无法复制到剪贴板。', true) }
}
// IDEA has no "File Properties" dialog — the file's attributes live in the
// FilePropertiesGroup popup (encoding, file type, read-only, line separators), so
// the tree row toggles the one attribute with a backend here.
async function showFileProperties() {
  const entry = treeMenu.value?.entry
  if (!entry) return
  if (entry.kind !== 'file') { treeMenu.value = null; notify('目录没有只读属性操作。'); return }
  await toggleReadOnly(entry.path)
}
// ConvertToWindows/UnixLineSeparatorsAction: rewrite the file on disk with every line
// ending normalized, then reload the buffer (IDEA refreshes the document too). The
// native side refuses a locked or externally modified file before touching anything.
async function convertLineSeparators(separator: 'crlf' | 'lf', target?: Tab) {
  const tab = target ?? active.value
  if (!tab) { notify('请先打开一个文件。', true); return }
  menu.value = null
  treeMenu.value = null
  if (!isDesktop) { notify('行分隔符转换需要桌面端。', true); return }
  if (tab.dirty) { notify('请先保存修改，再转换行分隔符。', true); return }
  try {
    const result = await request<{ path: string; version: string; changed: boolean }>('file.lineSeparators',
      { path: tab.path, separator, content: editorFor(tab.path)?.text() ?? tab.content, expectedVersion: tab.version })
    if (!result.changed) { notify(`${tab.path} 已经全部是${separator === 'crlf' ? ' Windows (CRLF)' : ' Unix (LF)'}行尾，无需转换。`); return }
    // Reload from disk so the buffer carries the file's own separators — CodeMirror
    // splits with EditorState.lineSeparator and would otherwise re-save LF.
    const doc = await request<DocumentData>('file.read', { path: tab.path, encoding: tab.encoding })
    Object.assign(tab, { content: doc.content, version: doc.version, readOnly: doc.readOnly })
    // CodeMirror splits the document with EditorState.lineSeparator only at state
    // creation, so a separator-only change needs one remount to show CRLF again.
    bufferEpoch.value++
    if (tab.lspRunning) void request('lsp.change', { path: tab.path, text: doc.content }).catch(() => undefined)
    notify(`已将 ${tab.path} 转换为${separator === 'crlf' ? ' Windows (CRLF)' : ' Unix and macOS (LF)'}行尾`)
  } catch (error) { notify(errorMessage(error), true) }
}
// IDEA's two encoding actions: re-read the same bytes under another code page (writes
// nothing), or keep the buffer text and rewrite the file in another encoding.
const encodingPrompt = ref<{ encoding: EncodingKey; bom: boolean } | null>(null)
const encodingSelect = ref<HTMLSelectElement>()
function openEncoding() {
  const tab = active.value
  if (!tab) { notify('请先打开一个文件。', true); return }
  menu.value = null
  encodingPrompt.value = { encoding: tab.encoding, bom: tab.bom }
  void nextTick(() => encodingSelect.value?.focus())
}
async function reloadWithEncoding() {
  const tab = active.value, choice = encodingPrompt.value
  if (!tab || !choice || tab.dirty) return
  try {
    const doc = await request<DocumentData>('file.read', { path: tab.path, encoding: choice.encoding })
    // A re-read can land on a file that was locked meanwhile; refresh the flag too.
    Object.assign(tab, { content: doc.content, version: doc.version, encoding: doc.encoding, bom: doc.bom, readOnly: doc.readOnly, dirty: false })
    editorFor(tab.path)?.setReadOnly(Boolean(doc.readOnly))
    editorFor(tab.path)?.setDraft(doc.content)
    if (isDesktop) void request('lsp.change', { path: tab.path, text: doc.content }).catch(() => undefined)
    encodingPrompt.value = null
    notify(`已按 ${encodingLabels[doc.encoding]} 重新读取 ${tab.path}`)
  } catch (error) { notify(errorMessage(error), true) }
}
function applyEncodingChoice() {
  const tab = active.value, choice = encodingPrompt.value
  if (!tab || !choice) return
  tab.encoding = choice.encoding
  tab.bom = choice.bom
  // The text is unchanged; marking the buffer dirty is what makes the next save write
  // the same characters back as new bytes.
  tab.dirty = true
  encodingPrompt.value = null
  notify(`已切换为 ${encodingLabels[choice.encoding]}${choice.bom ? '（带 BOM）' : ''}，保存时按该编码写入 ${tab.path}`)
}
async function closeTab(tab: Tab) {
  const pane = (groups[0].tabs.includes(tab) ? 0 : 1) as 0 | 1
  await closeTabIn(pane, tab)
}
// Zen mode: IDEA's View → Appearance → Zen Mode hides every chrome element.
function toggleZenMode() { zenMode.value = !zenMode.value }
// IDEA's Markdown preview: a split beside the editor, toggled per file; the toggle
// button only exists for .md buffers and the preview follows the live text.
const markdownPreviewOn = ref(false)
const markdownCapable = computed(() => /\.md$/i.test(active.value?.path ?? ''))
const markdownSource = ref('')
let markdownTimer: number | undefined
function refreshMarkdownNow() {
  const path = activePath.value
  markdownSource.value = path && /\.md$/i.test(path) ? editorFor(path)?.text() ?? findTab(path)?.content ?? '' : ''
}
function refreshMarkdownSoon() {
  if (!markdownPreviewOn.value) return
  if (markdownTimer !== undefined) return
  markdownTimer = window.setTimeout(() => { markdownTimer = undefined; refreshMarkdownNow() }, 300)
}
function toggleMarkdownPreview() {
  markdownPreviewOn.value = !markdownPreviewOn.value
  if (markdownPreviewOn.value) refreshMarkdownNow()
}
watch(activePath, () => {
  if (!markdownCapable.value) markdownPreviewOn.value = false
  else if (markdownPreviewOn.value) refreshMarkdownNow()
})
async function refreshTree() {
  if (!workspace.value || busy.value) return
  busy.value = true
  try {
    workspace.value.entries = await request<Entry[]>('workspace.list', { path: '' })
    treeVersion.value++
  } catch (error) { notify(errorMessage(error), true) }
  finally { busy.value = false }
  await refreshSyntheticNodes()
}
function selectInTree() {
  if (!active.value) return
  explorer.value = true
  leftView.value = 'files'
  fileTreeRef.value?.reveal(active.value.path)
}
function openBreadcrumb(segmentIndex: number) {
  if (!active.value) return
  const dir = active.value.path.split('/').slice(0, segmentIndex + 1).join('/')
  explorer.value = true
  leftView.value = 'files'
  fileTreeRef.value?.reveal(dir)
}
const treeMenu = ref<{ entry: Entry; x: number; y: number } | null>(null)
// IDEA's project-view popup nests groups (WeighingNewGroup, AssociateWithFileType,
// VersionControlsGroup); the submenu id tracks which one is unfolded.
const treeSubmenu = ref<'new' | 'filetype' | null>(null)
// IDEA's Cut/Copy/Paste on project-view selections: an internal clipboard, because
// the WebView sandbox cannot carry CF_HDROP. Cut pastes as a move, copy as a copy;
// a name collision pastes as "<stem> copy<ext>", then "copy 2", "copy 3"…
const fileClipboard = ref<{ mode: 'cut' | 'copy'; entry: Entry } | null>(null)
function copyCollisionName(existing: (name: string) => boolean, name: string): string {
  if (!existing(name)) return name
  const dot = name.lastIndexOf('.')
  const stem = dot <= 0 ? name : name.slice(0, dot)
  const extension = dot <= 0 ? '' : name.slice(dot)
  let candidate = `${stem} copy${extension}`
  for (let index = 2; existing(candidate); ++index) candidate = `${stem} copy ${index}${extension}`
  return candidate
}
async function pasteFromClipboard() {
  const clip = fileClipboard.value
  const target = treeMenu.value?.entry
  treeMenu.value = null
  if (!clip || !workspace.value || !isDesktop) return
  const dir = target ? (target.kind === 'directory' ? target.path : parentOf(target.path)) : ''
  try {
    // Probe the destination listing to pick a collision-free name (IDEA's pasted
    // duplicates become "X copy.ext"); the native layer still guards EXISTS races.
    let siblings: Entry[] = []
    try { siblings = await request<Entry[]>('workspace.list', { path: dir }) } catch { /* empty/new dir */ }
    const taken = (name: string) => siblings.some(entry => entry.name.localeCompare(name, undefined, { sensitivity: 'base' }) === 0)
    const finalName = copyCollisionName(taken, baseName(clip.entry.path))
    const destination = dir ? `${dir}/${finalName}` : finalName
    if (clip.mode === 'copy') await request('file.copy', { from: clip.entry.path, to: destination })
    else {
      await request('file.rename', { from: clip.entry.path, to: destination })
      await retitleTab(clip.entry.path, destination)
    }
    await refreshTree()
    notify(clip.mode === 'copy' ? `已粘贴为 ${destination}` : `已移动到 ${destination}`)
    if (clip.mode === 'cut') fileClipboard.value = null
  } catch (error) { notify(errorMessage(error), true) }
}
function cutTreeEntry() {
  const entry = treeMenu.value?.entry
  treeMenu.value = null
  if (!entry) return
  fileClipboard.value = { mode: 'cut', entry }
  notify(`已剪切 ${entry.path}（在目标目录上右键粘贴）`)
}
function copyTreeEntry() {
  const entry = treeMenu.value?.entry
  treeMenu.value = null
  if (!entry) return
  fileClipboard.value = { mode: 'copy', entry }
  notify(`已复制 ${entry.path}（在目标目录上右键粘贴）`)
}
async function revealInExplorer() {
  const entry = treeMenu.value?.entry
  treeMenu.value = null
  if (!entry || !isDesktop) return
  try { await request('file.reveal', { path: entry.path }) }
  catch (error) { notify(errorMessage(error), true) }
}
// IDEA's EditorTabPopup (ActionsBundle "Close All but Pinned", tab pinning): right-
// click on a tab opens the group-scoped actions for that tab.
const tabMenu = ref<{ pane: Pane; path: string; x: number; y: number } | null>(null)
function onTabContext(pane: Pane, tab: Tab, event: MouseEvent) {
  event.preventDefault()
  menu.value = null
  treeMenu.value = null
  tabMenu.value = { pane, path: tab.path, x: event.clientX, y: event.clientY }
}
function togglePinTab(pane: Pane, tab: Tab) {
  tab.pinned = !tab.pinned
  tabMenu.value = null
}
async function closeOtherTabsIn(pane: Pane, keep: Tab) {
  tabMenu.value = null
  for (const tab of [...groups[pane].tabs]) if (tab !== keep) await closeTabIn(pane, tab)
}
async function closeAllTabsIn(pane: Pane) {
  tabMenu.value = null
  for (const tab of [...groups[pane].tabs]) await closeTabIn(pane, tab)
}
async function closeUnpinnedTabsIn(pane: Pane) {
  tabMenu.value = null
  // IDEA keeps pinned tabs out of every bulk close, including this one.
  for (const tab of [...groups[pane].tabs]) if (!tab.pinned) await closeTabIn(pane, tab)
}
async function closeTabsToRightIn(pane: Pane, from: Tab) {
  tabMenu.value = null
  const group = groups[pane]
  const index = group.tabs.indexOf(from)
  if (index < 0) return
  for (const tab of [...group.tabs.slice(index + 1)]) await closeTabIn(pane, tab)
}
// CloseAllToTheLeft in the same group.
async function closeTabsToLeftIn(pane: Pane, from: Tab) {
  tabMenu.value = null
  const group = groups[pane]
  const index = group.tabs.indexOf(from)
  if (index <= 0) return
  for (const tab of [...group.tabs.slice(0, index)]) await closeTabIn(pane, tab)
}
function hasTabsToRight(pane: Pane, path: string) {
  const group = groups[pane]
  const index = group.tabs.findIndex(tab => tab.path === path)
  return index >= 0 && index < group.tabs.length - 1
}
function hasTabsToLeft(pane: Pane, path: string) {
  return groups[pane].tabs.findIndex(tab => tab.path === path) > 0
}
function copyPathOfTab(tab: Tab) {
  tabMenu.value = null
  const fullPath = workspace.value ? `${workspace.value.root}/${tab.path}` : tab.path
  void navigator.clipboard?.writeText(fullPath)
  notify(`已复制路径：${fullPath}`)
}
const nameDialog = ref<{ mode: 'createFile' | 'createDir' | 'rename' | 'newLayout' | 'renameLayout'; dir: string; entry?: Entry; value: string; template?: string } | null>(null)
const nameInput = ref<HTMLInputElement>()
// The same dialog serves the layout actions, whose prompt is `IdeBundle`
// `dialog.new.window.layout.prompt` / `dialog.rename.window.layout.prompt` (:426-429) instead of a
// path. Everything else about the dialog is unchanged.
const isLayoutDialog = computed(() => nameDialog.value?.mode === 'newLayout' || nameDialog.value?.mode === 'renameLayout')
const nameDialogTitle = computed(() => {
  switch (nameDialog.value?.mode) {
    case 'rename': return '重命名'
    case 'createDir': return '新建文件夹'
    case 'newLayout': return '新建布局'
    case 'renameLayout': return '重命名布局'
    default: return '新建文件'
  }
})
const deleteTarget = ref<Entry | null>(null)
// IDEA's Safe Delete: before removing a file, show what still refers to it. The
// scan is a real workspace search (file + line + preview), not a guess.
const deleteUsages = ref<UsageResult | null>(null)
const deleteUsagesError = ref('')
// IDEA puts the "Safe delete (move to recycle bin)" checkbox in the confirm dialog
// and remembers the choice, so it is stored with the editor settings instead of
// being a per-call `ref` that resets on every reload.
const trashSaving = ref(false)
const deleteToTrash = computed({
  get: () => editorSettings.value.deleteToTrash,
  set: value => {
    if (trashSaving.value) return
    const previous = editorSettings.value
    editorSettings.value = { ...previous, deleteToTrash: value }
    trashSaving.value = true
    void (async () => {
      try { editorSettings.value = await request<EditorSettings>('settings.update', { settings: editorSettings.value }) }
      catch (error) {
        editorSettings.value = previous
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
const goLinePrompt = ref(false)
const goLineValue = ref('')
const goLineInput = ref<HTMLInputElement>()
const recentPrompt = ref(false)
const recentQuery = ref('')
const recentInput = ref<HTMLInputElement>()
const recentFiles = ref<string[]>([])
function rememberRecent(path: string) { recentFiles.value = [path, ...recentFiles.value.filter(item => item !== path)].slice(0, 40) }
const recentFiltered = computed(() => { const query = recentQuery.value.toLowerCase(); return recentFiles.value.filter(path => path.toLowerCase().includes(query)) })
function openRecent(path: string) { recentPrompt.value = false; void openFile(path) }
async function goToLine() {
  // IDEA's Jump to Line/Character accepts "line[:column]".
  const match = /^(\d+)(?::(\d+))?$/.exec(goLineValue.value.trim())
  goLinePrompt.value = false
  const tab = active.value
  if (!tab || !match) return
  const line = Number(match[1])
  const column = match[2] ? Math.max(1, Number(match[2])) : 0
  if (line < 1) return
  const total = tab.content.split('\n').length
  await revealLocation({ path: tab.path, line: Math.min(line, total) - 1, column })
}
// IDEA's bookmarks are one project-wide list, optionally wearing a 0-9 mnemonic so
// Ctrl+<digit> jumps to it from anywhere. The list lives with the project record.
const bookmarks = ref<Bookmark[]>([])
const sortedAll = computed(() => sortedBookmarks(bookmarks.value))
const bookmarkLines = computed(() => {
  const map: Record<string, number[]> = {}
  for (const entry of bookmarks.value) (map[entry.path] ??= []).push(entry.line)
  return map
})
const mnemonicPrompt = ref<{ path: string; line: number } | null>(null)
const digits = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9]
let bookmarkSave: number | undefined
function useProjectSettings(settings: ProjectSettings) {
  if (bookmarkSave) { window.clearTimeout(bookmarkSave); bookmarkSave = undefined }
  projectSettings.value = settings
  bookmarks.value = settings.bookmarks
}
function persistBookmarks() {
  if (!isDesktop || !workspace.value) return
  if (bookmarkSave) window.clearTimeout(bookmarkSave)
  bookmarkSave = window.setTimeout(() => {
    bookmarkSave = undefined
    if (!workspace.value) return
    void request<{ settings: ProjectSettings }>('project.settings.update', { bookmarks: bookmarks.value })
      .then(result => { projectSettings.value = result.settings })
      .catch(error => notify(`书签未能保存：${errorMessage(error)}`, true))
  }, 600)
}
function placeAt(path: string, line: number, mnemonic?: number) {
  bookmarks.value = placeBookmark(bookmarks.value, path, line, mnemonic)
  const keptEntry = bookmarks.value.find(entry => entry.path === path && entry.line === line)
  if (keptEntry) rememberPlace({ kind: '书签', path, line: line - 1, label: keptEntry.mnemonic === undefined ? baseName(path) + ':' + line : `${keptEntry.mnemonic} · ${baseName(path)}:${line}` })
  const kept = bookmarks.value.find(entry => entry.path === path && entry.line === line)
  notify(kept ? (kept.mnemonic === undefined ? `书签 ${path}:${line}` : `书签 ${path}:${line} 编号 ${kept.mnemonic}（Ctrl+${kept.mnemonic} 跳转）`) : `已取消书签 ${path}:${line}`)
  persistBookmarks()
}
function toggleBookmark(mnemonic?: number) {
  const tab = active.value
  if (!tab) return
  placeAt(tab.path, tab.line, mnemonic)
}
function openMnemonicPrompt() {
  const tab = active.value
  if (!tab) return
  menu.value = null
  mnemonicPrompt.value = { path: tab.path, line: tab.line }
}
function pickMnemonic(digit: number) {
  const at = mnemonicPrompt.value
  if (!at) return
  mnemonicPrompt.value = null
  placeAt(at.path, at.line, digit)
}
function jumpMnemonic(digit: number) {
  const found = bookmarkOwner(bookmarks.value, digit)
  if (!found) { notify(`没有编号 ${digit} 的书签（Ctrl+F11 可以贴编号）。`, true); return }
  void revealLocation({ path: found.path, line: found.line - 1 })
}
// IDEA walks the whole project, not just the open file, and wraps around.
function cycleBookmark(reverse: boolean) {
  const tab = active.value
  const target = nextInList(bookmarks.value, tab?.path ?? '', tab?.line ?? 0, reverse)
  if (!target) { notify(bookmarks.value.length ? '只有这一个书签。' : '还没有书签：F11 标记当前行，Ctrl+F11 编号。', true); return }
  void revealLocation({ path: target.path, line: target.line - 1 })
}
function dropBookmark(entry: Bookmark) {
  bookmarks.value = removeBookmark(bookmarks.value, entry)
  persistBookmarks()
}
function mnemonicOwner(digit: number) {
  const found = bookmarkOwner(bookmarks.value, digit)
  return found ? `${found.path.split('/').pop()}:${found.line}` : '—'
}
// IDEA's Surround With popup: the same fuzzy finder the action list uses, over the
// language-neutral templates in surround.ts.
const surroundPrompt = ref(false)
const surroundQuery = ref('')
const surroundIndex = ref(0)
const surroundInput = ref<HTMLInputElement>()
const surroundChoices = computed(() => rankCommands(surroundTemplates, surroundQuery.value))
function openSurround() {
  if (!active.value) { notify('请先打开一个文件。', true); return }
  menu.value = null
  surroundQuery.value = ''
  surroundIndex.value = 0
  surroundPrompt.value = true
  void nextTick(() => surroundInput.value?.focus())
}
function moveSurround(step: number) {
  const size = Math.max(1, surroundChoices.value.length)
  surroundIndex.value = (surroundIndex.value + step + size) % size
}
function applySurround(template: SurroundTemplate | undefined) {
  const tab = active.value
  if (!template || !tab) return
  surroundPrompt.value = false
  editorFor(tab.path)?.surroundWith(template)
  notify(`已用「${template.title}」包裹`)
}
watch(surroundQuery, () => { surroundIndex.value = 0 })
// Live Template Chooser: IDEA's "Surround/Expand Live Template" popup. The inventory
// is whatever src/templates.ts actually offers for the current file (effectiveTemplates
// already applies per-template overrides, disable flags and custom templates).
const templateChooser = ref(false)
const templateQuery = ref('')
const templateIndex = ref(0)
const templateInput = ref<HTMLInputElement>()
interface TemplateChoice { id: string; title: string; keywords: string; template: Template }
const templateChoices = computed<TemplateChoice[]>(() => {
  const path = active.value?.path ?? ''
  // rankCommands matches title+keywords (IDEA's Find Action rules), so each entry is
  // searchable by both its trigger key and its Chinese description.
  const entries = effectiveTemplates(path, projectSettings.value.templates).map((entry, index) => ({
    id: `${entry.pattern}#${index}`,
    title: entry.template.key,
    keywords: `${entry.template.description} ${entry.template.postfix ? 'postfix 后置' : 'live template'}`,
    template: entry.template,
  }))
  return rankCommands(entries, templateQuery.value)
})
function openTemplateChooser() {
  if (!active.value) { notify('请先打开一个文件。', true); return }
  menu.value = null
  templateQuery.value = ''
  templateIndex.value = 0
  templateChooser.value = true
  void nextTick(() => templateInput.value?.focus())
}
function moveTemplate(step: number) {
  const size = Math.max(1, templateChoices.value.length)
  templateIndex.value = (templateIndex.value + step + size) % size
}
function applyTemplate(choice: TemplateChoice | undefined) {
  if (!choice) return
  const tab = active.value
  templateChooser.value = false
  if (!tab) return
  // Postfix templates expand `receiver.key`; the caret must sit after a real receiver,
  // so offer those only when the previous expansion would otherwise silently fail.
  const ok = editorFor(tab.path)?.expandAtCursor(choice.template.postfix ? `.${choice.template.key}` : choice.template.key) ?? false
  notify(ok ? `已展开模板 ${choice.template.key}` : `「${choice.template.key}」不是当前光标处的有效触发，未展开。`, !ok)
}
watch(templateQuery, () => { templateIndex.value = 0 })
// IDEA stores run configurations with the project (.idea/runConfigurations), so the
// list follows the workspace instead of the machine: `project.settings.*` owns it.
const runConfigs = computed<RunConfig[]>(() => projectSettings.value.runConfigs)
const runConfigName = ref('')
// The header Run widget's tooltip: what pressing it will do right now.
const runWidgetTitle = computed(() => runState.running
  ? '停止运行 (Ctrl+F2)'
  : `运行 ${runConfigName.value || '所选配置'} (Shift+F10)`)
// IDEA's Alt+Shift+F10 "Choose Run Configuration" popup: pick the config to run or
// debug without hunting through the Run tab's select.
const configChooser = ref<{ debug: boolean } | null>(null)
const configIndex = ref(0)
function openConfigChooser(debug = false) {
  if (!runConfigs.value.length) { notify('还没有运行配置：在“运行”面板里保存一个配置。', true); return }
  configIndex.value = Math.max(0, runConfigs.value.findIndex(config => config.name === runConfigName.value))
  configChooser.value = { debug }
}
function moveConfig(delta: number) {
  const count = runConfigs.value.length
  if (!count) return
  configIndex.value = (configIndex.value + delta + count) % count
}
function applyConfigChoice(config: RunConfig) {
  const debug = configChooser.value?.debug ?? false
  configChooser.value = null
  pickConfig(config.name)
  if (debug) void runSelectedConfig(true); else void runSelectedConfig(false)
}
// The rest of the IDEA run-configuration shape: program, arguments, working
// directory, environment and the before-launch steps. Only `command` used to be
// editable, which made the other four fields decorative — they were persisted but
// never sent and never shown.
const runConfigType = ref<'shell' | 'application' | 'debug'>('shell')
const runConfigProgram = ref('')
const runConfigDebugAdapter = ref('cppvsdbg')
const runConfigArgs = ref('')
const runConfigCwd = ref('')
const runConfigEnv = ref('')
const runConfigBefore = ref<Array<{ name: string; command: string }>>([])
const runConfigEditorOpen = ref(false)
// One argument / one KEY=VALUE per line: a textarea is what IDEA uses for both, and
// it keeps shell-quoting out of the persisted shape.
function linesToArray(text: string): string[] {
  return text.split(/\r?\n/).map(line => line.trim()).filter(Boolean)
}
function arrayToLines(values: string[] | undefined): string { return (values ?? []).join('\n') }
function currentRunConfig(): RunConfig {
  return {
    name: runConfigName.value.trim(),
    type: runConfigType.value,
    command: runCommand.value.trim(),
    ...(runConfigProgram.value.trim() ? { program: runConfigProgram.value.trim() } : {}),
    ...(linesToArray(runConfigArgs.value).length ? { args: linesToArray(runConfigArgs.value) } : {}),
    ...(runConfigCwd.value.trim() ? { cwd: runConfigCwd.value.trim() } : {}),
    ...(runConfigType.value === 'debug' ? { adapter: runConfigDebugAdapter.value.trim() || 'cppvsdbg' } : {}),
    ...(linesToArray(runConfigEnv.value).length ? { env: linesToArray(runConfigEnv.value) } : {}),
    ...(runConfigBefore.value.filter(step => step.command.trim()).length
      ? { beforeLaunch: runConfigBefore.value.filter(step => step.command.trim()).map(step => ({ name: step.name, command: step.command })) }
      : {}),
  }
}
function addBeforeLaunchStep() { runConfigBefore.value = [...runConfigBefore.value, { name: '', command: '' }] }
function removeBeforeLaunchStep(index: number) { runConfigBefore.value = runConfigBefore.value.filter((_, i) => i !== index) }
function selectRunConfig(name?: string) {
  const wanted = name ?? runConfigName.value
  const found = runConfigs.value.find(config => config.name === wanted) ?? runConfigs.value[0]
  runConfigName.value = found?.name ?? ''
  if (found?.adapter) runConfigDebugAdapter.value = found.adapter
  if (!found) { runConfigType.value = 'shell'; runConfigProgram.value = ''; runConfigArgs.value = ''; runConfigCwd.value = ''; runConfigEnv.value = ''; runConfigBefore.value = []; runCommand.value = ''; runConfigDebug.value = false; return }
  runCommand.value = found.command
  runConfigType.value = found.type ?? 'shell'
  runConfigDebug.value = runConfigType.value === 'debug'
  runConfigProgram.value = found.program ?? ''
  runConfigArgs.value = arrayToLines(found.args)
  runConfigCwd.value = found.cwd ?? ''
  runConfigEnv.value = arrayToLines(found.env)
  runConfigBefore.value = (found.beforeLaunch ?? []).map(step => ({ name: step.name, command: step.command }))
}
function pickConfig(name: string) { runConfigName.value = name; selectRunConfig(name) }
async function persistRunConfigs(configs: RunConfig[], message: string) {
  if (!workspace.value) { notify('请先打开项目：运行配置随项目保存。', true); return }
  try {
    const result = await request<{ settings: ProjectSettings; entries: Entry[] }>('project.settings.update', { runConfigs: configs })
    projectSettings.value = result.settings
    workspace.value.entries = result.entries
    selectRunConfig()
    notify(message)
  } catch (error) { notify(errorMessage(error), true) }
}
const runConfigDebug = ref(false)
// The debug checkbox and the type selector are one setting; keep them in sync in
// both directions so "调试（DAP）" and type=debug never disagree.
watch(runConfigDebug, debug => { if (debug) runConfigType.value = 'debug'; else if (runConfigType.value === 'debug') runConfigType.value = 'shell' })
watch(runConfigType, type => { runConfigDebug.value = type === 'debug' })
function saveConfig() {
  const name = runConfigName.value.trim()
  if (!name) { notify('请填写配置名。', true); return }
  if (!runCommand.value.trim() && !runConfigProgram.value.trim()) { notify('请填写命令或可执行程序。', true); return }
  for (const entry of linesToArray(runConfigEnv.value))
    if (!entry.includes('=') || entry.startsWith('=')) { notify(`环境变量要写成 KEY=VALUE：「${entry}」不合法。`, true); return }
  const next = currentRunConfig()
  const configs = runConfigs.value.map(config => config.name === name ? next : config)
  if (!configs.some(config => config.name === name)) configs.push(next)
  void persistRunConfigs(configs, `已保存运行配置「${name}」`)
}
function removeConfig() {
  const name = runConfigName.value
  void persistRunConfigs(runConfigs.value.filter(config => config.name !== name), `已删除运行配置「${name}」`)
}
const blameLines = ref<GitBlameLine[]>([])
const blamePath = ref('')
const clipboardDiff = ref<{ path: string; rows: DiffRow[]; unified: string } | null>(null)
const severityLabel = (s: number) => s === 1 ? '错误' : s === 2 ? '警告' : s === 3 ? '提示' : '信息'
const severityClass = (s: number) => s === 1 ? 'sev-error' : s === 2 ? 'sev-warning' : 'sev-info'
const allProblems = computed(() => {
  const result: { path: string; line: number; character: number; severity: number; message: string; source: string }[] = []
  for (const [path, items] of lspDiagnostics) {
    for (const d of items) result.push({ path, line: d.line, character: d.character, severity: d.severity, message: d.message, source: d.source ?? '' })
  }
  result.sort((a, b) => a.severity - b.severity || a.path.localeCompare(b.path) || a.line - b.line)
  return result
})
interface HierarchyNode {
  item: LspHierarchyItem
  parentPath: string
  ancestors: string[]
  children: HierarchyNode[] | null
  expanded: boolean
  loading: boolean
  recursive: boolean
  error: string
}
const hierKind = ref<'call' | 'type'>('call')
const hierRoot = ref<LspHierarchyItem | null>(null)
const hierItems = ref<HierarchyNode[]>([])
const hierOrigin = ref('')
const hierBusy = ref(false)
const hierError = ref('')
let hierGeneration = 0
const hierDirection = ref<'incoming' | 'outgoing' | 'supertypes' | 'subtypes'>('incoming')
const hierOptions = computed<readonly (readonly [typeof hierDirection.value, string])[]>(() =>
  hierKind.value === 'call'
    ? [['incoming', '调用方'], ['outgoing', '被调用']]
    : [['supertypes', '父类型'], ['subtypes', '子类型']])
const hierTitle = computed(() => hierKind.value === 'call' ? '调用层次' : '类型层次')
const hierRows = computed(() => {
  const rows: { node: HierarchyNode; depth: number }[] = []
  const stack = hierItems.value.map(node => ({ node, depth: 0 })).reverse()
  while (stack.length) {
    const row = stack.pop()!
    rows.push(row)
    if (row.node.expanded && row.node.children) {
      for (let i = row.node.children.length - 1; i >= 0; i--) stack.push({ node: row.node.children[i]!, depth: row.depth + 1 })
    }
  }
  return rows
})
function hierarchyKey(item: LspHierarchyItem) {
  return JSON.stringify([item.path, item.name, item.kind, item.line, item.character])
}
function hierarchyNodes(items: LspHierarchyItem[], parent: LspHierarchyItem, ancestors: string[]): HierarchyNode[] {
  return items.map(item => ({ item, parentPath: parent.path, ancestors, children: null, expanded: false,
    loading: false, recursive: ancestors.includes(hierarchyKey(item)), error: '' }))
}
async function hierarchyChildren(item: LspHierarchyItem) {
  const kind = hierKind.value === 'call'
    ? (hierDirection.value === 'incoming' ? 'callHierarchyIncoming' : 'callHierarchyOutgoing')
    : (hierDirection.value === 'supertypes' ? 'typeHierarchySupertypes' : 'typeHierarchySubtypes')
  // Route through the originating document; the echoed item may belong to an unopened file.
  const result = await request<LspHierarchyResult>('lsp.request', { kind, path: hierOrigin.value, item })
  return result.calls ?? result.items ?? []
}
function resetHierarchy() {
  hierGeneration++
  hierRoot.value = null
  hierItems.value = []
  hierOrigin.value = ''
  hierBusy.value = false
  hierError.value = ''
}
async function prepareHierarchy(kind: 'call' | 'type', payload: { path: string; line: number; character: number }) {
  resetHierarchy()
  const generation = hierGeneration
  bottom.value = true
  showOutput('hierarchy')
  hierKind.value = kind
  hierOrigin.value = payload.path
  hierBusy.value = true
  try {
    const prepared = await request<LspHierarchyResult>('lsp.request', {
      kind: kind === 'call' ? 'prepareCallHierarchy' : 'prepareTypeHierarchy',
      path: payload.path, line: payload.line, character: payload.character,
    })
    if (generation !== hierGeneration) return
    const items = prepared.items ?? []
    if (!items.length) { hierError.value = kind === 'call' ? '此处没有可追溯调用关系的符号。' : '此处没有可追溯继承关系的类型。'; return }
    if (items.length > 1) notify(`此处有 ${items.length} 个符号，按「${items[0]!.name}」查询。`)
    hierRoot.value = items[0]!
    hierDirection.value = kind === 'call' ? 'incoming' : 'supertypes'
    await loadHierarchy()
  } catch (error) { if (generation === hierGeneration) hierError.value = errorMessage(error) }
  finally { if (generation === hierGeneration) hierBusy.value = false }
}
async function loadHierarchy() {
  const root = hierRoot.value
  if (!root) return
  const generation = ++hierGeneration
  showOutput('hierarchy')
  hierItems.value = []
  hierBusy.value = true
  hierError.value = ''
  try {
    const items = await hierarchyChildren(root)
    if (generation === hierGeneration) hierItems.value = hierarchyNodes(items, root, [hierarchyKey(root)])
  } catch (error) { if (generation === hierGeneration) hierError.value = errorMessage(error) }
  finally { if (generation === hierGeneration) hierBusy.value = false }
}
async function toggleHierarchy(node: HierarchyNode) {
  if (node.recursive || node.loading) return
  node.expanded = !node.expanded
  if (!node.expanded || node.children !== null) return
  const generation = hierGeneration
  node.loading = true
  node.error = ''
  try {
    const items = await hierarchyChildren(node.item)
    if (generation === hierGeneration) node.children = hierarchyNodes(items, node.item, [...node.ancestors, hierarchyKey(node.item)])
  } catch (error) {
    if (generation === hierGeneration) { node.error = errorMessage(error); node.expanded = false }
  } finally { node.loading = false }
}
function pickHierarchyDirection(direction: typeof hierDirection.value) {
  if (hierDirection.value === direction) return
  hierDirection.value = direction
  void loadHierarchy()
}
function callSiteTarget(node: HierarchyNode) {
  const path = hierDirection.value === 'outgoing' ? node.parentPath : node.item.path
  return { path, line: node.item.callLine ?? node.item.line ?? 0 }
}
async function showBlame() {
  const path = activePath.value
  if (!isDesktop || !path) { notify('请在桌面端为当前文件使用「追溯」。', true); return }
  bottom.value = true
  showOutput('blame')
  blamePath.value = path
  blameLines.value = []
  try { blameLines.value = (await request<GitBlame>('git.blame', { path })).lines ?? [] }
  catch (error) { notify(errorMessage(error), true) }
}
async function compareWithClipboard() {
  const tab = active.value
  if (!tab) return
  try {
    const clipText = await navigator.clipboard.readText()
    if (!clipText) { notify('剪贴板为空或非文本。', true); return }
    const currentLines = tab.content.split('\n')
    const clipLines = clipText.split('\n')
    const lcs = computeLCS(currentLines, clipLines)
    const rows: DiffRow[] = []
    let ci = 0, ki = 0, li = 0
    while (ci < currentLines.length || ki < clipLines.length) {
      if (li < lcs.length && ci < lcs[li].from && ki < lcs[li].to) {
        rows.push({ kind: 'change', left: { no: ci + 1, text: currentLines[ci] }, right: { no: ki + 1, text: clipLines[ki] } })
        ci++; ki++
      } else if (li < lcs.length && ci < lcs[li].from) {
        rows.push({ kind: 'delete', left: { no: ci + 1, text: currentLines[ci] } })
        ci++
      } else if (li < lcs.length && ki < lcs[li].to) {
        rows.push({ kind: 'insert', right: { no: ki + 1, text: clipLines[ki] } })
        ki++
      } else if (li < lcs.length) {
        rows.push({ kind: 'equal', left: { no: ci + 1, text: currentLines[ci] }, right: { no: ki + 1, text: clipLines[ki] } })
        ci++; ki++; li++
      } else {
        if (ci < currentLines.length) rows.push({ kind: 'delete', left: { no: ci + 1, text: currentLines[ci] } })
        if (ki < clipLines.length) rows.push({ kind: 'insert', right: { no: ki + 1, text: clipLines[ki] } })
        ci++; ki++
      }
    }
    clipboardDiff.value = { path: tab.path, rows, unified: generateUnifiedDiff(currentLines, clipLines) }
  } catch { notify('无法读取剪贴板。', true) }
}
function computeLCS(a: string[], b: string[]): { from: number; to: number }[] {
  const m = a.length, n = b.length
  const dp: number[][] = Array.from({ length: m + 1 }, () => Array(n + 1).fill(0))
  for (let i = m - 1; i >= 0; i--) for (let j = n - 1; j >= 0; j--) {
    dp[i][j] = a[i] === b[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1])
  }
  const result: { from: number; to: number }[] = []
  let i = 0, j = 0
  while (i < m && j < n) {
    if (a[i] === b[j]) { result.push({ from: i, to: j }); i++; j++ }
    else if (dp[i + 1][j] >= dp[i][j + 1]) i++; else j++
  }
  return result
}
function generateUnifiedDiff(a: string[], b: string[]): string {
  const lcs = computeLCS(a, b)
  const lines: string[] = ['--- 当前文件', '+++ 剪贴板', '@@ -1 +1 @@']
  let ci = 0, ki = 0, li = 0
  while (ci < a.length || ki < b.length) {
    if (li < lcs.length && ci < lcs[li].from) { lines.push(`-${a[ci]}`); ci++ }
    else if (li < lcs.length && ki < lcs[li].to) { lines.push(`+${b[ki]}`); ki++ }
    else if (li < lcs.length) { lines.push(` ${a[ci]}`); ci++; ki++; li++ }
    else { if (ci < a.length) lines.push(`-${a[ci]}`); if (ki < b.length) lines.push(`+${b[ki]}`); ci++; ki++ }
  }
  return lines.join('\n')
}
function copyFilePath() {
  const tab = active.value
  if (!tab) return
  const fullPath = workspace.value ? `${workspace.value.root}/${tab.path}` : tab.path
  void navigator.clipboard?.writeText(fullPath)
  notify(`已复制路径：${fullPath}`)
}
// IDEA's Generate popup (Alt+Insert) filters the code actions down to source
// generations — constructors, getters/setters, toString, overrides, …; JDT LS
// publishes exactly those under kind `source.*`.
const GENERATE_WORDS = ['generate', 'override', 'implement', 'constructor', 'getter', 'setter', 'tostring', 'equals', 'hashcode', 'delegate', 'insert', '生成', '重写', '实现', '构造']
async function openGeneratePopup() {
  const tab = active.value
  if (!tab || !lspReady.value) { notify('生成功能需要语言服务器支持。', true); return }
  const cursor = editorFor(tab.path)?.getCursor() ?? { line: tab.line - 1, ch: 0 }
  try {
    const result = await request<LspCodeActionResults>('lsp.request', { kind: 'codeAction', path: tab.path, line: cursor.line, character: cursor.ch, diagnostics: [] })
    const actions = (result.actions ?? []).filter(action =>
      action.kind?.startsWith('source') || GENERATE_WORDS.some(word => action.title.toLowerCase().includes(word)))
    if (!actions.length) { notify('当前语言服务没有在该处提供生成选项。', true); return }
    codeActions.value = actions
    actionPrompt.value = { path: tab.path }
  } catch (error) { notify(errorMessage(error), true) }
}
// IDEA's refactor actions are code-action flows with a title filter (ExtractMethodAction
// offers "Extract Method"); JDT LS publishes them as refactor.* CodeActions, so the
// same Alt+Enter pipeline runs here with the titles narrowed to the requested kind.
const refactorTitles: Record<string, string[]> = {
  extractVariable: ['extract variable', '提取变量'],
  extractConstant: ['extract constant', 'extract field', '提取常量'],
  extractMethod: ['extract method', '提取方法'],
  inlineVariable: ['inline', '内联'],
}
async function runRefactorFlow(kind: keyof typeof refactorTitles, needSelection: boolean, label: string) {
  const tab = active.value
  if (!tab || !lspReady.value) { notify(`${label}需要语言服务器支持。`, true); return }
  const cursor = editorFor(tab.path)?.getCursor() ?? { line: tab.line - 1, ch: 0 }
  if (needSelection && !(editorFor(tab.path)?.hasSelection() ?? false)) {
    notify(`请先选中${label.replace('提取', '要提取的')}代码，再执行该重构。`, true)
    return
  }
  const diagnostics = (lspDiagnostics.get(tab.path) ?? []).filter(item => item.line === cursor.line).map(item => ({
    range: { start: { line: item.line, character: item.character }, end: { line: item.endLine ?? item.line, character: item.endCharacter ?? item.character } },
    severity: item.severity, message: item.message, ...(item.source ? { source: item.source } : {}) }))
  try {
    const result = await request<LspCodeActionResults>('lsp.request', { kind: 'codeAction', path: tab.path, line: cursor.line, character: cursor.ch, diagnostics })
    const wanted = refactorTitles[kind]
    const actions = (result.actions ?? []).filter(action =>
      action.kind?.startsWith('refactor') && wanted.some(word => action.title.toLowerCase().includes(word)))
    if (!actions.length) { notify(`语言服务在当前光标处没有提供「${label}」。`, true); return }
    if (actions.length === 1) { await applyCodeAction(actions[0]!); return }
    codeActions.value = actions
    actionPrompt.value = { path: tab.path }
  } catch (error) { notify(errorMessage(error), true) }
}
function extractVariable() { void runRefactorFlow('extractVariable', true, '提取变量') }
function extractConstant() { void runRefactorFlow('extractConstant', true, '提取常量') }
function extractMethod() { void runRefactorFlow('extractMethod', true, '提取方法') }
function inlineVariable() { void runRefactorFlow('inlineVariable', false, '内联') }
function parentOf(path: string) { const index = path.lastIndexOf('/'); return index < 0 ? '' : path.slice(0, index) }
function baseName(path: string) { return path.slice(path.lastIndexOf('/') + 1) }
// Synthetic tree nodes (External Libraries / Scratches headers, glob leaves) carry a
// \0 prefix; file operations must not be offered or attempted on them.
function isSyntheticPath(path: string) { return path.startsWith('\u0000') }
async function toggleReadOnly(path: string) {
  treeMenu.value = null
  tabMenu.value = null
  if (!isDesktop) { notify('只读属性需要桌面端。', true); return }
  const tab = findTab(path)
  try {
    const result = await request<{ path: string; readOnly: boolean }>('file.readOnly', { path, readOnly: !(tab?.readOnly ?? false) })
    if (tab) {
      tab.readOnly = result.readOnly
      editorFor(path)?.setReadOnly(result.readOnly)
    }
    notify(result.readOnly ? `已将 ${baseName(path)} 标记为只读` : `${baseName(path)} 现在可写`)
  } catch (error) { notify(errorMessage(error), true) }
}
// AssociateWithFileTypeAction: map this file's extension to one of the languages
// TaoCode can highlight. The association is stored with the project and applies to
// every file sharing the extension, so remount the affected buffers after saving.
const languageChoices: [string, string][] = [['java', 'Java'], ['cpp', 'C++'], ['typescript', 'TypeScript'], ['other', '纯文本']]
async function associateFileType(path: string, choice: string) {
  tabMenu.value = null
  treeMenu.value = null
  const dot = path.lastIndexOf('.')
  const ext = dot < 0 ? '' : path.slice(dot + 1).toLowerCase()
  if (!ext) { notify('该文件没有扩展名，无法关联文件类型。', true); return }
  const next = { ...projectSettings.value.fileAssociations }
  if (choice === 'auto') delete next[ext]
  else next[ext] = choice
  try {
    const result = await request<{ settings: ProjectSettings }>('project.settings.update', { fileAssociations: next })
    projectSettings.value = result.settings
    // Syntax comes from the remount; the language server still keys documents by
    // extension, so re-open every buffer this association touches.
    for (const tab of allTabs.value) if (tab.path.toLowerCase().endsWith(`.${ext}`)) void startLsp(tab)
    bufferEpoch.value++
    notify(choice === 'auto' ? `已恢复按扩展名识别 .${ext}` : `*.${ext} 已关联到 ${languageLabels[choice] ?? choice}`)
  } catch (error) { notify(errorMessage(error), true) }
}
function onTreeContext(payload: { entry: Entry; x: number; y: number }) { if (isSyntheticPath(payload.entry.path)) return; treeMenu.value = payload; treeSubmenu.value = null; menu.value = null }
// FindUsages from the tree: open the file first (usages ride on the LSP document),
// then ask at its first symbol line.
async function findUsagesOf(path: string) {
  treeMenu.value = null
  treeSubmenu.value = null
  await openFile(path)
  if (!findTab(path)) return
  await refreshOutline(path)
  // IDEA's FindUsages on a file targets the class the file declares: pick the
  // class-like symbol named after the file stem, else the first symbol.
  const stem = (path.split('/').pop() ?? '').replace(/\.[^.]+$/, '')
  const classKinds = new Set([5, 11, 23, 26])  // class, interface, struct, enum per LSP
  const target = outline.value.find(symbol => symbol.name === stem && classKinds.has(symbol.kind))
    ?? outline.value.find(symbol => classKinds.has(symbol.kind))
    ?? outline.value[0]
  void onSemantic({ kind: 'references', path, line: target?.startLine ?? 0, character: target?.startChar ?? 0 })
}
function beginCreate(mode: 'createFile' | 'createDir') { const entry = treeMenu.value?.entry; if (!entry) return; const dir = entry.kind === 'directory' ? entry.path : parentOf(entry.path); treeMenu.value = null; nameDialog.value = { mode, dir, value: '', template: '' }; void nextTick(() => nameInput.value?.focus()) }
function beginRename() { const entry = treeMenu.value?.entry; if (!entry) return; treeMenu.value = null; nameDialog.value = { mode: 'rename', dir: parentOf(entry.path), entry, value: baseName(entry.path) }; void nextTick(() => { nameInput.value?.focus(); nameInput.value?.select() }) }
function beginDelete() { const entry = treeMenu.value?.entry; if (!entry) return; treeMenu.value = null; deleteTarget.value = entry }
function copyPath() { const entry = treeMenu.value?.entry; if (!entry) return; treeMenu.value = null; try { void navigator.clipboard?.writeText(workspace.value ? `${workspace.value.root}/${entry.path}` : entry.path) } catch { /* clipboard may be unavailable in WebView2 */ } notify(`路径：${entry.path}`) }
function openInTerminal() {
  const entry = treeMenu.value?.entry
  if (!entry || !isDesktop || !workspace.value) return
  treeMenu.value = null
  const dir = entry.kind === 'directory' ? entry.path : parentOf(entry.path)
  // Bring the terminal tab up first so the panel is mounted; then ask the panel
  // (via defineExpose) to spawn the shell in the chosen directory. Sending the
  // cwd to the bridge directly would create an orphan terminal with no xterm
  // subscribed to its output stream.
  showOutput('terminal')
  void terminalPanelRef.value?.openIn(dir)
}
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
  if (anchor === 'bottom') { bottom.value = true } else { explorer.value = true }
  leftView.value = view
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

// IDEA keeps one action list and shows it in the menus, in "Find Action" and in the
// keymap editor. The table below plays that role here: the menubar and the
// Ctrl+Shift+A dialog both read it, so a title, a shortcut or a availability rule can
// never drift between the two. `keywords` are the Latin aliases Find Action matches,
// because every visible title is Chinese.
interface MenuRow {
  id: string
  title?: string | (() => string)
  keywords?: string
  keys?: string
  section?: string
  rule?: boolean
  recent?: boolean
  enabled?: () => boolean
  checked?: () => boolean
  run?: () => void
}
const hasEditor = () => Boolean(active.value)
const editable = (name: string, title: string, keys?: string, keywords?: string): MenuRow => ({
  id: name, title, keys, keywords, enabled: hasEditor, run: () => runEditor(name),
})
const semantic = (name: string, title: string, keys: string, keywords: string): MenuRow => ({
  id: name, title, keys, keywords, enabled: () => Boolean(active.value) && lspReady.value, run: () => runEditor(name),
})
const toolWindow = (view: typeof leftView.value, title: string, keywords: string, needsDesktop = false): MenuRow => ({
  id: `view.${view}`, title, keywords,
  enabled: () => Boolean(workspace.value) && (!needsDesktop || isDesktop),
  run: () => showView(view),
})
const menus: { menu: NonNullable<typeof menu.value>; label: string; rows: MenuRow[] }[] = [
  { menu: 'file', label: '文件', rows: [
    { id: 'project.new', title: '新建项目…', keywords: 'new create project 新建', enabled: () => !working.value, run: () => beginProject('create') },
    { id: 'project.open', title: '打开项目…', keywords: 'open project 打开', enabled: () => !working.value, run: () => void openWorkspace() },
    { id: 'project.clone', title: '克隆仓库…', keywords: 'clone checkout vcs 克隆', enabled: () => !working.value, run: () => beginProject('clone') },
    { id: 'project.recentSection', section: '最近项目' },
    { id: 'project.recentList', recent: true },
    { id: 'project.close', title: '关闭项目，返回欢迎页', keywords: 'close project 关闭', enabled: () => !working.value, run: () => void closeWorkspace() },
    { id: 'file.rule1', rule: true },
    { id: 'file.save', title: '保存文件', keys: 'Ctrl S', keywords: 'save write 保存', enabled: () => Boolean(active.value?.dirty) && !working.value, run: () => void save() },
    { id: 'file.saveAll', title: '全部保存', keys: 'Ctrl Shift S', keywords: 'save all 全部保存', enabled: () => dirty.value && !working.value, run: () => void saveAll() },
    { id: 'file.scratch', title: '新建临时文件', keys: 'Ctrl Alt Shift Insert', keywords: 'scratch temp buffer 临时文件', enabled: () => Boolean(workspace.value) && !working.value, run: () => void createScratch() },
    { id: 'file.closeTab', title: '关闭当前文件', keywords: 'close tab editor 关闭标签', enabled: () => Boolean(active.value) && !working.value, run: () => { const tab = active.value; if (tab) void closeTab(tab) } },
    { id: 'file.reopenClosedTab', title: '重新打开已关闭的标签页', keywords: 'reopen closed tab restore editor 恢复关闭标签', enabled: () => closedTabsPerPane[focusedPane.value].length > 0, run: () => void reopenClosedTab() },
    { id: 'file.closeAllTabs', title: '关闭所有文件', keywords: 'close all tabs editors 全部关闭', enabled: () => allTabs.value.length > 0 && !working.value, run: () => { void closeAllTabsIn(focusedPane.value) } },
    { id: 'file.closeOthers', title: '关闭其他文件', keywords: 'close other tabs 关闭其他', enabled: () => Boolean(active.value) && groups[focusedPane.value].tabs.length > 1, run: () => { const tab = active.value; if (tab) void closeOtherTabsIn(focusedPane.value, tab) } },
    { id: 'file.rule2', rule: true },
    { id: 'file.encoding', title: '文件编码…', keywords: 'encoding charset gbk utf16 bom 编码', enabled: hasEditor, run: () => openEncoding() },
    { id: 'file.openBinary', title: '以二进制/十六进制方式打开', keywords: 'binary hex image 二进制 十六进制 图片', enabled: () => isDesktop && Boolean(activePath.value || workspace.value), run: () => { const path = activePath.value; if (path) void openBinary(path); else notify('请先选中一个文件。', true) } },
    { id: 'plugin.manage', title: '插件…', keywords: 'plugin extension 插件 扩展', enabled: () => isDesktop, run: () => void openPlugins() },
    { id: 'file.rule3', rule: true },
    { id: 'app.settings', title: '设置…', keys: 'Ctrl Alt S', keywords: 'settings preferences config keymap 设置', enabled: () => !working.value, run: () => void openSettings() },
    { id: 'app.quit', title: '退出', keywords: 'exit quit 关闭程序 退出', enabled: () => !working.value, run: () => { void request('app.quit').catch(() => undefined) } },
  ] },
  { menu: 'edit', label: '编辑', rows: [
    { id: 'edit.sectionFind', section: '查找' },
    editable('find', '在文件中查找与替换', 'Ctrl F', 'find replace search 查找'),
    editable('find.next', '查找下一个', 'F3', 'find next 下一个'),
    editable('find.previous', '查找上一个', 'Shift F3', 'find previous 上一个'),
    editable('replace.next', '替换下一个', undefined, 'replace next 替换'),
    editable('replace.all', '替换全部', undefined, 'replace all 全部替换'),
    toolWindow('search', '全局搜索与替换', 'search in files find in files global 全局搜索'),
    { id: 'edit.rule1', rule: true },
    { id: 'edit.sectionEdit', section: '编辑' },
    editable('undo', '撤销', 'Ctrl Z', 'undo revert 撤销'),
    editable('redo', '重做', 'Ctrl Shift Z', 'redo 重做'),
    { id: 'edit.rule2', rule: true },
    editable('selectAll', '全选', 'Ctrl A', 'select all 全选'),
    editable('line.duplicate', '复制行', 'Ctrl D', 'duplicate copy line 复制行'),
    editable('line.delete', '删除行', 'Ctrl Y', 'delete line 删除行'),
    editable('line.moveUp', '上移行', 'Ctrl Shift ↑', 'move up line 上移行'),
    editable('line.moveDown', '下移行', 'Ctrl Shift ↓', 'move down line 下移行'),
    editable('line.join', '合并行', 'Ctrl Shift J', 'join lines 合并行'),
    editable('case.toggle', '切换大小写', 'Ctrl Shift U', 'case upper lower 大小写'),
    { id: 'edit.rule3', rule: true },
    editable('comment.line', '行注释', 'Ctrl /', 'comment line 行注释'),
    editable('comment.block', '块注释', 'Ctrl Shift /', 'comment block 块注释'),
    { id: 'edit.rule4', rule: true },
    editable('cursor.above', '在上行添加光标', 'Ctrl Alt Shift ↑', 'multiple cursors column 多光标'),
    editable('cursor.below', '在下行添加光标', 'Ctrl Alt Shift ↓', 'multiple cursors column 多光标'),
    editable('occurrence.next', '添加下一个匹配', 'Alt J', 'next occurrence multiple cursors 下一个匹配'),
    editable('occurrence.select', '选中所有相同内容', 'Ctrl Shift Alt J', 'all occurrences 所有匹配'),
    editable('fold', '折叠代码块', 'Ctrl Shift -', 'fold collapse 折叠'),
    editable('unfold', '展开代码块', 'Ctrl Shift =', 'unfold expand 展开'),
    { id: 'edit.rule5', rule: true },
    editable('foldAll', '全部折叠', 'Ctrl Shift NumPad_Subtract', 'fold all recursively 全部折叠'),
    editable('unfoldAll', '全部展开', 'Ctrl Shift NumPad_Add', 'unfold all expand all 全部展开'),
    { id: 'edit.columnSelect', title: '列选择模式', keys: 'Alt Shift Insert', keywords: 'column selection block selection rectangular 列选择 块选择', enabled: hasEditor, run: () => runEditor('column.select') },
  ] },
  { menu: 'view', label: '视图', rows: [
    { id: 'view.explorer', title: () => `${explorer.value ? '隐藏' : '显示'}文件面板`, keywords: 'project view files tool window 文件面板', run: () => { explorer.value = !explorer.value } },
    { id: 'view.trace', title: () => `${activity.value ? '隐藏' : '显示'}处理记录`, keywords: 'activity trace bridge 处理记录', run: () => { activity.value = !activity.value } },
    { id: 'view.output', title: () => `${bottom.value ? '隐藏' : '显示'}输出面板`, keywords: 'output bottom tool window 输出面板', run: () => { bottom.value = !bottom.value } },
    { id: 'view.zenMode', title: () => `${zenMode.value ? '退出' : '进入'} Zen Mode`, keywords: 'zen distraction free fullscreen immersive 禅模式 免打扰', run: () => toggleZenMode() },
    { id: 'view.rule0', rule: true },
    { id: 'view.splitH', title: '向右拆分并移动', keywords: 'split right move tab opposite group 分屏 右拆', enabled: () => Boolean(active.value), run: () => splitTabOut(active.value!, 'horizontal') },
    { id: 'view.splitV', title: '向下拆分并移动', keywords: 'split down move tab opposite group 分屏 下拆', enabled: () => Boolean(active.value), run: () => splitTabOut(active.value!, 'vertical') },
    { id: 'view.unsplit', title: '取消拆分', keywords: 'unsplit close split 取消拆分', enabled: () => splitOrientation.value !== 'none', run: () => unsplit() },
    { id: 'view.unsplitAll', title: '取消所有拆分', keywords: 'unsplit all 取消所有拆分', enabled: () => splitOrientation.value !== 'none', run: () => unsplitAll() },
    { id: 'view.changeOrientation', title: '更改拆分方向', keywords: 'change orientation rotate split 切换拆分方向', enabled: () => splitOrientation.value !== 'none', run: changeSplitOrientation },
    // ViewMenu (`PlatformActions.xml:521-597`) lists no maximize/hide-all action at all — the only
    // entry point is `HideAllWindows` in the Window menu (`:656`), so the duplicate that used to
    // sit here (same title prefix, same Ctrl+Shift+F12) is gone rather than kept as a second face
    // of one action.
    { id: 'view.rule1', rule: true },
    { id: 'view.sectionWindows', section: '工具窗口' },
    toolWindow('files', '项目文件', 'project files tree explorer 项目文件'),
    toolWindow('git', '源代码管理', 'vcs git changes commit 源代码管理'),
    toolWindow('vcslog', 'VCS 日志', 'vcs log commit graph history 提交图 日志'),
    toolWindow('search', '全局搜索', 'search in files find 全局搜索'),
    toolWindow('todo', '待办事项', 'todo tasks markers 待办'),
    toolWindow('outline', '文件结构', 'structure file outline symbols 结构'),
    toolWindow('bookmarks', '书签', 'bookmark mnemonic list 书签', false),
    toolWindow('debug', '调试面板', 'debug debugger breakpoints run 调试', true),
    toolWindow('history', '本地历史', 'local history rollback snapshot 历史', true),
    { id: 'view.terminal', title: '终端', keywords: 'terminal console shell prompt 终端', enabled: () => Boolean(workspace.value), run: () => showOutput('terminal') },
    { id: 'view.collapseAll', title: '全部折叠项目树', keywords: 'collapse tree folders 全部折叠', enabled: () => Boolean(workspace.value), run: () => fileTreeRef.value?.collapseAll() },
    { id: 'view.expandAll', title: '全部展开项目树', keywords: 'expand tree folders 全部展开', enabled: () => Boolean(workspace.value), run: () => fileTreeRef.value?.expandAll() },
    { id: 'view.rule2', rule: true },
    { id: 'view.presentation', title: '演示模式', keywords: 'presentation mode 演示 投屏', checked: () => editorSettings.value.presentationMode, run: () => void saveSettingsPatch({ presentationMode: !editorSettings.value.presentationMode }) },
    { id: 'view.background', title: '设置背景图像…', keywords: 'background image 背景图', enabled: () => isDesktop, run: () => void chooseBackgroundImage() },
    { id: 'view.powerSave', title: '省电模式', keywords: 'power save mode 省电 节能', checked: () => editorSettings.value.powerSaveMode, run: () => void togglePowerSave() },
    { id: 'theme.light', title: '亮色主题', keywords: 'light theme bright 亮色', checked: () => theme.value === 'light', run: () => changeTheme('light') },
    { id: 'theme.dark', title: '暗色主题', keywords: 'dark theme 暗色', checked: () => theme.value === 'dark', run: () => changeTheme('dark') },
  ] },
  { menu: 'navigate', label: '导航', rows: [
    { id: 'navigate.actions', title: '查找操作…', keys: 'Ctrl Shift A', keywords: 'find action commands shortcuts keymap all actions 查找操作 命令', run: openActionSearch },
    { id: 'navigate.file', title: '转到文件…', keys: 'Ctrl Shift N', keywords: 'goto file search everywhere 转到文件', enabled: () => Boolean(workspace.value), run: openPalette },
    // IDEA's default keymap: Go to Class = Ctrl+N, Go to Symbol = Ctrl+Shift+Alt+N.
    { id: 'navigate.class', title: '转到类…', keys: 'Ctrl N', keywords: 'goto class type 转到类', enabled: () => Boolean(workspace.value) && lspReady.value, run: () => openSymbol('class') },
    { id: 'navigate.symbol', title: '转到符号…', keys: 'Ctrl Shift Alt N', keywords: 'goto symbol global 转到符号', enabled: () => Boolean(workspace.value) && lspReady.value, run: () => openSymbol('global') },
    { id: 'navigate.fileSymbol', title: '转到当前文件符号', keys: 'Ctrl F12', keywords: 'symbol outline structure file 文件符号', enabled: () => Boolean(workspace.value) && lspReady.value, run: () => openSymbol('file') },
    { id: 'navigate.line', title: '转到行/列…', keys: 'Ctrl G', keywords: 'goto line number 转到行', enabled: hasEditor, run: () => openGoLine() },
    // IDEA's Navigate menu puts `<group id="GoToErrorGroup">` between Go to Line and Jump to
    // Last Change (PlatformActions.xml:609-617), with F2 / Shift+F2 ($default.xml:658-660,
    // :679-681) and the ActionsBundle.properties:708-711 titles. Like every IDEA editor
    // action in that family it needs a file whose highlighting is available
    // (BaseGotoNextErrorAction.isValidForFile:52-54) — here, a live language server.
    { id: 'navigate.nextError', title: '下一个高亮错误', keys: 'F2', keywords: 'next highlighted error next error problem 下一个错误 下一个问题', enabled: () => Boolean(active.value) && lspReady.value, run: () => runEditor('error.next') },
    { id: 'navigate.previousError', title: '上一个高亮错误', keys: 'Shift F2', keywords: 'previous highlighted error previous error problem 上一个错误 上一个问题', enabled: () => Boolean(active.value) && lspReady.value, run: () => runEditor('error.previous') },
    { id: 'navigate.lastEdit', title: '回到上次编辑位置', keys: 'Ctrl Shift Bksp', keywords: 'last edit location navigation 上次编辑', enabled: hasEditor, run: jumpLastEditLocation },
    { id: 'navigate.recent', title: '最近文件', keys: 'Ctrl E', keywords: 'recent files switcher history 最近文件', enabled: () => Boolean(workspace.value), run: () => openRecentFiles() },
    // IDEA's RecentLocations is Ctrl+Shift+E in $default.xml; inside the popup the
    // same Ctrl+E toggles "Show edited only" (SwitcherRecentEditedChangedToggleCheckBox).
    { id: 'navigate.places', title: '最近位置', keys: 'Ctrl Shift E', keywords: 'recent places locations 最近位置', enabled: () => Boolean(workspace.value), run: () => openRecentPlaces() },
    { id: 'navigate.everywhere', title: '搜索任何地方', keys: 'Shift Shift', keywords: 'search everywhere 搜索任何地方', run: openActionSearch },
    { id: 'navigate.declaration', title: '转到声明/定义', keys: 'Ctrl B', keywords: 'go to declaration definition 转到声明', enabled: () => Boolean(active.value) && lspReady.value, run: () => runEditor('definition') },
    { id: 'navigate.rule1', rule: true },
    // IDEA's "Jump to Line/Character" (Ctrl+L) opens the same line prompt as Go to
    // Line:Column. Select Changed Text has no keymap entry in \$default.xml, so only
    // the jump row appears here.
    { id: 'navigate.back', title: '上一步', keys: 'Ctrl Alt ←', keywords: 'back navigate history 后退', enabled: () => Boolean(navBack.value.length), run: () => void goBack() },
    { id: 'navigate.forward', title: '下一步', keys: 'Ctrl Alt →', keywords: 'forward navigate history 前进', enabled: () => Boolean(navForward.value.length), run: () => void goForward() },
    { id: 'navigate.rule2', rule: true },
    { id: 'navigate.bookmark', title: '切换书签', keys: 'F11', keywords: 'bookmark toggle 书签', enabled: hasEditor, run: () => toggleBookmark() },
    { id: 'navigate.bookmarkMnemonic', title: '为书签编号…', keys: 'Ctrl F11', keywords: 'bookmark mnemonic digit 书签编号', enabled: hasEditor, run: openMnemonicPrompt },
    { id: 'navigate.bookmarkNext', title: '下一个书签', keywords: 'next bookmark project wide 下一个书签', run: () => cycleBookmark(false) },
    { id: 'navigate.bookmarkPrevious', title: '上一个书签', keywords: 'previous bookmark project wide 上一个书签', run: () => cycleBookmark(true) },
    { id: 'navigate.selectInProject', title: '在项目中选中', keys: 'Alt F1 1', keywords: 'select in project view tree reveal 在项目中选中 定位文件', enabled: () => Boolean(active.value), run: selectInTree },
    { id: 'view.bookmarks', title: '书签窗口', keys: 'Shift F11', keywords: 'bookmarks tool window list 书签窗口', enabled: () => Boolean(workspace.value), run: () => showView('bookmarks') },
  ] },
  { menu: 'code', label: '代码', rows: [
    editable('completion', '代码补全', 'Ctrl Space', 'completion autocomplete suggest 补全'),
    editable('template.expand', '展开实时模板', 'Ctrl Alt J', 'live template postfix expand 模板'),
    { id: 'code.templateChooser', title: '实时模板列表…', keys: 'Ctrl Alt Shift J', keywords: 'live template list chooser insert 模板列表', enabled: hasEditor, run: openTemplateChooser },
    { id: 'code.surround', title: '用模板包裹选中代码', keys: 'Ctrl Alt T', keywords: 'surround wrap try if block 包裹 模板', enabled: hasEditor, run: openSurround },
    { id: 'code.generate', title: '生成…', keys: 'Alt Insert', keywords: 'generate constructor getter setter toString override 生成 构造器', enabled: () => Boolean(active.value) && lspReady.value, run: openGeneratePopup },
    // ActionsBundle: ShowIntentionActions is "Show Context Actions" (Alt+Enter).
    semantic('codeAction', '显示上下文操作', 'Alt Enter', 'intent quick fix refactor code action 意图 上下文操作'),
    { id: 'code.rule1', rule: true },
    semantic('definition', '跳转到定义', 'Ctrl B', 'goto definition 定义'),
    semantic('implementation', '跳转到实现', 'Ctrl Alt B', 'goto implementation 实现'),
    semantic('references', '查找用法', 'Alt F7', 'find usages references 用法'),
    semantic('callHierarchy', '调用层次', 'Ctrl Alt H', 'call hierarchy incoming outgoing 调用层次'),
    semantic('typeHierarchy', '类型层次', 'Ctrl Shift H', 'type hierarchy supertypes subtypes 类型层次'),
    semantic('rename', '重命名', 'Shift F6', 'rename refactor symbol 重命名'),
    semantic('signature', '参数信息', 'Ctrl P', 'signature parameter info 参数信息'),
    { id: 'code.quickDoc', title: '快速文档', keys: 'Ctrl Q', keywords: 'quick documentation hover 快速文档 文档', enabled: () => Boolean(active.value) && lspReady.value, run: () => void showQuickDoc() },
    { id: 'code.copyRef', title: '复制引用', keys: 'Ctrl Alt Shift C', keywords: 'copy reference qualified name 复制引用 复制路径', enabled: () => Boolean(active.value), run: () => void copyReference() },
    { id: 'code.rule2', rule: true },
    semantic('selection.grow', '扩展到上一级语法单元', 'Ctrl W', 'extend selection syntax 扩展选区'),
    semantic('selection.shrink', '缩小语法选区', 'Ctrl Shift W', 'shrink selection syntax 缩小选区'),
    semantic('format', '重新格式化', 'Ctrl Alt L', 'format code reformat 格式化'),
    { id: 'code.rule3', rule: true },
    { id: 'code.blame', title: 'Git 追溯（Annotate）', keywords: 'blame annotate git history 追溯', enabled: () => Boolean(active.value) && isDesktop, run: () => void showBlame() },
    { id: 'code.compareClipboard', title: '与剪贴板比较', keywords: 'compare clipboard diff 与剪贴板比较', enabled: () => Boolean(active.value), run: () => void compareWithClipboard() },
    { id: 'code.copyPath', title: '复制文件路径', keywords: 'copy file path absolute 复制文件路径', enabled: () => Boolean(active.value), run: () => void copyFilePath() },
    // ActionsBundle: "Toggle Read-Only Attribute" (synonyms Make File Writable /
    // Read-Only); no default shortcut in $default.xml.
    { id: 'file.toggleReadOnly', title: '切换只读属性', keywords: 'read only writable lock attribute 只读 可写', enabled: () => Boolean(active.value) && isDesktop, run: () => void toggleReadOnly(activePath.value) },
    // ApplicationBundle "combobox.crlf.windows"/"crlf.unix"; IDEA's action titles.
    { id: 'file.lineSeparatorWindows', title: '转换为 Windows (CRLF) 行尾', keywords: 'convert windows line separators crlf 行尾 换行', enabled: () => Boolean(active.value) && isDesktop, run: () => void convertLineSeparators('crlf') },
    { id: 'file.lineSeparatorUnix', title: '转换为 Unix and macOS (LF) 行尾', keywords: 'convert unix macos line separators lf 行尾 换行', enabled: () => Boolean(active.value) && isDesktop, run: () => void convertLineSeparators('lf') },
  ] },
  { menu: 'refactor', label: '重构', rows: [
    { id: 'refactor.extractVariable', title: '提取变量', keys: 'Ctrl Alt V', keywords: 'extract variable local 提取变量', enabled: () => Boolean(active.value) && lspReady.value, run: extractVariable },
    { id: 'refactor.ExtractConstant', title: '提取常量', keys: 'Ctrl Alt C', keywords: 'extract constant field 提取常量', enabled: () => Boolean(active.value) && lspReady.value, run: extractConstant },
    { id: 'refactor.ExtractMethod', title: '提取方法', keys: 'Ctrl Alt M', keywords: 'extract method function 提取方法', enabled: () => Boolean(active.value) && lspReady.value, run: extractMethod },
    { id: 'refactor.rule1', rule: true },
    semantic('rename', '重命名', 'Shift F6', 'rename refactor symbol 重命名'),
    { id: 'refactor.inline', title: '内联', keys: 'Ctrl Alt N', keywords: 'inline variable method constant 内联', enabled: () => Boolean(active.value) && lspReady.value, run: inlineVariable },
    { id: 'refactor.rule2', rule: true },
    semantic('format', '重新格式化代码', 'Ctrl Alt L', 'format code reformat 格式化'),
  ] },
  // IDEA's Analyze menu (JavaActions.xml "AnalyzeMenu" = InspectCodeGroup + AnalyzeActions):
  // Inspect Code…, Code Cleanup… | Silent Code Cleanup, Run Inspection…. The cleanup and
  // offline-inspection rows are absent — no backend, not faked.
  { menu: 'analyze', label: '分析', rows: [
    { id: 'analyze.problemsView', title: '查看当前文件问题', keywords: 'inspect code problems view 检查 问题', enabled: () => Boolean(active.value), run: () => showOutput('problems') },
    { id: 'analyze.runInspection', title: '运行单条检查…', keys: 'Ctrl Shift Alt I', keywords: 'run inspection single intent analysis 运行检查', enabled: () => Boolean(active.value) && lspReady.value, run: () => void openCodeActions(caretPayload(), true) },
    { id: 'analyze.rule1', rule: true },
    { id: 'analyze.todoTree', title: '待办事项（TODO 索引）', keywords: 'todo index analyze scan comments 待办', enabled: () => Boolean(workspace.value), run: () => showView('todo') },
  ] },
  // IDEA's Build menu (JavaActions.xml "Java.BuildMenu"): Build Project (CompileDirty,
  // Ctrl+F9), Rebuild (Compile, Ctrl+Shift+F9 — bound here to a full clean rebuild),
  // plus Stop Build. TaoCode builds through the configured shell command.
  { menu: 'build', label: '构建', rows: [
    { id: 'build.project', title: '构建项目', keys: 'Ctrl F9', keywords: 'build project make compile 构建', enabled: () => isDesktop && Boolean(workspace.value) && !runState.running, run: () => void startBuild(false) },
    { id: 'build.rebuild', title: '重新构建项目', keys: 'Ctrl Shift F9', keywords: 'rebuild project clean 重新构建', enabled: () => isDesktop && Boolean(workspace.value) && !runState.running, run: () => void startBuild(true) },
    { id: 'build.stop', title: '停止构建', keywords: 'stop build cancel 停止构建', enabled: () => runState.running, run: () => void stopRun() },
    { id: 'build.rule1', rule: true },
    { id: 'build.output', title: '构建结果窗口', keywords: 'build tab view tool window 构建输出', enabled: () => Boolean(workspace.value), run: () => showOutput('run') },
  ] },
  { menu: 'run', label: '运行', rows: [
    { id: 'run.start', title: '运行', keys: 'Shift F10', keywords: 'run build execute task 运行', enabled: () => isDesktop && Boolean(workspace.value) && !runState.running, run: () => void runSelectedConfig(false) },
    { id: 'run.debug', title: '调试', keys: 'Shift F9', keywords: 'debug start breakpoint dap 调试', enabled: () => isDesktop && Boolean(workspace.value) && !dapState.running, run: () => void runSelectedConfig(true) },
    { id: 'run.debugContext', title: '调试当前上下文配置', keys: 'Ctrl Shift F9', keywords: 'debug contextual configuration 调试上下文', enabled: () => isDesktop && Boolean(active.value) && !dapState.running, run: () => void runContextConfiguration(true) },
    { id: 'run.pickConfig', title: '选择运行/调试配置', keys: 'Alt Shift F10', keywords: 'select run configuration choose active edit 选择配置', enabled: () => Boolean(workspace.value), run: () => showOutput('run') },
    { id: 'run.stop', title: '停止', keys: 'Ctrl F2', keywords: 'stop terminate kill 停止', enabled: () => runState.running, run: () => void stopRun() },
    // RunClass in the default keymap: run whatever is under the caret.
    { id: 'run.context', title: '运行当前上下文配置', keys: 'Ctrl Shift F10', keywords: 'run contextual configuration run class 运行上下文', enabled: () => isDesktop && Boolean(active.value) && !runState.running, run: () => void runContextConfiguration(false) },
    { id: 'run.rule1', rule: true },
    { id: 'run.output', title: '显示运行输出', keywords: 'run console output 运行输出', enabled: () => Boolean(workspace.value), run: () => showOutput('run') },
    { id: 'run.log', title: '显示操作输出', keywords: 'trace bridge log 操作输出', enabled: () => Boolean(workspace.value), run: () => showOutput('output') },
    toolWindow('debug', '显示调试面板', 'debug debugger tool window 调试面板', true),
    editable('evaluate', '求值表达式', 'Alt F8', 'evaluate expression watch 求值'),
  ] },
  // IDEA's Git.MainMenu order (intellij.vcs.git.backend.xml): Commit, Push, Update
  // Project, Pull, Fetch | Merge, Rebase, Resolve Conflicts | Branches, New Branch,
  // Tag, Reset | Show Log | Stash/Shelf. Rows without a git4idea-equivalent backend
  // here (Fetch, Rebase, Tag dialog, Reset) are omitted rather than faked.
  { menu: 'git', label: 'Git', rows: [
    { id: 'git.commit', title: '提交项目…', keys: 'Ctrl K', keywords: 'commit checkin message 提交', enabled: () => Boolean(workspace.value) && gitAvailable.value, run: () => showView('git') },
    { id: 'git.push', title: '推送…', keys: 'Ctrl Shift K', keywords: 'push remote upload 推送', enabled: () => isDesktop && gitAvailable.value, run: () => void gitMenuAction('git.push') },
    { id: 'git.update', title: '更新项目', keywords: 'update project pull merge incoming 更新', enabled: () => isDesktop && gitAvailable.value, run: () => void gitMenuAction('git.pull') },
    { id: 'git.pull', title: '拉取（Pull）', keywords: 'pull fetch integrate 拉取', enabled: () => isDesktop && gitAvailable.value, run: () => void gitMenuAction('git.pull') },
    { id: 'git.fetch', title: '获取（Fetch）', keywords: 'fetch remote refs prune 获取', enabled: () => isDesktop && gitAvailable.value, run: () => void gitMenuAction('git.fetch') },
    { id: 'git.rule1', rule: true },
    { id: 'git.rebase', title: '变基当前分支到上游（Rebase）', keywords: 'rebase upstream onto 变基', enabled: () => isDesktop && gitAvailable.value, run: () => void gitMenuAction('git.rebase') },
    { id: 'git.branches', title: '分支…', keys: 'Ctrl Shift `', keywords: 'branches popup checkout switch widget 分支', enabled: () => isDesktop && gitAvailable.value, run: () => showView('git') },
    { id: 'git.newBranch', title: '新建分支…', keywords: 'new branch create checkout 新建分支', enabled: () => isDesktop && gitAvailable.value, run: () => showView('git') },
    { id: 'git.tag', title: '标签…（Tag）', keywords: 'tag create delete lightweight 标签', enabled: () => isDesktop && gitAvailable.value, run: () => showView('git') },
    { id: 'git.rule2', rule: true },
    { id: 'git.stash', title: '储藏（Stash）', keywords: 'stash shelve save changes 储藏', enabled: () => isDesktop && gitAvailable.value, run: () => void gitMenuAction('git.stash.save') },
    { id: 'git.unstash', title: '取出储藏（Unstash）', keywords: 'unstash pop shelf 弹出储藏', enabled: () => isDesktop && gitAvailable.value, run: () => void gitMenuAction('git.stash.pop') },
    { id: 'git.log', title: '显示日志', keys: 'Alt Shift C', keywords: 'show log history graph 日志', enabled: () => Boolean(workspace.value) && gitAvailable.value, run: () => showView('vcslog') },
    { id: 'git.fileHistory', title: '当前文件的历史（--follow）', keywords: 'file history follow rename log 文件历史', enabled: () => isDesktop && gitAvailable.value && Boolean(activePath.value), run: () => { const path = activePath.value; if (path) void showFileHistory(path) } },
    { id: 'git.worktrees', title: '管理工作树…', keywords: 'worktree linked checkout 工作树', enabled: () => isDesktop && gitAvailable.value, run: () => void openWorktrees() },
    { id: 'git.submodules', title: '管理子模块…', keywords: 'submodule update init 子模块', enabled: () => isDesktop && gitAvailable.value, run: () => void openSubmodules() },
    toolWindow('history', '本地历史', 'local history snapshot 本地历史', true),
    { id: 'code.blame.git', title: '追溯当前文件', keywords: 'blame annotate 追溯', enabled: () => Boolean(active.value) && isDesktop, run: () => void showBlame() },
    { id: 'git.rule3', rule: true },
    { id: 'git.clone', title: '从版本控制系统检出…', keywords: 'checkout from version control clone vcs 检出', enabled: () => !working.value, run: () => beginProject('clone') },
    { id: 'app.settings.git', title: '版本控制与编辑器设置…', keys: 'Ctrl Alt S', keywords: 'vcs git settings 版本控制设置', enabled: () => isDesktop, run: () => void openSettings() },
  ] },
]
// WindowMenu › LayoutsGroup (`PlatformActions.xml:641-651`). IDEA nests this group into the Window
// menu as: RestoreFactoryDefaultLayout("Default", a toggle) · separator · CustomLayoutsGroup(the
// list of named layouts, each a toggle that applies it) · separator · RestoreDefaultLayout(Shift
// F12) · StoreDefaultLayout · StoreNewLayout. TaoCode's menus are flat, so the list becomes rows in
// place; `CustomLayoutActionGroup`'s per-layout Apply/Restore/Save/Rename/Delete submenu collapses
// onto Rename/Delete of the *active* layout plus the two global Store rows, which is the part of it
// a flat menu can express without inventing a second meaning for a click.
const layoutMenuRows = computed<MenuRow[]>(() => {
  const store = toolLayoutStore.value
  const rows: MenuRow[] = [
    { id: 'window.factoryLayout', title: '默认布局', keywords: 'default tool window layout factory reset 默认布局 出厂', checked: () => isFactoryLayoutActive(store), run: useFactoryToolLayout },
    { id: 'window.ruleLayoutsList', rule: true },
  ]
  for (const name of layoutNames(store))
    rows.push({ id: `window.layout.${name}`, title: name, keywords: `tool window layout ${name} 布局`, checked: () => store.active === name, run: () => applyNamedToolLayout(name) })
  rows.push({ id: 'window.ruleLayoutsActions', rule: true })
  rows.push({ id: 'window.restoreLayout', title: '恢复当前布局', keys: 'Shift F12', keywords: 'restore current layout reset 恢复布局 重置', run: restoreCurrentToolLayout })
  rows.push({ id: 'window.storeLayout', title: '将更改保存到当前布局', keywords: 'save changes in current layout 保存布局', run: storeCurrentToolLayout })
  rows.push({ id: 'window.storeLayoutAs', title: '将当前布局另存为新布局…', keywords: 'save current layout as new 另存为 新建布局', run: () => openLayoutNameDialog('newLayout') })
  // Rename/Delete only exist for a stored layout: the factory default is not an entry in the map,
  // which is also why `DeleteNamedLayoutAction` disables itself on the active layout.
  if (!isFactoryLayoutActive(store)) {
    rows.push({ id: 'window.renameLayout', title: '重命名当前布局…', keywords: 'rename layout 重命名布局', run: () => openLayoutNameDialog('renameLayout') })
    rows.push({ id: 'window.deleteLayout', title: '删除当前布局', keywords: 'delete layout remove 删除布局', run: deleteCurrentToolLayout })
  }
  rows.push({ id: 'window.ruleLayoutsEnd', rule: true })
  return rows
})
// IDEA's Window menu (ActionsBundle: "Search Everywhere…", "Store Current Selection
// as a Bookmark", the Activate-* tool-window actions, "Editor Tabs"). Same registry
// rows the Find Action popup reads, so titles and keys can never drift.
const windowMenuRows: MenuRow[] = [
  { id: 'window.searchEverywhere', title: '搜索任何地方', keys: 'Shift Shift', keywords: 'search everywhere goto file symbol action 搜索任何地方', run: openActionSearch },
  { id: 'window.rule1', rule: true },
  { id: 'window.bookmarkSelection', title: '将当前选择存为书签', keys: 'F11', keywords: 'store selection bookmark 存书签', enabled: hasEditor, run: () => toggleBookmark() },
  { id: 'window.toggleBookmark', title: '切换书签（不跳转）', keys: 'Ctrl F11', keywords: 'toggle bookmark mnemonic 书签编号', enabled: hasEditor, run: openMnemonicPrompt },
  { id: 'window.rule2', rule: true },
  toolWindow('files', '激活 项目 工具窗口', 'activate project tool window 项目'),
  toolWindow('git', '激活 本地更改 工具窗口', 'activate commit changes tool window 本地更改'),
  toolWindow('search', '激活 查找 工具窗口', 'activate find in files tool window 查找'),
  toolWindow('outline', '激活 结构 工具窗口', 'activate structure tool window 结构'),
  toolWindow('todo', '激活 待办事项 工具窗口', 'activate todo tool window 待办'),
  toolWindow('bookmarks', '激活 书签 工具窗口', 'activate bookmarks tool window 书签'),
  toolWindow('debug', '激活 调试 工具窗口', 'activate debug tool window 调试', true),
  toolWindow('history', '激活 本地历史 工具窗口', 'activate local history tool window 历史', true),
  { id: 'window.activateTerminal', title: '激活 终端 工具窗口', keys: 'Alt F12', keywords: 'activate terminal tool window 终端', enabled: () => Boolean(workspace.value), run: () => showOutput('terminal') },
  { id: 'window.activateOutput', title: '激活 输出 工具窗口', keywords: 'activate output tool window 输出', enabled: () => Boolean(workspace.value), run: () => showOutput('output') },
  { id: 'window.activateProblems', title: '激活 问题 工具窗口', keywords: 'activate problems tool window 问题', enabled: () => allProblems.value.length > 0, run: () => showOutput('problems') },
  // WindowMenu > ActiveToolwindowGroup (`PlatformActions.xml:653-656`): the three narrower hides
  // come before HideAllWindows. In TaoCode a dock shows one window at a time, so hiding the active
  // window and hiding its side coincide for a docked one - they still differ for a bottom window.
  { id: 'window.hideActiveWindow', title: '隐藏当前工具窗口', keys: 'Shift Esc', keywords: 'hide active tool window 隐藏当前工具窗口', enabled: () => (focusedDock() === 'bottom' ? bottom.value : focusedDock() === 'side' ? explorer.value : lastActiveId(activeToolWindows.value, toolWindowAvailable) !== undefined), run: hideActiveToolWindow },
  { id: 'window.hideSideWindows', title: '隐藏侧边工具窗口', keywords: 'hide side tool windows 隐藏侧边', enabled: () => explorer.value, run: hideSideToolWindows },
  { id: 'window.hideBottomWindows', title: '隐藏底部工具窗口', keywords: 'hide bottom tool windows 隐藏底部', enabled: () => bottom.value, run: hideBottomToolWindows },
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
  // The separator in `ActiveToolwindowGroup` falls between DockToolWindow and NextTab; TaoCode has
  // no DockToolWindow, so it falls directly after MaximizeToolWindow.
  { id: 'window.ruleTabs', rule: true },
  { id: 'window.nextTab', title: '选择下一个标签页', keys: 'Alt Right', keywords: 'select next tab activate 下一个标签页', enabled: () => tabTargetCount() > 1, run: selectNextTab },
  { id: 'window.previousTab', title: '选择上一个标签页', keys: 'Alt Left', keywords: 'select previous tab activate 上一个标签页', enabled: () => tabTargetCount() > 1, run: selectPreviousTab },
  { id: 'window.closeActiveTab', title: '关闭当前标签页', keys: 'Ctrl Shift F4', keywords: 'close active tab tool window 关闭当前标签页', enabled: () => Boolean(workspace.value), run: closeActiveTab },
  { id: 'window.closeOtherTabs', title: '关闭其他标签页', keywords: 'close other tabs tool window 关闭其他标签页', enabled: closeOtherTabsTarget, run: closeOtherToolTabs },
  // `PlatformActions.xml:666` mounts TW.CloseAllTabs right after TW.CloseOtherTabs. Its shortcut
  // comes from `use-shortcut-of="CloseAllEditors"` (`intellij.platform.ide.impl.actions.xml:462`),
  // which has no entry in `$default.xml` at all — so no key is shown and none is invented.
  { id: 'window.closeAllTabs', title: '关闭所有标签页', keywords: 'close all tabs tool window 关闭所有标签页', enabled: closeAllTabsTarget, run: closeAllToolTabs },
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
  { id: 'window.toggleContentUiType', title: '合并标签页', keywords: 'group tabs toggle tabbed combo presentation 合并标签页 内容呈现', checked: () => isTabbedContentUi(bottomContentUiType.value), enabled: () => canToggleContentUiType(activeContentCount()), run: () => { bottomContentUiType.value = toggledContentUiType(!isTabbedContentUi(bottomContentUiType.value)) } },
  // WindowMenu › ActiveToolwindowGroup › ResizeToolWindowGroup (`PlatformActions.xml:678-683`).
  // TaoCode's menus are flat, so the group becomes a section header; the four rows carry the
  // source's own step (`ResizeToolWindowAction.java:96-98`, `WindowAction.java:113-118`) and its
  // enable rule (`:127-131`, `:161-165`) through `src/toolWindowResize.ts`.
  { id: 'window.sectionResizeToolWindow', section: '调整工具窗口' },
  { id: 'window.resizeToolWindowLeft', title: '向左拉伸', keys: 'Ctrl Alt Shift ArrowLeft', keywords: 'resize stretch tool window left 向左拉伸 调整工具窗口', enabled: () => resizeTargetFor('left') !== null, run: () => stretchToolWindow('left') },
  { id: 'window.resizeToolWindowRight', title: '向右拉伸', keys: 'Ctrl Alt Shift ArrowRight', keywords: 'resize stretch tool window right 向右拉伸 调整工具窗口', enabled: () => resizeTargetFor('right') !== null, run: () => stretchToolWindow('right') },
  { id: 'window.resizeToolWindowUp', title: '向上拉伸', keys: 'Ctrl Alt Shift ArrowUp', keywords: 'resize stretch tool window top 向上拉伸 调整工具窗口', enabled: () => resizeTargetFor('up') !== null, run: () => stretchToolWindow('up') },
  { id: 'window.resizeToolWindowDown', title: '向下拉伸', keys: 'Ctrl Alt Shift ArrowDown', keywords: 'resize stretch tool window bottom 向下拉伸 调整工具窗口', enabled: () => resizeTargetFor('down') !== null, run: () => stretchToolWindow('down') },
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
  { id: 'window.rule3', rule: true },
  { id: 'window.configureTabs', title: '编辑器标签页选项…', keywords: 'editor tabs configure pin tab placement 标签页设置', run: () => openSettings('editor') },
  { id: 'window.activeToolList', title: '配置工具按钮列表…', keywords: 'configure buttons active tool list 工具按钮', run: () => openSettings('appearance') },
]
// IDEA's Tools menu (intellij.platform.ide.impl.actions.xml "ToolsMenu"): the platform
// rows are launcher-script creation plus OtherMenu (Terminal, task tools). Only rows
// backed by a real TaoCode feature appear — no fake plugin services.
const toolsMenuRows: MenuRow[] = [
  { id: 'tools.terminal', title: '打开终端', keys: 'Alt F12', keywords: 'terminal open shell tool window 终端', enabled: () => Boolean(workspace.value) && isDesktop, run: () => showOutput('terminal') },
  { id: 'tools.taskList', title: '待办事项工具窗口', keywords: 'tasks todo context 任务', enabled: () => Boolean(workspace.value), run: () => showView('todo') },
  { id: 'tools.rule1', rule: true },
  // IDEA's CreateLauncherScriptAction on Windows only shows instructions — the `idea`
  // .bat already ships in bin/. TaoCode has no CLI launcher yet, so the row is absent
  // rather than faked.
]
// IDEA's menu order: File Edit View Navigate Code Refactor Analyze Build Run Tools Git Window Help.
const allMenuGroups = computed(() => {
  const at = menus.findIndex(group => group.menu === 'git')
  // The layout group sits directly under the window-strip rows and above ActiveToolwindowGroup, the
  // way `PlatformActions.xml:641-651` orders it. Its rows are dynamic (one per named layout), so the
  // splice happens here instead of inside the static `windowMenuRows` array.
  const windowRows = [...windowMenuRows]
  const afterSearch = windowRows.findIndex(row => row.id === 'window.searchEverywhere') + 1
  windowRows.splice(afterSearch, 0, ...layoutMenuRows.value)
  const windowGroup = { menu: 'window' as const, label: '窗口', rows: windowRows }
  const toolsGroup = { menu: 'tools' as const, label: '工具', rows: toolsMenuRows }
  const next = [...menus]
  // IDEA's main-menu order ends ... Git, Window, Help; Tools sits before Git, and the
  // build group is declared inline between Refactor and Run.
  next.splice(at, 0, toolsGroup)
  next.splice(at + 2, 0, windowGroup)
  return next
})
function rowTitle(row: MenuRow) { return typeof row.title === 'function' ? row.title() : row.title ?? '' }
function rowEnabled(row: { enabled?: () => boolean }) { return row.enabled ? row.enabled() : true }
function pickMenuRow(row: MenuRow) {
  // IDEA "Keep popups open for toggle items": a checkable row flips in place and the
  // menu stays open, so several options can be switched in one go.
  if (!(editorSettings.value.keepPopupsForToggles && row.checked)) menu.value = null
  row.run?.()
}
// IDEA's ProjectToolbarWidgetAction (headertoolbar/ProjectToolbarWidgetAction.kt:118-297):
// the header carries the project name with a chevron, and the popup lists the open
// projects and then the recent ones (ProjectConceptBundle.properties:22-23
// "Open Projects" / "Recent Projects") with the project path and its branch. The list is
// the first MAX_RECENT_COUNT recent actions (:98, :263-265), grouped by "is this project
// open" (:262-276), and the popup searches over name *and* path (:367-372).
const projectWidgetOpen = ref(false)
const projectWidgetQuery = ref('')
const projectWidgetGroups = computed(() => groupProjects(
  filterProjects(recentProjects.value, projectWidgetQuery.value),
  workspace.value?.root,
))
function toggleProjectWidget() {
  projectWidgetOpen.value = !projectWidgetOpen.value
  if (projectWidgetOpen.value) projectWidgetQuery.value = ''
}
function pickProjectFromWidget(project: RecentProject) {
  projectWidgetOpen.value = false
  // The current window's project is already open; IDEA brings that frame to front, which
  // a single-project window has nothing to do for.
  if (project.path === workspace.value?.root) return
  openRecentProject(project)
}
// IDEA's popup rows print the branch the recent-project action carries
// (ProjectToolbarWidgetPresentable.branchName, ReopenProjectAction.kt:48); TaoCode records
// the branch the status bar already polls, keyed by root — the same store the welcome page
// reads (see the gitHead watcher).
function branchOfProject(path: string): string {
  if (!isDesktop) return ''
  try { return localStorage.getItem(`taocode.branch:${path}`) ?? '' } catch { return '' }
}
function openRecentProject(project: RecentProject) {
  if (working.value || !project.available) return
  menu.value = null
  void openWorkspace(project.path)
}

interface ActionEntry { id: string; title: string; keywords?: string; keys?: string; group: string; enabled?: () => boolean; run: () => void }
const actionSearch = ref(false)
const actionQuery = ref('')
const actionIndex = ref(0)
const actionInput = ref<HTMLInputElement>()
// Same command can sit in several menus (IDEA does too); Find Action lists it once.
const actionList = computed<ActionEntry[]>(() => {
  const seen = new Map<string, ActionEntry>()
  for (const group of allMenuGroups.value) for (const row of group.rows) {
    if (!row.run || seen.has(row.id)) continue
    seen.set(row.id, { id: row.id, title: rowTitle(row), keywords: row.keywords, keys: row.keys, group: group.label, enabled: row.enabled, run: row.run })
  }
  const list = [...seen.values()]
  // IDEA lists the ten mnemonic jumps as actions of their own, even though the menubar
  // has no room for them.
  for (const digit of digits) list.push({
    id: `navigate.bookmark${digit}`, title: `跳转到书签 ${digit}`, keys: `Ctrl ${digit}`,
    keywords: `bookmark mnemonic digit 书签 ${digit}`, group: '导航',
    enabled: () => Boolean(bookmarkOwner(bookmarks.value, digit)), run: () => jumpMnemonic(digit),
  })
  // IDEA's `FocusStatusBar` (ActionsBundle.properties:81-82 `Focus Status Bar` /
  // "Move focus to the first widget in the status bar") is not a menu item either: it lives in the
  // `ToolbarPopupActions` group (PlatformActions.xml:1366) that CustomizationUtil.java:567-568
  // injects into the *toolbar customization* popup, so it is a searchable action without a menu row.
  list.push({
    id: 'window.focusStatusBar', title: '聚焦状态栏', keys: '',
    keywords: 'focus status bar first widget keyboard 状态栏 键盘 焦点 focus status bar', group: '窗口',
    enabled: () => Boolean(workspace.value), run: focusStatusBar,
  })
  return list
})
const actionResults = computed(() => rankCommands(actionList.value, actionQuery.value))
function openActionSearch() {
  actionQuery.value = ''
  actionIndex.value = 0
  menu.value = null
  actionSearch.value = true
  void nextTick(() => actionInput.value?.focus())
}
function moveAction(step: number) {
  const size = Math.max(1, actionResults.value.length)
  actionIndex.value = (actionIndex.value + step + size) % size
}
function runAction(entry: ActionEntry) {
  if (entry.enabled && !entry.enabled()) { notify(`「${entry.title}」当前不可用。`, true); return }
  actionSearch.value = false
  entry.run()
}
function runActionResult() {
  const entry = actionResults.value[actionIndex.value]
  if (entry) runAction(entry)
}
watch(actionQuery, () => { actionIndex.value = 0 })

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
      await request('file.rename', { from: dialog.entry.path, to: target })
      await retitleTab(dialog.entry.path, target)
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
  const trash = deleteToTrash.value
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
// The whole configuration is sent, not just the command: program/args/cwd/env and
// the before-launch steps are what make a run configuration a configuration.
function runStartParams(label?: string): RunStartParams {
  const config = currentRunConfig()
  const params: RunStartParams = { command: config.command }
  if (config.program) params.program = config.program
  if (config.args?.length) params.args = config.args
  if (config.cwd) params.cwd = config.cwd
  if (config.env?.length) params.env = config.env
  params.shell = config.type !== 'application'
  if (label) params.label = label
  return params
}
// Run one command to completion and hand back its exit code. run.output/run.exit
// arrive as events; this watcher is what turns that stream into an awaitable so
// before-launch tasks can gate the real run (IDEA's Before launch semantics).
function runToExit(params: RunStartParams): Promise<number> {
  return new Promise(resolve => {
    beginRun()
    const stop = watch(() => runState.exit, code => {
      if (code === null || code === undefined) return
      stop()
      resolve(code)
    })
    void request('run.start', { ...params })
      .catch(() => { stop(); resolve(-1) })
  })
}
async function startRun() {
  if (!runCommand.value.trim() && !runConfigProgram.value.trim()) { notify('请输入要运行的命令或可执行程序。', true); return }
  if (runState.running) { notify('已有任务在运行，请先停止。', true); return }
  if (!await saveAll()) { notify('请先保存修改再运行。', true); return }
  showOutput('run')
  // Before launch: every step runs in order; a non-zero exit aborts the launch
  // naming the failed step, instead of silently running a stale binary.
  const config = currentRunConfig()
  for (const step of config.beforeLaunch ?? []) {
    const code = await runToExit({ command: step.command, shell: true })
    if (code !== 0) {
      endRun()
      notify(`启动前步骤「${step.name || step.command}」失败（退出码 ${code}），已中止运行。`, true)
      return
    }
  }
  beginRun()
  try { await request('run.start', { ...runStartParams() }) }
  catch (error) { endRun(); notify(`无法启动：${errorMessage(error)}`, true) }
}
// IDEA's Run/Debug act on the selected configuration. A debug-type config hands its
// command line to the DAP session: first token is the program, the rest are arguments.
async function runSelectedConfig(debug: boolean) {
  if (!workspace.value || !isDesktop) { notify('桌面端才能运行或调试配置。', true); return }
  const name = runConfigName.value
  const found = runConfigs.value.find(config => config.name === name)
  if (!found) { notify('请选择一个运行配置。', true); return }
  if (debug && found.type !== 'debug') { notify(`配置「${name}」不是调试类型；在运行配置里勾选“调试”后才会交给 DAP。`, true); return }
  if (!debug && found.type === 'debug') { notify(`配置「${name}」是调试类型；用 Shift+F9 调试它。`, true); return }
  if (!debug) { void startRun(); return }
  // A debug configuration carries its program/args/cwd/adapter as structured
  // fields (IDEA's ApplicationConfiguration); tokenizing `command` again would
  // break on paths with spaces and drop the configured environment.
  const program = found.program?.trim() || found.command.trim().split(/\s+/)[0] || ''
  if (!program) { notify('调试配置没有可执行程序。', true); return }
  const args = found.args ?? found.command.trim().split(/\s+/).slice(1)
  // IDEA runs "Build" before a debug launch too; a configured beforeLaunch chain
  // gates the adapter the same way it gates a normal run.
  for (const step of found.beforeLaunch ?? []) {
    const code = await runToExit({ command: step.command, shell: true })
    if (code !== 0) { notify(`启动前步骤「${step.name || step.command}」失败（退出码 ${code}），已中止调试。`, true); return }
  }
  explorer.value = true
  leftView.value = 'debug'
  try {
    await dapStart({ command: '', args, kind: found.adapter?.trim() || debugKindFor(program), program, cwd: found.cwd || '.', stopOnEntry: false, env: envArrayToObject(found.env) })
    notify(`已在调试 ${program}`)
  } catch (error) { notify(`无法启动调试：${errorMessage(error)}`, true) }
}
// The bridge accepts env as an object or ["KEY=value"]; the config stores lines.
function envArrayToObject(lines?: string[]): Record<string, string> | undefined {
  if (!lines?.length) return undefined
  const out: Record<string, string> = {}
  for (const line of lines) {
    const eq = line.indexOf('=')
    if (eq > 0) out[line.slice(0, eq)] = line.slice(eq + 1)
  }
  return Object.keys(out).length ? out : undefined
}
// The DAP kind selects the adapter entry from TaoCode.dap.json; guessing cppvsdbg
// for a Java or Python program would launch the wrong debugger.
function debugKindFor(program: string): string {
  const lower = program.toLowerCase()
  if (/\.jar$/.test(lower) || /(^|[\\/])(java|javaw)(\.exe)?$/.test(lower) || lower === 'java' || lower === 'javaw') return 'java'
  if (/\.py$/.test(lower) || lower === 'python' || lower === 'python3') return 'debugpy'
  if (/\.dll$/.test(lower)) return 'cppvsdbg'
  return 'cppvsdbg'
}
// RunClass ("run the configuration belonging to the context"): TaoCode's context is
// the active file; a same-named `<basename>.exe` next to the configured output dir
// is what the CMake templates produce, so that is the candidate.
async function runContextConfiguration(debug: boolean) {
  const tab = active.value
  if (!tab || !workspace.value || !isDesktop) { notify('请先打开一个文件。', true); return }
  const base = tab.path.split('/').pop() ?? ''
  const stem = base.replace(/\.[^.]+$/, '')
  const output = projectSettings.value.java.outputPath || 'build'
  const candidates = [`${output}/${stem}.exe`, `${output}/${stem}`, `build/${stem}.exe`]
  for (const candidate of candidates) {
    try {
      await request<DocumentData>('file.read', { path: candidate })
    } catch { continue }
    if (debug) {
      explorer.value = true
      leftView.value = 'debug'
      try { await dapStart({ command: '', args: [], kind: debugKindFor(candidate), program: candidate, cwd: '.', stopOnEntry: false }); notify(`已在调试 ${candidate}`) }
      catch (error) { notify(`无法启动调试：${errorMessage(error)}`, true) }
    } else {
      runCommand.value = candidate
      await startRun()
    }
    return
  }
  notify(`找不到与 ${base} 对应的可执行文件（查过 ${candidates.join('、')}）。`, true)
}
  // IDEA's Build menu: CompileDirty ("Build Project", Ctrl+F9) builds incrementally;
  // Compile ("Rebuild") is a full rebuild. TaoCode has no incremental compiler of its
  // own, so both go through the project's configured build command — rebuild adds
  // --clean-first, matching Rebuild's semantics.
// The Git menu drives the same bridge methods as the 源代码管理 tool window. Stash
// without a message would use git's default; keep IDEA's "Stash" dialog out of scope
// and pass a timestamped label instead.
async function gitMenuAction(method: 'git.push' | 'git.pull' | 'git.fetch' | 'git.rebase' | 'git.stash.save' | 'git.stash.pop') {
  if (!workspace.value || !isDesktop) return
  try {
    if (method === 'git.stash.save') await request(method, { message: `TaoCode 储藏 ${new Date().toISOString().slice(0, 19).replace('T', ' ')}` })
    else await request(method)
    notify(method === 'git.push' ? '已推送。' : method === 'git.pull' ? '已拉取（--ff-only）。' : method === 'git.fetch' ? '已获取远端引用（未合并）。' : method === 'git.rebase' ? '已变基到上游。' : method === 'git.stash.save' ? '已储藏当前更改。' : '已弹出最近的储藏。')
    showView('git')
  } catch (error) { notify(errorMessage(error), true) }
}
async function startBuild(rebuild: boolean) {
  if (!workspace.value || !isDesktop) { notify('桌面端才能构建项目。', true); return }
  if (runState.running) { notify('已有任务在运行，请先停止。', true); return }
  const command = runCommand.value.trim() || 'cmake --build build'
  if (!await saveAll()) { notify('请先保存修改再构建。', true); return }
  beginRun()
  showOutput('run')
  // A build never runs the program, so the application fields are dropped and the
  // before-launch steps (which are build steps themselves) are not repeated.
  const params: RunStartParams = { command: rebuild ? `${command}${command.startsWith('cmake') ? ' --clean-first' : ''}` : command, shell: true, label: rebuild ? '重新构建' : '构建' }
  try { await request('run.start', { ...params }) }
  catch (error) { endRun(); notify(`无法启动构建：${errorMessage(error)}`, true) }
}
async function stopRun() {
  try { await request('run.stop') } catch (error) { notify(errorMessage(error), true) }
}
async function sendRunInput() {
  const line = runInput.value?.value ?? ''
  if (runInput.value) runInput.value.value = ''
  if (!runState.running) { notify('没有正在运行的任务。', true); return }
  try { await request('run.write', { line }) } catch { /* 进程可能刚结束 */ }
}
let lastShiftAt = 0
function onKey(event: KeyboardEvent) {
  // Alt+1..9 focus the tool windows (IDEA ActivateToolWindowAction is unconditional);
  // modals and the palette keep the keyboard first.
  if (event.altKey && workspace.value
      && !palette.value && !settingsOpen.value && !help.value && !leavePrompt.value) {
    focusToolWindowByNumber(event)
    if (event.defaultPrevented) return
  }
  // $default.xml:867-869 — Shift+Esc is HideActiveWindow (`HideToolWindowAction.kt:21-29`).
  // Overlays keep the keyboard first, the way the rest of this handler treats them.
  if (event.key === 'Escape' && event.shiftKey && !event.ctrlKey && !event.altKey && workspace.value
      && !palette.value && !settingsOpen.value && !help.value && !leavePrompt.value) { event.preventDefault(); hideActiveToolWindow(); return }
  if (event.key === 'Escape') {
    if (settingsOpen.value) {
      // First ESC clears the settings search filter, the second one closes the dialog.
      event.preventDefault()
      if (settingsDialogRef.value?.handleEscape()) return
      settingsOpen.value = false
      return
    }
    palette.value = false; help.value = false; menu.value = null; settingsOpen.value = false; projectWidgetOpen.value = false; filenamePopup.value = false
    if (leavePrompt.value) answerLeave('cancel')
    else if (renamePrompt.value) renamePrompt.value = null
    else if (symbolPrompt.value) symbolPrompt.value = null
    else if (actionPrompt.value) actionPrompt.value = null
    else if (surroundPrompt.value) surroundPrompt.value = false
    else if (mnemonicPrompt.value) mnemonicPrompt.value = null
    else if (actionSearch.value) actionSearch.value = false
    else if (goLinePrompt.value) goLinePrompt.value = false
    else if (conflictPrompt.value) resolveConflictKeep()
    else if (encodingPrompt.value) encodingPrompt.value = null
    else if (quickDoc.value) quickDoc.value = null
    else if (recentPrompt.value) recentPrompt.value = false
    else if (placesPrompt.value) placesPrompt.value = false
    else if (configChooser.value) configChooser.value = null
    else if (signaturePopup.value) closeSignaturePopup()
    else if (templateChooser.value) templateChooser.value = false
    return
  }
  const digit = /^Digit([0-9])$/.exec(event.code)?.[1]
  if (digit !== undefined && mnemonicPrompt.value) { event.preventDefault(); pickMnemonic(Number(digit)); return }
  // RecentLocations popup owns the keyboard while open (IDEA's popup list: Up/Down
  // move, Enter jumps, Delete drops the place, Ctrl+E toggles the edited filter).
  if (placesPrompt.value) {
    if (event.key === 'ArrowDown') { event.preventDefault(); movePlace(1); return }
    if (event.key === 'ArrowUp') { event.preventDefault(); movePlace(-1); return }
    if (event.key === 'Enter') { event.preventDefault(); const place = placesFiltered.value[placesIndex.value]; if (place) openPlace(place); return }
    if (event.key === 'Delete' || event.key === 'Backspace') {
      event.preventDefault()
      const place = placesFiltered.value[placesIndex.value]
      if (place) { places.value = places.value.filter(item => item !== place); changePlaces.value = changePlaces.value.filter(item => item !== place) }
      return
    }
    if (event.ctrlKey && event.key.toLowerCase() === 'e') { event.preventDefault(); placesEditedOnly.value = !placesEditedOnly.value; return }
    return
  }
  // Choose Run/Debug Configuration popup (Alt+Shift+F10 / Alt+Shift+F9).
  if (configChooser.value) {
    if (event.key === 'ArrowDown') { event.preventDefault(); moveConfig(1); return }
    if (event.key === 'ArrowUp') { event.preventDefault(); moveConfig(-1); return }
    if (event.key === 'Enter') { event.preventDefault(); const config = runConfigs.value[configIndex.value]; if (config) applyConfigChoice(config); return }
    return
  }
  if (projectMode.value || settingsOpen.value || leavePrompt.value || renamePrompt.value || symbolPrompt.value || actionPrompt.value || actionSearch.value || surroundPrompt.value || mnemonicPrompt.value || goLinePrompt.value || encodingPrompt.value || conflictPrompt.value || quickDoc.value || recentPrompt.value || templateChooser.value) return
  // --- Debugger/build transport, from $default.xml ---
  // F9 Resume, F8 Step Over, F7 Step Into, Shift+F8 Step Out, Ctrl+F8 Toggle Line
  // Breakpoint, Shift+F9 Debug, Ctrl+F9 Build, Ctrl+Shift+F9 Rebuild.
  if (event.key === 'F9' && event.ctrlKey && !event.shiftKey) { event.preventDefault(); void startBuild(false); return }
  if (event.key === 'F9' && event.ctrlKey && event.shiftKey && workspace.value) { event.preventDefault(); void startBuild(true); return }
  if (event.key === 'F8' && event.ctrlKey && !event.altKey && !event.shiftKey && active.value && isDesktop) { event.preventDefault(); void toggleBreakpointAt(activePath.value, active.value.line); return }
  if (event.key === 'F9' && !event.shiftKey && !event.ctrlKey && dapState.paused) { event.preventDefault(); void dapStep('continue'); return }
  if (event.key === 'F9' && event.shiftKey && isDesktop && workspace.value && !dapState.running) { event.preventDefault(); void runSelectedConfig(true); return }
  if (dapState.paused && !event.ctrlKey && !event.altKey) {
    if (event.key === 'F8' && !event.shiftKey) { event.preventDefault(); void dapStep('next'); return }
    if (event.key === 'F7' && !event.shiftKey) { event.preventDefault(); void dapStep('stepIn'); return }
    if (event.key === 'F8' && event.shiftKey) { event.preventDefault(); void dapStep('stepOut'); return }
  }
  if (event.key === 'F2' && event.ctrlKey && runState.running) { event.preventDefault(); void stopRun(); return }
  // Shift+F10 Run, Alt+Shift+F10 Choose Run Configuration, Alt+Shift+F9 Choose Debug
  // Configuration, Ctrl+Shift+F10 Run Context Configuration.
  if (event.key === 'F10' && event.shiftKey && event.altKey && workspace.value) { event.preventDefault(); openConfigChooser(); return }
  if (event.key === 'F9' && event.shiftKey && event.altKey && isDesktop && workspace.value) { event.preventDefault(); openConfigChooser(); return }
  if (event.key === 'F10' && event.shiftKey && !event.altKey && isDesktop && workspace.value && !runState.running) { event.preventDefault(); void runSelectedConfig(false); return }
  if (event.key === 'F10' && event.ctrlKey && event.shiftKey && workspace.value) { event.preventDefault(); void runContextConfiguration(false); return }
  // --- Navigation, from $default.xml ---
  // ResizeToolWindowLeft/Right/Up/Down = Ctrl+Alt+Shift+arrows (`$default.xml:873-884`). They act
  // on the active tool window and are therefore checked *before* Back/Forward below, which use the
  // same chord without Shift — and those two now exclude Shift so the resize chords stay reachable
  // (the same shadowing the F12 fix had to undo).
  if (event.ctrlKey && event.altKey && event.shiftKey) {
    if (event.key === 'ArrowLeft') { event.preventDefault(); stretchToolWindow('left'); return }
    if (event.key === 'ArrowRight') { event.preventDefault(); stretchToolWindow('right'); return }
    if (event.key === 'ArrowUp') { event.preventDefault(); stretchToolWindow('up'); return }
    if (event.key === 'ArrowDown') { event.preventDefault(); stretchToolWindow('down'); return }
  }
  // Back/Forward = Ctrl+Alt+Left/Right.
  if (event.ctrlKey && event.altKey && !event.shiftKey && event.key === 'ArrowLeft') { event.preventDefault(); void goBack(); return }
  if (event.ctrlKey && event.altKey && !event.shiftKey && event.key === 'ArrowRight') { event.preventDefault(); void goForward(); return }
  if (event.key === 'F11') {
    event.preventDefault()
    if (event.ctrlKey) openMnemonicPrompt()
    else if (event.shiftKey) showView('bookmarks')
    else toggleBookmark()
    return
  }
  if (digit !== undefined && event.ctrlKey && !event.altKey) {
    event.preventDefault()
    if (event.shiftKey) toggleBookmark(Number(digit)); else jumpMnemonic(Number(digit))
    return
  }
  // Ctrl+Shift+Backspace = Jump to Last Change (project-wide).
  if (event.key === 'Backspace' && event.ctrlKey && event.shiftKey && active.value) { event.preventDefault(); jumpLastEditLocation(); return }
  // Alt+Insert Generate, Ctrl+Alt+Shift+Insert New Scratch File.
  if (event.key === 'Insert' && event.altKey && !event.ctrlKey && !event.shiftKey && workspace.value) { event.preventDefault(); void openGeneratePopup(); return }
  if (event.key === 'Insert' && event.altKey && event.ctrlKey && event.shiftKey && workspace.value) { event.preventDefault(); void createScratch(); return }
  // Alt+F1 Select In (project view), Alt+F12 Terminal. Alt+<digit> is handled up front
  // by focusToolWindowByNumber (IDEA ActivateToolWindowAction), never here.
  if (event.key === 'F1' && event.altKey && !event.ctrlKey && !event.shiftKey && active.value) { event.preventDefault(); selectInTree(); return }
  if (event.key === 'F12' && event.altKey && !event.ctrlKey && workspace.value) { event.preventDefault(); showOutput('terminal'); return }
  // $default.xml:309-311 and :717-719 — Alt+Left/Right is PreviousTab/NextTab. They are tab
  // navigation, not caret motion: `TabNavigationActionBase.java:71-78` hands them to the editor's
  // tabs or to the active tool window's tabs, and `CodeEditor.vue` shadows CodeMirror's
  // syntax-wise cursor motion on the same chord.
  if (event.altKey && !event.ctrlKey && !event.metaKey && workspace.value) {
    if (event.key === 'ArrowLeft') { event.preventDefault(); selectPreviousTab(); return }
    if (event.key === 'ArrowRight') { event.preventDefault(); selectNextTab(); return }
  }
  // $default.xml:864-866 — Shift+F12 is RestoreDefaultLayout ("Restore Current Layout",
  // `RestoreDefaultLayoutAction.java:41-47`), a different action from bare F12 below.
  if (event.key === 'F12' && event.shiftKey && !event.ctrlKey && !event.altKey && workspace.value) { event.preventDefault(); restoreCurrentToolLayout(); return }
  // $default.xml:846-848 — bare F12 is JumpToLastWindow ("Activate the last focused tool
  // window"), *not* FileStructure: that one is Ctrl+F12 (:279-281 FileStructurePopup). This
  // check has to sit above the "needs Ctrl or Alt" bail-out below, because F12 has neither.
  if (event.key === 'F12' && !event.ctrlKey && !event.altKey && !event.shiftKey && !event.metaKey && workspace.value) { event.preventDefault(); jumpToLastToolWindow(); return }
  if (event.key === 'Backquote' && event.ctrlKey && event.shiftKey && workspace.value) { event.preventDefault(); showView('git'); return }
  if (event.key === 'Backquote' && event.altKey && workspace.value) { event.preventDefault(); showView('git'); return }
  // Ctrl+Shift+' — MaximizeToolWindow ($default.xml:885-887 `control shift QUOTE`, macOS keymap
  // :394-396 `ctrl shift QUOTE`). The physical key is what the keymap stores, so the check uses
  // `code` (Shift turns the produced character into `"` on most layouts).
  if (event.code === MAXIMIZE_SHORTCUT_CODE && event.ctrlKey && event.shiftKey && !event.altKey) { event.preventDefault(); maximizeActiveToolWindow(); return }
  // --- VCS, from VcsActions.xml (Ctrl+K Commit) and dvcs-impl (Ctrl+Shift+K Push) ---
  if (event.key.toLowerCase() === 'k' && event.ctrlKey && event.shiftKey && workspace.value && gitAvailable.value) { event.preventDefault(); void gitMenuAction('git.push'); return }
  if (event.key.toLowerCase() === 'k' && event.ctrlKey && workspace.value && gitAvailable.value) { event.preventDefault(); showView('git'); return }
  if (!(event.ctrlKey || event.metaKey) && !event.altKey) return
  // --- Files / actions / search / refactor, from $default.xml ---
  // $default.xml:260-262 — Ctrl+Shift+F4 is CloseActiveTab (`CloseActiveTabAction.java:39-58`).
  if (event.key === 'F4' && event.ctrlKey && event.shiftKey && workspace.value) { event.preventDefault(); closeActiveTab(); return }
  if (event.key.toLowerCase() === 'a' && event.shiftKey) { event.preventDefault(); openActionSearch(); return }
  if (event.key.toLowerCase() === 's' && event.altKey) { event.preventDefault(); void openSettings(); return }
  if (event.key.toLowerCase() === 's') { event.preventDefault(); void (event.shiftKey ? saveAll() : save()) }
  // Ctrl+Shift+N file, Ctrl+N class, Ctrl+Shift+Alt+N symbol.
  if (event.key.toLowerCase() === 'n' && event.shiftKey && event.altKey && workspace.value && lspReady.value) { event.preventDefault(); openSymbol('global'); return }
  if (event.key.toLowerCase() === 'n' && event.shiftKey && workspace.value) { event.preventDefault(); openPalette(); return }
  if (event.key.toLowerCase() === 'o' && event.shiftKey && !event.altKey) { event.preventDefault(); void openWorkspace(); return }
  if (event.key.toLowerCase() === 'g' && event.shiftKey && !event.altKey && active.value) { event.preventDefault(); void showBlame(); return }
  if (event.key.toLowerCase() === 'n' && workspace.value && lspReady.value) { event.preventDefault(); openSymbol('global'); return }
  // Ctrl+Shift+F12 is HideAllWindows ($default.xml:870-872) and must be tested before the
  // Ctrl+F12 branch, which used to swallow it because it did not look at Shift.
  if (event.key === 'F12' && event.ctrlKey && event.shiftKey && workspace.value) { event.preventDefault(); toggleMaximizeEditor(); return }
  // Ctrl+F12 = FileStructurePopup ($default.xml:279-281). Shift is excluded explicitly, so the
  // two branches cannot both match even if their order is ever changed.
  if (event.key === 'F12' && event.ctrlKey && !event.shiftKey && workspace.value && lspReady.value) { event.preventDefault(); openSymbol('file'); return }
  if (event.key === 'Shift' && !event.repeat) {
    const now = event.timeStamp
    if (now - lastShiftAt < 400) { lastShiftAt = 0; event.preventDefault(); openActionSearch(); return }
    lastShiftAt = now
  }
  // Ctrl+Shift+F Find in Path, Ctrl+E recent files / Ctrl+Shift+E recent locations,
  // Ctrl+G Goto Line.
  if (event.key.toLowerCase() === 'f' && event.shiftKey && workspace.value) { event.preventDefault(); showView('search'); return }
  if (event.key.toLowerCase() === 'e' && workspace.value) { event.preventDefault(); if (event.shiftKey) openRecentPlaces(); else openRecentFiles(); return }
  if (event.key.toLowerCase() === 'g' && !event.shiftKey && active.value) { event.preventDefault(); openGoLine(); return }
  // Introduce/Extract/Inline, from $default.xml (Ctrl+Alt+V/C/M/N).
  if (event.altKey && event.ctrlKey && !event.shiftKey) {
    if (event.key.toLowerCase() === 'v') { event.preventDefault(); extractVariable(); return }
    if (event.key.toLowerCase() === 'c') { event.preventDefault(); extractConstant(); return }
    if (event.key.toLowerCase() === 'm') { event.preventDefault(); extractMethod(); return }
    if (event.key.toLowerCase() === 'n') { event.preventDefault(); inlineVariable(); return }
  }
  // Run Inspection (Ctrl+Shift+Alt+I), Quick Documentation (Ctrl+Q), Copy Reference.
  if (event.key.toLowerCase() === 'i' && event.ctrlKey && event.shiftKey && event.altKey && lspReady.value && active.value) { event.preventDefault(); void openCodeActions(caretPayload(), true); return }
  if (event.key.toLowerCase() === 'q' && !event.shiftKey && active.value && lspReady.value) { event.preventDefault(); void showQuickDoc(); return }
  if (event.key.toLowerCase() === 'c' && event.altKey && event.shiftKey && active.value) { event.preventDefault(); void copyReference(); return }
}
function onUnload(event: BeforeUnloadEvent) { if (dirty.value) { event.preventDefault(); event.returnValue = '' } }
// IDEA's "synchronize files on frame activation". Clean buffers follow the disk; a
// buffer with unsaved edits is never touched (its save still fails with CONFLICT),
// and large files are skipped so focusing the window stays instant.
const syncLimit = 4 * 1024 * 1024
let syncing = false
async function syncFromDisk() {
  if (!isDesktop || !workspace.value || syncing) return
  if (!editorSettings.value.syncOnFocus) return
  syncing = true
  try {
    workspace.value = { ...workspace.value, entries: await request<Entry[]>('workspace.list', { path: '' }) }
    treeVersion.value++
  } catch { /* the project may have closed mid-flight */ }
  for (const tab of allTabs.value) {
    if (tab.dirty || tab.content.length > syncLimit) continue
    try {
      const disk = await request<DocumentData>('file.read', { path: tab.path, encoding: tab.encoding })
      // A lock set outside the IDE must reach the buffer even when content is unchanged.
      if (disk.readOnly !== tab.readOnly) {
        tab.readOnly = disk.readOnly
        editorFor(tab.path)?.setReadOnly(Boolean(disk.readOnly))
      }
      if (disk.version === tab.version) continue
      Object.assign(tab, { content: disk.content, version: disk.version, encoding: disk.encoding, bom: disk.bom })
      editorFor(tab.path)?.setDraft(disk.content)
      if (tab.lspRunning) void request('lsp.change', { path: tab.path, text: disk.content }).catch(() => undefined)
      notify(`磁盘上的 ${tab.path} 已变化，编辑器已同步`)
    } catch { /* deleted or unreadable: keep the buffer as it is */ }
  }
  syncing = false
}
function onWindowFocus() { void syncFromDisk() }
function onVisibility() { if (document.visibilityState === 'visible') void syncFromDisk() }
// IDE-03 live file watching: the native watcher already debounced the OS noise, so
// this handler only coalesces UI work — refresh the tree once per batch and let
// syncFromDisk pull the changed buffers (dirty ones are never touched).
let fsWatchTimer: number | undefined
let lastFsVersion = 0
async function onFsChanges() {
  if (!isDesktop || !workspace.value) return
  if (fsWatchTimer !== undefined) return
  fsWatchTimer = window.setTimeout(async () => {
    fsWatchTimer = undefined
    if (!workspace.value) return
    // Ignore our own writes: the version snapshot only changes for external edits.
    try {
      workspace.value = { ...workspace.value, entries: await request<Entry[]>('workspace.list', { path: '' }) }
      treeVersion.value++
    } catch { /* the project may have closed mid-flight */ }
    await syncFromDisk()
  }, 400)
}
watch(() => fsChanges.version, value => { if (value !== lastFsVersion) { lastFsVersion = value; void onFsChanges() } })
// `workspace/applyEdit` (a quick fix or organize-imports) writes the file natively:
// the buffer must follow, or the editor keeps showing text that is no longer on disk.
watch(() => lspEdited.version, async () => {
  const path = lspEdited.path
  if (!path) return
  const tab = findTab(path)
  if (!tab) return
  try {
    const doc = await request<DocumentData>('file.read', { path })
    tab.content = doc.content
    tab.version = doc.version
    tab.readOnly = doc.readOnly
    tab.dirty = false
    editorFor(path)?.setDraft(doc.content)
    notify(`「${path}」已被语言服务修改，编辑器已重新载入。`)
  } catch (error) { notify(`语言服务改动了「${path}」，但重新载入失败：${errorMessage(error)}`, true) }
})
// A terminal the debug adapter opened (runInTerminal) belongs in the Terminal tool
// window — the host already spawned it, the UI just has to show it.
watch(() => termOpened.version, async () => {
  if (!termOpened.id) return
  showOutput('terminal')
  await nextTick()
  const panel = terminalPanelRef.value as unknown as { adopt?: (id: number, label?: string) => void } | null
  panel?.adopt?.(termOpened.id, termOpened.cwd ? `调试终端 · ${termOpened.cwd.split(/[\\/]/).pop() || termOpened.cwd}` : undefined)
})
// The directory watcher died and was restarted (or gave up): say so instead of letting
// the file tree silently go stale.
watch(() => watchStopped.version, () => {
  if (!watchStopped.reason) return
  notify(watchStopped.restarting
    ? `文件监听已重启（原因：${watchStopped.reason}，第 ${watchStopped.attempt} 次）。`
    : `文件监听已停止：${watchStopped.reason}。文件树不再自动刷新，重新打开项目可恢复。`, !watchStopped.restarting)
})
function trapFocus(event: KeyboardEvent) {
  if (event.key !== 'Tab') return
  const controls = (event.currentTarget as HTMLElement).querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled)')
  const first = controls[0]
  const last = controls[controls.length - 1]
  if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus() }
  else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus() }
}
watch(theme, value => {
  document.documentElement.dataset.theme = value
  document.documentElement.style.colorScheme = value
  setNativeTheme(value)
}, { immediate: true })
// IDEA "Use contrast scrollbars": a thicker, high-contrast scrollbar.
// IDEA mainMenuDisplayMode: one markup, three layouts — the menu bar stays where it
// is and CSS decides whether it sits inline, wraps to its own row, or is hidden
// behind a hamburger button.
watch(() => editorSettings.value.mainMenuDisplayMode, mode => {
  document.documentElement.dataset.mainMenu = mode || 'merged'
  if (mode !== 'hamburger') hamburgerOpen.value = false
}, { immediate: true })
// IDEA "Support screen readers": notifications are announced through a live region
// and hover tooltips are suppressed (the IDEA checkbox says tooltips "will be disabled").
// IDEA's checkbox says tooltips "will be disabled" while accessibility names stay:
// every title attribute is copied into aria-label (when there is none) and removed,
// and a MutationObserver keeps doing that for anything rendered later.
let screenReaderObserver: MutationObserver | null = null
function stripHoverTitles(root: ParentNode) {
  for (const element of root.querySelectorAll<HTMLElement>('[title]')) {
    if (!element.getAttribute('aria-label')) element.setAttribute('aria-label', element.getAttribute('title') ?? '')
    element.removeAttribute('title')
  }
}
watch(() => editorSettings.value.supportScreenReaders, on => {
  document.documentElement.dataset.screenReader = on ? 'on' : 'off'
  if (screenReaderObserver) { screenReaderObserver.disconnect(); screenReaderObserver = null }
  if (!on) return
  stripHoverTitles(document)
  screenReaderObserver = new MutationObserver(records => {
    for (const record of records)
      for (const node of record.addedNodes)
        if (node instanceof HTMLElement) {
          if (node.hasAttribute('title')) {
            if (!node.getAttribute('aria-label')) node.setAttribute('aria-label', node.getAttribute('title') ?? '')
            node.removeAttribute('title')
          }
          stripHoverTitles(node)
        }
  })
  screenReaderObserver.observe(document.body, { childList: true, subtree: true })
}, { immediate: true })
onBeforeUnmount(() => screenReaderObserver?.disconnect())
// IDEA's hamburger menu: one button that opens every menu group in a single popup.
const hamburgerOpen = ref(false)
const hamburgerGroup = ref<string | null>(null)
// IDEA's "Bracket matching highlight" (editor setting): CodeMirror's basicSetup
// keeps the matcher installed, so the setting controls the highlight itself —
// switching it off removes the matching-bracket emphasis in every editor.
watch(() => editorSettings.value.bracketMatching, on => {
  document.documentElement.dataset.bracketMatching = on ? 'on' : 'off'
}, { immediate: true })
watch(() => editorSettings.value.useContrastScrollbars, on => {
  document.documentElement.dataset.scrollbars = on ? 'contrast' : 'default'
}, { immediate: true })
// IDEA's colour-vision deficiency filter: an feColorMatrix applied to the whole UI.
watch(() => editorSettings.value.colorBlindness, mode => {
  document.documentElement.dataset.colorBlind = mode && mode !== 'none' ? mode : 'off'
}, { immediate: true })
// IDEA "Use custom font": the UI font stack (the editor font is its own setting).
watch([() => editorSettings.value.uiFontFamily, () => editorSettings.value.uiFontSize], ([family, size]) => {
  const root = document.documentElement.style
  if (family) root.setProperty('--font-ui', `'${family.replace(/'/g, '')}', 'Segoe UI Variable', 'Segoe UI', 'Microsoft YaHei UI', sans-serif`)
  else root.removeProperty('--font-ui')
  document.documentElement.dataset.uiFontSize = String(size || 13)
}, { immediate: true })
// IDEA AppearanceConfigurable, applied for real:
//  - ideScale: the whole UI scales (IDEA zooms the Swing hierarchy; a web UI does it
//    with a rem multiplier, so every spacing tied to a token follows).
//  - compactMode (IDEA "Compact mode - UI elements take up less screen space"):
//    control heights and paddings shrink through density variables.
watch(() => editorSettings.value.uiZoomPercent, percent => {
  document.documentElement.style.fontSize = `${(percent ?? 100) / 100 * 16}px`
}, { immediate: true })

// IDEA Images.SetBackgroundImage: the chosen image is painted behind the editor
// stage; fill/opacity/keep-ratio come from the same dialog IDEA shows.
const backgroundImage = ref('')
watch([() => editorSettings.value.backgroundImagePath, () => editorSettings.value.backgroundImageOpacity,
       () => editorSettings.value.backgroundImageFill, () => editorSettings.value.backgroundImageKeepRatio],
  async ([path, opacity, fill, keepRatio]) => {
    if (!path) { backgroundImage.value = ''; applyBackground(''); return }
    // The bytes are re-read on startup; a path that no longer exists just means
    // "no background" (the setting stays so it comes back if the file returns).
    try {
      const image = await request<{ dataUrl: string } | null>('app.readImage', { path })
      backgroundImage.value = image?.dataUrl ?? ''
    } catch { backgroundImage.value = '' }
    applyBackground(backgroundImage.value)
    const stage = document.documentElement.style
    stage.setProperty('--bg-image-opacity', String((opacity ?? 100) / 100))
    stage.setProperty('--bg-image-size', fill === 'tile' ? 'auto' : fill === 'center' ? 'auto' : keepRatio ? 'contain' : '100% 100%')
    stage.setProperty('--bg-image-repeat', fill === 'tile' ? 'repeat' : 'no-repeat')
    stage.setProperty('--bg-image-position', fill === 'tile' ? 'top left' : 'center')
    document.documentElement.dataset.background = backgroundImage.value ? 'on' : 'off'
  }, { immediate: true })
function applyBackground(dataUrl: string) {
  if (dataUrl) document.documentElement.style.setProperty('--bg-image-url', `url("${dataUrl}")`)
  else document.documentElement.style.removeProperty('--bg-image-url')
}
// IDEA presentation mode (UISettingsState.presentationMode + presentationModeFontSize):
// hides the chrome and enlarges the text for screen sharing.
watch([() => editorSettings.value.presentationMode, () => editorSettings.value.presentationModeFontSize], ([on, size]) => {
  zenMode.value = on
  document.documentElement.dataset.presentation = on ? 'on' : 'off'
  if (on) document.documentElement.style.fontSize = `${Math.min(72, Math.max(12, size || 24))}px`
}, { immediate: true })
async function chooseBackgroundImage() {
  try {
    const image = await request<{ dataUrl: string; path: string } | null>('dialog.pickImage')
    if (!image) return
    await saveSettingsPatch({ backgroundImagePath: image.path })
    notify('已设置背景图像。')
  } catch (error) { notify(errorMessage(error), true) }
}
async function clearBackgroundImage() {
  await saveSettingsPatch({ backgroundImagePath: '' })
  notify('已移除背景图像。')
}
watch(() => editorSettings.value.compactMode, compact => {
  document.documentElement.dataset.density = compact ? 'compact' : 'regular'
}, { immediate: true })
// IDEA "Smooth scrolling" (UISettings.smoothScrolling): the entire interface
// scrolls smoothly instead of line by line — scroll-behavior on the root.
watch([() => editorSettings.value.smoothScrolling, () => editorSettings.value.powerSaveMode], ([smooth, powerSave]) => {
  // IDEA's power save mode stops animations too (JBAnimator/ScrollSettings), so the
  // effective scrolling is "smooth AND not saving power".
  document.documentElement.style.scrollBehavior = smooth && !powerSave ? 'smooth' : 'auto'
  document.documentElement.dataset.motion = powerSave ? 'reduced' : 'full'
}, { immediate: true })
// IDEA "Side-by-side layout on the left": the project view keeps a pane of its own.
const leftSideBySide = computed(() => editorSettings.value.leftSideBySide && Boolean(workspace.value))
// The same option for the right stripe.
const rightSideBySide = computed(() => editorSettings.value.rightSideBySide && Boolean(workspace.value))
watch(() => editorSettings.value.wideScreenSupport, () => {
  setPanelSize('output', panelSizes.output)
}, { immediate: false })
// IDEA "Show tool window bars" / "Show tool window names": the stripe rail can be
// hidden entirely, and its buttons can carry the window's name under the icon.
watch(() => editorSettings.value.showToolWindowBars, show => {
  document.documentElement.dataset.toolStripes = show ? 'on' : 'off'
}, { immediate: true })
// IDEA "Display icons in menu items" (UISettings.showIconsInMenus): menus keep their
// leading icon column only while this is on.
watch(() => editorSettings.value.showIconsInMenus, show => {
  document.documentElement.dataset.menuIcons = show ? 'on' : 'off'
}, { immediate: true })
watch(() => editorSettings.value.showToolWindowNames, show => {
  document.documentElement.dataset.toolNames = show ? 'on' : 'off'
}, { immediate: true })
// IDEA "Show tool window numbers": the stripe buttons wear Alt+1..9 mnemonics and
// those shortcuts really do focus the window (same order as the stripe).
watch(() => editorSettings.value.showToolWindowNumbers, show => {
  document.documentElement.dataset.toolNumbers = show ? 'on' : 'off'
}, { immediate: true })
function focusToolWindowByNumber(event: KeyboardEvent) {
  // IDEA: ActivateToolWindowAction always answers Alt+N — showToolWindowsNumbers only
  // decides whether the stripe button prints the number (StripeButton.kt:287-296),
  // so the shortcut must not depend on that setting.
  if (!event.altKey) return
  const id = TOOL_MNEMONIC_BINDINGS[event.key]
  if (!id) return
  // An unavailable tool window has its action disabled (:131-137), so the shortcut does
  // nothing at all — it must never fall through and open some *other* tool window.
  if (toolDisabled(id)) return
  event.preventDefault()
  showView(id)
}
// IDEA's welcome page shows each recent project's git branch (RecentProjectPanel
// reads it from persisted project state). TaoCode records the branch the status
// bar already polled, keyed by root, and the welcome page reads it back.
watch(gitHead, head => {
  const root = workspace.value?.root
  if (!root || !head) return
  try { localStorage.setItem(`taocode.branch:${root}`, head) } catch { /* storage unavailable: the line is simply absent */ }
})
watch(dirty, value => setNativeDirty(value))
watch(activePath, path => { references.value = []; if (bottomTab.value === 'references') bottomTab.value = 'output'; void refreshOutline(path) })
watch(query, () => { paletteIndex.value = 0 })
watch(palette, async value => { if (value) { paletteIndex.value = 0; await nextTick(); queryInput.value?.focus() } })
watch(help, async value => { if (value) { await nextTick(); helpClose.value?.focus() } })
watch(leavePrompt, async value => { if (value) { await nextTick(); leaveCancel.value?.focus() } })
watch(() => runOutput.length, async () => {
  await nextTick(); if (runLog.value) runLog.value.scrollTop = runLog.value.scrollHeight
  // Feed the streamed lines to the test runner so per-test results accumulate
  // (IDEA's test tree fills while the process runs, not after it exits).
  for (const line of runOutput.slice(pumpedRunLines)) testRunnerRef.value?.ingest(line)
  pumpedRunLines = runOutput.length
})
let pumpedRunLines = 0
// Run an arbitrary command from a panel (e.g. the test runner's rerun command).
async function startRunWith(command: string) {
  if (!command.trim() || runState.running) return
  beginRun(); showOutput('run')
  try { await request('run.start', { command, shell: true }) }
  catch (error) { endRun(); notify(`无法启动：${errorMessage(error)}`, true) }
}
// Build-output navigation: the parsers live in src/buildOutput.ts (unit-tested
// against MSVC, GCC/Clang/Rust, javac and CMake shapes); this only adapts them to
// the live console and the workspace root.
interface RunIssue { path: string; line: number; column: number }
function parseRunIssue(text: string): RunIssue | null {
  return parseAnyIssue(text, workspace.value?.root ?? '')
}
const runLines = computed(() => runOutput.join('').split('\n').slice(-2000).map(text => ({ text, issue: parseRunIssue(text) })))
const runIssueList = computed(() => runLines.value.filter(line => line.issue).map(line => line.issue!))
const runIssueCount = computed(() => runIssueList.value.length)
let runIssueCursor = 0
watch(() => runState.running, value => { if (value) runIssueCursor = 0 })
function jumpToIssue(issue: RunIssue) { void revealLocation({ path: issue.path, line: Math.max(0, issue.line - 1) }) }
function nextRunIssue() {
  const issues = runIssueList.value
  if (!issues.length) { notify('输出里没有可跳转的问题。', true); return }
  jumpToIssue(issues[runIssueCursor % issues.length])
  runIssueCursor++
}
// IDEA raises a balloon when the build/run tool window is not focused: green on exit
// 0, red with "view detail" jumping to the console otherwise.
let lastRunExit: number | null | undefined
watch(() => runState.exit, value => {
  if (value === null || value === undefined || value === lastRunExit) return
  lastRunExit = value
  if (bottom.value && bottomTab.value === 'run') return
  notify(value === 0 ? '构建/运行完成（退出码 0）。' : `构建/运行失败（退出码 ${value}）。`, value !== 0, () => { showOutput('run'); notice.value = '' })
})
onMounted(() => {
  // Capture phase: CodeMirror's keymap binds Ctrl+Shift+Backspace per buffer, but
  // IDEA's JumpToLastChange is project-wide, so the window handler wins first.
  window.addEventListener('keydown', onKey, true)
  window.addEventListener('beforeunload', onUnload)
  window.addEventListener('resize', onWindowResize)
  window.addEventListener('focus', onWindowFocus)
  document.addEventListener('visibilitychange', onVisibility)
  void bootstrap()
})
onBeforeUnmount(() => {
  answerLeave('cancel')
  resetLsp()
  resizeCleanup?.()
  window.removeEventListener('keydown', onKey, true)
  window.removeEventListener('beforeunload', onUnload)
  window.removeEventListener('resize', onWindowResize)
  window.removeEventListener('focus', onWindowFocus)
  document.removeEventListener('visibilitychange', onVisibility)
  clearAutoSave()
  if (bookmarkSave) window.clearTimeout(bookmarkSave)
  if (sessionTimer) { window.clearTimeout(sessionTimer); sessionTimer = undefined }
  if (markdownTimer !== undefined) { window.clearTimeout(markdownTimer); markdownTimer = undefined }
  if (fsWatchTimer !== undefined) { window.clearTimeout(fsWatchTimer); fsWatchTimer = undefined }
  if (gitStatusTimer !== undefined) { window.clearInterval(gitStatusTimer); gitStatusTimer = undefined }
})
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
  <div class="ide-shell" :class="{ 'is-resizing': resizing }" :style="{ '--explorer-width': `${panelSizes.explorer}px`, '--trace-width': `${panelSizes.trace}px`, '--output-height': `${panelSizes.output}px` }" @pointerdown.capture="dismissMenu" @focusin="noteDockFocus">
    <header v-if="workspace && !zenMode" class="topbar">
      <div class="brand">TaoCode</div>
      <button v-if="editorSettings.mainMenuDisplayMode === 'hamburger'" class="icon-button hamburger-button" :aria-expanded="hamburgerOpen" aria-haspopup="menu" title="主菜单（汉堡按钮）" aria-label="打开主菜单" @click.stop="hamburgerOpen = !hamburgerOpen"><Menu :size="17" /></button>
      <nav class="menubar" aria-label="主菜单">
        <div v-for="group in allMenuGroups" :key="group.menu" class="menu-anchor">
          <button class="menu-button" :aria-expanded="menu === group.menu" aria-haspopup="menu" :aria-controls="`menu-${group.menu}`" @click="menu = menu === group.menu ? null : group.menu" @keydown.down.prevent="focusMenu(group.menu)" @keydown.up.prevent="focusMenu(group.menu, true)">{{ group.label }}</button>
          <AnimatePresence>
            <motion.div v-if="menu === group.menu" :id="`menu-${group.menu}`" :key="group.menu" class="dropdown" role="menu" :aria-label="group.label" :initial="popupEnter" :animate="{ opacity: 1, y: 0, scale: 1 }" :exit="popupExit" :transition="popupTransition" @keydown="onMenuKeydown($event, group.menu)">
              <template v-for="row in group.rows" :key="row.id">
                <div v-if="row.rule" class="menu-rule" role="separator" />
                <div v-else-if="row.section" class="menu-section-label" role="presentation">{{ row.section }}</div>
                <template v-else-if="row.recent">
                  <button v-for="project in recentProjects.slice(0, 6)" :key="project.path" class="menu-item recent-menu-item" role="menuitem" :disabled="working || !project.available" :title="project.path" @click="openRecentProject(project)"><FolderOpen :size="14" class="menu-item-icon" /><span class="recent-menu-name">{{ project.name }}</span></button>
                  <span v-if="!recentProjects.length" class="menu-empty">暂无最近项目</span>
                </template>
                <button v-else class="menu-item" :role="row.checked ? 'menuitemcheckbox' : 'menuitem'" :aria-checked="row.checked ? row.checked() : undefined" :disabled="!rowEnabled(row)" @click="pickMenuRow(row)"><span class="menu-item-icon"><Check v-if="row.checked && row.checked()" :size="13" /></span><span class="menu-item-title">{{ rowTitle(row) }}</span><kbd v-if="row.keys">{{ row.keys }}</kbd></button>
              </template>
            </motion.div>
          </AnimatePresence>
        </div>
      </nav>
      <div class="project-widget"><button class="header-widget" :aria-expanded="projectWidgetOpen" aria-haspopup="menu" :aria-label="`项目 ${workspace.name}`" :title="workspace.root" @click.stop="toggleProjectWidget"><FolderOpen :size="14" /><span class="project-widget-name">{{ workspace.name }}</span><ChevronDown :size="12" :class="{ 'project-widget-caret': true, open: projectWidgetOpen }" /></button><div v-if="projectWidgetOpen" class="project-widget-popup" role="menu" :aria-label="`项目 ${workspace.name}`"><input v-model="projectWidgetQuery" class="project-widget-search" placeholder="搜索项目（名称或路径）" aria-label="搜索项目" @keydown.esc.stop="projectWidgetQuery ? (projectWidgetQuery = '') : (projectWidgetOpen = false)" /><template v-for="group in projectWidgetGroups" :key="group.label"><div class="project-widget-group" role="presentation">{{ group.label }}</div><button v-for="project in group.items" :key="`${group.label}:${project.path}`" class="menu-button project-widget-row" role="menuitem" :disabled="working || !project.available" :title="project.path" @click="pickProjectFromWidget(project)"><span class="menu-item-icon"><FolderOpen :size="13" /></span><span class="project-widget-details"><span class="project-widget-title">{{ project.name }}</span><span class="project-widget-path">{{ project.path }}</span><span v-if="branchOfProject(project.path)" class="project-widget-branch"><GitBranch :size="11" />{{ branchOfProject(project.path) }}</span></span></button></template><p v-if="!projectWidgetGroups.length" class="menu-empty">没有匹配的项目</p></div></div>
      <button class="command-box" @click="openPalette"><Search :size="13" /><span>{{ workspace?.name ?? '打开工作区，开始构建' }}</span><kbd>Ctrl Shift N</kbd></button>
      <!-- IDEA's main-toolbar centre region: the filename widget (FilenameToolbarWidgetAction.kt
           :49-181). It replaces the file name the editor tabs carry, so IDEA shows it once the
           window header holds the full path; clicking it lists the other recent files,
           middle-click / Shift+click closes the file (UIUtil.java:1843-1846). -->
      <div v-if="filenameShown" class="filename-widget">
        <button
          class="header-widget filename-button" :class="`filename-${filenameStatusKind}`"
          :aria-expanded="filenamePopup" aria-haspopup="listbox"
          :aria-label="`${ACCESSIBLE_NAME_PREFIX} ${filenameLabel}`" :title="filenameTooltip"
          @click.stop="toggleFilenamePopup" @mouseup="onFilenameMouseUp"
        ><FileCode2 :size="14" /><span class="filename-text">{{ filenameLabel }}</span></button>
        <div v-if="filenamePopup" class="filename-popup" role="listbox" :aria-label="`${ACCESSIBLE_NAME_PREFIX} ${filenameLabel}`">
          <button v-for="row in filenameRecentRows" :key="row.path" class="menu-button filename-row" role="option" :aria-selected="false" :title="row.path" @click="pickRecentFile(row.path)"><FileCode2 :size="13" :class="`filename-${recentFileKind(row.path)}`" /><span class="filename-row-text">{{ row.name }}</span></button>
        </div>
      </div>
      <div class="topbar-widgets"><!-- IDEA New UI header widgets: main.toolbar.git.Branches and the Run widget -->
        <button v-if="gitHead" class="header-widget" :title="`当前分支 ${gitHead}（点击打开源代码管理）`" aria-label="Git 分支" @click="showView('git')"><GitBranch :size="14" /><span>{{ gitHead }}</span><span v-if="gitAheadBehind.available && (gitAheadBehind.ahead || gitAheadBehind.behind)" class="header-widget-count">{{ gitAheadBehind.ahead ? `↑${gitAheadBehind.ahead}` : '' }}{{ gitAheadBehind.behind ? `↓${gitAheadBehind.behind}` : '' }}</span></button>
        <div class="header-run">
          <button class="header-widget run-button" :class="{ running: runState.running }" :title="runWidgetTitle" aria-label="运行" @click="runState.running ? void stopRun() : void runSelectedConfig(false)"><Play v-if="!runState.running" :size="14" /><Square v-else :size="12" /></button>
          <button class="header-widget run-caret" :aria-expanded="configChooser !== null" aria-haspopup="menu" title="选择运行配置 (Alt+Shift+F10)" aria-label="选择运行配置" @click="openConfigChooser(false)">▾</button>
        </div>
      </div>
      <div class="topbar-right"><button class="icon-button theme-toggle" :title="theme === 'dark' ? '切换到亮色主题' : '切换到暗色主题'" :aria-label="theme === 'dark' ? '切换到亮色主题' : '切换到暗色主题'" @click="changeTheme(theme === 'dark' ? 'light' : 'dark')"><Sun v-if="theme === 'dark'" :size="17" /><Moon v-else :size="17" /></button><button class="icon-button" title="设置 (Ctrl+Alt+S)" aria-label="打开设置" :disabled="working" @click="openSettings()"><SlidersHorizontal :size="17" /></button><button class="icon-button" title="快捷键与框架说明" aria-label="快捷键与框架说明" @click="help = true"><CircleHelp :size="17" /></button></div>
    </header>

    <div v-if="configChooser && !zenMode" class="config-chooser" role="listbox" :aria-label="configChooser.debug ? '选择要调试的配置' : '选择要运行的配置'">
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
    <div v-if="hamburgerOpen && !zenMode" class="hamburger-menu" role="menu" aria-label="主菜单">
      <button v-for="group in allMenuGroups" :key="group.menu" class="menu-button hamburger-group" role="menuitem" :aria-expanded="hamburgerGroup === group.menu" @click="hamburgerGroup = hamburgerGroup === group.menu ? null : group.menu">{{ group.label }}</button>
      <template v-if="hamburgerGroup">
        <div class="menu-rule" role="separator" />
        <button v-for="row in allMenuGroups.find(g => g.menu === hamburgerGroup)?.rows ?? []" :key="row.id" class="menu-item hamburger-item" role="menuitem" :disabled="!rowEnabled(row)" @click="pickMenuRow(row); hamburgerOpen = false; hamburgerGroup = null">{{ rowTitle(row) }}<kbd v-if="row.keys">{{ row.keys }}</kbd></button>
      </template>
    </div>
    <div v-if="hamburgerOpen" class="hamburger-backdrop" @click="hamburgerOpen = false; hamburgerGroup = null" />
    <p v-if="editorSettings.supportScreenReaders" class="sr-live" role="status" aria-live="polite">{{ notice ?? '' }}</p>
    <div v-if="!isDesktop && !zenMode" class="preview-banner"><span class="preview-dot" />浏览器预览<span class="preview-description">示例文件仅保存在内存。运行 C++ 桌面端以访问本地工作区。</span><span class="banner-right">Vue 3 / WebView2 / C++20</span></div>

    <WelcomePage v-if="!workspace" :projects="recentProjects" :busy="working" :error="appError" :git-available="gitAvailable" :is-desktop="isDesktop" :plugin-count="pluginList.length" :theme="theme" :settings="editorSettings" :notices="noticeLog" @open="openWorkspace" @create="beginProject('create')" @clone="beginProject('clone')" @settings="openSettings()" @forget="forgetProject" @refresh="refreshRecent" @help="help = true" @plugins="openPlugins" @theme="changeTheme" @settings-change="saveSettingsPatch" @clear-notices="clearNotices" />

    <div v-else class="workbench" :class="{ 'zen-workbench': zenMode, 'tool-maximized': maximizedSide !== null }">
      <aside v-if="explorer && !zenMode" class="activity-bar" aria-label="工具栏">
        <template v-for="id in stripeOrder('left')" :key="id">
          <span v-if="isDropBefore('left', id)" class="stripe-drop-marker" aria-hidden="true" />
          <button
            class="activity-button" :class="{ active: explorer && leftView === id, dragging: draggingTool === id }"
            draggable="true" :title="`${toolTitles[id]}（可拖到另一侧或拖动重排）`" :aria-label="`切换${toolTitles[id]}`" :disabled="toolDisabled(id)"
            @click="activateToolWindow(id)" @contextmenu.prevent="openToolMenu(id)"
            @dragstart="onToolDragStart(id, $event)" @dragover="onToolDragOver('left', id, $event)" @drop="onToolDrop('left', id, $event)" @dragend="onToolDragEnd"
          ><component :is="toolIcons[id]" :size="21" /><span class="activity-name">{{ toolTitles[id] }}</span><span class="activity-number">{{ toolWindowMnemonic(id) }}</span></button>
        </template>
        <span v-if="dropTarget?.side === 'left' && !dropTarget.before" class="stripe-drop-marker" aria-hidden="true" />
        <button class="activity-button" :class="{ active: activity }" title="处理记录" aria-label="切换处理记录" @click="activity = !activity"><Workflow :size="21" /></button>
        <div class="rail-divider" />
        <button class="activity-button" :class="{ active: bottom }" title="输出面板" aria-label="切换输出面板" @click="bottom = !bottom"><span class="activity-name">输出</span><TerminalSquare :size="20" /></button>
        <div class="rail-bottom"><button class="activity-button" title="设置 (Ctrl+Alt+S)" aria-label="设置" :disabled="working" @click="openSettings()"><SlidersHorizontal :size="20" /></button><span class="local-avatar" title="仅本地工作区">L</span></div>
      </aside>

      <aside v-if="explorer && !zenMode && activeAnchor === 'left'" class="explorer-panel" tabindex="-1">
        <ToolWindowHeader
          :id="leftView" :title="toolTitles[leftView] ?? '工具窗口'" anchor="left"
          :maximized="maximizedSide === 'left'" :menu-open="toolMenu === leftView"
          @activate="focusToolWindowContent(leftView)"
          @hide="explorer = false; toolMenu = null"
          @maximize="toggleToolMaximized('left')"
          @move="setToolAnchor(leftView, $event); toolMenu = null"
          @menu="toolMenu = $event ? leftView : null"
        />
        <template v-if="leftView === 'search'">
          <SearchPanel :root="workspace?.root ?? ''" :active="explorer && leftView === 'search'" @open="onSearchOpen" @replaced="onSearchReplaced" />
        </template>
        <template v-else-if="leftView === 'todo'">
          <TodoPanel :root="workspace?.root ?? ''" :active="explorer && leftView === 'todo'" :patterns="projectSettings.todoPatterns" :source="todoSource" @open="onSearchOpen" />
        </template>
        <template v-else-if="leftView === 'outline'">
          <OutlinePanel :path="active?.path ?? ''" :symbols="outline" :available="lspReady" @jump="({ line, character }) => revealLocation({ path: activePath, line, column: (character ?? 0) + 1 })" />
        </template>
        <template v-else-if="leftView === 'bookmarks'">
          <BookmarksPanel :entries="sortedAll" :active-path="activePath" @jump="entry => revealLocation({ path: entry.path, line: entry.line - 1 })" @remove="dropBookmark" @assign="openMnemonicPrompt" />
        </template>
        <template v-else-if="leftView === 'debug'">
          <DebugPanel :active-path="activePath" :ready="isDesktop && Boolean(workspace)" :evaluate-request="evaluateRequest" :program="runConfigProgram" :cwd="runConfigCwd" :adapter-kind="runConfigDebugAdapter" @jump="jumpDebugLocation" />
        </template>
        <template v-else-if="leftView === 'history'">
          <HistoryPanel :key="`hist:${activePath}:${historyEpoch}`" :path="activePath" :ready="isDesktop && Boolean(workspace)" @revert="revertHistory" />
        </template>
        <template v-else-if="leftView === 'tests'">
          <TestRunnerPanel ref="testRunnerRef" :active-path="activePath" :file-text="active ? editorFor(active.path)?.text() ?? active.content : ''" :root="workspace?.root ?? ''" :ready="isDesktop && Boolean(workspace)" @jump="({ path, line }) => revealLocation({ path, line: Math.max(0, line - 1) })" @run-command="command => void startRunWith(command)" />
        </template>
        <template v-else-if="leftView === 'git'">
          <SourceControl :root="workspace?.root ?? ''" :active="explorer && leftView === 'git'" :todo-patterns="projectSettings.todoPatterns" :commit-settings="commitMessageSettings" @notify="notifyFromPanel" />
        </template>
        <template v-else-if="leftView === 'vcslog'">
          <VcsLog :root="workspace?.root ?? ''" :active="explorer && leftView === 'vcslog'" />
        </template>
        <template v-else>
        <div class="panel-heading"><span>资源管理器</span><div class="heading-actions"><button class="icon-button" title="全部折叠" aria-label="全部折叠" :disabled="!workspace" @click="fileTreeRef?.collapseAll()"><ChevronsDownUp :size="15" /></button><button class="icon-button" title="全部展开" aria-label="全部展开" :disabled="!workspace" @click="fileTreeRef?.expandAll()"><ChevronsUpDown :size="15" /></button><button class="icon-button" title="选中当前文件 (Alt+F1,1)" aria-label="在项目中选中当前文件" :disabled="!active" @click="selectInTree"><Crosshair :size="14" /></button><button class="icon-button" title="打开文件夹" aria-label="打开文件夹" :disabled="working" @click="openWorkspace()"><FolderOpen :size="15" /></button><button class="icon-button" title="刷新目录" aria-label="刷新目录" :disabled="!workspace || busy" @click="refreshTree"><RefreshCw :size="14" /></button></div></div>
        <div v-if="workspace" class="workspace-heading" :title="workspace.root"><ChevronDown :size="13" /><span>{{ workspace.name }}</span><span class="local-tag">{{ isDesktop ? '本地' : '示例' }}</span></div>
        <div class="tree-scroll">
          <FileTree v-if="workspace" ref="fileTreeRef" :key="treeVersion" :entries="workspace.entries" :active="activePath" :synthetic="syntheticNodes" :indent-guides="editorSettings.showTreeIndentGuides" :compact-indents="editorSettings.compactTreeIndents" @open="path => void openFile(path, false, { preview: true })" @error="notify($event, true)" @context="onTreeContext" />
          <div v-else class="explorer-empty"><FolderOpen :size="26" /><p>尚未打开工作区</p><button class="subtle-button" @click="openWorkspace()">选择文件夹</button></div>
        </div>
        <div class="explorer-footer"><ShieldCheck :size="14" /><span>文件操作限定在工作区内</span></div>
        <div class="tree-note">排除目录：{{ projectSettings.excludedDirs.join(' / ') || '无' }}<br />不跟随符号链接与目录联接</div>
        </template>
        <!-- IDEA "Side-by-side layout on the left": the project view stays visible
             below the active left tool window instead of being replaced by it. -->
        <template v-if="leftSideBySide && leftView !== 'files' && workspace">
          <div class="dock-split" aria-hidden="true" />
          <div class="panel-heading"><span>资源管理器</span></div>
          <div class="tree-scroll side-by-side-tree">
            <FileTree :key="`side:${treeVersion}`" :entries="workspace.entries" :active="activePath" :synthetic="syntheticNodes" :indent-guides="editorSettings.showTreeIndentGuides" :compact-indents="editorSettings.compactTreeIndents" @open="path => void openFile(path, false, { preview: true })" @error="notify($event, true)" @context="onTreeContext" />
          </div>
        </template>
      </aside>

      <!-- IDEA's right dock: a tool window anchored right renders in its own column
           (ToolWindowAnchor.RIGHT), with the same ⋮ options menu as the left dock. -->
      <aside v-if="explorer && !zenMode && activeAnchor === 'right'" class="explorer-panel right-dock" tabindex="-1">
        <ToolWindowHeader
          :id="leftView" :title="toolTitles[leftView] ?? '工具窗口'" anchor="right"
          :maximized="maximizedSide === 'right'" :menu-open="toolMenu === leftView"
          @activate="focusToolWindowContent(leftView)"
          @hide="explorer = false; toolMenu = null"
          @maximize="toggleToolMaximized('right')"
          @move="setToolAnchor(leftView, $event); toolMenu = null"
          @menu="toolMenu = $event ? leftView : null"
        />
        <template v-if="leftView === 'search'">
          <SearchPanel :root="workspace?.root ?? ''" :active="explorer && leftView === 'search'" @open="onSearchOpen" @replaced="onSearchReplaced" />
        </template>
        <template v-else-if="leftView === 'todo'">
          <TodoPanel :root="workspace?.root ?? ''" :active="explorer && leftView === 'todo'" :patterns="projectSettings.todoPatterns" :source="todoSource" @open="onSearchOpen" />
        </template>
        <template v-else-if="leftView === 'outline'">
          <OutlinePanel :path="active?.path ?? ''" :symbols="outline" :available="lspReady" @jump="({ line, character }) => revealLocation({ path: activePath, line, column: (character ?? 0) + 1 })" />
        </template>
        <template v-else-if="leftView === 'bookmarks'">
          <BookmarksPanel :entries="sortedAll" :active-path="activePath" @jump="entry => revealLocation({ path: entry.path, line: entry.line - 1 })" @remove="dropBookmark" @assign="openMnemonicPrompt" />
        </template>
        <template v-else-if="leftView === 'debug'">
          <DebugPanel :active-path="activePath" :ready="isDesktop && Boolean(workspace)" :evaluate-request="evaluateRequest" :program="runConfigProgram" :cwd="runConfigCwd" :adapter-kind="runConfigDebugAdapter" @jump="jumpDebugLocation" />
        </template>
        <template v-else-if="leftView === 'history'">
          <HistoryPanel :key="`hist:${activePath}:${historyEpoch}`" :path="activePath" :ready="isDesktop && Boolean(workspace)" @revert="revertHistory" />
        </template>
        <template v-else-if="leftView === 'tests'">
          <TestRunnerPanel ref="testRunnerRef" :active-path="activePath" :file-text="active ? editorFor(active.path)?.text() ?? active.content : ''" :root="workspace?.root ?? ''" :ready="isDesktop && Boolean(workspace)" @jump="({ path, line }) => revealLocation({ path, line: Math.max(0, line - 1) })" @run-command="command => void startRunWith(command)" />
        </template>
        <template v-else-if="leftView === 'git'">
          <SourceControl :root="workspace?.root ?? ''" :active="explorer && leftView === 'git'" :todo-patterns="projectSettings.todoPatterns" :commit-settings="commitMessageSettings" @notify="notifyFromPanel" />
        </template>
        <template v-else-if="leftView === 'vcslog'">
          <VcsLog :root="workspace?.root ?? ''" :active="explorer && leftView === 'vcslog'" />
        </template>
        <template v-else>
          <div class="panel-heading"><span>资源管理器</span></div>
          <div v-if="workspace" class="workspace-heading" :title="workspace.root"><ChevronDown :size="13" /><span>{{ workspace.name }}</span></div>
          <div class="tree-scroll">
            <FileTree v-if="workspace" ref="fileTreeRef" :key="treeVersion" :entries="workspace.entries" :active="activePath" :synthetic="syntheticNodes" :indent-guides="editorSettings.showTreeIndentGuides" :compact-indents="editorSettings.compactTreeIndents" @open="path => void openFile(path, false, { preview: true })" @error="notify($event, true)" @context="onTreeContext" />
          </div>
          <template v-if="rightSideBySide && leftView !== 'files'">
            <div class="dock-split" aria-hidden="true" />
            <div class="panel-heading"><span>资源管理器</span></div>
            <div class="tree-scroll side-by-side-tree">
              <FileTree :key="`side-r:${treeVersion}`" :entries="workspace.entries" :active="activePath" :synthetic="syntheticNodes" :indent-guides="editorSettings.showTreeIndentGuides" :compact-indents="editorSettings.compactTreeIndents" @open="path => void openFile(path, false, { preview: true })" @error="notify($event, true)" @context="onTreeContext" />
            </div>
          </template>
        </template>
      </aside>

      <!-- IDEA's right stripe (Stripe.java): a narrow rail listing the tool windows
           anchored right, clickable exactly like the left activity bar. -->
      <aside v-if="!zenMode && stripeOrder('right').length" class="activity-bar right-stripe" aria-label="右侧工具窗口条" @dragover="onToolDragOver('right', null, $event)" @drop="onToolDrop('right', null, $event)">
        <template v-for="id in stripeOrder('right')" :key="id">
          <span v-if="isDropBefore('right', id)" class="stripe-drop-marker" aria-hidden="true" />
          <button class="activity-button" :class="{ active: explorer && leftView === id, dragging: draggingTool === id }" draggable="true" :title="`${toolTitles[id]}（可拖到另一侧或拖动重排）`" :aria-label="`切换${toolTitles[id]}`" :disabled="toolDisabled(id)" @click="activateToolWindow(id)" @contextmenu.prevent="openToolMenu(id)" @dragstart="onToolDragStart(id, $event)" @dragover="onToolDragOver('right', id, $event)" @drop="onToolDrop('right', id, $event)" @dragend="onToolDragEnd"><component :is="toolIcons[id]" :size="21" /><span class="activity-name">{{ toolTitles[id] }}</span><span class="activity-number">{{ toolWindowMnemonic(id) }}</span></button>
        </template>
        <span class="stripe-drop-hint" aria-hidden="true" />
      </aside>

      <div v-if="explorer && !zenMode" class="resize-handle resize-explorer" role="separator" aria-label="调整资源管理器宽度" aria-orientation="vertical" :aria-valuenow="panelSizes.explorer" :aria-valuemin="180" :aria-valuemax="Math.max(180, panelMax('explorer'))" tabindex="0" @pointerdown="startResize($event, 'explorer')" @keydown="resizeKey($event, 'explorer')" />
      <main class="editor-column" :class="{ 'split-horizontal': splitOrientation === 'horizontal', 'split-vertical': splitOrientation === 'vertical' }">
        <!-- IDEA: each pane is an editor group with its own tab bar; the focused group
             is marked by a stronger top border on its tabs. -->
        <template v-for="pane in ([0, 1] as const)" :key="pane">
          <template v-if="pane === 1 && splitOrientation !== 'none'">
            <div class="resize-handle split-divider" :class="splitOrientation === 'horizontal' ? 'resize-split-h' : 'resize-split-v'" role="separator" :aria-label="splitOrientation === 'horizontal' ? '调整左右分屏宽度' : '调整上下分屏高度'" :aria-orientation="splitOrientation === 'horizontal' ? 'vertical' : 'horizontal'" tabindex="0" @pointerdown="startSplitResize($event)" @keydown="resizeSplitKey($event)" />
          </template>
          <div v-if="pane === 0 || splitOrientation !== 'none'" class="editor-pane" :class="[pane === 0 ? 'primary-pane' : 'secondary-pane', { 'pane-focused': focusedPane === pane }]" :style="pane === 1 ? (splitOrientation === 'horizontal' ? { flex: `0 1 ${splitSize}px`, minWidth: '160px' } : { flex: `0 1 ${splitSize}px`, minHeight: '160px' }) : undefined" @pointerdown.capture="focusPane(pane)">
            <div class="editor-tabs" role="tablist" :aria-label="pane === 0 ? '编辑器标签组' : '第二标签组'" @dragover="onTabDragOver(pane, $event)" @drop="onTabStripDrop(pane, $event)">
              <div v-for="tab in groups[pane].tabs" :key="`${pane}:${tab.path}`" class="file-tab" :class="{ selected: groups[pane].activePath === tab.path, pinned: tab.pinned, preview: tab.preview && groups[pane].activePath !== tab.path, dragging: dragTab?.pane === pane && dragTab.path === tab.path }" draggable="true" @dragstart="onTabDragStart(pane, tab, $event)" @dragend="dragTab = null" @dragover="onTabDragOver(pane, $event)" @drop="onTabDrop(pane, tab.path, $event)" @contextmenu="onTabContext(pane, tab, $event)">
                <button class="tab-select" role="tab" :aria-selected="groups[pane].activePath === tab.path" :title="tab.path" @click="switchTabIn(pane, tab)"><FileCode2 :size="14" /><span>{{ tab.path.split('/').pop() }}</span><Pin v-if="tab.pinned" :size="11" class="pin-mark" aria-label="已固定" /><span v-if="tab.dirty" class="dirty-dot" aria-label="未保存" /></button>
                <button class="tab-close" :aria-label="`关闭 ${tab.path}`" :disabled="tab.saving" @click="closeTabIn(pane, tab)"><X :size="12" /></button>
              </div>
              <div v-if="!groups[pane].tabs.length" class="welcome-tab"><Braces :size="14" />工作台</div>
              <div class="tab-toolbar">
                <template v-if="pane === 0">
                  <button class="icon-button" title="后退 (Ctrl Alt ←)" aria-label="后退" :disabled="!navBack.length" @click="goBack"><ArrowLeft :size="16" /></button>
                  <button class="icon-button" title="前进 (Ctrl Alt →)" aria-label="前进" :disabled="!navForward.length" @click="goForward"><ArrowRight :size="16" /></button>
                  <button class="icon-button" title="保存文件 (Ctrl+S)" aria-label="保存文件" :disabled="!active || !active.dirty || active.saving" @click="save()"><Save :size="15" /></button>
                  <button class="icon-button" title="切换处理记录" aria-label="切换右侧处理记录" @click="activity = !activity"><span class="activity-name">处理记录</span><ListTree :size="16" /></button>
                </template>
                <template v-else>
                  <button class="icon-button" title="向右分屏（活动标签，Shift+Enter）" aria-label="向右分屏" :disabled="!focusedTab" @click="focusedTab && splitTabOut(focusedTab, 'horizontal')"><Columns2 :size="15" /></button>
                  <button class="icon-button" title="向下分屏（活动标签，Ctrl+Shift+Enter）" aria-label="向下分屏" :disabled="!focusedTab" @click="focusedTab && splitTabOut(focusedTab, 'vertical')"><Rows3 :size="15" /></button>
                  <button class="icon-button" title="取消分屏" aria-label="取消分屏" @click="unsplit"><X :size="14" /></button>
                </template>
              </div>
            </div>
            <div v-if="groupActive(pane)" class="breadcrumbs"><button class="breadcrumb-seg" title="项目根" @click="explorer = true; leftView = 'files'">{{ workspace?.name }}</button><ChevronRight :size="12" /><template v-for="(seg, i) in groupActive(pane)!.path.split('/').slice(0, -1)" :key="i"><button class="breadcrumb-seg" :title="`转到 ${seg}`" @click="openBreadcrumb(i)">{{ seg }}</button><ChevronRight :size="12" /></template><span class="breadcrumb-file"><FileCode2 :size="12" />{{ groupActive(pane)!.path.split('/').pop() }}</span><span class="editor-save-state">{{ groupActive(pane)!.saving ? '保存中…' : groupActive(pane)!.dirty ? '有未保存修改' : isDesktop ? '已读取磁盘版本' : '内存示例' }}</span><button v-if="markdownCapable && focusedPane === pane && groupActive(pane)?.path === activePath" class="status-chip md-toggle" :class="{ active: markdownPreviewOn }" title="切换 Markdown 预览" aria-label="切换 Markdown 预览" @click="toggleMarkdownPreview">预览</button></div>
            <div class="editor-stage" :class="{ 'has-md-preview': markdownPreviewOn && markdownCapable && focusedPane === pane && groupActive(pane)?.path === activePath }">
              <BinaryViewer v-if="binaryView && pane === focusedPane" :path="binaryView.path" :data="binaryView.data" @close="closeBinary" @reveal="revealBinary" />
              <CodeEditor v-for="tab in groups[pane].tabs" v-show="groups[pane].activePath === tab.path" :key="`${workspaceEpoch}:${bufferEpoch}:${pane}:${tab.path}`" :ref="element => setEditorRef(pane, tab.path, element)" :content="tab.content" :path="tab.path" :language="associationOf(tab.path)" :theme="theme" :settings="editorSettings" :templates="projectSettings.templates" :active="groups[pane].activePath === tab.path && focusedPane === pane" :lsp-enabled="lspOn(tab)" :reveal="pane === focusedPane && tab.path === reveal?.path ? reveal : null" :breakpoints="dapBreakpoints.get(tab.path) ?? []" :debug-line="currentDebugLine(tab.path)" :bookmarks="bookmarkLines[tab.path] ?? []" @change="onEditorChange(tab)" @cursor="(line, column) => { tab.line = line; tab.column = column }" @save="save(tab)" @error="notify($event, true)" @reveal="revealLocation" @semantic="onSemantic" @evaluate="requestEvaluate" @surround="openSurround" @breakpoint="line => toggleBreakpointAt(tab.path, line)" @column-mode="active => { if (pane === focusedPane && tab.path === activePath) columnMode = active }" @selection="info => { if (pane === focusedPane && tab.path === activePath) selectionInfo = info }" @cursors="count => { if (pane === focusedPane && tab.path === activePath) cursorCount = count }" />
              <MarkdownPreview v-if="markdownPreviewOn && markdownCapable && focusedPane === pane && groupActive(pane)?.path === activePath" class="md-split" :path="activePath" :content="markdownSource" @open="path => void openFile(path, false, { preview: true })" @error="message => notify(message, true)" />
              <div v-if="!groups[pane].tabs.length && !binaryView && pane === 0" class="welcome-screen">
                <div class="welcome-symbol"><FolderOpen :size="28" :stroke-width="1.3" /></div>
                <h1>{{ workspace.name }}</h1>
                <p>从项目树选择文件开始编辑。</p>
                <div class="workbench-actions"><button class="subtle-button" @click="openPalette">转到文件 <kbd>Ctrl Shift N</kbd></button><button class="subtle-button" @click="openSettings()">项目设置</button></div>
                <div class="welcome-shortcuts"><span>全部保存 <kbd>Ctrl Shift S</kbd></span><span>设置 <kbd>Ctrl Alt S</kbd></span><span>切换项目 <kbd>Ctrl Shift O</kbd></span></div>
                <button class="menu-button back-to-projects" :disabled="working" @click="closeWorkspace()">返回项目列表 <ArrowRight :size="13" /></button>
              </div>
            </div>
          </div>
        </template>
        <div v-if="bottom && !zenMode" class="resize-handle resize-output" role="separator" aria-label="调整输出面板高度" aria-orientation="horizontal" :aria-valuenow="panelSizes.output" :aria-valuemin="100" :aria-valuemax="panelMax('output')" tabindex="0" @pointerdown="startResize($event, 'output')" @keydown="resizeKey($event, 'output')" />
        <section v-if="bottom && !zenMode" class="output-panel">
          <div class="output-heading"><div v-if="isTabbedContentUi(bottomContentUiType)" class="output-tabs"><button :class="{ selected: bottomTab === 'output' }" @click="showOutput('output')">操作输出 <span class="count-badge">{{ traces.length }}</span></button><button :class="{ selected: bottomTab === 'run' }" @click="showOutput('run')">运行 <span v-if="runState.running" class="count-badge">●</span><span v-else-if="runState.exit !== null" class="count-badge">exit {{ runState.exit }}</span></button><button :class="{ selected: bottomTab === 'problems' }" @click="showOutput('problems')">问题 <span class="count-badge">{{ allProblems.length }}</span></button><button v-if="references.length" :class="{ selected: bottomTab === 'references' }" @click="showOutput('references')">引用 <span class="count-badge">{{ references.length }}</span></button><button v-if="hierRoot" :class="{ selected: bottomTab === 'hierarchy' }" @click="showOutput('hierarchy')">{{ hierTitle }} <span class="count-badge">{{ hierItems.length }}</span></button><button :class="{ selected: bottomTab === 'terminal' }" @click="showOutput('terminal')"><SquareTerminal :size="11" /> 终端</button><button v-if="blameLines.length || bottomTab === 'blame'" :class="{ selected: bottomTab === 'blame' }" @click="showOutput('blame')"><GitCommitHorizontal :size="11" /> 追溯 <span class="count-badge">{{ blameLines.length }}</span></button><button :class="{ selected: bottomTab === 'about' }" @click="showOutput('about')">工作区说明</button></div><select v-else class="output-content-select" aria-label="工具窗口内容" :value="bottomTab" @change="showOutput(($event.target as HTMLSelectElement).value as BottomTabId)"><option v-for="option in bottomTabOptions" :key="option.id" :value="option.id">{{ option.label }}</option></select><div class="heading-actions"><span class="small-muted">{{ isDesktop ? 'C++ BRIDGE' : 'PREVIEW ADAPTER' }}</span><button class="icon-button" title="收起输出" aria-label="收起输出" @click="bottom = false"><X :size="14" /></button></div></div>
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
              <button v-if="!runState.running" class="primary-button" :disabled="!isDesktop || !workspace" @click="startRun">运行</button>
              <button v-else class="subtle-button" @click="stopRun">停止</button>
            </div>
            <!-- IDEA's build console: recognised compiler diagnostics are clickable and
                 jump to the offending line instead of being read as plain text. -->
            <div ref="runLog" class="run-log" aria-label="运行输出">
              <template v-if="runLines.length">
                <div v-for="(line, index) in runLines" :key="index" class="run-line" :class="{ 'run-issue': line.issue }">
                  <button v-if="line.issue" class="run-issue-link" :title="`跳转到 ${line.issue!.path}:${line.issue!.line}`" @click="jumpToIssue(line.issue!)">{{ line.text }}</button>
                  <span v-else>{{ line.text }}</span>
                </div>
              </template>
              <p v-else class="run-placeholder">{{ isDesktop ? '点击“运行”在项目根目录执行命令；输出与退出码会实时显示。' : '浏览器预览不能运行命令，请在桌面端使用。' }}</p>
            </div>
            <div v-if="runIssueCount" class="run-issues">
              <span class="run-issue-count">输出里有 {{ runIssueCount }} 处可跳转的问题</span>
              <button class="subtle-button" title="跳到下一处问题" @click="nextRunIssue">下一处问题</button>
            </div>
            <div v-if="runState.running" class="run-stdin"><span>$</span><input ref="runInput" aria-label="向进程发送输入" placeholder="输入一行发送到进程 stdin，回车确认" @keydown.enter.prevent="sendRunInput" /></div>
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
          <div v-else-if="bottomTab === 'blame'" class="blame-panel">
            <div class="blame-head"><span class="blame-file">{{ blamePath || '当前文件' }}</span><button class="icon-button" title="重新追溯" aria-label="重新追溯" @click="showBlame"><RefreshCw :size="14" /></button><span class="blame-hint">点击行可跳到编辑器对应位置</span></div>
            <div class="blame-rows" role="list" :aria-label="`Git 追溯 ${blamePath}`">
              <p v-if="!blameLines.length" class="blame-empty">正在追溯…（需要桌面端，且该文件已被提交）</p>
              <button v-for="(entry, index) in blameLines" :key="`${entry.line}:${index}`" class="blame-row" :class="{ 'blame-new-commit': index === 0 || blameLines[index - 1].hash !== entry.hash }" @click="revealLocation({ path: blamePath, line: entry.line - 1 })">
                <span class="blame-sha">{{ entry.hash }}</span>
                <span class="blame-author" :title="entry.author">{{ entry.author }}</span>
                <span class="blame-num">{{ entry.line }}</span>
                <span class="blame-text">{{ entry.content || ' ' }}</span>
              </button>
            </div>
          </div>
          <div v-else-if="bottomTab === 'about'" class="workspace-about"><p><strong>工作区</strong>{{ workspace?.root ?? '尚未打开' }}</p><p><strong>文件支持</strong>UTF-8 文本（含 BOM），单文件最多 16 MiB；保留换行符；大文件自动降级语法高亮与语言服务以保持流畅。</p><p><strong>保存策略</strong>核对磁盘版本后原子替换；外部变更会阻止覆盖。</p><p><strong>范围</strong>支持项目管理、文件编辑、Git 克隆、语言服务、全局搜索/替换、重构与符号、集成终端与调试器。</p></div>
          <div v-show="bottomTab === 'terminal'" class="terminal-host-wrap"><TerminalPanel ref="terminalPanelRef" :active="bottomTab === 'terminal' && bottom" @focus-terminal="showOutput('terminal')" /></div>
        </section>
      </main>

      <div v-if="activity && !zenMode" class="resize-handle resize-trace" role="separator" aria-label="调整处理记录宽度" aria-orientation="vertical" :aria-valuenow="panelSizes.trace" :aria-valuemin="180" :aria-valuemax="Math.max(180, panelMax('trace'))" tabindex="0" @pointerdown="startResize($event, 'trace')" @keydown="resizeKey($event, 'trace')" />
      <aside v-if="activity && !zenMode" class="trace-panel">
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
      <motion.div v-if="notice" key="workspace-notice" class="notice workspace-notice" :class="{ error: noticeError, clickable: Boolean(noticeAction) }" role="status" :title="noticeAction ? '点击查看运行控制台' : undefined" @click="noticeAction?.()" :initial="reducedMotion ? { opacity: 1 } : { opacity: 0, y: 8 }" :animate="{ opacity: 1, y: 0 }" :exit="popupExit" :transition="popupTransition"><Check v-if="!noticeError" :size="15" class="notice-icon" /><CircleHelp v-else :size="15" class="notice-icon" /><span>{{ notice }}</span><button class="icon-button" title="关闭提示" aria-label="关闭提示" @click.stop="notice = ''"><X :size="13" /></button></motion.div>
    </AnimatePresence>
    <footer v-if="workspace && !zenMode" ref="statusBarRef" class="statusbar" role="group" aria-label="状态栏" @contextmenu="openStatusMenu" @keydown="onStatusBarKeydown"><div class="status-left"><span class="status-brand"><Braces :size="13" /></span><button class="status-toolwindows" :aria-label="editorSettings.showToolWindowBars ? '隐藏工具窗口条' : '显示工具窗口条'" :aria-expanded="toolWindowsPopup" @click="toggleToolWindowStripes" @mouseenter="scheduleToolWindowsPopup(true)" @mouseleave="scheduleToolWindowsPopup(false)"><PanelLeftClose v-if="editorSettings.showToolWindowBars" :size="13" /><PanelLeftOpen v-else :size="13" /></button><div v-if="toolWindowsPopup" class="status-toolwindows-popup" role="menu" aria-label="工具窗口" @mouseenter="scheduleToolWindowsPopup(true)" @mouseleave="scheduleToolWindowsPopup(false)" @keydown.esc.stop="closeToolWindowsPopup()"><button v-for="id in availableToolWindows" :key="id" class="menu-button status-toolwindows-row" role="menuitem" @click="closeToolWindowsPopup(); showView(id)"><span class="menu-item-icon"><component :is="toolIcons[id]" :size="13" /></span><span class="status-toolwindows-name">{{ toolTitles[id] }}</span><span class="status-toolwindows-key">Alt+{{ toolWindowMnemonic(id) }}</span></button><p v-if="!availableToolWindows.length" class="status-toolwindows-empty">当前没有可用的工具窗口。</p></div><button v-if="active && showWidget('file')" class="status-file" :title="`在资源管理器中定位 ${active.path} (Alt+F1,1)`" @click="selectInTree"><span class="status-file-root">{{ workspace?.name }}</span><ChevronRight :size="11" /><span>{{ active.path }}</span></button><button v-if="gitHead && showWidget('branch')" class="status-branch" :title="`当前分支 ${gitHead}（点击打开源代码管理）`" @click="showView('git')"><GitBranch :size="12" />{{ gitHead }}<span v-if="gitAheadBehind.available && gitAheadBehind.ahead" class="status-count">↑{{ gitAheadBehind.ahead }}</span><span v-if="gitAheadBehind.available && gitAheadBehind.behind" class="status-count">↓{{ gitAheadBehind.behind }}</span></button><span v-if="showWidget('bridge')"><span class="status-dot" />{{ isDesktop ? '原生桥接已连接' : '浏览器示例模式' }}</span><span class="status-separator">|</span><span>{{ working ? '正在处理…' : '就绪' }}</span><span v-if="dirty" class="status-unsaved">有未保存修改</span></div><!-- IDEA's InfoAndProgressPanel: a compact indicator in the status bar; clicking it lists every running background task. --><div v-if="showProgressWidget(backgroundTasks.length > 0, progressOpen) && showWidget('progress')" class="status-progress" :class="{ open: progressOpen }"><button class="status-progress-toggle" :aria-expanded="progressOpen" :title="progressOpen ? '收起后台任务列表' : '查看所有运行中的进程'" aria-label="后台任务" @click.stop="progressOpen = !progressOpen"><Loader2 v-if="backgroundTasks.length" :size="12" class="status-spin" /><Check v-else :size="12" aria-hidden="true" /><span>{{ backgroundTasks.length ? `后台任务 ${backgroundTasks.length}` : '后台任务' }}</span></button><div v-if="progressOpen" class="status-progress-list" role="menu" aria-label="后台任务" @keydown.esc.stop="progressOpen = false"><p v-for="row in progressRows" :key="`${row.kind}:${row.title}`" class="status-progress-row" :class="[`status-progress-${row.kind}`, { 'has-separator': row.separator }]"><template v-if="row.kind === 'task'"><strong>{{ row.title }}</strong><span>{{ row.detail }}</span><button v-if="row.cancellable" class="status-progress-cancel" :aria-label="`取消：${row.title}`" title="取消此任务" @click="cancelProgressRow(row)"><X :size="12" />取消</button></template><template v-else><Check v-if="row.kind === 'finished'" :size="13" aria-hidden="true" class="status-progress-check" /><span>{{ row.title }}</span></template></p></div></div><div class="status-right"><button v-if="smartModeLabel && showWidget('smartMode')" class="status-chip status-smart" :title="`${smartModeLabel}（IDEA 的 Smart Mode 指示器）`" aria-label="语言服务状态" @click="showView('outline')">{{ smartModeLabel }}</button><button v-if="showWidget('problems')" class="status-problems" title="打开问题面板" aria-label="打开问题面板" @click="showOutput('problems')"><span class="sev-error">{{ allProblems.filter(p => p.severity === 1).length }} 错误</span><span class="status-separator">|</span><span class="sev-warning">{{ allProblems.filter(p => p.severity === 2).length }} 警告</span></button><button v-if="active && showWidget('position')" class="status-chip status-position" :title="selectionInfo ? `已选中 ${selectionInfo.characters} 个字符，跨 ${selectionInfo.lines} 行；点击转到行` : '点击转到行 (Ctrl+G)'" aria-label="光标位置" @click="openGoLine()">{{ cursorCount > 1 ? `${cursorCount} 个光标` : selectionInfo ? `已选 ${selectionInfo.characters} 字符` : `${active.line}:${active.column}` }}</button><button v-if="active?.readOnly && showWidget('readonly')" class="status-chip status-locked" title="文件只读（点击切换为可写）" @click="void toggleReadOnly(active!.path)"><Lock :size="12" />只读</button><span v-if="active && showWidget('lineSeparator')">{{ active.content.includes('\r\n') ? 'CRLF' : 'LF' }}</span><button v-if="processMemory && showWidget('memory')" class="status-chip status-memory" :title="`进程工作集 ${processMemory.workingSetMb} MB（历史峰值 ${processMemory.peakWorkingSetMb} MB，提交 ${processMemory.privateMb} MB）。宿主没有 JVM 堆上限，峰值不是上限。`" aria-label="内存使用" @click="refreshMemory">{{ processMemory.workingSetMb }} MB</button><button v-if="active && isDesktop && showWidget('lineSeparator')" class="status-chip" title="转换行分隔符（点击在 Windows 与 Unix 之间切换）" aria-label="转换行分隔符" @click="convertLineSeparators(active.content.includes('\r\n') ? 'lf' : 'crlf')">转换行尾</button><button v-if="showWidget('encoding')" class="status-chip" title="文件编码（点击可重新读取或转换保存）" aria-label="文件编码" :disabled="!active" @click="openEncoding">{{ encodingLabels[active?.encoding ?? 'utf-8'] }}{{ active?.bom ? ' 带 BOM' : '' }}</button><button v-if="showWidget('indent')" class="status-chip" :title="editorSettings.useTabCharacter ? '使用制表符缩进，点击修改' : `使用 ${editorSettings.tabSize} 个空格缩进，点击修改`" aria-label="缩进设置" @click="openSettings('editor')">{{ editorSettings.useTabCharacter ? '制表符' : `${editorSettings.tabSize} 个空格` }}</button><button v-if="columnMode && showWidget('column')" class="status-chip status-column" title="列选择模式已开启（Alt+Shift+Insert 或点击此处关闭）" aria-label="列选择模式" @click="toggleColumnModeFromStatusBar">列选择</button><button v-if="noticeLog.length && showWidget('notices')" class="status-chip status-notices" :class="{ 'has-error': noticeLevel(noticeLog) === 'error' }" :aria-expanded="noticeOpen" :title="noticeTitle(noticeLog)" aria-label="通知中心" @click.stop="noticeOpen = !noticeOpen">{{ noticeLog.length }} 条通知</button><button v-if="editorSettings.powerSaveMode && showWidget('powerSave')" class="status-chip status-powersave" title="省电模式已开启：语言服务与后台轮询暂停，点击关闭" aria-label="省电模式" @click="togglePowerSave"><Zap :size="12" />省电模式</button><span>{{ active ? language : 'TaoCode 0.1' }}</span><button title="切换输出面板" aria-label="切换底部面板" @click="bottom = !bottom"><PanelBottom :size="13" /></button><NoticeList v-if="noticeOpen" :entries="noticeLog" :live="editorSettings.supportScreenReaders" @clear="clearNotices" @close="noticeOpen = false" /></div><div v-if="statusMenu" class="status-widget-menu" role="menu" aria-label="状态栏组件" :style="{ left: `${statusMenu.x}px`, top: `${statusMenu.y}px` }"><span class="status-widget-title">状态栏组件</span><button v-for="widget in STATUS_WIDGETS" :key="widget.key" class="menu-button status-widget-item" role="menuitemcheckbox" :aria-checked="showWidget(widget.key)" @click="toggleWidget(widget.key)"><span class="menu-item-icon"><Check v-if="showWidget(widget.key)" :size="13" /></span><span>{{ widget.label }}</span></button><div class="menu-rule" role="separator" /><button class="menu-button status-widget-item" role="menuitem" @click="showAllWidgets(); statusMenu = null">全部显示</button></div><div v-if="statusMenu" class="status-widget-backdrop" @click="statusMenu = null" @contextmenu.prevent="statusMenu = null" /></footer>

    <ProjectDialog v-if="projectMode" v-model:form="projectForm" :mode="projectMode" :busy="projectBusy || busy" :cancelling="cancelling" :error="projectError" :progress="cloneProgress" :git-available="gitAvailable" :is-desktop="isDesktop" @browse="browseParent" @submit="submitProject" @cancel="cancelProject" />
    <SettingsDialog v-if="settingsOpen" ref="settingsDialogRef" :settings="editorSettings" :project-settings="workspace ? projectSettings : null" :project-root="workspace?.root ?? null" :active-path="activePath" :theme="theme" :busy="settingsBusy" :error="settingsError" :initial-section="settingsSectionHint" @save="saveSettings" @save-project="saveProjectSettings" :commit-message-settings="commitMessageSettings" @save-commit-message="saveCommitMessageSettings" @save-templates="saveTemplateSettings" @save-java="saveJavaSettings" @browse-directory="browseStructureDir" @theme="changeTheme" @pick-background="void chooseBackgroundImage()" @clear-background="void clearBackgroundImage()" @close="settingsOpen = false" />
    <div v-if="leavePrompt" class="modal-backdrop">
      <section class="help-dialog leave-dialog" role="dialog" aria-modal="true" aria-labelledby="leave-title" @keydown="trapFocus">
        <h2 id="leave-title">{{ leavePrompt.title }}</h2><p>以下文件尚未保存；保存失败时不会继续关闭或切换。</p>
        <ul class="unsaved-files"><li v-for="path in leavePrompt.paths" :key="path">{{ path }}</li></ul>
        <div class="leave-actions"><button ref="leaveCancel" class="subtle-button" @click="answerLeave('cancel')">取消</button><button class="subtle-button" @click="answerLeave('discard')">放弃修改并继续</button><button class="primary-button" @click="answerLeave('save')">保存并继续</button></div>
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
      <section class="help-dialog leave-dialog" role="alertdialog" aria-modal="true" aria-labelledby="conflict-title" @keydown="trapFocus">
        <h2 id="conflict-title">保存冲突 · {{ conflictPrompt.path }}</h2>
        <p>磁盘上的文件在你上次读取之后被外部改动过；为避免覆盖对方的修改，保存已被阻止。</p>
        <div class="leave-actions"><button class="subtle-button" @click="resolveConflictKeep()">保留当前修改</button><button class="primary-button" :disabled="!isDesktop" @click="resolveConflictReload()">重新载入磁盘版本</button></div>
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
        <template v-if="treeMenu.entry.kind === 'file'">
          <button class="has-sub" @click="treeSubmenu = treeSubmenu === 'filetype' ? null : 'filetype'">关联文件类型 ▸</button>
          <template v-if="treeSubmenu === 'filetype'">
            <button v-for="[choice, label] in languageChoices" :key="choice" class="sub-item" @click="associateFileType(treeMenu.entry.path, choice)">{{ label }}</button>
            <button class="sub-item" @click="associateFileType(treeMenu.entry.path, 'auto')">自动（按扩展名）</button>
          </template>
        </template>
        <div class="menu-rule" />
        <button @click="cutTreeEntry()">剪切</button>
        <button @click="copyTreeEntry()">复制</button>
        <button @click="copyPath()">复制路径</button>
        <button :disabled="!fileClipboard" @click="pasteFromClipboard()">粘贴</button>
        <div class="menu-rule" />
        <button v-if="treeMenu.entry.kind === 'file'" @click="openFile(treeMenu.entry.path); treeMenu = null; treeSubmenu = null">打开</button>
        <div class="menu-rule" />
        <button v-if="treeMenu.entry.kind === 'file'" :disabled="!lspReady" @click="findUsagesOf(treeMenu.entry.path)">查找用法…</button>
        <button @click="treeMenu = null; treeSubmenu = null; explorer = true; leftView = 'search'">在路径中查找…</button>
        <div class="menu-rule" />
        <button @click="beginRename()">重命名…</button>
        <div class="menu-rule" />
        <button class="menu-danger" @click="beginDelete()">删除…</button>
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
          <button @click="splitFromTabMenu(menu.pane, menu.path, 'horizontal')">向右拆分</button>
          <button @click="splitFromTabMenu(menu.pane, menu.path, 'vertical')">向下拆分</button>
          <button @click="const tab = findTab(menu.path); if (tab) { focusPane(menu.pane); moveTabToOtherPane(menu.pane, tab, 'horizontal') }; tabMenu = null">移动标签页到右侧</button>
          <button @click="const tab = findTab(menu.path); if (tab) { focusPane(menu.pane); moveTabToOtherPane(menu.pane, tab, 'vertical') }; tabMenu = null">移动标签页到下方</button>
          <button @click="openInOppositeGroup(menu.path); tabMenu = null">在另一侧编辑器组中打开</button>
          <button :disabled="splitModel.orientation === 'none'" @click="changeSplitOrientation(); tabMenu = null">更改拆分方向</button>
          <button :disabled="splitModel.orientation === 'none'" @click="unsplit(); tabMenu = null">取消拆分</button>
          <button :disabled="splitModel.orientation === 'none'" @click="unsplitAll(); tabMenu = null">取消所有拆分</button>
          <div class="menu-rule" />
          <button @click="const tab = findTab(menu.path); if (tab) togglePinTab(menu.pane, tab); tabMenu = null">{{ findTab(menu.path)?.pinned ? '取消固定' : '固定标签页' }}</button>
          <button :disabled="!findTab(menu.path)?.preview" @click="const tab = findTab(menu.path); if (tab) keepTabOpen(tab); tabMenu = null">保持打开</button>
          <button @click="tabMenu = null; void openSettings('editor')">配置编辑器标签页…</button>
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
        <p>{{ deleteTarget.kind === 'directory' ? '目录及其所有子项都会从磁盘移除，无法在 TaoCode 内撤销。' : (deleteToTrash ? '该文件会移到系统回收站；如需找回也可用「本地历史」回滚旧版本。' : '该文件将从磁盘直接删除且无法撤销；如需找回只能用「本地历史」回滚旧版本。') }}</p>
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
        <label class="delete-trash"><input v-model="deleteToTrash" type="checkbox" />移到回收站（可恢复）</label>
        <div class="leave-actions"><button ref="leaveCancel" class="subtle-button" @click="deleteTarget = null">取消</button><button class="primary-button menu-danger-solid" @click="confirmDelete">{{ deleteToTrash ? '移到回收站' : '删除' }}</button></div>
      </section>
    </div>
    <!-- EXT-01: plugins contribute commands and templates only; enabling one writes or
         removes a `.disabled` marker beside its manifest. -->
    <div v-if="pluginOpen" class="modal-backdrop" @click.self="pluginOpen = false">
      <section class="help-dialog plugin-dialog" role="dialog" aria-modal="true" aria-labelledby="plugin-title" @keydown="trapFocus">
        <h2 id="plugin-title">插件</h2>
        <p class="plugin-hint">插件目录：用户配置目录下的 <code>plugins</code>。一个插件是一个含 <code>plugin.json</code> 的子目录，只提供命令与模板入口，不加载任何外部代码。</p>
        <p v-if="!pluginList.length" class="plugin-empty">还没有安装插件。</p>
        <ul v-else class="plugin-list">
          <li v-for="plugin in pluginList" :key="plugin.id" class="plugin-row">
            <div class="plugin-main">
              <span class="plugin-name">{{ plugin.name || plugin.id }} <span class="plugin-version">v{{ plugin.version || '0' }}</span></span>
              <span class="plugin-desc">{{ plugin.error ? `清单无法读取：${plugin.error}` : (plugin.description || '没有描述。') }}</span>
              <span v-if="!plugin.error" class="plugin-meta">{{ plugin.commands.length }} 个命令 · {{ plugin.templates.length }} 个模板</span>
            </div>
            <label class="plugin-toggle"><input type="checkbox" :checked="plugin.enabled" :disabled="pluginBusy || Boolean(plugin.error)" @change="togglePlugin(plugin)" />启用</label>
          </li>
        </ul>
        <div class="dialog-actions"><button class="subtle-button" @click="pluginOpen = false">关闭</button></div>
      </section>
    </div>
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
    <div v-if="placesPrompt" class="modal-backdrop" @click.self="placesPrompt = false">
      <section class="command-palette locations-dialog" role="dialog" aria-modal="true" aria-label="最近位置" @keydown="trapFocus"><div class="palette-input"><History :size="18" /><input ref="placesInput" v-model="placesQuery" placeholder="最近位置…（上下键选择，回车跳转）" aria-label="最近位置" @keydown.down.prevent="movePlace(1)" @keydown.up.prevent="movePlace(-1)" @keydown.enter.prevent="placesFiltered[placesIndex] && openPlace(placesFiltered[placesIndex]!)" /><button class="icon-button" aria-label="关闭最近位置" @click="placesPrompt = false"><X :size="16" /></button></div><div class="locations-header"><h2>{{ placesEditedOnly ? '最近更改的位置' : '最近位置' }} <span class="small-muted">({{ placesFiltered.length }})</span></h2><label class="locations-toggle"><input v-model="placesEditedOnly" type="checkbox" />仅显示已编辑的 <kbd>Ctrl E</kbd></label></div><div class="palette-results" role="listbox" aria-label="位置列表"><button v-for="(place, index) in placesFiltered" :key="`${place.kind}:${place.path}:${place.line}`" class="location-row" :class="{ highlighted: index === placesIndex }" role="option" :aria-selected="index === placesIndex" @click="openPlace(place)" @pointerenter="placesIndex = index"><component :is="place.kind === '书签' ? BookmarkIcon : place.kind === '符号' ? ListTree : FileCode2" :size="15" /><span class="location-main"><strong>{{ baseName(place.path) }}<template v-if="place.label !== place.path"> · {{ place.label }}</template></strong><pre v-if="placeSnippet(place).text" class="location-snippet">{{ placeSnippet(place).text }}</pre><span v-else class="location-snippet empty">{{ findTab(place.path) ? '空行' : '文件未打开：无代码预览' }}</span></span><span class="location-path">{{ place.path.split('/').slice(0, -1).join('/') }} · 第 {{ (placeSnippet(place).text ? placeSnippet(place).firstLine : place.line) + 1 }} 行</span></button><p v-if="!placesFiltered.length" class="palette-empty">没有找到最近位置</p></div></section>
    </div>
    <div v-if="symbolPrompt" class="modal-backdrop" @click.self="symbolPrompt = null">
      <section class="command-palette" role="dialog" aria-modal="true" :aria-label="symbolPrompt.mode === 'global' ? '转到符号（全局）' : '文件结构'" @keydown="trapFocus"><div class="palette-input"><Search :size="18" /><input ref="symbolInput" v-model="symbolQuery" :placeholder="symbolPrompt.mode === 'global' ? '转到符号…（全局，输入≥2字）' : '文件结构…（当前文件符号）'" aria-label="符号名称" @input="onSymbolQuery" @keydown.down.prevent="moveSymbol(1)" @keydown.up.prevent="moveSymbol(-1)" @keydown.enter="symbolResults[symbolIndex] && jumpSymbol(symbolResults[symbolIndex]!)" /><button class="icon-button" aria-label="关闭符号选择器" @click="symbolPrompt = null"><X :size="16" /></button></div><div class="palette-scope">{{ symbolPrompt.mode === 'global' ? '全局符号 · 由语言服务提供，需已就绪' : '当前文件符号 · ' + outline.length + ' 项' }}</div><div class="palette-results"><button v-for="(entry, index) in symbolResults" :key="`${entry.path}:${entry.line}:${entry.character}:${index}`" :class="{ highlighted: index === symbolIndex }" @click="jumpSymbol(entry)"><FileCode2 :size="15" /><span>{{ entry.name }}</span><span class="small-muted">{{ entry.path.split('/').pop() }}:{{ entry.line + 1 }}</span><ArrowRight :size="14" /></button><p v-if="!symbolResults.length" class="palette-empty">{{ symbolPrompt.mode === 'global' ? '输入至少两个字符以检索全局符号。' : '当前文件没有符号（或未启用语言服务）。' }}</p></div></section>
    </div>
    <div v-if="actionPrompt" class="modal-backdrop" @click.self="actionPrompt = null">
      <section class="command-palette" role="dialog" aria-modal="true" aria-label="代码操作" @keydown="trapFocus"><div class="palette-scope">代码操作 / 快速修复 · {{ actionPrompt.path }}</div><div class="palette-results"><button v-for="(action, index) in codeActions" :key="`${action.title}:${index}`" :class="{ highlighted: index === 0 }" @click="applyCodeAction(action)"><Sparkles :size="15" /><span>{{ action.title }}</span><span v-if="action.kind" class="small-muted">{{ action.kind }}</span><span v-if="!action.edits.length" class="small-muted">需解析</span></button></div></section>
    </div>
    <div v-if="help" class="modal-backdrop" @click.self="help = false"><section class="help-dialog" role="dialog" aria-modal="true" aria-label="关于 TaoCode" @keydown="trapFocus"><button ref="helpClose" class="icon-button help-close" aria-label="关闭说明" @click="help = false"><X :size="18" /></button><h2>TaoCode <span>0.1 · Foundation</span></h2><p>Vue 3 界面 + CodeMirror 编辑器 + C++20 文件核心。<br />Windows 原生宿主复用系统 WebView2，不捆绑 Electron。</p><div class="help-grid"><span>打开文件夹</span><kbd>Ctrl Shift O</kbd><span>保存当前文件</span><kbd>Ctrl S</kbd><span>转到文件</span><kbd>Ctrl Shift N</kbd><span>转到类</span><kbd>Ctrl N</kbd><span>查找操作</span><kbd>Ctrl Shift A</kbd><span>转到行</span><kbd>Ctrl G</kbd><span>当前文件内查找</span><kbd>Ctrl F</kbd><span>转到定义</span><kbd>Ctrl B</kbd><span>重命名符号</span><kbd>Shift F6</kbd><span>查找用法</span><kbd>Alt F7</kbd><span>智能补全</span><kbd>Ctrl Space</kbd><span>代码操作</span><kbd>Alt Enter</kbd><span>用模板包裹</span><kbd>Ctrl Alt T</kbd><span>格式化（可带选区）</span><kbd>Ctrl Alt L</kbd><span>智能选区</span><kbd>Ctrl W</kbd><span>书签</span><kbd>F11</kbd><span>书签编号 / 跳转</span><kbd>Ctrl F11 · Ctrl 0-9</kbd><span>行断点</span><kbd>Ctrl F8</kbd><span>运行 / 调试配置</span><kbd>Shift F10 · Shift F9</kbd><span>运行 / 调试上下文</span><kbd>Ctrl Shift F10 · Ctrl Shift F9</kbd><span>关闭当前标签页</span><kbd>Ctrl Shift F4</kbd><span>隐藏当前工具窗口</span><kbd>Shift Esc</kbd><span>上一个 / 下一个标签页</span><kbd>Alt ← · Alt →</kbd><span>跳到上一个工具窗口</span><kbd>F12</kbd><span>恢复当前布局</span><kbd>Shift F12</kbd><span>隐藏全部工具窗口</span><kbd>Ctrl Shift F12</kbd><span>最大化编辑器</span><kbd>Ctrl Shift F12</kbd><span>Git 追溯</span><kbd>Ctrl Shift G</kbd><span>后退 / 前进</span><kbd>Ctrl Alt ← · Ctrl Alt →</kbd></div><div class="help-note">当前已接通项目创建、打开、克隆、设置，桌面端语言服务（诊断、悬停、转到定义/实现/类型、补全、重命名、查找引用、符号大纲、代码操作含 resolve 解析、格式化与选区格式化、签名信息、文档内同符号高亮、智能选区、内联提示）、操作查找（Ctrl+Shift+A）、书签与 0-9 编号跳转、模板包裹（Ctrl+Alt+T）、随项目保存的运行配置、全局查找/替换、本地历史快照与回滚、Git 状态/暂存/提交/改写上次提交/分支/日志/储藏/拉取/推送/与分支比较与文件追溯、集成终端（ConPTY + xterm）与调试器（DAP 客户端，需在 exe 旁 TaoCode.dap.json 配置本机调试适配器）；浏览器预览无语言服务、终端与调试器。尚无 AI Agent / 模型执行。处理记录仅保留当前会话，不是持久审计日志。</div></section></div>
  </div>
</template>
