// 「记忆」节的**设置形状**（ZCode section id `memory`，`settingsPageConfig.ts:76-81`）。
//
// 为什么只有设置、没有管道：ZCode 那一节的正文（工作区记忆清单 / 读正文）走的是主进程的
// `IMemoryService`（`packages/services/src/memory/memory.ts:24-33`）；本仓没有这条通道，
// 所以这里只做「用户选了哪些记忆文件参与注入」这一件事，**不假装**已经接上注入
// （`injectedMemoryFiles` 只交清单，真正的注入在别处；未接的部分在报告里如实登记）。
//
// 与 ZCode 的差异如实登记：
//   · 出厂总开关 `false` —— 逐字照 `validationAppSettings.ts:464` 的
//     `memoryEnabled: z.boolean().default(false)`，以及 `protocol.ts:324-325`「默认关闭」；
//   · **不抄** ZCode 的 5 MiB —— 那是预览上限（`projectMemoryStableRead.ts:8`
//     `PROJECT_MEMORY_PREVIEW_MAX_BYTES = 5 * 1024 * 1024`），与注入无关，所以大小上限出厂是 0（不限）。
import {
  defaultSettingsStorage,
  readSettingsJson,
  writeSettingsJson,
  type SettingsStorage,
} from './agentSettingsStore.ts'

/** 存储键。与 `taocode.agent.settings` 同一族（localStorage）。 */
export const AGENT_MEMORY_FILES_STORAGE_KEY = 'taocode.agent.memoryFiles'

/** 三档作用域（ZCode `MemorySettingsSection.tsx` 的工作区/用户/智能体三档）。 */
export const AGENT_MEMORY_SCOPES = ['workspace', 'user', 'agent'] as const
export type AgentMemoryScope = (typeof AGENT_MEMORY_SCOPES)[number]

const AGENT_MEMORY_SCOPE_LABELS: Record<AgentMemoryScope, string> = {
  workspace: '工作区',
  user: '用户',
  agent: '智能体',
}

export function agentMemoryScopeLabel(scope: AgentMemoryScope): string {
  return AGENT_MEMORY_SCOPE_LABELS[scope]
}

/** 一条记忆文件（设置形状）。 */
export interface AgentMemoryFileEntry {
  scope: AgentMemoryScope
  /** 归一化后的路径：`~` 开头或绝对路径，正斜杠。 */
  path: string
  /** 是否参与注入；缺键按「参与」处理（旧存档没这个键时不该悄悄把它关掉）。 */
  enabled: boolean
  /** 字符上限；`0` = 不限（出厂值，见文件头对 5 MiB 的说明）。 */
  sizeLimitChars: number
}

export interface AgentMemoryFilesSettings {
  /** 总开关。ZCode 出厂 false。 */
  enabled: boolean
  files: AgentMemoryFileEntry[]
}

/**
 * 路径模板表（渲染「新建条目」时的占位，不写死具体智能体名）。
 * `agent` 那档的 `<name>` 是占位符 —— 本机实测的形态是
 * `~/.minimax/agents/<name>/memory/MEMORY.md`。
 */
export const AGENT_MEMORY_PATH_TEMPLATES: ReadonlyArray<{ scope: AgentMemoryScope; template: string }> = [
  { scope: 'workspace', template: 'AGENTS.md' },
  { scope: 'user', template: '~/.minimax/memory/user.md' },
  { scope: 'agent', template: '~/.minimax/agents/<name>/memory/MEMORY.md' },
]

/**
 * 出厂清单只放**本机实测存在**的那一条：`C:\Users\Administrator\.minimax\memory\user.md`
 * （2026-10-07 实测）。工作区级 `AGENTS.md` 在本仓不存在（实测），所以出厂清单里没有它 ——
 * 不预置不存在的路径。
 */
export function defaultAgentMemoryFiles(): AgentMemoryFilesSettings {
  return {
    enabled: false,
    files: [{ scope: 'user', path: '~/.minimax/memory/user.md', enabled: true, sizeLimitChars: 0 }],
  }
}

function isScope(value: unknown): value is AgentMemoryScope {
  return AGENT_MEMORY_SCOPES.includes(value as AgentMemoryScope)
}

/** 路径归一：反斜杠 → `/`、两端去空白（Windows 上两种分隔符等价，存档里要统一）。 */
function normalizeMemoryPath(value: unknown): string {
  return typeof value === 'string' ? value.trim().replace(/\\/g, '/') : ''
}

/** 大小上限：非负整数；负数 / Infinity / 非数字退 0（= 不限），小数向下取整。 */
function normalizeSizeLimit(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return 0
  const floored = Math.floor(value)
  return floored > 0 ? floored : 0
}

/**
 * 任意输入 → 一份合法设置。**永不抛**。
 *
 * 逐字段救、逐条救（本仓铁律：不许按字段数量判损坏）：垃圾条目只丢自己；
 * 同一条路径只留第一条 —— 两条都指向同一个文件时哪条生效说不清，那是坏数据。
 */
export function normalizeAgentMemoryFiles(input: unknown): AgentMemoryFilesSettings {
  const defaults = defaultAgentMemoryFiles()
  if (!input || typeof input !== 'object' || Array.isArray(input)) return defaults
  const raw = input as Record<string, unknown>
  if (!Array.isArray(raw.files)) return defaults
  const files: AgentMemoryFileEntry[] = []
  const seen = new Set<string>()
  for (const item of raw.files) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) continue
    const entry = item as Record<string, unknown>
    const path = normalizeMemoryPath(entry.path)
    if (!path || seen.has(path)) continue
    seen.add(path)
    files.push({
      scope: isScope(entry.scope) ? entry.scope : 'user',
      path,
      enabled: typeof entry.enabled === 'boolean' ? entry.enabled : true,
      sizeLimitChars: normalizeSizeLimit(entry.sizeLimitChars),
    })
  }
  return {
    enabled: typeof raw.enabled === 'boolean' ? raw.enabled : defaults.enabled,
    files,
  }
}

/**
 * 保存前校验：空路径 / 目录尾 / 重复 / 负或非整数上限 / 坏作用域 / `~` 不在开头。
 * 一条最多命中一条路径规则（空路径那条不再叠别的问题）。
 */
export function validateAgentMemoryFiles(settings: AgentMemoryFilesSettings): string[] {
  const problems: string[] = []
  const seen = new Set<string>()
  const files = Array.isArray(settings?.files) ? settings.files : []
  for (const [index, entry] of files.entries()) {
    const label = `第 ${index + 1} 条`
    const path = normalizeMemoryPath(entry?.path)
    if (!path) {
      problems.push(`${label}：路径不能为空。`)
    } else if (path.endsWith('/')) {
      problems.push(`${label}：路径不能以 / 结尾（这里要的是一个文件）。`)
    } else if (path.includes('~') && !path.startsWith('~')) {
      problems.push(`${label}：~ 只能出现在路径开头。`)
    }
    if (path) {
      if (seen.has(path)) problems.push(`${label}：同一个文件只能有一条。`)
      else seen.add(path)
    }
    const limit = entry?.sizeLimitChars
    if (typeof limit !== 'number' || !Number.isFinite(limit) || !Number.isInteger(limit) || limit < 0) {
      problems.push(`${label}：大小上限必须是非负整数（0 = 不限）。`)
    }
    if (!isScope(entry?.scope)) {
      problems.push(`${label}：作用域只能是${AGENT_MEMORY_SCOPES.map(scope => AGENT_MEMORY_SCOPE_LABELS[scope]).join(' / ')}。`)
    }
  }
  return problems
}

/** 参与注入的清单：总开关关 ⇒ 一条都不参与；开 ⇒ 只留启用的。 */
export function injectedMemoryFiles(settings: AgentMemoryFilesSettings): AgentMemoryFileEntry[] {
  if (!settings?.enabled) return []
  return (settings.files ?? []).filter(entry => entry.enabled)
}

/** `~` 展开；不带 `~` 的路径原样返回（绝对路径不许被改写）。 */
export function resolveAgentMemoryFilePath(path: string, home: string): string {
  const value = typeof path === 'string' ? path.trim() : ''
  if (value === '~') return home
  if (value.startsWith('~/')) return `${home.replace(/\/+$/, '')}/${value.slice(2)}`
  return value
}

/**
 * 按上限截断正文并**标注**（截了就说明截了，不让用户以为读全了）。
 * `limit <= 0` = 不限（出厂值），不许悄悄截。
 */
export function clipMemoryText(text: string, limit: number): { text: string; truncated: boolean } {
  const value = typeof text === 'string' ? text : ''
  if (!(limit > 0) || value.length <= limit) return { text: value, truncated: false }
  return { text: `${value.slice(0, limit)}…（已按上限 ${limit} 字符截断）`, truncated: true }
}

/** 从存储读设置（缺省走 `localStorage`；坏存档退回出厂值，永不抛）。 */
export function loadAgentMemoryFiles(storage: SettingsStorage | null = defaultSettingsStorage()): AgentMemoryFilesSettings {
  return readSettingsJson(storage, AGENT_MEMORY_FILES_STORAGE_KEY, normalizeAgentMemoryFiles)
}

/** 写设置。存不下（配额满 / 隐私模式）时静默降级 —— 只丢持久化，不打断本次会话。 */
export function saveAgentMemoryFiles(settings: AgentMemoryFilesSettings, storage: SettingsStorage | null = defaultSettingsStorage()): boolean {
  return writeSettingsJson(storage, AGENT_MEMORY_FILES_STORAGE_KEY, settings)
}
