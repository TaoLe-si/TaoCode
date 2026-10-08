<script setup lang="ts">
// ExternalProjectsView / ProjectNode: each linked build owns project → Tasks/Dependencies nodes.
// Missing Tooling API/action capabilities are documented in parity-runtime-remaining.md, not fake controls.
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { Boxes, ChevronDown, ChevronRight, ChevronsDownUp, ChevronsUpDown, FileCode2, RefreshCw, Settings, Square, Unlink, Wrench } from 'lucide-vue-next'
import { gradleSync } from '../bridge.ts'
import {
  AUTO_RELOAD_GROUP_TITLE, BUILD_TOOLS_GROUP_ID, GRADLE_CONFIGURABLE_ID, GRADLE_DEPENDENCIES_NODE_NAME,
  autoReloadLabel, filterGradleDependencies, gradleOutputTail, gradleProjectTree,
  type AutoReloadType, type GradleDependency, type GradleDependencyScope, type GradleDetection,
  type GradleLinkedProject, type GradleSyncResult, type GradleTaskNode,
} from '../gradle.ts'
import { iconSize } from '../uiIcons'
// 菜单行的勾选记号 = `AllIcons.Actions.Checked`（`expui/actions/checked.svg`），不是 lucide 的 24 格图。
import { IdeaCheckedIcon } from './icons/toolWindowIcons.ts'
// 构建事件与进度树（上游 `BuildEventDispatcher`/`BuildProgress`/`BuildRootProgressImpl` 的有界子集）：
// 同步就是一类 build，把 CLI 输出折成按任务分组的进度树（`src/buildEvents.ts`）。
import { buildProgressStripe, buildProgressTree, flattenProgress, gradleBuildEvents, progressPercent, stripeProgressOf } from '../buildEvents.ts'
// 任务激活（上游 `TaskActivationState` / `ExternalSystemTaskActivator` / `ConfigureTasksActivationDialog`）：
// 状态按工作区根持久化在 src/externalProjectModel.ts，对话框树的折叠与命令在
// src/externalTasksActivation.ts，宿主是本面板（工程/任务右键「配置任务激活…」）。
import ExternalTasksActivationDialog from './ExternalTasksActivationDialog.vue'
// 依赖分析器（上游 `DependencyAnalyzerAction` + `DependencyAnalyzerViewImpl`）：模型在
// src/dependencyAnalyzer.ts（成组/告警/过滤/usages 树），窗口在本目录 DependencyAnalyzerDialog.vue。
import DependencyAnalyzerDialog from './DependencyAnalyzerDialog.vue'
import {
  activationBuilds, activationSummaryText, activationTooltip, addActivation, moveActivation, removeActivation,
  type ActivationBuildInput,
} from '../externalTasksActivation.ts'
import {
  loadTasksActivation, saveTasksActivation, tasksActivationForLinkedBuilds,
  type TaskPhase, type TasksActivationMap,
} from '../externalProjectModel.ts'
// 任务执行设置的编辑面（上游 `ExternalSystemEditTaskDialog.java:25-64` + 字段面
// `ExternalSystemTaskSettingsControl.java:66-103,145-155`）：任务节点右键「编辑任务…」写这张表，
// `gradleHost.runTask` 读它折命令/VM 选项/env（存储与消费口径见 `src/externalTaskSettings.ts` 头注）。
import {
  loadTaskSettingsMap, parseEnvironmentLines, saveTaskSettingsMap, taskDialogDefaults, taskSettingsForBuild,
  taskSettingsForLinkedBuilds, taskSettingsFromDialog, withTaskSettings,
  type TaskSettingsMap,
} from '../externalTaskSettings.ts'
import { splitScriptParameters } from '../externalSystemTask.ts'
// 节点动作矩阵（上游 `ExternalSystemNodeAction` 一族）与视图开关（`ExternalSystemViewGearAction`）：
// 右键菜单/齿轮菜单的行由 `src/externalSystemActions.ts` 产出，勾选态读同一份激活表与视图开关。
import {
  externalSystemNodeActions, externalSystemViewGearRows,
  type ExternalSystemActionRow,
} from '../externalSystemActions.ts'
import {
  isExternalProjectIgnored, setExternalProjectIgnored, setGroupTasksByGroup, setShowIgnoredProjects,
  setShowInheritedTasks, showInheritedTasks, tasksForGrouping, visibleExternalProjects,
} from '../externalSystemViewOptions.ts'
const props = defineProps<{
  detection: GradleDetection | null
  detectionError: string
  result: GradleSyncResult
  message: string
  taskGroups: Array<{ group: string; tasks: GradleTaskNode[] }>
  dependencies: GradleDependencyScope[]
  dependencyGroups: Array<{ project: string; scopes: GradleDependencyScope[] }>
  autoReload: AutoReloadType
  linkedProjects: string[]
  ready: boolean
}>()
const emit = defineEmits<{
  detect: []; sync: []; cancel: []
  refreshProject: [directory?: string]
  loadDependencies: [directory?: string]
  openConfig: [directory?: string]
  saveRunConfig: [task: string, directory?: string]
  runTask: [task: string, directory?: string]
  unlink: [directory?: string]
  openSettings: [section: 'build.tools' | 'reference.settingsdialog.project.gradle']
}>()
const builds = computed<GradleLinkedProject[]>(() => props.result.linkedProjects ?? (props.linkedProjects.length ? [{
  directory: props.linkedProjects[0]!, detection: props.detection, detectionError: props.detectionError,
  result: props.result, dependencies: props.dependencies, dependenciesLoaded: props.dependencies.length > 0, message: props.message,
}] : []))
const busy = computed(() => props.result.busy || gradleSync.running)
const selectedDirectory = ref('')
const collapsed = ref(new Set<string>())
const expandedGroups = ref(new Set<string>())
const expandedScopes = ref(new Set<string>())
const dependenciesOpen = ref(new Set<string>())
const query = ref('')
const key = (...parts: string[]) => JSON.stringify(parts)
// 被忽略的工程默认从树里收起（`ShowIgnoredAction` 打开时显示为收起态，只停刷新不删链接）。
const visibleBuilds = computed<GradleLinkedProject[]>(() => visibleExternalProjects(builds.value))
const trees = computed(() => visibleBuilds.value.map(build => ({
  build,
  ignored: isExternalProjectIgnored(build.directory),
  nodes: gradleProjectTree(build.result, filterGradleDependencies(build.dependencies, query.value)).map(node => ({
    ...node, taskGroups: tasksForGrouping(node.taskGroups),
  })),
})))
// —— 任务激活（对齐 `ExternalProjectsState` 的逐工程激活表）——
const activationOpen = ref(false)
const activationMap = ref<TasksActivationMap>({})
const activationStore = typeof localStorage === 'undefined' ? null : localStorage
watch(() => props.result.workspaceRoot, root => { activationMap.value = loadTasksActivation(activationStore, root ?? '') }, { immediate: true })
// 取消链接的 build 立即丢掉激活状态（`ExternalProjectsDataInvalidator` 的口径），避免旧路径积在磁盘上。
watch(() => props.linkedProjects, dirs => {
  if (!dirs.length) return
  const pruned = tasksActivationForLinkedBuilds(activationMap.value, dirs)
  if (JSON.stringify(pruned) !== JSON.stringify(activationMap.value)) {
    activationMap.value = pruned
    saveTasksActivation(activationStore, props.result.workspaceRoot ?? '', pruned)
  }
}, { immediate: true })
const activationInputs = computed<ActivationBuildInput[]>(() => builds.value.map(build => ({
  directory: build.directory, label: build.directory || '工作区根项目',
  tasks: build.result.tasks.map(task => task.name),
})))
const activationNodes = computed(() => activationBuilds(activationMap.value, activationInputs.value))
const activationSummary = computed(() => activationSummaryText(activationMap.value, activationInputs.value))
function persistActivation(next: TasksActivationMap) {
  activationMap.value = next
  saveTasksActivation(activationStore, props.result.workspaceRoot ?? '', next)
}
function onActivationAdd(directory: string, phase: TaskPhase, task: string) { persistActivation(addActivation(activationMap.value, directory, phase, task)) }
function onActivationRemove(directory: string, phase: TaskPhase, task: string) { persistActivation(removeActivation(activationMap.value, directory, phase, task)) }
function onActivationMove(directory: string, phase: TaskPhase, task: string, delta: number) { persistActivation(moveActivation(activationMap.value, directory, phase, task, delta)) }
/**
 * 任务节点 tooltip（一个绑定产出两段，右键「编辑任务…」与激活表都从这里回声）。
 * · 阶段串：有激活时按 `ExternalSystemTaskActivator.getDescription` 的口径追加（`activationTooltip`）。
 * · 「（已编辑）」：`ExternalSystemEditTaskDialog` 存过非默认设置的任务要标出来（`taskEditedSuffix`）。
 */
function taskActivationTitle(task: GradleTaskNode, directory: string): string {
  const phases = activationTooltip(activationMap.value, directory, task.name)
  const base = phases ? `${task.description}${task.description ? ' · ' : ''}激活：${phases}` : task.description
  return `${base}${taskEditedSuffix(directory, task.name)}`
}
// —— 任务执行设置（「编辑任务…」，上游 `ExternalSystemEditTaskDialog`；存储与执行消费见 `src/externalTaskSettings.ts`）——
const taskSettingsMap = ref<TaskSettingsMap>({})
const taskEditOpen = ref(false)
const taskEditTarget = ref<{ directory: string; task: string } | null>(null)
const taskEdit = ref({ tasksText: '', vmOptions: '', scriptParameters: '', envText: '' })
watch(() => props.result.workspaceRoot, root => { taskSettingsMap.value = loadTaskSettingsMap(activationStore, root ?? '') }, { immediate: true })
// 取消链接的 build 一并丢掉它存过的任务设置（与激活表 `tasksActivationForLinkedBuilds` 同一口径）。
watch(() => props.linkedProjects, dirs => {
  if (!dirs.length) return
  const pruned = taskSettingsForLinkedBuilds(taskSettingsMap.value, dirs)
  if (JSON.stringify(pruned) !== JSON.stringify(taskSettingsMap.value)) {
    taskSettingsMap.value = pruned
    saveTaskSettingsMap(activationStore, props.result.workspaceRoot ?? '', pruned)
  }
})
const taskEditEnvInvalid = computed(() => parseEnvironmentLines(taskEdit.value.envText).invalid)
// 任务文本按 `ParametersList.parse` 同口径切（上游 `apply` 在 `ExternalSystemTaskSettingsControl.java:146`、
// 那次 `ParametersListUtil.parse` 在 `:149`）；
// 写了字却一条任务都没解析出来（如只剩空引号）时「确定」不可用 —— 空任务列表跑不了任何东西。
const taskEditTaskNames = computed(() => splitScriptParameters(taskEdit.value.tasksText))
function openTaskEditor(directory: string, task: string) {
  taskEditTarget.value = { directory, task }
  taskEdit.value = taskDialogDefaults(taskSettingsForBuild(taskSettingsMap.value, directory, task), task)
  taskEditOpen.value = true
}
function saveTaskEditor() {
  const target = taskEditTarget.value
  if (!target) return
  const next = withTaskSettings(taskSettingsMap.value, target.directory, target.task, taskSettingsFromDialog(taskEdit.value))
  taskSettingsMap.value = next
  saveTaskSettingsMap(activationStore, props.result.workspaceRoot ?? '', next)
  taskEditOpen.value = false
}
function taskEditedSuffix(directory: string, task: string): string {
  return taskSettingsForBuild(taskSettingsMap.value, directory, task) ? '（已编辑）' : ''
}
watch(() => props.result.workspaceRoot, () => {
  selectedDirectory.value = props.linkedProjects[0] ?? ''
  collapsed.value = new Set(); expandedGroups.value = new Set(); expandedScopes.value = new Set()
  dependenciesOpen.value = new Set(); query.value = ''; closeMenu()
})
watch(() => props.linkedProjects, dirs => {
  if (!dirs.includes(selectedDirectory.value)) selectedDirectory.value = dirs[0] ?? ''
}, { immediate: true })
function toggle(set: Set<string>, value: string) { if (set.has(value)) set.delete(value); else set.add(value) }
function expandAll() {
  collapsed.value.clear()
  for (const { build, nodes } of trees.value) {
    for (const node of nodes) {
      node.taskGroups.forEach(group => expandedGroups.value.add(key(build.directory, node.project.path, group.group)))
      node.scopes.forEach(scope => expandedScopes.value.add(key(build.directory, node.project.path, scope.configuration)))
    }
    dependenciesOpen.value.add(build.directory)
    if (!build.dependenciesLoaded) emit('loadDependencies', build.directory)
  }
}
function collapseAll() {
  collapsed.value = new Set(builds.value.map(build => key(build.directory)))
  expandedGroups.value.clear(); expandedScopes.value.clear(); dependenciesOpen.value.clear()
}
function toggleDependencies(build: GradleLinkedProject) {
  toggle(dependenciesOpen.value, build.directory)
  if (dependenciesOpen.value.has(build.directory) && !build.dependenciesLoaded) emit('loadDependencies', build.directory)
}
function runTask(task: GradleTaskNode, directory: string) { emit('runTask', task.name, directory) }
function dependencySuffix(dependency: GradleDependency): string {
  return [dependency.resolved ? `→ ${dependency.resolved}` : '', dependency.duplicate ? '(*)' : '',
    dependency.constraint ? '(c)' : '', dependency.unresolved ? '(n)' : ''].filter(Boolean).join(' ')
}
const menu = ref<{ x: number; y: number; kind: 'project' | 'task'; directory: string; task?: string } | null>(null)
const settingsMenu = ref(false)
function openMenu(event: MouseEvent, kind: 'project' | 'task', directory: string, task?: string) {
  event.preventDefault()
  selectedDirectory.value = directory
  menu.value = { x: event.clientX, y: event.clientY, kind, directory, task }
  settingsMenu.value = false
}
function closeMenu() { menu.value = null; settingsMenu.value = false }
// 右键菜单的行由动作矩阵算出（enabled/checked/disabledReason 全在 src/externalSystemActions.ts）。
const menuRows = computed<ExternalSystemActionRow[]>(() => {
  const target = menu.value
  if (!target) return []
  return externalSystemNodeActions({
    kind: target.kind === 'task' ? 'task' : 'project',
    directory: target.directory, taskName: target.task,
    ready: props.ready, busy: busy.value, activationMap: activationMap.value,
    showInheritedTasks: showInheritedTasks.value, linked: props.linkedProjects.includes(target.directory),
  })
})
function toggleActivation(directory: string, taskName: string, phase: TaskPhase, checked: boolean) {
  persistActivation(checked
    ? removeActivation(activationMap.value, directory, phase, taskName)
    : addActivation(activationMap.value, directory, phase, taskName))
}
function menuAction(row: ExternalSystemActionRow) {
  const target = menu.value
  closeMenu()
  if (!target) return
  if (row.id.startsWith('ToggleTaskActivationAction.') && row.phase && target.task) {
    toggleActivation(target.directory, target.task, row.phase, row.checked === true)
    return
  }
  if (row.id === 'RunExternalSystemTaskAction' && target.task) emit('runTask', target.task, target.directory)
  if (row.id === 'AssignRunConfigurationShortcutAction' && target.task) emit('saveRunConfig', target.task, target.directory)
  // 「编辑任务…」= 上游 `ExternalSystemBeforeRunTaskProvider.java:59-60` 开 `ExternalSystemEditTaskDialog` 的那一步。
  if (row.id === 'EditExternalSystemTaskAction' && target.task) openTaskEditor(target.directory, target.task)
  if (row.id === 'OpenExternalConfigAction') emit('openConfig', target.directory)
  if (row.id === 'RefreshExternalProjectAction') emit('refreshProject', target.directory)
  if (row.id === 'RefreshAllExternalProjectsAction') emit('sync')
  if (row.id === 'IgnoreExternalProjectAction') setExternalProjectIgnored(target.directory, !isExternalProjectIgnored(target.directory))
  if (row.id === 'ShowExternalSystemSettingsAction') emit('openSettings', GRADLE_CONFIGURABLE_ID)
  // `ExternalSystemView.ProjectMenu`/`TaskMenu` 都挂 `OpenTasksActivationManagerAction`。
  if (row.id === 'OpenTasksActivationManagerAction') activationOpen.value = true
  if (row.id === 'DetachExternalProjectAction') emit('unlink', target.directory)
}
// 齿轮里的视图开关（上游 `ExternalSystemViewGearAction` 的三个子动作）。
const gearRows = computed(() => externalSystemViewGearRows(showInheritedTasks.value))
function gearAction(row: ExternalSystemActionRow) {
  settingsMenu.value = false
  if (row.id === 'GroupTasksAction') setGroupTasksByGroup(row.checked !== true)
  if (row.id === 'ShowInheritedTasksAction') setShowInheritedTasks(row.checked !== true)
  if (row.id === 'ShowIgnoredAction') setShowIgnoredProjects(row.checked !== true)
}
function onKeydown(event: KeyboardEvent) {
  if (event.key === 'Escape') { closeMenu(); query.value = ''; taskEditOpen.value = false }
}
const now = ref(Date.now())
let ticker: ReturnType<typeof setInterval> | null = null
onMounted(() => {
  window.addEventListener('click', closeMenu)
  if (gradleSync.running) ticker = setInterval(() => { now.value = Date.now() }, 1000)
})
watch(() => gradleSync.running, running => {
  if (running) { now.value = Date.now(); if (!ticker) ticker = setInterval(() => { now.value = Date.now() }, 1000) }
  else if (ticker) { clearInterval(ticker); ticker = null }
})
onBeforeUnmount(() => { if (ticker) clearInterval(ticker); if (typeof window !== 'undefined') window.removeEventListener('click', closeMenu) })
const syncSeconds = computed(() => Math.max(0, Math.round((now.value - gradleSync.startedAt) / 1000)))
const outputTail = computed(() => gradleSync.running ? gradleOutputTail(gradleSync.output, 6) : [])
const tailOpen = ref(true)
/**
 * 同步输出的**进度树**（上游 `BuildTreeConsoleView` 按 `parentId` 渲染的那棵树）：
 * 从 `gradleSync.output` 折出任务边界与结论；折不出任务时返回 null，模板退回平铺尾部。
 * 同步进行中不发根节点结论（`running` 那一档）。
 */
const buildProgress = computed(() => buildProgressTree(gradleBuildEvents({
  output: gradleSync.output,
  startedAt: gradleSync.startedAt || Date.now(),
  label: gradleSync.command || 'Gradle 同步',
  running: gradleSync.running,
  finishedAt: gradleSync.at || undefined,
  // 最后一条无后缀任务的收口证据：退出码 0（或总结果行成功）；取消不算。
  exitCode: gradleSync.exit,
  cancelled: gradleSync.cancelled,
})))
/** 进度树里深度 > 0 的任务行（根节点就是整次同步，不重复画）。 */
const buildTaskRows = computed(() => buildProgress.value
  ? flattenProgress(buildProgress.value).filter(row => row.depth > 0).map(row => ({
    id: row.node.id,
    depth: row.depth,
    message: row.node.message,
    result: row.node.result,
    percent: progressPercent(row.node),
  }))
  : [])
const rootPercent = computed(() => buildProgress.value ? progressPercent(buildProgress.value) : -1)
/**
 * 进度树头部那条**进度条**（上游 `BuildProgressStripe.updateProgress` 的判定表）：
 * `(total, progress)` 由 `stripeProgressOf` 从这棵树现算（任务数 / 已有结论的任务数）——
 * 节点的 progress 事件本仓没有（CLI 输出不给数字），所以头部原来那条百分比一直是空的。
 * 折不出任务（`total === progress === 0`）时按判定表是「收工 + 满格」，但那时整块树不渲染。
 */
const buildStripe = computed(() => {
  const tree = buildProgress.value
  if (!tree) return null
  const { total, progress } = stripeProgressOf(tree)
  return buildProgressStripe(total, progress)
})
/** 节点结论 → 一行文案（上游 `BuildTreeConsoleView` 的收尾行；未结束是空串）。 */
function buildResultLabel(result: { kind: string; message?: string } | null | undefined): string {
  if (!result) return ''
  if (result.kind === 'success') return '成功'
  if (result.kind === 'failure') return `失败${result.message ? `：${result.message}` : ''}`
  if (result.kind === 'cancelled') return '已取消'
  return '已跳过'
}
/** 结论 → 标记字符（成功/失败/跳过/进行中）。 */
function buildResultMark(result: { kind: string }): string {
  if (result.kind === 'success') return '✓'
  if (result.kind === 'failure') return '✕'
  if (result.kind === 'cancelled') return '■'
  return '–'
}
const syncedAt = computed(() => props.result.at ? new Date(props.result.at).toLocaleTimeString('zh-CN', { hour12: false }) : '')
// —— 依赖分析器（上游 `DependencyAnalyzerManager.getOrCreate` 打开虚拟文件编辑器页）——
// 入口是对选中 build 的「依赖分析…」；数据就是面板已经加载的 `gradle dependencies`。
const analyzerOpen = ref(false)
const analyzerBuild = computed(() => builds.value.find(build => build.directory === selectedDirectory.value) ?? builds.value[0] ?? null)
const analyzerModuleName = computed(() => (analyzerBuild.value?.directory || '根项目').split('/').filter(Boolean).pop() ?? '根项目')
</script>

<template>
  <div class="gradle-panel" @keydown="onKeydown">
    <div class="panel-heading"><span><Boxes :size="iconSize.control" />Gradle</span><span class="heading-count">{{ syncedAt }}</span></div>
    <div class="gradle-toolbar" role="group" aria-label="Gradle 工具条">
      <button class="subtle-button" :disabled="!ready || busy" @click="emit('sync')"><RefreshCw aria-hidden="true" :size="iconSize.menu" />同步</button>
      <button v-if="busy" class="subtle-button" title="取消当前命令和待运行队列" @click="emit('cancel')"><Square aria-hidden="true" :size="iconSize.menu" />取消</button>
      <button class="subtle-button" :disabled="!ready || busy || !linkedProjects.includes(selectedDirectory)" title="取消链接选中的 Gradle 工程" @click="emit('unlink', selectedDirectory)"><Unlink aria-hidden="true" :size="iconSize.menu" />取消链接</button>
      <button class="subtle-button" :disabled="!analyzerBuild?.dependenciesLoaded" @click="analyzerOpen = true"><Boxes aria-hidden="true" :size="iconSize.menu" />依赖分析…</button>
      <span class="gradle-separator" aria-hidden="true" />
      <button class="icon-button" title="全部展开" aria-label="全部展开" @click="expandAll"><ChevronsUpDown :size="iconSize.control" /></button>
      <button class="icon-button" title="全部折叠" aria-label="全部折叠" @click="collapseAll"><ChevronsDownUp :size="iconSize.control" /></button>
      <div class="gradle-settings">
        <button class="icon-button" title="设置" aria-label="设置" :aria-expanded="settingsMenu" @click.stop="settingsMenu = !settingsMenu"><Settings :size="iconSize.control" /></button>
        <div v-if="settingsMenu" class="gradle-menu gradle-settings-menu" role="menu">
          <button role="menuitem" @click="emit('openSettings', BUILD_TOOLS_GROUP_ID)">公共设置</button>
          <button role="menuitem" @click="emit('openSettings', GRADLE_CONFIGURABLE_ID)">Gradle</button>
          <div class="gradle-menu-rule" role="separator" />
          <button v-for="row in gearRows" :key="row.id" role="menuitemcheckbox" :aria-checked="row.checked === true" @click="gearAction(row)"><span class="gradle-menu-check"><IdeaCheckedIcon v-if="row.checked" :size="iconSize.dense" :aria-hidden="true" /></span>{{ row.title }}</button>
        </div>
      </div>
    </div>
    <label class="gradle-search">依赖过滤<input v-model="query" type="search" aria-label="Gradle 依赖过滤" placeholder="名称、配置或解析版本" /></label>
    <p class="gradle-summary">{{ AUTO_RELOAD_GROUP_TITLE }}：{{ autoReloadLabel(autoReload) }}</p>
    <p v-if="!ready" class="gradle-empty">浏览器预览不能运行 Gradle 同步，请在桌面端打开一个项目。</p>
    <p v-if="gradleSync.running" class="gradle-running"><RefreshCw :size="iconSize.dense" />正在跑：<code>{{ gradleSync.command }}</code><span aria-live="polite">已 {{ syncSeconds }} 秒</span></p>
    <p v-else-if="message" class="gradle-note">{{ message }}</p>
    <!-- 构建进度树（上游 BuildTreeConsoleView）：按任务分组的同步进度；任务边界折不出来时退回平铺尾部。 -->
    <div v-if="buildTaskRows.length" class="gradle-build-tree" role="tree" aria-label="同步进度">
      <div class="gradle-build-head"><span class="gradle-build-title">{{ buildProgress?.message }}</span>
        <span v-if="buildProgress?.result" class="gradle-build-result" :class="{ failed: buildProgress.result.kind === 'failure' }">{{ buildResultLabel(buildProgress.result) }}</span>
        <span v-if="rootPercent >= 0" class="gradle-build-pct">{{ rootPercent }}%</span>
        <!-- 根节点自己没有 progress 事件（CLI 不给数字）时，头部百分比取进度条那条：任务完成度。 -->
        <span v-else-if="buildStripe?.determinate" class="gradle-build-pct">{{ buildStripe.percent }}%</span>
      </div>
      <!-- 进度条本体（上游 `BuildProgressStripe`）：确定态给填充宽度；不确定态只留轨道
           （"还在动"的信号是面板上方原有的「正在跑」行 + 它那个转圈图标，这里不做假动画）。 -->
      <span v-if="buildStripe" class="gradle-build-stripe" role="progressbar" aria-label="构建进度"
        :aria-busy="buildStripe.loading" :aria-valuenow="buildStripe.determinate ? buildStripe.percent : undefined"
        :data-busy="buildStripe.determinate ? 'false' : 'true'">
        <span class="gradle-build-stripe-fill" :style="buildStripe.determinate ? { width: `${buildStripe.percent}%` } : undefined" />
      </span>
      <p v-for="row in buildTaskRows" :key="row.id" class="gradle-build-row" role="treeitem" :style="{ paddingLeft: `${row.depth * 12}px` }" :title="row.message">
        <span class="gradle-build-mark" :class="row.result ? `is-${row.result.kind}` : 'is-running'" aria-hidden="true">{{ row.result ? buildResultMark(row.result) : '…' }}</span>
        <span class="gradle-build-task">{{ row.message }}</span>
        <span v-if="row.result && row.result.upToDate" class="gradle-build-updated">最新</span>
        <span v-if="row.percent >= 0" class="gradle-build-pct">{{ row.percent }}%</span>
      </p>
    </div>
    <div v-if="outputTail.length" class="gradle-tail">
      <button class="gradle-group-toggle" :aria-expanded="tailOpen" @click="tailOpen = !tailOpen">同步输出</button>
      <pre v-if="tailOpen" class="gradle-tail-body">{{ outputTail.join('\n') }}</pre>
    </div>
    <div class="gradle-body" role="tree" aria-label="Gradle 链接工程">
      <section v-for="{ build, ignored, nodes } in trees" :key="build.directory" class="gradle-section" role="treeitem" :aria-expanded="!collapsed.has(key(build.directory))">
        <button class="gradle-group-toggle" :class="{ selected: selectedDirectory === build.directory }" :aria-current="selectedDirectory === build.directory ? 'true' : undefined" @click="selectedDirectory = build.directory; toggle(collapsed, key(build.directory))" @contextmenu.prevent="openMenu($event, 'project', build.directory)">
          <component aria-hidden="true" :is="collapsed.has(key(build.directory)) ? ChevronRight : ChevronDown" :size="iconSize.dense" /><Boxes aria-hidden="true" :size="iconSize.inline" />{{ build.directory || '工作区根项目' }}<span v-if="ignored" class="gradle-ignored">已忽略</span>
        </button>
        <div v-if="!collapsed.has(key(build.directory))" role="group" class="gradle-children">
          <p v-if="build.detection" class="gradle-detail">{{ build.detection.distributionVersion ? `Gradle ${build.detection.distributionVersion}` : '本机/包装器' }} · {{ build.detection.buildFiles.join('、') }}</p>
          <p v-if="build.detectionError || build.result.error" class="gradle-error">{{ build.detectionError || build.result.error }}</p>
          <p v-else-if="build.message" class="gradle-note">{{ build.message }}</p>
          <p v-if="!nodes.length" class="gradle-empty-inline">{{ busy ? '同步中…工程结构要等这一次跑完。' : '还没有工程模型。' }}</p>
          <div v-for="node in nodes" :key="node.project.path" role="treeitem" :aria-expanded="!collapsed.has(key(build.directory, node.project.path))" class="gradle-module">
            <button class="gradle-group-toggle" @click="toggle(collapsed, key(build.directory, node.project.path))" @contextmenu.prevent="openMenu($event, 'project', build.directory)">
              <component aria-hidden="true" :is="collapsed.has(key(build.directory, node.project.path)) ? ChevronRight : ChevronDown" :size="iconSize.dense" /><Wrench aria-hidden="true" :size="iconSize.inline" />{{ node.project.name }}<span class="gradle-path">{{ node.project.path }}</span>
            </button>
            <div v-if="!collapsed.has(key(build.directory, node.project.path))" role="group" class="gradle-children">
              <h4>Tasks</h4>
              <p v-if="!node.taskGroups.length" class="gradle-empty-inline">{{ busy ? '同步中…任务表要等这一次跑完。' : '没有报告的任务。' }}</p>
              <div v-for="group in node.taskGroups" :key="group.group">
                <button class="gradle-group-toggle" :aria-expanded="expandedGroups.has(key(build.directory, node.project.path, group.group))" @click="toggle(expandedGroups, key(build.directory, node.project.path, group.group))"><component aria-hidden="true" :is="expandedGroups.has(key(build.directory, node.project.path, group.group)) ? ChevronDown : ChevronRight" :size="iconSize.dense" />{{ group.group }}</button>
                <ul v-if="expandedGroups.has(key(build.directory, node.project.path, group.group))" class="gradle-list" role="group">
                  <li v-for="task in group.tasks" :key="task.name" role="treeitem"><button class="gradle-task" :title="taskActivationTitle(task, build.directory)" @dblclick="runTask(task, build.directory)" @keydown.enter="runTask(task, build.directory)" @contextmenu.stop="openMenu($event, 'task', build.directory, task.name)">{{ task.name }}</button><span class="gradle-desc">{{ task.description }}</span></li>
                </ul>
              </div>
              <button class="gradle-group-toggle" :aria-expanded="dependenciesOpen.has(build.directory)" @click="toggleDependencies(build)"><component aria-hidden="true" :is="dependenciesOpen.has(build.directory) ? ChevronDown : ChevronRight" :size="iconSize.dense" />{{ GRADLE_DEPENDENCIES_NODE_NAME }}</button>
              <div v-if="dependenciesOpen.has(build.directory)" role="group">
                <p v-if="!build.dependenciesLoaded" class="gradle-empty-inline">{{ busy ? (/dependencies\b/.test(gradleSync.command) ? '正在加载依赖…' : '依赖加载已排队，等待当前命令。') : '依赖尚未加载。' }}</p>
                <p v-else-if="!node.scopes.length" class="gradle-empty-inline">{{ query ? '没有匹配的已加载依赖。' : '此项目没有报告的依赖配置。' }}</p>
                <div v-for="scope in node.scopes" :key="scope.configuration">
                  <button class="gradle-group-toggle" :title="scope.description" :aria-expanded="Boolean(query) || expandedScopes.has(key(build.directory, node.project.path, scope.configuration))" @click="toggle(expandedScopes, key(build.directory, node.project.path, scope.configuration))">{{ scope.configuration }}<span v-if="scope.unresolved">(n)</span></button>
                  <ul v-if="query || expandedScopes.has(key(build.directory, node.project.path, scope.configuration))" class="gradle-list" role="group">
                    <li v-if="scope.empty" role="treeitem">No dependencies</li>
                    <li v-for="(dependency, index) in scope.dependencies" :key="index" role="treeitem" :style="{ paddingLeft: `${dependency.depth * 14}px` }"><FileCode2 :size="iconSize.inline" />{{ dependency.name }}<span class="gradle-desc">{{ dependencySuffix(dependency) }}</span></li>
                  </ul>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>
    </div>
    <div v-if="menu" class="gradle-menu gradle-context" role="menu" :style="{ left: `${menu.x}px`, top: `${menu.y}px` }">
      <template v-for="row in menuRows" :key="row.id">
        <div v-if="row.separatorBefore" class="gradle-menu-rule" role="separator" />
        <button role="menuitem" :disabled="!row.enabled" :title="row.disabledReason || row.title" @click="menuAction(row)"><span class="gradle-menu-check"><IdeaCheckedIcon v-if="row.checked" :size="iconSize.dense" :aria-hidden="true" /></span>{{ row.title }}</button>
      </template>
    </div>
    <ExternalTasksActivationDialog v-if="activationOpen" :builds="activationNodes" :summary="activationSummary"
      @close="activationOpen = false" @add="onActivationAdd" @remove="onActivationRemove" @move="onActivationMove" />
    <!-- 任务编辑对话框（上游 `ExternalSystemEditTaskDialog`：标题 properties:134 `Edit {0} Task`；
         字段面 `ExternalSystemTaskSettingsControl.java:66-103` 的 项目/任务/VM 选项/参数/环境变量。
         `passParentEnvs` 勾选不渲染：本仓通道只能「在继承来的环境之上叠」，画了就是假控件。 -->
    <div v-if="taskEditOpen && taskEditTarget" class="modal-backdrop" @click.self="taskEditOpen = false">
      <section class="task-editor" role="dialog" aria-modal="true" aria-label="编辑 Gradle 任务">
        <h3>编辑 Gradle 任务</h3>
        <label class="task-editor-field"><span>Gradle 项目：</span>
          <input :value="`${result.workspaceRoot || ''}${taskEditTarget.directory ? `/${taskEditTarget.directory}` : ''}`" readonly aria-label="Gradle 项目" /></label>
        <label class="task-editor-field"><span>任务：</span><input v-model="taskEdit.tasksText" aria-label="任务" /></label>
        <label class="task-editor-field"><span>VM 选项：</span><input v-model="taskEdit.vmOptions" aria-label="VM 选项" /></label>
        <label class="task-editor-field"><span>参数：</span><input v-model="taskEdit.scriptParameters" aria-label="参数" /></label>
        <label class="task-editor-field"><span>环境变量：</span><textarea v-model="taskEdit.envText" rows="3" aria-label="环境变量" placeholder="每行一个 KEY=VALUE" /></label>
        <p v-if="taskEditEnvInvalid.length" class="gradle-error">无效的环境变量行：{{ taskEditEnvInvalid.join('、') }}</p>
        <div class="task-editor-actions">
          <button class="subtle-button" :disabled="taskEditTaskNames.length === 0 && taskEdit.tasksText.trim() !== ''" @click="saveTaskEditor">确定</button>
          <button class="subtle-button" @click="taskEditOpen = false">取消</button>
        </div>
      </section>
    </div>
    <DependencyAnalyzerDialog v-if="analyzerOpen && analyzerBuild" :scopes="analyzerBuild.dependencies"
      :module-name="analyzerModuleName" :project-label="analyzerBuild.directory || '工作区根项目'" @close="analyzerOpen = false" />
  </div>
</template>

<style scoped>
.gradle-panel { display:flex; flex-direction:column; flex:1; min-width:0; min-height:0; }
.gradle-panel > .panel-heading { background:var(--panel); border-bottom-color:var(--line-strong); }
.heading-count { margin-left:auto; color:var(--muted); font:10px var(--font-mono); font-variant-numeric:tabular-nums; }
.gradle-toolbar { display:flex; flex-wrap:wrap; align-items:center; gap:var(--space-1); padding:var(--space-2) var(--space-3); border-bottom:1px solid var(--line-strong); background:var(--rail); }
.gradle-separator { width:1px; height:var(--ctrl-height-sm); background:var(--line-strong); }
.gradle-settings { position:relative; }
.gradle-search { display:flex; align-items:center; gap:var(--space-1); min-height:var(--ctrl-height); margin:var(--space-2) var(--space-3) 0; padding:var(--space-1) var(--space-2); border:1px solid var(--line-strong); border-radius:var(--radius-xs); background:var(--editor); color:var(--secondary); font-size:11px; }
.gradle-search:focus-within { border-color:var(--accent); }
.gradle-search input { min-width:0; flex:1; padding:0; border:0; outline:0; background:transparent; color:var(--text); font:inherit; }
.gradle-summary { margin:var(--space-2) var(--space-2) 0; padding:var(--space-1) var(--space-2); border-left:2px solid var(--accent); background:var(--panel); color:var(--secondary); font-size:11px; overflow-wrap:anywhere; }
.gradle-detail, .gradle-note, .gradle-empty-inline { margin:0; padding:var(--space-1) var(--space-3); color:var(--muted); font-size:11px; overflow-wrap:anywhere; }
.gradle-empty-inline { border-left:2px solid var(--line); }
.gradle-empty { margin:var(--space-2); padding:var(--space-2) var(--space-3); border-left:2px solid var(--warning); background:var(--panel); color:var(--secondary); font-size:11px; line-height:1.5; }
.gradle-error { margin:var(--space-1) 0; padding:var(--space-2) var(--space-3); border-left:2px solid var(--error); background:var(--panel); color:var(--error); white-space:pre-line; font-size:11px; }
.gradle-running { display:flex; align-items:center; flex-wrap:wrap; gap:var(--space-2); margin:var(--space-2); padding:var(--space-2) var(--space-3); border-left:2px solid var(--accent); background:var(--panel); color:var(--secondary); font-size:11px; }
.gradle-running svg { flex-shrink:0; color:var(--accent); }
.gradle-body { flex:1; min-height:0; overflow:auto; padding:0 var(--space-2); }
.gradle-section { border-bottom:1px solid var(--line); padding:var(--space-1) 0; }
.gradle-children { padding-left:var(--space-4); }
.gradle-group-toggle { display:flex; align-items:center; gap:var(--space-2); width:100%; min-height:var(--ctrl-height-sm); border:0; border-radius:0; padding:var(--space-1) var(--space-2); text-align:left; background:transparent; color:var(--text); font-size:11px; cursor:pointer; transition:background-color var(--dur-1) var(--ease), color var(--dur-1) var(--ease); }
.gradle-group-toggle:hover, .gradle-task:hover { background:var(--hover); }
.gradle-group-toggle.selected { background:var(--selected); color:var(--bright); box-shadow:inset 2px 0 0 var(--accent); }
.gradle-section > .gradle-group-toggle { color:var(--bright); font-weight:650; }
.gradle-module { border-top:1px solid var(--line); }
.gradle-module > .gradle-group-toggle { color:var(--secondary); font-weight:600; }
.gradle-module > .gradle-children > .gradle-group-toggle, .gradle-module > .gradle-children > div > .gradle-group-toggle { color:var(--secondary); font-weight:600; }
.gradle-list { margin:0; padding:0 var(--space-2); list-style:none; font:11px/1.7 var(--font-mono); }
.gradle-list > li { display:flex; align-items:center; gap:var(--space-2); min-width:0; min-height:var(--ctrl-height-sm); padding:var(--space-1) var(--space-2); border-bottom:1px solid var(--line); color:var(--text); }
.gradle-list > li:last-child { border-bottom:0; }
.gradle-list > li > svg { flex-shrink:0; color:var(--muted); }
.gradle-body h4 { margin:var(--space-2) var(--space-2) var(--space-1); padding-bottom:var(--space-1); border-bottom:1px solid var(--line); color:var(--secondary); font-size:11px; font-weight:650; }
.gradle-task { border:0; border-radius:var(--radius-xs); padding:var(--space-1); background:transparent; color:var(--bright); font:inherit; text-align:left; cursor:pointer; }
.gradle-path, .gradle-desc { min-width:0; margin-left:var(--space-1); color:var(--muted); font-size:10px; overflow-wrap:anywhere; }
.gradle-tail-body { margin:0; padding:var(--space-2); font:10px/1.6 var(--font-mono); white-space:pre-wrap; overflow-wrap:anywhere; }
.gradle-build-tree { margin:var(--space-2); padding:var(--space-2) var(--space-3); border:1px solid var(--line); border-left:2px solid var(--accent); border-radius:0; background:var(--panel); font-size:11px; }
.gradle-build-head { display:flex; align-items:center; gap:var(--space-2); padding-bottom:var(--space-1); border-bottom:1px solid var(--line); color:var(--muted); }
.gradle-build-title { flex:1; min-width:0; font-weight:600; color:var(--text); overflow-wrap:anywhere; }
.gradle-build-result.failed { color:var(--error); }
.gradle-build-pct { margin-left:auto; color:var(--muted); font-variant-numeric:tabular-nums; }
/* 进度条（`BuildProgressStripe`）：几何照本仓既有的那一条进度条
   （`DebugProgressPane.vue` 的 `.debug-progress-track`：4px 高 + `--radius-pill` + `--rail` 轨道 + `--accent` 填充），
   不新造一套尺寸。不确定态只留轨道（"还在动"由上方「正在跑」行与它的转圈图标表达，不做假动画）。 */
.gradle-build-stripe { display:block; height:4px; margin:var(--space-1) 0; border-radius:var(--radius-pill); background:var(--rail); overflow:hidden; }
.gradle-build-stripe-fill { display:block; height:100%; border-radius:var(--radius-pill); background:var(--accent); }
.gradle-build-stripe[data-busy='true'] .gradle-build-stripe-fill { display:none; }
.gradle-build-row { display:flex; align-items:center; gap:var(--space-2); min-height:var(--ctrl-height-sm); margin:0; padding:var(--space-1) 0; }
.gradle-build-mark { flex:0 0 10px; text-align:center; }
.gradle-build-mark.is-success { color:var(--success); }
.gradle-build-mark.is-failure { color:var(--error); }
.gradle-build-mark.is-running { color:var(--accent); }
.gradle-build-mark.is-cancelled, .gradle-build-mark.is-skipped { color:var(--muted); }
.gradle-build-task { flex:1; min-width:0; overflow-wrap:anywhere; }
.gradle-build-updated { color:var(--muted); font-size:10px; }
.gradle-menu { position:absolute; z-index:40; display:flex; flex-direction:column; min-width:160px; padding: var(--space-1); background:var(--popup-background); color:var(--popup-foreground); border:var(--popup-border); border-radius:var(--popup-radius); box-shadow:var(--popup-shadow); }
.gradle-menu button { border:0; padding: var(--space-1); color:var(--text); background:transparent; text-align:left; font-size:11px; }
.gradle-menu button:hover { background:var(--hover); }
.gradle-menu button:disabled { color:var(--muted); cursor:default; }
.gradle-menu button:disabled:hover { background:transparent; }
.gradle-menu-rule { height:1px; margin: var(--space-1) 2px; background:var(--line); }
.gradle-menu-check { display:inline-block; width:12px; color:var(--accent,var(--bright)); }
.gradle-ignored { margin-left:auto; color:var(--muted); font-size:10px; }
.gradle-settings-menu { right:0; top:100%; }
.gradle-context { position:fixed; }
.task-editor { display:flex; flex-direction:column; gap:var(--space-2); width:520px; max-width:100%; padding:var(--space-3); background:var(--elevated); border:1px solid var(--line-strong); border-radius:var(--radius-lg); box-shadow:var(--shadow-3); }
.task-editor h3 { margin:0; font-size:13px; }
.task-editor-field { display:flex; align-items:flex-start; gap:var(--space-2); font-size:12px; }
.task-editor-field span { flex:0 0 96px; color:var(--muted); }
.task-editor-field input, .task-editor-field textarea { flex:1; min-width:0; background:var(--editor); color:var(--text); border:1px solid var(--line); padding: var(--space-1); font:12px/1.5 var(--font-mono); }
.task-editor-field input[readonly] { color:var(--muted); }
.task-editor-actions { display:flex; justify-content:flex-end; gap:var(--space-1); }
</style>
