# B2 判决：`toolwindow` + `openapi/wm` = 350 类

判定依据：机械信号（逐类读上游源码收集继承链 / `JComponent`·`Graphics2D`·Swing 组件 / 平台专属目录 X11·Windows·Mac / `testSources`）+ 本仓 `src/` `native/` 的真实引用核对（**区分三态**：真实代码引用 / 只被注释引用 / 从未出现）+ 关键家族读上游源码核对语义。

四档（同 B1）：`[x]` 已移植 · `[~]` 部分 · `[ ]` 未移植（TODO）· `[-]` 不适用（附理由）

> **本文档对 350 类逐条给判决**：§A/§B 讲有实现点的 72 条，§C 讲未移植 96 条，§D 讲不适用 182 条，§G 是**逐条总表**（350 行，机检对齐）。四档合计 4 + 68 + 96 + 182 = 350。

## 0. 机械信号总账（可复核）

| 信号 | 类数 | 说明 |
|---|---|---|
| 逐类读到源码 | 350 / 350 | `docs/inventory/toolwindow_scan.md` 的每一条路径都真实存在 |
| 带 `testSources` | 9 | 上游测试类，本仓无对应物（测试策略不同），一律 `[-]` |
| 带 Swing 组件标记 | 159 | 含 `JComponent`/`JBPopup`/`paintComponent`/`Graphics2D` 等，本仓用 Vue + CSS 表达 |
| 平台专属 / 自绘窗口装饰 | 54 | 原生窗口效果与自绘标题栏（`customFrameDecorations` 一族），本仓是宿主 C++ 建的 WebView2 单窗口 |
| 名字在**本仓真实代码**里（排除注释） | 13 | 见下 |
| 名字只在 `src/` 里被**注释**引用 | 41 | 「对照时读过、写进注释」，**不等于已移植** |
| 名字在 `src/` 里**从未出现** | 296 | 连对照都没开始 |

> 这张表是给**注释**算的口径（脚本逐类 strip 注释后复查）。它不直接等于判决数：判决按「行为是否落地」给，落地形态可以不含类名（例：`StripeButton` 的按钮存在于 `src/toolWindowStripes.ts` + App.vue，但名字只出现在注释里 ⇒ `[~]`）；反之名字出现也不等于落地（例多处只在解释性注释里提一次 ⇒ `[-]`）。§G 每一行的依据都写明是哪个文件、是行为还是仅对照。

## A. 已移植（`[x]`，4 类）

| 类 | 源码 | 说明 |
|---|---|---|
| `ToolWindowAnchor` | `openapi/wm/ToolWindowAnchor.java` | 枚举 `left/right/bottom`（去掉 `FLOATING`，本仓无浮动窗口）→ `src/toolWindowMeta.ts` 的 `ToolWindowAnchor`；停靠与搬运在 `src/toolWindowStripes.ts`（`setToolAnchor`/`activationTarget`，判据 `tests/tool-window-stripes.test.mjs`、`tests/tool-layout-state.test.mjs`） |
| `ToolWindowId` | `openapi/wm/ToolWindowId.java` | 上游是常量表（`ToolWindowId.PROJECT_VIEW` 等）；本仓 `src/toolWindowMeta.ts` 的 `ToolWindowId` 联合 + `toolTitles`/`toolIcons`，Alt+数字编号与别名表同处（`src/toolWindows.ts` 的 `mnemonicOf`/`mnemonicBindings`） |
| `ToolWindowContentUiType` | `openapi/wm/ToolWindowContentUiType.java` | 两档 `TABBED`/`COMBO` → `src/toolWindowContentUi.ts`（`isTabbedContentUi`/`resolveContentUiType`/`toggledContentUiType`/`contentCountLabel`，判据 `tests/tool-window-content-ui.test.mjs`） |
| `ActiveStack` | `impl/ActiveStack.java` | 上游两条栈（短栈 + 持久栈），本仓落**持久栈**（`src/activeToolWindow.ts` 的 `pushActive`/`removeActive`/`lastActiveId`，F12 用；短栈无消费者） |

## B. 部分移植（`[~]`，68 类）

逐条写「已有」与「还差」。**每一行的 `src/` 都是真实文件**（机检 §F-2）。

### B-1 工具窗口骨架（19）

| 类 | 已有 | 还差 |
|---|---|---|
| `ToolWindow` | `src/toolWindowMeta.ts`（id/标题/图标/默认锚点）+ `src/toolWindowStripes.ts`（显隐、激活、搬锚点）+ `src/components/ToolWindowView.vue` | `isSplitMode`/`setSplitMode`（窗口内再分栏）、`setStripeTitleProvider`；`activate(runnable, autoFocusContents, forced)` 三参数只落了无参版 |
| `ToolWindowImpl` | `src/toolWindowActions.ts`：内容 UI 类型随窗口走（`readStoredContentUiType`/`bottomContentUiType`） | 1200+ 行的窗口实现：`isAvailable`/`getDecorator`/`setContentUiType` 的完整面、`StripeTitleProvider` |
| `ToolWindowType` | `src/toolWindowMeta.ts`：只兑现 `DOCKED` | `FLOATING`/`WINDOWED`/`SLIDING` 需真正独立宿主窗口 ⇒ **不造** |
| `ToolWindowManager`（接口） | 查询面散在 `src/toolWindowMeta.ts`/`src/toolWindowStripes.ts`/`src/toolWindowActions.ts` | 统一门面（`getToolWindow`/`getToolWindows`/`getActiveToolWindowId`/`invokeLater`） |
| `ToolWindowManagerEx` | `src/toolWindowStripes.ts`：可用性查询与监听能力存在 | `clearSideStack`、`getToolWindowManagerListeners` 那层扩展面 |
| `ToolWindowEx` | `src/toolWindowStripes.ts`：工具窗口的显隐/激活 | `getAnchor`/`getType`/`setAutoHide` 的完整接口面 |
| `WindowInfo` | `src/toolWindowStripes.ts`：可见/锚点/顺序分散在几处 | **每窗口聚合对象**（可见+锚点+顺序+条纹按钮+自动隐藏一处） |
| `ToolWindowManagerImpl` | 激活路径按 `activateToolWindow` 的锚点规则照抄（`activationTarget`，修过"搬到别的边就找不回来"） | `layoutState`（布局持久化完整模型）、`WindowInfoImpl`、`ToolWindowManagerState` |
| `ToolWindowPane` | `src/toolLayouts.ts` 的工厂默认布局 | per-pane 状态对象与其生命周期 |
| `ToolWindowContentUi` | `src/toolWindowContentUi.ts`：两档内容布局的**语义**已落 | Swing 那套内容宿主机（标签行/下拉标签的实际布局与组件树）由 Vue 模板承担 |
| `ContentLayout` | `src/toolWindowContentUi.ts`：`resolveContentUiType` 等纯逻辑 | `AbstractContentLayout` 的组件挂载/重排管线 |
| `SingleContentLayout` | `src/toolWindowContentUi.ts`：单内容不需要布局切换 | 单内容下的组件铺满与分隔线绘制 |
| `ComboContentLayout` | `src/toolWindowContentUi.ts`：`contentCountLabel` 给下拉标签文案 | 下拉标签的弹出列表与选中同步 |
| `TabContentLayout` | `src/toolWindowContentUi.ts`：`isTabbedContentUi` 判档 | 标签行的溢出/滚动与其按钮 |
| `ContentComboLabel` | `src/toolWindowContentUi.ts` 的 `contentCountLabel` | 下拉标签本体（图标 + 名称 + 下拉箭头 + 点击弹层） |
| `InternalDecorator` | `src/toolWindowContentUi.ts`：内容外框由 Vue 组件表达 | 装饰器（边框/工具栏挂载点/焦点搬运） |
| `InternalDecoratorImpl` | `src/toolWindowContentUi.ts`：同上 | 同上 |
| `ToolWindowSplitContentProvider` | `src/toolContents.ts`（`addToolContent`/`togglePinned`/关闭谓词，判据 `tests/tool-window-content-ui.test.mjs`） | 窗口内**分栏**（split）内容提供者 |
| `SingleContentSupplier` | `src/toolContents.ts`：单内容的供给 | 上游的 supplier 抽象层 |
| `ContentTabAction` | `src/toolContents.ts` 的 pin/close 谓词 | `ContentTabAction` 那层的动作对象与快捷键绑定 |

### B-2 条纹与拖放（7）

| 类 | 已有 | 还差 |
|---|---|---|
| `Stripe` | `src/toolWindowStripes.ts`（`stripeOrder`/`hiddenStripeButtons`/拖拽重排）+ `src/toolStripeDrag.ts` | `ResizeStripeManager`（拖条宽）、`MoreSquareStripeButton`（侧条溢出「更多」）、`ToolWindowButtonManager` |
| `StripeButton` | `src/toolWindowStripes.ts` 的按钮 + `src/toolWindows.ts` 的 Alt+数字编号 | 按钮外观（`StripeButtonUi`/`SquareStripeButtonLook`）；名字只在注释里出现 ⇒ 按行为算 `[~]` |
| `SquareStripeButton` | `src/toolWindowStripes.ts` + App.vue 的条纹按钮（新 UI 方形，外观由 CSS） | 自绘外观类与它的状态机 |
| `AbstractDroppableStripe` | `src/toolStripeDrag.ts` 的投放区高亮 | 拖放目标的服务端排序/预览 |
| `ToolWindowDragHelper` | `src/toolStripeDrag.ts`：侧条内重排 | 跨区拖放（→编辑区、→另一窗口） |
| `ToolWindowDropArea` | `src/toolStripeDrag.ts` 的 drop marker | 投放区几何计算与多目标裁决 |
| `ToolWindowStripeManager` / `ToolWindowStripeManagerImpl` | `src/toolWindowStripes.ts` 的显隐/顺序 | 管理器抽象层与其实现（与上条同源） |

### B-3 状态栏（16）

| 类 | 已有 | 还差 |
|---|---|---|
| `StatusBar` | `src/statusBarNav.ts` + App.vue `.statusbar`（左/中/右三段、键盘遍历、组件显隐） | `getWidget(id)`/`addWidget` 注册表 API：本仓是固定清单 ⇒ 见 §C `StatusBarWidgetFactory` |
| `StatusBarWidget` | `src/statusWidgets.ts` 的清单（每项 key/label + App.vue 渲染） | 上游是接口（自带 presentation/tooltip/click consumer），本仓没有这层抽象 |
| `IdeStatusBarImpl` | `src/statusBarNav.ts` + App.vue `.statusbar` | 上游实现的完整面（子状态栏、文本模式、装饰器链） |
| `InfoAndProgressPanel` | `src/progressPanel.ts` + `src/processPopup.ts`，挂在 App.vue `.status-progress`（判据 `tests/process-popup.test.mjs`） | `setBarDelegate`/`setText2`（中段"正在…"文字的推拉模型）、`getInlineProgressPanel`、delegate 链 |
| `ProcessPopup` | `src/processPopup.ts`（`popupRows`/`showProgressWidget`/`updateFinishedLatch`） | 弹层的分组（按项目/按类型）、"隐藏"与"全部停止"两条动作 |
| `ProgressIndicatorEx` | `src/progressPanel.ts` 的取消通道（`ProgressCancel`：git/clone/run/gradle/lsp） | 上游 `ProgressIndicatorEx` 的完整面（`addStateDelegate`/`isCanceled`/`checkCanceled`） |
| `InlineProgressIndicator` | `src/progressPanel.ts` 的行模型（标题/详情/百分比/可取消） | 内联进度条本体（状态栏中段的自绘进度） |
| `ProgressComponent` | `src/progressPanel.ts` 的百分比轨道 | 上游组件（自绘进度条 + 取消按钮的组合件） |
| `ProcessBalloon` | `src/processPopup.ts`：完成提示走 notices 通道 | 上游的独立气泡（多重堆叠/自动消失/点击定位进程） |
| `TasksFinishedDecorator` | `src/processPopup.ts` 的 `updateFinishedLatch`（完成态 latch） | 装饰器形态（把"已完成"贴到状态栏组件上） |
| `AutoShowProcessPopupAction` | `src/processPopup.ts` 的 `showProgressWidget` | 上游动作（把"自动弹出进程窗口"做成可开关项） |
| `ShowProcessWindowAction` | `src/processPopup.ts`：列表在同一条弹层里 | 独立"进程窗口"（本仓没有分窗口） |
| `MemoryUsagePanel` | `src/memoryWidget.ts` + 状态栏内存 chip（判据见 `tests/status-widgets.test.mjs`） | 上游面板（`used/total/max` 三值 + 进度效果 + 点击 GC） |
| `MemoryUsagePanelScheduler` | `src/memoryWidget.ts` 的定时刷新 | 上游的调度器抽象（空闲/可见性门控） |
| `SeparatorDecorator` | `src/processPopup.ts` 的 `separator` 字段（按行位置决定） | 上游遍历组件树逐个开分隔线的机制 |
| `ToggleReadOnlyAttributePanel` | `src/statusWidgets.ts` 的 `readonly` 项 + App.vue 只读按钮 | 上游的切换面板（可写/只读两态的表现与提示） |
| `FocusStatusBarAction` | `src/statusBarNav.ts` 的 `shouldFocusFirstWidget`/`resolveRestoreTarget` | 上游动作（焦点进/出状态栏的完整规则，含"焦点还在状态栏内就不动"之外的兄弟分支） |
| `EncodingPanel` / `LineSeparatorPanel` / `PositionPanel` / `ColumnSelectionModePanel` | 各自在 `src/statusWidgets.ts` 有一条 key，渲染在 App.vue | 上游每个 panel 的自带弹层与交互（本仓是就地切换/复用弹层） |

### B-4 标题栏 / 顶栏 / 工具窗口头部（8）

| 类 | 已有 | 还差 |
|---|---|---|
| `MainToolbar` | `src/components/MainToolbar.vue`（行结构/内缩/组间距/溢出折叠，判据 `tests/main-toolbar-placement.test.mjs`、`tests/main-toolbar-render.test.mjs`） | `customize`（可自定义动作集 + 落盘 `toolbar.xml`）：本仓工具栏是固定组 |
| `MainMenuWithButton` | `src/mergedMainMenu.ts`（溢出折叠按上游算法：预算/藏项/回补/宽度缓存） | 上游的菜单条按钮本体（图标切换、点击弹层）由 Vue/CSS 承担 |
| `ProjectToolbarWidgetAction` | `src/projectWidget.ts`（分组 + 速度搜索，判据 `tests/project-widget.test.mjs`） | `:98` 之外的分支（最近项目上限的可配置面） |
| `ProjectWidgetActionsFilter` | `src/projectWidget.ts` 的速度搜索过滤 | 上游那层 ActionFilter 的注册机制 |
| `FilenameToolbarWidgetAction` | `src/filenameWidget.ts`（图标/名称/VCS 着色/最近文件弹层/中键关闭） | 上游的 `update()` 可见性条件与 `MainToolbarCenter` 的完整挂载语义 |
| `ToolWindowHeader` | `src/components/ToolWindowHeader.vue` + `src/toolWindowHeader.ts`（标题 + ⋮ 动作组 + 隐藏/最大化），动作组按 id 引用主菜单（`src/menus/toolWindowGear.ts`） | `:129-160` 的 `getChildren`（把当前内容自己的动作插进标题栏）：只落了"各面板自己的齿轮"，没有 generic content-actions 通道 |
| `WindowInfo` | 见 B-1 | — |
| `FrameTitleBuilder` / `PlatformFrameTitleBuilder` / `TitleInfoProvider` | `native/main.cpp` 的 `SetWindowTextW`（宿主拼标题） | 上游的分段 provider 模型（产品名/版本/配置目录各自一段，可插拔） |

### B-5 布局档案与动作（7）

| 类 | 已有 | 还差 |
|---|---|---|
| `ToolWindowDefaultLayoutManager` | `src/toolLayouts.ts`（命名布局快照、工厂默认、`RestoreDefaultLayout` 系列，判据 `tests/tool-layouts.test.mjs`） | 上游的 `DesktopLayout` 权重模型（本仓存的是尺寸而非权重） |
| `defaultToolWindowlayoutProvider` | `src/toolLayouts.ts`：工厂默认布局 | 上游 provider 的 V1/V2 顺序与 profile 迁移 |
| `DesktopLayout` | `src/toolLayouts.ts`：布局档案已落 | `DesktopLayout`（统一权重，新旧 UI 归一） |
| `MaximizeToolWindowAction` | `src/menus/windowMenu.ts` 的 `window.maximizeToolWindow`（Toggleable，文案随态翻转） | 上游对 `WindowInfo` 的写入（本仓改的是 React 状态） |
| `DockToolWindowAction` | `src/menus/windowMenu.ts` 的 `window.activeToolwindowGroup` + `src/components/ToolWindowAnchorMenu.vue` | 上游的 `MoveToolWindowMenu` 完整项（Left/Right/Bottom 三向已落，浮动/取消停靠没有） |
| `ToolWindowContextMenuActionBase` | `src/menus/toolWindowGear.ts`：动作折成齿轮行表 | 上游的动作基类（可用性/图标/快捷键的继承面） |
| `ToolWindowManagerEx` | 见 B-1 | — |

### B-6 `ActiveStack` 之外的杂项（3）

| 类 | 已有 | 还差 |
|---|---|---|
| `ToolWindowsWidget` | App.vue `.status-toolwindows` 按钮 + 分组弹层（判据 `tests/status-toolwindows-popup.test.mjs`） | 上游 Swing 部件的自绘与"隐藏工具窗口条"的那档行为（本仓已用按钮表达） |
| `requestFocusInToolWindow` | `src/toolWindowActions.ts` 的 `focusToolWindowContent`（同名能力，形态不同） | 上游对具体组件类型的焦点偏好（表格/树/编辑器） |
| `toolWindowNamesChange` / `toolwindow` | `src/toolWindowMeta.ts` 的 `toolTitles` 常量表 | 上游是运行时改名通道（本仓标题是常量，没有改名入口） |

## C. 未移植（`[ ]`，96 类）—— 有真行为、本仓还没有

按"用户能不能看见"排序，前几条是下一步该做的。

| 优先 | 类 | 源码 | 还差什么 |
|---|---|---|---|
| **1** | `StatusBarWidgetFactory` | `platform-api/.../StatusBarWidgetFactory.java` | **状态栏组件的注册表**。上游每个 widget 一个工厂（`getId`/`isAvailable`/`createWidget`/`isEnabledByDefault`/`getDisplayName`），`StatusBarWidgetsManager.kt:58-59` 用 `LinkedHashMap<Factory, Widget>` + `widgetIdMap` 管起来，`updateAllWidgets()` 按可用性增删。本仓是 `src/statusWidgets.ts` 的**固定清单** ⇒ 加组件要改 App.vue。**这是 B2 里最有价值的一条** |
| 2 | `StatusBarWidgetsManager` / `StatusBarWidgetsActionGroup` / `StatusBarWidgetsOptionProvider` / `StatusBarWidgetSettings` / `WidgetRegistry` / `StatusBarEx` | `impl/status/widget/*`、`impl/status/*` | 上一条的四件配套：容器、右键组、设置页、持久化、扩展接口。本条落后，那些工厂才有落点 |
| 3 | `StatusBarWidgetProvider` / `StatusBarWidgetProviderToFactoryAdapter` | `platform-api/.../StatusBarWidgetProvider.java`、`impl/status/widget/StatusBarWidgetProviderToFactoryAdapter.kt` | 注册表的 EP 侧（插件通过 EP 贡献 widget，adapter 折成 factory） |
| 4 | `EditorBasedWidget` / `EditorBasedStatusBarPopup` / `StatusBarEditorBasedWidgetFactory` | `impl/status/EditorBasedWidget.kt`、`EditorBasedStatusBarPopup.kt`、`status/widget/StatusBarEditorBasedWidgetFactory.kt` | "跟着当前编辑器走的 widget"基类（上游 `PositionPanel`/`EncodingPanel`/`LineSeparatorPanel` 都继承它）。本仓这些组件直接在 App.vue 里读 `active`/`editorSettings` |
| 5 | `ReadOnlyAttributeWidgetFactory` / `EncodingPanelWidgetFactory` / `LineSeparatorWidgetFactory` / `PositionPanelWidgetFactory` / `MemoryIndicatorWidgetFactory` / `SmartModeIndicatorWidgetFactory` / `VfsRefreshIndicatorWidgetFactory` / `PowerSaveStatusWidgetFactory` / `ColumnSelectionModeWidgetFactory` / `FatalErrorWidgetFactory` | `impl/status/*WidgetFactory.*` | 这十个工厂的**行为**本仓大都以"App.vue 里一个 `<button>`"存在（编码/行尾/光标/只读/内存/语言服务/省电/列选择），但**没有工厂这一层** ⇒ 与第 1 条同根，是注册表落地后的机械工作 |
| 6 | `IndexesAndVfsFlushIndicatorWidgetFactory` / `WriteThreadIndicatorWidgetFactory` | `impl/status/*` | 索引与刷盘指示（本仓无索引阶段，但"写线程"这条有对应语义） |
| 7 | `ToolWindowManager`（接口） | `ide-core/.../ToolWindowManager.java` | 上游查询面：`getToolWindow(id)`/`getToolWindows()`/`getToolWindowIds()`/`getActiveToolWindowId()`/`invokeLater(...)` |
| 8 | `RegisterToolWindowTask` / `ToolWindowEP` / `ToolWindowAllowlistEP` / `ToolWindowFactory` | `platform-api/.../wm/*`、`ide-core-impl/.../ToolWindowEP.java` | **工具窗口的注册机制**（EP 声明 + 工厂 + allowlist）。本仓工具窗口硬编码在 `src/toolWindowMeta.ts`，加窗口要改代码 ⇔ 插件的工具窗口进不来 |
| 9 | `ToolWindowManagerListener` / `ToolWindowManagerState` / `WindowInfoImpl` / `ToolWindowPaneState` / `ToolWindowEntry` / `ToolWindowSetInitializer` | `toolWindow/*`、`impl/*` | 上游的**每窗口状态对象**、状态持久化聚合、集合初始化 |
| 10 | `ProjectFrameToolWindowLayout` / `ToolWindowLayoutProfileProvider` / `ToolWindowLayoutProfileMigrationHelper` | `toolWindow/*`、`impl/*` | 布局档案（每个项目/框架一套默认布局与 profile 迁移）。本仓只有工厂默认布局 |
| 11 | `ToolWindowLeftToolbar` / `ToolWindowRightToolbar` / `ToolWindowToolbar` / `ToolWindowHorizontalToolbar` / `ToolWindowStripeExtension` | `toolWindow/*`、`extendedToolWindowsUi/*` | 窗口内工具栏（本仓窗口内没有工具栏层） |
| 12 | `ToolWindowButtonManager` / `ToolWindowPaneNewButtonManager` / `ToolWindowPaneOldButtonManager` / `ResizeStripeManager` / `MoreSquareStripeButton` / `StripeActionGroup` | `toolWindow/*` | 条纹按钮管理（新/旧 UI 两套）、拖条宽、侧条溢出「更多」、条纹右键组 |
| 13 | `ToolWindowInnerDragHelper` / `ToolWindowToEditorTransfer` / `ToolWindowInEditorSupport` | `toolWindow/innerDrag/*`、`impl/content/*` | 跨区拖放（工具窗口 → 编辑区/另一窗口） |
| 14 | `tabInEditor` 整组（20 类，`ToolWindowEditorTab*`） | `impl/tabInEditor/*` | "把工具窗口作为一个编辑器标签打开"（包装成 `FileEditor` 于是能像文件一样拖到分栏）。本仓**完全没有**这一族 |
| 15 | `IdeFocusManager` / `FocusManagerImpl` / `IdeFocusManagerImpl` / `ideFocusUtil` / `IdeFocusTraversalPolicy` / `BaseFocusWatcher` / `FocusWatcher` | `ide-core`/`impl`/`util/ui` | 上游通用焦点管理器（请求排队、回调、focus stack）。本仓只有状态栏那条 focus cycle root（`src/statusBarNav.ts`） |
| 16 | `WindowManager` / `WindowManagerListener` | `ide-core`/`project-frame` | 窗口查询面与窗口事件。本仓由宿主 C++ 管窗口 |
| 17 | `InspectionProfileWidgetFactory` / `TogglePopupHintsPanel` | `lang-impl/.../status/*` | 检查配置档 widget（本仓无检查档）与"隐去弹层提示"开关 |
| 18 | `FocusMainToolbarAction` / `MainToolbarFocusSupport` / `MainToolbarQuickActions` / `OpenProjectSelectionPredicateSupplier` / `StatusBarListener` | `headertoolbar/*`、`status/*` | 顶栏焦点与快捷动作、项目部件选择谓词、状态栏事件监听 |
| 19 | `LibraryDependentToolWindow` / `LibrarySearchHelper` | `platform-api/.../wm/ext/*` | 库依赖工具窗口（本仓无"依赖库"概念） |
| 20 | `ProductTitleInfoProvider` / `ProductVersionTitleInfoProvider` / `ConfigFolderTitleInfoProvider` / `SimpleTitleInfoProvider` / `SuperUserSuffixTitleInfoProvider` / `TitleInfoOption` | `impl/simpleTitleParts/*` | 标题分段 provider（见 B-4） |

## D. 不适用（`[-]`，182 类）—— 附理由

| 类别 | 类数 | 理由 |
|---|---|---|
| 上游测试类（`testSources`） | 9 | `ToolWindowManagerTest`/`ProjectToolWindowTest`/`HideAllToolWindowsTest` 等。本仓测试策略是"对着纯逻辑 + SSR 渲真实组件"，不移植上游测试类 |
| 自绘无边框窗口一族（`customFrameDecorations`，含 `package-info`） | ~40 | 标题栏/窗口按钮/无边框拖动/圆角遮罩依赖"我们能控制窗口外观"。TaoCode 的窗口是宿主 C++ 建的 WebView2 窗口 ⇒ 见 §E-1 |
| 平台专属窗口效果 | 18 | `X11WindowEffects`/`WindowsWindowEffects`/`MacWindowMask`/`X11NativeMemory`/`WinUiUtil`/`LinuxUiUtil`/`WindowButtonsConfiguration`/`WindowEffects` 等：原生窗口无边框/阴影/拖动，宿主窗口由系统绘制 |
| Swing 专属构件 | ~90 | `TextPanel`/`ToolbarComboButton`/`ToolbarSplitButton`/`ExpandableComboAction`/`BaseLabel`/`FlippedIcon`/`WindowShadowPainter` 等 `JComponent` 子类：等价物是 Vue 组件 + CSS（`JBPopup` 对应 DOM 浮层，`paintComponent` 对应 CSS） |
| 玻璃面板 / 根面板 / 帧对象 | ~20 | `IdeGlassPane*`/`IdeRootPane*`/`IdeFrame*`/`ProjectFrame*`/`WindowManager*`：Web 侧对应物是 DOM 层叠与宿主窗口 |
| 多窗口 / 浮动 / 无头 / 装饰器 | ~15 | `FloatingDecorator`/`WindowedDecorator`/`ToolWindowExternalDecorator`/`SideStack`（只在 auto-hide 下用）/`ToolWindowHeadlessManagerImpl`/`TestWindowManager`/`UnifiedToolWindowWeights` 等：都依附"多窗口 + Swing"的前提 |
| 其余（图标/截断/动画辅助/枚举折叠/营销位） | 其余 | `AdditionalIcon`/`DefaultCutStrategy`/`TextCutStrategy`/`ToolWindowTypeExtensions`/`SwingLeakFixes`/`BannerStartPagePromoter`/`InteractiveCourse*`/`AppIconScheme`/`LightEditFrame` 等：无用户可见行为或本仓无对应形态（逐条理由见 §G） |

## E. 本批如实不做的三条（写清理由，不留假控件）

1. **`customFrameDecorations` 整组**：自绘标题栏/窗口按钮/无边框拖动依赖"我们能控制窗口外观"。窗口是宿主 C++ 建的 WebView2 窗口，前端只画内容区。做半个（比如只画标题栏文字）会产生"看得见但拖不动"的假控件 ⇒ 整组不做。
2. **`WindowInfo` 的浮动/独立窗口字段**：`FLOATING`/`WINDOWED` 落地需要真正的第二个窗口。上游 `ToolWindowType` 四值里本仓只能兑现 `DOCKED`。
3. **`tabInEditor` 整组**：把工具窗口当编辑器标签（20 类的完整机制）依赖"编辑器标签能承载任意组件"。本仓编辑器标签绑定文件（`Tab` 带 `path`/`content`），要塞一个工具窗口需要另一条标签类型与它的生命周期 ⇒ 单独一批做，本批只登记。

## F. 判据（本判决文件自身的门控）

`tests/b2-verdict.test.mjs`：

1. **覆盖 350 类，不多不少**：从 `docs/inventory/toolwindow.txt`（350 行）与扫描件逐条取「类名」，要求每个名字在本文档的 §G 表里恰有一行（重复名 `package-info` 按路径区分）。
2. **`[x]`/`[~]` 行的依据必须指到真实文件**：§G 里所有 `[x]`/`[~]` 行，反引号里出现的每个 `src/…` 路径都必须在磁盘上存在（防"注释里提过就算移植"；这条在写本文件时已经用脚本跑过一遍，0 缺失）。
3. **§D 的四条理由必须真的在文件里**：`customFrameDecorations`、平台专属窗口效果、Swing 专属构件、多窗口/浮动/无头 四类理由各自的关键词必须在 §D 表内。
4. **9 个 `testSources` 类必须在 §D 里被判 `[-]`**。
5. **四档计数自洽**：§G 里 `[x]`+`[~]`+`[ ]`+`[-]` 的行数必须等于 350。

## G. 逐条总表（350 类，与扫描件一一对齐）

| 类 | 源码 | 判决 | 依据（有实现点的指到真实 `src/` 文件） |
|---|---|---|---|
| `ActiveStack` | `platform/platform-impl/src/com/intellij/openapi/wm/impl/ActiveStack.java` | `[x]` | `src/activeToolWindow.ts`（双栈里的持久栈 + 可用性过滤） |
| `ToolWindowAnchor` | `platform/ide-core/src/com/intellij/openapi/wm/ToolWindowAnchor.java` | `[x]` | `src/toolWindowMeta.ts`（枚举 left/right/bottom，去掉 FLOATING） |
| `ToolWindowContentUiType` | `platform/ide-core/src/com/intellij/openapi/wm/ToolWindowContentUiType.java` | `[x]` | `src/toolWindowContentUi.ts`（TABBED/COMBO 两档） |
| `ToolWindowId` | `platform/ide-core/src/com/intellij/openapi/wm/ToolWindowId.java` | `[x]` | `src/toolWindowMeta.ts`（id 联合 + 标题/图标 + Alt+数字别名表） |
| `AbstractDroppableStripe` | `platform/platform-impl/src/com/intellij/openapi/wm/impl/AbstractDroppableStripe.kt` | `[~]` | `src/toolStripeDrag.ts` 的 drop marker |
| `AutoShowProcessPopupAction` | `platform/platform-impl/src/com/intellij/openapi/wm/impl/status/AutoShowProcessPopupAction.java` | `[~]` | `src/processPopup.ts` 的 `showProgressWidget` |
| `ColumnSelectionModePanel` | `platform/platform-impl/src/com/intellij/openapi/wm/impl/status/ColumnSelectionModePanel.java` | `[~]` | `src/statusWidgets.ts` 的 column 项 |
| `ComboContentLayout` | `platform/platform-impl/src/com/intellij/openapi/wm/impl/content/ComboContentLayout.java` | `[~]` | `src/toolWindowContentUi.ts`：COMBO 档的下拉标签 |
| `ContentComboLabel` | `platform/platform-impl/src/com/intellij/openapi/wm/impl/content/ContentComboLabel.java` | `[~]` | `src/toolWindowContentUi.ts` 的 `contentCountLabel` |
| `ContentLayout` | `platform/platform-impl/src/com/intellij/openapi/wm/impl/content/ContentLayout.java` | `[~]` | `src/toolWindowContentUi.ts`：`resolveContentUiType` 等纯逻辑 |
| `ContentTabAction` | `platform/platform-impl/src/com/intellij/openapi/wm/impl/content/tabActions/ContentTabAction.kt` | `[~]` | `src/toolContents.ts` 的 pin/close 谓词 |
| `DesktopLayout` | `platform/platform-impl/src/com/intellij/openapi/wm/impl/DesktopLayout.kt` | `[~]` | `src/toolLayout.ts`：布局档案已落，`DesktopLayout` 权重模型没有 |
| `DockToolWindowAction` | `platform/platform-impl/src/com/intellij/openapi/wm/impl/DockToolWindowAction.java` | `[~]` | `src/menus/windowMenu.ts` 的 `window.activeToolwindowGroup` |
| `EncodingPanel` | `platform/platform-impl/src/com/intellij/openapi/wm/impl/status/EncodingPanel.java` | `[~]` | `src/statusWidgets.ts` 的 encoding 项 + App.vue 编码按钮 |
| `FilenameToolbarWidgetAction` | `platform/platform-impl/src/com/intellij/openapi/wm/impl/headertoolbar/FilenameToolbarWidgetAction.kt` | `[~]` | `src/filenameWidget.ts` |
| `FocusStatusBarAction` | `platform/platform-impl/src/com/intellij/openapi/wm/impl/status/FocusStatusBarAction.kt` | `[~]` | `src/statusBarNav.ts` 的 `shouldFocusFirstWidget` |
| `FrameTitleBuilder` | `platform/platform-impl/src/com/intellij/openapi/wm/impl/FrameTitleBuilder.kt` | `[~]` | `native/main.cpp` 的 `SetWindowTextW`（宿主拼标题） |
| `IdeStatusBarImpl` | `platform/platform-impl/src/com/intellij/openapi/wm/impl/status/IdeStatusBarImpl.kt` | `[~]` | `src/statusBarNav.ts` + App.vue `.statusbar` |
| `InfoAndProgressPanel` | `platform/platform-impl/src/com/intellij/openapi/wm/impl/status/InfoAndProgressPanel.kt` | `[~]` | `src/progressPanel.ts` + `src/processPopup.ts`（状态栏后台任务 chip 与列表） |
| `InlineProgressIndicator` | `platform/platform-impl/src/com/intellij/openapi/wm/impl/status/InlineProgressIndicator.java` | `[~]` | `src/progressPanel.ts` 的行模型 |
| `InternalDecorator` | `platform/platform-impl/src/com/intellij/openapi/wm/impl/InternalDecorator.java` | `[~]` | `src/toolWindowContentUi.ts`：内容外框由 Vue 组件承担 |
| `InternalDecoratorImpl` | `platform/platform-impl/src/com/intellij/toolWindow/InternalDecoratorImpl.kt` | `[~]` | `src/toolWindowContentUi.ts`：同上 |
| `LineSeparatorPanel` | `platform/platform-impl/src/com/intellij/openapi/wm/impl/status/LineSeparatorPanel.java` | `[~]` | `src/statusWidgets.ts` 的 lineSeparator 项 |
| `MainMenuWithButton` | `platform/platform-impl/src/com/intellij/openapi/wm/impl/headertoolbar/MainMenuWithButton.kt` | `[~]` | `src/mergedMainMenu.ts`：溢出折叠已按上游算法落 |
| `MainToolbar` | `platform/platform-impl/src/com/intellij/openapi/wm/impl/headertoolbar/MainToolbar.kt` | `[~]` | `src/components/MainToolbar.vue`（行结构/内缩/组间距/溢出折叠） |
| `MaximizeToolWindowAction` | `platform/platform-impl/src/com/intellij/openapi/wm/impl/MaximizeToolWindowAction.java` | `[~]` | `src/menus/windowMenu.ts` 的 `window.maximizeToolWindow` |
| `MemoryUsagePanel` | `platform/platform-impl/src/com/intellij/openapi/wm/impl/status/MemoryUsagePanel.java` | `[~]` | `src/memoryWidget.ts` + 状态栏内存 chip |
| `MemoryUsagePanelScheduler` | `platform/platform-impl/src/com/intellij/openapi/wm/impl/status/MemoryUsagePanelScheduler.kt` | `[~]` | `src/memoryWidget.ts` 的轮询（无调度器抽象） |
| `PlatformFrameTitleBuilder` | `platform/platform-impl/src/com/intellij/openapi/wm/impl/PlatformFrameTitleBuilder.kt` | `[~]` | `native/main.cpp`：同上 |
| `PositionPanel` | `platform/platform-impl/src/com/intellij/openapi/wm/impl/status/PositionPanel.kt` | `[~]` | `src/statusWidgets.ts` 的 position 项 |
| `ProcessBalloon` | `platform/platform-impl/src/com/intellij/openapi/wm/impl/status/ProcessBalloon.kt` | `[~]` | `src/processPopup.ts`：通知走 notices 通道 |
| `ProcessPopup` | `platform/platform-impl/src/com/intellij/openapi/wm/impl/status/ProcessPopup.java` | `[~]` | `src/processPopup.ts`：行模型与 finished 闸 |
| `ProgressComponent` | `platform/platform-impl/src/com/intellij/openapi/wm/impl/status/ProgressComponent.kt` | `[~]` | `src/progressPanel.ts` 的百分比轨道 |
| `ProgressIndicatorEx` | `platform/core-impl/src/com/intellij/openapi/wm/ex/ProgressIndicatorEx.java` | `[~]` | `src/progressPanel.ts`：取消通道 `ProgressCancel` |
| `ProjectToolbarWidgetAction` | `platform/platform-impl/src/com/intellij/openapi/wm/impl/headertoolbar/ProjectToolbarWidgetAction.kt` | `[~]` | `src/projectWidget.ts` |
| `ProjectWidgetActionsFilter` | `platform/platform-impl/src/com/intellij/openapi/wm/impl/headertoolbar/ProjectWidgetActionsFilter.kt` | `[~]` | `src/projectWidget.ts` 的速度搜索过滤 |
| `SeparatorDecorator` | `platform/platform-impl/src/com/intellij/openapi/wm/impl/status/SeparatorDecorator.kt` | `[~]` | `src/processPopup.ts` 的 `separator` 字段（按行位置决定） |
| `ShowProcessWindowAction` | `platform/platform-impl/src/com/intellij/openapi/wm/impl/status/ShowProcessWindowAction.java` | `[~]` | `src/processPopup.ts`：列表在同一条弹层里 |
| `SingleContentLayout` | `platform/platform-impl/src/com/intellij/openapi/wm/impl/content/SingleContentLayout.kt` | `[~]` | `src/toolWindowContentUi.ts`：单内容布局由 Vue 模板表达 |
| `SingleContentSupplier` | `platform/platform-impl/src/com/intellij/openapi/wm/impl/content/SingleContentSupplier.kt` | `[~]` | `src/toolContents.ts`：单内容供给者 |
| `SquareStripeButton` | `platform/platform-impl/src/com/intellij/openapi/wm/impl/SquareStripeButton.kt` | `[~]` | `src/toolWindowStripes.ts` + App.vue 的条纹按钮（外观层由 CSS 承担） |
| `StatusBar` | `platform/ide-core/src/com/intellij/openapi/wm/StatusBar.kt` | `[~]` | `src/statusBarNav.ts` + App.vue `.statusbar`：无 `getWidget`/`addWidget` 注册表 |
| `StatusBarWidget` | `platform/ide-core/src/com/intellij/openapi/wm/StatusBarWidget.kt` | `[~]` | `src/statusWidgets.ts`：固定清单，无 presentation 接口层 |
| `Stripe` | `platform/platform-impl/src/com/intellij/toolWindow/Stripe.java` | `[~]` | `src/toolWindowStripes.ts` + `src/toolStripeDrag.ts` |
| `StripeButton` | `platform/platform-impl/src/com/intellij/toolWindow/StripeButton.kt` | `[~]` | `src/toolWindowStripes.ts` 的按钮与 `stripeOrder`（外观/UI 类没有） |
| `TabContentLayout` | `platform/platform-impl/src/com/intellij/openapi/wm/impl/content/TabContentLayout.java` | `[~]` | `src/toolWindowContentUi.ts`：TABBED 档的标签行 |
| `TasksFinishedDecorator` | `platform/platform-impl/src/com/intellij/openapi/wm/impl/status/TasksFinishedDecorator.kt` | `[~]` | `src/processPopup.ts` 的 `updateFinishedLatch` |
| `TitleInfoProvider` | `platform/platform-impl/src/com/intellij/openapi/wm/impl/TitleInfoProvider.kt` | `[~]` | `native/main.cpp`：无分段 provider 模型 |
| `ToggleReadOnlyAttributePanel` | `platform/platform-impl/src/com/intellij/openapi/wm/impl/status/ToggleReadOnlyAttributePanel.kt` | `[~]` | `src/statusWidgets.ts` 的 readonly 项 |
| `ToolWindow` | `platform/ide-core/src/com/intellij/openapi/wm/ToolWindow.java` | `[~]` | `src/toolWindowMeta.ts` + `src/toolWindowStripes.ts` + `src/components/ToolWindowView.vue` |
| `ToolWindowContentUi` | `platform/platform-impl/src/com/intellij/openapi/wm/impl/content/ToolWindowContentUi.java` | `[~]` | `src/toolWindowContentUi.ts`：内容宿主是 Vue 组件，无 Swing 标签/下拉标签布局 |
| `ToolWindowContextMenuActionBase` | `platform/platform-impl/src/com/intellij/openapi/wm/ToolWindowContextMenuActionBase.java` | `[~]` | `src/menus/toolWindowGear.ts`：动作基类折成齿轮行表 |
| `ToolWindowDefaultLayoutManager` | `platform/platform-impl/src/com/intellij/toolWindow/ToolWindowDefaultLayoutManager.kt` | `[~]` | `src/toolLayouts.ts` 的工厂默认布局 |
| `ToolWindowDragHelper` | `platform/platform-impl/src/com/intellij/toolWindow/ToolWindowDragHelper.kt` | `[~]` | `src/toolStripeDrag.ts`：只有侧条内重排 |
| `ToolWindowDropArea` | `platform/platform-impl/src/com/intellij/toolWindow/ToolWindowDropArea.kt` | `[~]` | `src/toolStripeDrag.ts` 的投放区高亮 |
| `ToolWindowEx` | `platform/platform-impl/src/com/intellij/openapi/wm/ex/ToolWindowEx.java` | `[~]` | `src/toolWindowStripes.ts`：同上 |
| `ToolWindowHeader` | `platform/platform-impl/src/com/intellij/toolWindow/ToolWindowHeader.kt` | `[~]` | `src/components/ToolWindowHeader.vue` + `src/toolWindowHeader.ts` |
| `ToolWindowImpl` | `platform/platform-impl/src/com/intellij/openapi/wm/impl/ToolWindowImpl.kt` | `[~]` | `src/toolWindowActions.ts` + `src/toolWindowMeta.ts`：内容 UI 类型随窗口走已落，isSplitMode/StripeTitleProvider 没有 |
| `ToolWindowManagerEx` | `platform/platform-impl/src/com/intellij/openapi/wm/ex/ToolWindowManagerEx.kt` | `[~]` | `src/toolWindowStripes.ts`：查询面散在几个模块，无统一门面 |
| `ToolWindowManagerImpl` | `platform/platform-impl/src/com/intellij/openapi/wm/impl/ToolWindowManagerImpl.kt` | `[~]` | `src/toolWindowStripes.ts` 的 `activationTarget`：无 layoutState/WindowInfo 聚合对象 |
| `ToolWindowPane` | `platform/platform-impl/src/com/intellij/toolWindow/ToolWindowPane.kt` | `[~]` | `src/toolLayouts.ts`：无 per-pane state 对象 |
| `ToolWindowSplitContentProvider` | `platform/platform-impl/src/com/intellij/toolWindow/ToolWindowSplitContentProvider.kt` | `[~]` | `src/toolContents.ts`（多内容 addContent 那一半） |
| `ToolWindowStripeManager` | `platform/platform-impl/src/com/intellij/toolWindow/ToolWindowStripeManager.kt` | `[~]` | `src/toolWindowStripes.ts`：无 ResizeStripeManager/溢出按钮管理 |
| `ToolWindowStripeManagerImpl` | `platform/platform-impl/src/com/intellij/toolWindow/ToolWindowStripeManagerImpl.kt` | `[~]` | `src/toolWindowStripes.ts`：同上 |
| `ToolWindowType` | `platform/ide-core/src/com/intellij/openapi/wm/ToolWindowType.java` | `[~]` | `src/toolWindowMeta.ts`：只兑现 DOCKED |
| `ToolWindowsWidget` | `platform/platform-impl/src/com/intellij/openapi/wm/impl/status/ToolWindowsWidget.java` | `[~]` | `src/App.vue` 的 `.status-toolwindows` 按钮 + `groupedAvailableToolWindows` 分组弹层（判据 `tests/status-toolwindows-popup.test.mjs`） |
| `WelcomeScreen` | `platform/platform-api/src/com/intellij/openapi/wm/WelcomeScreen.java` | `[~]` | `src/components/WelcomePage.vue` + `src/welcomeProjects.ts` |
| `WindowInfo` | `platform/platform-api/src/com/intellij/openapi/wm/WindowInfo.kt` | `[~]` | `src/toolWindowStripes.ts`：可见/锚点/顺序分散，无每窗口聚合对象 |
| `defaultToolWindowlayoutProvider` | `platform/platform-impl/src/com/intellij/toolWindow/defaultToolWindowlayoutProvider.kt` | `[~]` | `src/toolLayouts.ts`：无 profile 概念 |
| `requestFocusInToolWindow` | `platform/platform-impl/src/com/intellij/toolWindow/requestFocusInToolWindow.kt` | `[~]` | `src/toolWindowActions.ts` 的 `focusToolWindowContent`（同名能力，实现形态不同） |
| `toolWindowNamesChange` | `platform/platform-impl/src/com/intellij/toolWindow/toolWindowNamesChange.kt` | `[~]` | `src/toolWindowMeta.ts` 的 `toolTitles` 常量表（无运行时改名通道） |
| `toolwindow` | `platform/platform-impl/src/com/intellij/toolWindow/toolwindow.kt` | `[~]` | `src/toolWindowMeta.ts`（同包工具函数族：`mnemonicOf` 等） |
| `BaseFocusWatcher` | `platform/util/ui/src/com/intellij/openapi/wm/BaseFocusWatcher.java` | `[ ]` | 焦点监视基类（FocusWatcher）：本仓无通用焦点监视 |
| `ColumnSelectionModeWidgetFactory` | `platform/platform-impl/src/com/intellij/openapi/wm/impl/status/ColumnSelectionModeWidgetFactory.java` | `[ ]` | §C：同上 |
| `ConfigFolderTitleInfoProvider` | `platform/platform-impl/src/com/intellij/openapi/wm/impl/simpleTitleParts/ConfigFolderTitleInfoProvider.kt` | `[ ]` | 标题分段 provider（产品名/版本/配置目录）：本仓窗口标题由宿主拼，没有分段模型 |
| `EditorBasedStatusBarPopup` | `platform/platform-impl/src/com/intellij/openapi/wm/impl/status/EditorBasedStatusBarPopup.kt` | `[ ]` | 同上（弹层版） |
| `EditorBasedWidget` | `platform/platform-impl/src/com/intellij/openapi/wm/impl/status/EditorBasedWidget.kt` | `[ ]` | 跟着当前编辑器走的 widget 基类 |
| `EncodingPanelWidgetFactory` | `platform/platform-impl/src/com/intellij/openapi/wm/impl/status/EncodingPanelWidgetFactory.java` | `[ ]` | §C：同上 |
| `FatalErrorWidgetFactory` | `platform/platform-impl/src/com/intellij/openapi/wm/impl/status/FatalErrorWidgetFactory.java` | `[ ]` | §C：同上 |
| `FocusMainToolbarAction` | `platform/platform-impl/src/com/intellij/openapi/wm/impl/headertoolbar/FocusMainToolbarAction.kt` | `[ ]` | 聚焦主工具栏的动作 |
| `FocusManagerImpl` | `platform/platform-impl/src/com/intellij/openapi/wm/impl/FocusManagerImpl.java` | `[ ]` | 同上（实现） |
| `FocusWatcher` | `platform/util/ui/src/com/intellij/openapi/wm/FocusWatcher.java` | `[ ]` | 焦点监视 |
| `IdeFocusManager` | `platform/ide-core/src/com/intellij/openapi/wm/IdeFocusManager.java` | `[ ]` | 通用焦点管理器（焦点请求排队/回调）：本仓只有状态栏那条 focus cycle root |
| `IdeFocusManagerImpl` | `platform/platform-impl/src/com/intellij/openapi/wm/impl/IdeFocusManagerImpl.java` | `[ ]` | 同上（实现） |
| `IdeFocusTraversalPolicy` | `platform/platform-impl/src/com/intellij/openapi/wm/ex/IdeFocusTraversalPolicy.java` | `[ ]` | 焦点遍历策略 |
| `IndexesAndVfsFlushIndicatorWidgetFactory` | `platform/platform-impl/src/com/intellij/openapi/wm/impl/status/IndexesAndVfsFlushIndicatorWidgetFactory.kt` | `[ ]` | §C：索引/刷盘指示（本仓无索引） |
| `InspectionProfileWidgetFactory` | `platform/lang-impl/src/com/intellij/openapi/wm/impl/status/InspectionProfileWidgetFactory.java` | `[ ]` | 检查配置档 widget（本仓无检查档） |
| `LibraryDependentToolWindow` | `platform/platform-api/src/com/intellij/openapi/wm/ext/LibraryDependentToolWindow.java` | `[ ]` | 库依赖工具窗口 |
| `LibrarySearchHelper` | `platform/platform-api/src/com/intellij/openapi/wm/ext/LibrarySearchHelper.java` | `[ ]` | 库依赖工具窗口的搜索帮助 |
| `LineSeparatorWidgetFactory` | `platform/platform-impl/src/com/intellij/openapi/wm/impl/status/LineSeparatorWidgetFactory.java` | `[ ]` | §C：同上 |
| `MainToolbarFocusSupport` | `platform/platform-impl/src/com/intellij/openapi/wm/impl/headertoolbar/MainToolbarFocusSupport.kt` | `[ ]` | 工具栏焦点支撑 |
| `MainToolbarQuickActions` | `platform/platform-impl/src/com/intellij/openapi/wm/impl/headertoolbar/MainToolbarQuickActions.kt` | `[ ]` | 工具栏快捷动作 |
| `MemoryIndicatorWidgetFactory` | `platform/platform-impl/src/com/intellij/openapi/wm/impl/status/MemoryIndicatorWidgetFactory.java` | `[ ]` | §C：同上 |
| `MoreSquareStripeButton` | `platform/platform-impl/src/com/intellij/toolWindow/MoreSquareStripeButton.kt` | `[ ]` | 侧条溢出「更多」按钮 |
| `OpenProjectSelectionPredicateSupplier` | `platform/platform-impl/src/com/intellij/openapi/wm/impl/headertoolbar/OpenProjectSelectionPredicateSupplier.kt` | `[ ]` | 项目部件选择谓词（依附项目部件动作过滤） |
| `PositionPanelWidgetFactory` | `platform/platform-impl/src/com/intellij/openapi/wm/impl/status/PositionPanelWidgetFactory.kt` | `[ ]` | §C：同上 |
| `PowerSaveStatusWidgetFactory` | `platform/platform-impl/src/com/intellij/openapi/wm/impl/status/PowerSaveStatusWidgetFactory.java` | `[ ]` | §C：同上 |
| `ProductTitleInfoProvider` | `platform/platform-impl/src/com/intellij/openapi/wm/impl/simpleTitleParts/ProductTitleInfoProvider.kt` | `[ ]` | 标题分段 provider（产品名/版本/配置目录）：本仓窗口标题由宿主拼，没有分段模型 |
| `ProductVersionTitleInfoProvider` | `platform/platform-impl/src/com/intellij/openapi/wm/impl/simpleTitleParts/ProductVersionTitleInfoProvider.kt` | `[ ]` | 标题分段 provider（产品名/版本/配置目录）：本仓窗口标题由宿主拼，没有分段模型 |
| `ProjectFrameToolWindowLayout` | `platform/platform-impl/src/com/intellij/toolWindow/ProjectFrameToolWindowLayout.kt` | `[ ]` | 按项目帧的布局档案 |
| `ReadOnlyAttributeWidgetFactory` | `platform/platform-impl/src/com/intellij/openapi/wm/impl/status/ReadOnlyAttributeWidgetFactory.java` | `[ ]` | §C：行为在 App.vue 按钮里，无工厂层 |
| `RegisterToolWindowTask` | `platform/platform-api/src/com/intellij/openapi/wm/RegisterToolWindowTask.kt` | `[ ]` | 工具窗口注册机制（EP → Factory） |
| `ResizeStripeManager` | `platform/platform-impl/src/com/intellij/toolWindow/ResizeStripeManager.kt` | `[ ]` | 拖条宽 |
| `SimpleTitleInfoProvider` | `platform/platform-impl/src/com/intellij/openapi/wm/impl/simpleTitleParts/SimpleTitleInfoProvider.kt` | `[ ]` | 标题分段 provider（产品名/版本/配置目录）：本仓窗口标题由宿主拼，没有分段模型 |
| `SmartModeIndicatorWidgetFactory` | `platform/platform-impl/src/com/intellij/openapi/wm/impl/status/SmartModeIndicatorWidgetFactory.kt` | `[ ]` | §C：同上 |
| `StatusBarEditorBasedWidgetFactory` | `platform/platform-impl/src/com/intellij/openapi/wm/impl/status/widget/StatusBarEditorBasedWidgetFactory.kt` | `[ ]` | EditorBasedWidget 的工厂 |
| `StatusBarEx` | `platform/platform-impl/src/com/intellij/openapi/wm/ex/StatusBarEx.java` | `[ ]` | 状态栏扩展接口（组件注册表的管理面，同 §C 一族） |
| `StatusBarListener` | `platform/ide-core/src/com/intellij/openapi/wm/StatusBarListener.java` | `[ ]` | 状态栏事件监听 |
| `StatusBarWidgetFactory` | `platform/platform-api/src/com/intellij/openapi/wm/StatusBarWidgetFactory.java` | `[ ]` | 状态栏组件注册表（§C 最优先） |
| `StatusBarWidgetProvider` | `platform/platform-api/src/com/intellij/openapi/wm/StatusBarWidgetProvider.java` | `[ ]` | 注册表的 EP 侧 |
| `StatusBarWidgetProviderToFactoryAdapter` | `platform/platform-impl/src/com/intellij/openapi/wm/impl/status/widget/StatusBarWidgetProviderToFactoryAdapter.kt` | `[ ]` | 状态栏组件注册表（§C 最优先）：本仓是固定清单 |
| `StatusBarWidgetSettings` | `platform/platform-impl/src/com/intellij/openapi/wm/impl/status/widget/StatusBarWidgetSettings.kt` | `[ ]` | §C 注册表的持久化 |
| `StatusBarWidgetsActionGroup` | `platform/platform-impl/src/com/intellij/openapi/wm/impl/status/widget/StatusBarWidgetsActionGroup.kt` | `[ ]` | §C 注册表的右键组 |
| `StatusBarWidgetsManager` | `platform/platform-impl/src/com/intellij/openapi/wm/impl/status/widget/StatusBarWidgetsManager.kt` | `[ ]` | §C 注册表的容器 |
| `StatusBarWidgetsOptionProvider` | `platform/platform-impl/src/com/intellij/openapi/wm/impl/status/widget/StatusBarWidgetsOptionProvider.kt` | `[ ]` | §C 注册表的设置页 |
| `StripeActionGroup` | `platform/platform-impl/src/com/intellij/toolWindow/StripeActionGroup.kt` | `[ ]` | 条纹右键动作组 |
| `SuperUserSuffixTitleInfoProvider` | `platform/platform-impl/src/com/intellij/openapi/wm/impl/simpleTitleParts/SuperUserSuffixTitleInfoProvider.kt` | `[ ]` | 标题分段 provider（产品名/版本/配置目录）：本仓窗口标题由宿主拼，没有分段模型 |
| `TitleInfoOption` | `platform/platform-impl/src/com/intellij/openapi/wm/impl/simpleTitleParts/TitleInfoOption.kt` | `[ ]` | 标题分段 provider（产品名/版本/配置目录）：本仓窗口标题由宿主拼，没有分段模型 |
| `TogglePopupHintsPanel` | `platform/lang-impl/src/com/intellij/openapi/wm/impl/status/TogglePopupHintsPanel.java` | `[ ]` | 隐去弹层提示的开关 |
| `ToolWindowAllowlistEP` | `platform/platform-api/src/com/intellij/openapi/wm/ToolWindowAllowlistEP.java` | `[ ]` | 同上（allowlist） |
| `ToolWindowButtonManager` | `platform/platform-impl/src/com/intellij/toolWindow/ToolWindowButtonManager.kt` | `[ ]` | 条纹按钮管理（新/旧 UI 两套） |
| `ToolWindowEP` | `platform/platform-api/src/com/intellij/openapi/wm/ToolWindowEP.java` | `[ ]` | 同上 |
| `ToolWindowEditorTabActionBase` | `platform/platform-impl/src/com/intellij/openapi/wm/impl/tabInEditor/ToolWindowEditorTabActionBase.kt` | `[ ]` | 把工具窗口当编辑器标签（§E-3）：依赖另一条标签类型与生命周期，单独一批 |
| `ToolWindowEditorTabActions` | `platform/platform-impl/src/com/intellij/openapi/wm/impl/tabInEditor/ToolWindowEditorTabActions.kt` | `[ ]` | 把工具窗口当编辑器标签（§E-3）：依赖另一条标签类型与生命周期，单独一批 |
| `ToolWindowEditorTabAutoClosingHandler` | `platform/platform-impl/src/com/intellij/openapi/wm/impl/tabInEditor/ToolWindowEditorTabAutoClosingHandler.kt` | `[ ]` | 把工具窗口当编辑器标签（§E-3）：依赖另一条标签类型与生命周期，单独一批 |
| `ToolWindowEditorTabDockContainer` | `platform/platform-impl/src/com/intellij/openapi/wm/impl/tabInEditor/ToolWindowEditorTabDockContainer.kt` | `[ ]` | 把工具窗口当编辑器标签（§E-3）：依赖另一条标签类型与生命周期，单独一批 |
| `ToolWindowEditorTabFile` | `platform/platform-impl/src/com/intellij/openapi/wm/impl/tabInEditor/ToolWindowEditorTabFile.kt` | `[ ]` | 把工具窗口当编辑器标签（§E-3）：依赖另一条标签类型与生命周期，单独一批 |
| `ToolWindowEditorTabFileEditor` | `platform/platform-impl/src/com/intellij/openapi/wm/impl/tabInEditor/ToolWindowEditorTabFileEditor.kt` | `[ ]` | 把工具窗口当编辑器标签（§E-3）：依赖另一条标签类型与生命周期，单独一批 |
| `ToolWindowEditorTabFileEditorProvider` | `platform/platform-impl/src/com/intellij/openapi/wm/impl/tabInEditor/ToolWindowEditorTabFileEditorProvider.kt` | `[ ]` | 把工具窗口当编辑器标签（§E-3）：依赖另一条标签类型与生命周期，单独一批 |
| `ToolWindowEditorTabFileIconProvider` | `platform/platform-impl/src/com/intellij/openapi/wm/impl/tabInEditor/ToolWindowEditorTabFileIconProvider.kt` | `[ ]` | 把工具窗口当编辑器标签（§E-3）：依赖另一条标签类型与生命周期，单独一批 |
| `ToolWindowEditorTabFileRegistry` | `platform/platform-impl/src/com/intellij/openapi/wm/impl/tabInEditor/ToolWindowEditorTabFileRegistry.kt` | `[ ]` | 把工具窗口当编辑器标签（§E-3）：依赖另一条标签类型与生命周期，单独一批 |
| `ToolWindowEditorTabFileSystem` | `platform/platform-impl/src/com/intellij/openapi/wm/impl/tabInEditor/ToolWindowEditorTabFileSystem.kt` | `[ ]` | 把工具窗口当编辑器标签（§E-3）：依赖另一条标签类型与生命周期，单独一批 |
| `ToolWindowEditorTabFileType` | `platform/platform-impl/src/com/intellij/openapi/wm/impl/tabInEditor/ToolWindowEditorTabFileType.kt` | `[ ]` | 把工具窗口当编辑器标签（§E-3）：依赖另一条标签类型与生命周期，单独一批 |
| `ToolWindowEditorTabManager` | `platform/platform-impl/src/com/intellij/openapi/wm/impl/tabInEditor/ToolWindowEditorTabManager.kt` | `[ ]` | 把工具窗口当编辑器标签（§E-3）：依赖另一条标签类型与生命周期，单独一批 |
| `ToolWindowEditorTabPersistenceProvider` | `platform/platform-impl/src/com/intellij/openapi/wm/impl/tabInEditor/ToolWindowEditorTabPersistenceProvider.kt` | `[ ]` | 把工具窗口当编辑器标签（§E-3）：依赖另一条标签类型与生命周期，单独一批 |
| `ToolWindowEditorTabPersistenceProviderUtil` | `platform/platform-impl/src/com/intellij/openapi/wm/impl/tabInEditor/ToolWindowEditorTabPersistenceProviderUtil.kt` | `[ ]` | 把工具窗口当编辑器标签（§E-3）：依赖另一条标签类型与生命周期，单独一批 |
| `ToolWindowEditorTabPreCloseCheck` | `platform/platform-impl/src/com/intellij/openapi/wm/impl/tabInEditor/ToolWindowEditorTabPreCloseCheck.kt` | `[ ]` | 把工具窗口当编辑器标签（§E-3）：依赖另一条标签类型与生命周期，单独一批 |
| `ToolWindowEditorTabSession` | `platform/platform-impl/src/com/intellij/openapi/wm/impl/tabInEditor/ToolWindowEditorTabSession.kt` | `[ ]` | 把工具窗口当编辑器标签（§E-3）：依赖另一条标签类型与生命周期，单独一批 |
| `ToolWindowEditorTabSupport` | `platform/platform-impl/src/com/intellij/openapi/wm/impl/tabInEditor/ToolWindowEditorTabSupport.kt` | `[ ]` | 把工具窗口当编辑器标签（§E-3）：依赖另一条标签类型与生命周期，单独一批 |
| `ToolWindowEditorTabSupportUtil` | `platform/platform-impl/src/com/intellij/openapi/wm/impl/tabInEditor/ToolWindowEditorTabSupportUtil.kt` | `[ ]` | 把工具窗口当编辑器标签（§E-3）：依赖另一条标签类型与生命周期，单独一批 |
| `ToolWindowEditorTabTitleProvider` | `platform/platform-impl/src/com/intellij/openapi/wm/impl/tabInEditor/ToolWindowEditorTabTitleProvider.kt` | `[ ]` | 把工具窗口当编辑器标签（§E-3）：依赖另一条标签类型与生命周期，单独一批 |
| `ToolWindowEditorTabTransferController` | `platform/platform-impl/src/com/intellij/openapi/wm/impl/tabInEditor/ToolWindowEditorTabTransferController.kt` | `[ ]` | 把工具窗口当编辑器标签（§E-3）：依赖另一条标签类型与生命周期，单独一批 |
| `ToolWindowEntry` | `platform/platform-impl/src/com/intellij/toolWindow/ToolWindowEntry.kt` | `[ ]` | 占位/平铺条目模型 |
| `ToolWindowFactory` | `platform/platform-api/src/com/intellij/openapi/wm/ToolWindowFactory.kt` | `[ ]` | 同上（内容工厂） |
| `ToolWindowHorizontalToolbar` | `platform/platform-impl/src/com/intellij/toolWindow/extendedToolWindowsUi/ToolWindowHorizontalToolbar.kt` | `[ ]` | 窗口内横向工具栏 |
| `ToolWindowInEditorSupport` | `platform/platform-impl/src/com/intellij/openapi/wm/impl/content/ToolWindowInEditorSupport.kt` | `[ ]` | 工具窗口进编辑器的支撑（同 tabInEditor 一族） |
| `ToolWindowInnerDragHelper` | `platform/platform-impl/src/com/intellij/toolWindow/innerDrag/ToolWindowInnerDragHelper.kt` | `[ ]` | 跨区拖放内部实现 |
| `ToolWindowLayoutProfileMigrationHelper` | `platform/platform-impl/src/com/intellij/openapi/wm/impl/ToolWindowLayoutProfileMigrationHelper.kt` | `[ ]` | 档案迁移 |
| `ToolWindowLayoutProfileProvider` | `platform/platform-impl/src/com/intellij/toolWindow/ToolWindowLayoutProfileProvider.kt` | `[ ]` | 布局档案 provider |
| `ToolWindowLeftToolbar` | `platform/platform-impl/src/com/intellij/toolWindow/ToolWindowLeftToolbar.kt` | `[ ]` | 窗口内左侧工具栏 |
| `ToolWindowManager` | `platform/platform-api/src/com/intellij/openapi/wm/ToolWindowManager.kt` | `[ ]` | 上游查询面：本仓散在 `src/toolWindowMeta.ts`/`src/toolWindowStripes.ts`/`src/toolWindowActions.ts` |
| `ToolWindowManagerListener` | `platform/platform-api/src/com/intellij/openapi/wm/ex/ToolWindowManagerListener.java` | `[ ]` | 工具窗口事件监听（插件扩展点） |
| `ToolWindowManagerState` | `platform/platform-impl/src/com/intellij/openapi/wm/impl/ToolWindowManagerState.kt` | `[ ]` | 布局持久化的完整模型 |
| `ToolWindowPaneNewButtonManager` | `platform/platform-impl/src/com/intellij/toolWindow/ToolWindowPaneNewButtonManager.kt` | `[ ]` | 新 UI 按钮管理 |
| `ToolWindowPaneOldButtonManager` | `platform/platform-impl/src/com/intellij/toolWindow/ToolWindowPaneOldButtonManager.kt` | `[ ]` | 旧 UI 按钮管理 |
| `ToolWindowPaneState` | `platform/platform-impl/src/com/intellij/toolWindow/ToolWindowPaneState.kt` | `[ ]` | 每 pane 状态对象 |
| `ToolWindowRightToolbar` | `platform/platform-impl/src/com/intellij/toolWindow/ToolWindowRightToolbar.kt` | `[ ]` | 窗口内右侧工具栏（本仓无窗口内工具栏） |
| `ToolWindowSetInitializer` | `platform/platform-impl/src/com/intellij/toolWindow/ToolWindowSetInitializer.kt` | `[ ]` | 工具窗口集合初始化 |
| `ToolWindowStripeExtension` | `platform/platform-impl/src/com/intellij/toolWindow/extendedToolWindowsUi/ToolWindowStripeExtension.kt` | `[ ]` | 条纹扩展点 |
| `ToolWindowToEditorTransfer` | `platform/platform-impl/src/com/intellij/toolWindow/innerDrag/ToolWindowToEditorTransfer.kt` | `[ ]` | 拖到编辑器转成标签 |
| `ToolWindowToolbar` | `platform/platform-impl/src/com/intellij/toolWindow/ToolWindowToolbar.kt` | `[ ]` | 窗口内工具栏 |
| `VfsRefreshIndicatorWidgetFactory` | `platform/platform-impl/src/com/intellij/openapi/wm/impl/status/VfsRefreshIndicatorWidgetFactory.java` | `[ ]` | §C：同上 |
| `WidgetRegistry` | `platform/platform-impl/src/com/intellij/openapi/wm/impl/status/WidgetRegistry.kt` | `[ ]` | 状态栏组件注册表容器（同 §C 注册表一族） |
| `WindowInfoImpl` | `platform/platform-impl/src/com/intellij/openapi/wm/impl/WindowInfoImpl.kt` | `[ ]` | 每窗口状态对象 |
| `WindowManager` | `platform/ide-core/src/com/intellij/openapi/wm/WindowManager.java` | `[ ]` | 窗口查询面：本仓由宿主 C++ 管窗口 |
| `WindowManagerListener` | `platform/project-frame/src/com/intellij/openapi/wm/ex/WindowManagerListener.kt` | `[ ]` | 窗口事件监听 |
| `WriteThreadIndicatorWidgetFactory` | `platform/platform-impl/src/com/intellij/openapi/wm/impl/status/WriteThreadIndicatorWidgetFactory.kt` | `[ ]` | §C：写线程指示 |
| `ideFocusUtil` | `platform/ide-core/src/com/intellij/openapi/wm/ideFocusUtil.kt` | `[ ]` | 焦点工具（requestFocusInEditor 等） |
| `AbstractBannerImageProvider` | `platform/platform-impl/src/com/intellij/openapi/wm/impl/AbstractBannerImageProvider.kt` | `[-]` | 横幅图 provider |
| `AbstractDelegatingToRootTraversalPolicy` | `platform/platform-api/src/com/intellij/openapi/wm/ex/AbstractDelegatingToRootTraversalPolicy.java` | `[-]` | Swing 焦点遍历基类 |
| `AbstractToolbarCombo` | `platform/platform-impl/src/com/intellij/openapi/wm/impl/AbstractToolbarCombo.kt` | `[-]` | Swing 组合基类 |
| `AbstractTraverseWindowAction` | `platform/lang-impl/src/com/intellij/openapi/wm/impl/AbstractTraverseWindowAction.java` | `[-]` | 跨窗口遍历动作（多窗口） |
| `AdditionalIcon` | `platform/platform-impl/src/com/intellij/openapi/wm/impl/content/AdditionalIcon.kt` | `[-]` | 图标叠加（Swing Icon） |
| `AltStateManager` | `platform/platform-impl/src/com/intellij/openapi/wm/impl/AltStateManager.java` | `[-]` | Alt 按下/松开监听：上游整棵树里除自身外**没有任何消费者**（grep 全仓 = 0） |
| `AnalyzingBannerDecorator` | `platform/platform-impl/src/com/intellij/openapi/wm/impl/status/AnalyzingBannerDecorator.kt` | `[-]` | 「分析中」横幅装饰器（本仓无索引/分析阶段） |
| `AnchoredButton` | `platform/platform-impl/src/com/intellij/openapi/wm/impl/AnchoredButton.java` | `[-]` | Swing 定位按钮基类 |
| `AppIconScheme` | `platform/platform-api/src/com/intellij/openapi/wm/AppIconScheme.java` | `[-]` | 应用图标主题（宿主窗口图标） |
| `BannerStartPagePromoter` | `platform/platform-api/src/com/intellij/openapi/wm/BannerStartPagePromoter.kt` | `[-]` | 上坡横幅/促销位：ADHD 营销位，本仓不造 |
| `BaseLabel` | `platform/platform-impl/src/com/intellij/openapi/wm/impl/content/BaseLabel.java` | `[-]` | Swing 标签基类 |
| `ChildStatusBarManager` | `platform/platform-impl/src/com/intellij/openapi/wm/impl/status/ChildStatusBarManager.kt` | `[-]` | 子状态栏（多窗口） |
| `ClassTitlePane` | `platform/platform-impl/src/com/intellij/openapi/wm/impl/customFrameDecorations/header/titleLabel/ClassTitlePane.kt` | `[-]` | 自绘无边框窗口族：标题栏/窗口按钮/边框阴影由宿主 C++ 画，前端只画内容区 |
| `ClippingTitle` | `platform/platform-impl/src/com/intellij/openapi/wm/impl/customFrameDecorations/header/titleLabel/ClippingTitle.kt` | `[-]` | 自绘无边框窗口族：标题栏/窗口按钮/边框阴影由宿主 C++ 画，前端只画内容区 |
| `ClockPanel` | `platform/platform-impl/src/com/intellij/openapi/wm/impl/status/ClockPanel.java` | `[-]` | 菜单栏上的数字时钟：只在 `FloatingMenuBarFlavor`（全屏浮动菜单栏）里挂载，本仓菜单条在 WebView2 内容区里，没有这个位置 |
| `CloseProjectWindowHelper` | `platform/platform-impl/src/com/intellij/openapi/wm/impl/CloseProjectWindowHelper.kt` | `[-]` | 关闭项目窗口（多窗口） |
| `ContentLabel` | `platform/platform-impl/src/com/intellij/openapi/wm/impl/content/ContentLabel.java` | `[-]` | 内容标签（Swing） |
| `ContentTabLabel` | `platform/platform-impl/src/com/intellij/openapi/wm/impl/content/ContentTabLabel.java` | `[-]` | 内容标签页标签（Swing） |
| `CustomDecorationPath` | `platform/platform-impl/src/com/intellij/openapi/wm/impl/customFrameDecorations/header/titleLabel/CustomDecorationPath.kt` | `[-]` | 自绘无边框窗口族：标题栏/窗口按钮/边框阴影由宿主 C++ 画，前端只画内容区 |
| `CustomDecorationTitle` | `platform/platform-impl/src/com/intellij/openapi/wm/impl/customFrameDecorations/header/titleLabel/CustomDecorationTitle.kt` | `[-]` | 自绘无边框窗口族：标题栏/窗口按钮/边框阴影由宿主 C++ 画，前端只画内容区 |
| `CustomFrameButtons` | `platform/platform-impl/src/com/intellij/openapi/wm/impl/customFrameDecorations/frameButtons/CustomFrameButtons.kt` | `[-]` | 自绘窗口按钮 |
| `CustomFrameDialogContent` | `platform/platform-impl/src/com/intellij/openapi/wm/impl/customFrameDecorations/header/CustomFrameDialogContent.kt` | `[-]` | 自绘无边框窗口族：标题栏/窗口按钮/边框阴影由宿主 C++ 画，前端只画内容区 |
| `CustomHeader` | `platform/platform-impl/src/com/intellij/openapi/wm/impl/customFrameDecorations/header/CustomHeader.kt` | `[-]` | 自绘无边框窗口族：标题栏/窗口按钮/边框阴影由宿主 C++ 画，前端只画内容区 |
| `CustomHeaderTitle` | `platform/platform-impl/src/com/intellij/openapi/wm/impl/customFrameDecorations/header/title/CustomHeaderTitle.kt` | `[-]` | 自绘无边框窗口族：标题栏/窗口按钮/边框阴影由宿主 C++ 画，前端只画内容区 |
| `CustomStatusBarWidget` | `platform/platform-api/src/com/intellij/openapi/wm/CustomStatusBarWidget.java` | `[-]` | 自定义状态栏组件接口（Swing JComponent） |
| `CustomWindowHeaderUtil` | `platform/platform-impl/src/com/intellij/openapi/wm/impl/customFrameDecorations/header/CustomWindowHeaderUtil.kt` | `[-]` | 自绘无边框窗口族：标题栏/窗口按钮/边框阴影由宿主 C++ 画，前端只画内容区 |
| `DefaultCutStrategy` | `platform/platform-impl/src/com/intellij/openapi/wm/impl/DefaultCutStrategy.java` | `[-]` | 文字截断策略（Swing 字体度量） |
| `DefaultFrameHeader` | `platform/platform-impl/src/com/intellij/openapi/wm/impl/customFrameDecorations/header/DefaultFrameHeader.kt` | `[-]` | 自绘无边框窗口族：标题栏/窗口按钮/边框阴影由宿主 C++ 画，前端只画内容区 |
| `DefaultPartTitle` | `platform/platform-impl/src/com/intellij/openapi/wm/impl/customFrameDecorations/header/titleLabel/DefaultPartTitle.kt` | `[-]` | 自绘无边框窗口族：标题栏/窗口按钮/边框阴影由宿主 C++ 画，前端只画内容区 |
| `DefaultToolbarComboButtonModel` | `platform/platform-impl/src/com/intellij/openapi/wm/impl/DefaultToolbarComboButtonModel.kt` | `[-]` | 同上（默认模型） |
| `DefaultToolbarSplitButtonModel` | `platform/platform-impl/src/com/intellij/openapi/wm/impl/DefaultToolbarSplitButtonModel.kt` | `[-]` | 同上（默认模型） |
| `DialogBackgroundImageProviderBase` | `platform/platform-impl/src/com/intellij/openapi/wm/impl/DialogBackgroundImageProviderBase.kt` | `[-]` | 对话框背景图 provider |
| `DialogBackgroundImageProviderImpl` | `platform/platform-impl/src/com/intellij/openapi/wm/impl/DialogBackgroundImageProviderImpl.kt` | `[-]` | 同上（实现） |
| `DialogHeader` | `platform/platform-impl/src/com/intellij/openapi/wm/impl/customFrameDecorations/header/DialogHeader.kt` | `[-]` | 自绘无边框窗口族：标题栏/窗口按钮/边框阴影由宿主 C++ 画，前端只画内容区 |
| `ExpandableComboAction` | `platform/platform-impl/src/com/intellij/openapi/wm/impl/ExpandableComboAction.kt` | `[-]` | Swing 可展开组合动作 |
| `ExpandableMenu` | `platform/platform-impl/src/com/intellij/openapi/wm/impl/customFrameDecorations/header/toolbar/ExpandableMenu.kt` | `[-]` | 自绘无边框窗口族：标题栏/窗口按钮/边框阴影由宿主 C++ 画，前端只画内容区 |
| `FlippedIcon` | `platform/platform-impl/src/com/intellij/openapi/wm/impl/content/FlippedIcon.java` | `[-]` | 翻转图标（Swing Icon） |
| `FloatingDecorator` | `platform/platform-impl/src/com/intellij/openapi/wm/impl/FloatingDecorator.java` | `[-]` | 浮动窗口装饰：本仓单窗口无浮动形态 |
| `FloatingDecoratorMarker` | `platform/ide-core-impl/src/com/intellij/openapi/wm/impl/FloatingDecoratorMarker.java` | `[-]` | 浮动装饰标记接口 |
| `FocusRequestInfo` | `platform/platform-impl/src/com/intellij/openapi/wm/impl/FocusRequestInfo.java` | `[-]` | Swing 焦点请求包装 |
| `FocusRequestor` | `platform/ide-core/src/com/intellij/openapi/wm/FocusRequestor.java` | `[-]` | Swing 焦点请求接口 |
| `FrameBoundsConverter` | `platform/project-frame/src/com/intellij/openapi/wm/impl/FrameBoundsConverter.java` | `[-]` | ProjectFrame 一族：多窗口 + 项目帧，本仓单窗口 |
| `FrameHeader` | `platform/platform-impl/src/com/intellij/openapi/wm/impl/customFrameDecorations/header/FrameHeader.kt` | `[-]` | 自绘标题栏（customFrameDecorations 一族） |
| `FrameInfoHelper` | `platform/platform-impl/src/com/intellij/openapi/wm/impl/FrameInfoHelper.kt` | `[-]` | 帧信息协助 |
| `HeaderClickTransparentListener` | `platform/platform-impl/src/com/intellij/openapi/wm/impl/headertoolbar/HeaderClickTransparentListener.kt` | `[-]` | 自绘标题栏的点击穿透 |
| `HeaderToolbarButtonLook` | `platform/platform-impl/src/com/intellij/openapi/wm/impl/customFrameDecorations/header/toolbar/HeaderToolbarButtonLook.kt` | `[-]` | 自绘无边框窗口族：标题栏/窗口按钮/边框阴影由宿主 C++ 画，前端只画内容区 |
| `HideAllToolWindowsTest` | `platform/lang-impl/testSources/com/intellij/toolWindow/HideAllToolWindowsTest.kt` | `[-]` | 上游测试类：本仓测试策略是纯逻辑单测 + SSR 渲真实组件 |
| `HideSidebarButtonTest` | `platform/lang-impl/testSources/com/intellij/toolWindow/HideSidebarButtonTest.kt` | `[-]` | 上游测试类：本仓测试策略是纯逻辑单测 + SSR 渲真实组件 |
| `IconLikeCustomStatusBarWidget` | `platform/platform-api/src/com/intellij/openapi/wm/IconLikeCustomStatusBarWidget.java` | `[-]` | 同上（图标形态） |
| `IdeBackgroundUtil` | `platform/platform-impl/src/com/intellij/openapi/wm/impl/IdeBackgroundUtil.java` | `[-]` | 背景图绘制（Swing 绘制管线） |
| `IdeFocusManagerHeadless` | `platform/platform-impl/src/com/intellij/openapi/wm/impl/IdeFocusManagerHeadless.java` | `[-]` | 无头模式焦点管理器 |
| `IdeFrame` | `platform/ide-core/src/com/intellij/openapi/wm/IdeFrame.java` | `[-]` | 主窗口对象：本仓窗口由宿主 C++ 建（`native/main.cpp`） |
| `IdeFrameDecorator` | `platform/platform-impl/src/com/intellij/openapi/wm/impl/IdeFrameDecorator.kt` | `[-]` | 窗口装饰切换（多窗口） |
| `IdeFrameEx` | `platform/project-frame/src/com/intellij/openapi/wm/ex/IdeFrameEx.java` | `[-]` | 同上（扩展） |
| `IdeFrameImpl` | `platform/platform-impl/src/com/intellij/openapi/wm/impl/IdeFrameImpl.kt` | `[-]` | 同上（实现） |
| `IdeGlassPane` | `platform/platform-api/src/com/intellij/openapi/wm/IdeGlassPane.java` | `[-]` | 玻璃面板（Swing 之上画拖动线/提示）；Web 侧对应物是 DOM 覆盖层 |
| `IdeGlassPaneEx` | `platform/platform-impl/src/com/intellij/openapi/wm/impl/IdeGlassPaneEx.java` | `[-]` | 同上（扩展） |
| `IdeGlassPaneImpl` | `platform/platform-impl/src/com/intellij/openapi/wm/impl/IdeGlassPaneImpl.kt` | `[-]` | 同上（实现） |
| `IdeGlassPaneUtil` | `platform/platform-api/src/com/intellij/openapi/wm/IdeGlassPaneUtil.java` | `[-]` | 同上（工具） |
| `IdeMenuHelper` | `platform/platform-impl/src/com/intellij/openapi/wm/impl/customFrameDecorations/header/toolbar/IdeMenuHelper.kt` | `[-]` | 自绘无边框窗口族：标题栏/窗口按钮/边框阴影由宿主 C++ 画，前端只画内容区 |
| `IdeProjectFrameHelper` | `platform/platform-impl/src/com/intellij/openapi/wm/impl/IdeProjectFrameHelper.kt` | `[-]` | 同上（实现） |
| `IdeRootPane` | `platform/platform-impl/src/com/intellij/openapi/wm/impl/IdeRootPane.kt` | `[-]` | Swing 根面板 |
| `IdeRootPaneBorderHelper` | `platform/platform-impl/src/com/intellij/openapi/wm/impl/IdeRootPaneBorderHelper.kt` | `[-]` | 根面板边框协助 |
| `IdeRootPaneNorthExtension` | `platform/platform-api/src/com/intellij/openapi/wm/IdeRootPaneNorthExtension.kt` | `[-]` | 根面板北侧扩展点 |
| `IdeaDialogBackgroundImageProvider` | `platform/platform-impl/src/com/intellij/openapi/wm/impl/IdeaDialogBackgroundImageProvider.kt` | `[-]` | 同上（产品实现） |
| `InteractiveCourseData` | `platform/platform-api/src/com/intellij/openapi/wm/InteractiveCourseData.kt` | `[-]` | 同上（数据） |
| `InteractiveCourseFactory` | `platform/platform-api/src/com/intellij/openapi/wm/InteractiveCourseFactory.kt` | `[-]` | 交互式课程（Features Trainer）：本仓无课程内容 |
| `LibraryDependentToolWindowManager` | `platform/platform-impl/src/com/intellij/openapi/wm/impl/LibraryDependentToolWindowManager.kt` | `[-]` | 库依赖工具窗口管理器（依附 LibraryDependentToolWindow） |
| `LightEditFrame` | `platform/platform-api/src/com/intellij/openapi/wm/LightEditFrame.java` | `[-]` | LightEdit 窗口：本仓无 LightEdit |
| `LinuxCustomFrameButtons` | `platform/platform-impl/src/com/intellij/openapi/wm/impl/customFrameDecorations/frameButtons/LinuxCustomFrameButtons.kt` | `[-]` | 自绘无边框窗口族：标题栏/窗口按钮/边框阴影由宿主 C++ 画，前端只画内容区 |
| `LinuxFrameButton` | `platform/platform-impl/src/com/intellij/openapi/wm/impl/customFrameDecorations/frameButtons/LinuxFrameButton.kt` | `[-]` | 自绘无边框窗口族：标题栏/窗口按钮/边框阴影由宿主 C++ 画，前端只画内容区 |
| `LinuxIconThemeConfiguration` | `platform/platform-impl/src/com/intellij/openapi/wm/impl/customFrameDecorations/frameButtons/LinuxIconThemeConfiguration.kt` | `[-]` | 自绘无边框窗口族：标题栏/窗口按钮/边框阴影由宿主 C++ 画，前端只画内容区 |
| `LinuxResizableCustomFrameButtons` | `platform/platform-impl/src/com/intellij/openapi/wm/impl/customFrameDecorations/frameButtons/LinuxResizableCustomFrameButtons.kt` | `[-]` | 自绘无边框窗口族：标题栏/窗口按钮/边框阴影由宿主 C++ 画，前端只画内容区 |
| `LinuxUiUtil` | `platform/platform-impl/src/com/intellij/openapi/wm/impl/LinuxUiUtil.kt` | `[-]` | Linux UI 工具 |
| `MacToolbarFrameHeader` | `platform/platform-impl/src/com/intellij/openapi/wm/impl/customFrameDecorations/header/MacToolbarFrameHeader.kt` | `[-]` | 自绘无边框窗口族：标题栏/窗口按钮/边框阴影由宿主 C++ 画，前端只画内容区 |
| `MacWindowMask` | `platform/platform-impl/src/com/intellij/openapi/wm/impl/MacWindowMask.kt` | `[-]` | macOS 窗口遮罩 |
| `MainFrameCustomHeader` | `platform/platform-impl/src/com/intellij/openapi/wm/impl/customFrameDecorations/header/MainFrameCustomHeader.kt` | `[-]` | 自绘无边框窗口族：标题栏/窗口按钮/边框阴影由宿主 C++ 画，前端只画内容区 |
| `MainMenuButton` | `platform/platform-impl/src/com/intellij/openapi/wm/impl/customFrameDecorations/header/toolbar/MainMenuButton.kt` | `[-]` | 自绘无边框窗口族：标题栏/窗口按钮/边框阴影由宿主 C++ 画，前端只画内容区 |
| `MenuFrameHeader` | `platform/platform-impl/src/com/intellij/openapi/wm/impl/customFrameDecorations/header/MenuFrameHeader.kt` | `[-]` | 自绘无边框窗口族：标题栏/窗口按钮/边框阴影由宿主 C++ 画，前端只画内容区 |
| `ModalityHelper` | `platform/platform-impl/src/com/intellij/openapi/wm/impl/ModalityHelper.java` | `[-]` | 模态协助（Swing 模态窗口） |
| `NoProjectStateHandler` | `platform/welcome-screen/src/com/intellij/openapi/wm/ex/NoProjectStateHandler.kt` | `[-]` | 欢迎页宿主服务（无项目状态/关闭过渡）：本仓欢迎页是前端一屏 |
| `PainterHelper` | `platform/platform-impl/src/com/intellij/openapi/wm/impl/PainterHelper.java` | `[-]` | 自绘协助（Graphics2D） |
| `PassThroughIdeFocusManager` | `platform/ide-core/src/com/intellij/openapi/wm/PassThroughIdeFocusManager.java` | `[-]` | 焦点请求直通包装（无队列时为无操作） |
| `PresentationModeProgressPanel` | `platform/platform-impl/src/com/intellij/openapi/wm/impl/status/PresentationModeProgressPanel.java` | `[-]` | 演示模式进度条（Swing）；演示模式本身已落 `src/distractionFreeSession.ts` |
| `ProjectClosingTransitionHandler` | `platform/welcome-screen/src/com/intellij/openapi/wm/ex/ProjectClosingTransitionHandler.kt` | `[-]` | 欢迎页宿主服务（无项目状态/关闭过渡）：本仓欢迎页是前端一屏 |
| `ProjectFrameBounds` | `platform/platform-impl/src/com/intellij/openapi/wm/impl/ProjectFrameBounds.kt` | `[-]` | 项目帧几何 |
| `ProjectFrameCapabilities` | `platform/project-frame/src/com/intellij/openapi/wm/ex/ProjectFrameCapabilities.kt` | `[-]` | ProjectFrame 一族：多窗口 + 项目帧，本仓单窗口 |
| `ProjectFrameCapabilitiesServiceTest` | `platform/lang-impl/testSources/com/intellij/openapi/wm/ex/ProjectFrameCapabilitiesServiceTest.kt` | `[-]` | 上游测试类 |
| `ProjectFrameCustomHeaderHelper` | `platform/platform-impl/src/com/intellij/openapi/wm/impl/ProjectFrameCustomHeaderHelper.kt` | `[-]` | 自绘标题栏协助（customFrameDecorations 一族） |
| `ProjectFrameHelper` | `platform/platform-impl/src/com/intellij/openapi/wm/impl/ProjectFrameHelper.kt` | `[-]` | 项目帧宿主（多窗口） |
| `ProjectFrameKeys` | `platform/project-frame/src/com/intellij/openapi/wm/ex/ProjectFrameKeys.kt` | `[-]` | ProjectFrame 一族：多窗口 + 项目帧，本仓单窗口 |
| `ProjectFrameToolWindowLayoutServiceTest` | `platform/lang-impl/testSources/com/intellij/toolWindow/ProjectFrameToolWindowLayoutServiceTest.kt` | `[-]` | 上游测试类：本仓测试策略是纯逻辑单测 + SSR 渲真实组件 |
| `ProjectFrameType` | `platform/project-frame/src/com/intellij/openapi/wm/ex/ProjectFrameType.kt` | `[-]` | ProjectFrame 一族：多窗口 + 项目帧，本仓单窗口 |
| `ProjectTitlePane` | `platform/platform-impl/src/com/intellij/openapi/wm/impl/customFrameDecorations/header/titleLabel/ProjectTitlePane.kt` | `[-]` | 自绘无边框窗口族：标题栏/窗口按钮/边框阴影由宿主 C++ 画，前端只画内容区 |
| `ProjectToolWindowTest` | `platform/lang-impl/testSources/com/intellij/toolWindow/ProjectToolWindowTest.kt` | `[-]` | 上游测试类：本仓测试策略是纯逻辑单测 + SSR 渲真实组件 |
| `ProjectWindowAction` | `platform/platform-impl/src/com/intellij/openapi/wm/impl/ProjectWindowAction.kt` | `[-]` | 窗口菜单里的项目窗口项（多窗口） |
| `ProjectWindowActionGroup` | `platform/lang-impl/src/com/intellij/openapi/wm/impl/ProjectWindowActionGroup.kt` | `[-]` | 同上（组） |
| `ProjectWindowActionGroupTest` | `platform/lang-impl/testSources/com/intellij/openapi/wm/impl/ProjectWindowActionGroupTest.kt` | `[-]` | 上游测试类：本仓测试策略是纯逻辑单测 + SSR 渲真实组件 |
| `RootPaneUtil` | `platform/platform-impl/src/com/intellij/openapi/wm/impl/RootPaneUtil.kt` | `[-]` | 根面板工具 |
| `SelectContentStep` | `platform/platform-impl/src/com/intellij/openapi/wm/impl/content/SelectContentStep.kt` | `[-]` | 弹层选内容步骤（Swing 列表弹层：本仓内容切换是标签点击） |
| `SelectContentTabStep` | `platform/platform-impl/src/com/intellij/openapi/wm/impl/content/SelectContentTabStep.kt` | `[-]` | 同上（标签版） |
| `SelectedEditorFilePath` | `platform/platform-impl/src/com/intellij/openapi/wm/impl/customFrameDecorations/header/titleLabel/SelectedEditorFilePath.kt` | `[-]` | 自绘无边框窗口族：标题栏/窗口按钮/边框阴影由宿主 C++ 画，前端只画内容区 |
| `ShowBundleMessagesDialogAction` | `platform/platform-impl/src/com/intellij/openapi/wm/impl/status/ShowBundleMessagesDialogAction.kt` | `[-]` | 开发者诊断动作（显示本地化消息） |
| `ShowMode` | `platform/platform-impl/src/com/intellij/openapi/wm/impl/customFrameDecorations/header/toolbar/ShowMode.kt` | `[-]` | 自绘无边框窗口族：标题栏/窗口按钮/边框阴影由宿主 C++ 画，前端只画内容区 |
| `SideStack` | `platform/platform-impl/src/com/intellij/openapi/wm/impl/SideStack.java` | `[-]` | 被别的工具窗口顶掉的窗口栈：只在 auto-hide 模式下用，本仓无 auto-hide |
| `SimpleCustomDecorationPath` | `platform/platform-impl/src/com/intellij/openapi/wm/impl/customFrameDecorations/header/titleLabel/SimpleCustomDecorationPath.kt` | `[-]` | 自绘无边框窗口族：标题栏/窗口按钮/边框阴影由宿主 C++ 画，前端只画内容区 |
| `SplitButtonAction` | `platform/platform-impl/src/com/intellij/openapi/wm/impl/SplitButtonAction.kt` | `[-]` | Swing 分裂按钮动作 |
| `SquareStripeButtonLook` | `platform/platform-impl/src/com/intellij/openapi/wm/impl/SquareStripeButtonLook.kt` | `[-]` | 条纹按钮绘制样式 |
| `SquareStripeButtonLookVerticalText` | `platform/platform-impl/src/com/intellij/toolWindow/extendedToolWindowsUi/SquareStripeButtonLookVerticalText.kt` | `[-]` | 竖排文字的条纹按钮样式 |
| `StartPagePromoter` | `platform/platform-api/src/com/intellij/openapi/wm/StartPagePromoter.kt` | `[-]` | 同上（接口） |
| `StaticAnchoredButton` | `platform/platform-impl/src/com/intellij/openapi/wm/impl/StaticAnchoredButton.java` | `[-]` | 同上（实现） |
| `StatusBarAccessibilityUtil` | `platform/platform-impl/src/com/intellij/openapi/wm/impl/status/StatusBarAccessibilityUtil.kt` | `[-]` | 状态栏无障碍工具（Swing AccessibleContext） |
| `StatusBarInfo` | `platform/ide-core/src/com/intellij/openapi/wm/StatusBarInfo.java` | `[-]` | 状态栏信息接口（Swing） |
| `StatusBarUI` | `platform/platform-impl/src/com/intellij/openapi/wm/impl/status/StatusBarUI.java` | `[-]` | 状态栏 UI 工具（Swing 布局） |
| `StatusBarUtil` | `platform/platform-impl/src/com/intellij/openapi/wm/impl/status/StatusBarUtil.kt` | `[-]` | 状态栏工具（Swing） |
| `StatusBarWidgetUsagesCollector` | `platform/platform-impl/src/com/intellij/openapi/wm/impl/status/widget/StatusBarWidgetUsagesCollector.java` | `[-]` | 上游统计采集，无用户可见行为 |
| `StatusPanel` | `platform/platform-impl/src/com/intellij/openapi/wm/impl/status/StatusPanel.java` | `[-]` | 状态栏面板（Swing 基类） |
| `StatusTextModeAction` | `platform/platform-impl/src/com/intellij/openapi/wm/impl/status/StatusTextModeAction.kt` | `[-]` | 纯文本状态栏模式（Swing 绘制开关） |
| `StripeButtonSeparator` | `platform/platform-impl/src/com/intellij/openapi/wm/impl/StripeButtonSeparator.kt` | `[-]` | 条纹分隔线（CSS 承担） |
| `StripeButtonUi` | `platform/platform-impl/src/com/intellij/toolWindow/StripeButtonUi.kt` | `[-]` | 条纹按钮外观（Swing 自绘） |
| `SwingLeakFixes` | `platform/platform-impl/src/com/intellij/openapi/wm/impl/SwingLeakFixes.kt` | `[-]` | Swing 内存泄漏修补（依附 Swing 生命周期） |
| `TabbedContentTabLabel` | `platform/platform-impl/src/com/intellij/openapi/wm/impl/content/TabbedContentTabLabel.java` | `[-]` | 同上（实现） |
| `TestRubberDuckDebuggerAction` | `platform/platform-impl/jcef/src/com/intellij/openapi/wm/impl/status/TestRubberDuckDebuggerAction.kt` | `[-]` | 调试小黄鸭彩蛋（jcef 演示动作） |
| `TestWindowManager` | `platform/platform-impl/src/com/intellij/openapi/wm/impl/TestWindowManager.java` | `[-]` | 上游测试用窗口管理器 |
| `TextCutStrategy` | `platform/platform-impl/src/com/intellij/openapi/wm/impl/TextCutStrategy.kt` | `[-]` | 同上（实现） |
| `TextPanel` | `platform/platform-impl/src/com/intellij/openapi/wm/impl/status/TextPanel.kt` | `[-]` | 状态栏文字面板（Swing） |
| `TitleActionToolbar` | `platform/platform-impl/src/com/intellij/openapi/wm/impl/headertoolbar/TitleActionToolbar.kt` | `[-]` | 自绘标题栏动作条 |
| `TitlePart` | `platform/platform-impl/src/com/intellij/openapi/wm/impl/customFrameDecorations/header/titleLabel/TitlePart.kt` | `[-]` | 自绘无边框窗口族：标题栏/窗口按钮/边框阴影由宿主 C++ 画，前端只画内容区 |
| `ToolWindowExternalDecorator` | `platform/platform-impl/src/com/intellij/openapi/wm/impl/ToolWindowExternalDecorator.kt` | `[-]` | 工具窗口外部装饰（浮动/Windowed） |
| `ToolWindowExternalDecoratorBoundsHelper` | `platform/platform-impl/src/com/intellij/openapi/wm/impl/ToolWindowExternalDecoratorBoundsHelper.kt` | `[-]` | 同上（几何：多显示器） |
| `ToolWindowHeadlessManagerImpl` | `platform/platform-impl/src/com/intellij/toolWindow/ToolWindowHeadlessManagerImpl.java` | `[-]` | 无头（测试）管理器 |
| `ToolWindowIdDataContextSerializer` | `platform/platform-impl/src/com/intellij/toolWindow/ToolWindowIdDataContextSerializer.kt` | `[-]` | Swing DataContext 序列化 |
| `ToolWindowLayoutProfileServiceTest` | `platform/lang-impl/testSources/com/intellij/toolWindow/ToolWindowLayoutProfileServiceTest.kt` | `[-]` | 上游测试类：本仓测试策略是纯逻辑单测 + SSR 渲真实组件 |
| `ToolWindowManagerDecorators` | `platform/platform-impl/src/com/intellij/openapi/wm/impl/ToolWindowManagerDecorators.kt` | `[-]` | 装饰器切换（依附浮动窗口） |
| `ToolWindowManagerLifecycle` | `platform/platform-impl/src/com/intellij/openapi/wm/impl/ToolWindowManagerLifecycle.kt` | `[-]` | 管理器生命周期（窗口级） |
| `ToolWindowManagerNotifications` | `platform/platform-impl/src/com/intellij/openapi/wm/impl/ToolWindowManagerNotifications.kt` | `[-]` | 管理器通知（窗口级） |
| `ToolWindowManagerSupport` | `platform/platform-impl/src/com/intellij/openapi/wm/impl/ToolWindowManagerSupport.kt` | `[-]` | 管理器支撑单例（窗口级） |
| `ToolWindowManagerTest` | `platform/lang-impl/testSources/com/intellij/toolWindow/ToolWindowManagerTest.kt` | `[-]` | 上游测试类：本仓测试策略是纯逻辑单测 + SSR 渲真实组件 |
| `ToolWindowManagerTestCase` | `platform/lang-impl/testSources/com/intellij/toolWindow/ToolWindowManagerTestCase.kt` | `[-]` | 上游测试类：本仓测试策略是纯逻辑单测 + SSR 渲真实组件 |
| `ToolWindowTypeExtensions` | `platform/platform-impl/src/com/intellij/openapi/wm/impl/ToolWindowTypeExtensions.kt` | `[-]` | 把 ToolWindowType 折成布尔：本仓只有 DOCKED |
| `ToolbarComboButton` | `platform/platform-impl/src/com/intellij/openapi/wm/impl/ToolbarComboButton.kt` | `[-]` | Swing 工具栏组合按钮 |
| `ToolbarComboButtonModel` | `platform/platform-impl/src/com/intellij/openapi/wm/impl/ToolbarComboButtonModel.kt` | `[-]` | 同上（模型） |
| `ToolbarComboWidget` | `platform/platform-impl/src/com/intellij/openapi/wm/impl/ToolbarComboWidget.kt` | `[-]` | 同上（部件） |
| `ToolbarFrameHeader` | `platform/platform-impl/src/com/intellij/openapi/wm/impl/customFrameDecorations/header/toolbar/ToolbarFrameHeader.kt` | `[-]` | 自绘无边框窗口族：标题栏/窗口按钮/边框阴影由宿主 C++ 画，前端只画内容区 |
| `ToolbarHolder` | `platform/platform-impl/src/com/intellij/openapi/wm/impl/ToolbarHolder.kt` | `[-]` | Swing 工具栏宿主 |
| `ToolbarSplitButton` | `platform/platform-impl/src/com/intellij/openapi/wm/impl/ToolbarSplitButton.kt` | `[-]` | Swing 工具栏分裂按钮 |
| `ToolbarSplitButtonModel` | `platform/platform-impl/src/com/intellij/openapi/wm/impl/ToolbarSplitButtonModel.kt` | `[-]` | 同上（模型） |
| `ToolbarWidthCalculationEvent` | `platform/platform-impl/src/com/intellij/openapi/wm/impl/headertoolbar/ToolbarWidthCalculationEvent.kt` | `[-]` | Swing 宽度事件 |
| `UnifiedToolWindowWeights` | `platform/platform-impl/src/com/intellij/openapi/wm/impl/UnifiedToolWindowWeights.kt` | `[-]` | 新旧 UI 权重统一（布局档案迁移） |
| `VisibilityWatcher` | `platform/platform-impl/src/com/intellij/openapi/wm/impl/VisibilityWatcher.java` | `[-]` | Swing 可见性补偿 |
| `WeakFocusStackManager` | `platform/platform-api/src/com/intellij/openapi/wm/WeakFocusStackManager.java` | `[-]` | Swing 弱引用焦点栈 |
| `WelcomeFrameProvider` | `platform/platform-api/src/com/intellij/openapi/wm/WelcomeFrameProvider.java` | `[-]` | 欢迎窗口 provider（多窗口） |
| `WelcomeScreenCustomization` | `platform/platform-api/src/com/intellij/openapi/wm/WelcomeScreenCustomization.java` | `[-]` | 欢迎页可插拔 tab 与左面板（§B `WelcomeScreen` 已登记：本仓单一布局） |
| `WelcomeScreenLeftPanel` | `platform/platform-api/src/com/intellij/openapi/wm/WelcomeScreenLeftPanel.java` | `[-]` | 欢迎页左面板 |
| `WelcomeScreenProjectProvider` | `platform/welcome-screen/src/com/intellij/openapi/wm/ex/WelcomeScreenProjectProvider.kt` | `[-]` | 欢迎页项目供给 |
| `WelcomeScreenProjectProviderImpl` | `platform/platform-impl/src/com/intellij/openapi/wm/ex/WelcomeScreenProjectProviderImpl.kt` | `[-]` | 同上（实现） |
| `WelcomeScreenProvider` | `platform/platform-api/src/com/intellij/openapi/wm/WelcomeScreenProvider.java` | `[-]` | 欢迎页 provider |
| `WelcomeScreenTab` | `platform/platform-api/src/com/intellij/openapi/wm/WelcomeScreenTab.java` | `[-]` | 欢迎页 tab 接口 |
| `WelcomeTabFactory` | `platform/platform-api/src/com/intellij/openapi/wm/WelcomeTabFactory.java` | `[-]` | 欢迎页 tab 工厂 |
| `WidgetEffectRenderer` | `platform/platform-impl/src/com/intellij/openapi/wm/impl/status/WidgetEffectRenderer.kt` | `[-]` | 组件效果绘制（Swing） |
| `WidgetPresentation` | `platform/ide-core/src/com/intellij/openapi/wm/WidgetPresentation.kt` | `[-]` | 组件的展示对象（tooltip/click consumer）：本仓是 App.vue 里的按钮属性 |
| `WinUiUtil` | `platform/platform-impl/src/com/intellij/openapi/wm/impl/WinUiUtil.kt` | `[-]` | Windows UI 工具 |
| `WindowButtonsConfiguration` | `platform/platform-impl/src/com/intellij/openapi/wm/impl/WindowButtonsConfiguration.kt` | `[-]` | 自绘窗口按钮配置 |
| `WindowDressing` | `platform/lang-impl/src/com/intellij/openapi/wm/impl/WindowDressing.kt` | `[-]` | 窗口装饰（多窗口） |
| `WindowEffects` | `platform/platform-impl/src/com/intellij/openapi/wm/impl/WindowEffects.kt` | `[-]` | 原生窗口效果接口（X11/Windows/Mac） |
| `WindowManagerEx` | `platform/platform-impl/src/com/intellij/openapi/wm/ex/WindowManagerEx.java` | `[-]` | 同上（扩展） |
| `WindowManagerImpl` | `platform/platform-impl/src/com/intellij/openapi/wm/impl/WindowManagerImpl.kt` | `[-]` | 窗口管理器（多窗口）：本仓单窗口 |
| `WindowMask` | `platform/platform-impl/src/com/intellij/openapi/wm/impl/WindowMask.kt` | `[-]` | 窗口圆角遮罩（原生窗口形状） |
| `WindowShadowPainter` | `platform/platform-impl/src/com/intellij/openapi/wm/impl/WindowShadowPainter.java` | `[-]` | 窗口阴影绘制 |
| `WindowWatcher` | `platform/platform-impl/src/com/intellij/openapi/wm/impl/WindowWatcher.java` | `[-]` | 窗口监听（Swing WindowListener） |
| `WindowedDecorator` | `platform/platform-impl/src/com/intellij/openapi/wm/impl/WindowedDecorator.kt` | `[-]` | 独立窗口装饰：同上 |
| `WindowsDialogButtons` | `platform/platform-impl/src/com/intellij/openapi/wm/impl/customFrameDecorations/frameButtons/WindowsDialogButtons.kt` | `[-]` | 自绘无边框窗口族：标题栏/窗口按钮/边框阴影由宿主 C++ 画，前端只画内容区 |
| `WindowsWindowEffects` | `platform/platform-impl/src/com/intellij/openapi/wm/impl/WindowsWindowEffects.kt` | `[-]` | Windows 原生窗口效果 |
| `X11NativeMemory` | `platform/platform-impl/src/com/intellij/openapi/wm/impl/X11NativeMemory.kt` | `[-]` | X11 原生内存查询 |
| `X11UiUtil` | `platform/platform-impl/src/com/intellij/openapi/wm/impl/X11UiUtil.java` | `[-]` | X11 UI 工具 |
| `X11WindowEffects` | `platform/platform-impl/src/com/intellij/openapi/wm/impl/X11WindowEffects.kt` | `[-]` | X11 原生窗口效果 |
| `XNextIslandHolder` | `platform/platform-impl/src/com/intellij/toolWindow/xNext/island/XNextIslandHolder.kt` | `[-]` | 新 UI 圆角岛/圆角边框：Swing 自绘装饰 |
| `XNextRoundedBorder` | `platform/platform-impl/src/com/intellij/toolWindow/xNext/island/XNextRoundedBorder.kt` | `[-]` | 新 UI 圆角岛/圆角边框：Swing 自绘装饰 |
| `package-info` | `platform/platform-impl/src/com/intellij/openapi/wm/impl/customFrameDecorations/header/package-info.java` | `[-]` | 包说明文件（不是类） |
| `package-info` | `platform/platform-impl/src/com/intellij/openapi/wm/impl/customFrameDecorations/header/titleLabel/package-info.java` | `[-]` | 包说明文件（不是类） |
| `package-info` | `platform/platform-impl/src/com/intellij/openapi/wm/impl/headertoolbar/package-info.java` | `[-]` | 包说明文件（不是类） |
| `package-info` | `platform/platform-impl/src/com/intellij/openapi/wm/impl/simpleTitleParts/package-info.java` | `[-]` | 包说明文件（不是类） |
