<script setup lang="ts">
// 文件/目录选择对话框 —— `pf/file-chooser` 族的上游 `FileChooserDialog` / `FileChooserDialogFactory`
// 在本仓的等价物（宿主那条 Win32 `IFileDialog` 之外的**应用内**那一半）。
//
// 为什么需要它：宿主 `dialog.pickFile` / `dialog.pickDirectory`（`native/dialogs.cpp`）是一次
// 落盘的系统调用，**没有**上游对话框给用户的那些东西：工作区内的树导航、最近文件、收藏位置、
// 文件名输入框、新建目录、显示隐藏文件、刷新。判词把这一族点名成「能实打实做的一大块」，这里落它。
//
// 规则全在 `src/fileChooserModel.ts`（懒加载树 `visibleChooserRows`、排序、文件名输入、
// 新建目录校验 `newFolderPlan`、覆盖确认）与 `src/fileChooserDescriptor.ts`（描述件：可见性、
// 可选性、过滤），本组件只负责画与派发。
//
// 布局照上游（`universal/UniversalFileChooser.kt:252` `createTopToolbar` + `:304` 左栏 Locations
//  splitter + `ex/FileChooserDialogImpl.java:206` 那棵 `JTree`）：左边「快捷位置」（最近 + 收藏），
// 中间目录树，上面一条工具栏，右下文件名输入 + 视图切换 + 确定/取消。
// 工具栏的动作与上游一一对上：
//   · 新建目录 —— `actions/NewFolderAction.java:96-110` / `UniversalFileChooser.kt:408-440`
//     （本仓用 `file.create` + `directory: true`，`native/main.cpp:985-989`）；
//   · 显示隐藏文件 —— `actions/ToggleVisibilityAction.java:23-32`（`showHiddens(state)`）；
//   · 刷新 —— `actions/RefreshFileChooserAction.java:26-27`；
//   · 上一级 / 项目根 —— `actions/GoToParentDirectoryAction.java:16-20` 与 `GotoProjectDirAction`
//     （面包屑第一行「工作区」就是那个「项目根」；**没有**「上一级盘符」，因为树根本就不是工作区）。
//
// **诚实边界**（不要在报告里被当成漏抄）：
//   · 「Home / Desktop」两个快捷位置（`UniversalFileChooser.kt:350-380`）画不了：宿主
//     `workspace.list` 只能列工作区之内（`native/workspace.cpp` 的 `Workspace::list` 走 pin 过的根），
//     工作区外的目录内容本仓拿不到 —— 造一行点了列不出东西的按钮就是假控件。
//     走法：这类路径由 `outside` 事件转交宿主原生对话框。
//   · 归档内部条目（jar/zip 展开，`FileTreeModel.java:303-310` 的 `isChooseJarContents` 那一支）
//     没有通道：`bridge.ts` 的 `Method` 里没有「列归档内容」，所以展开只会得到「列不出」。
import { computed, nextTick, ref, watch } from 'vue'
import {
  Archive, ChevronDown, ChevronRight, Eye, FileText, Folder, FolderOpen, FolderPlus, RefreshCw, Search,
} from 'lucide-vue-next'
import {
  favoriteShortcuts, isNodeSelectable, newFolderPlan, nodeSelectableReason, recentShortcuts,
  resolveTypedName, shortcutNavigation, visibleChooserRows,
  type ChooserShortcut, type ChooserListing, type ChooserNode, type ChooserRow, type ChooserViewMode,
} from '../fileChooserModel'
import { withShowHiddenFiles, type FileChooserDescriptor } from '../fileChooserDescriptor'
import { request } from '../bridge'
import { iconSize } from '../uiIcons'

const props = defineProps<{
  descriptor: FileChooserDescriptor
  /** 工作区根（相对路径那一层的锚点；工作区本身是 `''`）。 */
  root?: string
  recent?: readonly string[]
  favorites?: readonly string[]
}>()
const emit = defineEmits<{
  (event: 'pick', path: string): void
  /** 用户点了工作区外的条目 / 「用系统对话框…」——调用方转交宿主原生对话框。 */
  (event: 'outside', path: string): void
  (event: 'close'): void
}>()

/** 当前目录（相对工作区根；`''` 是工作区本身）。文件名输入与「新建目录」都以它为父。 */
const currentPath = ref('')
/** 目录清单：只存已经列过的那几层（上游 `FileTreeModel.java:303-310` 的孩子就是懒加载的）。 */
const listings = ref<Record<string, ChooserListing | null>>({})
/** 展开中的目录（`FileChooserDialogImpl.java:465` `FileTreeExpansionListener` 的那个状态）。 */
const expanded = ref<string[]>([])
const viewMode = ref<ChooserViewMode>('tree')
/** 「显示隐藏文件」（`ToggleVisibilityAction.java:29-31`；默认取描述件给的那一档）。 */
const showHidden = ref(props.descriptor.showHiddenFiles)
const typedName = ref('')
const picking = ref('')
const loading = ref(false)
const creating = ref(false)
const draftName = ref('')
const draftProblem = ref('')
const listRef = ref<HTMLElement>()
const nameRef = ref<HTMLInputElement>()
const draftRef = ref<HTMLInputElement>()

/** 描述件 + 那个「显示隐藏文件」开关 ⇒ 真正用于渲染的判定件。 */
const chooser = computed(() => withShowHiddenFiles(props.descriptor, showHidden.value))

/** 树根：树形模式从工作区根往下嵌套，列表模式只看当前这一层。 */
const treeRoot = computed(() => (viewMode.value === 'tree' ? '' : currentPath.value))

// 列不出来时给 null（老宿主没有这条通道 / 路径不存在），**不编目录内容**。
async function listDirectory(path: string): Promise<ChooserListing | null> {
  if (path in listings.value) return listings.value[path]
  try {
    const entries = await request<ChooserListing['entries']>('workspace.list', { path })
    const listing = { entries: entries ?? [] }
    listings.value = { ...listings.value, [path]: listing }
    return listing
  } catch {
    listings.value = { ...listings.value, [path]: null }
    return null
  }
}

/** 展开一个目录（先保证有清单，`FileChooserDialogImpl.java:471` 展开时才取孩子）。 */
async function expand(path: string) {
  if (!expanded.value.includes(path)) expanded.value = [...expanded.value, path]
  if (!(path in listings.value)) { loading.value = true; await listDirectory(path); loading.value = false }
}

function collapse(path: string) {
  expanded.value = expanded.value.filter(entry => entry !== path)
}

async function openDirectory(path: string) {
  currentPath.value = path
  await expand(path)
}

/**
 * 快捷条（左侧「最近 / 收藏」）那一行的落点。目录就是进那一层；**文件不能当目录列**
 * —— 上游点它是在树里选中这个文件（`ex/FileChooserDialogImpl.java:178-183` 的
 * `restoreSelection` → `selectInTree(new VirtualFile[]{file}, ...)`），规则在
 * `shortcutNavigation`（`src/fileChooserModel.ts`）。
 */
async function openShortcut(shortcut: ChooserShortcut) {
  const target = shortcutNavigation(shortcut)
  currentPath.value = target.path
  if (!target.select) { await expand(target.path); return }
  // 懒加载的树：祖先没列过就没有那一行 ⇒ 从工作区根往下逐层展开（`expand` 自带去重）。
  for (const ancestor of target.expand) await expand(ancestor)
  picking.value = target.select
}

/** 要画的那些行（规则与懒加载折算都在 `visibleChooserRows`）。 */
const rows = computed(() =>
  visibleChooserRows(chooser.value, treeRoot.value, listings.value, expanded.value, { mode: viewMode.value, directoriesFirst: true }))

/** 当前选中的那一行（`picking` 存的是路径，行可能被折叠掉 ⇒ 找不到就退回 null）。 */
const selectedRow = computed(() => rows.value.find(row => row.node.path === picking.value) ?? null)

const shortcuts = computed(() => ({
  recent: recentShortcuts(props.recent ?? []),
  favorites: favoriteShortcuts(props.favorites ?? []),
}))

/** 面包屑（上游对话框顶部那一行路径；第一段是「项目根」= `GotoProjectDirAction`）。 */
const crumbs = computed(() => {
  const parts = currentPath.value ? currentPath.value.split('/') : []
  return [{ label: '工作区', path: '' }, ...parts.map((part, index) => ({ label: part, path: parts.slice(0, index + 1).join('/') }))]
})

/** 文件名输入的判定（`resolveTypedName`）；没输入时按「当前选中项」走。 */
const typed = computed(() => resolveTypedName(chooser.value, currentPath.value, typedName.value))
const confirmProblem = computed(() => {
  if (!typedName.value.trim()) return ''
  return typed.value.selectable ? '' : typed.value.problem
})

/** 「新建目录」那一行的判定（`newFolderPlan` 的 `error` / `warning` 直给）。 */
const draft = computed(() => newFolderPlan(currentPath.value, draftName.value, listings.value[currentPath.value] ?? null))

function canPick(node: ChooserNode): boolean { return isNodeSelectable(chooser.value, node) }
function reasonOf(node: ChooserNode): string { return nodeSelectableReason(chooser.value, node) }

/** 单击：选中；选中目录时把它设为当前目录（文件名输入与新建目录跟着走）。 */
async function selectRow(row: ChooserRow) {
  picking.value = row.node.path
  if (row.node.kind === 'directory') currentPath.value = row.node.path
}

/** 展开/折叠那个箭头（叶子没有箭头，`isChooserLeaf` 判的）。 */
async function toggleRow(row: ChooserRow) {
  if (row.leaf) return
  if (row.expanded) { collapse(row.node.path); return }
  await expand(row.node.path)
}

async function activateRow(row: ChooserRow) {
  if (row.node.outside) { emit('outside', row.node.path); return }
  if (row.node.kind === 'directory') {
    if (canPick(row.node)) { emit('pick', row.node.path); return }
    await toggleRow(row)
    return
  }
  if (!canPick(row.node)) { picking.value = row.node.path; return }
  emit('pick', row.node.path)
}

function pickTyped() {
  if (!typed.value.selectable) { picking.value = typed.value.path; return }
  emit('pick', typed.value.path)
}

/** 回车 = 确认当前行（没有当前行时按文件名输入框走）。上游那一棵树就是「回车选中」。 */
function acceptRow(row: ChooserRow | null) {
  if (!row) { pickTyped(); return }
  if (row.node.kind === 'file' && canPick(row.node) && !typedName.value.trim()) { emit('pick', row.node.path); return }
  if (row.node.kind === 'directory' && canPick(row.node) && !typedName.value.trim()) { emit('pick', row.node.path); return }
  pickTyped()
}

/** 「新建目录」：`file.create` + `directory: true`（`native/main.cpp:985-989`），成功后刷新父目录并选中新目录。 */
async function createFolder() {
  const plan = draft.value
  if (!plan.creatable) { draftProblem.value = plan.error; return }
  draftProblem.value = plan.warning
  try {
    await request('file.create', { path: plan.path, directory: true })
  } catch (error) {
    // 上游那句「Could not create folder ''{0}''」（UIBundle.properties:153）
    draftProblem.value = error instanceof Error && error.message
      ? error.message : `建不出「${plan.segments.join('/')}」这个目录。`
    return
  }
  await refresh()
  creating.value = false
  draftName.value = ''
  draftProblem.value = ''
  currentPath.value = plan.path
  picking.value = plan.path
  await expand(plan.path)
  void nextTick(() => nameRef.value?.focus())
}

/** 刷新：把已缓存的清单全部丢掉，再按展开状态重列（`RefreshFileChooserAction.java:26-27`）。 */
async function refresh() {
  listings.value = {}
  loading.value = true
  for (const path of ['', ...expanded.value]) await listDirectory(path)
  loading.value = false
}

function moveSelection(delta: number) {
  const list = rows.value
  if (!list.length) return
  const at = list.findIndex(row => row.node.path === picking.value)
  const next = at < 0 ? (delta > 0 ? 0 : list.length - 1) : Math.min(list.length - 1, Math.max(0, at + delta))
  void selectRow(list[next]!)
}

/** 键盘走树：↑↓ 移动、→ 展开、← 折叠或回父目录、Enter 确认、Esc 关闭。 */
async function onKeydown(event: KeyboardEvent) {
  if (event.key === 'Escape') { event.preventDefault(); emit('close'); return }
  if (event.target instanceof HTMLInputElement && event.key === 'Enter') {
    event.preventDefault()
    if (event.target === draftRef.value) await createFolder()
    else pickTyped()
    return
  }
  const row = selectedRow.value
  switch (event.key) {
    case 'ArrowDown': event.preventDefault(); moveSelection(1); return
    case 'ArrowUp': event.preventDefault(); moveSelection(-1); return
    case 'ArrowRight':
      event.preventDefault()
      if (row && !row.leaf && !row.expanded) await expand(row.node.path)
      return
    case 'ArrowLeft':
      event.preventDefault()
      if (row && row.expanded) { collapse(row.node.path); return }
      if (row && row.depth > 0) {
        const parent = row.node.path.slice(0, row.node.path.lastIndexOf('/'))
        picking.value = parent
        currentPath.value = parent
      }
      return
    case 'Enter': event.preventDefault(); acceptRow(row); return
    default:
  }
}

watch(() => props.descriptor, () => {
  currentPath.value = ''
  typedName.value = ''
  expanded.value = []
  listings.value = {}
  showHidden.value = props.descriptor.showHiddenFiles
  creating.value = false
  draftName.value = ''
  draftProblem.value = ''
  void listDirectory('')
  void expand('')
}, { immediate: true })

// 打开时焦点落在文件名输入框（上游 `FileChooserDialog` 的默认焦点）。
void nextTick(() => nameRef.value?.focus())
</script>

<template>
  <div class="modal-backdrop" @click.self="emit('close')">
    <section class="help-dialog chooser-dialog" role="dialog" aria-modal="true" aria-labelledby="chooser-title">
      <header class="chooser-head">
        <h2 id="chooser-title">{{ descriptor.title }}</h2>
        <span class="chooser-desc">{{ descriptor.description || '在左侧选位置，中间选条目，底部输入文件名。' }}</span>
      </header>

      <nav class="chooser-crumbs" aria-label="当前位置">
        <template v-for="(crumb, index) in crumbs" :key="crumb.path">
          <ChevronRight v-if="index" :size="iconSize.menu" aria-hidden="true" class="chooser-crumb-sep" />
          <button type="button" class="chooser-crumb" :class="{ on: crumb.path === currentPath }" @click="openDirectory(crumb.path)">{{ crumb.label }}</button>
        </template>
      </nav>

      <div class="chooser-body">
        <aside class="chooser-side" aria-label="快捷位置">
          <section v-if="shortcuts.recent.length" class="chooser-side-group">
            <h3>最近</h3>
            <ul>
              <li v-for="row in shortcuts.recent" :key="`recent-${row.path}`">
                <button type="button" class="chooser-shortcut" @click="openShortcut(row)">
                  <FileText :size="iconSize.menu" aria-hidden="true" /> {{ row.label }}
                </button>
              </li>
            </ul>
          </section>
          <section v-if="shortcuts.favorites.length" class="chooser-side-group">
            <h3>收藏</h3>
            <ul>
              <li v-for="row in shortcuts.favorites" :key="`fav-${row.path}`">
                <button type="button" class="chooser-shortcut" @click="openShortcut(row)">
                  <Folder :size="iconSize.menu" aria-hidden="true" /> {{ row.label }}
                </button>
              </li>
            </ul>
          </section>
          <p v-if="!shortcuts.recent.length && !shortcuts.favorites.length" class="chooser-side-empty">还没有最近位置或收藏。</p>
        </aside>

        <div class="chooser-main">
          <div class="chooser-toolbar" role="toolbar" aria-label="位置工具栏">
            <button type="button" class="chooser-tool" :aria-expanded="creating" @click="creating = !creating; draftProblem = ''">
              <FolderPlus :size="iconSize.menu" aria-hidden="true" />新建目录
            </button>
            <button type="button" class="chooser-tool" title="刷新当前目录（RefreshFileChooserAction）" @click="refresh">
              <RefreshCw :size="iconSize.menu" aria-hidden="true" />刷新
            </button>
            <button type="button" class="chooser-tool" :aria-pressed="showHidden" title="切换隐藏文件的显示（ToggleVisibilityAction）" @click="showHidden = !showHidden">
              <Eye :size="iconSize.menu" aria-hidden="true" />显示隐藏文件
            </button>
            <span v-if="loading" class="chooser-tool-state">正在列出…</span>
          </div>

          <div v-if="creating" class="chooser-newdir">
            <input ref="draftRef" v-model="draftName" type="text" aria-label="新目录名（多级用 / 分隔）"
                   :aria-invalid="Boolean(draftProblem && !draft.creatable)" placeholder="Enter a new folder name:" />
            <button type="button" class="primary-button" :disabled="!draft.creatable" @click="createFolder">创建</button>
            <button type="button" class="subtle-button" @click="creating = false; draftName = ''; draftProblem = ''">取消</button>
            <p v-if="draft.error" class="chooser-problem" role="alert">{{ draft.error }}</p>
            <p v-else-if="draft.warning" class="chooser-warning">{{ draft.warning }}</p>
            <p v-else-if="draftProblem" class="chooser-warning">{{ draftProblem }}</p>
          </div>

          <div ref="listRef" class="chooser-list" role="tree" :aria-label="currentPath || '工作区根'" tabindex="0" @keydown="onKeydown">
            <p v-if="loading && !rows.length" class="chooser-list-empty">正在列出…</p>
            <p v-else-if="!rows.length" class="chooser-list-empty">这里没有可显示的条目。</p>
            <ul v-else>
              <li v-for="row in rows" :key="row.node.path" role="none">
                <div class="chooser-row-line" :style="{ paddingLeft: `calc(${row.depth} * var(--space-4))` }">
                  <button type="button" class="chooser-caret" :tabindex="-1" :aria-hidden="row.leaf ? 'true' : undefined"
                          :disabled="row.leaf" @click="toggleRow(row)">
                    <ChevronDown v-if="row.expanded" :size="iconSize.menu" />
                    <ChevronRight v-else :size="iconSize.menu" />
                  </button>
                  <button type="button" class="chooser-row" role="treeitem" :aria-selected="picking === row.node.path"
                          :aria-level="row.depth + 1" :aria-expanded="row.leaf ? undefined : row.expanded"
                          :aria-disabled="!canPick(row.node)" :title="reasonOf(row.node)" :class="{ off: !canPick(row.node) }"
                          @click="selectRow(row)" @dblclick="activateRow(row)">
                    <span class="chooser-row-icon" aria-hidden="true">
                      <FolderOpen v-if="row.node.kind === 'directory'" :size="iconSize.toolbar" />
                      <Archive v-else-if="row.node.archive" :size="iconSize.toolbar" />
                      <FileText v-else :size="iconSize.toolbar" />
                    </span>
                    <span class="chooser-row-name">{{ row.node.name }}</span>
                    <span v-if="row.unlisted" class="chooser-row-note">列不出内容</span>
                    <span v-else-if="row.node.kind === 'directory' && !canPick(row.node)" class="chooser-row-note">进入</span>
                  </button>
                </div>
              </li>
            </ul>
          </div>
        </div>
      </div>

      <footer class="chooser-foot">
        <label class="chooser-name">
          <span>文件名</span>
          <input ref="nameRef" v-model="typedName" type="text" :aria-label="`${descriptor.title}的文件名`"
                 :aria-invalid="Boolean(confirmProblem)" @keydown.enter="pickTyped" />
        </label>
        <div class="chooser-view" role="group" aria-label="视图模式">
          <button type="button" class="chooser-view-btn" :class="{ on: viewMode === 'tree' }" :aria-pressed="viewMode === 'tree'"
                  :title="viewMode === 'tree' ? '当前：树形（展开的目录就地嵌套）' : '切到树形（展开的目录就地嵌套）'" @click="viewMode = 'tree'">
            <Folder :size="iconSize.menu" aria-hidden="true" />树形
          </button>
          <button type="button" class="chooser-view-btn" :class="{ on: viewMode === 'list' }" :aria-pressed="viewMode === 'list'"
                  :title="viewMode === 'list' ? '当前：列表（只看当前这一层）' : '切到列表（只看当前这一层）'" @click="viewMode = 'list'">
            <Search :size="iconSize.menu" aria-hidden="true" />列表
          </button>
        </div>
        <p v-if="confirmProblem" class="chooser-problem" role="alert">{{ confirmProblem }}</p>
        <div class="chooser-actions">
          <button type="button" class="subtle-button" @click="emit('close')">取消</button>
          <button type="button" class="primary-button" :disabled="Boolean(confirmProblem)" @click="pickTyped">确定</button>
        </div>
      </footer>
    </section>
  </div>
</template>

<style scoped>
.chooser-dialog { width: min(880px, 94vw); }
.chooser-head { display: flex; align-items: baseline; gap: var(--space-2); }
.chooser-head h2 { margin: 0; }
.chooser-desc { color: var(--muted); font-size: 11px; }
.chooser-crumbs { display: flex; align-items: center; gap: 2px; flex-wrap: wrap; margin: var(--space-2) 0; font-size: 12px; }
.chooser-crumb { padding: 2px 4px; border: 0; border-radius: var(--radius-sm); background: transparent; color: var(--secondary); font-size: 12px; }
.chooser-crumb:hover { background: var(--hover); color: var(--bright); }
.chooser-crumb.on { color: var(--bright); font-weight: 600; }
.chooser-crumb-sep { color: var(--muted); }
.chooser-body { display: grid; grid-template-columns: 180px minmax(0, 1fr); gap: var(--space-3); min-height: 260px; }
.chooser-side { overflow: auto; padding-right: var(--space-2); border-right: 1px solid var(--line); }
.chooser-side-group h3 { margin: 0 0 var(--space-1); color: var(--secondary); font-size: 11px; font-weight: 600; }
.chooser-side-group ul { margin: 0 0 var(--space-2); padding: 0; list-style: none; }
.chooser-shortcut { display: flex; align-items: center; gap: 4px; width: 100%; padding: 3px 4px; border: 0; border-radius: var(--radius-sm); background: transparent; color: var(--secondary); font-size: 12px; text-align: left; }
.chooser-shortcut:hover { background: var(--hover); color: var(--bright); }
.chooser-side-empty { color: var(--muted); font-size: 11px; }
.chooser-main { display: flex; flex-direction: column; gap: var(--space-2); min-width: 0; }
.chooser-toolbar { display: flex; align-items: center; gap: var(--space-1); }
.chooser-tool { display: inline-flex; align-items: center; gap: 4px; padding: 3px var(--space-2); border: 1px solid transparent; border-radius: var(--radius-sm); background: transparent; color: var(--secondary); font-size: 11px; }
.chooser-tool:hover { background: var(--hover); color: var(--bright); }
.chooser-tool[aria-pressed='true'], .chooser-tool[aria-expanded='true'] { border-color: var(--line-strong); background: var(--selected); color: var(--bright); }
.chooser-tool svg { flex-shrink: 0; }
.chooser-tool-state { color: var(--muted); font-size: 11px; }
.chooser-newdir { display: flex; align-items: center; gap: var(--space-2); }
.chooser-newdir input { flex: 1; min-width: 0; padding: 4px var(--space-2); border: 1px solid var(--line-strong); border-radius: var(--radius-sm); background: var(--editor); color: var(--bright); font-size: 12px; }
.chooser-newdir input[aria-invalid='true'] { border-color: var(--warning); }
.chooser-list { min-height: 0; overflow: auto; }
.chooser-list ul { margin: 0; padding: 0; list-style: none; }
.chooser-row-line { display: flex; align-items: center; gap: 2px; }
.chooser-caret { display: inline-flex; align-items: center; justify-content: center; width: 16px; padding: 0; border: 0; border-radius: var(--radius-sm); background: transparent; color: var(--muted); }
.chooser-caret:disabled { visibility: hidden; }
.chooser-row { display: flex; align-items: center; gap: var(--space-2); flex: 1; min-width: 0; padding: 4px var(--space-2); border: 1px solid transparent; border-radius: var(--radius-sm); background: transparent; color: var(--bright); font-size: 12px; text-align: left; }
.chooser-row:hover { border-color: var(--line-strong); }
.chooser-row[aria-selected='true'] { border-color: var(--accent); background: var(--selected); }
.chooser-row.off { color: var(--muted); }
.chooser-row-icon { display: inline-flex; flex-shrink: 0; }
.chooser-row-name { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.chooser-row-note { flex-shrink: 0; color: var(--muted); font-size: 10px; }
.chooser-list-empty, .chooser-list-hint { color: var(--muted); font-size: 12px; }
.chooser-foot { display: flex; align-items: center; gap: var(--space-2); flex-wrap: wrap; margin-top: var(--space-3); }
.chooser-name { display: flex; align-items: center; gap: var(--space-2); flex: 1; min-width: 0; color: var(--secondary); font-size: 12px; }
.chooser-name input { flex: 1; min-width: 0; padding: 4px var(--space-2); border: 1px solid var(--line-strong); border-radius: var(--radius-sm); background: var(--editor); color: var(--bright); font-size: 12px; }
.chooser-name input[aria-invalid='true'] { border-color: var(--warning); }
.chooser-view { display: flex; gap: var(--space-1); }
.chooser-view-btn { display: inline-flex; align-items: center; gap: 4px; padding: 3px var(--space-2); border: 1px solid transparent; border-radius: var(--radius-sm); background: transparent; color: var(--secondary); font-size: 11px; }
.chooser-view-btn.on { border-color: var(--line-strong); background: var(--selected); color: var(--bright); }
.chooser-problem { flex-basis: 100%; margin: 0; color: var(--warning); font-size: 11px; }
.chooser-warning { flex-basis: 100%; margin: 0; color: var(--secondary); font-size: 11px; }
.chooser-actions { display: flex; gap: var(--space-2); }
</style>
