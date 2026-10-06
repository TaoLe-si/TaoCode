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
// **TaoCode 实现有真实落点的五项**（其余登记在 docs/class-parity-todo.md，不渲染假开关）：
//   groupLineBookmarks   → 面板按文件分组 / 平铺
//   askBeforeDeletingLists → 删除书签列表前是否先确认（第七十六批起有列表，这个开关就有落点了）
//   rewriteBookmarkType  → 把一个已被占用的助记键改贴到新书签时**不再询问**（见 bookmarkActions 的重写确认）
//   autoscrollToSource   → 面板里用键盘选中某条时是否跳到编辑器
//   autoscrollFromSource → 编辑器切换文件时面板是否滚到该文件的第一条书签
// 无落点：`showPreview`（本仓没有预览标签页）。
import { BOOKMARK_TYPE_ORDER } from './bookmarks.ts'
export interface BookmarksViewSettings {
  groupLineBookmarks: boolean
  askBeforeDeletingLists: boolean
  rewriteBookmarkType: boolean
  autoscrollToSource: boolean
  autoscrollFromSource: boolean
}

/** 与 IDEA `BookmarksViewState` 的默认值一致（`:23-29`）。 */
export const DEFAULT_BOOKMARKS_VIEW: BookmarksViewSettings = {
  groupLineBookmarks: true,
  askBeforeDeletingLists: true,
  rewriteBookmarkType: false,
  autoscrollToSource: false,
  autoscrollFromSource: false,
}

export interface BookmarkLike { path: string; line?: number; mnemonic?: string }

export interface BookmarkGroup<T extends BookmarkLike> { path: string; entries: T[] }

/**
 * `groupLineBookmarks` 开 = 按文件分组（顺序取该文件第一次出现的位置，组内按行号升序，
 * **文件书签排在该组最前** —— 上游给文件书签的行号就是 -1）；
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
  for (const bucket of groups) bucket.entries.sort((a, b) => (a.line ?? -1) - (b.line ?? -1))
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
    // 文件书签（没有行号）算在最前：切到该文件时它就是要滚到的那一条。
    if (!best || (entry.line ?? -1) < (best.line ?? -1)) best = entry
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

// ── 「按助记符」的行模型与过滤 ────────────────────────────────────────────────
// 上游那一棵树叫「转到助记符…」（`ShowTypeBookmarksAction`，动作名 `Go to Mnemonic…`，
// `platform/platform-resources-en/src/messages/ActionsBundle.properties:1332`；窗口标题同一个串
// `popup.title.type.bookmarks=Go to Mnemonic`，`platform/lang-api/resources/messages/BookmarkBundle.properties:63`；
// 键位 Ctrl+Shift+F11，`platform/platform-resources/src/keymaps/$default.xml:359-360`）。
// 它的行 = **每个已分配的助记键一行**，顺序是 `BookmarkType` 的枚举序（1..9、0、A..Z），
// 本体 `platform/bookmarks/src/com/intellij/ide/bookmark/actions/ShowTypeBookmarksAction.kt:38-39`：
//   `BookmarkType.values().mapNotNull { getBookmark(it)?.run { it to this } }.ifEmpty { null }`
// 一个助记键只对应**一条**书签（`getBookmark(type)` = `findInfo(type)?.bookmark`，
// `platform/bookmarks/src/com/intellij/ide/bookmark/BookmarksManagerImpl.kt:159-166`）；
// 整棵树在没有任何助记键时根本不打开（`:42` 的 `isEnabled = assignedTypes.isNotEmpty()`）。
// 「已被占用的键」那份集合是上游 `getAssignedTypes()`（同文件 `:168-170`，`Set` 且**排除 DEFAULT**），
// 选择器网格拿它给已占用的键上色（`BookmarkTypeChooser.kt:70`、`:219`）。

/** 一个助记键一行：`mnemonic` 是键本身，`entry` 是拿到它的那条书签（上游的一对）。 */
export interface BookmarkMnemonicRow<T extends BookmarkLike> { mnemonic: string; entry: T }

/** 已被占用的助记键（上游 `getAssignedTypes`，`BookmarksManagerImpl.kt:168-170`）：去重、按**枚举序**。 */
export function assignedMnemonics(entries: readonly BookmarkLike[]): string[] {
  const taken = new Set(entries.map(entry => entry.mnemonic).filter((key): key is string => key !== undefined))
  return BOOKMARK_TYPE_ORDER.filter(key => taken.has(key))
}

/**
 * 「转到助记符…」的行（上游 `ShowTypeBookmarksAction.kt:38-39`）：按 `BookmarkType` 枚举序，
 * 每个助记键取**第一条**持有它的书签，没有助记键的书签不进来。
 * 同一个函数也就是"按助记符过滤"：`rows.find(row => row.mnemonic === key)` 就是那个键的那一条。
 */
export function bookmarkMnemonicRows<T extends BookmarkLike>(entries: readonly T[]): BookmarkMnemonicRow<T>[] {
  const rows: BookmarkMnemonicRow<T>[] = []
  for (const mnemonic of BOOKMARK_TYPE_ORDER) {
    const entry = entries.find(item => item.mnemonic === mnemonic)
    if (entry !== undefined) rows.push({ mnemonic, entry })
  }
  return rows
}
