<script setup lang="ts">
// 「编辑描述」对话框（上游 `EditBookmarkAction` 里的 `Messages.showInputDialog`）。
//
// 上游：`EditBookmarkAction.process:26-40` —— 取当前描述（`group.getDescription`，没有自定义
// 描述时就是自动算出来的那一行原文）预填，用户改完 `group.setDescription(bookmark, it)`；
// 标题/提示取中文包 `action.bookmark.edit.description.dialog.title` = 「书签描述」、
// `.message` = 「输入简短的书签描述」。入口是书签图标的**中键**
// （`GutterLineBookmarkRenderer.getMiddleButtonClickAction:50`）与右键菜单里的那一行。
import { ref, watch } from 'vue'

const props = defineProps<{
  target: { path: string; line?: number; current: string }
  trapFocus: (event: KeyboardEvent) => void
}>()
const emit = defineEmits<{ save: [value: string]; close: [] }>()

const value = ref('')
watch(() => props.target, target => { value.value = target.current }, { immediate: true })
</script>

<template>
  <div class="modal-backdrop" @click.self="emit('close')">
    <section class="help-dialog rename-dialog bookmark-description-dialog" role="dialog" aria-modal="true" aria-label="书签描述" @keydown="trapFocus">
      <h2>书签描述</h2>
      <p class="rename-target">{{ target.path }}<template v-if="target.line !== undefined"> · 第 {{ target.line }} 行</template></p>
      <input v-model="value" class="rename-input" aria-label="书签描述" placeholder="输入简短的书签描述" spellcheck="false" @keydown.enter.prevent="emit('save', value)" />
      <p class="rename-note">清空后这条书签回到「没有自定义描述」：行书签仍显示那一行的原文。</p>
      <div class="dialog-actions">
        <button class="subtle-button" @click="emit('close')">取消</button>
        <button class="primary-button" @click="emit('save', value)">确定</button>
      </div>
    </section>
  </div>
</template>
