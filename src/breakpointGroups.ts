// 断点列表的分组（上游 `XBreakpointGroupingRule` 一族：
// `XBreakpointFileGroupingRule` 按文件、`XBreakpointGroupingByTypeRule` 按类型、
// `XBreakpointCustomGroupingRule` 按用户自定义组；规则优先级在 `XBreakpointsGroupingPriorities`）。
//
// 本仓的「查看断点…」列表里全是**行断点**（异常断点由 `src/exceptionBreakpoints.ts` 的共享状态
// 单独成组，见 `BreakpointsDialog.vue`），所以这里落的是上游按文件分组的规则：
// 组头 = 文件路径，子项 = 该文件里按行号排好的断点。纯函数，可单测。
//
// ── 第二块：用户可建的组 + 逐断点的「启用」标记 ──────────────────────────────────────
// 上游的落点（照抄这几条，不要凭印象改）：
//   · 组是**断点自己的属性**：`<group>` 逐断点存（`BreakpointState.java:28-29`），
//     由对话框的「移至组」写（`MoveToGroupAction.actionPerformed` → `breakpoint.setGroup`，
//     `BreakpointsDialog.java:551-556`）。**没有独立的组表** —— 组名从现有断点上取
//     （distinct + sorted，`BreakpointsDialog.java:326-335`），组名排序就是
//     `XBreakpointGroup.compareTo` 的按名比较（`XBreakpointGroup.java:34-36`）。
//   · 用户组规则**恒开**且优先级 1200 > 类型 1000 > 文件 600
//     （`XBreakpointCustomGroupingRule.kt:13-19`、`XBreakpointsGroupingPriorities.java:5-9`）；
//     而树是按「规则列表下标 = 层级」从外向内建的（`BreakpointItemsTreeController.java:117-132`，
//     规则按优先级降序排，`XBreakpointGroupingRule.java:17-20`）⇒ **用户组是最外层**，组里再按文件。
//   · 树上的复选框就是逐断点的启用标记：`nodeStateDidChangeImpl` → `item.setEnabled(...)`
//     （`BreakpointItemsTreeController.java:79-82`），组节点有任一孩子启用就呈勾选态（同文件 :126-128）。
//   · 「设为默认」由 `SetAsDefaultGroupAction` 写进 `XBreakpointManager`（`BreakpointsDialog.java:561-576`、
//     `XBreakpointManagerImpl.java:779`），**新断点**自动落进默认组
//     （`XBreakpointManagerImpl.java:248`、`:421` 的 `state.setGroup(myDefaultGroup)`）。
//
// 状态为什么是模块单例：这份「组 / 谁被停用」既被「查看断点…」对话框写，也被 Debug 面板
// 发断点的那条路读（取消勾选 = 不再发给适配器）。两边必须是同一份，否则在对话框里取消了断点、
// 回面板改一行代码却又被重新发出去。理由与 `src/exceptionBreakpoints.ts` 完全相同。
//
// 存哪：按项目根存 localStorage（上游存项目状态文件，`BreakpointState` 逐断点持久化
// enabled / temporary / dependency / group / description，`BreakpointState.java:17-34`）。

import { reactive } from 'vue'
import { parseBreakpointRef } from './debugBreakpointExtras.ts'
import type { DetailItem } from './popupDetail.ts'

export interface BreakpointFileGroup {
  /** 文件路径（组身份）。 */
  path: string
  /** 组头显示名：文件名 + 目录（去掉重复的路径段）。 */
  label: string
  items: DetailItem[]
}

/**
 * 按文件分组，保持输入里的文件顺序（`breakpointDetails*` 已按 path 排过序），
 * 组内保持原顺序（行号序）。同一个 path 只出现一个组。
 */
export function groupBreakpointsByFile(items: readonly DetailItem[]): BreakpointFileGroup[] {
  const groups: BreakpointFileGroup[] = []
  const index = new Map<string, number>()
  for (const item of items) {
    const existing = index.get(item.path)
    if (existing !== undefined) { groups[existing]!.items.push(item); continue }
    index.set(item.path, groups.length)
    groups.push({ path: item.path, label: fileGroupLabel(item.path), items: [item] })
  }
  return groups
}

/**
 * 组头文案：`A.java — src/main`。目录为空（项目根下的文件）时只给文件名 ——
 * 与 IDEA 分组节点的 `presentableText`（文件名）+ `containerText`（目录）同一形状。
 */
export function fileGroupLabel(path: string): string {
  const normalised = path.replace(/\\/g, '/')
  const base = normalised.split('/').pop() ?? normalised
  const directory = normalised.slice(0, Math.max(0, normalised.length - base.length)).replace(/\/+$/, '')
  return directory ? `${base} — ${directory}` : base
}

// ── 用户可建的组 ────────────────────────────────────────────────────────────────────

/** 逐断点存的组/启用状态（上游逐断点的 `BreakpointState`，见文件头）。 */
export interface BreakpointGroupState {
  /** `path:line` → 组名。空串与缺项都表示「无组」——
   *  上游同样把空组名当无组（`XBreakpointCustomGroupingRule.kt:24-27` 的 `takeIf { it.isNotEmpty() }`）。 */
  members: Record<string, string>
  /** 被取消勾选的断点（`path:line`）。**没列在这里 = 启用** —— 新断点默认启用，不必往表里补条目。 */
  disabled: string[]
  /** 默认组（`XBreakpointManager.getDefaultGroup()`）；新断点落进它。 */
  defaultGroup: string | null
}

export const breakpointGroupState = reactive<BreakpointGroupState>({ members: {}, disabled: [], defaultGroup: null })

/** localStorage 的最小面（单测传假对象即可，不依赖 window）。 */
export interface BreakpointStore {
  getItem(key: string): string | null
  setItem(key: string, value: string): void
}

export const BREAKPOINT_GROUP_KEY_PREFIX = 'taocode.breakpointGroups:'

/** 按项目根分桶：断点状态跟着项目走（与 `src/debugWatches.ts` 同一策略）。 */
export function groupStateKey(root: string): string {
  return `${BREAKPOINT_GROUP_KEY_PREFIX}${root.trim() || 'default'}`
}

/** 解析持久化数据：坏数据 → 空状态；空组名/空 ref 丢掉，disabled 去重保序。 */
export function parseGroupState(raw: string | null | undefined): BreakpointGroupState {
  const empty: BreakpointGroupState = { members: {}, disabled: [], defaultGroup: null }
  if (!raw) return empty
  let parsed: unknown
  try { parsed = JSON.parse(raw) } catch { return empty }
  if (!parsed || typeof parsed !== 'object') return empty
  const data = parsed as Partial<BreakpointGroupState>
  const members: Record<string, string> = {}
  for (const [ref, name] of Object.entries(data.members ?? {})) {
    if (typeof name !== 'string') continue
    const group = name.trim()
    if (!ref.trim() || !group) continue
    members[ref] = group
  }
  const disabled: string[] = []
  for (const ref of Array.isArray(data.disabled) ? data.disabled : []) {
    if (typeof ref !== 'string' || !ref.trim() || disabled.includes(ref)) continue
    disabled.push(ref)
  }
  const name = typeof data.defaultGroup === 'string' ? data.defaultGroup.trim() : ''
  return { members, disabled, defaultGroup: name || null }
}

/** 读进单例（对话框与面板共用这一份，见文件头）。坏数据不进单例。 */
export function loadGroupState(store: BreakpointStore | null | undefined, root: string): BreakpointGroupState {
  let raw: string | null = null
  try { raw = store?.getItem(groupStateKey(root)) ?? null } catch { raw = null }
  const state = parseGroupState(raw)
  breakpointGroupState.members = state.members
  breakpointGroupState.disabled = state.disabled
  breakpointGroupState.defaultGroup = state.defaultGroup
  return state
}

/** 落盘当前单例。存储不可用时静默降级成会话内状态。 */
export function saveGroupState(store: BreakpointStore | null | undefined, root: string): void {
  if (!store) return
  const payload: BreakpointGroupState = {
    members: { ...breakpointGroupState.members },
    disabled: [...breakpointGroupState.disabled],
    defaultGroup: breakpointGroupState.defaultGroup,
  }
  try { store.setItem(groupStateKey(root), JSON.stringify(payload)) } catch { /* session-only */ }
}

/** 断点是否启用（上游树上的复选框 = `BreakpointItem.setEnabled`）。 */
export function isBreakpointEnabled(ref: string): boolean {
  return !breakpointGroupState.disabled.includes(ref)
}

/**
 * 勾选/取消一批断点（上游：勾组 = 勾组里所有孩子）。返回**真正变了**的 ref ——
 * 调用方据此决定要重发哪几个文件（没变的重发是白跑一趟适配器）。
 */
export function setBreakpointsEnabled(refs: readonly string[], enabled: boolean): string[] {
  const changed: string[] = []
  for (const ref of refs) {
    if (!ref || isBreakpointEnabled(ref) === enabled) continue
    breakpointGroupState.disabled = enabled
      ? breakpointGroupState.disabled.filter(entry => entry !== ref)
      : [...breakpointGroupState.disabled, ref]
    changed.push(ref)
  }
  return changed
}

/** 断点所在的组；无组返回 null（上游 `getGroup()` 为空的那一支）。 */
export function groupNameOf(ref: string): string | null {
  const name = breakpointGroupState.members[ref]
  return typeof name === 'string' && name.trim() ? name.trim() : null
}

/**
 * 「移至组」（上游 `MoveToGroupAction`）：给这一批断点改组名，`null` = `<无组>`。
 * 空组名按「无组」处理（上游 `getGroup()?.takeIf { it.isNotEmpty() }` 就是这个意思）。
 * 返回真正变了的 ref。
 */
export function assignBreakpointsToGroup(refs: readonly string[], name: string | null): string[] {
  const group = typeof name === 'string' ? name.trim() : ''
  const members = { ...breakpointGroupState.members }
  const changed: string[] = []
  for (const ref of refs) {
    if (!ref || groupNameOf(ref) === (group || null)) continue
    if (group) members[ref] = group
    else delete members[ref]
    changed.push(ref)
  }
  if (changed.length) breakpointGroupState.members = members
  return changed
}

/**
 * 「新建…」那一项拿到的输入怎么解释 —— 上游 `MoveToGroupAction.actionPerformed`
 * （`BreakpointsDialog.java:542-557`）里那两行是关键：
 *   · `:545` `groupName = Messages.showInputDialog(breakpoints.dialog.new.group.name, …, AllIcons.Nodes.Folder)`
 *   · `:547-549` `if (groupName == null) return` ⇒ **取消 = 一条断点都不动**（不 `setGroup`、不 rebuildTree）；
 *   · 真按了确定、但名字是空串时上游**不 return**：`setGroup("")`，而空名在分组规则那边就是「没有组」
 *     （`XBreakpointCustomGroupingRule.kt:24` 的 `proxy.getGroup()?.takeIf { it.isNotEmpty() }`）
 *     ⇒ 等价于子菜单第一项 `MoveToGroupAction(null)`（`BreakpointsDialog.java:324`）的 `<无组>`。
 * 所以三种输入必须是**三种**结果：取消 ⇒ `null`（调用方直接 return）；空名 ⇒ `''`（= 无组）；否则去掉首尾空白。
 * 别把「取消」折成空串：那会让「按了一下 Esc」变成「整组搬到无组」（本仓组节点那一路原来就栽在这儿）。
 */
export function resolveNewGroupName(input: string | null): string | null {
  return input === null ? null : input.trim()
}

/** 「设为默认」/「取消设置为默认」（上游 `SetAsDefaultGroupAction`）。 */
export function setDefaultBreakpointGroup(name: string | null): void {
  const group = typeof name === 'string' ? name.trim() : ''
  breakpointGroupState.defaultGroup = group || null
}

/** 新断点落进哪一组（上游给新断点 `state.setGroup(myDefaultGroup)`）。 */
export function defaultGroupName(): string | null {
  return breakpointGroupState.defaultGroup
}

/**
 * 树里要画的组名（上游「移至组」子菜单那份清单：distinct + sorted）。
 * 排序按码元序（`String.compareTo`），不用 localeCompare —— 上游比的就是码元。
 */
export function groupNames(refs: Iterable<string>): string[] {
  const names = new Set<string>()
  for (const ref of refs) {
    const name = groupNameOf(ref)
    if (name) names.add(name)
  }
  return [...names].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0))
}

/** 对话框的用户组节点（最外层一级，组里再按文件 —— 见文件头的层级推导）。 */
export interface BreakpointGroupNode {
  name: string
  /** 组内断点的 ref（保持传入顺序）。 */
  refs: string[]
  /** 全部启用（上游：勾组 = 勾所有孩子 ⇒ 组呈勾选态）。 */
  enabled: boolean
  /** 三态：部分启用（`CheckboxTree` 的 indeterminate）。 */
  partial: boolean
  enabledCount: number
}

/** 组里当前的成员 ref（`breakpointGroupNodes` 与「整组搬迁」共用这一份口径）。 */
export function groupMembers(refs: readonly string[], name: string): string[] {
  return refs.filter(ref => groupNameOf(ref) === name)
}

export function breakpointGroupNodes(refs: readonly string[]): BreakpointGroupNode[] {
  return groupNames(refs).map(name => {
    const members = groupMembers(refs, name)
    const enabledCount = members.filter(isBreakpointEnabled).length
    return {
      name,
      refs: members,
      enabled: enabledCount === members.length,
      partial: enabledCount > 0 && enabledCount < members.length,
      enabledCount,
    }
  })
}

/**
 * 组节点的「移至组」——上游 `MoveToGroupAction.actionPerformed`（`BreakpointsDialog.java:542-557`）
 * 循环的是 `myTreeController.getSelectedBreakpoints(true)`，而 `traverse = true` 那一支
 * （`BreakpointItemsTreeController.java:187-194`）对选中节点做**先深遍历子树**
 * ⇒ 选中一个组节点再点「移至组」= 组里每条断点一起 `setGroup`，逐条那份不动。
 * `to = null`（`<无组>`）同样是整组一起移（上游子菜单第一项就是 `MoveToGroupAction(null)`，
 * `BreakpointsDialog.java:324`（**留痕**：这里原写 `:332`，逐行数过参考树后 `:332` 是那条 stream 的
 * `.sorted()`，`res.add(new MoveToGroupAction(null))` 在 `:324`），
 * 文案 `XDebuggerBundle.properties:230 no.group=<No Group>`）。
 *
 * **上游没有「组的改名」与「删除组」**：组不是实体，只是断点上的一个字符串
 * （`platform/xdebugger-api/src/com/intellij/xdebugger/breakpoints/ui/XBreakpointGroup.java:10-42`
 * 只有 `getName`/`compareTo`/`expandedByDefault`/`getIcon`，`XBreakpointCustomGroup.java:16-38` 多一个
 * `isDefault`；组名清单永远是从断点上 distinct+sorted 取的，`BreakpointsDialog.java:326-335`），
 * 所以「改名/删除」在上游就等于「整组搬到另一个名字」⇒ 本仓不另造假控件。
 * 目标名与源名相同 ⇒ 一条都不动（返回空数组，调用方据此不落盘、不重发）。
 */
export function moveGroupContents(refs: readonly string[], from: string, to: string | null): string[] {
  const group = typeof to === 'string' ? to.trim() : ''
  if (group === from) return []
  return assignBreakpointsToGroup(groupMembers(refs, from), group || null)
}

/** 「移至组」子菜单里的目标清单（上游 `:325-335` 那份 distinct+sorted，`:337` 一条分隔线，`:338` 再接「新建…」）。
 *  清单本身**只有已有组**：新建那一项走 `resolveNewGroupName`（同一个 `MoveToGroupAction` 家族的第三支）。 */
export function groupMoveTargets(refs: readonly string[], exclude: string): string[] {
  return groupNames(refs).filter(name => name !== exclude)
}

/** 受影响的 ref 落在哪几个文件（DAP `setBreakpoints` 是**按文件**整份发的）。 */
export function pathsOf(refs: readonly string[]): string[] {
  const paths: string[] = []
  for (const ref of refs) {
    const at = parseBreakpointRef(ref)
    if (at && !paths.includes(at.path)) paths.push(at.path)
  }
  return paths
}

// 「这次要发给适配器的一份断点」= 过滤掉被取消勾选的那些（上游取消勾选 = 断点不再注册，
// DAP 里没有「注册」这个动作，就等于**不发这条**；原册子 `dapBreakpoints` 不动 —— 断点还在
// gutter 与对话框里，只是调试器不听它的）。
// 12c：这条规则原来在本文件另有一个 `enabledBreakpoints(points, path)`，与 `src/dbgBreakpointUpdate.ts`
// 的 `breakpointRefSendable` 是同一件事的两份实现 ⇒ 删掉，只留下发口那一份（消费方：
// `src/components/BreakpointsDialog.vue` 与 `src/components/DebugBreakpointsPane.vue` 都走 `breakpointFileSend`）。
