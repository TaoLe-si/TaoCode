// 命名书签列表的**运行时**（上游 `BookmarksManagerImpl` 里 group 那一半）—— 模块级单例。
//
// 为什么是模块级而不是 ctx 注入：`toolViewContext` / `BookmarksPanel` 要直接用它，而宿主
// `App.vue` 贴着机检上限（2737），每多一个注入就要多一行。这里照 `notifyEditorContentChanged`
// 的先例（`src/bookmarkActions.ts` 顶部那条模块级钩子）：`createBookmarkActions` 建实例时
// 把依赖挂上（它手里正好有 `projectSettings` / `workspace` / `notify` 与默认列表的读写口）。
//
// 模型：**默认列表**仍是历史字段 `bookmarks`（一个平铺列表，名字取项目名 —— 迁移规则见
// `src/bookmarkLists.ts` 的 `listsFromLegacy`），本模块管**其余的**列表（`bookmarkLists` 字段）。
// 规则全部来自 `src/bookmarkLists.ts`（那边是纯函数、有单测）。
import { computed, ref, type Ref } from 'vue'
import { request } from './bridge'
import { errorMessage } from './errors'
import { addToListItem, createList, deleteList, listNameError, renameList, type BookmarkList } from './bookmarkLists.ts'
import { isFileBookmark, type Bookmark } from './bookmarks.ts'
import type { ProjectSettings, Workspace } from './bridge'

interface ListDeps {
  isDesktop: boolean
  settings: Ref<ProjectSettings>
  workspace: Ref<Workspace | null>
  notify: (message: string, error?: boolean) => void
  /** 默认列表当前的内容（历史字段那一份）。 */
  defaultEntries: () => Bookmark[]
  /** 把某条书签从默认列表里摘掉（行书签换家时用；文件书签不动）。 */
  removeFromDefault: (entry: Bookmark) => void
}

let deps: ListDeps | undefined
/** 命名列表（不含默认列表）。 */
const named = ref<BookmarkList[]>([])
/** 面板/对话框的状态：`create` / `rename` / `delete` / `select`（上游三个对话框合成一个组件）。 */
export const listDialog = ref<{ mode: 'create' | 'rename' | 'delete' | 'select'; name?: string; then?: (name: string) => void } | null>(null)

export function configureBookmarkLists(next: ListDeps) {
  deps = next
  named.value = next.settings.value.bookmarkLists ?? []
}

/** 设置从原生回来时同步一次（`useProjectSettings` 那条路）。 */
export function syncBookmarkLists(settings: ProjectSettings) {
  named.value = settings.bookmarkLists ?? []
}

/** 面板要的视图：命名列表在前、**默认列表最后**（IDEA 的树里默认列表带「默认」标记）。 */
export const panelLists = computed(() => [
  ...named.value.map(list => ({ name: list.name, isDefault: list.isDefault, entries: list.bookmarks })),
  { name: deps?.workspace.value?.name ?? '默认', isDefault: true, entries: deps?.defaultEntries() ?? [] },
])

/** 名字能不能用（上游 `GroupInputValidator`）：空/空白 = "还没输入"，重名给提示。 */
export function listNameIssue(name: string, editing?: string): string {
  const others = named.value.filter(list => list.name !== editing)
  return listNameError(name, others)
}

export const namedListNames = computed(() => named.value.map(list => list.name))

function persistLists() {
  if (!deps || !deps.isDesktop || !deps.workspace.value) return
  void request<{ settings: ProjectSettings }>('project.settings.update', { bookmarkLists: named.value })
    .then(result => { if (deps) deps.settings.value = result.settings })
    .catch(error => deps?.notify(`书签列表未能保存：${errorMessage(error)}`, true))
}

export function createNamedList(name: string) {
  named.value = createList(named.value, name, false)
  persistLists()
  deps?.notify(`已创建书签列表「${name.trim()}」`)
}

export function renameNamedList(name: string, next: string) {
  const target = named.value.find(list => list.name === name)
  if (!target) return
  named.value = renameList(named.value, target, next)
  persistLists()
}

export function deleteNamedList(name: string) {
  const target = named.value.find(list => list.name === name)
  if (!target) return
  named.value = deleteList(named.value, target)
  persistLists()
  deps?.notify(`已删除书签列表「${name}」`)
}

export function listEntriesOf(name: string): Bookmark[] {
  return named.value.find(list => list.name === name)?.bookmarks ?? []
}

/** 把一条书签加进某张命名列表（行书签只有一个家：先从默认列表摘掉，上游 `findGroupsToAdd:200-207`）。 */
export function addBookmarkToNamedList(name: string, entry: Bookmark) {
  const target = named.value.find(list => list.name === name)
  if (!target) return
  named.value = addToListItem(named.value, target, entry)
  if (!isFileBookmark(entry)) deps?.removeFromDefault(entry)
  persistLists()
  deps?.notify(`书签 ${entry.path}${entry.line === undefined ? '' : ':' + entry.line} 已加到列表「${name}」`)
}

/** 从命名列表里摘掉一条（行书签就没了；文件书签只从这张列表里消失）。 */
export function removeFromNamedList(name: string, entry: Bookmark) {
  const target = named.value.find(list => list.name === name)
  if (!target) return
  named.value = named.value.map(list => list === target
    ? { ...list, bookmarks: list.bookmarks.filter(item => !(item.path === entry.path && item.line === entry.line)) }
    : list)
  persistLists()
}

/**
 * 「书签打开的标签页…」这类需要先挑一张列表的动作（上游 `chooseGroupToAdd:209-222` 的捷径）：
 * 只有一张列表就直接用，一张都没有就先建（建完把名字交回来），否则弹选择框。
 */
export function runWithChosenList(then: (name: string) => void) {
  if (named.value.length === 0) { listDialog.value = { mode: 'create', then }; return }
  if (named.value.length === 1) { then(named.value[0].name); return }
  listDialog.value = { mode: 'select', then }
}

/** 标题栏那个「创建书签列表…」（上游 `BookmarksView.Create`）。 */
export function openCreateListDialog() {
  listDialog.value = { mode: 'create' }
}

/** 对话框确认后的统一落点：先建/改名，再把名字交给当时那个待办（如果有）。 */
export function finishListDialog(name: string) {
  const pending = listDialog.value
  listDialog.value = null
  if (!pending) return
  if (pending.mode === 'create' || pending.mode === 'select') {
    if (pending.mode === 'create') createNamedList(name)
    pending.then?.(name.trim())
    return
  }
  if (pending.mode === 'rename' && pending.name) renameNamedList(pending.name, name)
}

export function confirmDeleteList() {
  const pending = listDialog.value
  listDialog.value = null
  if (pending?.mode === 'delete' && pending.name) deleteNamedList(pending.name)
}
