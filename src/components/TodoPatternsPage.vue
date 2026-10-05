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
import { MAX_TODO_FILTERS, saveTodoFilters, todoFilters, type TodoFilterRule } from '../todoFilters'
import { TODO_COLOR_FALLBACK } from '../todoView'
import { iconSize } from '../uiIcons'

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

// ── 命名过滤器（TodoConfiguration 的 myTodoFilters / `FilterDialog`；应用级，存 localStorage）──────────
// 过滤器 = 名字 + 一组**已保存的**标记模式。校验在保存时以 props.patterns 为准，
// 这样"模式还没保存就先建过滤器"会被明确拒绝，而不是留下一份引用不存在模式的过滤器。
const filterDraft = ref<TodoFilterRule[]>(todoFilters.value.map(rule => ({ name: rule.name, patterns: [...rule.patterns] })))
const filterSnapshot = ref(JSON.stringify(filterDraft.value))
const filterNote = ref('')
const filterDirty = computed(() => JSON.stringify(filterDraft.value) !== filterSnapshot.value)

function addFilter() {
  filterDraft.value = [...filterDraft.value, { name: '', patterns: [] }]
}
function dropFilter(index: number) {
  filterDraft.value = filterDraft.value.filter((_, position) => position !== index)
}
function toggleFilterPattern(filter: TodoFilterRule, pattern: string) {
  if (!pattern) return
  filter.patterns = filter.patterns.includes(pattern)
    ? filter.patterns.filter(item => item !== pattern)
    : [...filter.patterns, pattern]
}
function saveFilters() {
  if (props.busy) return
  const message = saveTodoFilters(filterDraft.value, props.patterns ?? [])
  if (message) { filterNote.value = message; return }
  filterDraft.value = todoFilters.value.map(rule => ({ name: rule.name, patterns: [...rule.patterns] }))
  filterSnapshot.value = JSON.stringify(filterDraft.value)
  filterNote.value = ''
}
function restoreFilters() {
  filterDraft.value = todoFilters.value.map(rule => ({ name: rule.name, patterns: [...rule.patterns] }))
  filterSnapshot.value = JSON.stringify(filterDraft.value)
  filterNote.value = ''
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
      <!-- IDEA 的 PatternTable：每行「模式 | 说明 | 颜色 | 区分大小写 | 删除」，下面是 Add / Remove。 -->
      <div class="tp-table" role="table" aria-label="TODO 模式">
        <div class="tp-head" role="row">
          <span role="columnheader">模式</span>
          <span role="columnheader">说明</span>
          <span role="columnheader" class="tp-center">颜色</span>
          <span role="columnheader" class="tp-center">区分大小写</span>
          <span role="columnheader" class="tp-center">删除</span>
        </div>
        <div v-for="(entry, index) in draft" :key="index" class="tp-row" role="row">
          <input v-model="entry.pattern" spellcheck="false" placeholder="TODO" :aria-label="`第 ${index + 1} 条标记`" />
          <input v-model="entry.description" spellcheck="false" placeholder="待办" :aria-label="`第 ${index + 1} 条说明`" />
          <!-- IDEA 的颜色列取自颜色方案（TodoPattern.getColor()）；本仓没有色板页，
               等价物是每条模式自带 #RRGGBB（未设置时工具窗口用中性色，不冒充方案色）。 -->
          <label class="tp-center">
            <input class="tp-color" type="color" :value="entry.color ?? TODO_COLOR_FALLBACK" :aria-label="`第 ${index + 1} 条颜色`" @input="entry.color = ($event.target as HTMLInputElement).value" />
          </label>
          <label class="tp-center">
            <input v-model="entry.caseSensitive" type="checkbox" :aria-label="`第 ${index + 1} 条区分大小写`" />
          </label>
          <button type="button" class="icon-button tp-center" title="删除此标记" :aria-label="`删除第 ${index + 1} 条标记`" @click="drop(index)"><Trash2 :size="iconSize.menu" /></button>
        </div>
        <p v-if="!draft.length" class="tp-empty">没有标记。</p>
      </div>
      <div class="tp-actions">
        <button type="button" class="subtle-button" :disabled="busy || draft.length >= MAX_TODO_PATTERNS" @click="add"><Plus :size="iconSize.menu" /> 添加标记</button>
        <button type="button" class="primary-button" :disabled="busy || !dirty" @click="save">保存 TODO 模式</button>
        <button type="button" class="subtle-button" :disabled="busy || !dirty" @click="fillFrom(props.patterns)">还原</button>
        <span class="tp-note">{{ note || (dirty ? '有未保存的改动' : '已与项目同步') }}</span>
      </div>
      <p v-if="duplicates.length" class="tp-error" role="alert">标记重复：{{ duplicates.join('、') }}</p>
      <p class="field-hint">「区分大小写」对应 IDEA <code>TodoPattern.isCaseSensitive()</code>（模式表的对应列），关闭时按不区分大小写匹配。</p>

      <!-- IDEA 的过滤器表（TodoConfiguration 的 myTodoFilters + `FilterDialog`）：一个名字 + 一组标记。 -->
      <section class="tp-filters" aria-labelledby="tp-filters-title">
        <h3 id="tp-filters-title" class="tp-subhead">过滤器</h3>
        <p class="field-hint">「TODO」工具窗口的过滤器下拉选中一个过滤器后，只留下属于它的标记（IDEA 的 <code>TodoFilter</code>）；过滤器是应用级设置，随本机保存。</p>
        <div v-for="(filter, index) in filterDraft" :key="index" class="tp-filter-row">
          <input v-model="filter.name" spellcheck="false" placeholder="过滤器名" :aria-label="`第 ${index + 1} 个过滤器名字`" />
          <div class="tp-filter-patterns" role="group" :aria-label="`第 ${index + 1} 个过滤器的标记`">
            <label v-for="pattern in draft" :key="pattern.pattern" class="tp-filter-pattern" :class="{ disabled: !pattern.pattern }">
              <input type="checkbox" :checked="!!pattern.pattern && filter.patterns.includes(pattern.pattern)" :disabled="!pattern.pattern" @change="toggleFilterPattern(filter, pattern.pattern)" />
              <span>{{ pattern.description || pattern.pattern || '（未命名）' }}</span>
            </label>
            <span v-if="!draft.length" class="tp-empty">先在模式表里定义标记。</span>
          </div>
          <button type="button" class="icon-button" title="删除此过滤器" :aria-label="`删除第 ${index + 1} 个过滤器`" @click="dropFilter(index)"><Trash2 :size="iconSize.menu" /></button>
        </div>
        <p v-if="!filterDraft.length" class="tp-empty">没有过滤器。</p>
        <div class="tp-actions">
          <button type="button" class="subtle-button" :disabled="busy || filterDraft.length >= MAX_TODO_FILTERS" @click="addFilter"><Plus :size="iconSize.menu" /> 添加过滤器</button>
          <button type="button" class="primary-button" :disabled="busy || !filterDirty" @click="saveFilters">保存过滤器</button>
          <button type="button" class="subtle-button" :disabled="busy || !filterDirty" @click="restoreFilters">还原</button>
          <span class="tp-note">{{ filterNote || (filterDirty ? '有未保存的改动' : '已保存') }}</span>
        </div>
      </section>
    </template>
  </div>
</template>

<style scoped>
.tp-panel { display: flex; flex-direction: column; gap: var(--space-3); }
.tp-table { display: flex; flex-direction: column; border: 1px solid var(--line); border-radius: var(--radius-sm); background: var(--editor); overflow: hidden; }
.tp-head, .tp-row { display: grid; grid-template-columns: 1.1fr 1.4fr 40px 92px 48px; align-items: center; gap: var(--space-2); padding: var(--space-1) var(--space-2); }
.tp-head { color: var(--muted); font-size: 11px; border-bottom: 1px solid var(--line); background: var(--panel); }
.tp-row { border-bottom: 1px solid var(--line); }
.tp-row:last-child { border-bottom: 0; }
.tp-row input[type='text'], .tp-row input:not([type]) { min-width: 0; min-height: var(--ctrl-height-sm); padding: var(--space-1) var(--space-2); color: var(--text); background: var(--editor); border: 1px solid var(--line-strong); border-radius: var(--radius-xs); font: 12px/1.5 var(--font-mono); }
.tp-center { display: flex; justify-content: center; }
.tp-color { width: 26px; height: 20px; padding: 0; border: 1px solid var(--line-strong); border-radius: var(--radius-xs); background: var(--editor); }
.tp-empty { margin: 0; padding: var(--space-2); color: var(--muted); font-size: 11px; }
.tp-actions { display: flex; align-items: center; gap: var(--space-2); }
.tp-note { color: var(--muted); font-size: 11px; }
.tp-error { margin: 0; color: var(--error); font-size: 11px; }
/* 过滤器表（TodoConfiguration.myTodoFilters）：名字一栏 + 标记勾选一栏 + 删除。 */
.tp-subhead { margin: 0; font-size: 12px; color: var(--text); }
.tp-filters { display: flex; flex-direction: column; gap: var(--space-2); border-top: 1px solid var(--line); padding-top: var(--space-3); }
.tp-filter-row { display: grid; grid-template-columns: 150px 1fr 32px; align-items: start; gap: var(--space-2); }
.tp-filter-row > input { min-width: 0; min-height: var(--ctrl-height-sm); padding: var(--space-1) var(--space-2); color: var(--text); background: var(--editor); border: 1px solid var(--line-strong); border-radius: var(--radius-xs); font-size: 12px; }
.tp-filter-patterns { display: flex; flex-wrap: wrap; gap: var(--space-1) var(--space-3); min-height: var(--ctrl-height-sm); align-items: center; }
.tp-filter-pattern { display: inline-flex; align-items: center; gap: var(--space-1); color: var(--secondary); font-size: 11px; }
.tp-filter-pattern.disabled { color: var(--muted); }
</style>
