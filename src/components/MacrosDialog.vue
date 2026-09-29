<script setup lang="ts">
// 「编辑宏…」对话框 —— IDEA `EditMacrosAction` 打开的 `ActionMacroConfigurable` 的对应物：
// 左边是宏列表（含未命名宏），右边是选中宏的步骤；每一步可以单独删除，宏可以回放/重命名/删除。
//
// 数据与规则在 src/macros.ts（纯逻辑）与 src/macroHost.ts（宿主），这里只做渲染与派发。
import { computed, ref } from 'vue'
import { Play, Trash2, X } from 'lucide-vue-next'
import { ANONYMOUS_MACRO_LABEL, actionStepCount, macroDisplayName, type Macro } from '../macros'

const props = defineProps<{ macros: readonly Macro[]; playing: boolean }>()
const emit = defineEmits<{
  (event: 'play', payload: { name: string }): void
  (event: 'remove', payload: { name: string }): void
  (event: 'rename', payload: { from: string; to: string }): void
  (event: 'removeStep', payload: { name: string; index: number }): void
  (event: 'close'): void
}>()

const selected = ref(props.macros[0]?.name ?? '')
const renaming = ref(false)
const draft = ref('')
const note = ref('')

const current = computed(() => props.macros.find(macro => macro.name === selected.value) ?? props.macros[0] ?? null)

function stepLabel(step: Macro['steps'][number]): string {
  if (step.kind === 'action') return `${step.title}${step.keys ? `（${step.keys}）` : ''}`
  if (step.kind === 'typing') return `输入：${step.text.length > 40 ? `${step.text.slice(0, 40)}…` : step.text}`
  return `按键：${step.stroke}（回放时忽略）`
}

function startRename() {
  if (!current.value) return
  renaming.value = true
  draft.value = current.value.name
  note.value = ''
}

function commitRename() {
  const macro = current.value
  if (!macro) return
  const next = draft.value.trim()
  if (!next) { note.value = '宏名不能为空。'; return }
  renaming.value = false
  selected.value = next
  emit('rename', { from: macro.name, to: next })
}
</script>

<template>
  <div class="modal-backdrop" @click.self="emit('close')">
    <section class="command-palette macros-dialog" role="dialog" aria-modal="true" aria-label="编辑宏">
      <div class="palette-input">
        <span class="macros-heading">编辑宏</span>
        <button class="icon-button" aria-label="关闭" @click="emit('close')"><X :size="16" /></button>
      </div>
      <div class="macros-body">
        <div class="macros-list" role="listbox" aria-label="宏列表">
          <button
            v-for="macro in macros" :key="macro.name || ANONYMOUS_MACRO_LABEL"
            :class="{ highlighted: macro === current }" role="option" :aria-selected="macro === current"
            @click="selected = macro.name; renaming = false; note = ''"
          >
            <span class="macros-name">{{ macroDisplayName(macro) }}</span>
            <span class="macros-steps">{{ actionStepCount(macro) }} 个动作 / {{ macro.steps.length }} 步</span>
          </button>
          <p v-if="!macros.length" class="palette-empty">还没有录制过宏。</p>
        </div>
        <div class="macros-detail">
          <template v-if="current">
            <div class="macros-actions">
              <button class="subtle-button" :disabled="playing" @click="emit('play', { name: current.name })"><Play :size="13" />回放</button>
              <button class="subtle-button" @click="startRename()">重命名…</button>
              <button class="subtle-button" @click="emit('remove', { name: current.name })"><Trash2 :size="13" />删除宏</button>
            </div>
            <div v-if="renaming" class="macros-rename">
              <input v-model="draft" type="text" aria-label="新的宏名" @keydown.enter.prevent="commitRename()" @keydown.esc.prevent="renaming = false" />
              <button class="primary-button" @click="commitRename()">确定</button>
            </div>
            <p v-if="note" class="field-hint validation-error">{{ note }}</p>
            <ol class="macros-step-list">
              <li v-for="(step, index) in current.steps" :key="`${index}:${step.kind}`">
                <span class="macros-step-kind">{{ step.kind === 'action' ? '动作' : step.kind === 'typing' ? '输入' : '按键' }}</span>
                <span class="macros-step-text">{{ stepLabel(step) }}</span>
                <button class="icon-button" :aria-label="`删除第 ${index + 1} 步`" title="删除这一步" @click="emit('removeStep', { name: current.name, index })"><Trash2 :size="13" /></button>
              </li>
            </ol>
            <p v-if="!current.steps.length" class="palette-empty">这个宏没有步骤。</p>
          </template>
        </div>
      </div>
      <p class="macros-foot">宏可以包含动作与输入；「按键」步骤按 IDEA 的语义在回放时跳过（只用于导出脚本）。</p>
    </section>
  </div>
</template>

<style scoped>
.macros-dialog { width: 720px; }
.macros-heading { flex: 1; color: var(--bright); font-weight: 500; }
.macros-body { display: flex; min-height: 220px; max-height: 420px; }
.macros-list { width: 220px; flex-shrink: 0; display: flex; flex-direction: column; gap: 2px; padding: var(--space-2); border-right: 1px solid var(--line-strong); overflow: auto; }
.macros-list > button { display: flex; flex-direction: column; align-items: flex-start; text-align: left; gap: 2px; padding: var(--space-1) var(--space-2); background: transparent; border: 0; border-radius: var(--radius-sm); color: var(--text); }
.macros-list > button.highlighted { background: var(--selected); }
.macros-name { color: var(--bright); }
.macros-steps { color: var(--muted); font-size: 12px; }
.macros-detail { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: var(--space-2); padding: var(--space-2); overflow: auto; }
.macros-actions { display: flex; gap: var(--space-2); }
.macros-rename { display: flex; gap: var(--space-2); }
.macros-rename > input { flex: 1; min-width: 0; }
.macros-step-list { margin: 0; padding-left: 20px; display: flex; flex-direction: column; gap: 2px; color: var(--text); }
.macros-step-list > li { display: flex; align-items: center; gap: var(--space-2); }
.macros-step-kind { color: var(--muted); font-size: 12px; flex-shrink: 0; }
.macros-step-text { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.macros-foot { margin: 0; padding: 0 var(--space-3) var(--space-3); color: var(--muted); font-size: 12px; }
.primary-button { margin-top: 0; }
</style>
