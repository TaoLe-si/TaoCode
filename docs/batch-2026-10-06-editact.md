# 收工批次 2026-10-06 · editact（`lp/editor-actions` 判决里「回车那一族」的两条）

派单：只做两条 —— ① 回车相关处理器/后置处理器的**次序**是否与本仓实现一致；② `QuoteHandler` 那类
「自动补对引号 / 闭合注释」的**开关是否真的接进行为**（本仓 `autoInsertPairQuote` / `closeCommentOnEnter` /
`insertBraceOnEnter` 三把键：真设置还是只存不生效）。只挑**一条确实缺的**做掉并配会失败的判据，其余写判定表。

上游真源：`D:\Backup\Downloads\intellij-community-master\intellij-community-master`（下面每个行号都是我自己
`sed -n` 打开核过的；派单给的 `platform/editor-ui-*` 那一族**没有**回车处理器，真实路径是
`platform/lang-impl/src/com/intellij/codeInsight/editorActions/enter/`）。

---

## 1. 判定表

| # | 判决条目 | 判定 | 上游 相对路径:行号（本次打开核对） | 本仓落点 文件:行号 | 一句话说明 |
|---:|---|---|---|---|---|
| ① | EP 注册表与 `order="last"` 之后的**有效问次序** | **一致** | `platform/lang-impl/resources/intellij.platform.lang.impl.xml:1159`（字面量）、`:1160`（行注释）、`:1161-1162`（块注释 `order="last"`）、`:1163-1164`（左花括号）、`:1165-1166`（成对花括号）、`:1167-1170`（后置处理器 `order="last"`）、`:1171`（javadoc 标签）；EP 声明 `:399` | `src/enterHandlerOrder.ts:71-122`（rank 1–7）、`:158-170`（循环） | 表里 rank 与「XML 声明 + `last` 推尾」的有效次序逐条对得上：字面量→行注释→左花括号→成对花括号→javadoc→块注释→后置。判据 `tests/editor-enter-order.test.mjs:34-68` |
| ① | 循环的 break 语义 / 五档 | **一致** | `EnterHandler.java:136`（`for … getExtensionList()`）、`:142-144`（`Stop` ⇒ return）、`:145-153`（非 `Continue` ⇒ 置档后 break）；`enter/EnterHandlerDelegate.java:25-26` | `src/enterHandlerOrder.ts:43`、`:161-168`、`:173-175` | 第一个接管的算、其余按 `Continue`；判据 `tests/editor-enter-order.test.mjs:71-113` |
| ① | 「回车相关 **EditorPostProcessor**」 | **本树无此类** | `grep -rln "EditorPostProcessor\|EditorPostProcessorsRegistry" platform plugins` ⇒ **零命中**；回车那一族的「后置」只有 `EnterHandlerDelegate.postProcessEnter`（`EnterHandler.java:181-186`） | `src/enterHandlerOrder.ts:116-121`（rank 7，phase `postprocess`，`ported: false`） | 判决用语对应的就是 `postProcessEnter` 那一趟循环；本树里唯一覆写者是 `EnterBetweenBracesFinalHandler.java:94-96`（注入片段缩进），本仓没有 injected fragment 那一层 ⇒ 如实登记未接，不是漏 |
| ① | 同一张 EP 表**还有一趟前置问**（`invokeInsideIndent`） | **一致（观察不到）** | `EnterHandler.java:114-120`（循环 + 命中即 break）、接口默认 `enter/EnterHandlerDelegate.java:45`；全树 grep：除接口与调用点外**零实现者** | 表里没有这一相位 | 平台注册表里没人覆写 ⇒ 本仓不建这一相位观察不到差别；已在 `src/enterHandlerOrder.ts` 模块头登记 |
| ② | `insertBraceOnEnter`（= `INSERT_BRACE_ON_ENTER`） | **真设置** | `CodeInsightSettings.java:130`（默认 true）、把关 `enter/EnterAfterUnmatchedBraceHandler.java:84-86`（关掉 ⇒ `getMaxRBraceCount` 返回 0） | 键 `src/settingsModel.ts:473`、默认 `:265`、界面 `src/components/EditorEnterKeysFields.vue:31`、消费 `src/enterHandlers.ts:486-492`、装配 `:162-172`、宿主 `src/components/CodeEditor.vue:117` | 关掉 ⇒ 整条不接管 ⇒ 交回默认回车；新增端到端判据 `tests/editor-enter-switches.test.mjs`（另 `tests/editor-enter-handlers.test.mjs:222-233`） |
| ② | `closeCommentOnEnter`（= `CLOSE_COMMENT_ON_ENTER`） | **真设置** | `CodeInsightSettings.java:132`（默认 true）、把关 `enter/EnterInBlockCommentHandler.java:62`（`!isCommentComplete && CLOSE_COMMENT_ON_ENTER`；`:86-99` 的 `* ` 续行那一支不受它管） | 键 `src/settingsModel.ts:471`、界面 `EditorEnterKeysFields.vue:33`、消费 `src/editorEnterBlockComment.ts:194-197`、装配 `src/enterHandlers.ts:498-507` | 关掉 ⇒ 没闭合的块注释不再补 ` */`（`* ` 续行照旧，与上游同）；判据 `tests/editor-enter-switches.test.mjs` 的「端到端」那条 |
| ② | `autoInsertPairQuote`（= `AUTOINSERT_PAIR_QUOTE`） | **原来是半假 ⇒ 本批修掉** | `CodeInsightSettings.java:140`（默认 true）、把关 `TypedQuoteImpl.java:66-68`（关掉 ⇒ `handleQuote` 直接 return false ⇒ 后面 `:80-85` 的跳过收尾与 `:101-126` 的补配对**都不发生**，插的是一个普通字符） | 键 `src/settingsModel.ts:469`、界面 `EditorEnterKeysFields.vue:29`、宿主 `src/components/CodeEditor.vue:966`、消费 `src/editorTyping.ts:201`（问开关）、**:231-238（本批新增的落定分支）** | 见 §2：关掉之后 `pair` 那一档在真实编辑器里**看不出差别**（CodeMirror 兜底又补一对） |
| ② | 第四把：`SURROUND_SELECTION_ON_QUOTE_TYPED` | **本仓没有这一格** | `CodeInsightSettings.java:137`（默认 true）、把关 `SelectionQuotingTypedHandler.java:47` | `src/editorTyping.ts:168-175`（`wrap` 不受开关影响） | 不做假设置 ⇒ `wrap` 恒开（= 上游默认档），判据钉住「关掉 AUTOINSERT 不影响包住选区」 |

## 2. 做掉的那一条：`autoInsertPairQuote` 关掉后「行为没变」

- 缺的是什么：`smartQuotes` 的键位在关掉开关时把 `skip`/`pair`/face 三档都算成 `plain`，然后 **`return false`**。
  本仓编辑器挂着 `basicSetup`（`src/components/CodeEditor.vue:3`），而 `closeBrackets()` 被它带进来
  （`node_modules/codemirror/dist/index.js:61`），`closeBrackets()` **不是键位、是 `EditorView.inputHandler`**
  （`node_modules/@codemirror/autocomplete/dist/index.js:1830-1832` = `[inputHandler, bracketState]`、`:1844-1856`
  的 `inputHandler` 对任何用户输入调 `insertBracket`（`:1851`）、`:1795` 的 `defaults.brackets` 含 `"`、`:1990-1994` 的 `handleSame` 补出 `""`）
  ⇒ 键位放行只是把这次输入**让给**它，Java 文件里关掉开关敲 `"` **仍然**得到一对。设置页那一格存了、也传了、
  但用户看不见 ⇒ 属于「只存不生效」的那一半。
- 改法（最小）：把 `smartQuotes` 的键位体抽成可驱动的 `runQuoteKey`（`src/editorTyping.ts:190-263`，逐字搬、无行为改动），
  在关掉开关、单个空光标、且这个引号确实归这门语言的表管时，**自己落一个普通字符并吃掉键**（`:231-238`），
  与上游 `TypedQuoteImpl.java:66-68` 之后走普通输入同解。表里没有的语言（C++/TS/纯文本）仍整条交回 CodeMirror（模块头的既有决定）；
  多光标不动（本模块其余分支只认 main，这里吃掉键会让别的光标一个字符都收不到 ⇒ 如实留在观察不到的那一栏）。
- 判据（会失败的那种）：`tests/editor-enter-switches.test.mjs` 7 条。
  · 反向验证：先只做「抽函数」不改行为 ⇒ 新增那条红在 `handled` `false !== true`（关掉时键没被接管），修完转绿；
  · 同文件另钉「前提」一条：`insertBracket(EditorState with closeBrackets, '"')` 在 `String s = |` 上确实补出 `""`
    ⇒ 谁把实现改回 `return false`，「前提」+「关掉 ⇒ 文档只多一个引号」两条一起变红，不是恒真断言；
  · 同精度重写：`quoteActionWithSwitch` 那 5 条档位断言留在 `tests/editor-quote-faces.test.mjs:103-119`，未放松。

## 3. 没做 / 做不到 / 无法核实

- 未做（次序表里已登记、不是本批范围）：`EnterAfterJavadocTagHandler`（`xml:1171`，要靠 javadoc PSI）、
  `InjectedIndentPostProcessor`（`xml:1167-1170`，要靠 injected fragment）、两条 TODO 分支（`TodoConfiguration`）。
- 无法核实：C/C++、TS/JS 的 `QuoteHandler` 不在社区树（CLion / 商业 JS 插件）⇒ 表里不给它们引号规则（既有决定，本批复用）。
- 观察不到的差别（如实记，不假装）：`SMART_INDENT_ON_ENTER`（`CodeInsightSettings.java:129`）本仓没有那一格键
  ⇒ `Default` 与 `DefaultForceIndent` 在本仓同解（依据 `EnterHandler.java:167-171`，见 `src/enterHandlerOrder.ts:20-25`）。
- 本批**未新增任何持久化键**（三把键的默认值早已在 `src/settingsModel.ts:265` 与 `native/settings_schema.cpp:413` 逐键给齐）。

## 4. 实跑与合规

- `node --test tests/editor-enter*.test.mjs tests/comment*.test.mjs tests/module-size.test.mjs` ⇒ **59/59 绿**（新增 7 条在其中）。
  另跑了同域相邻的 `tests/editor-quote-faces.test.mjs` + `tests/quote-handler-registry.test.mjs` ⇒ 18/18 绿（本批把 `editorTyping.ts`
  的键位体抽了函数，那两条用正则钉源码形状，必须确认没被改坏）。
- 动过的文件：`src/editorTyping.ts`（实现 + 头注释订正）、`src/enterHandlers.ts` / `src/editorEnterBlockComment.ts`（**只有注释订正**：
  两处还写着「宿主那一行在保留文件里 ⇒ 请求 R1」，实际 `src/components/CodeEditor.vue:117`/`:966` 已落地、W-1 已闭环）。
  新增：`tests/editor-enter-switches.test.mjs`、本文。
- 禁区未碰：`native/`、`src/components/CodeEditor.vue`（1147 行上限未动）、`src/App.vue`、`src/bridge.ts` 及派单列出的其余文件。
  动手前 `git status --porcelain` 复核过：本批四个文件的行不在 M 列表里。
- 探针残留：全仓 grep 派单给的那串本批专用前缀 ⇒ **0 命中**（写文档时也不落字面量，避免自指命中）。
  本批的实测（CodeMirror 兜底配对那一条）都走 `node --input-type=module -e` 内联跑，未在源码里插过任何标记。
