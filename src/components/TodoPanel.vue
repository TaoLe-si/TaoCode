<script setup lang="ts">
import { computed, reactive, ref, watch } from 'vue'
import { ArrowDown, ArrowUp, ChevronsDown, ChevronsUp, ChevronRight, Eye, FileCode2, Filter, Folder, Group, ListChecks, LocateFixed, RefreshCw } from 'lucide-vue-next'
import { isDesktop, request, type DocumentData, type SearchMatch, type SearchResult, type TodoPattern } from '../bridge'
import { buildTodoTree, flattenTodoRows, orderedItems, packageIds, type TodoItem, type TodoNode } from '../todoTree'

// IDEA's Todo tool window (platform/todo TodoPanel): a vertical toolbar with the
// occurrence walker, the marker filter, auto-scroll from source, expand/collapse, the
// Group By popup and the preview toggle; the tree itself is packages > files > items and
// a click selects (preview) while a double click jumps to source.
const props = defineProps<{ root: string; active: boolean; patterns: TodoPattern[]; source?: { path: string; line: number } | null }>()
const emit = defineEmits<{ open: [payload: { path: string; line: number }] }>()

const items = ref<TodoItem[]>([])
const running = ref(false)
const scanned = ref(false)
const error = ref('')
const showPackages = ref(true)
const flattenPackages = ref(false)
const autoScroll = ref(false)
const showPreview = ref(true)
const groupByOpen = ref(false)
// Empty means IDEA's "<All>" filter; otherwise the marker pattern to keep.
const filterPattern = ref('')
const expanded = reactive(new Set<string>())
const selected = ref<{ path: string; line: number } | null>(null)
const preview = ref<{ path: string; line: number; lines: string[]; start: number } | null>(null)

const badge = (preview: string) => props.patterns.find(pattern => markerMatches(preview, pattern.pattern))?.description ?? ''
// The scan queries the markers as a regex alternation (`\b(TODO|FIXME[:\s])\b`), so the
// badge and the filter have to test with the same semantics; a broken pattern falls back
// to a literal search instead of throwing on every row.
function markerMatches(text: string, pattern: string) {
  try { return new RegExp(`\\b(${pattern})\\b`, 'i').test(text) }
  catch { return text.toLowerCase().includes(pattern.toLowerCase()) }
}

const filtered = computed(() => filterPattern.value ? items.value.filter(item => markerMatches(item.text, filterPattern.value)) : items.value)
const tree = computed(() => buildTodoTree(filtered.value, { showPackages: showPackages.value, flattenPackages: flattenPackages.value }))
const rows = computed(() => flattenTodoRows(tree.value, expanded))
const occurrences = computed(() => orderedItems(tree.value))

async function scan() {
  if (!isDesktop || !props.root || running.value) return
  running.value = true
  error.value = ''
  try {
    const markers = props.patterns.map(pattern => pattern.pattern).join('|') || 'TODO'
    const result = await request<SearchResult>('search.run', { query: `\\b(${markers})\\b`, regex: true, caseSensitive: false, wholeWord: false, include: '', exclude: '' })
    items.value = result.matches.map((match: SearchMatch) => ({
      path: match.path, line: match.line, text: match.preview.trim(), kind: badge(match.preview) }))
    scanned.value = true
    // A fresh scan replaces the tree, so start from IDEA's fully-expanded view.
    expanded.clear()
    for (const id of packageIds(tree.value)) expanded.add(id)
  } catch (caught) { error.value = caught instanceof Error ? caught.message : String(caught) }
  finally { running.value = false }
}

function nodeKey(node: TodoNode) { return node.id }
function togglePackage(node: TodoNode) {
  if (node.kind !== 'package') return
  if (expanded.has(node.id)) expanded.delete(node.id)
  else expanded.add(node.id)
}
function expandAll() { for (const id of packageIds(tree.value)) expanded.add(id) }
function collapseAll() { expanded.clear() }

let selectToken = 0
// Read on every selection: a cached copy could show text the editor has since changed.
async function select(occurrence: { path: string; line: number }) {
  selected.value = occurrence
  if (!showPreview.value || !isDesktop) return
  const token = ++selectToken
  try {
    const doc = await request<DocumentData>('file.read', { path: occurrence.path })
    if (token !== selectToken) return
    const lines = doc.content.split(/\r?\n/)
    const index = Math.min(Math.max(occurrence.line - 1, 0), lines.length - 1)
    const start = Math.max(0, index - 2)
    preview.value = { path: occurrence.path, line: occurrence.line, lines: lines.slice(start, index + 3), start }
  } catch { if (token === selectToken) preview.value = null }
}
function open(occurrence: { path: string; line: number }) { emit('open', occurrence) }
function step(direction: 1 | -1) {
  const list = occurrences.value
  if (!list.length) return
  const at = selected.value ? list.findIndex(entry => entry.path === selected.value?.path && entry.line === selected.value?.line) : -1
  const next = list[(at + direction + list.length) % list.length]
  void revealOccurrence(next)
}
// IDEA's auto-scroll-from-source: the tree follows the caret instead of the reverse.
function revealOccurrence(occurrence: { path: string; line: number } | null) {
  if (!occurrence) return
  const ancestors = treeAncestors(tree.value, occurrence.path)
  for (const id of ancestors) expanded.add(id)
  void select(occurrence)
}
function treeAncestors(nodes: TodoNode[], path: string, trail: string[] = []): string[] {
  for (const node of nodes) {
    if (node.kind === 'file' && node.path === path) return trail
    if (node.kind === 'package') {
      const found = treeAncestors(node.children, path, [...trail, node.id])
      if (found.length) return found
    }
  }
  return []
}
watch(() => props.active, active => { if (active && !scanned.value) void scan() })
// Editing the marker list in Settings changes what the index means, so refresh it.
watch(() => props.patterns, () => { if (scanned.value) void scan() }, { deep: true })
// IDEA's auto-scroll: the tree follows the caret. Keyed on "path:line" so a keystroke
// inside the same line does not re-read the file.
watch(() => autoScroll.value && props.source ? `${props.source.path}:${props.source.line}` : '', key => {
  if (!key || !props.source) return
  const occurrence = { path: props.source.path, line: props.source.line }
  if (selected.value?.path === occurrence.path && selected.value?.line === occurrence.line) return
  revealOccurrence(occurrence)
})
</script>

<template>
  <div class="todo-panel">
    <div class="panel-heading">
      <span><ListChecks :size="14" />任务 (TODO)</span>
      <div class="heading-actions"><span class="heading-count">{{ filtered.length }}</span><button class="icon-button" title="重新扫描" aria-label="重新扫描" :disabled="!root || running" @click="scan"><RefreshCw :size="14" /></button></div>
    </div>
    <div class="todo-body">
      <div class="todo-toolbar" role="toolbar" aria-orientation="vertical" aria-label="任务视图工具栏">
        <button class="icon-button" title="上一个出现位置" aria-label="上一个出现位置" :disabled="!occurrences.length" @click="step(-1)"><ArrowUp :size="14" /></button>
        <button class="icon-button" title="下一个出现位置" aria-label="下一个出现位置" :disabled="!occurrences.length" @click="step(1)"><ArrowDown :size="14" /></button>
        <label class="todo-filter-button" title="按标记过滤" :aria-label="`当前标记过滤：${filterPattern || '全部'}`">
          <Filter :size="14" />
          <select v-model="filterPattern" aria-label="标记过滤"><option value="">全部</option><option v-for="pattern in patterns" :key="pattern.pattern" :value="pattern.pattern">{{ pattern.description || pattern.pattern }}</option></select>
        </label>
        <button class="icon-button" :class="{ toggled: autoScroll }" :aria-pressed="autoScroll" title="自动滚动到源码位置" aria-label="自动滚动到源码位置" @click="autoScroll = !autoScroll"><LocateFixed :size="14" /></button>
        <button class="icon-button" title="展开全部" aria-label="展开全部" @click="expandAll"><ChevronsDown :size="14" /></button>
        <button class="icon-button" title="折叠全部" aria-label="折叠全部" @click="collapseAll"><ChevronsUp :size="14" /></button>
        <div class="todo-groupby">
          <button class="icon-button" :class="{ toggled: groupByOpen }" aria-haspopup="true" :aria-expanded="groupByOpen" title="分组方式" aria-label="分组方式" @click="groupByOpen = !groupByOpen"><Group :size="14" /></button>
          <div v-if="groupByOpen" class="groupby-popup" role="group" aria-label="分组方式">
            <label><input v-model="showPackages" type="checkbox" /><span>按包（目录）分组</span></label>
            <label :class="{ disabled: !showPackages }"><input v-model="flattenPackages" type="checkbox" :disabled="!showPackages" /><span>扁平化包</span></label>
          </div>
        </div>
        <button class="icon-button" :class="{ toggled: showPreview }" :aria-pressed="showPreview" title="预览" aria-label="预览" @click="showPreview = !showPreview"><Eye :size="14" /></button>
      </div>
      <div class="todo-stack">
        <p v-if="!isDesktop" class="todo-note">浏览器预览不能扫描工作区，请在桌面端使用。</p>
        <p v-else-if="error" class="todo-error">{{ error }}</p>
        <div class="todo-scroll" role="tree" aria-label="任务列表" @click="groupByOpen = false">
          <div v-if="running" class="todo-empty">扫描中…</div>
          <template v-else-if="rows.length">
            <template v-for="(row, index) in rows" :key="`${nodeKey(row.node)}:${row.item ? row.item.line : 'node'}:${index}`">
              <button
                v-if="row.item" class="todo-node todo-row" role="treeitem"
                :class="{ selected: selected?.path === row.item.path && selected?.line === row.item.line }"
                :style="{ paddingLeft: `${6 + row.depth * 14}px` }"
                :aria-selected="selected?.path === row.item.path && selected?.line === row.item.line"
                :title="`${row.item.path}:${row.item.line}`"
                @click="select(row.item)" @dblclick="open(row.item)" @keydown.enter.prevent="open(row.item)"
              >
                <span v-if="row.item.kind" class="todo-kind">{{ row.item.kind }}</span>
                <span class="todo-text">{{ row.item.text }}</span>
                <span class="todo-pos">{{ row.item.line }}</span>
              </button>
              <button
                v-else-if="row.node.kind === 'package'" class="todo-node package" role="group"
                :style="{ paddingLeft: `${6 + row.depth * 14}px` }" :aria-expanded="row.expanded"
                @click="togglePackage(row.node)" @keydown.enter.prevent="togglePackage(row.node)"
              >
                <ChevronRight :size="12" class="tree-chevron" :class="{ expanded: row.expanded }" /><Folder :size="12" class="folder-icon" /><span class="todo-node-label">{{ row.node.label }}</span>
              </button>
              <div v-else class="todo-node file" :style="{ paddingLeft: `${6 + (row.depth + 1) * 14}px` }">
                <FileCode2 :size="12" /><span class="todo-node-label">{{ row.node.label }}</span><span class="todo-node-count">{{ row.node.items.length }}</span>
              </div>
            </template>
          </template>
          <div v-else-if="scanned" class="todo-empty">{{ items.length ? '没有符合当前过滤标记的任务。' : '没有找到标记。到 设置 › 项目结构 里增减 TODO 模式。' }}</div>
          <div v-else class="todo-empty">打开项目后自动扫描注释中的 TODO / FIXME 等标记。</div>
        </div>
        <section v-if="showPreview && preview" class="todo-preview" aria-label="预览">
          <div class="preview-head">{{ preview.path }}</div>
          <pre class="preview-lines"><span
            v-for="(line, index) in preview.lines"
            :key="preview.start + index"
            class="preview-line"
            :class="{ current: preview.start + index + 1 === preview.line }"
          >{{ preview.start + index + 1 }}  {{ line }}</span></pre>
        </section>
      </div>
    </div>
  </div>
</template>

<style scoped>
.todo-panel { display: flex; flex-direction: column; flex: 1; min-width: 0; min-height: 0; }
.todo-body { display: flex; flex: 1; min-height: 0; }
.todo-toolbar { display: flex; flex-direction: column; gap: 1px; flex-shrink: 0; padding: var(--space-1) 2px; border-right: 1px solid var(--line); background: var(--rail); }
.todo-toolbar .icon-button.toggled { color: var(--bright); background: var(--selected); }
.todo-filter-button { position: relative; display: grid; place-items: center; width: 24px; height: 24px; border-radius: var(--radius-xs); color: var(--secondary); cursor: pointer; }
.todo-filter-button:hover { background: var(--hover); color: var(--bright); }
.todo-filter-button select { position: absolute; inset: 0; opacity: 0; width: 100%; height: 100%; cursor: inherit; }
.todo-groupby { position: relative; }
.groupby-popup { position: absolute; left: 26px; top: 0; z-index: 5; display: flex; flex-direction: column; gap: 2px; min-width: 148px; padding: var(--space-1) var(--space-2); background: var(--elevated); border: 1px solid var(--line-strong); border-radius: var(--radius-sm); box-shadow: var(--shadow-2); }
.groupby-popup label { display: flex; align-items: center; gap: var(--space-2); font-size: 11px; color: var(--text); }
.groupby-popup label.disabled { color: var(--muted); }
.groupby-popup input { accent-color: var(--accent); }
.todo-stack { display: flex; flex-direction: column; flex: 1; min-width: 0; min-height: 0; }
.todo-note, .todo-error { margin: 0; padding: var(--space-2) var(--space-3); font-size: 11px; line-height: 1.6; overflow-wrap: anywhere; }
.todo-note { color: var(--secondary); background: var(--rail); }
.todo-error { color: var(--error); background: var(--panel); border-bottom: 1px solid var(--line); }
.todo-scroll { flex: 1; min-height: 0; overflow: auto; padding-bottom: var(--space-2); }
.todo-node { display: flex; align-items: center; gap: var(--space-1); width: 100%; border: 0; background: transparent; color: var(--text); text-align: left; font-size: 11px; }
.todo-node.package, .todo-node.file { padding: 1px 6px; color: var(--secondary); }
.todo-node.file { color: var(--accent); }
.todo-row { padding: 1px 6px; gap: var(--space-2); color: var(--secondary); cursor: pointer; }
.todo-row:hover, .todo-node:hover { background: var(--hover); }
.todo-row.selected { background: var(--selected); color: var(--bright); }
.todo-row:focus-visible { outline: 1px solid var(--accent); outline-offset: -1px; }
.todo-node-label { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.todo-node-count { color: var(--muted); font-variant-numeric: tabular-nums; }
.todo-kind { flex-shrink: 0; color: var(--warning); }
.todo-text { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font: 11px/1.6 var(--font-mono); }
.todo-pos { flex-shrink: 0; color: var(--muted); font-variant-numeric: tabular-nums; }
.tree-chevron { flex-shrink: 0; transition: transform var(--dur-1) var(--ease); }
.tree-chevron.expanded { transform: rotate(90deg); }
.folder-icon { flex-shrink: 0; color: var(--accent); }
.todo-empty { padding: var(--space-4) var(--space-3); color: var(--muted); font-size: 11px; line-height: 1.7; }
.todo-preview { flex-shrink: 0; max-height: 40%; overflow: auto; border-top: 1px solid var(--line-strong); background: var(--panel); }
.preview-head { padding: 2px var(--space-3); color: var(--muted); font: 10px var(--font-mono); border-bottom: 1px solid var(--line); }
.preview-lines { margin: 0; padding: var(--space-2) var(--space-3); font: 11px/1.6 var(--font-mono); color: var(--secondary); white-space: pre-wrap; overflow-wrap: anywhere; }
.preview-line { display: block; }
.preview-line.current { color: var(--bright); background: var(--selected); }
</style>
