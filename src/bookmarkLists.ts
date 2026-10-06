// 命名书签列表（上游 `BookmarkGroup` / `GroupState`）—— 纯列表代数，零 Vue、零桥。
//
// 上游模型（`platform/bookmarks/src/com/intellij/ide/bookmark/state.kt:8-20`）：
//   `ManagerState.groups: List<GroupState>`，`GroupState { name, isDefault, bookmarks: List<BookmarkState> }`
// —— 书签属于**列表**，其中一个列表是"默认列表"（新书签自动进它）。
// 规则逐条取自 `BookmarksManagerImpl`：
//   · 默认列表只有一个：`Group.isDefault` 的 setter 会同时清掉旧的那一个（`:529-533`），
//     删掉默认列表后**没有**默认（`Group.remove:638-647` 的 `if (isDefault) defaultGroup = null`）；
//   · 新书签（还不知道属于谁）进默认列表（`findGroupsToAdd:200-207` 的 `info == null -> defaultGroup`）；
//   · **行书签只属于一个列表**（`findGroupsToAdd` 对 `LineBookmark` 返回 null = 没有别的可加）；
//     文件书签可以同时在多个列表里（同一处的 `else -> allGroups.filter { ... }`）；
//   · 列表名的校验：去空白后非空、且不与**别的**列表重名（`GroupInputValidator.getErrorText:19-25`，
//     编辑中的那个列表自己不算重名）；名字被占时 `findValidName:27-35` 依次试 `名字 (1)`…`(99)`；
//   · 没有历史状态时先建一个用**项目名**当名字的列表（`noStateLoaded:93-95` 的
//     `addOrReuseGroup(project.name)`）。
// 本仓的持久化把默认列表放在历史字段 `bookmarks` 上，其余列表放 `bookmarkLists`（见 bookmarkSettings.ts）——
// 读的时候按 `isDefault` 认默认列表，两边合成同一个 `BookmarkList[]`。
import type { Bookmark } from './bookmarks.ts'
import { isFileBookmark } from './bookmarks.ts'

export interface BookmarkList {
  name: string
  isDefault: boolean
  bookmarks: Bookmark[]
}

/** 列表名错误（`GroupInputValidator.getErrorText`）：空/空白返回空串 = "还没输入"，重名返回提示文案。 */
export function listNameError(name: string, lists: readonly BookmarkList[], editing?: BookmarkList): string {
  const trimmed = name.trim()
  if (!trimmed) return ''
  const taken = lists.some(list => list !== editing && list.name === trimmed)
  return taken ? '名称已存在' : ''
}

/** 没被占用的名字（同名时依次试 `名字 (1)`…`(99)`，`findValidName:27-35`）。 */
export function freeListName(name: string, lists: readonly BookmarkList[]): string {
  const initial = name.trim()
  if (!listNameError(initial, lists)) return initial
  for (let index = 1; index <= 99; index++) {
    const candidate = `${initial} (${index})`
    if (!listNameError(candidate, lists)) return candidate
  }
  return initial
}

/** 建一个列表（`dialog.group.create.title` 那条路）。`asDefault` = 对话框里的「用作默认列表」。 */
export function createList(lists: readonly BookmarkList[], name: string, asDefault: boolean): BookmarkList[] {
  const created: BookmarkList = { name: name.trim(), isDefault: false, bookmarks: [] }
  const next = [...lists, created]
  return asDefault ? setDefaultList(next, created) : next
}

/** 重命名（名字本身与默认标记无关）。 */
export function renameList(lists: readonly BookmarkList[], target: BookmarkList, name: string): BookmarkList[] {
  return lists.map(list => (list === target ? { ...list, name: name.trim() } : list))
}

/**
 * 删列表：它里面的书签跟着消失，**如果它本来是默认列表，删完就没有默认列表** ——
 * 上游 `Group.remove:638-647`（`if (isDefault) defaultGroup = null`），不会自动指认下一个。
 */
export function deleteList(lists: readonly BookmarkList[], target: BookmarkList): BookmarkList[] {
  return lists.filter(list => list !== target)
}

/** 把一个列表标为默认（同时清掉旧的默认标记：上游 setter `:529-533`）。 */
export function setDefaultList(lists: readonly BookmarkList[], target: BookmarkList): BookmarkList[] {
  return lists.map(list => ({ ...list, isDefault: list === target }))
}

/** 「将列表取消标记为默认」/「用作默认列表」那一下的开关（上游 `ToggleDefaultGroupAction`）。 */
export function toggleDefaultList(lists: readonly BookmarkList[], target: BookmarkList): BookmarkList[] {
  return target.isDefault ? lists.map(list => ({ ...list, isDefault: false })) : setDefaultList(lists, target)
}

export const defaultListOf = (lists: readonly BookmarkList[]): BookmarkList | undefined => lists.find(list => list.isDefault)

/**
 * 一条书签该加到哪个列表（上游 `chooseGroupToAdd` 的候选规则）：行书签**只能有一个家**，
 * 已经在某个列表里就回它自己，否则进默认列表（没有默认列表时给第一张列表，都没有就给 undefined
 * —— 调用方此时该弹「创建书签列表」）。
 */
export function listForBookmark(lists: readonly BookmarkList[], entry: Bookmark): BookmarkList | undefined {
  const owners = lists.filter(list => list.bookmarks.some(item => item.path === entry.path && item.line === entry.line))
  if (!isFileBookmark(entry) && owners.length) return owners[0]
  return defaultListOf(lists) ?? lists[0]
}

/** 把一条书签加进某个列表（行书签先从别的列表摘掉：它只能有一个家）。 */
export function addToListItem(lists: readonly BookmarkList[], target: BookmarkList, entry: Bookmark): BookmarkList[] {
  const filterOthers = (list: BookmarkList) => (isFileBookmark(entry) || list === target)
    ? list
    : { ...list, bookmarks: list.bookmarks.filter(item => !(item.path === entry.path && item.line === entry.line)) }
  return lists.map(list => {
    const cleaned = filterOthers(list)
    if (list !== target) return cleaned
    const exists = cleaned.bookmarks.some(item => item.path === entry.path && item.line === entry.line)
    return exists ? cleaned : { ...cleaned, bookmarks: [...cleaned.bookmarks, entry] }
  })
}

/**
 * 旧状态迁移：历史字段 `bookmarks` 是**一个平铺列表**，它成为默认列表
 * （没有历史状态时名字取项目名，`noStateLoaded:93-95`）。
 */
export function listsFromLegacy(bookmarks: readonly Bookmark[], projectName: string): BookmarkList[] {
  return [{ name: projectName, isDefault: true, bookmarks: [...bookmarks] }]
}

// ── "这一条书签属于哪张列表"：面板那一行的移除/编辑描述要找的目标 ──────────────
// 上游的口径（本轮逐条读过）：
//   · `getGroups(bookmark)` = `allGroups.filter(info.groups::contains)`
//     （`BookmarksManagerImpl.kt:146-148`）—— 顺序就是**列表登记的顺序**；
//   · 树上的「移除」删的是**被点那一段所在列表**里的那一条
//     （`ui/tree/BookmarkListProvider.kt:54-57` 的 `node.value?.let { node.bookmarkGroup?.remove(it) }`；
//     `Group.remove(bookmark)` = `removeFromGroup(this, bookmark)`，`BookmarksManagerImpl.kt:636`）；
//   · `BookmarksManagerImpl.remove(bookmark)`（`:230-238`）只处理"恰好一张列表持有"那一种，
//     多张持有时是上游自己留着的一句 `//TODO:choose`（什么都不做）；
//   · 「编辑描述」写的也是**一张列表**：`EditBookmarkAction.kt:27` 取 `getGroups(bookmark).firstOrNull()`，
//     `:36` 调 `group.setDescription`；描述记在 `InGroupInfo` 上
//     （`BookmarksManagerImpl.kt:598-609` 的 `group.add(bookmark, type, description)`、
//     `setDescription:586-594`）—— 同一处书签在不同列表里**可以有不同的描述**。

/** 这张列表里有没有这条书签（同一份对象，或路径 + 行号一致）。 */
export function listHolds(list: BookmarkList, entry: Bookmark): boolean {
  return list.bookmarks.some(item => item === entry || (item.path === entry.path && item.line === entry.line))
}

/** 持有这条书签的列表，按传入顺序（上游 `getGroups(bookmark)` 的那个顺序）。 */
export function listsHolding(lists: readonly BookmarkList[], entry: Bookmark): BookmarkList[] {
  return lists.filter(list => listHolds(list, entry))
}

/** 第一张持有它的列表（上游 `getGroups(bookmark).firstOrNull()`，`EditBookmarkAction.kt:27`）。 */
export const firstListHolding = (lists: readonly BookmarkList[], entry: Bookmark): BookmarkList | undefined =>
  listsHolding(lists, entry)[0]

/** 从第一张持有它的列表里摘掉（没有列表持有 ⇒ 原样返回，调用方知道这次没落到列表上）。 */
export function removeFromFirstHolder(lists: readonly BookmarkList[], entry: Bookmark): { lists: BookmarkList[]; removed: boolean } {
  const holder = firstListHolding(lists, entry)
  if (holder === undefined) return { lists: [...lists], removed: false }
  return {
    lists: lists.map(list => list === holder
      ? { ...list, bookmarks: list.bookmarks.filter(item => !(item === entry || (item.path === entry.path && item.line === entry.line))) }
      : list),
    removed: true,
  }
}

/**
 * 改掉某张列表里那条书签的**描述**（上游 `setDescription` 只写被选中那一段的那份）。
 * 空串 = 清掉自定义描述，回到"用行原文"（`bookmarkDescription` 的另一支）。
 */
export function setDescriptionInList(lists: readonly BookmarkList[], target: BookmarkList, entry: Bookmark, description: string): BookmarkList[] {
  const trimmed = description.trim()
  return lists.map(list => list !== target ? list : {
    ...list,
    bookmarks: list.bookmarks.map(item => {
      if (!(item.path === entry.path && item.line === entry.line)) return item
      const next = { ...item }
      if (trimmed) next.description = description
      else delete next.description
      return next
    }),
  })
}

/** 面板的一段：段头名字 + 默认标记 + 这一段的书签（`BookmarksPanel.vue` 的 `PanelList` 形状）。 */
export interface BookmarkPanelSection { name: string; isDefault: boolean; entries: Bookmark[] }

/**
 * 面板的段：命名列表在前、**默认列表（历史字段那份）最后**，且整棵树只允许一段带「默认」标记
 * （`Group.isDefault` 的 setter 会顺手清掉旧默认，`BookmarksManagerImpl.kt:529-534`），
 * 而本仓"新书签进的那张默认列表"恒等于历史字段 `bookmarks`（`listsFromLegacy` 那条迁移规则）。
 * 所以存档里那张自带 `isDefault: true` 的命名列表在这里**照普通命名列表渲染**（标记摘掉、条目留着）：
 * 段还是要出现的，否则用户会看到"列表里的书签凭空少一张"。
 */
export function panelSections(lists: readonly BookmarkList[], defaultEntries: readonly Bookmark[], projectName: string): BookmarkPanelSection[] {
  return [
    ...lists.map(list => ({ name: list.name, isDefault: false, entries: list.bookmarks })),
    { name: projectName, isDefault: true, entries: [...defaultEntries] },
  ]
}
