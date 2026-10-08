<script setup lang="ts">
import { computed, ref } from 'vue'
import { detectLineSeparator } from '../vcsFileUtil'
import AnchoredMenu from './AnchoredMenu.vue'

type Separator = 'crlf' | 'lf' | 'cr'

const props = defineProps<{ content: string; editable: boolean }>()
const emit = defineEmits<{ select: [separator: Separator] }>()
const open = ref(false)
const anchor = ref<HTMLButtonElement>()
const point = ref({ x: 0, y: 0 })
const separator = computed(() => {
  const value = detectLineSeparator(props.content)
  return value === '\r\n' ? 'crlf' : value === '\r' ? 'cr' : 'lf'
})
const label = computed(() => separator.value.toUpperCase())

function toggle() {
  if (!open.value) {
    const box = anchor.value?.getBoundingClientRect()
    if (box) point.value = { x: box.left, y: box.top }
  }
  open.value = !open.value
}

function select(value: Separator) {
  open.value = false
  emit('select', value)
}
</script>

<template>
  <button v-if="editable" ref="anchor" type="button" class="status-chip" :aria-label="`行分隔符 ${label}`" :aria-expanded="open" @click.stop="toggle">{{ label }}</button>
  <span v-else class="status-chip" :aria-label="`行分隔符 ${label}`">{{ label }}</span>
  <Teleport to="body">
    <div v-if="editable && open" class="tree-menu-backdrop" @click="open = false" @contextmenu.prevent="open = false" />
    <AnchoredMenu v-if="editable && open" :x="point.x" :y="point.y" role="menu" aria-label="行分隔符" @keydown.esc.stop="open = false">
      <button type="button" class="menu-button" role="menuitem" @click="select('crlf')"><span class="menu-item-icon" />Windows (CRLF)</button>
      <button type="button" class="menu-button" role="menuitem" @click="select('lf')"><span class="menu-item-icon" />Unix and macOS (LF)</button>
      <button type="button" class="menu-button" role="menuitem" @click="select('cr')"><span class="menu-item-icon" />Classic Mac OS (CR)</button>
    </AnchoredMenu>
  </Teleport>
</template>
