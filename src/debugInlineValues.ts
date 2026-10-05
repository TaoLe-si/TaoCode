// 编辑器「行内值」的纯规则 —— 上游 `InlineVariablesPanel` / `XDebuggerInlineValuesProvider`
// （`platform/xdebugger-impl/.../inline/`）：在编辑器里直接看到当前执行行上变量的值。
//
// 本仓的渲染落点是 `src/editorDebugLine.ts`（CodeMirror 6 装饰器，挂在 CodeEditor 已有的
// `debugLineExtension` 扩展上，见那个文件）；这里只放**取哪些变量、怎么格式化**，可单测。
//
// 与上游的如实差异（写清楚，不冒充）：
//   ① 上游按「变量出现在哪一行的源码里」过滤（后端给每个 InlineValue 一个行号/区间）；
//      DAP `variables` 没有逐变量的行号，所以本仓把当前帧第一个已加载作用域里的变量
//      全部挂到**当前执行行**行尾 —— 是「当前帧的值提示」，不是「这一行源码里的变量」；
//   ② 上游还有 `InlineWatch`（把监视表达式画进编辑器）。本仓没做：监视值的刷新时机在
//      DebugPanel 的会话状态里，编辑器只收最终文本（见 src/editorDebugLine.ts 的注释）。
import type { DapVariable, DapScope } from './bridge'

export interface InlineValueEntry {
  name: string
  value: string
}

/** 行尾最多画几条（再多会把编辑区挤爆；上游 InlineVariablesPanel 也有可见条数上限）。 */
export const INLINE_VALUE_LIMIT = 8

/** 单条值文本的最长长度，超出截断（行内渲染不做换行）。 */
export const INLINE_VALUE_MAX_LENGTH = 60

/** 值文本为空/纯空白时给一个占位，否则 `x = ` 这样的尾巴没有意义。 */
function trimmedValue(value: string): string {
  const text = value.replace(/\s+/g, ' ').trim()
  if (!text) return '（空）'
  return text.length > INLINE_VALUE_MAX_LENGTH ? `${text.slice(0, INLINE_VALUE_MAX_LENGTH - 1)}…` : text
}

/**
 * 从当前帧的作用域挑行内值的数据源：第一个**已加载**（`values` 里有它）且非 expensive 的
 * 作用域。适配器通常把 Locals 放最前；没有加载中的作用域就返回空（不为此单独发请求 ——
 * 行内值是提示，不能因为它阻塞面板）。
 */
export function inlineSourceScope(scopes: readonly DapScope[], values: Record<number, DapVariable[]>): DapScope | undefined {
  return scopes.find(scope => !scope.expensive && values[scope.reference] !== undefined)
}

/** 作用域孩子 → 行内条目（跳过空名字，截断值文本，上限截断）。 */
export function inlineValueEntries(variables: readonly DapVariable[], limit = INLINE_VALUE_LIMIT): InlineValueEntry[] {
  const entries: InlineValueEntry[] = []
  for (const variable of variables) {
    const name = variable.name.trim()
    if (!name) continue
    entries.push({ name, value: trimmedValue(variable.value) })
    if (entries.length >= limit) break
  }
  return entries
}

/** 渲染成一行文本（widget 只用这一个函数；条目为空返回空串 = 不画）。 */
export function inlineValueText(entries: readonly InlineValueEntry[]): string {
  return entries.map(entry => `${entry.name} = ${entry.value}`).join('   ')
}
