<script setup lang="ts">
// 工具窗口视图宿主：一处渲染全部工具窗口内容组件。
// IDEA 里同一份 ToolWindow content 可以停靠在任意边（left/right/bottom），TaoCode 之前把"左侧视图"
// 写死在左侧栏、底部只认固定 tab 集合。抽成宿主后，左侧栏与底部停靠共用同一批组件
// （桃 2026-09-27：模块化 + 对照 IDEA 的任意停靠）。
import SearchPanel from './SearchPanel.vue'
import TodoPanel from './TodoPanel.vue'
import OutlinePanel from './OutlinePanel.vue'
import BookmarksPanel from './BookmarksPanel.vue'
import DebugPanel from './DebugPanel.vue'
import SourceControl from './SourceControl.vue'
import VcsLog from './VcsLog.vue'
import GradlePanel from './GradlePanel.vue'
import EventLogPanel from './EventLogPanel.vue'
import FileTree from './FileTree.vue'
import ProjectViewSortSettings from './ProjectViewSortSettings.vue'
import type { getProjectTreeState } from '../projectTreeState'
import { Check, ChevronsDownUp, ChevronsUpDown, Crosshair, Settings2 } from 'lucide-vue-next'
import { iconSize } from '../uiIcons'

export interface ToolWindowViewContext {
  root: string
  active: boolean
  // 复杂内部类型先用 any，随后续批次收紧。
  workspace: any
  activePath: string
  activeTabPath: string
  /** 「项目分析中」的两个输入（见 SourceControl 的 `analyzing`）。 */
  activeConfigured?: boolean
  activeLspRunning?: boolean
  lspReady: boolean
  isDesktop: boolean
  // 复杂内部类型先用 any，随后续批次收紧。
  outline: any
  // 复杂内部类型先用 any，随后续批次收紧。
  sortedBookmarks: any
  historyEpoch: number
  todoPatterns: unknown[]
  // 复杂内部类型先用 any，随后续批次收紧。
  todoSource: any
  /** 通知列表 + 清空（IDEA 的 Notifications 工具窗口，anchor="right"）。 */
  noticeLog?: any[]
  onClearNotices?: () => void
  /** 通知自带的那几个动作按钮（`Notification.addAction`）：跑了要顺带 expire 这条通知。 */
  onRunNoticeAction?: (action: { label: string; run: () => void }) => void
  onExpireNotice?: (id: number) => void
  // 复杂内部类型先用 any，随后续批次收紧。
  treeEntries: any
  // 复杂内部类型先用 any，随后续批次收紧。
  syntheticNodes: any
  indentGuides: boolean
  projectTreeState: ReturnType<typeof getProjectTreeState>
  projectViewFileColor: (path: string, isDirectory?: boolean) => string | null
  fileTreeRef: unknown
  searchPanelRef: unknown
  testRunnerRef: unknown
  // 复杂内部类型先用 any，随后续批次收紧。
  runConfigProgram: any
  // 复杂内部类型先用 any，随后续批次收紧。
  runConfigCwd: any
  runConfigDebugAdapter: string
  // 复杂内部类型先用 any，随后续批次收紧。
  evaluateRequest: any
  // 复杂内部类型先用 any，随后续批次收紧。
  commitSettings: any
  activeFileText: string
  /** Gradle 工具窗口（IDEA Gradle 插件）：检测结果 + 同步结果 + 三个动作。 */
  gradleDetection: any
  gradleDetectionError: string
  gradleResult: any
  gradleMessage: string
  gradleTaskGroups: Array<{ group: string; tasks: any[] }>
  gradleDependencies: any[]
  gradleDependencyGroups: Array<{ project: string; scopes: any[] }>
  gradleAutoReload: string
  /** 已链接的 Gradle 工程目录（`''` = 工作区根）；工具窗口的可用性判据就是它非空。 */
  gradleLinkedProjects: string[]
  onGradleDetect: () => void
  onGradleUnlinkProject: (directory?: string) => void
  onGradleSync: () => void
  onGradleCancel: () => void
  onGradleRunTask: (task: string, directory?: string) => void
  onGradleRefreshProject: (directory?: string) => void
  onGradleLoadDependencies: (directory?: string) => void
  onGradleOpenConfig: (directory?: string) => void
  onGradleSaveRunConfig: (task: string, directory?: string) => void
  /** 只有这两页是合法的落点（IDEA 的 `ShowCommonSettings` / `ShowSettings`）。 */
  onGradleOpenSettings: (section: 'build.tools' | 'reference.settingsdialog.project.gradle') => void
  onSearchOpen: (path: string) => void
  onSearchReplaced: (payload: unknown) => void
  onReveal: (target: { path: string; line: number; column?: number }) => void
  onBookmarkRemove: (entry: unknown) => void
  onBookmarkAssign: () => void
  /** 「按类型和名称对书签进行排序」（上游 `SortGroupBookmarksAction`）。 */
  onBookmarkSortGroup?: (path: string) => void
  /** 文件书签的跳转：把文件打开（没有行号可去）。 */
  onBookmarkOpen?: (path: string) => void
  /** 「书签打开的标签页…」：把所有打开的标签页加成文件书签。 */
  onBookmarkTabs?: () => void
  /** 书签行右键的「编辑描述」（上游 `EditBookmarkAction`）。 */
  onBookmarkEdit?: (entry: { path: string; line?: number }) => void
  /** 书签列表（上游 `ManagerState.groups`）：命名列表 + 那张用项目名当名字的默认列表。 */
  bookmarkLists?: { name: string; isDefault: boolean; entries: unknown[] }[]
  onHistoryRevert: (payload: unknown) => void
  onTreeContext: (payload: any) => void
  /** Shift+F6 = `RenameElement`（`$default.xml:996-998`）：给焦点那一行改名。 */
  onTreeRename: (entry: unknown) => void
  onTreeOpen: (path: string, preview: boolean) => void
  onTreeError: (message: string) => void
  bindSearchPanel: (instance: unknown) => void
  bindFileTree: (instance: unknown) => void
  /** 统一 diff 的上下文行数（IDEA diff 设置 settings.context.lines）。 */
  diffContextLines?: number
  /** VCS 日志的 UI 开关（IDEA vcs.log）。 */
  vcsLogShowTagNames?: boolean
  /** 还没保存的编辑器路径（宿主）—— 提交面板的「提交期间保存文件」要问（第四十四批）。 */
  dirtyPaths?: () => string[]
  // 面板的通知（带动作）与「显示详细信息」用的窗口激活入口。
  notifyFromPanel?: (...args: any[]) => void
  showToolWindow?: (id: string) => void
  /** 保存某个路径（宿主 `save(tab)`）。 */
  savePath?: (path: string) => Promise<unknown>
  /** 「标签名称」（上游 `Vcs.Log.ShowTagNames`）写回项目设置 `vcsLog.showTagNames`。 */
  onSetVcsLogTagNames?: (value: boolean) => void
  vcsLogShowRootNames?: boolean
  /** 命名作用域（IDEA project.scopes）：Find in Files 的范围下拉用它。 */
  scopes?: any
  /** 调试器数据视图（XDebuggerDataViewSettings：隐藏 null / 按名排序）→ DebugPanel 的变量树。 */
  debugView?: any
  /** 单隐式模块名（工作区目录名）：作用域里的 `file[模块名]:…` 用它。 */
  moduleName?: string
  /** 「与某分支比较」的目标（分支弹窗 → 比较）。 */
  gitCompareWith?: string
  /** 书签工具窗口的视图状态（IDEA BookmarksViewState）。 */
  bookmarksView?: any
  onUpdateBookmarksView?: (patch: unknown) => void
  onFoldAll: () => void
  onExpandAll: () => void
  onExpandRecursively: () => void
  canExpandRecursively: () => boolean
  onSelectInProjectView: () => void
  onRefreshTree: () => void
  compactIndents: boolean
  expandWithSingleClick: boolean
  onToggleCompactIndents: () => void
  onToggleExpandWithSingleClick: () => void
}

import { ref } from 'vue'
const gearOpen = ref(false)

const props = defineProps<{
  /** leftView 或 bottomTab 的值：同一批 id 决定渲染哪个视图。 */
  view: string
  ctx: ToolWindowViewContext
  /**
   * 当前这个 dock 的可见性（左侧/右侧是 `explorer`，底部是 `bottom`）。
   * 必须是**声明过的 prop**：本组件的根是 fragment，未声明的属性不会自动透传
   * （Vue 会警告 "Extraneous non-props attributes"），面板就会退回读 `ctx.active` ——
   * 那是左侧栏的可见性，底部停靠的窗口会跟着左栏一起失效。
   */
  active: boolean
  sideBySide?: boolean
}>()
</script>

<template>
  <SearchPanel v-if="view === 'search'" :ref="(instance: any) => ctx.bindSearchPanel(instance)" :root="ctx.root" :active="active" :scopes="(ctx.scopes ?? []) as any" :module-name="ctx.moduleName ?? ''" @open="(payload: any) => ctx.onSearchOpen(payload)" @replaced="ctx.onSearchReplaced as any" />
  <TodoPanel v-else-if="view === 'todo'" :root="ctx.root" :active="active" :patterns="ctx.todoPatterns as any" :source="ctx.todoSource" :scopes="(ctx.scopes ?? []) as any" :module-name="ctx.moduleName ?? ''" @open="(payload: any) => ctx.onSearchOpen(payload)" />
  <OutlinePanel v-else-if="view === 'outline'" :path="ctx.activeTabPath" :symbols="ctx.outline" :available="ctx.lspReady" :source="ctx.todoSource" @jump="({ line, character }: { line: number; character: number }) => ctx.onReveal({ path: ctx.activePath, line, column: (character ?? 0) + 1 })" />
  <BookmarksPanel v-else-if="view === 'bookmarks'" :entries="ctx.sortedBookmarks as any" :active-path="ctx.activePath" :settings="(ctx.bookmarksView ?? {}) as any" :lists="(ctx.bookmarkLists ?? []) as any" @jump="(entry: { path: string; line?: number }) => entry.line === undefined ? ctx.onBookmarkOpen?.(entry.path) : ctx.onReveal({ path: entry.path, line: entry.line - 1 })" @remove="ctx.onBookmarkRemove" @assign="ctx.onBookmarkAssign" @update-settings="(patch: any) => ctx.onUpdateBookmarksView?.(patch)" @bookmark-tabs="ctx.onBookmarkTabs?.()" @edit="(entry: any) => ctx.onBookmarkEdit?.(entry)" @sort-group="(path: string) => ctx.onBookmarkSortGroup?.(path)" />
  <DebugPanel v-else-if="view === 'debug'" :active-path="ctx.activePath" :ready="ctx.isDesktop && Boolean(ctx.workspace)" :root="ctx.root" :evaluate-request="ctx.evaluateRequest" :program="ctx.runConfigProgram" :cwd="ctx.runConfigCwd" :adapter-kind="ctx.runConfigDebugAdapter" :data-view="ctx.debugView" @jump="target => ctx.onReveal({ path: target.path ?? ctx.activePath, line: Math.max(0, target.line - 1) })" />
  <SourceControl v-else-if="view === 'git'" :root="ctx.root" :active="active" :analyzing="Boolean(ctx.activeTabPath) && Boolean(ctx.activeConfigured) && !ctx.activeLspRunning" :todo-patterns="ctx.todoPatterns as any" :commit-settings="ctx.commitSettings" :diff-context-lines="ctx.diffContextLines" :compare-with="ctx.gitCompareWith ?? ''" :dirty-paths="ctx.dirtyPaths" :save-path="ctx.savePath" :show-tool-window="ctx.showToolWindow" @notify="ctx.notifyFromPanel" />
  <VcsLog v-else-if="view === 'vcslog'" :root="ctx.root" :active="active" :show-tag-names="ctx.vcsLogShowTagNames" :show-root-names="ctx.vcsLogShowRootNames" @set-tag-names="ctx.onSetVcsLogTagNames?.($event)" />
  <GradlePanel v-else-if="view === 'gradle'"
    :detection="ctx.gradleDetection" :detection-error="ctx.gradleDetectionError" :result="ctx.gradleResult"
    :message="ctx.gradleMessage" :task-groups="ctx.gradleTaskGroups"
    :dependencies="ctx.gradleDependencies" :dependency-groups="ctx.gradleDependencyGroups"
    :auto-reload="(ctx.gradleAutoReload as any)" :linked-projects="ctx.gradleLinkedProjects"
    :ready="ctx.isDesktop && Boolean(ctx.workspace)"
    @detect="ctx.onGradleDetect" @sync="ctx.onGradleSync" @cancel="ctx.onGradleCancel" @run-task="ctx.onGradleRunTask"
    @unlink="ctx.onGradleUnlinkProject"
    @refresh-project="ctx.onGradleRefreshProject" @load-dependencies="ctx.onGradleLoadDependencies"
    @open-config="ctx.onGradleOpenConfig" @save-run-config="ctx.onGradleSaveRunConfig"
    @open-settings="ctx.onGradleOpenSettings" />
  <!-- IDEA 的 Notifications 工具窗口（`intellij.platform.ide.impl.xml:1210`，`anchor="right"`）：
       复用状态栏那份通知列表 —— 两个入口看到的是同一批 notices。
       工具窗口这一侧是 `NotificationsPanel`：建议/时间线两段 + 搜索 + 每行一个 ⋮ 菜单
       （`NotificationsPanel.kt:538-613` / `:1106-1153`）；状态栏弹层仍是那张单列
       `NoticeList`。 -->
  <EventLogPanel v-else-if="view === 'notifications'" :entries="(ctx.noticeLog ?? []) as any" :root="ctx.root" @clear="ctx.onClearNotices" @expire="ctx.onExpireNotice?.($event)" @run="ctx.onRunNoticeAction?.($event)" />
  <template v-else>
    <!-- ProjectViewToolbar is a tool-window TITLE action group.
         原来这里用 Teleport 把动作行搬进 dock 的标题栏（`#project-title-actions-left`），
         但那**必然失败**：Vue 挂载 `v-if` 出来的整个 `<aside class="explorer-panel">` 时，
         先把子树挂进游离元素、最后才插入文档，所以 ToolWindowView 首次挂载时
         `document.querySelector` 找不到那个目标 —— 标题栏里的容器一直是空的，
         补丁阶段还会因为 teleport 子树没有 el 而抛
         `Cannot set properties of null (setting '__vnode')`，把同一批次后面的
         兄弟节点（底部工具窗口条）一起带崩。
         现在就地渲染：名称在工具窗口标题栏，动作行在内容区顶部 —— 正是 IDEA 的
         Project 工具窗口（ToolWindowHeader 给标题，ProjectView 的 toolbar 在树上方）。 -->
    <div v-if="ctx.workspace" class="workspace-heading" :title="ctx.workspace.root" @keydown.f5.prevent="ctx.onRefreshTree()">
      <div class="heading-actions">
        <!-- PlatformActions.xml:1178-1184 order. Registry defaults replace
             ExpandAll with ExpandRecursively; hidden bulk action stays callable. -->
        <button class="icon-button" title="在项目视图中选择 (Alt+F1)" aria-label="在项目视图中选择当前文件" :disabled="!ctx.workspace || !ctx.activePath" @click="ctx.onSelectInProjectView()"><Crosshair :size="iconSize.toolbar" /></button>
        <button class="icon-button" title="递归展开所选目录" aria-label="递归展开所选目录" :disabled="!ctx.canExpandRecursively()" @click="ctx.onExpandRecursively()"><ChevronsUpDown :size="iconSize.toolbar" /></button>
        <button class="icon-button" title="全部折叠" aria-label="全部折叠" :disabled="!ctx.workspace" @click="ctx.onFoldAll()"><ChevronsDownUp :size="iconSize.toolbar" /></button>
        <button class="icon-button" :aria-expanded="gearOpen" aria-haspopup="menu" title="视图选项" aria-label="视图选项" @click.stop="gearOpen = !gearOpen"><Settings2 :size="iconSize.toolbar" /></button>
      </div>
      <!-- 齿轮菜单（ProjectView 的 Tree Appearance 组） -->
      <div v-if="gearOpen" class="dropdown view-gear-menu" role="menu" aria-label="视图选项" @click.stop @keydown.esc.stop.prevent="gearOpen = false">
        <!-- `ProjectView.ToolWindow.Behavior.Actions`（`intellij.platform.projectView.xml:44-55`）：
             这一组是**项目视图自己的**齿轮项（`ProjectViewImpl.java:1169` 的 additionalGearActions），
             顺序照源码：Behavior 组在最前，然后才是排序与外观。 -->
        <div class="menu-section-label" role="presentation">行为</div>
        <button class="menu-item" role="menuitemcheckbox" :aria-checked="ctx.projectTreeState.state.autoscrollToSource" @click="ctx.projectTreeState.update({ autoscrollToSource: !ctx.projectTreeState.state.autoscrollToSource })"><span class="menu-item-icon"><Check v-if="ctx.projectTreeState.state.autoscrollToSource" :size="iconSize.menu" aria-hidden="true" /></span><span class="menu-item-title">单击打开文件</span></button>
        <button class="menu-item" role="menuitemcheckbox" :aria-checked="ctx.projectTreeState.state.autoscrollFromSource" @click="ctx.projectTreeState.update({ autoscrollFromSource: !ctx.projectTreeState.state.autoscrollFromSource })"><span class="menu-item-icon"><Check v-if="ctx.projectTreeState.state.autoscrollFromSource" :size="iconSize.menu" aria-hidden="true" /></span><span class="menu-item-title">始终选择打开的文件</span></button>
        <button class="menu-item" role="menuitemcheckbox" :aria-checked="ctx.projectTreeState.state.openInPreviewTab" @click="ctx.projectTreeState.update({ openInPreviewTab: !ctx.projectTreeState.state.openInPreviewTab })"><span class="menu-item-icon"><Check v-if="ctx.projectTreeState.state.openInPreviewTab" :size="iconSize.menu" aria-hidden="true" /></span><span class="menu-item-title">用预览标签打开</span></button>
        <div class="menu-rule" role="separator" />
        <ProjectViewSortSettings :settings="ctx.projectTreeState.state" :persistence-error="ctx.projectTreeState.status.persistenceError" @update="ctx.projectTreeState.update" />
        <div class="menu-rule" role="separator" />
        <div class="menu-section-label" role="presentation">树外观</div>
        <button class="menu-item" role="menuitemcheckbox" :aria-checked="ctx.compactIndents" @click="ctx.onToggleCompactIndents()"><span class="menu-item-icon"><Check v-if="ctx.compactIndents" :size="iconSize.menu" aria-hidden="true" /></span><span class="menu-item-title">紧凑缩进</span></button>
        <button class="menu-item" role="menuitemcheckbox" :aria-checked="ctx.expandWithSingleClick" @click="ctx.onToggleExpandWithSingleClick()"><span class="menu-item-icon"><Check v-if="ctx.expandWithSingleClick" :size="iconSize.menu" aria-hidden="true" /></span><span class="menu-item-title">单击展开目录</span></button>
      </div>
      <div v-if="gearOpen" class="view-gear-backdrop" @click="gearOpen = false" />
    </div>
    <div class="tree-scroll" @keydown.f5.prevent="ctx.onRefreshTree()">
      <FileTree v-if="ctx.workspace" :ref="(instance: any) => ctx.bindFileTree(instance)" :key="ctx.root" :entries="ctx.treeEntries" :active="ctx.activePath" :synthetic="ctx.syntheticNodes" :indent-guides="ctx.indentGuides" :compact-indents="ctx.compactIndents" :expand-with-single-click="ctx.expandWithSingleClick" :workspace-key="ctx.root" :project-name="ctx.workspace.name" :file-color="ctx.projectViewFileColor" :sort-settings="ctx.projectTreeState.state" @context="ctx.onTreeContext" @rename="ctx.onTreeRename" @open="(path: string, preview: boolean) => ctx.onTreeOpen(path, preview)" @error="ctx.onTreeError" />
      <div v-else class="explorer-empty"><p>尚未打开工作区</p></div>
    </div>
  </template>
</template>
