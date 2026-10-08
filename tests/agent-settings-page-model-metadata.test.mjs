// 模型设置节的**模型元数据编辑入口**判据：字段编辑 → 数据模型往返；画出来的每个控件都指回一个真实字段。
//
// 起因（docs/handoffs/2026-10-08-zcode-idea-ui-handoff.md §推理档位端到端缺口 3）：这一节原先只有供应商
// CRUD，模型的 contextWindow / maxOutputTokens / inputFormat / 能力开关 / 推理档位与映射没有任何编辑入口，
// 于是 ZCode 的「编辑模型配置」在本仓是断的。本轮的评审口径：
//   · 只画本仓 `AgentProviderModelConfig`（src/agentModelProviders.ts）里真实存在的字段；上游有而本仓
//     记录没有的字段（requiresMfjsToolSchema / supportsToolCall / outputFormat / 推理档位 Option Spec
//     JSON）一律不画，避免假控件；
//   · 校验与非法文案走既有纯函数（`resolveAgentProviderModelMetadataCommit`、
//     `resolveAgentModelMetadataInvalidMessage`），界面不另写一套规则；
//   · 编辑对象是列表里当前点开的那一条列表项本体，提交结果写回 `draft.providers`，随页面「保存」落盘
//     （`normalizeAgentSettings` 是模型的真落点）。
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import {
  AGENT_VISIBLE_MODEL_INPUT_MODALITIES,
  createAgentProviderModelMetadataDraft,
  isAgentModelConfigComplete,
  resolveAgentModelMetadataInvalidMessage,
  resolveAgentProviderModelMetadataCommit,
  validateAgentModelProviderTable,
} from '../src/agentModelProviders.ts'
import { normalizeAgentSettings } from '../src/agentSettings.ts'

const page = readFileSync(new URL('../src/components/AgentSettingsPage.vue', import.meta.url), 'utf8')
const editor = readFileSync(new URL('../src/components/agent-settings/ModelMetadataSection.vue', import.meta.url), 'utf8')

// 本页的模板里有嵌套 <template v-if>，所以取**最后一个** </template> 才是根模板的收尾。
const templateOf = source => source.slice(source.indexOf('<template>'), source.lastIndexOf('</template>') + '</template>'.length)
const scriptOf = source => source.slice(source.indexOf('<script'), source.indexOf('</script>'))

const pageScript = scriptOf(page)
const pageTemplate = templateOf(page)
const editorScript = scriptOf(editor)
const editorTemplate = templateOf(editor)

/** 一条带全元数据的模型（对照 src/agentModelProviders.ts 的 `AgentProviderModelConfig`）。 */
const baseModel = () => ({
  id: 'glm-4.6',
  name: 'GLM-4.6',
  enabled: true,
  contextWindow: 128000,
  maxOutputTokens: 4096,
  inputFormat: { supportsText: true, supportsImage: false, supportsVideo: false, supportsAudio: false, supportsPdf: false },
  supportsJsonSchemaOutput: false,
  supportsNativeWebSearch: false,
  supportsMidConversationSystem: false,
  reasoningLevels: ['low', 'high'],
  // 受限 CEL：对象字面量的值是档位变量（compileModelOptionMap 的语法，src/agentModelOptionMap.ts）。
  reasoningLevelMap: '{"reasoning_effort": reasoningLevel}',
})

/** 页面「保存」的同一段路：JSON 克隆 → normalizeAgentSettings（供应商表的真落点）。 */
const saveAndReload = model => normalizeAgentSettings({
  providers: [{
    id: 'p1', name: '自建供应商', baseUrl: '', apiKey: '', apiFormat: 'anthropic-messages',
    models: [JSON.parse(JSON.stringify(model))],
  }],
}).providers[0].models[0]

test('编辑→提交→保存→读回：六个元数据字段一个不漏', () => {
  const current = baseModel()
  const draft = createAgentProviderModelMetadataDraft(current)
  draft.contextWindowValue = '200000'
  draft.maxOutputTokensValue = '8192'
  draft.inputFormatValue = { supportsText: true, supportsImage: true, supportsVideo: false, supportsAudio: false, supportsPdf: true }
  draft.reasoningLevelValuesValue = [' minimal ', 'low', 'high']
  draft.reasoningLevelMapValue = ' {"reasoning_effort": reasoningLevel} '

  const result = resolveAgentProviderModelMetadataCommit({ currentModel: current, draft })
  assert.equal(result.status, 'commit', '合法草稿必须能提交')
  const committed = result.model
  assert.equal(committed.contextWindow, 200000)
  assert.equal(committed.maxOutputTokens, 8192)
  assert.deepEqual(committed.inputFormat, { supportsText: true, supportsImage: true, supportsVideo: false, supportsAudio: false, supportsPdf: true })
  // 提交的是 trim 后的档位与编译后的映射（ProviderModelMetadata.ts:148-167）
  assert.deepEqual([...committed.reasoningLevels], ['minimal', 'low', 'high'])
  assert.equal(committed.reasoningLevelMap, '{"reasoning_effort": reasoningLevel}')

  const roundTripped = saveAndReload(committed)
  assert.equal(roundTripped.contextWindow, 200000)
  assert.equal(roundTripped.maxOutputTokens, 8192)
  assert.deepEqual(roundTripped.inputFormat, committed.inputFormat)
  assert.deepEqual([...roundTripped.reasoningLevels], ['minimal', 'low', 'high'])
  assert.equal(roundTripped.reasoningLevelMap, '{"reasoning_effort": reasoningLevel}')
  assert.equal(isAgentModelConfigComplete(roundTripped), true)
})

test('能力开关跟着提交结果与往返（本仓 draft 形状没有它们的值槽）', () => {
  // ZCode 的 draft 有 supports*Value 三个值槽（ProviderModelMetadata.ts:24-26），本仓
  // `AgentProviderModelMetadataDraft` 没有；提交函数对这三项的口径是 `currentModel ?? false`
  // （ProviderModelMetadata.ts:182-193），所以编辑器把本节勾选的三项接在提交结果上。
  assert.match(editorScript, /supportsJsonSchemaOutput: props\.model\.supportsJsonSchemaOutput \?\? false/)
  assert.match(editorScript, /supportsNativeWebSearch: props\.model\.supportsNativeWebSearch \?\? false/)
  assert.match(editorScript, /supportsMidConversationSystem: props\.model\.supportsMidConversationSystem \?\? false/)
  assert.match(editorScript, /emit\('commit', \{ \.\.\.result\.model, \.\.\.capabilities \}\)/)

  const roundTripped = saveAndReload({
    id: 'm', name: 'M', enabled: true,
    supportsJsonSchemaOutput: true, supportsNativeWebSearch: false, supportsMidConversationSystem: true,
  })
  assert.equal(roundTripped.supportsJsonSchemaOutput, true)
  assert.equal(roundTripped.supportsNativeWebSearch, false)
  assert.equal(roundTripped.supportsMidConversationSystem, true)
})

test('非法输入逐字段判到，文案取自既有映射表', () => {
  const current = baseModel()
  const cases = [
    [draft => { draft.idValue = '   ' }, 'id'],
    [draft => { draft.contextWindowValue = '' }, 'contextWindow'],
    [draft => { draft.maxOutputTokensValue = '0' }, 'maxOutputTokens'],
    [draft => { draft.inputFormatValue = { ...draft.inputFormatValue, supportsText: false } }, 'inputFormat'],
    [draft => { draft.reasoningLevelValuesValue = ['low', 'low'] }, 'reasoningLevelValues'],
    [draft => { draft.reasoningLevelMapValue = 'reasoning_level' }, 'reasoningLevelMap'],
  ]
  for (const [mutate, field] of cases) {
    const draft = createAgentProviderModelMetadataDraft(current)
    mutate(draft)
    const result = resolveAgentProviderModelMetadataCommit({ currentModel: current, draft })
    assert.equal(result.status, 'invalid', `${field} 应判非法`)
    assert.equal(result.field, field, `${field} 的非法字段名要对得上`)
    assert.ok(resolveAgentModelMetadataInvalidMessage(field).length > 0, `${field} 没有可显示的文案`)
  }
  assert.equal(resolveAgentModelMetadataInvalidMessage('id'), '模型 ID 不能为空')
  assert.equal(resolveAgentModelMetadataInvalidMessage('reasoningLevelMap'), '推理参数映射无效')
})

test('提交后的记录过设置页的供应商表门禁', () => {
  const draft = createAgentProviderModelMetadataDraft(baseModel())
  const result = resolveAgentProviderModelMetadataCommit({ currentModel: baseModel(), draft })
  assert.equal(result.status, 'commit')
  const issues = validateAgentModelProviderTable([
    { id: 'p1', name: '自建供应商', baseUrl: '', apiKey: '', apiFormat: 'anthropic-messages', models: [result.model] },
  ])
  assert.deepEqual(issues, [], '提交出来的模型不该让供应商表变成非法')
})

test('入口：模型行上的按钮，编辑的正是这一条，提交写回同一条列表项', () => {
  assert.match(page, /import ModelMetadataSection from '\.\/agent-settings\/ModelMetadataSection\.vue'/)
  assert.match(pageTemplate, /<ModelMetadataSection[\s\S]*?:model="model"/, '编辑器要挂在列表项本体上')
  assert.match(pageTemplate, /@commit="commitModelMetadata\(model, \$event\)"/)
  assert.match(pageTemplate, /@cancel="editingModel = null"/)
  assert.match(pageScript, /const MODEL_EDIT_LABEL = '编辑模型配置'/, '入口文案取 zh-CN.ts:2553 settings.modelProvider.editModel')
  assert.match(pageScript, /Object\.assign\(model, next\)/, '提交结果要写回同一批响应式对象')
  // 落盘仍是页面既有的那一条：draft.providers → normalizeAgentSettings → persist
  assert.match(pageScript, /normalizeAgentSettings\(JSON\.parse\(JSON\.stringify\(draft\)\)\)/)
})

test('编辑器：八个真实字段都有控件，绑到同一份 draft', () => {
  const bindings = [
    ['idValue', 'draft.idValue'],
    ['contextWindowValue', 'draft.contextWindowValue'],
    ['maxOutputTokensValue', 'draft.maxOutputTokensValue'],
    ['inputFormatValue', 'AGENT_VISIBLE_MODEL_INPUT_MODALITIES'],
    ['inputFormatValue.supportsImage/Video/Pdf', 'toggleInputFormat(modality)'],
    ['inputFormatValue 的选中态', 'inputFormatChecked(modality)'],
    ['supportsJsonSchemaOutput', 'CAPABILITY_OPTIONS'],
    ['reasoningLevelValuesValue', 'levelsText'],
    ['reasoningLevelMapValue', 'draft.reasoningLevelMapValue'],
  ]
  for (const [field, token] of bindings) {
    assert.ok(editorTemplate.includes(token), `${field} 没有控件（缺 ${token}）`)
  }
  // 可见档位 → 字段的映射取模块常量，不在组件里再写一份
  assert.match(editorScript, /AGENT_MODEL_INPUT_MODALITY_FIELDS\[modality\]/)
  assert.match(editorTemplate, /AGENT_MODEL_PROVIDER_MESSAGES\.modelId/)
  assert.match(editorTemplate, /AGENT_MODEL_PROVIDER_MESSAGES\.contextWindow/)
  assert.match(editorTemplate, /AGENT_MODEL_PROVIDER_MESSAGES\.maxOutputTokens/)
  assert.match(editorTemplate, /AGENT_MODEL_PROVIDER_MESSAGES\.inputModalities/)
  assert.match(editorTemplate, /AGENT_MODEL_PROVIDER_MESSAGES\.capabilities/)
  assert.deepEqual([...AGENT_VISIBLE_MODEL_INPUT_MODALITIES], ['text', 'image', 'video', 'pdf'])
})

test('编辑器：上游有而本仓记录没有的字段不画（不放假控件）', () => {
  const absentInLocalRecord = ['requiresMfjsToolSchema', 'supportsToolCall', 'outputFormat', 'supportsAudio', 'followRecommendedConfig', 'resetForm', 'modelDisplayName']
  for (const field of absentInLocalRecord) {
    assert.ok(!editorTemplate.includes(field), `模板里画了本仓没有的字段：${field}`)
  }
  // 正面：真字段之外的档位也不许出现（音频在上游就只在 draft 里保留，不进表单）
  assert.ok(!editorScript.includes("audio: "), '输入类型只出 text/image/video/pdf')
})

test('编辑器：校验与非法文案都调既有纯函数，不另写规则', () => {
  assert.match(editorScript, /createAgentProviderModelMetadataDraft\(\s*props\.model\s*\)/)
  assert.match(editorScript, /resolveAgentProviderModelMetadataCommit\(\s*\{\s*currentModel: props\.model, draft\s*\}\s*\)/)
  assert.match(editorScript, /resolveAgentModelMetadataInvalidMessage\(\s*result\.field\s*\)/)
  assert.ok(!editorScript.includes('AGENT_MODEL_METADATA_INVALID_MESSAGES'), '非法文案表不该被当第二套规则直接用')
  assert.ok(!editorScript.includes("startsWith('{')"), '不许自己复刻映射判据（上游已走 compileModelOptionMap）')
})

test('文案出处：已有字段名常量 + zh-CN.ts 行号', () => {
  const citations = [
    /zh-CN\.ts:3161-3163/, // 模型能力三项：结构化输出 / 原生联网搜索 / 对话中系统消息
    /zh-CN\.ts:3167/, // 推理等级（从低到高）
    /zh-CN\.ts:3169/, // 推理参数映射
    /zh-CN\.ts:3182-3186/, // 输入类型四档 modality.*
    /zh-CN\.ts:3140/, // help.reasoningLevelsOrdered
    /zh-CN\.ts:3142/, // help.reasoningLevelMapping
  ]
  for (const citation of citations) {
    assert.match(editorScript, citation, `本地文案缺出处 ${citation}`)
  }
  assert.match(pageScript, /zh-CN\.ts:2553/, '入口文案缺出处 settings.modelProvider.editModel')
  assert.match(editorScript, /const EDIT_MODEL_LABEL = '编辑模型配置'/, '表单标题缺出处（同名键 zh-CN.ts:2553）')
  assert.match(editorScript, /const REASONING_LEVELS_LABEL = '推理等级（从低到高）'/)
  assert.match(editorScript, /const REASONING_MAP_LABEL = '推理参数映射'/)
  assert.match(editorTemplate, /settings-button settings-button-primary" type="button" @click="commit">保存/)
  assert.match(editorTemplate, /settings-button" type="button" @click="emit\('cancel'\)">取消/)
})

test('源文件卫生：LF、无 NUL、块注释无裸 */、行数不超上限', () => {
  const files = [['AgentSettingsPage.vue', page, 900], ['ModelMetadataSection.vue', editor, 899]]
  for (const [name, source, limit] of files) {
    assert.ok(!source.includes('\r'), `${name}: 不许有 CR（必须 LF）`)
    assert.ok(!source.includes('\0'), `${name}: 不许有 NUL 字节`)
    const lineCount = source.split('\n').length
    assert.ok(lineCount <= limit, `${name}: 行数 ${lineCount} 超上限 ${limit}`)
    for (const block of source.match(/\/\*[\s\S]*?\*\//g) ?? []) {
      assert.ok(!block.slice(2, -2).includes('*/'), `${name}: 块注释正文里有裸 */`)
    }
  }
})
