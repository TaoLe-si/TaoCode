<script setup lang="ts">
import type { UpdateMethodId, UpdateOptionsDialogModel } from '../vcsUpdateOptions.ts'

defineProps<{
  model: UpdateOptionsDialogModel
  trapFocus?: (event: KeyboardEvent) => void
}>()

const emit = defineEmits<{
  method: [method: UpdateMethodId]
  showDialog: [showDialog: boolean]
  accept: []
  cancel: []
}>()
</script>

<template>
  <div class="modal-backdrop" @click.self="emit('cancel')">
    <section class="help-dialog git-update-options-dialog" role="dialog" aria-modal="true"
             aria-labelledby="git-update-options-title" @keydown="trapFocus" @keydown.esc.prevent.stop="emit('cancel')">
      <h2 id="git-update-options-title">{{ model.title }}</h2>
      <div class="git-update-options-rows" role="radiogroup" :aria-label="model.tabs[0]?.title">
        <label v-for="row in model.tabs[0]?.rows ?? []" :key="row.id" class="git-update-option-row">
          <input type="radio" name="git-update-method" :checked="row.checked" :value="row.id" @change="emit('method', row.id)" />
          <span>{{ row.title }}</span>
        </label>
      </div>
      <label class="git-update-options-again">
        <input type="checkbox" :checked="model.doNotShowAgain.checked"
               @change="emit('showDialog', !(($event.target as HTMLInputElement).checked))" />
        <span>{{ model.doNotShowAgain.title }}</span>
      </label>
      <div class="dialog-actions">
        <button class="primary-button" @click="emit('accept')">确定</button>
        <button class="subtle-button" @click="emit('cancel')">取消</button>
      </div>
    </section>
  </div>
</template>

<style scoped>
.git-update-options-dialog { width: min(520px, 96vw); }
.git-update-options-rows { display: flex; flex-direction: column; gap: var(--space-1); }
.git-update-option-row { display: flex; align-items: flex-start; gap: var(--space-2); padding: var(--space-2); border-radius: var(--radius-xs); color: var(--text); font-size: 12px; transition: background-color var(--dur-1) var(--ease); }
.git-update-option-row:hover { background: var(--hover); }
.git-update-option-row input, .git-update-options-again input { margin: 2px 0 0; width: var(--icon-size-checkbox); height: var(--icon-size-checkbox); accent-color: var(--accent); }
.git-update-options-again { display: flex; align-items: flex-start; gap: var(--space-2); margin-top: var(--space-3); color: var(--secondary); font-size: 12px; }
</style>
