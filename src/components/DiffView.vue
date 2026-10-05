<script setup lang="ts">
// One diff renderer for both the Git changes view and local history, so the two can
// never disagree about what a change looks like. Data comes from the parent: the rows
// are already aligned natively, and `unified` is the same diff in patch form.
//
// 两个档位（上游 `TextDiffSettingsHolder.PlaceSettings` 的 `IGNORE_POLICY` + `HIGHLIGHT_POLICY`）：
//   · 只有父级给了 `leftText`/`rightText`（原始两段文本）时才渲染选择器 —— 那种情况下本组件
//     自己用 `buildDiffRows` 重算，档位才有真实消费者。native 对齐好的差异（Git 变更视图、
//     本地历史）拿不到原始文本，选择器**不渲染**（不放假控件）。
//   · 默认值取上游默认：`IgnorePolicy.DEFAULT`（＝「无」，尾随空格算不同）+ `HighlightPolicy.BY_WORD`。
import { computed, nextTick, ref, watch } from 'vue'
import { CaseSensitive, ChevronDown, ChevronRight, ChevronUp, Regex, Search, TextSelect, WholeWord, X } from 'lucide-vue-next'
import type { DiffRow } from '../bridge'
import { iconSize } from '../uiIcons'
import { buildDiffRows } from '../diffText'
import { COMPARISON_POLICY_GROUP, COMPARISON_POLICY_LABELS, DEFAULT_COMPARISON_POLICY, type ComparisonPolicy } from '../diffComparison'
import { DEFAULT_HIGHLIGHT_POLICY, type HighlightPolicy } from '../diffWords'
import {
  COLLAPSE_UNCHANGED_TEXT, CONTEXT_RANGE_DISABLED, CONTEXT_RANGE_LABELS, CONTEXT_RANGE_MODES, DEFAULT_CONTEXT_RANGE,
  FOLD_GROUP_LABEL, allFoldKeys, diffFolds, foldCanStepDeep, foldKey, foldLabel, foldRows,
} from '../diffFold'
import { canGoNext, canGoPrev, changeBlocks, goNext, goPrev } from '../diffNavigation'
import { buildSearchRegex, findStatusText } from '../editorSearch'
import {
  DEFAULT_DIFF_SEARCH_OPTIONS, collectDiffMatches, foldToExpand, highlightPieces,
  nextDiffMatchIndex, type DiffSearchOptions,
} from '../diffSearch'

const props = defineProps<{ path: string; subtitle?: string; rows: DiffRow[]; unified: string; truncated?: boolean; closable?: boolean; leftText?: string; rightText?: string }>()
const emit = defineEmits<{ close: [] }>()
const mode = ref<'sides' | 'unified'>('sides')

// 行内高亮五档的展示名（上游 `HighlightPolicy.java:11-15` 的五个枚举值）。
// 前三项的中文与随 IDE 发货的中文包一致；`split`/`none` 两条本机取不到中文取值，
// 按 `diffComparison.ts` 的同一规矩退回上游英文原文（`DiffBundle.properties:273/275`）。
const HIGHLIGHT_LABELS: { value: HighlightPolicy; label: string }[] = [
  { value: 'byWord', label: '按单词' },
  { value: 'byLine', label: '按行' },
  { value: 'byWordSplit', label: 'Split changes' },
  { value: 'byChar', label: '按字符' },
  { value: 'doNotHighlight', label: 'None' },
]
const OPTIONS_KEY = 'taocode.diffOptions'
function readOptions(): { comparison: ComparisonPolicy; highlight: HighlightPolicy } {
  try {
    const raw = JSON.parse(localStorage.getItem(OPTIONS_KEY) ?? '{}') as { comparison?: ComparisonPolicy; highlight?: HighlightPolicy }
    const comparison = raw.comparison && raw.comparison in COMPARISON_POLICY_LABELS ? raw.comparison : DEFAULT_COMPARISON_POLICY
    const highlight = HIGHLIGHT_LABELS.some(h => h.value === raw.highlight) ? raw.highlight! : DEFAULT_HIGHLIGHT_POLICY
    return { comparison, highlight }
  } catch { return { comparison: DEFAULT_COMPARISON_POLICY, highlight: DEFAULT_HIGHLIGHT_POLICY } }
}
const stored = readOptions()
const comparison = ref<ComparisonPolicy>(stored.comparison)
const highlight = ref<HighlightPolicy>(stored.highlight)
/** 只有父级给了原始文本，档位才有消费者（见文件头）。 */
const canChoosePolicy = computed(() => props.leftText !== undefined && props.rightText !== undefined)

watch([comparison, highlight], ([c, h]) => {
  try { localStorage.setItem(OPTIONS_KEY, JSON.stringify({ comparison: c, highlight: h })) } catch { /* 存不下不影响本次会话 */ }
})

// 有原始文本时按当前档位重算；否则用父级给的（native 对齐的那一份）。
const effectiveRows = computed(() => {
  if (!canChoosePolicy.value) return props.rows
  return buildDiffRows((props.leftText ?? '').split('\n'), (props.rightText ?? '').split('\n'), {
    comparison: comparison.value, highlight: highlight.value,
  })
})

const stats = computed(() => {
  let added = 0
  let removed = 0
  for (const row of effectiveRows.value) {
    if (row.kind === 'insert') ++added; else if (row.kind === 'delete') ++removed
    else if (row.kind === 'change') { ++added; ++removed }
  }
  return { added, removed }
})
/** 按当前折叠状态算出来的渲染列表（收起来的那一段只剩一行折叠标记）。 */
const items = computed(() => foldRows(effectiveRows.value, contextRange.value, collapsed.value, foldLevels.value))
/** 折叠标记行上的行号 = **第一条被藏起来**的行（行号槽在折叠处跳号，与 IDEA 的行为一致）。 */
function hiddenLine(fold: { hiddenFrom: number }): number | '' {
  return effectiveRows.value[fold.hiddenFrom]?.left?.no ?? ''
}

// 未更改片段的折叠（上游 `FoldingModelSupport` + 那个 `collapse.unchanged.fragments` 开关）：
// 上下文范围五档、默认 4、默认**展开**；收起来的折叠区用 `foldKey` 记在一个集合里。
// 每一处另记**展开到第几层候选**（`foldLevels`）—— 上游一段未更改的行会生成三层候选块
// （`getRangeShift` = range / 2×range / 4×range，`FoldingModelSupport.java:1234-1241`，
// 循环在 `:289-298`），点一下只往里展开一层（`ExpandSuggester`，`:403/:418/:455`），点到底才整段露出来。
const contextRange = ref<number>(DEFAULT_CONTEXT_RANGE)
const collapsed = ref<Set<number>>(new Set())
const foldLevels = ref<Map<number, number>>(new Map())
const foldsEnabled = computed(() => contextRange.value !== -1)
/** 开关的选中态 = "全部收起来了"（上游 `isSelected` 返回 `!isExpandByDefault`）。 */
const allCollapsed = computed(() => {
  const keys = allFoldKeys(effectiveRows.value, contextRange.value)
  return keys.length > 0 && keys.every(key => collapsed.value.has(key) && !(foldLevels.value.get(key) ?? 0))
})
function toggleAll() {
  foldLevels.value = new Map()
  collapsed.value = allCollapsed.value ? new Set() : new Set(allFoldKeys(effectiveRows.value, contextRange.value))
}
function toggleFold(key: number) {
  const next = new Set(collapsed.value)
  if (!next.has(key)) { next.add(key); collapsed.value = next; return }
  const level = foldLevels.value.get(key) ?? 0
  if (foldCanStepDeep(key, contextRange.value, effectiveRows.value, level)) {
    const levels = new Map(foldLevels.value)
    levels.set(key, level + 1)
    foldLevels.value = levels
    return
  }
  next.delete(key)
  collapsed.value = next
  const levels = new Map(foldLevels.value)
  levels.delete(key)
  foldLevels.value = levels
}
/** 折叠标记的悬停文案：还有得更深的就提示"再展开一层"，最后一层提示"全部展开"（本仓呈现，见 src/diffFold.ts 头注）。 */
function foldTitle(item: { hidden: number; depth: number; layers: number }): string {
  const label = foldLabel(item.hidden)
  return item.depth + 1 < item.layers ? `${label} · 点击再展开一层（第 ${item.depth + 1}/${item.layers} 层）` : `${label} · 点击全部展开`
}
watch(contextRange, () => { foldLevels.value = new Map(); collapsed.value = new Set() })
// 差异换了（新文件 / 换了档位重算）就把折叠状态清掉：行的下标不再指同一批行。
watch(effectiveRows, () => { foldLevels.value = new Map(); collapsed.value = new Set() })

// 差异导航（上游 `PrevNextDifferenceIterableBase.java:46-96` 的 canGoNext / canGoPrev，纯逻辑在
// `src/diffNavigation.ts`）。锚点 = 上一次跳到的差异行，-1 = 还没起步；上游语义是**不走回头路**，
// 所以按钮在两端是禁用的（不是回绕）。
const changeAnchor = ref(-1)
const activeBlock = ref(-1)
const blocks = computed(() => changeBlocks(effectiveRows.value))
const canNext = computed(() => canGoNext(effectiveRows.value, blocks.value, changeAnchor.value))
const canPrev = computed(() => canGoPrev(effectiveRows.value, blocks.value, changeAnchor.value))
/** 当前差异块里的行对象集合：模板里按对象判高亮（等值行与折叠行不受影响）。 */
const activeRows = computed(() => {
  const block = blocks.value[activeBlock.value]
  if (!block) return new Set<DiffRow>()
  return new Set(effectiveRows.value.slice(block.start, block.end + 1))
})
// 行元素表：跳转要 scrollIntoView，而 `items` 里的行对象就是 effectiveRows 里的同一批对象。
const rowEls = new WeakMap<DiffRow, HTMLElement>()
function setRowEl(row: DiffRow, el: unknown) {
  if (el instanceof HTMLElement) rowEls.set(row, el)
}
function goToChange(forward: boolean) {
  const list = blocks.value
  const block = forward ? goNext(list, changeAnchor.value) : goPrev(list, changeAnchor.value)
  if (!block) return
  changeAnchor.value = block.start
  activeBlock.value = list.indexOf(block)
  void nextTick(() => rowEls.get(effectiveRows.value[block.start])?.scrollIntoView({ block: 'center' }))
}
watch(effectiveRows, () => { changeAnchor.value = -1; activeBlock.value = -1 })

// Split a line into plain/highlighted parts using the [start, length] word marks.
// Out-of-range or overlapping marks are dropped instead of shifting the text: the
// line itself is always rendered whole, and every part goes out as text (never
// HTML) so a file that contains markup cannot inject anything into the viewer.
// 查找命中（`diffSearch.highlightPieces`）与词级标记在同一个函数里合成，两套标记不会互相错位。
function pieces(cell: DiffRow['left'], side: 'left' | 'right', rowIndex: number, wordMarks?: [number, number][]) {
  if (!cell) return []
  const hits: { from: number; to: number; current: boolean }[] = []
  if (searchOpen.value && searchQuery.value) {
    searchMatches.value.forEach((match, index) => {
      if (match.row === rowIndex && match.side === side) hits.push({ from: match.from, to: match.to, current: index === searchIndex.value })
    })
  }
  return highlightPieces(cell.text, wordMarks, hits)
}

// ── 差异视图内的查找（见 src/diffSearch.ts 文件头与 §上游出处）───────────────────────────
// Ctrl+F 开/聚焦、F3/Shift+F3 上下一条、Enter/Shift+Enter 同上、Esc 关；
// 四档选项与编辑器查找同源（大小写/全词/正则），另加 `inChanges` = 上游
// `Vcs.Diff.ToggleSearchInChanges`（只在改动的那一侧里找）。选项跨会话存 localStorage。
const DIFF_SEARCH_KEY = 'taocode.diffSearchOptions'
function readSearchOptions(): DiffSearchOptions {
  try {
    const raw = JSON.parse(localStorage.getItem(DIFF_SEARCH_KEY) ?? '{}') as Partial<DiffSearchOptions>
    return {
      caseSensitive: Boolean(raw.caseSensitive), wholeWords: Boolean(raw.wholeWords),
      regex: Boolean(raw.regex), inChanges: Boolean(raw.inChanges),
    }
  } catch { return { ...DEFAULT_DIFF_SEARCH_OPTIONS } }
}
const searchOpen = ref(false)
const searchQuery = ref('')
const searchInput = ref<HTMLInputElement | null>(null)
const searchOptions = ref<DiffSearchOptions>(readSearchOptions())
const searchMatches = computed(() => collectDiffMatches(effectiveRows.value, searchQuery.value, searchOptions.value))
/** 查询词是坏正则（与编辑器栏同一判据；空查询不算）。 */
const searchInvalid = computed(() => searchQuery.value !== '' && buildSearchRegex(searchQuery.value, { ...searchOptions.value, inSelection: false }) === null)
/** 当前命中的下标，-1 = 还没定位（状态文案停在「N 个结果」）。 */
const searchIndex = ref(-1)
const searchStatus = computed(() => findStatusText({
  query: searchQuery.value, total: searchMatches.value.length, current: searchIndex.value,
  inSelection: false, hasSelection: false, invalid: searchInvalid.value,
}))
function openSearch() {
  searchOpen.value = true
  void nextTick(() => { searchInput.value?.focus(); searchInput.value?.select() })
}
function closeSearch() { searchOpen.value = false; searchIndex.value = -1 }
function toggleSearchOption(key: keyof DiffSearchOptions) {
  searchOptions.value = { ...searchOptions.value, [key]: !searchOptions.value[key] }
  try { localStorage.setItem(DIFF_SEARCH_KEY, JSON.stringify(searchOptions.value)) } catch { /* 存不下不影响本次会话 */ }
}
/** 上下一条：还没定位时向前取第一条、向后取最后一条，两端回绕（`nextDiffMatchIndex`）。 */
function stepSearch(forward: boolean) {
  if (!searchOpen.value) { openSearch(); return }
  const total = searchMatches.value.length
  if (!total) return
  searchIndex.value = nextDiffMatchIndex(total, searchIndex.value, forward)
  const match = searchMatches.value[searchIndex.value]
  if (!match) return
  // 命中落在被折叠的未更改片段里就先把那一段展开（上游折叠归编辑器，本仓得自己管）。
  const fold = foldToExpand(diffFolds(effectiveRows.value, contextRange.value), match.row)
  if (fold !== null) {
    const next = new Set(collapsed.value)
    next.delete(fold)
    collapsed.value = next
    const levels = new Map(foldLevels.value)
    levels.delete(fold)
    foldLevels.value = levels
  }
  // 统一视图是整块补丁文本，行级高亮不适用；跳转先切回并排，让命中可见（如实记在判决里）。
  if (mode.value !== 'sides') mode.value = 'sides'
  void nextTick(() => rowEls.get(effectiveRows.value[match.row])?.scrollIntoView({ block: 'center' }))
}
watch(searchQuery, () => { searchIndex.value = -1 })
watch(searchOptions, () => { searchIndex.value = -1 }, { deep: true })
watch(effectiveRows, () => { searchIndex.value = -1 })
function onEscape() { if (searchOpen.value) closeSearch() }
</script>

<template>
  <div class="diff-view" tabindex="0" @keydown.f7.exact.prevent="goToChange(true)" @keydown.shift.f7.exact.prevent="goToChange(false)"
       @keydown.f3.exact.prevent="stepSearch(true)" @keydown.shift.f3.exact.prevent="stepSearch(false)"
       @keydown.ctrl.f.exact.prevent="openSearch" @keydown.esc.exact="onEscape">
    <div class="diff-head">
      <span class="diff-title">{{ path }}<small v-if="subtitle">{{ subtitle }}</small></span>
      <span class="diff-stats"><b class="add">+{{ stats.added }}</b><b class="del">−{{ stats.removed }}</b></span>
      <!-- 上一个 / 下一个差异（上游 `DiffNextDifferenceAction` / `DiffPreviousDifferenceAction`，F7 / Shift+F7；
           `PrevNextDifferenceIterableBase` 的边界语义：两端禁用，不走回头路）。 -->
      <div class="diff-nav" role="group" aria-label="差异导航">
        <button class="find-icon-button" type="button" :disabled="!canPrev" title="上一个差异 (Shift F7)" aria-label="上一个差异" @click="goToChange(false)"><ChevronUp :size="iconSize.control" /></button>
        <button class="find-icon-button" type="button" :disabled="!canNext" title="下一个差异 (F7)" aria-label="下一个差异" @click="goToChange(true)"><ChevronDown :size="iconSize.control" /></button>
      </div>
      <!-- 差异视图内的查找（上游 `SearchInDiffChangesProvider` + `ToggleSearchInChangesAction` +
           `CombinedDiffSearchEditorActionHandler`：Ctrl+F 开/聚焦、F3/Shift+F3 上下一条、
           Enter 同 F3、Esc 关；`inChanges` 档 = 只在改动的那一侧里找）。 -->
      <div v-if="searchOpen" class="diff-search" role="search" aria-label="在差异中查找">
        <input ref="searchInput" v-model="searchQuery" class="diff-search-input" type="text" placeholder="搜索" aria-label="搜索"
               @keydown.enter.exact.prevent="stepSearch(true)" @keydown.shift.enter.exact.prevent="stepSearch(false)"
               @keydown.esc.prevent="closeSearch" />
        <button class="find-toggle" type="button" :class="{ active: searchOptions.caseSensitive }" title="区分大小写 (C)" aria-label="区分大小写"
                :aria-pressed="searchOptions.caseSensitive" @click="toggleSearchOption('caseSensitive')"><CaseSensitive :size="iconSize.control" /></button>
        <button class="find-toggle" type="button" :class="{ active: searchOptions.wholeWords }" title="单词 (W)" aria-label="单词"
                :aria-pressed="searchOptions.wholeWords" @click="toggleSearchOption('wholeWords')"><WholeWord :size="iconSize.control" /></button>
        <button class="find-toggle" type="button" :class="{ active: searchOptions.regex }" title="正则表达式 (X)" aria-label="正则表达式"
                :aria-pressed="searchOptions.regex" @click="toggleSearchOption('regex')"><Regex :size="iconSize.control" /></button>
        <button class="find-toggle" type="button" :class="{ active: searchOptions.inChanges }" title="仅在改动中搜索" aria-label="仅在改动中搜索"
                :aria-pressed="searchOptions.inChanges" @click="toggleSearchOption('inChanges')"><TextSelect :size="iconSize.control" /></button>
        <span class="diff-search-status" :class="{ invalid: searchInvalid }" role="status">{{ searchStatus }}</span>
        <button class="find-icon-button" type="button" :disabled="!searchMatches.length" title="上一个匹配项 (Shift F3)" aria-label="上一个匹配项" @click="stepSearch(false)"><ChevronUp :size="iconSize.control" /></button>
        <button class="find-icon-button" type="button" :disabled="!searchMatches.length" title="下一个匹配项 (F3)" aria-label="下一个匹配项" @click="stepSearch(true)"><ChevronDown :size="iconSize.control" /></button>
        <button class="find-icon-button" type="button" title="关闭 (Esc)" aria-label="关闭查找" @click="closeSearch"><X :size="iconSize.control" /></button>
      </div>
      <button v-else class="find-icon-button" type="button" title="在差异中查找 (Ctrl F)" aria-label="在差异中查找" @click="openSearch"><Search :size="iconSize.control" /></button>
      <div v-if="canChoosePolicy" class="diff-policies" role="group" :aria-label="COMPARISON_POLICY_GROUP">
        <label class="diff-policy">
          <span class="diff-policy-label">{{ COMPARISON_POLICY_GROUP }}</span>
          <select v-model="comparison" aria-label="忽略差异">
            <option v-for="(label, value) in COMPARISON_POLICY_LABELS" :key="value" :value="value">{{ label }}</option>
          </select>
        </label>
        <label class="diff-policy">
          <span class="diff-policy-label">高亮</span>
          <select v-model="highlight" aria-label="行内高亮">
            <option v-for="item in HIGHLIGHT_LABELS" :key="item.value" :value="item.value">{{ item.label }}</option>
          </select>
        </label>
      </div>
      <div class="diff-modes" role="group" aria-label="差异视图">
        <button :class="{ selected: mode === 'sides' }" @click="mode = 'sides'">并排</button>
        <button :class="{ selected: mode === 'unified' }" @click="mode = 'unified'">统一</button>
      </div>
      <!-- 折叠未更改的片段（上游 `TextDiffViewerUtil.ToggleExpandByDefaultAction`）：上下文范围 = 禁用时
           整个控件不出现（`TextDiffViewerUtil.java:455`）。 -->
      <div v-if="foldsEnabled" class="diff-folds" role="group" :aria-label="FOLD_GROUP_LABEL">
        <label class="diff-policy">
          <span class="diff-policy-label">{{ FOLD_GROUP_LABEL }}</span>
          <select v-model.number="contextRange" aria-label="未更改片段的上下文行数">
            <option v-for="value in CONTEXT_RANGE_MODES" :key="value" :value="value">{{ CONTEXT_RANGE_LABELS[value] ?? value }}</option>
          </select>
        </label>
        <button class="diff-fold-toggle" :class="{ selected: allCollapsed }" :title="COLLAPSE_UNCHANGED_TEXT" @click="toggleAll">
          <ChevronRight v-if="allCollapsed" :size="iconSize.control" />
          <ChevronDown v-else :size="iconSize.control" />
          <span>{{ COLLAPSE_UNCHANGED_TEXT }}</span>
        </button>
      </div>
      <button v-if="closable" class="icon-button" title="关闭" aria-label="关闭差异" @click="emit('close')"><X :size="iconSize.action" /></button>
    </div>
    <p v-if="truncated" class="diff-note">差异行数超过上限，后续部分未显示。</p>
    <div v-if="effectiveRows.length && mode === 'sides'" class="diff-sides">
      <template v-for="(item, index) in items" :key="index">
        <!-- 收起来的未更改片段：一行标记，点它展开（上游那里是 5 个空格的占位文本，见 src/diffFold.ts） -->
        <button v-if="item.kind === 'fold'" class="diff-fold-row" :title="foldTitle(item)" :aria-label="foldTitle(item)" @click="toggleFold(foldKey(item.fold))">
          <span class="diff-no">{{ hiddenLine(item.fold) }}</span>
          <span class="diff-fold-label">{{ foldLabel(item.hidden) }}</span>
          <span class="diff-no" />
          <span class="diff-cell" />
        </button>
        <div v-else class="diff-line" :class="[`diff-${item.row.kind}`, { 'diff-active': activeRows.has(item.row) }]" :ref="el => setRowEl(item.row, el)">
          <span class="diff-no">{{ item.row.left?.no ?? '' }}</span>
          <span class="diff-cell"><span v-for="(piece, i) in pieces(item.row.left, 'left', item.index, item.row.leftMarks)" :key="i" :class="{ 'diff-word-del': piece.word, 'diff-find-hit': piece.search, 'diff-find-current': piece.current }">{{ piece.text }}</span></span>
          <span class="diff-no">{{ item.row.right?.no ?? '' }}</span>
          <span class="diff-cell"><span v-for="(piece, i) in pieces(item.row.right, 'right', item.index, item.row.rightMarks)" :key="i" :class="{ 'diff-word-add': piece.word, 'diff-find-hit': piece.search, 'diff-find-current': piece.current }">{{ piece.text }}</span></span>
        </div>
      </template>
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
/* 两个档位（上游 PlaceSettings 的 IGNORE_POLICY + HIGHLIGHT_POLICY）：只在父级给了原始
   两段文本时出现（见文件头），所以是紧凑的一行下拉，不是一整条工具栏。 */
.diff-policies { display: inline-flex; align-items: center; gap: var(--space-2); }
.diff-policy { display: inline-flex; align-items: center; gap: var(--space-1); }
.diff-policy-label { color: var(--muted); font-size: 11px; white-space: nowrap; }
.diff-policy select { height: var(--ctrl-height-sm); padding: 0 var(--space-1); color: var(--text); background: var(--editor); border: 1px solid var(--line-strong); border-radius: var(--radius-xs); font: 11px var(--font-ui); }
/* 未更改片段的折叠控件 + 折叠行（与查找栏同高同一档控件）。
   存盘冲突那个对话框很窄（真机取证时抓到的）：标签与开关**一律不折行**，宁可整条工具带换行，
   也不要出现"未更 改的 片段"这种竖排。 */
.diff-view .diff-head { flex-wrap: wrap; }
.diff-folds { display: inline-flex; align-items: center; gap: var(--space-2); white-space: nowrap; }
.diff-nav { display: inline-flex; align-items: center; gap: var(--space-1); }
.diff-nav button:disabled { opacity: .4; cursor: default; }
/* 差异视图内的查找行（与查找栏同高同一档控件）。 */
.diff-search { display: inline-flex; align-items: center; gap: var(--space-1); }
.diff-search-input { width: 120px; height: var(--ctrl-height-sm); padding: 0 var(--space-2); color: var(--text); background: var(--editor); border: 1px solid var(--line-strong); border-radius: var(--radius-xs); font: 11px var(--font-ui); }
.diff-search-input:focus { outline: none; border-color: var(--accent); }
.diff-search-status { min-width: 44px; color: var(--muted); font: 11px var(--font-ui); white-space: nowrap; font-variant-numeric: tabular-nums; }
.diff-search-status.invalid { color: var(--error); }
/* 查找命中（上游编辑器查找的 inlay 高亮）：全部命中淡色，当前命中加边框。 */
.diff-cell .diff-find-hit { background: var(--find-hit-bg, rgba(255, 196, 0, .28)); border-radius: 2px; }
.diff-cell .diff-find-current { background: var(--find-current-bg, rgba(255, 145, 0, .45)); box-shadow: inset 0 0 0 1px var(--accent); }
.diff-line.diff-active > .diff-cell { outline: 1px solid var(--accent); outline-offset: -1px; }
.diff-policy-label, .diff-fold-toggle > span, .diff-modes > button { white-space: nowrap; }
.diff-fold-toggle { display: inline-flex; align-items: center; gap: 2px; height: var(--ctrl-height-sm); padding: 0 var(--space-1); border: 1px solid transparent; border-radius: var(--radius-xs); background: transparent; color: var(--secondary); font: 11px var(--font-ui); }
.diff-fold-toggle:hover { background: var(--hover); color: var(--bright); }
.diff-fold-toggle.selected { background: var(--accent-soft); border-color: var(--accent); color: var(--accent); }
.diff-fold-row { display: grid; grid-template-columns: 46px minmax(0, 1fr) 46px minmax(0, 1fr); align-items: start; width: 100%; padding: 0; border: 0; background: var(--panel); color: var(--muted); font: 11px var(--font-mono); text-align: left; cursor: pointer; }
.diff-fold-row:hover { background: var(--hover); color: var(--bright); }
.diff-fold-row .diff-no, .diff-fold-row .diff-cell { background: var(--panel); border-bottom: 1px dashed var(--line-strong); }
.diff-fold-label { grid-column: 2 / 4; min-width: 0; padding: 0 var(--space-2); border-bottom: 1px dashed var(--line-strong); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
</style>
