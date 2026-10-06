# 批次报告 2026-10-06 · editorinput（编辑器输入域：回车 EP 次序 / QuoteHandlerEP / FillParagraph / CodeBlockSupport）

先读 `D:\TaoCode\.tools\agent-rules.md` 再动手。上游基准树 = `D:\Backup\Downloads\intellij-community-master\intellij-community-master`，
每条结论给「上游相对路径:行号」（都我自己开文件核过，不是抄判词或抄别人的报告）。
本批**只动我自己面内的四个模块 + 三个测试文件**，没有碰保留文件，也没有碰
`editorFolding* / customFolding* / stickyLine* / structural* / search*`。

一句话：`lp/editor-actions` 判词里点名的四项，**两项有真缺项并已落**（回车四条的 EP 次序 + `QuoteHandlerEP` 的
按语言注册与开关消费），**两项核完是「已做/不适用」**（`FillParagraph` 整族别人早已落全；
`CodeBlockSupportHandler` 那一问在 Java/C++/TS 里上游本身就是空区间）。顺带把设置页那三格
（插入成对引号 / 闭合块注释 / 插入成对的 `}`）**从假控件变成有消费方**——宿主传值那一行在保留文件，已交请求。

## 1. 判词表

| 族 | 项 | 判定 | 上游相对路径:行号 | 本仓落点文件:行号 | 一句话说明 |
|---|---|---|---|---|---|
| lp/editor-actions | 回车四条的 EP 次序 | `[x]` 本批做 | `platform/lang-impl/resources/intellij.platform.lang.impl.xml:1159`（字面量）`:1160`（行注释）`:1163-1164`（左花括号）`:1161-1162`（块注释，`order="last"`）；循环 `platform/lang-impl/src/com/intellij/codeInsight/editorActions/EnterHandler.java:136-153` | `src/enterHandlers.ts:412-486`（`smartEnterCommand`） | 问法次序改成上游**排完序**的有效次序：字面量→行注释→左花括号→块注释；原来拿次序顶词法的做法已撤销 |
| lp/editor-actions | `EnterHandlerDelegate` 的词法判据（引号在注释里 / `//` 在字符串里） | `[x]` 本批做 | `enter/EnterInStringLiteralHandler.java:116-125`（读 `offset-1` 那个 token）、`enter/EnterInLineCommentHandler.java:97`（要行注释 token）、`enter/EnterInBlockCommentHandler.java:103-120` | `src/enterHandlers.ts:158-256`（`lexUntil` + 五个 `LEX_*`） | 新增逐字符词法：`String s = "http://x"` 里的 `//` 不再被当注释续行（改动前会，用户能看见） |
| lp/editor-actions | `EnterAfterUnmatchedBraceHandler` 的 `INSERT_BRACE_ON_ENTER` | `[x]` 本批做 | `platform/analysis-impl/src/com/intellij/codeInsight/CodeInsightSettings.java:130`；开关问在 `platform/lang-impl/src/com/intellij/codeInsight/editorActions/enter/EnterAfterUnmatchedBraceHandler.java:84-86` | `src/enterHandlers.ts:107-109`（`EnterLanguage.insertBraceOnEnter`）、`:458`（消费） | 关掉 ⇒ `getMaxRBraceCount` 返回 0 ⇒ 整条不接管；本仓同语义。键在 `src/settingsModel.ts:431`，宿主传值那一行见请求 W-1 |
| lp/editor-actions | `EnterInBlockCommentHandler` 的 `CLOSE_COMMENT_ON_ENTER` | `[x]` 本批做 | `CodeInsightSettings.java:132`；开关问在 `enter/EnterInBlockCommentHandler.java:62` | `src/enterHandlers.ts:104-106` + `src/editorEnterBlockComment.ts:180-182`（实参早就有、之前没人传） | 关掉 ⇒ 没闭合的块注释不再补闭尾（`* ` 续行那一支不受它管，与上游一致）；`src/editorEnterBlockComment.ts:172-179` 那句「本仓没有这一条」已订正 |
| lp/editor-actions | `EnterInStringLiteralHandler` 的「按语言才切」 | `[x]` 本批做 | `enter/EnterInStringLiteralHandler.java:39-42` + `:109-114` 的 `instanceof JavaLikeQuoteHandler`；`JavaLikeQuoteHandler.java:15-17`；`java/java-frontback-impl/src/com/intellij/codeInsight/editorActions/JavaQuoteHandler.java:32`（能连的只有 STRING_LITERAL）`:83-86`（连接符 `+`） | `src/enterHandlers.ts:372-405`、`src/editorTyping.ts:79-86`（`stringConcatFor`） | 语言 id 给了就按那张表收紧；三引号文本块整段不算字面量 ⇒ 里面回车不切（改动前会切） |
| lp/editor-actions | `QuoteHandlerEP`（按 fileType 的引号扩展点） | `[~]` 部分 | EP 声明 `intellij.platform.lang.impl.xml:405`/`:408`；注册面 `platform/lang-impl/src/com/intellij/codeInsight/editorActions/QuoteHandlerEP.java:16-27`；Java 那条 `java/java-frontback-impl/resource/intellij.java.frontback.impl.xml:74` | 本仓已有：`src/editorTyping.ts:64-71`（`LANGUAGE_QUOTES`）；本批补：`:136-150`（`quoteActionWithSwitch`）+ `:165-200`（`smartQuotes` 的开关实参） | 已做：开关 `AUTOINSERT_PAIR_QUOTE` 的消费方（关掉 ⇒ `skip`/`pair`/face 三档都不接管，依据 `TypedQuoteImpl.java:66-68`）。**还差**：`SURROUND_SELECTION_ON_QUOTE_TYPED`（`CodeInsightSettings.java:137`，管 `SelectionQuotingTypedHandler.java:47` 的包住选区）本仓**没有这一格设置** ⇒ 不做假设置，`wrap` 恒开（= 上游默认）；退格那一半（`BackspaceHandler.java:135`）不在我的文件面 |
| lp/editor-actions | `FillParagraphAction` / `ParagraphFillHandler` / `LanguageFillParagraphExtension` | `[x]` 本仓已有（非本批，别人文件） | `platform/lang-impl/src/com/intellij/codeInsight/editorActions/fillParagraph/FillParagraphAction.java:20-46`、`ParagraphFillHandler.java:97-148/208-218`、`platform/code-style-api/src/com/intellij/psi/codeStyle/CodeStyleSettings.java:430` | `src/editorFillParagraph.ts:39/61/81/107/133/150` + `src/editorCommands.ts:39、:209`（`paragraph.fill`）+ `src/menus/editMenu.ts:120` | 本批核的是**本仓落点齐全**（模块 6 个导出 + 命令名 + 菜单行都在，`grep` 过）+ 抽核了 5 处上游行号：`FillParagraphAction.java:20`（`extends BaseCodeInsightAction`）与 `:43-45`（`isValidForFile` 问 handler）、`ParagraphFillHandler.java:208-210`（只对 `PsiPlainTextFile` 成立）、`:212-218`（前后缀都是空串 ⇒ 折行不补注释前缀）、`CodeStyleSettings.java:430`（`RIGHT_MARGIN = 120`）、`LineWrappingUtil.java:103`（`LanguageLineWrapPositionStrategy`）。它的两条未搬支线（`ParagraphFillHandler.java:63-65` 的 `FormatterTagHandler.getEnabledRanges`、上面那条 strategy）由该模块自己登记。**属我这半的缺项：无** |
| lp/editor-actions | `CodeBlockSupportHandler` / `AbstractCodeBlockSupportHandler` | `[-]` 不适用（具体理由） | EP 声明 `platform/lang-impl/resources/intellij.platform.lang.impl.xml:147`；取用面 `platform/lang-impl/src/com/intellij/codeInsight/highlighting/CodeBlockSupportHandler.java:33、:57-66`；区间算法 `AbstractCodeBlockSupportHandler.java:79-83`；第二问 `MatchBraceAction.java:58-76` | `src/editorMatchBrace.ts:11-22`（把这条结论钉在模块头） | 全社区树里 `codeBlockSupportHandler` **只有 Python 注册过**（`python/pluginResources/intellij.python.community.impl.xml:439` → `python/src/com/jetbrains/python/codeInsight/highlighting/PyControlFlowKeywordCodeBlockSupportHandler.kt:16-20`）。Java/C++/TS/纯文本 ⇒ `findCodeBlockRange` 返回空区间 ⇒ `MatchBraceAction.java:61-63` 原样返回第一问结果 ⇒ **本仓只做第一问就是与上游一致的**，没有少做。Python 那一档见第 6 节 |
| lp/editor-actions | caretops 请求里的 **R3** `EditorAddCaretPerSelectedLine` | `[ ]` 未做（目标文件不在我面 ⇒ 只交请求） | 实现 `platform/platform-impl/src/com/intellij/openapi/editor/actions/AddCaretPerSelectedLineAction.java:22-54`；注册 `platform/platform-impl/resources/intellij.platform.ide.impl.actions.xml:358`；菜单 `platform/platform-impl/resources/idea/PlatformActions.xml:485-487`；键位 `platform/platform-resources/src/keymaps/$default.xml:155-157`（`shift alt G`）；文案 `platform/platform-resources-en/src/messages/ActionsBundle.properties:130` | 请求：`docs/wiring-requests-2026-10-06-editorinput.md` W-2 | 目标 `src/editorCommands.ts` / `src/menus/editMenu.ts` / `src/keymapBindings.ts` / `CodeEditor.vue` 全不在我面 ⇒ 命令本体整段可照抄的代码、菜单行、`EDITOR_ACTIONS` 条目与「四处都要落，缺一处就是假行/假键位」的说明都写进请求；另核到 caretops 没给的两条：上限默认值 `platform/util/resources/misc/registry.properties:484`（1000）与超限提示 `platform/platform-impl/src/com/intellij/openapi/editor/ex/util/EditorUtil.java:1366-1375`（本仓没有那条 balloon 通道 ⇒ 静默，别编提示） |
| lp/editor-actions | `QuoteHandlerEP` 那格设置在派单里的另一半：宿主传值 | `[ ]` 未做（保留文件） | 同上四行 | 请求 W-1 | 三格键 + 界面早就有、消费方本批补齐 ⇒ 只差 `CodeEditor.vue:112-117`/`:968` 两处传值；不接也不会改坏现有行为（默认值与上游一致） |

族内其余项（`PasteHandler` / `CopyPastePreProcessor` / `LineCommentCopyPastePreProcessor` /
`PreserveIndentOnPasteBean` / `WordSelectioner` 一族 / `TypedHandler` 一族）本批**未展开** —— 派单 ② 只点名
「回车四条 EP 次序、`QuoteHandlerEP`、`FillParagraph`、`CodeBlockSupportHandler`」。
已顺手核到的一条：粘贴缩进那族不是缺项，`src/pasteOptions.ts:1-12` 与 `src/editorPaste.ts:1-10`
已按 `CodeInsightSettings.java:143-148` 的 `REFORMAT_ON_PASTE` 四档 + `PasteHandler.java:205-219` 落地。

## 2. 改动文件清单（`wc -l` 前 → 后）

| 文件 | 前 | 后 | 说明 |
|---|---:|---:|---|
| `src/enterHandlers.ts` | 290 | 486 | 次序改回上游 + `lexUntil` 词法 + 两条开关 + 语言收紧；头注释整段重写（原写「注释排在字面量之前」的理由已就地订正并留痕） |
| `src/editorTyping.ts` | 185 | 238 | `QuoteRules.concat` + `stringConcatFor` + `quoteActionWithSwitch` + `smartQuotes` 的开关实参；订正「本仓没有 AUTOINSERT_PAIR_QUOTE 这一条」那句过期注释 |
| `src/editorMatchBrace.ts` | 181 | 194 | 只在模块头补 `CodeBlockSupportHandler` 的核查结论（无代码改动） |
| `src/editorEnterBlockComment.ts` | 212 | 216 | 订正 `closeOnEnter` 那段（键/界面已存在、缺消费方）；实参签名不变 |
| `tests/editor-enter-handlers.test.mjs` | 145 | 209 | 次序断言按上游改写（原断言钉的是「注释排在字面量之前」，见第 4 节留痕）；新增词法/文本块/开关 4 条判据 |
| `tests/editor-quote-faces.test.mjs` | 102 | 130 | 注册表形状从两格变三格（`concat`）+ `stringConcatFor` 三条 + 开关降级 1 条 |
| `tests/editor-enter-block-comment.test.mjs` | 142 | 154 | 次序与调用形状两条断言随实现同步收紧（问法一条没少） |
| `docs/batch-2026-10-06-editorinput.md` | — | 本文件 | 交付报告 |
| `docs/wiring-requests-2026-10-06-editorinput.md` | — | W-1/W-2/W-3 | 接线请求 |

注释词法一律用 `//` 行注释（派单 ③ / 规约第 4 节第 3 条）：本批新增的讲词法的段落全在 `//` 注释里，
没有在任何块注释正文里写裸 `*/`；顺手把 `enterHandlers.ts` 与 `editorEnterBlockComment.ts` 里
两处写在块注释里的 `/**`、`* ` 之类样本改成不带闭尾的写法。`node .tools/find-missing-ext.mjs`
与 `node .tools/find-ts-in-mjs.mjs` 见第 3 节，都是绿的 ⇒ 树没有被语法错误遮住。

## 3. 规约第 5 节每条自查命令的前后数字

| 命令 | 改前 | 改后 |
|---|---|---|
| `npx vue-tsc -b --force` | **7 条错**，全不在我面：`src/testTree.ts` 6 条 + `src/components/TestRunnerPanel.vue` 1 条（别人在途） | **0 错**（`EXIT=0`，日志 `.tmp-editorinput-tsc-final.txt` 只有 1 行 `EXIT=0`）⇒ 我的改动贡献 0；基线那 7 条在我运行期间由 testTree 的主人自己修掉了，我没有动那两个文件 |
| `node --test tests/module-size.test.mjs` | 5 通过 / 0 红 | 5 通过 / 0 红（上限一律没抬：ts/vue 900、`CodeEditor.vue` 仍登记 1147） |
| `node .tools/find-param-props.mjs` | 0 处 | 0 处 |
| `node .tools/find-ts-in-mjs.mjs` | 干净 | 干净 |
| `node .tools/find-missing-ext.mjs` | 扫描 1286 个文件、干净 | 扫描 1286 个文件、干净 |
| `node .tools/find-orphan-modules.mjs --gate` | 已登记 9 / 基线 9 / 新增 0 | 已登记 9 / 基线 9 / **新增 0** / 清掉 0 |
| `node --test tests/source-citations.test.mjs tests/source-citation-anchors.test.mjs` | **11 条红**，全部在别人名下的文档（`docs/batch-2026-10-06-projecttree.md`、`-status2.md`、`-toolwindow2.md`、`-welcome2.md`、`wiring-requests-2026-10-06-lsp.md`、`-vcs2.md`） | 仍 **11 条红、零条属于本批**：我把那两条门用的 `citationsOf` + `refLineReader` 单独跑在我改动的 7 个文件 + 本批 2 份文档上，见下 |
| 域内测试（我面 8 个文件） | 84 通过 / 0 红 | 88 通过 / 0 红 |
| 域内 + 相邻消费者（12 个文件） | — | 126 通过 / 0 红 |
| caretops 名下 3 个文件（`editor-commands` / `editor-line-ops` / `editor-caret-clone`，只核我这批有没有打到它们） | — | 45 通过 / 0 红（我没改它们） |
| `npm run test:native` / ctest | 未跑 | **未跑**：本批没碰 `native/` 一个字节 |

引用自证（临时脚本 `.tmp-cite-check.mjs`，跑完已删）：

```
checked 76 bad 0
```

本批 9 个文件（4 个模块 + 3 个测试 + 2 份新文档）里可核对的 76 条上游引用全部指得到（文件存在 + 行号不越界）。
那 11 条红是别人文档里的假路径（例如 `platform/analysis-api/src/com/intellij/codeInsight/SuppressIntentionAction.java`
社区树里没有这个文件），我没有改他们的文档，也**不替他们猜正确行号** —— 请主代理按归属派回去。

## 4. 反向验证记录（注入违规 → 变红 → 撤掉 → 复绿）

| # | 注入了什么 | 红了什么 | 撤后 |
|---|---|---|---|
| 1 | `src/enterHandlers.ts` 里把「① 字符串字面量」那一支与「② 行注释」那一支整体调换（= 退回改动前的问法次序） | `tests/editor-enter-handlers.test.mjs` + `tests/editor-enter-block-comment.test.mjs` 合跑 27 条中 **2 红**（次序判据 + 词法判据各一条） | 27 通过 / **0 红** |
| 2 | `src/editorTyping.ts` 的 face 守卫 `if (selection.empty && pairQuote)` 改成 `if (selection.empty)`（开关关掉时文本块还在补配对） | `tests/editor-quote-faces.test.mjs` 11 条中 **1 红** | 11 通过 / 0 红 |
| 3 | `enterInBlockComment(docText, selection.head, block, lexicon.blockCloseOnEnter ?? true)` 改成不传第四个实参（闭尾开关没人读） | `tests/editor-enter-block-comment.test.mjs` 13 条中 **1 红** | 13 通过 / 0 红 |
| 4 | `const afterBrace = (lexicon.insertBraceOnEnter ?? true)` 写死成 `(true)`（左花括号开关空转） | `tests/editor-enter-handlers.test.mjs` 14 条中 **1 红**（那条是行为判据，不是文本判据） | 14 通过 / 0 红 |
| 5 | 词法扫描从「全文开头推到本行行尾」退化成「只扫本行」（跨行块注释/文本块状态丢失，字符串里的 `//` 又会被当注释） | `tests/editor-enter-handlers.test.mjs` 14 条中 **1 红** | 14 通过 / 0 红 |

改既有断言的留痕（规约第 3 节「要改断言必须证明它钉错了形状并给上游理由」）：

- `tests/editor-enter-handlers.test.mjs` 原第 132-145 行钉的是
  `assert.ok(commentStep < stringStep, '行注释要排在字面量之前：否则 \`// 说 "abc\` 里的引号会被误切')`
  以及 `assert.equal(enterInStringLiteral('// 说 "abc', 8)?.insert, '" + "')`（把「会误切」当成受保护的行为钉住）。
  **原写 X、实际 Y**：上游区分这两件事靠 token 类型，不靠次序
  （`enter/EnterInStringLiteralHandler.java:39-42` 先问 `isInStringLiteral`、`:116-125` 读 `offset-1` 那个 token；
  `enter/EnterInLineCommentHandler.java:97` 要行注释 token），注册表次序是 `:1159` 字面量在 `:1160` 行注释之前。
  ⇒ 改成「次序照上游 + `lexUntil` 词法才是防线」，第二条断言的期望值从「误切成功」改成 `null`（判据变严，没有放松）。
- `tests/editor-enter-block-comment.test.mjs` 原第 117/123 行钉 `enterInBlockComment(doc.toString(), selection.head, block)`
  这一整串字面与「注释两条排在字面量之前」⇒ 同上改写，四条问法逐条 `indexOf` 核**一条没少**（少一条会红）。
- `tests/editor-enter-block-comment.test.mjs` 原第 140 行钉 `return { line: style?.line, block: blockLexiconFor(style ?? undefined) }`
  整行字面 ⇒ 出口现在多带回连接符那一格（`stringConcat`），断言改成核「块注释那一半有没有翻成 lexicon」这条实质
  + 新增一条 `stringConcat` 装配判据。原形状是上一任的单行写法，不是上游约束。
- `tests/editor-quote-faces.test.mjs` 原第 72 行 `deepEqual(LANGUAGE_QUOTES.java, { single, multi })` ⇒ 表从两格变三格，
  补 `concat: '+'` 并给上游理由（`JavaQuoteHandler.java:83-86`）。`deepEqual` 仍是 `deepEqual`，没有降级成 `includes`。
- 其余断言体**一字未动**（`git diff` 自查过 hunk：四个模块文件 + 三个测试文件，没有顺手重排别人的代码）。

## 5. 零消费方自查结论

- 没有新增 `.ts` 文件 ⇒ `find-orphan-modules.mjs --gate` 新增 0（第 3 节数字）。
- 新增的导出逐个都有生产消费方：`lexUntil` / `LEX_*` 被 `smartEnterCommand`（`src/enterHandlers.ts:425`）、
  `enterInLineComment`（`:268`）、`enterInStringLiteral`（`:388`）用；`stringConcatFor` 被
  `smartEnterLanguageFor`（`src/enterHandlers.ts:129-137`）用；`quoteActionWithSwitch` 被 `smartQuotes`
  （`src/editorTyping.ts:200`）用；`EnterLanguage.blockCloseOnEnter` / `insertBraceOnEnter` / `stringConcat`
  三个字段被 `smartEnterCommand` 与那两条判定读（`src/enterHandlers.ts:458`、`:474`、`:387`/`:403`）。
- `smartQuotes` 的第二个实参、`smartEnterLanguageFor` 的第二个实参**都有默认值** ⇒ 宿主没接（W-1 未落）时
  这两条链仍是「按上游默认值跑」，不是「导出没人调的死代码」；缺的只是那三格设置的真值来源，已作为
  W-1 的必须项写清（不接 = 假控件仍然成立，责任在保留文件那一行）。
- `docs/wiring-requests-2026-10-06-editorinput.md` W-3 承认：`editorLanguageIdExtension`
  （`src/editorMatchBrace.ts:54`）今天仍零生产消费方 —— 那是上一批留下的既有状态（我 grep 过全部
  `docs/wiring-requests-2026-10-06-*.md`，没人提过这条挂载），本批没有把新逻辑压在它上面，只把它补进请求。

## 6. 做不到 / 无法核实

1. **`SURROUND_SELECTION_ON_QUOTE_TYPED`（包住选区那格开关）本仓没有设置项** —— 上游
   `platform/analysis-impl/src/com/intellij/codeInsight/CodeInsightSettings.java:137`（默认 true），
   消费点 `platform/lang-impl/src/com/intellij/codeInsight/editorActions/SelectionQuotingTypedHandler.java:47`。
   卡在哪：`src/settingsModel.ts` 与 `native/settings_schema.*` 都是保留文件，加键要动持久化面 ⇒ 不做假键；
   本仓 `wrap` 那一档恒开（与上游默认一致）。
2. **`AUTOINSERT_PAIR_QUOTE` 的退格那一半没做** —— 上游 `BackspaceHandler.java:135` 用同一个开关决定
   「退格时把自动补出来的那一对一起删」。卡在哪：本仓没有退格家族模块，
   `grep -rln "deleteCharBackward" src/*.ts` 只命中 `src/editorQuoteFaces.ts`/`src/editorTyping.ts` 的注释行；
   新建一个退格模块既不在派单面、又接不上键位（`src/keymap*.ts` 保留）⇒ 留给下一批整族做。
3. **Python 的 `codeBlockSupportHandler` 那一问做不了** —— 上游区间由
   `python/src/com/jetbrains/python/codeInsight/highlighting/PyControlFlowKeywordCodeBlockSupportHandler.kt:16-20`
   走 `AbstractCodeBlockSupportHandler.java:79-83` 的 `getParentByTokenSet(element, getBlockElementTypes())`，
   拿的是 PSI 元素树 + Python 的缩进控制流块。本仓没有 PSI，`src/editorMatchBrace.ts` 只有文本与
   `@codemirror/language` 的语法树；按缩进猜块边界 = 编 ⇒ 只把「Java/C++/TS 上游也是空区间」这条**核到的**结论写进模块头。
4. **`AddCaretPerSelectedLine` 的超限提示做不了** —— 上游
   `platform/platform-impl/src/com/intellij/openapi/editor/ex/util/EditorUtil.java:1366-1375` 弹
   "too.many.carets" balloon（文案键 `editor.max.carets.hint`）。卡在哪：编辑器命令层没有往通知面发
   balloon 的通道（`src/bridge*.ts`、`src/App.vue` 保留）⇒ 请求 W-2 里写的是「静默不动手」，不编提示条。
5. **Java `char` 字面量算不算 `TEXT_LITERALS` 成员**：无法核实（沿用上一批的结论）—— 那张表是 java-psi 的生成物
   （`java/java-psi-impl/src/com/intellij/psi/impl/source/tree/ElementType.java:84-85` 转发 `SyntaxElementTypes`），
   本 checkout 读不到成员清单 ⇒ `src/editorTyping.ts:56-63` 的表里仍不写 `'`，`enterInStringLiteral` 仍只认 `"`。
6. **C/C++ 与 TS/JS 的引号 handler**：无法核实（CLion / 商业 JS 插件不在社区树）⇒ 这两种语言的字符串字面量
   在上游同样没有 `JavaLikeQuoteHandler`，所以「宿主给了语言 id 时不切字符串」是有依据的收紧；
   但**它们自己的** `quoteHandler` 是否另有一档，读不到 ⇒ 表里不给。
7. **`smartEnterCommand` 仍是「单光标、无选区」才问** —— 上游 `EnterHandler.java:104-106` 先
   `EditorModificationUtil.deleteSelectedText`、多光标按 `Ref<Integer>` 逐个走，本仓那四条判定都是按单个光标写的；
   整族多光标化要重写四条判定 ⇒ 本批未做，`src/enterHandlers.ts:412-420` 的注释照实写着。
8. **`FillParagraph` 的两条未搬支线**：不是我面内的东西，登记给原主 —— `FormatterTagHandler.getEnabledRanges`
   （`ParagraphFillHandler.java:63-65`，`@formatter:off` 之间不折行）与 `LanguageLineWrapPositionStrategy`
   （`platform/platform-impl/src/com/intellij/formatting/LineWrappingUtil.java:103`）。

## 7. 需要主代理接的线

见 `docs/wiring-requests-2026-10-06-editorinput.md`：

- **W-1（必须）** `src/components/CodeEditor.vue:112-117` 与 `:968` —— 把 `props.settings.autoInsertPairQuote` /
  `closeCommentOnEnter` / `insertBraceOnEnter` 与 `props.language` 传进已经写好消费方的模块；
  顺带说明为什么 `docs/wiring-requests-2026-10-06-setkeys.md` 的 K-2「不挂 smartQuotes」那个写法要改
  （`basicSetup` 自带 `closeBrackets`，摘掉本模块 = 退回另一套行为）。
- **W-2（caretops 的 R3）** `EditorAddCaretPerSelectedLine` 的四处：模块侧命令（整段可照抄，建议落
  `src/editorCaretClone.ts`）+ `src/editorCommands.ts` 命令名 + `src/menus/editMenu.ts:109` 之后那行
  （键位栏填 `Shift Alt G`，上游真给了键）+ `src/keymapBindings.ts` 的 `EDITOR_ACTIONS` 条目与
  `CodeEditor.vue` 的绑定行。
- **W-3（可选）** `editorLanguageIdExtension` 至今没挂 —— 只影响 `EditorMatchBrace` 的 Java `<>` 那一档。
