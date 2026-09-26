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
