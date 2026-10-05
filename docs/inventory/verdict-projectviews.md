# 判决：`projectviews`

> 本文件由 `python scripts/verdict_table.py projectviews` **生成**，不要手改：
> 族判词在脚本的 `FAMILIES` / `PLATFORM_FAMILIES` 表里（逐族读过源码给的），逐类表在 `docs/inventory/<域>_verdict_table.md`，
> 门禁 `tests/verdict-generated.test.mjs` 读同名 `.json`。

方法（与 B1–B7 同一口径，只是规模不同：本域 2243 类没法逐条手抄）：

1. **族级判词**：类按包归族（`RULES`），每族一条判词，写清用户可见行为在本仓落在哪个文件、缺什么；
   判词里引用的本仓路径由门禁逐个核对**真实存在**。
2. **逐类覆盖**：族档位落到族内每个类，再叠两类机械修正 ——
   ① `OVERRIDES` 的逐类例外（族整体一个档、个别类本仓真做了）；
   ② **Swing 降级**：族判 `[~]` 但类本身是 Swing 组件本体（`JComponent`/`paintComponent`/`JBPopup`/`JList`…）的判 `[-]`。
3. 机械信号由 `scripts/verdict_signals.py` 产出（行数 / Swing / 平台专属 / 在 TaoCode 里出现过没有），每行的档位都能复算。

## projectviews（755 类）

| 档 | 类数 |
|---|---:|
| `[x]` | 0 |
| `[~]` | 574 |
| `[ ]` | 0 |
| `[-]` | 181 |
| 合计 | 755 |

| 族 | 档 | 判词（本仓落点 / 缺什么） | 类数 |
|---|---|---|---:|
| `pv/project-view-nodes` | `[~]` | 项目视图的节点族与装饰（`ExternalLibrariesNode`/库与 SDK 行/合成行/`GroupByTypeComparator`/File Nesting）。本仓：`src/externalLibraries.ts`（外部库真展开 + 项目 SDK/合成库行，判据 `tests/external-libraries.test.mjs`）+ 节点图标与 tooltip 在 `src/components/FileTree.vue`；`src/projectTreeSort.ts`（`GroupByTypeComparator` 与 `PsiFileNode.ExtensionSortKey`：BY_TYPE + 目录置顶）；`src/projectTreeNesting.ts`（`NestingTreeStructureProvider`/`FileNestingBuilder`/`ProjectViewFileNestingService` 的默认规则：同名同目录、只嵌一层，`src/projectTreeModel.ts` 消费，判据 `tests/project-tree-nesting.test.mjs`）；`src/projectTreeDecorations.ts`（`ProjectViewNodeDecorator` 的等价物：按诊断给文件行换色，判据 `tests/project-tree-decorations.test.mjs`）。缺：包视图（`PackageViewPaneModel`/`ClassesTreeStructureProvider` 的 flatten/compact middle packages 呈现，需 PSI/Java 模型）、模块分组（`ModuleGroup`/`MoveModuleToGroup`/`ModuleListNode`）、可编辑的嵌套规则（上游 `FileNestingInProjectViewDialog`；本仓 `createProjectTreeModel` 没有设置页给 `nestingRules` 喂值，只用 `DEFAULT_NESTING_RULES`）、同一文件多 pane 呈现（`ProjectFileNode`）、Detach/Attach 库（`DetachLibraryDeleteProvider`）、inplace comments（`ProjectViewInplaceCommentProducerImpl`） | 122 |
| `pv/welcome` | `[~]` | 欢迎页（`WelcomeScreen`/`NewRecentProjectPanel`/`RecentProjectPanel`）。本仓：`src/components/WelcomePage.vue`（Projects/Customize 两页 + 最近项目搜索、多选、分组的新建与折叠、移除确认、复制路径、在资源管理器中显示 —— `RemoveSelectedProjectsAction`/`RevealProjectDirAction` 的等价物）+ `src/welcomeProjects.ts`（搜索/分组归类/路径展示，判据 `tests/welcome-projects.test.mjs`）。**两项已落地**（2026-10-05 复核修正）：① `EmptyStateProjectsPanel` 的空态已在 `src/components/WelcomePage.vue:669-683`（竖排 quick-action 组 + 「更多」下拉，与上游 `EmptyStateProjectsPanel.kt:43-90` 同形）；② `ChangeProjectColorActionGroup` 已在 `src/welcomeProjectColor.ts`（九个 index 次序 `0,1,2,8,7,4,3,5,6` 照 `ChangeProjectColorActionGroup.kt:33-44`，九对渐变照 `RecentProjectIconHelper.kt:468-487`，判据 `tests/welcome-project-color.test.mjs`），挂点 `WelcomePage.vue` 的行菜单二级项。仍缺：Plugins/Learn 两个标签页（`PluginsTabFactory`/`LearnIdeTabFactory` 与课程卡片；插件管理在 `src/components/PluginDialog.vue`，欢迎页没有这一页 —— Learn 的课程数据来自 `plugins/ide-features-trainer`、远程走 JetBrains Gateway，本仓两者都没有，画出来就是假控件）、远程开发分组与 WSL 推广面板（`WslPromoPanelUsageCollector`；本仓没有任何远程后端）、`OpenAlienProjectAction` 的跨 IDE 打开（Gateway 远程后端）、`WelcomeScreenCustomization`/`TabbedWelcomeScreen` 的标签页扩展点（无插件 EP 宿主） | 98 |
| `pv/structure-view` | `[~]` | 结构视图（`StructureViewComponent`/`StructureViewModel`）。本仓：`src/components/OutlinePanel.vue`（工具条：按名称排序/平铺/按种类分组/名称过滤 + **展开全部/折叠全部**，行前的箭头逐节点收起）+ `src/outlineView.ts`（从 LSP `documentSymbol` 折层级：`KindSorter`、speed filter、按符号位置为键的折叠状态 —— 过滤命中时自动展开路径，判据 `tests/outline-view.test.mjs`）+ Ctrl+F12 的文件结构弹层复用 `src/lspNavigation.ts` 的当前文件符号。缺：`Show Inherited Members`（继承节点来自 PSI/语言服务，LSP `documentSymbol` 不区分继承成员）、autoscroll to/from source 两个开关（`StructureViewComponent` 的跟随编辑器开关）、PSI 侧的排序器族（`VisibilitySorter`/`Sorter` 扩展点；本仓只有名称与种类两档） | 94 |
| `pv/history` | `[~]` | 本地历史（`LocalHistoryImpl`/`HistoryEntry`）。本仓：`native/history.cpp`（按路径的快照存取与差异）+ `src/components/HistoryPanel.vue`（单文件时间线：列表/差异/恢复）+ `src/historyFollow.ts`（`--follow` 式重命名跟踪：把 `git.status` 的 `renameFrom` 链并进面板，标「重命名前」）。缺：跨文件/目录级的会话视图（上游 `LocalHistoryFacade` 的 ChangedFiles/Recent Changes 与目录历史；本仓面板只跟当前文件与它的重命名前身）、`PutLabelAction` 的标签位（`LocalHistoryLabel` 一族）与「恢复整个会话」；重命名前身的时间线只能看差异，回滚按当前路径落盘（`src/historyFollow.ts` 的模块头写明这条限制） | 94 |
| `pv/todo` | `[~]` | TODO 工具窗口（`TodoView`/`TodoTreeBuilder`/`TodoPattern`）。本仓：`src/components/TodoPanel.vue` + `src/todoTree.ts`（包/文件/条目树与分组）+ `src/todoView.ts`（标记匹配、颜色列、按 `project.scopes` 的作用域过滤，判据 `tests/todo-view.test.mjs`）+ `src/todoFilters.ts`（过滤器/分组/预览三个弹层，判据 `tests/todo-filters.test.mjs`）+ `src/todoPatterns.ts`（模式表与校验）+ 设置页 `src/components/TodoPatternsPage.vue`（模式/说明/颜色/区分大小写四列）+ `src/todoScan.ts`（提交检查里的 TODO 扫描，复用同一份模式表）。**可保存的具名过滤器已落地**（2026-10-05 复核修正）：`src/todoFilters.ts:52/:79-86` 的存储 + `src/components/TodoPatternsPage.vue:16/:58/:79-84` 的设置页编辑 + `src/components/TodoPanel.vue:7/:48/:171` 的面板下拉，三条链路都通（`FilterDialog`/`FiltersTableModel` 的等价物），**原先的「缺」已撤销**。仍缺：编辑器内的 TODO 高亮（`TodoHighlightVisitor`；本仓编辑器只画语言服务诊断与语义标记，注释里的标记不着色）、按语言的 TODO 索引器扩展点（`TodoIndexer`/`TodoIndexPatternProvider`；本仓是统一文本扫描）、按变更列表/提交检查分桶的面板（`ChangeListTodosPanel` 一族）与多行 TODO 的 locality 检测（`MultiLineTodoLocalityDetector`） | 80 |
| `pv/command` | `[~]` | 撤销/重做（`UndoManagerImpl`/`CommandProcessor`/`UndoableAction`）。本仓：编辑器内文本撤销由 CodeMirror `history` 承担（`src/components/CodeEditor.vue` 的 `basicSetup`，每个编辑器实例一份栈）；`src/editorCommands.ts` 只登记编辑命令，没有应用级命令栈。缺：跨文件的全局撤销栈（`UndoManagerImpl` 的 `UndoRedoStacksHolder`：撤销可跨标签、连重命名/移动文件一起撤）、`UndoProvider`/`FileUndoProvider` 与 `ChangeRange`/`StartMarkAction` 的命令标记（本仓文件新建/重命名/删除在 `src/explorerActions.ts`/`src/treeActions.ts` 直接落盘，不可撤）、`CannotUndoReportDialog` 与 `CommandMerger` 的命令合并 | 77 |
| `pv/ide-misc` | `[-]` | `platform/ide` 的其余基础设施（应用生命周期钩子/服务注册内部件）。没有 JVM 对象模型可移植；用户可见面（欢迎页/通知/本地历史）在上面的族里 | 75 |
| `pv/notification` | `[~]` | 通知中心与气球（`NotificationsManagerImpl`/`Notification`）。本仓：`src/components/NoticeList.vue` + `src/notices.ts`（同 displayId 顶替、前插、级别/预览/标题与过期规则，判据 `tests/notices.test.mjs`）+ `src/notifications.ts`（通知中心的宿主接线：气球与状态栏共用一份历史）+ `src/progressNotices.ts`（LSP `$/progress` 与 Gradle 同步的进行中/结束通知，判据 `tests/progress-notices.test.mjs`）。缺：`NotificationGroup` 注册体系（`NotificationGroupManager`/`NotificationGroupEP` 按组决定显示方式，本仓没有组概念）、`NotificationRouter` 与 `DoNotAskManager`（「不再询问」与按项目路由；本仓只有单条关闭/过期）、Event Log 工具窗口（`NotificationsToolWindow` 的历史列表视图）、`NotificationsBeeper` 声音提示与 `RemindLaterManager`「稍后提醒」 | 69 |
| `pv/project-view` | `[~]` | 项目视图（`ProjectViewImpl`/`AbstractProjectViewPane`/节点与排序）。本仓：`src/components/FileTree.vue` + `src/projectTreeModel.ts`（树模型：懒展开、`ExpandRecursivelyAction` 式的递归展开、全部展开/折叠）+ `src/projectTreeState.ts`（折叠状态持久化）+ `src/projectViewBehavior.ts`（预览标签/单击打开/始终选中）+ `src/projectTreeSort.ts`（排序）+ `src/speedSearch.ts`（速度搜索）+ `src/components/ProjectViewSortSettings.vue`（排序键与三条视图行为的设置页）。缺：多窗格项目视图（`SplitProjectViewUtil` 的左右双窗格与 Attach to Pane；本仓单窗格，分屏只在编辑器侧 `src/editorSplits.ts`）、`ProjectViewPane` 的插件贡献点与 `CustomizeTreesAction` 的窗格定制、`MarkRootGroup`/`MarkAsContentRootAction` 这组标记根动作（根与 SDK 只在 `src/components/ProjectStructurePane.vue` 编辑，项目树右键没有 Mark Directory As）、`ProjectViewPreloadMode`/`ProjectViewPerformanceMonitor` 的预加载与性能面板 | 41 |
| `pv/bookmarks-alias` | `[~]` | 书签（`com/intellij/ide/bookmarks`）。本仓落点：`src/bookmarks.ts`（重锚与对账）+ `src/bookmarkActions.ts` + `src/components/BookmarksPanel.vue` + `src/bookmarkLists.ts`。**已单独判决**：见 `docs/inventory/verdict-bookmarks.md`（B5，5 类全 `[~]`）—— 这里只做覆盖登记、不重复判 | 5 |

## 合计

`[x]` 0 + `[~]` 574 + `[ ]` 0 + `[-]` 181 = **755**
（`execution` 1608 + `xdebugger` 635）

**已知缺口（族判词里逐条写着，这里点名最要紧的几条）**：

- 运行/调试本仓是「通用表单 + 实例模型 + DAP」：**没有** per-type 配置编辑器、模板与共享配置、多运行目标；
- 测试侧：断言视图（`src/assertionView.ts`）与结构化事件通道（`smRunner` 等价物，`src/testEventChannel.ts`，判 `[~]`）已落地；JUnit 检查规则做了纯文本子集（`src/junitInspections.ts`，判 `[~]`）；覆盖率做了报告侧子集（`src/coverageReport.ts` 读 JaCoCo/Kover XML，判 `[~]`），采集通道仍缺（见 `exec/coverage` 判词）；
- 调试侧本轮补上行内值（`src/debugInlineValues.ts` + 复用 `debugLineExtension` 的 `inlineValuesField`）、多行求值对话框与历史面板、监视持久化、断点的命中次数/日志入口与临时/依赖/静音/全清、最近附加目标、`ShowExecutionPoint`/`EvaluateInConsole`；仍缺逻辑断点组（断点写入口过 `src/App.vue`，本轮冻结）、悬停快速求值、附加进程列表（宿主无进程枚举通道）、Smart Step Into/强制单步（`src/bridge.ts` 冻结，Method union 里没有 `stepInTargets`）；
- `[-]` 的两大来源：JVM 内部管线（`ProcessHandler`/`ExecutionUtil`/`RunProfileStarter`）与 Swing 组件本体。
