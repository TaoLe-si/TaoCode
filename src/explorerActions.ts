// 文件树与标签的**上下文操作**（IDEA 的 ProjectView 右键菜单 + EditorTab 右键菜单）——
// 从 App.vue 搬出的一域（196 行，15 个依赖）。
//
// 判据：这一族都是"在树/标签上点右键之后做什么" —— 新建/重命名/删除/复制粘贴、在资源管理器里显示、
// 复制路径、固定标签、关闭其它/左侧/右侧标签、以及"转到行/最近文件"两个弹窗。它们共享同一套
// 菜单坐标状态（`treeMenu` / `tabMenu` / `goLinePrompt` / `recentPrompt`）。
import { computed, nextTick, ref, type Ref } from 'vue'
import { request, type Entry, type ProjectSettings, type Workspace } from './bridge'
import { copyToClipboard } from './clipboard'
import { errorMessage } from './errors'
import { createTabEntryPoint } from './tabEntryPointMenu'
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
  // IDEA's project-view popup nests groups (WeighingNewGroup, AssociateWithFileType,
  // VersionControlsGroup); the submenu id tracks which one is unfolded.
  const treeSubmenu = ref<'new' | 'filetype' | 'analyze' | null>(null)
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
      else await renameEntryWithReferences(clip.entry.path, destination)
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
    tabMenu, onTabContext, togglePinTab, closeOtherTabsIn, closeAllTabsIn, closeUnpinnedTabsIn, closeTabsToRightIn,
    closeTabsToLeftIn, hasTabsToRight, hasTabsToLeft, copyPathOfTab,
    goLinePrompt, goLineValue, goLineInput, goToLine,
    recentPrompt, recentQuery, recentInput, recentFiles, rememberRecent, recentFiltered, openRecent,
}
}
