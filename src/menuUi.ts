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
import type { MenuRow } from './menus/types.ts'
import { useSubmenuState } from './menus/submenuState.ts'
import { rankCommands } from './commandSearch.ts'
import { createPopupGate } from './popupState.ts'
import { focusMainToolbar, mainToolbarFocusHost } from './mainToolbarFocus.ts'
import { editorPopupRows as editorPopupLayout } from './menus/editorPopupMenu.ts'
import { toolWindowGearRows as toolWindowGearLayout } from './menus/toolWindowGear.ts'
import { PLUGIN_MENU_LABEL, pluginMenuRows } from './pluginCommands.ts'
import { recordActionStep } from './macroHost.ts'
import { addActionListener, fireAfterActionPerformed, fireBeforeActionPerformed } from './actionEvents.ts'
import { bookmarkOwner } from './bookmarks.ts'
import { filterProjects, groupProjects } from './projectWidget.ts'
import { widgetToggleRows } from './statusWidgets.ts'
import { ACTIONS } from './actionRegistry.ts'
import { keymapKeys } from './keymapBindings.ts'
import type { EditorSettings, PluginInfo, RecentProject, Workspace } from './bridge'

/** 命令面板/查找操作里的一条（IDEA 的 AnAction 在搜索列表中的投影）。 */
export interface ActionEntry { id: string; title: string; keywords?: string; keys?: string; group: string; enabled?: () => boolean; /** 勾选型行（上游 `BooleanOptionDescription`）：显示当前开/关，点一下就地翻转。 */ checked?: () => boolean; run: () => void }

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
  /** 书签助记键（0-9 + A-Z，见 BOOKMARK_MNEMONICS）：IDEA 把每个跳转都列成动作。 */
  mnemonics: readonly string[]
  bookmarks: Ref<any[]>
  jumpMnemonic: (mnemonic: string) => void
  focusStatusBar: () => void
  /** 此刻有没有打开的编辑器（状态栏里 editor-based 组件能不能开，判据与右键勾选同一条）。 */
  hasEditor: () => boolean
  recentProjects: Ref<RecentProject[]>
  /** 有未完成的写入/加载时，切换项目要拦住。 */
  working: { readonly value: boolean }
  openWorkspace: (path: string) => unknown
  /**
   * 编辑器右键菜单要引用、但不属于任何主菜单的 action（IDEA 里就是那些只挂在弹出组上的动作，
   * 例如 `Gradle.ImportExternalProject` 只进 `ProjectViewPopupMenuSettingsGroup` / `EditorPopupMenu`）。
   */
  popupExtras?: () => MenuRow[]
  /**
   * 齿轮组里**不在菜单索引**的那几行（上游也只在齿轮里 `group.add(...)` 现造）：
   * `SpeedSearch`（`ToolWindowImpl.kt:869`）与 `RemoveStripeButtonAction`（`:889`）。
   * 宿主按各自的前置条件给行，给不出（不返回该 id）时整行不出现 ——
   * 与"引用一个不存在的动作"同样处理，不会留一行假的。
   */
  gearHostRows?: () => Record<string, MenuRow>
  /**
   * **右侧**那条 dock 的齿轮宿主行（左右分栏后各有各的窗口，行内容跟着各自的视图走；
   * 上游每个 ToolWindowEx 的齿轮是窗口自己的）。缺省回落到 `gearHostRows`（单测夹具
   * 与只有左栏的旧世界一致）。
   */
  rightGearHostRows?: () => Record<string, MenuRow>
  /**
   * 底部 dock 齿轮的宿主行（同一个机制，另一侧）：用法视图的「视图选项」组
   * （`UsageViewContentManagerImpl.java:114-116` 的 `additionalGearActions`）。
   */
  bottomGearHostRows?: () => Record<string, MenuRow>
  /**
   * 「文件颜色」的三个开关（上游 `FileColorsOptionsTopHitProvider` 的 `BooleanOptionDescription` 行）：
   * 宿主给行（读设置 + 写 `saveSettingsPatch`），这里只把它们放进动作索引。
   */
  fileColorRows?: () => ActionEntry[]
}

/**
 * 只有键位入口、**不在任何菜单里**的动作：上游 `ActionManager` 里有、`getAction(id)` 拿得到，
 * 但菜单树里没有对应行（IDEA 的键位面板就是按这个集合列出可改键的动作）。
 *
 * 键位动作是**每次按键**才注册进注册表的（`keymap.ts:418` 的 `registerKeymapActions`）。
 * `keymapBindings.ts` 的 31 个动作 id 里有 **21 个**在 `src/menus/*` 找不到对应行 ——
 * 转到行 / 快速文档 / 提取方法 / 按名字运行检查 / 打开设置 / 追溯 / 关闭标签页…，
 * 也就是说这些动作原先在「查找操作」与 Search Everywhere 里**一个都搜不到**。
 * （两个数字都由 `tests/keymap-bindings.test.mjs` 的「menuUi 的计数注释与键位表同步」现算，
 * 加一条键位就跟着变；上一版写的是 25/21，R1+R2 落了导航三条与编辑器一族之后就漂成了 25。）
 *
 * 注册表不是响应式的（`ACTIONS.presentationVersion` 是普通数字，读它不构成 Vue 依赖），
 * 所以这一段只能在**搜索面板打开的那一刻**重算 —— 见 `refreshActionRegistryIndex`。
 */
const REGISTRY_GROUP = '动作'
function registryEntries(): ActionEntry[] {
  const out: ActionEntry[] = []
  for (const id of ACTIONS.ids()) {
    const descriptor = ACTIONS.get(id)
    if (!descriptor) continue
    out.push({
      id,
      title: typeof descriptor.title === 'function' ? descriptor.title() : descriptor.title,
      keywords: descriptor.keywords,
      // 键位显示串与菜单行同一个来源（`actionRow` 也走 `keymapKeys`），不手写第二份。
      keys: keymapKeys(id),
      group: REGISTRY_GROUP,
      ...(descriptor.enabled ? { enabled: () => descriptor.enabled!() } : {}),
      ...(descriptor.checked ? { checked: () => descriptor.checked!() } : {}),
      run: () => { ACTIONS.run(id) },
    })
  }
  return out
}

// 内置监听者：宏录制（上游 `ActionMacroManager implements AnActionListener`，在 before 里记一步）。
// 装配放在这里 —— 管道（src/actionEvents.ts）保持纯的，菜单分派只广播、不知道谁在听。
addActionListener({ beforeActionPerformed: recordActionStep })
export function createMenuUi(deps: MenuUiDeps) {
  const { notify, isDesktop, editorSettings, menu, workspace, menus, windowMenuRows, layoutMenuRows, toolsMenuRows,
          pluginList, mnemonics, bookmarks, jumpMnemonic, focusStatusBar, recentProjects, working, openWorkspace,
          popupExtras, gearHostRows = () => ({}), rightGearHostRows, bottomGearHostRows = () => ({}), fileColorRows = () => [] } = deps
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
  const step = { id: row.id, title: rowTitle(row), ...(row.keys ? { keys: row.keys } : {}) }
  fireBeforeActionPerformed(step)
  row.run?.()
  fireAfterActionPerformed(step)
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
  filterProjects(recentProjects.value, projectWidgetQuery.value, workspace.value?.root ?? ''),
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

interface ActionEntry { id: string; title: string; keywords?: string; keys?: string; group: string; enabled?: () => boolean; checked?: () => boolean; run: () => void }
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
// 注册表那一段的刷新世代（见 `registryEntries` 的注释：键位动作按需注册，注册表不响应式）。
const registryRevision = ref(0)
/** 重算动作索引里来自注册表的那一段。Find Action 与 Search Everywhere 共用同一份 `actionList`。 */
const refreshActionRegistryIndex = () => { registryRevision.value++ }
const actionList = computed<ActionEntry[]>(() => {
  void registryRevision.value
  const seen = new Map<string, ActionEntry>()
  for (const group of allMenuGroups.value) for (const row of flattenMenuRows(group.rows)) {
    if (!row.run || seen.has(row.id)) continue
    seen.set(row.id, { id: row.id, title: rowTitle(row), keywords: row.keywords, keys: row.keys, group: group.label, enabled: row.enabled, run: row.run })
  }
  // 注册表里**没有菜单行**的那些动作补进索引。菜单已经有的（宏、`build.*`、本地历史）
  // 一律不覆盖 —— 菜单那一侧的标题与关键字更具体（比如宏行的 keyword 带宏名）。
  for (const entry of registryEntries()) if (!seen.has(entry.id)) seen.set(entry.id, entry)
  const list = [...seen.values()]
  // IDEA lists one jump action per mnemonic (`Bookmarks.Goto` 弹出组，36 个：
  // `intellij.platform.bookmarks.xml:81-117` 的 GotoBookmark0..9/A..Z），文案取中文包的
  // 「转到书签 {0}」(`goto.bookmark.type.action.text`)。**只有 0-9 有默认键位**
  // （`$default.xml:173-197` 的 control 0..9）；字母没有全局键，只有书签树内的裸键
  // （`actions/extensions.kt:126-135`）。
  for (const mnemonic of mnemonics) {
    const digit = mnemonic >= '0' && mnemonic <= '9'
    list.push({
      id: `navigate.bookmark${mnemonic}`, title: `转到书签 ${mnemonic}`, keys: digit ? `Ctrl ${mnemonic}` : '',
      keywords: `bookmark mnemonic 书签 ${mnemonic}`, group: '导航',
      enabled: () => Boolean(bookmarkOwner(bookmarks.value, mnemonic)), run: () => jumpMnemonic(mnemonic),
    })
  }
  // IDEA's `FocusStatusBar` (ActionsBundle.properties:81-82 `Focus Status Bar` /
  // "Move focus to the first widget in the status bar") is not a menu item either: it lives in the
  // `ToolbarPopupActions` group (PlatformActions.xml:1366) that CustomizationUtil.java:567-568
  // injects into the *toolbar customization* popup, so it is a searchable action without a menu row.
  // `FocusMainToolbar`（`intellij.platform.ide.impl.actions.xml:721`，文案 ActionsBundle:79-80 =
  // 聚焦主工具栏）与 `FocusStatusBar` 一样是**顶层 `<reference>`**（PlatformActions.xml:1364/1366），
  // 不占菜单行；本仓挂进动作索引（查找操作里可搜可点）。`update`：新 UI 且有项目才可用（`:25-27`），
  // 本仓的新 UI 是常态 ⇒ 等价于"打开了项目"。
  list.push({
    id: 'window.focusMainToolbar', title: '聚焦主工具栏', keys: '',
    keywords: 'focus main toolbar first item keyboard 主工具栏 焦点 focus main toolbar', group: '窗口',
    enabled: () => Boolean(workspace.value), run: () => focusMainToolbar(mainToolbarFocusHost),
  })
  list.push({
    id: 'window.focusStatusBar', title: '聚焦状态栏', keys: '',
    keywords: 'focus status bar first widget keyboard 状态栏 键盘 焦点 focus status bar', group: '窗口',
    enabled: () => Boolean(workspace.value), run: focusStatusBar,
  })
  // 状态栏组件的「显示 <名字>」那批（上游 `StatusBarWidgetsOptionProvider`，是个
  // `SearchTopHitProvider`：只出现在搜索里、不占菜单行）。可点性与右键勾选共用同一条判据。
  for (const row of widgetToggleRows(deps.hasEditor())) {
    list.push({ id: row.id, title: row.title, keywords: row.keywords, keys: '', group: '状态栏', enabled: () => row.enabled, run: row.run })
  }
  // 文件颜色的三个开关（上游 `FileColorsOptionsTopHitProvider`）：勾选型行，随设置实时显形。
  // 主开关关闭时宿主只返回一行（上游 `:30-33`），这里不做判断。
  for (const row of fileColorRows()) list.push({ ...row, group: row.group || '外观' })
  return list
})
const actionResults = computed(() => rankCommands(actionList.value, actionQuery.value))
function openActionSearch() {
  // 面板打开的这一刻重算注册表那一段：键位动作是按需注册的，而两个搜索面板共用 `actionList`。
  refreshActionRegistryIndex()
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
  const step = { id: entry.id, title: entry.title, ...(entry.keys ? { keys: entry.keys } : {}) }
  fireBeforeActionPerformed(step)
  // IDEA "Keep popups open for toggle items"：勾选型行就地翻转、面板留着（文件颜色那三条与
  // 菜单里的可勾选行同一口径，`keepPopupsForToggles` 关掉才逐条收起）。
  if (!(entry.checked && editorSettings.value.keepPopupsForToggles)) actionSearch.value = false
  entry.run()
  fireAfterActionPerformed(step)
}
function runActionResult() {
  const entry = actionResults.value[actionIndex.value]
  if (entry) runAction(entry)
}
// 编辑器右键菜单（IDEA 的 `EditorPopupMenu`）。引用清单在 src/menus/editorPopupMenu.ts，
// 这里只做三件事：按 id 取行（主菜单行 + `popupExtras` 贡献的只挂弹出组的动作）、浮层坐标、
// 点击时分派给与「查找操作」**完全相同**的执行链（`runAction` ⇒ 先记宏步骤、再查可用性）。
// 按 id 取行而不是复制一份标题/快捷键：IDEA 的组本身就是 `<reference ref="ID"/>` 的列表。
function findMenuRow(id: string): MenuRow | undefined {
  const search = (rows: readonly MenuRow[]): MenuRow | undefined =>
    rows.find(row => row.id === id) ?? rows.map(row => (row.childrenOf ? row.childrenOf() : row.children) ?? [])
      .map(list => search(list)).find(row => row)
  for (const group of allMenuGroups.value) { const found = search(group.rows); if (found) return found }
  return search(popupExtras?.() ?? [])
}
const editorPopup = ref<{ x: number; y: number } | null>(null)
const editorPopupRows = computed(() => editorPopupLayout(findMenuRow))
// 工具窗口齿轮菜单里"属于工具窗口自己"的那几项（引用表见 src/menus/toolWindowGear.ts）。
// 两条分开算：内容条（Close All / 标签形态）挂在**底部 dock**上，侧栏齿轮只拿"调整大小"那条。
const toolWindowGearRows = computed(() => toolWindowGearLayout(findMenuRow, undefined, false, gearHostRows()))
// 右侧那条 dock 的齿轮（同一个布局，宿主行跟着右栏自己的视图算 —— 左右分栏后不能再共用左栏那份）。
const rightToolWindowGearRows = computed(() => toolWindowGearLayout(findMenuRow, undefined, false, (rightGearHostRows ?? gearHostRows)()))
// 底部 dock 的齿轮同样收宿主行：用法视图（引用）的「视图选项」组挂在这一层，
// 由宿主按"当前内容是哪一个"给（`src/usageViewGear.ts`）。
const bottomGearRows = computed(() => toolWindowGearLayout(findMenuRow, undefined, true, bottomGearHostRows()))
function openEditorPopup(event: MouseEvent) {
  // 关掉又立刻弹开的那一次点击要吞掉（上游 PopupState.isRecentlyHidden，阈值 200ms）。
  if (editorPopupGate.recentlyHidden) return
  if (!editorPopupRows.value.length) return
  editorPopup.value = { x: event.clientX, y: event.clientY }
}
const editorPopupGate = createPopupGate()
function closeEditorPopup() {
  if (!editorPopup.value) return
  editorPopup.value = null
  editorPopupGate.hidden()
}
/** 菜单行的执行入口：子菜单行（带 children）只负责展开，不当动作跑。 */
function pickEditorPopup(row: MenuRow) {
  closeEditorPopup()
  if (!row.run) return
  runAction({ id: row.id, title: rowTitle(row), keywords: row.keywords, keys: row.keys, group: '编辑器', enabled: row.enabled, run: row.run })
}
watch(actionQuery, () => { actionIndex.value = 0 })
  return {
    allMenuGroups, rowTitle, rowEnabled, submenuRows, hasSubmenu, submenuRow, submenuPlacement, submenuStyle,
    openSubmenu, closeSubmenu, scheduleSubmenuClose, cancelSubmenuClose, pickMenuRow, flattenMenuRows,
    projectWidgetOpen, projectWidgetQuery, projectWidgetGroups, toggleProjectWidget, pickProjectFromWidget,
    branchOfProject, openRecentProject,
    actionSearch, actionQuery, actionIndex, actionInput, actionList, actionResults,
    openActionSearch, moveAction, runAction, runActionResult, refreshActionRegistryIndex,
    editorPopup, editorPopupRows, openEditorPopup, closeEditorPopup, pickEditorPopup, findMenuRow, toolWindowGearRows, rightToolWindowGearRows, bottomGearRows,
  }
}
