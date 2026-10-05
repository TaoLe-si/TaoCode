# 桶 14a · 项目视图面板（树与节点半区）· 2026-10-06

范围：族 `pv/project-view-nodes`(122 类) / `pv/project-view`(41 类) / `pv/command`(77 类，剩余部分)。
接手现场：上一轮负责这一面板的代理在 150 次工具调用上限处被切断，**报告与接线请求都没写**，
只留下一批已落地的实现（其中 `src/components/FileNestingSettings.vue` 是**零引用的死模块**）。
判词来源：`docs/inventory/verdict-projectviews.md:28`（nodes）、`:36`（project-view）、`:33`（command）。

基准树：`D:\Backup\Downloads\intellij-community-master\intellij-community-master`（全部坐标本轮亲手打开过）。

---

## 0. 接手时的实况（先盘点，不重做、不推翻）

- `node --test tests/pv-*.test.mjs tests/project-tree*.test.mjs` 接手时 **36 项全绿**（不是在途红）。
- 上一轮**已经做完**的（我核过代码与测试，本轮不重复实现）：
  | 文件 | 承接的上游 | 关键坐标 |
  |---|---|---|
  | `src/pvCommandProcessor.ts` 394 行 | `CommandProcessor`/`CommandMerger`/`UndoableGroup`/`UndoRedoStacksHolder`/`CannotUndoReportDialog` | 合并规则 `CommandMerger:31-33,77,97-101`、可用性 `:56-69`、倒序撤 `UndoableGroup:264`、栈深 `registry.properties:20/22`、菜单文本 `UndoManagerImpl:354-372` + zh `ActionsBundle.properties:2522-2524` |
  | `src/pvFileUndoProvider.ts` 217 行 | `FileUndoProvider`（删除/复制/移动的可撤步骤、编码与 BOM 原样、整棵子树 >200 文件标不可撤） | `FileUndoProvider.java:107-108,116-124,189-193` |
  | `src/explorerActions.ts:100-114` | 粘贴副本 / 剪切粘贴登记为可撤命令 | 同上 |
  | `src/components/FileTree.vue:140-162` | 树焦点下 `Ctrl+Z`/`Ctrl+Shift+Z` 走命令栈（不是编辑器文本撤销）、`Shift+F6` 改名 | `$default.xml:232-235,685-688,996-998` |
  | `src/projectTreeNesting.ts` 141 行 / `src/projectTreeNestingDialog.ts` 97 行 / `src/components/FileNestingSettings.vue` 118 行 | `FileNestingBuilder`/`NestingTreeStructureProvider`/`FileNestingInProjectViewDialog` 的规则与对话框 | `FileNestingInProjectViewDialog.java:76,92-98,170-177,185-208,235-245` |
  | `src/projectTreeModel.ts`/`projectTreeSort.ts`/`projectTreeState.ts`/`projectTreeDecorations.ts`/`projectViewBehavior.ts`/`ProjectViewSortSettings.vue`/`FileTree.vue` | 树模型、`GroupByTypeComparator`、折叠持久化、`ProjectViewNodeDecorator`、三条齿轮行为 | `intellij.platform.projectView.xml:44-55,106-130` |
- 上一轮**留下的破损**（本轮修的）：
  1. `FileNestingSettings.vue` 零引用 —— 判词里「本仓 `createProjectTreeModel` 没有设置页给 `nestingRules` 喂值，
     只用 `DEFAULT_NESTING_RULES`」正是这一条：对话框写完了，但既没入口，模型也拿不到宿主那份规则表。
  2. `src/projectTreeModel.ts:87` 的 `listingFor`：**顶层文件的嵌套从来不起作用**。
     原实现是 `if (slash < 0) return roots()`，而有项目根行时 `roots()` 返回的是 `[项目行, 合成行]`，
     不是项目行**下面**那层列表 ⇒ `hasNested('main.ts')` 恒 false、`toggle` 直接 return（父行点开不出子文件）。
     已按两种树形分开取（`hasProjectRoot() ? descendants('') : roots()`），并补了判据测试。
  3. 嵌套对话框的开关是「一改就写设置」，而上游 `ConfigureFilesNestingAction.kt:54-57` 是
     `dialog.reset(…)` → `showAndGet()` → 才 `dialog.apply { view.setUseFileNestingRules(it) }`：
     「取消」应当什么都不写。已改成本地 `enabledNow`，只在「确定」时落盘；规则面板禁用态仍跟着本地开关
     （`FileNestingInProjectViewDialog.java:76`）。
  4. `src/explorerActions.ts:107` 的注释指向 `docs/wiring-requests-2026-10-06-bucket14.md` —— 该文件从未被写出。
     已把指针订正到本桶的接线请求文件（W3），并留了改动痕。

---

## 1. 判词（族 / 项 / 判定 / 上游 / 本仓 / 说明）

| 族 | 项 | 判定 | 上游依据（相对路径:行号） | 本仓落点（文件:行号） | 说明 |
|---|---|---|---|---|---|
| pv/project-view-nodes | 可编辑的文件嵌套规则（`ProjectView.FileNesting` = `ConfigureFilesNestingAction`） | `[x]` 本轮接线完成 | `platform/projectView/shared/resources/intellij.platform.projectView.xml:101-102`；`platform/projectView/shared/src/actions/ConfigureFilesNestingAction.kt:30-32,38-47,54-58` | `src/components/ProjectViewSortSettings.vue:29,36-39,56`；`src/projectTreeState.ts:18,39-46,106,117`；`src/components/FileTree.vue:35,44,51`；`src/projectTreeModel.ts:109`（`nestSiblings(entries, nestingRules())`） | 齿轮 → 「文件嵌套…」→ 对话框 → `updateNesting` → 模型整树重建。反查表 `projectTreeHostFor` 找不到宿主时**整格不渲染**（照上游 `isEnabledAndVisible=false`），不是画个点了没反应的项 |
| pv/project-view-nodes | 嵌套开关关掉 ⇒ 谁也不嵌谁 | `[x]` | `platform/lang-impl/src/com/intellij/ide/projectView/ProjectViewSettings.java:29-31`（`isUseFileNestingRules()` 直接 `return true`，关掉即整条 `NestingTreeStructureProvider` 不套） | `src/components/FileTree.vue:44`（关 ⇒ 交一张空规则表） | 判据 `tests/project-tree-appearance.test.mjs`「嵌套规则由设置页喂进来」第 3 段 |
| pv/project-view-nodes | 顶层文件嵌套不可展开的 bug | `[x]` 修 | `platform/lang-impl/src/com/intellij/ide/projectView/impl/nodes/FileNodeWithNestedFileNodes.java`（在 impl/nodes 目录实测存在） | `src/projectTreeModel.ts:87` | 见 §0-2 |
| pv/project-view-nodes | 规则表编辑的校验/重置默认 | `[x]`（上一轮已做，本轮改落盘时机） | `FileNestingInProjectViewDialog.java:92-98,100-119,143,159,170-177,185-208,235-245`；`CombinedNestingRule:248-256` | `src/components/FileNestingSettings.vue:36,49,64,67`；`src/projectTreeNestingDialog.ts` | 上/下移两格上游被关掉（`:114`），本仓也没有 |
| pv/project-view | **压缩目录 `ProjectView.CompactDirectories`** | `[x]` 本轮新增 | 注册 `intellij.platform.projectView.xml:98-99`；文案 `platform/platform-resources-en/src/messages/ActionsBundle.properties:1459-1460`（zh 包同键「压缩目录」）；默认 false `platform/editor-ui-api/src/com/intellij/ide/util/treeView/NodeOptions.java:41-43`；合并 while `platform/lang-impl/src/com/intellij/ide/scopeView/ScopeViewTreeModel.java:595-608`；`getSingleDirectory` `:657-661`；显示名用 `VFS_SEPARATOR_CHAR` 连 `:789-792` | `src/projectTreeCompactDirs.ts:32,35,54,61,70,87`；`src/projectTreeModel.ts:56-57,58-79,81-83,189,360,380`；`src/projectTreeState.ts:12,14`；`src/components/ProjectViewSortSettings.vue:39`；`src/components/FileTree.vue:45` | 行代表**最深那一格**（与上游 `mapper.apply(parent, child, icon)` 一致），名字是整条链 `src/components/ui`；图标半程（`:598-606` 的 `icon.equals(iconNext)`/`isPackage`）在无 PSI 的本仓恒成立，写在模块头 |
| pv/project-view | 齿轮三组的**成员与次序** | `[x]` 本轮补 Appearance 组 | `intellij.platform.projectView.xml:44-55`（Behavior）、`:56-105`（Appearance）、`:106-130`（Sort）；Behavior 组已在（上一轮） | `src/components/ProjectViewSortSettings.vue:36`（外观）排在 `:41`（排序）之前 | 同组件里两组顺序照上游；`ManualOrder`（`:107-109`）与两条 `SortByTime*`（`:119-126`）没做：`Entry` 无 mtime、也没有手工排序持久位 |
| pv/project-view | `MarkRootGroup` / `MarkAsContentRootAction`（右键「将目录标记为」） | `[~]` 模型+动作已做，菜单待接线（W1） | 组本体 `platform/lang-impl/resources/intellij.platform.lang.impl.actions.xml:252-253`；挂点 `platform/platform-impl/resources/idea/LangActions.xml:475`；成员次序 `idea/customization/min/resources/intellij.platform.customization.min.xml:61-67`；两种组标题 `MarkRootGroup.java:16-22` + `isFilesOnlySelection:24-32`；「未排除」要求当前已排除 `MarkAsContentRootAction.kt:20-31`；动态标题 `UnmarkRootAction.java:26-41,44-55,90`；文案 `ActionsBundle.properties:1862-1865,1871-1872` + zh `LangBundle` 的 `mark.as.unmark{,.excluded,.several}` | `src/pvMarkRoots.ts:64,84,90,109,143,178`；`src/treeActions.ts:16,57,156,162,168,188` | 写回用本仓真有的两份表：`ProjectSettings.excludedDirs`（`src/settingsModel.ts:102`）与 `java.sourcePaths`（`:66-68`），走既有 `project.settings.update`（同 `treeActions.ts` 的 `associateFileType`）。**纯文件选区整格不渲染**（本仓两种标记都只作用在目录上） |
| pv/project-view | 排除的粒度 | 架构不等价，如实偏离 | 上游按路径记 `ContentEntry.addExcludeFolder`（`MarkExcludeRootAction.java:49-51`） | `src/pvMarkRoots.ts` 模块头 + `markRootPatch` 写 `target.name` | 本仓 `excludedDirs` 是**目录名表**：命中口径 `src/projectRoots.ts:64-70`（任一目录段等于名字），搜索侧还丢掉带分隔符的条目（`src/searchExclusions.ts:18-27`）。所以标的是名字、影响同名所有目录 —— 判据测试钉住了这条 |
| pv/project-view | 多窗格项目视图（`SplitProjectViewUtil` 左右双窗格 / Attach to Pane） | **有意不做** | `intellij.platform.projectView.xml:29-34` 三条注册表键 `project.view.toolwindow.split` / `.monolith` / `.remdev` **defaultValue="false"** | —— | 上游默认档就是关的实验特性，普通用户看不见；不是本仓缺的功能。判词把它列为「缺」已过期 |
| pv/project-view | `CustomizeTreesAction` 窗格定制 | 做不到 | `platform/lang-impl/src/com/intellij/ide/projectView/impl/CustomizeTreesAction.kt`（实测存在）；EP 侧 `AttachableProjectViewPane.java`、`ProjectViewPane.java` | —— | 具体卡点：这一格的内容是「列出所有 `ProjectViewPane` 贡献点并勾选哪个窗格可见」。本仓没有窗格注册表 —— 两棵树各自挂在 `ToolWindowView.vue` 与 `ScopesSettingsPage.vue` 上，没有「哪个窗格可见」这个可写对象；画出来就是一排没有后端能改的复选框（违反「不放假控件」） |
| pv/project-view | `ProjectViewPreloadMode` / `ProjectViewPerformanceMonitor` | 有意不做 | `platform/lang-impl/src/com/intellij/ide/projectView/impl/ProjectViewPreloadMode.kt`、`ProjectViewPerformanceMonitor.kt`、`ProjectViewDirectoryExpandDurationMeasurer.java`（三份实测存在） | —— | 预加载的对象是 Swing 树节点（本仓的行是 `computed` 出来的扁平表，没有可预载的 UI 对象）；性能面板量的是**节点构建耗时**，本仓展开耗时是 `workspace.list` 的桥往返，指标不可比，照抄只会做一个假数字面板 |
| pv/project-view-nodes | 包视图（`PackageViewPaneModel`/`ClassesTreeStructureProvider` 的 flatten / compact middle packages） | 做不到 | `ScopeViewTreeModel.java:285-297`（`flattenPackages` 先问 `ProjectFileIndex.getSourceRootForFile`）、`:603-605`+`:634-…`（`visitPackages`、`AllIcons.Nodes.Package`）、`ProjectViewSettings.java:179-190`（`isCompactDirectories`/`isHideEmptyMiddlePackages` 都要 `ProjectViewDirectoryHelper`） | —— | 具体卡点：`Entry`（`src/bridge.ts` 的 `workspace.list` 载荷）只有 `{path,name,kind}`，没有「这个目录是不是源根下的包」的判定；本仓也没有 PSI。压缩目录那条能用 `/` 连起来是因为它只看「唯一子目录」，包那套要的是**包名语义**（`.` 分隔、`isPackage(icon)`、空中间包合并），按目录名猜就成假功能 |
| pv/project-view-nodes | 模块分组（`ModuleGroup`/`MoveModuleToGroup`/`ModuleListNode`） | 做不到 | `platform/lang-impl/src/com/intellij/ide/projectView/impl/ModuleGroup.java`、`MoveModuleToGroup.java`、`impl/nodes/ModuleListNode.java`、`ModuleGroupingTreeHelper.kt`（四份实测存在） | —— | 要改的是模块模型（`.iml` / workspace model 的 `ModuleGroup`），本仓项目模型只有 `ProjectSettings` 那张表；且写回通道不在桶 14 名下（根与模块在桶 15：`src/projectRoots.ts`/`projectFileIndex.ts`），`src/bridge.ts:109` 的 Method union 里没有任何 module 写回方法 |
| pv/project-view-nodes | Detach / Attach 库（`DetachLibraryDeleteProvider`） | 做不到 | `platform/lang-impl/src/com/intellij/ide/projectView/impl/DetachLibraryDeleteProvider.java`（实测存在） | —— | 删的是 `Library` 对象（写回 `.iml`）。本仓的外部库行是 `src/externalLibraries.ts`（不在我名下）造的**合成行**，`src/projectTreeModel.ts:160-166` 对 NUL 前缀路径明令「无文件系统能力」直接返回空列表；桥里也没有 `library.detach` 这一类方法 |
| pv/project-view-nodes | 同一文件多 pane 呈现（`ProjectFileNode`） | 做不到 | `ScopeViewTreeModel.java:598,603,608,657-661`（`ProjectFileNode` 是**窗格模型**里的节点类型，带 `getPackageName()`/`compacted` 两份状态：`:780-792`） | —— | 它存在的理由是「同一份文件在多个窗格/作用域里各有一份呈现」；本仓单窗格（上一条已论证多窗格在上游默认关），`ProjectTreeRow` 只有 `{entry,level,parent,synthetic,nested}`，没有按窗格分叉的呈现位 |
| pv/project-view-nodes | 就地注释（`ProjectViewInplaceCommentProducerImpl`） | 做不到 | `platform/lang-impl/src/com/intellij/ide/projectView/impl/ProjectViewInplaceCommentProducerImpl.kt`（实测存在）；开关项 `intellij.platform.projectView.xml:85` `<reference ref="ViewInplaceComments"/>` | —— | 两层都不成立：① 数据来自 `projectViewInplaceCommentProducer` EP 的插件贡献，本仓没有 EP 宿主；② 呈现要在树行右侧就地编辑（`TreeInplaceUpdater` 那套），本仓的行是一个 `<button>`（`src/components/FileTree.vue` 模板），就地输入框会吃掉键盘导航那半区。`git.blame` 给的是逐行提交，不是「一个节点一条注释」 |
| pv/command | 跨文件全局撤销栈 / 命令合并 / 不可撤报告 | `[x]`（上一轮已做，本轮回归通过） | `UndoManagerImpl.java`（`platform/platform-impl/src/com/intellij/openapi/command/impl/`，本轮实测路径）、`CommandMerger:31-33,56-69,77,97-101`、`UndoableGroup:195-199,201-210,264`、`registry.properties:20,22` | `src/pvCommandProcessor.ts:43-47,134-171,296-331,340-382` | —— |
| pv/command | 「撤销历史列表」（判词与任务书里那一项） | **无法核实**（判词过期） | 本轮实测：`platform/platform-impl/src/com/intellij/openapi/command/impl/UndoManagerImpl.java` 里 `getHistory` / `Collection<CommandGroup>` **0 命中**；`platform/analysis-api/src/com/intellij/openapi/command/undo/UndoManager.java` 里 `getHistory` 0 命中；整个 `platform/` 里 `HistoryListPopup` 0 命中（`find -name "*HistoryListPopup*"` 也无）。用户可见面只有单条「撤消{0}/重做{0}」：`UndoManagerImpl:354-372` + zh `ActionsBundle.properties:2522-2524` | `src/pvCommandProcessor.ts:165-171`（`commandMenuText`）、`src/components/FileTree.vue:140-146` | 按取证口径三条路都走过（文件名 / 包路径 / 语义 + XML 的 `id`），指不到上游有多条撤销历史的可见 UI ⇒ 不做（本仓的栈内容仍可由 `size()`/`state` 观察，但不是「画一排假项」） |
| pv/command | `StartMarkAction` / `ChangeRange` 的命令标记 | 做不到 | `platform/platform-impl/src/com/intellij/openapi/command/impl/StartMarkAction.java`（143 行，实测）、`platform/lvcs-impl/src/com/intellij/openapi/command/impl/ChangeRange.java`（实测路径） | —— | 具体卡点：这一对管的是**单一文档的文本撤销边界**（一次 Ctrl+Z 撤掉多大一段），本仓那一层在 CodeMirror `history` 实例内部（`src/components/CodeEditor.vue` 的 `basicSetup`，保留文件），没有可插 `UndoProvider` 的注册点；跨文件那一层的标记已经落在本仓命令栈上（`groupId`/`global` 就是它的等价物） |

---

## 2. 改动文件

**新增**
- `src/projectTreeCompactDirs.ts`（93 行）—— 压缩目录的纯规则：`singleDirectoryChild` / `compactChainOf` /
  `compactName` / `compactListing`；模块头逐条写上游坐标与两条不等价（链只用缓存、链深上限防符号链接环）。
- `src/pvMarkRoots.ts`（185 行）—— `MarkRootGroup` 的组标题、成员与可见性、写回表、提示语。
- `tests/project-tree-appearance.test.mjs`（217 行，12 项）
- `tests/pv-mark-roots.test.mjs`（94 行，5 项）
- `docs/batch-2026-10-06-bucket14a.md`（本文件）、`docs/wiring-requests-2026-10-06-bucket14a.md`

**修改**
- `src/projectTreeSort.ts:16-20` —— 设置里加 `compactDirectories?: boolean`（可选字段 + 读时补默认，旧存档不判损坏）。
- `src/projectTreeState.ts:12,14,18,39-46,55-57,98-106,117-122` —— 默认档 false、进 `BOOLEAN_KEYS` 读写、
  `ProjectTreeHost` 显式接口、`bySettings` 反查表 + `projectTreeHostFor()`。
- `src/projectTreeModel.ts:4,17-19,52-83,87-92,105-112,160-196,340-360,375-382` —— `compactDirs` 选项、
  `resolveChain`/`resolveChainsFor`/`compactOf`、`fetch`+`load` 拆开（链只读缓存不级联预取）、行渲染走合并视图、
  `refresh` 保住合并行的展开态、`listingFor` 顶层修正、`reset` 清链。
- `src/components/FileTree.vue:31-53` —— 把宿主那份 `nesting.enabled`/`nesting.rules` 与 `compactDirectories` 喂进模型，
  设置变更时整树重建（`ConfigureFilesNestingAction.kt:58` 的等价物）。
- `src/components/ProjectViewSortSettings.vue`（24→63 行，整文件重写）—— Appearance 组排在 Sort 组之前、
  「文件嵌套…」「压缩目录」两格、`FileNestingSettings.vue` 的宿主、取不到宿主就整组不渲染。
- `src/components/FileNestingSettings.vue:32-38,49-56,64,67` —— 开关与规则表只在「确定」时落盘。
- `src/treeActions.ts:16,52-58,152-190` —— `markRootMenu`/`applyMarkRoot` 两个入口 + 可选 `refreshTree` 依赖。
- `src/explorerActions.ts:105-110` —— 只订正那条指向不存在文件的注释（不改行为）。

**没有动**：`src/App.vue`、`src/components/CodeEditor.vue`、`style.css`/`tokens.css`、`uiIcons.ts`、
`settingsModel.ts`/`settingsTreeMeta.ts`、`bridge*`、`keymap*`、`actionRegistry.ts`、`menus/types.ts`、
`tests/module-size.test.mjs`、`tests/source-citations.test.mjs`、`CMakeLists.txt`、以及 14b/14c/桶 13/15 名下文件。
`git diff --stat` 自查过：`FileTree.vue`/`projectTreeModel.ts`/`projectTreeState.ts`/`treeActions.ts` 里
**混有上一轮未提交的 hunk**（同一棵树 900+ 处未提交），我没有覆盖它们，只在自己的 hunk 上追加；
本轮的净增量是 §0 与上面列的这些行。

---

## 3. 验证

- 域测试（只跑自己域，没跑全量 `npm test`）：
  `node --test tests/pv-*.test.mjs tests/project-tree*.test.mjs tests/project-view-behavior.test.mjs tests/tree-rename-key.test.mjs`
  → **65 项全绿 / 0 失败**（接手时同一批是 36 项；新增 29 项里含本轮两份新测试文件 17 项）。
  单跑：`tests/project-tree-appearance.test.mjs` 12/12、`tests/pv-mark-roots.test.mjs` 5/5。
- 类型：`npx vue-tsc -b --force` → **我名下 0 错**；全仓剩 1 条
  `src/customFoldingProviders.ts:48 TS1002 Unterminated string literal`（桶外文件，别人在途现场，未动）。
- 三条系统性禁令检测器：`find-param-props.mjs` → 共 0 处；`find-ts-in-mjs.mjs` → 干净（纯 JS）；
  `find-missing-ext.mjs` → 干净（扫 1122 个文件）。
- 死模块门禁：`node .tools/find-orphan-modules.mjs --gate` → 我名下**没有零消费方模块**；
  `src/components/FileNestingSettings.vue` 从「完全无引用」变成 `✔ 已接上（可以更新基线）`
  （门禁总数从接手时的 34 降到 17，其余新增项都在别的桶名下）。
- 模块上限：`tests/module-size.test.mjs` 的 900 行默认上限没被触碰；新/改文件最大 388 行（`projectTreeModel.ts`）。
- 无 native 改动 ⇒ 不跑 ctest（`.tools/nctest-all.bat` 不适用）。

### 反向验证记录（每条新门禁都注入过违规，确认真会变红后撤掉）

| 注入 | 位置 | 期望 | 实测 |
|---|---|---|---|
| 默认档改成开 | `src/projectTreeState.ts:12` `compactDirectories: false` → `true` | 「compactDirectories 存进项目视图设置：默认关…」红 | ✖ 红 |
| 摘掉嵌套规则接线 | 删 `src/components/FileTree.vue` 的 `nestingRules: …` 整行 | 「编辑嵌套规则真的落回模型」红 | ✖ 红 |
| 摘掉链深上限 | `projectTreeCompactDirs.ts` 的 `while (names.length < MAX_COMPACT_CHAIN)` → `while (true)` | 「链深上限…」红（且耗时 4.7s，说明确实在死循环） | ✖ 红 |
| 改坏「已排除」判据 | `pvMarkRoots.ts` 的 `if (noneExcluded)` → `if (!allExcluded)` | 「成员与可见性…」红（混选区那条不再为空表） | ✖ 红 |
| 摘掉生产入口 | 删 `treeActions.ts` 返回里的 `markRootMenu, applyMarkRoot,` | 「接线：treeActions 是这一格的宿主入口」红 | ✖ 红 |

五处注入全部把对应门禁打红；撤掉后 `tests/project-tree-appearance.test.mjs` 12/12、
`tests/pv-mark-roots.test.mjs` 5/5 重新全绿（`git diff` 核对过三个文件已逐字还原，
还原用的是 `/tmp` 里的副本，**没有**用任何 `git checkout/reset/stash/clean`）。

---

## 4. 做不到 / 无法核实（汇总，理由见 §1 表内）

- 无法核实：上游的「撤销历史列表」UI 面（三条路都搜过，见 §1 pv/command 行）。
  本仓已做的是单条「撤消{0}/重做{0}」菜单文本 + 树内 `Ctrl+Z`/`Ctrl+Shift+Z`。
- 有意不做（不是缺功能）：多窗格项目视图（上游注册表默认 `false`，`intellij.platform.projectView.xml:29-34`）、
  `ProjectViewPreloadMode`/`PerformanceMonitor`（指标不可比，做出来是假面板）。
- 做不到（架构/后端不成立，逐条给了缺的那一层）：包视图 flatten/compact packages（无 PSI/源根判定）、
  模块分组（无模块模型与写回通道）、`CustomizeTreesAction`（无窗格 EP 注册表）、
  `ProjectFileNode` 多窗格呈现、Detach/Attach 库（合成行无 IO 能力 + 桥无方法）、
  就地注释（无 EP 宿主 + 行渲染契约不容纳就地编辑）、`StartMarkAction`/`ChangeRange`（文本撤销在 CodeMirror 实例内，宿主文件冻结）。
- 待接线（不是做不到）：右键「将目录标记为」那一格的渲染 + `refreshTree` 实参 →
  `docs/wiring-requests-2026-10-06-bucket14a.md` 的 W1/W2；移动撤销要连引用改写一起撤（上一轮漏登记的那条）→ 同文件 W3。
