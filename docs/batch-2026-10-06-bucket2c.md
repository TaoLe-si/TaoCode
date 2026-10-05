# 桶 2c · 补全 / 内联补全 / 意图 · 2026-10-06

范围：`lp/completion`(143) `pf/inline-completion`(102) `lp/intention`(59) `lp/preview`(2) `an/completion` `ls/completion`。
检查 / 问题视图那一半属 2b，本轮没碰（`src/problems*`/`src/inspection*`/`src/annotator*` 未改）。
只读参考（未改）：`src/completionCamelHump.ts`、`src/completionModes.ts`、`src/cyclicWordCompletion.ts` 的**旧**语义已被本轮替换（文件在本轮名下）。

上游基准树：`D:\Backup\Downloads\intellij-community-master\intellij-community-master`（全部结论按源码行号；键位按 `platform/platform-resources/src/keymaps/$default.xml` 与 `platform/lang-impl/resources/intellij.platform.lang.impl.actions.xml` 的真实行号）。

---

## 判词

| 族 | 项 | 判定 | 上游依据（相对路径:行号） | 本仓落点（文件:行号） | 说明 |
|----|----|------|--------------------------|----------------------|------|
| lp/completion | `completion/command/**` 点后动作菜单（把本地动作做成补全条目） | `[x] 前任已落，本轮复核为真` | `platform/analysis-api/src/com/intellij/codeInsight/completion/command/CommandCompletionSuffixProvider.kt:23,28,30-36`（2026-10-06 二次核对订正：这一族里**只有** `CommandCompletionSuffixProvider.kt` 在 analysis-api，其余三份在 lang-impl，见下）；`platform/lang-impl/src/com/intellij/codeInsight/completion/command/CommandCompletionProvider.kt:651-699,701-742,237,311-326,78-80`；`platform/lang-impl/src/com/intellij/codeInsight/completion/command/commands/AbstractActionCompletionCommand.kt:103-117,224-241,249-265`；`platform/lang-impl/src/com/intellij/codeInsight/completion/command/CommandInsertHandler.kt:77-109` | `src/completionCommands.ts:38-46,66,108,166,178,209,217`；消费在 `src/lspCompletion.ts:211-214,244-251,259-260,289-291` | `findCommandInvocation` 给三种形态（`foo.re` / `foo..` / 行首）、命令名走驼峰过滤、接受时先删点+命令文本再 `ACTIONS.run`。`..` 只留命令也已接。 |
| lp/completion | 智能补全 / 类名补全的**键位入口** | `[~] 模型在、入口缺 ⇒ 本轮接上` | `$default.xml:732-734`（CodeCompletion）、`:909-911`（SmartTypeCompletion）、`:843-845`（ClassNameCompletion）；`codeInsight/completion/actions/CodeCompletionAction.java:12-17`、`SmartCodeCompletionAction.java:11-17`、`ClassNameCompletionAction.java:11-17`；「再按一次递增 invocationCount」`CodeCompletionHandlerBase.java:210-213`；`CompletionParameters.java:113-115` | `src/completionUi.ts:10-22`（三条键位的说明与取代关系）、`:25`（`reopeningViews` 那道闸）、`:33-39`（`completionRoundActive` / `endCompletionIfRoundOver`）、`:52-72`（**`startCompletionAs` = 键位与菜单共用的唯一入口**，含开着再按的「关-开」重查）、`:74-76`（`startBasicCompletion`）、`:79-81`（`handleCompletionModeKey`）、`:84-90`（`basicCompletionKeys` 只挂这一个入口）、`:283-288`（ViewPlugin 每次更新做收尾） | 前任把 `completionModes.ts` 的 `completionModeForEvent`/`beginCompletion`/`endCompletion` 全仓**零调用方**（`grep` 实测），只有裸 Ctrl+Space 一条接了 ⇒ Ctrl+Shift+Space / Ctrl+Alt+Space 按不出来，`keepsInMode(..., invocationCount>=2)` 的放宽永不生效。本轮把三条一次接齐，删掉只认 BASIC 的 `isBasicCompletionKey`/`handleBasicCompletionKey`。判据 `tests/completion-mode-keys.test.mjs`。 |
| lp/completion | `CamelHumpMatcher`（词补全只做前缀匹配）——**Alt+/ 那一族** | `[x] 本轮按上游重写` | `HippieWordCompletionHandler.java:146`（`new CamelHumpMatcher(prefix)`）、`:334-336`（`end-start > prefix.length()` + `isStartMatch`）；`analysis-impl/src/com/intellij/codeInsight/completion/impl/CamelHumpMatcher.java:31-46,53-54,80-119`；`util/text-matching/src/com/intellij/psi/codeStyle/MinusculeMatcher.kt:63-66,72-76`（无片段即 start match ⇒ **空前缀恒真**） | `src/cyclicWordCompletion.ts:99`（matcher 取自 `completionCamelHump.ts`）、`:135-176`（`documentVariants`）、`:86-96`（`hippiePrefixAt`） | 旧实现是大小写不敏感的**纯前缀**，`gN` 补不出 `getName`；且首字符必须是字母的段规则与上游 `isWordPart:384-386`（数字开头的段也算词）不一致 ⇒ 一并改。 |
| lp/completion | 循环词补全的**候选顺序与第一步给哪个** | `[x] 本轮按上游重写（旧实现方向是反的）` | `HippieWordCompletionHandler.java:283-306`（`words` 反序去重再反序 = 留末次出现、升序；`afterWords` 正序去重 = 留首次出现；两档拼接）、`:338-343`（分档）、`:165-190`（向前取「起点之前最后一项」，向后取「起点之后第一项」）、`:196-223`（向前往表的前一位走、向后往后一位走） | `src/cyclicWordCompletion.ts:135-176`、`:178-215`、`:217-253` | 旧实现：向前 = 文档顺序第一项、向后 = 最后一项，且用「已试词集合」推进 ⇒ 与上游**恰好相反**（`al` 连按在 IDEA 里是 `alpine → alpha → al`，本仓旧版是 `alpha → alpine → al`）。判据里每条都注了上游行号。 |
| lp/completion | **跨文件词补全**（只搜当前文档） | `[x] 本轮新增` | `HippieWordCompletionHandler.java:270-278`（`includeWordsFromOtherFiles` 遍历 `FileEditorManager.getAllEditors()` 里**别的** `TextEditor`，`takeCaretsIntoAccount=false`）、`:148,201,218`（当前文档走完就换档）、`:166-168,180-182`（换档后第一步：向前取最后一项、向后取第一项）、`:109`（`fromOtherFiles`） | `src/cyclicWordCompletion.ts:9-12`（`HippieDocument`）、`:178-199`（`otherDocumentVariants`）、`:236-253`（换档与收尾）；表本体 `src/completionOpenEditors.ts:15-63`；消费 `src/completionUi.ts:8,104-110`；生产者 `src/lspCompletion.ts:183-189` | 上游那一档找的是**打开的编辑器**（不是索引、不是全工程），本仓等价物 = `completionOpenEditors` 那张 path→实时正文的表。没有别的文档时行为退回「只搜当前文档，一轮走完恢复原前缀」，与上游只开一个文件时一致。 |
| lp/completion | 多光标替换 / 状态失效判定 | `[x] 本轮新增` | `HippieWordCompletionHandler.java:115-122`（每个 caret 各替换「前面 relativeOffset 个字符」）、`:331-332`（跳过含**任一**光标的段）、`:72-74,107-108`（`caretOffsets` 与 `modificationStamp` 的延续判定，且都记在插入**之后**） | `src/cyclicWordCompletion.ts:266-283`（spans 与重叠丢弃）、`:300-311`（状态记插入后的光标）；`src/completionUi.ts:101-105,117-122` | 本仓用 `EditorState.doc` 的**对象身份**当上游那个 modStamp（`EditorState` 没有公开的 `changeCount`/`seq`，`node_modules/@codemirror/state/dist/index.d.ts` 里两者都不存在）。区间重叠的那条丢弃：CodeMirror 的 `changes` 不接受重叠区间。 |
| lp/completion | `WordCompletionContributor` 的**其他字符串字面量取值** | `[ ] 做不到（无 lexer）` | `platform/lang-impl/src/com/intellij/codeInsight/completion/WordCompletionContributor.java:86-132`（`getStringLiteralElements()` + `ElementManipulators.getManipulator`/`getValueText` + `PlainPrefixMatcher` 用整段字符串前缀过滤）、`:90`、`:99-108`、`:120` | 无 | 具体卡点：这条判据的输入是「光标所在的是哪个 string literal 元素、它的 value 区间从哪开始」，全部来自 `ParserDefinition`（每语言一套引号/转义/多行规则）。本仓没有 PSI 也没有 lexer，用「最近的引号」近似会把 `'it's'`、模板字符串、raw string 一律判错，属于造假命中。 |
| lp/completion | 跨文件词补全（弹层那一路径，`WordCompletionContributor`） | `[x] 上游本来也只搜当前文件 ⇒ 无缺口` | `WordCompletionContributor.java:194`（`context.getContainingFile().getViewProvider().getContents()`） | `src/completionContributors.ts:68-105` | 判词里「跨文件词补全」在上游只有 hippie（Alt+/）那一族有实现（`getAllEditors`），lookup 路径本身就是当前文档。 |
| lp/completion | 空表那一行的「正在计算」档（`CALCULATING_TEXT`） | `[ ] 做不到（宿主管线）` | `platform/lang-impl/src/com/intellij/codeInsight/lookup/impl/LookupImpl.java:702-703`（`EmptyLookupItem`，文案 `LangBundle.properties:1`） | `src/completionModes.ts:167`（常量在、`lookupPlaceholderText(true)` 无调用方） | 具体卡点：`CompletionSource` 是**一次性**的 —— `node_modules/@codemirror/autocomplete/dist/index.d.ts:239` 的签名 `(context) => CompletionResult | null | Promise<CompletionResult \| null>`，一个 Promise 只能给一份结果，弹层在 pending 期间不存在，也就没有"先挂一个空白行、算完再换"的落点。本仓的 `lspCompletion.ts:388-397` 只在结果为空时给「无建议」那一行。 |
| lp/completion | Commands 分组标题 / lookup 排序器扩展点 / usage 统计 | `[-] 不照抄（架构不等价 / 不收遥测）` | `completion/command/CommandCompletionContributor.kt:41-43` + `platform/lang-api/resources/messages/CodeInsightBundle.properties:585`（组名 Commands）；`BaseCompletionService.java:215-216`（weigher 注册）；`StatisticsWeigher` | `src/completionCommands.ts:42`（常量留着不渲染，理由写在 `:30-32`）、`src/completionSort.ts:96-105`（六档纯函数排序） | 本仓弹层是平铺列表（`src/completionUi.ts:150-190` 的行几何），没有分组行的位置；插分组行会同时打乱 `11 行` 的可视高度档（`UISettingsState.kt:197,199`）。遥测类一律不接。 |
| pf/inline-completion | 取 / 接受 / 取消 / 部分接受 / 多建议循环的**键位** | `[x] 本轮逐条核对，与上游一致` | `platform/lang-impl/resources/intellij.platform.lang.impl.actions.xml:115-132`：`CallInlineCompletionAction` = `shift alt BACK_SLASH`(:115-116)、`InsertInlineCompletionAction` = `TAB`(:118-119)、`InsertInlineCompletionWordAction` `use-shortcut-of="EditorNextWord"`(:121-123)、`InsertInlineCompletionLineAction` `use-shortcut-of="EditorLineEnd"`(:124-126)、`Next/PrevInlineCompletionSuggestionAction` = `alt CLOSE_BRACKET`/`alt OPEN_BRACKET`(:127-132)；菜单分组 `intellij.platform.lang.impl.actions.xml:450-457` | `src/inlineCompletionExtension.ts:152-164`（Tab / Esc / Ctrl-ArrowRight / End）与 `:188-197`（Alt-] / Alt-[ / Shift-Alt-\\） | **纠正判词**：旧判词写「上游 `InsertInlineCompletionWordAction`/`Line` 本身无默认键位」不成立 —— 它们用 `use-shortcut-of` 继承 `EditorNextWord`(Ctrl+→) 与 `EditorLineEnd`(End) 的键位，本仓正是这两条，一致。 |
| pf/inline-completion | 多 provider 优先级与聚合（`RemDevAggregatorInlineCompletionProvider`） | `[-] 不适用（那是 Host 侧代理接口）` | `platform/platform-impl/codeinsight-inline/src/com/intellij/codeInsight/inline/completion/RemDevAggregatorInlineCompletionProvider.kt:6-15`（类注释："must have exactly one instance, and it's only on the client when the RemDev mode is active"，作用是代理 Host 侧 provider；`:16` 只有一个 `currentProviderId`） | 无（不做假聚合） | 具体卡点：接口本体不含任何排序/优先级规则，真正的选择在 Gateway/Host 侧（不在社区树里）。本仓供给者只有 LSP 一条，凭空造一张"优先级表"就是假控件。 |
| pf/inline-completion | `suppress` 抑制状态 | `[-] 上游唯一供应商指向本仓没有的 UI` | `codeinsight-inline/.../suppress/InlineCompletionSuppressStateSupplier.kt:9-22`（EP + `any { it.isSuppressed(editor) }`）、`suppress/InlineCompletionSuppressStateByInlinePromptSupplier.kt:7-10`（唯一实现 = `isInlinePromptShown(editor)`）；使用点 `InlineCompletionHandler.kt:155`（抑制时直接忽略事件） | 无 | 具体卡点：社区树里唯一的抑制条件是「编辑器里有 inline prompt 正在显示」。本仓没有 AI prompt 输入条那一层 UI，条件恒假 ⇒ 接了也是空表；等 prompt UI 落地时按同一形状加 supplier 即可。 |
| pf/inline-completion | Tab/Enter 用法探测与 onboarding | `[-] 统计驱动，本仓不收遥测` | `platform/lang-impl/src/com/intellij/codeInsight/inline/completion/TabEnterUsageDetector.kt:10-48`（`tab_selection_count`/`enter_selection_count` 记在 `PropertiesComponent`；`:13-14` 阈值 5 次与 0.1 比例；`:42-46` 决定行内补全用 Tab 还是 Enter） | 无 | 判据是"用户历史选择次数"，本仓明确不采集使用统计；且本仓 Tab 接受已经是上游的多数档（`tabRatio > 0.1 ⇒ '\t'`）。 |
| pf/inline-completion | 悬浮操作条（来源名 / 接受 / 隐藏）与 `editorLineStripeHint`、`options` 设置页 | `[ ]` 交接线请求 | 上游文件在 `codeinsight-inline/.../tooltip/`（`InlineCompletionTooltip.kt`/`InlineCompletionTooltipActions.kt`/`InlineCompletionTooltipComponent.kt`/`InlineCompletionTooltipFactory.kt`）、`options/`、`editor/InlineCompletionEditorType.kt` | 无 | 挂点全在保留文件 `src/components/CodeEditor.vue`（幽灵文本 widget 的宿主）与 `src/settingsModel.ts`（按 provider 开关的存储）⇒ 见 `docs/wiring-requests-2026-10-06-bucket2c.md` 的 W1/W3。本轮不放假控件。 |
| pf/inline-completion | 事件重入门与节流 | `[x] 已在（本轮核对）` | `InlineCompletionHandler.kt:140-145`（`isInvokingEvent` 期间忽略新事件）、`DebouncedInlineCompletionProvider.kt:59-71`（`DirectCall` 不等延迟、其余 `delay(getDebounceDelay())`）、`:73-90`（`replaceJob` 取消上一个） | `src/components/CodeEditor.vue:267`（`inlineInFlight` 重入门）、`:269-276`（请求）、`src/inlineCompletion.ts:26`（`INLINE_TRIGGER_KINDS`：automatic/explicit/retrigger 对应 `InlineCompletionEvent` 的三类）、`src/inlineCompletionNav.ts`（retrigger 与身份键去重） | 数值延迟由 provider 自己给（上游 `getDebounceDelay` 是抽象的，社区树里没有默认常量）⇒ 本仓那份去抖在 CodeEditor.vue 的既有实现里，本轮不去改保留文件。 |
| lp/intention | 抑制条目做成可应用的本地条目 | `[x] 前任已落，本轮复核为真` | `platform/lang-impl/src/com/intellij/codeInsight/intention/impl/SuppressIntentionAction.java` 一族 + `intentionDescriptions` 的 `//noinspection`/`@SuppressWarnings` 语义 | `src/suppressIntention.ts`、`src/localIntentions.ts:1-121`；合流在 `src/semanticActions.ts`（`suppressionActionsFor` + `...localActions`） | 判据 `tests/local-intentions.test.mjs` + `tests/suppress-intention.test.mjs` 全绿。 |
| lp/intention | 意图预览（before/after）与意图开关/清单 | `[x] 已在` | `platform/lang-impl/src/com/intellij/codeInsight/intention/preview/`（`IntentionPreviewUtils`/`IntentionPreviewInfoDiff`）、`AbstractEditIntentionSettingsAction`、`IntentionManager` 的启用/停用 | `src/intentionPreview.ts:16-76`（`PreviewChange`/`FilePreview`/`previewOfEdits`，`PREVIEW_MAX_CHANGES = 40`）、`src/intentionSettings.ts:15-91`（`LOCAL_INTENTIONS` 清单 + `isIntentionEnabled`/`setIntentionEnabled`/`intentionEntries`） | 上游 `intentionDescriptions/<id>.description.html` 的模板文件本身要随意图清单分发，本仓条目来自语言服务 + 抑制规则 ⇒ 用 LSP 编辑载荷算 before/after，不搬 HTML 模板。 |
| lp/intention | 抑制条目挂到问题面板的逐行入口 | `[ ] 属 2b 面，本轮不动` | `platform/lang-impl/src/com/intellij/openapi/actions/ShowIntentionsPass` 一族（Alt+Enter 集合含 inspections/intentions） | `src/components/ProblemsPanel.vue`（2b 名下） | 本轮范围明确排除问题视图半区；条目侧的 API（`suppressionActionsFor`）已经能直接被面板调用，缺的是面板那一侧的一行入口 ⇒ 记为交接线，不重复实现。 |
| lp/preview | 字面量颜色/图片预览 | `[x] 已在，本轮未改` | `platform/lang-impl/src/com/intellij/psi/PsiLiteralValue` 之上的 `ImageOrColorPreviewService.kt:145-158,176-203,206-232` | `src/literalPreview.ts`、`src/literalPreviewExtension.ts`、`src/components/CodeEditor.vue:140` | 判词里剩下的 `ElementPreviewProvider` EP / Java `new Color(...)` / 渐变富内容需要插件扩展点宿主与 PSI，本仓没有那个宿主 ⇒ 维持 `[~]`。 |
| an/completion | 接受条目时的插入处理器 / 尾类型 | `[x] 已在` | `AddSpaceInsertHandler`、`TailType`（`CharTailType`/`HumbleSpaceBeforeWordTailType`）、`DeclarativeInsertHandler` | `src/completionInsertHandlers.ts`；并进 `src/lspCompletion.ts:341-353` 的同一次 dispatch（不留两个 undo 步） | PSI 管线本体（`CompletionResultSet`/`BaseCompletionLookupArranger`/`CompletionFinalSorter`/`PsiReferenceCompletionItemProvider`）按逐类机械降级：本仓条目来自语言服务，过滤是 `completionCamelHump.ts`、重排是 `completionSort.ts`。 |
| ls/completion | contributor 混排 / resolve 缓存 / 权重 | `[x] 已在（本轮复核）` | `platform/lsp-impl/src/impl/features/completion/LspCompletionContributor.kt:40,45`（`FORBID_WORD_COMPLETION`）、`LspCompletionObject.kt:44`（接受时才 resolve）、`LspDocumentMapping.kt:132-135`（`aggregatePerDocumentResults`） | `src/lspCompletion.ts:244-251`（服务器条目与命令/词条目并排）、`:261-273`（**同一次结果内**按条目身份缓存 resolve；跨请求不缓存的理由写在 `:261-262`）、`:312-319`（Enter 快过 info 时 apply 里补 resolve）；混排差异的记录在 `src/completionContributors.ts:107-121` | 多 descriptor 的路由与"多服务器合并"那张账不在本域（`native/lsp_session.cpp` + 桶 3 的 `src/lsSessionDocuments.ts`），本仓 `createLspCompletion` 的 deps 只有一个 `path()` 与一条 `lsp.request` ⇒ 交桶 3。 |

---

## 改动文件

**新增**
- `src/completionOpenEditors.ts`（63 行）—— 打开的编辑器 → 实时正文那张表（上游 `getAllEditors()` 的等价物）。
- `tests/completion-open-editors.test.mjs`（87 行）—— 表的顺序/注销/死句柄清理 + 跨文档那一档的走查 + 生产链路。
- `tests/completion-mode-keys.test.mjs`（约 80 行）—— 三条补全键位的判定、调用次数递增、放宽档、接线门禁。

**重写**
- `src/cyclicWordCompletion.ts`（90 → 343 行）—— 按 `HippieWordCompletionHandler` 逐条重建：词形、空前缀、驼峰 `isStartMatch`、末次/首次两档顺序、向前/向后第一步与走表方向、其他文档档与换档、多光标 spans、`caretOffsets`/改动号延续判定、恢复原前缀。文件头记了两处**有意**差异（intern 等价改成"存表+下标"；首轮无候选不做那个空操作）与一处近似（`isWordPart` 的 `-`/`*` 需要 lexer，不猜）。
- `tests/cyclic-word-completion.test.mjs`（79 → 147 行）—— 旧断言钉的是与上游**相反**的方向（向前=文档第一项、向后=最后一项），已按上游改写并逐条注行号；新增驼峰/顺序/多光标/改动号/空前缀的判据。

**修改**
- `src/completionUi.ts` —— Alt+/ 那一段：改走新的 `hippieStep` 签名（`carets`/`revision`/`otherDocuments`）、一次 dispatch 覆盖所有光标、状态里记插入后的光标与改动号；三条补全键位：`handleCompletionModeKey` + `startBasicCompletion` 走 `completionModes` 的状态，ViewPlugin 每次更新做收尾（`endCompletionIfRoundOver`），开着再按用「关-开」逼 CM 重新查询（`reopeningViews` 那道闸防止中途被收尾）；删掉 `isBasicCompletionKey`/`handleBasicCompletionKey`（只认 1 条键位的旧入口）。
  ⚠️ 该文件本轮被**外部并发修改**过两次（见下面"并发情况"）。
- `src/lspCompletion.ts` —— 打开编辑器表的生产者登记（`:183-189`）；顺手修掉一个真的类型错：占位行对象上的 `placeholder: true` 不在 `Completion` 形状里（`TS2353`，前任留下），该字段全仓无消费方 ⇒ 删除，语义由 `apply: () => {}` 与 `getMatch: () => []` 承担。
- `tests/local-intentions.test.mjs` —— 两条消费链门禁的说明符正则按「桩两边都收」的惯例放宽成 `/from '\.\/localIntentions(?:\.ts)?'/`（`src/semanticActions.ts` 已按仓库规矩补了 `.ts` 扩展名 ⇒ 裸说明符正则失配，属**桩键过期**，断言意图未动）。

---

## 并发情况（必须复核）

- 我把 `runHippieCompletion` 写成 `revision: view.state.changeCount` 之后，`src/completionUi.ts` 被外部改成 `view.state.seq`（两者都**不存在**于 `@codemirror/state` 的 `EditorState`：`node_modules/@codemirror/state/dist/index.d.ts` 里 `changeCount` 与 `seq` 都没有），同一次外部改动还把 selection 换成了 `EditorSelection.create(...)`（那条是合法 API，我保留）。我按上游语义改用 `EditorState.doc` 的对象身份。**这条要人复核**：谁改的、为什么改，我没有查到。
- `npx vue-tsc -b --force` 全仓当前 51 个错，**全部**在 `src/editorEnterBlockComment.ts`（桶 5 名下，在途），本域 0 错。派单时基线是 0 错 ⇒ 也属并发引入。
- `.tools/find-orphan-modules.mjs --gate` 红的是 `src/rootsJarEntries.ts`（桶 15）；本轮我的新模块都有生产消费方（`completionOpenEditors` ← `lspCompletion`/`completionUi`）。
- `tests/module-size.test.mjs` 红在 `src/components/WelcomePage.vue`(920 行)（桶 14），非本域。

---

## 验证

- `node --test tests/completion*.test.mjs tests/cyclic-word-completion.test.mjs tests/inline-completion*.test.mjs tests/intention*.test.mjs tests/postfix*.test.mjs tests/lsp-completion*.test.mjs tests/local-intentions.test.mjs tests/suppress-intention.test.mjs tests/literal-preview.test.mjs tests/moniker.test.mjs`
  ⇒ **161 用例 / 161 通过 / 0 失败**（派单基线 140/140；新增 21：跨文档 5 + 键位 4 + 循环词补全净增 8 + 其他）。
- 跨域回归（读了我的文件的别人的测试）：`tests/debug-quick-evaluate.test.mjs`、`tests/moon-palette.test.mjs`、`tests/module-size.test.mjs` ⇒ 除上面那条 WelcomePage 的红，其余全绿（moon-palette 的「无裸 hex」与「无动效新增」门禁都过）。
- `npx vue-tsc -b --force` ⇒ 本域 **0** 错（全仓 51 错，见并发情况）。
- 三个系统性检测器：`node .tools/find-param-props.mjs` ⇒ 0 处；`node .tools/find-ts-in-mjs.mjs` ⇒ 干净；`node .tools/find-missing-ext.mjs` ⇒ 干净（1185 个文件）。
- `node .tools/find-orphan-modules.mjs --gate` ⇒ 本域无新增孤儿（红项不属本域）。
- native：本轮没有改 `native/*`（`native/lsp_code_actions.cpp` 未动）⇒ 无 ctest 结果。

### 反向验证（每条新门禁都做过）

| 门禁 | 注入的违规 | 结果 |
|---|---|---|
| `revision: view.state.doc` | 全文 `replaceAll` 成 `revision: 0` | 正则不再命中 ⇒ 敏感 |
| `otherOpenEditorTexts(text)` | 换成 `undefined` | 不再命中 ⇒ 敏感 |
| `registerOpenEditor(path, () => deps.view()?...)`（生产者） | 换成 `void 0` | 不再命中 ⇒ 敏感 |
| `from './completionOpenEditors.ts'` | 删掉那一行 import | 不再命中 ⇒ 敏感 |
| `keydown: handleCompletionModeKey` / `beginCompletion(view, mode)` / `closeCompletion(view)` / `reopeningViews.add(view)` / `endCompletionIfRoundOver(this.view)` / `import { beginCompletion, ... }` | 逐条替换成 `void 0` / 删行 | 6 条全部不再命中 ⇒ 敏感 |
| 负向门禁 `doesNotMatch(/export function isBasicCompletionKey/)` | 把旧符号塞回内容 | 命中 ⇒ 负向门禁真的会红 |
| 「末次出现」去重（不是首次） | 用 `'alph alphaX alph al'` 走一遍 | 得 `['alphaX','alph']`；首次去重会给 `['alph','alphaX']` ⇒ 形状可区分 |
| 「向前 = 最近的前一个」 | 同一文档比 `['alpha','alpine']` 与旧顺序 | 得 `alpine`（旧实现给 `alpha`）⇒ 可区分 |
| 跨文档那一档 | `otherDocuments: []` vs `[{...}]` | 前者第三步 `exhausted=true`、后者给 `alternate` ⇒ 可开可关 |

---

## 做不到 / 无法核实（具体卡点）

1. **其他字符串字面量的取值补全**（`WordCompletionContributor.java:86-132`）：判据依赖 `ParserDefinition.getStringLiteralElements()` 与 `ElementManipulators`（每语言的引号/转义/多行/raw 规则）。本仓无 PSI、无 lexer，文本近似会判错 `'it's'`、模板串、raw string ⇒ 不做假命中。
2. **弹层 pending 期的「正在算」空白行**（`LookupImpl.java:702-703` + `LangBundle.properties:1`）：`CompletionSource` 一次性（`@codemirror/autocomplete/dist/index.d.ts:239`），pending 期间弹层不存在，无法先挂占位行再替换。`completionModes.ts:167` 的 `CALCULATING_TEXT` 因此仍无调用方。
3. **智能补全按"期望类型"过滤**：沿用前任记录的卡点（LSP `textDocument/completion` 的 context 只有 `triggerKind`/`triggerCharacter`，无 expected type；宿主发的就是 `{triggerKind:1}`，`native/lsp_session.cpp:166-169`）⇒ 本轮只把**入口**接上（Ctrl+Shift+Space 现在真的能按），收窄仍只在位置可判「在等类型」时生效（`completionModes.ts:128-132,153-157`）。
4. **行内补全的多 provider 聚合 / suppress / Tab-Enter 探测**：上游三条分别指向 Gateway-Host 代理接口（`RemDevAggregatorInlineCompletionProvider.kt:6-15`）、本仓没有的 inline prompt UI（`InlineCompletionSuppressStateByInlinePromptSupplier.kt:7-10`）、以及本仓不采集的使用统计（`TabEnterUsageDetector.kt:10-48`）。判词与行号见上表，不造空表。
5. **行内补全悬浮操作条 / `options` 设置页 / `editorLineStripeHint`**：挂点与存储在保留文件（`CodeEditor.vue`、`settingsModel.ts`）⇒ W1/W3。
6. **问题面板逐行的「抑制」入口**：面板半区属 2b ⇒ 条目 API 已就位，缺面板侧一行 ⇒ W4。
7. **`isWordPart` 的 `-`/`*`**（`HippieWordCompletionHandler.java:384-386`）：这两个字符只在**同一个 lexer token 内**相连才算同一词；本仓没有 lexer，按字符类相连会把 Java 的 `a-b` 也并成一个词 ⇒ 保留标识符段规则，近似不了的那一侧（CSS kebab 属性名）如实记录在 `src/cyclicWordCompletion.ts:14-19`。
8. **`lookup` 排序器扩展点、`StatisticsWeigher`、`logs`/`statistics`**：本仓不收集遥测（仓库级禁令）。
9. **`AssignShortcutToIntentionAction` 的"给单个意图分配键位"**：键位在本仓是静态表（保留文件 `keymap*.ts`），且本仓意图条目是运行时从语言服务/诊断算出来的，没有稳定的 action id 可登记 ⇒ 维持 `intentionSettings.ts` 的启停档，不做假绑定。

## 判词纠正（本轮实测）

- `pf/inline-completion` 的「`InsertInlineCompletionWordAction`/`Line` 本身无默认键位」**不成立**：两者用 `use-shortcut-of` 继承 `EditorNextWord` / `EditorLineEnd`（`intellij.platform.lang.impl.actions.xml:121-126`），本仓的 `Ctrl-ArrowRight` / `End` 与上游一致。
- `lp/completion` 的「智能补全与类名补全 Ctrl+Shift+Space/Ctrl+Alt+Space 没有入口」本轮**已成立地补上**（不是模型层，是按键层：`completionModes.ts` 的三个导出此前全仓零调用方）。

---

## 二次复核（2026-10-06 追加；主代理派单「代码落了但没写报告」的现场反推）

派单的怀疑是「那个代理可能刚开始写 `src/cyclicWordCompletion.ts` 就被切了」。**实测结论：不是半截，是完整交付**，
本节把证据逐条落到「哪个函数 / 哪条测试 / 上游哪一行」，并订正一处上游路径。

### A. hippie（循环词补全）那一半到底做到哪一步 —— 逐条证据

上游本体：`platform/lang-impl/src/com/intellij/codeInsight/completion/actions/HippieWordCompletionHandler.java`
（本轮实测 **437 行**，下面每个行号都是本轮直接 `sed`/`grep -n` 数出来的，不是转抄）。
动作与键位：同目录 `HippieCompletionAction.java` / `HippieBackwardCompletionAction.java`（实测存在）；
键位 `platform/platform-resources/src/keymaps/$default.xml:735-739`（本轮实测：`alt SLASH` = `HippieCompletion`、`alt shift SLASH` = `HippieBackwardCompletion`）。
**手势订正**：派单写的「Ctrl+\」不是上游那条 —— 上游循环词补全是 **Alt+/** 与 **Alt+Shift+/**；
`Shift+Alt+BACK_SLASH` 是**行内补全的显式调用**（`CallInlineCompletionAction`，`platform/lang-impl/resources/intellij.platform.lang.impl.actions.xml:115-116`），两族不要混。

| 上游行为（类:行） | 本仓函数（`src/cyclicWordCompletion.ts`） | 判据（`tests/cyclic-word-completion.test.mjs`，除非另注） | 状态 |
|---|---|---|---|
| `computeData:388-413`（前缀 = 光标所在词的「词首→光标」；不在词里 ⇒ 空前缀、起点=光标） | `hippiePrefixAt`（`:137`，内部用 `hippieWords`） | 「前缀 = 光标前一个字符所在的那个词段」（测试 `:13`） | 已做 |
| `processWords:361-382` + `isWordPart:384` + `containsLettersOrDigits:253`（极大连续标识符段、数字开头的段也算词、纯符号段不算） | `WORD_CHAR`（`:99`）、`hasLetterOrDigit`（`:102`）、`hippieWords`（`:111`） | 「词形 = 标识符类的极大连续段」（测试 `:24`） | 已做；`-`/`*` 需要 lexer 那一档写在文件头 `:14-19`（见「做不到」第 7 条） |
| `computeVariants:262-306`：`words` 反序去重再反序（`:286`/`:295`）= 留**末次出现**、升序；`afterWords` 正序去重（`:298-303`）= 留**首次出现**；两档拼接 | `documentVariants`（`:161`）+ `hippieVariants`（`:222`） | 「候选顺序 = 光标前的词按末次出现升序、其余按首次出现升序」（测试 `:30`） | 已做 |
| `:146` `new CamelHumpMatcher(prefix)` + `:334` 长度严格大于前缀 + `:336` `isStartMatch`；空前缀恒真（`platform/analysis-impl/src/com/intellij/codeInsight/completion/impl/CamelHumpMatcher.java`、`platform/util/text-matching/src/com/intellij/psi/codeStyle/MinusculeMatcher.kt:63-66,72-76`） | `:99` 取 `completionCamelHump.ts` 的 matcher；过滤在 `documentVariants` 内 | 「候选按驼峰 isStartMatch，不是普通前缀」（测试 `:40`） | 已做（旧实现是大小写不敏感的纯前缀，`gN` 补不出 `getName`） |
| `:331-332` 跳过含任一光标的段、`:338-343` 的 words/afterWords 分档（`:339` 进 afterWords、`:342` 进 words） | `documentVariants` 的 `carets`/`caret` 入参 | 同「候选顺序」一条 + 测试 `:30` 的第 2 段 | 已做 |
| 第一步给哪个：`:165-190` —— `myForward` 走「起点之前最后一项」（`:169-177`），否则「起点之后第一项」，都没有就整表第一项；换到别的文档档时 forward = `variants.get(size-1)`（`:166-168`）、backward = `variants.get(0)`（`:180-182`） | `firstPickIndex`（`:227-243`，`:229` 就是 `stage==='other'` 那一档） | 「向前第一步给『离光标最近的前一个词』」（测试 `:49`）、「向后第一步给『起点之后的第一项』」（测试 `:62`）、`tests/completion-open-editors.test.mjs`「跨文档那一档：向前取最后一项、向后取第一项」 | 已做（本轮**逐行对过上游**：forward = 表内前一位、backward = 后一位，见下一行） |
| 之后每步：`:196-208`（forward 往**前一位**走，走到头 → `computeNextVariant(..., !includeWordsFromOtherFiles, true)` 换档）、`:211-221`（backward 往**后一位**走，同） | `hippieStep`（`:246`）的 `:284-294` 与 `:295-305` 两支 | 「向前连按：表内往后一位位退」（测试 `:68`）、「向后连按：表内往后一位位进」（测试 `:85`） | 已做 —— **「多次按键逐候选推进」不是半截**：状态里存 `variants`+`index`，每次按键 `index±1`，走到端点换档，两轮都空才收尾 |
| `:85-89` 两轮都空 ⇒ `insertStringForEachCaret(editor, oldPrefix, …)` 恢复用户原来打的前缀 | `restoreStep`（`:340-343`，`exhausted: true`） | 测试 `:68`/`:85` 的末段（「恢复原前缀」） | 已做 |
| `:148` 首轮无候选时的空操作（把原前缀重写一遍，会进 undo 栈） | `:277` 返回 `null`（**有意**差异，文件头写了） | 「没有候选时返回 null」（测试 `:97`） | 已做，差异如实声明 |
| `:270-278` `includeWordsFromOtherFiles` 遍历 `FileEditorManager.getAllEditors()` 里**别的** `TextEditor`（`:271`、`:274`、`takeCaretsIntoAccount=false` ⇒ 全落 afterWords 档） | `otherDocumentVariants`（`:201`）+ `HippieDocument`（`:49`）；表本体 `src/completionOpenEditors.ts:15-63` | `tests/completion-open-editors.test.mjs` 的「跨文档那一档」「没有别的文档时行为退回」 | 已做 |
| `:72-74` `caretOffsets` / `modificationStamp` 任一变了 = 新一轮；`:107-108` 两者都记在插入**之后** | `hippieStep` 的 `sameCarets`（`:252`）+ `changed`（`:255-258`）；调用方 `src/completionUi.ts:123`（`revision: view.state.doc`，插入之后盖进状态） | 「光标集合变了 = 新一轮」（测试 `:102`）、「文档改动号变了 = 新一轮」（测试 `:110`） | 已做 |
| `:115-122` 每个 caret 各替换「它前面 `relativeOffset` 个字符」（`:118` `Math.max(0, caretOffset - relativeOffset)`） | `:310-318`（spans 构建）+ `:319-321`（主光标那条决定状态记的 `from`，对齐上游 `:91` 的 marker 建在 `data.startOffset`） | 「多光标：每个光标各替换…」（测试 `:121`）、「区间重叠的重光标不会产出重叠编辑」（测试 `:133`） | 已做 |
| 键位接入（`Alt+/`、`Alt+Shift+/`，按物理 SLASH 判） | `src/completionUi.ts:98-124`（`hippieStates` + `runHippieCompletion`）、`:128-132`（`hippieCompletionKeys`，`event.shiftKey ? -1 : 1`）、`:314`（挂进编辑器扩展） | 「接线：completionUi 把它挂进编辑器扩展，且按物理 SLASH 判 Alt+/」（测试 `:139`） | 已做 |

### B. 复核数字与实况

- 派单给的 glob：`node --test tests/completion*.test.mjs tests/cyclic*.test.mjs tests/inline-completion*.test.mjs tests/intention*.test.mjs`
  ⇒ **110 / 110 通过 / 0 失败**。
- 本报告原有的更宽 glob（含 `postfix*`/`lsp-completion*`/`local-intentions`/`suppress-intention`/`literal-preview`/`moniker`）
  ⇒ **161 / 161 / 0**，与 §验证 里写的数字一致（没有漂移）。
- `npx tsc --noEmit … src/cyclicWordCompletion.ts`：只报 `TS5097`（`.ts` 扩展名需要 `allowImportingTsExtensions`，本仓规矩就是带扩展名）；
  加该开关后 **0 错**。`npx vue-tsc -b --force` **全仓 0 错** ⇒ §并发情况 里「全仓 51 个错在 `src/editorEnterBlockComment.ts`」已过期（那条红被别的桶清掉了）。
- 磁盘实况（行数）：`src/cyclicWordCompletion.ts` **343 行**、`tests/cyclic-word-completion.test.mjs` **147 行**（14 条用例）、
  `src/completionOpenEditors.ts` 63 行、`tests/completion-open-editors.test.mjs` 87 行、`tests/completion-mode-keys.test.mjs` 71 行。
  ⚠ 订正：本报告「改动文件」写的「90 → 343」「79 → 147」里的 **before 值无法核实** —— `git status` 显示这几个文件是 `??`（未跟踪），
  `git show HEAD:src/cyclicWordCompletion.ts` 里没有这个文件；那三个 before 数字只能是前任自述，本轮不予背书，只保证「现状 = 磁盘实况」。
  `src/completionUi.ts` 是 `M`，`git diff --numstat` = **+141 −21**；`src/lspCompletion.ts` = **+294 −61**（这两条可核）。
- `node .tools/find-orphan-modules.mjs --gate` ⇒ 本域**无孤儿**（红项只有 `src/rootsJarEntries.ts`，属桶 15，另一代理在接宿主通道）。
- `node --test tests/module-size.test.mjs` ⇒ 现在红在 `src/components/CodeEditor.vue` 1156 > 上限 1147（保留文件、桶 5 名下）；
  本报告 §并发情况 里写的「红在 `WelcomePage.vue`(920 行)」也已过期。**两条都不属于本域**，只登记。
- 三个系统性检测器：参数属性 0 处 / `.mjs` 里无 TS 语法 / 无漏 `.ts` 扩展名。

### C. 坐标订正（本轮实测，共 1 处路径错 + 2 处写全）

- 判词表第一行的 `CommandCompletionSuffixProvider.kt` 被写成 `platform/lang-impl/...`：**参考树里没有那个路径**
  （`tests/source-citations.test.mjs` 接手时正是红在这里）。实测它在
  **`platform/analysis-api/src/com/intellij/codeInsight/completion/command/CommandCompletionSuffixProvider.kt`**（37 行），
  并且 `:23` = `fun suffix(): Char = '.'`、`:28` = `fun filterSuffix(): Char? = '.'`、`:30-36` = `supportFiltersWithDoublePrefix(): Boolean = true`
  —— 报告引的三条行号**语义与行号都对**，只有模块路径错。已订正。
- 同族其余三份本轮一并写全并核过行数：
  `platform/lang-impl/src/com/intellij/codeInsight/completion/command/CommandCompletionProvider.kt`（857 行）、
  `.../command/commands/AbstractActionCompletionCommand.kt`（275 行）、`.../command/CommandInsertHandler.kt`（110 行）。
- 另有两条**不属于本域**的同源错误指针，本轮不动、只登记：`docs/batch-2026-10-06-bucket14c.md` 与
  `docs/batch-2026-10-06-verdict-reconcile.md` 里也写了那条 `CommandCompletionSuffixProvider.kt` 的 lang-impl 路径，
  并且各写了一条 `platform/platform-impl/src/com/intellij/ide/TrustedProjectsDialog.kt`（参考树里没有该路径下的这个文件，
  本轮 `find` 三条路都没搜到）⇒ `tests/source-citations.test.mjs` 目前仍红这 4 条，属桶 14 / 主代理名下。

### D. 本域还剩什么

1. **等接线**（不是没做，是挂在保留文件上）：`docs/wiring-requests-2026-10-06-bucket2c.md` 的 W1（Code 菜单三条补全动作现在是「有行无动作」）、
   W2（「打开的编辑器」表改由宿主登记；现状只有至少被查过一次补全的标签才在表里）、W3/W4（行内补全悬浮操作条与按 provider 开关）。
2. **问题面板逐行「抑制」入口**（W5）：条目侧 API（`suppressionActionsFor`）已就位，面板半区属 2b。
3. **明确不做**（理由见上面「做不到 / 无法核实」）：字符串字面量取值补全（无 lexer）、弹层 pending 占位行（`CompletionSource` 一次性）、
   多 provider 聚合 / suppress / Tab-Enter 探测（分别指向 Gateway-Host 代理接口、本仓没有的 prompt UI、本仓不收的遥测）、遥测类 weigher。
4. **待他人复核的一条**：§并发情况 记的 `view.state.changeCount → view.state.seq` 外部改动（两者在 `@codemirror/state` 里都不存在，
   本轮已改成 `EditorState.doc` 的对象身份并有判据）。谁改的、为什么改，两轮都没查到。
