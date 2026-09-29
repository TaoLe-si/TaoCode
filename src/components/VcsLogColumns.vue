<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { columnOrder, fitColumns, moveColumn, type LogColumn, type LogWidths } from '../vcsLogColumns'
const props = defineProps<{ storageKey: string; rows: Array<{ author: string; date: string; shortHash: string }>; viewport: number; rootWidth: number }>()
const saved = ref<Partial<LogWidths>>({})
const order = ref(columnOrder(null))
const host = ref<HTMLElement>()
const font = ref('11px sans-serif')
const labels = { commit: '提交', author: '作者', date: '日期', hash: '哈希' }
let context: CanvasRenderingContext2D | null = null
onMounted(() => { context = document.createElement('canvas').getContext('2d'); if (host.value) font.value = getComputedStyle(host.value).font || font.value })
const widths = computed(() => fitColumns(props.rows, (text, column) => {
  if (!context) return 50
  context.font = column === 'hash' ? '10px monospace' : font.value
  return context.measureText(text).width
}, props.viewport, props.rootWidth, saved.value))
watch(() => props.storageKey, key => {
  saved.value = {}; order.value = columnOrder(null)
  try {
    const raw = JSON.parse(localStorage.getItem(key) ?? '{}')
    saved.value = raw?.widths ?? raw ?? {}; order.value = columnOrder(raw?.order)
  } catch { /* Default layout. */ }
}, { immediate: true })
function save() { try { localStorage.setItem(props.storageKey, JSON.stringify({ widths: saved.value, order: order.value })) } catch { /* Session-only layout. */ } }
let drag: { id: number; column: LogColumn; x: number; width: number } | null = null
function resize(column: LogColumn, width: number) {
  // Commit is the remainder column upstream: resizing it adjusts a dynamic neighbour.
  if (column === 'commit') {
    const neighbour = order.value.find(key => key !== 'commit')!
    saved.value = { ...saved.value, [neighbour]: Math.max(50, widths.value[neighbour] + widths.value.commit - width) }
  } else saved.value = { ...saved.value, [column]: Math.max(50, Math.min(2000, width)) }
}
function start(column: LogColumn, event: PointerEvent) {
  if (event.button !== 0) return
  drag = { id: event.pointerId, column, x: event.clientX, width: widths.value[column] }
  ;(event.currentTarget as HTMLElement).setPointerCapture(event.pointerId); event.preventDefault()
}
function move(event: PointerEvent) { if (drag?.id === event.pointerId) resize(drag.column, drag.width + event.clientX - drag.x) }
function stop() { if (drag) { drag = null; save() } }
function key(column: LogColumn, event: KeyboardEvent) {
  if (!['ArrowLeft', 'ArrowRight'].includes(event.key)) return
  event.preventDefault()
  const delta = event.key === 'ArrowLeft' ? -1 : 1
  if (event.altKey) { const target = order.value[order.value.indexOf(column) + delta]; if (target) order.value = moveColumn(order.value, column, target) }
  else resize(column, widths.value[column] + delta * 10)
  save()
}
let moving: LogColumn | null = null
function startReorder(column: LogColumn, event: DragEvent) { moving = column; event.dataTransfer?.setData('text/plain', column) }
function drop(column: LogColumn) { if (moving) { order.value = moveColumn(order.value, moving, column); save() }; moving = null }
function automatic(column: LogColumn) { const next = { ...saved.value }; if (column === 'commit') saved.value = {}; else { delete next[column]; saved.value = next }; save() }
onBeforeUnmount(() => { drag = null; moving = null })
const style = computed(() => Object.fromEntries(order.value.flatMap((key, index) => [[`--${key}-width`, `${widths.value[key]}px`], [`--${key}-order`, index + 1]])))
</script>
<template>
  <div ref="host" class="columns" :style="style">
    <div class="invisible-header" aria-label="调整列宽与顺序">
      <span :style="{ width: `${rootWidth}px` }" />
      <span v-for="column in order" :key="column" :style="{ width: `${widths[column]}px` }" @dragover.prevent @drop.prevent="drop(column)">
        <span class="reorder" draggable="true" :title="`拖动重排${labels[column]}列`" @dragstart="startReorder(column, $event)" @dragend="moving = null" />
        <span class="resize" role="separator" tabindex="0" aria-orientation="vertical" :aria-label="`${labels[column]}列宽，Alt 加方向键重排，双击自动宽度`" :aria-valuenow="widths[column]" :aria-valuemin="50" :aria-valuemax="2000" @pointerdown="start(column, $event)" @pointermove="move" @pointerup="stop" @pointercancel="stop" @lostpointercapture="stop" @keydown="key(column, $event)" @dblclick="automatic(column)" />
      </span>
    </div><slot />
  </div>
</template>
<style scoped>
.columns { min-width: 100%; width: max-content; font-size: 11px; }
.invisible-header { display: flex; position: sticky; top: 0; height: 0; z-index: 2; gap: 8px; }
.invisible-header > span { position: relative; flex-shrink: 0; }
.reorder { position: absolute; left: 4px; right: 6px; height: 6px; cursor: grab; }
.resize { position: absolute; right: -4px; width: 8px; height: 12px; cursor: col-resize; touch-action: none; }
.resize:focus-visible { outline: 1px solid var(--accent); }
</style>
