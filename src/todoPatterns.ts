// TODO 模式表的校验（IDEA `TodoConfigurable` 的 PatternTable + 原生 `validate_todo_patterns`）。
//
// 抽成纯函数的原因：设置页（`TodoPatternsPage.vue`）与浏览器预览的 `project.settings.update`、
// 以及原生 `validate_todo_patterns`（native/settings_schema.cpp:320-338）必须是同一套规则 ——
// 三处各写一遍就会漂移。
//
// 规则逐条对照 `TodoPattern`：
//   * 模式：非空、≤200 字节、不含换行（IDEA 的 TableTextEditor 不允许换行）
//   * 说明：非空、≤60 字节
//   * 模式在表内唯一（IDEA 的 validatePatterns 查重）
//   * 条数上限 20（TaoCode 的存储上限，与 templates/fileAssociations 同一策略）
export const MAX_TODO_PATTERNS = 20
export const TODO_PATTERN_MAX = 200
export const TODO_DESCRIPTION_MAX = 60

export interface TodoPatternLike { pattern: string; description: string; caseSensitive?: boolean; color?: string }

/** IDEA 颜色列/色板的存储形状（本仓用 `#RRGGBB`；原生 validate_todo_patterns 同一套）。 */
export function isTodoColor(value: unknown): value is string {
  return typeof value === 'string' && /^#[0-9a-fA-F]{6}$/.test(value)
}

/** 返回第一条不合法项的中文说明；全部合法时返回 null。 */
export function validateTodoPatterns(patterns: readonly TodoPatternLike[]): string | null {
  if (!Array.isArray(patterns)) return 'TODO 模式必须是数组。'
  if (patterns.length > MAX_TODO_PATTERNS) return `TODO 模式最多 ${MAX_TODO_PATTERNS} 条。`
  const seen = new Set<string>()
  for (const entry of patterns) {
    if (!entry || typeof entry !== 'object') return '每条 TODO 模式要写成 {pattern, description}。'
    if (typeof entry.pattern !== 'string' || !entry.pattern.trim()) return 'TODO 模式的标记文字不能为空。'
    if (entry.pattern.length > TODO_PATTERN_MAX) return `标记文字不能超过 ${TODO_PATTERN_MAX} 个字符。`
    if (/[\r\n]/.test(entry.pattern)) return '标记文字不能包含换行。'
    if (typeof entry.description !== 'string' || !entry.description.trim()) return 'TODO 模式的说明不能为空。'
    if (entry.description.length > TODO_DESCRIPTION_MAX) return `说明不能超过 ${TODO_DESCRIPTION_MAX} 个字符。`
    if (entry.caseSensitive !== undefined && typeof entry.caseSensitive !== 'boolean') return 'caseSensitive 必须是布尔值。'
    if (entry.color !== undefined && !isTodoColor(entry.color)) return '颜色要写成 #RRGGBB。'
    if (seen.has(entry.pattern)) return `TODO 标记重复：${entry.pattern}`
    seen.add(entry.pattern)
  }
  return null
}

/** 表内重复的标记（用于页内即时标红）。 */
export function duplicateTodoPatterns(patterns: readonly TodoPatternLike[]): string[] {
  const seen = new Map<string, number>()
  for (const entry of patterns) seen.set(entry.pattern, (seen.get(entry.pattern) ?? 0) + 1)
  return [...seen.entries()].filter(([, count]) => count > 1).map(([pattern]) => pattern)
}
