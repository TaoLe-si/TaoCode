<script setup lang="ts">
// 断点「富编辑」对话框（dbg/breakpoints 缺口④）—— 上游点装订线断点弹出的那一页
// `XLightBreakpointPropertiesPanel` + `BreakpointEditor`（引用逐条写在
// `src/debugBreakpointEditor.ts` 的模块头里）。
//
// 与上游同形的部分：Enabled / Condition(+条件的启用位) / Hit / Log / 依赖 / 组 /
// Done + More（带「查看断点」的快捷键文案）/ Esc·Enter·Ctrl+Enter 三个键。
// 刻意**没画**的两格（画了就是点不动的假控件，`agent-playbook-parity.md` §3）：
//   · Suspend policy（All / Thread）—— DAP 的 `Source.Breakpoint` 没有挂起策略字段
//     （`src/bridge.ts:236`），适配器不接受；
//   · 「Log stack trace」—— 同上，DAP 没有这个属性（上游 `XBreakpointActionsPanel.java:134`）。
import { computed, reactive, ref, watch } from 'vue'
import { X } from 'lucide-vue-next'
import { iconSize } from '../uiIcons'
import {
  CONDITION_HISTORY_ID, DONE_LABEL, LOG_EXPRESSION_HISTORY_ID, MORE_OPTIONS_LABEL, VIEW_BREAKPOINTS_SHORTCUT,
  breakpointEditChanged, breakpointEditKey, conditionEnabledFor, dependencyOptions, isConditionDisabled,
  type BreakpointEditModel,
} from '../debugBreakpointEditor'
import { pushEvaluateHistory } from '../debugEvaluateHistory'
// 「更多选项」这条链接只在宿主注册过打开动作时才画（src/dbgBreakpointsDialogHost.ts）。
import { breakpointsDialogAvailable } from '../dbgBreakpointsDialogHost'

const props = defineProps<{
  /** 正在编辑的断点身份（`path:line`），只用于标题与依赖去自引用。 */
  breakpointRef: string
  /** 初始状态（面板从断点对象 + 存下来的属性拼出来）。 */
  initial: BreakpointEditModel
  /** 组的候选（上游「移至组」那份 distinct + sorted 清单）。 */
  groups?: string[]
  /** 依赖候选：全仓断点 ref。 */
  dependencyChoices?: string[]
  /** 默认组（用于「设为默认」按钮的回显）。 */
  defaultGroup?: string | null
}>()

const emit = defineEmits<{
  apply: [model: BreakpointEditModel]
  close: []
  /** 「更多选项」= 打开「查看断点…」（上游 More 链接 `BreakpointEditor.java:65-77`）。 */
  more: []
  setDefaultGroup: [name: string | null]
}>()

const model = reactive<BreakpointEditModel>({ ...props.initial })
const note = ref('')
const newGroupName = ref('')
const creatingGroup = ref(false)
const conditionHistory = ref<string[]>([])

const options = computed(() => ({
  groups: props.groups ?? [],
  dependencies: dependencyOptions(props.dependencyChoices ?? [], props.breakpointRef),
}))
const dirty = computed(() => breakpointEditChanged(props.initial, model))

// 条件的历史（上游 `XDebuggerExpressionComboBox(..., CONDITION_HISTORY_ID, ...)`，
// `XLightBreakpointPropertiesPanel.java:328`）：提交成功的那条表达式进历史，供下次直接选。
watch(() => model.condition, text => {
  const trimmed = text.trim()
  if (trimmed) conditionHistory.value = pushEvaluateHistory(conditionHistory.value, trimmed)
}, { flush: 'sync' })

function snapshot(): BreakpointEditModel {
  return {
    enabled: model.enabled,
    conditionEnabled: conditionEnabledFor(model.condition, model.conditionEnabled),
    condition: model.condition,
    hitCondition: model.hitCondition,
    logMessage: model.logMessage,
    temporary: model.temporary,
    dependency: model.dependency,
    group: model.group,
  }
}

function apply(message = '') {
  const next = snapshot()
  emit('apply', next)
  if (message) note.value = message
  // 条件的启用位关掉时给一句实话（上游把这条藏在复选框状态里，本仓把它写出来）。
  else if (isConditionDisabled(next)) note.value = '条件已停用：文本留着，这次不会发给调试器。'
}

function onKeydown(event: KeyboardEvent) {
  const multiline = event.target instanceof HTMLTextAreaElement
  const action = breakpointEditKey(event.key, event.ctrlKey, event.shiftKey, event.altKey, multiline)
  if (action === 'none') return
  event.preventDefault()
  event.stopPropagation()
  if (action === 'commit') { apply(); emit('close') }
  else emit('close')
}

function createGroup() {
  const name = newGroupName.value.trim()
  if (!name) return
  model.group = name
  creatingGroup.value = false
  newGroupName.value = ''
  apply(`已把这条断点放进组「${name}」。`)
}
</script>

<template>
  <section class="bp-edit" role="dialog" aria-modal="false" :aria-label="`编辑断点 ${breakpointRef}`" tabindex="-1" @keydown="onKeydown">
    <header class="bp-edit-head">
      <span class="bp-edit-title">断点 · {{ breakpointRef }}</span>
      <button class="icon-button" title="关闭" aria-label="关闭断点编辑" @click="emit('close')"><X :size="iconSize.dense" /></button>
    </header>
    <div class="bp-edit-body">
      <label class="bp-edit-row"><input v-model="model.enabled" type="checkbox" /><span>启用（<code>Enabled</code>）</span></label>

      <label class="bp-edit-row"><input v-model="model.conditionEnabled" type="checkbox" :disabled="!model.condition.trim()" /><span>条件（<code>Condition:</code>）</span></label>
      <textarea v-model="model.condition" class="bp-edit-area" rows="2" :aria-label="`断点条件（历史槽 ${CONDITION_HISTORY_ID}）`" placeholder="i > 10" spellcheck="false"></textarea>
      <!-- 条件的历史（上游是表达式下拉框里的历史项，`XLightBreakpointPropertiesPanel.java:328`）。 -->
      <div v-if="conditionHistory.length" class="bp-edit-history">
        <button v-for="text in conditionHistory" :key="text" class="bp-edit-chip" :title="`把条件填回：${text}`" :aria-label="`填入历史条件 ${text}`" @click="model.condition = text">{{ text }}</button>
      </div>

      <label class="bp-edit-row" for="bp-hit"><span>命中次数（<code>Hit condition</code>）</span></label>
      <input id="bp-hit" v-model="model.hitCondition" class="bp-edit-field" type="text" aria-label="命中次数条件" placeholder="3 / >= 5" spellcheck="false" />

      <label class="bp-edit-row" for="bp-log"><span>日志（<code>Log:</code>，可用 <code>{表达式}</code> 模板）</span></label>
      <textarea id="bp-log" v-model="model.logMessage" class="bp-edit-area" rows="2" :aria-label="`日志消息（历史槽 ${LOG_EXPRESSION_HISTORY_ID}）`" placeholder="i = {i}" spellcheck="false"></textarea>

      <label class="bp-edit-row"><input v-model="model.temporary" type="checkbox" /><span>命中一次后自动移除（临时断点）</span></label>

      <label class="bp-edit-row" for="bp-dep"><span>依赖断点（它命中后这条才生效）</span></label>
      <select id="bp-dep" v-model="model.dependency" class="bp-edit-field" aria-label="依赖断点">
        <option value="">无</option>
        <option v-for="choice in options.dependencies" :key="choice" :value="choice">{{ choice }}</option>
      </select>

      <label class="bp-edit-row" for="bp-group"><span>组</span></label>
      <div class="bp-edit-group">
        <select id="bp-group" v-model="model.group" class="bp-edit-field" aria-label="断点所在组">
          <option :value="null">&lt;无组&gt;</option>
          <option v-for="name in options.groups" :key="name" :value="name">{{ name }}</option>
        </select>
        <button class="bp-edit-btn" @click="creatingGroup = !creatingGroup">新建…</button>
        <button class="bp-edit-btn" :disabled="!model.group || model.group === defaultGroup"
                :title="model.group && model.group !== defaultGroup ? `把「${model.group}」设为默认组` : '先选一个组'"
                :aria-label="`把当前组设为默认`" @click="emit('setDefaultGroup', model.group)">设为默认</button>
      </div>
      <div v-if="creatingGroup" class="bp-edit-group">
        <input v-model="newGroupName" class="bp-edit-field" type="text" aria-label="新组名" placeholder="组名" @keydown.enter.prevent="createGroup" />
        <button class="bp-edit-btn primary" :disabled="!newGroupName.trim()" @click="createGroup">建立并放入</button>
      </div>
      <p v-if="note" class="bp-edit-note" role="status">{{ note }}</p>
      <p class="bp-edit-hint">挂起策略与「命中时打栈」这两格上游有、本仓没有：DAP 的断点没有对应字段，画出来就是点不动的控件。</p>
    </div>
    <footer class="bp-edit-foot">
      <!-- 「更多选项」= 打开「查看断点…」（上游 BreakpointEditor 的那条 More 链接）。宿主在 App.vue，
           没注册时这一格**不画**（假控件禁令）：见 src/dbgBreakpointsDialogHost.ts。 -->
      <button v-if="breakpointsDialogAvailable" class="bp-edit-link" :title="`查看断点…（${VIEW_BREAKPOINTS_SHORTCUT}）`" @click="emit('more')">{{ MORE_OPTIONS_LABEL }} ({{ VIEW_BREAKPOINTS_SHORTCUT }})</button>
      <span class="bp-edit-spacer"></span>
      <button class="bp-edit-btn primary" :disabled="!dirty" @click="apply(); emit('close')">{{ DONE_LABEL }}</button>
    </footer>
  </section>
</template>

<style scoped>
.bp-edit { position: absolute; z-index: 70; left: var(--space-3); right: var(--space-3); top: var(--space-3); display: flex; flex-direction: column; max-height: min(70vh, 520px); border: var(--popup-border); border-radius: var(--popup-radius); background: var(--elevated); box-shadow: var(--popup-shadow); }
.bp-edit-head { display: flex; align-items: center; gap: var(--space-2); padding: var(--space-1) var(--space-2); border-bottom: 1px solid var(--line); }
.bp-edit-title { flex: 1; min-width: 0; color: var(--bright); font-size: 12px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.bp-edit-body { flex: 1; min-height: 0; overflow: auto; padding: var(--space-2) var(--space-3); display: flex; flex-direction: column; gap: var(--space-1); }
.bp-edit-row { display: flex; align-items: center; gap: var(--space-1); font-size: 11px; color: var(--text); }
.bp-edit-field { min-height: var(--ctrl-height-sm); padding: 2px var(--space-1); color: var(--text); background: var(--editor); border: 1px solid var(--line-strong); border-radius: var(--radius-xs); font: 11px/1.4 var(--font-mono); }
.bp-edit-area { width: 100%; resize: vertical; color: var(--text); background: var(--editor); border: 1px solid var(--line-strong); border-radius: var(--radius-xs); font: 11px/1.4 var(--font-mono); padding: 2px var(--space-1); }
.bp-edit-group { display: flex; align-items: center; gap: var(--space-1); }
.bp-edit-history { display: flex; flex-wrap: wrap; gap: var(--space-1); }
.bp-edit-chip { padding: 1px var(--space-1); border: 1px solid var(--line-strong); border-radius: var(--radius-pill); background: var(--editor); color: var(--text); font: 10px var(--font-mono); }
.bp-edit-chip:hover { background: var(--hover); color: var(--bright); }
.bp-edit-btn { display: inline-flex; align-items: center; gap: var(--space-1); padding: 3px var(--space-2); border: 1px solid var(--line-strong); border-radius: var(--radius-sm); background: var(--elevated); color: var(--text); font-size: 11px; }
.bp-edit-btn:hover { background: var(--hover); color: var(--bright); }
.bp-edit-btn:disabled { color: var(--muted); opacity: .5; }
.bp-edit-btn.primary { border-color: var(--accent); color: var(--accent); }
.bp-edit-link { border: 0; background: transparent; color: var(--accent); font-size: 11px; padding: 0; }
.bp-edit-note { margin: 0; color: var(--warning); font-size: 11px; }
.bp-edit-hint { margin: 0; color: var(--muted); font-size: 10px; }
.bp-edit-foot { display: flex; align-items: center; gap: var(--space-2); padding: var(--space-1) var(--space-3); border-top: 1px solid var(--line); }
.bp-edit-spacer { flex: 1; }
.icon-button { display: inline-flex; border: 0; background: transparent; color: var(--muted); padding: 1px; border-radius: var(--radius-xs); }
.icon-button svg { flex-shrink: 0; }
.icon-button:hover { color: var(--bright); background: var(--hover); }
</style>
