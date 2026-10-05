# 桶 5b · 回车家族 / 逐语言引号与括号 / 粘性行 · 2026-10-06

范围（派单收窄的三件事）：① `enter/*` 回车家族；② 逐语言 `QuoteHandler`/`BraceMatcher` 与配对括号；
③ `lp/sticky-lines` 的缺口。上游基准树 `D:\Backup\Downloads\intellij-community-master\intellij-community-master`，
全部结论逐行核过；核不到的写「无法核实」。

## 判词

判定图例：`做` = 本批落地；`修` = 本仓已有但有回归/错引，已改；`架` = 架构不等价，用本仓架构还原；
`缺` = 没做（下面「做不到」有具体卡点）；`—` = 无法核实。

### ① 回车家族 `enter/*`（族 `lp/editor-actions`）

| 族 | 项 | 判定 | 上游依据（相对路径:行号） | 本仓落点（文件:行号） | 说明 |
|---|---|---|---|---|---|
| lp/editor-actions | EP 注册表与问法次序 | 做 | `platform/lang-impl/resources/intellij.platform.lang.impl.xml:399`、`:1159-1166`、`:1171`；`platform/lang-impl/src/com/intellij/codeInsight/editorActions/EnterHandler.java:181`、`:145-149` | `src/enterHandlers.ts:3-15` | 注册表顺序 = 逐个问的顺序（`EnterHandler.java:181`）。本仓把注释两条前置到字面量之前，理由写在同一处：词法层没有 token 类型，`// 说 "abc` 里的引号会被字面量那条误切。判据 `tests/editor-enter-handlers.test.mjs:137-145` |
| lp/editor-actions | `EnterInLineCommentHandler` | 修 | `platform/lang-impl/src/com/intellij/codeInsight/editorActions/enter/EnterInLineCommentHandler.java:45-46`、`:52-53`、`:56-62`、`:63-83`（`:65-67`/`:73-75`/`:76-77`/`:80`/`:82`）、`:85-88`、门槛 `:94`/`:97`/`:103-105` | 规则 `src/enterHandlers.ts:87-131`；命令 `src/enterHandlers.ts:225-235` | **回归修掉**：上一任只落前缀、没执行 `:88` 的 `Result.DefaultForceIndent` ⇒ 行注释里回车等于把注释复制一遍而不换行。现在补完前缀再走默认回车、按 `:85-87` 挪光标。判据 `tests/editor-enter-handlers.test.mjs:75-81`（反向验证过） |
| lp/editor-actions | `EnterInLineCommentHandler` 的 TODO 分支 | 缺 | 同文件 `:68-72`（`TodoConfiguration.isMultiLine()` + `EnterInCommentUtil.isTodoText`，`enter/EnterInCommentUtil.java:28-44`） | 无 | 分隔多补一个空格那一档没做：依赖 todo 图案表与本仓 todo 面板（`src/todo*` 不在我名下）。见「做不到」 |
| lp/editor-actions | `EnterInBlockCommentHandler` | 做 | `enter/EnterInBlockCommentHandler.java:38-39`、`:42-43`、`:48-51`、`:53-54`、`:62-68`、`:86-99`（`:96`/`:97`/`:98`）、`:103-120`；闭合判据 `EnterHandler.java:200-210`；开关默认值 `platform/analysis-impl/src/com/intellij/codeInsight/CodeInsightSettings.java:132`；前缀字面量 `java/java-psi-impl/src/com/intellij/lang/java/JavaCommenter.java:27-28`/`:32-33`/`:62-63`/`:67-68`（`:37-44` 返回 null ⇒ 块注释不嵌套） | 新增 `src/editorEnterBlockComment.ts:63`/`:74`/`:108`/`:121`/`:160-215`；接入 `src/enterHandlers.ts:59`、`:237-247` | 本批新写的模块（上一任只留了 import 与 `EnterLanguage.block` 字段，命令里从没调用 ⇒ 死引用）。词法扫描代替高亮迭代器。判据 `tests/editor-enter-block-comment.test.mjs`（12 条） |
| lp/editor-actions | `EnterInBlockCommentHandler` 的 TODO 额外缩进 | 缺 | 同文件 `:70-84` | 无 | 同上：`TodoConfiguration` 图案表不在我名下 |
| lp/editor-actions | `EnterInBlockCommentHandler` 的文档注释那一支 | 缺 | 同文件 `:48-51`（让给文档注释族）；接手方 `enter/EnterAfterJavadocTagHandler.java`（注册 `intellij.platform.lang.impl.xml:1171`）、`EnterHandler.java:417-428` | 无 | 与上游同样「退出」，但上游退出后有人接、本仓没人接：javadoc 生成要靠 PSI 找方法声明。见「做不到」 |
| lp/editor-actions | `EnterAfterUnmatchedBraceHandler` | 做 | `enter/EnterAfterUnmatchedBraceHandler.java:84-87`（`INSERT_BRACE_ON_ENTER`，`CodeInsightSettings.java:130` 默认 true）、`:99-114`（`:113` 至少一个）、`:135-144`（`:139-140`）、`:173`、`:230-250`、`:322-378`（`:327-329`、`:369-372`） | `src/enterHandlers.ts:133-163`（计数）、`:166-188`（插入）、`:265-273`（命令） | 上一任的行号我逐条复核**成立**（没有订正）。`:139-140` 那条要靠 PSI 找位置 ⇒ 只在「光标后面就是行尾」时动手，其余交回默认回车 |
| lp/editor-actions | `EnterInStringLiteralHandler` | 做 | `enter/EnterInStringLiteralHandler.java:44-48`、`:66-81`（`:69` 跳过转义、`:71-72` 插入、`:73-74` caretAdvance、`:75-77` 另一档）；连接符 `java/java-frontback-impl/src/com/intellij/codeInsight/editorActions/JavaQuoteHandler.java:83-86` | `src/enterHandlers.ts:191-210`、`:250-256` | 旧注释写的 `:68-82` 与类名简称（`EnterAfterUnmatchedBraceHandler.java:322-378` 那种省略）已改成可核的完整路径。`BINARY_OPERATION_SIGN_ON_NEXT_LINE`（`:75-77`）本仓没有那张 code-style 表 ⇒ 按默认档 |
| lp/editor-actions | `EnterBetweenBracesHandler` | 架 | `enter/EnterBetweenBracesHandler.java:13`（`@Deprecated`）、`:21-26`；`enter/EnterBetweenBracesDelegate.java:80-81`（只有 `()` 与 `{}`）；实体 `enter/EnterBetweenBracesFinalHandler.java` | `node_modules/@codemirror/commands/dist/index.js:1514-1524`（`isBetweenBrackets`），经 `src/components/CodeEditor.vue:909` 的 Enter→`smartEnter` 回落 | 本仓不重复实现。三条差别照实记（`src/enterHandlers.ts:44-58`）：上游不认 `[]`；上游要「两侧同一对且不在同一 PSI 元素」；CodeMirror 要两个括号同一条语法线且中间无非空白 |
| lp/editor-actions | 回车家族键位 | 做 | `platform/platform-resources/src/keymaps/$default.xml:800-801`（`EditorEnter` = ENTER）、`:87-89`（`EditorCompleteStatement` = Ctrl+Shift+ENTER） | `src/components/CodeEditor.vue:909`（Enter 键已绑）、`src/editorCommands.ts:212`（`statement.complete`） | 键位行号已复核；`src/smartEnter.ts` 头注释引的 `:87-89` 成立 |
| lp/editor-actions | 判据 | 做 | 上面各行 | 新增 `tests/editor-enter-handlers.test.mjs`（14 条）、`tests/editor-enter-block-comment.test.mjs`（12 条） | `enterHandlers.ts` 的四个导出此前**零测试**，这是补齐 |

### ② 逐语言 QuoteHandler / BraceMatcher 与配对括号

| 族 | 项 | 判定 | 上游依据（相对路径:行号） | 本仓落点（文件:行号） | 说明 |
|---|---|---|---|---|---|
| lp/editor-actions | `quoteHandler` 扩展点（按文件类型/语言各一份） | 做 | `platform/lang-impl/src/com/intellij/codeInsight/editorActions/QuoteHandlerEP.java:16-27`（EP 名 `:18`）；`platform/lang-impl/resources/intellij.platform.lang.impl.xml:405`、`:408`、`:1020`（TEXT 用 `CustomFileTypeQuoteHandler`） | `src/editorTyping.ts:47-56`（`LANGUAGE_QUOTES` 表） | Java 那条注册在 `java/java-frontback-impl/resource/intellij.java.frontback.impl.xml:74`（`quoteHandler fileType="JAVA"`） |
| lp/editor-actions | `QuoteHandler` 四个问法的行号 | 修 | 真实行号：`platform/lang-impl/src/com/intellij/codeInsight/editorActions/QuoteHandler.java:28`（接口）、`:40` `isClosingQuote`、`:49` `isOpeningQuote`、`:64` `hasNonClosedLiteral`、`:66` `isInsideLiteral`；`:51-57` 说明「插入之后才问」 | `src/editorTyping.ts:10-24` | **订正**：旧注释的 `:26-35`/`:37-56`/`:58` 是上一任手抄错的（`tests/editor-brackets.test.mjs:112-118`、`src/editorTyping.ts` 表注释里同样错的已一并改） |
| lp/editor-actions | 多字符引号：跳过收尾 face | 做 | `java/java-frontback-impl/src/com/intellij/codeInsight/editorActions/JavaQuoteHandler.java:58-63`（`end - start >= 5 && offset >= end - 3`）；`QuoteHandler.java:18-19` 指明多字符要 `MultiCharQuoteHandler`（`JavaQuoteHandler.java:31` 实现它） | 新增 `src/editorQuoteFaces.ts:79-90`、`:105-110`；接线 `src/editorTyping.ts:127-145` | **订正**：旧注释写的 `JavaQuoteHandler.java:36` 是别处，真实是 `:31` |
| lp/editor-actions | 多字符引号：敲完开 face 补配对 + 插 `\n"""` + 光标停位 | 做 | `JavaQuoteHandler.java:104-108`（`getClosingQuote`，`offset == start + 3`）、`:111-128`（`hasNonClosedLiteral`，`:118` 凑齐 `"""`、`:120-124` 用后面出现次数的奇偶判歧义）、`:134-149`（`:136` 插 `"\n\"\"\""`、`:148` 光标到 `endOffset - 3`） | `src/editorQuoteFaces.ts:37-56`（face 出现表）、`:63-77`（开 face 判）、`:92-100`（插入串与停位） | 判据 `tests/editor-quote-faces.test.mjs`（9 条）。已知差别写在模块头：`:130-132` 要求语言级别 ≥ TEXT_BLOCKS，本仓没有语言级别这一层 |
| lp/editor-actions | `AUTOINSERT_PAIR_QUOTE` 开关 | 缺 | `QuoteHandler.java:10-20`（类注释指向 `CodeInsightSettings#AUTOINSERT_PAIR_QUOTE`） | 无 | 本仓 `EditorSettings`（`src/settingsModel.ts:384-385` 那一族）没有这一项 ⇒ 保留文件，走接线请求 W-4 |
| lp/editor-actions | C/C++、TS/JS 的 quote handler | — | `find` 社区树：`plugins/` 里能核到的是 groovy/jsonpath/markdown/mermaid/sh/toml/xpath（都不是本仓四种编辑器语言），C++ 在 CLion、TS/JS 在商业 JS 插件 | 表里不给（`src/editorTyping.ts:47-52`） | 本仓 `EDITOR_LANGUAGES` 只有 `java|cpp|typescript|other`（`src/languages.ts:8`）⇒ 不给就不接管，继续由 CodeMirror `closeBrackets` 承担 |
| lp/editor-actions | 语言侧 `PairedBraceMatcher`（`<>` 算不算括号） | 修 | `platform/analysis-api/src/com/intellij/lang/PairedBraceMatcher.java`；Java：`java/java-frontback-impl/src/com/intellij/codeInsight/highlighting/JavaPairedBraceMatcher.java:12`（继承 `PairedBraceAndAnglesMatcher`）、`:22-24`（构造器）、`:26-34`（`lt()`/`gt()`）、`:13-20`（TYPE_TOKENS） | `src/editorBrackets.ts:131-160` | **订正**：旧注释写 `:11`/`:31-38`/`:16-21` 三处都对不上（该文件只有 35 行）。另：旧注释里的 `BraceMatcher.findMatchingBracket` 返回 `BraceMatch` 这一对符号在本 checkout **零命中**（`grep -rn findMatchingBracket\|class BraceMatch` 在 `codeInsight/highlighting/` 目录无结果）⇒ 真实形状是 `BraceMatcher.java:35-40`（EP 名 `com.intellij.braceMatcher` 在 `:36` + 三个问法）与 `BraceMatchingUtil.java:172`/`:239`/`:248` 的 `doBraceMatch()` |
| lp/editor-actions | 配对括号高亮 | 架 | `BraceMatchingUtil.java:172`/`:239`；`MatchBraceAction.java:58-60` 也用同一份上下文 | `src/editorBrackets.ts:106-129`（彩虹）、`:212-231`（`<>` 两侧高亮，复用 CodeMirror 的 `cm-matchingBracket`）；`()[]{}` 由 `basicSetup` 的 `bracketMatching` | `angleBraceHighlight` 至今没挂进编辑器（保留文件）⇒ 接线请求 W-1 |
| lp/editor-actions | `EditorMatchBrace`＝移动到配对的括号 | 做 | `platform/lang-impl/src/com/intellij/codeInsight/editorActions/MatchBraceAction.java:25-31`（三条规则）、`:40-51`（执行）、`:58-60`（BraceMatcher + CodeBlockSupport）、`:82-84`（navigationOffset）、`:88-110`（第三条，`:91` 返回**开括号**的起始 offset）；注册 `platform/lang-impl/resources/intellij.platform.lang.impl.actions.xml:23`；键位 `platform/platform-resources/src/keymaps/$default.xml:1146-1148`（Ctrl+Shift+M），交叉核对同目录 `Mac OS X 10.5+.xml:642`、`Sublime Text.xml:231` 与 `platform/testFramework/extensions/src/com/intellij/keymap/KeymapsTestCase.java:154` | 新增 `src/editorMatchBrace.ts:51-107`（词法括号表与两条配法）、`:127-171`（三条规则）、`:174-181`（命令）；登记 `src/editorCommands.ts:227`（`'brace.match'`）；菜单行 `src/menus/editMenu.ts:161` | 本仓此前完全没有这一条（`grep` 全仓只有别的模块里同名的私有函数）。命令表 + 菜单行 ⇒ 立刻点得到；Ctrl+Shift+M 待接（W-3），菜单行的键位栏因此留空，不编按下去没反应的加速键。判据 `tests/editor-match-brace.test.mjs`（8 条） |

### ③ `lp/sticky-lines`

| 族 | 项 | 判定 | 上游依据（相对路径:行号） | 本仓落点（文件:行号） | 说明 |
|---|---|---|---|---|---|
| lp/sticky-lines | 判词「现路径只过通用表 / Java 误认 struct」 | 修 | 见下面三条 | `src/stickyLines.ts:83`（先过 `filterStickySymbols`）、`src/stickyLineProviders.ts:33-42`（语言表）、`src/App.vue:497`（把语言喂进来） | **判词过期**：`docs/inventory/verdict-platform_rest.md:362` 那句「缺：把 provider 接进 App.vue 的顶边渲染（现路径只过通用表）」已经不再成立 —— 顶边渲染走的 `createStickyLines` 带 `language`，判据 `tests/tab-sticky-lines.test.mjs:72-76` 钉的就是这一条，我复核它成立（305→350 全绿里含它）。留痕写在 `src/stickyLines.ts:22-33` |
| lp/sticky-lines | 「哪些 kind 算作用域」的真实形状 | 架 | `platform/platform-impl/src/com/intellij/openapi/editor/impl/stickyLines/StickyLinesCollector.kt:25-30`（类注释：基于 `FileBreadcrumbsCollector` 收集区间）；`platform/lang-impl/src/com/intellij/codeInsight/stickyLines/StickyLinesPass.kt`，工厂注册 `platform/lang-impl/resources/intellij.platform.lang.impl.xml:1670`；LSP 那一侧 `platform/lsp-impl/src/impl/features/documentSymbol/LspFileBreadcrumbsCollector.kt:45-64`（**不按 SymbolKind 过滤**）、`:66-71`（要有 LSP 客户端且 `breadcrumbsSupport`）、默认值 `platform/lsp/src/api/customization/LspDocumentSymbolCustomizer.kt:23`（true）/`:28`（false）；参与语言集 `StickyLinesLanguageSupport.kt:45-53`（遍历 `BreadcrumbsProvider.EP_NAME`） | `src/stickyLineProviders.ts:33-42`、`src/stickyLines.ts:22-33` | 上游 LSP 链路天然拿不到 `struct`（层级里没有），本仓拿的是扁平日语列表 ⇒ 「按语言给 kind 白名单」是本仓侧的等价手段而非逐字移植。这条差异以前没写，现在写在模块头 |
| lp/sticky-lines | 粘性行**可点击**跳转 | 做 | `platform/platform-impl/src/com/intellij/openapi/editor/impl/stickyLines/StickyLine.kt:36-41`（`navigateOffset()`：点击时把光标放到的 offset，通常是元素自己的 textOffset）；`ui/StickyLineComponent.kt:44-50`（鼠标监听）、`:211`（`offsetOnClick`）；LSP 取数 `LspFileBreadcrumbsCollector.kt:57-59`（先 `selectionRange.start`，退到 `range.start`） | `src/stickyLines.ts:45`（`StickyLine.navigateLine`）、`:83`（填 `startLine`）、`:117-118`（`stickyRevealTarget`，给 `revealLocation` 要的 0 基行，同 `src/bookmarkActions.ts:241` 的约定） | 本仓 `LspDocumentSymbol`（`src/bridge.ts:143`）没有 selectionRange ⇒ 落在上游的退路档。渲染侧 `src/App.vue:2169-2171` 那个 div 现在既没 click 又带 `aria-hidden="true"` ⇒ 保留文件，走接线请求 W-2。判据 `tests/editor-sticky-navigate.test.mjs`（4 条） |
| lp/sticky-lines | 「起始行滚出视野才算粘住」 | 架 | `VisualStickyLines.kt:67-86`（按 `visibleArea` 顶行算）、`StickyLinesManager.kt:32`/`:86`/`:111` | `src/stickyLines.ts:74-83`（`firstVisibleLine` 参数，缺省时退回光标行） | 规则已由并行那一任铺好，我复核判据（`tests/sticky-lines.test.mjs` 里那几条）仍绿；滚动量从 `CodeEditor.vue` 透出是 W-5 |
| lp/sticky-lines | `StickyLinesPass` 的 daemon 合帧 | 缺 | `StickyLinesCollector.kt:32-62`（mod stamp）、`StickyLinesPass.kt:21`/`:27` | 无 | 本仓没有 daemon/pass 层：粘性行是 Vue `computed`，跟着 outline 与光标行重算。要做「合帧」得先有后台计算层 —— 具体卡点写在「做不到」 |

## 三个「零消费方孤儿」的处置

派单说这三个是上一任留的孤儿。实况：**已经接上了**（不是我接的，我复核了链路）——

| 模块 | 现在谁在用 | 再往上一层 |
|---|---|---|
| `src/editorJoinComments.ts` | `src/editorCommands.ts:33` import、`:55` 在 `line.join` 命令里调用 | `src/menus/editMenu.ts:112`（Ctrl Shift J）⇒ App.vue 的 `editable()` 走 `runEditor` |
| `src/editorCodeBlock.ts` | `src/editorCommands.ts:36`、`:165`（`codeBlockTarget`），表项 `block.start`/`block.end`/`block.startSelect`/`block.endSelect` | `src/menus/editMenu.ts:128`/`:130` + 键位 Ctrl `[` 等 |
| `src/editorFillParagraph.ts` | `src/editorCommands.ts:39`、`:209`（`'paragraph.fill'`） | `src/menus/editMenu.ts:120` |

所以三个文件头**不需要**写「接不上的理由」；判据测试也在（`tests/editor-code-block.test.mjs`、
`tests/editor-fill-paragraph.test.mjs`、`tests/editor-join-comments.test.mjs`，本次全绿）。
真正还没接上的是另外两处（都在保留文件）：`smartQuotes`（`src/editorTyping.ts:120`）与
`angleBraceHighlight`（`src/editorBrackets.ts:212`）——除自己的测试外没有生产消费方 ⇒ W-1。

## 改动文件

新增：
- `src/editorEnterBlockComment.ts`（196 行）— 块注释里回车的词法与三条判定
- `src/editorQuoteFaces.ts`（110 行）— 多字符引号（Java 文本块 `"""`）三个动作
- `src/editorMatchBrace.ts`（181 行）— `EditorMatchBrace`：三条规则 + 命令 + 语言 facet
- `tests/editor-enter-handlers.test.mjs`（145 行，14 条）
- `tests/editor-enter-block-comment.test.mjs`（119 行，12 条）
- `tests/editor-quote-faces.test.mjs`（91 行，9 条）
- `tests/editor-match-brace.test.mjs`（87 行，8 条）
- `tests/editor-sticky-navigate.test.mjs`（51 行，4 条）

修改：
- `src/enterHandlers.ts` — 头注释全部行号重核（订正 + 补 `:94`/`:97`/`:103-105`/`:85-88` 与 EP 次序）；**修行注释分支不换行的回归**（`:225-235`）；接上块注释那一步（`:237-247`）
- `src/editorTyping.ts` — 订正 `QuoteHandler.java` 与 `JavaQuoteHandler.java` 的错引；`smartQuotes` 里 face 那一档前置（`:127-145`）
- `src/editorBrackets.ts` — 订正 `JavaPairedBraceMatcher.java` 三处错引，并把编出来的 `BraceMatcher.findMatchingBracket`/`BraceMatch` 换成真实符号（`BraceMatchingUtil.java:172`/`:239`）
- `src/editorCommands.ts` — 登记 `'brace.match'`（`:227`）
- `src/menus/editMenu.ts` — 新增「移动到配对的括号」行（`:161`）
- `src/stickyLines.ts` — `StickyLine.navigateLine` + `stickyRevealTarget`；头注释补 sticky 一族真实形状与判词订正
- `tests/editor-brackets.test.mjs`、`tests/editor-match-brace.test.mjs` — 只改注释里的行号引用与断言消息（断言体一字未动）

没动：`CodeEditor.vue`/`App.vue`/`settingsModel.ts`/`bridge.ts`/`keymap*.ts`/`actionRegistry.ts`（全是保留文件）；
`src/stickyLineProviders.ts` 本次只读没改（语言表已经是对的，我给它的上游依据写在 `src/stickyLines.ts:22-33`）。

## 验证

- 域内全量：`node --test tests/editor-*.test.mjs tests/folding-*.test.mjs tests/clipboard*.test.mjs tests/sticky*.test.mjs tests/tab-sticky-lines.test.mjs tests/smart-enter.test.mjs tests/highlight-editor-bound-passes.test.mjs`
  ⇒ **350/350 通过**（开工前基线：同一 glob **305/305**；派单里那个 249/249 是更窄的旧 glob。新增 45 条全在我名下四个新测试文件里，另 1 条并入既有）
- 单文件复核：`tests/editor-brackets.test.mjs` 11/11、`tests/editor-quote-faces.test.mjs` 与 `tests/editor-match-brace.test.mjs` 合计 20/20、两个 enter 文件 23/23
- 类型：`npx vue-tsc --noEmit -p tsconfig.json` ⇒ **我名下文件 0 错**；全仓剩 1 条 `src/keymapBindings.ts(111,29)`（保留文件，别人在途）。
  第一轮跑（改动前）是 8 条，都在 `ContentComboLabel.vue`/`keymapBindings.ts` 等别人名下
- 检测器：`node .tools/find-param-props.mjs` ⇒ 0 处；`node .tools/find-ts-in-mjs.mjs` ⇒ 干净；
  `node .tools/verify-fake-controls.mjs` ⇒ 只报别人名下的组件（`VcsLogFilters.vue`/`VcsLogGoToRef.vue`/`WelcomePage.vue`），我新增的菜单行不是假控件（命令表里有实现，点得到）
- 孤儿门禁：`node .tools/find-orphan-modules.mjs --gate` ⇒ 红，但红的是 `src/rootsJarEntries.ts`（桶 15 名下）。
  我的三个新模块都有生产消费方：`editorEnterBlockComment` ← `enterHandlers.ts`，`editorQuoteFaces` ← `editorTyping.ts`，
  `editorMatchBrace` ← `editorCommands.ts:227`
- 行数门禁：`tests/module-size.test.mjs` ⇒ 红，红的只有 `src/components/WelcomePage.vue(920 行)`（别人名下）；我的新文件最大 196 行，没到 900 上限，也没调任何上限
- 引证门禁：`tests/source-citations.test.mjs` ⇒ 红 2 条，都在别人的文档里（`docs/batch-2026-10-06-bucket2c.md`、
  `docs/wiring-requests-2026-10-06-bucket14c.md` 各 1 条「参考树里没有这个文件」）；我 src/tests 里的每一条都被核到

### 反向验证记录（新门禁全部做过，做完即还原）

| 门禁（测试文件） | 故意造的违规 | 结果 |
|---|---|---|
| `tests/editor-enter-handlers.test.mjs` 的「注释那一步之后必须真的换行」 | 把 `src/enterHandlers.ts:229` 的 `insertNewlineAndIndent(view)` 删掉 | **红 2 条** ⇒ 还原后绿 |
| `tests/editor-enter-block-comment.test.mjs` 的次序门禁 | 把 `enterInBlockComment(...)` 调用改名成不存在的符号 | **红 1 条** ⇒ 还原后绿 |
| `tests/editor-quote-faces.test.mjs` 的「face 那一档要前置」 | 把 `src/editorTyping.ts:131` 的 `faceAction(` 改名 | **红 1 条** ⇒ 还原后绿 |
| `tests/editor-match-brace.test.mjs` 的「命令表与菜单行同名」 | 删掉 `src/editorCommands.ts:227` 的 `'brace.match'` 登记 | **红 1 条** ⇒ 还原后绿 |
| `tests/editor-sticky-navigate.test.mjs` 的 `navigateLine` 契约 | 去掉 `src/stickyLines.ts:83` 的 `navigateLine` 字段 | **红 3 条** ⇒ 还原后绿 |

`git status --porcelain` 复核过这五个文件在还原后与变异前一致（脚本是整文件内容回写，不是行替换）。

## 做不到 / 无法核实

1. **C/C++ 与 TS/JS 的 `QuoteHandler`/`PairedBraceMatcher`** —— 无法核实。社区树里 `find *QuoteHandler*`
   命中 groovy/jsonpath/markdown/mermaid/sh/toml/xpath，`*BraceMatcher*` 命中的也没有 cpp/typescript 那两份
   （C++ 在 CLion、JS/TS 在商业插件），而本仓的编辑器语言只有 `java|cpp|typescript|other`
   （`src/languages.ts:8`）⇒ 表里不给，行为继续由 CodeMirror 的固定字符集承担。
2. **`EnterAfterJavadocTagHandler` 与 `/**` 文档注释回车**（`enter/EnterInBlockCommentHandler.java:48-51` 让出去的那一支，
   接手方 `enter/EnterAfterJavadocTagHandler.java`、`EnterHandler.java:417-428`）—— 做不到。具体卡点：
   那条要在光标所在的 javadoc 与其宿主声明之间移动 tag，靠 `PsiFile.findElementAt` + `PsiDocumentManager.commitDocument`；
   本仓没有 PSI 层，也没有「文档注释 vs 块注释」的 token 区分（`JavaCommenter.java:56-59` 那种 token 类型），
   用词法猜会造出错的 tag 位置 ⇒ 宁可不接（上游此时也返回 `Result.Continue`，与本仓一致）。
3. **TODO 续行的两条**（`EnterInLineCommentHandler.java:68-72`、`EnterInBlockCommentHandler.java:70-84`）—— 没做。
   具体卡点：依赖 `TodoConfiguration` 的图案表与 `isMultiLine()` 开关，而本仓的 todo 模型在 `src/todo*`
   （桶 14 名下，我不能碰）。要接的话需要那边导出一个「这段文本是不是 TODO」的问法，我这边再接。
4. **三个回车/引号开关的设置项**（`CodeInsightSettings.java:129` `SMART_INDENT_ON_ENTER`、`:130`
   `INSERT_BRACE_ON_ENTER`、`:132` `CLOSE_COMMENT_ON_ENTER`；`QuoteHandler.java:10-20` 的 `AUTOINSERT_PAIR_QUOTE`）——
   本仓 `EditorSettings` 里没有对应字段（`src/settingsModel.ts:384-385` 只有 sticky 那两条），
   `settingsModel.ts`/`bridge.ts` 都是保留文件 ⇒ 现在一律按上游默认值（true）走，接线请求 W-4。
5. **粘性行的 daemon 合帧与「按视图优先级排序」**（`StickyLinesCollector.kt:32-62` 的 mod stamp、
   `StickyLinesPass.kt:21`/`:27` 的 collect/apply 两段）—— 做不到。具体卡点：上游是
   `UpdatePass` 后台计算 + 写回 editor markup model；本仓的粘性行是 Vue `computed`，输入只有
   outline（LSP 异步结果）与光标行，没有 pass 层，也没有多视图优先级概念（一个 pane 一份 sticky 面板）。
   用户可见结果（顶边那几行作用域）已经等价，差的是计算调度。
6. **`enterHandlerDelegate` 的 `INSERT_BRACE_ON_ENTER` 之类语言级 code-style 覆盖**
   （`CommonCodeStyleSettings`/`CodeStyleManager.adjustLineIndent`）—— 无法核实到具体档：本仓没有
   code-style 表，`:139-140`（`calculateOffsetToInsertClosingBrace` 靠 PSI 找行尾）与 `:230-250` 的
   格式化兜底我只能按「行尾 + 本行缩进」近似，判不准就交回默认回车。
