// 「子智能体」节（ZCode section id `subagents`，图标 Bot）的**纯逻辑层** —— 2026-10-07。
//
// 为什么单独一个文件：ZCode 的设置面板每节都是「一份形状 + 一份校验 + 一份投影」。
// 子智能体这节最特殊 —— 它的**权威数据是磁盘上的 Markdown 文件**，不是某个 JSON 存档：
// ZCode `services/src/subagents/subagentMarkdown.ts:38-103` 就是那个 parser，
// `subagentsService.ts:48-55, 141-147` 的 `agents-state.json` 只存**覆盖层**
// （`disabledAgentIds` + 模型覆盖），定义本体永远在 `agent.md` 里。
// 把这两面混进 `src/agentSettings.ts` 会让人误以为设置页存了一份子智能体清单 ——
// 那正是「放假控件」的温床。所以本模块只管三件事：
//   1. **解析**一份子智能体定义（`parseSubagentMarkdown`，格式已核实 = YAML frontmatter Markdown）；
//   2. **投影**一条条目能做什么（`subagentCapabilities`）；
//   3. **持有覆盖层与 UI 偏好**（`AgentSubagentsSettings`，经 `src/agentSettingsStore.ts` 落盘）。
//
// 字段与 ZCode 出处（逐条，便于对账）：
//   · `name`          必填标量、trim —— `subagentMarkdown.ts:56-60`（缺失 → `agent_missing_required_frontmatter` `:280-288`）
//   · `description`   必填标量、`\\n` 反转义 —— `subagentMarkdown.ts:57, 61-63`
//   · `systemPrompt`  frontmatter 之后的正文 trim —— `subagentMarkdown.ts:82`
//   · `color`         8 选 1 —— `subagentMarkdown.ts:14-23, 67`；表单缺省 `yellow` —— `SubagentsSection.tsx:310`
//   · `model`         字符串；`inherit/main/sonnet/opus/haiku` 视为「继承」—— `subagent-markdown-selection.ts:8, 14-16`
//   · `thoughtLevel`  独立标量，与 model 成对写回 —— `subagent-markdown-selection.ts:29-31`、`subagentMarkdown.ts:111-114`
//   · `tools`         工具规格表，`Bash(git:*)` 这类带参 pattern 不许被逗号/空格切开 —— `subagentMarkdown.ts:332-355`
//   · `disallowedTools` 同上 —— `subagentMarkdown.ts:71`
//   · `skills`        字符串表（逗号/空白分隔亦可）—— `subagentMarkdown.ts:317-330`
//   · `permissionMode` `auto | plan` —— `subagentMarkdown.ts:25, 68`
//   · `maxTurns`      正整数 —— `subagentMarkdown.ts:69, 308-315`
//   · `background`    布尔 —— `subagentMarkdown.ts:73`
//   · `injectAgentsMd` 布尔，表单缺省 true —— `subagentMarkdown.ts:74`、`SubagentsSection.tsx:313`
//   · `mcpServers`    原样透传（GUI 没有结构化表单）—— `subagentMarkdown.ts:75, 385-388`
//   · `id`            `${source}:${scope}:${name 小写}` —— `subagents-types.ts:152-158`
//   · `scope/source`  `built-in|workspace|user` / `built-in|user|plugin` —— `subagents-types.ts:4, 6`；`source` 由 scope 推导 —— `subagentMarkdown.ts:65`
//   · `readOnly`      只有内置真正只读 —— `subagentMarkdown.ts:100`
//   · `enabled`       只有 user scope 读 `disabledAgentIds` —— `subagentsService.ts:283-289`
//
// **诚实登记（不许放假控件）**：
//   · 盘面已核实：内置 `mavis` / `explore` / `worker` / `verifier` 是
//     `C:\Users\Administrator\.minimax\agents\.builtin\<名>\agent.md` 四个 Markdown 文件
//     （2026-10-07 实测目录），自定义 Agent 落在同一 `agents\` 根下。
//   · 本仓**没有** ZCode 的目录扫描服务（那在 `services` 包 + CLI 侧，本仓没有对应物），
//     所以「列出磁盘上的子智能体」这一格只能显示缺口文案，由宿主补齐 `entries`。
//   · ZCode 的工具档位是 Claude Code 命名（`Read/Grep/Glob/Bash/Edit/Write/WebFetch/WebSearch/TodoWrite`，
//     `SubagentsSection.tsx:87-97`）；本仓工具名不同（`mavis` 系列），因此 `TOOL_OPTIONS` 只作
//     **对照常量**保留，不当本仓的可选清单 —— 渲染层请读 `subagentCapabilities().knownTools`。
import {
  defaultSettingsStorage,
  readSettingsJson,
  writeSettingsJson,
  type SettingsStorage,
} from './agentSettingsStore.ts'

/** 存储键。与 `src/agentSettings.ts` / `src/codeStyleSettings.ts` 同一族（localStorage）。 */
export const AGENT_SUBAGENTS_STORAGE_KEY = 'taocode.agent.subagents.settings'

/** 节 id 与图标对应的设置页锚点（`settingsPageConfig.ts:82-87`：id `subagents` / icon `Bot` / group `agentCapabilities`）。 */
export const AGENT_SUBAGENTS_SECTION_ID = 'subagents'

/** 节标题与描述（ZCode `zh-CN.ts:3610-3611`）。 */
export const AGENT_SUBAGENTS_TITLE = '子智能体'

/** 三个分组标题（ZCode `zh-CN.ts:3623-3627`；分组规则见 `SubagentsSection.tsx:375-387`）。 */
export const AGENT_SUBAGENT_GROUP_LABELS = { user: '已安装', plugin: '插件子智能体', builtIn: '内置子智能体' } as const

/** 作用域标签（ZCode `zh-CN.ts:3629-3632`；枚举见 `subagents-types.ts:4`）。 */
export const AGENT_SUBAGENT_SCOPE_LABELS = { 'built-in': '内置', plugin: '插件', workspace: '工作区' } as const

/** 权限模式两档（ZCode `zh-CN.ts:3683-3684`；枚举见 `subagentMarkdown.ts:25`）。 */
export const AGENT_SUBAGENT_PERMISSION_MODES = ['auto', 'plan'] as const
export const AGENT_SUBAGENT_PERMISSION_MODE_LABELS = { auto: '自动', plan: '计划模式' } as const

/** 8 个颜色标记（ZCode `subagentMarkdown.ts:14-23`；中文名 `zh-CN.ts:3685-3692`）。 */
export const AGENT_SUBAGENT_COLORS = ['red', 'blue', 'green', 'yellow', 'purple', 'orange', 'pink', 'cyan'] as const

/** ZCode 的「继承模型」别名（`subagent-markdown-selection.ts:8`）。命中即视为不覆盖。 */
export const AGENT_SUBAGENT_INHERIT_MODEL_NAMES = ['inherit', 'main', 'sonnet', 'opus', 'haiku'] as const

/** 名字长度区间（ZCode `SubagentsSection.tsx:929-936`，i18n `zh-CN.ts:3671`）。 */
export const AGENT_SUBAGENT_NAME_MIN = 3
export const AGENT_SUBAGENT_NAME_MAX = 50

/** ZCode 工具候选（`SubagentsSection.tsx:87-97`）。**对照用**，不是本仓工具清单（见文件头「诚实登记」）。 */
export const AGENT_SUBAGENT_ZCODE_TOOL_OPTIONS = [
  'Read', 'Grep', 'Glob', 'Bash', 'Edit', 'Write', 'WebFetch', 'WebSearch', 'TodoWrite',
] as const

/** 风险工具（ZCode `SubagentsSection.tsx:99` `RISKY_TOOLS`）。 */
export const AGENT_SUBAGENT_RISKY_TOOLS = ['Bash', 'Edit', 'Write'] as const

const ZCODE_TOOL_SET = new Set<string>(AGENT_SUBAGENT_ZCODE_TOOL_OPTIONS)
const RISKY_TOOL_SET = new Set<string>(AGENT_SUBAGENT_RISKY_TOOLS)
const INHERIT_SET = new Set<string>(AGENT_SUBAGENT_INHERIT_MODEL_NAMES)

export type AgentSubagentScope = 'built-in' | 'workspace' | 'user'
export type AgentSubagentSource = 'built-in' | 'user' | 'plugin'
export type AgentSubagentColor = (typeof AGENT_SUBAGENT_COLORS)[number]
export type AgentSubagentPermissionMode = (typeof AGENT_SUBAGENT_PERMISSION_MODES)[number]
export type AgentSubagentGroup = 'user' | 'plugin' | 'builtIn'

/** 解析失败时的诊断（ZCode `subagents-types.ts:71-75` `AgentDiagnostic`）。 */
export interface AgentSubagentDiagnostic {
  code: string
  message: string
  path?: string
}

/**
 * 一条子智能体条目。字段集 = ZCode `AgentSummary`（`subagents-types.ts:43-69`）里
 * **有真实落盘/消费路径**的那部分，模型选择三件套折成 `model` + `thoughtLevel` 两个标量
 * （ZCode 侧也是这么存的 —— `subagentMarkdown.ts:111-114`）。
 */
export interface AgentSubagent {
  id: string
  name: string
  description: string
  systemPrompt: string
  color?: AgentSubagentColor
  /** 形如 `provider/model`（`subagent-markdown-selection.ts:35-41`）；空 = 继承。 */
  model?: string
  thoughtLevel?: string
  tools?: string[]
  disallowedTools?: string[]
  skills?: string[]
  permissionMode?: AgentSubagentPermissionMode
  maxTurns?: number
  background?: boolean
  injectAgentsMd?: boolean
  mcpServers?: unknown[]
  path: string
  scope: AgentSubagentScope
  source: AgentSubagentSource
  /** 有效启用态，由 `disabledAgentIds` 现算（`subagentsService.ts:283-289`）。 */
  enabled: boolean
  readOnly?: boolean
  pluginId?: string
  pluginName?: string
  diagnostics?: AgentSubagentDiagnostic[]
}

/** 覆盖层里的一条模型覆盖（ZCode `agents-state.json` 的两个 override map 的合并形状）。 */
export interface AgentSubagentModelOverride {
  model: string
  thoughtLevel?: string
}

/** 作用域筛选的三档（ZCode `zh-CN.ts:3633-3635`）。 */
export type AgentSubagentScopeFilter = 'all' | 'enabled' | 'disabled'

/**
 * 子智能体节的**持久化面**：条目 + 覆盖层 + 两个 UI 偏好。
 *
 * `entries` 由宿主（扫盘那一侧）写进来，本模块只做归一化与校验 —— 它不读盘、不碰 DOM。
 */
export interface AgentSubagentsSettings {
  entries: AgentSubagent[]
  /** `agents-state.json` 的 `disabledAgentIds`（`subagentsService.ts:51`）。只有 user scope 生效。 */
  disabledAgentIds: string[]
  /** 条目 id → 模型覆盖。`model` 为空表示清掉覆盖（回到继承）。 */
  modelOverrides: Record<string, AgentSubagentModelOverride>
  /** 搜索词（ZCode `zh-CN.ts:3613`）。 */
  query: string
  scopeFilter: AgentSubagentScopeFilter
}

/** 出厂默认：空清单 + 空覆盖层 + 默认筛选（对齐 `emptyAgentsState()`，`subagentsService.ts:141-147`）。 */
export function defaultAgentSubagentsSettings(): AgentSubagentsSettings {
  return { entries: [], disabledAgentIds: [], modelOverrides: {}, query: '', scopeFilter: 'all' }
}

/** 状态 id（ZCode `subagents-types.ts:152-158`）。插件 agent 另有 `plugin:<pluginId>:<名>` 形式（`:148-150`）。 */
export function agentSubagentStateId(source: AgentSubagentSource, scope: AgentSubagentScope, name: string): string {
  return `${source}:${scope}:${name.trim().toLowerCase()}`
}

/** 工具档位是不是「全部工具」（ZCode `SubagentsSection.tsx:185-188`：空或含 `*` 都算全量）。 */
export function allowsAllTools(tools: readonly string[] | undefined): boolean {
  return !tools || tools.length === 0 || tools.some((tool) => tool.trim() === '*')
}

/** 工具档位 ↔ 表单双向投影的合并侧（ZCode `SubagentsSection.tsx:175-183` `mergeTools`：空数组折回 `undefined`）。 */
export function mergeSubagentTools(selected: readonly string[], preserved: readonly string[]): string[] | undefined {
  const merged = [...selected, ...preserved].filter((tool, index, all) => tool.length > 0 && all.indexOf(tool) === index)
  return merged.length > 0 ? merged : undefined
}

/**
 * 一条子智能体的**能力投影** —— 界面据此决定「这一行能点什么」，全是对 ZCode 判定函数的逐条平移。
 */
export interface AgentSubagentCapabilities {
  /** 落在哪个分组（`SubagentsSection.tsx:375-387`：可编辑 user → user，plugin source → plugin，其余 → builtIn）。 */
  group: AgentSubagentGroup
  /** 分组标题（`zh-CN.ts:3623-3627`）。 */
  groupLabel: string
  /** 可编辑/可删除（`SubagentsSection.tsx:132-138`）。 */
  editable: boolean
  /** 有没有启用开关（`SubagentsSection.tsx:144-146`：**只有 user scope**，别给内置/插件/工作区画开关）。 */
  supportsEnabledToggle: boolean
  /** 只读（`subagentMarkdown.ts:100`）。 */
  readOnly: boolean
  /** 内置判定（`SubagentsSection.tsx:148-150`）。 */
  builtIn: boolean
  /** ZCode 认得的内置名（`SubagentsSection.tsx:160-165`）：`general-purpose` / `Explore`，其余为 null。 */
  builtInSubagentName: 'general-purpose' | 'Explore' | null
  /** 有没有行内模型覆盖控件（`SubagentsSection.tsx:156-158`）。 */
  supportsModelOverride: boolean
  /** 工具是继承全量还是自定义（`SubagentsSection.tsx:314`：`tools` 缺省或空数组 = 继承全部）。 */
  inheritAllTools: boolean
  /** 命中 ZCode 工具候选的那几项（`SubagentsSection.tsx:167-169`）。 */
  knownTools: string[]
  /** 候选之外被原样保留的 pattern（`SubagentsSection.tsx:171-173`）—— **不许静默丢掉**。 */
  preservedTools: string[]
  /** 工具档位的显示文案（`zh-CN.ts:3642-3644`）。 */
  toolLabel: string
  /** 风险工具（`SubagentsSection.tsx:99`）。 */
  riskyTools: string[]
  /** 生效的模型文案：空/继承 → 「继承默认」（`zh-CN.ts:3678`）。 */
  modelLabel: string
}

function editableSubagent(entry: AgentSubagent): boolean {
  return (entry.scope === 'user' || entry.scope === 'workspace') && entry.source === 'user' && entry.readOnly !== true
}

function builtInSubagent(entry: AgentSubagent): boolean {
  return entry.scope === 'built-in' || entry.source === 'built-in'
}

/**
 * 能力投影。ZCode 那几条判定都是「输入 agent、输出布尔」的纯函数（`SubagentsSection.tsx:132-165`），
 * 这里合成一个对象，让 Vue 一次拿到全部，避免模板里各判一遍。
 */
export function subagentCapabilities(entry: AgentSubagent): AgentSubagentCapabilities {
  const isBuiltIn = builtInSubagent(entry)
  const editable = editableSubagent(entry)
  const knownTools = (entry.tools ?? []).filter((tool) => ZCODE_TOOL_SET.has(tool))
  const preservedTools = (entry.tools ?? []).filter((tool) => !ZCODE_TOOL_SET.has(tool))
  const inheritAllTools = entry.tools === undefined || entry.tools.length === 0
  const builtInSubagentName = !isBuiltIn
    ? null
    : (entry.name === 'general-purpose' || entry.name === 'Explore' ? entry.name : null)
  const group: AgentSubagentGroup = editable ? 'user' : entry.source === 'plugin' ? 'plugin' : 'builtIn'
  const riskyTools = (entry.tools ?? []).filter((tool) => RISKY_TOOL_SET.has(tool))
  return {
    group,
    groupLabel: AGENT_SUBAGENT_GROUP_LABELS[group],
    editable,
    supportsEnabledToggle: editable && entry.scope === 'user',
    readOnly: entry.readOnly === true,
    builtIn: isBuiltIn,
    builtInSubagentName,
    // ZCode 只给内置的两个具名 profile 与插件 agent 行内模型覆盖（`SubagentsSection.tsx:152-158`）。
    supportsModelOverride: builtInSubagentName !== null || entry.source === 'plugin',
    inheritAllTools,
    knownTools,
    preservedTools,
    toolLabel: inheritAllTools
      ? '继承工具'
      : allowsAllTools(entry.tools)
        ? '全部工具'
        : `${entry.tools!.length} 个工具`,
    riskyTools,
    modelLabel: isInheritModel(entry.model) ? '继承默认' : (entry.model ?? '继承默认'),
  }
}

function isInheritModel(model: string | undefined): boolean {
  const value = (model ?? '').trim()
  return value.length === 0 || INHERIT_SET.has(value)
}

// ---- 归一化 ------------------------------------------------------------------

function scalarString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : undefined
}

function normalizeColor(value: unknown): AgentSubagentColor | undefined {
  const raw = scalarString(value)
  return raw && (AGENT_SUBAGENT_COLORS as readonly string[]).includes(raw) ? raw as AgentSubagentColor : undefined
}

function normalizePermissionMode(value: unknown): AgentSubagentPermissionMode | undefined {
  const raw = scalarString(value)
  return raw && (AGENT_SUBAGENT_PERMISSION_MODES as readonly string[]).includes(raw)
    ? raw as AgentSubagentPermissionMode
    : undefined
}

/** 正整数（ZCode `normalizePositiveInteger`，`subagentMarkdown.ts:308-315`）。非法值丢字段，不猜。 */
function normalizePositiveInteger(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isInteger(value) && value > 0) return value
  if (typeof value === 'string' && /^\d+$/u.test(value)) {
    const parsed = Number(value)
    return parsed > 0 ? parsed : undefined
  }
  return undefined
}

function normalizeBoolean(value: unknown, fallback: boolean): boolean {
  return typeof value === 'boolean' ? value : fallback
}

function normalizeStringList(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined
  const list = value.filter((item): item is string => typeof item === 'string').map((item) => item.trim()).filter(Boolean)
  return list.length > 0 ? list : undefined
}

function normalizeScope(value: unknown): AgentSubagentScope {
  return value === 'workspace' || value === 'built-in' ? value : 'user'
}

function normalizeSource(value: unknown, scope: AgentSubagentScope): AgentSubagentSource {
  if (value === 'plugin') return 'plugin'
  if (value === 'built-in') return 'built-in'
  // ZCode 侧 source 由 scope 推导：只有 built-in 是 built-in，其余一律 user（`subagentMarkdown.ts:65`）。
  return scope === 'built-in' ? 'built-in' : 'user'
}

/**
 * 把任意输入归一成一份合法设置。**永不抛、永不返回坏值**，逐字段救（本仓铁律：
 * 不许按字段数量判损坏，真出过把用户锁在项目外的事故 —— `src/agentSettings.ts:132-135` 同口径）。
 *
 * 逐条处理：
 *   · `entries` 不是数组 → 退空表（不是「损坏」，可能是旧版没这一格）。
 *   · 单条坏条目只丢自己（名字/路径没法救时丢弃，其余字段能救的救）。
 *   · `disabledAgentIds` 只留非空字符串（`subagentsService.ts:176-180` 同口径）。
 *   · `modelOverrides` 逐键救：非对象的值丢掉，键为空串的丢掉。
 *   · `enabled` **不读存档**，一律由 `disabledAgentIds` 现算（`subagentsService.ts:283-289`），
 *     否则会出现「存档说启用、状态文件说停用」的分裂。
 */
export function normalizeAgentSubagentsSettings(input: unknown): AgentSubagentsSettings {
  const defaults = defaultAgentSubagentsSettings()
  if (!input || typeof input !== 'object') return defaults
  const raw = input as Record<string, unknown>

  const disabledRaw = Array.isArray(raw.disabledAgentIds) ? raw.disabledAgentIds : []
  const disabledAgentIds: string[] = []
  for (const id of disabledRaw) {
    if (typeof id !== 'string') continue
    const trimmed = id.trim()
    if (trimmed && !disabledAgentIds.includes(trimmed)) disabledAgentIds.push(trimmed)
  }
  const disabledSet = new Set(disabledAgentIds)

  const entries: AgentSubagent[] = []
  // 刻意**不**按 id 去重：两条同 id 的条目是磁盘上的两个文件，是真实的冲突，
  // 在读路径上悄悄丢一条会把它从用户眼前藏起来。留给 validate 当场报（见下）。
  const entriesRaw = Array.isArray(raw.entries) ? raw.entries : []
  for (const item of entriesRaw) {
    const entry = normalizeSubagentEntry(item)
    // 名字与路径都救不回来 = 这条不是子智能体，丢单条不丢整表。
    if (!entry) continue
    entries.push({ ...entry, enabled: entry.scope === 'user' ? !disabledSet.has(entry.id) : true })
  }

  const overridesRaw = (raw.modelOverrides && typeof raw.modelOverrides === 'object' && !Array.isArray(raw.modelOverrides))
    ? raw.modelOverrides as Record<string, unknown>
    : {}
  const modelOverrides: Record<string, AgentSubagentModelOverride> = {}
  for (const [id, value] of Object.entries(overridesRaw)) {
    const key = id.trim()
    if (!key || !value || typeof value !== 'object') continue
    const overrideRaw = value as Record<string, unknown>
    const override: AgentSubagentModelOverride = { model: scalarString(overrideRaw.model) ?? '' }
    const thoughtLevel = scalarString(overrideRaw.thoughtLevel)
    if (thoughtLevel) override.thoughtLevel = thoughtLevel
    modelOverrides[key] = override
  }

  const scopeFilter: AgentSubagentScopeFilter =
    raw.scopeFilter === 'enabled' || raw.scopeFilter === 'disabled' ? raw.scopeFilter : defaults.scopeFilter
  return {
    entries,
    disabledAgentIds,
    modelOverrides,
    query: typeof raw.query === 'string' ? raw.query : defaults.query,
    scopeFilter,
  }
}

function normalizeSubagentEntry(item: unknown): AgentSubagent | null {
  if (!item || typeof item !== 'object') return null
  const raw = item as Record<string, unknown>
  const name = scalarString(raw.name)
  if (!name) return null
  const path = typeof raw.path === 'string' ? raw.path.trim() : ''
  if (!path) return null
  const scope = normalizeScope(raw.scope)
  const source = normalizeSource(raw.source, scope)
  const entry: AgentSubagent = {
    id: agentSubagentStateId(source, scope, name),
    name,
    description: typeof raw.description === 'string' ? raw.description : '',
    systemPrompt: typeof raw.systemPrompt === 'string' ? raw.systemPrompt : '',
    path,
    scope,
    source,
    // 下面这一格只是占位，真正值由 normalizeAgentSubagentsSettings 按 disabledAgentIds 覆盖。
    enabled: true,
  }
  const color = normalizeColor(raw.color)
  if (color) entry.color = color
  const model = scalarString(raw.model)
  if (model && !INHERIT_SET.has(model)) entry.model = model
  // 下面这几格一律「有值才写」：ZCode 侧是 `...(x ? { x } : {})` 展开（`subagentMarkdown.ts:83-92`），
  // 少一格就是「没声明」，多写一个 undefined 会被当成显式声明。
  const optional: Array<[keyof AgentSubagent, unknown]> = [
    ['thoughtLevel', scalarString(raw.thoughtLevel)],
    ['tools', normalizeStringList(raw.tools)],
    ['disallowedTools', normalizeStringList(raw.disallowedTools)],
    ['skills', normalizeStringList(raw.skills)],
    ['permissionMode', normalizePermissionMode(raw.permissionMode)],
    ['maxTurns', normalizePositiveInteger(raw.maxTurns)],
    ['pluginId', scalarString(raw.pluginId)],
    ['pluginName', scalarString(raw.pluginName)],
  ]
  for (const [key, value] of optional) {
    if (value !== undefined) (entry as unknown as Record<string, unknown>)[key] = value
  }
  if (typeof raw.background === 'boolean') entry.background = raw.background
  // 表单缺省注入 AGENTS.md（`SubagentsSection.tsx:313`），所以缺键按 true 救。
  entry.injectAgentsMd = normalizeBoolean(raw.injectAgentsMd, true)
  if (Array.isArray(raw.mcpServers) && raw.mcpServers.length > 0) entry.mcpServers = [...raw.mcpServers]
  // 只有内置真正只读（ZCode `subagentMarkdown.ts:100`）。
  entry.readOnly = scope === 'built-in' ? true : raw.readOnly === true
  if (Array.isArray(raw.diagnostics)) {
    const diagnostics: AgentSubagentDiagnostic[] = []
    for (const value of raw.diagnostics) {
      if (!value || typeof value !== 'object') continue
      const diagnosticRaw = value as Record<string, unknown>
      if (typeof diagnosticRaw.code !== 'string' || !diagnosticRaw.code) continue
      const diagnostic: AgentSubagentDiagnostic = { code: diagnosticRaw.code, message: typeof diagnosticRaw.message === 'string' ? diagnosticRaw.message : '' }
      if (typeof diagnosticRaw.path === 'string') diagnostic.path = diagnosticRaw.path
      diagnostics.push(diagnostic)
    }
    if (diagnostics.length > 0) entry.diagnostics = diagnostics
  }
  return entry
}

// ---- 保存前校验 --------------------------------------------------------------

/** 路径里出现 `..` 段 = 越权（ZCode 侧对应 `AgentDiagnostic.path` 指向的 profile 文件，本仓要求不许跳出 agents 根）。 */
function escapesAgentRoot(path: string): boolean {
  return path.split(/[\\/]+/u).some((segment) => segment === '..')
}

/**
 * 保存前的校验：返回问题清单（空数组 = 可以保存）。
 *
 * 与 `normalizeAgentSubagentsSettings` 的分工同 `src/agentSettings.ts:214-220`：
 * 那边是「读进来的坏数据要能救回来」，这边是「用户敲进去的坏数据要当场拦下并说清楚」。
 * 四类硬问题：
 *   1. 空名 —— `name` 必填（`subagentMarkdown.ts:58-60`）。
 *   2. 重名 —— 两条算出同一个 state id 就是同一个 Agent（`subagents-types.ts:157`）。
 *   3. 路径越界 —— `..` 段会让删除/写盘打到 agents 根之外。
 *   4. 依赖不成立 —— `disabledAgentIds` 里若有非 user scope 的 id，那是一条**永不生效的死记录**：
 *      runtime 只对 user scope 应用它（`SubagentsService.attachEnabledState` 的注释在
 *      `SubagentsSection.tsx:140-143`：给 workspace agent 写记录「点了会静默回弹」）。
 */
export function validateAgentSubagentsSettings(settings: AgentSubagentsSettings): string[] {
  const problems: string[] = []
  const seenIds = new Map<string, string>()
  for (const entry of settings.entries) {
    const name = entry.name.trim()
    if (!name) { problems.push('子智能体名称不能为空。'); continue }
    if (name.length < AGENT_SUBAGENT_NAME_MIN || name.length > AGENT_SUBAGENT_NAME_MAX) {
      problems.push(`子智能体「${name}」的名称长度必须在 ${AGENT_SUBAGENT_NAME_MIN} 到 ${AGENT_SUBAGENT_NAME_MAX} 个字符之间。`)
    } else if (!/^[a-zA-Z0-9-]+$/u.test(name)) {
      problems.push(`子智能体「${name}」的名称仅允许使用字母、数字和连字符。`)
    }
    const id = agentSubagentStateId(entry.source, entry.scope, name)
    const previous = seenIds.get(id)
    if (previous !== undefined) problems.push(`子智能体「${name}」重名（与「${previous}」冲突）：同名同作用域会指向同一个 Agent。`)
    else seenIds.set(id, name)
    if (!entry.path.trim()) problems.push(`子智能体「${name}」缺少定义文件路径。`)
    else if (escapesAgentRoot(entry.path)) problems.push(`子智能体「${name}」的路径越出子智能体目录：${entry.path}`)
    if (!entry.description.trim()) problems.push(`子智能体「${name}」的描述不能为空。`)
    if (editableSubagent(entry) && !entry.systemPrompt.trim()) problems.push(`子智能体「${name}」的系统提示词不能为空。`)
  }
  // 死记录：`disabledAgentIds` 只对 user scope 生效（`subagentsService.ts:287`）。
  const entriesById = new Set(settings.entries.map((entry) => entry.id))
  for (const id of settings.disabledAgentIds) {
    if (entriesById.has(id) && settings.entries.some((entry) => entry.id === id && entry.scope === 'user')) continue
    problems.push(entriesById.has(id)
      ? `停用记录「${id}」指向的不是用户级子智能体，运行时不认这条记录。`
      : `停用记录「${id}」没有对应的子智能体。`)
  }
  for (const [id, override] of Object.entries(settings.modelOverrides)) {
    if ((!override.model && !override.thoughtLevel) || !entriesById.has(id)) continue
    problems.push(`模型覆盖「${id}」没有对应的子智能体。`)
  }
  return problems
}

// ---- 持久化 ------------------------------------------------------------------

/** 读设置。缺省走 `localStorage`；坏存档/旧形状退回默认，永不抛（走 `src/agentSettingsStore.ts` 的窄接口）。 */
export function loadAgentSubagentsSettings(
  storage: SettingsStorage | null = defaultSettingsStorage(),
): AgentSubagentsSettings {
  return readSettingsJson(storage, AGENT_SUBAGENTS_STORAGE_KEY, normalizeAgentSubagentsSettings)
}

/** 写设置。存不下（配额满/隐私模式）时静默降级 —— 只丢持久化，不打断本次会话。 */
export function saveAgentSubagentsSettings(
  settings: AgentSubagentsSettings,
  storage: SettingsStorage | null = defaultSettingsStorage(),
): boolean {
  return writeSettingsJson(storage, AGENT_SUBAGENTS_STORAGE_KEY, settings)
}

// ---- Markdown 解析（格式已核实：YAML frontmatter） ---------------------------

/** 解析结果（ZCode `subagentMarkdown.ts:33-36`）：要么给出 agent，要么给出 diagnostic。 */
export interface AgentSubagentParseResult {
  agent?: AgentSubagent
  diagnostic?: AgentSubagentDiagnostic
}

export interface AgentSubagentParseOptions {
  /** 定义文件路径，进 diagnostic 文案（ZCode `subagentMarkdown.ts:46-47`）。 */
  path?: string
  /** 作用域，决定 `source` 与 `readOnly`（`subagentMarkdown.ts:65, 100`）。 */
  scope?: AgentSubagentScope
}

/** 切 frontmatter（ZCode `splitMarkdownFrontmatter`，`subagentMarkdown.ts:133-152`）：BOM 去掉 + CRLF 归一。 */
function splitMarkdownFrontmatter(content: string): { body: string; frontmatter?: string } {
  const normalized = content.replace(/^\uFEFF/u, '').replace(/\r\n/gu, '\n')
  const lines = normalized.startsWith('---') ? normalized.split('\n') : []
  if (lines[0]?.trim() !== '---') return { body: normalized }
  const endIndex = lines.findIndex((line, index) => index > 0 && line.trim() === '---')
  if (endIndex < 0) return { body: normalized }
  return { frontmatter: lines.slice(1, endIndex).join('\n'), body: lines.slice(endIndex + 1).join('\n') }
}

/** 去掉行尾注释（ZCode `stripInlineComment`，`subagentMarkdown.ts:227-239`）。 */
function stripInlineComment(value: string): string {
  let quote: string | undefined
  for (let index = 0; index < value.length; index += 1) {
    const char = value[index]
    if ((char === '"' || char === "'") && value[index - 1] !== '\\') quote = quote === char ? undefined : (quote ?? char)
    if (!quote && char === '#' && /\s/u.test(value[index - 1] ?? '')) return value.slice(0, index).trimEnd()
  }
  return value
}

function unquoteScalar(value: string): string {
  return (value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))
    ? value.slice(1, -1)
    : value
}

/** 标量值（ZCode `parseScalarValue`，`subagentMarkdown.ts:205-225`）。 */
function parseScalarValue(rawValue: string): unknown {
  const value = stripInlineComment(rawValue.trim())
  if (value === 'true') return true
  if (value === 'false') return false
  if (/^\d+$/u.test(value)) return Number(value)
  if (value.startsWith('[') && value.endsWith(']')) {
    return splitTopLevelList(value.slice(1, -1)).map((item) => unquoteScalar(stripInlineComment(item.trim())))
  }
  if (value.startsWith('{') && value.endsWith('}')) {
    try {
      return JSON.parse(value) as unknown
    } catch {
      // 非法 inline mapping 保留原字符串：下游严格 schema 会拒绝它，而不是让整个文件消失
      // （ZCode 注释，`subagentMarkdown.ts:219-221`）。
      return value
    }
  }
  return unquoteScalar(value)
}

/** 顶层逗号切分，引号与括号内的逗号不算（ZCode `splitTopLevelList`，`subagentMarkdown.ts:241-268`）。 */
function splitTopLevelList(value: string): string[] {
  const items: string[] = []
  let current = ''
  let quote: string | undefined
  let parenDepth = 0
  for (const char of value) {
    if ((char === '"' || char === "'") && !quote) { quote = char; current += char; continue }
    if (quote === char) { quote = undefined; current += char; continue }
    if (!quote && char === '(') parenDepth += 1
    if (!quote && char === ')') parenDepth = Math.max(0, parenDepth - 1)
    if (!quote && parenDepth === 0 && char === ',') {
      if (current.trim()) items.push(current.trim())
      current = ''
      continue
    }
    current += char
  }
  if (current.trim()) items.push(current.trim())
  return items
}

/**
 * 宽松 frontmatter 解析（ZCode `parseLooseFrontmatter`，`subagentMarkdown.ts:171-203`）。
 *
 * 这是 ZCode 在严格 YAML 之上**额外**铺的一层运行时兼容语义（`:154-169` 先 parseYaml 再用 loose 覆盖）。
 * 本仓不引 `yaml` 依赖（`package.json` 里没有），只实现 loose 这一层：
 * 标量、行内数组、`key:` 后的块状 `- item` 列表都覆盖到了；
 * **未覆盖**：`mcpServers` 的块状对象数组（ZCode 靠 strict YAML 的结果补回来，`subagentMarkdown.ts:167`）。
 * 那一格读出来会是空数组 —— 如实登记在文件头「诚实登记」里，不猜内容。
 */
function parseLooseFrontmatter(frontmatter: string): Record<string, unknown> {
  const values: Record<string, unknown> = {}
  let pendingListKey: string | undefined
  for (const rawLine of frontmatter.split(/\r?\n/u)) {
    const line = rawLine.trimEnd()
    if (!line.trim() || line.trimStart().startsWith('#')) continue
    const listMatch = line.match(/^\s*-\s+(.*)$/u)
    if (listMatch && pendingListKey) {
      const existing = Array.isArray(values[pendingListKey]) ? values[pendingListKey] as unknown[] : []
      values[pendingListKey] = [...existing, parseScalarValue(listMatch[1] ?? '')]
      continue
    }
    pendingListKey = undefined
    const keyValue = line.match(/^([A-Za-z][A-Za-z0-9_-]*)\s*:\s*(.*)$/u)
    if (!keyValue) continue
    const key = keyValue[1]!
    const rawValue = keyValue[2] ?? ''
    if (rawValue.trim() === '') { values[key] = []; pendingListKey = key; continue }
    values[key] = parseScalarValue(rawValue)
  }
  return values
}

/** 工具规格表（ZCode `parseToolSpecList`，`subagentMarkdown.ts:332-355`）：括号深度 0 处的逗号/空格才切。 */
function parseToolSpecList(value: unknown): string[] | undefined {
  if (Array.isArray(value)) return normalizeStringList(value)
  if (typeof value !== 'string') return undefined
  const result: string[] = []
  let current = ''
  let parenDepth = 0
  for (const char of value) {
    if (char === '(') parenDepth += 1
    if (char === ')') parenDepth = Math.max(0, parenDepth - 1)
    if (parenDepth === 0 && (char === ',' || /\s/u.test(char))) {
      if (current.trim()) result.push(current.trim())
      current = ''
      continue
    }
    current += char
  }
  if (current.trim()) result.push(current.trim())
  return result.length > 0 ? result : undefined
}

/** 字符串表（ZCode `parseStringList`，`subagentMarkdown.ts:317-330`）：数组或逗号/空白分隔的字符串都收。 */
function parseStringList(value: unknown): string[] | undefined {
  if (Array.isArray(value)) return normalizeStringList(value)
  if (typeof value !== 'string') return undefined
  const list = value.split(/[,\s]+/u).map((item) => item.trim()).filter(Boolean)
  return list.length > 0 ? list : undefined
}

function parseOptionalBoolean(value: unknown): boolean | undefined {
  if (typeof value === 'boolean') return value
  if (typeof value !== 'string') return undefined
  if (value.toLowerCase() === 'true') return true
  if (value.toLowerCase() === 'false') return false
  return undefined
}

function missingRequiredDiagnostic(field: string, path: string): AgentSubagentParseResult {
  return {
    diagnostic: {
      code: 'agent_missing_required_frontmatter',
      message: `Agent frontmatter must include ${field}: ${path}`,
      path,
    },
  }
}

/**
 * 解析一份子智能体定义。**格式已核实 = Markdown + YAML frontmatter**
 * （ZCode `services/src/subagents/subagentMarkdown.ts:38-103`），不是 JSON。
 * 所以这里没有「显式传入格式」的那一格 —— 需求里那个假设已被源码否掉，如实记在下面。
 *
 * 行为与 ZCode 对齐：
 *   · 没有 frontmatter → `agent_missing_frontmatter`（`subagentMarkdown.ts:42-50`）。
 *   · `name` / `description` 缺一不可 → `agent_missing_required_frontmatter`（`:56-63, 280-288`）。
 *   · 非法颜色/权限模式/轮数**丢字段不报错**（`normalizeEnum` / `normalizePositiveInteger`，`:67-69, 294-315`）。
 *   · `source` 由 `scope` 推导（`:65`），`readOnly` 只对内置为真（`:100`）。
 */
export function parseSubagentMarkdown(
  raw: string,
  options: AgentSubagentParseOptions = {},
): AgentSubagentParseResult {
  const path = options.path ?? ''
  const scope = options.scope ?? 'user'
  const content = typeof raw === 'string' ? raw : ''
  const parsed = splitMarkdownFrontmatter(content)
  if (!parsed.frontmatter) {
    return {
      diagnostic: {
        code: 'agent_missing_frontmatter',
        message: `Agent Markdown must include frontmatter: ${path}`,
        path,
      },
    }
  }
  const frontmatter = parseLooseFrontmatter(parsed.frontmatter)
  const name = scalarString(frontmatter.name)
  if (!name) return missingRequiredDiagnostic('name', path)
  const description = scalarString(frontmatter.description)?.replace(/\\n/gu, '\n')
  if (!description) return missingRequiredDiagnostic('description', path)
  const source: AgentSubagentSource = scope === 'built-in' ? 'built-in' : 'user'
  const agent: AgentSubagent = {
    id: agentSubagentStateId(source, scope, name),
    name,
    description,
    systemPrompt: parsed.body.trim(),
    path,
    scope,
    source,
    enabled: true,
    readOnly: scope === 'built-in',
  }
  const color = normalizeColor(frontmatter.color)
  if (color) agent.color = color
  const model = scalarString(frontmatter.model)
  if (model && !INHERIT_SET.has(model)) agent.model = model
  // 同上：有值才写，缺声明与显式 undefined 是两件事（ZCode `:83-92` 的条件展开）。
  const optional: Array<[keyof AgentSubagent, unknown]> = [
    ['thoughtLevel', scalarString(frontmatter.thoughtLevel)],
    ['tools', parseToolSpecList(frontmatter.tools)],
    ['disallowedTools', parseToolSpecList(frontmatter.disallowedTools)],
    ['skills', parseStringList(frontmatter.skills)],
    ['permissionMode', normalizePermissionMode(frontmatter.permissionMode)],
    ['maxTurns', normalizePositiveInteger(frontmatter.maxTurns)],
  ]
  for (const [key, value] of optional) {
    if (value !== undefined) (agent as unknown as Record<string, unknown>)[key] = value
  }
  const background = parseOptionalBoolean(frontmatter.background)
  if (background !== undefined) agent.background = background
  const injectAgentsMd = parseOptionalBoolean(frontmatter.injectAgentsMd)
  agent.injectAgentsMd = injectAgentsMd !== undefined ? injectAgentsMd : true
  if (Array.isArray(frontmatter.mcpServers) && frontmatter.mcpServers.length > 0) {
    agent.mcpServers = [...frontmatter.mcpServers]
  }
  return { agent }
}
