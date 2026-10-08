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
//   2. 有三条条目**不是**工厂：`file`/`progress`/`problems`。上游对应物是直接画进状态栏面板的
//      组件（`ToolWindowsWidget` 走 `IdeStatusBarImpl.kt:285-298` 的 leftPanel、`InfoAndProgressPanel`
//      走 `:343` 的 centerPanel），**不经过工厂**。本仓把它们也列进勾选清单是既有行为（用户可隐藏），
//      所以保留，但标成 `factory: false` —— 门控只对 `factory: true` 的条目核上游 id/默认值。
//      原写「有四条：file/progress/bridge/problems」（桶 6b/statusbar）—— 实际 `bridge` 那条是
//      **假控件**，本批已删，留痕如下：
//      · 本仓侧：`src/App.vue` 的状态栏模板只消费 16 个 id（branch/column/encoding/file/indent/
//        lineSeparator/lspServices/memory/notices/position/powerSave/problems/progress/readonly/
//        smartMode/vfsRefresh），没有 `showWidget('bridge')` ⇒ 勾它不改变任何东西（违铁律 §3「不放假控件」）。
//      · 上游侧：`statusBarWidgetFactory` 的全部注册处都没有"桥接状态"这个组件
//        （`platform/platform-impl/resources/intellij.platform.ide.impl.xml:1618-1644` 十五条 id =
//        VfsRefresh/Position/LineSeparator/Encoding/PowerSaveMode/InsertOverwrite/ReadOnlyAttribute/
//        Notifications/FatalError/WriteThread/Memory/EditorAnimationCacheStatistics/SmartModeIndicator/
//        IndexesAndVfsFlushIndicator/settingsEntryPointWidget；全仓 `--include=*.xml` 再搜 bridge 零命中）。
//      同批清掉门禁 `tests/statusbar-popup-motion-parity.test.mjs` 的 KNOWN_GAPS 登记（否则那条
//      "KNOWN_GAPS 不能过期"的反查会红）。用户存档里残留的 `bridge` 覆盖键由 `loadOverrides()`
//      丢弃（认不出的键不猜语义，同上游 `loadState`）。
import { ref } from 'vue'
import { EXTENSIONS, STATUS_BAR_WIDGET_FACTORY_EP, type ExtensionHandle, type RegisterExtensionOptions } from './extensionPoints.ts'
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
 *
 * `displayName` 一律取上游 `getDisplayName()` 那句 bundle 的**中文包取值**（本轮逐条解包核过，
 * 中文包 = `D:\IntelliJ IDEA 2026.2\plugins\localization-zh\lib\localization-zh.jar` 里的
 * `messages/*.properties`，英文原值 = `platform/platform-api/resources/messages/UIBundle.properties`）：
 *   · `Position` `status.bar.position.widget.name` = 「行:列号」（英文 `:183` "Line:Column Number"，
 *     `PositionPanelWidgetFactory.kt:15`）—— 本仓原写「光标位置」是自造说法，已订正；
 *   · `InsertOverwrite` `status.bar.selection.mode.widget.name` = 「编辑器选择模式」（英文 `:186`，
 *     `ColumnSelectionModeWidgetFactory.java:20`）—— 原写「列选择」；
 *   · `ReadOnlyAttribute` `status.bar.read.only.widget.name` = 「只读特性」（英文 `:187`，
 *     `ReadOnlyAttributeWidgetFactory.java:21`）—— 原写「只读」；
 *   · `Notifications` `status.bar.notifications.widget.name` = 「通知」（英文 `:188`，
 *     `NotificationWidgetFactory.java:24`）—— 原写「通知中心」；
 *   · `Memory` `status.bar.memory.usage.widget.name` = 「内存指示器」（英文 `:194`，
 *     `MemoryIndicatorWidgetFactory.java:18`）—— 原写「内存」。
 * 已经在磁盘上就与上游一致的六条本轮复核过，不改：`LineSeparator`「行分隔符」（英文 `:184`）、
 * `Encoding`「文件编码」（`:185`）、`VfsRefresh`「文件系统同步」（`:201`）、
 * `PowerSaveMode`「省电模式」（`InspectionsBundle.properties:327` = "Power Save Mode"）、
 * `CodeStyleStatusBarWidget`「缩进」（英文 `:193` "Indentation"）、git 的「Git 分支」
 * （`plugins/git4idea/shared/resources/messages/GitBundle.properties:994`，`GitBranchWidget.kt:123`）、
 * `LanguageServiceStatusBarWidget`「语言服务」（`LangBundle.properties`，`language.services.widget`）。
 *
 * ⚠ 上游 `NotificationWidgetFactory.isAvailable()`（`:13-15`）那句是
 * `UISettings.hideToolStripes || UISettings.presentationMode` —— 正常档（工具窗口条可见）时那个
 * **状态栏**通知组件根本不该建，通知住在工具窗口条上的通知区（`IdeNotificationArea`）。本仓没有
 * 那条通知区：Event Log 面板是工具窗口的一个内容（`src/components/ToolWindowView.vue:191`），而气球/
 * 弹层那一份用户可见面只有状态栏这条 chip（`App.vue` 的 `NoticeList`）。按上游那句判会让 chip 在默认
 * 配置下消失 = 用户失去唯一的收通知入口，所以这里**登记差异、不照抄该闸**（`available` 保持缺省 true）。
 */
export const STATUS_WIDGETS: StatusBarWidget[] = [
  // 上游已注册、本仓没有的 EP 工厂（逐条核过 `statusBarWidgetFactory` 扩展点下的全部注册处）。
  // 按「本仓形态下该不该有」分类，不是一律补：
  //   · `WriteThread`（`intellij.platform.ide.impl.xml:1635`，`WriteThreadIndicatorWidgetFactory`）：
  //     上游是「有写线程 / 派发更新中」的**性能提示**。本仓没有那条 EDT 派发链，无从触发 ⇒ 不建。
  //   · `EditorAnimationCacheStatistics`（`:1639`）：`@ApiStatus.Internal` 的调试统计 ⇒ 不建。
  //   · `IndexesAndVfsFlushIndicator`（`:1643`）：与本仓的 `smartMode`（`LanguageServiceStatusBarWidget`）
  //     说的是同一件事（"后台还在算"），两个都画会重复 ⇒ 合并进 `smartMode`。
  //   · `settingsEntryPointWidget`（`:1644`，`SettingsEntryPointAction$StatusBarManager`）：齿轮入口。
  //     本仓设置在主工具栏右侧常驻，状态栏再放一个就是重复入口 ⇒ 不建。
  //   · `inspectionProfileWidget`（`intellij.platform.lang.impl.xml:1519`）：inspection 配置档选择器。
  //     本仓没有 inspection 配置档这个概念 ⇒ 不建。
  //   · `largeFileEncodingWidget`（`intellij.platform.lang.impl.xml:1515`）与各 `light.edit.*`
  //     （同文件 `:1608`、git `intellij.vcs.git.backend.xml:944`）：LightEdit 专用，
  //     本仓的大文件模式走编辑器内横幅 ⇒ 不建。
  //   · 非 IDEA 本体插件（数据库 `GridAggregator`/`GridPosition`、`JSONSchemaSelector`、
  //     `McpServerStatusBarWidget`、hg 的三个、vcs-impl 的 `IncomingChanges`）不在本仓范围。
  { id: 'file', displayName: '当前文件', factory: false },
  { id: 'progress', displayName: '后台任务', factory: false },
  { id: 'problems', displayName: '问题计数', factory: false },
  { id: 'branch', displayName: 'Git 分支', factory: true, upstreamId: 'git' },
  { id: 'position', displayName: '行:列号', factory: true, upstreamId: 'Position' },
  { id: 'lineSeparator', displayName: '行分隔符', factory: true, upstreamId: 'LineSeparator', editorBased: true },
  { id: 'encoding', displayName: '文件编码', factory: true, upstreamId: 'Encoding', editorBased: true },
  { id: 'readonly', displayName: '只读特性', factory: true, upstreamId: 'ReadOnlyAttribute', editorBased: true },
  { id: 'column', displayName: '编辑器选择模式', factory: true, upstreamId: 'InsertOverwrite', editorBased: true },
  { id: 'indent', displayName: '缩进', factory: true, upstreamId: 'CodeStyleStatusBarWidget', editorBased: true },
  { id: 'notices', displayName: '通知', factory: true, upstreamId: 'Notifications' },
  // `VfsRefreshIndicatorWidgetFactory.java:53-59`：显示名取 `status.bar.vfs.refresh.widget.name`
  // （中文包 =「文件系统同步」）、`isEnabledByDefault() = false`（用户要去勾选清单里打开）、
  // 空闲时那个 JLabel 是**空图标**（`:100` `EmptyIcon.ICON_16`），只在同步期间换成 `AnimatedIcon.FS`
  // 转起来（`:109-119` 的 start/stop）。上游那整个类是 `@ApiStatus.Internal`（`:27`），组件还
  // `setEnabled(false)`（`:106`）—— 它本来就**不可点**，所以本仓落成一个只读的 span 而不是假按钮。
  { id: 'vfsRefresh', displayName: '文件系统同步', factory: true, upstreamId: 'VfsRefresh', enabledByDefault: false },
  { id: 'memory', displayName: '内存指示器', factory: true, upstreamId: 'Memory', enabledByDefault: false },
  { id: 'powerSave', displayName: '省电模式', factory: true, upstreamId: 'PowerSaveMode', enabledByDefault: false },
  // 上游有两个"跟语言服务有关"的组件：`SmartModeIndicator`（默认关、`isInternal = true`，只在内部模式出现）
  // 与 `LanguageServiceStatusBarWidget`（editor-based，默认开）。本仓这条 chip 说的是"当前文件有没有活着的
  // 语言服务"（见 App.vue 的 `smartModeLabel`），是后者；按前者登记会让它默认消失。
  { id: 'smartMode', displayName: '语言服务状态', factory: true, upstreamId: 'LanguageServiceStatusBarWidget', editorBased: true },
  // 桶 3b W3 落的那颗真 `lsWidget`：每台语言服务一条 + 分「正在当前文件/其他文件」两段 + 停止/重启动作
  // （`platform/lang-impl/resources/intellij.platform.lang.impl.xml:1509-1511` 注册的
  // `LanguageServiceWidgetFactory`，`getId()` = `LanguageServiceStatusBarWidget`，
  // `getDisplayName()` = `LangBundle.properties:604` `language.services.widget` = 「语言服务」）。
  // 注意：上面那条 `smartMode` 也登记着同一个 upstreamId（桶 6 当时的取舍，被
  // `tests/status-bar-widgets.test.mjs:112,117` 钉住，本轮不放松）⇒ 两条的归因重叠已如实报给测试属主。
  { id: 'lspServices', displayName: '语言服务', factory: true, upstreamId: 'LanguageServiceStatusBarWidget', editorBased: true },
]

const BY_ID = new Map(STATUS_WIDGETS.map(widget => [widget.id, widget]))

/** 按 id 反查工厂 —— 上游 `StatusBarWidgetsManager.findWidgetFactory`（`:149`；`:139` 是另一条按 id 查已建组件的 `wasWidgetCreated`）。 */
export function findWidgetFactory(id: string): StatusBarWidget | undefined {
  return BY_ID.get(id)
}

/** 把 EP（`com.intellij.statusBarWidgetFactory`）里的工厂收编进本表，返回新收编的条数。 */
function adoptFromExtensions(): number {
  let added = 0
  for (const widget of EXTENSIONS.extensionsOf<StatusBarWidget>(STATUS_BAR_WIDGET_FACTORY_EP)) {
    if (!widget || typeof widget.id !== 'string' || !widget.id) continue
    if (BY_ID.has(widget.id)) continue
    STATUS_WIDGETS.push(widget)
    BY_ID.set(widget.id, widget)
    added += 1
  }
  return added
}

/**
 * 第三方（或测试）按上游同名的 EP id 挂一个状态栏部件工厂。
 *
 * 上游口径：`StatusBarWidgetFactory` 挂在 `com.intellij.statusBarWidgetFactory`
 * （`platform/platform-api/resources/intellij.platform.ide.xml:98`，接口
 * `com.intellij.openapi.wm.StatusBarWidgetFactory`），`StatusBarWidgetsManager` 遍历
 * `getWidgetFactories()`（`StatusBarWidgetsManager.kt:96` 的 `updateWidget`）。
 * 本仓的等价物：注册进 EP + 立刻收编进本表 —— 于是它出现在状态栏右键的勾选清单
 * （`listWidgets()`）与「显示 <组件名>」那批可搜索动作（`widgetToggleRows()`）里，
 * 可见性与持久化走同一套 `widgetEnabled`。
 *
 * 渲染那一半仍是静态的：App.vue 的状态栏模板按 id 逐条写死（每个组件的 DOM 各不相同）——
 * 上游的 `StatusBarWidget.getComponent()` 在这里没有等价物，见 `docs/ui-parity-checklist.md`。
 */
export function registerStatusWidgetFactory(
  widget: StatusBarWidget,
  options: RegisterExtensionOptions = {},
): ExtensionHandle {
  const handle = EXTENSIONS.registerExtension(STATUS_BAR_WIDGET_FACTORY_EP, widget.id, widget, options)
  adoptFromExtensions()
  return handle
}

/** 已挂成 EP 贡献的内置工厂（模块加载时登记；第三方按同一 id 追加）。 */
for (const widget of STATUS_WIDGETS) {
  EXTENSIONS.registerExtension(STATUS_BAR_WIDGET_FACTORY_EP, widget.id, widget, { source: 'bundled' })
}
adoptFromExtensions()
// EP 内容变化时立刻收编（上游 `ExtensionPointListener` 同口径）—— 第三方注册后无需再手动调 adopt。
EXTENSIONS.addListener(extensionPoint => {
  if (extensionPoint === STATUS_BAR_WIDGET_FACTORY_EP) adoptFromExtensions()
})

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

/** 这个组件此刻该不该画 —— 上游三道闸（`StatusBarWidgetsManager.updateWidget`，函数 `:96`、闸 `:97-99`）。 */
export function showWidget(id: string): boolean {
  const widget = BY_ID.get(id)
  if (!widget) return false
  return shouldCreateWidget(widget, widgetOverrides.value)
}

/** 勾选清单只列可配置的（上游 `StatusBarActionManager.getActionsFor`，`StatusBarWidgetsActionGroup.kt:208-211`，过滤那一句在 `:210`）。 */
export function listWidgets(): StatusBarWidget[] {
  return configurableFactories(STATUS_WIDGETS) as StatusBarWidget[]
}

/**
 * 勾选项此刻能不能点 —— 上游 `ToggleWidgetAction.update` 在状态栏位置用
 * `canBeEnabledOnStatusBar`（调用 `StatusBarWidgetsActionGroup.kt:116-117`，判据本体 `StatusBarWidgetsManager.kt:176-181`），对 editor-based 工厂
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
 * 本仓的落点就是 `src/menuUi.ts` 的动作索引（查找操作与 SE 的 Actions 档都吃它）。
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
  // `manager.getWidgetFactories()`，而 `file`/`progress`/`problems` 那三条在本仓是
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
