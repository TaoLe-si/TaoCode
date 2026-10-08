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
import { createAgentSession, type AgentChatMessage, type AgentModelMessage, type AgentModelReply, type AgentSession, type AgentSessionOptions } from './agentSession.ts'
import { editPolicyOf, type AgentSettingsState } from './agentSettings.ts'
import type { AgentMcpRuntimeSnapshot, AgentMcpToolCallResult } from './agentMcpServers.ts'

// 协议整形族（请求构造 / 流式解码 / 回参整形 / 工具调用映射 / 参数应用）在
// `src/agentHostProtocol.ts` —— 纯搬迁；下面 import 的是本文件要用的，转出的是不给既有
// import 路径添堵。
import { prepareModelRequest, createModelStreamDecoder, modelResponseText, mapProviderToolCall, readToolContent, applyEditParams, formatMcpToolResult, type AgentModelHttpRequest, type AgentModelHttpResponse } from './agentHostProtocol.ts'
export { prepareModelRequest, createModelStreamDecoder, modelResponseText, mapProviderToolCall, readToolContent, applyEditParams, formatMcpToolResult } from './agentHostProtocol.ts'
export type { AgentModelHttpRequest, AgentModelHttpResponse } from './agentHostProtocol.ts'

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
