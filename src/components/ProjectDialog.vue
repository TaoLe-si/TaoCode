<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, useId, watch } from 'vue'
import { FolderOpen, GitBranch, X } from 'lucide-vue-next'
import type { ProjectForm } from '../bridge'

const props = defineProps<{
  mode: 'create' | 'clone'
  busy: boolean
  cancelling: boolean
  error: string
  progress: string[]
  gitAvailable: boolean
  isDesktop: boolean
}>()
const form = defineModel<ProjectForm>('form', { required: true })
const emit = defineEmits<{ browse: []; submit: []; cancel: [] }>()
const id = useId()
const dialog = ref<HTMLDialogElement>()
const formElement = ref<HTMLFormElement>()
const nameInput = ref<HTMLInputElement>()
const sourceInput = ref<HTMLInputElement>()
const progressLog = ref<HTMLElement>()
const followProgress = ref(true)
const locked = computed(() => props.busy || props.cancelling)
// Windows reserves legacy device names in every directory, with or without an
// extension: "CON", "CON.txt" and "NUL.log" are all unusable as file names.
const RESERVED = /^(CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])(\.|$)/i
const ILLEGAL_NAME = /[\\/:*?"<>|\u0000-\u001f]/
const ILLEGAL_PATH = /[<>:"|?*\u0000-\u001f]/
const reservedName = (name: string) => RESERVED.test(name)
const nameError = computed(() => {
  const name = form.value.name
  if (!name) return ''
  if (name !== name.trim() || ILLEGAL_NAME.test(name) || name === '.' || name === '..' || name.endsWith('.'))
    return '名称不能含路径分隔符或特殊字符，不能以空白开头或以空白、句点结尾。'
  if (reservedName(name)) return '名称使用了 Windows 保留名（CON、PRN、AUX、NUL、COM1-9、LPT1-9），请更换。'
  if (name.length > 80) return '名称过长：单个目录名请控制在 80 个字符以内。'
  return ''
})
const parentError = computed(() => {
  const parent = form.value.parent.trim()
  if (!parent) return ''
  if (ILLEGAL_PATH.test(parent)) return '路径不能包含 : * ? " < > | 或控制字符。'
  // Accept either a drive path or a UNC share; anything else cannot be resolved to
  // a real directory by the native file layer.
  const normalized = parent.replace(/\\/g, '/')
  if (!/^[A-Za-z]:\//.test(normalized) && !normalized.startsWith('//'))
    return '请填写绝对路径，例如 D:\\projects 或 \\\\server\\share。'
  const parts = normalized.replace(/^\/+/, '').split('/').filter(Boolean)
  if (parts.some(part => part === '.' || part === '..')) return '路径里的“.”或“..”段无法定位父目录，请直接填写完整路径。'
  if (parts.some(part => part.endsWith('.'))) return '路径的每一段都不能以句点结尾。'
  if (parts.some(reservedName)) return '路径包含 Windows 保留名（CON、PRN、AUX、NUL、COM1-9、LPT1-9）。'
  return ''
})
const pathTooLong = computed(() => {
  const destination = `${form.value.parent.trim()}/${form.value.name.trim()}`
  // MAX_PATH leaves no room for the generated build trees once the project is open.
  return Boolean(form.value.parent.trim() && form.value.name.trim()) && destination.replace(/^\\\\\?\\/, '').length > 240
    ? '最终路径超过 240 个字符，Windows 将无法完整创建子目录，请换更短的位置或名称。'
    : ''
})
const destination = computed(() => {
  const parent = form.value.parent.trim()
  const name = form.value.name.trim()
  if (!parent || !name) return ''
  const separator = parent.includes('\\') ? '\\' : '/'
  return `${parent.replace(/[\\/]+$/, '')}${separator}${name}`
})
const cloneSourceError = computed(() => {
  const source = form.value.source.trim()
  if (!source) return ''
  // Newlines cannot appear in a git remote; everything else (spaces included) is
  // passed to git as a separate argument and survives.
  if (/[\r\n\u0000-\u001f]/.test(source)) return '仓库地址不能包含换行或控制字符。'
  return ''
})
const invalid = computed(() => Boolean(nameError.value || parentError.value || pathTooLong.value || (props.mode === 'clone' && cloneSourceError.value)))
const canSubmit = computed(() => props.isDesktop && !locked.value && !invalid.value
  && Boolean(form.value.parent.trim() && form.value.name.trim())
  && (props.mode === 'create' || (props.gitAvailable && Boolean(form.value.source.trim()))))
const templateHint = computed(() => {
  const hints: Record<string, string> = {
    empty: '仅创建项目文件夹，不添加示例代码，不安装依赖。',
    java: '生成 src/Main.java。不会自动安装 JDK、下载依赖或执行构建。',
    'spring-boot': '生成 Spring Boot 项目结构，包含 pom.xml 和主类。需要手动配置依赖和运行环境。',
    maven: '生成标准 Maven 项目结构（src/main/java, src/test/java, pom.xml）。',
    gradle: '生成 Gradle 项目结构（src/main/java, src/test/java, build.gradle）。',
    kotlin: '生成 Kotlin 项目结构，包含 src/main/kotlin 目录和 Main.kt。',
    python: '生成 Python 项目结构，包含 main.py 和 requirements.txt。',
    node: '生成 Node.js 项目结构，包含 package.json 和 index.js。',
    vue: '生成 Vue 3 + Vite 项目结构，包含基础组件和路由配置。',
    react: '生成 React + Vite 项目结构，包含基础组件和路由配置。',
  }
  return hints[form.value.template] ?? hints.empty
})
let previousFocus: HTMLElement | null = null

function updateField<K extends keyof ProjectForm>(key: K, value: ProjectForm[K]) {
  if (!locked.value) form.value = { ...form.value, [key]: value }
}
function submit() {
  if (canSubmit.value && formElement.value?.reportValidity()) emit('submit')
}
function close() {
  if (!locked.value) emit('cancel')
}
function cancelOperation() {
  if (!props.cancelling && (!props.busy || props.mode === 'clone')) emit('cancel')
}
function focusInitialField() {
  if (locked.value) dialog.value?.focus()
  else (props.mode === 'clone' ? sourceInput.value : nameInput.value)?.focus()
}
function onKeydown(event: KeyboardEvent) {
  if (event.key !== 'Tab') return
  const controls = [...(dialog.value?.querySelectorAll<HTMLElement>('button, input, select, [tabindex]') ?? [])]
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
function trackProgressScroll() {
  const log = progressLog.value
  if (log) followProgress.value = log.scrollHeight - log.scrollTop - log.clientHeight < 24
}
watch(() => props.progress.join('\n'), async () => {
  await nextTick()
  if (followProgress.value && progressLog.value) progressLog.value.scrollTop = progressLog.value.scrollHeight
})
watch(() => props.mode, async () => { await nextTick(); focusInitialField() })
watch(locked, async value => {
  if (!value) return
  await nextTick()
  // A disabled input must not leave keyboard focus on the page behind the dialog.
  if (!dialog.value?.contains(document.activeElement) || document.activeElement?.matches(':disabled')) dialog.value?.focus()
})
onMounted(() => {
  previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null
  dialog.value?.showModal()
  focusInitialField()
})
onBeforeUnmount(() => {
  dialog.value?.close()
  if (previousFocus?.isConnected) previousFocus.focus()
})
</script>

<template>
  <dialog
    ref="dialog" class="help-dialog project-dialog" role="dialog" aria-modal="true" tabindex="-1"
    :aria-labelledby="`${id}-title`" :aria-describedby="`${id}-description`"
    @cancel.prevent="close" @keydown.stop="onKeydown"
  >
    <header class="dialog-header">
      <h2 :id="`${id}-title`" class="dialog-title">{{ mode === 'create' ? '新建项目' : '克隆仓库' }}</h2>
      <button type="button" class="icon-button" :disabled="locked" aria-label="关闭项目对话框" :title="locked ? '请等待操作结束，克隆可通过下方按钮取消' : '关闭（Esc）'" @click="close"><X :size="18" aria-hidden="true" /></button>
    </header>
    <form :id="`${id}-form`" ref="formElement" class="project-form" :aria-busy="locked" @submit.prevent="submit">
      <p :id="`${id}-description`" class="dialog-description">{{ mode === 'create' ? '选择位置与模板，在本地创建项目文件夹。' : '将 Git 仓库克隆到指定的本地文件夹。' }}</p>
      <p v-if="!isDesktop" class="preview-banner dialog-notice">浏览器仅供布局预览：字段可以填写，但不能访问磁盘、新建或克隆项目；示例文件只存在于内存，不会在此模拟成功。</p>
      <p v-if="mode === 'clone' && !gitAvailable" class="git-warning" role="status">未检测到可用的 Git。请安装 Git 并确保它在 PATH 中可用，然后重新打开 TaoCode。安装 Git 后才能克隆。</p>
      <div v-if="error" class="notice error form-error" role="alert"><span>{{ error }}</span></div>

      <fieldset class="project-fields" :disabled="locked">
        <div v-if="mode === 'clone'" class="form-field">
          <label :for="`${id}-source`">仓库地址或本地路径</label>
          <input :id="`${id}-source`" ref="sourceInput" :value="form.source" type="text" required autocomplete="off" spellcheck="false" :aria-describedby="`${id}-credentials`" placeholder="HTTPS、SSH 地址或本地仓库路径" @input="updateField('source', ($event.target as HTMLInputElement).value)" />
          <p :id="`${id}-credentials`" class="field-hint">克隆以非交互方式运行，无法在这里输入密码或确认 SSH 主机。请先在系统中配置 Git 凭据管理器，或 SSH 密钥及已验证的主机记录。不要将密码或访问令牌放进仓库 URL。</p>
          <p v-if="cloneSourceError" class="field-error">{{ cloneSourceError }}</p>
        </div>
        <div class="form-field">
          <label :for="`${id}-name`">{{ mode === 'clone' ? '目标文件夹名称' : '项目名称' }}</label>
          <input :id="`${id}-name`" ref="nameInput" :value="form.name" type="text" required autocomplete="off" spellcheck="false" :aria-invalid="Boolean(nameError)" :aria-describedby="nameError ? `${id}-name-error` : undefined" placeholder="项目文件夹名称" @input="updateField('name', ($event.target as HTMLInputElement).value)" />
          <p v-if="nameError" :id="`${id}-name-error`" class="field-error">{{ nameError }}</p>
        </div>
        <div class="form-field">
          <label :for="`${id}-parent`">父目录</label>
          <div class="directory-input">
            <input :id="`${id}-parent`" :value="form.parent" type="text" required autocomplete="off" spellcheck="false" :aria-invalid="Boolean(parentError)" :aria-describedby="parentError ? `${id}-parent-error` : undefined" placeholder="选择或输入父目录的完整路径" @input="updateField('parent', ($event.target as HTMLInputElement).value)" />
            <button type="button" class="subtle-button browse-button" :disabled="!isDesktop || locked" :title="isDesktop ? '选择父目录' : '浏览磁盘目录仅在桌面端可用'" @click="emit('browse')"><FolderOpen :size="15" aria-hidden="true" />浏览…</button>
          </div>
          <p v-if="parentError" :id="`${id}-parent-error`" class="field-error" role="alert">{{ parentError }}</p>
        </div>
        <div v-if="mode === 'create'" class="form-field">
          <label :for="`${id}-template`">项目模板</label>
          <select :id="`${id}-template`" :value="form.template" :aria-describedby="`${id}-template-hint`" @change="updateField('template', ($event.target as HTMLSelectElement).value as ProjectForm['template'])">
            <option value="empty">空项目</option>
            <option value="cpp">C++ 项目（CMake）</option>
            <option value="java">Java 项目</option>
            <option value="spring-boot">Spring Boot 项目</option>
            <option value="maven">Maven 项目</option>
            <option value="gradle">Gradle 项目</option>
            <option value="kotlin">Kotlin 项目</option>
            <option value="python">Python 项目</option>
            <option value="node">Node.js 项目</option>
            <option value="vue">Vue 3 项目</option>
            <option value="react">React 项目</option>
          </select>
          <p :id="`${id}-template-hint`" class="field-hint">{{ templateHint }}</p>
        </div>
      </fieldset>

      <div class="destination-block">
        <span :id="`${id}-destination-label`">最终路径</span>
        <output :aria-labelledby="`${id}-destination-label`">{{ destination || '填写父目录和名称后显示' }}</output>
        <span v-if="!isDesktop" class="field-hint">此路径仅用于预览，不会写入磁盘。</span>
        <p v-if="pathTooLong" class="field-error" role="alert">{{ pathTooLong }}</p>
      </div>
      <section v-if="mode === 'clone'" class="clone-progress" :aria-labelledby="`${id}-progress-title`">
        <div class="progress-heading"><h3 :id="`${id}-progress-title`"><GitBranch :size="14" aria-hidden="true" />克隆输出</h3><span role="status">{{ cancelling ? '正在请求取消…' : busy ? '克隆中…' : '' }}</span></div>
        <div ref="progressLog" class="progress-log" role="log" aria-live="polite" aria-relevant="additions text" aria-label="Git 克隆日志" tabindex="0" @scroll="trackProgressScroll">
          <div v-for="(line, index) in progress" :key="index" class="progress-line">{{ line }}</div>
          <p v-if="!progress.length" class="log-empty">{{ busy ? '等待 Git 输出…' : '提交克隆后，实际 Git 输出会显示在这里。' }}</p>
        </div>
      </section>
    </form>
    <footer class="dialog-footer">
      <span class="operation-status" role="status">{{ cancelling ? '正在取消，请等待克隆进程结束。' : busy ? mode === 'create' ? '正在创建，请勿关闭此窗口。' : '克隆进行中，可以请求取消。' : !isDesktop ? '仅布局预览，无法提交' : '' }}</span>
      <div class="footer-actions">
        <button type="button" class="subtle-button" :disabled="cancelling || (busy && mode === 'create')" @click="cancelOperation">{{ cancelling ? '正在取消克隆…' : busy && mode === 'clone' ? '取消克隆' : '取消' }}</button>
        <button type="submit" :form="`${id}-form`" class="primary-button" :disabled="!canSubmit">{{ cancelling ? '正在取消…' : busy ? mode === 'create' ? '正在创建…' : '正在克隆…' : mode === 'create' ? '创建项目' : '克隆仓库' }}</button>
      </div>
    </footer>
  </dialog>
</template>

<style scoped>
.project-dialog { position: fixed; inset: 0; width: 610px; max-width: calc(100vw - 32px); max-height: calc(100dvh - 32px); margin: auto; padding: 0; color: var(--text); }
.project-dialog[open] { display: flex; flex-direction: column; }
.project-dialog::backdrop { background: var(--backdrop); }
.project-dialog:focus { outline: none; }
.dialog-header { display: flex; align-items: center; justify-content: space-between; gap: var(--space-3); flex-shrink: 0; padding: var(--space-4) var(--space-5); border-bottom: 1px solid var(--line); }
.project-dialog .dialog-title { margin: 0; padding: 0; font: 600 17px/1.5 var(--font-ui); color: var(--bright); }
.project-form { min-height: 0; min-width: 0; overflow: auto; padding: var(--space-4) var(--space-5); }
.dialog-description { margin: 0 0 var(--space-4); color: var(--secondary); }
.dialog-notice { margin: 0 0 var(--space-4); padding: var(--space-2) var(--space-3); border: 1px solid var(--line); border-radius: var(--radius-xs); font-size: 12px; overflow-wrap: anywhere; }
.git-warning { margin: 0 0 var(--space-4); padding: var(--space-2) var(--space-3); color: var(--warning); background: var(--warning-bg); border: 1px solid var(--line); border-radius: var(--radius-xs); }
.form-error { border: 1px solid var(--error); border-radius: var(--radius-xs); margin-bottom: var(--space-4); }
.project-fields { display: flex; flex-direction: column; gap: var(--space-4); min-width: 0; margin: 0; padding: 0; border: 0; }
.form-field { display: flex; flex-direction: column; gap: var(--space-1); min-width: 0; }
.form-field label { color: var(--bright); font-weight: 600; }
.form-field input, .form-field select { width: 100%; min-width: 0; min-height: 34px; padding: var(--space-2); color: var(--text); background: var(--editor); border: 1px solid var(--line-strong); border-radius: var(--radius-xs); font: inherit; }
.form-field input::placeholder { color: var(--muted); }
.form-field input:disabled, .form-field select:disabled { color: var(--muted); background: var(--panel); }
.form-field select:focus-visible { outline: 2px solid var(--accent); outline-offset: -2px; }
.form-field input[aria-invalid='true'] { border-color: var(--error); }
.field-hint { margin: 0; color: var(--muted); font-size: 11px; line-height: 1.7; overflow-wrap: anywhere; }
.field-error { margin: 0; color: var(--error); font-size: 11px; }
.directory-input { display: flex; gap: var(--space-2); min-width: 0; }
.directory-input input { flex: 1; }
.browse-button { display: inline-flex; align-items: center; justify-content: center; gap: var(--space-1); flex-shrink: 0; }
.destination-block { display: flex; flex-direction: column; gap: var(--space-1); margin-top: var(--space-4); padding: var(--space-3); border: 1px solid var(--line); border-radius: var(--radius-xs); background: var(--panel); }
.destination-block > span:first-child { font-size: 11px; color: var(--secondary); }
.destination-block output { color: var(--text); font: 12px/1.7 var(--font-mono); overflow-wrap: anywhere; white-space: pre-wrap; }
.clone-progress { margin-top: var(--space-4); }
.progress-heading { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: var(--space-2); margin-bottom: var(--space-2); color: var(--muted); font-size: 11px; }
.progress-heading h3 { display: inline-flex; align-items: center; gap: var(--space-2); margin: 0; color: var(--secondary); font-size: 12px; font-weight: 500; }
.progress-log { min-width: 0; max-height: 150px; min-height: 65px; overflow: auto; padding: var(--space-2) var(--space-3); border: 1px solid var(--line-strong); border-radius: var(--radius-xs); background: var(--editor); font: 11px/1.7 var(--font-mono); }
.progress-log:focus-visible { outline: 2px solid var(--accent); outline-offset: -2px; }
.progress-line { white-space: pre-wrap; overflow-wrap: anywhere; }
.log-empty { margin: 0; color: var(--muted); font-family: var(--font-ui); }
.dialog-footer { display: flex; flex-wrap: wrap; align-items: center; justify-content: flex-end; gap: var(--space-3); flex-shrink: 0; padding: var(--space-3) var(--space-5); border-top: 1px solid var(--line); }
.operation-status { flex: 1 1 190px; color: var(--muted); font-size: 11px; }
.footer-actions { display: flex; flex-wrap: wrap; justify-content: flex-end; gap: var(--space-2); }
.footer-actions .primary-button { margin-top: 0; }
@media (max-width: 480px) {
  .project-dialog { max-width: calc(100vw - 16px); max-height: calc(100dvh - 16px); }
  .dialog-header, .dialog-footer { padding: var(--space-3) var(--space-3); }
  .project-form { padding: var(--space-3); }
  .directory-input { flex-wrap: wrap; }
  .directory-input input { flex-basis: 100%; }
  .browse-button { margin-left: auto; }
}
</style>
