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
 * `Bookmark.getBookmarkFont`（`Bookmark.java:95`）：**带助记键**的书签用粗体
 * （`BookmarkType.DEFAULT` 的是常规体）—— 列表/树上那一行因此一眼能认出"这条有编号"。
 * 本仓的等价物就是这个布尔：面板按它落一个 class（`src/components/BookmarksPanel.vue`），
 * 与"编号气泡在行尾"（`BookmarkItem.updateAccessoryView`）是同一条信息的两处呈现。
 */
export function bookmarkFontBold(entry: Bookmark): boolean {
  return entry.mnemonic !== undefined
}

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
 * 装订线书签图标的悬停文本 —— 逐条照上游 `GutterLineBookmarkRenderer.getTooltipText:56-72`：
 * `书签` + 「 助记键」（非 DEFAULT 才有）+ 「: 描述」（非空才有）+ 「 (键)」（该助记键真有键位才有）。
 * 键位文案取自同文件 `:78-92` 用的三条 bundle 串（中文包）：
 *   `bookmark.shortcut.to.toggle.and.jump` = 「{0} 以切换，{1} 以跳转到」
 *   `bookmark.shortcut.to.toggle` = 「{0} 以切换」 / `bookmark.shortcut.to.jump` = 「{0} 以跳转到」
 * 0-9 的键位来自 `keymaps/$default.xml:201-228`（Ctrl+Shift+N 切换 / Ctrl+N 跳转）；
 * **字母没有全局键**（GotoBookmarkA..Z 在键位表里没有条目），所以字母只报书签与描述。
 */
export function bookmarkGutterTooltip(entry: Bookmark): string {
  let text = '书签'
  const mnemonic = entry.mnemonic
  if (mnemonic !== undefined) text += ' ' + mnemonic
  const description = bookmarkDescription(entry)
  if (description) text += ': ' + description
  if (mnemonic !== undefined && mnemonic >= '0' && mnemonic <= '9')
    text += ` (Ctrl+Shift+${mnemonic} 以切换，Ctrl+${mnemonic} 以跳转到)`
  return text
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

/**
 * 排序口径（上游 `BookmarkManager.getValidBookmarks`，`BookmarkManager.java:140-150`）：
 *
 * ```
 * if (UISettings.getInstance().getSortBookmarks()) return ContainerUtil.sorted(answer)   // 按位置
 * else return ContainerUtil.sorted(answer, Comparator.comparingInt(b -> b.index))        // 按加入顺序
 * ```
 *
 * `UISettingsState.kt:249` `var sortBookmarks: Boolean by property(false)` ⇒ **默认 false**，
 * 也就是**默认按加入顺序**（`index` 是加入时的自增序号，`BookmarkManager.java:104-125`）。
 *
 * 本仓原先只有"按路径 + 行号"一种顺序（等于上游 `sortBookmarks = true` 那一支），
 * 所以默认行为与上游**不一致** —— 这一批补上"按加入顺序"并把默认改成上游的 false。
 *
 * 加入顺序从哪来：书签在项目设置里的**数组顺序**就是加入顺序（`placeBookmark` 追加、
 * 持久化原样写回），所以这里直接用输入数组的下标当 `index`。
 */
export function orderedBookmarks(list: readonly Bookmark[], sortByPosition: boolean): Bookmark[] {
  if (sortByPosition) return sortedBookmarks(list)
  return [...list]
}

/**
 * 「按类型和名称对书签进行排序」（上游 `SortGroupBookmarksAction` +
 * `BookmarksManagerImpl.Group.compare:661-668`）：先按**提供者权重降序**、权重相同再按
 * 提供者自己的比较器。本仓只有一种提供者（行/文件书签），权重相同 ⇒ 落到
 * "文件路径 + 行号"（`compare`），也就是 `sortedBookmarks`。
 *
 * 这个函数存在的意义是把"分组内排序"写成**可点的一次动作**（上游是组节点的右键动作），
 * 而不是让面板每次渲染都自动排 —— 上游的默认是**按加入顺序**，排序要用户主动触发。
 */
export function sortGroupBookmarks<T extends Bookmark>(entries: readonly T[]): T[] {
  return [...entries].sort(compare)
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
 * 可用的助记键，顺序照 `Bookmarks.Goto` 那个组里动作的**列出顺序**
 * （`platform/bookmarks/resources/intellij.platform.bookmarks.xml:82-117`：先 `GotoBookmark0`…`GotoBookmark9`，
 * 再 `GotoBookmarkA`…`GotoBookmarkZ`）—— 菜单里那 36 行「转到书签 {0}」就按它排。
 * 注意与**枚举顺序**不同（见下面 `BOOKMARK_TYPE_ORDER`）。
 */
export const BOOKMARK_MNEMONICS: readonly string[] = [
  ...'0123456789', ...'ABCDEFGHIJKLMNOPQRSTUVWXYZ',
]

/**
 * `BookmarkType` 的**枚举顺序**（`platform/lang-api/src/com/intellij/ide/bookmark/BookmarkType.kt:19-31`：
 * `DIGIT_1`…`DIGIT_9`、`DIGIT_0`、`LETTER_A`…`LETTER_Z`、`DEFAULT`）——
 * 上游凡"遍历所有助记键"的地方走的都是这个顺序：
 *   · `ShowTypeBookmarksAction.kt:39` 的 `BookmarkType.values().mapNotNull { getBookmark(it) }`（「转到助记符…」那棵树），
 *   · `BookmarkTypeChooser.kt:171-173` 与 `:181-183` 的两块网格（`values().filter { isDigit() }` /
 *     `filter { isLetter() }`，栏内保持枚举序）。
 * 所以**数字栏里 `1..9` 在前、`0` 在最后**，与上面那份菜单序不是同一个东西；两处都用同一个数组会必错一处。
 * `DEFAULT`（无助记键）不进这张表 —— 上游那两个消费者都跳过它（`:39` 的 `getBookmark(DEFAULT)`
 * 走 `findInfo` 的 `BookmarkType.DEFAULT -> null` 那一支，`BookmarksManagerImpl.kt:163-166`）。
 */
export const BOOKMARK_TYPE_ORDER: readonly string[] = [
  ...'1234567890', ...'ABCDEFGHIJKLMNOPQRSTUVWXYZ',
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

/**
 * 项目级的「下一个 / 上一个书签」（上游 `GotoNextBookmark` / `GotoPreviousBookmark`）。
 *
 * **只走行书签**：上游那两个动作的显示名就叫 "Next Line Bookmark" / "Previous Line Bookmark"
 * （`platform/platform-resources-en/src/messages/ActionsBundle.properties:1333-1334`），
 * 实现里那句 `filterIsInstance<LineBookmark>()` 在
 * `platform/bookmarks/src/com/intellij/ide/bookmark/actions/NextBookmarkService.kt:47`，
 * 比的就是"排序后拿下一个"的那张表 —— **文件书签不在这个循环里**（它的跳转走助记键或面板点击，
 * `BookmarkOccurrence.kt:18` 的 `nextFileBookmark()` 是另一条路）。
 * 循环顺序 = 路径字典序 + 行号升序（同文件 `:59-64` 的 `compare`），走完一圈回绕：
 * 上游的回绕开关是注册表 `ide.bookmark.occurrence.cyclic.iteration.allowed`，**默认 false**
 * （`BookmarkOccurrence.kt:57-58`，走到头就 `isEnabled = false`）。本仓保留回绕是既有判据
 * （`tests/bookmarks.test.mjs` 那两条 `wraps`），改动它要主代理点头，本轮只把这条差异写明。
 */
export function nextBookmark(list: readonly Bookmark[], path: string, line: number, reverse: boolean): Bookmark | undefined {
  const all = sortedBookmarks(list.filter(entry => entry.line !== undefined))
  if (!all.length) return undefined
  const cursor = { path, line }
  const later = all.filter(entry => compare(entry, cursor) > 0)
  const earlier = all.filter(entry => compare(entry, cursor) < 0)
  return reverse ? (earlier[earlier.length - 1] ?? all[all.length - 1]) : (later[0] ?? all[0])
}

/**
 * 编辑器内的「下一个 / 上一个行书签」（上游 `GotoNextBookmarkInEditor` / `GotoPreviousBookmarkInEditor`，
 * `platform/bookmarks/resources/intellij.platform.bookmarks.xml:74-79`；
 * 显示名 "Next Line Bookmark in Editor" / "Previous Line Bookmark in Editor"，
 * `platform/platform-resources-en/src/messages/ActionsBundle.properties:1335-1336`；
 * **默认键位表里没有这两个动作** —— 别给它们编快捷键）。
 *
 * 本体在 `platform/bookmarks/src/com/intellij/ide/bookmark/actions/NextBookmarkInEditor.kt:32-59`，
 * 与项目级那一条的三个差别都照搬：
 *   ① 只看**当前文件**的行书签（`:36` 的 `it.file == file` + 只收 `LineBookmark`）；
 *   ② 前进按行号升序取第一条 `line > 光标行`、后退按降序取第一条 `line < 光标行`（`:39-52`），
 *      **光标正好停在书签行上不算**（比较是严格大于/小于）；
 *   ③ 到头了默认**不回绕**（`:53-56` 那一段在 `BookmarkOccurrence.cyclic` 里，而它默认 false，
 *      `BookmarkOccurrence.kt:57-58`）；回绕时绕回来的那一条若正好是光标行也不动（`:55`）。
 * 找不到就返回 `undefined` —— 上游据此把动作置灰（`isEnabledForCaret`，`:22`）。
 *
 * 行号口径：本仓 `Bookmark.line` 与传进来的 `line` 都是 1 基（上游两个都是 0 基，同一条比较式）。
 */
export function nextLineBookmarkInFile(list: readonly Bookmark[], path: string, line: number, reverse: boolean,
                                       cyclic = false): Bookmark | undefined {
  const own = list
    .filter(entry => entry.path === path && entry.line !== undefined)
    .sort((a, b) => (reverse ? (b.line as number) - (a.line as number) : (a.line as number) - (b.line as number)))
  for (const entry of own) {
    const at = entry.line as number
    if (reverse ? at < line : at > line) return entry
  }
  const wrap = own[0]
  return cyclic && wrap !== undefined && wrap.line !== line ? wrap : undefined
}

export function removeBookmark(list: readonly Bookmark[], entry: Bookmark): Bookmark[] {
  return list.filter(item => !(item.path === entry.path && item.line === entry.line))
}

/**
 * 列表项的**速度搜索文本** —— 上游 `BookmarkItem.speedSearchText()`（`BookmarkItem.java:104`）：
 * `bookmark.getFile().getName() + " " + bookmark.getDescription()`。
 * 面板在「就地输入」的速度搜索里拿它当匹配对象（`src/components/BookmarksPanel.vue`），
 * 匹配规则复用 `src/speedSearch.ts` 的 MinusculeMatcher（与文件树同一个入口）。
 * 描述为空时不留下尾随空格（上游字符串拼接会留一个，但匹配语义相同；这里照"文件名 + 描述"的语义取值）。
 */
export function bookmarkSpeedSearchText(entry: Bookmark): string {
  const name = entry.path.split('/').pop() ?? entry.path
  const description = bookmarkDescription(entry)
  return description ? `${name} ${description}` : name
}

/**
 * 这一条能不能从列表里移除 —— 上游 `BookmarkItem.allowedToRemove()`（`BookmarkItem.java:119`）
 * 恒为 true，`removed()`（`:123-125`）落到 `BookmarkManager.removeBookmark`。
 * 本仓的等价物是 `removeBookmark`（上面）；面板的移除按钮对每一行都可用，
 * 这个函数把"恒许可"写成可核对的判据（命名书签列表不改变单条的许可）。
 */
export const bookmarkRemovable = (): boolean => true

/**
 * 编辑器标签/项目树右键那一下带来的**选区文本** → 自定义描述。
 *
 * 上游 `ToggleBookmarkAction.addSingleBookmark:78-81`：
 * ```kotlin
 * val selectedText = event.getData(CommonDataKeys.EDITOR)?.selectionModel?.selectedText
 * if (!selectedText.isNullOrBlank()) manager.getGroups(bookmark).forEach { it.setDescription(bookmark, selectedText) }
 * ```
 * 两个要点照搬：① **空白与没有选区都不设**（`isNullOrBlank()`）；② 设的是**原文**，不 trim
 * （trim 只发生在"取描述来显示"那一步，见 `bookmarkDescription`）。
 * 与「行原文锚 `text`」是两个字段：锚每次编辑都对账，描述是放书签那一刻写一次的快照。
 */
export function bookmarkSelectionDescription(selectedText?: string | null): string | undefined {
  return selectedText !== undefined && selectedText !== null && selectedText.trim() !== '' ? selectedText : undefined
}

/**
 * 文件书签的开关（右键项目树 / **编辑器标签**那一下）。
 *
 * 上游 `EDITOR_TAB_POPUP` 那一支（`platform/bookmarks/src/com/intellij/ide/bookmark/actions/extensions.kt:57-61`）：
 * 标签页右键时上下文里**没有** `LOGICAL_LINE_AT_CURSOR` 可用，所以按的是"文件"这一档 ——
 * `place == ActionPlaces.EDITOR_TAB_POPUP || window?.id == PROJECT_VIEW` ⇒ `manager.createBookmark(file)`，
 * 拿到一条没有行号的 `FileBookmark`；随后 `ToggleBookmarkAction.actionPerformed` →
 * `addSingleBookmark`（`:72-82`）= `manager.toggle(bookmark, type)`（已存在就整条删掉、不存在就加）
 * ＋ 非空白选区成为描述。`update`（`:54-58`）在右键菜单里给的是「添加书签」/「删除书签」两种标题
 * （`bookmark.add.action.text` / `bookmark.delete.action.text`），对应本仓的 `fileBookmarkLabel`。
 *
 * @param selectedText 该标签编辑器里当前选中的文本（上游 `CommonDataKeys.EDITOR` 的 `selectedText`）；
 *                     空白/未提供 ⇒ 不设描述（只在**新增**那一支用到它，取消时整条删掉）。
 */
export function toggleFileBookmark(list: readonly Bookmark[], path: string, selectedText?: string | null): Bookmark[] {
  const existing = list.find(entry => entry.path === path && entry.line === undefined)
  if (existing !== undefined) return list.filter(entry => entry !== existing)
  return placeBookmark(list, path, undefined, undefined, undefined, bookmarkSelectionDescription(selectedText))
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
    // 丢掉时**原样**记下：上游那份文本是变更前从文档里实读的（`beforeDocumentChange:439-443`），
    // 不会是"没有锚"；本仓的 `text` 可能缺（历史状态），缺就让它缺着 —— 补一个空串会造出下面的假放回。
    if (text === undefined) nextDropped.push({ ...entry })
    else kept.push({ ...entry, text })
  }
  for (const entry of dropped) {
    // 文件书签（没有行号）不进"放回"这一支：它们从来不会因为行号越界被丢掉。
    if (entry.path !== path || entry.line === undefined) { nextDropped.push(entry); continue }
    // **没有锚就永远不放回**：上游比的是"删除前那一行的原文"（`moveToDeleted:530-538` 存的就是
    // `beforeDocumentChange` 那份 `BookmarkInfo.text`，`:506` 的 `bookmarkedText.equals(lineContent)`），
    // 本仓若把缺锚当成空串，书签就会在任意一个**空行**重新出现（空行 == 空串），那是假放回。
    if (entry.text === undefined) { nextDropped.push(entry); continue }
    // 空原文也认：上游那一句就是 `bookmarkedText.equals(lineContent)`（`:506`），没有"非空才算"的条件 ——
    // 空行上的书签删掉再撤销时，正是靠 '' == '' 放回去的。
    const matches = (line: number) => textAt(line) === entry.text
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

/**
 * 「按类型和名称对书签进行排序」的展示名（上游 `action.BookmarksView.SortGroupBookmarks.text`，
 * 中文包 `ActionsBundle.properties:76`）。动作本体是 `sortGroupBookmarks`。
 */
export const SORT_GROUP_LABEL = '按类型和名称对书签进行排序'
