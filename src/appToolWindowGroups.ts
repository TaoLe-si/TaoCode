// 状态栏「工具窗口」弹窗的分组规则 —— App.vue 的 `groupedAvailableToolWindows` computed 主体
// （原 879-891 行）2026-10-06 逐字搬入本文件。
//
// 为什么能搬：这一段只做「把可用的工具窗口按停靠边分桶、桶内按条纹标题排序、丢掉空桶」。
// 输入是一张顺序表和三个查询函数，输出是 `{anchor, label, ids}[]`；锚点与禁用态在装配根那边
// 仍然是响应式的（以函数传入），本模块自己不读 ref、不碰 DOM、不发宿主请求。
//
// 条纹标题的排序函数没有复制一份：仍用 `src/toolWindows.ts` 的 `sortedByTitle`
// （`StringUtil.naturalCompare` 那一条上游依据留在装配根的 `availableToolWindows` 注释里）。
import { sortedByTitle } from './toolWindows.ts'
import type { Anchor } from './toolWindowStripes.ts'
import type { ToolWindowId } from './toolWindowMeta.ts'

/** 弹窗里的一组：停靠边 + 小标题 + 桶内已排序的工具窗口。 */
export type ToolWindowAnchorGroup = { anchor: Anchor; label: string; ids: ToolWindowId[] }

/** 分组入参：顺序表（上游的静态注册顺序）与三个查询函数。 */
export type ToolWindowGroupInput = {
  order: readonly ToolWindowId[]
  anchorOf: (id: ToolWindowId) => Anchor | undefined
  titleOf: (id: ToolWindowId) => string
  isDisabled: (id: ToolWindowId) => boolean
}

/** 分组与小标题，按原 computed 里数组字面量的顺序（左 → 底 → 右）；空组整组不出现。 */
export const TOOL_WINDOW_ANCHOR_LABELS: { anchor: Anchor; label: string }[] = [
  { anchor: 'left', label: '左侧' },
  { anchor: 'bottom', label: '底部' },
  { anchor: 'right', label: '右侧' },
]

// 状态栏"工具窗口"弹窗按停靠边分组（IDEA 的 ToolWindowsWidget 主体就是按 anchor 分组的列表）。
// 可用性 = isAvailable() && isShowStripeButton()，桶内按条纹标题排序 —— 两头的判据都已在装配根
// 与 `src/toolWindows.ts` 里钉住，这里只保留「怎么分组」这一半。
export function groupToolWindowsByAnchor(input: ToolWindowGroupInput): ToolWindowAnchorGroup[] {
  const groups: ToolWindowAnchorGroup[] = TOOL_WINDOW_ANCHOR_LABELS.map(group => ({ ...group, ids: [] }))
  for (const group of groups) {
    group.ids = sortedByTitle(
      input.order.filter(id => !input.isDisabled(id) && (input.anchorOf(id) ?? 'left') === group.anchor),
      id => input.titleOf(id))
  }
  return groups.filter(group => group.ids.length > 0)
}
