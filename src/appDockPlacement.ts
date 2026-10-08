// 工具窗口「开到哪一格」的落点 —— App.vue 的 `showView` / `requestEvaluate`（原 1411-1433 行）。
// 2026-10-06 逐字搬入本文件：锚点判定、底部 dock 的两步（`bottom = true` 然后 `bottomTab = view`）、
// 每次显示都记一次激活栈（`recordActiveToolWindow`）、收尾把主菜单收起。`requestEvaluate` 的 nonce
// 递增（同一句求值两次也要重新触发面板）照搬。
// 2026-10-07：「落到哪条 dock」改由注入的 `routeToDock` 决定（src/toolWindowDockSide.ts）——
// 左/右两条 dock 各自一份状态，本模块不再直接写 explorer/leftView 来选边。
//
// 上游坐标（随注释一起搬，未改一字）：
//   · 底部停靠那两行原话：「停靠在底部的工具窗口（IDEA 的任意停靠）：打开底部 dock 并**选中它**。
//     不能设 leftView —— 那会让左侧栏渲染一个属于底部的视图。」
//   · 求值那两行原话：Alt+F8 打开调试器工具窗口并把表达式交过去；nonce 让同一段文字第二次求值也能重新触发。
import { ref, type Ref } from 'vue'
import type { DockSide } from './toolWindowDockSide.ts'
import type { BottomTabId, ToolWindowId } from './toolWindowMeta.ts'

export type DockPlacementDeps = {
  bottom: Ref<boolean>
  bottomTab: Ref<BottomTabId | ToolWindowId>
  /** 按锚点把窗口送进对应 dock（宿主传 `createToolWindowDockSide` 的 `routeToDock`）。 */
  routeToDock: (id: ToolWindowId) => DockSide
  /** 求值把调试器钉到这一格（沿用搬走之前那条判据）。 */
  leftView: Ref<ToolWindowId>
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
    // 停靠在底部的工具窗口（IDEA 的任意停靠）：打开底部 dock 并**选中它**。
    // 不能设 leftView —— 那会让左侧栏渲染一个属于底部的视图。
    if (deps.routeToDock(view) === 'bottom') {
      deps.bottom.value = true
      deps.bottomTab.value = view
    }
    deps.recordActiveToolWindow(view)
    deps.closeMenu()
  }

  function requestEvaluate(text: string) {
    if (deps.routeToDock('debug') === 'bottom') deps.bottom.value = true
    deps.leftView.value = 'debug'
    evaluateRequest.value = { text, nonce: (evaluateRequest.value?.nonce ?? 0) + 1 }
  }

  return { showView, requestEvaluate, evaluateRequest }
}