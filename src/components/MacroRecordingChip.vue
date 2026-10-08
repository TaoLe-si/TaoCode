<script setup lang="ts">
import { ref, watch } from 'vue'
import { Circle, Square, X } from 'lucide-vue-next'
import { iconSize } from '../uiIcons'
import AnchoredMenu from './AnchoredMenu.vue'

const props = defineProps<{ recording: boolean; text: string; stop: () => void }>()
const open = ref(false)
const anchor = ref<HTMLButtonElement>()
const point = ref({ x: 0, y: 0 })
function show() {
  const box = anchor.value?.getBoundingClientRect()
  if (box) point.value = { x: box.left, y: box.top }
  open.value = !open.value
}
watch(() => props.recording, () => { open.value = false })
</script>

<template>
  <button v-if="recording" ref="anchor" class="status-chip macro-recording" title="正在录制宏" aria-label="正在录制宏" :aria-expanded="open" @click.stop="show"><Circle :size="iconSize.dense" fill="currentColor" />宏录制</button>
  <Teleport to="body">
    <div v-if="recording && open" class="tree-menu-backdrop" @click="open = false" @contextmenu.prevent="open = false" />
    <AnchoredMenu v-if="recording && open" :x="point.x" :y="point.y" role="dialog" aria-label="宏录制" @keydown.esc.stop="open = false">
      <div class="macro-recording-details"><span>{{ text || '宏录制已开始' }}</span><button class="icon-button" title="关闭宏录制提示" aria-label="关闭宏录制提示" @click="open = false"><X :size="iconSize.dense" /></button></div>
      <button class="menu-button" role="menuitem" @click="open = false; stop()"><span class="menu-item-icon"><Square aria-hidden="true" :size="iconSize.menu" /></span><span>停止宏录制</span></button>
    </AnchoredMenu>
  </Teleport>
</template>

<style scoped>
.macro-recording { color: var(--error); }
.macro-recording svg { animation: macro-recording-pulse var(--dur-spin) var(--ease-linear) infinite; }
.macro-recording-details { display: flex; align-items: center; gap: var(--space-2); padding: var(--space-2); max-width: 320px; overflow-wrap: anywhere; }
.macro-recording-details span { flex: 1; }
@keyframes macro-recording-pulse { 0%, 100% { opacity: 1; } 50% { opacity: .45; } }
@media (prefers-reduced-motion: reduce) { .macro-recording svg { animation: none; } }
</style>
