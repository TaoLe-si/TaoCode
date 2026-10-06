// 工具窗口「开到哪一格」的落点 —— App.vue 的 `showView` / `requestEvaluate`（原 1411-1433 行）。
// 2026-10-06 逐字搬入本文件：锚点判定（`toolAnchors[view] ?? 'left'` 的兜底）、底部 dock 的两步
// （`bottom = true` 然后 `bottomTab = view`）、左侧栏的两步（`explorer = true` 然后 `leftView = view`）、
// 每次显示都记一次激活栈（`recordActiveToolWindow`）、以及收尾把主菜单收起，全部与搬走之前一致。
// `requestEvaluate` 的 nonce 递增（同一句求值两次也要重新触发面板）照搬。
//
// 上游坐标（随注释一起搬，未改一字）：
//   · 底部停靠那两行原话：「停靠在底部的工具窗口（IDEA 的任意停靠）：打开底部 dock 并**选中它**。
//     不能设 leftView —— 那会让左侧栏渲染一个属于底部的视图。」
//   · 求值那两行原话：Alt+F8 打开调试器工具窗口并把表达式交过去；nonce 让同一段文字第二次求值也能重新触发。
//
// 为什么能搬：这两条是同一个域的另一半 —— 「按当前锚点决定窗口落在哪一格」，输入只有锚点与视图 id，
// 写操作全部通过注入的 ref / 回调完成，没有一处读别的 computed。`showOutput` 留在装配根
// （它被 `tests/*` 按名字钉在宿主那一行，且与 `recordActiveToolWindow` 同处一段）。
import { ref, type Ref } from 'vue'
import type { Anchor } from './toolWindowStripes.ts'
import type { BottomTabId, ToolWindowId } from './toolWindowMeta.ts'

export type DockPlacementDeps = {
  bottom: Ref<boolean>
  bottomTab: Ref<BottomTabId | ToolWindowId>
  explorer: Ref<boolean>
  leftView: Ref<ToolWindowId>
  /** 某个视图现在停在哪一侧（宿主传 `id => toolAnchors[id] ?? 'left'`）。 */
  anchorOf: (id: ToolWindowId) => Anchor
  /** 记一次激活（宿主传进来的就是那个 `recordActiveToolWindow`，名字沿用，锚点跟着搬）。 */
  recordActiveToolWindow: (id: ToolWindowId | BottomTabId) => void
  /** 收起主菜单（宿主里是 `menu.value = null`）。 */
  closeMenu: () => void
}

export type EvaluateRequest = { text: string; nonce: number }

export function createToolWindowDockPlacement(deps: DockPlacementDeps) {
  // Alt+F8 in the editor opens the debugger tool window and hands the expression over.
  // The nonce re-triggers the panel even when the same text is evaluated twice.
  const evaluateRequest = ref<{ text: string; nonce: number } | null>(null)

  function showView(view: ToolWindowId) {
    const anchor = deps.anchorOf(view)
    if (anchor === 'bottom') {
      // 停靠在底部的工具窗口（IDEA 的任意停靠）：打开底部 dock 并**选中它**。
      // 不能设 leftView —— 那会让左侧栏渲染一个属于底部的视图。
      deps.bottom.value = true
      deps.bottomTab.value = view
    } else {
      deps.explorer.value = true
      deps.leftView.value = view
    }
    deps.recordActiveToolWindow(view)
    deps.closeMenu()
  }

  function requestEvaluate(text: string) {
    const anchor = deps.anchorOf('debug')
    if (anchor === 'bottom') deps.bottom.value = true
    else deps.explorer.value = true
    deps.leftView.value = 'debug'
    evaluateRequest.value = { text, nonce: (evaluateRequest.value?.nonce ?? 0) + 1 }
  }

  return { showView, requestEvaluate, evaluateRequest }
}
