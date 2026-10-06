# 批 · 桶 9 第二路（代号 `search2`）· 2026-10-06

派单三件事：① `docs/wiring-requests-2026-10-06-searchdiff.md` 的 **W-1**（`findCodeBlockRange` 合并点）
用本面方式重做；② `se/ui`、`ss/ui`、`ss/matcher`、`ss/replace`、`lp/text-search`、`lp/run-anything`
六族判词**先核后做**；③ 不动 `tests/everywhere-text.test.mjs`。
交付：本文件 + `docs/wiring-requests-2026-10-06-search2.md`。

结论一句话：**W-1 那半不再"等接线才存在" —— 模块已落在本面（`src/structuralCodeBlock.ts`），
并且被结构化搜索当场消费掉**；顺带把 `ss/matcher` 判词里那条「列表变量」的真缺陷修掉了
（实测：宿主的 `std::regex` 编不出后顾断言 ⇒ 面板上明写着支持的 `$x$+` / `$x${0,}` 模板
**一条结果都拿不到**，整条查询在宿主报 `INVALID_QUERY`）。

---

## 1. 判词表（六族，逐条：判定 / 上游相对路径:行号 / 本仓落点 / 一句话）

判定符号：`[x]` 已做 · `[~]` 部分（写「本仓已有」+「还差」）· `[ ]` 未做 · `[-]` 不适用（具体理由）

### 1.1 `ss/matcher`（结构化搜索的匹配器）—— 本族是本路的主战场

| 判词里的缺项 | 判定 | 上游相对路径:行号 | 本仓落点 | 一句话 |
| --- | --- | --- | --- | --- |
| 列表变量（判词原话：「`$Args$` 这类要按括号配平的变量，上游由 `MatchingStrategy`/`TopLevelMatchingHandler` 处理」） | `[x]` 本批做掉 | `platform/structuralsearch/source/com/intellij/structuralsearch/impl/matcher/compiler/StringToConstraintsTransformer.java:101`、`:110`（`+`/`*` ⇒ `maxOccurs = Integer.MAX_VALUE`）；`impl/matcher/handlers/SubstitutionHandler.java:318` + `:45-56`（`VARS_DELIM_FILTER`：一个变量吃同一父节点下的连续兄弟节点，逗号只是被滤掉的分隔符）；`impl/matcher/handlers/TopLevelMatchingHandler.java:23-38`（那是"匹配完要不要往子节点递归"那一档，**不是**括号配平）；`impl/matcher/strategies/MatchingStrategy.java:24,26`（只有 `continueMatching`/`shouldSkip` 两条谓词，也不是配平） | 判据 `src/structuralCodeBlock.ts:60-241`；编译产物 `src/structuralSearchConstraints.ts:348-374`、`:392-412`；复核接线 `src/structuralSearchModifiers.ts:364`（`needsSpanCheck`）、`:377-419`（`hasListVariable`/`listRunVerdict`）、`:430`（挂在 `verdictForHit` 上） | **两条一起修**：① 贪婪列表的两条后顾断言从正则里搬进命中后复核（宿主编不出后顾 ⇒ 原来整条查询死在宿主）；② 列表的一项允许是"标识符 + 一层括号组"（`g(b, c)`、`a[0]`、`{k: v}` 在上游是一个表达式节点） |
| 匹配结果模型（`MatchResult`/`MatchResultSink`/`DuplicateFilteringResultSink`；判词：「本仓结果不携带每个变量的命中值」） | `[x]` 早做过（判词过期） | `platform/structuralsearch/source/com/intellij/structuralsearch/MatchResult.java:11-32`（`:15 getMatchImage`、`:17 getMatchRef`、`:19-20 getStart/getEnd`、`:29 isMultipleMatch`、`:32 isTarget` —— 本路逐行开过文件）；`plugin/util/DuplicateFilteringResultSink.java:27-32`（键是 `result.getMatchRef()`）、`:45-48`（`matchingFinished` 清空） | `src/structuralSearchResults.ts:28-126`（`StructuralMatch`/`variableValues`/`createDuplicateFilter`/`dedupeMatches`），消费方 `src/structuralSearchPanelModel.ts:30`、`:230`、`:280` | 去重器在场；**订正一处上游形状**：判词/旧注释容易读成"按文本区间去重"，实际键是 PSI 指针，本仓用「路径:行:列」，第一条赢 ⇒ 语义等价、键不同 |
| 预定义模板（`PredefinedConfigurationUtil`） | `[x]` 早做过（判词过期） | 判词点名，本路**未**复核该文件行号 | `src/structuralSearchConfigs.ts`（内置/我的/最近三段 + `saveConfiguration` 同名覆盖 + 最近上限 30），消费方 `src/components/SearchPanel.vue:32-37` | 与 ss/ui 同一批（上一轮已落），本路只核到场 |
| 变量约束的 regExp/script/within/contains/reference/invertible/min-maxCount | `[~]` | `MatchVariableConstraint.java:29-56`；`StringToConstraintsTransformer.java:94-166`、`:331-410`、`:463-474` | `src/structuralSearchConstraints.ts`（min/max/greedy/regex/regexw/`!` 全词，含**本次新加**的"项 = 标识符 + 一层括号"）+ `src/structuralSearchModifiers.ts`（`contains`/`within` 的跨度复核、列表整段复核） | 还差：`ref`/`exprtype`/`formal`/`script`（要 PSI/类型/脚本宿主，本仓按 §3 不画控件，`src/structuralSearchConstraints.ts:116-121` 逐条明说卡在哪） |
| 「字符串/注释内的排除与 `MatchOptions.searchInComments`」 | `[-]` 上游没有这两位 | `platform/structuralsearch/source/com/intellij/structuralsearch/MatchOptions.java`（320 行；**本路自己 grep 过整个文件，`searchInComments`/`searchInLiterals` 零命中**） | 依据与留痕在 `src/structuralSearch.ts:16-21` | 上一批按 §1「留痕」订正过的那条，本路在同一份文件上复核成立（只核了 `MatchOptions.java` 本身，未再全树 grep `structuralsearch/`） |
| 模板的 PSI 合法性（`PatternContext`/`MalformedPatternException`） | `[-]` 没有语法树 | 判词点名 | 本仓的替代门：`src/structuralSearch.ts:203-208`（编译产物过一遍正则引擎）+ `structuralSearchModifiers.ts:414-431`（子模板编译期体检） | 文本层不校验语法树，只校验"能不能编译 + 坏子模板挡住不发请求" |

### 1.2 `ss/replace`（结构化替换）

| 判词里的缺项 | 判定 | 上游 | 本仓落点 | 一句话 |
| --- | --- | --- | --- | --- |
| `ReplacementVariableDefinition` 的逐变量替换定义 | `[x]` 早做过（判词过期） | 判词点名 `ReplacementBuilder` 的 script 分支 | `src/structuralSearchReplace.ts`（`defineReplacementVariable`/`compileStructuralReplacementWithDefinitions`/`previewMany`），消费方 `src/structuralSearchPanelModel.ts:31-34`、`:161-175`、`:262-267` 与 `src/components/StructuralSearchFilters.vue:32` | 定义表由模型持有、折进发出去的替换串，`unchanged`/`unverifiable` 分开计数 |
| 逐处勾选/跳过（`ReplaceUsageViewContext`） | `[x]` 早做过 | 判词点名 | `src/components/SearchPanel.vue` 的 `selected`/`skipped` 与 `search.preview` 的 `before`/`after`（`native/search.cpp` 的 `apply_replacement`） | 上一批交付的形状，本路复核在场 |
| `ReplaceOptions` 的 Reformat / Use static imports / Shorten FQN | `[-]` 不做假开关 | 判词点名 `ReplacementBuilder` | `src/structuralSearch.ts:13-21` 与 `src/structuralSearchModifiers.ts` 头注的「没有落点就不画控件」 | 要 PSI + 导入表；本仓不渲染没有生效点的格子 |
| 独立 `ReplacementPreviewDialog` | `[-]` 形状不同 | 判词点名 | 本仓 = 结果树上的内联预览 | 不是缺，是本仓架构不等价（结果面板内联 vs 独立审阅窗） |

### 1.3 `ss/ui`（结构化搜索 UI）

| 判词里的缺项 | 判定 | 本仓落点 | 一句话 |
| --- | --- | --- | --- |
| `ConfigurationManager` 收藏/最近、`ExistingTemplatesComponent` 三段下拉、`$Var$` 变量补全 | `[x]` 早做过（判词自己写「补」） | `src/structuralSearchConfigs.ts`（134 行）+ `src/components/SearchPanel.vue:32-37,142` | 判据 `tests/structural-search-configs.test.mjs`（本路未改） |
| 修饰符面板（`FilterPanel`/`FilterTable`/`CountFilter`/`ReferenceFilter`/`ScriptFilter`） | `[~]` | `src/structuralSearchModifiers.ts`（699 行）+ `src/components/StructuralSearchFilters.vue` | 还差：引用/类型/脚本三档没有落点（理由同上），`ScriptFilter` 的编辑面不存在 |
| 模板编辑器与文档（`StructuralSearchTemplateBuilder`/`…DocumentationProvider`/`SubstitutionShortInfoHandler`） | `[~]` 只有 `SubstitutionShortInfo` 的文本等价物 | `src/structuralSearchResults.ts:3-12`（头注引用该上游文件）与 `variableValueLines` | 还差：模板文档与 inlay 画回编辑器（要编辑器侧挂点，不在本面） |
| `ConfigurationCellRenderer`/`UIState`/`StructuralSearchUsageTarget` | `[-]` 对话框外观与用法视图 | —— | 本仓没有用法视图那一族（桶 4 owner），且不做假状态 |

### 1.4 `se/ui`（Search Everywhere 的 UI）

| 判词里的"缺" | 判定 | 本仓落点（本路核到） | 一句话 |
| --- | --- | --- | --- |
| Files/Symbols 独立档、Text 档 | `[x]` 判词过期 | `src/searchEverywhere.ts:54-56`（tab 集合含 `project`、`symbols`、`text`）、`:126-143` | `symbols` 与 `text` 都是**独立档**，Text 档在 `src/searchEverywhereText.ts`（187 行） |
| 每档自己的 `SeFilterEditor`（类型可见性/作用域持久化/预览开关） | `[x]` 判词过期 | `src/searchEverywhereFilters.ts`（212 行，`typeVisibilityStates`/`setTypeVisibility`/`hiddenTypesOf`/`initialTargetsFilter`）+ `src/components/SearchEverywhereDialog.vue:51,269,307,376`（按 tab 一个键、换档关掉另一档的漏斗、`getHeaderActions()` 的顺序） | 「本仓只有一个全局作用域选择器」这句已经不成立 |
| `SeResultsCountBalancer` 配额 + Top Hit 置顶分组 | `[x]` 判词过期 | `src/searchEverywhereBalancer.ts`（消费方 `src/searchEverywhere.ts:51`）、`src/searchEverywhereTopHit.ts`（消费方 `src/components/SearchEverywhereDialog.vue:53`） | 两半都有生产消费方（不是孤儿） |
| IDE 档与 Autocompletion 档 | `[ ]` 未做 | 无（`SEARCH_EVERYwhere_TABS` 里没有这两个 id） | 卡在哪：要把设置项搜索（`src/settingsSearch.ts`，**不在本面**）做成一个 SE 供给者，改的是 `src/searchEverywhereHost.ts` + tab 表 + `App.vue` 的开关面板入口，一次做不完；本路没做，**没画空档** |
| `SeTabsCustomizer`/`SeAsyncTabsProvider` | `[-]` 没有第三方供给者可定制 | —— | 上游那两条 EP 服务的是插件注册；本仓没有插件写 SE 档，接了就是给不存在的使用方做界面 |
| `SeUsageEventsLogger` | `[-]` 不收集遥测 | —— | 本仓整仓没有上报通道 |

### 1.5 `lp/text-search`

| 项 | 判定 | 上游/依据 | 本仓落点 | 一句话 |
| --- | --- | --- | --- | --- |
| 判词给的坐标 `parse_patterns` 在 `search.cpp:370-382`、默认排除表在 `:46-49` | `[x]` 功能在，**行号是错的** | 本仓文件实测 | `native/search.cpp:660-674`（`parse_patterns`）、`:46-50`（`default_excluded_dirs`）、`:218-221`/`:324`/`:361`（三处消费点） | 订正请求写在接线文档「附」第 1 条；本路没改 `native/`（只读取证），也没改账本（不在可改面） |
| 结构化模板跨行匹配（判词说本仓"只能按行给命中"） | `[~]` 判词偏悲观 | —— | `native/search.cpp:134-162`（`for_each_match` 作用在**整个文件内容**上）+ `:688-703`（命中回报到行/列）+ `src/structuralSearch.ts:89-112`（模板里的空白/换行折成 `\s*`/`\s+`） | 扫描是整文件的 ⇒ 跨行模板能命中；**还差**的是"每行只回一条预览文本"，跨行命中的变量值在面板上读不出来（`src/structuralSearchResults.ts:51-64` 是在命中那一行上重跑正则）—— 本路实测确认这条是真的缺，卡在只能读宿主给的 `preview` 一行，修它要改宿主回参形状（`native/search.cpp` + `src/bridge.ts`），跨两域，未做 |
| `.gitignore`/FileTypeIndex 一类排除源 | `[ ]` 未做，且**没有依据** | 判词点名，本路未在 `model/search/impl/textSearch.kt` 里核实到"按 .gitignore 排除"这条链 | `src/searchExclusions.ts`（工程排除目录已贯通） | 不核清不做：IDEA 的 gitignored 文件默认仍进索引，"Find in Files 搜不到 ignored 文件"这句话我在这份树里指不到行号 ⇒ 按 §1 只能写「无法核实」，不能编一个过滤层 |

### 1.6 `lp/run-anything`

| 项 | 判定 | 依据 | 本仓落点 | 一句话 |
| --- | --- | --- | --- | --- |
| 分组与每组上限、多行命令折叠、历史按原始类别重跑 | `[x]` 早做过（判词自己写「补」） | 判词点名 `RunAnythingGroupBase.getMaxInitialItems`、`RunAnythingCommandFolding` | `src/runAnything.ts:43-44`（`RUN_ANYTHING_GROUP_LIMITS`）、`:47-51`（`commandDisplayName`）、`:113-131`（`capGroup`/`more` 行）、`:140-190`（分组装配 + `sourceKind`）；`src/components/RunAnythingDialog.vue:9-11,34-40` | 三条都在，判据 `tests/run-anything.test.mjs` |
| `RunAnythingProvider` 插件点（Gradle/Maven 候选） | `[-]` 没有 provider 宿主 | 判词点名 | —— | 本仓运行面只有运行配置与原始命令行两类，没有第三方 provider 可分组 |
| `RunAnythingChooseContextAction` 的工作目录选择器 | `[~]` 模型做完、**宿主在禁改面** | 判词点名 `RunAnythingContext` 三类 | `src/runAnythingContext.ts`（205 行 / 18 个出口）+ `tests/run-anything-context.test.mjs`（119 行）；缺口只在 `src/App.vue:2611` 那一行 `runExternalTool(payload.command, payload.command)`（第三参 `cwd` 在 `src/runActions.ts:447` 是现成的） | **订正**：判词写的挂点是 `App.vue:2697`，实测现在是 `:2611`；本路**没有**先画选择器（宿主不读 `cwd` 就是假控件，规约 §3），整段可照抄的两处改动写在接线文档 W-2' |

---

## 2. 改动文件清单（`wc -l` 前 → 后）

| 文件 | 前 | 后 | 说明 |
| --- | --- | --- | --- |
| `src/structuralCodeBlock.ts` | —— | **491（新）** | A 半 = 结构化搜索的三条文本判据（`depthProfile`/`listRunStartsHere`/`listRunEndsHere`/`listRunHolds`）；B 半 = 代码块导航的 Python 复合语句 + `findCodeBlockRange`/`mergeBlockEnd`/`mergeBlockStart`（等桶 5 接，见 W-1'） |
| `src/structuralSearchConstraints.ts` | 393 | 432 | 删掉两条后顾断言（`RUN_START`）；新增 `runEnd(following)`（模板感知的前顾）与 `LIST_ITEM_TAIL`（一项可以是"标识符 + 一层括号"）；`constraintCaptureGroup` 多一个 `following` 形参 |
| `src/structuralSearch.ts` | 241 | 243 | 调用点把"变量后面还写着什么"传进捕获组编译 |
| `src/structuralSearchModifiers.ts` | 649 | 699 | 新增 `hasListVariable` / `listRunVerdict`；`needsSpanCheck` 认列表变量；`verdictForHit` 在 `contains` 之前先判"整段"（并写了为什么是这个顺序） |
| `src/structuralSearchPanelModel.ts` | 288 | 290 | 头注里"为什么需要复核层"补上实测的那一条（后顾断言）；状态行文案加「列表整段」一档 |
| `src/components/SearchPanel.vue` | 897 | 897 | 一行：模板语法说明里给列表变量补上"一项可以是一层括号的调用；嵌得更深的那一段不报，也不报半截"（不加行数） |
| `tests/structural-code-block.test.mjs` | —— | **204（新）** | 15 条：A 半 7 条（深度剖面、同层逗号、字符串/注释里的逗号、`$` 边界、配平、宿主的**后顾断言门禁**、一层括号项、复核否决、非贪婪不复核）+ B 半 8 条（旧 W-1 那 8 条判据，逐字保留） |
| `tests/structural-search-constraints.test.mjs` | 190 | 212 | 只把 `run()` 助手换成"正则 + 复核"两道合一的 matcher（**断言体一字未动**）；新增 22 行是助手的说明与形状 |
| `tests/structural-search-filters.test.mjs` | 134 | 135 | 一条断言改向（见 §4 的"收紧"说明）+ 留痕注释 |
| `tests/structural-search-panel-model.test.mjs` | 155 | 155 | 状态行文案的锚点跟着改（计数与语义不变） |
| `docs/wiring-requests-2026-10-06-search2.md` | —— | 新增 | W-1'（桶 5 两行接线 + 判据）、W-2'（App.vue 一行 + 对话框 emit 形状）、两条不需要接线只要订正账本的核对结果 |
| `build/lookaround_probe.cpp`、`build/probe*.mjs`、`build/probe.bat` | —— | 已删 | 取证用的临时探针（见 §3 最后一行），收工清干净 |

**没动**：`src/App.vue`、`src/CodeEditor.vue`、`bridge*.ts`、`settingsModel.ts`、`keymap*.ts`、`src/diff*`、
`src/problems*`、`src/completion*`、`src/editorCodeBlock.ts`、`src/editorCommands.ts`、`native/**`、
`tests/everywhere-text.test.mjs`（派单点名"今晚别动"，本路一次都没打开它）。

---

## 3. §5 每条自查命令的前后数字

| 命令 | 开工前 | 收工后 |
| --- | --- | --- |
| `npx vue-tsc -b --force` | **0 错**（exit 0） | **0 错**（exit 0） |
| `node --test tests/search-*.test.mjs tests/structural-*.test.mjs tests/find-*.mjs tests/everywhere-*.test.mjs tests/run-anything*.test.mjs tests/fuzzy-match.test.mjs tests/command-search.test.mjs tests/editor-find*.test.mjs` | 362 pass / 0 fail | **377 pass / 0 fail**（净 +15 = 新测试文件 15 条；随改动消失的断言 0 条） |
| 上面这套 + `tests/module-size.test.mjs` | —— | **382 pass / 0 fail**（上限未抬、未登记豁免；新文件 491 行 < 900） |
| `node .tools/find-param-props.mjs` | 0 处 | 0 处 |
| `node .tools/find-ts-in-mjs.mjs` | 干净 | 干净（新测试文件里 0 条 TS 语法） |
| `node .tools/find-missing-ext.mjs` | 干净（扫 1254 文件） | 干净（扫 **1284** 文件） |
| `node .tools/find-orphan-modules.mjs --gate` | 登记 9 / 基线 9 / 新增 0 ⇒ **绿** | 登记 9 / 基线 9 / 新增 **0** / 清掉 0 ⇒ **绿**（`src/structuralCodeBlock.ts` 当场被 `src/structuralSearchModifiers.ts:38` import，不是只过自己测试的死模块） |
| `node --test tests/source-citations.test.mjs tests/source-citation-anchors.test.mjs` | **开工时漏跑**（如实记） | **9 pass / 2 fail**；7 条"按图索骥会扑空"的引用全部在别域文档（`batch-2026-10-06-projecttree.md`、`-status2.md`、`-welcome2.md`、`wiring-requests-2026-10-06-vcs2.md`），**本路两份文档 0 条**：本路写的每一条上游坐标都自己 `sed` 开过文件（见 §1 各表的「本路核对」） |
| `npm run test:native` / ctest | 不适用 | **不适用**：本路没动 `native/**`（只读了 `native/search.cpp:134-162`、`:255-261`、`:46-50`、`:660-674`、`:688-703` 取证）。宿主断言能力那条实测用的是 `build/` 下一个独立探针程序（`cl /std:c++20`，VS 18 Enterprise），输出：**`(?=x)`/`(?!x)`/`(?:x)` 编译通过；`(?<=x)`/`(?<!x)`/`(?<![A-Za-z0-9_$])a` 抛 `regex_error(error_badrepeat)`** —— 这就是 §1.1 那条缺陷的证据；探针文件已删 |
| 全量 `npm test` | 按规约 §5 未跑（12 路并行，只跑本域） | 同 |

---

## 4. 反向验证记录（注入违规 → 变红 → 撤掉 → 复绿）

| # | 注入了什么 | 红了几条 | 撤掉后 |
| --- | --- | --- | --- |
| R1 | 把宿主编不出的那条后顾断言塞回编译产物：`src/structuralSearchConstraints.ts` 的 `runEnd()` 返回值前面拼上 `(?<![A-Za-z0-9_$])` | `tests/structural-code-block.test.mjs` + `tests/structural-search-constraints.test.mjs` 合跑 **27 条里 5 红**：「贪婪列表的编译产物不许带后顾断言（宿主的 std::regex 编不出…）」、「次数约束真的作用在匹配结果上…」、「替换串里的 $N 仍按变量首次出现的顺序编号…」、「约束只能写在首次引用上…」、「半截的列表在复核这一层被否决…」 | 复绿：`27/27`（并整套本域 382/382） |
| R2 | 拆掉复核的门：`needsSpanCheck` 里 `if (false && hasListVariable(pattern))`（即"有列表变量也不复核"） | 与 R3 **同时**注入时 **27 条里 1 红**：「半截的列表在复核这一层被否决，并说清是哪一条」（它钉的正是 `needsSpanCheck(...)===true`） | 复绿 |
| R3 | 把"同层逗号"那条深度比较退化成"看见逗号就否" | **0 红** ⇒ 说明我原来写的那条比较是**恒等的死逻辑**（`prevCodeChar` 已经停在最近的代码字符上，逗号与起点之间只可能隔着空白/字符串/注释，深度永远相同） | 处置：**删掉那条比较**，并把三处「按括号深度才判得准」的说法改成实测口径 —— 真正判得更准的是**词法**（字符串/注释里的逗号不是分隔符）与 **`$` 边界**（`\b` 看不见 `$`），配平那一条才是用深度的，在 `listRunEndsHere`。测试补了两条钉住这两档（`tests/structural-code-block.test.mjs` 的 `f(", ", x)` 与 `f(x) // a, y`） |
| R4 | 断言改向的自查（规约「不许放松断言」这条要走明） | `tests/structural-search-filters.test.mjs` 里「零项列表在文本层允许整段缺席」从 `ok(re.test('.equals(b)'))` 改成 `ok(!re.test(...))`。理由与上游依据写在注释里：贪婪列表那支现在带起点 `\b`，空列表落在运算符右边过不了 ⇒ 原来钉住的是一处**假命中**；上游 receiver 是方法调用表达式的必需子节点（`SubstitutionHandler.java:264-269`）。**这是收紧不是放松**：同一测试文件里"`a.equals(b)` 该命中且捕获是 `a`"两条原样保留且仍绿 | 复绿：`tests/structural-*.test.mjs` 111/111 |

## 5. 零消费方自查结论

- `node .tools/find-orphan-modules.mjs --gate`：**9 / 9 / 新增 0**，门禁绿。
- 本路唯一的新生产模块 `src/structuralCodeBlock.ts` 的消费链（实测 import）：
  `src/structuralSearchModifiers.ts:47`（import `listRunStartsHere`/`listRunEndsHere`）
  ← `src/structuralSearchPanelModel.ts:27`（`filterHitsByModifiers`/`needsSpanCheck`）
  ← `src/components/SearchPanel.vue:27`（面板模型）⇒ 到用户可见的结果面板，**不是只过自己测试**。
- B 半（`findCodeBlockRange`/`mergeBlockEnd`/`mergeBlockStart`/`pythonCompoundStatement`/`pythonCompoundKeywordRanges`）
  目前只有自己的测试 —— 文件头写清了"为什么现在接不上"（合并点 `src/editorCodeBlock.ts:147-150` +
  调用方 `src/editorCommands.ts:176` 都不在本面），并给出可照抄的接线（W-1'）。
  门禁按文件粒度算，本文件不红；**若桶 5 那侧最终决定不接**，请让主代理删掉 B 半与那 8 条判据，
  不要留半死的出口（这是规约 §3 的意思，我在文件头也写了同一句）。
- 本路没启动任何图形界面、没上网、没跑全量 `npm test`；临时文件全部在 `build/` 并已删干净。

## 6. 做不到 / 无法核实

1. **把 B 半真的接进代码块导航**：做不到，卡在合并点 `src/editorCodeBlock.ts:148` 与调用方
   `src/editorCommands.ts:176` 都不在本面（派单禁改清单点名 `CodeEditor.vue`/`App.vue`，且 `editorCommands.ts`
   本路开工时是别的代理在途的 `M` 文件）。已给 W-1'：两处改动 + 判据 + 现成的语言通道
   （`src/editorMatchBrace.ts:49` 的 `editorLanguageId` facet，本路核到 `:188` 已经在这样读语言）。
2. **让"裸列表变量模板"在替换通道也判得一样准**：做不到。宿主 `std::regex` 没有后顾断言，
   所以「这一段是不是同一个列表的后半截」写不进 query；复核那一层能否决**显示出来的**命中
   （`refine()` ⇒ `dropped`），但「全部替换」是宿主自己按 query 改写的。实测形状：
   模板 `f($x{2}$)` 这类**有字面包住**的写法两端一致（模板的 `(`/`)` 自己就是边界）；
   只有"整条模板就一个裸列表变量 + 文本里逗号比 max 多"这一格会让宿主多算一处。
   要么给宿主换正则引擎（跨域、本路没做），要么把这一档说破 —— 已说破在
   `src/structuralCodeBlock.ts` 头注与 `src/structuralSearchPanelModel.ts:15-19`。
3. **两层以上嵌套的列表项**：做不到。ECMAScript 文法（宿主与 JS 同一档）没有递归匹配，
   编译产物只允许"一项 + 一层括号"。行为是**少报不报半截**（`g(h(1), 2)` 整条不命中），
   已写进 `src/structuralSearchConstraints.ts:363-373` 与面板那行用户可见说明。
4. **跨行命中的变量值**（`ss/matcher` 的「匹配结果模型」）：做不到，卡在哪一环写清了 ——
   宿主只回一行 `preview`（`native/search.cpp:687-704`），面板在这一行上重跑正则取捕获
   （`src/structuralSearchResults.ts:51-64`），跨行模板必然取不到值。修它要改宿主回参形状，
   跨 `native/search.cpp` + `src/bridge.ts`（`bridge*.ts` 是禁改文件）⇒ 未做，**没写进接线请求**
   （派单让主代理接的线只两条，这条要的是"能不能给宿主加一段 context 回参"的决策）。
5. **`.gitignore` 排除源**：无法核实到行号 —— 我在这份 community 树里没找到
   "文本搜索按 VCS ignored 排除"的那条链，因此**不**做（§1.5 判 `[-]`/`[ ]` 的理由）。
   上一批同类事故的教训（判词/坐标可能是编的）适用于此：没有行号就不动。
6. **Ultimate 侧的 `codeBlockSupportHandler` 注册项**：无法核实（本机参考树是 community）。
   结论「只有 Python 注册」只在这份树内成立，已写在 `src/structuralCodeBlock.ts` 文件头。
7. **别域文档带进引用门的 7 条假坐标**：不代改（不在本面），清单见 §3 的引用门那一行。

## 7. 需要主代理接的线（全文在 `docs/wiring-requests-2026-10-06-search2.md`）

- **W-1'**（桶 5）：`src/editorCodeBlock.ts` 加 1 行 import + 换 4 行 `codeBlockTarget`；
  `src/editorCommands.ts:176` 传 `state.facet(editorLanguageId) ?? ''`；
  `tests/editor-code-block.test.mjs` 补一条「Python 压在 `elif` 上时走 `min(结构, 括号)`」。
  **模块与判据都在树里，那一侧只改 2 个文件、不写任何新逻辑。**
- **W-2'**（`appvue`）：`src/App.vue:2611` 的 `run-command` 处理器补第三参 `payload.cwd`
  （`src/runActions.ts:447` 的形参是现成的），我这一侧随后把 `RunAnythingDialog.vue` 的 emit
  形状与工作目录选择器一起落；接上后删 `.tools/orphan-baseline.txt` 里
  `src/runAnythingContext.ts` 那一行。
- **账本订正 2 条**（`docs/inventory/verdict-platform_rest.md` / `platform_rest_verdict_table.json`，均不在本面）：
  ① `lp/text-search` 里 `parse_patterns` 的坐标 `search.cpp:370-382` ⇒ 实际 `:660-674`；
  ② `se/ui` 的三条"缺"（Files/Symbols 档、每档 `SeFilterEditor`、配额与 Top Hit）本仓**早做过**，
  `ss/matcher` 的「列表变量交给 `MatchingStrategy`/`TopLevelMatchingHandler` 配平」是错的归属
  （实际机制与正确坐标见本文件 §1.1 第一行）。
- **一条已消失的旧请求**：`docs/wiring-requests-2026-10-06-searchdiff.md` 的 W-1 里
  「待恢复的模块原文 / 待恢复的测试原文」两段可以作废（模块与判据都已落盘），
  那份文档的**上游依据表仍然有效**（本路逐条复核过，见 §1.1 与 W-1' 的表）。
