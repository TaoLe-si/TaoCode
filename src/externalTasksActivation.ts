// 任务激活对话框的**树模型与命令**：上游
// `platform/external-system-impl/src/com/intellij/openapi/externalSystem/service/task/ui/ConfigureTasksActivationDialog.java`
// 与 `ExternalSystemTasksTree.java` / `ExternalSystemTasksTreeModel.java` 的 DOM 子集。
//
// 上游对话框的形态：项目下拉框选中一个外部工程 → 树里按 `Phase` 分组列出**已激活**的任务
// （工具条：添加 / 移除 / 上移 / 下移），「添加」弹层列出该工程模型里的任务与运行配置
// （`run: <配置名>`）。本仓的等价物是 Gradle 工具窗口任务右键的「配置任务激活…」→
// `src/components/ExternalTasksActivationDialog.vue`：树由本模块从 `TaskActivationState`
// （`src/externalProjectModel.ts`）+ 每个 build 同步报告里的任务表折出；命令是纯函数，
// 返回新的激活表，宿主负责落盘（`saveTasksActivation`）。
//
// 多选批量移动/移除是上游对话框的既有能力（`ConfigureTasksActivationDialog.java:156` 的
// `DISCONTIGUOUS_TREE_SELECTION`、`:193-197` 移除全部选中、`:198-201`+`:207-224` 的移动可用性、
// `:226-238` 的批量移动），逐条语义照抄 `ExternalSystemTaskActivator.moveTasks`（`:323-337`：
// 每条各自与相邻项交换、越界原样）与 `removeTasks`（`:301-312`：`List.remove` 只删第一处）。
//
// 明确不做（上游有、本子集没有）：拖拽排序（用上移/下移按钮等价）、`moveProjects` 的**工程顺序**
// 调整（`:339-366`，要持久化工程清单的顺序，本仓激活表按链接顺序折出）、运行配置候选
// （GradlePanel 拿不到运行配置清单）、按 `ProjectSystemId` 切换构建系统（本仓只有 Gradle）。

import {
  TASK_PHASES, TASK_PHASE_LABELS, addTaskActivation, emptyTaskActivationState, moveTaskActivation,
  removeTaskActivation, taskActivationDescription, taskActivationEmpty, type TaskActivationState,
  type TaskPhase, type TasksActivationMap,
} from './externalProjectModel.ts'

/** 对话框里一个 build 的输入：目录、显示名、同步报告里的任务名。 */
export interface ActivationBuildInput {
  /** 工作区相对目录（`''` = 工作区根，与 `GradleLinkedProject.directory` 同口径）。 */
  directory: string
  label: string
  tasks: readonly string[]
}

export interface ActivationPhaseNode {
  phase: TaskPhase
  label: string
  /** 已激活的任务名（保持激活顺序，允许重复条目）。 */
  tasks: readonly string[]
}

export interface ActivationBuildNode {
  directory: string
  label: string
  phases: ActivationPhaseNode[]
  /** 可添加的任务（同步报告里有、且当前阶段未激活的，按名字排序）。 */
  availableTasks: readonly string[]
  /** 已激活但当前任务表里没有的（改名/被删；运行配置条目除外），对话框点名提示。 */
  missingTasks: readonly string[]
  /** 已激活任务总数（含重复条目）。 */
  count: number
}

function stateFor(map: TasksActivationMap, directory: string): TaskActivationState {
  return map[directory] ?? emptyTaskActivationState()
}

function withState(map: TasksActivationMap, directory: string, state: TaskActivationState): TasksActivationMap {
  const next = { ...map }
  if (taskActivationEmpty(state)) delete next[directory]
  else next[directory] = state
  return next
}

/** 折叠出对话框要渲染的树：每个 build 的 7 个阶段 + 可用任务 + 失效条目。 */
export function activationBuilds(map: TasksActivationMap, builds: readonly ActivationBuildInput[]): ActivationBuildNode[] {
  return builds.map(build => {
    const state = stateFor(map, build.directory)
    const known = new Set(build.tasks)
    const phases = TASK_PHASES.map(phase => ({
      phase,
      label: TASK_PHASE_LABELS[phase],
      tasks: [...state[phase]],
    }))
    const activated = TASK_PHASES.flatMap(phase => state[phase])
    const available = [...known].filter(task => !activated.includes(task)).sort((left, right) => left.localeCompare(right))
    return {
      directory: build.directory, label: build.label, phases, availableTasks: available,
      missingTasks: missingActivationTasks(map, build.directory, build.tasks),
      count: activated.length,
    }
  })
}

/** 「添加」候选的搜索过滤（大小写不敏感的子串；空查询返回全部候选）。 */
export function activationTaskOptions(node: ActivationBuildNode, query: string): string[] {
  const needle = query.trim().toLowerCase()
  if (!needle) return [...node.availableTasks]
  return node.availableTasks.filter(task => task.toLowerCase().includes(needle))
}

export function addActivation(map: TasksActivationMap, directory: string, phase: TaskPhase, taskName: string): TasksActivationMap {
  return withState(map, directory, addTaskActivation(stateFor(map, directory), phase, taskName))
}

export function removeActivation(map: TasksActivationMap, directory: string, phase: TaskPhase, taskName: string): TasksActivationMap {
  return withState(map, directory, removeTaskActivation(stateFor(map, directory), phase, taskName))
}

export function moveActivation(map: TasksActivationMap, directory: string, phase: TaskPhase, taskName: string, increment: number): TasksActivationMap {
  return moveActivations(map, [{ directory, phase, taskName }], increment)
}

/** 选中的一条激活项（`ExternalSystemTaskActivator.TaskActivationEntry` 的最小字段面）。 */
export interface ActivationEntry {
  directory: string
  phase: TaskPhase
  taskName: string
}

/**
 * 批量上移/下移（`ConfigureTasksActivationDialog.moveAction` → `ExternalSystemTaskActivator.moveTasks`，
 * `ExternalSystemTaskActivator.java:323-337`）：每条各自与相邻项交换，越界（负数 / 超出末尾）原样不动。
 * 处理顺序照 `moveSelectedRows` 的排序（`:240-264`，按行号 `× -direction`）：上移自上而下、下移自下而上，
 * 于是连选的相邻两项会整体跨过邻居，而不是只动第一条。
 */
export function moveActivations(map: TasksActivationMap, entries: readonly ActivationEntry[], increment: number): TasksActivationMap {
  if (!entries.length) return map
  const sign = increment < 0 ? 1 : -1
  const ordered = [...entries].sort((left, right) => sign * (indexIn(map, left) - indexIn(map, right)))
  let next = map
  for (const entry of ordered) {
    const state = stateFor(next, entry.directory)
    const moved = moveTaskActivation(state, entry.phase, entry.taskName, increment)
    next = moved === state ? next : withState(next, entry.directory, moved)
  }
  return next
}

/** 批量移除（`removeTasks(Collection)`，`:301-312`）：逐条 `List.remove`，同名重复条目每次只删第一处。 */
export function removeActivations(map: TasksActivationMap, entries: readonly ActivationEntry[]): TasksActivationMap {
  let next = map
  for (const entry of entries) {
    const state = stateFor(next, entry.directory)
    const removed = removeTaskActivation(state, entry.phase, entry.taskName)
    next = removed === state ? next : withState(next, entry.directory, removed)
  }
  return next
}

/**
 * 移动按钮的可用性（`ConfigureTasksActivationDialog.isMoveActionEnabled`，`:207-224`）：
 * 每条选中的任务都得有相邻项（在同阶段清单里找得到、且不越界），否则整组禁用。
 */
export function canMoveActivations(map: TasksActivationMap, entries: readonly ActivationEntry[], increment: number): boolean {
  if (!entries.length) return false
  return entries.every(entry => {
    const tasks = stateFor(map, entry.directory)[entry.phase]
    const from = tasks.indexOf(entry.taskName)
    return from >= 0 && from + increment >= 0 && from + increment < tasks.length
  })
}

/** 选中项在它所属阶段清单里的下标（排序/可用性用；找不到返回 -1）。 */
function indexIn(map: TasksActivationMap, entry: ActivationEntry): number {
  return stateFor(map, entry.directory)[entry.phase].indexOf(entry.taskName)
}

/** 激活表里的任务总数（状态栏/摘要用）。 */
export function activationCount(map: TasksActivationMap): number {
  return Object.values(map).reduce((total, state) => total + TASK_PHASES.reduce((sum, phase) => sum + state[phase].length, 0), 0)
}

/** 任务节点 tooltip：沿用 `getDescription` 的阶段串（没有激活返回 null，调用方回退任务描述）。 */
export function activationTooltip(map: TasksActivationMap, directory: string, taskName: string): string | null {
  const state = map[directory]
  return state ? taskActivationDescription(state, taskName) : null
}

/** 同步后任务表里消失的激活项（对话框以「已失效」提示，而不是悄悄隐藏）。 */
export function missingActivationTasks(map: TasksActivationMap, directory: string, knownTasks: readonly string[]): string[] {
  const state = map[directory]
  if (!state) return []
  const known = new Set(knownTasks)
  return TASK_PHASES.flatMap(phase => state[phase]).filter(task => !known.has(task) && !task.startsWith('run: '))
}

/** 对话框标题/摘要：「N 个已链接工程 · M 个激活任务」。 */
export function activationSummaryText(map: TasksActivationMap, builds: readonly ActivationBuildInput[]): string {
  const projects = builds.filter(build => !taskActivationEmpty(stateFor(map, build.directory))).length
  return `${builds.length} 个已链接工程 · ${projects} 个配置了任务激活 · 共 ${activationCount(map)} 个激活项`
}
