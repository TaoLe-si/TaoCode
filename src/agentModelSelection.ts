// Agent 聊天窗口的**模型选择模型**：纯逻辑（零 Vue / 零 DOM），逐条复刻 ZCode。
//
// 为什么单独一个模块：ZCode 把「当前模型值怎么显示」「下拉里哪些项可选 / 被锁」「管理模型入口
// 何时出现」这三件事分散在 `ModelConfigSelect.tsx`、`chat-input-toolbar/modelSelection.ts`、
// `lib/zcodeCustomModelValue.ts` 与 `lib/workspaceBusyTaskLock.ts`。本仓 `AgentPanel.vue` 只负责
// 接线，判据（tests/agent-model-selection.test.mjs）盯这里 —— 每一条都能指回下面的出处。
//
// 出处根：D:\TaoCode\.tools\ZCode\packages（下文相对该根的路径）。

// —— 自定义模型值的编解码 ——
// ZCode 真源：shared/src/custom-model-value.ts（前缀 `custom:`；`encodeURIComponent` 编码；
// 解码兼容 `builtin:` 两段 legacy 形态与「无 modelName」形态）。
import type { AgentModelProvider } from './agentSettings.ts'

export const CUSTOM_MODEL_VALUE_PREFIX = 'custom:'

// 「不可用」占位档开关 —— 由调用方（composer）按场景传入，这里只做规则本身。
// 触发点：v4/composer/V4ComposerToolbar.tsx:785-794 调 resolveModelSelectTriggerDisplay 时
// 只传前三参，两档占位默认关闭；置位场景见 chat-input-toolbar/modelSelection.ts:41,44。
export interface ModelSelectTriggerDisplayOptions {
  allowUnavailableCustomModelPlaceholder?: boolean
  allowUnavailableModelPlaceholder?: boolean
}

export interface DecodedCustomModelValue {
  providerId: string
  modelName?: string
}

/** ZCode `ModelSelectGroupItem` —— ModelConfigSelect.tsx:50-56 */
export interface ModelSelectGroupItem {
  key: string
  value: string
  name: string
  badgeLabel?: string
  supportsVisionInput?: boolean
}

/** ZCode `ModelSelectConnectionOption`（provider family 的连接方式：oauth / apiKey） —— ModelConfigSelect.tsx:58-67 */
export interface ModelSelectConnectionOption {
  key: string
  label: string
  badgeLabel?: string
  value: string
  providerId: string
  familyId: string
  mode: 'oauth' | 'apiKey'
  disabled?: boolean
}

/** ZCode `ModelSelectGroup` —— ModelConfigSelect.tsx:69-77 */
export interface ModelSelectGroup {
  key: string
  label: string
  labelBadge?: string
  directItems?: boolean
  selectedOptionKey?: string
  connectionOptions?: ModelSelectConnectionOption[]
  items: ModelSelectGroupItem[]
}

/** 本仓 Agent 设置页中已启用的供应商模型目录，值形状照 ZCode custom model value。 */
export function buildAgentModelSelectGroups(providers: readonly AgentModelProvider[]): ModelSelectGroup[] {
  const groups: ModelSelectGroup[] = []
  for (const provider of providers) {
    const items = provider.models.filter(model => model.enabled).map(model => ({
      key: `${provider.id}:${model.id}`, value: encodeCustomModelValue(provider.id, model.id), name: model.name,
    }))
    if (items.length) groups.push({ key: `provider:${provider.id}`, label: provider.name, items })
  }
  return groups
}

/** ZCode `ModelSelectFooterAction` —— ModelConfigSelect.tsx:79-84 */
export interface ModelSelectFooterAction {
  key: string
  label: string
  selected?: boolean
  onSelect?: () => void
}

// —— 文案常量：逐字取自 ZCode zh-CN.ts，注释标明键 ——
// i18n/locales/zh-CN.ts:4514 `chat.toolbar.modelSwitch.lockedByRunningTask`
export const MODEL_SWITCH_LOCKED_MESSAGE = '当前有任务运行中，完成后可切换模型供应商。'
// i18n/locales/zh-CN.ts:4515 `chat.toolbar.modelSwitch.lockedByRunningTask.short`
export const MODEL_SWITCH_LOCKED_SHORT_LABEL = '任务运行中'
// i18n/locales/zh-CN.ts:4505 `chat.toolbar.model.manageModels`
export const MANAGE_MODELS_LABEL = '管理模型'
// i18n/locales/zh-CN.ts:4502 `chat.toolbar.model.label`（触发器无值时的默认文案，V4ComposerToolbar.tsx:800）
export const MODEL_TRIGGER_FALLBACK_LABEL = '选择模型'
// i18n/locales/zh-CN.ts:4504 `chat.toolbar.model.description`
export const MODEL_TRIGGER_TOOLTIP = '选择当前任务使用的模型。快捷键只打开模型菜单。'

// —— `<synthetic>`：Claude SDK 恢复出的合成模型占位值 ——
// 真源：chat-input-toolbar/modelSelection.ts:33（`trim().toLocaleLowerCase() === "<synthetic>"`）。
const SYNTHETIC_MODEL_VALUE = '<synthetic>'

// 解码失败（`decodeURIComponent` 抛错）时回落原串 —— shared/src/custom-model-value.ts:8-14 safeDecodeUriComponent。
function safeDecodeUriComponent(value: string): string {
  try {
    return decodeURIComponent(value)
  } catch {
    return value
  }
}

/** ZCode `encodeCustomModelValue` —— shared/src/custom-model-value.ts:16-23 */
export function encodeCustomModelValue(providerId: string, modelName?: string): string {
  const encodedProviderId = encodeURIComponent(providerId)
  if (!modelName) {
    return `${CUSTOM_MODEL_VALUE_PREFIX}${encodedProviderId}`
  }
  return `${CUSTOM_MODEL_VALUE_PREFIX}${encodedProviderId}:${encodeURIComponent(modelName)}`
}

/** ZCode `decodeCustomModelValue` —— shared/src/custom-model-value.ts:25-54 */
export function decodeCustomModelValue(value: string): DecodedCustomModelValue | null {
  if (!value.startsWith(CUSTOM_MODEL_VALUE_PREFIX)) {
    return null
  }

  const body = value.slice(CUSTOM_MODEL_VALUE_PREFIX.length)
  const separatorIndex = body.indexOf(':')

  if (separatorIndex < 0) {
    return { providerId: safeDecodeUriComponent(body) }
  }

  const legacyParts = body.split(':')
  if (legacyParts.length >= 3 && legacyParts[0] === 'builtin') {
    return {
      providerId: `${legacyParts[0]}:${legacyParts[1]}`,
      modelName: safeDecodeUriComponent(legacyParts.slice(2).join(':')),
    }
  }

  const encodedProviderId = body.slice(0, separatorIndex)
  const encodedModelName = body.slice(separatorIndex + 1)
  return {
    providerId: safeDecodeUriComponent(encodedProviderId),
    modelName: safeDecodeUriComponent(encodedModelName),
  }
}

/**
 * ZCode `resolveModelValueDisplayLabel`（modelSelection.ts:8-21，模块内私有）。
 * 顺序：先 decodeCustomModelValue 取 modelName；否则按第一个 `/` 切、取后半段；都不行回原串。
 */
export function resolveModelValueDisplayLabel(value: string): string {
  const customSelection = decodeCustomModelValue(value)
  if (customSelection?.modelName?.trim()) {
    return customSelection.modelName.trim()
  }

  const normalizedValue = value.trim()
  const separatorIndex = normalizedValue.indexOf('/')
  if (separatorIndex > 0 && separatorIndex < normalizedValue.length - 1) {
    const modelName = normalizedValue.slice(separatorIndex + 1).trim()
    if (modelName) return modelName
  }
  return normalizedValue
}

/** ZCode `shouldShowManageModelsAction` —— modelSelection.ts:4-6 */
export function shouldShowManageModelsAction(onManageModels?: () => void): boolean {
  return typeof onManageModels === 'function'
}

/**
 * ZCode `resolveModelSelectTriggerDisplay` —— modelSelection.ts:23-54。
 * 逐条分支：`<synthetic>` → 全 undefined；命中组内 item → value=原值；两档占位；
 * modelGroups 空 + showManageModelsAction → placeholder=manageModelsLabel；否则全 undefined。
 */
export function resolveModelSelectTriggerDisplay(
  normalizedValue: string,
  modelGroups: readonly ModelSelectGroup[],
  showManageModelsAction: boolean,
  manageModelsLabel?: string,
  options?: ModelSelectTriggerDisplayOptions,
): { value: string | undefined; placeholder: string | undefined } {
  if (normalizedValue.trim().toLocaleLowerCase() === SYNTHETIC_MODEL_VALUE) {
    return { value: undefined, placeholder: undefined }
  }
  if (modelGroups.some((group) => group.items.some((item) => item.value === normalizedValue))) {
    return { value: normalizedValue, placeholder: undefined }
  }

  const customSelection = decodeCustomModelValue(normalizedValue)
  if (options?.allowUnavailableCustomModelPlaceholder && customSelection?.modelName?.trim()) {
    return { value: undefined, placeholder: customSelection.modelName.trim() }
  }
  if (options?.allowUnavailableModelPlaceholder && normalizedValue.trim()) {
    return {
      value: undefined,
      placeholder: resolveModelValueDisplayLabel(normalizedValue),
    }
  }
  if (modelGroups.length === 0 && showManageModelsAction) {
    return { value: undefined, placeholder: manageModelsLabel }
  }
  return { value: undefined, placeholder: undefined }
}

/** 摊平后的一行（含所属分组），给下拉列表消费。 */
export interface FlatModelSelectOption extends ModelSelectGroupItem {
  groupKey: string
  groupLabel: string
}

/**
 * 本仓派生（ZCode 没有同名函数）：把分组的 items 摊平成下拉列表。
 * 摊平形状取自 ZCode 渲染端的数据访问（ModelConfigSelect.tsx:598-599、630 都是遍历
 * `group.items`，trigger 只读 `item.value` / `item.name`），这里额外带上分组键与分组标签。
 * 排序保持「分组顺序 → 组内 items 顺序」，与渲染顺序一致。
 */
export function flattenModelSelectOptions(
  modelGroups: readonly ModelSelectGroup[],
): FlatModelSelectOption[] {
  const out: FlatModelSelectOption[] = []
  for (const group of modelGroups) {
    for (const item of group.items) {
      out.push({ ...item, groupKey: group.key, groupLabel: group.label })
    }
  }
  return out
}

/** 运行中任务锁的输入 —— 本仓用 `src/agentSession.ts` 的会话态喂它（见接线签名）。 */
export interface AgentModelLockInput {
  /** 当前正在跑的任务（ZCode `workspaceState.activeTaskId`，useWorkspaceShellZCodeState.ts:57）。 */
  activeTaskId?: string | null
  /** taskId → 运行态；`status` 取值同 ZCode `ZCodeTaskRuntimeStatus`。 */
  taskRuntimeByTaskId?: Record<string, { status: string; provider?: string }>
  /** taskId → 乐观任务元（ZCode `optimisticTaskListByTaskId`，workspaceBusyTaskLock.ts:20-25）。 */
  optimisticTaskMetaByTaskId?: Record<string, { provider?: string }>
  /** taskId → 任务列表缓存（workspaceBusyTaskLock.ts:13-18）。 */
  taskListCache?: Array<{ taskId: string; provider?: string }> | null
  /** 触发模型菜单的目标供应商（ZCode `resolveWorkspaceModelConfigSyncScope(workspaceState).provider`）。 */
  selectedProvider?: string | null
}

// ZCode `isBusyTaskRuntimeStatus` —— workspaceBusyTaskLock.ts:3-5：仅这三个状态算忙。
const BUSY_TASK_RUNTIME_STATUSES = new Set(['creating', 'restoring', 'streaming'])

/** ZCode `buildTaskProviderByTaskId` —— workspaceBusyTaskLock.ts:7-28（optimistic 覆盖 cache）。 */
function buildTaskProviderByTaskId(
  optimisticTaskMetaByTaskId: Record<string, { provider?: string }>,
  taskListCache?: Array<{ taskId: string; provider?: string }> | null,
): Record<string, string | undefined> {
  const providerByTaskId: Record<string, string | undefined> = {}

  for (const task of taskListCache ?? []) {
    if (!task.provider) {
      continue
    }
    providerByTaskId[task.taskId] = task.provider
  }

  for (const [taskId, meta] of Object.entries(optimisticTaskMetaByTaskId)) {
    if (!meta.provider) {
      continue
    }
    providerByTaskId[taskId] = meta.provider
  }

  return providerByTaskId
}

/**
 * ZCode `hasBusyTaskInWorkspaceProvider` —— workspaceBusyTaskLock.ts:30-66。
 * 确切规则（从源码读到）：遍历 taskRuntimeByTaskId，跳过 status 不在
 * {creating, restoring, streaming} 的任务；taskProvider = runtimeState.provider ?? providerByTaskId[taskId]
 * （runtime 优先，回退 taskList/cache，见 :49）；若 taskProvider 缺失，仅当 taskId === 规范化后的
 * activeTaskId 时兜底锁定（:50-58）；taskProvider === selectedProvider 即返回 true（:60-62）；
 * 全部走完返回 false。上游用于禁用 reload/sync（useWorkspaceShellZCodeState.ts:52-59）。
 *
 * 本仓差异（为什么不能照抄）：ZCode 的 `isModelOptionLocked` 在 V4ComposerToolbar.tsx:965 是
 * `useCallback(() => false, [])` —— composer 当前不锁任何模型项，因此这里**不复制该恒假回调**，
 * 而是把上游真正在用的 hasBusyTaskInWorkspaceProvider 提成 `isModelOptionLocked`，
 * 供本仓运行中的 Agent 任务锁模型切换（锁文案 = MODEL_SWITCH_LOCKED_MESSAGE）。
 */
export function isModelOptionLocked(
  selectedProvider: string | null | undefined,
  input?: AgentModelLockInput,
): boolean {
  if (!selectedProvider) {
    return false
  }
  if (!input) {
    return false
  }

  const providerByTaskId = buildTaskProviderByTaskId(
    input.optimisticTaskMetaByTaskId ?? {},
    input.taskListCache,
  )
  const normalizedActiveTaskId = input.activeTaskId?.trim() ?? ''

  for (const [taskId, runtimeState] of Object.entries(input.taskRuntimeByTaskId ?? {})) {
    if (!BUSY_TASK_RUNTIME_STATUSES.has(runtimeState.status)) {
      continue
    }

    const taskProvider = runtimeState.provider ?? providerByTaskId[taskId]
    if (!taskProvider) {
      if (normalizedActiveTaskId.length > 0 && normalizedActiveTaskId === taskId) {
        return true
      }
      continue
    }

    if (taskProvider === selectedProvider) {
      return true
    }
  }

  return false
}

/**
 * 本仓派生：锁定时给每个模型项判定是否锁住 —— 语义照 ZCode 的 `isItemLocked` prop
 * （ModelConfigSelect.tsx:144 `(candidateValue: string) => boolean`，被 :288 逐项调用；
 * `MODEL_ITEM_NEVER_LOCKED = () => false` 见 WorkflowRunSettingsFields.tsx:27）。
 * 本仓把「锁」判据提成 isModelOptionLocked，对任意候选值结果一致。
 */
export function isModelItemLocked(
  candidateValue: string,
  selectedProvider: string | null | undefined,
  input?: AgentModelLockInput,
): boolean {
  void candidateValue
  return isModelOptionLocked(selectedProvider, input)
}
