<script setup lang="ts">
import { ref, watch } from 'vue'
import { History as HistoryIcon, RotateCcw } from 'lucide-vue-next'
import DiffView from './DiffView.vue'
import { isDesktop, request, type DiffRow, type HistoryDiff, type HistoryDiffSides, type HistoryEntry, type HistoryList } from '../bridge'
import { iconSize } from '../uiIcons'

const props = defineProps<{ path: string; ready: boolean }>()
const emit = defineEmits<{ revert: [entry: HistoryEntry] }>()

const entries = ref<HistoryEntry[]>([])
const selected = ref<HistoryEntry | null>(null)
const diff = ref('')
const diffRows = ref<DiffRow[]>([])
const diffTruncated = ref(false)
const diffHeader = ref('')
const loading = ref(false)
const diffLoading = ref(false)
const error = ref('')
// The list is keyed to a file and the diff to one snapshot, so each keeps a token:
// an answer that arrives after the subject changed belongs to nothing on screen.
let listToken = 0
let diffToken = 0

async function load() {
  const token = ++listToken
  selected.value = null
  diff.value = ''
  diffRows.value = []
  diffHeader.value = ''
  error.value = ''
  entries.value = []
  if (!isDesktop || !props.path || !props.ready) return
  loading.value = true
  try {
      const listed = await request<HistoryList>('history.list', { path: props.path })
      if (token !== listToken) return  // a stale answer must not replace the new file's list
      entries.value = listed.entries ?? []
    if (entries.value[0]) await select(entries.value[0]!)
  } catch (caught) { if (token === listToken) error.value = message(caught) }
  finally { if (token === listToken) loading.value = false }
}
async function select(entry: HistoryEntry) {
  selected.value = entry
  const token = ++diffToken
  if (!isDesktop || !props.path) { diff.value = ''; diffRows.value = []; return }
  diffLoading.value = true
  try {
    // Unified text for the patch view, aligned rows for the side-by-side one; both
    // come from the same snapshot so the two modes cannot disagree.
    const [unified, sides] = await Promise.all([
      request<HistoryDiff>('history.diff', { path: props.path, id: entry.id }),
      request<HistoryDiffSides>('history.diffSides', { path: props.path, id: entry.id }),
    ])
    if (token !== diffToken) return
    diff.value = unified.diff ?? ''
    diffRows.value = sides.rows ?? []
    diffTruncated.value = sides.truncated === true
    diffHeader.value = sides.header ?? ''
  }
  catch (caught) {
    if (token !== diffToken) return
    diff.value = ''; diffRows.value = []; error.value = message(caught)
  }
  finally { if (token === diffToken) diffLoading.value = false }
}
function message(caught: unknown) { return caught instanceof Error ? caught.message : String(caught) }
function label(entry: HistoryEntry) {
  return `${entry.time.replace('T', ' ').replace('Z', '')}  ·  ${entry.reason}  ·  ${entry.bytes} B`
}

watch(() => [props.path, props.ready], () => void load(), { immediate: true })
</script>

<template>
  <div class="hist-panel">
    <div class="panel-heading"><span><HistoryIcon :size="iconSize.control" />本地历史</span><span class="heading-count">{{ entries.length }}</span></div>
    <p v-if="!path" class="hist-empty">选择一个文件查看其本地历史。</p>
    <p v-else-if="!isDesktop || !ready" class="hist-empty">浏览器预览没有本地历史，请在桌面端使用。</p>
    <p v-if="error" class="hist-error">{{ error }}</p>
    <div v-if="loading" class="hist-empty">读取中…</div>
    <template v-else-if="path && ready && isDesktop">
      <div v-if="!entries.length" class="hist-empty">此文件还没有保存过的历史版本。</div>
      <div v-else class="hist-body">
        <div class="hist-list" role="list" aria-label="历史版本">
          <button v-for="entry in entries" :key="entry.id" class="hist-item" role="listitem" :class="{ selected: selected?.id === entry.id }" :aria-current="selected?.id === entry.id ? 'true' : undefined" @click="select(entry)">{{ label(entry) }}</button>
        </div>
        <div class="hist-actions">
          <button class="subtle-button" :disabled="!selected" title="把当前文件回滚到所选版本（会作为新版本保存）" @click="selected && emit('revert', selected)"><RotateCcw :size="iconSize.menu" />回滚此版本</button>
        </div>
        <p v-if="diffLoading" class="hist-empty">正在读取所选版本的差异…</p>
        <DiffView v-else-if="diffRows.length || diff" :path="props.path" :subtitle="diffHeader" :rows="diffRows" :unified="diff" :truncated="diffTruncated" />
        <p v-else-if="selected" class="hist-empty">与当前内容一致，无差异。</p>
      </div>
    </template>
  </div>
</template>

<style scoped>
.hist-panel { display: flex; flex-direction: column; flex: 1; min-width: 0; min-height: 0; }
.heading-count { margin-left: auto; color: var(--muted); font-size: 10px; }
.hist-body { display: flex; flex-direction: column; flex: 1; min-height: 0; }
.hist-list { flex: 0 1 auto; max-height: 40%; overflow: auto; border-bottom: 1px solid var(--line); }
.hist-item { display: block; width: 100%; padding: 3px var(--space-3); border: 0; border-bottom: 1px solid var(--line); background: transparent; color: var(--text); text-align: left; font: 11px/1.6 var(--font-mono); cursor: pointer; }
.hist-item:hover { background: var(--hover); }
.hist-item.selected { background: var(--selected); color: var(--bright); }
.hist-actions { display: flex; padding: var(--space-2) var(--space-3); border-bottom: 1px solid var(--line); }
.hist-error { margin: 0; padding: var(--space-2) var(--space-3); color: var(--error); font-size: 11px; border-bottom: 1px solid var(--line); overflow-wrap: anywhere; }
.hist-empty { padding: var(--space-4) var(--space-3); color: var(--muted); font-size: 11px; line-height: 1.7; }
</style>
