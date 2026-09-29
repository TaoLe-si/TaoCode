<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, useId, watch } from 'vue'
import { BellDot, ChevronDown, CircleHelp, Copy, FolderOpen, FolderPlus, FolderSearch, GitBranch, Moon, Palette, Plug, RefreshCw, Search, Settings, Sun, X } from 'lucide-vue-next'
import { lastOpenedPath, matchesSearch, systemDependentPath } from '../welcomeProjects'
import { noticeButtonText, noticeButtonVisible, noticeTitle, type NoticeEntry } from '../notices'
import { copyToClipboard } from '../clipboard'
import { clampEditorFontSize, MAX_EDITOR_FONT_SIZE, MIN_EDITOR_FONT_SIZE } from '../editorFontSize'
import { request, type EditorSettings, type RecentProject } from '../bridge'
import type { Theme } from '../appearance'
import NoticeList from './NoticeList.vue'

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
const dateFormat = new Intl.DateTimeFormat('zh-CN', {
  year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false,
})
function openedDate(value: string) {
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? '时间未知' : dateFormat.format(date)
}
// Source: RecentProjectIconHelper.kt:289-326 (ProjectIconPalette.gradients).
// Nine gradient pairs ordered from warm red through cool purple. Indexing into
// them via abs(path.hashCode()) % 9 mirrors ProjectIconPalette.gradient(path) and
// getGeneratedNonLocalProjectIcon's `abs(id.hashCode() % 9)`. The RecentProjects
// welcome list is the only TaoCode surface that needs a project icon today, so
// the palette lives here next to the renderer.
const RECENT_PROJECT_GRADIENTS: ReadonlyArray<readonly [string, string]> = [
  ['#DB3D3C', '#FF8E42'], // Color1.Avatar
  ['#F57236', '#FCBA3F'], // Color2
  ['#2BC8BB', '#36EBAE'], // Color3
  ['#359AF2', '#57DBFF'], // Color4
  ['#8379FB', '#85A8FF'], // Color5
  ['#7E54B5', '#9486FF'], // Color6
  ['#D63CC8', '#F582B9'], // Color7
  ['#954294', '#C87DFF'], // Color8
  ['#E75371', '#FF78B5'], // Color9
]
function avatarTone(path: string): number {
  let hash = 0
  for (let i = 0; i < path.length; i += 1) hash = (hash * 31 + path.charCodeAt(i)) | 0
  return Math.abs(hash) % RECENT_PROJECT_GRADIENTS.length
}
function avatarGradient(path: string): readonly [string, string] {
  return RECENT_PROJECT_GRADIENTS[avatarTone(path)]!
}
// Source: RecentProjectIconHelper.iconTextForCommaSeparatedName and
// AvatarUtils.initials. The IDE takes the first letter of each of the first
// two comma-separated segments and uppercases them ("First, Second" → "FS").
// Single-segment names fall back to the first non-whitespace character.
function avatarInitials(name: string): string {
  const segments = name.split(',').slice(0, 2)
  const letters: string[] = []
  for (const segment of segments) {
    for (const ch of segment) {
      if (!/\s/.test(ch)) { letters.push(ch); break }
    }
  }
  return (letters.join('') || name.trim()[0] || '项').toLocaleUpperCase()
}
// IDEA's RecentProjectPanel shows each project's git branch under the path; the
// branch was recorded by the IDE the last time the project was open (see the
// gitHead watch in App.vue), so it costs nothing on the welcome page.
// RemoveSelectedProjectsAction.kt mirrors the IDE's recent-project delete UX: the
// action always confirms before it drops a record; the path itself is never touched.
// The IDE bundle ships two dialog strings — `dialog.title.remove.recent.project`
// (singular) and `dialog.title.remove.recent.project.plural` — and two messages,
// one of which names the project, while the plural form says "selected projects".
// We mirror the same branching so the wording matches across one and many items.
function confirmForget(projects: RecentProject[]) {
  if (projects.length === 0) return
  const title = projects.length === 1
    ? `从最近项目列表移除「${projects[0]!.name}」？`
    : '从最近项目列表移除所选项目？'
  const body = projects.length === 1
    ? `磁盘上的文件不会被删除。`
    : `共 ${projects.length} 项，磁盘上的文件不会被删除。`
  if (!window.confirm(`${title}\n${body}`)) return
  menuPath.value = ''
  // Emit one batch signal so the native side can mirror RecentProjectsManagerBase.removePath
  // on every entry in a single state-mutation pass.
  emit('forget-batch', projects.map(project => project.path))
}
// RecentProjectsManagerBase.kt:270-279 calls removePath per path and fires a single
// change event at the end, so the page batches here.
function forgetSingle(project: RecentProject) { confirmForget([project]) }
// ReopenProjectAction.showReopenDialog (ReopenProjectAction.kt:84-94): when the path
// disappeared, the IDE offers two buttons — OK (closes the dialog, project stays on
// the list) and "Remove from list" (calls removePath). We mirror the same choice.
function showReopenDialog(project: RecentProject) {
  const choice = window.prompt(
    `路径「${project.path}」不存在或不可访问。\n` +
    '点击「确定」继续，点击「取消」从最近项目列表移除（磁盘文件不会被删除）。',
    '继续'
  )
  if (choice === null) confirmForget([project])
}
function onRowKeydown(project: RecentProject, event: KeyboardEvent) {
  if (event.key !== 'Delete' && event.key !== 'Backspace') return
  event.preventDefault()
  if (selectedPaths.value.has(project.path)) confirmForget(selectedProjects.value)
  else confirmForget([project])
}
function branchOf(path: string): string {
  if (!props.isDesktop) return ''
  try { return localStorage.getItem(`taocode.branch:${path}`) ?? '' } catch { return '' }
}
function clearSearch() {
  query.value = ''
  searchInput.value?.focus()
}
// IDEA's project list: the ⋮ at the row end opens the row menu (open / remove from
// the list); the row itself is highlighted while its menu is open.
const menuPath = ref('')
// Source: ProjectGroup.java (platform/ide-core/.../ProjectGroup.java).
// Properties are name, projects (List<path>), expanded (myExpanded), tutorials
// (myTutorials), bottomGroup (myBottomGroup), plus a modCounter for change tracking.
// ProjectGroupActionGroup.update() reads myGroup.isExpanded() and toggles the
// popup/inline rendering; TaoCode renders the group header collapsed vs expanded
// with the same semantic (when collapsed the header is a "popup group" that
// expands on click). The bottomGroup flag moves the group to the bottom of the
// list; tutorials is informational only at the data layer for now.
interface ProjectGroup { name: string; paths: string[]; expanded: boolean; tutorials: boolean; bottomGroup: boolean }
const groups = ref<ProjectGroup[]>([])
const groupCollapsed = ref<Set<string>>(new Set())
const UNGROUPED = '未分组'
try {
  const saved = JSON.parse(localStorage.getItem('taocode.projectGroups') ?? 'null') as { groups?: Array<Partial<ProjectGroup>>; collapsed?: string[] } | null
  if (saved && Array.isArray(saved.groups)) {
    groups.value = saved.groups
      .filter(group => group && typeof group.name === 'string' && Array.isArray(group.paths))
      .map(group => ({
        name: group.name as string,
        paths: (group.paths as unknown[]).filter((path): path is string => typeof path === 'string'),
        // Source: ProjectGroup.isExpanded() defaults to false (myExpanded = false).
        // Older TaoCode builds used a collapsed-set as the source of truth, so
        // when the persisted record lacks the boolean we fall back to that set
        // to keep the user's view stable across the upgrade.
        expanded: typeof group.expanded === 'boolean' ? group.expanded : !groupCollapsed.value.has(group.name as string),
        tutorials: group.tutorials === true,
        bottomGroup: group.bottomGroup === true,
      }))
  }
  if (saved && Array.isArray(saved.collapsed)) groupCollapsed.value = new Set(saved.collapsed.filter((name): name is string => typeof name === 'string'))
} catch { /* corrupted state falls back to a single ungrouped list */ }
function saveGroups() {
  try { localStorage.setItem('taocode.projectGroups', JSON.stringify({ groups: groups.value, collapsed: [...groupCollapsed.value] })) } catch { /* session-only */ }
}
function groupOf(path: string): string {
  return groups.value.find(group => group.paths.includes(path))?.name ?? UNGROUPED
}
// Source: RecentProjectListActionProvider.addGroups (RecentProjectListActionProvider.kt:333-355)
// iterates groups twice — once with `bottom = false` (top groups, rendered in
// ProjectGroupComparator order) and once with `bottom = true` (the bottomGroup
// buckets, rendered after the un-grouped recent projects). We mirror that two-pass
// layout: top groups in ProjectGroupComparator order, then the un-grouped bucket,
// then any bottom groups. The bottomGroup flag is set by ProjectGroup.setBottomGroup
// and survives the localStorage round-trip just like the other ProjectGroup fields.
// ProjectGroupComparator (RecentProjectListActionProvider.kt:388-407): orders two
// groups by the lowest recent-path index they each contain; ties break on a
// natural (locale-aware) comparison of their names.
function projectGroupComparator(a: ProjectGroup, b: ProjectGroup): number {
  const recent = filteredProjects.value
  const pathIndex = new Map(recent.map((project, index) => [project.path, index]))
  let indexA = Number.MAX_SAFE_INTEGER
  for (const path of a.paths) {
    const idx = pathIndex.get(path)
    if (idx !== undefined && idx < indexA) indexA = idx
  }
  let indexB = Number.MAX_SAFE_INTEGER
  for (const path of b.paths) {
    const idx = pathIndex.get(path)
    if (idx !== undefined && idx < indexB) indexB = idx
  }
  if (indexA === indexB) return a.name.localeCompare(b.name, undefined, { sensitivity: 'base', numeric: true })
  return indexA - indexB
}
const groupedProjects = computed(() => {
  const topGroups = [...groups.value.filter(group => !group.bottomGroup)].sort(projectGroupComparator)
  const bottomGroups = [...groups.value.filter(group => group.bottomGroup)].sort(projectGroupComparator)
  const buckets: { name: string; projects: RecentProject[] }[] = []
  for (const group of topGroups) {
    buckets.push({ name: group.name, projects: filteredProjects.value.filter(project => group.paths.includes(project.path)) })
  }
  buckets.push({ name: UNGROUPED, projects: filteredProjects.value.filter(project => groupOf(project.path) === UNGROUPED) })
  for (const group of bottomGroups) {
    buckets.push({ name: group.name, projects: filteredProjects.value.filter(project => group.paths.includes(project.path)) })
  }
  return buckets.filter(bucket => bucket.name === UNGROUPED ? bucket.projects.length > 0 : true)
})
const groupingActive = computed(() => groups.value.length > 0)
function moveToGroup(project: RecentProject, name: string) {
  menuPath.value = ''
  for (const group of groups.value) group.paths = group.paths.filter(path => path !== project.path)
  if (name !== UNGROUPED) {
    const target = groups.value.find(group => group.name === name)
    if (target) target.paths = [...target.paths, project.path]
  }
  saveGroups()
}
function createGroupWith(project: RecentProject) {
  menuPath.value = ''
  const name = window.prompt('新分组名称（用于把最近项目归类）', '')?.trim()
  if (!name) return
  if (name === UNGROUPED || groups.value.some(group => group.name === name)) { moveToGroup(project, name); return }
  // Source: ProjectGroup(name) constructor sets myName; myExpanded defaults to
  // false; the group's bottomGroup flag stays off so it renders above the
  // un-grouped bucket.
  groups.value = [...groups.value, { name, paths: [project.path], expanded: true, tutorials: false, bottomGroup: false }]
  saveGroups()
}
// Source: ProjectGroupActionGroup.update() reads myGroup.isExpanded() to set
// popupGroup, and ProjectGroup.setExpanded() flips it. We track both forms so
// the JSON we serialise matches the boolean field on ProjectGroup and the older
// collapsed-set semantics keep working for any caller that still reads them.
function toggleGroupCollapsed(name: string) {
  const next = new Set(groupCollapsed.value)
  if (next.has(name)) next.delete(name)
  else next.add(name)
  groupCollapsed.value = next
  for (const group of groups.value) {
    if (group.name === name) group.expanded = !groupCollapsed.value.has(name)
  }
  saveGroups()
}
// IDEA's list binds Left/Right to collapse/expand the group under the cursor.
function onGroupKeydown(name: string, event: KeyboardEvent) {
  if (event.key === 'ArrowLeft') { if (!groupCollapsed.value.has(name)) toggleGroupCollapsed(name) }
  else if (event.key === 'ArrowRight') { if (groupCollapsed.value.has(name)) toggleGroupCollapsed(name) }
}
function toggleMenu(path: string) {
  menuPath.value = menuPath.value === path ? '' : path
}

// RecentProjectFilteringTree.kt:189-191 binds ENTER to "activate the selected item" and
// ALT+DELETE to "remove it"; the tree selection is what those keys act on, so the page keeps track
// of the focused row and falls back to the first visible project.
const focusedPath = ref('')
// IDEA's recent-project list is multi-selectable: RecentProjectFilteringTree wires
// SHIFT and CTRL mouse presses into the tree's selection model, and
// RemoveSelectedProjectsAction removes *the selection*, not just the focused row.
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
  if (!event.shiftKey && !event.ctrlKey && !event.metaKey) {
    if (selectedPaths.value.size > 0) clearSelection()
    lastClickedPath.value = project.path
    return
  }
  const list = filteredProjects.value.map(item => item.path)
  if (event.shiftKey && lastClickedPath.value && list.includes(lastClickedPath.value)) {
    const lastIndex = list.indexOf(lastClickedPath.value)
    const currentIndex = list.indexOf(project.path)
    if (lastIndex !== -1 && currentIndex !== -1) {
      const [start, end] = lastIndex < currentIndex ? [lastIndex, currentIndex] : [currentIndex, lastIndex]
      const next = new Set(selectedPaths.value)
      for (let i = start; i <= end; i += 1) next.add(list[i]!)
      selectedPaths.value = next
      return
    }
  }
  // CTRL/CMD toggles a single row.
  const next = new Set(selectedPaths.value)
  if (next.has(project.path)) next.delete(project.path)
  else next.add(project.path)
  selectedPaths.value = next
  lastClickedPath.value = project.path
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
  copyNote.value = `已复制：${text}`
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
    copyNote.value = `已在资源管理器中显示：${project.path}`
  } catch (error) {
    copyNote.value = error instanceof Error ? error.message : String(error)
  }
  if (copyTimer !== undefined) clearTimeout(copyTimer)
  copyTimer = window.setTimeout(() => { copyNote.value = '' }, 4000)
}
function onSearchKeydown(event: KeyboardEvent) {
  const project = activeProject.value
  if (!project) return
  if (event.key === 'Enter') {
    event.preventDefault()
    if (project.available && !props.busy) openProject(project)
    return
  }
  if (event.key === 'Delete' && event.altKey) {
    event.preventDefault()
    confirmForget([project])
  }
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
        <span class="welcome-version">0.1</span>
      </div>
      <p class="sidebar-note">{{ isDesktop ? '本地项目' : '浏览器 · 内存预览' }}</p>
      <nav class="welcome-navigation" aria-label="欢迎页导航">
        <button type="button" class="menu-button navigation-item" :class="{ selected: page === 'projects' }" :aria-current="page === 'projects' ? 'page' : undefined" @click="page = 'projects'">
          <FolderOpen :size="17" aria-hidden="true" />项目
        </button>
        <button type="button" class="menu-button navigation-item" :class="{ selected: page === 'customize' }" :aria-current="page === 'customize' ? 'page' : undefined" @click="page = 'customize'">
          <Palette :size="17" aria-hidden="true" />自定义
        </button>
        <button
          type="button" class="menu-button navigation-item" :disabled="busy || !isDesktop"
          :title="isDesktop ? '管理本机插件' : '浏览器预览不能读取本机插件目录'" @click="emit('plugins')"
        >
          <Plug :size="17" aria-hidden="true" />插件
          <span v-if="pluginCount" class="nav-badge" :title="`${pluginCount} 个已安装插件`">{{ pluginCount }}</span>
        </button>
        <button type="button" class="menu-button navigation-item" :disabled="busy" @click="emit('help')">
          <CircleHelp :size="17" aria-hidden="true" />关于
        </button>
      </nav>
      <!-- IDEA TabbedWelcomeScreen.createQuickAccessPanel: BorderLayout.SOUTH of the left
           sidebar, FlowLayout.LEFT, 26×26 buttons, New UI border empty(15, 14).
           WelcomeScreenDefaultCustomization wires the Settings icon to a popup of
           WelcomeScreen.Options, not to the Settings dialog itself. -->
      <div class="welcome-quick-access">
        <button
          type="button" class="icon-button welcome-gear" title="选项" aria-label="选项"
          aria-haspopup="menu" :aria-expanded="optionsOpen" :disabled="busy"
          @click.stop="optionsOpen = !optionsOpen"
        >
          <Settings :size="16" aria-hidden="true" />
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
            <button type="button" class="subtle-button theme-option" :aria-pressed="theme === 'light'" @click="emit('theme', 'light', $event)"><Sun :size="17" aria-hidden="true" /><span>月之亮面</span></button>
            <button type="button" class="subtle-button theme-option" :aria-pressed="theme === 'dark'" @click="emit('theme', 'dark', $event)"><Moon :size="17" aria-hidden="true" /><span>月之暗面</span></button>
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
              <FolderPlus :size="16" aria-hidden="true" />新建项目
            </button>
            <button type="button" class="subtle-button action-button" :disabled="busy" @click="emit('open')">
              <FolderOpen :size="16" aria-hidden="true" />{{ isDesktop ? '打开项目' : '打开内存示例' }}
            </button>
            <button
              type="button" class="subtle-button action-button" :disabled="busy"
              :aria-describedby="!gitAvailable ? `${id}-git-note` : undefined" @click="emit('clone')"
            >
              <GitBranch :size="16" aria-hidden="true" />克隆仓库
            </button>
            <button
              v-if="selectedPaths.size > 1" type="button" class="subtle-button action-button"
              :disabled="busy" :title="`仅移除选中的 ${selectedPaths.size} 项记录`"
              @click="confirmForget(selectedProjects)"
            >
              <X :size="16" aria-hidden="true" />移除所选 {{ selectedPaths.size }} 项
            </button>
          </div>
        </header>

        <p v-if="!isDesktop" class="preview-banner welcome-preview">
          <span class="preview-dot" aria-hidden="true" />
          <span><strong>浏览器预览</strong>：此界面与示例文件仅在内存中运行，不访问磁盘，不能真实新建或克隆项目。新建和克隆表单仅供布局预览。</span>
        </p>
        <p v-if="!gitAvailable" :id="`${id}-git-note`" class="git-note">安装 Git 后才能克隆仓库；可以打开克隆表单查看说明。</p>
        <div v-if="error" class="notice error welcome-error" role="alert"><span>{{ error }}</span></div>

        <section class="recent-section" :aria-labelledby="`${id}-recent-title`" :aria-busy="busy">
          <div class="recent-heading">
            <h2 :id="`${id}-recent-title`">{{ isDesktop ? '近期项目' : '当前会话项目（内存）' }}</h2>
            <button type="button" class="icon-button" :disabled="busy" title="刷新项目列表" aria-label="刷新项目列表" @click="emit('refresh')">
              <RefreshCw :size="15" aria-hidden="true" />
            </button>
          </div>
          <div class="project-search">
            <Search :size="16" aria-hidden="true" />
            <input :id="`${id}-search`" ref="searchInput" v-model="query" type="search" aria-label="按项目名称、路径或分组搜索" placeholder="搜索项目名称、路径或分组" autocomplete="off" spellcheck="false" @keydown="onSearchKeydown" />
            <button v-if="query" type="button" class="icon-button" title="清空搜索" aria-label="清空搜索" @click="clearSearch"><X :size="15" aria-hidden="true" /></button>
          </div>
          <p class="list-status" role="status">{{ copyNote || (busy ? '正在处理项目操作…' : query.trim() ? `找到 ${filteredProjects.length} 个项目` : `${projects.length} 个项目`) }}</p>

          <p v-if="filteredProjects.length && !filteredProjects.some(project => project.available)" class="list-hint" role="status">列出的路径都不存在或不可访问：用记录右侧的「仅从列表移除」删掉记录（不会动磁盘文件），或打开其他位置的项目。</p>
          <div v-if="menuPath" class="menu-backdrop" @click="menuPath = ''" />
          <!-- 列表为空时的空状态：v-else-if / v-else 必须紧跟在 recent-list 的 v-if 之后，
               中间不能插入其它元素（否则链被打断，空状态会与列表同时渲染）。 -->
          <div v-if="filteredProjects.length" class="recent-list">
            <section v-for="group in groupedProjects" :key="group.name" class="recent-group">
              <header v-if="groupingActive" class="recent-group-head" tabindex="0" role="button" :aria-expanded="!groupCollapsed.has(group.name)" :aria-label="`${group.name}，${group.projects.length} 个项目，左右方向键折叠展开`" @keydown="onGroupKeydown(group.name, $event)" @click="toggleGroupCollapsed(group.name)">
                <ChevronDown :size="13" :class="{ collapsed: groupCollapsed.has(group.name) }" aria-hidden="true" />
                <span class="recent-group-name">{{ group.name }}</span>
                <span class="recent-group-count">{{ group.projects.length }}</span>
              </header>
              <ul v-show="!groupCollapsed.has(group.name)" class="recent-group-list">
            <li v-for="project in group.projects" :key="project.path" :ref="element => setRow(project.path, element)" class="recent-row" tabindex="0" :aria-label="`${project.name}，Delete 键可从列表移除${selectedPaths.has(project.path) ? '（已选中）' : ''}`" :aria-selected="selectedPaths.has(project.path)" @focus="focusedPath = project.path" @click="onRowClick(project, $event)" @keydown="onRowKeydown(project, $event)" :class="{ 'menu-open': menuPath === project.path, 'is-selected': selectedPaths.has(project.path) }">
              <button
                type="button" class="recent-open" :disabled="busy"
                :title="project.available ? `打开 ${project.path}` : `路径不存在或不可访问：${project.path}`"
                @click="tryOpen(project)"
              >
                <span class="project-avatar" :class="`avatar-${avatarTone(project.path)}`" :style="{ backgroundImage: `linear-gradient(135deg, ${avatarGradient(project.path)[0]}, ${avatarGradient(project.path)[1]})` }" :title="`${project.name} 图标（${avatarTone(project.path) + 1}/9）`" aria-hidden="true">{{ avatarInitials(project.displayName || project.projectName || project.name) }}</span>
                <span class="project-details">
                  <span class="project-title"><strong>{{ project.name }}</strong><span v-if="!isDesktop" class="memory-tag">内存示例</span></span>
                  <span class="project-path" :title="project.path">{{ project.path }}</span>
                  <span v-if="branchOf(project.path)" class="project-branch"><GitBranch :size="11" aria-hidden="true" />{{ branchOf(project.path) }}</span>
                  <span class="project-date">最近打开：<time>{{ openedDate(project.lastOpened) }}</time></span>
                </span>
              </button>
              <div class="recent-row-actions">
                <span v-if="!project.available" class="missing-tag">{{ isDesktop ? '路径缺失或不可访问' : '示例不可用' }}</span>
                <!-- RecentProjectFilteringTree.kt:536-545: the row button is a gear while the project is
                     reachable and a remove icon once its path is gone. -->
                <button
                  type="button" class="icon-button row-menu-button" :disabled="busy"
                  :aria-label="`打开 ${project.name} 的操作菜单`" :aria-expanded="menuPath === project.path" :title="project.available ? '更多操作' : '更多操作（路径不可用，可仅从列表移除）'"
                  @click.stop="toggleMenu(project.path)"
                ><Settings v-if="project.available" :size="14" aria-hidden="true" /><X v-else :size="15" aria-hidden="true" /></button>
              </div>
              <div v-if="menuPath === project.path" class="row-menu" role="menu" :aria-label="`${project.name} 的操作`">
                <button type="button" class="menu-button row-menu-item" role="menuitem" :disabled="busy || !project.available" @click="openProject(project)">
                  <FolderOpen :size="14" aria-hidden="true" />打开项目
                </button>
                <button type="button" class="menu-button row-menu-item" role="menuitem" title="把项目路径复制到剪贴板" @click="copyProjectPath(project)">
                  <Copy :size="14" aria-hidden="true" />复制路径
                </button>
                <!-- RevealFileAction.getActionName() = `action.RevealIn.name.other` ("Show in {0}")
                     with the file manager name (`IdeBundle.properties:3209` `action.explorer.text`
                     = "Explorer"); `isDirectoryOpenSupported()` (`RevealFileAction.java:108-110`)
                     is what the desktop check stands for. -->
                <button
                  type="button" class="menu-button row-menu-item" role="menuitem" :disabled="!isDesktop" :title="isDesktop ? '在资源管理器中打开项目所在目录并选中它' : '浏览器预览无法打开资源管理器'"
                  @click="revealProjectDir(project)"
                >
                  <FolderSearch :size="14" aria-hidden="true" />在资源管理器中显示
                </button>
                <button v-if="groupingActive" type="button" class="menu-button row-menu-item" role="menuitem" @click="moveToGroup(project, '未分组')">移出分组</button>
                <button v-for="group in groups" :key="group.name" type="button" class="menu-button row-menu-item" role="menuitem" :disabled="groupOf(project.path) === group.name" @click="moveToGroup(project, group.name)">移入「{{ group.name }}」</button>
                <button type="button" class="menu-button row-menu-item" role="menuitem" @click="createGroupWith(project)">新建分组并移入…</button>
                <div class="menu-rule" role="separator" />
                <button type="button" class="menu-button row-menu-item" role="menuitem" :disabled="busy" :title="'仅移除记录，不删除文件'" @click="forgetSingle(project)">
                  <X :size="14" aria-hidden="true" />仅从列表移除
                </button>
              </div>
            </li>
              </ul>
            </section>
          </div>
          <div v-else-if="query.trim()" class="project-empty">
            <Search :size="28" aria-hidden="true" />
            <h3>没有匹配的项目</h3>
            <p>试试其他名称或路径，或清空搜索查看全部项目。</p>
            <button type="button" class="subtle-button" @click="clearSearch">清空搜索</button>
          </div>
          <div v-else class="project-empty">
            <FolderOpen :size="30" aria-hidden="true" />
            <h3>{{ isDesktop ? '还没有近期项目' : '尚未打开内存示例' }}</h3>
            <p>{{ isDesktop ? '点击“打开项目”选择已有文件夹，或点击“新建项目”创建 Java 项目或空项目。' : '点击“打开内存示例”体验编辑。真实的打开、新建和克隆需要在桌面端操作。' }}</p>
            <!-- IDEA EmptyStateProjectsPanel starts with a vertical group of quick actions
                 plus a "More" drop-down instead of a single hint line. -->
            <div class="empty-actions" role="group" aria-label="快捷开始">
              <button type="button" class="primary-button empty-action" :disabled="busy" @click="emit('create')"><FolderPlus :size="15" aria-hidden="true" />新建项目</button>
              <button type="button" class="subtle-button empty-action" :disabled="busy" @click="emit('open')"><FolderOpen :size="15" aria-hidden="true" />打开</button>
              <button type="button" class="subtle-button empty-action" :disabled="busy || !gitAvailable" :title="gitAvailable ? '从远程仓库克隆' : '安装 Git 后可用'" @click="emit('clone')"><GitBranch :size="15" aria-hidden="true" />从 VCS 获取</button>
              <div class="empty-more">
                <button type="button" class="subtle-button empty-action" :aria-expanded="moreOpen" aria-haspopup="menu" @click="moreOpen = !moreOpen">更多<ChevronDown :size="13" aria-hidden="true" /></button>
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
              aria-haspopup="dialog" :title="noticeTitle(notices)" :aria-label="noticeTitle(notices)"
              @click="notificationsOpen = !notificationsOpen"
            ><BellDot :size="15" aria-hidden="true" />{{ noticeButtonText(notices.length) }}</button>
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
.project-welcome { display: grid; grid-template-columns: 210px minmax(0, 1fr); flex: 1; width: 100%; height: 100%; min-width: 0; min-height: 0; overflow: hidden; background: var(--editor); }
.welcome-sidebar { display: flex; flex-direction: column; gap: var(--space-4); min-height: 0; overflow: auto; padding: var(--space-6) var(--space-3) 0; background: var(--panel); border-right: 1px solid var(--line); }
/* IDEA createQuickAccessPanel: pinned to the bottom of the sidebar (BorderLayout.SOUTH),
   left-aligned, with the New UI empty(15, 14) inset — not a lone 28px icon floating in the column. */
.welcome-brand { display: flex; align-items: baseline; flex-wrap: wrap; gap: var(--space-2); padding: 0 var(--space-3); }
.welcome-brand .brand { font-size: 20px; gap: var(--space-2); }
.welcome-version { font: 11px var(--font-mono); color: var(--muted); }
.welcome-navigation { display: flex; flex-direction: column; gap: var(--space-1); }
.navigation-item { display: flex; align-items: center; gap: var(--space-2); width: 100%; min-height: var(--ctrl-height-lg); padding: var(--space-1) var(--space-3); border-radius: var(--radius-xs); text-align: left; font-size: 13px; }
.navigation-item.selected { background: var(--selected); color: var(--bright); font-weight: 600; }
.navigation-item > svg { flex-shrink: 0; }
.nav-badge { margin-left: auto; min-width: 18px; padding: 0 5px; border-radius: 9px; background: var(--selected); color: var(--accent); font: 600 10px/18px var(--font-ui); text-align: center; }
.welcome-quick-access { position: relative; display: flex; align-items: center; justify-content: center; margin: auto calc(-1 * var(--space-3)) 0; padding: 15px 14px 20px; }
.welcome-gear { width: 26px; height: 26px; }
.welcome-options { position: absolute; left: 50%; transform: translateX(-50%); bottom: calc(100% - 8px); z-index: 30; display: flex; flex-direction: column; min-width: 180px; padding: 4px; border: var(--popup-border); border-radius: var(--popup-radius); background: var(--elevated); box-shadow: var(--popup-shadow); }
.welcome-options-item { display: flex; align-items: center; justify-content: flex-start; width: 100%; text-align: left; }
.sidebar-note { margin: var(--space-2) var(--space-3) 0; color: var(--muted); font-size: 11px; }
.welcome-main { min-width: 0; min-height: 0; overflow: auto; }
.welcome-content { width: 100%; max-width: 1050px; margin: 0 auto; padding: clamp(24px, 5vw, 64px); }
.customize-group { margin-bottom: var(--space-6); }
.customize-group h2 { margin: 0 0 var(--space-3); color: var(--secondary); font-size: 11px; font-weight: 600; letter-spacing: .05em; }
.customize-row { display: flex; align-items: center; justify-content: space-between; gap: var(--space-4); max-width: 420px; color: var(--text); font-size: 13px; }
.customize-row select, .customize-row input { width: 120px; min-height: 30px; padding: var(--space-1) var(--space-2); color: var(--text); background: var(--elevated); border: 1px solid var(--line-strong); border-radius: var(--radius-xs); font: inherit; }
.theme-options { display: flex; flex-wrap: wrap; gap: var(--space-3); }
.customize-page .theme-option { display: inline-flex; align-items: center; gap: var(--space-2); flex: 0 0 auto; min-width: 110px; padding: var(--space-3); line-height: 18px; }
.customize-page .theme-option > svg { flex-shrink: 0; }
.welcome-heading { display: flex; flex-wrap: wrap; align-items: center; justify-content: flex-start; gap: var(--space-5); margin-bottom: var(--space-5); padding-bottom: var(--space-4); border-bottom: 1px solid var(--line); }
.welcome-heading h1 { margin: 0; font-size: 24px; line-height: 1.4; font-weight: 600; color: var(--bright); }
.project-actions { display: flex; flex-wrap: wrap; gap: var(--space-2); }
.project-actions .primary-button { margin-top: 0; }
.action-button { display: inline-flex; align-items: center; justify-content: center; gap: var(--space-2); min-height: var(--ctrl-height-lg); }
.action-button > svg { flex-shrink: 0; }
.welcome-preview { align-items: flex-start; gap: var(--space-2); border: 1px solid var(--line); border-radius: var(--radius-xs); padding: var(--space-2) var(--space-3); margin: 0 0 var(--space-3); font-size: 12px; }
.welcome-preview .preview-dot { margin-top: var(--space-2); }
.welcome-preview > span:last-child { min-width: 0; overflow-wrap: anywhere; }
.git-note { margin: 0 0 var(--space-3); color: var(--muted); }
.welcome-error { border: 1px solid var(--error); border-radius: var(--radius-xs); margin-bottom: var(--space-3); }
.recent-section { min-width: 0; }
.recent-heading { display: flex; align-items: center; justify-content: space-between; gap: var(--space-3); margin-bottom: var(--space-2); }
.recent-heading h2 { margin: 0; color: var(--muted); font-size: 11px; font-weight: 500; letter-spacing: .03em; }
.project-search { display: flex; align-items: center; gap: var(--space-2); min-width: 0; padding: var(--space-1) var(--space-2) var(--space-1) var(--space-3); min-height: 36px; background: var(--editor); border: 1px solid var(--line-strong); border-radius: var(--radius-xs); color: var(--muted); }
.project-search:focus-within { border-color: var(--accent); }
.project-search > svg { flex-shrink: 0; }
.project-search input { flex: 1; width: 100%; min-width: 0; padding: var(--space-1); border: 0; background: var(--editor); color: var(--text); }
.project-search input::placeholder { color: var(--muted); }
.project-search input::-webkit-search-cancel-button { display: none; }
.list-status { margin: var(--space-2) 0 var(--space-1); color: var(--muted); font: 11px var(--font-mono); font-variant-numeric: tabular-nums; }
/* IDEA keeps the welcome notification toolbar in the last row of the projects tab, aligned right
   (ProjectsTabFactory.kt:126-131 -> `align(AlignX.RIGHT)`); the popup reuses the status bar's list. */
.welcome-notifications { position: relative; display: flex; justify-content: flex-end; margin-top: var(--space-3); }
.welcome-notice-button { display: inline-flex; align-items: center; gap: var(--space-2); font-size: 12px; }
.list-hint { margin: 0 0 var(--space-1); padding: var(--space-1) var(--space-2); border: 1px solid var(--line); border-radius: var(--radius-xs); color: var(--warning); background: var(--warning-bg); font-size: 11px; line-height: 1.7; }
.recent-list { margin: 0; padding: 0; }
.recent-group { margin-bottom: var(--space-1); }
.recent-group-head { display: flex; align-items: center; gap: var(--space-2); padding: 2px var(--space-2); border-radius: var(--radius-xs); color: var(--muted); font-size: 11px; cursor: pointer; }
.recent-group-head:hover { background: var(--hover); color: var(--secondary); }
.recent-group-head:focus-visible { outline: 1px solid var(--accent); outline-offset: 1px; }
.recent-group-head svg { transition: transform var(--dur-1) var(--ease); }
.recent-group-head svg.collapsed { transform: rotate(-90deg); }
.recent-group-name { font-weight: 600; letter-spacing: .02em; }
.recent-group-count { margin-left: auto; font-variant-numeric: tabular-nums; }
.recent-group-list { list-style: none; margin: 0; padding: 0; }
.recent-row { position: relative; display: flex; align-items: center; gap: var(--space-2); min-width: 0; border-bottom: 1px solid var(--line); }
.recent-row.is-selected { background: var(--selected); }
.recent-row.menu-open .recent-open { background: var(--selected); }
/* RecentProjectFilteringTree renders name above path in one cell next to the icon; the old fixed
   2.2rem date column let the date paint over the row gear. */
.recent-open { display: grid; grid-template-columns: 32px minmax(0, 1fr); gap: var(--space-2) var(--space-4); align-items: center; flex: 1; min-width: 0; min-height: 52px; padding: var(--space-2) var(--space-3); border: 0; border-radius: var(--radius-xs); background: var(--editor); text-align: left; }
.recent-open:hover:not(:disabled) { background: var(--hover); }
.recent-open:disabled { opacity: 1; color: var(--muted); }
.project-avatar { display: inline-flex; align-items: center; justify-content: center; width: 30px; height: 30px; flex-shrink: 0; align-self: center; border-radius: 50%; font-size: 12px; background-color: var(--selected); background-image: linear-gradient(135deg, var(--selected), var(--selected)); color: var(--on-accent); font: 600 11px var(--font-brand); letter-spacing: 1px; text-shadow: 0 1px 1px rgba(0, 0, 0, 0.35); }
/* RecentProjectIconHelper generates gradient avatars (ProjectIconPalette) for
   reachable paths and a desaturated version when the path is gone. The CSS
   gradient lives inline so the JS palette stays the single source of truth. */
.project-details { display: flex; flex-direction: column; gap: 2px; min-width: 0; }
.project-title { display: flex; align-items: baseline; gap: var(--space-2); min-width: 0; white-space: nowrap; }
.project-title strong { min-width: 0; color: var(--bright); font-size: 13px; font-weight: 600; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.project-path { overflow: hidden; white-space: nowrap; text-overflow: ellipsis; color: var(--secondary); font: 11px/1.6 var(--font-mono); font-variant-numeric: tabular-nums; }
.project-date { overflow: hidden; text-overflow: ellipsis; color: var(--muted); font: 11px var(--font-mono); font-variant-numeric: tabular-nums; white-space: nowrap; }
.project-branch { display: inline-flex; align-items: center; gap: 3px; color: var(--secondary); font: 11px var(--font-mono); white-space: nowrap; }
.memory-tag { flex-shrink: 0; color: var(--warning); font-size: 10px; }
.recent-row-actions { display: flex; flex-direction: column; align-items: flex-end; gap: var(--space-1); flex-shrink: 0; }
/* IDEA shows the row's ⋮ only while the pointer (or keyboard focus) is on the row. */
.row-menu-button { opacity: 0; transition: opacity .1s ease; }
.recent-row:hover .row-menu-button, .recent-row:focus-within .row-menu-button, .recent-row.menu-open .row-menu-button { opacity: 1; }
.row-menu { position: absolute; top: 100%; right: var(--space-2); z-index: 30; display: flex; flex-direction: column; min-width: 160px; padding: 4px; border: var(--popup-border); border-radius: var(--popup-radius); background: var(--elevated); box-shadow: var(--popup-shadow); }
.row-menu-item { justify-content: flex-start; gap: var(--space-2); }
.menu-backdrop { position: fixed; inset: 0; z-index: 20; }
.missing-tag { padding: 2px var(--space-1); border-radius: var(--radius-xs); color: var(--warning); background: var(--warning-bg); font-size: 10px; }
/* Source: IconUtil.desaturate in RecentProjectIconHelper when isProjectValid=false.
   CSS filter keeps the gradient visible while signalling the missing path. */
.recent-row .recent-open:disabled .project-avatar { filter: grayscale(0.85) opacity(0.65); }
.project-empty { padding: 42px var(--space-3); text-align: center; color: var(--muted); }
.empty-actions { display: flex; flex-direction: column; align-items: center; gap: var(--space-2); margin-top: var(--space-2); }
.empty-action { display: inline-flex; align-items: center; gap: var(--space-2); min-width: 168px; justify-content: flex-start; }
.empty-more { position: relative; display: flex; flex-direction: column; align-items: center; }
.empty-more-menu { position: absolute; top: 100%; left: 50%; transform: translateX(-50%); z-index: 30; display: flex; flex-direction: column; min-width: 150px; margin-top: 4px; padding: 4px; border: var(--popup-border); border-radius: var(--popup-radius); background: var(--elevated); box-shadow: var(--popup-shadow); }
.empty-more-item { justify-content: flex-start; width: 100%; }
.project-empty h3 { margin: var(--space-3) 0 var(--space-2); font-size: 15px; color: var(--text); font-weight: 500; }
.project-empty p { max-width: 430px; margin: 0 auto var(--space-4); line-height: 1.8; overflow-wrap: anywhere; }
@media (max-width: 760px) {
  .project-welcome { grid-template-columns: 155px minmax(0, 1fr); }
  .welcome-sidebar { padding: var(--space-5) var(--space-2) var(--space-4); }
  .welcome-brand { gap: var(--space-1); padding: 0 var(--space-2); }
  .welcome-brand .brand { font-size: 17px; }
  .welcome-content { padding: var(--space-5) var(--space-5); }
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
  .sidebar-note { margin-inline: var(--space-2); }
  .welcome-content { padding: var(--space-5) var(--space-3); }
  .welcome-heading { margin-bottom: var(--space-5); gap: var(--space-3); }
  .welcome-heading h1 { font-size: 21px; }
  .project-actions { flex-direction: column; align-items: stretch; width: 100%; }
  .project-actions .primary-button { justify-content: center; }
  .recent-open { gap: var(--space-2); padding-inline: 0; }
  .project-avatar { width: 30px; height: 32px; font-size: 16px; }
}
</style>
