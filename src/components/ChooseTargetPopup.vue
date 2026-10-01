<script setup lang="ts">
// 「选择声明」弹层 —— IDEA 的 `GotoDeclarationAction` 在**多个目标**时开的那一个
// （`GotoDeclarationOnlyHandler2.kt:60-76` 的 `MultipleTargets` 分支）。
//
// 只负责渲染与派发：行怎么来的、怎么过滤怎么移动都在 `src/chooseTarget.ts`（纯函数，可测）。
// 标题文案取自上游资源串 `declaration.navigation.title`
// （`platform/lang-api/resources/messages/CodeInsightBundle.properties:146` = "Choose Declaration"）。
// 行首图标：上游画的是元素的图标（`TargetPresentationMainRenderer.kt:40` 的 `icon = presentation.icon`），
// LSP 给不出元素图标，这里用本仓"定位到一个位置"的统一图标（与引用/问题列表同一枚），不发明字形。
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from 'vue'
import { FileCode2 } from 'lucide-vue-next'
import { filterChooseTargets, moveChooseTarget, type ChooseTargetRow } from '../chooseTarget'
import { popupCancelKeyAction } from '../popupCancel'

const props = defineProps<{ rows: ChooseTargetRow[]; x?: number; y?: number }>()
const emit = defineEmits<{ (event: 'pick', row: ChooseTargetRow): void; (event: 'close'): void }>()

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
const WIDTH = 420
// `showInBestPositionFor(editor)`：编辑器有光标时钉在光标处，拿不到坐标就落到窗口上方居中。
const anchor = computed(() => {
  const innerWidth = typeof window === 'undefined' ? 1280 : window.innerWidth
  const innerHeight = typeof window === 'undefined' ? 800 : window.innerHeight
  if (props.x === undefined || props.y === undefined) return { left: `${Math.round((innerWidth - WIDTH) / 2)}px`, top: '96px' }
  return {
    left: `${Math.max(4, Math.min(props.x, innerWidth - WIDTH - 8))}px`,
    top: `${Math.max(4, Math.min(props.y, innerHeight - 40 - props.rows.length * 26))}px`,
  }
})
// 点到弹窗外就收起（IDEA 的列表弹层同样在点外部时关闭）。
function onPointerDown(event: PointerEvent) { if (!list.value?.contains(event.target as Node)) emit('close') }
onMounted(() => window.addEventListener('pointerdown', onPointerDown, true))
onUnmounted(() => window.removeEventListener('pointerdown', onPointerDown, true))
</script>

<template>
  <div ref="list" class="choose-target" role="listbox" aria-label="选择声明" tabindex="-1" :style="anchor" @keydown.stop="onKeydown">
    <p class="choose-target-title">选择声明</p>
    <p v-if="filter" class="choose-target-filter">{{ filter }}</p>
    <button v-for="(row, index) in visible" :key="row.id" class="choose-target-row" :class="{ 'is-selected': visible[selected]?.id === row.id }"
            role="option" :aria-selected="visible[selected]?.id === row.id" @click="pick(row)" @mouseenter="selected = index">
      <FileCode2 :size="13" class="choose-target-icon" aria-hidden="true" />
      <span class="choose-target-name">{{ row.name }}</span>
      <span v-if="row.container" class="choose-target-container"> (in {{ row.container }})</span>
      <span class="choose-target-position">{{ row.position }}</span>
    </button>
    <p v-if="!visible.length" class="choose-target-empty">没有匹配的目标。</p>
  </div>
</template>
