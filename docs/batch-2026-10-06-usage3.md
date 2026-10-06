# batch-2026-10-06-usage3（引用面板行模型 W-3 · 层级范围下拉 W-2）

上游唯一真源：`D:\Backup\Downloads\intellij-community-master\intellij-community-master`（下面所有坐标都是
本人亲自 `sed`/`grep -n` 打开核对过的行号，非转述）。**未上网搜索过一次。**

## 0. 派单里那条"上游路径"先纠偏（留痕）

派单让打开 `platform/analysis-impl/src/com/intellij/find/usages/UsageViewTreeStructure.java` 与 `.../usagesViewImpl/`。
**这两个路径在参考树里不存在**（`find -iname "*UsageViewTreeStructure*"` = 0 命中；
`grep -rl "UsageViewTreeStructure" --include=*.java --include=*.kt` = 0 命中；
`platform/analysis-impl/src/com/intellij/find/` 下只有 `FindBundle.java`/`FindSettings.java`/
`FindUsagesSettings.java`/`findUsages`/`impl`；`find -type d -name "usagesViewImpl"` = 0 命中）。
三条路各搜一遍后，真实落点是：

| 派单说的 | 真实的 | 干什么用 |
|---|---|---|
| `UsageViewTreeStructure.java` | `platform/usageView-impl/src/com/intellij/usages/impl/UsageViewTreeCellRenderer.java` | 节点标签格式、计数 |
| 同上（结构） | `.../usages/impl/rules/ActiveRules.java:45-65`、`.../usages/impl/UsageNodeTreeBuilder.java` | 树里有哪几层 |
| `.../usagesViewImpl/` | `platform/lang-impl/src/com/intellij/find/usages/impl/`（`TextUsage.kt` 那一族）+ `platform/usageView-impl/src/com/intellij/usages/impl/` | 用法呈现与视图 |
| `HierarchyBrowser`/`CallHierarchyBrowser` | `platform/lang-api/src/com/intellij/ide/hierarchy/HierarchyBrowser.java`、`platform/lang-impl/src/com/intellij/ide/hierarchy/HierarchyBrowserBase.java`/`HierarchyBrowserBaseEx.java`、`java/java-impl/src/com/intellij/ide/hierarchy/call/CallHierarchyBrowser.java`、`.../type/TypeHierarchyBrowser.java` | 范围下拉、层级面板 |

另外派单/旧注释里的 `HierarchyBrowserScopes.java` 写作 `platform/lang-api/...` —— 实际在
**`platform/lang-impl/src/com/intellij/ide/hierarchy/HierarchyBrowserScopes.java`**（本仓
`src/hierarchyScopes.ts:5` 那份引用是对的，`tests/hierarchy-scopes.test.mjs:5` 也是对的）。

## 1. 判词表

族 = 引用/用法视图（`lp/usage-view`）、层级（`lp/hierarchy`）。

### W-3 引用面板的用法树行模型

| 项 | 判定 | 上游坐标 | 本仓落点 | 一句话 |
|---|---|---|---|---|
| 树里有哪几层、层序 | `[x]` | `platform/usageView-impl/src/com/intellij/usages/impl/rules/UsageGroupingRulesDefaultRanks.java:26-32`（DIRECTORY=400 < FILE=500）；`ActiveRules.java:55-57`（关着就没有目录节点）、`:59-62`（成员层由 `FileStructureGroupRuleProvider` 提供）；`java/java-backend/resources/META-INF/JavaPlugin.xml:566-567`（类在方法前） | `src/usageViewGrouping.ts:227-310`（`buildUsageTree`）、`:172-176`（`MEMBER_RANK`） | 目录 → 文件 → 类 → 方法 → 行，四档组行 + 叶子 |
| **同一文件多处引用只生成一个文件节点** | `[x]` | 上游是 `SingleParentUsageGroupingRule` 一族（每档给唯一父组）；文件组去重见 `.../rules/FileGroupingRule.java` | `src/usageViewGrouping.ts:264-270`（`find` 复用 + `ensureMember` `:251-259`） | 判据：`tests/usage-view-panel-rows.test.mjs` 的「同一个文件的多处引用只生成一个文件节点」 |
| 成员层的符号来源 | `[~]` 本仓已有：注入点 + 按行包含；还差：宿主没接 LSP `documentSymbol` | `ClassGroupingRule.java:44-62`（`PsiTreeUtil.getParentOfType(..., PsiClass, true)`）、`MethodGroupingRule.java:63-73` | `src/usageViewGrouping.ts:96-120`（`UsageMemberSymbol`/`UsageTreeBuildOptions`）、`:150-190`（`usageSymbolsOutsideIn`/`usageMemberPathFor`）；面板侧 `src/referenceContents.ts:141-160`（`provideUsageSymbols`） | 没有 PSI ⇒ 用宿主的 LSP 符号表；没接上就退回「文件 → 行」，不画空层 |
| 类层文本 = `Outer.Inner` | `[x]` | `java/java-impl/src/com/intellij/usages/impl/rules/ClassGroupingRule.java:114-122`（`createText` 把外层类名一级级点在前面） | `src/usageViewGrouping.ts:152-153`/`:183`（`classes.join('.')`） | 嵌套类串点链，不写包名 |
| 方法层文本 = 名字 + 参数表 | `[x]`（近似） | `MethodGroupingRule.java:87-91`：`PsiFormatUtil.formatMethod(SHOW_NAME \| SHOW_PARAMETERS, SHOW_TYPE)` | `src/usageViewGrouping.ts:166-171` | LSP `detail` 只有以 `(` 开头才当参数表拼上；`: void` 那类不拼（宁缺毋造） |
| 同级比较 | `[x]` | `ClassGroupingRule.java:178` `compareToIgnoreCase`；目录/文件沿用本仓既有路径序（`DirectoryGroupingRule.java:189`） | `src/usageViewGrouping.ts:293-300` | 先按档（`MEMBER_RANK`）再按呈现文本 |
| 组行计数 | `[x]` | `UsageViewTreeCellRenderer.java:95-98`（`getRecursiveUsageCount()` + `usage.view.counter`，`UsageViewBundle.properties:131`） | `src/usageViewGrouping.ts:305-312`（子树合计）、`:392-394`（`usageCounterText`） | 每层都是子树合计 |
| 折叠态 | `[x]` | `UsageViewImpl.java:1081-1082` → `:1338-1343`（`TreeUtil.collapseAll` + `expandRow(0)`） | `src/usageViewGrouping.ts:466-479`（组行自己留、子树不收）、`:527-531`（`allUsageGroupKeys`）；状态在 `src/referenceContents.ts:183-227` | 折叠集 = 组键（成员键 `文件#类[#方法]`）；按 Content 分档 |
| **默认展开深度** | `[x]` | `UsageViewImpl.java:1313-1316`（`expandTree(levels)`→`TreeUtil.expand`）、**`:1317-1319` `expandTreeAfterReset()` = `expandTree(2)`**、调用点 `:1258`/`:1424`；`:1346` `expandRoot()`=`expandTree(1)`；`:1291-1302` `restoreUsageExpandState` 注释 "//always expand the last level group"，把根下那一层的 `GroupNode` 一律加入展开集 | `src/referenceContents.ts:183-190`（默认折叠集为空 = 全展开） | 本仓取"默认全展开"，等价于上游 `expandTree(2)` + 根下一层恒展开（本仓只有两/三层，`expandTree(2)` 已把所有组行展开） |
| **节点标签格式** | `[x]` | `UsageViewTreeCellRenderer.java:80-83`（叶子 = `getPresentableText()` + `" " + getLocationString()` 灰色）；`:88-89`（根画 `<root>`，"root is invisible"）；`:92`+`:132-140`（组行 = `getPresentableGroupText`）；`:95-98`（组行后面灰色计数） | `src/usageViewGrouping.ts:354-380`（`UsageTreeRow` 的 `label`/`detail`）、`:455`（根不占一层） | 叶子只有位置串（本仓读不到那一行代码，差异见 §6） |
| 速度搜索取什么文本 | `[x]` | `UsageViewImpl.java:978-983`（`installTreeSpeedSearch(... getPlainTextForNode ...)`）；`UsageViewTreeCellRenderer.java:159-213`，其中组行那份 = 呈现文本 + `" (" + getRecursiveUsageCount() + ")"`（`:194`、`:197`） | `src/usageViewGrouping.ts:561-575`（`usageRowSearchText`/`usageNodeSearchText`） | 组行的搜索文本**含**计数，叶子不含 |
| **速度搜索过滤后的行归属 + 计数按可见行算** | `[~]`（语义按本仓改，见下一行） | 同上 | `src/usageViewGrouping.ts:596-641`（`filterUsageTree`）、`:643-650`（`usageRowsForQuery`）；面板 `src/referenceContents.ts:162-176`（`referencesSpeedSearch`） | 命中叶子 ⇒ 祖先组留、计数=可见行数；组行自命中 ⇒ 整棵子树可见；空组整个消失 |
| 上游 speed search 其实是"跳转"不是"过滤" | 如实登记 | `UsageViewImpl.java:978-983` 装的是 `TreeUIHelper.installTreeSpeedSearch`（JTree 增量查找：选中下一条，行一条不少） | `src/usageViewGrouping.ts:578-595` 的头注逐字写明差异 | 本仓那张列表是 Vue 的 `v-for`、没有 JTree 选中形态 ⇒ 采"过滤 + 重算"，匹配文本仍取上游那份 |
| 文本导出跟着层序走 | `[x]` | `platform/usageView-impl/src/com/intellij/usages/impl/ExporterToTextFile.java:31-71`（每层缩进 4 空格 `:35`、根不写 `:34-40`、组行 `:57-63`）；`UsageViewBundle.properties:8`（`usages.n`） | `src/usageViewGrouping.ts:541-556`（改成直接吃 `flattenUsageTree` ⇒ 面板几层就导几层） | 一处规则两份呈现，成员层自动进导出 |
| 齿轮「分组」组多出「文件结构」 | `[x]` | `UsageGroupingRuleProviderImpl.java:77-78`（先 Directory Structure 再 File Structure）；`actions/GroupByFileStructureAction.java:12-25`；文本 `UsageViewBundle.properties:20` = "File Structure"；默认值 `UsageViewSettings.kt:21` = **true** | `src/usageViewGear.ts:64-100`；状态 `src/referenceContents.ts:118-131` | 没有符号源就**不给这一行**（`usageSymbolsAvailable()`），不留假控件 |
| 旧存档缺键补默认 | `[x]` | `UsageViewSettings.kt:21`（true）与 `:26`（false）两档默认值不同 | `src/referenceContents.ts:45-54`（`readStoredFlag(key, fallback)`） | 缺键取默认，写坏也取默认，不按字段数判损坏 |

### W-2 层级范围下拉的宿主契约

| 项 | 判定 | 上游坐标 | 本仓落点 | 一句话 |
|---|---|---|---|---|
| 五档 id | `[x]` | `platform/lang-impl/src/com/intellij/ide/hierarchy/HierarchyBrowserScopes.java:8-12` | `src/hierarchyScopes.ts:41` | 键 = 常量原值，不翻中文键 |
| **范围下拉项顺序（按上游改本仓）** | `[x]` 已改 | `HierarchyBrowserBaseEx.java:770-776`（`getValidScopes()`：Production → Tests → All → This Class → This Module）、`:811-813`（按这个序 `group.add(new MenuAction(...))`） | `src/hierarchyScopes.ts:44-63` | **留痕**：原写顺序照 `:235-243`，实际那是 `getPresentableNameMap()` 的 `HashMap` 装入序（`:235` 就是 `new HashMap<>()`），不是下拉序 ⇒ 本仓按 `:770-776` 改 |
| 呈现名 | `[x]` | `ProjectProductionScope.java:36` + `AnalysisBundle.properties:127`（Production）；`TestsScope.java:22` + `:205`（**Tests**）；`:206`（All）；`LangBundle.properties:348`/`:349` | `src/hierarchyScopes.ts:45-63` | id 是 `Test`、屏上是 `Tests`，两个字符串不是一回事（已写进注释） |
| 默认档 | `[x]` | `HierarchyBrowserBaseEx.java:165`（`state.SCOPE == null ? SCOPE_ALL : state.SCOPE`） | `src/hierarchyScopes.ts:66` | 默认 All |
| **纯函数求值 `scopeFilterFor(scope, base)`** | `[x]` 新增 | `platform/lang-impl/src/com/intellij/ide/hierarchy/HierarchyTreeStructure.java:161-169`（`isInScope(baseClass, srcElement, scopeType)`：This Class/This Module 都要 base）、`:176`/`:180`（Production/Test 走 `TestSourcesFilter.isTestSources`） | `src/hierarchyScopes.ts:112-128`（`isKnownHierarchyScope`/`resolveHierarchyScope`/`scopeFilterFor`） | 返回谓词，面板逐节点问；非法档退默认档，绝不清空 |
| 一批节点那份入口 | `[x]` | 同上 | `src/hierarchyScopes.ts:130-135`（`filterNodesByScope` 改成**就是** `scopeFilterFor`） | 一处规则两份入口，不会再分叉 |
| 计数提示兜底 | `[x]` 已改 | — | `src/hierarchyScopes.ts:142-148` | **留痕**：原来未知档取 `HIERARCHY_SCOPES[0]` 的呈现名（那是下拉第一项，不是默认档）⇒ 改成按 `resolveHierarchyScope` 取默认档；既有断言「未知档 ⇒ `全部：1 / 2`」一字未动仍绿 |
| 宿主挂载点 | `[ ]` 未做（不能做） | `HierarchyBrowserBaseEx.java:808-816`（`ChangeScopeAction.createPopupActionGroup`） | 请求 R-3，见 `docs/wiring-requests-2026-10-06-usage3.md` | `grep -n hierScope src/App.vue` = 0 命中 ⇒ 界面上现在没有这个下拉；模块侧不画 |
| 命名作用域 / Configure Scopes | `[-]` | `:778-782`、`:815` | — | 本仓没有命名作用域宿主，给了就是假控件；已在 `src/hierarchyScopes.ts:20-21`/`:63` 注释登记 |

### 上游一致性核对里"没找到"的那一项

| 项 | 判定 | 说明 |
|---|---|---|
| **层级视图（Hierarchy）的默认展开深度** | `[-]` 无法核实 | `grep -n "expand\|TreeUtil" java/java-impl/src/com/intellij/ide/hierarchy/call/CallHierarchyBrowser.java` = **0 命中**；`grep -rn "TreeUtil.expand\|expandTree\|expandRow" platform/lang-impl/src/com/intellij/ide/hierarchy/HierarchyBrowserBase.java platform/lang-impl/src/com/intellij/ide/hierarchy/TypeHierarchyBrowser.java` = **0 命中**。展开发生在别处（没在本地树定位到具体行）⇒ 不编造，本仓层级面板维持既有"根 + 第一层展开"的行为，未改动 |

## 2. 改动文件清单（`wc -l` 前 → 后）

| 文件 | 前 | 后 |
|---|---|---|
| `src/usageViewGrouping.ts` | 359 | 667 |
| `src/referenceContents.ts` | 268 | 332 |
| `src/usageViewGear.ts` | 85 | 101 |
| `src/hierarchyScopes.ts` | 106 | 160 |
| `tests/usage-view-panel-rows.test.mjs` | 200 | 383 |
| `tests/hierarchy-scopes.test.mjs` | 91 | 135 |
| `tests/hierarchy-view-scope.test.mjs` | 60 | 64（只改顺序断言 + 头注坐标） |
| `docs/wiring-requests-2026-10-06-usage3.md` | 不存在 | 新增 |
| `docs/batch-2026-10-06-usage3.md` | 不存在 | 本文件 |

未动：`src/App.vue`、`src/bridge.ts`、`src/hierarchyView.ts`（它对 `nodeInScope` 的调用是既有判据的机检锚点，
`tests/hierarchy-scopes.test.mjs:86` 钉着那一句）、`src/refactorPreview.ts`（别人的文件面）。

**兼容性处理**：把 `UsageTreeNode.kind` 从两档加宽到四档后，`src/refactorPreview.ts:207`
（只吃 `'file' | 'directory'`）会红。没有去改别人的文件，而是本模块加宽成
`UsageTreeNode<L extends UsageTreeNodeKind = UsageTreeNodeKind>` + `buildUsageTree` 两个重载
（不传 `options` ⇒ `UsageTreeNode<'directory' | 'file'>`），`ReturnType<typeof buildUsageTree>`
仍取最后一个（窄）签名 ⇒ 对方一字不改就绿（判据 `tests/refactor-preview-tree.test.mjs` 全绿）。

## 3. §5 自查命令的前后数字

| 命令 | 前（本批开工时） | 后（收工） |
|---|---|---|
| `npx vue-tsc -b --force` | 0 错（开工基线） | 中间 1 错（`src/refactorPreview.ts(207,7)`，我加宽 `kind` 造成）⇒ 修好类型面后 **0 错** |
| `node --test tests/usage-view-panel-rows.test.mjs` | 11 pass / 0 fail | **21 pass / 0 fail** |
| `node --test tests/usage-view-gear.test.mjs` | 6 / 0 | **6 / 0** |
| `node --test tests/usage-view-grouping.test.mjs` | 5 / 0 | **5 / 0** |
| `node --test tests/reference-contents.test.mjs` | 11 / 0 | **11 / 0** |
| `node --test tests/hierarchy-scopes.test.mjs` | 7 / 0 | **12 / 0** |
| `node --test tests/hierarchy-view-scope.test.mjs` | 4 / 0 | **4 / 0**（顺序断言按上游改，见 §1 留痕） |
| 邻域回归 `non-code-usages` / `usage-highlight` / `refactor-preview-tree` | — | 16 / 15 / 全绿（`refactor-preview-tree` 与前三份合跑 35 pass 0 fail） |
| 本域合计（8 份测试文件） | 51 | **90 pass / 0 fail** |
| `node --test tests/module-size.test.mjs` | 4 pass / **1 fail** | 4 pass / **1 fail** —— 唯一一条红是 `src/bridge.ts 现在 911 行 > 上限 905`；`bridge.ts` 是保留文件、**本批一个字没碰**（`git show HEAD:src/bridge.ts \| wc -l` = 904，工作区 = 910，`git status --porcelain src/bridge.ts` = ` M`），是别人在途的改动。我这几个文件：667/332/101/160，上限 900，**没有新增巨型文件、没有登记豁免** |
| `node .tools/find-param-props.mjs` | 0 | **共 0 处参数属性** |
| `node .tools/find-ts-in-mjs.mjs` | 干净 | **干净：tests/\*.mjs 全部是纯 JavaScript** |
| `node .tools/find-missing-ext.mjs` | 干净 | **扫描 1303 个文件，干净：没有漏扩展名** |
| `node .tools/find-orphan-modules.mjs --gate` | 基线 8 | **已登记孤儿 8 / 基线 8 · 新增 0 · 本轮清掉 0 ⇒ 门禁绿** |
| `node --test tests/source-citations.test.mjs tests/source-citation-anchors.test.mjs` | 11 / 0 | **11 pass / 0 fail** |
| `native/` 改动 → ctest | — | 本批没有改 `native/` ⇒ 不适用（具体理由：改动全在 `src/*.ts` 与 `tests/*.mjs`） |

## 4. 反向验证记录（三条全做过）

1. **过滤后计数**：把 `src/usageViewGrouping.ts` 的
   `const count = locations.length + children.reduce(...)` 改成 `const count = node.count`
   → `node --test tests/usage-view-panel-rows.test.mjs tests/hierarchy-scopes.test.mjs`
   = **3 条红**（`速度搜索过滤后的行归属…`、`面板：接上符号源…`、`下拉的先后…`）。
2. **下拉顺序**：把 `HIERARCHY_SCOPES` 退回 `All, Production, Test, …`
   → 同一轮里 `下拉的先后 = 上游 getValidScopes()…` **变红**（与第 1 条同批注入，合计 3 红）。
3. **撤掉两处注入**（`cp` 回滚）⇒ 同一命令 **37 pass / 0 fail**（panel-rows + hierarchy-scopes + hierarchy-view-scope 三份合跑）。
4. 另一次自然反向验证：加宽 `kind` 之后 `vue-tsc` 立刻红在 `src/refactorPreview.ts(207,7)`
   ⇒ 证明既有消费方的窄类型真的被门住，不是假绿；改用重载后复绿（0 错）。

## 5. 零消费方自查

- `find-orphan-modules.mjs --gate`：**新增 0**。
- 本批新符号逐一有消费方：
  `usageSymbolsOutsideIn`/`usageMemberPathFor` → `buildUsageTree`（同文件）+ 判据；
  `filterUsageTree`/`usageRowsForQuery`/`usageRowSearchText` → `src/referenceContents.ts:171-176`（面板行）
  + `tests/usage-view-panel-rows.test.mjs`；
  `provideUsageSymbols`/`usageSymbolsAvailable` → `src/usageViewGear.ts:73-100`（决定那一行给不给）
  + 两份判据 + 宿主接线请求 **R-2**；
  `referencesGroupByFileStructure`/`referencesSpeedSearch` → `referenceRows` 与齿轮 + 请求 **R-1**；
  `scopeFilterFor`/`resolveHierarchyScope`/`isKnownHierarchyScope` → `filterNodesByScope`（同文件）
  + `tests/hierarchy-scopes.test.mjs` 四条新判据 + 请求 **R-3**。
- 唯一"模块侧已就绪、宿主还没挂"的是 R-1/R-2/R-3 三条：面板**没有**因此画出半接的控件
  （`referenceRows`/`hierScopeOptions` 在 App.vue 里当前一个都没被引用，界面上仍是旧的平表；
  齿轮那一行按 `usageSymbolsAvailable()` 决定出现与否）。

## 6. 做不到 / 无法核实（具体卡在哪一环）

1. **上游 speed search 不是过滤器**（`UsageViewImpl.java:978-983` 装的是 JTree 的增量查找：
   匹配到就选中那一行、行一条不少）。本仓面板是 Vue `v-for` 列表、没有"选中行"这一形态，
   所以"过滤 + 按可见行重算计数"是本仓的等价交换，不是上游行为 —— 差异逐字写在
   `src/usageViewGrouping.ts:578-595`，判据名也直说「速度搜索过滤后的行归属」。
2. **叶子文本**：上游叶子是"那一行代码 + 灰色位置串"（`UsageViewTreeCellRenderer.java:80-83`），
   要拿到代码文本得逐引用读文件；本仓面板只有 `LspLocation` ⇒ 叶子主文本仍是 `行:列`，
   没有假装带代码片段（`src/usageViewGrouping.ts` 文件头「架构不等价处」）。
3. **成员层的触发条件**：上游按 PSI 祖先（`ClassGroupingRule.java:44-62`）；本仓按"符号区间包住那一行"
   （`src/usageViewGrouping.ts:113-148`），且**依赖宿主交符号**（R-2）。
   顶层函数（TS/JS 里方法外面）上游 Java 那棵树里根本没有这一形态
   （`MethodGroupingRule.java:65-67` 要求方法有带限定名的宿主类），本仓按「文件 → 方法 → 行」收，
   不假造一个空类层（`src/usageViewGrouping.ts:283-287`）。
4. **组内"叶子 vs 子组"的先后**：查了
   `UsageViewTreeModelBuilder.java`（只有 `:80-81` 加 target 节点）与
   `grep -rn "insertIndex|findInsertPosition|addNodeToTree|BinarySearch" platform/usageView-impl/src/com/intellij/usages/impl/*.java` = 0 命中
   ⇒ **无法核实**上游在同一个组节点里怎么排这两类孩子。本仓取"自己的行在前、子组在后"，
   判据按实现钉死（`tests/usage-view-panel-rows.test.mjs` 的「成员层的行序与缩进」）。
5. **层级视图的默认展开深度**：见上一节表 —— `CallHierarchyBrowser.java` 与
   `HierarchyBrowserBase.java`/`TypeHierarchyBrowser.java` 里搜不到 expand 调用，指不到行号，
   所以本批**没有改**层级面板的展开行为。
6. **Module/Package/Scope/UsageType 四档分组**：上游有（`UsageGroupingRulesDefaultRanks.java:14-24`、
   `ModuleGroupingRule.java`、`UsageTypeGroupingRule.java`、`PackageGroupRuleProvider`），
   本仓工作区单根、没有 Module 表（同 `src/hierarchyScopes.ts:29-31` 的口径），
   也没有 usage-type provider 宿主 ⇒ 齿轮里**不给**这些行（`src/usageViewGear.ts:71-73` 注释逐条登记）。
7. **`references` 平表仍是在用的数据源**：树形行的宿主（R-1）没接之前，界面还是平表。
   这不是"放了个假的后端"，而是"模块侧完成、宿主挂点在别人的保留文件里"——已写请求。
8. **旧存档**：新增两把键 `taocode.usagesGroupByFileStructure`（默认 true）、
   `taocode.usagesGroupByDirectory`（默认 false，已存在）。`readStoredFlag(key, fallback)`
   缺键取默认（`src/referenceContents.ts:45-54`），不按字段数量判损坏。

## 7. 需要主代理接的线

见 `docs/wiring-requests-2026-10-06-usage3.md`：
**R-1**（App.vue 的引用面板换成 `referenceRows` + 速度搜索输入框，与
`docs/wiring-requests-2026-10-06-navigation2.md` 的 N-1 是同一条挂载点，两份合并即可）、
**R-2**（把 LSP `documentSymbol` 交给 `provideUsageSymbols`）、
**R-3**（层级面板加那个 `<select>`，选项表与求值都在模块里）。
另：`tests/module-size.test.mjs` 里 `src/bridge.ts` 那条红是别人在途的改动（904 → 910），
不在本批文件面里，请 bridge 的负责人处理。
