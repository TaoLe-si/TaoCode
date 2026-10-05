# 桶 2b · 检查与问题视图（接手「补全/意图/检查/问题视图」被切断的代理的后半区）· 2026-10-06

接手现场（我自己重跑的数字，主代理给的快照已过时）：
本域六个 glob（`tests/completion*.test.mjs tests/inspection*.test.mjs tests/problem*.test.mjs tests/annotator*.test.mjs tests/intention*.test.mjs tests/highlight*.test.mjs`）
**收工前 137 用例 / 137 通过 / 0 失败**；接手时是 **1 红**：`tests/highlight-passes.test.mjs:88`
（不是我引入的：桶 11 的 `src/junitRules.ts` 刚落了三条 naming 规则，那条用例的「修好了」样本
`class A { @Test void x() {} }` 现在被 `TestClassNamingConvention`/`JUnit4MethodNamingConvention` 继续报，
于是断言 `localDiagnostics.get(path) === undefined` 变红）。修法是**改样本不改判据意图**
（把样本换成 `class TestAlpha { @Test void checksWork() {} }`，断言仍精确到 `deepEqual([], ...)` 与脏范围 `[{start:1,end:3}]`），
代码一行没回退。

主杠杆（「诊断码 → IDEA 检查项」）本轮结论见 §2；改动清单见 §3；验证与反向验证见 §4；做不到/无法核实见 §5。
接线请求另见 `docs/wiring-requests-2026-10-06-bucket2b.md`（1 条硬请求：`relatedInformation` 透传）。

---

## 1. 判词表（八族逐条；「缺：」原文抄自 `docs/inventory/verdict-daemon.md` 与 `verdict-platform_rest.md`）

上游坐标全部是本机解压树 `D:\Backup\Downloads\intellij-community-master\intellij-community-master` 下**我自己打开到那一行**核过的。
判定用词：`已落（前一轮）`= 上一任 2b 已做完且有消费方；`本轮做`= 我这轮新落；`本轮订正`= 判词过期、按源码改正；`做不到`= 卡点写具体。

| 族 | 判词里的「缺」（原文） | 判定 | 上游依据（相对路径:行号） | 本仓落点（文件:行号） | 说明 |
|---|---|---|---|---|---|
| `dm/problems-view` | 「`groupByToolId` 的分组维度」这条链（任务书点名） | 本轮做 | `platform/problemsView/ui/.../ProblemsViewState.kt:28`（`var groupByToolId: Boolean by property(false)`）；键的解析 `.../HighlightingProblem.kt:85-89`；组节点只画这个字符串 `.../ProblemsViewGroupNode.kt:11-19`；分组的树形状 `.../ProblemsViewHighlightingChildrenBuilder.kt:44-58`（`if (!groupByToolId) return problems.toProblemNodes(...)`，开了才插一层组） | `src/inspectionIdentity.ts:123-149`（身份解析）→ `src/problemsView.ts:33,36`（`'inspection'` 档 + `PROBLEM_GROUPINGS`）→ `src/problemsView.ts:252-258`（`groupLabel` 标题取显示名）→ `src/problemsPanelState.ts:41`（存档白名单直接取清单）→ `src/components/ProblemsPanel.vue:467`（下拉项）| 上游的组标题**不是裸 tool id 而是 `HighlightDisplayKey` 的显示名**（`HighlightingProblem.kt:88` 那一行就是这个调用）。本仓以前只有裸码标题，本轮补上这一格：`按诊断码` 档标题变 `tsserver (2304)`、tags 那档变 `Unused declaration`；**键保持原粒度**（裸码/裸来源），所以旧存档与既有判据不烂（`tests/problems-view.test.mjs:87,90` 仍绿）。新增 `按检查项` 档 = 上游那个开关的等价物（键 = 身份键，与 profile 门控同一把）。 |
| `dm/problems-view` | 「高亮级别的 `syntax` 档按 LSP severity 1 近似（本仓没有 PSI「语法错误 vs 类型错误」的分类）」 | 已落（前一轮）+ 维持 | `platform/analysis-api/src/com/intellij/codeHighlighting/HighlightDisplayLevel`（四档）；分类要 PSI，本树里 LSP 侧没有语法/类型二分的字段可映射 | `src/highlightSettingsPerFile.ts`（三档门控）+ `src/problems.ts:66-70` | 判词的「近似」结论仍然成立：LSP 没有「语法 vs 类型」这一列，`native/lsp_support.cpp` 的 `shape_diagnostics` 也没有可推导的字段。**不放假分类**，维持 severity 1 = syntax 档。 |
| `dm/problems-view` | 「问题树的展开态没有可持久化对象」 | 已落（前一轮） | `platform/problemsView/ui/.../ProblemsViewPanel.java:212`（`JTree` 运行时展开态，`ProblemsViewState` 里确实没有 collapsedGroups 字段） | `src/problemsPanelState.ts:29,69`（`collapsedGroups` 序列化）+ `ProblemsPanel.vue:103-110,160`（折叠/展开/折叠后仍可停用） | 本仓多出来的可持久化对象，上游没有对应字段 —— 已按「架构不等价就还原用户可见功能」处理，判词这条可以撤。 |
| `dm/problems-view` | 「Project Problems 的成员级关联问题（`BrokenUsage`/`RelatedProblem`）」 | 做不到（卡点：宿主丢字段） | `platform/lsp-impl/src/impl/features/highlighting/LspDiagnosticAndLazyQuickFixes.kt:42` —— LSP 宿主把 `relatedInformation` **原样保留**进注解数据 | 前端侧一切就绪：`src/problems.ts:49-54`（`ProblemRow.code`/`tags` 已在透传），缺的是同一层的 `related` | 唯一断点在 `native/lsp_support.cpp:127-150`：只带 `line/character/message/severity/end*/source/code/tags`，`relatedInformation` 被丢。成员级（`BrokenUsage` 的「哪个成员被谁用」）要索引，本仓没有；**但 LSP 的相关位置子集是能做的**，只差那一次透传 ⇒ 已写 `wiring-requests…#R1`。没有后端就不画那一节列表（假控件禁令）。 |
| `dm/highlight` | 「LSP 诊断在 `native/lsp_support.cpp:127-145` 就被裁成 `{line,character,message,severity,end*,source}`，`code`/`tags`（Unnecessary/Deprecated）/`relatedInformation` 不透传，而 `LspDiagnostic` 类型在禁改文件 `src/bridge.ts:109`」 | **本轮订正** | `native/lsp_support.cpp:148-149`（实测已 `entry["code"]`/`entry["tags"]`）、`src/bridge.ts:118`（`code?: string \| number; tags?: number[]`） | `src/problems.ts:54`（`ProblemRow.tags`）+ `src/inspectionIdentity.ts:59-79`（`problemKindOf` + 两档注册名）+ `src/annotatorHighlights.ts:64-66`（同一份判定）+ `ProblemsPanel.vue:629`（行芯片）| 判词的「code/tags 不透传」**已过期**：代码与行号都变了（`bridge.ts:109` 现在是 `:118`）。本轮把这两列**接进消费链**（以前只有装饰层吃 tags，问题视图/配置面吃不到）：`Unused declaration`/`Deprecated API usage` 的 id 与显示名逐字取上游（`HighlightInfoType.java:30,49-51,53-55,217-218` + `DeprecationUtil.java:13,15,22-24` + `AnalysisBundle.properties:19,68`）。仍缺的只有 `relatedInformation`（见上一行）。 |
| `dm/highlight` | 「`UpdateHighlightersUtil` 的整体重算与 `BackgroundUpdateHighlightersUtil` 的后台更新无对应物（每次推送整段替换）」 | 维持做不到（卡点：无后台重算模型） | `platform/analysis-impl/src/com/intellij/codeInsight/daemon/impl/UpdateHighlightersUtil.java`（逐区间替换） | 编辑期增量在 `src/lspHighlightingCache.ts`（`applyPendingEdits` 四分支，前一轮）、分趟调度在 `src/highlightPasses.ts` | 本仓没有「按区间打补丁」的呈现层：CodeMirror 的 lint collection 整体替换。前一轮已把**编辑期平移/裁剪**做在 `lspHighlightingCache` 里（有真实消费方 `src/lspNavigation.ts`），这条判词的「无对应物」应改成「只有编辑期平移，没有后台分趟」。 |
| `dm/annotator` | 「注解器扩展点（`Annotator`/`ExternalAnnotator` EP 与 `AnnotatorRunner` 的按文件分派 —— 本仓没有插件贡献点宿主与本地 PSI 遍历，本地通道只有内建生产者 `src/junitInspections.ts`，没有第三方注册面）」 | 已落（前一轮） | `platform/analysis-api/src/com/intellij/lang/annotation/Annotator`、`ExternalAnnotator`（本树存在）；`ProblemGroup.java:6-12` 的「把一条检查拆成几个伪检查项」正是外部注解的身份来源 | `src/annotatorRegistry.ts`（注册/分派面，184 行）、`src/annotatorHighlights.ts`（内建注解器）、`src/annotatorHighlightLayer.ts`（装饰层），消费方 `src/components/CodeEditor.vue` | 我核过消费链：`annotatorRegistry` ← `annotatorHighlights`/`annotatorHighlightLayer` ← `CodeEditor.vue`，注册面不是只有测试在用。**第三方贡献**仍然只能由本仓内建代码调用（没有插件加载器），这条限制如实保留。 |
| `dm/annotator` | 「`GeneralHighlightingPass` 的分趟/增量调度」 | 部分已落（前一轮）+ 维持卡点 | `platform/analysis-impl/.../GeneralHighlightingPass.java`（分趟合并） | `src/highlightPasses.ts:35,113-116`（`kind: 'main' \| 'editorBound'` + `afterPassId` 顺序 + 「内容没变整拍不跑」+ 脏范围） | `EditorBoundHighlightingPass` 那一档（判词 an/highlighting 第③条）也已经在了：`highlightPasses.ts:12-13` 直接引上游 `EditorBoundHighlightingPass.java:8-15`。真按脏范围只重扫局部仍不做（JUnit 规则有跨行窗口，保守全文重算，已写在判词里）。 |
| `dm/inspections` | 「profile 的导入/导出（`.xml`/`.ipr`）」 | 已落（前一轮）+ **本轮订正 `.ipr`** | `platform/lang-impl/src/com/intellij/profile/codeInspection/ui/InspectionProfileImporter.java:16-18`（扩展名只有 `xml`）；`.ipr` 是 JPS 工程文件（`jps/model-serialization/src/org/jetbrains/jps/model/serialization/JpsProjectLoader.java`），与检查配置无关 | `src/inspectionProfile.ts`（`exportProfileXml`/`parseProfileXml`/`importProfileXml`）+ `src/inspectionProfileIo.ts` + `src/inspectionProfileHost.ts`；面板入口 `ProblemsPanel.vue:559-561`（从工程目录导入/导出/切档） | 判词写「`.xml`/`.ipr`」的 `.ipr` 是过期说法，按上游 importer 只有 `xml` ⇒ 本轮不做 `.ipr` 并留痕。另：本轮把 XML 的 `class` 属性喂了**身份键**（`eslint::quotes`、`#unused`），往返有判据（`tests/inspection-item.test.mjs` 第 5 条）。 |
| `dm/inspections` | 「按工程的多 profile 与状态栏 profile 切换器」 | 已落（前一轮） | `platform/analysis-impl/src/com/intellij/profile/codeInspection/InspectionProfileManager.java:23,37,40`（`getProfiles`/`setRootProfile`/`getCurrentProfile`） | `src/inspectionProfile.ts:204-260`（`profileNames`/`selectProfile`/`duplicateProfile`/`renameProfile`/`deleteProfile`/`setProfileLocked`）+ `src/components/InspectionProfileSwitcher.vue`（36 行） | 主代理说切换器已挂在 `App.vue:2307`，本轮**不再**交那条请求。 |
| `dm/inspections` | 「`InspectionToolRegistrar` 的扩展点注册面」 | 做不到（卡点：规则由语言服务注册） | `platform/analysis-impl/src/com/intellij/codeInspection/ex/InspectionToolRegistrar.kt`（EP 供给本地工具类） | 无 | 本仓没有本地 inspection 引擎，也没有「宿主注册一个工具、daemon 去跑它」的通道 —— 能注册的只有**注解层**（`src/annotatorRegistry.ts`，见上面 dm/annotator），跑规则的口子在服务器侧。不造假注册表。 |
| `lp/inspections` | 「本地检查配置文件模型（按 `source` 启用/停用与严重度覆盖，状态栏因此没有 profile 切换器）」 | 已落（前一轮）→ **本轮升到检查项粒度** | 启停粒度 = 单个检查项 key：`platform/analysis-impl/src/com/intellij/codeInspection/ex/InspectionProfileImpl.java:804`（`isToolEnabled(HighlightDisplayKey key, PsiElement)`）、`:546`（`getToolDefaultState(toolShortName, project)`）；XML 逐工具属性 `class`/`enabled`/`level`：`.../ex/ToolsImpl.java:40-42` | `src/inspectionProfile.ts:328-345`（候选键逐级门控）、`:349-410`（`InspectionItemEntry`/`inspectionItems`，含 `disabledBy` 上级牵连）、`src/problems.ts:72`（把 `code`/`tags` 交给门控）、`ProblemsPanel.vue:566-580`（清单按检查项，写设置传 `entry.key`） | 「按 `source`」那一档太粗：同一检查器下不同诊断码合成为一条，面板没法只停一条规则。本轮把键折成 `#<kind id>` → `检查器::码` → `检查器` → `码` 四级候选，按「具体赢宽泛」取第一个有登记的；**旧存档只有裸 source 键的继续命中第三级**（判据第 3 条），「（无来源）」那条登记在空键上（回归闸门，判据也写了）。顺带删了 `inspectionSources`（换成 items 后它只剩测试在用，不留 test-only 导出）。 |
| `lp/inspections` | 「结果树的检查器描述富文档（`InspectionDescriptionDocumentationProvider`）」 | 做不到（卡点：本仓没有检查描述文件；语言服务的 href 被宿主丢了） | 上游那份富文档读的是插件自带的 inspection 描述 HTML；LSP 侧唯一可承接的来源是 `Diagnostic.codeDescription.href` | 无（前端可承接点在 `src/problemsView.ts` 的组标题，但拿不到数据） | 已并进 `wiring-requests…#R1`（把 `codeDescription.href` 与 `relatedInformation` 同一次透传）。本地规则（`src/junitRules.ts`，桶 11 名下）有短名没有描述文件，我不越界补文案。 |
| `an/highlighting` | 「可配置的严重度颜色与抑制级别（没有按 profile 覆盖级别属性的设置面）」 | 抑制级别本轮做；**颜色做不到** | 级别覆盖 = profile 的 `level` 属性（`ToolsImpl.java:40-42`）；颜色要 `HighlightSeverity` 的 `TextAttributesKey` 注册表（`platform/analysis-api/.../EditorColorsManager` 一族），本树里 LSP 侧的颜色入口只有 `LspDiagnosticsCustomizer.kt:99-100`（`getEnforcedTextAttributes`，默认返回 null） | `src/inspectionProfile.ts:328-345`（逐检查项级别覆盖，含 `#unused`/`#Deprecation` 两档）+ `ProblemsPanel.vue:574`（严重度下拉）| 级别覆盖这一半本轮做到了检查项粒度。颜色那一半的卡点是具体的：本仓色值走 `src/tokens.css`（禁改文件）+ `src/highlightLevels.ts` 的样式类，**没有一个「用户可改的 severity→颜色」持久通道**（`src/settingsModel.ts` 也是保留文件），做了只能是硬编码 hex ⇒ 违反规范，不做假面。 |
| `an/highlighting` | 「`RainbowHighlighter`（编辑器宿主 `CodeEditor.vue` 本批冻结，没有本地括号高亮层）」 | 维持卡点（前一轮判断成立） | `platform/analysis-impl/.../codegen/RainbowHighlighter*`（本树按文件名搜到与否未展开核实） | 无 | 宿主文件冻结 + 括号层级高亮要有本地扫描层；`src/annotatorRegistry.ts` 的注册面是现成的，缺的是宿主接线。留给主代理统一接（不在本轮请求里，避免与桶 5 的折叠改动撞 `CodeEditor.vue`）。 |
| `ls/highlighting` | ①「`LspHighlightingApplier` 的统一 apply 器」 | 维持卡点 | `platform/lsp-impl/src/impl/features/highlighting/LspHighlightingApplier.kt:308,328-334`（`toHighlightInfoType`，本轮我打开确认了这个行号） | 各层各自整体替换：`src/editorDiagnosticMarkers.ts`、`src/annotatorHighlightLayer.ts`、`src/semanticTokens.ts` | 判词里「tags→类型」那张表的坐标是对的（`:328-334`），本轮 `src/inspectionIdentity.ts` 的文件头也引了它。统一 apply 器要三层共用一个生命周期，跨三个模块（其中两个不在我名下）⇒ 不在本轮。 |
| `ls/highlighting` | ③「`LspHighlightingCacheRegistry` 的按特性注册表没有（缓存实例在各调用点创建）」 | 本轮不做（卡点：会变成零消费方模块） | `platform/lsp-impl/src/impl/features/highlighting/`（该目录 13 个文件我列过：`LspSemanticTokensCache.kt`/`LspDocumentLinkCache.kt` 等） | 无 | 注册表的两处潜在消费点（语义 token / 文档链接）分别在 `src/semanticTokens.ts` 与 `src/documentLinks.ts`，都不在我名下 ⇒ 只能交接线；而**没有消费方的注册表 = 假模块**（`find-orphan-modules --gate` 会红），所以不建。 |
| `ls/highlighting` | ⑤「`LspProblemFileHighlightFilter`（判词原文猜的是「内容内且在项目里的文件才算问题文件」）」 | **本轮订正**（判词的解释不对） | `platform/lsp-impl/src/impl/features/highlighting/LspProblemFileHighlightFilter.kt:9-19` —— 原文注释与实现：「让 `WolfTheProblemSolver` 接受**有活动 LSP 客户端打开着**的文件的错误报告；没有这个 filter，Wolf 会静默忽略 `reportProblemsFromExternalSource`」 | `src/problems.ts:64-70`（只遍历 `lspDiagnostics` 表 —— 表里只有服务器为**已打开文件**发布过的诊断）+ `src/analysisIgnore.ts` 门控 | 上游这一条的真实语义是「没有活客户端就不收报告」，本仓天然满足（诊断表按文件由 push/pull 填），不需要新代码；判词里「项目里/内容内」那句解释按源码改正。 |
| `ls/highlighting` | ⑦「push 事件不带版本号，`acceptsPublishedVersion` 闸门接不上」 | 维持卡点（前一轮已在模块头注明） | `platform/lsp-impl/src/impl/features/highlighting/LspPublishDiagnosticsCache.kt:78-95` | `src/lspHighlightingCache.ts` 文件头 | 宿主 `native/lsp_host_bootstrap.cpp:55` 的 `publishDiagnostics` 折出来的 payload 没有 `version` 字段 ⇒ 版本闸门需要 native 改动，已属主代理的桥面。 |
| `dm/quickfix` | 「Alt+Enter 弹层内的编辑器内嵌预览层」「`ShowIntentionsPass` 的按 pass 收集/排序与 `IntentionMenuContributor`/`IntentionsUI` 的扩展点面」 | 非本半区（2c：补全/意图） | —— | —— | 任务书明确「`src/completion*`/`src/intention*` 归 2c，别动」。我只在**问题面板的行菜单**这一侧共用了它们的通道：抑制条目插入的 rule id 现在优先取 `ProblemRow.code`（语言服务给的规则短名），消息里抠出来的只做回退 —— `src/components/ProblemsPanel.vue:219-223`。 |

---

## 2. 「按诊断码分组」这条链的端到端结论

逐环实测（每环给出文件:行号）：

| 环 | 状态 | 证据 |
|---|---|---|
| 1. 服务器 → 宿主 JSON | **通** | `native/lsp_support.cpp:148-149` 透传 `code`/`tags`；`native/lsp_host_bootstrap.cpp:55` 与 `native/lsp_session_kinds.cpp:448,648` 三个入口都过 `shape_diagnostics` |
| 2. 宿主 → 桥类型 | **通** | `src/bridge.ts:118` `code?: string \| number; tags?: number[]` |
| 3. 桥 → 问题表 | **通**（本轮补 `tags`） | `src/problems.ts:40-54`（`ProblemRow.code`/`tags`）、`:75-77`（数字码折成字符串 + tags 原样带上）、`:79-88`（本地检查回落到 source） |
| 4. 问题表 → 检查项身份 | **本轮新落**（这一环以前根本不存在） | `src/inspectionIdentity.ts:59-79`（tags→两档伪检查项，id/显示名逐字取上游）+ `:123-149`（四级候选键 + 显示名）—— 对应上游 `HighlightingProblem.kt:85-89` 的那一步 |
| 5. 身份 → 分组/标题/过滤 | **本轮接上** | `src/problemsView.ts:33,36`（`inspection` 档 + 清单）、`:240-246`（身份键）、`:252-258`（组标题 = 显示名）、`:65-77`（文本过滤吃诊断码与检查项名） |
| 6. 分组 → 面板可见面 | **本轮接上** | `ProblemsPanel.vue:463-468`（下拉多一枚「按检查项（IDEA 的 groupByToolId）」）、`:629`（行的「未使用声明 / 已废弃 API」芯片）、`:627`（组头「停用此检查项」）、`:566-580`（「检查配置…」清单按检查项） |
| 7. 面板 → 门控（停用/级别） | **本轮闭环** | `src/inspectionProfile.ts:328-345` 按同一把候选键逐级判 → `src/problems.ts:72` 聚合前生效 → 状态栏/面板/错误条同源 |
| 8. 存档 | **本轮接上** | `src/problemsPanelState.ts:41`（白名单直接取 `PROBLEM_GROUPINGS`，手写清单漏档导致「静默退回不分组」的那类 bug 从根上没了） |
| 9. 关联位置（`relatedInformation`） | **断**（唯一断点） | 断在环 1：`native/lsp_support.cpp` 的 `shape_diagnostics` 没带它；前端从环 3 起全部就绪 ⇒ `wiring-requests…#R1` |

一句话：**「诊断码 → IDEA 检查项」这条链本轮从环 4 起打通并落到用户可见面（分组标题、行芯片、检查项粒度的启停与级别、组头停用、存档），唯一还断的是「一条问题的相关位置」，断点在宿主 `shape_diagnostics` 丢字段，已交请求。**
顺带一个**上游事实订正**（重要，免得后人再做错方向）：上游 `LspDiagnosticsCustomizer.kt:47-75` 的 `createAnnotation` **既不设 problemGroup 也不设 toolId**（我在 `platform/lsp` 与 `platform/lsp-impl` 两个目录里 grep `problemGroup`/`withProblemGroup` 都无命中）。也就是说上游把 LSP 诊断的 `group` 算成 `null`（`HighlightingProblem.kt:87` 两级回退都取不到），**「按检查器分组」在 IDEA 里对 LSP 诊断是不分组的**。本仓的检查 100% 来自 LSP，若照抄这一层用户就永远看不到分组 ⇒ 按「架构不等价就还原用户可见功能」的指示，本仓用 `source`/`code`/`tags` 三列折出身份键承接它，并把 tags 那两档直接复用上游**确实注册出来**的两个 key（`unused` / `Deprecation`）。差异如实登记在此。

---

## 3. 改动文件

新增
- `src/inspectionIdentity.ts`（152 行，纯模块）：tags→伪检查项、四级候选键、显示名与中文芯片文案、`identityOfRow`。
- `tests/problem-identity.test.mjs`（6 条判据）。
- `tests/inspection-item.test.mjs`（6 条判据，含 XML 往返与消费链路锚点）。
- `docs/batch-2026-10-06-bucket2b.md`、`docs/wiring-requests-2026-10-06-bucket2b.md`（本文件与请求）。

修改
- `src/problems.ts`：`ProblemRow.tags`（`:49-54`）、LSP 支路传 `code`/`tags` 给门控并带上 `tags`（`:72,77`）、模块头注明身份链。**该文件本来就是「M」状态**（相对 HEAD 还有别的 agent 的 hunk：`./bridge.ts` 扩展名、三道门控），我只加上述几处，`git diff` 自查过。
- `src/problemsView.ts`：`'inspection'` 档 + `PROBLEM_GROUPINGS`（`:33,36`）、`NO_SOURCE_LABEL`/`NO_CODE_LABEL`（占位文案单点）、`inspectionKeyOf`（`:240`）、`groupLabel`（`:252`）、文本过滤（`:65-77`）。
- `src/problemsPanelState.ts`：白名单改取 `PROBLEM_GROUPINGS`（`:41`）、`groupByToolId` 字段的映射说明改写（`:10-12`）。
- `src/inspectionProfile.ts`：门控按候选键逐级（`:328-345`）、`InspectionItemEntry`/`inspectionItems`（含 `disabledBy`）（`:349-410`）、**删除** `inspectionSources`（换成检查项清单后只剩测试在用）、模块头的「为什么 key 用 source」整段按源码订正（`:36-52`）。
- `src/annotatorHighlights.ts`：`diagnosticKind` 改为委托 `problemKindOf`（`:64-66`，返回值不变，`tests/annotator-highlight-layer.test.mjs` 全绿），共用同一份 tags 判定。
- `src/components/ProblemsPanel.vue`（727 行 < 900）：分组下拉新档（`:467`）、行芯片 + 来源列 title（`:629`）、组头「停用此检查项」（`:627`、脚本 `:335-356`、`visibleGroups.muteKey` `:160`）、「检查配置…」按检查项（`:566-580`）、复制描述带检查项（`:171-178`）、抑制条目优先用 `row.code`（`:204-208`）、芯片/组头样式（`:712-717`，全部走令牌，无裸 hex）。
- `tests/highlight-passes.test.mjs`：修 §0 说的那 1 红（改样本 + 脏范围期望，判据意图不变）。
- `tests/inspection-profile.test.mjs`：清单判据迁移到 `inspectionItems`（标题与注释写明为什么迁）。
- `tests/problems-view.test.mjs`：「存档白名单」那条锚点改为断新的单点清单（原来断字面量数组 `['source','code']`，被我换成 `PROBLEM_GROUPINGS` 后必然失配；**改测试不回退代码**，两条断言仍精确）。

未动（按任务书）：`src/completion*`、`src/intention*`、`src/inlineCompletion*`、`src/junitQuickFix.ts`、`src/diff*`、`src/projectTree*`；保留文件（`App.vue`/`CodeEditor.vue`/`bridge*.ts`/`settings*`/`tokens.css`/`module-size.test.mjs`/`source-citations.test.mjs`/`CMakeLists.txt`）一行没改。git 纪律：没 commit、没 push、没 checkout/reset/stash/clean。

---

## 4. 验证数字

| 项 | 结果 |
|---|---|
| 本域六 glob（`node --test tests/completion* inspection* problem* annotator* intention* highlight*`） | **137 / 137 通过 / 0 失败**（接手时 1 红，已修；我新增 12 条） |
| 我的两个新判据文件 | `tests/problem-identity.test.mjs` 6/6、`tests/inspection-item.test.mjs` 6/6 |
| 顺带影响的邻域（本地检查通道） | `tests/junit-inspections.test.mjs` + `tests/junit-rules.test.mjs` = **25/25 通过**（我改了 tags 判定的委托关系与样本，这两份是消费方回归） |
| 类型 | `npx vue-tsc --noEmit` → 只剩 2 处**别人名下**的语法错（`src/customFoldingProviders.ts:48` unterminated string、`src/components/StructuralSearchFilters.vue:238`），我域内 0 错；`npx vue-tsc -b --force` 同 |
| 三条书写门禁 | `find-param-props.mjs` **0 处**；`find-ts-in-mjs.mjs` **干净（全部纯 JS）**；`find-missing-ext.mjs` **干净**（1144 文件、三种 import 形态） |
| `find-orphan-modules.mjs --gate` | 红，但 4 个「新增零消费方」**都不是我的**：`src/editorCodeBlock.ts`/`editorFillParts…`（`editorCodeBlock.ts`/`editorFillParagraph.ts`/`editorJoinComments.ts`，桶 5）与 `externalSystemDataStorage.ts`（桶 15）。我的 `src/inspectionIdentity.ts` 有 4 个生产消费方，未上榜 |
| `tests/module-size.test.mjs` | 4/5 通过；唯一红是 `src/components/SearchPanel.vue(903 行)`（桶 9，非我域）。我的新/改文件：`inspectionIdentity.ts` 152、`ProblemsPanel.vue` 727、`inspectionProfile.ts` 555、`problemsView.ts` 337，均 < 900 ⇒ 没调上限 |
| native | 本轮**没有**改 native（`relatedInformation` 只能动非我名下的 `lsp_support.cpp`）⇒ 无 ctest 数字要交；请求 R1 里注明了改后要跑 `.tools/nctest-all.bat` |

### 反向验证（新门禁全部先证「会红」再撤，playbook §6.4）

脚本方式：逐处故意破一处实现 → 跑对应判据 → 记录 fail 数 → 还原 → 复跑。

| # | 故意造的违规 | 期望 | 实测 |
|---|---|---|---|
| 1 | `src/problemsView.ts` 的 `groupLabel` 把 `inspection` 档退回裸键 | `tests/problem-identity.test.mjs` 红 | **RED ok (1)** |
| 2 | `src/inspectionProfile.ts` 的门控只看 `source`（丢掉候选键） | `tests/inspection-item.test.mjs` 红 | **RED ok (3)** |
| 3 | `src/problems.ts` 不带 `tags`（`tags: item.tags` 删掉） | `tests/inspection-item.test.mjs`（消费链路锚点）红 | **RED ok (1)** |
| 4 | `ProblemsPanel.vue` 下拉的 `value="inspection"` 改掉 | 同上判据红 | **RED ok (1)** |
| 还原后 | 四个文件全量复跑 | 全绿 | **GREEN**（`problem-identity` + `inspection-item` + `problems-view` + `inspection-profile`） |

另外 §0 那条既有红是「先复现再修」：修前 `ℹ fail 1`、修后 `pass 5 / fail 0`。

---

## 5. 做不到 / 无法核实（逐条给具体卡点，不写「太复杂」）

1. **一条问题的相关位置（`relatedInformation`）—— 做不到（差一次透传）**。上游 `LspDiagnosticAndLazyQuickFixes.kt:42` 原样保留该字段；本仓 `native/lsp_support.cpp:127-150` 的 `shape_diagnostics` 把它丢了。改那个文件不在我的归属（我只有 `native/diagnostics.cpp`，那个文件是崩溃日志/排障信息，不是诊断折形）⇒ `wiring-requests…#R1`。数据到位后我这边三行就能落（`ProblemRow.related` + 行菜单一节），现在做只能是永远空列表。
2. **Project Problems 的成员级关联问题（`BrokenUsage`/`RelatedProblem`）—— 做不到**。它要「按成员的用法索引」（`MemberUsageCollector`/`ProblemSearcher`），本仓的索引面只有 `workspace/diagnostic` 的整工程诊断与按文件的 `file.usages`，没有「某个成员被谁引用」的通道。这一条不是架构改写能补的，缺的是后端。
3. **可配置的 severity→颜色 —— 做不到**。色值必须走 `src/tokens.css`（保留文件）与 `src/highlightLevels.ts` 的样式类；没有一个可持久化的「用户改颜色」通道（`src/settingsModel.ts` 也是保留文件）。级别覆盖（`level=`）那一半已经做到检查项粒度并可用（判据 §1 `lp/inspections` 行）。
4. **检查器富文档（`InspectionDescriptionDocumentationProvider`）—— 做不到（与 1 同一根因）**：上游读插件自带 HTML；本仓唯一可能来源是 LSP 的 `codeDescription.href`，同样被 `shape_diagnostics` 丢掉。已在 R1 里合并请求。
5. **`InspectionToolRegistrar` 的扩展点注册面 —— 有意不做**：本仓规则由语言服务跑，宿主没有「注册工具→daemon 执行」的环；能承接的注册面是注解层（`src/annotatorRegistry.ts`，前一轮已落且有生产消费方）。造一张空注册表就是假控件。
6. **`CreateService*Dialog`/`MoveClassToModuleFix` 一类 Swing/模块模型对话框**：机械信号降级，没有 PSI/模块模型，**无法核实**其用户可见形状的上游坐标（不在我域，留原判词）。
7. **无法核实（本 checkout 里三条路都搜过：按文件名 + 按包路径 + 按语义/XML id）**：
   - 问题视图组头的「静音/停用整组」动作 —— 搜 `ProblemGroupHeader`、`SilenceFixAction`、`StopInspectionAction`、`stopInspectionOnProject`：只在 `platform/jewel/ui/metalava/ui-api-*.txt` 里命中过名字，`platform/problemsView`、`platform/analysis-api`、`platform/analysis-impl` 三处源码里都没有实现，`platform/**/*.properties` 里也搜不到 `silence` 字样 ⇒ 组头那颗「停用此检查项」我是**按 profile 的既有粒度**（`InspectionProfileImpl.java:804`）落地的，不是照抄某个上游按钮。若主代理要求逐按钮对齐，需要先找到那份源码。
   - `ExternalSourceProblemGroup` 的**生产者**：接口与读取点都在（`ExternalSourceProblemGroup.kt:13-18`、`HighlightInfo.java:477-481`），但全树 grep 不到谁 `new` 它 ⇒ 「外部检查名到底从 `Diagnostic.source` 还是 `code` 取」指不到源码那一行，我的折法（两级都留、具体赢宽泛）已在 `src/inspectionIdentity.ts:100-122` 注明是**本仓等价物**而非逐行复刻。
   - `RainbowHighlighter`：只按文件名粗搜过一次（未走三条路），**判词原文的降级理由（宿主冻结）成立**，功能面本身这轮没核实 ⇒ 标「无法核实」。
8. **`.ipr` 导入导出 —— 有意不做**：`InspectionProfileImporter.java:16-18` 只有 `xml`；`.ipr` 是 JPS 工程文件格式，判词那句属过期说法（本轮已订正留痕）。
