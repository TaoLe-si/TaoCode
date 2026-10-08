<script setup lang="ts">
import { computed, ref, toRef, watch } from 'vue'
import { RefreshCw, PanelRight, ArrowLeft, ArrowRight, Settings2 } from 'lucide-vue-next'
import { copyToClipboard } from '../clipboard'
import { isDesktop, type GitCommitChange, type GitFullCommit, type GitLogQuery } from '../bridge'
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
import { LOG_PRESENTATION_DEFAULTS, LOG_VIEW_OPTIONS_TITLE, logPresentationModel } from '../vcsLogPresentation'
import { LOG_NO_MATCHING_COMMITS, LOG_RESET_FILTERS, logCommitMenu, logRefMenu, type LogMenuRow } from '../vcsLogMenu'
import { canCollapseLinearBranches, clickLinearFragment, collapsedLinearSpans } from '../vcsLogGraph'
import type { CollapsedSpan } from '../vcsLogGraph'
import { prettyLogDate } from '../vcsLogDisplay.ts'
import type { DateTimeFormatSettings } from '../dateTimeFormat.ts'
import { iconSize } from '../uiIcons'
// 菜单行的勾选记号 = `AllIcons.Actions.Checked`（`expui/actions/checked.svg`），不是 lucide 的 24 格图。
import { IdeaCheckedIcon } from './icons/toolWindowIcons.ts'

const props = defineProps<{ root: string; active: boolean; dateFormat?: DateTimeFormatSettings; showTagNames?: boolean; showRootNames?: boolean }>()
// 「标签名称」是项目设置；「提交时间戳」是应用级偏好；其余视图行是本窗口自己的排布。
const emit = defineEmits<{ setTagNames: [value: boolean] }>()
const preferCommitDate = ref<boolean>(LOG_PRESENTATION_DEFAULTS.preferCommitDate)
try { preferCommitDate.value = localStorage.getItem('taocode.vcs.log.preferCommitDate') === 'true' } catch { /* Use the default. */ }
const dateText = (commit: GitFullCommit | undefined) => prettyLogDate(
  preferCommitDate.value ? commit?.committerDate ?? '' : commit?.date ?? '', Date.now(), props.dateFormat)
const { commits, selected, query, loading, loaded, hasMore, error, details, changes, detailsLoading, changesLoading,
  canBack, canForward, travel, select, detailsError, changesError, busy, navigating, selectedCommit, load, applyQuery, navigate, cherryPick,
  resetTo, uncommit, createTagOn, deleteTag, loadBranchNames, loadTagNames, scope, currentBranch, branchTrackInfos, isOnBranch } =
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
  { hash: row.hash, shortHash: row.shortHash, isHead: row.isHead, subject: commit?.subject, author: commit?.author, dateText: dateText(commit), parents: commit?.parents ?? [] },
  {
    copy: () => { copyRevision(row.hash); closeMenu() },
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
  }, commits.value.map(c => ({ hash: c.hash, shortHash: c.shortHash, isHead: false, subject: c.subject, author: c.author, dateText: dateText(c), parents: c.parents })))
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
function setPreferCommitDate(value: boolean) {
  preferCommitDate.value = value
  try { localStorage.setItem('taocode.vcs.log.preferCommitDate', String(value)) } catch { /* Session-only. */ }
}
// 「视图选项」的偏好按上游作用域分开：`preferCommitDate` 在应用级单独存；其余本窗口排布按仓库根存。
// 上游把其余值再分两层：`compactReferences` / `alignLabels` / `showChangesFromParents` / `diffPreviewAtBottom`
// 在应用级 `VcsLogApplicationSettings.kt`，而 `showLongEdges` 在日志 UI 级 `VcsLogUiPropertiesImpl.kt:121-122`。
// **订正留痕**：这一段原写"这些值都在 `VcsLogApplicationSettings.kt:106-122`"—— 长边那一条不在那份 State 里，
// 收尾复核按两个文件逐行打开后分开写。本仓五档一律按仓库根存（作用域与上游不同一条，已登记在归属报告）。
// 缺省值抄 `LOG_PRESENTATION_DEFAULTS`；旧存档缺键 = 用缺省，**不按字段数量判损坏**（这一族本来就是可缺的视图偏好）。
const viewPrefs = ref<{ compactReferences: boolean; showLongEdges: boolean; alignLabels: boolean;
  diffPreviewAtBottom: boolean; showChangesFromParents: boolean }>({
  compactReferences: LOG_PRESENTATION_DEFAULTS.compactReferences,
  showLongEdges: LOG_PRESENTATION_DEFAULTS.showLongEdges,
  alignLabels: LOG_PRESENTATION_DEFAULTS.alignLabels,
  diffPreviewAtBottom: LOG_PRESENTATION_DEFAULTS.diffPreviewAtBottom,
  showChangesFromParents: LOG_PRESENTATION_DEFAULTS.showChangesFromParents,
})
function viewPrefKey(id: string) { return `taocode.vcs.log.${encodeURIComponent(props.root)}.${id}` }
function readViewPref(id: string, fallback: boolean): boolean {
  try {
    const raw = localStorage.getItem(viewPrefKey(id))
    return raw === null ? fallback : raw === 'true'
  } catch { return fallback }
}
const viewPrefKeys = ['compactReferences', 'showLongEdges', 'alignLabels', 'diffPreviewAtBottom', 'showChangesFromParents'] as const
// 「收起线性分支」的状态 = **收起着的那几条链**（不是一句布尔）：菜单里那两条按钮收全部/展全部
// （上游 `Vcs.Log.CollapseAll` / `Vcs.Log.ExpandAll`），在图形上点一次只动那一条
// （上游 `GraphCommitCellController.java:58-64` 的 MOUSE_CLICK ⇒ `LINEAR_COLLAPSE_CASE` / `LINEAR_EXPAND_CASE`）。
// 两种写法都只影响已加载这一页的可见行。
const collapsedSpans = ref<CollapsedSpan[]>([])
const collapsed = computed(() => collapsedSpans.value.length > 0)
function setCollapsedAll(value: boolean) { collapsedSpans.value = value ? collapsedLinearSpans(commits.value) : [] }
function foldFragment(hash: string) {
  const next = clickLinearFragment(commits.value, collapsedSpans.value, hash)
  if (next) collapsedSpans.value = next
}
const canCollapse = computed(() => canCollapseLinearBranches(commits.value))
watch(() => props.root, () => {
  for (const id of viewPrefKeys) viewPrefs.value[id] = readViewPref(id, LOG_PRESENTATION_DEFAULTS[id])
  // 折叠是**视图态**（上游记在图上、不进 UI 属性）⇒ 换仓库根就回到展开态。
  collapsedSpans.value = []
}, { immediate: true })
function setViewPref(id: typeof viewPrefKeys[number], value: boolean) {
  viewPrefs.value = { ...viewPrefs.value, [id]: value }
  try { localStorage.setItem(viewPrefKey(id), String(value)) } catch { /* Session-only. */ }
}
// 日志窗口自己的齿轮（上游 `Vcs.Log.PresentationSettings`，日志工具条右角）：模型在
// src/vcsLogPresentation.ts，只给真能接住的行（未接项登记在 docs/source-todo.md §11）。
const gearOpen = ref(false)
const presentationRows = computed(() => logPresentationModel(
  { showTagNames: props.showTagNames !== false, hidden: hidden.value, ...viewPrefs.value, preferCommitDate: preferCommitDate.value },
  { setShowTagNames: value => emit('setTagNames', value), toggleColumn: toggleLogColumn,
    setPreferCommitDate,
    setCompactReferences: value => setViewPref('compactReferences', value),
    setShowLongEdges: value => setViewPref('showLongEdges', value),
    setAlignLabels: value => setViewPref('alignLabels', value),
    setDiffPreviewAtBottom: value => setViewPref('diffPreviewAtBottom', value),
    setShowChangesFromParents: value => setViewPref('showChangesFromParents', value) }))
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
/** 写系统剪贴板（走 `src/clipboard.ts` 那一处真源：同时进剪贴板环）。失败时回落 execCommand，再不行才报错。 */
async function writeClipboard(text: string, failure: string) {
  if (!text) return
  const current = scope()
  try { await copyToClipboard(text) }
  catch {
    if (!current()) return
    try { if (copyFallback(text)) return } catch { /* Show the manual-copy fallback. */ }
    error.value = failure
  }
}
/**
 * 「复制修订号」= `Vcs.CopyRevisionNumberAction`：完整哈希
 * （`platform/vcs-log/impl/src/com/intellij/vcs/log/util/VcsLogUtil.java:231-232` 给的是
 * `TextRevisionNumber(hash.asString(), ...)`，而 `platform/vcs-impl/src/com/intellij/openapi/vcs/history/actions/CopyRevisionNumberAction.java:34-36`
 * 拼的是 `asString()` ⇒ 40 位那一条，不是行上显示的那 7 位短哈希）。
 * 上游多选时是"旧→新、空格分隔"（同文件 `:24` 的 `ContainerUtil.reverse` + `:35` 的 join " "）——
 * 本仓日志是单选，那条拼装路径走不到，所以这里不预置多选代码。
 */
function copyRevision(hash: string) { void writeClipboard(hash, '无法写入剪贴板，请手动选中详情里的完整哈希复制。') }
/** 表格里的 Ctrl+C = 上游 `performCopy` 的整行文本（可见列 `" "` 分隔，`VcsLogGraphTable.java:690-709`）。 */
function copyRowText(text: string) { void writeClipboard(text, '无法写入剪贴板，请手动选中日志行复制。') }
function copyHash() { if (selectedCommit.value) copyRevision(selectedCommit.value.hash) }
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
    <VcsLogSplitter :vertical="viewPrefs.diffPreviewAtBottom" :storage-key="`${layoutKey}.diff.splitter.proportion`" :second-visible="!!previewChange">
      <template #first>
    <VcsLogSplitter :key="root" :storage-key="`${layoutKey}.changes.splitter.proportion`">
      <template #first>
        <div class="vcslog-toolbar" role="toolbar" aria-label="日志过滤与显示">
          <VcsLogFilters :query="query" :collapsed="collapsed" :can-collapse="canCollapse" @apply="applyLogFilter" @set-collapsed="setCollapsedAll" />
          <button class="icon-button" title="后退" aria-label="日志导航后退" :disabled="!canBack" @click="history('back')"><ArrowLeft :size="iconSize.control" /></button>
          <button class="icon-button" title="前进" aria-label="日志导航前进" :disabled="!canForward" @click="history('forward')"><ArrowRight :size="iconSize.control" /></button>
          <span class="count" :title="`已加载 ${commits.length} 条提交`">{{ commits.length }}{{ hasMore ? '+' : '' }}</span>
          <button class="icon-button" title="刷新" aria-label="刷新提交历史" :disabled="!isDesktop || !root || loading" @click="load()"><RefreshCw :size="iconSize.control" /></button>
          <button class="icon-button" title="显示提交详情" aria-label="显示提交详情" :aria-pressed="showDetails" @click="toggleDetails"><PanelRight :size="iconSize.control" /></button>
          <!-- 上游 `Vcs.Log.PresentationSettings`（日志工具条右角、icon=GroupBy）——本仓放同一个位置。 -->
          <details class="filter presentation" @toggle="gearOpen = ($event.target as HTMLDetailsElement).open">
            <summary :title="LOG_VIEW_OPTIONS_TITLE" :aria-label="LOG_VIEW_OPTIONS_TITLE"><Settings2 :size="iconSize.control" /></summary>
            <form class="popup" @submit.prevent>
              <template v-for="row in presentationRows" :key="row.id">
                <span v-if="row.group" class="group-title" role="presentation">{{ row.title }}</span>
                <button v-for="child in row.children ?? []" :key="child.id" type="button" class="menu-button presentation-row" role="menuitemcheckbox" :aria-checked="child.checked" :aria-disabled="child.disabled" :disabled="child.disabled" @click="pickPresentation(child)">
                  <span class="menu-item-icon"><IdeaCheckedIcon v-if="child.checked" :size="iconSize.menu" /></span><span>{{ child.title }}</span>
                </button>
                <button v-if="!row.group" type="button" class="menu-button presentation-row" role="menuitemcheckbox" :aria-checked="row.checked" :disabled="row.disabled" :aria-disabled="row.disabled" @click="pickPresentation(row)">
                  <span class="menu-item-icon"><IdeaCheckedIcon v-if="row.checked" :size="iconSize.menu" /></span><span>{{ row.title }}</span>
                </button>
              </template>
            </form>
          </details>
          <!-- `Vcs.Log.GoToRef`（`intellij.platform.vcs.log.impl.xml:290`，挂在
               `Vcs.Log.Toolbar.RightCorner` 里、排在「视图选项」之后）。 -->
          <VcsLogGoToRef :commits="commits" :navigating="navigating" :load-branches="loadBranchNames" :load-tags="loadTagNames" @go-to="jump" />
        </div>
        <p v-if="!isDesktop" class="note">浏览器预览没有 VCS 日志，请在桌面端使用。</p>
        <p v-if="error" class="error" role="alert">{{ error }}</p>
        <p v-if="navigating" class="note" role="status">正在定位提交…</p>
        <VcsLogTable ref="table" :loading="loading" :commits="commits" :selected="selected" :root="root" :date-format="dateFormat" :prefer-commit-date="preferCommitDate" :show-tag-names="showTagNames" :show-root-names="showRootNames" :hidden="hidden" :current-branch="currentBranch" :branch-track-infos="branchTrackInfos" :is-on-branch="isOnBranch"
          :compact-references="viewPrefs.compactReferences" :align-labels="viewPrefs.alignLabels" :show-long-edges="viewPrefs.showLongEdges" :collapsed="collapsedSpans"
          @select="select" @copy="copyRowText" @copy-revision="copyHash" @fold="foldFragment" @more="more" @menu="openMenu" @ref-menu="openRefMenu">
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
          <template #first><VcsLogChanges :changes="changes" :selected="!!selectedCommit" :loading="changesLoading" :error="changesError" :from-parents="viewPrefs.showChangesFromParents" @select="previewChange = $event" /></template>
          <template #second><VcsLogDetails :commit="selectedCommit" :details="details" :date-format="dateFormat" :busy="busy" :loading="detailsLoading" :error="detailsError" @copy="copyHash" @cherry-pick="cherryPick" @navigate="jump" /></template>
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
.vcslog-panel { position: relative; display: flex; flex: 1; min-width: 0; min-height: 0; background: var(--panel); }
/* 提交行右键菜单：背景层铺满窗口（点外面关掉），菜单位置用鼠标坐标（position: fixed）。 */
.log-menu-backdrop { position: absolute; inset: 0; z-index: 40; }
.log-menu { position: absolute; min-width: 180px; padding: var(--space-1); display: flex; flex-direction: column; background: var(--popup-background); color: var(--popup-foreground); border: var(--popup-border); border-radius: var(--popup-radius); box-shadow: var(--popup-shadow); }
.log-menu .menu-button { text-align: left; white-space: nowrap; }
.log-menu-separator { height: 1px; margin: var(--space-1) 0; background: var(--line); }
.vcslog-toolbar { position: relative; display: flex; flex: 0 0 var(--toolbar-btn-size); align-items: center; gap: var(--space-1); min-width: 0; padding: 0 var(--space-2); border-bottom: 1px solid var(--line); }
.count { flex: 0 0 auto; color: var(--muted); font-size: 10px; font-variant-numeric: tabular-nums; white-space: nowrap; }
.note, .error { margin: 0; padding: var(--space-1) var(--space-2); font-size: 11px; overflow-wrap: anywhere; }
.note { color: var(--muted); }
.error { color: var(--error); border-bottom: 1px solid var(--line); }
.empty { padding: var(--space-3); color: var(--muted); font-size: 11px; }
.load-more { display: block; min-height: var(--ctrl-height-sm); margin: var(--space-2) auto; padding: 0 var(--space-3); color: var(--text); background: var(--editor); border: 1px solid var(--line); border-radius: var(--radius-xs); font-size: 11px; cursor: pointer; transition: background-color var(--dur-1) var(--ease), border-color var(--dur-1) var(--ease); }
.load-more:hover:not(:disabled) { background: var(--hover); border-color: var(--line-strong); }
/* 日志窗口自己的「视图选项」齿轮（上游 `Vcs.Log.PresentationSettings` 在工具条右角）。
   弹层定位与过滤器的 `<details>` 同一套（右对齐、贴着工具条下沿），只是内容是一列勾选项。 */
.presentation { position: relative; flex-shrink: 0; font-size: 11px; color: var(--muted); }
.presentation summary { box-sizing: border-box; display: flex; align-items: center; justify-content: center; width: var(--toolbar-btn-size); height: var(--toolbar-btn-size); padding: 0; border-radius: var(--toolbar-btn-arc); color: var(--secondary); list-style: none; cursor: pointer; transition: background-color var(--dur-1) var(--ease), color var(--dur-1) var(--ease); }
.presentation summary:hover, .presentation[open] summary { background: var(--hover); color: var(--bright); }
.presentation summary::-webkit-details-marker { display: none; }
.presentation .popup { position: absolute; top: calc(var(--toolbar-btn-size) - 1px); right: 0; z-index: 5; width: max-content; min-width: 160px; display: flex; flex-direction: column; gap: 2px; padding: var(--space-1); border: var(--popup-border); border-radius: var(--popup-radius); background: var(--elevated); color: var(--popup-foreground); box-shadow: var(--popup-shadow); }
.presentation .group-title { padding: var(--space-1) var(--space-2); color: var(--muted); font-size: 10px; }
.presentation-row { display: flex; align-items: center; gap: var(--space-2); width: 100%; justify-content: flex-start; text-align: left; white-space: nowrap; }
</style>
