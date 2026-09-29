// 弹层的**取消键语义** —— IDEA `AbstractPopup.dispatchKeyEvent` 那一半。
//
// 上游原文（`platform/platform-impl/src/com/intellij/ui/popup/AbstractPopup.java:2995-3012`）：
//
//   if (isCloseRequest(e) && myCancelKeyEnabled && !mySpeedSearch.isHoldingFilter()) {
//     if (mySpeedSearchFoundInRootComponent != null && mySpeedSearchFoundInRootComponent.isHoldingFilter()) {
//       mySpeedSearchFoundInRootComponent.reset();      // ① 有字 → 先清掉过滤器
//     }
//     else {
//       cancel(e);                                     // ② 没字 → 才关掉弹层
//     }
//     return true;
//   }
//
// 也就是**两段式**：速度搜索框里已经有字时，Esc 先把字清掉、弹层留着；再按一次才关。
// `isCloseRequest`（`:3022-3027`）取的是 keymap 里 `IdeActions.ACTION_EDITOR_ESCAPE` 的绑定 ——
// 本仓没有可换绑的 keymap，落点就是 Escape 本身。
//
// 本仓早先的写法是"Esc 直接关"，在带速度搜索的弹层上丢掉了第一段：
// 用户敲了几个字想退回去，结果整个弹层没了。
export type PopupCancelKeyAction = 'reset-filter' | 'close'

/**
 * `dispatchKeyEvent` 的两段式：过滤器非空时先清它，空了才关。
 * `filter` 是当前速度搜索框里的内容（调用方给，通常是去掉空白后的串）。
 */
export function popupCancelKeyAction(filter: string): PopupCancelKeyAction {
  // 上游判的是 `isHoldingFilter()`（框架里"框里有内容"），空白串不算有内容 —— 与速度搜索
  // 自己的空串语义一致（`SpeedSearchBase` 空串放行全部）。
  return filter.trim() ? 'reset-filter' : 'close'
}
