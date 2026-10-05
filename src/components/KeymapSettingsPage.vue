<script setup lang="ts">
// 「键盘映射」设置页 —— 上游 `KeymapPanel`（`platform/platform-impl/src/com/intellij/openapi/keymap/
// impl/ui/KeymapPanel.java:111`，`implements SearchableConfigurable`）在本仓的**页面形态**。
//
// 上游依据（逐条）：
//   · 注册位置  `platform/platform-impl/resources/intellij.platform.ide.impl.xml:950-952`
//                `groupId="root" groupWeight="65" id="preferences.keymap" key="keymap.display.name"`
//                （`keymap.display.name=Keymap` 见 `platform/platform-api/resources/messages/KeyMapBundle.properties:26`）
//                —— `groupId="root"` ⇒ 它是**顶层页面节点**，与「版本控制」同层，不是 editor 的子页。
//   · 检索框    `FilterComponent("KEYMAP", 5)`（`:455-476`）
//   · 只看冲突  `showConflictsAction`（`:447`）
//   · 改键三选一 `addKeyboardShortcut` 的 `showConfirmationDialog`（`:529-537`）
//   · 恢复默认  `KeymapSchemeManager.resetScheme`（`:139-142`）
//
// **与 `KeymapDialog.vue` 的分工**：规则与活状态都不在组件里（`src/keymapEditor.ts` 纯规则 +
// `src/keymapHost.ts` 活状态），两处读的是**同一份** `keymapHost` —— 在设置页改键，
// 帮助菜单的「键盘映射…」对话框立刻看到同一批覆盖，反过来也一样。差的只是外壳：
// 这一份是**页**（没有关闭按钮、不抢 Esc、不装 window capture 监听、列表占满整页），
// 那一份是**对话框**（`KeymapDialog.vue` 的 `.modal-backdrop` + `aria-modal` + 全局 Esc 接管）。
// 页面里没有关闭按钮是对的：`SettingsDialog` 自己管 Esc 与关闭。
//
// 页面键沿用上游 configurable id `preferences.keymap`（本仓节点表的既有惯例）。
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { RotateCcw, Search, X } from 'lucide-vue-next'
import { iconSize } from '../uiIcons'
import { restrictionReason, strokeFromKeyEvent, unassignShortcut, type KeymapRow } from '../keymapEditor'
import { keymapHost } from '../keymapHost'

const {
  answerConflictCancel, answerConflictKeep, answerConflictRemove, assign,
  conflictCount, conflictPrompt, conflictsOnly, customizedCount, query, resetAll, rows,
} = keymapHost

const recordingFor = ref('')
const note = ref('')

/** 正在录键的那一行（`KeyboardShortcutPanel` 的按下即录）。 */
const recordingRow = computed<KeymapRow | null>(() =>
  rows.value.find(row => row.id === recordingFor.value) ?? null)

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
 * 按下即录（上游 `ShortcutTextField` / `KeyboardShortcutPanel`）。只认**焦点在设置页里**的按键 ——
 * 页面不能像对话框那样在 `window` 上装 capture 监听去抢全机的 Esc（那是 `KeymapDialog` 的职责）。
 * 纯修饰键不成键位（`strokeFromKeyEvent` 返回 null），录到就立刻提交并退出录键态。
 */
function onRecordKey(event: KeyboardEvent) {
  if (!recordingFor.value) return
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

/** 恢复出厂键位（`KeymapSchemeManager.resetScheme`，`:139-142`）。 */
function restoreDefaults() { resetAll(); note.value = '' }

onMounted(() => window.addEventListener('keydown', onRecordKey, true))
onBeforeUnmount(() => window.removeEventListener('keydown', onRecordKey, true))
</script>

<template>
  <div class="keymap-page" @keydown.capture="onRecordKey">
    <div class="palette-input">
      <Search :size="iconSize.action" />
      <input v-model="query" type="text" placeholder="按动作名、动作 id 或快捷键搜索" aria-label="搜索动作" />
      <button
        class="subtle-button keymap-page-toggle" :aria-pressed="conflictsOnly" title="只看有冲突的动作"
        @click="conflictsOnly = !conflictsOnly"
      >只看冲突（{{ conflictCount }}）</button>
    </div>
    <div class="keymap-page-list" role="listbox" aria-label="键位列表">
      <button
        v-for="row in rows" :key="row.id" class="keymap-page-row" role="option"
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
  </div>
</template>

<style scoped>
/* 页面形态 = 对话框那套的满页版：`KeymapDialog.vue` 的 `.keymap-dialog` 定宽 760px
   （`:138`），页面里改成占满整页，列表吃掉剩余高度。类名统一加 `-page` 后缀，
   免得 scoped 样式与对话框那份互相覆盖。 */
.keymap-page { display: flex; flex-direction: column; min-height: 0; }
.keymap-page-toggle { flex-shrink: 0; padding: 2px var(--space-2); }
.keymap-page-list { flex: 1; min-height: 200px; overflow: auto; padding: var(--space-1) 0; }
.keymap-page-row { display: flex; align-items: center; gap: var(--space-2); width: 100%; padding: var(--space-1) var(--space-3); background: transparent; border: 0; color: var(--text); text-align: left; }
.keymap-page-row:hover, .keymap-page-row[aria-selected='true'] { background: var(--selected); }
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
