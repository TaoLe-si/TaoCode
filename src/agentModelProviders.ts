// Agent 设置「模型设置」节 —— **模型供应商注册表与校验**（纯逻辑，零 Vue / 零 DOM）。
//
// 为什么单独一个模块：ZCode 把「供应商有哪些字段」「API 格式是哪几种」「模型元数据怎么校验」
// 「预设供应商有哪些」「连通性测试返回什么」分散在 `settings/model-provider-section/` 的十几个
// 文件里。本仓 `AgentSettingsPage.vue` / `AgentPanel.vue` 只负责接线，判据
// （tests/agent-model-providers.test.mjs）盯这里 —— 每条规则都指回下面的出处。
//
// 出处根：D:\TaoCode\.tools\ZCode\packages（下文相对该根的路径）。
// 文案行号均指 packages/ui/src/i18n/locales/zh-CN.ts。
//
// 与 `src/agentSettings.ts` 的关系：那边定义了 `AgentModelProvider { id, name, baseUrl, apiKey,
// apiFormat, models }` 并已持久化，其中 `models` 直接采用本模块的 `AgentProviderModelConfig`
//（元数据必须跟设置一起落盘）。单条模型的归一化住在 agentSettings.ts（那边的保存路径也要用它，
// 反向 import 会成环），本模块提供「任意输入 → 合法 Record」的整表归一化与校验。

import { AGENT_DEFAULT_PROVIDER_API_FORMAT, normalizeAgentProviderModelConfig, type AgentModelProvider, type AgentProviderApiFormat } from './agentSettings.ts'
import { compileModelOptionMap } from './agentModelOptionMap.ts'

// ── 一、API 格式（wire 协议）────────────────────────────────────────────────────────────────
// 真源：provider/src/config/provider-data-schema.ts:4-8 `providerApiTypeDataSchema`（z.enum 三项）。
// 表单层可选集合与顺序：ProviderApiFormatSelect.tsx:16-20 `PROVIDER_CONNECTION_API_FORMATS`。
export type AgentProviderApiType = AgentProviderApiFormat

/** 默认 wire 格式 —— InlineEditableProviderCard.tsx:189、232、238 的初值兜底。 */
export const AGENT_DEFAULT_PROVIDER_API_TYPE: AgentProviderApiType = AGENT_DEFAULT_PROVIDER_API_FORMAT

export const AGENT_PROVIDER_API_FORMATS: readonly AgentProviderApiType[] = [
  'anthropic-messages',
  'openai-chat-completions',
  'openai-responses',
]

/** 每种格式的接口路径 —— ProviderApiFormatSelect.tsx:22-26。 */
export const AGENT_PROVIDER_API_FORMAT_PATHS: Record<AgentProviderApiType, string> = {
  'anthropic-messages': '/v1/messages',
  'openai-chat-completions': '/chat/completions',
  'openai-responses': '/responses',
}

/** 每种格式的标题文案 —— 键见 ProviderApiFormatSelect.tsx:28-32；值见 zh-CN.ts:2594-2596。 */
export const AGENT_PROVIDER_API_FORMAT_TITLES: Record<AgentProviderApiType, string> = {
  'anthropic-messages': 'Anthropic Messages',
  'openai-chat-completions': 'Chat Completions',
  'openai-responses': 'Responses',
}

/** 一个值是不是合法的 wire 格式。 */
export function isAgentProviderApiType(value: unknown): value is AgentProviderApiType {
  return value === 'anthropic-messages' || value === 'openai-chat-completions' || value === 'openai-responses'
}

/** ProviderApiFormatSelect.tsx:34-36 `resolveProviderConnectionApiFormatOptions`。 */
export function resolveProviderConnectionApiFormatOptions(): AgentProviderApiType[] {
  return [...AGENT_PROVIDER_API_FORMATS]
}

/** ProviderApiFormatSelect.tsx:38-46：`${title} (${path})`，如 "Anthropic Messages (/v1/messages)"。 */
export function resolveProviderConnectionApiFormatDisplayLabel(format: AgentProviderApiType): string {
  return `${AGENT_PROVIDER_API_FORMAT_TITLES[format]} (${AGENT_PROVIDER_API_FORMAT_PATHS[format]})`
}

// ── 二、供应商 / 模型的形状（扩展 src/agentSettings.ts 的 AgentModelProvider）──────────────────

/** 输入模态开关。真源：shared/src/model-config.ts:51-58（五个布尔）；默认见 ProviderModelMetadata.ts:61-67。 */
export interface AgentModelInputFormat {
  supportsText: boolean
  supportsImage: boolean
  supportsVideo: boolean
  supportsAudio: boolean
  supportsPdf: boolean
}

/** ZCode sparse model `outputFormat` property. */
export interface AgentModelOutputFormat {
  supportsText?: boolean
}

// 一个模型在设置页里可编辑的全部字段。真源：ProviderModelMetadata.ts:13-29 `ProviderModelDraftValues`
// 逐字段对应 + ProviderModelMetadataDialog.tsx 的控件。其中 id/name/enabled 就是
// `src/agentSettings.ts` 的 `AgentModelProvider.models` 的元素形状（那边直接采用本类型），
// 元数据跟着设置一起持久化。各字段的 config 落点见行内注释。
export interface AgentProviderModelConfig {
  /** ProviderModelMetadata.ts:14 `idValue`；模型行主键（ProviderFormControls.tsx:253）。 */
  id: string
  /** 显示名（本仓 AgentModelProvider.models 已有字段）。 */
  name: string
  /** 启停（ProviderModelMetadata.ts:18；ProviderFormControls.tsx:339 `enabled !== false`）。 */
  enabled: boolean
  /** ProviderModelMetadata.ts:15 → config.properties.contextWindow（model-config.ts:71）。 */
  contextWindow?: number
  /** ProviderModelMetadata.ts:16 → optionSpecs.maxOutputTokens.max（model-config.ts:39）。 */
  maxOutputTokens?: number
  /** ZCode `optionSpecs.maxOutputTokens.map`：随 provider/model 元数据保留，并在请求期应用。 */
  maxOutputTokensMap?: string
  /** ProviderModelMetadata.ts:17 `inputFormatValue`。 */
  inputFormat?: AgentModelInputFormat
  /** shared/src/model-config.ts:83; retained when editing other model metadata. */
  outputFormat?: AgentModelOutputFormat | null
  /** ProviderModelMetadata.ts:23（model-config.ts:76）。 */
  supportsJsonSchemaOutput?: boolean
  /** 模型能力：工具调用（model-config.ts:79；空模型初值见 ProviderCardSections.tsx:338）。 */
  supportsToolCall?: boolean
  /** provider tool schema 需要 MFJS 形状时启用（model-config.ts:70；adapter/tool-transform.ts）。 */
  requiresMfjsToolSchema?: boolean
  /** ProviderModelMetadata.ts:24（model-config.ts:77）。 */
  supportsNativeWebSearch?: boolean
  /** ProviderModelMetadata.ts:25（model-config.ts:78）。 */
  supportsMidConversationSystem?: boolean
  /** ProviderModelMetadata.ts:27（model-config.ts:24-31，按推理强度从低到高）。 */
  reasoningLevels?: readonly string[]
  /** ProviderModelMetadata.ts:28（CEL 映射表达式，model-config.ts:5-19）。 */
  reasoningLevelMap?: string
}

// 一条供应商记录的完整形状：与 `AgentModelProvider`（src/agentSettings.ts:88-101）同形，
// 只把 `apiFormat` 由可选抬成必填（ZCode `provider.config.api.type`，provider-data-schema.ts:66），
// 因此窄回 `AgentModelProvider` 依然安全 —— 元数据字段两边共用同一份类型，不再有"多出的字段"。
export interface AgentModelProviderRecord extends Omit<AgentModelProvider, 'models'> {
  apiFormat: AgentProviderApiType
  models: AgentProviderModelConfig[]
}

/** 供应商草稿的四个可编辑字段 —— ProviderDraftSave.ts:7-12 `ProviderDraftValues`。 */
export interface AgentProviderDraftValues {
  nameValue: string
  apiFormat: AgentProviderApiType
  baseUrlValue: string
  apiKeyValue: string
}

/** 模型元数据草稿 —— ProviderModelMetadata.ts:13-29（本仓子集，无 Effective/Personal 分家）。 */
export interface AgentProviderModelMetadataDraft {
  idValue: string
  contextWindowValue: string
  maxOutputTokensValue: string
  inputFormatValue: AgentModelInputFormat
  enabledValue?: boolean
  reasoningLevelValuesValue: readonly string[]
  reasoningLevelMapValue: string
}

/** 非法字段联合 —— ProviderModelMetadata.ts:36-41 的 field 联合（逐字）。 */
export type AgentProviderModelInvalidField =
  | 'id'
  | 'contextWindow'
  | 'maxOutputTokens'
  | 'inputFormat'
  | 'reasoningLevelValues'
  | 'reasoningLevelMap'

/** 元数据提交结果 —— ProviderModelMetadata.ts:31-42 `ProviderModelDraftCommitResult`。 */
export type AgentProviderModelDraftCommitResult =
  | { status: 'commit'; model: AgentProviderModelConfig }
  | { status: 'invalid'; field: AgentProviderModelInvalidField }

// ── 三、预设供应商 / 家族 / Coding Plan 规格（照抄真实数据表）────────────────────────────────

/** 内置供应商 ID —— shared/src/model-provider-types.ts:7-14 `BUILTIN_MODEL_PROVIDER_IDS`（逐字）。 */
export const AGENT_BUILTIN_MODEL_PROVIDER_IDS = {
  zaiIndividualCodingPlan: 'account:zai-individual-coding-plan',
  zaiTeamCodingPlan: 'account:zai-team-coding-plan',
  zaiStartPlan: 'account:zai-start-plan',
  bigmodelIndividualCodingPlan: 'account:bigmodel-individual-coding-plan',
  bigmodelTeamCodingPlan: 'account:bigmodel-team-coding-plan',
  bigmodelStartPlan: 'account:bigmodel-start-plan',
} as const

/** 预设供应商规格 —— settings/model-provider-section/constants.ts:28-45 `PRESET_PROVIDER_SPECS`。 */
export interface AgentPresetProviderSpec {
  id: string
  displayName: string
  oauthProviderId?: string
}

export const AGENT_PRESET_PROVIDER_SPECS: readonly AgentPresetProviderSpec[] = [
  { id: 'account:zai-start-plan', displayName: 'Z.ai', oauthProviderId: 'zai' },
  { id: 'account:bigmodel-start-plan', displayName: 'BigModel', oauthProviderId: 'bigmodel' },
]

/** 供应商家族规格 —— shared/src/model-provider-family.ts:9-47 `MODEL_PROVIDER_FAMILY_SPECS`。 */
export interface AgentProviderFamilySpec {
  id: 'zai' | 'bigmodel'
  label: string
  rootDomain: string
  oauthProviderId: string
  startPlanProviderId: string
  individualCodingPlanProviderId: string
  teamCodingPlanProviderId: string
  teamCodingPlanManageUrl: string
}

// 两条家族：model-provider-family.ts:27-36（zai）、:37-46（bigmodel）。
// bigmodel 的管理页由 :45 buildBigModelCodingPlanTeamManageUrl 拼（zcodeEndpoint.ts:4 + :191-195）。
export const AGENT_PROVIDER_FAMILY_SPECS: readonly AgentProviderFamilySpec[] = [
  {
    id: 'zai',
    label: 'Z.ai',
    rootDomain: 'z.ai',
    oauthProviderId: 'zai',
    startPlanProviderId: 'account:zai-start-plan',
    individualCodingPlanProviderId: 'account:zai-individual-coding-plan',
    teamCodingPlanProviderId: 'account:zai-team-coding-plan',
    teamCodingPlanManageUrl: 'https://z.ai/manage-apikey/subscription',
  },
  {
    id: 'bigmodel',
    label: 'BigModel',
    rootDomain: 'bigmodel.cn',
    oauthProviderId: 'bigmodel',
    startPlanProviderId: 'account:bigmodel-start-plan',
    individualCodingPlanProviderId: 'account:bigmodel-individual-coding-plan',
    teamCodingPlanProviderId: 'account:bigmodel-team-coding-plan',
    teamCodingPlanManageUrl: 'https://bigmodel.cn/coding-plan/team/plans',
  },
]

/** Coding Plan 供应商规格 —— constants.ts:69-106 `CODING_PLAN_PROVIDER_SPECS`（含 purchaseUrl）。 */
export interface AgentCodingPlanProviderSpec {
  id: string
  oauthProviderId: string
  label: string
  providerName: string
  purchaseUrl?: string
}

// bigmodel 的 purchaseUrl = constants.ts:24-26 buildBigModelCodingPlanPersonalManageUrl
// → zcodeEndpoint.ts:184-189 `/coding-plan/personal/overview`。
export const AGENT_CODING_PLAN_PROVIDER_SPECS: readonly AgentCodingPlanProviderSpec[] = [
  { id: 'account:zai-start-plan', oauthProviderId: 'zai', label: 'Z.ai - Coding Plan', providerName: 'Z.ai', purchaseUrl: 'https://z.ai/manage-apikey/subscription' },
  { id: 'account:zai-individual-coding-plan', oauthProviderId: 'zai', label: 'Z.ai - Coding Plan', providerName: 'Z.ai', purchaseUrl: 'https://z.ai/manage-apikey/subscription' },
  { id: 'account:bigmodel-individual-coding-plan', oauthProviderId: 'bigmodel', label: 'BigModel - Coding Plan', providerName: 'BigModel', purchaseUrl: 'https://bigmodel.cn/coding-plan/personal/overview' },
  { id: 'account:bigmodel-start-plan', oauthProviderId: 'bigmodel', label: 'BigModel- Coding Plan', providerName: 'BigModel', purchaseUrl: 'https://bigmodel.cn/coding-plan/personal/overview' },
]

/** Coding Plan 状态联合 —— constants.ts:59-65 `CodingPlanStatus`（逐字）。 */
export type AgentCodingPlanStatus =
  | 'disconnected'
  | 'checking'
  | 'notPurchased'
  | 'purchased'
  | 'unavailable'
  | 'unsupported'

/** 家族连接选择 —— shared/src/provider-family-connection-selection.ts:5-16（三种 kind）。 */
export type AgentProviderFamilyConnectionSelection =
  | { kind: 'start-plan' }
  | { kind: 'individual-coding-plan' }
  | { kind: 'team-coding-plan'; productId: string; organizationId: string; projectId: string }

/** 按内置 ID 取家族规格 —— model-provider-family.ts:99-104。 */
export function resolveAgentProviderFamilySpecByProviderId(providerId: string): AgentProviderFamilySpec | null {
  for (const spec of AGENT_PROVIDER_FAMILY_SPECS) {
    if (
      providerId === spec.startPlanProviderId ||
      providerId === spec.individualCodingPlanProviderId ||
      providerId === spec.teamCodingPlanProviderId
    ) {
      return spec
    }
  }
  return null
}

/** 是不是 Start Plan —— model-provider-types.ts:43-48 `isStartPlanModelProviderId`。 */
export function isAgentStartPlanProviderId(id: string): boolean {
  return id === 'account:zai-start-plan' || id === 'account:bigmodel-start-plan'
}

/** 是不是个人版 Coding Plan（不含 Start / Team）—— model-provider-types.ts:55-60。 */
export function isAgentIndividualCodingPlanProviderId(id: string): boolean {
  return id === 'account:zai-individual-coding-plan' || id === 'account:bigmodel-individual-coding-plan'
}

// ── 四、文案（逐字取自 zh-CN.ts；每个键后的行号即出处）───────────────────────────────────────
export const AGENT_MODEL_PROVIDER_MESSAGES = {
  newProviderName: '新供应商', // :3192
  presetTitle: '智谱', // :3195
  presetEmpty: '尚未同步，请先完成 OAuth 登录。', // :3198
  customTitle: '自定义供应商', // :3199
  empty: '暂无自定义模型供应商', // :3203
  deleteConfirm: '确定要删除"{name}"吗？', // :3204
  deleteConfirmTitle: '删除供应商“{name}”？', // :3205
  deleteConfirmDescription: '删除后将移除这条自定义 Provider 配置，当前设置页中的相关内容不会自动恢复。', // :3206
  deleteConfirmAction: '确认删除', // :3208
  renameProvider: '重命名', // :3121
  enableAction: '启用', // :3123
  disableAction: '禁用', // :3124
  enableProvider: '启用供应商', // :3119
  disableProvider: '禁用供应商', // :3120
  models: '模型列表', // :3150
  modelsEmpty: '当前没有配置模型，添加模型后可在聊天中使用。', // :3151
  modelId: '模型 ID', // :3153
  modelDisplayName: '显示名称', // :3154
  contextWindow: '上下文窗口', // :3158
  maxOutputTokens: '最大输出 Token', // :3179
  capabilities: '模型能力', // :3159
  inputModalities: '输入类型', // :3180
  advancedConfig: '高级配置', // :3176
  reasoning: '推理设置', // :3177
  followRecommendedConfig: '智能配置', // :3126
  resetForm: '重置表单', // :3128
  modelDefaultsLoaded: '已匹配到智能配置', // :3148
  modelConfigIncomplete: '模型配置不完整', // :3149
  invalidId: '模型 ID 不能为空', // :3187
  invalidContextWindow: '上下文窗口必须是正整数', // :3189
  invalidMaxOutputTokens: '最大输出 Token 必须是正整数', // :3190
  invalidReasoningLevelValues: '推理档位不能为空或重复', // :3171
  invalidReasoningLevelMap: '推理参数映射无效', // :3172
  invalidInputModalities: '输入类型必须包含文本', // :3191
  accountProviderConfigMissing: '账号 Provider 配置暂不可用，请刷新后重试。', // :2618
  testModelEnableProviderFirst: '请先启用供应商', // :3210
  testModelProviderUnavailable: '该供应商当前不可用，无法测试连接', // :3211
  testModelModelUnavailable: '该模型当前不可用，无法测试连接', // :3212
  testModelConnecting: '正在测试 {provider} / {model}', // :3213
  testModelSuccess: '{provider} / {model} 连接成功', // :3214
  testModelFailed: '连接失败', // :3215
  testModelFailedWithIdentity: '{provider} / {model} 连接失败：{reason}', // :3216
} as const

/** 非法字段 → i18n 键（ProviderFormControls.tsx:227-233 用 `modelMetadata.invalid.${field}` 拼）。 */
export const AGENT_MODEL_METADATA_INVALID_MESSAGE_IDS: Record<AgentProviderModelInvalidField, string> = {
  id: 'settings.modelProvider.modelMetadata.invalid.id',
  contextWindow: 'settings.modelProvider.modelMetadata.invalid.contextWindow',
  maxOutputTokens: 'settings.modelProvider.modelMetadata.invalid.maxOutputTokens',
  inputFormat: 'settings.modelProvider.modelMetadata.invalid.inputFormat',
  reasoningLevelValues: 'settings.modelProvider.modelMetadata.invalid.reasoningLevelValues',
  reasoningLevelMap: 'settings.modelProvider.modelMetadata.invalid.reasoningLevelMap',
}

/** 非法字段 → 中文文案（inputFormat 无同名键，退回 invalid.inputModalities 文案，见报告）。 */
export const AGENT_MODEL_METADATA_INVALID_MESSAGES: Record<AgentProviderModelInvalidField, string> = {
  id: AGENT_MODEL_PROVIDER_MESSAGES.invalidId,
  contextWindow: AGENT_MODEL_PROVIDER_MESSAGES.invalidContextWindow,
  maxOutputTokens: AGENT_MODEL_PROVIDER_MESSAGES.invalidMaxOutputTokens,
  inputFormat: AGENT_MODEL_PROVIDER_MESSAGES.invalidInputModalities,
  reasoningLevelValues: AGENT_MODEL_PROVIDER_MESSAGES.invalidReasoningLevelValues,
  reasoningLevelMap: AGENT_MODEL_PROVIDER_MESSAGES.invalidReasoningLevelMap,
}

// ── 五、连通性测试（ModelConnectivityResult）─────────────────────────────────────────────────

// 一个正式 Model 的连通性测试结果 —— shared/src/model-provider-types.ts:71-81（逐字）。
// `onTestModel` 的返回形状（Detail.tsx:285、InlineEditableProviderCard.tsx:173）。
export type AgentModelConnectivityResult =
  | { readonly success: true }
  | {
      readonly success: false
      readonly error: {
        readonly message: string
        /** 设置连接测试边界已确认的资格失败；其他执行错误保留原消息。 */
        readonly code?: 'provider-unavailable' | 'model-unavailable'
      }
    }

/** 反馈状态 —— ProviderDetailFeedback.tsx:15。 */
export type AgentProviderDetailFeedbackState = 'pending' | 'success' | 'failure'

/** 反馈默认时长 —— ProviderDetailFeedback.tsx:44-47 `resolveDefaultDuration`。 */
export function resolveProviderDetailFeedbackDefaultDuration(state: AgentProviderDetailFeedbackState): number {
  if (state === 'pending') return 0
  return state === 'failure' ? 8_000 : 3_500
}

/** 一次连通性测试要展示的反馈 —— ProviderFormControls.tsx:137-210 的分支结果。 */
export interface AgentModelConnectivityFeedback {
  state: AgentProviderDetailFeedbackState
  message: string
  /** 连接测试成功用语义绿（ProviderDetailFeedback.tsx:20-21、ProviderFormControls.tsx:164）。 */
  successEmphasis?: boolean
  durationMs: number
}

function fillIdentity(template: string, provider: string, model: string): string {
  return template.replace('{provider}', provider).replace('{model}', model)
}

// ProviderFormControls.tsx:144-207 `handleTest` 的文案分支：成功（:157-167，successEmphasis）；
// 失败（:168-188）—— error.code 命中 provider-unavailable / model-unavailable 用固定文案，
// 否则用 error.message.trim()，为空时退回 testModel.failed。
export function resolveModelConnectivityFeedback(
  result: AgentModelConnectivityResult,
  providerName: string,
  modelId: string,
): AgentModelConnectivityFeedback {
  if (result.success) {
    return {
      state: 'success',
      message: fillIdentity(AGENT_MODEL_PROVIDER_MESSAGES.testModelSuccess, providerName, modelId),
      successEmphasis: true,
      durationMs: resolveProviderDetailFeedbackDefaultDuration('success'),
    }
  }
  const localizedReason =
    result.error.code === 'provider-unavailable'
      ? AGENT_MODEL_PROVIDER_MESSAGES.testModelProviderUnavailable
      : result.error.code === 'model-unavailable'
        ? AGENT_MODEL_PROVIDER_MESSAGES.testModelModelUnavailable
        : result.error.message.trim()
  const reason = localizedReason || AGENT_MODEL_PROVIDER_MESSAGES.testModelFailed
  return {
    state: 'failure',
    message: fillIdentity(
      AGENT_MODEL_PROVIDER_MESSAGES.testModelFailedWithIdentity,
      providerName,
      modelId,
    ).replace('{reason}', reason),
    durationMs: 8_000,
  }
}

/** 连接测试的 pending 文案 —— ProviderFormControls.tsx:146-151。 */
export function resolveModelConnectivityPendingMessage(providerName: string, modelId: string): string {
  return fillIdentity(AGENT_MODEL_PROVIDER_MESSAGES.testModelConnecting, providerName, modelId)
}

/** 连接测试按钮的禁用条件 —— ProviderFormControls.tsx:235 `testDisabled`。 */
export function shouldDisableModelConnectivityTest(input: {
  providerEnabled: boolean
  testing: boolean
  modelId: string
}): boolean {
  return !input.providerEnabled || input.testing || !input.modelId.trim()
}

// ── 六、供应商连接草稿：脏检查 + Base URL 折叠 ───────────────────────────────────────────────

// ProviderDraftSave.ts:14-31 `normalizeConfiguredBaseUrl`（逐字逻辑）：trim → 去尾部 `/` →
// 若是 http(s) 且把完整 URL 又当 path 拼了一遍（两段完全相同），折叠成一段。
export function normalizeConfiguredBaseUrl(value: string): string {
  const normalized = value.trim().replace(/\/+$/, '')
  if (!normalized) return ''
  let parsed: URL
  try {
    parsed = new URL(normalized)
  } catch {
    return normalized
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return normalized
  const marker = `${parsed.protocol}//${parsed.host}`
  const duplicateIndex = normalized.indexOf(marker, marker.length)
  if (duplicateIndex < 0) return normalized
  const firstUrl = normalized.slice(0, duplicateIndex).replace(/\/+$/, '')
  const secondUrl = normalized.slice(duplicateIndex).replace(/\/+$/, '')
  // 旧设置页曾把完整 Base URL 再作为 path 拼接；仅折叠两段完全相同的安全形态。
  return firstUrl === secondUrl ? firstUrl : normalized
}

/** 从一条记录取出四个草稿值 —— InlineEditableProviderCard.tsx:187-192 的初值。 */
export function resolveAgentProviderDraftValues(provider: AgentModelProviderRecord): AgentProviderDraftValues {
  return {
    nameValue: provider.name.trim() || provider.id,
    apiFormat: provider.apiFormat ?? AGENT_DEFAULT_PROVIDER_API_TYPE,
    baseUrlValue: provider.baseUrl ?? '',
    apiKeyValue: provider.apiKey ?? '',
  }
}

// ProviderDraftSave.ts:33-101 `resolvePendingProviderDraftSave` 的脏检查语义：名称只在
// `nameConfirmed`（Enter/失焦确认）时才写（:49；注释 :48：闲时保存不夹带未确认名称）；
// `readOnlyEndpoints`（预设供应商）时 apiFormat / baseUrl 不可改（:51-52）；四项都没变返回 null（:56）。
export function resolvePendingAgentProviderDraftSave(input: {
  provider: AgentModelProviderRecord
  draft: AgentProviderDraftValues
  readOnlyEndpoints?: boolean
  nameConfirmed?: boolean
}): AgentModelProviderRecord | null {
  const { provider, draft, readOnlyEndpoints = false, nameConfirmed = false } = input
  const label = draft.nameValue.trim()
  const baseURL = normalizeConfiguredBaseUrl(draft.baseUrlValue)
  const labelChanged = nameConfirmed && label !== provider.name
  const typeChanged = !readOnlyEndpoints && draft.apiFormat !== provider.apiFormat
  const urlChanged = !readOnlyEndpoints && baseURL !== (provider.baseUrl ?? '')
  // ZCode 用 isApiKeyAccess(access) 门控（ProviderDraftSave.ts:54）；本仓扁平形状恒有 apiKey 字符串。
  const keyChanged = draft.apiKeyValue !== (provider.apiKey ?? '')
  if (!labelChanged && !typeChanged && !urlChanged && !keyChanged) return null
  return {
    ...provider,
    name: labelChanged ? label : provider.name,
    apiFormat: typeChanged ? draft.apiFormat : provider.apiFormat,
    baseUrl: urlChanged ? baseURL : provider.baseUrl,
    apiKey: keyChanged ? draft.apiKeyValue : provider.apiKey,
  }
}

/** 供应商名称编辑键位 —— InlineEditableProviderCard.tsx:95-117。 */
export type AgentProviderNameEditKeyAction = 'commit' | 'cancel'

// InlineEditableProviderCard.tsx:95-117：Enter=commit、Escape=cancel，其余 null。上游在 IME 组词中
// （isImeComposingKeyEvent）返回 null；本函数把该判据交给调用方（compositionActive/isComposing）
// 以保持零 DOM 依赖。
export function resolveProviderNameEditKeyAction(event: {
  key: string
  compositionActive?: boolean
  isComposing?: boolean
}): AgentProviderNameEditKeyAction | null {
  if (event.compositionActive || event.isComposing) return null
  if (event.key === 'Enter') return 'commit'
  if (event.key === 'Escape') return 'cancel'
  return null
}

// ── 七、模型元数据：草稿默认值 + 校验（照抄 ProviderModelMetadata.ts）──────────────────────────

/** ProviderModelMetadata.ts:61-67 的保守初值。 */
export const AGENT_DEFAULT_MODEL_INPUT_FORMAT: AgentModelInputFormat = {
  supportsText: true,
  supportsImage: false,
  supportsVideo: false,
  supportsAudio: false,
  supportsPdf: false,
}

/** 输入模态编辑器里可见的档位 —— ProviderModelModalityOptions.tsx:11（audio 只在 Draft 中保留）。 */
export const AGENT_VISIBLE_MODEL_INPUT_MODALITIES = ['text', 'image', 'video', 'pdf'] as const

/** 可见档位 → inputFormat 字段 —— ProviderModelModalityOptions.tsx:13-17。 */
export const AGENT_MODEL_INPUT_MODALITY_FIELDS: Record<'image' | 'video' | 'pdf', keyof AgentModelInputFormat> = {
  image: 'supportsImage',
  video: 'supportsVideo',
  pdf: 'supportsPdf',
}

/** ProviderModelMetadata.ts:44-81 `createProviderModelDraftValues` 的本仓子集（数值保留字符串）。 */
export function createAgentProviderModelMetadataDraft(model: AgentProviderModelConfig): AgentProviderModelMetadataDraft {
  return {
    idValue: model.id,
    contextWindowValue: model.contextWindow == null ? '' : String(model.contextWindow),
    maxOutputTokensValue: model.maxOutputTokens == null ? '' : String(model.maxOutputTokens),
    inputFormatValue: {
      supportsText: model.inputFormat?.supportsText ?? true,
      supportsImage: model.inputFormat?.supportsImage ?? false,
      supportsVideo: model.inputFormat?.supportsVideo ?? false,
      supportsAudio: model.inputFormat?.supportsAudio ?? false,
      supportsPdf: model.inputFormat?.supportsPdf ?? false,
    },
    enabledValue: model.enabled !== false,
    reasoningLevelValuesValue: [...(model.reasoningLevels ?? [])],
    reasoningLevelMapValue: typeof model.reasoningLevelMap === 'string' ? model.reasoningLevelMap : '',
  }
}

/** ProviderModelMetadata.ts:99-106 `parsePositiveIntegerDraft`。 */
function parsePositiveIntegerDraft(value: string): number | null {
  const trimmed = value.trim()
  if (!trimmed) return null
  const parsed = Number(trimmed)
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null
}

// ProviderModelMetadata.ts:108-325 `resolveProviderModelDraftCommit` 的**校验段**逐条复刻：
//   :123-126 id 非空 → invalid.id
//   :130-135 contextWindow 正整数（空则取继承值，无继承 → invalid.contextWindow）
//   :137-142 maxOutputTokens 正整数（固定模式必须给值 → invalid.maxOutputTokens）
//   :144-146 inputFormat 必须含文本 → invalid.inputFormat
//   :148-155 推理档位 trim 后非空 / 无空串 / 不重复 → invalid.reasoningLevelValues
//   :156-167 推理映射非空且能编译成「返回 JSON 对象」的映射 → invalid.reasoningLevelMap
// 上游那套 Effective / Personal 稀疏 Overlay 物化（:170-308）在本仓没有对应层，
// 这里只产出扁平 AgentProviderModelConfig。
export function resolveAgentProviderModelMetadataCommit(input: {
  currentModel: AgentProviderModelConfig
  draft: AgentProviderModelMetadataDraft
  /** 是否跟随智能配置；false 时数值必填（ProviderModelMetadata.ts:128-142）。 */
  useRecommendedConfig?: boolean
  /** 继承基线（推荐配置），仅在智能配置模式下参与数值兜底。 */
  inheritedConfig?: { contextWindow?: number; maxOutputTokens?: number; reasoningLevelMap?: string }
}): AgentProviderModelDraftCommitResult {
  const { currentModel, draft, useRecommendedConfig = true, inheritedConfig } = input
  const modelId = draft.idValue.trim()
  if (!modelId) return { status: 'invalid', field: 'id' }

  const contextWindow = draft.contextWindowValue.trim()
    ? parsePositiveIntegerDraft(draft.contextWindowValue)
    : (inheritedConfig?.contextWindow ?? null)
  if (contextWindow === null) return { status: 'invalid', field: 'contextWindow' }

  const maxOutputTokens = draft.maxOutputTokensValue.trim()
    ? parsePositiveIntegerDraft(draft.maxOutputTokensValue)
    : undefined
  if (maxOutputTokens === null || (!useRecommendedConfig && maxOutputTokens === undefined)) {
    return { status: 'invalid', field: 'maxOutputTokens' }
  }

  if (!draft.inputFormatValue.supportsText) return { status: 'invalid', field: 'inputFormat' }
  // :148-155 是「先 trim 再判」：空串与 trim 后重复都算非法，提交的也是 trim 后的档位。
  const reasoningLevelValues = draft.reasoningLevelValuesValue.map((value) => value.trim())
  if (
    reasoningLevelValues.length === 0 ||
    reasoningLevelValues.some((value) => !value) ||
    new Set(reasoningLevelValues).size !== reasoningLevelValues.length
  ) {
    return { status: 'invalid', field: 'reasoningLevelValues' }
  }

  const reasoningLevelMap = draft.reasoningLevelMapValue.trim()
  const effectiveReasoningMap = reasoningLevelMap || inheritedConfig?.reasoningLevelMap
  if (!effectiveReasoningMap) return { status: 'invalid', field: 'reasoningLevelMap' }
  let reasoningLevelMapSource: string
  try {
    // :156-167 的判据是 EnumOptionSpecConfig.validateComplete（provider/src/config/model-config.ts:66-68）
    // → shared/src/model-config.ts:33 的 optionMapSchema（:5-19），即「非空 + compileModelOptionMap 能编译」，
    // 编译器本身还要求映射返回 JSON 对象。本仓用同一个编译器判（src/agentModelOptionMap.ts），
    // 不再用「首字符是 `{`」的启发式；编译产物的 source 就是 trim 后的映射。
    reasoningLevelMapSource = compileModelOptionMap(effectiveReasoningMap, 'reasoningLevel').source
  } catch {
    return { status: 'invalid', field: 'reasoningLevelMap' }
  }

  const model: AgentProviderModelConfig = {
    ...currentModel,
    id: modelId,
    enabled: draft.enabledValue ?? currentModel.enabled ?? true,
    contextWindow,
    inputFormat: {
      supportsText: true,
      supportsImage: draft.inputFormatValue.supportsImage,
      supportsVideo: draft.inputFormatValue.supportsVideo,
      supportsAudio: draft.inputFormatValue.supportsAudio,
      supportsPdf: draft.inputFormatValue.supportsPdf,
    },
    supportsJsonSchemaOutput: currentModel.supportsJsonSchemaOutput ?? false,
    supportsNativeWebSearch: currentModel.supportsNativeWebSearch ?? false,
    supportsMidConversationSystem: currentModel.supportsMidConversationSystem ?? false,
    reasoningLevels: reasoningLevelValues,
    reasoningLevelMap: reasoningLevelMapSource,
  }
  // ProviderModelMetadata.ts:137-142、238-297：maxOutputTokens 缺省时保留继承上限，而不是写成 0
  //（Option Spec 的 max 是模型硬上限，缺省即不写）。
  if (maxOutputTokens !== undefined) model.maxOutputTokens = maxOutputTokens
  else if (inheritedConfig?.maxOutputTokens !== undefined) model.maxOutputTokens = inheritedConfig.maxOutputTokens
  return { status: 'commit', model }
}

/** ProviderFormControls.tsx:227-233：把 invalid.field 转成要展示的错误文案。 */
export function resolveAgentModelMetadataInvalidMessage(field: AgentProviderModelInvalidField): string {
  return AGENT_MODEL_METADATA_INVALID_MESSAGES[field]
}

// ProviderCardSections.tsx:495-539 / ProviderFormControls.tsx:262-268 的「配置完整性」判据：
// contextWindow、inputFormat 五项、outputFormat.supportsText 都有值才算完整。本仓没有 outputFormat
// Output Format 没有编辑控件；仅按上游原样参与完整性判定。
export function isAgentModelConfigComplete(model: AgentProviderModelConfig): boolean {
  const input = model.inputFormat
  return (
    model.contextWindow != null &&
    input?.supportsText != null &&
    input.supportsImage != null &&
    input.supportsVideo != null &&
    input.supportsAudio != null &&
    input.supportsPdf != null &&
    model.outputFormat?.supportsText != null
  )
}

// ── 八、供应商 / 模型表校验（本仓设置页保存前的门禁）────────────────────────────────────────

/** 校验问题 —— 字段路径 + 文案（形状照 ConfigValidationIssue，config-overlay.ts:1-14）。 */
export interface AgentModelProviderIssue {
  path: readonly string[]
  message: string
}

/** Base URL 合法形态：留空，或 http(s):// 开头（与 agentSettings.ts:307-311 的端点判据同口径）。 */
export function isAcceptableProviderBaseUrl(value: string): boolean {
  const trimmed = value.trim()
  if (!trimmed) return true
  return /^https?:\/\/[^\s]+$/.test(trimmed)
}

// 一条供应商记录的校验：名称非空（ProviderDraftSave.ts:45 走 getProviderFormLabel，
// providerSettingsFormTypes.ts:50-54 空名退回 providerId）；apiFormat 必须是三种之一
//（provider-data-schema.ts:4-8）；baseUrl 留空或 http(s)（provider-data-schema.ts:67 complete 用
// z.string().url()）；模型 ID 非空且不重复（ProviderModelMetadata.ts:123-126 + config-overlay.ts:5
// `duplicate-model`）。
export function validateAgentModelProvider(provider: AgentModelProviderRecord): AgentModelProviderIssue[] {
  const issues: AgentModelProviderIssue[] = []
  if (!provider.name.trim()) issues.push({ path: ['name'], message: '供应商名称不能为空。' })
  if (!isAgentProviderApiType(provider.apiFormat)) {
    issues.push({ path: ['apiFormat'], message: 'API 格式只能是三种之一。' })
  }
  if (!isAcceptableProviderBaseUrl(provider.baseUrl)) {
    issues.push({ path: ['baseUrl'], message: 'Base URL 要么留空，要么是 http(s):// 开头的完整地址。' })
  }
  const seen = new Set<string>()
  provider.models.forEach((model, index) => {
    const id = model.id.trim()
    if (!id) {
      issues.push({ path: ['models', String(index), 'id'], message: AGENT_MODEL_PROVIDER_MESSAGES.invalidId })
      return
    }
    if (seen.has(id)) {
      issues.push({ path: ['models', String(index), 'id'], message: `模型 ID 重复：${id}` })
      return
    }
    seen.add(id)
    if (typeof model.maxOutputTokensMap === 'string' && model.maxOutputTokensMap.trim()) {
      if (!Number.isInteger(model.maxOutputTokens) || (model.maxOutputTokens ?? 0) <= 0) {
        issues.push({
          path: ['models', String(index), 'maxOutputTokens'],
          message: AGENT_MODEL_PROVIDER_MESSAGES.invalidMaxOutputTokens,
        })
      }
      try {
        compileModelOptionMap(model.maxOutputTokensMap, 'maxOutputTokens')
      } catch (error) {
        issues.push({
          path: ['models', String(index), 'maxOutputTokensMap'],
          message: error instanceof Error ? error.message : String(error),
        })
      }
    }
  })
  return issues
}

// 整张供应商表的校验：供应商 ID 不重复（config-overlay.ts:5 `duplicate-key` 同义）；每条记录走
// validateAgentModelProvider。空表合法（新建后可先无供应商）。
export function validateAgentModelProviderTable(providers: readonly AgentModelProviderRecord[]): AgentModelProviderIssue[] {
  const issues: AgentModelProviderIssue[] = []
  const seen = new Set<string>()
  providers.forEach((provider, index) => {
    if (seen.has(provider.id)) {
      issues.push({ path: [String(index), 'id'], message: `供应商 ID 重复：${provider.id}` })
    } else {
      seen.add(provider.id)
    }
    for (const issue of validateAgentModelProvider(provider)) {
      issues.push({ path: [String(index), ...issue.path], message: issue.message })
    }
  })
  return issues
}

// ── 九、归一化：任意输入 → 合法 AgentModelProviderRecord ─────────────────────────────────────
//
// 单条模型的归一化住在 `src/agentSettings.ts` 的 `normalizeAgentProviderModelConfig`
//（设置持久化与设置页要用同一份；那边 import 本模块的 `AgentProviderModelConfig` 定形状）。

// 把任意输入归一成一条合法记录。**永不抛、永不返回坏值**（本仓铁律：不许按字段数量判损坏，真出过
// 把用户锁在项目外的事故 —— 与 agentSettings.ts:203 的 normalizeAgentSettings 同口径）。
// 救不了的字段退默认，救不了的单条模型丢弃（不丢整条供应商）。
export function normalizeAgentModelProviderRecord(value: unknown, index = 0): AgentModelProviderRecord | null {
  if (!value || typeof value !== 'object') return null
  const raw = value as Record<string, unknown>
  const id = typeof raw.id === 'string' && raw.id.trim() ? raw.id.trim() : `provider-${index + 1}`
  const modelsRaw: unknown[] = Array.isArray(raw.models) ? raw.models : []
  const models: AgentProviderModelConfig[] = []
  for (const item of modelsRaw) {
    const model = normalizeAgentProviderModelConfig(item)
    if (model) models.push(model)
  }
  return {
    id,
    name: typeof raw.name === 'string' && raw.name.trim() ? raw.name.trim() : id,
    baseUrl: typeof raw.baseUrl === 'string' ? raw.baseUrl : '',
    apiKey: typeof raw.apiKey === 'string' ? raw.apiKey : '',
    apiFormat: isAgentProviderApiType(raw.apiFormat) ? raw.apiFormat : AGENT_DEFAULT_PROVIDER_API_TYPE,
    models,
  }
}

/** 归一化整张表：坏条目只丢自己，不丢整表。 */
export function normalizeAgentModelProviderTable(value: unknown): AgentModelProviderRecord[] {
  if (!Array.isArray(value)) return []
  const out: AgentModelProviderRecord[] = []
  for (const item of value) {
    const record = normalizeAgentModelProviderRecord(item, out.length)
    if (record) out.push(record)
  }
  return out
}

// 把记录窄回 `src/agentSettings.ts` 的 `AgentModelProvider`（持久化用）。两边模型形状已共用同一份
// 类型，所以这里**元数据原样保留** —— 剥掉它等于把用户填的 contextWindow / 推理档位悄悄丢掉。
export function toAgentModelProvider(record: AgentModelProviderRecord): AgentModelProvider {
  return {
    id: record.id,
    name: record.name,
    baseUrl: record.baseUrl,
    apiKey: record.apiKey,
    apiFormat: record.apiFormat,
    models: record.models.map((model) => ({ ...model })),
  }
}

/** 从 `AgentModelProvider` 升成扩展记录：补默认 apiFormat；已有元数据原样保留，旧存档补保守输入模态。 */
export function fromAgentModelProvider(provider: AgentModelProvider): AgentModelProviderRecord {
  return {
    ...provider,
    apiFormat: provider.apiFormat ?? AGENT_DEFAULT_PROVIDER_API_TYPE,
    models: provider.models.map((model) => ({
      ...model,
      inputFormat: { ...AGENT_DEFAULT_MODEL_INPUT_FORMAT, ...model.inputFormat },
    })),
  }
}

// ── 十、新建 / 展示辅助 ──────────────────────────────────────────────────────────────────────

/** ProviderCardSections.tsx:330-344 `createEmptyModel` 的扁平版。 */
export function createEmptyAgentProviderModel(): AgentProviderModelConfig {
  return {
    id: '',
    name: '',
    enabled: true,
    supportsToolCall: true,
    // 空 ID 尚未解析模型配置，硬编码档位会被误认为智能推荐（:336 注释）。
    inputFormat: { ...AGENT_DEFAULT_MODEL_INPUT_FORMAT },
  }
}

/** 新建自定义供应商的默认名 —— zh-CN.ts:3192 `settings.modelProvider.newProviderName`。 */
export function createAgentModelProviderRecord(input: { id: string; name?: string }): AgentModelProviderRecord {
  return {
    id: input.id,
    name: input.name?.trim() || AGENT_MODEL_PROVIDER_MESSAGES.newProviderName,
    baseUrl: '',
    apiKey: '',
    apiFormat: AGENT_DEFAULT_PROVIDER_API_TYPE,
    models: [],
  }
}

/** utils.tsx:7-17 三个导航节点键（preset / coding-plan / custom）。 */
export function createPresetProviderNodeKey(id: string): string {
  return `preset:${id}`
}

export function createCodingPlanProviderNodeKey(id: string): string {
  return `coding-plan:${id}`
}

export function createCustomProviderNodeKey(id: string): string {
  return `custom:${id}`
}

// constants.ts:114-133 `resolveModelProviderDisplayName`（逐字）：个人 Coding Plan 的 Z.ai 两个 ID
// 统一显示 "Z.ai - Coding Plan"；两个 Start Plan ID 都显示 "Start Plan"；其余用表单标签（空名退 ID）。
export function resolveModelProviderDisplayName(provider: AgentModelProviderRecord): string {
  if (
    provider.id === AGENT_BUILTIN_MODEL_PROVIDER_IDS.zaiIndividualCodingPlan ||
    provider.id === AGENT_BUILTIN_MODEL_PROVIDER_IDS.zaiTeamCodingPlan
  ) {
    return 'Z.ai - Coding Plan'
  }
  if (
    provider.id === AGENT_BUILTIN_MODEL_PROVIDER_IDS.zaiStartPlan ||
    provider.id === AGENT_BUILTIN_MODEL_PROVIDER_IDS.bigmodelStartPlan
  ) {
    return 'Start Plan'
  }
  return provider.name.trim() || provider.id
}

// modelProviderActions.ts:17-19 `confirmAndDeleteModelProvider` 的守卫：`zai-family` /
// `bigmodel-family` 分组的内置供应商**不允许删除**（本仓按家族归属判定）。
export function canDeleteAgentModelProvider(providerId: string): boolean {
  return resolveAgentProviderFamilySpecByProviderId(providerId) === null
}

/** modelProviderActions.ts:26-38 删除确认弹窗的文案（含供应商名）。 */
export function resolveAgentProviderDeleteConfirm(input: { name: string }): {
  title: string
  description: string
  confirmLabel: string
} {
  return {
    title: AGENT_MODEL_PROVIDER_MESSAGES.deleteConfirmTitle.replace('{name}', input.name),
    description: AGENT_MODEL_PROVIDER_MESSAGES.deleteConfirmDescription,
    confirmLabel: AGENT_MODEL_PROVIDER_MESSAGES.deleteConfirmAction,
  }
}

/** 左侧导航分组 —— constants.ts:223-229 `ModelProviderNavGroupId` + 分组标题（:184、:215）。 */
export const AGENT_MODEL_PROVIDER_NAV_GROUPS = [
  { id: 'preset', title: AGENT_MODEL_PROVIDER_MESSAGES.presetTitle },
  { id: 'custom', title: AGENT_MODEL_PROVIDER_MESSAGES.customTitle },
] as const
