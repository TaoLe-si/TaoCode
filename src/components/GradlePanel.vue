<script setup lang="ts">
// ExternalProjectsView / ProjectNode: each linked build owns project → Tasks/Dependencies nodes.
// Missing Tooling API/action capabilities are documented in parity-runtime-remaining.md, not fake controls.
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { Boxes, Check, ChevronDown, ChevronRight, ChevronsDownUp, ChevronsUpDown, FileCode2, RefreshCw, Settings, Square, Unlink, Wrench } from 'lucide-vue-next'
import { gradleSync } from '../bridge.ts'
import {
  AUTO_RELOAD_GROUP_TITLE, BUILD_TOOLS_GROUP_ID, GRADLE_CONFIGURABLE_ID, GRADLE_DEPENDENCIES_NODE_NAME,
  autoReloadLabel, filterGradleDependencies, gradleOutputTail, gradleProjectTree,
  type AutoReloadType, type GradleDependency, type GradleDependencyScope, type GradleDetection,
  type GradleLinkedProject, type GradleSyncResult, type GradleTaskNode,
} from '../gradle.ts'
import { iconSize } from '../uiIcons'
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
      <button class="subtle-button" :disabled="!ready || busy" title="同步全部链接工程（RefreshAllProjects）" @click="emit('sync')"><RefreshCw :size="iconSize.menu" />同步</button>
      <button v-if="busy" class="subtle-button" title="取消当前命令和待运行队列" @click="emit('cancel')"><Square :size="iconSize.menu" />取消</button>
      <button class="subtle-button" :disabled="!ready || busy || !linkedProjects.includes(selectedDirectory)" title="取消链接选中的 Gradle 工程" @click="emit('unlink', selectedDirectory)"><Unlink :size="iconSize.menu" />取消链接</button>
      <button class="subtle-button" :disabled="!analyzerBuild?.dependenciesLoaded" title="依赖分析器（DependencyAnalyzerAction）：按坐标成组的已解析依赖与用法" @click="analyzerOpen = true"><Boxes :size="iconSize.menu" />依赖分析…</button>
      <span class="gradle-separator" aria-hidden="true" />
      <button class="icon-button" title="全部展开" aria-label="全部展开" @click="expandAll"><ChevronsUpDown :size="iconSize.control" /></button>
      <button class="icon-button" title="全部折叠" aria-label="全部折叠" @click="collapseAll"><ChevronsDownUp :size="iconSize.control" /></button>
      <div class="gradle-settings">
        <button class="icon-button" title="设置" aria-label="设置" :aria-expanded="settingsMenu" @click.stop="settingsMenu = !settingsMenu"><Settings :size="iconSize.control" /></button>
        <div v-if="settingsMenu" class="gradle-menu gradle-settings-menu" role="menu">
          <button role="menuitem" @click="emit('openSettings', BUILD_TOOLS_GROUP_ID)">公共设置</button>
          <button role="menuitem" @click="emit('openSettings', GRADLE_CONFIGURABLE_ID)">Gradle</button>
          <div class="gradle-menu-rule" role="separator" />
          <button v-for="row in gearRows" :key="row.id" role="menuitemcheckbox" :aria-checked="row.checked === true" @click="gearAction(row)"><span class="gradle-menu-check"><Check v-if="row.checked" :size="iconSize.dense" :aria-hidden="true" /></span>{{ row.title }}</button>
        </div>
      </div>
    </div>
    <label class="gradle-search">依赖过滤<input v-model="query" type="search" aria-label="Gradle 依赖过滤" placeholder="名称、配置或解析版本" /></label>
    <p class="gradle-summary">{{ AUTO_RELOAD_GROUP_TITLE }}：{{ autoReloadLabel(autoReload) }}</p>
    <p v-if="!ready" class="gradle-empty">浏览器预览不能运行 Gradle 同步，请在桌面端打开一个项目。</p>
    <p v-if="gradleSync.running" class="gradle-running"><RefreshCw :size="iconSize.dense" />正在跑：<code>{{ gradleSync.command }}</code><span aria-live="polite">已 {{ syncSeconds }} 秒</span></p>
    <p v-else-if="message" class="gradle-note">{{ message }}</p>
    <div v-if="outputTail.length" class="gradle-tail">
      <button class="gradle-group-toggle" :aria-expanded="tailOpen" @click="tailOpen = !tailOpen">同步输出</button>
      <pre v-if="tailOpen" class="gradle-tail-body">{{ outputTail.join('\n') }}</pre>
    </div>
    <div class="gradle-body" role="tree" aria-label="Gradle 链接工程">
      <section v-for="{ build, ignored, nodes } in trees" :key="build.directory" class="gradle-section" role="treeitem" :aria-expanded="!collapsed.has(key(build.directory))">
        <button class="gradle-group-toggle" :class="{ selected: selectedDirectory === build.directory }" @click="selectedDirectory = build.directory; toggle(collapsed, key(build.directory))" @contextmenu.prevent="openMenu($event, 'project', build.directory)">
          <component :is="collapsed.has(key(build.directory)) ? ChevronRight : ChevronDown" :size="iconSize.dense" /><Boxes :size="iconSize.inline" />{{ build.directory || '工作区根项目' }}<span v-if="ignored" class="gradle-ignored">已忽略</span>
        </button>
        <div v-if="!collapsed.has(key(build.directory))" role="group" class="gradle-children">
          <p v-if="build.detection" class="gradle-detail">{{ build.detection.distributionVersion ? `Gradle ${build.detection.distributionVersion}` : '本机/包装器' }} · {{ build.detection.buildFiles.join('、') }}</p>
          <p v-if="build.detectionError || build.result.error" class="gradle-error">{{ build.detectionError || build.result.error }}</p>
          <p v-else-if="build.message" class="gradle-note">{{ build.message }}</p>
          <p v-if="!nodes.length" class="gradle-empty-inline">{{ busy ? '同步中…工程结构要等这一次跑完。' : '还没有工程模型；点「同步」拉取。' }}</p>
          <div v-for="node in nodes" :key="node.project.path" role="treeitem" :aria-expanded="!collapsed.has(key(build.directory, node.project.path))" class="gradle-module">
            <button class="gradle-group-toggle" @click="toggle(collapsed, key(build.directory, node.project.path))" @contextmenu.prevent="openMenu($event, 'project', build.directory)">
              <component :is="collapsed.has(key(build.directory, node.project.path)) ? ChevronRight : ChevronDown" :size="iconSize.dense" /><Wrench :size="iconSize.inline" />{{ node.project.name }}<span class="gradle-path">{{ node.project.path }}</span>
            </button>
            <div v-if="!collapsed.has(key(build.directory, node.project.path))" role="group" class="gradle-children">
              <h4>Tasks</h4>
              <p v-if="!node.taskGroups.length" class="gradle-empty-inline">{{ busy ? '同步中…任务表要等这一次跑完。' : '没有报告的任务。' }}</p>
              <div v-for="group in node.taskGroups" :key="group.group">
                <button class="gradle-group-toggle" :aria-expanded="expandedGroups.has(key(build.directory, node.project.path, group.group))" @click="toggle(expandedGroups, key(build.directory, node.project.path, group.group))"><component :is="expandedGroups.has(key(build.directory, node.project.path, group.group)) ? ChevronDown : ChevronRight" :size="iconSize.dense" />{{ group.group }}</button>
                <ul v-if="expandedGroups.has(key(build.directory, node.project.path, group.group))" class="gradle-list" role="group">
                  <li v-for="task in group.tasks" :key="task.name" role="treeitem"><button class="gradle-task" :title="taskActivationTitle(task, build.directory)" @dblclick="runTask(task, build.directory)" @keydown.enter="runTask(task, build.directory)" @contextmenu.stop="openMenu($event, 'task', build.directory, task.name)">{{ task.name }}</button><span class="gradle-desc">{{ task.description }}</span></li>
                </ul>
              </div>
              <button class="gradle-group-toggle" :aria-expanded="dependenciesOpen.has(build.directory)" @click="toggleDependencies(build)"><component :is="dependenciesOpen.has(build.directory) ? ChevronDown : ChevronRight" :size="iconSize.dense" />{{ GRADLE_DEPENDENCIES_NODE_NAME }}</button>
              <div v-if="dependenciesOpen.has(build.directory)" role="group">
                <p v-if="!build.dependenciesLoaded" class="gradle-empty-inline">{{ busy ? (/dependencies\b/.test(gradleSync.command) ? '正在加载依赖…' : '依赖加载已排队，等待当前命令。') : '依赖尚未加载；折叠后展开可重试。' }}</p>
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
    <p class="gradle-hint">双击或 Enter 运行任务；右键可保存配置。依赖过滤只搜索已加载的模型。</p>
    <div v-if="menu" class="gradle-menu gradle-context" role="menu" :style="{ left: `${menu.x}px`, top: `${menu.y}px` }">
      <template v-for="row in menuRows" :key="row.id">
        <div v-if="row.separatorBefore" class="gradle-menu-rule" role="separator" />
        <button role="menuitem" :disabled="!row.enabled" :title="row.disabledReason || row.title" @click="menuAction(row)"><span class="gradle-menu-check"><Check v-if="row.checked" :size="iconSize.dense" :aria-hidden="true" /></span>{{ row.title }}</button>
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
        <p class="gradle-note">任务名与参数拼进命令行；VM 选项与环境变量在直接运行时走带环境的 Gradle 通道（输出在「同步输出」）。</p>
        <div class="task-editor-actions">
          <button class="subtle-button" @click="taskEditOpen = false">取消</button>
          <button class="subtle-button" :disabled="taskEditTaskNames.length === 0 && taskEdit.tasksText.trim() !== ''" @click="saveTaskEditor">确定</button>
        </div>
      </section>
    </div>
    <DependencyAnalyzerDialog v-if="analyzerOpen && analyzerBuild" :scopes="analyzerBuild.dependencies"
      :module-name="analyzerModuleName" :project-label="analyzerBuild.directory || '工作区根项目'" @close="analyzerOpen = false" />
  </div>
</template>

<style scoped>
.gradle-panel { display:flex; flex-direction:column; flex:1; min-width:0; min-height:0; }
.heading-count { margin-left:auto; color:var(--muted); font-size:10px; }
.gradle-toolbar { display:flex; flex-wrap:wrap; align-items:center; gap:var(--space-1); padding:var(--space-2); border-bottom:1px solid var(--line); }
.gradle-separator { width:1px; height:14px; background:var(--line); }
.gradle-settings { position:relative; }
.gradle-search { display:flex; align-items:center; gap:4px; padding:var(--space-2); font-size:11px; }
.gradle-search input { min-width:0; flex:1; background:var(--editor); color:var(--text); border:1px solid var(--line); }
.gradle-summary, .gradle-detail, .gradle-note, .gradle-hint, .gradle-empty-inline { margin:0; padding:2px var(--space-2); color:var(--muted); font-size:11px; overflow-wrap:anywhere; }
.gradle-error { margin:0; padding:2px var(--space-2); color:var(--error); white-space:pre-line; font-size:11px; }
.gradle-running { display:flex; flex-wrap:wrap; gap:4px; margin:0; padding:var(--space-2); font-size:11px; }
.gradle-body { flex:1; min-height:0; overflow:auto; }
.gradle-section { border-bottom:1px solid var(--line); padding:2px 0; }
.gradle-children { padding-left:12px; }
.gradle-group-toggle { display:flex; align-items:center; gap:3px; width:100%; border:0; padding:2px 4px; text-align:left; background:transparent; color:var(--text); font-size:11px; cursor:pointer; }
.gradle-group-toggle:hover, .gradle-task:hover { background:var(--hover); }
.gradle-group-toggle.selected { background:var(--selected); }
.gradle-list { margin:0; padding:0 4px; list-style:none; font:11px/1.7 var(--font-mono); }
h4 { margin:2px 4px; font-size:11px; color:var(--bright); }
.gradle-task { border:0; background:transparent; color:var(--text); font:inherit; cursor:pointer; }
.gradle-path, .gradle-desc { margin-left:4px; color:var(--muted); font-size:10px; }
.gradle-tail-body { margin:0; padding:var(--space-2); font:10px/1.6 var(--font-mono); white-space:pre-wrap; overflow-wrap:anywhere; }
.gradle-menu { position:absolute; z-index:40; display:flex; flex-direction:column; min-width:160px; padding:4px; background:var(--panel); border:1px solid var(--line); box-shadow:var(--popup-shadow); }
.gradle-menu button { border:0; padding:4px; color:var(--text); background:transparent; text-align:left; font-size:11px; }
.gradle-menu button:hover { background:var(--hover); }
.gradle-menu button:disabled { color:var(--muted); cursor:default; }
.gradle-menu button:disabled:hover { background:transparent; }
.gradle-menu-rule { height:1px; margin:4px 2px; background:var(--line); }
.gradle-menu-check { display:inline-block; width:12px; color:var(--accent,var(--bright)); }
.gradle-ignored { margin-left:auto; color:var(--muted); font-size:10px; }
.gradle-settings-menu { right:0; top:100%; }
.gradle-context { position:fixed; }
.task-editor { display:flex; flex-direction:column; gap:var(--space-2); width:520px; max-width:100%; padding:var(--space-3); background:var(--elevated); border:1px solid var(--line-strong); border-radius:var(--radius-lg); box-shadow:var(--shadow-3); }
.task-editor h3 { margin:0; font-size:13px; }
.task-editor-field { display:flex; align-items:flex-start; gap:var(--space-2); font-size:12px; }
.task-editor-field span { flex:0 0 96px; color:var(--muted); }
.task-editor-field input, .task-editor-field textarea { flex:1; min-width:0; background:var(--editor); color:var(--text); border:1px solid var(--line); padding:4px; font:12px/1.5 var(--font-mono); }
.task-editor-field input[readonly] { color:var(--muted); }
.task-editor-actions { display:flex; justify-content:flex-end; gap:var(--space-1); }
</style>
