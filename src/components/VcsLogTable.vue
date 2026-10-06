<script setup lang="ts">
import { computed, nextTick, onMounted, onBeforeUnmount, ref, watch } from 'vue'
import { useLogViewport } from '../vcsLogViewport'
import VcsLogColumns from './VcsLogColumns.vue'
import SpeedSearchBar from './SpeedSearchBar.vue'
import type { GitFullCommit } from '../bridge'
import { buildLogGraph, collapseLinearBranches, lanePath, laneX, logDate, rootColor, ROW_H } from '../vcsLogGraph'
import { visibleColumns, type LogColumn } from '../vcsLogColumns'
import { logCommitTooltip, logRefsToShow, logSpeedSearchColumns } from '../vcsLogPresentation'
import { speedSearchMatches } from '../speedSearch'
const props = defineProps<{ commits: GitFullCommit[]; selected: string; root: string; loading?: boolean; showTagNames?: boolean;
  showRootNames?: boolean; hidden?: LogColumn[]; compactReferences?: boolean; alignLabels?: boolean; showLongEdges?: boolean;
  collapsed?: boolean }>()
const emit = defineEmits<{ select: [hash: string]; copy: []; more: []; menu: [{ hash: string; x: number; y: number }];
  refMenu: [{ name: string; type: 'local' | 'remote' | 'tag' | 'head'; x: number; y: number }] }>()
const list = ref<HTMLElement>()
const viewportWidth = ref(0)
const columnRows = computed(() => visible.value.map(commit => ({ ...commit, date: logDate(commit.date) })))
// 「收起线性分支」= 从**已加载这一页**里去掉线性链的中间节点（上游 `COLLAPSE_ALL` 的 hideNode，
// 见 `src/vcsLogGraph.ts` 的 `collapseLinearBranches`）。表、视口、键盘导航、aria 全按这一份走。
const visible = computed(() => collapseLinearBranches(props.commits, props.collapsed === true))
let resizeObserver: ResizeObserver | undefined
onMounted(() => {
  if (!list.value) return
  const measure = () => { viewportWidth.value = list.value?.clientWidth ?? 0 }
  measure()
  resizeObserver = new ResizeObserver(measure)
  resizeObserver.observe(list.value)
})
onBeforeUnmount(() => resizeObserver?.disconnect())
const { start, end, update, reveal } = useLogViewport(list, computed(() => visible.value.length), () => emit('more'))
// 勾掉的列（`Vcs.Log.ToggleColumns`）在行里也不画 —— 表头与单元格是同一份判据。
const columns = computed(() => visibleColumns(['commit', 'author', 'date', 'hash'], props.hidden ?? []))
const graph = computed(() => buildLogGraph(visible.value, { showLongEdges: props.showLongEdges !== false }))
// 一个提交要画哪几个引用：`Vcs.Log.ShowTagNames` + `Vcs.Log.CompactReferencesView`（判据在
// `src/vcsLogPresentation.ts` 的 `logRefsToShow`）。
const refsOf = (commit: GitFullCommit) => logRefsToShow(commit.refs ?? [], {
  showTagNames: props.showTagNames !== false, compact: props.compactReferences !== false,
})
// A page can contain only already-known hashes after an external history update;
// completion, not just row-count changes, must recheck the bottom threshold.
watch(() => props.loading, async loading => { if (!loading) { await nextTick(); update() } })
const rootName = computed(() => props.root.replace(/\\/g, '/').replace(/\/$/, '').split('/').pop())
async function focusHash(hash: string) {
  await nextTick()
  const index = visible.value.findIndex(commit => commit.hash === hash)
  await reveal(index)
  const row = list.value?.querySelector<HTMLElement>(`[data-index="${index}"]`)
  row?.focus()
  row?.scrollIntoView({ block: 'nearest', inline: 'nearest' })
}
// ── 速度搜索（`log/ui/table/VcsLogSpeedSearch.java`）──────────────────────────────
// 匹配对象 = 可见的**元数据列**（主题/作者/日期/哈希，`getColumnsForSpeedSearch():60-66`），
// 命中之后是"选中并滚过去"（`:71-74` `selectElement` → `jumpToGraphRow(row, true)`），
// 不是把不匹配的行藏起来；打开方式是"在列表上开始打字"（`SpeedSearchBase` 的内置行为，
// 本仓与书签面板同一套：`src/components/BookmarksPanel.vue` 的 `onKeydown`）。
const searchOpen = ref(false)
const search = ref('')
function rowMatches(commit: GitFullCommit, value: string): boolean {
  return logSpeedSearchColumns(
    { subject: commit.subject, author: commit.author, date: logDate(commit.date), hash: commit.hash, shortHash: commit.shortHash },
    props.hidden ?? [],
  ).some(text => speedSearchMatches(value, text))
}
/** 从 `from` 起按 `delta` 找下一条命中（`SpeedSearchBase.findNextElement:476-516`：先迈一步、绕一圈回绕）。 */
function searchHit(from: number, delta: 1 | -1, value: string): number {
  const rows = visible.value
  if (!rows.length || !value.trim()) return -1
  for (let step = 1; step <= rows.length; step++) {
    const index = (((from + delta * step) % rows.length) + rows.length) % rows.length
    if (rowMatches(rows[index]!, value)) return index
  }
  return -1
}
function selectRow(index: number) {
  const commit = visible.value[index]
  if (!commit) return
  emit('select', commit.hash)
  void focusHash(commit.hash)
}
function onSearchInput(value: string) {
  search.value = value
  const current = visible.value.findIndex(commit => commit.hash === props.selected)
  const hit = current >= 0 ? searchHit(current, 1, value) : searchHit(-1, 1, value)
  if (hit >= 0) selectRow(hit)
}
function closeSearch() { searchOpen.value = false; search.value = '' }
function onSearchKeydown(event: KeyboardEvent) {
  // 键位归属照 `SpeedSearchBase.java:958-1002`（本仓折成 `speedSearchKeyAction` 一处真源）。
  if (event.key === 'Escape') { event.preventDefault(); closeSearch(); void list.value?.focus(); return }
  if (event.key === 'Enter' || event.key === 'ArrowLeft' || event.key === 'ArrowRight') { event.preventDefault(); closeSearch(); return }
  const step = event.key === 'ArrowDown' ? 1 : event.key === 'ArrowUp' ? -1 : 0
  if (!step && event.key !== 'Home' && event.key !== 'End') return
  event.preventDefault()
  const rows = visible.value
  const current = rows.findIndex(commit => commit.hash === props.selected)
  let hit = -1
  if (event.key === 'Home') hit = searchHit(-1, 1, search.value)
  else if (event.key === 'End') hit = searchHit(rows.length, -1, search.value)
  else hit = searchHit(current, step as 1 | -1, search.value)
  if (hit >= 0) selectRow(hit)
}
function keys(index: number, event: KeyboardEvent) {
  if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'c') { event.preventDefault(); emit('copy'); return }
  // 在列表上打字 = 打开速度搜索（上游的内置触发方式），不当成导航键。
  if (event.key.length === 1 && !event.ctrlKey && !event.altKey && !event.metaKey) {
    event.preventDefault()
    searchOpen.value = true
    onSearchInput(event.key)
    return
  }
  let next = index
  const page = Math.max(1, Math.floor((list.value?.clientHeight ?? ROW_H) / ROW_H))
  if (event.key === 'ArrowDown') next++
  else if (event.key === 'ArrowUp') next--
  else if (event.key === 'Home') next = 0
  else if (event.key === 'End') next = visible.value.length - 1
  else if (event.key === 'PageDown') next += page
  else if (event.key === 'PageUp') next -= page
  else if (event.key !== 'Enter' && event.key !== ' ') return
  event.preventDefault()
  const commit = visible.value[Math.max(0, Math.min(visible.value.length - 1, next))]
  if (commit) { emit('select', commit.hash); void focusHash(commit.hash) }
}
defineExpose({ focusHash })
</script>

<template>
  <div ref="list" class="log-table" role="listbox" aria-label="提交列表" tabindex="0" @scroll="update" @keydown.self="keys(Math.max(0, visible.findIndex(c => c.hash === selected)), $event)">
    <SpeedSearchBar :open="searchOpen" :query="search" @input="onSearchInput" @keydown="onSearchKeydown" />
    <VcsLogColumns :storage-key="`taocode.vcs.log.${encodeURIComponent(root)}.columns`" :rows="columnRows" :viewport="viewportWidth" :root-width="showRootNames ? 101 : 6" :hidden="hidden">
    <div :style="{ height: `${start * ROW_H}px` }" aria-hidden="true" />
    <div v-for="(row, index) in graph.rows.slice(start, end)" :key="row.commit.hash" class="log-row" role="option" :data-index="index + start" :aria-posinset="index + start + 1" :aria-setsize="visible.length"
      :class="{ selected: selected === row.commit.hash }" :aria-selected="selected === row.commit.hash"
      :title="logCommitTooltip({ subject: row.commit.subject, author: row.commit.author, date: logDate(row.commit.date), hash: row.commit.shortHash, fullHash: row.commit.hash })"
      :tabindex="selected === row.commit.hash || (!visible.some(c => c.hash === selected) && index === 0) ? 0 : -1"
      @click="emit('select', row.commit.hash)" @keydown="keys(index + start, $event)"
      @contextmenu.prevent.stop="emit('menu', { hash: row.commit.hash, x: $event.clientX, y: $event.clientY })">
      <span class="root" :class="{ named: showRootNames }" :title="root" :style="{ '--root-color': rootColor(root) }">{{ showRootNames ? rootName : '' }}</span>
      <!-- `Vcs.Log.AlignLabels`（`GraphCommitCellRenderer.kt:143-146` 的 `setLeftAligned` → 画师 `isLeftAligned`）：
           勾上 = 引用进提交格里一条**左对齐的定宽列**（消息不再被 chip 挤走），不勾 = chip 挨在消息左侧 inline。 -->
      <span class="commit-cell" :class="{ aligned: alignLabels }">
        <svg class="graph" :width="graph.width" :height="ROW_H" :viewBox="`0 0 ${graph.width} ${ROW_H}`" aria-hidden="true">
          <line v-for="(line, i) in row.pass" :key="`p${i}`" :x1="laneX(line.lane)" y1="0" :x2="laneX(line.lane)" :y2="ROW_H" :stroke="line.color" stroke-width="1.5" />
          <line v-for="(stub, i) in row.up" :key="`u${i}`" :x1="laneX(stub.lane)" y1="0" :x2="laneX(stub.lane)" :y2="ROW_H / 2" :stroke="stub.color" stroke-width="1.5" />
          <line v-for="(stub, i) in row.stub" :key="`s${i}`" :x1="laneX(stub.lane)" :y1="ROW_H / 2" :x2="laneX(stub.lane)" :y2="ROW_H" :stroke="stub.color" stroke-width="1.5" />
          <path v-for="(edge, i) in row.down" :key="`d${i}`" :d="lanePath(edge.from, edge.to)" fill="none" :stroke="edge.color" stroke-width="1.5" />
          <circle :cx="laneX(row.lane)" :cy="ROW_H / 2" r="3.5" :fill="row.color" />
        </svg>
        <span v-if="alignLabels" class="labels">
          <span v-for="r in refsOf(row.commit)" :key="`a${r.type}:${r.name}`" class="ref" :class="r.type"
                @contextmenu.prevent.stop="emit('refMenu', { name: r.name, type: r.type, x: $event.clientX, y: $event.clientY })">{{ r.name }}</span>
        </span>
        <template v-if="!alignLabels">
          <span v-for="r in refsOf(row.commit)" :key="`${r.type}:${r.name}`" class="ref" :class="r.type"
                @contextmenu.prevent.stop="emit('refMenu', { name: r.name, type: r.type, x: $event.clientX, y: $event.clientY })">{{ r.name }}</span>
        </template>
        <span class="subject">{{ row.commit.subject }}</span>
      </span>
      <span v-if="columns.includes('author')" class="author" :title="row.commit.author">{{ row.commit.author }}</span>
      <span v-if="columns.includes('date')" class="date">{{ logDate(row.commit.date) }}</span>
      <span v-if="columns.includes('hash')" class="hash" :title="row.commit.hash">{{ row.commit.shortHash }}</span>
    </div>
    <div :style="{ height: `${(visible.length - end) * ROW_H}px` }" aria-hidden="true" />
    </VcsLogColumns>
    <slot />
  </div>
</template>

<style scoped>
.log-table { flex: 1; min-height: 0; overflow: auto; }
.log-row { display: flex; align-items: center; height: 26px; min-width: 580px; gap: 8px; padding-right: 8px; font-size: 11px; white-space: nowrap; cursor: default; transition: background-color var(--dur-1) var(--ease); }
.log-row:hover { background: var(--hover); }
.log-row.selected { background: var(--selection); }
.log-row:focus-visible { outline: 1px solid var(--accent); outline-offset: -1px; }
.root { align-self: stretch; flex: 0 0 6px; background: var(--root-color); }
.root.named { box-sizing: border-box; flex-basis: 101px; padding: 0 5px; line-height: 26px; background: transparent; border-left: 6px solid var(--root-color); overflow: hidden; text-overflow: ellipsis; }
.commit-cell { order: var(--commit-order); display: flex; flex: 0 0 var(--commit-width); min-width: 50px; align-items: center; gap: 4px; overflow: hidden; }
/* `Vcs.Log.AlignLabels` 勾上后引用进提交格里这一条定宽列（左对齐，消息不再被 chip 挤走）。 */
.labels { display: flex; flex: 0 0 120px; align-items: center; justify-content: flex-start; gap: 4px; overflow: hidden; }
.graph, .ref { flex-shrink: 0; }
.ref { border: 1px solid currentColor; border-radius: var(--radius-pill); padding: 0 4px; color: var(--accent); font-size: 10px; line-height: 16px; }
.ref.remote { color: var(--secondary); }
.ref.tag { color: var(--warning); }
.subject, .author { overflow: hidden; text-overflow: ellipsis; }
.author { order: var(--author-order); flex: 0 0 var(--author-width); color: var(--muted); }
.date { order: var(--date-order); flex: 0 0 var(--date-width); overflow: hidden; color: var(--muted); font-size: 10px; }
.hash { order: var(--hash-order); flex: 0 0 var(--hash-width); overflow: hidden; color: var(--muted); font: 10px var(--font-mono); }
</style>
