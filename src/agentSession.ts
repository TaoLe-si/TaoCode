// Agent 对话的**会话状态**：消息流水线 + 计划 + 工具调用审批 + 上下文。
//
// 为什么单独一个模块：`AgentPanel.vue` 要能重绘任意时刻的对话，而「现在该显示什么」
// 是一条状态机（用户发问 → 模型回计划 → 工具调用卡在审批门 → 批准/拒绝 → 出改动）。
// 把状态机写进组件里，这些转移就只能靠点界面来验证；写在这里则每一步都能断言。
//
// 权限门**不在这里**：调 `src/agent.ts` 的 `decidePermission`（单一真源，MCP 服务端也读它）。
// 本模块只记住「哪一条工具调用卡在审批门」，以及用户最后怎么批的。
import {
  decidePermission, defaultAgentPermissions, parsePlan,
  type AgentPermissionSettings, type AgentStep, type AgentToolCall, type AgentToolName, type AgentTranscriptEntry,
} from './agent.ts'

/** 对话里一条消息的渲染形状（与 `AgentTranscriptEntry` 的导出格式对齐，便于整份落盘）。 */
export interface AgentChatMessage {
  id: number
  role: 'user' | 'assistant' | 'system'
  text: string
  at: string
  /** 助手消息带工具调用与计划；用户消息没有。 */
  toolCalls?: AgentToolCall[]
  /** Provider 原始工具调用及其模型可见结果，用于后续请求与转录恢复。 */
  modelToolCalls?: AgentModelToolCall[]
  plan?: AgentStep[]
}

/** 一条卡在审批门的工具调用。批准之后才允许宿主执行它。 */
export interface AgentApprovalRequest {
  call: AgentToolCall
  messageId: number
  /** `decidePermission` 的判定：`allow` 直接过，`ask` 才进这个队列，`deny` 立刻拒。 */
  verdict: 'allow' | 'ask' | 'deny'
}

export interface AgentSessionOptions {
  permissions?: AgentPermissionSettings
  /** 时钟注入，让 `at` 在测试里可断言。 */
  now?: () => Date
}

export interface AgentModelToolInvocation {
  providerCallId: string
  name: string
  input: Record<string, unknown>
  tool: AgentToolName
  params: Record<string, unknown>
}

export interface AgentModelToolCall extends AgentModelToolInvocation {
  call: AgentToolCall
  result?: string
  isError?: boolean
}

export interface AgentModelReply {
  text: string
  toolCalls?: AgentModelToolInvocation[]
}

export interface AgentSession {
  messages(): AgentChatMessage[]
  plan(): AgentStep[]
  approvals(): AgentApprovalRequest[]
  permissions(): AgentPermissionSettings
  setPermissions(next: AgentPermissionSettings): void
  /** 显式模型请求用当前转录生成文本；请求未成功时不提交该轮消息。 */
  sendWithModel(text: string, generate: (messages: readonly AgentModelMessage[], onDelta?: (delta: string) => void) => Promise<string | AgentModelReply>, onDelta?: (delta: string) => void): Promise<AgentChatMessage>
  /** 为同一轮已完成的工具调用继续生成；不新增用户消息。 */
  continueWithModel(generate: (messages: readonly AgentModelMessage[], onDelta?: (delta: string) => void) => Promise<string | AgentModelReply>, onDelta?: (delta: string) => void): Promise<AgentChatMessage>
  /** 批准一条待决工具调用 —— 它才从 approvals() 里消失。 */
  approve(messageId: number, callId: number): boolean
  /** 拒绝一条待决工具调用。 */
  reject(messageId: number, callId: number): boolean
  /** 已批准、等着宿主执行的工具调用（宿主取走即清空）。 */
  drainApproved(): AgentToolCall[]
  drainApprovedFor(messageId: number): AgentToolCall[]
  /** 记录工具返回给 provider 的内容，供下一轮上下文与恢复使用。 */
  recordToolResult(callId: number, result: string, isError: boolean): boolean
  hasSuccessfulRead(path: string): boolean
  /** 被拒的调用，供 UI 显示与记账。 */
  rejections(): AgentToolCall[]
  /** 勾选/取消一个计划步骤。 */
  toggleStep(index: number): void
  /** 导出成 `src/agent.ts` 的 transcript 形状（可 JSON 落盘）。 */
  transcript(): AgentTranscriptEntry[]
  /**
   * `/清空`：把这场对话清成刚开始的样子。
   *
   * **批准队列与轮数一起清**：清空后轮数与转录保持一致。
   */
  clear(): void
  /**
   * 从库里那份转写把一场旧会话装回来（会话库切换用）。
   *
   * 三条必须说清的口径：
   *   1. **历史里的调用绝不重新执行**。`transcript()` 记下的「已批准」只写进 `decidedApproved`
   *      （那只是让导出时如实说出当时的处置），**不进 `approved`** —— `approved` 是「等着被执行」
   *      的队列，`agentHost` 每轮 `drainApproved()` 会把它取走真去写盘。把历史灌进去等于
   *      切回一场旧对话就把当初的改动再写一遍。
   *   2. **审批队列清空**：那些调用在存档时就已经有处置了，切回来不该再挂一次「需要你批准」。
   *   3. **历史调用的 id 取负数**：恢复后新调用继续使用正数空间，避免和历史调用冲突。
   */
  restore(entries: readonly AgentTranscriptEntry[]): void
  /** 会话里发生过几轮。 */
  turns(): number
}

export interface AgentModelMessage {
  role: 'system' | 'user' | 'assistant' | 'tool'
  content: string
  toolCalls?: Array<{ id: string; name: string; input: Record<string, unknown> }>
  toolCallId?: string
  toolName?: string
  isError?: boolean
}

/**
 * 建一个会话。默认权限取 `src/agent.ts` 的 `defaultAgentPermissions`
 * （读放行、写与命令要问、网络关闭）—— 与本仓 MCP 服务端同一档，不另立一套默认值。
 */
export function createAgentSession(options: AgentSessionOptions = {}): AgentSession {
  const now = options.now ?? (() => new Date())
  const chat: AgentChatMessage[] = []
  const approvalQueue: AgentApprovalRequest[] = []
  const approved: AgentToolCall[] = []
  const rejected: AgentToolCall[] = []
  // `approved` 会被宿主 `drainApproved()` 取走，所以「这条到底批没批过」要另记一份 ——
  // transcript 在 drain 之后仍要能如实说出批准状态。
  const decidedApproved = new Set<number>()
  let permissions: AgentPermissionSettings = options.permissions ?? { ...defaultAgentPermissions }
  let planSteps: AgentStep[] = []
  let nextMessageId = 1
  let nextToolCallId = 1
  let turnCount = 0

  const stamp = (): string => now().toISOString()

  const modelHistory = (): AgentModelMessage[] => {
    const messages: AgentModelMessage[] = []
    for (const message of chat) {
      if (message.role === 'user') {
        messages.push({ role: 'user', content: message.text })
        continue
      }
      if (message.role !== 'assistant') continue
      const toolCalls = message.modelToolCalls ?? []
      messages.push({
        role: 'assistant', content: message.text,
        ...(toolCalls.length ? { toolCalls: toolCalls.map(call => ({ id: call.providerCallId, name: call.name, input: { ...call.input } })) } : {}),
      })
      for (const call of toolCalls) {
        if (call.result === undefined) continue
        messages.push({
          role: 'tool', content: call.result, toolCallId: call.providerCallId,
          toolName: call.name, isError: call.isError === true,
        })
      }
    }
    return messages
  }

  const appendModelReply = (reply: string | AgentModelReply): AgentChatMessage => {
    const result = typeof reply === 'string' ? { text: reply } : reply
    const modelToolCalls: AgentModelToolCall[] = (result.toolCalls ?? []).map(invocation => {
      const call: AgentToolCall = {
        id: nextToolCallId++, tool: invocation.tool, params: { ...invocation.params },
      }
      return { ...invocation, input: { ...invocation.input }, call }
    })
    const assistantMessage: AgentChatMessage = {
      id: nextMessageId++, role: 'assistant', text: result.text, at: stamp(),
      plan: parsePlan(result.text),
      ...(modelToolCalls.length ? { toolCalls: modelToolCalls.map(item => item.call), modelToolCalls } : {}),
    }
    chat.push(assistantMessage)
    planSteps = (assistantMessage.plan ?? []).map(step => ({ ...step }))
    for (const modelCall of modelToolCalls) {
      const verdict = decidePermission(modelCall.call.tool, permissions)
      if (verdict === 'allow') {
        approved.push(modelCall.call)
        decidedApproved.add(modelCall.call.id)
      } else if (verdict === 'ask') {
        approvalQueue.push({ call: modelCall.call, messageId: assistantMessage.id, verdict })
      } else {
        rejected.push(modelCall.call)
        modelCall.result = 'Tool call denied by the current permission settings.'
        modelCall.isError = true
      }
    }
    return assistantMessage
  }

  return {
    messages: () => [...chat],
    plan: () => planSteps.map(step => ({ ...step })),
    approvals: () => [...approvalQueue],
    permissions: () => ({ ...permissions }),
    setPermissions(next) {
      permissions = { ...next }
    },
    async sendWithModel(text, generate, onDelta) {
      const body = text.trim()
      if (!body) throw new Error('空消息不发送')
      const reply = await generate([...modelHistory(), { role: 'user', content: body }], onDelta)
      const userMessage: AgentChatMessage = { id: nextMessageId++, role: 'user', text: body, at: stamp() }
      chat.push(userMessage)
      turnCount += 1
      return appendModelReply(reply)
    },
    async continueWithModel(generate, onDelta) {
      if (!chat.some(message => message.role === 'user')) throw new Error('没有可继续的模型轮次。')
      return appendModelReply(await generate(modelHistory(), onDelta))
    },
    approve(messageId, callId) {
      const index = approvalQueue.findIndex(entry => entry.messageId === messageId && entry.call.id === callId)
      if (index < 0) return false
      const [entry] = approvalQueue.splice(index, 1)
      approved.push(entry!.call)
      decidedApproved.add(entry!.call.id)
      return true
    },
    reject(messageId, callId) {
      const index = approvalQueue.findIndex(entry => entry.messageId === messageId && entry.call.id === callId)
      if (index < 0) return false
      const [entry] = approvalQueue.splice(index, 1)
      rejected.push(entry!.call)
      return true
    },
    drainApproved() {
      const drained = approved.splice(0, approved.length)
      return drained
    },
    drainApprovedFor(messageId) {
      const drained: AgentToolCall[] = []
      for (let index = approved.length - 1; index >= 0; index--) {
        const call = approved[index]!
        const entry = chat.find(message => message.id === messageId)?.modelToolCalls?.find(item => item.call.id === call.id)
        if (!entry) continue
        drained.unshift(call)
        approved.splice(index, 1)
      }
      return drained
    },
    recordToolResult(callId, result, isError) {
      for (const message of chat) {
        const modelCall = message.modelToolCalls?.find(item => item.call.id === callId)
        if (!modelCall) continue
        modelCall.result = result
        modelCall.isError = isError
        return true
      }
      return false
    },
    hasSuccessfulRead(path) {
      return chat.some(message => message.modelToolCalls?.some(modelCall =>
        modelCall.call.tool === 'read_file' && modelCall.params.path === path &&
        modelCall.result !== undefined && !modelCall.isError,
      ))
    },
    rejections: () => [...rejected],
    toggleStep(index) {
      const step = planSteps[index]
      if (!step) return
      step.done = !step.done
    },
    transcript() {
      const entries: AgentTranscriptEntry[] = []
      for (const message of chat) {
        entries.push({ at: message.at, kind: message.role === 'user' ? 'user' : 'assistant', text: message.text })
        for (const call of message.toolCalls ?? []) {
          // 记的是这一条调用**当前**的处置：批过的 true、拒过的 false、还卡在门上的不写这一位。
          const wasRejected = rejected.some(item => item.id === call.id)
          const wasApproved = decidedApproved.has(call.id)
          entries.push({
            at: message.at,
            kind: 'tool',
            text: `${call.tool}(${JSON.stringify(call.params)})`,
            tool: call.tool,
            params: call.params,
            approved: wasRejected ? false : wasApproved ? true : undefined,
            ...(message.modelToolCalls?.find(item => item.call.id === call.id)
              ? { modelToolCall: {
                providerCallId: message.modelToolCalls.find(item => item.call.id === call.id)!.providerCallId,
                name: message.modelToolCalls.find(item => item.call.id === call.id)!.name,
                input: message.modelToolCalls.find(item => item.call.id === call.id)!.input,
                agentCallId: call.id,
                ...(message.modelToolCalls.find(item => item.call.id === call.id)!.result !== undefined
                  ? { result: message.modelToolCalls.find(item => item.call.id === call.id)!.result } : {}),
                ...(message.modelToolCalls.find(item => item.call.id === call.id)!.isError !== undefined
                  ? { isError: message.modelToolCalls.find(item => item.call.id === call.id)!.isError } : {}),
              } } : {}),
          })
        }
      }
      // 每一次拒绝再单独记一条 error：工具行说的是「这条调用存在、处置是什么」，
      // error 行说的是「用户在某时刻拒了它」—— 两件事，导出后都该看得见。
      for (const entry of rejected) {
        entries.push({
          at: stamp(), kind: 'error', text: `已拒绝：${entry.tool}`,
          tool: entry.tool, params: entry.params, approved: false,
        })
      }
      return entries
    },
    turns: () => turnCount,
    clear() {
      chat.length = 0
      approvalQueue.length = 0
      approved.length = 0
      rejected.length = 0
      decidedApproved.clear()
      planSteps = []
      turnCount = 0
      nextMessageId = 1
      nextToolCallId = 1
    },
    restore(entries) {
      chat.length = 0
      approvalQueue.length = 0
      approved.length = 0      // 历史调用一律不进「等着被执行」的队列（见接口上的第 1 条）。
      rejected.length = 0
      decidedApproved.clear()
      planSteps = []
      let restoredTurns = 0
      let restoredId = 1
      let historicalCallId = 0
      let assistant: AgentChatMessage | null = null
      for (const entry of entries) {
        if (entry.kind === 'user') {
          chat.push({ id: restoredId++, role: 'user', text: entry.text, at: entry.at })
          assistant = null
          restoredTurns += 1
          continue
        }
        if (entry.kind === 'assistant') {
          const message: AgentChatMessage = {
            id: restoredId++, role: 'assistant', text: entry.text, at: entry.at, plan: parsePlan(entry.text),
          }
          chat.push(message)
          assistant = message
          continue
        }
        if (entry.kind === 'tool') {
          if (!entry.tool) continue
          const modelCall = entry.modelToolCall
          const call: AgentToolCall = {
            // 新 transcript 保留原调用 id；旧 transcript 的历史调用继续使用负数空间。
            id: modelCall?.agentCallId ?? -(++historicalCallId),
            tool: entry.tool,
            params: entry.params ?? {},
          }
          if (assistant) {
            (assistant.toolCalls ??= []).push(call)
            if (modelCall) {
              (assistant.modelToolCalls ??= []).push({
                providerCallId: modelCall.providerCallId,
                name: modelCall.name,
                input: { ...modelCall.input },
                tool: call.tool,
                params: { ...call.params },
                call,
                result: modelCall.result ?? 'Tool call was not completed before the session was restored.',
                isError: modelCall.isError ?? modelCall.result === undefined,
              })
              nextToolCallId = Math.max(nextToolCallId, call.id + 1)
            }
          }
          if (entry.approved === true) decidedApproved.add(call.id)
          else if (entry.approved === false) rejected.push(call)
          continue
        }
        // error / note / approval 这几类在转写里是「处置的旁证」，恢复时按原样忽略 ——
        // 它们的信息已经落在上面 tool 行的 approved 上了，再造一份只会重复。
      }
      turnCount = restoredTurns
      nextMessageId = restoredId
      // 面板上那条待办清单 = **最新一轮**的计划。
      const lastAssistant = [...chat].reverse().find(message => message.role === 'assistant')
      planSteps = (lastAssistant?.plan ?? []).map(step => ({ ...step }))
    },
  }
}

/** 面板头部用的一行摘要：模型名 + 待审批条数 + 待决改动条数。 */
export function sessionStatusLine(session: AgentSession, pendingEdits: number, model: string): string {
  const approvals = session.approvals().length
  const parts = [model]
  if (approvals > 0) parts.push(`待批准 ${approvals}`)
  if (pendingEdits > 0) parts.push(`待决改动 ${pendingEdits}`)
  if (approvals === 0 && pendingEdits === 0) parts.push('空闲')
  return parts.join(' · ')
}
