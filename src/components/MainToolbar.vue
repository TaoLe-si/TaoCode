<script setup lang="ts">
// 主工具栏 —— IDEA `MainToolbarNewUI`（`platform/platform-impl/resources/idea/PlatformActions.xml:839-854`）
// 的对应物。从 App.vue 搬出来（App.vue 贴着机检上限，而且这块本来就该独立）。
//
// IDEA 的排布是**三段**（`MainToolbarNewUI`，PlatformActions.xml:839-853）：
//   MainToolbarLeft   = `main.toolbar.Project` + `MainToolbarVCSGroup`（Git4Idea 的分支 widget
//                       挂在这里）+ `MainToolbarGeneralActionsGroup`
//   MainToolbarCenter = `main.toolbar.Filename`
//   MainToolbarRight  = `ExecutionTargetsToolbarGroup` + `NewUiRunWidget`
//                       + `SearchEverywhere` + `SettingsEntryPoint`
// 运行 widget 属于**右段**：ExecutionActions.xml:117-119 用 `anchor="first"` 把它挂到
// `MainToolbarRight`，:133-135 再把执行目标放在它前面 —— 解析后的组结构
// （actionGroupStructure.txt:2501-2506）就是这个顺序。所以它排在文件名之后、搜索之前。
//
// 它在**哪一行**取决于档位的（`ShowMode.kt:20-24` 把三档映射成两个显示模式）：
//   `SEPARATE_TOOLBAR` → ShowMode.MENU：标题行只放菜单栏，主工具栏被**从标题行里摘掉**
//     （ToolbarFrameHeader.kt:184-190 把 `toolbar` 置 null），改由宿主作为独立的一行装进
//     客户端区（ProjectFrameCustomHeaderHelper.kt:354-368，左边距 5）。← 菜单在上、工具栏在下两行。
//   `UNDER_HAMBURGER_BUTTON`（默认档）→ ShowMode.TOOLBAR、`MERGED_WITH_MAIN_TOOLBAR`
//     → ShowMode.TOOLBAR_WITH_MENU：都在标题行里，格子顺序是「菜单格 → 主工具栏」
//     （ToolbarFrameHeader.kt:446-452 的 toolbarPnl），两者之间 4px（:268-273）。
// 本组件**只搬模板**，样式与状态仍留在 App.vue / 各自的模块里（class 名一个没改）。
import BranchPopup from './BranchPopup.vue'
import { computed, onBeforeUnmount, ref } from 'vue'
import { ChevronDown, Cog, Crosshair, Ellipsis, FileCode2, FolderOpen, GitBranch, Hammer, Play, Search, SlidersHorizontal, Square, Bug } from 'lucide-vue-next'
import { request } from '../bridge'
import {
  groupRunDashboardRows, readRunDashboardTypes, runDashboardPresentTypes, runDashboardRows, runDashboardSummary,
  runDashboardTypeLabel, toggleRunDashboardType, writeRunDashboardTypes, type RunDashboardGroup,
} from '../runDashboard.ts'
import {
  clampRunConfigWidth, hiddenRunToolbarSlots, moveSlotToTop, readRunToolbarLayout, removeSlot, restoreSlot,
  runConfigWidthAfterDrag, runToolbarSlotActionRows, visibleRunToolbarSlots, writeRunToolbarLayout,
  RUN_TOOLBAR_SLOT_LABELS, type RunToolbarLayout, type RunToolbarSlotActionId, type RunToolbarSlotActionRow, type RunToolbarSlotId,
} from '../runToolbarSlots.ts'
import { activeRunInstance, focusRunInstance, runInstanceList } from '../runInstances.ts'
import {
  executionTargetPopupEntries, executionTargetsToolbarEntry, listExecutionTargets, readActiveExecutionTargetId,
  writeActiveExecutionTargetId, type ExecutionTargetPopupEntry,
} from '../executionTargets.ts'
import { availableJdks, type JdkInfo } from '../buildHost.ts'
import { loadTargetEnvironments } from '../targetEnvironments.ts'
import { iconSize } from '../uiIcons'
import { ACCESSIBLE_NAME_PREFIX } from '../filenameWidget'
import { mainToolbarFocusHost, moveToolbarFocus, restoreFocusFromMainToolbar } from '../mainToolbarFocus.ts'

/** 工具栏要用到的状态与动作。字段名与 App.vue 里的变量同名，所以模板是**原样搬运**的。 */
export interface MainToolbarContext {
  // 左段 · 项目 widget（`main.toolbar.Project`）
  workspace: { name: string; root: string }
  projectWidgetOpen: boolean
  projectWidgetQuery: string
  projectWidgetGroups: Array<{ label: string; items: Array<{ name: string; path: string; available: boolean }> }>
  toggleProjectWidget: () => void
  closeProjectWidget: () => void
  setProjectWidgetQuery: (value: string) => void
  pickProjectFromWidget: (project: any) => void
  branchOfProject: (path: string) => string
  // 左段 · 分支 widget（`main.toolbar.git.Branches`）
  gitHead: string
  gitAheadBehind: { available: boolean; ahead: number; behind: number }
  branchPopupOpen: boolean
  gitBranches: any[]
  openBranchPopup: () => void
  closeBranchPopup: () => void
  onBranchAction: (payload: any) => void
  // 中段 · 文件名 widget（`main.toolbar.Filename`）
  filenameShown: boolean
  filenameLabel: string
  filenameStatusKind: string
  filenameTooltip: string
  filenamePopup: boolean
  toggleFilenamePopup: () => void
  onFilenameMouseUp: (event: MouseEvent) => void
  filenameRecentRows: Array<{ name: string; path: string }>
  pickRecentFile: (path: string) => void
  recentFileKind: (path: string) => string
  // 右段 · 运行 widget（`NewUiRunWidget` → `RunToolbarMainActionGroup`，ExecutionActions.xml:117-128）
  runConfigName: string
  configChooser: unknown
  openConfigChooser: (debug: boolean) => void
  isDesktop: boolean
  runState: { running: boolean }
  runWidgetTitle: string
  startBuild: (rebuild: boolean) => unknown
  stopRun: () => unknown
  runSelectedConfig: (debug: boolean) => unknown
  debugButtonTitle: string
  dapState: { running: boolean }
  stopAnyProcess: () => unknown
  // 运行 widget 末尾的「更多」（`MoreRunToolbarActions`，ExecutionActions.xml:121-128）：
  // 条目数据来自 src/runToolbar.ts（App 注入），动作指向菜单里那几个同一实现。
  moreRunActions?: Array<{ id: string; title: string; keys?: string }>
  canRerun?: boolean
  rerunLast?: () => unknown
  openRunConfigurations?: () => unknown
  /**
   * 运行配置名 → 配置类型 id（`RunConfig['type']`）。仪表盘按它把实例分组
   * （上游 `RunDashboardDefaultTypesProvider.getDefaultTypeIds`，见 src/runDashboard.ts）。
   */
  runConfigTypes?: Record<string, string>
  /** 把运行工具窗口叫到前面（槽位菜单的「显示运行工具窗口标签」用；上游 `environment.showToolWindowTab()`）。 */
  showOutputRun?: () => unknown
  // 右段 · SearchEverywhere + SettingsEntryPoint
  working: boolean
  // 这个放大镜是 `SearchEverywhere`（PlatformActions.xml:850），不是「查找操作」——
  // IDEA 的 Find Action (Ctrl+Shift+A) 只有键位，没有工具栏按钮。
  openSearchEverywhere: () => void
  openSettings: () => void
}

const props = defineProps<{ ctx: MainToolbarContext }>()
// 「更多」弹层的开合是工具栏自己的视图状态（动作仍走 ctx 里的同一套实现）。
const moreOpen = ref(false)
function moreActionDisabled(id: string): boolean {
  if (id === 'run.rerun') return props.ctx.canRerun !== true
  if (id === 'run.stopAll') return !props.ctx.runState.running && !props.ctx.dapState.running
  return false
}
function runMoreAction(id: string) {
  moreOpen.value = false
  if (id === 'run.rerun' && props.ctx.canRerun) void props.ctx.rerunLast?.()
  else if (id === 'run.stopAll' && (props.ctx.runState.running || props.ctx.dapState.running)) void props.ctx.stopAnyProcess()
  else if (id === 'run.editConfigurations') void props.ctx.openRunConfigurations?.()
}
// 工具栏自己的键盘行为（Esc 把焦点还回去；←/→ 在条目间走）。判据在 src/mainToolbarFocus.ts。
function onToolbarKeydown(event: KeyboardEvent) {
  if (event.key === 'Escape' && !event.defaultPrevented) { restoreFocusFromMainToolbar(mainToolbarFocusHost); return }
  if (event.key !== 'ArrowRight' && event.key !== 'ArrowLeft') return
  moveToolbarFocus(mainToolbarFocusHost, event.key === 'ArrowRight' ? 1 : -1)
}
// 运行仪表盘（上游 execution/dashboard 的可移植子集，见 src/runDashboard.ts）：
// 运行工具栏里的实例清单 —— 每个实例一行（状态/时长/PID），点击切到那个实例、`停止`停它。
// **按配置类型分组**（上游 Services 树的 `RunDashboardGroup` + `RunDashboardManager.getTypes()`）：
// 顶上那排类型开关决定显示哪些组（存 localStorage），组头显示组名 + 组内在跑数。
// 只在弹层打开时每秒钟刷新「跑了多久」；关掉即停（在跑状态本身是响应式的）。
const dashboardOpen = ref(false)
const dashboardNow = ref(Date.now())
let dashboardTimer: number | undefined
function viewStorage(): Storage | undefined {
  return typeof localStorage !== 'undefined' ? localStorage : undefined
}
const dashboardRows = computed(() => runDashboardRows(runInstanceList().map(instance => ({
  id: instance.id, label: instance.label, running: instance.running, exit: instance.exit,
  startedAt: instance.startedAt, pid: instance.pid,
  // 分组键：按**配置名**去配置表里查类型（上游 `RunDashboardManager` 也是从
  // `RunConfiguration` 现查类型，不是抄一份到 descriptor 上 —— 见 src/runDashboard.ts）。
  type: props.ctx.runConfigTypes?.[instance.label] ?? '',
})), dashboardNow.value))
/** `null` = 用户没设过 = 全显示（上游初始就是全部类型都在树上）。 */
const dashboardTypes = ref<string[] | null>(readRunDashboardTypes(viewStorage()))
const dashboardGroups = computed<RunDashboardGroup[]>(() => groupRunDashboardRows(dashboardRows.value, dashboardTypes.value ?? undefined))
const dashboardVisibleRows = computed(() => dashboardGroups.value.flatMap(group => group.rows))
const dashboardSummary = computed(() => runDashboardSummary(dashboardVisibleRows.value))
/** 类型开关只列**当前真有实例**的类型：给一个空组配开关就是点不动的死控件。 */
const dashboardTypeChips = computed(() => runDashboardPresentTypes(dashboardRows.value))
function dashboardTypeShown(type: string): boolean {
  return dashboardTypes.value === null || dashboardTypes.value.includes(type)
}
function toggleDashboardType(type: string) {
  dashboardTypes.value = toggleRunDashboardType(dashboardTypes.value, type)
  writeRunDashboardTypes(viewStorage(), dashboardTypes.value)
}
function toggleDashboard() {
  dashboardOpen.value = !dashboardOpen.value
  if (dashboardTimer !== undefined) { clearInterval(dashboardTimer); dashboardTimer = undefined }
  if (!dashboardOpen.value) return
  dashboardNow.value = Date.now()
  dashboardTimer = window.setInterval(() => { dashboardNow.value = Date.now() }, 1000)
}
function pickDashboardInstance(id: number) {
  focusRunInstance(id)
  dashboardOpen.value = false
}
async function stopDashboardInstance(id: number) {
  try { await request('run.stop', { instance: id }) } catch { /* 进程可能刚结束 */ }
}
onBeforeUnmount(() => { if (dashboardTimer !== undefined) clearInterval(dashboardTimer) })

// —— ExecutionTargetsToolbarGroup（`intellij.platform.execution.impl.actions.xml:127-129`）——
// 那一组 searchable=false popup=false，里面只有 `ExecutionTargets`
// （`ExecutionTargetComboBoxAction`，同文件 `:47`）；`ExecutionActions.xml:133-135` 把它挂在
// `MainToolbarRight` 上、`NewUiRunWidget` 之前（后者 `:117-119` 是 anchor="first"），
// 所以它排在运行 widget **最前面** —— 下面那一格就是那个位置。
// 活动目标是本机时整格隐藏（`ExecutionTargetComboBoxAction.kt:60-63`），所以默认看不见。
const targetOpen = ref(false)
const targetId = ref(readActiveExecutionTargetId(viewStorage()))
// JDK 清单是宿主异步给的（`app.jdks`），所以目标列表放在一个 ref 上，挂载时取一次。
const jdkList = ref<JdkInfo[]>([])
void availableJdks().then(list => { jdkList.value = list ?? [] }).catch(() => { jdkList.value = [] })
const executionTargets = computed(() => listExecutionTargets(jdkList.value, {
  custom: loadTargetEnvironments(typeof localStorage === 'undefined' ? undefined : localStorage, c.workspace.root).targets,
}))
const targetEntry = computed(() => executionTargetsToolbarEntry(executionTargets.value, targetId.value))
const targetPopupRows = computed<ExecutionTargetPopupEntry[]>(() => executionTargetPopupEntries(executionTargets.value, targetId.value))
function pickExecutionTarget(id: string) {
  targetOpen.value = false
  targetId.value = id
  writeActiveExecutionTargetId(viewStorage(), id)
}

// —— 运行 widget 的槽位布局（上游 execution/runToolbar，判定与坐标在 src/runToolbarSlots.ts）——
// widget 按槽位顺序渲染；每一格右键（`RunToolbarSlotContextMenuGroup`）能移到顶部 / 编辑配置 /
// 移除槽位 / 显示运行工具窗口标签；选择器那一格还能拖右边缘改宽度（`RunWidgetResizeController`）。
// 被移除的槽位从「更多」弹层里显示回来 —— 没有这条回路的话，移除就是死路。
const runLayout = ref<RunToolbarLayout>(readRunToolbarLayout(viewStorage()))
const runSlots = computed(() => visibleRunToolbarSlots(runLayout.value))
const hiddenRunSlots = computed(() => hiddenRunToolbarSlots(runLayout.value))
const runningInstanceCount = computed(() => runInstanceList().filter(instance => instance.running).length)
const slotMenuFor = ref<RunToolbarSlotId | null>(null)
const slotActionRows = computed<RunToolbarSlotActionRow[]>(() => slotMenuFor.value
  ? runToolbarSlotActionRows(runLayout.value, slotMenuFor.value, runningInstanceCount.value)
  : [])
function saveRunLayout(layout: RunToolbarLayout) {
  runLayout.value = layout
  writeRunToolbarLayout(viewStorage(), layout)
}
function openSlotMenu(id: RunToolbarSlotId, event: MouseEvent) {
  event.preventDefault()
  event.stopPropagation()
  slotMenuFor.value = slotMenuFor.value === id ? null : id
}
function runSlotAction(action: RunToolbarSlotActionId) {
  const target = slotMenuFor.value
  slotMenuFor.value = null
  if (!target) return
  if (action === 'RunToolbarMoveToTopAction') saveRunLayout(moveSlotToTop(runLayout.value, target))
  else if (action === 'RunToolbarRemoveSlotAction') saveRunLayout(removeSlot(runLayout.value, target))
  else if (action === 'RunToolbarEditConfigurationAction') void c.openRunConfigurations?.()
  else if (action === 'RunToolbarShowToolWindowTab') void c.showOutputRun?.()
}
function restoreRunSlot(id: RunToolbarSlotId) { saveRunLayout(restoreSlot(runLayout.value, id)) }
function slotLabel(id: RunToolbarSlotId): string { return RUN_TOOLBAR_SLOT_LABELS[id] }

// 拖拽改选择器宽度：上游 `RunWidgetResizeController.dragged` 是 `start - offset.width`（往左拖变宽），
// 上下限照 `RunWidgetWidthHelper` 的 200/1200（src/runToolbarSlots.ts 的 clamp）。
const selectorWidth = ref(clampRunConfigWidth(runLayout.value.runConfigWidth))
let widthDrag: { startX: number; startWidth: number } | null = null
function onWidthDragStart(event: PointerEvent) {
  widthDrag = { startX: event.clientX, startWidth: selectorWidth.value }
  window.addEventListener('pointermove', onWidthDrag)
  window.addEventListener('pointerup', onWidthDragEnd, { once: true })
}
function onWidthDrag(event: PointerEvent) {
  if (!widthDrag) return
  selectorWidth.value = runConfigWidthAfterDrag(widthDrag.startWidth, event.clientX - widthDrag.startX)
}
function onWidthDragEnd() {
  window.removeEventListener('pointermove', onWidthDrag)
  widthDrag = null
  saveRunLayout({ ...runLayout.value, runConfigWidth: selectorWidth.value })
}
/** 键盘调宽：上游是 Swing `DraggablePane` 的拖拽，没有键盘路径；步长由区间自己算（÷50 = 20px）。 */
function onWidthKeydown(event: KeyboardEvent) {
  if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return
  event.preventDefault()
  const step = Math.round((1200 - 200) / 50)
  selectorWidth.value = clampRunConfigWidth(selectorWidth.value + (event.key === 'ArrowLeft' ? step : -step))
  saveRunLayout({ ...runLayout.value, runConfigWidth: selectorWidth.value })
}
onBeforeUnmount(() => window.removeEventListener('pointermove', onWidthDrag))
// **不要解构 ctx**：它的字段是 getter（`unref(...)`），解构会把值**快照**下来 ——
// `gitHead`/`filenameShown` 这些是异步加载的，快照意味着它们永远停在初始值，整行看着就是空的。
// 保留 `ctx` 本身、在模板里写 `ctx.xxx`，每次渲染都会重新走 getter。
const c = props.ctx
</script>

<template>
  <!-- 键盘：上游 `MainToolbarFocusSupport.install()`（`:44-48`）把 Esc 注册成工具栏上的自定义快捷键，
       并在 `installHeaderToolbarFocusTraversalPolicy`（`:216-224`）里把 ←/→ 加进遍历键。这里同一个位置。 -->
  <div class="topbar-toolbar" @keydown="onToolbarKeydown">
    <div class="project-widget"><button class="header-widget" :aria-expanded="c.projectWidgetOpen" aria-haspopup="menu" :aria-label="`项目 ${c.workspace.name}`" :title="c.workspace.root" @click.stop="c.toggleProjectWidget"><FolderOpen :size="iconSize.rail" /><span class="project-widget-name">{{ c.workspace.name }}</span><ChevronDown :size="iconSize.dense" :class="{ 'project-widget-caret': true, open: c.projectWidgetOpen }" /></button><div v-if="c.projectWidgetOpen" class="project-widget-popup" role="menu" :aria-label="`项目 ${c.workspace.name}`"><input :value="c.projectWidgetQuery" class="project-widget-search" placeholder="搜索项目（名称或路径）" aria-label="搜索项目" @input="c.setProjectWidgetQuery(($event.target as HTMLInputElement).value)" @keydown.esc.stop="c.projectWidgetQuery ? c.setProjectWidgetQuery('') : c.closeProjectWidget()" /><template v-for="group in c.projectWidgetGroups" :key="group.label"><div class="project-widget-group" role="presentation">{{ group.label }}</div><button v-for="project in group.items" :key="`${group.label}:${project.path}`" class="menu-button project-widget-row" role="menuitem" :disabled="c.working || !project.available" :title="project.path" @click="c.pickProjectFromWidget(project)"><span class="menu-item-icon"><FolderOpen :size="iconSize.menu" /></span><span class="project-widget-details"><span class="project-widget-title">{{ project.name }}</span><span class="project-widget-path">{{ project.path }}</span><span v-if="c.branchOfProject(project.path)" class="project-widget-branch"><GitBranch :size="iconSize.inline" />{{ c.branchOfProject(project.path) }}</span></span></button></template><p v-if="!c.projectWidgetGroups.length" class="menu-empty">没有匹配的项目</p></div></div>

    <!-- IDEA 新 UI 的 `main.toolbar.git.Branches` widget（Git4Idea 挂在 `MainToolbarVCSGroup` 的
         anchor="first"，而该组在 `MainToolbarLeft` 里 —— 解析结果见 actionGroupStructure.txt:2479-2483）：
         点它打开**分支弹窗**（GitBranchesPopup），不是切到源代码管理工具窗口。 -->
    <div v-if="c.gitHead" class="branch-widget-anchor">
      <button class="header-widget branch-widget" :aria-expanded="c.branchPopupOpen" aria-haspopup="dialog" :title="`当前分支 ${c.gitHead}（点击切换 / 新建）`" aria-label="Git 分支" @click.stop="c.branchPopupOpen ? c.closeBranchPopup() : c.openBranchPopup()"><GitBranch :size="iconSize.rail" /><span>{{ c.gitHead }}</span><span v-if="c.gitAheadBehind.available && (c.gitAheadBehind.ahead || c.gitAheadBehind.behind)" class="header-widget-count">{{ c.gitAheadBehind.ahead ? `↑${c.gitAheadBehind.ahead}` : '' }}{{ c.gitAheadBehind.behind ? `↓${c.gitAheadBehind.behind}` : '' }}</span></button>
      <BranchPopup v-if="c.branchPopupOpen" :branches="c.gitBranches" :current="c.gitHead" :busy="c.working" @action="c.onBranchAction" @close="c.closeBranchPopup()" />
    </div>

    <!-- 中段：文件名 widget（`main.toolbar.Filename`）。IDEA 的窗口标题已经带全路径，所以这里只显示文件名；
         点击列出最近文件，中键 / Shift+点击关闭（FilenameToolbarWidgetAction.kt:49-181、UIUtil.java:1843-1846）。 -->
    <div class="topbar-spacer" />
    <div v-if="c.filenameShown" class="filename-widget">
      <button
        class="header-widget filename-button" :class="`filename-${c.filenameStatusKind}`"
        :aria-expanded="c.filenamePopup" aria-haspopup="listbox"
        :aria-label="`${ACCESSIBLE_NAME_PREFIX} ${c.filenameLabel}`" :title="c.filenameTooltip"
        @click.stop="c.toggleFilenamePopup" @mouseup="c.onFilenameMouseUp"
      ><FileCode2 :size="iconSize.rail" /><span class="filename-text">{{ c.filenameLabel }}</span></button>
      <div v-if="c.filenamePopup" class="filename-popup" role="listbox" :aria-label="`${ACCESSIBLE_NAME_PREFIX} ${c.filenameLabel}`">
        <button v-for="row in c.filenameRecentRows" :key="row.path" class="menu-button filename-row" role="option" :aria-selected="false" :title="row.path" @click="c.pickRecentFile(row.path)"><FileCode2 :size="iconSize.menu" :class="`filename-${c.recentFileKind(row.path)}`" /><span class="filename-row-text">{{ row.name }}</span></button>
      </div>
    </div>

    <!-- 右段（PlatformActions.xml:849-852 + ExecutionActions.xml:117-119/:133-135，
         解析后顺序见 actionGroupStructure.txt:2501-2506）：
         `ExecutionTargetsToolbarGroup` + `NewUiRunWidget` + SearchEverywhere + SettingsEntryPoint。
         本仓没有执行目标组，所以运行 widget 就是右段第一项 —— 排在文件名之后、搜索之前。
         主题切换与帮助**不放这里** —— IDEA 的工具栏没有它们（主题在「设置 › 外观」，帮助在「帮助」菜单），
         本仓那两处入口都在，所以工具栏只留 IDEA 定义的那两个。
         「设置」那一格是**齿轮**不是滑块：`PlatformActions.xml:851` 把 `SettingsEntryPoint` 挂在
         `MainToolbarRight`（:849），而 `SettingsEntryPointAction.java:108`
         `GEAR_ICON = new BadgeIconSupplier(AllIcons.General.GearPlain)` → `AllIcons.java:581`
         `GearPlain = load("expui/general/settings.svg", ...)`，那个 SVG 的形状就是一枚齿轮
         （`platform/icons/src/expui/general/settings.svg` 的 path：外圈 8 齿 + 中间一个圆孔）。
         同一个动作在左侧活动条底部也有一格（`App.vue` 的 `.rail-bottom`）—— 那里同样用 `Cog`；
         `App.vue` 贴着机检上限（2737），所以那处不再重复这段出处注释。 -->
    <div class="topbar-right"><div class="topbar-widgets">
      <!-- `ExecutionTargetsToolbarGroup` 的那一格：排在运行 widget 之前
           （ExecutionActions.xml:133-135 相对 `NewUiRunWidget` before，`:117-119` 把它 anchor="first"）。
           活动目标是本机时整格不渲染（ExecutionTargetComboBoxAction.kt:60-63 的 isEnabledAndVisible=false）。 -->
      <div v-if="targetEntry.visible" class="header-targets">
        <button class="header-widget" :aria-expanded="targetOpen" aria-haspopup="menu" :title="targetEntry.description"
          :aria-label="`执行目标：${targetEntry.text}`" @click.stop="targetOpen = !targetOpen">
          <Crosshair :size="iconSize.rail" aria-hidden="true" /><span>{{ targetEntry.text }}</span>
        </button>
        <div v-if="targetOpen" class="targets-popup" role="menu" aria-label="执行目标" @click.stop>
          <template v-for="row in targetPopupRows" :key="row.kind === 'separator' ? `sep:${row.label}` : row.id">
            <p v-if="row.kind === 'separator'" class="targets-separator" role="presentation">{{ row.label }}</p>
            <button v-else class="menu-button targets-row" role="menuitemradio" :aria-checked="row.selected" :disabled="row.disabled"
              :title="row.description" @click="pickExecutionTarget(row.id)">
              <span class="targets-row-label">{{ row.label }}</span><span v-if="row.selected" class="targets-row-check" aria-hidden="true">当前</span>
            </button>
          </template>
        </div>
      </div>
      <div class="header-run">
        <!-- IDEA 的运行 widget = `RunToolbarMainActionGroup`（ExecutionActions.xml:121-128）的顺序：
             RedesignedRunConfigurationSelector → compositeResumeGroup（运行/调试）→
             RunToolbarTopLevelExecutorActionGroup（执行器）→ Stop → MoreRunToolbarActions。
             所以**配置选择器在最前**，构建占执行器那格。所有动作都复用菜单里同一套实现。 -->
        <button class="header-widget run-caret" :aria-expanded="c.configChooser !== null" aria-haspopup="menu" :title="`选择运行配置 (Alt+Shift+F10)：${c.runConfigName || '未选择'}`" aria-label="选择运行配置" @click="c.openConfigChooser(false)"><span class="run-config-name">{{ c.runConfigName || '未选择配置' }}</span><ChevronDown :size="iconSize.dense" class="run-caret-glyph" aria-hidden="true" /></button>
        <button class="header-widget build-button" :title="`构建项目 (Ctrl+F9)${c.isDesktop ? '' : ' · 仅桌面端'}`" aria-label="构建项目" :disabled="!c.isDesktop || !c.workspace || c.runState.running" @click="void c.startBuild(false)"><Hammer :size="iconSize.rail" aria-hidden="true" /></button>
        <!-- 运行/停止这一对是状态指示而不是主图标，14px = `--icon-size-control`（`IntUiBridgeMenu.kt:107` 那一族）。
             这一档原先是 CSS 的 `.topbar .run-button > svg` 写死的，模板什么都不写 —— 现在模板声明、
             CSS 只兜底，两边不会再各说各话。 -->
        <button class="header-widget run-button" :class="{ running: c.runState.running }" :title="c.runWidgetTitle" aria-label="运行" @click="c.runState.running ? void c.stopRun() : void c.runSelectedConfig(false)"><Play v-if="!c.runState.running" :size="iconSize.control" /><Square v-else :size="iconSize.control" /></button>
        <button class="header-widget debug-button" :title="c.debugButtonTitle" aria-label="调试" :disabled="!c.isDesktop || !c.workspace || c.dapState.running" @click="void c.runSelectedConfig(true)"><Bug :size="iconSize.rail" aria-hidden="true" /></button>
        <button class="header-widget stop-button" title="停止 (Ctrl+F2)" aria-label="停止" :disabled="!c.runState.running && !c.dapState.running" @click="void c.stopAnyProcess()"><Square :size="iconSize.control" aria-hidden="true" /></button>
        <!-- `MoreRunToolbarActions`：运行 widget 的收尾弹层（重新运行 / 停止全部 / 编辑运行配置）。 -->
        <div class="header-run-more">
          <button class="header-widget more-button" :aria-expanded="moreOpen" aria-haspopup="menu" title="更多运行动作" aria-label="更多运行动作" @click.stop="moreOpen = !moreOpen"><Ellipsis :size="iconSize.rail" aria-hidden="true" /></button>
          <div v-if="moreOpen" class="run-more-popup" role="menu" aria-label="更多运行动作">
            <button v-for="action in c.moreRunActions" :key="action.id" class="menu-button run-more-row" role="menuitem" :disabled="moreActionDisabled(action.id)" @click="runMoreAction(action.id)"><span class="run-more-title">{{ action.title }}</span><span v-if="action.keys" class="run-more-keys">{{ action.keys }}</span></button>
          </div>
        </div>
        <!-- 运行仪表盘（上游 execution/dashboard 的可移植子集）：实例清单 + 状态/时长/停止。
             图标待核：上游 `RunDashboardUiManagerImpl.java:145` `getToolWindowIcon()` 返回
             `AllIcons.Toolwindows.ToolWindowServices` = `AllIcons.java:1523` → `expui/toolwindows/services.svg`，
             那个 SVG 的形状是「六边形外框 + 里面一个播放三角」（`platform/icons/src/expui/toolwindows/services.svg`
             的两条 path），lucide-vue-next 里没有对应字形（只有裸 `Hexagon` 与 `CirclePlay`/`SquarePlay`）——
             换任何一个都是"挑个差不多的"，所以这里保留 `SlidersHorizontal` 并登记为无法核实。 -->
        <div class="header-run-dashboard">
          <button class="header-widget" :aria-expanded="dashboardOpen" aria-haspopup="menu" title="运行仪表盘（实例状态）" aria-label="运行仪表盘" @click.stop="toggleDashboard"><SlidersHorizontal :size="iconSize.rail" aria-hidden="true" /></button>
          <div v-if="dashboardOpen" class="run-dashboard-popup" role="menu" aria-label="运行仪表盘">
            <p class="run-dashboard-summary">{{ dashboardSummary }}</p>
            <!-- 「显示哪些配置类型」：`RunDashboardManager.setTypes(Set<String>)`
                 （RunDashboardManager.java:40-44）的那一档。只列此刻真有实例的类型
                 （`runDashboardPresentTypes`）—— 给空组配开关就是点不动的死控件。
                 组图标不画：上游 `RunDashboardGroup.getIcon()` 来自 `ConfigurationType.getIcon()`，
                 本仓的类型没有图标注册表（见 src/runDashboard.ts 文件头）。 -->
            <div v-if="dashboardTypeChips.length > 1" class="run-dashboard-types" role="group" aria-label="显示哪些配置类型">
              <button v-for="type in dashboardTypeChips" :key="type" class="run-dashboard-chip" role="menuitemcheckbox"
                :aria-checked="dashboardTypeShown(type)" :class="{ active: dashboardTypeShown(type) }"
                :title="`${dashboardTypeShown(type) ? '隐藏' : '显示'}${runDashboardTypeLabel(type)}类型的实例`"
                @click="toggleDashboardType(type)">{{ runDashboardTypeLabel(type) }}</button>
            </div>
            <p v-if="!dashboardGroups.length" class="menu-empty">还没有运行实例</p>
            <template v-for="group in dashboardGroups" :key="group.type">
              <p class="run-dashboard-group"><span class="run-dashboard-group-name">{{ group.name }}</span><span
                class="run-dashboard-group-count">{{ group.running }} 在跑 / {{ group.total }}</span></p>
              <div v-for="row in group.rows" :key="row.id" class="run-dashboard-row" :class="{ 'is-active': row.id === activeRunInstance }">
                <button type="button" class="menu-button run-dashboard-pick" role="menuitem" :title="`切到${row.title}${row.pid ? `（PID ${row.pid}）` : ''}`" @click="pickDashboardInstance(row.id)">
                  <span class="run-dashboard-title">{{ row.title }}</span>
                  <span class="run-dashboard-state" :class="`state-${row.state}`">{{ row.statusText }}</span>
                  <span class="run-dashboard-elapsed">{{ row.elapsedText }}</span>
                </button>
                <button v-if="row.state === 'running'" type="button" class="run-dashboard-stop" :aria-label="`停止${row.title}`" :title="`停止${row.title}`" @click="stopDashboardInstance(row.id)"><Square :size="iconSize.inline" aria-hidden="true" /></button>
              </div>
            </template>
          </div>
        </div>
      </div>
    </div><button class="icon-button" title="随处搜索 (Shift+Shift)" aria-label="随处搜索" :disabled="c.working" @click="c.openSearchEverywhere()"><Search :size="iconSize.rail" /></button><button class="icon-button" title="设置 (Ctrl+Alt+S)" aria-label="打开设置" :disabled="c.working" @click="c.openSettings()"><Cog :size="iconSize.rail" /></button></div>
  </div>
</template>

<style scoped>
/* 「更多」弹层（`MoreRunToolbarActions`）：贴着运行 widget 右下方展开，宽度按内容。 */
.header-run-more { position: relative; display: inline-flex; }
.run-more-popup { position: absolute; right: 0; top: calc(100% + 4px); z-index: 30; display: flex; flex-direction: column; min-width: 176px; padding: var(--space-1); background: var(--elevated); border: var(--popup-border); border-radius: var(--popup-radius); box-shadow: var(--shadow-2); }
.run-more-row { display: flex; align-items: center; justify-content: space-between; gap: var(--space-4); width: 100%; }
.run-more-row:disabled { color: var(--muted); }
.run-more-keys { color: var(--muted); font-size: 10px; }
/* ExecutionTargetsToolbarGroup：活动目标是本机时整格不渲染（ExecutionTargetComboBoxAction.kt:60-63）。 */
.header-targets { position: relative; display: inline-flex; }
.targets-popup { position: absolute; left: 0; top: calc(100% + 4px); z-index: 30; display: flex; flex-direction: column; gap: 1px; min-width: 200px; max-height: 320px; overflow: auto; padding: var(--space-1); background: var(--elevated); border: var(--popup-border); border-radius: var(--popup-radius); box-shadow: var(--shadow-2); }
.targets-separator { margin: 0; padding: 2px var(--space-2); color: var(--muted); font-size: 10px; text-transform: uppercase; }
.targets-row { display: flex; align-items: center; justify-content: space-between; gap: var(--space-2); width: 100%; }
.targets-row:disabled { color: var(--muted); }
.targets-row-label { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.targets-row-check { color: var(--accent); font-size: 10px; }
/* 运行仪表盘（执行域 dashboard 的可移植子集）：实例行 + 状态/时长 + 单实例停止。 */.header-run-dashboard { position: relative; display: inline-flex; }
.run-dashboard-popup { position: absolute; right: 0; top: calc(100% + 4px); z-index: 30; display: flex; flex-direction: column; gap: 1px; min-width: 260px; max-height: 320px; overflow: auto; padding: var(--space-1); background: var(--elevated); border: var(--popup-border); border-radius: var(--popup-radius); box-shadow: var(--shadow-2); }
.run-dashboard-summary { margin: 0; padding: 2px var(--space-2); color: var(--muted); font-size: 10px; }
/* 类型开关（`RunDashboardManager.setTypes` 那一档）+ 分组头（`RunDashboardGroup.getName()`）。 */
.run-dashboard-types { display: flex; flex-wrap: wrap; gap: 2px; padding: 2px var(--space-2); border-bottom: 1px solid var(--line); }
.run-dashboard-chip { padding: 1px var(--space-2); border: 1px solid var(--line); border-radius: 3px; background: transparent; color: var(--muted); font-size: 10px; }
.run-dashboard-chip.active { border-color: var(--accent); color: var(--accent); }
.run-dashboard-chip:hover { background: var(--hover); }
.run-dashboard-group { display: flex; align-items: baseline; justify-content: space-between; gap: var(--space-2); margin: 0; padding: var(--space-1) var(--space-2) 1px; color: var(--text); font-size: 11px; font-weight: 600; }
.run-dashboard-group-count { color: var(--muted); font-size: 10px; font-weight: 400; }
.run-dashboard-row { display: flex; align-items: center; gap: 2px; }
.run-dashboard-row.is-active .run-dashboard-title { color: var(--bright); font-weight: 600; }
.run-dashboard-pick { display: flex; align-items: center; gap: var(--space-2); flex: 1; min-width: 0; }
.run-dashboard-title { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; text-align: left; }
.run-dashboard-state { font-size: 10px; color: var(--muted); }
.run-dashboard-state.state-running { color: var(--accent); }
.run-dashboard-state.state-failed { color: var(--error); }
.run-dashboard-elapsed { font-size: 10px; color: var(--muted); }
.run-dashboard-stop { border: 0; padding: 2px 4px; background: transparent; color: var(--muted); cursor: pointer; line-height: 0; }
.run-dashboard-stop:hover { color: var(--error); }
</style>
