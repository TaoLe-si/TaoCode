<script setup lang="ts">
// 「选一个目标」的弹出列表 —— IDEA 那几个 goto 动作在多目标时共用的那个 chooser
// （`GotoDeclarationOnlyHandler2.kt:60-76` 的 Choose Declaration、`GotoTargetHandler.java:140-260`
// 的 Choose Implementation、`GotoTypeDeclarationHandler2.kt:52-62` 的 Choose Type）。
//
// 只负责渲染与派发：行怎么来的、怎么过滤怎么移动都在 `src/chooseTarget.ts`（纯函数，可测）；
// 标题由调用方给（三个动作各取自己的资源串，见那里的注释）。行的三段照
// `platform/platform-impl/src/com/intellij/ui/list/TargetPresentationMainRenderer.kt:30-44` +
// 右对齐的位置列 `.../TargetPresentationRenderer.kt:70-83`；行首图标用本仓"定位到一个位置"的统一图标
// （上游画的是元素图标，LSP 给不出，不发明字形）。
// `pinnable` = 上游 `setCouldPin`：标题栏右上角一个按钮，把结果放进"查找"窗口
// （`AbstractPopup.java:501-508`，按钮 tooltip 取 `show.in.find.window.button.name.newui`
// = `platform/platform-api/resources/messages/IdeBundle.properties:1150` "Open Results in Find Window"）。
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from 'vue'
import { FileCode2, Pin } from 'lucide-vue-next'
import { filterChooseTargets, moveChooseTarget, type ChooseTargetRow } from '../chooseTarget'
import { popupCancelKeyAction } from '../popupCancel'
import { useBestPositionAnchor } from '../popupPlacement'
import { iconSize } from '../uiIcons'

const props = defineProps<{ title: string; rows: ChooseTargetRow[]; x?: number; y?: number; pinnable?: boolean }>()
const emit = defineEmits<{ (event: 'pick', row: ChooseTargetRow): void; (event: 'close'): void; (event: 'pin'): void }>()

const filter = ref('')
const list = ref<HTMLElement>()
const visible = computed(() => filterChooseTargets(props.rows, filter.value))
// 打开时选中第一条（弹层里的列表都带一个当前项，Enter 才有落点）。
const selected = ref(0)
watch(visible, rows => {
  if (selected.value >= rows.length) selected.value = rows.length ? 0 : -1
})
void nextTick(() => list.value?.focus())

function pick(row: ChooseTargetRow | undefined) { if (row) emit('pick', row) }
function onKeydown(event: KeyboardEvent) {
  if (event.key === 'Escape') {
    event.preventDefault()
    // 两段式（`AbstractPopup.dispatchKeyEvent:2995-3012`）：速度搜索框里有字就先清字、弹层留着。
    if (popupCancelKeyAction(filter.value) === 'reset-filter') { filter.value = ''; selected.value = 0; return }
    emit('close')
    return
  }
  if (event.key === 'ArrowDown') { event.preventDefault(); selected.value = moveChooseTarget(visible.value.length, selected.value, 1); return }
  if (event.key === 'ArrowUp') { event.preventDefault(); selected.value = moveChooseTarget(visible.value.length, selected.value, -1); return }
  if (event.key === 'Enter') { event.preventDefault(); pick(visible.value[selected.value]); return }
  if (event.ctrlKey || event.altKey || event.metaKey || event.isComposing) return
  if (event.key === 'Backspace') { event.preventDefault(); filter.value = filter.value.slice(0, -1); return }
  // 其余可打印字符进速度搜索（`SpeedSearchBase.java:55`：空串放行全部）。
  if (event.key.length === 1) { event.preventDefault(); filter.value += event.key }
}
// `showInBestPositionFor(editor)`（`AbstractPopup.java:974-993`）：编辑器有光标时钉在光标处，
// 拿不到坐标就按实测尺寸居中（`showInFocusCenter`）。夹取在 src/popupPlacement.ts。
const { style: anchor } = useBestPositionAnchor(list, () =>
  props.x === undefined || props.y === undefined ? null : { x: props.x, y: props.y })
// 点到弹窗外就收起（IDEA 的列表弹层同样在点外部时关闭）。
function onPointerDown(event: PointerEvent) { if (!list.value?.contains(event.target as Node)) emit('close') }
onMounted(() => window.addEventListener('pointerdown', onPointerDown, true))
onUnmounted(() => window.removeEventListener('pointerdown', onPointerDown, true))
</script>

<template>
  <div ref="list" class="choose-target" role="listbox" :aria-label="title" tabindex="-1" :style="anchor" @keydown.stop="onKeydown">
    <p class="choose-target-title"><span>{{ title }}</span>
      <button v-if="pinnable" type="button" class="choose-target-pin" title="在查找窗口中打开结果" aria-label="在查找窗口中打开结果" @click="emit('pin')"><Pin :size="iconSize.dense" /></button>
    </p>
    <p v-if="filter" class="choose-target-filter">{{ filter }}</p>
    <button v-for="(row, index) in visible" :key="row.id" class="choose-target-row" :class="{ 'is-selected': visible[selected]?.id === row.id }"
            role="option" :aria-selected="visible[selected]?.id === row.id" @click="pick(row)" @mouseenter="selected = index">
      <FileCode2 :size="iconSize.menu" class="choose-target-icon" aria-hidden="true" />
      <span class="choose-target-name">{{ row.name }}</span>
      <span v-if="row.container" class="choose-target-container"> (in {{ row.container }})</span>
      <span class="choose-target-position">{{ row.position }}</span>
    </button>
    <p v-if="!visible.length" class="choose-target-empty">没有匹配的目标。</p>
  </div>
</template>
