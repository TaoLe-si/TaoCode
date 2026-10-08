import { request } from './bridge.ts'
import {
  defaultSettingsStorage,
  readSettingsJson,
  writeSettingsJson,
  type SettingsStorage,
} from './agentSettingsStore.ts'

export type AgentSkillScope = 'workspace' | 'user' | 'plugin'

export interface AgentSkillMetadata {
  slug?: string
  version?: string
  ownerId?: string
  publishedAt?: number
}

export interface AgentSkill {
  id: string
  name: string
  description: string
  body: string
  path: string
  sourcePath: string
  scope: AgentSkillScope
  enabled: boolean
  pluginName?: string
  pluginId?: string
  metadata?: AgentSkillMetadata
}

export interface AgentSkillDiagnostic {
  code: string
  severity: 'error' | 'warning'
  message: string
  path?: string
  skillName?: string
}

export interface AgentSkillsList {
  skills: AgentSkill[]
  capability: { userScopeAvailable: boolean }
  diagnostics: AgentSkillDiagnostic[]
}

export interface AgentSkillPromptContext {
  prompt: string
  activatedSkillNames: string[]
}

export function listAgentSkills(workspacePath: string): Promise<AgentSkillsList> {
  return request<AgentSkillsList>('agent.skills.list', { workspacePath })
}

export function setAgentSkillEnabled(workspacePath: string, skillId: string, enabled: boolean): Promise<AgentSkillsList> {
  return request<AgentSkillsList>('agent.skills.setEnabled', { workspacePath, skillId, enabled })
}

export function deleteAgentSkill(workspacePath: string, skillId: string): Promise<AgentSkillsList> {
  return request<AgentSkillsList>('agent.skills.delete', { workspacePath, skillId })
}

export function revealAgentSkill(workspacePath: string, skillId: string): Promise<{ opened?: boolean }> {
  return request<{ opened?: boolean }>('agent.skills.reveal', { workspacePath, skillId })
}

export function buildAgentSkillPromptContext(workspacePath: string, prompt: string): Promise<AgentSkillPromptContext> {
  return request<AgentSkillPromptContext>('agent.skills.promptContext', { workspacePath, prompt })
}

// ── 「技能」节（设置形状）────────────────────────────────────────────────────────
//
// 上面那一族（`AgentSkill` / `listAgentSkills` …）是**宿主通道**：它列的是宿主真正扫描到的
// 技能文件、并把命中的技能正文拼进 prompt（`agent.skills.promptContext`）。
// 下面这一族是**设置面板自己的那份形状**：ZCode 的「技能」节存的只是「装了哪些、启不启用」，
// 与宿主扫描结果不共享存储（宿主可能扫到、用户也可能在设置里停用）。

/** 「技能」节的存储键。与 `taocode.agent.settings` 同一族（localStorage）。 */
export const AGENT_SKILLS_STORAGE_KEY = 'taocode.agent.skills'

/**
 * 宿主自带技能目录。2026-10-08 实测：`Get-ChildItem C:\Users\Administrator\.minimax\skills`
 * 只有三个目录（ai-coder / ponytail / ui-design-master），每个一条 `SKILL.md`。
 */
export const AGENT_BUILTIN_SKILL_ROOT = 'C:\\Users\\Administrator\\.minimax\\skills'

/**
 * `injected` 的第三档：**未知**。本仓没有技能运行时，装没装与「注没注进 prompt」
 * 是两件事 —— 把未知渲染成「不参与注入」会让用户以为技能坏了。
 */
export const AGENT_SKILL_INJECTION_UNKNOWN = '未接入（本仓无技能运行时）'

/** 空描述的渲染回落（ZCode `zh-CN.ts:3481`）。 */
export const AGENT_SKILL_NO_DESCRIPTION = '暂无描述'

/** 技能来源。`builtin` 是本仓新增的一档（内置目录里的技能），ZCode 没有对应文案。 */
export type AgentSkillSource = 'builtin' | 'user' | 'workspace' | 'plugin'

/** 一条技能（设置面板的形状；元数据字段与 ZCode `SkillSummary` 同名）。 */
export interface AgentSkillEntry {
  id: string
  name: string
  description: string
  source: AgentSkillSource
  enabled: boolean
  /** 技能目录的绝对路径。 */
  path: string
  /** `true` / `false` 是用户拨过的开关；`null` = 未知（本仓没接运行时）。 */
  injected: boolean | null
  version: string
  slug: string
  /** ISO 串；没有 `_meta.json` 或时间非法时是空串（不是 Invalid Date）。 */
  publishedAt: string
  pluginName: string
}

export interface AgentSkillsSettings {
  entries: AgentSkillEntry[]
}

/**
 * 出厂三条：宿主自带目录里**实测到的那三个**（逐字取自 `SKILL.md` frontmatter 与 `_meta.json`）。
 * `D:\TaoCode\.agents` 不存在（实测 `Test-Path` 为 False），所以没有项目级技能。
 */
function builtinSkillEntries(): AgentSkillEntry[] {
  return [
    {
      id: 'ai-coder',
      name: 'ai-coder',
      description: '一站式全栈开发专家（Full-stack development expert）。支持 Vue3/React/Angular/SpringBoot/Node.js/Python 等主流技术栈，覆盖需求分析、架构设计、代码实现、代码审查、UI/UX设计全流程。Trigger keywords: 全栈开发, code review, 代码审查, UI设计, 需求分析, 架构设计, full-stack, frontend, backend, 前端, 后端, 性能优化, 安全审计',
      source: 'builtin',
      enabled: true,
      path: `${AGENT_BUILTIN_SKILL_ROOT}\\ai-coder`,
      injected: null,
      version: '1.0.0',
      slug: '',
      publishedAt: new Date(1773990760768).toISOString(),
      pluginName: '',
    },
    {
      id: 'ponytail',
      name: 'ponytail',
      // frontmatter 的 `description:` 后面没有值 —— 空就是空，不替它编一句。
      description: '',
      source: 'builtin',
      enabled: true,
      path: `${AGENT_BUILTIN_SKILL_ROOT}\\ponytail`,
      injected: null,
      version: '',
      slug: '',
      publishedAt: '',
      pluginName: '',
    },
    {
      // 目录名是 ui-design-master，frontmatter 的 `name` 是带空格的 `UI Design Master`。
      id: 'ui-design-master',
      name: 'UI Design Master',
      description: '专业的UI/UX设计专家技能。提供界面设计、配色方案、设计系统构建、动效设计、响应式布局、仪表盘设计、落地页设计、移动应用设计、图标设计等全方位设计指导与代码实现。触发关键词：UI设计、UX设计、界面设计、配色、设计系统、组件库、落地页、仪表盘、移动应用、图标、动效、响应式、Tailwind CSS',
      source: 'builtin',
      enabled: true,
      path: `${AGENT_BUILTIN_SKILL_ROOT}\\ui-design-master`,
      injected: null,
      version: '1.0.0',
      slug: '',
      publishedAt: new Date(1773994534672).toISOString(),
      pluginName: '',
    },
  ]
}

export function defaultAgentSkillsSettings(): AgentSkillsSettings {
  return { entries: builtinSkillEntries() }
}

const SKILL_SOURCES: readonly AgentSkillSource[] = ['builtin', 'user', 'workspace', 'plugin']

function isSkillSource(value: unknown): value is AgentSkillSource {
  return SKILL_SOURCES.includes(value as AgentSkillSource)
}

/** 发布时间：epoch 毫秒与 ISO 串都收，非法退空串（ZCode `SkillsSection.tsx:73-82` 同口径）。 */
function normalizePublishedAt(value: unknown): string {
  const raw = typeof value === 'number' ? value : typeof value === 'string' && value.trim() ? value : null
  if (raw === null) return ''
  const date = new Date(raw)
  return Number.isNaN(date.getTime()) ? '' : date.toISOString()
}

/** 单条归一。`index` 只用来补 id —— 只有 1 个键的条目不丢（本仓铁律：不许按字段数量判损坏）。 */
function normalizeSkillEntry(raw: unknown, index: number): AgentSkillEntry {
  const item = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw as Record<string, unknown> : {}
  const id = typeof item.id === 'string' && item.id.trim() ? item.id.trim() : `skill-${index + 1}`
  const name = typeof item.name === 'string' ? item.name.trim() : ''
  return {
    id,
    name: name || id,
    description: typeof item.description === 'string' ? item.description : '',
    source: isSkillSource(item.source) ? item.source : 'user',
    // 缺 enabled 视为启用：这是用户存的偏好，旧存档没这个键时「装了就启用」比「默认停用」更符合预期。
    enabled: typeof item.enabled === 'boolean' ? item.enabled : true,
    path: typeof item.path === 'string' ? item.path.trim() : '',
    injected: typeof item.injected === 'boolean' ? item.injected : null,
    version: typeof item.version === 'string' ? item.version : '',
    slug: typeof item.slug === 'string' ? item.slug : '',
    publishedAt: normalizePublishedAt(item.publishedAt),
    pluginName: typeof item.pluginName === 'string' ? item.pluginName : '',
  }
}

/**
 * 任意输入 → 一份合法的技能设置。**永不抛**。
 *
 * 顶层不是对象 / `entries` 不是数组 = 存档坏在这一层，退回出厂三条（连内置技能一起回来）；
 * `entries: []` 是用户自己存的「我不要了」，尊重它，不偷偷塞回内置条目。
 * 逐条救：非对象只丢自己；字段坏的退该字段默认。
 */
export function normalizeAgentSkillsSettings(input: unknown): AgentSkillsSettings {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return defaultAgentSkillsSettings()
  const raw = (input as Record<string, unknown>).entries
  if (!Array.isArray(raw)) return defaultAgentSkillsSettings()
  const entries: AgentSkillEntry[] = []
  for (const item of raw) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) continue
    entries.push(normalizeSkillEntry(item, entries.length))
  }
  return { entries }
}

function forEachSkillPath(path: string): string[] {
  return path.split(/[\\/]+/).filter(Boolean)
}

/**
 * `path` 是否落在 `root` 之内。Windows 口径：大小写不敏感、两种分隔符等价，
 * 且必须按**路径段**比 —— `…\skillsx` 不属于 `…\skills`。
 */
export function isSkillPathWithinRoot(path: string, root: string): boolean {
  const clean = (value: string) => value.replace(/[\\/]+/g, '/').replace(/\/+$/g, '').toLowerCase()
  const target = clean(typeof path === 'string' ? path : '')
  const base = clean(typeof root === 'string' ? root : '')
  if (!target || !base) return false
  return target === base || target.startsWith(`${base}/`)
}

function isAbsoluteSkillPath(path: string): boolean {
  return /^[a-zA-Z]:[\\/]/.test(path) || path.startsWith('/') || path.startsWith('\\\\')
}

/**
 * 保存前的校验：返回问题清单（空数组 = 可以保存）。每条最多命中一条路径问题 ——
 * 空路径 / `..` 段 / 非绝对 / 内置越界是四种不同的修法，混报会让用户不知道先改哪条。
 */
export function validateAgentSkillsSettings(settings: AgentSkillsSettings): string[] {
  const problems: string[] = []
  const seen = new Set<string>()
  const entries = Array.isArray(settings?.entries) ? settings.entries : []
  for (const [index, entry] of entries.entries()) {
    const name = typeof entry?.name === 'string' ? entry.name.trim() : ''
    const label = name || `第 ${index + 1} 条`
    if (!name) {
      problems.push(`${label}：技能名不能为空。`)
    } else if (seen.has(name)) {
      // ZCode 导入时以「同名已存在」跳过（`SkillsSection.tsx`）；本仓直接把重名当错误 ——
      // 两份同名技能说不清哪份生效，那是坏数据。
      problems.push(`技能名「${name}」重复：同一个名字的技能只能有一条。`)
    } else {
      seen.add(name)
    }

    const path = typeof entry?.path === 'string' ? entry.path.trim() : ''
    if (!path) {
      problems.push(`技能「${label}」的目录路径不能为空。`)
    } else if (forEachSkillPath(path).includes('..')) {
      problems.push(`技能「${label}」的目录路径里有 .. 段：技能目录必须是确定的绝对路径。`)
    } else if (!isAbsoluteSkillPath(path)) {
      problems.push(`技能「${label}」的目录路径必须是绝对路径（相对路径会随工作目录漂）。`)
    } else if (entry?.source === 'builtin' && !isSkillPathWithinRoot(path, AGENT_BUILTIN_SKILL_ROOT)) {
      problems.push(`技能「${label}」是内置技能，目录不在内置根 ${AGENT_BUILTIN_SKILL_ROOT} 之内。`)
    }
  }
  return problems
}

/** 展示用折述：渲染层只显示这里的字段，不自己判来源/状态（`SkillsSection.tsx` 的列表行）。 */
export interface AgentSkillDescription {
  id: string
  name: string
  description: string
  sourceLabel: string
  enabledLabel: string
  injected: boolean | null
  injectedLabel: string
  /** `plugin` 档由卸载插件管理，不给开关（`SkillsSection.tsx:621-641` 的三元）。 */
  toggleable: boolean
  path: string
  version: string
  slug: string
  publishedAt: string
  pluginName: string
}

const AGENT_SKILL_SOURCE_LABELS: Record<AgentSkillSource, string> = {
  builtin: '内置',
  user: '个人',
  workspace: '项目',
  plugin: '插件',
}

export function describeSkillEntry(raw: unknown): AgentSkillDescription {
  const entry = normalizeSkillEntry(raw, 0)
  return {
    id: entry.id,
    name: entry.name,
    description: entry.description || AGENT_SKILL_NO_DESCRIPTION,
    sourceLabel: AGENT_SKILL_SOURCE_LABELS[entry.source],
    enabledLabel: entry.enabled ? '已启用' : '已停用',
    injected: entry.injected,
    injectedLabel: entry.injected === null
      ? AGENT_SKILL_INJECTION_UNKNOWN
      : entry.injected ? '参与注入' : '不参与注入',
    toggleable: entry.source !== 'plugin',
    path: entry.path,
    version: entry.version,
    slug: entry.slug,
    publishedAt: entry.publishedAt,
    pluginName: entry.pluginName,
  }
}

/**
 * 搜索过滤（照 ZCode `normalizedQueryMatches` 的空查询分支）：
 * 空 / 纯空白 / 非字符串查询 = 全部；命中 name / description / pluginName 任一，大小写不敏感。
 */
export function filterSkills(entries: unknown, query: unknown): AgentSkillEntry[] {
  const list = Array.isArray(entries) ? entries.filter((item): item is AgentSkillEntry => Boolean(item) && typeof item === 'object') : []
  const needle = typeof query === 'string' ? query.trim().toLowerCase() : ''
  if (!needle) return list
  return list.filter(entry => {
    const haystack = `${entry.name}\n${entry.description}\n${entry.pluginName}`
    return haystack.toLowerCase().includes(needle)
  })
}

/** 从存储读设置（缺省走 `localStorage`；坏存档退回出厂三条，永不抛）。 */
export function loadAgentSkillsSettings(storage: SettingsStorage | null = defaultSettingsStorage()): AgentSkillsSettings {
  return readSettingsJson(storage, AGENT_SKILLS_STORAGE_KEY, normalizeAgentSkillsSettings)
}

/** 写设置。存不下（配额满 / 隐私模式）时静默降级 —— 只丢持久化，不打断本次会话。 */
export function saveAgentSkillsSettings(settings: AgentSkillsSettings, storage: SettingsStorage | null = defaultSettingsStorage()): boolean {
  return writeSettingsJson(storage, AGENT_SKILLS_STORAGE_KEY, settings)
}
