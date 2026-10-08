<script setup lang="ts">
// 「子智能体」节（ZCode section id `subagents`，`settingsPageConfig.ts:82-87`，图标 Bot）的界面。
//
// 本节只做**接线**：形状 / 能力投影 / 归一化 / 校验全在 `src/agentSubagents.ts`。
// 同 id 冲突由 `validateAgentSubagentsSettings` 报出来（磁盘上两个文件），**不静默去重**。
// 模块里那份 `AGENT_SUBAGENT_ZCODE_TOOL_OPTIONS` 是 **ZCode 那边的工具档位对照**，
// **不在本节渲染**：本仓没有「按子智能体挑工具」的持久化与执行链，画成清单（尤其带勾选记号）
// 会被读成"本仓可选能力"。缺口只在 `docs/` 记录，不用界面文字解释。
import { computed, reactive, ref } from 'vue'
import { AlertTriangle, Save, Search } from 'lucide-vue-next'
import AgentSettingsSectionShell from './AgentSettingsSectionShell.vue'
import AgentSettingsSwitch from './AgentSettingsSwitch.vue'
import { iconSize } from '../../uiIcons'
import {
  AGENT_SUBAGENT_GROUP_LABELS, AGENT_SUBAGENT_RISKY_TOOLS,
  AGENT_SUBAGENT_SCOPE_LABELS, AGENT_SUBAGENT_ZCODE_TOOL_OPTIONS,
  loadAgentSubagentsSettings, normalizeAgentSubagentsSettings, saveAgentSubagentsSettings,
  subagentCapabilities, validateAgentSubagentsSettings,
  type AgentSubagent,
  type AgentSubagentScopeFilter,
} from '../../agentSubagents'

/** 草稿：本节自管，不塞进 `AgentSettingsPage.vue` 的 draft（那是别的节共用的面）。 */
const draft = reactive(normalizeAgentSubagentsSettings(loadAgentSubagentsSettings()))
const problems = ref<string[]>([])
const status = ref('')

const SCOPE_FILTERS: readonly AgentSubagentScopeFilter[] = ['all', 'enabled', 'disabled']

/**
 * 筛选三档的中文名。模块只导出了 `AGENT_SUBAGENT_SCOPE_LABELS`（**作用域**标签），
 * 没有导出筛选档的标签，而 ZCode 那边的文案在 zh-CN `settings.subagents.filter.*`
 * （`:3633-3635`：全部 / 已启用 / 已停用）—— 这里是这三句的唯一一份，不与模块重复。
 */
const FILTER_LABELS: Record<AgentSubagentScopeFilter, string> = { all: '全部', enabled: '已启用', disabled: '已停用' }

/**
 * 作用域标签。模块的 `AGENT_SUBAGENT_SCOPE_LABELS` 只有 `built-in` / `plugin` / `workspace`
 * 三键（ZCode `zh-CN.ts:3629-3631` 就是这三句，**没有 user 那一条**），而条目的 `scope`
 * 还可能是 `user`。这里缺标签就显示枚举原值，不自己编一个中文名（编了就成了第二个来源）。
 */
function scopeLabel(entry: AgentSubagent): string {
  return AGENT_SUBAGENT_SCOPE_LABELS[entry.scope as keyof typeof AGENT_SUBAGENT_SCOPE_LABELS] ?? entry.scope
}

/** 分组顺序照 ZCode 的三分组（`AGENT_SUBAGENT_GROUP_LABELS` 的键序）。 */
const GROUPS = Object.keys(AGENT_SUBAGENT_GROUP_LABELS) as Array<keyof typeof AGENT_SUBAGENT_GROUP_LABELS>

function matchesFilter(entry: AgentSubagent): boolean {
  if (draft.scopeFilter === 'enabled') return entry.enabled
  if (draft.scopeFilter === 'disabled') return !entry.enabled
  return true
}

/** 搜索词命中名称 / 描述 / 定义文件路径（ZCode 的搜索框是纯前端过滤）。 */
function matchesQuery(entry: AgentSubagent): boolean {
  const query = draft.query.trim().toLowerCase()
  if (!query) return true
  return `${entry.name}\n${entry.description}\n${entry.path}`.toLowerCase().includes(query)
}

/** 每个分组下的条目（能力投影由模块判，本组件不重算 editable / readOnly）。 */
const groups = computed(() => GROUPS.map(group => ({
  key: group,
  label: AGENT_SUBAGENT_GROUP_LABELS[group],
  entries: draft.entries.filter(entry => subagentCapabilities(entry).group === group && matchesQuery(entry) && matchesFilter(entry)),
})).filter(group => group.entries.length > 0))

/** 同 id 的两条都保留（磁盘上两个文件 = 真实冲突），由 validate 当场报。 */
function conflictIds(): string[] {
  const seen = new Set<string>()
  const dup = new Set<string>()
  for (const entry of draft.entries) {
    if (seen.has(entry.id)) dup.add(entry.id)
    seen.add(entry.id)
  }
  return [...dup]
}

const duplicates = computed(() => conflictIds())

function toggleEnabled(entry: AgentSubagent, enabled: boolean) {
  const ids = draft.disabledAgentIds.filter(id => id !== entry.id)
  if (!enabled) ids.push(entry.id)
  draft.disabledAgentIds = ids
}

function save() {
  const found = validateAgentSubagentsSettings(draft)
  problems.value = found
  if (found.length) { status.value = ''; return }
  status.value = saveAgentSubagentsSettings(draft)
    ? '已保存到本机设置。'
    : '本次会话仍生效，但没有存下来（本机存储不可用）。'
}

/** 这一节的说明：交给共用外壳渲染（`AgentSettingsSectionShell.vue` 的 `description`）。 */
const SECTION_DESCRIPTION = '管理用户级子智能体 Markdown 文件（ZCode Agent 读取的那一份，`settings.subagents.description`）。'
</script>

<template>
  <AgentSettingsSectionShell title="子智能体" :description="SECTION_DESCRIPTION">
    <div class="sub-toolbar">
      <label class="sub-search">
        <Search :size="iconSize.dense" aria-hidden="true" />
        <input v-model="draft.query" type="text" placeholder="搜索子智能体…" aria-label="搜索子智能体" />
      </label>
      <select v-model="draft.scopeFilter" class="sub-select" aria-label="按启用状态筛选">
        <option v-for="option in SCOPE_FILTERS" :key="option" :value="option">
          {{ FILTER_LABELS[option] }}
        </option>
      </select>
    </div>

    <section v-for="group in groups" :key="group.key" class="sub-group">
      <h4 class="sub-group-title">{{ group.label }}（{{ group.entries.length }}）</h4>
      <div v-for="entry in group.entries" :key="entry.path" class="sub-entry">
        <div class="sub-entry-head">
          <span class="sub-entry-name">{{ entry.name }}</span>
          <span class="sub-tag">{{ scopeLabel(entry) }}</span>
          <span v-if="duplicates.includes(entry.id)" class="sub-tag sub-tag-error">重名</span>
        </div>
        <p v-if="entry.description" class="sub-entry-desc">{{ entry.description }}</p>
        <p class="sub-entry-meta">
          <span class="sub-field">工具：{{ subagentCapabilities(entry).toolLabel }}</span>
          <span class="sub-field">模型：{{ subagentCapabilities(entry).modelLabel }}</span>
        </p>
        <ul v-if="subagentCapabilities(entry).riskyTools.length" class="sub-risky">
          <li v-for="tool in subagentCapabilities(entry).riskyTools" :key="tool" class="sub-risky-item">
            <AlertTriangle :size="iconSize.inline" aria-hidden="true" />{{ tool }}
          </li>
        </ul>
        <p class="sub-entry-path">{{ entry.path }}</p>
        <ul v-if="entry.diagnostics?.length" class="settings-problems" role="alert">
          <li v-for="(diagnostic, index) in entry.diagnostics" :key="index">
            {{ diagnostic.code }}：{{ diagnostic.message }}
          </li>
        </ul>
        <div v-if="subagentCapabilities(entry).supportsEnabledToggle" class="sub-check">
          <AgentSettingsSwitch
            :model-value="entry.enabled"
            size="compact"
            :accessible-name="`切换 ${entry.name} 的启用状态`"
            @update:model-value="toggleEnabled(entry, $event)"
          />
          <span>启用</span>
        </div>
      </div>
    </section>


    <!-- ZCode 那边的工具档位对照（`AGENT_SUBAGENT_ZCODE_TOOL_OPTIONS`）——**只读清单**：
         本仓没有"按子智能体挑工具"的执行路径（勾了也存不进任何东西），所以既没有勾选框，
         **也不画勾选记号** —— 勾出来的样子会被读成"这些能力本仓已具备"（2026-10-08 交接件口径）。 -->
    <section class="settings-box">
      <h4 class="settings-box-title">ZCode 那边可选的档位</h4>
      <ul class="sub-zcode-tools">
        <li v-for="tool in AGENT_SUBAGENT_ZCODE_TOOL_OPTIONS" :key="tool">
          {{ tool }}
        </li>
      </ul>
    </section>

    <div class="settings-actions">
      <button class="settings-button settings-button-primary" type="button" @click="save">
        <Save :size="iconSize.control" aria-hidden="true" />保存
      </button>
      <span v-if="status" class="settings-status" role="status">{{ status }}</span>
    </div>
    <ul v-if="problems.length" class="settings-problems" role="alert">
      <li v-for="(problem, index) in problems" :key="index">{{ problem }}</li>
    </ul>
  </AgentSettingsSectionShell>
</template>

<style scoped>
.sub-toolbar { display: flex; align-items: center; flex-wrap: wrap; gap: var(--space-1) var(--space-2); }
.sub-search { display: flex; align-items: center; gap: var(--space-1); flex: 1; min-width: 160px; min-height: var(--ctrl-height-sm); padding: 0 var(--space-1); border: 1px solid var(--line-strong); border-radius: var(--radius-xs); background: var(--editor); color: var(--muted); }
.sub-search input { flex: 1; min-width: 0; border: 0; background: transparent; color: var(--text); font: inherit; font-size: 12px; }
.sub-select { min-height: var(--ctrl-height-sm); padding: 0 var(--space-1); border: 1px solid var(--line-strong); border-radius: var(--radius-xs); background: var(--editor); color: var(--text); font: inherit; font-size: 12px; }
.sub-group { display: flex; flex-direction: column; gap: var(--space-2); }
.sub-zcode-tools { display: flex; flex-wrap: wrap; gap: var(--space-1) var(--space-3); margin: 0; padding: 0; list-style: none; color: var(--secondary); font-size: 12px; }
.sub-zcode-tools li { display: flex; align-items: center; gap: var(--space-1); }
.sub-group-title { margin: 0; padding-bottom: var(--space-1); border-bottom: 1px solid var(--line); color: var(--secondary); font-size: 12px; font-weight: 600; }
.sub-entry { display: flex; flex-direction: column; gap: var(--space-2); min-width: 0; padding: var(--space-3); border: 1px solid var(--line); border-radius: var(--radius-md); background: var(--panel); }
.sub-entry-head { display: flex; align-items: center; flex-wrap: wrap; gap: var(--space-1); }
.sub-entry-name { color: var(--text); font-size: 12px; font-weight: 600; }
.sub-tag { padding: 0 var(--space-1); border: 1px solid var(--line-strong); border-radius: var(--radius-xs); color: var(--muted); font-size: 12px; }
.sub-tag-error { color: var(--error); border-color: var(--error); }
.sub-entry-desc { margin: 0; color: var(--secondary); font-size: 12px; line-height: 1.6; }
.sub-entry-meta { display: flex; align-items: center; flex-wrap: wrap; gap: var(--space-2); margin: 0; }
.sub-field { color: var(--muted); font-size: 12px; }
.sub-risky { display: flex; align-items: center; flex-wrap: wrap; gap: var(--space-1); margin: 0; padding: 0; list-style: none; }
.sub-risky-item { display: inline-flex; align-items: center; gap: var(--space-1); color: var(--warning); font-size: 12px; }
.sub-entry-path { margin: 0; color: var(--muted); font-family: var(--font-mono); font-size: 12px; word-break: break-all; }
.sub-check { display: inline-flex; align-items: center; gap: var(--space-1); color: var(--text); font-size: 12px; }
.sub-toolbar :is(input, select):focus-visible { outline: var(--focus-ring); outline-offset: var(--focus-ring-offset); }
</style>
