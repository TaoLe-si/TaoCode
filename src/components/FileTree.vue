<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, ref, watch } from 'vue'
import { getProjectTreeState } from '../projectTreeState'
import { Archive, ChevronRight, Coffee, FileCode2, FileText, Folder, Package, NotebookPen } from 'lucide-vue-next'
import { isSyntheticLibraryRow, SDK_ENTRY_PATH } from '../externalLibraries'
import { lspDiagnostics, type Entry } from '../bridge'
import { createProjectTreeModel, type ProjectTreeRow, type SyntheticNode } from '../projectTreeModel'
import type { ProjectTreeSortSettings } from '../projectTreeSort'
import { nodeDecorationFor, severityCounts } from '../projectTreeDecorations'
import { fileIconFor, type ProjectViewNodeDecoration } from '../ideViewExtensionPoints.ts'
import { fileIconComponent } from '../fileIconNames.ts'
import { Puzzle } from 'lucide-vue-next'
import { treeClickOpensFile, treeOpenUsesPreviewTab, visibleSyntheticNodes, type ProjectViewBehavior } from '../projectViewBehavior'
import { getCommandProcessor } from '../pvCommandProcessor.ts'
import { runFileUndoRedo } from '../undoProviderHost.ts'
import { reportText } from '../pvFileUndoProvider.ts'
import { speedSearchElement, speedSearchHitForStep, speedSearchKeyAction, speedSearchStepForKey } from '../speedSearch'
import { treeNodeActionFor } from '../treeNodeActions.ts'
import SpeedSearchBar from './SpeedSearchBar.vue'
import { iconSize } from '../uiIcons'

export type { SyntheticNode } from '../projectTreeModel'
const props = defineProps<{
  entries: Entry[]; active?: string; depth?: number; synthetic?: SyntheticNode[]
  indentGuides?: boolean; compactIndents?: boolean; expandWithSingleClick?: boolean
  fileColor?: (path: string, isDirectory: boolean) => string | null
  workspaceKey?: string; projectName?: string; rootPathTitle?: string
  sortSettings?: ProjectTreeSortSettings
  /** 项目视图自己的三条行为（IDEA `additionalGearActions` 那一组）。 */
  behavior?: ProjectViewBehavior
}>()
const emit = defineEmits<{ open: [path: string, preview: boolean]; error: [message: string]; context: [payload: { entry: Entry; x: number; y: number }]; rename: [entry: Entry] }>()
// A flattened visible tree uses one shared model for every depth. Directory rows
// no longer instantiate independent caches/selection models, so toolbar actions
// and keyboard navigation address exactly the rows rendered here.
const sharedSortSettings = computed(() => props.sortSettings ?? getProjectTreeState(props.workspaceKey ?? '').state)
// 嵌套规则与「压缩目录」的开关住在同一个宿主里（`getProjectTreeState` 那份设置）：
// 上游也是同一份 `ProjectViewState`（`ProjectViewState.kt:36` compactDirectories、`:49` useFileNestingRules），
// 设置改了要整树重建（`ConfigureFilesNestingAction.kt:58` 的 `updateFromRoot(true, SETTINGS)`）。
const treeHost = computed(() => getProjectTreeState(props.workspaceKey ?? ''))
/**
 * 「显示临时文件和控制台」（`ProjectView.ShowScratchesAndConsoles`）：这一格只管合成根里
 * scratches 那一条，外部库那一条不受它影响（上游 Project 窗格把库内容硬写成永远显示：
 * `ProjectViewPane.java:143-145`）。规则本体在 `src/projectViewBehavior.ts`。
 */
const syntheticRows = () => visibleSyntheticNodes(props.synthetic ?? [], sharedSortSettings.value.showScratchesAndConsoles)
const model = createProjectTreeModel({
  entries: () => props.entries,
  synthetic: syntheticRows,
  depth: () => props.depth ?? 0,
  projectName: () => props.projectName,
  sortSettings: () => sharedSortSettings.value,
  // 上游 `ProjectViewSettings.isUseFileNestingRules()`（`ProjectViewSettings.java:29-31`）关掉时
  // `NestingTreeStructureProvider` 整条不套 —— 本仓就是给一张空规则表。
  nestingRules: () => treeHost.value.nesting.enabled ? treeHost.value.nesting.rules : [],
  compactDirs: () => sharedSortSettings.value.compactDirectories ?? false,
  error: message => emit('error', message),
})
const { rows, expanded, selected, selection, loading, tabStop } = model
watch(() => props.workspaceKey, () => model.reset(), { flush: 'sync' })
watch(() => [props.entries, props.synthetic], () => { void model.refresh() }, { flush: 'pre' })
watch(() => [sharedSortSettings.value.compactDirectories ?? false,
  sharedSortSettings.value.showScratchesAndConsoles ?? true,
  treeHost.value.nesting.enabled, treeHost.value.nesting.rules],
  () => { void model.refresh() }, { flush: 'pre' })
onBeforeUnmount(model.dispose)
const step = () => (props.compactIndents ? 11 : 15)
const base = () => (props.compactIndents ? 10 : 12)
const indentStyle = (level: number) => ({ paddingLeft: `${base() + level * step()}px` })
const guideStyle = () => ({
  backgroundImage: `repeating-linear-gradient(90deg, var(--line) 0 1px, transparent 1px ${step()}px)`,
  backgroundPositionX: `${base() + step()}px`,
})
function bindRow(path: string, element: unknown) {
  if (element instanceof HTMLElement) model.elements.set(path, element)
  else model.elements.delete(path)
}
/**
 * 行尾小字 = tooltip 那一行（IDEA 里是 TooltipProvider 挂在节点上的 `getTooltipText`）。
 * 合成行要另算：外部库下面的 jar 与 SDK 内部 path 带着 NUL 前缀和 `lib:` 记号，直接显示
 * 是一串控制字符加一条项目里根本不存在的路径。改成给人看的两种说法：
 *   · jar → 相对项目的真实路径（照着能找回磁盘上那个文件）
 *   · SDK → 版本 + 家目录（看得出用的是哪个 JDK）
 * 上游对应 `NamedLibraryElementNode` 的 presentableName（`:84-90`）与
 * `ExternalLibrariesNode.java:117-120` 给 SDK 行补的 TooltipProvider。
 */
function rowTitle(row: ProjectTreeRow): string {
  if (row.synthetic) return row.synthetic.label
  if (row.entry.path === SDK_ENTRY_PATH) return `JDK · ${row.entry.name}`
  if (isSyntheticLibraryRow(row.entry.path)) return row.entry.path.slice(row.entry.path.indexOf(':') + 1)
  return row.entry.path === '' ? props.rootPathTitle ?? props.projectName ?? row.entry.name : row.entry.path
}
/**
 * 一个文件的诊断严重度计数（`lspDiagnostics` 是响应式 Map，这里有它才随诊断刷新）。
 * 与 `src/projectTreeDecorations.ts` 共用「1 = 错误 / 2 = 警告」口径（同一份 `severityCounts`）。
 */
const diagnosticCounts = computed(() => {
  const map = new Map<string, ReturnType<typeof severityCounts>>()
  for (const [path, items] of lspDiagnostics) map.set(path, severityCounts(items))
  return map
})
/**
 * 节点装饰（上游 `ProjectViewNodeDecorator`）：**每一行都过一遍 EP**，不是只过有诊断的文件 ——
 * 上游 `CompoundProjectViewNodeDecorator.decorate` 对树里每个节点都调用装饰器，第三方插件
 * （原版 IDEA 插件按 `com.intellij.projectViewNodeDecorator` 挂的那一支）就是靠这一趟给任意
 * 文件/目录加呈现。内建那支在计数为 0 时什么都不设，所以「没有诊断的行外貌不变」。
 * 合成行（NUL 前缀）不参与，与既有口径一致。
 *
 * 组装点收在 `src/projectTreeDecorations.ts` 的 `nodeDecorationFor`（**不是**在这里直接调 EP）：
 * 内建诊断那支是随包登记进同一条 EP 的一支，与第三方装饰器走同一条就地叠呈现的路径，
 * 「诊断 → errors/warnings」这个输入组装也只有那一处（此处不再自己拼第二遍）。
 */
function decorationOfRow(row: ProjectTreeRow): ProjectViewNodeDecoration {
  if (row.synthetic || row.entry.path.startsWith('\u0000')) return {}
  const counts = row.entry.kind === 'file' ? diagnosticCounts.value.get(row.entry.path) : undefined
  return nodeDecorationFor({
    id: row.entry.path, name: row.entry.name, path: row.entry.path,
    isDirectory: row.entry.kind === 'directory',
    errors: counts?.errors ?? 0, warnings: counts?.warnings ?? 0,
  })
}
function titleOf(row: ProjectTreeRow): string {
  const decoration = decorationOfRow(row)
  const base = decoration.presentableText ? rowTitle(row).replace(row.entry.name, decoration.presentableText) : rowTitle(row)
  return base + (decoration.tooltipSuffix ?? '')
}
/**
 * 行上的类名：**只取装饰器组装出来的那一份**（内建诊断那支把严重度折成 `tree-decoration-*`，
 * 第三方装饰器可再叠自己的类）。此前这里又按同一档严重度自己拼了一遍同样的后缀 ⇒ 同一个类名
 * 在行上出现两次（`tree-decoration-error tree-decoration-error`）。
 */
function rowClassOf(row: ProjectTreeRow): string {
  return decorationOfRow(row).className ?? ''
}
/**
 * 行首图标的自定义档（上游 `com.intellij.fileIconProvider` 的 `getIcon(file, flags, project)`）：
 * 第三方按同一 id 挂的 provider 可以给某个文件/目录换图标。没有 provider 认领时返回 null ⇒
 * 模板落回本仓既有的 lucide 图标表（内建的合成根两支在 `src/workspaceLifecycle.ts` 登记）。
 * 合成行的图标名是 `libraries/scratches/plugin` 三档，先按它们画，认不出再问 EP。
 */
const FLAG_OPEN = 8
function customIconOf(row: ProjectTreeRow) {
  // 内建合成图标名（libraries/scratches/plugin）由各自的模板分支画，别在这里吞掉。
  if (row.synthetic) return null
  return fileIconComponent(fileIconFor({
    path: row.entry.path,
    isDirectory: row.entry.kind === 'directory',
    flags: props.active === row.entry.path ? FLAG_OPEN : 0,
  }))
}
/**
 * 一行的呈现（主模板只做一次 `v-for`）：把「装饰类名 / tooltip / 呈现文本 / 自定义图标」
 * 先在脚本里算一遍。四个消费点（class、title、name、icon）都读这里，模板里不再重复调 EP。
 */
const rowsView = computed(() => {
  const view = new Map<string, { className: string; title: string; name: string; icon: ReturnType<typeof customIconOf> }>()
  for (const row of rows.value) {
    view.set(row.entry.path, {
      className: rowClassOf(row), title: titleOf(row), icon: customIconOf(row),
      name: decorationOfRow(row).presentableText ?? row.entry.name,
    })
  }
  return view
})
const viewOf = (row: ProjectTreeRow) => rowsView.value.get(row.entry.path)
function activate(entry: Entry, event: MouseEvent) {
  model.select(entry.path, event)
  void model.focus(entry.path)
  if (event.ctrlKey || event.metaKey || event.shiftKey) return
  if (entry.kind === 'directory') {
    // Ignore the second click of a double click in single-click expansion mode.
    if (props.expandWithSingleClick && event.detail < 2) model.toggle(entry)
    return
  }
  if (entry.path.startsWith('\u0000')) return
  // 「单击打开文件」（`ProjectView.AutoscrollToSource`，与目录的 `OpenDirectoriesWithSingleClick` 同一组）：
  // 开关关着时只有双击才开（见 doubleClick），打开时单击就开。
  if (treeClickOpensFile(behavior(), 'file', event.detail) === 'open') emit('open', entry.path, treeOpenUsesPreviewTab(behavior()))
}
function doubleClick(entry: Entry) {
  if (entry.kind === 'directory') { if (!props.expandWithSingleClick) model.toggle(entry); return }
  if (entry.path.startsWith('\u0000')) return
  if (treeClickOpensFile(behavior(), 'file', 2) === 'open') emit('open', entry.path, treeOpenUsesPreviewTab(behavior()))
}
/**
 * 键盘那条路：`RenameElement` 绑的是 **Shift+F6**（`$default.xml:996-998`，动作本体
 * `RenameElementAction` = `intellij.platform.lang.impl.actions.xml:216`），它按数据上下文里选中的
 * 那个 VirtualFile 找可用的 renamer（`RenameElementAction.java:130-131`），所以在项目视图里
 * 按下就是给这一行改名 —— 与右键菜单里的「重命名…」同一个对话框。
 * 其余按键照旧交给 `navigate`（上下左右 / Home / End / Enter / 空格 / Ctrl+A）。
 */
/**
 * 文件级撤销/重做（`$Undo` / `$Redo`，键位 `Ctrl+Z` / `Ctrl+Shift+Z`，
 * `$default.xml:232-235` / `:685-688`）。上游这两个键是**全局**的：焦点在项目视图里按 Ctrl+Z
 * 撤的就是上一次文件操作（`UndoAction` 按当前 FileEditor 取范围，`UndoManagerImpl:104-115`）。
 * 本仓的范围 = 树里当前选中的那些路径；没有选中时按空范围问（只有跨文件的全局组可撤，
 * 与 `CommandMerger.isUndoAvailable` 的同一判据）。
 * 被拒绝时把上游那份报告原文交出去（`emit('error')`），成功时什么都不弹（上游也不弹）。
 * 成功之后**必须让树重看一遍磁盘**：上游撤完 copy/move/delete 会发出 VFS 事件，
 * 窗格按 `ProjectViewUpdateCause.kt:49-52` 那四个成因（VFS_CREATE / VFS_COPY / VFS_MOVE / VFS_DELETE）
 * 重建那一支；本仓没有事件总线，`model.refresh()` 就是同一件事的等价物
 * （清掉目录缓存重新取，被撤掉的那一行立刻消失）。宿主菜单那条路已经在成功后刷树
 * （`src/explorerActions.ts` 的 `undoOrRedoFileOperation` ⇒ `refreshTree()`），这里补齐的是树内按键那一半。
 */
function undoRedoFileOperation(kind: 'undo' | 'redo') {
  const processor = getCommandProcessor(props.workspaceKey ?? '')
  const scope = [...selection]
  // 走 `com.intellij.undoProvider` 那条链（`src/undoProviderHost.ts`）：围绕这次撤销/重做按上游
  // `UndoManagerImpl.onCommandStarted/onCommandFinished`（`:278-290`）通知全部撤销提供者 ——
  // 出厂的 `FileUndoProvider` 与第三方按同一 id 挂的那几支走同一条路径。
  void runFileUndoRedo(processor, props.workspaceKey ?? '', kind, scope).then(result => {
    if (!result.ok && result.report) emit('error', reportText(result.report))
    else if (result.ok) void model.refresh()
  })
}
function onRowKeydown(entry: Entry, event: KeyboardEvent) {
  // 树节点的展开/折叠动作（上游 `ide/actions/tree` 那一族，`$default.xml:27-35` 的裸小键盘键：
  // `*` 全部展开 / `+` 展开 / `-` 折叠）。判定与上限在 `src/treeNodeActions.ts`，这里只认键面。
  const treeAction = treeNodeActionFor(event.code, { ctrl: event.ctrlKey, alt: event.altKey, shift: event.shiftKey, meta: event.metaKey })
  if (treeAction) { event.preventDefault(); void model.runTreeNodeAction(treeAction); return }
  if (event.key === 'Z' && event.ctrlKey && !event.altKey && !event.metaKey) {
    // Ctrl+Shift+Z = 重做，Ctrl+Z = 撤销（两个键位都在上游键位表里，没有第三种组合）。
    event.preventDefault()
    undoRedoFileOperation(event.shiftKey ? 'redo' : 'undo')
    return
  }
  if (event.key === 'F6' && event.shiftKey && !event.ctrlKey && !event.metaKey && !event.altKey) {
    if (entry.path.startsWith('\u0000')) return
    event.preventDefault()
    model.select(entry.path, event)
    emit('rename', entry)
    return
  }
  void model.navigate(event, entry, path => emit('open', path, treeOpenUsesPreviewTab(behavior())))
}
/**
 * 三条行为的当前值。来源是**项目视图设置**（`props.sortSettings`，宿主两处都传了
 * `projectTreeState.state`；缺字段按上游默认 false）。`props.behavior` 是给纯渲染用例
 * （SSR 夹具）直接注入三值的口子。
 */
function behavior(): ProjectViewBehavior {
  const settings = props.sortSettings as Partial<ProjectViewBehavior> | undefined
  return props.behavior ?? {
    autoscrollToSource: settings?.autoscrollToSource ?? false,
    autoscrollFromSource: settings?.autoscrollFromSource ?? false,
    openInPreviewTab: settings?.openInPreviewTab ?? false,
  }
}
function toggleChevron(entry: Entry) {
  model.select(entry.path)
  void model.focus(entry.path)
  model.toggle(entry)
}
function showMenu(entry: Entry, event: MouseEvent) {
  event.preventDefault()
  model.select(entry.path, {}, selection.has(entry.path))
  void model.focus(entry.path)
  // Synthetic library descriptors are not real filesystem context targets.
  if (!entry.path.startsWith('\u0000')) emit('context', { entry, x: event.clientX, y: event.clientY })
}
const { collapseAll, expandAll, reveal, expandRecursively, getSelectedEntries, canExpandRecursively, hasNested } = model
// 速度搜索（IDEA 的 `SpeedSearch`，项目视图装的是 `TreeSpeedSearch`）：Ctrl+F 在树上打开搜索框，
// 输入即选中第一条命中，上下键在命中项之间走，Enter/Esc 收起搜索框。
// 匹配（驼峰子序列）与按键归属都在 src/speedSearch.ts，这里只管 DOM 与焦点。
const rootRef = ref<HTMLElement | null>(null)
const searchOpen = ref(false)
const searchQuery = ref('')
const searchLabels = () => rows.value.map(row => row.synthetic?.label ?? row.entry.name)
/** 选中第 index 行并滚到可见处。`reveal` 就是上游"展开折叠的祖先再选中"的等价物。 */
async function gotoHit(index: number) {
  const row = rows.value[index]
  if (!row) return
  reveal(row.entry.path)
  await model.focus(row.entry.path)
}
async function onSearchInput(value: string) {
  searchQuery.value = value
  // 上游打字走的是 `findElement`（`SpeedSearchBase.java:519-537`）：**从当前选中行（含它自己）**
  // 往后扫、走完再回绕，而不是永远从第 0 行重扫 —— 在一行能命中、下一行不能命中的列表里
  // 继续打字才不会把高亮甩走。
  const labels = searchLabels()
  const current = rows.value.findIndex(row => row.entry.path === selected.value)
  const index = speedSearchElement(labels, searchQuery.value, current)
  if (index >= 0) await gotoHit(index)
}
function openSpeedSearch() {
  if (!rows.value.length) return
  searchOpen.value = true
  // 焦点交给搜索框：组件把它渲染在 `.project-view` 下的 `.speed-search-input` 上。
  void nextTick(() => (rootRef.value?.querySelector('.speed-search-input') as HTMLInputElement | null)?.focus())
}
async function closeSpeedSearch() {
  searchOpen.value = false
  searchQuery.value = ''
  await model.focus(selected.value)
}
async function onSearchKeydown(event: KeyboardEvent) {
  const query = searchQuery.value
  const action = speedSearchKeyAction(event.key, query)
  if (action === 'accept' || action === 'hide') { event.preventDefault(); await closeSpeedSearch(); return }
  if (action === 'ignore') return
  const step = speedSearchStepForKey(event.key)
  if (!step) return
  event.preventDefault()
  const labels = searchLabels()
  const current = rows.value.findIndex(row => row.entry.path === selected.value)
  const target = speedSearchHitForStep(labels, query, current, step.kind)
  if (target >= 0) await gotoHit(target)
}
// Existing public method signatures are retained. workspaceKey is an optional
// host identity boundary for project switches whose relative root names match.
defineExpose({ collapseAll, expandAll, reveal, expandRecursively, getSelectedEntries, canExpandRecursively, openSpeedSearch, selected, selection })
</script>

<template>
  <div ref="rootRef" class="project-view" @keydown.ctrl.f.prevent.stop="openSpeedSearch()">
    <!-- 速度搜索的搜索框：只有打开时才占位。命中后上下键在命中项之间走，Enter/Esc 收起。 -->
    <SpeedSearchBar :open="searchOpen" :query="searchQuery" @input="onSearchInput" @keydown="onSearchKeydown" />
    <p v-if="!rows.length" class="tree-empty">此项目没有可见文件；排除的目录在“设置 → 项目结构”里调整。</p>
    <ul class="tree-list" :role="depth ? 'group' : 'tree'" aria-label="项目文件" aria-multiselectable="true">
      <li v-for="row in rows" :key="row.entry.path" role="none">
        <button
          :ref="element => bindRow(row.entry.path, element)"
          class="tree-entry" role="treeitem"
          :class="[{ selected: selection.has(row.entry.path), 'indent-guides': indentGuides, 'tree-synthetic': !!row.synthetic }, viewOf(row)?.className]"
          :style="[indentStyle(row.level), indentGuides ? guideStyle() : undefined, { '--tree-file-color': !row.synthetic && !row.entry.path.startsWith('\u0000') ? fileColor?.(row.entry.path, row.entry.kind === 'directory') ?? undefined : undefined }]"
          :title="viewOf(row)?.title"
          :aria-level="row.level + 1"
          :aria-expanded="row.entry.kind === 'directory' ? expanded.has(row.entry.path) : undefined"
          :aria-selected="selection.has(row.entry.path)"
          :aria-current="row.entry.kind === 'file' && active === row.entry.path ? 'page' : undefined"
          :aria-busy="loading.has(row.entry.path) || undefined"
          :tabindex="tabStop === row.entry.path ? 0 : -1"
          @focus="model.onFocus(row.entry.path)"
          @click="activate(row.entry, $event)"
          @dblclick="doubleClick(row.entry)"
          @contextmenu="showMenu(row.entry, $event)"
          @keydown="onRowKeydown(row.entry, $event)"
          @keyup.space.prevent
        >
          <span v-if="row.entry.kind === 'directory' || hasNested(row.entry.path)" class="tree-expander" @click.stop="toggleChevron(row.entry)" @dblclick.stop>
            <ChevronRight :size="iconSize.dense" class="tree-chevron" :class="{ expanded: expanded.has(row.entry.path) }" />
          </span>
          <span v-else class="tree-spacer" />
          <Package v-if="row.synthetic?.icon === 'libraries'" :size="iconSize.toolbar" class="synthetic-icon" />
          <NotebookPen v-else-if="row.synthetic?.icon === 'scratches'" :size="iconSize.toolbar" class="synthetic-icon" />
          <!-- `com.intellij.treeStructureProvider` 挂上来的**新合成容器**：本仓没有它的专属图标样式，
               沿用「插件贡献」的 Puzzle，与内建的两个合成根区分开（不冒充库也不冒充 scratch）。 -->
          <Puzzle v-else-if="row.synthetic?.icon === 'plugin'" :size="iconSize.toolbar" class="synthetic-icon" />
          <!-- 文件图标提供者（`com.intellij.fileIconProvider`）：第三方按 id 挂的 provider 认领了这个
               路径时用它的图标名。本仓没有 `Icon`，图标名到 lucide 一一对应；认不出的名字退回内建那几张表。 -->
          <component v-else-if="viewOf(row)?.icon" :is="viewOf(row)?.icon" :size="iconSize.toolbar" class="synthetic-icon" />
          <!-- 外部库的两类叶子各有各的图标，和普通文件图标分开 —— 上游 SDK 行是
               `SdkType.getIcon()`（`NamedLibraryElementNode.java:52-59`），jar 根是它库自己的
               文件图标（`:43-50`），都不跟工作区里的 .java/.ts 共用。Coffee 取 IDEA 里 JDK
               那个"咖啡杯"的字面意思；Archive 表示打包产物，与容器那个 Package 区分开。 -->
          <Coffee v-else-if="row.entry.path === SDK_ENTRY_PATH" :size="iconSize.toolbar" class="synthetic-icon" />
          <Archive v-else-if="isSyntheticLibraryRow(row.entry.path)" :size="iconSize.toolbar" class="synthetic-icon" />
          <Folder v-else-if="row.entry.kind === 'directory'" :size="iconSize.toolbar" class="folder-icon" />
          <FileCode2 v-else-if="/\.(java|kt|cpp|hpp|c|h|ts|js|vue)$/.test(row.entry.name)" :size="iconSize.toolbar" class="code-icon" />
          <FileText v-else :size="iconSize.toolbar" class="muted" />
          <span class="tree-name">{{ viewOf(row)?.name ?? row.entry.name }}</span><span v-if="loading.has(row.entry.path)">…</span>
        </button>
        <div v-if="expanded.has(row.entry.path) && (row.synthetic ? row.synthetic.entries.length === 0 : row.entry.path === '' && projectName !== undefined && !depth ? entries.length === 0 : model.children.get(row.entry.path)?.length === 0)" class="empty-folder" :style="indentStyle(row.level + 1)">{{ row.synthetic ? '（空）' : '空目录' }}</div>
      </li>
    </ul>
  </div>
</template>

<style scoped>
.synthetic-icon { color: var(--syntax-meta); flex-shrink: 0; }
.tree-expander,
.tree-spacer { display: inline-flex; flex: 0 0 var(--icon-size-dense); width: var(--icon-size-dense); justify-content: center; }
.tree-entry:not(.selected):not(:hover) { background-color: var(--tree-file-color, transparent); }
.tree-entry:focus-visible { outline: var(--focus-ring); outline-offset: var(--focus-ring-offset-inset); position: relative; z-index: 1; }
.tree-entry:focus-visible:not(.selected) { background-color: var(--hover); }
.tree-entry > .synthetic-icon,
.tree-entry > .folder-icon,
.tree-entry > .code-icon,
.tree-entry > .muted { color: var(--secondary); }
.tree-entry.selected > svg { color: var(--accent); }
/* 节点装饰（ProjectViewNodeDecorator 的 "Highlight files with errors"）：错误/警告只改文件名颜色。 */
.tree-decoration-error .tree-name { color: var(--error); }
.tree-decoration-warning .tree-name { color: var(--warning); }
.tree-empty { margin: 0; padding: var(--space-3); color: var(--muted); font-size: 11px; line-height: 1.7; }
</style>
