// ZCode 对话消息行的行类型划分与渲染描述（复刻 ConversationRowView 一族）。
// 纯逻辑：零 Vue / 零 DOM / 零状态。每条规则在注释里给出 .tools/ZCode 的 文件:行号。
// 上游锚点（.tools/ZCode/packages/ui/src）：v4/ConversationRowView.tsx（行分发 + 叶子）、
// v4/conversationAssistantWorkItems.ts（工具分组）、v4/conversationCuaGroups.ts（CUA 分组）、
// lib/exploreToolCall.ts（explore/execute 判据）、lib/toolIdentity.ts（家族解析）、
// ModelTrajectoryRoleStyles.ts（角色样式键）、i18n/locales/zh-CN.ts（chat.* 文案）。

// ── 1. 行类型 ────────────────────────────────────────────────────────────────

/** 9 种行类型。出处：shared/src/zcode-protocol-v4/rows.ts:420-430（按 kind 判别的 union）。 */
export const ZCODE_ROW_KINDS = [
  'turnHeader',
  'userInput',
  'assistantText',
  'reasoning',
  'toolCall',
  'artifact',
  'subagent',
  'hookInvocation',
  'timelineMarker',
] as const

export type ZcodeRowKind = (typeof ZCODE_ROW_KINDS)[number]

/** kind 字面量定义行：rows.ts 的 60/102/158/170/193/237/253/308/412。 */
export const ROW_KIND_LITERAL_LINES: Record<ZcodeRowKind, number> = {
  turnHeader: 60, userInput: 102, assistantText: 158, reasoning: 170, toolCall: 193,
  artifact: 237, subagent: 253, hookInvocation: 308, timelineMarker: 412,
}

/** 渲染叶子。出处：ConversationRowView.tsx:153/851/1477/1592/1894/1627/1749/2074，分发 switch :2113-2167。 */
export const ROW_VIEW_ANCHORS: Record<ZcodeRowKind, { component: string; line: number }> = {
  turnHeader: { component: 'TurnHeaderRowView', line: 1627 },
  userInput: { component: 'UserInputRowView', line: 851 },
  assistantText: { component: 'AssistantTextRowView', line: 1477 },
  reasoning: { component: 'ReasoningRowView', line: 1592 },
  toolCall: { component: 'ToolCallRowView', line: 1894 },
  artifact: { component: 'ArtifactRowView', line: 153 },
  subagent: { component: 'SubagentRowView', line: 2074 },
  // hookInvocation 不在 switch 里（落 default: return null，:2165-2166）。
  hookInvocation: { component: 'ConversationHookDetailsAction', line: 1465 },
  timelineMarker: { component: 'TimelineMarkerRowView', line: 1749 },
}

export function isZcodeRowKind(value: unknown): value is ZcodeRowKind {
  return typeof value === 'string' && (ZCODE_ROW_KINDS as readonly string[]).includes(value)
}

/** 错误不是第 10 种行。出处：rows.ts:198 toolCall.status 含 "error" 与 :207；assistantText.state :162。 */
export const ERROR_RIDES_ON = { toolCallStatus: 'error', assistantTextState: 'failed' } as const

// ── 2. 角色样式键 ───────────────────────────────────────────────────────────

/** 出处：ModelTrajectoryRoleStyles.ts:1-7。 */
export const TRAJECTORY_VISUAL_ROLES = [
  'system', 'user', 'assistant', 'reasoning', 'tool-call', 'tool-result',
] as const

export type TrajectoryVisualRole = (typeof TRAJECTORY_VISUAL_ROLES)[number]

/** 出处：ModelTrajectoryRoleStyles.ts:9-16 的 roleTextClasses（逐字）。 */
export const TRAJECTORY_ROLE_TEXT_CLASSES: Record<TrajectoryVisualRole, string> = {
  system: 'text-foreground-subtle',
  user: 'text-trajectory-user/80',
  assistant: 'text-trajectory-assistant/80',
  reasoning: 'text-trajectory-reasoning/80',
  'tool-call': 'text-trajectory-tool-call/80',
  'tool-result': 'text-trajectory-tool-result/80',
}

/** 色值 token 取值。出处：packages/ui/src/styles.css:163-167（亮）与 :315-319（暗）。 */
export const TRAJECTORY_ROLE_COLOR_TOKENS: Record<
  Exclude<TrajectoryVisualRole, 'system'>,
  { light: string; dark: string }
> = {
  user: { light: '#2563eb', dark: '#60a5fa' },
  assistant: { light: '#0f766e', dark: '#2dd4bf' },
  reasoning: { light: '#7c3aed', dark: '#a78bfa' },
  'tool-call': { light: '#d97706', dark: '#f59e0b' },
  'tool-result': { light: '#0284c7', dark: '#38bdf8' },
}

export function trajectoryRoleTextClass(role: TrajectoryVisualRole): string {
  return TRAJECTORY_ROLE_TEXT_CLASSES[role]
}

/**
 * 行类型 → 轨迹角色。v4 对话行本身不消费这些类（trajectoryRoleTextClass 只被 ModelTrajectory*
 * 三文件引用：PaneParts.tsx:18 / ExpandableMessage.tsx:20 / RoleStyles.ts:1），这里按上游真实
 * 推导映射；无对应物的行类型返回 null，不猜。出处：user/assistant 透传 PaneParts.tsx:184、:221-229；
 * reasoning 显式 :281-284；tool-call/tool-result 由 part kind 推导 ExpandableMessage.tsx:66-74。
 */
export function trajectoryRoleForRowKind(kind: ZcodeRowKind): TrajectoryVisualRole | null {
  switch (kind) {
    case 'userInput':
      return 'user'
    case 'assistantText':
      return 'assistant'
    case 'reasoning':
      return 'reasoning'
    case 'toolCall':
      return 'tool-call'
    default:
      return null
  }
}

// ── 3. 图标 ─────────────────────────────────────────────────────────────────

/** lucide 名。出处：ConversationRowView.tsx:4-18 import（:5 Archive/:6 ArrowRightLeft/:7 Check/:8 Copy/:9 FileClock/:10 File/:11 GitBranch/:12 Goal/:13 Pencil/:14 ThumbsDown/:15 ThumbsUp/:16 TrendingUpDown/:17 X）。 */
export const ROW_LUCIDE_ICONS = {
  artifact: 'FileIcon', copy: 'CopyIcon', copyDone: 'CheckIcon', edit: 'PencilIcon',
  fork: 'TrendingUpDownIcon', like: 'ThumbsUpIcon', dislike: 'ThumbsDownIcon',
  rewindWorkspace: 'FileClockIcon', removeAttachment: 'XIcon', markerCompact: 'ArchiveIcon',
  markerFork: 'GitBranchIcon', markerGoal: 'GoalIcon', markerModelChange: 'ArrowRightLeftIcon',
} as const

/** 叶子自己的图标。出处：reasoning.tsx:14（Brain/ChevronRight）；ConversationUserInputBody.tsx:2（ChevronUp/Down）；ConversationUserInputEpilogue.tsx:2（ChevronDown/Right）。 */
export const LEAF_LUCIDE_ICONS = {
  reasoning: 'BrainIcon', reasoningChevron: 'ChevronRightIcon', userInputExpand: 'ChevronUpIcon',
  userInputCollapse: 'ChevronDownIcon', epilogueOpen: 'ChevronDownIcon',
  epilogueClosed: 'ChevronRightIcon',
} as const

/** marker 类型 → 图标。出处：ConversationRowView.tsx:1639-1662 + :1765-1855。 */
export function markerIconName(markerType: string): string | null {
  switch (markerType) {
    case 'compact':
      return ROW_LUCIDE_ICONS.markerCompact
    case 'forkNotice':
      return ROW_LUCIDE_ICONS.markerFork
    case 'goalVerify':
      return ROW_LUCIDE_ICONS.markerGoal
    case 'modelChange':
      return ROW_LUCIDE_ICONS.markerModelChange
    default:
      return null
  }
}

// ── 4. 动作按钮 ─────────────────────────────────────────────────────────────

export type AgentRowActionId =
  | 'copy' | 'edit' | 'like' | 'dislike' | 'fork' | 'retry' | 'hookDetails'
  | 'navigateToForkParent' | 'submitEdit' | 'cancelEdit' | 'rewindWorkspace' | 'removeAttachment'

export interface AgentRowAction {
  id: AgentRowActionId
  /** zh-CN 文案键（i18n/locales/zh-CN.ts）。 */
  labelKey: string
  icon: string | null
  /** 源码里的渲染门；缺席 = 无条件。 */
  gate?: string
}

function action(
  id: AgentRowActionId,
  labelKey: string,
  icon: string | null = null,
  gate?: string,
): AgentRowAction {
  return gate === undefined ? { id, labelKey, icon } : { id, labelKey, icon, gate }
}

/**
 * 每类行的动作按钮（全部以源码为准）。
 *
 * userInput（ConversationRowView.tsx:1284-1305）：copy 无条件（:1290-1294）；edit 门
 * onEdit && row.entityId（:1295），TurnGroup 再按 actions.canEdit 收紧（ConversationTurnGroup.tsx:683）。
 * 编辑态另有 submit/cancel/rewind/removeAttachment：submit chat.send（:901）、
 * cancel common.cancel（:902）、rewind chat.edit.resetConversationAndFiles（:903-905，测试 id :1036）、
 * 附件删除 chat.attachments.remove（:800-801）。
 *
 * assistantText（:1406-1473）：copy 无条件（:1408-1413）；like/dislike 门
 * entityId && onFeedbackChange（:1414）；fork 门 onFork && entityId（:1454）；
 * hookDetails 门 turnId && hookInvocations（:1465）。retry **不渲染**（:251-252 注释；
 * onRetry 只透传 :1578-1580、:2130）——只登记不画。
 * 整行动作行另有门 row.state === 'complete' && !hideActions && !deferActions（:1571）。
 *
 * reasoning / turnHeader / subagent / artifact：叶子无 MessageActions。
 * timelineMarker：仅 forkNotice 且宿主给 onNavigateToRow 时整行可点（:1860-1866）。
 */
export function rowActionsForKind(
  kind: ZcodeRowKind,
  options?: { markerType?: string; editable?: boolean; showEditMode?: boolean },
): AgentRowAction[] {
  if (kind === 'userInput') {
    const actions = [action('copy', 'chat.message.copy', ROW_LUCIDE_ICONS.copy)]
    if (options?.editable !== false) {
      actions.push(action('edit', 'chat.message.edit', ROW_LUCIDE_ICONS.edit, 'onEdit && row.entityId'))
    }
    if (options?.showEditMode === true) {
      actions.push(
        action('submitEdit', 'chat.send'),
        action('cancelEdit', 'common.cancel'),
        action('rewindWorkspace', 'chat.edit.resetConversationAndFiles', ROW_LUCIDE_ICONS.rewindWorkspace),
        action('removeAttachment', 'chat.attachments.remove', ROW_LUCIDE_ICONS.removeAttachment),
      )
    }
    return actions
  }
  if (kind === 'assistantText') {
    return [
      action('copy', 'chat.message.copy', ROW_LUCIDE_ICONS.copy),
      action('like', 'chat.message.like', ROW_LUCIDE_ICONS.like, 'entityId && onFeedbackChange'),
      action('dislike', 'chat.message.dislike', ROW_LUCIDE_ICONS.dislike, 'entityId && onFeedbackChange'),
      action('fork', 'chat.message.fork', ROW_LUCIDE_ICONS.fork, 'onFork && entityId'),
      action('retry', 'chat.message.retry', null, 'never-rendered'),
      action('hookDetails', 'chat.hooks.label', null, 'turnId && hookInvocations'),
    ]
  }
  if (kind === 'timelineMarker' && options?.markerType === 'forkNotice') {
    return [
      action('navigateToForkParent', 'chat.message.fork.derivedFrom', null, 'context.onNavigateToRow'),
    ]
  }
  return []
}

// ── 5. 可折叠性 ─────────────────────────────────────────────────────────────

/**
 * 行级折叠：只有 reasoning 默认收起，且流式/完成态都默认收起（ConversationRowView.tsx:1600-1603
 * 注释），状态边界靠 autoCollapseKey 复位、不覆盖用户已发生的交互（:1614、reasoning.tsx:66-75）。
 * toolCall 的展开由 ToolCallBlock 的 renderer 决定（:1990-2068），行级不设折叠。
 */
export function isCollapsibleRow(kind: ZcodeRowKind): boolean {
  return kind === 'reasoning'
}

/** userInput 正文折叠阈值与容差。出处：ConversationUserInputBody.tsx:7 与 :8。 */
export const USER_INPUT_COLLAPSED_MAX_HEIGHT_PX = 120
export const USER_INPUT_OVERFLOW_TOLERANCE_PX = 1

/** 出处：ConversationUserInputBody.tsx:10-15。 */
export function isUserInputOverflowing(scrollHeight: number): boolean {
  return scrollHeight > USER_INPUT_COLLAPSED_MAX_HEIGHT_PX + USER_INPUT_OVERFLOW_TOLERANCE_PX
}

/** 正文/尾注切分。出处：ConversationUserInputEpilogue.tsx:15-23。 */
export function splitUserInputEpilogue(
  text: string,
  epilogueStart: number | undefined,
): { body: string; epilogue?: string } {
  if (epilogueStart === undefined || epilogueStart < 0 || epilogueStart > text.length) {
    return { body: text }
  }
  return { body: text.slice(0, epilogueStart), epilogue: text.slice(epilogueStart) }
}

// ── 6. reasoning / todo 两条可见性开关 ──────────────────────────────────────

/** 出处：v4/conversationRowContext.ts:199-202。 */
export interface ReasoningVisibility {
  messageStreamShowReasoning?: boolean
  messageStreamFirstReasoningRowId?: number
}

/** 开关为 true，或该行是本轮首条 reasoning。出处：conversationRowContext.ts:204-212；首条例外见 ConversationRowView.tsx:2142-2143。 */
export function isConversationReasoningRowVisible(
  rowId: number,
  visibility: ReasoningVisibility,
): boolean {
  return (
    visibility.messageStreamShowReasoning === true ||
    visibility.messageStreamFirstReasoningRowId === rowId
  )
}

/** 默认值。出处：SessionPane.tsx:1367（reasoning true）、:1368（todos false）。 */
export const VISIBILITY_DEFAULTS = {
  messageStreamShowReasoning: true,
  messageStreamShowTodos: false,
} as const

/**
 * 待办工具行可见性。出处：ConversationRowView.tsx:2154-2159 —— 开关非 true 且 family 为 todo
 * 时在行分发处返回 null。family todo = TodoRead / TodoWrite（shared/src/tool-identity.ts:68-69）。
 */
export function isTodoToolRowVisible(
  toolRow: { toolName: string; kind?: string },
  showTodos: boolean,
): boolean {
  if (showTodos === true) return true
  return !isTodoToolRow(toolRow)
}

/** todo 判据：family 命中（ConversationRowView.tsx:2156）或名字形状（shared/src/tool-plan-adapter.ts:3-4）。 */
export function isTodoToolRow(toolRow: { toolName: string; kind?: string }): boolean {
  return (
    resolveToolFamily(toolRow) === 'todo' || TODO_TOOL_NAME_PATTERN.test(toolRow.toolName.trim())
  )
}

const TODO_TOOL_NAME_PATTERN =
  /(?:^|[_\s-])(?:todo[_\s-]*(?:read|write)|update[_\s-]*plan)(?:$|[_\s-])/i

/**
 * reasoning 行与待办行的渲染差异：
 *   开关     reasoning 用 messageStreamShowReasoning（默认 true）；todo 用 messageStreamShowTodos（默认 false）
 *   例外     reasoning 本轮首条恒留（rowId 相等）；todo 无例外
 *   隐藏位置 都在行分发处返回 null（ConversationRowView.tsx:2144-2146 与 :2154-2159）
 *   折叠     reasoning 默认收起可展开（:1600-1623）；todo 行级不折叠
 *   空行     reasoning streaming 且 text 为空不渲染（:1606-1608）；todo 无此规则
 */
export function rowVisibilityGate(
  kind: ZcodeRowKind,
  input: {
    rowId: number
    reasoning: ReasoningVisibility
    toolName?: string
    messageStreamShowTodos?: boolean
  },
): boolean {
  if (kind === 'reasoning') {
    return isConversationReasoningRowVisible(input.rowId, input.reasoning)
  }
  if (kind === 'toolCall') {
    return isTodoToolRowVisible(
      { toolName: input.toolName ?? '', kind: input.toolName ?? '' },
      input.messageStreamShowTodos === true,
    )
  }
  return true
}

// ── 7. 工具家族 ─────────────────────────────────────────────────────────────

/** 出处：shared/src/tool-identity.ts:41-55。 */
export const ZCODE_TOOL_FAMILIES = [
  'file-read', 'file-write', 'shell', 'search', 'todo', 'ask-user-question', 'agent', 'skill',
  'goal', 'session-context', 'message', 'task-control', 'node-repl', 'workflow',
] as const

export type ZcodeToolFamily = (typeof ZCODE_TOOL_FAMILIES)[number]

/** 逐字取自 shared/src/tool-identity.ts:57-92 的 TOOL_FAMILY_BY_NAME。 */
export const TOOL_FAMILY_BY_NAME: Record<string, ZcodeToolFamily> = {
  Read: 'file-read', Write: 'file-write', Edit: 'file-write', ApplyPatch: 'file-write',
  Bash: 'shell', Glob: 'search', Grep: 'search', WebFetch: 'search', WebSearch: 'search',
  web_search: 'search', TodoRead: 'todo', TodoWrite: 'todo', GoalRead: 'goal',
  ReadSessionContext: 'session-context', AskUserQuestion: 'ask-user-question',
  SendMessage: 'message', RespondToCoordinator: 'message', TaskOutput: 'task-control',
  TaskStop: 'task-control', js: 'node-repl', js_reset: 'node-repl',
  js_add_node_module_dir: 'node-repl', mcp__node_repl__js: 'node-repl',
  mcp__node_repl__js_reset: 'node-repl', mcp__node_repl__js_add_node_module_dir: 'node-repl',
  Agent: 'agent', Task: 'agent', Skill: 'skill', CreateWorkflow: 'workflow',
  AmendWorkflow: 'workflow', submit_result: 'workflow',
}

/** 大小写不敏感查表。出处：tool-identity.ts:94-107（TOOL_NAME_BY_LOWER + normalizeZCodeToolName）。 */
export function toolFamily(toolName: string | null | undefined): ZcodeToolFamily | null {
  const normalized = toolName?.trim()
  if (!normalized) return null
  const key = Object.keys(TOOL_FAMILY_BY_NAME).find(
    (name) => name.toLowerCase() === normalized.toLowerCase(),
  )
  return key ? TOOL_FAMILY_BY_NAME[key]! : null
}

/** 出处：tool-identity.ts:70-77。 */
function normalizeLegacyToken(value: string | null | undefined): string {
  return value?.trim().toLowerCase().replace(/[\s-]+/g, '_') ?? ''
}

/** legacy kind 前缀回落。出处：tool-identity.ts:162-187（六条正则逐字）。 */
function legacyKindFamily(kind: string): ZcodeToolFamily | null {
  if (/^(?:read|view|open|cat|head|tail|read_file)(?:_|$)/i.test(kind)) return 'file-read'
  if (/(?:^|_)(?:edit|patch|replace|multi_edit|multiedit|write|create|save|apply_patch)(?:_|$)/i.test(kind)) {
    return 'file-write'
  }
  if (/^(?:execute|run|exec|bash|shell|command|terminal)(?:_|$)/i.test(kind)) return 'shell'
  if (/^(?:search|grep|find|fetch|web_search|web_fetch|webfetch|query|lookup|glob|list|ls|dir|tree)(?:_|$)/i.test(kind)) {
    return 'search'
  }
  if (/^(?:explore|inspect)(?:_|$)/i.test(kind)) return 'explore' as ZcodeToolFamily
  return null
}

/**
 * 家族解析。出处：tool-identity.ts:200-322 的顺序 —— kind==="explore"（:203-205）、
 * toolName→kind→raw 查已知名（:206-220）、legacy kind 正则回落（:309-312）。
 * explore 是 ToolCallPresentationFamily 的扩展值（:11-16），不在 ZCODE_TOOL_FAMILIES 里。
 */
export function resolveToolFamily(input: {
  toolName?: string | null
  kind?: string | null
}): ZcodeToolFamily | 'explore' | null {
  if (normalizeLegacyToken(input.kind) === 'explore') return 'explore'
  return toolFamily(input.toolName) ?? toolFamily(input.kind) ?? legacyKindFamily(normalizeLegacyToken(input.kind))
}

// ── 8. 工具分组：Explore / Terminal(Execute) / Changes / Agent ───────────────

/** 默认开关。出处：conversationAssistantWorkItems.ts:56-59（Explore true / Terminal true / Changes false）；CUA 见 conversationCuaGroups.ts:29。 */
export const TOOL_GROUPING_DEFAULTS = {
  explore: true, terminal: true, changes: false, cua: true,
} as const

/** 出处：conversationAssistantWorkItems.ts:69。 */
export const SUBAGENT_TOOL_NAMES = ['Agent', 'Task', 'subagent'] as const

/** 出处：conversationCuaGroups.ts:25-28。 */
export const OFFICIAL_CUA_TOOL_PREFIXES = [
  'mcp__computer-use__', 'mcp__plugin_zcode-cua_computer-use__',
] as const

export interface ToolRowLike {
  rowId: number
  toolName: string
  status: string
  /** legacy kind（旧投影里身份常只写在 kind 上）。 */
  kind?: string
  input?: unknown
  turnId?: string
  toolCallId?: string
  startedAt?: number
}

// 命令抽取：exploreToolCall.ts:7-111 的移植。
function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** 出处：exploreToolCall.ts:7-12。 */
function splitCommandSegments(command: string): string[] {
  return command.split(/&&|\|\||;/g).map((segment) => segment.trim()).filter((s) => s.length > 0)
}

/** 出处：exploreToolCall.ts:14-39。 */
function unwrapShellCommand(command: string): string {
  const trimmed = command.trim()
  const stripWrappingQuotes = (value: string): string => {
    const normalized = value.trim()
    if (
      (normalized.startsWith('"') && normalized.endsWith('"')) ||
      (normalized.startsWith("'") && normalized.endsWith("'"))
    ) {
      return normalized.slice(1, -1).trim()
    }
    return normalized
  }
  const shellCommandMatch = trimmed.match(/^(?:\/bin\/)?(?:zsh|bash|sh)\s+-lc\s+([\s\S]+)$/i)
  if (shellCommandMatch?.[1]) return stripWrappingQuotes(shellCommandMatch[1])
  const powershellCommandMatch = trimmed.match(
    /^(?:powershell(?:\.exe)?|pwsh(?:\.exe)?)\b[\s\S]*?\s-(?:command|c)\s+([\s\S]+)$/i,
  )
  if (powershellCommandMatch?.[1]) return stripWrappingQuotes(powershellCommandMatch[1])
  return trimmed
}

/** 出处：exploreToolCall.ts:41-48。 */
function normalizeCommandCandidate(candidate: string): string[] {
  const unwrapped = unwrapShellCommand(candidate)
  return unwrapped.length === 0 ? [] : splitCommandSegments(unwrapped)
}

/** 出处：exploreToolCall.ts:50-111。 */
export function extractToolCommands(input: unknown): string[] {
  const commandCandidates: string[] = []
  const collectFromValue = (value: unknown): void => {
    if (typeof value === 'string') {
      const command = value.trim()
      if (command.length > 0) commandCandidates.push(command)
      return
    }
    if (!Array.isArray(value)) return
    if (value.every((item) => typeof item === 'string')) {
      const commandParts = value as string[]
      const shellCommandIndex = commandParts.findIndex((part) => part === '-lc')
      if (shellCommandIndex >= 0 && typeof commandParts[shellCommandIndex + 1] === 'string') {
        const shellCommand = commandParts[shellCommandIndex + 1]!.trim()
        if (shellCommand.length > 0) {
          commandCandidates.push(shellCommand)
          return
        }
      }
      const joinedCommand = commandParts.join(' ').trim()
      if (joinedCommand.length > 0) commandCandidates.push(joinedCommand)
      return
    }
    for (const item of value) {
      if (!isPlainRecord(item)) continue
      const parsedCommand = item.cmd
      if (typeof parsedCommand === 'string' && parsedCommand.trim().length > 0) {
        commandCandidates.push(parsedCommand.trim())
      }
    }
  }
  collectFromValue(input)
  if (isPlainRecord(input)) {
    for (const key of ['command', 'cmd', 'script', 'parsed_cmd'] as const) collectFromValue(input[key])
  }
  return Array.from(
    new Set(commandCandidates.flatMap((candidate) => normalizeCommandCandidate(candidate))),
  )
}

// 命令正则：exploreToolCall.ts:113-118 逐字。
const EXECUTE_READ_COMMAND_RE =
  /\b(rg|grep|find|ls|cat|head|tail|wc|stat|pwd|which|readlink|tree|sed\s+-n|get-childitem|gci|dir|get-content|gc|type|select-string|sls|get-location|test-path|resolve-path)\b|^git\s+(status|log|show|diff)\b/i
const EXECUTE_WRITE_COMMAND_RE =
  /\b(sed\s+-i|perl\s+-pi|tee|mv|cp|rm|mkdir|rmdir|touch|truncate|chmod|chown|remove-item|del|erase|set-content|add-content|clear-content|out-file|new-item|move-item|copy-item|rename-item|set-item)\b|^git\s+(add|commit|rm|mv|checkout|switch|restore|reset|clean|revert|cherry-pick|merge|rebase)\b/i
const SHELL_REDIRECT_WRITE_RE = /(^|[^\d<])>>?\s*\S|&>\s*\S/i
const SHELL_LOOP_RE = /\b(for|while)\b/i

/** 出处：exploreToolCall.ts:120-123。 */
export function isShellToolCallAwaitingCommand(row: ToolRowLike): boolean {
  return resolveToolFamily(row) === 'shell' && extractToolCommands(row.input).length === 0
}

/**
 * explore 判据。出处：exploreToolCall.ts:125-166 —— file-write false；file-read/search/explore true；
 * 非 shell false；shell 看命令（无命令/写命令/重定向写均 false，只读命令或 for-while 包住的只读 true）。
 */
export function isExploreToolRow(row: ToolRowLike): boolean {
  const family = resolveToolFamily(row)
  if (family === 'file-write') return false
  if (family === 'file-read' || family === 'search' || family === 'explore') return true
  if (family !== 'shell') return false
  const commands = extractToolCommands(row.input)
  if (commands.length === 0) return false
  if (commands.some((command) => EXECUTE_WRITE_COMMAND_RE.test(command))) return false
  if (commands.some((command) => SHELL_REDIRECT_WRITE_RE.test(command))) return false
  if (commands.some((command) => EXECUTE_READ_COMMAND_RE.test(command))) return true
  return commands.some((c) => SHELL_LOOP_RE.test(c) && EXECUTE_READ_COMMAND_RE.test(c))
}

/** 出处：exploreToolCall.ts:168-175。 */
export function isExecuteToolRow(row: ToolRowLike): boolean {
  return (
    resolveToolFamily(row) === 'shell' &&
    !isShellToolCallAwaitingCommand(row) &&
    !isExploreToolRow(row)
  )
}

/** 出处：conversationAssistantWorkItems.ts:98-101（family === "file-write"）。 */
export function isChangesToolRow(row: ToolRowLike): boolean {
  return resolveToolFamily(row) === 'file-write'
}

/** 出处：conversationAssistantWorkItems.ts:103-112（仅 inputStreaming/running 且命令未出现）。 */
export function shouldDeferUnclassifiedShellToolRow(row: ToolRowLike): boolean {
  if (row.status !== 'inputStreaming' && row.status !== 'running') return false
  return isShellToolCallAwaitingCommand(row)
}

/** 出处：conversationAssistantWorkItems.ts:73-74（按 toolName 字面量，大小写敏感）。 */
export function isAgentToolRow(toolRow: { toolName: string }): boolean {
  return (SUBAGENT_TOOL_NAMES as readonly string[]).includes(toolRow.toolName)
}

export type ToolGroupKind = 'exploreGroup' | 'executeGroup' | 'changesGroup'

export interface ToolGroupingOverrides {
  explore?: boolean
  terminal?: boolean
  changes?: boolean
}

/**
 * 行所属分组档位（不满足任何档位 → null）。分流顺序出处：conversationAssistantWorkItems.ts:335-384
 * —— Explore 先判（:335-336），非 Explore 才试 Changes（:337）与 Execute（:360）。
 */
export function toolGroupingFor(
  row: ToolRowLike,
  enabled?: ToolGroupingOverrides,
): ToolGroupKind | null {
  const explore = enabled?.explore ?? TOOL_GROUPING_DEFAULTS.explore
  const terminal = enabled?.terminal ?? TOOL_GROUPING_DEFAULTS.terminal
  const changes = enabled?.changes ?? TOOL_GROUPING_DEFAULTS.changes
  if (isExploreToolRow(row)) return explore ? 'exploreGroup' : null
  if (changes && isChangesToolRow(row)) return 'changesGroup'
  if (terminal && isExecuteToolRow(row)) return 'executeGroup'
  return null
}

export type ToolGroupStageStatus = 'in_progress' | 'completed' | 'stopped'

/** 出处：conversationAssistantWorkItems.ts:114-123（explore/execute）与 :195（changes 只有两态）。 */
export function resolveGroupStageStatus(
  rows: readonly ToolRowLike[],
  stageTailIsRunning: boolean,
  variant: 'explore' | 'execute' | 'changes' = 'explore',
): ToolGroupStageStatus {
  if (stageTailIsRunning) return 'in_progress'
  if (variant === 'changes') return 'completed'
  return rows.some((row) => row.status === 'cancelled') ? 'stopped' : 'completed'
}

export interface AgentToolGroupItem {
  kind: 'row' | ToolGroupKind | 'agentToolCall'
  key: string
  rowId: number
  rows: ToolRowLike[]
  /** 仅分组项。 */
  stageStatus?: ToolGroupStageStatus
  /** 仅分组项：虚拟父节点展示名。 */
  groupTitle?: string
}

/** 单项不建组。出处：conversationAssistantWorkItems.ts:346-351 / :371-376 / :414-418。 */
export const TOOL_GROUP_MIN_ROWS = 2

export interface GroupToolRowsOptions {
  stageTailIsRunning?: boolean
  enableExploreGrouping?: boolean
  enableTerminalGrouping?: boolean
  enableChangesGrouping?: boolean
  showTodos?: boolean
  /** subagent 行：与 Agent 工具行配对后那条 subagent 行不再单独渲染。 */
  subagentRows?: readonly { rowId: number; turnId?: string; parentToolCallId?: string }[]
}

/**
 * 工具行 → 渲染项（buildAssistantWorkRenderItems 的工具部分，conversationAssistantWorkItems.ts:272-428）。
 * 顺序不可换：①剔除暂不可见行（:286-294）②Agent 行与 subagent 行配对（:295、:209-270）
 * ③todo 开关裁行（:2154-2159 同判据）④逐行贪心 Explore→Changes→Execute→普通行（:335-424）。
 * 输出只含 Agent 工具行与普通/分组项，不含 subagent 行本身（:317-320 跳过已配对的）。
 */
export function groupToolRows(
  rows: readonly ToolRowLike[],
  options: GroupToolRowsOptions = {},
): AgentToolGroupItem[] {
  const items: AgentToolGroupItem[] = []
  const overrides: ToolGroupingOverrides = {
    explore: options.enableExploreGrouping ?? TOOL_GROUPING_DEFAULTS.explore,
    terminal: options.enableTerminalGrouping ?? TOOL_GROUPING_DEFAULTS.terminal,
    changes: options.enableChangesGrouping ?? TOOL_GROUPING_DEFAULTS.changes,
  }
  const stageTailIsRunning = options.stageTailIsRunning === true
  const visibleRows = rows.filter((row) => !shouldDeferUnclassifiedShellToolRow(row))
  const grouped =
    options.showTodos === true ? visibleRows : visibleRows.filter((row) => !isTodoToolRow(row))
  // 只有配对成功的 Agent 行才成为 agentToolCall 项（:321-333）；未配对按普通工具行走下面分支。
  const { byAgentToolRowId } = pairAgentToolAndSubagentRows(
    grouped.filter((row) => isAgentToolRow(row)),
    options.subagentRows ?? [],
  )

  let index = 0
  while (index < grouped.length) {
    const row = grouped[index]!
    if (byAgentToolRowId.has(row.rowId)) {
      items.push({ kind: 'agentToolCall', key: `agent:${row.rowId}`, rowId: row.rowId, rows: [row] })
      index += 1
      continue
    }
    const grouping = toolGroupingFor(row, overrides)
    if (grouping === null) {
      items.push({ kind: 'row', key: `row:${row.rowId}`, rowId: row.rowId, rows: [row] })
      index += 1
      continue
    }
    const groupRows: ToolRowLike[] = [row]
    index += 1
    while (index < grouped.length) {
      const nextRow = grouped[index]!
      if (toolGroupingFor(nextRow, overrides) !== grouping) break
      groupRows.push(nextRow)
      index += 1
    }
    if (groupRows.length < TOOL_GROUP_MIN_ROWS) {
      items.push({ kind: 'row', key: `row:${row.rowId}`, rowId: row.rowId, rows: [row] })
      continue
    }
    const variant: 'explore' | 'execute' | 'changes' =
      grouping === 'exploreGroup' ? 'explore' : grouping === 'executeGroup' ? 'execute' : 'changes'
    // key 锚定首个真实 tool call，流式追加不重建组件。出处：:135-137 / :158-160 / :182-184。
    items.push({
      kind: grouping,
      key: `${variant}:${row.rowId}`,
      rowId: row.rowId,
      rows: groupRows,
      stageStatus: resolveGroupStageStatus(
        groupRows,
        stageTailIsRunning && index === grouped.length,
        variant,
      ),
      groupTitle:
        grouping === 'exploreGroup' ? 'Explore' : grouping === 'executeGroup' ? 'Execute' : 'Changes',
    })
  }
  return items
}

/**
 * Agent 工具行 ↔ subagent 行配对（pairSubagentRows，conversationAssistantWorkItems.ts:209-270）：
 * 先按 turnId + toolCallId === parentToolCallId 精确配对（:233-237）；缺 parentToolCallId 的
 * 历史数据仅当该 turn 恰好剩一对时才配（:259-267）。
 */
export function pairAgentToolAndSubagentRows(
  agentToolRows: readonly ToolRowLike[],
  subagentRows: readonly { rowId: number; turnId?: string; parentToolCallId?: string }[],
): { byAgentToolRowId: Map<number, number>; claimedSubagentRowIds: Set<number> } {
  const byAgentToolRowId = new Map<number, number>()
  const claimedSubagentRowIds = new Set<number>()
  const agentToolByTurnAndCallId = new Map<string, ToolRowLike>()
  for (const row of agentToolRows) {
    agentToolByTurnAndCallId.set(`${row.turnId ?? ''}\0${row.toolCallId ?? ''}`, row)
  }
  const legacySubagents: { rowId: number; turnId?: string; parentToolCallId?: string }[] = []
  for (const row of subagentRows) {
    if (!row.parentToolCallId) {
      legacySubagents.push(row)
      continue
    }
    const host = agentToolByTurnAndCallId.get(`${row.turnId ?? ''}\0${row.parentToolCallId}`)
    if (host && !byAgentToolRowId.has(host.rowId)) {
      byAgentToolRowId.set(host.rowId, row.rowId)
      claimedSubagentRowIds.add(row.rowId)
    }
  }
  const remainingAgentToolsByTurn = new Map<string, ToolRowLike[]>()
  for (const row of agentToolRows) {
    if (byAgentToolRowId.has(row.rowId)) continue
    const bucket = remainingAgentToolsByTurn.get(row.turnId ?? '')
    if (bucket) bucket.push(row)
    else remainingAgentToolsByTurn.set(row.turnId ?? '', [row])
  }
  const legacyByTurn = new Map<string, typeof legacySubagents>()
  for (const row of legacySubagents) {
    const bucket = legacyByTurn.get(row.turnId ?? '')
    if (bucket) bucket.push(row)
    else legacyByTurn.set(row.turnId ?? '', [row])
  }
  for (const [turnId, bucket] of legacyByTurn) {
    const toolRows = remainingAgentToolsByTurn.get(turnId)
    if (toolRows?.length !== 1 || bucket.length !== 1) continue
    byAgentToolRowId.set(toolRows[0]!.rowId, bucket[0]!.rowId)
    claimedSubagentRowIds.add(bucket[0]!.rowId)
  }
  return { byAgentToolRowId, claimedSubagentRowIds }
}

// ── 9. 分类与渲染描述 ───────────────────────────────────────────────────────

/** 分类输入：既接受 ZCode 线协议 kind，也接受本仓转写/消息形状。 */
export interface ConversationRecordLike {
  kind?: string
  /** 本仓 AgentChatMessage.role（src/agentSession.ts:17）。 */
  role?: string
  /** 本仓 AgentTranscriptEntry.kind（src/agent.ts:132）。 */
  transcriptKind?: string
  text?: string
  toolName?: string
  /** ZCode toolCall.status（rows.ts:198）。 */
  status?: string
  /** ZCode timelineMarker.marker.type（rows.ts:332-392）。 */
  markerType?: string
}

export interface ClassifiedRow {
  kind: ZcodeRowKind
  role: TrajectoryVisualRole | null
  styleKey: string | null
  icon: string | null
  collapsible: boolean
  actions: AgentRowAction[]
  view: string
  /** 本仓形状在 9 种行类型里没有对应物时的说明（不猜）。 */
  unmappedReason?: string
}

/**
 * 分类一条记录。判据顺序：①显式 kind 命中 9 种（rows.ts:420-430；分发 ConversationRowView.tsx:2113-2167）
 * ②role user→userInput、assistant→assistantText（src/agentSession.ts:17）
 * ③transcriptKind tool→toolCall、error→toolCall（src/agent.ts:132；ZCode 无 error 行类型）
 * ④其余（approval/note）无对应行类型，返回 unmappedReason。
 */
export function classifyConversationRow(record: ConversationRecordLike): ClassifiedRow {
  const kind = resolveRowKind(record)
  if (kind === null) {
    return {
      kind: 'toolCall',
      role: null,
      styleKey: null,
      icon: null,
      collapsible: false,
      actions: [],
      view: ROW_VIEW_ANCHORS.toolCall.component,
      unmappedReason: `本仓记录形状（role=${record.role ?? '-'} / kind=${record.kind ?? '-'} / transcriptKind=${record.transcriptKind ?? '-'}）在 ZCode 的 9 种行类型里没有对应物`,
    }
  }
  const role = trajectoryRoleForRowKind(kind)
  return {
    kind,
    role,
    styleKey: role === null ? null : trajectoryRoleTextClass(role),
    icon: rowIconFor(kind, record),
    collapsible: isCollapsibleRow(kind),
    actions: rowActionsForKind(kind, { markerType: record.markerType }),
    view: ROW_VIEW_ANCHORS[kind].component,
  }
}

function resolveRowKind(record: ConversationRecordLike): ZcodeRowKind | null {
  if (isZcodeRowKind(record.kind)) return record.kind
  if (record.role === 'user') return 'userInput'
  if (record.role === 'assistant') return 'assistantText'
  if (record.role === 'system') return 'turnHeader'
  if (record.transcriptKind === 'user') return 'userInput'
  if (record.transcriptKind === 'assistant') return 'assistantText'
  if (record.transcriptKind === 'tool') return 'toolCall'
  if (record.transcriptKind === 'error') return 'toolCall'
  return null
}

function rowIconFor(kind: ZcodeRowKind, record: ConversationRecordLike): string | null {
  if (kind === 'artifact') return ROW_LUCIDE_ICONS.artifact
  if (kind === 'reasoning') return LEAF_LUCIDE_ICONS.reasoning
  if (kind === 'timelineMarker') {
    return record.markerType === undefined ? null : markerIconName(record.markerType)
  }
  return null
}

// ── 10. timelineMarker 分流 ─────────────────────────────────────────────────

/**
 * marker 类型 → 渲染结果。出处：ConversationRowView.tsx:1743-1747 注释 ——
 * compact/forkNotice/goalVerify/modelChange 画分隔线；goalSet/forkCreated 已在投影层停产；
 * retryNotice/checkpointRestored 无 UI；default 兜底不渲染（:1853-1854、:1868-1870）。
 */
export function markerRenderDecision(markerType: string): {
  renders: boolean
  icon: string | null
  labelKey: string | null
  runningCapable: boolean
} {
  switch (markerType) {
    case 'compact':
      return { renders: true, icon: markerIconName('compact'), labelKey: 'chat.contextCompaction.completed', runningCapable: true }
    case 'forkNotice':
      return { renders: true, icon: markerIconName('forkNotice'), labelKey: 'chat.message.fork.derivedFrom', runningCapable: false }
    case 'modelChange':
      return { renders: true, icon: markerIconName('modelChange'), labelKey: 'chat.modelChange.switched', runningCapable: false }
    case 'goalVerify':
      return { renders: true, icon: markerIconName('goalVerify'), labelKey: 'chat.goalVerification.checking', runningCapable: true }
    default:
      return { renders: false, icon: null, labelKey: null, runningCapable: false }
  }
}

/** compact 文案键。出处：ConversationRowView.tsx:1766-1787。 */
export function compactMarkerLabelKey(status: string, origin: string, isOfficeMode = false): string {
  const scope =
    isOfficeMode && origin === 'auto' ? 'chat.contextOptimization' : 'chat.contextCompaction'
  const statusMessage =
    status === 'running' ? 'started'
      : status === 'noop' ? 'skipped'
        : status === 'cancelled' ? 'interrupted'
          : status === 'failed' ? 'failed'
            : origin === 'auto' && !isOfficeMode ? 'completedAuto' : 'completed'
  return `${scope}.${statusMessage}`
}

/** 出处：ConversationRowView.tsx:1826-1835。 */
export function goalVerifyLabelKey(outcome: string): string {
  if (outcome === 'running') return 'chat.goalVerification.checking'
  if (outcome === 'pass') return 'chat.goalVerification.complete'
  return 'chat.goalVerification.incomplete'
}

/** 出处：ConversationRowView.tsx:1794-1824（无来源 = 首次使用模型，走 using 且不显示切换箭头）。 */
export function modelChangeLabelKey(hasFromSource: boolean): string {
  return hasFromSource ? 'chat.modelChange.switched' : 'chat.modelChange.using'
}

// ── 11. 无法核实 ────────────────────────────────────────────────────────────

/** 指不到出处的项，不做实现。 */
export const UNVERIFIED = [
  'hookInvocation 的行级角色/样式：ConversationRowView 的 switch 不渲染它（:2165-2166 落 default），只有 ConversationHookDetailsAction 一个入口（:1465-1467），行级角色无从取。',
  'artifact / subagent / turnHeader / timelineMarker 的轨迹角色：ModelTrajectory 面板无对应行，trajectoryRoleForRowKind 对它们返回 null。',
  'toolCall 行最终是 tool-call 还是 tool-result：v4 行是单卡（输入+输出同卡），没有拆两行的规则；区分只在 ModelTrajectory 的 part 级（ExpandableMessage.tsx:66-74）。',
  'toolCall 行的展开/收起默认值：由 ToolCallBlock 的 renderer 决定，不在 ConversationRowView 里。',
  'subagent 行与 Agent 工具行配对后的下钻入口：ConversationAgentToolCallRow.tsx:63-72 走 context.onOpenSubagentSession，行模型不持该能力。',
] as const
