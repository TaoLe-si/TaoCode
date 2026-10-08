<!-- 「编辑器 › 代码折叠」页 —— 上游 `CodeFoldingConfigurable.kt:26-27`（id `editor.preferences.folding`，
     标题 `group.code.folding` = 「代码折叠」）+ `BaseCodeFoldingOptionsProvider.kt:17-21`（五条复选框）。
     从 `SettingsDialog.vue` 拆出来：宿主贴着机检上限（1381 行），而这一页的取舍需要写清楚 ——
     五个开关里只渲染 LSP 路径真会读的两条，理由见 `src/editorFoldingSettings.ts` 的模块注释。
     `settings` 是对话框那份**同一个** editor 设置对象：勾选直接改它的字段，保存仍由对话框的「应用」统一做
     （与对话框内联的那些行同语义）。 -->
<script setup lang="ts">
import { FOLD_BY_DEFAULT_GROUP, FOLDING_SETTING_ROWS } from '../editorFoldingSettings'
import type { EditorSettings } from '../settingsModel'

defineProps<{ settings: EditorSettings; busy?: boolean }>()
const emit = defineEmits<{ (e: 'reset'): void }>()
</script>

<template>
  <h3>编辑器 › 代码折叠</h3>
  <div class="editor-page-head">
    <button type="button" class="subtle-button" @click="emit('reset')">恢复默认</button>
  </div>
  <fieldset class="settings-fields" :disabled="busy">
    <p class="field-hint">{{ FOLD_BY_DEFAULT_GROUP }}</p>
    <label v-for="row in FOLDING_SETTING_ROWS" :key="row.key" class="checkbox-row">
      <input v-model="settings[row.key]" type="checkbox" /><span>{{ row.label }}</span>
    </label>
  </fieldset>
</template>
