<script setup lang="ts">
// 设置 › Agent 页 —— **结构逐字对齐 ZCode 的设置面板**（用户 2026-10-07 要求「与 Zcode 相同」，
// 源码已克隆到 .tools/ZCode，本页的每一节/每一档默认值都能在那边指到出处）：
//
//   · 节清单与顺序 = `packages/ui/src/settings/settingsPageConfig.ts` 的 BASE_SETTINGS_SECTIONS
//     （基础设置：常规/外观/模型设置/浏览器控制/电脑控制/键盘快捷键；
//      Agent 能力：记忆/子智能体/插件/MCP 服务器/技能/命令/自动化(Beta)/钩子；数据与统计：使用统计）；
//   · 节标题 = `packages/ui/src/i18n/locales/zh-CN.ts` 的原文（常规/外观/模型设置/…）；
//   · 常规节的键名与出厂默认 = `settingsPageHelpers.tsx` 的 `GeneralSectionContent`。
//
// **实装口径**：有真实落点的节渲染真控件——
//   常规（Agent 行为 + ZCode general 键）、模型设置（自定义供应商 CRUD）、命令（AGENT_COMMANDS）、
//   使用统计（会话库实测数字）；
//   外观/键盘快捷键两节跳本仓已有的对应页（同一份设置，不重复造）；
//   其余节各自一个组件（`src/components/agent-settings/`）。
import { computed, reactive, ref } from 'vue'
import {
  AlarmClock, Anchor, BarChart3, Blocks, Bot, Brain, Cable, Keyboard,
  Package, Palette, Pencil, Settings2, Terminal, WandSparkles,
} from 'lucide-vue-next'
import { iconSize } from '../uiIcons'
import {
  AGENT_CONTEXT_MAX_CHARS, AGENT_CONTEXT_MIN_CHARS, AGENT_DIFF_CONTEXT_CHOICES,
  defaultAgentSettings, loadAgentSettings, normalizeAgentSettings, saveAgentSettings,
  validateAgentSettings, type AgentModelProvider, type AgentSettingsState,
} from '../agentSettings'
import { AGENT_COMMANDS } from '../agentCommands'
import { AGENT_SESSION_LIMIT, createAgentSessionStore } from '../agentSessions'
import {
  AGENT_DEFAULT_PROVIDER_API_TYPE, AGENT_MODEL_PROVIDER_MESSAGES, AGENT_PROVIDER_API_FORMATS,
  AGENT_PROVIDER_API_FORMAT_TITLES, type AgentProviderModelConfig,
} from '../agentModelProviders'
// 各节各有**独立的纯逻辑模块 + 判据**，所以界面也各自一个组件（2026-10-07 拆出
// `src/components/agent-settings/`）：本页只管节导航与 Agent 总设置（常规 / 模型设置），
// 拆出去的那几节各自管自己的草稿与保存 —— 一节的字段不塞进本页的 `draft`，
// 否则这页的「保存」会顺手把别的节的字段一起覆盖掉。
import MemorySettingsSection from './agent-settings/MemorySettingsSection.vue'
import HooksSettingsSection from './agent-settings/HooksSettingsSection.vue'
import AutomationsSettingsSection from './agent-settings/AutomationsSettingsSection.vue'
import SkillsSettingsSection from './agent-settings/SkillsSettingsSection.vue'
import SubagentsSettingsSection from './agent-settings/SubagentsSettingsSection.vue'
import PluginsSettingsSection from './agent-settings/PluginsSettingsSection.vue'
import McpSettingsSection from './agent-settings/McpSettingsSection.vue'
import ModelMetadataSection from './agent-settings/ModelMetadataSection.vue'

const props = defineProps<{
  /** 宿主注入的保存通道（App.vue 的 `persistAgentSettings`）。给了才有保存按钮。 */
  persist?: (next: AgentSettingsState) => boolean
  initialSection?: SectionId
  workspacePath?: string | null
}>()
const emit = defineEmits<{
  /** 跳到本仓设置树的另一页（外观/键盘映射两节用：ZCode 的这两节内容本仓已有，不重复造）。 */
  navigate: [page: 'preferences.lookFeel' | 'preferences.keymap']
}>()

// ── 节导航（顺序与分组逐字照 settingsPageConfig.ts；标题照 zh-CN.ts）──────────────────────
type SectionId = 'general' | 'appearance' | 'modelProvider' | 'shortcuts'
  | 'memory' | 'subagents' | 'plugin' | 'mcp' | 'skill' | 'commands' | 'automations' | 'hooks' | 'usage'
const SECTION_GROUPS: Array<{ title: string; items: Array<{ id: SectionId; label: string; icon: unknown }> }> = [
  { title: '基础设置', items: [
    { id: 'general', label: '常规', icon: Settings2 },
    { id: 'appearance', label: '外观', icon: Palette },
    { id: 'modelProvider', label: '模型设置', icon: Package },
    { id: 'shortcuts', label: '键盘快捷键', icon: Keyboard },
  ] },
  { title: 'Agent 能力', items: [
    { id: 'memory', label: '记忆', icon: Brain },
    { id: 'subagents', label: '子智能体', icon: Bot },
    { id: 'plugin', label: '插件', icon: Blocks },
    { id: 'mcp', label: 'MCP 服务器', icon: Cable },
    { id: 'skill', label: '技能', icon: WandSparkles },
    { id: 'commands', label: '命令', icon: Terminal },
    { id: 'automations', label: '自动化', icon: AlarmClock },
    { id: 'hooks', label: '钩子', icon: Anchor },
  ] },
  { title: '数据与统计', items: [
    { id: 'usage', label: '使用统计', icon: BarChart3 },
  ] },
]
const section = ref<SectionId>(props.initialSection ?? 'general')
const sectionLabel = computed(() => SECTION_GROUPS.flatMap(group => group.items).find(item => item.id === section.value)?.label ?? '')
function selectSection(id: SectionId) {
  if (id === 'appearance') { emit('navigate', 'preferences.lookFeel'); return }
  if (id === 'shortcuts') { emit('navigate', 'preferences.keymap'); return }
  section.value = id
}

// ── 草稿与保存 ─────────────────────────────────────────────────────────────────
const draft = reactive<AgentSettingsState>(loadAgentSettings())
const problems = computed(() => validateAgentSettings(draft))
const savedNote = ref('')
function save() {
  if (problems.value.length) return
  const next = normalizeAgentSettings(JSON.parse(JSON.stringify(draft)))
  const ok = props.persist ? props.persist(next) : saveAgentSettings(next)
  savedNote.value = ok ? '已保存。' : '保存失败（存储不可用），本次会话仍生效。'
}
function resetDefaults() {
  Object.assign(draft, defaultAgentSettings())
  savedNote.value = ''
}

// ── 模型设置节：自定义供应商 CRUD（ZCode personal providers 那一支）────────────────
const providerDraft = reactive<{ name: string; baseUrl: string; apiKey: string; apiFormat: AgentModelProvider['apiFormat']; modelId: string; modelName: string }>({ name: '', baseUrl: '', apiKey: '', apiFormat: AGENT_DEFAULT_PROVIDER_API_TYPE, modelId: '', modelName: '' })
function addProvider() {
  const name = providerDraft.name.trim()
  if (!name) return
  const id = `provider-${Date.now()}`
  const models = providerDraft.modelId.trim()
    ? [{ id: providerDraft.modelId.trim(), name: providerDraft.modelName.trim() || providerDraft.modelId.trim(), enabled: true }]
    : []
  draft.providers.push({ id, name, baseUrl: providerDraft.baseUrl.trim(), apiKey: providerDraft.apiKey, apiFormat: providerDraft.apiFormat, models })
  providerDraft.name = ''; providerDraft.baseUrl = ''; providerDraft.apiKey = ''; providerDraft.apiFormat = AGENT_DEFAULT_PROVIDER_API_TYPE; providerDraft.modelId = ''; providerDraft.modelName = ''
}
function removeProvider(index: number) { draft.providers.splice(index, 1) }
function addModel(provider: AgentModelProvider) {
  const id = providerDraft.modelId.trim()
  if (!id) return
  provider.models.push({ id, name: providerDraft.modelName.trim() || id, enabled: true })
  providerDraft.modelId = ''; providerDraft.modelName = ''
}
function toggleModel(provider: AgentModelProvider, index: number) { provider.models[index]!.enabled = !provider.models[index]!.enabled }

// ── 模型设置节：单条模型的元数据编辑（ZCode 模型行的「编辑模型配置」）──────────────────────
// 编辑对象就是列表里当前点开的那一条（provider + model）—— 页面没有第二份「当前模型」状态；
// 草稿、校验与非法文案都在 `ModelMetadataSection` 里，提交结果写回同一条列表项（同一批响应式
// 对象），随本页「保存」一起归一化并持久化（与页面上其他草稿同一口径）。
const editingModel = ref<{ providerId: string; modelId: string } | null>(null)
/** 入口按钮文案 —— zh-CN.ts:2553 `settings.modelProvider.editModel`（上游弹窗的标题与铅笔按钮同名）。 */
const MODEL_EDIT_LABEL = '编辑模型配置'

function beginModelEdit(provider: AgentModelProvider, model: AgentProviderModelConfig) {
  const current = editingModel.value
  editingModel.value = current?.providerId === provider.id && current.modelId === model.id
    ? null
    : { providerId: provider.id, modelId: model.id }
}
function isEditingModel(provider: AgentModelProvider, model: AgentProviderModelConfig): boolean {
  const current = editingModel.value
  return current?.providerId === provider.id && current.modelId === model.id
}
function commitModelMetadata(model: AgentProviderModelConfig, next: AgentProviderModelConfig) {
  Object.assign(model, next)
  editingModel.value = null
}

// ── 使用统计节：会话库的实测数字 ────────────────────────────────────────────────
const usage = computed(() => {
  const store = createAgentSessionStore(undefined, undefined, props.workspacePath ?? undefined)
  const list = store.summaries()
  return { sessions: list.length, limit: AGENT_SESSION_LIMIT, messages: list.reduce((sum, item) => sum + item.entries, 0) }
})

const permissionTiers = [
  { value: 'allow', label: '允许（不询问）' },
  { value: 'ask', label: '每次询问' },
  { value: 'never', label: '禁止' },
] as const
</script>

<template>
  <div class="agent-settings">
    <!-- 侧栏：三组 + 节（顺序照 settingsPageConfig.ts；点击切节，同一页内不弹新窗）。 -->
    <nav class="agent-settings-nav" aria-label="Agent 设置节">
      <section v-for="group in SECTION_GROUPS" :key="group.title" class="agent-settings-group">
        <h4>{{ group.title }}</h4>
        <button
          v-for="item in group.items" :key="item.id"
          class="agent-settings-item" :class="{ active: section === item.id }"
          :aria-current="section === item.id ? 'page' : undefined"
          @click="selectSection(item.id)"
        ><component :is="item.icon" :size="iconSize.menu" aria-hidden="true" /><span>{{ item.label }}</span></button>
      </section>
    </nav>

    <div class="agent-settings-body">
      <h3><span>{{ sectionLabel }}</span><span v-if="section === 'automations'" class="agent-settings-beta">Beta</span></h3>

      <!-- ── 常规：Agent 行为 + ZCode general 的真实字段 ───────────────────────── -->
      <template v-if="section === 'general'">
        <fieldset class="settings-fields">
          <div class="input-row"><label for="agent-perm-read">读文件</label>
            <select id="agent-perm-read" v-model="draft.permissions.read"><option v-for="t in permissionTiers" :key="t.value" :value="t.value">{{ t.label }}</option></select></div>
          <div class="input-row"><label for="agent-perm-write">写文件</label>
            <select id="agent-perm-write" v-model="draft.permissions.write"><option v-for="t in permissionTiers" :key="t.value" :value="t.value">{{ t.label }}</option></select></div>
          <div class="input-row"><label for="agent-perm-run">执行命令</label>
            <select id="agent-perm-run" v-model="draft.permissions.run"><option v-for="t in permissionTiers" :key="t.value" :value="t.value">{{ t.label }}</option></select></div>
          <div class="input-row"><label for="agent-perm-network">网络访问</label>
            <select id="agent-perm-network" v-model="draft.permissions.network"><option v-for="t in permissionTiers" :key="t.value" :value="t.value">{{ t.label }}</option></select></div>
          <label class="agent-check"><input v-model="draft.requireApprovalForWrites" type="checkbox" /><span>写入前确认</span></label>
          <label class="agent-check"><input v-model="draft.autoOpenDiff" type="checkbox" /><span>自动打开差异</span></label>
          <div class="input-row"><label for="agent-diff-context">差异上下文行数</label>
            <select id="agent-diff-context" v-model.number="draft.diffContextLines"><option v-for="n in AGENT_DIFF_CONTEXT_CHOICES" :key="n" :value="n">{{ n }} 行</option></select></div>
          <div class="input-row"><label for="agent-budget">上下文预算（字符）</label>
            <input id="agent-budget" v-model.number="draft.contextBudgetChars" type="number" :min="AGENT_CONTEXT_MIN_CHARS" :max="AGENT_CONTEXT_MAX_CHARS" step="1000" /></div>
        </fieldset>

        <h4 class="agent-sub">消息流</h4>
        <fieldset class="settings-fields">
          <label class="agent-check"><input v-model="draft.general.messageStreamShowTodos" type="checkbox" /><span>显示待办</span></label>
          <label class="agent-check"><input v-model="draft.general.messageStreamShowReasoning" type="checkbox" /><span>显示思考过程</span></label>
          <div class="input-row"><label for="agent-behavior">交互行为</label>
            <select id="agent-behavior" v-model="draft.general.zcodeInteractionBehavior">
              <option value="queue">队列</option><option value="guide">引导</option>
            </select></div>
          <label class="agent-check"><input v-model="draft.general.askUserQuestionAutoResolution" type="checkbox" /><span>提问自动继续</span></label>
          <label class="agent-check"><input v-model="draft.general.modelIoFullRetentionEnabled" type="checkbox" /><span>完整保留模型 I/O</span></label>
        </fieldset>

        <h4 class="agent-sub">网络</h4>
        <fieldset class="settings-fields">
          <div class="input-row"><label for="agent-proxy">HTTP 代理</label><input id="agent-proxy" v-model="draft.general.httpProxy" type="text" /></div>
          <div class="input-row"><label for="agent-noproxy">不使用代理的地址</label><input id="agent-noproxy" v-model="draft.general.httpProxyNoProxy" type="text" /></div>
          <div class="input-row"><label for="agent-cacert">自定义证书</label><input id="agent-cacert" v-model="draft.general.httpProxyCaCertPath" type="text" /></div>
        </fieldset>
      </template>

      <!-- ── 模型设置：自定义供应商 ────────────────────────────── -->
      <template v-else-if="section === 'modelProvider'">
        <div v-for="(provider, index) in draft.providers" :key="provider.id" class="agent-provider">
          <div class="agent-provider-head">
            <strong>{{ provider.name }}</strong>
            <code class="agent-provider-url">{{ provider.baseUrl || '（未填端点）' }}</code>
            <button class="agent-provider-remove" @click="removeProvider(index)">删除</button>
          </div>
          <div class="input-row agent-provider-format"><label :for="`provider-api-format-${provider.id}`">API 格式</label>
            <select :id="`provider-api-format-${provider.id}`" v-model="provider.apiFormat">
              <option v-for="format in AGENT_PROVIDER_API_FORMATS" :key="format" :value="format">{{ AGENT_PROVIDER_API_FORMAT_TITLES[format] }}</option>
            </select></div>
          <ul class="agent-model-list">
            <li v-for="(model, modelIndex) in provider.models" :key="model.id">
              <div class="agent-model-row">
                <label class="agent-check"><input :checked="model.enabled" type="checkbox" @change="toggleModel(provider, modelIndex)" /><span><code>{{ model.id }}</code> · {{ model.name }}</span></label>
                <button
                  class="agent-model-edit" type="button" :title="MODEL_EDIT_LABEL" :aria-label="MODEL_EDIT_LABEL"
                  :aria-expanded="isEditingModel(provider, model)" @click="beginModelEdit(provider, model)"
                ><Pencil :size="iconSize.control" aria-hidden="true" /></button>
              </div>
              <!-- 元数据编辑器：编辑的就是这一条（ZCode 模型行铅笔 → ProviderModelMetadataDialog 的内联版）。 -->
              <ModelMetadataSection
                v-if="isEditingModel(provider, model)" :key="model.id" :model="model"
                @commit="commitModelMetadata(model, $event)" @cancel="editingModel = null"
              />
            </li>
          </ul>
          <div class="agent-provider-add">
            <input v-model="providerDraft.modelId" type="text" aria-label="模型 ID" />
            <input v-model="providerDraft.modelName" type="text" aria-label="模型显示名" />
            <button class="agent-mini" @click="addModel(provider)">加模型</button>
          </div>
        </div>
        <fieldset class="settings-fields">
          <div class="input-row"><label for="new-provider-name">供应商名称</label><input id="new-provider-name" v-model="providerDraft.name" type="text" /></div>
          <div class="input-row"><label for="new-provider-format">API 格式</label><select id="new-provider-format" v-model="providerDraft.apiFormat">
            <option v-for="format in AGENT_PROVIDER_API_FORMATS" :key="format" :value="format">{{ AGENT_PROVIDER_API_FORMAT_TITLES[format] }}</option>
          </select></div>
          <div class="input-row"><label for="new-provider-url">Base URL</label><input id="new-provider-url" v-model="providerDraft.baseUrl" type="text" /></div>
          <div class="input-row"><label for="new-provider-key">API Key</label><input id="new-provider-key" v-model="providerDraft.apiKey" type="password" /></div>
          <div class="input-row"><label for="new-provider-model">首个模型 ID</label><input id="new-provider-model" v-model="providerDraft.modelId" type="text" /></div>
          <button class="agent-mini" :disabled="!providerDraft.name.trim()" @click="addProvider">新建供应商</button>
        </fieldset>
      </template>

      <!-- ── 命令：斜杠命令表（AGENT_COMMANDS，全部有真实落点）───────────────────── -->
      <template v-else-if="section === 'commands'">
        <ul class="agent-command-list">
          <li v-for="command in AGENT_COMMANDS" :key="command.id">
            <code>{{ command.label }}</code>
          </li>
        </ul>
      </template>

      <!-- ── 已各有独立模块的节：各自一个组件（草稿与保存都在节里）────────────────── -->
      <MemorySettingsSection v-else-if="section === 'memory'" />
      <HooksSettingsSection v-else-if="section === 'hooks'" />
      <AutomationsSettingsSection v-else-if="section === 'automations'" />
      <SkillsSettingsSection v-else-if="section === 'skill'" :workspace-path="props.workspacePath" />
      <SubagentsSettingsSection v-else-if="section === 'subagents'" />
      <PluginsSettingsSection v-else-if="section === 'plugin'" />
      <McpSettingsSection v-else-if="section === 'mcp'" />

      <!-- ── 使用统计：会话库实测数字 ──────────────────────────────────────────── -->
      <template v-else-if="section === 'usage'">
        <div class="agent-kv"><span>会话数</span><code>{{ usage.sessions }} / 上限 {{ usage.limit }}</code></div>
        <div class="agent-kv"><span>消息条数</span><code>{{ usage.messages }}</code></div>
        <div class="agent-kv"><span>当前模型</span><code>{{ draft.model }}</code></div>
      </template>

      <p v-if="problems.length" class="agent-problems" role="alert">{{ problems.join(' ') }}</p>
      <p v-else-if="savedNote" class="agent-saved" role="status">{{ savedNote }}</p>
      <div v-if="section === 'general' || section === 'modelProvider'" class="agent-actions">
        <button class="primary-button" :disabled="problems.length > 0" @click="save">保存</button>
        <button class="agent-mini" @click="resetDefaults">恢复默认</button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.agent-settings { display: flex; align-items: stretch; gap: var(--space-3); min-width: 0; min-height: 0; flex: 1; }
.agent-settings-nav { width: 188px; flex: 0 0 188px; display: flex; flex-direction: column; gap: var(--space-3); max-height: 100%; overflow-y: auto; padding: 0 var(--space-2) 0 0; border: 0; border-right: 1px solid var(--line); border-radius: 0; background: transparent; }
.agent-settings-group { display: flex; flex-direction: column; gap: var(--space-1); }
.agent-settings-group + .agent-settings-group { padding-top: var(--space-2); border-top: 1px solid var(--line); }
.agent-settings-group > h4 { margin: 0 0 var(--space-1); padding: 0 var(--space-1); color: var(--muted); font-size: 12px; font-weight: 600; }
.agent-settings-item { display: flex; align-items: center; gap: var(--space-2); width: 100%; min-width: 0; min-height: var(--ctrl-height); padding: 0 var(--space-2); border: 0; border-radius: var(--radius-xs); background: transparent; color: var(--secondary); font: inherit; font-size: 12px; line-height: 1.35; text-align: left; cursor: pointer; transition: background-color var(--dur-1) var(--ease), color var(--dur-1) var(--ease); }
.agent-settings-item > span { min-width: 0; overflow-wrap: anywhere; }
.agent-settings-item:hover { background: var(--hover); color: var(--text); }
.agent-settings-item.active { background: var(--selected); color: var(--bright); box-shadow: inset 2px 0 var(--accent); }
.agent-settings-item:focus-visible { outline: var(--focus-ring); outline-offset: var(--focus-ring-offset-inset); }
.agent-settings-body { flex: 1; min-width: 0; min-height: 0; overflow-y: auto; scrollbar-gutter: stable; padding: 0 0 var(--space-3); }
.agent-settings-body > h3 { display: flex; align-items: center; flex-wrap: wrap; gap: var(--space-3); margin: 0 0 var(--space-3); padding-bottom: var(--space-2); border-bottom: 1px solid var(--line); color: var(--bright); font-size: 15px; font-weight: 600; }
.agent-settings-beta { display: inline-flex; align-items: center; min-height: var(--ctrl-height-sm); padding: 0 var(--space-2); border: 1px solid var(--accent); border-radius: var(--radius-pill); color: var(--accent); font-size: 11px; font-weight: 600; line-height: 1; }
.agent-sub { margin: var(--space-4) 0 var(--space-2); padding-bottom: var(--space-1); border-bottom: 1px solid var(--line); color: var(--bright); font-size: 13px; font-weight: 600; }
.agent-settings-body > .settings-fields { display: flex; flex-direction: column; gap: 0; min-width: 0; margin: 0; padding: 0 var(--space-2); border: 0; border-top: 1px solid var(--line); border-bottom: 1px solid var(--line); border-radius: 0; background: transparent; }
.agent-settings-body > .settings-fields > :is(.input-row, .agent-check) { min-height: var(--ctrl-height); padding: var(--space-1) 0; }
.agent-settings-body > .settings-fields > :is(.input-row, .agent-check) + :is(.input-row, .agent-check) { border-top: 1px solid var(--line); }
.agent-settings-body .input-row { display: grid; grid-template-columns: minmax(0, 1fr) minmax(150px, 220px); align-items: center; gap: var(--space-2) var(--space-4); }
.agent-settings-body .input-row > label { min-width: 0; color: var(--text); font-size: 12px; font-weight: 500; }
.agent-settings-body :is(input:not([type='checkbox']):not([type='radio']), select, textarea) { box-sizing: border-box; width: 100%; max-width: 100%; min-width: 0; min-height: var(--ctrl-height); padding: var(--space-1) var(--space-2); border: 1px solid var(--line-strong); border-radius: var(--radius-xs); background: var(--editor); color: var(--text); font: inherit; font-size: 12px; }
.agent-settings-body :is(input[type='checkbox'], input[type='radio']) { width: var(--icon-size-checkbox); height: var(--icon-size-checkbox); margin: 2px 0 0; accent-color: var(--accent); }
.agent-check { display: flex; align-items: center; gap: var(--space-2); color: var(--text); font-size: 12px; line-height: 1.5; }
.agent-check input { flex: 0 0 auto; }
.agent-settings-body :is(input, select, textarea, button):focus-visible { outline: var(--focus-ring); outline-offset: var(--focus-ring-offset-inset); }
.agent-problems { margin: var(--space-2) 0 0; padding: var(--space-2) var(--space-3); border: 1px solid var(--error); border-radius: var(--radius-xs); background: var(--error-bg); color: var(--error); font-size: 12px; }
.agent-saved { margin: var(--space-2) 0 0; color: var(--success); font-size: 12px; }
.agent-actions { position: sticky; z-index: 1; bottom: 0; display: flex; justify-content: flex-end; gap: var(--space-2); margin-top: var(--space-2); padding: var(--space-2) 0; border-top: 1px solid var(--line); background: var(--editor); }
.agent-provider { margin: 0; padding: var(--space-2) 0; border: 0; border-bottom: 1px solid var(--line); border-radius: 0; background: transparent; }
.agent-provider-head { display: flex; align-items: center; gap: var(--space-2); min-width: 0; }
.agent-provider-head > strong { color: var(--bright); font-size: 14px; }
.agent-provider-url { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: var(--secondary); font: 11px var(--font-mono); }
.agent-provider-remove { min-height: var(--ctrl-height-sm); padding: 0 var(--space-2); border: 1px solid transparent; border-radius: var(--radius-xs); background: transparent; color: var(--error); font: inherit; font-size: 12px; cursor: pointer; }
.agent-provider-remove:hover { background: var(--error-bg); }
.agent-model-list { list-style: none; margin: var(--space-2) 0 0; padding: var(--space-1) 0 0; display: flex; flex-direction: column; gap: var(--space-1); border-top: 1px solid var(--line); }
.agent-model-list > li { min-width: 0; }
.agent-model-row { display: flex; align-items: center; gap: var(--space-2); min-width: 0; }
.agent-model-row > .agent-check { flex: 1 1 auto; min-width: 0; }
.agent-model-row > .agent-check > span { min-width: 0; overflow-wrap: anywhere; }
.agent-model-edit { display: inline-flex; align-items: center; justify-content: center; flex: 0 0 auto; width: var(--ctrl-height-sm); height: var(--ctrl-height-sm); padding: 0; border: 1px solid transparent; border-radius: var(--radius-xs); background: transparent; color: var(--secondary); cursor: pointer; transition: background-color var(--dur-1) var(--ease), color var(--dur-1) var(--ease); }
.agent-model-edit:hover { background: var(--hover); color: var(--text); }
.agent-model-edit[aria-expanded='true'] { background: var(--selected); color: var(--bright); }
.agent-empty-inline { color: var(--muted); font-size: 12px; }
.agent-provider-add { display: flex; flex-wrap: wrap; gap: var(--space-1); margin-top: var(--space-2); }
.agent-provider-add input { flex: 1 1 160px; min-width: 0; font-family: var(--font-mono) !important; }
.agent-mini { min-height: var(--ctrl-height-sm); padding: 0 var(--space-2); border: 1px solid var(--line-strong); border-radius: var(--radius-xs); background: var(--elevated); color: var(--text); font: inherit; font-size: 12px; cursor: pointer; }
.agent-mini:hover:not(:disabled) { background: var(--hover); }
.agent-mini:disabled { opacity: .5; cursor: default; }
.agent-command-list { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; }
.agent-command-list li { display: flex; align-items: baseline; flex-wrap: wrap; gap: var(--space-1) var(--space-2); padding: var(--space-2) 0; border-bottom: 1px solid var(--line); }
.agent-command-list code { color: var(--accent); font: 11px var(--font-mono); flex-shrink: 0; }
.agent-command-desc { color: var(--text); font-size: 12px; }
.agent-command-arg { margin-left: auto; color: var(--muted); font-size: 12px; }
.agent-kv { display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 220px); align-items: center; gap: var(--space-2); min-height: var(--ctrl-height); padding: var(--space-1) var(--space-2); border: 0; border-top: 1px solid var(--line); background: transparent; }
.agent-kv:nth-last-of-type(1) { border-bottom: 1px solid var(--line); }
.agent-kv > span { color: var(--muted); font-size: 12px; }
.agent-kv > code { min-width: 0; color: var(--text); font: 11px/1.5 var(--font-mono); overflow-wrap: anywhere; text-align: right; }
@media (max-width: 760px) {
  .agent-settings { flex-direction: column; gap: var(--space-2); }
  .agent-settings-nav { width: 100%; height: auto; flex: 0 0 auto; flex-direction: row; gap: var(--space-2); overflow-x: auto; overflow-y: hidden; max-height: none; padding: var(--space-1) 0; border-right: 0; border-bottom: 1px solid var(--line); overscroll-behavior-x: contain; scroll-snap-type: x proximity; scrollbar-width: thin; }
  .agent-settings-group { flex: 0 0 min(220px, 80%); display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); align-content: start; gap: var(--space-1); scroll-snap-align: start; }
  .agent-settings-group > h4 { grid-column: 1 / -1; }
  .agent-settings-group + .agent-settings-group { padding-top: 0; border-top: 0; border-left: 1px solid var(--line); padding-left: var(--space-2); }
  .agent-settings-item { min-height: var(--ctrl-height); padding: var(--space-1); }
  .agent-settings-body { height: auto; overflow: visible; padding: 0 0 var(--space-3); }
}
@media (max-width: 560px) {
  .agent-settings-body .input-row { grid-template-columns: minmax(0, 1fr); gap: var(--space-1); }
  .agent-settings-body > .settings-fields { padding-inline: var(--space-2); }
  .agent-provider-head { flex-wrap: wrap; }
  .agent-provider-url { flex-basis: 100%; order: 1; }
  .agent-provider-add input { flex-basis: 100%; }
  .agent-kv { grid-template-columns: minmax(0, 1fr); }
  .agent-kv > code { text-align: left; }
}
</style>
