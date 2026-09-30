// 书签（表 + 视图设置）patch 的形状校验 —— 从 src/bridge.ts 抽出来的一域。
//
// 抽出来的原因和 `src/base64.ts` / `src/gradleEvents.ts` 一样：桥接文件贴着机检上限，
// 而这段纯校验既不需要 Vue 也不需要桥，正好可以单独测。两个入口各管一段：
//   · `normalizeBookmarks` —— `{path, line, mnemonic?, text?, description?}`，为 nil 时抛错；
//   · `normalizeBookmarksView` —— 书签工具窗口的四个布尔开关。
// 抛的是普通的 `Error`：调用方（bridge）把它翻成自己的 `BridgeError`，这个模块不该反向依赖桥。
import { BOOKMARK_MNEMONICS, type Bookmark } from './bookmarks.ts'
import type { BookmarksViewState } from './settingsModel.ts'

const MAX_FIELD = 4096

/** 书签表：行号从 1 开始，助记键是单个 0-9/A-Z，文本字段有长度上限。 */
export function normalizeBookmarks(value: unknown): Bookmark[] {
  const list = value as Bookmark[]
  const malformed = !Array.isArray(list) || list.length > 200 || list.some(entry =>
    !entry || typeof entry.path !== 'string' || !entry.path || entry.path.startsWith('/') || entry.path.includes('\\') || entry.path.includes('..')
    // `line` 缺省 = 文件书签（上游持久化不写 line 属性）；写了就必须是 1..1000000。
    || (entry.line !== undefined && (!Number.isInteger(entry.line) || entry.line < 1 || entry.line > 1000000))
    || (entry.mnemonic !== undefined && (typeof entry.mnemonic !== 'string' || !BOOKMARK_MNEMONICS.includes(entry.mnemonic)))
    || (entry.description !== undefined && (typeof entry.description !== 'string' || entry.description.length > MAX_FIELD))
    || (entry.text !== undefined && (typeof entry.text !== 'string' || entry.text.length > MAX_FIELD)))
  if (malformed) throw new Error('书签要写成 {path, line?, mnemonic?, text?, description?}：行号（有就是 1 起）或省掉表示文件书签，助记键是单个 0-9/A-Z 字符。')
  return list.map(entry => ({ ...entry }))
}

/** 命名书签列表（上游 `ManagerState.groups`）：名字非空且不重复、最多一个默认、书签走同一条校验。 */
export function normalizeBookmarkLists(value: unknown): { name: string; isDefault: boolean; bookmarks: Bookmark[] }[] {
  if (!Array.isArray(value) || value.length > 20) throw new Error('书签列表要写成数组，最多 20 张。')
  const names = new Set<string>()
  let defaults = 0
  return value.map(entry => {
    const list = entry as { name?: unknown; isDefault?: unknown; bookmarks?: unknown }
    if (!list || typeof list !== 'object' || typeof list.name !== 'string' || !list.name.trim() || list.name.length > 128)
      throw new Error('书签列表要写成 {name, isDefault, bookmarks}：名字非空且不超过 128 个字符。')
    if (list.name !== list.name.trim()) throw new Error('书签列表名首尾不能有空白：' + list.name)
    if (names.has(list.name)) throw new Error('书签列表名不能重复：' + list.name)
    names.add(list.name)
    if (typeof list.isDefault !== 'boolean') throw new Error('书签列表的 isDefault 必须是布尔值。')
    if (list.isDefault && ++defaults > 1) throw new Error('只能有一个默认书签列表。')
    return { name: list.name, isDefault: list.isDefault, bookmarks: normalizeBookmarks(list.bookmarks) }
  })
}

/** 书签工具窗口视图状态：只认有落点的四个布尔开关（见 src/bookmarksView.ts 的清单）。 */
export function normalizeBookmarksView(value: unknown): Partial<BookmarksViewState> {
  const view = value as Record<string, unknown>
  const keys = ['groupLineBookmarks', 'rewriteBookmarkType', 'autoscrollToSource', 'autoscrollFromSource']
  const malformed = !view || typeof view !== 'object' || Array.isArray(view)
    || Object.keys(view).some(key => !keys.includes(key))
    || Object.entries(view).some(([, flag]) => typeof flag !== 'boolean')
  if (malformed) throw new Error('书签视图设置要写成 {groupLineBookmarks, rewriteBookmarkType, autoscrollToSource, autoscrollFromSource} 四个布尔值。')
  return view as Partial<BookmarksViewState>
}
