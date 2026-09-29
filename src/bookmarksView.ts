// 书签工具窗口的**视图状态**（IDEA `BookmarksViewState`，platform/bookmarks/src/com/intellij/ide/bookmark/ui/BookmarksViewState.kt:18-31）
// 与它的齿轮动作组（`Bookmarks.ToolWindow.GearActions`，platform/bookmarks/resources/intellij.platform.bookmarks.xml:191-206）。
//
// 源码里的 6 个开关与默认值：
//   groupLineBookmarks   true   按文件分组行书签（BookmarksView.GroupLineBookmarks）
//   rewriteBookmarkType  false  改写书签类型（UI 里显示为取反，BookmarksView.RewriteBookmarkType）
//   askBeforeDeletingLists true 删除列表前询问（BookmarksView.AskBeforeDeletingLists）
//   autoscrollToSource   false  选中书签时跳到源（BookmarksView.AutoscrollToSource）
//   autoscrollFromSource false  源变化时选中书签（BookmarksView.AutoscrollFromSource）
//   showPreview          false  在预览标签页打开（BookmarksView.OpenInPreviewTab）
// 其中 `autoscrollToSource` 在 `noStateLoaded()` 时取 `UISettings.defaultAutoScrollToSource`（:38-40）。
//
// **TaoCode 只实现有真实落点的三项**（其余登记在 docs/class-parity-todo.md，不渲染假开关）：
//   groupLineBookmarks   → 面板按文件分组 / 平铺
//   autoscrollToSource   → 面板里用键盘选中某条时是否跳到编辑器
//   autoscrollFromSource → 编辑器切换文件时面板是否滚到该文件的第一条书签
// 无落点：`askBeforeDeletingLists`（本仓没有命名书签列表）、`showPreview`（没有预览标签页）、
// `rewriteBookmarkType`（没有书签类型体系）。
export interface BookmarksViewSettings {
  groupLineBookmarks: boolean
  autoscrollToSource: boolean
  autoscrollFromSource: boolean
}

/** 与 IDEA `BookmarksViewState` 的默认值一致（`:23-29`）。 */
export const DEFAULT_BOOKMARKS_VIEW: BookmarksViewSettings = {
  groupLineBookmarks: true,
  autoscrollToSource: false,
  autoscrollFromSource: false,
}

export interface BookmarkLike { path: string; line: number; mnemonic?: number }

export interface BookmarkGroup<T extends BookmarkLike> { path: string; entries: T[] }

/**
 * `groupLineBookmarks` 开 = 按文件分组（顺序取该文件第一次出现的位置，组内按行号升序）；
 * 关 = 平铺成一组（IDEA 关掉分组时就是一条平铺列表，顺序仍是书签自己的顺序）。
 */
export function groupBookmarks<T extends BookmarkLike>(entries: readonly T[], group: boolean): BookmarkGroup<T>[] {
  if (!group) return entries.length ? [{ path: '', entries: [...entries] }] : []
  const groups: BookmarkGroup<T>[] = []
  const index = new Map<string, BookmarkGroup<T>>()
  for (const entry of entries) {
    let bucket = index.get(entry.path)
    if (!bucket) { bucket = { path: entry.path, entries: [] }; index.set(entry.path, bucket); groups.push(bucket) }
    bucket.entries.push(entry)
  }
  for (const bucket of groups) bucket.entries.sort((a, b) => a.line - b.line)
  return groups
}

/**
 * `autoscrollFromSource`：编辑器切到某个文件时，面板要滚到的那条书签 —— 该文件书签里行号最小的那条。
 * 没有这个文件的书签时返回 `null`（IDEA 此时不滚动）。
 */
export function scrollTargetFor<T extends BookmarkLike>(entries: readonly T[], path: string): T | null {
  if (!path) return null
  let best: T | null = null
  for (const entry of entries) {
    if (entry.path !== path) continue
    if (!best || entry.line < best.line) best = entry
  }
  return best
}

/** 行键（面板里用来定位某一条，也是键盘上下移动的单位）。 */
export function bookmarkKey(entry: BookmarkLike): string {
  return `${entry.path}:${entry.line}`
}

/** `autoscrollToSource`：键盘上下移动时下一条要选中的书签（在**可见顺序**上移动，不按数据顺序）。 */
export function stepSelection(visible: readonly BookmarkLike[], current: string, direction: 1 | -1): string | null {
  if (!visible.length) return null
  const keys = visible.map(bookmarkKey)
  const at = keys.indexOf(current)
  if (at < 0) return keys[direction > 0 ? 0 : keys.length - 1]
  const next = at + direction
  if (next < 0 || next >= keys.length) return current
  return keys[next]
}
