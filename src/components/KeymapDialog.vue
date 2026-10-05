<script setup lang="ts">
// 「键盘映射…」对话框 —— IDEA `KeymapPanel`（`platform/platform-impl/src/com/intellij/openapi/keymap/
// impl/ui/KeymapPanel.java`）在本仓的等价物。
//
// 逐条对照上游：
//   · 检索框           `FilterComponent("KEYMAP", 5)`（`:455-476`）→ 这里的搜索框
//   · 只看冲突         `showConflictsAction`（`:447`）→ 这里的「只看冲突」开关
//   · 动作树 + 快捷键列 `ActionsTree` + `ShortcutFilteringPanel` → 这里的行列表
//   · 按下即录         `KeyboardShortcutPanel` / `ShortcutTextField`（`:15-16`）→ 这里的录键输入框
//   · 冲突三选一       `addKeyboardShortcut` 的 `showConfirmationDialog`（`:529-537`）→ 这里的冲突问条
//   · 重置             `KeymapSchemeManager.resetScheme`（`:139-142`）→ 这里的「恢复默认」
//
// 规则与状态都不在这里：`src/keymapEditor.ts`（纯规则）+ `src/keymapHost.ts`（活状态）。
// 本组件只做渲染与派发 —— 这条分工和 `MacrosDialog.vue` 一致。
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { RotateCcw, Search, X } from 'lucide-vue-next'
import { iconSize } from '../uiIcons'
import {
  restrictionReason, strokeFromKeyEvent, unassignShortcut, type KeymapRow,
} from '../keymapEditor'
import { keymapHost } from '../keymapHost'

const emit = defineEmits<{ (event: 'close'): void }>()

const {
  answerConflictCancel, answerConflictKeep, answerConflictRemove, assign,
  conflictCount, conflictPrompt, conflictsOnly, customizedCount, query, resetAll, rows,
} = keymapHost

const recordingFor = ref('')
const note = ref('')

/** 正在录键的那一行（`KeyboardShortcutPanel` 的按下即录）。 */
const recordingRow = computed<KeymapRow | null>(() =>
  rows.value.find(row => row.id === recordingFor.value) ?? null)

function close() { recordingFor.value = ''; emit('close') }

/** 清除一个动作的键位（上游「清除快捷键」，`null` 即解绑）。 */
function clearKeys(row: KeymapRow) {
  if (!unassignShortcut(row.id)) { note.value = '这一条用的是出厂键位，恢复默认即可改。'; return }
  note.value = ''
}

function startRecording(row: KeymapRow) {
  const restriction = restrictionReason(row.id)
  if (restriction) { note.value = restriction; return }
  note.value = ''
  recordingFor.value = row.id
}

function stopRecording() { recordingFor.value = '' }

/**
 * 按下即录（上游 `ShortcutTextField` 的按下即录 + `KeyboardShortcutPanel`）：
 * 纯修饰键不成键位（`strokeFromKeyEvent` 返回 null），录到就立刻提交并退出录键态。
 */
function onRecordKey(event: KeyboardEvent) {
  event.preventDefault()
  event.stopPropagation()
  if (event.key === 'Escape') { stopRecording(); return }
  const stroke = strokeFromKeyEvent({
    key: event.key, ctrlKey: event.ctrlKey, shiftKey: event.shiftKey,
    altKey: event.altKey, metaKey: event.metaKey,
  })
  if (!stroke) return
  const error = assign(recordingFor.value, stroke.text)
  recordingFor.value = ''
  note.value = error ?? ''
}

/** 恢复出厂键位（`KeymapSchemeManager.resetScheme`）。 */
function restoreDefaults() { resetAll(); note.value = '' }

function onKeydown(event: KeyboardEvent) {
  if (event.key === 'Escape') { event.preventDefault(); stopRecording(); close() }
}

onMounted(() => window.addEventListener('keydown', onKeydown, true))
onBeforeUnmount(() => window.removeEventListener('keydown', onKeydown, true))
</script>

<template>
  <div class="modal-backdrop" @click.self="close()">
    <section class="command-palette keymap-dialog" role="dialog" aria-modal="true" aria-label="键盘映射">
      <div class="palette-input">
        <Search :size="iconSize.action" />
        <input v-model="query" type="text" placeholder="按动作名、动作 id 或快捷键搜索" aria-label="搜索动作" />
        <button
          class="subtle-button keymap-toggle" :aria-pressed="conflictsOnly" title="只看有冲突的动作"
          @click="conflictsOnly = !conflictsOnly"
        >只看冲突（{{ conflictCount }}）</button>
        <button class="icon-button" title="关闭" aria-label="关闭" @click="close()"><X :size="iconSize.action" /></button>
      </div>
      <div class="keymap-list" role="listbox" aria-label="键位列表">
        <button
          v-for="row in rows" :key="row.id" class="keymap-row" role="option"
          :aria-selected="row.id === recordingFor" @click="startRecording(row)"
        >
          <span class="keymap-label">{{ row.label }}</span>
          <span class="keymap-scope">{{ row.scope }}</span>
          <span class="keymap-keys" :class="{ overridden: row.overridden, unbound: !row.keys }">
            <template v-if="recordingFor === row.id">按下新的组合键…</template>
            <template v-else-if="row.keys">{{ row.keys }}</template>
            <template v-else>未绑定</template>
          </span>
          <span v-if="row.factoryKeys && row.overridden" class="keymap-factory">默认 {{ row.factoryKeys }}</span>
          <span v-if="row.conflictsWith.length" class="keymap-conflict" :title="`与 ${row.conflictsWith.join('、')} 冲突`">
            冲突 {{ row.conflictsWith.length }}
          </span>
        </button>
        <p v-if="!rows.length" class="palette-empty">没有匹配的动作。</p>
      </div>
      <div class="keymap-foot">
        <span class="keymap-status">
          {{ customizedCount }} 个自定义键位<template v-if="recordingRow"> · 正在录「{{ recordingRow.label }}」，Esc 取消</template>
        </span>
        <button class="subtle-button" @click="restoreDefaults()"><RotateCcw :size="iconSize.menu" />恢复默认</button>
        <button class="icon-button" :disabled="!recordingRow" title="清除选中动作的键位" aria-label="清除选中动作的键位" @click="recordingRow && clearKeys(recordingRow)"><X :size="iconSize.menu" /></button>
      </div>
      <p v-if="note" class="field-hint validation-error keymap-note">{{ note }}</p>
      <div v-if="conflictPrompt" class="keymap-conflict-prompt" role="alertdialog" aria-label="键位冲突">
        <p>
          「{{ conflictPrompt.chordText }}」已经绑给了
          <strong>{{ conflictPrompt.conflicts.flatMap(item => item.ids).join('、') }}</strong>。
        </p>
        <div class="keymap-conflict-actions">
          <button class="subtle-button" @click="answerConflictRemove()">移走冲突</button>
          <button class="subtle-button" @click="answerConflictKeep()">保留</button>
          <button class="subtle-button" @click="answerConflictCancel()">取消</button>
        </div>
      </div>
    </section>
  </div>
</template>

<style scoped>
.keymap-dialog { width: 760px; }
.keymap-toggle { flex-shrink: 0; padding: 2px var(--space-2); }
.keymap-list { flex: 1; min-height: 200px; max-height: 420px; overflow: auto; padding: var(--space-1) 0; }
.keymap-row { display: flex; align-items: center; gap: var(--space-2); width: 100%; padding: var(--space-1) var(--space-3); background: transparent; border: 0; color: var(--text); text-align: left; }
.keymap-row:hover, .keymap-row[aria-selected='true'] { background: var(--selected); }
.keymap-label { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.keymap-scope { flex-shrink: 0; font-size: 12px; color: var(--muted); }
.keymap-keys { flex-shrink: 0; min-width: 96px; text-align: right; color: var(--bright); }
.keymap-keys.unbound { color: var(--muted); }
.keymap-factory { flex-shrink: 0; font-size: 12px; color: var(--muted); }
.keymap-conflict { flex-shrink: 0; font-size: 12px; color: var(--accent); }
.keymap-foot { display: flex; align-items: center; gap: var(--space-2); padding: var(--space-2) var(--space-3); border-top: 1px solid var(--line-strong); }
.keymap-status { flex: 1; color: var(--muted); font-size: 12px; }
.keymap-note { padding: 0 var(--space-3) var(--space-2); }
.keymap-conflict-prompt { padding: var(--space-2) var(--space-3) var(--space-3); border-top: 1px solid var(--line-strong); }
.keymap-conflict-prompt > p { margin: 0 0 var(--space-2); color: var(--text); }
.keymap-conflict-actions { display: flex; gap: var(--space-2); }
</style>
