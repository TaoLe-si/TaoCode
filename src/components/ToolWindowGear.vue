<script setup lang="ts">
// 工具窗口的齿轮按钮 + 那一份弹出菜单（上游 `ToolWindowHeader.kt:119` 的 `ShowOptionsAction`，
// 弹层内容 = `GearActionGroup`，`ToolWindowImpl.kt:801-817`、`:857-891`）。
//
// 为什么要单独一个组件：IDEA 给侧栏标题栏和底部 dock 的齿轮是**同一份内容**，本仓却只有侧栏那个
// 头有齿轮 —— 底部 dock 的内容动作（关闭所有标签页 / 标签形态）因此只能从主菜单进。
// 这里把"齿轮 + 内容组"抽出来两处共用；侧栏头部自己的那几条（隐藏 / 最大化 / 移动到…）
// 仍留在 `ToolWindowHeader.vue`，因为它们属于那个 DOM 的标题栏工具条。
//
// 弹层 Teleport 到 body 并用 fixed 定位：底部 dock 的 `.output-panel` 是 `overflow: hidden`，
// 长在里面的菜单会被裁掉（与 `ToolWindowAnchorMenu.vue` 同一个理由）。
// 开合照 `PopupState.forPopupMenu()` 的行为：点外面与 Esc 都收（`ToolWindowHeader.kt:345-368`）。
import { nextTick, onUnmounted, ref } from 'vue'
import { MoreVertical } from 'lucide-vue-next'
import ToolWindowGearRows from './ToolWindowGearRows.vue'
import type { MenuRow } from '../menus/types'
import { iconSize } from '../uiIcons'

const props = defineProps<{ rows: MenuRow[]; label?: string }>()
const emit = defineEmits<{ pick: [row: MenuRow] }>()
const open = ref(false)
const at = ref({ left: 0, bottom: 0 })

function toggle(event: MouseEvent) {
  if (open.value) { open.value = false; return }
  if (!props.rows.length) return
  const box = (event.currentTarget as HTMLElement).getBoundingClientRect()
  // 贴着按钮往上长（`top: 100%` 那一套是给侧栏往下长用的；底部 dock 往下没空间）。
  at.value = { left: Math.max(8, box.right - 0), bottom: window.innerHeight - box.top + 6 }
  open.value = true
}
function onPointerDown(event: PointerEvent) {
  if (open.value && !(event.target as Element).closest('.tool-gear-menu')) open.value = false
}
function onKeydown(event: KeyboardEvent) { if (event.key === 'Escape') open.value = false }
if (typeof window !== 'undefined') {
  window.addEventListener('pointerdown', onPointerDown, true)
  window.addEventListener('keydown', onKeydown)
}
onUnmounted(() => {
  window.removeEventListener('pointerdown', onPointerDown, true)
  window.removeEventListener('keydown', onKeydown)
})
function pick(row: MenuRow) {
  open.value = false
  // 关掉之后要把焦点还给齿轮本身，键盘用户才能接着 Esc/回车（上游的 popup 关闭时也把焦点还回触发组件）。
  void nextTick(() => document.querySelector<HTMLElement>('.tool-gear > button')?.focus())
  emit('pick', row)
}
</script>

<template>
  <span v-if="rows.length" class="tool-gear">
    <button type="button" class="icon-button" :aria-expanded="open" :aria-label="label ?? '工具窗口选项'"
            :title="label ?? '工具窗口选项'" @click.stop="toggle($event)"><MoreVertical :size="iconSize.control" /></button>
  </span>
  <Teleport v-if="open" to="body">
    <div class="tool-menu tool-gear-menu" role="menu" :aria-label="label ?? '工具窗口选项'"
         :style="{ left: `${at.left}px`, bottom: `${at.bottom}px` }" @contextmenu.prevent>
      <ToolWindowGearRows :rows="rows" @pick="pick" />
    </div>
  </Teleport>
</template>

<style scoped>
.tool-gear { display: inline-flex; position: relative; }
</style>
