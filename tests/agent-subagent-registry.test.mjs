// 「子智能体注册表 + 钩子写面」判据 —— 对照 ZCode `.tools/ZCode` 的两节源码。
//
// 钉住五件事（每条断言都指到源码行号，不写「一般来说 ZCode 是这样」）：
//   1. 子智能体表单：字段、缺省值、名字/描述/提示词/模型/档位的校验与文案；
//   2. 模型值编解码（`custom:provider:model`）与「继承」折叠、覆盖键的两条真实路径；
//   3. 推理档位四态 + 档位值/中文名 + 可用性判定（含「加载中不判死」这条反直觉规则）；
//   4. 钩子表单：互斥（process→args / command→async+shell）、trim→undefined、超时默认 60；
//   5. 工作区钩子信任门控：四道门（尤其「快照 key 必须与 target 相等」）与开关强制为关。
//
// 每条「阳性」断言都配一条「阴性对照」，证明它不是恒真。
import test from 'node:test'
import assert from 'node:assert/strict'
import {
  AGENT_SUBAGENT_REGISTRY_STORAGE_KEY,
  SUBAGENT_DEFAULT_COLOR,
  SUBAGENT_FORM_COLOR_ORDER,
  SUBAGENT_INHERIT_MODEL_VALUE,
  SUBAGENT_NAME_MAX_LENGTH,
  SUBAGENT_NAME_MIN_LENGTH,
  SUBAGENT_RISKY_TOOLS,
  SUBAGENT_THOUGHT_LEVEL_LABELS,
  SUBAGENT_TOOL_OPTIONS,
  WORKSPACE_HOOK_TRUST_NOTICE_TEXT,
  agentHookCustomJsonValid,
  agentHookFormCanSave,
  agentHookFormSaveConfig,
  agentHookFormScopeKey,
  agentSubagentFormDraftKey,
  agentSubagentFormSubmission,
  agentSubagentModelOverrideKey,
  agentScopeWorkspaceKey,
  classifyAgentHookSection,
  configuredAgentHookSwitchState,
  createAgentHookFormDraft,
  createAgentSubagentFormDraft,
  decodeSubagentModelValue,
  defaultAgentSubagentRegistry,
  encodeSubagentModelValue,
  filterAgentHooksByQuery,
  filterAgentHooksForScope,
  filterAgentSubagentsForScope,
  filterAgentSubagentRegistry,
  formatAgentHookCustomJson,
  isAgentHookTimeoutInRange,
  isAgentScopeWorkspaceConnected,
  isEditableUserSubagent,
  isNoSubagentThoughtLevel,
  isSubagentModelAvailable,
  isSubagentThoughtLevelAvailable,
  loadAgentSubagentRegistry,
  mergeAgentSubagentTools,
  normalizeAgentSubagentRegistry,
  removeAgentSubagentRegistryEntry,
  resolveAgentScopeSelection,
  resolveSubagentReasoningState,
  resolvedSubagentThoughtLevel,
  saveAgentSubagentRegistry,
  selectHookScopeTabs,
  selectSubagentScopeTabs,
  setAgentSubagentModelOverride,
  setAgentSubagentRegistryEnabled,
  shouldShowWorkspaceHookTrustNotice,
  splitAgentHookArgs,
  subagentThoughtLevelLabel,
  supportsSubagentEnabledToggle,
  supportsSubagentModelOverride,
  toPersistedSubagentModel,
  toSubagentModelDraftValue,
  toSubagentModelSelection,
  upsertAgentSubagentRegistryEntry,
  validateAgentSubagentForm,
  validateAgentSubagentRegistry,
} from '../src/agentSubagentRegistry.ts'
import { createMemoryStorage, createThrowingStorage } from '../src/agentSettingsStore.ts'

/** 一条用户级子智能体条目。 */
function subagentEntry(overrides = {}) {
  return {
    id: 'user:user:worker-x',
    name: 'worker-x',
    description: '有界产出',
    systemPrompt: '你是一个有界产出的 worker。',
    path: 'C:\\Users\\Administrator\\.minimax\\agents\\worker-x\\agent.md',
    scope: 'user',
    source: 'user',
    enabled: true,
    ...overrides,
  }
}

/** 一条用户自建的钩子（不来自工作区，无需信任审核）。 */
function hookEntry(overrides = {}) {
  return {
    id: 'hook-1',
    event: 'PreToolUse',
    type: 'process',
    matcher: '',
    command: 'node check.mjs',
    args: [],
    async: false,
    shell: '',
    statusMessage: '',
    timeoutSeconds: 60,
    enabled: true,
    scope: 'user',
    trust: 'not_applicable',
    readOnly: false,
    ...overrides,
  }
}

/** 一条工作区来源、尚未信任的钩子。 */
function workspaceHook(overrides = {}) {
  return hookEntry({ id: 'hook-ws', scope: 'project', readOnly: true, trust: 'pending_trust', ...overrides })
}

/**
 * 造一份钩子草稿：`createAgentHookFormDraft` 的入参是 `{ hook, custom, workspaceAvailable,
 * defaultStorageLevel }`（不是字段本身），所以这里把「字段覆盖」包一层，让用例读起来是
 * 「某字段 = 某值」。`hook` 由 overrides 里的字段折成一条 `AgentHook`。
 */
function hookDraft(overrides = {}, options = {}) {
  const { event, type, matcher, command, args, async, shell, statusMessage, timeoutSeconds, scope, readOnly, trust } = overrides
  const hookFields = { event, type, matcher, command, args, async, shell, statusMessage, timeoutSeconds, scope, readOnly, trust }
  const hasHook = Object.values(hookFields).some((value) => value !== undefined)
  const base = createAgentHookFormDraft({
    ...(hasHook ? { hook: hookEntry({ ...hookFields, id: 'hook-draft' }) } : {}),
    ...options,
  })
  const patch = {}
  for (const key of ['event', 'type', 'matcher', 'command', 'statusMessage', 'shell', 'customJson', 'storageLevel', 'argsText']) {
    if (overrides[key] !== undefined) patch[key] = overrides[key]
  }
  if (overrides.async !== undefined) patch.async = overrides.async
  if (overrides.timeoutText !== undefined) patch.timeoutText = overrides.timeoutText
  return { ...base, ...patch }
}

// ── 1. 常量逐条对齐 ZCode ────────────────────────────────────────────────

test('常量逐条对齐 ZCode：颜色档 8 个（顺序）/ 工具 9 个 / 风险工具 3 个 / 名字区间 3..50', () => {
  assert.deepEqual([...SUBAGENT_FORM_COLOR_ORDER],
    ['yellow', 'red', 'orange', 'green', 'cyan', 'blue', 'purple', 'pink'],
    'ZCode lib/subagentColors.ts:3-12 SUBAGENT_COLORS（表单取它的顺序，SubagentsSection.tsx:83）')
  assert.equal(SUBAGENT_DEFAULT_COLOR, 'yellow', 'ZCode SubagentsSection.tsx:310 缺省 color')
  assert.deepEqual([...SUBAGENT_TOOL_OPTIONS],
    ['Read', 'Grep', 'Glob', 'Bash', 'Edit', 'Write', 'WebFetch', 'WebSearch', 'TodoWrite'],
    'ZCode SubagentsSection.tsx:87-97 TOOL_OPTIONS')
  assert.deepEqual([...SUBAGENT_RISKY_TOOLS], ['Bash', 'Edit', 'Write'],
    'ZCode SubagentsSection.tsx:99 RISKY_TOOLS')
  assert.equal(SUBAGENT_NAME_MIN_LENGTH, 3, 'ZCode SubagentsSection.tsx:891-899')
  assert.equal(SUBAGENT_NAME_MAX_LENGTH, 50, 'ZCode SubagentsSection.tsx:891-899')
  assert.equal(SUBAGENT_INHERIT_MODEL_VALUE, 'inherit', 'ZCode SubagentsSection.tsx:86 INHERIT_MODEL_VALUE')
  assert.equal(WORKSPACE_HOOK_TRUST_NOTICE_TEXT, '钩子可在沙盒外运行，因此，请审查最近安装或修改的所有钩子',
    'ZCode zh-CN.ts:4018 settings.hooks.review.notice')
})

// ── 2. 模型值编解码 ──────────────────────────────────────────────────────

test('模型值编解码逐字对齐 custom-model-value.ts：前缀 custom: / 两端 URI 编码 / builtin: 旧形状', () => {
  assert.equal(encodeSubagentModelValue('zai', 'glm-4'), 'custom:zai:glm-4',
    'ZCode custom-model-value.ts:16-23：custom:<provider>:<model>')
  assert.equal(encodeSubagentModelValue('a/b', 'x y'), 'custom:a%2Fb:x%20y',
    'ZCode custom-model-value.ts:17,22：两端各做 encodeURIComponent')
  assert.equal(encodeSubagentModelValue('zai'), 'custom:zai',
    'ZCode custom-model-value.ts:18-20：无 model 时只有 provider 段')
  assert.deepEqual(decodeSubagentModelValue('custom:zai:glm-4'), { providerId: 'zai', modelId: 'glm-4' },
    'ZCode custom-model-value.ts:39,45-52')
  assert.deepEqual(decodeSubagentModelValue('custom:builtin:openai:gpt-4'),
    { providerId: 'builtin:openai', modelId: 'gpt-4' },
    'ZCode custom-model-value.ts:40-44：首段 builtin 时前两段合成 providerId')
  assert.equal(decodeSubagentModelValue('zai/glm'), null,
    '阴性对照：不带 custom: 前缀的值不是展示态模型值')
  assert.deepEqual(decodeSubagentModelValue('custom:a%2'), { providerId: 'a%2', modelId: '' },
    'ZCode custom-model-value.ts:5-11：坏百分号编码不抛、原样返回；:33-36 无分隔符时只有 providerId')
})

test('「继承」折叠：inherit / 空串折成 undefined，其余原样（SubagentsSection.tsx:190-199）', () => {
  assert.equal(toPersistedSubagentModel('inherit'), undefined, 'ZCode SubagentsSection.tsx:86,190-193')
  assert.equal(toPersistedSubagentModel('   '), undefined, '空串折成 undefined')
  assert.equal(toPersistedSubagentModel(undefined), undefined)
  assert.equal(toPersistedSubagentModel('zai/glm'), 'zai/glm', '阳性对照：真实模型原样保留')
  assert.equal(toSubagentModelDraftValue(undefined), 'inherit', '草稿缺省显示「继承默认」')
  assert.equal(toSubagentModelDraftValue('zai/glm'), 'zai/glm')
})

test('模型选择三件套：无模型不带这一格；reasoningLevel 有值才带 options（:201-214）', () => {
  assert.equal(toSubagentModelSelection('inherit', 'high'), undefined,
    'ZCode SubagentsSection.tsx:205-206：继承不产生 Selection')
  assert.deepEqual(toSubagentModelSelection('zai/glm', 'high'),
    { providerId: 'zai', modelId: 'glm', options: { reasoningLevel: 'high' } },
    'ZCode SubagentsSection.tsx:208-213')
  assert.deepEqual(toSubagentModelSelection('custom:zai:glm', '  '),
    { providerId: 'zai', modelId: 'glm' },
    '阴性对照：档位为空白时不带 options（源码 `...(reasoningLevel ? {...} : {})`）')
  assert.deepEqual(toSubagentModelSelection('zai/glm'), { providerId: 'zai', modelId: 'glm' })
})

// ── 3. 推理档位 ──────────────────────────────────────────────────────────

test('档位取值与中文名逐字对齐 thoughtLevelOptions.ts + zh-CN.ts', () => {
  assert.equal(SUBAGENT_THOUGHT_LEVEL_LABELS.low, '低', 'ZCode zh-CN.ts:4552')
  assert.equal(SUBAGENT_THOUGHT_LEVEL_LABELS.xhigh, '极高', 'ZCode zh-CN.ts:4554')
  assert.equal(SUBAGENT_THOUGHT_LEVEL_LABELS.ultra, '极致', 'ZCode zh-CN.ts:4556')
  assert.equal(subagentThoughtLevelLabel('XHIGH'), '极高',
    'ZCode thoughtLevelOptions.ts:42-44,80-83：查表前 trim + 小写')
  assert.equal(subagentThoughtLevelLabel('  low '), '低')
  assert.equal(subagentThoughtLevelLabel('vendor-specific'), 'vendor-specific',
    'ZCode thoughtLevelOptions.ts:47-48,88：表外取值回落 provider 自己的档位名')
  assert.equal(subagentThoughtLevelLabel(''), '', '空档位没有展示名')
  assert.equal(isNoSubagentThoughtLevel('OFF'), true, 'ZCode thoughtLevelOptions.ts:7-16,54-56')
  assert.equal(isNoSubagentThoughtLevel('high'), false, '阴性对照：high 不是「关闭」类')
})

test('档位四态：not-applicable / supported / unknown(loading) / unsupported（SubagentsSection.tsx:218-252）', () => {
  const option = { type: 'select', currentValue: 'high', options: [{ value: 'low', name: '低' }, { value: 'high', name: '高' }] }
  assert.deepEqual(
    resolveSubagentReasoningState({ model: 'inherit', modelAvailable: true, option, modelSelectionLoading: false, thoughtLevel: 'high' }),
    { kind: 'not-applicable' },
    'ZCode SubagentsSection.tsx:225-227：继承/空模型 → not-applicable')
  assert.deepEqual(
    resolveSubagentReasoningState({ model: 'zai/glm', modelAvailable: false, option, modelSelectionLoading: false }),
    { kind: 'not-applicable' },
    'ZCode :226：模型不可用 → not-applicable')
  assert.deepEqual(
    resolveSubagentReasoningState({ model: 'zai/glm', modelAvailable: true, option, modelSelectionLoading: false, thoughtLevel: 'high' }),
    { kind: 'supported', option: { type: 'select', currentValue: 'high', options: option.options } },
    'ZCode :242-247：有 metadata option → supported')
  assert.deepEqual(
    resolveSubagentReasoningState({ model: 'zai/glm', modelAvailable: true, option: null, modelSelectionLoading: true }),
    { kind: 'unknown', status: 'loading' },
    'ZCode :248-250：加载中 → unknown/loading')
  assert.deepEqual(
    resolveSubagentReasoningState({ model: 'zai/glm', modelAvailable: true, option: null, modelSelectionLoading: false }),
    { kind: 'unsupported' },
    'ZCode :251：既无 option 也不在加载 → unsupported')
  // currentValue 不在候选内时置空串（modelThoughtOption.ts:25-28）——不猜一个档位。
  const supported = resolveSubagentReasoningState({
    model: 'zai/glm', modelAvailable: true, option, modelSelectionLoading: false, thoughtLevel: 'ultra',
  })
  assert.equal(supported.kind === 'supported' && supported.option.currentValue, '',
    'ZCode modelThoughtOption.ts:25-28：非法 currentValue 置空串')
  assert.equal(resolvedSubagentThoughtLevel(supported), undefined,
    'ZCode SubagentsSection.tsx:274-278：空 currentValue 不给生效档位')
})

test('档位可用性：加载中/不适用不判死，unsupported 判死（SubagentsSection.tsx:254-272）', () => {
  const supported = {
    kind: 'supported',
    option: { type: 'select', currentValue: 'high', options: [{ value: 'low', name: '低' }, { value: 'high', name: '高' }] },
  }
  assert.equal(isSubagentThoughtLevelAvailable(supported, 'low'), true, '阳性对照：候选内合法')
  assert.equal(isSubagentThoughtLevelAvailable(supported, 'ultra'), false, '阴性对照：候选外非法')
  assert.equal(isSubagentThoughtLevelAvailable(supported, ''), true, 'ZCode :259-261：空档位恒合法')
  assert.equal(isSubagentThoughtLevelAvailable({ kind: 'unsupported' }, 'high'), false,
    'ZCode :265-267：unsupported 时判死')
  assert.equal(isSubagentThoughtLevelAvailable({ kind: 'unknown', status: 'loading' }, 'high'), true,
    'ZCode :262-264：unknown 时不判死（读取失败不能被当成非法档位）')
  assert.equal(isSubagentThoughtLevelAvailable({ kind: 'not-applicable' }, 'high'), true,
    'ZCode :262-264：not-applicable 同样不判死')
})

test('模型可用性：加载中一律当可用（isSubagentModelAvailable，SubagentsSection.tsx:280-293）', () => {
  assert.equal(isSubagentModelAvailable(['zai/glm'], 'zai/glm'), true, '阳性对照：候选内')
  assert.equal(isSubagentModelAvailable(['zai/glm'], 'other/x'), false, '阴性对照：候选外不可用')
  assert.equal(isSubagentModelAvailable(['zai/glm'], 'other/x', true), true,
    'ZCode :289-291：加载中保留原意图，不能把读取失败当模型被删除')
  assert.equal(isSubagentModelAvailable(['zai/glm'], 'inherit'), true, 'ZCode :286-288：继承恒可用')
  assert.equal(isSubagentModelAvailable([], undefined), true, '空模型恒可用')
})

// ── 4. 子智能体表单 ──────────────────────────────────────────────────────

test('表单草稿缺省值逐条对齐 createSubagentFormInitialState（:295-319）', () => {
  const draft = createAgentSubagentFormDraft()
  assert.equal(draft.color, 'yellow', 'ZCode :310 缺省 color')
  assert.equal(draft.injectAgentsMd, true, 'ZCode :313 缺省注入 AGENTS.md')
  assert.equal(draft.inheritAllTools, true, 'ZCode :314：tools 缺省 = 继承全部')
  assert.equal(draft.model, 'inherit', 'ZCode :195-199：无模型显示 inherit')
  assert.deepEqual(draft.selectedTools, [])
  assert.deepEqual(draft.preservedTools, [])
  const withTools = createAgentSubagentFormDraft({ tools: ['Read', 'Bash(git:*)'] })
  assert.deepEqual(withTools.selectedTools, ['Read'], 'ZCode :167-169 getKnownTools')
  assert.deepEqual(withTools.preservedTools, ['Bash(git:*)'],
    'ZCode :171-173 getPreservedTools：候选之外的 pattern 不许静默丢掉')
  assert.equal(withTools.inheritAllTools, false, 'ZCode :314：有工具 = 自定义档')
})

test('表单校验：名字长度与字符集互斥只报一条、描述/提示词必填、模型与档位（:926-982）', () => {
  const ok = validateAgentSubagentForm(
    { ...createAgentSubagentFormDraft({ name: 'worker-x', description: 'd', systemPrompt: 'p' }) },
    { modelAvailable: true, thoughtLevelAvailable: true },
  )
  assert.deepEqual(ok, { ok: true, nameError: null, descriptionError: null, promptError: null, modelError: null, thoughtLevelInvalid: false },
    '阳性对照：合法草稿零错误')

  const short = validateAgentSubagentForm(createAgentSubagentFormDraft({ name: 'ab', description: 'd', systemPrompt: 'p' }),
    { modelAvailable: true, thoughtLevelAvailable: true })
  assert.equal(short.nameError, '长度必须在 3 到 50 个字符之间', 'ZCode :929-936 + zh-CN.ts:3671')
  assert.equal(short.ok, false)

  const bad = validateAgentSubagentForm(createAgentSubagentFormDraft({ name: '有中文名', description: 'd', systemPrompt: 'p' }),
    { modelAvailable: true, thoughtLevelAvailable: true })
  assert.equal(bad.nameError, '仅允许使用字母、数字和连字符', 'ZCode :937-943 + zh-CN.ts:3672')

  // 长度与字符集是 else-if：一个名字只报一条。
  const both = validateAgentSubagentForm(createAgentSubagentFormDraft({ name: '中', description: 'd', systemPrompt: 'p' }),
    { modelAvailable: true, thoughtLevelAvailable: true })
  assert.equal(both.nameError, '长度必须在 3 到 50 个字符之间',
    'ZCode :929-943 是 else if：长度不合法时不再报字符集')

  const empty = validateAgentSubagentForm(createAgentSubagentFormDraft({ name: 'worker-x' }),
    { modelAvailable: true, thoughtLevelAvailable: true })
  assert.equal(empty.descriptionError, '描述不能为空', 'ZCode :947-956 + zh-CN.ts:3673')
  assert.equal(empty.promptError, '系统提示词不能为空', 'ZCode :957-966 + zh-CN.ts:3674')

  const model = validateAgentSubagentForm(
    createAgentSubagentFormDraft({ name: 'worker-x', description: 'd', systemPrompt: 'p' }),
    { modelAvailable: false, thoughtLevelAvailable: true },
  )
  assert.equal(model.modelError, '保存前请选择可用模型', 'ZCode :968-977 + zh-CN.ts:3675')
  assert.equal(model.thoughtLevelInvalid, false)
  const thought = validateAgentSubagentForm(
    createAgentSubagentFormDraft({ name: 'worker-x', description: 'd', systemPrompt: 'p' }),
    { modelAvailable: true, thoughtLevelAvailable: false },
  )
  assert.equal(thought.thoughtLevelInvalid, true, 'ZCode :978-981：档位非法只置 valid=false')
  assert.equal(thought.ok, false)
})

test('提交体：三个文本 trim、继承工具折 undefined、preservedTools 合回来（:1010-1026）', () => {
  const inherit = agentSubagentFormSubmission(
    createAgentSubagentFormDraft({ name: '  worker-x  ', description: ' d ', systemPrompt: ' p ', model: 'zai/glm', thoughtLevel: 'high' }),
  )
  assert.equal(inherit.name, 'worker-x', 'ZCode :1011-1013 三处 trim')
  assert.equal(inherit.description, 'd')
  assert.equal(inherit.systemPrompt, 'p')
  assert.deepEqual(inherit.modelSelection, { providerId: 'zai', modelId: 'glm', options: { reasoningLevel: 'high' } })
  assert.equal(inherit.tools, undefined, 'ZCode :1017-1019：继承全部 → tools undefined')
  assert.equal(inherit.injectAgentsMd, true)

  const custom = agentSubagentFormSubmission({
    ...createAgentSubagentFormDraft({ name: 'worker-x', description: 'd', systemPrompt: 'p', tools: ['Read', 'Bash(git:*)'] }),
    selectedTools: ['Read', 'Grep'],
  })
  assert.deepEqual(custom.tools, ['Read', 'Grep', 'Bash(git:*)'],
    'ZCode :175-183 mergeTools + :1019 把 preservedTools 合回来')

  const noModel = agentSubagentFormSubmission(createAgentSubagentFormDraft({ name: 'worker-x', description: 'd', systemPrompt: 'p' }))
  assert.equal('modelSelection' in noModel, false, '阴性对照：继承模型时提交体不带 modelSelection')
})

test('工具合并与草稿 key（mergeTools :175-183；key 目的同 :321-326）', () => {
  assert.equal(mergeAgentSubagentTools([], []), undefined, 'ZCode :182：空数组折回 undefined')
  assert.deepEqual(mergeAgentSubagentTools(['Read', 'Read'], []), ['Read'], '去重')
  assert.deepEqual(mergeAgentSubagentTools(['Read'], ['Bash(git:*)']), ['Read', 'Bash(git:*)'])
  assert.deepEqual(mergeAgentSubagentTools(['', 'Read'], []), ['Read'], '空串丢掉')
  const a = createAgentSubagentFormDraft({ name: 'a' })
  const b = createAgentSubagentFormDraft({ name: 'a' })
  const c = createAgentSubagentFormDraft({ name: 'b' })
  assert.equal(agentSubagentFormDraftKey(a), agentSubagentFormDraftKey(b), '同内容 → 同 key')
  assert.notEqual(agentSubagentFormDraftKey(a), agentSubagentFormDraftKey(c),
    '阴性对照：内容不同 → key 不同（否则表单不会回灌）')
})

// ── 5. 注册表 CRUD / 覆盖键 / 校验 / 持久化 ──────────────────────────────

test('覆盖键两条真实路径：内置具名用名字、插件用 plugin:<id>:<裸名>（:1508-1522）', () => {
  assert.equal(agentSubagentModelOverrideKey(subagentEntry({ scope: 'built-in', source: 'built-in', name: 'Explore' })),
    'Explore', 'ZCode subagents-types.ts:9-11：内置按 BuiltInSubagentName 作键')
  assert.equal(agentSubagentModelOverrideKey(subagentEntry({ scope: 'built-in', source: 'built-in', name: 'other' })),
    null, '阴性对照：内置但不具名 → 没有覆盖路径')
  assert.equal(agentSubagentModelOverrideKey(subagentEntry({ source: 'plugin', name: 'my-plugin:reviewer', pluginId: 'my-plugin@market' })),
    'plugin:my-plugin@market:reviewer',
    'ZCode subagents-types.ts:148-150 createPluginAgentStateId：plugin:<pluginId>:<裸名小写>')
  assert.equal(agentSubagentModelOverrideKey(subagentEntry()), null,
    '阴性对照：普通用户级条目没有行内覆盖路径（ZCode :1510-1513 直接 return）')
})

test('注册表 CRUD：upsert / remove / setEnabled 的边界逐条对齐 SubagentsSection.tsx', () => {
  const base = defaultAgentSubagentRegistry()
  const added = upsertAgentSubagentRegistryEntry(base, subagentEntry())
  assert.equal(added.entries.length, 1)
  assert.equal(base.entries.length, 0, '不改原对象（返回新清单）')
  const renamed = upsertAgentSubagentRegistryEntry(added, subagentEntry({ description: '改过的描述' }))
  assert.equal(renamed.entries.length, 1, '同 id 是覆盖不是追加')
  assert.equal(renamed.entries[0].description, '改过的描述')
  assert.equal(upsertAgentSubagentRegistryEntry(added, { name: '' }).entries.length, 1,
    '阴性对照：救不回来的条目直接忽略，不写坏值')

  // 删除：只有可编辑用户级删得动（ZCode :1455-1457）。
  const builtIn = subagentEntry({ id: 'built-in:built-in:Explore', name: 'Explore', scope: 'built-in', source: 'built-in' })
  const withBuiltIn = upsertAgentSubagentRegistryEntry(added, builtIn)
  assert.equal(withBuiltIn.entries.length, 2)
  assert.equal(removeAgentSubagentRegistryEntry(withBuiltIn, 'built-in:built-in:Explore').entries.length, 2,
    'ZCode :1455-1457：isEditableUserAgent 为假时 delete 直接 return')
  assert.equal(removeAgentSubagentRegistryEntry(withBuiltIn, 'user:user:worker-x').entries.length, 1,
    '阳性对照：用户级条目删得掉')

  // 启停：只有 user scope 有开关（ZCode :144-146）。
  const disabled = setAgentSubagentRegistryEnabled(withBuiltIn, 'user:user:worker-x', false)
  assert.deepEqual(disabled.disabledAgentIds, ['user:user:worker-x'],
    'ZCode :1494-1497：写入 disabledAgentIds')
  assert.equal(disabled.entries.find((e) => e.id === 'user:user:worker-x').enabled, false)
  const noop = setAgentSubagentRegistryEnabled(withBuiltIn, 'built-in:built-in:Explore', false)
  assert.deepEqual(noop.disabledAgentIds, [],
    'ZCode :144-146：内置条目没有启用开关，写了也是一条永不生效的死记录')
  assert.deepEqual(setAgentSubagentRegistryEnabled(withBuiltIn, '不存在', false), withBuiltIn,
    '未知 id 不动清单')
})

test('能力判定：可编辑 / 启用开关 / 行内覆盖三档', () => {
  assert.equal(isEditableUserSubagent(subagentEntry()), true, 'ZCode SubagentsSection.tsx:132-138')
  assert.equal(isEditableUserSubagent(subagentEntry({ scope: 'workspace' })), true,
    'ZCode :134：workspace + source=user 仍可编辑')
  assert.equal(isEditableUserSubagent(subagentEntry({ readOnly: true })), false, 'ZCode :136')
  assert.equal(supportsSubagentEnabledToggle(subagentEntry()), true, 'ZCode :144-146：user scope 有开关')
  assert.equal(supportsSubagentEnabledToggle(subagentEntry({ scope: 'workspace' })), false,
    'ZCode :140-143：workspace agent 不能展示启用开关（点了会静默回弹）')
  assert.equal(supportsSubagentModelOverride(subagentEntry({ source: 'plugin', pluginId: 'p@m' })), true,
    'ZCode :156-158：插件 agent 有行内覆盖')
  assert.equal(supportsSubagentModelOverride(subagentEntry()), false, '阴性对照：普通用户级没有')
})

test('模型覆盖写入与清除：无覆盖键不动；清空删键而不是留空对象（:1508-1522）', () => {
  const withPlugin = upsertAgentSubagentRegistryEntry(defaultAgentSubagentRegistry(),
    subagentEntry({ id: 'plugin:p@m:r', name: 'p:r', source: 'plugin', pluginId: 'p@m' }))
  const written = setAgentSubagentModelOverride(withPlugin, 'plugin:p@m:r', { model: 'zai/glm', thoughtLevel: 'high' })
  assert.deepEqual(written.modelOverrides, { 'plugin:p@m:r': { model: 'zai/glm', thoughtLevel: 'high' } })
  const cleared = setAgentSubagentModelOverride(written, 'plugin:p@m:r', null)
  assert.deepEqual(cleared.modelOverrides, {}, '清空 = 删键')
  const modelOnly = setAgentSubagentModelOverride(written, 'plugin:p@m:r', { model: 'zai/glm' })
  assert.deepEqual(modelOnly.modelOverrides, { 'plugin:p@m:r': { model: 'zai/glm' } },
    '阴性对照：只给模型时不带 thoughtLevel 键')
  const plain = upsertAgentSubagentRegistryEntry(defaultAgentSubagentRegistry(), subagentEntry())
  assert.deepEqual(setAgentSubagentModelOverride(plain, 'user:user:worker-x', { model: 'zai/glm' }), plain,
    'ZCode :1510-1513：没有覆盖路径的条目直接不动')
})

test('归一化：逐字段救、垃圾条目只丢自己、enabled 不读存档（agentSubagents.ts:330 同口径）', () => {
  const saved = normalizeAgentSubagentRegistry({
    entries: [
      subagentEntry({ color: 'chartreuse', model: 'inherit', tools: ['Read', '  ', 42, 'Bash'] }),
      '不是对象',
      { name: '   ', path: 'x/agent.md' },
      subagentEntry({ name: 'worker-y', path: 'b/agent.md', enabled: false }),
      subagentEntry({ name: 'worker-z', path: 'c/agent.md', enabled: false }),
    ],
    disabledAgentIds: ['user:user:worker-y', '  ', 7, 'user:user:worker-y'],
    modelOverrides: { 'user:user:worker-x': { model: 'zai/glm', thoughtLevel: 'high' }, '  ': { model: 'x' }, k: 5 },
  })
  assert.equal(saved.entries.length, 3, '空名/非对象两条救不回来 → 只丢自己')
  assert.equal(saved.entries[0].color, undefined, '非法颜色丢字段不报错')
  assert.equal(saved.entries[0].model, undefined, 'ZCode SubagentsSection.tsx:86,190-193：inherit 不写进 model')
  assert.deepEqual(saved.entries[0].tools, ['Read', 'Bash'], '非字符串项丢弃、空串修剪')
  assert.equal(saved.entries[1].enabled, false, '在停用表里 → 停用（ZCode subagentsService.ts:287）')
  assert.equal(saved.entries[2].enabled, true,
    '阴性对照：worker-z 存档里写着 enabled:false 但不在停用表里 → 仍是启用（enabled 不读存档）')
  assert.deepEqual(saved.disabledAgentIds, ['user:user:worker-y'], '只留非空字符串并去重')
  assert.deepEqual(Object.keys(saved.modelOverrides), ['user:user:worker-x'], '空键与非对象值都丢掉')
})

test('校验拦下空名 / 越界名 / 非法字符 / 路径空与越界 / 死记录', () => {
  const problems = validateAgentSubagentRegistry(normalizeAgentSubagentRegistry({
    entries: [
      subagentEntry({ name: 'ab' }),
      subagentEntry({ name: '有中文名' }),
      subagentEntry({ name: 'escape', path: 'C:\\..\\Windows\\System32\\agent.md' }),
      subagentEntry({ name: 'nopath', path: '  ' }),
    ],
  }))
  // nopath 那条在归一化阶段就被丢了（路径救不回来），所以这里只有 3 条。
  assert.equal(problems.length, 3, `三条硬问题各报一次，实际：${JSON.stringify(problems)}`)
  assert.ok(problems.some((p) => p.includes('ab') && p.includes('3 到 50')), '短名报长度区间（:929-936）')
  assert.ok(problems.some((p) => p.includes('有中文名') && p.includes('字母、数字和连字符')), '非法字符（:937-943）')
  assert.ok(problems.some((p) => p.includes('escape') && p.includes('越出子智能体目录')), '路径越界当场拦下')
  assert.deepEqual(validateAgentSubagentRegistry(normalizeAgentSubagentRegistry({ entries: [subagentEntry()] })), [],
    '阳性对照：合法条目零问题')
})

test('校验拦下重名与死记录（id 会小写，所以 dup 与 DUP 撞同一条）', () => {
  const saved = normalizeAgentSubagentRegistry({
    entries: [subagentEntry({ name: 'dup' }), subagentEntry({ name: 'dup' }), subagentEntry({ name: 'DUP' })],
  })
  assert.equal(saved.entries.length, 3, '归一化不去重 —— 去重是 validate 的职责（磁盘上真的是三个文件）')
  const problems = validateAgentSubagentRegistry(saved)
  assert.equal(problems.filter((p) => p.includes('重名')).length, 2, `三条同 id 报两次，实际：${JSON.stringify(problems)}`)
  assert.ok(problems.some((p) => p.includes('DUP')), '第三条要指名它')

  const builtIn = subagentEntry({ id: 'built-in:built-in:probe', name: 'probe', scope: 'built-in', source: 'built-in' })
  const withDead = normalizeAgentSubagentRegistry({
    entries: [subagentEntry(), builtIn],
    disabledAgentIds: ['built-in:built-in:probe', 'user:user:ghost'],
  })
  const dead = validateAgentSubagentRegistry(withDead)
  assert.equal(dead.length, 2, `两条死记录各报一次，实际：${JSON.stringify(dead)}`)
  assert.ok(dead.some((p) => p.includes('built-in:built-in:probe') && p.includes('运行时不认')),
    'ZCode SubagentsSection.tsx:140-143：非 user scope 的停用记录永不生效')
  assert.ok(dead.some((p) => p.includes('user:user:ghost') && p.includes('没有对应')))

  const badOverride = validateAgentSubagentRegistry(normalizeAgentSubagentRegistry({
    entries: [subagentEntry({ source: 'plugin', pluginId: 'p@m', name: 'p:r' })],
    modelOverrides: { 'plugin:p@m:nobody': { model: 'zai/glm' } },
  }))
  assert.ok(badOverride.some((p) => p.includes('plugin:p@m:nobody')), '悬空模型覆盖要报出来')
  assert.deepEqual(validateAgentSubagentRegistry(normalizeAgentSubagentRegistry({
    entries: [subagentEntry()],
    disabledAgentIds: ['user:user:worker-x'],
  })), [], '阳性对照：user scope 的停用记录是有效的')
})

test('作用域筛选与搜索命中字段（SubagentsSection.tsx:1566-1600）', () => {
  const entries = [
    subagentEntry({ name: 'user-one' }),
    subagentEntry({ id: 'user:workspace:ws-one', name: 'ws-one', scope: 'workspace' }),
    subagentEntry({ id: 'built-in:built-in:Explore', name: 'Explore', scope: 'built-in', source: 'built-in' }),
  ]
  assert.deepEqual(filterAgentSubagentsForScope(entries, 'user').map((e) => e.name), ['user-one', 'Explore'],
    'ZCode :1569-1571：user 页签只排除 workspace scope（内置仍留在列表里）')
  assert.deepEqual(filterAgentSubagentsForScope(entries, 'workspace').map((e) => e.name), ['ws-one'],
    'ZCode :1572-1579：workspace 页签排除内置与非 workspace')
  assert.deepEqual(filterAgentSubagentRegistry(entries, '').length, 3, '空查询返回全部')
  assert.deepEqual(filterAgentSubagentRegistry(entries, 'explore').map((e) => e.name), ['Explore'],
    'ZCode :1581-1598：命中 name 不分大小写')
  assert.deepEqual(filterAgentSubagentRegistry(entries, 'built-in').map((e) => e.name), ['Explore'],
    'ZCode :1589：scope 也参与命中')
  assert.deepEqual(filterAgentSubagentRegistry(entries, 'zzz'), [], '阴性对照：查不到就是空')
})

test('存储往返 + 坏档永不抛（走 agentSettingsStore 的窄接口）', () => {
  const storage = createMemoryStorage()
  const settings = normalizeAgentSubagentRegistry({
    entries: [subagentEntry({ color: 'cyan', model: 'zai/glm', thoughtLevel: 'high' })],
    disabledAgentIds: ['user:user:worker-x'],
  })
  assert.equal(saveAgentSubagentRegistry(settings, storage), true)
  assert.ok(storage.dump()[AGENT_SUBAGENT_REGISTRY_STORAGE_KEY], `存档要落在 ${AGENT_SUBAGENT_REGISTRY_STORAGE_KEY} 上`)
  const back = loadAgentSubagentRegistry(storage)
  assert.equal(back.entries.length, 1)
  assert.equal(back.entries[0].color, 'cyan')
  assert.equal(back.entries[0].enabled, false, '往返后仍由停用表算出停用')
  assert.deepEqual(back.disabledAgentIds, ['user:user:worker-x'])

  assert.deepEqual(loadAgentSubagentRegistry(null), defaultAgentSubagentRegistry(), '没有存储 = 出厂默认，不是崩')
  assert.deepEqual(loadAgentSubagentRegistry(createThrowingStorage()), defaultAgentSubagentRegistry(),
    'getItem 抛异常 = 静默降级')
  assert.deepEqual(loadAgentSubagentRegistry(createMemoryStorage({ [AGENT_SUBAGENT_REGISTRY_STORAGE_KEY]: '{不是 json' })),
    defaultAgentSubagentRegistry(), '坏 JSON 退回默认，不把用户锁在设置外')
  assert.equal(saveAgentSubagentRegistry(defaultAgentSubagentRegistry(), null), false, '存不下只丢持久化')
  assert.equal(saveAgentSubagentRegistry(defaultAgentSubagentRegistry(), createThrowingStorage()), false)
})

// ── 6. 钩子表单 ──────────────────────────────────────────────────────────

test('钩子草稿初值逐条对齐 HookForm.tsx:90-105', () => {
  const draft = createAgentHookFormDraft()
  assert.equal(draft.event, 'PreToolUse', 'ZCode HookForm.tsx:96 新建初值')
  assert.equal(draft.type, 'process', 'ZCode HookForm.tsx:97 新建初值')
  assert.equal(draft.matcher, '')
  assert.equal(draft.command, '')
  assert.equal(draft.async, false, 'ZCode HookForm.tsx:101')
  assert.equal(draft.timeoutText, '60', 'ZCode HookForm.tsx:104：hook?.timeout ?? 60')
  assert.equal(draft.storageLevel, 'user', 'ZCode HookForm.tsx:92-93：workspace 不可用时恒 user')
  assert.equal(draft.customJson, '', 'ZCode HookForm.tsx:45-47：空 custom 展示为空串')

  const fromHook = createAgentHookFormDraft({ hook: hookEntry({ matcher: 'Write', args: ['a', 'b'], timeoutSeconds: 30, scope: 'project' }) })
  assert.equal(fromHook.matcher, 'Write')
  assert.equal(fromHook.argsText, 'a\nb', 'ZCode HookForm.tsx:100：args 用 \\n 连接')
  assert.equal(fromHook.timeoutText, '30')
  assert.equal(fromHook.storageLevel, 'user', 'ZCode HookForm.tsx:92：workspace 不可用时即使 hook 是 project 也落 user')
  assert.equal(createAgentHookFormDraft({ hook: hookEntry({ scope: 'project' }), workspaceAvailable: true }).storageLevel, 'project',
    'ZCode HookForm.tsx:90-93：workspace 可用且编辑 project hook → project')
  assert.equal(createAgentHookFormDraft({ workspaceAvailable: true, defaultStorageLevel: 'project' }).storageLevel, 'project',
    'ZCode HookForm.tsx:92：新建态用 defaultStorageLevel')
})

test('自定义 JSON：空串合法、必须 object（HookForm.tsx:107-115）', () => {
  assert.equal(agentHookCustomJsonValid(''), true, 'ZCode HookForm.tsx:108：空串合法')
  assert.equal(agentHookCustomJsonValid('   '), true)
  assert.equal(agentHookCustomJsonValid('{"a":1}'), true, '阳性对照：object 合法')
  assert.equal(agentHookCustomJsonValid('[1,2]'), false, 'ZCode HookForm.tsx:111：数组不算 object')
  assert.equal(agentHookCustomJsonValid('42'), false, '标量不算 object')
  assert.equal(agentHookCustomJsonValid('{不是 json'), false, 'ZCode HookForm.tsx:113-114')
  assert.equal(formatAgentHookCustomJson({ a: 1 }), '{\n  "a": 1\n}', 'ZCode HookForm.tsx:45-47：缩进 2')
  assert.equal(formatAgentHookCustomJson({}), '', '阴性对照：空对象展示为空串')
  assert.equal(agentHookFormCanSave(hookDraft({ command: '  ' })), false, 'ZCode HookForm.tsx:116：命令非空是硬门')
  assert.equal(agentHookFormCanSave(hookDraft({ command: 'node x.mjs' })), true)
  assert.equal(agentHookFormCanSave(hookDraft({ command: 'node x.mjs', customJson: '[1]' })), false,
    'ZCode HookForm.tsx:116：JSON 非法同样不能保存')
})

test('保存投影：process→args、command→async+shell 互斥（HookForm.tsx:137-158）', () => {
  const process = agentHookFormSaveConfig(hookDraft({
    command: ' node x.mjs ', matcher: ' Write , Edit ', statusMessage: ' 检查中 ', argsText: ' a \n\n b ', timeoutText: '30',
  }))
  assert.ok(process.config, '阳性对照：能保存')
  assert.equal(process.config.command, 'node x.mjs', 'ZCode HookForm.tsx:141：command trim')
  assert.equal(process.config.matcher, 'Write , Edit', 'ZCode HookForm.tsx:139：matcher trim（内部空格不动）')
  assert.equal(process.config.statusMessage, '检查中', 'ZCode HookForm.tsx:153：statusMessage trim')
  assert.deepEqual(process.config.args, ['a', 'b'], 'ZCode HookForm.tsx:144-147：按 \\n 切、trim、丢空行')
  assert.equal(process.config.timeout, 30)
  assert.equal('async' in process.config, false, 'ZCode HookForm.tsx:142：process 型不带 async')
  assert.equal('shell' in process.config, false, 'ZCode HookForm.tsx:142：process 型不带 shell')
  assert.equal(process.config.storageLevel, 'user')

  const command = agentHookFormSaveConfig(hookDraft({
    type: 'command', command: 'echo hi', async: true, shell: ' bash ', argsText: 'a\nb',
  }))
  assert.ok(command.config)
  assert.equal(command.config.async, true, 'ZCode HookForm.tsx:150')
  assert.equal(command.config.shell, 'bash', 'ZCode HookForm.tsx:151：shell trim')
  assert.equal('args' in command.config, false, 'ZCode HookForm.tsx:142：command 型不带 args')

  // 空白 matcher / statusMessage / shell 折成 undefined（:139, :151, :153）。
  const bare = agentHookFormSaveConfig(hookDraft({ type: 'command', command: 'x' }))
  assert.ok(bare.config)
  assert.equal('matcher' in bare.config, false)
  assert.equal('statusMessage' in bare.config, false)
  assert.equal('shell' in bare.config, false)
  assert.equal(bare.config.async, false, 'ZCode HookForm.tsx:150：async 恒显式给出')

  // 原 shell 是布尔 true 时要保留（:151 的第二支）。
  const keepTrue = agentHookFormSaveConfig(hookDraft({ type: 'command', command: 'x' }), { shell: true })
  assert.ok(keepTrue.config)
  assert.equal(keepTrue.config.shell, true, 'ZCode HookForm.tsx:151：hook.shell === true 时保留 true')

  // enabled 由原 hook 决定，新建即开（:155）。
  const keepEnabled = agentHookFormSaveConfig(hookDraft({ command: 'x' }), { enabled: false })
  assert.ok(keepEnabled.config)
  assert.equal(keepEnabled.config.enabled, false, 'ZCode HookForm.tsx:155：hook?.enabled ?? true')
  const fresh = agentHookFormSaveConfig(hookDraft({ command: 'x' }))
  assert.ok(fresh.config)
  assert.equal(fresh.config.enabled, true)

  // 超时：parseInt 失败回 60（:154）。
  const badTimeout = agentHookFormSaveConfig(hookDraft({ command: 'x', timeoutText: 'abc' }))
  assert.ok(badTimeout.config)
  assert.equal(badTimeout.config.timeout, 60, 'ZCode HookForm.tsx:154：parseInt(...) || 60')

  // 空命令与两种 JSON 错误。
  const noCommand = agentHookFormSaveConfig(hookDraft({ command: '   ' }))
  assert.deepEqual(noCommand, { error: '命令不能为空。' }, 'ZCode HookForm.tsx:119-120 早退')
  const parseError = agentHookFormSaveConfig(hookDraft({ command: 'x', customJson: '{bad' }))
  assert.deepEqual(parseError, { error: '自定义字段 JSON 解析失败。' }, 'ZCode zh-CN.ts:4092')
  const objectError = agentHookFormSaveConfig(hookDraft({ command: 'x', customJson: '[1]' }))
  assert.deepEqual(objectError, { error: '自定义字段必须是 JSON object。' }, 'ZCode zh-CN.ts:4091')
  const withCustom = agentHookFormSaveConfig(hookDraft({ command: 'x', customJson: '{"a":1}' }))
  assert.ok(withCustom.config)
  assert.deepEqual(withCustom.config.custom, { a: 1 }, 'ZCode HookForm.tsx:129：custom 原样带上')
})

test('表单作用域 key 与 argv 切分（HookForm.tsx:94-95 / :144-147）', () => {
  assert.equal(agentHookFormScopeKey(createAgentHookFormDraft(), 'ws-key'), 'user',
    'ZCode HookForm.tsx:95：storageLevel 不是 project 就是 user')
  assert.equal(agentHookFormScopeKey(createAgentHookFormDraft({ workspaceAvailable: true, defaultStorageLevel: 'project' }), 'ws-key'),
    'ws-key', 'ZCode HookForm.tsx:95：project 时用首个 workspace key')
  assert.equal(agentHookFormScopeKey(hookDraft({ storageLevel: 'project' }), 'ws-key'), 'ws-key',
    '阳性对照：草稿 storageLevel=project 时用传入的 workspace key')
  assert.deepEqual(splitAgentHookArgs(' a \n\n b \n'), ['a', 'b'], 'ZCode HookForm.tsx:144-147')
  assert.deepEqual(splitAgentHookArgs(''), [])
})

test('超时区间：本仓上限 3600（ZCode 只有 min=1，见 src/agentHooks.ts:118-124）', () => {
  assert.equal(isAgentHookTimeoutInRange(60), true, 'ZCode HookForm.tsx:320-323 的 min=1')
  assert.equal(isAgentHookTimeoutInRange(1), true)
  assert.equal(isAgentHookTimeoutInRange(0), false, 'ZCode HookForm.tsx:322 min={1}')
  assert.equal(isAgentHookTimeoutInRange(3600), true, '本仓上限（src/agentHooks.ts:124）')
  assert.equal(isAgentHookTimeoutInRange(3601), false, '本仓上限之外')
  assert.equal(isAgentHookTimeoutInRange(1.5), false, '必须是整数秒')
})

// ── 7. 工作区钩子信任门控 ────────────────────────────────────────────────

test('信任提示四道门缺一不可（WorkspaceHookTrustNotice.tsx:14-34）', () => {
  const hooks = [workspaceHook()]
  const base = { hooks, loadedWorkspaceKey: 'A', rpcReady: true, targetWorkspaceKey: 'A' }
  assert.equal(shouldShowWorkspaceHookTrustNotice(base), true, '四道门全过 → 显示')
  assert.equal(shouldShowWorkspaceHookTrustNotice({ ...base, rpcReady: false }), false, 'ZCode :29：rpcReady 是硬门')
  assert.equal(shouldShowWorkspaceHookTrustNotice({ ...base, targetWorkspaceKey: null }), false, 'ZCode :30')
  assert.equal(shouldShowWorkspaceHookTrustNotice({ ...base, loadedWorkspaceKey: 'B' }), false,
    'ZCode :25-27,31：快照 key 与 target 不等 → 不许显示（否则把 A 的风险归因到正在连接的 B）')
  assert.equal(shouldShowWorkspaceHookTrustNotice({ ...base, hooks: [hookEntry()] }), false,
    'ZCode :10-12：没有需审核的 hook 就不显示')
  assert.equal(shouldShowWorkspaceHookTrustNotice({ ...base, hooks: [workspaceHook({ trust: 'trusted_persistent' })] }), false,
    'ZCode :7：已持久信任的不再提示')
  assert.equal(shouldShowWorkspaceHookTrustNotice({ ...base, hooks: [workspaceHook({ trust: 'revoked' })] }), true,
    '阴性对照：revoked 不是 trusted_persistent，仍需提示')
})

test('已配置行的开关：需审核时强制为关且禁用（HooksList.tsx:294-303）', () => {
  const trusted = configuredAgentHookSwitchState(hookEntry())
  assert.deepEqual(trusted, { requiresTrust: false, checked: true, disabled: false },
    '阳性对照：普通用户钩子可自由拨动')
  const pending = configuredAgentHookSwitchState(workspaceHook({ enabled: true }))
  assert.equal(pending.requiresTrust, true)
  assert.equal(pending.checked, false, 'ZCode HooksList.tsx:299：checked 恒 false（不是显示真实值）')
  assert.equal(pending.disabled, true, 'ZCode HooksList.tsx:302：需审核 → 禁用')
  assert.equal(configuredAgentHookSwitchState(workspaceHook({ trust: 'trusted_persistent', enabled: true })).checked, true,
    '阴性对照：信任后展示真实配置状态')
  assert.equal(configuredAgentHookSwitchState(workspaceHook({ trust: 'trusted_persistent' }), { readOnly: true }).disabled, true,
    'ZCode HooksList.tsx:296-297,302：只读行信任后仍不可拨')
  assert.equal(configuredAgentHookSwitchState(hookEntry(), { busy: true }).disabled, true, 'ZCode HooksList.tsx:302：busy 也禁用')
  assert.equal(configuredAgentHookSwitchState(hookEntry(), { trusting: true }).disabled, true)
})

test('分组归类：只读 zcode 钩子留在 Installed，不进 Legacy（HooksSection.tsx:44-60）', () => {
  assert.equal(classifyAgentHookSection({}), 'installed', 'ZCode HooksSection.tsx:47：无 location 回退旧规则 → 可编辑')
  assert.equal(classifyAgentHookSection({ location: { source: 'zcode' } }), 'installed', 'ZCode :47：source=zcode')
  assert.equal(classifyAgentHookSection({ location: { source: 'claude' } }), 'legacy',
    'ZCode :58-60：外部来源且不可编辑 → 兼容导入分组')
  assert.equal(classifyAgentHookSection({ editable: false, readOnly: true, location: { source: 'zcode' } }), 'installed',
    'ZCode :50-56：只读 zcode 工作区钩子留在 Installed（塞进 Legacy 会让 Import 必然失败）')
  assert.equal(classifyAgentHookSection({ editable: true, location: { source: 'claude' } }), 'installed',
    'ZCode :44-48：有 editable 标志就尊重它')
})

test('作用域筛选与搜索命中字段（HooksSection.tsx:206-222 / :578-590）', () => {
  const hooks = [
    hookEntry({ id: 'u', scope: 'user', command: 'node a.mjs' }),
    workspaceHook({ id: 'p', scope: 'project', command: 'node b.mjs' }),
  ]
  assert.deepEqual(filterAgentHooksForScope(hooks, 'user').map((h) => h.id), ['u'],
    'ZCode HooksSection.tsx:211：location.scope ?? "user" 与 activeScope 相等')
  assert.deepEqual(filterAgentHooksForScope(hooks, 'project').map((h) => h.id), ['p'])
  assert.deepEqual(filterAgentHooksByQuery(hooks, 'B.MJS').map((h) => h.id), ['p'],
    'ZCode HooksSection.tsx:582-589：command 参与命中且不分大小写')
  assert.deepEqual(filterAgentHooksByQuery(hooks, 'PreToolUse').length, 2, 'ZCode :583：event 参与命中')
  assert.deepEqual(filterAgentHooksByQuery(hooks, '').length, 2, '空查询返回全部')
  assert.deepEqual(filterAgentHooksByQuery(hooks, 'zzz'), [], '阴性对照：查不到就是空')
  assert.deepEqual(filterAgentHooksByQuery([hookEntry({ args: ['needle'] })], 'needle').length, 1,
    'ZCode :587：args 也参与命中')
})

// ── 8. 作用域页签 ────────────────────────────────────────────────────────

test('scope key 与连接判定（PluginScopeMenu.tsx:17-33 + workspaceKey.ts:5-7）', () => {
  assert.equal(agentScopeWorkspaceKey({ workspacePath: 'C:/p' }), 'C:/p', 'ZCode workspaceKey.ts:5-7：无 identity 用路径')
  assert.equal(agentScopeWorkspaceKey({ workspacePath: 'C:/p', workspaceIdentity: ' id ' }), 'id',
    'ZCode workspaceKey.ts:5-7：identity 优先且 trim')
  assert.equal(isAgentScopeWorkspaceConnected({ workspacePath: 'C:/p' }), true, 'ZCode PluginScopeMenu.tsx:30-32：本地可用')
  assert.equal(isAgentScopeWorkspaceConnected({ workspacePath: 'C:/p', availability: 'unavailable-local-directory' }), false,
    'ZCode PluginScopeMenu.tsx:24-26')
  assert.equal(isAgentScopeWorkspaceConnected({ workspacePath: 'C:/p', remoteTarget: {} }), false,
    'ZCode PluginScopeMenu.tsx:33：远端必须有 session')
  assert.equal(isAgentScopeWorkspaceConnected({ workspacePath: 'C:/p', remoteTarget: {}, remoteSessionId: 's' }), true)
})

test('页签筛选：子智能体节排除远端，钩子节不排除（SubagentsSection.tsx:1279-1294 / HooksSection.tsx:157-168）', () => {
  const tabs = [
    { workspacePath: 'C:/local' },
    { workspacePath: 'C:/local' },
    { workspacePath: 'C:/remote', workspaceIdentity: 'rid', remoteSessionId: 's' },
    { workspacePath: 'C:/dead', availability: 'unavailable-local-directory' },
  ]
  assert.deepEqual(selectSubagentScopeTabs(tabs).map(agentScopeWorkspaceKey), ['C:/local'],
    'ZCode SubagentsSection.tsx:1285-1286：只管理 Local Environment（排除远端）+ 去重 + 排除失效目录')
  assert.deepEqual(selectHookScopeTabs(tabs).map(agentScopeWorkspaceKey), ['C:/local', 'rid'],
    'ZCode HooksSection.tsx:157-168：钩子节保留远端 workspace')
})

test('作用域失效回落 user（HooksSection.tsx:322-329）', () => {
  const tabs = [{ workspacePath: 'C:/local' }]
  assert.equal(resolveAgentScopeSelection('user', tabs), 'user')
  assert.equal(resolveAgentScopeSelection('C:/local', tabs), 'C:/local', '阳性对照：页签还在就保留')
  assert.equal(resolveAgentScopeSelection('C:/gone', tabs), 'user', 'ZCode HooksSection.tsx:322-329：失效 scope 重置 user')
  assert.equal(resolveAgentScopeSelection('C:/gone', []), 'user', '阴性对照：没有页签时任何非 user 都回落')
})