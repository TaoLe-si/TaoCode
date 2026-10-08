<script setup lang="ts">
// 「实时模板」设置页里的**文件模板**子页（上游 `AllFileTemplatesConfigurable` /
// `FileTemplateConfigurable`：`ide-core-impl/.../fileTemplates/impl/`）。
//
// 消费三个模块：
//   · `src/fileTemplateRegistry.ts` —— 五个类别、`.ft`/`.html` 文件名规则、只读判定、
//     `#parse` 的 Includes 解析、两份方案目录的持久化；
//   · `src/fileTemplateParser.ts` —— `#if`/`#set`/`#parse`/`${DS}` 的渲染与语法错；
//   · `src/fileTemplateVars.ts` —— 预定义变量表与包名/类名推导（预览的取值来源）。
//
// 诚实边界（2026-10-06 订正判词）：预览是用这些模块**真算**出来的，而且算的就是
// `src/fileTemplateCreate.ts` 里那条**会写盘**的路径（`file.create` 建 + `file.write` 写正文），
// 所以「用户模板与 `${NAME}` 的展开结果没有落盘通道」这句已经不成立 ——
// 宿主 `Workspace::create`（`native/workspace.cpp:971-1079`）确实只认 16 个内建 `template_kind`，
// 但本仓不需要新宿主方法。剩下的唯一缺口是 App.vue 那条 `nameDialog`
// （`src/App.vue:1744` 现在只把 `dialog.template` 当 `template_kind` 传）⇒ 见接线请求。
import { computed, ref, watch } from 'vue'
import { Copy, FileText, Pencil, Plus, Trash2 } from 'lucide-vue-next'
import {
  FileTemplateParseError, TemplateNotFoundError, renderFileTemplate, scanTemplateAttributes,
} from '../fileTemplateParser.ts'
import {
  FILE_TEMPLATE_CATEGORIES, HOST_FILE_TEMPLATE_KINDS, categoryInfo, fileTemplatesState, schemeDirs,
  templateQName, templatesDirFor,
} from '../fileTemplateRegistry.ts'
import { templateVariablesFor, type UserFileTemplate } from '../fileTemplateVars.ts'
import { planFileTemplateCreate } from '../fileTemplateCreate.ts'
import { iconSize } from '../uiIcons'

const props = defineProps<{ projectRoot: string | null; projectName: string; busy: boolean }>()

/** 预览用的文件名/路径（`templateVariablesFor` 的入参）。用户可以改，改了立刻看到展开结果。 */
const previewFileName = ref('Widget.java')
const previewPath = ref('src/main/java/com/acme/Widget.java')

type Scope = 'default' | 'project'
const scope = ref<Scope>('project')
const scheme = computed(() => schemeDirs(props.projectRoot))
const scopeDir = computed(() => scheme.value.find(item => item.scope === scope.value)?.dir ?? '')
const state = computed(() => fileTemplatesState(scope.value, props.projectRoot))

/**
 * 预览变量：时间类固定成 2026-10-05 14:05，方便逐字对照（`fileTemplateVars.ts` 的 `now` 注入点）。
 */
const PREVIEW_NOW = new Date(2026, 9, 5, 14, 5)
const previewVariables = computed(() => templateVariablesFor({
  fileName: previewFileName.value,
  path: previewPath.value,
  projectName: props.projectName,
  user: 'tao',
  now: PREVIEW_NOW,
}))

/** Includes 类别里可被 `#parse` 引用的模板（`resolveInclude` 只认这一类）。 */
const includable = computed(() => state.value.templates.value.map(template => ({
  name: templateQName(template.name, template.extension),
  content: template.content,
})))

const query = ref('')
const shown = computed(() => {
  const needle = query.value.trim().toLowerCase()
  const all = state.value.templates.value
  if (!needle) return all
  return all.filter(template =>
    template.name.toLowerCase().includes(needle)
    || template.extension.toLowerCase().includes(needle)
    || template.content.toLowerCase().includes(needle))
})

const draft = ref<UserFileTemplate>(blankDraft())
const editingId = ref<string | null>(null)
const creating = ref(false)
const formError = ref('')

function blankDraft(): UserFileTemplate {
  return { id: `tpl-${Math.random().toString(36).slice(2, 10)}`, name: '', extension: '', content: '', description: '' }
}

function startCreate() {
  draft.value = blankDraft()
  editingId.value = null
  creating.value = true
  formError.value = ''
}
function startEdit(template: UserFileTemplate) {
  draft.value = { ...template }
  editingId.value = template.id
  creating.value = false
  formError.value = ''
}
function cancel() { creating.value = false; editingId.value = null; formError.value = '' }

/** 编辑器里的正文：语法错、子模板缺失、还没填的变量分别给一句话，不吞掉。 */
const diagnosis = computed(() => {
  const content = draft.value.content
  if (!content.trim()) return { level: 'idle' as const, text: '' }
  const resolver = (name: string) => includable.value.find(item => item.name === name)?.content
  try {
    const scan = scanTemplateAttributes(content, resolver)
    const result = renderFileTemplate(content, { variables: previewVariables.value, resolveInclude: resolver })
    if (result.unset.length) {
      return { level: 'warn' as const, text: `展开后还差这些变量的值：${result.unset.join('、')}（上游会在这里弹取值框）。` }
    }
    if (result.skipped.length) {
      return { level: 'warn' as const, text: `这些子模板成环，已跳过：${result.skipped.join('、')}。` }
    }
    return {
      level: 'ok' as const,
      text: scan.includes.length
        ? `引用的子模板：${scan.includes.join('、')}（只能引「包含片段」类别）。`
        : '语法正确，可以展开。',
    }
  } catch (error) {
    if (error instanceof TemplateNotFoundError) return { level: 'error' as const, text: error.message }
    if (error instanceof FileTemplateParseError) return { level: 'error' as const, text: error.message }
    return { level: 'error' as const, text: `模板无法解析：${String(error)}` }
  }
})

const preview = computed(() => createPlan.value?.content ?? '')

/** `previewPath` 的目录部分（`planFileTemplateCreate` 的 `directory` 入参）。 */
const previewDirectory = computed(() => {
  const path = previewPath.value.replace(/\\/g, '/')
  const at = path.lastIndexOf('/')
  return at >= 0 ? path.slice(0, at) : ''
})

/** 词干（去掉已有扩展名）：让模板自己的扩展名决定后缀，与写入时同一套规则。 */
const previewStem = computed(() => {
  const base = ((previewPath.value || previewFileName.value).replace(/\\/g, '/').split('/').pop() ?? '').trim()
  const dot = base.lastIndexOf('.')
  return dot > 0 ? base.slice(0, dot) : base
})

/**
 * 展开结果 **和** 落盘目标：都走 `src/fileTemplateCreate.ts` 那条真正会写盘的路径
 * （`file.create` + `file.write`），预览与写入不会分叉。
 */
const createPlan = computed(() => {
  if (!draft.value.content.trim()) return null
  const resolver = (name: string) => includable.value.find(item => item.name === name)?.content
  try {
    return planFileTemplateCreate({
      template: { name: draft.value.name.trim() || '新文件', extension: draft.value.extension, content: draft.value.content },
      directory: previewDirectory.value,
      fileName: previewStem.value,
      projectName: props.projectName,
      user: 'tao',
      now: PREVIEW_NOW,
      resolveInclude: resolver,
    })
  } catch { return null }
})

/** 落盘后的路径预览（宿主 `Workspace::create` 的 16 个内建 kind 仍按文件名词干当类名，`native/workspace.cpp:994-999`）。 */
const previewFileLabel = computed(() => createPlan.value?.path ?? previewStem.value)
const previewUnset = computed(() => createPlan.value?.unset ?? [])

function apply() {
  if (props.busy) return
  const problem = state.value.submit({ ...draft.value, name: draft.value.name.trim(), description: draft.value.description?.trim() })
  formError.value = problem ?? ''
  if (!problem) cancel()
}
function remove(template: UserFileTemplate) {
  if (props.busy) return
  state.value.remove(template.id)
  if (editingId.value === template.id) cancel()
}
function duplicate(template: UserFileTemplate) {
  if (props.busy) return
  const copy: UserFileTemplate = { ...template, id: blankDraft().id, name: `${template.name} 副本` }
  formError.value = state.value.submit(copy) ?? ''
}

// 切换方案时关掉正在编辑的表单：两个方案的模板表不是同一份。
watch(scope, cancel)
</script>

<template>
  <div class="ft-page">
    <div class="ft-toolbar">
      <select v-model="scope" class="ft-scope" aria-label="模板方案">
        <option v-for="item in scheme" :key="item.scope" :value="item.scope">{{ item.label }}</option>
      </select>
      <span class="ft-dir" :title="scopeDir">{{ scopeDir }}</span>
      <input v-model="query" class="ft-search" aria-label="搜索文件模板" placeholder="搜索名称、扩展名或内容…" spellcheck="false" />
      <button class="subtle-button" :disabled="busy" @click="startCreate"><Plus aria-hidden="true" :size="iconSize.menu" />新建模板</button>
    </div>

    <div class="ft-list" role="list" aria-label="文件模板列表">
      <div v-for="template in shown" :key="template.id" class="ft-row" role="listitem">
        <button class="ft-main" :title="template.content" :aria-label="`编辑文件模板 ${template.name}`" @click="startEdit(template)">
          <span class="ft-name">{{ templateQName(template.name, template.extension) || '（无扩展名）' }}</span>
          <span class="ft-desc">{{ template.description || '（无说明）' }}</span>
          <span class="ft-detail">{{ template.extension ? `.${template.extension}` : '无扩展名' }}</span>
        </button>
        <button class="icon-button" :disabled="busy" title="复制此模板" aria-label="复制模板" @click="duplicate(template)"><Copy :size="iconSize.menu" /></button>
        <button class="icon-button" :disabled="busy" title="编辑此模板" aria-label="编辑模板" @click="startEdit(template)"><Pencil :size="iconSize.menu" /></button>
        <button class="icon-button" :disabled="busy" title="删除此模板" aria-label="删除模板" @click="remove(template)"><Trash2 :size="iconSize.menu" /></button>
      </div>
      <p v-if="!shown.length" class="ft-empty">这个方案还没有用户模板。模板正文支持 <code>${VAR}</code>、<code>${'{'}DS{'}'}</code> 转义、<code>#if</code>、<code>#set</code> 与 <code>#parse("名称.扩展名")</code>。</p>
    </div>

    <form v-if="creating || editingId" class="ft-editor" @submit.prevent="apply">
      <div class="ft-fields">
        <label>名称<input v-model="draft.name" required maxlength="80" aria-label="模板名称" /></label>
        <label>扩展名<input v-model="draft.extension" maxlength="20" aria-label="模板扩展名" placeholder="java" /></label>
        <label>说明<input v-model="draft.description" maxlength="120" aria-label="模板说明" /></label>
      </div>
      <textarea v-model="draft.content" rows="8" required spellcheck="false" aria-label="模板正文" placeholder="#if (${PACKAGE_NAME} && ${PACKAGE_NAME} != &quot;&quot;)package ${PACKAGE_NAME};#end" />
      <p v-if="formError" class="ft-field-error" role="alert">{{ formError }}</p>
      <p v-else-if="diagnosis.level === 'error'" class="ft-field-error" role="alert">{{ diagnosis.text }}</p>
      <p v-else-if="diagnosis.level === 'warn'" class="ft-warn" role="status">{{ diagnosis.text }}</p>
      <p v-else-if="diagnosis.text" class="ft-slots" role="status">{{ diagnosis.text }}</p>

      <div class="ft-preview">
        <div class="ft-preview-head">
          <FileText :size="iconSize.menu" />
          <span>新建时会写到 <code>{{ previewFileLabel }}</code>，正文展开成下面这样</span>
        </div>
        <div class="ft-preview-inputs">
          <label>文件名<input v-model="previewFileName" aria-label="预览用文件名" /></label>
          <label>工作区相对路径<input v-model="previewPath" aria-label="预览用路径" /></label>
        </div>
        <pre class="ft-preview-body">{{ preview || '（还没有正文）' }}</pre>
        <p v-if="previewUnset.length" class="ft-preview-note" role="status">这些变量还没有值：{{ previewUnset.join('、') }}（展开时留空；上游在这里弹取值框）。</p>
        <p class="ft-hint">
          类别目录固定为 <code>{{ templatesDirFor('Default') }}</code>（上游 <code>FileTemplatesLoader.kt:146-152</code>）。
          <code>#parse</code> 只能引「{{ categoryInfo('Includes').label }}」类别里的模板
          （<code>VelocityWrapper.java:82</code> 走 <code>getPattern</code>）。
        </p>
      </div>

      <div class="ft-actions">
        <button type="submit" class="primary-button" :disabled="busy || diagnosis.level === 'error'">{{ busy ? '保存中…' : '保存模板' }}</button>
        <button type="button" class="subtle-button" :disabled="busy" @click="cancel">取消</button>
      </div>
    </form>

    <section class="ft-host">
      <h4>宿主内建的新建模板</h4>
      <p class="ft-hint">
        这 {{ HOST_FILE_TEMPLATE_KINDS.length }} 项由宿主 <code>native/workspace.cpp</code> 按 <code>template_kind</code> 直接生成内容
        （<code>workspace.cpp:998-1079</code>），不走模板正文 —— 它们与上面的用户模板是两条通道。
      </p>
      <ul class="ft-host-list">
        <li v-for="item in HOST_FILE_TEMPLATE_KINDS" :key="item.kind">
          <span class="ft-name">{{ item.label }}</span>
          <code>{{ item.kind }}</code>
        </li>
      </ul>
    </section>

    <p class="ft-hint">模板分组对应上游五个类别：{{ FILE_TEMPLATE_CATEGORIES.map(info => `${info.name}（${info.dir || '根'}）`).join('、') }}。用户模板一律落在 Default 类别。</p>
  </div>
</template>

<style scoped>
.ft-page { display: flex; flex-direction: column; gap: var(--space-2); min-height: 0; }
.ft-toolbar { display: flex; align-items: center; gap: var(--space-2); }
.ft-scope { min-height: var(--ctrl-height-lg); border: 1px solid var(--line-strong); border-radius: var(--radius-sm); background: var(--editor); color: var(--secondary); font-size: 11px; }
.ft-dir { flex: 0 1 auto; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: var(--muted); font: 10px var(--font-mono); }
.ft-search { flex: 1; min-width: 0; min-height: var(--ctrl-height-lg); padding: var(--space-1) var(--space-2); color: var(--text); background: var(--editor); border: 1px solid var(--line-strong); border-radius: var(--radius-sm); font-size: 12px; }
.ft-list { flex: 1; min-height: 100px; max-height: 200px; overflow: auto; border: 1px solid var(--line); border-radius: var(--radius-sm); background: var(--panel); }
.ft-row { display: flex; align-items: center; gap: var(--space-1); padding: 0 var(--space-1) 0 var(--space-2); border-bottom: 1px solid var(--line); transition: background-color var(--dur-1) var(--ease); }
.ft-row:last-child { border-bottom: 0; }
.ft-row:hover { background: var(--hover); }
.ft-main { flex: 1; min-width: 0; display: flex; align-items: baseline; gap: var(--space-2); padding: var(--space-1); border: 0; background: transparent; color: var(--text); text-align: left; cursor: pointer; }
.ft-name { font: 12px var(--font-mono); color: var(--accent); }
.ft-desc { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 12px; }
.ft-detail { margin-left: auto; flex-shrink: 0; color: var(--muted); font-size: 10px; }
.ft-empty { padding: var(--space-3); color: var(--muted); font-size: 11px; line-height: 1.7; }
.ft-empty code { font: 11px var(--font-mono); color: var(--secondary); }
.ft-editor { display: flex; flex-direction: column; gap: var(--space-2); padding: var(--space-2); border: 1px solid var(--line-strong); border-radius: var(--radius-md); background: var(--elevated); }
.ft-fields { display: flex; gap: var(--space-2); }
.ft-fields label { flex: 1; display: flex; flex-direction: column; gap: var(--space-1); color: var(--secondary); font-size: 11px; }
.ft-fields input, .ft-preview-inputs input { min-height: var(--ctrl-height); padding: var(--space-1) var(--space-2); color: var(--text); background: var(--editor); border: 1px solid var(--line-strong); border-radius: var(--radius-sm); font-size: 12px; }
.ft-editor textarea { width: 100%; min-width: 0; padding: var(--space-2); color: var(--text); background: var(--editor); border: 1px solid var(--line-strong); border-radius: var(--radius-sm); font: 12px/1.6 var(--font-mono); resize: vertical; }
.ft-field-error { margin: 0; color: var(--error); font-size: 11px; line-height: 1.6; overflow-wrap: anywhere; }
.ft-warn { margin: 0; color: var(--warning, var(--muted)); font-size: 11px; line-height: 1.6; overflow-wrap: anywhere; }
.ft-slots { margin: 0; color: var(--muted); font-size: 11px; line-height: 1.6; overflow-wrap: anywhere; }
.ft-hint { margin: 0; color: var(--muted); font-size: 11px; line-height: 1.7; overflow-wrap: anywhere; }
.ft-hint code { font: 11px var(--font-mono); color: var(--secondary); }
.ft-preview { display: flex; flex-direction: column; gap: var(--space-2); padding: var(--space-2); border: 1px solid var(--line); border-radius: var(--radius-sm); background: var(--panel); }
.ft-preview-head { display: flex; align-items: center; gap: var(--space-1); color: var(--secondary); font-size: 11px; }
.ft-preview-head code { font: 11px var(--font-mono); color: var(--accent); }
.ft-preview-inputs { display: flex; gap: var(--space-2); }
.ft-preview-note { margin: 0; color: var(--muted); font-size: 11px; line-height: 1.6; overflow-wrap: anywhere; }
.ft-preview-inputs label { flex: 1; display: flex; flex-direction: column; gap: var(--space-1); color: var(--muted); font-size: 10px; }
.ft-preview-body { max-height: 160px; margin: 0; padding: var(--space-2); overflow: auto; border: 1px solid var(--line); border-radius: var(--radius-sm); background: var(--editor); color: var(--text); font: 11px/1.6 var(--font-mono); white-space: pre-wrap; overflow-wrap: anywhere; }
.ft-actions { display: flex; gap: var(--space-2); }
.ft-host { display: flex; flex-direction: column; gap: var(--space-1); padding: var(--space-2); border: 1px solid var(--line); border-radius: var(--radius-sm); background: var(--panel); }
.ft-host h4 { margin: 0; color: var(--secondary); font-size: 11px; font-weight: 600; }
.ft-host-list { display: flex; flex-wrap: wrap; gap: var(--space-1) var(--space-2); margin: 0; padding: 0; list-style: none; }
.ft-host-list li { display: flex; align-items: baseline; gap: var(--space-1); }
.ft-host-list code { font: 10px var(--font-mono); color: var(--muted); }
</style>
