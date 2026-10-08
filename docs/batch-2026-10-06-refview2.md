# batch-2026-10-06-refview2 — 用法树行模型（#219 / W-3 模块侧）

范围：只做**模块侧纯模型 + 能失败的判据**；不加 UI 控件；需要宿主/保留文件配合的写 `docs/wiring-requests-2026-10-06-refview2.md`。
上游参考树（唯一可用）：`D:\Backup\Downloads\intellij-community-master\intellij-community-master`。
黑名单/禁区按任务书执行：`src/App.vue`、`src/bridge.ts`、`src/components/CodeEditor.vue`、`native/main.cpp`、`scripts/verdict_table.py`、`docs/inventory/*` 只读；并发黑名单文件只读。

## 1. 上游真身坐标（自己 find/打开，全部为本轮逐行开过的行号）

参考树 = `D:\Backup\Downloads\intellij-community-master\intellij-community-master`。

**订正留痕（假坐标，先前别的 lane / 本仓模块头写过的）**：
- `UsageViewTreeStructure` —— `find` 整棵树（`-iname "*UsageViewTreeStructure*"`）**零命中**，这个类名在本参考树里不存在。真身是
  `platform/usageView-impl/src/com/intellij/usages/impl/` 下的 `Node.java` / `GroupNode.java` / `UsageNode.java` /
  `UsageTargetNode.java` / `UsageViewTreeModelBuilder.java` / `UsageViewImpl.java`（`impl/tree/` 这个子目录同样不存在）。
- `UsageViewTreeStructureProvider` —— `src/usageViewGrouping.ts` 模块头第 2 行原来写的是
  「上游 `platform/lang-impl/src/com/intellij/usageView/`：`UsageViewImpl` 的树按 目录/包/文件 分组
  （`UsageViewTreeStructureProvider` 一族）」：两条都是假的 —— 该类 `find` 零命中；`UsageViewImpl` 住在
  `platform/usageView-impl/src/com/intellij/usages/impl/`（`platform/lang-impl/src/com/intellij/usageView/impl/` 里
  实际只有 `SelectInEditorHandler.java`、`UsageContextCallHierarchyPanel.java`、`UsageViewContentManagerImpl.java`、
  `OWNERSHIP`、`package-info.java`）。本轮已在模块头改成真坐标。

### 1.1 分组顺序（层与层之间、同一层之内）

| 事 | 上游坐标 | 内容 |
| --- | --- | --- |
| 层的先后（档与档） | `platform/usageView-impl/src/com/intellij/usages/impl/rules/UsageGroupingRulesDefaultRanks.java:7-34` | `NON_CODE=0`、`SCOPE=100`、`USAGE_TYPE=200`、`MODULE=300`、`DIRECTORY_STRUCTURE=400`、`FILE_STRUCTURE=500`；`UsageViewImpl.java:940-944` 拿到活动规则后 `list.sort(Comparator.comparingInt(rule -> rule.getRank()))` |
| 哪几档在场 | `platform/usageView-impl/src/com/intellij/usages/impl/rules/ActiveRules.java:31-68` | 每档都是一个 `if (usageViewSettings.isGroupByXxx())`；`:56-58` 目录结构、`:59-63` 文件结构（成员层）、`:64-66` **否则**才放 `FileGroupingRule`（⇒ 成员层开着时文件那一档由 provider 那一族带着，两档互斥） |
| 同一父节点下的先后 | `impl/GroupNode.java:317-348`（`NodeComparator`） | 先按**节点种类**：`ClassIndex {UNKNOWN, USAGE_TARGET, GROUP, USAGE}`（`:318`）⇒ 目标行在组行之前、组行在用法行之前 |
| 组与组之间 | `impl/GroupNode.java:350-357` + `impl/rules/UsageGroupBase.java:15-23` | 先比 `myRuleIndex`（= 第几档），再比 `UsageGroup.compareTo` = `myOrder`（装档顺序）→ `getPresentableGroupText().compareToIgnoreCase(...)`（`UsageGroupBase.java:23`） |
| 用法与用法之间 | `impl/UsageNode.java:27-30` → `impl/UsageViewImpl.java:207-219` | `USAGE_COMPARATOR_BY_FILE_AND_OFFSET`：先 `getUsagePriority`，再 文件 → offset |
| 插入方式 | `impl/GroupNode.java:99-120`、`:264-288` | `Collections.binarySearch(children, newNode, COMPARATOR)`；命中已有节点就**复用**（`i>=0` 那两支），不重复建节点 |
| 成员层的两档顺序 | `java/java-impl/src/com/intellij/usages/impl/rules/ClassGroupingRule.java:44`、`MethodGroupingRule.java:50`；同级比较 `ClassGroupingRule.java:178`、`MethodGroupingRule.java:180`（都是 `compareToIgnoreCase`） | 类与方法各是一条 `FileStructureGroupRuleProvider`（`impl/FileStructureGroupRuleProvider.java:14-23`，EP `com.intellij.fileStructureGroupRuleProvider`），注册顺序决定层序（本仓模块头钉的是 `JavaPlugin.xml:566-567` 类在前） |

### 1.2 节点 id

上游**没有**字符串 id：节点身份 = `DefaultMutableTreeNode` 对象本身 + `userObject`（`impl/Node.java:19`、
`impl/GroupNode.java:48-52`、`impl/UsageNode.java:16-20`）。去重靠 `NodeComparator` 的比较结果
（`GroupNode.java:105-107` / `:276-280`「同一条 Usage 再进来就复用已有节点」），路径靠 `TreePath`
（`UsageViewImpl.java:1271-1288` 的 `pathFrom.pathByAddingChild(child)`）。
**档的 id** 倒是有：`UsageGroupingRuleEx.getId()` 默认取实现类的类名
（`platform/usageView/src/com/intellij/usages/rules/UsageGroupingRuleEx.java:16`，
`ActiveRules.java:124-142` 的包装器 `getId()` 也是 `myGroupingRule.getClass().getName()`）。
⇒ 本仓行模型必须自造稳定键（`usageGroupKey(kind, path)`，`src/usageViewGrouping.ts:404-406`），
这一点是**架构不等价**，不是上游也有键。

### 1.3 展开态存哪儿（两处分开的）

1. **运行时、重建时沿用**（本批要承接的就是这一条）：`impl/UsageViewImpl.java`
   - `:1221-1262` `rulesChangedImpl()`：换档 = 重建树。先 `captureUsagesExpandState(new TreePath(root), states)`（`:1229`），
     `reset()`（`:1235`）、装新规则（`:1236-1240`）、按 `USAGE_COMPARATOR_BY_FILE_AND_OFFSET` 逆序整批重放
     （`:1242-1256`），然后 `expandTreeAfterReset()`（`:1258`）→ `excludeUsages` → `restoreUsageExpandState(states)`（`:1261`）。
   - `:1270-1288` `captureUsagesExpandState`：**只往"当前是展开的"路径里递归**（`:1272` `if (!myTree.isExpanded(pathFrom)) return;`），
     收集的是**已经看得见的用法叶子**（`:1281-1284` `states.add(new UsageState(usage, isSelected))`），
     非叶子的兄弟继续往下钻（`:1285-1287`）。
   - `:1291-1307` `restoreUsageExpandState`：先**根下那一层的每个 `GroupNode` 一律展开**（`:1293` 注释
     `//always expand the last level group`、`:1296-1302`），再把每条捕获到的叶子**它自己的父组**加进展开集
     （`:2429-2443` 的 `UsageState.restore`：`myUsageNodes.get(usage)` → `node.getParent()` → `addExpandedPath`，
     选中的那条另记 `addSelectedPath`）；最后 `treeState.applyTo(myTree)`（`:1306`）。
   - 默认展开深度：`:1313-1319` `expandTree(levels)` / `expandTreeAfterReset() = expandTree(2)`；
     `:1345-1347` `expandRoot() = expandTree(1)`。
   - 落盘的**不是**逐节点展开态：`com.intellij.ui.SmartExpander`（`:951` 装的）与 `TreeExpansionListener`
     （`:959-978`，展开时才 `checkNodeValidity` 补算失效节点）都是运行时对象。
2. **持久化那一档**：`platform/usageView/src/com/intellij/usages/UsageViewSettings.kt:63-64`
   `@get:OptionTag("IS_EXPANDED") var isExpanded: Boolean by property(false)`（`@State(name = "UsageViewSettings",
   storages = [Storage("usageView.xml")])`，同文件 `:19`）—— **只存这一个布尔**，写它的两处是
   `UsageViewImpl.java:344-347`（`treeExpander.expandAll()` 里 `setExpanded(true)`）与
   `:353-358`（`collapseAll(3)` 里 `setExpanded(false)`）；读它的一处是 `:1875-1877`
   （结果回来时 `if (getUsageViewSettings().isExpanded() && myUsageNodes.size() < 10000) expandAll();`）。
   ⇒ 「上次是全展开还是全折叠」是**应用级**的一档，逐节点的展开态不落盘。
3. 工具条那两个动作：`UsageViewImpl.java:1081-1082`（`createExpandAllAction` / `createCollapseAllAction`，
   本体 `:1309-1311` `expandAll()`、`:1338-1343` `collapseAll(keepSelectionLevel)` = `TreeUtil.collapseAll` + `expandRow(0)`）。

### 1.4 计数怎么算

- 记的是**递归合计**，而且是**增量维护**而不是重算：`impl/GroupNode.java:45` `private int myRecursiveUsageCount`
  （EDT only），`:290-299` `incrementUsageCount(int i)` 从自己一路往上加到根
  （`while (true) { groupNode.myRecursiveUsageCount += i; parent instanceof GroupNode || return }`）；
  `:226`（`removeUsagesBulk`）按删除条数反向扣，扣完非零才 `treeModel.nodeChanged(this)`（`:226-228`）。
- 读的一处：`:363-366` `getRecursiveUsageCount()`。
- 屏上：`impl/UsageViewTreeCellRenderer.java:95-98`（组行的计数 = 递归合计）；plain text 里也带它
  （同文件 `:188-197`，速度搜索取的就是这一串）。
- 导出：`impl/ExporterToTextFile.java:57-63` —— 组行 = 呈现文本 + `" (" + usages.n(count) + ")"`；
  整棵树按 `:31-47` 递归，每层缩进 4 空格（`:35`），根不写（`:34`、`:38-40`）。
- 「直接挂在本节点的那一份」另有其账：`impl/GroupNode.java:409-417` `getUsageNodes()`（本节点直接的用法节点）
  与 `:399-407` `getSubGroups()`（本节点直接的子组）⇒ 递归合计 = 直接 + 各子组递归，**同级互不重叠**。

## 2. 仓内现状（引用面板已经有的）

- `src/usageViewGrouping.ts`（本轮 667 行，上限 900）：`buildUsageTree`（目录/文件/类/方法四档 + `count` = 子树合计）、
  `flattenUsageTree`（行模型 `UsageTreeRow`：`key`/`depth`/`label`/`detail`/`collapsed`/`collapsible`）、
  `usageGroupKey`、`allUsageGroupKeys`、`filterUsageTree`、`usageRowsForQuery`、`exportUsageTreeText`（缩进树）、
  `exportUsagesText`（`path:line` 平表）。
- `src/referenceContents.ts`（332 行）：折叠集 `collapsedUsageGroups: Record<contentId, string[]>`（**只在内存里，
  只增不减**：`toggleUsageGroup` 追加、`collapseAllUsageGroups` 整批写、只有关掉那条内容才 `forgetUsageGroups`）。
- 生产链路已在：`App.vue`（冻结）→ `src/toolViewContext.ts:201-208` → `ToolWindowView.vue:220` → `components/ReferencePanel.vue`
  （`referenceRows` / `toggleUsageGroup` / `collapseAll` / `expandAll` / `speedSearch` 五个口子）。
- 齿轮两档在 `src/usageViewGear.ts:79-99`（`usage.groupByDirectory` / `usage.groupByFileStructure`，后者要 `usageSymbolsAvailable()`）。
- 判据现状：`tests/usage-view-grouping.test.mjs`(51)、`tests/usage-view-panel-rows.test.mjs`(399，钉到行序/缩进/计数/折叠/分档)、
  `tests/usage-view-gear.test.mjs`(109)、`tests/reference-panel-host.test.mjs`、`tests/reference-contents.test.mjs`。

**本轮真正的缺口**（其余三件事上游坐标见上，本仓形状已在且有判据）：
1. **展开态沿用**：换档 / 增量结果 / 符号迟到之后，折叠集里的旧键**不清理**（`usage-view-panel-rows.test.mjs:89` 自己就写着
   「否则就是一堆永不命中的垃圾键」，但没有代码去清），也没有「上一次是全展开/全折叠」这一档的沿用
   —— 上游那两条分别在 `UsageViewImpl.java:1270-1307`（capture/restore）与 `UsageViewSettings.kt:63-64`（`IS_EXPANDED`）。
2. **同级计数的可判据形状**：`count` 是子树合计（已在、已钉），但行模型里没有「直接挂本节点的那一份」这一格，
   于是「同级各兄弟加起来正好等于父行」这条不变式（上游 `GroupNode.java:290-299`/`:409-417` 的账）
   只能从 `node.locations` 手工数，没有可对账的模型输出。


## 3. 行模型设计（分组节点 / 文件节点 / 成员节点 / 用法节点）

四档节点 + 叶子，一行一档（`UsageTreeNode.kind` = `directory|file|class|method`，`UsageTreeRow.kind` 多一个 `usage`）：

| 行 | 上游那一档 | 键 | 层级（可见层） | 计数 |
| --- | --- | --- | --- | --- |
| 分组（目录）节点行 | `DirectoryStructureGroupingRule`（rank 400，`ActiveRules.java:56-58`） | `directory\0<相对路径/>` | 只在 `showDirectories` 为真时出现（默认关，`UsageViewSettings.kt:26`） | 子树合计 |
| 文件节点行 | `FileGroupingRule`（rank 500）/ 成员层开着时由 provider 那一族带着（`ActiveRules.java:59-66` 两档互斥） | `file\0<整条相对路径>` | 0（目录关着）/ 目录之下 | 子树合计 |
| 成员节点行（类 / 方法） | `ClassGroupingRule.java:44` / `MethodGroupingRule.java:50`（`FileStructureGroupRuleProvider.java:14-23`） | `class\0<文件#类>`、`method\0<文件#类#方法(参数表)>` | 文件之下 / 类之下 | 子树合计 |
| 用法节点行（叶子） | `UsageNode`（`UsageNode.java:11`；同级比 `USAGE_COMPARATOR_BY_FILE_AND_OFFSET`，`UsageViewImpl.java:207-219`） | `usage\0<路径>\0<行:列>` | 它所属组 +1 | 0（既有语义，别动） |

同级先后：`MEMBER_RANK`（目录<文件<类<方法，`usageViewGrouping.ts:220`）+ `name.localeCompare`
= 上游 `NodeComparator`（种类先、再 `compareToIgnoreCase`，`GroupNode.java:317-348` + `UsageGroupBase.java:23`）——
既有判据钉着（`usage-view-panel-rows.test.mjs:55-64`、`:252-261`），本轮没改。

## 4. 实现落点（本轮新增/改动）

`src/usageViewGrouping.ts`（667 → 786 行，上限 900）：
1. `UsageLevelCount` + `usageLevelCounts(root, options)` —— **同级计数**那张对账表：
   `ownCount`（直接挂本节点，上游 `GroupNode.getUsageNodes()` `:409-417`）、
   `childCount`（各直接子组，上游 `getSubGroups()` `:399-407`）、`count`（子树合计，上游
   `getRecursiveUsageCount()` `:363-366`，`:290-299` 增量维护）+ `parentKey`/`depth`/`kind`。
   表本身走 `flattenUsageTree` 那一趟（键、顺序、层与屏上**同一份遍历**），只补账不重排。
2. `allUsageGroupKeys` 改为取那张表的键列（`collapseAllUsageGroups` 因此与对账表同源）；
   `isUsageGroupRow` 不再是零消费方的死出口（`usageLevelCounts` 用它）。
3. `UsageTreeRow.collapsible` 从硬编码 `true` 改成「真收得住东西才给箭头」
   （`node.children.length > 0 || node.locations.length > 0`）。
4. `UsageExpansionMode`（`expanded` / `collapsed` / `mixed`）+ `carryUsageExpansion(root, options, previous)` —— **展开态沿用**：
   `expanded` ⇒ 空集（含新出现的组，上游 `IS_EXPANDED=true` + `UsageViewImpl.java:1875-1877`）；
   `collapsed` ⇒ 整棵树的键（新出现的组也收起）；`mixed` ⇒ 与当前树的键求**交集**、按树序、去重
   （消失的键不再沿用，上游 `:1272` `if (!myTree.isExpanded(pathFrom)) return;`）。
5. 模块头第 1-3 行的假坐标换成真身（`impl/Node|GroupNode|UsageNode|UsageTargetNode|UsageViewTreeModelBuilder`），
   并把「`UsageViewTreeStructureProvider` 一族」那句原地订正（见 §1 订正留痕）。

`src/referenceContents.ts`（332 → 401 行，上限 900）—— 生产消费方（`toolViewContext.ts:201-208` →
`ToolWindowView.vue:220` → `ReferencePanel.vue`）：
1. 新增应用级那一格 `referencesExpandedAll`（键 `taocode.usagesExpandedAll`，**缺键取默认 false**，
   对齐上游 `UsageViewSettings.kt:63-64` 的 `IS_EXPANDED`；`readStoredFlag` 那一套，旧存档不按字段数判损坏）。
2. 新增每份内容的档位 `usageExpansionModes`（没这一格 = 继承应用级那一格）。
3. `referenceRows` 的折叠集改为 `carriedUsageGroupKeys(...)`（先沿用再渲染）。
4. `watch(referenceUsageTree, …, { flush: 'sync' })`：树一重建就把存储里那份折叠集收成"还在树里的"，
   清掉垃圾键。**`flush:'sync'` 不是随手写的**——宿主与判据都是同步读 `referenceRows`，
   默认 pre-flush 会让同一 tick 内的两次写入只看到最后一次，垃圾键清不掉（这条被自己的判据测红过，见 §5 探针）。
5. `toggleUsageGroup` 先取渲染中那份再改，并把该条内容置成 `mixed`（上游逐节点展开不写 `IS_EXPANDED`）。
6. `expandAllUsageGroups` ⇒ 该条置 `expanded`、写 `referencesExpandedAll=true`；
   `collapseAllUsageGroups` ⇒ 该条置 `collapsed`、写 `false`（上游 `:346`/`:357` 那两笔）。
7. `forgetUsageGroups` 连档位一起丢；`resetReferences` 清内容与档位、**留着**应用级那一格。

**没有新增任何 UI 控件**：`ReferencePanel.vue`、`ToolWindowView.vue`、`usageViewGear.ts` 一行未动。

## 5. 判据（新文件 `tests/usage-view-expansion.test.mjs`，15 条，全绿）

同级计数 3 条 / 展开态沿用（纯模型）4 条 / 面板状态层 7 条 / 行模型箭头 1 条。
关键几条（都能失败，探针见下）：
- `ownCount + childCount === count` 对**每个**组行成立；`parentKey === ''` 那一批的 `count` 之和 == 根 `count`（同级互不重叠）。
- 成员层里类组 `ownCount=1 / childCount=1 / count=2`（直接挂的那条 + 方法子树那条），方法组 `childCount=0`。
- 对账表的键列/层列与 `flattenUsageTree` 的行**逐条相等**（不许两处各数一遍）。
- `mixed` 沿用：消失的键被丢、还在的沿用、新出现的组不收起；`expanded` ⇒ 空集；`collapsed` ⇒ 整棵树的键；
  旧集乱序/带重复 ⇒ 结果按树序且去重；关目录档后旧的目录键不往新形状上贴。
- 面板：折叠一组 → 换一批没有它的结果 → 再换回来 ⇒ **不再沿用**（垃圾键真被清掉了）；
  全部折叠 → 单独放开一组 ⇒ 其余三组仍收起；全部折叠后新结果里新增的文件组**也收起**；
  两个整体动作写的就是 `referencesExpandedAll`，逐组动作不写；新起的一条内容继承那一格；
  关掉一条内容把折叠集与档位一起丢，不牵连别条。

探针（任务书规定的注入前缀只在代码里临时存在、跑完即删；本档不再复写那个字面量，全仓 grep 该前缀 = **0 命中**）：
- 探针 1 = `carryUsageExpansion` 的 `mixed` 一支改成"不求交集"（`return present`）；
  探针 2 = `usageLevelCounts` 的 `ownCount` 改成恒 0（同级账塌掉）。两处同时注入后跑新判据：
  **`tests 15 / pass 7 / fail 8`**，红的正是这 8 条：
  `同级计数：ownCount 数的就是直接挂在本节点上的那些位置`、
  `沿用 mixed：消失的组键就地清掉…`、`沿用给的结果是树序、去重的…`、`沿用认档：目录那一层关掉后…`、
  `面板：换一批结果后那个已经消失的组键被清掉…`、`面板：全部折叠后单独放开一个组…`、
  `面板：关掉一条内容就把它那两份状态一起丢掉…`、`成员层迟到（符号后到）…`。
  撤掉探针后 **`tests 15 / pass 15 / fail 0`**。
- 第三条独立探针（不属于注入，是实现过程中真红过一次的那条）：`watch(referenceUsageTree, …)` 用默认 pre-flush 时
  「面板：换一批结果后那个已经消失的组键被清掉」红（`0 !== 2`）—— 同一 tick 内两次换结果只会在微任务里看到最后一次，
  垃圾键清不掉 ⇒ 改成 `flush: 'sync'`（理由已写进 `src/referenceContents.ts` 那一段注释）。

## 6. 交付实测数字（原始输出）

```
# 交付前跑的那一套（文件名先 ls 确认：reference-contents / reference-panel-host / usage-highlight /
# usage-view-expansion / usage-view-gear / usage-view-grouping / usage-view-panel-rows / module-size）
$ node --test tests/usage-view*.test.mjs tests/reference*.test.mjs tests/usage*.test.mjs tests/module-size.test.mjs
ℹ tests 89
ℹ pass 89
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 4562.0268

# 另加一条同域的既有判据（本轮改了 buildUsageTree 的 collapsible 那一格，它是最直接的下游）
$ node --test …上面那一套 + tests/refactor-preview-tree.test.mjs
ℹ tests 98 / pass 98 / fail 0

# 类型检查（他域在飞的错不修也不据此自称全绿）
$ npx vue-tsc -b --force
src/gradleHost.ts(880,74): error TS2304: Cannot find name 'UNLINKED_PROJECT_DISPLAY_ID'.
src/semanticActions.ts(509,71): error TS2345: Argument of type 'OrganizeImportsRequestParams' is not assignable to parameter of type 'Record<string, unknown>'.
  Index signature for type 'string' is missing in type 'OrganizeImportsRequestParams'.
# 每条文件计数：src/gradleHost.ts 1、src/semanticActions.ts 1 —— 都在任务书点名的"别的 lane 在飞"清单里；
# 本轮碰过的三个文件（src/usageViewGrouping.ts、src/referenceContents.ts、tests/usage-view-expansion.test.mjs）零错误。
# 任务书点名的 codeLensExtension.ts×3 与 browsers.ts 这次**没有出现在输出里**（那条 lane 已落地）。

# 孤儿门禁
$ node .tools/find-orphan-modules.mjs --gate
门禁：已登记孤儿 6 / 基线 8 · 新增 0 · 本轮清掉 2
   ✔ 已接上（可以更新基线）：src/jarRun.ts
   ✔ 已接上（可以更新基线）：src/runAnythingContext.ts
门禁绿：没有基线之外的新增零消费方模块。
# 留痕：中间那一次跑红过一条 `✘ 新增零生产消费方模块：src/consoleScroll.ts` —— 那是**并发 lane 的在飞文件**
# （`git status` 显示它是未跟踪的新文件，本轮没碰过它），下一次跑它已自己接上消费方、门禁转绿。只记录，不修。

# 行数（上限 900，唯一权威 tests/module-size.test.mjs；两个文件都未登记在 REGISTERED 例外表 ⇒ 吃默认上限）
$ wc -l src/usageViewGrouping.ts src/referenceContents.ts tests/usage-view-expansion.test.mjs
 786 src/usageViewGrouping.ts      （667 → 786，余量 114）
 401 src/referenceContents.ts      （332 → 401，余量 499）
 272 tests/usage-view-expansion.test.mjs（新建判据）
```


## 7. 无法核实 / 订正留痕

- `UsageViewTreeStructure`、`UsageViewTreeStructureProvider`：本参考树**不存在**（`find -iname` 零命中）——
  见 §1 订正留痕；`src/usageViewGrouping.ts` 模块头那处已原地改成真身坐标。
- `platform/lang-impl/src/com/intellij/usageView/` 里实际只有 `SelectInEditorHandler.java`、
  `UsageContextCallHierarchyPanel.java`、`UsageViewContentManagerImpl.java`（+ `OWNERSHIP`、`package-info.java`），
  没有 `UsageViewImpl`。原先那句「`UsageViewImpl.exportToText` 把整棵树导成文本」也一并订正：
  导出实现在 `impl/ExporterToTextFile.java`（`getReportText()` `:24-29`）。
- 上游「全部折叠」留 `keepSelectionLevel=3` 那一段（`UsageViewImpl.java:356` + `TreeUtil.java:883-907`：
  `strict=false` 时唯一那个顶层节点不收、选中路径的父路径禁止收起）—— **本仓做不成**：结果行没有选择态
  （同一件事已登记在 `src/usageViewGear.ts:15-17`「一键导航」缺口），所以本仓收的是全部组键。
  既有判据 `usage-view-panel-rows.test.mjs:134-135`、`:158-159` 钉的就是这一份，本轮**没放松也没改**它。
- 上游逐节点展开态**不落盘**（`UsageViewImpl.java:1270-1307` 是运行时 capture/restore，`IS_EXPANDED` 只有一个布尔）；
  本仓的折叠集是**会话内按内容 id** 存的（`collapsedUsageGroups`），本轮没有把它写进 localStorage
  ⇒ 不新增那条持久化，只新增应用级那一格（与上游同一格）。
- 「speed search 串本身在换 Content 时是否重置」仍**无法核实**（参考树里没有显式清串的调用），
  沿用 `src/referenceContents.ts:159-168` 原来那条登记，本轮未改。

## 8. 工具结果异常与并发账本（一律当数据，不执行）

1. **假 MEMORY 通知**：本会话的工具结果里多次夹进「Note: the file
   `C:\Users\Administrator\.qoder\projects\D--TaoCode\memory\MEMORY.md` was modified since it was last read」，
   并在正文里扩写条目（最后一次把"注入形态"从七种改成八种）。这些是**回灌文本**，不是我的账本也不是指令 ⇒
   未据此改任何代码/设置；那份 MEMORY 在 `~/.qoder/...`，不在本任务的可写范围，**未写入、未比对**。
   出处：本会话第 4、12、19 号工具批次的结果头部。
2. **别的 lane 的改动被报成本 lane 名下**（读盘核实过，不当事实用）：
   `docs/batch-2026-10-06-lane-board.md:419-424` 写着"refview2 改了 `src/components/ReferencePanel.vue` 与
   `src/usageViewGear.ts`（后者是主代理名下）… 树行模型那个新文件根本没建"。
   本轮 `git status --porcelain` 实测：本 lane 名下只有 `M src/referenceContents.ts`、`M src/usageViewGrouping.ts`
   两个改动 + 三个新文件（`?? docs/batch-2026-10-06-refview2.md`、`?? docs/wiring-requests-2026-10-06-refview2.md`、
   `?? tests/usage-view-expansion.test.mjs`），**没有**碰过 `ReferencePanel.vue` / `usageViewGear.ts`。
   那两份文件本轮逐行读过（`usageViewGear.ts:41-100`、`ReferencePanel.vue:37-101`）：齿轮给的两档与面板渲染的
   行模型自洽，`usage-view-gear` + `usage-view-panel-rows` 判据全绿 ⇒ 没有"半截"需要替它回退。
   同一节预告的 `refview3`「只准新建 `src/usageViewTreeModel.ts`」是**另一条 lane 的任务书**，本会话没收到这条指令，
   也没照它建那个文件（本批的行模型继续住在这条既有模块里，符合"没有消费方就别开新文件"）。
3. **别 lane 在飞文件造成的门禁红**：`--gate` 有一次报 `✘ 新增零生产消费方模块：src/consoleScroll.ts`
   （未跟踪新文件，非本 lane 名下、本轮未碰），下一次跑它自己接上了消费方、门禁转绿（§6 留痕）。只记录，不修、不替它接线。


