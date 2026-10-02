# B7 判决：`find` + `diff`（630 类）

上游切片：`docs/inventory/find-diff.txt`，由 `settings-run.txt` 里 `com/intellij/find/`（234）与 `com/intellij/diff/`（396）两个包前缀抽出。
机械信号：`docs/inventory/find-diff_signals.md` / `.json`，由 `python scripts/verdict_signals.py find-diff` 生成。

判决口径与 B1–B6 一致：

- `[x]` 已对标 —— 本仓有真实实现，且行为与上游同一档；
- `[~]` 部分 —— 本仓有对应物但缺关键面，缺口逐条写在 §B；
- `[ ]` 未对标 —— 本仓没有，且**不假装**有；
- `[-]` 不适用 —— 上游测试源码、平台专属、与本仓形态根本不同的东西。

每条 `[x]` / `[~]` 都必须在 §G 里指到 `src/` 或 `native/` 下一个真实存在的文件；这条由 `tests/b7-verdict.test.mjs` 判。

---

## 0. 机械信号总账

| 信号 | 值 | 说明 |
|---|---:|---|
| total | 630 | 切片内类总数（`find` 234 + `diff` 396） |
| unreadable | 0 | 全部能读到源码，没有路径失效 |
| test | 13 | 全部来自 `testSources/`，§G 一律 `[-]` |
| swing | 158 | 命中 `JComponent`/`JPanel`/`JBPopup` 等 Swing 符号 |
| platform | 10 | 额外命中 `Headless`/`CustomFrameDecoration`/`x11` |
| in_code | 6 | 类名在本仓源码里出现 |
| in_comment_only | 11 | 类名只在本仓注释里出现 |
| never | 613 | 本仓里既没有也没有提过 |

**这份账不能直接当判决用，`in_code` 这一列尤其要看清楚**：它是**类名的子串匹配**，命中的是 `Range`、`Side`、`LinkAction`、`impl`、`BreadcrumbsPlacement` 这类通用词，不是真的对标。同理 `in_comment_only` 里的 `FindUsagesManager`、`FindUsagesOptions`、`FindUsagesSettings`、`FindPopupScopeUIImpl`、`StatusPanel` 命中，是因为本仓在注释里引用了上游行号 —— 引用不等于实现。§A/§B 是逐个打开源码确认的，结论与这个粗信号并不总一致。

规模分布也值得记一笔：113 类在 25 行以内（基本是枚举/接口/异常），384 类在 26–150 行，133 类超过 150 行 —— 真正决定体验的是那 133 类，而它们绝大多数落在 `diff/tools/**`（查看器）、`diff/merge/**`（合并）、`find/impl/**`（查找工具窗）三块，这三块本仓**都没有**对应形态。

---

## A. `[x]` —— 已对标

本仓 find/diff 只有两条真实的路：**工程内查找替换**（原生）+ **文件间对比**（前端纯函数）。下面 11 类在这两条路上有真实对标。

### A1. 对齐内核：上游 `Enumerator`

`platform/util/diff/src/com/intellij/diff/util/Enumerator.kt:16-25` 用一张 `HashMap` 把每行映射成从 1 开始的整数 id，两段数组共用它 —— 这样算法内部只比整数，`IntArray` 的 `==` 就是字符串相等。

本仓 `src/diffAlign.ts:51` 的 `enumerate()` 一比一对应。**这一类没有缺口。**

### A2. `DiffTooBigException`

上游跑 Myers 时若差异量超过阈值就抛 `FilesTooBigForDiffException`（`MyersLCS.kt:186-188`），由 `Diff.kt:96-101` 接住并改走 Patience。

本仓 `src/diffAlign.ts:74` 有同义的 `FilesTooBigForDiff`，`alignLines` 捕获后退化为"整段一块改动"。异常本身对标了，**退路没有**，见 §E 第 1 条。

### A3. 查找替换的原生链路

`FindAndReplaceService` / `FindAndReplaceExecutor` / `TextSearchService` / `DirectorySearchEngine` / `DefaultDirectorySearchEngine` / `FindInProjectSearchEngine` 这 6 类在本仓合成一个实现：`native/search.cpp` 的 `run()` / `replace()` / `preview()` / `replace_selected()` / `list_files()`（`:383`、`:438`、`:488`、`:533`、`:430`），经 `src/bridge.ts` 的 `search.*` 暴露，界面是 `src/components/SearchPanel.vue`。

对上的行为包括：字面量与 ECMAScript 正则两档（`build_query_pattern`，`native/search.cpp:248`）、大小写与全词（`native/search.hpp:19-20`）、include/exclude glob、非 UTF-8 回退 GBK 并单独计数 `skippedNonUtf8`（`:230-243`）、8MB / 5000 命中 / 10 万文件三道上限（`:34-36`）、写临时文件再原子替换且临时文件自己不扫自己（`:269-271`、`:322`）。

### A4. `FindInProjectScopeService`

上游是命名作用域的注册与持久化服务；本仓 `src/scopes.ts` 把作用域做成一门完整的小语言 —— union / intersection / complement、模块通配、非法表达式报错位置（`:245`、`:252-265`、`:496`），求值在 `:374 scopeMatches`，界面在 `src/components/SearchPanel.vue:50-53`。

### A5. `ReplaceInProjectManager`

上游编排"在路径中替换"；本仓 `src/components/SearchPanel.vue:174-193` 是逐条勾选/跳过的精确替换（走 `native/search.cpp:533 replace_selected`），另有整文件替换（`:438`）。改写会移动字节偏移，所以替换后强制重跑预览而不是就地改偏移（`SearchPanel.vue:188`）—— 这一条上游也有，本仓照抄。

### A6. `CompareClipboardWithSelectionAction`

上游"与剪贴板比较"；本仓编辑器右键有这一项（`src/menus/codeMenu.ts:103`，标题「与剪贴板比较」），点下去取当前标签文本与剪贴板文本喂 `buildDiffRows`（`src/vcsActions.ts:114-122`），结果进 `clipboardDiff`。

---

## B. `[~]` —— 部分

`[~]` 的诚实含义是：**有对应物，但缺的那一面会让人看出差别**。

### B1. 比较算法：算法对了，策略层没搬

- `ComparisonPolicy`（`ComparisonPolicy.kt:4-8`）三档，本仓**只做了 DEFAULT**。这一档恰好是上游默认：`IgnorePolicy.DEFAULT` 写在 `TextDiffSettingsHolder.kt:47`，经 `IgnorePolicy.java:29-35` 落到 `ComparisonPolicy.DEFAULT`。所以**默认行为一致**，但用户主动切到 TRIM/IGNORE 时本仓无处可切。
- `ByLine` / `ByLineRt` / `ComparisonManager` / `ComparisonManagerImpl` / `ComparisonUtil`：上游是"先按行、再按词、再按字符"的可降级策略选择器（`ComparisonManagerImpl` 794 行），本仓固定一级。
- `DiffIterable` / `FairDiffIterable`：上游的差异结果是带 `changes()` / `unchanged()` 惰性迭代器的对象，且 `FairDiffIterable`（`FairDiffIterable.kt:5-13`）约定 unchanged 区逐位对齐、可被 `DiffIterableUtil.verifyFair` 校验。本仓吐的是 `{from,to}` 对的**对偶**形态（只给公共行，改动行由差集反推，`src/diffText.ts:16-47`），语义等价但没有那套可校验契约。
- `DiffFragment` / `LineFragment` / `Range` / `LineRange` / `LineCol` / `Side` / `ThreeSide`：片段模型，本仓没有对象封装。

### B2. 查找用法（LSP 路线）：能看能跳，不能分组

本仓的"查找用法"是从**文件树**发起的（`src/App.vue:2466` → `src/treeActions.ts:99-113`）：先开文件，取大纲里与文件名同名的类符号（退而取第一个符号），再发 `textDocument/references`，结果进引用面板。

- `FindUsagesManager` —— 有结果视图与跳转，文案照上游 `FindBundle.properties:31-32` 复刻（`src/toolContents.ts:149-157`）；缺 usage type 分类、分组、预取。
- `ShowUsagesAction` —— 有面板与齿轮（`src/usageViewGear.ts:36-60`：按字母排序、新标签页打开）；缺 1873 行里那套预览差异、分组视图、`ShowUsagesManager` 协调。
- `FindUsagesAction` —— 入口在文件树而非编辑器（上游是 Alt+F7），且只能对**文件**发起，不能对光标下的符号发起。
- `FindUsagesOptions` / `FindUsagesSettings` —— 文案与"新标签页"开关都对上了（`src/usageViewGear.ts:47-54`），但选项集合远小于上游。
- `FindUtil` —— `showInUsageView` 的"把这批地点放进查找窗口"，本仓是 `src/semanticActions.ts:134` 钉到引用面板。
- `FindPopupScopeUIImpl` —— 作用域选择器，`src/components/SearchPanel.vue:8` 明确写明是照 `FindPopupScopeUIImpl.java:59,137` 来的。

### B3. 编辑器内查找：只有两个键

`EditorSearchSession` / `FindManager` / `FindResult` / `SearchReplaceComponent` / `SearchTextArea` / `FindAllAction`：本仓编辑器里只有 F3 / Shift+F3 两个键（`src/components/CodeEditor.vue:995-996`），没有查找栏、没有结果环、没有多光标全选。

`FindResult` 判 `[~]` 而不是 `[ ]`，是因为工程内那侧确实有等价物：`native/search.cpp:413` 的 `truncated` 与 `:422` 的 `skippedNonUtf8` 就是"还有没有更多 + 有没有坏文件"的报告位。

### B4. 文件比较的两个入口，形态不同

- `CompareFileWithEditorAction` —— 保存冲突预览确实展示了差异（`src/editorFileOps.ts:44-54` 的 `conflictDiff`，左边磁盘版右边缓冲区），但它是保存冲突流程里的一步，不是独立动作，也没有 Compare 工具窗。
- `CompareFilesAction` —— 本仓没有任选两个文件比较的对话框。
- `FindInPathAction` / `ReplaceInPathAction` —— 对话框本体在 `src/components/SearchPanel.vue`，但没有"打开查找工具窗"这一形态，也没有最近搜索历史。
- `FindInProjectUtil` / `FindInProjectTask` —— 作用域求值有（`src/scopes.ts`），标题与展示设置、分批读（`USAGES_PER_READ_ACTION = 100`）、进度模型都没有。

---

## C. `[ ]` —— 未对标

这些是本仓**确实没有**、也不打算假装有的：

| 一族 | 代表类 | 为什么不做 / 缺什么 |
|---|---|---|
| 查找工具窗 | `FindPopupPanel`(2399 行)、`FindPopupHeader`、`FindPopupScopeUI`、30 个 `editorHeaderActions` | 本仓的查找是 Find in Files 对话框（`src/components/SearchPanel.vue`），编辑器里那根栏一次都没做。这根栏是 IDEA 查找体验的大头，缺它等于"编辑器内查找"整体缺席 |
| 查找用法引擎（PSI） | `JavaFindUsagesHandler`(273)、`JavaFindUsagesHelper`(512)、`FindUsagesHandlerFactory` 系列 | 本仓走 LSP `textDocument/references`，没有 PSI 引用图。跨语言统一查找、类型推断级精度都做不到 |
| 相似用法 | `JavaSimilarityFeaturesExtractor`(431)、`SilhouetteScore`、聚类 UI | 需要 PSI + 机器学习特征，且仅 Java |
| 三元组索引 | `TrigramIndex`(154)、`TrigramTextSearchService` | 本仓是线性扫描（`native/search.cpp:322-338`）。文件多时慢，但没有索引要维护 |
| 实时预览 | `LivePreview`(623)、`SearchResults`(1083)、`SelectionManager` | 边输边搜 + 分块加载 + 选区管理，本仓是"点搜索才跑" |
| 词级/字符级差异 | `ByWordRt`(1149)、`ByCharRt`(292)、`LineFragmentSplitter`、`ChunkOptimizer`、`ChangeCorrector`、`TrimUtil`(584) | 本仓只有行级。改了同一行里的一个词时，上游会把那一行里的词标红，本仓只能整行标 |
| 非默认比较策略 | `ComparisonPolicy.TRIM_WHITESPACES` / `IGNORE_WHITESPACES` | 这两档要求用户能切。缺它们意味着**默认行为是对的，但少两个可选项** |
| diff 查看器 | `SimpleDiffViewer`(1012)、`UnifiedDiffViewer`(1771)、`CombinedDiffViewer`(984)、`FoldingModelSupport`(1274)、`SyncScrollSupport`(545) | 本仓只**生成** unified 文本（`src/diffText.ts:52`）拿去存/贴，不渲染它，也没有左右同步滚动与折叠 |
| 三方合并 | `MergeRequestProcessor`(579)、`MergeThreesideViewer`(1263)、`MergeConflictModel`(552) | 本仓的保存冲突只展示，由用户自己在编辑器里改（`src/editorFileOps.ts:44-54`）。没有冲突标记、没有三栏合并工具 |
| 语言特化忽略 | `JavaDiffIgnoredRangeProvider`、`LangDiffSpecificProvider` | 纯文本逐行比较，跳过 import / 字符串这类规则没做 |
| diff 请求框架 | `DiffRequestProcessor`(1659)、`AsyncDiffRequestChain`、缓存 | 本仓两次 diff 都是同步函数调用，没有请求对象、取消与缓存 |

---

## D. `[-]` —— 不适用

- 13 个测试类（`FindInEditorTest`、`DirectorySearchEngineTest`、`FindInEditorMultiCaretTest`、`SearchResultsChunkingTest` 等）来自 `testSources/` 与 `testData/`，不是产品面。
- 4 个平台专属类（`FindPopupPanel`、`SearchTextArea`、`ShowUsagesAction`、`FindPopupHeader` 命中 `CustomFrameDecoration`；`DiffViewerBase`、`FindManagerBase`、`CharacterUtils` 命中 `Headless`/`x11`）—— 这些是"必须在 IDE 里跑"的东西，本仓是自绘前端，没有对应的绘制上下文。
- 一批与本仓形态根本不搭的东西：`audioCues`（音效）、`statistics`（上报）、`settings`（外部工具表）、`applications`（命令级 action 注册）、`frontend`（只对 JetBrains 自家前端开放的内部 API）、`merge/external`（Beyond Compare 一类）、`impl/ui` 与 `tools/util/breadcrumbs`（Swing 工具栏 / 面包屑）。

---

## E. 与上游的差异（如实记）

| # | 上游怎么做 | 本仓怎么做 | 影响面 |
|---|---|---|---|
| 1 | 超阈值抛 `FilesTooBigForDiffException` 后**改用 Patience**（`Diff.kt:96-101`） | 捕获后退化为"掐掉前后公共段，中间整段视作一整块改动"（`src/diffAlign.ts` 的 `alignLines`） | 触发条件是差异量超过两万以上（`MyersLCS.kt:64-70` 的 `max(20000 + 10*sqrt(N), 20000)`），正常编辑碰不到；碰到时输出仍**合法**（前后公共段照旧成对），只是粗 |
| 2 | 三档 `ComparisonPolicy`（`ComparisonPolicy.kt:4-8`） | 只有 `DEFAULT`，`TRIM_WHITESPACES` / `IGNORE_WHITESPACES` 两档没做 | 默认行为一致（上游默认也是 `DEFAULT`，`TextDiffSettingsHolder.kt:47`）；少两个用户可选项 |
| 3 | 差异结果是不重叠区间 + 不 squash 的 `DiffIterable`（`DiffIterable.kt:10-15`） | 只吐公共行对，改动行由差集反推（`src/diffText.ts:16-47`） | 输出语义等价，但没有 `verifyFair` 那套可校验契约可复用 |
| 4 | 查找可用 PSI 引用图、trigram 索引、语言特化 | 线性扫描 + LSP `textDocument/references` | 大仓搜索慢、无索引维护成本；跨语言精度依赖 LSP 服务器 |
| 5 | 编辑器内查找有完整查找栏 | 只有 F3 / Shift+F3（`src/components/CodeEditor.vue:995-996`） | 编辑器内查找体验整体缺席 |

---

## F. 门控（`tests/b7-verdict.test.mjs`）

1. **覆盖面**：`§G` 的行集 == `docs/inventory/find-diff.txt` 的类集（逐名对齐，双向不漏不多）。
2. **条数**：恰好 630 行。
3. **引证落地**：`[x]` / `[~]` 行里反引号包的 `src/` `native/` 路径必须真实存在于磁盘上，且总数 ≥ 20。
4. **测试类**：13 个 `test` 类必须全部判 `[-]`。
5. **算术**：四档计数与页脚那句合计一致，且 `[x] + [~] + [ ] + [-] = 630`。
6. **口径不漂移**：`src/diffAlign.ts` 头注释里那批上游 `file:line`（`Diff.kt` / `MyersLCS.kt` / `Enumerator.kt` / `DiffConfig.kt` / `TextDiffSettingsHolder.kt` / `IgnorePolicy.java` / `TrimUtil.kt`）必须仍在文件里 —— 免得上游行号改了而本仓注释不跟。
7. **差异表不空**：§E 至少 5 条，且第 1 条必须提到 Patience。

## G. 逐条总表

| 类名 | 路径 | 判决 | 理由 |
| --- | --- | --- | --- |
| `JavaClassFindUsagesOptions` | `java/java-analysis-impl/src/com/intellij/find/findUsages/JavaClassFindUsagesOptions.java` | `[ ]` | 查找用法引擎与对话框（PSI 引用图）。本仓走 LSP，没有引用索引。 |
| `JavaFindUsagesHelper` | `java/java-analysis-impl/src/com/intellij/find/findUsages/JavaFindUsagesHelper.java` | `[ ]` | 查找用法引擎与对话框（PSI 引用图）。本仓走 LSP，没有引用索引。 |
| `JavaFindUsagesOptions` | `java/java-analysis-impl/src/com/intellij/find/findUsages/JavaFindUsagesOptions.java` | `[ ]` | 查找用法引擎与对话框（PSI 引用图）。本仓走 LSP，没有引用索引。 |
| `JavaMethodFindUsagesOptions` | `java/java-analysis-impl/src/com/intellij/find/findUsages/JavaMethodFindUsagesOptions.java` | `[ ]` | 查找用法引擎与对话框（PSI 引用图）。本仓走 LSP，没有引用索引。 |
| `JavaPackageFindUsagesOptions` | `java/java-analysis-impl/src/com/intellij/find/findUsages/JavaPackageFindUsagesOptions.java` | `[ ]` | 查找用法引擎与对话框（PSI 引用图）。本仓走 LSP，没有引用索引。 |
| `JavaThrowFindUsagesOptions` | `java/java-analysis-impl/src/com/intellij/find/findUsages/JavaThrowFindUsagesOptions.java` | `[ ]` | 查找用法引擎与对话框（PSI 引用图）。本仓走 LSP，没有引用索引。 |
| `JavaVariableFindUsagesOptions` | `java/java-analysis-impl/src/com/intellij/find/findUsages/JavaVariableFindUsagesOptions.java` | `[ ]` | 查找用法引擎与对话框（PSI 引用图）。本仓走 LSP，没有引用索引。 |
| `JavaDiffIgnoredRangeProvider` | `java/java-impl/src/com/intellij/diff/lang/JavaDiffIgnoredRangeProvider.java` | `[ ]` | 按语言的忽略范围（Java 跳过 import/字符串等）。本仓纯文本逐行比较，不做语言特化。 |
| `FindClassUsagesDialog` | `java/java-impl/src/com/intellij/find/findUsages/FindClassUsagesDialog.java` | `[ ]` | 查找用法引擎与对话框（PSI 引用图）。本仓走 LSP，没有引用索引。 |
| `FindMethodUsagesDialog` | `java/java-impl/src/com/intellij/find/findUsages/FindMethodUsagesDialog.java` | `[ ]` | 查找用法引擎与对话框（PSI 引用图）。本仓走 LSP，没有引用索引。 |
| `FindPackageUsagesDialog` | `java/java-impl/src/com/intellij/find/findUsages/FindPackageUsagesDialog.java` | `[ ]` | 查找用法引擎与对话框（PSI 引用图）。本仓走 LSP，没有引用索引。 |
| `FindThrowUsagesDialog` | `java/java-impl/src/com/intellij/find/findUsages/FindThrowUsagesDialog.java` | `[ ]` | 查找用法引擎与对话框（PSI 引用图）。本仓走 LSP，没有引用索引。 |
| `FindVariableUsagesDialog` | `java/java-impl/src/com/intellij/find/findUsages/FindVariableUsagesDialog.java` | `[ ]` | 查找用法引擎与对话框（PSI 引用图）。本仓走 LSP，没有引用索引。 |
| `GroupByPackageAction` | `java/java-impl/src/com/intellij/find/findUsages/GroupByPackageAction.java` | `[ ]` | 查找用法引擎与对话框（PSI 引用图）。本仓走 LSP，没有引用索引。 |
| `JavaFindUsagesCollector` | `java/java-impl/src/com/intellij/find/findUsages/JavaFindUsagesCollector.kt` | `[ ]` | 查找用法引擎与对话框（PSI 引用图）。本仓走 LSP，没有引用索引。 |
| `JavaFindUsagesDialog` | `java/java-impl/src/com/intellij/find/findUsages/JavaFindUsagesDialog.java` | `[ ]` | 查找用法引擎与对话框（PSI 引用图）。本仓走 LSP，没有引用索引。 |
| `JavaFindUsagesHandler` | `java/java-impl/src/com/intellij/find/findUsages/JavaFindUsagesHandler.java` | `[ ]` | 查找用法引擎与对话框（PSI 引用图）。本仓走 LSP，没有引用索引。 |
| `JavaFindUsagesHandlerFactory` | `java/java-impl/src/com/intellij/find/findUsages/JavaFindUsagesHandlerFactory.java` | `[ ]` | 查找用法引擎与对话框（PSI 引用图）。本仓走 LSP，没有引用索引。 |
| `JavaUsageTargetProvider` | `java/java-impl/src/com/intellij/find/findUsages/JavaUsageTargetProvider.java` | `[ ]` | 查找用法引擎与对话框（PSI 引用图）。本仓走 LSP，没有引用索引。 |
| `JavaSimilarityComplexExpressionFeaturesExtractor` | `java/java-impl/src/com/intellij/find/findUsages/similarity/JavaSimilarityComplexExpressionFeaturesExtractor.java` | `[-]` | 相似用法聚类，仅 Java 语义，本仓无 PSI 也就无从提特征。 |
| `JavaSimilarityFeaturesExtractor` | `java/java-impl/src/com/intellij/find/findUsages/similarity/JavaSimilarityFeaturesExtractor.java` | `[-]` | 相似用法聚类，仅 Java 语义，本仓无 PSI 也就无从提特征。 |
| `JavaUsageSimilarityFeaturesProvider` | `java/java-impl/src/com/intellij/find/findUsages/similarity/JavaUsageSimilarityFeaturesProvider.java` | `[-]` | 相似用法聚类，仅 Java 语义，本仓无 PSI 也就无从提特征。 |
| `FindBundle` | `platform/analysis-impl/src/com/intellij/find/FindBundle.java` | `[ ]` | 编辑器内查找的核心模型与服务。本仓只有 Find in Files；编辑器里 F3/Shift+F3 只绑了跳下一个/上一个匹配（`src/components/CodeEditor.vue:995-996`）。 |
| `FindSettings` | `platform/analysis-impl/src/com/intellij/find/FindSettings.java` | `[ ]` | 编辑器内查找的核心模型与服务。本仓只有 Find in Files；编辑器里 F3/Shift+F3 只绑了跳下一个/上一个匹配（`src/components/CodeEditor.vue:995-996`）。 |
| `FindUsagesSettings` | `platform/analysis-impl/src/com/intellij/find/FindUsagesSettings.java` | `[~]` | `showResultsInSeparateView` 绑 `find.open.in.new.tab.action`（`FindBundle.properties:23`），本仓同一项既进齿轮（`src/usageViewGear.ts:47-54`）也进 Window 菜单（`src/menus/windowMenu.ts:123-125`），语义一致。其余设置项没有。 |
| `FindUsagesHandlerBase` | `platform/analysis-impl/src/com/intellij/find/findUsages/FindUsagesHandlerBase.java` | `[ ]` | 查找用法引擎与对话框（PSI 引用图）。本仓走 LSP，没有引用索引。 |
| `FindUsagesHelper` | `platform/analysis-impl/src/com/intellij/find/findUsages/FindUsagesHelper.java` | `[ ]` | 查找用法引擎与对话框（PSI 引用图）。本仓走 LSP，没有引用索引。 |
| `FindUsagesOptions` | `platform/analysis-impl/src/com/intellij/find/findUsages/FindUsagesOptions.java` | `[~]` | `generateUsagesString()`（`FindUsagesOptions.java:101-103`）返回 `AnalysisBundle` 的 "Usages"，本仓复刻成中文文案（`src/toolContents.ts:149-154`）。选项集合远小于上游（无 text occurrences / 排除用法 / 只搜主源码等）。 |
| `PersistentFindUsagesOptions` | `platform/analysis-impl/src/com/intellij/find/findUsages/PersistentFindUsagesOptions.java` | `[ ]` | 查找用法引擎与对话框（PSI 引用图）。本仓走 LSP，没有引用索引。 |
| `TextOccurrenceReference` | `platform/analysis-impl/src/com/intellij/find/findUsages/TextOccurrenceReference.java` | `[ ]` | 查找用法引擎与对话框（PSI 引用图）。本仓走 LSP，没有引用索引。 |
| `FindInProjectSettingsBase` | `platform/analysis-impl/src/com/intellij/find/impl/FindInProjectSettingsBase.java` | `[ ]` | 查找工具窗实现（FindPopupPanel 2399 行及其周边）。本仓没有这根查找栏。 |
| `FindSettingsBase` | `platform/analysis-impl/src/com/intellij/find/impl/FindSettingsBase.java` | `[ ]` | 查找工具窗实现（FindPopupPanel 2399 行及其周边）。本仓没有这根查找栏。 |
| `FindSettingsImpl` | `platform/analysis-impl/src/com/intellij/find/impl/FindSettingsImpl.java` | `[ ]` | 查找工具窗实现（FindPopupPanel 2399 行及其周边）。本仓没有这根查找栏。 |
| `FindUsagesSettingsImpl` | `platform/analysis-impl/src/com/intellij/find/impl/FindUsagesSettingsImpl.java` | `[ ]` | 查找工具窗实现（FindPopupPanel 2399 行及其周边）。本仓没有这根查找栏。 |
| `DiffApplicationSettings` | `platform/diff-api/src/com/intellij/diff/DiffApplicationSettings.java` | `[ ]` | diff 框架层（请求/窗口/工具注册）。本仓的 diff 只有剪贴板对比与保存冲突预览两处纯函数（`src/diffText.ts:16-52`），不存在 DiffRequest/DiffWindow 这一层。 |
| `DiffContentFactory` | `platform/diff-api/src/com/intellij/diff/DiffContentFactory.java` | `[ ]` | diff 框架层（请求/窗口/工具注册）。本仓的 diff 只有剪贴板对比与保存冲突预览两处纯函数（`src/diffText.ts:16-52`），不存在 DiffRequest/DiffWindow 这一层。 |
| `DiffContext` | `platform/diff-api/src/com/intellij/diff/DiffContext.java` | `[ ]` | diff 框架层（请求/窗口/工具注册）。本仓的 diff 只有剪贴板对比与保存冲突预览两处纯函数（`src/diffText.ts:16-52`），不存在 DiffRequest/DiffWindow 这一层。 |
| `DiffDialogHints` | `platform/diff-api/src/com/intellij/diff/DiffDialogHints.java` | `[ ]` | diff 框架层（请求/窗口/工具注册）。本仓的 diff 只有剪贴板对比与保存冲突预览两处纯函数（`src/diffText.ts:16-52`），不存在 DiffRequest/DiffWindow 这一层。 |
| `DiffEditorTitleCustomizer` | `platform/diff-api/src/com/intellij/diff/DiffEditorTitleCustomizer.kt` | `[ ]` | diff 框架层（请求/窗口/工具注册）。本仓的 diff 只有剪贴板对比与保存冲突预览两处纯函数（`src/diffText.ts:16-52`），不存在 DiffRequest/DiffWindow 这一层。 |
| `DiffExtension` | `platform/diff-api/src/com/intellij/diff/DiffExtension.java` | `[ ]` | diff 框架层（请求/窗口/工具注册）。本仓的 diff 只有剪贴板对比与保存冲突预览两处纯函数（`src/diffText.ts:16-52`），不存在 DiffRequest/DiffWindow 这一层。 |
| `DiffManager` | `platform/diff-api/src/com/intellij/diff/DiffManager.java` | `[ ]` | diff 框架层（请求/窗口/工具注册）。本仓的 diff 只有剪贴板对比与保存冲突预览两处纯函数（`src/diffText.ts:16-52`），不存在 DiffRequest/DiffWindow 这一层。 |
| `DiffManagerEx` | `platform/diff-api/src/com/intellij/diff/DiffManagerEx.java` | `[ ]` | diff 框架层（请求/窗口/工具注册）。本仓的 diff 只有剪贴板对比与保存冲突预览两处纯函数（`src/diffText.ts:16-52`），不存在 DiffRequest/DiffWindow 这一层。 |
| `DiffRequestFactory` | `platform/diff-api/src/com/intellij/diff/DiffRequestFactory.java` | `[ ]` | diff 框架层（请求/窗口/工具注册）。本仓的 diff 只有剪贴板对比与保存冲突预览两处纯函数（`src/diffText.ts:16-52`），不存在 DiffRequest/DiffWindow 这一层。 |
| `DiffRequestPanel` | `platform/diff-api/src/com/intellij/diff/DiffRequestPanel.java` | `[ ]` | diff 框架层（请求/窗口/工具注册）。本仓的 diff 只有剪贴板对比与保存冲突预览两处纯函数（`src/diffText.ts:16-52`），不存在 DiffRequest/DiffWindow 这一层。 |
| `DiffTool` | `platform/diff-api/src/com/intellij/diff/DiffTool.java` | `[ ]` | diff 框架层（请求/窗口/工具注册）。本仓的 diff 只有剪贴板对比与保存冲突预览两处纯函数（`src/diffText.ts:16-52`），不存在 DiffRequest/DiffWindow 这一层。 |
| `DiffToolType` | `platform/diff-api/src/com/intellij/diff/DiffToolType.kt` | `[ ]` | diff 框架层（请求/窗口/工具注册）。本仓的 diff 只有剪贴板对比与保存冲突预览两处纯函数（`src/diffText.ts:16-52`），不存在 DiffRequest/DiffWindow 这一层。 |
| `EditorDiffViewer` | `platform/diff-api/src/com/intellij/diff/EditorDiffViewer.java` | `[ ]` | diff 框架层（请求/窗口/工具注册）。本仓的 diff 只有剪贴板对比与保存冲突预览两处纯函数（`src/diffText.ts:16-52`），不存在 DiffRequest/DiffWindow 这一层。 |
| `FocusableContext` | `platform/diff-api/src/com/intellij/diff/FocusableContext.java` | `[ ]` | diff 框架层（请求/窗口/工具注册）。本仓的 diff 只有剪贴板对比与保存冲突预览两处纯函数（`src/diffText.ts:16-52`），不存在 DiffRequest/DiffWindow 这一层。 |
| `FrameDiffTool` | `platform/diff-api/src/com/intellij/diff/FrameDiffTool.java` | `[ ]` | diff 框架层（请求/窗口/工具注册）。本仓的 diff 只有剪贴板对比与保存冲突预览两处纯函数（`src/diffText.ts:16-52`），不存在 DiffRequest/DiffWindow 这一层。 |
| `InvalidDiffRequestException` | `platform/diff-api/src/com/intellij/diff/InvalidDiffRequestException.java` | `[ ]` | diff 框架层（请求/窗口/工具注册）。本仓的 diff 只有剪贴板对比与保存冲突预览两处纯函数（`src/diffText.ts:16-52`），不存在 DiffRequest/DiffWindow 这一层。 |
| `SuppressiveDiffTool` | `platform/diff-api/src/com/intellij/diff/SuppressiveDiffTool.java` | `[ ]` | diff 框架层（请求/窗口/工具注册）。本仓的 diff 只有剪贴板对比与保存冲突预览两处纯函数（`src/diffText.ts:16-52`），不存在 DiffRequest/DiffWindow 这一层。 |
| `DiffRequestChain` | `platform/diff-api/src/com/intellij/diff/chains/DiffRequestChain.java` | `[ ]` | 异步 diff 请求链与结果缓存。本仓的两处 diff 都是同步算完直接用。 |
| `DiffRequestChainBase` | `platform/diff-api/src/com/intellij/diff/chains/DiffRequestChainBase.java` | `[ ]` | 异步 diff 请求链与结果缓存。本仓的两处 diff 都是同步算完直接用。 |
| `DiffRequestProducer` | `platform/diff-api/src/com/intellij/diff/chains/DiffRequestProducer.java` | `[ ]` | 异步 diff 请求链与结果缓存。本仓的两处 diff 都是同步算完直接用。 |
| `DiffRequestProducerException` | `platform/diff-api/src/com/intellij/diff/chains/DiffRequestProducerException.java` | `[ ]` | 异步 diff 请求链与结果缓存。本仓的两处 diff 都是同步算完直接用。 |
| `DiffRequestSelectionChain` | `platform/diff-api/src/com/intellij/diff/chains/DiffRequestSelectionChain.java` | `[ ]` | 异步 diff 请求链与结果缓存。本仓的两处 diff 都是同步算完直接用。 |
| `SimpleDiffRequestChain` | `platform/diff-api/src/com/intellij/diff/chains/SimpleDiffRequestChain.java` | `[ ]` | 异步 diff 请求链与结果缓存。本仓的两处 diff 都是同步算完直接用。 |
| `SimpleDiffRequestProducer` | `platform/diff-api/src/com/intellij/diff/chains/SimpleDiffRequestProducer.java` | `[ ]` | 异步 diff 请求链与结果缓存。本仓的两处 diff 都是同步算完直接用。 |
| `ComparisonManager` | `platform/diff-api/src/com/intellij/diff/comparison/ComparisonManager.java` | `[~]` | 比较结果的对外门面（选一级/二级策略、要不要 intrahunk）。本仓直接调 `src/diffAlign.ts:214` `alignLines`，跳过这一层。 |
| `InnerFragmentsPolicy` | `platform/diff-api/src/com/intellij/diff/comparison/InnerFragmentsPolicy.java` | `[ ]` | 比较算法族。本仓只做了行级（`src/diffAlign.ts`），词级/字符级都没有。 |
| `DiffContent` | `platform/diff-api/src/com/intellij/diff/contents/DiffContent.java` | `[ ]` | 内容抽象（文件/文档/目录/二进制）。本仓直接吃字符串数组。 |
| `DiffContentBase` | `platform/diff-api/src/com/intellij/diff/contents/DiffContentBase.java` | `[ ]` | 内容抽象（文件/文档/目录/二进制）。本仓直接吃字符串数组。 |
| `DirectoryContent` | `platform/diff-api/src/com/intellij/diff/contents/DirectoryContent.java` | `[ ]` | 内容抽象（文件/文档/目录/二进制）。本仓直接吃字符串数组。 |
| `DocumentContent` | `platform/diff-api/src/com/intellij/diff/contents/DocumentContent.java` | `[ ]` | 内容抽象（文件/文档/目录/二进制）。本仓直接吃字符串数组。 |
| `EmptyContent` | `platform/diff-api/src/com/intellij/diff/contents/EmptyContent.java` | `[ ]` | 内容抽象（文件/文档/目录/二进制）。本仓直接吃字符串数组。 |
| `FileContent` | `platform/diff-api/src/com/intellij/diff/contents/FileContent.java` | `[ ]` | 内容抽象（文件/文档/目录/二进制）。本仓直接吃字符串数组。 |
| `BinaryMergeRequest` | `platform/diff-api/src/com/intellij/diff/merge/BinaryMergeRequest.java` | `[ ]` | 三方合并与冲突解决。本仓的保存冲突只**展示**差异，由用户自己在编辑器里改（`src/editorFileOps.ts:44-54`）。 |
| `ConflictType` | `platform/diff-api/src/com/intellij/diff/merge/ConflictType.kt` | `[ ]` | 三方合并与冲突解决。本仓的保存冲突只**展示**差异，由用户自己在编辑器里改（`src/editorFileOps.ts:44-54`）。 |
| `MergeCallback` | `platform/diff-api/src/com/intellij/diff/merge/MergeCallback.java` | `[ ]` | 三方合并与冲突解决。本仓的保存冲突只**展示**差异，由用户自己在编辑器里改（`src/editorFileOps.ts:44-54`）。 |
| `MergeContext` | `platform/diff-api/src/com/intellij/diff/merge/MergeContext.java` | `[ ]` | 三方合并与冲突解决。本仓的保存冲突只**展示**差异，由用户自己在编辑器里改（`src/editorFileOps.ts:44-54`）。 |
| `MergeRequest` | `platform/diff-api/src/com/intellij/diff/merge/MergeRequest.java` | `[ ]` | 三方合并与冲突解决。本仓的保存冲突只**展示**差异，由用户自己在编辑器里改（`src/editorFileOps.ts:44-54`）。 |
| `MergeRequestHandler` | `platform/diff-api/src/com/intellij/diff/merge/MergeRequestHandler.kt` | `[ ]` | 三方合并与冲突解决。本仓的保存冲突只**展示**差异，由用户自己在编辑器里改（`src/editorFileOps.ts:44-54`）。 |
| `MergeRequestProducer` | `platform/diff-api/src/com/intellij/diff/merge/MergeRequestProducer.java` | `[ ]` | 三方合并与冲突解决。本仓的保存冲突只**展示**差异，由用户自己在编辑器里改（`src/editorFileOps.ts:44-54`）。 |
| `MergeResult` | `platform/diff-api/src/com/intellij/diff/merge/MergeResult.java` | `[ ]` | 三方合并与冲突解决。本仓的保存冲突只**展示**差异，由用户自己在编辑器里改（`src/editorFileOps.ts:44-54`）。 |
| `MergeTool` | `platform/diff-api/src/com/intellij/diff/merge/MergeTool.kt` | `[ ]` | 三方合并与冲突解决。本仓的保存冲突只**展示**差异，由用户自己在编辑器里改（`src/editorFileOps.ts:44-54`）。 |
| `TextMergeRequest` | `platform/diff-api/src/com/intellij/diff/merge/TextMergeRequest.java` | `[ ]` | 三方合并与冲突解决。本仓的保存冲突只**展示**差异，由用户自己在编辑器里改（`src/editorFileOps.ts:44-54`）。 |
| `ThreesideMergeRequest` | `platform/diff-api/src/com/intellij/diff/merge/ThreesideMergeRequest.java` | `[ ]` | 三方合并与冲突解决。本仓的保存冲突只**展示**差异，由用户自己在编辑器里改（`src/editorFileOps.ts:44-54`）。 |
| `AutomaticExternalMergeTool` | `platform/diff-api/src/com/intellij/diff/merge/external/AutomaticExternalMergeTool.java` | `[-]` | 外部合并工具调用（Beyond Compare 等）。 |
| `ComponentDiffRequest` | `platform/diff-api/src/com/intellij/diff/requests/ComponentDiffRequest.java` | `[ ]` | diff 请求对象族。本仓的两次 diff 都是一次函数调用，没有请求对象。 |
| `ContentDiffRequest` | `platform/diff-api/src/com/intellij/diff/requests/ContentDiffRequest.java` | `[ ]` | diff 请求对象族。本仓的两次 diff 都是一次函数调用，没有请求对象。 |
| `DiffRequest` | `platform/diff-api/src/com/intellij/diff/requests/DiffRequest.java` | `[ ]` | diff 请求对象族。本仓的两次 diff 都是一次函数调用，没有请求对象。 |
| `ErrorDiffRequest` | `platform/diff-api/src/com/intellij/diff/requests/ErrorDiffRequest.java` | `[ ]` | diff 请求对象族。本仓的两次 diff 都是一次函数调用，没有请求对象。 |
| `MessageDiffRequest` | `platform/diff-api/src/com/intellij/diff/requests/MessageDiffRequest.java` | `[ ]` | diff 请求对象族。本仓的两次 diff 都是一次函数调用，没有请求对象。 |
| `NoDiffRequest` | `platform/diff-api/src/com/intellij/diff/requests/NoDiffRequest.java` | `[ ]` | diff 请求对象族。本仓的两次 diff 都是一次函数调用，没有请求对象。 |
| `ProxySimpleDiffRequest` | `platform/diff-api/src/com/intellij/diff/requests/ProxySimpleDiffRequest.java` | `[ ]` | diff 请求对象族。本仓的两次 diff 都是一次函数调用，没有请求对象。 |
| `SimpleDiffRequest` | `platform/diff-api/src/com/intellij/diff/requests/SimpleDiffRequest.java` | `[ ]` | diff 请求对象族。本仓的两次 diff 都是一次函数调用，没有请求对象。 |
| `AssignmentTracker` | `platform/diff-api/src/com/intellij/diff/util/AssignmentTracker.kt` | `[-]` | diff 工具类：行标记绘制、行号转换、数据键、常量。依赖编辑器绘制上下文，本仓不需要。 |
| `DiffNotificationProvider` | `platform/diff-api/src/com/intellij/diff/util/DiffNotificationProvider.java` | `[-]` | diff 工具类：行标记绘制、行号转换、数据键、常量。依赖编辑器绘制上下文，本仓不需要。 |
| `DiffUserDataKeys` | `platform/diff-api/src/com/intellij/diff/util/DiffUserDataKeys.java` | `[-]` | diff 工具类：行标记绘制、行号转换、数据键、常量。依赖编辑器绘制上下文，本仓不需要。 |
| `LineCol` | `platform/diff-api/src/com/intellij/diff/util/LineCol.java` | `[~]` | 行列坐标。上游词级差异要它。本仓 `src/bridge.ts:102` 的 `DiffRow` 只到行，不带列信息（不做词级）。 |
| `LineRange` | `platform/diff-api/src/com/intellij/diff/util/LineRange.java` | `[~]` | 单侧行号区间。本仓没有这个类型，但有等价的单侧行：`src/bridge.ts:102` 的 `DiffRow.left` / `.right` 各自带 `no`，`delete` / `insert` 行只填一侧。 |
| `DiffActionPromoter` | `platform/diff-impl/src/com/intellij/diff/DiffActionPromoter.kt` | `[ ]` | diff 框架层（请求/窗口/工具注册）。本仓的 diff 只有剪贴板对比与保存冲突预览两处纯函数（`src/diffText.ts:16-52`），不存在 DiffRequest/DiffWindow 这一层。 |
| `DiffContentFactoryEx` | `platform/diff-impl/src/com/intellij/diff/DiffContentFactoryEx.java` | `[ ]` | diff 框架层（请求/窗口/工具注册）。本仓的 diff 只有剪贴板对比与保存冲突预览两处纯函数（`src/diffText.ts:16-52`），不存在 DiffRequest/DiffWindow 这一层。 |
| `DiffContentFactoryImpl` | `platform/diff-impl/src/com/intellij/diff/DiffContentFactoryImpl.java` | `[ ]` | diff 框架层（请求/窗口/工具注册）。本仓的 diff 只有剪贴板对比与保存冲突预览两处纯函数（`src/diffText.ts:16-52`），不存在 DiffRequest/DiffWindow 这一层。 |
| `DiffContextEx` | `platform/diff-impl/src/com/intellij/diff/DiffContextEx.java` | `[ ]` | diff 框架层（请求/窗口/工具注册）。本仓的 diff 只有剪贴板对比与保存冲突预览两处纯函数（`src/diffText.ts:16-52`），不存在 DiffRequest/DiffWindow 这一层。 |
| `DiffLightVirtualFileWritingAccessProvider` | `platform/diff-impl/src/com/intellij/diff/DiffLightVirtualFileWritingAccessProvider.kt` | `[ ]` | diff 框架层（请求/窗口/工具注册）。本仓的 diff 只有剪贴板对比与保存冲突预览两处纯函数（`src/diffText.ts:16-52`），不存在 DiffRequest/DiffWindow 这一层。 |
| `DiffManagerImpl` | `platform/diff-impl/src/com/intellij/diff/DiffManagerImpl.kt` | `[ ]` | diff 框架层（请求/窗口/工具注册）。本仓的 diff 只有剪贴板对比与保存冲突预览两处纯函数（`src/diffText.ts:16-52`），不存在 DiffRequest/DiffWindow 这一层。 |
| `DiffNotificationIdsHolder` | `platform/diff-impl/src/com/intellij/diff/DiffNotificationIdsHolder.kt` | `[ ]` | diff 框架层（请求/窗口/工具注册）。本仓的 diff 只有剪贴板对比与保存冲突预览两处纯函数（`src/diffText.ts:16-52`），不存在 DiffRequest/DiffWindow 这一层。 |
| `DiffRequestFactoryImpl` | `platform/diff-impl/src/com/intellij/diff/DiffRequestFactoryImpl.java` | `[ ]` | diff 框架层（请求/窗口/工具注册）。本仓的 diff 只有剪贴板对比与保存冲突预览两处纯函数（`src/diffText.ts:16-52`），不存在 DiffRequest/DiffWindow 这一层。 |
| `DiffViewerEx` | `platform/diff-impl/src/com/intellij/diff/DiffViewerEx.java` | `[ ]` | diff 框架层（请求/窗口/工具注册）。本仓的 diff 只有剪贴板对比与保存冲突预览两处纯函数（`src/diffText.ts:16-52`），不存在 DiffRequest/DiffWindow 这一层。 |
| `AllLinesIterator` | `platform/diff-impl/src/com/intellij/diff/actions/AllLinesIterator.java` | `[ ]` | diff 的动作族（比较、显示、Undo/Redo 代理），绝大多数挂在 diff 工具窗的标题栏上。 |
| `BaseShowDiffAction` | `platform/diff-impl/src/com/intellij/diff/actions/BaseShowDiffAction.java` | `[ ]` | diff 的动作族（比较、显示、Undo/Redo 代理），绝大多数挂在 diff 工具窗的标题栏上。 |
| `BufferedLineIterator` | `platform/diff-impl/src/com/intellij/diff/actions/BufferedLineIterator.java` | `[ ]` | diff 的动作族（比较、显示、Undo/Redo 代理），绝大多数挂在 diff 工具窗的标题栏上。 |
| `CompareClipboardWithSelectionAction` | `platform/diff-impl/src/com/intellij/diff/actions/CompareClipboardWithSelectionAction.java` | `[x]` | 编辑器右键「与剪贴板比较」（`src/menus/codeMenu.ts:103`）→ `src/vcsActions.ts:114-122` 取当前标签文本与剪贴板文本喂 `buildDiffRows`，产出 `clipboardDiff`。 |
| `CompareFileWithEditorAction` | `platform/diff-impl/src/com/intellij/diff/actions/CompareFileWithEditorAction.java` | `[~]` | 保存冲突预览确实做了差异展示（`src/editorFileOps.ts:44-54` 的 `conflictDiff`），但它是保存冲突流程里的一步，不是独立动作，也没有上游那个 Compare 工具窗。 |
| `CompareFilesAction` | `platform/diff-impl/src/com/intellij/diff/actions/CompareFilesAction.java` | `[~]` | 打开 Compare with File。本仓只有「与剪贴板比较」（`src/menus/codeMenu.ts:103`）与保存冲突预览，没有任选文件的两两比较对话框。 |
| `DiffReaderModeMatcher` | `platform/diff-impl/src/com/intellij/diff/actions/DiffReaderModeMatcher.kt` | `[ ]` | diff 的动作族（比较、显示、Undo/Redo 代理），绝大多数挂在 diff 工具窗的标题栏上。 |
| `DocumentFragmentContent` | `platform/diff-impl/src/com/intellij/diff/actions/DocumentFragmentContent.java` | `[ ]` | diff 的动作族（比较、显示、Undo/Redo 代理），绝大多数挂在 diff 工具窗的标题栏上。 |
| `DocumentsSynchronizer` | `platform/diff-impl/src/com/intellij/diff/actions/DocumentsSynchronizer.java` | `[ ]` | diff 的动作族（比较、显示、Undo/Redo 代理），绝大多数挂在 diff 工具窗的标题栏上。 |
| `ImmutableDocumentFragmentContent` | `platform/diff-impl/src/com/intellij/diff/actions/ImmutableDocumentFragmentContent.java` | `[ ]` | diff 的动作族（比较、显示、Undo/Redo 代理），绝大多数挂在 diff 工具窗的标题栏上。 |
| `ProxyUndoRedoAction` | `platform/diff-impl/src/com/intellij/diff/actions/ProxyUndoRedoAction.java` | `[ ]` | diff 的动作族（比较、显示、Undo/Redo 代理），绝大多数挂在 diff 工具窗的标题栏上。 |
| `ShowBlankDiffWindowAction` | `platform/diff-impl/src/com/intellij/diff/actions/ShowBlankDiffWindowAction.kt` | `[ ]` | diff 的动作族（比较、显示、Undo/Redo 代理），绝大多数挂在 diff 工具窗的标题栏上。 |
| `ShowDiffAction` | `platform/diff-impl/src/com/intellij/diff/actions/ShowDiffAction.java` | `[ ]` | diff 的动作族（比较、显示、Undo/Redo 代理），绝大多数挂在 diff 工具窗的标题栏上。 |
| `ShowStandaloneDiffAction` | `platform/diff-impl/src/com/intellij/diff/actions/ShowStandaloneDiffAction.kt` | `[ ]` | diff 的动作族（比较、显示、Undo/Redo 代理），绝大多数挂在 diff 工具窗的标题栏上。 |
| `CombinedDiffToggleAction` | `platform/diff-impl/src/com/intellij/diff/actions/impl/CombinedDiffToggleAction.kt` | `[ ]` | 差异导航 / 焦点切换 / 工具栏动作。本仓的对比视图是静态两栏，没有"下一个差异"这一套。 |
| `DiffDifferenceNavigationAction` | `platform/diff-impl/src/com/intellij/diff/actions/impl/DiffDifferenceNavigationAction.kt` | `[ ]` | 差异导航 / 焦点切换 / 工具栏动作。本仓的对比视图是静态两栏，没有"下一个差异"这一套。 |
| `DiffFileNavigationAction` | `platform/diff-impl/src/com/intellij/diff/actions/impl/DiffFileNavigationAction.kt` | `[ ]` | 差异导航 / 焦点切换 / 工具栏动作。本仓的对比视图是静态两栏，没有"下一个差异"这一套。 |
| `DiffNextDifferenceAction` | `platform/diff-impl/src/com/intellij/diff/actions/impl/DiffNextDifferenceAction.kt` | `[ ]` | 差异导航 / 焦点切换 / 工具栏动作。本仓的对比视图是静态两栏，没有"下一个差异"这一套。 |
| `DiffNextFileAction` | `platform/diff-impl/src/com/intellij/diff/actions/impl/DiffNextFileAction.kt` | `[ ]` | 差异导航 / 焦点切换 / 工具栏动作。本仓的对比视图是静态两栏，没有"下一个差异"这一套。 |
| `DiffPreviousDifferenceAction` | `platform/diff-impl/src/com/intellij/diff/actions/impl/DiffPreviousDifferenceAction.kt` | `[ ]` | 差异导航 / 焦点切换 / 工具栏动作。本仓的对比视图是静态两栏，没有"下一个差异"这一套。 |
| `DiffPreviousFileAction` | `platform/diff-impl/src/com/intellij/diff/actions/impl/DiffPreviousFileAction.kt` | `[ ]` | 差异导航 / 焦点切换 / 工具栏动作。本仓的对比视图是静态两栏，没有"下一个差异"这一套。 |
| `DiffUiDataRule` | `platform/diff-impl/src/com/intellij/diff/actions/impl/DiffUiDataRule.java` | `[ ]` | 差异导航 / 焦点切换 / 工具栏动作。本仓的对比视图是静态两栏，没有"下一个差异"这一套。 |
| `FocusOppositePaneAction` | `platform/diff-impl/src/com/intellij/diff/actions/impl/FocusOppositePaneAction.java` | `[ ]` | 差异导航 / 焦点切换 / 工具栏动作。本仓的对比视图是静态两栏，没有"下一个差异"这一套。 |
| `GoToChangePopupBuilder` | `platform/diff-impl/src/com/intellij/diff/actions/impl/GoToChangePopupBuilder.kt` | `[ ]` | 差异导航 / 焦点切换 / 工具栏动作。本仓的对比视图是静态两栏，没有"下一个差异"这一套。 |
| `LinkAction` | `platform/diff-impl/src/com/intellij/diff/actions/impl/LinkAction.kt` | `[ ]` | 差异导航 / 焦点切换 / 工具栏动作。本仓的对比视图是静态两栏，没有"下一个差异"这一套。 |
| `MutableDiffRequestChain` | `platform/diff-impl/src/com/intellij/diff/actions/impl/MutableDiffRequestChain.kt` | `[ ]` | 差异导航 / 焦点切换 / 工具栏动作。本仓的对比视图是静态两栏，没有"下一个差异"这一套。 |
| `NextDifferenceAction` | `platform/diff-impl/src/com/intellij/diff/actions/impl/NextDifferenceAction.java` | `[ ]` | 差异导航 / 焦点切换 / 工具栏动作。本仓的对比视图是静态两栏，没有"下一个差异"这一套。 |
| `OpenDiffInEditorAction` | `platform/diff-impl/src/com/intellij/diff/actions/impl/OpenDiffInEditorAction.java` | `[ ]` | 差异导航 / 焦点切换 / 工具栏动作。本仓的对比视图是静态两栏，没有"下一个差异"这一套。 |
| `OpenInEditorAction` | `platform/diff-impl/src/com/intellij/diff/actions/impl/OpenInEditorAction.kt` | `[ ]` | 差异导航 / 焦点切换 / 工具栏动作。本仓的对比视图是静态两栏，没有"下一个差异"这一套。 |
| `OpenInEditorWithMouseAction` | `platform/diff-impl/src/com/intellij/diff/actions/impl/OpenInEditorWithMouseAction.java` | `[ ]` | 差异导航 / 焦点切换 / 工具栏动作。本仓的对比视图是静态两栏，没有"下一个差异"这一套。 |
| `SetEditorSettingsAction` | `platform/diff-impl/src/com/intellij/diff/actions/impl/SetEditorSettingsAction.kt` | `[ ]` | 差异导航 / 焦点切换 / 工具栏动作。本仓的对比视图是静态两栏，没有"下一个差异"这一套。 |
| `SetEditorSettingsActionGroup` | `platform/diff-impl/src/com/intellij/diff/actions/impl/SetEditorSettingsActionGroup.kt` | `[ ]` | 差异导航 / 焦点切换 / 工具栏动作。本仓的对比视图是静态两栏，没有"下一个差异"这一套。 |
| `ToggleDiffAligningModeAction` | `platform/diff-impl/src/com/intellij/diff/actions/impl/ToggleDiffAligningModeAction.kt` | `[ ]` | 差异导航 / 焦点切换 / 工具栏动作。本仓的对比视图是静态两栏，没有"下一个差异"这一套。 |
| `DiffApplication` | `platform/diff-impl/src/com/intellij/diff/applications/DiffApplication.kt` | `[-]` | 命令入口（Compare/Merge）。本仓的对应入口挂在文件树与编辑器右键上（`src/menus/codeMenu.ts:103`），不走应用级 action 注册。 |
| `DiffApplicationBase` | `platform/diff-impl/src/com/intellij/diff/applications/DiffApplicationBase.java` | `[-]` | 命令入口（Compare/Merge）。本仓的对应入口挂在文件树与编辑器右键上（`src/menus/codeMenu.ts:103`），不走应用级 action 注册。 |
| `MergeApplication` | `platform/diff-impl/src/com/intellij/diff/applications/MergeApplication.kt` | `[-]` | 命令入口（Compare/Merge）。本仓的对应入口挂在文件树与编辑器右键上（`src/menus/codeMenu.ts:103`），不走应用级 action 注册。 |
| `DiffAudioCues` | `platform/diff-impl/src/com/intellij/diff/audioCues/DiffAudioCues.kt` | `[-]` | 差异音效。本仓不做音频，且上游这档默认也是关的。 |
| `DiffChangeAudioCueDetector` | `platform/diff-impl/src/com/intellij/diff/audioCues/DiffChangeAudioCueDetector.kt` | `[-]` | 差异音效。本仓不做音频，且上游这档默认也是关的。 |
| `AsyncDiffRequestChain` | `platform/diff-impl/src/com/intellij/diff/chains/AsyncDiffRequestChain.java` | `[ ]` | 异步 diff 请求链与结果缓存。本仓的两处 diff 都是同步算完直接用。 |
| `ByLine` | `platform/diff-impl/src/com/intellij/diff/comparison/ByLine.java` | `[~]` | 行级比较的对象版（`ByLine.kt`）。本仓只有函数版 `src/diffAlign.ts:214` `alignLines`，没有 `DiffIterable` 形态。 |
| `ByWord` | `platform/diff-impl/src/com/intellij/diff/comparison/ByWord.java` | `[ ]` | 比较算法族。本仓只做了行级（`src/diffAlign.ts`），词级/字符级都没有。 |
| `ComparisonManagerImpl` | `platform/diff-impl/src/com/intellij/diff/comparison/ComparisonManagerImpl.java` | `[~]` | 794 行的策略选择器（先按行再按词再按字符、可降级、可取消）。本仓固定一级，入口就是 `src/diffAlign.ts:214` `alignLines`。 |
| `DiffIterableUtilEx` | `platform/diff-impl/src/com/intellij/diff/comparison/DiffIterableUtilEx.java` | `[ ]` | 比较算法族。本仓只做了行级（`src/diffAlign.ts`），词级/字符级都没有。 |
| `IndicatorCancellationChecker` | `platform/diff-impl/src/com/intellij/diff/comparison/IndicatorCancellationChecker.kt` | `[ ]` | 比较算法族。本仓只做了行级（`src/diffAlign.ts`），词级/字符级都没有。 |
| `DirectoryContentImpl` | `platform/diff-impl/src/com/intellij/diff/contents/DirectoryContentImpl.java` | `[ ]` | 内容抽象（文件/文档/目录/二进制）。本仓直接吃字符串数组。 |
| `DocumentContentBase` | `platform/diff-impl/src/com/intellij/diff/contents/DocumentContentBase.java` | `[ ]` | 内容抽象（文件/文档/目录/二进制）。本仓直接吃字符串数组。 |
| `DocumentContentImpl` | `platform/diff-impl/src/com/intellij/diff/contents/DocumentContentImpl.java` | `[ ]` | 内容抽象（文件/文档/目录/二进制）。本仓直接吃字符串数组。 |
| `FileContentImpl` | `platform/diff-impl/src/com/intellij/diff/contents/FileContentImpl.java` | `[ ]` | 内容抽象（文件/文档/目录/二进制）。本仓直接吃字符串数组。 |
| `FileDocumentContentImpl` | `platform/diff-impl/src/com/intellij/diff/contents/FileDocumentContentImpl.java` | `[ ]` | 内容抽象（文件/文档/目录/二进制）。本仓直接吃字符串数组。 |
| `ChainDiffVirtualFile` | `platform/diff-impl/src/com/intellij/diff/editor/ChainDiffVirtualFile.kt` | `[ ]` | 把 diff 包装成 VirtualFile/编辑器页签。本仓的对比视图是一个纯展示组件。 |
| `DefaultDiffFileEditorCustomizer` | `platform/diff-impl/src/com/intellij/diff/editor/DefaultDiffFileEditorCustomizer.kt` | `[ ]` | 把 diff 包装成 VirtualFile/编辑器页签。本仓的对比视图是一个纯展示组件。 |
| `DiffContentVirtualFile` | `platform/diff-impl/src/com/intellij/diff/editor/DiffContentVirtualFile.kt` | `[ ]` | 把 diff 包装成 VirtualFile/编辑器页签。本仓的对比视图是一个纯展示组件。 |
| `DiffEditorEscapeAction` | `platform/diff-impl/src/com/intellij/diff/editor/DiffEditorEscapeAction.kt` | `[ ]` | 把 diff 包装成 VirtualFile/编辑器页签。本仓的对比视图是一个纯展示组件。 |
| `DiffEditorTabFilesManager` | `platform/diff-impl/src/com/intellij/diff/editor/DiffEditorTabFilesManager.kt` | `[ ]` | 把 diff 包装成 VirtualFile/编辑器页签。本仓的对比视图是一个纯展示组件。 |
| `DiffEditorTabFilesManagerImpl` | `platform/diff-impl/src/com/intellij/diff/editor/DiffEditorTabFilesManagerImpl.kt` | `[ ]` | 把 diff 包装成 VirtualFile/编辑器页签。本仓的对比视图是一个纯展示组件。 |
| `DiffEditorTabFilesUtil` | `platform/diff-impl/src/com/intellij/diff/editor/DiffEditorTabFilesUtil.kt` | `[ ]` | 把 diff 包装成 VirtualFile/编辑器页签。本仓的对比视图是一个纯展示组件。 |
| `DiffEditorTabTitleProvider` | `platform/diff-impl/src/com/intellij/diff/editor/DiffEditorTabTitleProvider.kt` | `[ ]` | 把 diff 包装成 VirtualFile/编辑器页签。本仓的对比视图是一个纯展示组件。 |
| `DiffEditorViewerFileEditor` | `platform/diff-impl/src/com/intellij/diff/editor/DiffEditorViewerFileEditor.kt` | `[ ]` | 把 diff 包装成 VirtualFile/编辑器页签。本仓的对比视图是一个纯展示组件。 |
| `DiffFileEditorBase` | `platform/diff-impl/src/com/intellij/diff/editor/DiffFileEditorBase.kt` | `[ ]` | 把 diff 包装成 VirtualFile/编辑器页签。本仓的对比视图是一个纯展示组件。 |
| `DiffFileEditorProvider` | `platform/diff-impl/src/com/intellij/diff/editor/DiffFileEditorProvider.kt` | `[ ]` | 把 diff 包装成 VirtualFile/编辑器页签。本仓的对比视图是一个纯展示组件。 |
| `DiffFileIconProvider` | `platform/diff-impl/src/com/intellij/diff/editor/DiffFileIconProvider.kt` | `[ ]` | 把 diff 包装成 VirtualFile/编辑器页签。本仓的对比视图是一个纯展示组件。 |
| `DiffFileType` | `platform/diff-impl/src/com/intellij/diff/editor/DiffFileType.kt` | `[ ]` | 把 diff 包装成 VirtualFile/编辑器页签。本仓的对比视图是一个纯展示组件。 |
| `DiffRequestProcessorEditorCustomizer` | `platform/diff-impl/src/com/intellij/diff/editor/DiffRequestProcessorEditorCustomizer.kt` | `[ ]` | 把 diff 包装成 VirtualFile/编辑器页签。本仓的对比视图是一个纯展示组件。 |
| `DiffVirtualFile` | `platform/diff-impl/src/com/intellij/diff/editor/DiffVirtualFile.kt` | `[ ]` | 把 diff 包装成 VirtualFile/编辑器页签。本仓的对比视图是一个纯展示组件。 |
| `DiffVirtualFileBase` | `platform/diff-impl/src/com/intellij/diff/editor/DiffVirtualFileBase.kt` | `[ ]` | 把 diff 包装成 VirtualFile/编辑器页签。本仓的对比视图是一个纯展示组件。 |
| `SimpleDiffVirtualFile` | `platform/diff-impl/src/com/intellij/diff/editor/SimpleDiffVirtualFile.kt` | `[ ]` | 把 diff 包装成 VirtualFile/编辑器页签。本仓的对比视图是一个纯展示组件。 |
| `FrontendDiffExtension` | `platform/diff-impl/src/com/intellij/diff/frontend/FrontendDiffExtension.kt` | `[-]` | 只对 JetBrains 自家前端（JS）暴露的 diff 内部 API，外人用不到。 |
| `FrontendDiffUserDataKeyDescriptor` | `platform/diff-impl/src/com/intellij/diff/frontend/FrontendDiffUserDataKeyDescriptor.kt` | `[-]` | 只对 JetBrains 自家前端（JS）暴露的 diff 内部 API，外人用不到。 |
| `FrontendDiffActualStateHolder` | `platform/diff-impl/src/com/intellij/diff/frontend/impl/FrontendDiffActualStateHolder.kt` | `[ ]` | 把 diff 映射桥给前端的具体实现。本仓由 `src/bridge.ts` 的 `DiffRow` 类型承担，形态完全不同。 |
| `FrontendSideBySideDiffMapping` | `platform/diff-impl/src/com/intellij/diff/frontend/impl/FrontendSideBySideDiffMapping.kt` | `[ ]` | 把 diff 映射桥给前端的具体实现。本仓由 `src/bridge.ts` 的 `DiffRow` 类型承担，形态完全不同。 |
| `FrontendUnifiedDiffSegmentMapping` | `platform/diff-impl/src/com/intellij/diff/frontend/impl/FrontendUnifiedDiffSegmentMapping.kt` | `[ ]` | 把 diff 映射桥给前端的具体实现。本仓由 `src/bridge.ts` 的 `DiffRow` 类型承担，形态完全不同。 |
| `LocalFrontendDiffExtensionBridge` | `platform/diff-impl/src/com/intellij/diff/frontend/impl/LocalFrontendDiffExtensionBridge.kt` | `[~]` | 把 diff 映射桥给前端的具体实现。本仓由 `src/diffText.ts:16-47` 直接产出可序列化的 `DiffRow[]`，没有中间桥。 |
| `CacheDiffRequestChainProcessor` | `platform/diff-impl/src/com/intellij/diff/impl/CacheDiffRequestChainProcessor.java` | `[ ]` | diff 请求处理器（1659 行）与窗口实现，含缓存与取消。本仓无请求生命周期。 |
| `CacheDiffRequestProcessor` | `platform/diff-impl/src/com/intellij/diff/impl/CacheDiffRequestProcessor.java` | `[ ]` | diff 请求处理器（1659 行）与窗口实现，含缓存与取消。本仓无请求生命周期。 |
| `DiffContextOnDataHolders` | `platform/diff-impl/src/com/intellij/diff/impl/DiffContextOnDataHolders.java` | `[ ]` | diff 请求处理器（1659 行）与窗口实现，含缓存与取消。本仓无请求生命周期。 |
| `DiffEditorTitleDetails` | `platform/diff-impl/src/com/intellij/diff/impl/DiffEditorTitleDetails.kt` | `[ ]` | diff 请求处理器（1659 行）与窗口实现，含缓存与取消。本仓无请求生命周期。 |
| `DiffEditorViewer` | `platform/diff-impl/src/com/intellij/diff/impl/DiffEditorViewer.kt` | `[ ]` | diff 请求处理器（1659 行）与窗口实现，含缓存与取消。本仓无请求生命周期。 |
| `DiffRequestPanelImpl` | `platform/diff-impl/src/com/intellij/diff/impl/DiffRequestPanelImpl.java` | `[ ]` | diff 请求处理器（1659 行）与窗口实现，含缓存与取消。本仓无请求生命周期。 |
| `DiffRequestProcessor` | `platform/diff-impl/src/com/intellij/diff/impl/DiffRequestProcessor.java` | `[ ]` | diff 请求处理器（1659 行）与窗口实现，含缓存与取消。本仓无请求生命周期。 |
| `DiffRequestProcessorEditorState` | `platform/diff-impl/src/com/intellij/diff/impl/DiffRequestProcessorEditorState.kt` | `[ ]` | diff 请求处理器（1659 行）与窗口实现，含缓存与取消。本仓无请求生命周期。 |
| `DiffRequestProcessorListener` | `platform/diff-impl/src/com/intellij/diff/impl/DiffRequestProcessorListener.java` | `[ ]` | diff 请求处理器（1659 行）与窗口实现，含缓存与取消。本仓无请求生命周期。 |
| `DiffSettingsHolder` | `platform/diff-impl/src/com/intellij/diff/impl/DiffSettingsHolder.kt` | `[ ]` | diff 请求处理器（1659 行）与窗口实现，含缓存与取消。本仓无请求生命周期。 |
| `DiffToolSubstitutor` | `platform/diff-impl/src/com/intellij/diff/impl/DiffToolSubstitutor.java` | `[ ]` | diff 请求处理器（1659 行）与窗口实现，含缓存与取消。本仓无请求生命周期。 |
| `DiffViewerWrapper` | `platform/diff-impl/src/com/intellij/diff/impl/DiffViewerWrapper.java` | `[ ]` | diff 请求处理器（1659 行）与窗口实现，含缓存与取消。本仓无请求生命周期。 |
| `DiffWindow` | `platform/diff-impl/src/com/intellij/diff/impl/DiffWindow.java` | `[ ]` | diff 请求处理器（1659 行）与窗口实现，含缓存与取消。本仓无请求生命周期。 |
| `DiffWindowBase` | `platform/diff-impl/src/com/intellij/diff/impl/DiffWindowBase.java` | `[ ]` | diff 请求处理器（1659 行）与窗口实现，含缓存与取消。本仓无请求生命周期。 |
| `FileAssignmentTracker` | `platform/diff-impl/src/com/intellij/diff/impl/FileAssignmentTracker.kt` | `[ ]` | diff 请求处理器（1659 行）与窗口实现，含缓存与取消。本仓无请求生命周期。 |
| `DiffHeaderToolbarPanel` | `platform/diff-impl/src/com/intellij/diff/impl/ui/DiffHeaderToolbarPanel.kt` | `[-]` | diff 工具窗工具栏 UI（Swing 布局）。 |
| `DiffHeaderToolbarUtil` | `platform/diff-impl/src/com/intellij/diff/impl/ui/DiffHeaderToolbarUtil.kt` | `[-]` | diff 工具窗工具栏 UI（Swing 布局）。 |
| `DiffToolChooser` | `platform/diff-impl/src/com/intellij/diff/impl/ui/DiffToolChooser.kt` | `[-]` | diff 工具窗工具栏 UI（Swing 布局）。 |
| `FilePathDiffTitleCustomizer` | `platform/diff-impl/src/com/intellij/diff/impl/ui/FilePathDiffTitleCustomizer.kt` | `[-]` | diff 工具窗工具栏 UI（Swing 布局）。 |
| `NoShrinkToolbarLayoutStrategy` | `platform/diff-impl/src/com/intellij/diff/impl/ui/NoShrinkToolbarLayoutStrategy.kt` | `[-]` | diff 工具窗工具栏 UI（Swing 布局）。 |
| `package-info` | `platform/diff-impl/src/com/intellij/diff/impl/ui/package-info.java` | `[-]` | diff 工具窗工具栏 UI（Swing 布局）。 |
| `DiffIgnoredRangeProvider` | `platform/diff-impl/src/com/intellij/diff/lang/DiffIgnoredRangeProvider.java` | `[ ]` | 按语言的忽略范围（Java 跳过 import/字符串等）。本仓纯文本逐行比较，不做语言特化。 |
| `DiffLangSpecificProvider` | `platform/diff-impl/src/com/intellij/diff/lang/DiffLangSpecificProvider.kt` | `[ ]` | 按语言的忽略范围（Java 跳过 import/字符串等）。本仓纯文本逐行比较，不做语言特化。 |
| `DiffLanguage` | `platform/diff-impl/src/com/intellij/diff/lang/DiffLanguage.kt` | `[ ]` | 按语言的忽略范围（Java 跳过 import/字符串等）。本仓纯文本逐行比较，不做语言特化。 |
| `LangDiffIgnoredRangeProvider` | `platform/diff-impl/src/com/intellij/diff/lang/LangDiffIgnoredRangeProvider.java` | `[ ]` | 按语言的忽略范围（Java 跳过 import/字符串等）。本仓纯文本逐行比较，不做语言特化。 |
| `ApplyNonConflictsAction` | `platform/diff-impl/src/com/intellij/diff/merge/ApplyNonConflictsAction.kt` | `[ ]` | 三方合并与冲突解决。本仓的保存冲突只**展示**差异，由用户自己在编辑器里改（`src/editorFileOps.ts:44-54`）。 |
| `BinaryMergeTool` | `platform/diff-impl/src/com/intellij/diff/merge/BinaryMergeTool.java` | `[ ]` | 三方合并与冲突解决。本仓的保存冲突只**展示**差异，由用户自己在编辑器里改（`src/editorFileOps.ts:44-54`）。 |
| `ChangeReferenceProcessor` | `platform/diff-impl/src/com/intellij/diff/merge/ChangeReferenceProcessor.kt` | `[ ]` | 三方合并与冲突解决。本仓的保存冲突只**展示**差异，由用户自己在编辑器里改（`src/editorFileOps.ts:44-54`）。 |
| `ErrorMergeTool` | `platform/diff-impl/src/com/intellij/diff/merge/ErrorMergeTool.java` | `[ ]` | 三方合并与冲突解决。本仓的保存冲突只**展示**差异，由用户自己在编辑器里改（`src/editorFileOps.ts:44-54`）。 |
| `IterativeResolveData` | `platform/diff-impl/src/com/intellij/diff/merge/IterativeResolveData.kt` | `[ ]` | 三方合并与冲突解决。本仓的保存冲突只**展示**差异，由用户自己在编辑器里改（`src/editorFileOps.ts:44-54`）。 |
| `LangSpecificMergeConflictResolver` | `platform/diff-impl/src/com/intellij/diff/merge/LangSpecificMergeConflictResolver.kt` | `[ ]` | 三方合并与冲突解决。本仓的保存冲突只**展示**差异，由用户自己在编辑器里改（`src/editorFileOps.ts:44-54`）。 |
| `LangSpecificMergeConflictResolverWrapper` | `platform/diff-impl/src/com/intellij/diff/merge/LangSpecificMergeConflictResolverWrapper.kt` | `[ ]` | 三方合并与冲突解决。本仓的保存冲突只**展示**差异，由用户自己在编辑器里改（`src/editorFileOps.ts:44-54`）。 |
| `LangSpecificMergeContext` | `platform/diff-impl/src/com/intellij/diff/merge/LangSpecificMergeContext.kt` | `[ ]` | 三方合并与冲突解决。本仓的保存冲突只**展示**差异，由用户自己在编辑器里改（`src/editorFileOps.ts:44-54`）。 |
| `MagicResolvedConflictsAction` | `platform/diff-impl/src/com/intellij/diff/merge/MagicResolvedConflictsAction.kt` | `[ ]` | 三方合并与冲突解决。本仓的保存冲突只**展示**差异，由用户自己在编辑器里改（`src/editorFileOps.ts:44-54`）。 |
| `MergeConflictModel` | `platform/diff-impl/src/com/intellij/diff/merge/MergeConflictModel.kt` | `[ ]` | 三方合并与冲突解决。本仓的保存冲突只**展示**差异，由用户自己在编辑器里改（`src/editorFileOps.ts:44-54`）。 |
| `MergeContextEx` | `platform/diff-impl/src/com/intellij/diff/merge/MergeContextEx.java` | `[ ]` | 三方合并与冲突解决。本仓的保存冲突只**展示**差异，由用户自己在编辑器里改（`src/editorFileOps.ts:44-54`）。 |
| `MergeDiffBuilder` | `platform/diff-impl/src/com/intellij/diff/merge/MergeDiffBuilder.kt` | `[ ]` | 三方合并与冲突解决。本仓的保存冲突只**展示**差异，由用户自己在编辑器里改（`src/editorFileOps.ts:44-54`）。 |
| `MergeImportUtil` | `platform/diff-impl/src/com/intellij/diff/merge/MergeImportUtil.kt` | `[ ]` | 三方合并与冲突解决。本仓的保存冲突只**展示**差异，由用户自己在编辑器里改（`src/editorFileOps.ts:44-54`）。 |
| `MergeModelBase` | `platform/diff-impl/src/com/intellij/diff/merge/MergeModelBase.kt` | `[ ]` | 三方合并与冲突解决。本仓的保存冲突只**展示**差异，由用户自己在编辑器里改（`src/editorFileOps.ts:44-54`）。 |
| `MergeRequestProcessor` | `platform/diff-impl/src/com/intellij/diff/merge/MergeRequestProcessor.java` | `[ ]` | 三方合并与冲突解决。本仓的保存冲突只**展示**差异，由用户自己在编辑器里改（`src/editorFileOps.ts:44-54`）。 |
| `MergeStatisticsAggregator` | `platform/diff-impl/src/com/intellij/diff/merge/MergeStatisticsAggregator.kt` | `[ ]` | 三方合并与冲突解决。本仓的保存冲突只**展示**差异，由用户自己在编辑器里改（`src/editorFileOps.ts:44-54`）。 |
| `MergeThreesideLineStatusMarkerRenderer` | `platform/diff-impl/src/com/intellij/diff/merge/MergeThreesideLineStatusMarkerRenderer.kt` | `[ ]` | 三方合并与冲突解决。本仓的保存冲突只**展示**差异，由用户自己在编辑器里改（`src/editorFileOps.ts:44-54`）。 |
| `MergeThreesideViewer` | `platform/diff-impl/src/com/intellij/diff/merge/MergeThreesideViewer.java` | `[ ]` | 三方合并与冲突解决。本仓的保存冲突只**展示**差异，由用户自己在编辑器里改（`src/editorFileOps.ts:44-54`）。 |
| `MergeThreesideViewerActions` | `platform/diff-impl/src/com/intellij/diff/merge/MergeThreesideViewerActions.kt` | `[ ]` | 三方合并与冲突解决。本仓的保存冲突只**展示**差异，由用户自己在编辑器里改（`src/editorFileOps.ts:44-54`）。 |
| `MergeUtil` | `platform/diff-impl/src/com/intellij/diff/merge/MergeUtil.java` | `[ ]` | 三方合并与冲突解决。本仓的保存冲突只**展示**差异，由用户自己在编辑器里改（`src/editorFileOps.ts:44-54`）。 |
| `MergeWindow` | `platform/diff-impl/src/com/intellij/diff/merge/MergeWindow.java` | `[ ]` | 三方合并与冲突解决。本仓的保存冲突只**展示**差异，由用户自己在编辑器里改（`src/editorFileOps.ts:44-54`）。 |
| `MessageMergeViewer` | `platform/diff-impl/src/com/intellij/diff/merge/MessageMergeViewer.java` | `[ ]` | 三方合并与冲突解决。本仓的保存冲突只**展示**差异，由用户自己在编辑器里改（`src/editorFileOps.ts:44-54`）。 |
| `NavigateToChangeMarkerAction` | `platform/diff-impl/src/com/intellij/diff/merge/NavigateToChangeMarkerAction.kt` | `[ ]` | 三方合并与冲突解决。本仓的保存冲突只**展示**差异，由用户自己在编辑器里改（`src/editorFileOps.ts:44-54`）。 |
| `RevertConflictResolutionAction` | `platform/diff-impl/src/com/intellij/diff/merge/RevertConflictResolutionAction.kt` | `[ ]` | 三方合并与冲突解决。本仓的保存冲突只**展示**差异，由用户自己在编辑器里改（`src/editorFileOps.ts:44-54`）。 |
| `ShowDiffWithBaseAction` | `platform/diff-impl/src/com/intellij/diff/merge/ShowDiffWithBaseAction.kt` | `[ ]` | 三方合并与冲突解决。本仓的保存冲突只**展示**差异，由用户自己在编辑器里改（`src/editorFileOps.ts:44-54`）。 |
| `TextMergeChange` | `platform/diff-impl/src/com/intellij/diff/merge/TextMergeChange.kt` | `[ ]` | 三方合并与冲突解决。本仓的保存冲突只**展示**差异，由用户自己在编辑器里改（`src/editorFileOps.ts:44-54`）。 |
| `TextMergeTool` | `platform/diff-impl/src/com/intellij/diff/merge/TextMergeTool.java` | `[ ]` | 三方合并与冲突解决。本仓的保存冲突只**展示**差异，由用户自己在编辑器里改（`src/editorFileOps.ts:44-54`）。 |
| `TextMergeViewer` | `platform/diff-impl/src/com/intellij/diff/merge/TextMergeViewer.kt` | `[ ]` | 三方合并与冲突解决。本仓的保存冲突只**展示**差异，由用户自己在编辑器里改（`src/editorFileOps.ts:44-54`）。 |
| `ThreesideMergeHighlighters` | `platform/diff-impl/src/com/intellij/diff/merge/ThreesideMergeHighlighters.kt` | `[ ]` | 三方合并与冲突解决。本仓的保存冲突只**展示**差异，由用户自己在编辑器里改（`src/editorFileOps.ts:44-54`）。 |
| `BinaryMergeRequestImpl` | `platform/diff-impl/src/com/intellij/diff/requests/BinaryMergeRequestImpl.java` | `[ ]` | diff 请求对象族。本仓的两次 diff 都是一次函数调用，没有请求对象。 |
| `LoadingDiffRequest` | `platform/diff-impl/src/com/intellij/diff/requests/LoadingDiffRequest.java` | `[ ]` | diff 请求对象族。本仓的两次 diff 都是一次函数调用，没有请求对象。 |
| `OperationCanceledDiffRequest` | `platform/diff-impl/src/com/intellij/diff/requests/OperationCanceledDiffRequest.java` | `[ ]` | diff 请求对象族。本仓的两次 diff 都是一次函数调用，没有请求对象。 |
| `TextMergeRequestImpl` | `platform/diff-impl/src/com/intellij/diff/requests/TextMergeRequestImpl.java` | `[ ]` | diff 请求对象族。本仓的两次 diff 都是一次函数调用，没有请求对象。 |
| `UnknownFileTypeDiffRequest` | `platform/diff-impl/src/com/intellij/diff/requests/UnknownFileTypeDiffRequest.java` | `[ ]` | diff 请求对象族。本仓的两次 diff 都是一次函数调用，没有请求对象。 |
| `DiffSettingsConfigurable` | `platform/diff-impl/src/com/intellij/diff/settings/DiffSettingsConfigurable.kt` | `[-]` | diff 设置页（高亮策略、外部工具表）。本仓没有 diff 设置页。 |
| `DiffSettingsProvider` | `platform/diff-impl/src/com/intellij/diff/settings/DiffSettingsProvider.kt` | `[-]` | diff 设置页（高亮策略、外部工具表）。本仓没有 diff 设置页。 |
| `ExternalDiffSettingsConfigurable` | `platform/diff-impl/src/com/intellij/diff/settings/ExternalDiffSettingsConfigurable.kt` | `[-]` | diff 设置页（高亮策略、外部工具表）。本仓没有 diff 设置页。 |
| `ExternalToolsModels` | `platform/diff-impl/src/com/intellij/diff/settings/ExternalToolsModels.kt` | `[-]` | diff 设置页（高亮策略、外部工具表）。本仓没有 diff 设置页。 |
| `ExternalToolsTablePanel` | `platform/diff-impl/src/com/intellij/diff/settings/ExternalToolsTablePanel.kt` | `[-]` | diff 设置页（高亮策略、外部工具表）。本仓没有 diff 设置页。 |
| `ExternalToolsTreePanel` | `platform/diff-impl/src/com/intellij/diff/settings/ExternalToolsTreePanel.kt` | `[-]` | diff 设置页（高亮策略、外部工具表）。本仓没有 diff 设置页。 |
| `DiffUsagesCollector` | `platform/diff-impl/src/com/intellij/diff/statistics/DiffUsagesCollector.kt` | `[-]` | 统计上报（diff 次数、合并冲突数）。 |
| `MergeStatisticsCollector` | `platform/diff-impl/src/com/intellij/diff/statistics/MergeStatisticsCollector.kt` | `[-]` | 统计上报（diff 次数、合并冲突数）。 |
| `ErrorDiffTool` | `platform/diff-impl/src/com/intellij/diff/tools/ErrorDiffTool.java` | `[ ]` | diff 查看器实现族。 |
| `BinaryDiffTool` | `platform/diff-impl/src/com/intellij/diff/tools/binary/BinaryDiffTool.java` | `[ ]` | 二进制 diff。本仓不比对二进制文件。 |
| `OnesideBinaryDiffViewer` | `platform/diff-impl/src/com/intellij/diff/tools/binary/OnesideBinaryDiffViewer.java` | `[ ]` | 二进制 diff。本仓不比对二进制文件。 |
| `ThreesideBinaryDiffViewer` | `platform/diff-impl/src/com/intellij/diff/tools/binary/ThreesideBinaryDiffViewer.java` | `[ ]` | 二进制 diff。本仓不比对二进制文件。 |
| `TwosideBinaryDiffViewer` | `platform/diff-impl/src/com/intellij/diff/tools/binary/TwosideBinaryDiffViewer.java` | `[ ]` | 二进制 diff。本仓不比对二进制文件。 |
| `BlockState` | `platform/diff-impl/src/com/intellij/diff/tools/combined/BlockState.kt` | `[ ]` | 合并 diff 查看器（左右改动并成一条带上下箭头）。本仓的对比视图只有左右两栏。 |
| `CombinedDiffActionPromoter` | `platform/diff-impl/src/com/intellij/diff/tools/combined/CombinedDiffActionPromoter.kt` | `[ ]` | 合并 diff 查看器（左右改动并成一条带上下箭头）。本仓的对比视图只有左右两栏。 |
| `CombinedDiffActions` | `platform/diff-impl/src/com/intellij/diff/tools/combined/CombinedDiffActions.kt` | `[ ]` | 合并 diff 查看器（左右改动并成一条带上下箭头）。本仓的对比视图只有左右两栏。 |
| `CombinedDiffBlocks` | `platform/diff-impl/src/com/intellij/diff/tools/combined/CombinedDiffBlocks.kt` | `[ ]` | 合并 diff 查看器（左右改动并成一条带上下箭头）。本仓的对比视图只有左右两栏。 |
| `CombinedDiffBlocksPanel` | `platform/diff-impl/src/com/intellij/diff/tools/combined/CombinedDiffBlocksPanel.kt` | `[ ]` | 合并 diff 查看器（左右改动并成一条带上下箭头）。本仓的对比视图只有左右两栏。 |
| `CombinedDiffCaretNavigation` | `platform/diff-impl/src/com/intellij/diff/tools/combined/CombinedDiffCaretNavigation.kt` | `[ ]` | 合并 diff 查看器（左右改动并成一条带上下箭头）。本仓的对比视图只有左右两栏。 |
| `CombinedDiffComponentProcessorImpl` | `platform/diff-impl/src/com/intellij/diff/tools/combined/CombinedDiffComponentProcessorImpl.kt` | `[ ]` | 合并 diff 查看器（左右改动并成一条带上下箭头）。本仓的对比视图只有左右两栏。 |
| `CombinedDiffContainerPanel` | `platform/diff-impl/src/com/intellij/diff/tools/combined/CombinedDiffContainerPanel.kt` | `[ ]` | 合并 diff 查看器（左右改动并成一条带上下箭头）。本仓的对比视图只有左右两栏。 |
| `CombinedDiffEditorHandlers` | `platform/diff-impl/src/com/intellij/diff/tools/combined/CombinedDiffEditorHandlers.kt` | `[ ]` | 合并 diff 查看器（左右改动并成一条带上下箭头）。本仓的对比视图只有左右两栏。 |
| `CombinedDiffKeys` | `platform/diff-impl/src/com/intellij/diff/tools/combined/CombinedDiffKeys.kt` | `[ ]` | 合并 diff 查看器（左右改动并成一条带上下箭头）。本仓的对比视图只有左右两栏。 |
| `CombinedDiffLoadingBlock` | `platform/diff-impl/src/com/intellij/diff/tools/combined/CombinedDiffLoadingBlock.kt` | `[ ]` | 合并 diff 查看器（左右改动并成一条带上下箭头）。本仓的对比视图只有左右两栏。 |
| `CombinedDiffMainToolbar` | `platform/diff-impl/src/com/intellij/diff/tools/combined/CombinedDiffMainToolbar.kt` | `[ ]` | 合并 diff 查看器（左右改动并成一条带上下箭头）。本仓的对比视图只有左右两栏。 |
| `CombinedDiffMainUI` | `platform/diff-impl/src/com/intellij/diff/tools/combined/CombinedDiffMainUI.kt` | `[ ]` | 合并 diff 查看器（左右改动并成一条带上下箭头）。本仓的对比视图只有左右两栏。 |
| `CombinedDiffModel` | `platform/diff-impl/src/com/intellij/diff/tools/combined/CombinedDiffModel.kt` | `[ ]` | 合并 diff 查看器（左右改动并成一条带上下箭头）。本仓的对比视图只有左右两栏。 |
| `CombinedDiffNavigation` | `platform/diff-impl/src/com/intellij/diff/tools/combined/CombinedDiffNavigation.kt` | `[ ]` | 合并 diff 查看器（左右改动并成一条带上下箭头）。本仓的对比视图只有左右两栏。 |
| `CombinedDiffRegistry` | `platform/diff-impl/src/com/intellij/diff/tools/combined/CombinedDiffRegistry.kt` | `[ ]` | 合并 diff 查看器（左右改动并成一条带上下箭头）。本仓的对比视图只有左右两栏。 |
| `CombinedDiffSelectablePanel` | `platform/diff-impl/src/com/intellij/diff/tools/combined/CombinedDiffSelectablePanel.kt` | `[ ]` | 合并 diff 查看器（左右改动并成一条带上下箭头）。本仓的对比视图只有左右两栏。 |
| `CombinedDiffTool` | `platform/diff-impl/src/com/intellij/diff/tools/combined/CombinedDiffTool.kt` | `[ ]` | 合并 diff 查看器（左右改动并成一条带上下箭头）。本仓的对比视图只有左右两栏。 |
| `CombinedDiffUI` | `platform/diff-impl/src/com/intellij/diff/tools/combined/CombinedDiffUI.kt` | `[ ]` | 合并 diff 查看器（左右改动并成一条带上下箭头）。本仓的对比视图只有左右两栏。 |
| `CombinedDiffViewer` | `platform/diff-impl/src/com/intellij/diff/tools/combined/CombinedDiffViewer.kt` | `[ ]` | 合并 diff 查看器（左右改动并成一条带上下箭头）。本仓的对比视图只有左右两栏。 |
| `CombinedDiffVirtualFile` | `platform/diff-impl/src/com/intellij/diff/tools/combined/CombinedDiffVirtualFile.kt` | `[ ]` | 合并 diff 查看器（左右改动并成一条带上下箭头）。本仓的对比视图只有左右两栏。 |
| `CombinedDiffSearch` | `platform/diff-impl/src/com/intellij/diff/tools/combined/search/CombinedDiffSearch.kt` | `[ ]` | 合并视图里的查找。 |
| `DirDiffTool` | `platform/diff-impl/src/com/intellij/diff/tools/dir/DirDiffTool.java` | `[ ]` | 目录 diff。本仓只支持文件两两比。 |
| `DirDiffViewer` | `platform/diff-impl/src/com/intellij/diff/tools/dir/DirDiffViewer.java` | `[ ]` | 目录 diff。本仓只支持文件两两比。 |
| `ExternalDiffSettings` | `platform/diff-impl/src/com/intellij/diff/tools/external/ExternalDiffSettings.kt` | `[ ]` | 外部 diff 工具配置与调用。 |
| `ExternalDiffTool` | `platform/diff-impl/src/com/intellij/diff/tools/external/ExternalDiffTool.kt` | `[ ]` | 外部 diff 工具配置与调用。 |
| `ExternalDiffToolUtil` | `platform/diff-impl/src/com/intellij/diff/tools/external/ExternalDiffToolUtil.java` | `[ ]` | 外部 diff 工具配置与调用。 |
| `ExternalMergeTool` | `platform/diff-impl/src/com/intellij/diff/tools/external/ExternalMergeTool.kt` | `[ ]` | 外部 diff 工具配置与调用。 |
| `HighlightRange` | `platform/diff-impl/src/com/intellij/diff/tools/fragmented/HighlightRange.java` | `[ ]` | unified diff 查看器（1771 行）。本仓只在预览里**生成** unified 文本（`src/diffText.ts:52`），不渲染它。 |
| `LineNumberConvertor` | `platform/diff-impl/src/com/intellij/diff/tools/fragmented/LineNumberConvertor.java` | `[ ]` | unified diff 查看器（1771 行）。本仓只在预览里**生成** unified 文本（`src/diffText.ts:52`），不渲染它。 |
| `UnifiedDiffChange` | `platform/diff-impl/src/com/intellij/diff/tools/fragmented/UnifiedDiffChange.java` | `[ ]` | unified diff 查看器（1771 行）。本仓只在预览里**生成** unified 文本（`src/diffText.ts:52`），不渲染它。 |
| `UnifiedDiffChangeUi` | `platform/diff-impl/src/com/intellij/diff/tools/fragmented/UnifiedDiffChangeUi.java` | `[ ]` | unified diff 查看器（1771 行）。本仓只在预览里**生成** unified 文本（`src/diffText.ts:52`），不渲染它。 |
| `UnifiedDiffHighlightersData` | `platform/diff-impl/src/com/intellij/diff/tools/fragmented/UnifiedDiffHighlightersData.java` | `[ ]` | unified diff 查看器（1771 行）。本仓只在预览里**生成** unified 文本（`src/diffText.ts:52`），不渲染它。 |
| `UnifiedDiffModel` | `platform/diff-impl/src/com/intellij/diff/tools/fragmented/UnifiedDiffModel.java` | `[ ]` | unified diff 查看器（1771 行）。本仓只在预览里**生成** unified 文本（`src/diffText.ts:52`），不渲染它。 |
| `UnifiedDiffPanel` | `platform/diff-impl/src/com/intellij/diff/tools/fragmented/UnifiedDiffPanel.java` | `[ ]` | unified diff 查看器（1771 行）。本仓只在预览里**生成** unified 文本（`src/diffText.ts:52`），不渲染它。 |
| `UnifiedDiffTool` | `platform/diff-impl/src/com/intellij/diff/tools/fragmented/UnifiedDiffTool.java` | `[ ]` | unified diff 查看器（1771 行）。本仓只在预览里**生成** unified 文本（`src/diffText.ts:52`），不渲染它。 |
| `UnifiedDiffViewer` | `platform/diff-impl/src/com/intellij/diff/tools/fragmented/UnifiedDiffViewer.java` | `[ ]` | unified diff 查看器（1771 行）。本仓只在预览里**生成** unified 文本（`src/diffText.ts:52`），不渲染它。 |
| `UnifiedEditorHighlighter` | `platform/diff-impl/src/com/intellij/diff/tools/fragmented/UnifiedEditorHighlighter.java` | `[ ]` | unified diff 查看器（1771 行）。本仓只在预览里**生成** unified 文本（`src/diffText.ts:52`），不渲染它。 |
| `UnifiedEditorRangeHighlighter` | `platform/diff-impl/src/com/intellij/diff/tools/fragmented/UnifiedEditorRangeHighlighter.java` | `[ ]` | unified diff 查看器（1771 行）。本仓只在预览里**生成** unified 文本（`src/diffText.ts:52`），不渲染它。 |
| `UnifiedFoldingModel` | `platform/diff-impl/src/com/intellij/diff/tools/fragmented/UnifiedFoldingModel.java` | `[ ]` | unified diff 查看器（1771 行）。本仓只在预览里**生成** unified 文本（`src/diffText.ts:52`），不渲染它。 |
| `UnifiedFragmentBuilder` | `platform/diff-impl/src/com/intellij/diff/tools/fragmented/UnifiedFragmentBuilder.kt` | `[ ]` | unified diff 查看器（1771 行）。本仓只在预览里**生成** unified 文本（`src/diffText.ts:52`），不渲染它。 |
| `BinaryEditorHolder` | `platform/diff-impl/src/com/intellij/diff/tools/holders/BinaryEditorHolder.java` | `[ ]` | 编辑器持有者（把 diff 塞进 Editor 的桥）。 |
| `EditorHolder` | `platform/diff-impl/src/com/intellij/diff/tools/holders/EditorHolder.java` | `[ ]` | 编辑器持有者（把 diff 塞进 Editor 的桥）。 |
| `EditorHolderFactory` | `platform/diff-impl/src/com/intellij/diff/tools/holders/EditorHolderFactory.java` | `[ ]` | 编辑器持有者（把 diff 塞进 Editor 的桥）。 |
| `TextEditorHolder` | `platform/diff-impl/src/com/intellij/diff/tools/holders/TextEditorHolder.java` | `[ ]` | 编辑器持有者（把 diff 塞进 Editor 的桥）。 |
| `IntentionDiffUtil` | `platform/diff-impl/src/com/intellij/diff/tools/intentions/IntentionDiffUtil.kt` | `[ ]` | 基于 quick-fix 的 diff 构造。 |
| `AlignedDiffModel` | `platform/diff-impl/src/com/intellij/diff/tools/simple/AlignedDiffModel.kt` | `[ ]` | 左右分栏 diff 查看器（1012 行）及其模型。本仓的对比视图只覆盖"行分类"这一步。 |
| `DiffViewerHighlighters` | `platform/diff-impl/src/com/intellij/diff/tools/simple/DiffViewerHighlighters.kt` | `[ ]` | 左右分栏 diff 查看器（1012 行）及其模型。本仓的对比视图只覆盖"行分类"这一步。 |
| `SimpleDiffChange` | `platform/diff-impl/src/com/intellij/diff/tools/simple/SimpleDiffChange.java` | `[ ]` | 左右分栏 diff 查看器（1012 行）及其模型。本仓的对比视图只覆盖"行分类"这一步。 |
| `SimpleDiffChangeUi` | `platform/diff-impl/src/com/intellij/diff/tools/simple/SimpleDiffChangeUi.java` | `[ ]` | 左右分栏 diff 查看器（1012 行）及其模型。本仓的对比视图只覆盖"行分类"这一步。 |
| `SimpleDiffChangesHolder` | `platform/diff-impl/src/com/intellij/diff/tools/simple/SimpleDiffChangesHolder.kt` | `[ ]` | 左右分栏 diff 查看器（1012 行）及其模型。本仓的对比视图只覆盖"行分类"这一步。 |
| `SimpleDiffModel` | `platform/diff-impl/src/com/intellij/diff/tools/simple/SimpleDiffModel.java` | `[ ]` | 左右分栏 diff 查看器（1012 行）及其模型。本仓的对比视图只覆盖"行分类"这一步。 |
| `SimpleDiffTool` | `platform/diff-impl/src/com/intellij/diff/tools/simple/SimpleDiffTool.java` | `[ ]` | 左右分栏 diff 查看器（1012 行）及其模型。本仓的对比视图只覆盖"行分类"这一步。 |
| `SimpleDiffViewer` | `platform/diff-impl/src/com/intellij/diff/tools/simple/SimpleDiffViewer.java` | `[ ]` | 左右分栏 diff 查看器（1012 行）及其模型。本仓的对比视图只覆盖"行分类"这一步。 |
| `SimpleDiffViewerHighlighters` | `platform/diff-impl/src/com/intellij/diff/tools/simple/SimpleDiffViewerHighlighters.kt` | `[ ]` | 左右分栏 diff 查看器（1012 行）及其模型。本仓的对比视图只覆盖"行分类"这一步。 |
| `SimpleOnesideDiffViewer` | `platform/diff-impl/src/com/intellij/diff/tools/simple/SimpleOnesideDiffViewer.java` | `[ ]` | 左右分栏 diff 查看器（1012 行）及其模型。本仓的对比视图只覆盖"行分类"这一步。 |
| `SimpleThreesideDiffChange` | `platform/diff-impl/src/com/intellij/diff/tools/simple/SimpleThreesideDiffChange.kt` | `[ ]` | 左右分栏 diff 查看器（1012 行）及其模型。本仓的对比视图只覆盖"行分类"这一步。 |
| `SimpleThreesideDiffViewer` | `platform/diff-impl/src/com/intellij/diff/tools/simple/SimpleThreesideDiffViewer.java` | `[ ]` | 左右分栏 diff 查看器（1012 行）及其模型。本仓的对比视图只覆盖"行分类"这一步。 |
| `ThreesideDiffChangeBase` | `platform/diff-impl/src/com/intellij/diff/tools/simple/ThreesideDiffChangeBase.kt` | `[ ]` | 左右分栏 diff 查看器（1012 行）及其模型。本仓的对比视图只覆盖"行分类"这一步。 |
| `ThreesideTextDiffViewerEx` | `platform/diff-impl/src/com/intellij/diff/tools/simple/ThreesideTextDiffViewerEx.java` | `[ ]` | 左右分栏 diff 查看器（1012 行）及其模型。本仓的对比视图只覆盖"行分类"这一步。 |
| `BaseSyncScrollable` | `platform/diff-impl/src/com/intellij/diff/tools/util/BaseSyncScrollable.java` | `[ ]` | diff 工具窗的公共设施（同步滚动、拆分器、状态栏）。 |
| `CrossFilePrevNextDifferenceIterableSupport` | `platform/diff-impl/src/com/intellij/diff/tools/util/CrossFilePrevNextDifferenceIterableSupport.kt` | `[ ]` | diff 工具窗的公共设施（同步滚动、拆分器、状态栏）。 |
| `DiffChangedRangeProvider` | `platform/diff-impl/src/com/intellij/diff/tools/util/DiffChangedRangeProvider.java` | `[ ]` | diff 工具窗的公共设施（同步滚动、拆分器、状态栏）。 |
| `DiffDataKeys` | `platform/diff-impl/src/com/intellij/diff/tools/util/DiffDataKeys.java` | `[ ]` | diff 工具窗的公共设施（同步滚动、拆分器、状态栏）。 |
| `DiffNotifications` | `platform/diff-impl/src/com/intellij/diff/tools/util/DiffNotifications.kt` | `[ ]` | diff 工具窗的公共设施（同步滚动、拆分器、状态栏）。 |
| `DiffSplitter` | `platform/diff-impl/src/com/intellij/diff/tools/util/DiffSplitter.java` | `[ ]` | diff 工具窗的公共设施（同步滚动、拆分器、状态栏）。 |
| `DiffTitleHandler` | `platform/diff-impl/src/com/intellij/diff/tools/util/DiffTitleHandler.kt` | `[ ]` | diff 工具窗的公共设施（同步滚动、拆分器、状态栏）。 |
| `EmptyUnifiedLineFoldingRenderer` | `platform/diff-impl/src/com/intellij/diff/tools/util/EmptyUnifiedLineFoldingRenderer.java` | `[ ]` | diff 工具窗的公共设施（同步滚动、拆分器、状态栏）。 |
| `FocusTrackerSupport` | `platform/diff-impl/src/com/intellij/diff/tools/util/FocusTrackerSupport.java` | `[ ]` | diff 工具窗的公共设施（同步滚动、拆分器、状态栏）。 |
| `FoldingModelSupport` | `platform/diff-impl/src/com/intellij/diff/tools/util/FoldingModelSupport.java` | `[ ]` | diff 工具窗的公共设施（同步滚动、拆分器、状态栏）。 |
| `KeyboardModifierListener` | `platform/diff-impl/src/com/intellij/diff/tools/util/KeyboardModifierListener.java` | `[ ]` | diff 工具窗的公共设施（同步滚动、拆分器、状态栏）。 |
| `PrevNextDifferenceIterable` | `platform/diff-impl/src/com/intellij/diff/tools/util/PrevNextDifferenceIterable.kt` | `[ ]` | diff 工具窗的公共设施（同步滚动、拆分器、状态栏）。 |
| `PrevNextDifferenceIterableBase` | `platform/diff-impl/src/com/intellij/diff/tools/util/PrevNextDifferenceIterableBase.java` | `[ ]` | diff 工具窗的公共设施（同步滚动、拆分器、状态栏）。 |
| `PrevNextFileIterable` | `platform/diff-impl/src/com/intellij/diff/tools/util/PrevNextFileIterable.kt` | `[ ]` | diff 工具窗的公共设施（同步滚动、拆分器、状态栏）。 |
| `SimpleDiffPanel` | `platform/diff-impl/src/com/intellij/diff/tools/util/SimpleDiffPanel.java` | `[ ]` | diff 工具窗的公共设施（同步滚动、拆分器、状态栏）。 |
| `SoftHardCacheMap` | `platform/diff-impl/src/com/intellij/diff/tools/util/SoftHardCacheMap.java` | `[ ]` | diff 工具窗的公共设施（同步滚动、拆分器、状态栏）。 |
| `StatusPanel` | `platform/diff-impl/src/com/intellij/diff/tools/util/StatusPanel.java` | `[~]` | 状态栏那段「无消息 / 有消息 / 60 秒后加时间后缀」的刷新逻辑，本仓在 `src/statusBarText.ts:37-39,63` 照 `StatusPanel.java:186-213` 复刻了。diff 工具窗那一侧的状态栏没有。 |
| `SyncScrollSupport` | `platform/diff-impl/src/com/intellij/diff/tools/util/SyncScrollSupport.java` | `[ ]` | diff 工具窗的公共设施（同步滚动、拆分器、状态栏）。 |
| `ThreeDiffSplitter` | `platform/diff-impl/src/com/intellij/diff/tools/util/ThreeDiffSplitter.java` | `[ ]` | diff 工具窗的公共设施（同步滚动、拆分器、状态栏）。 |
| `TransferableFileEditorStateSupport` | `platform/diff-impl/src/com/intellij/diff/tools/util/TransferableFileEditorStateSupport.java` | `[ ]` | diff 工具窗的公共设施（同步滚动、拆分器、状态栏）。 |
| `DiffPanelBase` | `platform/diff-impl/src/com/intellij/diff/tools/util/base/DiffPanelBase.java` | `[ ]` | 查看器基类与 diff 设置持有者。 |
| `DiffViewerBase` | `platform/diff-impl/src/com/intellij/diff/tools/util/base/DiffViewerBase.java` | `[ ]` | 查看器基类与 diff 设置持有者。 |
| `DiffViewerListener` | `platform/diff-impl/src/com/intellij/diff/tools/util/base/DiffViewerListener.java` | `[ ]` | 查看器基类与 diff 设置持有者。 |
| `HighlightPolicy` | `platform/diff-impl/src/com/intellij/diff/tools/util/base/HighlightPolicy.java` | `[ ]` | 查看器基类与 diff 设置持有者。 |
| `HighlightingLevel` | `platform/diff-impl/src/com/intellij/diff/tools/util/base/HighlightingLevel.java` | `[ ]` | 查看器基类与 diff 设置持有者。 |
| `IgnorePolicy` | `platform/diff-impl/src/com/intellij/diff/tools/util/base/IgnorePolicy.java` | `[ ]` | 查看器基类与 diff 设置持有者。 |
| `InitialScrollPositionSupport` | `platform/diff-impl/src/com/intellij/diff/tools/util/base/InitialScrollPositionSupport.java` | `[ ]` | 查看器基类与 diff 设置持有者。 |
| `ListenerDiffViewerBase` | `platform/diff-impl/src/com/intellij/diff/tools/util/base/ListenerDiffViewerBase.java` | `[ ]` | 查看器基类与 diff 设置持有者。 |
| `TextDiffSettingsHolder` | `platform/diff-impl/src/com/intellij/diff/tools/util/base/TextDiffSettingsHolder.kt` | `[ ]` | 查看器基类与 diff 设置持有者。 |
| `TextDiffViewerUtil` | `platform/diff-impl/src/com/intellij/diff/tools/util/base/TextDiffViewerUtil.java` | `[ ]` | 查看器基类与 diff 设置持有者。 |
| `BreadcrumbsPlacement` | `platform/diff-impl/src/com/intellij/diff/tools/util/breadcrumbs/BreadcrumbsPlacement.java` | `[-]` | 改动位置面包屑（Swing 组件），默认隐藏。 |
| `DiffBreadcrumbsPanel` | `platform/diff-impl/src/com/intellij/diff/tools/util/breadcrumbs/DiffBreadcrumbsPanel.java` | `[-]` | 改动位置面包屑（Swing 组件），默认隐藏。 |
| `SimpleDiffBreadcrumbsPanel` | `platform/diff-impl/src/com/intellij/diff/tools/util/breadcrumbs/SimpleDiffBreadcrumbsPanel.java` | `[-]` | 改动位置面包屑（Swing 组件），默认隐藏。 |
| `DiffContentLayoutPanel` | `platform/diff-impl/src/com/intellij/diff/tools/util/side/DiffContentLayoutPanel.java` | `[ ]` | 两侧/单侧/三侧的面板布局。 |
| `DiffContentPanel` | `platform/diff-impl/src/com/intellij/diff/tools/util/side/DiffContentPanel.java` | `[ ]` | 两侧/单侧/三侧的面板布局。 |
| `OnesideContentPanel` | `platform/diff-impl/src/com/intellij/diff/tools/util/side/OnesideContentPanel.java` | `[ ]` | 两侧/单侧/三侧的面板布局。 |
| `OnesideDiffViewer` | `platform/diff-impl/src/com/intellij/diff/tools/util/side/OnesideDiffViewer.java` | `[ ]` | 两侧/单侧/三侧的面板布局。 |
| `OnesideTextDiffViewer` | `platform/diff-impl/src/com/intellij/diff/tools/util/side/OnesideTextDiffViewer.java` | `[ ]` | 两侧/单侧/三侧的面板布局。 |
| `ThreesideContentPanel` | `platform/diff-impl/src/com/intellij/diff/tools/util/side/ThreesideContentPanel.java` | `[ ]` | 两侧/单侧/三侧的面板布局。 |
| `ThreesideDiffViewer` | `platform/diff-impl/src/com/intellij/diff/tools/util/side/ThreesideDiffViewer.java` | `[ ]` | 两侧/单侧/三侧的面板布局。 |
| `ThreesideTextDiffViewer` | `platform/diff-impl/src/com/intellij/diff/tools/util/side/ThreesideTextDiffViewer.java` | `[ ]` | 两侧/单侧/三侧的面板布局。 |
| `TwosideContentPanel` | `platform/diff-impl/src/com/intellij/diff/tools/util/side/TwosideContentPanel.java` | `[ ]` | 两侧/单侧/三侧的面板布局。 |
| `TwosideDiffViewer` | `platform/diff-impl/src/com/intellij/diff/tools/util/side/TwosideDiffViewer.java` | `[ ]` | 两侧/单侧/三侧的面板布局。 |
| `TwosideTextDiffViewer` | `platform/diff-impl/src/com/intellij/diff/tools/util/side/TwosideTextDiffViewer.java` | `[ ]` | 两侧/单侧/三侧的面板布局。 |
| `FineMergeLineFragment` | `platform/diff-impl/src/com/intellij/diff/tools/util/text/FineMergeLineFragment.java` | `[ ]` | 文本 diff 提供者（含词级内层差异）。本仓只有词级之外的一层。 |
| `FineMergeLineFragmentImpl` | `platform/diff-impl/src/com/intellij/diff/tools/util/text/FineMergeLineFragmentImpl.java` | `[ ]` | 文本 diff 提供者（含词级内层差异）。本仓只有词级之外的一层。 |
| `LineOffsetsDocumentWrapper` | `platform/diff-impl/src/com/intellij/diff/tools/util/text/LineOffsetsDocumentWrapper.java` | `[ ]` | 文本 diff 提供者（含词级内层差异）。本仓只有词级之外的一层。 |
| `LineOffsetsUtil` | `platform/diff-impl/src/com/intellij/diff/tools/util/text/LineOffsetsUtil.java` | `[ ]` | 文本 diff 提供者（含词级内层差异）。本仓只有词级之外的一层。 |
| `MergeInnerDifferences` | `platform/diff-impl/src/com/intellij/diff/tools/util/text/MergeInnerDifferences.java` | `[ ]` | 文本 diff 提供者（含词级内层差异）。本仓只有词级之外的一层。 |
| `SimpleTextDiffProvider` | `platform/diff-impl/src/com/intellij/diff/tools/util/text/SimpleTextDiffProvider.java` | `[ ]` | 文本 diff 提供者（含词级内层差异）。本仓只有词级之外的一层。 |
| `SimpleThreesideTextDiffProvider` | `platform/diff-impl/src/com/intellij/diff/tools/util/text/SimpleThreesideTextDiffProvider.java` | `[ ]` | 文本 diff 提供者（含词级内层差异）。本仓只有词级之外的一层。 |
| `SmartTextDiffProvider` | `platform/diff-impl/src/com/intellij/diff/tools/util/text/SmartTextDiffProvider.java` | `[ ]` | 文本 diff 提供者（含词级内层差异）。本仓只有词级之外的一层。 |
| `TextDiffProvider` | `platform/diff-impl/src/com/intellij/diff/tools/util/text/TextDiffProvider.java` | `[ ]` | 文本 diff 提供者（含词级内层差异）。本仓只有词级之外的一层。 |
| `TextDiffProviderBase` | `platform/diff-impl/src/com/intellij/diff/tools/util/text/TextDiffProviderBase.java` | `[ ]` | 文本 diff 提供者（含词级内层差异）。本仓只有词级之外的一层。 |
| `TwosideTextDiffProvider` | `platform/diff-impl/src/com/intellij/diff/tools/util/text/TwosideTextDiffProvider.java` | `[ ]` | 文本 diff 提供者（含词级内层差异）。本仓只有词级之外的一层。 |
| `TwosideTextDiffProviderBase` | `platform/diff-impl/src/com/intellij/diff/tools/util/text/TwosideTextDiffProviderBase.java` | `[ ]` | 文本 diff 提供者（含词级内层差异）。本仓只有词级之外的一层。 |
| `BlankDiffWindowUtil` | `platform/diff-impl/src/com/intellij/diff/util/BlankDiffWindowUtil.kt` | `[-]` | diff 工具类：行标记绘制、行号转换、数据键、常量。依赖编辑器绘制上下文，本仓不需要。 |
| `CombinedDiffToggle` | `platform/diff-impl/src/com/intellij/diff/util/CombinedDiffToggle.kt` | `[-]` | diff 工具类：行标记绘制、行号转换、数据键、常量。依赖编辑器绘制上下文，本仓不需要。 |
| `DiffBalloons` | `platform/diff-impl/src/com/intellij/diff/util/DiffBalloons.kt` | `[-]` | diff 工具类：行标记绘制、行号转换、数据键、常量。依赖编辑器绘制上下文，本仓不需要。 |
| `DiffDividerDrawUtil` | `platform/diff-impl/src/com/intellij/diff/util/DiffDividerDrawUtil.java` | `[-]` | diff 工具类：行标记绘制、行号转换、数据键、常量。依赖编辑器绘制上下文，本仓不需要。 |
| `DiffDrawUtil` | `platform/diff-impl/src/com/intellij/diff/util/DiffDrawUtil.java` | `[-]` | diff 工具类：行标记绘制、行号转换、数据键、常量。依赖编辑器绘制上下文，本仓不需要。 |
| `DiffEditorHighlighterUpdater` | `platform/diff-impl/src/com/intellij/diff/util/DiffEditorHighlighterUpdater.java` | `[-]` | diff 工具类：行标记绘制、行号转换、数据键、常量。依赖编辑器绘制上下文，本仓不需要。 |
| `DiffEmptyHighlighterRenderer` | `platform/diff-impl/src/com/intellij/diff/util/DiffEmptyHighlighterRenderer.java` | `[-]` | diff 工具类：行标记绘制、行号转换、数据键、常量。依赖编辑器绘制上下文，本仓不需要。 |
| `DiffGutterOperation` | `platform/diff-impl/src/com/intellij/diff/util/DiffGutterOperation.java` | `[-]` | diff 工具类：行标记绘制、行号转换、数据键、常量。依赖编辑器绘制上下文，本仓不需要。 |
| `DiffGutterRenderer` | `platform/diff-impl/src/com/intellij/diff/util/DiffGutterRenderer.java` | `[-]` | diff 工具类：行标记绘制、行号转换、数据键、常量。依赖编辑器绘制上下文，本仓不需要。 |
| `DiffGutterRendererMergeableRendererProvider` | `platform/diff-impl/src/com/intellij/diff/util/DiffGutterRendererMergeableRendererProvider.java` | `[-]` | diff 工具类：行标记绘制、行号转换、数据键、常量。依赖编辑器绘制上下文，本仓不需要。 |
| `DiffLineMarkerRenderer` | `platform/diff-impl/src/com/intellij/diff/util/DiffLineMarkerRenderer.kt` | `[-]` | diff 工具类：行标记绘制、行号转换、数据键、常量。依赖编辑器绘制上下文，本仓不需要。 |
| `DiffLineNumberConverter` | `platform/diff-impl/src/com/intellij/diff/util/DiffLineNumberConverter.java` | `[-]` | diff 工具类：行标记绘制、行号转换、数据键、常量。依赖编辑器绘制上下文，本仓不需要。 |
| `DiffLineSeparatorRenderer` | `platform/diff-impl/src/com/intellij/diff/util/DiffLineSeparatorRenderer.java` | `[-]` | diff 工具类：行标记绘制、行号转换、数据键、常量。依赖编辑器绘制上下文，本仓不需要。 |
| `DiffPlaces` | `platform/diff-impl/src/com/intellij/diff/util/DiffPlaces.java` | `[-]` | diff 工具类：行标记绘制、行号转换、数据键、常量。依赖编辑器绘制上下文，本仓不需要。 |
| `DiffTaskQueue` | `platform/diff-impl/src/com/intellij/diff/util/DiffTaskQueue.java` | `[-]` | diff 工具类：行标记绘制、行号转换、数据键、常量。依赖编辑器绘制上下文，本仓不需要。 |
| `DiffUserDataKeysEx` | `platform/diff-impl/src/com/intellij/diff/util/DiffUserDataKeysEx.java` | `[-]` | diff 工具类：行标记绘制、行号转换、数据键、常量。依赖编辑器绘制上下文，本仓不需要。 |
| `DiffUtil` | `platform/diff-impl/src/com/intellij/diff/util/DiffUtil.java` | `[-]` | diff 工具类：行标记绘制、行号转换、数据键、常量。依赖编辑器绘制上下文，本仓不需要。 |
| `FileEditorBase` | `platform/diff-impl/src/com/intellij/diff/util/FileEditorBase.kt` | `[-]` | diff 工具类：行标记绘制、行号转换、数据键、常量。依赖编辑器绘制上下文，本仓不需要。 |
| `InvisibleWrapper` | `platform/diff-impl/src/com/intellij/diff/util/InvisibleWrapper.java` | `[-]` | diff 工具类：行标记绘制、行号转换、数据键、常量。依赖编辑器绘制上下文，本仓不需要。 |
| `SyncHeightComponent` | `platform/diff-impl/src/com/intellij/diff/util/SyncHeightComponent.java` | `[-]` | diff 工具类：行标记绘制、行号转换、数据键、常量。依赖编辑器绘制上下文，本仓不需要。 |
| `TextDiffType` | `platform/diff-impl/src/com/intellij/diff/util/TextDiffType.java` | `[-]` | diff 工具类：行标记绘制、行号转换、数据键、常量。依赖编辑器绘制上下文，本仓不需要。 |
| `TextDiffTypeFactory` | `platform/diff-impl/src/com/intellij/diff/util/TextDiffTypeFactory.java` | `[-]` | diff 工具类：行标记绘制、行号转换、数据键、常量。依赖编辑器绘制上下文，本仓不需要。 |
| `FindModel` | `platform/indexing-api/src/com/intellij/find/FindModel.kt` | `[ ]` | 编辑器内查找的核心模型与服务。本仓只有 Find in Files；编辑器里 F3/Shift+F3 只绑了跳下一个/上一个匹配（`src/components/CodeEditor.vue:995-996`）。 |
| `FindModelExtension` | `platform/indexing-api/src/com/intellij/find/FindModelExtension.java` | `[ ]` | 编辑器内查找的核心模型与服务。本仓只有 Find in Files；编辑器里 F3/Shift+F3 只绑了跳下一个/上一个匹配（`src/components/CodeEditor.vue:995-996`）。 |
| `TextSearchService` | `platform/indexing-api/src/com/intellij/find/TextSearchService.java` | `[x]` | 文本搜索的对外入口，本仓对应 `native/search.cpp:383` `run()` 返回 `{matches, truncated, skippedNonUtf8}`（`:422`），界面在 `src/components/SearchPanel.vue`。 |
| `TrigramIndex` | `platform/indexing-impl/src/com/intellij/find/ngrams/TrigramIndex.java` | `[ ]` | 三元组索引加速的文件搜索。本仓是线性扫描（`native/search.cpp:322-338`）。 |
| `TrigramIndexFilter` | `platform/indexing-impl/src/com/intellij/find/ngrams/TrigramIndexFilter.kt` | `[ ]` | 三元组索引加速的文件搜索。本仓是线性扫描（`native/search.cpp:322-338`）。 |
| `TrigramIndexRegistryValueListener` | `platform/indexing-impl/src/com/intellij/find/ngrams/TrigramIndexRegistryValueListener.kt` | `[ ]` | 三元组索引加速的文件搜索。本仓是线性扫描（`native/search.cpp:322-338`）。 |
| `TrigramTextSearchService` | `platform/indexing-impl/src/com/intellij/find/ngrams/TrigramTextSearchService.java` | `[ ]` | 三元组索引加速的文件搜索。本仓是线性扫描（`native/search.cpp:322-338`）。 |
| `SearchInBackgroundOption` | `platform/lang-api/src/com/intellij/find/SearchInBackgroundOption.java` | `[ ]` | 编辑器内查找的核心模型与服务。本仓只有 Find in Files；编辑器里 F3/Shift+F3 只绑了跳下一个/上一个匹配（`src/components/CodeEditor.vue:995-996`）。 |
| `EditorSearchSession` | `platform/lang-impl/src/com/intellij/find/EditorSearchSession.java` | `[~]` | 编辑器内搜索会话。本仓有 F3/Shift+F3 的"下一个/上一个匹配"（`src/components/CodeEditor.vue:995-996`），但没有会话、没有查找栏、没有结果环。 |
| `FindAllAction` | `platform/lang-impl/src/com/intellij/find/FindAllAction.java` | `[~]` | 在文件内查找全部匹配并选中多光标。本仓编辑器里只有 F3/Shift+F3 单步跳转（`src/components/CodeEditor.vue:995-996`）。 |
| `FindReplaceActionButton` | `platform/lang-impl/src/com/intellij/find/FindReplaceActionButton.kt` | `[ ]` | 编辑器内查找的核心模型与服务。本仓只有 Find in Files；编辑器里 F3/Shift+F3 只绑了跳下一个/上一个匹配（`src/components/CodeEditor.vue:995-996`）。 |
| `FindUsagesCollector` | `platform/lang-impl/src/com/intellij/find/FindUsagesCollector.kt` | `[ ]` | 编辑器内查找的核心模型与服务。本仓只有 Find in Files；编辑器里 F3/Shift+F3 只绑了跳下一个/上一个匹配（`src/components/CodeEditor.vue:995-996`）。 |
| `FindUtil` | `platform/lang-impl/src/com/intellij/find/FindUtil.java` | `[~]` | `FindUtil.showInUsageView` 的"把这批地点放进查找窗口"，本仓对应 `src/semanticActions.ts:134`（钉到引用面板）。1105 行里的编辑器内匹配、字面量转正则、大小写折叠那一整套都没有。 |
| `SearchReplaceComponent` | `platform/lang-impl/src/com/intellij/find/SearchReplaceComponent.java` | `[~]` | 查找/替换的 UI 组合。本仓 `src/components/SearchPanel.vue` 是 Find in Files 对话框，缺"编辑器内查找栏"这一形态。 |
| `SearchSession` | `platform/lang-impl/src/com/intellij/find/SearchSession.java` | `[ ]` | 编辑器内查找的核心模型与服务。本仓只有 Find in Files；编辑器里 F3/Shift+F3 只绑了跳下一个/上一个匹配（`src/components/CodeEditor.vue:995-996`）。 |
| `SearchTextArea` | `platform/lang-impl/src/com/intellij/find/SearchTextArea.java` | `[~]` | 查找输入框（Swing，带历史、大小写/正则快捷切换）。本仓 `src/components/SearchPanel.vue:346-347` 有一对普通输入框，功能面窄得多。 |
| `ActivateFindToolWindowAction` | `platform/lang-impl/src/com/intellij/find/actions/ActivateFindToolWindowAction.kt` | `[ ]` | 查找工具窗的入口动作（Show Usages / 最近历史 / 查找选项弹窗）。 |
| `CompositeActiveComponent` | `platform/lang-impl/src/com/intellij/find/actions/CompositeActiveComponent.java` | `[ ]` | 查找工具窗的入口动作（Show Usages / 最近历史 / 查找选项弹窗）。 |
| `FindInPathAction` | `platform/lang-impl/src/com/intellij/find/actions/FindInPathAction.java` | `[~]` | Find in Path 入口。本仓的 Find in Files 对话框就是这个东西（`src/components/SearchPanel.vue`），但没有"打开查找工具窗 + 最近搜索历史"。 |
| `FindSelectionInPathAction` | `platform/lang-impl/src/com/intellij/find/actions/FindSelectionInPathAction.kt` | `[ ]` | 查找工具窗的入口动作（Show Usages / 最近历史 / 查找选项弹窗）。 |
| `FindUsagesAction` | `platform/lang-impl/src/com/intellij/find/actions/FindUsagesAction.java` | `[~]` | 入口从**文件树**发起（`src/App.vue:2466` 的「查找用法…」→ `src/treeActions.ts:99`），上游是编辑器内 Alt+F7 作用于光标下的符号。本仓只能对文件发起，且要先猜一个符号（取大纲里与文件名同名的类，退而取第一个）。 |
| `FindUsagesInFileAction` | `platform/lang-impl/src/com/intellij/find/actions/FindUsagesInFileAction.java` | `[ ]` | 查找工具窗的入口动作（Show Usages / 最近历史 / 查找选项弹窗）。 |
| `PingEDT` | `platform/lang-impl/src/com/intellij/find/actions/PingEDT.java` | `[ ]` | 查找工具窗的入口动作（Show Usages / 最近历史 / 查找选项弹窗）。 |
| `ReplaceInPathAction` | `platform/lang-impl/src/com/intellij/find/actions/ReplaceInPathAction.java` | `[~]` | Replace in Path 入口。同上，对话框本体在 `src/components/SearchPanel.vue`，但没有查找工具窗那种分栏形态。 |
| `SearchOptionsService` | `platform/lang-impl/src/com/intellij/find/actions/SearchOptionsService.kt` | `[ ]` | 查找工具窗的入口动作（Show Usages / 最近历史 / 查找选项弹窗）。 |
| `SearchTarget2UsageTarget` | `platform/lang-impl/src/com/intellij/find/actions/SearchTarget2UsageTarget.kt` | `[ ]` | 查找工具窗的入口动作（Show Usages / 最近历史 / 查找选项弹窗）。 |
| `SearchTargetVariantsDataRule` | `platform/lang-impl/src/com/intellij/find/actions/SearchTargetVariantsDataRule.kt` | `[ ]` | 查找工具窗的入口动作（Show Usages / 最近历史 / 查找选项弹窗）。 |
| `SearchTargetsDataRule` | `platform/lang-impl/src/com/intellij/find/actions/SearchTargetsDataRule.kt` | `[ ]` | 查找工具窗的入口动作（Show Usages / 最近历史 / 查找选项弹窗）。 |
| `ShowSearchHistoryAction` | `platform/lang-impl/src/com/intellij/find/actions/ShowSearchHistoryAction.java` | `[ ]` | 查找工具窗的入口动作（Show Usages / 最近历史 / 查找选项弹窗）。 |
| `ShowTargetUsagesActionHandler` | `platform/lang-impl/src/com/intellij/find/actions/ShowTargetUsagesActionHandler.kt` | `[ ]` | 查找工具窗的入口动作（Show Usages / 最近历史 / 查找选项弹窗）。 |
| `ShowUsagesAction` | `platform/lang-impl/src/com/intellij/find/actions/ShowUsagesAction.java` | `[~]` | 结果视图、跳转与齿轮选项对齐：`src/usageViewGear.ts:36-60` 给了「按字母顺序」与「在新标签页打开」。缺 1873 行里那套分组视图、preview 差异、`ShowUsagesManager` 协调。 |
| `ShowUsagesActionHandler` | `platform/lang-impl/src/com/intellij/find/actions/ShowUsagesActionHandler.java` | `[ ]` | 查找工具窗的入口动作（Show Usages / 最近历史 / 查找选项弹窗）。 |
| `ShowUsagesHeader` | `platform/lang-impl/src/com/intellij/find/actions/ShowUsagesHeader.kt` | `[ ]` | 查找工具窗的入口动作（Show Usages / 最近历史 / 查找选项弹窗）。 |
| `ShowUsagesManager` | `platform/lang-impl/src/com/intellij/find/actions/ShowUsagesManager.kt` | `[ ]` | 查找工具窗的入口动作（Show Usages / 最近历史 / 查找选项弹窗）。 |
| `ShowUsagesParameters` | `platform/lang-impl/src/com/intellij/find/actions/ShowUsagesParameters.java` | `[ ]` | 查找工具窗的入口动作（Show Usages / 最近历史 / 查找选项弹窗）。 |
| `ShowUsagesPopupData` | `platform/lang-impl/src/com/intellij/find/actions/ShowUsagesPopupData.kt` | `[ ]` | 查找工具窗的入口动作（Show Usages / 最近历史 / 查找选项弹窗）。 |
| `ShowUsagesTable` | `platform/lang-impl/src/com/intellij/find/actions/ShowUsagesTable.java` | `[ ]` | 查找工具窗的入口动作（Show Usages / 最近历史 / 查找选项弹窗）。 |
| `ShowUsagesTableCellRenderer` | `platform/lang-impl/src/com/intellij/find/actions/ShowUsagesTableCellRenderer.java` | `[ ]` | 查找工具窗的入口动作（Show Usages / 最近历史 / 查找选项弹窗）。 |
| `UsageListCellRenderer` | `platform/lang-impl/src/com/intellij/find/actions/UsageListCellRenderer.java` | `[ ]` | 查找工具窗的入口动作（Show Usages / 最近历史 / 查找选项弹窗）。 |
| `UsageNavigation` | `platform/lang-impl/src/com/intellij/find/actions/UsageNavigation.kt` | `[ ]` | 查找工具窗的入口动作（Show Usages / 最近历史 / 查找选项弹窗）。 |
| `UsageOptionsDialog` | `platform/lang-impl/src/com/intellij/find/actions/UsageOptionsDialog.kt` | `[ ]` | 查找工具窗的入口动作（Show Usages / 最近历史 / 查找选项弹窗）。 |
| `compositeActiveComponentPanel` | `platform/lang-impl/src/com/intellij/find/actions/compositeActiveComponentPanel.kt` | `[ ]` | 查找工具窗的入口动作（Show Usages / 最近历史 / 查找选项弹窗）。 |
| `findUsages` | `platform/lang-impl/src/com/intellij/find/actions/findUsages.kt` | `[~]` | Kotlin 便捷入口（`findUsages.kt:88`）。本仓的对应入口是 `src/treeActions.ts:99 findUsagesOf` 与 `src/chooseTarget.ts:126` 那条 target 选择链，都不经过这个文件。 |
| `resolver` | `platform/lang-impl/src/com/intellij/find/actions/resolver.kt` | `[ ]` | 查找工具窗的入口动作（Show Usages / 最近历史 / 查找选项弹窗）。 |
| `AddOccurrenceAction` | `platform/lang-impl/src/com/intellij/find/editorHeaderActions/AddOccurrenceAction.java` | `[ ]` | 编辑器查找栏上的 30 个小动作（正则、大小写、全词、注释/字面量过滤…）。本仓没有这根查找栏。 |
| `ContextAwareShortcutProvider` | `platform/lang-impl/src/com/intellij/find/editorHeaderActions/ContextAwareShortcutProvider.java` | `[ ]` | 编辑器查找栏上的 30 个小动作（正则、大小写、全词、注释/字面量过滤…）。本仓没有这根查找栏。 |
| `EditorHeaderSetSearchContextAction` | `platform/lang-impl/src/com/intellij/find/editorHeaderActions/EditorHeaderSetSearchContextAction.java` | `[ ]` | 编辑器查找栏上的 30 个小动作（正则、大小写、全词、注释/字面量过滤…）。本仓没有这根查找栏。 |
| `EditorHeaderToggleAction` | `platform/lang-impl/src/com/intellij/find/editorHeaderActions/EditorHeaderToggleAction.java` | `[ ]` | 编辑器查找栏上的 30 个小动作（正则、大小写、全词、注释/字面量过滤…）。本仓没有这根查找栏。 |
| `Embeddable` | `platform/lang-impl/src/com/intellij/find/editorHeaderActions/Embeddable.java` | `[ ]` | 编辑器查找栏上的 30 个小动作（正则、大小写、全词、注释/字面量过滤…）。本仓没有这根查找栏。 |
| `NextOccurrenceAction` | `platform/lang-impl/src/com/intellij/find/editorHeaderActions/NextOccurrenceAction.java` | `[ ]` | 编辑器查找栏上的 30 个小动作（正则、大小写、全词、注释/字面量过滤…）。本仓没有这根查找栏。 |
| `OccurrenceAction` | `platform/lang-impl/src/com/intellij/find/editorHeaderActions/OccurrenceAction.java` | `[ ]` | 编辑器查找栏上的 30 个小动作（正则、大小写、全词、注释/字面量过滤…）。本仓没有这根查找栏。 |
| `PrevNextOccurrenceAction` | `platform/lang-impl/src/com/intellij/find/editorHeaderActions/PrevNextOccurrenceAction.java` | `[ ]` | 编辑器查找栏上的 30 个小动作（正则、大小写、全词、注释/字面量过滤…）。本仓没有这根查找栏。 |
| `PrevOccurrenceAction` | `platform/lang-impl/src/com/intellij/find/editorHeaderActions/PrevOccurrenceAction.java` | `[ ]` | 编辑器查找栏上的 30 个小动作（正则、大小写、全词、注释/字面量过滤…）。本仓没有这根查找栏。 |
| `RemoveOccurrenceAction` | `platform/lang-impl/src/com/intellij/find/editorHeaderActions/RemoveOccurrenceAction.java` | `[ ]` | 编辑器查找栏上的 30 个小动作（正则、大小写、全词、注释/字面量过滤…）。本仓没有这根查找栏。 |
| `RestorePreviousSettingsAction` | `platform/lang-impl/src/com/intellij/find/editorHeaderActions/RestorePreviousSettingsAction.java` | `[ ]` | 编辑器查找栏上的 30 个小动作（正则、大小写、全词、注释/字面量过滤…）。本仓没有这根查找栏。 |
| `SelectAllAction` | `platform/lang-impl/src/com/intellij/find/editorHeaderActions/SelectAllAction.java` | `[ ]` | 编辑器查找栏上的 30 个小动作（正则、大小写、全词、注释/字面量过滤…）。本仓没有这根查找栏。 |
| `ShowFilterPopupGroup` | `platform/lang-impl/src/com/intellij/find/editorHeaderActions/ShowFilterPopupGroup.java` | `[ ]` | 编辑器查找栏上的 30 个小动作（正则、大小写、全词、注释/字面量过滤…）。本仓没有这根查找栏。 |
| `StatusTextAction` | `platform/lang-impl/src/com/intellij/find/editorHeaderActions/StatusTextAction.java` | `[ ]` | 编辑器查找栏上的 30 个小动作（正则、大小写、全词、注释/字面量过滤…）。本仓没有这根查找栏。 |
| `SwitchToFind` | `platform/lang-impl/src/com/intellij/find/editorHeaderActions/SwitchToFind.java` | `[ ]` | 编辑器查找栏上的 30 个小动作（正则、大小写、全词、注释/字面量过滤…）。本仓没有这根查找栏。 |
| `SwitchToReplace` | `platform/lang-impl/src/com/intellij/find/editorHeaderActions/SwitchToReplace.java` | `[ ]` | 编辑器查找栏上的 30 个小动作（正则、大小写、全词、注释/字面量过滤…）。本仓没有这根查找栏。 |
| `ToggleAnywhereAction` | `platform/lang-impl/src/com/intellij/find/editorHeaderActions/ToggleAnywhereAction.java` | `[ ]` | 编辑器查找栏上的 30 个小动作（正则、大小写、全词、注释/字面量过滤…）。本仓没有这根查找栏。 |
| `ToggleExceptCommentsAction` | `platform/lang-impl/src/com/intellij/find/editorHeaderActions/ToggleExceptCommentsAction.java` | `[ ]` | 编辑器查找栏上的 30 个小动作（正则、大小写、全词、注释/字面量过滤…）。本仓没有这根查找栏。 |
| `ToggleExceptCommentsAndLiteralsAction` | `platform/lang-impl/src/com/intellij/find/editorHeaderActions/ToggleExceptCommentsAndLiteralsAction.java` | `[ ]` | 编辑器查找栏上的 30 个小动作（正则、大小写、全词、注释/字面量过滤…）。本仓没有这根查找栏。 |
| `ToggleExceptLiteralsAction` | `platform/lang-impl/src/com/intellij/find/editorHeaderActions/ToggleExceptLiteralsAction.java` | `[ ]` | 编辑器查找栏上的 30 个小动作（正则、大小写、全词、注释/字面量过滤…）。本仓没有这根查找栏。 |
| `ToggleFindInSelectionAction` | `platform/lang-impl/src/com/intellij/find/editorHeaderActions/ToggleFindInSelectionAction.java` | `[ ]` | 编辑器查找栏上的 30 个小动作（正则、大小写、全词、注释/字面量过滤…）。本仓没有这根查找栏。 |
| `ToggleInCommentsAction` | `platform/lang-impl/src/com/intellij/find/editorHeaderActions/ToggleInCommentsAction.java` | `[ ]` | 编辑器查找栏上的 30 个小动作（正则、大小写、全词、注释/字面量过滤…）。本仓没有这根查找栏。 |
| `ToggleInLiteralsOnlyAction` | `platform/lang-impl/src/com/intellij/find/editorHeaderActions/ToggleInLiteralsOnlyAction.java` | `[ ]` | 编辑器查找栏上的 30 个小动作（正则、大小写、全词、注释/字面量过滤…）。本仓没有这根查找栏。 |
| `ToggleMatchCase` | `platform/lang-impl/src/com/intellij/find/editorHeaderActions/ToggleMatchCase.java` | `[ ]` | 编辑器查找栏上的 30 个小动作（正则、大小写、全词、注释/字面量过滤…）。本仓没有这根查找栏。 |
| `TogglePreserveCaseAction` | `platform/lang-impl/src/com/intellij/find/editorHeaderActions/TogglePreserveCaseAction.java` | `[ ]` | 编辑器查找栏上的 30 个小动作（正则、大小写、全词、注释/字面量过滤…）。本仓没有这根查找栏。 |
| `ToggleRegex` | `platform/lang-impl/src/com/intellij/find/editorHeaderActions/ToggleRegex.java` | `[ ]` | 编辑器查找栏上的 30 个小动作（正则、大小写、全词、注释/字面量过滤…）。本仓没有这根查找栏。 |
| `ToggleScrollToResultsDuringTypingAction` | `platform/lang-impl/src/com/intellij/find/editorHeaderActions/ToggleScrollToResultsDuringTypingAction.kt` | `[ ]` | 编辑器查找栏上的 30 个小动作（正则、大小写、全词、注释/字面量过滤…）。本仓没有这根查找栏。 |
| `ToggleWholeWordsOnlyAction` | `platform/lang-impl/src/com/intellij/find/editorHeaderActions/ToggleWholeWordsOnlyAction.java` | `[ ]` | 编辑器查找栏上的 30 个小动作（正则、大小写、全词、注释/字面量过滤…）。本仓没有这根查找栏。 |
| `Utils` | `platform/lang-impl/src/com/intellij/find/editorHeaderActions/Utils.java` | `[ ]` | 编辑器查找栏上的 30 个小动作（正则、大小写、全词、注释/字面量过滤…）。本仓没有这根查找栏。 |
| `VariantsCompletionAction` | `platform/lang-impl/src/com/intellij/find/editorHeaderActions/VariantsCompletionAction.java` | `[ ]` | 编辑器查找栏上的 30 个小动作（正则、大小写、全词、注释/字面量过滤…）。本仓没有这根查找栏。 |
| `FindInProjectManager` | `platform/lang-impl/src/com/intellij/find/findInProject/FindInProjectManager.java` | `[~]` | Find in Project 的调度（含最近搜索 `FindInProjectRecents`）。本仓 `src/components/SearchPanel.vue` 每次打开都是空的，没有最近搜索历史。 |
| `FindInProjectScopeService` | `platform/lang-impl/src/com/intellij/find/findInProject/FindInProjectScopeService.kt` | `[x]` | 命名作用域：本仓有完整的作用域语言（union/intersection/complement + 模块通配），在 `src/scopes.ts:245 compileScope` / `:374 scopeMatches`，界面在 `src/components/SearchPanel.vue:50-53`。 |
| `AbstractFindUsagesDialog` | `platform/lang-impl/src/com/intellij/find/findUsages/AbstractFindUsagesDialog.java` | `[ ]` | 查找用法引擎与对话框（PSI 引用图）。本仓走 LSP，没有引用索引。 |
| `CommonFindUsagesDialog` | `platform/lang-impl/src/com/intellij/find/findUsages/CommonFindUsagesDialog.java` | `[ ]` | 查找用法引擎与对话框（PSI 引用图）。本仓走 LSP，没有引用索引。 |
| `CustomUsageSearcher` | `platform/lang-impl/src/com/intellij/find/findUsages/CustomUsageSearcher.java` | `[ ]` | 查找用法引擎与对话框（PSI 引用图）。本仓走 LSP，没有引用索引。 |
| `DefaultFindUsagesHandlerFactory` | `platform/lang-impl/src/com/intellij/find/findUsages/DefaultFindUsagesHandlerFactory.java` | `[ ]` | 查找用法引擎与对话框（PSI 引用图）。本仓走 LSP，没有引用索引。 |
| `DefaultUsageTargetProvider` | `platform/lang-impl/src/com/intellij/find/findUsages/DefaultUsageTargetProvider.java` | `[ ]` | 查找用法引擎与对话框（PSI 引用图）。本仓走 LSP，没有引用索引。 |
| `FindUsagesHandler` | `platform/lang-impl/src/com/intellij/find/findUsages/FindUsagesHandler.java` | `[ ]` | 查找用法引擎与对话框（PSI 引用图）。本仓走 LSP，没有引用索引。 |
| `FindUsagesHandlerFactory` | `platform/lang-impl/src/com/intellij/find/findUsages/FindUsagesHandlerFactory.java` | `[ ]` | 查找用法引擎与对话框（PSI 引用图）。本仓走 LSP，没有引用索引。 |
| `FindUsagesHandlerUi` | `platform/lang-impl/src/com/intellij/find/findUsages/FindUsagesHandlerUi.java` | `[ ]` | 查找用法引擎与对话框（PSI 引用图）。本仓走 LSP，没有引用索引。 |
| `FindUsagesManager` | `platform/lang-impl/src/com/intellij/find/findUsages/FindUsagesManager.java` | `[~]` | 结果视图与标签文案对齐上游：`createPresentation`（`FindUsagesManager.java:552-565`）里的长名 + 范围拼装，本仓是 `src/toolContents.ts:149-157`（`FindBundle.properties:31-32`）。数据源不同：上游走 PSI 引用图，本仓走 LSP `textDocument/references`（`src/treeActions.ts:99-113`），没有 usage type 分类与分组。 |
| `FindUsagesStatisticsCollector` | `platform/lang-impl/src/com/intellij/find/findUsages/FindUsagesStatisticsCollector.kt` | `[ ]` | 查找用法引擎与对话框（PSI 引用图）。本仓走 LSP，没有引用索引。 |
| `FindUsagesUtil` | `platform/lang-impl/src/com/intellij/find/findUsages/FindUsagesUtil.java` | `[ ]` | 查找用法引擎与对话框（PSI 引用图）。本仓走 LSP，没有引用索引。 |
| `FusAwareFindUsagesOptions` | `platform/lang-impl/src/com/intellij/find/findUsages/FusAwareFindUsagesOptions.java` | `[ ]` | 查找用法引擎与对话框（PSI 引用图）。本仓走 LSP，没有引用索引。 |
| `LastSearchData` | `platform/lang-impl/src/com/intellij/find/findUsages/LastSearchData.java` | `[ ]` | 查找用法引擎与对话框（PSI 引用图）。本仓走 LSP，没有引用索引。 |
| `UsageHistory` | `platform/lang-impl/src/com/intellij/find/findUsages/UsageHistory.java` | `[ ]` | 查找用法引擎与对话框（PSI 引用图）。本仓走 LSP，没有引用索引。 |
| `CommentsAndLiteralsSearcher` | `platform/lang-impl/src/com/intellij/find/impl/CommentsAndLiteralsSearcher.java` | `[ ]` | 查找工具窗实现（FindPopupPanel 2399 行及其周边）。本仓没有这根查找栏。 |
| `DefaultDirectorySearchEngine` | `platform/lang-impl/src/com/intellij/find/impl/DefaultDirectorySearchEngine.kt` | `[x]` | 默认的目录搜索实现，本仓只有一种，就是 `native/search.cpp:322-338`。 |
| `EelDirectorySearchEngine` | `platform/lang-impl/src/com/intellij/find/impl/EelDirectorySearchEngine.kt` | `[ ]` | 查找工具窗实现（FindPopupPanel 2399 行及其周边）。本仓没有这根查找栏。 |
| `EelSearchEdges` | `platform/lang-impl/src/com/intellij/find/impl/EelSearchEdges.kt` | `[ ]` | 查找工具窗实现（FindPopupPanel 2399 行及其周边）。本仓没有这根查找栏。 |
| `FileAndLineTextRenderer` | `platform/lang-impl/src/com/intellij/find/impl/FileAndLineTextRenderer.java` | `[ ]` | 查找工具窗实现（FindPopupPanel 2399 行及其周边）。本仓没有这根查找栏。 |
| `FindAndReplaceExecutor` | `platform/lang-impl/src/com/intellij/find/impl/FindAndReplaceExecutor.kt` | `[x]` | 同一条链上的执行体：匹配用 `std::regex`（`native/search.cpp:248` `build_query_pattern`），上限 `max_matches = 5000` / `max_file_bytes = 8MB` / `max_scanned_files = 100000`（`:34-36`），写入走 `.taocode-replace-` 临时文件再原子替换（`:269-271`）。 |
| `FindAndReplaceService` | `platform/lang-impl/src/com/intellij/find/impl/FindAndReplaceService.kt` | `[x]` | Find in Files 的服务门面：原生侧 `native/search.cpp:383` `run()` / `:438 replace()` / `:488 preview()` / `:533 replace_selected()`，经 `src/bridge.ts` 的 `search.*` 四个方法暴露。 |
| `FindExceptCommentsOrLiteralsData` | `platform/lang-impl/src/com/intellij/find/impl/FindExceptCommentsOrLiteralsData.java` | `[ ]` | 查找工具窗实现（FindPopupPanel 2399 行及其周边）。本仓没有这根查找栏。 |
| `FindInDirectoryScopeProvider` | `platform/lang-impl/src/com/intellij/find/impl/FindInDirectoryScopeProvider.kt` | `[ ]` | 查找工具窗实现（FindPopupPanel 2399 行及其周边）。本仓没有这根查找栏。 |
| `FindInFilesLanguage` | `platform/lang-impl/src/com/intellij/find/impl/FindInFilesLanguage.kt` | `[ ]` | 查找工具窗实现（FindPopupPanel 2399 行及其周边）。本仓没有这根查找栏。 |
| `FindInProjectExtension` | `platform/lang-impl/src/com/intellij/find/impl/FindInProjectExtension.kt` | `[ ]` | 查找工具窗实现（FindPopupPanel 2399 行及其周边）。本仓没有这根查找栏。 |
| `FindInProjectRecents` | `platform/lang-impl/src/com/intellij/find/impl/FindInProjectRecents.java` | `[ ]` | 查找工具窗实现（FindPopupPanel 2399 行及其周边）。本仓没有这根查找栏。 |
| `FindInProjectTask` | `platform/lang-impl/src/com/intellij/find/impl/FindInProjectTask.java` | `[~]` | 后台查找任务（读操作分批 `USAGES_PER_READ_ACTION = 100`、进度、取消）。本仓扫描在原生侧（`native/search.cpp:383`），可取消（`search.cancel`），但没有分批读与进度模型。 |
| `FindInProjectUtil` | `platform/lang-impl/src/com/intellij/find/impl/FindInProjectUtil.java` | `[~]` | 作用域/标题/展示设置的组装（`FindInProjectUtil.java:110 setScope` / `:372 getTitleForScope` / `:395 setupViewPresentation`）。本仓有作用域求值（`src/scopes.ts`），没有标题与展示设置这套。 |
| `FindKey` | `platform/lang-impl/src/com/intellij/find/impl/FindKey.kt` | `[ ]` | 查找工具窗实现（FindPopupPanel 2399 行及其周边）。本仓没有这根查找栏。 |
| `FindManagerBase` | `platform/lang-impl/src/com/intellij/find/impl/FindManagerBase.java` | `[ ]` | 查找工具窗实现（FindPopupPanel 2399 行及其周边）。本仓没有这根查找栏。 |
| `FindManagerImpl` | `platform/lang-impl/src/com/intellij/find/impl/FindManagerImpl.java` | `[ ]` | 查找工具窗实现（FindPopupPanel 2399 行及其周边）。本仓没有这根查找栏。 |
| `FindPopupDirectoryChooser` | `platform/lang-impl/src/com/intellij/find/impl/FindPopupDirectoryChooser.java` | `[ ]` | 查找工具窗实现（FindPopupPanel 2399 行及其周边）。本仓没有这根查找栏。 |
| `FindPopupHeader` | `platform/lang-impl/src/com/intellij/find/impl/FindPopupHeader.kt` | `[ ]` | 查找工具窗实现（FindPopupPanel 2399 行及其周边）。本仓没有这根查找栏。 |
| `FindPopupPanel` | `platform/lang-impl/src/com/intellij/find/impl/FindPopupPanel.java` | `[ ]` | 查找工具窗实现（FindPopupPanel 2399 行及其周边）。本仓没有这根查找栏。 |
| `FindPopupResultsAutoloadHandler` | `platform/lang-impl/src/com/intellij/find/impl/FindPopupResultsAutoloadHandler.kt` | `[ ]` | 查找工具窗实现（FindPopupPanel 2399 行及其周边）。本仓没有这根查找栏。 |
| `FindPopupScopeUI` | `platform/lang-impl/src/com/intellij/find/impl/FindPopupScopeUI.kt` | `[ ]` | 查找工具窗实现（FindPopupPanel 2399 行及其周边）。本仓没有这根查找栏。 |
| `FindPopupScopeUIImpl` | `platform/lang-impl/src/com/intellij/find/impl/FindPopupScopeUIImpl.java` | `[~]` | 作用域选择器。`src/components/SearchPanel.vue:8` 写明是照 `FindPopupScopeUIImpl.java:59,137` 来的，求值落在 `src/scopes.ts:245` / `:374`。但没有多作用域的 include/exclude 交互（`src/scopes.ts:450-461` 那两个函数还没接界面），也没有工程设置之外的持久化。 |
| `FindPopupScopeUIProvider` | `platform/lang-impl/src/com/intellij/find/impl/FindPopupScopeUIProvider.java` | `[ ]` | 查找工具窗实现（FindPopupPanel 2399 行及其周边）。本仓没有这根查找栏。 |
| `FindPopupScopeUIProviderImpl` | `platform/lang-impl/src/com/intellij/find/impl/FindPopupScopeUIProviderImpl.java` | `[ ]` | 查找工具窗实现（FindPopupPanel 2399 行及其周边）。本仓没有这根查找栏。 |
| `FindPopupSearchState` | `platform/lang-impl/src/com/intellij/find/impl/FindPopupSearchState.kt` | `[ ]` | 查找工具窗实现（FindPopupPanel 2399 行及其周边）。本仓没有这根查找栏。 |
| `FindResultImpl` | `platform/lang-impl/src/com/intellij/find/impl/FindResultImpl.java` | `[~]` | 同上的实现类。本仓直接返回 JSON 对象（`native/search.cpp:408-422` 的 `matches` + `truncated` + `skippedNonUtf8`）。 |
| `FindResultUsageInfo` | `platform/lang-impl/src/com/intellij/find/impl/FindResultUsageInfo.java` | `[ ]` | 查找工具窗实现（FindPopupPanel 2399 行及其周边）。本仓没有这根查找栏。 |
| `FindUI` | `platform/lang-impl/src/com/intellij/find/impl/FindUI.java` | `[ ]` | 查找工具窗实现（FindPopupPanel 2399 行及其周边）。本仓没有这根查找栏。 |
| `FindUIHelper` | `platform/lang-impl/src/com/intellij/find/impl/FindUIHelper.java` | `[ ]` | 查找工具窗实现（FindPopupPanel 2399 行及其周边）。本仓没有这根查找栏。 |
| `HelpID` | `platform/lang-impl/src/com/intellij/find/impl/HelpID.java` | `[ ]` | 查找工具窗实现（FindPopupPanel 2399 行及其周边）。本仓没有这根查找栏。 |
| `IdeLanguageCustomizationApi` | `platform/lang-impl/src/com/intellij/find/impl/IdeLanguageCustomizationApi.kt` | `[ ]` | 查找工具窗实现（FindPopupPanel 2399 行及其周边）。本仓没有这根查找栏。 |
| `IdeLanguageCustomizationApiImpl` | `platform/lang-impl/src/com/intellij/find/impl/IdeLanguageCustomizationApiImpl.kt` | `[ ]` | 查找工具窗实现（FindPopupPanel 2399 行及其周边）。本仓没有这根查找栏。 |
| `JComboboxAction` | `platform/lang-impl/src/com/intellij/find/impl/JComboboxAction.kt` | `[ ]` | 查找工具窗实现（FindPopupPanel 2399 行及其周边）。本仓没有这根查找栏。 |
| `LangFindSettingsImpl` | `platform/lang-impl/src/com/intellij/find/impl/LangFindSettingsImpl.kt` | `[ ]` | 查找工具窗实现（FindPopupPanel 2399 行及其周边）。本仓没有这根查找栏。 |
| `PreserveCaseUtil` | `platform/lang-impl/src/com/intellij/find/impl/PreserveCaseUtil.java` | `[ ]` | 查找工具窗实现（FindPopupPanel 2399 行及其周边）。本仓没有这根查找栏。 |
| `RegExHelpPopup` | `platform/lang-impl/src/com/intellij/find/impl/RegExHelpPopup.java` | `[ ]` | 查找工具窗实现（FindPopupPanel 2399 行及其周边）。本仓没有这根查找栏。 |
| `RegExReplacementBuilder` | `platform/lang-impl/src/com/intellij/find/impl/RegExReplacementBuilder.java` | `[ ]` | 查找工具窗实现（FindPopupPanel 2399 行及其周边）。本仓没有这根查找栏。 |
| `RevealingSpaceComboboxEditor` | `platform/lang-impl/src/com/intellij/find/impl/RevealingSpaceComboboxEditor.java` | `[ ]` | 查找工具窗实现（FindPopupPanel 2399 行及其周边）。本仓没有这根查找栏。 |
| `ShowRecentFindUsagesAction` | `platform/lang-impl/src/com/intellij/find/impl/ShowRecentFindUsagesAction.java` | `[ ]` | 查找工具窗实现（FindPopupPanel 2399 行及其周边）。本仓没有这根查找栏。 |
| `ShowRecentFindUsagesGroup` | `platform/lang-impl/src/com/intellij/find/impl/ShowRecentFindUsagesGroup.java` | `[ ]` | 查找工具窗实现（FindPopupPanel 2399 行及其周边）。本仓没有这根查找栏。 |
| `TextSearchContributor` | `platform/lang-impl/src/com/intellij/find/impl/TextSearchContributor.kt` | `[ ]` | 查找工具窗实现（FindPopupPanel 2399 行及其周边）。本仓没有这根查找栏。 |
| `TextSearchListAgnosticRenderer` | `platform/lang-impl/src/com/intellij/find/impl/TextSearchListAgnosticRenderer.java` | `[ ]` | 查找工具窗实现（FindPopupPanel 2399 行及其周边）。本仓没有这根查找栏。 |
| `TextSearchRenderer` | `platform/lang-impl/src/com/intellij/find/impl/TextSearchRenderer.java` | `[ ]` | 查找工具窗实现（FindPopupPanel 2399 行及其周边）。本仓没有这根查找栏。 |
| `TextSearchRightActionAction` | `platform/lang-impl/src/com/intellij/find/impl/TextSearchRightActionAction.kt` | `[ ]` | 查找工具窗实现（FindPopupPanel 2399 行及其周边）。本仓没有这根查找栏。 |
| `UsagePresentationProvider` | `platform/lang-impl/src/com/intellij/find/impl/UsagePresentationProvider.kt` | `[ ]` | 查找工具窗实现（FindPopupPanel 2399 行及其周边）。本仓没有这根查找栏。 |
| `WelcomeScreenFindInProjectExtension` | `platform/lang-impl/src/com/intellij/find/impl/WelcomeScreenFindInProjectExtension.kt` | `[ ]` | 查找工具窗实现（FindPopupPanel 2399 行及其周边）。本仓没有这根查找栏。 |
| `WelcomeScreenFindScope` | `platform/lang-impl/src/com/intellij/find/impl/WelcomeScreenFindScope.kt` | `[ ]` | 查找工具窗实现（FindPopupPanel 2399 行及其周边）。本仓没有这根查找栏。 |
| `EditorLivePreviewPresentation` | `platform/lang-impl/src/com/intellij/find/impl/livePreview/EditorLivePreviewPresentation.kt` | `[ ]` | 边输边搜的实时预览、分块加载与选区管理。 |
| `EditorSearchAreaProvider` | `platform/lang-impl/src/com/intellij/find/impl/livePreview/EditorSearchAreaProvider.java` | `[ ]` | 边输边搜的实时预览、分块加载与选区管理。 |
| `LivePreview` | `platform/lang-impl/src/com/intellij/find/impl/livePreview/LivePreview.java` | `[ ]` | 边输边搜的实时预览、分块加载与选区管理。 |
| `LivePreviewController` | `platform/lang-impl/src/com/intellij/find/impl/livePreview/LivePreviewController.java` | `[ ]` | 边输边搜的实时预览、分块加载与选区管理。 |
| `LivePreviewPresentation` | `platform/lang-impl/src/com/intellij/find/impl/livePreview/LivePreviewPresentation.kt` | `[ ]` | 边输边搜的实时预览、分块加载与选区管理。 |
| `SearchResults` | `platform/lang-impl/src/com/intellij/find/impl/livePreview/SearchResults.java` | `[ ]` | 边输边搜的实时预览、分块加载与选区管理。 |
| `SelectionManager` | `platform/lang-impl/src/com/intellij/find/impl/livePreview/SelectionManager.java` | `[ ]` | 边输边搜的实时预览、分块加载与选区管理。 |
| `uiModel` | `platform/lang-impl/src/com/intellij/find/impl/uiModel.kt` | `[ ]` | 查找工具窗实现（FindPopupPanel 2399 行及其周边）。本仓没有这根查找栏。 |
| `usageAdapters` | `platform/lang-impl/src/com/intellij/find/impl/usageAdapters.kt` | `[ ]` | 查找工具窗实现（FindPopupPanel 2399 行及其周边）。本仓没有这根查找栏。 |
| `ReplaceInProjectManager` | `platform/lang-impl/src/com/intellij/find/replaceInProject/ReplaceInProjectManager.java` | `[x]` | Replace in Files 的编排：`src/components/SearchPanel.vue:174-193` 逐条勾选/跳过 → `native/search.cpp:533` `replace_selected` 精确替换；全量替换走 `:438 replace()`。改写会移动字节偏移，所以替换后强制重跑预览（`SearchPanel.vue:188`）。 |
| `DynamicUsage` | `platform/lang-impl/src/com/intellij/find/usages/api/DynamicUsage.kt` | `[ ]` | 用法搜索的公共 API（Usage/SearchTarget/UsageSearcher）。 |
| `EmptyUsageHandler` | `platform/lang-impl/src/com/intellij/find/usages/api/EmptyUsageHandler.java` | `[ ]` | 用法搜索的公共 API（Usage/SearchTarget/UsageSearcher）。 |
| `PsiUsage` | `platform/lang-impl/src/com/intellij/find/usages/api/PsiUsage.kt` | `[ ]` | 用法搜索的公共 API（Usage/SearchTarget/UsageSearcher）。 |
| `ReadWriteUsage` | `platform/lang-impl/src/com/intellij/find/usages/api/ReadWriteUsage.kt` | `[ ]` | 用法搜索的公共 API（Usage/SearchTarget/UsageSearcher）。 |
| `SearchTarget` | `platform/lang-impl/src/com/intellij/find/usages/api/SearchTarget.kt` | `[ ]` | 用法搜索的公共 API（Usage/SearchTarget/UsageSearcher）。 |
| `Usage` | `platform/lang-impl/src/com/intellij/find/usages/api/Usage.kt` | `[ ]` | 用法搜索的公共 API（Usage/SearchTarget/UsageSearcher）。 |
| `UsageAccess` | `platform/lang-impl/src/com/intellij/find/usages/api/UsageAccess.kt` | `[ ]` | 用法搜索的公共 API（Usage/SearchTarget/UsageSearcher）。 |
| `UsageHandler` | `platform/lang-impl/src/com/intellij/find/usages/api/UsageHandler.java` | `[ ]` | 用法搜索的公共 API（Usage/SearchTarget/UsageSearcher）。 |
| `UsageOptions` | `platform/lang-impl/src/com/intellij/find/usages/api/UsageOptions.java` | `[ ]` | 用法搜索的公共 API（Usage/SearchTarget/UsageSearcher）。 |
| `UsageSearchParameters` | `platform/lang-impl/src/com/intellij/find/usages/api/UsageSearchParameters.kt` | `[ ]` | 用法搜索的公共 API（Usage/SearchTarget/UsageSearcher）。 |
| `UsageSearcher` | `platform/lang-impl/src/com/intellij/find/usages/api/UsageSearcher.kt` | `[ ]` | 用法搜索的公共 API（Usage/SearchTarget/UsageSearcher）。 |
| `package-info` | `platform/lang-impl/src/com/intellij/find/usages/api/package-info.java` | `[ ]` | 用法搜索的公共 API（Usage/SearchTarget/UsageSearcher）。 |
| `AllSearchOptions` | `platform/lang-impl/src/com/intellij/find/usages/impl/AllSearchOptions.kt` | `[ ]` | 用法搜索的内部适配器。 |
| `PlainTextUsage` | `platform/lang-impl/src/com/intellij/find/usages/impl/PlainTextUsage.kt` | `[ ]` | 用法搜索的内部适配器。 |
| `Psi2ReadWriteAccessUsageInfo2UsageAdapter` | `platform/lang-impl/src/com/intellij/find/usages/impl/Psi2ReadWriteAccessUsageInfo2UsageAdapter.kt` | `[ ]` | 用法搜索的内部适配器。 |
| `Psi2UsageInfo2UsageAdapter` | `platform/lang-impl/src/com/intellij/find/usages/impl/Psi2UsageInfo2UsageAdapter.kt` | `[ ]` | 用法搜索的内部适配器。 |
| `PsiUsage2UsageInfo` | `platform/lang-impl/src/com/intellij/find/usages/impl/PsiUsage2UsageInfo.kt` | `[ ]` | 用法搜索的内部适配器。 |
| `TextUsage` | `platform/lang-impl/src/com/intellij/find/usages/impl/TextUsage.kt` | `[ ]` | 用法搜索的内部适配器。 |
| `impl` | `platform/lang-impl/src/com/intellij/find/usages/impl/impl.kt` | `[ ]` | 用法搜索的内部适配器。 |
| `package-info` | `platform/lang-impl/src/com/intellij/find/usages/impl/package-info.java` | `[ ]` | 用法搜索的内部适配器。 |
| `SearchTargetSymbol` | `platform/lang-impl/src/com/intellij/find/usages/symbol/SearchTargetSymbol.kt` | `[ ]` | 符号搜索目标工厂。 |
| `SymbolSearchTargetFactory` | `platform/lang-impl/src/com/intellij/find/usages/symbol/SymbolSearchTargetFactory.java` | `[ ]` | 符号搜索目标工厂。 |
| `AbstractFindInEditorTest` | `platform/lang-impl/testSources/com/intellij/find/AbstractFindInEditorTest.java` | `[-]` | 上游测试源码集（`testSources`/`testData`），不是产品面的一部分。 |
| `FindInEditorFunctionalTest` | `platform/lang-impl/testSources/com/intellij/find/FindInEditorFunctionalTest.java` | `[-]` | 上游测试源码集（`testSources`/`testData`），不是产品面的一部分。 |
| `FindInEditorMultiCaretTest` | `platform/lang-impl/testSources/com/intellij/find/FindInEditorMultiCaretTest.java` | `[-]` | 上游测试源码集（`testSources`/`testData`），不是产品面的一部分。 |
| `FindInEditorPerformanceTest` | `platform/lang-impl/testSources/com/intellij/find/FindInEditorPerformanceTest.java` | `[-]` | 上游测试源码集（`testSources`/`testData`），不是产品面的一部分。 |
| `FindInEditorTest` | `platform/lang-impl/testSources/com/intellij/find/FindInEditorTest.java` | `[-]` | 上游测试源码集（`testSources`/`testData`），不是产品面的一部分。 |
| `SearchInNonIndexableTest` | `platform/lang-impl/testSources/com/intellij/find/SearchInNonIndexableTest.kt` | `[-]` | 上游测试源码集（`testSources`/`testData`），不是产品面的一部分。 |
| `SearchTargetTest` | `platform/lang-impl/testSources/com/intellij/find/SearchTargetTest.kt` | `[-]` | 上游测试源码集（`testSources`/`testData`），不是产品面的一部分。 |
| `TestSearchTarget` | `platform/lang-impl/testSources/com/intellij/find/TestSearchTarget.kt` | `[-]` | 上游测试源码集（`testSources`/`testData`），不是产品面的一部分。 |
| `DirectorySearchEngineTest` | `platform/lang-impl/testSources/com/intellij/find/impl/DirectorySearchEngineTest.kt` | `[-]` | 上游测试源码集（`testSources`/`testData`），不是产品面的一部分。 |
| `EelDirectorySearchEngineTest` | `platform/lang-impl/testSources/com/intellij/find/impl/EelDirectorySearchEngineTest.kt` | `[-]` | 上游测试源码集（`testSources`/`testData`），不是产品面的一部分。 |
| `EelSearchTestFakes` | `platform/lang-impl/testSources/com/intellij/find/impl/EelSearchTestFakes.kt` | `[-]` | 上游测试源码集（`testSources`/`testData`），不是产品面的一部分。 |
| `FindPopupSearchStateTest` | `platform/lang-impl/testSources/com/intellij/find/impl/FindPopupSearchStateTest.kt` | `[-]` | 上游测试源码集（`testSources`/`testData`），不是产品面的一部分。 |
| `SearchResultsChunkingTest` | `platform/lang-impl/testSources/com/intellij/find/impl/livePreview/SearchResultsChunkingTest.java` | `[-]` | 上游测试源码集（`testSources`/`testData`），不是产品面的一部分。 |
| `DirectorySearchEngine` | `platform/refactoring/src/com/intellij/find/DirectorySearchEngine.kt` | `[x]` | 目录遍历 + include/exclude glob 过滤，本仓 `native/search.cpp:322-338` 逐条同款（含自己的替换临时文件要跳过、扫描数超限就如实报"不完整"）。 |
| `FindInProjectSearchEngine` | `platform/refactoring/src/com/intellij/find/FindInProjectSearchEngine.java` | `[x]` | Find in Project 的引擎，本仓 `src/components/SearchPanel.vue` 调的就是 `native/search.cpp:383` `run()`。 |
| `FindInProjectSettings` | `platform/refactoring/src/com/intellij/find/FindInProjectSettings.java` | `[ ]` | 编辑器内查找的核心模型与服务。本仓只有 Find in Files；编辑器里 F3/Shift+F3 只绑了跳下一个/上一个匹配（`src/components/CodeEditor.vue:995-996`）。 |
| `FindManager` | `platform/refactoring/src/com/intellij/find/FindManager.java` | `[~]` | 查找服务接口。本仓的查找能力分成两处：编辑器内只有 F3/Shift+F3，工程内是 `native/search.cpp`，没有统一的 FindManager 门面。 |
| `FindModelListener` | `platform/refactoring/src/com/intellij/find/FindModelListener.java` | `[ ]` | 编辑器内查找的核心模型与服务。本仓只有 Find in Files；编辑器里 F3/Shift+F3 只绑了跳下一个/上一个匹配（`src/components/CodeEditor.vue:995-996`）。 |
| `FindResult` | `platform/refactoring/src/com/intellij/find/FindResult.java` | `[~]` | 查找结果（是否还有更多 + 可导航的 occurrence 列表）。本仓的 `run()` 返回 hits 数组 + `truncated` 标志（`native/search.cpp:413`、`:422`），语义接近。 |
| `PsiElement2UsageTargetAdapter` | `platform/refactoring/src/com/intellij/find/findUsages/PsiElement2UsageTargetAdapter.java` | `[ ]` | 查找用法引擎与对话框（PSI 引用图）。本仓走 LSP，没有引用索引。 |
| `FindManagerTestUtils` | `platform/testFramework/src/com/intellij/find/FindManagerTestUtils.java` | `[ ]` | 编辑器内查找的核心模型与服务。本仓只有 Find in Files；编辑器里 F3/Shift+F3 只绑了跳下一个/上一个匹配（`src/components/CodeEditor.vue:995-996`）。 |
| `ExportClusteringResultActionLink` | `platform/usageView-impl/src/com/intellij/find/findUsages/similarity/ExportClusteringResultActionLink.java` | `[-]` | 相似用法聚类，仅 Java 语义，本仓无 PSI 也就无从提特征。 |
| `ImportClusteringResultActionLink` | `platform/usageView-impl/src/com/intellij/find/findUsages/similarity/ImportClusteringResultActionLink.java` | `[-]` | 相似用法聚类，仅 Java 语义，本仓无 PSI 也就无从提特征。 |
| `MostCommonUsagePatternsComponent` | `platform/usageView-impl/src/com/intellij/find/findUsages/similarity/MostCommonUsagePatternsComponent.kt` | `[-]` | 相似用法聚类，仅 Java 语义，本仓无 PSI 也就无从提特征。 |
| `MostCommonUsagesToolbar` | `platform/usageView-impl/src/com/intellij/find/findUsages/similarity/MostCommonUsagesToolbar.java` | `[-]` | 相似用法聚类，仅 Java 语义，本仓无 PSI 也就无从提特征。 |
| `SimilarUsagesComponent` | `platform/usageView-impl/src/com/intellij/find/findUsages/similarity/SimilarUsagesComponent.java` | `[-]` | 相似用法聚类，仅 Java 语义，本仓无 PSI 也就无从提特征。 |
| `SimilarUsagesToolbar` | `platform/usageView-impl/src/com/intellij/find/findUsages/similarity/SimilarUsagesToolbar.java` | `[-]` | 相似用法聚类，仅 Java 语义，本仓无 PSI 也就无从提特征。 |
| `SnippetRenderingData` | `platform/usageView-impl/src/com/intellij/find/findUsages/similarity/SnippetRenderingData.kt` | `[-]` | 相似用法聚类，仅 Java 语义，本仓无 PSI 也就无从提特征。 |
| `UsageCodeSnippetComponent` | `platform/usageView-impl/src/com/intellij/find/findUsages/similarity/UsageCodeSnippetComponent.java` | `[-]` | 相似用法聚类，仅 Java 语义，本仓无 PSI 也就无从提特征。 |
| `UsagePreviewComponent` | `platform/usageView-impl/src/com/intellij/find/findUsages/similarity/UsagePreviewComponent.kt` | `[-]` | 相似用法聚类，仅 Java 语义，本仓无 PSI 也就无从提特征。 |
| `SilhouetteScore` | `platform/usageView/src/com/intellij/find/findUsages/similarity/SilhouetteScore.java` | `[-]` | 相似用法聚类，仅 Java 语义，本仓无 PSI 也就无从提特征。 |
| `ByCharRt` | `platform/util/diff/src/com/intellij/diff/comparison/ByCharRt.kt` | `[ ]` | 比较算法族。本仓只做了行级（`src/diffAlign.ts`），词级/字符级都没有。 |
| `ByLineRt` | `platform/util/diff/src/com/intellij/diff/comparison/ByLineRt.kt` | `[~]` | 行级比较的入口（`ByLineRt.kt:22-30` → `getLines` 按 `ComparisonPolicy` 归一后跑 Myers）。本仓走的是同一套算法（`src/diffAlign.ts`），但**没有** policy 参数、没有取消检查、没有三向重载，也没有 `FairDiffIterable` 的 fair 契约。 |
| `ByWordRt` | `platform/util/diff/src/com/intellij/diff/comparison/ByWordRt.kt` | `[ ]` | 比较算法族。本仓只做了行级（`src/diffAlign.ts`），词级/字符级都没有。 |
| `CancellationChecker` | `platform/util/diff/src/com/intellij/diff/comparison/CancellationChecker.kt` | `[ ]` | 比较算法族。本仓只做了行级（`src/diffAlign.ts`），词级/字符级都没有。 |
| `ChangeCorrector` | `platform/util/diff/src/com/intellij/diff/comparison/ChangeCorrector.kt` | `[ ]` | 比较算法族。本仓只做了行级（`src/diffAlign.ts`），词级/字符级都没有。 |
| `CharacterUtils` | `platform/util/diff/src/com/intellij/diff/comparison/CharacterUtils.kt` | `[ ]` | 比较算法族。本仓只做了行级（`src/diffAlign.ts`），词级/字符级都没有。 |
| `ChunkOptimizer` | `platform/util/diff/src/com/intellij/diff/comparison/ChunkOptimizer.kt` | `[ ]` | 比较算法族。本仓只做了行级（`src/diffAlign.ts`），词级/字符级都没有。 |
| `ComparisonMergeUtil` | `platform/util/diff/src/com/intellij/diff/comparison/ComparisonMergeUtil.kt` | `[ ]` | 比较算法族。本仓只做了行级（`src/diffAlign.ts`），词级/字符级都没有。 |
| `ComparisonPolicy` | `platform/util/diff/src/com/intellij/diff/comparison/ComparisonPolicy.kt` | `[~]` | 三档比较策略（`ComparisonPolicy.kt:4-8`：DEFAULT / TRIM_WHITESPACES / IGNORE_WHITESPACES）。本仓**只做了 DEFAULT**，这一档恰好是上游默认（`TextDiffSettingsHolder.kt:47` → `IgnorePolicy.java:29-35`），本仓 `src/diffAlign.ts:51` 的逐行相等与之一致；另两档判 §C。 |
| `ComparisonUtil` | `platform/util/diff/src/com/intellij/diff/comparison/ComparisonUtil.kt` | `[~]` | 三个算法的统一入口 + 参数校验（两列长度必须相同）。本仓是 `src/diffAlign.ts:214` `alignLines` 自己校验。 |
| `DiffTooBigException` | `platform/util/diff/src/com/intellij/diff/comparison/DiffTooBigException.kt` | `[x]` | 差异量超阈值时上游抛的信号（`MyersLCS.kt:186-188`），本仓 `src/diffAlign.ts:74` 的 `FilesTooBigForDiff` 同义，被 `alignLines` 捕获后退化成"整段一块改动"。 |
| `LineFragmentSplitter` | `platform/util/diff/src/com/intellij/diff/comparison/LineFragmentSplitter.kt` | `[ ]` | 比较算法族。本仓只做了行级（`src/diffAlign.ts`），词级/字符级都没有。 |
| `MergeResolveUtil` | `platform/util/diff/src/com/intellij/diff/comparison/MergeResolveUtil.kt` | `[ ]` | 比较算法族。本仓只做了行级（`src/diffAlign.ts`），词级/字符级都没有。 |
| `TrimUtil` | `platform/util/diff/src/com/intellij/diff/comparison/TrimUtil.kt` | `[ ]` | 比较算法族。本仓只做了行级（`src/diffAlign.ts`），词级/字符级都没有。 |
| `ChangeDiffIterableBase` | `platform/util/diff/src/com/intellij/diff/comparison/iterables/ChangeDiffIterableBase.kt` | `[ ]` | 上游的差异惰性迭代器 + 校验工具（fair 校验、range 合并）。本仓输出的是一次性对齐数组。 |
| `DiffChangeDiffIterable` | `platform/util/diff/src/com/intellij/diff/comparison/iterables/DiffChangeDiffIterable.kt` | `[ ]` | 上游的差异惰性迭代器 + 校验工具（fair 校验、range 合并）。本仓输出的是一次性对齐数组。 |
| `DiffFragmentsDiffIterable` | `platform/util/diff/src/com/intellij/diff/comparison/iterables/DiffFragmentsDiffIterable.kt` | `[ ]` | 上游的差异惰性迭代器 + 校验工具（fair 校验、range 合并）。本仓输出的是一次性对齐数组。 |
| `DiffIterable` | `platform/util/diff/src/com/intellij/diff/comparison/iterables/DiffIterable.kt` | `[~]` | 差异结果形态：两列长度 + `changes()` / `unchanged()` 迭代器（`DiffIterable.kt:22-44`）。本仓的 `src/diffAlign.ts:29` `AlignedPair[]` 是它的**对偶**：只给公共行，改动行由前后差集反推（`src/diffText.ts:16-47`）。 |
| `DiffIterableUtil` | `platform/util/diff/src/com/intellij/diff/comparison/iterables/DiffIterableUtil.kt` | `[ ]` | 上游的差异惰性迭代器 + 校验工具（fair 校验、range 合并）。本仓输出的是一次性对齐数组。 |
| `ExpandedDiffIterable` | `platform/util/diff/src/com/intellij/diff/comparison/iterables/ExpandedDiffIterable.kt` | `[ ]` | 上游的差异惰性迭代器 + 校验工具（fair 校验、range 合并）。本仓输出的是一次性对齐数组。 |
| `FairDiffIterable` | `platform/util/diff/src/com/intellij/diff/comparison/iterables/FairDiffIterable.kt` | `[~]` | 标记接口，约定"unchanged 区逐位对齐"（`FairDiffIterable.kt:5-13`）。本仓 `src/diffText.ts:16-47` 吐出的 `equal` 行天然满足这条，但**没有**这套可校验的契约与 `DiffIterableUtil.verifyFair`。 |
| `FairDiffIterableWrapper` | `platform/util/diff/src/com/intellij/diff/comparison/iterables/FairDiffIterableWrapper.kt` | `[ ]` | 上游的差异惰性迭代器 + 校验工具（fair 校验、range 合并）。本仓输出的是一次性对齐数组。 |
| `InvertedDiffIterableWrapper` | `platform/util/diff/src/com/intellij/diff/comparison/iterables/InvertedDiffIterableWrapper.kt` | `[ ]` | 上游的差异惰性迭代器 + 校验工具（fair 校验、range 合并）。本仓输出的是一次性对齐数组。 |
| `RangesDiffIterable` | `platform/util/diff/src/com/intellij/diff/comparison/iterables/RangesDiffIterable.kt` | `[ ]` | 上游的差异惰性迭代器 + 校验工具（fair 校验、range 合并）。本仓输出的是一次性对齐数组。 |
| `SubiterableDiffIterable` | `platform/util/diff/src/com/intellij/diff/comparison/iterables/SubiterableDiffIterable.kt` | `[ ]` | 上游的差异惰性迭代器 + 校验工具（fair 校验、range 合并）。本仓输出的是一次性对齐数组。 |
| `DiffFragment` | `platform/util/diff/src/com/intellij/diff/fragments/DiffFragment.kt` | `[~]` | 差异片段（两段区间 + 类型）。本仓的改动块是 `buildDiffRows` 现场推导出来的 `src/diffText.ts:19-47` 里的 `DiffRow`，不是独立对象。 |
| `DiffFragmentImpl` | `platform/util/diff/src/com/intellij/diff/fragments/DiffFragmentImpl.kt` | `[ ]` | 片段模型（区间 + 类型 + 行首标记）。本仓的对齐结果是 `{from,to}` 对，没有片段对象。 |
| `LineFragment` | `platform/util/diff/src/com/intellij/diff/fragments/LineFragment.kt` | `[~]` | 行片段（start1/end1/start2/end2 + type）。本仓 `src/diffAlign.ts:29` 的 `{from,to}` 对表达连续相等段，是它的简化形态。 |
| `LineFragmentImpl` | `platform/util/diff/src/com/intellij/diff/fragments/LineFragmentImpl.kt` | `[~]` | 行片段实现。本仓无对象封装，`src/diffAlign.ts:29` 直接吐裸对象。 |
| `MergeLineFragment` | `platform/util/diff/src/com/intellij/diff/fragments/MergeLineFragment.kt` | `[ ]` | 片段模型（区间 + 类型 + 行首标记）。本仓的对齐结果是 `{from,to}` 对，没有片段对象。 |
| `MergeLineFragmentImpl` | `platform/util/diff/src/com/intellij/diff/fragments/MergeLineFragmentImpl.kt` | `[ ]` | 片段模型（区间 + 类型 + 行首标记）。本仓的对齐结果是 `{from,to}` 对，没有片段对象。 |
| `MergeWordFragment` | `platform/util/diff/src/com/intellij/diff/fragments/MergeWordFragment.kt` | `[ ]` | 片段模型（区间 + 类型 + 行首标记）。本仓的对齐结果是 `{from,to}` 对，没有片段对象。 |
| `MergeWordFragmentImpl` | `platform/util/diff/src/com/intellij/diff/fragments/MergeWordFragmentImpl.kt` | `[ ]` | 片段模型（区间 + 类型 + 行首标记）。本仓的对齐结果是 `{from,to}` 对，没有片段对象。 |
| `LineOffsets` | `platform/util/diff/src/com/intellij/diff/tools/util/text/LineOffsets.kt` | `[ ]` | 文本 diff 提供者（含词级内层差异）。本仓只有词级之外的一层。 |
| `LineOffsetsImpl` | `platform/util/diff/src/com/intellij/diff/tools/util/text/LineOffsetsImpl.kt` | `[ ]` | 文本 diff 提供者（含词级内层差异）。本仓只有词级之外的一层。 |
| `DiffRangeUtil` | `platform/util/diff/src/com/intellij/diff/util/DiffRangeUtil.kt` | `[-]` | diff 工具类：行标记绘制、行号转换、数据键、常量。依赖编辑器绘制上下文，本仓不需要。 |
| `Enumerator` | `platform/util/diff/src/com/intellij/diff/util/Enumerator.kt` | `[x]` | 上游把行映成整数 id 再比较的那张共享表（`Enumerator.kt:16-25`），本仓 `src/diffAlign.ts:51` 的 `enumerate()` 一比一对应：两张数组共用一个 Map，id 从 1 开始。 |
| `MergeConflictResolutionStrategy` | `platform/util/diff/src/com/intellij/diff/util/MergeConflictResolutionStrategy.kt` | `[-]` | diff 工具类：行标记绘制、行号转换、数据键、常量。依赖编辑器绘制上下文，本仓不需要。 |
| `MergeConflictType` | `platform/util/diff/src/com/intellij/diff/util/MergeConflictType.kt` | `[-]` | diff 工具类：行标记绘制、行号转换、数据键、常量。依赖编辑器绘制上下文，本仓不需要。 |
| `MergeRange` | `platform/util/diff/src/com/intellij/diff/util/MergeRange.kt` | `[-]` | diff 工具类：行标记绘制、行号转换、数据键、常量。依赖编辑器绘制上下文，本仓不需要。 |
| `MergeRangeUtil` | `platform/util/diff/src/com/intellij/diff/util/MergeRangeUtil.kt` | `[-]` | diff 工具类：行标记绘制、行号转换、数据键、常量。依赖编辑器绘制上下文，本仓不需要。 |
| `Range` | `platform/util/diff/src/com/intellij/diff/util/Range.kt` | `[~]` | 两侧区间（`Range.kt`）。本仓 `src/diffAlign.ts:29` 的公共段用 `from` + 隐含长度表达。 |
| `Side` | `platform/util/diff/src/com/intellij/diff/util/Side.kt` | `[~]` | 两侧标识。本仓左右固定：`src/bridge.ts:102` 的 `DiffRow` 用 `left` / `right` 两个字面量字段表达，没有 side 参数。 |
| `ThreeSide` | `platform/util/diff/src/com/intellij/diff/util/ThreeSide.kt` | `[~]` | 三方标识。本仓没有三方比较，`src/diffText.ts:16` 的 `buildDiffRows` 只吃两列。 |
| `Block` | `platform/vcs-impl/src/com/intellij/diff/Block.java` | `[ ]` | diff 框架层（请求/窗口/工具注册）。本仓的 diff 只有剪贴板对比与保存冲突预览两处纯函数（`src/diffText.ts:16-52`），不存在 DiffRequest/DiffWindow 这一层。 |
| `DiffVcsDataKeys` | `platform/vcs-impl/src/com/intellij/diff/DiffVcsDataKeys.kt` | `[ ]` | diff 框架层（请求/窗口/工具注册）。本仓的 diff 只有剪贴板对比与保存冲突预览两处纯函数（`src/diffText.ts:16-52`），不存在 DiffRequest/DiffWindow 这一层。 |
| `PatchBaseAnnotationInfo` | `platform/vcs-impl/src/com/intellij/diff/PatchBaseAnnotationInfo.kt` | `[ ]` | diff 框架层（请求/窗口/工具注册）。本仓的 diff 只有剪贴板对比与保存冲突预览两处纯函数（`src/diffText.ts:16-52`），不存在 DiffRequest/DiffWindow 这一层。 |

合计 630 类：`[x]` 11、`[~]` 40、`[ ]` 498、`[-]` 81。
