export type AgentToolName = 'read_file' | 'write_file' | 'run_command' | 'fetch_network' | 'mcp_call'

export interface AgentToolCall {
  id: number
  tool: AgentToolName
  // The exact arguments the model asked for, shown to the user verbatim.
  params: Record<string, unknown>
}

export interface AgentPermissionSettings {
  // 'allow' runs without asking, 'ask' shows the approval gate, 'never' is refused
  // outright. Defaults follow the roadmap: reads free, writes and commands gated,
  // network off.
  read: 'allow' | 'ask' | 'never'
  write: 'allow' | 'ask' | 'never'
  run: 'allow' | 'ask' | 'never'
  network: 'allow' | 'ask' | 'never'
}

export const defaultAgentPermissions: AgentPermissionSettings = { read: 'allow', write: 'ask', run: 'ask', network: 'never' }

export type PermissionVerdict = 'allow' | 'ask' | 'deny'

// AG-04: every tool call passes through this gate before anything executes.
export function decidePermission(tool: AgentToolName, settings: AgentPermissionSettings): PermissionVerdict {
  if (tool === 'mcp_call') return 'ask'
  const level = settings[tool === 'read_file' ? 'read' : tool === 'write_file' ? 'write' : tool === 'run_command' ? 'run' : 'network']
  return level === 'allow' ? 'allow' : level === 'ask' ? 'ask' : 'deny'
}

// AG-02: a plan is the numbered list of the reply; blank/quote lines are dropped so
// the todo list cannot fill with prose.
export interface AgentStep { index: number; text: string; done: boolean }

export function parsePlan(reply: string): AgentStep[] {
  const steps: AgentStep[] = []
  for (const raw of reply.split(/\r?\n/)) {
    const line = raw.trim()
    const match = /^(?:\d+[.)]|[-*])\s+(.*)$/.exec(line)
    if (!match) continue
    const text = match[1]!.trim()
    if (!text) continue
    steps.push({ index: steps.length, text, done: false })
    if (steps.length >= 50) break
  }
  return steps
}

// AG-05: the write preview the user accepts or rejects, one per file.
export interface AgentEdit {
  path: string
  before: string
  after: string
}

export function renderEditPreview(edit: AgentEdit): { added: number; removed: number; hunks: Array<{ before: string[]; after: string[] }> } {
  const before = edit.before.split('\n')
  const after = edit.after.split('\n')
  // Longest common subsequence by line; equal runs close a hunk, differences open one.
  const dp: number[][] = Array.from({ length: before.length + 1 }, () => Array<number>(after.length + 1).fill(0))
  for (let i = before.length - 1; i >= 0; --i)
    for (let j = after.length - 1; j >= 0; --j)
      dp[i][j] = before[i] === after[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1])
  const hunks: Array<{ before: string[]; after: string[] }> = []
  let current: { before: string[]; after: string[] } | null = null
  let added = 0, removed = 0
  let i = 0, j = 0
  while (i < before.length && j < after.length) {
    if (before[i] === after[j]) {
      if (current) { hunks.push(current); current = null }
      ++i; ++j
    } else if (dp[i + 1][j] >= dp[i][j + 1]) {
      current ??= { before: [], after: [] }
      current.before.push(before[i]!)
      ++removed; ++i
    } else {
      current ??= { before: [], after: [] }
      current.after.push(after[j]!)
      ++added; ++j
    }
  }
  while (i < before.length) { current ??= { before: [], after: [] }; current.before.push(before[i]!); ++removed; ++i }
  while (j < after.length) { current ??= { before: [], after: [] }; current.after.push(after[j]!); ++added; ++j }
  if (current) hunks.push(current)
  return { added, removed, hunks }
}

// AG-03: context selection is explicit; this computes the character budget the
// transcript shows (token estimates stay clearly marked as estimates).
export function contextUsage(files: Array<{ path: string; content: string }>, budgetChars: number) {
  let used = 0
  const perFile = files.map(file => {
    used += file.content.length
    return { path: file.path, chars: file.content.length, truncated: false }
  })
  let overflow = used - budgetChars
  const truncated = perFile.map((entry, index) => {
    if (overflow <= 0) return entry
    const take = Math.max(0, entry.chars - overflow)
    overflow -= entry.chars - take
    return { ...entry, chars: take, truncated: take < perFile[index]!.chars }
  })
  return { files: truncated, usedChars: truncated.reduce((sum, entry) => sum + entry.chars, 0), budgetChars, overBudget: used > budgetChars }
}

// AG-09: usage accounting. Estimates and real metering are kept in separate fields
// so the UI can label them differently (估算 vs 账单).
export interface UsageRecord { calls: number; promptChars: number; completionChars: number }

export function summarizeUsage(records: UsageRecord[]): { calls: number; promptChars: number; completionChars: number; estimatedTokens: number } {
  const totals = records.reduce<UsageRecord>((sum, record) => ({
    calls: sum.calls + record.calls,
    promptChars: sum.promptChars + record.promptChars,
    completionChars: sum.completionChars + record.completionChars,
  }), { calls: 0, promptChars: 0, completionChars: 0 })
  // ~2 chars per token for CJK-mixed text; explicitly an estimate.
  return { ...totals, estimatedTokens: Math.ceil((totals.promptChars + totals.completionChars) / 2) }
}

// AG-10: the transcript is plain JSON so it can be exported, re-read and diffed.
export interface AgentTranscriptEntry {
  at: string
  kind: 'user' | 'assistant' | 'tool' | 'approval' | 'error' | 'note'
  text: string
  tool?: AgentToolName
  params?: Record<string, unknown>
  result?: string
  approved?: boolean
  modelToolCall?: {
    providerCallId: string
    name: string
    input: Record<string, unknown>
    agentCallId: number
    result?: string
    isError?: boolean
  }
}

export function exportTranscript(entries: readonly AgentTranscriptEntry[], header: { model: string; started: string }): string {
  return JSON.stringify({ format: 'taocode-agent-transcript/1', model: header.model, started: header.started, entries }, null, 2)
}

// The deterministic local fake model. It never touches the network and produces
// the same reply for the same prompt, so the whole permission/diff pipeline is
// testable and demoable without any authorization.
export interface FakeModelReply { text: string; toolCalls: AgentToolCall[] }

export function fakeModelReply(prompt: string, workspaceFiles: readonly string[], call: number): FakeModelReply {
  const target = /`([^`]+)`/.exec(prompt)?.[1] ?? workspaceFiles[0] ?? 'README.md'
  const text =
    `计划：\n` +
    `1. 读取 ${target} 了解现状\n` +
    `2. 在 ${target} 末尾追加一行 Agent 标记\n` +
    `3. 汇报完成情况\n\n` +
    `（本地假模型：无网络访问，输出确定性，可用于验证权限门与差异预览。）`
  const toolCalls: AgentToolCall[] = [{ id: call * 2, tool: 'read_file', params: { path: target } }]
  if (call > 0)
    toolCalls.push({ id: call * 2 + 1, tool: 'write_file', params: { path: target, append: `\n// taocode-agent\n` } })
  return { text, toolCalls }
}
