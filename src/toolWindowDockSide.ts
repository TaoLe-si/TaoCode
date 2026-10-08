// 左右两条 dock 各自独立的状态。
//
// 上游依据：IDEA 的 `ToolWindowManagerImpl` 对每条 `ToolWindowAnchor` 各持一份 dock 状态
// （LEFT / RIGHT 各一个 `ToolWindowPane`），激活一侧不收起另一侧，两条 dock 可同时可见。
// 本仓原先把两条 dock 压成一个 `activeAnchor`（只回答「当前激活视图的锚点」），于是
// 打开右栏必然把左栏的 `v-if` 摘掉 —— 2026-10-07 用户报的「左右无法同时打开」。
import { computed, ref, type ComputedRef, type Ref } from 'vue'
import { DEFAULT_TOOL_ANCHORS, toolWindowOrder, type ToolWindowId } from './toolWindowMeta.ts'

export type DockSide = 'left' | 'right' | 'bottom'

export type ToolWindowDockSideDeps = {
  /** 每个窗口停在哪一侧（宿主传 `toolAnchors`）。惰性形态（函数）给「锚点表由更晚的
   *  装配产出、但本工厂要先建」的宿主用 —— 三处读取全是惰性求值，声明顺序无关。 */
  toolAnchors: Record<string, DockSide> | (() => Record<string, DockSide>)
  /** 左 dock 装哪个窗口。 */
  leftView: Ref<ToolWindowId>
  /** 左 dock 可见性（沿用宿主的 `explorer`）。 */
  explorer: Ref<boolean>
}

export function createToolWindowDockSide(deps: ToolWindowDockSideDeps) {
  const anchorTable = () => (typeof deps.toolAnchors === 'function' ? deps.toolAnchors() : deps.toolAnchors)
  // 初值 = 注册表里第一个右锚窗口（`DEFAULT_TOOL_ANCHORS` 按注册表顺序派生）。
  const rightView = ref<ToolWindowId>(toolWindowOrder.find(id => DEFAULT_TOOL_ANCHORS[id] === 'right') ?? toolWindowOrder[0])
  const rightVisible = ref(false)
  const showLeftDock = computed<boolean>(() => deps.explorer.value && anchorTable()[deps.leftView.value] === 'left')
  const showRightDock = computed<boolean>(() => rightVisible.value && anchorTable()[rightView.value] === 'right')
  /**
   * 按锚点把窗口送进对应的那条 dock（left/right 各自写自己的状态，互不影响）。
   * 语义是「带到前面」而不是 toggle —— toggle 那半在 `createToolWindowActivation`（上游 stripe 点击）。
   * 锚点 bottom 由调用方接管（本仓底部 dock 的入口长在 dock 里面），所以原样返回 'bottom'。
   */
  function routeToDock(id: ToolWindowId): DockSide {
    const anchor = anchorTable()[id] ?? 'left'
    if (anchor === 'bottom') return 'bottom'
    if (anchor === 'right') { rightVisible.value = true; rightView.value = id; return 'right' }
    deps.explorer.value = true
    deps.leftView.value = id
    return 'left'
  }
  return { rightView, rightVisible, showLeftDock, showRightDock, routeToDock }
}