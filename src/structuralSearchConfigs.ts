// 结构化搜索的**配置与模板管理**。上游 `structuralsearch/plugin/ui`：
//   · `ConfigurationManager` 保存/命名/复用 `Configuration`（含最近使用列表，上限 30，
//     名字取模板前 40 字符 + `…`，`ConfigurationManager.java` 的 addHistoryConfiguration）；
//   · `ExistingTemplatesComponent` 的模板树（Draft / Recent / User templates / Project templates）；
//   · `StructuralSearchTemplatesCompletionContributor` 在模板里补全 `$Var$` 变量名。
//
// 本仓落点：`src/components/SearchPanel.vue` 的 `$` 结构化模式（编译器在 src/structuralSearch.ts），
// 这里补「模板收藏 / 最近使用 / 内置模板 / 变量补全候选」四件纯规则；存储用 localStorage，
// 与本仓其它应用级用户数据同族（作用域/标签页排法/最近搜索都是这个口径）。

/** 一份结构化搜索配置（上游 `SearchConfiguration` 的可映射子集）。 */
export interface StructuralSearchConfig {
  name: string
  query: string
  replacement: string
  structural: boolean
  caseSensitive: boolean
  wholeWord: boolean
  regex: boolean
  scope: string
  /** 创建/最近使用时间（排序用；0 表示未记）。 */
  created: number
}

/** 内置模板（上游 `existingTemplates` 是本仓没有的 PSI 模板；这些是文本子集里能真匹配的单行模板）。 */
export interface StructuralTemplate {
  name: string
  description: string
  query: string
  replacement: string
}

export const BUILTIN_STRUCTURAL_TEMPLATES: StructuralTemplate[] = [
  { name: '空值判断', description: '$x$ == null，替换成 != null 反过来找', query: '$x$ == null', replacement: '$x$ != null' },
  { name: 'equals 调用', description: '$x$.equals($y$) —— 两个变量必须各自匹配同一段文本', query: '$x$.equals($y$)', replacement: '' },
  { name: '捕获子句', description: 'catch ($type$ $e$)', query: 'catch ($type$ $e$)', replacement: '' },
  { name: '无参日志调用', description: '$logger$.$method$()', query: '$logger$.$method$()', replacement: '' },
  { name: 'getter 定义', description: 'get$Name$() 形式的取值方法', query: 'get$Name$()', replacement: '' },
]

const SAVED_KEY = 'taocode.structuralSearch.saved'
const RECENT_KEY = 'taocode.structuralSearch.recent'
export const MAX_RECENT_CONFIGURATIONS = 30
const NAME_LIMIT = 40

function readList(key: string): StructuralSearchConfig[] {
  try {
    const raw = typeof localStorage === 'undefined' ? null : localStorage.getItem(key)
    const parsed = raw ? JSON.parse(raw) : []
    if (!Array.isArray(parsed)) return []
    return parsed.filter((item): item is StructuralSearchConfig =>
      Boolean(item) && typeof item.name === 'string' && typeof item.query === 'string')
  } catch {
    return []
  }
}

function writeList(key: string, items: StructuralSearchConfig[]): void {
  try {
    if (typeof localStorage !== 'undefined') localStorage.setItem(key, JSON.stringify(items))
  } catch {
    // 存储不可用只影响下次会话，不影响本次搜索。
  }
}

/**
 * 配置名：未命名时取模板前 40 字符（上游 `ConfigurationManager.addHistoryConfiguration`
 * 的 `RECENT_CONFIGURATION_NAME_LENGTH = 40`，超出截断加省略号）。
 */
export function configurationName(query: string, limit = NAME_LIMIT): string {
  const text = query.trim().replace(/\s+/g, ' ')
  if (!text) return '未命名模板'
  return text.length <= limit ? text : `${text.slice(0, limit).trim()}…`
}

/** 收藏的模板（按名字唯一）。 */
export function loadSavedConfigurations(): StructuralSearchConfig[] {
  return readList(SAVED_KEY)
}

/** 存一份模板：同名覆盖（上游 `ConfigurationManager.removeConfiguration` + `addConfiguration` 的等价）。 */
export function saveConfiguration(config: StructuralSearchConfig): StructuralSearchConfig[] {
  const name = config.name.trim() || configurationName(config.query)
  const next = [
    { ...config, name, created: config.created || Date.now() },
    ...loadSavedConfigurations().filter(item => item.name !== name),
  ]
  writeList(SAVED_KEY, next)
  return next
}

export function removeConfiguration(name: string): StructuralSearchConfig[] {
  const next = loadSavedConfigurations().filter(item => item.name !== name)
  writeList(SAVED_KEY, next)
  return next
}

/** 最近使用（每次结构化搜索前插，上限 30，同名去重后再前插）。 */
export function loadRecentConfigurations(): StructuralSearchConfig[] {
  return readList(RECENT_KEY).slice(0, MAX_RECENT_CONFIGURATIONS)
}

/** 纯合并（读回存储不可用时也能单测）：同名去重、前插、截断。 */
export function mergeRecentConfigurations(existing: readonly StructuralSearchConfig[], entry: StructuralSearchConfig): StructuralSearchConfig[] {
  return [entry, ...existing.filter(item => item.name !== entry.name)].slice(0, MAX_RECENT_CONFIGURATIONS)
}

export function pushRecentConfiguration(config: StructuralSearchConfig): StructuralSearchConfig[] {
  const name = config.name.trim() || configurationName(config.query)
  const entry: StructuralSearchConfig = { ...config, name, created: config.created || Date.now() }
  const next = mergeRecentConfigurations(loadRecentConfigurations(), entry)
  writeList(RECENT_KEY, next)
  return next
}

/**
 * `$Var$` 变量补全候选（上游 `StructuralSearchTemplatesCompletionContributor`）：
 * 模板里已用过的变量按出现顺序在前，再补几个常用起手名；去掉当前正在输入的那个半截名。
 */
export function variableCompletions(template: string): string[] {
  const names: string[] = []
  const pattern = /\$([A-Za-z_][A-Za-z0-9_]*)\$/g
  let match: RegExpExecArray | null
  while ((match = pattern.exec(template)) !== null) if (!names.includes(match[1]!)) names.push(match[1]!)
  for (const fallback of ['x', 'y', 'args']) if (!names.includes(fallback)) names.push(fallback)
  // 结尾正在输入的 `$ab` 还不成对，不算已用变量。
  const typing = /\$([A-Za-z_][A-Za-z0-9_]*)$/.exec(template)
  return typing ? names.filter(name => name !== typing[1]) : names
}

/** 供 datalist 用的候选串（`$name$` 形态；补全进编辑器时直接可用）。 */
export function variableCompletionValues(template: string): string[] {
  return variableCompletions(template).map(name => `$${name}$`)
}
