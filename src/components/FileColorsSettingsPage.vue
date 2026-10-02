<script setup lang="ts">
// FileColorsConfigurable.kt:63-99, 118-121, 304-344; appearance groupWeight=112.
import { computed, nextTick, ref, watch } from 'vue'
import { ArrowDown, ArrowUp, ChevronRight, Plus, Minus } from 'lucide-vue-next'
import type { NamedScopeSetting } from '../bridge'
import { FILE_COLOR_NAMES, fileColorCss, isFileColorName, type FileColorSetting } from '../fileColors'
import ColorChooserDialog from './ColorChooserDialog.vue'
import { iconSize } from '../uiIcons'

const props = defineProps<{
  fileColors: FileColorSetting[]
  localColors: FileColorSetting[]
  scopes: NamedScopeSetting[]
  root: string | null
  busy: boolean
  enabled: boolean
  forTabs: boolean
  forProjectView: boolean
}>()
const emit = defineEmits<{
  'update:enabled': [value: boolean]
  'update:forTabs': [value: boolean]
  'update:forProjectView': [value: boolean]
  manageScopes: []
}>()
interface ColorRow extends FileColorSetting { shared: boolean }
const draft = ref<ColorRow[]>([])
const selected = ref(-1)
const adding = ref(false)
const addButton = ref<HTMLButtonElement>()
const addingScope = ref('')
const chooser = ref<{ initial: string; scope: string; entry?: ColorRow } | null>(null)
function getDraft() {
  const entries = (shared: boolean) => draft.value.filter(entry => entry.shared === shared)
    .map(({ scope, color }) => ({ scope, color }))
  return { local: entries(false), shared: entries(true) }
}
const dirty = computed(() => JSON.stringify(getDraft()) !== JSON.stringify({ local: props.localColors, shared: props.fileColors }))
// Keep local/shared drafts separate; only returned persisted props acknowledge a save.
watch(() => props.fileColors, value => {
  draft.value = [...draft.value.filter(entry => !entry.shared), ...value.map(entry => ({ ...entry, shared: true }))]
}, { immediate: true })
watch(() => props.localColors, value => {
  draft.value = [...value.map(entry => ({ ...entry, shared: false })), ...draft.value.filter(entry => entry.shared)]
}, { immediate: true })
watch(() => props.root, () => {
  selected.value = -1
  adding.value = false
})
function confirmColor(color: string) {
  const target = chooser.value
  chooser.value = null
  if (!target) return
  if (target.entry) target.entry.color = color
  else {
    add(target.scope, color)
    void nextTick(() => addButton.value?.focus())
  }
}
function add(scope: string, color: string) {
  const existing = draft.value.findIndex(entry => !entry.shared && entry.scope === scope)
  if (existing >= 0) {
    if (!window.confirm(`作用域“${scope}”已有颜色，是否替换？`)) return
    draft.value[existing].color = color
    selected.value = existing
  } else {
    draft.value.unshift({ scope, color, shared: false })
    selected.value = 0
  }
  adding.value = false
}
function addCustom() {
  const existing = draft.value.find(entry => !entry.shared && entry.scope === addingScope.value)
  chooser.value = { initial: existing?.color ?? '#ffffff', scope: addingScope.value }
}
function changeColor(entry: ColorRow, event: Event) {
  const select = event.target as HTMLSelectElement
  if (select.value === 'custom') chooser.value = { initial: entry.color, scope: entry.scope, entry }
  else entry.color = select.value
  select.value = entry.color
}
function toggleShared(entry: ColorRow, event: Event) {
  const target = !entry.shared
  const existing = draft.value.find(other => other !== entry && other.shared === target && other.scope === entry.scope)
  if (existing && !window.confirm(`目标列表已有作用域“${entry.scope}”，是否替换？`)) {
    (event.target as HTMLInputElement).checked = entry.shared
    return
  }
  draft.value = draft.value.filter(other => other !== entry && other !== existing)
  entry.shared = target
  const boundary = draft.value.filter(other => !other.shared).length
  draft.value.splice(boundary, 0, entry)
  selected.value = boundary
}
function remove() {
  if (selected.value < 0) return
  draft.value.splice(selected.value, 1)
  selected.value = Math.min(selected.value, draft.value.length - 1)
}
function canMove(direction: -1 | 1) {
  const current = draft.value[selected.value]
  const next = draft.value[selected.value + direction]
  return !!current && !!next && current.shared === next.shared
}
function move(direction: -1 | 1) {
  if (!canMove(direction)) return
  const [entry] = draft.value.splice(selected.value, 1)
  selected.value += direction
  draft.value.splice(selected.value, 0, entry)
}
defineExpose({ dirty, getDraft })
</script>

<template>
  <div class="file-colors-page">
    <fieldset class="color-options" :disabled="busy">
      <label><input type="checkbox" :checked="enabled" @change="emit('update:enabled', ($event.target as HTMLInputElement).checked)" />启用文件颜色</label>
      <label><input type="checkbox" :checked="forTabs" :disabled="!enabled" @change="emit('update:forTabs', ($event.target as HTMLInputElement).checked)" />在编辑器标签页中使用</label>
      <label><input type="checkbox" :checked="forProjectView" :disabled="!enabled" @change="emit('update:forProjectView', ($event.target as HTMLInputElement).checked)" />在项目视图中使用</label>
    </fieldset>
    <fieldset class="color-configurations" :disabled="busy || !root">
      <div class="color-toolbar" role="toolbar" aria-label="文件颜色">
        <button ref="addButton" type="button" title="添加" aria-label="添加" :disabled="!scopes.length" :aria-expanded="adding" @click="adding = !adding; addingScope = ''"><Plus :size="iconSize.action" /></button>
        <button type="button" title="删除" aria-label="删除" :disabled="selected < 0" @click="remove"><Minus :size="iconSize.action" /></button>
        <button type="button" title="上移" aria-label="上移" :disabled="!canMove(-1)" @click="move(-1)"><ArrowUp :size="iconSize.action" /></button>
        <button type="button" title="下移" aria-label="下移" :disabled="!canMove(1)" @click="move(1)"><ArrowDown :size="iconSize.action" /></button>
        <div v-if="adding" class="color-popup">
          <div class="scope-choices">
            <button v-for="scope in scopes" :key="scope.name" type="button" @click="addingScope = scope.name">{{ scope.name }}<ChevronRight :size="iconSize.dense" /></button>
          </div>
          <div v-if="addingScope" class="color-choices">
            <button v-for="color in FILE_COLOR_NAMES" :key="color" type="button" :style="{ background: fileColorCss(color) ?? undefined }" @click="add(addingScope, color)">{{ color }}</button>
            <button type="button" @click="addCustom">自定义…</button>
          </div>
        </div>
      </div>
      <div class="color-table">
        <table aria-label="作用域文件颜色">
          <thead><tr><th>作用域</th><th>颜色</th><th title="与项目共享此颜色配置">共享</th></tr></thead>
          <tbody>
            <tr v-for="(entry, index) in draft" :key="`${entry.shared}:${entry.scope}`" :class="{ selected: selected === index }" @click="selected = index" @focusin="selected = index">
              <td>{{ entry.scope }}</td>
              <td :style="{ background: fileColorCss(entry.color) ?? undefined }">
                <select :value="entry.color" :aria-label="`${entry.scope} 的颜色`" @change="changeColor(entry, $event)">
                  <option v-for="color in FILE_COLOR_NAMES" :key="color" :value="color">{{ color }}</option>
                  <option v-if="!isFileColorName(entry.color)" :value="entry.color">{{ entry.color }}</option>
                  <option value="custom">自定义…</option>
                </select>
              </td>
              <td><input type="checkbox" :checked="entry.shared" :aria-label="`共享 ${entry.scope}`" @change="toggleShared(entry, $event)" /></td>
            </tr>
          </tbody>
        </table>
        <div v-if="!draft.length" class="color-empty">尚未指定颜色。<button type="button" :disabled="!scopes.length" @click="adding = true; addingScope = ''">添加颜色</button></div>
      </div>
    </fieldset>
    <p class="color-hint">颜色按列表顺序匹配，首个匹配的作用域生效。</p>
    <button type="button" class="manage-scopes" @click="emit('manageScopes')">管理作用域…</button>
    <ColorChooserDialog v-if="chooser" :initial="chooser.initial" :enable-opacity="false" @confirm="confirmColor" @cancel="chooser = null" />
    <!-- Both holders are project-scoped (FileColorModelStorageManager.kt:27-38).
         VCS storage separation still depends on the project persistence implementation. -->
    <p v-if="!root" class="color-hint">先打开项目才能配置作用域颜色。</p>
  </div>
</template>

<style scoped>
.file-colors-page { display: flex; flex-direction: column; gap: 10px; }
.color-options { display: flex; flex-wrap: wrap; gap: 16px; border: 0; margin: 0; padding: 0; }
.color-options label { display: inline-flex; align-items: center; gap: 5px; }
.color-options input { accent-color: var(--accent); }
.color-configurations { padding: 0; margin: 0; border: 1px solid var(--line); min-width: 0; }
.color-toolbar { position: relative; display: flex; padding: 3px; border-bottom: 1px solid var(--line); gap: 2px; }
.color-toolbar > button { display: inline-flex; padding: 4px; border: 0; background: transparent; color: inherit; }
.color-table { min-height: 280px; max-height: 48vh; overflow: auto; }
table { width: 100%; border-collapse: collapse; table-layout: fixed; }
th, td { padding: 5px 8px; text-align: left; }
th { border-bottom: 1px solid var(--line); font-weight: normal; }
th:first-child { width: 50%; }
th:last-child { width: 90px; }
tr.selected { background: var(--selection); }
td select { width: 100%; border: 0; background: transparent; color: inherit; font: inherit; }
.color-empty { margin: 90px 0; text-align: center; color: var(--muted); }
.color-empty button, .manage-scopes { border: 0; background: transparent; color: var(--accent); cursor: pointer; }
.manage-scopes { align-self: flex-start; padding: 0; }
.color-hint { margin: 0; color: var(--muted); font-size: 12px; }
.color-popup { position: absolute; z-index: 2; top: 100%; left: 0; display: flex; background: var(--panel); border: 1px solid var(--line); box-shadow: 0 4px 12px #0003; }
.scope-choices, .color-choices { display: flex; flex-direction: column; min-width: 110px; max-height: 260px; overflow: auto; }
.color-popup button { display: flex; justify-content: space-between; align-items: center; border: 0; text-align: left; padding: 5px 10px; color: inherit; }
button:disabled { opacity: .45; cursor: default; }
</style>
