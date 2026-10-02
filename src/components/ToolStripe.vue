<script setup lang="ts">
// 工具窗口的**侧条**（IDEA 的 `ToolWindowToolbar` + `AbstractDroppableStripe` 那一层）。
//
// 为什么单独一个组件：App.vue 顶在机检上限（`tests/module-size.test.mjs` 的 2737 行），
// 而这一块要长出两样新东西 —— 拖宽的分隔线（`ResizeStripeManager`）与「更多」按钮
// （`MoreSquareStripeButton`）。左/右两条侧条本来就是同一份结构（IDEA 是 `ToolWindowLeftToolbar` /
// `ToolWindowRightToolbar` 两个薄子类，都继承同一个 `ToolWindowToolbar`），合成一个组件后
// 两侧不会再各修一遍。
//
// 上游坐标：
//   · 轨道 + 按钮：`Stripe.java` / `AbstractDroppableStripe.kt`（拖拽重排、投放标记）。
//   · 宽度：`ResizeStripeManager.kt`（分隔线在**内沿**：左条 `width - 1`、右条 `0`，`:79-86`；
//     只有「显示工具窗口名称」开着时才挂，`:89-102` + `:210-213`）。
//   · 空白处右键：`ResizeStripeManager.kt:49-61` 挂的那个 `PopupHandler` —— 弹层里只有一条
//     `ToolWindowShowNamesAction`（文案 `ActionsBundle.properties:2813` = 显示工具窗口名称）。
//   · 「更多」：`MoreSquareStripeButton.kt`（左键 = 没有侧条按钮的窗口列表 `ShowMoreToolWindowsAction:100-123`；
//     右键 = 「移至<对侧>」`createPopupGroup:49-61`；可达名 `more.button.accessible.name` = 更多）。
import { computed, onUnmounted, ref } from 'vue'
import { Check, MoreHorizontal } from 'lucide-vue-next'
import { startStripeResize, stripeRailWidth, stripeWidthLimits, type StripeSide } from '../stripeResize'
import type { ToolWindowId } from '../toolWindowMeta'
import { iconSize } from '../uiIcons'

const props = defineProps<{
  side: StripeSide
  /** 这一侧要画的窗口（宿主给的顺序：`stripeOrder(side)` 已按锚点过滤、按用户顺序排好）。 */
  ids: ToolWindowId[]
  labels: Record<string, string>
  icons: Record<string, unknown>
  /** Alt+数字助记符（`ActivateToolWindowAction` 的快捷键数字）。 */
  mnemonicOf: (id: ToolWindowId) => string | undefined
  isDisabled: (id: ToolWindowId) => boolean
  /** 这一格是不是「当前激活的那个窗口」（左条与右 dock 共用同一份判定）。 */
  isActive: (id: ToolWindowId) => boolean
  /** 正在被拖拽的窗口 id（`AbstractDroppableStripe` 的拖影态）。 */
  dragging: string | null
  /** 拖拽重排的落点（`AbstractDroppableStripe` 的投放标记）：`isDropBefore(side, id)`，宿主侧那份判据。 */
  isDropBefore: (side: StripeSide, id: ToolWindowId) => boolean
  /** 最后一个按钮之后要画标记（拖到这一侧末尾）。 */
  dropAtEnd: boolean
  /** 这一侧的自定义宽度，0 = 没设（`myCustomWidth == 0`）。 */
  width: number
  /** 「显示工具窗口名称」（`UISettings.showToolWindowsNames`）。 */
  showNames: boolean
  /** 紧凑模式（决定拖拽下限 33/40）。 */
  compact: boolean
  /** 「更多」按钮的行（宿主已按 `ToolWindowsGroup` 的规则算好；标题/助记符仍从 labels/mnemonicOf 取）。 */
  moreIds: ToolWindowId[]
  /** `getMoreButtonSide() === side`：按钮只画在它当前停靠的那一侧。 */
  moreOnThisSide: boolean
}>()

const emit = defineEmits<{
  activate: [id: ToolWindowId]
  menu: [id: ToolWindowId, event: MouseEvent]
  dragStart: [id: ToolWindowId, event: DragEvent]
  dragOver: [id: ToolWindowId | null, event: DragEvent]
  drop: [id: ToolWindowId | null, event: DragEvent]
  dragEnd: []
  resize: [width: number]
  /** 「显示工具窗口名称」开关（侧条空白处右键那一行）。 */
  toggleNames: []
  /** 「更多」弹层里选了一个窗口。 */
  morePick: [id: ToolWindowId]
  /** 「移至<对侧>侧」。 */
  moveMoreTo: [side: StripeSide]
}>()

const resizing = ref(false)
const moreOpen = ref(false)
const moveOpen = ref(false)
const namesOpen = ref(false)
const at = ref({ left: 0, top: 0 })
const moreButton = ref<HTMLElement>()
const rail = ref<HTMLElement>()

const railWidth = computed(() => stripeRailWidth(props.width))
const limits = computed(() => stripeWidthLimits(props.compact))
const railStyle = computed(() => (props.width > 0 ? { width: `${props.width}px`, minWidth: `${props.width}px` } : undefined))
const moreVisible = computed(() => props.moreOnThisSide && props.moreIds.length > 0)
// `tool.window.new.stripe.more.title` / `more.button.accessible.name`（UIBundle，中文包 = 更多工具窗口 / 更多）
const moreTitle = '更多工具窗口'
const moreLabel = '更多'
const otherSide = computed<StripeSide>(() => (props.side === 'left' ? 'right' : 'left'))
// `tool.window.more.button.move` = 移至{0}侧，{0} 是 `ToolWindowAnchor.getCapitalizedDisplayName()`
// （`action.text.anchor.left|right.capitalized`，中文包 = 左 / 右）。
const moveTitle = computed(() => `移至${otherSide.value === 'right' ? '右' : '左'}侧`)

function closePopups() {
  moreOpen.value = false
  moveOpen.value = false
  namesOpen.value = false
}
/**
 * `ShowMoreToolWindowsAction.showPopup:119-123`：弹层的左沿贴住轨道外沿、上沿贴住按钮
 * （左条 `x = toolbar.width`；右条 `x = -minPopupWidth`，`minPopupWidth = JBUI.scale(300)`）。
 */
function openFrom(button: HTMLElement | undefined) {
  const box = button?.getBoundingClientRect()
  const bar = rail.value?.getBoundingClientRect()
  if (!box || !bar) return
  at.value = { left: props.side === 'left' ? bar.right : Math.max(8, bar.left - 300), top: box.top }
}
function toggleMore() {
  const open = !moreOpen.value
  closePopups()
  if (!open) return
  openFrom(moreButton.value)
  moreOpen.value = true
}
function toggleMoveTo(event: MouseEvent) {
  const open = !moveOpen.value
  closePopups()
  if (!open) return
  openFrom(event.currentTarget as HTMLElement)
  moveOpen.value = true
}
/** `ResizeStripeManager.kt:49-61`：侧条空白处右键 = 只有一条「显示工具窗口名称」。 */
function openNamesMenu(event: MouseEvent) {
  closePopups()
  at.value = { left: event.clientX, top: event.clientY }
  namesOpen.value = true
}
function onResizeStart(event: PointerEvent) {
  startStripeResize(event, props.side, {
    width: () => props.width,
    apply: next => emit('resize', next),
    compact: () => props.compact,
    setResizing: value => { resizing.value = value },
  })
}
/**
 * 「更多」弹层里点一行 = 激活那个窗口（`ActivateToolWindowAction`）：激活路径会把它的侧条按钮放回来
 * （`ToolWindowManagerImpl.showToolWindowImpl:942`），于是"更多"自己随后就消失 —— 上游同一个循环。
 */
function pickMore(id: ToolWindowId) {
  closePopups()
  emit('morePick', id)
}
function onPointerDown(event: PointerEvent) {
  if (!moreOpen.value && !moveOpen.value && !namesOpen.value) return
  const target = event.target as Element
  if (target.closest('.stripe-popup') || target.closest('.stripe-more')) return
  closePopups()
}
function onKeydown(event: KeyboardEvent) {
  if (event.key === 'Escape') closePopups()
}
if (typeof window !== 'undefined') {
  window.addEventListener('pointerdown', onPointerDown)
  window.addEventListener('keydown', onKeydown)
}
onUnmounted(() => {
  window.removeEventListener('pointerdown', onPointerDown)
  window.removeEventListener('keydown', onKeydown)
})
</script>

<template>
  <aside
    ref="rail" class="activity-bar" :class="{ 'right-stripe': side === 'right' }" :style="railStyle"
    :aria-label="side === 'left' ? '左侧工具栏' : '右侧工具栏'"
    @contextmenu.prevent="openNamesMenu"
    @dragover="emit('dragOver', null, $event)" @drop="emit('drop', null, $event)"
  >
    <!-- 按钮列表单独一层：轨道自己不能再滚（分隔线要整条贴着轨道内沿），溢出交给这一层。 -->
    <div class="stripe-list">
      <template v-for="id in ids" :key="id">
        <span v-if="isDropBefore(side, id)" class="stripe-drop-marker" aria-hidden="true" />
        <button
          class="activity-button" :class="{ active: isActive(id), dragging: dragging === id }" draggable="true"
          :title="`${labels[id]}（可拖到另一侧或拖动重排）`" :aria-label="`切换${labels[id]}`" :disabled="isDisabled(id)"
          @click="emit('activate', id)" @contextmenu.prevent.stop="emit('menu', id, $event)"
          @dragstart="emit('dragStart', id, $event)" @dragover="emit('dragOver', id, $event)"
          @drop="emit('drop', id, $event)" @dragend="emit('dragEnd')"
        ><component :is="icons[id]" /><span class="activity-name">{{ labels[id] }}</span><span class="activity-number">{{ mnemonicOf(id) }}</span></button>
      </template>
      <span v-if="dropAtEnd" class="stripe-drop-marker" aria-hidden="true" />
      <!-- 「更多」（`MoreSquareStripeButton`）：位置在上条纹之后、拆分按钮之前。 -->
      <button
        v-if="moreVisible" ref="moreButton" class="activity-button stripe-more" :class="{ active: moreOpen }"
        :title="moreTitle" :aria-label="moreLabel" :aria-expanded="moreOpen"
        @click.stop="toggleMore()" @contextmenu.prevent="toggleMoveTo"
      ><MoreHorizontal /></button>
    </div>
    <span v-if="side === 'right'" class="stripe-drop-hint" aria-hidden="true" />
    <!-- 宽度的分隔线（`ResizeStripeManager` 的 `mySplitter`）：只有名称开着时才挂（`:89-102`）。 -->
    <span
      v-if="showNames" class="stripe-resize-handle" :class="{ dragging: resizing }" role="separator" aria-orientation="vertical"
      :aria-label="`调整${side === 'left' ? '左' : '右'}侧条宽度`" :aria-valuenow="railWidth" :aria-valuemin="limits.min" :aria-valuemax="limits.max"
      @pointerdown="onResizeStart"
    />
    <slot />

    <Teleport v-if="moreOpen || moveOpen || namesOpen" to="body">
      <div v-if="moreOpen" class="stripe-popup stripe-popup-more" role="menu" :aria-label="moreTitle" :style="{ left: `${at.left}px`, top: `${at.top}px` }">
        <button v-for="id in moreIds" :key="id" class="menu-button stripe-popup-row" role="menuitem" @click="pickMore(id)">
          <span class="menu-item-icon"><component :is="icons[id]" :size="iconSize.menu" /></span>
          <span class="menu-item-title">{{ labels[id] }}</span>
          <span v-if="mnemonicOf(id)" class="stripe-popup-key">Alt+{{ mnemonicOf(id) }}</span>
        </button>
      </div>
      <div v-if="moveOpen" class="stripe-popup" role="menu" :aria-label="moveTitle" :style="{ left: `${at.left}px`, top: `${at.top}px` }">
        <button class="menu-button stripe-popup-row" role="menuitem" @click="closePopups(); emit('moveMoreTo', otherSide)">
          <span class="menu-item-icon" /><span class="menu-item-title">{{ moveTitle }}</span>
        </button>
      </div>
      <!-- `ToolWindowShowNamesAction`（`ActionsBundle.properties:2813` = 显示工具窗口名称）。 -->
      <div v-if="namesOpen" class="stripe-popup" role="menu" aria-label="显示工具窗口名称" :style="{ left: `${at.left}px`, top: `${at.top}px` }">
        <button class="menu-button stripe-popup-row" role="menuitemcheckbox" :aria-checked="showNames" @click="closePopups(); emit('toggleNames')">
          <span class="menu-item-icon"><Check v-if="showNames" :size="iconSize.menu" /></span>
          <span class="menu-item-title">显示工具窗口名称</span>
        </button>
      </div>
      <div class="stripe-popup-backdrop" @click="closePopups" @contextmenu.prevent="closePopups" />
    </Teleport>
  </aside>
</template>
