// Agent 的**模型协议整形层**：把本仓的会话消息编成各家供应商的请求体、把流式回包解成
// 文本增量与工具调用、把供应商的工具调用映射成本仓的工具调用、把工具参数回包整成模型与
// 用户看到的形状。它不认识 IDE（不碰文件系统、不碰界面、不持会话状态）—— 宿主装配在
// `src/agentHost.ts`，那里把这一族接到会话状态机、改动台账与面板能力上。
//
// 从 `src/agentHost.ts` 拆出（2026-10-08 lane pf-lifecycle：装配层涨到 996 行、撞上 src 的
// 900 行机检上限；按「协议整形 vs 宿主装配」拆职责，纯搬迁、语义零改动。`agentHost.ts` 里原样转出这一族，既有 import 路径不失效）。
import {
  fromAgentModelProvider,
  AGENT_MODEL_PROVIDER_MESSAGES,
  AGENT_PROVIDER_API_FORMAT_PATHS,
} from './agentModelProviders.ts'
import { applyOrderedJsonMergePatches, compileModelOptionMap, type JsonObject } from './agentModelOptionMap.ts'
import { adaptAgentToolInputSchema } from './agentModelToolSchema.ts'
import { decodeCustomModelValue } from './agentModelSelection.ts'
import type { AgentSettingsState } from './agentSettings.ts'
import type { AgentModelMessage, AgentModelToolInvocation } from './agentSession.ts'
import type { AgentMcpToolCallResult, AgentMcpToolDescriptor } from './agentMcpServers.ts'

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

const AGENT_DEFAULT_MAX_OUTPUT_TOKENS = 32_000
const AGENT_CONTEXT_OUTPUT_RESERVE_TOKENS = 1_000
const ESTIMATED_TOKEN_CHAR_DIVISOR = 3

/** ZCode `estimateMessageTokens`: estimate each message as ceil(content and tool-call chars / 3). */
function estimateModelInputTokens(messages: readonly AgentModelMessage[]): number {
  return messages.reduce((total, message) => {
    let characterCount = message.content.length
    for (const call of message.toolCalls ?? []) {
      let inputText = '{}'
      try {
        inputText = JSON.stringify(call.input ?? {}) ?? '{}'
      } catch {
        // Match ZCode's estimator fallback for an unserializable tool input.
      }
      characterCount += call.name.length + inputText.length
    }
    return total + Math.ceil(characterCount / ESTIMATED_TOKEN_CHAR_DIVISOR)
  }, 0)
}

/** ZCode `resolveModelStepMaxOutputTokens`, applied to every request including tool continuations. */
function resolveModelStepMaxOutputTokens(
  baselineMaxOutputTokens: number,
  contextWindow: unknown,
  estimatedCurrentUsage: number,
): number {
  if (
    typeof contextWindow !== 'number' ||
    !Number.isFinite(contextWindow) ||
    contextWindow <= 0 ||
    !Number.isFinite(estimatedCurrentUsage) ||
    estimatedCurrentUsage < 0
  ) {
    return baselineMaxOutputTokens
  }
  const estimatedAvailable = Math.floor(
    contextWindow - estimatedCurrentUsage - AGENT_CONTEXT_OUTPUT_RESERVE_TOKENS,
  )
  if (estimatedAvailable <= 0) return baselineMaxOutputTokens
  return Math.min(baselineMaxOutputTokens, estimatedAvailable)
}

/** 模型显式声明时使用其输出上限；32K 仅是没有模型上限时的默认值。 */
function modelMaxOutputTokens(model: unknown): number {
  if (!model || typeof model !== 'object') return AGENT_DEFAULT_MAX_OUTPUT_TOKENS
  const config = model as { maxOutputTokens?: unknown; maxOutputTokensMap?: unknown }
  const value = config.maxOutputTokens
  if (
    typeof config.maxOutputTokensMap === 'string' &&
    config.maxOutputTokensMap.trim() &&
    (typeof value !== 'number' || !Number.isInteger(value) || value <= 0)
  ) {
    throw new Error(AGENT_MODEL_PROVIDER_MESSAGES.invalidMaxOutputTokens)
  }
  return typeof value === 'number' && Number.isFinite(value) && value > 0
    ? Math.floor(value)
    : AGENT_DEFAULT_MAX_OUTPUT_TOKENS
}

/** Apply ZCode `optionSpecs.maxOutputTokens.map` to the provider request body. */
function resolveMaxOutputTokensPatch(model: unknown, maxOutputTokens: number): JsonObject | undefined {
  if (!model || typeof model !== 'object') return undefined
  const source = (model as { maxOutputTokensMap?: unknown }).maxOutputTokensMap
  if (typeof source !== 'string' || !source.trim()) return undefined
  return compileModelOptionMap(source, 'maxOutputTokens').evaluate(maxOutputTokens)
}

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

export function prepareModelRequest(
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
  ].map(tool => ({
    ...tool,
    input_schema: adaptAgentToolInputSchema(tool.input_schema, tool.name, model.requiresMfjsToolSchema === true),
  }))
  // 能力位只挡**显式**声明不支持的那种：`undefined` = 模型记录里没这一格（老存档、手写配置、
  // 或 provider 元数据本来就不带），按上游"能力位缺省即可用"的口径放行 —— `createEmptyAgentProviderModel()`
  // 的初值也是 `true`（`ProviderCardSections.tsx:338`）。写成 `!== true` 会把所有老记录的工具表
  // 一起关掉（23 条 agent-host 判据当场红，2026-10-08 实测）。
  if (availableTools.length > 0 && model.supportsToolCall === false) {
    throw new Error('Model does not support tool calls')
  }
  const modelTools = configured.apiFormat === 'anthropic-messages'
    ? availableTools
    : configured.apiFormat === 'openai-chat-completions'
      ? availableTools.map(({ name, description, input_schema }) => ({
        type: 'function', function: { name, description, parameters: input_schema },
      }))
      : availableTools.map(({ name, description, input_schema }) => ({
        type: 'function', name, description, parameters: input_schema,
      }))
  const maxOutputTokens = resolveModelStepMaxOutputTokens(
    modelMaxOutputTokens(model),
    model.contextWindow,
    estimateModelInputTokens(systemMessages),
  )
  const maxOutputTokensPatch = resolveMaxOutputTokensPatch(model, maxOutputTokens)
  const mappedOutputLimit = maxOutputTokensPatch ? {} : configured.apiFormat === 'openai-responses'
    ? { max_output_tokens: maxOutputTokens }
    : { max_tokens: maxOutputTokens }
  const builtBody = configured.apiFormat === 'anthropic-messages'
    ? { model: model.id, ...mappedOutputLimit, system, messages: modelMessagesForProvider(configured.apiFormat, messages), tools: modelTools, tool_choice: { type: 'auto' }, stream: true }
    : configured.apiFormat === 'openai-chat-completions'
      ? { model: model.id, ...mappedOutputLimit, messages: modelMessagesForProvider(configured.apiFormat, systemMessages), tools: modelTools, tool_choice: 'auto', stream: true }
      : { model: model.id, ...mappedOutputLimit, input: modelMessagesForProvider(configured.apiFormat, systemMessages), tools: modelTools, tool_choice: 'auto', stream: true }

  // 冻结的推理档位 → 请求体 JSON 补丁，走的是同一条 JSON 请求路径（`agentHostWire.ts` 的
  // `modelRequest` 把它原样交给 `requestStream`）。patch 为 undefined 时**一个字段都不动**，
  // 请求体与接通前逐字段一致。body 里带 provider 形状的未知值（messages/tools），
  // 这里按 ZCode 的 JSON patch 口径把它当 JSON 对象处理（上游同样是读请求体 JSON 再打补丁）。
  const reasoningPatch = resolveReasoningLevelPatch(model, reasoningLevel)
  const patches = [
    ...(reasoningPatch ? [{ option: 'reasoningLevel' as const, patch: reasoningPatch }] : []),
    ...(maxOutputTokensPatch ? [{ option: 'maxOutputTokens' as const, patch: maxOutputTokensPatch }] : []),
  ]
  const outgoingBody = patches.length
    ? applyOrderedJsonMergePatches(builtBody as unknown as JsonObject, patches)
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

export function createModelStreamDecoder(apiFormat: AgentModelApiFormat, onDelta?: (delta: string) => void) {
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

export function modelResponseText(response: AgentModelHttpResponse, apiFormat: AgentModelApiFormat): string {
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

export function mapProviderToolCall(
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

export function readToolContent(content: string, params: Record<string, unknown>): string {
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

export function applyEditParams(before: string, params: Record<string, unknown>): { content?: string; error?: string } {
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

export function formatMcpToolResult(output: AgentMcpToolCallResult): string {
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
