<script setup lang="ts">
import { computed, ref, toRef, watch } from 'vue'
import { RefreshCw, PanelRight, ArrowLeft, ArrowRight, Settings2 } from 'lucide-vue-next'
import { Check } from 'lucide-vue-next'
import { copyToClipboard } from '../clipboard'
import { isDesktop, type GitCommitChange, type GitLogQuery } from '../bridge'
import VcsLogDiff from './VcsLogDiff.vue'
import { useVcsLogData } from '../vcsLogData'
import VcsLogTable from './VcsLogTable.vue'
import VcsLogSplitter from './VcsLogSplitter.vue'
import VcsLogChanges from './VcsLogChanges.vue'
import VcsLogDetails from './VcsLogDetails.vue'
import VcsLogFilters from './VcsLogFilters.vue'
import VcsLogGoToRef from './VcsLogGoToRef.vue'
import { hiddenColumns, toggleColumn, type LogColumn } from '../vcsLogColumns'
import { isEmptyLogQuery, logFilterStorageKey, parseLogQuery, serializeLogQuery } from '../vcsLogFilterStore'
import { LOG_VIEW_OPTIONS_TITLE, logPresentationModel } from '../vcsLogPresentation'
import { LOG_NO_MATCHING_COMMITS, LOG_RESET_FILTERS, logCommitMenu, logRefMenu, type LogMenuRow } from '../vcsLogMenu'
import { logDate } from '../vcsLogGraph'
import { iconSize } from '../uiIcons'

const props = defineProps<{ root: string; active: boolean; showTagNames?: boolean; showRootNames?: boolean }>()
// 「标签名称」是**项目设置**（`vcsLog.showTagNames`），写回走宿主；其余行是本窗口自己的排布。
const emit = defineEmits<{ setTagNames: [value: boolean] }>()
const { commits, selected, query, loading, loaded, hasMore, error, details, changes, detailsLoading, changesLoading,
  canBack, canForward, travel, select, detailsError, changesError, busy, navigating, selectedCommit, load, applyQuery, navigate, cherryPick,
  resetTo, uncommit, createTagOn, deleteTag, scope } =
  useVcsLogData(toRef(props, 'root'), toRef(props, 'active'), () => {
    try { return parseLogQuery(localStorage.getItem(logFilterStorageKey(props.root))) } catch { return {} }
  })
// 用户显式「应用」过滤才存档（上游 `VcsLogUiPropertiesImpl` 的过滤值持久化）：
// 导航/历史回溯只改 query，不该把「跳到某个提交」当成过滤条件记下来。
function applyLogFilter(value: GitLogQuery) {
  applyQuery(value)
  try { localStorage.setItem(logFilterStorageKey(props.root), isEmptyLogQuery(value) ? '' : serializeLogQuery(value)) } catch { /* Session-only. */ }
}
/** `vcs.log.reset.filters.status.action` 的入口：只有「有过滤却一条都没命中」时才出现。 */
const filtersActive = computed(() => !isEmptyLogQuery(query.value))
function resetLogFilter() { applyLogFilter({}) }
const previewChange = ref<GitCommitChange | null>(null)
// 提交行的右键菜单（`Vcs.Log.ContextMenu` 一族）：行模型与文案在 `src/vcsLogMenu.ts`。
const panel = ref<HTMLElement>()
const menu = ref<{ hash: string; shortHash: string; isHead: boolean; x: number; y: number } | null>(null)
// 引用 chip 的菜单（同一次只开一个）。
const refMenu = ref<{ name: string; type: 'local' | 'remote' | 'tag' | 'head'; x: number; y: number } | null>(null)
const menuRows = computed<LogMenuRow[]>(() => {
  const row = menu.value
  if (!row) return []
  const commit = commits.value.find(c => c.hash === row.hash)
  return logCommitMenu(
  { hash: row.hash, shortHash: row.shortHash, isHead: row.isHead, subject: commit?.subject, author: commit?.author, dateText: logDate(commit?.date ?? ''), parents: commit?.parents ?? [] },
  {
    copy: () => { copyHash(); closeMenu() },
    reset: () => {
      const hash = menu.value?.hash ?? ''
      closeMenu()
      // `Git.Reset.In.Log` 落到原生是 `git reset <mode> <commit>`；三档模式照 IDEA 的重置对话框。
      const mode = window.prompt('重置模式：\n  soft — 保留更改在暂存区\n  mixed — 保留更改在工作区\n  hard — 丢弃全部更改', 'mixed')
      const chosen = (mode ?? '').trim().toLowerCase()
      if (!chosen) return
      if (!['soft', 'mixed', 'hard'].includes(chosen)) { error.value = '模式只能是 soft、mixed 或 hard。'; return }
      void resetTo(hash, chosen)
    },
    uncommit: () => { closeMenu(); void uncommit() },
    createTag: () => {
      const hash = menu.value?.hash ?? ''
      closeMenu()
      const name = window.prompt('标签名（指向这次提交）', '')
      if (!name?.trim()) return
      void createTagOn(hash, name.trim())
    },
    // 上游 `VcsLogNavigationUtil.jumpToGraphRow`：选中那一行（本仓的 navigate 也会按需加载它的历史）。
    goTo: hash => { closeMenu(); void jump(hash) },
  }, commits.value.map(c => ({ hash: c.hash, shortHash: c.shortHash, isHead: false, subject: c.subject, author: c.author, dateText: logDate(c.date), parents: c.parents })))
})
function openMenu(payload: { hash: string; x: number; y: number }) {
  const commit = commits.value.find(c => c.hash === payload.hash)
  // 用面板自己的盒子换算（工具窗口内容可能带 transform/滚动，`position: fixed` 不可靠）。
  const box = panel.value?.getBoundingClientRect()
  const x = box ? payload.x - box.left : payload.x
  const y = box ? payload.y - box.top : payload.y
  // `GitUncommitAction.update` 的 `isHeadCommit()`：HEAD 那一行在日志里带一个 head 引用。
  const isHead = Boolean(commit?.refs?.some(ref => ref.type === 'head'))
  select(payload.hash)
  menu.value = { hash: payload.hash, shortHash: commit?.shortHash ?? payload.hash.slice(0, 8), isHead, x, y }
}
function openRefMenu(payload: { name: string; type: 'local' | 'remote' | 'tag' | 'head'; x: number; y: number }) {
  const box = panel.value?.getBoundingClientRect()
  const rows = logRefMenu({ name: payload.name, type: payload.type }, { deleteTag: name => void deleteTag(name) })
  if (!rows.length) return
  menu.value = null
  refMenu.value = { ...payload, x: box ? payload.x - box.left : payload.x, y: box ? payload.y - box.top : payload.y }
}
const refMenuRows = computed<LogMenuRow[]>(() => refMenu.value
  ? logRefMenu({ name: refMenu.value.name, type: refMenu.value.type }, { deleteTag: name => { closeMenu(); void deleteTag(name) } })
  : [])
function closeMenu() { menu.value = null; refMenu.value = null }
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
  <div ref="panel" class="vcslog-panel">
    <!-- MainFrame: table+toolbar left; changes above details right; initial ratios 0.7. -->
    <VcsLogSplitter vertical :storage-key="`${layoutKey}.diff.splitter.proportion`" :second-visible="!!previewChange">
      <template #first>
    <VcsLogSplitter :key="root" :storage-key="`${layoutKey}.changes.splitter.proportion`">
      <template #first>
        <div class="vcslog-toolbar" role="toolbar" aria-label="日志过滤与显示">
          <VcsLogFilters :query="query" @apply="applyLogFilter" />
          <button class="icon-button" title="后退" aria-label="日志导航后退" :disabled="!canBack" @click="history('back')"><ArrowLeft :size="iconSize.control" /></button>
          <button class="icon-button" title="前进" aria-label="日志导航前进" :disabled="!canForward" @click="history('forward')"><ArrowRight :size="iconSize.control" /></button>
          <span class="count" :title="`已加载 ${commits.length} 条提交`">{{ commits.length }}{{ hasMore ? '+' : '' }}</span>
          <button class="icon-button" title="刷新" aria-label="刷新提交历史" :disabled="!isDesktop || !root || loading" @click="load()"><RefreshCw :size="iconSize.control" /></button>
          <button class="icon-button" title="显示提交详情" aria-label="显示提交详情" :aria-pressed="showDetails" @click="toggleDetails"><PanelRight :size="iconSize.control" /></button>
          <!-- 上游 `Vcs.Log.PresentationSettings`（日志工具条右角、icon=GroupBy）——本仓放同一个位置。 -->
          <details class="filter presentation" @toggle="gearOpen = ($event.target as HTMLDetailsElement).open">
            <summary :title="`${LOG_VIEW_OPTIONS_TITLE}（配置日志的表示）`" :aria-label="LOG_VIEW_OPTIONS_TITLE"><Settings2 :size="iconSize.control" /></summary>
            <form class="popup" @submit.prevent>
              <template v-for="row in presentationRows" :key="row.id">
                <span v-if="row.group" class="group-title" role="presentation">{{ row.title }}</span>
                <button v-for="child in row.children ?? []" :key="child.id" type="button" class="menu-button presentation-row" role="menuitemcheckbox" :aria-checked="child.checked" @click="pickPresentation(child)">
                  <span class="menu-item-icon"><Check v-if="child.checked" :size="iconSize.menu" /></span><span>{{ child.title }}</span>
                </button>
                <button v-if="!row.group" type="button" class="menu-button presentation-row" role="menuitemcheckbox" :aria-checked="row.checked" @click="pickPresentation(row)">
                  <span class="menu-item-icon"><Check v-if="row.checked" :size="iconSize.menu" /></span><span>{{ row.title }}</span>
                </button>
              </template>
            </form>
          </details>
          <!-- `Vcs.Log.GoToRef`（`intellij.platform.vcs.log.impl.xml:290`，挂在
               `Vcs.Log.Toolbar.RightCorner` 里、排在「视图选项」之后）。 -->
          <VcsLogGoToRef :commits="commits" :navigating="navigating" @go-to="jump" />
        </div>
        <p v-if="!isDesktop" class="note">浏览器预览没有 VCS 日志，请在桌面端使用。</p>
        <p v-if="error" class="error" role="alert">{{ error }}</p>
        <p v-if="navigating" class="note" role="status">正在定位提交…</p>
        <VcsLogTable ref="table" :loading="loading" :commits="commits" :selected="selected" :root="root" :show-tag-names="showTagNames" :show-root-names="showRootNames" :hidden="hidden" @select="select" @copy="copyHash" @more="more" @menu="openMenu" @ref-menu="openRefMenu">
          <div v-if="loading" class="empty" role="status">加载中…</div>
          <!-- `vcs.log.no.commits.matching.status` + `vcs.log.reset.filters.status.action`
               （`VcsLogBundle.properties:151-152`）：有过滤却一条都没命中时给一个真的重置入口，
               不是一句死文案。 -->
          <div v-else-if="!commits.length && loaded && filtersActive" class="empty">
            <p>{{ LOG_NO_MATCHING_COMMITS }}</p>
            <button class="load-more" @click="resetLogFilter">{{ LOG_RESET_FILTERS }}</button>
          </div>
          <div v-else-if="!commits.length" class="empty">{{ loaded ? LOG_NO_MATCHING_COMMITS : '打开 Git 仓库后显示提交图。' }}</div>
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
    <!-- 提交行的右键菜单：`Vcs.Log.ContextMenu`（平台组）+ `Git.Log.ContextMenu`（Git 追加）里本仓有落点的四条
         （模型与文案见 src/vcsLogMenu.ts，其余条目逐条记了不做原因）。 -->
    <div v-if="menu || refMenu" class="log-menu-backdrop" @click="closeMenu" @contextmenu.prevent="closeMenu">
      <div class="log-menu" role="menu" :style="{ left: `${(menu ?? refMenu)!.x}px`, top: `${(menu ?? refMenu)!.y}px` }">
        <template v-for="(row, index) in (menu ? menuRows : refMenuRows)" :key="row.id">
          <div v-if="row.separatorBefore && index" class="log-menu-separator" role="separator" />
          <button type="button" class="menu-button" role="menuitem" :title="row.description" :disabled="row.disabled" :aria-disabled="row.disabled" @click.stop="row.run?.()">{{ row.title }}</button>
        </template>
      </div>
    </div>
  </div>
</template>

<style scoped>
.vcslog-panel { position: relative; display: flex; flex: 1; min-width: 0; min-height: 0; }
/* 提交行右键菜单：背景层铺满窗口（点外面关掉），菜单位置用鼠标坐标（position: fixed）。 */
.log-menu-backdrop { position: absolute; inset: 0; z-index: 40; }
.log-menu { position: absolute; min-width: 180px; padding: var(--space-1); display: flex; flex-direction: column; background: var(--popup); border: 1px solid var(--line); border-radius: var(--radius-sm); box-shadow: var(--shadow-3); }
.log-menu .menu-button { text-align: left; white-space: nowrap; }
.log-menu-separator { height: 1px; margin: var(--space-1) 0; background: var(--line); }
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
