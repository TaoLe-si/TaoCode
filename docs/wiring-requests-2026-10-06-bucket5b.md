# 接线请求 · 桶 5b（回车家族 / 逐语言引号与括号 / 粘性行）· 2026-10-06

格式按 `docs/batches-2026-10-06-buckets.md` §4。**我一行保留文件都没改**，逻辑都在自己名下的模块里。
每条都写了「挂上之后判据会发生什么」，方便复核。

## 接线请求（给主代理）

### W-1 引号规则与尖括号配对高亮根本没进编辑器（本批②的两条落地依赖它）
- 目标文件：`src/components/CodeEditor.vue` 第 955-965 行附近（`extensions: [...]` 里那个 Compartment 区，
  现在 `brackets.of(...)` 在 `:963`）
- 要接什么：
  ① `smartQuotes(() => props.language)`（出口 `src/editorTyping.ts:120`）——它自带 `Prec.high` 的键位，
     注册 `LANGUAGE_QUOTES` 里出现过的字符（现在只有 Java 的 `"`）；
  ② `angleBraceHighlight(() => props.language)`（出口 `src/editorBrackets.ts:212`）——Java 泛型 `<>` 的
     配对高亮，复用 CodeMirror 的 `cm-matchingBracket` 类名，不新增样式；
  ③ 两者都要跟着 `props.language` 变（用现有的 `Compartment` + `reconfigure`，见 `:955`/`:1057` 那一组）。
- 为什么需要：这两个导出除了自己的测试**没有任何生产消费方**（`grep -rn smartQuotes\|angleBraceHighlight src`
  只命中定义文件与 `tests/`），所以「Java 文本块 `"""` 敲完补 `\n"""`」「跳过收尾引号」「`List<│String>` 两侧一起亮」
  这些行为现在用户点不到。不挂 = 我这一族的②只做了一半。
- 上游依据：`platform/lang-impl/src/com/intellij/codeInsight/editorActions/QuoteHandler.java:28`/`:40`/`:49`/`:64`/`:66`；
  `QuoteHandlerEP.java:16-27`（按 fileType 取 handler）与
  `platform/lang-impl/resources/intellij.platform.lang.impl.xml:405`/`:408`；
  Java 那份 `java/java-frontback-impl/src/com/intellij/codeInsight/editorActions/JavaQuoteHandler.java:31`/`:58-63`/`:104-108`/`:134-149`，
  注册 `java/java-frontback-impl/resource/intellij.java.frontback.impl.xml:74`；
  尖括号那侧 `java/java-frontback-impl/src/com/intellij/codeInsight/highlighting/JavaPairedBraceMatcher.java:12`/`:26-34`。

### W-2 顶边粘性行现在点不动（上游是能点的）
- 目标文件：`src/App.vue` 第 2169-2171 行（`.sticky-lines` 那个 div 与里面的 `v-for`）
- 要接什么：把每条 sticky 变成可点的元素并
  `@click="revealLocation(stickyRevealTarget(symbol, groupActive(pane)!.path))"`；
  同时**去掉 `aria-hidden="true"`**（可交互的东西不能对读屏隐藏），并给 `title`「跳转到第 N 行」。
  出口是 `src/stickyLines.ts:117-118`（`stickyRevealTarget`）与 `:45` 新增的 `StickyLine.navigateLine`。
- 为什么需要：上游的 sticky 行挂了鼠标监听，点击把光标放到该作用域的起始 offset；
  本仓现在只是三行纯文本。样式与令牌不动（不加新 class、不自加动效）。
- 上游依据：`platform/platform-impl/src/com/intellij/openapi/editor/impl/stickyLines/StickyLine.kt:36-41`
  （`navigateOffset()` 的注释就是这个含义）、`ui/StickyLineComponent.kt:44-50`、`:211`；
  LSP 取数 `platform/lsp-impl/src/impl/features/documentSymbol/LspFileBreadcrumbsCollector.kt:57-59`
  （先 `selectionRange.start`，取不到退 `range.start`——本仓 `src/bridge.ts:143` 只有后者，所以 `navigateLine = startLine`）。
- 行号口径：`revealLocation` 收的是 **0 基**行号（同一约定见 `src/bookmarkActions.ts:241` 的 `entry.line - 1`）。

### W-3 `EditorMatchBrace` 的键位（Ctrl+Shift+M）
- 目标文件：`src/actionRegistry.ts`（动作注册）+ `src/keymapBindings.ts`/`src/keymap.ts`（绑定）
- 要接什么：动作 id `EditorMatchBrace`（中文名「移动到配对的括号」）绑 `Ctrl+Shift+M`，
  执行 `editingCommands['brace.match']`（`src/editorCommands.ts:227`，实现在 `src/editorMatchBrace.ts:174-181`）。
  注册之后请把 `src/menus/editMenu.ts:161` 那行的键位栏从 `''` 改成 `'Ctrl Shift M'`
  —— 那一格现在故意留空，不编一个按下去没反应的加速键。
- 为什么需要：命令与菜单行都到位了，只差加速键；上游这一条是有键位的（不是本仓自己加的）。
- 上游依据：`platform/lang-impl/resources/intellij.platform.lang.impl.actions.xml:23`
  （`<action id="EditorMatchBrace" class="com.intellij.codeInsight.editorActions.MatchBraceAction"/>`）；
  键位 `platform/platform-resources/src/keymaps/$default.xml:1146-1148`；
  交叉核对同目录 `Mac OS X 10.5+.xml:642`、`Sublime Text.xml:231`，
  以及 `platform/testFramework/extensions/src/com/intellij/keymap/KeymapsTestCase.java:154`。

### W-4 把块注释词法与三个回车/引号开关喂进编辑器
- 目标文件：`src/components/CodeEditor.vue` 第 114-118 行（`smartEnterCommand(() => {...})` 那个提供方）
  + `src/settingsModel.ts`/`src/bridge.ts` 的 `EditorSettings`
- 要接什么：
  ① 提供方现在只回 `{ line }`（`:117`），要补 `block`：
     `block: style?.block && { block: style.block, docPrefix: '/**', linePrefix: '*' }`
     —— `style` 已经是 `commentStyleFromState(...)`（`src/commentToggle.ts:41-43` 给的 `['/*','*/']`）。
     **没这一块，`src/editorEnterBlockComment.ts` 整套判定在生产里不会被调用**（`src/enterHandlers.ts:237-238`
     是 `if (block)` 才问）。Java 的 `/**`/`*` 字面量与 C 式注释前后缀同源：
     `java/java-psi-impl/src/com/intellij/lang/java/JavaCommenter.java:27-28`/`:32-33`/`:62-63`/`:67-68`。
  ② `EditorSettings` 补三条布尔并接进调用点（缺键要补默认值，别把老配置判坏）：
     `autoInsertPairQuote`（→ `smartQuotes` 是否注册引号键）、
     `closeCommentOnEnter`（→ `enterInBlockComment` 的第 4 个参数，现在按默认 true 走）、
     `insertBraceOnEnter`（→ `enterAfterUnmatchedBrace` 那一步）。
- 为什么需要：上游这三条都是用户能关的功能；本仓现在硬编码默认档，设置页（我的
  `src/components/CodeFoldingSettingsPage.vue` 只管折叠）够不到。
- 上游依据：`platform/analysis-impl/src/com/intellij/codeInsight/CodeInsightSettings.java:129`（SMART_INDENT_ON_ENTER）、
  `:130`（INSERT_BRACE_ON_ENTER）、`:132`（CLOSE_COMMENT_ON_ENTER，默认 true）；
  `platform/lang-impl/src/com/intellij/codeInsight/editorActions/QuoteHandler.java:10-20`（AUTOINSERT_PAIR_QUOTE）；
  用法位置 `enter/EnterAfterUnmatchedBraceHandler.java:84-87`、`enter/EnterInBlockCommentHandler.java:62`。
- 落地后请更新：`tests/editor-enter-block-comment.test.mjs` 里那条 Enter 键挂载门禁不受影响，
  但 `src/enterHandlers.ts` 的调用点会多一个参数 ⇒ 若有断言按字面匹配 `enterInBlockComment(doc.toString(), selection.head, block)`
  需同步（我自己的判据就是按这一条写的，改调用点时一起改）。

### W-5 把编辑器可视区首行透出来（粘性行的「滚出视野」那一档）
- 目标文件：`src/components/CodeEditor.vue`（emit 一个新事件或在已有的 `@cursor` 里带上）→ `src/App.vue:497`
- 要接什么：`createStickyLines({ ..., firstVisibleLine: () => <1 基首行> })`。
  出口已经就位：`src/stickyLines.ts:69-71`（`StickyLinesDeps.firstVisibleLine`）与 `:74-83`
  （给了就按「起始行已经滚出可视区」筛，不给退回按光标行判）。CodeMirror 侧取
  `view.visibleRanges[0].from` → `state.doc.lineAt(...).number`。
- 为什么需要：上游钉的是滚出视野的那些作用域，不是「包含光标的全部」；现在本仓多钉着当前屏幕上还看得见的那一层。
- 上游依据：`platform/platform-impl/src/com/intellij/openapi/editor/impl/stickyLines/VisualStickyLines.kt:67-86`
  （按 `visibleArea` 顶行算）、`StickyLinesManager.kt:32`/`:86`/`:111`（`visibleAreaChanged` 驱动重算）。

### W-6（可选，非本批阻塞）`tests/module-size.test.mjs` 的两条红
- 现状：门禁红在 `src/components/WelcomePage.vue(920 行)`（不是我的文件）；
  `tests/source-citations.test.mjs` 红在 `docs/batch-2026-10-06-bucket2c.md` 与
  `docs/wiring-requests-2026-10-06-bucket14c.md` 各一条「参考树里没有这个文件」；
  `node .tools/find-orphan-modules.mjs --gate` 红在 `src/rootsJarEntries.ts`（桶 15）。
- 只是登记归属，方便你分派；我一行都没碰。
