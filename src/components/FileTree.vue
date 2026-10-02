<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, ref, watch } from 'vue'
import { getProjectTreeState } from '../projectTreeState'
import { Archive, ChevronRight, Coffee, FileCode2, FileText, Folder, Package, NotebookPen } from 'lucide-vue-next'
import { isSyntheticLibraryRow, SDK_ENTRY_PATH } from '../externalLibraries'
import type { Entry } from '../bridge'
import { createProjectTreeModel, type ProjectTreeRow, type SyntheticNode } from '../projectTreeModel'
import type { ProjectTreeSortSettings } from '../projectTreeSort'
import { treeClickOpensFile, treeOpenUsesPreviewTab, type ProjectViewBehavior } from '../projectViewBehavior'
import { firstSpeedSearchHit, lastSpeedSearchHit, nextSpeedSearchHit, speedSearchKeyAction, speedSearchStepForKey } from '../speedSearch'
import SpeedSearchBar from './SpeedSearchBar.vue'
import { iconSize } from '../uiIcons'

export type { SyntheticNode } from '../projectTreeModel'
const props = defineProps<{
  entries: Entry[]; active?: string; depth?: number; synthetic?: SyntheticNode[]
  indentGuides?: boolean; compactIndents?: boolean; expandWithSingleClick?: boolean
  fileColor?: (path: string, isDirectory: boolean) => string | null
  workspaceKey?: string; projectName?: string
  sortSettings?: ProjectTreeSortSettings
  /** 项目视图自己的三条行为（IDEA `additionalGearActions` 那一组）。 */
  behavior?: ProjectViewBehavior
}>()
const emit = defineEmits<{ open: [path: string, preview: boolean]; error: [message: string]; context: [payload: { entry: Entry; x: number; y: number }] }>()
// A flattened visible tree uses one shared model for every depth. Directory rows
// no longer instantiate independent caches/selection models, so toolbar actions
// and keyboard navigation address exactly the rows rendered here.
const sharedSortSettings = computed(() => props.sortSettings ?? getProjectTreeState(props.workspaceKey ?? '').state)
const model = createProjectTreeModel({
  entries: () => props.entries,
  synthetic: () => props.synthetic ?? [],
  depth: () => props.depth ?? 0,
  projectName: () => props.projectName,
  sortSettings: () => sharedSortSettings.value,
  error: message => emit('error', message),
})
const { rows, expanded, selected, selection, loading, tabStop } = model
watch(() => props.workspaceKey, () => model.reset(), { flush: 'sync' })
watch(() => [props.entries, props.synthetic], () => { void model.refresh() }, { flush: 'pre' })
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
  return row.entry.path === '' ? props.workspaceKey ?? row.entry.name : row.entry.path
}
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
const { collapseAll, expandAll, reveal, expandRecursively, getSelectedEntries, canExpandRecursively } = model
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
  const index = firstSpeedSearchHit(searchLabels(), searchQuery.value)
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
  const target = step.kind === 'first' ? firstSpeedSearchHit(labels, query)
    : step.kind === 'last' ? lastSpeedSearchHit(labels, query)
    : nextSpeedSearchHit(labels, query, current, step.kind === 'next' ? 1 : -1)
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
          :class="{ selected: selection.has(row.entry.path), 'indent-guides': indentGuides, 'tree-synthetic': !!row.synthetic }"
          :style="[indentStyle(row.level), indentGuides ? guideStyle() : undefined, { '--tree-file-color': !row.synthetic && !row.entry.path.startsWith('\u0000') ? fileColor?.(row.entry.path, row.entry.kind === 'directory') ?? undefined : undefined }]"
          :title="rowTitle(row)"
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
          @keydown="model.navigate($event, row.entry, path => emit('open', path, treeOpenUsesPreviewTab(behavior())))"
          @keyup.space.prevent
        >
          <span v-if="row.entry.kind === 'directory'" class="tree-expander" @click.stop="toggleChevron(row.entry)" @dblclick.stop>
            <ChevronRight :size="iconSize.dense" class="tree-chevron" :class="{ expanded: expanded.has(row.entry.path) }" />
          </span>
          <span v-else class="tree-spacer" />
          <Package v-if="row.synthetic?.icon === 'libraries'" :size="iconSize.toolbar" class="synthetic-icon" />
          <NotebookPen v-else-if="row.synthetic?.icon === 'scratches'" :size="iconSize.toolbar" class="synthetic-icon" />
          <!-- 外部库的两类叶子各有各的图标，和普通文件图标分开 —— 上游 SDK 行是
               `SdkType.getIcon()`（`NamedLibraryElementNode.java:52-59`），jar 根是它库自己的
               文件图标（`:43-50`），都不跟工作区里的 .java/.ts 共用。Coffee 取 IDEA 里 JDK
               那个"咖啡杯"的字面意思；Archive 表示打包产物，与容器那个 Package 区分开。 -->
          <Coffee v-else-if="row.entry.path === SDK_ENTRY_PATH" :size="iconSize.toolbar" class="synthetic-icon" />
          <Archive v-else-if="isSyntheticLibraryRow(row.entry.path)" :size="iconSize.toolbar" class="synthetic-icon" />
          <Folder v-else-if="row.entry.kind === 'directory'" :size="iconSize.toolbar" class="folder-icon" />
          <FileCode2 v-else-if="/\.(java|kt|cpp|hpp|c|h|ts|js|vue)$/.test(row.entry.name)" :size="iconSize.toolbar" class="code-icon" />
          <FileText v-else :size="iconSize.toolbar" class="muted" />
          <span class="tree-name">{{ row.entry.name }}</span><span v-if="loading.has(row.entry.path)">…</span>
        </button>
        <div v-if="expanded.has(row.entry.path) && (row.synthetic ? row.synthetic.entries.length === 0 : row.entry.path === '' && projectName !== undefined && !depth ? entries.length === 0 : model.children.get(row.entry.path)?.length === 0)" class="empty-folder" :style="indentStyle(row.level + 1)">{{ row.synthetic ? '（空）' : '空目录' }}</div>
      </li>
    </ul>
  </div>
</template>

<style scoped>
.tree-synthetic { color: var(--secondary); font-style: italic; }
.synthetic-icon { color: var(--syntax-meta); flex-shrink: 0; }
.tree-expander { display: inline-flex; flex-shrink: 0; }
.tree-entry:not(.selected):not(:hover) { background-color: var(--tree-file-color, transparent); }
.tree-empty { margin: 0; padding: var(--space-3); color: var(--muted); font-size: 11px; line-height: 1.7; }
</style>
