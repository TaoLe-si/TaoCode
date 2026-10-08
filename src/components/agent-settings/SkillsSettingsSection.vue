<script setup lang="ts">
// 「技能」节（ZCode section id `skill`，`settingsPageConfig.ts:100-105`，图标 WandSparkles）的界面。
//
// 本节只做**接线**：形状 / 逐字段救 / 校验 / 搜索过滤 / 展示折述全在 `src/agentSkills.ts`
// （判据 `tests/agent-skills.test.mjs`）。组件里不另写来源判定、不另写状态文案。
//
// 两处产品承诺（钉在 `tests/agent-settings-sections-b.test.mjs`）：
//   · `injected === null` = 本仓没有技能运行时，**未知**。显式判 `=== null` 并显示模块给的
//     `injectedLabel`；绝不写成 `!injected`（那会把「没接」渲染成「没被注入」）。
//   · 本仓没有「卸载 / 删除技能目录」那一档，所以**一个纯图标删除按钮都没有**（不放假控件）。
import { computed, reactive, ref } from 'vue'
import { Plus, Save, Search } from 'lucide-vue-next'
import { iconSize } from '../../uiIcons'
import AgentSettingsSectionShell from './AgentSettingsSectionShell.vue'
import {
  AGENT_BUILTIN_SKILL_ROOT,
  describeSkillEntry, filterSkills, loadAgentSkillsSettings, normalizeAgentSkillsSettings,
  saveAgentSkillsSettings, validateAgentSkillsSettings, type AgentSkillEntry,
} from '../../agentSkills'

/** 草稿：本节自管（`reactive(normalize(load()))`，不与别的节共享页面那份 draft）。 */
const draft = reactive(normalizeAgentSkillsSettings(loadAgentSkillsSettings()))
const query = ref('')
const selectedId = ref('')
const editingId = ref('')
const problems = ref<string[]>([])
const status = ref('')

/** 列表行 = 模块折述过的字段（来源标签 / 启用标签 / 注入标签 / 空描述回落都在模块里）。 */
const rows = computed(() => filterSkills(draft.entries, query.value).map(entry => ({
  ...describeSkillEntry(entry),
  entry,
})))

const selected = computed(() => {
  const entry = draft.entries.find(item => item.id === selectedId.value)
  return entry ? describeSkillEntry(entry) : null
})

/** 编辑对象就是草稿里那一条（v-model 改的是同一个响应式对象，不另存一份）。 */
const editing = computed(() => draft.entries.find(item => item.id === editingId.value) ?? null)

function addEntry(): void {
  const seed = normalizeAgentSkillsSettings({ entries: [{ name: '新技能' }] }).entries[0] as AgentSkillEntry
  seed.id = `skill-${Date.now().toString(36)}`
  seed.description = ''
  seed.source = 'user'
  draft.entries.push(seed)
  selectedId.value = seed.id
  editingId.value = seed.id
}

/** 移除**用户自己加**的条目；内置条目来自宿主目录，本仓没有卸载那一档，只能停用。 */
function removeEntry(entry: AgentSkillEntry): void {
  if (entry.source === 'builtin') return
  draft.entries = draft.entries.filter(item => item.id !== entry.id)
  if (selectedId.value === entry.id) selectedId.value = ''
  if (editingId.value === entry.id) editingId.value = ''
}

/** 保存：先 validate 再 save。有 problems 就不写，并逐条显示。 */
function save(): void {
  const found = validateAgentSkillsSettings(draft)
  problems.value = found
  if (found.length) return
  status.value = saveAgentSkillsSettings(draft)
    ? '已保存到本机设置。'
    : '本次会话仍生效，但没有存下来（本机存储不可用）。'
}

/** 这一节的说明：交给共用外壳渲染（`AgentSettingsSectionShell.vue` 的 `description`）。 */
const SECTION_DESCRIPTION = '管理已安装技能：启用、停用与查看注入状态。'
</script>

<template>
  <AgentSettingsSectionShell title="技能" :description="SECTION_DESCRIPTION">
    <div class="skill-toolbar">
      <label class="skill-search">
        <Search :size="iconSize.dense" aria-hidden="true" />
        <input v-model="query" type="search" aria-label="搜索技能" placeholder="搜索技能…" spellcheck="false" />
      </label>
      <button type="button" class="settings-button" @click="addEntry">
        <Plus :size="iconSize.control" aria-hidden="true" />新增条目
      </button>
      <button type="button" class="settings-button settings-button-primary" @click="save">
        <Save :size="iconSize.control" aria-hidden="true" />保存
      </button>
      <span v-if="status" class="settings-status" role="status">{{ status }}</span>
    </div>

    <ul v-if="rows.length" class="skill-list">
      <li v-for="row in rows" :key="row.id" class="skill-row" :class="{ active: row.id === selectedId }">
        <button
          type="button" class="skill-row-main" :aria-pressed="row.id === selectedId"
          @click="selectedId = selectedId === row.id ? '' : row.id"
        >
          <span class="skill-row-title">
            <span class="skill-row-name">{{ row.name }}</span>
            <span class="skill-badge">{{ row.sourceLabel }}</span>
            <span class="skill-badge">{{ row.enabledLabel }}</span>
            <!-- null 是「本仓没有运行时」，不是「没被注入」：显式判 === null，显示模块给的文案。 -->
            <span
              v-if="row.injected === null" class="skill-badge skill-badge-unknown"
              :title="row.injectedLabel"
            >{{ row.injectedLabel }}</span>
            <span v-else class="skill-badge">{{ row.injectedLabel }}</span>
          </span>
          <span class="skill-row-desc">{{ row.description }}</span>
        </button>
        <label v-if="row.toggleable" class="skill-toggle">
          <input v-model="row.entry.enabled" type="checkbox" :aria-label="`启用或停用技能 ${row.name}`" />
          <span class="visually-hidden">{{ row.enabledLabel }}</span>
        </label>
      </li>
    </ul>
    <p v-else class="field-hint">没有匹配的技能。</p>

    <section v-if="selected" class="settings-box skill-details">
      <h4 class="settings-box-title">{{ selected.name }}</h4>
      <p class="skill-description">{{ selected.description }}</p>
      <dl class="skill-kv">
        <div><dt>来源</dt><dd>{{ selected.sourceLabel }}</dd></div>
        <div><dt>状态</dt><dd>{{ selected.enabledLabel }}</dd></div>
        <div><dt>注入</dt><dd>{{ selected.injectedLabel }}</dd></div>
        <div v-if="selected.version"><dt>版本</dt><dd>{{ selected.version }}</dd></div>
        <div v-if="selected.slug"><dt>Slug</dt><dd>{{ selected.slug }}</dd></div>
        <div v-if="selected.publishedAt"><dt>发布时间</dt><dd>{{ selected.publishedAt }}</dd></div>
        <div class="skill-path"><dt>目录</dt><dd>{{ selected.path || '（未填）' }}</dd></div>
      </dl>
      <div class="settings-actions">
        <button type="button" class="settings-button" @click="editingId = editingId === selected.id ? '' : selected.id">
          {{ editingId === selected.id ? '收起编辑' : '编辑' }}
        </button>
        <button
          v-if="editing && editing.source !== 'builtin'" type="button" class="settings-button"
          @click="removeEntry(editing)"
        >移除条目</button>
      </div>

      <div v-if="editing" class="skill-form">
        <div class="input-row">
          <label :for="`skill-name-${editing.id}`">名称</label>
          <input :id="`skill-name-${editing.id}`" v-model="editing.name" type="text" />
        </div>
        <div class="input-row">
          <label :for="`skill-desc-${editing.id}`">描述</label>
          <input :id="`skill-desc-${editing.id}`" v-model="editing.description" type="text" />
        </div>
        <div class="input-row">
          <label :for="`skill-path-${editing.id}`">目录</label>
          <input :id="`skill-path-${editing.id}`" v-model="editing.path" type="text" :placeholder="AGENT_BUILTIN_SKILL_ROOT" />
        </div>
      </div>
    </section>

    <ul v-if="problems.length" class="settings-problems" role="alert">
      <li v-for="problem in problems" :key="problem">{{ problem }}</li>
    </ul>
  </AgentSettingsSectionShell>
</template>

<style scoped>
.skill-toolbar { display: flex; align-items: center; flex-wrap: wrap; gap: var(--space-2); min-width: 0; }
.skill-search { flex: 1 1 180px; min-width: 0; display: flex; align-items: center; gap: var(--space-1); padding: 0 var(--space-2); min-height: var(--ctrl-height-sm); border: 1px solid var(--line-strong); border-radius: var(--radius-xs); background: var(--editor); color: var(--muted); }
.skill-search input { flex: 1; min-width: 0; border: 0; background: transparent; color: var(--text); font: 12px var(--font-mono); }
.skill-search:focus-within { outline: var(--focus-ring); outline-offset: var(--focus-ring-offset-inset); }
.skill-list { list-style: none; margin: 0; padding: 0 var(--space-2); display: flex; flex-direction: column; min-width: 0; border: 1px solid var(--line); border-radius: var(--radius-md); background: var(--panel); }
.skill-row { display: flex; align-items: center; gap: var(--space-2); min-width: 0; padding: var(--space-2) 0; border-bottom: 1px solid var(--line); }
.skill-row:last-child { border-bottom: 0; }
.skill-row.active { background: var(--selected); }
.skill-row-main { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: var(--space-1); padding: 0; border: 0; background: transparent; color: inherit; font: inherit; text-align: left; cursor: pointer; }
.skill-row-title { display: flex; align-items: center; gap: var(--space-1); min-width: 0; flex-wrap: wrap; }
.skill-row-name { color: var(--text); font-size: 12px; font-weight: 600; overflow-wrap: anywhere; }
.skill-badge { padding: 0 var(--space-1); border: 1px solid var(--line-strong); border-radius: var(--radius-xs); color: var(--secondary); font-size: 12px; white-space: nowrap; }
.skill-badge-unknown { border-color: var(--warning); color: var(--warning); }
.skill-row-desc { color: var(--muted); font-size: 12px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.skill-toggle { flex-shrink: 0; display: flex; align-items: center; }
.skill-toggle input { width: var(--icon-size-checkbox); height: var(--icon-size-checkbox); margin: 0; accent-color: var(--accent); }
.skill-description { margin: 0; color: var(--muted); font-size: 12px; line-height: 1.6; overflow-wrap: anywhere; }
.skill-kv { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: var(--space-2) var(--space-4); margin: 0; padding-top: var(--space-2); border-top: 1px solid var(--line); }
.skill-kv > div { display: flex; flex-direction: column; gap: var(--space-1); min-width: 0; }
.skill-kv dt { color: var(--muted); font-size: 12px; }
.skill-kv dd { margin: 0; min-width: 0; color: var(--text); font: 12px/1.5 var(--font-mono); overflow-wrap: anywhere; }
.skill-kv .skill-path { grid-column: 1 / -1; }
.skill-form { display: flex; flex-direction: column; gap: var(--space-2); margin-top: var(--space-2); padding-top: var(--space-2); border-top: 1px solid var(--line); }
.skill-row-main:focus-visible, .skill-toggle input:focus-visible { outline: var(--focus-ring); outline-offset: var(--focus-ring-offset-inset); }
.visually-hidden { position: absolute; width: 1px; height: 1px; overflow: hidden; clip-path: inset(50%); white-space: nowrap; }
@media (max-width: 560px) {
  .skill-kv { grid-template-columns: minmax(0, 1fr); }
  .skill-kv .skill-path { grid-column: auto; }
}
</style>
