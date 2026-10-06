// 状态栏「工具窗口」那颗部件的悬停弹层 —— App.vue 的 `toolWindowsPopup` / `toolWindowsPopupTimer` /
// `scheduleToolWindowsPopup` / `closeToolWindowsPopup`（原 856-867 行）。
// 2026-10-06 逐字搬入本文件：定时器句柄的清空顺序、`window.clearTimeout` 的调用点、
// 「同一条 300 ms 双向使用」这条规则与弹层开合的写法都保持原样；300 这个毫秒值也照搬（它是对上游
// 悬停延迟的取值，不是样式时长，所以不走 `--dur-*` 令牌，与搬走之前一致）。
//
// 上游坐标（随注释一起搬，未改一字）：
//   · 下面那两行原话里的 `(:197)` 与 `(:138-142)` 指的是装配根那段 ToolWindowsWidget 注释
//     （整段留在 `src/App.vue`，因为它同时说明 `availableToolWindows` 与
//     `toggleToolWindowStripes` 这两件搬不走的事）里同一上游文件的行号。
//
// 为什么能搬：这一层只管「悬停计时器 + 一个开合布尔」，状态自持（与 `src/memoryWidget.ts`、
// `src/tabAlerts.ts` 同一种搬法）；弹窗**内容**的分组规则仍在 `src/appToolWindowGroups.ts`，
// 行内清单的可用性判据仍留在装配根的 `availableToolWindows`（那是 `isAvailable() && isShowStripeButton()`
// 加 `sortedByTitle`，属于 ToolWindowsWidget 主体而不是这层计时器）。
import { ref, type Ref } from 'vue'

export type ToolWindowsHoverPopup = {
  toolWindowsPopup: Ref<boolean>
  scheduleToolWindowsPopup: (open: boolean) => void
  closeToolWindowsPopup: () => void
}

export function createToolWindowsHoverPopup(): ToolWindowsHoverPopup {
  const toolWindowsPopup = ref(false)
  let toolWindowsPopupTimer: number | null = null
  // The 300 ms is used in both directions: to arm the popup (:197) and to let the pointer
  // travel from the widget into the popup without dismissing it (:138-142).
  function scheduleToolWindowsPopup(open: boolean) {
    if (toolWindowsPopupTimer !== null) window.clearTimeout(toolWindowsPopupTimer)
    toolWindowsPopupTimer = window.setTimeout(() => { toolWindowsPopupTimer = null; toolWindowsPopup.value = open }, 300)
  }
  function closeToolWindowsPopup() {
    if (toolWindowsPopupTimer !== null) { window.clearTimeout(toolWindowsPopupTimer); toolWindowsPopupTimer = null }
    toolWindowsPopup.value = false
  }
  return { toolWindowsPopup, scheduleToolWindowsPopup, closeToolWindowsPopup }
}
