// Agent 设置「技能」+「命令」两节的**真控件逻辑**：条目形状、逐字段归一化、校验、
// 增删改、启用停用、作用域、持久化。纯 TS，零 Vue、零 DOM、零网络。
//
// 为什么单独一个文件：`src/agentSkills.ts` 已经带了「技能」节的形状与折述，但它
// 是**只读面**（无增删改、无启用停用、无作用域）；「命令」那一节的形状 / 校验 /
// 作用域仓里一个都没有（`src/agentCommands.ts` 是输入框的斜杠命令表，与
// 「用户自定义命令」是两回事）。两节共用同一套存储机制与同一条作用域语义，所以
// 放一个文件、分两组导出，而不是两个各自抄一遍 scope 的文件。
//
// 存储机制复用 `src/agentSettingsStore.ts`（只放机制、不放内容）；坏档一律救回默认，
// **永不抛**（本仓铁律：不许按字段数量判损坏，真出过把用户锁在项目外的事故）。
//
// —— 每个字段 / 规则的 ZCode 出处（逐条可对账）——
//
// 【技能 SkillSummary】`packages/shared/src/skills-types.ts:10-29`
//   · `id` / `name` / `description` / `body` / `path` / `sourcePath` / `scope` /
//     `enabled` / `pluginName` / `pluginId` / `metadata` 全在该 interface 里。
//   · 列表行只渲染 name（`SkillsSection.tsx:611`）与 description（`:613-618`，
//     空时回落 `settings.skills.noDescription`，zh-CN.ts:3481）。
//   · 详情弹窗渲染 范围 / 状态 / 版本 / Slug / 发布时间 / Owner ID / 文件路径
//     （`SkillsSection.tsx:897-957`）；`publishedAt` 由 `formatSkillPublishedAt`
//     （`:73-82`）从 epoch 毫秒转 ISO，非法时间返回 null。
//   · 开关与删除只对非 plugin 档渲染（`SkillsSection.tsx:621-641` 的三元）。
//   · `setEnabled` 调用面见 `:365-404`；删除见 `:408-454`。
//   · 作用域标签 `settings.skills.scope.*`（zh-CN.ts:3590-3592）。
//
// 【命令 UserCommand / PluginCommand】`packages/shared/src/command-types.ts`
//   · `UserCommand`（:16-24）= `CommandInfo`（:7-14：name / prompt / content /
//     filePath / description? / argumentHint?）+ id / source:"user" / agentSource /
//     location / enabled / scope:"global"|"project" / projectPath?。
//   · `PluginCommand`（:26-35）有 pluginName / pluginMarketplace / pluginEnabled，
//     scope 恒为 "global"。
//   · `CommandConfig`（:47-53）= 表单提交的四个字段。
//   · 表单字段与标签：名称 `settings.commands.form.name.*`（zh-CN.ts:3966-3967）、
//     描述 `...description.*`（:3968-3969）、参数提示 `...argumentHint.*`（:3970-3971）、
//     提示词 `...prompt.*`（:3972-3973）。
//   · 校验规则 `CommandForm.tsx:12-14`（NAME_REGEX / MIN_NAME_LENGTH /
//     MAX_NAME_LENGTH）与 `:82-129`（canSave 与 validate）；文案 zh-CN.ts:3974-3976。
//   · 「可编辑」= `isUserCommand && location.source === "zcode"`（`CommandCard.tsx:10-12`）。
//
// 【作用域】`commandWorkspaceScope.ts` 三个函数逐行照抄语义（见各函数注释）。
//
// 【搜索】`pluginManagedResourceGroups.ts:143-149`（normalizedQueryMatches）与
//   `:151-174`（groupSkillsByPlugin）/ `:176-198`（groupCommandsByPlugin）。

import {
  defaultSettingsStorage,
  readSettingsJson,
  writeSettingsJson,
  type SettingsStorage,
} from './agentSettingsStore.ts'

/** 技能节的存储键。与 `src/agentSkills.ts` 同一族（localStorage）。 */
export const AGENT_SKILL_REGISTRY_STORAGE_KEY = 'taocode.agent.skills'
/** 命令节的存储键。 */
export const AGENT_COMMAND_REGISTRY_STORAGE_KEY = 'taocode.agent.commands'

// ============================================================================
// 技能
// ============================================================================

/** `SkillScope`（`packages/shared/src/skills-types.ts:1`）。 */
export type SkillRegistryScope = 'workspace' | 'user' | 'plugin'

/** `SkillMetadata`（`skills-types.ts:3-8`）。 */
export interface SkillRegistryMetadata {
  slug?: string
  version?: string
  ownerId?: string
  publishedAt?: number
}

/**
 * 一条技能。字段逐一对应 `SkillSummary`（`skills-types.ts:10-29`），**不增不减**。
 *
 * `body` 照抄（ZCode 用它在聊天里注入技能正文，`skills-types.ts:14`）——本仓没有
 * 注入运行时，但字段是载荷的一部分，不能因为「暂时没人读」就丢，丢了下次接上要迁移存档。
 */
export interface SkillRegistryEntry {
  id: string
  name: string
  description: string
  body: string
  path: string
  sourcePath: string
  scope: SkillRegistryScope
  enabled: boolean
  pluginName: string
  pluginId: string
  metadata: SkillRegistryMetadata
}

/** 技能节状态面。 */
export interface SkillRegistrySettings {
  entries: SkillRegistryEntry[]
}

/** 一条技能能不能拨开关 / 能不能删 —— 与 `SkillsSection.tsx:621-641` 的三元同判据。 */
export interface SkillEntryCapabilities {
  /** plugin 档由卸载插件管理，ZCode 不给开关也不给删除入口。 */
  toggleable: boolean
  deletable: boolean
}

// ---- 归一化（救读进来的坏数据，永不抛） ----

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function text(value: unknown, fallback = ''): string {
  return typeof value === 'string' ? value : fallback
}

function isSkillScope(value: unknown): value is SkillRegistryScope {
  return value === 'workspace' || value === 'user' || value === 'plugin'
}

/**
 * 发布时间归一化：接受 epoch 毫秒或可解析的时间串，产出 epoch 毫秒。
 *
 * 照 `formatSkillPublishedAt`（`SkillsSection.tsx:73-82`）的口径 —— 非法时间**丢弃**
 * （ZCode 那里返回 null，本仓用 `undefined` 表示同一个意思）。它不抛，但把一个假时间
 * 显示给用户比不显示更糟。
 */
function normalizePublishedAt(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return Number.isNaN(new Date(value).getTime()) ? undefined : value
  }
  if (typeof value === 'string' && value.trim()) {
    const parsed = new Date(value).getTime()
    return Number.isNaN(parsed) ? undefined : parsed
  }
  return undefined
}

/** 归一化 `SkillMetadata`：四个键都只认自己那个类型，其余丢。 */
function normalizeMetadata(raw: unknown): SkillRegistryMetadata {
  const item = isRecord(raw) ? raw : {}
  const metadata: SkillRegistryMetadata = {}
  const slug = text(item.slug).trim()
  const version = text(item.version).trim()
  const ownerId = text(item.ownerId).trim()
  const publishedAt = normalizePublishedAt(item.publishedAt)
  if (slug) metadata.slug = slug
  if (version) metadata.version = version
  if (ownerId) metadata.ownerId = ownerId
  if (publishedAt !== undefined) metadata.publishedAt = publishedAt
  return metadata
}

/**
 * 归一化单条技能。`index` 只用来补 id —— 缺 id 的坏条目不丢，补一个可预期的生成 id。
 *
 * `sourcePath` 缺省时回落到 `path`（`skills-types.ts:16-21` 明说普通技能两者相同）。
 */
function normalizeSkillEntry(raw: unknown, index: number): SkillRegistryEntry {
  const item = isRecord(raw) ? raw : {}
  const path = text(item.path).trim()
  const name = text(item.name).trim()
  const id = text(item.id).trim() || path || `skill-${index + 1}`
  return {
    id,
    name: name || id,
    // 描述空就是空：ZCode 的回落（`settings.skills.noDescription`）是在**渲染时**做的
    // （`SkillsSection.tsx:613-618`），不写回数据，所以这里不替用户编一句。
    description: text(item.description).trim(),
    body: text(item.body),
    path,
    sourcePath: text(item.sourcePath).trim() || path,
    scope: isSkillScope(item.scope) ? item.scope : 'user',
    // 缺 enabled 视为启用 —— 旧存档没这个键时，默认「显示且开着」比默认关掉更符合用户预期。
    enabled: typeof item.enabled === 'boolean' ? item.enabled : true,
    pluginName: text(item.pluginName).trim(),
    pluginId: text(item.pluginId).trim(),
    metadata: normalizeMetadata(item.metadata),
  }
}

/** 出厂默认：空清单。本仓没有技能扫描通道，所以一条都不假造。 */
export function defaultSkillRegistrySettings(): SkillRegistrySettings {
  return { entries: [] }
}

/**
 * 把任意输入归一成一份合法技能设置。**永不抛、永不返回坏值**。
 *
 * 逐条救：垃圾条目（非对象）只丢自己，其余每条各救各的。`entries` 键缺失或不是数组
 * = 存档坏在这一层，退回空清单；键在、值是数组（哪怕空数组）= 用户自己存的那份，尊重它。
 */
export function normalizeSkillRegistrySettings(input: unknown): SkillRegistrySettings {
  if (!isRecord(input)) return defaultSkillRegistrySettings()
  if (!Array.isArray(input.entries)) return defaultSkillRegistrySettings()
  const entries: SkillRegistryEntry[] = []
  for (const item of input.entries) {
    if (!isRecord(item)) continue
    entries.push(normalizeSkillEntry(item, entries.length))
  }
  return { entries }
}

// ---- 校验 ----

/**
 * 保存前的校验：返回问题清单（空数组 = 可以保存）。
 *
 * 拦三件事，逐条都有 ZCode 依据：
 *   1. 空名 —— ZCode 的 `skill_missing_name` 诊断（zh-CN.ts:3601「frontmatter 缺少 name 字段」）。
 *   2. 重名 —— ZCode 侧同名是已知冲突（`skill_duplicate_name`，zh-CN.ts:3607「同名技能已被忽略」；
 *      导入时以 `import.skipReason.sameNameExists`「同名已存在」跳过，zh-CN.ts:3526）。
 *   3. 路径空 —— 路径是删除 / 打开的实参（`SkillsSection.tsx:425-429`、`:548-556`），
 *      空路径会让这两个动作打空。
 *
 * 刻意**不做**路径越界校验：那是 `src/agentSkills.ts:isSkillPathWithinRoot` 的职责，
 * 那个模块有本仓实测的内置技能根常数；这里不重复实现、也不 import 它（避免两处各判一遍）。
 */
export function validateSkillRegistrySettings(settings: SkillRegistrySettings): string[] {
  const problems: string[] = []
  const seen = new Set<string>()
  const entries = Array.isArray(settings?.entries) ? settings.entries : []
  for (const [index, entry] of entries.entries()) {
    const name = typeof entry?.name === 'string' ? entry.name.trim() : ''
    const label = name || `第 ${index + 1} 条`
    if (!name) {
      problems.push(`${label}：技能名不能为空。`)
    } else if (seen.has(name)) {
      problems.push(`技能名「${name}」重复。`)
    } else {
      seen.add(name)
    }
    const path = typeof entry?.path === 'string' ? entry.path.trim() : ''
    if (!path) problems.push(`技能「${label}」必须填目录路径。`)
  }
  return problems
}

// ---- 增删改 / 启用停用 / 能力判定 ----

/** 造一条空白技能（新建入口用）。`id` 可由调用方给；不给就按当前条数生成。 */
export function createSkillRegistryEntry(seed: Partial<SkillRegistryEntry> = {}): SkillRegistryEntry {
  const base = normalizeSkillEntry({ ...seed, id: seed.id ?? '', path: seed.path ?? '' }, 0)
  return base
}

/**
 * 插入或覆盖一条（按 id 认）。返回新清单，**不改原数组**。
 *
 * ZCode 侧对应的写入是后端 `skillsService`（`SkillsSection.tsx:314-318` 的 `list` 与
 * `:374-381` 的 `setEnabled`）；本仓没有那个服务，所以这里是**本地清单**的增改。
 */
export function upsertSkillRegistryEntry(
  settings: SkillRegistrySettings,
  entry: SkillRegistryEntry,
): SkillRegistrySettings {
  const entries = Array.isArray(settings?.entries) ? settings.entries : []
  const next = entries.filter((item) => item.id !== entry.id)
  next.push(normalizeSkillEntry(entry, next.length))
  return { entries: next }
}

/**
 * 删一条。plugin 档**删不动** —— ZCode 侧 plugin 档的删除由卸载插件管理
 * （`SkillsSection.tsx:410`：`skill.scope === "plugin"` 直接 return）。
 */
export function removeSkillRegistryEntry(
  settings: SkillRegistrySettings,
  skillId: string,
): SkillRegistrySettings {
  const entries = Array.isArray(settings?.entries) ? settings.entries : []
  return {
    entries: entries.filter((item) => !(item.id === skillId && skillEntryCapabilities(item).deletable)),
  }
}

/**
 * 拨启用状态。plugin 档**拨不动**（`SkillsSection.tsx:621-641` 不给它渲染开关）。
 *
 * 未知 id 时返回原清单（不新增、不抛）。
 */
export function setSkillRegistryEnabled(
  settings: SkillRegistrySettings,
  skillId: string,
  enabled: boolean,
): SkillRegistrySettings {
  const entries = Array.isArray(settings?.entries) ? settings.entries : []
  return {
    entries: entries.map((item) =>
      item.id === skillId && skillEntryCapabilities(item).toggleable
        ? { ...item, enabled: Boolean(enabled) }
        : item,
    ),
  }
}

/** 一条技能能不能拨 / 能不能删。判据同 `SkillsSection.tsx:410` 与 `:621-641`。 */
export function skillEntryCapabilities(entry: SkillRegistryEntry): SkillEntryCapabilities {
  const isPlugin = entry?.scope === 'plugin'
  return { toggleable: !isPlugin, deletable: !isPlugin }
}

// ---- 作用域 ----

/**
 * 技能在某一节作用域下算不算「这一节的」。
 *
 * 照 `selectSkillsForScope`（`pluginCapabilityProjection.ts:96-99`）的**非 plugin 分支**：
 * `skill.scope === scope`。plugin 分支依赖插件的启用投影（`:89-105`），本仓没有插件运行时，
 * 所以 plugin 档一律不归入任一节 —— 宁可不显示，也不假装它被某个工作区启用了。
 */
export function skillMatchesScope(
  entry: SkillRegistryEntry,
  scope: 'user' | 'workspace',
): boolean {
  if (!entry) return false
  if (entry.scope === 'plugin') return false
  return entry.scope === scope
}

/** 某一节作用域下可见的技能（顺序不变）。 */
export function selectSkillsForRegistryScope(
  settings: SkillRegistrySettings,
  scope: 'user' | 'workspace',
): SkillRegistryEntry[] {
  const entries = Array.isArray(settings?.entries) ? settings.entries : []
  return entries.filter((entry) => skillMatchesScope(entry, scope))
}

/** 作用域标签。`settings.scope.user` / `settings.scope.workspace`（zh-CN.ts:2530-2531）。 */
export const SKILL_SCOPE_LABELS: Record<SkillRegistryScope, string> = {
  // zh-CN.ts:3590 settings.skills.scope.personal
  user: '个人',
  // zh-CN.ts:3591 settings.skills.scope.plugin
  plugin: '插件',
  // zh-CN.ts:3592 settings.skills.scope.workspaceFallback
  workspace: '项目',
}

/** 详情里的「状态」文案。zh-CN.ts:3588-3589（settings.skills.detail.enabled / disabled）。 */
export function skillEnabledLabel(enabled: boolean): string {
  return enabled ? '已启用' : '已停用'
}

// ---- 搜索 ----

/**
 * 按查询词过滤技能。
 *
 * 照 `groupSkillsByPlugin`（`pluginManagedResourceGroups.ts:151-174`）：trim + 转小写，
 * 空查询返回全部；命中 `name` / `description` / `pluginName` 任一即可（`:164`）。
 * 那一步按 `path` 去重（`:155-163`）是**分组**的职责，这里只做过滤，不去重。
 */
export function filterSkillRegistry(
  entries: readonly SkillRegistryEntry[],
  query: string,
): SkillRegistryEntry[] {
  const list = Array.isArray(entries) ? entries : []
  const keyword = typeof query === 'string' ? query.trim().toLowerCase() : ''
  if (!keyword) return [...list]
  return list.filter((entry) => {
    if (!entry) return false
    return (
      entry.name?.toLowerCase().includes(keyword)
      || entry.description?.toLowerCase().includes(keyword)
      || entry.pluginName?.toLowerCase().includes(keyword)
    )
  })
}

// ---- 持久化 ----

/** 读技能设置（缺省走 `localStorage`；坏档 / 旧形状退回默认，永不抛）。 */
export function loadSkillRegistrySettings(
  storage: SettingsStorage | null = defaultSettingsStorage(),
): SkillRegistrySettings {
  return readSettingsJson(storage, AGENT_SKILL_REGISTRY_STORAGE_KEY, normalizeSkillRegistrySettings)
}

/** 写技能设置。存不下（配额满 / 隐私模式）时静默降级 —— 只丢持久化，不打断本次会话。 */
export function saveSkillRegistrySettings(
  settings: SkillRegistrySettings,
  storage: SettingsStorage | null = defaultSettingsStorage(),
): boolean {
  return writeSettingsJson(storage, AGENT_SKILL_REGISTRY_STORAGE_KEY, settings)
}

// ============================================================================
// 命令（用户自定义命令 —— 与输入框的斜杠命令 `src/agentCommands.ts` 是两回事）
// ============================================================================

/**
 * `CommandAgentSource`（`packages/shared/src/command-types.ts:5`）。
 *
 * ZCode 侧只有一个取值 `zcodeAgent`（`zcode-agent-policy.ts:7`），所以本仓也只留这一个 ——
 * 加别的取值就等于编造一个不存在的来源。
 */
export type CommandAgentSource = 'zcodeAgent'

/** `SettingsDirectorySource`（`packages/shared/src/settings-source.ts:1`）。 */
export type CommandDirectorySource = 'zcode' | 'agents' | 'claude'

/** `SettingsDirectoryScope`（`settings-source.ts:3`）。 */
export type CommandDirectoryScope = 'user' | 'project'

/** `SettingsDirectoryLocation`（`settings-source.ts:5-10`）。 */
export interface CommandDirectoryLocation {
  source: CommandDirectorySource
  scope: CommandDirectoryScope
  directoryPath: string
  projectPath?: string
}

/** `CommandInfo`（`command-types.ts:7-14`）的六个字段。 */
export interface CommandRegistryContent {
  name: string
  prompt: string
  content: string
  description: string
  argumentHint: string
  filePath: string
}

/** `UserCommand`（`command-types.ts:16-24`）。 */
export interface UserCommandEntry extends CommandRegistryContent {
  id: string
  source: 'user'
  agentSource: CommandAgentSource
  location: CommandDirectoryLocation
  enabled: boolean
  scope: 'global' | 'project'
  projectPath?: string
}

/** `PluginCommand`（`command-types.ts:26-35`）。 */
export interface PluginCommandEntry extends CommandRegistryContent {
  id: string
  source: 'plugin'
  enabled: boolean
  pluginName: string
  pluginMarketplace: string
  pluginEnabled: boolean
  scope: 'global'
}

/** `ZCodeCommand`（`command-types.ts:37`）。 */
export type CommandRegistryEntry = UserCommandEntry | PluginCommandEntry

/** `CommandConfig`（`command-types.ts:47-53`）—— 表单提交的四个字段。 */
export interface CommandConfigInput {
  name: string
  prompt: string
  description?: string
  argumentHint?: string
  filePath?: string
}

/** `CommandStorageLevel`（`command-types.ts:55`）。 */
export type CommandStorageLevel = 'user' | 'project'

/** 命令节状态面。 */
export interface CommandRegistrySettings {
  commands: CommandRegistryEntry[]
}

// ---- 校验（逐条照 CommandForm.tsx） ----

/** 名字允许的字符集。`CommandForm.tsx:12`。 */
export const COMMAND_NAME_REGEX = /^[a-zA-Z0-9_-]+$/
/** 名字长度下界。`CommandForm.tsx:13`。 */
export const COMMAND_MIN_NAME_LENGTH = 1
/** 名字长度上界。`CommandForm.tsx:14`。 */
export const COMMAND_MAX_NAME_LENGTH = 50

/** 表单校验结果：`ok` 为真时可提交；两条错误文案与 ZCode 逐字一致。 */
export interface CommandValidationResult {
  ok: boolean
  /** 名称错误。null = 无错。 */
  nameError: string | null
  /** 提示词错误。null = 无错。 */
  promptError: string | null
}

/**
 * 校验一条命令配置。逐条照 `CommandForm.tsx:82-129` 的 `canSave` + `validate`。
 *
 * 三条真实语义，一条都不能省：
 *   1. `initial`（编辑态）**跳过名称校验**（`CommandForm.tsx:95-96`：`if (initial) setNameError(null)`），
 *      因为编辑时名称输入框是 `disabled`（`:168`）—— 名称不可改，再校验它没有意义。
 *   2. 名称长度必须在 [1, 50]（`:97-107`），文案 `settings.commands.form.validation.nameLength`
 *      （zh-CN.ts:3974「长度必须在 {min} 到 {max} 个字符之间」）。
 *   3. 名称只允许字母 / 数字 / 连字符 / 下划线（`:108-114`），文案
 *      `...nameCharacters`（zh-CN.ts:3975「仅允许使用字母、数字、连字符和下划线」）。
 *   4. 提示词 trim 后非空（`:118-124`），文案 `...promptRequired`
 *      （zh-CN.ts:3976「提示词不能为空」）。
 *
 * `editing` 为真即对应 ZCode 的 `initial` 存在。
 */
export function validateCommandConfig(
  config: CommandConfigInput,
  editing = false,
): CommandValidationResult {
  let nameError: string | null = null
  let promptError: string | null = null
  const trimmedName = typeof config?.name === 'string' ? config.name.trim() : ''
  if (editing) {
    nameError = null
  } else if (trimmedName.length < COMMAND_MIN_NAME_LENGTH || trimmedName.length > COMMAND_MAX_NAME_LENGTH) {
    nameError = `长度必须在 ${COMMAND_MIN_NAME_LENGTH} 到 ${COMMAND_MAX_NAME_LENGTH} 个字符之间`
  } else if (!COMMAND_NAME_REGEX.test(trimmedName)) {
    nameError = '仅允许使用字母、数字、连字符和下划线'
  }
  const prompt = typeof config?.prompt === 'string' ? config.prompt.trim() : ''
  if (!prompt) promptError = '提示词不能为空'
  return { ok: nameError === null && promptError === null, nameError, promptError }
}

// ---- 归一化 ----

function isCommandAgentSource(value: unknown): value is CommandAgentSource {
  return value === 'zcodeAgent'
}

function isCommandDirectorySource(value: unknown): value is CommandDirectorySource {
  return value === 'zcode' || value === 'agents' || value === 'claude'
}

function isCommandDirectoryScope(value: unknown): value is CommandDirectoryScope {
  return value === 'user' || value === 'project'
}

/** 归一化 `SettingsDirectoryLocation`。`source` 缺省 `zcode`（本仓只写这一种）。 */
function normalizeCommandLocation(raw: unknown): CommandDirectoryLocation {
  const item = isRecord(raw) ? raw : {}
  const projectPath = text(item.projectPath).trim()
  const location: CommandDirectoryLocation = {
    source: isCommandDirectorySource(item.source) ? item.source : 'zcode',
    scope: isCommandDirectoryScope(item.scope) ? item.scope : 'user',
    directoryPath: text(item.directoryPath).trim(),
  }
  if (projectPath) location.projectPath = projectPath
  return location
}

/** 归一化 `CommandInfo` 六个字段。 */
function normalizeCommandContent(raw: unknown, fallbackName: string): CommandRegistryContent {
  const item = isRecord(raw) ? raw : {}
  const name = text(item.name).trim() || fallbackName
  const prompt = text(item.prompt)
  return {
    name,
    prompt,
    // `content` 是命令文件的全文（`command-types.ts:9`）；缺省时用 prompt 兜底，
    // 因为 ZCode 写盘写的就是 config 里那几个字段（`CommandsSection.tsx:172-186`）。
    content: text(item.content, prompt),
    description: text(item.description).trim(),
    argumentHint: text(item.argumentHint).trim(),
    filePath: text(item.filePath).trim(),
  }
}

/**
 * 归一化一条命令。
 *
 * 判「user / plugin」用的是 `source` 字段（`command-types.ts:39-45` 的 `isUserCommand` /
 * `isPluginCommand` 也是看它）。plugin 档没有 `location`（`PluginCommand` 不含该字段），
 * 所以那里补一份 scope 恒为 `global` 的空 location，让两条分支的公共字段形状一致。
 */
function normalizeCommandEntry(raw: unknown, index: number): CommandRegistryEntry {
  const item = isRecord(raw) ? raw : {}
  const id = text(item.id).trim() || text(item.filePath).trim() || `command-${index + 1}`
  const content = normalizeCommandContent(item, id)
  if (item.source === 'plugin') {
    const entry: PluginCommandEntry = {
      ...content,
      id,
      source: 'plugin',
      enabled: typeof item.enabled === 'boolean' ? item.enabled : true,
      pluginName: text(item.pluginName).trim(),
      pluginMarketplace: text(item.pluginMarketplace).trim(),
      // plugin 命令能不能用取决于来源插件是否启用（`command-types.ts:31`）。
      pluginEnabled: typeof item.pluginEnabled === 'boolean' ? item.pluginEnabled : true,
      scope: 'global',
    }
    return entry
  }
  const scope = item.scope === 'project' ? 'project' : 'global'
  const projectPath = text(item.projectPath).trim()
  const entry: UserCommandEntry = {
    ...content,
    id,
    source: 'user',
    agentSource: isCommandAgentSource(item.agentSource) ? item.agentSource : 'zcodeAgent',
    location: normalizeCommandLocation(item.location),
    enabled: typeof item.enabled === 'boolean' ? item.enabled : true,
    scope,
  }
  if (projectPath) entry.projectPath = projectPath
  return entry
}

/** 出厂默认：空清单。本仓没有命令扫描通道，一条都不假造。 */
export function defaultCommandRegistrySettings(): CommandRegistrySettings {
  return { commands: [] }
}

/** 归一化命令设置。同技能的逐条救法，永不抛。 */
export function normalizeCommandRegistrySettings(input: unknown): CommandRegistrySettings {
  if (!isRecord(input)) return defaultCommandRegistrySettings()
  if (!Array.isArray(input.commands)) return defaultCommandRegistrySettings()
  const commands: CommandRegistryEntry[] = []
  for (const item of input.commands) {
    if (!isRecord(item)) continue
    commands.push(normalizeCommandEntry(item, commands.length))
  }
  return { commands }
}

// ---- 判定 / 增删改 ----

/** `isUserCommand`（`command-types.ts:39-41`）。 */
export function isUserCommandEntry(entry: CommandRegistryEntry): entry is UserCommandEntry {
  return entry?.source === 'user'
}

/** `isPluginCommand`（`command-types.ts:43-45`）。 */
export function isPluginCommandEntry(entry: CommandRegistryEntry): entry is PluginCommandEntry {
  return entry?.source === 'plugin'
}

/**
 * 能不能编辑。照 `CommandCard.tsx:10-12` 的 `isEditableUserCommand`：
 * `isUserCommand && location.source === "zcode"`。
 * 从 Claude / agents 目录导入来的用户命令**只读** —— ZCode 也是这么判的。
 */
export function isEditableUserCommand(entry: CommandRegistryEntry): entry is UserCommandEntry {
  return isUserCommandEntry(entry) && entry.location.source === 'zcode'
}

/** 把表单提交的 `CommandConfig` 折成 `content` 字段（照 `CommandForm.tsx:136-141`）。 */
export function commandConfigToContent(config: CommandConfigInput): CommandRegistryContent {
  const name = typeof config?.name === 'string' ? config.name.trim() : ''
  const prompt = typeof config?.prompt === 'string' ? config.prompt.trim() : ''
  return {
    name,
    prompt,
    content: prompt,
    description: typeof config?.description === 'string' ? config.description.trim() : '',
    argumentHint: typeof config?.argumentHint === 'string' ? config.argumentHint.trim() : '',
    filePath: typeof config?.filePath === 'string' ? config.filePath.trim() : '',
  }
}

/**
 * 新增一条用户命令。
 *
 * `storageLevel` 决定 `scope` 与 `location.scope`：`user` → `global`，`project` → `project`
 * （照 `resolveCommandStorageTarget`，`commandWorkspaceScope.ts:21-35`）。
 * 重名（同名且同 scope）返回 `null` —— ZCode 侧写盘撞名会报 `forms.validation.fileExists`
 * （`CommandsSection.tsx:196-202`，zh-CN.ts:6051「文件 {fileName} 已存在」），这里在
 * 内存层先拦一次，错误码由调用方映射文案。
 */
export function addUserCommandEntry(
  settings: CommandRegistrySettings,
  config: CommandConfigInput,
  storageLevel: CommandStorageLevel,
  projectPath = '',
): { settings: CommandRegistrySettings; entry: UserCommandEntry } | null {
  const commands = Array.isArray(settings?.commands) ? settings.commands : []
  const content = commandConfigToContent(config)
  if (!content.name) return null
  const scope: 'global' | 'project' = storageLevel === 'project' ? 'project' : 'global'
  const duplicate = commands.some(
    (item) =>
      isUserCommandEntry(item)
      && item.name === content.name
      && item.scope === scope
      && (scope === 'global' || (item.projectPath ?? '') === projectPath),
  )
  if (duplicate) return null
  const entry: UserCommandEntry = {
    ...content,
    id: `command-${content.name}`,
    source: 'user',
    agentSource: 'zcodeAgent',
    location: {
      source: 'zcode',
      scope: storageLevel === 'project' ? 'project' : 'user',
      directoryPath: '',
      ...(storageLevel === 'project' && projectPath ? { projectPath } : {}),
    },
    enabled: true,
    scope,
    ...(storageLevel === 'project' && projectPath ? { projectPath } : {}),
  }
  return { settings: { commands: [...commands, entry] }, entry }
}

/**
 * 改一条用户命令。照 `CommandForm.tsx:136-141`：编辑时**名称不变**（名称输入框 disabled，
 * `:168`），所以只覆盖 prompt / description / argumentHint 三项。
 * 非「可编辑用户命令」（plugin 档、外部来源）返回原清单。
 */
export function updateUserCommandEntry(
  settings: CommandRegistrySettings,
  commandId: string,
  config: CommandConfigInput,
): CommandRegistrySettings {
  const commands = Array.isArray(settings?.commands) ? settings.commands : []
  const content = commandConfigToContent(config)
  return {
    commands: commands.map((item) => {
      if (item.id !== commandId || !isEditableUserCommand(item)) return item
      return {
        ...item,
        prompt: content.prompt,
        content: content.prompt,
        description: content.description,
        argumentHint: content.argumentHint,
      }
    }),
  }
}

/** 删一条。照 `CommandsSection.tsx:222-224`：非「可编辑用户命令」删不动。 */
export function removeCommandEntry(
  settings: CommandRegistrySettings,
  commandId: string,
): CommandRegistrySettings {
  const commands = Array.isArray(settings?.commands) ? settings.commands : []
  return { commands: commands.filter((item) => !(item.id === commandId && isEditableUserCommand(item))) }
}

/**
 * 拨启用状态。照 `CommandsSection.tsx:254-256`：只对 `isUserCommand` 生效
 * （plugin 命令的启用状态由插件自身管理，ZCode 不给它开关，`CommandCard.tsx:66`）。
 */
export function setCommandEntryEnabled(
  settings: CommandRegistrySettings,
  commandId: string,
  enabled: boolean,
): CommandRegistrySettings {
  const commands = Array.isArray(settings?.commands) ? settings.commands : []
  return {
    commands: commands.map((item) =>
      item.id === commandId && isUserCommandEntry(item) ? { ...item, enabled: Boolean(enabled) } : item,
    ),
  }
}

// ---- 作用域（逐条照 commandWorkspaceScope.ts） ----

/** 目标工作区页签。只取这三个字段 —— 本模块不 import Vue store。 */
export interface CommandWorkspaceTab {
  workspacePath: string
  workspaceIdentity?: string | null
}

/**
 * 工作区的 scope key。照 `getWorkspaceKey`（`lib/workspaceKey.ts:5-7`）：
 * `workspaceIdentity?.trim() || workspacePath` —— 有 identity 用 identity，否则用路径。
 */
export function commandWorkspaceKey(tab: CommandWorkspaceTab): string {
  return tab?.workspaceIdentity?.trim() || tab?.workspacePath || ''
}

/**
 * 命令编辑器所在作用域失效时怎么办。
 *
 * 逐行照 `resolveCommandScopeRecovery`（`commandWorkspaceScope.ts:7-19`）：
 *   · scopeKey 是 `"user"`，或能在 `workspaceTabs` 里找到同 key 的页签 → `"keep"`；
 *   · 否则：编辑态 → `"close-editor"`（目标工作区关了不能继续往失效路径写）；新建态 → `"fallback-user"`。
 */
export function resolveCommandScopeRecovery(params: {
  editing: boolean
  scopeKey: string
  workspaceTabs: readonly CommandWorkspaceTab[]
}): 'keep' | 'fallback-user' | 'close-editor' {
  const tabs = Array.isArray(params?.workspaceTabs) ? params.workspaceTabs : []
  if (params.scopeKey === 'user' || tabs.some((tab) => commandWorkspaceKey(tab) === params.scopeKey)) {
    return 'keep'
  }
  return params.editing ? 'close-editor' : 'fallback-user'
}

/**
 * 命令写到哪一层。
 *
 * 逐行照 `resolveCommandStorageTarget`（`commandWorkspaceScope.ts:21-35`）：
 * `"user"` → `{ storageLevel: "user", workspace: null }`；
 * 否则 → `{ storageLevel: "project", workspace: <同 key 的页签或 null> }`。
 */
export function resolveCommandStorageTarget(
  scopeKey: string,
  workspaceTabs: readonly CommandWorkspaceTab[],
): { storageLevel: CommandStorageLevel; workspace: CommandWorkspaceTab | null } {
  const tabs = Array.isArray(workspaceTabs) ? workspaceTabs : []
  if (scopeKey === 'user') return { storageLevel: 'user', workspace: null }
  return {
    storageLevel: 'project',
    workspace: tabs.find((tab) => commandWorkspaceKey(tab) === scopeKey) ?? null,
  }
}

/**
 * 保存后要不要刷新当前列表。
 *
 * 逐行照 `shouldRefreshCurrentCommandList`（`commandWorkspaceScope.ts:37-42`）：
 * 存到 user 层，或存到的正是当前工作区 → 刷新。
 */
export function shouldRefreshCurrentCommandList(scopeKey: string, currentWorkspaceKey: string): boolean {
  return scopeKey === 'user' || scopeKey === currentWorkspaceKey
}

/**
 * 命令在某一节作用域下算不算「这一节的」。
 *
 * 照 `selectCommandsForScope`（`pluginCapabilityProjection.ts:121-131`）的**用户命令分支**：
 * `command.location.scope === (scope === "user" ? "user" : "project")`。
 * plugin 分支依赖插件启用投影，本仓无插件运行时，一律不归入。
 */
export function commandMatchesScope(entry: CommandRegistryEntry, scope: 'user' | 'workspace'): boolean {
  if (!isUserCommandEntry(entry)) return false
  return entry.location.scope === (scope === 'user' ? 'user' : 'project')
}

/** 某一节作用域下可见的命令（顺序不变）。 */
export function selectCommandsForRegistryScope(
  settings: CommandRegistrySettings,
  scope: 'user' | 'workspace',
): CommandRegistryEntry[] {
  const commands = Array.isArray(settings?.commands) ? settings.commands : []
  return commands.filter((entry) => commandMatchesScope(entry, scope))
}

// ---- 搜索 ----

/**
 * 按查询词过滤命令。
 *
 * 照 `groupCommandsByPlugin`（`pluginManagedResourceGroups.ts:182-198`）：空查询返回全部；
 * **用户命令**打 `name` / `description` / `prompt` 三个字段（`:186`），插件命令同样三个（`:193-197`）。
 */
export function filterCommandRegistry(
  entries: readonly CommandRegistryEntry[],
  query: string,
): CommandRegistryEntry[] {
  const list = Array.isArray(entries) ? entries : []
  const keyword = typeof query === 'string' ? query.trim().toLowerCase() : ''
  if (!keyword) return [...list]
  return list.filter((entry) => {
    if (!entry) return false
    return (
      entry.name?.toLowerCase().includes(keyword)
      || entry.description?.toLowerCase().includes(keyword)
      || entry.prompt?.toLowerCase().includes(keyword)
    )
  })
}

// ---- 持久化 ----

/** 读命令设置（坏档 / 旧形状退回默认，永不抛）。 */
export function loadCommandRegistrySettings(
  storage: SettingsStorage | null = defaultSettingsStorage(),
): CommandRegistrySettings {
  return readSettingsJson(storage, AGENT_COMMAND_REGISTRY_STORAGE_KEY, normalizeCommandRegistrySettings)
}

/** 写命令设置。存不下时静默降级。 */
export function saveCommandRegistrySettings(
  settings: CommandRegistrySettings,
  storage: SettingsStorage | null = defaultSettingsStorage(),
): boolean {
  return writeSettingsJson(storage, AGENT_COMMAND_REGISTRY_STORAGE_KEY, settings)
}