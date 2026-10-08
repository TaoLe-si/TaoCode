<script setup lang="ts">
// 「检查值」窗口 —— 上游 `XInspectAction` → `XInspectDialog` → `DebuggerTreeWithHistoryPanel`
// 的等价物：
//   · `platform/xdebugger-impl/ui/src/com/intellij/xdebugger/impl/ui/tree/actions/XInspectAction.java:22-30`
//     （把节点的值塞进一个检查窗口，最后一个参数 `rebuildOnSessionEvents = true`）；
//   · `.../ui/tree/XInspectDialog.java:38` `super(project, false)` + `:42` `setModal(false)`
//     —— **非模态**；`:41` 标题带上节点名；`:59-63` 每次 `sessionPaused` 重建树；
//     `:65-74` 会话结束时**不关**窗口（IDEA-132136）。
//   · `.../evaluate/quick/common/DebuggerTreeWithHistoryContainer.java:88-103`
//     工具条三个动作：设为根 / Alt+← 往回 / Alt+→ 往前；历史规则在 `src/debugValueHistory.ts`。
//
// 为什么它能自己取数：DAP 会话是宿主里的**一个**全局会话（`native/dap.cpp` 分派 `dap.*`），
// 所以任何组件都能直接问 `dapVariables`/`dapSetVariable`（`src/bridge.ts:755` / `:758`），
// 不必从 DebugPanel 层层往下传。行摊平也复用 `collectReferenceRows`（`src/debugDataView.ts`），
// 与 Variables 视图同一套过滤/排序/分组/按数组显示规则。
//
// 仍未接的一根线：入口在变量行的行动作弹层（「检查」条目由 `src/debugRowActions.ts`
// 生成），挂载点得由 DebugPanel 给出 —— 那个文件 897/900 行且归断点/附加那个 agent，
// 本轮不碰（见交付报告的「共享文件」一节）。
import { computed, ref, watch } from 'vue'
import { X, ArrowLeft, ArrowRight, Crosshair, ChevronDown, ChevronRight, PenLine } from 'lucide-vue-next'
import { iconSize } from '../uiIcons'
import { dapSetVariable, dapVariables, type DapVariable } from '../bridge'
import { collectReferenceRows, canViewAsArray, DEFAULT_DEBUG_DATA_VIEW, type DebugDataViewOptions, type VarRow } from '../debugDataView'
import {
  canGoBackward, canGoForward, canSetAsRoot, createValueHistory, currentValueHistoryEntry,
  goBackward, goForward, pushValueHistory, type ValueHistory,
} from '../debugValueHistory'

const props = defineProps<{
  /** 被检查值的容器 reference（DAP `variablesReference`）与显示名。 */
  reference: number
  name: string
  /** 数据视图选项（隐藏 null / 排序 / 分组 / 按数组显示）。 */
  options?: DebugDataViewOptions | null
  /** 停住次数：每次暂停 +1 ⇒ 树重建（上游 `sessionPaused` → `rebuild()`）。 */
  generation?: number
}>()

const values = ref<Record<number, DapVariable[]>>({})
const open = ref<Record<string, boolean>>({})
const arrayViews = ref<number[]>([])
const history = ref<ValueHistory>(createValueHistory(props.reference, props.name))
const selectedKey = ref('')
const note = ref('')
const busy = ref(false)

const viewOptions = computed<DebugDataViewOptions>(() => ({
  ...DEFAULT_DEBUG_DATA_VIEW, ...(props.options ?? {}), arrayViews: arrayViews.value,
}))
const rootReference = computed(() => currentValueHistoryEntry(history.value)?.reference ?? props.reference)
const title = computed(() => `检查值：${currentValueHistoryEntry(history.value)?.label ?? props.name}`)
const rows = computed<VarRow[]>(() =>
  collectReferenceRows(rootReference.value, values.value, open.value, viewOptions.value))
const selectedRow = computed(() => rows.value.find(row => row.key === selectedKey.value))
const setAsRootOk = computed(() => canSetAsRoot(
  selectedRow.value ? selectedRow.value.depth + 1 : 0, selectedRow.value ? !selectedRow.value.expandable : true,
))

/** DAP `dap.variables` 回答的是 `{ variables }`；这里取数组那一层（形状问题就地归一）。 */
async function childrenOf(reference: number): Promise<DapVariable[]> {
  const result = await dapVariables(reference)
  return Array.isArray(result) ? result : (result?.variables ?? [])
}

async function load(reference: number) {
  busy.value = true
  try {
    values.value = { ...values.value, [reference]: await childrenOf(reference) }
  } catch (caught) {
    values.value = { ...values.value, [reference]: [] }
    note.value = caught instanceof Error ? caught.message : String(caught)
  } finally { busy.value = false }
}

async function toggle(row: VarRow) {
  if (!row.expandable) { selectedKey.value = row.key; return }
  open.value = { ...open.value, [row.key]: !open.value[row.key] }
  selectedKey.value = row.key
  if (row.expanded === false && open.value[row.key] && !values.value[row.reference]) await load(row.reference)
}

/** 「按数组显示」：孩子加载过且全是索引形态才给（`canViewAsArray`，`src/debugDataView.ts:79`）。 */
async function toggleArray(row: VarRow) {
  if (arrayViews.value.includes(row.reference)) {
    arrayViews.value = arrayViews.value.filter(reference => reference !== row.reference)
    return
  }
  const children = values.value[row.reference] ?? await childrenOf(row.reference)
  values.value = { ...values.value, [row.reference]: children }
  if (canViewAsArray(children)) arrayViews.value = [...arrayViews.value, row.reference]
  else note.value = '这个容器的孩子不是索引形态，不能按数组显示。'
}

function setAsRoot() {
  const row = selectedRow.value
  if (!row || !setAsRootOk.value) return
  history.value = pushValueHistory(history.value, { reference: row.reference, label: row.name })
  selectedKey.value = ''
  void load(row.reference)
}

function back() { if (canGoBackward(history.value)) history.value = goBackward(history.value) }
function forward() { if (canGoForward(history.value)) history.value = goForward(history.value) }

// 会话结束时不清窗口（上游 IDEA-132136，XInspectDialog.java:65-74），只提示。
watch(() => props.generation, () => {
  note.value = ''
  const root = rootReference.value
  if (props.generation === undefined) return
  void load(root)
}, { immediate: false })

/** 就地改值（DAP `setVariable` 要的是**容器** reference，`VarRow.container`）。 */
const editKey = ref('')
const editText = ref('')
function beginEdit(row: VarRow) { editKey.value = row.key; editText.value = row.value }
function cancelEdit() { editKey.value = ''; editText.value = '' }
async function commitEdit(row: VarRow) {
  const text = editText.value
  cancelEdit()
  if (text === row.value) return
  try {
    await dapSetVariable(row.container, row.apiName, text)
    await load(row.container)
    note.value = `已把 ${row.name} 设为 ${text}。`
  } catch (caught) {
    note.value = caught instanceof Error ? caught.message : String(caught)
  }
}
</script>

<template>
  <section class="debug-inspect" role="dialog" aria-label="检查值">
    <header class="debug-inspect-head">
      <span class="debug-inspect-title">{{ title }}</span>
      <div class="debug-inspect-tools">
        <button class="icon-button" :disabled="!setAsRootOk" :title="setAsRootOk ? '把选中节点设为根' : '先选中一个还有孩子的节点'" aria-label="设为根" @click="setAsRoot"><Crosshair :size="iconSize.dense" /></button>
        <button class="icon-button" :disabled="!canGoBackward(history)" title="往回一步（Alt+←）" aria-label="往回一步" @click="back"><ArrowLeft :size="iconSize.dense" /></button>
        <button class="icon-button" :disabled="!canGoForward(history)" title="往前一步（Alt+→）" aria-label="往前一步" @click="forward"><ArrowRight :size="iconSize.dense" /></button>
        <button class="icon-button" title="关闭" aria-label="关闭检查值窗口" @click="$emit('close')"><X :size="iconSize.dense" /></button>
      </div>
    </header>
    <p v-if="note" class="debug-inspect-note">{{ note }}</p>
    <div class="debug-inspect-tree" role="tree" aria-label="值树">
      <div v-for="row in rows" :key="row.key" class="debug-inspect-row" role="treeitem" :aria-expanded="row.expandable ? row.expanded : undefined" :aria-selected="row.key === selectedKey" :style="{ paddingLeft: `${row.depth * 12}px` }" @click="toggle(row)">
        <span class="debug-expander"><ChevronDown v-if="row.expandable && row.expanded" :size="iconSize.dense" aria-hidden="true" /><ChevronRight v-else-if="row.expandable" :size="iconSize.dense" aria-hidden="true" /></span>
        <span class="debug-name">{{ row.name }}</span>
        <span class="debug-value">{{ row.value }}</span>
        <span class="debug-type">{{ row.type }}</span>
        <button v-if="row.expandable" class="icon-button" :title="viewOptions.arrayViews?.includes(row.reference) ? '取消按数组显示' : '按数组显示'" :aria-label="`${row.name} 的数组显示`" @click.stop="toggleArray(row)"><Crosshair :size="iconSize.dense" /></button>
        <button v-if="row.state === 'value' && !row.group" class="icon-button" :title="`设置 ${row.name} 的值`" :aria-label="`设置 ${row.name} 的值`" @click.stop="beginEdit(row)"><PenLine :size="iconSize.dense" /></button>
      </div>
      <div v-if="editKey" class="debug-inspect-edit">
        <input v-model="editText" class="debug-input" aria-label="新的值" spellcheck="false" @keydown.enter.prevent="commitEdit(rows.find(row => row.key === editKey)!)" @keydown.esc="cancelEdit" />
        <button class="debug-btn primary" @click="commitEdit(rows.find(row => row.key === editKey)!)">写入</button>
        <button class="debug-btn" @click="cancelEdit">取消</button>
      </div>
      <p v-if="!rows.length" class="debug-empty">{{ busy ? '正在读取值…' : '这个值没有可显示的孩子。' }}</p>
    </div>
  </section>
</template>

<style scoped>
/* 非模态浮窗（上游 XInspectDialog 用 `setModal(false)` + 独立 DialogWrapper）。 */
.debug-inspect { position: fixed; right: var(--space-4); bottom: var(--space-4); z-index: 60; display: flex; flex-direction: column; width: min(520px, calc(100vw - 32px)); max-height: min(420px, 60vh); border: var(--popup-border); border-radius: var(--popup-radius); background: var(--elevated); color: var(--popup-foreground); box-shadow: var(--popup-shadow); }
.debug-inspect-head { display: flex; align-items: center; gap: var(--space-2); padding: var(--space-1) var(--space-2); border-bottom: 1px solid var(--line); }
.debug-inspect-title { flex: 1; min-width: 0; color: var(--bright); font-size: 12px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.debug-inspect-tools { display: flex; align-items: center; gap: 2px; }
.debug-inspect-note { margin: 0; padding: var(--space-1) var(--space-2); color: var(--warning); font-size: 11px; }
.debug-inspect-tree { flex: 1; min-height: 0; overflow: auto; padding: var(--space-1) 0; }
.debug-inspect-row { display: flex; align-items: center; gap: var(--space-1); padding: 1px var(--space-2); font: 11px/1.6 var(--font-mono); cursor: default; transition: background-color var(--dur-1) var(--ease); }
.debug-inspect-row:hover { background: var(--hover); }
.debug-inspect-row[aria-selected='true'] { background: var(--selection); }
.debug-inspect-row .icon-button { flex-shrink: 0; }
.debug-inspect-row .icon-button svg { flex-shrink: 0; }
/* 这几格与 Variables 视图同名同色（DebugPanel.vue:857-860 的 scoped 规则搬过来一份：
   scoped 样式不跨组件，浮窗里必须自带，否则值树会以无样式的纯文本渲染）。 */
.debug-inspect-row .debug-expander { display: inline-flex; align-items: center; justify-content: center; width: 14px; flex-shrink: 0; color: var(--muted); }
.debug-inspect-row .debug-name { flex-shrink: 0; max-width: 40%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: var(--syntax-keyword); }
.debug-inspect-row .debug-value { flex: 1; min-width: 0; color: var(--syntax-string); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.debug-inspect-row .debug-type { margin-left: auto; color: var(--muted); flex-shrink: 0; }
.debug-inspect-tree .debug-empty { margin: 0; padding: var(--space-1) var(--space-2); color: var(--muted); font-size: 11px; }
.debug-input { flex: 1; min-width: 0; min-height: var(--ctrl-height-sm); padding: 2px var(--space-1); color: var(--text); background: var(--editor); border: 1px solid var(--line-strong); border-radius: var(--radius-xs); font: 11px/1.4 var(--font-mono); }
.debug-input:focus-visible { outline: var(--focus-ring); outline-offset: var(--focus-ring-offset-inset); }
.debug-btn { display: inline-flex; align-items: center; gap: var(--space-1); padding: 3px var(--space-2); border: 1px solid var(--line-strong); border-radius: var(--radius-sm); background: var(--elevated); color: var(--text); font-size: 11px; }
.debug-btn:hover { background: var(--hover); color: var(--bright); }
.debug-btn.primary { border-color: var(--accent); color: var(--accent); }
.debug-inspect-edit { display: flex; align-items: center; gap: var(--space-1); padding: var(--space-1) var(--space-2); }
</style>
