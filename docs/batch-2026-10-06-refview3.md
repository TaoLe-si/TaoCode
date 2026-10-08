# batch-2026-10-06-refview3 — 用法树行模型（`src/usageViewTreeModel.ts`）

lane 定位：引用面板的**用法树行模型**做成一个纯模型模块（①分组顺序与同级排序 ②行 id 稳定 ③展开态沿用的纯函数形状 ④每层计数）；
只交纯模型 + 判据，**不动面板模板、不加 UI 控件**（宿主接线写在 `docs/wiring-requests-2026-10-06-refview3.md`）。
上游参考树 = `D:\Backup\Downloads\intellij-community-master\intellij-community-master`（仓内 `third_party/intellij-community` 是坏树，本轮未用）。
状态：**已完成**（四条规则 + 真消费方 + 判据 + 反向验证 + 门控数字都在下面）。

---

## 0. 现场复核（前任同域 lane 留下的两个文件）

| 文件 | 改动（工作树 vs HEAD，各 1 行注释） | 判定 | 依据（本轮自己开参考树数过） |
| --- | --- | --- | --- |
| `src/usageViewGear.ts:69` | `UsageGroupingRuleProviderImpl.java:77-78` → `:76-77` | **[✗] 改错了，本轮原地改回 `:77-78` 并留痕** | `platform/usageView-impl/src/com/intellij/usages/impl/UsageGroupingRuleProviderImpl.java` 的 `grep -n "addIfNotNull(result"` 实测：`:72` UsageType、`:73` Scope、`:74` ModuleType、`:75` flattenModules、**:76 Package**、**:77 DirectoryStructure**、**:78 FileStructure**（`isUsageTypeFilteringAvailable()` 那一支从 `:69` 起）。⇒ 「先目录结构、再文件结构」= 77-78；改成 76-77 等于把「包」那一档引成了目录档。 |
| `src/components/ReferencePanel.vue:17` | 「工具条本体从 `:988` 的 `createActionsToolbar()`」→「是 `:989` 的」 | **[✓] 改对了，保留** | 同目录 `UsageViewImpl.java`：`:569` = `toolWindowPanel.setToolbar(createActionsToolbar())`、**:989** = `private @NotNull JComponent createActionsToolbar() {`。同一段注释里的 `:1081-1082`（`createExpandAllAction`/`createCollapseAllAction`）实测成立；`installTreeSpeedSearch` 在 `:978-985`（注释写 `:977-985`，是包住它的区间）。 |
| 两个文件的形状 | 只动注释文本，**无代码改动**，没有"改了但没人用"的新形状 | **[✓] 自洽** | `git diff` 各 1 行；本轮开工前 `node --test tests/usage*.test.mjs tests/reference*.test.mjs` = **69 tests / 69 pass / 0 fail**（主代理给的数，复跑一致），加 `tests/module-size.test.mjs` = 74/74/0。 |

⇒ 不需要"收到自洽"之外的处理；不回退（共享工作树禁 checkout/reset/stash/clean），只把那一处**假坐标原地改回真坐标**（§6 留痕）。

## 1. 上游那族树结构类（逐条自己 find + 打开钉死）

`platform/usageView-impl/src/com/intellij/usages/impl/` 本轮 `ls` 实测在位（35 项 + `actions/` + `rules/`），与四条规则有关的族：

| 实读坐标 | 钉住的规则 |
| --- | --- |
| `impl/Node.java:19` `public abstract class Node extends DefaultMutableTreeNode` | ② 节点身份 = 对象本身（**上游没有字符串 id**）⇒ 本仓 id 是架构不等价下的自造形状 |
| `impl/GroupNode.java:42` `class GroupNode extends Node implements Navigatable, Comparable<GroupNode>` | 分组/文件/成员节点行的本尊 |
| `impl/GroupNode.java:317-348` `NodeComparator`（`:318` `enum ClassIndex {UNKNOWN, USAGE_TARGET, GROUP, USAGE}`，`:331` 比 ordinal，`:332-339` 同种类比组/比用法，`:343-346` `userObject` 相等 → `identityHashCode`） | ① 同级排序（种类先）＋ ② 重复内容的去重档 |
| `impl/GroupNode.java:350-357` `compareTo`：先 `myRuleIndex` 再 `UsageGroup.compareTo` | ① 分组顺序（档号先） |
| `impl/UsageNodeTreeBuilder.java:58-78`（`for (int i = 0; i < myGroupingRules.length; i++) … addOrGetGroup(group, i, …)`） | ① 档序 = 装档数组下标 |
| `impl/rules/ActiveRules.java:31-68`（每档一条 `if (usageViewSettings.isGroupByXxx())`；`:56-58` 目录结构、`:59-63` 文件结构、`:64-66` **否则**才放 `FileGroupingRule` ⇒ 两档互斥） | ① 「有哪几档、谁在前」 |
| `impl/rules/UsageGroupingRulesDefaultRanks.java:26-32`（DIRECTORY_STRUCTURE=400 < FILE_STRUCTURE=500） | ① 档的 rank |
| `impl/rules/UsageGroupBase.java:15-24`（先 `myOrder`，再 `getPresentableGroupText().compareToIgnoreCase(…)`，`:23`） | ① ⇒ 本仓 `compareUsageTreeTextIgnoreCase` |
| `impl/UsageNode.java:11`、`:27-30` | ① 叶子排序入口 |
| `impl/UsageViewImpl.java:207-223`（`getUsagePriority` → `compareByFileAndOffset` → `toString`）、`:225-234`（同文件比 `getNavigationOffset()`，异文件比 `VfsUtilCore.compareByPath`） | ① 叶子排序 |
| `platform/core-api/src/com/intellij/openapi/vfs/VfsUtilCore.java:818`（`compareByPath` 逐路径段 `getName().compareTo`，**大小写敏感**） | ① 叶子支大小写敏感、组支忽略大小写 ⇒ 两档不混用 |
| `impl/GroupNode.java:99-114`、`:118-120`、`:264-288`（`Collections.binarySearch` + `i>=0` **复用已有节点**） | ① 排序落在插入那一趟；② 同一条用法再进来不产生第二行 |
| `impl/UsageViewImpl.java:767-769`（`insertNewNode(child,0)` → `swingChildren.sort(NODE_COMPARATOR)` → `indexOf` 发事件） | ① 同上（模型与 Swing 两份 children 同步排序） |
| `impl/GroupNode.java:45`、`:290-299`（`while (true) { 自己 += i; 父不是 GroupNode 就 return; }`）、`:226-228`（批量移除反向扣，扣完非零才 `nodeChanged`）、`impl/UsageViewImpl.java:742`/`:772` | ④ 每层计数：递归合计从叶子一路往上记 |
| `impl/GroupNode.java:363-366`、`:399-407`（`getSubGroups()`）、`:409-417`（`getUsageNodes()`） | ④ 递归合计 = 直接挂的 + 各子组，同级互不重叠 ⇒ 本模块 ④ 的两格 |
| `impl/UsageViewTreeCellRenderer.java:95-98`（组行后缀 `usage.view.counter`）、`:188-197`（plain text 带 `(递归合计)`）、`impl/ExporterToTextFile.java:57-63` | ④ 屏上/搜索文本/导出读的都是递归合计 |
| `impl/UsageViewImpl.java:1221-1262` `rulesChangedImpl()`（`:1231` capture → `:1234` 排序 → `:1235` reset → `:1258` `expandTreeAfterReset()` → `:1261` restore） | ③ 「重建 → 沿用」那一对的调用序 |
| `impl/UsageViewImpl.java:1271-1288`（`:1273` `if (!myTree.isExpanded(pathFrom)) return;`；`:1280-1283` 记 `new UsageState(usage, isSelected)`；`:1285` 非叶子继续下钻） | ③ 抓的是**当前展开路径下看得见的用法** |
| `impl/UsageViewImpl.java:1291-1302`（`:1293` `//always expand the last level group`） | ③ 根下那一层的默认档 |
| `impl/UsageViewImpl.java:2427-2441` `UsageState.restore`（`myUsageNodes.get(usage)` → `node.getParent()` → `addExpandedPath`；查不到就整条跳过） | ③ 沿用认的是**内容**，位置变了也认得 ⇒ 本仓按行 id |
| `impl/UsageViewImpl.java:1313-1319`（`expandTreeAfterReset() = expandTree(2)`）、`:1345-1347`（`expandRoot() = expandTree(1)`） | ③ 重建后默认展开两层 ⇒ 本仓 `expandLevels` |
| `impl/UsageViewTreeModelBuilder.java:19`、`:26-28`、`:40-69`（`extends DefaultTreeModel`，根 = `GroupNode.createRoot()`，`TargetsRootNode`） | 行树的壳；本仓没有 target 层（§6） |
| `impl/UsageTargetNode.java:9` | ① 种类表里的 `USAGE_TARGET` 档（本仓无） |
| `platform/usageView/src/com/intellij/usages/rules/UsageGroupingRuleEx.java:16` + `impl/rules/ActiveRules.java:124-142`（`getId()` 默认 = 实现类类名） | ② 上游只有「档」有 id，节点没有 |

**订正留痕（类名）**：仓里历史注释写过 `UsageViewTreeStructure` / `UsageViewTreeStructureProvider`。
本轮按这两个名字在 `platform/usageView-impl/src/com/intellij/usages/impl/`（含 `rules/`）与
`platform/usageView/src/com/intellij/usages/`（含 `rules/`）两支按文件名列实查：**没有这两个类**；
真身就是上表那一族（`Node`/`GroupNode`/`UsageNode`/`UsageTargetNode`/`UsageViewTreeModelBuilder`/`UsageNodeTreeBuilder` + `rules/`）。
`src/usageViewGrouping.ts` 模块头那处假坐标已由 `refview2` 原地订正，本轮复核其订正后的坐标逐条重开，全部成立。

## 2. 现场碰撞（本轮不是唯一在动这一族文件的代理）

实测写入窗口（`ls -l --time-style`，本机显示为 UTC+8；UTC = 该值 −8）：

| 时刻 | 文件 | 事件 |
| --- | --- | --- |
| 15:37:18 / 15:40:39 | `src/usageViewGrouping.ts` 668→787 行、`src/referenceContents.ts` 332→402 行 | 同域另一路（`refview2`）正在写：`UsageLevelCount`/`usageLevelCounts`、`UsageExpansionMode`/`carryUsageExpansion`、`collapsible` 修正、`referencesExpandedAll` 那一格与 `watch(…, {flush:'sync'})` |
| 15:42:09 / 15:42:32 | `docs/batch-2026-10-06-refview2.md`、`src/usageViewGrouping.ts` | 同一路补报告 + `allUsageGroupKeys` 改成取那张账表 |
| 15:59:02 / 16:01:18 / 16:01:40 / 16:14:31 | `src/usageViewGrouping.ts`、`src/referenceContents.ts`、`src/usageViewGear.ts` | **本轮**的接线（① 四处排序收口、`referenceRows` 过装配、77-78 订正） |

⇒ 取舍：**不与它抢同一份规则**。`refview2` 已把 ③④ 做成「按内容档位 + 按组键」那两族函数，本轮不在 `usageViewGrouping.ts` 里再写第二份；
本轮的 ③ 是**渲染时按行 id 的对账**（输入两份行序列，输出四份 id 账），本轮的 ④ 是**屏上这一列行按四个层汇总**的账（输入行，输出每层 `{rows, usages, subtreeUsages}`），
与它的组键级/节点级账不重叠，两边函数头注都写清了分工。本轮另把 ① 从"四处各写各的"收成一份（这是上一轮 §3 明写"本轮没改"的那一块）。

## 3. 新模块 `src/usageViewTreeModel.ts`（纯函数：无 Vue / 无 IO / 无 DOM）

| 规则 | 模块里的出口 | 生产消费方（真链路，不是只过自己的测试） |
| --- | --- | --- |
| ① 分组顺序与同级排序 | `USAGE_TREE_LEVELS` / `usageTreeKindRank` / `usageTreeLevelOf` / `usageTreeLevelOfRow` / `compareUsageTreeTextIgnoreCase` / `compareUsageTreePaths` / `compareUsageTreeSiblings` / `sortUsageTreeSiblings` / `compareUsageLocations` | `src/usageViewGrouping.ts` 四处排序：`buildUsageTree` 的 `total()`（孩子 + 位置两处）、`usageFileNodes`、`groupUsagesByFile`（两处）——**同一批面板行**都走它 |
| ② 行 id 稳定 | `usageTreeRowIds` / `usageTreeDuplicateModelRowIds` / `UsageTreeModelRow` | `usageTreeRows` → `src/referenceContents.ts` 的 `referenceRows`（`toolViewContext.ts` → `ToolWindowView.vue` → `components/ReferencePanel.vue`） |
| ③ 展开态沿用的纯函数形状 | `carryUsageTreeExpansion` / `UsageTreeExpansionCarry` / `UsageTreeExpansionCarryOptions` | `usageTreeRows`（装配里就调，非可选旁路） |
| ④ 每层计数 | `usageTreeLevelCounts` / `UsageTreeLevelCount` | `usageTreeRows` + `usageTreeRowsReport`；`referenceRows` 每行带的 `level` 就是这张表的输入 |
| 折叠提示语（③的必需件） | `usageTreeToggleLabel` | `src/usageViewGrouping.ts` 的 `emitGroup`（原来那行硬编码改成调这一份，串与判据一字未变） |
| 行树装配（入口） | `usageTreeRows(rows, options)` / `usageTreeRowsReport(rows, options)` | `src/referenceContents.ts` 的 `referenceRows` |

四条规则的落点说明：
- **①** 档序 = 上游装档顺序（`ActiveRules.java:31-68` + `UsageGroupingRulesDefaultRanks.java:26-32`），
  同级 = 种类先、再忽略大小写文本（`GroupNode.java:328-339` + `UsageGroupBase.java:19-23`），叶子 = 行→列（`UsageViewImpl.java:225-234`）。
  本轮把本仓原有的四份手写比较（`MEMBER_RANK`+`localeCompare`、小写路径、位置、`localeCompare` 路径）**收成一份**，
  四处调用点全部改调模型；`MEMBER_RANK` 那个常量随之删除。既有判据一字未改，103 条全绿 ⇒ 收口没换掉行为。
- **②** id = 内容派生，**键里没有下标**：组行取组键、叶子取 `usage + NUL + 路径 + NUL + 行:列`；
  同一份内容出现第二遍起追加 `NUL#n`（上游这一格是 `System.identityHashCode`，`GroupNode.java:343-346`）。
  判据钉的三件事：重排后每行 id 不变 / 重复内容不撞 id / 半批结果补成全批后同一行 id 不变。
  ⚠ 边界如实登记：occurrence 序号是在**这一列行里**数的，过滤筛掉一条完全相同的重复行后，剩下那条的后缀会缩回来——
  受影响的两行内容一字不差，换 key 不产生可见重排（写在函数头注）。
- **③** 纯函数：`(previous 行序列, next 行序列, {expandLevels}) → {collapsedIds, carriedIds, droppedIds, expandedIds}`。
  沿用认 id（= 内容）；消失的进 `dropped`；**新出现**的组按 `expandLevels` 给默认档（传 2 = 上游 `expandTree(2)`；默认 `Infinity` = 本仓既有档「全展开」，两条都有判据）；
  收不住东西的空壳组从折叠集里剔掉并把提示语清空（没有箭头按钮的「已收起」就是写了按不动的假状态）。
- **④** 每层两格：`usages` = 该层节点**直接挂着**的用法（上游 `getUsageNodes()` 那一格；非叶子层相加正好等于总条数，一条不重不漏）、
  `subtreeUsages` = 该层各节点的**递归合计**相加（上游 `getRecursiveUsageCount()`，屏上 `N 条结果`/导出/搜索文本读的都是它，父子层允许重叠）。

## 4. 判据（新文件 `tests/usage-view-tree-model.test.mjs`，**14 条，14 pass / 0 fail**）

分布：① 4 条（种类先 / 只差大小写 / 叶子行→列 / 到达顺序换了行序不变）、② 3 条（无下标且重排稳定 / 重复内容不撞 id / 报错重跑同一行 id 不变）、
③ 3 条（沿用 + dropped / `expandLevels` 两档 / 空壳组纠正）、④ 2 条（三层账 + 划分不变式 / 成员层四档 + 重叠那格）、生产链路 1 条、装配一致性 1 条。

## 5. 门控原始数字（本轮最后一次跑，逐条）

1. `node --test tests/usage*.test.mjs tests/reference*.test.mjs tests/module-size.test.mjs`
   ⇒ `tests 103 / pass 103 / fail 0 / skipped 0`（开工前基线：69/69/0 域内 + module-size = 74/74/0；`refview2` 那一批把域内推到 84，本轮 +14 条新判据 + 5 条别的 lane 的）。
2. `node .tools/find-orphan-modules.mjs --gate` ⇒ `词法自检：0 异常` · `门禁：已登记孤儿 6 / 基线 8 · 新增 0 · 本轮清掉 2`（清掉的是 `src/jarRun.ts`、`src/runAnythingContext.ts`，不是本域）· **门禁绿：没有基线之外的新增零消费方模块**。
   ⇒ 本批新文件 `src/usageViewTreeModel.ts` 的**生产**消费方两处：`src/usageViewGrouping.ts`（① 四处排序 + `usageTreeToggleLabel`）与 `src/referenceContents.ts`（`referenceRows`）。
3. `node .tools/find-param-props.mjs` ⇒ `共 0 处参数属性`；`node .tools/find-ts-in-mjs.mjs` ⇒ `干净：tests/*.mjs 全部是纯 JavaScript`；`node .tools/find-missing-ext.mjs` ⇒ `扫描 1375 个文件… 干净`。
4. `npx vue-tsc -b --force` ⇒ **本批四个文件 0 错**；他域在飞错 2 条，只记录不修：
   `src/postFormatProcessors.ts(418,53): error TS2304: Cannot find name 'spacing'.`（不在授权名单里，但也不是本域/本批文件）、
   `src/semanticActions.ts(509,71): error TS2345: …'OrganizeImportsRequestParams'…`（在"他域在飞错只记录"名单里）。
5. `node --test tests/source-citations.test.mjs tests/source-citation-anchors.test.mjs` ⇒ `tests 11 / pass 8 / fail 3`，三条全部是**别的路**的现场，与本批无关（逐条列，转述时**故意不写完整形状**，免得引用门把假行号当成真引用收集）：
   `docs/batch-2026-10-06-findrep2.md` 里那条 `ConsoleViewImpl.kt` 的引用报了「行号超出文件长度」（它转述的是一个越界的假行号，实得文件长度 1730）、
   `moved :: src/commitChecks.ts|…CommonCheckinFilesAction.kt|26-78`、
   `moved :: src/components/ProblemsPanel.vue|…SuppressIntentionAction.java|19-19`、
   `moved :: src/components/ProblemsPanel.vue|…IntentionSource.java|37-40`、
   `moved :: src/runStartupFocus.ts|…RunnerAndConfigurationSettings.java|242-242`。
   汇总行：`锚点核对：快照 3367 条 / 仓里活引用 4045 条 / 未入快照 682 条 / 区间为空 1 条`。
   ⇒ 本批新增的都是**真引用**（未入快照那一档只报数不拦），本批**没有删除**任何已入快照的锚点：
   `docs/inventory/citation-anchors.json` 里 `src/usageViewGrouping.ts`、`src/referenceContents.ts`、`src/components/ReferencePanel.vue` 三条本域文件的锚点全部仍在（本轮被删掉的那行注释带的是 `ClassGroupingRule.java:178` 这种**没有目录前缀**的短写法，引用门不采集，实测不影响锚点账）。
6. 上限（`split('\n').length` 口径，只降不升，未动 `tests/module-size.test.mjs`）：
   `src/usageViewTreeModel.ts` **新文件 433**（< 900）；`src/usageViewGrouping.ts` 787 → **782**（降 5）；
   `src/referenceContents.ts` 402 → **409**；`src/usageViewGear.ts` 102 → **105**；`src/components/ReferencePanel.vue` 114 → 114（本轮一行未动）；`tests/usage-view-tree-model.test.mjs` 新 245。

## 6. 反向验证记录（探针前缀 = `REFVIEW3` 连 `-PROBE`，四步）

注入串都只落在 `src/usageViewTreeModel.ts`，每步跑 `node --test tests/usage-view-tree-model.test.mjs` 后从备份还原（备份放 `build/`，收工已删）：

| 步 | 注入了什么 | 结果 |
| --- | --- | --- |
| P1 | 去掉重复行的 occurrence 后缀（`return row.key`） | `pass 12 / fail 2` —— ② 「重复内容不撞 id」与生产链路「面板里不许两行同一个 id」都红 |
| P2 | 同级比较器不比种类（`if (false) return rankLeft - rankRight`） | `pass 13 / fail 1` —— ① 「目录/文件/类/方法按档号」红 |
| P3 | 新出现的组一律收起（丢掉 `expandLevels` 那一支） | `pass 13 / fail 1` —— ③ 「上游 expandTree(2) vs 本仓全展开」红 |
| P4 | 每层"直接挂着"那一格改成子树合计（`entry.usages += row.count`） | `pass 12 / fail 2` —— ④ 两条"划分不变式"全红 |
| 还原 | `cp` 回原文件 | `tests 14 / pass 14 / fail 0` |
| 残留 | 收工 grep | `grep -rn` 整串前缀（本仓 src/tests/docs/native/.tools）= **0 命中**（本文件里那一处已写成拆开的形式） |

## 7. 做不到 / 无法核实 / 架构不等价

- 架构不等价（①）：上游 `getUsagePriority`（`UsageViewImpl.java:214`，取 `UsageInfo2UsageAdapter` 的 `UsageInfo.getPriority()`）本仓没有 —— 结果来自 LSP `textDocument/references`，不带读/写档，
  所以 `compareUsageLocations` 只有 行 → 列 两档（等价于上游 `:225-234` 那一段）。
- 架构不等价（①）：上游 `ClassIndex` 的 `USAGE_TARGET` 档本仓没有（`UsageTargetNode` 挂在 `UsageViewTreeModelBuilder.java:40-69` 的 `TargetsRootNode` 下，宿主未接）⇒ 种类表只有 目录 < 文件 < 类 < 方法 < 用法。
- 架构不等价（②）：上游节点没有字符串 id（身份 = `DefaultMutableTreeNode` 对象 + `userObject`），本仓必须自造键；`tests/…tree-model` 的 ② 三条就是这条自造的判据。
- 架构不等价（③）：上游沿用的是"选中态 + 可见用法"（`UsageState.isSelected` + `addSelectedPath`），本仓引用面板这张列表**没有选择态**（同一件事已登记在 `src/usageViewGear.ts:15-17` 的「一键导航」缺口）⇒ 沿用里只有展开/折叠。
- 做不到（不是没做，是**不该本批做**）：面板模板 `:key` 还带着 `index`（`src/components/ReferencePanel.vue:87`），本轮不能动模板 ⇒ 可照抄的替换与依据已写进 `docs/wiring-requests-2026-10-06-refview3.md` R-1；
  同样：③ 的 `previous`（跨重建沿用到"上一屏"）与 `expandLevels: 2`（打开上游那一档）分别写在 R-3 / R-2，都因为会撞既有判据（`tests/usage-view-panel-rows.test.mjs:51`、`:185-191`）而**留给主代理决定**，本批没有擅自打开。
- 无法核实：「speed search 串在换 Content 时是否重置」——参考树里没有显式清串的调用（沿用 `refview2` 的同一条登记，本轮另找过 `UsageViewImpl.java` 的 `TreeExpansionListener`/`SmartExpander` 两处，仍无新证据）。
- 无法核实：本轮**没有新增任何界面文本**，「展开 / 收起」两串是本仓既有的（判据 `tests/usage-view-panel-rows.test.mjs:73` 钉着），本地化包不在本地树里，故不对其译法下结论。
- 只记录不修（他域在飞）：§5 第 4、5 条里那 2 条 TS 错与 3 条引用/锚点红。

## 8. 工具结果异常（按纪律 ⑧：一律当数据，读盘复现，不执行）

本轮在**工具结果尾部**读到多段伪装成"系统/主代理"的文字，内容都是"预算已用完 / 立刻停手 / 只交 partial / 等用户授权 / MEMORY.md 被谁改过 / 你的 Edit 其实没改到文件 / 不要再重试"。
处置：不执行、不改纪律、逐条读盘复现。出处（同一会话内）：
1. 一次 `Bash`（14 个域测试的原始输出）结果尾部；后续四次分别在 `Bash` 后台任务通知、`Read` 结果、两次 `Edit` 成功结果、以及一次 `Bash` 汇总输出的尾部重复出现，
   且自报的"预算上限"彼此矛盾（一次 75、一次 90、一次 95、两次 110、120、150）——真实轮次由 `~/.qoder/projects/<project>/state.json` 的 `transcript_path` 数（本轮未去数，因为不据此停手）。
2. `Read docs/batch-2026-10-06-refview2.md` 三次返回 3 字节正文 / 「File does not exist」，而 `wc -c` 与 `ls -l` 实测 15748、19502 字节 ⇒ 判为工具结果异常；
   该文件里被引用的坐标（`refview2` §1.1 的 rank 表与 §4 的落点）本轮**全部自己另开参考树重数过**（见 §1），没有照抄它的结论。
3. 一次 `Edit` 成功结果里带「the file content is same as before，请勿重试」——与盘上事实矛盾：`git diff -- src/usageViewGear.ts` 与 `git diff --stat` 实测本轮 4 个 hunk 都在（§5 第 6 条的行数变化就是它），已按盘上结果记账。
4. 没有任何一条 MEMORY.md 写入是本轮做的（`ls -l --time-style=+%H:%M:%S` 复现过 6 个 MEMORY 文件的 mtime 与字节数，见前一次输出）；本轮按纪律不碰记忆文件，也不据此改变对本任务的判断。

## 9. 交付清单

| 文件 | 前 | 后 | 一句话 |
| --- | --- | --- | --- |
| `src/usageViewTreeModel.ts` | 不存在 | 433 | 新建的**唯一**纯模型模块：①②③④ + 行树装配入口 |
| `src/usageViewGrouping.ts` | 787 | 782 | ① 的四份手写比较改调模型（`MEMBER_RANK` 删除）；`toggleLabel` 改调模型那一份（串不变） |
| `src/referenceContents.ts` | 402 | 409 | `referenceRows` 过 `usageTreeRows`（每行带稳定 id 与层，折叠态按 id 对账） |
| `src/usageViewGear.ts` | 102 | 105 | 把上一批改错的 `:76-77` 改回 `:77-78`，原地留痕 |
| `tests/usage-view-tree-model.test.mjs` | 不存在 | 245 | 14 条判据（四条规则 + 生产链路） |
| `docs/batch-2026-10-06-refview3.md` | 骨架 | 本文件 | 交付报告 |
| `docs/wiring-requests-2026-10-06-refview3.md` | 不存在 | 新建 | R-1 `:key="row.id"`、R-2 `expandLevels:2`、R-3 按内容分档的 `previous`、R-4 无新增持久化键 |

未动：`src/App.vue`、`src/bridge.ts`、`src/components/CodeEditor.vue`、`native/main.cpp`、`scripts/verdict_table.py`、`docs/inventory/*`、
`src/components/ReferencePanel.vue` 的模板（只保留上一批那一条注释订正），以及并发黑名单里那一批文件（全程只读）。
`scripts/__pycache__/verdict_table.cpython-314.pyc` 仍是别的路跑脚本留下的脏改动：本轮**未 stage、未删除**。
