<script setup lang="ts">
import { computed, nextTick, onMounted, onBeforeUnmount, ref, watch } from 'vue'
import { TriangleAlert } from 'lucide-vue-next'
import { useLogViewport } from '../vcsLogViewport'
import VcsLogColumns from './VcsLogColumns.vue'
import SpeedSearchBar from './SpeedSearchBar.vue'
import type { GitFullCommit, GitRef } from '../bridge'
import type { GitBranchTrackInfo } from '../vcsLogTypes'
import { iconSize } from '../uiIcons'
import { clickLinearFragment, collapseLinearGraph, clickableLinearHashes, rootColor, ROW_H } from '../vcsLogGraph'
import type { LinearCollapseState } from '../vcsLogGraph'
import { GRAPH_LINE_WIDTH, paintGraphRow } from '../vcsLogGraphRender'
import { visibleColumns, type LogColumn } from '../vcsLogColumns'
import { prettyLogDate } from '../vcsLogDisplay'
import type { DateTimeFormatSettings } from '../dateTimeFormat.ts'
import { LOG_DETACHED_HEAD_TOOLTIP, logCommitTooltip, logRefAvailableWidth, logRefGroups, logRefTooltip, logRowCopyText, logSpeedSearchColumns } from '../vcsLogPresentation'
import type { LogRefGroup } from '../vcsLogPresentation'
import { isSpeedSearchTypeable, speedSearchKeyAction, speedSearchMatches, speedSearchStepForKey, speedSearchWalk } from '../speedSearch'
const props = withDefaults(defineProps<{ commits: GitFullCommit[]; selected: string; root: string; loading?: boolean; dateFormat?: DateTimeFormatSettings; preferCommitDate?: boolean; showTagNames?: boolean;
  showRootNames?: boolean; hidden?: LogColumn[]; compactReferences?: boolean; alignLabels?: boolean; showLongEdges?: boolean;
  collapsed?: LinearCollapseState; currentBranch?: string; branchTrackInfos?: GitBranchTrackInfo[]; isOnBranch?: boolean }>(), {
  // `isOnBranch` 是**三态**：不给 = 仓库状态未知，不编警示组（`logRefGroups` 只在 `=== false` 时才独立成组）。
  // Vue 的布尔档会把"没传"折成 false ⇒ 那时每个带 HEAD 的行都会长出一枚「Detached HEAD」警示 chip
  // （默认值给了 `undefined` 就不做这层 casting，声明的 `boolean | undefined` 才在运行时也成立）。
  isOnBranch: undefined,
})
const emit = defineEmits<{ select: [hash: string]; copy: [text: string]; copyRevision: []; more: [];
  fold: [hash: string]; menu: [{ hash: string; x: number; y: number }];
  refMenu: [{ name: string; type: 'local' | 'remote' | 'tag' | 'head'; x: number; y: number }] }>()
const list = ref<HTMLElement>()
const viewportWidth = ref(0)
const columnMetrics = ref<{ commitWidth: number; subjectWidths: Record<string, number> }>({ commitWidth: 0, subjectWidths: {} })
function setColumnMetrics(value: { commitWidth: number; subjectWidths: Record<string, number> }) { columnMetrics.value = value }
/**
 * 「日期」那一格 = 上游 `DateFormatUtil.formatPrettyDateTime`，由 `src/vcsLogDisplay.ts` 读取日期格式设置。
 * **只算一次**并供四处复用：列宽测量、速度搜索、Ctrl+C 的行文本、行 tooltip ——
 * 上游那四处吃的都是同一个 `getValueAt`（列宽 = 渲染出来的值、搜索 = `getColumnsForSpeedSearch`
 * `ui/table/VcsLogSpeedSearch.java:60-66`、复制 = `ui/table/VcsLogGraphTable.java:690-709`），
 * 分成两份字符串就会出现「看得见 3 分钟前、按 3 分 搜不到」这种自相矛盾。
 */
const dateText = (commit: GitFullCommit) => prettyLogDate(
  props.preferCommitDate ? commit.committerDate : commit.date, Date.now(), props.dateFormat)
const columnRows = computed(() => visible.value.map(commit => ({ ...commit, date: dateText(commit) })))
// 「收起线性分支」= 从**已加载这一页**里去掉可合并段的中间节点（上游 `COLLAPSE_ALL` 的 hideNode，
// `platform/vcs-log/graph/src/com/intellij/vcs/log/graph/collapsing/CollapsedActionManager.java:230`），
// 并在同一次修改里于链的两端补一条 `GraphEdgeType.DOTTED` 边（同文件 `:231`）⇒ 折叠后两端之间是**虚线**，
// 不是两段互不相连的行。两件事都在 `collapseLinearGraph()` 里一次做完（分两步调会丢掉那条边：
// 被收起的提交不在可见列表 ⇒ `buildLogGraph` 查不到父哈希 ⇒ 边不生成）。
// `collapsed` 可以是布尔（菜单里那两条「收起/展开线性分支」= 全部）或**跨度数组**（在图形上点一次 = 只动那一条，
// 上游 `GraphCommitCellController.java:58-64` 的 MOUSE_CLICK）⇒ 表、视口、键盘导航、aria 全按这一份 visible 走。
const folded = computed(() => collapseLinearGraph(props.commits, props.collapsed ?? false,
  { showLongEdges: props.showLongEdges === true, graphInformation: true }))
const visible = computed(() => folded.value.visible)
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
// 但**提交列不在这份名单里**：上游那个组给的是 `getDynamicColumns()` = Author / Hash / Date
// （`platform/vcs-log/impl/src/com/intellij/vcs/log/ui/actions/ToggleLogColumnsActionGroup.java:48-51`
// → `ui/table/column/VcsLogColumnUtil.kt:121-127` → `ui/table/column/VcsLogDefaultColumn.kt:43`），
// `Commit.isDynamic = false`（同文件 `:89`）而且列序存档还会把 Root/Commit **强制补回**
// （`ui/table/column/VcsLogColumnUtil.kt:18-32` 的 `isValidColumnOrder` / `makeValidColumnOrder`）
// ⇒ 上游没有「把提交列勾掉」这一档。本仓的旧存档里可能留着一条 `commit`（这一批之前的齿轮给了那个勾），
// 这里按「没勾」处理：模板里 `commit-cell` 从来不 v-if，让它参与隐藏只会得到「主题还在、被挤成 50px」的半截档
// —— 那正是「点了没真反应」的假控件形状。判据见 `tests/vcs-log-display.test.mjs`。
const hiddenForLayout = computed(() => (props.hidden ?? []).filter(column => column !== 'commit'))
const columns = computed(() => visibleColumns(['commit', 'author', 'date', 'hash'], hiddenForLayout.value))
const graph = computed(() => folded.value.graph)
const referenceWidthOf = (commit: GitFullCommit) => logRefAvailableWidth(
  columnMetrics.value.commitWidth, graph.value.width, columnMetrics.value.subjectWidths[commit.hash] ?? 0,
  props.compactReferences !== false,
)
// 每行的图形单元 → SVG 图元（`src/vcsLogGraphRender.ts`，几何全在那边，与上游画师同一套算法）。
// 索引按 `graph.rows` 一一对齐：虚拟滚动切出来的 `index` 要加回 `start` 才对上 units。
const paint = computed(() => graph.value.units.map(units => paintGraphRow(units)))
const paintOf = (index: number) => paint.value[index] ?? { strokes: [], marks: [] }
/** 一行上真正画出来的那一枚 chip（组名 + 组头那条引用 + 组内多条时才有的 tooltip）。 */
interface LogRefChip { key: string; name: string; head: GitRef; tooltip: string; warning: boolean }
/**
 * 一行画**几枚** chip、以及 chip 的**次序** = `Vcs.Log.ShowTagNames` + `Vcs.Log.CompactReferencesView` 的合成判据，
 * 模型在 `src/vcsLogPresentation.ts` 的 `logRefGroups()`（= 上游 `SimpleRefGroup.buildGroups` `impl/SimpleRefGroup.kt:27-49`
 * 排完 `GitLabelComparator` `GitRefManager.kt:96` 之后的那一趟）。
 * 紧凑档**少画**的那些引用并没有被丢掉：它们留在同一个组里，悬停 chip 那一块区域就把整组列出来
 * （`logRefTooltip()`，上游 `GraphCommitCellRenderer.kt:84-103` → `LabelPainter.createTooltip:440-451`
 * → `TooltipReferencesPanel.java:35-56`，10 条封顶）。
 * 单引用组不补这枚 tooltip：上游那面板每行还带一枚类型 icon，本仓的纯文本宿主只会退化成"把 chip 自己的名字再写一遍"。
 * `currentBranch` = 上游 CURRENT_BRANCH 的仓库分支名；`branchTrackInfos` 由 native 从 Git 配置读出，
 * 再按当前提交里实际存在的 remote ref 配对；`isOnBranch` 单独来自 HEAD symbolic ref 与 rebase 状态。
 */
const chipsOf = (commit: GitFullCommit): LogRefChip[] =>
  logRefGroups(commit.refs ?? [], {
    showTagNames: props.showTagNames !== false, compact: props.compactReferences !== false,
    currentBranch: props.currentBranch,
    branchTrackInfos: props.branchTrackInfos, isOnBranch: props.isOnBranch,
  }).map(group => {
    const head = group.refs[0]!  // 组只从引用建 ⇒ 必非空
    return { key: `${head.type}:${head.name}:${group.name}`, name: group.name, head,
      tooltip: group.warning ? LOG_DETACHED_HEAD_TOOLTIP : group.refs.length > 1 ? logRefTooltip(group.refs) : '',
      warning: group.warning === true }
  })
/** chip 的右键菜单交回去的还是**那一条引用**（组头），菜单契约 `emit('refMenu')` 一字未改。 */
function emitRefMenu(chip: LogRefChip, event: MouseEvent) {
  emit('refMenu', { name: chip.head.name, type: chip.head.type, x: event.clientX, y: event.clientY })
}
// 点一次那一行的**图形** = 收/展那一条可合并段（上游 `GraphCommitCellController.java:58-64` 的 performMouseClick
// → `:102-104` 的 `performAction(MOUSE_CLICK)`）。同一处的 `shouldSelectCell`（`:84-86`）说的是另一半：
// 鼠标下面有图形单元时**不**选中那一行 ⇒ 这里把点击吃掉（`.stop`），不往行的 @click 传。
// 手形光标那一档 = 上游 MOUSE_OVER 回 `HAND_CURSOR`（`LinearGraphUtils.java:88-95` + `:98-106`），
// 判据用 `clickableLinearHashes()`（本仓整格按这一行的提交判，不做逐单元命中 —— 已登记在批次报告）。
const foldable = computed(() => clickableLinearHashes(props.commits, props.collapsed ?? false))
function onGraphClick(hash: string) {
  if (clickLinearFragment(props.commits, props.collapsed ?? false, hash)) emit('fold', hash)
}
/** 那一行 Ctrl+C 出去的文本（上游表格自己的 `performCopy`，不是「复制修订号」）。 */
function copyTextOf(commit: GitFullCommit | undefined): string {
  if (!commit) return ''
  return logRowCopyText({ subject: commit.subject, author: commit.author, date: dateText(commit),
    hash: commit.hash, shortHash: commit.shortHash }, hiddenForLayout.value)
}
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
    { subject: commit.subject, author: commit.author, date: dateText(commit), hash: commit.hash, shortHash: commit.shortHash },
    hiddenForLayout.value,
  ).some(text => speedSearchMatches(value, text))
}
/**
 * 从 `from` 起按 `delta` 找下一条命中。一圈的回绕数学**不在这里写**：`skipFirst` 给 true 是上游
 * 的"先迈一步再找"（`findNextElement:476-499`，方向键那一档），给 false 把当前行也算进候选
 * （`findElement:519-527`，打字那一档）。
 * 匹配口径按 `VcsLogSpeedSearch.java:39-46`：**逐列**比 —— 上游 `getElementText` 直接抛
 * "Getting row text in a Log is unsupported since we match columns separately."，
 * 所以喂给 `speedSearchWalk` 的是"这一行的任一列命中"这个谓词，不是一张标签表。
 */
function searchHit(from: number, delta: 1 | -1, value: string, skipFirst: boolean): number {
  const rows = visible.value
  if (!value.trim()) return -1
  return speedSearchWalk(rows.length, from, delta, index => rowMatches(rows[index]!, value), skipFirst)
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
  // 打字那一档：当前行自己也在候选里（上游 `findElement`），from < 0 时由 `speedSearchWalk` 从头扫。
  const hit = searchHit(current, 1, value, false)
  if (hit >= 0) selectRow(hit)
}
function closeSearch() { searchOpen.value = false; search.value = '' }
function onSearchKeydown(event: KeyboardEvent) {
  // 键位归属**现问** `speedSearchKeyAction`（`SpeedSearchBase.java:958-1002` 那一族），
  // 不在组件里再抄一份"哪些键算收起 / 哪些键算导航"—— 原先这里就是自己列了一遍。
  const action = speedSearchKeyAction(event.key, search.value)
  if (action === 'hide') { event.preventDefault(); closeSearch(); void list.value?.focus(); return }
  // Enter / PageUp / PageDown / 左右键：收起搜索框、把焦点交回列表（`:965-975`），导航仍归列表。
  if (action === 'accept') { closeSearch(); void list.value?.focus(); return }
  const step = speedSearchStepForKey(event.key)
  if (!step || action !== 'navigate') return
  event.preventDefault()
  const rows = visible.value
  const current = rows.findIndex(commit => commit.hash === props.selected)
  // Home/End = `findFirstElement:539-546` / `findLastElement:548-555`：从端点起整圈扫，
  // 没有"先迈一步"这一说 ⇒ from 给 -1（端点由 `speedSearchWalk` 按方向挑）、skipFirst 给 false。
  const hit = step.kind === 'first' ? searchHit(-1, 1, search.value, false)
    : step.kind === 'last' ? searchHit(-1, -1, search.value, false)
      : searchHit(current, step.kind === 'next' ? 1 : -1, search.value, true)
  if (hit >= 0) selectRow(hit)
}
function keys(index: number, event: KeyboardEvent) {
  if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'c') {
    event.preventDefault()
    // 两条**不同**的复制，上游本来就是两个动作：
    //  · Ctrl+Alt+Shift+C = `Vcs.CopyRevisionNumberAction`（`platform/vcs-impl/resources/META-INF/VcsActions.xml:496-497`
    //    的 `use-shortcut-of="CopyReference"`，那一组键位在 `platform/platform-resources/src/keymaps/$default.xml:639-641`）
    //    ⇒ 复制**修订号**（完整哈希，`platform/vcs-log/impl/src/com/intellij/vcs/log/util/VcsLogUtil.java:231-232`）；
    //  · Ctrl+C = 表格自己的 `performCopy`（`ui/table/VcsLogGraphTable.java:690-709`）⇒ 复制**这一行看得见的列**。
    // 上游 `isCopyEnabled` 要求至少选中一行（`:717-719`）⇒ 没选中就什么都不做。
    if (event.altKey) emit('copyRevision')
    else {
      const text = copyTextOf(visible.value.find(commit => commit.hash === props.selected))
      if (text) emit('copy', text)
    }
    return
  }
  // 在列表上打字 = 打开速度搜索（`SpeedSearchBase.java:585-590` 的内置触发方式），不当成导航键。
  // 哪些字符算"打字"由那一条自己定：字母数字，或 `PUNCTUATION_MARKS`（`SpeedSearch.java:25`）里的标点，
  // **空白一律不行**（树/表那一支没有"已经在搜就放行空格"的例外，`SpeedSearchBase.java:587`）。
  if (event.key.length === 1 && !event.ctrlKey && !event.altKey && !event.metaKey && isSpeedSearchTypeable(event.key, null)) {
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
    <VcsLogColumns :storage-key="`taocode.vcs.log.${encodeURIComponent(root)}.columns`" :rows="columnRows" :viewport="viewportWidth" :root-width="showRootNames ? 101 : 6" :hidden="hiddenForLayout" @metrics="setColumnMetrics">
    <div :style="{ height: `${start * ROW_H}px` }" aria-hidden="true" />
    <div v-for="(row, index) in graph.rows.slice(start, end)" :key="row.commit.hash" class="log-row" role="option" :data-index="index + start" :aria-posinset="index + start + 1" :aria-setsize="visible.length"
      :class="{ selected: selected === row.commit.hash }" :aria-selected="selected === row.commit.hash"
      :title="logCommitTooltip({ subject: row.commit.subject, author: row.commit.author, date: dateText(row.commit), hash: row.commit.shortHash, fullHash: row.commit.hash })"
      :tabindex="selected === row.commit.hash || (!visible.some(c => c.hash === selected) && index === 0) ? 0 : -1"
      @click="emit('select', row.commit.hash)" @keydown="keys(index + start, $event)"
      @contextmenu.prevent.stop="emit('menu', { hash: row.commit.hash, x: $event.clientX, y: $event.clientY })">
      <span class="root" :class="{ named: showRootNames }" :title="root" :style="{ '--root-color': rootColor(root) }">{{ showRootNames ? rootName : '' }}</span>
      <!-- `Vcs.Log.AlignLabels`（`GraphCommitCellRenderer.kt:143-146` 的 `setLeftAligned` → 画师 `isLeftAligned`）：
           勾上 = 引用进提交格里一条**左对齐的定宽列**（消息不再被 chip 挤走），不勾 = chip 挨在消息左侧 inline。 -->
      <span class="commit-cell" :class="{ aligned: alignLabels }">
        <svg class="graph" :class="{ foldable: foldable.has(row.commit.hash) }" :width="graph.width" :height="ROW_H"
          :viewBox="`0 0 ${graph.width} ${ROW_H}`" aria-hidden="true" @click.stop="onGraphClick(row.commit.hash)">
          <!-- 每一格画的是 `graph.units[这一行]` 翻译出来的图元（= 上游那一行的 PrintElement 集合）：
               先线段（竖线/弯线/终端箭头）后圆（节点）⇒ 与上游"节点排在最后、画在边之上"同一顺序
               （`platform/vcs-log/graph/src/com/intellij/vcs/log/graph/impl/print/PrintElementGeneratorImpl.kt:128`、`:171`）。
               弯线画到格外两倍长、由本格裁掉一半，所以相邻两格在格边界上正好对接
               （`platform/vcs-log/impl/src/com/intellij/vcs/log/paint/SimpleGraphCellPainter.kt:163-169`）。
               `stroke-dasharray` 只在**非实线且不带箭头**时出现（同文件 `:127-134`）⇒ 折叠跨度那条 DOTTED 边是虚的。 -->
          <line v-for="(stroke, i) in paintOf(index + start).strokes" :key="`e${i}`"
            :x1="stroke.x1" :y1="stroke.y1" :x2="stroke.x2" :y2="stroke.y2" :stroke="stroke.color"
            :stroke-width="GRAPH_LINE_WIDTH" :stroke-dasharray="stroke.dash" />
          <circle v-for="(mark, i) in paintOf(index + start).marks" :key="`m${i}`"
            :cx="mark.cx" :cy="mark.cy" :r="mark.r" :fill="mark.color" :class="{ 'head-gap': mark.kind === 'gap' }" />
        </svg>
        <span v-if="alignLabels" class="labels" :style="{ maxWidth: `${referenceWidthOf(row.commit)}px` }">
          <span v-for="chip in chipsOf(row.commit)" :key="`a${chip.key}`" class="ref" :class="[chip.head.type, { 'detached-head': chip.warning }]"
                :title="chip.tooltip || undefined" @contextmenu.prevent.stop="emitRefMenu(chip, $event)"><TriangleAlert v-if="chip.warning" :size="iconSize.inline" aria-hidden="true" />{{ chip.name }}</span>
        </span>
        <span v-if="!alignLabels" class="references" :style="{ maxWidth: `${referenceWidthOf(row.commit)}px` }">
          <span v-for="chip in chipsOf(row.commit)" :key="chip.key" class="ref" :class="[chip.head.type, { 'detached-head': chip.warning }]"
                :title="chip.tooltip || undefined" @contextmenu.prevent.stop="emitRefMenu(chip, $event)"><TriangleAlert v-if="chip.warning" :size="iconSize.inline" aria-hidden="true" />{{ chip.name }}</span>
        </span>
        <span class="subject">{{ row.commit.subject }}</span>
      </span>
      <span v-if="columns.includes('author')" class="author" :title="row.commit.author">{{ row.commit.author }}</span>
      <span v-if="columns.includes('date')" class="date">{{ dateText(row.commit) }}</span>
      <span v-if="columns.includes('hash')" class="hash" :title="row.commit.hash">{{ row.commit.shortHash }}</span>
    </div>
    <div :style="{ height: `${(visible.length - end) * ROW_H}px` }" aria-hidden="true" />
    </VcsLogColumns>
    <slot />
  </div>
</template>

<style scoped>
.log-table { flex: 1; min-height: 0; overflow: auto; }
.log-row { display: flex; align-items: center; height: 26px; min-width: 580px; gap: var(--space-2); padding-right: var(--space-2); color: var(--text); font-size: 11px; white-space: nowrap; cursor: default; transition: background-color var(--dur-1) var(--ease); }
.log-row:hover { background: var(--hover); }
.log-row.selected { background: var(--selection); color: var(--bright); }
.log-row:focus-visible { outline: var(--focus-ring); outline-offset: var(--focus-ring-offset-inset); }
.root { align-self: stretch; flex: 0 0 6px; background: var(--root-color); }
.root.named { box-sizing: border-box; flex-basis: 101px; padding: 0 5px; line-height: 26px; background: transparent; border-left: 6px solid var(--root-color); overflow: hidden; text-overflow: ellipsis; }
.commit-cell { order: var(--commit-order); display: flex; flex: 0 0 var(--commit-width); min-width: 50px; align-items: center; gap: var(--space-1); overflow: hidden; }
/* `Vcs.Log.AlignLabels` 勾上后引用进提交格里这一条定宽列（左对齐，消息不再被 chip 挤走）。 */
.labels { display: flex; flex: 0 1 120px; min-width: 0; align-items: center; justify-content: flex-start; gap: var(--space-1); overflow: hidden; }
.references { display: flex; flex: 0 1 auto; min-width: 0; align-items: center; gap: var(--space-1); overflow: hidden; }
.graph { flex-shrink: 0; }
/* 弯线按上游画到格外两倍长（`SimpleGraphCellPainter.kt:163-169`），靠本格把超出 26px 的那一半裁掉 ⇒ 相邻两格才接得上。 */
.graph { overflow: hidden; }
/* 点一次图形收/展那一条链（上游 `GraphCommitCellController.java:58-64`），命中这一格时给手形光标
   （= 上游 MOUSE_OVER 那一档回的 `Cursor.HAND_CURSOR`，`LinearGraphUtils.java:88-95`）。 */
.graph.foldable { cursor: pointer; }
.head-gap { fill: var(--panel); }
.log-row:hover .head-gap { fill: var(--hover); }
.log-row.selected .head-gap { fill: var(--selection); }
.ref { box-sizing: border-box; flex: 0 1 auto; min-width: 0; max-width: 100%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; border: 1px solid currentColor; border-radius: var(--radius-pill); padding: 0 var(--space-1); color: var(--accent); font-size: 10px; line-height: 16px; }
.ref.detached-head { display: inline-flex; align-items: center; gap: var(--space-1); color: var(--warning); }
.ref.remote { color: var(--secondary); }
.ref.tag { color: var(--warning); }
.subject, .author { overflow: hidden; text-overflow: ellipsis; }
.subject { flex: 1 1 auto; min-width: 0; color: var(--text); }
.author { order: var(--author-order); flex: 0 0 var(--author-width); color: var(--secondary); }
.date { order: var(--date-order); flex: 0 0 var(--date-width); overflow: hidden; color: var(--muted); font-size: 10px; font-variant-numeric: tabular-nums; }
.hash { order: var(--hash-order); flex: 0 0 var(--hash-width); overflow: hidden; color: var(--muted); font: 10px var(--font-mono); }
.log-row.selected .subject, .log-row.selected .author, .log-row.selected .date, .log-row.selected .hash { color: var(--bright); }
</style>
