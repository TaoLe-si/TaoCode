<script setup lang="ts">
// One diff renderer for both the Git changes view and local history, so the two can
// never disagree about what a change looks like. Data comes from the parent: the rows
// are already aligned natively, and `unified` is the same diff in patch form.
//
// `unified`（补丁文本）的**真消费者**是工具带上的「作为补丁复制到剪贴板」（见下面的 `copyPatch`）
// 与「没有差异行只剩补丁文本」时的那块 `pre`。上游这一档就挂在差异查看器里：
// `platform/vcs-impl/src/com/intellij/openapi/vcs/changes/actions/diff/DiffViewerCreatePatchActionProvider.java:55-59`
// （`$Clipboard` 那一支）→ `CreatePatchFromChangesAction.java:182-200`（`createIntoClipboard`，不弹对话框）
// → `PatchWriter.java:104-111`（`CopyPasteManager.setContents(new StringSelection(补丁全文))`）。
// 上游那里还有一条与本仓「不放假控件」同源的规矩：`DiffViewerCreatePatchActionProvider.java:71-76`
// 的 `update()` 用的是 `setEnabledAndVisible(isEnabled)` —— 拿不到补丁文本时那一项**根本不出现**。
//
// 两个档位（上游 `TextDiffSettingsHolder.PlaceSettings` 的 `IGNORE_POLICY` + `HIGHLIGHT_POLICY`）：
//   · 只有父级给了 `leftText`/`rightText`（原始两段文本）时才渲染选择器 —— 那种情况下本组件
//     自己用 `buildDiffRows` 重算，档位才有真实消费者。native 对齐好的差异（Git 变更视图、
//     本地历史）拿不到原始文本，选择器**不渲染**（不放假控件）。
//   · 默认值取上游默认：`IgnorePolicy.DEFAULT`（＝「无」，尾随空格算不同）+ `HighlightPolicy.BY_WORD`。
import { computed, nextTick, ref, watch } from 'vue'
import { CaseSensitive, ChevronDown, ChevronRight, ChevronUp, Copy, Regex, Search, TextSelect, WholeWord, X } from 'lucide-vue-next'
import type { DiffRow } from '../bridge'
import { iconSize } from '../uiIcons'
import { copyToClipboard } from '../clipboard'
// 补丁导出的那条线与文案都在 `src/patchExport.ts`（上游同一个动作 id `ChangesView.CreatePatchToClipboard`）：
// 这里只取它的**文案常量**，不调它那两个走宿主的函数 —— 差异视图手里的补丁文本已经在 `props.unified` 里。
import { PATCH_TO_CLIPBOARD_TEXT } from '../patchExport'
import { buildDiffRows } from '../diffText'
import { COMPARISON_POLICY_GROUP, COMPARISON_POLICY_LABELS, DEFAULT_COMPARISON_POLICY, type ComparisonPolicy } from '../diffComparison'
import { DEFAULT_HIGHLIGHT_POLICY, type HighlightPolicy } from '../diffWords'
import {
  COLLAPSE_UNCHANGED_TEXT, CONTEXT_RANGE_DISABLED, CONTEXT_RANGE_LABELS, CONTEXT_RANGE_MODES, DEFAULT_CONTEXT_RANGE,
  FOLD_GROUP_LABEL, allFoldKeys, diffFolds, foldCanStepDeep, foldKey, foldLabel, foldRows,
} from '../diffFold'
import {
  buildUnifiedRows, foldUnifiedRows, unifiedBlockStart, unifiedFoldCanStepDeep,
  unifiedFolds, unifiedSign, type UnifiedRow,
} from '../diffUnified'
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
function toggleAllSides() {
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

// 统一（unified）档的行表与它的块级折叠（上游 `tools/fragmented/` 那一族，见 `src/diffUnified.ts` 文件头）。
// 折叠状态**两侧分开存**：并排视图的段落起点与统一视图的段落起点不是同一套坐标，
// 共用一个集合会把另一侧的段落收起（上游那里也是两个不同的 FoldingModel 实例）。
const unifiedRows = computed(() => buildUnifiedRows(effectiveRows.value))
const collapsedUnified = ref<Set<number>>(new Set())
const foldLevelsUnified = ref<Map<number, number>>(new Map())
const unifiedItems = computed(() => foldUnifiedRows(unifiedRows.value, contextRange.value, collapsedUnified.value, foldLevelsUnified.value))
/** 统一视图里当前这一处折叠的层数与是否到底（与并排视图同一套语义）。 */
const allCollapsedUnified = computed(() => {
  const folds = unifiedFolds(unifiedRows.value, contextRange.value)
  return folds.length > 0 && folds.every(fold => collapsedUnified.value.has(fold.runStart) && !(foldLevelsUnified.value.get(fold.runStart) ?? 0))
})
function toggleAllUnified() {
  foldLevelsUnified.value = new Map()
  collapsedUnified.value = allCollapsedUnified.value ? new Set() : new Set(unifiedFolds(unifiedRows.value, contextRange.value).map(fold => fold.runStart))
}
function toggleFoldUnified(key: number) {
  const next = new Set(collapsedUnified.value)
  if (!next.has(key)) { next.add(key); collapsedUnified.value = next; return }
  const level = foldLevelsUnified.value.get(key) ?? 0
  if (unifiedFoldCanStepDeep(key, contextRange.value, unifiedRows.value, level)) {
    const levels = new Map(foldLevelsUnified.value)
    levels.set(key, level + 1)
    foldLevelsUnified.value = levels
    return
  }
  next.delete(key)
  collapsedUnified.value = next
  const levels = new Map(foldLevelsUnified.value)
  levels.delete(key)
  foldLevelsUnified.value = levels
}
/** 统一视图折叠行的行号 = 该段第一条被藏起来的行的**左侧**行号（新增行没有左侧号，落到右侧）。 */
function hiddenUnifiedLine(fold: { hiddenFrom: number }): number | '' {
  const row = unifiedRows.value[fold.hiddenFrom]
  if (!row) return ''
  return row.leftNo ?? row.rightNo ?? ''
}
watch(contextRange, () => { foldLevelsUnified.value = new Map(); collapsedUnified.value = new Set() })
watch(unifiedRows, () => { foldLevelsUnified.value = new Map(); collapsedUnified.value = new Set() })
/** 工具带那个开关按当前档位走（并排 ↔ 统一）；「折叠全部」的选中态也按当前档位判。 */
const allCollapsedNow = computed(() => mode.value === 'unified' ? allCollapsedUnified.value : allCollapsed.value)
function toggleAll() {
  if (mode.value === 'unified') toggleAllUnified(); else toggleAllSides()
}

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
// 统一档同一条规矩，只是键在统一行对象上（`blocks` 的序号与 `unifiedRows` 的 `block` 一一对应：
// 两边都是「相邻非 equal 行合成一块」，顺序也一致 —— 上游那里是同一个 `UnifiedDiffChange` 列表）。
const unifiedEls = new WeakMap<UnifiedRow, HTMLElement>()
function setUnifiedEl(row: UnifiedRow, el: unknown) {
  if (el instanceof HTMLElement) unifiedEls.set(row, el)
}
/** 当前差异块在统一档里的高亮判据（整块 = 删行 + 增行，与上游 `getDeletedRange` + `getInsertedRange` 同一段）。 */
function unifiedActive(row: UnifiedRow): boolean {
  return row.block !== -1 && row.block === activeBlock.value
}
function goToChange(forward: boolean) {
  const list = blocks.value
  const block = forward ? goNext(list, changeAnchor.value) : goPrev(list, changeAnchor.value)
  if (!block) return
  changeAnchor.value = block.start
  activeBlock.value = list.indexOf(block)
  if (mode.value === 'unified') {
    const at = unifiedBlockStart(unifiedRows.value, activeBlock.value)
    const row = at >= 0 ? unifiedRows.value[at] : undefined
    if (row) void nextTick(() => unifiedEls.get(row)?.scrollIntoView({ block: 'center' }))
    return
  }
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

/**
 * 统一档一行的分片：词级标记就是这一行自带的 `marks`（删除行取并排视图的 `leftMarks`、
 * 新增行取 `rightMarks`，见 `src/diffUnified.ts`）；查找命中按并排视图的「行 + 侧」换算过来 ——
 * 统一文档里一个并排改动行可能拆成删/增两行，各吃各的那一侧命中。
 */
function unifiedPieces(row: UnifiedRow) {
  const side = row.kind === 'insert' ? 'right' : row.kind === 'delete' ? 'left' : null
  const hits: { from: number; to: number; current: boolean }[] = []
  if (side && searchOpen.value && searchQuery.value) {
    searchMatches.value.forEach((match, index) => {
      if (match.row === row.source && match.side === side) hits.push({ from: match.from, to: match.to, current: index === searchIndex.value })
    })
  }
  return highlightPieces(row.text, row.marks, hits)
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

// ── 补丁文本（`props.unified`）的消费者：「作为补丁复制到剪贴板」────────────────────────
// 上游这一档就挂在差异查看器上：`ChangesView.CreatePatchToClipboard`
// （`platform/vcs-impl/resources/META-INF/VcsActions.xml:213-214`，class 是
// `CreatePatchFromChangesAction$Clipboard`），差异查看器里的那一支是
// `platform/vcs-impl/src/com/intellij/openapi/vcs/changes/actions/diff/DiffViewerCreatePatchActionProvider.java:55-59`
// （`$Clipboard`；`isActive` 只认差异查看器里的请求，`:67-69`）。
// 走的路径不弹对话框：`CreatePatchFromChangesAction.java:182-200` 的 `createIntoClipboard`
// → `CreatePatchCommitExecutor.java:343-355` 的 `writePatchToClipboard`
// → `platform/vcs-impl/src/com/intellij/openapi/vcs/changes/patch/PatchWriter.java:104-111`
// 的 `CopyPasteManager.setContents(new StringSelection(补丁全文))` —— 复制的就是那份 unified 文本本身。
// 本仓的对应出口是 `src/clipboard.ts` 的 `copyToClipboard`（系统剪贴板 + 剪贴板环，同一个中央入口）。
// 按钮文案直接用 `src/patchExport.ts:21` 的 `PATCH_TO_CLIPBOARD_TEXT`
// （= `action.ChangesView.CreatePatchToClipboard.text`，`ActionsBundle.properties:1583`），
// 与变更视图右键那两条同源，不在这里另抄一份中文。
/** 成功那一句（上游 `VcsBundle.properties:447` `patch.copied.to.clipboard`；本地树没有中文包 ⇒ 按英文原文直译）。 */
const PATCH_COPIED_TEXT = '补丁已复制到剪贴板。'
/** 补丁文本 = 父级给的那一份（前端侧由 `src/diffText.ts` 的 `generateUnifiedDiff` 生成，宿主侧是 `git diff`）；纯空白视作没有。 */
const patchText = computed(() => (props.unified.trim() ? props.unified : ''))
/** 上游 `DiffViewerCreatePatchActionProvider.java:71-76` 用的是 `setEnabledAndVisible` —— 没有补丁文本时那颗按钮**不出现**。 */
const canCopyPatch = computed(() => patchText.value !== '')
const patchCopied = ref(false)
async function copyPatch() {
  const text = patchText.value
  // 空补丁不动剪贴板（与 `src/patchExport.ts` 的 `copyPatchToClipboard` 同口径）。
  if (!text) return
  await copyToClipboard(text)
  patchCopied.value = true
}
// 换了差异（另一个文件 / 另一份冲突预览）就把那句提示撤掉，否则它说的是上一份补丁。
watch(() => props.unified, () => { patchCopied.value = false })
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
      <!-- 「作为补丁复制到剪贴板」（上游 `ChangesView.CreatePatchToClipboard` 在差异查看器里的那一支
           `DiffViewerCreatePatchActionProvider$Clipboard`）：`props.unified` 那份补丁文本的出口。
           没有补丁文本就不出现（上游 `:71-76` 的 `setEnabledAndVisible`）。 -->
      <button v-if="canCopyPatch" class="find-icon-button" type="button" :title="PATCH_TO_CLIPBOARD_TEXT"
              :aria-label="PATCH_TO_CLIPBOARD_TEXT" @click="copyPatch"><Copy :size="iconSize.control" /></button>
      <span v-if="patchCopied" class="diff-copy-state" role="status">{{ PATCH_COPIED_TEXT }}</span>
      <!-- 折叠未更改的片段（上游 `TextDiffViewerUtil.ToggleExpandByDefaultAction`）：上下文范围 = 禁用时
           整个控件不出现（`TextDiffViewerUtil.java:455`）。 -->
      <div v-if="foldsEnabled" class="diff-folds" role="group" :aria-label="FOLD_GROUP_LABEL">
        <label class="diff-policy">
          <span class="diff-policy-label">{{ FOLD_GROUP_LABEL }}</span>
          <select v-model.number="contextRange" aria-label="未更改片段的上下文行数">
            <option v-for="value in CONTEXT_RANGE_MODES" :key="value" :value="value">{{ CONTEXT_RANGE_LABELS[value] ?? value }}</option>
          </select>
        </label>
        <button class="diff-fold-toggle" type="button" :class="{ selected: allCollapsedNow }" :title="COLLAPSE_UNCHANGED_TEXT" @click="toggleAll">
          <ChevronRight v-if="allCollapsedNow" :size="iconSize.control" />
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
    <!-- 统一（unified）档：一列到底的行表 + 与并排档同一套**块级**折叠（上游 `tools/fragmented` 那一族，
         规则见 `src/diffUnified.ts` 文件头）。左号 = 原文件行、右号 = 新文件行；
         删除行没有右号、新增行没有左号（上游 `LineNumberConvertor.convert` 换算不到返回 -1，这里留空）。 -->
    <div v-else-if="effectiveRows.length" class="diff-unified">
      <template v-for="(item, index) in unifiedItems" :key="index">
        <button v-if="item.kind === 'fold'" class="diff-fold-row diff-unified-fold" type="button"
                :title="foldTitle(item)" :aria-label="foldTitle(item)" @click="toggleFoldUnified(foldKey(item.fold))">
          <span class="diff-no">{{ hiddenUnifiedLine(item.fold) }}</span>
          <span class="diff-no" />
          <span class="diff-fold-label diff-unified-label">{{ foldLabel(item.hidden) }}</span>
        </button>
        <div v-else class="diff-unified-line" :class="[`unified-${item.row.kind}`, { 'diff-active': unifiedActive(item.row) }]" :ref="el => setUnifiedEl(item.row, el)">
          <span class="diff-no">{{ item.row.leftNo ?? '' }}</span>
          <span class="diff-no">{{ item.row.rightNo ?? '' }}</span>
          <span class="diff-unified-sign">{{ unifiedSign(item.row.kind) }}</span>
          <span class="diff-cell"><span v-for="(piece, i) in unifiedPieces(item.row)" :key="i" :class="{ 'diff-word-del': piece.word && item.row.kind !== 'insert', 'diff-word-add': piece.word && item.row.kind === 'insert', 'diff-find-hit': piece.search, 'diff-find-current': piece.current }">{{ piece.text }}</span></span>
        </div>
      </template>
    </div>
    <!-- 只剩补丁文本的场合（rows 为空）与「无差异」兜底仍走 pre：
         a <p> would collapse the patch's newlines and indentation. -->
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
/* 复制补丁的那句结果提示（上游是 `VcsNotifier.notifySuccess(patch.copied.to.clipboard)`，
   `platform/vcs-impl/src/com/intellij/openapi/vcs/changes/patch/CreatePatchCommitExecutor.java:353-354`；
   差异视图没有通知通道，就在工具带上说一句）。 */
.diff-copy-state { color: var(--success); font: 11px var(--font-ui); white-space: nowrap; }
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
/* 统一（unified）档：一列到底 —— 左侧行号 / 右侧行号 / `+`·`-` 符号列 / 正文。
   上游那里是一个真编辑器（`UnifiedDiffViewer`），行号由两个 `LineNumberConvertor` 换算；
   本仓由并排行表机械换算（`src/diffUnified.ts`），换算不到那一侧就留空行号。 */
.diff-unified { flex: 1; min-height: 0; overflow: auto; font: 12px/1.7 var(--font-mono); }
.diff-unified-line { display: grid; grid-template-columns: 46px 46px 16px minmax(0, 1fr); align-items: start; }
.diff-unified-sign { padding: 0 var(--space-1); color: var(--muted); text-align: center; user-select: none; }
.diff-unified-line.unified-delete > .diff-cell { background: var(--error-bg); }
.diff-unified-line.unified-insert > .diff-cell { background: var(--success-bg); }
.diff-unified-line.diff-active > .diff-cell { outline: 1px solid var(--accent); outline-offset: -1px; }
/* 统一档的折叠行沿用并排档那一条标记，只把栅格换成四列、标签跨过符号列与正文列。 */
.diff-unified-fold { grid-template-columns: 46px 46px 16px minmax(0, 1fr); }
.diff-unified-fold .diff-unified-label { grid-column: 3 / 5; }
</style>
