// Agent MCP server configuration, validation, persistence, and JSON conversion.

import {
  defaultSettingsStorage,
  readSettingsJson,
  writeSettingsJson,
  type SettingsStorage,
} from './agentSettingsStore.ts'

/** 存储键。与 `taocode.agent.settings` / `taocode.agent.sessions` 同一族（localStorage）。 */
export const AGENT_MCP_STORAGE_KEY = 'taocode.agent.mcpServers'

/** 传输类型。ZCode 的第四项 `streamableHttp` 在表单里被注释掉了（`McpServerForm.tsx:281-284`），同口径只留三项。 */
export type AgentMcpTransport = 'stdio' | 'http' | 'sse'

/** 协议版本。空串 = 未设置 = 自动协商（ZCode 用 `auto` 作 Select 哨兵值，`McpServerForm.tsx:196-199`）。 */
export type AgentMcpProtocolVersion = '' | 'legacy' | 'auto' | '2026-07-28'

/** 配置落在哪一级（ZCode `ConfigStorageLevel`，`mcpSettingsShared.ts:6`）。 */
export type AgentMcpScope = 'user' | 'workspace'

/**
 * 超时区间（毫秒）。**与 ZCode 的一处刻意差异**：ZCode 的 `parseTimeoutMs`
 * （`mcpSettingsShared.ts:127-132`）只要求「有限且 > 0」，没有上限。这里上界 10 分钟 ——
 * 一个填错成 `86400000`（一天）的超时会让用户以为服务器死了，其实只是自己把等待拉长了。
 * 要放宽就改这个常数，不要改判定。
 */
export const AGENT_MCP_TIMEOUT_MIN_MS = 1
export const AGENT_MCP_TIMEOUT_MAX_MS = 600_000

/** 一条 MCP 服务器配置。 */
export interface AgentMcpServer {
  id: string
  name: string
  enabled: boolean
  transport: AgentMcpTransport
  /** stdio 才有（`mcpSettingsShared.ts:60`）。 */
  command: string
  /** stdio 才有。表单里是空格分隔的一行，落盘是字符串数组（`mcpSettingsShared.ts:61`/`:88`）。 */
  args: string[]
  /** http / sse 才有（`mcpSettingsShared.ts:63`）。 */
  url: string
  /** stdio 的环境变量表（`mcpSettingsShared.ts:62`）。 */
  env: Record<string, string>
  cwd: string
  /** http / sse 的请求头表（`mcpSettingsShared.ts:64`）。 */
  headers: Record<string, string>
  /** 毫秒。`0` = 未设置（ZCode 这时压根不落这个键，`mcpSettingsShared.ts:90`）。 */
  timeoutMs: number
  protocolVersion: AgentMcpProtocolVersion
  scope: AgentMcpScope
}

export interface AgentMcpToolDescriptor {
  serverId: string
  serverName: string
  toolName: string
  name: string
  description: string
  inputSchema: Record<string, unknown>
  outputSchema?: Record<string, unknown>
  annotations?: { readOnlyHint?: boolean; destructiveHint?: boolean; idempotentHint?: boolean; openWorldHint?: boolean }
}

export interface AgentMcpServerStatus {
  transport: string
  status: 'connecting' | 'connected' | 'disabled' | 'disconnected' | 'failed' | 'untrusted'
  updatedAt: string
  toolCount: number
  protocolEra?: 'legacy' | 'modern'
  failureKind?: string
  error?: string
}

export interface AgentMcpRuntimeSnapshot {
  statuses: Record<string, AgentMcpServerStatus>
  tools: AgentMcpToolDescriptor[]
}

export interface AgentMcpToolCallResult {
  content: Array<Record<string, unknown>>
  structuredContent?: unknown
  isError?: boolean
  _meta?: Record<string, unknown>
}

/** 「MCP 服务器」节的状态面。 */
export interface AgentMcpSettings {
  servers: AgentMcpServer[]
}

/**
 * 失败码 → 中文一句。逐条取自 `packages/ui/src/i18n/locales/zh-CN.ts:2448-2469`，
 * 码表取自 `packages/shared/src/zcode-protocol/index.ts:664-684`（共 19 个）。
 *
 * 未知码的兜底语义照 `McpFailurePresentation.tsx:10`：`kind ?? "connection_failed"`。
 *
 * **三处产品特有文案如实登记**（保留原文是为了与 ZCode 枚举逐字对齐，不是本仓真有的能力）：
 *   · `not_authenticated`（"请先登录 ZCode"）、`coding_plan_required`（"购买或配置 Coding Plan"）
 *     —— 本仓没有账号体系，也没有 Coding Plan，这两个码不会出现；
 *   · `official_origin_untrusted`（官方源安全校验）—— 本仓没有官方源白名单，第三方 URL 不会被这样拦。
 */
const MCP_FAILURE_MESSAGES: Record<string, string> = {
  config_invalid: 'MCP 配置无效，请检查服务器配置。',
  runtime_unavailable: 'MCP 运行环境不可用，请检查插件和本地依赖。',
  process_start_failed: 'MCP 进程启动失败。',
  network_unreachable: '无法连接到 MCP 服务器，请检查网络、代理和服务器地址。',
  connection_timeout: '连接 MCP 服务器超时，请稍后重试。',
  protocol_negotiation_failed: 'MCP 协议协商失败，服务器版本可能不兼容。可尝试编辑该服务器，将协议版本切换为「兼容旧版」。',
  tool_list_failed: '已连接 MCP 服务器，但获取工具列表失败。',
  unexpected_disconnect: 'MCP 连接已意外断开。',
  oauth_authorization_failed: 'MCP 授权未完成或已超时，请重新授权。',
  official_origin_untrusted: 'MCP 服务器地址未通过安全校验，连接已阻止。',
  not_authenticated: '当前未登录，请先登录 ZCode。',
  coding_plan_required: '当前账号没有 Coding Plan，请先购买或配置 Coding Plan。',
  server_not_found: '找不到该 MCP 服务器，请检查插件或服务器配置。',
  server_unavailable: 'MCP 服务暂时不可用，请稍后重试。',
  rate_limited: 'MCP 请求过于频繁，请稍后重试。',
  server_internal_error: 'MCP 服务发生内部错误，请稍后重试。',
  protocol_error: 'MCP 协议请求失败，客户端与服务器可能不兼容。',
  status_unavailable: '暂时无法获取 MCP 状态，请刷新或重启 Agent。',
  connection_failed: 'MCP 服务器连接失败，请稍后重试。',
}

/** 未知 / 空码时的兜底文案（`McpFailurePresentation.tsx:10` 的 `?? "connection_failed"`）。 */
export const AGENT_MCP_FAILURE_FALLBACK = MCP_FAILURE_MESSAGES.connection_failed!

export function defaultAgentMcpSettings(): AgentMcpSettings {
  return { servers: [] }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function text(value: unknown, fallback: string): string {
  return typeof value === 'string' ? value : fallback
}

/** 字符串表逐条救：数字 / 布尔转成字符串，null / 对象 / 数组等救不了的丢掉（不丢整表）。 */
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

/**
 * 字符串数组：逐条救（只留非空串），**不去重**。
 *
 * 去重是错的：参数表里重复出现同一个值完全合法 —— 本仓那份真实注册就是
 * `["--root", "D:\\TaoCode", "--repo-dir", "D:\\TaoCode"]`（`D:\\TaoCode` 出现两次）。
 * 曾经在工具名与参数表之间共用一个去重 helper，结果每读一次存档就吃掉一个参数。
 */
function stringList(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  const out: string[] = []
  for (const item of value) {
    if (typeof item !== 'string') continue
    const name = item.trim()
    if (!name) continue
    out.push(name)
  }
  return out
}

/**
 * 字符串数组 + 去重。**只给"集合语义"的字段用**（工具名、协议版本）——
 * 两个同名工具会让导出的声明面看起来像有两个同名工具。
 */
function isTransport(value: unknown): value is AgentMcpTransport {
  return value === 'stdio' || value === 'http' || value === 'sse'
}

function isProtocolVersion(value: unknown): value is AgentMcpProtocolVersion {
  return value === '' || value === 'legacy' || value === 'auto' || value === '2026-07-28'
}

/**
 * 超时：有限整数且 > 0 就夹进区间，其余退 0（= 未设置）。
 *
 * 夹而不是丢：`30000` 这种手滑值夹一下还能用，而按"非法即退默认"会把用户填的整段配置一起变样。
 */
function normalizeTimeout(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return 0
  const rounded = Math.round(value)
  if (rounded <= 0) return 0
  return Math.min(AGENT_MCP_TIMEOUT_MAX_MS, Math.max(AGENT_MCP_TIMEOUT_MIN_MS, rounded))
}

/**
 * 传输判定。**非法枚举不直接退 stdio**，而是照 ZCode `serverToForm`（`mcpSettingsShared.ts:45-54`）
 * 的顺序从内容反推：sse → streamableHttp → 有 command → stdio → 否则 http。
 * 这样一份手改坏的旧存档（`type: "highttp"`）仍能落到正确的传输上，而不是被一刀切成 stdio。
 */
function inferTransport(raw: Record<string, unknown>): AgentMcpTransport {
  if (raw.type === 'sse') return 'sse'
  // ZCode 的 streamableHttp 在表单里没开放（`McpServerForm.tsx:281-284`），落到最近的 http 传输。
  if (raw.type === 'streamableHttp') return 'http'
  if (typeof raw.command === 'string' && raw.command.trim()) return 'stdio'
  return 'http'
}

/** 归一化单条。`index` 只用来补 id —— 缺 id 的坏条目不丢，补一个可预期的生成 id。 */
function normalizeMcpServer(raw: unknown, index: number): AgentMcpServer {
  const item = isRecord(raw) ? raw : {}
  const name = text(item.name, '').trim()
  const id = text(item.id, '').trim() || `mcp-${index + 1}`
  const transport = isTransport(item.transport)
    ? item.transport
    : isTransport(item.type)
      ? item.type
      : inferTransport(item)
  return {
    id,
    name: name || id,
    // 缺 enabled 视为启用：ZCode 列表行的开关读的就是这个值（`McpServerList.tsx:162`），
    // 旧存档里没这个键时默认"显示出来且开着"比默认关掉更符合用户预期。
    enabled: typeof item.enabled === 'boolean' ? item.enabled : true,
    transport,
    command: text(item.command, '').trim(),
    args: stringList(item.args),
    cwd: text(item.cwd, '').trim(),
    url: text(item.url, '').trim(),
    env: stringTable(item.env),
    headers: stringTable(item.headers),
    timeoutMs: normalizeTimeout(item.timeoutMs),
    protocolVersion: isProtocolVersion(item.protocolVersion) ? item.protocolVersion : '',
    scope: item.scope === 'workspace' ? 'workspace' : 'user',
  }
}

/**
 * 把任意输入归一成一份合法设置。**永不抛、永不返回坏值** —— 旧存档缺键补默认。
 *
 * 逐字段救、逐条救（本仓铁律：不许按字段数量判损坏，真出过把用户锁在项目外的事故）：
 * 垃圾条目（非对象）直接跳过，其余每条各救各的。
 */
export function normalizeAgentMcpSettings(input: unknown): AgentMcpSettings {
  if (!isRecord(input)) return defaultAgentMcpSettings()
  // `servers` 键缺失或不是数组 = 存档坏在这一层，退回空默认；
  // 键在、值是数组（哪怕是空数组）= 用户自己存的那份，尊重它。
  if (!Array.isArray(input.servers)) return defaultAgentMcpSettings()
  const servers: AgentMcpServer[] = []
  for (const item of input.servers) {
    // 垃圾条目（字符串 / 数字 / null / 数组）只丢自己，不丢整表。
    if (!isRecord(item)) continue
    servers.push(normalizeMcpServer(item, servers.length))
  }
  return { servers }
}

/** 导出用的配置形状（各客户端 `mcpServers` 里那一条的宽形状）。 */
export interface AgentMcpServerConfig {
  type?: AgentMcpTransport
  command?: string
  args?: string[]
  cwd?: string
  env?: Record<string, string>
  url?: string
  headers?: Record<string, string>
  timeoutMs?: number
  protocolVersion?: Exclude<AgentMcpProtocolVersion, ''>
}

/** 导出用的整份文档。包一层 `mcpServers` 是本机 `~/.qoder/settings.json` 的真实形状。 */
export interface AgentMcpConfigDocument {
  mcpServers: Record<string, AgentMcpServerConfig>
}

/**
 * 把一条服务器配置导成各客户端通用的 JSON 形状。
 *
 * 形状选择（逐条有据）：
 *   · 外层包 `mcpServers` —— 本机 `~/.qoder/settings.json` 就是这个形状（已核实）；
 *     ZCode 的 `jsonDraftToForm`（`mcpSettingsShared.ts:145-151`）也显式认这一支。
 *   · 内层按 ZCode `formToConfig`（`mcpSettingsShared.ts:73-125`）**二选一**产出：
 *     stdio 只给 `type/command/args/env`，http/sse 只给 `type/url/headers`，
 *     绝不同时出现 `command` 与 `url`。
 *   · 空的可选键不落盘（`timeoutMs` 0 → 不给；`protocolVersion` '' → 不给；空表 → 不给），
 *     与 ZCode 那些 `...(x !== undefined ? { x } : {})` 条件展开（`:90-93`、`:119-123`）同口径。
 */
export function mcpServerConfigJson(server: AgentMcpServer): AgentMcpConfigDocument {
  const config: AgentMcpServerConfig = { type: server.transport }
  if (server.transport === 'stdio') {
    config.command = server.command
    config.args = [...server.args]
    if (server.cwd) config.cwd = server.cwd
    if (Object.keys(server.env).length) config.env = { ...server.env }
  } else {
    config.url = server.url
    if (Object.keys(server.headers).length) config.headers = { ...server.headers }
  }
  if (server.timeoutMs > 0) config.timeoutMs = server.timeoutMs
  if (server.protocolVersion) config.protocolVersion = server.protocolVersion
  return { mcpServers: { [server.name]: config } }
}

/** 粘贴解析的结果。`server` / `error` 恒有一个非 null，Vue 侧不用写可选链。 */
export type AgentMcpParseResult =
  | { ok: true; server: AgentMcpServer; error: null }
  | { ok: false; server: null; error: string }

function parseFailure(error: string): AgentMcpParseResult {
  return { ok: false, server: null, error }
}

/**
 * 从用户粘贴的 JSON 解析成一条服务器条目（带错误信息）。
 *
 * 逐条照 `jsonDraftToForm`（`mcpSettingsShared.ts:139-211`）的分支：
 *   · JSON 语法错 —— 文案对齐 `settings.mcp.form.jsonParseError`（zh-CN.ts:2479）；
 *   · 顶层是数组 / 标量 —— "JSON 内容不是有效的 MCP server 配置对象。"（`:167-169`）；
 *   · `{"mcpServers": {...}}` 包了不等于 1 条 —— "JSON 模式暂时只支持一次编辑一个 MCP server。"（`:146-149`）；
 *   · 顶层单条目且不含 `type` / `command` / `url` 时，把那唯一键当服务器名（`:153-165`）；
 *   · 解析不出名字（含空对象 `{}`）—— "JSON 模式需要提供 server 名称。"（`:171-173`）。
 *
 * **永不抛**：所有失败都变成 `ok: false` + 一句中文。
 */
export function parseMcpServerInput(text: string): AgentMcpParseResult {
  const raw = typeof text === 'string' ? text.trim() : ''
  if (!raw) return parseFailure('JSON 内容为空。')

  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error)
    return parseFailure(`JSON 解析失败：${detail}`)
  }
  // 数组 / 字符串 / 数字 / null 在这里就被挡掉（ZCode 同一条判定 `mcpSettingsShared.ts:167`）。
  if (!isRecord(parsed)) return parseFailure('JSON 内容不是有效的 MCP server 配置对象。')

  let serverName = ''
  let serverConfig: unknown = parsed

  if (isRecord(parsed.mcpServers)) {
    const entries = Object.entries(parsed.mcpServers).filter(([, value]) => isRecord(value))
    if (entries.length !== 1) {
      return parseFailure('JSON 模式暂时只支持一次编辑一个 MCP server。')
    }
    serverName = entries[0]![0]
    serverConfig = entries[0]![1]
  } else if (!('type' in parsed) && !('command' in parsed) && !('url' in parsed)) {
    // 顶层只有一个条目、且那条目不是"裸配置"时，键名就是服务器名。
    const entries = Object.entries(parsed).filter(([, value]) => isRecord(value))
    if (entries.length === 1) {
      serverName = entries[0]![0]
      serverConfig = entries[0]![1]
    }
  }

  if (!isRecord(serverConfig)) return parseFailure('JSON 内容不是有效的 MCP server 配置对象。')
  const name = serverName.trim()
  if (!name) return parseFailure('JSON 模式需要提供 server 名称。')

  // 走与存档同一条归一化路径：粘贴进来的配置和磁盘上的配置享有同一套逐字段救。
  return { ok: true, server: normalizeMcpServer({ ...serverConfig, name }, 0), error: null }
}

/**
 * 把 MCP 失败码折成一句中文。
 *
 * 照 `resolveMcpFailureMessageId`（`McpFailurePresentation.tsx:7-11`）的兜底语义：
 * 拿不到合法码就用 `connection_failed`。`raw` 收三种形态 —— 一个失败码字符串、
 * 一条带 `failureKind` 的服务器对象、或 `undefined`（列表里没失败的那一行）。
 */
export function describeMcpFailure(raw: unknown): string {
  let kind = ''
  if (typeof raw === 'string') kind = raw
  else if (isRecord(raw)) kind = text(raw.failureKind, '')
  return MCP_FAILURE_MESSAGES[kind] ?? AGENT_MCP_FAILURE_FALLBACK
}

/**
 * 保存前的校验：返回问题清单（空数组 = 可以保存）。
 *
 * 与 `normalizeAgentMcpSettings` 的分工：那边是"读进来的坏数据要能救回来"，
 * 这边是"用户敲进去的坏数据要当场拦下并说清楚"（口径同 `src/agentSettings.ts`）。
 *
 * 它同时也是**手搭对象**（Vue 侧直接 new 出来的、或将来别的模块传进来的）的最后一道闸：
 * 所以这里不假设 `args` 一定是字符串数组、也不假设 `timeoutMs` 一定夹过区间。
 */
export function validateAgentMcpSettings(settings: AgentMcpSettings): string[] {
  const problems: string[] = []
  const seen = new Set<string>()
  const servers = Array.isArray(settings?.servers) ? settings.servers : []
  for (const [index, server] of servers.entries()) {
    const name = typeof server?.name === 'string' ? server.name.trim() : ''
    const label = name || `第 ${index + 1} 条`
    if (!name) {
      problems.push(`${label}：MCP 服务器名称不能为空。`)
    } else if (seen.has(name)) {
      // 重名会让 `mcpServers` 导出时后者覆盖前者（ZCode 的 `formToJsonDraft` 是 `{ [name]: config }`，
      // `mcpSettingsShared.ts:136`）—— 用户以为配了两台，实际只有一台。
      problems.push(`MCP 服务器名称「${name}」重复。`)
    } else {
      seen.add(name)
    }

    const transport = isTransport(server?.transport) ? server.transport : inferTransport(isRecord(server) ? server : {})
    const command = typeof server?.command === 'string' ? server.command.trim() : ''
    const url = typeof server?.url === 'string' ? server.url.trim() : ''

    if (transport === 'stdio') {
      if (!command) problems.push(`MCP 服务器「${label}」是 stdio 传输，必须填命令。`)
      // 二选一（`mcpSettingsShared.ts:75`/`:115` 是两个互斥的 return）：混填说明用户没想清楚。
      if (url) problems.push(`MCP 服务器「${label}」同时填了命令和 URL：stdio 与 http/sse 不能混用。`)
    } else {
      if (!url) problems.push(`MCP 服务器「${label}」是 ${transport} 传输，必须填 URL。`)
      else if (!/^https?:\/\/\S+$/.test(url)) {
        problems.push(`MCP 服务器「${label}」的 URL 必须以 http:// 或 https:// 开头。`)
      }
      if (command) problems.push(`MCP 服务器「${label}」同时填了命令和 URL：stdio 与 http/sse 不能混用。`)
    }

    if (!Array.isArray(server?.args) || server.args.some((item: unknown) => typeof item !== 'string')) {
      problems.push(`MCP 服务器「${label}」的参数必须是字符串数组。`)
    }
    const timeout = server?.timeoutMs
    if (timeout !== 0) {
      if (typeof timeout !== 'number' || !Number.isFinite(timeout) || !Number.isInteger(timeout)) {
        problems.push(`MCP 服务器「${label}」的超时必须是整数毫秒。`)
      } else if (timeout < AGENT_MCP_TIMEOUT_MIN_MS || timeout > AGENT_MCP_TIMEOUT_MAX_MS) {
        problems.push(`MCP 服务器「${label}」的超时必须在 ${AGENT_MCP_TIMEOUT_MIN_MS} 到 ${AGENT_MCP_TIMEOUT_MAX_MS} 毫秒之间。`)
      }
    }
    if (!isProtocolVersion(server?.protocolVersion)) {
      problems.push(`MCP 服务器「${label}」的协议版本只能是 legacy / auto / 2026-07-28 之一。`)
    }
  }
  return problems
}

/** 从存储读设置（缺省走 `localStorage`；坏存档 / 旧形状退回默认，永不抛）。 */
export function loadAgentMcpSettings(storage: SettingsStorage | null = defaultSettingsStorage()): AgentMcpSettings {
  return readSettingsJson(storage, AGENT_MCP_STORAGE_KEY, normalizeAgentMcpSettings)
}

/** 写设置。存不下（配额满 / 隐私模式）时静默降级 —— 只丢持久化，不打断本次会话。 */
export function saveAgentMcpSettings(settings: AgentMcpSettings, storage: SettingsStorage | null = defaultSettingsStorage()): boolean {
  return writeSettingsJson(storage, AGENT_MCP_STORAGE_KEY, settings)
}
