// 调试器「按类型分组的帧/变量树」的派生规则（上游 `XValueGroup` / `XValueGroupNodeImpl` 的等价物）。
//
// 上游形状（逐条核过）：
//   · `XValueGroup`（`platform/xdebugger-api/src/com/intellij/xdebugger/frame/XValueGroup.java:13-48`）
//     是一个**值容器**：`getName()`（组名）、`getComment()`（组名后的说明）、`getSeparator()`
//     （默认 `" = "`，`:42`）、`isAutoExpand()`（默认 false，`:30`）、`isRestoreExpansion()`
//     （默认 false，`:37`）。分组由**值容器自己**决定 —— 谁的孩子归哪一组是容器的实现；
//   · `XValueGroupNodeImpl`（`platform/xdebugger-impl/ui/src/com/intellij/xdebugger/impl/ui/tree/nodes/XValueGroupNodeImpl.java:16-72`）
//     把组画成树节点：名字 + 分隔符 + 注释（`:22-26`），并按 `isExpand(group)`（`:43-50`）
//     决定初始展开态 —— `isRestoreExpansion()` 为真时读 `PropertiesComponent`（按**组名**存，
//     `:45-47`），否则用 `isAutoExpand()`；`onExpansion`（`:52-60`）在展开态变化时写回。
//
// DAP 没有"分组"这个概念：`variables` 回的是一层**扁平的孩子**（每个孩子带 `name`/`value`/`type`/
// `variablesReference`）。所以本仓把上游那套**派生**到 `type` 字段上：同一层里 `type` 非空的兄弟
// 聚成一个组节点（组名 = 类型名，注释 = 成员数），没报类型的留在组外。这就是 `XValueNodeImpl`
// 那一侧"按类型分组"的可见行为（同类型的值折成一个可展开的组，而不是把每一行都摊平）。
//
// 为什么单独成模块（2026-10-06）：DebugPanel.vue 贴着机检上限（900 行），`src/debugDataView.ts`
// 的 `walk` 也已经被"一层孩子怎么过滤/排序"占满；分组是**第二套**规则（组节点怎么造、
// 展开态怎么跨会话存），抽出来既能单测，也让两个消费点（变量树 / 求值结果树）共用同一份实现
// —— 两处各写一份必然漂移（同一个 type 在一处成组、另一处不成组）。
//
// 本模块零依赖（只 `import type`），能被 `node --test` 直接加载。

import type { DapVariable } from './bridge'

/** 组名与注释之间的分隔符（上游 `XValueGroup.getSeparator()`，`:42` 的默认值）。 */
export const GROUP_SEPARATOR = ' = '

/**
 * 组节点在展开态 `open` 记录里的键标记。`debugDataView` 造键时用它
 * （`${prefix}g|${type}`），持久化时也按它把组键挑出来 —— 两处必须同一个常量。
 */
export const GROUP_KEY_MARKER = 'g|'

/** 一层孩子里的一项（与 `debugDataView.VisibleChild` 同形；结构类型，不引那个模块避免环）。 */
export interface GroupMember {
  variable: DapVariable
  /** 原始下标（组内成员的 `[i]` 显示名要用真实索引）。 */
  index: number
}

/** 一个类型组（上游 `XValueGroup` 的四个可观察字段 + 成员）。 */
export interface TypeGroup {
  /** 组名（`XValueGroup.getName()`）。 */
  type: string
  /** 组内成员，保持进入时的顺序。 */
  members: GroupMember[]
  /** 注释（`XValueGroup.getComment()`）：本仓 = 「N 项」。 */
  comment: string
  /** 名字与注释之间的分隔符（`XValueGroup.getSeparator()`）。 */
  separator: string
  /** 初始展开态（`XValueGroup.isAutoExpand()`）：默认 false = 收起，与既有行为一致。 */
  autoExpand: boolean
  /** 展开态是否跨会话保存（`XValueGroup.isRestoreExpansion()`）：本仓的组都存。 */
  restoreExpansion: boolean
}

/** 分组结果：组（按首次出现的顺序）+ 没报类型、留在组外的成员。 */
export interface Grouping {
  groups: TypeGroup[]
  ungrouped: GroupMember[]
}

/** 组节点的注释文本（`XValueGroup.getComment()` 在本仓的取值）。 */
export function groupComment(count: number): string {
  return `${count} 项`
}

/**
 * 按 `type` 归组（上游"值容器自己决定孩子怎么成组"的 DAP 等价物）。
 *
 * 口径（与既有行为逐字一致，见 `tests/debug-variable-views.test.mjs`）：
 *   · 组的顺序 = 该类型**第一次出现**的顺序；组内保持进入顺序；
 *   · `type` 空（适配器没报类型）的成员不归任何组，留在组外、保持原位次。
 * `visible` 已经过"隐藏 null / 按名排序"（`debugDataView.visibleChildren`），
 * 所以分组只决定"怎么摆"，不重新决定"谁可见"。
 */
export function groupChildrenByType(visible: readonly GroupMember[]): Grouping {
  const groups: TypeGroup[] = []
  const indexOfType = new Map<string, number>()
  const ungrouped: GroupMember[] = []
  for (const entry of visible) {
    const type = (entry.variable.type ?? '').trim()
    if (!type) {
      ungrouped.push(entry)
      continue
    }
    let at = indexOfType.get(type)
    if (at === undefined) {
      at = groups.length
      indexOfType.set(type, at)
      groups.push({
        type, members: [], comment: '', separator: GROUP_SEPARATOR,
        autoExpand: false, restoreExpansion: true,
      })
    }
    groups[at]!.members.push(entry)
  }
  for (const group of groups) group.comment = groupComment(group.members.length)
  return { groups, ungrouped }
}

/** 组节点的展开态键（前缀 + `g|` + 类型名；与 `debugDataView` 的造键规则同一个）。 */
export function typeGroupKey(prefix: string, type: string): string {
  return `${prefix}${GROUP_KEY_MARKER}${type}`
}

/** 一个键是不是组节点的键（持久化时按它把组键从 `open` 里挑出来）。 */
export function isGroupKey(key: string): boolean {
  return key.includes(GROUP_KEY_MARKER)
}

/** 组节点那一行的文本（名字 + 分隔符 + 注释），与 `XValueGroupNodeImpl:22-26` 的拼法同义。 */
export function groupLabel(group: TypeGroup): string {
  return group.comment ? `${group.type}${group.separator}${group.comment}` : group.type
}

// ── 展开态的跨会话存档（上游 `XValueGroupNodeImpl` 的 `PropertiesComponent` 那一半）──────────
//
// 上游按**组名**存（`getBoolean(name)` / `setValue(name, expanded)`，`:45-47`/`:55-57`），落在
// 应用的 `PropertiesComponent` 里。本仓按**工作区根 + 组键**存 localStorage —— 与
// `changesViewSettings.ts` 的 `taocode.vcs.changesView.<root>` 同一套口径（都是"跟着工程走"）。

/** 存档键（按工作区根区分；根为空串时也有一份，不抛）。 */
export function groupExpansionKey(workspaceRoot: string): string {
  return `taocode.debug.groupExpansion.${encodeURIComponent(workspaceRoot)}`
}

/** 从存档里挑出组键的展开态（只收 `true`，其余当缺省收起；坏存档退回空表，永不抛）。 */
export function parseGroupExpansion(raw: string | null | undefined): Record<string, boolean> {
  if (!raw) return {}
  try {
    const parsed = JSON.parse(raw) as unknown
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {}
    const out: Record<string, boolean> = {}
    for (const [key, value] of Object.entries(parsed as Record<string, unknown>)) {
      if (isGroupKey(key) && value === true) out[key] = true
    }
    return out
  } catch {
    return {}
  }
}

/** 从 localStorage 读回组键展开态（`storage` 为空 = 无宿主，返回空表）。 */
export function readGroupExpansion(storage: Pick<Storage, 'getItem'> | null, workspaceRoot: string): Record<string, boolean> {
  if (!storage) return {}
  try { return parseGroupExpansion(storage.getItem(groupExpansionKey(workspaceRoot))) } catch { return {} }
}

/**
 * 把当前 `open` 里的**组键**写回存档（非组键不写：作用域/普通行的展开态是会话内的）。
 * 存档失败（配额、隐私模式）不影响本次会话。
 */
export function writeGroupExpansion(
  storage: Pick<Storage, 'setItem'> | null, workspaceRoot: string, open: Record<string, boolean>,
): void {
  if (!storage) return
  const groups: Record<string, boolean> = {}
  for (const [key, value] of Object.entries(open)) if (isGroupKey(key) && value) groups[key] = true
  try {
    if (Object.keys(groups).length) storage.setItem(groupExpansionKey(workspaceRoot), JSON.stringify(groups))
    else storage.setItem(groupExpansionKey(workspaceRoot), '')
  } catch { /* 存不下不影响本次会话 */ }
}

/** 当前渲染行里所有组节点的键（「全部展开/全部收起」作用在它们身上）。 */
export function groupRowKeys(rows: readonly { key: string; group?: boolean }[]): string[] {
  return rows.filter(row => row.group === true).map(row => row.key)
}

/** 「全部展开」：把每个组键置真（普通行不动）。 */
export function expandGroups(open: Record<string, boolean>, rows: readonly { key: string; group?: boolean }[]): Record<string, boolean> {
  const next = { ...open }
  for (const key of groupRowKeys(rows)) next[key] = true
  return next
}

/** 「全部收起」：把每个组键删掉（缺省即收起）。 */
export function collapseGroups(open: Record<string, boolean>, rows: readonly { key: string; group?: boolean }[]): Record<string, boolean> {
  const next = { ...open }
  for (const key of groupRowKeys(rows)) delete next[key]
  return next
}

/** 组键当前是不是全展开（「全部展开/收起」那个按钮的选中态）。 */
export function allGroupsExpanded(open: Record<string, boolean>, rows: readonly { key: string; group?: boolean }[]): boolean {
  const keys = groupRowKeys(rows)
  return keys.length > 0 && keys.every(key => open[key] === true)
}