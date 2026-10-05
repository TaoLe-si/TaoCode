// 外部系统视图的**三个显示开关**（上游 `platform/external-system-impl/src/com/intellij/openapi/externalSystem/action/`：
// `IgnoreExternalProjectAction`（忽略工程 = 不再刷新、默认从树里收起）、`ShowIgnoredAction`（显示已忽略的工程）、
// `GroupTasksAction`（任务按分组显示还是平铺）、`ShowInheritedTasksAction`（任务表是否包含继承任务））。
//
// 与 `src/externalProjectModel.ts`（任务激活状态）分开：激活是「执行时机」的状态，这里是**纯视图/刷新范围**的
// 开关，没有执行语义（忽略只影响增量刷新与树渲染，不删链接）。持久化沿用本仓口径：`localStorage`
// （与 `src/analysisIgnore.ts` 同族），键独立于激活表。
//
// 上游用 Tooling API 的 `TaskData.isInherited` 逐条过滤；本仓的取数通道是 CLI（`gradle projects tasks [--all]`），
// 没有逐条标记位，所以「显示继承任务」只能整批切换同步命令 —— 见 es/actions 判词。
import { ref } from 'vue'

function readJson<T>(key: string, fallback: T): T {
  try {
    const raw = typeof localStorage === 'undefined' ? null : localStorage.getItem(key)
    if (raw === null) return fallback
    const parsed = JSON.parse(raw) as unknown
    return parsed === null || parsed === undefined ? fallback : parsed as T
  } catch { return fallback }
}

function writeJson(key: string, value: unknown): void {
  try { if (typeof localStorage !== 'undefined') localStorage.setItem(key, JSON.stringify(value)) } catch { /* 存储不可用只影响持久化 */ }
}

function normalizePath(path: string): string {
  return (path ?? '').replace(/\\/g, '/').replace(/\/+$/, '')
}

const IGNORED_KEY = 'taocode.externalSystem.ignoredProjects'
const SHOW_IGNORED_KEY = 'taocode.externalSystem.showIgnored'
const GROUP_TASKS_KEY = 'taocode.externalSystem.groupTasks'
const SHOW_INHERITED_KEY = 'taocode.externalSystem.showInheritedTasks'

function readIgnored(): string[] {
  const raw = readJson<unknown>(IGNORED_KEY, [])
  return Array.isArray(raw) ? raw.filter((path): path is string => typeof path === 'string').map(normalizePath) : []
}

/** 被忽略的外部工程（**链接目录**口径，与激活表的键一致）。 */
export const ignoredExternalProjects = ref<string[]>(readIgnored())

export function isExternalProjectIgnored(projectPath: string, ignored: readonly string[] = ignoredExternalProjects.value): boolean {
  return ignored.includes(normalizePath(projectPath))
}

/** 忽略 / 取消忽略（上游 `IgnoreExternalProjectAction`；忽略不删链接，只停刷新 + 收起）。 */
export function setExternalProjectIgnored(projectPath: string, ignored: boolean): void {
  const path = normalizePath(projectPath)
  const next = ignored
    ? (ignoredExternalProjects.value.includes(path) ? ignoredExternalProjects.value : [...ignoredExternalProjects.value, path])
    : ignoredExternalProjects.value.filter(entry => entry !== path)
  ignoredExternalProjects.value = next
  writeJson(IGNORED_KEY, next)
}

/** `ShowIgnoredAction`：把被忽略的工程显示出来（显示时默认收起，只能手动展开）。 */
export const showIgnoredProjects = ref(readJson<boolean>(SHOW_IGNORED_KEY, false) === true)

export function setShowIgnoredProjects(value: boolean): void {
  showIgnoredProjects.value = value
  writeJson(SHOW_IGNORED_KEY, value)
}

/** `GroupTasksAction`：任务树按 Gradle 的 task group 分组（默认）还是平铺。 */
export const groupTasksByGroup = ref(readJson<boolean>(GROUP_TASKS_KEY, true) !== false)

export function setGroupTasksByGroup(value: boolean): void {
  groupTasksByGroup.value = value
  writeJson(GROUP_TASKS_KEY, value)
}

/** `ShowInheritedTasksAction`：任务表是否包含继承任务（切换同步命令的 `--all`）。默认开 = 一直以来的行为。 */
export const showInheritedTasks = ref(readJson<boolean>(SHOW_INHERITED_KEY, true) !== false)

export function setShowInheritedTasks(value: boolean): void {
  showInheritedTasks.value = value
  writeJson(SHOW_INHERITED_KEY, value)
}

/** 同步命令用的任务串（`src/gradleHost.ts` 的同步作业按这个开关取）。 */
export function gradleSyncTasks(inherited = showInheritedTasks.value): string {
  return inherited ? 'projects tasks --all' : 'projects tasks'
}

/** 面板渲染用：按「忽略 + 显示已忽略」过滤工程清单。 */
export function visibleExternalProjects<T extends { directory: string }>(
  projects: readonly T[], showIgnored = showIgnoredProjects.value, ignored: readonly string[] = ignoredExternalProjects.value,
): T[] {
  if (showIgnored) return [...projects]
  return projects.filter(project => !ignored.includes(normalizePath(project.directory)))
}

/** 面板渲染用：`GroupTasksAction` 关掉时折成一张平表（组名空串，顺序保持）。 */
export function tasksForGrouping<T>(groups: readonly { group: string; tasks: readonly T[] }[], grouped = groupTasksByGroup.value): { group: string; tasks: readonly T[] }[] {
  if (grouped) return [...groups]
  return [{ group: '', tasks: groups.flatMap(entry => entry.tasks) }]
}
