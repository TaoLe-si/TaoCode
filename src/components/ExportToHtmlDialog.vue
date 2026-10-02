<script setup lang="ts">
// 「导出到 HTML」对话框 —— IDEA `ExportToHTMLDialog.kt` 的对应物。
//
// 逐条对照（`platform/lang-impl/src/com/intellij/codeEditor/printing/ExportToHTMLDialog.kt`）：
//   · `:53-73` 三个范围单选：当前文件（带文件名）/ 选中文本 / 当前目录（带目录名），
//     后者的下一行缩进一个「包含子目录」复选框，且 `:68` `.enabledIf(rbCurrentPackage.selected)`；
//   · `:75-83` 输出目录（带「浏览…」）；
//   · `:85-102` 「选项」组：显示行号 + `OPEN_IN_BROWSER` 复选框（中间那批 `PrintOption` 扩展点本仓没有）；
//   · `:117-134` `reset()`：选中文本那一档要看编辑器**有没有选区**才可用、当前文件要看有没有打开文件、
//     当前目录要看有没有目录 —— 三者都不可用时由调用方决定不打开对话框；
//   · `:135-156` `apply()`：把选择写回 `ExportToHTMLSettings`（TaoCode 由调用方 `exportToHtml(draft)` 落盘）。
//
// 本组件**不发请求**：选择只是一份 draft，点「保存」时交给 `src/htmlExport.ts` 的引擎。
import { computed, ref, watch } from 'vue'
import { FolderOpen, X } from 'lucide-vue-next'
import { EXPORT_SCOPES, type ExportScope, type ExportToHtmlDraft } from '../htmlExport.ts'
import { iconSize } from '../uiIcons'

const props = defineProps<{
  /** 初始选择（来自项目设置 `exportToHtml`，对应 `reset()`）。 */
  settings: { scope: ExportScope; includeSubdirectories: boolean; printLineNumbers: boolean; openInBrowser: boolean; outputDirectory: string }
  /** 当前文件的**显示名**（`export.to.html.file.name.radio` 里的那个名字）；空 = 没有打开文件。 */
  fileName: string
  /** 当前文件所在目录（`export.to.html.all.files.in.directory.radio` 里的那个名字）；空 = 没有目录。 */
  directoryName: string
  /** 当前编辑器有没有选区（`:84` `isSelectedTextEnabled`）。 */
  selectionAvailable: boolean
  /** 宿主选完目录后回填的路径（`FileChooserFactory.createFileTextField` 的那个文本框）。 */
  pickedDirectory?: string
  busy: boolean
}>()
const emit = defineEmits<{
  save: [draft: ExportToHtmlDraft]
  browse: [initial: string]
  close: []
}>()

function initialScope(): ExportScope {
  // `reset()` 的优先级：先"选中文本"（若可用），再"当前文件"，最后"当前目录"。
  if (props.settings.scope === EXPORT_SCOPES.selectedText && props.selectionAvailable) return EXPORT_SCOPES.selectedText
  if (props.settings.scope === EXPORT_SCOPES.file && props.fileName) return EXPORT_SCOPES.file
  if (props.settings.scope === EXPORT_SCOPES.directory && props.directoryName) return EXPORT_SCOPES.directory
  if (props.selectionAvailable) return EXPORT_SCOPES.selectedText
  if (props.fileName) return EXPORT_SCOPES.file
  return props.directoryName ? EXPORT_SCOPES.directory : EXPORT_SCOPES.none
}

const scope = ref<ExportScope>(initialScope())
const includeSubdirectories = ref(props.settings.includeSubdirectories)
const printLineNumbers = ref(props.settings.printLineNumbers)
const openInBrowser = ref(props.settings.openInBrowser)
const outputDirectory = ref(props.settings.outputDirectory)
// 宿主的「浏览…」选完目录后把结果回填进文本框（IDEA 里那个文本框自己带选择器，TaoCode 拆成一步）。
watch(() => props.pickedDirectory, value => { if (value) outputDirectory.value = value })

// 设置或上下文变了就按 `reset()` 的规则重算（对话框可能被打开多次）。
watch(() => [props.settings, props.fileName, props.directoryName, props.selectionAvailable], () => {
  scope.value = initialScope()
  includeSubdirectories.value = props.settings.includeSubdirectories
  printLineNumbers.value = props.settings.printLineNumbers
  openInBrowser.value = props.settings.openInBrowser
  outputDirectory.value = props.settings.outputDirectory
}, { deep: true })

const canSave = computed(() => scope.value !== EXPORT_SCOPES.none && outputDirectory.value.trim().length > 0)
function submit() {
  if (!canSave.value) return
  emit('save', {
    scope: scope.value,
    // 「包含子目录」只在"当前目录"这一档有意义（`:68` 的 enabledIf 就是这条规则）。
    includeSubdirectories: scope.value === EXPORT_SCOPES.directory ? includeSubdirectories.value : false,
    printLineNumbers: printLineNumbers.value,
    openInBrowser: openInBrowser.value,
    outputDirectory: outputDirectory.value.trim(),
  })
}
</script>

<template>
  <div class="modal-backdrop" @click.self="emit('close')">
    <section class="command-palette export-html-dialog" role="dialog" aria-modal="true" aria-label="导出到 HTML">
      <div class="palette-input">
        <span class="export-heading">导出到 HTML</span>
        <button class="icon-button" title="关闭" aria-label="关闭" @click="emit('close')"><X :size="iconSize.action" /></button>
      </div>
      <div class="export-body">
        <div class="export-scopes" role="radiogroup" aria-label="导出范围">
          <label class="checkbox-row"><input v-model="scope" type="radio" :value="EXPORT_SCOPES.file" :disabled="!fileName" /><span>当前文件（{{ fileName || '未打开文件' }}）</span></label>
          <label class="checkbox-row"><input v-model="scope" type="radio" :value="EXPORT_SCOPES.selectedText" :disabled="!selectionAvailable" /><span>选中文本</span></label>
          <label class="checkbox-row"><input v-model="scope" type="radio" :value="EXPORT_SCOPES.directory" :disabled="!directoryName" /><span>当前目录（{{ directoryName || '无' }}）</span></label>
          <label class="checkbox-row export-indent"><input v-model="includeSubdirectories" type="checkbox" :disabled="scope !== EXPORT_SCOPES.directory" /><span>包含子目录</span></label>
        </div>

        <label class="field-row"><span>输出目录</span>
          <input :value="outputDirectory" :disabled="busy" placeholder="例如 D:\\export（绝对路径）" aria-label="输出目录" @input="outputDirectory = ($event.target as HTMLInputElement).value" />
        </label>
        <div class="export-row"><button class="subtle-button" :disabled="busy" @click="emit('browse', outputDirectory)"><FolderOpen :size="iconSize.menu" />浏览…</button></div>

        <h4 class="settings-group-title">选项</h4>
        <label class="checkbox-row"><input v-model="printLineNumbers" type="checkbox" /><span>显示行号</span></label>
        <label class="checkbox-row"><input v-model="openInBrowser" type="checkbox" /><span>在浏览器中打开生成的 HTML</span></label>
        <p class="field-hint">
          文件名 = 原名 + <code>.html</code>；目录范围会在每个目录下生成 <code>index.html</code>。
          语法高亮来自编辑器已渲染的内容，所以**没打开的**文件导出为纯文本 + 行号（结果提示里会说清数量）。
        </p>
      </div>
      <div class="export-actions">
        <button class="subtle-button" @click="emit('close')">取消</button>
        <button class="primary-button" :disabled="!canSave || busy" @click="submit">保存</button>
      </div>
    </section>
  </div>
</template>

<style scoped>
.export-html-dialog { width: 560px; }
.export-heading { flex: 1; color: var(--bright); font-weight: 500; }
.export-body { display: flex; flex-direction: column; gap: var(--space-1); padding: var(--space-3); }
.export-scopes { display: flex; flex-direction: column; }
.export-indent { padding-left: var(--space-5, 20px); }
.export-row { display: flex; }
.export-actions { display: flex; justify-content: flex-end; gap: var(--space-2); padding: var(--space-3); border-top: 1px solid var(--line); }
.export-actions .primary-button { min-width: 88px; }
</style>
