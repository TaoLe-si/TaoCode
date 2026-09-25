<script setup lang="ts">
import { computed, nextTick, ref, useId, watch } from 'vue'
import { Minus, Plus, Trash2, X } from 'lucide-vue-next'
import type { JavaProjectSettings, ProjectSettings, TodoPattern } from '../bridge'

// Mirrors intellij-community's Project Structure dialog:
// java/idea-ui/src/com/intellij/openapi/roots/ui/configuration/
//   ProjectStructureConfigurable.kt  — SidePanel categories under two separators.
//   ProjectConfigurableUi.kt         — General rows: SDK (+Edit), Language level, Compiler output.
//   JavaContentEntriesEditor.java    — source roots with a type popup (Sources / Tests).
// TaoCode has one implicit module, so the Modules subtree collapses into this panel;
// Artifacts/Facets/SDKs-list have no backend here and are deliberately absent.
const props = defineProps<{ settings: ProjectSettings | null; root: string | null; busy: boolean }>()
const emit = defineEmits<{
  saveJava: [settings: JavaProjectSettings]
  saveProject: [patch: { excludedDirs: string[]; todoPatterns: TodoPattern[] }]
  browse: [field: 'jdkHome' | 'outputPath']
}>()
const id = useId()

const java = ref<JavaProjectSettings>({ jdkHome: '', jdkName: 'JavaSE-17', sourcePaths: [], outputPath: '', referencedLibraries: ['lib/**/*.jar'] })
const excludedText = ref('')
const patterns = ref<TodoPattern[]>([])
watch(() => [props.root, props.settings] as const, () => {
  java.value = structuredClone(props.settings?.java ?? { jdkHome: '', jdkName: 'JavaSE-17', sourcePaths: [], outputPath: '', referencedLibraries: ['lib/**/*.jar'] })
  excludedText.value = props.settings?.excludedDirs.join('\n') ?? ''
  patterns.value = (props.settings?.todoPatterns ?? []).map(entry => ({ ...entry }))
}, { deep: true, immediate: true })

// IDEA's LanguageLevelCombo: "SDK default" plus every level the platform knows.
const languageLevels = ['_DEFAULT_', '8', '9', '11', '13', '15', '16', '17', '18', '19', '20', '21', '22', '23', '24', '25']
const jdkNameToLevel = (name: string) => name.replace('JavaSE-', '') === '1.8' ? '8' : name.replace('JavaSE-', '')
const levelToJdkName = (level: string) => level === '8' ? 'JavaSE-1.8' : `JavaSE-${level}`
const languageLevel = computed({
  get: () => jdkNameToLevel(java.value.jdkName),
  set: level => { java.value.jdkName = levelToJdkName(level) },
})

const invalidJdkHome = computed(() => !!java.value.jdkHome && !/^([A-Za-z]:[\\/]|\\\\)/.test(java.value.jdkHome))
const listLines = (value: string[]) => [...new Set(value.map(line => line.trim()).filter(Boolean))]
const invalidRelative = (paths: string[], glob = false) => paths.length > 64 || paths.some(path => path.startsWith('/') || /[\\:<>"\u0000-\u001f]/.test(path) || (!glob && /[*?]/.test(path)) || path.split('/').some(part => !part || part === '..'))
const invalidExclusion = computed(() => listLines(excludedText.value.split(/\r?\n/)).some(name => name === '.' || name === '..' || /[\\/:*?"<>|\u0000-\u001f]/.test(name)))
const invalidPatterns = computed(() => {
  const list = patterns.value
  return list.length > 20 || list.some((entry, index) => !entry.pattern.trim() || !entry.description.trim()
    || entry.pattern.length > 200 || /[\r\n]/.test(entry.pattern)
    || list.some((other, position) => position !== index && other.pattern === entry.pattern))
})
const invalidJava = computed(() => invalidJdkHome.value
  || invalidRelative(java.value.sourcePaths) || (!!java.value.outputPath && invalidRelative([java.value.outputPath]))
  || invalidRelative(java.value.referencedLibraries, true))
const invalidAll = computed(() => invalidJava.value || invalidExclusion.value || invalidPatterns.value)

function addSourceRoot() { sourceDraft.value = ''; sourcePopup.value = true; void nextTick(() => sourceInput.value?.focus()) }
function applySourceRoot(kind: 'sources' | 'tests') {
  const path = sourceDraft.value.trim().replace(/\/$/, '')
  if (!path) return
  // IDEA marks test roots distinctly; TaoCode's JDT config keeps sources flat and
  // excludes test roots from sourcePaths is not modelled — both land in sourcePaths.
  if (!java.value.sourcePaths.includes(path)) java.value.sourcePaths.push(path)
  void kind
  sourcePopup.value = false
}
function dropSourceRoot(index: number) { java.value.sourcePaths.splice(index, 1) }
function addLibrary() { libraryDraft.value = ''; libraryPopup.value = true; void nextTick(() => libraryInput.value?.select()) }
function applyLibrary() {
  const pattern = libraryDraft.value.trim()
  if (pattern && !java.value.referencedLibraries.includes(pattern)) java.value.referencedLibraries.push(pattern)
  libraryPopup.value = false
}
function dropLibrary(index: number) { java.value.referencedLibraries.splice(index, 1) }
function addPattern() { patterns.value = [...patterns.value, { pattern: '', description: '' }] }
function dropPattern(index: number) { patterns.value = patterns.value.filter((_, position) => position !== index) }

const sourcePopup = ref(false)
const sourceDraft = ref('')
const sourceInput = ref<HTMLInputElement>()
const libraryPopup = ref(false)
const libraryDraft = ref('')
const libraryInput = ref<HTMLInputElement>()

function save() {
  if (props.busy || !props.settings || invalidAll.value) return
  emit('saveJava', { ...java.value, sourcePaths: listLines(java.value.sourcePaths), referencedLibraries: listLines(java.value.referencedLibraries) })
  emit('saveProject', { excludedDirs: listLines(excludedText.value.split(/\r?\n/)), todoPatterns: patterns.value.map(entry => ({ ...entry })) })
}
</script>

<template>
  <div class="ps-panel">
    <p v-if="!settings" class="section-description">尚未打开项目。项目结构（SDK、内容根、输出目录、排除目录与 TODO 标记）随项目保存，请先打开一个项目。</p>
    <form v-else :id="`${id}-form`" class="ps-form" :aria-busy="busy" @submit.prevent="save">
      <!-- Category header, like SidePanel's selected place in ProjectStructureConfigurable -->
      <h3 class="ps-title">项目：{{ root?.split('/').pop() || root }}</h3>

      <fieldset class="ps-group" :disabled="busy">
        <legend class="ps-group-label">项目设置</legend>

        <div class="ps-row">
          <label class="ps-label" :for="`${id}-sdk`">SDK：</label>
          <div class="ps-cell">
            <div class="ps-inline">
              <input :id="`${id}-sdk`" v-model.trim="java.jdkHome" class="ps-grow" :class="{ 'ps-invalid': invalidJdkHome }" placeholder="D:\Program Files\Java\jdk-21" spellcheck="false" :aria-describedby="`${id}-sdk-hint`" />
              <button type="button" class="subtle-button" @click="emit('browse', 'jdkHome')">编辑…</button>
            </div>
            <p :id="`${id}-sdk-hint`" class="ps-comment">留空时使用语言服务器自动检测的 JDK；此处只记录本机路径，不会下载或安装 JDK。</p>
            <p v-if="invalidJdkHome" class="ps-error" role="alert">请输入绝对路径（如 D:\jdk-21）或留空。</p>
          </div>
        </div>

        <div class="ps-row">
          <label class="ps-label" :for="`${id}-level`">语言级别：</label>
          <div class="ps-cell">
            <select :id="`${id}-level`" v-model="languageLevel" class="ps-level">
              <option value="_DEFAULT_">SDK 默认</option>
              <option v-for="level in languageLevels" :key="level" :value="level">{{ level }}</option>
            </select>
          </div>
        </div>

        <div class="ps-row">
          <label class="ps-label" :for="`${id}-output`">编译器输出：</label>
          <div class="ps-cell">
            <div class="ps-inline">
              <input :id="`${id}-output`" v-model.trim="java.outputPath" class="ps-grow" placeholder="out" spellcheck="false" :aria-describedby="`${id}-output-hint`" />
              <button type="button" class="subtle-button" @click="emit('browse', 'outputPath')">浏览…</button>
            </div>
            <p :id="`${id}-output-hint`" class="ps-comment">用于模块子目录；对应各源码类型的 Production 与 Test 目录。</p>
          </div>
        </div>
      </fieldset>

      <fieldset class="ps-group" :disabled="busy">
        <legend class="ps-group-label">模块「{{ root?.split('/').pop() }}」· 内容根</legend>
        <div class="ps-tree" role="tree" aria-label="内容根">
          <div class="ps-tree-node ps-content">内容根 {{ root || '.' }}</div>
          <div v-for="(source, index) in java.sourcePaths" :key="source" class="ps-tree-node" role="treeitem">
            <span class="ps-root-icon" :class="{ 'ps-root-test': /test/i.test(source) }" aria-hidden="true" />
            <span>{{ source }}</span>
            <span class="ps-root-type">{{ /test/i.test(source) ? '测试' : '源代码' }}</span>
            <button type="button" class="icon-button" :aria-label="`移除 ${source}`" @click="dropSourceRoot(index)"><Minus :size="13" /></button>
          </div>
          <p v-if="!java.sourcePaths.length" class="ps-empty-line">没有源码目录。点“添加内容根”选择项目内目录。</p>
        </div>
        <div class="ps-toolbar">
          <button type="button" class="subtle-button" @click="addSourceRoot"><Plus :size="13" /> 添加内容根…</button>
        </div>
        <div v-if="sourcePopup" class="ps-popup" role="dialog" aria-label="新目录类型">
          <input ref="sourceInput" v-model="sourceDraft" class="ps-grow" placeholder="项目内路径，例如 src/main/java" spellcheck="false" aria-label="新目录路径" @keydown.enter.prevent="applySourceRoot('sources')" @keydown.esc.prevent="sourcePopup = false" />
          <button type="button" class="subtle-button" @click="applySourceRoot('sources')">源代码根</button>
          <button type="button" class="subtle-button" @click="applySourceRoot('tests')">测试根</button>
          <button type="button" class="icon-button" aria-label="取消" @click="sourcePopup = false"><X :size="14" /></button>
        </div>
      </fieldset>

      <fieldset class="ps-group" :disabled="busy">
        <legend class="ps-group-label">依赖库</legend>
        <div class="ps-tree" role="list" aria-label="依赖 JAR">
          <div v-for="(library, index) in java.referencedLibraries" :key="library" class="ps-tree-node" role="listitem">
            <span>{{ library }}</span>
            <button type="button" class="icon-button" :aria-label="`移除 ${library}`" @click="dropLibrary(index)"><Minus :size="13" /></button>
          </div>
          <p v-if="!java.referencedLibraries.length" class="ps-empty-line">没有依赖条目。</p>
        </div>
        <div class="ps-toolbar">
          <button type="button" class="subtle-button" @click="addLibrary"><Plus :size="13" /> 添加路径或通配符…</button>
        </div>
        <div v-if="libraryPopup" class="ps-popup" role="dialog" aria-label="添加依赖">
          <input ref="libraryInput" v-model="libraryDraft" class="ps-grow" placeholder="lib/**/*.jar" spellcheck="false" aria-label="依赖路径或通配符" @keydown.enter.prevent="applyLibrary" @keydown.esc.prevent="libraryPopup = false" />
          <button type="button" class="subtle-button" @click="applyLibrary">确定</button>
          <button type="button" class="icon-button" aria-label="取消" @click="libraryPopup = false"><X :size="14" /></button>
        </div>
      </fieldset>

      <fieldset class="ps-group" :disabled="busy">
        <legend class="ps-group-label">排除的目录</legend>
        <textarea v-model="excludedText" rows="4" spellcheck="false" class="ps-textarea" aria-label="排除的目录名，每行一个" :aria-invalid="invalidExclusion" placeholder="每行一个目录名，例如 build" />
        <p v-if="invalidExclusion" class="ps-error" role="alert">请输入目录名，不要使用路径、通配符、“.”或“..”。</p>
      </fieldset>

      <fieldset class="ps-group" :disabled="busy">
        <legend class="ps-group-label">TODO 标记</legend>
        <div class="ps-todos" role="group" aria-label="TODO 标记列表">
          <div v-for="(entry, index) in patterns" :key="index" class="ps-todo-row">
            <input v-model="entry.pattern" class="ps-todo-pattern" :aria-label="`第 ${index + 1} 条标记`" spellcheck="false" placeholder="TODO" />
            <input v-model="entry.description" class="ps-todo-desc" :aria-label="`第 ${index + 1} 条说明`" spellcheck="false" placeholder="待办" />
            <button type="button" class="icon-button" :aria-label="`删除第 ${index + 1} 条标记`" @click="dropPattern(index)"><Trash2 :size="13" /></button>
          </div>
          <button type="button" class="subtle-button ps-todo-add" :disabled="patterns.length >= 20" @click="addPattern"><Plus :size="13" /> 添加标记</button>
        </div>
        <p v-if="invalidPatterns" class="ps-error" role="alert">每条标记都要有标记文字和说明，且标记不能重复。</p>
      </fieldset>
    </form>
  </div>
</template>

<style scoped>
.ps-panel { min-width: 0; }
.ps-form { display: flex; flex-direction: column; gap: var(--space-4); min-width: 0; margin: 0; padding: 0; border: 0; }
.ps-title { margin: 0; font-size: 15px; color: var(--bright); font-weight: 600; }
.ps-group { display: flex; flex-direction: column; gap: var(--space-3); min-width: 0; margin: 0; padding: 0; border: 0; }
.ps-group-label { padding: 0 0 var(--space-1); color: var(--muted); font-size: 11px; font-weight: 500; letter-spacing: .03em; text-transform: uppercase; }
/* IDEA FormLayout: right-aligned label column, fields fill the rest at one shared width. */
.ps-row { display: grid; grid-template-columns: 96px minmax(0, 1fr); gap: var(--space-3); align-items: baseline; }
.ps-label { color: var(--text); font-weight: 500; text-align: right; }
.ps-cell { display: flex; flex-direction: column; gap: var(--space-1); min-width: 0; }
.ps-inline { display: flex; align-items: center; gap: var(--space-2); min-width: 0; }
.ps-grow { flex: 1; min-width: 0; }
.ps-inline input, .ps-textarea, .ps-popup input { min-height: var(--ctrl-height); padding: var(--space-1) var(--space-2); color: var(--text); background: var(--editor); border: 1px solid var(--line-strong); border-radius: var(--radius-xs); font: inherit; }
.ps-inline input { font-family: var(--font-mono); font-size: 12px; }
.ps-level { min-height: var(--ctrl-height); max-width: 100%; padding: var(--space-1) var(--space-2); color: var(--text); background: var(--editor); border: 1px solid var(--line-strong); border-radius: var(--radius-xs); font: inherit; }
.ps-comment { margin: 0; color: var(--muted); font-size: 11px; line-height: 1.6; overflow-wrap: anywhere; }
.ps-error { margin: 0; color: var(--error); font-size: 11px; }
.ps-invalid { border-color: var(--error); }
.ps-tree { display: flex; flex-direction: column; border: 1px solid var(--line); border-radius: var(--radius-sm); background: var(--editor); overflow: hidden; }
.ps-tree-node { display: flex; align-items: center; gap: var(--space-2); padding: var(--space-1) var(--space-2); border-bottom: 1px solid var(--line); font: 12px/1.6 var(--font-mono); color: var(--text); }
.ps-tree-node:last-child { border-bottom: 0; }
.ps-tree-node:hover .icon-button { visibility: visible; }
.ps-tree-node .icon-button { visibility: hidden; margin-left: auto; }
.ps-content { color: var(--secondary); font-weight: 600; background: var(--panel); }
.ps-root-icon { width: 10px; height: 10px; flex-shrink: 0; border-radius: 2px; background: var(--success); }
.ps-root-test { background: var(--warning); }
.ps-root-type { color: var(--muted); font: 11px var(--font-ui); }
.ps-empty-line { margin: 0; padding: var(--space-2); color: var(--muted); font-size: 11px; }
.ps-toolbar { display: flex; gap: var(--space-2); }
.ps-popup { display: flex; align-items: center; gap: var(--space-2); padding: var(--space-2); border: 1px solid var(--line-strong); border-radius: var(--radius-sm); background: var(--elevated); box-shadow: var(--shadow-2); }
.ps-textarea { display: block; width: 100%; min-width: 0; max-width: 100%; resize: vertical; padding: var(--space-2); color: var(--text); background: var(--editor); border: 1px solid var(--line-strong); border-radius: var(--radius-xs); font: 12px/1.7 var(--font-mono); }
.ps-textarea[aria-invalid='true'], .ps-popup input:focus-visible { border-color: var(--error); }
.ps-todos { display: flex; flex-direction: column; gap: var(--space-2); }
.ps-todo-row { display: flex; align-items: center; gap: var(--space-2); }
.ps-todo-row input { min-width: 0; min-height: var(--ctrl-height-sm); padding: var(--space-1) var(--space-2); color: var(--text); background: var(--editor); border: 1px solid var(--line-strong); border-radius: var(--radius-xs); font: 12px/1.5 var(--font-mono); }
.ps-todo-pattern { flex: 1 1 45%; }
.ps-todo-desc { flex: 1 1 55%; font-family: var(--font-ui) !important; }
.ps-todo-add { align-self: flex-start; display: inline-flex; align-items: center; gap: var(--space-1); }
@media (max-width: 560px) {
  .ps-row { grid-template-columns: minmax(0, 1fr); }
  .ps-label { text-align: left; }
}
</style>
