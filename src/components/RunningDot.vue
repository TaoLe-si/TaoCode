<script setup lang="ts">
// "正在跑"的记号。以前两处各写了一个 `●` **文本字形**（App.vue 的运行标签页、RunConsole.vue
// 的实例标签），在 10px 字体里渲染出来是个直径约 3px 的小黑点 —— 大小由**字体**决定而不是
// 由设计决定：换字体就变、放大 DPI 就糊，而且它和旁边的数字同色（var(--secondary)），
// 读起来就是"又一个数字"。改成 lucide `Circle` 填色 + 强调色，两个问题一起解决。
//
// 为什么不转起来：转圈是"不知道要转多久"的信号（状态栏的 .status-spin 已经承担了），
// 而"进程在跑"是**确定**状态，一个静态的强调色圆点更准确，也不需要额外的动效降级处理
// （省电模式下 infinite 动画要单独给静态替身，见 src/style.css 的 data-motion='reduced'）。
import { Circle } from 'lucide-vue-next'
import { iconSize } from '../uiIcons'
</script>

<template>
  <Circle class="running-dot" :size="iconSize.chip" :stroke-width="0" fill="currentColor" aria-hidden="true" />
</template>

<style scoped>
/* 尺寸已经在 svg 上给了；这里只保证它在行内是个**居中的方块**而不是按基线排的图，
   否则 10px 的圆会沉到 12px 文字的下面去（和 TestRunnerPanel 的 .testrun-outcome 同理）。 */
.running-dot { flex-shrink: 0; color: var(--accent); }
</style>