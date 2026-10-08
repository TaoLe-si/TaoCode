<script setup lang="ts">
// 引用（IDEA 的 Find 窗口里那条用法视图 Content）的**内容组件**。
//
// 为什么现在才有这一份：行模型（`src/usageViewGrouping.ts` 的 `UsageTreeRow`）与它的宿主状态
// （`src/referenceContents.ts` 的 `referenceRows` / `toggleUsageGroup` / 展开折叠 / 速度搜索串）
// 上一轮就做完了，但工具窗口宿主 `ToolWindowView.vue` 的视图链里**没有 `references` 这一支**，
// 于是那一棵分组树没有渲染点，界面上仍是 `src/App.vue` 里那张平表。
// 本组件补的就是那个渲染点：行、折叠态、过滤串都从 props 进来，动作往上抛；当前行选择留在面板内。
//
// 上游对照（本机参考树，逐行开过）：
//   · 一条 Content = 一个用法视图组件：`platform/usageView-impl/src/com/intellij/usages/impl/UsageViewImpl.java:1651-1654`
//     （`getComponent()` 交出去的就是那个根面板），挂进 Content 由
//     `platform/usageView-impl/src/com/intellij/usages/impl/UsageViewManagerImpl.java:145-163` 做
//     （`addContent(...)` → `((UsageViewImpl)usageView).setContent(content)`，同一文件 `:1667-1670`）。
//   · 工具条上那两条展开/折叠：`UsageViewImpl.java:1081-1082`
//     （`createExpandAllAction` / `createCollapseAllAction`，工具条本体是 `:989` 的 `createActionsToolbar()`）。
//   · 速度搜索取的是节点的 **plain text**：`UsageViewImpl.java:977-985`
//     （`installTreeSpeedSearch(…, getPlainTextForNode)`）。本仓这一档是**过滤**而不是跳转，
//     差异与理由写在 `src/usageViewGrouping.ts` 的 `filterUsageTree` 头上，这里只接它筛出来的行。
//   · 组行的计数 = `usage.view.counter`（`platform/usageView/resources/messages/UsageViewBundle.properties:131`），
//     叶子的位置文本 = 1 基 `行:列`（本仓 `usagePositionText`）。
//   · 空结果的文案 = `usages.n` 的 `0#no usages` 那一档（同文件 `:8`），走 `usagesFoundText(0)`。
//   · 「正在查找…」这一行：标签条上早就这么写了（`src/App.vue` 的引用标签 `tab.searching ? '正在查找…'`），
//     上游那条 Content 在搜索期间确实在（`platform/lang-impl/src/com/intellij/usageView/impl/UsageViewContentManagerImpl.java:152`
//     把组件交进去挂着，靠 `UsageView.isSearchInProgress()`（同文件 `:170-172`）免于被下一次搜索顶替），
//     所以这不是本仓自造的形态。
//
// 样式：`.ref-list / .ref-item / .ref-path / .ref-pos / .ref-empty` 用 `src/style.css:1155-1160` 那五条
// 既有全局规则（与平表时代**同一个外观**，也不留孤儿 CSS）；只给新出现的行结构（缩进、折叠箭头、工具条）
// 写 scoped 样式。原接线请求（`docs/wiring-requests-2026-10-06-hier3.md` §3）让复用 `.outline-filter`，
// 实际那一类是 `OutlinePanel.vue` 的 **scoped** 类、跨组件不生效 ⇒ 这里自带 `.ref-search`。
//
// 「导出到文本文件」（本批新加的那一格）：
//   · 上游 = `platform/usageView-impl/src/com/intellij/usages/impl/ExporterToTextFile.java`（形状），
//     挂在 `UsageViewImpl.java:2260` 递出的 `PlatformDataKeys.EXPORTER_TO_TEXT_FILE` 上，
//     由 `platform/platform-impl/src/com/intellij/ide/actions/ExportToTextFileAction.java:17-25` 触发，
//     落盘走 `platform/platform-impl/src/com/intellij/ide/util/ExportToFileUtil.java:58-102`（保存对话框 + 写文件），
//     可用与否 = 同文件 `:93-96` 的 `canExport`（还在搜 / target 失效就不给按）；
//   · 本仓的文本规则在 `src/usageViewExport.ts`（吃行模型那一列行），状态在 `src/referenceContents.ts`；
//   · **落盘用的是既有宿主通道** `dialog.saveFile` + `app.writeExportFiles`（`.txt` 在放行清单里，
//     `native/export_file.hpp:29`），与 `src/components/ProblemsPanel.vue:543-558` 那条文本导出同一形状 ——
//     本组件其余动作仍走 props/emit（不持状态），只有这一条自己落盘：`ToolWindowViewContext` 里没有
//     导出这一栏，而 `src/App.vue` 与 `src/menus/**` 都动不了，绕开这两条就只能画一个存不了文件的按钮（假控件）。
import { computed, ref, shallowRef, watch } from 'vue'
import { ChevronDown, ChevronRight, ChevronsDownUp, ChevronsUpDown, Download, FileCode2 } from 'lucide-vue-next'
import { usagesFoundText, type UsageTreeRow } from '../usageViewGrouping.ts'
// 面板真正渲染的是「行 + 稳定 id + 层」那一列（`src/usageViewTreeModel.ts:195` 的 `UsageTreeModelRow`，
// `src/referenceContents.ts` 的 `referenceRows` 已在生产链路上贴好 id）：`:key` 用内容派生 id，
// 任何一行增删/重排都不重挂后面整列 DOM（上游 GroupNode.java:99-114 插入后不重挂已有行）。
import type { UsageTreeModelRow } from '../usageViewTreeModel.ts'
import { usageExportLeaves, usageExportSavedNote } from '../usageViewExport.ts'
import { request } from '../bridge.ts'
import {
  exportReferencesText, referenceExportHeader, referenceExportRows,
  rememberUsageExportPath, usageExportAllowed, usageExportSuggestedFileName,
} from '../referenceContents.ts'
import { iconSize } from '../uiIcons'

const props = defineProps<{
  /** 当前选中那条内容的行（`src/referenceContents.ts` 的 `referenceRows`：已摊平、已按折叠态与过滤串筛过，每行带稳定 id）。 */
  rows: readonly UsageTreeModelRow[]
  /** 那条内容的引用总条数（Content 的 payload 长度）—— 用来区分「真的没有用法」与「过滤串一条都不剩」。 */
  count: number
  /** 面板的过滤串（`referencesSpeedSearch`）。 */
  query: string
  /** `UsageView.isSearchInProgress()`：还在搜的时候行是空的，那时要说的是「正在查找」。 */
  searching: boolean
  /** `UsageViewSettings.isAutoScrollToSource`：选择引用时导航到源位置。 */
  navigateOnSingleClick: boolean
}>()

const emit = defineEmits<{
  /** 导航到引用位置（行 0 基、列给编辑器要的 1 基）。 */
  open: [target: { path: string; line: number; column: number }]
  /** 组行的折叠开关（折叠集按内容 id 分档，住在 `src/referenceContents.ts`）。 */
  'toggle-group': [key: string]
  'collapse-all': []
  'expand-all': []
  'speed-search': [value: string]
}>()

const selectedRowId = shallowRef<string | null>(null)
const rowElements = new Map<string, HTMLElement>()

watch(() => props.rows, (rows, previousRows) => {
  if (rows.some(row => row.id === selectedRowId.value)) return
  const previous = previousRows ?? []
  const previousIndex = previous.findIndex(row => row.id === selectedRowId.value)
  const selected = previous[previousIndex]
  const parent = selected && previous.slice(0, previousIndex).reverse().find(row => row.depth < selected.depth)
  selectedRowId.value = rows.find(row => row.id === parent?.id)?.id ?? rows[0]?.id ?? null
}, { immediate: true })

function bindRowElement(id: string, element: unknown) {
  if (typeof HTMLElement !== 'undefined' && element instanceof HTMLElement) rowElements.set(id, element)
  else rowElements.delete(id)
}

function openUsage(row: UsageTreeRow) {
  if (row.kind === 'usage') emit('open', { path: row.path, line: row.line, column: row.character + 1 })
}

function selectRow(row: UsageTreeModelRow) {
  selectedRowId.value = row.id
  if (props.navigateOnSingleClick) openUsage(row)
}

function onRowClick(event: MouseEvent, row: UsageTreeModelRow) {
  selectedRowId.value = row.id
  rowElements.get(row.id)?.focus()
  if (event.detail === 1 && props.navigateOnSingleClick) openUsage(row)
}

function onRowDoubleClick(row: UsageTreeRow) {
  if (row.kind === 'usage') {
    if (!props.navigateOnSingleClick) openUsage(row)
  } else if (row.collapsible) {
    emit('toggle-group', row.key)
  }
}

function focusRow(row: UsageTreeModelRow) {
  selectRow(row)
  rowElements.get(row.id)?.focus()
}

function onRowKeydown(event: KeyboardEvent, row: UsageTreeModelRow) {
  const index = props.rows.findIndex(candidate => candidate.id === row.id)
  if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
    event.preventDefault()
    const next = props.rows[index + (event.key === 'ArrowDown' ? 1 : -1)]
    if (next) focusRow(next)
    return
  }
  if (event.key === 'ArrowLeft') {
    if (row.collapsible && !row.collapsed) {
      event.preventDefault()
      emit('toggle-group', row.key)
      return
    }
    const parent = props.rows.slice(0, index).reverse().find(candidate => candidate.depth < row.depth)
    if (parent) {
      event.preventDefault()
      focusRow(parent)
    }
    return
  }
  if (event.key === 'ArrowRight') {
    if (row.collapsible && row.collapsed) {
      event.preventDefault()
      emit('toggle-group', row.key)
      return
    }
    const child = props.rows[index + 1]
    if (row.collapsible && child && child.depth > row.depth) {
      event.preventDefault()
      focusRow(child)
    }
    return
  }
  if (event.key === 'Enter' && row.kind === 'usage') {
    event.preventDefault()
    openUsage(row)
  }
}

// 空态的三档：还在搜 / 一条引用都没有 / 有引用但过滤串一条不剩。
// 第三档的文案是本仓自造的（上游的速度搜索是**跳转**不是过滤，压根没有"过滤后为空"这个形态），
// 前两档都有出处（见文件头）。
function emptyText(): string {
  if (props.searching) return '正在查找…'
  return props.count ? '没有匹配的引用。' : usagesFoundText(0)
}

// ——— 导出到文本文件 ———
//
// 可用判据 = `canExport`（`ExporterToTextFile.java:93-96`）那两格（还在搜 / 选中的那条内容没了）
// 再加上本仓既有工具条那一档 `!rows.length`（屏上一条都没有就别写一个只有标题的文件）。
// `props.searching` 是宿主给的当前态，`usageExportAllowed()` 里还有一格 store 的 `content.searching`
// 与「真正会被导出的那些行」—— 两头的条件都算上，取的是**更严**的那一个，不是随便叠两层。
const exporting = ref(false)
const exportNote = ref('')
const canExport = computed(() => usageExportAllowed() && !props.searching)

async function exportToFile() {
  if (!canExport.value || exporting.value) return
  exporting.value = true
  exportNote.value = ''
  try {
    const target = await request<string | null>('dialog.saveFile', {
      title: '导出用法到文本文件',
      filters: [{ name: '文本文件', pattern: '*.txt' }],
      name: usageExportSuggestedFileName(),
    })
    if (!target) { exportNote.value = '已取消，未写入文件'; return }
    await request('app.writeExportFiles', { files: [{ path: target, content: exportReferencesText(referenceExportHeader()) }] })
    // 写完才记名字 —— 上游也是这个次序（`ExportToFileUtil.java:65-66`：先 `exportTextToFile` 再 `exportedTo`）。
    rememberUsageExportPath(target)
    exportNote.value = usageExportSavedNote(target, usageExportLeaves(referenceExportRows.value).length)
  } catch (error) {
    exportNote.value = error instanceof Error ? error.message : String(error)
  } finally {
    exporting.value = false
  }
}
</script>

<template>
  <div class="reference-panel">
    <div class="ref-toolbar">
      <button class="icon-button" title="全部展开" aria-label="全部展开" :disabled="!rows.length" @click="emit('expand-all')"><ChevronsUpDown :size="iconSize.dense" /></button>
      <button class="icon-button" title="全部折叠" aria-label="全部折叠" :disabled="!rows.length" @click="emit('collapse-all')"><ChevronsDownUp :size="iconSize.dense" /></button>
      <input class="ref-search" :value="query" placeholder="过滤引用…" aria-label="过滤引用" spellcheck="false"
             @input="emit('speed-search', ($event.target as HTMLInputElement).value)" />
      <button class="icon-button" title="导出到文本文件" aria-label="导出到文本文件" :disabled="!canExport || exporting" @click="void exportToFile()">
        <Download :size="iconSize.dense" />
      </button>
    </div>
    <p v-if="exportNote" class="ref-note" role="status">{{ exportNote }}</p>
    <div class="ref-list" :role="rows.length ? 'tree' : undefined" :aria-label="rows.length ? '符号引用' : undefined">
      <p v-if="!rows.length" class="ref-empty" role="status">{{ emptyText() }}</p>
      <div v-for="row in rows" v-else :key="row.id" :ref="element => bindRowElement(row.id, element)" class="ref-row" role="treeitem"
           :aria-level="row.depth + 1" :aria-selected="selectedRowId === row.id" :aria-expanded="row.collapsible ? !row.collapsed : undefined"
           :tabindex="selectedRowId === row.id ? 0 : -1" :style="{ paddingLeft: `${row.depth * 12 + 6}px` }"
           @click="onRowClick($event, row)" @dblclick.prevent="onRowDoubleClick(row)" @keydown="onRowKeydown($event, row)">
        <span v-if="row.collapsible" class="ref-caret" aria-hidden="true" @click.stop="emit('toggle-group', row.key)">
          <ChevronRight v-if="row.collapsed" :size="iconSize.dense" /><ChevronDown v-else :size="iconSize.dense" />
        </span>
        <span v-else class="ref-caret ref-caret-empty" aria-hidden="true" />
        <span class="ref-item" :title="row.kind === 'usage' ? `${row.path}:${row.line + 1}:${row.character + 1}` : row.toggleLabel">
          <FileCode2 aria-hidden="true" v-if="row.kind === 'usage'" :size="iconSize.menu" />
          <span class="ref-path" :title="row.path">{{ row.label }}</span>
          <span v-if="row.detail" class="ref-pos">{{ row.detail }}</span>
        </span>
      </div>
    </div>
  </div>
</template>

<style scoped>
.reference-panel { display: flex; flex-direction: column; flex: 1; min-height: 0; min-width: 0; }
.ref-toolbar { display: flex; align-items: center; gap: var(--space-1); padding: var(--space-1) var(--space-3); border-bottom: 1px solid var(--line); }
.ref-search { flex: 1; min-width: 0; min-height: var(--ctrl-height-sm); padding: 2px var(--space-2); color: var(--text); background: var(--editor); border: 1px solid var(--line); border-radius: var(--radius-sm); font-size: 11px; }
.ref-search:focus-visible { outline: var(--focus-ring); outline-offset: var(--focus-ring-offset-inset); }
.ref-row { display: flex; align-items: center; gap: 2px; min-width: 0; }
.ref-row[aria-selected="true"] { background: var(--selected); color: var(--bright); }
.ref-row:focus-visible { outline: var(--focus-ring); outline-offset: var(--focus-ring-offset-inset); }
.ref-note { margin: 0; padding: 2px var(--space-3); color: var(--muted); font-size: 11px; }
.ref-row .ref-item { padding-left: 0; }
.ref-caret { display: inline-flex; align-items: center; justify-content: center; width: 14px; flex-shrink: 0; border: 0; padding: 0; background: transparent; color: var(--muted); cursor: pointer; }
.ref-caret:hover { color: var(--bright); }
.ref-caret-empty { cursor: default; }
</style>
