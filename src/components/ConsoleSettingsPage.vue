<script setup lang="ts">
// 「编辑器 › 控制台」页 —— 上游 `ConsoleConfigurable`（`ConsoleConfigurable.java:43-73`：
// 「要折叠的行」+「不折叠的例外」两个列表），注册证据 intellij.platform.lang.impl.xml:983
// `<applicationConfigurable parentId="preferences.editor" id="Console">`。
// 从 `SettingsDialog.vue` 拆出来（宿主贴着机检上限）：折叠规则本身在 `src/consoleFold.ts`，
// 消费者是运行输出（`src/runIssues.ts`）。`settings` 是对话框那份**同一个** general 草稿对象，
// 保存仍由对话框的「应用」统一做。
import type { GeneralSettingsState } from '../settingsModel'

const props = defineProps<{ settings: GeneralSettingsState; busy?: boolean }>()

const foldText = (lines?: string[]) => (lines ?? []).join('\n')
function setFoldLines(key: 'foldConsoleLines' | 'foldExceptions', value: string) {
  props.settings[key] = value.split('\n').map(line => line.trim()).filter(Boolean)
}
</script>

<template>
  <h3>编辑器 › 控制台</h3>
  <!-- IDEA ConsoleConfigurable（`Console`，ConsoleConfigurable.java:43-73）：两个折叠列表。 -->
  <fieldset class="settings-fields" :disabled="busy">
    <label class="field-row field-row-block"><span>折叠行</span><textarea :value="foldText(settings.foldConsoleLines)" rows="3" aria-label="要折叠的控制台行" placeholder="每行一条：匹配到该子串的重复行会被折叠" @input="setFoldLines('foldConsoleLines', ($event.target as HTMLTextAreaElement).value)" /></label>
    <label class="field-row field-row-block"><span>例外</span><textarea :value="foldText(settings.foldExceptions)" rows="3" aria-label="不折叠的例外" placeholder="每行一条：命中例外的行永不折叠" @input="setFoldLines('foldExceptions', ($event.target as HTMLTextAreaElement).value)" /></label>
    <h4>Java 堆栈跟踪</h4>
    <div class="stack-fold-row">
      <label class="stack-fold-toggle"><input v-model="settings.foldJavaStackTrace" type="checkbox" /><span>折叠超过</span></label>
      <input v-model.number="settings.foldJavaStackTraceGreaterThan" type="number" min="0" max="2147483647" step="1" :disabled="busy || !settings.foldJavaStackTrace" aria-label="折叠超过的行数" />
      <span>行的堆栈跟踪</span>
    </div>
  </fieldset>
</template>

<style scoped>
.settings-fields h4 { margin: var(--space-2) 0 0; color: var(--text); font-size: 12px; font-weight: 600; }
.stack-fold-row { display: flex; align-items: center; flex-wrap: wrap; gap: var(--space-2); min-height: var(--ctrl-height); color: var(--text); font-size: 12px; }
.stack-fold-toggle { display: inline-flex; align-items: center; gap: var(--space-2); cursor: pointer; }
.stack-fold-toggle input[type="checkbox"] { flex-shrink: 0; width: var(--icon-size-checkbox); height: var(--icon-size-checkbox); margin: 0; accent-color: var(--accent); }
.stack-fold-row > input[type="number"] { width: 88px; min-width: 0; min-height: var(--ctrl-height); padding: var(--space-1) var(--space-2); border: 1px solid var(--line-strong); border-radius: var(--radius-xs); background: var(--editor); color: var(--text); font: inherit; }
.stack-fold-row > input[type="number"]:disabled { opacity: .55; }
.stack-fold-row > input[type="number"]:focus-visible { outline: var(--focus-ring); outline-offset: var(--focus-ring-offset); }
</style>
