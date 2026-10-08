<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, ref, watch } from 'vue'
import { ExternalLink, RefreshCw, Search, Trash2 } from 'lucide-vue-next'
import { iconSize } from '../../uiIcons'
import AgentSettingsSectionShell from './AgentSettingsSectionShell.vue'
import {
  deleteAgentSkill,
  listAgentSkills,
  revealAgentSkill,
  setAgentSkillEnabled,
  type AgentSkill,
  type AgentSkillScope,
} from '../../agentSkills.ts'

const props = defineProps<{ workspacePath?: string | null }>()

const skills = ref<AgentSkill[]>([])
const selectedId = ref('')
const query = ref('')
const loading = ref(false)
const busyId = ref('')
const error = ref('')
const deleteTarget = ref<AgentSkill | null>(null)
const deleteButton = ref<HTMLButtonElement | null>(null)
const cancelButton = ref<HTMLButtonElement | null>(null)
let focusReturn: HTMLElement | null = null
let workspaceGeneration = 0
let latestRefreshId = 0

const workspacePath = computed(() => props.workspacePath?.trim() ?? '')
const workspaceLabel = computed(() => workspacePath.value.split(/[\\/]/u).filter(Boolean).at(-1) ?? '')
const visibleSkills = computed(() => {
  const needle = query.value.trim().toLocaleLowerCase()
  if (!needle) return skills.value
  return skills.value.filter(skill => `${skill.name}\n${skill.description}\n${skill.path}`.toLocaleLowerCase().includes(needle))
})
const selected = computed(() => skills.value.find(skill => skill.id === selectedId.value) ?? null)

async function refresh() {
  const requestId = ++latestRefreshId
  const generation = workspaceGeneration
  const targetPath = workspacePath.value
  loading.value = true
  error.value = ''
  try {
    const result = await listAgentSkills(targetPath)
    if (requestId !== latestRefreshId || generation !== workspaceGeneration || targetPath !== workspacePath.value) return
    skills.value = result.skills
    if (!skills.value.some(skill => skill.id === selectedId.value)) selectedId.value = ''
  } catch (caught) {
    if (requestId === latestRefreshId && generation === workspaceGeneration && targetPath === workspacePath.value) {
      error.value = caught instanceof Error ? caught.message : String(caught)
    }
  } finally {
    if (requestId === latestRefreshId && generation === workspaceGeneration && targetPath === workspacePath.value) loading.value = false
  }
}

watch(workspacePath, () => {
  workspaceGeneration += 1
  skills.value = []
  selectedId.value = ''
  deleteTarget.value = null
  focusReturn = null
  busyId.value = ''
  void refresh()
}, { immediate: true })

onBeforeUnmount(() => {
  workspaceGeneration += 1
  latestRefreshId += 1
})

function isCurrentWorkspace(generation: number, targetPath: string): boolean {
  return generation === workspaceGeneration && targetPath === workspacePath.value
}

function scopeLabel(scope: AgentSkillScope, pluginName?: string): string {
  if (scope === 'workspace') return workspaceLabel.value || '项目'
  if (scope === 'plugin') return pluginName?.trim() || '插件'
  return '个人'
}

function enabledLabel(enabled: boolean): string {
  return enabled ? '已启用' : '已停用'
}

function formatPublishedAt(value?: number): string | null {
  if (typeof value !== 'number' || !Number.isFinite(value)) return null
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? null : date.toISOString()
}

async function toggleSkill(skill: AgentSkill, event: Event) {
  const enabled = (event.target as HTMLInputElement).checked
  const targetPath = workspacePath.value
  const generation = workspaceGeneration
  busyId.value = skill.id
  error.value = ''
  try {
    const result = await setAgentSkillEnabled(targetPath, skill.id, enabled)
    if (!isCurrentWorkspace(generation, targetPath)) return
    latestRefreshId += 1
    loading.value = false
    skills.value = result.skills
  } catch (caught) {
    if (isCurrentWorkspace(generation, targetPath)) {
      error.value = caught instanceof Error ? caught.message : String(caught)
    }
  } finally {
    if (isCurrentWorkspace(generation, targetPath) && busyId.value === skill.id) busyId.value = ''
  }
}

function requestDelete(skill: AgentSkill) {
  focusReturn = document.activeElement instanceof HTMLElement ? document.activeElement : null
  error.value = ''
  deleteTarget.value = skill
  void nextTick(() => cancelButton.value?.focus())
}

function closeDelete() {
  if (busyId.value) return
  deleteTarget.value = null
  void nextTick(() => {
    if (focusReturn?.isConnected) focusReturn.focus()
    focusReturn = null
  })
}

function trapDeleteFocus(event: KeyboardEvent) {
  if (event.key !== 'Tab') return
  if (event.shiftKey && document.activeElement === cancelButton.value) {
    event.preventDefault()
    deleteButton.value?.focus()
  } else if (!event.shiftKey && document.activeElement === deleteButton.value) {
    event.preventDefault()
    cancelButton.value?.focus()
  }
}

async function confirmDelete() {
  const skill = deleteTarget.value
  if (!skill) return
  const targetPath = workspacePath.value
  const generation = workspaceGeneration
  busyId.value = skill.id
  error.value = ''
  try {
    const result = await deleteAgentSkill(targetPath, skill.id)
    if (!isCurrentWorkspace(generation, targetPath)) return
    latestRefreshId += 1
    loading.value = false
    skills.value = result.skills
    if (selectedId.value === skill.id) selectedId.value = ''
    deleteTarget.value = null
    void nextTick(() => {
      const target = focusReturn?.isConnected ? focusReturn : document.querySelector<HTMLButtonElement>('.skill-toolbar button')
      target?.focus()
      focusReturn = null
    })
  } catch (caught) {
    if (isCurrentWorkspace(generation, targetPath)) {
      error.value = caught instanceof Error ? caught.message : String(caught)
    }
  } finally {
    if (isCurrentWorkspace(generation, targetPath) && busyId.value === skill.id) busyId.value = ''
  }
}

async function reveal(skill: AgentSkill) {
  const targetPath = workspacePath.value
  const generation = workspaceGeneration
  error.value = ''
  try {
    await revealAgentSkill(targetPath, skill.id)
  } catch (caught) {
    if (isCurrentWorkspace(generation, targetPath)) {
      error.value = caught instanceof Error ? caught.message : String(caught)
    }
  }
}
</script>

<template>
  <AgentSettingsSectionShell>
    <div class="skill-toolbar">
      <label class="skill-search">
        <Search :size="iconSize.dense" aria-hidden="true" />
        <input v-model="query" type="search" aria-label="搜索技能" placeholder="搜索技能..." spellcheck="false">
      </label>
      <button type="button" class="settings-icon-button" title="刷新" aria-label="刷新" :disabled="loading" @click="refresh">
        <RefreshCw :size="iconSize.dense" aria-hidden="true" />
      </button>
    </div>

    <p v-if="query.trim() && !visibleSkills.length" class="field-hint" role="status">没有匹配的技能</p>

    <ul v-if="visibleSkills.length" class="skill-list">
      <li v-for="skill in visibleSkills" :key="skill.id" class="skill-row" :class="{ active: skill.id === selectedId }">
        <button type="button" class="skill-row-main" :aria-pressed="skill.id === selectedId" @click="selectedId = skill.id">
          <span class="skill-row-title">
            <span class="skill-row-name">{{ skill.name }}</span>
            <span class="skill-badge">{{ scopeLabel(skill.scope) }}</span>
            <span v-if="skill.pluginName" class="skill-badge">{{ skill.pluginName }}</span>
            <span class="skill-badge">{{ enabledLabel(skill.enabled) }}</span>
          </span>
          <span v-if="skill.description" class="skill-row-desc">{{ skill.description }}</span>
        </button>
        <label v-if="skill.scope !== 'plugin'" class="skill-toggle">
          <input type="checkbox" :checked="skill.enabled" :disabled="busyId !== ''" :aria-label="`启用或停用技能 ${skill.name}`" @change="toggleSkill(skill, $event)">
          <span class="visually-hidden">{{ enabledLabel(skill.enabled) }}</span>
        </label>
        <button v-if="skill.scope !== 'plugin'" type="button" class="settings-icon-button settings-icon-button-danger" :title="`删除 ${skill.name}`" :aria-label="`删除 ${skill.name}`" :disabled="busyId !== ''" @click="requestDelete(skill)">
          <Trash2 :size="iconSize.dense" aria-hidden="true" />
        </button>
      </li>
    </ul>

    <section v-if="selected" class="settings-box skill-details">
      <h4 class="settings-box-title">{{ selected.name }}</h4>
      <div v-if="selected.description" class="skill-description">
        <span>描述</span>
        <p>{{ selected.description }}</p>
      </div>
      <dl class="skill-kv">
        <div><dt>范围</dt><dd>{{ scopeLabel(selected.scope, selected.pluginName) }}</dd></div>
        <div><dt>状态</dt><dd>{{ enabledLabel(selected.enabled) }}</dd></div>
        <div v-if="selected.metadata?.version"><dt>版本</dt><dd>{{ selected.metadata.version }}</dd></div>
        <div v-if="selected.metadata?.slug"><dt>Slug</dt><dd>{{ selected.metadata.slug }}</dd></div>
        <div v-if="formatPublishedAt(selected.metadata?.publishedAt)"><dt>发布时间</dt><dd>{{ formatPublishedAt(selected.metadata?.publishedAt) }}</dd></div>
        <div v-if="selected.metadata?.ownerId"><dt>Owner ID</dt><dd>{{ selected.metadata.ownerId }}</dd></div>
        <div class="skill-path"><dt>文件路径</dt><dd>{{ selected.path }}</dd></div>
      </dl>
      <div class="settings-actions">
        <button type="button" class="settings-button" @click="reveal(selected)">
          <ExternalLink :size="iconSize.dense" aria-hidden="true" />打开
        </button>
      </div>
    </section>

    <p v-if="error && !deleteTarget" class="settings-problems skill-error" role="alert">{{ error }}</p>
  </AgentSettingsSectionShell>

  <Teleport to="body">
    <div v-if="deleteTarget" class="modal-backdrop" @click.self="closeDelete">
      <section
        class="help-dialog leave-dialog skill-delete-dialog"
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="skill-delete-name"
        @keydown.esc.prevent.stop="closeDelete"
        @keydown="trapDeleteFocus"
      >
        <p id="skill-delete-name">{{ deleteTarget.name }}</p>
        <p v-if="error" class="settings-problems skill-error" role="alert">{{ error }}</p>
        <div class="leave-actions">
          <button ref="deleteButton" class="primary-button menu-danger-solid" type="button" :disabled="busyId !== ''" @click="confirmDelete">删除</button>
          <button ref="cancelButton" class="subtle-button" type="button" :disabled="busyId !== ''" @click="closeDelete">取消</button>
        </div>
      </section>
    </div>
  </Teleport>
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
.skill-row-desc { color: var(--muted); font-size: 12px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.skill-toggle { flex-shrink: 0; display: flex; align-items: center; }
.skill-toggle input { width: var(--icon-size-checkbox); height: var(--icon-size-checkbox); margin: 0; accent-color: var(--accent); }
.skill-details { gap: var(--space-3); }
.skill-description { min-width: 0; }
.skill-description > span, .skill-kv dt { color: var(--muted); font-size: 12px; }
.skill-description > p { margin: var(--space-1) 0 0; color: var(--text); font-size: 12px; line-height: 1.5; overflow-wrap: anywhere; white-space: pre-wrap; }
.skill-kv { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: var(--space-2) var(--space-4); margin: 0; padding-top: var(--space-2); border-top: 1px solid var(--line); }
.skill-kv > div { display: flex; flex-direction: column; gap: var(--space-1); min-width: 0; }
.skill-kv dt, .skill-kv dd { margin: 0; }
.skill-kv dd { min-width: 0; color: var(--text); font: 12px/1.5 var(--font-mono); overflow-wrap: anywhere; }
.skill-kv .skill-path { grid-column: 1 / -1; }
.skill-row-main:focus-visible, .skill-toggle input:focus-visible { outline: var(--focus-ring); outline-offset: var(--focus-ring-offset-inset); }
.skill-details :deep(.settings-button), .skill-error { font-size: 12px; }
.skill-delete-dialog p, .skill-delete-dialog button { font-size: 12px; }
.visually-hidden { position: absolute; width: 1px; height: 1px; overflow: hidden; clip-path: inset(50%); white-space: nowrap; }
@media (max-width: 560px) {
  .skill-kv { grid-template-columns: minmax(0, 1fr); }
  .skill-kv .skill-path { grid-column: auto; }
}
</style>
