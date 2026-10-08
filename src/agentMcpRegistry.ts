// Agent 设置「MCP 服务器」节的**注册表逻辑**：条目字段集合、逐字段校验、增删改查、
// 启用停用、列表操作集合与文案。纯 TS：零 Vue、零 DOM、零网络、零文件。
// 2026-10-07 全量 parity 批次。
//
// 与 `src/agentMcpServers.ts`（上一批产物，本文件不改它）的分工：
//   · 那边是"形状 + 逐字段救 + 存档归一化 + JSON 导入导出 + 失败折述"（数据面）；
//   · 这边是"用户在列表/表单里能做的每一个动作"（操作面）—— 照 ZCode `McpServerList.tsx`
//     的列表行操作与 `McpSettingsSection.tsx` 的 handler 逐条复刻，并把 ZCode 表单的
//     `canSave` 判定与 `mcpStore` 的持久化语义翻译成本仓可执行的真逻辑。
//
// 存储一律复用 `src/agentSettingsStore.ts`（只放机制），键独立于 `agentMcpServers.ts`
// 用的那个（见 AGENT_MCP_REGISTRY_STORAGE_KEY 注释）。坏档永不抛。
//
// —— 字段集合的 ZCode 出处（逐条可对账）——
//   · name          `mcpSettingsShared.ts:10`（FormState.name；`McpServerForm.tsx:254-260` 的 Input，
//                   编辑时 disabled）
//   · type/transport `mcpSettingsShared.ts:13`（FormState.type）。表单只开放三项
//                   （`McpServerForm.tsx:277-288`），第四项 streamableHttp 被注释掉（`:281-284`）
//   · command       `mcpSettingsShared.ts:14`（`McpServerForm.tsx:342-347`，stdio 分支）
//   · args          `mcpSettingsShared.ts:15`（`McpServerForm.tsx:353-358`，空格分隔一行）
//   · env           `mcpSettingsShared.ts:16`（`McpServerForm.tsx:189`/`:385-390`，stdio 的键值表文本）
//   · url           `mcpSettingsShared.ts:17`（`McpServerForm.tsx:364-369`，http/sse 分支）
//   · headers       `mcpSettingsShared.ts:18`（`McpServerForm.tsx:189`/`:194-195`，http/sse 的请求头文本）
//   · timeoutMs     `mcpSettingsShared.ts:19`（`McpServerForm.tsx:296-304`，number 输入）
//   · oauth         `mcpSettingsShared.ts:20`（JSON 模式保留，表单无控件；`:202-203`）
//   · protocolVersion `mcpSettingsShared.ts:21`（`McpServerForm.tsx:316-331`，sse 形态不渲染 `:311`）
//   · storageLevel/scope `mcpSettingsShared.ts:11`（ConfigStorageLevel user/workspace）
//   · enabled       列表行的 Switch（`McpServerList.tsx:162`）
//   · status / toolCount / failureKind —— **运行态**，不是表单字段（`McpServerList.tsx:86-97`/`:126-133`）。
//     本仓没有 MCP 客户端运行时，注册表**不登记**这三项（登记了也没人写）。失败码的中文折述
//     仍在 `agentMcpServers.ts` 的 `describeMcpFailure`，不在这里重造。

import {
  defaultSettingsStorage,
  readSettingsJson,
  writeSettingsJson,
  type SettingsStorage,
} from './agentSettingsStore.ts'

/** 注册表的存储键。独立于 `agentMcpServers.ts` 的 `taocode.agent.mcpServers`。 */
export const AGENT_MCP_REGISTRY_STORAGE_KEY = 'taocode.agent.mcpRegistry'

/** 传输类型。照 ZCode 表单开放的三项（`McpServerForm.tsx:277-288`）。 */
export const AGENT_MCP_TRANSPORTS = ['stdio', 'http', 'sse'] as const
export type AgentMcpRegistryTransport = (typeof AGENT_MCP_TRANSPORTS)[number]

/** 协议版本。`''` = 未设置 = 自动协商（ZCode 的 `auto` 是 Select 哨兵值，`McpServerForm.tsx:196-199`）。 */
export const AGENT_MCP_PROTOCOL_VERSIONS = ['', 'legacy', 'auto', '2026-07-28'] as const
export type AgentMcpRegistryProtocolVersion = (typeof AGENT_MCP_PROTOCOL_VERSIONS)[number]

/** 落盘层级。`mcpSettingsShared.ts:6`（ConfigStorageLevel）。 */
export const AGENT_MCP_SCOPES = ['user', 'workspace'] as const
export type AgentMcpRegistryScope = (typeof AGENT_MCP_SCOPES)[number]

/** 超时区间（毫秒）。ZCode `parseTimeoutMs`（`mcpSettingsShared.ts:127-132`）只要求有限且 > 0；
 *  本仓给它一个上界，避免把 `86400000` 这种手滑值当成合法等待。 */
export const AGENT_MCP_TIMEOUT_MIN_MS = 1
export const AGENT_MCP_TIMEOUT_MAX_MS = 600_000

/**
 * 一条注册表条目 —— 与 ZCode `FormState`（`mcpSettingsShared.ts:9-22`）同字段，
 * 但用**本仓的存储形状**（args/env/headers 已解析，timeoutMs 是 number）。
 *
 * `key` 是表单的 `name`（ZCode 用 `{[name]: config}` 作 JSON 键，`mcpSettingsShared.ts:136`），
 * 名字在编辑时不可改（`McpServerForm.tsx:258` 的 `disabled={!!editingId}`）—— 所以它是主键。
 */
export interface AgentMcpRegistryEntry {
  name: string
  transport: AgentMcpRegistryTransport
  scope: AgentMcpRegistryScope
  enabled: boolean
  command: string
  args: string[]
  env: Record<string, string>
  url: string
  headers: Record<string, string>
  timeoutMs: number
  oauth: Record<string, unknown> | null
  protocolVersion: AgentMcpRegistryProtocolVersion
}

/** 注册表整档。 */
export interface AgentMcpRegistry {
  servers: AgentMcpRegistryEntry[]
}

/** 空档（不是出厂默认：ZCode 这一节出厂就是空列表，`McpSettingsSection.tsx:1496` 的 empty 分支）。 */
export function emptyAgentMcpRegistry(): AgentMcpRegistry {
  return { servers: [] }
}

/** 校验问题。`field` 用于界面把红字贴到对应输入框上；`''` = 跨字段 / 条目级问题。 */
export interface AgentMcpRegistryProblem {
  name: string
  field: string
  message: string
}

/** 操作结果。增删改查统一返回它 —— 调用方不用 try/catch（永不抛）。 */
export interface AgentMcpRegistryResult {
  ok: boolean
  registry: AgentMcpRegistry
  problems: AgentMcpRegistryProblem[]
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function text(value: unknown): string {
  return typeof value === 'string' ? value : ''
}

/** 键值表：数字 / 布尔转字符串，其余丢掉（与 `agentMcpServers.ts` 的 stringTable 同口径）。 */
function stringTable(value: unknown): Record<string, string> {
  if (!isRecord(value)) return {}
  const out: Record<string, string> = {}
  for (const [key, item] of Object.entries(value)) {
    if (!key) continue
    if (typeof item === 'string') out[key] = item
    else if (typeof item === 'number' && Number.isFinite(item)) out[key] = String(item)
    else if (typeof item === 'boolean') out[key] = String(item)
  }
  return out
}

/** 字符串数组：只留非空串，**不去重**（args 里重复值合法）。 */
function stringList(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  const out: string[] = []
  for (const item of value) {
    if (typeof item !== 'string') continue
    const trimmed = item.trim()
    if (trimmed) out.push(trimmed)
  }
  return out
}

function isTransport(value: unknown): value is AgentMcpRegistryTransport {
  return value === 'stdio' || value === 'http' || value === 'sse'
}

function isScope(value: unknown): value is AgentMcpRegistryScope {
  return value === 'user' || value === 'workspace'
}

function isProtocolVersion(value: unknown): value is AgentMcpRegistryProtocolVersion {
  return value === '' || value === 'legacy' || value === 'auto' || value === '2026-07-28'
}

/**
 * 从原始内容反推传输。**照 ZCode `serverToForm` 的判定顺序**（`mcpSettingsShared.ts:45-54`）：
 * sse → streamableHttp → 有 command → stdio → 否则 http。非法枚举不硬切 stdio，
 * 免得一份手改坏的旧档落到错误的传输上。
 */
function inferTransport(raw: Record<string, unknown>): AgentMcpRegistryTransport {
  if (raw.transport === 'sse' || raw.type === 'sse') return 'sse'
  if (raw.transport === 'streamableHttp' || raw.type === 'streamableHttp') return 'http'
  if (typeof raw.command === 'string' && raw.command.trim()) return 'stdio'
  return 'http'
}

/** 超时归一：有限正数夹进区间，其余退 0（= 未设置，ZCode 这时不落该键，`mcpSettingsShared.ts:90`）。 */
function normalizeTimeout(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return 0
  const rounded = Math.round(value)
  if (rounded <= 0) return 0
  return Math.min(AGENT_MCP_TIMEOUT_MAX_MS, Math.max(AGENT_MCP_TIMEOUT_MIN_MS, rounded))
}

/** 逐字段救一条。永不抛：缺键补默认，垃圾字段单独丢。 */
export function normalizeAgentMcpRegistryEntry(raw: unknown): AgentMcpRegistryEntry {
  const item = isRecord(raw) ? raw : {}
  const transport = isTransport(item.transport) ? item.transport : inferTransport(item)
  return {
    name: text(item.name).trim(),
    transport,
    scope: isScope(item.scope) ? item.scope : 'user',
    // 缺 enabled 视为启用：列表行的开关读它（`McpServerList.tsx:162`）。
    enabled: typeof item.enabled === 'boolean' ? item.enabled : true,
    command: text(item.command).trim(),
    args: stringList(item.args),
    env: stringTable(item.env),
    url: text(item.url).trim(),
    headers: stringTable(item.headers),
    timeoutMs: normalizeTimeout(item.timeoutMs),
    oauth: isRecord(item.oauth) ? { ...item.oauth } : null,
    protocolVersion: isProtocolVersion(item.protocolVersion) ? item.protocolVersion : '',
  }
}

/** 归一化整档。**永不抛、永不返回坏值**：非对象 → 空档；条目非对象只丢自己。 */
export function normalizeAgentMcpRegistry(input: unknown): AgentMcpRegistry {
  if (!isRecord(input)) return emptyAgentMcpRegistry()
  if (!Array.isArray(input.servers)) return emptyAgentMcpRegistry()
  const servers: AgentMcpRegistryEntry[] = []
  for (const item of input.servers) {
    if (!isRecord(item)) continue
    servers.push(normalizeAgentMcpRegistryEntry(item))
  }
  return { servers }
}

/** 名字查重用的归一化（大小写不敏感 + 去首尾空白），与 ZCode 的 `{ [name]: config }` 键语义一致。 */
function nameKey(name: string): string {
  return name.trim().toLowerCase()
}

/**
 * 一条条目的字段校验 —— **照 ZCode `McpServerForm.tsx:167-183` 的 `canSave` 与
 * `mcpSettingsShared.ts:73-125` 的 `formToConfig` 二选一分支**逐条复刻。
 *
 * ZCode 的 `canSave` 只有两条硬判据：
 *   `Boolean(form.name.trim() && (form.type === "stdio" ? form.command.trim() : form.url.trim()))`
 * 其余字段在 ZCode 表单里**没有**必填/格式校验（timeoutMs 的 `min={1}` 只是 HTML 属性，
 * 不合法值被 `parseTimeoutMs` 静默丢弃）。本仓把 `parseTimeoutMs` 的丢弃与 URL 的
 * `http(s)://` 形态显式化成问题项 —— 这不是新增规则，是把 ZCode 的**静默丢弃**变成
 * **当场说清**（`mcpSettingsShared.ts:129-131` 丢弃，`:127` 注释）。
 *
 * `existing` 传入同档其它条目名，用于重名检查（ZCode 的重名由 `{ [name]: config }` 后者覆盖前者，
 * `mcpSettingsShared.ts:136`）。
 */
export function validateAgentMcpRegistryEntry(
  entry: AgentMcpRegistryEntry,
  existingNames: readonly string[] = [],
): AgentMcpRegistryProblem[] {
  const problems: AgentMcpRegistryProblem[] = []
  const label = entry.name.trim() || '该条目'
  const push = (field: string, message: string) => problems.push({ name: entry.name.trim(), field, message })

  // `mcpSettingsShared.ts:171-173`：JSON 模式必须有名字。表单里 name 也是主键。
  if (!entry.name.trim()) push('name', 'MCP 服务器名称不能为空。')
  else if (existingNames.some((other) => nameKey(other) === nameKey(entry.name))) {
    push('name', `MCP 服务器名称「${label}」重复。`)
  }

  // 二选一（`mcpSettingsShared.ts:75` / `:115` 两个互斥 return）。
  if (entry.transport === 'stdio') {
    if (!entry.command.trim()) push('command', `MCP 服务器「${label}」是 stdio 传输，必须填命令。`)
    if (entry.url.trim()) push('url', `MCP 服务器「${label}」同时填了命令和 URL：stdio 与 http/sse 不能混用。`)
  } else {
    if (!entry.url.trim()) push('url', `MCP 服务器「${label}」是 ${entry.transport} 传输，必须填 URL。`)
    else if (!/^https?:\/\/\S+$/.test(entry.url.trim())) {
      push('url', `MCP 服务器「${label}」的 URL 必须以 http:// 或 https:// 开头。`)
    }
    if (entry.command.trim()) push('command', `MCP 服务器「${label}」同时填了命令和 URL：stdio 与 http/sse 不能混用。`)
  }

  // timeoutMs：ZCode `parseTimeoutMs` 只留有限且 > 0 的整数（`mcpSettingsShared.ts:127-132`）。
  if (entry.timeoutMs !== 0) {
    if (!Number.isInteger(entry.timeoutMs) || entry.timeoutMs <= 0) {
      push('timeoutMs', `MCP 服务器「${label}」的超时必须是正整数毫秒。`)
    } else if (entry.timeoutMs < AGENT_MCP_TIMEOUT_MIN_MS || entry.timeoutMs > AGENT_MCP_TIMEOUT_MAX_MS) {
      push('timeoutMs', `MCP 服务器「${label}」的超时必须在 ${AGENT_MCP_TIMEOUT_MIN_MS} 到 ${AGENT_MCP_TIMEOUT_MAX_MS} 毫秒之间。`)
    }
  }

  // 协议版本：ZCode `isMcpProtocolVersion`（`mcpSettingsShared.ts:215-217`）非法值归一为未设置。
  if (!isProtocolVersion(entry.protocolVersion)) {
    push('protocolVersion', `MCP 服务器「${label}」的协议版本只能是 legacy / auto / 2026-07-28 之一。`)
  }

  if (!AGENT_MCP_TRANSPORTS.includes(entry.transport)) {
    push('transport', `MCP 服务器「${label}」的传输类型只能是 stdio / http / sse 之一。`)
  }
  return problems
}

/** 整档校验：逐条查，并把"同档内重名"算进去。空数组 = 可保存。 */
export function validateAgentMcpRegistry(registry: AgentMcpRegistry): AgentMcpRegistryProblem[] {
  const servers = Array.isArray(registry?.servers) ? registry.servers : []
  const problems: AgentMcpRegistryProblem[] = []
  const seen = new Map<string, number>()
  for (const entry of servers) {
    const others = servers.filter((other) => other !== entry).map((other) => other.name)
    problems.push(...validateAgentMcpRegistryEntry(entry, others))
    const key = nameKey(entry.name)
    if (!key) continue
    seen.set(key, (seen.get(key) ?? 0) + 1)
  }
  for (const [key, count] of seen) {
    if (count <= 1) continue
    const sample = servers.find((entry) => nameKey(entry.name) === key)
    // 只在整档层面报一次：逐条校验时 `others` 已会各报一次，这里补一条"整档重复"的口径。
    if (sample) problems.push({ name: sample.name.trim(), field: 'name', message: `MCP 服务器名称「${sample.name.trim()}」重复。` })
  }
  return problems
}

/** 列表里找一条（按名字，大小写不敏感 —— 与查重同口径）。 */
export function findAgentMcpRegistryEntry(registry: AgentMcpRegistry, name: string): AgentMcpRegistryEntry | null {
  const key = nameKey(name)
  if (!key) return null
  return registry.servers.find((entry) => nameKey(entry.name) === key) ?? null
}

function cloneRegistry(registry: AgentMcpRegistry): AgentMcpRegistry {
  return { servers: registry.servers.map((entry) => ({ ...entry, args: [...entry.args], env: { ...entry.env }, headers: { ...entry.headers } })) }
}

function sortedRegistry(registry: AgentMcpRegistry): AgentMcpRegistry {
  // 照 `McpSettingsSection.tsx:1194-1209` 的排序意图：需要关注的行（此处=停用行）先出，其余保持原序。
  const indexed = registry.servers.map((entry, index) => ({ entry, index }))
  indexed.sort((left, right) => Number(left.entry.enabled) - Number(right.entry.enabled) || left.index - right.index)
  return { servers: indexed.map(({ entry }) => entry) }
}

/**
 * 新建一条。**照 `McpSettingsSection.tsx:1265-1269` 的 `handleSave` 分支**：
 * 无 `prev` 走 add、有 `prev` 走 update。这里对应 `createAgentMcpRegistryEntry`。
 *
 * 与 ZCode 一致：重名不静默覆盖，而是拦下（ZCode 靠 `{ [name]: config }` 覆盖，本仓明确报错）。
 */
export function createAgentMcpRegistryEntry(registry: AgentMcpRegistry, entry: AgentMcpRegistryEntry): AgentMcpRegistryResult {
  const normalized = normalizeAgentMcpRegistryEntry(entry)
  const problems = validateAgentMcpRegistryEntry(normalized, registry.servers.map((item) => item.name))
  if (problems.length) return { ok: false, registry: cloneRegistry(registry), problems }
  const next = cloneRegistry(registry)
  next.servers.push(normalized)
  return { ok: true, registry: sortedRegistry(next), problems: [] }
}

/**
 * 改一条。**名字是主键，不可改**（`McpServerForm.tsx:258` 的 `disabled={!!editingId}`）——
 * 所以这里按 `name` 定位，只替换其余字段，不接受改名（改名 = 删除 + 新建，ZCode 的
 * `updateScopedMcpServer(source, prev.name, ...)` 也是用旧名定位，`McpSettingsSection.tsx:1266`）。
 */
export function updateAgentMcpRegistryEntry(registry: AgentMcpRegistry, name: string, patch: AgentMcpRegistryEntry): AgentMcpRegistryResult {
  const current = findAgentMcpRegistryEntry(registry, name)
  if (!current) {
    return { ok: false, registry: cloneRegistry(registry), problems: [{ name: name.trim(), field: 'name', message: `找不到 MCP 服务器「${name.trim()}」。` }] }
  }
  const normalized = normalizeAgentMcpRegistryEntry({ ...patch, name: current.name })
  const others = registry.servers.filter((entry) => nameKey(entry.name) !== nameKey(current.name)).map((entry) => entry.name)
  const problems = validateAgentMcpRegistryEntry(normalized, others)
  if (problems.length) return { ok: false, registry: cloneRegistry(registry), problems }
  const next = cloneRegistry(registry)
  next.servers = next.servers.map((entry) => (nameKey(entry.name) === nameKey(current.name) ? normalized : entry))
  return { ok: true, registry: sortedRegistry(next), problems: [] }
}

/** 删一条。**照 `McpSettingsSection.tsx:1276-1297` 的 `handleDelete`**：定位不到就是 no-op 成功（幂等）。 */
export function deleteAgentMcpRegistryEntry(registry: AgentMcpRegistry, name: string): AgentMcpRegistryResult {
  const key = nameKey(name)
  const next = cloneRegistry(registry)
  next.servers = next.servers.filter((entry) => nameKey(entry.name) !== key)
  return { ok: true, registry: sortedRegistry(next), problems: [] }
}

/**
 * 启用 / 停用。**照 `McpSettingsSection.tsx:1218-1243` 的 `handleToggle`**：
 * ZCode 那边 `toggleServer` 先落盘再改本地列表（`mcpStore.ts:434-463`），并推进/冻结状态灯。
 * 本仓没有状态灯（运行态），只做"落盘 + 改字段"这一半 —— 返回值告诉调用方是否需要
 * 触发后续刷新（ZCode 在启用后 `void requestMcpServerStatusList()`，`:1242`）。
 */
export function setAgentMcpRegistryEnabled(registry: AgentMcpRegistry, name: string, enabled: boolean): AgentMcpRegistryResult & { shouldRefresh: boolean } {
  const current = findAgentMcpRegistryEntry(registry, name)
  if (!current) {
    return { ok: false, registry: cloneRegistry(registry), problems: [{ name: name.trim(), field: 'name', message: `找不到 MCP 服务器「${name.trim()}」。` }], shouldRefresh: false }
  }
  const next = cloneRegistry(registry)
  next.servers = next.servers.map((entry) => (nameKey(entry.name) === nameKey(current.name) ? { ...entry, enabled } : entry))
  // 停用不需要刷新（`McpSettingsSection.tsx:1221-1227` 直接 return）；启用要拉一次状态（`:1242`）。
  return { ok: true, registry: sortedRegistry(next), problems: [], shouldRefresh: enabled }
}

/**
 * 列表的搜索过滤。**照 `filterLocalMcpServers`（`pluginManagedResourceGroups.ts:206-213`）**：
 * 匹配 `name` / `url` / `command` 三个字段，大小写不敏感、子串命中。
 */
export function filterAgentMcpRegistry(registry: AgentMcpRegistry, query: string): AgentMcpRegistryEntry[] {
  const keyword = query.trim().toLowerCase()
  if (!keyword) return registry.servers
  return registry.servers.filter((entry) =>
    [entry.name, entry.url, entry.command].some((value) => value.toLowerCase().includes(keyword)),
  )
}

/** 列表的排序：照 `McpSettingsSection.tsx:1194-1209`，需要关注的行先出（本仓用"停用"代替"出错"）。 */
export function sortAgentMcpRegistry(registry: AgentMcpRegistry): AgentMcpRegistry {
  return sortedRegistry(cloneRegistry(registry))
}

/** 操作集合 —— **逐条照 `McpServerList.tsx` 与 `McpSettingsSection.tsx` 真实存在的动作**。 */
export interface AgentMcpRegistryAction {
  id: string
  label: string
  hint: string
}

/**
 * 列表头部与行上的操作集合。
 *
 * 出处逐条：
 *   · refresh  `McpSettingsSection.tsx:1469`（`onRefresh={handleManualRefresh}`）+ `SettingsResourceHeaderActions.tsx:71-97`
 *   · import   `McpSettingsSection.tsx:1471`（`onImport`）+ zh-CN.ts:2499
 *   · new      `McpSettingsSection.tsx:1472`（`onNew={handleCreate}`）
 *   · edit     `McpServerList.tsx:108`（整行点击 = `onEdit`）+ `:211`
 *   · toggle   `McpServerList.tsx:162`（行尾 Switch = `onToggle`）
 *   · delete   `McpServerForm.tsx:397-411`（表单左下角 `leadingAction`）+ `McpSettingsSection.tsx:1276`
 *   · authorize `McpServerList.tsx:141-161`（OAuth 按钮，**运行态**）
 *
 * `runtime: true` 的两项（refresh 的真实含义、authorize）需要 MCP 客户端运行时；本仓没有，
 * 所以它们只作为"ZCode 真有这个动作"的登记，界面接线时按 `runtime` 决定是否渲染成控件。
 */
export const AGENT_MCP_REGISTRY_ACTIONS: readonly AgentMcpRegistryAction[] = [
  { id: 'refresh', label: '刷新', hint: '重新拉取 MCP 服务器连接状态（需要 MCP 客户端运行时）。' },
  { id: 'import', label: '导入', hint: '从外部 Agent 导入 MCP 服务器。' },
  { id: 'new', label: '新建', hint: '新建一个 MCP 服务器配置。' },
  { id: 'edit', label: '编辑', hint: '点击整行打开表单编辑。' },
  { id: 'toggle', label: '启用 / 停用', hint: '行尾开关切换该服务器是否参与连接。' },
  { id: 'delete', label: '删除', hint: '在编辑表单里删除该服务器（需二次确认）。' },
  { id: 'authorize', label: '打开授权', hint: 'OAuth 授权入口（需要 MCP 客户端运行时与账号体系）。' },
]

/** 需要运行态才能真做的动作 id（界面据此不渲染成可点控件）。 */
export const AGENT_MCP_REGISTRY_RUNTIME_ACTIONS: readonly string[] = ['refresh', 'authorize']

/** 删除确认文案。**逐字取自 zh-CN.ts:2471-2473**（`{name}` 用条目名替换）。 */
export const AGENT_MCP_DELETE_CONFIRM_TITLE = '删除 MCP 服务器"{name}"？'
export const AGENT_MCP_DELETE_CONFIRM_DESCRIPTION = '删除后将无法恢复，该服务器配置将从文件中移除。'
export const AGENT_MCP_DELETE_CONFIRM_ACTION = '确认删除'

/** 列表空态与分组文案。逐字取自 zh-CN.ts。 */
export const AGENT_MCP_TEXT = {
  title: 'MCP 服务器',
  description: '管理 ZCode Agent 使用的 MCP 服务器配置。',
  createOpen: '新建 MCP 服务器',
  importOpen: '从外部 Agent 导入 MCP 服务器',
  importAction: '导入',
  emptyTitle: '还没有 MCP 服务器',
  emptyDescription: '添加一个 MCP 服务器，让 Agent 获得额外能力。',
  searchPlaceholder: '搜索 MCP 服务器…',
  groupLocal: '已配置 MCP 服务器',
  groupPlugin: 'Plugin MCP 服务器',
  installed: '已安装',
  emptyInstalledTitle: '尚未安装 MCP 服务器',
  emptyInstalledDescription: '手动新建服务器，或导入已有配置。',
  newServer: '新建 MCP 服务器',
  searchEmpty: '没有匹配的 MCP 服务器',
  deleteConfirmTitle: AGENT_MCP_DELETE_CONFIRM_TITLE,
  deleteConfirmDescription: AGENT_MCP_DELETE_CONFIRM_DESCRIPTION,
  deleteConfirmAction: AGENT_MCP_DELETE_CONFIRM_ACTION,
  formName: '名称',
  formType: '类型',
  formTimeoutMs: '超时时间 MS',
  formProtocolVersion: '协议版本',
  formProtocolAuto: '自动（推荐）',
  formProtocolLegacy: '兼容旧版',
  formProtocolModern: 'v2',
  formTypeStdio: 'stdio（本地命令）',
  formTypeSse: 'SSE（Server-Sent Events）',
  formCommand: '命令',
  formArgs: '参数（空格分隔）',
  formEnvOptional: '环境变量（可选）',
  formHeadersOptional: '请求头（可选）',
  formCreateTitle: '新建 MCP 服务器',
  formEditTitle: '编辑 MCP 服务器',
  formCreateDescription: '填写新的 MCP 配置，保存后返回列表。',
  formEditDescription: '修改当前 MCP 配置，保存后返回列表。',
  formJsonParseError: 'JSON 解析失败',
  scopeLabel: '作用域',
  scopeUser: '用户',
  scopeWorkspace: '工作区',
} as const

/** 传输类型的显示名（照 `McpServerForm.tsx:277-288` 的 SelectItem）。 */
export function agentMcpTransportLabel(transport: string): string {
  if (transport === 'stdio') return AGENT_MCP_TEXT.formTypeStdio
  if (transport === 'sse') return AGENT_MCP_TEXT.formTypeSse
  if (transport === 'http') return 'HTTP'
  return transport
}

/** 协议版本的显示名（照 `McpServerForm.tsx:321-330`）。 */
export function agentMcpProtocolVersionLabel(version: string): string {
  if (version === 'legacy') return AGENT_MCP_TEXT.formProtocolLegacy
  if (version === '2026-07-28') return AGENT_MCP_TEXT.formProtocolModern
  return AGENT_MCP_TEXT.formProtocolAuto
}

/** 列表行的副标题 —— **照 `McpServerList.tsx:99-103` 的真实拼法**：`类型 · url` 或 `类型 · command args`。 */
export function agentMcpEntryDescription(entry: AgentMcpRegistryEntry): string {
  const typeLabel = agentMcpTransportLabel(entry.transport)
  if (entry.url) return `${typeLabel} · ${entry.url}`
  if (entry.command) return `${typeLabel} · ${entry.command} ${entry.args.join(' ')}`.trimEnd()
  return typeLabel
}

/** 读注册表（缺省走 localStorage；坏档 / 旧形状退回空档，永不抛）。 */
export function loadAgentMcpRegistry(storage: SettingsStorage | null = defaultSettingsStorage()): AgentMcpRegistry {
  return readSettingsJson(storage, AGENT_MCP_REGISTRY_STORAGE_KEY, normalizeAgentMcpRegistry)
}

/** 写注册表。存不下（配额满 / 隐私模式）静默降级 —— 返回是否真的落盘。 */
export function saveAgentMcpRegistry(registry: AgentMcpRegistry, storage: SettingsStorage | null = defaultSettingsStorage()): boolean {
  return writeSettingsJson(storage, AGENT_MCP_REGISTRY_STORAGE_KEY, registry)
}