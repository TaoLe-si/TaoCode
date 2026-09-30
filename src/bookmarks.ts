// IDEA keeps one project-wide bookmark list, and a mnemonic (0-9) can be held by only
// one entry, so Ctrl+<digit> always means "that bookmark". Pure list algebra: no Vue,
// so the toggle and walk rules are checkable without a DOM.
export interface Bookmark {
  path: string
  /**
   * 行号（1 基）。**没有这个字段 = 文件书签**（上游 `FileBookmark`：
   * `platform/lang-api/src/com/intellij/ide/bookmark/FileBookmark.kt`，
   * 由 `BookmarksManagerImpl.createBookmark(file)` 从项目树/编辑器标签右键产生，
   * 见 `actions/extensions.kt:58-72`；持久化时**不写 line 属性**——
   * `BookmarkManager.writeExternal:335-337` 只在线号 ≥ 0 时才写）。
   */
  line?: number
  /**
   * 助记键：单个字符 `0-9` 或 `A-Z`。上游 2026.2 把它建成 `BookmarkType` 枚举
   * （`platform/lang-api/src/com/intellij/ide/bookmark/BookmarkType.kt:24-45`：
   * DIGIT_1..DIGIT_0、LETTER_A..LETTER_Z、DEFAULT(无)，`get(mnemonic)`）；没有助记键的
   * 书签就是 `BookmarkType.DEFAULT`（枚举里 mnemonic 为 0 的那一项）——本仓用"字段不存在"表示。
   */
  mnemonic?: string
  /** 放书签时那一行的原文（上游 `BookmarkManager` 的 `myBeforeChangeData` 记的是同一个东西）。 */
  text?: string
  /**
   * **自定义**描述：选中一段文字再按 F11 时，那段的文本（上游 2026.2 的
   * `ToggleBookmarkAction.addSingleBookmark:88-93` —— `selectedText` 非空白就
   * `group.setDescription(bookmark, selectedText)`；持久化成 `<bookmark description>`，
   * `BookmarkManager.writeExternal:329-333`）。没设过时用行原文当描述（见 `bookmarkDescription`）。
   */
  description?: string
}

// 文件书签没有行号：按上游那条 `line = -1` 排在同文件的行书签**前面**。
const compare = (a: Bookmark, b: Bookmark) => a.path.localeCompare(b.path) || (a.line ?? -1) - (b.line ?? -1)

/** 文件书签（没有行号的那一种）。 */
export const isFileBookmark = (entry: Bookmark): boolean => entry.line === undefined

/**
 * 行书签的**自动描述**：书签树/列表那一行显示的文本。
 *
 * 上游（2026.2 的现代书签实现 `platform/bookmarks/src/com/intellij/ide/bookmark/`）：
 *   · `BookmarksManagerImpl.createDescription:129-136`：`LineBookmark` 取名下行文本，再 `trim()`；
 *   · `LineBookmarkProvider.kt:558-582` 的 `readLineText`：书签带 `expectedText` 就直接用它，
 *     否则从文档里取那一整行（越界返回 null）；
 *   · 渲染在 `ui/tree/LineNode.kt:20-31`：分组在文件下时是 `"$line: "`（灰）+ 描述（常规体）；
 *     没有描述就退回 `BookmarkNode.kt:72-77` 那一支（文件名 + ` :行号` + 位置）。
 *
 * 本仓的 `Bookmark.text` 就是那行原文的锚（放书签时记下、编辑后对账时刷新），所以描述直接取它；
 * 空白或缺失（旧数据）按"没有描述"处理。
 *
 * 注意行号：上游存的是 0 基、显示时 `+1`（`LineNode.kt:21`）；**本仓的 `Bookmark.line` 是 1 基**
 * （`placeBookmark` 收的是 `tab.line`，`reconcileBookmarks` 的 `textAt` 按 `lines[line - 1]` 取，
 * 持久化校验也要求 `line >= 1`）—— 显示时**不要再 +1**。
 */
export function bookmarkDescription(entry: Bookmark): string | undefined {
  // 上游的优先级：`BookmarkGroup.getDescription`（`BookmarksManagerImpl.kt:579-585`）先给自定义描述，
  // 没有才在首次需要时用 `createDescription`（行原文）算一个 —— 本仓就按这个顺序取。
  const custom = entry.description?.trim()
  if (custom) return entry.description
  const text = entry.text?.trim()
  return text ? text : undefined
}

/**
 * 行原文锚的长度上限（**字符**）。原生侧按 4 KiB 字节校验
 * （`native/settings_schema.cpp` 的 `max_bookmark_text`），1024 个字符在 UTF-8 下最多 4 KiB ——
 * 存（`bookmarkActions.placeAt`）与比（`reconcileBookmarks` 的 `textAt`）必须走同一个函数，
 * 否则超过上限的长行会出现"存进去的锚永远比不中当前行"的假失效。
 */
export const BOOKMARK_TEXT_LIMIT = 1024

/** 锚的规范化：去掉行首尾空白后按上限截断（两边唯一的锚构造口）。 */
export const bookmarkAnchor = (line: string): string => line.trim().slice(0, BOOKMARK_TEXT_LIMIT)

export function sortedBookmarks(list: readonly Bookmark[]): Bookmark[] {
  return [...list].sort(compare)
}

const withMnemonic = (entry: Bookmark, mnemonic?: string): Bookmark => {
  // 文件书签**不写 line 键**（上游持久化也只在行号 ≥ 0 时才写）—— 别把 `line: undefined` 物化出来。
  const next: Bookmark = entry.line === undefined ? { path: entry.path } : { path: entry.path, line: entry.line }
  if (mnemonic !== undefined) next.mnemonic = mnemonic
  if (entry.text !== undefined) next.text = entry.text
  if (entry.description !== undefined) next.description = entry.description
  return next
}

/**
 * Add, rename or clear the bookmark on `path:line`.
 * `mnemonic === undefined` is a plain F11 toggle; a digit behaves like Ctrl+F11 /
 * Ctrl+Shift+digit, i.e. it moves the digit to this line (freeing its old owner) and
 * removes the bookmark when the digit already sits here.
 */
export function placeBookmark(list: readonly Bookmark[], path: string, line: number | undefined, mnemonic?: string, text?: string,
                             description?: string, rewrite = true): Bookmark[] {
  const here = (entry: Bookmark) => entry.path === path && entry.line === line
  const existing = list.find(here)
  if (existing && (mnemonic === undefined || existing.mnemonic === mnemonic)) return list.filter(entry => !here(entry))
  // 助记键被别的书签占着：上游 `BookmarksManagerImpl.canRewriteType:262-283` 先问（`rewriteBookmarkType`
  // 打开时直接放行），同意之后 `rewriteType:285-295` 把老的那条**从所有分组里删掉**（行书签就是删除；
  // 非行书签才降级成 DEFAULT）—— 所以这里同样是"删掉旧主人"，不是"摘掉它的编号"。
  // `rewrite === false` = 用户在确认里选了取消：整件事作废（书签也不添加，与上游那条早退一致）。
  const squatted = mnemonic === undefined ? undefined : list.find(entry => entry.mnemonic === mnemonic)
  if (squatted !== undefined && !here(squatted) && !rewrite) return [...list]
  // 重写时老主人的下场分两种（上游 `rewriteType:285-295`）：行书签**整条删掉**，
  // 文件书签只降级成 DEFAULT（`info.changeType(BookmarkType.DEFAULT)`）—— 文件书签是
  // "给文件本身做的记号"，删掉它等于用户右键那一下白点了。`here(entry)` 那一条是"它自己"，
  // 换编号时不能把自己删掉。
  const freed = mnemonic === undefined
    ? [...list]
    : list.flatMap(entry => {
        if (entry.mnemonic !== mnemonic || here(entry)) return [entry]
        return entry.line === undefined ? [withoutMnemonic(entry)] : []
      })
  const extra = { ...(text === undefined ? {} : { text }), ...(description === undefined ? {} : { description }) }
  const anchored = line === undefined ? { path, ...extra } : { path, line, ...extra }
  return existing
    ? freed.map(entry => (here(entry) ? withMnemonic({ ...entry, ...extra }, mnemonic) : entry))
    : [...freed, withMnemonic(anchored, mnemonic)]
}

/**
 * 可用的助记键，顺序照 `BookmarkType.values()`：先 0-9（数字盘，`$default.xml` 174-197 给了
 * Ctrl+0..9 的跳转键），再 A-Z（**默认键位表里没有全局键** —— 只有书签树内的裸键
 * `extensions.kt:126-135` 与 `Bookmarks.Goto` 菜单里的「转到书签 {0}」行）。
 */
export const BOOKMARK_MNEMONICS: readonly string[] = [
  ...'0123456789', ...'ABCDEFGHIJKLMNOPQRSTUVWXYZ',
]

/** 是不是一个合法的助记键（单个 0-9 / A-Z 字符，大小写归一到大写）。 */
export function normalizeMnemonic(value: string): string | undefined {
  const upper = value.trim().toUpperCase()
  return BOOKMARK_MNEMONICS.includes(upper) ? upper : undefined
}

/** 去掉助记键（上游 `DeleteBookmarkTypeAction` → `setType(bookmark, DEFAULT)`），书签本身留着。 */
export const withoutMnemonic = (entry: Bookmark): Bookmark => withMnemonic(entry)

export function bookmarkOwner(list: readonly Bookmark[], mnemonic: string): Bookmark | undefined {
  return list.find(entry => entry.mnemonic === mnemonic)
}

/** The next/previous bookmark in document order, wrapping around the project. */
export function nextBookmark(list: readonly Bookmark[], path: string, line: number, reverse: boolean): Bookmark | undefined {
  const all = sortedBookmarks(list)
  if (!all.length) return undefined
  const cursor = { path, line }
  const later = all.filter(entry => compare(entry, cursor) > 0)
  const earlier = all.filter(entry => compare(entry, cursor) < 0)
  return reverse ? (earlier[earlier.length - 1] ?? all[all.length - 1]) : (later[0] ?? all[0])
}

export function removeBookmark(list: readonly Bookmark[], entry: Bookmark): Bookmark[] {
  return list.filter(item => !(item.path === entry.path && item.line === entry.line))
}

/** 文件书签的开关（右键项目树/编辑器标签那一下）。 */
export function toggleFileBookmark(list: readonly Bookmark[], path: string, description?: string): Bookmark[] {
  const existing = list.find(entry => entry.path === path && entry.line === undefined)
  if (existing !== undefined) return list.filter(entry => entry !== existing)
  return placeBookmark(list, path, undefined, undefined, undefined, description)
}

/**
 * 编辑后对账（上游 `BookmarkManager.beforeDocumentChange` + `documentChanged`，
 * `platform/bookmarks/src/com/intellij/ide/bookmarks/BookmarkManager.java:430-536`）：
 *   · 行号越界的书签**删掉**，但记下行号与那一行的原文（上游的 `myDeletedDocumentBookmarks`，`moveToDeleted:522-534`）；
 *   · 同一行号上原文又回来了（撤销、或"上移/下移语句"那种单行移动）就把书签**放回去**
 *     （`:536` 那一句 `bookmarkedText.equals(lineContent)`，单行移动的特例是 `line -= 2`，`:499-506`）；
 *   · 还留着的书签把原文刷成**当前**那一行（上游每次 beforeDocumentChange 都会重记一遍，
 *     所以"删掉再撤销"那次比的是删除前的原文）。
 * 上游靠 DocumentEvent 的片段判定单行移动；本仓没有那片片段信息，就照它的结论试 `line - 2`（`:504` 的 `line -= 2`）。
 */
export function reconcileBookmarks(
  list: readonly Bookmark[],
  path: string,
  content: string,
  dropped: readonly Bookmark[] = [],
): { list: Bookmark[]; dropped: Bookmark[] } {
  const lines = content.split('\n')
  const textAt = (line: number) => (line >= 1 && line <= lines.length ? bookmarkAnchor(lines[line - 1]) : undefined)
  const kept: Bookmark[] = []
  const nextDropped: Bookmark[] = []
  for (const entry of list) {
    // 文件书签没有行号，内容变更与它无关（上游 documentChanged 只动行书签）。
    if (entry.path !== path || entry.line === undefined) { kept.push(entry); continue }
    const text = textAt(entry.line)
    if (text === undefined) nextDropped.push({ ...entry, text: entry.text ?? '' })
    else kept.push({ ...entry, text })
  }
  for (const entry of dropped) {
    // 文件书签（没有行号）不进"放回"这一支：它们从来不会因为行号越界被丢掉。
    if (entry.path !== path || entry.line === undefined) { nextDropped.push(entry); continue }
    // 空原文也认：上游那一句就是 `bookmarkedText.equals(lineContent)`（`:536`），没有"非空才算"的条件 ——
    // 空行上的书签删掉再撤销时，正是靠 '' == '' 放回去的。
    const matches = (line: number) => entry.text !== undefined && textAt(line) === entry.text
    if (matches(entry.line)) kept.push({ ...entry, text: entry.text })
    else if (matches(entry.line - 2)) kept.push({ ...entry, line: entry.line - 2, text: entry.text })
    else nextDropped.push(entry)
  }
  // 查重（上游 `BookmarkManager.isDuplicate:517-530`）：同一行上只留一条，多出来的也丢进那张表。
  // 本仓会撞上的场合是"丢掉的那条回来时，这一行已经有了新书签"。
  const taken = new Set<string>()
  const unique: Bookmark[] = []
  for (const entry of kept) {
    const key = `${entry.path}\u0000${entry.line}`
    if (taken.has(key)) { nextDropped.push(entry); continue }
    taken.add(key)
    unique.push(entry)
  }
  unique.sort(compare)
  return { list: unique, dropped: nextDropped }
}
