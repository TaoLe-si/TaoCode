// 状态栏组件的**注册表**（IDEA `StatusBarWidgetFactory` + `StatusBarWidgetsManager` + `StatusBarWidgetSettings`
// 三件的合体），以及跨重启的可见性持久化。
//
// 上游出处（逐条核过）：
//   · `platform-api/.../StatusBarWidgetFactory.java`：每个组件一个工厂，字段是
//     `getId()`（**必须与 plugin.xml 的扩展 id 一致**，也是持久化可见性用的键，`:31-34`）、
//     `getDisplayName()`（`:37-41`）、`isAvailable(project)`（默认 true）、
//     `isEnabledByDefault()`（默认 true）、`isConfigurable()`（默认 true）、`isInternal()`（默认 false）。
//   · 注册处是 EP `com.intellij.statusBarWidgetFactory`（声明在
//     `platform-api/resources/intellij.platform.ide.xml:98`，`dynamic="true"`）；平台自己的那一批在
//     `platform-impl/resources/intellij.platform.ide.impl.xml:1618-1645`，git 的在
//     `plugins/git4idea/backend/resources/intellij.vcs.git.backend.xml:945-947`，语言服务与缩进在
//     `lang-impl/resources/intellij.platform.lang.impl.xml:1509-1520`。
//   · 纯逻辑（三道闸、"只存与默认不同的"、按 id 反查、勾选清单的过滤）在 `src/statusBarWidgets.ts`，
//     本文件只管"我们有哪些工厂 + 状态存哪儿"。上游 `canBeEnabledOn(statusBar)` 那条四合一判据
//     （`StatusBarWidgetsManager.kt:161-167`）**不建**：本仓没有"只对某个状态栏可用"的组件。
//
// 与上游的两点差异，都是本仓形态决定的，不是省事：
//   1. `id` 用本仓既有的短键（`position`/`lineSeparator`…）：它就是"我们的扩展 id"，持久化键不能中途
//      改名（否则用户的显隐设置会静默丢失）。上游的 id 记在 `upstreamId` 里，供审计对照与门控核对。
//   2. 有四个条目**不是**工厂：`file`/`progress`/`bridge`/`problems`。上游对应物是直接画进状态栏面板的
//      组件（`ToolWindowsWidget` 走 `IdeStatusBarImpl.kt:286-297` 的 leftPanel、`InfoAndProgressPanel`
//      走 `:343` 的 centerPanel），**不经过工厂**。本仓把它们也列进勾选清单是既有行为（用户可隐藏），
//      所以保留，但标成 `factory: false` —— 门控只对 `factory: true` 的条目核上游 id/默认值。
import { ref } from 'vue'
import {
  configurableFactories, migrateHiddenKeys, shouldCreateWidget, widgetEnabled, widgetToggleEnabled, withWidgetEnabled,
  type StatusBarWidgetFactory,
} from './statusBarWidgets.ts'

const STORAGE_KEY = 'taocode.hiddenStatusWidgets'

/** 一个状态栏条目 = 上游工厂字段 + 我们要渲染它时用的图标键。 */
export interface StatusBarWidget extends StatusBarWidgetFactory {
  /** false = 不是 EP 工厂，是直接画进面板的组件（上游 `ToolWindowsWidget`/`InfoAndProgressPanel` 那类）。 */
  factory: boolean
  /** 对应的上游工厂 id（`getDisplayName`/`getId` 的出处），仅 `factory: true` 的有；供审计对照。 */
  upstreamId?: string
}

/**
 * 全部条目。默认值一律抄上游 `isEnabledByDefault()`：
 *   · `Position`/`LineSeparator`/`Encoding`/`InsertOverwrite`/`ReadOnlyAttribute`/`Notifications` 默认 true
 *     （`intellij.platform.ide.impl.xml:1620-1633` 那条链上没有 override）；
 *   · `Memory`（`MemoryIndicatorWidgetFactory.java:22-24`）与 `PowerSaveMode`
 *     （`PowerSaveStatusWidgetFactory.java:53-55`）默认 **false**；
 *   · `FatalError`（`FatalErrorWidgetFactory.java:33-39`）`isConfigurable = false` 且 `canBeEnabledOn = false`
 *     ⇒ 不出现在勾选清单里；
 *   · git 分支（`GitBranchWidget.kt:131-139`）默认 = 主工具栏隐藏时显示，本仓顶栏常驻 ⇒ true。
 *
 * `editorBased` 抄上游的**基类**（不是逐条猜）：`StatusBarEditorBasedWidgetFactory` 的子类有
 *   `EncodingPanelWidgetFactory.java:15`、`LineSeparatorWidgetFactory.java:15`、
 *   `ReadOnlyAttributeWidgetFactory.java:13`、`ColumnSelectionModeWidgetFactory.java:12`、
 *   `CodeStyleStatusBarWidgetFactory.java:22`（缩进）、
 *   `LanguageServiceWidgetFactory.kt:12`（本仓的 `smartMode`）。
 * 其余（`PositionPanelWidgetFactory`/`MemoryIndicatorWidgetFactory`/`PowerSaveStatusWidgetFactory`/
 * `NotificationWidgetFactory`/git 的 `GitBranchWidget.Factory`）都是**直接实现**接口，没有这一层。
 */
export const STATUS_WIDGETS: StatusBarWidget[] = [
  { id: 'file', displayName: '当前文件', factory: false },
  { id: 'progress', displayName: '后台任务', factory: false },
  { id: 'bridge', displayName: '桥接状态', factory: false },
  { id: 'problems', displayName: '问题计数', factory: false },
  { id: 'branch', displayName: 'Git 分支', factory: true, upstreamId: 'git' },
  { id: 'position', displayName: '光标位置', factory: true, upstreamId: 'Position' },
  { id: 'lineSeparator', displayName: '行分隔符', factory: true, upstreamId: 'LineSeparator', editorBased: true },
  { id: 'encoding', displayName: '文件编码', factory: true, upstreamId: 'Encoding', editorBased: true },
  { id: 'readonly', displayName: '只读', factory: true, upstreamId: 'ReadOnlyAttribute', editorBased: true },
  { id: 'column', displayName: '列选择', factory: true, upstreamId: 'InsertOverwrite', editorBased: true },
  { id: 'indent', displayName: '缩进', factory: true, upstreamId: 'CodeStyleStatusBarWidget', editorBased: true },
  { id: 'notices', displayName: '通知中心', factory: true, upstreamId: 'Notifications' },
  // `VfsRefreshIndicatorWidgetFactory.java:53-59`：显示名取 `status.bar.vfs.refresh.widget.name`
  // （中文包 =「文件系统同步」）、`isEnabledByDefault() = false`（用户要去勾选清单里打开）、
  // 空闲时那个 JLabel 是**空图标**，只在同步期间转起来（`:96-110` 的 start/stop）。
  { id: 'vfsRefresh', displayName: '文件系统同步', factory: true, upstreamId: 'VfsRefresh', enabledByDefault: false },
  { id: 'memory', displayName: '内存', factory: true, upstreamId: 'Memory', enabledByDefault: false },
  { id: 'powerSave', displayName: '省电模式', factory: true, upstreamId: 'PowerSaveMode', enabledByDefault: false },
  // 上游有两个"跟语言服务有关"的组件：`SmartModeIndicator`（默认关、`isInternal = true`，只在内部模式出现）
  // 与 `LanguageServiceStatusBarWidget`（editor-based，默认开）。本仓这条 chip 说的是"当前文件有没有活着的
  // 语言服务"（见 App.vue 的 `smartModeLabel`），是后者；按前者登记会让它默认消失。
  { id: 'smartMode', displayName: '语言服务状态', factory: true, upstreamId: 'LanguageServiceStatusBarWidget', editorBased: true },
]

const BY_ID = new Map(STATUS_WIDGETS.map(widget => [widget.id, widget]))

/** 按 id 反查工厂 —— 上游 `StatusBarWidgetsManager.findWidgetFactory`（`:139`）。 */
export function findWidgetFactory(id: string): StatusBarWidget | undefined {
  return BY_ID.get(id)
}

function loadOverrides(): Record<string, boolean> {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (raw === null) return {}
    const parsed = JSON.parse(raw) as unknown
    // 旧存档是「隐藏键数组」，新存档是 id→覆盖 的映射（上游 `StatusBarWidgetSettings` 的形状）。
    const overrides = Array.isArray(parsed) ? migrateHiddenKeys(parsed) : parsed
    if (overrides === null || typeof overrides !== 'object' || Array.isArray(overrides)) return {}
    const next: Record<string, boolean> = {}
    for (const [id, value] of Object.entries(overrides as Record<string, unknown>)) {
      // 认不出的键（组件已删）丢掉，坏值也丢掉 —— 不猜语义（同上游 `loadState` 的做法）。
      if (BY_ID.has(id) && typeof value === 'boolean') next[id] = value
    }
    return next
  } catch { /* 坏存档 → 全部按默认 */ return {} }
}

/** id → 与默认不同的覆盖（上游 `StatusBarState.widgets`）。 */
export const widgetOverrides = ref<Record<string, boolean>>(loadOverrides())

function persist() {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(widgetOverrides.value)) } catch { /* session-only */ }
}

/** 这个组件此刻该不该画 —— 上游三道闸（`StatusBarWidgetsManager.updateWidget:98-100`）。 */
export function showWidget(id: string): boolean {
  const widget = BY_ID.get(id)
  if (!widget) return false
  return shouldCreateWidget(widget, widgetOverrides.value)
}

/** 勾选清单只列可配置的（上游 `StatusBarActionsManager.getActionsFor` 过滤 `isConfigurable`）。 */
export function listWidgets(): StatusBarWidget[] {
  return configurableFactories(STATUS_WIDGETS) as StatusBarWidget[]
}

/**
 * 勾选项此刻能不能点 —— 上游 `ToggleWidgetAction.update` 在状态栏位置用
 * `canBeEnabledOnStatusBar`（`StatusBarWidgetsActionGroup.kt:104-110`），对 editor-based 工厂
 * 就是「有打开的编辑器」。没编辑器时那一格变灰，而不是让用户点一个点了没反应的开关。
 */
export function widgetClickable(id: string, hasEditor: boolean): boolean {
  const widget = BY_ID.get(id)
  return widget ? widgetToggleEnabled(widget, hasEditor) : false
}

export function widgetChecked(id: string): boolean {
  const widget = BY_ID.get(id)
  return widget ? widgetEnabled(widgetOverrides.value, widget) : false
}

/** 上游 `setEnabled`：切到与默认相同的值时把这条**删掉**（`StatusBarWidgetSettings.kt:32-40`）。 */
export function toggleWidget(id: string) {
  const widget = BY_ID.get(id)
  if (!widget) return
  widgetOverrides.value = withWidgetEnabled(widgetOverrides.value, widget, !widgetChecked(id))
  persist()
}

export function showAllWidgets() {
  widgetOverrides.value = {}
  persist()
}

/**
 * 「显示 <组件名>」这一批**可搜索动作**（上游 `StatusBarWidgetsOptionProvider`）。
 *
 * 上游那一类不是设置页，而是 `SearchTopHitProvider`（`StatusBarWidgetsOptionProvider.kt:13-41`）：
 * 它把每个 `canBeEnabledOnStatusBar` 为真的工厂折成一条 `label.show.status.bar.widget`
 * （`IdeBundle.properties:2402` = 「显示 {0}」，中文包同 key `:1403`）的**搜索命中**，
 * 于是用户在「查找操作 / 随处搜索」里搜组件名就能开关它 —— 与右键勾选那份状态是**同一份**。
 *
 * 本仓的落点就是 `src/menuUi.ts` 的动作索引（查找操作与 SE 的 Commands 档都吃它）。
 * `matcher.matches(name)` 那一句由 `rankCommands` 承担，所以这里只负责"有哪些行、点了做什么"。
 *
 * 可点性用**与右键勾选同一条**判据（`widgetToggleEnabled`，对应上游的 `canBeEnabledOnStatusBar`）——
 * 上游那里过滤用的也是同一个方法，两处不会各判一套。
 */
export interface WidgetToggleRow {
  id: string
  title: string
  keywords: string
  /** 此刻能不能点（editor-based 工厂在没有编辑器时不可开）。 */
  enabled: boolean
  run: () => void
}

/** 上游 `label.show.status.bar.widget` 的中文取值（`localization-zh.jar` 的 `IdeBundle.properties:1403`）。 */
export const SHOW_WIDGET_LABEL = '显示'

export function widgetToggleRows(hasEditor: boolean): WidgetToggleRow[] {
  // 只覆盖 **EP 工厂**（`factory: true`）：上游 `StatusBarWidgetsOptionProvider` 遍历的是
  // `manager.getWidgetFactories()`，而 `file`/`progress`/`bridge`/`problems` 那四条在本仓是
  // "直接画进面板的组件"（上游 `ToolWindowsWidget` / `InfoAndProgressPanel` 那一类），
  // 根本没有工厂，也不会出现在那批搜索命中里。
  return configurableFactories(STATUS_WIDGETS.filter(widget => widget.factory)).map(widget => ({
    id: `statusBar.widget.${widget.id}`,
    title: `${SHOW_WIDGET_LABEL} ${widget.displayName}`,
    keywords: `status bar widget show hide 状态栏 组件 ${widget.displayName} ${widget.upstreamId ?? ''}`.trim(),
    enabled: widgetToggleEnabled(widget, hasEditor),
    run: () => toggleWidget(widget.id),
  }))
}
