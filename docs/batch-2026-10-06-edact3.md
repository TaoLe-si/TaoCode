# batch 2026-10-06 · edact3 · 编辑器动作域（`lp/editor-actions`）`[~]` 先核后做

代号 `edact3`。上游唯一真源：`D:\Backup\Downloads\intellij-community-master\intellij-community-master`
（下述每条行号都是本批**亲自打开**核对的，未上网搜）。范围 = 派单点名的四件：
回车 handler 的**优先级次序**、`QuoteHandler` 的**逐语言开关**、`FillParagraph`、`CodeBlockSupport`。
`src/App.vue` / `src/components/CodeEditor.vue` 一个字节没改（保留文件），要挂的都写成请求
⇒ `docs/wiring-requests-2026-10-06-edact3.md`。

---

## 1. 判词表（族 / 项 / 判定 / 上游依据 / 本仓落点 / 一句话）

| 族 | 项 | 判定 | 上游相对路径:行号（本批亲自核） | 本仓落点 | 一句话 |
| --- | --- | --- | --- | --- | --- |
| enter | EP 声明与 7 条平台注册 | `[x]` 已核 | `platform/lang-impl/resources/intellij.platform.lang.impl.xml:399`、`:1159`、`:1160`、`:1161-1162`、`:1163-1164`、`:1165-1166`、`:1167-1170`、`:1171` | `src/enterHandlerOrder.ts:69-141` | 次序不再散在 if 链里，做成带注册行号的数据表 |
| enter | 「逐个问、第一个接管的算」+ break 语义 | `[x]` 已做 | `platform/lang-impl/src/com/intellij/codeInsight/editorActions/EnterHandler.java:136-137`（循环）、`:142-144`（`Stop` 直接 return）、`:145-153`（其余非 `Continue` 档 break） | `src/enterHandlerOrder.ts:163-175`（`preprocessEnter`）、`src/enterHandlers.ts:505-530`（`smartEnterCommand` 改成表驱动） | 循环体是上游那个 for 的等价物，判据能失败（见 §4） |
| enter | 五档 `Result` 与每条命中时的档位 | `[x]` 已做 | `enter/EnterHandlerDelegate.java:25-26`；`enter/EnterInStringLiteralHandler.java:81`、`enter/EnterInLineCommentHandler.java:88`、`enter/EnterAfterUnmatchedBraceHandler.java:57`、`enter/EnterInBlockCommentHandler.java:67` 与 `:98`、`enter/EnterAfterJavadocTagHandler.java:77`、`enter/EnterBetweenBracesFinalHandler.java:94-96` | `src/enterHandlerOrder.ts:47-52`、表里 `result`/`resultAt` 两列 | `Stop` 真的不再插换行，`Default` 与 `DefaultForceIndent` 的差别只在 `SMART_INDENT_ON_ENTER` 关掉时看得见（`EnterHandler.java:163-174`）⇒ 本仓无该键，按默认档走 |
| enter | `INSERT_BRACE_ON_ENTER` / `CLOSE_COMMENT_ON_ENTER` 两条开关 | `[x]` 已做（承前批，本批核对行号） | `platform/analysis-impl/src/com/intellij/codeInsight/CodeInsightSettings.java:129`（`SMART_INDENT_ON_ENTER`）、`:130`、`:132`、`:140`；开关本体 `enter/EnterAfterUnmatchedBraceHandler.java:84-86`（返回 0 时 `:50-51` 短路）、`enter/EnterInBlockCommentHandler.java:62` | `src/enterHandlers.ts:104-113`（`EnterLanguage` 三键）、`:449-451`、`:470-481` | 四行的行号都与上游对得上；**订正**：旧注释与本批新注释一度把开关写成 `:84-87`/`:50-51`，本体在 `:84-86` |
| enter | `EnterAfterJavadocTagHandler` | `[ ]` 未做（登记在表里） | `intellij.platform.lang.impl.xml:1171`、`enter/EnterAfterJavadocTagHandler.java:30/38/49/77` | `src/enterHandlerOrder.ts:106-112`（`ported: false` + 理由） | 依赖 javadoc PSI 的 `@param` 续行，本仓没有 javadoc 解析层 |
| enter | `InjectedIndentPostProcessor` | `[-]` 不适用 | `intellij.platform.lang.impl.xml:1167-1170`、`enter/EnterBetweenBracesFinalHandler.java:90-99`（类注释：注入片段的 formatter 不跑） | `src/enterHandlerOrder.ts:133-141` | 本仓没有 injected fragment 这一层，且它只覆写 `postProcessEnter` |
| quote | 逐语言注册表（20 条 / 19 个键） | `[x]` 已做 | 20 条逐行核：`java/java-frontback-impl/resource/intellij.java.frontback.impl.xml:74`、`json/resources/intellij.json.xml:92/93/94`、`platform/lang-impl/resources/intellij.platform.lang.impl.xml:1020`、`plugins/groovy/resources/META-INF/plugin.xml:748`、`plugins/jsonpath/resources/META-INF/plugin.xml:41`、`plugins/kotlin/base/code-insight/minimal/resource/intellij.kotlin.base.codeInsight.minimal.xml:89`、`plugins/markdown/core/resources/META-INF/plugin.xml:220`、`plugins/mermaid/resources/META-INF/plugin.xml:84`、`plugins/sh/core/resources/intellij.sh.core.xml:47`、`plugins/toml/core/src/main/resources/intellij.toml.core.xml:29`、`plugins/xpath/xpath-lang/resources/META-INF/plugin.xml:122/123`、`plugins/yaml/resources/intellij.yaml.xml:56`、`python/python-syntax/resources/intellij.python.syntax.xml:32`、`xml/xml-ui-common/resources/intellij.xml.ui.common.xml:69/70/71/72`（另 EP 声明 `platform/lang-impl/resources/intellij.platform.lang.impl.xml:405/:408`） | `src/quoteHandlerRegistry.ts:60-179` | 「这门语言到底有没有引号 handler」第一次变成一张能读能判的表；20 条注册行**全部**用脚本逐条对过上游（见 §3 末尾） |
| quote | 三级取 handler + 触发字符写死 | `[x]` 已核 | `platform/lang-impl/src/com/intellij/codeInsight/editorActions/TypedQuoteImpl.java:31-44`（注入 fileType → 文件 fileType → base language）、`:52`（只有 `"` `'` `` ` `` 触发）、`:66-68`（`AUTOINSERT_PAIR_QUOTE`）、`:69-72`（没 handler ⇒ 整条不接管） | `src/quoteHandlerRegistry.ts:44-58`（头注释）、`:56`（`QUOTE_TRIGGER_CHARS`） | 触发字符**不是**按语言定的，各语言的区别只在 handler 内部的 token 集 |
| quote | 门槛 (a)：敲完之后是标识符字符 ⇒ 不补配对 | `[x]` 本批新做 | `TypedQuoteImpl.java:104-105`（多字符支）与 `:117-118`（普通支） | `src/quoteHandlerRegistry.ts:182-187`、`src/editorTyping.ts:135-141`（接进 `quoteAction`） | 改动前在 `abc|def` 中间敲引号本仓会补出一个收尾引号，上游不补 —— 用户可见 |
| quote | 门槛 (b)：`javaLike` 的 token 表 | `[x]` 本批新做 | `TypedQuoteImpl.java:89-97` + `java/java-frontback-impl/src/com/intellij/codeInsight/editorActions/JavaQuoteHandler.java:33-36`（那张表 = javadoc ∪ 注释/空白 ∪ `TEXT_LITERALS` ∪ `;` `,` `)` `]` `}`） | `src/quoteHandlerRegistry.ts:189-207` | 只对 javaLike 的语言问；全树实现 `JavaLikeQuoteHandler` 的**只有** `JavaQuoteHandler.java:31` 一个（本批 grep 复过） |
| quote | `QuoteHandler` 四问法 | `[x]` 已核（承前批） | `platform/lang-impl/src/com/intellij/codeInsight/editorActions/QuoteHandler.java:28/40/49/64/66`、类注释 `:10-20` | `src/editorQuoteFaces.ts:4-13` | 「跳过收尾」在两条门槛**之前**问（`TypedQuoteImpl.java:80-85`）⇒ 本批把它保持在门槛之前 |
| paragraph | `FillParagraph` 一族 | `[x]` 已做（**原判词过期**，见 §8 留痕） | `platform/lang-impl/src/com/intellij/codeInsight/editorActions/fillParagraph/FillParagraphAction.java:20-46`（`:29-38` invoke、`:43-46` `isValidForFile`）、`fillParagraph/ParagraphFillHandler.java:41-53/97-122/128-148/208-210`、`platform/platform-impl/src/com/intellij/formatting/LineWrappingUtil.java:118-165`、`platform/code-style-api/src/com/intellij/psi/codeStyle/CodeStyleSettings.java:430`（`RIGHT_MARGIN = 120`） | `src/editorFillParagraph.ts`（153 行）、命令注册在 `src/editorCommands.ts:39` | 本批逐行复核判据成立；**上游只按 `editor.getCaretModel().getOffset()` 取段**（`ParagraphFillHandler.java:102`、`:133`），所以本仓「只认光标、不认选区」是对的，不是缺 |
| paragraph | 折行的宽度口径 | `[~]` 部分 | `LineWrappingUtil.java:112-113`（`spaceSize`/`tabSize` 像素档）、`:128-136`（找不到落点就跳过）、`:143-150`（左边只剩空白就跳过）、`:157-158`（新行不比留在原行的部分长就撤掉这次折行） | 本仓已有：`src/editorFillParagraph.ts:81-99`（按字符数 + `:90-91` 那两条跳过） | 还差：制表符按 `tabSize` 展开的**视觉宽度**口径（本仓按字符数算，段落里有 `\t` 时折行点会偏） |
| codeblock | `CodeBlockUtil` 的两支合并 | `[x]` 本批接上 | `platform/lang-impl/src/com/intellij/codeInsight/editorActions/CodeBlockUtil.java:108-120`（`:110` 问结构支持、`:111-113`/`:114-116` 两支互备、`:118` `Math.min`）与 `:176-188`（`:178`、`:186` `Math.max`） | `src/editorCodeBlock.ts:32-40`（import）、`:147-168`（`codeBlockTarget` 多一个 `language` 形参并合并）、`src/editorCommands.ts:179`（语言档经 `editorLanguageId` facet 传入） | 派单点名的 `:110/:178` 核对成立；`search2` 的 W-1' 请求按本域可改面落地，并把它那条「故意留松」的断言换成实测值（§2/§9） |
| codeblock | 结构支持按语言注册的面 | `[-]` 对本仓不可达（不是少做） | EP 声明 `platform/lang-impl/resources/intellij.platform.lang.impl.xml:147`；全树唯一注册 `python/pluginResources/intellij.python.community.impl.xml:439`；取区间 `platform/lang-impl/src/com/intellij/codeInsight/highlighting/CodeBlockSupportHandler.java:57-66` | `src/structuralCodeBlock.ts:471-475`（`findCodeBlockRange`，非 python ⇒ null） | Java/C++/TS 在上游就是 `EMPTY_RANGE` ⇒ 合并退化成只用括号扫描；本仓编辑器也只认 java/cpp/typescript/json/html/css（`src/editorLanguage.ts:15-21`），没有 Python 档 |

**本批新做的三条**（判据都能失败）：门槛 (a)+(b) 进引号链路、回车次序表 + 表驱动循环、代码块两支合并。
**只做核与判词、没再写码的**：`FillParagraph`（已在，逐行复核 + 补一条「制表符视觉宽度」的差档登记）。

---

## 2. 改动文件清单（`wc -l` 前后）

| 文件 | 前 | 后 | 本批改了什么 |
| --- | --- | --- | --- |
| `src/enterHandlerOrder.ts` | —— | **175**（新建） | 五档 `ENTER_RESULTS`、7 条 `ENTER_HANDLER_ORDER`、`preprocessEnter` 循环、`enterInsertsNewline`、`preprocessSteps` |
| `src/quoteHandlerRegistry.ts` | —— | **218**（新建） | 20 条逐语言注册表、`QUOTE_TRIGGER_CHARS`、`nextCharBlocksPair`、`appropriateElementForLiteral`、`pairInsertionSuppressed`、`quoteRegistrationForLanguage`、`isJavaLikeQuoteLanguage` |
| `src/enterHandlers.ts` | 486 | **530** | 头注释补 4 处依据（含订正）；`smartEnterCommand` 的 if 链 ⇒ `EnterContext` + `ENTER_IMPLS`（按表 id 索引）+ `applyEnterHit`；import 表模块 |
| `src/editorTyping.ts` | 229（估，见 §9） | **255** | `quoteAction`/`quoteActionWithSwitch` 多一个可选 `languageId`，pair 之前过两条门槛；`smartQuotes` 传 `getLanguage()`；import 注册表 |
| `src/editorCodeBlock.ts` | 150 | **173** | `codeBlockTarget` 加 `language` 形参（默认 `''` ⇒ 与接线前逐字一致）并调 `findCodeBlockRange` + `mergeBlockEnd`/`mergeBlockStart` |
| `src/editorCommands.ts` | 277（估） | **280** | `block.*` 命令把 `state.facet(editorLanguageId) ?? ''` 传给 `codeBlockTarget`（+ import） |
| `tests/editor-enter-order.test.mjs` | —— | **125**（新建，8 条） | 五档 / 表 7 条 / 有效次序 / 循环 break / 倒序可失败 / Stop 档 / 未实现条目 / 理由列 |
| `tests/quote-handler-registry.test.mjs` | —— | **123**（新建，7 条） | 触发字符、javaLike 与 multiChar 集合、门槛 (a)(b) 逐格、两条合并、进链路后的 `quoteAction`、表外语言不许有规则 |
| `tests/editor-code-block.test.mjs` | 81（9 条） | **214**（17 条） | 本批 +4 条（`min`/`max`/两支互备/非 Python 逐字一致，数值全是实测）；同文件另有并行批次的 4 条（facet 通道），本批没动它们 |
| `tests/editor-enter-handlers.test.mjs` | —— | 同文件 | 2 条**源码形状**断言跟着重构改写（原锚点 `if (inComment)` / `command.indexOf('enterInStringLiteral(lineText'` 已不存在），改成钉表 + 钉新锚点，强度只升不降（见 §9） |
| `tests/editor-enter-block-comment.test.mjs` | —— | 同文件 | 1 条同上（`enterInBlockComment(docText, selection.head, …)` ⇒ `enterInBlockComment(ctx.docText, ctx.head, …)`） |
| `tests/editor-quote-faces.test.mjs` | —— | 同文件 | 1 个锚点字符串跟着调用点折行改掉（`quoteActionWithSwitch(line.text` ⇒ `const action = quoteActionWithSwitch(`） |

未 commit、未 push；没有 `git checkout/reset/stash/clean`。临时文件（`build/enterHandlers.tail.tmp`、
`build/tsc-edact3.txt`、`build/revbak/*`）已删干净。

---

## 3. §5 每条自查命令的前后数字

| 门禁 | 开工基线 | 收工 | 备注 |
| --- | --- | --- | --- |
| 本域测试（10 个文件：enter-handlers / enter-block-comment / enter-order / quote-faces / quote-handler-registry / fill-paragraph / code-block / smart-enter / brackets / inline-completion-typing） | 开工时 `editor-enter-handlers + editor-enter-block-comment` = **27 条**（另：code-block 9 条、quote-faces 与其余未逐一计数） | **104 条 / 104 pass / 0 fail** | 中途我重构导致 3 条「源码形状」断言红过一次（24/27），改钉表之后 27/27 复绿，再没红过 |
| `npx vue-tsc -b --force` | 未记录基线（开工即改码）；**第一次跑**时全仓 4 条错，都在别人在途文件（`src/components/ProblemsPanel.vue`、`src/lspServerMessages.ts`、`src/refactorPreview.ts`） | 全仓 **2** 条：`src/refactorPreview.ts`、`src/workspaceLifecycle.ts`；**本批改过的 7 个文件 0 条**（grep 本批文件名命中 0） | 那两条与本批无关：两次运行之间它们自己从 4 变成 2，说明是并行批次正在收的口；本批没有碰这两个文件 |
| `node --test tests/module-size.test.mjs` | 绿 | **5 / 5 绿** | 上限未动、未登记豁免；新建的两个模块 175/218 行，远低于 900 |
| `node .tools/find-param-props.mjs` | —— | **共 0 处参数属性** | |
| `node .tools/find-ts-in-mjs.mjs` | —— | **干净：tests/*.mjs 全部是纯 JavaScript**（本批一度在 `.mjs` 里写了 `!` 非空断言 ⇒ 立刻 `SyntaxError`，按规约 §4.2 删掉） | |
| `node .tools/find-missing-ext.mjs` | —— | **扫描 1302 个文件，干净** | 新模块之间的 import 都带 `.ts` |
| `node .tools/find-orphan-modules.mjs --gate` | 已登记 9 | **已登记 9 / 基线 9 / 新增 0 / 本轮清掉 0 ⇒ 门禁绿** | 见 §5 |
| `node --test tests/source-citations.test.mjs tests/source-citation-anchors.test.mjs` | —— | 11 条 / 8 pass / **3 fail**，失败项全在别人的文件：`docs/wiring-requests-2026-10-06-vcs2.md`（2 条「参考树里没有这个文件」：`platform/analysis-api/src/com/intellij/codeInsight/SuppressIntentionAction.java :19`、`platform/structure-view-impl/src/com/intellij/ide/structureView/StructureViewFactoryImpl.java :49-50`——两条假坐标**在扩展名与行号之间留了一个空格**，规约 §5：引用门会把文档里**转述**的「路径:行号」也当真引用收集，抄原文等于自己再造一条红；去掉空格就是门禁原文）与 `moved` 3 条（`docs/batch-2026-10-06-bucket14b.md`、`docs/settings-parity.md`、`src/trustedProjects.ts`）；**本批新增/改动的引用 0 条不合格**（那 3 条 `moved` 里前两条已由 citefix 按真行号改好并重算快照，第三条是别人在 `src/` 改掉的引用，快照重算时一并收干；真坐标见 `docs/batch-2026-10-06-citefix.md`：`codeInspection` 包 + `structureView.impl` 包，行号与内容都对得上） | 本批所有 `路径:行号` 都亲自打开过；注册表那 20 条另用脚本逐条比对（下面一行） |
| 20 条引号注册的行号自证 | —— | 脚本把每条 `文件:行号` 与该行 ±2 行内容对齐类名与 `quoteHandler` 字样 ⇒ **ALL 20 ROWS OK** | 一次性核查，不落盘（规约 §6 临时物不留在树里） |

---

## 4. 反向验证（注入违规 → 确认变红 → 撤掉 → 复绿）

注入的三条（都是「把本批新接的边剪掉」，不是改断言）：
1. `src/enterHandlerOrder.ts`：把 `blockComment` 那条（带 `order="last"`）整条搬到数组**最前面** ⇒ 次序表被调乱。
2. `src/editorTyping.ts`：删掉 `if (pairInsertionSuppressed(line, caret, isJavaLikeQuoteLanguage(languageId))) return 'plain'` 这一行 ⇒ 两条门槛不再生效。
3. `src/editorCodeBlock.ts`：把 `const structural = findCodeBlockRange(text, caret, language)` 换成 `const structural = null as never` ⇒ 合并边退回「只用括号扫描」。

| 步骤 | 命令 | 数字 |
| --- | --- | --- |
| 注入后 | `node --test tests/editor-enter-order.test.mjs tests/editor-enter-handlers.test.mjs tests/quote-handler-registry.test.mjs tests/editor-code-block.test.mjs` | 46 条 / **38 pass / 8 fail**（其中次序表文件 8 条里红 5 条） |
| 撤掉（`cp` 三个备份回 `src/`，删 `build/revbak`） | 本域 10 个文件全跑 | 104 条 / **104 pass / 0 fail** |

三条注入各自的红都能归因到对应判据：① 表次序（`表覆盖平台注册的那 7 条…` 与 `preprocess 那一段的本仓有效次序…`）
② `接进了引号链路…` 与 `两条门槛合起来…` ③ `合并块尾取 min…`/`合并块首取 max…`/`括号那半扫不到…`。

---

## 5. 零消费方自查

- `src/enterHandlerOrder.ts`：被生产代码 `src/enterHandlers.ts`（`smartEnterCommand` 的循环入口）消费 ⇒ 不是孤儿。
- `src/quoteHandlerRegistry.ts`：被生产代码 `src/editorTyping.ts`（`quoteAction` 的门槛、`isJavaLikeQuoteLanguage`）消费 ⇒ 不是孤儿。
- `src/structuralCodeBlock.ts` 的 B 半（`findCodeBlockRange`/`mergeBlockEnd`/`mergeBlockStart`）：**本批起有生产消费方**
  （`src/editorCodeBlock.ts:40` import + `codeBlockTarget` 调用），`search2` 报告里「B 半只过自己的测试」这条欠账已清。
- `node .tools/find-orphan-modules.mjs --gate` ⇒ 新增 0、门禁绿（数字见 §3）。
- 没有渲染任何无消费链路的 UI（本批一行界面都没动）。

---

## 6. 做不到 / 无法核实

| 条目 | 具体卡在哪一环 |
| --- | --- |
| 引号门槛 (b) 的 token 口径 | 上游读高亮迭代器的 token（`TypedQuoteImpl.java:86-97`），本仓没有 token 流 ⇒ 用「光标那一格那个字符」近似。差别出现在**跨边界**的场合：光标压在标识符中间、或注释 token 内部（前面才是 `/*`）时本仓判成「不允许」，与上游一致；但「光标在 `foo` 结束处、后面紧跟空白」这类**上游取到空白 token 而放过**的情形，本仓同样放过，反过来若后面紧跟 `(` 而上游 token 归属不同，可能判反 —— 无 token 流 ⇒ 无法核实到格。 |
| 引号自动配制的语言覆盖面 | 表里 20 条注册有档案，但本仓能真正送进 `quotesFor` 的语言档只有 `java`/`cpp`/`typescript`/`other`/`undefined`（`src/fileTypeDetection.ts:244` `EDITOR_FORCED_LANGUAGES`）⇒ JSON/YAML/XML/Python/… 的 handler 在本仓**没有落点**，不是没核到，是编辑器没有那门语言的档。TS/JS 与 C/C++ 的 `QuoteHandler` 不在这棵社区树里（商业插件）⇒ **无法核实**，不写规则。 |
| `SURROUND_SELECTION_ON_QUOTE_TYPED` | `CodeInsightSettings.java:137`（默认 true）+ `SelectionQuotingTypedHandler.java:47`；本仓 `EditorSettings` 无此键（`settingsModel.ts` 全文无）⇒ `wrap` 恒开。开假设置 = 派单 §3 禁止。 |
| `SMART_INDENT_ON_ENTER` 关掉时 `Default` 与 `DefaultForceIndent` 的差别 | 差别只在 `EnterHandler.java:163-174` 的光标后调；本仓没有这条设置键 ⇒ 表里如实记 `result` 两档、`applyEnterHit` 按上游默认档（true）走。要真分档得先加设置键（`src/settingsModel.ts` 是主代理独占）。 |
| `EnterAfterJavadocTagHandler`、`InjectedIndentPostProcessor`、`FormatterTagHandler.getEnabledRanges`、`LanguageLineWrapPositionStrategy`、`ParagraphFillHandler` 的 prefix/postfix 两支、`TodoConfiguration.isMultiLine()` 两支 | 分别需要 javadoc PSI / injected fragment / `// @formatter:off` 标记表 / 逐语言断词策略 / `Commenter` 前后缀（纯文本两条 getter 都返回 `""`，`ParagraphFillHandler.java:212-218`，所以纯文本档**本来就没有**）/ todo 图案表。前四项本仓没有那一层 ⇒ 记未做；todo 那两支归别的桶。 |
| 代码块「缩进参考线」那一支（`CodeBlockUtil.java:49-52`/`:86-89`） | 要 `editor.getIndentsModel().getCaretIndentGuide()` 的模型；本仓 `src/editorIndentGuides.ts` 只画线不出模型 ⇒ 不搬，`src/editorCodeBlock.ts:32-35` 已写明走第 3 支。 |
| Python 结构支持在生产里可达吗 | 不可达：本仓编辑器没有 Python 语言档（`src/editorLanguage.ts:15-21`）。合并边已接、判据是**单元级**（直接调 `codeBlockTarget(…, 'python')`），不宣称用户可见。 |

---

## 7. 需要主代理接的线

全部写在 `docs/wiring-requests-2026-10-06-edact3.md`（W-1 引号开关键位、W-2 `editorLanguageId` facet 挂载、
W-3 判词升档文案）。**没有改 `scripts/verdict_table.py`，没有改 `docs/inventory/*.md`**（都是保留文件）。

---

## 8. 留痕 / 订正（规约 §1「要改别人的结论就留痕」）

1. **派单给的两个上游路径在这棵树里不存在**，已按实际路径核对：
   * 派单：`platform/ide/srcCodes/.../editor/actions/EnterBetweenBracesHandler.java` ⇒ 实际
     `platform/lang-impl/src/com/intellij/codeInsight/editorActions/enter/EnterBetweenBracesHandler.java`
     （该类 `:13` 已 `@Deprecated`，实体 `EnterBetweenBracesFinalHandler.java:41`）。
   * 派单：`platform/lang-api` 里的 `QuoteHandler` ⇒ 实际
     `platform/lang-impl/src/com/intellij/codeInsight/editorActions/QuoteHandler.java`（`platform/lang-api` 下没有这个文件）。
   * 派单：`CodeBlockUtil.java:110/:178` ⇒ **成立**（本批逐行读过 `:108-120`、`:176-188`）。
2. **`docs/inventory/verdict-platform_rest.md:55` 的判词 ⑥ 写「`FillParagraphAction`（纯文本可做，未做）」已过期**：
   本仓 `src/editorFillParagraph.ts`（153 行）+ `tests/editor-fill-paragraph.test.mjs` 早在场，且命令已注册进
   `src/editorCommands.ts:39`（菜单行 `PlatformActions.xml:494` 的次序也写在 `src/editorCommands.ts:219`）。
   ⇒ 判词应升档（写法给在 W-3），本批不改 `docs/inventory/*.md`。
3. `src/enterHandlers.ts` 与本批一度把 `INSERT_BRACE_ON_ENTER` 的开关位置写成 `:50-51` ⇒ 实际开关本体在
   `enter/EnterAfterUnmatchedBraceHandler.java:84-86`（返回 0 后在 `:50-51` 短路），已就地改正。
4. `search2` 的 W-1' 请求里那条断言自陈「**故意留得松**…请接的那侧改成实测值」⇒ 本批换成实测值
   （`'(if a:\n    x = 1\n)\n'`：括号那半 17 / 结构那半 `{from:0,to:16}` ⇒ `min` 给 16、`max` 给 1；
   `def f(): … elif …` 那段：结构那半 `{from:13,to:82}`、括号那半 null ⇒ 两支互备）。数值全部是
   `node --input-type=module` 实测，不是估的。
5. 本批改写了 3 条**源码形状**断言 + 1 个锚点字符串（原因：重构后旧锚点字面量不存在）。
   **没有放松任何断言**：次序那条从「数源码里四个 `indexOf`」改成「数表里的 rank/id/xml 三列 + 数实现体次序」，
   能钉的面更宽（现在连注册行号与 `order="last"` 的效果都钉住了）；理由与上游行号写在各条测试的注释里。

---

## 9. 本批没做但下一步值得做的两条（不占用保留文件）

1. `wrapToMargin` 的**制表符视觉宽度**（`LineWrappingUtil.java:112-113` 用 `tabSize`/`spaceSize`）：
   纯文本段落里带 `\t` 时本仓折行点会偏半格，改一个入参就能对齐口径，判据可写「同样落点，带 tab 的行比不带 tab 的行早断」。
2. 引号门槛 (b) 想真正判准需要 token 流 —— 本仓有 `@codemirror/language` 的 `syntaxTree`，
   Java/JSON/HTML 三种语言能拿到真实 token；把「近似」换成「有语法树时用语法树、没有时退回近似」是纯模块活。
