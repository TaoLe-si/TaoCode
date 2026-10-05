// 外部系统工程模型的**状态与任务激活**：上游
// `platform/external-system-impl/src/com/intellij/openapi/externalSystem/service/project/manage/`
// 里不依赖 PSI / Module 对象图的那些可移植语义。
//
//   ① `TaskActivationState.java` + `ExternalSystemTaskActivator.Phase`：每个外部工程一份「任务激活」
//      状态（7 个阶段 × 任务名清单）。上游把它存进工程状态（`ExternalProjectsState.java` 的
//      `externalSystemsTaskActivation: Map<path, TaskActivationState>`），本仓按同一口径落
//      `localStorage`（与 `src/analysisIgnore.ts` 同族），键随工作区根分隔。
//      增减/移动的逐条语义照抄 `ExternalSystemTaskActivator`：add 直接 append（允许重复条目）、
//      remove 只删第一处、move 与相邻项交换且越界原样；`getDescription()` 决定任务节点 tooltip 里
//      显示哪些阶段（「同步后、编译前」）。
//   ② `ExternalProjectsDataInvalidator` 的一角：取消链接一个 build 后丢掉它的激活状态
//      （`tasksActivationForLinkedBuilds`），不然状态会跟着旧路径永久留在磁盘上。
//
// 编辑 UI 在 `src/externalTasksActivation.ts` + `src/components/ExternalTasksActivationDialog.vue`，
// 宿主是 Gradle 工具窗口（`src/components/GradlePanel.vue` 的任务右键「配置任务激活…」）。
//
// 明确不做（上游有、本子集没有，族判词里同样点名）：按阶段**自动执行**激活的任务
// （`doExecuteBuildPhaseTriggers` / `runTasks` —— 运行控制台的配置只有命令与标签两个字段，没有
// 阶段编排入口）；`ExternalProjectsDataStorage` 的跨会话工程结构持久化（本仓的
// `ExternalProjectInfo` 模型在 `src/externalSystemModel.ts`，仅会话内）；`IdeModelsProviderImpl` /
// `AbstractIdeModifiableModelsProvider`（本仓没有可写的 Module / workspace model）；
// `nameGenerator` 的重名去重建议与 `settings/*ConfigurationHandler`（各需要目标模型）。

// ── 任务激活：Phase / TaskActivationState（上游 `ExternalSystemTaskActivator.Phase`）────────

export const TASK_PHASES = ['beforeRun', 'beforeSync', 'afterSync', 'beforeCompile', 'afterCompile', 'beforeRebuild', 'afterRebuild'] as const

export type TaskPhase = typeof TASK_PHASES[number]

/** 阶段的中文名（上游 Phase.toString() 走资源包，文案一一对应）。 */
export const TASK_PHASE_LABELS: Record<TaskPhase, string> = {
  beforeRun: '运行前',
  beforeSync: '同步前',
  afterSync: '同步后',
  beforeCompile: '编译前',
  afterCompile: '编译后',
  beforeRebuild: '重建前',
  afterRebuild: '重建后',
}

/** 上游 `Phase.isSyncPhase()`：只有这两个阶段挂在同步链上。 */
export function isSyncPhase(phase: TaskPhase): boolean {
  return phase === 'beforeSync' || phase === 'afterSync'
}

/** 上游 `RUN_CONFIGURATION_TASK_PREFIX = "run: "`：运行配置也能当任务激活。 */
export const RUN_CONFIGURATION_TASK_PREFIX = 'run: '

export function runConfigurationActivationTaskName(configurationName: string): string {
  return RUN_CONFIGURATION_TASK_PREFIX + configurationName
}

export function isRunConfigurationActivationTask(taskName: string): boolean {
  return taskName.startsWith(RUN_CONFIGURATION_TASK_PREFIX)
}

/** 上游 `TaskActivationState.java`：7 个阶段各一个任务名清单。 */
export interface TaskActivationState {
  beforeRun: string[]
  beforeSync: string[]
  afterSync: string[]
  beforeCompile: string[]
  afterCompile: string[]
  beforeRebuild: string[]
  afterRebuild: string[]
}

export function emptyTaskActivationState(): TaskActivationState {
  return { beforeRun: [], beforeSync: [], afterSync: [], beforeCompile: [], afterCompile: [], beforeRebuild: [], afterRebuild: [] }
}

export function tasksForPhase(state: TaskActivationState, phase: TaskPhase): readonly string[] {
  return state[phase]
}

/** 上游 `TaskActivationState.isEmpty()`。 */
export function taskActivationEmpty(state: TaskActivationState): boolean {
  return TASK_PHASES.every(phase => state[phase].length === 0)
}

/**
 * 上游 `ExternalSystemTaskActivator.getDescription(systemId, path, taskName)`：
 * 该任务被激活在哪些阶段，顿号连接；没有任何阶段时返回 null。
 */
export function taskActivationDescription(state: TaskActivationState, taskName: string): string | null {
  const phases = TASK_PHASES.filter(phase => state[phase].includes(taskName)).map(phase => TASK_PHASE_LABELS[phase])
  return phases.length ? phases.join('、') : null
}

/** 上游 `addTasks`：直接 append（允许重复条目），空任务名忽略。 */
export function addTaskActivation(state: TaskActivationState, phase: TaskPhase, taskName: string): TaskActivationState {
  const task = taskName.trim()
  if (!task) return state
  return { ...state, [phase]: [...state[phase], task] }
}

/** 上游 `removeTasks`：只移除第一处（与 `List.remove` 一致）。 */
export function removeTaskActivation(state: TaskActivationState, phase: TaskPhase, taskName: string): TaskActivationState {
  const tasks = state[phase]
  const index = tasks.indexOf(taskName)
  if (index < 0) return state
  return { ...state, [phase]: [...tasks.slice(0, index), ...tasks.slice(index + 1)] }
}

/** 上游 `moveTasks`：与相邻项交换；越界（负数 / 超出末尾）原样返回。 */
export function moveTaskActivation(state: TaskActivationState, phase: TaskPhase, taskName: string, increment: number): TaskActivationState {
  const tasks = [...state[phase]]
  const from = tasks.indexOf(taskName)
  const to = from + increment
  if (from < 0 || to < 0 || to >= tasks.length) return state
  const swap = tasks[from] as string
  tasks[from] = tasks[to] as string
  tasks[to] = swap
  return { ...state, [phase]: tasks }
}

/** 从持久化数据恢复（字段缺失 / 类型不对时按空清单处理，永不抛）。 */
export function parseTaskActivationState(value: unknown): TaskActivationState {
  const source = value && typeof value === 'object' ? value as Record<string, unknown> : {}
  const state = emptyTaskActivationState()
  for (const phase of TASK_PHASES) {
    const raw = source[phase]
    state[phase] = Array.isArray(raw)
      ? raw.filter((item): item is string => typeof item === 'string' && item.trim() !== '').map(item => item.trim())
      : []
  }
  return state
}

// ── 状态持久化（上游 `ExternalProjectsState.State#getExternalSystemsTaskActivation`）─────────

/** `localStorage` 的子集；测试与 Node 里传 null / 假对象即可。 */
export interface ExternalProjectStore {
  getItem(key: string): string | null
  setItem(key: string, value: string): void
  removeItem?(key: string): void
}

const normalize = (path: string) => path.replace(/\\/g, '/')

export function tasksActivationKey(workspaceRoot: string): string {
  return `taocode.externalSystem.tasksActivation.${normalize(workspaceRoot)}`
}

export type TasksActivationMap = Record<string, TaskActivationState>

export function parseTasksActivationMap(raw: string | null): TasksActivationMap {
  if (!raw) return {}
  try {
    const parsed = JSON.parse(raw) as { activation?: unknown }
    const source = parsed && typeof parsed === 'object' && parsed.activation && typeof parsed.activation === 'object'
      ? parsed.activation as Record<string, unknown>
      : {}
    const map: TasksActivationMap = {}
    for (const [path, value] of Object.entries(source)) {
      const state = parseTaskActivationState(value)
      if (!taskActivationEmpty(state)) map[normalize(path)] = state
    }
    return map
  } catch {
    return {}
  }
}

export function loadTasksActivation(store: ExternalProjectStore | null, workspaceRoot: string): TasksActivationMap {
  if (!store || !workspaceRoot) return {}
  try {
    return parseTasksActivationMap(store.getItem(tasksActivationKey(workspaceRoot)))
  } catch {
    return {}
  }
}

/** 写整张表；空表不落盘（顺手清掉旧键），存储不可用时返回 false，不影响本次会话。 */
export function saveTasksActivation(store: ExternalProjectStore | null, workspaceRoot: string, map: TasksActivationMap): boolean {
  if (!store || !workspaceRoot) return false
  const activation: TasksActivationMap = {}
  for (const [path, state] of Object.entries(map)) if (!taskActivationEmpty(state)) activation[normalize(path)] = state
  try {
    if (!Object.keys(activation).length && store.removeItem) { store.removeItem(tasksActivationKey(workspaceRoot)); return true }
    store.setItem(tasksActivationKey(workspaceRoot), JSON.stringify({ activation }))
    return true
  } catch {
    return false
  }
}

/** 取消链接一个 build 后丢掉它的激活状态（上游对话框只保留 `settings.getModules()` 里的路径）。 */
export function tasksActivationForLinkedBuilds(map: TasksActivationMap, linkedPaths: readonly string[]): TasksActivationMap {
  const linked = new Set(linkedPaths.map(normalize))
  const next: TasksActivationMap = {}
  for (const [path, state] of Object.entries(map)) if (linked.has(normalize(path))) next[path] = state
  return next
}
