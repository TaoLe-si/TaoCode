<script setup lang="ts">
// 速度搜索的**搜索框**（IDEA `SpeedSearchBase` 里那条浮在列表上的小输入框）。
// 只做展示与回抛：开关、查询串、按键都归宿主（`src/components/FileTree.vue`），
// 这样"长什么样"能单独真渲染出来核（含上游那个空提示），不必猜组件内部状态。
import { SPEED_SEARCH_HINT } from '../speedSearch'

defineProps<{ open: boolean; query: string }>()
defineEmits<{ input: [value: string]; keydown: [event: KeyboardEvent] }>()
</script>

<template>
  <div v-if="open" class="speed-search">
    <input
      class="speed-search-input" :value="query" :placeholder="SPEED_SEARCH_HINT" :aria-label="SPEED_SEARCH_HINT"
      spellcheck="false" @input="$emit('input', ($event.target as HTMLInputElement).value)"
      @keydown="$emit('keydown', $event)"
    />
  </div>
</template>

<style scoped>
.speed-search { padding: var(--space-1) var(--space-2); border-bottom: 1px solid var(--line); background: var(--panel); }
.speed-search-input { width: 100%; min-height: 22px; padding: 2px var(--space-2); color: var(--text); background: var(--editor); border: 1px solid var(--line-strong); border-radius: var(--radius-sm); font-size: 11px; }
</style>
