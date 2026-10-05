// 外部系统**节点动作矩阵**（上游 `platform/external-system-impl/src/com/intellij/openapi/externalSystem/action/`：
// `ExternalSystemAction`/`ExternalSystemNodeAction` 是所有节点动作的基类，按选中节点类型启用；
// `RunExternalSystemTaskAction`（跑任务）、`AssignRunConfigurationShortcutAction`（把任务存成运行配置）、
// `OpenExternalConfigAction`（打开构建脚本）、`RefreshExternalProjectAction`/`RefreshAllExternalProjectsAction`、
// `IgnoreExternalProjectAction`（忽略工程，配合 `ShowIgnoredAction` 显示/收起）、
// `DetachExternalProjectAction`（取消链接）、`GroupTasksAction`（按任务分组）、
// `ShowInheritedTasksAction`（显示继承任务）、`OpenTasksActivationManagerAction`（任务激活管理器）、
// `ToggleTaskActivationAction`（7 个阶段各一条，勾选态 = 该任务在该阶段已激活）、
// `EditExternalSystemRunConfigurationAction`/`RemoveExternalSystemRunConfigurationAction`（运行配置节点）。
//
// 本仓落点：`src/components/GradlePanel.vue` 的右键菜单/齿轮菜单按这里产出的行渲染
// （enabled/checked/disabledReason 全部由本模块算出，面板只画）。激活状态读的是既有模型
// `src/externalProjectModel.ts` 的 `TasksActivationMap`（面板同一份 `activationMap`），视图开关读
// `src/externalSystemViewOptions.ts`；**没有后端的能力不装成可用** —— 行会带 disabledReason。
import {
  RUN_CONFIGURATION_TASK_PREFIX, TASK_PHASE_LABELS, TASK_PHASES, taskActivationDescription,
  type TaskActivationState, type TaskPhase, type TasksActivationMap,
} from './externalProjectModel.ts'
import { groupTasksByGroup, ignoredExternalProjects, isExternalProjectIgnored, showIgnoredProjects } from './externalSystemViewOptions.ts'

export type ExternalSystemNodeKind = 'task' | 'project' | 'runConfiguration'

/** 一行菜单项（面板的按钮直接绑它）。 */
export interface ExternalSystemActionRow {
  /** 上游动作类名（判词与测试用它追根；面板不用）。 */
  id: string
  title: string
  enabled: boolean
  /** 有勾选态的动作（`ExternalSystemToggleAction` 一族）。 */
  checked?: boolean
  /** 不可用时的**可见原因**（面板放进 title 属性）。 */
  disabledReason?: string
  /** 勾选类动作要写回的阶段（`ToggleTaskActivationAction` 一族）。 */
  phase?: TaskPhase
  separatorBefore?: boolean
}

export interface ExternalSystemActionContext {
  kind: ExternalSystemNodeKind
  /** 链接目录（外部系统口径的工程键；激活表也按这个键存）。 */
  directory: string
  taskName?: string
  configurationName?: string
  /** 宿主就绪（桌面端 + 有工作区）。 */
  ready: boolean
  /** 有同步/依赖任务在跑。 */
  busy: boolean
  /** 当前激活表（面板的 `activationMap`）。 */
  activationMap: TasksActivationMap
  /** `ShowInheritedTasksAction` 的当前勾选态（缺省按开）。 */
  showInheritedTasks?: boolean
  /** 链接的工程（`DetachExternalProjectAction` 的可用性）。 */
  linked?: boolean
}

function activationState(ctx: ExternalSystemActionContext): TaskActivationState | null {
  return ctx.activationMap[ctx.directory?.replace(/\\/g, '/').replace(/\/+$/, '') ?? ''] ?? null
}

function activationRows(ctx: ExternalSystemActionContext, taskName: string, separator: boolean): ExternalSystemActionRow[] {
  const state = activationState(ctx)
  const rows = TASK_PHASES.map((phase, index): ExternalSystemActionRow => ({
    id: `ToggleTaskActivationAction.${phase}`,
    title: `激活：${TASK_PHASE_LABELS[phase]}`,
    enabled: ctx.ready,
    checked: state ? state[phase].includes(taskName) : false,
    phase,
    ...(ctx.ready ? {} : { disabledReason: '桌面端打开项目后可用。' }),
    ...(index === 0 ? { separatorBefore: separator } : {}),
  }))
  const description = state ? taskActivationDescription(state, taskName) : null
  if (description) rows.push({ id: 'TaskActivationDescription', title: `已激活阶段：${description}`, enabled: false, disabledReason: '这是状态说明，不是动作。' })
  return rows
}

/** 任务节点的动作行。 */
function taskRows(ctx: ExternalSystemActionContext): ExternalSystemActionRow[] {
  const offline = ctx.ready ? undefined : '桌面端打开项目后可用。'
  const busyReason = ctx.busy ? '有同步或依赖任务在跑，先等它结束或取消。' : undefined
  const rows: ExternalSystemActionRow[] = [
    { id: 'RunExternalSystemTaskAction', title: '运行', enabled: ctx.ready && !ctx.busy, ...(busyReason ?? offline ? { disabledReason: busyReason ?? offline } : {}) },
    { id: 'AssignRunConfigurationShortcutAction', title: '创建运行配置', enabled: ctx.ready, ...(offline ? { disabledReason: offline } : {}) },
  ]
  if (ctx.taskName) rows.push(...activationRows(ctx, ctx.taskName, true))
  return rows
}

/** 工程节点的动作行。 */
function projectRows(ctx: ExternalSystemActionContext): ExternalSystemActionRow[] {
  const offline = ctx.ready ? undefined : '桌面端打开项目后可用。'
  const busyReason = ctx.busy ? '有任务在跑，先等它结束或取消。' : undefined
  const ignored = isExternalProjectIgnored(ctx.directory, ignoredExternalProjects.value)
  return [
    { id: 'RefreshExternalProjectAction', title: '同步项目', enabled: ctx.ready && !ctx.busy, ...(busyReason ?? offline ? { disabledReason: busyReason ?? offline } : {}) },
    { id: 'RefreshAllExternalProjectsAction', title: '同步全部链接工程', enabled: ctx.ready && !ctx.busy, ...(busyReason ?? offline ? { disabledReason: busyReason ?? offline } : {}) },
    { id: 'OpenExternalConfigAction', title: '打开构建脚本', enabled: ctx.ready, ...(offline ? { disabledReason: offline } : {}) },
    { id: 'IgnoreExternalProjectAction', title: ignored ? '取消忽略工程' : '忽略工程', enabled: ctx.ready, separatorBefore: true, ...(offline ? { disabledReason: offline } : {}) },
    { id: 'ShowExternalSystemSettingsAction', title: '打开 Gradle 设置', enabled: true, separatorBefore: true },
    {
      id: 'OpenTasksActivationManagerAction', title: '配置任务激活…', enabled: ctx.ready,
      ...(offline ? { disabledReason: offline } : {}),
    },
    { id: 'DetachExternalProjectAction', title: '取消链接项目', enabled: ctx.ready && !ctx.busy && ctx.linked !== false, ...(busyReason ?? offline ? { disabledReason: busyReason ?? offline } : {}) },
  ]
}

/**
 * 工具窗口齿轮里的视图开关（上游 `ExternalSystemViewGearAction` 的三个子动作）。
 * 与节点右键菜单分开：这三个是**视图**选项，不是选中节点的动作。
 */
export function externalSystemViewGearRows(showInherited = true): ExternalSystemActionRow[] {
  return [
    { id: 'GroupTasksAction', title: '按任务分组', enabled: true, checked: groupTasksByGroup.value },
    { id: 'ShowInheritedTasksAction', title: '显示继承任务', enabled: true, checked: showInherited },
    { id: 'ShowIgnoredAction', title: '显示已忽略的工程', enabled: true, checked: showIgnoredProjects.value },
  ]
}

/** 运行配置节点的动作行（`run: <名字>` 激活项与任务同表，见 `ExternalSystemTaskActivator`）。 */
function runConfigurationRows(ctx: ExternalSystemActionContext): ExternalSystemActionRow[] {
  const offline = ctx.ready ? undefined : '桌面端打开项目后可用。'
  const rows: ExternalSystemActionRow[] = [
    { id: 'RunExternalSystemTaskAction', title: '运行', enabled: ctx.ready && !ctx.busy, ...(offline ? { disabledReason: offline } : {}) },
    { id: 'EditExternalSystemRunConfigurationAction', title: '编辑运行配置…', enabled: false, disabledReason: '运行配置编辑对话框的宿主在 App.vue，本批冻结。' },
    { id: 'RemoveExternalSystemRunConfigurationAction', title: '删除运行配置', enabled: true },
  ]
  if (ctx.configurationName) rows.push(...activationRows(ctx, `${RUN_CONFIGURATION_TASK_PREFIX}${ctx.configurationName}`, true))
  return rows
}

/** 节点 → 动作行（三类节点各有自己的动作集，对应上游按 `getNodeClass()` 的分派）。 */
export function externalSystemNodeActions(ctx: ExternalSystemActionContext): ExternalSystemActionRow[] {
  if (ctx.kind === 'task') return taskRows(ctx)
  if (ctx.kind === 'runConfiguration') return runConfigurationRows(ctx)
  return projectRows(ctx)
}

/** 勾选类动作点一下要写回的目标（配合既有的 `externalTasksActivation.ts` 的 add/remove）。 */
export function activationTargetFor(ctx: ExternalSystemActionContext, row: ExternalSystemActionRow): { directory: string; phase: TaskPhase; taskName: string } | null {
  if (!row.phase) return null
  const taskName = ctx.kind === 'runConfiguration' && ctx.configurationName
    ? `${RUN_CONFIGURATION_TASK_PREFIX}${ctx.configurationName}`
    : (ctx.taskName ?? '')
  if (!taskName) return null
  return { directory: ctx.directory, phase: row.phase, taskName }
}
