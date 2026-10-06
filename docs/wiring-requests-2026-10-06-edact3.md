# 接线请求 2026-10-06 · edact3（编辑器动作域收口）

本文件是第一任 `edact3` 报告（`docs/batch-2026-10-06-edact3.md` §7）**点了名但没落盘**的那份；由收口代理补写，
每条给「目标文件 + 目标行号 + 可照抄 old/new + 上游坐标」。判词表、行号勘误、门禁与反向验证数字都在
`docs/batch-2026-10-06-edact3.md` §10（本轮实测）。

一句话现状：**模块侧全部落完并接上了消费链**（本域三个新文件都不是孤儿，零消费方门禁绿），
**只差保留文件里两行装配**（W-1）与**判词升档的文案**（W-3）。W-2 已落地，本文件只做记录。

---

## W-1 `src/components/CodeEditor.vue`：把三格回车/引号设置与语言 id 灌进调用点（**必须**，否则设置页那三格仍是空旋钮）

现状证据（本轮打开核对）：

| 键（保留文件 `src/settingsModel.ts`） | 界面（`src/components/EditorEnterKeysFields.vue`，已由 `src/components/SettingsDialog.vue:781` 渲染） | 上游开关 | 本仓执行侧（已写好，只等值） |
| --- | --- | --- | --- |
| `autoInsertPairQuote`（`:427`，默认值在 `:223`） | `:29` 「插入成对引号」 | `platform/analysis-impl/src/com/intellij/codeInsight/CodeInsightSettings.java:140`（默认 true），把关在 `platform/lang-impl/src/com/intellij/codeInsight/editorActions/TypedQuoteImpl.java:66-68` | `src/editorTyping.ts:181`（第 2 实参 `autoInsertPairQuote`）、`:193`（问开关）、`:197`（挡住 face 那一档）、`:215-217`（挡 `skip`/`pair`） |
| `closeCommentOnEnter`（`:429`） | `:33` 「闭合块注释」 | `CodeInsightSettings.java:132`，问在 `platform/lang-impl/src/com/intellij/codeInsight/editorActions/enter/EnterInBlockCommentHandler.java:62` | `src/enterHandlers.ts:110`（`EnterLanguage.blockCloseOnEnter`）、`:471`（实参）、`src/editorEnterBlockComment.ts:181/:193`（`closeOnEnter`） |
| `insertBraceOnEnter`（`:431`） | `:31` 「插入成对的 `}`」 | `CodeInsightSettings.java:130`，开关本体 `enter/EnterAfterUnmatchedBraceHandler.java:84-86`（返回 0 后在 `:50-51` 短路） | `src/enterHandlers.ts:113`（`EnterLanguage.insertBraceOnEnter`）、`:457`（把关） |

`src/editorTyping.ts` 与 `src/enterHandlers.ts` 都是**不传就按上游默认 true** 的形状（`?? true` / `= () => true`），
所以不接也不会把现有行为改坏 —— 但界面就是假的，规约 §3 不许。

### 改法 A（推荐）：`src/components/CodeEditor.vue:115-117` 整段替换，**净 0 行**

```ts
// 现在（1146 行的文件，登记上限 1147，见 tests/module-size.test.mjs:135-136）
const smartEnter = smartEnterCommand(() => smartEnterLanguageFor(
  (view ? commentStyleFromState(view.state, view.state.selection.main.head) : null)
    ?? commentStyleFor(undefined, props.path)))
```

```ts
// 改成（仍是 3 行；行文本仍以 `smartEnterCommand(() => smartEnterLanguageFor(` 开头 ⇒ 被钉的形状断言不用动）
const smartEnter = smartEnterCommand(() => Object.assign(smartEnterLanguageFor(
  (view ? commentStyleFromState(view.state, view.state.selection.main.head) : null)
    ?? commentStyleFor(undefined, props.path), props.language), { blockCloseOnEnter: props.settings.closeCommentOnEnter, insertBraceOnEnter: props.settings.insertBraceOnEnter }))
```

三点说明：

1. **为什么给 `Object.assign` 而不是 `{ ...x, … }`**：`tests/editor-enter-block-comment.test.mjs:147` 钉的是字面量
   `smartEnterCommand(() => smartEnterLanguageFor(`。`docs/wiring-requests-2026-10-06-editorinput.md:26-31` 的「改法一」
   把箭头体换成 `{ const style = … }`，那串字面量就不再出现 ⇒ 它 `:58-59` 那句「改成上面那段仍然匹配」**实测不成立**，
   照抄会把这条判据打红。`Object.assign` 版保住形状，`Object.assign` 在本仓不是新写法（`src/bridge.ts:626`、
   `src/colorScheme.ts:257` 都在用）。
2. **为什么顺手补第二个实参 `props.language`**：`smartEnterLanguageFor(style, language?)`
   （`src/enterHandlers.ts:133-142`）不传语言 ⇒ 字符串字面量那一族对所有语言都按改动前的档位切；
   传了才走「只有 JavaLike 的引号语言才允许把字面量切开」这条上游门槛
   （`enter/EnterInStringLiteralHandler.java:39-42` 的 `instanceof JavaLikeQuoteHandler`；
   全社区树只有 `java/java-frontback-impl/src/com/intellij/codeInsight/editorActions/JavaQuoteHandler.java:31` 一家）。
3. **别改 `tests/module-size.test.mjs`**：改法 A 是同行加长，`CodeEditor.vue` 仍是 1146 行。

### 改法 B：`src/components/CodeEditor.vue:968` 同行替换，**必须同时**改一条判据（不许删）

```ts
// 现在
        smartQuotes(() => props.language), angleBraceHighlight(() => props.language),
```

```ts
// 改成（行数不变）
        smartQuotes(() => props.language, () => props.settings.autoInsertPairQuote), angleBraceHighlight(() => props.language),
```

同一条 commit 里把 `tests/editor-quote-faces.test.mjs:128` 从

```ts
  assert.match(view, /smartQuotes\(\(\) => props\.language\), angleBraceHighlight\(\(\) => props\.language\)/,
```

改成（**只加不减**：既钉挂点，也钉「第二个实参问的是那条开关」）

```ts
  assert.match(view, /smartQuotes\(\(\) => props\.language, \(\) => props\.settings\.autoInsertPairQuote\), angleBraceHighlight\(\(\) => props\.language\)/,
```

理由与坑（与 `docs/wiring-requests-2026-10-06-editorinput.md:42-47` 一致，本轮复述以免两条请求打架）：
**不要**写成「开关关掉就不挂 `smartQuotes`」。本仓挂着 `basicSetup`，它自带 `closeBrackets`，
摘掉本模块只会退回 CodeMirror 那套固定字符集的配对；上游关掉 `AUTOINSERT_PAIR_QUOTE` 的语义是
「敲进去就是一个普通字符」（`TypedQuoteImpl.java:66-68`），两者不等价。
`wrap`（有选区时包住）不受这条开关管 —— 那是另一条 `SURROUND_SELECTION_ON_QUOTE_TYPED`
（`CodeInsightSettings.java:137`，问在 `SelectionQuotingTypedHandler.java:47`），本仓没有那一格设置 ⇒ 恒开，
已在 `docs/batch-2026-10-06-edact3.md` §6 记为做不到。

### 改完请跑的数（本域判据，全部已绿）

```
node --test tests/editor-enter-handlers.test.mjs tests/editor-enter-block-comment.test.mjs \
  tests/editor-enter-order.test.mjs tests/editor-quote-faces.test.mjs tests/quote-handler-registry.test.mjs \
  tests/editor-fill-paragraph.test.mjs tests/editor-code-block.test.mjs tests/smart-enter.test.mjs \
  tests/editor-brackets.test.mjs tests/inline-completion-typing.test.mjs tests/structural-code-block.test.mjs
node --test tests/module-size.test.mjs
```

期望：**119 / 119**（本轮实测；只跑这 10+1 个文件，别跑全量 `npm test`）与 module-size **5 / 5**。
两条开关都接上后，`src/components/EditorEnterKeysFields.vue` 的三格就不是空旋钮了；
旧存档缺这三键的补默认逻辑不用再加 —— 三键的默认值已经写在 `src/settingsModel.ts:223` 的
`defaultEditorSettings` 里，本请求不新增持久化键。

---

## W-2（**已落地，无需再接**，留档以免下一轮再提）`editorLanguageId` facet 挂载

第一任 §7 里这条是「等宿主挂」；本轮核对：挂载已在 `11a736e` 落盘 ——
`src/components/CodeEditor.vue:486` 在语言档切换时把 `editorLanguageIdExtension(props.language)`
与语法扩展一起 `reconfigure`（facet 定义 `src/editorMatchBrace.ts:51`、扩展工厂 `:54-55`）。
消费链已完整：`src/editorCommands.ts:45`（import）+ `:179`（`state.facet(editorLanguageId) ?? ''`）
→ `src/editorCodeBlock.ts:168-173`（`codeBlockTarget` 问结构那半）→ `src/structuralCodeBlock.ts:471-474`。
判据：`tests/editor-code-block.test.mjs` 里「语言档经 facet 传到命令」那条走的是真实 `EditorState`（`:19` 建 state 时挂 facet），
本轮把 `src/editorCodeBlock.ts:169` 剪成 `null` 时它就是红的四条之一（数字见批次报告 §10.4 的注入 A）。

---

## W-3 判词升档（保留文件：`docs/inventory/*`，本域一个字没改）

`docs/inventory/verdict-platform_rest.md:55` 的 `lp/editor-actions` 那一行现在写的是**过期判词**
（三处「未做/无落点」其实已做）。该行的文案是从 `docs/inventory/platform_rest_verdict_table.json` 里
该族条目的 `reason` 串生成的（同一条 `reason` 串在 json 里被复制了 153 处，本轮 `grep -c` 实测），
所以**请改 json 里那条 `reason`（`docs/inventory/platform_rest_verdict_table.json:225` 起的第一处）后重算生成物**，
不要只改 md。

### 逐字改法（三处子串替换，其余文本不动）

1. 原文子串（族 `reason` 里 ① 那一整句）：

   `缺：①逐语言 \`TypedHandlerDelegate\`/\`QuoteHandler\`/\`BraceMatcher\` 扩展点与配对括号高亮（编辑器 keymap/输入处理在 \`src/components/CodeEditor.vue\`，本批冻结；本仓输入链路是 CodeMirror 内建 + LSP）；`

   改为：

   `缺：①逐语言 \`TypedHandlerDelegate\` 全族与 \`BraceMatcher\` 扩展点（**\`QuoteHandler\` 那一半已做**：20 条逐语言注册表 + 两条「这次不补配对」的门槛 + Java 文本块 face 三支，落点 \`src/quoteHandlerRegistry.ts\`/\`src/editorQuoteFaces.ts\`/\`src/editorTyping.ts\`，判据 \`tests/quote-handler-registry.test.mjs\`/\`tests/editor-quote-faces.test.mjs\`；仍缺的是别的语言的 \`TypedHandlerDelegate\` 与逐语言 \`BraceMatcher\` 注册面）；`

2. 原文子串（② 那一整句）：

   `②回车家族 \`enter/*\`（\`EnterBetweenBracesHandler\`/\`EnterAfterUnmatchedBraceHandler\`/\`EnterInStringLiteralHandler\`/\`EnterInLineCommentHandler\`）没有 IDEA 语义（同上，\`basicSetup\` 的换行缩进承担）；`

   改为：

   `②回车家族 \`enter/*\`：**已按上游次序表实现**（平台那 7 条注册 + 五档 \`Result\` + 「逐个问、第一个接管的算」的循环在 \`src/enterHandlerOrder.ts\`，四条实现在 \`src/enterHandlers.ts\`，判据 \`tests/editor-enter-order.test.mjs\`/\`tests/editor-enter-handlers.test.mjs\`；未做 \`EnterAfterJavadocTagHandler\`（要 javadoc PSI）与 \`InjectedIndentPostProcessor\`（要注入片段层），两条理由都写在表里 \`ported:false\`）；`

3. 原文子串（⑥ 那一串「无落点」）：

   `⑥其余无落点：Emacs 一族（\`emacs/*\`）、\`FillParagraphAction\`（纯文本可做，未做）、\`FixDocCommentAction\`、\`CodeBlockStart/End*\`、\`CodeDocumentationUtil\``

   改为：

   `⑥其余无落点：Emacs 一族（\`emacs/*\`）、\`FixDocCommentAction\`、\`CodeDocumentationUtil\`（**\`FillParagraphAction\` 已做**：只在纯文本档动手，\`src/editorFillParagraph.ts\` + 命令 \`paragraph.fill\`（\`src/editorCommands.ts:227\`）+ 菜单行 \`src/menus/editMenu.ts:114-122\`，判据 \`tests/editor-fill-paragraph.test.mjs\`，上游 \`fillParagraph/ParagraphFillHandler.java:208-210\`；差一档：折行按字符数、未展开 \`LineWrappingUtil.java:108\`（\`tabSize\`）与 \`:112\`（\`spaceSize\`）那一档制表符视觉宽度。**\`CodeBlockStart/End*\` 已做**：两支合并在 \`src/editorCodeBlock.ts:168-173\` + \`src/structuralCodeBlock.ts:480-491\`，上游 \`CodeBlockUtil.java:108-120\`/\`:176-188\`；本仓打开得了的语言在上游都是 \`EMPTY_RANGE\` ⇒ 对用户退化成括号档，如实记 \`[~]\`）`

### 另外两行（同族、同一条 presence 判据造成的误读）

`docs/inventory/platform_rest_verdict_table.md:8005-8006` 里 `FillParagraphAction` 与
`LanguageFillParagraphExtension` 两行的最后一列写「从未出现」。**这不是功能判断**：presence 这一列是
`scripts/verdict_table.py:983` 按「上游类名有没有在本仓代码里逐字出现」算的，而本仓的实现叫
`fillParagraphCommand` / `paragraph.fill`（不叫 `FillParagraphAction`）⇒ 只能是「从未出现」。
处置二选一（脚本与 md 都是保留文件，交主代理）：
(a) 在 verdict_table.py 的符号别名表里加 `FillParagraphAction → fillParagraphCommand`；
(b) 不动脚本，接受这一列的形状，只按 `tier` 列判 —— 那么请把这两行的 `tier` 从 `~` 升到 `x`
（判据同上，`FillParagraphAction` 那一族本仓的行为面已齐；`LanguageFillParagraphExtension`
（`fillParagraph/LanguageFillParagraphExtension`）本仓没有逐语言折行策略层，保持 `~` 并注明「纯文本档已做」）。

---

## W-4 需要拍板，**不是挂载**：`src/structuralCodeBlock.ts:459` `pythonCompoundKeywordRanges` 只有测试消费方

- 事实（本轮 grep 全仓 `src` + `tests` + `docs`）：生产侧**零**消费方，只有
  `tests/structural-code-block.test.mjs:19-20`（import）与 `:127/:133/:143/:149`（断言）。
  文件级门禁抓不到它 —— 同文件的 `findCodeBlockRange`（`:471-474`）与 `listRunStartsHere/listRunEndsHere`（被
  `src/structuralSearchModifiers.ts:47/:402/:405` 消费）都有真实消费方 ⇒ 门禁绿（收工实况：登记 7 / 基线 8 · 新增 0 · 清掉 1，
  被清掉的那条是别域的 `src/jarRun.ts`）。
- 上游用途：`platform/lang-impl/src/com/intellij/codeInsight/highlighting/CodeBlockSupportHandler.java`
  的兄弟方法 `getCodeBlockMarkerRanges`（`AbstractCodeBlockSupportHandler.java:66-76`）= 块面标记/高亮用的，
  本仓没有那个面（也没有 Python 语言档，`src/editorLanguage.ts:15-21`）。
- 处置建议二选一，**本域不擅删**：这文件与那 5 处断言是搜索域（`docs/batch-2026-10-06-search2.md`）交付的，
  规约 §2 不许越界删别人的东西；而且删它要同步删断言，属放松断言。
  (a) 留着，并在 `.tools/orphan-baseline.txt` 里给它记一行「导出级零消费方，等 Python 档或块面高亮」
  —— 注意那文件是孤儿基线，按脚本形状加注释行即可；
  (b) 由搜索域自己删函数 + 删那 5 处断言。

---

## 本域**不**需要的东西（避免重复请求）

- 不需要动 `src/App.vue`、`src/settingsModel.ts`、`src/keymap*.ts`、`src/actionRegistry.ts`、
  `scripts/verdict_table.py`、`tests/module-size.test.mjs`、`tests/source-citations.test.mjs`、`CMakeLists.txt`、`native/*`。
  设置键、界面、命令注册、菜单行**都已存在**（W-1 只是把值送到调用点）。
- `paragraph.fill` 上游没有默认键位（`$default.xml` 里没有它，全树只有
  `platform/platform-resources/src/keymaps/Sublime Text.xml:130` 给了键），所以本仓只挂菜单行、不挂键，
  这是照上游，不是漏（依据写在本域报告 §1 的 paragraph 行）。
