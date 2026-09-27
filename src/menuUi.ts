// 主菜单栏的模型与交互 —— 从 App.vue 搬出的一域（137 行，18 个依赖）。
//
// **范围说明（如实）**：这一块把三件事放在一起，因为它们是同一条交互链上的三段 ——
//   1) 菜单组的组装与排序（`allMenuGroups`，把 Tools 组与动态 Layouts 组插到 Git 之前/之后）；
//   2) 菜单行的渲染与点击（`rowTitle` / `rowEnabled` / `pickMenuRow` / 子菜单浮层状态）；
//   3) 不占菜单位置但必须可搜索的两个动作入口：「查找操作」（IDEA `FindActionAction`）与
//      标题栏的项目部件（`ProjectToolbarWidgetAction`）。
// 三者都读同一份 `menu` 开关、同一批 `MenuRow`，拆开会让每一份都要重新注入对方的状态。
// 菜单行本身的数据在 src/menus/*（一组一文件），这里只做「装配 + 交互」。
import { computed, nextTick, ref, watch, type Ref } from 'vue'
import type { MenuRow } from './menus/types'
import { useSubmenuState } from './menus/submenuState'
import { rankCommands } from './commandSearch'
import { PLUGIN_MENU_LABEL, pluginMenuRows } from './pluginCommands'
import { recordActionStep } from './macroHost'
import { bookmarkOwner } from './bookmarks'
import { filterProjects, groupProjects } from './projectWidget'
import type { EditorSettings, PluginInfo, RecentProject, Workspace } from './bridge'

/** 命令面板/查找操作里的一条（IDEA 的 AnAction 在搜索列表中的投影）。 */
export interface ActionEntry { id: string; title: string; keywords?: string; keys?: string; group: string; enabled?: () => boolean; run: () => void }

export interface MenuUiDeps {
  notify: (message: string, error?: boolean) => void
  isDesktop: boolean
  editorSettings: Ref<EditorSettings>
  /** 主菜单开关（宿主更早的阶段就要读写它，所以留在宿主）。 */
  menu: Ref<any>
  workspace: Ref<Workspace | null>
  /** 静态菜单组（File/Edit/View/…）与两个动态组的数据源。 */
  menus: { menu: any; label: string; rows: MenuRow[] }[]
  windowMenuRows: MenuRow[]
  layoutMenuRows: Ref<MenuRow[]>
  toolsMenuRows: MenuRow[]
  /** 已安装插件（EXT-01）：启用插件贡献的命令接成一个「插件」菜单组（见 src/pluginCommands.ts）。 */
  pluginList: Ref<PluginInfo[]>
  /** 书签助记符（IDEA 把十个跳转也列成动作，但菜单栏里放不下）。 */
  digits: readonly number[]
  bookmarks: Ref<any[]>
  jumpMnemonic: (digit: number) => void
  focusStatusBar: () => void
  recentProjects: Ref<RecentProject[]>
  /** 有未完成的写入/加载时，切换项目要拦住。 */
  working: { readonly value: boolean }
  openWorkspace: (path: string) => unknown
}

export function createMenuUi(deps: MenuUiDeps) {
  const { notify, isDesktop, editorSettings, menu, workspace, menus, windowMenuRows, layoutMenuRows, toolsMenuRows,
          pluginList, digits, bookmarks, jumpMnemonic, focusStatusBar, recentProjects, working, openWorkspace } = deps
// 插件命令的执行：在动作表里按 id 找（IDEA 的 `ActionManager.getAction(id).actionPerformed`）。
// 先记宏再执行，与其它菜单行同一条链 —— 所以走 `runAction` 而不是直接 `entry.run()`。
function runPluginCommand(action: string) {
  const entry = actionList.value.find(item => item.id === action)
  if (!entry) { notify(`插件命令指向的动作不存在：${action}`, true); return }
  runAction(entry)
}
const allMenuGroups = computed(() => {
  const at = menus.findIndex(group => group.menu === 'git')
  // 布局组在**窗口菜单最顶部**：`PlatformActions.xml:637-651` 里 WindowMenu 的顺序是
  // MinimizeCurrentWindow / ZoomCurrentWindow / MoveWindowBuiltinDisplayAction → LayoutsGroup → separator →
  // ActiveToolwindowGroup。前三条是 macOS 的窗口动作，本仓没有 ⇒ 布局组落第一位。
  // 它的行是动态的（每个命名布局一行），所以在这里拼，而不是写进静态的 `windowMenuRows`。
  // 依据：`platform/platform-impl/resources/idea/PlatformActions.xml:637-651`。
  // （原先这里锚在 `window.searchEverywhere` 上 —— 那个 id 全仓不存在，findIndex 得 −1、`+1` 变 0，
  //  才"碰巧"插对位置；IDEA 的窗口菜单里也并没有 Search Everywhere，它在 GoToMenu，`:604`。）
  const windowRows = [...layoutMenuRows.value, ...windowMenuRows]
  const windowGroup = { menu: 'window' as const, label: '窗口', rows: windowRows }
  const toolsGroup = { menu: 'tools' as const, label: '工具', rows: toolsMenuRows }
  const next = [...menus]
  // IDEA's main-menu order ends ... Git, Window, Help; Tools sits before Git, and the
  // build group is declared inline between Refactor and Run.
  next.splice(at, 0, toolsGroup)
  // 插件贡献的命令紧跟工具组（IDEA 里插件的动作大多落在工具菜单里）；**没有命令时整组不出现**
  // （空组不渲染）。`hasAction` 是惰性回调：只在渲染那一行时求值，因此不会与 `actionList`
  // （它反过来依赖本 computed）构成环。
  const pluginRows = pluginMenuRows(pluginList.value, {
    run: runPluginCommand,
    hasAction: action => actionList.value.some(entry => entry.id === action),
  })
  if (pluginRows.length) next.splice(at + 1, 0, { menu: 'plugins' as const, label: PLUGIN_MENU_LABEL, rows: pluginRows })
  next.splice(at + (pluginRows.length ? 3 : 2), 0, windowGroup)
  return next
})
function rowTitle(row: MenuRow) { return typeof row.title === 'function' ? row.title() : row.title ?? '' }
function rowEnabled(row: { enabled?: () => boolean }) { return row.enabled ? row.enabled() : true }
// 子菜单展开状态与定位：见 src/menus/submenuState.ts（对应 IDEA 菜单弹出二级浮层的行为）。
const { submenuRows, hasSubmenu, submenuRow, submenuPlacement, submenuStyle, openSubmenu, closeSubmenu,
  scheduleSubmenuClose, cancelSubmenuClose } = useSubmenuState()
// 主菜单一旦切换或收起（键盘 ↓ 换菜单、Esc、点外部、打开任一对话框……），子菜单浮层必须跟着
// 关闭 —— 不逐点补丁，用 watch 兜底覆盖全部路径（之前漏过 focusMenu/Tab/Esc/打开对话框四条）。
watch(menu, () => { closeSubmenu() })
function pickMenuRow(row: MenuRow) {
  // 带 children 的行不是动作：点它只切换子菜单的展开状态，不动主菜单的开关。
  if (hasSubmenu(row)) {
    submenuRow.value = submenuRow.value === row.id ? null : row.id
    return
  }
  // IDEA "Keep popups open for toggle items": a checkable row flips in place and the
  // menu stays open, so several options can be switched in one go.
  if (!(editorSettings.value.keepPopupsForToggles && row.checked)) menu.value = null
  submenuRow.value = null
  // 宏录制：菜单行也是 AnAction，执行前记一步（记的是 IDEA 的动作 id，不是菜单路径）。
  recordActionStep({ id: row.id, title: rowTitle(row), ...(row.keys ? { keys: row.keys } : {}) })
  row.run?.()
}
// IDEA's ProjectToolbarWidgetAction (headertoolbar/ProjectToolbarWidgetAction.kt:118-297):
// the header carries the project name with a chevron, and the popup lists the open
// projects and then the recent ones (ProjectConceptBundle.properties:22-23
// "Open Projects" / "Recent Projects") with the project path and its branch. The list is
// the first MAX_RECENT_COUNT recent actions (:98, :263-265), grouped by "is this project
// open" (:262-276), and the popup searches over name *and* path (:367-372).
const projectWidgetOpen = ref(false)
const projectWidgetQuery = ref('')
const projectWidgetGroups = computed(() => groupProjects(
  filterProjects(recentProjects.value, projectWidgetQuery.value),
  workspace.value?.root,
))
function toggleProjectWidget() {
  projectWidgetOpen.value = !projectWidgetOpen.value
  if (projectWidgetOpen.value) projectWidgetQuery.value = ''
}
function pickProjectFromWidget(project: RecentProject) {
  projectWidgetOpen.value = false
  // The current window's project is already open; IDEA brings that frame to front, which
  // a single-project window has nothing to do for.
  if (project.path === workspace.value?.root) return
  openRecentProject(project)
}
// IDEA's popup rows print the branch the recent-project action carries
// (ProjectToolbarWidgetPresentable.branchName, ReopenProjectAction.kt:48); TaoCode records
// the branch the status bar already polls, keyed by root — the same store the welcome page
// reads (see the gitHead watcher).
function branchOfProject(path: string): string {
  if (!isDesktop) return ''
  try { return localStorage.getItem(`taocode.branch:${path}`) ?? '' } catch { return '' }
}
function openRecentProject(project: RecentProject) {
  if (working.value || !project.available) return
  menu.value = null
  void openWorkspace(project.path)
}

interface ActionEntry { id: string; title: string; keywords?: string; keys?: string; group: string; enabled?: () => boolean; run: () => void }
const actionSearch = ref(false)
const actionQuery = ref('')
const actionIndex = ref(0)
const actionInput = ref<HTMLInputElement>()
// Same command can sit in several menus (IDEA does too); Find Action lists it once.
// IDEA 的 Find Action 会把**子菜单里的动作**一起列出来，所以索引时要把 children 递归摊平；
// 父行本身没有 run，留在里面只会变成一条点不动的命令。
function flattenMenuRows(rows: readonly MenuRow[]): MenuRow[] {
  const flat: MenuRow[] = []
  for (const row of rows) {
    // 动态组（`childrenOf`）在 Find Action 里也要摊平 —— 否则「已保存的宏」录/存之后搜不到。
    const children = row.childrenOf ? row.childrenOf() : row.children
    if (children?.length) flat.push(...flattenMenuRows(children))
    else flat.push(row)
  }
  return flat
}
const actionList = computed<ActionEntry[]>(() => {
  const seen = new Map<string, ActionEntry>()
  for (const group of allMenuGroups.value) for (const row of flattenMenuRows(group.rows)) {
    if (!row.run || seen.has(row.id)) continue
    seen.set(row.id, { id: row.id, title: rowTitle(row), keywords: row.keywords, keys: row.keys, group: group.label, enabled: row.enabled, run: row.run })
  }
  const list = [...seen.values()]
  // IDEA lists the ten mnemonic jumps as actions of their own, even though the menubar
  // has no room for them.
  for (const digit of digits) list.push({
    id: `navigate.bookmark${digit}`, title: `跳转到书签 ${digit}`, keys: `Ctrl ${digit}`,
    keywords: `bookmark mnemonic digit 书签 ${digit}`, group: '导航',
    enabled: () => Boolean(bookmarkOwner(bookmarks.value, digit)), run: () => jumpMnemonic(digit),
  })
  // IDEA's `FocusStatusBar` (ActionsBundle.properties:81-82 `Focus Status Bar` /
  // "Move focus to the first widget in the status bar") is not a menu item either: it lives in the
  // `ToolbarPopupActions` group (PlatformActions.xml:1366) that CustomizationUtil.java:567-568
  // injects into the *toolbar customization* popup, so it is a searchable action without a menu row.
  list.push({
    id: 'window.focusStatusBar', title: '聚焦状态栏', keys: '',
    keywords: 'focus status bar first widget keyboard 状态栏 键盘 焦点 focus status bar', group: '窗口',
    enabled: () => Boolean(workspace.value), run: focusStatusBar,
  })
  return list
})
const actionResults = computed(() => rankCommands(actionList.value, actionQuery.value))
function openActionSearch() {
  actionQuery.value = ''
  actionIndex.value = 0
  menu.value = null
  actionSearch.value = true
  void nextTick(() => actionInput.value?.focus())
}
function moveAction(step: number) {
  const size = Math.max(1, actionResults.value.length)
  actionIndex.value = (actionIndex.value + step + size) % size
}
function runAction(entry: ActionEntry) {
  if (entry.enabled && !entry.enabled()) { notify(`「${entry.title}」当前不可用。`, true); return }
  // 宏录制（IDEA 的 `AnActionListener.beforeActionPerformed`）：动作**执行前**记一步。
  recordActionStep({ id: entry.id, title: entry.title, ...(entry.keys ? { keys: entry.keys } : {}) })
  actionSearch.value = false
  entry.run()
}
function runActionResult() {
  const entry = actionResults.value[actionIndex.value]
  if (entry) runAction(entry)
}
watch(actionQuery, () => { actionIndex.value = 0 })
  return {
    allMenuGroups, rowTitle, rowEnabled, submenuRows, hasSubmenu, submenuRow, submenuPlacement, submenuStyle,
    openSubmenu, closeSubmenu, scheduleSubmenuClose, cancelSubmenuClose, pickMenuRow, flattenMenuRows,
    projectWidgetOpen, projectWidgetQuery, projectWidgetGroups, toggleProjectWidget, pickProjectFromWidget,
    branchOfProject, openRecentProject,
    actionSearch, actionQuery, actionIndex, actionInput, actionList, actionResults,
    openActionSearch, moveAction, runAction, runActionResult,
  }
}
