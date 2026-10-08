<script setup lang="ts">
// 「自动化」节（ZCode section id `automations`，`settingsPageConfig.ts:115-119`，图标 AlarmClock，
// 标题带 Beta 徽标）的界面。
//
// 本节只做**接线**：形状 / cron 与重复规则计算 / 校验 / 筛选全在 `src/agentAutomations.ts`。
// 卡片上那句调度摘要逐字取模块的 `formatAutomationSchedule`（它移植自 ZCode 的
// `automationCardSchedule.ts`），失败徽章取 `hasAutomationFailure`（`automationFormat.ts:25-31`），
// 下次运行取 `automationNextRun`（基准时刻由这里注入 —— 模块不读系统时钟）。
import { computed, reactive, ref } from 'vue'
import { Plus, Save, Trash2 } from 'lucide-vue-next'
import AgentSettingsSectionShell from './AgentSettingsSectionShell.vue'
import AgentSettingsSwitch from './AgentSettingsSwitch.vue'
import { iconSize } from '../../uiIcons'
import {
  AGENT_AUTOMATIONS_BETA_BADGE, AGENT_AUTOMATIONS_MAX_ENTRIES, AGENT_AUTOMATION_LIFECYCLE_STATUSES,
  AGENT_AUTOMATION_STATUS_FILTERS,
  automationNextRun, automationStatusFilterOf, formatAutomationSchedule, hasAutomationFailure,
  loadAgentAutomations, normalizeAgentAutomations, saveAgentAutomations, validateAgentAutomations,
  type AgentAutomation,
} from '../../agentAutomations'

/** 这一节是什么：照 zh-CN `automations.description` 与节定义改写。 */
const draft = reactive(normalizeAgentAutomations(loadAgentAutomations()))
const problems = ref<string[]>([])
const status = ref('')
const filter = ref(draft.statusFilter)
const templateIndex = ref(0)

const filterLabels: Record<string, string> = {
  all: '全部',
  inProgress: '进行中',
  completed: '已完成',
  failed: '失败',
}
const lifecycleLabels: Record<string, string> = {
  active: '运行中',
  paused: '已暂停',
  completed: '已完成',
  failed: '已失败',
}
/** 列表按模块的分组口径筛（`automationStatusFilterOf`）。 */
const visible = computed(() => automationStatusFilterOf(draft, filter.value, draft.automations))

/** 下次运行：基准时刻在这里注入（模块是纯函数，不读系统时钟）。传对象而不是下标 —— */
const nextRunOf = (automation: AgentAutomation): string | null => automationNextRun(automation, Date.now())
const failOf = (automation: AgentAutomation): boolean => hasAutomationFailure(automation)

let nextId = draft.automations.length + 1

function addAutomation() {
  if (draft.automations.length >= AGENT_AUTOMATIONS_MAX_ENTRIES) return
  const id = `automation-${Date.now().toString(36)}-${nextId++}`
  draft.automations.push({
    id,
    title: '',
    prompt: '',
    cronExpr: '',
    scheduleRule: null,
    recurring: true,
    maxRuns: null,
    endAt: null,
    enabled: true,
    lifecycleStatus: 'active',
    dispatchStatus: 'idle',
    dispatchAttempts: 0,
    lastError: '',
    runCount: 0,
    nextRunAt: null,
    lastRunAt: null,
    workspaceKey: '',
    workspacePath: '',
    workspaceIdentity: '',
    templateId: '',
  })
}

/** 从模板目录建草稿。本仓模板目录出厂为空（模块不预置假模板），所以这里给的是空态说明。 */
function applyTemplate(index: number) {
  const template = draft.templates[index]
  if (!template) return
  addAutomation()
  const target = draft.automations[draft.automations.length - 1]
  if (!target) return
  target.title = template.title
  target.prompt = template.prompt
  target.cronExpr = template.cronExpr ?? ''
  target.templateId = template.id
}

function removeAt(index: number) {
  draft.automations.splice(index, 1)
}

function save() {
  draft.statusFilter = filter.value
  const found = validateAgentAutomations(draft)
  problems.value = found
  if (found.length) { status.value = ''; return }
  status.value = saveAgentAutomations(draft)
    ? '已保存到本机设置。'
    : '本次会话仍生效，但没有存下来（本机存储不可用）。'
}

/** 这一节的说明：交给共用外壳渲染（`AgentSettingsSectionShell.vue` 的 `description`）。 */
const SECTION_DESCRIPTION = '管理定时任务：调度摘要与下次运行时间。'
</script>

<template>
  <AgentSettingsSectionShell title="自动化" :description="SECTION_DESCRIPTION">
    <p class="auto-beta" role="note">
      <span class="auto-beta-chip">{{ AGENT_AUTOMATIONS_BETA_BADGE }}</span>
      <span>本节只保存配置：本仓还没有调度器去真的执行这些定时任务（`loadAgentAutomations` 之外没有消费方）。</span>
    </p>
    <fieldset class="settings-fields">
      <div class="auto-toolbar">
        <label for="auto-filter">状态筛选</label>
        <select id="auto-filter" v-model="filter">
          <option v-for="key in AGENT_AUTOMATION_STATUS_FILTERS" :key="key" :value="key">{{ filterLabels[key] }}</option>
        </select>
        <button class="settings-button" type="button" @click="addAutomation">
          <Plus :size="iconSize.control" aria-hidden="true" />新建
        </button>
        <button class="settings-button" type="button" @click="save">
          <Save :size="iconSize.control" aria-hidden="true" />保存
        </button>
      </div>

      <div v-if="draft.templates.length" class="auto-templates">
        <select v-model.number="templateIndex" aria-label="定时任务模板">
          <option v-for="(template, index) in draft.templates" :key="template.id" :value="index">{{ template.title }}</option>
        </select>
        <button class="settings-button" type="button" @click="applyTemplate(templateIndex)">
          <Plus :size="iconSize.control" aria-hidden="true" />用模板
        </button>
      </div>
      <p v-if="!draft.templates.length" class="field-hint">
        模板目录是空的：本仓没有预置假模板，直接点「新建」自己写一条。
      </p>

      <p v-if="!visible.length" class="field-hint">没有符合条件的任务。</p>

      <article v-for="(automation, index) in visible" :key="automation.id" class="auto-card">
        <div class="auto-card-head">
          <AgentSettingsSwitch
            v-model="automation.enabled"
            color="success"
            :accessible-name="`${automation.title || '未命名定时任务'}的启用开关`"
          />
          <strong class="auto-title">{{ automation.title || '未命名定时任务' }}</strong>
          <span class="auto-chip">{{ lifecycleLabels[automation.lifecycleStatus] }}</span>
          <span v-if="failOf(automation)" class="auto-chip auto-chip-fail">失败</span>
          <button
            class="settings-icon-button settings-icon-button-danger" type="button"
            :title="`删除定时任务 ${automation.title || '未命名定时任务'}`"
            :aria-label="`删除定时任务 ${automation.title || '未命名定时任务'}`" @click="removeAt(draft.automations.indexOf(automation))"
          ><Trash2 :size="iconSize.control" aria-hidden="true" /></button>
        </div>

        <p class="auto-card-meta">
          <span>{{ formatAutomationSchedule(automation) }}</span>
          <span v-if="nextRunOf(automation)">下次运行 {{ nextRunOf(automation) }}</span>
          <span>已运行 {{ automation.runCount }} 次</span>
        </p>

        <div class="auto-form">
          <div class="input-row">
            <label :for="`auto-title-${index}`">标题</label>
            <input :id="`auto-title-${index}`" v-model="automation.title" type="text" />
          </div>
          <div class="input-row auto-row-block">
            <label :for="`auto-prompt-${index}`">提示词</label>
            <textarea :id="`auto-prompt-${index}`" v-model="automation.prompt" rows="3" />
          </div>
          <div class="input-row">
            <label :for="`auto-cron-${index}`">cron 表达式</label>
            <input :id="`auto-cron-${index}`" v-model="automation.cronExpr" type="text" />
          </div>
          <div class="input-row">
            <label :for="`auto-lifecycle-${index}`">生命周期</label>
            <select :id="`auto-lifecycle-${index}`" v-model="automation.lifecycleStatus">
              <option v-for="key in AGENT_AUTOMATION_LIFECYCLE_STATUSES" :key="key" :value="key">{{ lifecycleLabels[key] }}</option>
            </select>
          </div>
          <label class="checkbox-row">
            <input v-model="automation.recurring" type="checkbox" :aria-label="`${automation.title || '未命名定时任务'}是否重复运行`" />
            <span>重复运行</span>
          </label>
          <!-- 自定义重复规则（scheduleRule）是 ZCode 的权威调度面，本仓只在**展示**它：
               它的六种单位各自还有 weekday / monthDays / months / monthlyMode 等字段，
               本节没有编辑器去逐项收集，硬塞一个只改 interval 的下拉就是放假控件。 -->
        </div>
      </article>

      <span v-if="status" class="settings-status" role="status">{{ status }}</span>
      <ul v-if="problems.length" class="settings-problems" role="alert">
        <li v-for="(problem, index) in problems" :key="index">{{ problem }}</li>
      </ul>
    </fieldset>
  </AgentSettingsSectionShell>
</template>

<style scoped>
.auto-title { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: var(--text); font-size: 12px; }
.auto-toolbar { display: flex; align-items: center; flex-wrap: wrap; gap: var(--space-1) var(--space-2); }
.auto-toolbar > label { color: var(--text); font-size: 12px; }
.auto-templates { display: flex; align-items: center; flex-wrap: wrap; gap: var(--space-1); }
.auto-card { padding: var(--space-3); border: 1px solid var(--line); border-radius: var(--radius-md); background: var(--elevated); }
.auto-card + .auto-card { margin-top: var(--space-2); }
.auto-card-head { display: flex; align-items: center; flex-wrap: wrap; gap: var(--space-2); }
.auto-card-meta { display: flex; flex-wrap: wrap; gap: var(--space-1) var(--space-3); margin: var(--space-1) 0 0; color: var(--muted); font-size: 12px; }
.auto-chip { padding: 0 var(--space-1); border: 1px solid var(--line-strong); border-radius: var(--radius-xs); color: var(--secondary); font-size: 12px; }
.auto-chip-fail { border-color: var(--error); color: var(--error); }
.auto-beta { display: flex; align-items: center; flex-wrap: wrap; gap: var(--space-2); margin: 0; color: var(--muted); font-size: 12px; line-height: 1.6; }
.auto-beta-chip { display: inline-flex; align-items: center; min-height: var(--ctrl-height-sm); padding: 0 var(--space-2); border: 1px solid var(--accent); border-radius: var(--radius-pill); color: var(--accent); font-size: 11px; font-weight: 600; line-height: 1; }
.auto-form { display: flex; flex-direction: column; gap: var(--space-1); margin-top: var(--space-2); }
.auto-row-block { align-items: flex-start; }
.auto-row-block > textarea { flex: 1 1 100%; min-height: 60px; padding: var(--space-1); resize: vertical; }
</style>
