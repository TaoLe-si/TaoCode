<script setup lang="ts">
// 求值对话框 —— 上游 `XExpressionDialog` + `XDebuggerMultilineEditor` / `CodeFragmentInputComponent`
// （见 src/debugMultilineEvaluate.ts 的口径说明：DAP 只收表达式，所以多行是**逐行求值**）。
//
// 同一个对话框承载两件事：
//   · 输入区（`mode`：单行表达式 / 多行代码片段，来自设置 `debuggerEvaluationMode`）；
//   · 历史面板（上游 `XDebuggerTreeWithHistory` 的表达式历史）——最近求值过的表达式，
//     点击回填、单条移除、清空。历史只由 DebugPanel 传入/回写，本组件不碰存储。
import { ref, watch } from 'vue'
import { X, History, Trash2 } from 'lucide-vue-next'
import { iconSize } from '../uiIcons'
import { planMultilineEvaluate, type MultilineResultLine } from '../debugMultilineEvaluate'

const props = defineProps<{
  mode: 'expression' | 'codeFragment'
  busy?: boolean
  results: MultilineResultLine[]
  history: string[]
}>()
const emit = defineEmits<{
  (event: 'close'): void
  (event: 'run', lines: string[]): void
  (event: 'remove-history', text: string): void
  (event: 'clear-history'): void
}>()

const mode = ref(props.mode)
watch(() => props.mode, value => { mode.value = value })
const text = ref('')
const notice = ref('')

function run() {
  if (props.busy) return
  if (mode.value === 'expression') {
    const expression = text.value.trim()
    if (!expression) { notice.value = '请先填写表达式。'; return }
    notice.value = ''
    emit('run', [expression])
    return
  }
  const plan = planMultilineEvaluate(text.value)
  if (!plan.lines.length) { notice.value = '没有可求值的行（空行会被跳过）。'; return }
  notice.value = plan.truncated > 0 ? `超过 ${plan.lines.length} 行上限，只求值前 ${plan.lines.length} 行。` : ''
  emit('run', plan.lines)
}

function pick(expression: string) { text.value = expression; notice.value = '' }
</script>

<template>
  <div class="modal-backdrop" @click.self="emit('close')">
    <section class="command-palette debug-evaluate-dialog" role="dialog" aria-modal="true" aria-label="求值">
      <div class="palette-input">
        <span class="debug-evaluate-heading">求值表达式</span>
        <select v-model="mode" class="debug-evaluate-mode" aria-label="求值形态">
          <option value="expression">表达式（单行）</option>
          <option value="codeFragment">代码片段（逐行求值）</option>
        </select>
        <button class="icon-button" title="关闭" aria-label="关闭" @click="emit('close')"><X :size="iconSize.action" /></button>
      </div>
      <div class="debug-evaluate-body">
        <div class="debug-evaluate-main">
          <textarea v-if="mode === 'codeFragment'" v-model="text" rows="8" class="debug-evaluate-input" aria-label="多行表达式（每行一条）" placeholder="每行必须是一条可求值的表达式（DAP evaluate 不收语句块）" spellcheck="false" />
          <input v-else v-model="text" class="debug-evaluate-input" aria-label="表达式" placeholder="一条可求值的表达式" spellcheck="false" @keydown.enter.prevent="run" />
          <p class="debug-evaluate-hint">DAP 的 <code>evaluate</code> 只收单条表达式，所以多行按**逐行、同帧、按顺序**求值；失败行标红但不阻断后续行（片段里的赋值语句通常求值不了，这是适配器协议决定的）。</p>
          <p v-if="notice" class="debug-evaluate-notice">{{ notice }}</p>
          <div class="debug-evaluate-actions">
            <button class="debug-btn primary" :disabled="busy" @click="run">求值</button>
            <span v-if="busy" class="small-muted">正在求值…</span>
          </div>
          <div v-if="results.length" class="debug-evaluate-results" role="list" aria-label="求值结果">
            <div v-for="(row, index) in results" :key="`${index}:${row.expression}`" class="debug-evaluate-result" :class="{ error: row.error }" role="listitem">{{ row.text }}</div>
          </div>
        </div>
        <aside class="debug-evaluate-history" aria-label="求值历史">
          <div class="debug-evaluate-history-head">
            <span><History :size="iconSize.dense" /> 历史（{{ history.length }}）</span>
            <button v-if="history.length" class="chip-x" title="清空求值历史" aria-label="清空求值历史" @click="emit('clear-history')"><Trash2 :size="iconSize.chip" /></button>
          </div>
          <p v-if="!history.length" class="debug-empty">还没有成功求值过的表达式。</p>
          <div v-for="entry in history" :key="entry" class="debug-evaluate-history-row">
            <button class="debug-evaluate-history-text" :title="entry" @click="pick(entry)">{{ entry }}</button>
            <button class="chip-x" :title="`移除 ${entry}`" :aria-label="`移除历史 ${entry}`" @click="emit('remove-history', entry)"><X :size="iconSize.chip" /></button>
          </div>
        </aside>
      </div>
    </section>
  </div>
</template>

<style scoped>
.debug-evaluate-dialog { width: min(760px, calc(100vw - 32px)); }
.debug-evaluate-heading { color: var(--bright); }
.debug-evaluate-mode { margin-left: auto; margin-right: var(--space-2); }
.debug-evaluate-body { display: grid; grid-template-columns: minmax(0, 1fr) 220px; gap: var(--space-3); padding: var(--space-3); }
.debug-evaluate-main { display: flex; flex-direction: column; gap: var(--space-2); min-width: 0; }
.debug-evaluate-input { width: 100%; box-sizing: border-box; padding: var(--space-1) var(--space-2); color: var(--text); background: var(--editor); border: 1px solid var(--line-strong); border-radius: var(--radius-xs); font: 12px/1.6 var(--font-mono); resize: vertical; }
.debug-evaluate-hint { margin: 0; color: var(--muted); font-size: 11px; line-height: 1.6; }
.debug-evaluate-notice { margin: 0; color: var(--warning); font-size: 11px; }
.debug-evaluate-actions { display: flex; align-items: center; gap: var(--space-2); }
.debug-evaluate-results { max-height: 180px; overflow: auto; border-top: 1px solid var(--line); }
.debug-evaluate-result { padding: 2px 0; font: 11px/1.6 var(--font-mono); overflow-wrap: anywhere; }
.debug-evaluate-result.error { color: var(--error); }
.debug-evaluate-history { display: flex; flex-direction: column; min-width: 0; border-left: 1px solid var(--line); padding-left: var(--space-2); }
.debug-evaluate-history-head { display: flex; align-items: center; justify-content: space-between; gap: var(--space-1); color: var(--muted); font-size: 11px; }
.debug-evaluate-history-head > span { display: inline-flex; align-items: center; gap: var(--space-1); }
.debug-evaluate-history-row { display: flex; align-items: center; gap: 2px; }
.debug-evaluate-history-text { flex: 1; min-width: 0; text-align: left; border: 0; background: transparent; color: var(--text); font: 11px var(--font-mono); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.debug-evaluate-history-text:hover { color: var(--bright); background: var(--hover); }
</style>
