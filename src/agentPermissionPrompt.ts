// Agent 审批对话框的**纯逻辑**（零 Vue）：审批请求的形状、选项集合、决策结果。
//
// 「该不该问」由 `src/agent.ts` 的 `decidePermission` / `AgentPermissionSettings` 决定（单一真源）；
// 本模块只管「怎么问」—— 分类、选项、文案、反馈行。出处全部在 `.tools/ZCode`：
//   ui/src/PermissionDialog.tsx            对话框主体、选项集合、分类、反馈行
//   ui/src/lib/permissionRequest.ts        display kind、排序、name 优先
//   ui/src/lib/toolIdentity.ts             tool family
//   ui/src/lib/workflowToolNames.ts        SaveWorkflow 按名判定
//   shared/src/permission-request-preview.ts  scope / command / file paths / fileChanges
//   shared/src/tool-identity.ts            ZCODE_KNOWN_TOOL_NAMES / family 表
//   shared/src/zcode-protocol-v4/snapshot.ts  常量 + payload schema
//   shared/src/zcode-protocol-legacy-types.ts Refine / CUA 常量、origin
//   shared/src/zcode-task-types-core.ts    ZCodePermissionRequest / Option
//   ui/src/SaveWorkflowPermissionBlock.tsx 保存确认窗
//   ui/src/ToolCallBlocks/renderers/save-workflow.tsx 保存入参归一
//   ui/src/cua-permission/CuaPermissionObservationAttachment.tsx 电脑操控授权
//   ui/src/i18n/locales/zh-CN.ts           全部文案
// ── 常量（wire 值 / 上限） ───────────────────────────────────────────
export const AGENT_PERMISSION_FULL_ACCESS_OPTION_ID = 'fullAccess' // snapshot.ts:229
export const AGENT_PERMISSION_WORKFLOW_REFINE_OPTION_ID = 'workflowRefine' // legacy-types.ts:51
/** legacy-types.ts:45。 */
export const AGENT_PERMISSION_OFFICIAL_CUA_RULE_TOOL_NAME = 'zcode:permission-capability:official_cua'
export const AGENT_PERMISSION_MAX_FEEDBACK_CHARS = 4096 // snapshot.ts:227
export const AGENT_PERMISSION_RULE_SCOPE_MAX_DISPLAY_CHARS = 160 // PermissionDialog.tsx:74
export const AGENT_PERMISSION_MAX_FILE_PATHS = 6 // permission-request-preview.ts:37
/** PermissionDialog.tsx:75-78（NON_USER_FACING_PERMISSION_REASONS）。 */
export const AGENT_PERMISSION_NON_USER_FACING_REASONS: readonly string[] = [
  'High risk tools require explicit approval',
  'Tool has side effects and requires approval',
]
const COMMAND_KEYS = new Set(['command', 'cmd', 'script', 'shellcommand']) // preview.ts:19
const ARGUMENT_KEYS = new Set(['args', 'argv', 'arguments']) // preview.ts:20
/** preview.ts:21-35。 */
const FILE_PATH_KEYS = new Set([
  'path', 'paths', 'file', 'file_path', 'filepath', 'files', 'filename',
  'filenames', 'target', 'targets', 'location', 'locations',
])
const IGNORED_DIRECTORY_KEYS = new Set(['cwd', 'directory', 'workingdirectory']) // preview.ts:36
// ── 类型（协议形状） ─────────────────────────────────────────────────
/** permissionRequest.ts:11-16（PermissionOptionDisplayKind）。 */
export type AgentPermissionOptionDisplayKind =
  | 'allowOnce' | 'allowAlways' | 'rejectOnce' | 'rejectAlways' | 'custom'
export type AgentPermissionScope = 'command' | 'file' | 'generic' // preview.ts:3
/** PermissionDialog.tsx:54-62（PermissionBlockKind）。 */
export type AgentPermissionBlockKind =
  | 'edit' | 'execute' | 'mcp' | 'search' | 'skill' | 'workflow' | 'saveWorkflow' | 'fallback'

/** legacy-types.ts:52-60（zcodePermissionUpdateSchema）。 */
export interface AgentPermissionUpdate {
  type: 'addRules'
  behavior: 'allow' | 'deny' | 'ask'
  rules: Array<{ toolName: string; ruleContent?: string }>
}
/** zcode-task-types-core.ts:643-649（ZCodePermissionOption）。 */
export interface AgentPermissionOption {
  optionId: string
  kind: string
  name: string
  description?: string
  /** PermissionDialog.tsx:95（option.response?.permissionUpdates）。 */
  permissionUpdates?: AgentPermissionUpdate[]
}
/** zcode-task-types-core.ts:613-631（ZCodePermissionRequest）。 */
export interface AgentPermissionRequest {
  requestId: string
  /** 工具名（PermissionDialog.tsx:347：request.kind）。 */
  kind: string
  title?: string
  description: string
  options: AgentPermissionOption[]
  /** zcode-task-types-core.ts:623-624：Deny 时是否允许附用户反馈。 */
  freeText?: boolean
  /** legacy-types.ts:154-166（zcodeInteractionRequestOriginSchema）。 */
  origin?: { kind: 'subagent'; agentId: string; agentType: string; childSessionId: string }
  raw: unknown
}
/** V4InteractionDialogs.tsx:334-349（onRespond 的应答载荷）。 */
export interface AgentPermissionDecision { optionId: string; kind: string; feedback?: string }
/** PermissionDialog.tsx:64-67（PermissionBlockInteraction）。 */
export interface AgentPermissionBlockInteraction { canToggle: boolean; forceOpen: boolean }
/** PermissionDialog.tsx:69-72（PermissionRuleScope）。 */
export interface AgentPermissionRuleScope { display: string; truncated: boolean }
/** save-workflow.tsx:32-40（WorkflowArgDeclaration）。 */
export interface AgentWorkflowArgDeclaration {
  name: string
  type: string | undefined
  description: string | undefined
  required: boolean
  /** `default: false` 与「没有默认值」必须可分辨（save-workflow.tsx:37-38）。 */
  hasDefault: boolean
  defaultValue: unknown
}
/** save-workflow.tsx:49-60（SaveWorkflowInput）。 */
export interface AgentSaveWorkflowInput {
  name: string | undefined
  description: string | undefined
  whenToUse: string | undefined
  path: string | undefined
  scope: string | undefined
  shadowing: 'hides_global' | 'hidden_by_project' | undefined
  overwrite: boolean
  script: string | undefined
  args: AgentWorkflowArgDeclaration[]
}
/** PermissionDialog.tsx:452-514 的行模型：按钮行 + 反馈行。 */
export interface AgentPermissionRow {
  /** 渲染序号（PermissionDialog.tsx:811 / 849：index + 1）。 */
  index: number
  kind: 'option' | 'feedback'
  /** 反馈行的应答目标（PermissionDialog.tsx:511）。 */
  option?: AgentPermissionOption
  /** 选项行 = 本地化标签；反馈行 = null（行内是输入框）。 */
  label: string | null
  description: string | null
  /** PermissionDialog.tsx:782（data-permission-option-kind）。 */
  displayKind: AgentPermissionOptionDisplayKind | null
}
// ── 文案（zh-CN 原文） ───────────────────────────────────────────────
export const AGENT_PERMISSION_TEXTS = {
  // zh-CN.ts:5532-5550
  title: '需要权限', awaitingApproval: '等待确认', approve: '允许',
  approveAlways: '始终允许', allowForSession: '允许本会话',
  responseFailed: '审批未完成，请重试。',
  fullAccess: '完全访问', fullAccessDescription: '授予 Agent 完全访问权限，不再确认。',
  allowCommand: '始终允许此命令', allowCommandDescription: '项目范围内，后续相同命令不再询问',
  allowForProject: '始终允许本项目', cuaAllowForProject: '始终允许本项目中的电脑控制',
  cuaAllowForProjectDescription: '本项目后续官方电脑控制操作不再询问',
  deny: '拒绝', denyAlways: '始终拒绝',
  files: '涉及文件', keyboardHint: '使用 Tab / 上下键选择，回车确认',
  scopeCommandPrefix: '命令前缀', scopeExactCommand: '仅此命令',
  // zh-CN.ts:5551-5558
  workflowTitle: '运行此工作流？', workflowShowScript: '显示完整脚本',
  workflowHideScript: '收起完整脚本', workflowRefine: '提出修改',
  workflowRefinePlaceholder: '描述这个工作流应该怎么改…',
  workflowAllowForSession: '本会话内始终允许',
  workflowAllowForSessionDescription: '本会话内运行工作流不再询问',
  // zh-CN.ts:5580-5593
  workflowSaveTitle: '把这个工作流保存到项目里？',
  workflowSaveOverwriteTitle: '覆盖已保存的同名工作流？',
  workflowSaveOverwriteHint: '该路径下已存在同名工作流，保存会整体替换这个文件。',
  workflowSavePath: '落点', workflowSaveDescription: '说明',
  workflowSaveWhenToUse: '何时使用', workflowSaveArgs: '参数',
  workflowSaveArgsName: '参数名', workflowSaveArgsType: '类型',
  workflowSaveArgsRequired: '必填', workflowSaveArgsRequiredYes: '必填',
  workflowSaveArgsRequiredNo: '可选', workflowSaveArgsDefault: '默认值',
  // zh-CN.ts:5626-5638
  allowOnceDescription: '仅允许这一次',
  allowAlwaysDescriptionCommand: '后续相同命令不再询问',
  allowAlwaysDescriptionFile: '后续相同文件操作不再询问',
  allowAlwaysDescriptionGeneric: '后续相同权限请求不再询问',
  denyOnceDescription: '这次先拒绝',
  denyAlwaysDescriptionCommand: '后续相同命令也会直接拒绝',
  denyAlwaysDescriptionFile: '后续相同文件操作也会直接拒绝',
  denyAlwaysDescriptionGeneric: '后续相同权限请求也会直接拒绝',
  fileChangeAdd: '创建', fileChangeUpdate: '编辑',
  fileChangeAddMany: '创建 {count} 个文件', fileChangeUpdateMany: '编辑 {count} 个文件',
  fileChangeMixedMany: '更新 {count} 个文件',
  // zh-CN.ts:5594-5595, 5669, 148-149, 175, 4712, 4825, 6441-6444
  switchModePlaceholder: '实施计划',
  interactionOriginSubagent: '子智能体',
  interactionOriginSubagentTitle: '来自子智能体：{agentType}',
  feedbackAriaLabel: '拒绝时给模型的可选反馈',
  feedbackPlaceholder: '告诉模型接下来应该怎么做...',
  confirm: '确认', workflowFallbackName: '工作流脚本', workflowSaveOverwriteBadge: '覆盖',
  cuaLiveTitle: '电脑操作需要 macOS 权限',
  cuaLiveDescription: '正在运行的电脑操作任务需要 macOS 权限，是否前往授权？',
  cuaLiveConfirm: '前往授权', cuaLiveCancel: '暂不授权',
} as const

/** PermissionDialog.tsx:178-191（GLOBAL_PERMISSION_OPTION_NAME_LABELS，name 归一后为键）。 */
export const AGENT_PERMISSION_OPTION_NAME_LABELS: Readonly<Record<string, string>> = {
  'full access': 'chat.permission.fullAccess',
  'always allow in this project': 'chat.permission.allowForProject',
  'always allow computer use in this project': 'chat.permission.cua.allowForProject',
  'always allow in this session': 'chat.permission.workflow.allowForSession',
}
/** PermissionDialog.tsx:162-170（PROVIDER_PERMISSION_OPTION_NAME_LABELS）。 */
export const AGENT_PERMISSION_PROVIDER_OPTION_NAME_LABELS:
Readonly<Record<string, Record<string, string>>> = {
  glm: { 'always allow in this project': 'chat.permission.allowForProject' },
}
/** permissionRequest.ts:18-24（GENERIC_PERMISSION_OPTION_NAMES）。 */
const GENERIC_OPTION_NAMES: Readonly<Record<AgentPermissionOptionDisplayKind, readonly string[]>> = {
  allowOnce: ['allow', 'allow once', 'approve'],
  allowAlways: ['always allow', 'allow always', 'approve always'],
  rejectOnce: ['deny', 'deny once', 'reject', 'reject once'],
  rejectAlways: ['always deny', 'deny always', 'always reject', 'reject always'],
  custom: [],
}
// ── 文本归一 ────────────────────────────────────────────────────────
export function normalizeAgentPermissionInlineText(value: string): string { // permissionRequest.ts:26-28
  return value.trim().replace(/\s+/g, ' ')
}
export function normalizeAgentPermissionBlockText(value: string): string { // preview.ts:47-49
  return value.trim().replace(/\r\n/g, '\n')
}
export function readAgentPermissionNonEmptyString(value: unknown): string | null { // PermissionDialog.tsx:223-225
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null
}
/** PermissionDialog.tsx:227-232（readUserFacingPermissionReason）。 */
export function readAgentPermissionUserFacingReason(value: unknown): string | null {
  const reason = readAgentPermissionNonEmptyString(value)
  if (reason === null) return null
  return AGENT_PERMISSION_NON_USER_FACING_REASONS.includes(reason) ? null : reason
}
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
// ── 选项分类（permissionRequest.ts:30-106） ──────────────────────────
/** permissionRequest.ts:30-53（getPermissionOptionDisplayKind）。 */
export function getAgentPermissionOptionDisplayKind(kind: string): AgentPermissionOptionDisplayKind {
  const normalized = kind.trim().toLowerCase()
  const isAllow = normalized.includes('allow') || normalized.includes('approve')
  const isReject = normalized.includes('reject') || normalized.includes('deny')
  const isAlways = normalized.includes('always')
  if (isAllow && isAlways) return 'allowAlways'
  if (isAllow) return 'allowOnce'
  if (isReject && isAlways) return 'rejectAlways'
  if (isReject) return 'rejectOnce'
  return 'custom'
}
/** permissionRequest.ts:55-69（shouldPreferPermissionOptionName）。 */
export function shouldPreferAgentPermissionOptionName(
  option: Pick<AgentPermissionOption, 'kind' | 'name'>,
): boolean {
  const normalizedName = normalizeAgentPermissionInlineText(option.name).toLowerCase()
  if (normalizedName.length === 0) return false
  const displayKind = getAgentPermissionOptionDisplayKind(option.kind)
  if (displayKind === 'custom') return true
  return !GENERIC_OPTION_NAMES[displayKind].includes(normalizedName)
}
/** permissionRequest.ts:71-84（getPermissionOptionSortPriority）。 */
export function getAgentPermissionOptionSortPriority(kind: string): number {
  switch (getAgentPermissionOptionDisplayKind(kind)) {
    case 'allowOnce': return 0
    case 'allowAlways': return 1
    case 'rejectOnce': return 2
    case 'rejectAlways': return 3
    default: return 4
  }
}
/** permissionRequest.ts:86-106（sortPermissionOptions）；fullAccess 落 1.5。 */
export function sortAgentPermissionOptions(
  options: readonly AgentPermissionOption[],
): AgentPermissionOption[] {
  const priority = (option: AgentPermissionOption): number =>
    option.optionId === AGENT_PERMISSION_FULL_ACCESS_OPTION_ID
      ? 1.5 : getAgentPermissionOptionSortPriority(option.kind)
  return options
    .map((option, index) => ({ option, index }))
    .sort((left, right) =>
      priority(left.option) - priority(right.option) || left.index - right.index)
    .map(({ option }) => option)
}
/** PermissionDialog.tsx:121-123（isWorkflowRefineOption，按稳定 optionId）。 */
export function isAgentWorkflowRefineOption(option: Pick<AgentPermissionOption, 'optionId'>): boolean {
  return option.optionId === AGENT_PERMISSION_WORKFLOW_REFINE_OPTION_ID
}
/** PermissionDialog.tsx:107-114（isOfficialCuaProjectPermission）。 */
export function isAgentOfficialCuaProjectOption(option: AgentPermissionOption): boolean {
  return (option.permissionUpdates ?? []).some((update) =>
    update.type === 'addRules' && update.behavior === 'allow' &&
    update.rules.some((rule) => rule.toolName === AGENT_PERMISSION_OFFICIAL_CUA_RULE_TOOL_NAME))
}
/** PermissionDialog.tsx:80-91（formatPermissionRuleScope）。 */
export function formatAgentPermissionRuleScope(content: string): AgentPermissionRuleScope {
  const lineBreakIndex = content.search(/\r?\n/)
  const firstLine = lineBreakIndex === -1 ? content : content.slice(0, lineBreakIndex)
  const truncated =
    lineBreakIndex !== -1 || firstLine.length > AGENT_PERMISSION_RULE_SCOPE_MAX_DISPLAY_CHARS
  const suffix = ' …'
  const visible = firstLine
    .slice(0, AGENT_PERMISSION_RULE_SCOPE_MAX_DISPLAY_CHARS - suffix.length).trimEnd()
  return { display: `${visible}${suffix}`, truncated }
}
/** PermissionDialog.tsx:93-105（readPermissionRuleScopes）：只认 bash + `:*` 前缀，最多 5 条。 */
export function readAgentPermissionRuleScopes(
  option: AgentPermissionOption,
): AgentPermissionRuleScope[] {
  const scopes: AgentPermissionRuleScope[] = []
  for (const update of option.permissionUpdates ?? []) {
    if (update.type !== 'addRules' || update.behavior !== 'allow') continue
    for (const rule of update.rules) {
      if (rule.toolName.toLowerCase() !== 'bash') continue
      const content = rule.ruleContent?.trim()
      if (content === undefined || !content.endsWith(':*')) continue
      scopes.push(formatAgentPermissionRuleScope(content.slice(0, -2)))
    }
  }
  return scopes.slice(0, 5)
}
// ── 请求分类：scope / command / 文件（permission-request-preview.ts） ──
/** preview.ts:71-83（readPermissionInputSource）。 */
function readPermissionInputSource(rawSource: unknown): unknown {
  if (!isRecord(rawSource)) return rawSource
  if ('rawInput' in rawSource && rawSource.rawInput !== undefined) return rawSource.rawInput
  return 'input' in rawSource ? rawSource.input : rawSource
}
/** preview.ts:51-69（getStringArray）。 */
function getStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return value.map((item) => {
    if (typeof item === 'string') return item.trim()
    if (typeof item === 'number' || typeof item === 'boolean' || typeof item === 'bigint') {
      return String(item)
    }
    return ''
  }).filter((item) => item.length > 0)
}
/** preview.ts:85-111（getCommandFromRecord）。 */
function getCommandFromRecord(record: Record<string, unknown>): string | null {
  for (const [key, value] of Object.entries(record)) {
    if (!COMMAND_KEYS.has(key.toLowerCase()) || typeof value !== 'string') continue
    const command = normalizeAgentPermissionBlockText(value)
    if (command.length === 0) continue
    for (const [argsKey, argsValue] of Object.entries(record)) {
      if (!ARGUMENT_KEYS.has(argsKey.toLowerCase())) continue
      const args = getStringArray(argsValue)
      if (args.length > 0) return `${command} ${args.join(' ')}`
    }
    return command
  }
  return null
}
/** preview.ts:113-179（findFirstCommand）。 */
function findFirstCommand(
  value: unknown,
  seen: Set<unknown> = new Set(),
  allowBareString = false,
): string | null {
  if (typeof value === 'string') {
    if (!allowBareString) return null
    const command = normalizeAgentPermissionBlockText(value)
    return command.length > 0 ? command : null
  }
  if (Array.isArray(value)) {
    if (seen.has(value)) return null
    seen.add(value)
    for (const item of value) {
      const nested = findFirstCommand(item, seen)
      if (nested !== null) return nested
    }
    return null
  }
  if (!isRecord(value) || seen.has(value)) return null
  seen.add(value)
  const direct = getCommandFromRecord(value)
  if (direct !== null) return direct
  for (const key of ['rawInput', 'input', 'params', 'toolCall'] as const) {
    if (!(key in value)) continue
    const nested = findFirstCommand(
      value[key], seen, key === 'rawInput' || key === 'input' || key === 'params')
    if (nested !== null) return nested
  }
  for (const nestedValue of Object.values(value)) {
    if (!Array.isArray(nestedValue) && !isRecord(nestedValue)) continue
    const nested = findFirstCommand(nestedValue, seen)
    if (nested !== null) return nested
  }
  return null
}
/** preview.ts:181-188（pushUniquePath）。 */
function pushUniquePath(paths: string[], value: string): void {
  const normalizedPath = normalizeAgentPermissionInlineText(value)
  if (normalizedPath.length === 0 || paths.includes(normalizedPath)) return
  paths.push(normalizedPath)
}
/** preview.ts:190-284（extractPathsFromCandidate + collectFilePaths 合一）。 */
function collectFilePaths(
  value: unknown,
  paths: string[],
  seen: Set<unknown> = new Set(),
  extracting = false,
): void {
  if (paths.length >= AGENT_PERMISSION_MAX_FILE_PATHS) return
  if (typeof value === 'string') {
    if (extracting) pushUniquePath(paths, value)
    return
  }
  if (Array.isArray(value)) {
    if (seen.has(value)) return
    seen.add(value)
    for (const item of value) {
      collectFilePaths(item, paths, seen, extracting)
      if (paths.length >= AGENT_PERMISSION_MAX_FILE_PATHS) return
    }
    return
  }
  if (!isRecord(value) || seen.has(value)) return
  seen.add(value)
  if (extracting && typeof value.path === 'string') {
    pushUniquePath(paths, value.path)
    if (paths.length >= AGENT_PERMISSION_MAX_FILE_PATHS) return
  }
  for (const [key, candidate] of Object.entries(value)) {
    // preview.ts:263-265：cwd / directory 这类不是目标文件。
    if (!extracting && IGNORED_DIRECTORY_KEYS.has(key.toLowerCase())) continue
    // preview.ts:267-273：命中 FILE_PATH_KEYS 后转入「抽字符串」模式。
    const nextExtracting = extracting || FILE_PATH_KEYS.has(key.toLowerCase())
    if (!nextExtracting && !Array.isArray(candidate) && !isRecord(candidate)) continue
    collectFilePaths(candidate, paths, seen, nextExtracting)
    if (paths.length >= AGENT_PERMISSION_MAX_FILE_PATHS) return
  }
}
/** preview.ts:286-336（collectFileChanges）。 */
function collectFileChanges(
  value: unknown,
  changes: Array<{ path: string; type: 'add' | 'update' }>,
  seen: Set<unknown> = new Set(),
): void {
  if (Array.isArray(value)) {
    if (seen.has(value)) return
    seen.add(value)
    for (const item of value) collectFileChanges(item, changes, seen)
    return
  }
  if (!isRecord(value) || seen.has(value)) return
  seen.add(value)
  if (isRecord(value.changes)) {
    for (const [path, change] of Object.entries(value.changes)) {
      if (!isRecord(change)) continue
      if (change.type !== 'add' && change.type !== 'update') continue
      if (changes.some((item) => item.path === path && item.type === change.type)) continue
      changes.push({ path, type: change.type })
    }
  }
  for (const nestedValue of Object.values(value)) {
    if (!Array.isArray(nestedValue) && !isRecord(nestedValue)) continue
    collectFileChanges(nestedValue, changes, seen)
  }
}
/** preview.ts:286-336 的对外形状。 */
export function readAgentPermissionFileChanges(
  raw: unknown,
): Array<{ path: string; type: 'add' | 'update' }> {
  const changes: Array<{ path: string; type: 'add' | 'update' }> = []
  collectFileChanges(raw, changes)
  return changes
}
/** preview.ts:235-284 的对外形状。 */
export function readAgentPermissionFilePaths(raw: unknown): string[] {
  const paths: string[] = []
  collectFilePaths(raw, paths)
  return paths
}
/** preview.ts:338-366（getPermissionRequestPreview 的 scope 部分）。 */
export function readAgentPermissionScope(
  request: Pick<AgentPermissionRequest, 'raw'>,
): AgentPermissionScope {
  const paths: string[] = []
  collectFilePaths(request.raw, paths)
  const command = findFirstCommand(readPermissionInputSource(request.raw), new Set(), true)
  return command !== null ? 'command' : paths.length > 0 ? 'file' : 'generic'
}
/** PermissionDialog.tsx:234-246（getPermissionDisplayReason）。 */
export function readAgentPermissionDisplayReason(request: AgentPermissionRequest): string | null {
  const rawInput = readPermissionInputSource(request.raw)
  const inputReason = isRecord(rawInput)
    ? (readAgentPermissionUserFacingReason(rawInput.description) ??
       readAgentPermissionUserFacingReason(rawInput.reason) ??
       readAgentPermissionUserFacingReason(rawInput.summary))
    : null
  const rawReason = isRecord(request.raw)
    ? readAgentPermissionUserFacingReason(request.raw.reason)
    : null
  return inputReason ?? readAgentPermissionUserFacingReason(request.description) ?? rawReason
}
// ── 工具身份 / block kind ───────────────────────────────────────────
/** workflowToolNames.ts:21-25（normalizeToolToken）。 */
function normalizeToolToken(value: unknown): string {
  return typeof value === 'string' ? value.toLowerCase().replace(/[^a-z0-9]/gu, '') : ''
}
/** workflowToolNames.ts:34-45（matchesToolName / isSaveWorkflowToolCall）。 */
export function isAgentSaveWorkflowToolCall(
  source: { toolName?: string | null; kind?: string | null; title?: string | null; raw?: unknown },
): boolean {
  const rawNames = isRecord(source.raw)
    ? [source.raw.toolName, source.raw.tool_name, source.raw.name] : []
  return [source.toolName, source.kind, source.title, ...rawNames]
    .some((value) => normalizeToolToken(value) === 'saveworkflow')
}
/** tool-identity.ts:41-92（ZCodeToolFamily / TOOL_FAMILY_BY_NAME）。 */
const TOOL_FAMILY_BY_NAME: Readonly<Record<string, string>> = {
  read: 'file-read', write: 'file-write', edit: 'file-write', applypatch: 'file-write',
  bash: 'shell', glob: 'search', grep: 'search', webfetch: 'search', websearch: 'search',
  web_search: 'search', todoread: 'todo', todowrite: 'todo', goalread: 'goal',
  readsessioncontext: 'session-context', askuserquestion: 'ask-user-question',
  sendmessage: 'message', respondtocoordinator: 'message', taskoutput: 'task-control',
  taskstop: 'task-control', js: 'node-repl', js_reset: 'node-repl',
  js_add_node_module_dir: 'node-repl', mcp__node_repl__js: 'node-repl',
  mcp__node_repl__js_reset: 'node-repl', mcp__node_repl__js_add_node_module_dir: 'node-repl',
  agent: 'agent', task: 'agent', skill: 'skill', createworkflow: 'workflow',
  amendworkflow: 'workflow', submit_result: 'workflow',
}
/** tool-identity.ts:98-114（normalizeZCodeToolName / getZCodeToolFamilyForName）。 */
export function getAgentPermissionToolFamily(toolName: string | null | undefined): string | null {
  const normalized = toolName?.trim().toLowerCase()
  if (normalized === undefined || normalized.length === 0) return null
  return TOOL_FAMILY_BY_NAME[normalized] ?? null
}
/** PermissionDialog.tsx:248-259（getMcpPermissionToolName）。 */
export function getAgentMcpPermissionToolName(
  source: { toolName?: string | null; kind?: string | null; title?: string | null; raw?: unknown },
): string | null {
  const rawToolName = isRecord(source.raw)
    ? (readAgentPermissionNonEmptyString(source.raw.toolName) ??
       readAgentPermissionNonEmptyString(source.raw.tool_name))
    : null
  const toolName = readAgentPermissionNonEmptyString(source.toolName) ?? rawToolName ??
    readAgentPermissionNonEmptyString(source.kind) ?? readAgentPermissionNonEmptyString(source.title)
  return toolName !== null && toolName.startsWith('mcp__') ? toolName : null
}
/** PermissionDialog.tsx:265-312（resolvePermissionBlockKind）。 */
export function resolveAgentPermissionBlockKind(
  request: AgentPermissionRequest,
  fileChanges: readonly { path: string; type: 'add' | 'update' }[] =
    readAgentPermissionFileChanges(request.raw),
): AgentPermissionBlockKind {
  // PermissionDialog.tsx:273-275：SaveWorkflow 按工具名最先判定，早于文件摘要与 family 分流。
  if (isAgentSaveWorkflowToolCall({ kind: request.kind, title: request.title, raw: request.raw })) {
    return 'saveWorkflow'
  }
  // PermissionDialog.tsx:277-279：文件摘要 / 文件变更 → edit。
  if (fileChanges.length > 0) return 'edit'
  // PermissionDialog.tsx:283-287：mcp__ 前缀 → mcp（避免 raw JSON 兜底）。
  if (getAgentMcpPermissionToolName(
    { kind: request.kind, title: request.title, raw: request.raw }) !== null) {
    return 'mcp'
  }
  const family = getAgentPermissionToolFamily(request.kind)
  // PermissionDialog.tsx:291-305：skill / workflow / search family 各自分流。
  if (family === 'skill') return 'skill'
  if (family === 'workflow') return 'workflow'
  if (family === 'search') return 'search'
  // PermissionDialog.tsx:307-309：有 command → execute；311：兜底 fallback。
  if (findFirstCommand(readPermissionInputSource(request.raw), new Set(), true) !== null) {
    return 'execute'
  }
  return 'fallback'
}
/** PermissionDialog.tsx:314-336（getPermissionBlockInteraction）：权限块一律不可折叠。 */
export function getAgentPermissionBlockInteraction(
  blockKind: AgentPermissionBlockKind,
): AgentPermissionBlockInteraction {
  if (blockKind === 'edit') return { canToggle: false, forceOpen: false }
  return { canToggle: false, forceOpen: true }
}
/** PermissionDialog.tsx:687（switch-mode family → 占位符，不渲染 displayReason）。 */
export function isAgentSwitchModePermissionRequest(request: AgentPermissionRequest): boolean {
  const tokens = [request.kind, request.title, isRecord(request.raw) ? request.raw.toolName : null]
    .filter((value): value is string => typeof value === 'string')
    .map((value) => value.trim().toLowerCase().replace(/[\s-]+/g, '_'))
  return tokens.some((token) => [
    'switch_mode', 'switchmode', 'exited_plan_mode', 'exitedplanmode',
    'exit_plan_mode', 'exitplanmode',
  ].includes(token))
}
// ── 选项标签 / 描述 ─────────────────────────────────────────────────
/** PermissionDialog.tsx:147-160（getOptionLabelMessageId）。 */
function getAgentPermissionOptionLabelText(option: AgentPermissionOption): string | null {
  switch (getAgentPermissionOptionDisplayKind(option.kind)) {
    case 'allowOnce': return AGENT_PERMISSION_TEXTS.approve
    case 'allowAlways': return AGENT_PERMISSION_TEXTS.approveAlways
    case 'rejectOnce': return AGENT_PERMISSION_TEXTS.deny
    case 'rejectAlways': return AGENT_PERMISSION_TEXTS.denyAlways
    default: return null
  }
}
/** PermissionDialog.tsx:193-206（getProviderOptionNameMessageIds）。 */
function getAgentPermissionOptionNameLabel(provider: string | undefined, name: string): string | null {
  const normalizedName = name.trim().replace(/\s+/g, ' ').toLowerCase()
  const global = AGENT_PERMISSION_OPTION_NAME_LABELS[normalizedName]
  if (global !== undefined) return global
  if (provider === undefined) return null
  return AGENT_PERMISSION_PROVIDER_OPTION_NAME_LABELS[provider]?.[normalizedName] ?? null
}
/** PermissionDialog.tsx:178-191（带 description 覆盖的两条 name）。 */
const NAME_DESCRIPTION_TEXTS: Readonly<Record<string, string>> = {
  'full access': 'fullAccessDescription',
  'always allow in this session': 'workflowAllowForSessionDescription',
}
/** PermissionDialog.tsx:736-767：officialCua > allowCommand > 已知 name > kind 推导。 */
export function resolveAgentPermissionOptionLabel(
  option: AgentPermissionOption,
  scope: AgentPermissionScope,
  provider?: string,
): string {
  if (isAgentOfficialCuaProjectOption(option)) return AGENT_PERMISSION_TEXTS.cuaAllowForProject
  const normalizedName = normalizeAgentPermissionInlineText(option.name).toLowerCase()
  if (normalizedName === 'always allow in this project' && scope === 'command') {
    return AGENT_PERMISSION_TEXTS.allowCommand
  }
  const knownName = getAgentPermissionOptionNameLabel(provider, option.name)
  if (knownName === 'chat.permission.fullAccess') return AGENT_PERMISSION_TEXTS.fullAccess
  if (knownName === 'chat.permission.allowForProject') return AGENT_PERMISSION_TEXTS.allowForProject
  if (knownName === 'chat.permission.cua.allowForProject') {
    return AGENT_PERMISSION_TEXTS.cuaAllowForProject
  }
  if (knownName === 'chat.permission.workflow.allowForSession') {
    return AGENT_PERMISSION_TEXTS.workflowAllowForSession
  }
  const fallbackLabel = getAgentPermissionOptionLabelText(option)
  if (shouldPreferAgentPermissionOptionName(option)) return option.name
  return fallbackLabel ?? option.name
}
/** PermissionDialog.tsx:208-221, 747-771（getOptionDescriptionMessageId + name 覆盖）。 */
export function resolveAgentPermissionOptionDescription(
  option: AgentPermissionOption,
  scope: AgentPermissionScope,
  provider?: string,
): string | null {
  if (isAgentOfficialCuaProjectOption(option)) {
    return AGENT_PERMISSION_TEXTS.cuaAllowForProjectDescription
  }
  const normalizedName = normalizeAgentPermissionInlineText(option.name).toLowerCase()
  if (normalizedName === 'always allow in this project' && scope === 'command') {
    return AGENT_PERMISSION_TEXTS.allowCommandDescription
  }
  const nameDescription = NAME_DESCRIPTION_TEXTS[normalizedName]
  if (nameDescription === 'fullAccessDescription') return AGENT_PERMISSION_TEXTS.fullAccessDescription
  if (nameDescription === 'workflowAllowForSessionDescription') {
    return AGENT_PERMISSION_TEXTS.workflowAllowForSessionDescription
  }
  // PermissionDialog.tsx:768-771：preferOptionName 且无已知 name 时不出描述。
  if (shouldPreferAgentPermissionOptionName(option) &&
      getAgentPermissionOptionNameLabel(provider, option.name) === null) {
    return null
  }
  switch (getAgentPermissionOptionDisplayKind(option.kind)) {
    case 'allowOnce': return AGENT_PERMISSION_TEXTS.allowOnceDescription
    case 'allowAlways':
      return scope === 'command' ? AGENT_PERMISSION_TEXTS.allowAlwaysDescriptionCommand
        : scope === 'file' ? AGENT_PERMISSION_TEXTS.allowAlwaysDescriptionFile
          : AGENT_PERMISSION_TEXTS.allowAlwaysDescriptionGeneric
    case 'rejectOnce': return AGENT_PERMISSION_TEXTS.denyOnceDescription
    case 'rejectAlways':
      return scope === 'command' ? AGENT_PERMISSION_TEXTS.denyAlwaysDescriptionCommand
        : scope === 'file' ? AGENT_PERMISSION_TEXTS.denyAlwaysDescriptionFile
          : AGENT_PERMISSION_TEXTS.denyAlwaysDescriptionGeneric
    default: return null
  }
}
// ── 行模型：按钮行 + 反馈行（PermissionDialog.tsx:452-514） ──────────
/**
 * PermissionDialog.tsx:452-460, 500-515。按钮行 = `request.options` 排序后**剔除** workflowRefine；
 * Refine 不是按钮，它是反馈行的应答目标。反馈行在 refineOption 存在、或 freeText === true 时出现
 * （后者应答目标是第一个 reject 选项）。
 */
export function buildAgentPermissionRows(
  request: AgentPermissionRequest,
  provider?: string,
): AgentPermissionRow[] {
  const scope = readAgentPermissionScope(request)
  const refineOption = request.options.find(isAgentWorkflowRefineOption)
  const orderedOptions = sortAgentPermissionOptions(request.options)
    .filter((option) => !isAgentWorkflowRefineOption(option))
  const rows: AgentPermissionRow[] = orderedOptions.map((option, index) => ({
    index,
    kind: 'option',
    option,
    label: resolveAgentPermissionOptionLabel(option, scope, provider),
    description: resolveAgentPermissionOptionDescription(option, scope, provider),
    displayKind: getAgentPermissionOptionDisplayKind(option.kind),
  }))
  // PermissionDialog.tsx:500-506：反馈行的应答目标是第一个 reject 选项。
  const denyOption = orderedOptions.find(
    (option) => getAgentPermissionOptionDisplayKind(option.kind).startsWith('reject'))
  const feedbackOption = refineOption ?? (request.freeText === true ? denyOption : undefined)
  if (feedbackOption !== undefined) {
    rows.push({
      index: orderedOptions.length,
      kind: 'feedback',
      option: feedbackOption,
      label: null,
      description: null,
      displayKind: null,
    })
  }
  return rows
}
/** PermissionDialog.tsx:513-515（feedbackIndex / selectableCount / isFeedbackSelected）。 */
export function getAgentPermissionFeedbackIndex(request: AgentPermissionRequest): number | null {
  const feedback = buildAgentPermissionRows(request).find((row) => row.kind === 'feedback')
  return feedback === undefined ? null : feedback.index
}
/** PermissionDialog.tsx:830-868：反馈行的 aria-label / placeholder 按 refineOption 分流。 */
export function getAgentPermissionFeedbackCopy(request: AgentPermissionRequest) {
  const isRefine = request.options.some(isAgentWorkflowRefineOption)
  return isRefine
    ? {
        ariaLabel: AGENT_PERMISSION_TEXTS.workflowRefine,
        placeholder: AGENT_PERMISSION_TEXTS.workflowRefinePlaceholder,
        isRefine: true,
      }
    : {
        ariaLabel: AGENT_PERMISSION_TEXTS.feedbackAriaLabel,
        placeholder: AGENT_PERMISSION_TEXTS.feedbackPlaceholder,
        isRefine: false,
      }
}
// ── 决策结果（PermissionDialog.tsx:559-589 / V4InteractionDialogs.tsx:334-349） ──
/**
 * PermissionDialog.tsx:559-571（respondWithOption）。通用窗里 Deny 顺带把反馈草稿作为拒绝理由发出；
 * 工作流窗的草稿属于 Refine，点 Deny 就是普通拒绝（feedback 为空）。
 */
export function createAgentPermissionDecision(
  request: AgentPermissionRequest,
  option: AgentPermissionOption,
  feedbackDraft?: string,
): AgentPermissionDecision {
  const hasRefineOption = request.options.some(isAgentWorkflowRefineOption)
  const selectedKind = getAgentPermissionOptionDisplayKind(option.kind)
  const trimmed = feedbackDraft === undefined ? '' : feedbackDraft.trim()
  const feedback = !hasRefineOption && selectedKind.startsWith('reject') ? trimmed : ''
  return feedback.length > 0
    ? { optionId: option.optionId, kind: option.kind, feedback }
    : { optionId: option.optionId, kind: option.kind }
}
/**
 * PermissionDialog.tsx:573-580（submitFeedback）。提交前 trim：纯空白不当作反馈
 * （CLI broker 对空白 freeText 落普通 deny）。
 */
export function createAgentPermissionFeedbackDecision(
  request: AgentPermissionRequest,
  feedbackDraft: string,
): AgentPermissionDecision | null {
  const trimmed = feedbackDraft.trim()
  if (trimmed.length === 0 || trimmed.length > AGENT_PERMISSION_MAX_FEEDBACK_CHARS) return null
  const feedbackRow = buildAgentPermissionRows(request).find((row) => row.kind === 'feedback')
  if (feedbackRow?.option === undefined) return null
  return { optionId: feedbackRow.option.optionId, kind: feedbackRow.option.kind, feedback: trimmed }
}
/** PermissionDialog.tsx:905-915：确认按钮的 disabled 判据。 */
export function canConfirmAgentPermissionSelection(
  request: AgentPermissionRequest,
  selectedIndex: number,
  feedbackDraft: string,
  responding: boolean,
): boolean {
  if (responding) return false
  const row = buildAgentPermissionRows(request)[selectedIndex]
  if (row === undefined) return false
  if (row.kind === 'feedback') return feedbackDraft.trim().length > 0
  return true
}
// ── SaveWorkflow 保存确认 ───────────────────────────────────────────
/** save-workflow.tsx:84-104（readSaveWorkflowInput）。 */
export function readAgentSaveWorkflowInput(input: unknown): AgentSaveWorkflowInput {
  const record = isRecord(input) ? input : {}
  const readTrimmed = (value: unknown): string | undefined => {
    if (typeof value !== 'string') return undefined
    const trimmed = value.trim()
    return trimmed.length > 0 ? trimmed : undefined
  }
  const args: AgentWorkflowArgDeclaration[] = []
  if (isRecord(record.args)) {
    for (const [name, declaration] of Object.entries(record.args)) {
      if (!isRecord(declaration)) continue
      args.push({
        name,
        type: readTrimmed(declaration.type),
        description: readTrimmed(declaration.description),
        required: declaration.required === true,
        hasDefault: 'default' in declaration,
        defaultValue: declaration.default,
      })
    }
  }
  return {
    name: readTrimmed(record.name),
    description: readTrimmed(record.description),
    whenToUse: readTrimmed(record.whenToUse),
    path: readTrimmed(record.path),
    scope: readTrimmed(record.scope),
    shadowing: record.shadowing === 'hides_global' || record.shadowing === 'hidden_by_project'
      ? record.shadowing : undefined,
    // save-workflow.tsx:96-97：只有显式 true 才是覆盖。
    overwrite: record.overwrite === true,
    script: typeof record.script === 'string' && record.script.length > 0
      ? record.script : undefined,
    args,
  }
}
/** SaveWorkflowPermissionBlock.tsx:131-135：覆盖与新建是两句不同的问句。 */
export function resolveAgentSaveWorkflowTitle(input: AgentSaveWorkflowInput): string {
  return input.overwrite
    ? AGENT_PERMISSION_TEXTS.workflowSaveOverwriteTitle
    : AGENT_PERMISSION_TEXTS.workflowSaveTitle
}
/** SaveWorkflowPermissionBlock.tsx:120-193：标题 + 名称回退 + 覆盖徽标 + 元数据 + 参数表。 */
export function describeAgentSaveWorkflowPrompt(input: AgentSaveWorkflowInput) {
  return {
    title: resolveAgentSaveWorkflowTitle(input),
    name: input.name ?? AGENT_PERMISSION_TEXTS.workflowFallbackName,
    overwrite: input.overwrite,
    overwriteBadge: input.overwrite ? AGENT_PERMISSION_TEXTS.workflowSaveOverwriteBadge : null,
    overwriteHint: input.overwrite ? AGENT_PERMISSION_TEXTS.workflowSaveOverwriteHint : null,
    path: input.path ?? null,
    description: input.description ?? null,
    whenToUse: input.whenToUse ?? null,
    argsLabel: input.args.length > 0 ? AGENT_PERMISSION_TEXTS.workflowSaveArgs : null,
  }
}
/** SaveWorkflowPermissionBlock.tsx:110-116：保存 gate 刻意不接 Refine。 */
export function hasAgentSaveWorkflowRefineOption(request: AgentPermissionRequest): boolean {
  return request.options.some(isAgentWorkflowRefineOption)
}
// ── 电脑操控（CuaPermissionObservationAttachment.tsx:150-156） ────────
export type AgentCuaPermissionKind = 'accessibility' | 'screen_recording' // cuaAccessibilitySettings.ts:1
/** cuaPermission.ts:16-27（requiredCuaPermissionsForRequestAccessStatus）。 */
export function requiredAgentCuaPermissions(status: {
  accessibility: 'granted' | 'stale' | 'denied'
  screenRecording: 'granted' | 'denied' | 'unknown'
}): AgentCuaPermissionKind[] {
  const required: AgentCuaPermissionKind[] = []
  if (status.accessibility === 'denied' || status.accessibility === 'stale') {
    required.push('accessibility')
  }
  if (status.screenRecording === 'denied') required.push('screen_recording')
  return required
}
/** CuaPermissionObservationAttachment.tsx:150-156：确认框四段文案。 */
export function describeAgentCuaPermissionPrompt() {
  return {
    title: AGENT_PERMISSION_TEXTS.cuaLiveTitle,
    description: AGENT_PERMISSION_TEXTS.cuaLiveDescription,
    confirmLabel: AGENT_PERMISSION_TEXTS.cuaLiveConfirm,
    cancelLabel: AGENT_PERMISSION_TEXTS.cuaLiveCancel,
  }
}
// ── 与 src/agent.ts 的对接（「该不该问」那一半） ─────────────────────
export type AgentPermissionToolName = // agent.ts:11（AgentToolName）
  'read_file' | 'write_file' | 'run_command' | 'fetch_network' | 'mcp_call'
/** agent.ts:20-28（AgentPermissionSettings）。 */
export interface AgentPermissionLevels {
  read: 'allow' | 'ask' | 'never'
  write: 'allow' | 'ask' | 'never'
  run: 'allow' | 'ask' | 'never'
  network: 'allow' | 'ask' | 'never'
}
/** agent.ts:36（decidePermission 的档位选择）。 */
export function agentPermissionSlotForTool(
  tool: AgentPermissionToolName,
): keyof AgentPermissionLevels {
  if (tool === 'read_file') return 'read'
  if (tool === 'write_file') return 'write'
  if (tool === 'run_command') return 'run'
  return 'network'
}
/** agent.ts:35-38（decidePermission）。 */
export function decideAgentToolPermission(
  tool: AgentPermissionToolName,
  levels: AgentPermissionLevels,
): 'allow' | 'ask' | 'deny' {
  if (tool === 'mcp_call') return 'ask'
  const level = levels[agentPermissionSlotForTool(tool)]
  return level === 'allow' ? 'allow' : level === 'ask' ? 'ask' : 'deny'
}
/** 工具 → 审批形状：block kind + scope（PermissionDialog.tsx:265-312 + preview scope）。 */
export function describeAgentToolPermissionShape(tool: AgentPermissionToolName) {
  if (tool === 'write_file') {
    return { slot: 'write' as const, blockKind: 'edit' as const, scope: 'file' as const }
  }
  if (tool === 'run_command') {
    return { slot: 'run' as const, blockKind: 'execute' as const, scope: 'command' as const }
  }
  // tool-identity.ts:62-66：WebFetch / WebSearch / web_search 都归 search family。
  if (tool === 'fetch_network') {
    return { slot: 'network' as const, blockKind: 'search' as const, scope: 'generic' as const }
  }
  if (tool === 'mcp_call') {
    return { slot: 'network' as const, blockKind: 'mcp' as const, scope: 'generic' as const }
  }
  return { slot: 'read' as const, blockKind: 'fallback' as const, scope: 'generic' as const }
}
/**
 * 一条审批请求的完整「怎么问」模型：`src/agent.ts` 判「该不该问」，这里给「问什么形状」。
 *
 * @param tool 工具名（`AgentToolName`）。
 * @param request 卡在门上的那条请求（协议形状）。
 * @param provider 选项 name 本地化用的 provider（PermissionDialog.tsx:202）。
 */
export function describeAgentPermissionPrompt(
  tool: AgentPermissionToolName,
  request: AgentPermissionRequest,
  provider?: string,
) {
  const blockKind = resolveAgentPermissionBlockKind(request)
  return {
    shape: describeAgentToolPermissionShape(tool),
    scope: readAgentPermissionScope(request),
    blockKind,
    displayReason: readAgentPermissionDisplayReason(request),
    rows: buildAgentPermissionRows(request, provider),
    feedback: getAgentPermissionFeedbackCopy(request),
    interaction: getAgentPermissionBlockInteraction(blockKind),
    isSwitchMode: isAgentSwitchModePermissionRequest(request),
  }
}
