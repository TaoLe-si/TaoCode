// 弹出菜单的**键盘导航**（B6 `ActionMenu` 一族的缺口：上游 Swing 菜单由 `MenuSelectionManager`
// 管"活动路径"，↑↓ 在行间走、Enter 执行、←→ 进出子段；本仓的浮层原先只有 Esc）。
//
// 与 `src/menuUi.ts` 的「查找操作」同一套口径：这里只算**纯函数**（哪些行可走、下一步去哪），
// 按键与 DOM 在 `src/components/EditorPopupMenu.vue` 里 —— 组件不可单测，判定留在这一层。
import type { MenuRow } from './menus/types'

/** 规则线不是可选项，与渲染层的 `v-if="row.rule"` 同一判据。 */
export function isSelectableRow(row: MenuRow): boolean {
  return !row.rule
}

/**
 * 键盘实际能落到的那串行：子段展开时，子行接在父行**之后**（上游 `JPopupMenu` 展开后
 * 子菜单的项属于同一条活动路径）。展开状态只有一个（本仓浮层是就地展开，见组件注释）。
 */
export function visibleMenuRows(rows: readonly MenuRow[], openId: string | null): MenuRow[] {
  const out: MenuRow[] = []
  for (const row of rows) {
    if (!isSelectableRow(row)) continue
    out.push(row)
    if (openId && row.id === openId && row.children) for (const child of row.children) if (isSelectableRow(child)) out.push(child)
  }
  return out
}

/**
 * 移动后的下标：`step` 正数向下、负数向上，两端**环绕**（Swing 的菜单也是环绕）。
 * 没有可选行时返回 -1；当前没选中（-1）时，向下从 0 开始、向上从末尾开始。
 */
export function nextMenuIndex(count: number, current: number, step: number): number {
  if (count <= 0) return -1
  if (current < 0) return step > 0 ? 0 : count - 1
  return (current + step + count) % count
}

/** 行能不能被激活：父行永远能（展开子段），普通行看 `enabled`。 */
export function rowActivatable(row: MenuRow): boolean {
  if (row.children) return true
  return row.enabled ? row.enabled() : true
}
