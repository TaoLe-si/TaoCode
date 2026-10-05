// 调试控制台的「暂停输出」规则 —— 上游 `PauseOutputAction`
// （`platform/execution-impl/src/com/intellij/execution/actions/PauseOutputAction.java`，
// 注册 id 见 `platform/execution-impl/resources/intellij.platform.execution.impl.actions.xml:72`
// 的 `<action id="PauseOutput" .../>`）。
//
// 为什么它出现在调试器判词里：调试器标签页的控制台就是一个 `ConsoleView`
// （`XDebugSessionTab` 的内容面板），这个开关就是那条工具栏上的「Pause output」。
// 上游语义逐条照搬：
//   · 它是个 ToggleAction（`:19`），读写的是控制台的 `isOutputPaused()` / `setOutputPaused()`
//     （`:31-35` / `:38-43`）——**只冻结跟随滚动，不拦输出**；
//   · 可用条件（`:44-52`）：控制台存在且 `canPause()`，并且「进程还没结束」或「有延迟输出」；
//   · `hasDeferredOutput()`：暂停期间积压的行数 —— 本仓的等价物是暂停期间新到的条目数
//     （`dapConsole` 一直在收，只是不滚动，见 `deferredLines`）。
//
// 本仓落点：`src/components/DebugConsolePane.vue`（从 DebugPanel.vue 拆出来的控制台块）。
// 不画假按钮：会话没在跑、也没有积压时，开关仍然可点（上游同样只要求 `canPause()`），
// 但「N 行未显示」只在真有积压时出现。

/** 上游 `ConsoleView.canPause()` 在本仓恒真：DOM 滚动条永远可以被冻结。 */
export const CONSOLE_CAN_PAUSE = true

/** 跟随滚动的判据：没暂停才跟随（上游 `setOutputPaused` 之后不再自动滚到底）。 */
export function shouldFollowOutput(paused: boolean): boolean {
  return !paused
}

/**
 * 暂停期间积压的行数（上游 `hasDeferredOutput()`）。
 * `total` 是当前 `dapConsole` 的长度，`markedAt` 是按下暂停时记下的长度 ——
 * 差值就是「没跟着滚过去」的那几行；会话重启（长度变短）时归零。
 */
export function deferredLines(total: number, markedAt: number | null): number {
  if (markedAt === null || total < markedAt) return 0
  return total - markedAt
}

/** 暂停时要不要给出「有积压」的提示（上游 `:50-52` 的 `handler 未结束 || 有延迟输出`）。 */
export function hasDeferredOutput(total: number, markedAt: number | null): boolean {
  return deferredLines(total, markedAt) > 0
}

/**
 * 切换暂停时新的标记点（上游 `setSelected` 只改状态；这里多记一条长度，
 * 好在恢复时给出「跳到底部」的那一下）。取消暂停 ⇒ 标记清空。
 */
export function markForPause(paused: boolean, total: number): number | null {
  return paused ? total : null
}

/**
 * 恢复输出时要不要滚到底（上游取消暂停后控制台回到跟随状态）。
 * 有过积压才滚 —— 没有积压时本来就在底部，再滚一次是无副作用的多余动作。
 */
export function shouldRevealOnResume(total: number, markedAt: number | null): boolean {
  return hasDeferredOutput(total, markedAt)
}

/** 开关文案（上游 `ExecutionBundle` 的 "Pause output"；本仓中文口径与其它调试开关一致）。 */
export const PAUSE_OUTPUT_LABEL = '暂停输出'

/**
 * 提示文案：暂停期间积压了多少行。恢复跟随后这条就消失（`deferredLines` 归零）。
 */
export function deferredOutputNote(total: number, markedAt: number | null): string {
  const count = deferredLines(total, markedAt)
  return count > 0 ? `${count} 行未显示` : ''
}
