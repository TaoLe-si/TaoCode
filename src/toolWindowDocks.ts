// 「焦点在哪一条 dock 里」—— 工具窗口域共用的一条 DOM 判据。
//
// 上游的对应物是 `getToolWindowIdForComponent(focusedComponent)`
// （`platform/platform-impl/src/com/intellij/openapi/wm/impl/ToolWindowManagerLifecycle.kt:129`）：
// 从被聚焦的组件往上走到它所属的那个工具窗口，再和"要被自动隐藏的窗口"比身份。
// 本仓一条 dock 同时只装一个窗口（侧栏是 `leftView`、底部是 `bottomTab`），
// 所以"还在同一个窗口里"就等价于"还在同一个 dock 容器里"。
//
// 为什么要单独立一个小模块：这条判据原先只长在 `src/toolWindowActions.ts` 里，
// 而自动隐藏的判断住在 `src/toolWindowStripes.ts` —— 让 stripes 去 import actions 会把
// 整条引用视图/标签导航依赖链拖进窗口状态模块。两边都只依赖这张选择器表。
export type Dock = 'side' | 'bottom' | 'editor'

/** 底部 dock（`App.vue` 的 `.output-panel`）与侧栏 dock（`.explorer-panel`）的容器类名。 */
export const BOTTOM_DOCK_SELECTOR = '.output-panel'
export const SIDE_DOCK_SELECTOR = '.explorer-panel'
/** 右侧那条侧栏 dock 的容器（`App.vue` 的 `.explorer-panel.right-dock`）。 */
export const RIGHT_DOCK_SELECTOR = '.explorer-panel.right-dock'

/** 只看得到 `closest` 的元素即可（真实 DOM 与单测夹具同一条路）。 */
export interface ElementWithClosest {
  closest: (selector: string) => unknown
}

/** 这个组件在哪条 dock 里；都不在就是编辑器（上游返回 null 的那一支）。 */
export function dockOf(element: ElementWithClosest | null | undefined): Dock {
  if (element?.closest(BOTTOM_DOCK_SELECTOR)) return 'bottom'
  if (element?.closest(SIDE_DOCK_SELECTOR)) return 'side'
  return 'editor'
}

/** 焦点在哪一侧的侧栏 dock（左右两条各自独立后，`dockOf` 只回答到 'side' 这一层）。 */
export function sideDockOf(element: ElementWithClosest | null | undefined): 'left' | 'right' | null {
  if (!element?.closest(SIDE_DOCK_SELECTOR)) return null
  return element.closest(RIGHT_DOCK_SELECTOR) ? 'right' : 'left'
}

/** 这条 dock 装的是哪一侧（自动隐藏按这一位去收面板）。 */
export function dockIsWindowSide(dock: Dock): boolean {
  return dock === 'side'
}
