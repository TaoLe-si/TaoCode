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
import { absolutePath } from './filenameWidget.ts'
import { request, type Entry } from './bridge.ts'
import { errorMessage } from './errors.ts'
import { shouldSelectInTree, type ProjectViewBehavior } from './projectViewBehavior.ts'
import { navBarCrumbs } from './navBarModel.ts'
import { getProjectTreeState } from './projectTreeState.ts'
import type { Tab } from './editorTab'
import type { SelectInRow } from './selectIn.ts'
import { selectInTargetById, selectInTargetRows, type SelectInContext } from './selectInTargets.ts'

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
// 重列项目树。**开自己的忙标、放弃时排队**：早先用的是全应用的 `busy`（很多操作都会置它），
// 打开项目那一串里正好 busy ⇒ 这次刷新被**静默丢掉**且不再重试，`entries` 就停在 `[]` ——
// 表现是项目视图一片空白，切到别的左视图再切回来（那时 busy 已落下、`showView` 会再刷一次）才恢复。
let treeBusy = false
let treeAgain = false
async function refreshTree() {
  if (!workspace.value) return
  if (treeBusy) { treeAgain = true; return }   // 排队而不是丢
  treeBusy = true
  try {
    workspace.value.entries = await request<Entry[]>('workspace.list', { path: '' })
    treeVersion.value++
  } catch (error) { notify(errorMessage(error), true) }
  finally {
    treeBusy = false
    if (treeAgain) { treeAgain = false; void refreshTree() }
  }
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
  // 段路径取导航栏模型（src/navBarModel.ts 的 navBarCrumbs），不再在这里重切一遍路径：
  // 链是 [根, 目录…, 文件]，DOM 里根按钮单列，所以第 index 个目录段 = chain[index + 1]。
  const crumb = navBarCrumbs(active.value.path, workspace.value?.name ?? '')[segmentIndex + 1]
  if (!crumb) return
  explorer.value = true
  leftView.value = 'files'
  fileTreeRef.value?.reveal(crumb.path)
}
/**
 * `BreadcrumbsBar` 的 `reveal` 事件落点：组件自己已经算好了段（根 / 目录 / 文件），
 * 这里只负责把它送到项目视图（上游 `NavBarItem.activate` 的"在项目树里定位"那一面）。
 * 根段传空串 = 只打开项目视图不做定位（与原先根按钮只切 `explorer`/`leftView` 同口径）。
 */
function revealBreadcrumbPath(path: string) {
  explorer.value = true
  leftView.value = 'files'
  if (path) fileTreeRef.value?.reveal(path)
}
  // 卸载时清掉待触发的防抖（`let markdownTimer` 已随本域搬进来，宿主拿不到它）。
  function cancelMarkdownRefresh() { if (markdownTimer !== undefined) { window.clearTimeout(markdownTimer); markdownTimer = undefined } }
  // --- Select In（IDEA 的 Alt+F1 目标列表）-------------------------------------------------
  // 目标只有"本仓真有落点"的六个，顺序与置灰判据都照抄上游。
  // **书签**目标仍然不列，但理由换了（留痕）：原注释写"本仓的书签全是行书签"，
  // 那条前提**已经变了** —— `src/bookmarks.ts:36` 的 `isFileBookmark`（没有 `line` 的那一档）
  // 与 `toggleFileBookmark` 早已在树上，上游 `BookmarksSelectInTarget.canSelect`
  // （`platform/bookmarks/src/com/intellij/ide/bookmark/ui/BookmarksSelectInTarget.kt:22-37`）
  // 现在能对得上。仍然不列的真实原因只剩一条：这一行的 `selectable` 要读"当前文件有没有文件书签"，
  // 而书签表在 `createBookmarkActions` 手里、没注进本模块（`EditorSideViewsDeps` 里没有那条形参）
  // ⇒ 接线请求见 `docs/wiring-requests-2026-10-06-nav3.md` W-1（补一条形参 + 一行表项，权重
  // `StandardTargetWeights.java:6` 的 BOOKMARKS_WEIGHT = 1.001，落在项目视图与文件结构之间）。
  const selectInOpen = ref(false)
  const selectInAt = ref<{ x: number; y: number } | null>(null)
  // 目标表**不再写死在这里** —— 六个内置目标是 `com.intellij.selectInTarget` EP 的 bundled 贡献
  // （`src/selectInTargets.ts`），第三方可按同一个 EP id 挂自己的目标。这里只把宿主当前上下文
  // 折成 `SelectInContext`（事实 + 副作用回调），弹层行与派发都走那一份。
  function selectInContext(): SelectInContext {
    const path = active.value?.path ?? ''
    // 合成条目（`\u0000` 前缀：jar 条目、临时缓冲）在磁盘上不存在 —— 上游对这类条目的判据是
    // `RevealFileAction.findLocalFile` 非空（explorer 那一行），项目视图那一行则是
    // `ProjectViewSelectInTarget.canSelect`（false）。两条共用同一个"这一格是真的文件"谓词。
    const inTree = Boolean(workspace.value) && !!path && !path.startsWith('\u0000')
    return {
      hasActiveFile: Boolean(active.value),
      hasPath: !!path,
      inTree,
      isDesktop,
      hasBreadcrumbs: Boolean(path) && Boolean(breadcrumbsVisible?.(path)),
      hasChange: Boolean(active.value) && Boolean(changeOf?.(path)),
      hasWorkspace: Boolean(workspace.value),
      selectProjectView: () => selectInTree(),
      showNavBar: () => showNavBar(),
      focusToolWindow: id => focusToolWindow?.(id),
      openProjectStructure: () => openProjectStructure?.(),
      revealInExplorer: async () => {
        // 编辑器路径可能是绝对路径（LSP 位置），也可能带工作区根相对形式：两条通道分别对应
        // `Workspace::reveal`（相对）与 `shell.reveal`（绝对 = RevealFileAction.openFile）。
        const root = workspace.value?.root ?? ''
        const absolute = absolutePath(root, path)
        if (path.startsWith('/') || /^[A-Za-z]:[\\/]/.test(path)) await request('shell.reveal', { path: absolute })
        else await request('file.reveal', { path })
      },
    }
  }
  const selectInRows = computed<SelectInRow[]>(() => selectInTargetRows(selectInContext()))
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
    if (!active.value?.path) return
    const context = selectInContext()
    // 置灰/不存在都拿不到目标（`selectInTargetById` 复判 `canSelect`）—— 点了没反应好过半个动作。
    const target = selectInTargetById(context, id)
    if (!target) return
    try { await target.selectIn(context) } catch (error) { notify(errorMessage(error), true) }
  }
  return {
    cancelMarkdownRefresh, refreshMarkdownNow, refreshMarkdownSoon, toggleMarkdownPreview,
    refreshTree, selectInTree, openBreadcrumb, revealBreadcrumbPath, showNavBar,
    selectInOpen, selectInAt, selectInRows, openSelectIn, closeSelectIn, pickSelectIn,
  }
}
