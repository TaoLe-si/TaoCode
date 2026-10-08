// 监视（Watches）的**行级动作规则** —— 上游 `XMoveWatchUp` / `XMoveWatchDown` /
// `XRemoveAllWatchesAction` / `XPauseWatchAction` 四个动作的纯函数等价物。
//
// 上游坐标（`platform/xdebugger-impl/ui/src/com/intellij/xdebugger/impl/frame/actions/`）：
//   · `XMoveWatchUp.java:30-40` `isEnabled`：**恰好选中一条**，且它在 root 里的下标
//     `> firstWatchIndex`（`WatchesRootNode.headerNodesCount()`，根里前面那些不是监视的节点）——
//     即"不是第一条"；`perform`（`:43-48`）→ `XWatchesViewImpl.moveWatchUp`（`:686-689`）→ `moveUp`。
//   · `XMoveWatchDown.java:30-40` 对称：下标 `< 监视数 - 1 + headerNodesCount`（即"不是最后一条"）。
//   · `XRemoveAllWatchesAction.java:29-41` `isEnabled` = `root.getChildCount() > 0`；
//     `perform` → `XWatchesViewImpl.removeAllWatches()`（`:673-684`，连行内监视一起清）。
//   · `XPauseWatchAction.kt:16-49`：可暂停的前提 `xWatch.canBePaused`（`:18-20` 注释：
//     "不能取消求值，所以正在求值的节点不提供暂停"），`perform`（`:41-65`）把每条选中节点
//     的 `isPaused` 取反 —— **暂停时保留已算出的值**（`:59-61` 只换图标不重算），
//     **恢复时才重算**（`:63-65` 的 `recomputePresentation`）；文案随是否已暂停在
//     Pause/Resume 之间变（`:33-40`）。
//
// 本仓的等价物（纯函数 + 调用方持有的列表）：
//   · 监视是一条 `{ text, value, paused }`；`paused` 就是上游的 `XWatch.isPaused`
//     （`src/components/DebugPanel.vue` 的 `refreshWatches` 跳过它 ⇒ 保留上次的值）。
//   · `canBePaused` 在本仓 = 已经算过一次（`value !== ''`）：正在算的（值还是空）不给暂停，
//     与上游"不能取消求值就不提供暂停"同一条口径。
//
// 判据 `tests/debug-watch-actions.test.mjs`。

export interface WatchEntry {
  text: string
  value: string
  /** 上游 `XWatch.isPaused`：暂停的监视不再重算，保留上次的值。 */
  paused?: boolean
}

/** 选中一条且它前面还有别的监视才能上移（`XMoveWatchUp.java:30-40` 的 `index > firstWatchIndex`）。 */
export function canMoveWatchUp(watches: readonly WatchEntry[], text: string): boolean {
  return watches.findIndex(watch => watch.text === text) > 0
}

/** 选中一条且它后面还有别的监视才能下移（`XMoveWatchDown.java:30-40`）。 */
export function canMoveWatchDown(watches: readonly WatchEntry[], text: string): boolean {
  const index = watches.findIndex(watch => watch.text === text)
  return index >= 0 && index < watches.length - 1
}

/** 上移一条（不在列表里/已是第一条时原样返回，不抛）。 */
export function moveWatchUp(watches: readonly WatchEntry[], text: string): WatchEntry[] {
  const index = watches.findIndex(watch => watch.text === text)
  if (index <= 0) return [...watches]
  const next = [...watches]
  const [entry] = next.splice(index, 1)
  next.splice(index - 1, 0, entry)
  return next
}

/** 下移一条。 */
export function moveWatchDown(watches: readonly WatchEntry[], text: string): WatchEntry[] {
  const index = watches.findIndex(watch => watch.text === text)
  if (index < 0 || index >= watches.length - 1) return [...watches]
  const next = [...watches]
  const [entry] = next.splice(index, 1)
  next.splice(index + 1, 0, entry)
  return next
}

/** `XRemoveAllWatchesAction` 的 `isEnabled`（`root.getChildCount() > 0`）。 */
export function canRemoveAllWatches(watches: readonly WatchEntry[]): boolean {
  return watches.length > 0
}

/** 全清（`XWatchesViewImpl.removeAllWatches()`）。 */
export function removeAllWatches(): WatchEntry[] {
  return []
}

/** 能不能暂停这条监视：已经算过一次才给（上游 `canBePaused` + "正在求值的不提供"，见模块头）。 */
export function canPauseWatch(watch: WatchEntry): boolean {
  return watch.value !== ''
}

/**
 * 暂停/恢复：`XPauseWatchAction.kt:41-65` 的口径 —— 只要有一条**没在正确状态**的就整体取反，
 * 暂停的保留已算出的值，恢复的把值清空以便重算（`recomputePresentation`）。
 * 返回新列表（不改原对象）。
 */
export function toggleWatchPause(watches: readonly WatchEntry[], text: string): WatchEntry[] {
  const target = watches.find(watch => watch.text === text)
  if (!target || !canPauseWatch(target)) return [...watches]
  const resume = target.paused === true
  return watches.map(watch => {
    if (watch.text !== text) return watch
    // 暂停：保留值（`:59-61` 只换图标）；恢复：清值触发重算（`:63-65`）。
    return resume ? { ...watch, paused: false, value: '' } : { ...watch, paused: true }
  })
}

/** 该跳过重算的监视（`XPauseWatchAction` 暂停后 `refreshWatches` 不碰它）。 */
export function watchNeedsRecompute(watch: WatchEntry): boolean {
  return watch.paused !== true
}

/** 动作文案随是否已暂停在 Pause/Resume 之间变（`XPauseWatchAction.kt:33-40`）。 */
export function pauseWatchActionLabel(watch: WatchEntry): string {
  return watch.paused === true ? '恢复监视求值' : '暂停监视求值'
}