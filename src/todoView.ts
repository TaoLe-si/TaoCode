// TODO 工具窗口的**视图规则**：标记匹配、颜色列、按作用域过滤。
//
// 为什么与 `todoTree.ts`（树/分组）分开：树只管"包 → 文件 → 条目"的层次；这一层是
// 「哪些条目可见、每行什么颜色」，两者的输入输出都不一样。
//
// 上游依据：
//   · 标记匹配（2026-10-06 todo2 自己开上游复核并订正）：模式串**原样**就是正则 ——
//     `IndexPattern.compilePattern()`（platform/indexing-api/src/com/intellij/psi/search/
//     IndexPattern.java:80-89）把 `patternString` 直接交给 `Pattern.compile`，只在
//     `caseSensitive == false` 时补 `Pattern.CASE_INSENSITIVE`；命中是 `matcher.find()`
//     的子串语义（platform/editor-ui-ex/src/com/intellij/psi/impl/search/
//     IndexPatternSearcher.java:239,245-247）。上游**没有**隐式 `\b`、**没有** glob 档
//     （对话框那一栏是正则语法高亮的输入框：`PatternDialog.java:64-67` 用 `dummy.regexp`）。
//     本仓此前把模式再包一层 `\b(source)\b`，与上游不符（`TODO:` 这类标记恒为 0 条），
//     也和提交前 TODO 检查那条链（`src/todoScan.ts` 把模式原样交给 `search.run`）两样说法。
//   · 大小写：`caseSensitive` 是**每条模式**的档位，所以扫描的粗筛（一次 `search.run` 只能带
//     一个全局开关）之后必须由 `keepPatternHits` 按各自的模式定夺 —— 与上游"索引粗筛计数
//     （IndexPatternSearcher.java:66-74）+ 每条 Pattern 自己 find() 定夺"的两段式同形。
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
 * 一条模式（正则，**按上游原样使用，不加隐式 `\b`**）是否命中一段文本。
 * 空白模式永不命中（避免空表时把每行都点亮）；正则写坏时退化为字面量包含，
 * 与扫描（search.run）的容错口径一致。大小写由调用方按**该条模式自己的** `caseSensitive` 给。
 */
export function markerMatches(text: string, pattern: string, caseSensitive = false): boolean {
  const source = pattern.trim()
  if (!source) return false
  try { return new RegExp(source, caseSensitive ? '' : 'i').test(text) }
  catch { return caseSensitive ? text.includes(source) : text.toLowerCase().includes(source.toLowerCase()) }
}

/** 一条 TODO 文本命中的模式（表序即优先级，IDEA 的 PatternTable 也是首条命中）。 */
export function matchingTodoPattern<T extends TodoPatternView>(text: string, patterns: readonly T[]): T | undefined {
  return patterns.find(pattern => markerMatches(text, pattern.pattern, pattern.caseSensitive))
}

/**
 * 扫描粗筛之后的**定夺**：只留下命中某条模式（按该条模式自己的 `caseSensitive`）的行，
 * 并把 `kind` 写成那条模式的说明。上游同一形状 —— 索引那一步只是粗筛计数
 * （`IndexPatternSearcher.java:66-74` 的 `getTodoCount(...) != 0` 才进 `executeImpl`），
 * 真正决定"这是不是一条 TODO、属于哪条模式"的是每条 `IndexPattern` 自己的 `Pattern`
 * （`:239-247` 的 `matcher.find()`）。
 *
 * 之所以要有这一步：一趟 `search.run` 只有一个全局 `caseSensitive`，粗筛按不区分大小写取**超集**，
 * 勾选「区分大小写」由这里把反面大小写的命中剔掉 —— 否则那一档就是一列摆设（本仓此前的状态）。
 * 模式表为空时什么都不留：没有定义任何标记就没有任何 TODO（不是"退回找 TODO"）。
 */
export function keepPatternHits<T extends { text: string }>(
  rows: readonly T[], patterns: readonly TodoPatternView[],
): Array<T & { kind: string }> {
  const kept: Array<T & { kind: string }> = []
  for (const row of rows) {
    const hit = matchingTodoPattern(row.text, patterns)
    if (hit) kept.push({ ...row, kind: hit.description })
  }
  return kept
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
