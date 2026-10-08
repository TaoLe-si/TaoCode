// Agent 对话输入框的斜杠命令表（右侧 `src/components/AgentPanel.vue` 的消息输入框）。
//
// 只登记面板里真有落点的动作，不放假命令：表外的名字一律解析为 null，
// 过滤也只在这张表里找 —— 想加命令，先去面板接线，再回来登记。
//
// 过滤为什么长这样：先读了 `src/fuzzyMatch.ts`。那份是给文件名搜索写的
// Smith-Waterman 局部对齐（位置花红 + 归一分 + 0.65 阈值），打分形状对五条短命令
// 不合适 —— 阈值那套会把「只对上一两个字」的部分命中也放进补全。所以退回两档：
// 前缀优先、其次整段子序列；子序列这一档仍复用 `fuzzyMatch` 的命中下标
// （下标数盖满整个查询恰好就是严格的子序列判定），不另写一套比对。
import { fuzzyMatch } from './fuzzyMatch.ts'

/** 命令能不能用要看的现场。布尔由面板当场填，这里不自己读会话。 */
export interface AgentCommandContext {
  hasMessages: boolean
  hasPendingEdits: boolean
}

export interface AgentCommand {
  id: string
  /** 补全列表里给用户看的名字，统一「中文 + 前导斜杠」。 */
  label: string
  description: string
  /** 命令名后面还能不能跟一段参数。缺省 = 不吃参数。 */
  takesArgument?: boolean
  /** `takesArgument` 为真时的参数说明，补全与用法提示都用它。 */
  argumentHint?: string
  /** 缺省 = 始终可用；给出时不满足就不要放进可执行列表。 */
  enabledWhen?: (context: AgentCommandContext) => boolean
}

/**
 * 五条，顺序即补全顺序。显示名统一中文加斜杠：输入框补全是给人看的，
 * 斜杠保留「这是个命令」的记号；中文措辞直接取面板已有的按钮与小节标题
 * （「全部保留」「Agent 设置」），两处看到的是同一套词。
 *
 * 落点（都在面板或它直接调用的模块里，不是新造的动作）：
 * - new        会话库的 `create(name?)`（`src/agentSessions.ts`，名字可省，正好对上
 *              可省参数）；装配层起一场走的也是同一来源的 `createAgentSession`。
 * - clear      面板渲染的消息流 `host.session().messages()`；没消息就没得清，
 *              清的只是消息，不动改动台账与审批。
 * - review     面板的 `pendingEdits`（只留 `state === 'pending'` 的条目）。
 * - keep-all   改动区标题「全部保留（N）」按钮 → `host.doAllEdits()`。
 * - settings   标题栏「Agent 设置」齿轮 → `emit('openSettings')` → Agent 设置页。
 */
export const AGENT_COMMANDS: readonly AgentCommand[] = Object.freeze([
  Object.freeze({
    id: 'new',
    label: '/新会话',
    description: '开一场新会话；可以给个名字，不给就用默认名。',
    takesArgument: true,
    argumentHint: '会话名（可省）',
  }),
  Object.freeze({
    id: 'clear',
    label: '/清空',
    description: '清空当前这场对话里的消息。',
    enabledWhen: (context: AgentCommandContext) => context.hasMessages,
  }),
  Object.freeze({
    id: 'review',
    label: '/只看待决',
    description: '改动列表只显示还没决定的条目。',
    enabledWhen: (context: AgentCommandContext) => context.hasPendingEdits,
  }),
  Object.freeze({
    id: 'keep-all',
    label: '/全部保留',
    description: '把所有待决改动都保留下来。',
    enabledWhen: (context: AgentCommandContext) => context.hasPendingEdits,
  }),
  Object.freeze({
    id: 'settings',
    label: '/设置',
    description: '打开 Agent 设置页。',
  }),
])

const COMMAND_BY_ID = new Map(AGENT_COMMANDS.map(command => [command.id, command]))

/** 输入是不是一条斜杠命令：以 `/` 起头，且不是 `//` 开头（那按普通文本发出去）。 */
export function isAgentCommandInput(text: string): boolean {
  return text.startsWith('/') && !text.startsWith('//')
}

/**
 * 把输入拆成命令 id + 参数。
 * 认不出、只有一个斜杠、或不该带参数却带了，都返回 null（不当成普通消息发出去）。
 * 命令名大小写不敏感；参数原样保留内部空格与中文，只去掉首尾空白。
 */
export function parseAgentCommand(text: string): { id: string; argument: string } | null {
  if (!isAgentCommandInput(text)) return null
  const body = text.slice(1)
  const splitAt = body.search(/\s/)
  const name = (splitAt < 0 ? body : body.slice(0, splitAt)).toLowerCase()
  const argument = splitAt < 0 ? '' : body.slice(splitAt).trim()
  if (!name) return null
  const command = COMMAND_BY_ID.get(name)
  if (!command) return null
  if (argument && !command.takesArgument) return null
  return { id: command.id, argument }
}

/**
 * 补全过滤。空查询返回整张表（顺序不变）。
 * 查询打在**命令名（id）**上，不打在中文显示名或参数提示上：用户键入的是
 * `/clear` 这种名字。前缀命中排在子序列命中前面；两档都不是就丢掉。
 */
export function matchAgentCommands(query: string): AgentCommand[] {
  const needle = query.trim().toLowerCase()
  if (!needle) return [...AGENT_COMMANDS]
  const prefixed: AgentCommand[] = []
  const subsequence: AgentCommand[] = []
  for (const command of AGENT_COMMANDS) {
    const id = command.id.toLowerCase()
    if (id.startsWith(needle)) {
      prefixed.push(command)
      continue
    }
    const matched = fuzzyMatch(needle, id)
    if (matched.indices.length === needle.length) subsequence.push(command)
  }
  return [...prefixed, ...subsequence]
}

