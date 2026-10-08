<script setup lang="ts">
import { nextTick, ref, watch } from 'vue'
import { TriangleAlert } from 'lucide-vue-next'
import { iconSize } from '../uiIcons'

const props = defineProps<{ open: boolean }>()
const emit = defineEmits<{ resolve: [remove: boolean] }>()
const removeButton = ref<HTMLButtonElement>()
const cancelButton = ref<HTMLButtonElement>()

watch(() => props.open, async open => {
  if (!open) return
  await nextTick()
  cancelButton.value?.focus()
}, { flush: 'post' })

function onKeydown(event: KeyboardEvent) {
  if (event.key === 'Escape') {
    event.preventDefault()
    emit('resolve', false)
    return
  }
  if (event.key !== 'Tab') return
  if (event.shiftKey && document.activeElement === removeButton.value) {
    event.preventDefault()
    cancelButton.value?.focus()
  } else if (!event.shiftKey && document.activeElement === cancelButton.value) {
    event.preventDefault()
    removeButton.value?.focus()
  }
}
</script>

<template>
  <Teleport to="body">
    <div v-if="props.open" class="modal-backdrop">
      <section class="help-dialog fold-overlap-dialog" role="alertdialog" aria-modal="true" aria-labelledby="fold-overlap-title" aria-describedby="fold-overlap-text" @keydown.stop="onKeydown">
        <h2 id="fold-overlap-title" class="fold-overlap-title"><TriangleAlert :size="iconSize.action" aria-hidden="true" />折叠选区</h2>
        <p id="fold-overlap-text">存在重叠的折叠区域</p>
        <div class="fold-overlap-actions">
          <button ref="removeButton" type="button" class="primary-button" @click="emit('resolve', true)">移除</button>
          <button ref="cancelButton" type="button" class="subtle-button" @click="emit('resolve', false)">取消</button>
        </div>
      </section>
    </div>
  </Teleport>
</template>

<style scoped>
.fold-overlap-dialog { width: 420px; }
.fold-overlap-title { display: flex; align-items: center; gap: var(--space-2); }
.fold-overlap-dialog p { margin: var(--space-3) 0 0; color: var(--text); }
.fold-overlap-actions { display: flex; justify-content: flex-end; gap: var(--space-2); margin-top: var(--space-5); }
</style>
