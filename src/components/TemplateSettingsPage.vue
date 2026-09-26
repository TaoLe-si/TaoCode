<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { Pencil, Plus, Trash2 } from 'lucide-vue-next'
import { templatePattern, customPattern, templates as builtinLive, postfixTemplates as builtinPostfix, type CustomTemplate, type TemplateSettings } from '../templates'

const props = defineProps<{ settings: TemplateSettings; language: string; busy: boolean }>()
const emit = defineEmits<{ change: [settings: TemplateSettings] }>()

const query = ref('')
const scope = ref('all')
const editing = ref<CustomTemplate | null>(null)
const creating = ref(false)
const submitted = ref<CustomTemplate | null>(null)

type Row = { pattern: string; key: string; description: string; detail: string; body: string; languages: string[]; custom: boolean; disabled: boolean }

const isDisabled = (settings: TemplateSettings, pattern: string) => settings.overrides.some(entry => entry.pattern === pattern && entry.disabled)

const rows = computed<Row[]>(() => {
  const usable = (languages: string[]) => scope.value === 'all' || languages.length === 0 || languages.includes(scope.value)
  const builtins: Row[] = [...builtinLive, ...builtinPostfix].filter(template => usable(template.languages)).map(template => ({
    pattern: templatePattern(template), key: template.key, description: template.description,
    detail: template.postfix ? '后置 · ' + template.languages.join('/') : '关键字 · ' + template.languages.join('/'),
    body: template.body, languages: template.languages, custom: false,
    disabled: isDisabled(props.settings, templatePattern(template)),
  }))
  const customs: Row[] = props.settings.customs.filter(template => usable(template.languages)).map(template => ({
    pattern: customPattern(template), key: template.key, description: template.description,
    detail: '自定义 · ' + (template.languages.join('/') || '所有语言'), body: template.body,
    languages: template.languages, custom: true,
    disabled: isDisabled(props.settings, customPattern(template)),
  }))
  return [...builtins, ...customs]
})

const shown = computed(() => {
  const needle = query.value.trim().toLowerCase()
  if (!needle) return rows.value
  return rows.value.filter(row => row.key.toLowerCase().includes(needle) || row.description.toLowerCase().includes(needle) || row.body.toLowerCase().includes(needle))
})

const draft = ref<CustomTemplate>({ key: '', body: '', description: '', languages: [] })
const encoder = new TextEncoder()
// Exactly what src/templates.ts `render()` recognises: $END$, $EXPR$ and any
// $NAME$ or $NAME:默认值$ slot become caret stops, everything else stays literal.
const VARIABLE = /\$(END|EXPR|[A-Za-z_][A-Za-z0-9_]*)(?::([^$\n]*))?\$/g
// The same grammar seen from the inside: everything but END/EXPR that is not a bare
// identifier (or `identifier:default`) never becomes a slot.
const SLOT_SYNTAX = /^(?:END|EXPR|[A-Za-z_][A-Za-z0-9_]*)(?::[^$\n]*)?$/
const KEY_RULE = /^[A-Za-z][A-Za-z0-9]*$/
const duplicateKey = computed(() => props.settings.customs.some(custom => custom.key === draft.value.key.trim() && custom.key !== editing.value?.key))
const keyError = computed(() => {
  const key = draft.value.key.trim()
  if (!key) return '缩写不能为空。'
  if (!KEY_RULE.test(key)) return '缩写只能以字母开头，且只含字母和数字（例如 myloop）。'
  if (duplicateKey.value) return '此缩写已存在，请使用不同名称。'
  return ''
})
const descriptionError = computed(() => {
  const description = draft.value.description.trim()
  if (!description) return '说明不能为空。'
  if (encoder.encode(description).length > 120) return '说明过长：请控制在 120 字节以内。'
  return ''
})
const bodyError = computed(() => {
  if (!draft.value.body.trim()) return '模板内容不能为空。'
  if (encoder.encode(draft.value.body).length > 8000) return '模板内容过长：请控制在 8000 字节以内。'
  return ''
})
const capacityError = computed(() => editing.value !== null || props.settings.customs.length < 100
  ? '' : '自定义模板最多 100 条，请先删除不再使用的条目。')
const validDraft = computed(() => !keyError.value && !descriptionError.value && !bodyError.value && !capacityError.value)
// Slots the engine will turn into tab stops, in the order they appear.
const slots = computed(() => [...draft.value.body.matchAll(VARIABLE)]
  .map(match => match[1] === 'END' ? '' : match[1] === 'EXPR' ? 'EXPR（后置模板表达式）' : match[1])
  .filter((name, index, list) => name && list.indexOf(name) === index))
// `$...$` runs that look like a slot but do not match the grammar above stay in the
// expanded text as-is; they are listed so nobody wonders why nothing was replaced.
const unresolved = computed(() => {
  const body = draft.value.body
  const bad: string[] = []
  let index = 0
  while (index < body.length) {
    const start = body.indexOf('$', index)
    if (start < 0) break
    const end = body.indexOf('$', start + 1)
    const lineEnd = body.indexOf('\n', start)
    if (end < 0 || (lineEnd >= 0 && lineEnd < end)) { index = (lineEnd < 0 ? body.length : lineEnd) + 1; continue }
    const raw = body.slice(start + 1, end)
    if (!SLOT_SYNTAX.test(raw)) bad.push(`$${raw}$`)
    index = end + 1
  }
  return [...new Set(bad)]
})
watch(() => props.settings, settings => {
  const entry = submitted.value
  if (entry && settings.customs.some(custom => custom.key === entry.key && custom.body === entry.body
    && custom.description === entry.description && JSON.stringify(custom.languages) === JSON.stringify(entry.languages))) cancel()
})

function toggle(row: Row) {
  if (props.busy) return
  const overrides = props.settings.overrides.filter(entry => entry.pattern !== row.pattern)
  if (!row.disabled) overrides.push({ pattern: row.pattern, disabled: true })
  emit('change', { overrides, customs: props.settings.customs })
}
function remove(row: Row) {
  if (props.busy) return
  emit('change', {
    overrides: props.settings.overrides.filter(entry => entry.pattern !== row.pattern),
    customs: props.settings.customs.filter(custom => custom.key !== row.key),
  })
}
function startCreate() {
  draft.value = { key: '', body: '', description: '', languages: [props.language === 'other' ? 'other' : props.language] }
  editing.value = null
  creating.value = true
}
function startEdit(row: Row) {
  if (!row.custom) return
  draft.value = { key: row.key, body: row.body, description: row.description, languages: [...row.languages] }
  creating.value = false
  editing.value = props.settings.customs.find(custom => custom.key === row.key) ?? null
}
function cancel() { creating.value = false; editing.value = null; submitted.value = null }
function applyDraft() {
  if (!validDraft.value || props.busy) return
  const entry: CustomTemplate = { key: draft.value.key.trim(), body: draft.value.body, description: draft.value.description.trim(), languages: [...draft.value.languages] }
  const previous = editing.value
  const others = props.settings.customs.filter(custom => custom.key !== previous?.key)
  const overrides = props.settings.overrides.map(override => previous && override.pattern === customPattern(previous)
    ? { ...override, pattern: customPattern(entry) } : override)
  submitted.value = entry
  emit('change', { overrides, customs: [...others, entry] })
}
function toggleLanguage(language: string) {
  const list = draft.value.languages.includes(language) ? draft.value.languages.filter(item => item !== language) : [...draft.value.languages, language]
  draft.value = { ...draft.value, languages: list }
}
</script>

<template>
  <div class="lt-page">
    <div class="lt-toolbar">
      <input v-model="query" class="lt-search" aria-label="搜索模板" placeholder="搜索缩写、说明或内容…" spellcheck="false" />
      <select v-model="scope" class="lt-scope" aria-label="模板语言范围">
        <option value="all">所有语言</option><option v-for="name in ['java', 'cpp', 'typescript', 'other']" :key="name" :value="name">{{ name }}</option>
      </select>
      <button class="subtle-button" :disabled="busy || settings.customs.length >= 100" @click="startCreate"><Plus :size="13" />新建模板</button>
    </div>
    <div class="lt-list" role="list" aria-label="实时模板列表">
      <div v-for="row in shown" :key="row.pattern" class="lt-row" :class="{ 'lt-off': row.disabled }" role="listitem">
        <label class="lt-check"><input type="checkbox" :disabled="busy" :checked="!row.disabled" :aria-label="`启用模板 ${row.key}`" @change="toggle(row)" /></label>
        <!-- Only custom rows are editable, so only they get a button; a built-in row
             is a plain caption instead of something that looks clickable but isn't. -->
        <button v-if="row.custom" class="lt-main" :disabled="busy" :title="row.body" :aria-label="`编辑自定义模板 ${row.key}`" @click="startEdit(row)">
          <span class="lt-key">{{ row.key }}</span>
          <span class="lt-desc">{{ row.description }}</span>
          <span class="lt-detail">{{ row.detail }}</span>
        </button>
        <span v-else class="lt-main lt-builtin" :title="row.body">
          <span class="lt-key">{{ row.key }}</span>
          <span class="lt-desc">{{ row.description }}</span>
          <span class="lt-detail">{{ row.detail }}</span>
        </span>
        <button v-if="row.custom" :disabled="busy" class="icon-button" title="编辑自定义模板" aria-label="编辑模板" @click="startEdit(row)"><Pencil :size="13" /></button>
        <button v-if="row.custom" :disabled="busy" class="icon-button" title="删除自定义模板" aria-label="删除模板" @click="remove(row)"><Trash2 :size="13" /></button>
      </div>
      <p v-if="!shown.length" class="lt-empty">没有匹配的模板。</p>
    </div>
    <form v-if="creating || editing" class="lt-editor" @submit.prevent="applyDraft">
      <div class="lt-fields">
        <label>缩写<input v-model="draft.key" required pattern="[A-Za-z][A-Za-z0-9]*" maxlength="40" aria-label="模板缩写" :aria-invalid="Boolean(keyError)" /></label>
        <label>说明<input v-model="draft.description" required maxlength="120" aria-label="模板说明" :aria-invalid="Boolean(descriptionError)" /></label>
      </div>
      <p v-if="keyError" class="lt-field-error" role="alert">{{ keyError }}</p>
      <p v-else-if="descriptionError" class="lt-field-error" role="alert">{{ descriptionError }}</p>
      <p v-else-if="capacityError" class="lt-field-error" role="alert">{{ capacityError }}</p>
      <div class="lt-langs">
        <span>适用语言</span>
        <label v-for="language in ['java', 'cpp', 'typescript', 'other']" :key="language" class="lt-lang">
          <input type="checkbox" :checked="draft.languages.includes(language)" @change="toggleLanguage(language)" /><span>{{ language }}</span>
        </label>
        <em>全不选表示所有语言；启用时覆盖适用语言的同名关键字模板。</em>
      </div>
      <textarea v-model="draft.body" rows="6" required maxlength="8000" spellcheck="false" aria-label="模板内容" :aria-invalid="Boolean(bodyError)" placeholder="用 $NAME$ / $NAME:默认值$ / $END$ 标记槽位" />
      <p v-if="bodyError" class="lt-field-error" role="alert">{{ bodyError }}</p>
      <p v-else-if="slots.length" class="lt-slots" role="status">插入后可用 Tab 依次跳转的槽位：{{ slots.join('、') }}。</p>
      <p v-else class="lt-slots" role="status">没有槽位：展开后会原样插入这段文本，光标停在末尾。</p>
      <p v-if="unresolved.length" class="lt-field-error" role="alert">这些写法不是槽位，展开时会原样输出：{{ unresolved.slice(0, 4).join(' 、 ') }}{{ unresolved.length > 4 ? ' …' : '' }}。正确写法是 $NAME$ 或 $NAME:默认值$；引擎没有转义机制，文本里真正需要的美元符号请改用描述性写法。</p>
      <div class="lt-actions">
        <button type="submit" class="primary-button" :disabled="busy || !validDraft">{{ busy ? '保存中…' : '保存模板' }}</button>
        <button type="button" class="subtle-button" :disabled="busy" @click="cancel">取消</button>
      </div>
    </form>
  </div>
</template>

<style scoped>
.lt-page { display: flex; flex-direction: column; gap: var(--space-2); min-height: 0; }
.lt-toolbar { display: flex; align-items: center; gap: var(--space-2); }
.lt-search { flex: 1; min-width: 0; min-height: var(--ctrl-height-lg); padding: var(--space-1) var(--space-2); color: var(--text); background: var(--editor); border: 1px solid var(--line-strong); border-radius: var(--radius-sm); font-size: 12px; }
.lt-scope { min-height: var(--ctrl-height-lg); border: 1px solid var(--line-strong); border-radius: var(--radius-sm); background: var(--editor); color: var(--secondary); font-size: 11px; }
.lt-list { flex: 1; min-height: 120px; max-height: 240px; overflow: auto; border: 1px solid var(--line); border-radius: var(--radius-sm); background: var(--panel); }
.lt-row { display: flex; align-items: center; gap: var(--space-1); padding: 0 var(--space-1) 0 var(--space-2); border-bottom: 1px solid var(--line); }
.lt-row:last-child { border-bottom: 0; }
.lt-row:hover { background: var(--hover); }
.lt-check { display: flex; align-items: center; }
.lt-check input { width: 13px; height: 13px; margin: 0; accent-color: var(--accent); }
.lt-main { flex: 1; min-width: 0; display: flex; align-items: baseline; gap: var(--space-2); padding: var(--space-1) var(--space-1); border: 0; background: transparent; color: var(--text); text-align: left; cursor: default; }
.lt-main[disabled] { opacity: 1; }
.lt-builtin { cursor: default; }
.lt-field-error { margin: 0; color: var(--error); font-size: 11px; line-height: 1.6; overflow-wrap: anywhere; }
.lt-slots { margin: 0; color: var(--muted); font-size: 11px; line-height: 1.6; overflow-wrap: anywhere; }
.lt-key { font: 12px var(--font-mono); color: var(--accent); }
.lt-desc { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 12px; }
.lt-detail { margin-left: auto; flex-shrink: 0; color: var(--muted); font-size: 10px; }
.lt-off .lt-key, .lt-off .lt-desc { color: var(--muted); text-decoration: line-through; }
.lt-empty { padding: var(--space-3); color: var(--muted); font-size: 11px; }
.lt-editor { display: flex; flex-direction: column; gap: var(--space-2); padding: var(--space-2); border: 1px solid var(--line-strong); border-radius: var(--radius-md); background: var(--elevated); }
.lt-fields { display: flex; gap: var(--space-2); }
.lt-fields label { flex: 1; display: flex; flex-direction: column; gap: var(--space-1); color: var(--secondary); font-size: 11px; }
.lt-fields input { min-height: var(--ctrl-height); padding: var(--space-1) var(--space-2); color: var(--text); background: var(--editor); border: 1px solid var(--line-strong); border-radius: var(--radius-sm); font-size: 12px; }
.lt-langs { display: flex; align-items: center; flex-wrap: wrap; gap: var(--space-2); color: var(--secondary); font-size: 11px; }
.lt-langs > span { color: var(--muted); }
.lt-lang { display: flex; align-items: center; gap: var(--space-1); }
.lt-lang input { width: 12px; height: 12px; margin: 0; accent-color: var(--accent); }
.lt-langs em { color: var(--muted); font-style: normal; font-size: 10px; }
.lt-editor textarea { width: 100%; min-width: 0; padding: var(--space-2); color: var(--text); background: var(--editor); border: 1px solid var(--line-strong); border-radius: var(--radius-sm); font: 12px/1.6 var(--font-mono); resize: vertical; }
.lt-actions { display: flex; gap: var(--space-2); }
</style>
