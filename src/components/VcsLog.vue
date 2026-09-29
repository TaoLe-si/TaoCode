<script setup lang="ts">
import { computed, ref, toRef, watch } from 'vue'
import { RefreshCw, PanelRight, ArrowLeft, ArrowRight, Settings2 } from 'lucide-vue-next'
import { Check } from 'lucide-vue-next'
import { copyToClipboard } from '../clipboard'
import { isDesktop, type GitCommitChange } from '../bridge'
import VcsLogDiff from './VcsLogDiff.vue'
import { useVcsLogData } from '../vcsLogData'
import VcsLogTable from './VcsLogTable.vue'
import VcsLogSplitter from './VcsLogSplitter.vue'
import VcsLogChanges from './VcsLogChanges.vue'
import VcsLogDetails from './VcsLogDetails.vue'
import VcsLogFilters from './VcsLogFilters.vue'
import { hiddenColumns, toggleColumn, type LogColumn } from '../vcsLogColumns'
import { LOG_VIEW_OPTIONS_TITLE, logPresentationModel } from '../vcsLogPresentation'

const props = defineProps<{ root: string; active: boolean; showTagNames?: boolean; showRootNames?: boolean }>()
// 「标签名称」是**项目设置**（`vcsLog.showTagNames`），写回走宿主；其余行是本窗口自己的排布。
const emit = defineEmits<{ setTagNames: [value: boolean] }>()
const { commits, selected, query, loading, loaded, hasMore, error, details, changes, detailsLoading, changesLoading,
  canBack, canForward, travel, select, detailsError, changesError, busy, navigating, selectedCommit, load, applyQuery, navigate, cherryPick, scope } =
  useVcsLogData(toRef(props, 'root'), toRef(props, 'active'))
const previewChange = ref<GitCommitChange | null>(null)
// 勾掉的列（`Vcs.Log.ToggleColumns`）：与列宽/顺序一样按仓库根存。
const hidden = ref<LogColumn[]>([])
const columnsKey = computed(() => `taocode.vcs.log.${encodeURIComponent(props.root)}.columns.hidden`)
watch(columnsKey, key => {
  try { hidden.value = hiddenColumns(JSON.parse(localStorage.getItem(key) ?? '[]')) } catch { hidden.value = [] }
}, { immediate: true })
function toggleLogColumn(column: LogColumn) {
  hidden.value = toggleColumn(hidden.value, column)
  try { localStorage.setItem(columnsKey.value, JSON.stringify(hidden.value)) } catch { /* Session-only. */ }
}
// 日志窗口自己的齿轮（上游 `Vcs.Log.PresentationSettings`，日志工具条右角）：模型在
// src/vcsLogPresentation.ts，只给真能接住的行（不做的四条在 docs/source-todo.md §11）。
const gearOpen = ref(false)
const presentationRows = computed(() => logPresentationModel(
  { showTagNames: props.showTagNames !== false, hidden: hidden.value },
  { setShowTagNames: value => emit('setTagNames', value), toggleColumn: toggleLogColumn }))
function pickPresentation(row: { run?: () => void }) { row.run?.() }
watch([() => props.root, selected, changes], () => { previewChange.value = null }, { flush: 'sync' })
const table = ref<InstanceType<typeof VcsLogTable>>()
const showDetails = ref(true)
const layoutKey = computed(() => `taocode.vcs.log.${encodeURIComponent(props.root)}`)
watch(layoutKey, key => {
  showDetails.value = true
  try { showDetails.value = localStorage.getItem(`${key}.showDetails`) !== 'false' } catch { /* Session-only preferences. */ }
}, { immediate: true })
function toggleDetails() {
  showDetails.value = !showDetails.value
  try { localStorage.setItem(`${layoutKey.value}.showDetails`, String(showDetails.value)) } catch { /* Session-only preferences. */ }
}
function copyFallback(text: string): boolean {
  const area = document.createElement('textarea')
  const focused = document.activeElement as HTMLElement | null
  area.value = text
  area.setAttribute('readonly', '')
  area.style.position = 'fixed'
  area.style.opacity = '0'
  document.body.append(area)
  area.select()
  try { return document.execCommand('copy') } finally { area.remove(); focused?.focus() }
}
async function copyHash() {
  if (!selectedCommit.value) return
  const hash = selectedCommit.value.hash
  const current = scope()
  try { await copyToClipboard(hash) }
  catch {
    if (!current()) return
    try { if (copyFallback(hash)) return } catch { /* Show the manual-copy fallback. */ }
    error.value = '无法写入剪贴板，请手动选中详情里的完整哈希复制。'
  }
}
async function history(direction: 'back' | 'forward') {
  const hash = await travel(direction)
  if (hash) void table.value?.focusHash(hash)
}
function more() { if (hasMore.value && !loading.value && !error.value) void load(true) }
async function jump(hash: string) {
  if (await navigate(hash)) void table.value?.focusHash(hash)
}
</script>

<template>
  <div class="vcslog-panel">
    <!-- MainFrame: table+toolbar left; changes above details right; initial ratios 0.7. -->
    <VcsLogSplitter vertical :storage-key="`${layoutKey}.diff.splitter.proportion`" :second-visible="!!previewChange">
      <template #first>
    <VcsLogSplitter :key="root" :storage-key="`${layoutKey}.changes.splitter.proportion`">
      <template #first>
        <div class="vcslog-toolbar" role="toolbar" aria-label="日志过滤与显示">
          <VcsLogFilters :query="query" @apply="applyQuery" />
          <button class="icon-button" title="后退" aria-label="日志导航后退" :disabled="!canBack" @click="history('back')"><ArrowLeft :size="14" /></button>
          <button class="icon-button" title="前进" aria-label="日志导航前进" :disabled="!canForward" @click="history('forward')"><ArrowRight :size="14" /></button>
          <span class="count" :title="`已加载 ${commits.length} 条提交`">{{ commits.length }}{{ hasMore ? '+' : '' }}</span>
          <button class="icon-button" title="刷新" aria-label="刷新提交历史" :disabled="!isDesktop || !root || loading" @click="load()"><RefreshCw :size="14" /></button>
          <button class="icon-button" title="显示提交详情" aria-label="显示提交详情" :aria-pressed="showDetails" @click="toggleDetails"><PanelRight :size="14" /></button>
          <!-- 上游 `Vcs.Log.PresentationSettings`（日志工具条右角、icon=GroupBy）——本仓放同一个位置。 -->
          <details class="filter presentation" @toggle="gearOpen = ($event.target as HTMLDetailsElement).open">
            <summary :title="`${LOG_VIEW_OPTIONS_TITLE}（配置日志的表示）`" :aria-label="LOG_VIEW_OPTIONS_TITLE"><Settings2 :size="14" /></summary>
            <form class="popup" @submit.prevent>
              <template v-for="row in presentationRows" :key="row.id">
                <span v-if="row.group" class="group-title" role="presentation">{{ row.title }}</span>
                <button v-for="child in row.children ?? []" :key="child.id" type="button" class="menu-button presentation-row" role="menuitemcheckbox" :aria-checked="child.checked" @click="pickPresentation(child)">
                  <span class="menu-item-icon"><Check v-if="child.checked" :size="13" /></span><span>{{ child.title }}</span>
                </button>
                <button v-if="!row.group" type="button" class="menu-button presentation-row" role="menuitemcheckbox" :aria-checked="row.checked" @click="pickPresentation(row)">
                  <span class="menu-item-icon"><Check v-if="row.checked" :size="13" /></span><span>{{ row.title }}</span>
                </button>
              </template>
            </form>
          </details>
        </div>
        <p v-if="!isDesktop" class="note">浏览器预览没有 VCS 日志，请在桌面端使用。</p>
        <p v-if="error" class="error" role="alert">{{ error }}</p>
        <p v-if="navigating" class="note" role="status">正在定位提交…</p>
        <VcsLogTable ref="table" :loading="loading" :commits="commits" :selected="selected" :root="root" :show-tag-names="showTagNames" :show-root-names="showRootNames" :hidden="hidden" @select="select" @copy="copyHash" @more="more">
          <div v-if="loading" class="empty" role="status">加载中…</div>
          <div v-else-if="!commits.length" class="empty">{{ loaded ? '没有匹配的提交。' : '打开 Git 仓库后显示提交图。' }}</div>
          <button v-if="hasMore" class="load-more" :disabled="loading" @click="load(true)">加载更多提交</button>
        </VcsLogTable>
      </template>
      <template #second>
        <VcsLogSplitter vertical :storage-key="`${layoutKey}.details.splitter.proportion`" :second-visible="showDetails">
          <template #first><VcsLogChanges :changes="changes" :selected="!!selectedCommit" :loading="changesLoading" :error="changesError" @select="previewChange = $event" /></template>
          <template #second><VcsLogDetails :commit="selectedCommit" :details="details" :busy="busy" :loading="detailsLoading" :error="detailsError" @copy="copyHash" @cherry-pick="cherryPick" @navigate="jump" /></template>
        </VcsLogSplitter>
      </template>
    </VcsLogSplitter>
      </template>
      <template #second><VcsLogDiff :root="root" :change="previewChange" @close="previewChange = null" /></template>
    </VcsLogSplitter>
  </div>
</template>

<style scoped>
.vcslog-panel { display: flex; flex: 1; min-width: 0; min-height: 0; }
.vcslog-toolbar { position: relative; display: flex; align-items: center; gap: 4px; min-height: 30px; padding: 0 6px; border-bottom: 1px solid var(--line); }
.count { color: var(--muted); font-size: 10px; }
.note, .error { margin: 0; padding: 6px 10px; font-size: 11px; overflow-wrap: anywhere; }
.note { color: var(--muted); }
.error { color: var(--error); border-bottom: 1px solid var(--line); }
.empty { padding: 12px; color: var(--muted); font-size: 11px; }
.load-more { display: block; margin: 8px auto; padding: 4px 12px; color: var(--text); background: var(--editor); border: 1px solid var(--line); font-size: 11px; }
/* 日志窗口自己的「视图选项」齿轮（上游 `Vcs.Log.PresentationSettings` 在工具条右角）。
   弹层定位与过滤器的 `<details>` 同一套（右对齐、贴着工具条下沿），只是内容是一列勾选项。 */
.presentation { position: relative; flex-shrink: 0; font-size: 11px; color: var(--muted); }
.presentation summary { list-style: none; cursor: pointer; padding: 4px; display: flex; align-items: center; }
.presentation summary::-webkit-details-marker { display: none; }
.presentation .popup { position: absolute; top: 29px; right: 0; z-index: 5; width: max-content; min-width: 160px; display: flex; flex-direction: column; gap: 2px; padding: 4px; border: 1px solid var(--line); border-radius: var(--radius-xs); background: var(--elevated); color: var(--popup-foreground); box-shadow: var(--popup-shadow); }
.presentation .group-title { padding: 4px var(--space-2) 2px; color: var(--muted); font-size: 10px; }
.presentation-row { display: flex; align-items: center; gap: var(--space-2); width: 100%; justify-content: flex-start; text-align: left; white-space: nowrap; }
</style>
