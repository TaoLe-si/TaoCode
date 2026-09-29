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
import { ChevronDown, FileCode2, FolderOpen, GitBranch, Hammer, Play, Search, SlidersHorizontal, Square, Bug } from 'lucide-vue-next'
import { ACCESSIBLE_NAME_PREFIX } from '../filenameWidget'

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
  // 右段 · SearchEverywhere + SettingsEntryPoint
  working: boolean
  // 这个放大镜是 `SearchEverywhere`（PlatformActions.xml:850），不是「查找操作」——
  // IDEA 的 Find Action (Ctrl+Shift+A) 只有键位，没有工具栏按钮。
  openSearchEverywhere: () => void
  openSettings: () => void
}

const props = defineProps<{ ctx: MainToolbarContext }>()
// **不要解构 ctx**：它的字段是 getter（`unref(...)`），解构会把值**快照**下来 ——
// `gitHead`/`filenameShown` 这些是异步加载的，快照意味着它们永远停在初始值，整行看着就是空的。
// 保留 `ctx` 本身、在模板里写 `ctx.xxx`，每次渲染都会重新走 getter。
const c = props.ctx
</script>

<template>
  <div class="topbar-toolbar">
    <div class="project-widget"><button class="header-widget" :aria-expanded="c.projectWidgetOpen" aria-haspopup="menu" :aria-label="`项目 ${c.workspace.name}`" :title="c.workspace.root" @click.stop="c.toggleProjectWidget"><FolderOpen :size="14" /><span class="project-widget-name">{{ c.workspace.name }}</span><ChevronDown :size="12" :class="{ 'project-widget-caret': true, open: c.projectWidgetOpen }" /></button><div v-if="c.projectWidgetOpen" class="project-widget-popup" role="menu" :aria-label="`项目 ${c.workspace.name}`"><input :value="c.projectWidgetQuery" class="project-widget-search" placeholder="搜索项目（名称或路径）" aria-label="搜索项目" @input="c.setProjectWidgetQuery(($event.target as HTMLInputElement).value)" @keydown.esc.stop="c.projectWidgetQuery ? c.setProjectWidgetQuery('') : c.closeProjectWidget()" /><template v-for="group in c.projectWidgetGroups" :key="group.label"><div class="project-widget-group" role="presentation">{{ group.label }}</div><button v-for="project in group.items" :key="`${group.label}:${project.path}`" class="menu-button project-widget-row" role="menuitem" :disabled="c.working || !project.available" :title="project.path" @click="c.pickProjectFromWidget(project)"><span class="menu-item-icon"><FolderOpen :size="13" /></span><span class="project-widget-details"><span class="project-widget-title">{{ project.name }}</span><span class="project-widget-path">{{ project.path }}</span><span v-if="c.branchOfProject(project.path)" class="project-widget-branch"><GitBranch :size="11" />{{ c.branchOfProject(project.path) }}</span></span></button></template><p v-if="!c.projectWidgetGroups.length" class="menu-empty">没有匹配的项目</p></div></div>

    <!-- IDEA 新 UI 的 `main.toolbar.git.Branches` widget（Git4Idea 挂在 `MainToolbarVCSGroup` 的
         anchor="first"，而该组在 `MainToolbarLeft` 里 —— 解析结果见 actionGroupStructure.txt:2479-2483）：
         点它打开**分支弹窗**（GitBranchesPopup），不是切到源代码管理工具窗口。 -->
    <div v-if="c.gitHead" class="branch-widget-anchor">
      <button class="header-widget branch-widget" :aria-expanded="c.branchPopupOpen" aria-haspopup="dialog" :title="`当前分支 ${c.gitHead}（点击切换 / 新建）`" aria-label="Git 分支" @click.stop="c.branchPopupOpen ? c.closeBranchPopup() : c.openBranchPopup()"><GitBranch :size="14" /><span>{{ c.gitHead }}</span><span v-if="c.gitAheadBehind.available && (c.gitAheadBehind.ahead || c.gitAheadBehind.behind)" class="header-widget-count">{{ c.gitAheadBehind.ahead ? `↑${c.gitAheadBehind.ahead}` : '' }}{{ c.gitAheadBehind.behind ? `↓${c.gitAheadBehind.behind}` : '' }}</span></button>
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
      ><FileCode2 :size="14" /><span class="filename-text">{{ c.filenameLabel }}</span></button>
      <div v-if="c.filenamePopup" class="filename-popup" role="listbox" :aria-label="`${ACCESSIBLE_NAME_PREFIX} ${c.filenameLabel}`">
        <button v-for="row in c.filenameRecentRows" :key="row.path" class="menu-button filename-row" role="option" :aria-selected="false" :title="row.path" @click="c.pickRecentFile(row.path)"><FileCode2 :size="13" :class="`filename-${c.recentFileKind(row.path)}`" /><span class="filename-row-text">{{ row.name }}</span></button>
      </div>
    </div>

    <!-- 右段（PlatformActions.xml:849-852 + ExecutionActions.xml:117-119/:133-135，
         解析后顺序见 actionGroupStructure.txt:2501-2506）：
         `ExecutionTargetsToolbarGroup` + `NewUiRunWidget` + SearchEverywhere + SettingsEntryPoint。
         本仓没有执行目标组，所以运行 widget 就是右段第一项 —— 排在文件名之后、搜索之前。
         主题切换与帮助**不放这里** —— IDEA 的工具栏没有它们（主题在「设置 › 外观」，帮助在「帮助」菜单），
         本仓那两处入口都在，所以工具栏只留 IDEA 定义的那两个。 -->
    <div class="topbar-right"><div class="topbar-widgets">
      <div class="header-run">
        <!-- IDEA 的运行 widget = `RunToolbarMainActionGroup`（ExecutionActions.xml:121-128）的顺序：
             RedesignedRunConfigurationSelector → compositeResumeGroup（运行/调试）→
             RunToolbarTopLevelExecutorActionGroup（执行器）→ Stop → MoreRunToolbarActions。
             所以**配置选择器在最前**，构建占执行器那格。所有动作都复用菜单里同一套实现。 -->
        <button class="header-widget run-caret" :aria-expanded="c.configChooser !== null" aria-haspopup="menu" :title="`选择运行配置 (Alt+Shift+F10)：${c.runConfigName || '未选择'}`" aria-label="选择运行配置" @click="c.openConfigChooser(false)"><span class="run-config-name">{{ c.runConfigName || '未选择配置' }}</span>▾</button>
        <button class="header-widget build-button" :title="`构建项目 (Ctrl+F9)${c.isDesktop ? '' : ' · 仅桌面端'}`" aria-label="构建项目" :disabled="!c.isDesktop || !c.workspace || c.runState.running" @click="void c.startBuild(false)"><Hammer :size="14" aria-hidden="true" /></button>
        <button class="header-widget run-button" :class="{ running: c.runState.running }" :title="c.runWidgetTitle" aria-label="运行" @click="c.runState.running ? void c.stopRun() : void c.runSelectedConfig(false)"><Play v-if="!c.runState.running" :size="14" /><Square v-else :size="12" /></button>
        <button class="header-widget debug-button" :title="c.debugButtonTitle" aria-label="调试" :disabled="!c.isDesktop || !c.workspace || c.dapState.running" @click="void c.runSelectedConfig(true)"><Bug :size="14" aria-hidden="true" /></button>
        <button class="header-widget stop-button" title="停止 (Ctrl+F2)" aria-label="停止" :disabled="!c.runState.running && !c.dapState.running" @click="void c.stopAnyProcess()"><Square :size="12" aria-hidden="true" /></button>
      </div>
    </div><button class="icon-button" title="随处搜索 (Shift+Shift)" aria-label="随处搜索" :disabled="c.working" @click="c.openSearchEverywhere()"><Search :size="17" /></button><button class="icon-button" title="设置 (Ctrl+Alt+S)" aria-label="打开设置" :disabled="c.working" @click="c.openSettings()"><SlidersHorizontal :size="17" /></button></div>
  </div>
</template>
