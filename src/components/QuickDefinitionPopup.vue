<script setup lang="ts">
// 「快速定义」弹层（IDEA `ShowImplementationsAction` 那个 ImplementationViewComponent 的弹层形态）。
//
// 只负责渲染：标题、源码正文（目标行高亮）、Esc/点外面关闭。摘录与解析都在
// `src/quickDefinition.ts`（纯函数，可测）。正文按行渲染 + 目标行整行底色，与 IDEA
// 那个只读编辑器"把目标元素的范围标出来"是同一层意思（这里不假装有语法高亮）。
import { computed, nextTick, onMounted, onUnmounted, ref } from 'vue'
import { excerptAt, type QuickDefinitionSource } from '../quickDefinition'
import { useBestPositionAnchor } from '../popupPlacement'

const props = defineProps<{ source: QuickDefinitionSource; x?: number; y?: number }>()
const emit = defineEmits<{ (event: 'close'): void }>()

const box = ref<HTMLElement>()
const excerpt = computed(() => excerptAt(props.source.content, props.source.line))
// `showInBestPositionFor(editor)`（`AbstractPopup.java:974-993`）：有光标钉在光标处，
// 没有坐标就按实测尺寸居中；越界夹取与翻转都在 src/popupPlacement.ts（不再按常数猜高度）。
const { style: anchor } = useBestPositionAnchor(box, () =>
  props.x === undefined || props.y === undefined ? null : { x: props.x, y: props.y })
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
