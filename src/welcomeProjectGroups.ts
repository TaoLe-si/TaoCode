// 欢迎页项目列表的**分组**（上游 `ProjectGroup` 那一族）：读法/写法、桶序、折叠、新建/改名/移入移出。
//
// 2026-10-06 桶 14c 从 `src/components/WelcomePage.vue` 整段搬出（组件里只留接线），
// 每一段自带的上游坐标跟着搬过来了，没有新增、没有改写。上游坐标：
//   · `platform/ide-core/src/com/intellij/ide/ProjectGroup.java` —— 字段清单（见下面 `ProjectGroup`）；
//   · `platform/platform-impl/src/com/intellij/ide/RecentProjectListActionProvider.kt:333-355`
//     （两趟分组布局）与同文件 `:388-407`（`ProjectGroupComparator`）；
//   · `platform/platform-impl/src/com/intellij/openapi/wm/impl/welcomeScreen/projectActions/CreateNewProjectGroupAction.kt:19-27`
//     `platform/platform-impl/src/com/intellij/openapi/wm/impl/welcomeScreen/projectActions/EditProjectGroupAction.kt:22-40`
//     —— 名字校验：错了不关框、把错误写在框上；
//   · `platform/platform-impl/src/com/intellij/openapi/wm/impl/welcomeScreen/projectActions/MoveProjectToGroupActionGroup.kt:38-48`
//     —— 「移动到分组」的组名次序与 `isTutorials` 跳过。
//
// 分组名的**校验规则**与那两个对话框的文案是纯规则，早就在 `src/welcomeProjects.ts`
// （`validateGroupName` / `GROUP_NEW_*` / `GROUP_RENAME_*` / `moveTargetGroupNames`）；
// 本文件只管「一组数据变成列表上的桶」以及「桶的状态怎么落到存储」。

import { computed, ref } from 'vue'
import {
  GROUP_NEW_PROMPT, GROUP_NEW_TITLE, GROUP_RENAME_PROMPT, GROUP_RENAME_TITLE,
  moveTargetGroupNames, validateGroupName,
} from './welcomeProjects.ts'
import type { RecentProject } from './bridge.ts'

/**
 * Source: ProjectGroup.java (platform/ide-core/.../ProjectGroup.java).
 * Properties are name, projects (List<path>), expanded (myExpanded), tutorials
 * (myTutorials), bottomGroup (myBottomGroup), plus a modCounter for change tracking.
 * ProjectGroupActionGroup.update() reads myGroup.isExpanded() and toggles the
 * popup/inline rendering; TaoCode renders the group header collapsed vs expanded
 * with the same semantic (when collapsed the header is a "popup group" that
 * expands on click). The bottomGroup flag moves the group to the bottom of the
 * list; tutorials is informational only at the data layer for now.
 */
export interface ProjectGroup { name: string; paths: string[]; expanded: boolean; tutorials: boolean; bottomGroup: boolean }

/** 未分组那一段的名字：唯一一个「空就不渲染」的桶。 */
export const UNGROUPED = '未分组'

/** localStorage 里的那一份：`{ groups: ProjectGroup[], collapsed: string[] }`。 */
export const PROJECT_GROUPS_KEY = 'taocode.projectGroups'

/** 上游 localStorage 的最小面（node --test 与隐私模式下传 null / 假对象即可）。 */
type Store = Pick<Storage, 'getItem' | 'setItem'> | null

function storage(store?: Store): Store {
  if (store !== undefined) return store
  try { return typeof localStorage === 'undefined' ? null : localStorage } catch { return null }
}

/**
 * 读法：形状不对的条目逐条丢掉，整份坏掉退化成「没有分组」。
 * Source: ProjectGroup.isExpanded() defaults to false (myExpanded = false).
 * Older TaoCode builds used a collapsed-set as the source of truth, so
 * when the persisted record lacks the boolean we fall back to that set
 * to keep the user's view stable across the upgrade.
 */
export function parseStoredGroups(raw: string | null | undefined): { groups: ProjectGroup[]; collapsed: string[] } {
  const groups: ProjectGroup[] = []
  let collapsed: string[] = []
  try {
    const saved = JSON.parse(raw ?? 'null') as { groups?: Array<Partial<ProjectGroup>>; collapsed?: string[] } | null
    if (saved && Array.isArray(saved.groups)) {
      for (const group of saved.groups) {
        if (!group || typeof group.name !== 'string' || !Array.isArray(group.paths)) continue
        groups.push({
          name: group.name,
          paths: (group.paths as unknown[]).filter((path): path is string => typeof path === 'string'),
          // 展开状态缺省时退回旧口径（此时 collapsed 还是刚读到的那一份，与原来
          // 「先映射 groups、后赋 collapsed」的顺序一致：映射阶段用的是旧 set 的状态）。
          expanded: typeof group.expanded === 'boolean' ? group.expanded : !collapsed.includes(group.name),
          tutorials: group.tutorials === true,
          bottomGroup: group.bottomGroup === true,
        })
      }
    }
    if (saved && Array.isArray(saved.collapsed)) collapsed = saved.collapsed.filter((name): name is string => typeof name === 'string')
  } catch { /* corrupted state falls back to a single ungrouped list */ }
  return { groups, collapsed }
}

/** 写法：两份口径都落盘（理由见上面那段注释）。 */
export function serializeGroups(groups: readonly ProjectGroup[], collapsed: Iterable<string>): string {
  return JSON.stringify({ groups, collapsed: [...collapsed] })
}

/**
 * ProjectGroupComparator (RecentProjectListActionProvider.kt:388-407): orders two
 * groups by the lowest recent-path index they each contain; ties break on a
 * natural (locale-aware) comparison of their names.
 * `recentPaths` 是当前**过滤后**列表的路径顺序（过滤掉了的项不参与判序）。
 */
export function compareProjectGroups(a: ProjectGroup, b: ProjectGroup, recentPaths: readonly string[]): number {
  const pathIndex = new Map(recentPaths.map((path, index) => [path, index]))
  let indexA = Number.MAX_SAFE_INTEGER
  for (const path of a.paths) {
    const idx = pathIndex.get(path)
    if (idx !== undefined && idx < indexA) indexA = idx
  }
  let indexB = Number.MAX_SAFE_INTEGER
  for (const path of b.paths) {
    const idx = pathIndex.get(path)
    if (idx !== undefined && idx < indexB) indexB = idx
  }
  if (indexA === indexB) return a.name.localeCompare(b.name, undefined, { sensitivity: 'base', numeric: true })
  return indexA - indexB
}

/**
 * Source: RecentProjectListActionProvider.addGroups (RecentProjectListActionProvider.kt:333-355)
 * iterates groups twice — once with `bottom = false` (top groups, rendered in
 * ProjectGroupComparator order) and once with `bottom = true` (the bottomGroup
 * buckets, rendered after the un-grouped recent projects). We mirror that two-pass
 * layout: top groups in ProjectGroupComparator order, then the un-grouped bucket,
 * then any bottom groups. The bottomGroup flag is set by ProjectGroup.setBottomGroup
 * and survives the localStorage round-trip just like the other ProjectGroup fields.
 */
export function buildGroupBuckets(
  groups: readonly ProjectGroup[], projects: readonly RecentProject[], ungrouped: string = UNGROUPED,
): { name: string; projects: RecentProject[] }[] {
  const recentPaths = projects.map(project => project.path)
  const topGroups = [...groups.filter(group => !group.bottomGroup)].sort((a, b) => compareProjectGroups(a, b, recentPaths))
  const bottomGroups = [...groups.filter(group => group.bottomGroup)].sort((a, b) => compareProjectGroups(a, b, recentPaths))
  const buckets: { name: string; projects: RecentProject[] }[] = []
  for (const group of topGroups) {
    buckets.push({ name: group.name, projects: projects.filter(project => group.paths.includes(project.path)) })
  }
  buckets.push({ name: ungrouped, projects: projects.filter(project => isInGroup(groups, project.path, ungrouped) === ungrouped) })
  for (const group of bottomGroups) {
    buckets.push({ name: group.name, projects: projects.filter(project => group.paths.includes(project.path)) })
  }
  return buckets.filter(bucket => bucket.name === ungrouped ? bucket.projects.length > 0 : true)
}

/** 这个项目在哪个组里（不在任何组 = 未分组那段）。 */
export function isInGroup(groups: readonly ProjectGroup[], path: string, ungrouped: string = UNGROUPED): string {
  return groups.find(group => group.paths.includes(path))?.name ?? ungrouped
}

/**
 * 左右方向键对分组行的作用（IDEA's list binds Left/Right to collapse/expand the group
 * under the cursor）：左键折叠、右键展开，已经是那个状态就不动。
 */
export function groupCollapseAction(key: string, isCollapsed: boolean): 'toggle' | null {
  if (key === 'ArrowLeft') return isCollapsed ? null : 'toggle'
  if (key === 'ArrowRight') return isCollapsed ? 'toggle' : null
  return null
}

export interface WelcomeProjectGroupsDeps {
  /** 当前过滤后的项目列表（判序与桶内容都以它为准）。 */
  recentProjects: () => RecentProject[]
  /** 打开着的行菜单要先收起来（动作都在菜单里触发）。 */
  closeMenu: () => void
  /** 注入存储用（测试传假对象；缺省走本机的 localStorage）。 */
  store?: Store
}

/** 分组的自持状态 + 那些动作；组件里只留接线。 */
export function createWelcomeProjectGroups(deps: WelcomeProjectGroupsDeps) {
  const target = storage(deps.store)
  const groups = ref<ProjectGroup[]>([])
  const groupCollapsed = ref<Set<string>>(new Set())
  try {
    const stored = parseStoredGroups(target?.getItem(PROJECT_GROUPS_KEY) ?? null)
    groups.value = stored.groups
    groupCollapsed.value = new Set(stored.collapsed)
  } catch { /* corrupted state falls back to a single ungrouped list */ }
  function saveGroups() {
    try { target?.setItem(PROJECT_GROUPS_KEY, serializeGroups(groups.value, groupCollapsed.value)) } catch { /* session-only */ }
  }
  function groupOf(path: string): string {
    return isInGroup(groups.value, path, UNGROUPED)
  }
  function projectGroupComparator(a: ProjectGroup, b: ProjectGroup): number {
    return compareProjectGroups(a, b, deps.recentProjects().map(project => project.path))
  }
  const groupedProjects = computed(() => buildGroupBuckets(groups.value, deps.recentProjects(), UNGROUPED))
  const groupingActive = computed(() => groups.value.length > 0)
  /**
   * 「移入 / 移出分组」（`MoveProjectToGroupActionGroup.kt:38-44`）：先把这个项目从**所有**
   * 组里摘掉，再挂到目标组；目标是未分组就到此为止（只摘不挂 = `RemoveSelectedProjectsFromGroupsAction`
   * 的语义），记录本身仍在最近项目里，所以这里不碰 `deps.recentProjects()`。
   */
  function moveToGroup(project: RecentProject, name: string) {
    deps.closeMenu()
    for (const group of groups.value) group.paths = group.paths.filter(path => path !== project.path)
    if (name !== UNGROUPED) {
      const target = groups.value.find(group => group.name === name)
      if (target) target.paths = [...target.paths, project.path]
    }
    saveGroups()
  }
  /**
   * 分组名的那一句输入（新建与重命名共用）。
   * 上游是 `Messages.showInputDialog` + `InputValidator`：错了**不关框**、把错误写在框上
   * （`CreateNewProjectGroupAction.kt:19-27`、`EditProjectGroupAction.kt:22-40`）。
   * 本仓没有通用输入对话框，`window.prompt` 是最接近的取法，于是用「带着错误再问一次」
   * 复现同一个行为；取消（返回 null）就是什么都不改。
   */
  function askGroupName(title: string, prompt: string, initial: string): string | null {
    let question = prompt
    for (;;) {
      const answer = window.prompt(`${question}\n${title}`, initial)
      if (answer === null) return null
      const result = validateGroupName(groups.value.map(group => group.name), initial, answer)
      if (result.ok) return result.name
      question = result.error
    }
  }
  /**
   * 「新建项目分组」（`WelcomeScreen.NewGroup`，`intellij.platform.ide.impl.actions.xml:578`
   * → `CreateNewProjectGroupAction.kt:32`）：建的是一个**空分组**，往里放项目是
   * 「移动到分组」那一段的事（`MoveProjectToGroupActionGroup.kt:38-44`），不在这一步。
   */
  function createGroup() {
    deps.closeMenu()
    const name = askGroupName(GROUP_NEW_TITLE, GROUP_NEW_PROMPT, '')
    if (!name) return
    // Source: ProjectGroup(name) constructor sets myName; myExpanded defaults to
    // false; the group's bottomGroup flag stays off so it renders above the
    // un-grouped bucket.
    groups.value = [...groups.value, { name, paths: [], expanded: true, tutorials: false, bottomGroup: false }]
    saveGroups()
  }
  /**
   * 「编辑分组…」= 改分组名（`WelcomeScreen.EditGroup`，`:581` → `EditProjectGroupAction.kt:22-45`：
   * 初值是当前名字，空名/撞名报错，改回原样放行）。折叠状态是按**名字**存的
   * （`groupCollapsed`），所以改名时要把那一份一起换掉，不然展开状态会丢。
   */
  function renameGroup(from: string) {
    deps.closeMenu()
    const name = askGroupName(GROUP_RENAME_TITLE, GROUP_RENAME_PROMPT, from)
    if (!name || name === from) return
    for (const group of groups.value) if (group.name === from) group.name = name
    groupCollapsed.value = new Set([...groupCollapsed.value].map(collapsed => (collapsed === from ? name : collapsed)))
    saveGroups()
  }
  /**
   * 「移动到分组」那一段的组名次序（`MoveProjectToGroupActionGroup.kt:38-42`）：
   * 自然序 + 跳过 tutorials 那类组。
   */
  const moveTargets = computed(() => moveTargetGroupNames(groups.value))
  // Source: ProjectGroupActionGroup.update() reads myGroup.isExpanded() to set
  // popupGroup, and ProjectGroup.setExpanded() flips it. We track both forms so
  // the JSON we serialise matches the boolean field on ProjectGroup and the older
  // collapsed-set semantics keep working for any caller that still reads them.
  function toggleGroupCollapsed(name: string) {
    const next = new Set(groupCollapsed.value)
    if (next.has(name)) next.delete(name)
    else next.add(name)
    groupCollapsed.value = next
    for (const group of groups.value) {
      if (group.name === name) group.expanded = !groupCollapsed.value.has(name)
    }
    saveGroups()
  }
  function onGroupKeydown(name: string, event: KeyboardEvent) {
    if (groupCollapseAction(event.key, groupCollapsed.value.has(name)) === 'toggle') toggleGroupCollapsed(name)
  }
  return {
    groups, groupCollapsed, groupedProjects, groupingActive, groupOf, moveTargets,
    moveToGroup, createGroup, renameGroup, toggleGroupCollapsed, onGroupKeydown,
  }
}
