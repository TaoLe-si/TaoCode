# B1 判决：`ui/tabs`（63）+ `ui/popup`（61）= **124 类**

> 2026-10-04 复核：下面的 §A–§D 是**第一版 107 行**的判决表（当时两个包只枚举到 107 类）；
> 之后按包后缀重枚举带进来 20 类（补判节），本轮再复核时又发现**4 个类从未出现在本判决书里**
> （见文末「2026-10-04 补判」）。规范类数**可复算**：`docs/inventory/ui.txt` 在这两个包下共 127 行，
> 其中 3 行是 `package-info.java`（包级文档桩，**不是类**），所以真实是 124 类。
> 旧文档里"127 类"的说法把 `package-info` 当成了类 —— 这是本轮更正的一处口径错误。

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
| `JBTabsPosition.java`（23L） | `[~]` | 已有：标签条的位置模型落在 `src/tabStripLayout.ts`（`TAB_STRIP_ROW_HEIGHT` 与单行/换行/挤压/滚动四支排法都按**顶部**；设置页 `src/components/EditorTabsSettingsPage.vue` 也没有位置项）；缺：`JBTabsPosition.java:18-21` 的 side/left/right 与 bottom 位置（`isSide()`）—— 侧边标签条未移植 |
| `JBTabsPresentation.kt`（50L） | `[~]` | 已有：可移植的呈现开关落在 `src/components/EditorTabsSettingsPage.vue`（`hideTabsIfNeeded` 的内外组、单行 / 换行 / 挤压 / 滚动的单选）+ `src/tabStripView.ts` 的排法分派 + `src/tabStripLayout.ts` 的四支布局；缺：`JBTabsPresentation.kt:15-19` 的 side 位置（`setSideComponentVertical/OnTabs/Before`）与 sideComponent、toolbarLeft 那一组 |
| `TabInfo.kt`（420L） | `[~]` | TaoCode 的 `Tab` 有 path/pinned/preview/dirty/line/column；`hidden` **布局层已落**（`src/tabStripLayout.ts` 的 `PlacedTab.hidden` / `isTabHidden` 的 10px 死区 + `src/tabStripView.ts` 的 `isTabDropped`；产品取滚轮/多行排取回，不画「更多」下拉，见 §E）。**`alert/blink` 已落并已接**（2026-10-06 本 lane 复算订正：原写「缺 `alert/blink`」，与磁盘不符）：`TabInfo.fireAlert/stopAlerting/blinkCount`（`:301-309`/`:91`）与 `TabLabel.repaintAttraction`（`:640-690`）的两段预算落成 `src/tabAlerts.ts`（`MAX_INITIAL_BLINK_COUNT=5`/`MAX_RE_FIRE_BLINK_COUNT=7`/`BLINK_FRAME_MS=250` 的 `requestTabAlert`/`stopTabAlert`/`blinkTabAlert`/`createTabAlertRegistry`），消费点是 `src/App.vue:262-274`（运行/调试内容标签的 `CircleAlert` 图标，`visible`/`blinking` 两态）与 `src/style.css:599` 的 `.tab-alert`，触发者照上游 `RunnerContentUi.processBounce`/`DebuggerSessionTabBase.attachNotificationTo`（进程结束、调试停下且该内容未被选中），判据 `tests/tab-alerts.test.mjs`。**仍缺** `enabled`（`TabInfo.isEnabled:127-131` 的 `ENABLED` 变更广播 + 禁用标签的灰显与不可选中 —— 本仓 `Tab` 没有这一位，且标签渲染在 `src/App.vue:2154`（禁改文件）里）、`tooltip` 覆盖（`setTooltipText(HtmlChunk)` `:359-378`：上游 tooltip 可由外部改写并广播，本仓只有 `tabFileColorScope` 的作用域 tooltip 与路径 fallback 两支，都在禁改的 App.vue 内）、`actionGroup`（`setTabLabelActions` `:271-286`，标签右侧动作组，见 `ActionPanel.java` 行） |
| `TabInfoIconHolder.kt`（32L） | `[-]` | Swing 图标持有者接口：`TabInfoIconHolder.kt:6` 直接 `import javax.swing.Icon`，`:9` 的接口只声明图标读写；本仓标签图标是 `lucide-vue-next` 组件（`src/App.vue` 里 `FileCode2` 那条标签渲染），没有 `Icon` 对象与懒加载持有者 |
| `TabsListener.java`（19L） | `[~]` | **更正（B1-c）**：`beforeSelectionChanged(old, new)` 返回 **void**，是**通知**不是否决 —— `JBTabsImpl.kt:1680-1691` 的 `fireBeforeSelectionChanged` 只遍历调用，不看返回值。它期间的可见副作用是 `oldSelection` 被置上（`:1682`）并在 `finally` 里清空（`:1689`），于是 `getOldSelection()`（`:1957`）在回调内可查。真实消费者两处：`EditorWindow.kt:210-219`（`selectionChanged` → 若 `isSyncOnFrameActivation` 就 `VfsUtil.markDirtyAndRefresh` 该文件，即**切标签时从磁盘重新同步**）与 `JBEditorTabsBorder.kt:34-60`（下划线**滑动动画**，100ms、收缩侧延迟 50ms）。另有 `tabRemoved` / `tabsMoved` 两个通知。TaoCode 无监听器抽象，且上述两个行为都能直接由选中态变化驱动，因此判 `[~]`：**切标签重同步已落**（2026-09-29，`diskSync.syncTabOnActivation` + `editorSplits.switchTabIn`，见 `docs/ui-placement-audit.md` §AB）；下划线滑动动画**不做**并登记理由（本仓反馈纪律不加动效），不是这套接口 |
| `TabsUtil.java` | 见 A | |
| `UiDecorator.kt`（34L） | `[-]` | Laf 更新钩子 |
| `ActionButton.java`（189L） | `[~]` | 标签上的动作按钮。**悬停才显示那一半已落**（2026-10-06 本 lane 复算订正：原写「TaoCode 只有固定 `tab-close`」，与磁盘不符）：`src/tabEntryPoint.ts` 逐条照 `ActionButton.java:174-189` 的 `setAutoHide`/`toggleShowActions`（`myAutoHide` 为真时按钮的 painting 跟着 show 走）与 `ActionPanel.java:107-143` 的"不可用/不可见就不画、一条可见都没有就不占位置"（`getPreferredSize` 返回 0×0），成员表在 `src/tabEntryPointMenu.ts`，消费点是标签条右端的常驻「更多」下拉（`src/App.vue`）与固定的 `tab-close`。**缺**：按钮外观三档（`ActionButtonLook`）与"按住拖出"（本仓 DnD 走 HTML5，见 `DragHelper.java` 行） |
| `ActionPanel.java`（149L，ACTGRP） | `[~]` | 标签右侧排布多个动作按钮的容器。**已落**（2026-09-29）：标签条右端的常驻「更多」下拉（=`EditorTabsEntryPoint`，`PlatformActions.xml:804-816`），"不可用就不画"与"一条可见都没有就不占位置"两条规则照 `ActionPanel.java:107-143`；成员只放本仓真接得住的七条。**2026-10-06 本 lane 复算**：规则与成员表分别在 `src/tabEntryPoint.ts`（`update` 的 `p.isEnabled() && p.isVisible()` + `getPreferredSize` 的 0×0）与 `src/tabEntryPointMenu.ts`（成员顺序照上游），判据 `tests/tab-entry-point.test.mjs`。见 `docs/ui-placement-audit.md` §AD。**缺**：`EditorTabsToolbarActions`（可被插件扩展的空组，`EditorTabbedContainer.kt:626-632`）—— 本仓没有插件运行时 |
| `DefaultEditorTabsPainter.java` / `DefaultTabPainterAdapter.kt` / `JBDefaultTabPainter.kt` / `JBDefaultTabsBorder.kt` / `JBEditorTabPainter.kt` / `JBEditorTabsPainter.java` / `JBEditorTabsBorder.kt` / `ToolWindowTabPainter.kt` / `TabPainterAdapter.kt` / `SingleHeightTabs.kt` | `[-]` | 全部是 `Graphics2D` 绘制/边框（机械信号 G2D），Web 由 CSS 承担。**但** `JBEditorTabsBorder.kt`（144L，REG）里的下划线/拖拽描边常量若要 1:1 需在 CSS 里对齐数值 → 已在 `TabTheme` row 记 |
| `DragHelper.java`（369L，JC） | `[~]` | TaoCode 用 HTML5 DnD：重排 `[x]`、拖到编辑区分屏 `[x]`（本轮）；IDEA 的"拖出窗口成新 frame"=`[-]`（单窗口架构） |
| `JBTabsImpl.kt`（3896L） | `[~]` | Swing 组件本体 `[-]`；其**行为**部分已在 TaoCode：选中（`src/App.vue` 的 activeTab）、重排（`src/tabDragSplit.ts` + HTML5 DnD）、显示/隐藏策略（`src/tabStripLayout.ts` 的四支排法 + `src/tabStripView.ts`）、`selectNextTab`（`src/toolWindowActions.ts:170` 的 `cycleTab(1)`，工具窗口内容标签轮转）。**`blink` 已落并已接**（2026-10-06 本 lane 复算订正：原写「`blink`/`more popup` 缺」，与磁盘不符）：`TabInfo.fireAlert`/`stopAlerting` 的两段预算落成 `src/tabAlerts.ts`，消费点 `src/App.vue:262-274`（运行/调试内容标签的提醒图标）与 `src/style.css:599` 的 `.tab-alert`，判据 `tests/tab-alerts.test.mjs`（详见本表 `TabInfo.kt` 行）。**仍缺**：`more popup`（`MorePopupAware.canShowMorePopup` —— 本仓产品取滚轮/多行排，不画「…」下拉，见 §E 与 `MorePopupAware.java` 行） |
| `JBEditorTabs.kt`（81L） | `[-]` | Swing 门面 |
| `LayoutPassInfo.java`（39L） | `[-]` | 布局通过程的数据持有者（Swing 抽象）。本仓两个布局族各自返回自己的结果对象（`TabStripLayout` / `MultiRowLayout`），没有共同的 Swing 通过程基类。 |
| `MorePopupAware.java`（14L） | `[~]` | 已有：溢出判定与隐藏落在 `src/tabStripLayout.ts`（`isTabHidden` 的 10px 死区、`dropped` 列表）与 `src/tabStripView.ts`（被丢弃标签 `display:none`、选中项自动滚入）；缺：`MorePopupAware.java:12` 的 `canShowMorePopup()` —— 把这些被挤掉的标签收进 `…` 下拉（本仓产品取滚轮/多行，不画该按钮，见 §E） |
| `ShapeTransform.java`（358L） | `[-]` | Swing2D 形状几何（绘制用） |
| `TabLabel.kt`（928L，G2D/JC/A11Y/ACTGRP） | `[~]` | Swing 标签组件 `[-]`；关闭按钮悬停态是可移植行为。**更正（2026-09-29 核对原文）**：本表原写的「双击就地重命名标签」是**误读** —— `TabLabel.kt:151-153` 的 `mouseClicked` 只做 `handlePopup(e)`，整个 `ui/tabs` 包里搜不到 rename 字样与任何文本域，**IDEA 没有「就地重命名标签」这个行为**。双击的真语义在 `EditorTabbedContainer.kt:348-361`：① 预览标签晋升常驻（`:349-356`，随后 return）；② 按 `editor.maximize.on.double.click`（`intellij.platform.ide.impl.xml:1511`，默认 true）执行「隐藏全部工具窗口 / 恢复窗口」。两条**已落**（见 `docs/ui-placement-audit.md` §AC） |
| `TabLayout.java`（79L，REG） | `[~]` | 已有：布局行为在 `src/tabStripLayout.ts` 的四支纯函数（单行 / 换行 / 挤压 / 滚动，由 `src/tabStripView.ts` 一处按设置分派）；缺：`TabLayout.java:12-15` 的 Swing 通过程基类（`SwingConstants`/`Dimension`/`Rectangle`/`ShapeTransform`）与 `isScrollable`/`lastSingularLayoutPass` 状态 |
| `TabSideSplitter.java`（96L，JC） | `[-]` | Swing 专有：`TabSideSplitter.java:11-14`（`javax.swing.JComponent`、`OnePixelDivider`/`Splittable`、`PropertyChangeListener`），且依赖 `JBTabsPresentation.sideComponent`（本仓无侧边组件） |
| `UIThemeCustomization.kt`（46L） | `[-]` | 主题绘制定制钩子 |
| `CompressibleMultiRowLayout.kt`（24L） | `[~]` | 多行布局的**压缩**策略（标签变窄）。**第九十批已落**：`src/tabStripLayout.ts` 的 `layoutCompressibleMultiRow` + `compressRowWidths` / `decreaseMaxLengths`（照 `CompressibleTabsRow.kt:127-166` 的"从最长的开始降"），入口在 `src/tabStripView.ts` 的排法分派（`EditorTabbedContainer.kt:667`）。**未落**：上游的 `decreaseInsets` 逐档缩 insets（Swing 装饰的中间量，本仓量不出）用一条常量下限代替。 |
| `CompressibleTabsRow.kt`（280L） | `[~]` | 压缩行的实现。**已落**：`src/tabStripLayout.ts` 的 `compressRowWidths`（放得下原样、超了才压）；**未落** `decreaseInsets` 的 insets 逐档收缩与 `CachedDecoration` 缓存（都是 Swing 装饰概念）。 |
| `MultiRowLayout.kt`（196L） | `[~]` | 多行布局基类 + 行分配算法。**已落**：`src/tabStripLayout.ts` 的 `layoutMultiRow`（换行排）/ `layoutCompressibleMultiRow`（挤压排）/ `layoutScrollableMultiRow`（滚动排），三支由 `EditorTabbedContainer.kt:657-672` 的 `createRowLayout` 分派，分行规则 = `splitPinnedRow`（照 `splitToPinnedUnpinned:105-120`）。**未落**：`getRowY` 的 bottom 位置（本仓标签条只在顶部）与 `layoutTabComponent`（没有标签侧组件）。 |
| `MultiRowPassInfo.kt`（31L） | `[-]` | 多行布局通过程数据（`MultiRowPassInfo`）。本仓的等价物是 `src/tabStripLayout.ts` 各 `layout*Row` 的返回值（`MultiRowLayout` 接口），没有单独的 Swing 通过程对象。 |
| `ScrollableMultiRowLayout.kt`（66L） | `[~]` | 多行 + 滚动。**第九十批已落**：`src/tabStripLayout.ts` 的 `layoutScrollableMultiRow` / `scrollableRow`（照 `ScrollableTabsRow.kt:22-49`：超了给「…」留宽、右边缘裁切、`dropped` 记裁掉的），滚轮经 `src/tabStripView.ts` 的 `onTabStripWheel` 驱动。**2026-10-04 本轮**：拼固定排 + 可滚动排时修掉 `dropped` 的下标轴（见 `ScrollableTabsRow.kt` 行）与"全固定还多一条空排"；`splitToRows` 只在真有未固定标签时才建第二条 row。**未落**：`isScrollBarAdjusting` / `recentlyActive` 两个守卫（Swing 事件态）。 |
| `ScrollableTabsRow.kt`（49L） | `[x]` | 可滚动行实现。**已落**：`src/tabStripLayout.ts` 的 `scrollableRow`（含 `len = max(0, x + tabsLength - curX)` 的裁切与 `<= |gap|` 归零那一行）。**2026-10-04 本轮补掉最后两个真缺陷**（判据 `tests/tab-strip-scroll-pinned.test.mjs`）：① `dropped` 原记的是**排内局部下标**，而 `placed` 记的是条内全局下标（`base + index`）—— 固定排开着时渲染层会把固定标签误判成"掉出条外"写成 0 宽；现在两轴统一为 `base + index`。② 全是固定标签时 `layoutScrollableMultiRow` 不再拼一条恒空的第二排。 |
| `SimpleTabsRow.kt`（21L） / `TabsRow.kt`（32L） | `[~]` | 行模型的基类/简单实现。**已落**：`src/tabStripLayout.ts` 的 `layoutMultiRow` 就是 `SimpleTabsRow` 那一支（自然宽度、不压不滚）；基类没有类层次 —— 三种排法是三条纯函数，由 `src/tabStripView.ts` 一处按设置分派。 |
| `WrapMultiRowLayout.kt`（66L） | `[~]` | 多行换行策略。**已落**：本仓 `src/tabStripLayout.ts` 的 `layoutMultiRow`（按宽度分行、第一行扣掉侧工具条）＋本批补上的**固定标签单独成排**（`splitPinnedRow` / `showsPinnedTabsSeparately`，见 `docs/ui-placement-audit.md` §AH）。**未落**：上游 `splitToPinnedUnpinned:111-114` 那条"下一项是拖放占位就并入固定排"—— 本仓多行布局没有拖放占位模型 |
| `ScrollableSingleRowLayout.java`（183L） | `[~]` | 单行 + 滚动按钮。**已落**：`src/tabStripLayout.ts` 的 `layoutSingleRow` + `scrollUnitsToShowTab`（选中项滚进可视区）+ `src/tabStripView.ts` 的 `onTabStripWheel` / `scrollTabStrip`。本仓按用户实测（2026-09-29）取"滚轮"而不画「…」按钮，`moreButtonWidth: 0`。**缺**（2026-10-06 本 lane 复算）：上游 `ScrollableSingleRowLayout.java` 的**左右滚动箭头按钮**（`getScrollDelta`/`scroll` 那对 `myScrollLeftButton`/`myScrollRightButton`）本仓不画 —— 这是产品决定（滚轮替代），登记在 §E。 |
| `SingleRowLayout.java`（337L） | `[~]` | **单行压缩布局本体**。这一行上一版写的是"TaoCode 标签条完全不处理溢出 → 本轮 B1 的头号缺口"，**已作废**：`src/tabStripLayout.ts` 的 `layoutSingleRow` 逐行照 `applyTabLayout:119-138` 实现（裁第一个放不下的 + 其余归零），另有 `src/tabStripView.ts` 的滚轮滚动与选中项自动滚入。 |
| `SingleRowLayoutStrategy.java`（595L，JC/PT） | `[~]` | 压缩/滚动的具体位置计算。**已落**：`src/tabStripLayout.ts` 的 `toFitLength` / `preferredTabWidth` / `layoutSingleRow`（`getToFitLength` 公式、50px 下限只对编辑器标签生效、gap 的收费规则、`getMoreRect` 的右对齐都在注释里逐条对过）。**未落**：`MorePopupAware` 驱动的 `…` 弹层（本仓用滚轮代替，见 §E）。 |
| `SingleRowPassInfo.java`（85L，JC） | `[-]` | 单行布局通过程数据。本仓 `layoutSingleRow` 的返回值（`TabStripLayout`）就是它，没有单独的 Swing 通过程对象。 |
| `WindowTabsLayout.java`（72L） | `[-]` | Swing 多窗口标签布局：`WindowTabsLayout.java:17-29`（extends `SingleRowLayout`，构造吃 `JBTabsImpl`，坐标走 `java.awt.Component/Point/Rectangle`）；本仓是宿主 C++ 建的单窗口（`native/main.cpp` 的 WebView2），没有窗口级标签布局 |
| `TableLayout.java`（486L）/ `TablePassInfo.java`（70L）/ `TableRow.java`（24L） | `[-]` | 供 `TabbedPaneImpl`（Swing `JTabbedPane` 替代品，多窗口/表格型）使用；TaoCode 无该载体 |
| `TabTheme.kt`（142L） | `[~]` | 标签高度/内边距/下划线厚度等**度量常量**；TaoCode 的 CSS 里零散表达，未建模为一份可查询的度量 → 压缩算法需要它 |

## C. `ui/popup` 逐类

| 类 | 判定 | 依据 |
|---|---|---|
| `AbstractPopup.java`（3220L） | `[~]` | 已有：浮层核心的可移植段已拆进 `src/popupAnchor.ts`（锚点原值 + 按实测尺寸纠正）/ `src/popupBounds.ts`（尺寸与位置记忆，照 `:3140-3148`/`:2314-2324`）/ `src/popupState.ts`（刚关又弹的抑制）/ `src/popupCancel.ts`（Esc 先清速度搜索过滤再关层，照 `:2995-3012`）。**三条命名定位变体已落并已接**（2026-10-06 本 lane 复算订正：原写「缺 `showInCenterOf`/`showUnderneathOf`/`showInBestPositionFor`」，与磁盘不符）：`src/popupPlacement.ts` 的 `pointUnderneathOf`（`:732-737`+`:770-773`，2px 偏移）/`centerOf`（`:724-727`+`:668-678`）/`bestPositionFor`（`:974-993`+`:894-905`）与 `placeUnderneath`/`placeCenteredIn`/`useBestPositionAnchor`，消费点是 `src/components/QuickDocPopup.vue`/`QuickDefinitionPopup.vue`/`SelectInPopup.vue`/`TargetChooserPopup.vue`（判据 `tests/popup-placement.test.mjs`）。**仍缺** `requestFocus`/`cancelKeyEnabled`/`modalContext`/`resizable`/`movable`/`autoselectOnMouseMove`/`hideOnKeyOutside`/`showBorder`/`okHandler` —— 其中 `cancelOnClickOutside` 与 `hideOnKeyOutside` 的**行为**已由 `src/popupStack.ts` 承担（见 `PopupDispatcher` 行），只是没有挂在 `AbstractPopup` 这一个对象上 |
| `PopupState.java`（192L，POPUP/REG/DIM） | `[x]` | **更正（2026-09-29 核对原文）**：原写「尺寸/位置记忆」是**误读** —— 该类只有 `isRecentlyHidden()`（registry `ide.popup.hide.show.threshold` 默认 200ms），**一个 size 字段都没有**（本仓对应物 = `src/popupState.ts` 的 `createPopupGate`，早已落地）。尺寸/位置记忆的真出处是 `AbstractPopup`（见下一行）。 |
| `PopupState.java`（63L 变体，POPUP/REG） | `[-]` | 同一个类的旧版实现，语义同上（`isRecentlyHidden`），无独立移植价值 |
| `PopupDispatcher.java`（195L） | `[~]` | 已有：点击外部/按 Esc 收起的语义在 `src/popupCancel.ts` + `src/menus/submenuState.ts`（子菜单链的关闭与 250ms 悬停保护）。**全局弹层栈已落并已接**（2026-10-06 本 lane 复算订正：原写「全局弹层栈与批量收起…没有对应物」，与磁盘不符）：栈在 `src/popupStack.ts`（`createPopupDispatcher`/`usePopupLayer`/`closeAllPlan`/`findTopLayer`/`closeRequestTarget`/`popupEscapeAction`/`persistentLayerIds`/`popupsToCancelOnOutsidePress`，照 `PopupDispatcher.java:36-37` 的全局链与 `hidePopups`），消费点是 `src/App.vue:102` 与一批弹层组件（`src/components/AnchoredMenu.vue`/`TabContextMenu.vue`/`ToolWindowHeader.vue`/`ToolWindowGear.vue`/`ToolWindowAnchorMenu.vue`/`ContentComboLabel.vue`）。仍缺：AWT 事件队列那一层（`AWTEventListener`/`KeyEventDispatcher`/`KeyboardFocusManager`；DOM 用 `pointerdown` + 焦点判定） |
| `StackingPopupDispatcherImpl.java`（316L） | `[~]` | 同上（实现）。**全局栈已落并已接**（2026-10-06 本 lane 复算订正：原写「本仓只有单条子菜单状态…缺全局栈与关掉上层重开下层逻辑」，与磁盘不符）：`src/popupStack.ts` 的 `createPopupDispatcher` 就是 `StackingPopupDispatcherImpl.java:18-21` 那条 `Stack` 的等价物（`findTopLayer`/`closeRequestTarget`/`closeAllPlan`/`persistentLayerIds` 承担「关掉上层重开下层」与批量收起），消费点见 `PopupDispatcher.java` 那一行；子菜单链另在 `src/menus/submenuState.ts` 的 `submenuRow` |
| `WizardPopup.java`（655L，JC/POPUP/REG/SPEED） | `[~]` | 已有：分步弹层的**模型**落在 `src/popupSteps.ts`（`ListPopupStepLike` 的 `hasSubstep`/`isSelectable`/`separatorAbove`/`defaultOptionIndex`、`listStepRows` 的行模型、`chosenOutcome` 的「有子步骤就换内容、否则关层」= `PopupStep.java:26-31`、`shouldBeShowing` 的过滤可见性 = `WizardPopup.java:561-570`、`autoSelectionFired` 的 `ide.popup.auto.delay` 500ms = `:83-84`/`:537-542`），消费点是 `src/components/ContentComboLabel.vue`（COMBO 内容下拉：过滤/初始选中/按下关不关层都取自那一处）；交互另落在 `src/components/SearchEverywhereDialog.vue`（Tab/Shift+Tab 切档、↑↓、Enter、Esc）+ `src/speedSearch.ts`。**缺**：逐层 `JBPopup` 生命周期（每层一个真窗口对象 —— 本仓是单层 DOM 浮层，SE 的切档不换层）与 `NextStepHandler` 的宿主回调（见该行） |
| `ListPopupImpl.java`（1157L） | `[~]` | 列表弹层：speed search、mnemonics、滚动、行内动作、多选。**已落三条**：speed search（`src/speedSearch.ts`，见 `docs/ui-placement-audit.md` §Y）、mnemonics（`src/selectIn.ts`）、行内动作（欢迎页项目行与通知列表行，见 §AF）。**未落**：多选（本仓的列表弹层都是单选） |
| `ListPopupModel.java`（163L，SPEED） | `[~]` | 已有：行模型与过滤在 `src/popupSteps.ts`（`ListPopupStepLike`/`listStepRows`/`shouldBeShowing`）与 `src/speedSearch.ts`（MinusculeMatcher 驼峰子串），过滤后「原索引 ↔ 可见行」的映射由 `src/components/ContentComboLabel.vue:71-80` 承担（`idOf` 给原索引、`rows` 换回数字 —— 照 `ListPopupModel.java:44-48` 的 `getOriginalIndex`/`:143-150` `refilter`/`:152-154` `isVisible`）；`ListSeparator` 分隔行建模也已在 `src/popupSteps.ts:43-52`/`:129-132`。**缺**：`AbstractListModel` 的**增删通知**（`fireContentsChanged` 那一层 —— 本仓列表由 Vue computed 重算，没有"模型自报变化"的通道） |
| `ComboBoxPopup.java`（343L） | `[~]` | 下拉弹层（复用 `ListPopupImpl`）。**本仓已有等价的下拉弹层**（2026-10-06 本 lane 复算订正：原写「TaoCode 用原生 `<select>`，行为不等价」，与磁盘不符）：`src/components/ContentComboLabel.vue` 是工具窗口内容形态的下拉标签（图标 + 名称 + 箭头 + 弹层列表），行模型/速度搜索/初始选中都走 `src/popupSteps.ts`；`src/popupPlacement.ts` 的 `placeUnderneath` 承担"贴组件下方弹出"。**缺**：`ComboBoxPopup` 的 `isTwoColumn`/`getTopLevelPopup` 那层 Swing 组件树与滚动条 |
| `MnemonicsSearch.java`（50L，SPEED） | `[x]` | **助记符匹配**。**已落（2026-09-29 核对原文）**：本仓 `src/selectIn.ts` 的 `selectInMnemonicHit` 逐条照 `MnemonicsSearch.java:34-46` —— 只在 KEY_TYPED、只认字母数字、速度搜索框**已有字时让路**（`:37`）、命中即吞事件（`:44`）；助记符表大小写各登记一份（`:25-31`）。调用点在 `src/components/SelectInPopup.vue:37`，且在**速度搜索之前**判定，与上游 `WizardPopup.java:489-490`（先 `myMnemonicsSearch.processKeyEvent(event)` 再 `processKeyEvent(event)`）同序。判据：`tests/select-in.test.mjs`。**唯一差距**：上游 `ActionPopupStep.getMnemonicString`（`:197-205`）在动作声明了数字助记符时走 `NumericMnemonicItem.getMnemonicChar` 分支 —— 本仓没有「动作自带数字助记符」的模型，主菜单/右键菜单也不带 `_X` 标记，那一支无从消费，**不放假实现** |
| `NumericMnemonicItem.java`（12L） | `[-]` | 数字助记符的承载接口（`digitMnemonicsEnabled`/`getMnemonicChar`）。本仓没有「动作自带数字助记符」的模型，随上一行登记为不移植 |
| `AsyncPopupStep.kt`（27L） | `[~]` | 已有：异步取数在 `src/searchEverywhereHost.ts`（符号请求防抖 120ms + 世代号丢弃迟到答案）与 `src/searchStream.ts`（分块发布、按 streamId 认领）；缺：`AsyncPopupStep.kt:13` 那种「先给一个占位 step、`Promise` 完成后再替换成真 step」的模型 |
| `AsyncPopupWaiter.kt`（62L） | `[-]` | Swing 等待层：`AsyncPopupWaiter.kt:10-14` 直接吃 `EdtScheduler`/`AnimatedIcon`/`JLabel`/`JComponent`，在结果就绪前弹一个转圈浮层；本仓的异步链不弹等待层（空态由 `src/searchEverywhereEmpty.ts` 承担） |
| `ActionStepBuilder.java`（168L，ACTGRP） | `[~]` | 把 `ActionGroup` 展开成弹层项。本仓等价能力：`src/menus/types.ts` 的 `MenuRow`（子菜单 `children`/`childrenOf`）经 `src/menuUi.ts` 的 `submenuRows`/`flattenMenuRows` 展开成弹层行，`section`/`rule` 表达分隔（对应 `ActionStepBuilder` 的 `myPrependWithSeparator`/`mySeparatorText`）。**缺**（2026-10-06 本 lane 复算，上游 `ActionStepBuilder.java:27-60`）：上游那层还带**编号**（`myShowNumbers`/`myUseAlphaAsNumbers`/`myCurrentNumber`）与**禁用项是否画**（`myShowDisabled`）、`myHonorActionMnemonics`、`myMaxIconWidth` 对齐 —— 本仓菜单行不显示数字编号、不画禁用项（`enabled` 为假的直接不可点但不置灰对齐图标）。 |
| `ActionPopupStep.java`（401L，JC/ACTGRP/SPEED） | `[~]` | 动作组弹层 + `MnemonicNavigation`；缺助记符导航 |
| `ActionGroupPopupActivity.kt`（114L） / `StateActionGroupPopup.kt`（147L） | `[~]` | 动作组弹层的状态/活性；TaoCode 的 enabled/checked 已按源码实现，但无该类抽象 |
| `ActionPopupOptions.kt`（224L，POPUP/SPEED） | `[~]` | 动作弹层选项（speed search、showNumbers…）；TaoCode 已有"显示编号"设置，其余缺 |
| `PopupFactoryImpl.java`（1049L，JC/POPUP/JLIST/JTREE/JTABLE/A11Y/ACTGRP） | `[~]` | 工厂：`createPopupChooserBuilder` / `createListPopup` / `createActionGroupPopup` / balloon 等；TaoCode 无统一工厂 |
| `BalloonPopupBuilderImpl.java`（284L，JC/POPUP） | `[~]` | 气泡（`Balloon`）构建：位置、隐藏、超时、可点击；TaoCode 有通知但无气泡定位模型 |
| `NotificationPopup.java`（86L） / `FramelessNotificationPopup.java`（164L，JPanel） | `[~]` | 通知弹窗。本仓等价物是 `src/notices.ts` 的通知列表（`NoticeEntry`/`noticeLevel`/`NOTICE_LOG_LIMIT`，界面在状态栏通知按钮 + NoticeList 弹层）。**缺**（2026-10-06 本 lane 复算，上游 `NotificationPopup.java:44-76`）：上游是**气泡**（`JBPopupFactory.createBalloonBuilder` 挂在 frame 的 `BalloonLayout` 上，`setFadeoutTime(5000)` 5 秒淡出、`setHideOnClickOutside(false)`、`setCloseButtonEnabled(true)`、`setShowCallout(false)`，尺寸上限 400×200），无 frame 时退 `FramelessNotificationPopup`（一个 JWindow）；本仓通知不淡出、不挂气球布局（列表式通知）。 |
| `MovablePopup.java`（318L，A11Y/PT） | `[-]` | Swing 专有：`MovablePopup.java:14-20`（`JLayeredPane`/`JPanel`/`JRootPane`/`JWindow`/`RootPaneContainer`/`SwingUtilities`/`BorderLayout`）——按住空白拖动整个弹层窗口；本仓弹层是不可移动的 DOM 浮层 |
| `PopupComponent.java`（19L）/ `PopupComponentFactory.kt`（21L） | `[-]` | Swing 弹层契约：`PopupComponent.java:6-14`（`java.awt.Window` 的 hide/show/getWindow/setRequestFocus）与 `PopupComponentFactory.kt:5-8`（吃 `JBPopup`/`Component`）；本仓浮层是 Vue 组件 + Teleport，没有这层组件契约 |
| `PopupAlignableComponent.kt`（8L） | `[-]` | Swing 弹层对齐标记：`PopupAlignableComponent.kt:7-9` 只声明 `getLeftGap(): Int`，供 Swing 渲染器对齐内容；本仓没有这条自绘渲染管线 |
| `ClosableByLeftArrow.java`（19L） | `[-]` | 空标记接口（`ClosableByLeftArrow.java:18`，无任何方法），唯一消费者是 Swing `WizardPopup` 的按键分派；本仓没有该分派面，没有可移植行为 |
| `PopupOwner.java`（35L，JC/PT） | `[-]` | Swing 归属窗口抽象（`AWTWindow`/`Window`） |
| `NextStepHandler.java`（8L） | `[~]` | 分步弹层的下一步钩子（`handleNextStep(PopupStep, parentValue)`）。本仓的步骤推进在 `src/popupSteps.ts` 的 `chosenOutcome`（有子步骤就换内容、否则关层）与 `autoSelectionFired`，但**没有把"下一步"交给外部回调**的入口 —— 消费点 `src/components/ContentComboLabel.vue` 的列表恒无子步骤（`hasSubstep` 未给 ⇒ 按下即关），所以这个钩子此刻没有消费者；造一个只被自己调的接口就是空壳 |
| `PopupUpdateProcessorBase.java`（9L） / `HintUpdateSupply.java`（192L） | `[-]` | 针对 Swing JList/JTree/JTable 的提示更新 |
| `GroupedItemsListRenderer.java`（106L）/ `PopupListElementRenderer.java`（603L）/ `IconListPopupRenderer.java`（27L） | `[-]` | `ListCellRenderer` 渲染器 |
| `PopupListAdapter.java`（185L）/ `PopupTableAdapter.java`（84L）/ `PopupTreeAdapter.java`（102L） | `[-]` | Swing JList/JTable/JTree 适配器 |
| `HeavyWeightPopup.java`（31L） | `[-]` | AWT 重weight 弹层 |
| `SelectablePanel.kt`（167L，G2D/A11Y） | `[-]` | Swing 可选中面板 |
| `BackendRenderedPopup.kt`（6L） | `[-]` | 后端渲染弹层（远程/JCEF 场景） |
| `LocalPopupComponentFactory.kt`（163L，POPUP/REG） | `[-]` | Swing 组件工厂 |
| `FilterableListPopupStep.kt`（8L） | `[~]` | 可过滤的分步弹层：唯一方法 `updateFilter(f: String?)` —— 过滤串一变就回调这一步（`platform/platform-impl/src/com/intellij/ui/popup/list/FilterableListPopupStep.kt:8-10`）。本仓的行模型过滤是 `src/popupSteps.ts` 的 `listStepRows(step, { query })`（纯函数，每次渲染按当前串重算），消费点 `src/components/ContentComboLabel.vue`；**缺**的只是"把串推回 step"这一条反向通知（本仓 step 是只读描述对象，没有 `updateFilter` 这样的可变入口）—— 形态差异 |
| `PopupInlineActionsSupport.kt`（49L）/ `PopupInlineActionsSupportImpl.kt`（99L）/ `NonActionsPopupInlineSupport.kt`（46L）/ `InlineActionsUtil.kt`（47L） | `[~]` | 列表项右侧的行内动作（悬停显示）。**本仓已有等价交互**（见 `docs/ui-placement-audit.md` §AF）：欢迎页项目行 = 上游 `ProjectsTabFactory.kt:285-300` 的「组首项当主行、其余进行内动作」，次级动作悬停/聚焦才浮现（CSS `opacity: 0 → 1`，`:741-742`）；通知列表行同规格。**未落**：装不下时的「更多」收纳（`calcExtraButtonsCount` 那半）—— 本仓这两处用 `flex-wrap` 换行、不会溢出，所以不做没有消费者的抽象 |
| `PopupImplUtil.java`（113L，POPUP/JLIST/DIM） | `[~]` | 弹层尺寸计算工具。**`getPopupSize`（`:103-113`）已落**（2026-10-06 本 lane 复算订正：原写「弹层尺寸计算工具」无落点）：`AbstractPopup.getDimensionServiceKey` 的存档尺寸优先、否则用内容首选尺寸那一支，落成 `src/popupBounds.ts`（`parsePopupBounds`/`serializePopupBounds`/`clampPopupLocation`）与 `src/popupAnchor.ts`（按实测尺寸纠正锚点），消费点 `src/components/SearchEverywhereDialog.vue` 等。**缺**：`uiSnapshotForList`（`:60-84`，把 JList 的选中项塞进 `DataSink`）与 `getClickSourceFromLastInputEvent`（`:87-97`，从 AWT 事件反查点击源组件）—— 本仓列表行由 Vue 数据驱动、点击源就是 DOM 事件目标，两者都没有对应物 |
| `MockConfirmation.java`（26L） | `[-]` | 测试用假确认框 |
| `package-info.java` ×3 | `[-]` | 包声明 |

## 2026-10-04 补判：4 个从未出现在本判决书里的类

复核方式（可重跑）：把 `docs/inventory/ui.txt` 里 `/com/intellij/ui/tabs/` 与 `/com/intellij/ui/popup/`
的行取出来（去掉 `package-info.java`）得到 124 个类名，逐个在本文档里找 —— 下面 4 个一次都没出现。
门禁 `tests/b1-verdict.test.mjs` 现在把这条查法固定下来（少一个就红）。

| 类 | 源码 | 判定 | 说明 |
|---|---|---|---|
| `ComponentPopupBuilderImpl` | `platform-impl/.../ui/popup/ComponentPopupBuilderImpl.java`（395 行） | `[~]` | `ComponentPopupBuilder` 的实现：把**一个 Swing 组件**包成弹层（标题/图标按钮/mask/鼠标检查器/焦点恢复）。本仓对应物是 DOM 浮层族 —— `src/popupAnchor.ts`（按实测尺寸落位）、`src/popupBounds.ts`（越界夹取）、`src/popupState.ts`（尺寸记忆）—— 覆盖"定位/取尺寸/记忆"三条；**没有**复刻的是 Swing 组件树那层与 `MaskProvider`/`ActiveIcon` 这类渲染配件，故判 `[~]` |
| `FileColorsOptionsTopHitProvider` | `lang-impl/.../ui/tabs/FileColorsOptionsTopHitProvider.java` | `[~]` | 把文件颜色开关喂进「随处搜索/查找操作」的 TopHitProvider（返回 `BooleanOptionDescription` 列表）。本仓等价通道是动作索引 + 设置搜索，**已落并已接**（2026-10-06 本 lane 复算订正：原写「缺的是以 TopHit 行呈现这一形态的逐项对齐」，与磁盘不符）：行规在 `src/fileColorsOptions.ts`（`fileColorOptionRows`/`fileColorOptionPatch`/`fileColorSearchRows`/`FILE_COLORS_SETTINGS_PAGE`），消费点是 `src/menuUi.ts:74`/`:286`（三个勾选型搜索行随设置实时显形）与 `src/App.vue:113`/`:1677`（`fileColorRows` 绑到 `saveSettingsPatch`）；开关本身在 `src/fileColors.ts` / `src/fileColorsHost.ts` + 设置页复选框。仍差的只是上游 `SearchTopHitProvider` 那一层的模糊匹配算法（本仓走 `rankCommands`，不是 `WordPrefixMatcher`） |
| `ListPopupWrapper` | `platform-impl/.../ui/popup/list/ListPopupWrapper.kt`（18 行） | `[~]` | 接口：包一层 `basePopup`，`getRootPopup` 沿链走到根弹层。本仓子菜单链是 `src/menus/types.ts` 的 `children`/`childrenOf` + `src/menus/submenuState.ts`；"根弹层"没有显式建模 —— 关闭链靠 host 的 backdrop/Esc 一把收掉，行为结果一致但没有可查询的根对象 |
| `TreePopupImpl` | `platform-impl/.../ui/popup/tree/TreePopupImpl.java`（463 行） | `[~]` | 树形选择弹层（`TreePopupStep` + 速度搜索/过滤）。本仓同类交互各点自建：`src/components/TargetChooserPopup.vue`（「选择声明」）、`src/components/BreakpointsDialog.vue`（列表+详情）、`src/speedSearch.ts`；**没有**可复用的树形 `TreePopupStep` 模型 |

**本轮补判的四档增量**：`[~]` +4 ⇒ 与原表 107 行（`[x]`1 / `[~]`34 / `[ ]`39 / `[-]`33）合起来是
**`[x]`1 / `[~]`38 / `[ ]`39 / `[-]`33 = 111 行**（另有 2026-09-27 的 20 条补判，两者不重叠）。
（这是 2026-10-04 当时的快照；**当前四档以 §D 统计为准** —— 同日后一轮处置把 `[ ]` 清成 0。）

## D. 统计

| 档 | 数量 |
|---|---:|
| `[x]`（已移植） | 8（文件颜色三件 + `PopupState` 的 200ms 抑制 + `MnemonicsSearch` + `TabsUtil` 几何 + `ScrollableTabsRow`） |
| `[~]` 部分 | 58 |
| `[ ]` 未移植（TODO） | 0 |
| `[-]` 不适用 | 59 |
| 合计 | 125 格（124 个类名：`PopupState.java` 在 `ui/popup/` 与 `ui/popup/util/` 各有一个，故两格） |

**2026-10-04 本轮改判**：`ScrollableTabsRow.kt` `[~]` → `[x]` —— 修掉滚动排 + 固定排的两个真缺陷
（`dropped` 的下标轴与全固定时的空排，判据 `tests/tab-strip-scroll-pinned.test.mjs`），该行的"缺"归零；
`ScrollableMultiRowLayout.kt` / `TabInfo.kt` 的理由随之改精确。四档因此从 7/59/0/59 变成 8/58/0/59。

**2026-10-04 处置**：原表最后 20 个 `[ ]`（`ui/tabs` 8 类、`ui/popup` 12 类）逐条改判，`[ ]` 归零 ——
`[~]` 11 个（`JBTabsPosition` / `JBTabsPresentation` / `TabsListener` / `MorePopupAware` / `TabLayout` /
`AbstractPopup` / `PopupDispatcher` / `StackingPopupDispatcherImpl` / `WizardPopup` / `ListPopupModel` /
`AsyncPopupStep`，都指到本仓真实文件）、`[-]` 9 个（`TabInfoIconHolder` / `TabSideSplitter` /
`WindowTabsLayout` / `AsyncPopupWaiter` / `MovablePopup` / `PopupComponent` + `PopupComponentFactory` /
`PopupAlignableComponent` / `ClosableByLeftArrow`，都带上游文件:行号的 Swing 依据）。
`TabsListener` 的判决格此前写 `[ ]`、理由末尾却写"判 `[~]`"（自相矛盾），本轮统一为 `[~]`；
`AsyncPopupStep` / `AsyncPopupWaiter` 原来合在一格，按"一步 `[~]`、一 Swing `[-]`"拆成两行。

**第九十三批的变化**（弹层详情面板）：`[ ]` → `[~]` 四类（`DetailController` / `DetailView` /
`DetailViewImpl` / `ItemWrapperListRenderer`）、`[ ]` → `[-]` 一类（`MasterController`）。

**第九十批的变化**（多行布局的另两种排法）：`[ ]` → `[~]` 十类
（`SingleRowLayout` / `SingleRowLayoutStrategy` / `ScrollableSingleRowLayout` / `MultiRowLayout` /
`CompressibleMultiRowLayout` / `CompressibleTabsRow` / `ScrollableMultiRowLayout` / `ScrollableTabsRow` /
`SimpleTabsRow` / `TabsRow`）；`[ ]` → `[-]` 三类（`LayoutPassInfo` / `SingleRowPassInfo` /
`MultiRowPassInfo` —— 三个都是 Swing 通过程数据对象）。另有四个 `[~]` 的理由被重写。

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

### 族二 · 弹层详情面板（`ui/popup/util`，7 类）—— **第九十三批已落**

IDEA 的"弹层右侧详情区"：列表在左、选中项的详情在右。
**这一族在整棵上游树里只有一个真实消费者**：`BreakpointsDialog`（断点对话框）——
`BreakpointsDialog.java` 与 `BreakpointChooser.java`，其余引用都在包内部。
所以本仓不建一个没人用的通用框架，而是把它的行为落到同一个消费点上：
`查看断点…`（Ctrl+Shift+F8，`ViewBreakpointsAction`）打开 {BD}，数据与规则在 {PD}。

| 类 | 判定 | 依据 |
|---|---|---|
| `DetailController.java` | `[~]` | 详情面板的控制器。**已落**：{PD} 的 `elidePath`（照 `getTitle2Text`，`DetailController.java:38-49`：从第 4 个字符之后找分隔符、前缀 `...`、**找不到就原样返回**）与 `detailPaneState`（照 `doUpdateDetailView` `:60-80`：恰好选一项才出详情，否则清空并把路径标签置成空格）。**缺**：上游那个 `Alarm` 的延迟刷新（本仓是 computed，没有"稍后合并更新"的必要） |
| `MasterController.kt` | `[-]` | 主列表控制器接口（`getSelectedItems()` + `getPathLabel()`）。本仓的等价物是 {BD} 的 `selectedId` 与 `pane.pathLabel` 两个 computed —— 单窗口单列表，不值得再抽一层接口 |
| `DetailView.java` / `DetailViewImpl.java` | `[~]` | 详情区本体。**已落**：`PreviewState`/`previewStateOf`（照 `DetailView.java:36-58` 的 `PreviewEditorState`：行 < 0 ⇒ 没有导航位置）、`NOTHING_TO_SHOW`（`IdeCoreBundle.properties:143`，中文包 :91），渲染在 {BD} 的右栏。**缺**：上游嵌的是真编辑器（`EditorFactory.createViewer`），本仓用只读代码块；`getPropertiesPanel` 没有要展示的属性表 |
| `ItemWrapper.java` | `[-]` | 抽象基类，签名是 `setupRenderer(ColoredListCellRenderer, …)` —— Swing 渲染器契约。它承载的能力归到下面那行 |
| `ItemWrapperListRenderer.java` | `[~]` | 列表项渲染。**已落**：{BD} 的 `.breakpoints-row`（选中态 + 键盘上下移动，照 `JList` 的选中行为）。**缺**：`myAccessory`（行尾的附属组件）与 `setupRenderer` 的颜色分段 —— 本仓的列表是单列 |
| `SplitterItem.java` | `[-]` | `JBSplitter` 的行内实现细节。本仓的两栏是 CSS grid，没有 splitter 条目这个概念 |

### 族三 · 弹层位置与内容刷新（`ui/popup`，3 类）—— 部分可移植

| 类 | 判定 | 依据 |
|---|---|---|
| `PopupPositionManager.java` | `[~]` | 弹层贴着**代码补全 lookup** 摆位（`import LookupEvent / LookupEx / EditorEx`）。**几何那一半已落并已接**（2026-10-06 本 lane 复算订正：原写「可移植且 Web 下由 CSS 定位承担」，未指出落点）：`src/popupPosition.ts` 的 `adjustBounds`/`positionRight`/`positionLeft`/`positionAbove`/`positionUnder`/`crop`/`DEFAULT_GAP=5`（逐条照 `:35`/`:140`/`:158-173`/`:220-294`）+ `childStepAnchor`（`WizardPopup.showChildPopupComponent` 那一支，`STEP_X_PADDING=2`），消费点是 `src/popupAnchor.ts` 的 `fallback` 与 `src/toolWindowManager.ts`/`src/toolWindowViewMode.ts`；点锚点的简版在 `src/popupPlacement.ts`。**缺**：`lookup` 专属的跟随补全框（本仓没有补全弹窗，没有可跟随的 lookup） |
| `PopupUpdateProcessor.java` | `[~]` | 弹窗已开着时，内容随数据源变化而**就地刷新**（`import DocumentationManager / LookupManager / QuickSearchComponent`）。**已落并已接**（2026-10-06 本 lane 复算订正：原写「真实缺口 —— 本仓的弹层都是一次性快照」，与磁盘不符）：`src/searchEverywhereHost.ts:373-387` 的 `watch(() => fsChanges.version, …)` —— 弹层开着时文件一变就重取文件清单（`refreshFiles`，200ms 抖窗）并按同一查询词重发符号请求（`onSearchEverywhereQuery(lastQuery)`，`:379`），正是"数据变了刷新已开的弹层"这一条（`PopupUpdateProcessor.beforeShown` 的 `LookupListener.currentItemChanged → updatePopup` 同构）；另有 `:369-371` 的 `[activePath, lspReady]` 监听作废旧符号响应。判据 `tests/search-everywhere-text.test.mjs`/`tests/search-everywhere.test.mjs` 覆盖这条刷新链。**缺**：`HintUpdateSupply`/`QuickSearchComponent` 那两个 Swing 提示供给源（见 `PopupUpdateProcessorBase`/`HintUpdateSupply` 行，Swing 专属） |
| `NotLookupOrSearchCondition.java` | `[-]` | 谓词对象，判断"当前不是 lookup/搜索态"；依附于上面两个的前提设施 |

**这一族的真实落点**：`PopupUpdateProcessor` 那条 `[~]` 的用户可感差异是「弹层开着时数据变了要自己更新」——
对 Search Everywhere 尤其明显（改了文件，弹层还是旧快照）。**该通道已落**（见上表那一行，
`src/searchEverywhereHost.ts:373-387`），现在缺的只是那两个 Swing 提示供给源。
## 第九十批实现（B1-g）：挤压排与滚动排（`EditorTabbedContainer.createRowLayout` 的另两支）

上游那一处分派是**唯一**的（`EditorTabbedContainer.kt:657-672`）：

```
if (!isSingleRow || (isHorizontalTabs && (showPinnedTabsSeparately() || !hideTabsIfNeeded))) {
  !isSingleRow                 -> WrapMultiRowLayout          （换行；本仓原有的 layoutMultiRow）
  UISettings.hideTabsIfNeeded  -> ScrollableMultiRowLayout    （滚动排，右边留「…」）
  else                         -> CompressibleMultiRowLayout  （挤压排，只压不换行）
} else                           ScrollableSingleRowLayout    （单行裁切 + 滚轮）
```

`UISettingsState.kt:125` `var hideTabsIfNeeded: Boolean by property(true)` ⇒ **默认滚动**。
所以挤压与滚动这两排都发生在**"一行"这一侧**，`singleRow()` 为假时永远是换行排 ——
这一点本批第一版写错过（放到了多行那一支），真机点"挤压"没反应才改回来。

落点：`src/tabStripLayout.ts` 的 `layoutCompressibleMultiRow` / `layoutScrollableMultiRow`
（纯函数）+ `src/tabStripView.ts` 的分派与滚轮/偏移接线 + `src/components/EditorTabsSettingsPage.vue`
的那两组单选（文案取随 IDE 发货的中文包 `ApplicationBundle.properties:133/680-685`）。

### 真机抓到的两个缺陷（都是只有真机能发现的）

1. **绝对定位元素用 `width:auto` 量到的是 shrink-to-fit，不是自然宽。**
   多行那两族把标签写成 `position: absolute`，而绝对定位的 `width:auto` 是"包含块宽 − left"。
   在条尾的标签因此量到一丁点宽（实测 left=665、条宽 702 时量到 37，而不是真正的 171）。
   这个被缩小的值进了缓存，之后每次重算都按"自然宽本来就这么小"算，标签永远回不到原宽 ——
   现象是**窗口拉宽也不恢复**。修法：测量期间连 `position/left/top` 一起摘掉。
   （`measureTabNaturalWidth` 的注释里写明了这条。）
2. **ResizeObserver 只在第一次调用时登记对象。** 原写法 `if (tabStripObserver) return` 让
   观察者盯着第一个标签条元素；元素被替换过（分栏/切工作区/模板重挂）之后，窗口变化不再触发重算。
   改成每次重算都 `observe()` 一遍（对同一元素是幂等的）。

第一个是"值错了"，第二个是"根本不跑"—— 两个都只有把窗口拉宽才显形，单测看不见。

### 判据

`tests/tab-strip-rows.test.mjs` 15 条：挤压排（从最长的开始降、下限、不换行、固定排单独一条）、
滚动排（放不下才留「…」、右边缘裁切与 `dropped`、偏移夹取、固定排是挤压的）、以及三处接线。
另修 `tests/tab-strip-wrap.test.mjs` / `tests/tab-strip-pinned-row.test.mjs` 里读设置页的那几条
（那一页已拆成 `EditorTabsSettingsPage.vue`）。

### 未落（如实）

- `decreaseInsets` 的 insets 逐档收缩与 `CachedDecoration`：Swing 装饰的中间量，本仓用一条常量下限代替。
- `ScrollableMultiRowLayout` 的 `isScrollBarAdjusting` / `recentlyActive` 守卫：Swing 事件态。
- `MultiRowLayout.getRowY` 的 bottom 位置：本仓标签条只在顶部。

## 第九十三批实现（B1-h）：弹层的主从详情面板 —— 落到它唯一的真实消费者上

上游那一族（`platform/lang-impl/src/com/intellij/ui/popup/util/`）在**整棵源码树里只有一个
真实消费者**：`BreakpointsDialog`（`BreakpointsDialog.java` + `BreakpointChooser.java`，
其余引用都在包内部）。所以本仓不建通用框架，而是照上游把那套行为落到同一个消费点上：

- `查看断点…`（Ctrl+Shift+F8，`ViewBreakpointsAction`）打开的**不再是"跳去调试工具窗口"**，
  而是真对话框 `src/components/BreakpointsDialog.vue`；
- 纯规则在 `src/popupDetail.ts`：`elidePath`（`getTitle2Text`，`:38-49`）、
  `detailPaneState`（`doUpdateDetailView`，`:60-80`，"恰好选一项才出详情"）、
  `PreviewState`/`previewStateOf`（`DetailView.java:36-58`）、
  `NOTHING_TO_SHOW`（`IdeCoreBundle.properties:143`，中文包 :91 =「没有要显示的内容」）。

**写测试时抓到的一个真缺陷**：断点列表原来按 `path`（尾部带行号）做字典序排，
于是第 10 行排到第 9 行前面。改成"先按文件路径、再按行号**数值**"。

三处如实差异：① 上游详情嵌的是真编辑器，本仓用只读代码块；
② 上游列表按 文件/行/条件 分列，本仓单列（条件在详情里）；③ `MasterController` 判 `[-]`（单列表不值得再抽接口）。

判据 `tests/popup-detail.test.mjs` 19 条。真机取证：`查找操作` 搜「查看断点」执行 ⇒
对话框标题「断点（0）」、路径标签是单个空格、正文「没有要显示的内容」——
与上游"空选时清空并把路径标签置空"逐条对上。

**2026-10-06（b1b7verdict lane）复算订正（档位不动，四档仍 8/58/0/59）**：逐条开过磁盘后改精确了八行的「缺」——
`TabInfo`（`alert/blink` 已落 `src/tabAlerts.ts` + App.vue 接线）、`ActionButton`/`ActionPanel`（`src/tabEntryPoint.ts`/`src/tabEntryPointMenu.ts`）、
`AbstractPopup`（三条命名定位变体已落 `src/popupPlacement.ts`）、`PopupUpdateProcessor`（弹层开着跟数据刷新已落 `src/searchEverywhereHost.ts:373-387`）、
`WizardPopup`（分步模型已落 `src/popupSteps.ts`）、`ListPopupModel`（行模型/原索引映射已落 `src/popupSteps.ts` + `ContentComboLabel.vue`）、
`NextStepHandler`/`FilterableListPopupStep`/`PopupImplUtil`/`ComboBoxPopup`/`PopupPositionManager`（各指出真实落点）。
`PopupDispatcher`/`StackingPopupDispatcherImpl` 两条本 lane 前一批已订正（全局弹层栈 `src/popupStack.ts`）。
