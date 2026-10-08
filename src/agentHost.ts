// Agent 的**装配层**：把会话状态机（`agentSession.ts`）、待决改动台账（`agentEdits.ts`）、
// 设置（`agentSettings.ts`）与 IDE 的四项能力（读文件 / 写文件 / 跳到编辑器 / 显示差异）接到一起。
//
// 为什么要有这一层：面板组件不该知道"批准一条 write_file 之后到底发生了什么"。那条链路是
// 「审批 → 读 before → 算 after → 记进台账 → 按策略决定是否立刻写盘 → 可选地让编辑器显示差异」，
// 每一步都要能脱离界面验证。组件只负责把点击转成这里的调用、把这里的返回值画出来。
//
// **项目分区**（用户原话：「原有项目分区取消，改为自动读取当前TaoCode项目作为项目分区」）：
// 本模块没有"选择项目"这件事 —— 工作区根由 IDE 传进来（`workspaceRoot`），
// Agent 只在这个根里读/写。`assertInsideWorkspace` 是这条规矩的守卫：
// 越出工作区的路径一律拒绝，因为"自动读取当前项目"不等于"可以碰项目外的文件"。
//
// 与 `native/mcp_server.cpp` 的关系：那边的权限档也读 `src/agent.ts` 的 `defaultAgentPermissions`，
// 与本模块同一档。两边都不自己另立一套默认值。
import type { AgentToolCall } from './agent.ts'
import { contextUsage } from './agent.ts'
import { collectReferencedFiles, parseAgentMessage, type AgentMessageSegment } from './agentMessages.ts'
import { createAgentEditLedger, type AgentEditLedger, type AgentEditOutcome, type AgentEditSummary } from './agentEdits.ts'
import { createAgentSession, type AgentChatMessage, type AgentModelMessage, type AgentModelReply, type AgentModelToolInvocation, type AgentSession, type AgentSessionOptions } from './agentSession.ts'
import { editPolicyOf, type AgentSettingsState } from './agentSettings.ts'
import { fromAgentModelProvider, AGENT_PROVIDER_API_FORMAT_PATHS } from './agentModelProviders.ts'
import { applyOrderedJsonMergePatches, compileModelOptionMap, type JsonObject } from './agentModelOptionMap.ts'
import { decodeCustomModelValue } from './agentModelSelection.ts'
import type { AgentMcpRuntimeSnapshot, AgentMcpToolCallResult, AgentMcpToolDescriptor } from './agentMcpServers.ts'

export interface AgentModelHttpRequest {
  url: string
  headers: Record<string, string>
  body: string
}

export interface AgentModelHttpResponse {
  available: boolean
  status?: number
  content?: string
  reason?: string
}

/** IDE 需要提供给 Agent 的四项能力（都由宿主注入，本模块不直接碰文件系统或界面）。 */
export interface AgentHostBridge {
  /** 当前工作区根（"自动读取当前 TaoCode 项目"就是读它）。 */
  workspaceRoot(): string
  /** 工作区内的文件清单（相对路径），给模型挑目标、给上下文算用量。 */
  listFiles(): string[]
  /** 读一个工作区相对路径的当前内容；读不到返回 null。宿主的文件桥是 Promise，这一位跟着异步。 */
  readFile(path: string): Promise<string | null>
  /** 写一个工作区相对路径；resolve 后的布尔才是结论（写失败 = false，台账保持待决）。 */
  writeFile(path: string, content: string): Promise<boolean>
  /** 在左侧编辑器里打开文件并定位（用户原话：对话内的文件改左侧跳转到对应窗口）。 */
  openFile(path: string, line: number | null): void
  /** 让编辑器显示一条待决改动的红绿差异。 */
  showDiff(path: string, editId: number): void
  /** 宿主的 HTTP POST 通道；模型请求只从显式 Send 调用。 */
  modelRequest(request: AgentModelHttpRequest, onChunk: (chunk: Uint8Array) => void, signal: AbortSignal): Promise<AgentModelHttpResponse>
  mcpRuntimeSnapshot?(): Promise<AgentMcpRuntimeSnapshot>
  callMcpTool?(serverId: string, toolName: string, args: Record<string, unknown>): Promise<AgentMcpToolCallResult>
  buildSkillPromptContext?(prompt: string): Promise<string>
  notify?(message: string, error?: boolean): void
}

export interface AgentHostOptions {
  bridge: AgentHostBridge
  settings: AgentSettingsState
  /** 时钟注入（测试用）。 */
  now?: () => Date
}

/**
 * **冻结的会话选择**：会话库里存的那一份（模型值 + 推理档位选项）。
 *
 * 形状取自 ZCode 的 `ModelSelection`（`desktop/src/host/index.ts:371-375` 的
 * `selection.options.reasoningLevel`；存库形状见 `services/src/session/tasksDatabase/provider-selection-v2.ts:66`）。
 * 本仓由面板从会话库读出来、在 `send` 时传进来；装配层只读 `model` 与 `options.reasoningLevel`，
 * 其余字段忽略；**缺哪一个字段就等于没有那项配置**（保留旧请求路径，见 `send` 的说明）。
 */
export interface AgentHostModelSelection {
  /** 模型值（`custom:provider:model` 编码，与设置里 `model` 同一形状）。 */
  model?: string
  /** 档位选项：只有模型自己声明了推理映射时才会被消费。 */
  options?: { reasoningLevel?: string }
}

/** 一次工具调用的执行结果，供面板显示。 */
export interface AgentToolResult {
  call: AgentToolCall
  ok: boolean
  /** 人可读的一行结果（读文件给字符数，写文件给 +N/−M）。 */
  detail: string
  /** 返回给模型的工具结果。 */
  modelContent?: string
  /** 写文件产生的台账条目 id（读文件没有）。 */
  editId?: number
}

export interface AgentHost {
  session(): AgentSession
  ledger(): AgentEditLedger
  settings(): AgentSettingsState
  /** Notify mounted panels when settings are replaced outside the Agent host. */
  onSettingsChange(listener: () => void): () => void
  /** 保存设置（并让已在跑的会话立刻用上新权限）。 */
  updateSettings(next: AgentSettingsState): void
  /** 把一条消息切成分段（面板直接贴）。 */
  segments(message: AgentChatMessage): AgentMessageSegment[]
  /**
   * 发一条并跑完这一轮里被放行的工具调用（读文件要走桥，整条链异步）。
   *
   * 第三个参数是**冻结的会话选择**（会话库里存的那份）：旧调用方传字符串 = 只覆盖模型值、
   * 没有档位；新调用方传 `{ model, options.reasoningLevel }`。整轮（初次请求、工具续发、
   * 批准后的续发）都用这一份，中途改选择不影响本轮 —— ZCode 的 option value 同样是
   * 每请求只绑本轮冻结值（`model-option-map/src/option-maps.ts:19`）。
   */
  send(text: string, onDelta?: (delta: string) => void, selection?: string | AgentHostModelSelection): Promise<{ message: AgentChatMessage; results: AgentToolResult[] }>
  cancel(): void
  /** 批准一条工具调用并立即执行它。 */
  approve(callId: number): Promise<AgentToolResult | null>
  /** 拒绝一条工具调用。 */
  reject(callId: number): Promise<boolean>
  /** 待决改动（含摘要）。 */
  pendingEdits(): AgentEditSummary[]
  /** 全部改动（含已决的）。 */
  allEdits(): AgentEditSummary[]
  /** Do：保留这一条。 */
  doEdit(id: number): Promise<AgentEditOutcome>
  /** Undo：撤回这一条（已落盘且盘上被外部改过时拒绝，不覆盖用户改动）。 */
  undoEdit(id: number): Promise<AgentEditOutcome>
  /** Do All：保留全部待决。 */
  doAllEdits(): Promise<{ applied: number; failed: Array<{ id: number; reason: string }> }>
  /** 点对话里的一条改动：在编辑器里打开它的红绿差异。 */
  revealEdit(id: number): boolean
  /** 点对话里的一个文件引用：左侧编辑器打开并定位。 */
  revealFile(path: string, line: number | null): void
  /** 上下文用量（AG-03）：当前会话引用过的文件在本轮预算里占多少（读内容要走桥）。 */
  contextUsage(): Promise<{ files: Array<{ path: string; chars: number; truncated: boolean }>; usedChars: number; budgetChars: number; overBudget: boolean }>
  /** 头部状态行文案。 */
  statusLine(): string
}

/**
 * 工作区边界守卫：相对路径、不许往上跳、不许绝对路径。
 *
 * 这是「自动读取当前项目」这条要求的**安全那一半** —— 自动读到的是当前项目，
 * 不是"随便哪个路径"。校验在纯字符串层面做（不碰磁盘），所以能单测。
 */
export function assertInsideWorkspace(path: string): string | null {
  const trimmed = path.trim()
  if (!trimmed) return '空路径'
  if (trimmed.startsWith('/') || trimmed.startsWith('\\')) return '绝对路径不在工作区内'
  if (/^[A-Za-z]:[\\/]/.test(trimmed)) return '绝对路径不在工作区内'
  const normalized = trimmed.replace(/\\/g, '/')
  if (normalized.split('/').includes('..')) return '路径不许跳出工作区'
  return null
}

/** 写文件调用的 `after` 内容；兼容历史调用里的 `append` 参数。 */
export function applyWriteParams(before: string, params: Record<string, unknown>): string | null {
  const append = params.append
  if (typeof append === 'string') return before + append
  const content = params.content
  if (typeof content === 'string') return content
  return null
}

const AGENT_DEFAULT_MAX_OUTPUT_TOKENS = 32_000

const AGENT_MODEL_TOOLS = [
  {
    name: 'Read',
    description: 'Reads a text file from the local filesystem. file_path must be an absolute path. Reads up to 2,000 lines by default. offset is the line number to start reading from and limit is a line count. Results include line numbers.',
    input_schema: {
      type: 'object',
      properties: {
        file_path: { type: 'string', description: 'The absolute path to the file to read' },
        offset: { type: 'integer', minimum: 0, maximum: Number.MAX_SAFE_INTEGER, description: 'The line number to start reading from' },
        limit: { type: 'integer', minimum: 1, maximum: Number.MAX_SAFE_INTEGER, description: 'The number of lines to read' },
      },
      required: ['file_path'],
    },
  },
  {
    name: 'Write',
    description: 'Writes a file to the local filesystem, overwriting if one exists. When replacing an existing file, Read it first. For partial changes, use Edit instead.',
    input_schema: {
      type: 'object',
      properties: {
        file_path: { type: 'string', description: 'The absolute path to the file to write' },
        content: { type: 'string', description: 'The content to write to the file' },
      },
      required: ['file_path', 'content'],
    },
  },
  {
    name: 'Edit',
    description: 'Performs exact string replacement in a file. Read the file first. old_string must match exactly and be unique unless replace_all is true.',
    input_schema: {
      type: 'object',
      properties: {
        file_path: { type: 'string', description: 'The absolute path to the file to modify' },
        old_string: { type: 'string', description: 'The text to replace' },
        new_string: { type: 'string', description: 'The replacement text' },
        replace_all: { type: 'boolean', default: false, description: 'Replace every occurrence of old_string' },
      },
      required: ['file_path', 'old_string', 'new_string'],
    },
  },
] as const

type AgentModelApiFormat = ReturnType<typeof fromAgentModelProvider>['apiFormat']

function modelMessagesForProvider(apiFormat: AgentModelApiFormat, messages: readonly AgentModelMessage[]): unknown[] {
  if (apiFormat === 'anthropic-messages') {
    const output: Array<{ role: 'user' | 'assistant'; content: string | Array<Record<string, unknown>> }> = []
    for (const message of messages) {
      if (message.role === 'tool') {
        const contentBlock: Record<string, unknown> = {
          type: 'tool_result', tool_use_id: message.toolCallId, content: message.content,
          ...(message.isError ? { is_error: true } : {}),
        }
        const previous = output[output.length - 1]
        if (previous?.role === 'user' && Array.isArray(previous.content)) previous.content.push(contentBlock)
        else output.push({ role: 'user', content: [contentBlock] })
        continue
      }
      if (message.role === 'assistant' && message.toolCalls?.length) {
        const content: Array<Record<string, unknown>> = []
        if (message.content) content.push({ type: 'text', text: message.content })
        for (const call of message.toolCalls) content.push({ type: 'tool_use', id: call.id, name: call.name, input: call.input })
        output.push({ role: 'assistant', content })
        continue
      }
      if (message.role === 'system') continue
      output.push({ role: message.role, content: message.content })
    }
    return output
  }

  if (apiFormat === 'openai-chat-completions') {
    return messages.map(message => {
      if (message.role === 'assistant' && message.toolCalls?.length) {
        return {
          role: 'assistant', content: message.content || null,
          tool_calls: message.toolCalls.map(call => ({
            id: call.id, type: 'function', function: { name: call.name, arguments: JSON.stringify(call.input) },
          })),
        }
      }
      if (message.role === 'tool') return { role: 'tool', tool_call_id: message.toolCallId, content: message.content }
      return { role: message.role, content: message.content }
    })
  }

  const output: Array<Record<string, unknown>> = []
  for (const message of messages) {
    if (message.role === 'tool') {
      output.push({ type: 'function_call_output', call_id: message.toolCallId, output: message.content })
      continue
    }
    if (message.content) {
      output.push({
        type: 'message', role: message.role,
        content: [{ type: message.role === 'assistant' ? 'output_text' : 'input_text', text: message.content }],
      })
    }
    if (message.role === 'assistant') {
      for (const call of message.toolCalls ?? []) {
        output.push({ type: 'function_call', call_id: call.id, name: call.name, arguments: JSON.stringify(call.input) })
      }
    }
  }
  return output
}

/** 模型记录里声明的推理档位表（ZCode `optionSpecs.reasoningLevel.values`，`provider/src/config/model-config.ts:249`）。 */
function modelReasoningLevels(model: unknown): readonly string[] | undefined {
  if (!model || typeof model !== 'object') return undefined
  const levels = (model as { reasoningLevels?: unknown }).reasoningLevels
  if (!Array.isArray(levels)) return undefined
  const clean = levels.filter((level): level is string => typeof level === 'string' && level.trim() !== '')
  return clean.length ? clean : undefined
}

/** 模型记录里声明的推理映射（CEL 源；本仓落点是 `agentModelProviders.ts` 的 `reasoningLevelMap`）。 */
function modelReasoningLevelMap(model: unknown): string | undefined {
  if (!model || typeof model !== 'object') return undefined
  const source = (model as { reasoningLevelMap?: unknown }).reasoningLevelMap
  return typeof source === 'string' && source.trim() ? source.trim() : undefined
}

/**
 * 把冻结的档位翻成要并进请求体的 JSON 补丁 —— 即 ZCode 的 `optionSpecs.reasoningLevel.map`
 * 在请求期的求值结果（`model-option-map/src/option-maps.ts:20-33` 的 `apply`；写入哪些字段
 * 由映射自己决定，例如 `{"thinking": {"budget_tokens": 8192}}`）。
 *
 * 三种情况返回 undefined（调用方据此**原样保留请求体**，零行为变化）：
 *   · 没有档位（模型没声明推理配置 / 用户没选）；
 *   · 档位不在模型声明的档位表里 —— ZCode 对失效档位只保留模型身份、等用户重选，绝不静默补一个
 *     （`provider/src/model-selection-config.ts:74-97` `normalizeModelSelection`）；
 *   · 模型没有映射 —— 没有映射就没有字段落点，不猜。
 *
 * 映射编译不过则如实报错：上游在存配置时就用同一个编译器挡住坏映射
 * （`shared/src/model-config.ts:5-16`），并明确拒绝"静默丢掉 option 照发请求"
 * （`adapters/src/model/model-option-map-fetch.ts:38-42`）。
 */
function resolveReasoningLevelPatch(model: unknown, reasoningLevel: string | undefined): JsonObject | undefined {
  const level = reasoningLevel?.trim()
  if (!level) return undefined
  if (!modelReasoningLevels(model)?.includes(level)) return undefined
  const source = modelReasoningLevelMap(model)
  if (!source) return undefined
  try {
    return compileModelOptionMap(source, 'reasoningLevel').evaluate(level)
  } catch (error) {
    throw new Error(`所选模型的推理映射无效：${error instanceof Error ? error.message : String(error)}`)
  }
}

function prepareModelRequest(
  settings: AgentSettingsState,
  messages: readonly AgentModelMessage[],
  workspaceRoot: string,
  mcpTools: readonly AgentMcpToolDescriptor[] = [],
  reasoningLevel?: string,
): { request: AgentModelHttpRequest; apiFormat: AgentModelApiFormat } {
  const selection = decodeCustomModelValue(settings.model)
  if (!selection?.modelName) throw new Error('请先选择已配置的模型。')
  const provider = settings.providers.find(candidate => candidate.id === selection.providerId)
  const model = provider?.models.find(candidate => candidate.id === selection.modelName && candidate.enabled)
  if (!provider || !model) throw new Error('所选模型没有可用的供应商配置。')

  const configured = fromAgentModelProvider(provider)
  if (!provider.baseUrl.trim()) throw new Error('所选供应商缺少 Base URL。')
  if (!provider.apiKey.trim()) throw new Error('所选供应商缺少 API Key。')

  let url: URL
  try {
    url = new URL(provider.baseUrl.trim())
  } catch {
    throw new Error('所选供应商 Base URL 无效。')
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') throw new Error('所选供应商只支持 HTTP 或 HTTPS。')
  const basePath = url.pathname.replace(/\/+$/u, '')
  const apiPath = AGENT_PROVIDER_API_FORMAT_PATHS[configured.apiFormat]
  url.pathname = `${basePath}${basePath.toLowerCase().endsWith('/v1') ? apiPath.replace(/^\/v1/u, '') : apiPath}`

  const headers: Record<string, string> = { 'content-type': 'application/json' }
  if (configured.apiFormat === 'anthropic-messages') {
    headers['anthropic-version'] = '2023-06-01'
    headers['x-api-key'] = provider.apiKey
    headers.authorization = `Bearer ${provider.apiKey}`
  } else {
    headers.authorization = `Bearer ${provider.apiKey}`
  }
  const system = `Workspace root: ${workspaceRoot}`
  const systemMessages: AgentModelMessage[] = [{ role: 'system', content: system }, ...messages]
  const availableTools = [
    ...AGENT_MODEL_TOOLS.map(({ name, description, input_schema }) => ({ name, description, input_schema })),
    ...mcpTools.map(({ name, description, inputSchema }) => ({ name, description, input_schema: inputSchema })),
  ]
  const modelTools = configured.apiFormat === 'anthropic-messages'
    ? availableTools
    : configured.apiFormat === 'openai-chat-completions'
      ? availableTools.map(({ name, description, input_schema }) => ({
        type: 'function', function: { name, description, parameters: input_schema },
      }))
      : availableTools.map(({ name, description, input_schema }) => ({
        type: 'function', name, description, parameters: input_schema,
      }))
  const builtBody = configured.apiFormat === 'anthropic-messages'
    ? { model: model.id, max_tokens: AGENT_DEFAULT_MAX_OUTPUT_TOKENS, system, messages: modelMessagesForProvider(configured.apiFormat, messages), tools: modelTools, tool_choice: { type: 'auto' }, stream: true }
    : configured.apiFormat === 'openai-chat-completions'
      ? { model: model.id, max_tokens: AGENT_DEFAULT_MAX_OUTPUT_TOKENS, messages: modelMessagesForProvider(configured.apiFormat, systemMessages), tools: modelTools, tool_choice: 'auto', stream: true }
      : { model: model.id, max_output_tokens: AGENT_DEFAULT_MAX_OUTPUT_TOKENS, input: modelMessagesForProvider(configured.apiFormat, systemMessages), tools: modelTools, tool_choice: 'auto', stream: true }

  // 冻结的推理档位 → 请求体 JSON 补丁，走的是同一条 JSON 请求路径（`agentHostWire.ts` 的
  // `modelRequest` 把它原样交给 `requestStream`）。patch 为 undefined 时**一个字段都不动**，
  // 请求体与接通前逐字段一致。body 里带 provider 形状的未知值（messages/tools），
  // 这里按 ZCode 的 JSON patch 口径把它当 JSON 对象处理（上游同样是读请求体 JSON 再打补丁）。
  const reasoningPatch = resolveReasoningLevelPatch(model, reasoningLevel)
  const outgoingBody = reasoningPatch
    ? applyOrderedJsonMergePatches(builtBody as unknown as JsonObject, [{ option: 'reasoningLevel', patch: reasoningPatch }])
    : builtBody

  return {
    apiFormat: configured.apiFormat,
    request: {
      url: url.href,
      headers,
      body: JSON.stringify(outgoingBody),
    },
  }
}

interface AgentProviderToolCall {
  providerCallId: string
  name: string
  input: Record<string, unknown>
}

function createModelStreamDecoder(apiFormat: AgentModelApiFormat, onDelta?: (delta: string) => void) {
  const decoder = new TextDecoder()
  let buffer = ''
  let text = ''
  const toolCalls = new Map<string, { providerCallId: string; name: string; arguments: string; initialInput?: Record<string, unknown> }>()
  const ensureToolCall = (key: string, providerCallId: unknown, name: unknown) => {
    let call = toolCalls.get(key)
    if (!call) {
      call = {
        providerCallId: typeof providerCallId === 'string' ? providerCallId : key,
        name: typeof name === 'string' ? name : '',
        arguments: '',
      }
      toolCalls.set(key, call)
    } else {
      if (typeof providerCallId === 'string') call.providerCallId = providerCallId
      if (typeof name === 'string' && !call.name) call.name = name
    }
    return call
  }
  const consumeLine = (line: string) => {
    if (!line.startsWith('data:')) return
    const data = line.slice(5).trimStart()
    if (!data || data === '[DONE]') return
    let payload: unknown
    try { payload = JSON.parse(data) } catch { return }
    if (!payload || typeof payload !== 'object') return
    const event = payload as Record<string, unknown>
    let delta = ''
    if (apiFormat === 'anthropic-messages') {
      const part = event.delta && typeof event.delta === 'object' ? event.delta as Record<string, unknown> : {}
      if (event.type === 'content_block_delta' && part.type === 'text_delta' && typeof part.text === 'string') delta = part.text
      if (event.type === 'content_block_start' && event.content_block && typeof event.content_block === 'object') {
        const block = event.content_block as Record<string, unknown>
        if (block.type === 'tool_use' && typeof event.index === 'number') {
          const call = ensureToolCall(`anthropic:${event.index}`, block.id, block.name)
          if (block.input && typeof block.input === 'object' && !Array.isArray(block.input)) call.initialInput = block.input as Record<string, unknown>
        }
      }
      if (event.type === 'content_block_delta' && part.type === 'input_json_delta' && typeof part.partial_json === 'string' && typeof event.index === 'number') {
        ensureToolCall(`anthropic:${event.index}`, undefined, undefined).arguments += part.partial_json
      }
    } else if (apiFormat === 'openai-chat-completions') {
      const choices = Array.isArray(event.choices) ? event.choices : []
      const first = choices[0] && typeof choices[0] === 'object' ? choices[0] as Record<string, unknown> : {}
      const change = first.delta && typeof first.delta === 'object' ? first.delta as Record<string, unknown> : {}
      if (typeof change.content === 'string') delta = change.content
      else if (Array.isArray(change.content)) delta = change.content
        .filter((part): part is { type?: unknown; text?: unknown } => Boolean(part) && typeof part === 'object')
        .filter(part => part.type === 'text' && typeof part.text === 'string')
        .map(part => part.text as string).join('')
      if (Array.isArray(change.tool_calls)) {
        for (const value of change.tool_calls) {
          if (!value || typeof value !== 'object') continue
          const toolCall = value as Record<string, unknown>
          const index = typeof toolCall.index === 'number' ? toolCall.index : toolCalls.size
          const fn = toolCall.function && typeof toolCall.function === 'object' ? toolCall.function as Record<string, unknown> : {}
          const call = ensureToolCall(`chat:${index}`, toolCall.id, undefined)
          if (typeof fn.name === 'string') call.name += fn.name
          if (typeof fn.arguments === 'string') call.arguments += fn.arguments
        }
      }
    } else if (event.type === 'response.output_text.delta' && typeof event.delta === 'string') {
      delta = event.delta
    } else if (apiFormat === 'openai-responses') {
      if (event.type === 'response.output_item.added' || event.type === 'response.output_item.done') {
        const item = event.item && typeof event.item === 'object' ? event.item as Record<string, unknown> : {}
        if (item.type === 'function_call') {
          const key = typeof item.id === 'string' ? item.id : typeof item.call_id === 'string' ? item.call_id : `response:${toolCalls.size}`
          const call = ensureToolCall(key, item.call_id ?? item.id, item.name)
          if (typeof item.arguments === 'string') call.arguments = item.arguments
        }
      }
      if (event.type === 'response.function_call_arguments.delta' && typeof event.item_id === 'string' && typeof event.delta === 'string') {
        ensureToolCall(event.item_id, undefined, undefined).arguments += event.delta
      }
      if (event.type === 'response.function_call_arguments.done' && typeof event.item_id === 'string' && typeof event.arguments === 'string') {
        ensureToolCall(event.item_id, undefined, undefined).arguments = event.arguments
      }
    }
    if (delta) { text += delta; onDelta?.(delta) }
  }
  const consume = (chunk: string) => {
    buffer += chunk
    const lines = buffer.split(/\r?\n/u)
    buffer = lines.pop() ?? ''
    for (const line of lines) consumeLine(line)
  }
  const parsedToolCalls = (): AgentProviderToolCall[] => [...toolCalls.values()].map(call => {
    let input = call.initialInput ?? {}
    if (call.arguments) {
      try {
        const parsed: unknown = JSON.parse(call.arguments)
        if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) input = parsed as Record<string, unknown>
      } catch { input = {} }
    }
    return { providerCallId: call.providerCallId, name: call.name, input }
  })
  return {
    push(bytes: Uint8Array) { consume(decoder.decode(bytes, { stream: true })) },
    finish() {
      consume(decoder.decode())
      if (buffer) consumeLine(buffer)
      buffer = ''
    },
    text: () => text,
    toolCalls: parsedToolCalls,
  }
}

function modelResponseText(response: AgentModelHttpResponse, apiFormat: AgentModelApiFormat): string {
  if (!response.available) throw new Error(response.reason || '模型请求不可用。')
  if (typeof response.status !== 'number' || response.status < 200 || response.status >= 300) {
    throw new Error(`模型请求失败（HTTP ${response.status ?? '未知'}）。`)
  }
  let payload: unknown
  try {
    payload = JSON.parse(response.content ?? '')
  } catch {
    throw new Error('模型响应不是有效的 JSON。')
  }
  if (!payload || typeof payload !== 'object') throw new Error('模型响应中没有文本内容。')
  const data = payload as Record<string, unknown>
  const text = apiFormat === 'anthropic-messages'
    ? (Array.isArray(data.content) ? data.content : [])
      .filter((block): block is { type?: unknown; text?: unknown } => Boolean(block) && typeof block === 'object')
      .filter(block => block.type === 'text' && typeof block.text === 'string')
      .map(block => block.text as string)
      .join('')
    : apiFormat === 'openai-chat-completions'
      ? (() => {
          const choices = Array.isArray(data.choices) ? data.choices : []
          const first = choices[0] && typeof choices[0] === 'object' ? choices[0] as Record<string, unknown> : {}
          const message = first.message && typeof first.message === 'object' ? first.message as Record<string, unknown> : {}
          return typeof message.content === 'string' ? message.content : ''
        })()
      : (() => {
          if (typeof data.output_text === 'string') return data.output_text
          const output = Array.isArray(data.output) ? data.output : []
          return output.flatMap(item => {
            if (!item || typeof item !== 'object') return []
            const message = item as Record<string, unknown>
            if (message.type !== 'message' || !Array.isArray(message.content)) return []
            return message.content
              .filter((block): block is { type?: unknown; text?: unknown } => Boolean(block) && typeof block === 'object')
              .filter(block => block.type === 'output_text' && typeof block.text === 'string')
              .map(block => block.text as string)
          }).join('')
        })()
  if (!text) throw new Error('模型响应中没有文本内容。')
  return text
}

function workspaceRelativePath(workspaceRoot: string, inputPath: unknown): string {
  if (typeof inputPath !== 'string') return ''
  const path = inputPath.trim()
  const root = workspaceRoot.replace(/\\/gu, '/').replace(/\/+$/u, '')
  const normalized = path.replace(/\\/gu, '/')
  const windowsPath = /^[A-Za-z]:\//u.test(root)
  const rootPrefix = windowsPath ? root.toLowerCase() : root
  const candidate = windowsPath ? normalized.toLowerCase() : normalized
  if (candidate === rootPrefix) return ''
  if (candidate.startsWith(`${rootPrefix}/`)) return normalized.slice(root.length + 1)
  return path
}

function mapProviderToolCall(
  call: AgentProviderToolCall,
  workspaceRoot: string,
  mcpTools: readonly AgentMcpToolDescriptor[] = [],
): AgentModelToolInvocation {
  const mcpTool = mcpTools.find(tool => tool.name === call.name)
  if (mcpTool) {
    return {
      providerCallId: call.providerCallId,
      name: call.name,
      input: call.input,
      tool: 'mcp_call',
      params: { serverId: mcpTool.serverId, toolName: mcpTool.toolName, arguments: call.input },
    }
  }
  const path = workspaceRelativePath(workspaceRoot, call.input.file_path)
  if (call.name === 'Read') {
    return {
      providerCallId: call.providerCallId, name: call.name, input: call.input, tool: 'read_file',
      params: {
        path,
        ...(call.input.offset !== undefined ? { offset: call.input.offset } : {}),
        ...(call.input.limit !== undefined ? { limit: call.input.limit } : {}),
      },
    }
  }
  if (call.name === 'Write') {
    return {
      providerCallId: call.providerCallId, name: call.name, input: call.input, tool: 'write_file',
      params: { path, content: call.input.content },
    }
  }
  if (call.name === 'Edit') {
    return {
      providerCallId: call.providerCallId, name: call.name, input: call.input, tool: 'write_file',
      params: {
        path, old_string: call.input.old_string, new_string: call.input.new_string,
        replace_all: call.input.replace_all === true,
      },
    }
  }
  throw new Error(`所选模型返回了未提供的工具调用：${call.name || 'unknown'}`)
}

function readToolContent(content: string, params: Record<string, unknown>): string {
  const lines = content === '' ? [] : content.split(/\r?\n/u)
  if (content.endsWith('\n') || content.endsWith('\r')) lines.pop()
  const requestedOffset = typeof params.offset === 'number' && Number.isInteger(params.offset) && params.offset >= 0
    ? params.offset : undefined
  const offset = requestedOffset === undefined || requestedOffset <= 1 ? 0 : requestedOffset - 1
  const limit = typeof params.limit === 'number' && Number.isInteger(params.limit) && params.limit > 0
    ? params.limit : 2_000
  const selected = lines.slice(offset, offset + limit)
  const startLine = requestedOffset === 0 ? 0 : offset + 1
  if (lines.length === 0 && offset === 0) {
    return '<system-reminder>Warning: the file exists but the contents are empty.</system-reminder>'
  }
  if (!selected.length) return `<system-reminder>Warning: the file exists but is shorter than the provided offset (${startLine}). The file has ${lines.length} lines.</system-reminder>`
  return selected.map((line, index) => `${startLine + index}\t${line}`).join('\n')
}

function applyEditParams(before: string, params: Record<string, unknown>): { content?: string; error?: string } {
  const oldString = params.old_string
  const newString = params.new_string
  const replaceAll = params.replace_all === true
  if (typeof oldString !== 'string' || typeof newString !== 'string') return { error: 'Edit requires old_string and new_string.' }
  if (oldString === newString) return { error: 'No changes to make: old_string and new_string are exactly the same.' }
  const newline = before.includes('\r\n') ? '\r\n' : '\n'
  const source = before.replace(/\r\n/gu, '\n')
  const search = oldString.replace(/\r\n/gu, '\n')
  const replacement = newString.replace(/\r\n/gu, '\n')
  if (!search) {
    if (source.trim()) return { error: 'Cannot create new file - file already exists.' }
    return { content: replacement.replace(/\n/gu, newline) }
  }
  let count = 0
  let cursor = 0
  while ((cursor = source.indexOf(search, cursor)) >= 0) { count++; cursor += search.length }
  if (count === 0) return { error: 'String to replace not found in file.' }
  if (!replaceAll && count > 1) return { error: 'old_string is not unique in the file. Provide more surrounding context or set replace_all to true.' }
  const updated = replaceAll ? source.split(search).join(replacement) : source.replace(search, replacement)
  return { content: updated.replace(/\n/gu, newline) }
}

function stringifyMcpValue(value: unknown): string {
  try { return JSON.stringify(value, null, 2) ?? '' } catch { return String(value) }
}

function informativeStructuredContent(value: unknown): boolean {
  if (value === null || value === undefined) return false
  if (Array.isArray(value)) return value.length > 0
  if (typeof value === 'object') return Object.keys(value).length > 0
  return true
}

function formatMcpToolResult(output: AgentMcpToolCallResult): string {
  const blocks = output.content.flatMap(block => {
    if (block.type === 'text' && typeof block.text === 'string') return block.text ? [block.text] : []
    if (block.type === 'image') return [`[MCP image content omitted: ${typeof block.mimeType === 'string' ? block.mimeType : 'unknown'}]`]
    if (block.type === 'audio') return [`[MCP audio content omitted: ${typeof block.mimeType === 'string' ? block.mimeType : 'unknown'}]`]
    if (block.type === 'resource') return [`MCP resource content:\n${stringifyMcpValue(block.resource ?? block)}`]
    return [stringifyMcpValue(block)]
  })
  if (informativeStructuredContent(output.structuredContent)) {
    blocks.push(`Structured content:\n${stringifyMcpValue(output.structuredContent)}`)
  }
  const content = blocks.length ? blocks.join('\n\n') : stringifyMcpValue(output)
  return output.isError ? `MCP tool returned an error:\n${content}` : content
}

/** 把台账的失败原因翻成给用户看的一句话（面板与状态行共用一份措辞）。 */
export function describeEditFailure(outcome: Extract<AgentEditOutcome, { ok: false }>): string {
  switch (outcome.reason) {
    case 'missing': return '文件已不存在'
    case 'writeFailed': return '写入失败'
    case 'wrongState': return '这条改动已经决定过了'
    case 'conflict': return '文件已被你或其他程序改过，撤回会覆盖那些改动，因此没有执行'
  }
}

/**
 * 一轮对话里**冻结的请求快照**：设置快照 + 会话选择里的档位。
 * 初次请求、工具续发、批准后的续发都读这一份，半路改设置/改选择不影响本轮。
 */
interface FrozenRequestContext {
  /** 设置快照（含本轮生效的模型值）：`cloneSettings` 的深拷贝，不再随面板改动。 */
  settings: AgentSettingsState
  /** 冻结的档位（没有 = 请求体不经推理映射）。 */
  reasoningLevel?: string
}

/**
 * 把面板传来的会话选择冻成这一轮要用的最小字段。
 * 传字符串 = 旧口径（只覆盖模型值、没有档位）；传对象 = 会话库里存的那份选择，缺字段当成"没有"。
 * 全程可选链读取：旧调用方与并行迁移中的形状都能编译。
 */
function freezeModelSelection(
  selection: string | AgentHostModelSelection | undefined,
): { model?: string; reasoningLevel?: string } {
  if (typeof selection === 'string') return { model: selection }
  const level = selection?.options?.reasoningLevel
  return {
    ...(typeof selection?.model === 'string' ? { model: selection.model } : {}),
    ...(typeof level === 'string' && level.trim() ? { reasoningLevel: level.trim() } : {}),
  }
}

export function createAgentHost(options: AgentHostOptions): AgentHost {
  const { bridge } = options
  let settings = options.settings
  // 台账的文件能力走 IDE 的读写；写返回 false 时台账会保持"待决"（不谎报成功）。
  const ledger = createAgentEditLedger({
    read: path => bridge.readFile(path),
    write: (path, content) => bridge.writeFile(path, content),
  })
  const session = createAgentSession({
    permissions: settings.permissions,
    ...(options.now ? { now: options.now } : {}),
  } satisfies AgentSessionOptions)
  let activeModelController: AbortController | null = null
  let pendingContinuation: { messageId: number; context: FrozenRequestContext } | null = null
  const settingsChangeListeners = new Set<() => void>()
  const notifySettingsChange = () => {
    for (const listener of settingsChangeListeners) listener()
  }

  const cloneSettings = (): AgentSettingsState => ({
    ...settings,
    providers: settings.providers.map(provider => ({
      ...provider, models: provider.models.map(model => ({ ...model })),
    })),
  })

  const requestModel = async (
    context: FrozenRequestContext,
    messages: readonly AgentModelMessage[],
    signal: AbortSignal,
    onDelta?: (delta: string) => void,
  ): Promise<AgentModelReply> => {
    const requestMessages = [...messages]
    if (bridge.buildSkillPromptContext) {
      for (let index = requestMessages.length - 1; index >= 0; index -= 1) {
        const message = requestMessages[index]
        if (message.role !== 'user') continue
        const prompt = await bridge.buildSkillPromptContext(message.content)
        requestMessages[index] = { ...message, content: prompt }
        break
      }
    }
    const mcpTools = bridge.mcpRuntimeSnapshot ? (await bridge.mcpRuntimeSnapshot()).tools : []
    const plan = prepareModelRequest(context.settings, requestMessages, bridge.workspaceRoot(), mcpTools, context.reasoningLevel)
    const stream = createModelStreamDecoder(plan.apiFormat, onDelta)
    const response = await bridge.modelRequest(plan.request, stream.push, signal)
    stream.finish()
    if (!response.available || typeof response.status !== 'number' || response.status < 200 || response.status >= 300) {
      modelResponseText(response, plan.apiFormat)
    }
    const toolCalls = stream.toolCalls().map(call => mapProviderToolCall(call, bridge.workspaceRoot(), mcpTools))
    const text = stream.text()
    if (!text && !toolCalls.length) throw new Error('模型响应中没有文本或工具调用。')
    return { text, ...(toolCalls.length ? { toolCalls } : {}) }
  }

  /** 执行一条**已获准**的工具调用。读/写都要过宿主的文件桥（Promise），整条异步。 */
  const execute = async (call: AgentToolCall): Promise<AgentToolResult> => {
    if (call.tool === 'mcp_call') {
      if (!bridge.callMcpTool) return { call, ok: false, detail: 'MCP tool runtime is unavailable.' }
      try {
        const toolName = String(call.params.toolName ?? '')
        const result = await bridge.callMcpTool(
          String(call.params.serverId ?? ''),
          toolName,
          call.params.arguments && typeof call.params.arguments === 'object' && !Array.isArray(call.params.arguments)
            ? call.params.arguments as Record<string, unknown> : {},
        )
        const modelContent = formatMcpToolResult(result)
        return { call, ok: result.isError !== true, detail: toolName, modelContent }
      } catch (error) {
        const detail = error instanceof Error ? error.message : String(error)
        return { call, ok: false, detail, modelContent: detail }
      }
    }
    const path = String(call.params.path ?? '')
    const boundary = assertInsideWorkspace(path)
    if (boundary) return { call, ok: false, detail: `拒绝：${boundary}` }
    if (call.tool === 'read_file') {
      const content = await bridge.readFile(path)
      if (content === null) return { call, ok: false, detail: '读不到这个文件' }
      if (call.params.offset !== undefined && (typeof call.params.offset !== 'number' || !Number.isInteger(call.params.offset) || call.params.offset < 0)) {
        return { call, ok: false, detail: 'Read offset must be a nonnegative integer.' }
      }
      if (call.params.limit !== undefined && (typeof call.params.limit !== 'number' || !Number.isInteger(call.params.limit) || call.params.limit <= 0)) {
        return { call, ok: false, detail: 'Read limit must be a positive integer.' }
      }
      const modelContent = readToolContent(content, call.params)
      return { call, ok: true, detail: `已读 ${path}（${content.length} 字符）`, modelContent }
    }
    if (call.tool !== 'write_file') return { call, ok: false, detail: `未提供工具执行器：${call.tool}` }
    const before = await bridge.readFile(path)
    if (before !== null && !session.hasSuccessfulRead(path)) {
      return { call, ok: false, detail: 'Read the file before writing to it.', modelContent: 'File has not been read yet. Read it first before writing to it.' }
    }
    const original = before ?? ''
    const isEdit = typeof call.params.old_string === 'string' || typeof call.params.new_string === 'string'
    const edited = isEdit ? applyEditParams(original, call.params) : null
    if (edited?.error) return { call, ok: false, detail: edited.error, modelContent: edited.error }
    const after = isEdit ? edited?.content ?? null : applyWriteParams(original, call.params)
    if (after === null) return { call, ok: false, detail: 'Write requires content.' , modelContent: 'Write requires content.' }
    const editId = ledger.record({ path, before: original, after, turn: session.turns() })
    const summary = ledger.summarize().find(entry => entry.id === editId)!
    const policy = editPolicyOf(settings)
    // 「写盘前等不等用户按 Do」由设置决定；两种情况下台账里都有这条改动，
    // 所以即使自动落盘，用户仍能在列表里看到它并 Undo。
    if (policy.requireApprovalForWrites) {
      const detail = `待决：${path}（+${summary.added} −${summary.removed}）`
      return { call, ok: true, detail, modelContent: detail, editId }
    }
    // 自动落盘这一档：写没成功就要如实说，不能报成"已保留"（写失败时它仍是待决）。
    const outcome = await ledger.do(editId)
    const detail = outcome.ok
      ? `已保留：${path}（+${summary.added} −${summary.removed}）`
      : `写盘失败，仍待决：${path}（${describeEditFailure(outcome)}）`
    return { call, ok: outcome.ok, detail, modelContent: detail, editId }
  }

  /** 跑完一批已放行的调用，并把结果接回模型历史。 */
  const runApproved = async (calls: readonly AgentToolCall[]): Promise<AgentToolResult[]> => {
    const results: AgentToolResult[] = []
    for (const call of calls) {
      const result = await execute(call)
      session.recordToolResult(call.id, result.modelContent ?? result.detail, !result.ok)
      results.push(result)
    }
    for (const result of results) {
      if (result.editId === undefined) continue
      if (!editPolicyOf(settings).autoOpenDiff) continue
      const edit = ledger.get(result.editId)
      if (edit) bridge.showDiff(edit.path, result.editId)
    }
    return results
  }

  const hasPendingApproval = (messageId: number): boolean => session.approvals().some(entry => entry.messageId === messageId)

  const continueModelTurn = async (
    message: AgentChatMessage,
    context: FrozenRequestContext,
    signal: AbortSignal,
    onDelta?: (delta: string) => void,
    results: AgentToolResult[] = [],
  ): Promise<{ message: AgentChatMessage; results: AgentToolResult[] }> => {
    let current = message
    while (current.modelToolCalls?.length) {
      const allowed = session.drainApprovedFor(current.id)
      results.push(...await runApproved(allowed))
      if (hasPendingApproval(current.id)) {
        // 卡在审批门上也要把这一轮的快照（含冻结档位）留下：批准后的续发不能再读一次面板。
        pendingContinuation = { messageId: current.id, context }
        return { message: current, results }
      }
      current = await session.continueWithModel(
        (messages, emitDelta) => requestModel(context, messages, signal, emitDelta),
        onDelta,
      )
    }
    pendingContinuation = null
    return { message: current, results }
  }

  const resumePendingContinuation = async (): Promise<void> => {
    const pending = pendingContinuation
    if (!pending || hasPendingApproval(pending.messageId) || activeModelController) return
    const message = session.messages().find(candidate => candidate.id === pending.messageId)
    if (!message) { pendingContinuation = null; return }
    const controller = new AbortController()
    activeModelController = controller
    try {
      await continueModelTurn(message, pending.context, controller.signal)
    } catch (error) {
      pendingContinuation = null
      bridge.notify?.(error instanceof Error ? error.message : String(error), true)
    } finally {
      if (activeModelController === controller) activeModelController = null
    }
  }

  return {
    session: () => session,
    ledger: () => ledger,
    settings: () => settings,
    onSettingsChange(listener) {
      settingsChangeListeners.add(listener)
      return () => { settingsChangeListeners.delete(listener) }
    },
    updateSettings(next) {
      settings = next
      session.setPermissions(next.permissions)
      notifySettingsChange()
    },
    segments: message => parseAgentMessage(message.text),
    async send(text, onDelta, selection) {
      if (activeModelController) throw new Error('模型请求仍在运行。')
      if (pendingContinuation) throw new Error('请先处理待批准的工具调用。')
      const controller = new AbortController()
      activeModelController = controller
      const submissionSettings = cloneSettings()
      const frozenSelection = freezeModelSelection(selection)
      if (frozenSelection.model !== undefined) submissionSettings.model = frozenSelection.model
      const context: FrozenRequestContext = {
        settings: submissionSettings,
        ...(frozenSelection.reasoningLevel !== undefined ? { reasoningLevel: frozenSelection.reasoningLevel } : {}),
      }
      try {
        const message = await session.sendWithModel(
          text,
          (messages, emitDelta) => requestModel(context, messages, controller.signal, emitDelta),
          onDelta,
        )
        return await continueModelTurn(message, context, controller.signal, onDelta)
      } finally {
        if (activeModelController === controller) activeModelController = null
      }
    },
    cancel() { activeModelController?.abort() },
    async approve(callId) {
      const pendingCall = session.approvals().find(entry => entry.call.id === callId)
      if (!pendingCall) return null
      if (!session.approve(pendingCall.messageId, callId)) return null
      const drained = session.drainApprovedFor(pendingCall.messageId).filter(call => call.id === callId)
      const result = (await runApproved(drained))[0] ?? null
      if (!hasPendingApproval(pendingCall.messageId)) await resumePendingContinuation()
      return result
    },
    async reject(callId) {
      const pendingCall = session.approvals().find(entry => entry.call.id === callId)
      if (!pendingCall) return false
      if (!session.reject(pendingCall.messageId, callId)) return false
      session.recordToolResult(callId, 'Tool call rejected by the user.', true)
      if (!hasPendingApproval(pendingCall.messageId)) await resumePendingContinuation()
      return true
    },
    pendingEdits: () => ledger.summarize().filter(entry => entry.state === 'pending'),
    allEdits: () => ledger.summarize(),
    async doEdit(id) {
      const outcome = await ledger.do(id)
      return outcome
    },
    async undoEdit(id) {
      const outcome = await ledger.undo(id)
      return outcome
    },
    async doAllEdits() {
      return ledger.doAll()
    },
    revealEdit(id) {
      const edit = ledger.get(id)
      if (!edit) return false
      bridge.showDiff(edit.path, id)
      bridge.openFile(edit.path, null)
      return true
    },
    revealFile(path, line) {
      const boundary = assertInsideWorkspace(path)
      if (boundary) return
      bridge.openFile(path, line)
    },
    async contextUsage() {
      // 上下文里的文件 = 整场对话引用过的那批（去重），读当前盘上内容算字符数。
      const referenced = new Map<string, number | null>()
      for (const message of session.messages()) {
        for (const file of collectReferencedFiles(message.text)) {
          if (!referenced.has(file.path)) referenced.set(file.path, file.line)
        }
      }
      const files: Array<{ path: string; content: string }> = []
      for (const path of referenced.keys()) {
        const content = await bridge.readFile(path)
        if (content !== null) files.push({ path, content })
      }
      return contextUsage(files, settings.contextBudgetChars)
    },
    statusLine() {
      const approvals = session.approvals().length
      const pending = ledger.summarize().filter(entry => entry.state === 'pending').length
      const parts: string[] = []
      if (approvals > 0) parts.push(`待批准 ${approvals}`)
      if (pending > 0) parts.push(`待决改动 ${pending}`)
      return parts.join(' · ')
    },
  }
}
