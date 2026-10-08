// 多变更列表（changelist）模型 —— 上游 `ChangeListManager` / `ChangeList` / `LocalChangeList`
// 的等价物，用**本仓架构**还原。
//
// 上游形状（逐条核过）：
//   · `LocalChangeList`（`platform/vcs-api/shared/src/com/intellij/openapi/vcs/changes/LocalChangeList.java:20-68`）：
//     `getId()`（逻辑 id，**改名后不变**，`:34-37`）、`getName()`、`getComment()`、`isDefault()`
//     （`:43`）、`isReadOnly()`（`:45`）、`hasDefaultName()`（`:61-63`，默认名有三种写法，
//     见 `getAllDefaultNames()` `:24-28`）；默认列表名 = `VcsBundle.properties:274`
//     `changes.default.changelist.name` = `Changes`（老写法 `Default Changelist` / `Default`）；
//   · `ChangeListManager`（`platform/vcs-api/src/com/intellij/openapi/vcs/changes/ChangeListManager.java`）：
//     `getChangeLists()`（`:121`）、`getDefaultChangeList()`（`:133`，**新变更默认落这里**）、
//     `getChangeList(id)`（`:158`）、`getChangeLists(change)`（`:161`）、`getChangesIn(dir)`（`:192`）；
//   · 变更与增删改（`ChangeListManagerImpl.kt:841-907`）：`addChangeList(name, comment)`、
//     `removeChangeList(name)`、`setDefaultChangeList(list)`、`editName(from, to)`、
//     `editComment(name, comment)`、`moveChangesTo(list, changes)`；
//   · 删除语义（`actions/RemoveChangeListAction.kt:55-141`）：选中的是**活动**列表且删完没有别的列表
//     ⇒ 先确认"全部删除"，再**新建一个默认列表**（名字就是 `Changes`）设为活动，然后才删；
//     还有别的列表 ⇒ 让用户选新的活动列表；删的列表**非空** ⇒ 弹确认
//     （`changes.removechangelist.warning.text` = "Are you sure want to remove changelist ''{0}''?
//     \nAll changes will be moved to the active changelist."，`VcsBundle.properties:281`）——
//     即**列表里的变更被移到活动列表，不丢**；`isReadOnly()` 的列表不许删（`:46-53`）。
//     删除确认文案取 `:282-283`（多条 / 全部）。
//
// 本仓怎么还原（**没有**上游那套 `Change` 对象，也不改 git 的 index）：
//   · 上游的"变更属于哪个列表"是**内存/工程级**的归属关系，与 git 的暂存区无关（同一份 git
//     status 可以按列表分成好几堆）。本仓落成同一件事：一份 **路径 → 列表 id** 的归属表；
//     没有归属的路径属于**默认（活动）列表** —— 与上游 `getChangeList(file)` 对"新变更"的答案一致；
//   · 持久化到 localStorage，按工作区根分键 —— 与 `changesViewSettings.ts`
//     （`taocode.vcs.changesView.<root>`，对应上游 `WORKSPACE_FILE`）同一套口径：都跟着工程走；
//   · 读侧对坏存档一律退回缺省、绝不抛（与 `vcsLogFilterStore` / `changesViewSettings` 同一纪律）。
//
// 本模块零依赖（不 import bridge），能被 `node --test` 直接加载。

/** 默认列表名（`VcsBundle.properties:274` `changes.default.changelist.name`）。 */
export const DEFAULT_CHANGE_LIST_NAME = 'Changes'
/** 老默认名（`LocalChangeList.getAllDefaultNames()` `:24-28` 的另两种写法）。 */
export const LEGACY_DEFAULT_CHANGE_LIST_NAMES: readonly string[] = ['Default Changelist', 'Default']
/** 「新建变更列表」对话框标题（`VcsBundle.properties:278`）。 */
export const NEW_CHANGE_LIST_TITLE = '新建变更列表'
/** 「编辑变更列表」对话框标题（`:279`）。 */
export const EDIT_CHANGE_LIST_TITLE = '编辑变更列表'
/** 删除确认标题（`:283` `changes.removechangelist.warning.title`）。 */
export const REMOVE_CHANGE_LIST_TITLE = '删除变更列表'

/** 一个具名变更列表（上游 `LocalChangeList` 的可观察字段）。 */
export interface ChangeList {
  /** 逻辑 id：**改名后不变**（`LocalChangeList.getId()`，`:34-37`）。 */
  id: string
  name: string
  /** 说明（`getComment()`）。 */
  comment: string
  /** 是不是活动列表（新变更默认落这里，`getDefaultChangeList()` `:133`）。 */
  isDefault: boolean
  /** 只读列表不许删（`isReadOnly()` `:45` + `RemoveChangeListAction.kt:49`）。 */
  readOnly: boolean
}

/** 模型状态：列表 + 活动列表 + 路径归属表。 */
export interface ChangeListsState {
  lists: ChangeList[]
  /** 活动列表 id。 */
  current: string
  /** 路径（工作区相对）→ 列表 id。**没有条目 = 属于活动列表**。 */
  assignments: Record<string, string>
}

/** 生成一个列表 id（时间 + 序号，够用且可读；不引 crypto）。 */
let idSeed = 0
export function nextChangeListId(): string {
  idSeed += 1
  return `cl${Date.now().toString(36)}${idSeed.toString(36)}`
}

/** 上游 `LocalChangeList.hasDefaultName()`（`:61-63`）：三种默认写法。 */
export function hasDefaultName(name: string): boolean {
  return name === DEFAULT_CHANGE_LIST_NAME || LEGACY_DEFAULT_CHANGE_LIST_NAMES.includes(name)
}

/** 缺省状态：**一个**默认列表（名字 `Changes`），它就是活动列表。 */
export function createChangeListsState(): ChangeListsState {
  const id = nextChangeListId()
  return { lists: [{ id, name: DEFAULT_CHANGE_LIST_NAME, comment: '', isDefault: true, readOnly: false }], current: id, assignments: {} }
}

/** 活动列表（`getDefaultChangeList()`）；状态坏掉时回退到第一个列表。 */
export function currentList(state: ChangeListsState): ChangeList | undefined {
  return state.lists.find(list => list.id === state.current) ?? state.lists[0]
}

/** 按 id 找列表（`getChangeList(id)`）。 */
export function listById(state: ChangeListsState, id: string): ChangeList | undefined {
  return state.lists.find(list => list.id === id)
}

/**
 * 一条变更属于哪个列表（`getChangeList(change)` `:165`）：有归属按归属，没有 = 活动列表。
 * 归属指向一个已经不存在的列表（存档被手改过）时同样落回活动列表 —— 不能凭空丢变更。
 */
export function listIdOf(state: ChangeListsState, path: string): string {
  const assigned = state.assignments[path]
  if (assigned && listById(state, assigned)) return assigned
  return currentList(state)?.id ?? state.current
}

/** 某个列表里的变更（`getChangesIn` `:192`）：保持传入顺序（调用方已排好）。 */
export function changesInList<T extends { path: string }>(state: ChangeListsState, listId: string, changes: readonly T[]): T[] {
  return changes.filter(change => listIdOf(state, change.path) === listId)
}

/** 一个列表里的变更数（界面上那个计数）。 */
export function countInList(state: ChangeListsState, listId: string, changes: readonly { path: string }[]): number {
  return changesInList(state, listId, changes).length
}

/**
 * 新建列表（`addChangeList` `:843`）。名字去首尾空白；空名或重名返回 null（上游对话框也拦这两种）。
 * `activate` = 新建后设为活动列表（`AddChangeListAction.kt:22-24` 的 `isNewChangelistActive`）。
 */
export function addList(state: ChangeListsState, name: string, comment = '', activate = false): { state: ChangeListsState; list: ChangeList } | null {
  const trimmed = name.trim()
  if (!trimmed || state.lists.some(list => list.name === trimmed)) return null
  const list: ChangeList = { id: nextChangeListId(), name: trimmed, comment: comment.trim(), isDefault: activate, readOnly: false }
  const lists = activate
    ? [...state.lists.map(entry => (entry.isDefault ? { ...entry, isDefault: false } : entry)), list]
    : [...state.lists, list]
  return { state: { ...state, lists, current: activate ? list.id : state.current }, list }
}

/** 改名（`editName` `:887`）：**id 不变**（上游 `getId()` 的语义），空名/重名返回 null。 */
export function renameList(state: ChangeListsState, id: string, name: string): ChangeListsState | null {
  const trimmed = name.trim()
  if (!trimmed || state.lists.some(list => list.id !== id && list.name === trimmed)) return null
  if (!listById(state, id)) return null
  return { ...state, lists: state.lists.map(list => (list.id === id ? { ...list, name: trimmed } : list)) }
}

/** 改说明（`editComment` `:891`）。 */
export function setComment(state: ChangeListsState, id: string, comment: string): ChangeListsState {
  return { ...state, lists: state.lists.map(list => (list.id === id ? { ...list, comment } : list)) }
}

/** 设为活动列表（`setDefaultChangeList` `:873`）：同一时刻只有一个 `isDefault`。 */
export function setCurrentList(state: ChangeListsState, id: string): ChangeListsState {
  if (!listById(state, id)) return state
  return { ...state, current: id, lists: state.lists.map(list => ({ ...list, isDefault: list.id === id })) }
}

/**
 * 把若干路径移到某个列表（`moveChangesTo` `:905`）。移到**活动列表**时删掉归属条目
 * （没有条目就是活动列表，存档因此不会留冗余）。
 */
export function moveChanges(state: ChangeListsState, paths: readonly string[], listId: string): ChangeListsState {
  if (!listById(state, listId)) return state
  const assignments = { ...state.assignments }
  const active = currentList(state)?.id
  for (const path of paths) {
    if (listId === active) delete assignments[path]
    else assignments[path] = listId
  }
  return { ...state, assignments }
}

/** 删除一个列表会发生什么（调用方据此决定要不要确认、要不要改活动列表）。 */
export interface RemoveOutcome {
  /** 删除后的状态。 */
  state: ChangeListsState
  /** 被移到活动列表的变更数（上游那句 "All changes will be moved to the active changelist"）。 */
  moved: number
  /** 删掉的是不是活动列表（上游 `activeChangelistSelected`）。 */
  removedActive: boolean
  /** 删完之后活动列表换成了哪一个（`askNewDefaultChangeList` 的落点）。 */
  newCurrent: string
}

/**
 * 删除一个列表（`removeChangeList` `:849` + `RemoveChangeListAction.kt:55-141` 的语义）。
 *
 * 规则逐条照上游：
 *   · 只读列表**不删**（`:49` 的 `canRemoveChangeLists`）⇒ 返回 `removedActive:false, moved:0` 且状态不变；
 *   · 删的列表里的变更**移到活动列表**（不丢）—— 本仓把归属条目改成活动列表（活动列表是缺省归属，
 *     所以直接删条目）；
 *   · 删的是**活动**列表：活动权交给剩下的第一个；一个都不剩时**新建一个默认列表**并设为活动
 *     （上游 `:78-90` 就是这个顺序：先建 `Changes`、再 `setDefaultChangeList`、然后才删）。
 */
export function removeList(state: ChangeListsState, id: string): RemoveOutcome {
  const target = listById(state, id)
  if (!target || target.readOnly) return { state, moved: 0, removedActive: false, newCurrent: state.current }
  const removedActive = currentList(state)?.id === id
  let lists = state.lists.filter(list => list.id !== id)
  if (!lists.length) {
    // 删光了：造一个新的默认列表（上游删完活动列表且没有别的列表时正是这么做的）。
    const replacement: ChangeList = { id: nextChangeListId(), name: DEFAULT_CHANGE_LIST_NAME, comment: '', isDefault: true, readOnly: false }
    lists = [replacement]
  }
  let newCurrent = state.current
  if (removedActive) {
    newCurrent = lists[0]!.id
    lists = lists.map(list => ({ ...list, isDefault: list.id === newCurrent }))
  }
  const assignments: Record<string, string> = {}
  let moved = 0
  for (const [path, listId] of Object.entries(state.assignments)) {
    if (listId !== id) { assignments[path] = listId; continue }
    moved += 1  // 归属回活动列表 = 删条目（缺省归属就是活动列表）
  }
  return { state: { lists, current: newCurrent, assignments }, moved, removedActive, newCurrent }
}

/** 只读列表不许删（`RemoveChangeListAction.kt:46-53` 的 `canRemoveChangeLists`）。 */
export function canRemoveList(state: ChangeListsState, id: string): boolean {
  const list = listById(state, id)
  return Boolean(list && !list.readOnly)
}

/**
 * 删除确认文案（`VcsBundle.properties:281-283`，中文按本仓口径直译）。
 * `moved` = 该列表里的变更数；空列表**不需要确认**（上游 `confirmChangeListRemoval` `:121-129`
 * 在 `haveNoChanges` 时直接返回 true）。
 */
export function removeListQuestion(list: ChangeList, moved: number): string {
  return `确定要删除变更列表「${list.name}」吗？\n列表里的 ${moved} 处变更将移到活动列表，不会丢失。`
}
/** 一次删多个列表时的确认（`:282`）。 */
export function removeListsQuestion(count: number): string {
  return `确定要删除 ${count} 个变更列表吗？\n其中的变更将移到活动列表，不会丢失。`
}
/** 删的是活动列表、且删完一个不剩时的那句（`:283`）。 */
export function removeAllListsQuestion(count: number): string {
  return `确定要删除 ${count} 个变更列表吗？\n其中的变更将移到新的默认变更列表。`
}

/** 上游那句"变更会移到活动列表"的说明（界面状态行用）。 */
export const MOVE_TO_ACTIVE_NOTE = '删除列表时，其中的变更会移到活动列表，不会丢失。'

// ── 持久化（localStorage，按工作区根分键；对应上游的工程级存储）────────────────────────────

/** 存档键（与 `changesViewSettingsKey` 同一套口径：跟着工程走）。 */
export function changeListsKey(workspaceRoot: string): string {
  return `taocode.vcs.changeLists.${encodeURIComponent(workspaceRoot)}`
}

const MAX_LISTS = 64
const MAX_ASSIGNMENTS = 4000

/** 稳定序列化：`{lists, current, assignments}`；全是缺省时写空串（不留空壳）。 */
export function serializeChangeLists(state: ChangeListsState): string {
  const lists = state.lists.slice(0, MAX_LISTS).map(list => ({
    id: list.id, name: list.name,
    ...(list.comment ? { comment: list.comment } : {}),
    ...(list.isDefault ? { isDefault: true } : {}),
    ...(list.readOnly ? { readOnly: true } : {}),
  }))
  const assignments = Object.fromEntries(Object.entries(state.assignments).slice(0, MAX_ASSIGNMENTS))
  const payload: Record<string, unknown> = { lists, current: state.current }
  if (Object.keys(assignments).length) payload.assignments = assignments
  return JSON.stringify(payload)
}

/**
 * 读回存档；坏存档退回缺省（永不抛）。列表条目按形状逐条校验：id/name 缺失的丢弃
 * （既认不出也显示不了），一个都不剩时回缺省。
 */
export function parseChangeLists(raw: string | null | undefined): ChangeListsState {
  if (!raw) return createChangeListsState()
  try {
    const parsed = JSON.parse(raw) as unknown
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return createChangeListsState()
    const source = parsed as { lists?: unknown; current?: unknown; assignments?: unknown }
    const lists: ChangeList[] = []
    const seen = new Set<string>()
    if (Array.isArray(source.lists))
      for (const value of source.lists.slice(0, MAX_LISTS)) {
        if (!value || typeof value !== 'object') continue
        const item = value as Record<string, unknown>
        const id = typeof item.id === 'string' ? item.id : ''
        const name = typeof item.name === 'string' ? item.name.trim() : ''
        if (!id || !name || seen.has(id)) continue
        seen.add(id)
        lists.push({
          id, name,
          comment: typeof item.comment === 'string' ? item.comment : '',
          isDefault: item.isDefault === true,
          readOnly: item.readOnly === true,
        })
      }
    if (!lists.length) return createChangeListsState()
    // 活动列表：存档里的 current 必须真的存在，否则取第一个 `isDefault`，再否则取第一个。
    const requested = typeof source.current === 'string' ? source.current : ''
    const current = lists.some(list => list.id === requested)
      ? requested
      : (lists.find(list => list.isDefault) ?? lists[0]!).id
    // 同一时刻只有一个活动列表（存档可能被手改成多个 isDefault）。
    const normalized = lists.map(list => ({ ...list, isDefault: list.id === current }))
    const assignments: Record<string, string> = {}
    if (source.assignments && typeof source.assignments === 'object' && !Array.isArray(source.assignments))
      for (const [path, listId] of Object.entries(source.assignments as Record<string, unknown>).slice(0, MAX_ASSIGNMENTS))
        if (path && typeof listId === 'string' && seen.has(listId)) assignments[path] = listId
    return { lists: normalized, current, assignments }
  } catch {
    return createChangeListsState()
  }
}

/** 从 localStorage 读回（`storage` 为空 = 无宿主 ⇒ 缺省状态）。 */
export function readChangeLists(storage: Pick<Storage, 'getItem'> | null, workspaceRoot: string): ChangeListsState {
  if (!storage) return createChangeListsState()
  try { return parseChangeLists(storage.getItem(changeListsKey(workspaceRoot))) } catch { return createChangeListsState() }
}

/** 写回存档（失败不影响本次会话）。 */
export function writeChangeLists(storage: Pick<Storage, 'setItem'> | null, workspaceRoot: string, state: ChangeListsState): void {
  if (!storage) return
  try { storage.setItem(changeListsKey(workspaceRoot), serializeChangeLists(state)) } catch { /* 存不下不影响本次会话 */ }
}