<script setup lang="ts">
// 「快速定义」弹层（IDEA `ShowImplementationsAction` 那个 ImplementationViewComponent 的弹层形态）。
//
// 只负责渲染：标题、源码正文（目标行高亮）、Esc/点外面关闭。摘录与解析都在
// `src/quickDefinition.ts`（纯函数，可测）。正文按行渲染 + 目标行整行底色，与 IDEA
// 那个只读编辑器"把目标元素的范围标出来"是同一层意思（这里不假装有语法高亮）。
import { computed, nextTick, onMounted, onUnmounted, ref } from 'vue'
import { excerptAt, type QuickDefinitionSource } from '../quickDefinition'

const props = defineProps<{ source: QuickDefinitionSource; x?: number; y?: number }>()
const emit = defineEmits<{ (event: 'close'): void }>()

const box = ref<HTMLElement>()
const excerpt = computed(() => excerptAt(props.source.content, props.source.line))
const WIDTH = 560
const MAX_HEIGHT = 320
const anchor = computed(() => {
  const innerWidth = typeof window === 'undefined' ? 1280 : window.innerWidth
  const innerHeight = typeof window === 'undefined' ? 800 : window.innerHeight
  if (props.x === undefined || props.y === undefined) return { left: `${Math.round((innerWidth - WIDTH) / 2)}px`, top: '96px' }
  return {
    left: `${Math.max(4, Math.min(props.x, innerWidth - WIDTH - 8))}px`,
    top: `${Math.max(4, Math.min(props.y, innerHeight - MAX_HEIGHT - 24))}px`,
  }
})
function onKeydown(event: KeyboardEvent) {
  if (event.key === 'Escape') { event.preventDefault(); emit('close') }
}
function onPointerDown(event: PointerEvent) { if (!box.value?.contains(event.target as Node)) emit('close') }
onMounted(() => {
  window.addEventListener('pointerdown', onPointerDown, true)
  void nextTick(() => box.value?.focus())
})
onUnmounted(() => window.removeEventListener('pointerdown', onPointerDown, true))
</script>

<template>
  <div ref="box" class="quick-definition" role="dialog" aria-label="快速定义" tabindex="-1" :style="anchor" @keydown.stop="onKeydown">
    <p class="quick-definition-title"><span>{{ source.title }}</span><span class="quick-definition-path" :title="source.path">{{ source.path }}</span></p>
    <pre class="quick-definition-code"><code><span v-for="(line, index) in excerpt.lines" :key="index" class="quick-definition-line" :class="{ 'is-target': index === excerpt.target }"><span class="quick-definition-number">{{ excerpt.from + index + 1 }}</span>{{ line }}
</span></code></pre>
  </div>
</template>
