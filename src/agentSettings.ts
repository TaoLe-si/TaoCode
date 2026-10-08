// Agent 设置：模型档、权限四档、上下文预算、差异接受策略 + 持久化。
//
// 为什么单独一个模块：设置页要能在保存前校验（非法值不许落到存储里），保存后所有消费方
// （`src/agentSession.ts` 的权限门、`src/agentEdits.ts` 的写盘、面板的差异显示）
// 读的是同一份形状。设置散在组件里就会各存一份、互相打架。
//
// 键与 ROADMAP 的对应（不是自己编的档位）：
//   · `permissions` ← AG-04「读/写/执行权限分离；命令、路径、目录、网络与副作用在执行前预览」；
//   · `model`/`providers` ← AG-01「模型/供应商适配」；
//   · `contextBudgetChars` ← AG-03「token 占用、截断与压缩摘要可见」；
//   · `autoOpenDiff`/`requireApprovalForWrites` ← AG-05「修改前后差异、逐文件接受或拒绝、回滚」。
//
import { defaultAgentPermissions, type AgentPermissionSettings } from './agent.ts'
import type { AgentModelInputFormat, AgentProviderModelConfig } from './agentModelProviders.ts'

/** 存储键。与 `src/codeStyleSettings.ts` / `src/colorSchemeStore.ts` 同一族（localStorage）。 */
export const AGENT_SETTINGS_STORAGE_KEY = 'taocode.agent.settings'

/** 上下文预算的允许区间（字符）。上限存在的意义是挡住"把整个仓库塞进去"这种写法。 */
export const AGENT_CONTEXT_MIN_CHARS = 2_000
export const AGENT_CONTEXT_MAX_CHARS = 2_000_000
export const AGENT_CONTEXT_DEFAULT_CHARS = 60_000

export type AgentProviderApiFormat = 'anthropic-messages' | 'openai-chat-completions' | 'openai-responses'
export const AGENT_DEFAULT_PROVIDER_API_FORMAT: AgentProviderApiFormat = 'anthropic-messages'

/**
 * Agent 设置的状态面。
 *
 * `requireApprovalForWrites` 与 `permissions.write` 是**两件事**，别合并：
 *   · `permissions.write` = 工具调用要不要过审批门（`decidePermission`）；
 *   · `requireApprovalForWrites` = 过了门之后，写盘前是不是还要用户按一次 Do。
 * 前者是"能不能提这个要求"，后者是"提了之后改完等不等你看"。ZCode 的两个栏目也是分开的。
 */
export interface AgentSettingsState {
  /** 当前模型值（ZCode `custom:` provider/model 编码）。 */
  model: string
  /** 兼容旧设置的端点字段。 */
  endpoint: string
  /** 权限四档（AG-04）。默认取 `src/agent.ts` 的 `defaultAgentPermissions`，不另立一套。 */
  permissions: AgentPermissionSettings
  /** 上下文预算（字符，AG-03）。 */
  contextBudgetChars: number
  /** 写盘前是否等用户按 Do（AG-05）。关掉 = 改动直接落盘，仍可在台账里看到。 */
  requireApprovalForWrites: boolean
  /** 点对话里的一条改动时，是否自动在编辑器里打开它的红绿差异（AG-05）。 */
  autoOpenDiff: boolean
  /** 差异查看器默认显示的上下文行数。 */
  diffContextLines: number
  /** 常规节（ZCode `general` 的键名逐字照抄，只收本仓有真实路径的那批）。 */
  general: AgentGeneralSettings
  /** 模型设置节的自定义供应商表（ZCode `modelProvider` 的 personal providers 那一支）。 */
  providers: AgentModelProvider[]
}

/**
 * ZCode 常规节（`settingsPageHelpers.tsx` 的 `GeneralSectionContent`）里那些
 * **在本仓有真实消费路径**的键。键名与默认值逐字照 ZCode，便于逐条对账：
 *   · `messageStreamShowReasoning` / `messageStreamShowTodos` —— AgentPanel 渲染开关；
 *   · `zcodeInteractionBehavior`（queue/guide，ZCode `ZCODE_INTERACTION_BEHAVIOR_OPTIONS`）；
 *   · `askUserQuestionAutoResolution` / `modelIoFullRetentionEnabled`（转录全量导出的开关）；
 *   · `taskAutoArchive*` —— 旧存储兼容字段；本仓会话只有删除 API，不能用它冒充归档；
 *   · `httpProxy*` 三条 —— 存储面（本仓的网络出口在宿主 `http.get`，代理注入未接，如实标注）。
 * ZCode 还有托盘/硬件加速/预览更新/数据存储路径等桌面壳开关，本仓宿主没有对应系统，
 * **不渲染**（不放假控件），缺口登记在页面空态里。
 */
export interface AgentGeneralSettings {
  messageStreamShowReasoning: boolean
  messageStreamShowTodos: boolean
  zcodeInteractionBehavior: 'queue' | 'guide'
  askUserQuestionAutoResolution: boolean
  modelIoFullRetentionEnabled: boolean
  taskAutoArchiveEnabled: boolean
  taskAutoArchiveOlderThanDays: number
  httpProxy: string
  httpProxyNoProxy: string
  httpProxyCaCertPath: string
}

/** ZCode `TASK_AUTO_ARCHIVE_DAY_OPTIONS`（settingsPageHelpers.tsx）逐字照抄。 */
export const TASK_AUTO_ARCHIVE_DAY_OPTIONS = [3, 7, 14, 30] as const

/**
 * 一条自定义模型供应商（ZCode `modelProvider` 节 personal providers 的形状）。
 * 预设供应商（ZAI/BigModel 的 Coding Plan 那一族）要走 OAuth，本仓未接 ——
 * 页面里如实登记，不预置假条目。
 */
export interface AgentModelProvider {
  id: string
  name: string
  baseUrl: string
  apiFormat?: AgentProviderApiFormat
  /** API key 只存本仓 localStorage（ZCode 走系统 keychain，差异如实登记）。 */
  apiKey: string
  /**
   * 模型条目：完整形状（id/name/enabled + contextWindow / maxOutputTokens + map / inputFormat /
   * 能力开关 / reasoningLevels / reasoningLevelMap）见 `src/agentModelProviders.ts` 的
   * `AgentProviderModelConfig` —— 元数据必须跟设置一起落盘，剥掉就没法复原。
   */
  models: AgentProviderModelConfig[]
}

/** 允许的上下文行数档（与差异视图既有的档位一致，不另造一套）。 */
export const AGENT_DIFF_CONTEXT_CHOICES = [1, 3, 5, 10] as const

/** 出厂默认。**权限四档直接取 `src/agent.ts` 的 `defaultAgentPermissions`**（单一真源）。 */
export function defaultAgentSettings(): AgentSettingsState {
  return {
    model: '',
    endpoint: '',
    permissions: { ...defaultAgentPermissions },
    contextBudgetChars: AGENT_CONTEXT_DEFAULT_CHARS,
    requireApprovalForWrites: true,
    autoOpenDiff: true,
    diffContextLines: 3,
    // ZCode general 节的出厂默认（GeneralSectionContent 的解构默认值）。
    general: {
      messageStreamShowReasoning: true,
      messageStreamShowTodos: false,
      zcodeInteractionBehavior: 'queue',
      askUserQuestionAutoResolution: true,
      modelIoFullRetentionEnabled: false,
      taskAutoArchiveEnabled: false,
      taskAutoArchiveOlderThanDays: 7,
      httpProxy: '',
      httpProxyNoProxy: '',
      httpProxyCaCertPath: '',
    },
    providers: [],
  }
}

/** 一个值是不是合法的权限档。 */
export function isPermissionTier(value: unknown): value is AgentPermissionSettings['read'] {
  return value === 'allow' || value === 'ask' || value === 'never'
}

// ── 模型条目归一化（形状真源：`src/agentModelProviders.ts` 的 `AgentProviderModelConfig`）──────────
//
// 为什么住在这里而不是 modelProviders 那边：模型元数据与设置是**同一份持久化形状**，
// 而 `src/agentModelProviders.ts` 已 import 本模块（反向运行期依赖会成环），
// 所以「任意输入 → 合法模型」与设置归一化放一起，模型设置节复用同一份实现。

/** 输入模态：缺项按保守初值（文本可用、其余不可用）—— 与 `AGENT_DEFAULT_MODEL_INPUT_FORMAT` 同口径。 */
function normalizeAgentModelInputFormat(value: unknown): AgentModelInputFormat {
  const raw = value && typeof value === 'object' ? (value as Record<string, unknown>) : {}
  return {
    supportsText: raw.supportsText !== false,
    supportsImage: raw.supportsImage === true,
    supportsVideo: raw.supportsVideo === true,
    supportsAudio: raw.supportsAudio === true,
    supportsPdf: raw.supportsPdf === true,
  }
}

/** 推理档位：只留非空字符串，去空白去重；没有来源就 undefined —— **不造默认档位**。 */
function normalizeAgentModelReasoningLevels(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined
  const levels = value
    .filter((item): item is string => typeof item === 'string' && item.trim() !== '')
    .map((item) => item.trim())
  return levels.length > 0 ? [...new Set(levels)] : undefined
}

/** 正整数元数据（contextWindow / maxOutputTokens）：按 ZCode schema 拒绝小数、非有限和非正值，不做四舍五入。 */
function normalizeAgentModelPositiveInteger(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isInteger(value) && value > 0 ? value : undefined
}

/**
 * 任意输入 → 一条合法模型（唯一硬门槛是有非空 id，救不了的单条丢弃）。**永不抛**。
 *
 * 元数据能救的救、救不了的字段丢，缺的**一律不补** —— 不造 maxOutputTokens 上限、
 * 不造推理档位与映射、不造 provider 能力（没有可追溯来源的东西不许凭空出现）。
 */
export function normalizeAgentProviderModelConfig(value: unknown): AgentProviderModelConfig | null {
  if (!value || typeof value !== 'object') return null
  const raw = value as Record<string, unknown>
  if (typeof raw.id !== 'string' || !raw.id.trim()) return null
  const id = raw.id.trim()
  const model: AgentProviderModelConfig = {
    id,
    name: typeof raw.name === 'string' && raw.name.trim() ? raw.name : id,
    enabled: raw.enabled !== false,
    inputFormat: normalizeAgentModelInputFormat(raw.inputFormat),
  }
  const contextWindow = normalizeAgentModelPositiveInteger(raw.contextWindow)
  if (contextWindow !== undefined) model.contextWindow = contextWindow
  const maxOutputTokens = normalizeAgentModelPositiveInteger(raw.maxOutputTokens)
  if (maxOutputTokens !== undefined) model.maxOutputTokens = maxOutputTokens
  if (raw.outputFormat === null) {
    model.outputFormat = null
  } else if (
    raw.outputFormat &&
    typeof raw.outputFormat === 'object' &&
    typeof (raw.outputFormat as Record<string, unknown>).supportsText === 'boolean'
  ) {
    model.outputFormat = { supportsText: (raw.outputFormat as { supportsText: boolean }).supportsText }
  }
  if (typeof raw.maxOutputTokensMap === 'string' && raw.maxOutputTokensMap.trim()) {
    model.maxOutputTokensMap = raw.maxOutputTokensMap.trim()
  }
  if (typeof raw.supportsJsonSchemaOutput === 'boolean') model.supportsJsonSchemaOutput = raw.supportsJsonSchemaOutput
  if (typeof raw.supportsToolCall === 'boolean') model.supportsToolCall = raw.supportsToolCall
  if (typeof raw.requiresMfjsToolSchema === 'boolean') model.requiresMfjsToolSchema = raw.requiresMfjsToolSchema
  if (typeof raw.supportsNativeWebSearch === 'boolean') model.supportsNativeWebSearch = raw.supportsNativeWebSearch
  if (typeof raw.supportsMidConversationSystem === 'boolean') model.supportsMidConversationSystem = raw.supportsMidConversationSystem
  const reasoningLevels = normalizeAgentModelReasoningLevels(raw.reasoningLevels)
  if (reasoningLevels) model.reasoningLevels = reasoningLevels
  if (typeof raw.reasoningLevelMap === 'string' && raw.reasoningLevelMap.trim()) model.reasoningLevelMap = raw.reasoningLevelMap.trim()
  return model
}

/**
 * 把任意输入归一成一份合法设置。**永不抛、永不返回坏值** —— 旧存档缺键补默认
 * （本仓铁律：不许按字段数量判损坏，真出过把用户锁在项目外的事故）。
 *
 * 逐字段处理：能救的救（数字夹到区间内），救不了的退回该字段的默认值。
 */
export function normalizeAgentSettings(input: unknown): AgentSettingsState {
  const defaults = defaultAgentSettings()
  if (!input || typeof input !== 'object') return defaults
  const raw = input as Record<string, unknown>
  const permissionsRaw = (raw.permissions && typeof raw.permissions === 'object')
    ? raw.permissions as Record<string, unknown>
    : {}
  const tier = (value: unknown, fallback: AgentPermissionSettings['read']) =>
    isPermissionTier(value) ? value : fallback
  const number = (value: unknown, fallback: number, min: number, max: number) => {
    if (typeof value !== 'number' || !Number.isFinite(value)) return fallback
    return Math.min(max, Math.max(min, Math.round(value)))
  }
  const text = (value: unknown, fallback: string) => typeof value === 'string' ? value : fallback
  const flag = (value: unknown, fallback: boolean) => typeof value === 'boolean' ? value : fallback
  const contextLines = AGENT_DIFF_CONTEXT_CHOICES.includes(raw.diffContextLines as never)
    ? raw.diffContextLines as number
    : defaults.diffContextLines
  // 常规节（ZCode general 键名）：逐字段救，救不了的退默认（不许按字段数量判损坏）。
  const generalRaw = (raw.general && typeof raw.general === 'object') ? raw.general as Record<string, unknown> : {}
  const behavior = generalRaw.zcodeInteractionBehavior === 'guide' ? 'guide' : generalRaw.zcodeInteractionBehavior === 'queue' ? 'queue' : defaults.general.zcodeInteractionBehavior
  const general: AgentGeneralSettings = {
    messageStreamShowReasoning: flag(generalRaw.messageStreamShowReasoning, defaults.general.messageStreamShowReasoning),
    messageStreamShowTodos: flag(generalRaw.messageStreamShowTodos, defaults.general.messageStreamShowTodos),
    zcodeInteractionBehavior: behavior,
    askUserQuestionAutoResolution: flag(generalRaw.askUserQuestionAutoResolution, defaults.general.askUserQuestionAutoResolution),
    modelIoFullRetentionEnabled: flag(generalRaw.modelIoFullRetentionEnabled, defaults.general.modelIoFullRetentionEnabled),
    taskAutoArchiveEnabled: flag(generalRaw.taskAutoArchiveEnabled, defaults.general.taskAutoArchiveEnabled),
    taskAutoArchiveOlderThanDays: (TASK_AUTO_ARCHIVE_DAY_OPTIONS as readonly number[]).includes(generalRaw.taskAutoArchiveOlderThanDays as never)
      ? generalRaw.taskAutoArchiveOlderThanDays as number
      : defaults.general.taskAutoArchiveOlderThanDays,
    httpProxy: text(generalRaw.httpProxy, defaults.general.httpProxy),
    httpProxyNoProxy: text(generalRaw.httpProxyNoProxy, defaults.general.httpProxyNoProxy),
    httpProxyCaCertPath: text(generalRaw.httpProxyCaCertPath, defaults.general.httpProxyCaCertPath),
  }
  // 供应商表：逐条救（id/name/baseUrl/apiKey 是字符串、models 是数组），救不了的丢单条不丢整表。
  // 模型条目原样保留 contextWindow / maxOutputTokens / inputFormat / 能力 / 推理档位与映射
  // （见 normalizeAgentProviderModelConfig），旧存档只填三字段照读、新字段一律不凭空补。
  const providersRaw = Array.isArray(raw.providers) ? raw.providers : []
  const providers: AgentModelProvider[] = []
  for (const item of providersRaw) {
    if (!item || typeof item !== 'object') continue
    const provider = item as Record<string, unknown>
    const id = typeof provider.id === 'string' && provider.id.trim() ? provider.id : `provider-${providers.length + 1}`
    const name = typeof provider.name === 'string' && provider.name.trim() ? provider.name : id
    const modelsRaw: unknown[] = Array.isArray(provider.models) ? provider.models : []
    const models: AgentProviderModelConfig[] = []
    for (const entry of modelsRaw) {
      const model = normalizeAgentProviderModelConfig(entry)
      if (model) models.push(model)
    }
    providers.push({
      id,
      name,
      baseUrl: typeof provider.baseUrl === 'string' ? provider.baseUrl : '',
      apiKey: typeof provider.apiKey === 'string' ? provider.apiKey : '',
      apiFormat: provider.apiFormat === 'openai-chat-completions' || provider.apiFormat === 'openai-responses' || provider.apiFormat === 'anthropic-messages'
        ? provider.apiFormat
        : AGENT_DEFAULT_PROVIDER_API_FORMAT,
      models,
    })
  }
  const model = text(raw.model, defaults.model)
  return {
    model: model === '本地假模型' ? defaults.model : model,
    endpoint: text(raw.endpoint, defaults.endpoint),
    permissions: {
      read: tier(permissionsRaw.read, defaults.permissions.read),
      write: tier(permissionsRaw.write, defaults.permissions.write),
      run: tier(permissionsRaw.run, defaults.permissions.run),
      network: tier(permissionsRaw.network, defaults.permissions.network),
    },
    contextBudgetChars: number(raw.contextBudgetChars, defaults.contextBudgetChars, AGENT_CONTEXT_MIN_CHARS, AGENT_CONTEXT_MAX_CHARS),
    requireApprovalForWrites: flag(raw.requireApprovalForWrites, defaults.requireApprovalForWrites),
    autoOpenDiff: flag(raw.autoOpenDiff, defaults.autoOpenDiff),
    diffContextLines: contextLines,
    general,
    providers,
  }
}

/**
 * 保存前的校验：返回问题清单（空数组 = 可以保存）。
 *
 * 与 `normalizeAgentSettings` 的分工：那边是"读进来的坏数据要能救回来"，
 * 这边是"用户敲进去的坏数据要当场拦下并说清楚"。两个都要有 ——
 * 只归一化会让用户以为填的 300 万预算生效了（其实被夹到 200 万）。
 */
export function validateAgentSettings(settings: AgentSettingsState): string[] {
  const problems: string[] = []
  // 先判整数再判区间：`1000.5` 两个都不满足，但用户更需要知道"这不是整数"——
  // 否则他会去调大小，而问题在精度上。
  if (!Number.isInteger(settings.contextBudgetChars)) problems.push('上下文预算必须是整数。')
  else if (settings.contextBudgetChars < AGENT_CONTEXT_MIN_CHARS || settings.contextBudgetChars > AGENT_CONTEXT_MAX_CHARS) {
    problems.push(`上下文预算必须在 ${AGENT_CONTEXT_MIN_CHARS} 到 ${AGENT_CONTEXT_MAX_CHARS} 个字符之间。`)
  }
  if (!(AGENT_DIFF_CONTEXT_CHOICES as readonly number[]).includes(settings.diffContextLines)) {
    problems.push(`差异上下文行数只能是 ${AGENT_DIFF_CONTEXT_CHOICES.join(' / ')} 之一。`)
  }
  // 端点只在使用真模型时才有意义；填了就必须是个像样的 URL，否则保存后连不上会显得像本仓坏了。
  const endpoint = settings.endpoint.trim()
  if (endpoint && !/^https?:\/\/[^\s]+$/.test(endpoint)) {
    problems.push('模型端点要么留空，要么是 http(s):// 开头的完整地址。')
  }
  // 模型名留空 = 用本地假模型（合法）；只填空白 = 用户以为自己填了名字，其实没有。
  if (settings.model !== '' && settings.model.trim() === '') {
    problems.push('模型名不能是空白：要么留空用本地假模型，要么填一个真名字。')
  }
  return problems
}

/** 存储的窄接口（测试传内存实现，与 `src/analysisScope.ts` / `src/commitOptions.ts` 同口径）。 */
export interface AgentSettingsStorage {
  getItem(key: string): string | null
  setItem(key: string, value: string): void
}

function defaultStorage(): AgentSettingsStorage | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage
  } catch {
    return null
  }
}

/** 从存储读设置（缺省走 `localStorage`；坏存档/旧形状退回默认，永不抛）。 */
export function loadAgentSettings(storage: AgentSettingsStorage | null = defaultStorage()): AgentSettingsState {
  if (!storage) return defaultAgentSettings()
  let raw: string | null = null
  try {
    raw = storage.getItem(AGENT_SETTINGS_STORAGE_KEY)
  } catch {
    return defaultAgentSettings()
  }
  if (!raw) return defaultAgentSettings()
  try {
    return normalizeAgentSettings(JSON.parse(raw))
  } catch {
    return defaultAgentSettings()
  }
}

/** 写设置。存不下（配额满/隐私模式）时静默降级 —— 只丢持久化，不打断本次会话。 */
export function saveAgentSettings(settings: AgentSettingsState, storage: AgentSettingsStorage | null = defaultStorage()): boolean {
  if (!storage) return false
  try {
    storage.setItem(AGENT_SETTINGS_STORAGE_KEY, JSON.stringify(settings))
    return true
  } catch {
    return false
  }
}

/**
 * 设置里跟"写盘/差异"有关的那几位打包给台账用。
 *
 * 台账（`src/agentEdits.ts`）不读整份设置 —— 它只关心"写盘前要不要等人按 Do"，
 * 拿一个窄结构比让它认识整个设置形状更好换。
 */
export function editPolicyOf(settings: AgentSettingsState): { requireApprovalForWrites: boolean; autoOpenDiff: boolean; diffContextLines: number } {
  return {
    requireApprovalForWrites: settings.requireApprovalForWrites,
    autoOpenDiff: settings.autoOpenDiff,
    diffContextLines: settings.diffContextLines,
  }
}
