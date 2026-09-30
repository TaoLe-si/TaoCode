<script setup lang="ts">
import { computed, nextTick, onMounted, onBeforeUnmount, ref, watch } from 'vue'
import { useLogViewport } from '../vcsLogViewport'
import VcsLogColumns from './VcsLogColumns.vue'
import type { GitFullCommit } from '../bridge'
import { buildLogGraph, lanePath, laneX, logDate, rootColor, ROW_H } from '../vcsLogGraph'
import { visibleColumns, type LogColumn } from '../vcsLogColumns'
const props = defineProps<{ commits: GitFullCommit[]; selected: string; root: string; loading?: boolean; showTagNames?: boolean; showRootNames?: boolean; hidden?: LogColumn[] }>()
const emit = defineEmits<{ select: [hash: string]; copy: []; more: []; menu: [{ hash: string; x: number; y: number }] }>()
const list = ref<HTMLElement>()
const viewportWidth = ref(0)
const columnRows = computed(() => props.commits.map(commit => ({ ...commit, date: logDate(commit.date) })))
let resizeObserver: ResizeObserver | undefined
onMounted(() => {
  if (!list.value) return
  const measure = () => { viewportWidth.value = list.value?.clientWidth ?? 0 }
  measure()
  resizeObserver = new ResizeObserver(measure)
  resizeObserver.observe(list.value)
})
onBeforeUnmount(() => resizeObserver?.disconnect())
const { start, end, update, reveal } = useLogViewport(list, computed(() => props.commits.length), () => emit('more'))
// 勾掉的列（`Vcs.Log.ToggleColumns`）在行里也不画 —— 表头与单元格是同一份判据。
const columns = computed(() => visibleColumns(['commit', 'author', 'date', 'hash'], props.hidden ?? []))
const graph = computed(() => buildLogGraph(props.commits))
// A page can contain only already-known hashes after an external history update;
// completion, not just row-count changes, must recheck the bottom threshold.
watch(() => props.loading, async loading => { if (!loading) { await nextTick(); update() } })
const rootName = computed(() => props.root.replace(/\\/g, '/').replace(/\/$/, '').split('/').pop())
async function focusHash(hash: string) {
  await nextTick()
  const index = props.commits.findIndex(commit => commit.hash === hash)
  await reveal(index)
  const row = list.value?.querySelector<HTMLElement>(`[data-index="${index}"]`)
  row?.focus()
  row?.scrollIntoView({ block: 'nearest', inline: 'nearest' })
}
function keys(index: number, event: KeyboardEvent) {
  if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'c') { event.preventDefault(); emit('copy'); return }
  let next = index
  const page = Math.max(1, Math.floor((list.value?.clientHeight ?? ROW_H) / ROW_H))
  if (event.key === 'ArrowDown') next++
  else if (event.key === 'ArrowUp') next--
  else if (event.key === 'Home') next = 0
  else if (event.key === 'End') next = props.commits.length - 1
  else if (event.key === 'PageDown') next += page
  else if (event.key === 'PageUp') next -= page
  else if (event.key !== 'Enter' && event.key !== ' ') return
  event.preventDefault()
  const commit = props.commits[Math.max(0, Math.min(props.commits.length - 1, next))]
  if (commit) { emit('select', commit.hash); void focusHash(commit.hash) }
}
defineExpose({ focusHash })
</script>

<template>
  <div ref="list" class="log-table" role="listbox" aria-label="提交列表" tabindex="0" @scroll="update" @keydown.self="keys(Math.max(0, commits.findIndex(c => c.hash === selected)), $event)">
    <VcsLogColumns :storage-key="`taocode.vcs.log.${encodeURIComponent(root)}.columns`" :rows="columnRows" :viewport="viewportWidth" :root-width="showRootNames ? 101 : 6" :hidden="hidden">
    <div :style="{ height: `${start * ROW_H}px` }" aria-hidden="true" />
    <div v-for="(row, index) in graph.rows.slice(start, end)" :key="row.commit.hash" class="log-row" role="option" :data-index="index + start" :aria-posinset="index + start + 1" :aria-setsize="commits.length"
      :class="{ selected: selected === row.commit.hash }" :aria-selected="selected === row.commit.hash"
      :tabindex="selected === row.commit.hash || (!commits.some(c => c.hash === selected) && index === 0) ? 0 : -1"
      @click="emit('select', row.commit.hash)" @keydown="keys(index + start, $event)"
      @contextmenu.prevent.stop="emit('menu', { hash: row.commit.hash, x: $event.clientX, y: $event.clientY })">
      <span class="root" :class="{ named: showRootNames }" :title="root" :style="{ '--root-color': rootColor(root) }">{{ showRootNames ? rootName : '' }}</span>
      <span class="commit-cell">
        <svg class="graph" :width="graph.width" :height="ROW_H" :viewBox="`0 0 ${graph.width} ${ROW_H}`" aria-hidden="true">
          <line v-for="(line, i) in row.pass" :key="`p${i}`" :x1="laneX(line.lane)" y1="0" :x2="laneX(line.lane)" :y2="ROW_H" :stroke="line.color" stroke-width="1.5" />
          <line v-for="(stub, i) in row.up" :key="`u${i}`" :x1="laneX(stub.lane)" y1="0" :x2="laneX(stub.lane)" :y2="ROW_H / 2" :stroke="stub.color" stroke-width="1.5" />
          <path v-for="(edge, i) in row.down" :key="`d${i}`" :d="lanePath(edge.from, edge.to)" fill="none" :stroke="edge.color" stroke-width="1.5" />
          <circle :cx="laneX(row.lane)" :cy="ROW_H / 2" r="3.5" :fill="row.color" />
        </svg>
        <span v-for="r in row.commit.refs.filter(r => showTagNames !== false || r.type !== 'tag')" :key="`${r.type}:${r.name}`" class="ref" :class="r.type">{{ r.name }}</span>
        <span class="subject" :title="row.commit.subject">{{ row.commit.subject }}</span>
      </span>
      <span v-if="columns.includes('author')" class="author" :title="row.commit.author">{{ row.commit.author }}</span>
      <span v-if="columns.includes('date')" class="date">{{ logDate(row.commit.date) }}</span>
      <span v-if="columns.includes('hash')" class="hash" :title="row.commit.hash">{{ row.commit.shortHash }}</span>
    </div>
    <div :style="{ height: `${(commits.length - end) * ROW_H}px` }" aria-hidden="true" />
    </VcsLogColumns>
    <slot />
  </div>
</template>

<style scoped>
.log-table { flex: 1; min-height: 0; overflow: auto; }
.log-row { display: flex; align-items: center; height: 26px; min-width: 580px; gap: 8px; padding-right: 8px; font-size: 11px; white-space: nowrap; cursor: default; }
.log-row:hover { background: var(--hover); }
.log-row.selected { background: var(--selection); }
.log-row:focus-visible { outline: 1px solid var(--accent); outline-offset: -1px; }
.root { align-self: stretch; flex: 0 0 6px; background: var(--root-color); }
.root.named { box-sizing: border-box; flex-basis: 101px; padding: 0 5px; line-height: 26px; background: transparent; border-left: 6px solid var(--root-color); overflow: hidden; text-overflow: ellipsis; }
.commit-cell { order: var(--commit-order); display: flex; flex: 0 0 var(--commit-width); min-width: 50px; align-items: center; gap: 4px; overflow: hidden; }
.graph, .ref { flex-shrink: 0; }
.ref { border: 1px solid currentColor; border-radius: var(--radius-pill); padding: 0 4px; color: var(--accent); font-size: 10px; line-height: 16px; }
.ref.remote { color: var(--secondary); }
.ref.tag { color: var(--warning); }
.subject, .author { overflow: hidden; text-overflow: ellipsis; }
.author { order: var(--author-order); flex: 0 0 var(--author-width); color: var(--muted); }
.date { order: var(--date-order); flex: 0 0 var(--date-width); overflow: hidden; color: var(--muted); font-size: 10px; }
.hash { order: var(--hash-order); flex: 0 0 var(--hash-width); overflow: hidden; color: var(--muted); font: 10px var(--font-mono); }
</style>
