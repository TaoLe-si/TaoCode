// TODO 工具窗口的**视图规则**：标记匹配、颜色列、按作用域过滤。
//
// 为什么与 `todoTree.ts`（树/分组）分开：树只管"包 → 文件 → 条目"的层次；这一层是
// 「哪些条目可见、每行什么颜色」，两者的输入输出都不一样。
//
// 上游依据：
//   · 标记匹配：`TodoTreeBuilder`（`platform/todo`）用 `TodoPattern` 的正则与
//     `isCaseSensitive()` 决定一个节点属于哪个标记 —— 本仓的扫描是 search.run 括号替代，
//     徽标/过滤必须用同一套语义，否则同一个条目会两处说法不同（见 tests/todo-tree.test.mjs）。
//   · 颜色列：IDEA 的 TODO 颜色来自颜色方案（`TodoAttributes.getColor()` /
//     `TodoPattern.getColor()`），TODO 工具窗口在标记列显示它；本仓没有色板页，
//     等价物是模式自带的 `#RRGGBB`，缺省给一个中性色。
//   · 作用域过滤：`TodoPanel` 的 scope 过滤器（按 `project.scopes` 的命名作用域把
//     扫描结果裁到一个范围内），匹配语义直接复用 `src/scopes.ts`（Find in Files 同一套）。
import { compileScope, scopeLookup, scopeMatches, type ScopeContext, type ScopeSet } from './scopes.ts'

export interface TodoPatternView {
  pattern: string
  description: string
  caseSensitive?: boolean
  color?: string
}

/** 没有自带颜色的模式在工具窗口里用的中性色（不冒充任何方案色）。 */
export const TODO_COLOR_FALLBACK = '#8a8f98'

/**
 * 「当前文件」作用域 —— 上游 `CurrentFileTodosPanel`（独立的 TODO (Current File) 工具窗口）
 * 的等价选择：只在当前编辑器文件里留条目。它不是命名作用域，所以用不会与用户作用域重名的哨兵值。
 */
export const TODO_CURRENT_FILE_SCOPE = '__current_file__'

/**
 * `TodoPattern` 的正则是否命中一段文本。空白正则永不命中（避免 `\b()\b` 匹配一切）；
 * 正则写坏时退化为字面量包含，与扫描（search.run）的容错口径一致。
 */
export function markerMatches(text: string, pattern: string, caseSensitive = false): boolean {
  const source = pattern.trim()
  if (!source) return false
  try { return new RegExp(`\\b(${source})\\b`, caseSensitive ? '' : 'i').test(text) }
  catch { return caseSensitive ? text.includes(source) : text.toLowerCase().includes(source.toLowerCase()) }
}

/** 一条 TODO 文本命中的模式（表序即优先级，IDEA 的 PatternTable 也是首条命中）。 */
export function matchingTodoPattern<T extends TodoPatternView>(text: string, patterns: readonly T[]): T | undefined {
  return patterns.find(pattern => markerMatches(text, pattern.pattern, pattern.caseSensitive))
}

/** 该条目在工具窗口里显示的颜色（模式没配就用中性色）。 */
export function todoItemColor(text: string, patterns: readonly TodoPatternView[]): string {
  const matched = matchingTodoPattern(text, patterns)
  return matched?.color && /^#[0-9a-fA-F]{6}$/.test(matched.color) ? matched.color : TODO_COLOR_FALLBACK
}

/**
 * 「变更列表」作用域 —— 上游 `ChangeListTodosPanel`（`platform/vcs-impl/lang/todo/
 * ChangeListTodosPanel.java:70-81`：面板内容跟着 `ChangeListManager.getDefaultChangeList()`，
 * 标签名就是那个变更列表的名字）的本仓等价选择：只留 Git 变更集里的文件命中条目。
 * 同样是哨兵值，不与用户命名作用域重名。
 */
export const TODO_CHANGE_LIST_SCOPE = '__change_list__'

/** 按路径集合裁剪（变更列表作用域用；集合为空时什么都不留 —— 「没有变更」就该是空视图）。 */
export function filterTodoItemsByPaths<T extends { path: string }>(
  items: readonly T[], paths: readonly string[],
): T[] {
  const allowed = new Set(paths.map(path => path.replace(/\\/g, '/')))
  return items.filter(item => allowed.has(item.path.replace(/\\/g, '/')))
}

/**
 * 按命名作用域过滤。`scopeName` 为空（IDEA 的「<All>」）或找不到同名作用域时不过滤；
 * 作用域表达式非法时一条都不留（`scopeMatches` 对 invalid 恒假，这里保持同样语义）。
 * `scopeName` 为 `TODO_CURRENT_FILE_SCOPE` 时只留 `currentPath` 这一个文件的条目
 * （`CurrentFileTodosPanel` 的等价语义；没有当前文件就什么都不留）。
 * `scopeName` 为 `TODO_CHANGE_LIST_SCOPE` 时只留 `changeListPaths` 里的条目
 * （`ChangeListTodosPanel` 的等价语义；Git 不可用/没有变更时给空集，什么都不留）。
 */
export function filterTodoItemsByScope<T extends { path: string }>(
  items: readonly T[], scopeName: string, scopes: readonly { name: string; pattern: string }[], moduleName = '',
  currentPath = '', changeListPaths: readonly string[] = [],
): T[] {
  if (scopeName === TODO_CURRENT_FILE_SCOPE) return currentPath ? items.filter(item => item.path === currentPath) : []
  if (scopeName === TODO_CHANGE_LIST_SCOPE) return filterTodoItemsByPaths(items, changeListPaths)
  if (!scopeName) return [...items]
  const named = scopes.find(scope => scope.name === scopeName)
  if (!named) return [...items]
  const context: ScopeContext = { moduleName, lookup: scopeLookup(scopes) }
  let set: ScopeSet
  try { set = compileScope(named.pattern) }
  catch { return [] }
  return items.filter(item => scopeMatches(set, item.path, false, context))
}
