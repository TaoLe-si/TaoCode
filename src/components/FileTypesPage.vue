<script setup lang="ts">
// 设置 › 编辑器 › 文件类型（IDEA `preferences.fileTypes`，`FileTypeConfigurable`）。
//
// 注册证据：platform/lang-impl/resources/intellij.platform.lang.impl.xml:992-994
//   `<applicationConfigurable groupId="editor" groupWeight="120"
//     instance="com.intellij.openapi.fileTypes.impl.FileTypeConfigurable"
//     id="preferences.fileTypes" key="filetype.settings.title" bundle="messages.FileTypesBundle"/>`
// —— groupId="editor"，所以它属于**编辑器**（此前这条设置没有设置页入口，只能在文件树/标签页右键改，
// 本批补上页内编辑）。
//
// IDEA 的 File Types 页是「已识别文件类型列表 + 每种类型的注册模式」。TaoCode 的等价模型是
// `扩展名 → 语言`（`ProjectSettings.fileAssociations`，消费点是编辑器语法与语言服务器），
// 所以这里就是一张 扩展名 → 语言 的表；右键菜单「关联文件类型」写的是同一份数据。
import { computed, ref, watch } from 'vue'
import { Plus, Trash2 } from 'lucide-vue-next'
import { EDITOR_LANGUAGES } from '../bridge'
import { associationsFromRows, rowsFromAssociations, validExtension, validateFileAssociations } from '../fileTypes'

const props = defineProps<{ associations: Record<string, string> | null; busy: boolean }>()
const emit = defineEmits<{ save: [associations: Record<string, string>] }>()

type Row = { extension: string; language: string }

const LANGUAGE_LABELS: Record<string, string> = { java: 'Java', cpp: 'C++', typescript: 'TypeScript', other: '纯文本' }

const rows = ref<Row[]>([])
const snapshot = ref('')
const note = ref('')

const shape = () => JSON.stringify(rows.value)
const dirty = computed(() => shape() !== snapshot.value)

function fillFrom(source: Record<string, string> | null) {
  rows.value = rowsFromAssociations(source)
  snapshot.value = shape()
  note.value = ''
}
watch(() => props.associations, fillFrom, { immediate: true })

// 校验与原生 `validate_file_associations` 同规则（src/fileTypes.ts）。
const invalidExtension = (value: string) => !validExtension(value.trim())
const duplicates = computed(() => {
  const seen = new Map<string, number>()
  for (const row of rows.value) seen.set(row.extension, (seen.get(row.extension) ?? 0) + 1)
  return [...seen.entries()].filter(([, count]) => count > 1).map(([extension]) => extension)
})
const problem = computed(() => validateFileAssociations(associationsFromRows(rows.value)))

function add() { rows.value = [...rows.value, { extension: '', language: 'other' }] }
function drop(index: number) { rows.value = rows.value.filter((_, position) => position !== index) }
function save() {
  if (props.busy) return
  if (problem.value) { note.value = problem.value; return }
  emit('save', associationsFromRows(rows.value))
  snapshot.value = shape()
  note.value = ''
}
</script>

<template>
  <div class="ft-panel">
    <p class="section-description">
      对应 IDEA Settings › Editor › File Types（<code>FileTypeConfigurable</code>）：这里决定的关联同时用于编辑器语法高亮、
      语言服务器选择与文件树图标。没被关联的扩展名按内容与其他规则识别。
    </p>
    <p v-if="!associations" class="section-description">尚未打开项目。文件类型关联随项目保存，请先打开一个项目。</p>
    <template v-else>
      <div class="ft-table" role="table" aria-label="文件类型关联">
        <div class="ft-head" role="row"><span role="columnheader">扩展名</span><span role="columnheader">语言</span><span role="columnheader" class="ft-center">删除</span></div>
        <div v-for="(row, index) in rows" :key="index" class="ft-row" role="row">
          <label class="ft-ext"><span class="ft-dot">*.</span><input v-model="row.extension" spellcheck="false" :aria-label="`第 ${index + 1} 个扩展名`" :aria-invalid="invalidExtension(row.extension)" placeholder="conf" /></label>
          <select v-model="row.language" :aria-label="`第 ${index + 1} 个扩展名的语言`">
            <option v-for="language in EDITOR_LANGUAGES" :key="language" :value="language">{{ LANGUAGE_LABELS[language] }}</option>
          </select>
          <button type="button" class="icon-button ft-center" :aria-label="`删除第 ${index + 1} 条关联`" @click="drop(index)"><Trash2 :size="13" /></button>
        </div>
        <p v-if="!rows.length" class="ft-empty">没有关联，全部按扩展名与内容自动识别。</p>
      </div>
      <div class="ft-actions">
        <button type="button" class="subtle-button" :disabled="busy" @click="add"><Plus :size="13" /> 添加关联</button>
        <button type="button" class="primary-button" :disabled="busy || !dirty" @click="save">保存关联</button>
        <button type="button" class="subtle-button" :disabled="busy || !dirty" @click="fillFrom(props.associations)">还原</button>
        <span class="ft-note">{{ note || (dirty ? '有未保存的改动' : '已与项目同步') }}</span>
      </div>
      <p v-if="duplicates.length" class="ft-error" role="alert">扩展名重复：{{ duplicates.join('、') }}</p>
      <p class="field-hint">也可以在文件树或标签页上右键「关联文件类型…」为当前文件的扩展名一键设置，两处写的是同一份数据。</p>
    </template>
  </div>
</template>

<style scoped>
.ft-panel { display: flex; flex-direction: column; gap: var(--space-3); }
.ft-table { display: flex; flex-direction: column; border: 1px solid var(--line); border-radius: var(--radius-sm); background: var(--editor); overflow: hidden; }
.ft-head, .ft-row { display: grid; grid-template-columns: 1.2fr 1fr 48px; align-items: center; gap: var(--space-2); padding: var(--space-1) var(--space-2); }
.ft-head { color: var(--muted); font-size: 11px; border-bottom: 1px solid var(--line); background: var(--panel); }
.ft-row { border-bottom: 1px solid var(--line); }
.ft-row:last-child { border-bottom: 0; }
.ft-ext { display: flex; align-items: center; gap: 2px; min-width: 0; }
.ft-dot { color: var(--muted); font: 12px var(--font-mono); }
.ft-ext input { flex: 1; min-width: 0; min-height: var(--ctrl-height-sm); padding: var(--space-1) var(--space-2); color: var(--text); background: var(--editor); border: 1px solid var(--line-strong); border-radius: var(--radius-xs); font: 12px/1.5 var(--font-mono); }
.ft-ext input[aria-invalid='true'] { border-color: var(--error); }
.ft-center { display: flex; justify-content: center; }
.ft-empty { margin: 0; padding: var(--space-2); color: var(--muted); font-size: 11px; }
.ft-actions { display: flex; align-items: center; gap: var(--space-2); }
.ft-note { color: var(--muted); font-size: 11px; }
.ft-error { margin: 0; color: var(--error); font-size: 11px; }
</style>
