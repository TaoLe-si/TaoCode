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

---

# §10 收口复核（2026-10-06 第二任：只做收尾，不新起功能）

上面 §1–§9 是**第一任**（撞预算那位）写的。本 §10 由收口代理**重新实测**：每个落点行号都自己打开文件数过、
每条上游坐标都自己 `awk` 出那几行对过、门禁数字都是本轮自己跑的。原 §1–§9 一个字没改（规约 §1 要求留痕而不是覆盖）；
**发现 §1/§2 的行号有 9 处漂移**，勘误在 §10.6，判词与结论本身没有一条被推翻。

## 10.1 判词表（条目原文 → 现状 → 证据 `文件:行号` → 档位建议）

「条目原文」取自保留文件 `docs/inventory/verdict-platform_rest.md:55`（`lp/editor-actions` 那一行，本批**不改**它，
升档写法给在 `docs/wiring-requests-2026-10-06-edact3.md` W-3）。行号按本轮工作区（该文件同时被别的代理在改，
建议按原文子串定位，别只信行号）。

| 条目原文（判词里的说法） | 现状（本轮实测） | 证据：本仓 `文件:行号` | 证据：上游 `文件:行号`（本轮亲自取过那几行） | 档位建议 |
| --- | --- | --- | --- | --- |
| ②「回车家族 `enter/*`（`EnterBetweenBracesHandler`/`EnterAfterUnmatchedBraceHandler`/`EnterInStringLiteralHandler`/`EnterInLineCommentHandler`）**没有 IDEA 语义**（`basicSetup` 的换行缩进承担）」 | **已不是这样**：四条都有实现，且问法次序做成了数据表 + 表驱动循环（`order="last"` 的效果也在表里） | `src/enterHandlerOrder.ts:43`（五档）、`:71-122`（7 条注册：`rank` 1–7 落在 `:73/:80/:87/:94/:101/:109/:116`）、`:139-141`（`preprocessSteps`）、`:158-170`（循环）、`:173-175`（要不要插换行）；`src/enterHandlers.ts:98-100`（import 表）、`:412-424`（`EnterContext`）、`:430-478`（`ENTER_IMPLS` 四支：①`:432` ②`:446` ③`:456` ④`:468`）、`:489-502`（`applyEnterHit`）、`:510-529`（命令，循环在 `:527`） | `platform/lang-impl/src/com/intellij/codeInsight/editorActions/EnterHandler.java:136`（`for (delegate : EP_NAME.getExtensionList())`）、`:142-144`（`Stop` ⇒ `return`）、`:145-153`（非 `Continue` ⇒ 置 `forceIndent`/`forceSkipIndent` 后 `break`）；`enter/EnterHandlerDelegate.java:17`（接口）、`:25-26`（`enum Result { Default, Continue, DefaultForceIndent, DefaultSkipIndent, Stop }`） | ② 由「没有 IDEA 语义」改成「已做，6 条里 4 条移植 + 2 条如实记未做」；族档 `lp/editor-actions` 仍留 `[~]`（欠 `EnterAfterJavadocTagHandler` 与 tab 宽度那一档） |
| ①「缺：逐语言 `TypedHandlerDelegate`/**`QuoteHandler`**/`BraceMatcher` 扩展点」 | **「逐语言 `QuoteHandler`」这半已做**：20 条逐语言注册 + 两条「这次不补配对」的门槛进了链路；`BraceMatcher` 那半属别的批（`src/editorBrackets.ts`） | `src/quoteHandlerRegistry.ts:62`（三个触发字符）、`:64-166`（20 条注册）、`:175-178`（门槛 a）、`:188-197`（门槛 b）、`:200-207`（两条合并）、`:210-218`（按语言查表 + `isJavaLikeQuoteLanguage`）；`src/editorTyping.ts:54`（import）、`:129-149`（`quoteAction`，门槛在 `:147`）、`:158-165`（`AUTOINSERT_PAIR_QUOTE` 降级）、`:180-240`（`smartQuotes`，开关问在 `:193`、语言档传在 `:216`）；face 三支 `src/editorQuoteFaces.ts:37/:58/:63/:79/:92/:100/:105` | `TypedQuoteImpl.java:52`（`'"' == charTyped \|\| '\'' == charTyped \|\| '`' == charTyped`）、`:89-97`（`javaLike.isAppropriateElementTypeForLiteral`）、`:104-105` 与 `:117-118`（`!Character.isUnicodeIdentifierPart(...)`）；`JavaQuoteHandler.java:31`（`implements JavaLikeQuoteHandler, MultiCharQuoteHandler`）、`:33-36`（那张 token 集） | ① 拆成两写：`QuoteHandler` 逐语言那一半 `[x]`；`TypedHandlerDelegate` 全族维持「部分」 |
| ⑥「其余无落点：… `FillParagraphAction`（**纯文本可做，未做**） …」 | **过期**：早已落盘且命令 + 菜单都在，本批只做逐行复核与一档差档登记 | `src/editorFillParagraph.ts:39`（`RIGHT_MARGIN` 默认 120）、`:61-74`（段落边界）、`:81-99`（折行，两条跳过在 `:89-91`）、`:107-121`（一次填充）、`:133-147`（命令，`:136` 判纯文本）、`:150-153`（`isPlainText`）；命令注册 `src/editorCommands.ts:39`（import）+ `:227`（`'paragraph.fill'`）；菜单行 `src/menus/editMenu.ts:114-122` | `fillParagraph/ParagraphFillHandler.java:208-210`（`return psiFile instanceof PsiPlainTextFile;`）；`fillParagraph/FillParagraphAction.java:20`（类声明）、`:43`（`isValidForFile`） | ⑥ 里 `FillParagraphAction` 从「未做」升 `[x]`；`docs/inventory/platform_rest_verdict_table.md:8005-8006` 两行「从未出现」应改判 `[x]` 并指本仓落点（生成物，交主代理重算） |
| ⑥ 里同批点名的 `CodeBlockStart/End*` | **两支合并已接**（括号扫描 + 结构支持），结构那半按语言注册、本仓只有 Python 有档案 ⇒ 对用户不可见，但边是真的 | `src/editorCodeBlock.ts:41`（import）、`:168-173`（`codeBlockTarget`，`:169` 问结构、`:171/:172` 合并）；`src/editorCommands.ts:45`（import facet）、`:175-…`（命令，`:179` 取 `state.facet(editorLanguageId)`）；`src/structuralCodeBlock.ts:471-474`（`findCodeBlockRange`）、`:480-484`（`mergeBlockEnd` = `Math.min`）、`:487-491`（`mergeBlockStart` = `Math.max`）；宿主挂载**已落地**：`src/components/CodeEditor.vue:486` 用 `editorLanguageIdExtension(props.language)` | `CodeBlockUtil.java:108-120`（`:110` 问 `CodeBlockSupportHandler.findCodeBlockRange`、`:111-116` 两支互备、`:118` `Math.min`）、`:176-188`（`:178`、`:186` `Math.max`） | `CodeBlockStart/End` 从「无落点」升 `[~]`（能打开的语言里退化成括号档，理由写在 `src/editorCodeBlock.ts:162-166`） |

**族级判词**：`lp/editor-actions` 建议 **`[~]`**（不是 `[x]`）。还差的具体三档：
① `EnterAfterJavadocTagHandler`（要 javadoc PSI）；② `wrapToMargin` 的制表符视觉宽度（`LineWrappingUtil.java:112-113`）；
③ 三格设置的**宿主那一行**（见 W-1，接上前那三格仍是空旋钮）。

## 10.2 改动文件清单（`git show 11a736e~1` 为「前」，工作区为「后」）

本域代码全部在 **11a736e** 这一次混合提交里（12 路并行的收口提交），所以「前」取该提交的父本 `dfbda4e`：
差值里可能混着别的域在同一文件上的改动，逐条标注。

| 文件 | 前（`11a736e~1`） | 后（本轮实测 `wc -l`） | 归属 |
| --- | --- | --- | --- |
| `src/enterHandlerOrder.ts` | 新文件 | **175** | 本域（edact3 新建） |
| `src/quoteHandlerRegistry.ts` | 新文件 | **218** | 本域（edact3 新建） |
| `src/structuralCodeBlock.ts` | 新文件 | **491** | 搜索域 `search2` 建、本域接其 B 半消费方 |
| `src/enterHandlers.ts` | 290 | **530** | 本域（第一任 §2 记的「前 486」是它**运行时**的工作区中间态，见 10.6） |
| `src/editorTyping.ts` | 185 | **255** | 本域（第一任估的 229 偏低） |
| `src/editorCodeBlock.ts` | 150 | **173** | 本域 |
| `src/editorCommands.ts` | 263 | **280** | 本域 + 别的域在同文件的在途改动 |
| `src/editorFillParagraph.ts` | 153 | **153** | 本域复核，**本批没改**（第一任同样只复核） |
| `src/editorQuoteFaces.ts` | 110 | **110** | 承前批，本批没改 |
| `src/editorEnterBlockComment.ts` | 212 | **216** | 本域（第 4 实参注释）+ 别的域 |
| `tests/editor-enter-order.test.mjs` | 新文件 | **125**（8 条） | 本域新建 |
| `tests/quote-handler-registry.test.mjs` | 新文件 | **123**（7 条） | 本域新建 |
| `tests/structural-code-block.test.mjs` | 新文件 | **204**（15 条） | 搜索域交付，本域跑它做零消费方核对 |
| `tests/editor-code-block.test.mjs` | 81 | **214**（17 条） | 本域 +4 条、搜索域 facet 4 条 |
| `tests/editor-enter-handlers.test.mjs` | 145 | **234** | 本域（2 条源码形状断言跟着重构） |
| `tests/editor-enter-block-comment.test.mjs` | 142 | **158** | 本域（1 条锚点跟着调用点改） |
| `tests/editor-quote-faces.test.mjs` | 102 | **130** | 承前 + 本域 1 个锚点 |
| `tests/editor-fill-paragraph.test.mjs` | 74 | **74** | 本批没改 |
| `src/components/EditorEnterKeysFields.vue` | 新文件 | **35** | `setkeys` 域（与本域的两条开关系，见 W-1） |

派单点名的 `src/editorActions*.ts` **在本仓不存在**（`ls src \| grep -i editoraction` 空）；本域的文件名是
`src/enterHandlers.ts` / `src/enterHandlerOrder.ts` / `src/editorCommands.ts` / `src/editorTyping.ts`。
同理 `tests/editor-actions` 也没有同名文件 ⇒ 本轮「本域测试」按 §3 那张表列的 10 个文件跑（见 10.3）。

## 10.3 门禁数字（**本轮自己实跑**，不是抄第一任的）

| 命令 | 本轮数字 | 与第一任 §3 的差异 |
| --- | --- | --- |
| `node --test`（本域 10 个文件：enter-handlers / enter-block-comment / enter-order / quote-faces / quote-handler-registry / fill-paragraph / code-block / smart-enter / brackets / inline-completion-typing） | **104 条 / 104 pass / 0 fail** | 与第一任**完全一致** |
| 同上 + `tests/structural-code-block.test.mjs`（11 个文件） | **119 条 / 119 pass / 0 fail** | 第一任没把搜索域那份算进本域 |
| `node --test tests/commit-check*.test.mjs tests/editor-commands.test.mjs`（派单体检里点到的两条相邻面） | **78 条 / 78 pass / 0 fail** | 新增记录（本域没动这些文件，只是确认没被我牵连） |
| `npx vue-tsc -b --force` | 起手（本轮 10:5x）**0 错**；收工复跑 **4 错**：`src/components/RunConsole.vue(278,27)/(285,23)/(347,26)` TS2304 `request`、`src/lspProgress.ts(147,32)` TS2304 `lspServerMessages` | 四条**都不在本域**（那两个文件此刻是 `M` 在途，别的代理正在改）；本域改过的 9 个文件 **0 错**。第一任当时记的是 2 条（`refactorPreview.ts`/`workspaceLifecycle.ts`），那两条现已消失 ⇒ 并行收口的正常漂移 |
| `node --test tests/module-size.test.mjs` | **5 / 5 绿** | 一致；上限未动、无豁免。新模块 175/218/491 行都低于 900 |
| `node .tools/find-orphan-modules.mjs --gate` | **已登记孤儿 8 / 基线 8 · 新增 0 · 本轮清掉 0 ⇒ 门禁绿**（词法自检 0 异常） | 第一任记的「登记 9」是当时的中间态；现在基线是 8 条（`popupLiveUpdate.ts` 那行被 tw3 按死代码处置删掉了） |
| `node .tools/find-param-props.mjs` | **共 0 处参数属性** | 一致 |
| `node .tools/find-ts-in-mjs.mjs` | **干净：`tests/*.mjs` 全部是纯 JavaScript** | 一致 |
| `node .tools/find-missing-ext.mjs` | **扫描 1303 个文件，干净** | 第一任 1302 ⇒ 期间别人加了 1 个文件，非本域 |
| `node --test tests/source-citations.test.mjs tests/source-citation-anchors.test.mjs` | 11 条 / **10 pass / 1 fail**。失败的是 `moved :: src/components/DebugConsolePane.vue \| platform/execution-impl/src/com/intellij/execution/actions/PauseOutputAction.java:19-19`（快照里有、仓里指不到） | 第一任记的 3 条 fail（vcs2 两条假路径 + bucket14b/settings-parity/trustedProjects 的 moved）已由 citefix 与本域无关的代理收掉；**剩这一条是他域（调试台）在途**，`src/components/DebugConsolePane.vue` 与 `docs/inventory/citation-anchors.json`（+45 行）都是 `M`。本域两条 `batch`/`wiring` 文档里的引用**全部**过了 `source-citations.test.mjs`（该条 11 条里 pass 的一部分：「仓里每一条带路径的上游引用都指得到」✔） |
| 20 条引号注册的行号自证（本轮重跑） | 脚本逐条取「文件:行号 ±2 行」比对 ⇒ **`rows=20 bad=0`** | 与第一任「ALL 20 ROWS OK」一致；本轮脚本落在 `build/`，用完已删 |

## 10.4 反向验证（本轮**重新注入**三条，不是复述第一任的 §4）

| 注入 | 做法（都是「剪掉本域新接的边」，没动任何断言） | 结果 | 撤掉后 |
| --- | --- | --- | --- |
| A 代码块合并边 | `src/editorCodeBlock.ts:169` 的 `findCodeBlockRange(text, caret, language)` 换成 `null` | `tests/editor-code-block.test.mjs` **17 条 / 13 pass / 4 fail**（红的正是「合并块尾取 min」`:118`、「括号那半扫不到 ⇒ 用结构那半」、「语言档经 facet 传到命令」、「嵌套复合语句」） | 17/17 复绿 |
| B 引号两条门槛 | `src/editorTyping.ts:147` 的 `if (pairInsertionSuppressed(…)) return 'plain'` 注释掉 | `tests/quote-handler-registry.test.mjs` **7 条 / 6 pass / 1 fail**（「接进了引号链路：`abc\|def` 中间敲引号」） | 7/7 复绿 |
| C 回车次序表 | `src/enterHandlers.ts:527` 的 `preprocessEnter(ENTER_HANDLER_ORDER, …)` 换成「只把表里 `blockComment` 那一条丢进循环」 | `tests/editor-enter-order.test.mjs + tests/editor-enter-handlers.test.mjs` **22 条 / 17 pass / 5 fail**（含「回车四条按上游有效次序问」与字面量/开关两条） | 22/22 复绿 |
| 全域 | 撤掉三条注入后 `node --test`（11 个文件） | —— | **119 条 / 119 pass / 0 fail** |
| 还原自证 | `git diff --stat -- src/editorCodeBlock.ts src/editorTyping.ts src/enterHandlers.ts` | **空**（三个文件逐字回到提交状态，没有 `git checkout/reset`，全靠 Edit 还原） | —— |

## 10.5 零消费方自查（派单点名那两条：结论都是**不是孤儿，不删**）

- `src/quoteHandlerRegistry.ts`（218 行）：**有真实生产消费方** —— `src/editorTyping.ts:54` 值 import
  `isJavaLikeQuoteLanguage`、`pairInsertionSuppressed`，调用点 `src/editorTyping.ts:147`（`quoteAction` 补配对之前）。
  另有测试 `tests/quote-handler-registry.test.mjs`。**不删**；`.tools/orphan-baseline.txt` 未改（8 条不变）。
  上一轮报的「孤儿红」是它刚落盘、`editorTyping.ts` 那条 import 还没写的时候；现在链已接。
- `src/structuralCodeBlock.ts`（491 行）：**两半都有生产消费方** —— B 半（代码块）
  `src/editorCodeBlock.ts:41` import + `:169` 调用（宿主经 `src/components/CodeEditor.vue:486` 的语言档 facet 把 `language` 送到）；
  A 半（结构化搜索）`src/structuralSearchModifiers.ts:47` import + `:402/:405` 调用
  （`src/structuralSearchConstraints.ts:347-348` 记的是同一条边）。**不删**。
- `src/enterHandlerOrder.ts`（175 行）：`src/enterHandlers.ts:98-100` import、`:527` 用表跑循环；宿主在
  `src/components/CodeEditor.vue:115-117`（`smartEnterCommand`）+ 键位 `Enter`（`tests/editor-enter-block-comment.test.mjs:140` 钉着）。
- 门禁实况：`已登记 8 / 基线 8 · 新增 0 · 清掉 0` ⇒ **绿**。本域三个新文件都不在孤儿名单里。
- **本轮唯一的「只过自己测试」观察**（文件级门禁抓不到，导出级）：`src/structuralCodeBlock.ts:459`
  `pythonCompoundKeywordRanges` 生产侧零消费方，只有 `tests/structural-code-block.test.mjs:19-20/127/133/143/149`。
  上游对应用途是 `AbstractCodeBlockSupportHandler.java:66-76` 的 `getCodeBlockMarkerRanges`（块面标记），本仓没有那个面。
  **本域不删**：那是搜索域（`search2`）交付的文件与判据，删它要连删 5 处断言，属越界 ⇒ 交主代理拍板（写法给在 W-4）。
- UI：本域一行界面都没动，没有新控件。相邻的 `EditorEnterKeysFields.vue`（`setkeys` 域交付）已由
  `src/components/SettingsDialog.vue:781` 渲染 ⇒ 不是零消费方组件；但那三格的**执行侧**还差保留文件里的一行 ⇒ 见 W-1。

## 10.6 勘误 / 留痕（规约 §1：改别人的结论要留痕）

第一任 §1/§2 的**结论**（哪条做了、哪条没做、上游行号）本轮逐条复核，**没有一条被推翻**；
`src/*` 的**行号有 9 处漂移**（并行编辑把行推下去了，属正常，不影响判词）。原写 → 实测：

| 位置 | 原写 | 实测（本轮数过） |
| --- | --- | --- |
| §1 enter 行「EP 声明与 7 条注册」 | `src/enterHandlerOrder.ts:69-141` | 表体 `:71-122`（`ENTER_RESULTS` 在 `:43`，`preprocessSteps` 在 `:139-141`） |
| §1 enter 行「逐个问 + break」 | `src/enterHandlerOrder.ts:163-175`、`src/enterHandlers.ts:505-530` | `preprocessEnter` 在 `:158-170`；`smartEnterCommand` 在 `:510-529`（`:505-509` 是它的注释） |
| §1 enter 行「五档 `Result`」 | `src/enterHandlerOrder.ts:47-52`（表里 `result`/`resultAt` 两列） | `result` 列 `:61-62`、`resultAt` 列 `:63-64`；`:47-52` 是 `EnterPhase` 与接口开头 |
| §1 enter 行「两条开关」 | `src/enterHandlers.ts:104-113`、`:449-451`、`:470-481` | `EnterLanguage` `:103-118`（`blockCloseOnEnter` `:110`、`insertBraceOnEnter` `:113`）；花括号那条的把关行在 `:457`；块注释那一支 `:468-477`（开关实参 `:471`）。`:449-451` 其实是**行注释**支的 `caretAdvance` |
| §1 quote 行「门槛 (a)」 | `src/quoteHandlerRegistry.ts:182-187` | `nextCharBlocksPair` 在 `:175-178`（`:180-187` 是门槛 (b) 的注释） |
| §1 quote 行「门槛 (b)」 | `src/quoteHandlerRegistry.ts:189-207` | `appropriateElementForLiteral` `:188-197`、`pairInsertionSuppressed` `:200-207`（写 189 起会漏掉函数声明那一行） |
| §1 quote 行「三级取 handler」 | `src/quoteHandlerRegistry.ts:44-58`（头注释）、`:56`（`QUOTE_TRIGGER_CHARS`） | 头注释里对应段落 `:9-16`；`QUOTE_TRIGGER_CHARS` 在 `:62` |
| §1 quote 行「注册表」 | `src/quoteHandlerRegistry.ts:60-179` | `QUOTE_HANDLER_REGISTRATIONS` `:64-166` |
| §1 codeblock 行「两支合并」 | `src/editorCodeBlock.ts:32-40`（import）、`:147-168`（`codeBlockTarget`） | import 在 `:41`（`:34-40` 是注释）；`codeBlockTarget` `:168-173`（doc 注释 `:153-167`） |
| §1 paragraph 行「命令注册」 | `src/editorCommands.ts:39` | `:39` 是 import；命令表里的落点是 `:227`（`'paragraph.fill'`） |

另两处**订正别人的结论**（不是行号漂移）：

1. `docs/wiring-requests-2026-10-06-editorinput.md:58-59`（editorinput 域的 W-1）断言：
   「`tests/editor-enter-block-comment.test.mjs` 末条钉的是 `smartEnterCommand(() => smartEnterLanguageFor(` 这个形状，
   **改成上面那段仍然匹配**」—— **实测不成立**。该条断言是
   `tests/editor-enter-block-comment.test.mjs:147` `/smartEnterCommand\(\(\) => smartEnterLanguageFor\(/`，
   而它给的「改法一」把箭头函数换成了 `smartEnterCommand(() => { const style = … })`，那串字面量就不再出现 ⇒
   照抄会让那条判据变红。本轮把**两条**可照抄写法（保形状的 / 改断言的）都给在 W-1，并按规约给出不放松的替换断言原文。
2. `docs/wiring-requests-2026-10-06-editorinput.md:55-57`（同一条 W-1 的「行数提醒」）说改法一净 +3 行会顶到
   `CodeEditor.vue` 的 1147 行上限 —— 本轮核对 `tests/module-size.test.mjs` 里 `CodeEditor.vue` 的上限仍是**已登记值、只许降**，
   所以那条提醒成立；本轮给的写法把装配留在 `src/enterHandlers.ts`（本域文件，不占宿主行数）。

## 10.7 本域收口后的「做不到 / 待接线」增补

| 条目 | 具体卡在哪一环（本轮核实过） |
| --- | --- |
| 三格设置没有执行侧 | 键（`src/settingsModel.ts:427/429/431`，默认值同在 `:223`）与界面（`src/components/EditorEnterKeysFields.vue:29/31/33`，挂在 `src/components/SettingsDialog.vue:781`）都在，消费方也在（`src/editorTyping.ts:181/193`、`src/enterHandlers.ts:457/471`），**只差 `src/components/CodeEditor.vue:115-117` 与 `:968` 那两行** —— 两个文件都是保留文件 ⇒ W-1。 |
| `SURROUND_SELECTION_ON_QUOTE_TYPED` | 上游默认 true（`CodeInsightSettings.java:137`，问在 `SelectionQuotingTypedHandler.java:47`），本仓 `settingsModel.ts` 无此键 ⇒ `wrap` 恒开；补键要动保留文件（且要按「旧存档缺键补默认」的规矩走）。 |
| `SMART_INDENT_ON_ENTER` | 同上：没有键 ⇒ `Default` 与 `DefaultForceIndent` 两档在本仓观察不到差别（`EnterHandler.java:163-174` 的差别只在该键关掉时存在）。表里如实记两档。 |
| `pythonCompoundKeywordRanges` 只有测试消费方 | 见 10.5 末条：属搜索域文件 ⇒ 不越界删；处置写法给在 W-4。 |
| 全仓 `vue-tsc` 收工 4 错 / 引用门 1 条 `moved` | 都不在本域（10.3 各行给了文件与原因）；本轮**没有**为了让数字好看去动别人的文件，也没重算快照（`docs/inventory/citation-anchors.json` 是别人在途的 `M`）。 |
| Python 结构支持的用户可见性 | 本仓编辑器没有 Python 语言档（`src/editorLanguage.ts:15-21`）⇒ 合并边接了但真实文档触发不了；判据是单元级（直接给 `codeBlockTarget(…, 'python')`），不宣称用户可见。 |

**需要主代理接的线**：`docs/wiring-requests-2026-10-06-edact3.md`（W-1 三格设置的宿主两行 + 同步判据、
W-2 状态记录（已落地，无需再接）、W-3 判词升档逐字改法、W-4 `pythonCompoundKeywordRanges` 的处置）。

