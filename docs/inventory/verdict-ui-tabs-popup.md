# B1 判决：`ui/tabs`（53）+ `ui/popup`（54）= 107 类

判定依据来自实际读源码 + 机械信号（继承链、`Graphics2D`/`JComponent`/`JBPopup`/`JList`/`JTree`/`JTable`/`Accessible`/`DimensionService`/`Registry`/`ActionGroup`/`SpeedSearch` 标记）+ TaoCode 现状核对。

四档：`[x]` 已移植 · `[~]` 部分 · `[ ]` 未移植（TODO）· `[-]` 不适用（附理由）

## A. 本轮已实现（`[x]`）

| 类 | 源码 | 判定 | 说明 |
|---|---|---|---|
| `TabsUtil` | `ui/tabs/TabsUtil.java` | `[x]` 部分转 `[x]` | `getDropSideFor`（`:54-93`）与 `updateBoundsWithDropSide`（`:95-111`）已移植为 `src/tabDragSplit.ts`（10 条测试）；`getTabsHeight`/`getLabelFont`（`:33-51`）在 Web 下由 CSS 字体承担 → 那两行见 row 6 |

## B. `ui/tabs` 逐类

| 类 | 判定 | 依据 |
|---|---|---|
| `JBEditorTabsBase.kt`（4L） | `[-]` | Swing API 壳，无行为 |
| `JBTabPainter.kt`（63L，G2D） | `[-]` | `Graphics2D` 绘制接口，CSS 承担 |
| `JBTabs.java`（122L，JC/ACTGRP） | `[-]` | `JComponent` 门面 + `DropAreaAware`，Web 无对应物 |
| `JBTabsBorder.kt`（21L） | `[-]` | Swing 边框 |
| `JBTabsEx.kt` / `JBTabsFactory.kt` | `[-]` | Swing 工厂/扩展 API |
| `JBTabsPosition.java`（23L） | `[ ]` | TOP/BOTTOM/LEFT/RIGHT 位置枚举；TaoCode 只支持顶部 → 侧边标签条未移植 |
| `JBTabsPresentation.kt`（50L） | `[ ]` | 呈现开关（side/scroll/hideTabs/singleRow/sideComponent/toolbarLeft…）真实可移植模型，TaoCode 无 |
| `TabInfo.kt`（420L） | `[~]` | TaoCode 的 `Tab` 有 path/pinned/preview/dirty/line/column；缺 `enabled`、`hidden`（被折叠进"更多"下拉）、`alert/blink`、`tooltip` 覆盖、`actionGroup` |
| `TabInfoIconHolder.kt`（32L） | `[ ]` | 图标持有者（懒加载图标），TaoCode 用固定 `FileCode2` 图标 |
| `TabsListener.java`（19L） | `[ ]` | **更正（B1-c）**：`beforeSelectionChanged(old, new)` 返回 **void**，是**通知**不是否决 —— `JBTabsImpl.kt:1680-1691` 的 `fireBeforeSelectionChanged` 只遍历调用，不看返回值。它期间的可见副作用是 `oldSelection` 被置上（`:1682`）并在 `finally` 里清空（`:1689`），于是 `getOldSelection()`（`:1957`）在回调内可查。真实消费者两处：`EditorWindow.kt:210-219`（`selectionChanged` → 若 `isSyncOnFrameActivation` 就 `VfsUtil.markDirtyAndRefresh` 该文件，即**切标签时从磁盘重新同步**）与 `JBEditorTabsBorder.kt:34-60`（下划线**滑动动画**，100ms、收缩侧延迟 50ms）。另有 `tabRemoved` / `tabsMoved` 两个通知。TaoCode 无监听器抽象，且上述两个行为都能直接由选中态变化驱动，因此判 `[ ]` 但落点应是**行为**（切标签重同步、下划线滑动），不是这套接口 |
| `TabsUtil.java` | 见 A | |
| `UiDecorator.kt`（34L） | `[-]` | Laf 更新钩子 |
| `ActionButton.java`（189L） | `[~]` | 标签上的动作按钮（悬停才显示、带 tooltip）；TaoCode 只有固定 `tab-close` |
| `ActionPanel.java`（149L，ACTGRP） | `[ ]` | 一个标签右侧排布**多个**动作按钮的容器（含 `MorePopupAware`），可移植 |
| `DefaultEditorTabsPainter.java` / `DefaultTabPainterAdapter.kt` / `JBDefaultTabPainter.kt` / `JBDefaultTabsBorder.kt` / `JBEditorTabPainter.kt` / `JBEditorTabsPainter.java` / `JBEditorTabsBorder.kt` / `ToolWindowTabPainter.kt` / `TabPainterAdapter.kt` / `SingleHeightTabs.kt` | `[-]` | 全部是 `Graphics2D` 绘制/边框（机械信号 G2D），Web 由 CSS 承担。**但** `JBEditorTabsBorder.kt`（144L，REG）里的下划线/拖拽描边常量若要 1:1 需在 CSS 里对齐数值 → 已在 `TabTheme` row 记 |
| `DragHelper.java`（369L，JC） | `[~]` | TaoCode 用 HTML5 DnD：重排 `[x]`、拖到编辑区分屏 `[x]`（本轮）；IDEA 的"拖出窗口成新 frame"=`[-]`（单窗口架构） |
| `JBTabsImpl.kt`（3896L） | `[~]` | Swing 组件本体 `[-]`；其**行为**（选中、重排、显示/隐藏策略、`selectNextTab`、`blink`）部分已在 TaoCode，`blink`/`more popup` 缺 |
| `JBEditorTabs.kt`（81L） | `[-]` | Swing 门面 |
| `LayoutPassInfo.java`（39L） | `[ ]` | 布局通过程的数据持有者；与 `SingleRowLayout` 一起才有意义 |
| `MorePopupAware.java`（14L） | `[ ]` | `hasMorePopup()` ——"被挤掉的标签进 `…` 下拉"这一行为的接口；TaoCode 无标签溢出概念 |
| `ShapeTransform.java`（358L） | `[-]` | Swing2D 形状几何（绘制用） |
| `TabLabel.kt`（928L，G2D/JC/A11Y/ACTGRP） | `[~]` | Swing 标签组件 `[-]`；其中**双击就地重命名标签**、关闭按钮悬停态是可移植行为，TaoCode 缺重命名 |
| `TabLayout.java`（79L，REG） | `[ ]` | 布局基类（`isScrollable`、`morePopup`、`lastSingularLayoutPass`） |
| `TabSideSplitter.java`（96L，JC） | `[ ]` | 标签条"侧边组件"与标签区的分隔；依赖 `JBTabsPresentation.sideComponent` |
| `UIThemeCustomization.kt`（46L） | `[-]` | 主题绘制定制钩子 |
| `CompressibleMultiRowLayout.kt`（24L） | `[ ]` | 多行布局：**压缩**策略（标签变窄） |
| `CompressibleTabsRow.kt`（280L） | `[ ]` | 压缩行的实现 |
| `MultiRowLayout.kt`（196L） | `[ ]` | 多行布局基类 + 行分配算法 |
| `MultiRowPassInfo.kt`（31L） | `[ ]` | 多行布局通过程数据 |
| `ScrollableMultiRowLayout.kt`（66L） | `[ ]` | 多行 + 滚动 |
| `ScrollableTabsRow.kt`（49L） | `[ ]` | 可滚动行实现 |
| `SimpleTabsRow.kt`（21L） / `TabsRow.kt`（32L） | `[ ]` | 行模型的基类/简单实现 |
| `WrapMultiRowLayout.kt`（66L） | `[ ]` | 多行**换行**策略 |
| `ScrollableSingleRowLayout.java`（183L） | `[ ]` | 单行 + 滚动按钮（`scrollableTabs` 开启时的模式） |
| `SingleRowLayout.java`（337L） | `[ ]` | **单行压缩布局本体**：标签宽度压缩到最小宽 + 溢出标签进 `…`；TaoCode 标签条完全不处理溢出（`div.editor-tabs` 无任何策略）→ 本轮 B1 的头号缺口 |
| `SingleRowLayoutStrategy.java`（595L，JC/PT） | `[ ]` | 压缩/滚动的具体位置计算（含 `MorePopupAware` 驱动） |
| `SingleRowPassInfo.java`（85L，JC） | `[ ]` | 单行布局通过程数据 |
| `WindowTabsLayout.java`（72L） | `[ ]` | 窗口级（多 frame）标签布局 |
| `TableLayout.java`（486L）/ `TablePassInfo.java`（70L）/ `TableRow.java`（24L） | `[-]` | 供 `TabbedPaneImpl`（Swing `JTabbedPane` 替代品，多窗口/表格型）使用；TaoCode 无该载体 |
| `TabTheme.kt`（142L） | `[~]` | 标签高度/内边距/下划线厚度等**度量常量**；TaoCode 的 CSS 里零散表达，未建模为一份可查询的度量 → 压缩算法需要它 |

## C. `ui/popup` 逐类

| 类 | 判定 | 依据 |
|---|---|---|
| `AbstractPopup.java`（3220L） | `[ ]` | 弹层核心：`requestFocus` / `cancelOnClickOutside` / `cancelKeyEnabled` / `modalContext` / `resizable` / `movable` / `autoselectOnMouseMove` / `hideOnKeyOutside` / `showBorder` / `dimensionServiceKey` / `okHandler` + 定位（`showInCenterOf`、`showUnderneathOf`、`showInBestPositionFor`）。TaoCode 的弹层各写一套，无共享核心与这些选项 → 头号缺口之一 |
| `PopupState.java`（192L，POPUP/REG/DIM） | `[ ]` | 弹层**尺寸/位置记忆**（`DimensionService` + registry）；TaoCode 不记忆弹层尺寸 |
| `PopupState.java`（63L 变体，POPUP/REG） | `[ ]` | 同上（旧版实现），随上一同移植 |
| `PopupDispatcher.java`（195L） | `[ ]` | 全局弹层栈 + `AWTEventListener`/`KeyEventDispatcher`：点击外部/按 Esc 自动收起、`hidePopups` 批量收起 |
| `StackingPopupDispatcherImpl.java`（316L） | `[ ]` | 上述栈的实现（含"重开上层"逻辑） |
| `WizardPopup.java`（655L，JC/POPUP/REG/SPEED） | `[ ]` | 分步弹层基类：键盘导航、speed search、列表滚动、`NextStepHandler` |
| `ListPopupImpl.java`（1157L） | `[ ]` | 列表弹层：speed search、mnemonics、滚动、行内动作、多选 |
| `ListPopupModel.java`（163L，SPEED） | `[ ]` | 列表模型 + speed search 过滤 |
| `ComboBoxPopup.java`（343L） | `[~]` | 下拉弹层（复用 `ListPopupImpl`）；TaoCode 用原生 `<select>`，行为不等价（无 speed search/自定义行） |
| `MnemonicsSearch.java`（50L，SPEED） | `[ ]` | **助记符匹配算法**（键入字母跳转到项）：纯逻辑、小、可测 → 建议尽早做 |
| `NumericMnemonicItem.java`（12L） | `[ ]` | 助记符承载接口，随上一条 |
| `AsyncPopupStep.kt`（27L） / `AsyncPopupWaiter.kt`（62L） | `[ ]` | 弹层列表的**异步填充**（先显示加载项，再替换） |
| `ActionStepBuilder.java`（168L，ACTGRP） | `[~]` | 把 `ActionGroup` 展开成弹层项；TaoCode 的菜单是数据驱动，等价能力部分存在 |
| `ActionPopupStep.java`（401L，JC/ACTGRP/SPEED） | `[~]` | 动作组弹层 + `MnemonicNavigation`；缺助记符导航 |
| `ActionGroupPopupActivity.kt`（114L） / `StateActionGroupPopup.kt`（147L） | `[~]` | 动作组弹层的状态/活性；TaoCode 的 enabled/checked 已按源码实现，但无该类抽象 |
| `ActionPopupOptions.kt`（224L，POPUP/SPEED） | `[~]` | 动作弹层选项（speed search、showNumbers…）；TaoCode 已有"显示编号"设置，其余缺 |
| `PopupFactoryImpl.java`（1049L，JC/POPUP/JLIST/JTREE/JTABLE/A11Y/ACTGRP） | `[~]` | 工厂：`createPopupChooserBuilder` / `createListPopup` / `createActionGroupPopup` / balloon 等；TaoCode 无统一工厂 |
| `BalloonPopupBuilderImpl.java`（284L，JC/POPUP） | `[~]` | 气泡（`Balloon`）构建：位置、隐藏、超时、可点击；TaoCode 有通知但无气泡定位模型 |
| `NotificationPopup.java`（86L） / `FramelessNotificationPopup.java`（164L，JPanel） | `[~]` | 通知弹窗；TaoCode 的 `NoticeList` 已部分对照（见 `src/notices.ts`） |
| `MovablePopup.java`（318L，A11Y/PT） | `[ ]` | 弹层可拖动移动（按住空白拖动）；TaoCode 弹层不可移动 |
| `PopupComponent.java`（19L）/ `PopupComponentFactory.kt`（21L） | `[ ]` | "可作为弹层内容且声明焦点偏好"的抽象（`focusable`/`hideOnClickOutside`），是弹层核心的一部分 |
| `PopupAlignableComponent.kt`（8L） | `[ ]` | 弹层内容可对齐的标记接口 |
| `ClosableByLeftArrow.java`（19L） | `[ ]` | 左箭头关闭弹层的小行为 |
| `PopupOwner.java`（35L，JC/PT） | `[-]` | Swing 归属窗口抽象（`AWTWindow`/`Window`） |
| `NextStepHandler.java`（8L） | `[~]` | 分步弹层的下一步钩子；TaoCode 无分步弹层 |
| `PopupUpdateProcessorBase.java`（9L） / `HintUpdateSupply.java`（192L） | `[-]` | 针对 Swing JList/JTree/JTable 的提示更新 |
| `GroupedItemsListRenderer.java`（106L）/ `PopupListElementRenderer.java`（603L）/ `IconListPopupRenderer.java`（27L） | `[-]` | `ListCellRenderer` 渲染器 |
| `PopupListAdapter.java`（185L）/ `PopupTableAdapter.java`（84L）/ `PopupTreeAdapter.java`（102L） | `[-]` | Swing JList/JTable/JTree 适配器 |
| `HeavyWeightPopup.java`（31L） | `[-]` | AWT 重weight 弹层 |
| `SelectablePanel.kt`（167L，G2D/A11Y） | `[-]` | Swing 可选中面板 |
| `BackendRenderedPopup.kt`（6L） | `[-]` | 后端渲染弹层（远程/JCEF 场景） |
| `LocalPopupComponentFactory.kt`（163L，POPUP/REG） | `[-]` | Swing 组件工厂 |
| `FilterableListPopupStep.kt`（8L） | `[~]` | 可过滤的分步弹层，随 `ListPopupImpl` |
| `PopupInlineActionsSupport.kt`（49L）/ `PopupInlineActionsSupportImpl.kt`（99L）/ `NonActionsPopupInlineSupport.kt`（46L）/ `InlineActionsUtil.kt`（47L） | `[ ]` | **列表项右侧的行内动作**（悬停显示）：可移植的交互 |
| `PopupImplUtil.java`（113L，POPUP/JLIST/DIM） | `[~]` | 弹层尺寸计算工具（与 `PopupState` 的尺寸记忆配套） |
| `MockConfirmation.java`（26L） | `[-]` | 测试用假确认框 |
| `package-info.java` ×3 | `[-]` | 包声明 |

## D. 统计

| 档 | 数量 |
|---|---:|
| `[x]`（本轮已移植） | 1（`TabsUtil` 的几何部分） |
| `[~]` 部分 | 20 |
| `[ ]` 未移植（TODO） | 56 |
| `[-]` 不适用 | 30 |
| 合计 | 107 |

## E. 本轮实现（B1-a）

1. **`src/tabDragSplit.ts`**：`clampRatio` / `dropShapes` / `pointInPolygon` / `dropSideFor` / `updateBoundsWithDropSide` / `splitOrientationForSide` / `dropSidePutsNewGroupFirst`，全部带 `TabsUtil.java` 行号。
2. **`tests/tab-drag-split.test.mjs`** 10 条（含"五个区铺满整个编辑区无缝隙"的网格性质断言、奇数高度的逐像素语义、registry 默认值 0.2）。
3. **`src/editorGroups.ts`**：新增 `swapGroups`（LEFT/TOP 需要把新组放到第一位）。
4. **`src/App.vue`**：`onStageDragOver` / `onStageDragLeave` / `onStageDrop` + 投放预览层；`endTabDrag` 清理预览。
5. **`src/style.css`**：`.tab-drop-preview`（中心区虚线）。
6. **`src/tabStripLayout.ts`**：`MIN_TAB_WIDTH` / `DEADZONE_FOR_TAB_HIDDEN` / `preferredTabWidth` / `toFitLength` / `layoutSingleRow` / `isTabHidden` —— 把 `ScrollableSingleRowLayout` 的**溢出压缩**搬成纯逻辑：`getToFitLength` 公式（左内边距会抵消）、`getLengthIncrement` 的 50px 下限**只对编辑器标签生效**、`requiredLength` 的 gap 只向编辑器标签收费而 `position` 推进无论如何都加 gap、`moreRect` 的右对齐定位、`clampScrollOffsetToBounds` 的上限、`applyTabLayout` 的"裁剪第一个放不下的 + 其余全部丢弃"、`isTabHidden` 的 `10px` 死区（`<` 严格比较）。
7. **`tests/tab-strip-layout.test.mjs`** 11 条（含死区边界 90 不隐藏 / 89 隐藏、零宽条不产生负宽度、gap 双语义）。
8. **接线**（`src/App.vue` + `src/style.css`）：按 `TabLabel.getPreferredSize()` 的等价物测量（**未加宽度时**测自然宽并缓存；`display:none` 的 0 宽不入缓存，避免把"被丢弃"误当自然宽）→ 计算布局 → 标签宽度按裁剪值写回、被丢弃的标签 `v-show=false`、溢出时渲染 `…` 按钮 + 隐藏标签下拉。`.editor-tabs { overflow: hidden }` 保证单行条不滚动。


---

## 补判：2026-09-27 重枚举带进来的 20 类

原判决表是 107 类（`ui/tabs` 53 + `ui/popup` 54），按**包路径后缀**重枚举后这两个包真实是
127 类（见 `docs/class-parity-todo.md` §0'）—— 也就是说**有 20 个类从来没被判决过**。
它们不是散落的新功能，而是两个完整的族：

### 族一 · 文件颜色（`ui/tabs`，9 类）—— 本轮已实现

| 类 | 判定 | 依据 |
|---|---|---|
| `FileColorsModel.java` | `[x]` | 语义已移植为 `src/fileColors.ts` 的 `resolveFileColor` + `normalizeFileColors`；**首个命中即返回**照 `findConfigurationWithScopeFilter:247-260` |
| `FileColorConfiguration.java` | `[x]` | 落成 `FileColorSetting { scope, color }`（= `getScopeName()` + `getColorID()`） |
| `FileColorManagerImpl.java` | `[~]` | 七色与两层开关（`FileColorsEnabled` / `FileColorsForTabsEnabled`，`_isEnabled():72-74`）已实现；`getScopeColor` / `isShared` / 应用级-项目级两层存储未做（本仓只有项目级，已在文件头记为有意偏差） |
| `FileColorsConfigurable.kt` | `[~]` | 功能可用，但**并进「作用域」页**而不是单开一页 —— 单开要占 `SettingsDialog.vue` 16 行，撞上 `tests/module-size.test.mjs` 的「行数上限只降不升」硬约束；配色的对象就是作用域本身 |
| `EditorTabColorProviderImpl.java` | `[x]` | 落成 `src/fileColorsHost.ts` 的 `tabFileColor`，标签页背景着色 + tooltip 写明命中的作用域 |
| `ColorSelectionComponent.java` | `[x]` | 落成作用域列表行内的七色色板 + 「无」 |
| `ColorButtonBase.java` | `[-]` | Swing `JButton` 基类，纯 UI 壳 |
| `FileColorModelStorageManager.kt` | `[-]` | 跨 team/user 的服务注册（`PerTeamFileColorModelStorageManager` / `PerUserFileColorModelStorageManager`），单隐式模块下无对应概念 |
| `FileColorsUsagesCollector.kt` | `[-]` | 只为设置搜索（`FileColorsSearchOptionContributor`）收集"设置项在哪用过"；本仓设置搜索按 `keywords` 匹配，不查使用记录 |

### 族二 · 弹层详情面板（`ui/popup/util`，7 类）—— 未移植，可移植

IDEA 的"弹层右侧详情区"：列表在左、选中项的详情在右（`DetailController` 管尺寸与折叠、
`MasterController` 管两栏、列表项经 `ItemWrapper` 补一个自定义 renderer）。

| 类 | 判定 | 依据 |
|---|---|---|
| `DetailController.java` | `[ ]` | 两栏比例、展开/折叠、`JBSplitter` —— 是**布局行为**，Web 下可移植（CSS grid + 拖拽条） |
| `MasterController.kt` | `[ ]` | 同上，详情侧的展开动画与滚动同步 |
| `DetailView.java` / `DetailViewImpl.java` | `[ ]` | 详情区本体（`JComponent` 门面 → 换成 DOM） |
| `ItemWrapper.java` | `[-]` | 抽象基类，签名是 `setupRenderer(ColoredListCellRenderer, …)` —— Swing 渲染器契约；**它承载的能力**归到下面那行 |
| `ItemWrapperListRenderer.java` | `[ ]` | 列表项额外挂一个详情按钮/图标的渲染 —— 可移植 |
| `SplitterItem.java` | `[-]` | `JBSplitter` 的行内实现细节 |

### 族三 · 弹层位置与内容刷新（`ui/popup`，3 类）—— 部分可移植

| 类 | 判定 | 依据 |
|---|---|---|
| `PopupPositionManager.java` | `[~]` | 弹层贴着**代码补全 lookup** 摆位（`import LookupEvent / LookupEx / EditorEx`）。「贴着锚点摆、越界就翻转」这段行为可移植且 Web 下由 CSS 定位承担；**lookup 专属的跟随补全框**在本仓无对应物（本仓没有补全弹窗） |
| `PopupUpdateProcessor.java` | `[~]` | 弹窗已开着时，内容随 lookup / 文档 / 快速搜索的结果变化而**就地刷新**（`import DocumentationManager / LookupManager / QuickSearchComponent`）。「数据变了刷新已开的弹层」是真实缺口 —— 本仓的弹层都是一次性快照（Search Everywhere 重新打开才看到新数据）；三个触发源本仓无 |
| `NotLookupOrSearchCondition.java` | `[-]` | 谓词对象，判断"当前不是 lookup/搜索态"；依附于上面两个的前提设施 |

**这一族的真实落点**：`PopupUpdateProcessor` 那条 `[~]` 是本族唯一有用户可感差异的缺口 ——
「弹层开着时数据变了要自己更新」对 Search Everywhere 尤其明显（改了文件、作用域配置变了，
弹层还是旧快照）。可移植成一个 `while open: 监听数据源 → 重算 → 原地刷新` 的通道。