// 「子智能体」与「钩子」两节的**写面**逻辑：表单形状、校验、增删改、推理档位解析、
// 作用域解析、工作区钩子信任门控。纯 TS，零 Vue、零 DOM、零网络。
//
// 为什么单独一个文件：`src/agentSubagents.ts` / `src/agentHooks.ts` 是这两节的**只读面**
// （形状 + 解析 + 能力投影 + 缺口文案）；本文件是**写面**（表单草稿、保存前校验、CRUD、
// 档位与作用域解析、信任门控）。共用同一套存储机制（`src/agentSettingsStore.ts`）与同一套
// 作用域语义，所以放一个文件、分两组导出，而不是两个各自抄一遍 scope 的文件。
//
// 本文件**不**重复只读面已有的东西（条目归一化、能力投影、命令拆分、信任态码表、档位词条表），
// 一律 import 复用 —— 抄第二份必然漂。
//
// —— 字段 / 规则出处（逐条对账）——
// 【子智能体表单】`packages/ui/src/settings/SubagentsSection.tsx`
//   :295-319 草稿形状（color 缺省 yellow :310、injectAgentsMd 缺省 true :313、inheritAllTools=tools 空 :314）
//   :86 继承哨兵 `inherit`；:190-193 折 undefined；:195-199 反向折叠
//   :201-214 模型三件套（reasoningLevel 有值才带 options）；:891-899 名字 3..50；:929-943 长度/字符集
//   :947-966 描述与提示词必填；:968-981 模型可用 + 档位；:1010-1026 提交体
//   :175-183 mergeTools；:167-173 known/preserved；:185-188 allowsAllTools（`*`=全部）
//   :1566-1600 作用域筛选与搜索命中字段；:144-158 启用开关/行内覆盖判定；:132-138 可编辑
//   :1508-1522 覆盖写入（内置按名 / 插件按 plugin:<id>:<裸名>）；:1455-1457 删除门控
// 【颜色】`packages/ui/src/lib/subagentColors.ts:3-12` SUBAGENT_COLORS（表单顺序，SubagentsSection.tsx:83）
// 【模型值编解码】`packages/shared/src/custom-model-value.ts:1,16-23,25-53`（前缀 `custom:`，含 `builtin:` 旧形状）
// 【推理档】`packages/ui/src/settings/SubagentReasoningField.tsx:7-11` 四态；:42-63 不可用文案
//   `SubagentsSection.tsx:218-278` 状态解析 / 可用性 / 生效档位；`packages/ui/src/lib/modelThoughtOption.ts:5-34`
//   （候选来自 `optionSpecs.reasoningLevel.values`；currentValue 非法置 `""`）
//   `packages/ui/src/chat-input-toolbar/thoughtLevelOptions.ts:7-16,18-40,42-44,47-48,50-52`
// 【钩子表单】`packages/ui/src/settings/HookForm.tsx`
//   :35-43 事件七值（真源 `packages/shared/src/hooks.ts:4-11`）；:212 运行方式顺序 process/command（`hooks.ts:13`）
//   :90-105 草稿初值（event PreToolUse / type process / timeout 60 / storageLevel）；:107-115 自定义 JSON 合法判据
//   :116 可保存条件；:118-158 保存投影（matcher/statusMessage trim→undefined；process 只带 args；
//   command 只带 async+shell；timeout parseInt||60；enabled ?? true）
// 【工作区钩子信任】`packages/ui/src/settings/WorkspaceHookTrustNotice.tsx:6-8,14-34`（四道门）；:49 文案
//   `HooksList.tsx:294-303` 开关门控；`HooksSection.tsx:44-60` 分组、:206-222 作用域、:578-590 搜索、
//   :322-329 失效回落；`PluginScopeMenu.tsx:17-33` 连接判定；`lib/workspaceKey.ts:5-7` scope key
import {
  defaultSettingsStorage,
  readSettingsJson,
  writeSettingsJson,
  type SettingsStorage,
} from './agentSettingsStore.ts'
import {
  AGENT_THOUGHT_LEVEL_TEXT,
  NO_THOUGHT_LEVEL_VALUES,
  THOUGHT_LEVEL_LABEL_IDS,
  getThoughtLevelLabelText,
} from './agentComposerControls.ts'
import {
  AGENT_HOOK_DEFAULT_TIMEOUT_SECONDS,
  AGENT_HOOK_TIMEOUT_MIN_SECONDS,
  AGENT_HOOK_TIMEOUT_MAX_SECONDS,
  requiresWorkspaceHookTrust,
  type AgentHook,
  type AgentHookEvent,
  type AgentHookScope,
  type AgentHookType,
} from './agentHooks.ts'
import {
  AGENT_SUBAGENT_RISKY_TOOLS,
  AGENT_SUBAGENT_ZCODE_TOOL_OPTIONS,
  normalizeAgentSubagentsSettings,
  subagentCapabilities,
  validateAgentSubagentsSettings,
  type AgentSubagent,
  type AgentSubagentColor,
} from './agentSubagents.ts'

/** 子智能体注册表（写面）的存储键。与只读面的 `taocode.agent.subagents.settings` 分开。 */
export const AGENT_SUBAGENT_REGISTRY_STORAGE_KEY = 'taocode.agent.subagents.registry'

/** 展示态模型值前缀（`custom-model-value.ts:1`）。 */
export const SUBAGENT_CUSTOM_MODEL_PREFIX = 'custom:'

/** 「继承默认」哨兵（`SubagentsSection.tsx:86`）。 */
export const SUBAGENT_INHERIT_MODEL_VALUE = 'inherit'

/** 名字长度区间（`SubagentsSection.tsx:891-899`）。 */
export const SUBAGENT_NAME_MIN_LENGTH = 3
export const SUBAGENT_NAME_MAX_LENGTH = 50

/** 新建缺省颜色（`SubagentsSection.tsx:310`）。 */
export const SUBAGENT_DEFAULT_COLOR: AgentSubagentColor = 'yellow'

/** 颜色档顺序（`subagentColors.ts:3-12`；表单取它，`SubagentsSection.tsx:83`）。 */
export const SUBAGENT_FORM_COLOR_ORDER: readonly AgentSubagentColor[] = Object.freeze([
  'yellow', 'red', 'orange', 'green', 'cyan', 'blue', 'purple', 'pink',
])

/** 工具候选与风险工具（`SubagentsSection.tsx:87-97, 99`）。**ZCode 那边的档位**，见 agentSubagents.ts 诚实登记。 */
export const SUBAGENT_TOOL_OPTIONS = AGENT_SUBAGENT_ZCODE_TOOL_OPTIONS
export const SUBAGENT_RISKY_TOOLS = AGENT_SUBAGENT_RISKY_TOOLS

const SUBAGENT_TOOL_OPTION_SET = new Set<string>(SUBAGENT_TOOL_OPTIONS)

// ── 模型值编解码（custom-model-value.ts:1,16-23,25-53） ──────────────────

/** 展示态模型值：两端各做 URI 编码（`custom-model-value.ts:16-23`）。 */
export function encodeSubagentModelValue(providerId: string, modelId?: string): string {
  const provider = encodeURIComponent(String(providerId ?? ''))
  if (!modelId) return `${SUBAGENT_CUSTOM_MODEL_PREFIX}${provider}`
  return `${SUBAGENT_CUSTOM_MODEL_PREFIX}${provider}:${encodeURIComponent(String(modelId))}`
}

function safeDecode(value: string): string {
  // 与 `custom-model-value.ts:5-11` 同口径：解不开就原样返回，不抛。
  try { return decodeURIComponent(value) } catch { return value }
}

/** 解码展示态模型值；不是 `custom:` 形状返回 null。含 `builtin:` 旧形状（`:39-44`）。 */
export function decodeSubagentModelValue(value: string): { providerId: string; modelId: string } | null {
  if (typeof value !== 'string' || !value.startsWith(SUBAGENT_CUSTOM_MODEL_PREFIX)) return null
  const body = value.slice(SUBAGENT_CUSTOM_MODEL_PREFIX.length)
  const separatorIndex = body.indexOf(':')
  if (separatorIndex < 0) {
    const providerId = safeDecode(body)
    return providerId ? { providerId, modelId: '' } : null
  }
  const legacyParts = body.split(':')
  if (legacyParts.length >= 3 && legacyParts[0] === 'builtin') {
    return { providerId: `${legacyParts[0]}:${legacyParts[1]}`, modelId: safeDecode(legacyParts.slice(2).join(':')) }
  }
  return { providerId: safeDecode(body.slice(0, separatorIndex)), modelId: safeDecode(body.slice(separatorIndex + 1)) }
}

/** 持久化用：空或 `inherit` 折成 undefined（`SubagentsSection.tsx:190-193`）。 */
export function toPersistedSubagentModel(model: string | undefined): string | undefined {
  const trimmed = typeof model === 'string' ? model.trim() : ''
  return trimmed && trimmed !== SUBAGENT_INHERIT_MODEL_VALUE ? trimmed : undefined
}

/** 草稿用：没有模型就显示 `inherit`（`SubagentsSection.tsx:195-199`）。 */
export function toSubagentModelDraftValue(model: string | undefined): string {
  return toPersistedSubagentModel(model) ?? SUBAGENT_INHERIT_MODEL_VALUE
}

/** 模型选择三件套（`SubagentsSection.tsx:201-214`）。 */
export interface AgentSubagentModelSelection {
  providerId: string
  modelId: string
  options?: { reasoningLevel: string }
}

/** 模型值 → Selection。先试 `custom:` 解码，再按 `provider/model` 切（`zcodeSessionProjection.ts:74-86`）。 */
export function toSubagentModelSelection(
  model: string | undefined,
  thoughtLevel?: string,
): AgentSubagentModelSelection | undefined {
  const persisted = toPersistedSubagentModel(model)
  if (!persisted) return undefined
  const decoded = decodeSubagentModelValue(persisted)
  let selection: { providerId: string; modelId: string } | null = null
  if (decoded && decoded.modelId) selection = decoded
  else {
    const index = persisted.indexOf('/')
    if (index > 0 && index < persisted.length - 1) {
      selection = { providerId: persisted.slice(0, index), modelId: persisted.slice(index + 1) }
    }
  }
  if (!selection) return undefined
  const reasoningLevel = typeof thoughtLevel === 'string' ? thoughtLevel.trim() : ''
  return reasoningLevel
    ? { providerId: selection.providerId, modelId: selection.modelId, options: { reasoningLevel } }
    : { providerId: selection.providerId, modelId: selection.modelId }
}

// ── 推理档位（SubagentReasoningField.tsx:7-11 + SubagentsSection.tsx:218-278） ──

/** 档位候选（`modelThoughtOption.ts:29-32`）。 */
export interface SubagentThoughtLevelOption {
  value: string
  name: string
}

/** 四态，逐字取 `SubagentReasoningField.tsx:7-11`。 */
export type SubagentReasoningState =
  | { kind: 'not-applicable' }
  | { kind: 'unknown'; status: 'loading' | 'unavailable' }
  | { kind: 'unsupported' }
  | { kind: 'supported'; option: { type: 'select'; currentValue: string; options: SubagentThoughtLevelOption[] } }

/**
 * 能本地化出中文名的档位值集合（键序 = `thoughtLevelOptions.ts:18-40`）。
 * **不是**某个模型的候选表 —— 候选来自 provider 目录的 `optionSpecs.reasoningLevel.values`。
 */
export const SUBAGENT_THOUGHT_LEVEL_VALUES: readonly string[] = Object.freeze(Object.keys(THOUGHT_LEVEL_LABEL_IDS))

/** 档位值 → 中文（值→词条 id 见 thoughtLevelOptions.ts:18-40；词条 id→原文 zh-CN.ts:4548-4556）。 */
export const SUBAGENT_THOUGHT_LEVEL_LABELS: Readonly<Record<string, string>> = Object.freeze(
  Object.fromEntries(Object.entries(THOUGHT_LEVEL_LABEL_IDS).map(([value, id]) => [value, AGENT_THOUGHT_LEVEL_TEXT[id] ?? value])),
)

/** 档位展示名：trim+小写查表，表外回落 provider 自己的档位名（`thoughtLevelOptions.ts:42-44,47-48,80-88`）。 */
export function subagentThoughtLevelLabel(value: string): string {
  const raw = typeof value === 'string' ? value : ''
  return getThoughtLevelLabelText(raw, raw)
}

/** 是不是「关闭」类档位（`thoughtLevelOptions.ts:7-16,54-56`）。 */
export function isNoSubagentThoughtLevel(value: string): boolean {
  const key = typeof value === 'string' ? value.trim().toLowerCase() : ''
  return NO_THOUGHT_LEVEL_VALUES.has(key)
}

/** 模型候选里有没有这个模型（`SubagentsSection.tsx:280-293`；加载中一律当可用）。 */
export function isSubagentModelAvailable(
  modelValues: readonly string[],
  model: string | undefined,
  modelSelectionLoading = false,
): boolean {
  const trimmed = typeof model === 'string' ? model.trim() : ''
  if (!trimmed || trimmed === SUBAGENT_INHERIT_MODEL_VALUE) return true
  if (modelSelectionLoading) return true
  return (modelValues ?? []).some((value) => value === trimmed)
}

/** 四步状态解析，与 `SubagentsSection.tsx:218-252` 同序。 */
export function resolveSubagentReasoningState(params: {
  model: string | undefined
  modelAvailable: boolean
  option?: { type: 'select'; currentValue: string; options: SubagentThoughtLevelOption[] } | null
  modelSelectionLoading: boolean
  thoughtLevel?: string
}): SubagentReasoningState {
  const persisted = toPersistedSubagentModel(params.model)
  if (!persisted || !params.modelAvailable) return { kind: 'not-applicable' }
  const explicit = typeof params.thoughtLevel === 'string' ? params.thoughtLevel.trim() : ''
  const option = params.option ?? null
  if (option) {
    // `modelThoughtOption.ts:25-28`：currentValue 不在候选内时置空串（不猜一个档位）。
    const current = explicit && option.options.some((entry) => entry.value === explicit) ? explicit : ''
    return { kind: 'supported', option: { type: 'select', currentValue: current, options: option.options } }
  }
  if (params.modelSelectionLoading) return { kind: 'unknown', status: 'loading' }
  return { kind: 'unsupported' }
}

/** 档位可用性（`SubagentsSection.tsx:254-272`）：空恒合法；unknown/not-applicable 不判死；unsupported 判死。 */
export function isSubagentThoughtLevelAvailable(
  state: SubagentReasoningState,
  thoughtLevel: string | undefined,
): boolean {
  const normalized = typeof thoughtLevel === 'string' ? thoughtLevel.trim() : ''
  if (!normalized) return true
  if (state.kind === 'unknown' || state.kind === 'not-applicable') return true
  if (state.kind === 'unsupported') return false
  return state.option.options.some((entry) => entry.value === normalized)
}

/** 生效档位（`SubagentsSection.tsx:274-278`）。 */
export function resolvedSubagentThoughtLevel(state: SubagentReasoningState): string | undefined {
  return state.kind === 'supported' && state.option.currentValue ? state.option.currentValue : undefined
}

// ── 表单草稿 / 校验 / 提交体（SubagentsSection.tsx:295-319, 926-982, 1010-1026） ──

/** 表单草稿（`SubagentsSection.tsx:113-124`）。 */
export interface AgentSubagentFormDraft {
  name: string
  description: string
  color: AgentSubagentColor
  /** 展示态模型值；`inherit` = 继承默认。 */
  model: string
  thoughtLevel: string
  injectAgentsMd: boolean
  inheritAllTools: boolean
  selectedTools: string[]
  preservedTools: string[]
  systemPrompt: string
}

/** 草稿初值（`SubagentsSection.tsx:295-319`）。 */
export function createAgentSubagentFormDraft(
  initial?: Pick<AgentSubagent, 'name' | 'description' | 'color' | 'model' | 'thoughtLevel' | 'tools' | 'systemPrompt' | 'injectAgentsMd'>,
): AgentSubagentFormDraft {
  const tools = initial?.tools
  return {
    name: initial?.name ?? '',
    description: initial?.description ?? '',
    color: initial?.color ?? SUBAGENT_DEFAULT_COLOR,
    model: toSubagentModelDraftValue(initial?.model),
    thoughtLevel: initial?.thoughtLevel ?? '',
    injectAgentsMd: initial?.injectAgentsMd ?? true,
    inheritAllTools: tools === undefined || tools.length === 0,
    selectedTools: (tools ?? []).filter((tool) => SUBAGENT_TOOL_OPTION_SET.has(tool)),
    preservedTools: (tools ?? []).filter((tool) => !SUBAGENT_TOOL_OPTION_SET.has(tool)),
    systemPrompt: initial?.systemPrompt ?? '',
  }
}

/** 草稿稳定 key（目的同 `SubagentsSection.tsx:321-326`：快照变了才回灌表单）。 */
export function agentSubagentFormDraftKey(draft: AgentSubagentFormDraft): string {
  return JSON.stringify([
    draft?.name, draft?.description, draft?.color, draft?.model, draft?.thoughtLevel,
    draft?.injectAgentsMd, draft?.inheritAllTools, draft?.selectedTools, draft?.preservedTools, draft?.systemPrompt,
  ])
}

/** 保存前校验结果。文案逐字取 zh-CN `settings.subagents.form.validation.*`（:3671-3676）。 */
export interface AgentSubagentFormValidation {
  ok: boolean
  nameError: string | null
  descriptionError: string | null
  promptError: string | null
  modelError: string | null
  thoughtLevelInvalid: boolean
}

/** 表单校验（`SubagentsSection.tsx:926-982`）：名字长度与字符集互斥（:929-943 是 else-if）。 */
export function validateAgentSubagentForm(
  draft: AgentSubagentFormDraft,
  options: { modelAvailable: boolean; thoughtLevelAvailable: boolean },
): AgentSubagentFormValidation {
  const name = typeof draft?.name === 'string' ? draft.name.trim() : ''
  let nameError: string | null = null
  if (name.length < SUBAGENT_NAME_MIN_LENGTH || name.length > SUBAGENT_NAME_MAX_LENGTH) {
    nameError = `长度必须在 ${SUBAGENT_NAME_MIN_LENGTH} 到 ${SUBAGENT_NAME_MAX_LENGTH} 个字符之间`
  } else if (!/^[a-zA-Z0-9-]+$/u.test(name)) {
    nameError = '仅允许使用字母、数字和连字符'
  }
  const descriptionError = typeof draft?.description === 'string' && draft.description.trim() ? null : '描述不能为空'
  const promptError = typeof draft?.systemPrompt === 'string' && draft.systemPrompt.trim() ? null : '系统提示词不能为空'
  const modelError = options.modelAvailable ? null : '保存前请选择可用模型'
  return {
    ok: nameError === null && descriptionError === null && promptError === null && modelError === null && options.thoughtLevelAvailable,
    nameError, descriptionError, promptError, modelError,
    thoughtLevelInvalid: !options.thoughtLevelAvailable,
  }
}

/** 提交给宿主的 `SubAgentConfig` 子集（`SubagentsSection.tsx:1010-1026`）。 */
export interface AgentSubagentFormSubmission {
  name: string
  description: string
  systemPrompt: string
  color: AgentSubagentColor
  injectAgentsMd: boolean
  modelSelection?: AgentSubagentModelSelection
  tools?: string[]
}

/** 工具合并（`SubagentsSection.tsx:175-183`）：去空去重，空数组折回 undefined。 */
export function mergeAgentSubagentTools(selected: readonly string[], preserved: readonly string[]): string[] | undefined {
  const merged = [...(selected ?? []), ...(preserved ?? [])]
    .filter((tool, index, all) => typeof tool === 'string' && tool.length > 0 && all.indexOf(tool) === index)
  return merged.length > 0 ? merged : undefined
}

/** 草稿 → 提交体（`SubagentsSection.tsx:1010-1026`）：三文本 trim、继承工具折 undefined。 */
export function agentSubagentFormSubmission(draft: AgentSubagentFormDraft): AgentSubagentFormSubmission {
  const selection = toSubagentModelSelection(draft?.model, draft?.thoughtLevel)
  return {
    name: typeof draft?.name === 'string' ? draft.name.trim() : '',
    description: typeof draft?.description === 'string' ? draft.description.trim() : '',
    systemPrompt: typeof draft?.systemPrompt === 'string' ? draft.systemPrompt.trim() : '',
    color: draft?.color ?? SUBAGENT_DEFAULT_COLOR,
    injectAgentsMd: draft?.injectAgentsMd !== false,
    ...(selection ? { modelSelection: selection } : {}),
    ...(draft?.inheritAllTools ? {} : { tools: mergeAgentSubagentTools(draft?.selectedTools ?? [], draft?.preservedTools ?? []) }),
  }
}

// ── 注册表（CRUD + 覆盖层 + 校验 + 持久化） ──────────────────────────────

/**
 * 注册表状态：用户维护的条目 + 同一套覆盖层（停用表 + 模型覆盖，语义照 `agents-state.json`，
 * 见 `src/agentSubagents.ts:152-161`）。
 */
export interface AgentSubagentRegistrySettings {
  entries: AgentSubagent[]
  disabledAgentIds: string[]
  modelOverrides: Record<string, { model: string; thoughtLevel?: string }>
}

export function defaultAgentSubagentRegistry(): AgentSubagentRegistrySettings {
  return { entries: [], disabledAgentIds: [], modelOverrides: {} }
}

/** 插件 agent 的稳定 id（`subagents-types.ts:148-150`；服务端传**裸名**，`subagentsService.ts:329,372`）。 */
function pluginAgentStateId(pluginId: string, agentName: string): string {
  return `plugin:${pluginId}:${agentName.trim().toLowerCase()}`
}

/** 裸名：`pluginName:name` 形式取冒号之后那段（`SubagentsSection.tsx:492-495`）。 */
function barePluginAgentName(name: string): string {
  const colon = name.indexOf(':')
  return colon < 0 ? name : name.slice(colon + 1)
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** 单条救法：条目归一化交给只读面（`src/agentSubagents.ts:380-438`），再修正插件 id 形式。 */
function normalizeRegistryEntry(item: unknown): AgentSubagent | null {
  if (!isRecord(item)) return null
  const entry = normalizeAgentSubagentsSettings({ entries: [item] }).entries[0]
  if (!entry) return null
  const pluginId = entry.pluginId?.trim()
  if (entry.source !== 'plugin' || !pluginId) return entry
  return { ...entry, id: pluginAgentStateId(pluginId, barePluginAgentName(entry.name)) }
}

/**
 * 归一化注册表。**永不抛、永不返回坏值**（条目归一化复用只读面，本仓铁律：不许按字段数量
 * 判损坏，真出过把用户锁在项目外的事故）。`enabled` 一律由 `disabledAgentIds` 现算，
 * 只对 user scope 生效（`subagentsService.ts:287`）。
 */
export function normalizeAgentSubagentRegistry(input: unknown): AgentSubagentRegistrySettings {
  const base = normalizeAgentSubagentsSettings(input)
  const disabledSet = new Set(base.disabledAgentIds)
  const entries: AgentSubagent[] = []
  for (const entry of base.entries) {
    const normalized = normalizeRegistryEntry(entry)
    if (!normalized) continue
    entries.push({ ...normalized, enabled: normalized.scope === 'user' ? !disabledSet.has(normalized.id) : true })
  }
  return { entries, disabledAgentIds: base.disabledAgentIds, modelOverrides: base.modelOverrides }
}

/**
 * 一条条目的模型覆盖键。两条真实路径（`SubagentsSection.tsx:1508-1522`）：
 * 内置 `general-purpose` / `Explore` 用**名字**（`subagents-types.ts:9-11`）；
 * 插件用 `plugin:<pluginId>:<裸名小写>`（`subagents-types.ts:148-150`）。其余 → null。
 */
export function agentSubagentModelOverrideKey(entry: AgentSubagent): string | null {
  if (!entry) return null
  if ((entry.scope === 'built-in' || entry.source === 'built-in') && (entry.name === 'general-purpose' || entry.name === 'Explore')) {
    return entry.name
  }
  if (entry.source === 'plugin') {
    const pluginId = entry.pluginId?.trim() ?? ''
    return pluginId ? pluginAgentStateId(pluginId, barePluginAgentName(entry.name)) : null
  }
  return null
}

/**
 * 保存前校验：条目与停用表复用只读面（`src/agentSubagents.ts:460-493`，同一批硬问题与文案），
 * 这里**只补**模型覆盖键的核对 —— 覆盖键是名字 / plugin id 形式，不是 entry.id，
 * 只读面拿 entry.id 对不上，会误报（所以那边传空覆盖表，这边自己判）。
 */
export function validateAgentSubagentRegistry(settings: AgentSubagentRegistrySettings): string[] {
  const problems = validateAgentSubagentsSettings({
    entries: Array.isArray(settings?.entries) ? settings.entries : [],
    disabledAgentIds: Array.isArray(settings?.disabledAgentIds) ? settings.disabledAgentIds : [],
    modelOverrides: {},
    query: '',
    scopeFilter: 'all',
  })
  const entries = Array.isArray(settings?.entries) ? settings.entries : []
  for (const key of Object.keys(isRecord(settings?.modelOverrides) ? settings.modelOverrides : {})) {
    if (!entries.some((entry) => agentSubagentModelOverrideKey(entry) === key)) {
      problems.push(`模型覆盖「${key}」没有对应的子智能体。`)
    }
  }
  return problems
}

/** 可编辑（`SubagentsSection.tsx:132-138`）。 */
export function isEditableUserSubagent(entry: AgentSubagent): boolean {
  return subagentCapabilities(entry).editable
}

/** 有没有启用开关（`SubagentsSection.tsx:144-146`：**只有 user scope**）。 */
export function supportsSubagentEnabledToggle(entry: AgentSubagent): boolean {
  return subagentCapabilities(entry).supportsEnabledToggle
}

/** 能不能行内覆盖模型（`SubagentsSection.tsx:156-158`）。 */
export function supportsSubagentModelOverride(entry: AgentSubagent): boolean {
  return subagentCapabilities(entry).supportsModelOverride
}

/** 插入或覆盖一条（按 id 认）。返回新清单，不改原数组。 */
export function upsertAgentSubagentRegistryEntry(
  settings: AgentSubagentRegistrySettings,
  entry: AgentSubagent,
): AgentSubagentRegistrySettings {
  const base = settings ?? defaultAgentSubagentRegistry()
  const normalized = normalizeRegistryEntry(entry)
  if (!normalized) return base
  const entries = (base.entries ?? []).filter((item) => item.id !== normalized.id)
  const enabled = normalized.scope === 'user' ? !base.disabledAgentIds.includes(normalized.id) : true
  entries.push({ ...normalized, enabled })
  return { ...base, entries }
}

/** 删一条。非可编辑条目删不动（`SubagentsSection.tsx:1455-1457`）。 */
export function removeAgentSubagentRegistryEntry(
  settings: AgentSubagentRegistrySettings,
  entryId: string,
): AgentSubagentRegistrySettings {
  const base = settings ?? defaultAgentSubagentRegistry()
  return {
    ...base,
    entries: (base.entries ?? []).filter((item) => !(item.id === entryId && isEditableUserSubagent(item))),
    disabledAgentIds: (base.disabledAgentIds ?? []).filter((id) => id !== entryId),
  }
}

/** 拨启用（`SubagentsSection.tsx:1487-1505`）：只有 supportsEnabledToggle 的条目能拨，其余静默不动。 */
export function setAgentSubagentRegistryEnabled(
  settings: AgentSubagentRegistrySettings,
  entryId: string,
  enabled: boolean,
): AgentSubagentRegistrySettings {
  const base = settings ?? defaultAgentSubagentRegistry()
  const target = (base.entries ?? []).find((entry) => entry.id === entryId)
  if (!target || !supportsSubagentEnabledToggle(target)) return base
  const disabled = (base.disabledAgentIds ?? []).filter((id) => id !== entryId)
  if (!enabled) disabled.push(entryId)
  return {
    ...base,
    disabledAgentIds: disabled,
    entries: (base.entries ?? []).map((entry) => (entry.id === entryId ? { ...entry, enabled: Boolean(enabled) } : entry)),
  }
}

/** 写/清一条模型覆盖。`null` = 清掉（回到继承）；无覆盖键的条目不动（`SubagentsSection.tsx:1510-1513`）。 */
export function setAgentSubagentModelOverride(
  settings: AgentSubagentRegistrySettings,
  entryId: string,
  override: { model?: string; thoughtLevel?: string } | null,
): AgentSubagentRegistrySettings {
  const base = settings ?? defaultAgentSubagentRegistry()
  const target = (base.entries ?? []).find((entry) => entry.id === entryId)
  const key = target ? agentSubagentModelOverrideKey(target) : null
  if (!key) return base
  const overrides = { ...(base.modelOverrides ?? {}) }
  const model = toPersistedSubagentModel(override?.model) ?? ''
  const thoughtLevel = typeof override?.thoughtLevel === 'string' ? override.thoughtLevel.trim() : ''
  if (!override || (!model && !thoughtLevel)) delete overrides[key]
  else overrides[key] = thoughtLevel ? { model, thoughtLevel } : { model }
  return { ...base, modelOverrides: overrides }
}

/** 按查询词过滤（命中字段照 `SubagentsSection.tsx:1581-1598`）。 */
export function filterAgentSubagentRegistry(entries: readonly AgentSubagent[], query: string): AgentSubagent[] {
  const list = Array.isArray(entries) ? entries : []
  const keyword = typeof query === 'string' ? query.trim().toLowerCase() : ''
  if (!keyword) return [...list]
  return list.filter((entry) => {
    if (!entry) return false
    return [entry.name, entry.description, entry.model, entry.path, entry.scope, entry.source,
      (entry.tools ?? []).join(' '), (entry.disallowedTools ?? []).join(' '), (entry.skills ?? []).join(' ')]
      .filter(Boolean).join(' ').toLowerCase().includes(keyword)
  })
}

/** 当前作用域可见条目（`SubagentsSection.tsx:1566-1580`）。 */
export function filterAgentSubagentsForScope(
  entries: readonly AgentSubagent[],
  scope: 'user' | 'workspace',
): AgentSubagent[] {
  return (Array.isArray(entries) ? entries : []).filter((entry) => {
    if (!entry) return false
    if (scope === 'user') return entry.scope !== 'workspace'
    return !(entry.scope === 'built-in' || entry.source === 'built-in') && entry.scope === 'workspace'
  })
}

/** 读注册表（缺省 localStorage；坏档 / 旧形状退回默认，永不抛）。 */
export function loadAgentSubagentRegistry(storage: SettingsStorage | null = defaultSettingsStorage()): AgentSubagentRegistrySettings {
  return readSettingsJson(storage, AGENT_SUBAGENT_REGISTRY_STORAGE_KEY, normalizeAgentSubagentRegistry)
}

/** 写注册表。存不下（配额满 / 隐私模式）时静默降级。 */
export function saveAgentSubagentRegistry(
  settings: AgentSubagentRegistrySettings,
  storage: SettingsStorage | null = defaultSettingsStorage(),
): boolean {
  return writeSettingsJson(storage, AGENT_SUBAGENT_REGISTRY_STORAGE_KEY, settings)
}

// ── 钩子表单（HookForm.tsx:90-158） ──────────────────────────────────────

/** 钩子表单草稿（`HookForm.tsx:90-105`）。 */
export interface AgentHookFormDraft {
  event: AgentHookEvent
  type: AgentHookType
  matcher: string
  command: string
  /** 多行文本，每行一个 argv（`:100`）。 */
  argsText: string
  async: boolean
  shell: string
  statusMessage: string
  /** 表单里是字符串，保存时才 parseInt（`:104, :154`）。 */
  timeoutText: string
  customJson: string
  storageLevel: AgentHookScope
}

/**
 * 表单初值（`HookForm.tsx:90-105`）。`custom` 单独传：ZCode 的 `Hook.custom`（`hooks.ts:57`）在
 * `:105` 被读成展示态，而本仓 `AgentHook`（`src/agentHooks.ts:140-165`）没有这一格 ——
 * 调用方有就传，没有就是空串，不假装从 hook 上能读到。
 */
export function createAgentHookFormDraft(options: {
  hook?: AgentHook
  custom?: Record<string, unknown>
  workspaceAvailable?: boolean
  defaultStorageLevel?: AgentHookScope
} = {}): AgentHookFormDraft {
  const hook = options.hook
  const initialStorageLevel: AgentHookScope = hook?.scope === 'project' ? 'project' : 'user'
  const defaultStorageLevel: AgentHookScope = options.defaultStorageLevel === 'project' ? 'project' : 'user'
  return {
    event: hook?.event ?? 'PreToolUse',
    type: hook?.type ?? 'process',
    matcher: hook?.matcher ?? '',
    command: hook?.command ?? '',
    argsText: (hook?.args ?? []).join('\n'),
    async: hook?.async ?? false,
    shell: typeof hook?.shell === 'string' ? hook.shell : '',
    statusMessage: hook?.statusMessage ?? '',
    timeoutText: String(hook?.timeoutSeconds ?? AGENT_HOOK_DEFAULT_TIMEOUT_SECONDS),
    customJson: formatAgentHookCustomJson(options.custom),
    // `:90-93`：workspace 不可用时恒 user；可用时编辑态看 hook，新建态看 defaultStorageLevel。
    storageLevel: options.workspaceAvailable !== true ? 'user' : (hook ? initialStorageLevel : defaultStorageLevel),
  }
}

/** 自定义 JSON 展示态（`HookForm.tsx:45-47`）。 */
export function formatAgentHookCustomJson(custom?: Record<string, unknown>): string {
  return custom && Object.keys(custom).length > 0 ? JSON.stringify(custom, null, 2) : ''
}

/** 自定义 JSON 合法吗（`HookForm.tsx:107-115`）：空串合法；必须是 JSON **object**。 */
export function agentHookCustomJsonValid(customJson: string): boolean {
  const raw = typeof customJson === 'string' ? customJson : ''
  if (!raw.trim()) return true
  try {
    const parsed = JSON.parse(raw) as unknown
    return Boolean(parsed && typeof parsed === 'object' && !Array.isArray(parsed))
  } catch {
    return false
  }
}

/** 可保存吗（`HookForm.tsx:116`）：命令非空 **且** 自定义 JSON 合法。 */
export function agentHookFormCanSave(draft: AgentHookFormDraft): boolean {
  const command = typeof draft?.command === 'string' ? draft.command.trim() : ''
  return Boolean(command && agentHookCustomJsonValid(draft?.customJson ?? ''))
}

/** 表单落到哪一层（`HookForm.tsx:94-95`）。 */
export function agentHookFormScopeKey(draft: AgentHookFormDraft, initialWorkspaceKey: string): string {
  return draft?.storageLevel === 'project' ? initialWorkspaceKey : 'user'
}

/** 提交体（`HookForm.tsx:137-158`）。 */
export interface AgentHookSaveConfig {
  event: AgentHookEvent
  type: AgentHookType
  matcher?: string
  command: string
  args?: string[]
  async?: boolean
  shell?: string | true
  statusMessage?: string
  timeout: number
  enabled: boolean
  custom?: Record<string, unknown>
  storageLevel: AgentHookScope
}

/**
 * 保存时要读回的「原 hook」两格。`shell` 放宽成 `string | true`，因为 ZCode 的 `Hook.shell`
 * 就是 `true | string`（`hooks.ts:52`），`HookForm.tsx:151` 明确保留「原值是布尔 true」那一支；
 * 本仓 `AgentHook.shell` 只存字符串（`src/agentHooks.ts:152`），所以不假装 `AgentHook` 有那一格。
 */
export interface AgentHookSaveContext {
  enabled?: boolean
  shell?: string | true
}

/** 保存投影结果：要么配置，要么两条 JSON 错误之一（zh-CN.ts:4091-4092）。 */
export type AgentHookFormSaveResult = { config: AgentHookSaveConfig } | { error: string }

/** argv 切分（`HookForm.tsx:144-147`）：按 `\n` 切、trim、丢空行。 */
export function splitAgentHookArgs(argsText: string): string[] {
  return (typeof argsText === 'string' ? argsText : '').split('\n').map((line) => line.trim()).filter(Boolean)
}

/**
 * 草稿 → 提交体（`HookForm.tsx:118-158`）。互斥是这节最容易写错的地方：
 * process 只带 args，command 只带 async + shell（`:142-152` 的三元分支）。
 */
export function agentHookFormSaveConfig(draft: AgentHookFormDraft, existing?: AgentHookSaveContext): AgentHookFormSaveResult {
  const command = typeof draft?.command === 'string' ? draft.command.trim() : ''
  if (!command) return { error: '命令不能为空。' }
  let custom: Record<string, unknown> | undefined
  const customJson = typeof draft?.customJson === 'string' ? draft.customJson : ''
  if (customJson.trim()) {
    let parsed: unknown
    try { parsed = JSON.parse(customJson) as unknown } catch { return { error: '自定义字段 JSON 解析失败。' } }
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return { error: '自定义字段必须是 JSON object。' }
    custom = parsed as Record<string, unknown>
  }
  const matcher = typeof draft?.matcher === 'string' ? draft.matcher.trim() : ''
  const statusMessage = typeof draft?.statusMessage === 'string' ? draft.statusMessage.trim() : ''
  const shellText = typeof draft?.shell === 'string' ? draft.shell.trim() : ''
  const type: AgentHookType = draft?.type === 'command' ? 'command' : 'process'
  const common = {
    event: draft?.event ?? 'PreToolUse',
    type,
    command,
    timeout: Number.parseInt(String(draft?.timeoutText ?? ''), 10) || AGENT_HOOK_DEFAULT_TIMEOUT_SECONDS,
    enabled: existing?.enabled ?? true,
    storageLevel: (draft?.storageLevel === 'project' ? 'project' : 'user') as AgentHookScope,
    ...(matcher ? { matcher } : {}),
    ...(statusMessage ? { statusMessage } : {}),
    ...(custom ? { custom } : {}),
  }
  if (type === 'process') return { config: { ...common, args: splitAgentHookArgs(draft?.argsText ?? '') } }
  const shell: string | true | undefined = shellText || (existing?.shell === true ? true : undefined)
  return { config: { ...common, async: draft?.async === true, ...(shell !== undefined ? { shell } : {}) } }
}

// ── 钩子信任门控 / 分组 / 作用域 / 搜索 ─────────────────────────────────

/** 风险提示该不该显示（`WorkspaceHookTrustNotice.tsx:14-34`）。第三道门（`:25-27`）是重点：
 *  hooksStore 是单例，切 workspace 后连接阶段仍可能留着上一个 workspace 的 hooks。 */
export function shouldShowWorkspaceHookTrustNotice(input: {
  hooks: readonly AgentHook[]
  loadedWorkspaceKey: string | null
  rpcReady: boolean
  targetWorkspaceKey: string | null
}): boolean {
  const hooks = Array.isArray(input?.hooks) ? input.hooks : []
  return Boolean(
    input?.rpcReady
    && input.targetWorkspaceKey !== null
    && input.loadedWorkspaceKey === input.targetWorkspaceKey
    && hooks.some((hook) => requiresWorkspaceHookTrust(hook)),
  )
}

/** 提示文案与信任按钮文案（`WorkspaceHookTrustNotice.tsx:49`、`HooksList.tsx:291`；zh-CN.ts:4017-4019）。 */
export const WORKSPACE_HOOK_TRUST_NOTICE_TEXT = '钩子可在沙盒外运行，因此，请审查最近安装或修改的所有钩子'
export const WORKSPACE_HOOK_TRUST_ACTION_LABEL = '信任'
export const WORKSPACE_HOOK_TRUST_UNAVAILABLE_TEXT = '当前连接不支持信任此 Hook。'

/** 已配置行的开关状态（`HooksList.tsx:294-303`）：需审核时 checked 恒 false 且禁用；
 *  只读行信任后展示真实状态但仍不可拨（`:296-297`）。 */
export function configuredAgentHookSwitchState(
  hook: AgentHook,
  options: { busy?: boolean; trusting?: boolean; readOnly?: boolean } = {},
): { requiresTrust: boolean; checked: boolean; disabled: boolean } {
  const requiresTrust = requiresWorkspaceHookTrust(hook)
  const readOnly = options.readOnly === true || hook?.readOnly === true
  return {
    requiresTrust,
    checked: requiresTrust ? false : hook?.enabled === true,
    disabled: options.busy === true || options.trusting === true || requiresTrust || readOnly,
  }
}

/** 归类输入（本仓 `AgentHook` 没有 `location`，用结构类型避免编造字段）。 */
export interface AgentHookSectionInput {
  editable?: boolean
  readOnly?: boolean
  location?: { source?: string }
}

/**
 * 进哪个分组（`HooksSection.tsx:44-60`）。可编辑（`:44-48`）**或**只读 zcode 工作区钩子
 * （`:54-56`，塞进 Legacy 会让 Import 必然失败、丢掉逐条 Trust 的约定）→ Installed；其余 → Legacy。
 */
export function classifyAgentHookSection(hook: AgentHookSectionInput): 'installed' | 'legacy' {
  const source = hook?.location?.source ?? 'zcode'
  const editable = hook?.editable ?? (hook?.location === undefined || source === 'zcode')
  if (editable) return 'installed'
  if (hook?.readOnly === true && source === 'zcode') return 'installed'
  return 'legacy'
}

/** 某作用域下的钩子（`HooksSection.tsx:206-222`：`(location.scope ?? "user") === activeScope`）。 */
export function filterAgentHooksForScope(hooks: readonly AgentHook[], scope: 'user' | 'project'): AgentHook[] {
  return (Array.isArray(hooks) ? hooks : []).filter((hook) => (hook?.scope ?? 'user') === scope)
}

/** 按查询词过滤（命中字段照 `HooksSection.tsx:578-590`）。 */
export function filterAgentHooksByQuery(hooks: readonly AgentHook[], query: string): AgentHook[] {
  const list = Array.isArray(hooks) ? hooks : []
  const keyword = typeof query === 'string' ? query.trim().toLowerCase() : ''
  if (!keyword) return [...list]
  return list.filter((hook) => {
    if (!hook) return false
    return [hook.event, hook.type, hook.matcher, hook.command, ...(hook.args ?? [])]
      .some((value) => typeof value === 'string' && value.toLowerCase().includes(keyword))
  })
}

// ── 作用域页签（PluginScopeMenu.tsx:17-33 + 两节的页签筛选） ─────────────

/** 页签最小形状（本模块不 import Vue store）。 */
export interface AgentScopeWorkspaceTab {
  workspacePath: string
  workspaceIdentity?: string | null
  availability?: string
  remoteTarget?: unknown
  remoteSessionId?: string | null
}

/** scope key（`workspaceKey.ts:5-7`：identity 优先，回退路径）。 */
export function agentScopeWorkspaceKey(tab: AgentScopeWorkspaceTab): string {
  return tab?.workspaceIdentity?.trim() || tab?.workspacePath || ''
}

/** 还能不能进作用域菜单（`PluginScopeMenu.tsx:21-33`）：失效目录否；远端必须有 session。 */
export function isAgentScopeWorkspaceConnected(tab: AgentScopeWorkspaceTab): boolean {
  if (tab?.availability === 'unavailable-local-directory') return false
  if (!(tab?.workspaceIdentity?.trim() || tab?.remoteTarget || tab?.remoteSessionId)) return true
  return Boolean(tab?.remoteSessionId)
}

function dedupeScopeTabs(tabs: readonly AgentScopeWorkspaceTab[]): AgentScopeWorkspaceTab[] {
  const seen = new Set<string>()
  const result: AgentScopeWorkspaceTab[] = []
  for (const tab of Array.isArray(tabs) ? tabs : []) {
    if (!tab || !isAgentScopeWorkspaceConnected(tab)) continue
    const key = agentScopeWorkspaceKey(tab)
    if (seen.has(key)) continue
    seen.add(key)
    result.push(tab)
  }
  return result
}

/** 子智能体节的页签（`SubagentsSection.tsx:1279-1294`）：连接中、**排除远端**、去重。 */
export function selectSubagentScopeTabs(tabs: readonly AgentScopeWorkspaceTab[]): AgentScopeWorkspaceTab[] {
  return dedupeScopeTabs(tabs).filter((tab) => !(tab.remoteTarget || tab.remoteSessionId || tab.workspaceIdentity))
}

/** 钩子节的页签（`HooksSection.tsx:157-168`）：连接中 + 去重，**不排除远端**。 */
export function selectHookScopeTabs(tabs: readonly AgentScopeWorkspaceTab[]): AgentScopeWorkspaceTab[] {
  return dedupeScopeTabs(tabs)
}

/** 选中的作用域失效时回落 user（`HooksSection.tsx:322-329`）。 */
export function resolveAgentScopeSelection(scopeKey: string, tabs: readonly AgentScopeWorkspaceTab[]): string {
  if (scopeKey === 'user') return 'user'
  return (Array.isArray(tabs) ? tabs : []).some((tab) => agentScopeWorkspaceKey(tab) === scopeKey) ? scopeKey : 'user'
}

/** 超时区间（ZCode 只有 `min={1}`，`HookForm.tsx:320-323`；上限是本仓护栏，见 `src/agentHooks.ts:118-124`）。 */
export function isAgentHookTimeoutInRange(seconds: number): boolean {
  return Number.isInteger(seconds) && seconds >= AGENT_HOOK_TIMEOUT_MIN_SECONDS && seconds <= AGENT_HOOK_TIMEOUT_MAX_SECONDS
}