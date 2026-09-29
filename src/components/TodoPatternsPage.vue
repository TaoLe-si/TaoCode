<script setup lang="ts">
// 设置 › 编辑器 › TODO（IDEA `preferences.toDoOptions`，`TodoConfigurable`）。
//
// 注册证据：platform/todo/resources/intellij.platform.todo.xml:49
//   `<applicationConfigurable groupId="editor" instance="com.intellij.ide.todo.configurable.TodoConfigurable"
//     id="preferences.toDoOptions" key="title.todo" bundle="messages.IdeBundle"/>`
// —— groupId="editor"，所以这一页属于**编辑器**，不是项目结构（此前放在「项目结构」页里是本批修正的错位）。
//
// 模式表的每一行是 `模式 + 区分大小写 + 颜色`（`TodoPattern.java` / `TodoConfigurable` 的
// PatternTable）。TaoCode 的 TODO 索引是 `src/todoTree.ts` 按正则扫描，`caseSensitive` 已全链路；
// 颜色列需要颜色方案支持，登记在 docs/class-parity-todo.md（本仓没有色板页），不造假控件。
import { computed, ref, watch } from 'vue'
import { Plus, Trash2 } from 'lucide-vue-next'
import type { TodoPattern } from '../bridge'
import { MAX_TODO_PATTERNS, duplicateTodoPatterns, validateTodoPatterns } from '../todoPatterns'

const props = defineProps<{ patterns: TodoPattern[] | null; busy: boolean }>()
const emit = defineEmits<{ save: [patterns: TodoPattern[]] }>()

const draft = ref<TodoPattern[]>([])
const snapshot = ref('')
const note = ref('')

const shape = () => JSON.stringify(draft.value)
const dirty = computed(() => shape() !== snapshot.value)

function fillFrom(source: TodoPattern[] | null) {
  draft.value = (source ?? []).map(entry => ({ ...entry }))
  snapshot.value = shape()
  note.value = ''
}
watch(() => props.patterns, fillFrom, { immediate: true })

const duplicates = computed(() => duplicateTodoPatterns(draft.value))
// 规则来自 src/todoPatterns.ts（与原生 validate_todo_patterns 同一套）。
const problem = computed(() => validateTodoPatterns(draft.value))

function add() {
  draft.value = [...draft.value, { pattern: '', description: '' }]
}
function drop(index: number) {
  draft.value = draft.value.filter((_, position) => position !== index)
}
function save() {
  if (props.busy) return
  if (problem.value) { note.value = problem.value; return }
  emit('save', draft.value.map(entry => ({ ...entry })))
  snapshot.value = shape()
  note.value = ''
}
</script>

<template>
  <div class="tp-panel">
    <p class="section-description">
      对应 IDEA Settings › Editor › TODO（<code>TodoConfigurable</code>）：这里定义的标记会出现在
      「TODO」工具窗口、提交前 TODO 检查与搜索里。
    </p>
    <p v-if="!patterns" class="section-description">尚未打开项目。TODO 模式随项目保存，请先打开一个项目。</p>
    <template v-else>
      <!-- IDEA 的 PatternTable：每行「模式 | 区分大小写」，下面是 Add / Remove。 -->
      <div class="tp-table" role="table" aria-label="TODO 模式">
        <div class="tp-head" role="row">
          <span role="columnheader">模式</span>
          <span role="columnheader">说明</span>
          <span role="columnheader" class="tp-center">区分大小写</span>
          <span role="columnheader" class="tp-center">删除</span>
        </div>
        <div v-for="(entry, index) in draft" :key="index" class="tp-row" role="row">
          <input v-model="entry.pattern" spellcheck="false" placeholder="TODO" :aria-label="`第 ${index + 1} 条标记`" />
          <input v-model="entry.description" spellcheck="false" placeholder="待办" :aria-label="`第 ${index + 1} 条说明`" />
          <label class="tp-center">
            <input v-model="entry.caseSensitive" type="checkbox" :aria-label="`第 ${index + 1} 条区分大小写`" />
          </label>
          <button type="button" class="icon-button tp-center" :aria-label="`删除第 ${index + 1} 条标记`" @click="drop(index)"><Trash2 :size="13" /></button>
        </div>
        <p v-if="!draft.length" class="tp-empty">没有标记。</p>
      </div>
      <div class="tp-actions">
        <button type="button" class="subtle-button" :disabled="busy || draft.length >= MAX_TODO_PATTERNS" @click="add"><Plus :size="13" /> 添加标记</button>
        <button type="button" class="primary-button" :disabled="busy || !dirty" @click="save">保存 TODO 模式</button>
        <button type="button" class="subtle-button" :disabled="busy || !dirty" @click="fillFrom(props.patterns)">还原</button>
        <span class="tp-note">{{ note || (dirty ? '有未保存的改动' : '已与项目同步') }}</span>
      </div>
      <p v-if="duplicates.length" class="tp-error" role="alert">标记重复：{{ duplicates.join('、') }}</p>
      <p class="field-hint">「区分大小写」对应 IDEA <code>TodoPattern.isCaseSensitive()</code>（模式表的对应列），关闭时按不区分大小写匹配。</p>
    </template>
  </div>
</template>

<style scoped>
.tp-panel { display: flex; flex-direction: column; gap: var(--space-3); }
.tp-table { display: flex; flex-direction: column; border: 1px solid var(--line); border-radius: var(--radius-sm); background: var(--editor); overflow: hidden; }
.tp-head, .tp-row { display: grid; grid-template-columns: 1.1fr 1.4fr 92px 48px; align-items: center; gap: var(--space-2); padding: var(--space-1) var(--space-2); }
.tp-head { color: var(--muted); font-size: 11px; border-bottom: 1px solid var(--line); background: var(--panel); }
.tp-row { border-bottom: 1px solid var(--line); }
.tp-row:last-child { border-bottom: 0; }
.tp-row input[type='text'], .tp-row input:not([type]) { min-width: 0; min-height: var(--ctrl-height-sm); padding: var(--space-1) var(--space-2); color: var(--text); background: var(--editor); border: 1px solid var(--line-strong); border-radius: var(--radius-xs); font: 12px/1.5 var(--font-mono); }
.tp-center { display: flex; justify-content: center; }
.tp-empty { margin: 0; padding: var(--space-2); color: var(--muted); font-size: 11px; }
.tp-actions { display: flex; align-items: center; gap: var(--space-2); }
.tp-note { color: var(--muted); font-size: 11px; }
.tp-error { margin: 0; color: var(--error); font-size: 11px; }
</style>
