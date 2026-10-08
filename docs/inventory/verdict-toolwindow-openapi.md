# B2 判决：`toolwindow` + `openapi/wm` = 350 类

判定依据：机械信号（逐类读上游源码收集继承链 / `JComponent`·`Graphics2D`·Swing 组件 / 平台专属目录 X11·Windows·Mac / `testSources`）+ 本仓 `src/` `native/` 的真实引用核对（**区分三态**：真实代码引用 / 只被注释引用 / 从未出现）+ 关键家族读上游源码核对语义。

四档（同 B1）：`[x]` 已移植 · `[~]` 部分 · `[ ]` 未移植（TODO）· `[-]` 不适用（附理由）

> **本文档对 350 类逐条给判决**：§G 是**逐条总表**（350 行，机检对齐），四档合计 **22 + 94 + 0 + 234 = 350**；
> **2026-10-06（b1b7verdict lane，EP 轮）**：`ProjectWidgetActionsFilter` `[~]` → `[x]` —— EP `com.intellij.projectWidgetActionsFilter` 已落并接进项目部件那份行的过滤点（`src/projectWidgetActionsFilter.ts` + `src/projectWidget.ts` 的 `filterProjects` + `src/menuUi.ts` 传当前项目根；判据 `tests/project-widget-actions-filter.test.mjs`），四档从 20/96 变成 21/95。
> **2026-10-08（lane vc-nav，b2 计数对账）**：`ToggleReadOnlyAttributePanel` `[~]` → `[x]` —— 状态栏只读徽标的双态/点击面已全：`src/App.vue` 的 `status-locked` 芯片（`Lock`/`LockOpen` 双态、`aria-pressed`）+ `toggleReadOnlyFromStatusBar`（先存打开文档再切），落到 `src/treeActions.ts:68` 的 `toggleReadOnly` → 宿主 `native/file_queries.cpp:198` 的 `file.readOnly`；§A 的小节计数把它与另两条（`FilenameToolbarWidgetAction`/`ProjectWidgetActionsFilter`）一并计入（§A 表只列代表条目，逐条依据在 §G），四档 21/95 → 22/94。§G 逐条表即真值（22 + 94 + 0 + 234 = 350），§A/§B 的小节计数按它对齐。
> **2026-10-06（b1b7verdict lane）**：`FilenameToolbarWidgetAction` 复核升 `[x]`（`src/filenameWidget.ts` 的 `filenameWidgetVisible`/`uniqueFileName`/`recentFilesPopupRows`/`isFilenameWidgetCloseGesture`/`fileStatusKind` 逐条对上游 `:53-60`/`:62-89`/`:94-102`，消费点 `MainToolbar.vue`/`App.vue`，判据 `tests/filename-widget.test.mjs`），四档从 19/97 变成 20/96。同批把 `AutoShowProcessPopupAction`/`ColumnSelectionModePanel`/`DockToolWindowAction`/`EncodingPanel`/`IdeStatusBarImpl`/`InfoAndProgressPanel`/`InlineProgressIndicator`/`MaximizeToolWindowAction`/`PositionPanel`/`ProcessBalloon`/`ProcessPopup`/`ProjectToolbarWidgetAction`/`ProjectWidgetActionsFilter`/`SeparatorDecorator`/`ShowProcessWindowAction`/`TasksFinishedDecorator`/`ToggleReadOnlyAttributePanel` 十七行的「缺」写精确（原来多数只写一句落点、没有缺口记录）——其中 `ProjectWidgetActionsFilter` 订正了一处**记错**：上游是扩展点接口 `com.intellij.projectWidgetActionsFilter`（`ProjectWidgetActionsFilter.kt:12-16` 的 `shouldHideProjectSwitchingActions`），不是速度搜索过滤（本仓无插件运行时 ⇒ 无该 EP）。
> **2026-10-04 本轮**把状态栏组件注册表两条改判 `[x]`（`StatusBarEditorBasedWidgetFactory` / `WidgetRegistry` ——
> 复核后"缺"的是形态差异不是行为，判据 `tests/status-widgets-registry.test.mjs`），`StatusBar` / `StatusBarWidgetsActionGroup` /
> `ToolWindowManager` 三条的理由改精确。§A/§B/§C/§D 是按档归类的说明（各档的逐条依据在 §G）。**第一百零八批（2026-10-04 处置）**把最后 39 条 `[ ]` 全部改判（2 条 `[x]`、7 条 `[~]`、30 条 `[-]`），本域 `[ ]` 归零。
> **第一百零七批**把六个状态栏组件工厂按实际实现改判（3 条 `[x]`、3 条 `[~]`）。
> 第九十九批改判状态栏组件那 4 条（2 条 `[~]`：文件系统同步、内部错误；2 条 `[-]`：索引/写线程）。
> 第九十二批改判状态栏那一族 7 条（4 条 `[~]`、3 条 `[-]`）；第九十四批改判 pane 状态那一族 6 条（3 条 `[~]`、3 条 `[-]`）。
> 第九十二批的原记录：
> 4 条 `[~]`（`EditorBasedWidget` / `StatusBarEditorBasedWidgetFactory` / `StatusBarWidgetsOptionProvider` / `StatusBarEx`）、
> 3 条 `[-]`（`EditorBasedStatusBarPopup` / `StatusBarWidgetProvider` / `StatusBarWidgetProviderToFactoryAdapter`）。
>
> 2026-09-29 第三十六批把 `ResizeStripeManager` 与 `MoreSquareStripeButton` 落了地（侧条拖宽 + 「更多」按钮，
> 见 `docs/ui-placement-audit.md` §AN），顺带纠正三行写错的依据：`ToolWindowToolbar` / `ToolWindowLeftToolbar` /
> `ToolWindowRightToolbar` 原先被记成"窗口内工具栏"，它们其实是**侧条本体**的类。

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

## A. 已移植（`[x]`，全表 22 类）

| 类 | 源码 | 说明 |
|---|---|---|
| `ToolWindowAnchor` | `openapi/wm/ToolWindowAnchor.java` | 枚举 `left/right/bottom`（去掉 `FLOATING`，本仓无浮动窗口）→ `src/toolWindowMeta.ts` 的 `ToolWindowAnchor`；停靠与搬运在 `src/toolWindowStripes.ts`（`setToolAnchor`/`activationTarget`，判据 `tests/tool-window-stripes.test.mjs`、`tests/tool-layout-state.test.mjs`） |
| `ToolWindowId` | `openapi/wm/ToolWindowId.java` | 上游是常量表（`ToolWindowId.PROJECT_VIEW` 等）；本仓 `src/toolWindowMeta.ts` 的 `ToolWindowId` 联合 + `toolTitles`/`toolIcons`，Alt+数字编号与别名表同处（`src/toolWindows.ts` 的 `mnemonicOf`/`mnemonicBindings`） |
| `ToolWindowContentUiType` | `openapi/wm/ToolWindowContentUiType.java` | 两档 `TABBED`/`COMBO` → `src/toolWindowContentUi.ts`（`isTabbedContentUi`/`resolveContentUiType`/`toggledContentUiType`/`contentCountLabel`，判据 `tests/tool-window-content-ui.test.mjs`） |
| `ActiveStack` | `impl/ActiveStack.java` | 上游两条栈（短栈 + 持久栈），本仓落**持久栈**（`src/activeToolWindow.ts` 的 `pushActive`/`removeActive`/`lastActiveId`，F12 用；短栈无消费者） |
| `StatusBarEditorBasedWidgetFactory` | `impl/status/widget/StatusBarEditorBasedWidgetFactory.kt` | **2026-10-04 本轮改判 `[x]`**：`canEnableOn` = `getTextEditor(statusBar) != null`（`:14-16`）落在 `src/statusBarLifecycle.ts`（从状态栏绑定取；编辑器为空/不可见都不可开），工厂侧的 `editorBased` 标记在 `src/statusWidgets.ts`，右键勾选与「显示 <组件>」动作共用 `widgetToggleEnabled`；判据 `tests/status-widgets-registry.test.mjs` 钉住两侧同判 |
| `WidgetRegistry` | `impl/status/WidgetRegistry.kt` | **2026-10-04 本轮改判 `[x]`**：注册表就是 `src/statusWidgets.ts` 的 `STATUS_WIDGETS`（工厂表 + "哪些是可配置/是否 EP 工厂"的分档），按 id 反查 = `findWidgetFactory`（上游 `StatusBarWidgetsManager.findWidgetFactory:139`），未知 id 不猜；判据 `tests/status-widgets-registry.test.mjs`。没有另立容器对象（`LinkedHashMap` 那层在渲染模型里不需要）是形态差异，不是行为缺口 |

## B. 部分移植（`[~]`，全表 94 类）

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
| `ToolWindowContentUi` | `src/toolWindowContentUi.ts`：两档内容布局的**语义**已落 | Swing 那套内容宿主机（标签行/下拉标签的实际布局与组件树）由 Vue 模板承担（TABBED = `src/toolContentTabs.ts` + 输出条，COMBO = `src/components/ContentComboLabel.vue`） |
| `ContentLayout` | `src/toolWindowContentUi.ts`：`resolveContentUiType` 等纯逻辑 | `AbstractContentLayout` 的组件挂载/重排管线 |
| `SingleContentLayout` | `src/toolWindowContentUi.ts`：单内容不需要布局切换 | 单内容下的组件铺满与分隔线绘制 |
| `ComboContentLayout` | `src/components/ContentComboLabel.vue`（下拉标签本体：图标 + 名称 + 箭头 + 弹层列表 + 选中同步）+ `src/toolWindowContentUi.ts` 的档位语义 | 上游把选中内容组件铺进窗口的 Swing 宿主 |
| `TabContentLayout` | `src/toolContentTabs.ts`（`tabsOutsideView`/`scrollOffsetFor`/`jumpToTab`，照 `TabContentLayout.java:172-290` 的溢出算法；产品取滚动） | Swing 标签行的组件树与 `LayoutPassInfo` 通过程 |
| `ContentComboLabel` | `src/components/ContentComboLabel.vue`（`updateTextAndIcon` 的图标+名称、`myComboIcon` 的箭头、`toggleContentPopup` 的单击弹层、无障碍名） | `ComboBox.togglePopupText` 的 UIManager 取值（本仓用同义字面量） |
| `InternalDecorator` | `src/toolWindowContentUi.ts`：内容外框由 Vue 组件表达 | 装饰器（边框/工具栏挂载点/焦点搬运） |
| `InternalDecoratorImpl` | `src/toolWindowContentUi.ts`：同上 | 同上 |
| `ToolWindowSplitContentProvider` | `src/toolContents.ts`（`addToolContent`/`togglePinned`/关闭谓词，判据 `tests/tool-window-content-ui.test.mjs`） | 窗口内**分栏**（split）内容提供者 |
| `SingleContentSupplier` | `src/toolContents.ts`：单内容的供给 | 上游的 supplier 抽象层 |
| `ContentTabAction` | `src/toolContents.ts` 的 pin/close 谓词 | `ContentTabAction` 那层的动作对象与快捷键绑定 |

### B-2 条纹与拖放（7）

| 类 | 已有 | 还差 |
|---|---|---|
| `Stripe` | `src/toolWindowStripes.ts`（`stripeOrder`/`hiddenStripeButtons`/拖拽重排）+ `src/toolStripeDrag.ts` + `src/components/ToolStripe.vue`（第三十六批：拖宽的分隔线、更多按钮、空白处右键）| `ToolWindowButtonManager`（按钮管理器与工厂层）|
| `StripeButton` | `src/toolWindowStripes.ts` 的按钮 + `src/toolWindows.ts` 的 Alt+数字编号 | 按钮外观（`StripeButtonUi`/`SquareStripeButtonLook`）；名字只在注释里出现 ⇒ 按行为算 `[~]` |
| `SquareStripeButton` | `src/toolWindowStripes.ts` + `src/components/ToolStripe.vue` 的条纹按钮（新 UI 方形，外观由 CSS） | 自绘外观类与它的状态机 |
| `AbstractDroppableStripe` | `src/toolStripeDrag.ts` 的投放区高亮 | 拖放目标的服务端排序/预览 |
| `ToolWindowDragHelper` | `src/toolStripeDrag.ts`：侧条内重排 | 跨区拖放（→编辑区、→另一窗口） |
| `ToolWindowDropArea` | `src/toolStripeDrag.ts` 的 drop marker | 投放区几何计算与多目标裁决 |
| `ToolWindowStripeManager` / `ToolWindowStripeManagerImpl` | `src/toolWindowStripes.ts` 的显隐/顺序 + `src/stripeResize.ts` 的宽度（第三十六批） | 管理器抽象层与其实现（与上条同源） |

### B-3 状态栏（16）

| 类 | 已有 | 还差 |
|---|---|---|
| `StatusBar` | `src/statusBarNav.ts` + App.vue `.statusbar`（左/中/右三段、键盘遍历、组件显隐） | **注册表侧的查询已落**：按 id 反查工厂 = `src/statusWidgets.ts` 的 `findWidgetFactory`（`getWidget` 的元数据那半），此刻该不该画 = `showWidget`；**实例侧也已落**：`src/statusBarLifecycle.ts` 的 `installWidget`/`disposeWidget`/`isOurEditor`/`shouldUpdateForEditor`（照 `EditorBasedWidget.kt:57-109`，判据 `tests/status-bar-widget-instances.test.mjs`）就是 `addWidget` 的实例那一半；**缺**的只是"渲染侧持有组件实例"（模板按状态重渲，不需要常驻组件容器）—— 形态差异，见 §G |
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
| `FocusStatusBarAction` | **动作已落**：`src/menuUi.ts` 的 `window.focusStatusBar` 可搜索动作（`enabled` = 有项目，照 `FocusStatusBarAction.kt:17-19` 的 `update`）挂在动作索引里；焦点规则在 `src/statusBarNav.ts` 的 `shouldFocusFirstWidget`（focus-in 守卫）/`resolveRestoreTarget`（focus-out 回退） | 上游 `IdeStatusBarImpl.focusNextWidgetAfter`（进程面板收起后把焦点交给下一个组件的兄弟分支）—— 挂点在 App.vue 的进程面板，本仓没有对应宿主 |
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

## C. 未移植（`[ ]`，全表 0 类）—— 本批已清空

2026-10-04 处置：原表最后 39 条 `[ ]` 全部改判 —— 2 条 `[x]`、7 条 `[~]`、30 条 `[-]`：

- `[x]`：`ColumnSelectionModeWidgetFactory`（列选择徽标与开关：`src/statusWidgets.ts:69` + `src/components/CodeEditor.vue:113`）、`PowerSaveStatusWidgetFactory`（省电模式芯片与生效面：`src/statusWidgets.ts:77` + `src/App.vue:664-667`）；
- `[~]`：六个标题分段 provider（产品名段已由宿主拼进标题 `native/main.cpp:683`，缺分段模型与版本/配置目录/超级用户那几段）+ `MainToolbarQuickActions`（三条动作都在 `src/menuUi.ts` 的动作索引里，缺工具栏定制入口）；
- `[-]`：焦点 7 条（`IdeFocusManager` 一族直接委托 AWT 焦点子系统）、`tabInEditor` 20 类（伪 `VirtualFile` + `FileEditor` + `JComponent` 的 IDE 编辑器契约，本仓标签绑定文件）、`ToolWindowInnerDragHelper` / `ToolWindowToEditorTransfer` / `ToolWindowInEditorSupport`（同 tabInEditor 的前置），逐条的上游文件:行号见 §G。

历史回顾：本表曾把「每窗口状态对象」标为**最有价值的一条**（`WindowInfoImpl` / `ToolWindowManagerState` / `ToolWindowPaneState` / `ToolWindowEntry` / `ToolWindowSetInitializer`）—— 第四十二/四十三批落地后已改判 `[~]`，本批随其余条目一起清空；`StatusBarWidgetFactory` 注册表第三十批落地（`src/statusBarWidgets.ts`），`EditorBasedWidget` 生命周期第九十二批落地（`src/statusBarLifecycle.ts`）。本域 `[ ]` 归零。

## D. 不适用（`[-]`，全表 234 类）—— 附理由

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
3. **`tabInEditor` 整组**：把工具窗口当编辑器标签（20 类的完整机制）在上游是「伪 `VirtualFile` + `FileEditor` + `JComponent`」这套 IDE 编辑器契约（逐条见 §G），本仓编辑器标签绑定文件（`Tab` 带 `path`/`content`），没有 `FileEditorProvider`/VFS 可挂 ⇒ 整组判 `[-]`；若将来要做，是在 Vue 里另设一条「非文件标签」类型，不是移植这 20 个类。

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
| `AbstractDroppableStripe` | `platform/platform-impl/src/com/intellij/openapi/wm/impl/AbstractDroppableStripe.kt` | `[~]` | `src/toolStripeDrag.ts` 的 drop marker + `src/toolStripeSplit.ts`（后半组 side/split 的分组规则，照 `:254-255` 的 `setSideToolAndAnchor`；`STRIPE_SEPARATOR_*` 三条度量常量同处，判据 `tests/tool-stripe-split.test.mjs`）。**缺** 拖放目标的服务端排序/预览 |
| `AutoShowProcessPopupAction` | `platform/platform-impl/src/com/intellij/openapi/wm/impl/status/AutoShowProcessPopupAction.java` | `[~]` | 行为落：`src/processPopup.ts:71` 的 `showProgressWidget`（弹层可见性闸）+ `src/progressPanel.ts:122-126` 的 watch（有进程开始跑且开关打开就自动弹面板，照 `InfoAndProgressPanel.kt:319-321` 读一次那个注册表键）。**缺**（2026-10-06 本 lane 复算）：上游该类是 `ide.windowSystem.autoShowProcessPopup` 的**开关动作**（`AutoShowProcessPopupAction.java:14-28`，菜单/工具栏可挂的 `DumbAwareToggleAction`），本仓把同一个键升格成系统设置页的复选框（`src/components/GeneralRegistryToggles.vue:93`，键登记在 `src/registryKeys.ts:61`/`:67`）⇒ 没有"动作"形态（同 `RegistryToggleAction` 的口径），行为等价。 |
| `ColumnSelectionModePanel` | `platform/platform-impl/src/com/intellij/openapi/wm/impl/status/ColumnSelectionModePanel.java` | `[~]` | `src/statusWidgets.ts:124` 的 `column` 工厂位（`upstreamId: 'InsertOverwrite'`）+ 状态栏列模式 chip（App.vue `.statusbar`）。**缺**（2026-10-06 本 lane 复算）：上游是 `EditorBasedWidget`（`:152` 的 `Multiframe`，跟随编辑器焦点显示/隐藏并读该编辑器的列模式态，`ColumnSelectionModePanel.java:165+`），本仓是状态栏 chip（`src/statusBarLifecycle.ts` 的实例层负责 `isOurEditor`，但列模式态的多编辑器跟随未落）。 |
| `ComboContentLayout` | `platform/platform-impl/src/com/intellij/openapi/wm/impl/content/ComboContentLayout.java` | `[~]` | **下拉标签的本体已落**（2026-10-06 本 lane 复算订正：原写「`src/toolWindowContentUi.ts`：COMBO 档的下拉标签」，那是档位语义不是本体）：`src/components/ContentComboLabel.vue`（图标 + 名称 + 箭头 + 弹层列表 + 速度搜索 + 选中同步），档位语义在 `src/toolWindowContentUi.ts`；**缺** `ComboContentLayout` 的 Swing 内容宿主（把选中内容的组件铺进窗口）—— 那由 `src/components/ToolWindowView.vue` 的模板承担 |
| `ContentComboLabel` | `platform/platform-impl/src/com/intellij/openapi/wm/impl/content/ContentComboLabel.java` | `[~]` | **本体已落**（2026-10-06 本 lane 复算订正：原写「`src/toolWindowContentUi.ts` 的 `contentCountLabel`」，那只是文案）：`src/components/ContentComboLabel.vue` —— `updateTextAndIcon(getContent(), true)`（`:82-99`）= 选中项的图标 + 名称，`myComboIcon`（`:6-7`）= `ChevronDown`，单击 = `toggleContentPopup`（`:69-80` → `ToolWindowContentUi.java:862-875`），无障碍名取「显示{标签页/视图}列表」（`:192`）；行模型/速度搜索/初始选中走 `src/popupSteps.ts`。**缺** `ComboBox.togglePopupText` 的 UIManager 取值（本仓用同义字面量） |
| `ContentLayout` | `platform/platform-impl/src/com/intellij/openapi/wm/impl/content/ContentLayout.java` | `[~]` | `src/toolWindowContentUi.ts`：`resolveContentUiType` 等纯逻辑 |
| `ContentTabAction` | `platform/platform-impl/src/com/intellij/openapi/wm/impl/content/tabActions/ContentTabAction.kt` | `[~]` | `src/toolContents.ts` 的 pin/close 谓词 |
| `DesktopLayout` | `platform/platform-impl/src/com/intellij/openapi/wm/impl/DesktopLayout.kt` | `[~]` | `src/toolLayout.ts`：布局档案已落，`DesktopLayout` 权重模型没有 |
| `DockToolWindowAction` | `platform/platform-impl/src/com/intellij/openapi/wm/impl/DockToolWindowAction.java` | `[~]` | `src/menus/windowMenu.ts` 的 `window.activeToolwindowGroup`（工具窗口的浮动/停靠分组行）。**缺**（2026-10-06 本 lane 复算）：上游该类把工具窗口在 DOCKED 与 FLOATING 之间切换（`DockToolWindowAction.java:112-150` 读 `ToolWindowType` 再 `setType`），本仓单窗口宿主只有 DOCKED 一档（见 `ToolWindowType` 行）⇒ 停靠动作没有可切换的对象。 |
| `EncodingPanel` | `platform/platform-impl/src/com/intellij/openapi/wm/impl/status/EncodingPanel.java` | `[~]` | `src/statusWidgets.ts:122` 的 `encoding` 工厂位（`editorBased: true`）+ App.vue 的编码按钮。**缺**（2026-10-06 本 lane 复算）：上游是 `EditorBasedStatusBarPopup`（`EncodingPanel.java:202`，点开一个弹层改文件编码，带 `EncodingManagerListener` 的重绘），本仓是状态栏 chip + 编码选择按钮（没有那个弹层的 Swing 形态）。 |
| `FilenameToolbarWidgetAction` | `platform/platform-impl/src/com/intellij/openapi/wm/impl/headertoolbar/FilenameToolbarWidgetAction.kt` | `[x]` | 标题栏文件名部件整条落：`src/filenameWidget.ts` 的 `filenameWidgetVisible`（`:58` 对上游 `update():53-60` 的「标签条隐藏或窗口标题带全路径才显示」）、`uniqueFileName`/`filenameWidgetLabel`/`filenameWidgetTooltip`（`:80`/`:113`/`:104` 对 `updatePresentationFromFile():62-89`）、`recentFilesPopupRows`（`:131` 对 `createPopup():94-102` 的最近文件列表）、`isFilenameWidgetCloseGesture`（`:140` 对中键/Shift+左键关闭）、`fileStatusKind`（`:178` 对 VCS 状态着色）；消费点 `src/components/MainToolbar.vue` 与 `src/App.vue`（`MainToolbarCenter` 位，`PlatformActions.xml:846-848`）。判据 `tests/filename-widget.test.mjs`（18 条）、`tests/main-toolbar-render.test.mjs`。**2026-10-06 本 lane 复判**：原判词只写一句落点、档位停在 `[~]` 且无缺口记录；模块与消费方都在 ⇒ 升 `[x]`。 |
| `FocusStatusBarAction` | `platform/platform-impl/src/com/intellij/openapi/wm/impl/status/FocusStatusBarAction.kt` | `[~]` | 动作与焦点规则都已落：`src/menuUi.ts` 的 `window.focusStatusBar`（动作索引里的可搜索行，`enabled` = 有项目）+ `src/statusBarNav.ts` 的 `shouldFocusFirstWidget`/`resolveRestoreTarget`；**缺** `IdeStatusBarImpl.focusNextWidgetAfter`（进程面板收起后把焦点交给下一个组件的兄弟分支——挂点在 App.vue 的进程面板） |
| `FrameTitleBuilder` | `platform/platform-impl/src/com/intellij/openapi/wm/impl/FrameTitleBuilder.kt` | `[~]` | `native/main.cpp` 的 `SetWindowTextW`（宿主拼标题） |
| `IdeStatusBarImpl` | `platform/platform-impl/src/com/intellij/openapi/wm/impl/status/IdeStatusBarImpl.kt` | `[~]` | `src/statusBarNav.ts` 的 `focusableWidgets`（`:12-18` 的焦点环：隐藏/禁用跳过，DOM 顺序即视觉左右序，照 `:874-902`）+ App.vue 的 `.statusbar` 模板。**缺**（2026-10-06 本 lane 复算）：上游 1271 行是状态栏**容器本体**（widget 布局、左右分组、`ChildStatusBarWidget` 的嵌套状态栏、焦点环），本仓这块由 Vue 模板 + `src/statusWidgets.ts` 的注册表承担，没有容器对象。 |
| `InfoAndProgressPanel` | `platform/platform-impl/src/com/intellij/openapi/wm/impl/status/InfoAndProgressPanel.kt` | `[~]` | `src/progressPanel.ts`（后台任务 chip 的行模型 + `autoShowProcessPopup` 的 watch）+ `src/processPopup.ts`（弹层行 `popupRows`/`showProgressWidget`），消费点 App.vue。**缺**（2026-10-06 本 lane 复算）：上游 1562 行是 Swing 面板本体（进度条 + 取消按钮 + `JBPopup` 锚定 + `InfoAndProgressPanel.kt:319-321` 读注册表键），本仓没有这个 Swing 组件。 |
| `InlineProgressIndicator` | `platform/platform-impl/src/com/intellij/openapi/wm/impl/status/InlineProgressIndicator.java` | `[~]` | `src/progressPanel.ts` 的行模型（百分比轨道 + 取消通道 `ProgressCancel`）。**缺**（2026-10-06 本 lane 复算）：上游是 `ProgressIndicatorBase` 的 Swing 实现（`InlineProgressIndicator.java:50`，`JProgressBar` 自绘 + `InlineProgressIndicator` 的 `Indeterminate` 动画），本仓是纯数据行 + DOM 渲染。 |
| `InternalDecorator` | `platform/platform-impl/src/com/intellij/openapi/wm/impl/InternalDecorator.java` | `[~]` | `src/toolWindowContentUi.ts`：内容外框由 Vue 组件承担 |
| `InternalDecoratorImpl` | `platform/platform-impl/src/com/intellij/toolWindow/InternalDecoratorImpl.kt` | `[~]` | `src/toolWindowContentUi.ts`：同上 |
| `LineSeparatorPanel` | `platform/platform-impl/src/com/intellij/openapi/wm/impl/status/LineSeparatorPanel.java` | `[~]` | `src/statusWidgets.ts` 的 lineSeparator 项 |
| `MainMenuWithButton` | `platform/platform-impl/src/com/intellij/openapi/wm/impl/headertoolbar/MainMenuWithButton.kt` | `[~]` | `src/mergedMainMenu.ts`：溢出折叠已按上游算法落 |
| `MainToolbar` | `platform/platform-impl/src/com/intellij/openapi/wm/impl/headertoolbar/MainToolbar.kt` | `[~]` | `src/components/MainToolbar.vue`（行结构/内缩/组间距/溢出折叠） |
| `MaximizeToolWindowAction` | `platform/platform-impl/src/com/intellij/openapi/wm/impl/MaximizeToolWindowAction.java` | `[~]` | `src/menus/windowMenu.ts:142` 的 `window.maximizeToolWindow`（标题随状态「最大化/恢复工具窗口大小」、`enabled: canMaximize`、`run: maximizeActiveToolWindow`，键位 `Ctrl+Shift+F12`）+ `src/toolWindowPaneState.ts:59` 的 `isMaximized` + `src/toolWindowManager.ts:258` 的 `isMaximized: maximizedId === id`（照 `:41-44` 按窗口身份比）。**缺**（2026-10-06 本 lane 复算）：上游是 `AnAction implements FusAwareAction`（`MaximizeToolWindowAction.java:55`），带 FUS 遥测上报；本仓无遥测（同 §E 口径），行为面已全。 |
| `MemoryUsagePanel` | `platform/platform-impl/src/com/intellij/openapi/wm/impl/status/MemoryUsagePanel.java` | `[~]` | `src/memoryWidget.ts` + 状态栏内存 chip |
| `MemoryUsagePanelScheduler` | `platform/platform-impl/src/com/intellij/openapi/wm/impl/status/MemoryUsagePanelScheduler.kt` | `[~]` | `src/memoryWidget.ts` 的轮询（无调度器抽象） |
| `PlatformFrameTitleBuilder` | `platform/platform-impl/src/com/intellij/openapi/wm/impl/PlatformFrameTitleBuilder.kt` | `[~]` | `native/main.cpp`：同上 |
| `PositionPanel` | `platform/platform-impl/src/com/intellij/openapi/wm/impl/status/PositionPanel.kt` | `[~]` | `src/statusWidgets.ts:120` 的 `position` 工厂位（「行:列号」chip，文案取 `status.bar.position.widget.name`）+ App.vue `.statusbar`。**缺**（2026-10-06 本 lane 复算）：上游是 `EditorBasedWidget`（`PositionPanel.kt:263` 起，跟随光标 `CaretListener` 实时更新 + 点击弹 `EditorGotoLineNumberDialog` 跳行），本仓 chip 由模板驱动、点击跳行对话框未落。 |
| `ProcessBalloon` | `platform/platform-impl/src/com/intellij/openapi/wm/impl/status/ProcessBalloon.kt` | `[~]` | 通知走 `src/notices.ts` 的 notices 通道（`src/processPopup.ts` 的行模型供其取内容）。**缺**（2026-10-06 本 lane 复算）：上游 `ProcessBalloon` 是状态栏上的**气泡**（`JBPopup` 挂在进度 chip 上，点开即 `ProcessPopup`），本仓用通用通知列表（NoticeList）而不是状态栏气泡。 |
| `ProcessPopup` | `platform/platform-impl/src/com/intellij/openapi/wm/impl/status/ProcessPopup.java` | `[~]` | `src/processPopup.ts:51` 的 `popupRows`（行模型：task/finished/empty 三档）+ `:71` 的 `showProgressWidget`（可见性闸，照 `:100-133`）+ `:82` 的 `updateFinishedLatch`（finished 闸），消费点 App.vue。**缺**（2026-10-06 本 lane 复算）：上游 406 行是 Swing 弹层本体（`ProcessPopup.java:64` 的 `JBPopup` + 自绘行 + 锚定到状态栏 chip），本仓是 DOM 弹层。 |
| `ProgressComponent` | `platform/platform-impl/src/com/intellij/openapi/wm/impl/status/ProgressComponent.kt` | `[~]` | `src/progressPanel.ts` 的百分比轨道 |
| `ProgressIndicatorEx` | `platform/core-impl/src/com/intellij/openapi/wm/ex/ProgressIndicatorEx.java` | `[~]` | `src/progressPanel.ts`：取消通道 `ProgressCancel` |
| `ProjectToolbarWidgetAction` | `platform/platform-impl/src/com/intellij/openapi/wm/impl/headertoolbar/ProjectToolbarWidgetAction.kt` | `[~]` | `src/projectWidget.ts` 的 `filterProjects`（`:25`）+ `groupProjects`（`:40`）+ `MAX_PROJECT_WIDGET_ITEMS`（`:22`），消费点 `src/components/MainToolbar.vue` 与 `src/App.vue`（标题栏项目部件）。**缺**（2026-10-06 本 lane 复算）：上游是 `ExpandableComboAction`（`ProjectToolbarWidgetAction.kt:119`，可展开的组合按钮 + 项目切换弹层 + `ProjectToolbarWidgetPresentable`），本仓是标题栏部件（形态不同）。 |
| `ProjectWidgetActionsFilter` | `platform/platform-impl/src/com/intellij/openapi/wm/impl/headertoolbar/ProjectWidgetActionsFilter.kt` | `[x]` | **2026-10-06（b1b7verdict lane）升档**：上一轮订正过「上游是扩展点接口 `com.intellij.projectWidgetActionsFilter`（`PlatformWidgetActionsFilter.kt:12-16` 的 `shouldHideProjectSwitchingActions(event)`），本仓无插件运行时 ⇒ 无该 EP」——按规约变更（**缺失能力要暴露成与 IDEA 相同的方法给第三方插件使用**）该理由作废，EP 已落：`src/projectWidgetActionsFilter.ts` 声明 `com.intellij.projectWidgetActionsFilter`（EP 声明坐标 `platform/platform-impl/resources/intellij.platform.ide.impl.xml:371`）+ `registerProjectWidgetActionsFilterExtension`/`unregister…`/`projectWidgetActionsFilters`/`shouldHideProjectSwitchingActions`（同名方法面，任一条答 true 就藏）。**真消费侧**：`src/projectWidget.ts` 的 `filterProjects` 逐条问一次（第二道闸，速度搜索之后），`src/menuUi.ts` 的项目部件分组把当前项目根传进去。没有 provider 时行为一字不变（`tests/project-widget.test.mjs`），有贡献时真的少一行（`tests/project-widget-actions-filter.test.mjs`，含注册/注销/聚合）。 |
| `SeparatorDecorator` | `platform/platform-impl/src/com/intellij/openapi/wm/impl/status/SeparatorDecorator.kt` | `[~]` | `src/processPopup.ts` 的 `separator` 字段（按行位置决定分隔）。**缺**（2026-10-06 本 lane 复算）：上游 `SeparatorDecorator.kt` 是状态栏**装饰器**（在相邻 widget 之间插竖分隔线），本仓分隔线在 CSS 里（`.statusbar` 的子元素边框），没有装饰器对象。 |
| `ShowProcessWindowAction` | `platform/platform-impl/src/com/intellij/openapi/wm/impl/status/ShowProcessWindowAction.java` | `[~]` | `src/processPopup.ts`：列表在同一条弹层里（`popupRows` + `showProgressWidget`，空闲时也能开）。**缺**（2026-10-06 本 lane 复算）：上游是动作（`ShowProcessWindowAction.java:16-55`，点开进度窗口），本仓弹层由状态栏 chip 锚定（没有独立动作入口）。 |
| `SingleContentLayout` | `platform/platform-impl/src/com/intellij/openapi/wm/impl/content/SingleContentLayout.kt` | `[~]` | `src/toolWindowContentUi.ts`：单内容布局由 Vue 模板表达 |
| `SingleContentSupplier` | `platform/platform-impl/src/com/intellij/openapi/wm/impl/content/SingleContentSupplier.kt` | `[~]` | `src/toolContents.ts`：单内容供给者 |
| `SquareStripeButton` | `platform/platform-impl/src/com/intellij/openapi/wm/impl/SquareStripeButton.kt` | `[~]` | `src/toolWindowStripes.ts` 的按钮集合（Alt+数字编号、悬停激活、显隐）+ `src/components/ToolStripe.vue` 的渲染（新 UI 方形，外观层由 CSS 承担）+ `src/toolStripeSplit.ts` 的后半组规则。**缺** 上游 `SquareStripeButtonLook` 那套自绘状态机（选中/悬停/按下三档外观对象） |
| `StatusBar` | `platform/ide-core/src/com/intellij/openapi/wm/StatusBar.kt` | `[~]` | `src/statusBarNav.ts` + App.vue `.statusbar`：**注册表侧查询已落** —— 按 id 反查工厂 = `src/statusWidgets.ts` 的 `findWidgetFactory`（`getWidget` 的元数据那半，判据 `tests/status-widgets-registry.test.mjs`）、此刻该不该画 = `showWidget`；**实例侧也已落**（2026-10-06 本 lane 复算订正：原写「没有的是实例容器（`addWidget`）…不需要那层」，但磁盘上 `src/statusBarLifecycle.ts` 已把实例建出来并立了判据）：`installWidget`/`disposeWidget`/`isOurEditor`/`shouldUpdateForEditor`（照 `EditorBasedWidget.kt:57-109`）就是 `addWidget`/`getWidget` 的实例那一半，判据 `tests/status-bar-widget-instances.test.mjs`/`tests/status-bar-lifecycle.test.mjs`；消费点是 `src/statusWidgets.ts` 的 `findWidgetFactory` 与 `src/statusBarLifecycle.ts` 的 `canEnableOn`（`StatusBarEditorBasedWidgetFactory.canEnableOn` 的等价物）。**缺**的只是"渲染侧持有实例对象"（本仓模板按状态重渲，不需要常驻组件容器） |
| `StatusBarWidget` | `platform/ide-core/src/com/intellij/openapi/wm/StatusBarWidget.kt` | `[~]` | `src/statusWidgets.ts`：固定清单，无 presentation 接口层 |
| `Stripe` | `platform/platform-impl/src/com/intellij/toolWindow/Stripe.java` | `[~]` | `src/toolWindowStripes.ts`（`stripeOrder`/`hiddenStripeButtons`/显隐）+ `src/toolStripeDrag.ts`（重排）+ `src/toolStripeSplit.ts`（后半组与分隔线）+ `src/components/ToolStripe.vue`（渲染）。**缺** 上游 `Stripe` 的按钮容器对象与自绘 |
| `StripeButton` | `platform/platform-impl/src/com/intellij/toolWindow/StripeButton.kt` | `[~]` | `src/toolWindowStripes.ts` 的按钮与 `stripeOrder`（外观/UI 类没有） |
| `TabContentLayout` | `platform/platform-impl/src/com/intellij/openapi/wm/impl/content/TabContentLayout.java` | `[~]` | **溢出/滚动那一半已落并已接**（2026-10-06 本 lane 复算订正：原写「`src/toolWindowContentUi.ts`：TABBED 档的标签行」，未指出算法落点）：`src/toolContentTabs.ts` 的 `tabsOutsideView`/`scrollOffsetFor`/`jumpToTab`（照 `TabContentLayout.java:172-290` 的 `requiredWidth`/`toFitWidth`/两端丢标签，`TAB_LAYOUT_START=4`/`MORE_ICON_BORDER=6` 逐条对过；本仓产品取滚动而非"丢弃 + more popup"，见文件头），消费点是 `src/App.vue:426-428`（`outputTabsRef` + `useToolContentTabs`）与输出条尾的「…」下拉（`:2206` 的 `hiddenOutputTabs`/`jumpToOutputTab`）；档位语义在 `src/toolWindowContentUi.ts`。**缺** Swing 标签行的组件树与 `LayoutPassInfo` 通过程 |
| `TasksFinishedDecorator` | `platform/platform-impl/src/com/intellij/openapi/wm/impl/status/TasksFinishedDecorator.kt` | `[~]` | `src/processPopup.ts:82` 的 `updateFinishedLatch`（照 `TasksFinishedDecorator.kt:23-32`：启动后从未见过指示器时 latch 不翻真）+ `popupRows` 的 `ALL_TASKS_FINISHED` 文案（`IdeBundle.properties:3346`）。**缺**（2026-10-06 本 lane 复算）：上游 `TasksFinishedDecorator.kt:19-46` 是状态栏**装饰器**（完成时高亮 chip），本仓用弹层文案表达同一状态。 |
| `TitleInfoProvider` | `platform/platform-impl/src/com/intellij/openapi/wm/impl/TitleInfoProvider.kt` | `[~]` | `native/main.cpp`：无分段 provider 模型 |
| `ToggleReadOnlyAttributePanel` | `platform/platform-impl/src/com/intellij/openapi/wm/impl/status/ToggleReadOnlyAttributePanel.kt` | `[x]` | `src/App.vue` 状态栏读当前标签文件属性，以 `Lock`/`LockOpen` 区分只读/可写；点击先保存打开文档，再经 `toggleReadOnly` → `file.readOnly` 写回并同步编辑器只读态。对应上游 `icon()` 双态、`getClickConsumer()` 保存后反转 writable 属性。 |
| `ToolWindow` | `platform/ide-core/src/com/intellij/openapi/wm/ToolWindow.java` | `[~]` | `src/toolWindowMeta.ts` + `src/toolWindowStripes.ts` + `src/components/ToolWindowView.vue` |
| `ToolWindowContentUi` | `platform/platform-impl/src/com/intellij/openapi/wm/impl/content/ToolWindowContentUi.java` | `[~]` | 档位语义在 `src/toolWindowContentUi.ts`（`resolveContentUiType`/`isTabbedContentUi`/`contentCountLabel`），两个内容宿主都在 DOM：TABBED = 输出条（`src/toolContentTabs.ts` + `src/App.vue:2206`），COMBO = `src/components/ContentComboLabel.vue`（`toggleContentPopup` 的等价物）。**缺** Swing 那套内容宿主机与 `SelectContentStep` 的对象形态（本仓是纯函数 + 模板） |
| `ToolWindowContextMenuActionBase` | `platform/platform-impl/src/com/intellij/openapi/wm/ToolWindowContextMenuActionBase.java` | `[~]` | `src/menus/toolWindowGear.ts`：动作基类折成齿轮行表 |
| `ToolWindowDefaultLayoutManager` | `platform/platform-impl/src/com/intellij/toolWindow/ToolWindowDefaultLayoutManager.kt` | `[~]` | `src/toolLayouts.ts` 的工厂默认布局 |
| `ToolWindowDragHelper` | `platform/platform-impl/src/com/intellij/toolWindow/ToolWindowDragHelper.kt` | `[~]` | `src/toolStripeDrag.ts`（侧条内重排 + 投放区）+ `src/toolStripeSplit.ts`（`splitForDrop`：拖过分隔线就翻 `isSplit`，照 `AbstractDroppableStripe.kt:254-255`）。**缺**：跨区拖放（→编辑区、→另一窗口）与"拖出成独立窗口" |
| `ToolWindowDropArea` | `platform/platform-impl/src/com/intellij/toolWindow/ToolWindowDropArea.kt` | `[~]` | `src/toolStripeDrag.ts` 的投放区高亮 + `src/toolStripeSplit.ts` 的 `stripeSeparatorIndex`/`splitForDrop`（分隔线位置与"拖过去算不算过线"）。**缺** 多目标裁决（本仓只有侧条内一条轴） |
| `ToolWindowEx` | `platform/platform-impl/src/com/intellij/openapi/wm/ex/ToolWindowEx.java` | `[~]` | **统一门面已落**（2026-10-06 本 lane 复算订正：原写「`src/toolWindowStripes.ts`：同上」，与磁盘不符）：`src/toolWindowManager.ts` 的 `toolWindowManager()` 给出 `getToolWindow`/`windowInfo`/`toolWindowIds`/`toolWindowIdSet`/`activeToolWindowId`/`lastActiveToolWindowId`/`getIdsOn`/`toolWindows`/`canCloseContents`/`isEditorComponentActive`/`invokeLater`/`setViewMode`（逐条带 `ToolWindowManager.kt:112-144`/`ToolWindowManagerEx.kt:19/50` 行号），`ToolWindowInfo` 聚合 20 个 `WindowInfo` 字段；消费点 `src/components/ToolWindowHeader.vue`/`src/components/ToolStripe.vue`/`src/menus/toolWindowGear.ts`/`src/toolWindowActions.ts`（判据 `tests/tool-window-manager.test.mjs`）。**缺** `clearSideStack`（本仓一个 dock 同时只装一个窗口，没有侧栈可清） |
| `ToolWindowHeader` | `platform/platform-impl/src/com/intellij/toolWindow/ToolWindowHeader.kt` | `[~]` | `src/components/ToolWindowHeader.vue` + `src/toolWindowHeader.ts`（标题 + ⋮ 动作组 + 隐藏/最大化），动作组按 id 引用主菜单（`src/menus/toolWindowGear.ts`）；`windowInfo(id)` 的聚合对象已接（见 `ToolWindowEx` 行）。**缺** `:129-160` 的 `getChildren`（把当前内容自己的动作插进标题栏的 generic content-actions 通道） |
| `ToolWindowImpl` | `platform/platform-impl/src/com/intellij/openapi/wm/impl/ToolWindowImpl.kt` | `[~]` | `src/toolWindowActions.ts` + `src/toolWindowMeta.ts`：内容 UI 类型随窗口走已落；`isSplitMode` 在 `src/toolWindowManager.ts` 的 `ToolWindowInfo.isSplit`（`toolWindowSplitDefault` 的注册表来源 + 布局覆盖）；`isAvailable` 走 `toolWindowRegistration`/`shouldBeAvailable`。**缺** `StripeTitleProvider` 与 1200+ 行的完整面 |
| `ToolWindowManagerEx` | `platform/platform-impl/src/com/intellij/openapi/wm/ex/ToolWindowManagerEx.kt` | `[~]` | **统一门面已落**（2026-10-06 本 lane 复算订正：原写「查询面散在几个模块，无统一门面」，与磁盘不符）：`src/toolWindowManager.ts` 的 `getIdsOn`（`ToolWindowManagerEx.kt:50`）、`toolWindows`（`:19`）、`toolWindowSplitDefault`（EP `secondary` → `sideTool`）；消费点见 `ToolWindowEx` 行，判据 `tests/tool-window-manager.test.mjs`。**缺** `getToolWindowManagerListeners`（`DesktopLayout` 权重模型那一层，本仓侧条存像素宽度）与 `clearSideStack` |
| `ToolWindowManagerImpl` | `platform/platform-impl/src/com/intellij/openapi/wm/impl/ToolWindowManagerImpl.kt` | `[~]` | **聚合对象已落**（2026-10-06 本 lane 复算订正：原写「无 layoutState/WindowInfo 聚合对象」，与磁盘不符）：`src/toolWindowManager.ts` 的 `ToolWindowInfo`（`WindowInfo` 20 字段聚合）+ `assembleWindowInfo`（全字段现读 source、不本地缓存），激活路径按 `activateToolWindow` 的锚点规则照抄（`src/toolWindowStripes.ts` 的 `activationTarget`）。**缺** `layoutState` 的完整模型（本仓布局存 `src/toolLayoutProfiles.ts` 的每窗口一条记录，见 `WindowInfoImpl` 行） |
| `ToolWindowPane` | `platform/platform-impl/src/com/intellij/toolWindow/ToolWindowPane.kt` | `[~]` | **per-pane 状态对象已落**（2026-10-06 本 lane 复算订正：原写「无 per-pane state 对象」，与磁盘不符）：`src/toolWindowPaneState.ts`（`preferredSplitProportion`/`splitSizeOrDefault`/`withSplitProportion`/`isMaximized`，照 `ToolWindowPaneState.kt:20-44`）+ `src/toolWindowManager.ts` 的 `toolWindowPaneId`（`WindowInfo.kt:7` 的默认 `"root"`）；布局在 `src/toolLayouts.ts`/`src/panelResize.ts`。**缺** `isStripesOverlaid`（本仓没有侧条叠加态） |
| `ToolWindowSplitContentProvider` | `platform/platform-impl/src/com/intellij/toolWindow/ToolWindowSplitContentProvider.kt` | `[~]` | `src/toolContents.ts`（多内容 `addToolContent`/`togglePinned`/关闭谓词那一半，判据 `tests/tool-window-content-ui.test.mjs`）。**窗口内分栏的落点也已明确**（2026-10-06 本 lane 复算）：`src/toolStripeSplit.ts` 的 `splitStripeButtonsLast`/`stripeSeparatorIndex`/`splitForDrop`（照 `AbstractDroppableStripe.kt:254-255` 的 `setSideToolAndAnchor` 与 `DesktopLayout.kt:46` 的 EP 初值）+ `src/toolWindowManager.ts` 的 `ToolWindowInfo.isSplit`。**缺**：上游「一个窗口里放多条内容并各占一格」的 split 内容树（本仓一个 dock 一格，分栏是**窗口之间**的分屏） |
| `ToolWindowStripeManager` | `platform/platform-impl/src/com/intellij/toolWindow/ToolWindowStripeManager.kt` | `[~]` | **显隐/顺序/宽度/溢出按钮都已落**（2026-10-06 本 lane 复算订正：原写「无 ResizeStripeManager/溢出按钮管理」，与磁盘不符）：`src/toolWindowStripes.ts` 的 `stripeOrder`/`hiddenStripeButtons`/`moreButtonRows`/`moreButtonSide`，宽度与拖拽收尾在 `src/stripeResize.ts`（`ResizeStripeManager` 的等价物），溢出按钮「更多」在 `src/components/ToolStripe.vue`；分组规则（后半组 side/split）在 `src/toolStripeSplit.ts`（判据 `tests/tool-stripe-split.test.mjs`）。**缺** 管理器抽象层（本仓是散在几处的纯函数，没有 `ToolWindowStripeManager` 对象） |
| `ToolWindowStripeManagerImpl` | `platform/platform-impl/src/com/intellij/toolWindow/ToolWindowStripeManagerImpl.kt` | `[~]` | 同上：`src/toolWindowStripes.ts` + `src/stripeResize.ts` + `src/toolStripeSplit.ts`。**缺** 实现类对象（与上条同源） |
| `ToolWindowType` | `platform/ide-core/src/com/intellij/openapi/wm/ToolWindowType.java` | `[~]` | `src/toolWindowMeta.ts`：只兑现 DOCKED |
| `ToolWindowsWidget` | `platform/platform-impl/src/com/intellij/openapi/wm/impl/status/ToolWindowsWidget.java` | `[~]` | `src/App.vue` 的 `.status-toolwindows` 按钮 + `groupedAvailableToolWindows` 分组弹层（判据 `tests/status-toolwindows-popup.test.mjs`） |
| `WelcomeScreen` | `platform/platform-api/src/com/intellij/openapi/wm/WelcomeScreen.java` | `[~]` | `src/components/WelcomePage.vue` + `src/welcomeProjects.ts` |
| `WindowInfo` | `platform/platform-api/src/com/intellij/openapi/wm/WindowInfo.kt` | `[~]` | **每窗口聚合对象已落**（2026-10-06 本 lane 复算订正：原写「可见/锚点/顺序分散，无每窗口聚合对象」，与磁盘不符）：`src/toolWindowManager.ts` 的 `ToolWindowInfo`（`id`/`order`/`stripeWidth`/`isVisible`/`anchor`/`floatingBounds`/`isMaximized`/`isSplit`/`type`/`isActiveOnStart`/`isAutoHide`/`isDocked`/`isShowStripeButton`/`contentUiType`/`toolWindowPaneId`/`viewMode`/`isAvailable` 逐条对 `WindowInfo.kt:9-50`）+ `windowInfo(id)`/`assembleWindowInfo`；写入侧在 `src/toolLayoutProfiles.ts` 的 `WindowInfo` 记录 + `src/toolWindowStripes.ts`。**缺** `weight`/`sideWeight`（本仓存像素宽度 `stripeWidth`，如实差异见 `src/toolWindowManager.ts` 文件头）与 `internalType`（没有暂存态） |
| `defaultToolWindowlayoutProvider` | `platform/platform-impl/src/com/intellij/toolWindow/defaultToolWindowlayoutProvider.kt` | `[~]` | `src/toolLayouts.ts` 的工厂默认布局 + `src/toolWindowManager.ts` 的 `toolWindowSplitDefault`（EP `secondary` → `sideTool` → `DesktopLayout.kt:46` 的初值）。**缺** 上游 provider 的 V1/V2 顺序与 profile 迁移 |
| `requestFocusInToolWindow` | `platform/platform-impl/src/com/intellij/toolWindow/requestFocusInToolWindow.kt` | `[~]` | `src/toolWindowActions.ts` 的 `focusToolWindowContent`（同名能力，实现形态不同） |
| `toolWindowNamesChange` | `platform/platform-impl/src/com/intellij/toolWindow/toolWindowNamesChange.kt` | `[~]` | `src/toolWindowMeta.ts` 的 `toolTitles` 常量表（无运行时改名通道） |
| `toolwindow` | `platform/platform-impl/src/com/intellij/toolWindow/toolwindow.kt` | `[~]` | `src/toolWindowMeta.ts`（同包工具函数族：`mnemonicOf` 等） |
| `BaseFocusWatcher` | `platform/util/ui/src/com/intellij/openapi/wm/BaseFocusWatcher.java` | `[-]` | Swing 专有：`BaseFocusWatcher.java:8-21`（`javax.swing.JMenuBar/JMenuItem`、`java.awt.AWTEvent/Component/Container`、`ContainerListener`/`FocusListener`），是给 Swing 组件树挂焦点监视的抽象基类；本仓没有 Swing 组件树与 AWT 焦点事件 |
| `ColumnSelectionModeWidgetFactory` | `platform/platform-impl/src/com/intellij/openapi/wm/impl/status/ColumnSelectionModeWidgetFactory.java` | `[x]` | 列选择模式徽标。本仓：`src/statusWidgets.ts:69` 的 `column` 工厂位（`upstreamId: 'InsertOverwrite'`、`editorBased: true`）+ `src/components/CodeEditor.vue:113` 的 `toggleColumnSelection` + 状态栏芯片（`src/App.vue`，`columnMode && showWidget('column')`，Alt+Shift+Insert）。上游 `canBeEnabledOn` 要求 `editor.isColumnMode()`（`:24-27`），本仓 `editorBased` 且只在模式开启时显示，同一条判据；`createWidget → ColumnSelectionModePanel`（`:29-32`）由芯片承载。厂表默认值与 upstreamId 的判据在 `tests/status-bar-widgets.test.mjs`。 |
| `ConfigFolderTitleInfoProvider` | `platform/platform-impl/src/com/intellij/openapi/wm/impl/simpleTitleParts/ConfigFolderTitleInfoProvider.kt` | `[~]` | 宿主标题已由 C++ 拼（`native/main.cpp:683` 的 `heading + " — TaoCode"`，`:891` 同）；**缺**：`ConfigFolderTitleInfoProvider.kt:8-16` 把配置目录作为独立一段（`ide.config.folder.in.title` 开关，超长按窗口宽省略）—— 本仓没有分段模型，也没有配置目录段 |
| `EditorBasedStatusBarPopup` | `platform/platform-impl/src/com/intellij/openapi/wm/impl/status/EditorBasedStatusBarPopup.kt` | `[-]` | `EditorBasedWidget` 的**弹层版**（点击弹出一个 `JBPopup`）。本仓的状态栏 chip 用的是自绘弹层（`AnchoredMenu` / `openStatusMenu` 那条路），不是 Swing `JBPopup` 的继承体系。 |
| `EditorBasedWidget` | `platform/platform-impl/src/com/intellij/openapi/wm/impl/status/EditorBasedWidget.kt` | `[~]` | 跟着当前编辑器走的 widget 基类。**第九十二批已落**：`src/statusBarLifecycle.ts` 的 `installWidget` / `disposeWidget` / `isOurEditor` / `selectedFile` / `shouldUpdateForEditor`（逐条照 `EditorBasedWidget.kt:57-109`，含 `install` 那条"不许装到别的窗口"的断言与 dispose 后全面关门）。**缺**：`MessageBusConnection` 的 `registerCustomListeners`（本仓没有消息总线，Swing 概念）。 |
| `EncodingPanelWidgetFactory` | `platform/platform-impl/src/com/intellij/openapi/wm/impl/status/EncodingPanelWidgetFactory.java` | `[x]` | 编码徽标 + 弹层（重新读取 / 转换保存 / BOM）。本仓：`src/statusWidgets.ts:67` 的 `encoding` 工厂位 + `src/App.vue` 的编码弹层（`openEncoding` 的三档动作与 BOM 勾选，文案取中文包）。 |
| `FatalErrorWidgetFactory` | `platform/platform-impl/src/com/intellij/openapi/wm/impl/status/FatalErrorWidgetFactory.java` | `[~]` | 内部错误指示器。**第九十九批已落**（跨层）：宿主 `native/diagnostics.cpp` 的 `event(..., "ERROR", ...)` 记进进程内账本（上限 50）+ `internal_errors()` 查询面 + 路由 `app.internalErrors`；前端 `src/internalErrors.ts`（纯逻辑）+ `src/components/InternalErrorsChip.vue`（芯片 + 列表弹层 + 「显示日志」出路 + 30s 轮询）。显示名取 `status.bar.fatal.error.widget.name`（中文包「内部错误」）；**用户不可开关**照 `:32-42` 的 `isConfigurable = false` + `canBeEnabledOn = false` ⇒ 不进勾选清单、按"有没有错误"自己显形。**缺**：上游点开是带异常栈的错误对话框（本仓列时间 + 消息两列，没有栈可看）。 |
| `FocusMainToolbarAction` | `platform/platform-impl/src/com/intellij/openapi/wm/impl/headertoolbar/FocusMainToolbarAction.kt` | `[x]` | `src/mainToolbarFocus.ts` 的 `focusMainToolbar`（守卫：焦点已在工具栏/标题栏里就不动）+ 动作索引里的 `window.focusMainToolbar` 行（`PlatformActions.xml:1364` 是顶层 reference，与 `FocusStatusBar` 相邻） |
| `FocusManagerImpl` | `platform/platform-impl/src/com/intellij/openapi/wm/impl/FocusManagerImpl.java` | `[-]` | Swing/AWT 焦点子系统实现：`FocusManagerImpl.java:39/87/226-236` 直接操作 `java.awt.KeyboardFocusManager`（`getCurrentKeyboardFocusManager().addPropertyChangeListener(...)`/`getFocusOwner()`），`:14-15` 还管 `JBPopup`/`StackingPopupDispatcher`；本仓焦点是浏览器 DOM 焦点，没有可排队的 AWT 子系统 |
| `FocusWatcher` | `platform/util/ui/src/com/intellij/openapi/wm/FocusWatcher.java` | `[-]` | Swing 专有：`FocusWatcher.java:10-20`（`javax.swing.SwingUtilities`/`JTextComponent`、`java.awt.AWTEvent/Component`、`FocusEvent`），extends `BaseFocusWatcher` 追踪 Swing 组件树里的焦点归属；本仓没有这条链路 |
| `IdeFocusManager` | `platform/ide-core/src/com/intellij/openapi/wm/IdeFocusManager.java` | `[-]` | 通用焦点管理器的语义直接委托 AWT 焦点子系统：`IdeFocusManager.java:16-22`（`javax.swing.JComponent`/`SwingUtilities`、`java.awt.Component/Window`，类注释原文 "delegates to the AWT focus subsystem"），面是 `requestFocus(...): ActionCallback`/`getFocusOwner()`/`doWhenFocusSettlesDown`；本仓焦点由浏览器管理，分面的焦点行为另有 `src/statusBarNav.ts`/`src/mainToolbarFocus.ts`/`src/editorFocus.ts` |
| `IdeFocusManagerImpl` | `platform/platform-impl/src/com/intellij/openapi/wm/impl/IdeFocusManagerImpl.java` | `[-]` | 同上（实现）：`IdeFocusManagerImpl.java:14-24`（`javax.swing.JComponent`、`java.awt.Component/Window` 的 `requestFocus`/`getFocusTargetFor`），依赖 `IdeFocusManager` 的 AWT 队列 |
| `IdeFocusTraversalPolicy` | `platform/platform-impl/src/com/intellij/openapi/wm/ex/IdeFocusTraversalPolicy.java` | `[-]` | Swing 焦点遍历策略：`IdeFocusTraversalPolicy.java:11-20`（`LayoutFocusTraversalPolicy` + `AbstractButton`/`JComboBox`/`JList`/`JTabbedPane`/`JTable`/`JTree`/`JTextComponent`），为整帧的 Swing 组件树定制 Tab 序；本仓 DOM 的 tab 序由浏览器与分面导航（`src/statusBarNav.ts`/`src/mainToolbarFocus.ts`）承担 |
| `IndexesAndVfsFlushIndicatorWidgetFactory` | `platform/platform-impl/src/com/intellij/openapi/wm/impl/status/IndexesAndVfsFlushIndicatorWidgetFactory.kt` | `[-]` | 索引与 VFS 刷盘指示器。本仓**没有索引阶段**（语义来自 LSP 服务器），也没有"写线程待刷"这一层 —— 挂一个永远不动的指示器就是假控件。**功能上**它想表达的"后台在忙"由状态栏的后台任务芯片（`src/progressPanel.ts` + `$ /progress`）承接。 |
| `InspectionProfileWidgetFactory` | `platform/lang-impl/src/com/intellij/openapi/wm/impl/status/InspectionProfileWidgetFactory.java` | `[-]` | 本仓没有「检查配置档」（诊断来自语言服务），它管的那条状态栏组件没有对象 |
| `LibraryDependentToolWindow` | `platform/platform-api/src/com/intellij/openapi/wm/ext/LibraryDependentToolWindow.java` | `[-]` | 依附「依赖库」（`OrderEntry` 一级的库）的工具窗口；本仓没有这个概念 |
| `LibrarySearchHelper` | `platform/platform-api/src/com/intellij/openapi/wm/ext/LibrarySearchHelper.java` | `[-]` | 同上：它服务的是「在库里搜索」，本仓没有库 |
| `LineSeparatorWidgetFactory` | `platform/platform-impl/src/com/intellij/openapi/wm/impl/status/LineSeparatorWidgetFactory.java` | `[~]` | 行分隔符徽标 + 转换。本仓：`src/statusWidgets.ts:66` 的 `lineSeparator` 工厂位 + `status-chip`（LF/CRLF 显示、点击在两者之间切）。**缺**：上游那一组是 `ChangeLineSeparators` 动作组（`LineSeparatorPanel.java:41`），除 CRLF/LF 外还带 **CR** 与"转换行分隔符"的分档弹层。 |
| `MainToolbarFocusSupport` | `platform/platform-impl/src/com/intellij/openapi/wm/impl/headertoolbar/MainToolbarFocusSupport.kt` | `[~]` | `src/mainToolbarFocus.ts`：`getFocusableAndEnabledItems`（`:66-70`）、`focusFirstItem`（`:51-61`）、Esc 回焦点（`:87-101`）、←/→ 遍历（`:216-224`）都已落；缺「聚焦项被禁用/移除时的焦点恢复」（`:135-186`）与「点击不把焦点带进工具栏」（`:56-58`），登记在 `docs/source-todo.md` §14 |
| `MainToolbarQuickActions` | `platform/platform-impl/src/com/intellij/openapi/wm/impl/headertoolbar/MainToolbarQuickActions.kt` | `[~]` | 三条「可添加到工具栏」的快捷动作本仓都有：全部保存（`src/menus/fileMenu.ts:69` 的 `file.saveAll`）、上一步/下一步（`src/menus/navigateMenu.ts:38-39` 的 `navigate.back`/`navigate.forward`）、构建项目（`src/menus/buildMenu.ts:16` 的 `build.project`），都在动作索引 `src/menuUi.ts` 里。**缺**：`MainToolbarQuickActions.kt:10-14` 的定制入口（`ToolbarAddQuickActionInfo`/`GroupStart`/`GroupEnd`，把这三条作为可添加项喂给工具栏定制）—— 本仓工具栏是固定组，没有 `customize`（见 `MainToolbar` 行） |
| `MemoryIndicatorWidgetFactory` | `platform/platform-impl/src/com/intellij/openapi/wm/impl/status/MemoryIndicatorWidgetFactory.java` | `[~]` | 内存指示。本仓：`src/statusWidgets.ts:76` 的 `memory` 工厂位（**默认关**，去勾选清单打开）+ `status-memory` 芯片（进程工作集 + 历史峰值）。**缺**：上游单击强制 GC、双击整包 GC（`MemoryUsagePanel.java:121-138`），本仓单击只是刷新读数 —— 宿主没有 JVM 堆，也没有等价的"强制回收"API（见 §E 的差异记录）。 |
| `MoreSquareStripeButton` | `platform/platform-impl/src/com/intellij/toolWindow/MoreSquareStripeButton.kt` | `[x]` | `src/components/ToolStripe.vue`（按钮 + 弹层 + 「移至对侧」）+ `src/toolWindowStripes.ts` 的 `moreButtonRows`/`moreButtonSide`（`ToolWindowManagerState.moreButton` 的存档形状） |
| `OpenProjectSelectionPredicateSupplier` | `platform/platform-impl/src/com/intellij/openapi/wm/impl/headertoolbar/OpenProjectSelectionPredicateSupplier.kt` | `[-]` | 给插件决定「项目部件里哪些动作要过滤掉」的 SPI（`@ApiStatus.Experimental`）；本仓没有插件运行时，动作集是固定的 |
| `PositionPanelWidgetFactory` | `platform/platform-impl/src/com/intellij/openapi/wm/impl/status/PositionPanelWidgetFactory.kt` | `[x]` | 光标位置 + 选区 + 多光标。本仓：`src/statusWidgets.ts:65` 的 `position` 工厂位 + `status-position` 芯片（`N:学` / 「已选 N 字符」/「N 个光标」，点击转到行）。 |
| `PowerSaveStatusWidgetFactory` | `platform/platform-impl/src/com/intellij/openapi/wm/impl/status/PowerSaveStatusWidgetFactory.java` | `[x]` | 省电模式徽标 + 点击开关。本仓：`src/statusWidgets.ts:77` 的 `powerSave` 工厂位（`upstreamId: 'PowerSaveMode'`、`enabledByDefault: false`，照 `:52-55`）+ `src/App.vue:664-667` 的芯片与 `togglePowerSave`（落盘设置）+ 生效面 `src/gitWidget.ts:58`（暂停轮询）、`src/lspNavigation.ts:113`（暂停符号搜索）、`src/appearanceActions.ts:216-220`（降动效）、`src/memoryWidget.ts`（暂停读数轮询）。判据 `tests/status-bar-widgets.test.mjs:106-109`。 |
| `ProductTitleInfoProvider` | `platform/platform-impl/src/com/intellij/openapi/wm/impl/simpleTitleParts/ProductTitleInfoProvider.kt` | `[~]` | 产品名这一档已有：宿主标题就是 `heading + " — TaoCode"`（`native/main.cpp:683`，欢迎页 `:849` 直接写「欢迎使用 TaoCode」）。**缺**：`ProductTitleInfoProvider.kt:10-16` 那种分段模型（产品名是一段、`ide.ui.version.in.title` 开关、无边框前缀 `" - "`）—— 本仓是固定拼接 |
| `ProductVersionTitleInfoProvider` | `platform/platform-impl/src/com/intellij/openapi/wm/impl/simpleTitleParts/ProductVersionTitleInfoProvider.kt` | `[~]` | 宿主标题已会拼产品名（`native/main.cpp:683`）；**缺**：`ProductVersionTitleInfoProvider.kt:7-8` 的版本段（`ApplicationInfo.getInstance().fullVersion`）—— 本仓标题不带版本，也没有分段模型 |
| `ProjectFrameToolWindowLayout` | `platform/platform-impl/src/com/intellij/toolWindow/ProjectFrameToolWindowLayout.kt` | `[~]` | `src/toolLayoutProfiles.ts`：档案 = 出厂默认 + 每窗口覆盖（`anchor` / `hidden`＝上游 `register=false`）已落；bean 里本仓模型没有的字段（`visible`/`weight`/`split`/`sideWeight`/按窗口的 `contentUiType`）登记在 `docs/source-todo.md` §13 |
| `ReadOnlyAttributeWidgetFactory` | `platform/platform-impl/src/com/intellij/openapi/wm/impl/status/ReadOnlyAttributeWidgetFactory.java` | `[x]` | 只读徽标 + 点击切换可写。本仓：`src/statusWidgets.ts:68` 的 `readonly` 工厂位（`upstreamId: 'ReadOnlyAttribute'`、`editorBased`）+ `src/App.vue` 的 `status-locked` 芯片（`toggleReadOnly`）。组件可隐藏（勾选清单）与上游 `isAvailable`/设置项一致。 |
| `RegisterToolWindowTask` | `platform/platform-api/src/com/intellij/openapi/wm/RegisterToolWindowTask.kt` | `[x]` | `src/toolWindowMeta.ts` 的 `TOOL_WINDOW_REGISTRY`：一个窗口 = 一条声明式记录（id / 条纹标题 `stripeTitle` / 图标 / 锚点 `anchor` / 助记符），四张表全由它派生 |
| `ResizeStripeManager` | `platform/platform-impl/src/com/intellij/toolWindow/ResizeStripeManager.kt` | `[x]` | `src/stripeResize.ts`（`checkMinMax` 的 [40,100]/33、`applyShowNames`、右侧取反、拖拽收尾）+ `src/toolWindowStripes.ts` 的两侧宽度 + `src/components/ToolStripe.vue` 的 1px 分隔线 |
| `SimpleTitleInfoProvider` | `platform/platform-impl/src/com/intellij/openapi/wm/impl/simpleTitleParts/SimpleTitleInfoProvider.kt` | `[~]` | 标题由宿主拼（`native/main.cpp:683`），等价于「窗口标题有若干段」这个结果；**缺**：`SimpleTitleInfoProvider.kt:9-42` 的 provider 抽象（option 开关、update listener、`borderlessPrefix/Suffix`）—— 本仓没有可插拔的标题段 |
| `SmartModeIndicatorWidgetFactory` | `platform/platform-impl/src/com/intellij/openapi/wm/impl/status/SmartModeIndicatorWidgetFactory.kt` | `[~]` | 智能模式指示。本仓：`src/statusWidgets.ts:81` 的 `smartMode` 工厂位（`upstreamId: 'LanguageServiceStatusBarWidget'`）+ 语言服务状态芯片（与"索引中"同一条判据，见 `docs/ui-parity-checklist.md` 批 96 那条）。**缺**：上游在索引期还提供"索引中"的进度与受限动作提示（本仓语言服务就绪即视为 smart）。 |
| `StatusBarEditorBasedWidgetFactory` | `platform/platform-impl/src/com/intellij/openapi/wm/impl/status/widget/StatusBarEditorBasedWidgetFactory.kt` | `[x]` | **2026-10-04 本轮改判**：`canEnableOn`（`:14-16` 的 `getTextEditor(statusBar) != null`）落在 `src/statusBarLifecycle.ts`（编辑器为空或不可见都不可开），工厂侧的 `editorBased` 标记在 `src/statusWidgets.ts`，与 `widgetToggleEnabled` 是同一条判据；判据 `tests/status-widgets-registry.test.mjs` 钉住"有编辑器才可点 + 与 `canEnableOn` 同判"。 |
| `StatusBarEx` | `platform/platform-impl/src/com/intellij/openapi/wm/ex/StatusBarEx.java` | `[~]` | 状态栏扩展接口（`addWidget`/`getWidget` 那套管理面）。本仓的查询侧与持久化在 `src/statusWidgets.ts`（`findWidgetFactory` 按 id 反查 = 上游 `StatusBarWidgetsManager.findWidgetFactory:139`），实例的生命周期在 `src/statusBarLifecycle.ts`。**缺**：`notifyProgressByBalloon` 与 `getBackgroundProcessModels`（后者的本仓等价物是 `src/progressPanel.ts` 的后台任务面板，形态不同）。 |
| `StatusBarListener` | `platform/ide-core/src/com/intellij/openapi/wm/StatusBarListener.java` | `[-]` | 给插件观察「组件增删/更新」的监听接口（`widgetAdded`/`widgetUpdated`/`widgetRemoved`）；本仓组件是渲染模型的固定表 + 响应式状态，没有「谁来订阅」的角色 |
| `StatusBarWidgetFactory` | `platform/platform-api/src/com/intellij/openapi/wm/StatusBarWidgetFactory.java` | `[x]` | `src/statusBarWidgets.ts`（字段面 + 三道闸 + `findWidgetFactory`）+ `src/statusWidgets.ts`（工厂表，逐条带 upstreamId）。第三十批已落地，见 `docs/ui-placement-audit.md` §AI |
| `StatusBarWidgetProvider` | `platform/platform-api/src/com/intellij/openapi/wm/StatusBarWidgetProvider.java` | `[-]` | 注册表的 EP 侧（插件通过 EP 贡献 widget）。本仓没有插件运行时（硬规则 2 点名的例子），做出来只是一个没人会注册的空注册表。 |
| `StatusBarWidgetProviderToFactoryAdapter` | `platform/platform-impl/src/com/intellij/openapi/wm/impl/status/widget/StatusBarWidgetProviderToFactoryAdapter.kt` | `[-]` | 把插件贡献的 `StatusBarWidgetProvider` 折成 `StatusBarWidgetFactory`。同 `StatusBarWidgetProvider`：没有插件运行时就不需要这层适配。 |
| `StatusBarWidgetSettings` | `platform/platform-impl/src/com/intellij/openapi/wm/impl/status/widget/StatusBarWidgetSettings.kt` | `[x]` | `src/statusBarWidgets.ts`：只存与默认不同的那条（`withWidgetEnabled`）、旧存档迁移、坏值不猜 |
| `StatusBarWidgetsActionGroup` | `platform/platform-impl/src/com/intellij/openapi/wm/impl/status/widget/StatusBarWidgetsActionGroup.kt` | `[~]` | `src/statusWidgets.ts` 的勾选清单（`listWidgets`/`widgetChecked`/`widgetClickable`/`toggleWidget`）+ App.vue 的 `.status-widget-menu`；无 `canBeEnabledOnStatusBar` 的"只对某条状态栏可用"那一档（本仓只有一个状态栏） |
| `StatusBarWidgetsManager` | `platform/platform-impl/src/com/intellij/openapi/wm/impl/status/widget/StatusBarWidgetsManager.kt` | `[~]` | `src/statusBarWidgets.ts`：三道闸（`shouldCreateWidget`）与按 id 反查（`findWidgetFactory`）都有；`LinkedHashMap<Factory, Widget>` 那种"已建组件容器 + 增量增删"在渲染模型里不需要（模板跟着状态重渲） |
| `StatusBarWidgetsOptionProvider` | `platform/platform-impl/src/com/intellij/openapi/wm/impl/status/widget/StatusBarWidgetsOptionProvider.kt` | `[~]` | 状态栏组件的**可搜索显隐动作**。**第九十二批已落**：`src/statusWidgets.ts` 的 `widgetToggleRows` —— 每个 EP 工厂折成一条 `SHOW_WIDGET_LABEL`（「显示 {0}」，`IdeBundle.properties:2402`；中文包同 key `:1403` 取值「显示 {0}」）的搜索命中，挂进 `src/menuUi.ts` 的动作索引，于是「查找操作」与 SE 的 Commands 档搜组件名即可开关，且与右键勾选**共用同一份状态与同一条可点性判据**。**缺**：上游是 `SearchTopHitProvider` 那一层（`WordPrefixMatcher` 的模糊匹配由 `rankCommands` 承担，不是同一套算法）。 |
| `StripeActionGroup` | `platform/platform-impl/src/com/intellij/toolWindow/StripeActionGroup.kt` | `[-]` | 条纹右键动作组（`TopStripeActionGroup` 那一族）。本仓没有**顶部条纹**（判决 §C 第 16 条已记），侧条右键那一组是 `ToolStripe.vue` 里现造的「显示工具窗口名称」一行。 |
| `SuperUserSuffixTitleInfoProvider` | `platform/platform-impl/src/com/intellij/openapi/wm/impl/simpleTitleParts/SuperUserSuffixTitleInfoProvider.kt` | `[~]` | 宿主标题（`native/main.cpp:683`）没有超级用户后缀；**缺**：`SuperUserSuffixTitleInfoProvider.kt:14-28` 的 `SuperUserStatus` 后缀段（本仓也没有 SuperUser 概念，这一档落地时只会有"永远不加"的空档） |
| `TitleInfoOption` | `platform/platform-impl/src/com/intellij/openapi/wm/impl/simpleTitleParts/TitleInfoOption.kt` | `[~]` | 宿主标题是固定拼接（`native/main.cpp:683`）；**缺**：`TitleInfoOption.kt:10-11/32/48` 的选项模型（`RegistryOption`/`VMOption`、注册表或 VM 参数控制某段是否显示）—— 本仓没有注册表，也没有可开关的标题段 |
| `TogglePopupHintsPanel` | `platform/lang-impl/src/com/intellij/openapi/wm/impl/status/TogglePopupHintsPanel.java` | `[-]` | 它就是那个检查配置档组件本身（`TogglePopupHintsPanel.java:29-32`：`ID = InspectionProfile`，`StatusBarWidget.IconPresentation`）—— 原判据写的「隐去弹层提示开关」是误读；同上，没有宿主 |
| `ToolWindowAllowlistEP` | `platform/platform-api/src/com/intellij/openapi/wm/ToolWindowAllowlistEP.java` | `[-]` | 同上：allowlist 是"哪些插件声明的窗口允许出现在这个产品里"，没有插件清单就没有它 |
| `ToolWindowButtonManager` | `platform/platform-impl/src/com/intellij/toolWindow/ToolWindowButtonManager.kt` | `[~]` | 条纹按钮管理器（新/旧两套 UI 的接口）。本仓的对应物是 `src/toolWindowStripes.ts` 的状态域 + `src/components/ToolStripe.vue`（侧条渲染）+ 第三十六批已落的拖宽与「更多」按钮。**缺**：`getStripeFor(devicePoint, …)` 的**跨区拖放命中**（本仓拖放只在同一侧条内重排）与 `getBottomHeight`（无底部条纹）。 |
| `ToolWindowEP` | `platform/platform-api/src/com/intellij/openapi/wm/ToolWindowEP.java` | `[-]` | 插件扩展点（`<toolWindow>` 由插件声明）——本仓没有插件运行时（硬规则 2 的例子），不建空壳；理由登记在 `docs/source-todo.md` §12 |
| `ToolWindowEditorTabActionBase` | `platform/platform-impl/src/com/intellij/openapi/wm/impl/tabInEditor/ToolWindowEditorTabActionBase.kt` | `[-]` | tabInEditor 整组的动作基类：`ToolWindowEditorTabActionBase.kt:21` 是 `DumbAwareAction`，动作只服务「把工具窗口标签移进/移出编辑器」这套机制；该机制把工具窗口包成 `VirtualFile` + `FileEditor`（见同族各行），本仓编辑器标签绑定文件（`Tab` 带 `path`/`content`），没有这套 IDE 编辑器契约 ⇒ 不适用（§E-3） |
| `ToolWindowEditorTabActions` | `platform/platform-impl/src/com/intellij/openapi/wm/impl/tabInEditor/ToolWindowEditorTabActions.kt` | `[-]` | 两条动作（`ToolWindowEditorTabActions.kt:16/51` 的 `MoveToolWindowTabToEditorAction`/`MoveToolWindowTabFromEditorToToolWindowAction`）依赖 tabInEditor 的 `EditorWindow`/`ToolWindowEditorTabTransferController`；本仓没有可承载任意内容的编辑器标签类型（§E-3） |
| `ToolWindowEditorTabAutoClosingHandler` | `platform/platform-impl/src/com/intellij/openapi/wm/impl/tabInEditor/ToolWindowEditorTabAutoClosingHandler.kt` | `[-]` | `ToolWindowEditorTabAutoClosingHandler.kt:7` 实现 `EditorAutoClosingHandler`，只在「工具窗口伪文件」被编辑器自动关闭时做清理；本仓没有伪 `VirtualFile`/`FileEditor`，没有这条清理链（§E-3） |
| `ToolWindowEditorTabDockContainer` | `platform/platform-impl/src/com/intellij/openapi/wm/impl/tabInEditor/ToolWindowEditorTabDockContainer.kt` | `[-]` | `ToolWindowEditorTabDockContainer.kt:46-56` 以 `JComponent` 为目标高亮/玻璃面板容器（`targetHighlightGlassPane`/`hintHighlightGlassPane`），拖放时在编辑器分栏上画投放提示；本仓是 Vue + CSS，没有 `JComponent`/玻璃面板这条渲染链（§E-3） |
| `ToolWindowEditorTabFile` | `platform/platform-impl/src/com/intellij/openapi/wm/impl/tabInEditor/ToolWindowEditorTabFile.kt` | `[-]` | `ToolWindowEditorTabFile.kt:37/81` 是伪 `VirtualFile`（`getFileSystem(): VirtualFileSystem`），把工具窗口伪装成可被编辑器打开的文件；本仓没有 VFS/伪文件这一层，标签直接带 `path`/`content`（§E-3） |
| `ToolWindowEditorTabFileEditor` | `platform/platform-impl/src/com/intellij/openapi/wm/impl/tabInEditor/ToolWindowEditorTabFileEditor.kt` | `[-]` | `ToolWindowEditorTabFileEditor.kt:20/35-37` 用 `JComponent` 承载内容（`getComponent()`/`getPreferredFocusedComponent()`），实现 `FileEditor`；本仓的编辑器标签不是 `FileEditor`，不能承载任意组件 —— 这正是 §E-3 的前置条件 |
| `ToolWindowEditorTabFileEditorProvider` | `platform/platform-impl/src/com/intellij/openapi/wm/impl/tabInEditor/ToolWindowEditorTabFileEditorProvider.kt` | `[-]` | `…Provider.kt:16/21/26` 实现 `FileEditorProvider`（`createEditor → FileEditor`、`FileEditorPolicy.HIDE_DEFAULT_EDITOR`），把伪文件接进编辑器注册表；本仓没有 `FileEditorProvider` 注册表（§E-3） |
| `ToolWindowEditorTabFileIconProvider` | `platform/platform-impl/src/com/intellij/openapi/wm/impl/tabInEditor/ToolWindowEditorTabFileIconProvider.kt` | `[-]` | `…IconProvider.kt:9` 实现 `FileIconProvider`，给伪文件配图标（编辑器标签上的图标）；本仓没有这条文件图标链（标签图标来自 `lucide` 组件），§E-3 |
| `ToolWindowEditorTabFileRegistry` | `platform/platform-impl/src/com/intellij/openapi/wm/impl/tabInEditor/ToolWindowEditorTabFileRegistry.kt` | `[-]` | `…Registry.kt:39/107` 登记「工具窗口 id ↔ 伪文件」，并用 `ProjectCloseListener` 清理；本仓没有伪文件注册表（§E-3） |
| `ToolWindowEditorTabFileSystem` | `platform/platform-impl/src/com/intellij/openapi/wm/impl/tabInEditor/ToolWindowEditorTabFileSystem.kt` | `[-]` | `…FileSystem.kt:14` extends `DeprecatedVirtualFileSystem`（配套 `ToolWindowEditorTabFileType.kt:9` 的 `FakeFileType`），为伪文件提供 VFS 宿主；本仓没有 VFS，§E-3 |
| `ToolWindowEditorTabFileType` | `platform/platform-impl/src/com/intellij/openapi/wm/impl/tabInEditor/ToolWindowEditorTabFileType.kt` | `[-]` | `…FileType.kt:9` 是 `FakeFileType`（伪文件的类型标记），与伪 `VirtualFileSystem` 配套；本仓没有 VFS/文件类型注册表，§E-3 |
| `ToolWindowEditorTabManager` | `platform/platform-impl/src/com/intellij/openapi/wm/impl/tabInEditor/ToolWindowEditorTabManager.kt` | `[-]` | `…Manager.kt:36` 是打开/关闭/持久化的入口，直接持有 `FileEditorManager`/`EditorWindow`；同族依赖同一套 IDE 编辑器契约，本仓无宿主，§E-3 |
| `ToolWindowEditorTabPersistenceProvider` | `platform/platform-impl/src/com/intellij/openapi/wm/impl/tabInEditor/ToolWindowEditorTabPersistenceProvider.kt` | `[-]` | `…PersistenceProvider.kt:22` 是持久化 SPI（提供工具窗口标签的恢复数据）；本仓没有这条恢复通道（会话恢复只记文件标签），§E-3 |
| `ToolWindowEditorTabPersistenceProviderUtil` | `platform/platform-impl/src/com/intellij/openapi/wm/impl/tabInEditor/ToolWindowEditorTabPersistenceProviderUtil.kt` | `[-]` | `…ProviderUtil.kt:8/19` 只是上面 SPI 的注册工具（含测试入口）；没有 SPI 就没有宿主，§E-3 |
| `ToolWindowEditorTabPreCloseCheck` | `platform/platform-impl/src/com/intellij/openapi/wm/impl/tabInEditor/ToolWindowEditorTabPreCloseCheck.kt` | `[-]` | `…PreCloseCheck.kt:9` 实现 `VirtualFilePreCloseCheck`（关伪文件前问一句）；本仓没有 VFS 关闭钩子，§E-3 |
| `ToolWindowEditorTabSession` | `platform/platform-impl/src/com/intellij/openapi/wm/impl/tabInEditor/ToolWindowEditorTabSession.kt` | `[-]` | `…Session.kt:45-50` 持 `JComponent`（`component`/`preferredFocusedComponent`）作为标签内容；本仓标签内容由 Vue 组件承载，没有「任意 `JComponent` 进标签」这条契约，§E-3 |
| `ToolWindowEditorTabSupport` | `platform/platform-impl/src/com/intellij/openapi/wm/impl/tabInEditor/ToolWindowEditorTabSupport.kt` | `[-]` | `…Support.kt:22` 是「某种内容能否在编辑器里打开」的 SPI（`canOpenInEditor`/`openInEditor`，吃 `Content` + `EditorWindow`）；依赖 tabInEditor 机制，本仓无，§E-3 |
| `ToolWindowEditorTabSupportUtil` | `platform/platform-impl/src/com/intellij/openapi/wm/impl/tabInEditor/ToolWindowEditorTabSupportUtil.kt` | `[-]` | `…SupportUtil.kt:9/21` 是上面 SPI 的注册/查询工具；没有 SPI 就没有宿主，§E-3 |
| `ToolWindowEditorTabTitleProvider` | `platform/platform-impl/src/com/intellij/openapi/wm/impl/tabInEditor/ToolWindowEditorTabTitleProvider.kt` | `[-]` | `…TitleProvider.kt:10` 实现 `EditorTabTitleProvider`（伪文件的标签标题）；本仓没有该契约，标签标题就是文件名，§E-3 |
| `ToolWindowEditorTabTransferController` | `platform/platform-impl/src/com/intellij/openapi/wm/impl/tabInEditor/ToolWindowEditorTabTransferController.kt` | `[-]` | `…TransferController.kt:18` 处理工具窗口 ↔ 编辑器之间的转移；同族依赖伪文件与 `EditorWindow`，本仓无，§E-3 |
| `ToolWindowEntry` | `platform/platform-impl/src/com/intellij/toolWindow/ToolWindowEntry.kt` | `[~]` | 每个窗口一条的条目对象。**已落**：`src/toolWindowPaneState.ts` 的 `attachStripeButton` / `detachStripeButton`（照 `ToolWindowEntry.kt:38-45` 的 setter 断言：挂的时候原值必须为空、摘的时候必须非空）+ `stripeButtonKey`（照 `removeStripeButton` `:68-70` 用窗口自己的锚点），已接进 `src/toolWindowStripes.ts` 的移除/恢复两条路径。**缺**：`floatingDecorator` / `windowedDecorator` / `balloon` / `externalDecorator`（本仓没有浮动窗口、外部装饰器与气泡）。 |
| `ToolWindowFactory` | `platform/platform-api/src/com/intellij/openapi/wm/ToolWindowFactory.kt` | `[~]` | `src/toolWindowMeta.ts` 的 `shouldBeAvailable(project)` 那一栏（逐条带出处：Gradle 走 `AbstractExternalSystemToolWindowFactory.java:32-34`、VCS 日志走 `vcsToolWindowFactories.kt:60-63`）已落；**注册链那一层已落**（2026-10-06 本 lane 复算）：`src/toolWindowFactories.ts` 的 `ToolWindowBean`/`ToolWindowFactory`/`RegisterToolWindowTask`/`toolWindowAnchorOf`/`canActivateOnStart`/`beanToTask`（照 `ToolWindowEP` → `ToolWindowFactory` → `RegisterToolWindowTask` → `WindowInfo` 那一段，判据 `tests/tool-window-factories.test.mjs`）。**缺** `createToolWindowContent` 那一半仍是 `ToolWindowView.vue` 的模板链（各视图 props 不同，没有假装数据化） |
| `ToolWindowHorizontalToolbar` | `platform/platform-impl/src/com/intellij/toolWindow/extendedToolWindowsUi/ToolWindowHorizontalToolbar.kt` | `[-]` | 它只在 `ToolWindowStripeExtension` 存在时才建（TOP/BOTTOM 横向条纹）；本仓与 2026.2 都没有这条形态 |
| `ToolWindowInEditorSupport` | `platform/platform-impl/src/com/intellij/openapi/wm/impl/content/ToolWindowInEditorSupport.kt` | `[-]` | `ToolWindowInEditorSupport.kt:10-13` 的契约吃 `Content` + `EditorWindow`（`canOpenInEditor`/`openInEditor`），是 tabInEditor 在内容条一侧的接口；本仓没有 `Content` 模型与 `EditorWindow`，内容条由 Vue 承担 ⇒ 不适用（同 §E-3 一族） |
| `ToolWindowInnerDragHelper` | `platform/platform-impl/src/com/intellij/toolWindow/innerDrag/ToolWindowInnerDragHelper.kt` | `[-]` | 内部跨区拖放的实现，直接吃 `FileEditorManagerEx`/`EditorWindow`/`EditorsSplitters` 与 `IdeGlassPaneUtil`/`BaseLabel`（`ToolWindowInnerDragHelper.kt:10-17`）—— Swing 玻璃面板 + IDE 编辑器窗口对象；本仓没有这两个宿主（侧条内重排另有 `src/toolStripeDrag.ts`），§C 第 13 条的前提不成立 |
| `ToolWindowLayoutProfileMigrationHelper` | `platform/platform-impl/src/com/intellij/openapi/wm/impl/ToolWindowLayoutProfileMigrationHelper.kt` | `[x]` | `src/toolLayoutProfiles.ts` 的 `layoutMigrationKey`（上游 `toolwindow.layout.profile.migration.<profileId>` 的等价键）+ `resolveProjectLayout` 的 `appliedVersion`/`writeAppliedVersion`（已应用版本 ≥ 档案版本就什么都不做） |
| `ToolWindowLayoutProfileProvider` | `platform/platform-impl/src/com/intellij/toolWindow/ToolWindowLayoutProfileProvider.kt` | `[x]` | `src/toolLayoutProfiles.ts` 的 `PROJECT_FRAME_PROFILES` / `projectFrameProfile(id)` / `resolveProjectLayout`（`SEED_ONLY` 与 `FORCE_ONCE` 两条语义 + `migrationVersion`） |
| `ToolWindowLeftToolbar` | `platform/platform-impl/src/com/intellij/toolWindow/ToolWindowLeftToolbar.kt` | `[~]` | `src/components/ToolStripe.vue`：左条与右条在本仓是**同一个组件**的 `side` 两个取值（上游也只是两个薄子类）；无 `bottomStripe` 那一半 |
| `ToolWindowManager` | `platform/platform-api/src/com/intellij/openapi/wm/ToolWindowManager.kt` | `[-]` | **2026-10-04 本轮复核并改精确**：上游的查询面在本仓**已有真落点**，不是散着没做 —— `src/toolWindowMeta.ts` 的 `toolWindowRegistration(id)` 就是 `getToolWindow(id)` 的注册表那半、`shouldBeAvailable(id, deps)` 就是 `isAvailable`；锚点与可见性在 `src/toolWindowStripes.ts`、激活态在 `src/toolWindowActions.ts`。三处各有真实消费者（菜单/条纹/状态栏弹层），再抽一个只转发的门面没有新语义 ⇒ 判 `[-]`（判据 `tests/tool-window-registry.test.mjs` 与 `tests/tool-window-stripes.test.mjs`）。 |
| `ToolWindowManagerListener` | `platform/platform-api/src/com/intellij/openapi/wm/ex/ToolWindowManagerListener.java` | `[-]` | 插件订阅工具窗口事件（注册/注销/状态变化）的监听接口；本仓的观察通道是响应式状态本身（`toolAnchors`/`toolOrder`/`hiddenStripeButtons`），没有订阅者角色 |
| `ToolWindowManagerState` | `platform/platform-impl/src/com/intellij/openapi/wm/impl/ToolWindowManagerState.kt` | `[~]` | `src/toolWindowStripes.ts` 的项目布局：一个项目一个键（`taocode.toolLayout:<root>`），里面**每窗口一条记录**（第四十二批起），就是上游那串 `<window_info>` 的形状。还差按 pane 分组与 `layoutToRestoreLater`（最大化的那次恢复） |
| `ToolWindowPaneNewButtonManager` | `platform/platform-impl/src/com/intellij/toolWindow/ToolWindowPaneNewButtonManager.kt` | `[-]` | 新 UI 的按钮管理器**实现**。本仓只有一套 UI（没有"新/旧 UI 开关"），所以"两套实现"这个前提在本仓不存在。 |
| `ToolWindowPaneOldButtonManager` | `platform/platform-impl/src/com/intellij/toolWindow/ToolWindowPaneOldButtonManager.kt` | `[-]` | 旧 UI 的按钮管理器实现。同上 —— 本仓没有旧 UI 档位。 |
| `ToolWindowPaneState` | `platform/platform-impl/src/com/intellij/toolWindow/ToolWindowPaneState.kt` | `[~]` | 每 pane 状态对象。**第九十四批已落**：`src/toolWindowPaneState.ts` 的 `preferredSplitProportion` / `splitSizeOrDefault`（照 `getPreferredSplitProportion`，`ToolWindowPaneState.kt:20-29`：**0 视为"没存过"** —— `Object2FloatOpenHashMap` 对缺失键返回 0）、`withSplitProportion`（照 `addSplitProportion` `:31-38`：只有分栏态才记）、`isMaximized`（照 `:41-44`：按窗口身份比）。前两条已接进 `src/panelResize.ts`（原来两处内联的 `if (splitSize.value === 0)` 收敛成一个命名函数）。**缺**：`isStripesOverlaid`（本仓没有侧条叠加态）。 |
| `ToolWindowRightToolbar` | `platform/platform-impl/src/com/intellij/toolWindow/ToolWindowRightToolbar.kt` | `[~]` | `src/components/ToolStripe.vue`（`side="right"`）：镜像定位、宽度按边持久化、更多按钮的归属判定 |
| `ToolWindowSetInitializer` | `platform/platform-impl/src/com/intellij/toolWindow/ToolWindowSetInitializer.kt` | `[~]` | `src/toolWindowStripes.ts` 的 `applyProjectLayout`：建模块时按当前项目装配一次、换项目再装配，并按存档的 `isVisible` 放回上次那些窗口（上游 `initUi`/`postEntryProcessing` 的等价物）。还差"注册集合变化时重建"（本仓的窗口集合是常量表） |
| `ToolWindowStripeExtension` | `platform/platform-impl/src/com/intellij/toolWindow/extendedToolWindowsUi/ToolWindowStripeExtension.kt` | `[-]` | 2026.2 的整包 jar 里已无这个类（§AN 的取证），它提供的 `isStripeResizable`/`getButtonMinSize` 那一层在本仓没有对应物；判 `[-]` 而不是待办 |
| `ToolWindowToEditorTransfer` | `platform/platform-impl/src/com/intellij/toolWindow/innerDrag/ToolWindowToEditorTransfer.kt` | `[-]` | 把工具窗口内容转成编辑器标签的拖放（`ToolWindowToEditorTransfer.kt:12-17` import `EditorWindow`/`ToolWindowInEditorSupport`/`ToolWindowEditorTabSupportUtil`/`ToolWindowEditorTabTransferController`，还靠 `ActionManager` 打点）；依赖 tabInEditor 全族，本仓无宿主，§E-3 |
| `ToolWindowToolbar` | `platform/platform-impl/src/com/intellij/toolWindow/ToolWindowToolbar.kt` | `[~]` | `src/components/ToolStripe.vue`：条纹本体（按钮 / 更多按钮 / 宽度分隔线 / 空白处右键 / `hasVisibleButtons` 的等价物）已落；`topStripe`+`bottomStripe` 的**双条纹**（split 组）与拖放落点几何没有（本仓是单列 + 底部 dock，既有登记偏差） |
| `VfsRefreshIndicatorWidgetFactory` | `platform/platform-impl/src/com/intellij/openapi/wm/impl/status/VfsRefreshIndicatorWidgetFactory.java` | `[~]` | VFS 刷新指示器。**第九十九批已落**：`src/statusWidgets.ts` 里登记为「文件系统同步」（显示名取 `status.bar.vfs.refresh.widget.name`，中文包同名 key）、`enabledByDefault: false`（照 `:58-60`）；芯片在 `src/App.vue` —— 空闲 = 静止图标 + tooltip「文件系统同步未运行」（上游那个空图标的等价物），同步中换成 `status-spin`。数据源是 `diskSync` 的 `syncing` 标志（**顺带修掉一个真缺陷**：它原来是普通 `let`，驱动不了界面，改成 `ref` 才进得了 `v-if`）。**缺**：上游 `isAvailable` 那条「只在启用了底部导航栏时可用」（本仓没有底部导航栏设置）。 |
| `WidgetRegistry` | `platform/platform-impl/src/com/intellij/openapi/wm/impl/status/WidgetRegistry.kt` | `[x]` | **2026-10-04 本轮改判**：`src/statusWidgets.ts` 的 `STATUS_WIDGETS` 表就是这份注册表（含"哪些是可配置工厂 / 哪些是直接画进面板的组件"的分档），按 id 反查 = `findWidgetFactory`（上游 `StatusBarWidgetsManager.findWidgetFactory:139`），未知 id 不猜；判据 `tests/status-widgets-registry.test.mjs`。没有另立容器对象是形态差异（渲染模型不需要 `LinkedHashMap<Factory, Widget>`），不是行为缺口 |
| `WindowInfoImpl` | `platform/platform-impl/src/com/intellij/openapi/wm/impl/WindowInfoImpl.kt` | `[~]` | `src/toolLayoutProfiles.ts` 的 `WindowInfo`（每窗口一条记录：`anchor`/`order`/`showStripeButton`/`contentUiType`/`visible`/`type`/`autoHide`/`split`/`floatingBounds` + 上游默认值）+ `src/toolWindowStripes.ts` 的读写（第四十三批起 `isVisible` 落；`split` = `WindowInfoImpl.isSplit`（`:91-92`，`side_tool`）落在 `isSplitOf`/`setSideTool`，初值来自 EP `secondary`，见 `src/toolWindowManager.ts` 的 `toolWindowSplitDefault`）。**还差** `weight`/`sideWeight`（本仓的每窗口尺寸走 `panelResize.ts` 的 `rememberSizeForEachToolWindow`，存像素不存权重）—— 登记在 `docs/source-todo.md` §15 |
| `WindowManager` | `platform/ide-core/src/com/intellij/openapi/wm/WindowManager.java` | `[-]` | 窗口查询面（`getFrame`/`getStatusBar`/`getIdeFrame`…）：本仓就一个由宿主 C++ 建的 WebView2 窗口，前端没有对应的查询对象 |
| `WindowManagerListener` | `platform/project-frame/src/com/intellij/openapi/wm/ex/WindowManagerListener.kt` | `[-]` | 同上：窗口是宿主的事，前端没有窗口事件可听 |
| `WriteThreadIndicatorWidgetFactory` | `platform/platform-impl/src/com/intellij/openapi/wm/impl/status/WriteThreadIndicatorWidgetFactory.kt` | `[-]` | 写线程指示器。上游读的是 `FSRecords.connection().isDirty`（本地文件系统缓存有未落盘的写）。本仓的等价物"缓冲区有未保存改动"已经在状态栏（「有未保存修改」那一格 + 位置芯片旁），再挂一个同义指示器是重复。 |
| `ideFocusUtil` | `platform/ide-core/src/com/intellij/openapi/wm/ideFocusUtil.kt` | `[-]` | Swing/AWT 焦点助手：`ideFocusUtil.kt:11-12` 的 `awaitFocusSettlesDown()` 是 `IdeFocusManager` 的协程包装（挂到 Swing 焦点调度器上，等待 AWT 焦点落定后才恢复）；本仓没有这条调度器（`src/editorFocus.ts` 的焦点是同步 DOM 调用） |
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

**2026-10-06（b1b7verdict lane）复算订正（档位不动，四档仍 19/97/0/234）**：逐条开过磁盘后改精确了多行的「缺」——
`ToolWindowEx`/`ToolWindowManagerEx`/`ToolWindowManagerImpl`/`WindowInfo`/`ToolWindowPane`（统一门面与每窗口聚合对象已落 `src/toolWindowManager.ts`/`src/toolWindowPaneState.ts`）、
`ToolWindowStripeManager(Impl)`（显隐/顺序/宽度/溢出按钮/后半组已落 `src/toolWindowStripes.ts`/`src/stripeResize.ts`/`src/toolStripeSplit.ts`）、
`StatusBar`（实例侧已落 `src/statusBarLifecycle.ts`）、`TabContentLayout`/`ComboContentLayout`/`ContentComboLabel`/`ToolWindowContentUi`（内容宿主已落 `src/toolContentTabs.ts`/`src/components/ContentComboLabel.vue`）、
`ToolWindowFactory`/`ToolWindowSplitContentProvider`/`ToolWindowDragHelper`/`ToolWindowDropArea`/`AbstractDroppableStripe`/`Stripe`/`SquareStripeButton`/`WindowInfoImpl`（注册链与分栏/拖放落点已落 `src/toolWindowFactories.ts`/`src/toolStripeSplit.ts`/`src/toolLayoutProfiles.ts`）。
