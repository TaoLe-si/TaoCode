<script setup lang="ts">
// Gradle 工具窗口（IDEA `intellij.gradle.xml:228` 的 `<toolWindow id="Gradle" anchor="right">`）。
//
// 结构与动作**逐条照源码**：
//   工具条 = `platform/external-system-impl/resources/META-INF/ExternalSystemActions.xml:138-151`
//     的 `ExternalSystemView.ActionsToolbar` 组合：
//     SyncPanel（`RefreshAllProjects`，:116-119）→ 分隔 → AttachProjectPanel（`DetachProject`，本仓待办）
//     → RunPanel（源码里是**空组**，:125-126）→ OtherActionsPanel（空组，:123-124）
//     → `ExpandAll` / `CollapseAll`（:32-37）→ ShowSettingsGroup（`ShowCommonSettings` + `ShowSettings`，:24-27）
//   内容 = 工程 → `Tasks` / `Dependencies`（`ExternalSystemViewDefaultContributor.java:241-243` 的节点名就是
//     英文字面量 `Dependencies`；作用域节点名取配置名 `:245-253`；依赖节点带 ` (*)` 引用后缀 `:311-336`）
//   右键 = `ExternalSystemView.ProjectMenu`（:99-104 = BaseProjectMenu + `OpenTasksActivationManager`）
//     与 `ExternalSystemView.TaskMenu`（:153-163 = CreateRunConfiguration + `EditSource` + 任务激活 + AssignShortcut）
//   依赖节点的菜单 `ExternalSystemView.DependencyMenu`（:114）在源码里**是空的** ⇒ 这里也不放动作。
//
// 没有对应能力的动作按「不放假控件」不渲染，逐条登记在 docs/class-parity-todo.md §11。
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { Boxes, ChevronDown, ChevronRight, ChevronsDownUp, ChevronsUpDown, FileCode2, RefreshCw, Settings, Square, Unlink, Wrench } from 'lucide-vue-next'
import { gradleSync } from '../bridge.ts'
import {
  AUTO_RELOAD_GROUP_TITLE, BUILD_TOOLS_GROUP_ID, GRADLE_CONFIGURABLE_ID, GRADLE_DEPENDENCIES_NODE_NAME,
  autoReloadLabel, gradleOutputTail, type AutoReloadType, type GradleDependency, type GradleDependencyScope,
  type GradleDetection, type GradleSyncResult, type GradleTaskNode,
} from '../gradle.ts'

const props = defineProps<{
  detection: GradleDetection | null
  detectionError: string
  result: GradleSyncResult
  message: string
  taskGroups: Array<{ group: string; tasks: GradleTaskNode[] }>
  /** 依赖树（空 = 还没加载，展开「Dependencies」时才跑 `gradle dependencies`）。 */
  dependencies: GradleDependencyScope[]
  dependencyGroups: Array<{ project: string; scopes: GradleDependencyScope[] }>
  /** 「构建工具 › 自动重新加载项目」当前是哪一档（项目级设置，read-only 显示）。 */
  autoReload: AutoReloadType
  /**
   * 已链接的 Gradle 工程目录（工作区相对，`''` = 工作区根）。工具窗口的**可用性**判据就是它非空
   * （`AbstractExternalSystemToolWindowFactory.java:32-34`），面板标题用它说明"现在按哪个目录同步"。
   */
  linkedProjects: string[]
  /** 桌面端 + 有项目（浏览器预览里没有同步通道）。 */
  ready: boolean
}>()
const emit = defineEmits<{
  detect: []
  sync: []
  refreshProject: []
  loadDependencies: []
  openConfig: []
  saveRunConfig: [task: string]
  cancel: []
  runTask: [task: string]
  unlink: []
  openSettings: [section: 'build.tools' | 'reference.settingsdialog.project.gradle']
}>()

const isGradleProject = computed(() => props.detection?.isGradle === true)
const syncNote = computed(() => props.result.error || props.message)
const syncedAt = computed(() => (props.result.at ? new Date(props.result.at).toLocaleTimeString('zh-CN', { hour12: false }) : ''))
const wrapperLabel = computed(() => {
  const detection = props.detection
  if (!detection) return ''
  if (detection.distributionVersion) return `wrapper · Gradle ${detection.distributionVersion}`
  return detection.hasWrapper ? 'wrapper' : '本机 gradle'
})
const configFile = computed(() => props.detection?.buildFiles[0] ?? props.detection?.settingsFiles[0] ?? '')

// —— 同步进行中要看得见"在动" ——
// 实测（2026-09-29，AE2 VM 项目）：一次同步真的跑了 **1m15s** 才 FAILURE（daemon 日志里
// `BUILD FAILED in 1m 15s`），面板上却只有"正在跑：<命令>"一句，用户因此判断成"一直在解析、
// 解析不出来"并直接关掉了应用（关掉的那一秒 Gradle 正好结束）。IDEA 的对应物是 Build 窗口里的
// `Running…` 进度 + 外部系统输出，所以这里补两样：**已用时间**在走、**输出尾部**看得见。
const now = ref(Date.now())
let ticker: ReturnType<typeof setInterval> | null = null
onMounted(() => {
  if (!gradleSync.running) return
  ticker = setInterval(() => { now.value = Date.now() }, 1000)
})
watch(() => gradleSync.running, running => {
  if (running) {
    now.value = Date.now()
    if (!ticker) ticker = setInterval(() => { now.value = Date.now() }, 1000)
    return
  }
  if (ticker) { clearInterval(ticker); ticker = null }
})
onBeforeUnmount(() => { if (ticker) { clearInterval(ticker); ticker = null } })
/** 本次同步已跑的秒数（没在跑 = 0）。 */
const syncSeconds = computed(() => (gradleSync.running ? Math.max(0, Math.round((now.value - gradleSync.startedAt) / 1000)) : 0))
/** 输出尾部：跑的时候是"到哪一步了"，失败后是"为什么失败"的原始证据。 */
const outputTail = computed(() => (gradleSync.running || props.result.error ? gradleOutputTail(gradleSync.output, 6) : []))
/** 输出尾部默认展开（它就是"到底在不在动"的证据），嫌占地方可以自己折起来。 */
const tailOpen = ref(true)

// —— 树的展开状态（`ExternalSystem.ExpandAll` / `CollapseAll` 作用于整棵树）——
const expandedGroups = ref(new Set<string>())
const expandedScopes = ref(new Set<string>())
const dependenciesOpen = ref(false)
function toggleGroup(key: string) {
  const next = new Set(expandedGroups.value)
  if (next.has(key)) next.delete(key)
  else next.add(key)
  expandedGroups.value = next
}
function toggleScope(key: string) {
  const next = new Set(expandedScopes.value)
  if (next.has(key)) next.delete(key)
  else next.add(key)
  expandedScopes.value = next
}
function expandAll() {
  expandedGroups.value = new Set(props.taskGroups.map(group => group.group))
  expandedScopes.value = new Set(props.dependencies.map(scope => `${scope.project}:${scope.configuration}`))
  dependenciesOpen.value = true
}
function collapseAll() {
  expandedGroups.value = new Set()
  expandedScopes.value = new Set()
}
/** 展开「Dependencies」时才加载（IDEA 的依赖节点是懒构建的：`doBuildChildren` 才建子节点）。 */
function toggleDependencies() {
  dependenciesOpen.value = !dependenciesOpen.value
  if (dependenciesOpen.value && !props.dependencies.length) emit('loadDependencies')
}

// —— 右键菜单：Project / Task 两组（源码里是 `ExternalSystemView.ProjectMenu` / `TaskMenu`）——
const menu = ref<{ x: number; y: number; kind: 'project' | 'task'; task?: string } | null>(null)
const settingsMenu = ref(false)
function openMenu(event: MouseEvent, kind: 'project' | 'task', task?: string) {
  event.preventDefault()
  menu.value = { x: event.clientX, y: event.clientY, kind, ...(task ? { task } : {}) }
  settingsMenu.value = false
}
function closeMenu() { menu.value = null; settingsMenu.value = false }
function runFromMenu() { const task = menu.value?.task; closeMenu(); if (task) emit('runTask', task) }
function saveRunConfigFromMenu() { const task = menu.value?.task; closeMenu(); if (task) emit('saveRunConfig', task) }
function openConfigFromMenu() { closeMenu(); emit('openConfig') }
function syncFromMenu() { closeMenu(); emit('refreshProject') }
function onKeydown(event: KeyboardEvent) { if (event.key === 'Escape') closeMenu() }
// 菜单开着时点任何地方都关掉：菜单是 fixed 定位，可能溢出面板，所以监听挂在 window 上。
if (typeof window !== 'undefined') window.addEventListener('click', closeMenu)
onBeforeUnmount(() => { if (typeof window !== 'undefined') window.removeEventListener('click', closeMenu) })
function runTask(task: GradleTaskNode) { emit('runTask', task.name) }
/** 依赖行的标记：`(*)` 引用 / `(c)` 约束 / `(n)` 无法解析 / `→ v` 版本冲突解析结果（都是 Gradle 自己打的）。 */
function dependencySuffix(dependency: GradleDependency): string {
  const marks: string[] = []
  if (dependency.resolved) marks.push(`→ ${dependency.resolved}`)
  if (dependency.duplicate) marks.push('(*)')
  if (dependency.constraint) marks.push('(c)')
  if (dependency.unresolved) marks.push('(n)')
  return marks.join(' ')
}
</script>

<template>
  <div class="gradle-panel" @keydown="onKeydown">
    <div class="panel-heading" :title="`已链接的 Gradle 工程目录：${linkedProjects.join('、') || '（无）'}`">
      <span><Boxes :size="14" />Gradle</span>
      <span v-if="syncedAt" class="heading-count">{{ syncedAt }}</span>
    </div>

    <!-- 工具条：顺序照 ExternalSystemActions.xml:138-151。 -->
    <div class="gradle-toolbar" role="group" aria-label="Gradle 工具条">
      <button class="subtle-button" :disabled="!ready || gradleSync.running" :title="gradleSync.running ? '任务进行中' : '同步 Gradle 项目（RefreshAllProjects）'" @click="emit('sync')"><RefreshCw :size="13" />同步</button>
      <button v-if="gradleSync.running" class="subtle-button" title="取消（会杀掉子进程树）" @click="emit('cancel')"><Square :size="13" />取消</button>
      <!-- AttachProjectPanel（ExternalSystemActions.xml:120-122）里的 `ExternalSystem.DetachProject`。
           文案照 bundle：`action.detach.external.project.text=Unlink {0} Project`
           （platform/external-system-api/resources/messages/ExternalSystemBundle.properties:67，
           {0} = 外部系统的可读名，Gradle 那边就是 "Gradle"）。 -->
      <button class="subtle-button" :disabled="!ready || gradleSync.running" title="取消链接 Gradle 项目" @click="emit('unlink')"><Unlink :size="13" />取消链接</button>
      <span class="gradle-separator" aria-hidden="true" />
      <button class="icon-button" title="全部展开" aria-label="全部展开" @click="expandAll"><ChevronsUpDown :size="14" /></button>
      <button class="icon-button" title="全部折叠" aria-label="全部折叠" @click="collapseAll"><ChevronsDownUp :size="14" /></button>
      <span class="gradle-separator" aria-hidden="true" />
      <!-- ShowSettingsGroup（:24-27）：公共设置 = build.tools 页，Gradle = 系统自己的页。 -->
      <div class="gradle-settings">
        <button class="icon-button" aria-label="设置" title="设置" :aria-expanded="settingsMenu" @click.stop="settingsMenu = !settingsMenu"><Settings :size="14" /></button>
        <div v-if="settingsMenu" class="gradle-menu gradle-settings-menu" role="menu" aria-label="设置">
          <button class="gradle-menu-item" role="menuitem" @click="settingsMenu = false; emit('openSettings', BUILD_TOOLS_GROUP_ID)">公共设置</button>
          <button class="gradle-menu-item" role="menuitem" @click="settingsMenu = false; emit('openSettings', GRADLE_CONFIGURABLE_ID)">Gradle</button>
        </div>
      </div>
    </div>

    <p v-if="!ready" class="gradle-empty">浏览器预览不能运行 Gradle 同步，请在桌面端打开一个项目。</p>
    <p v-else-if="detectionError" class="gradle-error">{{ detectionError }}</p>
    <p v-else-if="detection && !isGradleProject" class="gradle-empty">
      这个目录里没有找到 Gradle 构建脚本（<code>build.gradle</code> / <code>build.gradle.kts</code> /
      <code>settings.gradle(.kts)</code> / declarative 两种），所以它不是 Gradle 项目。
    </p>

    <template v-else-if="detection">
      <p class="gradle-summary" data-testid="gradle-summary">
        <span class="gradle-chip">{{ wrapperLabel }}</span>
        <span class="gradle-chip">{{ AUTO_RELOAD_GROUP_TITLE }}：{{ autoReloadLabel(autoReload) }}</span>
      </p>
      <p class="gradle-detail">
        构建脚本：{{ detection.buildFiles.join('、') || '（无）' }}<template v-if="detection.settingsFiles.length">；settings：{{ detection.settingsFiles.join('、') }}</template>
      </p>

      <p v-if="gradleSync.running" class="gradle-running">
        <RefreshCw :size="12" class="gradle-spin" />正在跑：<code>{{ gradleSync.command }}</code>
        <span class="gradle-elapsed" aria-live="polite">已 {{ syncSeconds }} 秒</span>
      </p>
      <p v-else-if="syncNote" class="gradle-note" :class="{ 'is-error': Boolean(result.error) }">{{ syncNote }}</p>
      <!-- 输出尾部：跑的时候证明它没卡住，失败后这里就是原始证据（IDEA 的 Build 窗口同理是给输出的）。 -->
      <div v-if="outputTail.length" class="gradle-tail" :aria-label="gradleSync.running ? '同步输出（最新）' : '失败输出（最新）'">
        <button class="gradle-group-toggle" :aria-expanded="tailOpen" @click="tailOpen = !tailOpen">
          <component :is="tailOpen ? ChevronDown : ChevronRight" :size="12" />{{ gradleSync.running ? '同步输出' : '失败输出' }}
        </button>
        <pre v-if="tailOpen" class="gradle-tail-body">{{ outputTail.join('\n') }}</pre>
      </div>

      <div class="gradle-body" @contextmenu="openMenu($event, 'project')">
        <section class="gradle-section">
          <h4>工程</h4>
          <p v-if="!result.projects.length" class="gradle-empty-inline">{{ gradleSync.running ? '同步中…工程结构要等这一次跑完。' : '还没有同步过；点「同步」拉取工程结构。' }}</p>
          <ul v-else class="gradle-list" role="tree" aria-label="Gradle 工程">
            <li v-for="project in result.projects" :key="project.path" role="treeitem" :aria-level="project.depth + 1" :style="{ paddingLeft: `${project.depth * 12}px` }" @contextmenu.stop="openMenu($event, 'project')">
              <Wrench :size="11" class="gradle-icon" /><span class="gradle-node">{{ project.name }}</span><span class="gradle-path">{{ project.path }}</span>
            </li>
          </ul>
        </section>

        <section class="gradle-section">
          <h4>Tasks</h4>
          <p v-if="!result.tasks.length" class="gradle-empty-inline">{{ gradleSync.running ? '同步中…任务表要等这一次跑完。' : '还没有同步过；同步后这里按 Gradle 自己的分组列出任务。' }}</p>
          <div v-for="group in taskGroups" :key="group.group" class="gradle-group">
            <button class="gradle-group-toggle" :aria-expanded="expandedGroups.has(group.group)" @click="toggleGroup(group.group)">
              <component :is="expandedGroups.has(group.group) ? ChevronDown : ChevronRight" :size="12" />{{ group.group }}
              <span class="gradle-path">{{ group.tasks.length }}</span>
            </button>
            <ul v-if="expandedGroups.has(group.group)" class="gradle-list" role="tree" :aria-label="group.group">
              <li v-for="task in group.tasks" :key="task.name" role="treeitem">
                <button class="gradle-task" :title="`运行 ${task.name}：${task.description}`" @dblclick="runTask(task)" @click="runTask(task)" @contextmenu.stop="openMenu($event, 'task', task.name)">{{ task.name }}</button>
                <span class="gradle-desc">{{ task.description }}</span>
              </li>
            </ul>
          </div>
        </section>

        <!-- IDEA 的 `Dependencies` 节点：名字是字面量，展开时才构建。 -->
        <section class="gradle-section">
          <button class="gradle-group-toggle" :aria-expanded="dependenciesOpen" @click="toggleDependencies">
            <component :is="dependenciesOpen ? ChevronDown : ChevronRight" :size="12" />{{ GRADLE_DEPENDENCIES_NODE_NAME }}
            <span v-if="dependencies.length" class="gradle-path">{{ dependencies.length }}</span>
          </button>
          <template v-if="dependenciesOpen">
            <p v-if="gradleSync.running" class="gradle-empty-inline">{{ /dependencies\b/.test(gradleSync.command) ? '正在解析依赖…' : '有 Gradle 任务在跑，依赖要等它结束（一次只跑一个）。' }}</p>
            <p v-else-if="!dependencies.length" class="gradle-empty-inline">
              还没有加载依赖（展开这里会跑一次 <code>gradle dependencies</code>；IDEA 里这棵树也是展开时才建的）。
            </p>
            <div v-for="group in dependencyGroups" :key="group.project" class="gradle-group">
              <p class="gradle-group-title">{{ group.project }}</p>
              <div v-for="scope in group.scopes" :key="`${group.project}:${scope.configuration}`" class="gradle-scope">
                <button class="gradle-group-toggle" :aria-expanded="expandedScopes.has(`${group.project}:${scope.configuration}`)" @click="toggleScope(`${group.project}:${scope.configuration}`)">
                  <component :is="expandedScopes.has(`${group.project}:${scope.configuration}`) ? ChevronDown : ChevronRight" :size="12" />{{ scope.configuration }}
                  <span v-if="scope.unresolved" class="gradle-warn">(n)</span>
                  <span class="gradle-desc">{{ scope.description }}</span>
                </button>
                <ul v-if="expandedScopes.has(`${group.project}:${scope.configuration}`)" class="gradle-list" role="tree" :aria-label="scope.configuration">
                  <li v-if="scope.empty" role="treeitem" class="gradle-empty-inline">No dependencies</li>
                  <li v-for="(dependency, index) in scope.dependencies" :key="`${dependency.name}:${index}`" role="treeitem" :style="{ paddingLeft: `${dependency.depth * 14}px` }">
                    <FileCode2 :size="11" class="gradle-icon" /><span class="gradle-node">{{ dependency.name }}</span>
                    <span v-if="dependencySuffix(dependency)" class="gradle-desc">{{ dependencySuffix(dependency) }}</span>
                  </li>
                </ul>
              </div>
            </div>
          </template>
        </section>
      </div>
      <p v-if="result.command" class="gradle-command"><code>{{ result.command }}</code></p>
      <p class="gradle-hint">双击任务即运行（走运行控制台）；右键任务可存成运行配置，右键空白处可同步或打开构建脚本。</p>
    </template>

    <!-- 右键菜单：Project / Task 两组（源码里 Dependency 组没有动作，所以依赖行不给菜单）。 -->
    <div v-if="menu" class="gradle-menu gradle-context" role="menu" :style="{ left: `${menu.x}px`, top: `${menu.y}px` }">
      <template v-if="menu.kind === 'task'">
        <button class="gradle-menu-item" role="menuitem" @click="runFromMenu">运行</button>
        <button class="gradle-menu-item" role="menuitem" @click="saveRunConfigFromMenu">创建运行配置</button>
        <button class="gradle-menu-item" role="menuitem" @click="openConfigFromMenu">打开构建脚本{{ configFile ? `（${configFile}）` : '' }}</button>
      </template>
      <template v-else>
        <button class="gradle-menu-item" role="menuitem" @click="openConfigFromMenu">打开构建脚本{{ configFile ? `（${configFile}）` : '' }}</button>
        <button class="gradle-menu-item" role="menuitem" @click="syncFromMenu">同步项目</button>
      </template>
    </div>
  </div>
</template>

<style scoped>
.gradle-panel { display: flex; flex-direction: column; flex: 1; min-width: 0; min-height: 0; }
.heading-count { margin-left: auto; color: var(--muted); font-size: 10px; }
.gradle-toolbar { display: flex; flex-wrap: wrap; align-items: center; gap: var(--space-1); padding: var(--space-2) var(--space-3); border-bottom: 1px solid var(--line); }
.gradle-separator { width: 1px; height: 14px; margin: 0 var(--space-1); background: var(--line); }
.gradle-settings { position: relative; display: inline-flex; }
.gradle-summary { display: flex; flex-wrap: wrap; gap: var(--space-1); margin: 0; padding: var(--space-2) var(--space-3) 0; }
.gradle-chip { padding: 1px 6px; border: 1px solid var(--line); border-radius: 999px; color: var(--muted); font-size: 10px; }
.gradle-detail { margin: 0; padding: var(--space-1) var(--space-3); color: var(--muted); font-size: 11px; overflow-wrap: anywhere; }
.gradle-running, .gradle-note { display: flex; align-items: center; gap: var(--space-1); margin: 0; padding: var(--space-2) var(--space-3); font-size: 11px; color: var(--muted); border-bottom: 1px solid var(--line); overflow-wrap: anywhere; }
/* 失败原因是多段的（表面原因 + 因果链），换行要保留 */
.gradle-note.is-error { color: var(--error); display: block; white-space: pre-line; }
.gradle-elapsed { margin-left: auto; color: var(--bright); font: 11px/1.7 var(--font-mono); }
.gradle-tail { border-bottom: 1px solid var(--line); }
.gradle-tail-body { margin: 0; padding: 0 var(--space-3) var(--space-2); color: var(--muted); font: 10px/1.6 var(--font-mono); white-space: pre-wrap; overflow-wrap: anywhere; }
.gradle-spin { animation: gradle-spin 1.2s linear infinite; }
@keyframes gradle-spin { to { transform: rotate(360deg); } }
.gradle-body { display: flex; flex-direction: column; flex: 1; min-height: 0; overflow: auto; }
.gradle-section { padding: var(--space-2) 0; border-bottom: 1px solid var(--line); }
.gradle-section h4 { margin: 0; padding: 0 var(--space-3) var(--space-1); color: var(--bright); font-size: 11px; font-weight: 600; }
.gradle-list { margin: 0; padding: 0; list-style: none; }
.gradle-node { color: var(--text); font: 11px/1.7 var(--font-mono); overflow-wrap: anywhere; }
.gradle-icon { margin-right: var(--space-1); color: var(--muted); vertical-align: -1px; }
.gradle-path { margin-left: var(--space-2); color: var(--muted); font-size: 10px; }
.gradle-group-toggle { display: flex; align-items: center; gap: 2px; width: 100%; padding: 1px var(--space-3); border: 0; background: transparent; color: var(--bright); font-size: 11px; text-align: left; cursor: pointer; }
.gradle-group-toggle:hover { background: var(--hover); }
.gradle-group-title { margin: var(--space-1) 0 0; padding: 0 var(--space-3); color: var(--muted); font-size: 10px; }
.gradle-scope { padding-left: var(--space-2); }
.gradle-task { padding: 1px var(--space-2); border: 0; border-radius: 3px; background: transparent; color: var(--text); font: 11px/1.7 var(--font-mono); cursor: pointer; }
.gradle-task:hover { background: var(--hover); color: var(--bright); }
.gradle-desc { margin-left: var(--space-2); color: var(--muted); font-size: 10px; }
.gradle-warn { margin-left: var(--space-1); color: var(--error); font-size: 10px; }
.gradle-command { margin: 0; padding: var(--space-2) var(--space-3) 0; color: var(--muted); font-size: 10px; overflow-wrap: anywhere; }
.gradle-hint { margin: 0; padding: var(--space-1) var(--space-3) var(--space-3); color: var(--muted); font-size: 10px; line-height: 1.7; }
.gradle-error { margin: 0; padding: var(--space-2) var(--space-3); color: var(--error); font-size: 11px; overflow-wrap: anywhere; }
.gradle-empty { padding: var(--space-4) var(--space-3); color: var(--muted); font-size: 11px; line-height: 1.7; }
.gradle-empty-inline { margin: 0; padding: 0 var(--space-3); color: var(--muted); font-size: 11px; line-height: 1.7; }
.gradle-menu { position: absolute; z-index: 40; display: flex; flex-direction: column; min-width: 180px; padding: var(--space-1); border: 1px solid var(--line); border-radius: 4px; background: var(--panel); box-shadow: 0 6px 20px rgba(0, 0, 0, .28); }
.gradle-settings-menu { right: 0; top: 100%; }
.gradle-context { position: fixed; }
.gradle-menu-item { padding: 3px var(--space-2); border: 0; border-radius: 3px; background: transparent; color: var(--text); font-size: 11px; text-align: left; cursor: pointer; }
.gradle-menu-item:hover { background: var(--hover); color: var(--bright); }
</style>
