<script setup lang="ts">
import { computed, ref, toRef, watch } from 'vue'
import { RefreshCw, PanelRight, ArrowLeft, ArrowRight } from 'lucide-vue-next'
import { copyToClipboard } from '../clipboard'
import { isDesktop, type GitCommitChange } from '../bridge'
import VcsLogDiff from './VcsLogDiff.vue'
import { useVcsLogData } from '../vcsLogData'
import VcsLogTable from './VcsLogTable.vue'
import VcsLogSplitter from './VcsLogSplitter.vue'
import VcsLogChanges from './VcsLogChanges.vue'
import VcsLogDetails from './VcsLogDetails.vue'
import VcsLogFilters from './VcsLogFilters.vue'

const props = defineProps<{ root: string; active: boolean; showTagNames?: boolean; showRootNames?: boolean }>()
const { commits, selected, query, loading, loaded, hasMore, error, details, changes, detailsLoading, changesLoading,
  canBack, canForward, travel, select, detailsError, changesError, busy, navigating, selectedCommit, load, applyQuery, navigate, cherryPick, scope } =
  useVcsLogData(toRef(props, 'root'), toRef(props, 'active'))
const previewChange = ref<GitCommitChange | null>(null)
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
        </div>
        <p v-if="!isDesktop" class="note">浏览器预览没有 VCS 日志，请在桌面端使用。</p>
        <p v-if="error" class="error" role="alert">{{ error }}</p>
        <p v-if="navigating" class="note" role="status">正在定位提交…</p>
        <VcsLogTable ref="table" :loading="loading" :commits="commits" :selected="selected" :root="root" :show-tag-names="showTagNames" :show-root-names="showRootNames" @select="select" @copy="copyHash" @more="more">
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
</style>
