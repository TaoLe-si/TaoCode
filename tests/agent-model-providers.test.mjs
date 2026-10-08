// `agent/modelModelProviders` 判据：模型设置节的供应商注册表与校验，逐条钉住 ZCode 的出处。
//
// 每一条断言都指回 `D:\TaoCode\.tools\ZCode\packages` 的源文件:行号（见 src/agentModelProviders.ts 注释）。
// 测试文件必须是纯 JavaScript（package.json 的 test 不带 --experimental-strip-types）。
import test from 'node:test'
import assert from 'node:assert/strict'
import {
  AGENT_BUILTIN_MODEL_PROVIDER_IDS,
  AGENT_CODING_PLAN_PROVIDER_SPECS,
  AGENT_DEFAULT_MODEL_INPUT_FORMAT,
  AGENT_DEFAULT_PROVIDER_API_TYPE,
  AGENT_MODEL_METADATA_INVALID_MESSAGES,
  AGENT_MODEL_PROVIDER_MESSAGES,
  AGENT_MODEL_PROVIDER_NAV_GROUPS,
  AGENT_PRESET_PROVIDER_SPECS,
  AGENT_PROVIDER_API_FORMATS,
  AGENT_PROVIDER_API_FORMAT_PATHS,
  AGENT_PROVIDER_API_FORMAT_TITLES,
  AGENT_PROVIDER_FAMILY_SPECS,
  canDeleteAgentModelProvider,
  createAgentModelProviderRecord,
  createAgentProviderModelMetadataDraft,
  createCodingPlanProviderNodeKey,
  createCustomProviderNodeKey,
  createEmptyAgentProviderModel,
  createPresetProviderNodeKey,
  fromAgentModelProvider,
  isAcceptableProviderBaseUrl,
  isAgentIndividualCodingPlanProviderId,
  isAgentModelConfigComplete,
  isAgentProviderApiType,
  isAgentStartPlanProviderId,
  normalizeAgentModelProviderRecord,
  normalizeAgentModelProviderTable,
  normalizeConfiguredBaseUrl,
  resolveAgentModelMetadataInvalidMessage,
  resolveAgentProviderDeleteConfirm,
  resolveAgentProviderFamilySpecByProviderId,
  resolveAgentProviderModelMetadataCommit,
  resolveModelConnectivityFeedback,
  resolveModelConnectivityPendingMessage,
  resolveModelProviderDisplayName,
  resolvePendingAgentProviderDraftSave,
  resolveProviderConnectionApiFormatDisplayLabel,
  resolveProviderConnectionApiFormatOptions,
  resolveProviderDetailFeedbackDefaultDuration,
  resolveProviderNameEditKeyAction,
  shouldDisableModelConnectivityTest,
  toAgentModelProvider,
  validateAgentModelProvider,
  validateAgentModelProviderTable,
} from '../src/agentModelProviders.ts'
// 设置持久化与模型元数据是同一份形状（agentSettings 的 models 直接采用 AgentProviderModelConfig），
// 所以这组「读回来不丢字段」的判据也钉在这里。
import { normalizeAgentSettings } from '../src/agentSettings.ts'

const baseModel = (overrides = {}) => ({
  id: 'glm-4.6',
  name: 'GLM-4.6',
  enabled: true,
  contextWindow: 200000,
  maxOutputTokens: 8192,
  inputFormat: { ...AGENT_DEFAULT_MODEL_INPUT_FORMAT },
  ...overrides,
})

const baseProvider = (overrides = {}) => ({
  id: 'p1',
  name: '自建供应商',
  baseUrl: 'https://api.example.com/v1',
  apiKey: 'sk-x',
  apiFormat: AGENT_DEFAULT_PROVIDER_API_TYPE,
  models: [baseModel()],
  ...overrides,
})

test('API 格式：三项 wire 格式与顺序逐字照 ZCode providerApiTypeDataSchema', () => {
  // provider-data-schema.ts:4-8 / ProviderApiFormatSelect.tsx:16-20
  assert.deepEqual([...AGENT_PROVIDER_API_FORMATS], [
    'anthropic-messages',
    'openai-chat-completions',
    'openai-responses',
  ])
  assert.equal(AGENT_DEFAULT_PROVIDER_API_TYPE, 'anthropic-messages', 'InlineEditableProviderCard.tsx:189 的兜底')
  assert.equal(isAgentProviderApiType('openai-responses'), true)
  assert.equal(isAgentProviderApiType('openai-embeddings'), false)
  assert.deepEqual(resolveProviderConnectionApiFormatOptions(), [...AGENT_PROVIDER_API_FORMATS])
})

test('API 格式路径与展示标签照 ProviderApiFormatSelect', () => {
  // ProviderApiFormatSelect.tsx:22-26 路径；:38-46 展示标签 `${title} (${path})`
  assert.deepEqual(AGENT_PROVIDER_API_FORMAT_PATHS, {
    'anthropic-messages': '/v1/messages',
    'openai-chat-completions': '/chat/completions',
    'openai-responses': '/responses',
  })
  assert.equal(resolveProviderConnectionApiFormatDisplayLabel('anthropic-messages'), 'Anthropic Messages (/v1/messages)')
  assert.equal(resolveProviderConnectionApiFormatDisplayLabel('openai-responses'), 'Responses (/responses)')
  assert.equal(AGENT_PROVIDER_API_FORMAT_TITLES['openai-chat-completions'], 'Chat Completions', 'zh-CN.ts:2594')
})

test('预设供应商表照 PRESET_PROVIDER_SPECS（Z.ai / BigModel 两条）', () => {
  // constants.ts:34-45
  assert.equal(AGENT_PRESET_PROVIDER_SPECS.length, 2)
  assert.deepEqual(AGENT_PRESET_PROVIDER_SPECS[0], {
    id: 'account:zai-start-plan',
    displayName: 'Z.ai',
    oauthProviderId: 'zai',
  })
  assert.deepEqual(AGENT_PRESET_PROVIDER_SPECS[1], {
    id: 'account:bigmodel-start-plan',
    displayName: 'BigModel',
    oauthProviderId: 'bigmodel',
  })
})

test('家族规格照 MODEL_PROVIDER_FAMILY_SPECS（含两个管理页 URL）', () => {
  // model-provider-family.ts:26-47
  assert.equal(AGENT_PROVIDER_FAMILY_SPECS.length, 2)
  const zai = AGENT_PROVIDER_FAMILY_SPECS.find((spec) => spec.id === 'zai')
  const bigmodel = AGENT_PROVIDER_FAMILY_SPECS.find((spec) => spec.id === 'bigmodel')
  assert.equal(zai.rootDomain, 'z.ai')
  assert.equal(zai.teamCodingPlanManageUrl, 'https://z.ai/manage-apikey/subscription', 'family.ts:35')
  assert.equal(bigmodel.rootDomain, 'bigmodel.cn')
  assert.equal(bigmodel.teamCodingPlanManageUrl, 'https://bigmodel.cn/coding-plan/team/plans')
  assert.equal(resolveAgentProviderFamilySpecByProviderId('account:zai-team-coding-plan').id, 'zai')
  assert.equal(resolveAgentProviderFamilySpecByProviderId('custom-1'), null, '自定义供应商无家族')
})

test('Coding Plan 规格表四条，含 purchaseUrl（照 CODING_PLAN_PROVIDER_SPECS）', () => {
  // constants.ts:77-106
  assert.equal(AGENT_CODING_PLAN_PROVIDER_SPECS.length, 4)
  const zaiPersonal = AGENT_CODING_PLAN_PROVIDER_SPECS.find(
    (spec) => spec.id === 'account:zai-individual-coding-plan',
  )
  assert.equal(zaiPersonal.label, 'Z.ai - Coding Plan')
  assert.equal(zaiPersonal.purchaseUrl, 'https://z.ai/manage-apikey/subscription')
  const bigmodelPersonal = AGENT_CODING_PLAN_PROVIDER_SPECS.find(
    (spec) => spec.id === 'account:bigmodel-individual-coding-plan',
  )
  assert.equal(bigmodelPersonal.purchaseUrl, 'https://bigmodel.cn/coding-plan/personal/overview')
})

test('内置 ID 表照 BUILTIN_MODEL_PROVIDER_IDS（六个）', () => {
  // model-provider-types.ts:7-14
  assert.deepEqual(Object.values(AGENT_BUILTIN_MODEL_PROVIDER_IDS).sort(), [
    'account:bigmodel-individual-coding-plan',
    'account:bigmodel-start-plan',
    'account:bigmodel-team-coding-plan',
    'account:zai-individual-coding-plan',
    'account:zai-start-plan',
    'account:zai-team-coding-plan',
  ])
  assert.equal(isAgentStartPlanProviderId('account:zai-start-plan'), true)
  assert.equal(isAgentStartPlanProviderId('account:zai-individual-coding-plan'), false)
  assert.equal(isAgentIndividualCodingPlanProviderId('account:bigmodel-individual-coding-plan'), true)
  assert.equal(isAgentIndividualCodingPlanProviderId('account:bigmodel-team-coding-plan'), false)
})

test('元数据校验：id 为空 → invalid.id（ProviderModelMetadata.ts:123-126）', () => {
  const result = resolveAgentProviderModelMetadataCommit({
    currentModel: baseModel(),
    draft: { ...createAgentProviderModelMetadataDraft(baseModel()), idValue: '   ' },
  })
  assert.deepEqual(result, { status: 'invalid', field: 'id' })
})

test('元数据校验：contextWindow 必须正整数（ProviderModelMetadata.ts:130-135）', () => {
  const draft = { ...createAgentProviderModelMetadataDraft(baseModel()), contextWindowValue: '0' }
  assert.deepEqual(
    resolveAgentProviderModelMetadataCommit({ currentModel: baseModel(), draft }),
    { status: 'invalid', field: 'contextWindow' },
  )
  const fractional = { ...createAgentProviderModelMetadataDraft(baseModel()), contextWindowValue: '1.5' }
  assert.deepEqual(
    resolveAgentProviderModelMetadataCommit({ currentModel: baseModel(), draft: fractional }),
    { status: 'invalid', field: 'contextWindow' },
  )
})

test('元数据校验：智能配置模式下 contextWindow 空可继承，固定模式必须给值', () => {
  const draft = {
    ...createAgentProviderModelMetadataDraft(baseModel()),
    contextWindowValue: '',
    maxOutputTokensValue: '',
    reasoningLevelValuesValue: ['low'],
  }
  // ProviderModelMetadata.ts:130-132：空则取继承值
  const inherited = resolveAgentProviderModelMetadataCommit({
    currentModel: baseModel(),
    draft,
    inheritedConfig: { contextWindow: 128000, maxOutputTokens: 4096, reasoningLevelMap: '{}' },
  })
  assert.equal(inherited.status, 'commit')
  assert.equal(inherited.model.contextWindow, 128000)
  assert.equal(inherited.model.maxOutputTokens, 4096, 'maxOutputTokens 缺省保留继承上限')
  // ProviderModelMetadata.ts:140：固定模式（useRecommendedConfig=false）缺 max 即非法
  const fixed = resolveAgentProviderModelMetadataCommit({
    currentModel: baseModel(),
    draft,
    useRecommendedConfig: false,
    inheritedConfig: { contextWindow: 128000, reasoningLevelMap: '{}' },
  })
  assert.deepEqual(fixed, { status: 'invalid', field: 'maxOutputTokens' })
})

test('元数据校验：输入类型必须含文本（ProviderModelMetadata.ts:144-146）', () => {
  const draft = createAgentProviderModelMetadataDraft(baseModel())
  draft.inputFormatValue = { ...draft.inputFormatValue, supportsText: false }
  assert.deepEqual(
    resolveAgentProviderModelMetadataCommit({ currentModel: baseModel(), draft }),
    { status: 'invalid', field: 'inputFormat' },
  )
})

test('元数据校验：推理档位非空且不重复（ProviderModelMetadata.ts:148-155）', () => {
  const empty = { ...createAgentProviderModelMetadataDraft(baseModel()), reasoningLevelValuesValue: [] }
  assert.deepEqual(
    resolveAgentProviderModelMetadataCommit({ currentModel: baseModel(), draft: empty }),
    { status: 'invalid', field: 'reasoningLevelValues' },
  )
  const duplicated = {
    ...createAgentProviderModelMetadataDraft(baseModel()),
    reasoningLevelValuesValue: ['low', 'low'],
  }
  assert.deepEqual(
    resolveAgentProviderModelMetadataCommit({ currentModel: baseModel(), draft: duplicated }),
    { status: 'invalid', field: 'reasoningLevelValues' },
  )
})

test('元数据校验：推理映射必须非空且能编译成返回 JSON 对象的映射（ProviderModelMetadata.ts:156-167）', () => {
  const commitMap = (reasoningLevelMapValue, inheritedConfig) => resolveAgentProviderModelMetadataCommit({
    currentModel: baseModel(),
    draft: {
      ...createAgentProviderModelMetadataDraft(baseModel()),
      reasoningLevelValuesValue: ['low', 'high'],
      reasoningLevelMapValue,
    },
    ...(inheritedConfig ? { inheritedConfig } : {}),
  })
  // 合法：引用档位变量、返回 JSON 对象；带空白的写法提交 trim 后的映射
  const committed = commitMap('  {"reasoning_effort": reasoningLevel, "verbosity": reasoningLevel}  ')
  assert.equal(committed.status, 'commit')
  assert.equal(committed.model.reasoningLevelMap, '{"reasoning_effort": reasoningLevel, "verbosity": reasoningLevel}')
  assert.equal(commitMap('{}').status, 'commit', '空对象也是能编译的合法映射')
  // 旧启发式只看首字符 `{`：这些必须被真编译器拦下
  assert.deepEqual(commitMap('{'), { status: 'invalid', field: 'reasoningLevelMap' })
  assert.deepEqual(commitMap('{"a": 没有这个变量}'), { status: 'invalid', field: 'reasoningLevelMap' })
  assert.deepEqual(commitMap('{"a": reasoningLevel.'), { status: 'invalid', field: 'reasoningLevelMap' })
  // 能编译但不返回对象的映射也拦下
  assert.deepEqual(commitMap('reasoningLevel'), { status: 'invalid', field: 'reasoningLevelMap' })
  assert.deepEqual(commitMap('1 + 1'), { status: 'invalid', field: 'reasoningLevelMap' })
  assert.deepEqual(commitMap('   '), { status: 'invalid', field: 'reasoningLevelMap' }, '空白映射不算数')
  // 继承来的映射同样过编译器（旧判据只查非空，会把坏映射放进来）
  assert.deepEqual(
    commitMap('', { contextWindow: 128000, reasoningLevelMap: 'not-json' }),
    { status: 'invalid', field: 'reasoningLevelMap' },
  )
  assert.equal(commitMap('', { contextWindow: 128000, reasoningLevelMap: '{}' }).status, 'commit')
})

test('元数据校验：档位 trim 后提交，空串/去空白后重复都拦下（ProviderModelMetadata.ts:148-155）', () => {
  const commitLevels = (values) => resolveAgentProviderModelMetadataCommit({
    currentModel: baseModel(),
    draft: {
      ...createAgentProviderModelMetadataDraft(baseModel()),
      reasoningLevelValuesValue: values,
      reasoningLevelMapValue: '{"reasoning_effort": reasoningLevel}',
    },
  })
  const padded = commitLevels([' low ', 'high'])
  assert.equal(padded.status, 'commit')
  assert.deepEqual(padded.model.reasoningLevels, ['low', 'high'], '提交 trim 后的档位')
  assert.deepEqual(commitLevels(['low', '   ']), { status: 'invalid', field: 'reasoningLevelValues' })
  assert.deepEqual(
    commitLevels(['low', ' low ']),
    { status: 'invalid', field: 'reasoningLevelValues' },
    '去空白后相同算重复',
  )
})

test('元数据提交：合法草稿产出扁平模型（含 inputFormat 与推理档位）', () => {
  const draft = {
    ...createAgentProviderModelMetadataDraft(baseModel()),
    contextWindowValue: '100000',
    maxOutputTokensValue: '2048',
    reasoningLevelValuesValue: ['low', 'high'],
    reasoningLevelMapValue: '{"reasoning_effort": reasoningLevel}',
  }
  const result = resolveAgentProviderModelMetadataCommit({ currentModel: baseModel(), draft })
  assert.equal(result.status, 'commit')
  assert.equal(result.model.id, 'glm-4.6')
  assert.equal(result.model.contextWindow, 100000)
  assert.equal(result.model.maxOutputTokens, 2048)
  assert.deepEqual(result.model.reasoningLevels, ['low', 'high'])
  assert.equal(result.model.reasoningLevelMap, '{"reasoning_effort": reasoningLevel}')
  assert.equal(result.model.inputFormat.supportsText, true)
})

test('非法字段文案：六个键逐条（inputFormat 无同名键，退回 invalid.inputModalities）', () => {
  assert.equal(resolveAgentModelMetadataInvalidMessage('id'), AGENT_MODEL_PROVIDER_MESSAGES.invalidId)
  assert.equal(resolveAgentModelMetadataInvalidMessage('contextWindow'), '上下文窗口必须是正整数')
  assert.equal(resolveAgentModelMetadataInvalidMessage('maxOutputTokens'), '最大输出 Token 必须是正整数')
  assert.equal(resolveAgentModelMetadataInvalidMessage('inputFormat'), '输入类型必须包含文本')
  assert.equal(resolveAgentModelMetadataInvalidMessage('reasoningLevelValues'), '推理档位不能为空或重复')
  assert.equal(resolveAgentModelMetadataInvalidMessage('reasoningLevelMap'), '推理参数映射无效')
  assert.equal(AGENT_MODEL_METADATA_INVALID_MESSAGES.inputFormat, AGENT_MODEL_PROVIDER_MESSAGES.invalidInputModalities)
})

test('配置完整性：contextWindow + inputFormat 五项 + outputFormat.supportsText 都要有值', () => {
  // 判据形状订正（2026-10-08 ui-agent）：本仓记录已按上游补上 `outputFormat`（sparse 可空类型 +
  // localStorage 归一化），完整性判定也照上游 complete schema 保留该字段 ——
  // `shared/src/model-config.ts:60` 的 `completeModelOutputFormatDataSchema` 要求
  // `supportsText: z.boolean()` 显式存在（整份 complete properties 见 `:64-82`），
  // 上游挂法 `ProviderFormControls.tsx:262-268`。所以"完整"的输入必须显式带这一格；
  // 旧 fixture 缺它是判据过时，不是产品回归，这里补上并**加一条**缺 outputFormat 必须判不完整。
  const complete = baseModel({ outputFormat: { supportsText: true } })
  assert.equal(isAgentModelConfigComplete(complete), true)
  assert.equal(isAgentModelConfigComplete(baseModel({ contextWindow: undefined, outputFormat: { supportsText: true } })), false)
  const missingPdf = baseModel({ inputFormat: { supportsText: true, supportsImage: false, supportsVideo: false, supportsAudio: false }, outputFormat: { supportsText: true } })
  assert.equal(isAgentModelConfigComplete(missingPdf), false)
  assert.equal(isAgentModelConfigComplete(baseModel()), false, '缺 outputFormat.supportsText 不算完整（上游要求显式布尔值）')
})

test('Base URL 折叠：仅折叠两段完全相同的 http(s) 形态（ProviderDraftSave.ts:14-31）', () => {
  assert.equal(normalizeConfiguredBaseUrl('https://api.example.com/v1/'), 'https://api.example.com/v1')
  assert.equal(
    normalizeConfiguredBaseUrl('https://api.example.com/v1/https://api.example.com/v1'),
    'https://api.example.com/v1',
    '两段完全相同才折叠',
  )
  assert.equal(
    normalizeConfiguredBaseUrl('https://api.example.comhttps://other.example.com'),
    'https://api.example.comhttps://other.example.com',
    '两段不同不折叠',
  )
  assert.equal(normalizeConfiguredBaseUrl('  '), '')
  assert.equal(normalizeConfiguredBaseUrl('不是 URL'), '不是 URL')
})

test('草稿脏检查：四项都没变返回 null（ProviderDraftSave.ts:56）', () => {
  const provider = baseProvider()
  const draft = { nameValue: provider.name, apiFormat: provider.apiFormat, baseUrlValue: provider.baseUrl, apiKeyValue: provider.apiKey }
  assert.equal(resolvePendingAgentProviderDraftSave({ provider, draft }), null)
})

test('草稿脏检查：名称只在 nameConfirmed 时才写（ProviderDraftSave.ts:49）', () => {
  const provider = baseProvider()
  const draft = { nameValue: '改名了', apiFormat: provider.apiFormat, baseUrlValue: provider.baseUrl, apiKeyValue: provider.apiKey }
  // 闲时保存不夹带未确认名称
  assert.equal(resolvePendingAgentProviderDraftSave({ provider, draft }), null)
  const confirmed = resolvePendingAgentProviderDraftSave({ provider, draft, nameConfirmed: true })
  assert.equal(confirmed.name, '改名了')
})

test('草稿脏检查：readOnlyEndpoints 时 apiFormat/baseUrl 不可改（ProviderDraftSave.ts:51-52）', () => {
  const provider = baseProvider()
  const draft = { nameValue: provider.name, apiFormat: 'openai-responses', baseUrlValue: 'https://other.example.com', apiKeyValue: provider.apiKey }
  assert.equal(resolvePendingAgentProviderDraftSave({ provider, draft, readOnlyEndpoints: true }), null)
  const writable = resolvePendingAgentProviderDraftSave({ provider, draft })
  assert.equal(writable.apiFormat, 'openai-responses')
  assert.equal(writable.baseUrl, 'https://other.example.com')
})

test('草稿脏检查：Key 变化会写回（ProviderDraftSave.ts:53-55）', () => {
  const provider = baseProvider()
  const draft = { nameValue: provider.name, apiFormat: provider.apiFormat, baseUrlValue: provider.baseUrl, apiKeyValue: 'sk-new' }
  assert.equal(resolvePendingAgentProviderDraftSave({ provider, draft }).apiKey, 'sk-new')
})

test('名称编辑键位：Enter=commit / Escape=cancel / IME 组词中为 null（InlineEditableProviderCard.tsx:95-117）', () => {
  assert.equal(resolveProviderNameEditKeyAction({ key: 'Enter' }), 'commit')
  assert.equal(resolveProviderNameEditKeyAction({ key: 'Escape' }), 'cancel')
  assert.equal(resolveProviderNameEditKeyAction({ key: 'Enter', compositionActive: true }), null)
  assert.equal(resolveProviderNameEditKeyAction({ key: 'Escape', isComposing: true }), null)
  assert.equal(resolveProviderNameEditKeyAction({ key: 'a' }), null)
})

test('连通性测试：成功用 testModel.successWithIdentity + 语义绿', () => {
  const feedback = resolveModelConnectivityFeedback({ success: true }, '自建', 'glm-4.6')
  assert.equal(feedback.state, 'success')
  assert.equal(feedback.message, '自建 / glm-4.6 连接成功', 'zh-CN.ts:3214')
  assert.equal(feedback.successEmphasis, true)
  assert.equal(feedback.durationMs, 3500, 'ProviderDetailFeedback.tsx:44-47')
})

test('连通性测试：provider-unavailable / model-unavailable 用固定文案', () => {
  const providerFail = resolveModelConnectivityFeedback(
    { success: false, error: { message: 'raw', code: 'provider-unavailable' } },
    '自建',
    'glm-4.6',
  )
  assert.equal(providerFail.message, '自建 / glm-4.6 连接失败：该供应商当前不可用，无法测试连接')
  assert.equal(providerFail.state, 'failure')
  assert.equal(providerFail.durationMs, 8000)
  const modelFail = resolveModelConnectivityFeedback(
    { success: false, error: { message: 'raw', code: 'model-unavailable' } },
    '自建',
    'glm-4.6',
  )
  assert.ok(modelFail.message.includes('该模型当前不可用，无法测试连接'))
})

test('连通性测试：无 code 用 error.message，空则退回 testModel.failed', () => {
  const withMessage = resolveModelConnectivityFeedback({ success: false, error: { message: '  超时  ' } }, '自建', 'glm-4.6')
  assert.ok(withMessage.message.endsWith('连接失败：超时'))
  const emptyMessage = resolveModelConnectivityFeedback({ success: false, error: { message: '   ' } }, '自建', 'glm-4.6')
  assert.ok(emptyMessage.message.endsWith('连接失败：连接失败'), 'zh-CN.ts:3215 兜底')
})

test('连通性测试：pending 文案与按钮禁用条件', () => {
  assert.equal(resolveModelConnectivityPendingMessage('自建', 'glm-4.6'), '正在测试 自建 / glm-4.6')
  // ProviderFormControls.tsx:235 testDisabled = !providerEnabled || isTesting || !id.trim()
  assert.equal(shouldDisableModelConnectivityTest({ providerEnabled: false, testing: false, modelId: 'm' }), true)
  assert.equal(shouldDisableModelConnectivityTest({ providerEnabled: true, testing: true, modelId: 'm' }), true)
  assert.equal(shouldDisableModelConnectivityTest({ providerEnabled: true, testing: false, modelId: '  ' }), true)
  assert.equal(shouldDisableModelConnectivityTest({ providerEnabled: true, testing: false, modelId: 'm' }), false)
})

test('反馈默认时长三档（ProviderDetailFeedback.tsx:44-47）', () => {
  assert.equal(resolveProviderDetailFeedbackDefaultDuration('pending'), 0)
  assert.equal(resolveProviderDetailFeedbackDefaultDuration('success'), 3500)
  assert.equal(resolveProviderDetailFeedbackDefaultDuration('failure'), 8000)
})

test('表校验：名称/baseUrl/模型 ID 逐条报问题', () => {
  const bad = baseProvider({
    name: '   ',
    baseUrl: 'ftp://x',
    models: [baseModel({ id: '' }), baseModel({ id: 'm' }), baseModel({ id: 'm' })],
  })
  const issues = validateAgentModelProvider(bad)
  const messages = issues.map((issue) => issue.message)
  assert.ok(messages.includes('供应商名称不能为空。'))
  assert.ok(messages.some((message) => message.startsWith('Base URL')))
  assert.ok(messages.includes('模型 ID 不能为空'))
  assert.ok(messages.includes('模型 ID 重复：m'))
})

test('表校验：供应商 ID 重复 + 路径带索引前缀', () => {
  const issues = validateAgentModelProviderTable([baseProvider(), baseProvider()])
  assert.ok(issues.some((issue) => issue.message.startsWith('供应商 ID 重复')))
  assert.deepEqual(issues.find((issue) => issue.message.startsWith('供应商 ID 重复')).path, ['1', 'id'])
})

test('表校验：空表合法，合法表零问题', () => {
  assert.deepEqual(validateAgentModelProviderTable([]), [])
  assert.deepEqual(validateAgentModelProviderTable([baseProvider()]), [])
})

test('Base URL 判据：留空或 http(s):// 开头', () => {
  assert.equal(isAcceptableProviderBaseUrl(''), true)
  assert.equal(isAcceptableProviderBaseUrl('https://api.example.com'), true)
  assert.equal(isAcceptableProviderBaseUrl('http://127.0.0.1:8080'), true)
  assert.equal(isAcceptableProviderBaseUrl('api.example.com'), false)
})

test('归一化：坏存档逐字段救，坏模型只丢自己', () => {
  const table = normalizeAgentModelProviderTable([
    '不是对象',
    {
      id: 'p1',
      name: '自建',
      apiFormat: '不认识的格式',
      models: [
        { id: 'm1', name: '一号', contextWindow: 128000, maxOutputTokens: 4096 },
        { name: '缺 id' },
        '垃圾',
        { id: 'm2', contextWindow: -5, maxOutputTokens: 0 },
      ],
    },
  ])
  assert.equal(table.length, 1)
  assert.equal(table[0].apiFormat, AGENT_DEFAULT_PROVIDER_API_TYPE, '非法 apiFormat 退默认')
  assert.equal(table[0].models.length, 2, '缺 id 的模型与垃圾条目被丢弃')
  assert.equal(table[0].models[0].contextWindow, 128000)
  assert.equal(table[0].models[0].inputFormat.supportsText, true)
  assert.equal(table[0].models[1].contextWindow, undefined, '负值不保留')
  assert.equal(table[0].models[1].maxOutputTokens, undefined, '0 不保留')
})

test('归一化：缺 id 的供应商补生成 id；非数组退空表；永不抛', () => {
  const table = normalizeAgentModelProviderTable([{ name: '无 id' }])
  assert.equal(table.length, 1)
  assert.ok(table[0].id.startsWith('provider-'))
  assert.deepEqual(normalizeAgentModelProviderTable('不是数组'), [])
  assert.deepEqual(normalizeAgentModelProviderTable(null), [])
  assert.equal(normalizeAgentModelProviderRecord(undefined), null)
})

test('与 agentSettings.AgentModelProvider 对接：转换全程保留元数据，旧存档只补保守默认', () => {
  const record = baseProvider({
    models: [baseModel({
      supportsJsonSchemaOutput: true,
      reasoningLevels: ['low', 'high'],
      reasoningLevelMap: '{"reasoning_effort": reasoningLevel}',
    })],
  })
  const narrow = toAgentModelProvider(record)
  assert.deepEqual(Object.keys(narrow).sort(), ['apiFormat', 'apiKey', 'baseUrl', 'id', 'models', 'name'])
  // 元数据一个不丢：contextWindow / maxOutputTokens / inputFormat / 能力开关 / 推理档位与映射
  assert.deepEqual(narrow.models[0], record.models[0])
  assert.notEqual(narrow.models[0], record.models[0], '窄回产出新对象，不与记录共享引用')
  assert.equal(narrow.models[0].reasoningLevelMap, '{"reasoning_effort": reasoningLevel}')

  // 旧存档只存 id/name/enabled：升回补默认 apiFormat 与保守 inputFormat，其余字段不凭空造
  const legacy = {
    id: 'p2',
    name: '旧供应商',
    baseUrl: '',
    apiKey: '',
    models: [{ id: 'm', name: 'M', enabled: true }],
  }
  const upgraded = fromAgentModelProvider(legacy)
  assert.equal(upgraded.apiFormat, AGENT_DEFAULT_PROVIDER_API_TYPE)
  assert.deepEqual(upgraded.models[0].inputFormat, AGENT_DEFAULT_MODEL_INPUT_FORMAT)
  assert.equal(upgraded.models[0].contextWindow, undefined, '不造 contextWindow')
  assert.equal(upgraded.models[0].reasoningLevels, undefined, '不造默认档位')
  assert.equal(upgraded.models[0].reasoningLevelMap, undefined, '不造映射')
  // 往返：升回再窄回形状不再变化（元数据没有被剥掉）
  assert.deepEqual(toAgentModelProvider(upgraded), upgraded)
})

test('设置持久化：模型元数据读回不丢，旧存档缺新字段不炸也不凭空补', () => {
  const saved = normalizeAgentSettings({ providers: [{
    id: 'p1',
    name: '自建',
    baseUrl: 'https://api.example.com/v1',
    apiKey: 'sk-x',
    apiFormat: 'openai-chat-completions',
    models: [baseModel({
      supportsNativeWebSearch: true,
      reasoningLevels: [' low ', 'high', 'low'],
      reasoningLevelMap: '{"reasoning_effort": reasoningLevel}',
    })],
  }] })
  const model = saved.providers[0].models[0]
  assert.equal(model.contextWindow, 200000)
  assert.equal(model.maxOutputTokens, 8192)
  assert.deepEqual(model.inputFormat, AGENT_DEFAULT_MODEL_INPUT_FORMAT)
  assert.equal(model.supportsNativeWebSearch, true)
  assert.equal(model.supportsJsonSchemaOutput, undefined, '没填的能力开关不补 false')
  assert.deepEqual(model.reasoningLevels, ['low', 'high'], '档位去空白去重')
  assert.equal(model.reasoningLevelMap, '{"reasoning_effort": reasoningLevel}')
  assert.equal(saved.providers[0].apiFormat, 'openai-chat-completions')
  // 读进来再存/再读一遍是同一份（JSON 往返不丢字段）
  const again = normalizeAgentSettings(JSON.parse(JSON.stringify(saved)))
  assert.deepEqual(again.providers, saved.providers)

  // 旧存档（缺新字段）与坏元数据：不炸；救不回的字段丢，缺的一律不补
  const legacy = normalizeAgentSettings({ providers: [{
    id: 'p2',
    models: [{ id: 'm', contextWindow: -1, maxOutputTokens: 0, reasoningLevels: ['  '], inputFormat: '坏值' }],
  }] })
  const legacyModel = legacy.providers[0].models[0]
  assert.equal(legacyModel.id, 'm')
  assert.equal(legacyModel.name, 'm', '缺 name 退 id')
  assert.equal(legacyModel.enabled, true)
  assert.deepEqual(legacyModel.inputFormat, AGENT_DEFAULT_MODEL_INPUT_FORMAT, '坏 inputFormat 退保守初值')
  assert.equal(legacyModel.contextWindow, undefined, '负值丢弃，不补默认')
  assert.equal(legacyModel.maxOutputTokens, undefined, '0 丢弃，不补默认')
  assert.equal(legacyModel.reasoningLevels, undefined, '全空白档位丢弃，不造默认档位')
  assert.equal(legacyModel.reasoningLevelMap, undefined, '不造映射')
  assert.equal(legacyModel.supportsMidConversationSystem, undefined, '不造 provider 能力')
})

test('新建：空模型与新建供应商的初值', () => {
  const empty = createEmptyAgentProviderModel()
  assert.deepEqual(empty, {
    id: '',
    name: '',
    enabled: true,
    // `supportsToolCall` 是**真的消费面**，不是装饰字段：`src/agentHostProtocol.ts` 在组请求时
    // 按它决定「要不要把工具表发出去」（显式 `false` 才抛），而新建模型的初值必须是「能带工具」
    // （`AgentSettingsPage.vue` 新建供应商时也这么写），否则新模型建出来就永远没有工具可用。
    supportsToolCall: true,
    inputFormat: AGENT_DEFAULT_MODEL_INPUT_FORMAT,
  })
  const created = createAgentModelProviderRecord({ id: 'custom-1' })
  assert.equal(created.name, '新供应商', 'zh-CN.ts:3192')
  assert.equal(created.apiFormat, AGENT_DEFAULT_PROVIDER_API_TYPE)
  assert.deepEqual(created.models, [])
})

test('展示名：Z.ai Coding Plan 两个 ID 与 Start Plan 的特殊名（constants.ts:114-133）', () => {
  assert.equal(resolveModelProviderDisplayName(baseProvider({ id: 'account:zai-individual-coding-plan' })), 'Z.ai - Coding Plan')
  assert.equal(resolveModelProviderDisplayName(baseProvider({ id: 'account:zai-team-coding-plan' })), 'Z.ai - Coding Plan')
  assert.equal(resolveModelProviderDisplayName(baseProvider({ id: 'account:zai-start-plan' })), 'Start Plan')
  assert.equal(resolveModelProviderDisplayName(baseProvider({ id: 'account:bigmodel-start-plan' })), 'Start Plan')
  assert.equal(resolveModelProviderDisplayName(baseProvider({ id: 'p9', name: '自建' })), '自建')
  assert.equal(resolveModelProviderDisplayName(baseProvider({ id: 'p9', name: '  ' })), 'p9', '空名退 ID')
})

test('删除守卫：内置家族供应商不可删（modelProviderActions.ts:17-19）', () => {
  assert.equal(canDeleteAgentModelProvider('account:zai-start-plan'), false)
  assert.equal(canDeleteAgentModelProvider('account:bigmodel-team-coding-plan'), false)
  assert.equal(canDeleteAgentModelProvider('custom-1'), true)
})

test('删除确认文案：标题替换供应商名（modelProviderActions.ts:26-38）', () => {
  const confirm = resolveAgentProviderDeleteConfirm({ name: '自建' })
  assert.equal(confirm.title, '删除供应商“自建”？')
  assert.equal(confirm.confirmLabel, '确认删除')
  assert.ok(confirm.description.includes('不会自动恢复'))
})

test('导航节点键与分组（utils.tsx:7-17；constants.ts:223-229）', () => {
  assert.equal(createPresetProviderNodeKey('account:zai-start-plan'), 'preset:account:zai-start-plan')
  assert.equal(createCodingPlanProviderNodeKey('account:zai-individual-coding-plan'), 'coding-plan:account:zai-individual-coding-plan')
  assert.equal(createCustomProviderNodeKey('custom-1'), 'custom:custom-1')
  assert.deepEqual(AGENT_MODEL_PROVIDER_NAV_GROUPS.map((group) => group.id), ['preset', 'custom'])
  assert.equal(AGENT_MODEL_PROVIDER_NAV_GROUPS[0].title, '智谱')
  assert.equal(AGENT_MODEL_PROVIDER_NAV_GROUPS[1].title, '自定义供应商')
})