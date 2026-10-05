// 求值表达式的历史（上游 `XDebuggerTreeWithHistory` / `XDebuggerEditor` 的表达式历史：
// IDEA 的 Evaluate Expression 输入框保留刚求值过的表达式，可上下翻回）。
//
// 本仓的求值框是单行 `<input>` + 原生 `<datalist>`（`DebugPanel.vue`），所以历史直接作为
// datalist 候选（与 DAP 补全同一个下拉）。规则做成纯函数：去重、置顶、上限 —— 可单测。
//
// 只存**成功求值过**的表达式（调用方在求值成功后 push）：失败表达式再翻出来重跑没有意义，
// 而且会把输入错误时的垃圾串塞满历史。

/** 历史条数上限（够翻回常用表达式，又不会把下拉变成第二棵树）。 */
export const EVALUATE_HISTORY_LIMIT = 20

/** 置顶 + 去重 + 截断（不改原数组，trim 后为空不记）。 */
export function pushEvaluateHistory(history: readonly string[], text: string, limit = EVALUATE_HISTORY_LIMIT): string[] {
  const trimmed = text.trim()
  if (!trimmed) return [...history]
  return [trimmed, ...history.filter(entry => entry !== trimmed)].slice(0, limit)
}

/** 最近用过的一条（datalist 的默认候选顺序就是「最近在前」）。 */
export function latestEvaluateExpression(history: readonly string[]): string {
  return history[0] ?? ''
}
