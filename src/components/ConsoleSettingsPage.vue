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
  <p class="section-description">对应 IDEA Settings › Editor › Console（注册证据 intellij.platform.lang.impl.xml:983 <code>&lt;applicationConfigurable parentId="preferences.editor" id="Console"&gt;</code>）。</p>
  <!-- IDEA ConsoleConfigurable（`Console`，ConsoleConfigurable.java:43-73）：两个折叠列表。 -->
  <fieldset class="settings-fields" :disabled="busy">
    <label class="field-row field-row-block"><span>折叠行</span><textarea :value="foldText(settings.foldConsoleLines)" rows="3" aria-label="要折叠的控制台行" placeholder="每行一条：匹配到该子串的重复行会被折叠" @input="setFoldLines('foldConsoleLines', ($event.target as HTMLTextAreaElement).value)" /></label>
    <label class="field-row field-row-block"><span>例外</span><textarea :value="foldText(settings.foldExceptions)" rows="3" aria-label="不折叠的例外" placeholder="每行一条：命中例外的行永不折叠" @input="setFoldLines('foldExceptions', ($event.target as HTMLTextAreaElement).value)" /></label>
    <p class="field-hint">对应 IDEA 的 `Console` 设置（控制台行折叠）：输出/终端里连续重复且命中「折叠行」的行会合并成一条并显示次数；命中「例外」的行保持原样。</p>
  </fieldset>
</template>
