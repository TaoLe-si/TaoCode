<script setup lang="ts">
// 底部 dock 标签的「移动到…」菜单。三条与 ToolWindowHeader 里那三条同源：
// UIBundle `tool.window.move.to.action.group.name` 给出 Left / Right / Bottom 三个方向
// （`ToolWindowManagerImpl.moveToolWindow` 同样只接受这三个锚点）。
// 存在的理由：窗口沉到底部后左栏不再渲染它的标题栏，标题栏上那个菜单就够不着了 ——
// 没有这个入口，「移动到底部」是单向的。
import { onMounted, onUnmounted } from 'vue'
import { PanelBottom, PanelLeft, PanelRight } from 'lucide-vue-next'

const props = defineProps<{ anchor: string; x: number; y: number }>()
const emit = defineEmits<{ (event: 'move', side: 'left' | 'right' | 'bottom'): void; (event: 'close'): void }>()

const sides = [
  { side: 'left' as const, label: '移动到左侧', icon: PanelLeft },
  { side: 'right' as const, label: '移动到右侧', icon: PanelRight },
  { side: 'bottom' as const, label: '移动到底部', icon: PanelBottom },
]
// 点外面 / Esc 都要收起来（DOM 菜单不会像 Swing 那样自带自动隐藏）。
function onPointerDown(event: PointerEvent) { if (!(event.target as Element).closest('.tool-anchor-menu')) emit('close') }
function onKeydown(event: KeyboardEvent) { if (event.key === 'Escape') emit('close') }
onMounted(() => {
  window.addEventListener('pointerdown', onPointerDown, true)
  window.addEventListener('keydown', onKeydown)
})
onUnmounted(() => {
  window.removeEventListener('pointerdown', onPointerDown, true)
  window.removeEventListener('keydown', onKeydown)
})
</script>

<template>
  <div class="tool-menu tool-anchor-menu" role="menu" aria-label="移动到" :style="{ left: `${x}px`, top: `${y}px` }" @contextmenu.prevent>
    <button v-for="item in sides" :key="item.side" type="button" class="menu-button tool-menu-item" role="menuitem"
            :disabled="anchor === item.side" @click="emit('move', item.side)">
      <component :is="item.icon" :size="13" aria-hidden="true" />{{ item.label }}
    </button>
  </div>
</template>
