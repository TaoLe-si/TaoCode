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
