<script setup lang="ts">
// 求值历史的「树」面板 —— 上游 `DebuggerTreeWithHistoryPanel` +
// `DebuggerTreeWithHistoryContainer` 的等价物：
//   · 树那一半：`platform/xdebugger-impl/ui/src/com/intellij/xdebugger/impl/evaluate/quick/common/
//     DebuggerTreeWithHistoryPanel.java:25-30`（= 树 + 工具条）、`:36-40`（换根后只剩新树、
//     `rebuild()` 重建）；标题用 `DebuggerTreeCreator.getTitle(item)`（`.../DebuggerTreeCreator.java`）。
//   · 容器那一半（历史表 / index=-1 起步 / 设为根 splice 插入 / HISTORY_SIZE=11 / back/forward
//     的可用性 / Alt+← / Alt+→）：`src/debugValueHistory.ts`。本组件**直接调**那一份规则，
//     不在这里重写一遍。
//   · 行文本、行动作、省略号节点：`src/debugHistoryTree.ts`（值的那一族在 `src/debugTypeGrouping.ts`）。
//
// 为什么它能自己取数（与 `DebugInspectWindow.vue` 同一条理由）：DAP 会话是宿主里的**一个**全局
// 会话（`native/dap.cpp` 分派 `dap.*`），所以组件可以直接 `dapEvaluate`/`dapVariables`，
// 不必由 DebugPanel 层层往下传；宿主只需要给出「历史里有哪些表达式」与「在哪一帧求值」。
//
// 本组件**自己就做完**的行动作：`copy-value` / `copy-name`（文本规则 `src/debugValueCopy.ts`、
// 写入走 `src/clipboard.ts` 的 `copyToClipboard`）。其余动作（检查 / 添加到监视 / 在控制台中求值…）
// 要有宿主处理函数才画得出来 —— 由 `delegate` 白名单逐条开启，没给的动作**不画**（不摆点不动的按钮）。
//
// 如实边界（写进判词）：本仓这一版展开**一层**（根 + 孩子 + 省略号行）；更深的层级留在
// Variables/检查窗口那两条既有路径（`collectReferenceRows`），这里不重复实现。
import { computed, ref, watch } from 'vue'
import { ArrowLeft, ArrowRight, ChevronDown, ChevronRight, Crosshair, History } from 'lucide-vue-next'
import { iconSize } from '../../uiIcons'
import { copyToClipboard } from '../../clipboard'
import { dapEvaluate, dapVariables } from '../../bridge'
import {
  canGoBackward, canGoForward, canSetAsRoot, currentValueHistoryEntry, goBackward, goForward,
  pushValueHistory, type ValueHistory,
} from '../../debugValueHistory'
import {
  evaluateHistoryEntry, historyRowMenuItems, historyTreeRows, historyValueEntry,
  type EvaluateHistoryEntry, type HistoryTreeChild, type HistoryTreeRow,
} from '../../debugHistoryTree'
import { debugCopyNote, debugCopyText, type DebugCopyMode } from '../../debugValueCopy'
import type { XValueNodeActionId } from '../../debugTypeGrouping'
import DebugRowMenu from '../DebugRowMenu.vue'

const props = defineProps<{
  /** 历史里的表达式（宿主 DebugPanel 的 `exprHistory`，顺序即历史顺序）。 */
  expressions: string[]
  /** 求值所在帧（DAP `evaluate` 的 frameId；0 = 由适配器决定，与面板的兜底同口径）。 */
  frameId?: number
  /** 停住次数：每次暂停 +1 ⇒ 当前项重算（上游 `sessionPaused` → `rebuild()`，`:59-63` 同源）。 */
  generation?: number
  /** 除复制两档外、宿主真能处理的动作 id（给了才画，见文件头）。 */
  delegate?: readonly XValueNodeActionId[]
}>()
const emit = defineEmits<{ (event: 'action', mode: XValueNodeActionId, row: HistoryTreeRow): void }>()

/** 表达式与值根的元数据（值/类型/句柄/规模）—— 键就是历史条目上的 label。 */
const meta = ref<Record<string, EvaluateHistoryEntry>>({})
/** 历史表与光标（容器语义由 `src/debugValueHistory.ts` 的规则定）。 */
const history = ref<ValueHistory>({ entries: [], index: -1 })
const children = ref<Record<number, HistoryTreeChild[]>>({})
const open = ref<Record<string, boolean>>({ root: true })
const selectedKey = ref('')
const menu = ref<{ x: number; y: number; row: HistoryTreeRow } | null>(null)
const busy = ref(false)
const note = ref('')

const current = computed(() => currentValueHistoryEntry(history.value))
const currentEntry = computed<EvaluateHistoryEntry | undefined>(() => {
  const label = current.value?.label
  return label ? meta.value[label] : undefined
})
const currentChildren = computed<HistoryTreeChild[]>(() => {
  const reference = currentEntry.value?.reference ?? 0
  return children.value[reference] ?? []
})
const rows = computed<HistoryTreeRow[]>(() =>
  currentEntry.value ? historyTreeRows(currentEntry.value, open.value.root ? currentChildren.value : []) : [])
const selectedRow = computed(() => rows.value.find(row => row.key === selectedKey.value))
const canBack = computed(() => canGoBackward(history.value))
const canForward = computed(() => canGoForward(history.value))
const canRoot = computed(() => {
  const row = selectedRow.value
  if (!row) return false
  // 选中的是根行时路径深度 1（根可见）⇒ 不可设为根；孩子行深度 2，非叶子才可以。
  return canSetAsRoot(row.kind === 'root' ? 1 : 2, !row.hasChildren)
})
const title = computed(() => currentEntry.value
  ? `${currentEntry.value.expression} = ${currentEntry.value.value}`
  : '求值历史')

/** 孩子形状：只留画行与展开要用的字段（`DapVariable` 的其余字段这条路径不看）。 */
function childOf(variable: { name: string; value: string; type?: string; reference: number }): HistoryTreeChild {
  const sized = variable as { namedVariables?: number; indexedVariables?: number }
  return {
    name: variable.name, value: variable.value, ...(variable.type ? { type: variable.type } : {}),
    reference: variable.reference,
    ...(sized.namedVariables ? { namedVariables: sized.namedVariables } : {}),
    ...(sized.indexedVariables ? { indexedVariables: sized.indexedVariables } : {}),
  }
}

/** 把某个表达式算出来（历史条目只有文本，句柄得现算 —— DAP `evaluate` 的 `watch` 上下文）。 */
async function ensureEntry(label: string): Promise<EvaluateHistoryEntry | undefined> {
  const cached = meta.value[label]
  if (cached) return cached
  busy.value = true
  try {
    const result = await dapEvaluate(label, 'watch', props.frameId ?? 0)
    const entry = evaluateHistoryEntry(label, result)
    meta.value = { ...meta.value, [label]: entry }
    return entry
  } catch (caught) {
    note.value = `求值失败：${caught instanceof Error ? caught.message : String(caught)}`
    return undefined
  } finally {
    busy.value = false
  }
}

/** 取一个容器的孩子（按 reference 缓存；失败落空数组并把原因写在提示行）。 */
async function loadChildren(reference: number): Promise<void> {
  if (reference <= 0 || children.value[reference]) return
  busy.value = true
  try {
    const result = await dapVariables(reference)
    const list = Array.isArray(result) ? result : (result?.variables ?? [])
    children.value = { ...children.value, [reference]: list.map(childOf) }
  } catch (caught) {
    children.value = { ...children.value, [reference]: [] }
    note.value = `取孩子失败：${caught instanceof Error ? caught.message : String(caught)}`
  } finally {
    busy.value = false
  }
}

/** 把宿主的表达式列表合进历史：表达式在前、用户提上来的值根在后（顺序不丢）。 */
function syncHistory(expressions: readonly string[]): void {
  const valueRoots = history.value.entries.filter(entry => !expressions.includes(entry.label))
  const entries = [
    ...expressions.map(expression => ({ reference: meta.value[expression]?.reference ?? 0, label: expression })),
    ...valueRoots,
  ]
  const index = expressions.length ? expressions.length - 1 : (entries.length ? 0 : -1)
  history.value = { entries, index }
}

watch(() => props.expressions, expressions => syncHistory(expressions ?? []), { immediate: true })

/** 当前项一变就把它算出来并取一层孩子（历史条目本身可能还没算过）。 */
watch(() => current.value?.label, async label => {
  note.value = ''
  if (!label) return
  const entry = await ensureEntry(label)
  if (entry && entry.reference > 0) {
    open.value = { ...open.value, root: true }
    await loadChildren(entry.reference)
  }
}, { immediate: true })

// 停住一次就重算当前项（上游 `sessionPaused` 重建树；值只在停住时才有意义）。
watch(() => props.generation, async () => {
  const label = current.value?.label
  if (!label) return
  const stale = { ...meta.value }
  delete stale[label]
  meta.value = stale
  const entry = await ensureEntry(label)
  if (entry && entry.reference > 0) await loadChildren(entry.reference)
})

function navigate(direction: 'backward' | 'forward') {
  const next = direction === 'backward' ? goBackward(history.value) : goForward(history.value)
  if (next === history.value) return
  history.value = next
  selectedKey.value = ''
}

/** 点历史条：把光标移到它（同一项再点一次不重算，靠 `ensureEntry` 的缓存）。 */
function pickEntry(label: string) {
  const index = history.value.entries.findIndex(entry => entry.label === label)
  if (index >= 0) history.value = { ...history.value, index }
}

function toggleRoot() {
  const reference = currentEntry.value?.reference ?? 0
  open.value = { ...open.value, root: !open.value.root }
  if (open.value.root && reference > 0) void loadChildren(reference)
}

/** 「设为根」：把选中的非叶子提成新根（`pushValueHistory` 的 splice 语义在规则模块里）。 */
function setAsRoot() {
  const row = selectedRow.value
  if (!row || !canRoot.value) return
  const entry = historyValueEntry(row.name ?? row.key, row.value, row.type, row.reference)
  meta.value = { ...meta.value, [entry.expression]: entry }
  history.value = pushValueHistory(history.value, { reference: entry.reference, label: entry.expression })
  selectedKey.value = ''
  if (entry.reference > 0) void loadChildren(entry.reference)
}

function openMenu(event: MouseEvent, row: HistoryTreeRow) {
  selectedKey.value = row.key
  menu.value = { x: event.clientX, y: event.clientY, row }
}

const menuItems = computed(() => {
  if (!menu.value) return []
  const supported: XValueNodeActionId[] = ['copy-value', 'copy-name', ...(props.delegate ?? [])]
  return historyRowMenuItems(menu.value.row, supported)
})

async function pickMenu(mode: string) {
  const row = menu.value?.row
  menu.value = null
  if (!row) return
  if (mode === 'copy-value' || mode === 'copy-name') {
    const text = debugCopyText({ name: row.name ?? '', value: row.value, type: row.type }, mode as DebugCopyMode)
    await copyToClipboard(text)
    note.value = debugCopyNote({ name: row.name ?? '', value: row.value }, mode as DebugCopyMode, true)
    return
  }
  emit('action', mode as XValueNodeActionId, row)
}
</script>

<template>
  <aside class="debug-history-tree" role="complementary" aria-label="求值历史树" tabindex="0" @keydown.alt.left.prevent="navigate('backward')" @keydown.alt.right.prevent="navigate('forward')">
    <div class="debug-history-tree-head">
      <span class="debug-history-tree-title" :title="title"><History :size="iconSize.dense" /> {{ title }}</span>
      <span class="debug-history-tree-count">{{ history.entries.length }}</span>
    </div>

    <div class="debug-history-tree-toolbar" role="toolbar" aria-label="历史导航">
      <button type="button" :disabled="!canForward" title="前进（Alt+→）" aria-label="前进" @click="navigate('forward')"><ArrowRight :size="iconSize.chip" /></button>
      <button type="button" :disabled="!canRoot" title="设为根" aria-label="设为根" @click="setAsRoot()"><Crosshair :size="iconSize.chip" /></button>
      <button type="button" :disabled="!canBack" title="后退（Alt+←）" aria-label="后退" @click="navigate('backward')"><ArrowLeft :size="iconSize.chip" /></button>
    </div>

    <div class="debug-history-tree-picks" role="list" aria-label="历史条目">
      <button v-for="entry in history.entries" :key="entry.label" type="button" role="listitem" class="debug-history-tree-pick" :class="{ active: entry.label === current?.label }" :title="entry.label" @click="pickEntry(entry.label)">{{ entry.label }}</button>
    </div>

    <p v-if="busy || note" class="debug-history-tree-note">{{ busy ? '取数中…' : note }}</p>
    <p v-if="!currentEntry" class="debug-empty">还没有可展开的求值结果。</p>

    <div v-else class="debug-history-tree-rows" role="tree" aria-label="求值结果树">
      <div v-for="row in rows" :key="row.key" class="debug-history-tree-row" :class="{ selected: row.key === selectedKey, ellipsis: row.kind === 'ellipsis' }" :style="{ paddingLeft: row.kind === 'child' ? 'var(--space-4)' : 'var(--space-1)' }" role="treeitem" @click="selectedKey = row.key">
        <button v-if="row.kind === 'root'" type="button" class="debug-history-tree-caret" :title="open.root ? '收起' : '展开'" :aria-label="open.root ? '收起' : '展开'" @click.stop="toggleRoot()"><ChevronDown v-if="open.root" :size="iconSize.chip" /><ChevronRight v-else :size="iconSize.chip" /></button>
        <span v-if="row.name" class="debug-history-tree-name">{{ row.name }}</span>
        <span class="debug-history-tree-value">{{ row.text }}</span>
        <button v-if="row.kind !== 'ellipsis'" type="button" class="debug-history-tree-menu" title="行动作" :aria-label="`${row.name ?? '值'} 的行动作`" @click.stop="openMenu($event, row)">⋯</button>
      </div>
    </div>

    <DebugRowMenu v-if="menu" :x="menu.x" :y="menu.y" :items="menuItems" @pick="pickMenu" @close="menu = null" />
  </aside>
</template>

<style scoped>
.debug-history-tree { display: flex; flex-direction: column; gap: var(--space-1); min-width: 0; outline: none; }
.debug-history-tree-head { display: flex; align-items: center; justify-content: space-between; gap: var(--space-1); color: var(--muted); font-size: 11px; }
.debug-history-tree-title { display: inline-flex; align-items: center; gap: var(--space-1); min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-family: var(--font-mono); }
.debug-history-tree-count { color: var(--muted); }
.debug-history-tree-toolbar { display: flex; gap: var(--space-1); }
.debug-history-tree-toolbar button, .debug-history-tree-caret, .debug-history-tree-menu { display: inline-flex; align-items: center; justify-content: center; width: 20px; height: 20px; padding: 0; border: 1px solid var(--line-strong); border-radius: var(--radius-xs); background: var(--bg); color: var(--text); cursor: pointer; }
.debug-history-tree-toolbar button:disabled { opacity: .45; cursor: default; }
.debug-history-tree-picks { display: flex; flex-direction: column; max-height: 108px; overflow: auto; border-top: 1px solid var(--line); border-bottom: 1px solid var(--line); }
.debug-history-tree-pick { text-align: left; border: 0; background: transparent; color: var(--text); font: 11px var(--font-mono); padding: 2px var(--space-1); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; cursor: pointer; }
.debug-history-tree-pick:hover { background: var(--hover); color: var(--bright); }
.debug-history-tree-pick.active { background: var(--hover); color: var(--bright); }
.debug-history-tree-note { margin: 0; color: var(--warning); font-size: 11px; }
.debug-history-tree-rows { overflow: auto; }
.debug-history-tree-row { display: flex; align-items: center; gap: var(--space-1); padding: 1px var(--space-1); border-radius: var(--radius-xs); font: 11px/1.6 var(--font-mono); }
.debug-history-tree-row.selected { background: var(--hover); }
.debug-history-tree-row.ellipsis { color: var(--muted); }
.debug-history-tree-name { color: var(--bright); }
.debug-history-tree-value { color: var(--text); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.debug-history-tree-menu { margin-left: auto; border-color: transparent; background: transparent; color: var(--muted); }
</style>
