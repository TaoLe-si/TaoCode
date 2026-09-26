// The list behind IDEA's project widget (headertoolbar/ProjectToolbarWidgetAction.kt).
//
// The widget takes the first MAX_RECENT_COUNT recent-project actions (:98, :263-265),
// groups them by "is this project open" (:262-276) and runs a speed search over the name
// *and* the path (:367-372, ProjectWidgetSpeedsearchFilter). Splitting it out of the
// component keeps that behaviour testable without a DOM.

export interface WidgetProject {
  name: string
  path: string
  available: boolean
}

export interface WidgetGroup<T> {
  label: string
  items: T[]
}

/** MAX_RECENT_COUNT (ProjectToolbarWidgetAction.kt:98). */
export const MAX_PROJECT_WIDGET_ITEMS = 100

/** Speed search over "name path" (:367-372); an empty query matches everything. */
export function filterProjects<T extends WidgetProject>(projects: readonly T[], query: string): T[] {
  const needle = query.trim().toLowerCase()
  if (!needle) return [...projects]
  return projects.filter(project => `${project.name} ${project.path}`.toLowerCase().includes(needle))
}

/**
 * Open projects first, then the rest — both in the order the recent list already has
 * (newest first). Groups that end up empty are dropped, and the popup is not created at
 * all when every group is empty (:121-124).
 */
export function groupProjects<T extends WidgetProject>(projects: readonly T[], currentRoot: string | undefined): WidgetGroup<T>[] {
  const capped = projects.slice(0, MAX_PROJECT_WIDGET_ITEMS)
  return [
    { label: '已打开的项目', items: capped.filter(project => project.path === currentRoot) },
    { label: '最近的项目', items: capped.filter(project => project.path !== currentRoot) },
  ].filter(group => group.items.length > 0)
}
