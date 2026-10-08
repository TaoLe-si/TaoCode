// 变更列表一节的**面板侧状态**（从 `SourceControl.vue` 拆出 —— 那个文件贴着机检上限）。
//
// 纯模型在 `src/changeLists.ts`（列表增删改、归属、删除语义、持久化），本模块只做三件事：
//   · 把模型与当前 git 变更表接起来（每个列表里有几条变更、当前列表里的变更）；
//   · 持有"当前选中的列表"这一个 ref，并在它变化时切活动列表；
//   · 把「新建/重命名/删除/移动」四个动作接上对话框与确认框。
//
// 上游对应物：`ChangeListManager` 的 `getChangeLists` / `setDefaultChangeList` /
// `addChangeList` / `editName` / `removeChangeList` / `moveChangesTo`
// （`platform/vcs-impl/src/com/intellij/openapi/vcs/changes/ChangeListManagerImpl.kt:841-907`），
// 删除语义在 `actions/RemoveChangeListAction.kt:55-141`（非空要确认、删活动列表要换活动列表、
// 删光要新建默认列表）。文案取 `VcsBundle.properties:274-283`。
import { computed, ref, watch, type ComputedRef, type Ref } from 'vue'
import type { GitChange } from './vcsLogTypes.ts'
import {
  DEFAULT_CHANGE_LIST_NAME, EDIT_CHANGE_LIST_TITLE, NEW_CHANGE_LIST_TITLE, REMOVE_CHANGE_LIST_TITLE,
  addList, canRemoveList, changesInList, countInList, createChangeListsState, currentList, listById,
  moveChanges, readChangeLists, removeAllListsQuestion, removeList, removeListQuestion, removeListsQuestion,
  renameList, setComment, setCurrentList, writeChangeLists,
  type ChangeList, type ChangeListsState,
} from './changeLists.ts'

export interface ChangeListsDeps {
  /** 当前工作区根（存档按它分键）。 */
  root: () => string
  /** 当前 git 变更表（归属与计数都要读它）。 */
  changes: () => readonly GitChange[]
  /** 一句话结果/失败提示。 */
  notify: (message: string, error?: boolean) => void
  /** 移动变更之后刷新变更表（本仓的归属是纯前端，通常不需要；留给将来）。 */
  onChanged?: () => void | Promise<void>
  /**
   * 取一个名字/说明（上游是 `NewChangelistDialog` / `EditChangelistDialog`）。本仓没有通用输入
   * 对话框，`window.prompt` 是最接近的取法（与 `src/welcomeProjectGroups.ts:204` 同一做法）；
   * 注入是为了单测能桩掉，默认就是 `window.prompt`。
   */
  prompt?: (question: string, initial: string) => string | null
  /** 确认框（删除非空列表 / 删光时用）；默认 `window.confirm`。 */
  confirm?: (question: string) => boolean
}

export interface ChangeListsSection {
  /** 模型状态（列表 + 活动列表 + 归属）。 */
  state: Ref<ChangeListsState>
  /** 界面上选中的那一行（默认 = 活动列表）。 */
  selected: Ref<string>
  /** 列表 + 每个列表里的变更数（选择器渲染用）。 */
  rows: ComputedRef<{ list: ChangeList; count: number }[]>
  /** 当前列表（活动列表）。 */
  active: ComputedRef<ChangeList | undefined>
  /** 当前列表里的变更（变更树按它过滤）。 */
  visible: ComputedRef<GitChange[]>
  /** 一条变更属于哪个列表（右键菜单显示"移到…"时用）。 */
  listIdOf: (path: string) => string
  /** 选中一个列表（同时切活动列表，上游 `setDefaultChangeList`）。 */
  select: (id: string) => void
  /** 新建（`AddChangeListAction`：名字 + 说明 + 可选"设为活动"）。 */
  create: (name: string, comment?: string, activate?: boolean) => boolean
  /** 重命名（`RenameChangeListAction` → `editName`）。 */
  rename: (id: string, name: string) => boolean
  /** 改说明（`editComment`）。 */
  describe: (id: string, comment: string) => void
  /** 删除（含上游那三档确认；被删列表非空要确认，删光要新建默认列表）。 */
  remove: (id: string) => boolean
  /** 把若干路径移到某列表（`moveChangesTo`）。 */
  moveTo: (paths: readonly string[], listId: string) => void
  /** 「新建变更列表…」：问名字与说明，建好（可选设为活动）。 */
  createInteractive: () => boolean
  /** 「重命名…」：问新名字。 */
  renameInteractive: (id: string) => boolean
  /** 「移到其他列表…」：问目标列表（按名字选，与上游对话框同一取法）。 */
  moveInteractive: (paths: readonly string[]) => boolean
  /** 换工作区时重读存档。 */
  reload: () => void
}

export function createChangeListsSection(deps: ChangeListsDeps): ChangeListsSection {
  const storage = typeof localStorage === 'undefined' ? null : localStorage
  const ask = deps.prompt ?? ((question: string, initial: string) => window.prompt(question, initial))
  const confirm = deps.confirm ?? ((question: string) => window.confirm(question))
  const state = ref<ChangeListsState>(readChangeLists(storage, deps.root()))
  const selected = ref(currentList(state.value)?.id ?? '')
  const active = computed(() => currentList(state.value))
  const rows = computed(() => state.value.lists.map(list => ({ list, count: countInList(state.value, list.id, deps.changes()) })))
  const visible = computed(() => changesInList(state.value, selected.value, deps.changes()))
  /** 选中行与活动列表必须一致（上游"选中的列表就是活动列表"）。 */
  watch(selected, id => { if (listById(state.value, id)) state.value = setCurrentList(state.value, id) })
  // 每次模型变化都落盘（列表增删改、归属移动、换活动列表都在这里收口）。
  watch(state, value => writeChangeLists(storage, deps.root(), value), { deep: true })
  /** 换工作区：重读存档（与面板那几格同一个时机）。 */
  function reload() {
    state.value = readChangeLists(storage, deps.root())
    selected.value = currentList(state.value)?.id ?? ''
  }
  /** 名字 + 说明两个输入（上游 `NewChangelistDialog` 的两格）。 */
  function askNewName(title: string, initial: string): { name: string; comment: string } | null {
    const name = ask(title, initial)?.trim()
    if (!name) return null
    const comment = ask(`${title}：说明（可留空）`, '')?.trim() ?? ''
    return { name, comment }
  }
  /** 删除（含上游那三档确认）；单独抽出来供 `remove` 与将来批量删除共用。 */
  function removeOne(id: string): boolean {
    const list = listById(state.value, id)
    if (!list) return false
    // 上游 `canRemoveChangeLists`（`RemoveChangeListAction.kt:46-53`）：只读列表不许删。
    if (!canRemoveList(state.value, id)) { deps.notify(`「${list.name}」是只读列表，不能删除。`, true); return false }
    const moved = countInList(state.value, id, deps.changes())
    const last = state.value.lists.length === 1
    // 上游那三档确认（`:86-141`）：删光 / 非空 / 空列表不弹。
    if (last) { if (!confirm(removeAllListsQuestion(1))) return false }
    else if (moved > 0 && !confirm(removeListQuestion(list, moved))) return false
    const outcome = removeList(state.value, id)
    state.value = outcome.state
    selected.value = outcome.newCurrent
    if (outcome.moved > 0) deps.notify(`已删除「${list.name}」，${outcome.moved} 处变更移到活动列表。`)
    return true
  }
  /** 新建（`addChangeList`）；名字空/重名回 false 并提示。 */
  function createOne(name: string, comment = '', activate = false): boolean {
    const result = addList(state.value, name, comment, activate)
    if (!result) { deps.notify(`变更列表「${name.trim()}」已存在或名字为空。`, true); return false }
    state.value = result.state
    if (activate) selected.value = result.list.id
    return true
  }
  /** 改名（`editName`）；空名/重名回 false 并提示。 */
  function renameOne(id: string, name: string): boolean {
    const next = renameList(state.value, id, name)
    if (!next) { deps.notify(`改名失败：「${name.trim()}」为空或与别的列表重名。`, true); return false }
    state.value = next
    return true
  }
  /** 搬变更（`moveChangesTo`）。 */
  function moveOne(paths: readonly string[], listId: string): void {
    const list = listById(state.value, listId)
    if (!list || !paths.length) return
    state.value = moveChanges(state.value, paths, listId)
    deps.notify(`已把 ${paths.length} 个变更移到「${list.name}」。`)
    void deps.onChanged?.()
  }
  return {
    state, selected, rows, active, visible,
    listIdOf: path => {
      const assigned = state.value.assignments[path]
      return assigned && listById(state.value, assigned) ? assigned : active.value?.id ?? state.value.current
    },
    select: id => { selected.value = id },
    create: createOne,
    rename: renameOne,
    describe: (id, comment) => { state.value = setComment(state.value, id, comment) },
    remove: removeOne,
    createInteractive: () => {
      const answer = askNewName(NEW_CHANGE_LIST_TITLE, '')
      if (!answer) return false
      return createOne(answer.name, answer.comment, true)
    },
    renameInteractive: (id) => {
      const list = listById(state.value, id)
      if (!list) return false
      const name = ask(EDIT_CHANGE_LIST_TITLE, list.name)?.trim()
      if (!name || name === list.name) return false
      return renameOne(id, name)
    },
    moveInteractive: (paths) => {
      if (!paths.length) return false
      const targets = state.value.lists.filter(list => list.id !== selected.value)
      if (!targets.length) { deps.notify('只有一个变更列表，先新建一个再移动。', true); return false }
      const answer = ask(`移到哪个变更列表？（${targets.map(list => list.name).join(' / ')}）`, targets[0]!.name)?.trim()
      if (!answer) return false
      const target = targets.find(list => list.name === answer)
      if (!target) { deps.notify(`没有名为「${answer}」的变更列表。`, true); return false }
      moveOne(paths, target.id)
      return true
    },
    moveTo: moveOne,
    reload,
  }
}

/** 一次性删多个列表时的确认（`RemoveChangeListAction.kt:133-141`）；本仓逐条删，故只留常量出口。 */
export function confirmRemoveLists(lists: readonly ChangeList[], askConfirm: (q: string) => boolean = q => window.confirm(q)): boolean {
  if (lists.length <= 1) return true
  return askConfirm(removeListsQuestion(lists.length))
}

// 名字常量再导出，让面板不必同时 import 两个模块（文案真源仍在 src/changeLists.ts）。
export { DEFAULT_CHANGE_LIST_NAME, EDIT_CHANGE_LIST_TITLE, NEW_CHANGE_LIST_TITLE, REMOVE_CHANGE_LIST_TITLE }
export type { ChangeList }
export { createChangeListsState }