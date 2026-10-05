// IDEA's welcome-screen project list, reduced to the parts TaoCode can consume.
//
// Source: platform/platform-impl/src/com/intellij/openapi/wm/impl/welcomeScreen/
//         recentProjects/RecentProjectTreeItem.kt, recentProjects/RecentProjectFilteringTree.kt,
//         projectActions/CopyProjectPathAction.kt.
//
// Pure logic (no Vue, no DOM) so it can be unit tested.

export interface WelcomeProject {
  name: string
  path: string
  lastOpened: string
  available: boolean
}

/**
 * `RecentProjectItem.searchName()` — RecentProjectTreeItem.kt:139-147: the searched text is
 * `"<group name> <path> <display name>"`.
 *
 * **有意偏差（已核实）**: IDEA first shortens the path against the user home (`:140-144`,
 * `FileUtil.startsWith(path, home)`); the renderer cannot read the home directory, so the whole
 * path is searched here. That is a superset of the same matches — anything found by IDEA's
 * shortened form is found by the full one too.
 */
export function searchText(project: WelcomeProject, groupName: string): string {
  return `${groupName} ${project.path} ${project.name}`
}

/** The filtering tree feeds this text to its speed search (RecentProjectFilteringTree.kt:164-166). */
export function matchesSearch(project: WelcomeProject, groupName: string, query: string): boolean {
  const needle = query.trim().toLocaleLowerCase()
  if (!needle) return true
  return searchText(project, groupName).toLocaleLowerCase().includes(needle)
}

/**
 * `selectLastOpenedProject()` — RecentProjectFilteringTree.kt:236-254 (called from
 * ProjectsTabFactory.kt:170,210): the welcome screen moves the selection onto the project the IDE
 * opened last. `RecentProjectsManagerBase.getLastOpenedProject()` is the newest activation
 * timestamp; when no timestamp parses, the first record is used, which is the order the host
 * stores its recent list in.
 */
export function lastOpenedPath(projects: readonly WelcomeProject[]): string {
  let path = ''
  let newest = Number.NEGATIVE_INFINITY
  for (const project of projects) {
    const time = Date.parse(project.lastOpened)
    if (Number.isNaN(time)) continue
    if (time > newest) {
      newest = time
      path = project.path
    }
  }
  return path || projects[0]?.path || ''
}

/**
 * `CopyProjectPathAction.actionPerformed` — CopyProjectPathAction.kt:25-32 copies
 * `FileUtil.toSystemDependentName(projectPath)`: the absolute path written with the platform's own
 * separators. The renderer is told which platform it is on instead of guessing from a user agent.
 */
export function systemDependentPath(path: string, windows: boolean): string {
  return windows ? path.replace(/\//g, '\\') : path.replace(/\\/g, '/')
}

// ── 分组（`ProjectGroup` 一族：新建 / 重命名 / 「移动到分组」的项序）──────────────────
//
// 上游坐标（本轮逐条读过）：
//   · `platform/platform-impl/resources/idea/PlatformActions.xml:1021-1025`
//     —— 行菜单里那一**段**的次序：分隔线 → `WelcomeScreen.NewGroup` → `WelcomeScreen.MoveToGroup`
//     → `WelcomeScreen.EditGroup`；
//   · `platform/platform-impl/resources/intellij.platform.ide.impl.actions.xml:578-581`
//     —— 这三个 id 的实现类；
//   · `…/welcomeScreen/projectActions/MoveProjectToGroupActionGroup.kt:31-49`
//     —— 弹层内容：**分组按 `NaturalComparator.INSTANCE` 排名字**（`:38`）、
//        `isTutorials` 的组跳过（`:39-42`）、有组时在末尾加一条分隔线 + `RemoveSelectedProjectsFromGroupsAction`
//        （`:45-48`，文案 `IdeBundle.properties:1793` "Remove from Groups"）；
//   · `…/projectActions/CreateNewProjectGroupAction.kt:19-32` —— 名字 trim 后查重，建的是**空分组**；
//   · `…/projectActions/EditProjectGroupAction.kt:22-45` —— 重命名：空名报错、撞名报错、改成原名放行。

import { naturalCompare } from './problemsView.ts'

/** 分组里只用到判序需要的两个字段。 */
export interface WelcomeGroupName {
  name: string
  tutorials?: boolean
}

/**
 * 「移动到分组」那一段的组名次序（`MoveProjectToGroupActionGroup.kt:38-42`）：
 * tutorials 那类组不出现在这里，剩下的按**自然序**排（`NaturalComparator.INSTANCE`，
 * 与 `StringUtil.naturalCompare` 同一个比较器）。
 */
export function moveTargetGroupNames(groups: readonly WelcomeGroupName[]): string[] {
  return groups
    .filter(group => group.tutorials !== true)
    .map(group => group.name)
    .sort((left, right) => naturalCompare(left, right))
}

/** 分组名校验的结论：要么是一个可用的名字，要么是一句给用户看的话。 */
export type GroupNameResult = { ok: true; name: string } | { ok: false; error: string }

/**
 * 新建与重命名共用的一条校验（`CreateNewProjectGroupAction.kt:19-21` +
 * `EditProjectGroupAction.kt:26-40`）：
 *   · trim 后为空 → 「名称不能为空。」（`error.name.cannot.be.empty`，`IdeBundle.properties:242`）；
 *   · 与别的组撞名（`current` 之外）→ 「分组「X」已存在。」
 *     （`error.group.already.exists`，`IdeBundle.properties:2639`）；
 *   · 改回原名放行（`:29` 的 `if (text == group.displayName()) return true`）。
 * ⚠️ 有意偏差：上游 `CreateNewProjectGroupAction` 的 validator 对**空串**返回 true
 * （`getGroup("")` 查不到组），于是能建出一个没有名字的分组；本仓按 Edit 那一档
 * 把空名一起拦下——空名字的组在列表里既点不到也没法再改。
 */
export function validateGroupName(existing: readonly string[], current: string, input: string): GroupNameResult {
  const name = (input ?? '').trim()
  if (!name) return { ok: false, error: '名称不能为空。' }
  if (name !== current && existing.includes(name)) return { ok: false, error: `分组「${name}」已存在。` }
  return { ok: true, name }
}

/** 上游那三个对话框的标题/提示（`IdeBundle.properties:2149-2150`、`:2168-2169`）。 */
export const GROUP_NEW_TITLE = '新建项目分组'                  // dialog.title.create.new.project.group
export const GROUP_NEW_PROMPT = '分组名称'                      // dialog.message.project.group.name
export const GROUP_RENAME_TITLE = '更改分组名称'                // dialog.title.change.group.name
export const GROUP_RENAME_PROMPT = '请输入分组名称：'           // label.enter.group.name
export const GROUP_MENU_LABELS = {
  create: '新建项目分组',          // action.WelcomeScreen.NewGroup.text（ActionsBundle.properties:2205）
  edit: '编辑分组…',               // action.WelcomeScreen.EditGroup.text（:2206）
  moveTo: '移动到分组',            // group.WelcomeScreen.MoveToGroup.text（:2558）
  removeFromGroups: '从分组移出',  // action.presentation.RemoveSelectedProjectsFromGroupsAction.text（IdeBundle.properties:1793）
} as const
