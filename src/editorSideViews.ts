// 编辑器侧视图与项目视图定位 —— 从 App.vue 搬出的一域。
//
// 判据：这一组都在回答同一个问题 —— 「当前文件变了 / 要把当前文件亮出来，旁边那些视图怎么跟上」：
//   · Markdown 预览（IDEA 的 Markdown 预览编辑器）：只对 `.md` 生效，跟随实时文本，
//     300ms 防抖（`markdownTimer`），切换文件时自动收起；
//   · 文件树刷新（`refreshTree`：重列根目录 + 重建合成节点）；
//   · 「在项目中定位」（`SelectInProjectView`）与面包屑点击 —— 两者都是"打开左栏 → 定位到某个路径"；
//   · Select In 弹窗（Alt+F1 的**目标列表**）：六个目标的存在性、顺序、置灰判据、编号全在上游源码里，
//     纯规则拆在 src/selectIn.ts，这里只有"读当前上下文 → 组一张表 → 按 id 分派"。
// 它们共享 `active` / `activePath` / `fileTreeRef`，所以合成一域。
// 文件树的**右键动作**在 src/treeActions.ts；这里只有"刷新与定位"。
import { computed, ref, watch } from 'vue'
import { absolutePath } from './filenameWidget'
import { request, type Entry } from './bridge'
import { errorMessage } from './errors'
import { shouldSelectInTree, type ProjectViewBehavior } from './projectViewBehavior'
import { getProjectTreeState } from './projectTreeState'
import type { Tab } from './editorTab'
import { planSelectIn, type SelectInRow, type SelectInTargetSpec } from './selectIn'

export interface EditorSideViewsDeps {
  notify: (message: string, error?: boolean) => void
  workspace: any
  busy: any
  treeVersion: any
  active: { readonly value: Tab | undefined }
  activePath: { readonly value: string }
  editorFor: (path: string) => any
  findTab: (path: string) => Tab | undefined
  explorer: any
  leftView: any
  fileTreeRef: any
  /** 项目视图设置按项目 root 建 host（`src/projectTreeState.ts`），本域直接取当前项目的那个。 */
  workspaceRoot: () => string
  /** Markdown 预览的三个状态（宿主更早的阶段就要读它们，所以留在宿主）。 */
  markdownPreviewOn: any
  markdownCapable: { readonly value: boolean }
  markdownSource: any
  /** 工作区生命周期模块提供 —— 惰性。 */
  refreshSyntheticNodes: () => unknown
  // --- Select In 弹窗要落到的六个目标（都由宿主在更晚的阶段装配，故全部惰性）---
  isDesktop: boolean
  /** 面包屑是否显示（IDEA 的 `UISettings.getShowNavigationBar()` 那一档）。 */
  breadcrumbsVisible?: (path: string) => boolean
  /** 当前文件的 VCS 变更（没有则 null）—— IDEA 的 `FileStatus != NOT_CHANGED`。 */
  changeOf?: (path: string) => unknown
  focusToolWindow?: (id: any) => void
  openProjectStructure?: () => void
}

export function createEditorSideViews(deps: EditorSideViewsDeps) {
  const { notify, workspace, busy, treeVersion, active, activePath, editorFor, findTab, explorer, leftView,
          fileTreeRef, markdownPreviewOn, markdownCapable, markdownSource, refreshSyntheticNodes,
          isDesktop, breadcrumbsVisible, changeOf, focusToolWindow, openProjectStructure,
          workspaceRoot } = deps
  const projectViewBehavior = (): ProjectViewBehavior => getProjectTreeState(workspaceRoot()).state
// IDEA's Markdown preview: a split beside the editor, toggled per file; the toggle
// button only exists for .md buffers and the preview follows the live text.
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
watch(activePath, path => {
  if (!markdownCapable.value) markdownPreviewOn.value = false
  else if (markdownPreviewOn.value) refreshMarkdownNow()
  // 「始终选择打开的文件」（`ProjectView.AutoscrollFromSource`，`ActionsBundle.properties:1453`
  // "Always Select Opened File"）：编辑器切标签时在项目树里选中它。
  // 上游 `AutoScrollFromSourceHandler.java:80` 的 `selectInAlarm` 就挂在这个时机上。
  const target = typeof path === 'string' ? path : activePath.value
  if (shouldSelectInTree(projectViewBehavior(), target)) fileTreeRef.value?.reveal(target)
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
// IDEA 的 `ShowNavBar`（默认键 Alt+HOME，`keymaps/$default.xml:14-15`）：把焦点交给**当前编辑器**的
// 导航条，落点是**最内层的那个目录段**（`.breadcrumb-seg` 的最后一个），此后左右方向键与 Enter
// 由浏览条自己接管。本仓的导航条就是面包屑那一行，两个位置（上/下）只渲染一个，所以按
// `data-navbar="active"` 找活动编辑器那一条。
function showNavBar() {
  const bar = document.querySelector<HTMLElement>('.breadcrumbs[data-navbar="active"]')
  const segments = bar ? Array.from(bar.querySelectorAll<HTMLButtonElement>('.breadcrumb-seg')) : []
  const target = segments[segments.length - 1]
  if (!target) { notify('当前编辑器没有可用的导航条（面包屑未开启，或该文件直接在项目根下）。', true); return }
  target.focus()
}
function openBreadcrumb(segmentIndex: number) {
  if (!active.value) return
  const dir = active.value.path.split('/').slice(0, segmentIndex + 1).join('/')
  explorer.value = true
  leftView.value = 'files'
  fileTreeRef.value?.reveal(dir)
}
  // 卸载时清掉待触发的防抖（`let markdownTimer` 已随本域搬进来，宿主拿不到它）。
  function cancelMarkdownRefresh() { if (markdownTimer !== undefined) { window.clearTimeout(markdownTimer); markdownTimer = undefined } }
  // --- Select In（IDEA 的 Alt+F1 目标列表）-------------------------------------------------
  // 目标只有"本仓真有落点"的六个，顺序与置灰判据都照抄上游；**书签**目标刻意不做：
  // 上游 `BookmarksSelectInTarget.canSelect`（BookmarksSelectInTarget.kt:26-33）只认 FileBookmark，
  // 而本仓的书签全是行书签（src/bookmarks.ts 的 `Bookmark { path; line }`），加上就是一条永远灰着的行。
  const selectInOpen = ref(false)
  const selectInAt = ref<{ x: number; y: number } | null>(null)
  const selectInRows = computed<SelectInRow[]>(() => {
    const path = active.value?.path ?? ''
    // 合成条目（`\u0000` 前缀）在磁盘上不存在 —— 上游的判据是 `RevealFileAction.findLocalFile` 非空。
    const local = isDesktop && Boolean(workspace.value) && !!path && !path.startsWith('\u0000')
    const targets: SelectInTargetSpec[] = [
      // ProjectViewSelectInGroupTarget.java:66 → ProjectConceptBundle.properties:12 "Project View"；
      // 权重是接口的默认值 0（SelectInTarget.java:49-51）。
      { id: 'project', label: '项目视图', weight: 0, selectable: Boolean(active.value) && Boolean(workspace.value) },
      // StructureViewSelectInTarget.java:35-41 → IdeBundle.properties:305 "File Structure"，
      // canSelect = 有文件编辑器（`getFileEditorProvider() != null`）。权重 4。
      { id: 'structure', label: '文件结构', weight: 4, selectable: Boolean(active.value) },
      // SelectInNavBarTarget.java:41-43 → IdeBundle.properties:261 "Navigation Bar"，
      // canSelect = `UISettings.getShowNavigationBar()`（这里是面包屑的两层开关）。权重 8。
      { id: 'navbar', label: '导航栏', weight: 8, selectable: Boolean(path) && Boolean(breadcrumbsVisible?.(path)) },
      // SelectInChangesViewTarget.java:29-38 → 名称取本地更改工具窗口的标题
      // （ChangesViewManager.kt:360-368：启用 Commit 窗口时是 "Commit"），权重 9。
      { id: 'commit', label: '提交', weight: 9, selectable: Boolean(active.value) && Boolean(changeOf?.(path)) },
      // ProjectViewSelectInExplorerTarget.java:29-37 → RevealFileAction.getActionName()
      // = ActionsBundle.properties:1937 "Show in {0}" + IdeBundle.properties:3209 "Explorer"。权重 9.5。
      { id: 'explorer', label: '在资源管理器中显示', weight: 9.5, selectable: local },
      // ProjectStructureSelectInTarget → JavaUiBundle.properties:25 "Project Structure"。权重 10。
      { id: 'settings', label: '项目结构', weight: 10, selectable: Boolean(workspace.value) },
    ]
    return planSelectIn(targets)
  })
  /** IDEA 用 `showInBestPositionFor` 把弹窗钉在**光标**处（编辑器有焦点时）。 */
  function openSelectIn() {
    if (!active.value) { notify('Select In 需要一个打开的文件。', true); return }
    const coords = editorFor(active.value.path)?.getCursorCoords?.() as { left?: number; bottom?: number } | null | undefined
    selectInAt.value = coords ? { x: coords.left ?? 0, y: coords.bottom ?? 0 } : null
    selectInOpen.value = true
  }
  function closeSelectIn() { selectInOpen.value = false }
  async function pickSelectIn(id: string) {
    selectInOpen.value = false
    const path = active.value?.path
    if (!path) return
    if (id === 'project') { selectInTree(); return }
    if (id === 'navbar') { showNavBar(); return }
    if (id === 'settings') { openProjectStructure?.(); return }
    if (id === 'structure') { focusToolWindow?.('outline'); return }
    if (id === 'commit') { focusToolWindow?.('git'); return }
    try {
      // 编辑器路径可能是绝对路径（LSP 位置），也可能带工作区根相对形式：两条通道分别对应
      // `Workspace::reveal`（相对）与 `shell.reveal`（绝对 = RevealFileAction.openFile）。
      const root = workspace.value?.root ?? ''
      const absolute = absolutePath(root, path)
      if (path.startsWith('/') || /^[A-Za-z]:[\\/]/.test(path)) await request('shell.reveal', { path: absolute })
      else await request('file.reveal', { path })
    } catch (error) { notify(errorMessage(error), true) }
  }
  return {
    cancelMarkdownRefresh, refreshMarkdownNow, refreshMarkdownSoon, toggleMarkdownPreview,
    refreshTree, selectInTree, openBreadcrumb, showNavBar,
    selectInOpen, selectInAt, selectInRows, openSelectIn, closeSelectIn, pickSelectIn,
  }
}
