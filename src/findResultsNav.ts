// 搜索结果面板的**键盘选择语义**（上游 `FindPopupPanel` 里挂在那张 JBTable 上的动作）。
//
// 上游两处：
//   · `FindPopupPanel.java:830` `ScrollingUtil.installActions(myResultsPreviewTable, false, tableAware)`
//     —— `cycleScrolling = false`。JTable 那套（`ScrollingUtil.java:515-566`）：
//       Home / End 选首行 / 末行；PageUp / PageDown 的步长是 `visible - 1`、两端夹住；
//       Up / Down 一次一行，**到端不动**（`_move` `:478-505` 在 cycleScrolling=false 时直接 return）；
//   · `FindPopupPanel.java:842-856` FindNext / FindPrevious（F3 / Shift+F3）注册在搜索框、替换框与
//     按钮上：`selectedRow < rowCount - 1` 才 +1、`selectedRow > 0` 才 -1，**不回绕**。
//
// 本仓把这份语义做成纯函数：`total` 是扁平化后的结果行数，`visible` 是结果区可见行数
// （`visible - 1` 才是翻页步长）；返回 null = 这一步不该动。滚动与展开由组件做。
export type ResultsNavKey = 'Home' | 'End' | 'PageUp' | 'PageDown' | 'ArrowUp' | 'ArrowDown' | 'FindNext' | 'FindPrevious'

/** 一行结果的近似高度：结果区可见行数按它折算（与 `.fs-match` 的行高同一档）。 */
export const RESULT_ROW_HEIGHT = 21

/** `ScrollingUtil.movePageUp/movePageDown` 的步长：`visible - 1`。 */
export function pageStep(visible: number): number {
  return Math.max(0, Math.trunc(visible) - 1)
}

/** 这一步该把光标放到哪一行；null = 不动（到端、空表、或状态没变）。 */
export function navTarget(key: ResultsNavKey, cursor: number, total: number, visible: number): number | null {
  if (total <= 0) return null
  const last = total - 1
  const clamp = (index: number): number => Math.min(Math.max(index, 0), last)
  const step = pageStep(visible)
  switch (key) {
    case 'Home': return 0
    case 'End': return last
    // 还没选过：`getMinSelectionIndex()` 是 -1，PageUp 夹到 0，PageDown 落在 `-1 + step`。
    case 'PageUp': return cursor < 0 ? 0 : clamp(cursor - step)
    case 'PageDown': return cursor < 0 ? clamp(-1 + step) : clamp(cursor + step)
    case 'ArrowUp': return cursor <= 0 ? null : cursor - 1
    case 'ArrowDown': return cursor < 0 ? 0 : (cursor >= last ? null : cursor + 1)
    case 'FindNext': return cursor < 0 ? 0 : (cursor >= last ? null : cursor + 1)
    case 'FindPrevious': return cursor > 0 ? cursor - 1 : null
  }
}

/** 键盘事件 → 本模块的动作名（不认得的键返回 null）。F3 的方向由 shift 决定（上游两条动作各有键位）。 */
export function resultsNavKeyOf(event: { key: string; shiftKey: boolean }): ResultsNavKey | null {
  switch (event.key) {
    case 'Home': return 'Home'
    case 'End': return 'End'
    case 'PageUp': return 'PageUp'
    case 'PageDown': return 'PageDown'
    case 'ArrowUp': return 'ArrowUp'
    case 'ArrowDown': return 'ArrowDown'
    case 'F3': return event.shiftKey ? 'FindPrevious' : 'FindNext'
    default: return null
  }
}
