<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, useId, watch } from 'vue'
import { BellDot, ChevronDown, CircleHelp, Copy, FolderOpen, FolderPlus, FolderSearch, GitBranch, Moon, Palette, Plug, RefreshCw, Search, Settings, Sun, X } from 'lucide-vue-next'
import { GROUP_MENU_LABELS, lastOpenedPath, matchesSearch, systemDependentPath } from '../welcomeProjects'
import { UNGROUPED, createWelcomeProjectGroups } from '../welcomeProjectGroups'
import {
  avatarInitials, copiedPathNote, forgetDialogText, listStatusText, openedDate,
  revealedNote, reopenDialogText,
} from '../welcomeRowText'
import { deleteTargets, isRowDeleteKey, searchKeyAction, selectionAfterClick } from '../welcomeRowSelection'
import {
  PROJECT_COLOR_AUTO_LABEL, PROJECT_COLOR_CHOICES, PROJECT_COLOR_MENU_LABEL, PROJECT_ICON_GRADIENTS, avatarTone,
  clearProjectColorOverride, hasProjectColorOverride, projectColorLabel, projectColorOverride, projectGradient,
  setProjectColorOverride,
} from '../welcomeProjectColor'
import { noticeButtonText, noticeButtonVisible, noticeTitle, type NoticeEntry } from '../notices'
import { copyToClipboard } from '../clipboard'
import { clampEditorFontSize, MAX_EDITOR_FONT_SIZE, MIN_EDITOR_FONT_SIZE } from '../editorFontSize'
import { request, type EditorSettings, type RecentProject } from '../bridge'
import type { Theme } from '../appearance'
import NoticeList from './NoticeList.vue'
import { iconSize } from '../uiIcons'

const props = defineProps<{
  projects: RecentProject[]
  busy: boolean
  error: string
  gitAvailable: boolean
  isDesktop: boolean
  pluginCount: number
  theme: Theme
  settings: EditorSettings
  /** The application notification log (`src/notices.ts`), shown by the notification toolbar. */
  notices: NoticeEntry[]
  /** GeneralSettings.isSupportScreenReaders — announces notifications to assistive tech. */
  screenReaderLive: boolean
}>()
const emit = defineEmits<{
  open: [path?: string]
  create: []
  clone: []
  settings: []
  forget: [path: string]
  'forget-batch': [paths: string[]]
  refresh: []
  help: []
  /** WelcomeScreen.Options entries backed by the help actions (About / BrowseSpecialPaths / CollectZippedLogs). */
  option: [id: 'about' | 'paths' | 'logs']
  plugins: []
  /** 第二个参数是点击事件：主题切换的水纹从点击位置扩散（见 src/themeRipple.ts）。 */
  theme: [theme: Theme, event?: MouseEvent]
  'settings-change': [patch: Partial<EditorSettings>]
  /** "全部清空" in the notification popup (`IDEA`'s notification centre). */
  clearNotices: []
}>()
// NotificationEventAction's toggle: the popup takes focus so Escape reaches it, exactly like the
// balloon the action pops up on the welcome screen (`NotificationEventAction.kt:63-79`).
const notificationsOpen = ref(false)
const noticeBox = ref<HTMLElement>()
// IDEA WelcomeScreen.Options (PlatformActions.xml): the sidebar gear is a quick-access
// toolbar button (TabbedWelcomeScreen.createQuickAccessPanel, BorderLayout.SOUTH) whose
// action is createShowPopupAction of that group — it does not open Settings directly.
// TaoCode only implements the two actions that already have a surface (ShowSettings, About).
const optionsOpen = ref(false)
watch(notificationsOpen, async open => {
  if (!open) return
  await nextTick()
  noticeBox.value?.focus()
})

const id = useId()
// IDEA's welcome screen is tabbed (TabbedWelcomeScreen + ProjectsTabFactory /
// CustomizeTabFactory / LearnIdeTabFactory): the left rail switches pages, it does
// not jump into the project list. 自定义 is a real page here — theme, UI zoom and
// editor font size, all writing through the same settings as the Settings dialog.
const page = ref<'projects' | 'customize'>('projects')
const moreOpen = ref(false)
const query = ref('')
const searchInput = ref<HTMLInputElement>()
const filteredProjects = computed(() => props.projects.filter(project => matchesSearch(project, groupOf(project.path), query.value)))
// 行文本的规则（时间格式、头像缩写、两个确认框的措辞）在 src/welcomeRowText.ts。
const listStatus = computed(() => listStatusText({
  note: copyNote.value, busy: props.busy, query: query.value,
  visibleCount: filteredProjects.value.length, totalCount: props.projects.length,
}))
function confirmForget(projects: RecentProject[]) {
  const text = forgetDialogText(projects)
  if (!text || !window.confirm(text.message)) return
  menuPath.value = ''
  // RecentProjectsManagerBase.kt:270-279 calls removePath per path and fires a single
  // change event at the end, so the page batches here: emit one batch signal so the
  // native side can mirror it on every entry in a single state-mutation pass.
  emit('forget-batch', projects.map(project => project.path))
}
function forgetSingle(project: RecentProject) { confirmForget([project]) }
// ReopenProjectAction.showReopenDialog (ReopenProjectAction.kt:84-94): when the path
// disappeared, the IDE offers two buttons — OK (closes the dialog, project stays on
// the list) and "Remove from list" (calls removePath). We mirror the same choice.
function showReopenDialog(project: RecentProject) {
  if (window.prompt(reopenDialogText(project.path), '继续') === null) confirmForget([project])
}
function onRowKeydown(project: RecentProject, event: KeyboardEvent) {
  if (!isRowDeleteKey(event.key)) return
  event.preventDefault()
  confirmForget(deleteTargets(filteredProjects.value, selectedPaths.value, project.path))
}
// IDEA's RecentProjectPanel shows each project's git branch under the path; the
// branch was recorded by the IDE the last time the project was open (see the
// gitHead watch in App.vue), so it costs nothing on the welcome page.
function branchOf(path: string): string {
  if (!props.isDesktop) return ''
  try { return localStorage.getItem(`taocode.branch:${path}`) ?? '' } catch { return '' }
}
function clearSearch() {
  query.value = ''
  searchInput.value?.focus()
}

// --- 项目颜色（ChangeProjectColorActionGroup.kt:33-44）---------------------------------------
// 上游这一族挂在**项目窗口标题栏**的菜单上；本仓的项目颜色唯一可见处是欢迎页这一行，
// 所以照上游的**次序**放在行菜单里：分组那一段之后、那条分隔线之前（PlatformActions.xml:1026，
// 正是上游 ChangeProjectIcon 所在的那一行）。
const colorMenuPath = ref('')
// 头像渐变随「用户选的颜色 / 按路径自动生成」切换，所以要一个版本号让这一行重算。
const colorVersion = ref(0)
function currentColorIndex(path: string): number | undefined {
  void colorVersion.value
  return projectColorOverride(path)
}
function colorLabel(path: string, index: number) {
  void colorVersion.value
  return projectColorLabel({ index, name: PROJECT_COLOR_CHOICES.find(choice => choice.index === index)?.name ?? '' }, currentColorIndex(path))
}
function pickColor(project: RecentProject, index: number) {
  setProjectColorOverride(project.path, index)
  colorVersion.value += 1
  colorMenuPath.value = ''
}
function resetColor(project: RecentProject) {
  clearProjectColorOverride(project.path)
  colorVersion.value += 1
  colorMenuPath.value = ''
}
function colorAutoDisabled(path: string) {
  void colorVersion.value
  return !hasProjectColorOverride(path)
}
function toggleColorMenu(path: string) {
  colorMenuPath.value = colorMenuPath.value === path ? '' : path
  menuPath.value = path
}
function gradientOf(path: string) { void colorVersion.value; return projectGradient(path) }
function toneOf(path: string) { void colorVersion.value; return avatarTone(path) }
/** 色板里某一个槽位自己的那一对渐变（菜单里每个色块的底色 —— 与当前选没选它无关）。 */
function choiceGradient(index: number) { return PROJECT_ICON_GRADIENTS[index]! }
// IDEA's project list: the ⋮ at the row end opens the row menu (open / remove from
// the list); the row itself is highlighted while its menu is open.
const menuPath = ref('')
// --- 分组（`ProjectGroup` 一族）：读法/写法、桶序、折叠、新建/改名/移入移出都在
// src/welcomeProjectGroups.ts（纯逻辑，可单测），这里只留接线。
const {
  groupCollapsed, groupedProjects, groupingActive, groupOf, moveTargets,
  moveToGroup, createGroup, renameGroup, toggleGroupCollapsed, onGroupKeydown,
} = createWelcomeProjectGroups({
  recentProjects: () => filteredProjects.value,
  closeMenu: () => { menuPath.value = '' },
})

function toggleMenu(path: string) {
  menuPath.value = menuPath.value === path ? '' : path
}

// RecentProjectFilteringTree.kt:189-191 binds ENTER to "activate the selected item" and
// ALT+DELETE to "remove it"; the tree selection is what those keys act on, so the page keeps track
// of the focused row and falls back to the first visible project.
const focusedPath = ref('')
// 选区怎么变（裸点击/Shift 段选/Ctrl 单行）在 src/welcomeRowSelection.ts，这里只留接线。
const selectedPaths = ref<Set<string>>(new Set())
const lastClickedPath = ref('')
const selectedProjects = computed(() => filteredProjects.value.filter(project => selectedPaths.value.has(project.path)))
function clearSelection() {
  if (selectedPaths.value.size === 0) return
  selectedPaths.value = new Set()
}
function onRowClick(project: RecentProject, event: MouseEvent) {
  // Focus row regardless of modifier.
  focusedPath.value = project.path
  const next = selectionAfterClick(
    filteredProjects.value.map(item => item.path), selectedPaths.value, lastClickedPath.value, project.path, event,
  )
  selectedPaths.value = next.selected
  lastClickedPath.value = next.lastClicked
}
watch(() => props.projects, () => { clearSelection() })
const activeProject = computed(() => filteredProjects.value.find(project => project.path === focusedPath.value)
  ?? filteredProjects.value[0])
// ReopenProjectAction.actionPerformed first normalises the path; if `Files.notExists`
// fires, it calls showReopenDialog. We mirror the same split: the row button emits
// "open" for live paths, and `tryOpen` short-circuits to showReopenDialog for the
// missing ones so the user gets the same "Remove from list" choice.
function tryOpen(project: RecentProject) {
  menuPath.value = ''
  if (project.available) emit('open', project.path)
  else showReopenDialog(project)
}
function openProject(project: RecentProject) {
  menuPath.value = ''
  emit('open', project.path)
}
// CopyProjectPathAction (ActionsBundle.properties:2208 `action.WelcomeScreen.CopyProjectPath.text`)
// copies the absolute path in the platform's own separator form.
const copyNote = ref('')
let copyTimer: number | undefined
function copyProjectPath(project: RecentProject) {
  menuPath.value = ''
  const text = systemDependentPath(project.path, props.isDesktop)
  void copyToClipboard(text)
  copyNote.value = copiedPathNote(text)
  if (copyTimer !== undefined) clearTimeout(copyTimer)
  copyTimer = window.setTimeout(() => { copyNote.value = '' }, 4000)
}
// RevealProjectDirAction (:25-33) opens the *parent* directory with the project path selected —
// `RevealFileAction.openFile(Path)` (:170-174) canonicalizes the path and passes its parent, and on
// Windows `doOpen` (:273) reaches Explorer as `explorer /select,"<path>"`. A project whose folder is
// gone still works, because `update` (:17-21) only asks for a selected RecentProjectItem, not for an
// existing directory. The native side does that and reports the reason when it cannot.
async function revealProjectDir(project: RecentProject) {
  menuPath.value = ''
  try {
    await request('shell.reveal', { path: project.path })
    copyNote.value = revealedNote(project.path)
  } catch (error) {
    copyNote.value = error instanceof Error ? error.message : String(error)
  }
  if (copyTimer !== undefined) clearTimeout(copyTimer)
  copyTimer = window.setTimeout(() => { copyNote.value = '' }, 4000)
}
function onSearchKeydown(event: KeyboardEvent) {
  const project = activeProject.value
  const action = searchKeyAction(event.key, event.altKey, project, props.busy)
  if (action === null) return
  event.preventDefault()
  if (!project) return
  if (action === 'open') openProject(project)
  else if (action === 'remove') confirmForget([project])
}
// selectLastOpenedProject() — RecentProjectFilteringTree.kt:236-254, called while the Projects tab
// is built (ProjectsTabFactory.kt:170,210): the list starts with the project the IDE opened last
// focused, so ENTER / ALT+DELETE act on it right away. Only the first load grabs the focus.
const rowElements = new Map<string, HTMLElement>()
let autoFocused = false
function setRow(path: string, element: unknown) {
  if (element instanceof HTMLElement) rowElements.set(path, element)
  else rowElements.delete(path)
}
async function focusLastOpened() {
  if (autoFocused || page.value !== 'projects' || !props.projects.length) return
  const path = lastOpenedPath(props.projects)
  if (!path) return
  await nextTick()
  const row = rowElements.get(path)
  if (!row) return
  autoFocused = true
  // IDEA moves the selection; only take the focus when nothing else owns it, so a user who has
  // already clicked into the search box is not pulled away.
  if (document.activeElement === document.body || document.activeElement === null) row.focus()
}
watch(() => props.projects, focusLastOpened, { immediate: true, deep: false })
// The rows only exist after the first render, so the initial load is handled here as well.
onMounted(focusLastOpened)
onBeforeUnmount(() => { if (copyTimer !== undefined) clearTimeout(copyTimer) })
</script>

<template>
  <div class="project-welcome">
    <aside class="welcome-sidebar">
      <div class="welcome-brand">
        <div class="brand">TaoCode</div>
      </div>
      <nav class="welcome-navigation" aria-label="欢迎页导航">
        <button type="button" class="menu-button navigation-item" :class="{ selected: page === 'projects' }" :aria-current="page === 'projects' ? 'page' : undefined" @click="page = 'projects'">
          <FolderOpen :size="iconSize.action" aria-hidden="true" />项目
        </button>
        <button type="button" class="menu-button navigation-item" :class="{ selected: page === 'customize' }" :aria-current="page === 'customize' ? 'page' : undefined" @click="page = 'customize'">
          <Palette :size="iconSize.action" aria-hidden="true" />自定义
        </button>
        <button
          type="button" class="menu-button navigation-item" :disabled="busy || !isDesktop"
          @click="emit('plugins')"
        >
          <Plug :size="iconSize.action" aria-hidden="true" />插件
          <span v-if="pluginCount" class="nav-badge" :title="`${pluginCount} 个已安装插件`">{{ pluginCount }}</span>
        </button>
        <button type="button" class="menu-button navigation-item" :disabled="busy" @click="emit('help')">
          <CircleHelp :size="iconSize.action" aria-hidden="true" />关于
        </button>
      </nav>
      <!-- IDEA TabbedWelcomeScreen.createQuickAccessPanel: BorderLayout.SOUTH of the left
           sidebar, FlowLayout.LEFT, 26×26 buttons, New UI border empty(15, 14).
           WelcomeScreenDefaultCustomization wires the Settings icon to a popup of
           WelcomeScreen.Options, not to the Settings dialog itself. -->
      <div class="welcome-quick-access">
        <button
          type="button" class="icon-button welcome-gear" aria-label="选项" title="选项"
          aria-haspopup="menu" :aria-expanded="optionsOpen" :disabled="busy"
          @click.stop="optionsOpen = !optionsOpen"
        >
          <Settings :size="iconSize.action" aria-hidden="true" />
        </button>
        <div v-if="optionsOpen" class="welcome-options" role="menu" aria-label="选项">
          <!-- PlatformActions.xml:994-1005 order: ShowSettings, CheckForUpdate, About | EditCustomProperties,
               EditCustomVmOptions, BrowseSpecialPaths, CollectZippedLogs | CreateDesktopEntry. Actions TaoCode
               has no host for (updates, custom properties/VM options, desktop entry) are not listed. -->
          <button type="button" class="menu-button welcome-options-item" role="menuitem" @click="optionsOpen = false; emit('settings')">设置…</button>
          <button type="button" class="menu-button welcome-options-item" role="menuitem" @click="optionsOpen = false; emit('option', 'about')">关于</button>
          <div class="menu-rule" role="separator" />
          <button type="button" class="menu-button welcome-options-item" role="menuitem" :disabled="!isDesktop" @click="optionsOpen = false; emit('option', 'paths')">特殊文件和文件夹…</button>
          <button type="button" class="menu-button welcome-options-item" role="menuitem" :disabled="!isDesktop" @click="optionsOpen = false; emit('option', 'logs')">收集日志和诊断数据</button>
        </div>
      </div>
      <div v-if="optionsOpen" class="menu-backdrop" @click="optionsOpen = false" />
    </aside>

    <main class="welcome-main">
      <!-- IDEA CustomizeTabFactory: theme, UI scale and font size, applied live
           through the same settings the Settings dialog writes. -->
      <div v-if="page === 'customize'" class="welcome-content customize-page">
        <header class="welcome-heading"><h1>自定义</h1></header>
        <section class="customize-group">
          <h2>主题</h2>
          <div class="theme-options" role="group" aria-label="主题">
            <button type="button" class="subtle-button theme-option" :aria-pressed="theme === 'light'" @click="emit('theme', 'light', $event)"><Sun :size="iconSize.action" aria-hidden="true" /><span>月之亮面</span></button>
            <button type="button" class="subtle-button theme-option" :aria-pressed="theme === 'dark'" @click="emit('theme', 'dark', $event)"><Moon :size="iconSize.action" aria-hidden="true" /><span>月之暗面</span></button>
          </div>
        </section>
        <section class="customize-group">
          <h2>缩放</h2>
          <label class="customize-row">
            <span>整个界面的缩放百分比</span>
            <select :value="settings.uiZoomPercent" @change="emit('settings-change', { uiZoomPercent: Number(($event.target as HTMLSelectElement).value) })">
              <option v-for="percent in [50, 70, 80, 90, 100, 110, 125, 150, 175, 200]" :key="percent" :value="percent">{{ percent }}%</option>
            </select>
          </label>
        </section>
        <section class="customize-group">
          <h2>编辑器字体</h2>
          <label class="customize-row">
            <span>字体大小（像素）</span>
            <input
              type="number" :min="MIN_EDITOR_FONT_SIZE" :max="MAX_EDITOR_FONT_SIZE" step="1" :value="settings.fontSize"
              @change="emit('settings-change', { fontSize: clampEditorFontSize(Number(($event.target as HTMLInputElement).value) || settings.fontSize) })"
            />
          </label>
        </section>
      </div>
      <div v-else class="welcome-content" :aria-labelledby="`${id}-title`">
        <header class="welcome-heading">
          <h1 :id="`${id}-title`">项目</h1>
          <div class="project-actions" aria-label="项目操作">
            <button type="button" class="primary-button" :disabled="busy" @click="emit('create')">
              <FolderPlus :size="iconSize.action" aria-hidden="true" />新建项目
            </button>
            <button type="button" class="subtle-button action-button" :disabled="busy" @click="emit('open')">
              <FolderOpen :size="iconSize.action" aria-hidden="true" />打开项目
            </button>
            <button
              type="button" class="subtle-button action-button" :disabled="busy"
              @click="emit('clone')"
            >
              <GitBranch :size="iconSize.action" aria-hidden="true" />克隆仓库
            </button>
            <button
              v-if="selectedPaths.size > 1" type="button" class="subtle-button action-button"
              :disabled="busy"
              @click="confirmForget(selectedProjects)"
            >
              <X :size="iconSize.action" aria-hidden="true" />移除所选 {{ selectedPaths.size }} 项
            </button>
          </div>
        </header>

        <div v-if="error" class="notice error welcome-error" role="alert"><span>{{ error }}</span></div>

        <section class="recent-section" :aria-labelledby="`${id}-recent-title`" :aria-busy="busy">
          <div class="recent-heading">
            <h2 :id="`${id}-recent-title`">{{ isDesktop ? '近期项目' : '当前会话' }}</h2>
            <button type="button" class="icon-button" :disabled="busy" aria-label="刷新项目列表" title="刷新项目列表" @click="emit('refresh')">
              <RefreshCw :size="iconSize.toolbar" aria-hidden="true" />
            </button>
          </div>
          <div class="project-search">
            <Search :size="iconSize.action" aria-hidden="true" />
            <input :id="`${id}-search`" ref="searchInput" v-model="query" type="search" aria-label="按项目名称、路径或分组搜索" placeholder="搜索项目名称、路径或分组" autocomplete="off" spellcheck="false" @keydown="onSearchKeydown" />
            <button v-if="query" type="button" class="icon-button" aria-label="清空搜索" title="清空搜索" @click="clearSearch"><X :size="iconSize.toolbar" aria-hidden="true" /></button>
          </div>
          <p class="list-status" role="status">{{ listStatus }}</p>

          <div v-if="menuPath" class="menu-backdrop" @click="menuPath = ''" />
          <!-- 列表为空时的空状态：v-else-if / v-else 必须紧跟在 recent-list 的 v-if 之后，
               中间不能插入其它元素（否则链被打断，空状态会与列表同时渲染）。 -->
          <div v-if="filteredProjects.length" class="recent-list">
            <section v-for="group in groupedProjects" :key="group.name" class="recent-group">
              <header v-if="groupingActive" class="recent-group-head">
                <button type="button" class="recent-group-toggle" :aria-expanded="!groupCollapsed.has(group.name)" :aria-label="`${group.name}，${group.projects.length} 个项目，左右方向键折叠展开`" @keydown="onGroupKeydown(group.name, $event)" @click="toggleGroupCollapsed(group.name)">
                  <ChevronDown :size="iconSize.menu" :class="{ collapsed: groupCollapsed.has(group.name) }" aria-hidden="true" />
                  <span class="recent-group-name">{{ group.name }}</span>
                  <span class="recent-group-count">{{ group.projects.length }}</span>
                </button>
                <!-- 「编辑分组…」= 改名。上游它只在**分组行**上出现
                     （`EditProjectGroupAction.kt:48` 的 `isEnabledAndVisible = item is ProjectsGroupItem`），
                     挂在分组行的弹层里（`PlatformActions.xml:1024` = `WelcomeScreen.EditGroup`）。
                     本仓的分组行只有这一个动作，所以给一个带文字的按钮，不再套一层弹出。 -->
                <button v-if="group.name !== UNGROUPED" type="button" class="menu-button group-edit"
                        :aria-label="`${GROUP_MENU_LABELS.edit} ${group.name}`"
                        @click.stop="renameGroup(group.name)">
                  <Settings :size="iconSize.control" aria-hidden="true" />{{ GROUP_MENU_LABELS.edit }}
                </button>
              </header>
              <ul v-show="!groupCollapsed.has(group.name)" class="recent-group-list">
            <li v-for="project in group.projects" :key="project.path" :ref="element => setRow(project.path, element)" class="recent-row" tabindex="0" :aria-label="`${project.name}，Delete 键可从列表移除${selectedPaths.has(project.path) ? '（已选中）' : ''}`" :aria-selected="selectedPaths.has(project.path)" @focus="focusedPath = project.path" @click="onRowClick(project, $event)" @keydown="onRowKeydown(project, $event)" :class="{ 'menu-open': menuPath === project.path, 'is-selected': selectedPaths.has(project.path) }">
              <button
                type="button" class="recent-open" :disabled="busy"
                :title="!project.available ? `路径不存在或不可访问：${project.path}` : undefined"
                @click="tryOpen(project)"
              >
                <span class="project-avatar" :class="`avatar-${toneOf(project.path)}`" :style="{ backgroundImage: `linear-gradient(135deg, ${gradientOf(project.path)[0]}, ${gradientOf(project.path)[1]})` }" aria-hidden="true">{{ avatarInitials(project.displayName || project.projectName || project.name) }}</span>
                <span class="project-details">
                  <span class="project-title"><strong>{{ project.name }}</strong></span>
                  <span v-if="isDesktop" class="project-path" :title="project.path">{{ project.path }}</span>
                  <span v-if="branchOf(project.path)" class="project-branch"><GitBranch :size="iconSize.inline" aria-hidden="true" />{{ branchOf(project.path) }}</span>
                  <span v-if="isDesktop && project.lastOpened" class="project-date"><time>{{ openedDate(project.lastOpened) }}</time></span>
                </span>
              </button>
              <div class="recent-row-actions">
                <span v-if="!project.available && isDesktop" class="missing-tag">路径缺失或不可访问</span>
                <!-- RecentProjectFilteringTree.kt:536-545: the row button is a gear while the project is
                     reachable and a remove icon once its path is gone. -->
                <button
                  type="button" class="icon-button row-menu-button" :disabled="busy"
                  :aria-label="`打开 ${project.name} 的操作菜单`" :title="`打开 ${project.name} 的操作菜单`" :aria-expanded="menuPath === project.path"
                  @click.stop="toggleMenu(project.path)"
                ><Settings v-if="project.available" :size="iconSize.control" aria-hidden="true" /><X v-else :size="iconSize.toolbar" aria-hidden="true" /></button>
              </div>
              <div v-if="menuPath === project.path" class="row-menu" role="menu" :aria-label="`${project.name} 的操作`">
                <button type="button" class="menu-button row-menu-item" role="menuitem" :disabled="busy || !project.available" @click="openProject(project)">
                  <FolderOpen :size="iconSize.control" aria-hidden="true" />打开项目
                </button>
                <!-- 上游 `WelcomeScreenRecentProjectActionGroup`（`PlatformActions.xml:1017-1031`）
                     的前三项与它们的顺序：OpenSelected · RevealIn · CopyProjectPath，接着一个分隔线，
                     之后是 NewGroup / MoveToGroup / EditGroup，最后（:1030）RemoveSelected。
                     行菜单就照这个次序渲染，不再自己排。
                     RevealFileAction.getActionName() = `action.RevealIn.name.other`（"Show in {0}"）
                     带文件管理器名；`isDirectoryOpenSupported()`（`RevealFileAction.java:108-110`）
                     就是这里那个桌面端判断的出处。 -->
                <button
                  type="button" class="menu-button row-menu-item" role="menuitem" :disabled="!isDesktop"
                  @click="revealProjectDir(project)"
                >
                  <FolderSearch :size="iconSize.control" aria-hidden="true" />在资源管理器中显示
                </button>
                <button type="button" class="menu-button row-menu-item" role="menuitem" @click="copyProjectPath(project)">
                  <Copy :size="iconSize.control" aria-hidden="true" />复制路径
                </button>
                <div class="menu-rule" role="separator" />
                <!-- 分组那一段照 `PlatformActions.xml:1022-1024` 的次序：NewGroup → MoveToGroup → EditGroup。
                     `EditProjectGroupAction.kt:48` 的 `isEnabledAndVisible = item is ProjectsGroupItem`
                     说得很清楚：改名只挂在**分组行**上（就是列表里那个分组标题，见下面 `group-edit`），
                     项目行只有前两项。
                     `MoveToGroup` 的弹层（`MoveProjectToGroupActionGroup.kt:38-48`）在本仓是平铺的：
                     各分组按自然序、跳过 tutorials 组（`:39-42`），末尾一条弹层自己的分隔线
                     （`:46` ⇒ 用 `submenu-rule`，不占行菜单那两个 `menu-rule` 计数）
                     + 「从分组移出」（`RemoveSelectedProjectsFromGroupsAction`，
                     文案 `IdeBundle.properties:1793` "Remove from Groups"）。 -->
                <button type="button" class="menu-button row-menu-item" role="menuitem" @click="createGroup()">{{ GROUP_MENU_LABELS.create }}</button>
                <template v-if="groupingActive">
                  <button v-for="name in moveTargets" :key="name" type="button" class="menu-button row-menu-item" role="menuitem" :disabled="groupOf(project.path) === name" @click="moveToGroup(project, name)">移入「{{ name }}」</button>
                  <div v-if="moveTargets.length" class="submenu-rule" role="separator" />
                  <button v-if="moveTargets.length" type="button" class="menu-button row-menu-item" role="menuitem" :disabled="groupOf(project.path) === UNGROUPED" @click="moveToGroup(project, UNGROUPED)">{{ GROUP_MENU_LABELS.removeFromGroups }}</button>
                </template>
                <!-- 上游 `PlatformActions.xml:1026` 的 ChangeProjectIcon 就在这个位置（分组段之后、
                     最后那条分隔线之前）。上游它挂在项目窗口标题栏上；本仓项目颜色唯一可见处是
                     这一行，所以把 ChangeProjectColorActionGroup 的九个具名颜色（:33-41）搬到这里。
                     子菜单自己那条分隔线用 `submenu-rule`（同一套样式）而不是 `menu-rule` ——
                     后者是**行菜单本身**的 :1021 / :1029 两条，判据 tests/welcome-row-menu-order.test.mjs
                     按 `menu-rule` 计数，两层菜单不能混。 -->
                <button
                  type="button" class="menu-button row-menu-item row-menu-submenu-toggle" role="menuitem"
                  :aria-expanded="colorMenuPath === project.path" aria-haspopup="menu"
                  @click="toggleColorMenu(project.path)"
                ><Palette :size="iconSize.control" aria-hidden="true" />{{ PROJECT_COLOR_MENU_LABEL }}<ChevronDown :size="iconSize.menu" aria-hidden="true" /></button>
                <div v-if="colorMenuPath === project.path" class="row-submenu" role="menu" :aria-label="`${PROJECT_COLOR_MENU_LABEL}：${project.name}`">
                  <button
                    v-for="choice in PROJECT_COLOR_CHOICES" :key="choice.index"
                    type="button" class="menu-button row-menu-item color-item" role="menuitem"
                    @click="pickColor(project, choice.index)"
                  >
                    <span class="color-swatch" aria-hidden="true" :style="{ backgroundImage: `linear-gradient(135deg, ${choiceGradient(choice.index)[0]}, ${choiceGradient(choice.index)[1]})` }" />
                    <span class="color-name">{{ colorLabel(project.path, choice.index) }}</span>
                  </button>
                  <div class="submenu-rule" role="separator" />
                  <button type="button" class="menu-button row-menu-item" role="menuitem" :disabled="colorAutoDisabled(project.path)" @click="resetColor(project)">{{ PROJECT_COLOR_AUTO_LABEL }}</button>
                </div>
                <div class="menu-rule" role="separator" />
                <button type="button" class="menu-button row-menu-item" role="menuitem" :disabled="busy" @click="forgetSingle(project)">
                  <X :size="iconSize.control" aria-hidden="true" />仅从列表移除
                </button>
              </div>
            </li>
              </ul>
            </section>
          </div>
          <div v-else-if="query.trim()" class="project-empty">
            <Search :size="iconSize.hero" aria-hidden="true" />
            <h3>没有匹配的项目</h3>
            <button type="button" class="subtle-button" @click="clearSearch">清空搜索</button>
          </div>
          <div v-else class="project-empty">
            <FolderOpen :size="iconSize.hero" aria-hidden="true" />
            <h3>还没有近期项目</h3>
            <!-- IDEA EmptyStateProjectsPanel starts with a vertical group of quick actions
                 plus a "More" drop-down instead of a single hint line. -->
            <div class="empty-actions" role="group" aria-label="快捷开始">
              <button type="button" class="primary-button empty-action" :disabled="busy" @click="emit('create')"><FolderPlus :size="iconSize.toolbar" aria-hidden="true" />新建项目</button>
              <button type="button" class="subtle-button empty-action" :disabled="busy" @click="emit('open')"><FolderOpen :size="iconSize.toolbar" aria-hidden="true" />打开</button>
              <button type="button" class="subtle-button empty-action" :disabled="busy || !gitAvailable" :title="!gitAvailable ? '安装 Git 后可用' : undefined" @click="emit('clone')"><GitBranch :size="iconSize.toolbar" aria-hidden="true" />从 VCS 获取</button>
              <div class="empty-more">
                <button type="button" class="subtle-button empty-action" :aria-expanded="moreOpen" aria-haspopup="menu" @click="moreOpen = !moreOpen">更多<ChevronDown :size="iconSize.menu" aria-hidden="true" /></button>
                <div v-if="moreOpen" class="empty-more-menu" role="menu">
                  <button type="button" class="menu-button empty-more-item" role="menuitem" :disabled="busy" @click="moreOpen = false; emit('settings')">设置…</button>
                  <button type="button" class="menu-button empty-more-item" role="menuitem" :disabled="busy || !isDesktop" @click="moreOpen = false; emit('plugins')">插件…</button>
                  <button type="button" class="menu-button empty-more-item" role="menuitem" @click="moreOpen = false; emit('help')">帮助</button>
                </div>
              </div>
            </div>
          </div>
          <!-- IDEA's welcome-screen notification toolbar: ProjectsTabFactory.kt:126-131 puts it in
               the last row of the projects tab, aligned right, and builds it from
               WelcomeScreenComponentFactory.createNotificationToolbar (:399-451). The button itself
               is NotificationEventAction.kt:24-81 — enabled and visible only while notifications
               exist (:53-56), its text is IdeBundle toolwindow.stripe.Notifications (:2238), and it
               opens the same notification list the status bar widget shows. -->
          <div v-if="noticeButtonVisible(notices.length)" ref="noticeBox" class="welcome-notifications" tabindex="-1" @keydown.esc.stop="notificationsOpen = false">
            <button
              type="button" class="subtle-button welcome-notice-button" :aria-expanded="notificationsOpen"
              aria-haspopup="dialog" :aria-label="noticeTitle(notices)"
              @click="notificationsOpen = !notificationsOpen"
            ><BellDot :size="iconSize.toolbar" aria-hidden="true" />{{ noticeButtonText(notices.length) }}</button>
            <NoticeList
              v-if="notificationsOpen" :entries="notices" :live="screenReaderLive"
              @clear="emit('clearNotices')" @close="notificationsOpen = false"
            />
          </div>
        </section>
      </div>
    </main>
  </div>
</template>

<style scoped>
.project-welcome { display: grid; grid-template-columns: 204px minmax(0, 1fr); flex: 1; width: 100%; height: 100%; min-width: 0; min-height: 0; overflow: hidden; background: var(--editor); }
.welcome-sidebar { position: relative; z-index: 2; display: flex; flex-direction: column; gap: var(--space-3); min-height: 0; overflow: visible; padding: var(--space-6) var(--space-2) 0; background: var(--header-bg); border-right: 1px solid var(--header-line); color: var(--header-fg); }
/* IDEA createQuickAccessPanel: pinned to the bottom of the sidebar (BorderLayout.SOUTH),
   left-aligned, with the New UI empty(15, 14) inset — not a lone 28px icon floating in the column. */
.welcome-brand { display: flex; align-items: baseline; flex-wrap: wrap; gap: var(--space-2); padding: 0 var(--space-3); }
.welcome-brand .brand { padding-left: 10px; border-left: 3px solid var(--header-accent); color: var(--header-fg); font-size: 19px; font-weight: 700; letter-spacing: -.035em; gap: var(--space-2); }
.welcome-navigation { display: flex; flex-direction: column; gap: var(--space-1); }
.navigation-item { display: flex; align-items: center; gap: var(--space-2); width: 100%; min-height: var(--ctrl-height-lg); padding: var(--space-1) var(--space-3); border-radius: var(--radius-xs); color: var(--header-fg); text-align: left; font-size: 12px; transition: background-color var(--dur-1) var(--ease), color var(--dur-1) var(--ease); }
.navigation-item:hover:not(:disabled) { background: var(--header-hover); color: var(--header-fg); }
.navigation-item.selected { background: var(--header-hover); color: var(--header-fg); font-weight: 650; box-shadow: inset 2px 0 var(--header-accent); }
.navigation-item:focus-visible { outline: var(--focus-ring); outline-offset: var(--focus-ring-offset-inset); }
.navigation-item > svg { flex-shrink: 0; }
.nav-badge { margin-left: auto; min-width: 18px; padding: 0 5px; border-radius: var(--radius-lg); background: var(--header-hover); color: var(--header-accent); font: 600 10px/18px var(--font-ui); text-align: center; }
.welcome-quick-access { position: relative; display: flex; align-items: center; justify-content: flex-start; margin: auto calc(-1 * var(--space-3)) 0; padding: 15px 14px var(--space-5); border-top: 1px solid var(--header-line); }
.welcome-gear { width: 28px; height: 28px; color: var(--header-fg); }
.welcome-options { position: absolute; left: 14px; bottom: calc(100% - 8px); z-index: 30; display: flex; flex-direction: column; min-width: 180px; padding: var(--space-1); border: var(--popup-border); border-radius: var(--popup-radius); background: var(--elevated); color: var(--popup-foreground); box-shadow: var(--popup-shadow); }
.welcome-options-item { display: flex; align-items: center; justify-content: flex-start; width: 100%; text-align: left; }
.welcome-main { min-width: 0; min-height: 0; overflow: auto; }
.welcome-content { width: 100%; max-width: 1240px; margin: 0 auto; padding: clamp(28px, 5vw, 64px); container-type: inline-size; }
.customize-group { display: grid; grid-template-columns: minmax(120px, 180px) minmax(0, 1fr); align-items: start; gap: var(--space-4); margin: 0; padding: var(--space-4) 0; border-bottom: 1px solid var(--line); }
.customize-group h2 { display: flex; align-items: center; gap: var(--space-2); margin: var(--space-2) 0 0; color: var(--bright); font-size: 14px; font-weight: 650; }
.customize-group h2::before { content: ''; width: var(--space-1); height: 1em; flex: 0 0 var(--space-1); border-radius: var(--radius-pill); background: var(--accent); }
.customize-row { display: grid; grid-template-columns: minmax(0, 1fr) 160px; align-items: center; gap: var(--space-4); max-width: 640px; min-height: var(--ctrl-height-lg); color: var(--text); font-size: 12px; }
.customize-row select, .customize-row input { box-sizing: border-box; width: 100%; min-width: 0; min-height: var(--ctrl-height); padding: var(--space-1) var(--space-2); color: var(--text); background: var(--editor); border: 1px solid var(--line-strong); border-radius: var(--radius-xs); font: inherit; }
.theme-options { display: flex; flex-wrap: wrap; gap: var(--space-3); }
.customize-page .theme-option { display: inline-flex; align-items: center; gap: var(--space-2); flex: 0 1 170px; min-width: 130px; min-height: var(--ctrl-height-lg); padding: var(--space-2) var(--space-3); border: 1px solid var(--line-strong); border-radius: var(--radius-xs); background: var(--panel); color: var(--text); line-height: 18px; transition: background-color var(--dur-1) var(--ease), border-color var(--dur-1) var(--ease), color var(--dur-1) var(--ease); }
.customize-page .theme-option:nth-child(2) { background: var(--editor); }
.customize-page .theme-option:hover:not(:disabled) { border-color: var(--accent); background: var(--hover); color: var(--bright); }
.customize-page .theme-option[aria-pressed='true'] { border-color: var(--accent); background: var(--selected); color: var(--bright); box-shadow: inset var(--space-1) 0 0 0 var(--accent); }
.customize-page .theme-option:focus-visible { outline: var(--focus-ring); outline-offset: var(--focus-ring-offset-inset); }
.customize-page .theme-option > svg { flex-shrink: 0; }
.welcome-heading { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: var(--space-4); margin-bottom: 22px; padding-bottom: 18px; border-bottom: 2px solid var(--line-strong); }
.welcome-heading h1 { display: flex; align-items: center; gap: var(--space-3); margin: 0; font: 700 34px/1.05 var(--font-brand); letter-spacing: -.055em; color: var(--bright); }
.welcome-heading h1::before { content: ''; width: 4px; height: 1.08em; flex: 0 0 4px; background: var(--accent); }
.project-actions { display: flex; align-items: center; justify-content: flex-end; flex-wrap: wrap; gap: var(--space-2); }
.project-actions .primary-button { margin-top: 0; }
.action-button { display: inline-flex; align-items: center; justify-content: center; gap: var(--space-2); min-height: var(--ctrl-height-lg); white-space: nowrap; }
.action-button > svg { flex-shrink: 0; }
.welcome-error { border: 1px solid var(--error); border-radius: var(--radius-xs); margin-bottom: var(--space-3); }
.recent-section { min-width: 0; padding: 0 0 var(--space-2); }
.recent-heading { display: flex; align-items: center; justify-content: space-between; gap: var(--space-3); margin: 0 0 var(--space-3); padding: 0 0 var(--space-3); border-bottom: 1px solid var(--line-strong); }
.recent-heading h2 { margin: 0; color: var(--bright); font: 650 14px/1.3 var(--font-brand); letter-spacing: -.015em; }
.project-search { display: flex; align-items: center; gap: var(--space-2); min-width: 0; margin: 0; padding: var(--space-1) var(--space-2) var(--space-1) var(--space-3); min-height: var(--ctrl-height-lg); background: var(--elevated); border: 1px solid var(--line-strong); border-radius: var(--radius-xs); color: var(--muted); }
.project-search:focus-within { border-color: var(--accent); outline: var(--focus-ring); outline-offset: var(--focus-ring-offset-inset); }
.project-search > svg { flex-shrink: 0; }
.project-search input { flex: 1; width: 100%; min-width: 0; padding: var(--space-1); border: 0; background: var(--editor); color: var(--text); }
.project-search input::placeholder { color: var(--muted); }
.project-search input::-webkit-search-cancel-button { display: none; }
.list-status { margin: var(--space-2) 0 var(--space-1); color: var(--muted); font: 11px var(--font-ui); font-variant-numeric: tabular-nums; }
/* IDEA keeps the welcome notification toolbar in the last row of the projects tab, aligned right
   (ProjectsTabFactory.kt:126-131 -> `align(AlignX.RIGHT)`); the popup reuses the status bar's list. */
.welcome-notifications { position: relative; display: flex; justify-content: flex-end; margin-top: var(--space-3); }
.welcome-notice-button { display: inline-flex; align-items: center; gap: var(--space-2); font-size: 12px; }
.recent-list { margin: var(--space-2) 0 0; padding: 0; }
.recent-group { margin-bottom: var(--space-3); }
.recent-group-head { display: flex; align-items: center; gap: var(--space-1); padding-bottom: var(--space-1); border-bottom: 1px solid var(--line); color: var(--secondary); font-size: 11px; }
.recent-group-toggle { display: flex; flex: 1; align-items: center; gap: var(--space-2); min-width: 0; min-height: var(--ctrl-height); padding: var(--space-1) var(--space-2); border: 0; border-radius: var(--radius-xs); background: transparent; color: inherit; font-size: 11px; cursor: pointer; transition: background-color var(--dur-1) var(--ease), color var(--dur-1) var(--ease); }
.recent-group-toggle:hover { background: var(--hover); color: var(--bright); }
.recent-group-toggle:focus-visible { outline: var(--focus-ring); outline-offset: var(--focus-ring-offset); }
.recent-group-head svg { transition: transform var(--dur-1) var(--ease); }
.recent-group-head svg.collapsed { transform: rotate(-90deg); }
.recent-group-name { color: var(--bright); font-weight: 650; }
.recent-group-count { margin-left: auto; padding: 0 var(--space-1); border-radius: var(--radius-xs); background: var(--accent-soft); color: var(--accent); font-variant-numeric: tabular-nums; }
.group-edit { display: inline-flex; align-items: center; gap: var(--space-1); padding: 2px var(--space-2); border: 0; border-radius: var(--radius-xs); background: transparent; color: var(--muted); font-size: 11px; }
.group-edit:hover { background: var(--hover); color: var(--secondary); }
.group-edit svg { flex-shrink: 0; }
.recent-group-list { list-style: none; margin: 0; padding: var(--space-1) 0 0; }
.recent-row { position: relative; display: flex; align-items: center; gap: var(--space-2); min-width: 0; padding: 0 var(--space-1); }
.recent-row + .recent-row { border-top: 1px solid var(--line); }
.recent-row.is-selected { background: var(--accent-soft); box-shadow: inset 2px 0 var(--accent); }
.recent-row:focus-visible { outline: var(--focus-ring); outline-offset: var(--focus-ring-offset-inset); }
.recent-row.menu-open .recent-open { background: var(--hover); }
/* RecentProjectFilteringTree renders name above path in one cell next to the icon; the old fixed
   2.2rem date column let the date paint over the row gear. */
.recent-open { display: grid; grid-template-columns: 32px minmax(0, 1fr); gap: var(--space-2) var(--space-4); align-items: center; flex: 1; min-width: 0; min-height: 68px; padding: var(--space-2) var(--space-3); border: 0; border-radius: var(--radius-xs); background: transparent; text-align: left; }
.recent-open:hover:not(:disabled) { background: var(--hover); }
.recent-open:disabled { opacity: 1; color: var(--muted); }
.recent-open:focus-visible { outline: var(--focus-ring); outline-offset: var(--focus-ring-offset-inset); }
.project-avatar { display: inline-flex; align-items: center; justify-content: center; width: 32px; height: 32px; flex-shrink: 0; align-self: center; border-radius: var(--radius-xs); font-size: 12px; background-color: var(--selected); background-image: linear-gradient(135deg, var(--selected), var(--selected)); color: var(--on-accent); font: 700 11px var(--font-brand); letter-spacing: .04em; }
/* RecentProjectIconHelper generates gradient avatars (ProjectIconPalette) for
   reachable paths and a desaturated version when the path is gone. The CSS
   gradient lives inline so the JS palette stays the single source of truth. */
.project-details { display: flex; flex-direction: column; gap: 2px; min-width: 0; }
.project-title { display: flex; align-items: baseline; gap: var(--space-2); min-width: 0; white-space: nowrap; }
.project-title strong { min-width: 0; color: var(--bright); font-size: 13px; font-weight: 600; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.project-path { overflow: hidden; white-space: nowrap; text-overflow: ellipsis; color: var(--secondary); font: 11px/1.6 var(--font-mono); font-variant-numeric: tabular-nums; }
.project-date { overflow: hidden; text-overflow: ellipsis; color: var(--muted); font: 11px var(--font-mono); font-variant-numeric: tabular-nums; white-space: nowrap; }
.project-branch { display: inline-flex; align-items: center; gap: 3px; color: var(--secondary); font: 11px var(--font-mono); white-space: nowrap; }
.recent-row-actions { display: flex; flex-direction: column; align-items: flex-end; gap: var(--space-1); flex-shrink: 0; }
/* IDEA shows the row's ⋮ only while the pointer (or keyboard focus) is on the row. */
.row-menu-button { opacity: 0; transition: opacity var(--dur-1) var(--ease); }
.recent-row:hover .row-menu-button, .recent-row:focus-within .row-menu-button, .recent-row.menu-open .row-menu-button { opacity: 1; }
.row-menu { position: absolute; top: 100%; right: var(--space-2); z-index: 30; display: flex; flex-direction: column; min-width: 160px; padding: var(--space-1); border: var(--popup-border); border-radius: var(--popup-radius); background: var(--elevated); color: var(--popup-foreground); box-shadow: var(--popup-shadow); }
/* `display: flex` 是补的：这是 `<button>`，UA 默认 inline-block，`justify-content` / `gap`
   在上面全是空操作（与 `.tool-menu-item` style.css:318、`.status-widget-item`:734 同款）。
   由 ui-icons 门禁的"写了 gap 必须是 flex"那条一并盯住。 */
.row-menu-item { display: flex; align-items: center; justify-content: flex-start; gap: var(--space-2); }
/* 项目颜色的二级菜单（ChangeProjectColorActionGroup.kt:33-44 的九个具名颜色）。
   它画在行菜单**内部**（上游那两个动作挂在项目窗口标题栏上，本仓没有那一层）。 */
.row-menu-submenu-toggle svg:last-child { margin-left: auto; flex-shrink: 0; }
.row-submenu { display: flex; flex-direction: column; min-width: 168px; padding: 2px 0; }
/* 子菜单自己的分隔线：与 style.css:160 的 `.menu-rule` 同一套样式，只换类名 ——
   行菜单本身那两条（上游 :1021 / :1029）由 tests/welcome-row-menu-order.test.mjs
   按 `.menu-rule` 计数，两层菜单不能混进同一个计数里。 */
.submenu-rule { height: 1px; margin: var(--space-1) var(--space-2); background: var(--line); }
.color-swatch { width: 16px; height: 16px; flex-shrink: 0; border: 1px solid var(--line-strong); border-radius: var(--radius-xs); }
.color-name { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.menu-backdrop { position: fixed; inset: 0; z-index: 20; }
.missing-tag { padding: 2px var(--space-1); border-radius: var(--radius-xs); color: var(--warning); background: var(--warning-bg); font-size: 10px; }
/* Source: IconUtil.desaturate in RecentProjectIconHelper when isProjectValid=false.
   CSS filter keeps the gradient visible while signalling the missing path. */
.recent-row .recent-open:disabled .project-avatar { filter: grayscale(0.85) opacity(0.65); }
.project-empty { display: grid; justify-items: center; align-content: center; min-height: 280px; padding: var(--space-6) var(--space-3); text-align: center; color: var(--muted); }
.empty-actions { display: flex; flex-direction: column; align-items: stretch; width: min(200px, 100%); gap: var(--space-2); margin-top: var(--space-3); }
.empty-action { display: inline-flex; align-items: center; gap: var(--space-2); width: 100%; min-height: var(--ctrl-height-lg); justify-content: flex-start; }
.empty-more { position: relative; display: flex; flex-direction: column; align-items: stretch; }
.empty-more-menu { position: absolute; top: 100%; left: 50%; transform: translateX(-50%); z-index: 30; display: flex; flex-direction: column; min-width: 150px; margin-top: var(--space-1); padding: var(--space-1); border: var(--popup-border); border-radius: var(--popup-radius); background: var(--elevated); color: var(--popup-foreground); box-shadow: var(--popup-shadow); }
.empty-more-item { display: flex; align-items: center; justify-content: flex-start; width: 100%; }
.project-empty h3 { margin: var(--space-3) 0 0; font-size: 16px; color: var(--text); font-weight: 600; }
@media (max-width: 760px) {
  .project-welcome { grid-template-columns: 155px minmax(0, 1fr); }
  .welcome-sidebar { padding: var(--space-5) var(--space-2) var(--space-4); }
  .welcome-brand { gap: var(--space-1); padding: 0 var(--space-2); }
  .welcome-brand .brand { font-size: 17px; }
  .welcome-content { padding: var(--space-5) var(--space-4); }
  .customize-group { grid-template-columns: minmax(100px, 140px) minmax(0, 1fr); }
  .welcome-heading { align-items: flex-start; }
  .recent-row { flex-wrap: wrap; }
  .recent-open { flex-basis: 100%; grid-template-columns: 24px minmax(0, 1fr); align-items: center; }
  .project-details { display: flex; flex-direction: column; gap: 2px; }
  .project-avatar { grid-row: auto; }
  .project-date { font-family: var(--font-ui); }
  .recent-row-actions { flex-direction: row; flex-wrap: wrap; align-items: center; justify-content: flex-end; width: 100%; }
}
@media (max-width: 480px) {
  .project-welcome { grid-template-columns: 105px minmax(0, 1fr); }
  .welcome-sidebar { gap: var(--space-5); padding: var(--space-5) var(--space-1) var(--space-3); }
  .welcome-brand { padding: 0 var(--space-1); }
  .welcome-brand .brand { gap: var(--space-1); font-size: 13px; }
  .navigation-item { padding: var(--space-2); gap: var(--space-2); }
  .welcome-content { padding: var(--space-5) var(--space-3); }
  .welcome-heading { margin-bottom: var(--space-4); gap: var(--space-3); }
  .welcome-heading h1 { font-size: 24px; }
  .project-actions { flex-direction: column; align-items: stretch; width: 100%; }
  .project-actions .primary-button { justify-content: center; }
  .recent-open { gap: var(--space-2); padding-inline: 0; }
  .project-avatar { width: 32px; height: 32px; font-size: 16px; }
  .customize-group { grid-template-columns: minmax(0, 1fr); gap: var(--space-2); }
  .customize-group h2 { margin-top: 0; }
  .customize-row { grid-template-columns: minmax(0, 1fr); gap: var(--space-1); }
}
@container (max-width: 42rem) {
  .customize-group { grid-template-columns: minmax(0, 1fr); gap: var(--space-2); }
  .customize-group h2 { margin-top: 0; }
}
</style>
