// The list behind IDEA's project widget (headertoolbar/ProjectToolbarWidgetAction.kt).
//
// The widget takes the first MAX_RECENT_COUNT recent-project actions (:98, :263-265),
// groups them by "is this project open" (:262-276) and runs a speed search over the name
// *and* the path (:367-372, ProjectWidgetSpeedsearchFilter). Splitting it out of the
// component keeps that behaviour testable without a DOM.

import { isSameProjectPath } from './projectLocator.ts'
import { shouldHideProjectSwitchingActions } from './projectWidgetActionsFilter.ts'

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

/**
 * Speed search over "name path" (:367-372); an empty query matches everything.
 *
 * 第二道过滤是**项目切换动作过滤器**（EP `com.intellij.projectWidgetActionsFilter`，见
 * `src/projectWidgetActionsFilter.ts`）：上游 `ProjectToolbarWidgetAction` 在建「切换项目」
 * 那一组动作时逐条问 `shouldHideProjectSwitchingActions(event)`，任一条答 true 就把这一行摘掉。
 * 本仓的行就是最近项目表，所以在这里逐条问一次 —— 没有 provider 时恒为 false，
 * 既有行为一字不变（`tests/project-widget.test.mjs` 与
 * `tests/project-widget-actions-filter.test.mjs` 同时钉住）。
 */
export function filterProjects<T extends WidgetProject>(
  projects: readonly T[],
  query: string,
  currentRoot = '',
): T[] {
  const needle = query.trim().toLowerCase()
  const searched = !needle ? [...projects] : projects.filter(project => `${project.name} ${project.path}`.toLowerCase().includes(needle))
  return searched.filter(project => !shouldHideProjectSwitchingActions({
    projectPath: project.path,
    projectName: project.name,
    currentRoot,
  }))
}

/**
 * Open projects first, then the rest — both in the order the recent list already has
 * (newest first). Groups that end up empty are dropped, and the popup is not created at
 * all when every group is empty (:121-124).
 *
 * 「是不是已打开的同一个项目」按项目身份比（`ProjectLocatorImpl` 的 basePath 口径，见
 * src/projectLocator.ts 的 isSameProjectPath）：最近项目里存的是上一次打开时原样的路径，
 * 与当前根可能只差分隔符/尾斜杠/盘符大小写 —— 用 `===` 会把同一个项目分进「最近的项目」。
 */
export function groupProjects<T extends WidgetProject>(projects: readonly T[], currentRoot: string | undefined): WidgetGroup<T>[] {
  const capped = projects.slice(0, MAX_PROJECT_WIDGET_ITEMS)
  return [
    { label: '已打开的项目', items: capped.filter(project => isSameProjectPath(project.path, currentRoot)) },
    { label: '最近的项目', items: capped.filter(project => !isSameProjectPath(project.path, currentRoot)) },
  ].filter(group => group.items.length > 0)
}
