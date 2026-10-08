<script setup lang="ts">
// 「导出测试结果」对话框 —— 上游 `ExportTestResultsDialog` / `ExportTestResultsForm` 的等价物
// （`platform/testRunner/src/com/intellij/execution/testframework/export/`）。
//
// 逐条对照：
//   · 格式单选（`ExportTestResultsForm.java:104-110` 的 XML / HTML 两个 radio；上游第三档
//     自定义 XSL 模板需要 XSLT 引擎，本仓没有，见 `src/testResultsExport.ts` 模块头）；
//   · 输出目录（`:114-120` 的 `myFolderField` + 浏览）；
//   · 文件名（`:122-128` 的 `myFileNameField`，初值 = `Test Results - {0}`）；
//   · 「打开导出文件」复选框（`:129-133`，文案随扩展名在浏览器/编辑器之间变，`:283-288`）；
//   · 校验四条（`:378-397`，规则在 `src/testResultsExport.ts` 的 `validateExportSettings`）。
//
// 本组件不发请求：选择只是一份 draft，点「保存」时交给 `src/components/TestRunnerPanel.vue`。
// XML 档写不进文件（宿主写盘通道只放行 .html/.htm/.txt，`native/export_file.hpp:29`），
// 所以那一档的出口是剪贴板 —— 对话框在 XML 档下把这一条写在提示里，不假装能落盘。
import { computed, ref, watch } from 'vue'
import { FolderOpen, X } from 'lucide-vue-next'
import {
  EXPORT_DIALOG_TITLE, OPEN_IN_BROWSER_TEXT, OPEN_IN_EDITOR_TEXT, applyFormatExtension,
  defaultTestResultsFileName, openExportedLabel, shouldOpenInBrowser, validateExportSettings,
  type TestResultsExportFormat, type TestResultsExportSettings,
} from '../testResultsExport.ts'
import { iconSize } from '../uiIcons'

const props = defineProps<{
  settings: TestResultsExportSettings
  /** 运行配置名（默认文件名 `Test Results - {0}` 的 {0}）。 */
  runName: string
  /** 宿主选完目录后回填（`dialog.pickDirectory`）。 */
  pickedDirectory?: string
  busy: boolean
}>()
const emit = defineEmits<{
  save: [draft: { format: TestResultsExportFormat; fileName: string; folder: string; openResults: boolean }]
  browse: [initial: string]
  close: []
}>()

const format = ref<TestResultsExportFormat>(props.settings.format)
const fileName = ref(applyFormatExtension(defaultTestResultsFileName(props.runName), props.settings.format))
const folder = ref(props.settings.outputFolder)
const openResults = ref(props.settings.openResultsInEditor)

watch(() => props.pickedDirectory, value => { if (value) folder.value = value })
// 换格式就把扩展名换掉（`ExportTestResultsForm.java:299-315` 的 `updateOnFormatChange`）。
watch(format, value => { fileName.value = applyFormatExtension(fileName.value, value) })
// 重新打开时按最新设置重置（对话框可能被打开多次）。
watch(() => props.settings, value => {
  format.value = value.format
  fileName.value = applyFormatExtension(defaultTestResultsFileName(props.runName), value.format)
  folder.value = value.outputFolder
  openResults.value = value.openResultsInEditor
}, { deep: true })

const openLabel = computed(() => (format.value === 'xml' ? OPEN_IN_EDITOR_TEXT : openExportedLabel(fileName.value)))
const problem = computed(() => validateExportSettings({ format: format.value, fileName: fileName.value, folder: folder.value }))
const canSave = computed(() => problem.value === null)
function submit() {
  if (!canSave.value) return
  emit('save', { format: format.value, fileName: fileName.value.trim(), folder: folder.value.trim(), openResults: openResults.value })
}
void shouldOpenInBrowser
</script>

<template>
  <div class="modal-backdrop" @click.self="emit('close')">
    <section class="command-palette test-results-export" role="dialog" aria-modal="true" :aria-label="EXPORT_DIALOG_TITLE">
      <div class="palette-input">
        <span class="tre-heading">{{ EXPORT_DIALOG_TITLE }}</span>
        <button class="icon-button" title="关闭" aria-label="关闭" @click="emit('close')"><X :size="iconSize.action" /></button>
      </div>
      <div class="tre-body">
        <h4 class="settings-group-title">导出格式</h4>
        <label class="checkbox-row"><input v-model="format" type="radio" value="html" /><span>HTML</span></label>
        <label class="checkbox-row"><input v-model="format" type="radio" value="xml" /><span>XML</span></label>
        <p v-if="format === 'xml'" class="field-hint">
          XML 档的出口是**剪贴板**：宿主写盘通道只放行 <code>.html</code>/<code>.htm</code>/<code>.txt</code>，
          <code>.xml</code> 会被拒（<code>native/export_file.hpp</code> 的白名单）。
        </p>

        <h4 class="settings-group-title">输出</h4>
        <label class="field-row"><span>文件名</span>
          <input :value="fileName" :disabled="busy" aria-label="导出文件名" @input="fileName = ($event.target as HTMLInputElement).value" />
        </label>
        <label class="field-row"><span>输出目录</span>
          <input :value="folder" :disabled="busy" placeholder="例如 D:\\export（绝对路径）" aria-label="输出目录" @input="folder = ($event.target as HTMLInputElement).value" />
        </label>
        <div class="tre-row"><button class="subtle-button" :disabled="busy" @click="emit('browse', folder)"><FolderOpen aria-hidden="true" :size="iconSize.menu" />浏览…</button></div>

        <label class="checkbox-row"><input v-model="openResults" type="checkbox" :disabled="format === 'xml'" /><span>{{ openLabel }}</span></label>
        <p v-if="problem" class="tre-problem">{{ problem }}</p>
      </div>
      <div class="tre-actions">
        <button class="primary-button" :disabled="!canSave || busy" @click="submit">保存</button>
        <button class="subtle-button" @click="emit('close')">取消</button>
      </div>
    </section>
  </div>
</template>

<style scoped>
.test-results-export { width: 560px; }
.tre-heading { flex: 1; color: var(--bright); font-weight: 500; }
.tre-body { display: flex; flex-direction: column; gap: var(--space-1); padding: var(--space-3); }
.tre-row { display: flex; }
.tre-problem { margin: 0; color: var(--error); font-size: 11px; }
.tre-actions { display: flex; justify-content: flex-end; gap: var(--space-2); padding: var(--space-3); border-top: 1px solid var(--line); }
.tre-actions .primary-button { min-width: 88px; }
</style>