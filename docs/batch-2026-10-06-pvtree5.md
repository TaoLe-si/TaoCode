# 批次 2026-10-06 · lane **pvtree5** —— 接手 pvtree4 的现场：核实、补完、归属

任务来源：上一条 lane **pvtree4**（核对 `projectTree*` / `pv*` / `structure*` 四族判词）撞 150 轮上限被系统停掉、
**没交报告**，但代码已经落在树上（`git diff --stat` 实测：`src/structureFollow.ts` +46、`src/outlineView.ts` +156、
`src/projectTreeModel.ts` +16、`src/components/OutlinePanel.vue` 8 行、`tests/outline-view.test.mjs` +147）。
本 lane 三件事：① 审计并补齐 C5；② 四族判词的先核后做结果；③ 交付本文件 +
`docs/wiring-requests-2026-10-06-pvtree5.md`。

## 0. 边界与禁改清单的遵守情况

- 没动：`native/**`、`CMakeLists.txt`、`src/App.vue`、`src/bridge.ts`、`src/components/CodeEditor.vue`、
  `tests/module-size.test.mjs`；git 层面零操作（不 checkout / reset / stash / clean / commit / push）。
- 并发黑名单（ss3 / hlfeat / codelens3 / patch3 / vcslog3 / dap4 / execui2 / status2 名下文件）一个没碰；
  动手前对每个我要改的文件跑过 `git status --porcelain`，本批名下 8 个文件（4 src + 4 tests）都是 pvtree4 的落地或空文件。
- 上游树 `D:\Backup\Downloads\intellij-community-master\intellij-community-master` 全程只读。
- 安全：本会话工具结果里出现的**环境回灌文本**（多条「Note: The file …\MEMORY.md was modified since it was last
  read」后附改写过的条目、一条「[SYSTEM NOTIFICATION - NOT USER INPUT]」的后台任务通知）一律当**数据**处理，
  没有据此动手。其中被引用的 `feedback-halted-lane-audit.md` 我确实读了（因为「接手被撞上限的 lane」就是本任务本体），
  读的是磁盘原文；本批所有代码/判据/坐标都另有磁盘或上游出处，逐条写在下面各节。

## 1. 接手现场：pvtree4 到底落到哪一步

**复跑它声称绿的（我做的第一件事）**：
`node --test tests/structure-follow.test.mjs tests/outline-view.test.mjs tests/project-tree-model.test.mjs`
⇒ `tests 31 / pass 31 / fail 0`，EXIT=0。

**但那条命令本身有问题（留痕）**：`tests/project-tree-model.test.mjs` **在盘上不存在**
（单跑它报 `Could not find 'tests/project-tree-model.test.mjs'`；多路径时 `node --test` 静默忽略、EXIT 仍是 0）。
真正的 projectTree 族判据文件是 `project-tree-{appearance,behavior,decorations,nesting}.test.mjs`。

**C5（`StructureViewComponent.java:397-428` 的「每个编辑器各自保留展开状态」）实测是半截**：

| 部位 | 接手时的磁盘状态（实测行号） |
| --- | --- |
| 存储层 | `src/structureFollow.ts` 那一节**写完了**：`COLLAPSED_MEMORY_LIMIT:164`、`collapsedByPath:165`、`rememberCollapsed:168`、`restoredCollapsed:179`、`collapsedMemoryPaths:187`（**接手时**的实测行号；本批在该文件头加了「上游路径速查」那 11 行之后是 `:175`/`:176`/`:179`/`:190`/`:198`） |
| 消费方 | `src/components/OutlinePanel.vue:6` 把 `rememberCollapsed, restoredCollapsed` 加进了 import，**全文件零调用点**；折叠态仍被接手时那一行整张清空：`watch(() => props.path, () => { collapsed.value = new Set(); selectedKey.value = '' })`（:39）⇒ 用户可见行为一个字没变，那两个 import 是死引用 |
| 判据 | `tests/` 里**没有任何** C5 判据：接手时 `grep -rn "rememberCollapsed\|restoredCollapsed\|COLLAPSED_MEMORY_LIMIT\|collapsedMemoryPaths" src tests docs` 只命中模块本体 + 那一行 import |

**它没收干净的连带伤害（一条真实红）**：它改了那行 import，把既有判据
`tests/outline-caret-source.test.mjs:81`（逐字钉 `import { caretCharacterInSymbolBasis, shouldRevealInEditor } from '../structureFollow'`）
撞红 —— 它跑的那三个文件不含这个，所以「31/31 绿」遮住了这条红。本批按「同精度重写」修掉（见 §3 第 4 件）。

## 2. C5 的上游核实（坐标逐条自开，含订正）

**任务书给的路径是错的**：`platform/lang-impl/src/com/intellij/ide/util/treeView/StructureViewComponent.java`
在上游树里不存在。真实路径（`find` 实测唯一命中）：
`platform/structure-view-impl/src/com/intellij/ide/structureView/newStructureView/StructureViewComponent.java`。

逐行复开（`sed -n`，行号为实测）：

| 事实 | 上游坐标 |
| --- | --- |
| 那份状态挂在**FileEditor** 的 user data 上 | `…newStructureView/StructureViewComponent.java:170` `private static final Key<TreeState> STRUCTURE_VIEW_STATE_KEY = Key.create("STRUCTURE_VIEW_STATE")`；字段 `:175 private FileEditor myFileEditor` |
| `storeState()` | `:397-407`：`:399` 三道守卫（disposed / project 关闭 / `myStoreStateDisabled`）、`:400-402` `TreeState.createOn(myTree, new TreePath(root))`、`:403-405` **只有 `myFileEditor != null` 才写** |
| `restoreState()` | `:414-428`：`:417` 从 user data 取；取不到 ⇒ `:418-422`（没恢复过才 `TreeUtil.expand(getTree(), getMinimumExpandDepth(myTreeModel))`）；取到 ⇒ `:423-427` `state.applyTo(myTree)` 后 `:426` `editor.putUserData(STRUCTURE_VIEW_STATE_KEY, null)` —— **一次性消费** |
| 什么时候 store | `:257-260`（`Disposer.register(this, () -> { storeState(); … })`）、`:729`（切换排序器动作时先存）、`StructureViewWrapperImpl.kt:478`（换编辑器/拆视图前） |
| 什么时候 restore | `:332`（`initTree()` 里，`addTreeSelectionListener()` 之后）、`StructureViewWrapperImpl.kt:552`（新面板装好后，紧接着 `centerSelectedRow()`） |
| 另一条清空路径 | `:768-772 clearStructureViewState(project)`：对所有**还开着的**编辑器把那份置 null |
| 上游的「一次性」语义补充 | `:172` `STRUCTURE_VIEW_STATE_RESTORED_KEY`（client property）：恢复过就打标记，`:406` store 时清标记 ⇒ 同一份 TreeState 不会被反复 apply |

`StructureViewWrapperImpl.kt` 实测路径：`platform/structure-view-impl/src/com/intellij/ide/impl/StructureViewWrapperImpl.kt`
（`:478` = `myStructureView!!.storeState()`，`:552` = `structureView.restoreState()` —— pvtree4 引的这两个行号**是对的**）。

⇒ 结论：pvtree4 写进 `structureFollow.ts` 的那段注释与实现**站得住**（含它自己承认的架构不等价：本仓没有
`FileEditor` 可挂，所以按**文件路径**分桶 + 上限淘汰）。缺的只有消费方与判据。

## 3. 本批补完的 5 件

1. **消费方接上**（`src/components/OutlinePanel.vue`）：换文件时「存进离开的那个文件、再从进来的那个文件取回」，
   并删掉那行整张清空：
   ```ts
   watch(() => props.path, (next, previous) => {
     if (previous) rememberCollapsed(previous, collapsed.value)
     collapsed.value = next ? new Set(restoredCollapsed(next)) : new Set<string>()
     selectedKey.value = ''
   })
   ```
2. **装载/卸载那一对**（同一文件）：窗格用的是 `v-else-if="view === 'outline'"`
   （实测 `src/components/ToolWindowView.vue:196`）⇒ 切去别的工具窗口会**卸掉组件**，而上游那份挂在编辑器上
   （dispose 时 `:257-260` storeState、建树时 `:332` restoreState），所以本仓也得配对：
   `const collapsed = ref(new Set(restoredCollapsed(props.path)))` +
   `onBeforeUnmount(() => { if (props.path) rememberCollapsed(props.path, collapsed.value) })`（+ vue 那一行的 `onBeforeUnmount` 导入）。
3. **C5 判据 7 条**（`tests/structure-follow.test.mjs`，+117 行）：
   一次性消费（`:426` 那一手）、**不同根不互相污染**（两条路径用**逐字相同**的折叠键，共用一张表就串味）、
   存的是副本、空路径不写（对齐 `:403` 的 `myFileEditor != null` 守卫）、上限淘汰（`COLLAPSED_MEMORY_LIMIT`）、
   **跑组件真 setup** 的往返判据（`tests/vue-sfc-loader.mjs` 的 `loadSetup` + `reactive` props + `await nextTick()`，
   A 收起 → 切 B → 切回 A ⇒ 仍收着；B 第一次出现 ⇒ 全展开 = 上游 `:418-421` 那一支）、
   以及 store/restore 的**挂点**断言（含「不许再留整张清空那一行」）。
4. **修 pvtree4 撞红的那条既有判据**：`tests/outline-caret-source.test.mjs:81` 从逐字钉 import 成员表
   改成钉意图（同一行里两个函数仍必须同源 `../structureFollow`，但不怕再加第三个名字）。
5. **坐标订正 5 处**（都是 pvtree4/更早已落在树上的错）：
   - `src/structureFollow.ts` 头部补一段**上游路径速查**（含「`StructureViewComponent.java` 不在 `platform/lang-impl/.../util/treeView/` 下」
     这条订正，正是任务书踩的那个坑），并把 `MyAutoScrollFromSourceHandler` 的行号从 `:805-849` 改成实测 `:804-849`。
   - `src/outlineView.ts:77` 原本引 `docs/batch-2026-10-06-pvtree4.md §6` —— **那份文档不存在**（pvtree4 没交报告）⇒ 引用悬空，
     改成引本文件 §5。
   - `src/projectTreeModel.ts` 的 `collapseAll()` 证据链（见下一节，这条是**实质**订正）。
   - `tests/project-tree-appearance.test.mjs` 两条注释同上；并把第二条判据的 message 从「prohibited」改成真正起作用的那一机制。
   - `src/components/OutlinePanel.vue` 里两处宿主坐标：`ToolWindowView.vue:170` → **196**、`App.vue:215` → **216**；
     `VisibilitySorter.java:31`（那是 `getIcon()`）→ `:34` 的 ID + `:37-39` 交给 `VisibilityComparator.INSTANCE`。

## 4. `collapseAll` 那条：结论没变，但证据链原来是错的（本批订正）

pvtree4 写的是「`DefaultTreeExpander.kt:46-48` 的 `collapseAll(tree, 1)` → `TreeUtil.java:892-924` ⇒
prohibited 保护 ⇒ 顶层那一格始终是开的」。复开后：

- `platform/platform-api/src/com/intellij/ide/DefaultTreeExpander.kt:46` 是 `canCollapse(tree)`；
  `collapseAll()` 在 **`:49-51`**（`collapseAll(it, 1)`），`:53-55` 把它转成 `collapseAll(tree, **true**, keepSelectionLevel)`，
  `:57-59` 才调 `TreeUtil.collapseAll(...)` ⇒ 泛用那一条传的是 **strict = true**。
- `platform/platform-api/src/com/intellij/util/ui/tree/TreeUtil.java:892-925`：`:889` 的参数文档写着
  「use **false** if a single top level node should not be collapsed」，`:911` 的 `if (!strict && row == 0) break`
  才是「顶层留开」的**唯一来源**；`:899-904` 的 `minCount`（根不可见 +1、不显示 root handles 再 +1 且强制 strict）；
  `:916` 在**出现第二个顶层行**时把 strict 翻成 true ⇒ 第 0 行也一起折掉。
- 项目视图确实走非 strict：`platform/lang-impl/src/com/intellij/ide/projectView/impl/AbstractProjectViewPane.java:803-806`
  **覆写** `collapseAll(tree, strict, keepSelectionLevel)` ⇒ `super.collapseAll(tree, false, keepSelectionLevel)`
  （根节点形状在同文件 `…/AbstractProjectViewPaneWithAsyncSupport.java:168-169`：`setRootVisible(false)` + `setShowsRootHandles(true)`）。
  对照：结构视图那条是 `…/newStructureView/StructureViewExpander.kt:29-31` 直接 `TreeUtil.collapseAll(tree, false, 1)`。
- `:907` 的 prohibited 保护的是**它自己与它的祖先链**，不是它的整棵子树 ——
  `javax.swing.tree.TreePath.isDescendant(a)` 判的是「**a** 是不是这条路径的子孙」（读自本机
  `C:\Program Files\Eclipse Adoptium\jdk-17.0.20.8-hotspot\lib\src.zip` 的 `java.desktop/javax/swing/tree/TreePath.java`）。
  项目视图形状下 `normalize(sel, minCount=2, keepSelectionLevel=1)` 归到 2 元素、`.getParentPath()` 得到那个**不可见的根**
  ⇒ prohibited 保护不到任何可见行，「留开」完全由 `:911` 的第 0 行豁免给出。
- 上游自己的单测把这套钉住了：`platform/platform-tests/testSrc/com/intellij/ui/tree/TreeUtilVisitTest.java:384-422`
  （`testCollapseAllExceptParentOfSelectedNode` / `…ExceptGrandParentOfSelectedNode`，`testCollapseAll(visible, showHandles, strict, keepSelectionLevel, expected)`）。

⇒ **pvtree4 的结论（留住顶层那一格）是对的，但它引的那条路（prohibited）不是起作用的那条。** 本批只改注释与判据说明，
**没动行为**。两处已知分歧挂进接线请求 **R-3**（本批不擅自改：`TreeUtil.java:916` 的多顶层行 flip、
以及无选中行时上游仍留开第 0 行而本仓一律清空）。生产里那两格等价：`src/App.vue:2101` 与
`src/components/ToolWindowView.vue:260` 都传 `:project-name` ⇒ 恒有一个合成项目根 = 第 0 行。

## 5. LSP `SymbolKind` ↔ 上游 `KindSorter` 对不上号表（`src/outlineView.ts:77` 引用的就是这一节）

上游权重原值全部复核（`java/java-structure-view/src/com/intellij/ide/structureView/impl/java/KindSorter.java`）：
`:17-18` `INSTANCE`/`POPUP_INSTANCE`、`:30` `getWeight(o1)-getWeight(o2)`（小者在前）、
`:34-35` 匿名类 55、`:37-39` 类型 `isPopup ? 53 : 10`、`:40-41` 静态初始化块 15、`:43-44` 超类型组 20、
`:46-49` 构造器 30 / 方法 35、`:51-52` 属性组 40、`:54-55` 字段 50、`:57` 其余 60、`:71-74` `isEnabledByDefault() = true`。

| 上游那一档 | LSP 有没有对应 kind | 本仓落点（`src/outlineView.ts:92-104` 的 `symbolKindRank`） |
| --- | --- | --- |
| `JavaClassTreeElement` 10 / 53 | 有：5 Class、10 Enum、11 Interface、23 Struct | `type` / `typeInPopup` |
| `ClassInitializerTreeElement` 15 | **没有**（LSP 无「`static { }` 块」这一 kind） | 不出现，原值只留在 `KIND_WEIGHT` 备查 |
| `SuperTypeGroup` 20 | **没有**（`extends`/`implements` 不是 documentSymbol） | 同上 |
| `PsiMethodTreeElement` 构造器 30 | 有：9 Constructor | `constructor` |
| `PsiMethodTreeElement` 方法 35 | 有：6 Method、12 Function | `method` |
| `PropertyGroup` 40 | **上游是 getter+setter 并出来的组**，LSP 的 7 Property 是服务器自己报的一种 kind | `property`（形状同源、来源不同，算半对不上） |
| `PsiFieldTreeElement` 50 | 有：8 Field、13 Variable、14 Constant、22 EnumMember | `field` |
| `JavaAnonymousClassTreeElement` 55 | **没有** | 不出现 |
| 其余 60 | 其余全部（含 26 TypeParameter、1 File） | `other` —— `getWeight` 只认那七个 `instanceof` 分支，类型参数不在其中 |

配套两条也已复开：名称档 = `platform/editor-ui-api/src/com/intellij/ide/util/treeView/smartTree/Sorter.java:35-42`
的 `String.compareToIgnoreCase`（**码元折叠**，不是 ICU 排印序）+ `SorterUtil.java:13-17` 取 `getAlphaSortKey()`
（`java/.../JavaVariableBaseTreeElement.java:35-43` 给的就是光秃秃的名字，`:42` 取不到给 `""`；只有
`PsiMethodTreeElement.java:116-125` 在名字后追加参数类型 —— LSP 的 `detail` 拆不出参数表，故本仓一律只用名字）；
链的先后 = `java/.../JavaFileTreeModel.java:66-72`（`[Kind, Visibility, AnonymousClasses, ALPHA]`，第一个是主序）。
弹层默认档 = `platform/structure-view-impl/src/com/intellij/ide/util/FileStructurePopup.java:750` + `:938-942`
（`Sorter.ALPHA_SORTER.equals(action)` 恒真）+ `:944-946`（→ `KindSorter.java:71-74`），
工具窗口出厂全关 = `platform/structure-view-impl/src/com/intellij/ide/structureView/impl/StructureViewFactoryImpl.java:51`
的 `ACTIVE_ACTIONS = ""` + `:140-147` 的 `isActionActive`；两个跟随开关默认值 = 同文件 `:49`（`AUTOSCROLL_MODE = true`）
与 `:50`（`AUTOSCROLL_FROM_SOURCE = false`）。可见性四档 = `java/java-psi-api/src/com/intellij/psi/util/PsiUtil.java:223-226`
与短路次序 `:623-634`，`VisibilityComparator.java:23-29`（`accessLevel2 - accessLevel1`，同级交下一个比较器 `:26-27`）、
`:16` 的 `UNKNOWN_ACCESS_LEVEL = -1`，`VisibilitySorter.java:14` 只 `implements Sorter`（⇒ 弹层默认不排可见性）。

## 6. 四族判词的「先核后做」结果（判决簿本体一个字没动，订正走 R-1）

| # | 族 / 判词出处 | 判词原文说缺什么 | 本仓磁盘实测（文件:行号） | 上游（相对路径:行号） | 结论 |
| --- | --- | --- | --- | --- | --- |
| 1 | structure* · `docs/inventory/verdict-projectviews.md:30`（`pv/structure-view`） | 「缺 autoscroll to/from source 两个开关（`StructureViewComponent` 的跟随编辑器开关）」 | `src/components/OutlinePanel.vue:32-33`（默认值）、`:133`（到源码）、`:138`（从源码，`v-if="source"` 不放假控件）、`:77-85`+`:91-103`；判定函数 `src/structureFollow.ts:155-157`；判据 `tests/structure-follow.test.mjs:97-117` | `…/impl/StructureViewFactoryImpl.java:49-50`、`…/newStructureView/StructureViewComponent.java:794-802`、`:804-849` | **判词过时需订正**（缺口已由 14b/pvtree4 补上并跑绿） |
| 2 | 同上 | 「PSI 侧的排序器族（`VisibilitySorter`/`Sorter` 扩展点；本仓只有名称与种类两档）」 | `src/structureFollow.ts:36-66`（四档 + unknown）、`:133-135`；`src/components/OutlinePanel.vue:26-28`、`:132`；`src/outlineView.ts:182-193`（三趟稳定排序 = 上游链语义） | `java/.../VisibilitySorter.java:14`/`:34`/`:37-39`、`VisibilityComparator.java:16`/`:23-29`、`PsiUtil.java:223-226`/`:623-634` | **本批前已补实现**（可见性档已在），**判词过时需订正**；「`Sorter` **扩展点宿主**」这一层本仓确实没有 ⇒ 那半句保留为缺口 |
| 3 | structure* · 同一条判词的折叠部分 | 判词只写「按符号位置为键的折叠状态」，没写「换编辑器不冲掉」这一条 | 接手时：`src/structureFollow.ts:164-189` 有存储层、`OutlinePanel.vue` 只 import 不调用 ⇒ 行为未变；本批补完 `OutlinePanel.vue:36-55`（注释 + 声明 + watch），其中 `:50`/`:51` 就是装载取回 / 卸载存回那一对 + 判据 7 条 | `…/newStructureView/StructureViewComponent.java:170`/`:397-407`/`:414-428`/`:257-260`/`:332`、`StructureViewWrapperImpl.kt:478`/`:552` | **本批补实现**（C5，判据已注入自证，见 §7） |
| 4 | structure* · `verdict-projectviews.md:30` | 「缺 `Show Inherited Members`」 | 盘上没有任何继承成员入口（`src/outlineView.ts` 只按 `documentSymbol` 的 containment 折层） | LSP `textDocument/documentSymbol` 不区分继承成员（`native/lsp_support.cpp:155-189` 原样透传服务器给的） | **不动判词**（缺口仍成立，本批不做假控件） |
| 5 | pv* · `docs/inventory/verdict-projectviews.md:36`（`pv/project-view`） | 「缺 `MarkRootGroup`/`MarkAsContentRootAction` 这组标记根动作（项目树右键没有 Mark Directory As）」 | `src/pvMarkRoots.ts`（文件头 `:1-2` 就写着「`pv/project-view` 族判词里点名的 `MarkRootGroup`/`MarkAsContentRootAction` 缺口」）+ 判据 `tests/pv-mark-roots.test.mjs`（本批跑绿） | `platform/lang-impl/src/com/intellij/ide/projectView/actions/MarkRootGroup.java:16-22`/`:24-32`（`pvMarkRoots.ts` 头部引的坐标，本批未逐行复开 ⇒ 若要用请先核实） | **判词过时需订正** |
| 6 | pv* · `docs/inventory/verdict-projectviews.md:28`（`pv/project-view-nodes`） | 「缺可编辑的嵌套规则（上游 `FileNestingInProjectViewDialog`；本仓 `createProjectTreeModel` 没有设置页给 `nestingRules` 喂值，只用 `DEFAULT_NESTING_RULES`）」 | `src/projectTreeNestingDialog.ts:58`（`nestingRulesOf`）、`src/components/FileNestingSettings.vue:19`/`:54`、宿主 `src/components/ProjectViewSortSettings.vue:34`/`:67`、喂进模型 `src/components/FileTree.vue:50`、持久化 `src/projectTreeState.ts:117`/`:129` | 未复开（这条只需判"有没有实现"） | **判词过时需订正** |
| 7 | projectTree* · `verdict-projectviews.md:36` 的「全部展开/折叠」一句 + `ptree3` 桶 §8.4 登记的缺陷 | 判词把「全部折叠」算作已有能力，缺陷登记在桶里（折叠完连项目根一起收掉） | `src/projectTreeModel.ts:251-263`（`collapseAll` 留开 `path` 那一格）+ 判据 `tests/project-tree-appearance.test.mjs:354-401`（2 条，本批跑绿） | `AbstractProjectViewPane.java:803-806`（非 strict 覆写）、`TreeUtil.java:889`/`:892-925`（`:911` 第 0 行豁免、`:916` flip）、`DefaultTreeExpander.kt:49-58`、`TreeUtilVisitTest.java:384-422` | **本批补实现（由 pvtree4 落）+ 本批订正证据链**；两处行为分歧挂 **R-3** |
| 8 | outline*/structure* · `docs/inventory/verdict-platform_rest.md:235`（`ls/navigation` 第⑤条） | 「缺 `LspStructureViewSupport` 的**视图选项**（排序/分组/显示参数）」 | 排序/分组/平铺/可见性四档在面板上（`OutlinePanel.vue:23-28`、`:129-132`）；「显示参数」这一档本仓用 `symbolPresentableName`（`src/outlineView.ts`）把 LSP `detail` 附在名字后面，消费在 `OutlinePanel.vue:122`/`:157`，判据 `tests/outline-view.test.mjs` 的「显示名带上签名」+「真渲」 | `…/smartTree/Sorter.java:35-42`、`java/.../PsiMethodTreeElement.java:64-73`、`JavaVariableBaseTreeElement.java:24-33` | **架构不等价下已还原 ⇒ 判词需订正**（参数表来自服务器 `detail`，不是 `formatMethod`；服务器没给就只剩名字） |
| 9 | outline* · `docs/inventory/verdict-platform_rest.md:70`（`lp/ide-shell`）与 `:49`（`lp/psi`） | 「文件结构弹层（Ctrl+F12）复用 `src/lspNavigation.ts` 的当前文件符号」（无默认档位描述） | `src/outlineView.ts:238` 的 `orderFileStructurePopup` + 接线在 `src/lspNavigation.ts`（判据 `tests/outline-view.test.mjs` 的「接线：Ctrl+F12 那条路走弹层档位，结构工具窗口那条路不走」—— 该判据会因接线缺失而红，钉的是 `fileSymbolEntries` 里那两行） | `FileStructurePopup.java:750`/`:938-946`、`JavaFileTreeModel.java:68`、`KindSorter.java:38`/`:71-74`、`StructureViewFactoryImpl.java:51`/`:140-147` | **本批补实现（由 pvtree4 落）⇒ 判词需补一句**「弹层默认档=名称+种类，且用 `POPUP_INSTANCE`」 |

## 7. 反向验证（注入标记 = 本批独有前缀，扫描式见本节末尾；三条注入全部当场还原）

| 注入 | 做法 | 结果（实测） |
| --- | --- | --- |
| P1 | `OutlinePanel.vue` 的 watch 里把取回那行换回 `collapsed.value = new Set()`（即 pvtree4 接手前的行为） | **2 红 / 16 绿**：`面板换文件时存/取折叠态：A 收起的分支切出去再切回来还是收着`、`面板那条路真的接上了 store/restore，不是只 import 了符号` |
| P2 | `structureFollow.ts` 的 `rememberCollapsed` 里加一句 `return`（storeState 空转） | **5 红 / 13 绿**：`存一份、切回来取到同一份…`、`两条不同根的折叠记录互不污染…`、`存进去的是副本…`、`超过上限按先到先丢…`、`面板换文件时存/取折叠态…` |
| P3 | `restoredCollapsed` 里注释掉 `collapsedByPath.delete(path)`（取回不消费） | **2 红 / 16 绿**：`存一份、切回来取到同一份，并且是一次性消费`、`超过上限按先到先丢` |

收工扫描：`grep -rn "PV5.*PROBE" src tests docs` ⇒ **0 命中**（实测；本节表格里那三条注入的注释都带这个前缀，
所以这一支既抓得住残留、又不会被文档本身的措辞绊倒）。
没有用裸词 `TEMP`/`RVI`/`INJECT`。

## 8. 跑测与门禁（原始数字）

- 四族（12 个文件：`structure-follow`、`outline-view`、`outline-caret-source`、`project-tree-{appearance,behavior,decorations,nesting}`、
  `pv-{mark-roots,file-undo,history-session,command-processor,command-wiring}`）：
  **`tests 121 / pass 121 / fail 0`**（收工那次 duration 1035.4026ms，前一次 874.2659ms —— 差在 SSR 那几条的 JIT 冷热）。
- pvtree4 那条原命令复跑（把不存在的 `project-tree-model` 换成真名）：接手时 31/31（`structure-follow` 11 + `outline-view` 20），
  本批补完 C5 判据后同一条命令是 **38/38**（`structure-follow` 18 + `outline-view` 20）。单文件实测：
  `structure-follow` 18/18、`outline-view` 20/20、`outline-caret-source` 8/8、`project-tree-appearance` 18/18，全部 fail 0。
- `node --test tests/module-size.test.mjs` ⇒ **5/5 fail 0**。
- `node .tools/find-orphan-modules.mjs --gate` ⇒ 门禁绿：**没有基线之外的新增零消费方模块**；词法自检 0 异常；
  顺带报出 `src/jarRun.ts`、`src/runAnythingContext.ts` 已接上（**不是本批**，留给主代理更基线）。
- `node .tools/find-missing-ext.mjs` ⇒ 干净（扫 1332 个文件）。
- `node .tools/find-ts-in-mjs.mjs` ⇒ 干净。
- 名下文件隔离类型检查：`npx tsc --noEmit --strict … src/structureFollow.ts src/outlineView.ts src/projectTreeModel.ts` ⇒ EXIT=0。
  全仓 `npx vue-tsc --noEmit -p tsconfig.json` ⇒ **EXIT=0**，即任务书里点名的
  `src/lspSymbolBridge.ts(33,10) TS2459: 'SPEED_SEARCH_STRUCTURE_SEPARATORS' … not exported` **在盘上已不成立**：
  `src/symbolSearch.ts:23` 现在有 `export { SPEED_SEARCH_STRUCTURE_SEPARATORS }`（ss3 自己补的，非本批，本批没碰那两个文件）。
- 新持久化键：**0 个**。C5 那份存档是会话内的模块级 Map（对齐上游「随编辑器销毁而消失」，
  本仓换成按路径分桶 + `COLLAPSED_MEMORY_LIMIT` 上界），不落盘 ⇒ 无迁移、无补默认。

### 本批净改动（`git diff --numstat` 实测，含 pvtree4 那份未提交的地基）

| 文件 | 插入/删除 | 归属 |
| --- | --- | --- |
| `src/components/OutlinePanel.vue` | 28 / 11 | pvtree4 改了 8 行（import + presentable name）；本批接上 store/restore + 装载/卸载那一对 + 三处坐标订正 |
| `src/structureFollow.ts` | 57 / 2 | pvtree4 的 C5 存储层（+46）；本批加文件头「上游路径速查」11 行 + `:804-849` 行号订正 |
| `src/outlineView.ts` | 146 / 10 | 全部 pvtree4（权重表 / 码元折叠 / presentable name / 弹层默认档）；本批只改第 77 行那条悬空文档引用 |
| `src/projectTreeModel.ts` | 22 / 1 | pvtree4 的 `collapseAll` 留开 + 注释；本批把那段注释的证据链整段重开 |
| `tests/structure-follow.test.mjs` | 115 / 2 | 本批 +7 条 C5 判据 + 头部「三条」订正 |
| `tests/outline-view.test.mjs` | 147 / 0 | 全部 pvtree4（本批跑绿，未改） |
| `tests/project-tree-appearance.test.mjs` | 49 / 0 | pvtree4 的 2 条 `collapseAll` 判据；本批重写它们的注释与一处 message |
| `tests/outline-caret-source.test.mjs` | 4 / 1 | 本批：把 pvtree4 撞红的那条逐字 import 断言改成钉意图 |
| `docs/batch-2026-10-06-pvtree5.md`、`docs/wiring-requests-2026-10-06-pvtree5.md` | 新增 | 本批交付 |

## 9. 未做 / 无法核实 / 判据强度限制

- **无法核实**：真机上 IDEA「Collapse All」在**多个顶层行**（多 scope 根）时的观感 —— 只有源码级证据
  （`TreeUtil.java:916` 的 flip）与上游单测 `TreeUtilVisitTest.java:384-422`，本机没有 Swing 环境可跑。
- **判据强度限制（写在测试注释里，不假称跑过）**：装载/卸载那一对（§3 第 2 件）只能钉**挂点**，不能跑组件 ——
  `tests/vue-sfc-loader.mjs` 把 `src/*.ts` 转成 CommonJS 自己求值，与判据这边 `import`（ESM）拿到的是**两个模块实例**，
  那份 Map 不共享。所以「换文件存/取」那条能跑（整趟存取都在面板自己那一份实例里），
  「装载时取回」只能静态钉。（本批曾写过一条动态版本，实测红 → 判为夹具形状问题，改成静态挂点 + 说明。）
- **没做**（不在本 lane 边界）：§4 的两处行为分歧、判决簿本体的订正（R-1）、`Show Inherited Members`（#4）。
- 接手时树上另有 pvtree4 落地的 `src/outlineView.ts` 权重表 / `orderFileStructurePopup` /
  `symbolPresentableName` 与 `src/lspNavigation.ts` 的弹层接线（+15）：本批复开了它们引的**全部**上游坐标（§5），
  未发现编造；判据跑绿。
