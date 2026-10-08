<script setup lang="ts">
// Select In 弹窗（IDEA `SelectInAction` 的 `title.popup.select.target` = "Select In"，
// IdeBundle.properties:407）。上游默认走 **action group popup**
// （`ide.selectIn.experimental.popup` 默认为 true：SelectInAction.java:65 → :88-106），
// 编号来自 ActionStepBuilder.java:120-131，画在**行首独立的数字列**里
// （PopupListElementRenderer.java:363-369：`myMnemonicLabel`，选中时用选中前景色）。
// 键盘：↑↓ 在可选行之间移动、Enter 选中、Esc 关闭、直接按编号命中（MnemonicsSearch.java:34-46）。
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from 'vue'
import { filterSelectIn, moveSelectIn, selectInMnemonics, selectInMnemonicHit, type SelectInRow } from '../selectIn'
import { popupCancelKeyAction } from '../popupCancel'
import { useBestPositionAnchor } from '../popupPlacement'

const props = defineProps<{ rows: SelectInRow[]; x?: number; y?: number }>()
const emit = defineEmits<{ (event: 'pick', id: string): void; (event: 'close'): void }>()

const filter = ref('')
const list = ref<HTMLElement>()
const visible = computed(() => filterSelectIn(props.rows, filter.value))
const mnemonics = computed(() => selectInMnemonics(props.rows))
// 打开时选中第一条**可选**的目标（置灰的不能被默认选中）。
const selected = ref(-1)
function firstSelectable(rows: readonly SelectInRow[]) { return rows.findIndex(row => row.selectable) }
function scrollSelectedIntoView() {
  const index = selected.value
  if (!visible.value[index]?.selectable) return
  list.value?.querySelectorAll<HTMLElement>('.select-in-row')[index]?.scrollIntoView({ block: 'nearest' })
}
function sync() {
  selected.value = firstSelectable(visible.value)
  void nextTick(() => { list.value?.focus(); scrollSelectedIntoView() })
}
sync()
watch(visible, rows => {
  const current = rows[selected.value]
  if (!current || !current.selectable) selected.value = firstSelectable(rows)
})
watch([selected, visible], scrollSelectedIntoView, { flush: 'post' })

function rowClass(row: SelectInRow) { return { 'is-selected': visible.value[selected.value]?.id === row.id, 'is-disabled': !row.selectable } }
function hover(index: number) { if (visible.value[index]?.selectable) selected.value = index }
function pick(row: SelectInRow) { if (!row.selectable) return; emit('pick', row.id) }
function onKeydown(event: KeyboardEvent) {
  if (event.key === 'Escape') {
    event.preventDefault()
    // 两段式（`AbstractPopup.dispatchKeyEvent:3003-3010`）：速度搜索框里有字时先清掉它，弹层留着；
    // 空了才关。少了第一段，用户想退一格就要重开整个弹窗。
    if (popupCancelKeyAction(filter.value) === 'reset-filter') { filter.value = ''; selected.value = 0; return }
    emit('close')
    return
  }
  if (event.key === 'ArrowDown') { event.preventDefault(); selected.value = moveSelectIn(visible.value, selected.value, 1); return }
  if (event.key === 'ArrowUp') { event.preventDefault(); selected.value = moveSelectIn(visible.value, selected.value, -1); return }
  if (event.key === 'Enter') { event.preventDefault(); const row = visible.value[selected.value]; if (row) pick(row); return }
  if (event.ctrlKey || event.altKey || event.metaKey || event.isComposing) return
  const hit = selectInMnemonicHit(mnemonics.value, visible.value, event.key, filter.value)
  if (hit) { event.preventDefault(); emit('pick', hit); return }
  // 没命中助记符的字母进入速度搜索（SpeedSearch.java:55：空串放行全部）。
  if (event.key === 'Backspace') { event.preventDefault(); filter.value = filter.value.slice(0, -1) }
  else if (event.key.length === 1 && event.key !== ' ') filter.value += event.key
}
// `showInBestPositionFor`（`AbstractPopup.java:974-993`）：编辑器有焦点时钉在光标处；
// 没有光标（例如从工具窗口里触发）时按**实测尺寸**在窗口里居中（`showInFocusCenter`）。
// 落位与越界夹取都在 src/popupPlacement.ts，不再按行数猜高度。
const { style: anchor } = useBestPositionAnchor(list, () =>
  props.x === undefined || props.y === undefined ? null : { x: props.x, y: props.y })
// 点到弹窗外就收起（IDEA 的 list popup 同样在失焦/点外部时关闭）。
function onPointerDown(event: PointerEvent) { if (!list.value?.contains(event.target as Node)) emit('close') }
onMounted(() => window.addEventListener('pointerdown', onPointerDown, true))
onUnmounted(() => window.removeEventListener('pointerdown', onPointerDown, true))
</script>

<template>
  <div ref="list" class="select-in" role="listbox" aria-label="Select In" tabindex="-1" :style="anchor" @keydown.stop="onKeydown">
    <p v-if="filter" class="select-in-filter">{{ filter }}</p>
    <button v-for="(row, index) in visible" :key="row.id" class="select-in-row" :class="rowClass(row)" role="option"
            :aria-selected="visible[selected]?.id === row.id" :aria-disabled="!row.selectable" :disabled="!row.selectable"
            @click="pick(row)" @mouseenter="hover(index)">
      <span class="select-in-number" aria-hidden="true">{{ row.number }}</span>
      <span class="select-in-label">{{ row.label }}</span>
    </button>
    <p v-if="!visible.length" class="select-in-empty">没有匹配的目标。</p>
  </div>
</template>

<style scoped>
.select-in {
  max-height: min(calc(var(--popup-row-h) * 30 + 2 * var(--popup-pad) + 2px), calc(100dvh - 2 * var(--space-2)));
  overflow-y: auto;
}
</style>
