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
import { computed, ref, watch } from 'vue'
import { ChevronDown, ChevronRight, X } from 'lucide-vue-next'
import type { DiffRow } from '../bridge'
import { iconSize } from '../uiIcons'
import { buildDiffRows } from '../diffText'
import { COMPARISON_POLICY_GROUP, COMPARISON_POLICY_LABELS, DEFAULT_COMPARISON_POLICY, type ComparisonPolicy } from '../diffComparison'
import { DEFAULT_HIGHLIGHT_POLICY, type HighlightPolicy } from '../diffWords'
import {
  COLLAPSE_UNCHANGED_TEXT, CONTEXT_RANGE_DISABLED, CONTEXT_RANGE_LABELS, CONTEXT_RANGE_MODES, DEFAULT_CONTEXT_RANGE,
  FOLD_GROUP_LABEL, allFoldKeys, foldKey, foldLabel, foldRows,
} from '../diffFold'

const props = defineProps<{ path: string; subtitle?: string; rows: DiffRow[]; unified: string; truncated?: boolean; closable?: boolean; leftText?: string; rightText?: string }>()
const emit = defineEmits<{ close: [] }>()
const mode = ref<'sides' | 'unified'>('sides')

// 行内高亮三档的展示名（上游 `HighlightPolicy.java` 的三项，文案取随 IDE 发货的中文包）。
const HIGHLIGHT_LABELS: { value: HighlightPolicy; label: string }[] = [
  { value: 'byWord', label: '按单词' },
  { value: 'byLine', label: '按行' },
  { value: 'byChar', label: '按字符' },
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
const items = computed(() => foldRows(effectiveRows.value, contextRange.value, collapsed.value))
/** 折叠标记行上的行号 = **第一条被藏起来**的行（行号槽在折叠处跳号，与 IDEA 的行为一致）。 */
function hiddenLine(fold: { hiddenFrom: number }): number | '' {
  return effectiveRows.value[fold.hiddenFrom]?.left?.no ?? ''
}

// 未更改片段的折叠（上游 `FoldingModelSupport` + 那个 `collapse.unchanged.fragments` 开关）：
// 上下文范围五档、默认 4、默认**展开**；收起来的折叠区用 `foldKey` 记在一个集合里。
const contextRange = ref<number>(DEFAULT_CONTEXT_RANGE)
const collapsed = ref<Set<number>>(new Set())
const foldsEnabled = computed(() => contextRange.value !== -1)
/** 开关的选中态 = "全部收起来了"（上游 `isSelected` 返回 `!isExpandByDefault`）。 */
const allCollapsed = computed(() => {
  const keys = allFoldKeys(effectiveRows.value, contextRange.value)
  return keys.length > 0 && keys.every(key => collapsed.value.has(key))
})
function toggleAll() {
  collapsed.value = allCollapsed.value ? new Set() : new Set(allFoldKeys(effectiveRows.value, contextRange.value))
}
function toggleFold(key: number) {
  const next = new Set(collapsed.value)
  if (next.has(key)) next.delete(key); else next.add(key)
  collapsed.value = next
}
watch(contextRange, () => { collapsed.value = new Set() })
// 差异换了（新文件 / 换了档位重算）就把折叠状态清掉：行的下标不再指同一批行。
watch(effectiveRows, () => { collapsed.value = new Set() })

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
        <button v-if="item.kind === 'fold'" class="diff-fold-row" :title="foldLabel(item.hidden)" @click="toggleFold(foldKey(item.fold))">
          <span class="diff-no">{{ hiddenLine(item.fold) }}</span>
          <span class="diff-fold-label">{{ foldLabel(item.hidden) }}</span>
          <span class="diff-no" />
          <span class="diff-cell" />
        </button>
        <div v-else class="diff-line" :class="`diff-${item.row.kind}`">
          <span class="diff-no">{{ item.row.left?.no ?? '' }}</span>
          <span class="diff-cell"><span v-for="(part, i) in parts(item.row.left, item.row.leftMarks)" :key="i" :class="{ 'diff-word-del': part.mark }">{{ part.text }}</span></span>
          <span class="diff-no">{{ item.row.right?.no ?? '' }}</span>
          <span class="diff-cell"><span v-for="(part, i) in parts(item.row.right, item.row.rightMarks)" :key="i" :class="{ 'diff-word-add': part.mark }">{{ part.text }}</span></span>
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
.diff-policy-label, .diff-fold-toggle > span, .diff-modes > button { white-space: nowrap; }
.diff-fold-toggle { display: inline-flex; align-items: center; gap: 2px; height: var(--ctrl-height-sm); padding: 0 var(--space-1); border: 1px solid transparent; border-radius: var(--radius-xs); background: transparent; color: var(--secondary); font: 11px var(--font-ui); }
.diff-fold-toggle:hover { background: var(--hover); color: var(--bright); }
.diff-fold-toggle.selected { background: var(--accent-soft); border-color: var(--accent); color: var(--accent); }
.diff-fold-row { display: grid; grid-template-columns: 46px minmax(0, 1fr) 46px minmax(0, 1fr); align-items: start; width: 100%; padding: 0; border: 0; background: var(--panel); color: var(--muted); font: 11px var(--font-mono); text-align: left; cursor: pointer; }
.diff-fold-row:hover { background: var(--hover); color: var(--bright); }
.diff-fold-row .diff-no, .diff-fold-row .diff-cell { background: var(--panel); border-bottom: 1px dashed var(--line-strong); }
.diff-fold-label { grid-column: 2 / 4; min-width: 0; padding: 0 var(--space-2); border-bottom: 1px dashed var(--line-strong); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
</style>
