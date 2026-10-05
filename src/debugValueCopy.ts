// 变量/监视树行的复制动作（上游 `XCopyValueAction` / `XCopyNameAction`，
// `platform/xdebugger-impl/ui/src/com/intellij/xdebugger/impl/ui/tree/actions/`）。
//
// 上游在树上挂两个动作：`XCopyValueAction` 复制节点的值、`XCopyNameAction` 复制节点的名字。
// 本仓的树是 DOM（`DebugPanel.vue`），没有右键菜单宿主，所以用行尾的复制按钮承载同一组动作；
// 文案与语义逐条对应两个动作类，格式化规则（值 / 名字怎么取）做成纯函数放这里，可单测。
//
// 与上游的一处如实差异：IDEA 的 Copy Value 在 `XValue` 上取的是 `computeValuePresentation()`，
// 本仓 DAP 的变量行只有适配器给的 `value` 字符串（类型是行上的另一列，不属于值文本），
// 所以「值」就是它本身 —— 不把类型拼进去发明一个上游没有的字符串。

/** 复制模式：值 / 名字（与上游两个动作一一对应）。 */
export type DebugCopyMode = 'value' | 'name'

export interface DebugCopyRow {
  /** 树上的显示名（数组元素是 `[0]` 这种显示名）。 */
  name: string
  value: string
  type?: string
}

export const DEBUG_COPY_TITLES: Record<DebugCopyMode, string> = {
  value: '复制值',
  name: '复制名称',
}

/**
 * 生成要放进剪贴板的文本。值为空（例如作用域节点没有值）时退回名字 ——
 * 复制一个空串没有任何用处，而作用域的名字是这一行唯一有意义的文本。
 */
export function debugCopyText(row: DebugCopyRow, mode: DebugCopyMode): string {
  if (mode === 'name') return row.name
  return row.value || row.name
}

/** 复制后的状态提示（界面上短暂显示，避免"点了没反应"的疑惑）。 */
export function debugCopyNote(row: DebugCopyRow, mode: DebugCopyMode, ok: boolean): string {
  if (!ok) return '复制失败：剪贴板不可用。'
  const what = mode === 'value' ? '值' : '名称'
  return `已复制 ${row.name} 的${what}。`
}
