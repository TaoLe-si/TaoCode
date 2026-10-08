# batch-2026-10-06-hierlevel — 类型/调用层次：「范围下拉 + 行模型」模块侧契约（W-2）

> 路别：hierlevel。**只做一件事**：Type Hierarchy / Call Hierarchy 的「范围下拉 + 行模型」模块侧契约。
> 上游基准树：`D:\Backup\Downloads\intellij-community-master\intellij-community-master`（唯一事实来源）。
> `third_party/intellij-community` 为坏树，禁用。本地无 zh 语言包 ⇒ 一切中文措辞标「无法核实」。
> 规约：`.tools/agent-rules.md`（已通读）。保留文件（`src/App.vue`、`src/bridge.ts`、`src/components/CodeEditor.vue`、
> `native/main.cpp`、`scripts/verdict_table.py`、`docs/inventory/**`、`src/settingsModel.ts`、`tsconfig.json`、
> `package.json`、`CMakeLists.txt`、`src/tokens.css`、`src/style.css`、`src/uiIcons.ts`）**一个字都没写**。
> 并发黑名单（`src/usageViewGrouping.ts`、`src/referenceContents.ts`、`src/usageViewGear.ts`、`src/errorTree*`、
> `src/menus/**`、`src/commit*`、`src/vcsLog*`、`src/todo*`、`src/terminal*`、`src/patch*`、`src/codeLens*`）
> **只读过、没写过**（`usageViewTreeModel.ts` 不在黑名单里，也只 import 未改）。未 commit、未 push、
> 没跑任何 `checkout/reset/stash/clean/add` 类命令。全量 `npm test` **没跑**（只跑本域）。

## 0. 结论速览（三问三答，细节在 §8/§9）

**① 上游有几档、每档的判定条件；本仓给了几档、哪一档是假控件**
固定五档（`HierarchyBrowserScopes.java:8-12`）+ 命名作用域那一族（本仓无宿主 ⇒ 不给）。
判定条件是**两处两份**：查询侧 `getSearchScope`（`HierarchyTreeStructure.java:132-158`）与
逐节点 `isInScope`（`:161-199`），同一档两处口径自己就不一致（`This Module`：查询侧
`module.getModuleScope(true)` 含测试源 `:139-140`，过滤侧 `module.getModuleScope().contains(vf)`
不含 `:167-168`）。控件**不挂在基类**（`HierarchyBrowserBaseEx.java:489-490` 的 `prependActions`
是空实现），由子类逐个加 ⇒ 调用层次有（`CallHierarchyBrowserBase.java:61`）、方法层次有
（`MethodHierarchyBrowserBase.java:85`）、类型层次只在 Java/Kotlin 有且**「父类型」视图被显式禁用**
（`java/java-impl/src/com/intellij/ide/hierarchy/type/TypeHierarchyBrowser.java:47-54`、
`KotlinTypeHierarchyBrowser.kt:34-40`）、**LSP 路径两种层次都把它摘掉**
（`LspCallHierarchyBrowser.kt:30-35` remove、`LspTypeHierarchyBrowser.kt:33-37` 不调 super），
且 `LspAbstractHierarchyTreeStructure.kt:20-30` 从头到尾没调过 `isInScope`/`getSearchScope`。
⇒ 本仓「五档 × 两种层次 × 四个方向一视同仁」里，**假控件那一档 = 类型层次的「父类型」方向整条下拉**
（上游 `isEnabled()=false` + `SupertypesHierarchyTreeStructure.java` 全文零 scope 引用）。
另有一处**半拉子**：「生产代码」只做"非测试源"、缺"工程内"那一半（上游 `:175`），
而本仓有真判定源（库/JDK 节点的 `path` 是绝对路径：`native/lsp_host_bootstrap.cpp:18-31`
`uri_to_relative` 落在根外原样返回；`src/filenameWidget.ts:145` 已有 `isAbsolutePath`）⇒ 本批补上。

**② 层次树行的身份 / 展开态 / 计数与用法树是否同源**
上游**两者都不字符串化、也互不同源**：用法树认 `Usage`/`GroupNode` 对象身份
（`platform/usageView-impl/src/com/intellij/usages/impl/Node.java:19`、`GroupNode.java:105-107`、
`:276-280`），层次树认 `HierarchyNodeDescriptor` 对象 + `TreePath`
（`HierarchyBrowserBaseEx.java:596-605` 的 `saveCurrentTreeState` 存 `TreeBuilderUtil.storePaths`
抓出来的路径、`:607-615` 还原、`:616-647` 的 `doRefresh` 把这一对夹在重建两侧）。
本仓两边都必须自造字符串键 ⇒ **形状应同源，实现没有一份可直接 import**：
`usageViewGrouping.ts:573-582` 的 `UsageLevelCount` / `:655-666` 的 `carryUsageExpansion` 吃 `UsageTreeNode`
（该文件本批黑名单、只读）；`usageViewTreeModel.ts:210-217` 的 `usageTreeRowIds` / `:275-315` 的
`carryUsageTreeExpansion` 签名钉在 `UsageTreeRow`（`kind` 只允许 `directory|file|class|method|usage`，
还要 `path/line/character/count/collapsible`），层次节点一个都给不出（硬凑就是编数据）。
⇒ 本批**复用能复用的那一份**（`usageTreeToggleLabel` —— 原本 `hierarchyRenderer.ts` 自己又拼了一遍
「展开/收起 + 名字」），其余按**同一条规则**（内容派生键 + `NUL#出现次` 后缀 + 只沿用还存在的键）在
`src/hierarchyRows.ts` 实现，文件头写清"为什么不能直接调用"。
计数那一格：上游层次行**根本没有计数格**（`HierarchyNodeRenderer.java:32-43` 只画文本 + 图标；
`HierarchyNodeDescriptor.java:97-99` 那个 `getUsageCountPrefixAttributes()` 只是"次要色"样式档，
`:101-103` 把它给了包名段），所以 `UsageLevelCount` 的 own/child/total 三格账**不搬**，
本仓只保留面板已在用的 `kept / total`（`scopeNotice`），并把它的分母从"第二次建一整条数组只为取长度"
收成 `hierarchyVisibleNodeCount` 一份遍历。

**③ 今天就能落模块侧的那一条**
「生产代码」补"工程内"半个条件（库/JDK 类型不再混进生产结果）+「类型层次 · 父类型」撤掉假下拉
（模块不给档，宿主的 `v-if` 交请求）+ 行模型（稳定 id、展开态跨重建沿用、单趟计数）。三条都有判据。

## 1. 判词表

| 族 | 项 | 判定 | 上游相对路径:行号 | 本仓落点文件:行号 | 一句话说明 |
| --- | --- | --- | --- | --- | --- |
| lp/hierarchy | 五档 id / 下拉序 / 默认档 | `[x]` 已在（本批逐行复核，一字未改） | `platform/lang-impl/src/com/intellij/ide/hierarchy/HierarchyBrowserScopes.java:8-12`；`HierarchyBrowserBaseEx.java:770-776`、`:811-812`、`:165` | `src/hierarchyScopes.ts:107-113`、`:116` | 上一批按 `getValidScopes()` 改对了序，本批核对一致 |
| lp/hierarchy | **每档判定条件"两处两份"**（查询侧 + 逐节点） | `[x]` 本批新登（此前仓里只登了 `isInScope` 一份） | `HierarchyTreeStructure.java:132-158`（`getSearchScope`）、`:161-199`（`isInScope`）；不一致那一处 `:139-140` vs `:167-168` | `src/hierarchyScopes.ts:1-63`（文件头依据段） | `This Module` 上游两处口径自己就不一样，如实写清 |
| lp/hierarchy | 「生产代码」的"工程内"半个条件 | `[x]` 本批补齐 | `HierarchyTreeStructure.java:175`（编译元素要 `PsiManager.isInProject`）、`:177`（`!TestSourcesFilter.isTestSources`） | `src/hierarchyScopes.ts:136-145`（`case 'Production'`）、import 说明 `:96-103` | 判定源 = 层级项 `path` 的绝对性（`native/lsp_host_bootstrap.cpp:18-31`、`src/filenameWidget.ts:145`）；库/JDK 节点不再混进生产档 |
| lp/hierarchy | **范围的适用面**（哪一个视图/方向真有这只下拉） | `[x]` 本批新增 | `HierarchyBrowserBaseEx.java:489-490`（基类不加）、`CallHierarchyBrowserBase.java:53-61`、`MethodHierarchyBrowserBase.java:82-85`、`TypeHierarchyBrowserBase.java:89-94`、`java/java-impl/src/com/intellij/ide/hierarchy/type/TypeHierarchyBrowser.java:47-54`、`plugins/kotlin/.../types/KotlinTypeHierarchyBrowser.kt:34-40`、`platform/lsp-impl/src/impl/features/hierarchy/call/LspCallHierarchyBrowser.kt:30-35`、`.../type/LspTypeHierarchyBrowser.kt:33-37` | `src/hierarchyScopes.ts:208-271`（`HierarchyViewKind`/`HierarchyViewDirection`/`HierarchyScopeSupport`/`hierarchyScopeSupport`/`isHierarchyScopeSelectable`）、消费 `src/hierarchyView.ts:85`、`:123`、`:138`、`:140` | 假控件那一档 = 类型层次·父类型 ⇒ 模块给**空表**，宿主按 `hierScopeSupported` 决定画不画（请求 H-1） |
| lp/hierarchy | 范围**按 sheet 各存一份** + 应用级初始档 | `[x]` 本批新增 | `HierarchyBrowserBaseEx.java:820-826`（`selectScope`：先写 `sheet.myScope` `:821`、再写 `settings.SCOPE` `:822`、再 `doRefresh(true)` `:825`）、`:649-651`（`getCurrentScopeType`）、`:165`（新 sheet 的初始档） | `src/hierarchyView.ts:79-99`（`hierScopeLast` / `hierScopeSheets` / `hierSheetKey` / `hierScope` computed）、`:121-133`（`pickHierarchyScope` 两处一起写） | 原来四个方向共用一格，切回来就把用户选的档丢了 |
| lp/hierarchy | 层级行的**稳定 id** | `[x]` 本批新增 | 上游是对象身份：`HierarchyTreeStructure.java:60-68`（`createDescriptor`）、`LspAbstractHierarchyTreeStructure.kt:47-54`、`:56-64`（`mapNotNull` 那一条已在 `src/hierarchyView.ts` 登记过） | `src/hierarchyRows.ts:60-96`（`hierarchyItemKey` + `hierarchyRowIds`）、`src/hierarchyView.ts:101-118`（每行带 `id`）、`:157` | 面板 `:key` 仍钉 `index` ⇒ 请求 H-2（改 `:key` 会撞一条锚点，一并给出） |
| lp/hierarchy | 层级行**展开态跨重建沿用** | `[x]` 本批新增 | `HierarchyBrowserBaseEx.java:596-605`、`:607-615`、`:616-647`、`:456-457`（`TreeUtil.promiseExpand`） | `src/hierarchyRows.ts:112-180`（`hierarchyNodePath`/`captureHierarchyExpansion`/`planHierarchyExpansion`）、`src/hierarchyView.ts:222-277`（`expandHierarchyNode`/`applyHierarchyExpansion`/`reloadHierarchy` 里那一对） | 刷新/换方向后用户展开的那几层不再被丢掉；补查带 generation 守卫、同一节点最多补一次 |
| lp/hierarchy | 层级行计数与用法树 `UsageLevelCount` 三格账同源 | `[-]` **不适用**（具体理由） | `HierarchyNodeRenderer.java:32-43`（一行只画"复合文本 + 图标"）、`HierarchyNodeDescriptor.java:97-99`、`:101-103` | `src/hierarchyRows.ts:5-20`（不复用的逐条理由）、`:98-108`（只保留面板已在用的 `kept/total` 分母） | 上游层次行没有计数格；把 own/child/total 搬过来就是给屏上不存在的格子编数 |
| lp/hierarchy | LSP 层次的**自动展开深度**（根的直接孩子那一层） | `[ ]` 未做 | `platform/lsp-impl/src/impl/features/hierarchy/call/LspCallHierarchyBrowser.kt:59-71`（`DefaultTreeUI.AUTO_EXPAND_FILTER` + `skipAutoExpand(node)=node.parent.parent != null`） | —— | 照做 = 每次刷新把第一层全部再发一遍请求；登记 §6，不偷偷做 |
| lp/hierarchy | 折叠按钮「展开/收起 X」两份写法 | `[x]` 本批收敛 | 本仓既有规则：`src/usageViewTreeModel.ts:185-187`（判据 `tests/usage-view-panel-rows.test.mjs:73` 钉着） | `src/hierarchyRenderer.ts:39-42`（import）、`:141`（`usageTreeToggleLabel(!node.expanded, label).trim()`） | 层级侧不再自己拼一遍；输出逐字不变（含 `trim()`） |
| lp/hierarchy | 命名作用域那一族 + `ConfigureScopesAction` | `[-]` 无宿主 | `HierarchyBrowserBaseEx.java:778-782`、`:815`、`HierarchyTreeStructure.java:185-199` | `src/hierarchyScopes.ts:256-266`（文件头登记） | 本仓没有命名作用域宿主，给了就是假控件（与上一批同一条判定，未改） |
| 文案 | 「范围/生产代码/测试/全部/本类/本模块」等中文措辞 | `[-]` **无法核实** | 本地参考树没有 zh 语言包（`resources/messages/*_zh.properties` 不在树里） | `src/hierarchyScopes.ts:107-113` | 沿用上一批的英文直译，本批**一个新字面量都没加**（新逻辑一律不给文案） |
| 派单候选类名 | `SuperTypesHandler` / `SubTypesHandler` | `[-]` **无法核实**（参考树里不存在） | 全树 `find -iname "*SuperTypesHandler*" -o -iname "*SubTypesHandler*"` = **0 命中** | —— | 语义对得上的是 `platform/lang-impl/src/com/intellij/ide/hierarchy/ViewSupertypesHierarchyAction.java`、`ViewSubtypesHierarchyAction.java`、`ViewClassHierarchyAction.java` 与 `actions/BrowseCallHierarchyAction.java`、`actions/BrowseTypeHierarchyAction.java` 一族（目录逐条 `ls` 过） |
| 派单候选类名 | `ClassHierarchyScope` | `[~]` 只有同名 **Descriptor**，不是这一族 | `java/java-impl/src/com/intellij/ide/util/scopeChooser/ClassHierarchyScopeDescriptor.java:30-40` | —— | 那是 scope chooser 的 descriptor（`extends ScopeDescriptor`），与层次窗的范围下拉无关；不把它当依据 |

## 2. 改动文件清单（`wc -l` 前后）

| 文件 | 前 | 后 | 这批改了什么 |
| --- | --- | --- | --- |
| `src/hierarchyScopes.ts` | 160 | 272 | 文件头补「两处两份判定 + 注册面矩阵 + 取舍留痕」；`Production` 补"工程内"；新增 `HierarchyViewKind`/`HierarchyViewDirection`/`HierarchyScopeSupport`/`hierarchyScopeSupport`/`isHierarchyScopeSelectable` |
| `src/hierarchyView.ts` | 256 | 333 | 范围改为**按 sheet（视图/方向）各存一份** + 应用级初始档；`hierScopeOptions` 按适用面给表、新增 `hierScopeSupported`；不支持的那一向写不进状态；行补稳定 `id`；`hierItemsFlat` 那第二条深度优先换成 `hierarchyVisibleNodeCount`；重建前后加展开态抓/贴（`expandHierarchyNode` 与 `toggleHierarchy` 合并成一份加载器）；`hierarchyKey` 改为 `hierarchyItemKey` 的别名（配方搬到模块） |
| `src/hierarchyRenderer.ts` | 138 | 143 | `toggleLabel` 改调 `usageViewTreeModel.ts` 的 `usageTreeToggleLabel`（消灭第二份拼法，输出逐字不变） |
| `src/hierarchyRows.ts` | —— | 180（新建） | 层级行模型：内容键、出现次后缀 id、可见节点计数、路径配方、展开态抓/贴的纯函数 |
| `tests/hierarchy-rows.test.mjs` | —— | 227（新建，12 条判据，全部 `HIERLEVEL` 前缀） | 覆盖适用面、父类型不可选、Production 两条件、内容键、id 后缀、计数、capture/plan、视图装配、行 `id`、文案同源、锚点 |
| `tests/hierarchy-view-scope.test.mjs` | 64 | 85 | 一条源码锚点因契约演进改钉（**不放松**，改成引用相等 + 两条新锚点，逐字理由写在测试里 `:61-70`） |
| `docs/batch-2026-10-06-hierlevel.md` | —— | 本文件 | 交付 |
| `docs/wiring-requests-2026-10-06-hierlevel.md` | —— | 交付 | 宿主那一半（H-1/H-2/H-3），含净行数核算 |

## 3. §5 每条自查命令的前后数字

| 命令 | 接手时（前） | 收工时（后） |
| --- | --- | --- |
| `node --test tests/hierarchy-{scopes,view-scope,renderer,refresh,cache,export}.test.mjs tests/module-size.test.mjs` | **42 pass / 0 fail**（7 个文件） | **54 pass / 0 fail**（8 个文件，+12 条 `HIERLEVEL`） |
| `npx vue-tsc -b --force`（全仓） | 未跑（12 路并行，基线不可信） | **0 错**（无输出、exit 0） |
| 隔离 tsconfig `tsc --noEmit`（本域 7 个 `.ts`，临时配置写在 `build/` 下、跑完已删） | 未跑 | **0 错（EXIT=0）** |
| `node .tools/find-orphan-modules.mjs --gate` | 未跑（本批基线只跑域测试） | **门禁绿**：已登记孤儿 6 / 基线 8 · 新增 0 · 本轮清掉 2（`src/jarRun.ts`、`src/runAnythingContext.ts`，都不是本批）；词法自检 0 异常 |
| `node .tools/find-missing-ext.mjs` | 未跑 | **干净**（扫 1379 个文件，三种 import 形态） |
| `node .tools/find-param-props.mjs` | 未跑 | **共 0 处参数属性** |
| `node .tools/find-ts-in-mjs.mjs` | 未跑 | **干净：tests/*.mjs 全部是纯 JavaScript** |
| `node --test tests/source-citations.test.mjs tests/source-citation-anchors.test.mjs` | 未跑（**这三条红在本批动手前就在**，红的落点全是别人的文件） | **11 tests / 8 pass / 3 fail**：`docs/batch-2026-10-06-findrep2.md` 的 `ConsoleViewImpl.kt:999999-999999` 行号越界；快照 `moved` 4 条在 `src/commitChecks.ts`、`src/components/ProblemsPanel.vue`（×2）、`src/runStartupFocus.ts`。**本批 6 个文件零命中**（我的 27 条新引用全部"指得到"，见 §4 的核对方式） |
| 全量 `npm test` | —— | **没跑**（规约：12 路并行只跑本域） |
| ctest / `npm run test:native` | —— | **不适用**：本批没写 `native/` 任何文件（只读了 `native/lsp_host_bootstrap.cpp`、`native/lsp_session*.cpp` 作为路径形态依据） |

## 4. 反向验证记录（HIERLEVEL 注入 → 红 → 还原 → sha1 → grep 0 残留）

1. **注入前**取 sha1：`src/hierarchyScopes.ts = 902e8ac096f8638c94a148cef5532170e8515f10`
   （同批留底，收工时的终值：`src/hierarchyView.ts = 0212e8d33460778450af2bd6580e94aaf7994322`、
   `src/hierarchyRows.ts = 2c4b78775982121ac798ec21dae68517f05d5448`、
   `src/hierarchyRenderer.ts = 66e887a0df49e2685025a864ab7215617532efe6`、
   `tests/hierarchy-rows.test.mjs = ea88b6987570239af0f559a852f6fc56118b4025`、
   `tests/hierarchy-view-scope.test.mjs = 0a647c0b724f352c4f9b4d2ce9045cf71412dd38`；
   注入只动了 `hierarchyScopes.ts`，其余四个文件的 sha1 从留底到收工一字未变）。
2. **注入的违规**：把 `hierarchyScopeSupport` 的守卫改成
   `// HIERLEVEL-INJECT` + `if (false && kind === 'type' && direction === 'supertypes') return SUPERTYPES_UNSUPPORTED`
   —— 也就是"把上游禁用的那一向重新当支持"（= 重新放假控件）。
3. **红了**：`node --test tests/hierarchy-rows.test.mjs tests/hierarchy-view-scope.test.mjs`
   ⇒ **tests 17 / pass 14 / fail 3**，红的正是
   `HIERLEVEL 范围适用面…`、`HIERLEVEL 父类型那一向任何档都不可选…`、`HIERLEVEL 视图：父类型方向没有下拉…` 三条。
4. **撤掉注入**后：`sha1sum src/hierarchyScopes.ts` = **902e8ac096f8638c94a148cef5532170e8515f10**（与第 1 步逐字相同）；
   `grep -rn "HIERLEVEL-INJECT" src tests docs | wc -l` = **0**（无残留）。
5. **复绿**：8 个文件全跑 ⇒ **tests 54 / pass 54 / fail 0**。
6. 附带一次同源核对：`tests/source-citations.test.mjs` 会把仓里每条"路径:行号"按图索骥打开一遍，
   本批新增/修订的 27 条引用（含 `TypeHierarchyBrowser.java:47-54`、`KotlinTypeHierarchyBrowser.kt:34-40`、
   `HierarchyBrowserBaseEx.java:820-826`、`native/lsp_host_bootstrap.cpp:18-31`）**全部通过**，
   红的那三条落点没有一个在本批文件里。

## 5. 零消费方自查结论

- `src/hierarchyRows.ts`：被 `src/hierarchyView.ts:16` import（`captureHierarchyExpansion`/`hierarchyItemKey`/
  `hierarchyRowIds`/`hierarchyVisibleNodeCount`/`planHierarchyExpansion`/`HierarchyRowNode` 六个出口全有用到），
  且 `HierarchyNode extends HierarchyRowNode`（`src/hierarchyView.ts:38`）把形状钉死 ⇒ **不是死模块**。
- `src/hierarchyScopes.ts` 新增的三个出口：`hierarchyScopeSupport` 被视图 `:85` 用、
  `isHierarchyScopeSelectable` 被 `pickHierarchyScope`（`:123`）用、类型 `HierarchyViewKind`/`HierarchyViewDirection`
  被 sheet 键（`:81`）与 `hierScope` computed（`:94`）用 ⇒ 无零消费出口。
- `hierarchyNodePath` 在模块内被 `captureHierarchyExpansion` 用，且判据直接断言它（`tests/hierarchy-rows.test.mjs` 的
  `抓下来的就是那一条路径（配方只有一份）`）⇒ 不留"只有测试用"的路径配方。
- `.tools/find-orphan-modules.mjs --gate` 实跑：**新增 0**（见 §3）。

## 6. 做不到 / 无法核实清单

1. **上游 LSP 路径（= 本仓唯一数据源）根本不注册范围动作**：`LspCallHierarchyBrowser.kt:30-35` 调完 super 后
   把所有 `ChangeScopeAction` remove、`LspTypeHierarchyBrowser.kt:33-37` 不调 super，
   `LspAbstractHierarchyTreeStructure.kt:20-30` 也从不按范围过滤。严格照抄 = 整条下拉都不该出现。
   本批只撤了**上游自己也禁用**的那一向（类型层次·父类型），其余三向保留（本仓的路径过滤是真判定源、按了确实改屏），
   取舍写在 `src/hierarchyScopes.ts:44-63` 与本文件 §8.4。**请主代理判**：若判"整条撤"，
   `src/hierarchyScopes.ts` 的五档过滤与 `tests/hierarchy-scopes.test.mjs` 一并退回，本批不擅自做这个决定。
2. **「本模块」档仍是"一级目录"近似**：本仓 `Workspace{name, root, entries}` 没有 Module 表
   （`src/bridge.ts` 只读，未加字段），上游那一档用的是 `module.getModuleScope(true)`（`HierarchyTreeStructure.java:139-140`）
   与 `module.getModuleScope().contains(vf)`（`:167-168`）—— **两处口径自己就不一致**，本仓无法等价；
   差异原文留在 `src/hierarchyScopes.ts:30-37`。
3. **「生产代码」的"工程内"用路径绝对性近似**：判定源是 `native/lsp_host_bootstrap.cpp:18-31`
   （`uri_to_relative` 只有落在工作区根内才剥前缀，根外原样返回绝对路径）+ `src/filenameWidget.ts:145`。
   但**库内条目（`jar!/…` 那种形态）本仓没取到真机样本** ⇒ 若某台服务器把 jar 内条目回报成"相对形态"，
   这一半就判不出；未验证 ⇒ 标无法核实，不编逻辑。
4. **LSP 层次的自动展开深度**（`LspCallHierarchyBrowser.kt:59-71`：只对根的直接孩子那一层自动展开）没做：
   照做等于每次刷新/换方向把第一层全部再发一遍请求（请求放大），且会盖掉用户自己收起的意图。
   具体卡在"本仓的展开态是逐节点布尔、没有 JTree 的 AUTO_EXPAND 通道"。
5. **层级行的"本地改动角标"**仍未接（`HierarchyNodeRenderer.java:45-50`）：本仓 `git.status` 是整仓一次，
   层级节点可能指向库文件（见第 3 条），拿不到"这一个节点的文件有没有被改"。原状保留，未放假角标。
6. **中文措辞**：本地树没有 zh 语言包 ⇒ 本批**一个新界面字面量都没加**（`supported`/`tiers`/`reason` 是模块内字段，
   不上屏），既有五档中文名沿用上一批的直译。
7. **方法层次**（`MethodHierarchyBrowserBase.java:82-85` 那一档，Alt+Ctrl+U 的 override 层次）本仓没有这个视图 ⇒
   `hierarchyScopeSupport` 的入参类型里根本没有它，不编一档界面。
8. **`SuperTypesHandler` / `SubTypesHandler`**：派单给的这两个类名在参考树里**不存在**（`find` 全树 0 命中）⇒ 无法核实，
   见 §1 最后一行给的替代族名。
9. 未做（**本域还剩的可见项**）：宿主那两行（`:key` 与 `v-if`）不在本代理可改面 ⇒ 交请求 H-1/H-2。

## 7. 需要主代理接的线

见 `docs/wiring-requests-2026-10-06-hierlevel.md`（H-1 范围下拉的 `v-if` / `:disabled`、H-2 层级行 `:key` 换稳定 id
（含会撞的那条锚点的原样替换段）、H-3 "隐藏 vs 灰掉"的取舍）。**净行数核算：三处都在既有行内，App.vue 净 0 行；
`src/bridge.ts` 一个字没动（0 贴顶不变）。**

## 8. 问题① 详解：范围的档数、判定条件、注册面

### 8.1 档数与呈现（`HierarchyBrowserScopes.java:8-12` + `HierarchyBrowserBaseEx.java:770-776`）

| # | 常量（id） | 下拉呈现名 | 上游呈现名出处 | 本仓 label |
| --- | --- | --- | --- | --- |
| 1 | `SCOPE_PROJECT = "Production"`（`:8`） | Production | `:772` `ProjectProductionScope.INSTANCE` | 生产代码 |
| 2 | `SCOPE_TEST = "Test"`（`:12`） | **Tests** | `:773` `TestsScope.INSTANCE`（常量是 `Test`、屏上是 `Tests`，两个字符串不是一回事） | 测试 |
| 3 | `SCOPE_ALL = "All"`（`:9`） | All | `:774` `CustomScopesProviderEx.getAllScope()` | 全部 |
| 4 | `SCOPE_CLASS = "This Class"`（`:10`） | This Class | `:775` + `LangBundle.properties:348` | 本类 |
| 5 | `SCOPE_MODULE = "This Module"`（`:11`） | This Module | `:776` + `LangBundle.properties:349` | 本模块 |
| 6+ | 命名作用域 | —— | `:778-782`（`NamedScopesHolder.getAllNamedScopeHolders` 的 `getEditableScopes()`） | **不给**（本仓没有宿主） |
| 尾 | `ConfigureScopesAction` | —— | `:815` | **不给**（同上） |

按钮上显示的"当前档" = `getPresentableNameMap()`（`:237-241`，`HashMap`，**不是**下拉序）
经 `ChangeScopeAction.update` 的 `presentation.setText(myI18nMap.getOrDefault(scopeType, () -> scopeType))`（`:795`）。
⇒ 留痕：本仓 `src/hierarchyScopes.ts` 原来把那张 `HashMap` 当下拉序，上一批已改（`:64-74` 的留痕注一字未动）。

### 8.2 每档的判定条件（两处两份，逐条）

| 档 | 查询侧 `getSearchScope`（`:132-158`） | 逐节点 `isInScope`（`:161-199`） | 本仓等价（`nodeInScope`，`src/hierarchyScopes.ts:131-152`） |
| --- | --- | --- | --- |
| This Class | `:134-136` `new LocalSearchScope(thisClass)` | `:162-164` `PsiTreeUtil.isAncestor(baseClass, srcElement, true)` | 与根**同一文件**（本仓没有"祖先元素"） |
| This Module | `:137-140` `module.getModuleScope(true)`（含测试；module 找不到就退回 `LocalSearchScope`） | `:165-169` `module != null && module.getModuleScope().contains(vf)`（**不含 includeTests**） | 与根同一个**一级目录**（近似；两处不一致无法等价 ⇒ §6.2） |
| Production | `:141-143` `GlobalSearchScopesCore.projectProductionScope` | `:170-177` 两支：`:175` 编译元素必须 `PsiManager.isInProject`；`:177` `!TestSourcesFilter.isTestSources` | **本批补齐两支**：`!isAbsolutePath(path) && !isTestPath(path)` |
| Test | `:144-146` `projectTestScope` | `:178-181` `TestSourcesFilter.isTestSources` | `isTestPath`（复用 `src/navGotoTest.ts` 那一份，不分叉） |
| All | **没有分支** —— 落到方法开头的默认 `allScope`（`:133-134`），`:147` 的 else 里 `namedScope == null` 什么也不改 | `:182-184` `return true` | `return true` |
| 命名作用域 | `:147-150` `GlobalSearchScopesCore.filterScope` | `:185-199` `NamedScope`/`PackageSet.contains`；`namedScope == null ⇒ false`（`:186-188`） | 未知档 ⇒ `false`（不收，也不误伤全部） |

另有一条 `Scratch` 文件的并集（`:152-157`，根在 scratch 文件里时把该文件并进范围）—— 本仓没有 scratch 概念，不适用。

### 8.3 控件的注册面（决定"哪一向真有这只下拉"）

| 视图 | 有没有范围动作 | 上游坐标 |
| --- | --- | --- |
| 基类 `HierarchyBrowserBaseEx` | **不加**（`prependActions` 空实现） | `:489-490`（`appendActions:483-487` 先调它再加 RefreshAction） |
| 调用层次（Java 等原生） | 有 | `CallHierarchyBrowserBase.java:53-61`（`:61` add） |
| 方法层次 | 有 | `MethodHierarchyBrowserBase.java:82-85`（`:85` add） |
| 类型层次基类 | **不加** | `TypeHierarchyBrowserBase.java:89-94`（只加 ViewClassHierarchy/ViewSupertypes/ViewSubtypes/AlphaSort） |
| 类型层次（Java） | 加，但**父类型视图禁用** | `java/java-impl/src/com/intellij/ide/hierarchy/type/TypeHierarchyBrowser.java:47-54`（`:49` add、`:51-52` `isEnabled()`） |
| 类型层次（Kotlin） | 同上 | `plugins/kotlin/code-insight/kotlin.code-insight.k2/src/org/jetbrains/kotlin/idea/k2/codeinsight/hierarchy/types/KotlinTypeHierarchyBrowser.kt:34-40`（`:36` add、`:37-39`） |
| 调用层次（**LSP**） | **摘掉** | `platform/lsp-impl/src/impl/features/hierarchy/call/LspCallHierarchyBrowser.kt:30-35` |
| 类型层次（**LSP**） | **没有** | `platform/lsp-impl/src/impl/features/hierarchy/type/LspTypeHierarchyBrowser.kt:33-37` |

**方向侧的判定源**（证明"禁用"不是 UI 习惯而是真没判定源）：
`CallerMethodsTreeStructure.java:90`（只用查询侧）、`CalleeMethodsTreeStructure.java:73,80` + `:51`（两处都用）、
`SubtypesHierarchyTreeStructure.java:47`（用查询侧）、
**`SupertypesHierarchyTreeStructure.java` 全文零 scope 引用**（只有 `:35` 的 `psiClass.getResolveScope()`，那是解析域）。

### 8.4 本仓现状与判定的差（一句话版）

本仓原来把五档无差别挂到 `call × {incoming,outgoing}` 与 `type × {supertypes,subtypes}` 四个组合上
（`hierScope` 一格、`hierScopeOptions = HIERARCHY_SCOPES`），
⇒ **多出来的一档 = `type × supertypes`**（上游 `isEnabled()=false` 且无判定源）= 本批认定的假控件，模块侧给空表；
另 **缺两半** = `Production` 的"工程内"（已补）与"范围按 sheet 各存一份 / 新 sheet 读应用级档"（已补）。
本仓只撤自己判定不了的那一向，其余保留 —— 取舍与退路写在 `src/hierarchyScopes.ts:44-63`、本文件 §6.1。

## 9. 问题② 详解：身份 / 展开态 / 计数是否与用法树同源

| 格 | 上游·层次树 | 上游·用法树 | 本仓·层次树（本批后） | 本仓·用法树 | 能否直接复用那份实现 |
| --- | --- | --- | --- | --- | --- |
| 行身份 | `HierarchyNodeDescriptor` **对象**（`HierarchyTreeStructure.java:60-68`；LSP 侧 `LspAbstractHierarchyTreeStructure.kt:47-54` 的 `mapNotNull`），路径靠 `TreePath`（`HierarchyBrowserBaseEx.java:603`） | `Node extends DefaultMutableTreeNode`（`impl/Node.java:19`），去重靠比较结果（`impl/GroupNode.java:105-107`、`:276-280`），兜底 `System.identityHashCode`（`:343-346`） | **内容派生键** `hierarchyItemKey`（path+name+kind+line+character）+ 出现次后缀 `NUL#n`（`src/hierarchyRows.ts:60-96`） | `usageTreeRowIds`（同样内容派生 + `NUL#n`，`usageViewTreeModel.ts:210-217`） | **不能**：`usageTreeRowIds(rows: readonly UsageTreeRow[])` 需要 `kind/path/line/character/count/collapsible`，层次节点只有 `item/children/ancestors/expanded`。⇒ 规则照抄、函数各一份（`src/hierarchyRows.ts:5-20` 写明） |
| 展开态跨重建 | `saveCurrentTreeState`→`storePaths`（`:596-605`）→ 丢 sheet 重建 →`restoreTreeState`→`expandLater`→`TreeUtil.promiseExpand`（`:607-615`、`:456-457`、`:616-647`） | `captureUsagesExpandState`/`restoreUsageExpandState`（`platform/usageView-impl/src/com/intellij/usages/impl/UsageViewImpl.java:1271-1288`、`:1291-1307`；调用点 `:1231`、`:1261`），另有应用级 `IS_EXPANDED`（`UsageViewSettings.kt:63-64`） | `captureHierarchyExpansion`（只抓展开着的）+ `planHierarchyExpansion`（认回来才贴；没取过下级的进 `load`）（`src/hierarchyRows.ts:112-180`），视图带 generation 守卫应用（`src/hierarchyView.ts:222-277`） | `carryUsageTreeExpansion`（按行 id 对账，`usageViewTreeModel.ts:275-315`）与 `carryUsageExpansion`（按组键 + `UsageExpansionMode`，`usageViewGrouping.ts:655-666`） | **不能**：前者入参是 `UsageTreeRow[]`；后者入参是 `UsageTreeNode`，且 `usageViewGrouping.ts` 在本批黑名单（只读）。⇒ 三条差异登记在 `src/hierarchyRows.ts:23-49`：层次是**懒加载**（`children===null` ⇒ "能不能收"根本不知道，所以不套用法侧"空壳组不给箭头"那条规则）；层次认的是**路径**（同一个符号可能在两个父下各出现一次）；层次没有"全展开/全折叠"两个工具条动作可存 |
| 计数 | **没有计数格**（`HierarchyNodeRenderer.java:32-43` 只画文本+图标；`HierarchyNodeDescriptor.java:97-99`/`:101-103` 那个"usage count"属性只是**次要色样式档**，给包名段用） | `GroupNode.getUsageNodes()`/`getSubGroups()`/`getRecursiveUsageCount()`（`impl/GroupNode.java:409-417`/`:399-407`/`:363-366`），屏上 `usage.view.counter`、速度搜索、导出三处都读它 | 只留面板已在用的 `kept / total`（`scopeNotice`），分母换成 `hierarchyVisibleNodeCount` 单趟计数（`src/hierarchyRows.ts:98-108`） | `UsageLevelCount`（own/child/total 三格，`usageViewGrouping.ts:573-582`）与 `UsageTreeLevelCount`（按层汇总，`usageViewTreeModel.ts:320-333`） | **不该搬**（`[-]`）：给屏上不存在的格子编数 = 放假数据。理由原文在 `src/hierarchyRows.ts:9-20` |
| 折叠按钮文案 | `expandOnDoubleClick()==false`（`HierarchyNodeDescriptor.java:130`，本仓无需） | 「展开 X / 收起 X」由 `usageTreeToggleLabel` 一份说了算 | **本批改调同一份**（`src/hierarchyRenderer.ts:42`、`:141`），输出逐字不变 | 同一份 | **能，且已经用了**（本批唯一的真复用） |

## 10. 订正留痕（原写 X、实际 Y）

1. `src/hierarchyView.ts` 原写"范围是 `HierarchyTreeStructure.setScopeType` 之后的过滤条件、切换只影响呈现" ⇒
   **实际**：参考树里**没有** `setScopeType` 这个方法（`HierarchyTreeStructure.java` 只把 `scopeType` 当参数收：`:132`、`:161`）；
   真实形态是 `selectScope`（`HierarchyBrowserBaseEx.java:820-826`）写两份档 + `doRefresh(true)` 重建当前 sheet。
   留痕写在 `src/hierarchyView.ts:61-78`。
2. 原写"默认档依据 = `HierarchyTreeStructure.java:161` 之前那两行的 `allScope` 兜底" ⇒ **实际**：`allScope` 是
   `getSearchScope` 方法开头的默认值 `:133-134`，`SCOPE_ALL` 在查询侧根本没有分支（`:147` 的 else 里 `namedScope==null` 时什么都不改）；
   屏上那一档的兜底在 `HierarchyBrowserBaseEx.java:165`。已按此改写依据段（`src/hierarchyScopes.ts:80-86`）。
3. 原写"「生产代码」只实现非测试源那一半，因为库文件判不出工程内外" ⇒ **实际**：判得出 ——
   `native/lsp_host_bootstrap.cpp:18-31` 的 `uri_to_relative` 对根外文件**原样返回绝对路径**，
   本仓 `src/filenameWidget.ts:145` 已有绝对性判定 ⇒ 这一半今天就能补，本批补了（`src/hierarchyScopes.ts:136-145`）。
4. 原判据锚点 `const hierScopeOptions = computed(() => HIERARCHY_SCOPES)`（`tests/hierarchy-view-scope.test.mjs`）
   钉的是"表只有一份"的意思 ⇒ 契约演进后字面量必变；**不放松**，改成
   `assert.equal(view.hierScopeOptions.value, HIERARCHY_SCOPES)`（引用相等，比原来更强）
   + 两条新锚点（取表必须走 `hierarchyScopeSupport`、必须导出 `hierScopeSupported`）。逐字理由写在测试里。
5. 派单给的候选文件名里 `src/typeHierarchy*`、`src/callHierarchy*`、`src/lspNavigation.ts` 之外的
   `src/components/*Hierarchy*` **不存在**（`ls src/components` 只有 `ScopesSettingsPage.vue` 与层级无关）；
   本仓层级域的真实文件是 `src/hierarchy{Scopes,View,Renderer,Cache,Export}.ts`（已按此开工）。
6. **共享工作区留痕**：`tests/hierarchy-renderer.test.mjs` 在 `git status` 里是 `M`，**不是本批改的**
   （本批只新建 `tests/hierarchy-rows.test.mjs`、只改了 `tests/hierarchy-view-scope.test.mjs` 的那一条锚点）。
   那 16 行是别的代理在途加的"模板消费 row"锚点，本批全程没碰那个文件；它现在**是绿的**（含在本域 54 条里）。
   请求 H-2 要同批改的那条锚点就在**它的 `:118`**（`v-for="\(\{ node, depth, row \}, index\) in hierRows"`），
   主代理落 H-2 时注意别把它当成"在途红"漏掉。
