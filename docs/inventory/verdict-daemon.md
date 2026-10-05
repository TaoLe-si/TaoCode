# 判决：`daemon`

> 本文件由 `python scripts/verdict_table.py daemon` **生成**，不要手改：
> 族判词在脚本的 `FAMILIES` / `PLATFORM_FAMILIES` 表里（逐族读过源码给的），逐类表在 `docs/inventory/<域>_verdict_table.md`，
> 门禁 `tests/verdict-generated.test.mjs` 读同名 `.json`。

方法（与 B1–B7 同一口径，只是规模不同：本域 2243 类没法逐条手抄）：

1. **族级判词**：类按包归族（`RULES`），每族一条判词，写清用户可见行为在本仓落在哪个文件、缺什么；
   判词里引用的本仓路径由门禁逐个核对**真实存在**。
2. **逐类覆盖**：族档位落到族内每个类，再叠两类机械修正 ——
   ① `OVERRIDES` 的逐类例外（族整体一个档、个别类本仓真做了）；
   ② **Swing 降级**：族判 `[~]` 但类本身是 Swing 组件本体（`JComponent`/`paintComponent`/`JBPopup`/`JList`…）的判 `[-]`。
3. 机械信号由 `scripts/verdict_signals.py` 产出（行数 / Swing / 平台专属 / 在 TaoCode 里出现过没有），每行的档位都能复算。

## daemon（659 类）

| 档 | 类数 |
|---|---:|
| `[x]` | 1 |
| `[~]` | 349 |
| `[ ]` | 0 |
| `[-]` | 309 |
| 合计 | 659 |

| 族 | 档 | 判词（本仓落点 / 缺什么） | 类数 |
|---|---|---|---:|
| `dm/misc` | `[-]` | daemon 的其余内部管线（`DaemonProgressIndicator`/`DaemonCodeAnalyzerSettings` 的内部件/`PsiModificationTracker` 挂钩）。没有 PSI/索引模型可移植；用户可见面（诊断的收集与过滤、快速修复、问题面板、逐文件级别与检查配置）都在上面的族里有落点，本族落表行没有任何一类被本仓实现 | 291 |
| `dm/quickfix` | `[~]` | 意图与快速修复（`ShowIntentionsPass`/`IntentionAction`/`QuickFixAction`/`SuppressIntentionAction`）。本仓：Alt+Enter 列语言服务的 `textDocument/codeAction`（`src/semanticActions.ts` 的 `openCodeActions`，`onlyFixes` 档只留带 `isPreferred`/诊断回链的修复），`applyCodeAction` 走 edits → `codeAction/resolve` → `executeCommand` 三段；批量 Code Cleanup 在 `fixAllInFile` —— 先问服务器有没有文件级 `source.fixAll`/`source.fixAll.*` 动作（`applyFileLevelCleanup`，如 eslint --fix），没有才落逐条无歧义的 preferred 修复（25 轮上限），入口在 `src/components/ProblemsPanel.vue`。本轮把本地抑制做成**可应用链路**：规则在 `src/suppressIntention.ts`（按语言生成 `//noinspection`/@SuppressWarnings/eslint-disable/noqa/NOLINT 等插入文本与位置），可应用编辑在 `src/localIntentions.ts`（`suppressionActionsFor` 合成 LSP 载荷、跳过已抑制的位置），两个真实消费点：① Alt+Enter 列表（LSP 条目 + 本地条目合流，受 `src/intentionSettings.ts` 的启用/停用开关管）；② 问题面板逐行「操作 ▾」菜单 —— 「抑制此检查」按 `suppressionEditFor` 把注释写进文件（`file.read` → `applyTextEdits` → `file.write` 的 CAS 写），随后 `src/localSuppressions.ts` 在下一次 LSP 重发布前先隐去该行、并 `lsp.change` 触发重算，判据 `tests/problems-panel-actions.test.mjs`/`tests/local-suppressions.test.mjs`。**意图预览**：`src/intentionPreview.ts` 按编辑算 before/after 与「+N/-M 行」摘要（对照上游 `IntentionPreviewInfoDiff`），面板行菜单里抑制条目与服务端快速修复都先显示将改哪几行，判据 `tests/intention-preview.test.mjs`。**意图开关**：`src/intentionSettings.ts` 的清单逐条启用/停用 + 总开关（上游 `IntentionManager` 的用户面），面板「意图…」弹层编辑，判据 `tests/intention-settings.test.mjs`。本族多数类（java/java-impl 与 java-analysis-impl 的 `AddTypeCastFix`/`AddTypeArgumentsFix`/`CreateFromUsage*`/`StaticImportMemberQuestionAction` 等 220 余个）是 Java PSI 上的语法改写，没有 PSI 层不可移植 —— 语言服务把其中一部分（自动导入、类型修正）以 codeAction 形式给出，本仓按服务器给什么列什么；`CreateService*Dialog`/`MoveClassToModuleFix` 一类 Swing/模块模型对话框随机械信号降级。缺：Alt+Enter 弹层内的**编辑器内嵌预览层**（上游把 before/after 画进编辑器；本仓弹层渲染在禁改文件 `src/App.vue:2704-2705`，行里只有标题与 kind 两列，预览只能落在问题面板行菜单，差异如实记）、`ShowIntentionsPass` 的按 pass 收集/排序与 `IntentionMenuContributor`/`IntentionsUI` 的扩展点面 | 240 |
| `dm/problems-view` | `[~]` | 问题视图与导航（`ProblemsView`/`NextErrorAction`/`ErrorStripe` 及 `daemon/problems` 的 Project Problems）。本仓：底部「问题」面板 `src/components/ProblemsPanel.vue`（严重度过滤/文本过滤/按文件·目录·**来源（检查器）**分组/逐文件忽略/批量修复/**导出 HTML 报告**/逐行「操作 ▾」菜单），纯规则在 `src/problemsView.ts`（`groupProblems` 的 `source` 档按检查器分组，空来源单列「（无来源）」组，判据 `tests/problems-view.test.mjs`），数据源 `src/problems.ts`（LSP + 本地诊断，过 `src/analysisIgnore.ts`、逐文件高亮级别与检查配置三道门控）；F2 跳下一个错误在 `src/gotoNextError.ts`（按严重度分层、前进/后退环绕、「光标处的错误不算 here」，判据 `tests/goto-next-error.test.mjs`）；错误条 = 设置项 `showErrorStripe` + `src/editorDiagnosticMarkers.ts`；整工程检查的结果并进同一张表（`src/workspaceInspection.ts`）。本轮补两项：① **逐文件高亮级别**（`HighlightingSettingsPerFile` 的 None/Syntax/Inspections 三档）在 `src/highlightSettingsPerFile.ts`，聚合门控在 `src/problems.ts`，编辑面是行菜单的级别三项 + 工具栏「高亮级别…」清单（判据 `tests/highlight-settings-per-file.test.mjs`）；② 面板视图状态**跨任务持久化**（分组方式/严重度/文本过滤三格，`src/problemsPanelState.ts` + 面板挂载读回，判据 `tests/problems-panel-state.test.mjs`）。本族大量类（java-analysis-impl 的 `DefaultJavaErrorFixProvider`/`HighlightFixUtil`/`JavaGenericsUtil` 与 xml-analysis-impl 的 `XmlHighlightVisitor` 等）是 Java/XML 的 PSI 报错与修复提供者，没有 PSI 不可移植；`daemon/problems` 的 Project Problems（`ProblemSearcher`/`MemberUsageCollector`）是索引上的成员使用搜索，本仓以 `workspace/diagnostic` 的整工程诊断替代。缺：高亮级别的 `syntax` 档按 LSP severity 1 近似（本仓没有 PSI「语法错误 vs 类型错误」的分类，比上游 SYNTAX 略宽）、问题树的展开态没有可持久化对象（本仓是扁平列表，只持久化三格取向）、Project Problems 的成员级关联问题（`BrokenUsage`/`RelatedProblem`） | 98 |
| `dm/highlight` | `[~]` | 高亮/检查的驱动与结果模型（`DaemonCodeAnalyzerImpl`/`HighlightVisitor`/`HighlightInfo`/`UpdateHighlightersUtil`）。本仓：检查整体走 **LSP 诊断** —— push 的 `publishDiagnostics` 与 pull 的 `textDocument/diagnostic` 都收进 `src/bridge.ts` 的 `lspDiagnostics`（pull 文件表 `pullManagedFiles`），聚合进 `src/problems.ts`（状态栏计数、问题面板、错误条同一数据源），编辑器标记在 `src/editorDiagnosticMarkers.ts`，严重度/计数模型在 `src/highlightLevels.ts`（`HighlightDisplayLevel`/`HighlightSeverity` 的本仓四档）。本轮把 `HighlightInfoFilter`/`ProblemHighlightFilter` 一类的**过滤面**做成可配等价物：逐文件高亮级别（`HighlightingSettingsPerFile` 的 None/Syntax/Inspections，`src/highlightSettingsPerFile.ts`）与逐检查器启用/严重度覆盖（`InspectionProfile`，`src/inspectionProfile.ts`），两者都在 `src/problems.ts` 聚合前生效，编辑面在 `src/components/ProblemsPanel.vue`，判据 `tests/highlight-settings-per-file.test.mjs`/`tests/inspection-profile.test.mjs`；编辑期的诊断平移/裁剪（`UpdateHighlightersUtil` 的增量重算对应物）在 `src/lspHighlightingCache.ts`（按 pending edit 平移/裁剪写回，服务端下一次推送覆盖，判据 `tests/lsp-highlighting-cache.test.mjs`）。缺：`HighlightInfo` 那套可叠加的富信息（同一区间叠加多条 info、description/tooltip、inlay/意图灯泡挂点、按 visiting 顺序的分趟）—— LSP 诊断在 `native/lsp_support.cpp:127-145` 的 `shape_diagnostics` 就被裁成 `{line,character,message,severity,end*,source}`，`code`/`tags`（Unnecessary/Deprecated）/`relatedInformation` 不透传，而 `LspDiagnostic` 类型在禁改文件 `src/bridge.ts:109`，富信息留在语言服务侧、宿主呈现不了；`UpdateHighlightersUtil` 的整体重算与 `BackgroundUpdateHighlightersUtil` 的后台更新也无对应物（每次推送整段替换） | 24 |
| `dm/annotator` | `[~]` | 语法/外部注解器与高亮分趟（`Annotator`/`ExternalAnnotator`/`AnnotatorRunner`/`GeneralHighlightingPass`）。本仓：注解来源 = 语言服务诊断（push/pull 都进 `src/bridge.ts` 的 `lspDiagnostics`）**加**本地检查通道（`src/junitInspections.ts` 的 `localDiagnostics` —— 本地注解器的等价物：纯文本规则直接产诊断，同 `ExternalAnnotator` 的「外部结果进 daemon」形态），producer 侧在 `src/problems.ts` 合流，编辑器标记在 `src/editorDiagnosticMarkers.ts`；打开/编辑时的重算时机在 `src/lspNavigation.ts`，分趟调度只有 `src/highlightPasses.ts` 的轻量注册表（`TextEditorHighlightingPassRegistrar` 的兼容子集，判据 `tests/highlight-passes.test.mjs`）。缺：注解器扩展点（`Annotator`/`ExternalAnnotator` EP 与 `AnnotatorRunner` 的按文件分派 —— 本仓没有插件贡献点宿主与本地 PSI 遍历，本地通道只有内建生产者 `src/junitInspections.ts`，没有第三方注册面）、`GeneralHighlightingPass` 的分趟/增量调度（本仓每次编辑发一次请求，分趟由服务器内部决定，宿主持有不了那些 pass 对象） | 4 |
| `dm/inspections` | `[~]` | 检查规则与配置文件模型（`LocalInspectionTool`/`InspectionProfile`/`InspectionManager`/`InspectionToolRegistrar`）。本仓：规则全部来自语言服务（JDT/TS 各自的诊断经 `src/bridge.ts` 进 `src/problems.ts`），整工程批处理走 `workspace/diagnostic`（`src/workspaceDiagnostics.ts` + `src/workspaceInspection.ts`，分析菜单「检查代码…」在 `src/menus/analyzeMenu.ts`），本地规则只有纯文本通道 `src/junitInspections.ts`。本轮补**本地检查配置文件的有界子集**：`src/inspectionProfile.ts` —— 按诊断 `source` 逐检查器启用/停用 + 严重度覆盖（`applyInspectionProfile`），聚合门控在 `src/problems.ts`（停用不落表、覆盖改级别），编辑面是问题面板工具栏「检查配置…」（`src/components/ProblemsPanel.vue`：逐检查器复选 + 严重度下拉 + 恢复），持久化 `localStorage`，判据 `tests/inspection-profile.test.mjs`。本族的两个上游类仍无对应物：`InspectionProfileConvertor` 迁移旧 profile 格式（本仓没有旧格式可迁、也没有本地 inspection 引擎）、`InspectionProfilerDataHolder` 记逐工具耗时（没有本地工具在跑，没有耗时可记）。缺：profile 的导入/导出（`.xml`/`.ipr`）、按工程的多 profile 与状态栏 profile 切换器、`InspectionToolRegistrar` 的扩展点注册面（规则由服务器注册，宿主没有注册面） | 2 |

## 合计

`[x]` 1 + `[~]` 349 + `[ ]` 0 + `[-]` 309 = **659**
（`execution` 1608 + `xdebugger` 635）

**已知缺口（族判词里逐条写着，这里点名最要紧的几条）**：

- 运行/调试本仓是「通用表单 + 实例模型 + DAP」：**没有** per-type 配置编辑器、模板与共享配置、多运行目标；
- 测试侧：断言视图（`src/assertionView.ts`）与结构化事件通道（`smRunner` 等价物，`src/testEventChannel.ts`，判 `[~]`）已落地；JUnit 检查规则做了纯文本子集（`src/junitInspections.ts`，判 `[~]`）；覆盖率做了报告侧子集（`src/coverageReport.ts` 读 JaCoCo/Kover XML，判 `[~]`），采集通道仍缺（见 `exec/coverage` 判词）；
- 调试侧本轮补上行内值（`src/debugInlineValues.ts` + 复用 `debugLineExtension` 的 `inlineValuesField`）、多行求值对话框与历史面板、监视持久化、断点的命中次数/日志入口与临时/依赖/静音/全清、最近附加目标、`ShowExecutionPoint`/`EvaluateInConsole`；仍缺逻辑断点组（断点写入口过 `src/App.vue`，本轮冻结）、悬停快速求值、附加进程列表（宿主无进程枚举通道）、Smart Step Into/强制单步（`src/bridge.ts` 冻结，Method union 里没有 `stepInTargets`）；
- `[-]` 的两大来源：JVM 内部管线（`ProcessHandler`/`ExecutionUtil`/`RunProfileStarter`）与 Swing 组件本体。
