# 批次 2026-10-06 · lane **pvclose** —— 项目视图四族判词与磁盘实况逐条对齐 + 落一条用户可见缺项

任务来源：`pvtree4` 撞 150 轮上限未报告 → `pvtree5` 被派去审计 C5 是否半截。
本 lane 第一步就是判 `pvtree5` 到底交没交，**不重做功能**；然后四族判词逐条对磁盘 + 对上游，
最后挑**一条**今天能落模块侧、用户可见的缺项实现。

## 0. 接手实况与归属

### 0.1 第一步就判完了：`pvtree5` **交了**，`pvtree4` 没交

| 事实 | 实测证据 |
| --- | --- |
| `pvtree5` 交了报告 | `docs/batch-2026-10-06-pvtree5.md` **在盘上**，28,275 字节，mtime `10-06 14:21`；配套 `docs/wiring-requests-2026-10-06-pvtree5.md` 也在盘上（9,114 字节，`14:20`） |
| `pvtree4` 没交报告 | `ls docs/batch-2026-10-06-pvtree4.md` ⇒ `No such file or directory`；`ls docs/batch-2026-10-06-pvtree*.md` 通配只回 `pvtree5` 一份 |
| 任务书里那句「31/31 但没报告」 | 说的是 `pvtree4`，**不是** `pvtree5`；`pvtree5` 的 §1 自己也这么写（第 23-29 行） |
| C5 是不是半截 | `pvtree5` §1/§3 的结论是「接手时半截、本批补完了」。本批**独立复开磁盘**确认补完是真的：存储层 `src/structureFollow.ts:188-211`（`COLLAPSED_MEMORY_LIMIT:188`、`collapsedByPath:189`、`rememberCollapsed:192`、`restoredCollapsed:203`、`collapsedMemoryPaths:211`；**本批在 `:175-186` 插了一段注释 ⇒ 比 `pvtree5` 报的 `:175/176/179/190/198` 整体下移 13 行**）+ 消费方 `src/components/OutlinePanel.vue:50-56`（`:50` 装载取回、`:51` `onBeforeUnmount` 卸载存回、`:52-56` 换文件那一对）⇒ **不是半截** |

**结论：不重做功能。** 本批没有碰 `pvtree4`/`pvtree5` 落地的任何一条行为。

### 0.2 那三个测试的实况（本批第一条命令就是复跑）

`node --test tests/structure-follow.test.mjs tests/outline-view.test.mjs tests/project-tree-model.test.mjs`
⇒ 实测 **`tests 38 / pass 38 / fail 0`**，EXIT=0。

其中一条**任务书里的文件名是错的**（`pvtree5` §1 也抓到同一条，本批独立复现）：
`tests/project-tree-model.test.mjs` **在盘上不存在**（`ls` 实测 `No such file or directory`），
且 `node --test` 多路径时静默忽略不存在的那一个 ⇒ 38 这个数是 `structure-follow` 18 + `outline-view` 20 两文件的和，
「31」是 `pvtree5` 补 C5 判据**之前**的旧数（11 + 20）。真正的 projectTree 族判据文件是
`project-tree-{appearance,behavior,decorations,nesting}.test.mjs`（`ls tests/project-tree*.test.mjs` 实测四个）。

### 0.3 本批接手时的门禁基线（改任何一行之前跑的）

`node --test tests/project-tree*.test.mjs tests/pv-*.test.mjs tests/structure*.test.mjs tests/outline*.test.mjs tests/module-size.test.mjs`
（glob 先 `ls` 核实 = 13 个文件：`project-tree-{appearance,behavior,decorations,nesting}` 4 +
`pv-{command-processor,command-wiring,file-undo,history-session,mark-roots}` 5 + `structure-follow` 1 +
`outline-{caret-source,view}` 2 + `module-size` 1）
⇒ **`tests 126 / pass 126 / fail 0`**，EXIT=0。与 `pvtree5` §8 报的 121 自洽（它那次没把 `module-size` 的 5 条并进去）。

### 0.4 mtime 自查（名下文件 + 任务书点名的两条别路）

`ls -la --time-style` 实测：`src/components/ToolStripe.vue` **15:22**、`src/todoTree.ts` **15:38** —— 都在 `pvtree5`
收工（14:21）之后被别的路写过 ⇒ **本批一个字没碰这两个文件**（它们本来也不在本批名下）。
本批名下与本次要动的文件接手时 mtime：`OutlinePanel.vue` 14:05、`outlineView.ts` 14:01、
`structureFollow.ts` 14:07、`projectTreeModel.ts` 13:58、`FileTree.vue` 13:32、
`projectTreeNesting.ts` 11:04、`projectTreeState.ts` 11:04、`pvCommandProcessor.ts` 10-05 23:35、
`pvMarkRoots.ts` 10-06 00:12、`pvFileUndoProvider.ts` 09:35、`projectTreeCompactDirs.ts` 10-06 00:11、
`ProjectViewSortSettings.vue` 09:25、`projectTreeDecorations.ts` 10-05 00:14、`projectTreeNestingDialog.ts` 10-05 16:39、
`projectTreeSort.ts` 09:16、`projectTreeAppearance`（判据）—— **14:07 之后本批名下没有任何文件被别的路写过** ⇒ 无并发抢占。

### 0.5 归属（本批只算本批的账）

- `pvtree4`：`src/outlineView.ts` 权重表 / `orderFileStructurePopup` / `symbolPresentableName`（+146/-10）、
  `src/structureFollow.ts` 的 C5 存储层（+46）、`src/projectTreeModel.ts` 的 `collapseAll` 留开、
  `tests/outline-view.test.mjs`（+147）、`tests/project-tree-appearance.test.mjs` 的 2 条。
- `pvtree5`：`OutlinePanel.vue` 的 store/restore 接线（+28/-11 里本批之外的那部分）、C5 的 7 条判据（+115/-2）、
  `outline-caret-source.test.mjs` 修红（+4/-1）、5 处坐标订正、`pvtree5.md` + 接线请求。
- **本批（`pvclose`）**：§1 的四族判词逐条核对（含 `pvtree5` 没查的 `pv/command` 整行 + 三条它没登记的缺口）、
  §2 的结构视图**行图标**（用户可见缺项，一条）、§3 判据、§4 反向验证、§5 门禁、§6 无法核实（zh 包那条系统性发现）、
  §7 接线请求、§8 账本订正请求。**没有一条是重做 `pvtree4`/`pvtree5` 已落的功能。**


## 1. 四族判词核对表

**判词出处只有三份**：`docs/inventory/verdict-projectviews.md`（族行 `:28` `pv/project-view-nodes`、
`:30` `pv/structure-view`、`:33` `pv/command`、`:36` `pv/project-view`）、
`docs/inventory/projectviews_verdict_table.json`（逐上游文件行，`tier` + `presence`）、
`docs/inventory/verdict-platform_rest.md:235`（`ls/navigation`，`LspStructureViewSupport` 那条）。
`presence` 的语义本批复开了 `scripts/verdict_table.py:983`：**它是"英文类名在本仓搜得到吗"** ——
`从未出现` = 类名零命中。这一条就是任务书说的第二类错的机械来源。
本域 `x` 档 **0 条**（实测 `d['counts'] = {total:755, x:0, ~:574, blank:0, -:181}`）⇒ 核对表里没有 `[x]` 可查，
只有 `[~]`/`[-]`；三个族的逐文件行是 `pv/project-view` 41（37 条 `从未出现`）、
`pv/project-view-nodes` 122（111 条）、`pv/structure-view` 94（91 条）。

错型记号：**①说过**＝判词说已闭环但出口不存在／不存在的东西被算进「本仓已有」；
**②判漏**＝按英文类名搜不到就判「未做」，其实早做了；**③未登记**＝缺口真实存在但三份判词谁都没写。

### 1.0 行号漂移说明（本批自己造的，先讲清楚免得后人误判）

本批在 `src/outlineView.ts` 加了 `:6`/`:8` 两行 import（**其后所有符号 +2**），又在 `symbolPresentableName`
之后插了 `:155-189` 那一段（**再其后 +35，即累计 +37**）；在 `src/components/OutlinePanel.vue` 的 `:76-80`
插了一段注释 + `displayRows`（**其后 +7**）；在 `src/structureFollow.ts` 的 C5 那节前插了 `:175-186` 注释
（**其后 +13**）。下面表格里凡是引这三个文件的行号**都是按改后磁盘重开过的**：
`OutlinePanel.vue` 改后实测 `selectRow:84-89`、`revealSource:90-92`、跟随 watch `:98-110`、`KIND:123-128`、
`label:129`、可见性按钮 `:139`、到源码按钮 `:140`、从源码按钮 `:145`、过滤框 `:148`、行块 `:154-173`、图标 `:168`。
`outlineView.ts` 改后实测 `outlineKey:60`、`KIND_WEIGHT:85`、`symbolKindRank:94`、`compareAlphaKeysIgnoreCase:117`、
`symbolPresentableName:152`、**`symbolRowIcon:187-189`**、`treeOf:199`、`arrange:211`、`orderFileStructurePopup:275`、
`caretSymbolInTree:300`。`structureFollow.ts` 改后实测 `ACCESS_LEVEL:36`、`visibilityAccessLevel:50`、
`packageLocalMarked:62`、`shouldRevealInEditor:155`（这四条在插入点之前，**没变**）、
`COLLAPSED_MEMORY_LIMIT:188`、`collapsedByPath:189`、`rememberCollapsed:192`、`restoredCollapsed:203`、
`collapsedMemoryPaths:211`。


### 1.1 `pvtree5` §6 那 9 条：本批独立复核（不复用它的结论，逐条重开磁盘与上游）

| # | 判词出处 | 本批复开的磁盘出口（实测行号） | 本批复开的上游（实测行号） | 复核结论 |
| --- | --- | --- | --- | --- |
| 1 | `verdict-projectviews.md:30` 缺 autoscroll to/from source | `src/components/OutlinePanel.vue:32-33`（两个默认值与上游一致）、`:140`（到源码）、`:145`（从源码，`v-if="source"` 不放假控件）、`:84-92` 与 `:98-110`（两条判定路径）；判定函数 `src/structureFollow.ts:155-157` | `platform/structure-view-impl/src/com/intellij/ide/structureView/impl/StructureViewFactoryImpl.java:49-50`、`…/newStructureView/StructureViewComponent.java:794-802` | **②判漏成立**，`pvtree5` 的订正方向对 |
| 2 | 同上，「本仓只有名称与种类两档」 | `src/structureFollow.ts:36-59`（四档 + unknown，短路次序 private→包级→protected→public）、`:61-66`；`src/components/OutlinePanel.vue:28`、`:139`；`src/outlineView.ts:211`（`arrange` 体内那三趟稳定排序） | `java/java-structure-view/src/com/intellij/ide/structureView/impl/java/VisibilitySorter.java`、`VisibilityComparator.java:16`/`:23-29`、`java/java-psi-api/src/com/intellij/psi/util/PsiUtil.java:223-226`/`:623-634` | **②半条成立**：可见性档已在；「`Sorter` **扩展点宿主**」那半句仍缺 ⇒ 只订正前半 |
| 3 | 折叠态沿用（C5） | `src/structureFollow.ts:188/189/192/203/211`（本批插入 §2.2 那段注释后整体下移 13 行；`pvtree5` 报的是 `:175/176/179/190/198`）+ `src/components/OutlinePanel.vue:50/51/52-56`；判据 `tests/structure-follow.test.mjs` 那 7 条本批复跑绿 | `…/newStructureView/StructureViewComponent.java:397-407`/`:414-428` | **已闭环**（`pvtree5` 落的，非本批） |
| 4 | 同上，缺 `Show Inherited Members` | `grep -rn "继承\|Inherited" src/outlineView.ts src/components/OutlinePanel.vue src/structureFollow.ts` ⇒ **0 命中** | LSP `documentSymbol` 不区分继承成员（`native/lsp_support.cpp` 原样透传） | **缺口仍成立**，不动判词 |
| 5 | `:36` 缺 `MarkRootGroup`/`MarkAsContentRootAction`（「项目树右键没有 Mark Directory As」） | **本批补了 `pvtree5` 没查的一层**：不只模块在，而是**真进了右键菜单** —— `src/treeActions.ts:16` import + `:153` 那组 + `src/App.vue:1398`（`markRootMenu, applyMarkRoot`）+ `src/App.vue:2506-2508`（组标题、二级项、点击派发）。`src/pvMarkRoots.ts` 头部 `:1-2` 自证是冲这条判词建的 | `platform/lang-impl/src/com/intellij/ide/projectView/actions/MarkRootGroup.java`（**本批未逐行复开**，与 `pvtree5` 同一保留） | **②判漏成立**，且出口是用户可见的（不是死模块） |
| 6 | `:28` 缺可编辑的嵌套规则 | `src/components/FileNestingSettings.vue` → 宿主 `src/components/ProjectViewSortSettings.vue:34`（import）+ `:67-74`（渲染）→ 而**这一层**挂在 `src/components/ToolWindowView.vue:17` + `:251` ⇒ 齿轮里真点得动 | 未复开（只判「有没有实现」） | **②判漏成立** |
| 7 | `:36` 全部展开/折叠 | `src/projectTreeModel.ts:251-263`（`collapseAll` 留开那一格）+ 判据 `tests/project-tree-appearance.test.mjs` | `AbstractProjectViewPane.java:803-806`（非 strict 覆写）、`TreeUtil.java:911`（第 0 行豁免） | **已闭环** + `pvtree5` 的证据链订正本批复读成立 |
| 8 | `verdict-platform_rest.md:235` 第⑤条缺视图选项 | `src/outlineView.ts:85-106`（`KIND_WEIGHT` 原值 + `symbolKindRank`）、`:117`（码元折叠）、`:152`（`symbolPresentableName`）、`:275`（弹层档）；面板 `OutlinePanel.vue:23-28`、`:136-140`、`:164` | `java/…/KindSorter.java:17-57`、`smartTree/Sorter.java:35-42` | **已闭环**，但**同一句话的另一半是本批新抓的 ①**，见 §1.2 第 3 行 |
| 9 | `verdict-platform_rest.md:70`/`:49` 弹层默认档 | `src/outlineView.ts:275`（`orderFileStructurePopup`）+ 判据 `tests/outline-view.test.mjs:238`、`:265` | `platform/structure-view-impl/src/com/intellij/ide/util/FileStructurePopup.java`、`JavaFileTreeModel.java:66-72` | **已闭环** |

⇒ `pvtree5` 的 9 条**没有一条是编造**，本批也不重复登记；下面只写它没查的。

### 1.2 本批新增（`pvtree5` §6 的九行之外）

| # | 判词出处与原文 | 本批复开的实况 | 错型 | 动作 |
| --- | --- | --- | --- | --- |
| 1 | `verdict-projectviews.md:33`（`pv/command`）：「`src/editorCommands.ts` 只登记编辑命令，**没有应用级命令栈**」＋缺 `UndoProvider`/`FileUndoProvider`、`CommandMerger`、`CannotUndoReportDialog` | **三个都在盘上且都被生产代码消费**：`src/pvCommandProcessor.ts` 头 `:1-30` 逐条对上 `CommandMerger.canMergeGroup:31-33`/`shouldFlush:71-102`/`isUndoAvailable:56-69`、`UndoableGroup.doUndoOrRedo:264`、`UndoManagerImpl` 的 `:54-60` 两个栈深与 `:128-134` 的 nonundoable，导出 `GLOBAL_UNDO_LIMIT:43`、`DOCUMENT_UNDO_LIMIT:44`、`FlushReason:50`、`getCommandProcessor:387`、`commandMenuText:166`；`src/pvFileUndoProvider.ts:1-12` 对上 `FileUndoProvider.java` 的 `:100-114`/`:116-124`/`:185-187`/`:206-236`。**消费方**：`src/explorerActions.ts:11-12`（`getCommandProcessor` + `createFileUndoProvider`/`recordFileCommand`）与 `src/components/FileTree.vue:11-12`。判据 `tests/pv-{command-processor,command-wiring,file-undo}.test.mjs`（本批跑绿） | **②判漏**（本项目第 7 例） | §8 订正请求 C-1：整行改写 |
| 2 | `verdict-projectviews.md:28`：「缺：包视图（`PackageViewPaneModel`/`ClassesTreeStructureProvider` 的 **flatten/compact middle packages 呈现**，需 PSI/Java 模型）」 | 「把只有一个子目录的目录并进去、显示成 `a/b/c`」这一条**已经做了并挂上**：`src/projectTreeCompactDirs.ts`（`singleDirectoryChild:54`、`compactName:61`、`compactChainOf:70`、`compactListing:87`、`MAX_COMPACT_CHAIN:35`）→ `src/projectTreeModel.ts:5` import、`:20` 选项、`:56` 开关；面板 `src/components/FileTree.vue:51`；设置项 `src/components/ProjectViewSortSettings.vue:53`；持久化 `src/projectTreeSort.ts:19`。**上游坐标本批逐行复开，与模块头部所引一致**：`platform/lang-impl/src/com/intellij/ide/scopeView/ScopeViewTreeModel.java:595-608`（`getSingleDirectory` 循环）、`:657-661`（`children.size() != 1 ⇒ null` 且必须是目录）、`:789-792`（`isPackage(getIcon()) ? '.' : VfsUtilCore.VFS_SEPARATOR_CHAR` 拼接）。**仍缺的是 PSI 包那两档**：`FlattenPackages`/`AbbreviatePackageNames`/`HideEmptyMiddlePackages`（`ProjectViewSortSettings.vue:19-22` 已按能力位判不可画，本批复核该理由站得住 —— 见下一行） | **②判漏（半条）** | §8 C-2：把「缺包视图」限定为 **PSI 包三档**，文件系统目录的 compact 已闭环 |
| 3 | `verdict-platform_rest.md:235`：「`src/outlineView.ts`（documentSymbol 树 = **`LspStructureViewSupport`**/`documentSymbol/converters.kt`）」—— 把整个 `LspStructureViewSupport` 算作已有等价物 | 那个类**有三个成员**，本批逐个开上游：`platform/lsp-impl/src/impl/features/documentSymbol/LspStructureViewSupport.kt:19` `getDocumentSymbols`、**`:21` `getIcon(symbol)`**、`:24-26` `navigate`。前两支和第三支本仓有（符号树 = `outlineView.ts`，跳转 = `OutlinePanel.vue:90-92` 的 `revealSource` → `lspNavigation`），**`getIcon` 这一支在盘上零出口**：`src/components/OutlinePanel.vue:147-163` 那一行的构成是「折叠箭头 `:150-156` + 文字种类 `:159` + 路径尾 `:160` + 位置 `:161`」，**没有行图标**；`:116-121` 那张 `KIND` 表是**中文文字**标签，不是图标。族行 `verdict-projectviews.md:30` 也没把「行图标」列进缺（它只列了三条缺）⇒ 缺口真实存在但**没登记** | **①说过 + ③未登记** | 本批落地（§2），并出 §8 C-3 |
| 4 | `verdict-projectviews.md:28` 缺「模块分组（`ModuleGroup`/`MoveModuleToGroup`/`ModuleListNode`）」＋ `ProjectViewSortSettings.vue:19-22` 把 `ShowModules`/`FlattenModules` 判为「要 PSI／模块模型」 | 理由**站得住**，不是懒判：`src/components/ProjectStructurePane.vue:40` 明写 `TaoCode has one implicit module`，`:137` 的 `moduleName` 就是项目名 —— 本仓**恒只有一个隐式模块**，多模块分组没有可分组的对象；`ProjectStructurePane.vue:413/:506` 那两块 `shows('modules')` 是同一模块的根模型编辑面。⇒ 判词仍 `[~]` 正确 | 无（复核通过） | 不动判词 |
| 5 | `verdict-projectviews.md:28` 缺「Detach/Attach 库（`DetachLibraryDeleteProvider`）」、`:36` 缺「多窗格（`SplitProjectViewUtil`）」「`CustomizeTreesAction`」「`ProjectViewPreloadMode`/`ProjectViewPerformanceMonitor`」 | 逐条 `grep -rn "detachLibrar\|attachLibrar\|DetachLibrary\|Attach to Pane\|附加到窗格\|splitProjectView\|PreloadMode\|PerformanceMonitor\|InplaceComment" src` ⇒ **只命中 `ProjectViewSortSettings.vue:20` 那一行注释**（它是在**登记**这些缺，不是实现）⇒ 四条缺口全部仍成立 | 无（复核通过） | 不动判词；上游文件本批确认存在：`platform/lang-impl/src/com/intellij/ide/projectView/impl/{SplitProjectViewUtil.kt,ProjectViewPerformanceMonitor.kt,ProjectViewPreloadMode.kt}` |
| 6 | `ProjectViewSortSettings.vue:15-18` 自证「`ShowExcludedFiles` 本仓按不了：被排除的目录在宿主那一层就从列举里剪掉了（`native/workspace.cpp:479`）」 | 复开 `native/workspace.cpp:479`：**`if (is_directory && ignored_directory(name, excluded)) continue;`** —— 函数本体在 `:455`。前端确实拿不到被剪掉的那些行 | 无（复核通过） | 不动；这条的解锁需要宿主（§7 R-2，**已存在**的接线请求，本批只复核不新求） |
| 7 | `pv/structure-view`/`pv/project-view-nodes` 逐文件行里与本批相关的两行：`platform/structure-view-impl/src/com/intellij/ide/structureView/impl/common/PsiTreeElementBase.java`（`tier ~`、`presence 从未出现`）与 `platform/lang-impl/src/com/intellij/ide/projectView/impl/ProjectViewRenderer.kt`（`tier ~`、`从未出现`） | 前者：`PsiTreeElementBase.java:50-58` 的 `getIcon(boolean open)` 给 `ICON_FLAG_READ_STATUS`，非「不可写的文件」时**再或上 `ICON_FLAG_VISIBILITY`**；`platform/util/src/com/intellij/openapi/util/Iconable.java:11-12` 就那两位（`:11 = 0x0001` 可见性、`:12 = 0x0002` 读写状态）。⇒ 结构视图**每行有图标**这一条是真的，本仓缺（见上一行 #3）。后者复开全文 37 行：`ProjectViewRenderer` 干的是**画的时候掐掉灰显/行内注释那一段文本**（`:18-33`，配 `:36-37` 那句 `isGrayedTextPaintingEnabled`「dirty hack」），**不是**图标来源 —— 本仓 `FileTree.vue:286-296` 的图标族与它无关，判词 `:28` 把「节点图标」记在 `FileTree.vue` 名下是**对的** | 前者 **③未登记**（本批补）、后者无 | 见 §2 与 §8 C-3 |

### 1.3 顺手抓到的一条系统性问题（不属四族，但影响四族措辞）

多个模块（含本批名下 `src/pvCommandProcessor.ts:19-21`、`src/projectTreeCompactDirs.ts:11-12`）把中文措辞记在
`plugins/localization-zh/lib/localization-zh.jar` 上。**该 jar 在唯一可用的参考树里不存在**：
`ls plugins/localization-zh/lib/localization-zh.jar` ⇒ `No such file or directory`；`ls plugins/ | grep -i local` 只有
`IntelliLang`/`java-i18n`/`ml-local-models`；`find . -iname "*localization*"` 命中的全是 `com/intellij/l10n/**` 源码，没有 zh 包。
本仓 `grep -rl "localization-zh" src tests docs` ⇒ **83 个文件**引它。
按任务的「无 zh 包 ⇒ 中文措辞『无法核实』」，这些中文引文一律降级为**无法核实**（§6 N-1）。
**英文侧本批逐条复开，能钉住的钉住**：`platform/platform-resources-en/src/messages/ActionsBundle.properties:1459-1460`
= `action.ProjectView.CompactDirectories.text/description`（`projectTreeCompactDirs.ts:9-11` 引的行号**分毫不差**）；
`undo.command` 实际在 `platform/platform-api/resources/messages/IdeBundle.properties:1227`（`Undo {0}`），
`cannot.undo.*` 在同文件 `:1231`/`:1232`/`:1237`/`:1238` —— **不是** `pvCommandProcessor.ts:21` 引的 zh `:2731-2734` 那一段
（那一行范围在盘上的 EN 包 `platform/platform-api/resources/messages/IdeBundle.properties:2731-2734` 是 JCEF 通知文案，与撤销无关）。
`Undo.java` 实存在：`platform/platform-impl/src/com/intellij/openapi/command/impl/Undo.java`。
⇒ 见 §8 C-4：`pv/command` 订正时把 bundle 坐标改成**这份树里逐行复开的 EN 路径 + 行号**，中文措辞标「无法核实」。


## 2. 落盘

### 2.1 本批选的那一条用户可见缺项：**结构视图的行首种类图标**

选它的理由（对着 §1.2 第 3 行）：它是**四族判词谁都没登记**的真实缺口（①说过 + ③未登记），
落在本批名下两个文件里（`src/outlineView.ts` + `src/components/OutlinePanel.vue`），
**不需要宿主/桥层新数据**（`src/bridge.ts` 0 贴顶、`src/App.vue` 30 行封顶都碰不得），
也不需要新持久化键 ⇒ 今天就能落、落完用户看得见。

**上游依据（本批逐行复开，参考树 = `D:\Backup\Downloads\intellij-community-master\intellij-community-master`）**：

| 事实 | 上游坐标（实测） |
| --- | --- |
| LSP 结构视图**每行**有图标，且图标只按 `SymbolKind` 取 | `platform/lsp-impl/src/impl/features/documentSymbol/LspStructureViewSupport.kt:21` `fun getIcon(symbol: DocumentSymbol): Icon? = lspClient.descriptor.lspCustomization.symbolKindCustomizer.getIcon(symbol.kind)` |
| 层级视图用的是**同一条**函数（不是各配一张表） | `platform/lsp-impl/src/impl/features/hierarchy/LspHierarchyNodeDescriptor.kt:48` `return client.descriptor.lspCustomization.symbolKindCustomizer.getIcon(kind)` |
| 那个类一共只有三个成员（本仓缺中间那一个） | `LspStructureViewSupport.kt:19` `getDocumentSymbols`、`:21` `getIcon`、`:24-26` `navigate` |
| PSI 侧的结构视图行图标同样是一等公民 | `platform/structure-view-impl/src/com/intellij/ide/structureView/impl/common/PsiTreeElementBase.java:50-58`（`getIcon(boolean open)`；非「不可写的文件」时或上 `ICON_FLAG_VISIBILITY`） |
| 图标有两个维度：可见性 / 读写状态 | `platform/util/src/com/intellij/openapi/util/Iconable.java:11`（`ICON_FLAG_VISIBILITY = 0x0001`）、`:12`（`ICON_FLAG_READ_STATUS = 0x0002`） |
| 上游侧 `symbolKindCustomizer` 的第三家（面包屑） | `platform/lsp-impl/src/impl/features/documentSymbol/LspFileBreadcrumbsCollector.kt:39,41` —— 本仓面包屑在 `src/breadcrumbs.ts`，不在本批边界 |

**改了哪三处**（`git diff` 实测，只列本批这一段）：

| 文件 | 落点（**改后磁盘实测行号**） | 内容 |
| --- | --- | --- |
| `src/outlineView.ts` | `:6` 新增 `import type { Component } from 'vue'`、`:8` 新增 `import { hierarchyKindIcon } from './hierarchyRenderer.ts'`；`:156-186` 新增那段「上游三成员 + 为什么不写第二张表 + 不等价处」注释；**`:187-189` 就是 `symbolRowIcon` 本体**（函数体一行） | 模块侧给 `LspStructureViewSupport.kt:21` 那一条**命名出口**，函数体只做转发 |
| `src/components/OutlinePanel.vue` | `:5` import 加 `symbolRowIcon`；`:76-80` 新增注释 + `displayRows`（把 `arrange` 那份行贴一个 `icon`，**不改 `rows` 本身**）；模板 `:154` 的 `v-for` 换成 `displayRows`、`:168` 画 `<component v-if="entry.icon" …>`；样式 `:198-200` 一条 `.outline-icon` | 行首画图标；认不到的 kind **不占图标位**（`v-if`，SSR 里实测是 `<!--v-if-->`） |
| `tests/outline-view.test.mjs` | `291 → 368` 行（**+77**），5 条新判据分别起于 `:298`、`:314`、`:320`、`:344`、`:360` | 见 §3 |
| `src/structureFollow.ts` | `:175-186` 纯注释插入（**一个字节行为没改**），把 §2.2 那份「为什么不复用」的账写代码边上 | 任务点 4 的落档 |

**用户可见的效果**：开着结构工具窗口时，每一行最前面按种类出现一枚图形
（类 = `Square`、方法/构造器/函数 = `FunctionSquare`、字段/变量/属性 = `Variable`、常量 = `Hash`、
接口 = `SquareDashed`、枚举 = `Boxes`、结构体 = `Box`、类型参数 = `Type`），
文件/命名空间等表里没有的种类**不画**，行序、计数、文字种类、折叠、跟随全都不变（§3 各钉一条）。

### 2.2 任务点 4 的账：行 id / 展开态沿用**复用哪份、为什么不能复用**

本批名下与「行 id / 展开态」有关的现成两份是
`src/usageViewTreeModel.ts`（refview3，433 行；`usageTreeRowIds:210-217`、`carryUsageTreeExpansion:275-315`、
`usageTreeLevelCounts:346`）与 `src/hierarchyRows.ts`（hierlevel；`hierarchyItemKey:60`、`hierarchyRowIds:84`、
`captureHierarchyExpansion:123-135`、`planHierarchyExpansion:152`），两份都在并发黑名单里 ⇒ 本批**只读**。

- **本批这条（行图标）根本不需要行 id / 展开态** ⇒ 不涉及第三份，也没有并车需求。
- 但本批**查出一件该写下来的事**：`pvtree5` 落的 C5（`src/structureFollow.ts:188-211` 的
  `COLLAPSED_MEMORY_LIMIT:188`/`collapsedByPath:189`/`rememberCollapsed:192`/`restoredCollapsed:203`/`collapsedMemoryPaths:211`）
  已经是「展开态沿用」的**第三个实例**，而它落档时**没写**与前两份的关系。本批把这段账
  **补进 `src/structureFollow.ts:175-186`（纯注释，不改一个字节的行为）**：
  前两份做的是**同一棵树重建前后**按行 id / 按路径对账（`carryUsageTreeExpansion` 入参 `UsageTreeRow` 要
  `kind/path/line/character/count/collapsible`；`captureHierarchyExpansion` 抓的是节点路径数组），
  C5 做的是**跨文件换根**（A 文件 ↔ B 文件，按文件路径分桶 + LRU 上界淘汰），那两个签名都给不出「按 path 分桶」这一维 ⇒
  **不复用是成立的**，不是偷懒。并且 `src/hierarchyRows.ts:15-21` 自己已经替这条规则写过一次同样的论证，
  本批与它同一口径。
- 真正的**去重请求**（若日后抽公共件）写在 §7 R-1，本批不动那两个黑名单文件。

### 2.3 同一批里顺手落的**图标表去重**（这才是本批真正的「不造第三份」）

`SymbolKind → 图标` 这张表本仓**已经有一份**：`src/hierarchyRenderer.ts:51-64` 的 `HIERARCHY_KIND_ICONS`
（12 个 kind）与 `:67-70` 的 `hierarchyKindIcon`（实测 `node -e import` 拿到表长 12）。
本批**转发它**（`symbolRowIcon` 函数体只有一行 `return hierarchyKindIcon(kind)`），
理由就是上游那两条坐标是**同一个函数**（`LspStructureViewSupport.kt:21` ≡ `LspHierarchyNodeDescriptor.kt:48`）。
判据 §3 的第 1 条把「转发」钉成可失败的断言 ⇒ 谁将来在结构侧抄第二张表就会红。

**代价如实写**：`src/outlineView.ts` 现在多了一条对 `src/hierarchyRenderer.ts` 的 import
（跨到并发黑名单里的那一族）。方向是**结构侧读层级侧**，层级侧不依赖本批任何文件 ⇒ 无环；
`hierarchyRenderer.ts` 本身**一个字没改**。先例是同仓的 `src/hierarchyRenderer.ts:42` 反向 import
黑名单里的 `src/usageViewTreeModel.ts`，本仓「共用优先于各写一份」已经这么办了。

### 2.4 新持久化键：**0 个**

本批没有新配置字段（图标是无开关的常驻呈现，对齐上游 `getIcon` 没有开关），
⇒ 无迁移、无补默认。§1.2 第 3 行提到的 `ICON_FLAG_VISIBILITY`（可见性进图标）本批**没做**，见 §6 N-2。


## 3. 判据

新增 5 条，全在 `tests/outline-view.test.mjs`（`:298`、`:314`、`:320`、`:344`、`:360`），文件 291 → 368 行。

| # | 判据名（磁盘原文） | 钉住什么 | 为什么会失败 |
| --- | --- | --- | --- |
| 1 | `行图标是**转发**同一张表，不是本仓的第二份 SymbolKind→图标表` | 对 `HIERARCHY_KIND_ICONS` 的**每一个** kind 断言 `symbolRowIcon(kind) === hierarchyKindIcon(kind)` 且**非 null**；再加两条静态负断言：`outlineView.ts` 里不许出现 `Record< number , Component`、面板里不许出现 `KIND_ICONS` | 结构侧自抄一张表 / 换一套图形 / 把某个 kind 漏掉 ⇒ 身份相等当场红；表长不足 10 档也红（防「转发个空表」） |
| 2 | `未识别的种类没有图标（不占图标位、不画假图标）` | `symbolRowIcon(1)`（File）与 `symbolRowIcon(99)` 都是 `null` | 有人为「表里没有」的种类兜一个默认图形 ⇒ 红（本仓规矩：不画假控件，同 `OutlinePanel.vue:145` 的 `v-if="source"` 那一支） |
| 3 | `真渲：认到的种类行行首画图标，认不到的那一行一个图标都不多画` | 三行（kind 5/6/1）SSR 后 `outline-icon` 元素**恰好 2 个**；带 `outline-icon` 那个元素本身带 `aria-hidden="true"`；`类 · Sample`、`方法 · run` 两句文字仍在 | 图标画在每一行（含认不出的）⇒ 计数 3 红；漏 `aria-hidden` ⇒ 红；用图标替掉文字种类 ⇒ 红 |
| 4 | `真渲：行序一个字没动（图标只贴在最前面，不参与排序）` | `zebra(8)/alpha(6)/Middle(5)` 三行渲染后按 `indexOf` 排出来仍是文档序 | 若图标那一步顺手 `.sort(`／换成另一份 `arrange` ⇒ 红 |
| 5 | `接线：面板走 outlineView 的 symbolRowIcon，没有绕过模块自己取组件` | 面板从 `'../outlineView'` import 了 `symbolRowIcon`；行上的 `icon` 确由 `symbolRowIcon(entry.symbol.kind)` 算；模板真的画 `<component v-if="entry.icon" :is="entry.icon"`；**计数那格仍走 `rows.length`** | 模块被 import 但不调用（死引用，`pvtree5` §1 抓到过的那种）⇒ 第 2、3 条断言红；`displayRows` 顶掉 `rows` 让计数变口径 ⇒ 第 4 条断言红 |

### 3.1 「不许放松断言」这条本批怎么守的（有一条改写，写明理由）

第 3 条里那句 `aria-hidden` 本批**第一版写的是** `/^<svg[^>]*aria-hidden="true"/`，实测红：
`tests/vue-sfc-loader.mjs` 把 `lucide-vue-next` 的组件替成
`<span data-stub="lucide-vue-next.Square" size="15" class="outline-icon" aria-hidden="true">`（SSR 实测原文），
所以标签名不是 `<svg>`。**这不是断言该放松，是钉错了标签名。** 本批**没有改成「删掉这条断言」或「放宽成可选」**，
而是把它改成钉**语义等价且两边都成立**的那一句：先抓「带 `outline-icon` 这个类的那个元素」，
再断言**它自己**带 `aria-hidden="true"`（真机上那是 `<svg>`，测试里那是 `<span data-stub>`，两边都过）。
理由与出处都写在了测试注释里（`tests/outline-view.test.mjs:335-337` 是说明，`:338-340` 是改写后的断言本体：
先 `html.match(/<[a-z]+[^>]*class="[^"]*\boutline-icon\b[^"]*"[^>]*>/)` 抓到那个元素，再断言它带 `aria-hidden="true"`)。
其余四条一次写就、没有回退过。

### 3.2 既有判据一条没动

`tests/outline-view.test.mjs` 原有 20 条、`structure-follow` 18 条、`outline-caret-source` 8 条、
`project-tree-{appearance,behavior,decorations,nesting}`、`pv-*` 全部**逐字未改**（本批只往 `outline-view.test.mjs`
**尾部追加** 77 行：291 → 368，实测 `wc -l`；对 HEAD 的 `git diff --numstat` 是 `224 0`，
那 224 里含 `pvtree4` 未提交的 147 行，0 删除 ⇒ 没有回退任何既有断言）。
`pvtree5` §3 第 4 件修好的 `tests/outline-caret-source.test.mjs:81`（钉意图而非钉逐字 import 成员表）
本批又往那行 import 里加了 `symbolRowIcon` 一个名字 —— 正因为它已改成钉意图，**没有再次撞红**（实测 8/8 绿）。


## 4. 反向验证

注入标记统一前缀 **`PVCLOSE-PROBE-Pn`**（不用裸词 `TEMP`/`RVI`/`INJECT`）。三条都在
`tests/outline-view.test.mjs` 单文件内跑（25 条基数），三条都**当场还原**。

| 注入 | 做法（改的就是要交付的那一行） | 实测结果 | 是哪条断言抓到的 |
| --- | --- | --- | --- |
| **P1** | `OutlinePanel.vue:168` 那一整行 `<component v-if="entry.icon" …>` 换成 `<!-- PVCLOSE-PROBE-P1 故意不画行图标 -->`（= 本批之前的真实状态） | **`tests 25 / pass 23 / fail 2`**：<br>✖ `真渲：认到的种类行行首画图标，认不到的那一行一个图标都不多画`<br>✖ `接线：面板走 outlineView 的 symbolRowIcon，没有绕过模块自己取组件` | 真渲那条的 `icons.length === 2`（实测 0）与 `assert.ok(iconTag)`；接线那条的模板断言 `<component v-if="entry.icon" :is="entry.icon"` |
| **P2** | `outlineView.ts:187-189` 的 `symbolRowIcon` 不再转发，改成**本仓第二张表**：`const pvcloseTable: Record<number, Component> = { 5: … }` + `return pvcloseTable[kind] ?? null` | **`tests 25 / pass 23 / fail 2`**：<br>✖ `行图标是**转发**同一张表，不是本仓的第二份 SymbolKind→图标表`<br>✖ `真渲：认到的种类行行首画图标，认不到的那一行一个图标都不多画` | 转发那条的**逐 kind 身份相等** + 静态负断言 `Record< number , Component`；真渲那条跟着红（只有 Class 那一行拿得出图形，`icons.length` 实测 1 ≠ 2） |
| **P3** | `OutlinePanel.vue:80` 的 `icon: symbolRowIcon(entry.symbol.kind)` 换成 `icon: null`（**模块还在、还被 import，但面板绕过它** —— 就是 `pvtree5` §1 抓 `pvtree4` 那种「只 import 不调用」的形状） | **`tests 25 / pass 23 / fail 2`**：<br>✖ `真渲：认到的种类行行首画图标，认不到的那一行一个图标都不多画`<br>✖ `接线：面板走 outlineView 的 symbolRowIcon，没有绕过模块自己取组件` | 真渲那条计数归 0；接线那条的 `icon: symbolRowIcon\(entry\.symbol\.kind\)` |

**还原与残留扫描（实测）**：

- `sha1sum -c` 三个交付文件全部 **OK**：`src/outlineView.ts` `912b4d4b03a23065b2d7ad4d4497eee0c19f8bec`、
  `src/components/OutlinePanel.vue` `2d72e6911c6d88b0fae9e04988f7d4547de8729c`、
  `tests/outline-view.test.mjs` `f2a34721a4487bc1104c4a7094c336a7883a390d`。
- 残留扫描：`grep -rn "PVCLOSE" src tests` ⇒ **0 命中**（`docs` 里只剩本报告自己的措辞，那是记账不是残留）；
  `grep -rniE "\b(TEMP|RVI|INJECT|TODO-PROBE)\b" src/outlineView.ts src/components/OutlinePanel.vue` ⇒ **0**。
- 还原后复跑：`structure-follow` + `outline-view` ⇒ **`tests 43 / pass 43 / fail 0`**。

**断言强度没有下调过任何一处**（唯一一次改写见 §3.1，改的是钉错标签名，语义等价且两边都成立）。

## 5. 门禁原始数字

**接手时基线**（本批改第一行之前）：13 文件 ⇒ `tests 126 / pass 126 / fail 0`（与 `pvtree5` §8 的 121 自洽：
那 5 条差的就是 `module-size`）。

**收工**：

| 门禁命令 | 原始数字 |
| --- | --- |
| `node --test tests/project-tree*.test.mjs tests/pv-*.test.mjs tests/structure*.test.mjs tests/outline*.test.mjs`（12 文件，四族判据本体） | **`tests 126 / pass 126 / fail 0`** |
| `node --test tests/module-size.test.mjs` | **`tests 5 / pass 4 / fail 1`** —— 唯一那条红是 `已登记的 native 大文件不许继续变大`：`native/workspace.cpp 现在 1477 行 > 上限 1385`（实测 `wc -l` = 1478）。**不是本批的文件**：`git status --porcelain native/workspace.cpp` ⇒ `M`、mtime **17:02:31**（本批开工时它是绿的，`pvtree5` 收工后别的路写的）。按「在飞红只记录不修」，本批不碰 `native/**`（也在禁写清单里） |
| 上面两条合起来（任务书给的那一条整命令） | **`tests 131 / pass 130 / fail 1`**，唯一 fail 即上面那条 native |
| 单文件实测 | `outline-view` **25/25**（本批 20→25）、`structure-follow` **18/18**、`outline-caret-source` **8/8**、`project-tree-appearance` **18/18**、`module-size` 5 里 4 绿 |
| `node .tools/find-orphan-modules.mjs --gate` | **读数两次都记**（本批之外有一条在飞）：<br>① 本批改完、收工中段跑：**门禁绿**（`已登记孤儿 6 / 基线 8 · 新增 0 · 本轮清掉 2`，清掉的是 `src/jarRun.ts`、`src/runAnythingContext.ts`，**不是本批**，与 `pvtree5` 看到的是同两条，留给主代理更基线）。<br>② **最终收工再跑**：`已登记孤儿 6 / 基线 8 · 新增 1 · 本轮清掉 2` ⇒ **门禁红**：`✘ 新增零生产消费方模块：src/components/CodeActionPopup.vue`。**不是本批的模块**（不在本批名下，本批也没新建任何模块）：该文件 mtime **17:12:58**（本批开工后别的路写的），全仓引用只有 `tests/code-action-popup.test.mjs:30` 与 `src/codeActionPopupModel.ts:48/:76` 的同名类型/读取 ⇒ 只有判据消费、没有生产挂载。**只记录不修**（见 §7 R-5）。两次跑都 `词法自检：0 异常` |
| `node .tools/find-missing-ext.mjs` | **干净**：扫描 **1380** 个文件（src + tests）里的 from / 副作用 / 动态三种 import 形态 |
| `node .tools/find-ts-in-mjs.mjs` | **干净**：`tests/*.mjs` 全部是纯 JavaScript |
| 名下文件隔离类型检查 `npx tsc --noEmit --strict --target es2022 --module esnext --moduleResolution bundler --allowImportingTsExtensions --skipLibCheck src/outlineView.ts src/structureFollow.ts src/projectTreeModel.ts src/pvMarkRoots.ts` | **`ISOLATED_EXIT=0`**，`error TS` 计数 **0**。（坑记一下：第一次**没带** `--allowImportingTsExtensions` 时满屏 `TS5097`，本仓 import 一律带 `.ts` 扩展名，那是命令参数缺项不是代码错） |
| 全仓 `npx vue-tsc --noEmit -p tsconfig.json` | **`REAL_EXIT=2`**，`error TS` 计数 **2**，两条都在 **`src/vcsLogPresentation.ts:315`/`:316`（TS2554 Expected 4 arguments, but got 3）** —— 并发黑名单 `src/vcsLog*` 的路，mtime **17:02:58**，**本批名下四个文件 0 错**（`grep -E "^src/(outlineView|structureFollow|projectTree|pv|components/OutlinePanel|components/ProjectView)"` 于该输出 ⇒ 空）。对照：`pvtree5` §8 在 14:20 报的是 EXIT=0 ⇒ 这条红是本批之外产生的。**坑**：`… | tail -8; echo $?` 拿到的是 `tail` 的退出码，会**假报 0**，必须 `> 文件 2>&1` 再读 `$?` |
| **每个改动模块 `node -e import()` 自证可加载**（防 `ss3` 那种「测试全绿但模块加载抛错」= 本仓第 7 种半截形态） | `import('./src/outlineView.ts')` ⇒ OK，`symbolRowIcon` 是 function，`symbolRowIcon(5)` 拿到组件、`symbolRowIcon(1)` = `null`；`import('./src/hierarchyRenderer.ts')` ⇒ OK，表长 **12**（本批新依赖它，特别验一次：`outlineView` 现在会**在加载期**拉 `lucide-vue-next` + `usageViewTreeModel`，这条最容易变成加载期抛错）；`import('./src/structureFollow.ts')` ⇒ OK，`rememberCollapsed` 是 function |
| 新持久化键 | **0 个** ⇒ 无迁移、无补默认 |


## 6. 无法核实

| # | 条目 | 实测到什么程度 | 为什么只能记「无法核实」 |
| --- | --- | --- | --- |
| N-1 | **中文措辞的全部出处**（系统性，不止本批） | `ls plugins/localization-zh/lib/localization-zh.jar` ⇒ `No such file or directory`；`ls plugins/ \| grep -i local` 只有 `IntelliLang`/`java-i18n`/`ml-local-models`；`find . -iname "*localization*"` 只命中 `com/intellij/l10n/**` 一类源码。本仓 `grep -rl "localization-zh" src tests docs` ⇒ **83 个文件**引它 | 唯一允许的参考树里**没有 zh 包**，按任务的上游纪律「无 zh 包 ⇒ 中文措辞『无法核实』」，这 83 处引文一律降级为无法核实。本批**能**钉的是英文侧：`ActionsBundle.properties:1459-1460`（`CompactDirectories` 的 text/description，与 `projectTreeCompactDirs.ts:9-11` 引的行号**分毫不差**）、`IdeBundle.properties:1227` `undo.command=Undo {0}`、同文件 `:1231`/`:1232`/`:1237`/`:1238` 那四条 `cannot.undo.*` ⇒ 详见 §1.3 与 §8 C-4 |
| N-2 | **行图标带可见性档**（上游图标的第二维） | 开到了判据级：`PsiTreeElementBase.java:50-58` 在非「可读写的文件」时或上 `ICON_FLAG_VISIBILITY`（`Iconable.java:11` = `0x0001`）、`StructureNodeRenderer.java:50` `result.setIcon(descriptor.getIcon())` | 上游那一套是 **kind × 可见性** 的图形变体（private/protected/包级各一张），`AllIcons` 的图形资源不在本 checkout 的文本可比范围内 ⇒ **具体该画哪一笔无法核实**。本批不做「拿一个锁角标凑数」（那就是假控件），把这一维登记成**未做**（不是「不适用」），见 §8 C-5 |
| N-3 | `MarkRootGroup.java:16-22`/`:24-32` 的逐行坐标 | 本批**没有**逐行复开（只复开了本仓侧的完整消费链：`treeActions.ts:16`/`:153` + `App.vue:1398`/`:2506-2508`） | 沿用 `pvtree5` §6 第 5 行同一保留（它也没开）。§1.1 第 5 行的结论只依赖「本仓有没有这个入口」，不依赖那两个行号 ⇒ 结论不受影响，但**谁要用那两个行号得先自开** |
| N-4 | 「折叠全部」在**多个顶层行**时的真机观感 | 未复开 `TreePath.isDescendant` 与 `TreeUtilVisitTest`（`pvtree5` §4/§9 开过并留了证据） | 本机没有 Swing 环境可跑，且 `pvtree5` 已经用上游单测钉住；本批不重复取信，只沿用它挂的 **R-3**（见 §7） |
| N-5 | 本批 lucide 图形选型（`Square`/`FunctionSquare`/…） | 形状与本仓层级侧**同一份表**（`hierarchyRenderer.ts:51-64`），转发关系有判据（§3 第 1 条） | 「上游这张图长什么样」无法核实 ⇒ 与 `hierarchyRenderer.ts:26-29` 同一口径写明**本仓自定**，不冒充上游像素 |
| N-6 | 真机渲染效果（图标是否压字、行高是否被撑开） | 只到 **SSR 判据级**（§3 第 3、4 条跑的是 `renderToString`，实测 HTML 里图标元素在 `.outline-jump` 内、在 `.outline-kind` 前） | 本会话未获真机/起 GUI 授权（任务书没给，纪律也不允许擅自启他 GUI）⇒ 布局观感只能静态钉，`align-self: center` 那一条是按 `.outline-jump` 现有 `align-items: baseline` 推出的，**没有真机复核**，列为待观察 |

## 7. 接线请求

| # | 请求 | 给谁 | 本批为什么自己办不了 |
| --- | --- | --- | --- |
| W-0 | **本批不需要任何新接线**（先写死这一条，免得被当成半截） | —— | 新增的只有「已有那一行的行首多一枚图形」：`OutlinePanel.vue` 早在 `src/components/ToolWindowView.vue:196` 挂载（`pvtree5` §3 第 2 件核过），`props.symbols` 是现成的，**零新 prop、零新挂载点、零新持久化键**。旁证（mtime，本批没写过这些文件）：`src/App.vue` 17:10:46（别的路正在写）、`src/bridge.ts` 14:52:09、`ToolWindowView.vue` 12:30:41、`FileTree.vue` 13:32:14 —— 全在本批动手之前 |
| R-1 | 「按 path 分桶 + LRU 上界」的展开态沿用，若日后抽成公共件，请把 `src/structureFollow.ts:188-211` 并过去（**本仓第三份同形状实例**） | 主代理 + `usageView*`（refview3）+ `hierarchy*`（hierlevel）两条 owner | 那两份都在并发黑名单里 ⇒ 本批**只读**；合并会同时改三家的判据，不该由本批单方面做。本批已把「为什么现在不能复用」写进 `src/structureFollow.ts:175-186`（§2.2），所以**账是齐的，只是没并车** |
| R-2 | `ShowExcludedFiles` 需要宿主：列举带出被排除项 + 灰显 | 主代理（宿主路） | 判据级证据：`native/workspace.cpp:479` `if (is_directory && ignored_directory(name, excluded)) continue;`（函数本体 `:455`）⇒ 前端拿不到那些行。**本批复核了这条理由站得住**（§1.2 第 6 行），不是推诿。`native/**` 在禁写清单 |
| R-3 | `collapseAll` 的两处行为分歧（`TreeUtil.java:916` 的多顶层行 flip；无选中行时上游仍留开第 0 行而本仓一律清空） | 主代理 | `pvtree5` §4 已提出并挂在 `docs/wiring-requests-2026-10-06-pvtree5.md`；本批**复核后不改**（同一件事不重复申请，也不擅自改行为） |
| R-4 | 账本手术（§8 的 C-1…C-6） | `ledgerfix` 一路 | `docs/inventory/**` 在禁写清单。⚠️ 竞态提醒：本批 17:2x 复测时 `docs/inventory/verdict-projectviews.md` 与 `projectviews_verdict_table.json` 的 mtime 已经是 **17:06:49**（`ledgerfix` 正在动），但 §8 依赖的那几句原文**逐条 grep 仍在**（`没有应用级命令栈`=1、`跨文件的全局撤销栈`=1、`MarkRootGroup`=1、`可编辑的嵌套规则`=1、`autoscroll to/from source`=1、`compact middle packages`=1；`行图标`/`getIcon` 在该文件均 **0**）⇒ 本批的订正**不是**重复劳动；若它已并批处理，请按 §8 逐条对账而不是重算 |
| R-5 | 三条**在飞红**（本批之外，按纪律只记录不修） | 主代理 | ①`node --test tests/module-size.test.mjs` ⇒ `native/workspace.cpp 现在 1477 行 > 上限 1385`（`wc -l` 实测 1478，mtime **17:02:31**，别的路写的）；②`npx vue-tsc --noEmit -p tsconfig.json` ⇒ **EXIT=2**，2 条全在 `src/vcsLogPresentation.ts:315`/`:316` TS2554（mtime **17:02:58**，并发黑名单 `src/vcsLog*`）；③`node .tools/find-orphan-modules.mjs --gate` ⇒ **门禁红**，`新增 1`：`src/components/CodeActionPopup.vue` 零生产消费方（mtime **17:12:58**，不在本批名下，本批也没新建模块）。三条都不是本批引入：本批开工基线 126/126 全绿、orphan 门当时绿、`pvtree5` §8 的 vue-tsc 也是 EXIT=0；本批名下四个文件复测 0 错（见 §5 的隔离 tsc 与 grep 过滤） |

## 8. 账本订正请求（本批**一个字没改** `docs/inventory/**`）

| # | 账本位置 | 现在怎么写 | 建议改成（证据都在本报告 §1） | 错型 |
| --- | --- | --- | --- | --- |
| C-1 | `verdict-projectviews.md:33`（`pv/command`） | 「`src/editorCommands.ts` 只登记编辑命令，**没有应用级命令栈**」＋缺 `UndoProvider`/`FileUndoProvider`、`CommandMerger`、`CannotUndoReportDialog` | **整行改写**：应用级跨文件命令栈已在 `src/pvCommandProcessor.ts`（`:43`/`:44` 两个栈深、`:50` `FlushReason`、`:166` `commandMenuText`、`:387` `getCommandProcessor`），文件级撤销在 `src/pvFileUndoProvider.ts`，**生产消费方** `src/explorerActions.ts:11-12` + `src/components/FileTree.vue:11-12`，判据 `tests/pv-{command-processor,command-wiring,file-undo}.test.mjs`。仍缺的只剩「编辑器内文本撤销与文件栈的**合并撤销**」（CodeMirror 那份历史不参与全局栈） | ②判漏（本项目**第 7 例**） |
| C-2 | `verdict-projectviews.md:28`（`pv/project-view-nodes`） | 「缺：包视图（…的 flatten/**compact middle packages 呈现**，需 PSI/Java 模型）」 | 限定为**PSI 包三档**（`FlattenPackages`/`AbbreviatePackageNames`/`HideEmptyMiddlePackages`）；文件系统目录那一半已闭环：`src/projectTreeCompactDirs.ts`（`:54/:61/:70/:87`，`MAX_COMPACT_CHAIN:35`）→ `src/projectTreeModel.ts:5/:20/:56` → `FileTree.vue:51` → `ProjectViewSortSettings.vue:53` → `projectTreeSort.ts:19`，上游规则本批逐行复开为 `ScopeViewTreeModel.java:595-608`/`:657-661`/`:789-792` | ②判漏（半条） |
| C-3 | `verdict-platform_rest.md:235`（`ls/navigation`） | 「`src/outlineView.ts`（documentSymbol 树 = **`LspStructureViewSupport`**/`documentSymbol/converters.kt`）」——整族算已有 | 补一句成员级账：那个类三个成员 `:19 getDocumentSymbols`/`:21 getIcon`/`:24-26 navigate`，本仓 **2026-10-06 pvclose 起三个齐**（`symbolRowIcon` = `src/outlineView.ts:187-189`，面板 `OutlinePanel.vue:168`，判据 `tests/outline-view.test.mjs:298-368`）；`getIcon` 此前**从未有出口**（本批在两份账里 grep `行图标`/`getIcon` 结构视图那侧均 0 命中） | ①说过 + ③未登记 |
| C-4 | `verdict-projectviews.md:33` 与本仓 `src/pvCommandProcessor.ts:19-21`、`src/projectTreeCompactDirs.ts:11-12` 的**中文文案坐标** | 引 `plugins/localization-zh/lib/localization-zh.jar` 的 `ActionsBundle.properties:2522-2524` / `IdeBundle.properties:2731-2734` 等 | 中文坐标改标「**无法核实（zh 包不在参考树）**」，并同时给出本批复开过的英文坐标：`IdeBundle.properties:1227 undo.command`、`:1231 cannot.undo.title`、`:1232 cannot.undo.message`、`:1237`/`:1238` 两条 `cannot.undo.error.*`；`ActionsBundle.properties:1459-1460`（`CompactDirectories` 那条引对了）、同文件 `:428`/`:429` 两条 `action.undo.description*`（`pvCommandProcessor.ts:18` 引的 `action.undo.description.empty` **在盘上真实存在**）。⚠️ 键名也漂了一处（本仓 `:28`）：写的是 `…other.affected.files_changed`，上游实际是 `…files.changed.message`（`IdeBundle.properties:1237`） | 坐标错 + 无法核实 |
| C-5 | `projectviews_verdict_table.json` / `verdict-projectviews.md:30`（`pv/structure-view`）缺项列表 | 只列三条缺（`Show Inherited Members`、autoscroll 两开关、PSI 排序器族），**没有「行图标」** | 加一条并标**已落**（图形维只到 `kind`）；同时把 `StructureNodeRenderer.java` 那行的 `tier -`（不适用）降为 `~`：本批复开 `java/java-impl/src/com/intellij/ide/structureView/impl/StructureNodeRenderer.java`，`:50` 就是 `result.setIcon(descriptor.getIcon())`（**行图标**），`:38-45` 是继承成员灰显 + `applyDeprecation`（`isInheritedMember` 在 `:54`），前者本批已还原、后者仍受 PSI 限制 ⇒ 「整族不适用」过宽。另：`Show Inherited Members` 的**可见行为**建议补细：上游不止是「多几行」，`:41` 还把成员**来自哪个类**用灰显写在行尾 | ③未登记 + 过宽 `-` |
| C-6 | `projectviews_verdict_table.json` 的 `presence` 字段本身 | 实测 `pv/project-view` 41 行里 37 行、`pv/project-view-nodes` 122 里 111、`pv/structure-view` 94 里 91 都是 `从未出现`；语义（本批复开 `scripts/verdict_table.py:983`）= **英文类名在本仓搜得到吗** | 建议加一列「**同一可见行为是否已由别的名字落地**」。`presence=从未出现` 天生抓不住 C-1/C-2 这类 ②判漏（本批又添 2 例，累计第 7 例）。另外 C-3/C-5 会让 `PsiTreeElementBase.java`、`LspStructureViewSupport.kt` 两行的 `presence` 从 `从未出现` 变 `只被注释引用`（本批把这两个名字写进了 `src/outlineView.ts:156-186` 的注释）⇒ **`verdict_table.py` 需要重跑一次**才能刷新（本批无权改 `scripts/` 与 `docs/inventory/`） | 工具的结构性盲区 |

**本批名下改动清单**（给 `ledgerfix` / 主代理对账用）：
`src/outlineView.ts`、`src/components/OutlinePanel.vue`、`src/structureFollow.ts`（**纯注释**）、
`tests/outline-view.test.mjs`（**纯追加**）、`docs/batch-2026-10-06-pvclose.md`（本文件）。
禁写清单与黑名单：`native/main.cpp`、`scripts/verdict_table.py`、`docs/inventory/**`、`src/settingsModel.ts`、
`src/App.vue`、`src/bridge.ts`、`src/components/CodeEditor.vue`、`src/usageView*`、`src/hierarchy*`、
`src/diff*`、`src/merge*`、`src/commit*`、`src/vcsLog*`、`src/todo*`、`src/terminal*`、`src/patch*`、
`src/codeLens*`、`src/errorTree*`、`src/semanticActions.ts`、`src/menus/**`、`src/speedSearch*`、`src/symbolSearch*`
—— **一个没碰**（黑名单文件本批只 `grep`/`Read`，见 `hierarchyRenderer.ts`、`usageViewTreeModel.ts`、`hierarchyRows.ts`）。
git 层面零操作：没有 `checkout`/`reset`/`stash`/`clean`/`add`/`commit`/`push`。

