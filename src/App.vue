<script setup lang="ts">
import { computed, defineAsyncComponent, nextTick, onBeforeUnmount, onMounted, reactive, ref, watch } from 'vue'
import { AnimatePresence, motion, useReducedMotion } from 'motion-v'
import { ArrowLeft, ArrowRight, Braces, Bookmark as BookmarkIcon, Bug, Check, ChevronDown, ChevronRight, ChevronsDownUp, ChevronsUpDown, CircleHelp, Code2, Columns2, Crosshair, FileCode2, Files, FolderOpen, FolderTree, GitBranch, GitCommitHorizontal, GitGraph, History, ListChecks, ListTree, Lock, Moon, PanelBottom, Pin, RefreshCw, Rows3, Save, Search, ShieldCheck, SlidersHorizontal, Sparkles, SquareTerminal, Sun, TerminalSquare, Trash2, Workflow, X } from 'lucide-vue-next'
import FileTree, { type SyntheticNode } from './components/FileTree.vue'
import SearchPanel from './components/SearchPanel.vue'
import SourceControl from './components/SourceControl.vue'
import VcsLog from './components/VcsLog.vue'
import OutlinePanel from './components/OutlinePanel.vue'
import DebugPanel from './components/DebugPanel.vue'
import DiffView from './components/DiffView.vue'
import TodoPanel from './components/TodoPanel.vue'
import HistoryPanel from './components/HistoryPanel.vue'
import BookmarksPanel from './components/BookmarksPanel.vue'
import TerminalPanel from './components/TerminalPanel.vue'
import MarkdownPreview from './components/MarkdownPreview.vue'
import WelcomePage from './components/WelcomePage.vue'
import ProjectDialog from './components/ProjectDialog.vue'
import SettingsDialog from './components/SettingsDialog.vue'
import { BridgeError, beginRun, clearLspDiagnostics, cloneProgress, dapBreakpoints, dapSetBreakpoints, dapStart, dapState, defaultEditorSettings, defaultJavaProjectSettings, defaultProjectSettings, endRun, encodingKeys, encodingLabels, fsChanges, isDesktop, lspDiagnostics, request, runOutput, runState, setLspDiagnostics, setNativeDirty, setNativeTheme, traces, type AppState, type Bookmark, type DiffRow, type DocumentData, type EditorSettings, type EncodingKey, type Entry, type GitAheadBehind, type GitBlame, type GitBlameLine, type HistoryContent, type HistoryEntry, type JavaProjectSettings, type LspCodeAction, type LspCodeActionResults, type LspDocumentSymbol, type LspFileEdits, type LspFormatResult, type LspHierarchyItem, type LspHierarchyResult, type LspHoverResult, type LspLocation, type LspOpenResult, type LspRange, type LspReferencesResult, type LspRenameResult, type LspSignatureHelpResult, type LspSymbolsResult, type LspTextEdit, type ProjectForm, type ProjectSettings, type RecentProject, type RunConfig, type SaveResult, type TemplateSettings, type TodoPattern, type Workspace } from './bridge'
import { clampPanelSize, initialTheme, themeStorageKey, type Theme } from './appearance'
import { rankCommands } from './commandSearch'
import { bookmarkOwner, nextBookmark as nextInList, placeBookmark, removeBookmark, sortedBookmarks } from './bookmarks'
import { createSplitModel, splitTabOutIn, unsplitModel, unsplitAllModel, closeTabInPane, dropTabOnGroup, tabClosingOrder, type Pane, type SplitModel } from './editorGroups'
import { locationSnippet } from './recentLocations'
import { effectiveTemplates, type Template } from './templates'
import { surroundTemplates, type SurroundTemplate } from './surround'

const CodeEditor = defineAsyncComponent(() => import('./components/CodeEditor.vue'))
const reducedMotion = useReducedMotion()
const popupEnter = computed(() => reducedMotion.value ? { opacity: 1 } : { opacity: 0, y: -4, scale: 0.985 })
const popupExit = computed(() => ({ opacity: 0, y: reducedMotion.value ? 0 : -3, transition: { duration: reducedMotion.value ? 0 : 0.1 } }))
const popupTransition = computed(() => ({ duration: reducedMotion.value ? 0 : 0.16, ease: [0.16, 1, 0.3, 1] as const }))
interface Tab extends DocumentData { saving: boolean; dirty: boolean; line: number; column: number; lspRunning?: boolean; pinned?: boolean; preview?: boolean }
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
const primary = computed(() => groups[0])
const secondary = computed(() => groups[1])
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
const leftView = ref<'files' | 'git' | 'vcslog' | 'search' | 'todo' | 'outline' | 'bookmarks' | 'debug' | 'history'>('files')
const activity = ref(false)
const bottom = ref(false)
const bottomTab = ref<'output' | 'run' | 'problems' | 'references' | 'hierarchy' | 'terminal' | 'blame' | 'about'>('output')
const runCommand = ref('cmake --build build')
const runInput = ref<HTMLInputElement>()
const runLog = ref<HTMLElement>()
const treeVersion = ref(0)
const fileTreeRef = ref<InstanceType<typeof FileTree> | null>(null)
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
const symbolPrompt = ref<{ mode: 'file' | 'global' } | null>(null)
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
let gitStatusTimer: number | undefined
async function refreshGitWidget() {
  if (!isDesktop || !workspace.value || !gitAvailable.value) { gitHead.value = ''; return }
  try {
    const status = await request<{ available: boolean; head?: string }>('git.status')
    gitHead.value = status.head ?? ''
    gitAheadBehind.value = await request<GitAheadBehind>('git.aheadBehind')
  } catch { gitHead.value = '' }
}
watch(workspace, value => {
  if (gitStatusTimer !== undefined) { window.clearInterval(gitStatusTimer); gitStatusTimer = undefined }
  if (!value) { gitHead.value = ''; return }
  void refreshGitWidget()
  gitStatusTimer = window.setInterval(() => { if (!document.hidden) void refreshGitWidget() }, 30000)
})
const working = computed(() => loading.value || busy.value || projectBusy.value || allTabs.value.some(tab => tab.saving) || opening.size > 0)
const errors = computed(() => traces.filter(trace => trace.status === 'error').length)
const lspReady = computed(() => active.value ? lspOn(active.value) : false)
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
function moveTabToOtherPane(pane: Pane, tab: Tab) {
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
  if (panel === 'output') return Math.max(120, viewport.height - 300)
  const other = panel === 'explorer' ? (activity.value && viewport.width >= 1000 ? panelSizes.trace : 0) : (explorer.value ? panelSizes.explorer : 0)
  return Math.min(520, viewport.width - other - 340)
}
function setPanelSize(panel: Panel, value: number) { panelSizes[panel] = clampPanelSize(value, panel === 'output' ? 100 : 180, panelMax(panel)) }
function resizeKey(event: KeyboardEvent, panel: Panel) {
  const previous = panel === 'output' ? 'ArrowDown' : panel === 'trace' ? 'ArrowRight' : 'ArrowLeft'
  const next = panel === 'output' ? 'ArrowUp' : panel === 'trace' ? 'ArrowLeft' : 'ArrowRight'
  if (event.key !== previous && event.key !== next) return
  event.preventDefault()
  setPanelSize(panel, panelSizes[panel] + (event.key === next ? 16 : -16))
}
function resizeSplitKey(event: KeyboardEvent) {
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
function toggleMaximizeEditor() {
  // IDEA's "Hide All Tool Windows" / restore: collapse every dock at once.
  const anyOpen = explorer.value || activity.value || bottom.value
  if (anyOpen) { savedChrome = { explorer: explorer.value, activity: activity.value, bottom: bottom.value }; explorer.value = false; activity.value = false; bottom.value = false }
  else { explorer.value = savedChrome.explorer; activity.value = savedChrome.activity; bottom.value = savedChrome.bottom }
}
let savedChrome = { explorer: true, activity: false, bottom: false }
function changeTheme(value: Theme) {
  theme.value = value
  menu.value = null
  try { localStorage.setItem(themeStorageKey, value) }
  catch { notify('主题已切换，但当前环境无法保存主题偏好。', true) }
}
function dismissMenu(event: PointerEvent) {
  if (!(event.target as Element).closest('.menu-anchor')) menu.value = null
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
function notify(message: string, error = false, onClick?: () => void) { notice.value = message; noticeError.value = error; noticeAction.value = onClick ?? null }
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
function switchTab(tab: Tab) {
  activePath.value = tab.path
  rememberRecent(tab.path)
  rememberPlace({ kind: '文件', path: tab.path, line: tab.line - 1, label: tab.path })
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
  const nodes: SyntheticNode[] = [{ path: '\u0000libraries', label: '外部库', icon: 'libraries', entries: [] }]
  for (const glob of projectSettings.value.java.referencedLibraries)
    nodes[0]!.entries.push({ name: glob, path: `\u0000lib:${glob}`, kind: 'directory' })
  try {
    const scratches = await request<Entry[]>('workspace.list', { path: 'scratch' })
    nodes.push({ path: '\u0000scratches', label: '临时文件与控制台', icon: 'scratches', entries: scratches.map(item => ({ ...item, path: `scratch/${item.path}` })) })
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
async function saveSettings(settings: EditorSettings) {
  if (settingsBusy.value) return
  settingsBusy.value = true
  settingsError.value = ''
  try {
    editorSettings.value = await request<EditorSettings>('settings.update', { settings })
    settingsOpen.value = false
    notify(isDesktop ? '编辑器设置已保存并生效。' : '编辑器设置已应用于当前预览会话。')
  } catch (error) { settingsError.value = errorMessage(error) }
  finally { settingsBusy.value = false }
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
    const tab: Tab = { ...doc, saving: false, dirty: false, line: 1, column: 1, lspRunning: false }
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
    if (isDesktop) await startLsp(tab)
  } catch (error) { notify(errorMessage(error), true) }
  finally { opening.delete(path) }
}
async function startLsp(tab: Tab) {
  setLspDiagnostics(tab.path, [])
  try { tab.lspRunning = (await request<LspOpenResult>('lsp.open', { path: tab.path, text: tab.content })).running }
  catch { tab.lspRunning = false }
  if (tab.path === activePath.value) void refreshOutline(tab.path)
}
function lspOn(tab: Tab) { return isDesktop && tab.lspRunning === true && tab.content.length <= 5 * 1024 * 1024 }
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
    symbolResults.value = (result.symbols ?? []).slice(0, 200)
  } catch { symbolResults.value = [] }
}
function openSymbol(mode: 'file' | 'global') {
  menu.value = null
  if (!active.value) return
  symbolPrompt.value = { mode }
  symbolQuery.value = ''
  symbolResults.value = mode === 'file' ? fileSymbolEntries('') : []
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
    bottomTab.value = 'references'
    bottom.value = true
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
  const content = editorFor(tab.path)?.text() ?? tab.content
  try {
    const result = await request<SaveResult>('file.write', { path: tab.path, content, expectedVersion: tab.version, encoding: tab.encoding, bom: tab.bom })
    tab.content = content
    tab.version = result.version
    tab.dirty = false
    editorFor(tab.path)?.markSaved()
    notify(isDesktop ? `已保存 ${tab.path} · ${result.bytes} 字节 · ${encodingLabels[tab.encoding]}` : `示例已保存到内存 · ${result.bytes} 字节（未写入磁盘）`)
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
const nameDialog = ref<{ mode: 'createFile' | 'createDir' | 'rename'; dir: string; entry?: Entry; value: string; template?: string } | null>(null)
const nameInput = ref<HTMLInputElement>()
const deleteTarget = ref<Entry | null>(null)
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
function selectRunConfig(name?: string) {
  const wanted = name ?? runConfigName.value
  const found = runConfigs.value.find(config => config.name === wanted) ?? runConfigs.value[0]
  runConfigName.value = found?.name ?? ''
  if (found) { runCommand.value = found.command; runConfigDebug.value = found.type === 'debug' }
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
function saveConfig() {
  const name = runConfigName.value.trim()
  const command = runCommand.value.trim()
  if (!name || !command) { notify('请填写配置名与命令。', true); return }
  const type = runConfigDebug.value ? 'debug' as const : 'shell' as const
  const configs = runConfigs.value.map(config => config.name === name ? { ...config, command, type } : config)
  if (!configs.some(config => config.name === name)) configs.push({ name, command, type })
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
  bottomTab.value = 'hierarchy'
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
  bottomTab.value = 'hierarchy'
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
  bottomTab.value = 'blame'
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
  void onSemantic({ kind: 'references', path, line: outline.value[0]?.startLine ?? 0, character: outline.value[0]?.startChar ?? 0 })
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
  showOutput('terminal')
  void request('term.create', { cwd: dir }).catch(() => notify('无法打开终端。', true))
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
function showView(view: typeof leftView.value) { explorer.value = true; leftView.value = view; menu.value = null }
// Alt+F8 in the editor opens the debugger tool window and hands the expression over.
// The nonce re-triggers the panel even when the same text is evaluated twice.
const evaluateRequest = ref<{ text: string; nonce: number } | null>(null)
function requestEvaluate(text: string) {
  explorer.value = true
  leftView.value = 'debug'
  evaluateRequest.value = { text, nonce: (evaluateRequest.value?.nonce ?? 0) + 1 }
}function showOutput(tab: typeof bottomTab.value) { bottom.value = true; bottomTab.value = tab; menu.value = null }

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
    { id: 'project.open', title: '打开项目…', keys: 'Ctrl Shift O', keywords: 'open project 打开', enabled: () => !working.value, run: () => void openWorkspace() },
    { id: 'project.clone', title: '克隆仓库…', keywords: 'clone checkout vcs 克隆', enabled: () => !working.value, run: () => beginProject('clone') },
    { id: 'project.recentSection', section: '最近项目' },
    { id: 'project.recentList', recent: true },
    { id: 'project.close', title: '关闭项目，返回欢迎页', keywords: 'close project 关闭', enabled: () => !working.value, run: () => void closeWorkspace() },
    { id: 'file.rule1', rule: true },
    { id: 'file.save', title: '保存文件', keys: 'Ctrl S', keywords: 'save write 保存', enabled: () => Boolean(active.value?.dirty) && !working.value, run: () => void save() },
    { id: 'file.saveAll', title: '全部保存', keys: 'Ctrl Shift S', keywords: 'save all 全部保存', enabled: () => dirty.value && !working.value, run: () => void saveAll() },
    { id: 'file.scratch', title: '新建临时文件', keys: 'Ctrl Alt Shift N', keywords: 'scratch temp buffer 临时文件', enabled: () => Boolean(workspace.value) && !working.value, run: () => void createScratch() },
    { id: 'file.closeTab', title: '关闭当前文件', keywords: 'close tab editor 关闭标签', enabled: () => Boolean(active.value) && !working.value, run: () => { const tab = active.value; if (tab) void closeTab(tab) } },
    { id: 'file.reopenClosedTab', title: '重新打开已关闭的标签页', keys: 'Ctrl Shift F4', keywords: 'reopen closed tab restore editor 恢复关闭标签', enabled: () => closedTabsPerPane[focusedPane.value].length > 0, run: () => void reopenClosedTab() },
    { id: 'file.closeAllTabs', title: '关闭所有文件', keywords: 'close all tabs editors 全部关闭', enabled: () => allTabs.value.length > 0 && !working.value, run: () => { void closeAllTabsIn(focusedPane.value) } },
    { id: 'file.closeOthers', title: '关闭其他文件', keywords: 'close other tabs 关闭其他', enabled: () => Boolean(active.value) && groups[focusedPane.value].tabs.length > 1, run: () => { const tab = active.value; if (tab) void closeOtherTabsIn(focusedPane.value, tab) } },
    { id: 'file.rule2', rule: true },
    { id: 'file.encoding', title: '文件编码…', keywords: 'encoding charset gbk utf16 bom 编码', enabled: hasEditor, run: () => openEncoding() },
    { id: 'file.rule3', rule: true },
    { id: 'app.settings', title: '设置…', keys: 'Ctrl Alt S', keywords: 'settings preferences config keymap 设置', enabled: () => !working.value, run: () => void openSettings() },
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
    { id: 'view.explorer', title: () => `${explorer.value ? '隐藏' : '显示'}文件面板`, keys: 'Ctrl B', keywords: 'project view files tool window 文件面板', run: () => { explorer.value = !explorer.value } },
    { id: 'view.trace', title: () => `${activity.value ? '隐藏' : '显示'}处理记录`, keywords: 'activity trace bridge 处理记录', run: () => { activity.value = !activity.value } },
    { id: 'view.output', title: () => `${bottom.value ? '隐藏' : '显示'}输出面板`, keywords: 'output bottom tool window 输出面板', run: () => { bottom.value = !bottom.value } },
    { id: 'view.zenMode', title: () => `${zenMode.value ? '退出' : '进入'} Zen Mode`, keys: 'Ctrl Shift F12', keywords: 'zen distraction free fullscreen immersive 禅模式 免打扰', run: () => toggleZenMode() },
    { id: 'view.rule0', rule: true },
    { id: 'view.splitH', title: '向右拆分并移动', keys: 'Shift Enter', keywords: 'split right move tab opposite group 分屏 右拆', enabled: () => Boolean(active.value), run: () => splitTabOut(active.value!, 'horizontal') },
    { id: 'view.splitV', title: '向下拆分并移动', keys: 'Ctrl Shift Enter', keywords: 'split down move tab opposite group 分屏 下拆', enabled: () => Boolean(active.value), run: () => splitTabOut(active.value!, 'vertical') },
    { id: 'view.unsplit', title: '取消拆分', keywords: 'unsplit close split 取消拆分', enabled: () => splitOrientation.value !== 'none', run: () => unsplit() },
    { id: 'view.unsplitAll', title: '取消所有拆分', keywords: 'unsplit all 取消所有拆分', enabled: () => splitOrientation.value !== 'none', run: () => unsplitAll() },
    { id: 'view.changeOrientation', title: '更改拆分方向', keywords: 'change orientation rotate split 切换拆分方向', enabled: () => splitOrientation.value !== 'none', run: changeSplitOrientation },
    { id: 'view.maximizeEditor', title: '最大化编辑器 / 显示全部工具窗口', keys: 'Ctrl Shift F1', keywords: 'maximize editor hide all tool windows 隐藏工具窗口', enabled: () => Boolean(workspace.value), run: toggleMaximizeEditor },
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
    { id: 'theme.light', title: '亮色主题', keywords: 'light theme bright 亮色', checked: () => theme.value === 'light', run: () => changeTheme('light') },
    { id: 'theme.dark', title: '暗色主题', keywords: 'dark theme 暗色', checked: () => theme.value === 'dark', run: () => changeTheme('dark') },
  ] },
  { menu: 'navigate', label: '导航', rows: [
    { id: 'navigate.actions', title: '查找操作…', keys: 'Ctrl Shift A', keywords: 'find action commands shortcuts keymap all actions 查找操作 命令', run: openActionSearch },
    { id: 'navigate.file', title: '转到文件…', keys: 'Ctrl Shift N', keywords: 'goto file search everywhere 转到文件', enabled: () => Boolean(workspace.value), run: openPalette },
    // IDEA's default keymap: Go to Class = Ctrl+N, Go to Symbol = Ctrl+Shift+Alt+N.
    { id: 'navigate.class', title: '转到类…', keys: 'Ctrl N', keywords: 'goto class type 转到类', enabled: () => Boolean(workspace.value) && lspReady.value, run: () => openSymbol('global') },
    { id: 'navigate.symbol', title: '转到符号…', keys: 'Ctrl Shift Alt N', keywords: 'goto symbol global 转到符号', enabled: () => Boolean(workspace.value) && lspReady.value, run: () => openSymbol('global') },
    { id: 'navigate.fileSymbol', title: '转到当前文件符号', keys: 'Ctrl F12', keywords: 'symbol outline structure file 文件符号', enabled: () => Boolean(workspace.value) && lspReady.value, run: () => openSymbol('file') },
    { id: 'navigate.line', title: '转到行/列…', keys: 'Ctrl G', keywords: 'goto line number 转到行', enabled: hasEditor, run: () => openGoLine() },
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
    { id: 'navigate.back', title: '上一步', keys: 'Alt ←', keywords: 'back navigate history 后退', enabled: () => Boolean(navBack.value.length), run: () => void goBack() },
    { id: 'navigate.forward', title: '下一步', keys: 'Alt →', keywords: 'forward navigate history 前进', enabled: () => Boolean(navForward.value.length), run: () => void goForward() },
    { id: 'navigate.rule2', rule: true },
    { id: 'navigate.bookmark', title: '切换书签', keys: 'F11', keywords: 'bookmark toggle 书签', enabled: hasEditor, run: () => toggleBookmark() },
    { id: 'navigate.bookmarkMnemonic', title: '为书签编号…', keys: 'Ctrl F11', keywords: 'bookmark mnemonic digit 书签编号', enabled: hasEditor, run: openMnemonicPrompt },
    { id: 'navigate.bookmarkNext', title: '下一个书签', keys: 'Alt F11', keywords: 'next bookmark project wide 下一个书签', run: () => cycleBookmark(false) },
    { id: 'navigate.bookmarkPrevious', title: '上一个书签', keys: 'Alt Shift F11', keywords: 'previous bookmark project wide 上一个书签', run: () => cycleBookmark(true) },
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
    semantic('definition', '跳转到定义', 'F12', 'goto definition 定义'),
    semantic('implementation', '跳转到实现', 'Ctrl Alt B', 'goto implementation 实现'),
    semantic('references', '查找用法', 'Shift F12', 'find usages references 用法'),
    semantic('callHierarchy', '调用层次', 'Ctrl Alt H', 'call hierarchy incoming outgoing 调用层次'),
    semantic('typeHierarchy', '类型层次', 'Ctrl Shift H', 'type hierarchy supertypes subtypes 类型层次'),
    semantic('rename', '重命名', 'F2', 'rename refactor symbol 重命名'),
    semantic('signature', '参数信息', 'Ctrl Shift Space', 'signature parameter help 参数信息'),
    { id: 'code.quickDoc', title: '快速文档', keys: 'Ctrl Q', keywords: 'quick documentation hover 快速文档 文档', enabled: () => Boolean(active.value) && lspReady.value, run: () => void showQuickDoc() },
    { id: 'code.copyRef', title: '复制引用', keys: 'Ctrl Alt Shift C', keywords: 'copy reference qualified name 复制引用 复制路径', enabled: () => Boolean(active.value), run: () => void copyReference() },
    { id: 'code.rule2', rule: true },
    semantic('selection.grow', '扩展到上一级语法单元', 'Ctrl W', 'extend selection syntax 扩展选区'),
    semantic('selection.shrink', '缩小语法选区', 'Ctrl Shift W', 'shrink selection syntax 缩小选区'),
    semantic('format', '重新格式化', 'Ctrl Alt L', 'format code reformat 格式化'),
    { id: 'code.rule3', rule: true },
    { id: 'code.blame', title: 'Git 追溯（Annotate）', keys: 'Ctrl Shift G', keywords: 'blame annotate git history 追溯', enabled: () => Boolean(active.value) && isDesktop, run: () => void showBlame() },
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
    { id: 'build.rebuild', title: '重新构建项目', keywords: 'rebuild project clean 重新构建', enabled: () => isDesktop && Boolean(workspace.value) && !runState.running, run: () => void startBuild(true) },
    { id: 'build.stop', title: '停止构建', keywords: 'stop build cancel 停止构建', enabled: () => runState.running, run: () => void stopRun() },
    { id: 'build.rule1', rule: true },
    { id: 'build.output', title: '构建结果窗口', keywords: 'build tab view tool window 构建输出', enabled: () => Boolean(workspace.value), run: () => showOutput('run') },
  ] },
  { menu: 'run', label: '运行', rows: [
    { id: 'run.start', title: '运行', keys: 'Shift F10', keywords: 'run build execute task 运行', enabled: () => isDesktop && Boolean(workspace.value) && !runState.running, run: () => void runSelectedConfig(false) },
    { id: 'run.debug', title: '调试', keys: 'Shift F9', keywords: 'debug start breakpoint dap 调试', enabled: () => isDesktop && Boolean(workspace.value) && !dapState.running, run: () => void runSelectedConfig(true) },
    { id: 'run.pickConfig', title: '选择运行/调试配置', keys: 'Alt Shift F10', keywords: 'select run configuration choose active edit 选择配置', enabled: () => Boolean(workspace.value), run: () => { bottom.value = true; bottomTab.value = 'run'; menu.value = null } },
    { id: 'run.stop', title: '停止', keys: 'Ctrl F2', keywords: 'stop terminate kill 停止', enabled: () => runState.running, run: () => void stopRun() },
    // RunClass in the default keymap: run whatever is under the caret.
    { id: 'run.context', title: '运行当前上下文配置', keys: 'Ctrl Shift F10', keywords: 'run contextual configuration run class 运行上下文', enabled: () => isDesktop && Boolean(active.value) && !runState.running, run: () => void runContextConfiguration(false) },
    { id: 'run.debugContext', title: '调试当前上下文配置', keys: 'Ctrl Shift F9', keywords: 'debug contextual configuration debug class 调试上下文', enabled: () => isDesktop && Boolean(active.value) && !dapState.running, run: () => void runContextConfiguration(true) },
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
    toolWindow('history', '本地历史', 'local history snapshot 本地历史', true),
    { id: 'code.blame.git', title: '追溯当前文件', keys: 'Ctrl Shift G', keywords: 'blame annotate 追溯', enabled: () => Boolean(active.value) && isDesktop, run: () => void showBlame() },
    { id: 'git.rule3', rule: true },
    { id: 'git.clone', title: '从版本控制系统检出…', keywords: 'checkout from version control clone vcs 检出', enabled: () => !working.value, run: () => beginProject('clone') },
    { id: 'app.settings.git', title: '版本控制与编辑器设置…', keys: 'Ctrl Alt S', keywords: 'vcs git settings 版本控制设置', enabled: () => isDesktop, run: () => void openSettings() },
  ] },
]
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
  toolWindow('structure' as typeof leftView.value, '激活 结构 工具窗口', 'activate structure tool window 结构'),
  toolWindow('todo', '激活 待办事项 工具窗口', 'activate todo tool window 待办'),
  toolWindow('bookmarks', '激活 书签 工具窗口', 'activate bookmarks tool window 书签'),
  toolWindow('debug', '激活 调试 工具窗口', 'activate debug tool window 调试', true),
  toolWindow('history', '激活 本地历史 工具窗口', 'activate local history tool window 历史', true),
  { id: 'window.activateTerminal', title: '激活 终端 工具窗口', keys: 'Alt F12', keywords: 'activate terminal tool window 终端', enabled: () => Boolean(workspace.value), run: () => showOutput('terminal') },
  { id: 'window.activateOutput', title: '激活 输出 工具窗口', keywords: 'activate output tool window 输出', enabled: () => Boolean(workspace.value), run: () => showOutput('output') },
  { id: 'window.activateProblems', title: '激活 问题 工具窗口', keywords: 'activate problems tool window 问题', enabled: () => allProblems.value.length > 0, run: () => showOutput('problems') },
  { id: 'window.hideAllWindows', title: '隐藏所有工具窗口', keys: 'Ctrl Shift F1', keywords: 'hide all tool windows maximize editor 隐藏全部', enabled: () => Boolean(workspace.value), run: toggleMaximizeEditor },
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
  const windowGroup = { menu: 'window' as const, label: '窗口', rows: windowMenuRows }
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
function pickMenuRow(row: MenuRow) { menu.value = null; row.run?.() }
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
    if (dialog.mode === 'rename' && dialog.entry) {
      const target = dialog.dir ? `${dialog.dir}/${name}` : name
      if (target === dialog.entry.path) return
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
  try {
    await request('file.delete', { path: entry.path })
    closeAffectedTabs(entry.path, entry.kind === 'directory')
    await refreshTree()
    notify(`已删除 ${baseName(entry.path)}`)
  } catch (error) { notify(errorMessage(error), true) }
}
function openPalette() { query.value = ''; palette.value = true; menu.value = null }
async function startRun() {  const command = runCommand.value.trim()
  if (!command) { notify('请输入要运行的命令。', true); return }
  if (runState.running) { notify('已有任务在运行，请先停止。', true); return }
  if (!await saveAll()) { notify('请先保存修改再运行。', true); return }
  beginRun()
  bottom.value = true
  bottomTab.value = 'run'
  try { await request('run.start', { command }) }
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
  const tokens = found.command.trim().split(/\s+/)
  const program = tokens[0] ?? ''
  if (!program) { notify('调试配置没有可执行程序。', true); return }
  explorer.value = true
  leftView.value = 'debug'
  try {
    await dapStart({ command: '', args: tokens.slice(1), kind: 'cppvsdbg', program, cwd: '.', stopOnEntry: false })
    notify(`已在调试 ${program}`)
  } catch (error) { notify(`无法启动调试：${errorMessage(error)}`, true) }
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
      try { await dapStart({ command: '', args: [], kind: 'cppvsdbg', program: candidate, cwd: '.', stopOnEntry: false }); notify(`已在调试 ${candidate}`) }
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
  if (rebuild && command.startsWith('cmake')) {
    try { await request('file.delete', { path: 'build' }) } catch { /* nothing to clean */ }
  }
  beginRun()
  bottom.value = true
  bottomTab.value = 'run'
  try { await request('run.start', { command: rebuild ? `${command}${command.startsWith('cmake') ? ' --clean-first' : ''}` : command }) }
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
  if (event.key === 'Escape') {
    palette.value = false; help.value = false; menu.value = null; settingsOpen.value = false
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
    else if (signaturePopup.value) closeSignaturePopup()
    else if (templateChooser.value) templateChooser.value = false
    return
  }
  const digit = /^Digit([0-9])$/.exec(event.code)?.[1]
  if (digit !== undefined && mnemonicPrompt.value) { event.preventDefault(); pickMnemonic(Number(digit)); return }
  if (projectMode.value || settingsOpen.value || leavePrompt.value || renamePrompt.value || symbolPrompt.value || actionPrompt.value || actionSearch.value || surroundPrompt.value || mnemonicPrompt.value || goLinePrompt.value || encodingPrompt.value || conflictPrompt.value || quickDoc.value || recentPrompt.value || placesPrompt.value) return
  // IDEA: F9 toggles a line breakpoint, Shift+F9 starts the Debug action.
  if (event.key === 'F9' && event.ctrlKey && !event.shiftKey) { event.preventDefault(); void startBuild(false); return }
  if (event.key === 'F9' && !event.shiftKey && !event.ctrlKey && active.value && isDesktop) { event.preventDefault(); void toggleBreakpointAt(activePath.value, active.value.line); return }
  if (event.key === 'F9' && event.shiftKey && isDesktop && workspace.value) { event.preventDefault(); void runSelectedConfig(true); return }
  if (event.altKey && event.key === 'ArrowLeft') { event.preventDefault(); void goBack(); return }
  if (event.altKey && event.key === 'ArrowRight') { event.preventDefault(); void goForward(); return }
  if (event.key === 'F11') {
    event.preventDefault()
    if (event.altKey) cycleBookmark(event.shiftKey)
    else if (event.ctrlKey) openMnemonicPrompt()
    else if (event.shiftKey) showView('bookmarks')
    else toggleBookmark()
    return
  }
  if (digit !== undefined && event.ctrlKey && !event.altKey) {
    event.preventDefault()
    if (event.shiftKey) toggleBookmark(Number(digit)); else jumpMnemonic(Number(digit))
    return
  }
  // RecentLocations' own list navigation: the popup keeps a highlighted row, Enter
  // jumps and Delete drops the place from the ring.
  if (placesPrompt.value) {
    if (event.key === 'ArrowDown') { event.preventDefault(); movePlace(1); return }
    if (event.key === 'ArrowUp') { event.preventDefault(); movePlace(-1); return }
    if (event.key === 'Enter') { event.preventDefault(); const place = placesFiltered.value[placesIndex.value]; if (place) openPlace(place); return }
    if (event.key === 'Delete' || event.key === 'Backspace') {
      event.preventDefault()
      const place = placesFiltered.value[placesIndex.value]
      if (!place) return
      places.value = places.value.filter(item => item !== place)
      changePlaces.value = changePlaces.value.filter(item => item !== place)
      return
    }
  }
  // IDEA's own run shortcuts; the menubar advertises exactly these.
  // IDEA's Reopen Closed Tab on the Windows/Linux default keymap.
  if (event.key === 'F4' && event.ctrlKey && event.shiftKey && workspace.value) { event.preventDefault(); void reopenClosedTab(); return }
  if (event.key === 'F2' && event.ctrlKey && runState.running) { event.preventDefault(); void stopRun(); return }
  // IDEA's default keymap: Ctrl+Shift+F9 is "Debug Context Configuration". F2 keeps
  // its Rename binding; the Stop action stays reachable from the Run menu.
  if (event.key === 'F9' && event.ctrlKey && event.shiftKey && workspace.value) { event.preventDefault(); void runContextConfiguration(true); return }
  // Project-wide "Jump to Last Change" (Ctrl+Shift+BackSpace in $default.xml). The
  // editor's own handler stops propagation, so intercept it here.
  if (event.key === 'Backspace' && event.ctrlKey && event.shiftKey && active.value) { event.preventDefault(); jumpLastEditLocation(); return }
  if (event.key === 'F10' && event.ctrlKey && event.shiftKey && workspace.value) { event.preventDefault(); void runContextConfiguration(false); return }
  if (projectMode.value || settingsOpen.value || leavePrompt.value || renamePrompt.value || symbolPrompt.value || actionPrompt.value || actionSearch.value || surroundPrompt.value || mnemonicPrompt.value || goLinePrompt.value || encodingPrompt.value || conflictPrompt.value || quickDoc.value || recentPrompt.value || placesPrompt.value || !(event.ctrlKey || event.metaKey)) return
  if (event.key.toLowerCase() === 's' && event.altKey) { event.preventDefault(); void openSettings(); return }
  // IDEA's Find Action: one keystroke to any command in the registry below.
  if (event.key.toLowerCase() === 'a' && event.shiftKey) { event.preventDefault(); openActionSearch(); return }
  if (event.key.toLowerCase() === 's') { event.preventDefault(); void (event.shiftKey ? saveAll() : save()) }
  // IDEA's default keymap: Ctrl+Shift+N file, Ctrl+N class, Ctrl+Shift+Alt+N symbol.
  // Ctrl+P/Ctrl+T stay as aliases so muscle memory from the old build keeps working.
  if (event.key.toLowerCase() === 'n' && event.shiftKey && event.altKey && workspace.value && lspReady.value) { event.preventDefault(); openSymbol('global'); return }
  if (event.key.toLowerCase() === 'n' && event.shiftKey && workspace.value) { event.preventDefault(); openPalette(); return }
  if (event.key.toLowerCase() === 'n' && workspace.value && lspReady.value) { event.preventDefault(); openSymbol('global'); return }
  if (event.key.toLowerCase() === 'p' && workspace.value) { event.preventDefault(); openPalette() }
  if (event.key.toLowerCase() === 't' && workspace.value && lspReady.value) { event.preventDefault(); openSymbol('global') }
  if (event.key === 'F12' && workspace.value && lspReady.value) { event.preventDefault(); openSymbol('file'); return }
  if (event.key === 'F1' && event.ctrlKey && event.shiftKey && workspace.value) { event.preventDefault(); toggleMaximizeEditor(); return }
  // Search Everywhere: IDEA's default double-Shift. Consecutive Shift presses within
  // 400 ms open Find Action; a lone Shift never triggers anything.
  if (event.key === 'Shift' && !event.repeat) {
    const now = event.timeStamp
    if (now - lastShiftAt < 400) { lastShiftAt = 0; event.preventDefault(); openActionSearch(); return }
    lastShiftAt = now
  }
  if (event.key === 'F12' && event.ctrlKey && event.shiftKey) { event.preventDefault(); toggleZenMode(); return }
  if (event.key.toLowerCase() === 'o' && event.shiftKey) { event.preventDefault(); void openWorkspace() }
  if (event.key.toLowerCase() === 'b' && workspace.value) { event.preventDefault(); explorer.value = !explorer.value }
  // IDEA's actual split defaults: Shift+Enter splits the selected tab right;
  // Ctrl+Shift+Enter splits it down (checked first).
  if (event.key === 'Enter' && event.shiftKey && active.value) {
    event.preventDefault()
    splitTabOut(active.value, event.ctrlKey ? 'vertical' : 'horizontal')
    return
  }
  if (event.key.toLowerCase() === 'g' && event.shiftKey && active.value && isDesktop) { event.preventDefault(); void showBlame(); return }
  if (event.key.toLowerCase() === 'g' && active.value) { event.preventDefault(); openGoLine(); return }
  if (event.key.toLowerCase() === 'f' && event.shiftKey && workspace.value) { event.preventDefault(); showView('search'); return }
  if (event.key.toLowerCase() === 'e' && workspace.value) { event.preventDefault(); if (placesPrompt.value) placesEditedOnly.value = !placesEditedOnly.value; else if (event.shiftKey) openRecentPlaces(); else openRecentFiles(); return }
  if (event.key.toLowerCase() === 'q' && active.value && lspReady.value) { event.preventDefault(); void showQuickDoc(); return }
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
watch(dirty, value => setNativeDirty(value))
watch(activePath, path => { references.value = []; if (bottomTab.value === 'references') bottomTab.value = 'output'; void refreshOutline(path) })
watch(query, () => { paletteIndex.value = 0 })
watch(palette, async value => { if (value) { paletteIndex.value = 0; await nextTick(); queryInput.value?.focus() } })
watch(help, async value => { if (value) { await nextTick(); helpClose.value?.focus() } })
watch(leavePrompt, async value => { if (value) { await nextTick(); leaveCancel.value?.focus() } })
watch(() => runOutput.length, async () => { await nextTick(); if (runLog.value) runLog.value.scrollTop = runLog.value.scrollHeight })
// IDEA raises a balloon when the build/run tool window is not focused: green on exit
// 0, red with "view detail" jumping to the console otherwise.
let lastRunExit: number | null | undefined
watch(() => runState.exit, value => {
  if (value === null || value === undefined || value === lastRunExit) return
  lastRunExit = value
  if (bottom.value && bottomTab.value === 'run') return
  notify(value === 0 ? '构建/运行完成（退出码 0）。' : `构建/运行失败（退出码 ${value}）。`, value !== 0, () => { bottom.value = true; bottomTab.value = 'run'; notice.value = '' })
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
  <div class="ide-shell" :class="{ 'is-resizing': resizing }" :style="{ '--explorer-width': `${panelSizes.explorer}px`, '--trace-width': `${panelSizes.trace}px`, '--output-height': `${panelSizes.output}px` }" @pointerdown.capture="dismissMenu">
    <header v-if="workspace && !zenMode" class="topbar">
      <div class="brand">TaoCode</div>
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
      <button class="command-box" @click="openPalette"><Search :size="13" /><span>{{ workspace?.name ?? '打开工作区，开始构建' }}</span><kbd>Ctrl Shift N</kbd></button>
      <div class="topbar-right"><span class="version-tag">FOUNDATION <span>0.1</span></span><button class="icon-button theme-toggle" :title="theme === 'dark' ? '切换到亮色主题' : '切换到暗色主题'" :aria-label="theme === 'dark' ? '切换到亮色主题' : '切换到暗色主题'" @click="changeTheme(theme === 'dark' ? 'light' : 'dark')"><Sun v-if="theme === 'dark'" :size="17" /><Moon v-else :size="17" /></button><button class="icon-button" title="设置 (Ctrl+Alt+S)" aria-label="打开设置" :disabled="working" @click="openSettings()"><SlidersHorizontal :size="17" /></button><button class="icon-button" title="快捷键与框架说明" aria-label="快捷键与框架说明" @click="help = true"><CircleHelp :size="17" /></button></div>
    </header>

    <div v-if="!isDesktop && !zenMode" class="preview-banner"><span class="preview-dot" />浏览器预览<span class="preview-description">示例文件仅保存在内存。运行 C++ 桌面端以访问本地工作区。</span><span class="banner-right">Vue 3 / WebView2 / C++20</span></div>

    <WelcomePage v-if="!workspace" :projects="recentProjects" :busy="working" :error="appError" :git-available="gitAvailable" :is-desktop="isDesktop" @open="openWorkspace" @create="beginProject('create')" @clone="beginProject('clone')" @settings="openSettings()" @forget="forgetProject" @refresh="refreshRecent" @help="help = true" />

    <div v-else class="workbench" :class="{ 'zen-workbench': zenMode }">
      <aside v-if="explorer && !zenMode" class="activity-bar" aria-label="工具栏">
        <button class="activity-button" :class="{ active: explorer && leftView === 'files' }" title="资源管理器 (Ctrl+B)" aria-label="切换资源管理器" @click="explorer = !explorer; leftView = 'files'"><Files :size="21" /></button>
        <button class="activity-button" :class="{ active: explorer && leftView === 'git' }" title="源代码管理" aria-label="切换源代码管理" @click="explorer = true; leftView = leftView === 'git' ? 'files' : 'git'"><GitBranch :size="21" /></button>
        <button class="activity-button" :class="{ active: explorer && leftView === 'vcslog' }" title="VCS 日志（提交图）" aria-label="切换 VCS 日志" :disabled="!isDesktop || !workspace" @click="explorer = true; leftView = leftView === 'vcslog' ? 'files' : 'vcslog'"><GitGraph :size="21" /></button>
        <button class="activity-button" :class="{ active: explorer && leftView === 'search' }" title="全局搜索 (Find in Files)" aria-label="切换全局搜索" @click="explorer = true; leftView = leftView === 'search' ? 'files' : 'search'"><Search :size="21" /></button>
        <button class="activity-button" :class="{ active: explorer && leftView === 'todo' }" title="任务 (TODO)" aria-label="切换任务面板" @click="explorer = true; leftView = leftView === 'todo' ? 'files' : 'todo'"><ListChecks :size="21" /></button>
        <button class="activity-button" :class="{ active: explorer && leftView === 'outline' }" title="结构大纲 (当前文件符号)" aria-label="切换结构大纲" :disabled="!lspReady" @click="toggleOutline"><FolderTree :size="21" /></button>
        <button class="activity-button" :class="{ active: explorer && leftView === 'bookmarks' }" title="书签 (F11 标记，Ctrl+F11 编号)" aria-label="切换书签窗口" @click="explorer = true; leftView = leftView === 'bookmarks' ? 'files' : 'bookmarks'"><BookmarkIcon :size="21" /></button>
        <button class="activity-button" :class="{ active: explorer && leftView === 'debug' }" title="调试运行" aria-label="切换调试面板" @click="explorer = true; leftView = leftView === 'debug' ? 'files' : 'debug'"><Bug :size="21" /></button>
        <button class="activity-button" :class="{ active: explorer && leftView === 'history' }" title="本地历史" aria-label="切换本地历史" :disabled="!isDesktop || !workspace" @click="explorer = true; leftView = leftView === 'history' ? 'files' : 'history'"><History :size="21" /></button>
        <button class="activity-button" :class="{ active: activity }" title="处理记录" aria-label="切换处理记录" @click="activity = !activity"><Workflow :size="21" /></button>
        <div class="rail-divider" />
        <button class="activity-button" :class="{ active: bottom }" title="输出面板" aria-label="切换输出面板" @click="bottom = !bottom"><TerminalSquare :size="20" /></button>
        <div class="rail-bottom"><button class="activity-button" title="设置 (Ctrl+Alt+S)" aria-label="设置" :disabled="working" @click="openSettings()"><SlidersHorizontal :size="20" /></button><span class="local-avatar" title="仅本地工作区">L</span></div>
      </aside>

      <aside v-if="explorer && !zenMode" class="explorer-panel">
        <template v-if="leftView === 'search'">
          <SearchPanel :root="workspace?.root ?? ''" :active="explorer && leftView === 'search'" @open="onSearchOpen" />
        </template>
        <template v-else-if="leftView === 'todo'">
          <TodoPanel :root="workspace?.root ?? ''" :active="explorer && leftView === 'todo'" :patterns="projectSettings.todoPatterns" :source="todoSource" @open="onSearchOpen" />
        </template>
        <template v-else-if="leftView === 'outline'">
          <OutlinePanel :path="active?.path ?? ''" :symbols="outline" :available="lspReady" @jump="({ line }) => revealLocation({ path: activePath, line })" />
        </template>
        <template v-else-if="leftView === 'bookmarks'">
          <BookmarksPanel :entries="sortedAll" :active-path="activePath" @jump="entry => revealLocation({ path: entry.path, line: entry.line - 1 })" @remove="dropBookmark" @assign="openMnemonicPrompt" />
        </template>
        <template v-else-if="leftView === 'debug'">
          <DebugPanel :active-path="activePath" :ready="isDesktop && Boolean(workspace)" :evaluate-request="evaluateRequest" @jump="jumpDebugLocation" />
        </template>
        <template v-else-if="leftView === 'history'">
          <HistoryPanel :key="`hist:${activePath}:${historyEpoch}`" :path="activePath" :ready="isDesktop && Boolean(workspace)" @revert="revertHistory" />
        </template>
        <template v-else-if="leftView === 'git'">
          <SourceControl :root="workspace?.root ?? ''" :active="explorer && leftView === 'git'" />
        </template>
        <template v-else-if="leftView === 'vcslog'">
          <VcsLog :root="workspace?.root ?? ''" :active="explorer && leftView === 'vcslog'" />
        </template>
        <template v-else>
        <div class="panel-heading"><span>资源管理器</span><div class="heading-actions"><button class="icon-button" title="全部折叠" aria-label="全部折叠" :disabled="!workspace" @click="fileTreeRef?.collapseAll()"><ChevronsDownUp :size="15" /></button><button class="icon-button" title="全部展开" aria-label="全部展开" :disabled="!workspace" @click="fileTreeRef?.expandAll()"><ChevronsUpDown :size="15" /></button><button class="icon-button" title="选中当前文件 (Alt+F1,1)" aria-label="在项目中选中当前文件" :disabled="!active" @click="selectInTree"><Crosshair :size="14" /></button><button class="icon-button" title="打开文件夹" aria-label="打开文件夹" :disabled="working" @click="openWorkspace()"><FolderOpen :size="15" /></button><button class="icon-button" title="刷新目录" aria-label="刷新目录" :disabled="!workspace || busy" @click="refreshTree"><RefreshCw :size="14" /></button></div></div>
        <div v-if="workspace" class="workspace-heading" :title="workspace.root"><ChevronDown :size="13" /><span>{{ workspace.name }}</span><span class="local-tag">{{ isDesktop ? '本地' : '示例' }}</span></div>
        <div class="tree-scroll">
          <FileTree v-if="workspace" ref="fileTreeRef" :key="treeVersion" :entries="workspace.entries" :active="activePath" :synthetic="syntheticNodes" @open="path => void openFile(path, false, { preview: true })" @error="notify($event, true)" @context="onTreeContext" />
          <div v-else class="explorer-empty"><FolderOpen :size="26" /><p>尚未打开工作区</p><button class="subtle-button" @click="openWorkspace()">选择文件夹</button></div>
        </div>
        <div class="explorer-footer"><ShieldCheck :size="14" /><span>文件操作限定在工作区内</span></div>
        <div class="tree-note">排除目录：{{ projectSettings.excludedDirs.join(' / ') || '无' }}<br />不跟随符号链接与目录联接</div>
        </template>
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
                  <button class="icon-button" title="后退 (Alt ←)" aria-label="后退" :disabled="!navBack.length" @click="goBack"><ArrowLeft :size="16" /></button>
                  <button class="icon-button" title="前进 (Alt →)" aria-label="前进" :disabled="!navForward.length" @click="goForward"><ArrowRight :size="16" /></button>
                  <button class="icon-button" title="保存文件 (Ctrl+S)" aria-label="保存文件" :disabled="!active || !active.dirty || active.saving" @click="save()"><Save :size="15" /></button>
                  <button class="icon-button" title="切换处理记录" aria-label="切换右侧处理记录" @click="activity = !activity"><ListTree :size="16" /></button>
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
              <CodeEditor v-for="tab in groups[pane].tabs" v-show="groups[pane].activePath === tab.path" :key="`${workspaceEpoch}:${bufferEpoch}:${pane}:${tab.path}`" :ref="element => setEditorRef(pane, tab.path, element)" :content="tab.content" :path="tab.path" :language="associationOf(tab.path)" :theme="theme" :settings="editorSettings" :templates="projectSettings.templates" :active="groups[pane].activePath === tab.path && focusedPane === pane" :lsp-enabled="lspOn(tab)" :reveal="pane === focusedPane && tab.path === reveal?.path ? reveal : null" :breakpoints="dapBreakpoints.get(tab.path) ?? []" :debug-line="currentDebugLine(tab.path)" :bookmarks="bookmarkLines[tab.path] ?? []" @change="onEditorChange(tab)" @cursor="(line, column) => { tab.line = line; tab.column = column }" @save="save(tab)" @error="notify($event, true)" @reveal="revealLocation" @semantic="onSemantic" @evaluate="requestEvaluate" @surround="openSurround" @breakpoint="line => toggleBreakpointAt(tab.path, line)" />
              <MarkdownPreview v-if="markdownPreviewOn && markdownCapable && focusedPane === pane && groupActive(pane)?.path === activePath" class="md-split" :path="activePath" :content="markdownSource" />
              <div v-if="!groups[pane].tabs.length && pane === 0" class="welcome-screen">
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
          <div class="output-heading"><div class="output-tabs"><button :class="{ selected: bottomTab === 'output' }" @click="bottomTab = 'output'">操作输出 <span class="count-badge">{{ traces.length }}</span></button><button :class="{ selected: bottomTab === 'run' }" @click="bottomTab = 'run'">运行 <span v-if="runState.running" class="count-badge">●</span><span v-else-if="runState.exit !== null" class="count-badge">exit {{ runState.exit }}</span></button><button :class="{ selected: bottomTab === 'problems' }" @click="bottomTab = 'problems'">问题 <span class="count-badge">{{ allProblems.length }}</span></button><button v-if="references.length" :class="{ selected: bottomTab === 'references' }" @click="bottomTab = 'references'">引用 <span class="count-badge">{{ references.length }}</span></button><button v-if="hierRoot" :class="{ selected: bottomTab === 'hierarchy' }" @click="bottomTab = 'hierarchy'">{{ hierTitle }} <span class="count-badge">{{ hierItems.length }}</span></button><button :class="{ selected: bottomTab === 'terminal' }" @click="bottomTab = 'terminal'"><SquareTerminal :size="11" /> 终端</button><button v-if="blameLines.length || bottomTab === 'blame'" :class="{ selected: bottomTab === 'blame' }" @click="bottomTab = 'blame'"><GitCommitHorizontal :size="11" /> 追溯 <span class="count-badge">{{ blameLines.length }}</span></button><button :class="{ selected: bottomTab === 'about' }" @click="bottomTab = 'about'">工作区说明</button></div><div class="heading-actions"><span class="small-muted">{{ isDesktop ? 'C++ BRIDGE' : 'PREVIEW ADAPTER' }}</span><button class="icon-button" title="收起输出" aria-label="收起输出" @click="bottom = false"><X :size="14" /></button></div></div>
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
              <button class="subtle-button" title="把当前命令保存/更新为命名配置" @click="saveConfig">存为配置</button>
              <button class="icon-button" title="删除当前配置" :disabled="runConfigs.length <= 1" @click="removeConfig"><Trash2 :size="14" /></button>
            </div>
            <div class="run-toolbar">
              <input v-model="runCommand" :disabled="runState.running" class="run-command" aria-label="运行命令" placeholder="在项目根目录执行的命令，如 cmake --build build" @keydown.enter.prevent="startRun" />
              <button v-if="!runState.running" class="primary-button" :disabled="!isDesktop || !workspace" @click="startRun">运行</button>
              <button v-else class="subtle-button" @click="stopRun">停止</button>
            </div>
            <pre ref="runLog" class="run-log" aria-label="运行输出">{{ runOutput.join('') || (isDesktop ? '点击“运行”在项目根目录执行命令；输出与退出码会实时显示。' : '浏览器预览不能运行命令，请在桌面端使用。') }}</pre>
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
          <div v-show="bottomTab === 'terminal'" class="terminal-host-wrap"><TerminalPanel :active="bottomTab === 'terminal' && bottom" /></div>
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
    <footer v-if="workspace && !zenMode" class="statusbar"><div class="status-left"><span class="status-brand"><Braces :size="13" /></span><button v-if="gitHead" class="status-branch" :title="`当前分支 ${gitHead}（点击打开源代码管理）`" @click="showView('git')"><GitBranch :size="12" />{{ gitHead }}<span v-if="gitAheadBehind.available && gitAheadBehind.ahead" class="status-count">↑{{ gitAheadBehind.ahead }}</span><span v-if="gitAheadBehind.available && gitAheadBehind.behind" class="status-count">↓{{ gitAheadBehind.behind }}</span></button><span><span class="status-dot" />{{ isDesktop ? '原生桥接已连接' : '浏览器示例模式' }}</span><span class="status-separator">|</span><span>{{ working ? '正在处理…' : '就绪' }}</span><span v-if="dirty" class="status-unsaved">有未保存修改</span></div><div class="status-right"><button v-if="allProblems.length" class="status-problems" title="打开问题面板" aria-label="打开问题面板" @click="bottom = true; bottomTab = 'problems'"><span class="sev-error">{{ allProblems.filter(p => p.severity === 1).length }} 错误</span><span class="status-separator">|</span><span class="sev-warning">{{ allProblems.filter(p => p.severity === 2).length }} 警告</span></button><span v-if="active">行 {{ active.line }}，列 {{ active.column }}</span><button v-if="active?.readOnly" class="status-chip status-locked" title="文件只读（点击切换为可写）" @click="void toggleReadOnly(active!.path)"><Lock :size="12" />只读</button><span v-if="active">{{ active.content.includes('\r\n') ? 'CRLF' : 'LF' }}</span><button v-if="active && isDesktop" class="status-chip" title="转换行分隔符（点击在 Windows 与 Unix 之间切换）" aria-label="转换行分隔符" @click="convertLineSeparators(active.content.includes('\r\n') ? 'lf' : 'crlf')">转换行尾</button><button class="status-chip" title="文件编码（点击可重新读取或转换保存）" aria-label="文件编码" :disabled="!active" @click="openEncoding">{{ encodingLabels[active?.encoding ?? 'utf-8'] }}{{ active?.bom ? ' 带 BOM' : '' }}</button><span>{{ active ? language : 'TaoCode 0.1' }}</span><button title="切换输出面板" aria-label="切换底部面板" @click="bottom = !bottom"><PanelBottom :size="13" /></button></div></footer>

    <ProjectDialog v-if="projectMode" v-model:form="projectForm" :mode="projectMode" :busy="projectBusy || busy" :cancelling="cancelling" :error="projectError" :progress="cloneProgress" :git-available="gitAvailable" :is-desktop="isDesktop" @browse="browseParent" @submit="submitProject" @cancel="cancelProject" />
    <SettingsDialog v-if="settingsOpen" :settings="editorSettings" :project-settings="workspace ? projectSettings : null" :project-root="workspace?.root ?? null" :active-path="activePath" :theme="theme" :busy="settingsBusy" :error="settingsError" :initial-section="settingsSectionHint" @save="saveSettings" @save-project="saveProjectSettings" @save-templates="saveTemplateSettings" @save-java="saveJavaSettings" @browse-directory="browseStructureDir" @theme="changeTheme" @close="settingsOpen = false" />
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
          <button @click="const tab = findTab(menu.path); if (tab) { focusPane(menu.pane); moveTabToOtherPane(menu.pane, tab) }; tabMenu = null">移动标签页到右侧</button>
          <button @click="const tab = findTab(menu.path); if (tab) { focusPane(menu.pane); moveTabToOtherPane(menu.pane, tab) }; tabMenu = null">移动标签页到下方</button>
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
      <section class="help-dialog rename-dialog" role="dialog" aria-modal="true" :aria-label="nameDialog.mode === 'rename' ? '重命名' : '新建'" @keydown="trapFocus">
        <h2>{{ nameDialog.mode === 'rename' ? '重命名' : nameDialog.mode === 'createDir' ? '新建文件夹' : '新建文件' }}</h2>
        <p class="rename-target"><code>{{ nameDialog.dir || (workspace?.name ?? '.') }}</code> /</p>
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
        <p>{{ deleteTarget.kind === 'directory' ? '目录及其所有子项都会从磁盘移除，无法在 TaoCode 内撤销。' : '该文件将从磁盘删除；如需找回可用「本地历史」回滚旧版本。' }}</p>
        <div class="leave-actions"><button ref="leaveCancel" class="subtle-button" @click="deleteTarget = null">取消</button><button class="primary-button menu-danger-solid" @click="confirmDelete">删除</button></div>
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
    <div v-if="help" class="modal-backdrop" @click.self="help = false"><section class="help-dialog" role="dialog" aria-modal="true" aria-label="关于 TaoCode" @keydown="trapFocus"><button ref="helpClose" class="icon-button help-close" aria-label="关闭说明" @click="help = false"><X :size="18" /></button><h2>TaoCode <span>0.1 · Foundation</span></h2><p>Vue 3 界面 + CodeMirror 编辑器 + C++20 文件核心。<br />Windows 原生宿主复用系统 WebView2，不捆绑 Electron。</p><div class="help-grid"><span>打开文件夹</span><kbd>Ctrl Shift O</kbd><span>保存当前文件</span><kbd>Ctrl S</kbd><span>转到文件</span><kbd>Ctrl Shift N</kbd><span>转到类</span><kbd>Ctrl N</kbd><span>查找操作</span><kbd>Ctrl Shift A</kbd><span>转到行</span><kbd>Ctrl G</kbd><span>当前文件内查找</span><kbd>Ctrl F</kbd><span>转到定义</span><kbd>F12</kbd><span>重命名符号</span><kbd>F2</kbd><span>查找引用</span><kbd>Shift F12</kbd><span>智能补全</span><kbd>Ctrl Space</kbd><span>代码操作</span><kbd>Alt Enter</kbd><span>用模板包裹</span><kbd>Ctrl Alt T</kbd><span>格式化（可带选区）</span><kbd>Ctrl Alt L</kbd><span>智能选区</span><kbd>Ctrl W</kbd><span>书签</span><kbd>F11</kbd><span>书签编号 / 跳转</span><kbd>Ctrl F11 · Ctrl 0-9</kbd><span>断点</span><kbd>F9</kbd><span>运行 / 调试配置</span><kbd>Shift F10 · Shift F9</kbd><span>运行 / 调试上下文</span><kbd>Ctrl Shift F10 · Ctrl Shift F9</kbd><span>重新打开已关闭标签页</span><kbd>Ctrl Shift F4</kbd><span>拆分并移动 / 向下拆分</span><kbd>Shift Enter · Ctrl Shift Enter</kbd><span>最大化编辑器</span><kbd>Ctrl Shift F1</kbd><span>Git 追溯</span><kbd>Ctrl Shift G</kbd><span>切换资源管理器</span><kbd>Ctrl B</kbd></div><div class="help-note">当前已接通项目创建、打开、克隆、设置，桌面端语言服务（诊断、悬停、转到定义/实现/类型、补全、重命名、查找引用、符号大纲、代码操作含 resolve 解析、格式化与选区格式化、签名信息、文档内同符号高亮、智能选区、内联提示）、操作查找（Ctrl+Shift+A）、书签与 0-9 编号跳转、模板包裹（Ctrl+Alt+T）、随项目保存的运行配置、全局查找/替换、本地历史快照与回滚、Git 状态/暂存/提交/改写上次提交/分支/日志/储藏/拉取/推送/与分支比较与文件追溯、集成终端（ConPTY + xterm）与调试器（DAP 客户端，需在 exe 旁 TaoCode.dap.json 配置本机调试适配器）；浏览器预览无语言服务、终端与调试器。尚无 AI Agent / 模型执行。处理记录仅保留当前会话，不是持久审计日志。</div></section></div>
  </div>
</template>
