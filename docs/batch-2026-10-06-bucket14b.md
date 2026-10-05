# 桶 14b · 项目视图面板（结构视图 / 本地历史 / TODO 半区）· 2026-10-06

范围：族 `pv/structure-view`(94 类) / `pv/history`(94 类) / `pv/todo`(80 类)（归属表 `.tools/family-ownership.csv:28-29,38`）。
判词来源：`docs/inventory/verdict-projectviews.md:29`（structure-view）、`:30`（history）、`:31`（todo）。

**本文件的写法**：上一个代理（14b 的前一轮）在平台 150 次调用上限处被切断，**代码落了、一个字报告都没写**，
所以这份报告是**从磁盘实况反推交付面**：先 `.tools/bucket-landing.mjs 14` 拿文件清单，再逐文件 `git diff` 读实际改动，
再逐条打开本仓代码核实「这条判词说的东西真在不在」，最后逐条把上游坐标在基准树里打开对行号。
基准树：`D:\Backup\Downloads\intellij-community-master\intellij-community-master`（下面每一条上游坐标本轮都亲手 `sed`/`grep` 过行号）。

---

## 0. 接手现场与三条**订正**（不照抄判词，也不照抄任务书前提）

| # | 原判词 / 前提 | 磁盘实况（本轮实测） | 处理 |
|---|---|---|---|
| 1 | 判词 `verdict-projectviews.md:29` 说结构视图「缺：PSI 侧的排序器族（本仓只有名称与种类两档）」与「autoscroll to/from source 两个开关」 | **已做**：可见性排序在 `src/structureFollow.ts:24,38` + `src/outlineView.ts:55,84`；两个跟随开关在 `src/components/OutlinePanel.vue:35-36,116-117`；逐节点折叠 + 全部展开/折叠在 `:43-48,118-119`；`caretSymbolInTree`（`:127`）+ 光标 watch（`OutlinePanel.vue:70-79`） | 判词的「缺」已过期 ⇒ 下表按「本仓已有 / 还差」重写 |
| 2 | 判词 `:31` 说本地历史「缺：跨文件/目录级的会话视图」与「恢复整个会话」 | **已做**：会话视图 `src/historySessions.ts:45,65,95,116` + `src/components/HistoryPanel.vue:18-19,51-65,89-103`；「恢复到此时刻」`:178`；时段标题 `src/historyTimeline.ts:17,38,47` | 同上；剩下的差距只有「宿主没有跨文件会话索引」这一条（见 §5） |
| 3 | 判词 `:32` 说 TODO「缺：多行 TODO 的 locality 检测」与「按变更列表分桶」与「速度搜索」 | **已做**：`src/todoMultiLine.ts:78,119,131` + `TodoPanel.vue:40,118`；变更列表作用域 `src/todoView.ts:61,64,79` + `TodoPanel.vue:141`；速度搜索 `TodoPanel.vue:49,168-184`（`installTreeSpeedSearch` 语义：打字只**选中**不裁剪） | 同上；**唯一真缺**的是编辑器内的 TODO 着色（见 §1 表末与 §5） |
| 4 | 任务书前提：「`src/components/ProjectViewSortSettings.vue` 是真的没接（零消费方）」 | **不成立**：`src/components/ToolWindowView.vue:18` import、`:224` 在项目视图齿轮里渲染（且这行在 `git diff` 里是**上下文行**⇒ 接线早于本轮）；`tests/project-view-behavior.test.mjs:56` 还按它在齿轮里的位置做了判据。权威门禁 `node .tools/find-orphan-modules.mjs --gate` 也没把它列成新增孤儿 | 不改动代码；按 `.tools/bucket-landing.mjs` 的启发式**误报**登记（与 `TrustedLocationsSettingsPage.vue` 同一类：它只数 `src/*.ts` 的消费方，`.vue` 挂点看不见）。`src/components/FileNestingSettings.vue` 由它 → 齿轮 → `FileTree.vue` 的整条链在 `--gate` 里已显示「已接上（可以更新基线）」 |
| 5 | `tests/pv-command-wiring.test.mjs` 断言 `[...selection.value]`（上一轮由用户改掉） | 真源核对通过：`src/projectTreeModel.ts:26` 的 `selection` 是 `reactive(new Set())`，**不是 ref** ⇒ `[...selection]` 才是对的。属「断言过期」不是「放松断言」 | 本轮不再动；留痕在此（判据仍覆盖同一行为，只是解包方式按真源类型改正） |

**另外两条不属于本半区、但在同一批未提交改动里的文件**（不认领、不重做）：
`src/components/FileTree.vue`(94 处改动) 与 `src/components/ProjectViewSortSettings.vue`(41 处) 属 **14a**；
`src/components/ProjectStructurePane.vue`(302 处) / `ProjectStructureDialog.vue`(4 处) 的改动是**桶 15**（根与 SDK：`src/rootsModel.ts`、`rootAppearance.ts`、`projectDirectories.ts`、`libraryRootDetection.ts`、`rootsAttachScan.ts`）；
`WelcomePage.vue` / `welcomeProjects.ts` / `FileChooserDialog.vue` / `fileChooserModel.ts` / `trustedProjects.ts` / `TrustedLocationsSettingsPage.vue` / `TrustedProjectDialog.vue` 属 **14c**。

---

## 1. 判词表

### 族 `pv/structure-view`（上游 `platform/lang-impl/src/com/intellij/ide/util/fileStructure` 的实际落点是 `platform/structure-view-impl`，本轮实测）

| 项 | 判定 | 上游依据（相对路径:行号） | 本仓落点（文件:行号） | 说明 |
|---|---|---|---|---|
| 按种类分组（`KindSorter`） | `[x]` | `java/java-structure-view/src/com/intellij/ide/structureView/impl/java/KindSorter.java:15`（`implements Sorter`）、`:24` `ID = "KIND"`、`:33-58` 的 `getWeight`：类 10 → 初始化块 15 → 父类型组 20 → 构造器 30 → 方法 35 → 属性组 40 → 字段 50 → 其它 60 | `src/outlineView.ts:55`（`symbolKindRank`）、`:84`（三趟稳定排序）、`src/components/OutlinePanel.vue:33,110` | 有序偏离，如实写明：本仓把 LSP `SymbolKind` 折成 4 档，**构造器与方法同档**（上游 30/35 分开）、**类型参数并入类档**（上游算「其它」60）。理由是 `documentSymbol` 的 kind 与 PSI 的 tree element 不是一一对应，硬拆会造出上游没有的档位 |
| 按可见性排序（`VisibilitySorter`） | `[x]` 本轮判词里的「缺」撤销 | `java/java-structure-view/.../VisibilitySorter.java:14`（类）、`:34`（`ID = "VISIBILITY_SORTER"`）、`:38`（`VisibilityComparator.INSTANCE`）；`VisibilityComparator.java:16`（`UNKNOWN_ACCESS_LEVEL = -1`）、`:23-29`（同级交给 next，否则 `accessLevel2 - accessLevel1`）；`java/java-psi-api/src/com/intellij/psi/util/PsiUtil.java:223-226`（public 4 / protected 3 / package-local 2 / private 1）、`:623-634`（按修饰符短路定级） | `src/structureFollow.ts:24,38`、`src/outlineView.ts:84-97`、`src/components/OutlinePanel.vue:35,111` | 本仓没有 PSI，可见性只能从 `documentSymbol.detail` 读（`visibilityAccessLevel` 的短路次序照 `PsiUtil:623-634`）；判不出来 ⇒ `-1` 排最后，与上游同一个数 |
| 折叠状态 / 全部展开 / 全部折叠 | `[x]` | `platform/structure-view-impl/src/com/intellij/ide/structureView/newStructureView/StructureViewComponent.java`（树节点身份 = PSI 元素；`getChildren()` 非空才画箭头） | `src/outlineView.ts:46`（`outlineKey` = 名字 + 起止位置）、`:26-31`（`hasChildren`/`collapsed`）、`:100`（`mayCollapse`）；`OutlinePanel.vue:39-48,120-131` | 键的必要性（同名不同位置是两个节点）有判据：`tests/outline-view.test.mjs`「outline keys identify a symbol by name and position」 |
| 过滤命中时展开路径 | `[x]` | 上游 speed search 命中会展开结果树（`StructureViewComponent.java:655-661` 的 `scrollToSelectedElement` 同族行为） | `src/outlineView.ts:100`（`!needle` 才允许折叠）、`:104-107` | 平铺视图忽略折叠：`tests/outline-view.test.mjs`「the flat view ignores collapse state entirely」 |
| 跟随编辑器：选中树节点 → 跳源码（`AUTOSCROLL_MODE`，默认**开**） | `[x]` | `StructureViewComponent.java:794-802`（`scrollToSource` → `OpenSourceUtil.openSourcesFrom`）；`StructureViewFactoryImpl.java:49`（`AUTOSCROLL_MODE = true`） | `src/structureFollow.ts:93`（`shouldRevealInEditor`）、`OutlinePanel.vue:58-63,116` | 关掉时单击只更新选中、双击/回车仍跳 —— 与上游「只停发 `scrollToSource`」一致 |
| 跟随编辑器：光标 → 选中并滚过去（`AUTOSCROLL_FROM_SOURCE`，默认**关**） | `[~]` 本仓已有规则 + 面板；**还差挂点（接线请求 W1）** | `StructureViewComponent.java:655-661`（`scrollToSelectedElement` 开头就判 `AUTOSCROLL_FROM_SOURCE`）、`:804-849`（`MyAutoScrollFromSourceHandler`，`:831-834` 注册光标监听、`:841` 读开关）；`StructureViewFactoryImpl.java:50`（默认 false） | `src/outlineView.ts:127`（`caretSymbolInTree`）、`src/structureFollow.ts:63,71,75`、`OutlinePanel.vue:70-81`（watch + 展开祖先 + `scrollRowIntoView`）、`:117`（开关按 `v-if="source"` 渲染） | 挂载点 `src/components/ToolWindowView.vue:172` 只传 `path/symbols/available` ⇒ 拿不到光标。规约「没有消费链路的 UI 一律不渲染」，所以**整格不画**，不留点了没反应的开关；W1 是 1 行 `:source="ctx.todoSource"`（数据源 `src/App.vue:199` 已有、`TodoPanel` 已在吃）。门禁：`tests/outline-view.test.mjs`「the follow-editor toggle is not rendered without caret data」 |
| `Show Inherited Members` | `[ ]` 具体理由 | 上游继承成员由 PSI 超类型解析补进结构树（`StructureViewComponent.java` 的树元素来自 `StructureViewTreeElement.getChildren()`，Java 侧 `java/java-structure-view/.../PsiClassTreeElementBase.java` 一族） | —— | 卡点：本仓结构视图的数据只有 LSP `textDocument/documentSymbol`，它对「继承来的成员」不出条目 —— 要合成必须自己按类型做 `typeDefinition` + 逐父类再取符号，且拿不到「哪个成员被覆盖」的判定（LSP 无 override 关系），做出来是**猜出来的树**。判词写的「缺」这一条仍然成立 |
| 结构视图弹层 Ctrl+F12 | `[x]`（早前轮次，本轮回归通过） | `$default.xml` 的 `InspectAction`/`FileStructurePopup` 键位族 | `src/lspNavigation.ts` + `src/components/ProjectStructureDialog.vue`（不在本轮改动面） | 本轮只跑判据，未改 |

### 族 `pv/history`（上游实际落点 `platform/lvcs-impl/src/com/intellij/history/integration/ui/**`，`platform/lang-impl` 下没有 history 包 ⇒ 判词给的起点提示不成立，按文件名/包路径/语义三条路各走过）

| 项 | 判定 | 上游依据（相对路径:行号） | 本仓落点（文件:行号） | 说明 |
|---|---|---|---|---|
| 单文件时间线 + 差异 + 回滚 | `[x]`（早前轮次，本轮回归通过） | `platform/lvcs-impl/src/com/intellij/history/integration/HistoryManagerImpl`/`FileHistory` 族；桥侧 `native/history.hpp` 的 `list/content/diff/diffSides` | `native/history.cpp`（900 行）、`src/components/HistoryPanel.vue:110-165`、挂载 `src/App.vue:2369`（`@revert="revertHistory"`） | 本轮只重排了「所选行所属路径」这一维（快照按行取，不再恒取 `props.path`） |
| 重命名前（`--follow` 式前身链）并进时间线 | `[x]` | 上游历史按 `ContentEntry`/虚拟文件身份连续，重命名不丢历史（`platform/lvcs-impl/src/com/intellij/history/integration/LocalHistoryActionImpl` 的 rename 事务） | `src/historyFollow.ts:28`（`renameChain`）、`:50`（`mergeHistory`）、`HistoryPanel.vue:68-83`、`:166`（`canRevert`） | 限制仍在且写在模块头：宿主的回退只写当前活动文件 ⇒ 「重命名前」那几节**只能看差异不能回滚**，按钮 `:disabled` + 标题把原因说出来（不是假控件） |
| 时段标题（最近 12 小时 / 更早 / 旧的更改） | `[x]` 本轮新增判词里的「缺」撤销 | `platform/lvcs-impl/src/com/intellij/history/integration/ui/views/RevisionsList.java:63`（`RECENT_PERIOD = 12`）、`:136`（`today - timestamp < 1000*60*60*RECENT_PERIOD`）、`:222`（`revisions.table.period.recent`） | `src/historyTimeline.ts:17,22,38,47`、`HistoryPanel.vue:22,61`，渲染 `hist-period` | 换算式与单位逐字照上游；小时数取常量不写死毫秒（样式/魔法数门禁） |
| 跨文件的**会话视图**（ChangedFiles / Recent Changes） | `[~]` 本仓已有；**还差宿主的会话索引** | `DirectoryHistoryDialog.java:52`（`extends HistoryDialog<DirectoryHistoryDialogModel>`）、`:57`（`(Project, IdeaGateway, VirtualFile)` = 传一个目录进对话框）；`RecentChangesAction.java:18`（类声明）；`RevisionsList.java:390,442`（会话行的「N files」计数列） | `src/historySessions.ts:26`（路径上限 32）、`:45`（候选 = 变更集含 renameFrom + 当前文件）、`:65,88,95`（目录前缀过滤）、`HistoryPanel.vue:18-19,51-65,89-103`，工具条渲染在 `hist-tools` | 架构不等价：`native/history.hpp` 的 `list()` 只收一个 path（`native/main.cpp:1400-1410`），**没有**「按时间窗返回一批文件会话」的方法（`src/bridge.ts:109` 的 Method union 里也只有 `history.list/content/diff/diffSides` 四个）。⇒ 用 N 次 `history.list` 拼，N 有上限，被截掉时**状态行如实报数**（`sessionNote`），不谎称完整 |
| 「恢复整个会话」 | `[x]` 本轮新增 | `RevisionsList.java:442`（一行的会话身份）+ 上游 revertion 族 `platform/lvcs-impl/testSrc/com/intellij/history/integration/revertion/LocalHistoryLabelsTest.kt` 覆盖的「按时间点回退」语义 | `src/historySessions.ts:101`（`newestSnapshotBefore`）、`:116`（`sessionRevertPlan`）、`HistoryPanel.vue:178-211` | 活动文件仍走宿主 `emit('revert')`（会重建缓冲并重记历史），其余文件用本仓**已有**的 `file.read` + `file.write` + `lsp.change`；写不进（版本冲突/已删/内容一致）计入跳过并报数，不静默 |
| 行级 unified diff 的算法位置 | `[x]`（行数控件的重构，非功能） | —— | `native/history_diff.cpp:1-131`（`trim_cr`/`split_lines`/`build_script`/`render_hunks`）+ `history_diff.hpp`、`native/history.cpp:4`（include）、`:681-683`（`unified_diff`） | 登记在册：`CMakeLists.txt:67` 已把 `native/history_diff.cpp` 编进 `taocode_history`（`:198-200` 的 `history_test` 也链它）⇒ 不是没进构建的死文件。`history.cpp` 1019 → 900 行，回到 1050 上限内 |
| `PutLabelAction` 的标签位 + 标签列 | `[ ]` 具体理由 | `platform/lvcs-impl/src/com/intellij/history/integration/ui/actions/PutLabelAction.java`（实测存在）；**`LocalHistoryLabel` 作为类在本基准树里搜不到**（`find -name "*LocalHistoryLabel*"` 只命中测试 `…/revertion/LocalHistoryLabelsTest.kt`） | —— | 卡点两层：① 上游标签是**写进历史索引**的具名锚点，本仓 `native/history.hpp:35` 的索引条目只有 `{id,time,reason,bytes}`，加一列要动 `native/history*`（在名下）+ 索引读写 + 桥载荷（`src/bridge.ts` 保留）；② 判词引用的 `LocalHistoryLabel` 类路径给不出行号 ⇒ 无法核实那一族到底有几个可见面，不照抄 |

### 族 `pv/todo`（上游 `platform/todo/src/com/intellij/ide/todo` + `platform/editor-ui-ex/src/com/intellij/ide/todo` + `platform/vcs-impl/lang/todo`）

| 项 | 判定 | 上游依据（相对路径:行号） | 本仓落点（文件:行号） | 说明 |
|---|---|---|---|---|
| 标记匹配 / 命中优先级 / 颜色列 / 作用域过滤 | `[x]` 本轮（判词只写到颜色与作用域，优先级与「首条命中」是同一模块） | `platform/editor-ui-ex/src/com/intellij/psi/impl/search/IndexPatternSearcher.java:254,261`（ occurrence 带 `additionalRanges`）；`TodoHighlightVisitor.java:91-93`（`getWordToHighlight()`）、`:96-107`（区间） | `src/todoView.ts:17,25,31,37,45,50,64,79`；`src/todoPatterns.ts:16,19-22,36`（`color` 字段 + `#RRGGBB` 校验，与原生 `validate_todo_patterns` 同一套） | 表序即优先级（首条命中）、模式没带色就用中性色 `#8a8f98`，**不冒充色方案色** —— 判据 `tests/todo-view.test.mjs` |
| 树分组（包 / 平铺包 / 文件 / 条目） | `[x]`（早前轮次，本轮回归通过） | `platform/todo/src/com/intellij/ide/todo/TodoTreeBuilder`、`TodoPanelSettings` | `src/todoTree.ts:7-16`（`TodoItem` 加 `column`/`additional`）、`:17-20` | 本轮只扩了多行 TODO 需要的两个字段 |
| 速度搜索（打字选中，不裁剪列表） | `[x]` 本轮新增 | `platform/todo/src/com/intellij/ide/todo/TodoPanel.java:286`（`installTreeSpeedSearch(myTree)`）、`platform/platform-impl/src/com/intellij/ui/TreeSpeedSearch.java`（命中即 `selectElement`） | `src/components/TodoPanel.vue:49,168-184`（`onTreeKeydown` / `jumpToSpeedHit`，退格删字、Esc 清串） | 复用本仓已有的 `src/speedSearch.ts` 的 `firstSpeedSearchHit`；判据 `tests/todo-view.test.mjs`「面板真的接上了多行/变更列表/速度搜索（不是死代码）」 |
| 多行 TODO（续行 + 显示上限 + 「更多」） | `[~]` 本仓已有可见面；**还差索引** | `platform/editor-ui-ex/src/com/intellij/ide/todo/TodoConfiguration.java:48`（`myMultiLine = true`）、`:139,143`；`platform/todo/src/com/intellij/ide/todo/configurable/TodoConfigurableUI.kt:15,21`（`multiLineCheckBox`）；`IndexPatternSearcher.java:278-313`（`findContinuation`）；`platform/todo/src/com/intellij/ide/todo/nodes/TodoItemNode.java:152-169`（`:169` 取「去行首空白后的整行」）；`MultiLineTodoRenderer.java:21`（`MAX_DISPLAYED_LINES = 10`）、`:76`（超限画「更多」） | `src/todoMultiLine.ts:30,33,78,109,119,131,153`；`TodoPanel.vue:40,42,118-136,72-74,312-313` | 架构不等价如实写明：上游续行判定来自**索引里的注释区间**，本仓只有文本正则 ⇒ 必须逐文件 `file.read`，所以① 默认**关**（与上游相反，是有意的：打开要读 64 个文件）② 有 `TODO_MULTILINE_FILE_LIMIT = 64` 上限 ③ 被截时写状态行（`multilineNote`），④ 读失败的文件保持单行不谎报 |
| 命名过滤器（`TodoFilter`）+ 设置页编辑 + 面板下拉 | `[x]` 本轮（判词 2026-10-05 已撤销过一次的「缺」，本轮补上面板里「过滤器 / 单条标记」合一格） | `platform/indexing-impl/src/com/intellij/ide/todo/TodoFilter.java:14`（`implements Cloneable` 的 final 类）；宿主表 `platform/editor-ui-ex/src/com/intellij/ide/todo/TodoConfiguration.java:29`（`@State(name = "TodoConfiguration")`）、`:38`（应用级 service）、`:50`（`private TodoFilter[] myTodoFilters`）、`:134,149`（读写）；`platform/todo/src/com/intellij/ide/todo/configurable/FilterDialog.java:27`、`FiltersTableModel.java:13` | `src/todoFilters.ts:1-20,28,30,60,63,84,93,102`；`src/components/TodoPatternsPage.vue:55-92,131-155,172`；`TodoPanel.vue:29-31,64-68` | 引用不存在的类名**已订正**（见 §2 订正留痕）：原注释写 `TodoFilterSettings`，基准树里没有这个类 |
| 变更列表作用域（只列未提交改动里的任务） | `[x]` 本轮新增 | `platform/vcs-impl/lang/todo/src/com/intellij/ide/todo/ChangeListTodosPanel.java:69-78`（`getDefaultChangeList()` 的名字做页签、`:78` 退回 `todo.tab.title.all.changes`） | `src/todoView.ts:61,64`；`TodoPanel.vue:44,61,141-166` | 本仓变更集 = `git.status` 的未提交改动（含 `renameFrom`）。空集时写「当前没有未提交变更…」、Git 失败时写「拿不到变更列表：原因」，**不静默退化成「全部」** |
| 预览里的标记着色 | `[x]` 本轮新增（上游编辑内着色在本仓的唯一真实可见面） | `TodoHighlightVisitor.java:91-93,96-107` | `src/todoMultiLine.ts:131`（`todoMarkerRegions`）、`TodoPanel.vue:77-90`（`markerSegments`）+ `:349-360` 的预览渲染 | 只着色**面板预览**，不动编辑器 —— 见下一行 |
| 编辑器内的 TODO 着色 | `[ ]` 具体理由 | 同上 `TodoHighlightVisitor.java:88-108`；注释区间来自 `IndexPatternSearcher.java:172-210` 的 `findComments` | —— | 卡点两层：① 上游着色只落在**注释**里，靠的是索引给的文件级 comment ranges；本仓没有注释区间索引（LSP `semanticTokens` 各服务器口径不一，不能当注释真源），照文本正则画会把字符串里的 "TODO" 一起点亮 —— 那是假功能；② 落点在 `src/components/CodeEditor.vue`（保留文件），扩展注册点不在我名下。已交付的诚实子集是上一条（预览着色） |
| 按语言的 TODO 索引器扩展点（`TodoIndexer`/`TodoIndexPatternProvider`） | `[ ]` 具体理由 | `platform/indexing-impl/src/com/intellij/psi/impl/search/`（`IndexPatternBuilder` 一族，实测路径含 `IndexPatternSearcher.java`） | —— | EP 宿主不成立：本仓扫描走 `search.run`（一次 workspace walk + 正则），没有 per-language indexer 的注册与增量存储；判词自己写的「本仓是统一文本扫描」仍然成立 |
| 提交检查面板族（`ChangeListTodosPanel` 的独立工具窗口页） | `[~]` 本仓已有扫描器；**还差一页** | `ChangeListTodosPanel.java:69-78` | `src/todoScan.ts`（被 `src/components/SourceControl.vue` 消费，本轮未改）+ 上一条的「变更列表作用域」 | 本仓把「提交前扫到的 TODO」并进了提交那一侧与面板的作用域下拉，没有单独开一个 TODO 页签：工具窗口的页签注册不在我名下（`src/components/ToolWindowView.vue` 保留），且单开一页的数据源与已有下拉是同一份 ⇒ 开了就是重复渲染 |

---

## 2. 改动文件清单（行数前 → 后）

**本半区新增（纯规则模块，全部有生产消费方，见 §4）**
| 文件 | 行数 | 消费方 |
|---|---|---|
| `src/structureFollow.ts` | 95 | `src/outlineView.ts:4`、`src/components/OutlinePanel.vue:6` |
| `src/historyTimeline.ts` | 63 | `src/components/HistoryPanel.vue:9` |
| `src/historySessions.ts` | 127 | `src/components/HistoryPanel.vue:8` |
| `src/historyFollow.ts` | 56 | `src/components/HistoryPanel.vue:7` |
| `src/todoView.ts` | 93 | `TodoPanel.vue:6`、`TodoPatternsPage.vue:17`、`todoFilters.ts:15`、`todoMultiLine.ts` |
| `src/todoMultiLine.ts` | 155 | `TodoPanel.vue:7`、`src/todoTree.ts` 的字段口径 |
| `src/todoFilters.ts` | 113 | `TodoPanel.vue:9`、`TodoPatternsPage.vue:16`（+ 域外 `EventLogPanel`/`notificationDoNotAsk` 复用同一存储壳） |
| `tests/structure-follow.test.mjs` | 108（10 项） | —— |
| `tests/pv-history-session.test.mjs` | 107（10 项） | —— |
| `tests/todo-multiline.test.mjs` | 98（10 项） | —— |
| `tests/todo-view.test.mjs` | 78（8 项） | —— |
| `tests/todo-filters.test.mjs` | 58（5 项） | —— |

**本半区修改（前 → 后 = 当前行数，`git diff --numstat` 的 +/− 为准）**
| 文件 | 前 → 后 | + / − |
|---|---|---|
| `src/outlineView.ts` | 62 → 144 | +89 / −7 |
| `src/components/OutlinePanel.vue` | 74 → 172 | +121 / −23 |
| `src/components/HistoryPanel.vue` | 110 → 283 | +193 / −20 |
| `src/components/TodoPanel.vue` | 267 → 417 | +185 / −35 |
| `src/components/TodoPatternsPage.vue` | 105 → 180 | +77 / −2 |
| `src/todoTree.ts` | 97 → 106 | +10 / −1 |
| `src/todoPatterns.ts` | 42 → 48 | +7 / −1 |
| `src/structureFollow.ts` / `src/todoFilters.ts`（本轮订正注释） | —— | +8 / −2、+3 / −1（`TodoFilterSettings` 路径订正） |
| `tests/outline-view.test.mjs` | 56 → 144 | +89 / −1（含本轮新增的假控件门禁 +16） |
| `native/history.cpp` | 1019 → 900 | +3 / −122（diff 算法搬出，`CMakeLists.txt:67` 已登记） |

**订正留痕**
1. `src/todoFilters.ts:1-8,12-15` 与 `src/components/TodoPatternsPage.vue:55,131,172` 与 `tests/todo-filters.test.mjs:1`：上游类名 `TodoFilterSettings` **在基准树里不存在**（`find . -name "TodoFilterSettings.java"` 空）。已改成实测到的真源：`TodoFilter.java:14` + `TodoConfiguration.java:29,38,50,134,149` + `FilterDialog.java:27` + `FiltersTableModel.java:13`。**「应用级存储」这个结论没变**（`TodoConfiguration.java:38` 确实是 `ApplicationManager.getApplication().getService(...)`），改的只是类名与坐标。
2. `docs/inventory/verdict-projectviews.md:29-32` 里四条「缺」经开码核实为**已做**（§0 表 1-3 行），本表按 `[x]`/`[~]` 重写，判词文件本身（只读）未改。
3. `pv/structure-view`/`pv/history` 两条「上游起点提示」（`platform/lang-impl/src/com/intellij/ide/util/fileStructure`、`platform/lang-impl` 里的 `history`/`changes`）：本轮实测结构视图本体在 `platform/structure-view-impl/`、历史 UI 在 `platform/lvcs-impl/src/com/intellij/history/integration/ui/`，已按实测路径给坐标。

---

## 3. 验证数字

```
node --test tests/todo*.test.mjs tests/outline*.test.mjs tests/history*.test.mjs \
            tests/structure*.test.mjs tests/pv-*.test.mjs
  → tests 87 / pass 87 / fail 0        （接手时 86/86，本轮新增 1 条假控件门禁）

node --test …上面这组 + tests/sfc-single-root.test.mjs tests/ui-icons.test.mjs tests/module-size.test.mjs
  → tests 115 / pass 115 / fail 0
```
（`tests/history*.test.mjs`  glob 在本域只命中 `clipboard-history` 之外的空集 —— 域内历史判据实际叫 `tests/pv-history-session.test.mjs`，本轮按文件名单独跑过。）
逐文件：`outline-view` 12、`structure-follow` 10、`pv-history-session` 10、`todo-multiline` 10、`todo-view` 8、`todo-filters` 5、`todo-tree` 若干（域内合计 87）。
`tests/sfc-single-root.test.mjs` / `tests/ui-icons.test.mjs` / `tests/todo*.test.mjs` 共 51 条（上一轮 `TodoPanel.vue:359` 少闭标签的修复**未动**，本轮复核仍绿）。
`npx vue-tsc -b`：本域 14 个文件 **0 条错误**（仓库存量错误快照 `docs/tsc-error-snapshot-2026-10-05.md` 未变差）。
域外未跑：`npm test` 全量（规约要求只跑自己域）。

## 4. 零消费方自查与反向验证

**门禁**：`node .tools/find-orphan-modules.mjs --gate`
→ 已登记孤儿 9 / 基线 21 · **本轮清掉 12**（含 `src/components/FileNestingSettings.vue`，即 14a 那条死模块已接上）·
**新增 1 个不属于本域**：`src/rootsJarEntries.ts`（桶 15 的根/SDK 面）⇒ 门禁当前为红，但红的不是 14b：本半区 7 个新模块逐条有生产消费方（§2 表的「消费方」列，`grep -rl` 实测），无孤儿。
`.tools/bucket-landing.mjs 14` 报的两条 ⚠（`ProjectViewSortSettings.vue`、`TrustedLocationsSettingsPage.vue`）都是**该工具的启发式误报**：它数 `src/*.ts` 的引用，看不见 `.vue` 挂点（证据：`ToolWindowView.vue:18,224`；`SettingsDialog.vue:34,1014`）。

**其它自检**（收工四连，本轮改后复跑）：`find-param-props.mjs` 0 处 · `find-ts-in-mjs.mjs` 干净 · `find-missing-ext.mjs` 扫描 1195 个文件干净 · `verify-fake-controls.mjs` 未新增命中。
新文件上限：最大 `todoMultiLine.ts` 155 行 / `history.cpp` 900 行 / `history_diff.cpp` 131 行，都在（ts 900 / native 1100）内，未调上限。

**反向验证（新门禁注入违规必须变红，再撤掉）** —— 对 §1 里那条假控件门禁做的：
```
1) cp src/components/OutlinePanel.vue /tmp/op.bak
2) 把 :117 的 `<button v-if="source" … :class="{ on: autoscrollFromSource }"` 的 `v-if="source"` 删掉（= 画一个没有数据源的开关）
3) node --test tests/outline-view.test.mjs
   → ✖ the follow-editor toggle is not rendered without caret data   tests 12 / pass 11 / fail 1   ← 变红，门禁有效
4) cp /tmp/op.bak src/components/OutlinePanel.vue（还原）
5) node --test tests/outline-view.test.mjs  → tests 12 / pass 12 / fail 0
   git diff --stat 回到 121 insertions / 23 deletions（注入未留残迹）
```

## 5. 做不到 / 无法核实

1. **结构视图「跟随编辑器光标」端到端**：卡在挂点。`src/components/ToolWindowView.vue:172` 是保留文件；已写 `docs/wiring-requests-2026-10-06-bucket14b.md` W1（1 行，数据源 `src/App.vue:199` 已有）。规则与判据都在（`caretSymbolInTree` + 10 项 `tests/structure-follow.test.mjs`），只差入参。
2. **会话视图的完整跨文件索引**：卡在原生方法面。`native/history.hpp` 的 `list(path)` 单路径、`src/bridge.ts:109` 的 Method union 只有 4 个 `history.*`，加方法要动 `native/main.cpp:1400`（保留）与桥类型（保留）⇒ 现在用「≤32 路径 × `history.list`」近似，超出上限如实写状态行。**无法核实**上游一次会话查询的的真实代价（没找到 `HistoryDialog` 侧的批量查询实现，`platform/lvcs-impl/src/com/intellij/history/integration/ui/` 里只见到 UI 侧）。
3. **历史标签（`PutLabelAction` 一族）**：`LocalHistoryLabel` 类**无法核实**（基准树 `find -name "*LocalHistoryLabel*"` 只命中测试文件），且写标签要改索引条目形状（`native/history*` 在名下但 `src/bridge.ts` 的 `HistoryEntry` 类型在保留文件里）。
4. **编辑器内 TODO 着色**：需要注释区间，本仓无注释索引（§1 具体理由），落点 `CodeEditor.vue` 又是保留文件。
5. **`Show Inherited Members`**：LSP `documentSymbol` 不出继承成员，合成要猜覆盖关系（§1 具体理由）。
6. **门禁整体为红**：唯一新增孤儿 `src/rootsJarEntries.ts` 不在桶 14b 名下（桶 15 的 `roots*/library*` 面），我不越界改它。
