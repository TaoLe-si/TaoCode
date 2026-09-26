<script setup lang="ts">
// One diff renderer for both the Git changes view and local history, so the two can
// never disagree about what a change looks like. Data comes from the parent: the rows
// are already aligned natively, and `unified` is the same diff in patch form.
import { computed, ref } from 'vue'
import { X } from 'lucide-vue-next'
import type { DiffRow } from '../bridge'

const props = defineProps<{ path: string; subtitle?: string; rows: DiffRow[]; unified: string; truncated?: boolean; closable?: boolean }>()
const emit = defineEmits<{ close: [] }>()
const mode = ref<'sides' | 'unified'>('sides')
const stats = computed(() => {
  let added = 0
  let removed = 0
  for (const row of props.rows) {
    if (row.kind === 'insert') ++added; else if (row.kind === 'delete') ++removed
    else if (row.kind === 'change') { ++added; ++removed }
  }
  return { added, removed }
})
// Split a line into plain/highlighted parts using the [start, length] word marks.
// Out-of-range or overlapping marks are dropped instead of shifting the text: the
// line itself is always rendered whole, and every part goes out as text (never
// HTML) so a file that contains markup cannot inject anything into the viewer.
function parts(cell: DiffRow['left'], marks?: [number, number][]) {
  if (!cell) return []
  const list: { text: string; mark: boolean }[] = []
  let cursor = 0
  for (const [start, length] of marks ?? []) {
    if (start < cursor || length <= 0 || start + length > cell.text.length) continue
    if (start > cursor) list.push({ text: cell.text.slice(cursor, start), mark: false })
    list.push({ text: cell.text.slice(start, start + length), mark: true })
    cursor = start + length
  }
  if (cursor < cell.text.length) list.push({ text: cell.text.slice(cursor), mark: false })
  return list
}
</script>

<template>
  <div class="diff-view">
    <div class="diff-head">
      <span class="diff-title">{{ path }}<small v-if="subtitle">{{ subtitle }}</small></span>
      <span class="diff-stats"><b class="add">+{{ stats.added }}</b><b class="del">−{{ stats.removed }}</b></span>
      <div class="diff-modes" role="group" aria-label="差异视图">
        <button :class="{ selected: mode === 'sides' }" @click="mode = 'sides'">并排</button>
        <button :class="{ selected: mode === 'unified' }" @click="mode = 'unified'">统一</button>
      </div>
      <button v-if="closable" class="icon-button" title="关闭" aria-label="关闭差异" @click="emit('close')"><X :size="16" /></button>
    </div>
    <p v-if="truncated" class="diff-note">差异行数超过上限，后续部分未显示。</p>
    <div v-if="rows.length && mode === 'sides'" class="diff-sides">
      <div v-for="(row, index) in rows" :key="index" class="diff-line" :class="`diff-${row.kind}`">
        <span class="diff-no">{{ row.left?.no ?? '' }}</span>
        <span class="diff-cell"><span v-for="(part, i) in parts(row.left, row.leftMarks)" :key="i" :class="{ 'diff-word-del': part.mark }">{{ part.text }}</span></span>
        <span class="diff-no">{{ row.right?.no ?? '' }}</span>
        <span class="diff-cell"><span v-for="(part, i) in parts(row.right, row.rightMarks)" :key="i" :class="{ 'diff-word-add': part.mark }">{{ part.text }}</span></span>
      </div>
    </div>
    <!-- Both the unified patch and the "nothing to show" fallback need pre-formatted
         text: a <p> would collapse the patch's newlines and indentation. -->
    <pre v-else class="diff-body">{{ unified || '（无差异）' }}</pre>
  </div>
</template>

<style scoped>
.diff-view { display: flex; flex-direction: column; min-height: 0; flex: 1; }
.diff-title { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.diff-stats { margin-left: auto; display: inline-flex; gap: var(--space-2); font: 11px var(--font-mono); font-variant-numeric: tabular-nums; }
.diff-stats > b { font-weight: 500; }
.diff-stats .add { color: var(--success); }
.diff-stats .del { color: var(--error); }
</style>
