// 侧条按钮的一次点击 = 「按当前锚点把窗口切进来，再点一次收起」—— App.vue 的 `activateToolWindow`
//（原 302-325 行）。
// 2026-10-06 逐字搬入本文件：可用性门禁在前（`toolDisabled` 直接 return）、激活即复原被移除的侧条按钮、
// 锚点判定排在 `files` / `outline` 两条专属分支**之后**判定的原顺序、底部档的「再次点击即收起」用
// `bottom.value && bottomTab.value === id` 算 `wasShown`、`files` 档翻 `explorer`、`outline` 档走
// `toggleOutline` 并要求 `explorer && leftView === 'outline'` 才算激活、其余档「同一个 id 再点就回 files」，
// 以及「只有把窗口**带到前面**的那一次点击才算激活」（第二次点击是隐藏，隐藏必须别动常驻栈）——
// 全部与搬走之前逐字一致。
//
// 上游坐标随注释搬家（原话，未改一字）：
//   · 「激活即把侧条按钮放回来（上游 showToolWindowImpl:942）」
//   · 「锚点先判（`activationTarget` 住在 toolWindowStripes.ts，只看锚点不看窗口种类）。
//      原先 `files` / `outline` 两条专属分支排在锚点判断**之前**就 return，于是它们无视
//      `toolAnchors`：被 Move to Bottom 搬走后左栏没有入口，点击路径又只走 leftView/explorer，
//      两侧都够不着 —— 窗口再也切不回来。IDEA 的 activate 一律按当前 ToolWindowAnchor 决定
//      dock（ToolWindowManagerImpl.activateToolWindow），与窗口种类无关。」
//   · 「Only a click that *brings the window forward* counts as an activation; the second click hides
//      it, and hiding must leave the persistent stack alone (`setHiddenState`, :711-718).」
//
// 为什么能搬：这一段的输入只有「点了哪个窗口」，写操作全部经注入的 ref 与回调完成；
// `recordActiveToolWindow`（常驻栈的 push 规则）与 `isLeftToolWindowId` 留在宿主，
// 因为它们的判据在 `src/activeToolWindow.ts` / `src/toolWindowStripes.ts` 那边已经钉住了。
import type { Ref } from 'vue'
import type { BottomTabId, ToolWindowId } from './toolWindowMeta.ts'

export type ToolWindowActivationDeps = {
  bottom: Ref<boolean>
  bottomTab: Ref<BottomTabId | ToolWindowId>
  explorer: Ref<boolean>
  leftView: Ref<ToolWindowId>
  /** 该窗口的内容此刻能不能产出（沿用宿主那个 `toolDisabled` 的名字，锚点跟着搬）。 */
  toolDisabled: (id: ToolWindowId) => boolean
  /** 激活即把侧条按钮放回来（沿用宿主那个 `restoreStripeButton` 的名字，锚点跟着搬）。 */
  restoreStripeButton: (id: ToolWindowId) => void
  /** 按当前锚点决定落哪一格（宿主传 `id => activationTarget(id).dock`）。 */
  dockOf: (id: ToolWindowId) => 'bottom' | 'side'
  /** 大纲档自己那条切换（`toggleOutline`，声明在宿主更晚的位置，用回调注入）。 */
  toggleOutline: () => void
  /** 记一次激活（沿用宿主那个 `recordActiveToolWindow` 的名字，锚点跟着搬）。 */
  recordActiveToolWindow: (id: ToolWindowId | BottomTabId) => void
}

export function createToolWindowActivation(deps: ToolWindowActivationDeps) {
  function activateToolWindow(id: ToolWindowId) {
    if (deps.toolDisabled(id)) return
    deps.restoreStripeButton(id) // 激活即把侧条按钮放回来（上游 showToolWindowImpl:942）
    // 锚点先判（`activationTarget` 住在 toolWindowStripes.ts，只看锚点不看窗口种类）。
    // 原先 `files` / `outline` 两条专属分支排在锚点判断**之前**就 return，于是它们无视
    // `toolAnchors`：被 Move to Bottom 搬走后左栏没有入口，点击路径又只走 leftView/explorer，
    // 两侧都够不着 —— 窗口再也切不回来。IDEA 的 activate 一律按当前 ToolWindowAnchor 决定
    // dock（ToolWindowManagerImpl.activateToolWindow），与窗口种类无关。
    if (deps.dockOf(id) === 'bottom') {
      // 停靠在底部的工具窗口：显示在底部 dock（不占用左侧栏），再次点击即收起。
      const wasShown = deps.bottom.value && deps.bottomTab.value === id
      deps.bottom.value = !wasShown
      deps.bottomTab.value = id
      if (!wasShown) deps.recordActiveToolWindow(id)
      return
    }
    if (id === 'files') { deps.explorer.value = !deps.explorer.value; deps.leftView.value = 'files'; if (deps.explorer.value) deps.recordActiveToolWindow(id); return }
    if (id === 'outline') { deps.toggleOutline(); if (deps.explorer.value && deps.leftView.value === 'outline') deps.recordActiveToolWindow(id); return }
    deps.explorer.value = true
    deps.leftView.value = deps.leftView.value === id ? 'files' : id
    // Only a click that *brings the window forward* counts as an activation; the second click hides
    // it, and hiding must leave the persistent stack alone (`setHiddenState`, :711-718).
    if (deps.leftView.value === id) deps.recordActiveToolWindow(id)
  }
  return { activateToolWindow }
}
