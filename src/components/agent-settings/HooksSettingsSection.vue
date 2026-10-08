<script setup lang="ts">
// 「钩子」节（ZCode section id `hooks`，`settingsPageConfig.ts:121-125`，图标 Anchor）的界面。
//
// 本节只做**接线**：形状 / 校验 / 触发判定 / 信任态全在 `src/agentHooks.ts`。
// 表单字段逐条照 ZCode 的 `HookForm.tsx:96-104`（事件 / 运行方式 / 匹配器 / 命令 / 参数 /
// 后台运行 / Shell / 状态消息 / 超时），列表的启停门控照 `HooksList.tsx:298-303`：
// 需要信任审核的行，开关强制显示为关且禁用 —— 与 ZCode 逐字同口径。
import { reactive, ref } from 'vue'
import { Plus, Save, Trash2 } from 'lucide-vue-next'
import AgentSettingsSectionShell from './AgentSettingsSectionShell.vue'
import { iconSize } from '../../uiIcons'
import {
  AGENT_HOOK_DEFAULT_TIMEOUT_SECONDS, AGENT_HOOK_EVENTS, AGENT_HOOK_TIMEOUT_MAX_SECONDS,
  AGENT_HOOK_TIMEOUT_MIN_SECONDS, AGENT_HOOK_TYPES, loadAgentHooks,
  normalizeAgentHooks, requiresWorkspaceHookTrust, saveAgentHooks, validateAgentHooks,
  type AgentHook,
} from '../../agentHooks'

const draft = reactive(normalizeAgentHooks(loadAgentHooks()))
const problems = ref<string[]>([])
const status = ref('')
/** undefined = 没在编辑任何一条（ZCode 的列表/表单两态：`HooksSection.tsx:152`）。 */
const editingId = ref<string | undefined>(undefined)

let nextId = draft.hooks.length + 1
const typeLabel = (type: string): string => (type === 'process' ? '进程' : 'Shell 命令')
const scopeLabel = (scope: string): string => (scope === 'project' ? '工作区' : '用户')
const argsText = (hook: AgentHook): string => hook.args.join('\n')
const trustLabel = (hook: AgentHook): boolean => requiresWorkspaceHookTrust(hook)

function addHook() {
  // 新建即开 + 事件/运行方式/超时取 ZCode 新建表单的初值（`HookForm.tsx:96/97/104/155`）。
  const id = `hook-${Date.now().toString(36)}-${nextId++}`
  draft.hooks.push({
    id,
    event: 'PreToolUse',
    type: 'process',
    matcher: '',
    command: '',
    args: [],
    async: false,
    shell: '',
    statusMessage: '',
    timeoutSeconds: AGENT_HOOK_DEFAULT_TIMEOUT_SECONDS,
    enabled: true,
    scope: 'user',
    trust: 'not_applicable',
    readOnly: false,
  })
  editingId.value = id
}

function removeAt(index: number) {
  const [removed] = draft.hooks.splice(index, 1)
  if (removed && editingId.value === removed.id) editingId.value = undefined
}

function setArgs(hook: AgentHook, value: string) {
  // 与 ZCode 的 handleSave 一致：按 \n 切、trim、丢空行（`HookForm.tsx:142-148`）。
  hook.args = value.split('\n').map(line => line.trim()).filter(Boolean)
}

function save() {
  const found = validateAgentHooks(draft)
  problems.value = found
  if (found.length) { status.value = ''; return }
  status.value = saveAgentHooks(draft)
    ? '已保存到本机设置。'
    : '本次会话仍生效，但没有存下来（本机存储不可用）。'
  if (!found.length) editingId.value = undefined
}
</script>

<template>
  <AgentSettingsSectionShell>
    <fieldset class="settings-fields">
      <div v-for="(hook, index) in draft.hooks" :key="hook.id" class="hooks-item">
        <div class="hooks-head">
          <label class="checkbox-row">
            <!-- 需要信任审核的行：显示为关且禁用（HooksList.tsx:298-303 同口径）。 -->
            <input
              v-model="hook.enabled" type="checkbox" :disabled="trustLabel(hook) || hook.readOnly"
              :aria-label="`第 ${index + 1} 条钩子的启用开关`"
            />
            <span>{{ hook.event }}</span>
          </label>
          <span class="hooks-scope">{{ scopeLabel(hook.scope) }}</span>
          <span v-if="trustLabel(hook)" class="hooks-trust">需信任审核</span>
          <button
            class="settings-icon-button settings-icon-button-danger" type="button" :aria-label="`删除第 ${index + 1} 条钩子`"
            @click="removeAt(index)"
          ><Trash2 :size="iconSize.control" aria-hidden="true" /></button>
          <button
            class="settings-button" type="button" :aria-pressed="editingId === hook.id"
            @click="editingId = editingId === hook.id ? undefined : hook.id"
          >{{ editingId === hook.id ? '收起' : '编辑' }}</button>
        </div>

        <div v-if="editingId === hook.id" class="hooks-form">
          <div class="input-row">
            <label :for="`hook-event-${index}`">事件</label>
            <select :id="`hook-event-${index}`" v-model="hook.event">
              <option v-for="event in AGENT_HOOK_EVENTS" :key="event" :value="event">{{ event }}</option>
            </select>
          </div>
          <div class="input-row">
            <label :for="`hook-type-${index}`">运行方式</label>
            <select :id="`hook-type-${index}`" v-model="hook.type">
              <option v-for="type in AGENT_HOOK_TYPES" :key="type" :value="type">{{ typeLabel(type) }}</option>
            </select>
          </div>
          <div class="input-row">
            <label :for="`hook-matcher-${index}`">匹配器</label>
            <input :id="`hook-matcher-${index}`" v-model="hook.matcher" type="text" />
          </div>
          <div class="input-row">
            <label :for="`hook-command-${index}`">命令</label>
            <input :id="`hook-command-${index}`" v-model="hook.command" type="text" />
          </div>
          <div v-if="hook.type === 'process'" class="input-row hooks-row-block">
            <label :for="`hook-args-${index}`">参数</label>
            <textarea
              :id="`hook-args-${index}`" rows="3" :value="argsText(hook)"
              @input="setArgs(hook, ($event.target as HTMLTextAreaElement).value)"
            />
          </div>
          <template v-else>
            <label class="checkbox-row">
              <input v-model="hook.async" type="checkbox" :aria-label="`第 ${index + 1} 条钩子后台运行`" />
              <span>后台运行</span>
            </label>
            <div class="input-row">
              <label :for="`hook-shell-${index}`">Shell</label>
              <input :id="`hook-shell-${index}`" v-model="hook.shell" type="text" />
            </div>
          </template>
          <div class="input-row">
            <label :for="`hook-status-${index}`">状态消息</label>
            <input :id="`hook-status-${index}`" v-model="hook.statusMessage" type="text" />
          </div>
          <div class="input-row">
            <label :for="`hook-timeout-${index}`">超时时间（秒）</label>
            <input
              :id="`hook-timeout-${index}`" v-model.number="hook.timeoutSeconds" class="hooks-timeout" type="number"
              :min="AGENT_HOOK_TIMEOUT_MIN_SECONDS" :max="AGENT_HOOK_TIMEOUT_MAX_SECONDS" step="1"
            />
          </div>
        </div>
      </div>

      <div class="settings-actions">
      <button class="settings-button settings-button-primary" type="button" @click="addHook">
          <Plus :size="iconSize.control" aria-hidden="true" />新建钩子
        </button>
      <button class="settings-button" type="button" @click="save">
          <Save :size="iconSize.control" aria-hidden="true" />保存
        </button>
        <span v-if="status" class="settings-status" role="status">{{ status }}</span>
      </div>
      <ul v-if="problems.length" class="settings-problems" role="alert">
        <li v-for="(problem, index) in problems" :key="index">{{ problem }}</li>
      </ul>
    </fieldset>
  </AgentSettingsSectionShell>
</template>

<style scoped>
.hooks-item { padding: var(--space-3); border: 1px solid var(--line); border-radius: var(--radius-md); background: var(--elevated); }
.hooks-item + .hooks-item { margin-top: var(--space-2); }
.hooks-head { display: flex; align-items: center; flex-wrap: wrap; gap: var(--space-2); }
.hooks-scope { color: var(--muted); font-size: 12px; }
.hooks-trust { padding: 0 var(--space-1); border: 1px solid var(--warning); border-radius: var(--radius-xs); color: var(--warning); font-size: 12px; }
.hooks-form { display: flex; flex-direction: column; gap: var(--space-2); margin-top: var(--space-3); padding-top: var(--space-2); border-top: 1px solid var(--line); }
.hooks-row-block { align-items: flex-start; }
.hooks-row-block > textarea { flex: 1 1 100%; min-height: 60px; padding: var(--space-1); font-family: var(--font-mono); resize: vertical; }
.hooks-timeout { flex: 0 0 92px; }
</style>
