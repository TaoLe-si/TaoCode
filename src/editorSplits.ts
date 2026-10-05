// 编辑区的分栏与标签页开关 —— 从 App.vue 搬出的一域（116 行，18 个依赖）。
//
// 判据：IDEA 里"多开一个编辑区"和"标签页什么时候消失"是同一条链路上的事，TaoCode 也一样：
//   · 分栏：`splitTabOut` / `toggleSplit` / `unsplit` / `unsplitAll` / `splitFromTabMenu` /
//     `openInOppositeGroup` / `setSplitOrientation` / `moveTabToOtherPane`
//     （SplitterAction + OpenEditorInOppositeTabGroup），纯模型变换在 src/editorGroups.ts；
//   · 标签页生命周期：`switchTabIn`（预览标签页的晋升）、`enforceTabLimit`
//     （IDEA `EditorHistoryManager.fileList` + `tabClosingOrder` 的关闭顺序，tabLimit 设置）、
//     `closeTabIn`（`EditorWindow.removedTabs`：记住位置好还原）、`reopenClosedTab`
//     （ReopenClosedTabAction，Ctrl+Shift+F4）。
// 两者共享 `splitModel` / `groups` / `closedTabsPerPane` —— 关一个标签会改分栏状态，
// 分栏又会改标签归属，拆开就是两份互相写对方状态的代码。
// 崩溃恢复（src/sessionSnapshot.ts）的装配夹在中间，但它属于另一个域，留在宿主。
import { computed, reactive, ref, type Ref } from 'vue'
import { closeTabInPane, splitTabOutIn, tabClosingOrder, unsplitAllModel, unsplitModel, type Pane, type SplitModel } from './editorGroups.ts'
import { editorTabDoubleClickAction } from './editorTabDoubleClick.ts'
import type { EditorSettings } from './bridge'
import type { Tab } from './editorTab'

/** IDEA `EditorWindow.removedTabs` 的一项：关掉的标签 + 它原来的位置。 */
export interface ClosedTab { path: string; line: number; index: number }

export interface EditorSplitsDeps {
  notify: (message: string, error?: boolean) => void
  splitModel: SplitModel<any>
  groups: any
  active: { readonly value: Tab | undefined }
  activePath: any
  findTab: (path: string) => Tab | undefined
  editorFor: (path: string) => any
  /** 重新打开关闭的标签（编辑器骨架提供）。 */
  openFile: (path: string) => unknown
  reveal: any
  focusedPane: { readonly value: Pane }
  /** 分栏方向（宿主是 `computed`）。 */
  splitOrientation: { readonly value: string }
  /** 标签右键菜单坐标（文件树模块自持）。 */
  tabMenu: any
  editorSettings: Ref<EditorSettings>
  working: { readonly value: boolean }
  hasTabPath: (path: string) => boolean
  /** 最近文件列表（文件树模块提供）。 */
  rememberRecent: (path: string) => void
  /** 最近位置环（宿主自持）。 */
  rememberPlace: (place: any) => void
  /** 双击编辑器标签那两条行为里"隐藏全部工具窗口"的落地（宿主已有这个动作）。 */
  toggleMaximizeEditor: () => void
  /**
   * 切到某个标签之后的钩子 —— 上游 `EditorWindow.kt:210-219` 的 `selectionChanged`：
   * 切标签时对新选中的文件做一次重同步（是否真的读盘由 `autoSyncFiles` 决定，见 `src/diskSync.ts`）。
   * 惰性传入：磁盘同步模块装配在本域之后。
   */
  onTabActivated?: (path: string) => void
  /** 语言服务文档的生命周期（LSP 模块提供）—— 惰性。 */
  stopLspFile: (path: string) => void
  /** 未保存确认（工作区生命周期模块提供）—— 惰性。 */
  confirmLeave: (title: string, scope?: Tab[]) => Promise<boolean>
  bufferEpoch: any
}

export function createEditorSplits(deps: EditorSplitsDeps) {
  const { notify, splitModel, groups, active, activePath, findTab, editorFor, openFile, reveal, focusedPane, tabMenu,
          editorSettings, working, hasTabPath, rememberRecent, rememberPlace, stopLspFile, confirmLeave,
          bufferEpoch, splitOrientation } = deps
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
  const tab = groups[pane].tabs.find((item: any) => item.path === path)
  if (tab) splitTabOut(tab, orientation)
}
// OpenEditorInOppositeTabGroup: show the same file in both groups ("split same").
function openInOppositeGroup(path: string) {
  const other = otherPane(splitModel.focused)
  if (groups[other].tabs.some((tab: any) => tab.path === path)) return
  const tab = groups[splitModel.focused].tabs.find((item: any) => item.path === path) ?? findTab(path)
  if (tab) splitTabOutIn(splitModel, (item: Tab) => item.path, tab, splitModel.orientation === 'none' ? 'horizontal' : splitModel.orientation)
}
// KeepTabOpen: a preview tab stops being replaceable by the next preview. The row
// only makes sense while the tab is one, so it disables otherwise.
function keepTabOpen(tab: Tab) { tab.preview = false }
/**
 * 双击编辑器标签（`EditorTabbedContainer.kt:348-361` 的 `doProcessDoubleClick`）：
 *   ① 预览标签先晋升为常驻（`:349-356`，那一步之后上游就 `return` 了）；
 *   ② 否则按 `editor.maximize.on.double.click`（默认 true）执行「隐藏全部工具窗口 / 恢复窗口」。
 * 判定在 src/editorTabDoubleClick.ts（纯函数），这里只执行。
 */
function onEditorTabDoubleClick(tab: Tab) {
  const action = editorTabDoubleClickAction(tab.preview === true, {
    hideToolWindowsOnDoubleClick: deps.editorSettings.value.maximizeEditorOnTabDoubleClick,
    // 本仓没有"编辑器内分屏最大化"这一档（那是 IDEA 的 MaximizeEditorInSplit），恒 false：
    // 不给一个点了没反应的开关。
    maximizeInSplitsOnDoubleClick: false,
  })
  if (action === 'promote-preview') keepTabOpen(tab)
  else if (action === 'hide-tool-windows') deps.toggleMaximizeEditor()
}
// IDEA's preview tab: opening from the tree replaces the previous preview; editing,
// pinning or second-opening promotes it to a normal tab.
function switchTabIn(pane: Pane, tab: Tab) {
  const previous = groups[pane].activePath
  splitModel.focused = pane
  groups[pane].activePath = tab.path
  if (tab.preview) tab.preview = false
  rememberRecent(tab.path)
  touchHistory(tab.path)
  // The caret only moves through the editor's own cursor event; re-selecting the tab
  // that already had focus would otherwise stamp line 1 into Recent Locations.
  rememberPlace({ kind: '文件', path: tab.path, line: Math.max(0, tab.line - 1), label: tab.path })
  // 真的换了文件才通知（重复点同一个标签不该再读一次盘）。
  if (tab.path !== previous) deps.onTabActivated?.(tab.path)
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
  return {
    otherPane, focusPane, splitTabOut, toggleSplit, unsplit, unsplitAll, splitFromTabMenu, openInOppositeGroup,
    keepTabOpen, onEditorTabDoubleClick, switchTabIn, editorHistory, touchHistory, enforceTabLimit, closeTabIn,
    closedTabsPerPane, reopenClosedTab, setSplitOrientation, moveTabToOtherPane,
  }
}
