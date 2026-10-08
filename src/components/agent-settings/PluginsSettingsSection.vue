<script setup lang="ts">
// 「插件」节（ZCode section id `plugin`，`settingsPageConfig.ts:88-93`，图标 Blocks）的界面。
//
// 本节只做**接线**：形状 / 能力投影 / 启停闸门 / 归一化 / 校验全在 `src/agentPlugins.ts`。
//
// Tab 2-4（MCP / 技能 / 命令）在本仓是**独立的设置节**（`AgentSettingsPage.vue` 的
// `mcp` / `skill` / `commands`），ZCode 那边是同一页的四个页签。本节只渲染「插件」这一页签的内容。
// 启停走模块的 `applyPluginEnabledChange`：依赖没满足（`available === false`）或
// `packageStatus === 'missing'` 时**拒绝启用**并显示原因，绝不先把开关拨过去。
import { computed, reactive, ref } from 'vue'
import { Save, Search } from 'lucide-vue-next'
import AgentSettingsSectionShell from './AgentSettingsSectionShell.vue'
import { IdeaCheckedIcon } from '../icons/toolWindowIcons'
import { iconSize } from '../../uiIcons'
import { agentPluginScopeBadge } from '../../agentPluginRegistry'
import {
  AGENT_PLUGIN_COMPONENT_LABELS, AGENT_PLUGIN_GROUP_LABELS, AGENT_PLUGIN_SCOPE_LABELS,
  AGENT_PLUGIN_SCOPES, AGENT_PLUGIN_TABS, AGENT_PLUGINS_TITLE,
  applyPluginEnabledChange, loadAgentPluginsSettings, normalizeAgentPluginsSettings,
  pluginCapabilityProjectionOf, saveAgentPluginsSettings, validateAgentPluginsSettings,
  type AgentPluginEntry,
  type AgentPluginScope,
} from '../../agentPlugins'

/**
 * 四个页签的中文名。模块只导出了页签的**键**（`AGENT_PLUGIN_TABS`），没有导标签；
 * ZCode 那边的文案在 zh-CN `settings.plugin.tab.*`（`:3698-3701`：插件 / MCP / 技能 / 命令）。
 * 这里是这四句的唯一一份，不与模块重复。
 */
const TAB_LABELS: Record<(typeof AGENT_PLUGIN_TABS)[number], string> = {
  plugins: '插件', mcps: 'MCP', skills: '技能', commands: '命令',
}

/** 这一节是什么。标题与四个页签名取自 zh-CN `settings.plugins.title` / `settings.plugin.tab.*`。 */
/** 草稿：本节自管，不塞进 `AgentSettingsPage.vue` 的 draft。 */
const draft = reactive(normalizeAgentPluginsSettings(loadAgentPluginsSettings()))
const problems = ref<string[]>([])
const status = ref('')
const changeNote = ref('')

/** 每个条目一份能力投影（模块判，本组件不重算 canEnable / 分组 / 组件数）。 */
function capabilityOf(entry: AgentPluginEntry) {
  return pluginCapabilityProjectionOf(entry, draft.builtInPluginIds, draft.marketplaces)
}

function enabledScopeLabel(entry: AgentPluginEntry) {
  // ZCode SettingsScopeBadge uses enabledSource ?? "default" and its three existing labels.
  return agentPluginScopeBadge(entry, draft.scope).label ?? '默认'
}

/** 两个分组各按置顶序排（模块给的 `documentRank`，官方文档卡靠前）。 */
const groups = computed(() => (Object.keys(AGENT_PLUGIN_GROUP_LABELS) as Array<keyof typeof AGENT_PLUGIN_GROUP_LABELS>).map(key => ({
  key,
  label: AGENT_PLUGIN_GROUP_LABELS[key],
  entries: draft.entries
    .filter(entry => capabilityOf(entry).group === key)
    .filter(entry => {
      const query = draft.query.trim().toLowerCase()
      return !query || `${entry.name}\n${entry.id}\n${entry.marketplace}\n${entry.description ?? ''}`.toLowerCase().includes(query)
    })
    .sort((left, right) => capabilityOf(left).documentRank - capabilityOf(right).documentRank),
})).filter(group => group.entries.length > 0))

/**
 * 启停。**只把模块判定成功的那一次落到草稿上**（`applied === false` 时原样返回列表）。
 * 这与 ZCode `pluginEnabledChange.ts` 的契约一致：服务端没确认成功就不许继续授权引导。
 */
function toggle(entry: AgentPluginEntry) {
  const capability = capabilityOf(entry)
  const result = applyPluginEnabledChange(draft.entries, entry.id, !entry.enabled, capability.dependencySatisfied)
  if (result.applied) draft.entries = result.entries
  changeNote.value = result.message
}

function setScope(scope: AgentPluginScope) {
  draft.scope = scope
  draft.scopeKey = scope
}

function save() {
  const found = validateAgentPluginsSettings(draft)
  problems.value = found
  if (found.length) { status.value = ''; return }
  status.value = saveAgentPluginsSettings(draft)
    ? '已保存到本机设置。'
    : '本次会话仍生效，但没有存下来（本机存储不可用）。'
}
</script>

<template>
  <AgentSettingsSectionShell>
    <div class="pl-toolbar">
      <label class="pl-search">
        <Search :size="iconSize.dense" aria-hidden="true" />
        <input v-model="draft.query" type="text" placeholder="搜索插件…" aria-label="搜索插件" />
      </label>
      <select
        class="pl-select" :value="draft.scope"
        :aria-label="`插件作用域，当前「${AGENT_PLUGIN_SCOPE_LABELS[draft.scope]}」`"
        @change="setScope(($event.target as HTMLSelectElement).value as AgentPluginScope)"
      >
        <option v-for="scope in AGENT_PLUGIN_SCOPES" :key="scope" :value="scope">
          {{ AGENT_PLUGIN_SCOPE_LABELS[scope] }}
        </option>
      </select>
    </div>

    <section v-for="group in groups" :key="group.key" class="pl-group">
      <h4 class="pl-group-title">{{ group.label }}（{{ group.entries.length }}）</h4>
      <div v-for="entry in group.entries" :key="entry.id" class="pl-entry">
        <div class="pl-entry-head">
          <label class="pl-check">
            <input
              type="checkbox" :checked="entry.enabled" :disabled="!capabilityOf(entry).canEnable && !entry.enabled"
              :aria-label="`切换插件 ${entry.name} 的启用状态`"
              @change="toggle(entry)"
            />
            <IdeaCheckedIcon v-if="entry.enabled" :size="iconSize.dense" aria-hidden="true" />
            <span class="pl-entry-name">{{ entry.name }}</span>
          </label>
          <span class="pl-tag">{{ capabilityOf(entry).sourceLabel }}</span>
          <span v-if="entry.version" class="pl-tag">{{ entry.version }}</span>
        </div>
        <p v-if="entry.description" class="pl-entry-desc">{{ entry.description }}</p>
        <p class="pl-entry-meta">
          <span class="pl-field">{{ capabilityOf(entry).componentCount }} 个组件</span>
          <span class="pl-field">作用域：{{ enabledScopeLabel(entry) }}</span>
          <span v-if="entry.mcpServerNames.length" class="pl-field">MCP：{{ entry.mcpServerNames.join('、') }}</span>
        </p>
        <p v-if="capabilityOf(entry).blockedReason" class="pl-blocked">
          {{ capabilityOf(entry).blockedReason }}
        </p>
        <ul v-if="capabilityOf(entry).componentGroups.length" class="pl-components">
          <li v-for="component in capabilityOf(entry).componentGroups" :key="component.kind" class="pl-component">
            <span class="pl-component-label">
              {{ AGENT_PLUGIN_COMPONENT_LABELS[component.kind] }}（{{ component.count }}）
            </span>
            <span class="pl-component-items">{{ component.items.map(item => item.name).join('、') }}</span>
          </li>
        </ul>
        <p class="pl-entry-path">{{ entry.rootPath }}</p>
      </div>
    </section>

    <p v-if="changeNote" class="settings-status" role="status">{{ changeNote }}</p>

    <div class="settings-actions">
        <button class="settings-button settings-button-primary" type="button" @click="save">
        <Save :size="iconSize.control" aria-hidden="true" />保存
      </button>
    </div>
    <ul v-if="problems.length" class="settings-problems" role="alert">
      <li v-for="(problem, index) in problems" :key="index">{{ problem }}</li>
    </ul>
  </AgentSettingsSectionShell>
</template>

<style scoped>
.pl-toolbar { display: flex; align-items: center; flex-wrap: wrap; gap: var(--space-2); }
.pl-search { display: flex; align-items: center; gap: var(--space-1); flex: 1; min-width: 160px; min-height: var(--ctrl-height-sm); padding: 0 var(--space-1); border: 1px solid var(--line-strong); border-radius: var(--radius-xs); background: var(--editor); color: var(--muted); }
.pl-search input { flex: 1; min-width: 0; border: 0; background: transparent; color: var(--text); font: inherit; font-size: 12px; }
.pl-select { min-height: var(--ctrl-height-sm); padding: 0 var(--space-1); border: 1px solid var(--line-strong); border-radius: var(--radius-xs); background: var(--editor); color: var(--text); font: inherit; font-size: 12px; }
.pl-group { display: flex; flex-direction: column; gap: var(--space-2); }
.pl-group-title { margin: 0; padding-bottom: var(--space-1); border-bottom: 1px solid var(--line); color: var(--secondary); font-size: 12px; font-weight: 600; }
.pl-entry { display: flex; flex-direction: column; gap: var(--space-2); padding: var(--space-3); border: 1px solid var(--line); border-radius: var(--radius-md); background: var(--panel); }
.pl-entry-head { display: flex; align-items: center; flex-wrap: wrap; gap: var(--space-1); }
.pl-check { display: inline-flex; align-items: center; gap: var(--space-1); color: var(--text); font-size: 12px; }
.pl-check input { width: var(--icon-size-checkbox); height: var(--icon-size-checkbox); margin: 0; accent-color: var(--accent); }
.pl-entry-name { font-weight: 600; }
.pl-tag { padding: 0 var(--space-1); border: 1px solid var(--line-strong); border-radius: var(--radius-xs); color: var(--muted); font-size: 12px; }
.pl-entry-desc { margin: 0; color: var(--secondary); font-size: 12px; line-height: 1.6; }
.pl-entry-meta { display: flex; align-items: center; flex-wrap: wrap; gap: var(--space-2); margin: 0; }
.pl-field { color: var(--muted); font-size: 12px; }
.pl-blocked { margin: 0; color: var(--warning); font-size: 12px; line-height: 1.6; }
.pl-components { display: flex; flex-direction: column; gap: var(--space-1); margin: 0; padding: 0; list-style: none; }
.pl-component { display: flex; align-items: center; flex-wrap: wrap; gap: var(--space-1) var(--space-2); }
.pl-component-label { color: var(--secondary); font-size: 12px; }
.pl-component-items { color: var(--muted); font-family: var(--font-mono); font-size: 12px; word-break: break-all; }
.pl-entry-path { margin: 0; color: var(--muted); font-family: var(--font-mono); font-size: 12px; word-break: break-all; }
.pl-toolbar :is(input, select):focus-visible { outline: var(--focus-ring); outline-offset: var(--focus-ring-offset); }
</style>
