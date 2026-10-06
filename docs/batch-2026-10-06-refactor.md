# 桶 1（重构 / 生成 / 代码风格 / 格式化）· 代号 `refactor` · 2026-10-06

接手现场：`docs/wiring-requests-2026-10-06-bucket1b.md` 的 A5/A6（**模块侧**做完、挂点交请求）
+ `docs/inventory/verdict-platform_rest.md` 的 `lp/refactoring`、`lp/generation`、`lp/formatting`、
`csi/formatter`、`cs/formatting-api` 五族判词（**先核后做**）。
上游基准树：`D:\Backup\Downloads\intellij-community-master\intellij-community-master`（全部本地读源码，未上网）。

域命令（只跑自己域）：
`node --test tests/refactor*.test.mjs tests/rename*.test.mjs tests/safe-delete*.test.mjs tests/surround*.test.mjs tests/unwrap*.test.mjs tests/format*.test.mjs tests/formatter*.test.mjs tests/code-style*.test.mjs`

**before → after：166 用例 / 166 通过 / 0 失败 → 181 用例 / 181 通过 / 0 失败**（+15 条判据）。

---

## 1. A5 / A6：模块侧收口 + 挂点

| 项 | 模块侧（本片） | 挂点（交请求） |
|---|---|---|
| **A5 安全删除的用法账** | 复核上一轮已落地的 `safeDeletePrompt()`（`src/safeDelete.ts:148`，含 `blocked`/三选一/截断说明）与 `safeDeletePromptFromFiles()`（`:226`，调用方只给 `{path,text}`，注释标记按路径补齐、`searchInComments` 为假就**一个字都不扫**）。**本片新增**：`showSafeDelete(prompt, path, target)`（`src/refactorHostAssembly.ts:440-455`）—— 让**树侧**那个删除入口能把算好的账交给同一张三选一对话框，不必复制一份组装逻辑，也不会出现两个对话框。判据 `tests/refactor-host-assembly.test.mjs`（新增 1 条，含「立状态无副作用」「仍然删除才动文件」「取消什么都不做」「没有代码引用位置时说清为什么跳不了」） | R1（`src/treeActions.ts:14/123-134/139` + `src/App.vue:1355` 那处 deps） |
| **A6 Unwrap 多候选 chooser** | 复核 `findUnwrapCandidates()`（`src/unwrap.ts:174`）与 chooser 那一节的五件（`UNWRAP_CHOOSER_TITLE:209`、`unwrapChooserItems:226`、`unwrapChooserNeeded:239`、`unwrapEditIntact:248`、`createUnwrapApplyCommand:258`）都在位且有判据（`tests/refactor-unwrap-chooser.test.mjs` 6 条）。**实测两处事实并写进注释**：① 触发面 `src/editorCommands.ts:233` 仍挂 `unwrapCommand`（直接拆最内层）、键位在 `src/components/CodeEditor.vue:903`（`Ctrl-Shift-Delete`）；② 上游**只有一条候选也弹层**（`UnwrapHandler.java:80-91` + `UnwrapDescriptorBase.java:67-69`），本仓现状与之不同 ⇒ 差异留在请求里由宿主决定 | R2（`src/editorCommands.ts` + `src/components/CodeEditor.vue` + `src/App.vue`） |

`docs/wiring-requests-2026-10-06-format.md`（代号 `format`，同一片文件面的上一轮）的 W1/W2 与本片的 R1/R2
是**同一件事**；本片按实测行号补齐了模块侧出口（`showSafeDelete`），**以本片 R1/R2 为准**，W1/W2 可作废。

---

## 2. 五族判词表（族 / 项 / 判定 / 上游相对路径:行号 / 本仓落点 / 一句话）

判定口径：`[x]` 已做 · `[~]` 部分（写清「本仓已有」+「还差」）· `[ ]` 未做 · `[-]` 不适用（具体理由）。

### 2.1 `lp/refactoring`

| 项 | 判定 | 上游相对路径:行号 | 本仓落点 | 说明 |
|---|---|---|---|---|
| ChangeSignature（Ctrl+F6） | `[x]`（已装配） | `idea/LangActions.xml:358`；`keymaps/$default.xml:469-471` | `src/refactorSignature.ts`、`src/refactorSignatureFlow.ts`、`src/components/RefactorSignatureDialog.vue`、装配 `src/refactorHostAssembly.ts:103` | 三处同步复核：键位表 `src/keymapBindings.ts:127-131`、分派表 `src/keymap.ts:393`、菜单行 `src/menus/refactorMenu.ts:92` ⇒ `tests/refactor-menu-parity.test.mjs` 第 8 条绿 |
| Safe Delete 三选一 + 注释/字符串用法账 | `[~]`：本仓已有 = 模型 + 重构菜单/Alt+Delete 那条入口；还差 = **树右键 Delete 那条入口**（本片把交接用的 `showSafeDelete` 做出来了） | `…/safeDelete/UnsafeUsagesDialog.java:35/:36/:41-47/:58/:95-98`；`LangActions.xml:388`（`<reference ref="SafeDelete"/>`，本次按行核过） | `src/safeDelete.ts:148/:226`、`src/refactorHostAssembly.ts:383-455`、`src/components/RefactorSafeDeleteDialog.vue` | 挂点 R1 |
| 成员上移 / 下移 | `[x]`（已装配） | `LangActions.xml:391-392`；`PushDownDialog.java:31-36` | `src/refactorMemberMove.ts`、装配 `src/refactorHostAssembly.ts:207` | 上游这两条在 `$default.xml` 里**没有**默认键位 ⇒ 键位表里也不许出现（`tests/refactor-menu-parity.test.mjs:274` 守着） |
| 引入形参对象 | `[x]`（已装配） | `LangActions.xml:372`；`AbstractIntroduceParameterObjectDialog.java:66-105` | `src/refactorIntroduceParameterObject.ts`、装配 `:321` | 面板次序 = `PARAMETER_OBJECT_PANELS`；「保持为委托」只在 `supportsDelegate` 的档上给 |
| 重命名的「在注释和字符中搜索」 | `[x]`（本仓自算字面出现，不当 LSP 入参） | `RenameDialog.java:281`（默认勾上）/`:376`；`LanguageCodeStyleProvider` 无涉 | `src/renamePreview.ts:165`（`nonCodeRenameEdits`）、`:204`（`mergePreviewEdits`）、消费 `src/semanticActions.ts:624` | 判词的「无法真做」只成立于「把开关传给语言服务」那一半；字面出现那一半**已真做**并有判据 `tests/rename-non-code.test.mjs` |
| 类/接口/超类/模块级 Extract、`IntroduceField/Parameter`、`InvertBoolean` | `[-]` | `LangActions.xml:367/:368/:378-382/:393` | 菜单里不出现 | 需要表达式/类型级 PSI 改写，本仓既无 PSI 也没有可当后端的宿主请求；不画灰行 |

### 2.2 `lp/generation`

| 项 | 判定 | 上游相对路径:行号 | 本仓落点 | 说明 |
|---|---|---|---|---|
| Generate 弹层（Alt+Insert） | `[~]`：本仓已有 = 按 `source.*` 与关键词筛语言服务代码动作、一次应用一条；还差 = 成员勾选表 + 逐方法生成 | `platform/lang-impl/src/com/intellij/codeInsight/generation/actions/GenerateAction.java`（同目录实测还有 `OverrideMethodsAction.java`/`ImplementMethodsAction.java`/`DelegateMethodsAction.java`） | `src/generateRefactor.ts:88-100` | 逐方法生成的文本来源是本地模板引擎 + PSI（`ClassMemberWithElement`/`PatternDescriptor`）；本仓Generate 的候选全部来自 `textDocument/codeAction` ⇒ 勾选表没有可生成的文本。**不是「太复杂」，是没有来源** |
| `AutoIndentLines`（Ctrl+Alt+I） | `[ ]` 且**实测到一处实质偏差**：本仓那一行走的是 CodeMirror `indentMore`（每行加一级），上游是「按代码风格把该行缩进到正确层级」+ 无选区时光标下移一行 | `platform/lang-impl/src/com/intellij/codeInsight/generation/AutoIndentLinesHandler.java:24-72`（`:41` 调 `adjustLineIndent`、`:47-57` 无选区时 `line1+1` 同列移光标）；键位 `$default.xml:828-830` | 菜单行 `src/menus/codeMenu.ts:111`、命令 `src/editorCommands.ts:269`、键位 `src/components/CodeEditor.vue:784` | 三个落点都不在本片可改面 ⇒ R3 |
| `SurroundWith` 条目表 | `[~]`：本仓已有 = 语言中立的九项 + 折叠区域四项；**本片补齐**缺的两项（do-while、try-catch-finally） | `java/java-impl/src/com/intellij/codeInsight/generation/surroundWith/JavaStatementsSurroundDescriptor.java:26-40`（`:30` do-while、`:35` try-catch-finally、`:36/:37` synchronized / Runnable） | `src/surround.ts:14-38`（表）、`:58-70`（`wrapSelection` 光标规则） | `synchronized`/`Runnable` 是 Java 专有构造，本仓的编辑器档（TS/JS/Python）没有对应写法 ⇒ **不列**（列了点下去就是坏代码）；判据新增「上游语言中立那几项都在」+「Java 专有项不该出现」 |
| `SurroundWithAction` 的 handler 扩展点 | `[-]` | `platform/lang-impl/src/com/intellij/codeInsight/generation/surroundWith/SurroundWithHandler.java`（该目录只有这一个文件，实测） | — | 扩展点=按语言注册 `SurroundDescriptor` EP；本仓没有插件容器，落成一张固定表（同一文件的 `block` 位区分整块/行内） |

### 2.3 `lp/formatting`

| 项 | 判定 | 上游相对路径:行号 | 本仓落点 | 说明 |
|---|---|---|---|---|
| 格式化准入（不格式化清单 / 不信任项目） | `[x]` | `platform/lang-impl/src/com/intellij/formatting/ExcludedFileFormattingRestriction.java:16-25`、`service/UntrustedFileFormattingServiceSuppressor.kt` | `src/formattingRestriction.ts:65`，接在 `src/semanticActions.ts:184-186` 发请求之前 | 判词的这条本轮复核仍在位 |
| 进度行 | `[x]`（一行后台任务） | `…/formatting/FormattingProgressTask.java` | `src/semanticActions.ts:212-213/257` | — |
| `FormattingProgressTaskFactory` 的**逐文件**独立进度 | `[-]` | `…/formatting/FormattingProgressTaskFactory.java` | — | 它服务的是「一次重排一批文件」的批处理；本仓没有任何全工程重排入口（实测 `grep -r "ReformatAll\|格式化全部" src` = 0 命中）⇒ 没有可挂的进度 |
| `AlignmentInColumns*` 按列对齐 | `[-]` | `…/formatting/alignment/AlignmentInColumnsHelper.java:7-9`（`TreeUtil`/`IElementType`/`TokenSet`）、`:17-33` | — | 分组识别完全建立在语法树 token 上（不是「缩进」这类能从文本推的东西）；本仓不解析语法树，`src/lspFeatureMatrix.ts` 也明确不回退本地缩进器 |
| `formatting/commandLine`（`FormatterStarter`/`FileSetCodeStyleProcessor`） | `[-]` | `platform/lang-impl/src/com/intellij/formatting/commandLine/`（实测该目录 7 个文件） | — | CLI 批处理，本仓没有命令行入口 |
| `SelectedTextFormatter` / `ConfigureCodeStyleOnSelectedFragment` / `CodeFragmentCodeStyleSettingsPanel` | `[ ]`（**订正判词的落点**：上游这三件不是菜单动作，是一条 Alt+Enter 意图） | `…/formatting/contextConfiguration/SelectedTextFormatter.java:21/:30/:53/:64-66`（`reformatRange` 调 `CodeStyleManager.reformatText`）、`ConfigureCodeStyleOnSelectedFragment.java:49/:91`（`new SelectedTextFormatter`）、调用方**只有这一处**（实测 `grep -rn "new SelectedTextFormatter"`） | 引擎本仓已有：`runFormatting(path, range)`（`src/semanticActions.ts:181`） | 要做就是「选区存在时挂一条本地意图 + 一块按语言的风格面板」；意图注册在 `src/localIntentions.ts`（桶 2 名下）、面板在设置面 ⇒ 不在本片，登记在第 6 节 |
| `FormattingNotificationService` 一族 | `[~]`：本仓已有 = 请求前后的 `notify` 三条（被准入挡下 / 编辑被本地规则丢下 / 与用户改动冲突）；还差 = 上游那种**带「去设置」动作的气球** | `platform/code-style-api/src/com/intellij/formatting/service/FormattingNotificationService.java`、`platform/lang-impl/src/com/intellij/formatting/service/FormattingUiNotificationService.java` | `src/semanticActions.ts:186/209/243-245` | 气球与通知组在 `src/notices.ts`（桶 6 名下），本片只把文案口径对齐既有那三条，不自造新钮 |
| `VisualFormattingLayer*` | `[-]` | `platform/lang-impl/src/com/intellij/formatting/visualLayer/`（实测 5 个文件） | — | 高亮层渲染在编辑器侧（本仓的缩进参考线是 `src/editorIndentGuides.ts`，桶 5 名下），且上游这层也是从 `Block` 模型取数 |

### 2.4 `csi/formatter`

| 项 | 判定 | 上游相对路径:行号 | 本仓落点 | 说明 |
|---|---|---|---|---|
| `FormatterTagHandler`（`@formatter:off/on`）内核 | `[x]` | `platform/code-style-impl/src/com/intellij/formatting/FormatterTagHandler.java:32-48/:50-58/:60-68/:70-84/:86-106` | `src/formatterTags.ts:50/:72/:105/:136` | 四条边界（逐行、落点=行首、大小写不敏感、末行无换行不识别）都有判据 |
| **③ `FormatTextRanges` / 禁用段的「范围调整」** | `[x]` **本片做完**（原判词：`[~]`「跨边界整条放弃、不做切分」） | `platform/code-style-impl/src/com/intellij/psi/impl/source/codeStyle/CodeFormatterFacade.java:232-235`（`setDisabledRanges` = 整文件减启用段）、`:109`、`:197`；`platform/code-style-impl/src/com/intellij/formatting/InitialInfoBuilder.java:334`（段内空白跳过、段外照排）；`platform/code-style-impl/src/com/intellij/formatting/FormatTextRanges.java:124-131` | `src/formatterTags.ts:150-190`（`lineColumnAt`、`enabledFormatRanges`）、`:203-247`（`mergeFormatParts`）；消费 `src/semanticActions.ts:196-211`（切段）+ `:239-262`（`requestFormatting`）；响应侧兜底仍在 `:227` | **订正留痕**：原判词把这条的依据写成 `AdjustFormatRangesState` —— 那个类走的是 `Block`/`ExtraRangesProvider` 的 PSI 块模型（`AdjustFormatRangesState.java:36-60`），与标记禁用段无关；真正的依据是上面 `CodeFormatterFacade`/`InitialInfoBuilder` 那三处 |
| ④ `LineCommentAddSpacePostFormatProcessor` | `[x]`（**本片修正一处实质错判**） | 处理器：`platform/code-style-impl/src/com/intellij/formatting/LineCommentAddSpacePostFormatProcessor.kt:22-50/:68-84`；判定钩子：`platform/code-style-api/src/com/intellij/psi/codeStyle/LanguageCodeStyleProvider.java:77-81` | `src/postFormatProcessors.ts:56-72`（新增 `canInsertSpaceInLineComment`）、`:96-101`（收集偏移时逐条问过钩子） | 旧注释写「语言级钩子本仓没有，按恒真处理」—— 实测**社区树里没有任何语言覆写它**（`grep -r canInsertSpaceInLineComment` 只有接口默认实现 + 一处调用），所以默认实现就是上游用户可见的行为。按恒真的后果：`// 已有空格` 被补成两个空格、`//----` 分节线被拆开。已按默认实现补上并加判据 |
| ④ 的设置面 | `[ ]`（不在本片） | `ApplicationBundle.properties:667`（`checkbox.line.comment.add.space.on.reformat`） | 写入口已有：`src/codeStyleSettings.ts:113-121` | 缺的是设置页那个复选框 ⇒ `src/components/SettingsDialog.vue`（保留/他桶）|
| ① `FormatterImpl`/`FormatProcessor` 的 `Block`/`Spacing` 逐块重排、② `AlignmentImpl`/`AlignmentCyclesDetector`/`RightEdgeAlignmentProcessor` | `[-]` | `platform/code-style-impl/src/com/intellij/formatting/`（实测该目录 40 个文件里 `Block`/`Spacing`/`Alignment` 一族占一半） | — | 块模型要从语法树建（`ASTBlock`/`ChildAttributes`），本仓不解析语法树；重排全交语言服务 |
| ③ `FormatTextRanges`/`AdjustFormatRangesState` | `[x]`（切分那一半本片做完，见上表第 2 行） | 同上 | 同上 | `AdjustFormatRangesState` 那一半属于块模型 ⇒ `[-]` |

### 2.5 `cs/formatting-api`

| 项 | 判定 | 上游相对路径:行号 | 本仓落点 | 说明 |
|---|---|---|---|---|
| `DocumentMerger`（请求期改动合并） | `[x]` | `platform/code-style-api/src/com/intellij/formatting/service/DocumentMerger.java` | `src/formattingMerge.ts`，接在 `src/semanticActions.ts:229-238` | 判词这条本轮复核仍在位 |
| `AsyncDocumentFormattingSupport`/`AsyncFormattingRequest` | `[~]`：本仓已有 = 发请求前取缓冲快照 + 按快照算坐标 + 合并闸门；还差 = 服务器端**取消**（改字后把上一次请求作废） | `…/formatting/service/AsyncFormattingRequest.java` | `src/semanticActions.ts:188-190` | 取消要 LSP `$/cancelRequest` 的宿主通道（`native/` 与 `src/bridge.ts` 都不在本片） |
| `FormattingService`/`AbstractDocumentFormattingService`/`CustomFormattingModelBuilder`/`FormattingModelBuilder` 的注册面 | `[-]` | `platform/code-style-api/src/com/intellij/formatting/`（`FormattingModelBuilder.java` 等）、`…/formatting/service/FormattingService.java` | — | 注册靠插件容器 + `Language`；本仓的语言档是字符串（`languageOf(path)`），没有可注册的服务表 |
| `LanguageFormattingRestriction`（准入） | `[x]` | `platform/code-style-api/src/com/intellij/lang/LanguageFormattingRestriction.java` | `src/formattingRestriction.ts` | — |
| `ImportOptimizer`/`SuspendableImportOptimizer` | `[~]`：由语言服务 `source.organizeImports` 承担（`runOrganizeImports`） | `platform/code-style-api/src/com/intellij/lang/ImportOptimizer.java` | `src/semanticActions.ts`（`runOrganizeImports`）、菜单 `src/menus/codeMenu.ts:112` | 没有「按语言逐个 optimizer 扩展点」这层 |
| `Formatter`/`ASTBlock`/`SpacingBuilder`/`WrapFactory` 等块 API | `[-]` | `platform/code-style-api/src/com/intellij/formatting/`（实测 40+ 个类） | — | 同 2.4 ①②：没有语法树就没有块模型；`docs/inventory/platform_rest_verdict_table.md:1556-1599` 那张表里这些类全是 `[~]`/「从未出现」，本轮维持原判 |

---

## 3. 改动文件（`wc -l` 前 → 后）

| 文件 | 前 | 后 | 这次动了什么 |
|---|---|---|---|
| `src/formatterTags.ts` | 145 | 247 | 新增「请求侧区间切分」一节：`FormatPoint`/`FormatRange`、`lineColumnAt()`、`enabledFormatRanges()`、`FormatEdit`、`mergeFormatParts()`；模块头的消费链路说明改成「请求侧切分 + 响应侧兜底」两条口径并留痕 |
| `src/semanticActions.ts` | 690 | 740 | `runFormatting` 里切段与「整段禁用不发请求」；新增 `requestFormatting()`、`MAX_FORMAT_SUBRANGES`、`FormatResponse`；`suppressed` 起点改成合并丢掉的条数 |
| `src/postFormatProcessors.ts` | 103 | 127 | 新增 `canInsertSpaceInLineComment()`（上游接口默认实现）并在收集偏移处逐条问过；模块头第 2 条差别改写成实测结论并留痕 |
| `src/surround.ts` | 68 | 80 | 补 `do / while 循环`、`try / catch / finally` 两项（上游 `JavaStatementsSurroundDescriptor.java:30/:35`）；`wrapSelection` 的光标规则加「`()` 只出现在后缀里」那一档 |
| `src/refactorHostAssembly.ts` | 449 | 464 | 新增对外的 `showSafeDelete()`（A5 树侧入口用）+ 文件头写明挂点请求 |
| `tests/formatter-tags.test.mjs` | 96 | 195 | +7 条：换算互逆/无标记原样/切成两段/整段禁用/起点在禁用段内/合并去重与重叠/全不可用；接线那条判据从 4 条加到 9 条（**只加不减**） |
| `tests/code-style.test.mjs` | 312 | 349 | +4 条：钩子的「不加」档、「加」档、旧「恒真」写法会做错的整段用例、接线断言 |
| `tests/surround.test.mjs` | 44 | 70 | +3 条：条目表覆盖上游语言中立项且不含 Java 专有项、do/while 的光标在条件里、try/catch/finally 三段齐 |
| `tests/refactor-host-assembly.test.mjs` | 156 | 186 | +1 条：`showSafeDelete` 的对外契约（含 viewUsages/deleteAnyway/cancel 三条分派） |

未动（越权或他桶名下）：`src/App.vue`、`src/keymap.ts`、`src/keymapBindings.ts`、`src/treeActions.ts`、
`src/editorCommands.ts`、`src/components/CodeEditor.vue`、`src/notices.ts`、`src/localIntentions.ts`、`src/bridge.ts`。
本片**没有新增/修改任何菜单行与键位行** ⇒ 「菜单行 / 键位表 / 分派表」三处无需同步；现状复核为一致
（`refactor.changeSignature` → `keymapBindings.ts:127-131` + `keymap.ts:393`；`refactor.safeDelete` → `keymapBindings.ts:132-136` + `keymap.ts:394`；
无键位的 `pullMembers`/`pushMembers` 也确实不在键位表里）。

---

## 4. §5 自查（前后数字）

| 门禁 | 前 | 后 |
|---|---|---|
| 本域测试（上面那条命令） | 166 / 166 / 0 失败 | **181 / 181 / 0 失败** |
| `node --test tests/module-size.test.mjs` | 5 / 5 | **5 / 5**（最大文件 `semanticActions.ts` 740 行 < 900；本片把 4 个新出口**没有**拆成新文件，因为它们都要被同一消费方调用；上限未调、无新增豁免） |
| `node .tools/find-param-props.mjs` | 0 处 | **0 处** |
| `node .tools/find-ts-in-mjs.mjs` | 干净 | **干净** |
| `node .tools/find-missing-ext.mjs` | 干净 | **干净**（1275 个文件） |
| `node .tools/find-orphan-modules.mjs --gate` | 已登记 9 / 基线 9 · 新增 0 | **已登记 9 / 基线 9 · 新增 0 · 本轮清掉 0** |
| `node --test tests/source-citations.test.mjs tests/source-citation-anchors.test.mjs` | 11 / 11 | **9 / 11 —— 两条红不在本片**：别的代理在途写的两份报告（`docs/batch-2026-10-06-completion2.md`、`docs/batch-2026-10-06-welcome2.md`）各引了一个参考树里不存在的上游文件（类名一个是 suppression 意图那条、一个是 structure view 的 factory impl 那条；按规约 §5「转述假写法别写完整形状」这里不落路径与行号，逐条内容见门禁输出）。本片新增的 12 处上游坐标全部按行打开核对过；写这两份报告**之前**本域跑这条门禁是 11/11 |
| `npx vue-tsc -b --force` | 6 条错，全在 `src/bookmarkActions.ts`、`src/toolWindowStripes.ts`、`src/vcsLogGoToRef.ts`（桶 13 / 桶 8 名下） | **5 条错（他人期间修掉一条），本片域内 0 条**（`grep error TS` 里没有任何文件名属于桶 1）。全仓 0 错基线目前被那 3 个文件挡着，我没有改它们的名分 |
| native ctest | 本片未动 `native/` | 不适用（无 `native/*.cpp` 改动） |

---

## 5. 反向验证（注入违规 → 变红 → 撤掉 → 复绿）

1. **切分逻辑**：把 `enabledFormatRanges()` 首行改成 `return [range]`（退回「不切段」）⇒
   `tests/formatter-tags.test.mjs` **红 3 条**（切成两段 / 整段禁用 / 起点在禁用段内）；撤掉后复绿。
2. **补空格钩子**：把 `canInsertSpaceInLineComment()` 改成 `return commentContents !== ''`（旧的「恒真」口径）⇒
   `tests/code-style.test.mjs` **红 2 条**（钩子「不加」档 + 整段用例，后者报 `inserted: 4` 而不是 1）；撤掉后复绿。
3. **接线门禁**：把 `const result = await requestFormatting(path, range, subRanges, indent)` 换回原来那一次
   `request('lsp.request', …)` ⇒ `semanticActions 的 runFormatting 真的走了这条过滤` **红 1 条**；撤掉后复绿。
4. **装配出口**：`tests/refactor-host-assembly.test.mjs` 新条在开发过程中先红过两次
   （① 用 `.txt` 当被扫文件 ⇒ `commentStyleFor` 给不出注释标记、账是空的；② `ref()` 把 prompt 包成响应式代理 ⇒
   按引用比恒不等）。两条都改成按内容比 + 换成 `.java` 后才绿 —— 不是写完就绿的装饰性断言。
5. 上面 1–3 合起来那一次全量跑的数字：**43 用例 / 38 通过 / 5 失败**（注入态）→ **43 / 43 / 0**（复绿）。

---

## 6. 零消费方自查

- 本片新增/改动的出口全部有消费方：
  `enabledFormatRanges`/`mergeFormatParts`/`lineColumnAt` → `src/semanticActions.ts:196/239-262`（生产链路）；
  `canInsertSpaceInLineComment` → 同文件的 `lineCommentInsertOffsets()`（被 `processLineCommentAddSpace` 调用，后者被 `runFormatting` 调用）；
  `surroundTemplates` 新增两项 → `src/surroundTemplates.ts` → `src/App.vue:54/157/2599`（Ctrl+Alt+T 弹层）；
  `showSafeDelete` → **暂时只有判据在用**，因为它就是为本片 R1 那个挂点准备的（树侧在桶 14 名下）。
  模块级孤儿门禁：9/9 基线，新增 0。
- 顺带复核：`src/assertionView.ts` 这次**有**生产消费方了（`src/components/TestRunnerPanel.vue:8` 引 `AssertionView`/`TestResultFeed`），
  上一轮报告 §5.8 写的「全仓只有它自己」**已不成立**（留痕订正）。

---

## 7. 做不到 / 未做 / 无法核实（具体卡在哪一环）

1. **A5 的树侧那一步**（`src/treeActions.ts`）：桶 14 名下，本片只读 ⇒ R1。模块侧出口已备齐（`safeDeletePromptFromFiles` + `showSafeDelete`）。
2. **A6 的弹层与键位**（`src/components/CodeEditor.vue` 保留 / `src/editorCommands.ts` 桶 5）⇒ R2。
3. **`AutoIndentLines` 的真实语义**（`AutoIndentLinesHandler.java:24-72`）：命令体在 `src/editorCommands.ts:269`、键位在 `src/components/CodeEditor.vue:784`，都不是本片 ⇒ R3。
4. **postFormat / 「不格式化」清单的设置页**：`src/components/SettingsDialog.vue` 与设置树不在本片（与 `docs/wiring-requests-2026-10-06-format.md` W3 同一件事）⇒ 本片不重复交。
5. **按语言的 `canInsertSpaceInLineComment` 豁免**（上游注释举的例子是 Go 的 `//go:generate`，`LanguageCodeStyleProvider.java:64-67`）：
   覆写口按语言给 ⇒ 要一张「语言 → 不许插空格的前缀」表，而本仓的语言档是字符串、没有 commenter 对象模型。
   本片按**接口默认实现**落地（社区树里无人覆写 ⇒ 与上游用户可见行为一致）；Go 指令这一档**无法核实**上游到底有没有覆写（`grep -r` 全树只 2 处命中，无 Go 覆写）。
6. **`FormattingService`/`ASTBlock`/`AlignmentImpl` 的本地块模型**（`csi/formatter` ①②、`cs/formatting-api` 的块那一族）：要从语法树建块；
   本仓不解析语法树，`src/lspFeatureMatrix.ts` 明确不回退本地缩进器 ⇒ 维持 `[-]`。
7. **逐方法生成（Override/Implement/Delegate）与 Generate 勾选表**：候选文本要本地模板引擎 + PSI；本仓 Generate 的候选全部来自
   `textDocument/codeAction`（`src/generateRefactor.ts:93-95` 实测），一次只能应用一条 ⇒ 勾选表没有可生成的文本来源。
8. **`ConfigureCodeStyleOnSelectedFragment`**（Alt+Enter 那条意图，`ConfigureCodeStyleOnSelectedFragment.java:49/:91`）：
   意图注册在 `src/localIntentions.ts`（桶 2）、风格面板是 Swing 设置面（`CodeFragmentCodeStyleSettingsPanel`）——两处都不在本片，
   且本仓没有「按语言临时改 CodeStyleSettings」的入参（语言服务的格式化选项只有 `tabSize`/`insertSpaces`，
   `LspFormattingService.kt:119-125`）⇒ 登记为未做，不放假意图。
9. **格式化请求的服务器端取消**（`AsyncFormattingRequest`）：要 `$/cancelRequest` 的宿主通道，在 `native/` 与 `src/bridge.ts`（都不在本片）。
10. **本片没有新增任何界面控件**；两处如实差异（A6 的「只有一条也弹层」、A5 的「树侧还是旧提示」）都写在请求里等宿主决定，没有自行改动他桶文件。
