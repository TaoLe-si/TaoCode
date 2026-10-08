<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { ExternalLink, RefreshCw, Search } from 'lucide-vue-next'
import AgentSettingsSectionShell from './AgentSettingsSectionShell.vue'
import { iconSize } from '../../uiIcons'
import {
  listProjectMemories,
  revealProjectMemoryFile,
  type ProjectMemoryFileSummary,
  type ProjectMemoryWorkspaceSummary,
} from '../../agentMemoryFiles'

const workspaces = ref<ProjectMemoryWorkspaceSummary[]>([])
const selectedWorkspaceId = ref('')
const query = ref('')
const loading = ref(false)
const error = ref('')
const hasLoaded = ref(false)
const now = ref(Date.now())
let refreshId = 0
let revealId = 0
let clockTimer = 0

const selectedWorkspace = computed(() =>
  workspaces.value.find(workspace => workspace.id === selectedWorkspaceId.value) ?? null,
)
const visibleFiles = computed(() => {
  const needle = query.value.trim().toLocaleLowerCase()
  const files = selectedWorkspace.value?.files ?? []
  return needle ? files.filter(file => file.name.toLocaleLowerCase().includes(needle)) : files
})

watch(selectedWorkspaceId, () => {
  revealId += 1
  error.value = ''
})

async function refresh() {
  const requestId = ++refreshId
  loading.value = true
  error.value = ''
  try {
    const result = await listProjectMemories()
    if (requestId !== refreshId) return
    workspaces.value = result
    hasLoaded.value = true
    selectedWorkspaceId.value = result.some(workspace => workspace.id === selectedWorkspaceId.value)
      ? selectedWorkspaceId.value
      : result[0]?.id ?? ''
  } catch (caught) {
    if (requestId !== refreshId) return
    workspaces.value = []
    hasLoaded.value = true
    selectedWorkspaceId.value = ''
    error.value = caught instanceof Error ? caught.message : String(caught)
  } finally {
    if (requestId === refreshId) loading.value = false
  }
}

function formatUpdatedAt(timestamp: number): string {
  const date = new Date(timestamp)
  if (Number.isNaN(date.getTime())) return '刚刚'
  const elapsed = now.value - timestamp
  if (elapsed < 60_000) return '刚刚'
  const minutes = Math.floor(elapsed / 60_000)
  if (minutes < 30) return `${minutes} 分钟前`
  const time = new Intl.DateTimeFormat('zh-CN', { hour: '2-digit', hourCycle: 'h23', minute: '2-digit' }).format(date)
  const today = new Date(now.value)
  const todayStart = new Date(today.getFullYear(), today.getMonth(), today.getDate()).getTime()
  const dateStart = new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime()
  if (dateStart === todayStart) return `今天 ${time}`
  const yesterday = new Date(todayStart)
  yesterday.setDate(yesterday.getDate() - 1)
  if (dateStart === yesterday.getTime()) return `昨天 ${time}`
  const weekStart = new Date(todayStart)
  weekStart.setDate(today.getDate() - ((today.getDay() + 6) % 7))
  if (dateStart >= weekStart.getTime()) return `周${'日一二三四五六'[date.getDay()]} ${time}`
  const dateText = date.getFullYear() === today.getFullYear()
    ? `${date.getMonth() + 1} 月 ${date.getDate()} 日`
    : `${date.getFullYear()} 年 ${date.getMonth() + 1} 月 ${date.getDate()} 日`
  return `${dateText} ${time}`
}

function datetimeValue(timestamp: number): string | undefined {
  const date = new Date(timestamp)
  return Number.isNaN(date.getTime()) ? undefined : date.toISOString()
}

async function reveal(file: ProjectMemoryFileSummary) {
  const requestId = ++revealId
  const workspaceId = selectedWorkspaceId.value
  error.value = ''
  try {
    await revealProjectMemoryFile(file.path)
  } catch (caught) {
    if (requestId !== revealId || workspaceId !== selectedWorkspaceId.value) return
    error.value = caught instanceof Error ? caught.message : String(caught)
  }
}

onMounted(() => {
  clockTimer = window.setInterval(() => { now.value = Date.now() }, 60_000)
  void refresh()
})
onBeforeUnmount(() => {
  refreshId += 1
  revealId += 1
  window.clearInterval(clockTimer)
})
</script>

<template>
  <AgentSettingsSectionShell>
    <section class="memory-viewer">
      <div class="memory-toolbar">
        <select v-if="workspaces.length" v-model="selectedWorkspaceId" aria-label="工作区" class="memory-workspace">
          <option v-for="workspace in workspaces" :key="workspace.id" :value="workspace.id">{{ workspace.label }}</option>
        </select>
        <span v-if="selectedWorkspace" class="memory-count">{{ selectedWorkspace.files.length }} 条记忆</span>
        <label v-if="selectedWorkspace" class="memory-search">
          <Search :size="iconSize.dense" aria-hidden="true" />
          <input v-model="query" type="search" aria-label="搜索记忆文件" placeholder="搜索记忆文件…" spellcheck="false">
        </label>
        <button class="settings-icon-button" type="button" title="刷新" aria-label="刷新" :disabled="loading" @click="refresh">
          <RefreshCw :size="iconSize.dense" aria-hidden="true" />
        </button>
      </div>

      <p v-if="loading && !workspaces.length" class="memory-status" role="status">正在加载记忆…</p>
      <p v-if="error" class="memory-error" role="alert">{{ error }}</p>
      <p v-if="hasLoaded && !loading && !error && !selectedWorkspace" class="memory-status" role="status">暂无已保存的工作区记忆</p>
      <p v-else-if="selectedWorkspace && query.trim() && !visibleFiles.length" class="memory-status" role="status">没有匹配的记忆文件。</p>

      <ul v-if="visibleFiles.length" class="memory-list">
        <li v-for="file in visibleFiles" :key="`${selectedWorkspaceId}/${file.name}`" class="memory-row">
          <span class="memory-file">
            <span class="memory-name" :title="file.path">{{ file.name }}</span>
            <time class="memory-updated" :datetime="datetimeValue(file.updatedAt)">{{ formatUpdatedAt(file.updatedAt) }}</time>
          </span>
          <button class="settings-icon-button" type="button" title="在文件管理器中打开" aria-label="在文件管理器中打开" @click="reveal(file)">
            <ExternalLink :size="iconSize.dense" aria-hidden="true" />
          </button>
        </li>
      </ul>
    </section>
  </AgentSettingsSectionShell>
</template>

<style scoped>
.memory-viewer { display: flex; flex-direction: column; gap: var(--space-2); min-width: 0; }
.memory-toolbar { display: flex; align-items: center; flex-wrap: wrap; gap: var(--space-2); min-width: 0; }
.memory-workspace { flex: 1 1 150px; min-width: 0; }
.memory-viewer :deep(select) { font-size: 12px; }
.memory-count { flex: 0 0 auto; color: var(--secondary); font-size: 12px; }
.memory-search { display: flex; align-items: center; flex: 1 1 180px; gap: var(--space-1); min-width: 0; height: var(--ctrl-height); padding: 0 var(--space-2); border: 1px solid var(--line-strong); border-radius: var(--radius-xs); background: var(--editor); color: var(--secondary); }
.memory-search input { width: 100%; min-width: 0; height: 100%; padding: 0; border: 0; outline: 0; background: transparent; color: var(--text); font: inherit; font-size: 12px; }
.memory-list { display: flex; flex-direction: column; min-width: 0; margin: 0; padding: 0 var(--space-2); list-style: none; border: 1px solid var(--line); border-radius: var(--radius-md); background: var(--elevated); }
.memory-row { display: flex; align-items: center; gap: var(--space-2); min-width: 0; padding: var(--space-2) 0; }
.memory-row + .memory-row { border-top: 1px solid var(--line); }
.memory-file { display: flex; flex-direction: column; flex: 1 1 auto; gap: var(--space-1); min-width: 0; }
.memory-name { overflow: hidden; color: var(--text); font-size: 12px; font-weight: 500; text-overflow: ellipsis; white-space: nowrap; }
.memory-updated { overflow: hidden; color: var(--secondary); font-size: 12px; text-overflow: ellipsis; white-space: nowrap; }
.memory-status { margin: 0; color: var(--secondary); font-size: 12px; }
.memory-error { margin: 0; color: var(--error); font-size: 12px; overflow-wrap: anywhere; }
</style>
