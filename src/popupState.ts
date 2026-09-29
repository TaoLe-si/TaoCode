// 「刚关掉又立刻弹开」的抑制 —— IDEA `com.intellij.ui.popup.PopupState` 的对应物。
//
// 上游类注释原文："This helper class is intended to prevent opening a popup, a popup menu or a
// balloon right after its closing."（platform/platform-api/src/com/intellij/ui/popup/PopupState.java:23-26）
// 判据在 `isRecentlyHidden()`（:56-61）：
//   · 阈值取注册表 `ide.popup.hide.show.threshold`，代码里的默认值是 **200ms**；
//   · 问一次就把 `hiddenLongEnough` 复位成 true —— 也就是说这道闸门**只吞一次**，
//     不会把"关闭后隔了一会儿再点开"也一起挡掉。
//
// 为什么本仓需要它：浮层的"点外面关闭"挂在 `pointerdown` 的捕获阶段，而打开挂在那个位置
// 自己的 `click` 上（一次点击先 pointerdown 后 click）。于是"关掉「…」再点「…」"会被
// 同一次点击关掉又弹开 —— 上游用 PopupState 把第二次吞掉。

/** `ide.popup.hide.show.threshold` 的默认值（毫秒）。 */
export const POPUP_HIDE_SHOW_THRESHOLD_MS = 200

export interface PopupGate {
  /** 关闭时记录时刻（上游在 popup 的 listener 里做同一件事）。 */
  hidden(at?: number): void
  /** `isRecentlyHidden()`：读一次即复位，所以每道闸门只吞一次。 */
  readonly recentlyHidden: boolean
}

export function createPopupGate(threshold = POPUP_HIDE_SHOW_THRESHOLD_MS, now: () => number = () => Date.now()): PopupGate {
  let hiddenLongEnough = true
  let timeHiddenAt = 0
  return {
    hidden(at = now()) { hiddenLongEnough = false; timeHiddenAt = at },
    get recentlyHidden() {
      if (hiddenLongEnough) return false
      hiddenLongEnough = true
      return now() - timeHiddenAt < threshold
    },
  }
}
