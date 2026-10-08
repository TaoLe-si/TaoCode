<script setup lang="ts">
import { computed, ref, watch } from 'vue'
const props = defineProps<{ storageKey: string; vertical?: boolean; secondVisible?: boolean }>()
const container = ref<HTMLElement>()
const ratio = ref(0.7)
const visible = computed(() => props.secondVisible !== false)
function clamp(value: number) { return Math.max(0.15, Math.min(0.85, value)) }
watch(() => props.storageKey, key => {
  ratio.value = 0.7
  try {
    const saved = localStorage.getItem(key)
    if (saved !== null && Number.isFinite(Number(saved))) ratio.value = clamp(Number(saved))
  } catch { /* Layout remains usable when storage is unavailable. */ }
}, { immediate: true })
function save() {
  try { localStorage.setItem(props.storageKey, String(ratio.value)) } catch { /* Session-only layout. */ }
}
let dragging: number | null = null
function start(event: PointerEvent) {
  if (event.button !== 0) return
  dragging = event.pointerId
  ;(event.currentTarget as HTMLElement).setPointerCapture(event.pointerId)
  event.preventDefault()
}
function move(event: PointerEvent) {
  if (dragging !== event.pointerId) return
  const bounds = container.value?.getBoundingClientRect()
  if (!bounds) return
  const size = props.vertical ? bounds.height : bounds.width
  if (size) ratio.value = clamp((props.vertical ? event.clientY - bounds.top : event.clientX - bounds.left) / size)
}
function stop() { if (dragging !== null) { dragging = null; save() } }
function keys(event: KeyboardEvent) {
  const negative = props.vertical ? 'ArrowUp' : 'ArrowLeft'
  const positive = props.vertical ? 'ArrowDown' : 'ArrowRight'
  if (event.key !== negative && event.key !== positive) return
  event.preventDefault()
  ratio.value = clamp(ratio.value + (event.key === negative ? -0.02 : 0.02))
  save()
}
</script>
<template>
  <div ref="container" class="split" :class="{ vertical }">
    <div class="pane first" :style="{ flex: visible ? `0 0 calc(${ratio * 100}% - 0.5px)` : '1' }"><slot name="first" /></div>
    <div v-if="visible" class="divider" role="separator" tabindex="0" :aria-label="vertical ? '调整变更与详情高度' : '调整日志与变更宽度'"
      :aria-orientation="vertical ? 'horizontal' : 'vertical'" :aria-valuenow="Math.round(ratio * 100)" :aria-valuemin="15" :aria-valuemax="85"
      @pointerdown="start" @pointermove="move" @pointerup="stop" @pointercancel="stop" @lostpointercapture="stop" @keydown="keys" />
    <div v-if="visible" class="pane second"><slot name="second" /></div>
  </div>
</template>
<style scoped>
.split { display: flex; flex: 1; min-width: 0; min-height: 0; overflow: hidden; }
.split.vertical { flex-direction: column; }
.pane { display: flex; flex-direction: column; min-width: 0; min-height: 0; overflow: hidden; }
.second { flex: 1; }
.divider { flex: 0 0 1px; position: relative; z-index: 1; background: var(--line); cursor: col-resize; touch-action: none; }
.divider::after { content: ''; position: absolute; inset: 0 -3px; }
.vertical > .divider { cursor: row-resize; }
.vertical > .divider::after { inset: -3px 0; }
.divider:focus-visible { outline: var(--focus-ring); outline-offset: var(--focus-ring-offset-inset); }
</style>
