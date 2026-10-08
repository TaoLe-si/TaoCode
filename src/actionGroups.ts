// 动作组贡献通道 —— 上游 `DefaultActionGroup` + `<add-to-group>` 在本仓的等价物。
//
// 上游是什么：IDEA 的菜单是一棵 `ActionGroup` 树（`PlatformActions.xml` 的 `<group id="FileMenu">`…），
// 插件在 plugin.xml 的 `<actions>` 块里给自己的动作写一条
//   `<add-to-group group-id="ViewMenu" anchor="after" relative-to-action="ViewAppearanceGroup"/>`
// 平台在 `ActionPluginRegistrar.addToGroupByXmlElement`（`platform-impl/.../ActionPluginRegistrar.kt:763`）
// 里解析 `group-id` / `anchor` / `relative-to-action`，再落到
// `DefaultActionGroup.addAction(action, Constraints(anchor, relativeToActionId))`
// （`platform-api/src/com/intellij/openapi/actionSystem/DefaultActionGroup.java:235`）。
//
// 本仓此前的现实（判词 `pf/actions` 反复写的那条「ActionGroup 的动态 childrenOf 只有三处在用、
// **EP 式贡献者那一半仍真缺**」）：`src/extensionPoints.ts` 的 `com.intellij.action` EP 已经能让第三方
// 按 id 挂**动作**，但挂进来的动作**进不了任何菜单组** —— 菜单行只有 `src/menus/*` 里静态写死的
// 那些和三个 `childrenOf`（宏 / 检查方案 / 符号类型过滤）。所以「按 group-id 把自己插到某个菜单里」
// 这条上游主路径在本仓没有对应物。本文件补上**那一层**：
//   · `parseAddToGroup`  ↔ `parseAnchor`（`ActionManagerXmlSupport.kt:229`）+ `group-id` 非空校验
//     （`ActionPluginRegistrar.kt:804` 的 `getParentGroup`）；
//   · `applyGroupMembers` ↔ `DefaultActionGroup.addAction` 的插入语义（`:250-300` 的
//     FIRST 头插 / LAST 尾加 / BEFORE|AFTER 按 `relative-to-action` 找位、找不到先挂起
//     （`:274` 的 `myPendingActions` + `:276` 的 `addAllToSortedList` 重试））。
//
// 与上游的三处如实差异：
//   ① 上游的组是 `DefaultActionGroup` 对象、`getChildren()` 运行时求值；本仓菜单行是
//      `MenuRow[]`，`mergeGroupRows()` 在一次装配里把贡献并进去（菜单行本身是 computed 的输入，
//      插件贡献在装配前注册，见文件末的说明）。
//   ② 上游 `relative-to-action` 找不到时**挂起并循环重试**，直到所有能落的都落完；本仓同款，
//      循环结束后仍悬空的贡献进 `errors`（对应上游最终 `reportActionManagerError`），不静默吞。
//   ③ 上游 `anchor` 缺省 = `last`（`ActionManagerXmlSupport.kt:231`）；`before`/`after` 缺
//      `relative-to-action` 直接报错并跳过（`ActionPluginRegistrar.kt:787-790`）。逐条对位。
//
// 纯数据层：不 import vue/DOM/bridge（便于单测，与 `extensionPoints.ts`/`codeVisionProviders.ts`
// 同一纪律）；只依赖扩展点宿主 `src/extensionPoints.ts` 与行模型 `src/menus/types.ts`。
//
// 判据：`tests/action-groups.test.mjs`。

import type { MenuRow } from './menus/types.ts'
import { ACTION_EP, EXTENSIONS, type ExtensionEntry, type ExtensionHandle } from './extensionPoints.ts'

/** 四档锚（上游 `Anchor` 枚举：FIRST / LAST / BEFORE / AFTER）。 */
export type GroupAnchor = 'first' | 'last' | 'before' | 'after'

/** 一条 `<add-to-group>` 的解析结果。 */
export interface GroupPlacement {
  /** 目标组 id（上游 `group-id` 属性）。 */
  groupId: string
  /** 锚（缺省 `last`）。 */
  anchor: GroupAnchor
  /** `before`/`after` 时的相对动作 id（上游 `relative-to-action`）。 */
  relativeTo?: string
}

/** 贡献对象上携带的 `<add-to-group>` 描述（本仓的动作描述符上的可选字段）。 */
export interface AddToGroupSpec {
  groupId?: string
  anchor?: string
  relativeTo?: string
}

export type AddToGroupParseResult =
  | { ok: true; placement: GroupPlacement }
  | { ok: false; error: string }

/**
 * `parseAnchor`（`ActionManagerXmlSupport.kt:229-243`）+ `group-id` 非空校验的等价物。
 * 锚大小写不敏感（上游 `equals(..., ignoreCase = true)`）；认不出的锚与缺 `group-id` 都返回
 * `ok:false` 并带一句可读原因（上游落 `reportActionManagerError`，不是静默跳过）。
 */
export function parseAddToGroup(spec: AddToGroupSpec | undefined): AddToGroupParseResult {
  if (!spec || !spec.groupId) return { ok: false, error: '贡献缺少 group-id（上游 "attribute \\"group-id\\" should be defined"）' }
  const raw = spec.anchor == null ? '' : String(spec.anchor).trim()
  const lower = raw.toLowerCase()
  let anchor: GroupAnchor
  if (raw === '') anchor = 'last'               // 缺省 last（ActionManagerXmlSupport.kt:231）
  else if (lower === 'first') anchor = 'first'
  else if (lower === 'last') anchor = 'last'
  else if (lower === 'before') anchor = 'before'
  else if (lower === 'after') anchor = 'after'
  else return { ok: false, error: `无法识别的 anchor「${raw}」；只能是 first / last / before / after` }
  // before/after 必须有 relative-to-action（ActionPluginRegistrar.kt:787-790）。
  if ((anchor === 'before' || anchor === 'after') && !spec.relativeTo)
    return { ok: false, error: `anchor 是「${anchor}」时必须给 relative-to-action` }
  return { ok: true, placement: { groupId: spec.groupId, anchor, ...(spec.relativeTo ? { relativeTo: spec.relativeTo } : {}) } }
}

/** 一条组贡献：行 + 它要去的位置。 */
export interface GroupMember<T> {
  row: T
  placement: GroupPlacement
}

export interface ApplyGroupMembersResult<T> {
  rows: T[]
  /** 落不下去的贡献 id 与原因（上游最终 `reportActionManagerError` 的那一半）。 */
  errors: string[]
}

/**
 * `DefaultActionGroup.addAction(constraint)` 的批量版（`DefaultActionGroup.java:235-301`）。
 *
 * 逐条语义对位：
 *   · `first`  → 头插（`:250-251`）；
 *   · `last`   → 尾加（`:253-254`）；
 *   · `before`/`after` → 在 `relative-to-action` 的**当前位置**前/后插入（`:289-299` 的
 *     `findIndex` + `:294-299`）；相对 id 此刻还不在表里就挂起（`:274` 的 `myPendingActions`），
 *     每轮重试一次，直到没有新进展（`:276-287` 的 `addAllToSortedList`）；
 *   · 同 id 重复 → **先移除旧的再加**（`:244-247` 的 `containsAction` → `remove`）；
 *   · 循环结束后还悬空的（相对的 id 始终没出现）→ `errors`，不硬塞一个位置。
 *
 * 传入的 `base` 不会被改写（复制后再操作），返回值是新的行数组。
 */
export function applyGroupMembers<T extends { id: string }>(
  base: readonly T[],
  members: readonly GroupMember<T>[],
): ApplyGroupMembersResult<T> {
  const rows = [...base]
  const errors: string[] = []
  let pending = members.map((member, index) => ({ member, index }))
  // 稳定：同一次装配里贡献按传入顺序处理（上游按声明顺序）。
  for (;;) {
    const next: typeof pending = []
    let progressed = false
    for (const item of pending) {
      const { row, placement } = item.member
      if (insertMember(rows, row, placement)) progressed = true
      else next.push(item)
    }
    if (!progressed || next.length === pending.length) {
      pending = next
      break
    }
    pending = next
    if (!pending.length) break
  }
  for (const item of pending) {
    const { row, placement } = item.member
    errors.push(`贡献「${row.id}」的相对动作「${placement.relativeTo ?? ''}」不在组「${placement.groupId}」里，未插入`)
  }
  return { rows, errors }
}

function insertMember<T extends { id: string }>(rows: T[], row: T, placement: GroupPlacement): boolean {
  const { anchor, relativeTo } = placement
  // 同 id 重复先移除旧的（上游 DefaultActionGroup.java:244-247 在插入前就 remove）。
  discardById(rows, row.id)
  if (anchor === 'first') { rows.unshift(row); return true }
  if (anchor === 'last') { rows.push(row); return true }
  const index = relativeTo ? rows.findIndex(candidate => candidate.id === relativeTo) : -1
  if (index === -1) {
    // 相对动作还没落进表：不插入，交给外层挂起重试（上游 myPendingActions）。
    return false
  }
  const at = anchor === 'before' ? index : index + 1
  rows.splice(at, 0, row)
  return true
}

function discardById<T extends { id: string }>(rows: T[], id: string): void {
  for (let i = rows.length - 1; i >= 0; i -= 1) if (rows[i].id === id) rows.splice(i, 1)
}

// ── 宿主侧：从 `com.intellij.action` EP 读贡献、折算成菜单行 ──────────────────────────────
/**
 * 上游 EP 里的贡献对象形状（`<add-to-group>` 所在的 `<action>` 节点在 `ActionPluginRegistrar` 里
 * 被解析成 ActionStub/AnAction；本仓就是那个对象本身）。除动作描述符的常规字段外，多一个
 * 可选的 `addToGroup` 描述。
 */
export interface ContributedAction {
  id: string
  title?: string | (() => string)
  keywords?: string
  icon?: string
  enabled?: () => boolean
  checked?: () => boolean
  run?: () => void
  addToGroup?: AddToGroupSpec
  [key: string]: unknown
}

/** 把一条 EP 贡献折算成菜单行（没有 id 或没有 run 的忽略 —— 上游 "可被 Find Action 调用" 的那类除外）。 */
export function menuRowFromContribution(descriptor: ContributedAction): MenuRow | null {
  if (!descriptor || !descriptor.id) return null
  const row: MenuRow = { id: descriptor.id }
  if (descriptor.title != null) row.title = descriptor.title
  if (descriptor.keywords) row.keywords = descriptor.keywords
  if (descriptor.icon) row.icon = descriptor.icon
  if (descriptor.enabled) row.enabled = descriptor.enabled
  if (descriptor.checked) row.checked = descriptor.checked
  if (descriptor.run) row.run = descriptor.run
  return row
}

export interface GroupMembersResult {
  members: GroupMember<MenuRow>[]
  errors: string[]
}

/**
 * 从动作 EP 取某个组下的全部贡献（已按 EP 的 `LoadingOrder` 排好序，再折算成成员）。
 * 解析不出的（缺 group-id / 坏 anchor / before|after 缺 relative-to-action）落进 `errors`。
 */
export function groupMembersFromExtensions(groupId: string, scope?: string): GroupMembersResult {
  const entries: ExtensionEntry<ContributedAction>[] = scope
    ? EXTENSIONS.entriesFor<ContributedAction>(ACTION_EP, scope)
    : EXTENSIONS.entriesFor<ContributedAction>(ACTION_EP)
  const members: GroupMember<MenuRow>[] = []
  const errors: string[] = []
  for (const entry of entries) {
    const descriptor = entry.value
    if (!descriptor || descriptor.id !== entry.id) continue
    if (!descriptor.addToGroup) continue
    const parsed = parseAddToGroup(descriptor.addToGroup)
    if (!parsed.ok) { errors.push(`${entry.id}：${parsed.error}`); continue }
    if (parsed.placement.groupId !== groupId) continue
    const row = menuRowFromContribution(descriptor)
    if (row) members.push({ row, placement: parsed.placement })
  }
  return { members, errors }
}

/**
 * 把动作 EP 里指向 `groupId` 的贡献并进一组菜单行 —— 菜单装配的调用点（`src/appMainMenu.ts`）。
 * 返回新数组；`errors` 里的悬空贡献不影响其余行（上游也只是报错后继续）。
 */
export function mergeGroupRows(groupId: string, baseRows: readonly MenuRow[], scope?: string): MenuRow[] {
  const { members } = groupMembersFromExtensions(groupId, scope)
  if (!members.length) return [...baseRows]
  return applyGroupMembers(baseRows, members).rows
}

/**
 * 主菜单档位键 → 上游组 id（`actionGroupStructure.txt:2444-2456` 的 `[group MainMenu]` 直接子项：
 * FileMenu EditMenu ViewMenu GoToMenu CodeMenu RefactoringMenu BuildMenu RunMenu ToolsMenu
 * VcsGroups WindowMenu HelpMenu）。`src/appMainMenu.ts` 用它把动态贡献并进对应档位。
 */
export const MAIN_MENU_GROUP_IDS: Readonly<Record<string, string>> = {
  file: 'FileMenu',
  edit: 'EditMenu',
  view: 'ViewMenu',
  navigate: 'GoToMenu',
  code: 'CodeMenu',
  refactor: 'RefactoringMenu',
  build: 'BuildMenu',
  run: 'RunMenu',
  tools: 'ToolsMenu',
  git: 'VcsGroups',
  window: 'WindowMenu',
  help: 'HelpMenu',
}

/** 档位键 → 组 id（表里没有的用键本身兜底，便于第三方自定义档位）。 */
export function mainMenuGroupId(menuKey: string): string {
  return MAIN_MENU_GROUP_IDS[menuKey] ?? menuKey
}

// ── 插件 API：把一条动作贡献进某个菜单组 ────────────────────────────────────────────────
/**
 * 第三方插件入口 —— 等价于 plugin.xml 里
 *   `<actions><action …/><add-to-group group-id="ViewMenu" anchor="after" relative-to-action="…"/></actions>`。
 *
 * 插件（或测试）调它注册一条动作贡献，`mergeGroupRows()` 会在菜单装配时把它并进目标组。
 * 这是**稳定 API**：`descriptor` 是 `com.intellij.action` EP 的贡献对象，`placement` 就是
 * `<add-to-group>` 的三个属性。落点与顺序在**注册时**校验（缺 group-id / 坏 anchor /
 * before|after 缺 relative-to-action 一律抛错，不静默）；相对动作是否已在组里由装配期决定
 * （还没出现就挂起重试，最终仍悬空则报错，见 `applyGroupMembers`）。
 *
 * 返回的句柄 `dispose()` 即 `unregisterExtension`（上游动态 EP 的注销面）。
 */
export function registerActionWithGroup(
  descriptor: ContributedAction,
  placement: AddToGroupSpec,
  options: { scope?: string; order?: string; priority?: number; source?: 'bundled' | 'user' } = {},
): ExtensionHandle {
  const parsed = parseAddToGroup(placement)
  if (!parsed.ok) throw new Error(`registerActionWithGroup：${parsed.error}`)
  if (!descriptor || !descriptor.id) throw new Error('registerActionWithGroup：贡献必须有 id。')
  return EXTENSIONS.registerExtension<ContributedAction>(
    ACTION_EP,
    descriptor.id,
    { ...descriptor, addToGroup: placement },
    { source: 'user', ...options },
  )
}
