<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, reactive, ref } from 'vue'
import { Cable, Plus, Trash2, Upload } from 'lucide-vue-next'
import { iconSize } from '../../uiIcons'
import { isDesktop, request } from '../../bridge'
import AgentSettingsSectionShell from './AgentSettingsSectionShell.vue'
import {
  describeMcpFailure, loadAgentMcpSettings, mcpServerConfigJson,
  normalizeAgentMcpSettings, parseMcpServerInput, saveAgentMcpSettings, validateAgentMcpSettings,
  type AgentMcpRuntimeSnapshot, type AgentMcpServer, type AgentMcpServerStatus,
} from '../../agentMcpServers'

const TRANSPORT_OPTIONS = [
  { value: 'stdio' as const, label: '标准输入输出（stdio）' },
  { value: 'http' as const, label: 'HTTP（流式）' },
  { value: 'sse' as const, label: 'SSE' },
]

/** 落盘层级的中文名（字段名是上游的，译文是本节自己的短标签，与 `PROTOCOL_VERSIONS` 同一种写法）。 */
const MCP_SCOPE_LABELS: Record<AgentMcpServer['scope'], string> = { user: '用户', workspace: '工作区' }

/** 协议版本。`''` = 未设置 = 自动协商（ZCode 用 `auto` 作 Select 哨兵，`McpServerForm.tsx:196-199`）。 */
const PROTOCOL_VERSIONS = [{ value: '', label: '自动（推荐）' }, { value: 'legacy', label: '兼容旧版' }, { value: '2026-07-28', label: 'v2' }]

/** 本节的草稿：自己读自己存，不与别的节共享。 */
const draft = reactive(normalizeAgentMcpSettings(loadAgentMcpSettings()))
const runtime = ref<AgentMcpRuntimeSnapshot>({ statuses: {}, tools: [] })
const problems = ref<string[]>([])
const savedNote = ref('')
const runtimeError = ref('')
const selectedId = ref('')
const jsonDraft = ref('')
const jsonError = ref('')

const servers = computed(() => draft.servers)
const selected = computed(() => servers.value.find((server) => server.id === selectedId.value) ?? null)
const selectedStatus = computed(() => selected.value ? runtime.value.statuses[selected.value.name] ?? null : null)
const selectedTools = computed(() => selected.value
  ? runtime.value.tools.filter((tool) => tool.serverId === selected.value!.id)
  : [])
const argsText = computed({
  get: () => selected.value?.args.join(' ') ?? '',
  set: (value: string) => {
    if (selected.value) selected.value.args = value.trim() ? value.trim().split(/\s+/u) : []
  },
})
let statusPoll: number | undefined
let runtimeUpdateQueue: Promise<void> = Promise.resolve()
let pendingRuntimeUpdates = 0

function statusFor(server: AgentMcpServer): AgentMcpServerStatus | null {
  return runtime.value.statuses[server.name] ?? null
}

function statusLabel(status: AgentMcpServerStatus | null): string {
  if (!status) return ''
  if (status.status === 'connected') return '已连接'
  if (status.status === 'connecting') return '连接中'
  if (status.status === 'disconnected') return '未连接'
  if (status.status === 'disabled') return '已停用'
  return describeMcpFailure(status.failureKind)
}

async function refreshRuntime(): Promise<void> {
  if (!isDesktop || pendingRuntimeUpdates) return
  try {
    runtime.value = await request<AgentMcpRuntimeSnapshot>('agent.mcp.status', {})
    runtimeError.value = ''
  } catch (error) {
    runtimeError.value = error instanceof Error ? error.message : String(error)
  }
}

function applyRuntimeSettings(): Promise<void> {
  if (!isDesktop) return Promise.resolve()
  const settings = normalizeAgentMcpSettings(JSON.parse(JSON.stringify(draft)))
  pendingRuntimeUpdates += 1
  const operation = runtimeUpdateQueue.then(async () => {
    try {
      runtime.value = await request<AgentMcpRuntimeSnapshot>('agent.mcp.configure', { settings })
      runtimeError.value = ''
    } catch (error) {
      runtimeError.value = error instanceof Error ? error.message : String(error)
    } finally {
      pendingRuntimeUpdates -= 1
    }
  })
  runtimeUpdateQueue = operation
  return operation
}

function persistRuntimeSettings(): void {
  saveAgentMcpSettings(draft)
  void applyRuntimeSettings()
}

function setEnabled(server: AgentMcpServer, enabled: boolean): void {
  server.enabled = enabled
  persistRuntimeSettings()
}

/** stdio 环境变量表。 */
const pairTable = computed<Record<string, string>>(() => {
  if (!selected.value) return {}
  return selected.value.transport === 'stdio' ? selected.value.env : selected.value.headers
})
const pairLabel = computed(() => (selected.value?.transport === 'stdio' ? '环境变量（可选）' : '请求头（可选）'))

/** 行副标题。 */
function rowDescription(server: AgentMcpServer): string {
  const typeLabel = server.command ? 'stdio' : server.transport
  if (server.url) return `${typeLabel} · ${server.url}`
  if (server.command) return `${typeLabel} · ${server.command} ${server.args.join(' ')}`.trimEnd()
  return typeLabel
}

/** 新建一条空白条目。`normalize` 补齐 id 与各字段默认值，这里不手搭形状。 */
function addServer(): void {
  const seed = normalizeAgentMcpSettings({ servers: [{}] }).servers[0]!
  seed.id = `mcp-${Date.now().toString(36)}`
  seed.name = ''
  draft.servers.push(seed)
  selectedId.value = seed.id
}

function removeServer(id: string): void {
  draft.servers = draft.servers.filter((server) => server.id !== id)
  if (selectedId.value === id) selectedId.value = ''
  persistRuntimeSettings()
}

/** 键值表按行增删：不在组件里复刻 JSON 解析那套判断，交给模块的归一化与校验。 */
function addPair(): void {
  let index = Object.keys(pairTable.value).length + 1
  while (pairTable.value[`KEY_${index}`] !== undefined) index += 1
  pairTable.value[`KEY_${index}`] = ''
}

function removePair(key: string): void {
  delete pairTable.value[key]
}

/** 粘贴导入。`parseMcpServerInput` 的返回是判别联合（`server` / `error` 恒有一边非 null），所以不写可选链。 */
function importJson(): void {
  const result = parseMcpServerInput(jsonDraft.value)
  if (!result.ok) {
    jsonError.value = result.error
    return
  }
  jsonError.value = ''
  const incoming = result.server
  incoming.id = `mcp-${Date.now().toString(36)}`
  draft.servers.push(incoming)
  selectedId.value = incoming.id
  jsonDraft.value = ''
}

/** 导出当前条目的通用 JSON 形状（`mcpServerConfigJson`：stdio 与 http 二选一，绝不混填 command 与 url）。 */
function exportJson(): string {
  return selected.value ? JSON.stringify(mcpServerConfigJson(selected.value), null, 2) : ''
}

/** 保存：先 `validate` 再 `save`。有 problems 就不写，并逐条显示。 */
function save(): void {
  const found = validateAgentMcpSettings(draft)
  problems.value = found
  if (found.length) return
  savedNote.value = saveAgentMcpSettings(draft) ? '已保存。' : '本次会话已生效，但没能写进本地存储。'
  void applyRuntimeSettings()
}

onMounted(() => {
  void applyRuntimeSettings()
  statusPoll = window.setInterval(() => { void refreshRuntime() }, 5_000)
})

onBeforeUnmount(() => {
  if (statusPoll !== undefined) window.clearInterval(statusPoll)
})

/** 这一节的说明：上游原文（`zh-CN.ts:2356` 的 `settings.mcp.description`），交给共用外壳渲染。 */
const SECTION_DESCRIPTION = '管理 ZCode Agent 使用的 MCP 服务器配置。'
</script>

<template>
  <AgentSettingsSectionShell title="MCP 服务器" :description="SECTION_DESCRIPTION">
    <ul v-if="servers.length" class="mcp-list">
      <li v-for="server in servers" :key="server.id" class="mcp-row" :class="{ active: server.id === selectedId }">
        <Cable :size="iconSize.control" aria-hidden="true" class="mcp-row-icon" />
        <button type="button" class="mcp-row-main" :aria-pressed="server.id === selectedId"
          @click="selectedId = server.id">
          <span class="mcp-row-title">
            <span class="mcp-row-name">{{ server.name || '未命名服务器' }}</span>
            <!-- 落盘层级：`AgentMcpServer.scope` 是上游 `mcpSettingsShared.ts` 的字段（user / workspace）。 -->
            <span class="mcp-badge mcp-scope">{{ MCP_SCOPE_LABELS[server.scope] }}</span>
            <span v-if="statusFor(server)" class="mcp-status" :title="statusLabel(statusFor(server))">
              {{ statusLabel(statusFor(server)) }}
            </span>
            <span v-if="statusFor(server)?.status === 'connected'" class="mcp-badge">
              {{ statusFor(server)?.toolCount }} 个工具
            </span>
          </span>
          <span class="mcp-row-desc">{{ rowDescription(server) }}</span>
        </button>
        <label v-if="server.transport === 'stdio'" class="mcp-toggle">
          <input v-model="server.enabled" type="checkbox" :aria-label="`启用或停用 ${server.name || '未命名服务器'}`"
            @change="setEnabled(server, server.enabled)">
          <span>{{ server.enabled ? '已启用' : '已停用' }}</span>
        </label>
        <button type="button" class="settings-icon-button" :aria-label="`删除 ${server.name || '未命名服务器'}`"
          :title="`删除 ${server.name || '未命名服务器'}`" @click="removeServer(server.id)">
          <Trash2 :size="iconSize.dense" aria-hidden="true" />
        </button>
      </li>
    </ul>

    <div class="settings-actions">
      <button type="button" class="settings-button" @click="addServer">
        <Plus :size="iconSize.dense" aria-hidden="true" />新建
      </button>
    </div>

    <section v-if="selected?.transport === 'stdio'" class="settings-box">
      <h4 class="settings-box-title">编辑 MCP 服务器</h4>
      <div class="input-row">
        <label :for="`mcp-name-${selected.id}`">名称</label>
        <input :id="`mcp-name-${selected.id}`" v-model="selected.name" type="text">
      </div>

      <div class="input-row">
        <label :for="`mcp-transport-${selected.id}`">类型</label>
        <select :id="`mcp-transport-${selected.id}`" v-model="selected.transport">
          <option v-for="item in TRANSPORT_OPTIONS" :key="item.value" :value="item.value">{{ item.label }}</option>
        </select>
      </div>
      <div class="mcp-field-row">
        <div class="input-row">
          <label :for="`mcp-timeout-${selected.id}`">超时时间 MS</label>
          <input :id="`mcp-timeout-${selected.id}`" v-model.number="selected.timeoutMs" type="number" min="0" step="1">
        </div>
        <div class="input-row">
          <label :for="`mcp-protocol-${selected.id}`">协议版本</label>
          <select :id="`mcp-protocol-${selected.id}`" v-model="selected.protocolVersion">
            <option v-for="item in PROTOCOL_VERSIONS" :key="item.value" :value="item.value">{{ item.label }}</option>
          </select>
        </div>
      </div>

      <div class="input-row">
        <label :for="`mcp-command-${selected.id}`">命令</label>
        <input :id="`mcp-command-${selected.id}`" v-model="selected.command" type="text">
      </div>

      <div class="input-row">
        <label :for="`mcp-args-${selected.id}`">参数（空格分隔）</label>
        <input :id="`mcp-args-${selected.id}`" v-model="argsText" type="text">
      </div>

      <div class="mcp-field">
        <span class="mcp-label">{{ pairLabel }}</span>
        <ul class="mcp-pair-list">
          <li v-for="(_value, key) in pairTable" :key="key" class="mcp-pair">
            <input :value="key" type="text" readonly :aria-label="`键名 ${key}`">
            <input v-model="pairTable[key]" type="text" :aria-label="`${key} 的值`">
            <button type="button" class="settings-icon-button" :aria-label="`删除 ${key}`" :title="`删除 ${key}`" @click="removePair(key)">
              <Trash2 :size="iconSize.dense" aria-hidden="true" />
            </button>
          </li>
        </ul>
        <button type="button" class="settings-button" @click="addPair">
          <Plus :size="iconSize.dense" aria-hidden="true" />添加
        </button>
      </div>

      <p v-if="selectedStatus" class="mcp-status-line" role="status">{{ statusLabel(selectedStatus) }}</p>
      <p v-if="selectedStatus?.failureKind" class="mcp-failure">{{ describeMcpFailure(selectedStatus.failureKind) }}</p>
      <ul v-if="selectedTools.length" class="mcp-tool-list">
        <li v-for="tool in selectedTools" :key="tool.name" :title="tool.description">{{ tool.name }}</li>
      </ul>
    </section>

    <section v-else-if="selected" class="settings-box">
      <h4 class="settings-box-title">{{ selected.name }}</h4>
      <p v-if="selectedStatus" class="mcp-status-line" role="status">{{ statusLabel(selectedStatus) }}</p>
      <p v-if="selectedStatus?.failureKind" class="mcp-failure">{{ describeMcpFailure(selectedStatus.failureKind) }}</p>
    </section>

    <section class="settings-box">
      <h4 class="settings-box-title">JSON 导入 / 导出</h4>
      <label class="mcp-label" for="mcp-json-draft">粘贴一条服务器配置</label>
      <textarea id="mcp-json-draft" v-model="jsonDraft" rows="4" spellcheck="false" />
      <p v-if="jsonError" class="settings-problems" role="alert">{{ jsonError }}</p>
      <div class="settings-actions">
        <button type="button" class="settings-button" :disabled="!jsonDraft.trim()" @click="importJson">
          <Upload :size="iconSize.dense" aria-hidden="true" />导入
        </button>
      </div>
      <label class="mcp-label" for="mcp-json-export">完整配置</label>
      <textarea id="mcp-json-export" :value="exportJson()" rows="5" readonly spellcheck="false" />
    </section>

    <p v-if="problems.length" class="settings-problems" role="alert">
      <span v-for="problem in problems" :key="problem">{{ problem }}</span>
    </p>
    <p v-if="runtimeError" class="settings-problems" role="alert">{{ runtimeError }}</p>
    <p v-else-if="savedNote" class="settings-status" role="status">{{ savedNote }}</p>
    <div class="settings-actions">
      <button type="button" class="settings-button settings-button-primary" @click="save">保存</button>
    </div>
  </AgentSettingsSectionShell>
</template>

<style scoped>
.mcp-list, .mcp-pair-list { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; }
.mcp-list { padding: 0 var(--space-2); border: 1px solid var(--line); border-radius: var(--radius-md); background: var(--panel); }
.mcp-pair-list { gap: var(--space-1); }
.mcp-row { display: flex; align-items: center; gap: var(--space-2); min-width: 0; padding: var(--space-2) 0; border-bottom: 1px solid var(--line); }
.mcp-row.active { background: var(--selected); }
.mcp-row:last-child { border-bottom: 0; }
.mcp-row-icon { flex-shrink: 0; color: var(--muted); }
.mcp-row-main { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: var(--space-1); padding: 0; border: 0; background: transparent; color: inherit; font: inherit; text-align: left; cursor: pointer; }
.mcp-row-title { display: flex; align-items: center; gap: var(--space-1); min-width: 0; }
.mcp-row-name { color: var(--text); font-size: 12px; font-weight: 600; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.mcp-badge { flex-shrink: 0; padding: 0 var(--space-1); border: 1px solid var(--line-strong); border-radius: var(--radius-xs); color: var(--secondary); font-size: 12px; }
.mcp-row-desc { color: var(--muted); font: 12px var(--font-mono); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.mcp-status { flex-shrink: 0; color: var(--secondary); font-size: 12px; }
.mcp-status-line { margin: 0; color: var(--secondary); font-size: 12px; line-height: 1.5; }
.mcp-toggle { flex-shrink: 0; display: flex; align-items: center; gap: var(--space-1); color: var(--secondary); font-size: 12px; }
.mcp-field { display: flex; flex-direction: column; gap: var(--space-1); }
.mcp-field-row { display: flex; align-items: flex-start; gap: var(--space-3); flex-wrap: wrap; }
.mcp-field-row > .input-row { flex: 1 1 200px; }
.mcp-field > .mcp-label, .settings-box > .mcp-label { color: var(--muted); font-size: 12px; }
.settings-box .mcp-field-row .input-row :is(input, select) { flex: 1 1 90px; }
.mcp-pair { display: flex; align-items: center; gap: var(--space-1); min-width: 0; }
.mcp-pair input { flex: 1; min-width: 0; }
.mcp-failure { margin: 0; color: var(--warning); font-size: 12px; line-height: 1.6; }
.mcp-tool-list { display: flex; flex-wrap: wrap; gap: var(--space-1); margin: 0; padding: 0; list-style: none; }
.mcp-tool-list li { max-width: 100%; overflow: hidden; padding: 0 var(--space-1); border: 1px solid var(--line); border-radius: var(--radius-xs); color: var(--secondary); font-size: 12px; text-overflow: ellipsis; white-space: nowrap; }
.mcp-row-main:focus-visible, .settings-icon-button:focus-visible { outline: var(--focus-ring); outline-offset: var(--focus-ring-offset-inset); }
</style>
