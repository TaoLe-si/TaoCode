<script setup lang="ts">
// 「编辑模型配置」—— 模型列表里某一条展开后的元数据表单（ZCode `ProviderModelMetadataDialog.tsx` 的内联版）。
//
// 出处：.tools/ZCode/packages/ui/src/settings/model-provider-section/ 与 .../i18n/locales/zh-CN.ts
//   · 字段集与初值 = ProviderModelMetadata.ts:13-29 `ProviderModelDraftValues`、:44-81 初值函数
//     （本仓逐项对应 `createAgentProviderModelMetadataDraft`）；
//   · 分组与控件 = ProviderModelMetadataDialog.tsx:175-364（模型 ID 在最上，tokens 两项其次，
//     输入类型 / 模型能力 / 推理三组在上游可折叠的「高级设置」里）；
//   · 输入类型的可见档位 = ProviderModelModalityOptions.tsx:11（text/image/video/pdf；
//     音频与上游一样只在 draft 里保留，不进表单）；
//   · 校验 = ProviderModelMetadata.ts:108-325（本仓 `resolveAgentProviderModelMetadataCommit`）；
//   · 非法字段文案 = ProviderFormControls.tsx:227-233（本仓 `resolveAgentModelMetadataInvalidMessage`）。
//
// 只画本仓 `src/agentModelProviders.ts` 的 `AgentProviderModelConfig` 里真实存在的字段。上游有而本仓
// 记录没有的字段（requiresMfjsToolSchema、supportsToolCall、outputFormat、推理档位 Option Spec JSON）
// **不画**。文案一律取本仓已有的字段名常量（`AGENT_MODEL_PROVIDER_MESSAGES`）或 zh-CN.ts 原文，
// 每个常量后面是它的行号。
//
// 与上游的差异（如实记录，不补假交互）：
//   · 上游是弹窗 + 智能配置 / 个人覆盖双轨（useRecommendedConfigValue、personalConfig、inheritedConfig）；
//     本仓记录是扁平单份、没有继承基线 —— 因此没有智能配置开关，也没有「恢复」「重置表单」按钮；
//   · 上游把后三组收在可折叠的「高级设置」里（ModelEditorAdvanced.tsx），本仓是打开即平铺的一份表单
//     —— 字段相同，折叠交互不复刻（这一节本身就是点开才出现的）；
//   · 上游推理档位是可拖拽芯片（ProviderModelReasoningLevelEditor.tsx:85-190），本仓用行序表达
//     「从低到高」（一行一档），档位值与顺序语义相同；
//   · 上游 draft 有 capability 三个值槽（supports*Value，ProviderModelMetadata.ts:24-26），本仓
//     `AgentProviderModelMetadataDraft` 没有：提交时按上游口径把本节勾选的三项接到结果上
//     （`?? false`，ProviderModelMetadata.ts:182-193），不为它们另立规则。
import { reactive, ref, useId } from 'vue'
import AgentSettingsSectionShell from './AgentSettingsSectionShell.vue'
import {
  AGENT_MODEL_INPUT_MODALITY_FIELDS,
  AGENT_MODEL_PROVIDER_MESSAGES,
  AGENT_VISIBLE_MODEL_INPUT_MODALITIES,
  createAgentProviderModelMetadataDraft,
  resolveAgentModelMetadataInvalidMessage,
  resolveAgentProviderModelMetadataCommit,
  type AgentModelInputFormat,
  type AgentProviderModelConfig,
  type AgentProviderModelMetadataDraft,
} from '../../agentModelProviders'

const props = defineProps<{
  /** 正在编辑的模型记录（列表项本体；元数据缺项由 draft 的保守初值兜底）。 */
  model: AgentProviderModelConfig
}>()
const emit = defineEmits<{
  /** 校验通过的完整记录 —— 调用方写回 `draft.providers` 的对应列表项，随本页「保存」一起持久化。 */
  commit: [model: AgentProviderModelConfig]
  cancel: []
}>()

type Modality = (typeof AGENT_VISIBLE_MODEL_INPUT_MODALITIES)[number]
type CapabilityField = 'supportsJsonSchemaOutput' | 'supportsNativeWebSearch' | 'supportsMidConversationSystem'

const ids = {
  id: useId(), contextWindow: useId(), maxOutputTokens: useId(), levels: useId(), map: useId(),
}

const draft = reactive<AgentProviderModelMetadataDraft>(createAgentProviderModelMetadataDraft(props.model))
const problem = ref('')

/** 模型能力三项 —— 键照 ProviderModelMetadataDialog.tsx:333-339，文案照 zh-CN.ts:3161-3163。 */
const CAPABILITY_OPTIONS: ReadonlyArray<{ field: CapabilityField; label: string }> = [
  { field: 'supportsJsonSchemaOutput', label: '结构化输出' },
  { field: 'supportsNativeWebSearch', label: '原生联网搜索' },
  { field: 'supportsMidConversationSystem', label: '对话中系统消息' },
]
const capabilities = reactive<Record<CapabilityField, boolean>>({
  supportsJsonSchemaOutput: props.model.supportsJsonSchemaOutput ?? false,
  supportsNativeWebSearch: props.model.supportsNativeWebSearch ?? false,
  supportsMidConversationSystem: props.model.supportsMidConversationSystem ?? false,
})

/** 输入类型四档的中文文案 —— zh-CN.ts:3182-3186 `settings.modelProvider.modality.*`。 */
const MODALITY_LABELS: Record<Modality, string> = {
  text: '文本', image: '图片', video: '视频', pdf: 'PDF',
}

/** 可见档位 → draft.inputFormatValue 的字段（text 恒选中且禁用，ProviderModelModalityOptions.tsx:87-104）。 */
function inputFormatField(modality: Modality): keyof AgentModelInputFormat {
  return modality === 'text' ? 'supportsText' : AGENT_MODEL_INPUT_MODALITY_FIELDS[modality]
}
function inputFormatChecked(modality: Modality): boolean {
  return draft.inputFormatValue[inputFormatField(modality)]
}
function toggleInputFormat(modality: Modality) {
  const field = inputFormatField(modality)
  draft.inputFormatValue[field] = !draft.inputFormatValue[field]
}

/** 表单标题 —— zh-CN.ts:2553 `settings.modelProvider.editModel`（上游弹窗的标题，与本页入口按钮同名）。 */
const EDIT_MODEL_LABEL = '编辑模型配置'

/** 推理等级一行一档：行序即「从低到高」，空行在提交时丢弃。 */
const levelsText = ref([...draft.reasoningLevelValuesValue].join('\n'))

/** 推理两块的行内标签 —— zh-CN.ts:3167、zh-CN.ts:3169（本仓 `AGENT_MODEL_PROVIDER_MESSAGES` 未收这两条键）。 */
const REASONING_LEVELS_LABEL = '推理等级（从低到高）'
const REASONING_MAP_LABEL = '推理参数映射'
/** 推理等级说明 —— zh-CN.ts:3140 `help.reasoningLevelsOrdered` 原文（去掉 Markdown 强调符）。 */
const REASONING_LEVELS_HELP = '设置聊天时可选择的推理等级，必须按推理强度从低到高排列。请勿配置模型不支持的推理等级。'
/** 推理参数映射说明 —— zh-CN.ts:3142 `help.reasoningLevelMapping` 原文（去掉行内代码反引号）。 */
const REASONING_MAP_HELP = '使用 CEL 表达式，将当前推理等级 reasoningLevel 映射为模型接口的请求字段。表达式返回的 JSON 对象会合并到实际发送的请求体中。'

function commit() {
  draft.reasoningLevelValuesValue = levelsText.value.split('\n').map(line => line.trim()).filter(Boolean)
  const result = resolveAgentProviderModelMetadataCommit({ currentModel: props.model, draft })
  if (result.status === 'invalid') {
    problem.value = resolveAgentModelMetadataInvalidMessage(result.field)
    return
  }
  problem.value = ''
  emit('commit', { ...result.model, ...capabilities })
}
</script>

<template>
  <div class="model-metadata">
    <AgentSettingsSectionShell>
      <div class="settings-fields">
        <h4 class="model-metadata-title">{{ EDIT_MODEL_LABEL }}</h4>
        <div class="input-row">
          <label :for="ids.id">{{ AGENT_MODEL_PROVIDER_MESSAGES.modelId }}</label>
          <input :id="ids.id" v-model="draft.idValue" type="text" spellcheck="false" />
        </div>
        <div class="input-row">
          <label :for="ids.contextWindow">{{ AGENT_MODEL_PROVIDER_MESSAGES.contextWindow }}</label>
          <input :id="ids.contextWindow" v-model="draft.contextWindowValue" type="text" inputmode="numeric" spellcheck="false" />
        </div>
        <div class="input-row">
          <label :for="ids.maxOutputTokens">{{ AGENT_MODEL_PROVIDER_MESSAGES.maxOutputTokens }}</label>
          <input :id="ids.maxOutputTokens" v-model="draft.maxOutputTokensValue" type="text" inputmode="numeric" spellcheck="false" />
        </div>
        <div class="model-metadata-group">
          <span class="model-metadata-label">{{ AGENT_MODEL_PROVIDER_MESSAGES.inputModalities }}</span>
          <div class="model-metadata-options">
            <label
              v-for="modality in AGENT_VISIBLE_MODEL_INPUT_MODALITIES" :key="modality"
              class="checkbox-row" :class="{ 'model-metadata-static': modality === 'text' }"
            >
              <input
                type="checkbox" :checked="inputFormatChecked(modality)" :disabled="modality === 'text'"
                @change="toggleInputFormat(modality)"
              />
              <span>{{ MODALITY_LABELS[modality] }}</span>
            </label>
          </div>
        </div>
        <div class="model-metadata-group">
          <span class="model-metadata-label">{{ AGENT_MODEL_PROVIDER_MESSAGES.capabilities }}</span>
          <div class="model-metadata-options">
            <label v-for="option in CAPABILITY_OPTIONS" :key="option.field" class="checkbox-row">
              <input v-model="capabilities[option.field]" type="checkbox" />
              <span>{{ option.label }}</span>
            </label>
          </div>
        </div>
        <div class="input-row model-metadata-block">
          <label :for="ids.levels">{{ REASONING_LEVELS_LABEL }}</label>
          <textarea :id="ids.levels" v-model="levelsText" rows="3" spellcheck="false" :title="REASONING_LEVELS_HELP" />
        </div>
        <div class="input-row model-metadata-block">
          <label :for="ids.map">{{ REASONING_MAP_LABEL }}</label>
          <textarea
            :id="ids.map" v-model="draft.reasoningLevelMapValue" class="model-metadata-code"
            rows="3" spellcheck="false" :title="REASONING_MAP_HELP"
          />
        </div>
      </div>
      <p v-if="problem" class="settings-problems" role="alert">{{ problem }}</p>
      <div class="settings-actions">
        <button class="settings-button" type="button" @click="emit('cancel')">取消</button>
        <button class="settings-button settings-button-primary" type="button" @click="commit">保存</button>
      </div>
    </AgentSettingsSectionShell>
  </div>
</template>

<style scoped>
.model-metadata { margin-top: var(--space-2); }
.model-metadata-title { margin: 0; padding-bottom: var(--space-1); border-bottom: 1px solid var(--line); color: var(--bright); font-size: 12px; font-weight: 600; }
.model-metadata-label { display: block; margin-bottom: var(--space-1); color: var(--text); font-size: 12px; font-weight: 500; }
.model-metadata-options { display: flex; flex-wrap: wrap; gap: var(--space-1) var(--space-4); min-width: 0; }
.model-metadata-group { min-width: 0; }
.model-metadata .settings-fields .model-metadata-block { grid-template-columns: minmax(0, 1fr); gap: var(--space-1); }
.model-metadata .settings-fields textarea { resize: vertical; }
.model-metadata .settings-fields .model-metadata-code { font-family: var(--font-mono); font-size: 11px; }
.model-metadata .settings-fields .checkbox-row.model-metadata-static { cursor: default; }
@media (max-width: 560px) {
  .model-metadata-options { gap: var(--space-1) var(--space-3); }
}
</style>
