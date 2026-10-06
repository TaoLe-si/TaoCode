# 项目视图四族 · 判词先核后做 · 2026-10-06（代号 `projecttree`）

范围：族 `pv/project-view-nodes`(122 类) / `pv/project-view`(41 类) / `pv/structure-view`(94 类) / `pv/command`(77 类)。
族判词来源：`docs/inventory/verdict-projectviews.md:28`（nodes）、`:36`（project-view）、`:30`（structure-view）、`:33`（command）；
逐类档位来源：`docs/inventory/projectviews_verdict_table.md`。
**已落的不重做**：`docs/batch-2026-10-06-bucket14a.md`（nodes + project-view + command 的半区）、
`bucket14b.md`（structure-view + history + todo）、`bucket14c.md`（WelcomePage 拆分，与这四族无关，只用来排除归属）。
本轮做的是**逐条开码复核** + 复核里查出的四条真缺/真错 + 三条假坐标订正。

基准树：`D:\Backup\Downloads\intellij-community-master\intellij-community-master`（下面每条上游坐标本轮都亲手打开数过行号）。

---

## 0. 开工前的三条订正（任务书与既有报告的坐标，按图索骥会扑空）

| # | 原写 | 实际（本轮实测） | 处理 |
|---|---|---|---|
| 1 | 任务书：结构视图上游在 `platform/lang-impl/src/com/intellij/ide/util/fileStructure` | **该目录在基准树里不存在**（`find platform -type d -name fileStructure` 只命中测试数据 `java/java-tests/testData/fileStructure`、`java/java-tests/testSrc/com/intellij/java/ide/fileStructure`、`plugins/kotlin/idea/tests/testData/structureView/fileStructure`）。Ctrl+F12 那个弹层的真身在 `platform/structure-view-impl/src/com/intellij/ide/util/FileStructurePopup.java`；动作类叫 `ViewStructureAction`（`platform/structure-view-impl/src/com/intellij/ide/actions/ViewStructureAction.java`） | 本表一律按实测路径给坐标；`fileStructure` 那条不再沿用 |
| 2 | 任务书：命令栈在 `platform/ide-impl` | **该模块目录不存在**（`ls platform/ide-impl` 无）。命令栈实现分两处：`platform/platform-impl/src/com/intellij/openapi/command/impl/`（`CommandProcessorImpl`/`UndoManagerImpl`/`Undo`/`Redo`/`CommandMerger`/`UndoableGroup`/`UndoRedoStacksHolder`/`StartMarkAction`/`FileUndoProvider` 的同包邻居）与 `platform/lvcs-impl/src/com/intellij/openapi/command/impl/FileUndoProvider.java`（237 行，**只有它**在 lvcs-impl） | 同上；`bucket14a.md` 记的 `FileUndoProvider` 路径与本轮实测一致，无需改 |
| 3 | `bucket14a.md` §1：Appearance 组里不渲染 `ShowLibraryContents`/`ShowScratchesAndConsoles` 的理由是「本仓没有对应数据源」 | **一半是错的**。`ShowScratchesAndConsoles` 有数据源、上游也真按得动（能力位见 §1 表）⇒ 本轮把它做出来了。`ShowLibraryContents` 不渲染的结论**对**，但理由是上游窗格能力位（`AbstractProjectViewPane.java:1029-1031` 默认 false + `ProjectViewPane.java:143-145` 把值硬写成 true），不是没有数据源 | 代码注释与本表都留痕（写「原写 X、实际 Y」） |
| 4 | `bucket14a.md` §4：右键「将目录标记为」那一格待接线（W1/W2） | **已接**（不是本轮做的）：`src/App.vue:2450-2452` 渲染 `markRootMenu(...)` 子菜单、`src/treeActions.ts:162-188` 出菜单与写回、`src/App.vue:852` 已把 `refreshTree` 传进依赖 ⇒ 本表改判 `[x]` | 只改判定，不动代码 |
| 5 | `bucket14b.md` §5-1：结构视图「跟随编辑器光标」卡在挂点（W1 未接） | **已接**：`src/components/ToolWindowView.vue:170` 现在是 `<OutlinePanel …  :source="ctx.todoSource" …>` ⇒ 端到端通了，本表改判 `[x]`；**只剩列精度**这一小截（宿主 `src/App.vue:215` 的 `todoSource` 只给 `{path, line}`，没给 `character`）⇒ 记 §7 W1 | 补了一条挂点判据（`tests/structure-follow.test.mjs` 第 11 项） |

---

## 1. 判词表

判定口径：`[x]` 已做且判据跑通 · `[~]` 部分（写「本仓已有」+「还差」）· `[ ]` 未做 · `[-]` 不适用（给具体理由）。
「本仓落点」给的是本轮复核时**真的打开过**的文件与行。

### 族 `pv/project-view`（41 类）

| 项 | 判定 | 上游依据（相对路径:行号） | 本仓落点（文件:行号） | 说明 |
|---|---|---|---|---|
| 齿轮 Appearance 组「显示临时文件和控制台」 | `[x]` **本轮新增** | 成员 `platform/projectView/shared/resources/intellij.platform.projectView.xml:81-84`；能力位 `platform/lang-impl/src/com/intellij/ide/projectView/impl/ProjectViewPane.java:172-175`（Project 窗格支持）+ `AbstractProjectViewPane.java:1037-1039`（基类不支持 ⇒ 别的窗格不画）；默认开 `platform/editor-ui-api/src/com/intellij/ide/projectView/ViewSettings.java:54-56` + `platform/lang-impl/src/com/intellij/ide/projectView/impl/ProjectViewSharedSettings.kt:28`；生效点 `platform/lang-impl/src/com/intellij/ide/scratch/ScratchTreeStructureProvider.java:199`（关着就不产出那一格）；翻完 `ProjectViewImpl.java:392-400` 走 `updatePanes(true)`（整棵窗格重建）；文案 `platform/platform-resources-en/src/messages/ActionsBundle.properties:1483` "Show Scratches and Consoles" | `src/projectViewBehavior.ts:37,62-67`（纯规则 `visibleSyntheticNodes`）、`src/projectTreeSort.ts:21-28`（设置键）、`src/projectTreeState.ts:7-16`（默认 true + 进 `BOOLEAN_KEYS` 读写）、`src/components/FileTree.vue:41,44`（喂进模型的 `synthetic`）、`:57-60`（进那条「设置变更 ⇒ 整树重建」的 watch）、`src/components/ProjectViewSortSettings.vue:43,51`（齿轮那一格） | 判据：`tests/project-tree-behavior.test.mjs` 第 4 项（行为）+ `tests/project-tree-appearance.test.mjs` 第 10/11/12 项（默认与旧存档缺键、齿轮渲染、接线）。外部库那一行**不受**这一格影响（`ProjectViewPane.java:143-145`） |
| Appearance 组的**成员次序** | `[x]` **本轮修正** | 同上 XML：`ShowScratchesAndConsoles`(:81) → `<separator/>`(:86) → `CompactDirectories`(:98) → `<separator/>`(:100) → `FileNesting`(:101) | `src/components/ProjectViewSortSettings.vue:51-55` | 原写「文件嵌套… → 压缩目录」（14a），与上游行序相反 ⇒ 改成「显示临时文件和控制台 → 压缩目录 → 文件嵌套…」并补两道分隔线。判据钉住了三个标签的渲染次序 |
| Behavior 组三条行为（单击打开 / 始终选择打开的文件 / 预览标签） | `[x]`（14a 前一轮，本轮复核通过） | `intellij.platform.projectView.xml:46-53`；默认 false `ProjectViewSharedSettings.kt:32-34` | `src/projectViewBehavior.ts:14-42`、`src/components/FileTree.vue:120-135`、`src/components/ToolWindowView.vue:217-219` | 复核点：三项的默认档、开关与渲染都真在；`ProjectView.OpenDirectoriesWithSingleClick`（`:50-51`，只管目录）本仓落在 `props.expandWithSingleClick`（编辑器设置那一侧），没有重复渲染 |
| 树模型：懒展开 / 递归展开 / 全部展开折叠 / 折叠态持久化 / 速度搜索 | `[x]`（早前轮次，本轮回归通过） | `platform/lang-impl/src/com/intellij/ide/projectView/actions/ExpandRecursivelyAction.kt`、`ProjectViewExpandAllAction.kt`（本轮实测存在） | `src/projectTreeModel.ts:194-261`、`src/projectTreeState.ts`、`src/speedSearch.ts` + `src/components/FileTree.vue:196-241` | 本轮未改；`tests/project-tree-*.test.mjs` 覆盖 |
| `MarkRootGroup` 右键「将目录标记为」 | `[x]`（本轮复核为已接，原判 `[~]`） | `platform/lang-impl/resources/intellij.platform.lang.impl.actions.xml:252-253`（组本体）、`platform/lang-impl/src/com/intellij/ide/projectView/actions/MarkRootGroup.java:16-32`（组标题按选区）、`MarkAsContentRootAction.kt:20-31`、`UnmarkRootAction.java:26-55` | `src/pvMarkRoots.ts:64-178`、`src/treeActions.ts:162-188`、挂载 `src/App.vue:2450-2452` | 判据 `tests/pv-mark-roots.test.mjs`（5 项，本轮全绿）。§0-4 的留痕 |
| 排除的粒度（按目录名，不是按路径） | `[-]` 架构不等价，如实偏离 | `platform/lang-impl/src/com/intellij/ide/projectView/actions/MarkExcludeRootAction.java:49-51`（上游按路径记 exclude folder） | `src/pvMarkRoots.ts:36-55` 模块头 + `markRootPatch` | 14a 已登记并被 `tests/pv-mark-roots.test.mjs` 钉住；本轮复核仍成立（`src/projectRoots.ts:66-68` 是段名匹配） |
| 「显示被排除的文件」(`ShowExcludedFiles`) | `[ ]` 卡宿主列举 | 成员 `intellij.platform.projectView.xml:68-71`；能力位 `ProjectViewPane.java:167-170`（**支持**）；默认 true `platform/lang-impl/src/com/intellij/ide/projectView/ProjectViewSettings.java:11-13`；过滤契约 `platform/lang-impl/src/com/intellij/ide/projectView/impl/nodes/PsiFileSystemItemFilter.java:24-31` | —— | 具体卡点：本仓的被排除目录**在列举时就被剪掉**（`native/workspace.cpp:479` 的 `ignored_directory`，`Workspace::open` 那侧持有 `excluded_`），前端拿不到「被排除的那几行」⇒ 无从显示。要做得先让宿主列举带出排除项并加标记位（载荷形状在 `src/bridge.ts` 的 `Entry`，保留文件）⇒ 见 §6 与 §7 W3 |
| 「显示库内容」(`ShowLibraryContents`) | `[-]` 具体理由（订正 14a 的理由） | `intellij.platform.projectView.xml:76-80`；`AbstractProjectViewPane.java:1029-1031`（`supportsShowLibraryContents()` 默认 **false**）、`ProjectViewPane.java:143-145`（Project 窗格把值硬写成 true）、`ProjectViewImpl.java:491-495`（按能力位决定这一项能不能点） | —— | Project 窗格里这一项上游就是灰的 ⇒ 本仓渲染它 = 画一个按了什么都不改的复选框，违反「不放假控件」。共享档里它的持久默认是 true（`ProjectViewSharedSettings.kt:27`），与「外部库那一条总是显示」一致，本仓现状即上游现状 |
| `ManualOrder` / 两条 `SortByTime*` | `[-]` 具体理由 | `intellij.platform.projectView.xml:107-109`、`:119-126` | `src/projectTreeSort.ts:1-5` 的注释 | `Entry`（`workspace.list` 载荷）只有 `{path,name,kind}`：没有 mtime，也没有手工排序位。做了就是假时间戳 |
| 多窗格项目视图（`SplitProjectViewUtil` / Attach to Pane） | `[-]` 有意不做 | `intellij.platform.projectView.xml:29-34`（三条注册表键 defaultValue 全是 false） | —— | 14a 结论复核成立：上游默认档就是关 |
| `CustomizeTreesAction` 窗格定制 | `[-]` 做不到 | `platform/lang-impl/src/com/intellij/ide/projectView/impl/CustomizeTreesAction.kt`（实测存在）、`intellij.platform.projectView.xml:104` | —— | 无窗格注册表可写；14a 结论成立 |
| `ProjectViewPreloadMode` / `ProjectViewPerformanceMonitor` | `[-]` 有意不做 | `platform/lang-impl/src/com/intellij/ide/projectView/impl/nodes/NodeWithMeasurableExpand.kt`（实测存在，同一族） | —— | 量的是 Swing 节点构建耗时；本仓行是 `computed` 出来的扁平表，指标不可比 |

### 族 `pv/project-view-nodes`（122 类）

| 项 | 判定 | 上游依据 | 本仓落点 | 说明 |
|---|---|---|---|---|
| 文件嵌套（默认规则 + **可编辑规则表** + 开关关掉谁也不嵌谁） | `[x]`（14a 接线，本轮复核通过） | `platform/lang-impl/src/com/intellij/ide/projectView/ProjectViewSettings.java:29-31`（`isUseFileNestingRules()` 直接 `return true`）、`platform/lang-impl/src/com/intellij/ide/projectView/impl/nodes/FileNodeWithNestedFileNodes.java`（实测存在）、`platform/projectView/shared/src/actions/ConfigureFilesNestingAction.kt:30-58` | `src/projectTreeNesting.ts`、`src/projectTreeNestingDialog.ts`、`src/projectTreeModel.ts:47-98,221-231`、`src/components/FileTree.vue:44,51-53`、`src/components/FileNestingSettings.vue` | 判据 `tests/project-tree-nesting.test.mjs` + `tests/project-tree-appearance.test.mjs` 的「嵌套规则由设置页喂进来」「对话框只在确定时落盘」两项（本轮全绿） |
| 压缩目录 | `[x]`（14a，本轮复核通过） | `platform/lang-impl/src/com/intellij/ide/scopeView/ScopeViewTreeModel.java:595-608,657-661,789-792`；默认 `NodeOptions.java:41-43` | `src/projectTreeCompactDirs.ts`、`src/projectTreeModel.ts:49-82` | 判据 4 项（`tests/project-tree-appearance.test.mjs` 前 4 项），本轮全绿 |
| 排序：`GroupByTypeComparator` + `PsiFileNode.ExtensionSortKey` + 目录置顶 | `[x]`（早前轮次，本轮复核） | `platform/editor-ui-api/src/com/intellij/ide/projectView/ViewSettings.java:20-22`（`isFoldersAlwaysOnTop` 默认 true）、`platform/lang-impl/src/com/intellij/ide/projectView/impl/nodes/PsiFileNode.kt`（实测存在） | `src/projectTreeSort.ts:26-92` | 判据 `tests/project-tree-behavior.test.mjs` 前 2 项；自然序比较器照 `NaturalComparator`（注释里写的 `platform/util/base/.../NaturalComparator.java:39-130` **带省略号**，属门禁不核的省略写法，本轮没有把它当完整坐标） |
| 节点装饰（`ProjectViewNodeDecorator` 的 "Highlight files with errors"） | `[x]`（早前轮次，本轮复核） | `platform/lang-impl/src/com/intellij/ide/projectView/ProjectViewNodeDecorator.kt:15-22`（`decorate(node, data)` 的 EP 接口） | `src/projectTreeDecorations.ts`、`src/components/FileTree.vue:87-113` | 判据 `tests/project-tree-decorations.test.mjs`；架构不等价：上游是 EP 由插件贡献，本仓的唯一数据源是 LSP 诊断 |
| 外部库 / SDK / 合成行 | `[x]`（桶 15 与 14 前几轮，本轮只核归属） | `platform/lang-impl/src/com/intellij/ide/projectView/impl/nodes/ExternalLibrariesNode.java`、`NamedLibraryElementNode.java`、`SyntheticLibraryElementNode.java`（三份实测存在） | `src/externalLibraries.ts`（不在我名下）+ `src/components/FileTree.vue:74-79,269-276` 的图标与 tooltip | 本轮只补了「合成行显示档」（见 project-view 族第一条），没有改库行模型 |
| 包视图（`PackageViewPaneModel` / flatten / compact middle packages / abbreviate） | `[ ]` 做不到 | `platform/lang-impl/src/com/intellij/ide/scopeView/ScopeViewTreeModel.java:285-297`（`flattenPackages` 先问 `ProjectFileIndex.getSourceRootForFile`）、`ProjectViewSettings.java:179-190`；成员 `intellij.platform.projectView.xml:87-97` | —— | 14a 结论复核成立：`Entry` 没有「这个目录是不是源根下的包」的判定，本仓也没有 PSI；按目录名猜包名 = 假功能 |
| 模块分组（`ModuleGroup`/`MoveModuleToGroup`/`ModuleListNode`） | `[ ]` 做不到 | `platform/lang-impl/src/com/intellij/ide/projectView/impl/nodes/ModuleListNode.java`、`ModuleGroupNode.java`、`platform/lang-impl/src/com/intellij/ide/projectView/actions/MoveModulesToGroupAction.java`（四份实测存在） | —— | 要模块模型 + 写回通道；桥的 Method 清单里没有任何 module 写回方法（`src/bridge.ts:109`） |
| `ProjectFileNode` 同一文件多窗格呈现 / Detach-Attach 库 / 就地注释 | `[ ]` 做不到 | `platform/lang-impl/src/com/intellij/ide/projectView/impl/nodes/DetachLibraryDeleteProvider.java`（实测不存在同名文件，实为 `platform/lang-impl/src/com/intellij/ide/projectView/impl/DetachLibraryDeleteProvider.java`）、`ProjectViewInplaceCommentProducerImpl.kt`（同目录，实测存在）、`intellij.platform.projectView.xml:85`（`ViewInplaceComments` 引用） | —— | 逐条理由见 `bucket14a.md` §1（窗格分叉呈现 / 合成行无 IO 能力 / 无 EP 宿主 + 行渲染契约不容纳就地编辑），本轮复核仍成立 |
| 树里的类成员与可见性图标（`ShowMembers` / `ShowVisibilityIcons`） | `[ ]` 做不到 | `intellij.platform.projectView.xml:64-75`；默认 `ProjectViewSettings.java:15-19`（两者都 false） | —— | 具体卡点：成员来自 PSI（`ViewSettings.java:29-31` 的注释就写着"displays members of classes"），本仓的树只有目录列举载荷；可见性图标同理。⇒ 这两格即使渲染也没有可显示的东西 |

### 族 `pv/structure-view`（94 类）

| 项 | 判定 | 上游依据 | 本仓落点 | 说明 |
|---|---|---|---|---|
| 按种类分组（`KindSorter`）/ 按名称 / 平铺 / 过滤 | `[x]`（14b，本轮复核） | `java/java-structure-view/src/com/intellij/ide/structureView/impl/java/KindSorter.java:16,24,33-58`（16 是 `public class KindSorter implements Sorter, TreeActionWithDefaultState`；14b 原写 `:15`，参考树那文件 1 行版权头之后整体下移 1 行 ⇒ 引用门读到的区间为空，按当前真行号改） | `src/outlineView.ts`、`src/components/OutlinePanel.vue:22-40` | 判据 `tests/outline-view.test.mjs`（14b 记 12 项，本轮未改） |
| 按可见性排序（`VisibilitySorter`） | `[x]`（14b） | `VisibilitySorter.java:34`、`VisibilityComparator.java:16,23-29`、`java/java-psi-api/src/com/intellij/psi/util/PsiUtil.java:223-226,623-634`（14b 原写的 `platform/lang-api/src/com/intellij/psi/util/PsiUtil.java` 参考树里没有该路径；`java/java-psi-api/...` 才是真路径，223-226 = `ACCESS_LEVEL_PUBLIC = 4 / PROTECTED = 3 / PACKAGE_LOCAL = 2 / PRIVATE = 1`，623-634 = `getAccessLevel(PsiModifierList)` 的短路定级） | `src/structureFollow.ts:24-54`、`src/components/OutlinePanel.vue:35,111` | 判据 `tests/structure-follow.test.mjs` 前 4 项 |
| 折叠 / 全部展开折叠 / 过滤命中时展开路径 | `[x]`（14b） | `platform/structure-view-impl/src/com/intellij/ide/structureView/newStructureView/StructureViewComponent.java:655-661` | `src/outlineView.ts:26-31,46,100-107`、`OutlinePanel.vue:39-48` | 判据钉住「同名不同位置是两个节点」与「平铺忽略折叠态」 |
| 跟随编辑器：选中树节点 → 跳源码（默认开） | `[x]`（14b） | `StructureViewComponent.java:794-802`；`platform/structure-view-impl/src/com/intellij/ide/structureView/impl/StructureViewFactoryImpl.java:49`（`AUTOSCROLL_MODE = true`） | `src/structureFollow.ts:110-112`、`OutlinePanel.vue:30-32,58-63,116` | 本轮复核：默认值与上游一致（面板 `autoscrollToSource = ref(true)`） |
| 跟随编辑器：光标 → 选中并滚过去（默认关）**端到端** | `[x]`（原判 `[~]`「卡在挂点」已过期） | `StructureViewComponent.java:655-661,804-849`；`StructureViewFactoryImpl.java:50`（`AUTOSCROLL_FROM_SOURCE` 默认 false） | `src/outlineView.ts:127`（`caretSymbolInTree`）、`src/structureFollow.ts:63-90`、`src/components/OutlinePanel.vue:66-81`、**挂点 `src/components/ToolWindowView.vue:170` 的 `:source="ctx.todoSource"`** | 本轮补判据：`tests/structure-follow.test.mjs` 第 11 项钉住挂点 + 「没有光标数据整格不渲染」+ 行口径换算 |
| …的**列精度** | `[~]` 本仓已有换算；还差宿主入参 | 同上（上游光标给的是 `OffsetRange`，列是一等公民） | `src/structureFollow.ts:88-90`（`caretCharacterInSymbolBasis`）、`OutlinePanel.vue:74-77`（用 `props.source.character`） | 卡点只有一处：`src/App.vue:215` 的 `todoSource` 只带 `{path,line}`，而 `Tab` 本来就带 `column`（`src/editorTab.ts:8`，`App.vue:2123` 的 `@cursor` 一直在更新它）⇒ 一行的接线请求（§7 W1）。缺它时行为不退化：按 0 基行首处理，命中仍按行 |
| `Show Inherited Members` | `[ ]` 具体理由（14b 结论复核成立） | `platform/structure-view-impl/src/com/intellij/ide/util/InheritedMembersNodeProvider.java`（实测存在，本轮补坐标） | —— | LSP `documentSymbol` 不出继承成员；本仓要合成只能按类型做 `typeDefinition` 再逐父类取符号，且拿不到「谁覆盖了谁」⇒ 做出来是猜的树 |
| Ctrl+F12 文件结构弹层 | `[x]`（早前轮次） | `platform/structure-view-impl/src/com/intellij/ide/util/FileStructurePopup.java`、`platform/structure-view-impl/src/com/intellij/ide/actions/ViewStructureAction.java` | `src/lspNavigation.ts:398`（`openSymbol('file')`）、`src/keymapBindings.ts:102`（`symbol.file` = Ctrl F12） | 本轮未改；弹层的工具条（Files / Show QNames / Group / Flat）在 `lspNavigation` 那一侧，不在我名下，未动 |

### 族 `pv/command`（77 类）

| 项 | 判定 | 上游依据 | 本仓落点 | 说明 |
|---|---|---|---|---|
| 跨文件全局撤销栈 / 命令合并 / 栈深 / 不可撤登记 | `[x]`（14a，本轮复核） | `platform/platform-impl/src/com/intellij/openapi/command/impl/CommandMerger.java:31-33,56-69,77,97-101`、`UndoableGroup.java:264`、`UndoManagerImpl.java:128-134,354-372` | `src/pvCommandProcessor.ts:134-171,296-331,340-382` | 判据 `tests/pv-command-processor.test.mjs`（本轮全绿） |
| `FileUndoProvider` 的 copy / move 步骤 | `[x]`（14a） | `platform/lvcs-impl/src/com/intellij/openapi/command/impl/FileUndoProvider.java:102-111`（after 里 create/move/rename/copy/delete 五类事件）、`:206`（`MyUndoableAction extends GlobalUndoableAction`） | `src/pvFileUndoProvider.ts:157-180`、`src/explorerActions.ts:105-117` | 判据 `tests/pv-command-wiring.test.mjs` 第 1 项 |
| **撤销/重做成功后树要重看磁盘** | `[x]` **本轮修复** | `platform/platform-api/src/com/intellij/ui/treeStructure/ProjectViewUpdateCause.kt:48-52`（VFS / VFS_CREATE / VFS_COPY / VFS_MOVE / VFS_DELETE 各自是一次窗格重建成因） | `src/components/FileTree.vue:153-159`（成功分支 `:158` 的 `model.refresh()`） | 原状：树里按 Ctrl+Z 撤掉一次粘贴后，那一行仍留在屏幕上，要按 F5 才消失（宿主菜单那条路已经刷了 `src/explorerActions.ts:150-156`，缺的是树内按键这一半）。判据 `tests/pv-command-wiring.test.mjs` 第 2 项新增一条 |
| create / delete 的可撤步骤 | `[~]` 模型侧已有；**还差落点调用** | `FileUndoProvider.java:102-106`（create/move/rename 登记步骤）、`:133`（`beforeFileDeletion` 抓快照）、`:147`（`fileDeleted`）、`:185`（`registerNonUndoableAction`） | `src/pvFileUndoProvider.ts:134-156`（`deleteStep` / `createStep`，**当前零生产调用方**） | 卡点：新建/删除的落盘在 `src/App.vue:1710`（`file.create`）与 `src/App.vue:1725`（`file.delete`），都是保留文件 ⇒ 整段可照抄的替换代码在 §7 W2。**没有**在本仓留一个只过自己测试的死出口：`createStep/deleteStep` 是既有导出 API 的两个方法（同模块的 `copyStep/moveStep` 已在生产链上），不是新模块 |
| `$Undo` / `$Redo` 的菜单行 | `[~]` 本仓已有两行；**还差名字与全局撤那一条链路** | `platform/platform-impl/resources/idea/PlatformActions.xml:446-448`（EditMenu 最前两行就是 `$Undo`/`$Redo`）、`platform/platform-impl/src/com/intellij/openapi/command/impl/Undo.java:40-43`（名字 = `undo.command` + 命令名，空名回落 `action.undo.description.empty`） | `src/menus/editMenu.ts:30,35`（「撤销/重做」走编辑器文本撤销）、`src/pvFileUndoProvider.ts:206-230`（`commandMenuRows` 出的是命令栈那一套，**零消费方**）、`src/components/FileTree.vue:153-159`（树内按键） | 后果：文件级命令做完后，Edit 菜单里那两行的**文字**不会变成「撤消 粘贴副本」，也点不到全局撤。归属：`src/menus/editMenu.ts` 不在我名下 ⇒ §7 W2' 给出可照抄的两行替换 |
| `StartMarkAction` / `ChangeRange` 的命令标记 | `[-]` 做不到（14a 结论复核成立） | `platform/platform-impl/src/com/intellij/openapi/command/impl/StartMarkAction.java`、`platform/lvcs-impl/src/com/intellij/openapi/command/impl/ChangeRange.java`（本轮实测这两条路径都对） | —— | 管的是单一文档的文本撤销边界，那一层在 CodeMirror 实例内部（`src/components/CodeEditor.vue` 保留文件）；跨文件那层的等价物已经在栈上（`groupId`/`global`） |
| 「撤销历史列表」UI | `[-]` 无法核实（本轮把三条路又走了一遍，仍指不到） | 实测：`platform/platform-impl/src/com/intellij/openapi/command/impl/UndoRedoList.kt:7` 是 `internal class UndoRedoList<T>`（**栈容器**，不是列表 UI）；`UndoManagerImpl.java` 里 `getHistory` 0 命中；`find -name "*HistoryListPopup*"` 0 命中；用户可见面只有单条「撤消{0}/重做{0}」（`Undo.java:40-43` + `ActionsBundle.properties:2522-2524`） | `src/pvCommandProcessor.ts:165-171`（`commandMenuText`） | 逐类表里 `UndoRedoList`/`UndoRedo`/`CmdHistory` 那些行是栈容器与 remote-dev 的 RPC DTO，画不出「一排历史项」这个界面 ⇒ 不画（14a 的「无法核实」成立） |

---

## 2. 改动文件清单（行数前 → 后；`tests/module-size.test.mjs` 的 split 口径与 `wc -l` 差 1，这里统一给 `wc -l`，前值取开工时的磁盘状态）

| 文件 | 前 → 后 | 增/删（`git diff --numstat`） | 这次动了什么 |
|---|---|---|---|
| `src/projectViewBehavior.ts` | 42 → 75 | +33 / −0 | 新增 `SCRATCHES_NODE_ICON` + `visibleSyntheticNodes`（纯规则，含四条上游坐标与「库内容那一格为什么不」的订正说明） |
| `src/projectTreeSort.ts` | 92 → 101 | +9 / −0 | 设置里加 `showScratchesAndConsoles?: boolean`（可选字段 + 缺键补默认） |
| `src/projectTreeState.ts` | 130 → 134 | +5 / −1 | 默认档 true、进 `BOOLEAN_KEYS`（读写两条链一起通） |
| `src/components/FileTree.vue` | 297 → 311 | +17 / −3 | ① 模型 `synthetic` 换成过滤后的那份；② 那条「设置变更 ⇒ 整树重建」的 watch 加这个键；③ 撤销/重做成功后 `model.refresh()` |
| `src/components/ProjectViewSortSettings.vue` | 63 → 79 | +26 / −10 | 新增「显示临时文件和控制台」；组内成员改成上游行序并补两道分隔线；文件头逐条重写（含 §0-3 的留痕） |
| `src/pvFileUndoProvider.ts` | 217 → 230 | +18 / −5 | `commandMenuRows` 加第三个形参 `onSettled`（撤/做完成后回调，宿主用它刷树）+ 函数头把「为什么在本仓接不上」与 W2' 的指针写清；`$Undo`/`$Redo` 两行的 `title`/`keys` 字面**未动**（既有锚点 `tests/pv-command-wiring.test.mjs:43-44` 照旧绿） |
| `tests/pv-command-processor.test.mjs` | 156 → 191 | +35 / −0 | 新增最后一项：行模型（文字带命令名、可用性跟栈顶、`run` 之后回调拿到那次结果） |
| `tests/project-tree-appearance.test.mjs` | 217 → 275 | +64 / −6 | 12 → 14 项：齿轮三格与次序（原「两格」那条扩写，未删任何断言）、显示档与旧存档缺键、FileTree 接线锚点 |
| `tests/project-tree-behavior.test.mjs` | 36 → 57 | +21 / −0 | 新增 `visibleSyntheticNodes` 的 6 条断言（缺设置=显示、只滤 scratches、不改写入参） |
| `tests/pv-command-wiring.test.mjs` | 48 → 53 | +5 / −0 | 新增「撤成功必须刷树」那条锚点 |
| `tests/structure-follow.test.mjs` | 108 → 117 | +9 / −0 | 新增第 11 项：跟随光标的挂点 + 没有数据不渲染 + 行口径换算 |
| `docs/batch-2026-10-06-projecttree.md` | —— | 本文件 | |
| `docs/wiring-requests-2026-10-06-projecttree.md` | —— | 新增（W1/W2/W2'/W3） | |

未动：`App.vue`、`CodeEditor.vue`、`bridge*`、`settingsModel.ts`、`settings_schema`、`welcome*`、`todo*`、`toolWindow*`、`vcs*`、
`ProjectStructurePane.vue` / `ProjectStructureDialog.vue`（本轮判定这两格的在途改动属桶 15，见 `bucket14b.md` §0，不认领也不改）、
`outlineView.ts` / `OutlinePanel.vue` / `editMenu.ts` / `treeActions.ts` / `externalLibraries.ts`（都不在我名下，只读）、
`CMakeLists.txt`、`package.json`、`tsconfig.json`、`native/main.cpp`。
**本轮没有任何 native 改动**（`native/workspace_tree_ops.cpp` 复核过：只有 `remove_tree`/`copy_tree`，与四族的判词没有缺口），因此不跑 ctest。
`git diff` 自查过：上述 9 个文件的 hunk 全是本轮的，没有顺手重排别人的代码（`FileTree.vue` 与 `ProjectViewSortSettings.vue` 的 diff 与 §2 表逐条对应）。

---

## 3. §5 自查命令的前后数字

| 门禁 | 开工前 | 收工后 |
|---|---|---|
| `npx vue-tsc -b --force` | **0 错**（`.tmp-projecttree-tsc-base.txt`，EXIT=0） | 我名下 5 个文件 **0 错**；全仓 1 条 `src/workspaceDiagnostics.ts(168,14) TS2420`（`LspCache.clearCache` 缺失）——**别人在途现场**（该文件不在我名下，本轮第一次 tsc 跑还是 0 错，第二次跑时它刚落盘），与项目视图无关，未动 |
| `node --test tests/pv-*.test.mjs tests/project-tree-*.test.mjs tests/structure-follow.test.mjs` | tests 73 / pass 73 / fail 0 | **tests 78 / pass 78 / fail 0**（净增 5：齿轮 2 + 显示档行为 1 + 跟随挂点 1 + `commandMenuRows` 行模型 1）；再加 `tests/project-view-behavior.test.mjs` 同跑：**85 / 85 / 0**；再加 `tests/outline-view.test.mjs`（结构视图另一半，本轮未改）：**97 / 97 / 0** |
| `node --test tests/module-size.test.mjs` | tests 5 / pass 5 / fail 0 | tests 5 / pass 5 / fail 0（上限未抬、未登记豁免；本轮最大文件 `FileTree.vue` 311 行，远小于 ts/vue 900） |
| `node .tools/find-param-props.mjs` | 0 处 | 0 处 |
| `node .tools/find-ts-in-mjs.mjs` | 干净 | 干净（四个 `.mjs` 改动全是纯 JS） |
| `node .tools/find-missing-ext.mjs` | 干净（1277 个文件） | 干净（同一批 1277 个文件；新增的 `.ts` 值 import 都带扩展名） |
| `node .tools/find-orphan-modules.mjs --gate` | 已登记孤儿 9 / 基线 9 · 新增 0 · 清掉 0 → **绿** | 同样 9 / 9 · 新增 0 · 清掉 0 → **绿**（本轮没有新增模块；`projectViewBehavior.ts` 本就有 `OutlinePanel.vue`/`outlineView.ts` 消费方，现在多了 `FileTree.vue`） |
| `node --test tests/source-citations.test.mjs tests/source-citation-anchors.test.mjs` | tests 11 / pass 9 / **fail 2** | 同样 tests 11 / pass 9 / **fail 2** —— 红的两条都不是本桶：`docs/batch-2026-10-06-completion2.md` 的 `platform/analysis-api/src/com/intellij/codeInsight/SuppressIntentionAction.java`（桶 2 文档）、`docs/batch-2026-10-06-welcome2.md` 的 `platform/structure-view-impl/src/com/intellij/ide/structureView/StructureViewFactoryImpl.java`（桶 welcome 的文档，真实路径中间还有一段 `impl/`）。**本桶 src/ 与本轮两份 docs 的每一条完整路径坐标都过了这条门**（见 §6 第 5 条：我把自己写的假路径行号都去掉了） |
| `npm run test:native` / ctest | 未跑（无 native 改动） | 未跑（同上） |
| `npm test` 全量 | 按规约**不跑**（12 路并行，会把别人的在途红算到我头上） | 同 |

---

## 4. 反向验证（每条新门禁：注入违规 → 变红 → 撤掉 → 复绿）

备份用 `cp` 到 `build/rv-projecttree/`（`build/` 已 gitignore），还原同样用 `cp`；**没有**用任何 `git checkout/reset/stash/clean`；收工已 `rm` 掉临时目录。

| # | 注入（就是「假把这一格做出来」的写法） | 期望红的判据 | 实测 |
|---|---|---|---|
| 1 | `FileTree.vue` 的 `visibleSyntheticNodes(...)` 退回 `props.synthetic ?? []`（齿轮按了不生效） | 「这一格真的落到树里…」 | ✖ 红 |
| 2 | `projectTreeState.ts` 默认档 `true` → `false`（与上游 `ViewSettings.java:54-56` 相反） | 「显示临时文件和控制台：默认开…」 | ✖ 红 |
| 3 | `projectViewBehavior.ts` 的开关判定改成恒显示（`if (true) return [...nodes]`） | 「合成根的显示档…」 | ✖ 红 |
| 4 | `ProjectViewSortSettings.vue` 的点击写成 `{ showScratchesAndConsoles: showScratches }`（翻不动） | 「齿轮里的三格…」 | ✖ 红 |
| 5 | 删掉 `FileTree.vue` 成功分支的 `else if (result.ok) void model.refresh()` | 「项目视图上 Ctrl+Z / Ctrl+Shift+Z…」 | ✖ 红 |

- 注入后一次跑三个测试文件：**tests 21 / pass 16 / fail 5**（五条各红一次，没有互相遮蔽）。
- 撤掉后：**tests 84 / pass 84 / fail 0**；`git diff --numstat` 回到 §2 表那一组数字（17/3、26/10、9/0、5/1、33/0、64/6、21/0、5/0、9/0），四个被注入文件与注入前逐字节相同。
- 另：`tests/module-size.test.mjs` 本轮没抬上限，不需要反证；齿轮那条门禁扩写时**没有删旧断言**（原来 8 条 `assert` 全留着，只加了 4 条 + 组内次序）。

---

## 5. 零消费方自查结论

- `node .tools/find-orphan-modules.mjs --gate`：**新增 0**（本轮没建新文件到 `src/`），已登记 9 / 基线 9，门禁绿。
- 本轮唯一新增的导出 `visibleSyntheticNodes` / `SCRATCHES_NODE_ICON`：生产消费方 `src/components/FileTree.vue:10,45`（`grep` 实测），不是只过自己测试的死代码。
- 复核出的**两处符号级零消费方**（都不新建模块，故 orphan 门禁看不见，如实登记）：
  1. `src/pvFileUndoProvider.ts:149` `createStep` / `:134` `deleteStep`（同一模块的 `:206` 是 `commandMenuRows`） —— 生产链上只有 `copyStep`/`moveStep`（`src/explorerActions.ts:109,116`）。落点在保留文件 `App.vue:1710/1725` ⇒ §7 W2。
  2. `src/pvFileUndoProvider.ts:206` `commandMenuRows` —— 全仓零引用。落点是别人的 `src/menus/editMenu.ts` ⇒ §7 W2'。
  两条都不是本轮造的，且都在模块头/本表写清了「为什么接不上」，符合规约第 5 条「接不上就写清为什么」。

---

## 6. 做不到 / 无法核实

1. **「显示被排除的文件」**（`ProjectView.ShowExcludedFiles`）：卡在宿主列举 —— `native/workspace.cpp:479` 的 `ignored_directory` 在列举阶段就 `continue`，`Workspace::open`（同文件 `:699-724`）持有 `excluded_`。要做得改宿主列举 + `Entry` 载荷（`src/bridge.ts` 是保留文件、`native/workspace.cpp` 不在我名下）⇒ §7 W3。**不是**「上游有 PSI 所以做不了」：数据就在磁盘上，只是没送上来。
2. **新建/删除的可撤**：模型侧齐了（`pvFileUndoProvider.ts` 的 `createStep`/`deleteStep` 带快照与冲突自检），缺的只是那两个调用点，都在 `src/App.vue`（保留文件，`appvue` 名下）⇒ §7 W2。
3. **Edit 菜单两行接命令栈**：`src/menus/editMenu.ts` 不在我名下 ⇒ §7 W2'。
4. **结构视图跟随光标的列精度**：`src/App.vue:215` 少传 `character`（`Tab.column` 一直有值）⇒ §7 W1。
5. **包视图 / 模块分组 / 多窗格呈现 / Detach 库 / 就地注释 / 树内类成员与可见性图标**：逐条卡点见 §1 表（`Entry` 载荷没有源根与包语义；没有模块模型与写回通道；没有 EP 宿主；行渲染契约不容纳就地编辑）。
6. **`Show Inherited Members`**：LSP `documentSymbol` 不出继承成员，`InheritedMembersNodeProvider` 那套依赖 PSI（本轮补了它的实测路径）。
7. **无法核实**：上游「撤销历史列表」的可见 UI（§1 pv/command 最后一行，三条路各走过：文件名 / 包路径 / 语义 + XML 里的 `action id`）。
8. **无法核实**：`src/projectTreeSort.ts:23-25` 注释里那条 `platform/util/base/.../NaturalComparator.java:39-130` 是**省略写法**（门禁明说不核省略的），本轮没有把它当完整坐标，也没有据此下结论。
9. **全仓门禁的两条红**不在本桶名下（§3 表最后一行点了文件名），本桶不代改别人的文档。

---

## 7. 需要主代理接的线

全部写在 `docs/wiring-requests-2026-10-06-projecttree.md`：W1（`App.vue:215` 补 `character`，1 行）、
W2（`App.vue` 的 `applyNameDialog` / `confirmDelete` 登记可撤步骤，含整段可照抄代码）、
W2'（`src/menus/editMenu.ts:30,35` 两行接 `commandMenuRows`）、W3（宿主列举带出排除项 + `Entry` 的排除标记，native/bridge 都要动）。
本文件不重复贴代码。
