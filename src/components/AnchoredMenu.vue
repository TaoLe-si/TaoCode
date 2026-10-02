<script setup lang="ts">
// 会把 `left/top` 交给 `usePopupAnchor` 按实测尺寸夹取的菜单外壳（口径见 `src/popupAnchor.ts`）。
//
// 存在的理由：项目树右键与标签页右键原先各自写了一遍 `Math.min(x, viewport.width - 216)` 这种
// **按行数猜高度**的夹取 —— 216/330/210/260 四个魔数就是那两处的行数与行高乘出来的估算。
// 行数一变（子菜单、按文件分组、上下文动作那条链）估算就不准，编辑器的测量值更直接：
// 11 行的编辑器菜单高 419px，从光标铺到窗口下沿以外，最后几行落进下边栏底下。
//
// 用法与 `.tree-menu` 完全一致（同样的 class、同样的点击外面/Esc 由外层 backdrop 负责），
// 所以模板里只是把开闭标签换了 —— App.vue 一行没多（上限卡死在 2737）。
import { ref } from 'vue'
import { usePopupAnchor } from '../popupAnchor'

const props = defineProps<{ x: number; y: number }>()
const box = ref<HTMLElement>()
const { style } = usePopupAnchor(box, () => ({ x: props.x, y: props.y }))
</script>

<template>
  <div ref="box" class="tree-menu" :style="style"><slot /></div>
</template>