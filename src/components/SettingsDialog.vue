<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, useId, watch } from 'vue'
import { languageFor } from '../templates'
import { Braces, FolderTree, Moon, Palette, SlidersHorizontal, Sun, X } from 'lucide-vue-next'
import TemplateSettingsPage from './TemplateSettingsPage.vue'
import ProjectStructurePane from './ProjectStructurePane.vue'
import type { EditorSettings, JavaProjectSettings, ProjectSettings, TemplateSettings, TodoPattern } from '../bridge'
import type { Theme } from '../appearance'

const props = defineProps<{
  settings: EditorSettings
  projectSettings: ProjectSettings | null
  projectRoot: string | null
  activePath: string
  theme: Theme
  busy: boolean
  error: string
  initialSection?: 'editor' | 'appearance' | null
}>()
const templateLanguage = computed(() => languageFor(props.activePath))
const emit = defineEmits<{
  save: [settings: EditorSettings]
  saveProject: [patch: { excludedDirs: string[]; todoPatterns: TodoPattern[] }]
  saveJava: [settings: JavaProjectSettings]
  saveTemplates: [settings: TemplateSettings]
  browseDirectory: [field: 'jdkHome' | 'outputPath']
  theme: [theme: Theme]
  close: []
}>()
const id = useId()
const dialog = ref<HTMLDialogElement>()
const editorForm = ref<HTMLFormElement>()
const editor = ref<EditorSettings>({ ...props.settings })
// Categories follow ProjectStructureConfigurable.initSidePanel(): the project subtree
// ("Project" -> here Project Structure) then platform entries. TaoCode has no
// Modules/Libraries/Facets/Artifacts backend, so those are absent rather than faked.
const sections = [
  { key: 'appearance', label: '外观', icon: Palette },
  { key: 'editor', label: '编辑器', icon: SlidersHorizontal },
  { key: 'structure', label: '项目结构', icon: FolderTree },
  { key: 'templates', label: '实时模板', icon: Braces },
] as const
const section = ref<(typeof sections)[number]['key']>(props.initialSection === 'editor' ? 'editor' : props.initialSection === 'appearance' ? 'appearance' : 'appearance')
const validEditor = computed(() => Number.isInteger(editor.value.fontSize)
  && editor.value.fontSize >= 10 && editor.value.fontSize <= 32 && [2, 4, 8].includes(editor.value.tabSize)
  && Number.isInteger(editor.value.tabLimit) && editor.value.tabLimit >= 1 && editor.value.tabLimit <= 100)
let previousFocus: HTMLElement | null = null

watch(() => props.settings, value => { editor.value = { ...value } }, { deep: true })
function saveEditor() {
  if (!props.busy && validEditor.value && editorForm.value?.reportValidity()) emit('save', { ...editor.value })
}
function close() {
  if (!props.busy) emit('close')
}
async function navigateTabs(event: KeyboardEvent) {
  const current = sections.findIndex(item => item.key === section.value)
  let index = current
  if (event.key === 'ArrowDown' || event.key === 'ArrowRight') index = (current + 1) % sections.length
  else if (event.key === 'ArrowUp' || event.key === 'ArrowLeft') index = (current + sections.length - 1) % sections.length
  else if (event.key === 'Home') index = 0
  else if (event.key === 'End') index = sections.length - 1
  else return
  event.preventDefault()
  section.value = sections[index]!.key
  await nextTick()
  document.getElementById(`${id}-tab-${section.value}`)?.focus()
}
function onKeydown(event: KeyboardEvent) {
  if (event.key !== 'Tab') return
  const controls = [...(dialog.value?.querySelectorAll<HTMLElement>('button, input, select, textarea, [tabindex]') ?? [])]
    .filter(element => !element.matches(':disabled') && element.tabIndex >= 0 && element.getClientRects().length > 0)
  const first = controls[0]
  const last = controls[controls.length - 1]
  if (!first) { event.preventDefault(); dialog.value?.focus(); return }
  if (!controls.includes(document.activeElement as HTMLElement)) {
    event.preventDefault()
    ;(event.shiftKey ? last : first)?.focus()
  } else if (event.shiftKey && document.activeElement === first) {
    event.preventDefault(); last?.focus()
  } else if (!event.shiftKey && document.activeElement === last) {
    event.preventDefault(); first.focus()
  }
}
watch(() => props.busy, async value => {
  if (!value) return
  await nextTick()
  if (!dialog.value?.contains(document.activeElement) || document.activeElement?.matches(':disabled')) dialog.value?.focus()
})
onMounted(() => {
  previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null
  dialog.value?.showModal()
  document.getElementById(`${id}-tab-appearance`)?.focus()
})
onBeforeUnmount(() => {
  dialog.value?.close()
  if (previousFocus?.isConnected) previousFocus.focus()
})
</script>

<template>
  <dialog
    ref="dialog" class="help-dialog settings-dialog" role="dialog" aria-modal="true" tabindex="-1"
    :aria-labelledby="`${id}-title`" @cancel.prevent="close" @keydown.stop="onKeydown"
  >
    <header class="dialog-header">
      <h2 :id="`${id}-title`" class="dialog-title">设置</h2>
      <button type="button" class="icon-button" :disabled="busy" :title="busy ? '正在保存，请稍候' : '关闭（Esc）'" aria-label="关闭设置" @click="close"><X :size="18" aria-hidden="true" /></button>
    </header>
    <div class="settings-layout">
      <nav class="settings-navigation" role="tablist" aria-label="设置分类" aria-orientation="vertical" @keydown="navigateTabs">
        <button
          v-for="item in sections" :id="`${id}-tab-${item.key}`" :key="item.key"
          type="button" class="menu-button settings-tab" role="tab" :aria-selected="section === item.key"
          :aria-controls="`${id}-panel-${item.key}`" :tabindex="section === item.key ? 0 : -1"
          @click="section = item.key"
        ><component :is="item.icon" :size="16" aria-hidden="true" /><span>{{ item.label }}</span></button>
      </nav>
      <div class="settings-content">
        <div v-if="error" class="notice error settings-error" role="alert"><span>{{ error }}</span></div>
        <section
          v-show="section === 'appearance'" :id="`${id}-panel-appearance`" class="settings-panel"
          role="tabpanel" :aria-labelledby="`${id}-tab-appearance`"
        >
          <h3>外观</h3>
          <p class="section-description">主题立即生效，不需要保存。</p>
          <div class="theme-options" role="group" aria-label="主题">
            <button type="button" class="subtle-button theme-option" :aria-pressed="theme === 'light'" @click="emit('theme', 'light')"><Sun :size="19" aria-hidden="true" /><span>亮色</span><span class="theme-state">{{ theme === 'light' ? '当前主题' : '切换到亮色' }}</span></button>
            <button type="button" class="subtle-button theme-option" :aria-pressed="theme === 'dark'" @click="emit('theme', 'dark')"><Moon :size="19" aria-hidden="true" /><span>暗色</span><span class="theme-state">{{ theme === 'dark' ? '当前主题' : '切换到暗色' }}</span></button>
          </div>
        </section>

        <form
          v-show="section === 'editor'" :id="`${id}-panel-editor`" ref="editorForm" class="settings-panel"
          role="tabpanel" :aria-labelledby="`${id}-tab-editor`" :aria-busy="busy" @submit.prevent="saveEditor"
        >
          <h3>编辑器</h3>
          <p class="section-description">这些设置应用于编辑器。修改后点击“保存编辑器设置”。</p>
          <fieldset class="settings-fields" :disabled="busy">
            <div class="input-row">
              <label :for="`${id}-font`">字体大小 <span class="field-hint">（像素）</span></label>
              <input :id="`${id}-font`" v-model.number="editor.fontSize" type="number" min="10" max="32" step="1" required :aria-describedby="`${id}-font-hint`" />
            </div>
            <p :id="`${id}-font-hint`" class="field-hint" :class="{ 'validation-error': !validEditor }">字体大小需为 10–32 之间的整数。</p>
            <div class="input-row">
              <label :for="`${id}-tab-size`">缩进宽度</label>
              <select :id="`${id}-tab-size`" v-model.number="editor.tabSize"><option :value="2">2 个空格</option><option :value="4">4 个空格</option><option :value="8">8 个空格</option></select>
            </div>
            <label class="checkbox-row"><input v-model="editor.wordWrap" type="checkbox" /><span>自动换行</span></label>
            <label class="checkbox-row"><input v-model="editor.lineNumbers" type="checkbox" /><span>显示行号</span></label>
            <label class="checkbox-row"><input v-model="editor.showIndentGuides" type="checkbox" /><span>显示缩进参考线</span></label>
            <p class="field-hint restore-hint">IDEA 风格的垂直引导线，帮助识别代码块层级。</p>
            <label class="checkbox-row"><input v-model="editor.bracketMatching" type="checkbox" /><span>括号匹配高亮</span></label>
            <p class="field-hint restore-hint">光标靠近括号时高亮对应的另一侧括号。</p>
            <div class="input-row">
              <label :for="`${id}-tab-limit`">每个编辑器组的标签页上限</label>
              <input :id="`${id}-tab-limit`" v-model.number="editor.tabLimit" type="number" min="1" max="100" step="1" required :aria-describedby="`${id}-tab-limit-hint`" />
            </div>
            <p :id="`${id}-tab-limit-hint`" class="field-hint" :class="{ 'validation-error': !validEditor }">超过上限时，IDEA 会先关闭未修改且最久未选中的标签页（默认 30，范围 1–100）。</p>
            <label class="checkbox-row"><input v-model="editor.restoreLastProject" type="checkbox" :aria-describedby="`${id}-restore-hint`" /><span>重启时恢复上次项目</span></label>
            <label class="checkbox-row"><input v-model="editor.autoSave" type="checkbox" :aria-describedby="`${id}-autosave-hint`" /><span>停止输入 5 秒后自动保存</span></label>
            <p :id="`${id}-autosave-hint`" class="field-hint restore-hint">只保存已经改动过的文件；切换项目或关闭窗口前仍会提示未保存内容。</p>
            <label class="checkbox-row"><input v-model="editor.syncOnFocus" type="checkbox" :aria-describedby="`${id}-sync-hint`" /><span>窗口获得焦点时同步磁盘文件</span></label>
            <p :id="`${id}-sync-hint`" class="field-hint restore-hint">刷新项目树并重载没有改动的编辑器缓冲；有未保存修改的文件不会被覆盖，保存时仍会提示冲突。超过 4 MiB 的文件跳过自动同步。</p>
            <p :id="`${id}-restore-hint`" class="field-hint restore-hint">仅恢复上次打开的项目；未保存的文本不会自动保存，也不会随项目恢复。退出前请手动保存文件。</p>
          </fieldset>
        </form>

        <section v-show="section === 'structure'" :id="`${id}-panel-structure`" class="settings-panel" role="tabpanel" :aria-labelledby="`${id}-tab-structure`" :aria-busy="busy">
          <ProjectStructurePane :settings="projectSettings" :root="projectRoot" :busy="busy" @save-java="emit('saveJava', $event)" @save-project="emit('saveProject', $event)" @browse="emit('browseDirectory', $event)" />
        </section>

        <section v-show="section === 'templates'" :id="`${id}-panel-templates`" class="settings-panel" role="tabpanel" :aria-labelledby="`${id}-tab-templates`">
          <h3>实时模板</h3>
          <p v-if="!projectSettings" class="section-description">尚未打开项目。模板开关与自定义模板随项目保存，请先打开一个项目。</p>
          <TemplateSettingsPage v-else :settings="projectSettings.templates" :language="templateLanguage" :busy="busy" @change="emit('saveTemplates', $event)" />
        </section>
      </div>
    </div>
    <footer class="dialog-footer">
      <span class="save-status" role="status">{{ busy ? '正在保存，请稍候…' : section === 'appearance' ? '主题即时生效' : section === 'templates' ? '模板改动即时保存到本项目' : section === 'structure' ? '项目结构改动需保存' : '修改后需保存' }}</span>
      <div class="footer-actions">
        <button type="button" class="subtle-button" :disabled="busy" @click="close">关闭</button>
        <button v-if="section === 'editor'" type="submit" :form="`${id}-panel-editor`" class="primary-button" :disabled="busy || !validEditor">{{ busy ? '正在保存…' : '保存编辑器设置' }}</button>
      </div>
    </footer>
  </dialog>
</template>

<style scoped>
.settings-dialog { position: fixed; inset: 0; width: 760px; height: 580px; max-width: calc(100vw - 32px); max-height: calc(100dvh - 32px); margin: auto; padding: 0; color: var(--text); }
.settings-dialog[open] { display: flex; flex-direction: column; }
.settings-dialog::backdrop { background: var(--backdrop); }
.settings-dialog:focus { outline: none; }
.dialog-header { display: flex; align-items: center; justify-content: space-between; gap: var(--space-3); flex-shrink: 0; padding: var(--space-4) var(--space-5); border-bottom: 1px solid var(--line); }
.settings-dialog .dialog-title { margin: 0; padding: 0; font: 600 17px/1.5 var(--font-ui); color: var(--bright); }
.settings-layout { display: grid; grid-template-columns: 155px minmax(0, 1fr); flex: 1; min-width: 0; min-height: 0; }
.settings-navigation { display: flex; flex-direction: column; gap: var(--space-1); min-height: 0; overflow: auto; padding: var(--space-3) var(--space-2); border-right: 1px solid var(--line); background: var(--panel); }
.settings-tab { display: flex; align-items: center; gap: var(--space-2); flex-shrink: 0; min-height: var(--ctrl-height-lg); padding: var(--space-1) var(--space-2); border: 0; background: transparent; color: var(--secondary); border-radius: var(--radius-sm); text-align: left; }
.settings-tab:hover { background: var(--hover); }
.settings-tab > svg { flex-shrink: 0; }
.settings-tab[aria-selected='true'] { color: var(--bright); background: var(--selected); font-weight: 600; }
.settings-content { min-width: 0; min-height: 0; overflow: auto; padding: var(--space-5); }
.settings-error { border: 1px solid var(--error); border-radius: var(--radius-xs); margin-bottom: var(--space-4); }
.settings-panel { min-width: 0; }
.settings-panel h3 { margin: 0 0 var(--space-2); font-size: 15px; color: var(--bright); font-weight: 600; }
.section-description { margin: 0 0 var(--space-5); color: var(--secondary); line-height: 1.8; overflow-wrap: anywhere; }
.theme-options { display: flex; flex-wrap: wrap; gap: var(--space-3); }
.theme-option { display: flex; flex: 1 1 135px; min-width: 0; align-items: center; flex-wrap: wrap; gap: var(--space-2); padding: var(--space-4); border: 1px solid var(--line-strong); border-radius: var(--radius-md); background: var(--editor); color: var(--secondary); }
.theme-option[aria-pressed='true'] { border-color: var(--accent); background: var(--selected); color: var(--bright); }
.theme-state { flex-basis: 100%; font-size: 11px; color: var(--muted); text-align: left; }
.settings-fields { display: flex; flex-direction: column; gap: var(--space-3); min-width: 0; border: 0; padding: 0; margin: 0; }
.input-row { display: flex; align-items: center; justify-content: space-between; flex-wrap: wrap; gap: var(--space-2) var(--space-4); }
.input-row label, .field-label { color: var(--text); font-weight: 500; }
.input-row input, .input-row select { width: 118px; max-width: 100%; min-width: 0; min-height: 33px; padding: var(--space-1) var(--space-2); color: var(--text); background: var(--editor); border: 1px solid var(--line-strong); border-radius: var(--radius-xs); font: inherit; }
.field-hint { margin: 0; color: var(--muted); font-size: 11px; line-height: 1.7; overflow-wrap: anywhere; font-weight: 400; }
/* A field followed by its hint sits tight against it; the group stays apart from the next row. */
.field-label + .field-hint, .settings-fields :is(input, select, textarea) + .field-hint { margin-top: calc(var(--space-3) * -1 + 2px); }
.checkbox-row { display: flex; align-items: flex-start; gap: var(--space-2); cursor: pointer; }
.checkbox-row input { flex-shrink: 0; width: 15px; height: 15px; margin: 2px 0 0; accent-color: var(--accent); }
.checkbox-row span { min-width: 0; overflow-wrap: anywhere; }
.restore-hint { padding-left: var(--space-5); }
.validation-error { margin: 0; color: var(--error); font-size: 11px; }
.dialog-footer { display: flex; align-items: center; justify-content: flex-end; flex-wrap: wrap; gap: var(--space-3); flex-shrink: 0; padding: var(--space-3) var(--space-5); border-top: 1px solid var(--line); }
.save-status { flex: 1 1 100px; color: var(--muted); font-size: 11px; }
.footer-actions { display: flex; flex-wrap: wrap; justify-content: flex-end; gap: var(--space-2); }
.footer-actions .primary-button { margin-top: 0; }
@media (max-width: 560px) {
  .settings-dialog { max-width: calc(100vw - 16px); max-height: calc(100dvh - 16px); }
  .settings-layout { grid-template-columns: 94px minmax(0, 1fr); }
  .settings-navigation { padding: var(--space-3) var(--space-1); }
  .settings-tab { padding: var(--space-2) var(--space-2); gap: var(--space-1); }
  .settings-tab > svg { display: none; }
  .settings-content { padding: var(--space-4) var(--space-3); }
  .dialog-header, .dialog-footer { padding: var(--space-3) var(--space-3); }
  .theme-option { padding: var(--space-3); }
  .restore-hint { padding-left: 0; }
}
</style>
