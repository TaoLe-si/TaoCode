// 文件树与标签的**上下文操作**（IDEA 的 ProjectView 右键菜单 + EditorTab 右键菜单）——
// 从 App.vue 搬出的一域（196 行，15 个依赖）。
//
// 判据：这一族都是"在树/标签上点右键之后做什么" —— 新建/重命名/删除/复制粘贴、在资源管理器里显示、
// 复制路径、固定标签、关闭其它/左侧/右侧标签、以及"转到行/最近文件"两个弹窗。它们共享同一套
// 菜单坐标状态（`treeMenu` / `tabMenu` / `goLinePrompt` / `recentPrompt`）。
import { computed, nextTick, ref, type Ref } from 'vue'
import { request, type Entry, type ProjectSettings, type Workspace } from './bridge.ts'
import { copyToClipboard } from './clipboard.ts'
import { errorMessage } from './errors.ts'
import { getCommandProcessor } from './pvCommandProcessor.ts'
import { createFileUndoProvider, hostFileIo, recordFileCommand, reportText } from './pvFileUndoProvider.ts'
import { createTabEntryPoint } from './tabEntryPointMenu.ts'
import { addEvent, parseRecentFiles, recentFilesRows, RECENT_FILES_STORAGE_KEY, serializeRecentFiles,
         type RecentFilesState } from './recentFilesModel.ts'
import type { Tab } from './editorTab'

export interface ExplorerActionsDeps {
  notify: (message: string, error?: boolean) => void
  /** 桌面端才有剪贴板与原生对话框。 */
  isDesktop: boolean
  menu: Ref<string | null>
  generalSettings: Ref<Record<string, unknown>>
  workspace: Ref<Workspace | null>
  groups: any
  /** 标签条「更多」下拉要读的几个状态与动作（IDEA `EditorTabsEntryPoint` 的成员）。 */
  closedTabsPerPane: any
  reopenClosedTab: () => unknown
  unsplit: () => unknown
  unsplitAll: () => unknown
  splitOrientation: () => string
  changeSplitOrientation: () => unknown
  openSettings: (section?: string) => unknown
  active: { readonly value: Tab | undefined }
  /** 当前被"揭示"的路径（最近文件/转到行要用）。 */
  reveal: Ref<{ path: string; line: number } | null>
  query: Ref<string>
  /** 转到行对话框（宿主声明，lspNavigation 也要用同一份）。 */
  /** 重命名/新建对话框的状态（宿主更早的阶段就要读写它，所以留在宿主）。 */
  nameDialog: Ref<any>
  nameInput: Ref<HTMLInputElement | undefined>
  baseName: (path: string) => string
  parentOf: (path: string) => string
  refreshTree: () => unknown
  revealLocation: (target: { path: string; line: number; column?: number }) => unknown
  openFile: (path: string, internal?: boolean) => unknown
  closeTabIn: (pane: any, tab: Tab) => unknown
  renameEntryWithReferences: (from: any, to?: any) => unknown
}

export function createExplorerActions(deps: ExplorerActionsDeps) {
  const isDesktop = deps.isDesktop
  const goLinePrompt = ref(false)
  const goLineValue = ref('')
  const goLineInput = ref<HTMLInputElement>()
  const recentPrompt = ref(false)
  const recentQuery = ref('')
  const recentInput = ref<HTMLInputElement>()
  const { menu, generalSettings, workspace, groups, active, reveal, query, baseName, parentOf, closeTabIn,
          closedTabsPerPane, reopenClosedTab, unsplit, unsplitAll, splitOrientation, changeSplitOrientation, openSettings,
          nameDialog, nameInput, renameEntryWithReferences, refreshTree, revealLocation, openFile } = deps
  const treeMenu = ref<{ entry: Entry; x: number; y: number } | null>(null)
  /**
   * 项目级命令栈（`UndoManagerImpl` 的等价物）与文件级可撤步骤（`FileUndoProvider` 的等价物）。
   * 按工作区根取，换项目看到的是另一条历史；`workspaceKey` 就是 `getProjectTreeState` 用的那个身份。
   */
  const fileUndo = createFileUndoProvider(hostFileIo)
  const commands = () => getCommandProcessor(workspace.value?.root ?? '')
  // IDEA's project-view popup nests groups (WeighingNewGroup, AssociateWithFileType,
  // VersionControlsGroup); the submenu id tracks which one is unfolded.
  // 'markroot' = 上游 `MarkRootGroup`（platform/lang-impl/resources/intellij.platform.lang.impl.actions.xml:252，
  // 组标题按选区决定：platform/lang-impl/src/com/intellij/ide/projectView/actions/MarkRootGroup.java:14-22）；
  // 项与写回在 `src/pvMarkRoots.ts` +
  // `src/treeActions.ts` 的 `markRootMenu`/`applyMarkRoot`，宿主那一行在保留的 `src/App.vue`
  // （接线请求 docs/wiring-requests-2026-10-06-bucket14a.md W1）⇒ 这里先把字面量备齐，
  // 否则宿主粘不上去（vue-tsc 会报 TS2322）。
  const treeSubmenu = ref<'new' | 'filetype' | 'analyze' | 'markroot' | null>(null)
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
      if (clip.mode === 'copy') {
        await request('file.copy', { from: clip.entry.path, to: destination })
        // 粘贴副本登记成一条可撤命令（上游 `FileUndoProvider.after` 对 `VFileCopyEvent` 的那一步，
        // `FileUndoProvider.java:107-108` + `:116-124`）。
        recordFileCommand(commands(), { name: '粘贴副本', groupId: 'paste', steps: [fileUndo.copyStep(clip.entry.path, destination)] })
      } else {
        await renameEntryWithReferences(clip.entry.path, destination)
        // 剪切粘贴 = 移动：撤销是反着 rename 回去。引用改写不在这一层的覆盖范围里，
        // 已登记接线请求（`docs/wiring-requests-2026-10-06-bucket14a.md` W3）。
        // 订正（2026-10-06）：这里原先指向 `…bucket14.md` —— 那个文件没被写出来（上一轮代理被切断，
        // 报告与接线请求都没落地），W3 这一条现在记在 14a 那份里。
        recordFileCommand(commands(), { name: '移动', groupId: 'paste', steps: [fileUndo.moveStep(clip.entry.path, destination)] })
      }
      await refreshTree()
      deps.notify(clip.mode === 'copy' ? `已粘贴为 ${destination}` : `已移动到 ${destination}`)
      if (clip.mode === 'cut') fileClipboard.value = null
    } catch (error) { deps.notify(errorMessage(error), true) }
  }
  function cutTreeEntry() {
    const entry = treeMenu.value?.entry
    treeMenu.value = null
    if (!entry || !entry.path || entry.path.startsWith('\u0000')) return
    fileClipboard.value = { mode: 'cut', entry }
    deps.notify(`已剪切 ${entry.path}（在目标目录上右键粘贴）`)
  }
  function copyTreeEntry() {
    const entry = treeMenu.value?.entry
    treeMenu.value = null
    if (!entry || !entry.path || entry.path.startsWith('\u0000')) return
    fileClipboard.value = { mode: 'copy', entry }
    deps.notify(`已复制 ${entry.path}（在目标目录上右键粘贴）`)
  }
  async function revealInExplorer() {
    const entry = treeMenu.value?.entry
    treeMenu.value = null
    if (!entry || !isDesktop) return
    try { await request('file.reveal', { path: entry.path }) }
    catch (error) { deps.notify(errorMessage(error), true) }
  }
  /**
   * 撤销/重做一次**文件级**操作（`$Undo` / `$Redo`，`PlatformActions.xml:447-448`，
   * 键位 `Ctrl+Z` / `Ctrl+Shift+Z`，`$default.xml:232-235` / `:685-688`）。
   * 上游成功时不弹提示，只有被拒绝时弹 `CannotUndoReportDialog` —— 本仓照这两条：
   * 拒绝走 `notify(..., true)`，成功只刷新目录树（编辑器里的标签由宿主的 `fsChanges` 公告自己跟上）。
   */
  async function undoOrRedoFileOperation(kind: 'undo' | 'redo', scope: readonly string[]) {
    const processor = commands()
    const result = kind === 'undo' ? await processor.undo(scope) : await processor.redo(scope)
    if (!result.ok && result.report) deps.notify(reportText(result.report), true)
    else if (result.ok) await refreshTree()
    return result
  }
  const undoFileOperation = (scope: readonly string[] = []) => undoOrRedoFileOperation('undo', scope)
  const redoFileOperation = (scope: readonly string[] = []) => undoOrRedoFileOperation('redo', scope)
  // IDEA's EditorTabPopup (ActionsBundle "Close All but Pinned", tab pinning): right-
  // click on a tab opens the group-scoped actions for that tab.
  const tabMenu = ref<{ pane: any; path: string; x: number; y: number } | null>(null)
  function onTabContext(pane: any, tab: Tab, event: MouseEvent) {
    event.preventDefault()
    menu.value = null
    treeMenu.value = null
    tabMenu.value = { pane, path: tab.path, x: event.clientX, y: event.clientY }
  }
  function togglePinTab(pane: any, tab: Tab) {
    tab.pinned = !tab.pinned
    tabMenu.value = null
  }
  async function closeOtherTabsIn(pane: any, keep: Tab) {
    tabMenu.value = null
    for (const tab of [...groups[pane].tabs]) if (tab !== keep) await closeTabIn(pane, tab)
  }
  async function closeAllTabsIn(pane: any) {
    tabMenu.value = null
    for (const tab of [...groups[pane].tabs]) await closeTabIn(pane, tab)
  }
  async function closeUnpinnedTabsIn(pane: any) {
    tabMenu.value = null
    // IDEA keeps pinned tabs out of every bulk close, including this one.
    for (const tab of [...groups[pane].tabs]) if (!tab.pinned) await closeTabIn(pane, tab)
  }
  async function closeTabsToRightIn(pane: any, from: Tab) {
    tabMenu.value = null
    const group = groups[pane]
    const index = group.tabs.indexOf(from)
    if (index < 0) return
    for (const tab of [...group.tabs.slice(index + 1)]) await closeTabIn(pane, tab)
  }
  // CloseAllToTheLeft in the same group.
  async function closeTabsToLeftIn(pane: any, from: Tab) {
    tabMenu.value = null
    const group = groups[pane]
    const index = group.tabs.indexOf(from)
    if (index <= 0) return
    for (const tab of [...group.tabs.slice(0, index)]) await closeTabIn(pane, tab)
  }
  function hasTabsToRight(pane: any, path: string) {
    const group = groups[pane]
    const index = group.tabs.findIndex((tab: Tab) => tab.path === path)
    return index >= 0 && index < group.tabs.length - 1
  }
  function hasTabsToLeft(pane: any, path: string) {
    return groups[pane].tabs.findIndex((tab: Tab) => tab.path === path) > 0
  }
  function copyPathOfTab(tab: Tab) {
    tabMenu.value = null
    const fullPath = workspace.value ? `${workspace.value.root}/${tab.path}` : tab.path
    void copyToClipboard(fullPath)
    deps.notify(`已复制路径：${fullPath}`)
  }
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
  // 最近文件（Ctrl+E 面板的数据源）。上游形状是 `RecentFilesMutableState` 的三张表 +
  // `FileSwitcherApi.SWITCHER_ELEMENTS_LIMIT = 30`，本仓把可移植的那部分放进
  // `src/recentFilesModel.ts`，这里只做装配与落盘：
  //   · **应用级、跨项目**：整表 JSON 存在 `taocode.recentFiles`，关掉应用再打开还在
  //     （此前只有进程内一份，最大数写死 40）；
  //   · 打开文件时走 `addEvent`：新路径置顶、旧表里的重复项先删，超过 30 从尾部丢。
  function readRecentFilesState(): RecentFilesState {
    try { return parseRecentFiles(window.localStorage.getItem(RECENT_FILES_STORAGE_KEY)) }
    catch { return parseRecentFiles(null) }
  }
  const recentFilesState = ref<RecentFilesState>(readRecentFilesState())
  const recentFiles = ref<string[]>(recentFilesRows(recentFilesState.value))
  function rememberRecent(path: string) {
    if (!path) return
    const next: RecentFilesState = { ...recentFilesState.value, recentlyOpened: addEvent(recentFilesState.value.recentlyOpened, [path]) }
    recentFilesState.value = next
    recentFiles.value = recentFilesRows(next)
    try { window.localStorage.setItem(RECENT_FILES_STORAGE_KEY, serializeRecentFiles(next)) }
    catch { /* storage unavailable: session-only */ }
  }
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

  /**
   * 标签条右端那个"更多"下拉（IDEA `EditorTabsEntryPoint`，`PlatformActions.xml:804-816`）。
   * 成员表与上游顺序都在 `src/tabEntryPointMenu.ts`；这一域已经有它要的全部动作
   * （关闭类在当前文件里、拆分与设置由宿主注入），所以装配放这里，App.vue 只留一行组件。
   */
  const tabEntryPointItems = createTabEntryPoint({
    groups, closedTabsPerPane, split: splitOrientation, reopenClosedTab, closeAllTabsIn, closeUnpinnedTabsIn,
    unsplit, unsplitAll, changeSplitOrientation, openSettings: s => openSettings(s as never),
  })
  return {
    tabEntryPointItems,
    nameDialogTitle, isLayoutDialog,
    treeMenu, treeSubmenu, fileClipboard, copyCollisionName, pasteFromClipboard, cutTreeEntry, copyTreeEntry, revealInExplorer,
    undoFileOperation, redoFileOperation,
    tabMenu, onTabContext, togglePinTab, closeOtherTabsIn, closeAllTabsIn, closeUnpinnedTabsIn, closeTabsToRightIn,
    closeTabsToLeftIn, hasTabsToRight, hasTabsToLeft, copyPathOfTab,
    goLinePrompt, goLineValue, goLineInput, goToLine,
    recentPrompt, recentQuery, recentInput, recentFiles, rememberRecent, recentFiltered, openRecent,
}
}
