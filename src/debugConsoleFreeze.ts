// 调试控制台的「暂停输出」规则 —— 上游 `PauseOutputAction`
// （`platform/execution-impl/src/com/intellij/execution/actions/PauseOutputAction.java:18` 的类声明
// 到同文件 `:65`，整文件 65 行；
// 注册 id 见 `platform/execution-impl/resources/intellij.platform.execution.impl.actions.xml:72`
// 的 `<action id="PauseOutput" .../>`）。
//
// 为什么它出现在调试器判词里：调试器标签页的控制台就是一个 `ConsoleView`
// （`XDebugSessionTab` 的内容面板），这个开关就是那条工具栏上的「Pause output」。
// 上游语义逐条照搬（行号 2026-10-06 · dap3 逐行重数过参考树：类声明那一行与「可用判据」那一段
// 原先都指歪了，订正记录留痕在 `docs/batch-2026-10-06-dap3.md`，钉住内容的判据在 `tests/debug-console-freeze.test.mjs`）：
//   · 它是个 ToggleAction（`:18` `final class PauseOutputAction extends ToggleAction implements DumbAware`），
//     读写的是控制台的 `isOutputPaused()`（`:31`）/ `setOutputPaused()`（`:38`）
//     ——**只冻结跟随滚动，不拦输出**；
//   · 可用条件（`:48-65` 的 `update()`）：控制台存在且 `canPause()`（`:53`），
//     并且「进程还没结束」（`:59`）或「有延迟输出」（`:60`）；结论走 `setEnabledAndVisible`（`:64`）
//     ⇒ 不满足时这个开关是**不出现**的，不是灰着；
//   · `hasDeferredOutput()`：暂停期间积压的行数 —— 本仓的等价物是暂停期间新到的条目数
//     （`dapConsole` 一直在收，只是不滚动，见 `deferredLines`）。
//
// 本仓落点：`src/components/DebugConsolePane.vue`（从 DebugPanel.vue 拆出来的控制台块）。
// 上游 `canPause()` 在本仓恒真（DOM 滚动条永远可以被冻结），所以剩下的判据只有「会话在不在」与
// 「有没有积压」那两条 ⇒ 见 `pauseOutputVisible`。

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

/** 暂停时要不要给出「有积压」的提示（上游 `:53-60` 的 `canPause()` 与 `handler 未结束 || 有延迟输出`）。 */
export function hasDeferredOutput(total: number, markedAt: number | null): boolean {
  return deferredLines(total, markedAt) > 0
}

/**
 * 「暂停输出」这个开关到底出不出现在工具栏上 —— 上游 `PauseOutputAction.update()`
 * （`platform/execution-impl/src/com/intellij/execution/actions/PauseOutputAction.java:48-65`）
 * 倒数第二行是 `presentation.setEnabledAndVisible(isEnabled)`（`:64`）：**不可用就一并隐藏**，
 * 不是画个灰按钮。可用性本身是两支（`:53` 与 `:59-60`）：
 * `canPause()` 且（进程还没结束 `handler != null && !handler.isProcessTerminated()` **或** 控制台有延迟输出）。
 * 本仓 `processRunning` = `dapState.running`（`src/bridge.ts:716` 起会话置真、`:672` 的 `terminated` 事件置假，
 * 停在断点时仍为真 = 上游「进程还没结束」那一档），`hasDeferred` = 暂停期间积压的行数。
 * ⇒ 会话已结束、又没有暂停着的积压时，这一行不出现（与上游同一形态）。
 */
export function pauseOutputVisible(input: { canPause?: boolean; processRunning: boolean; hasDeferred: boolean }): boolean {
  if (!(input.canPause ?? CONSOLE_CAN_PAUSE)) return false
  return input.processRunning || input.hasDeferred
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
