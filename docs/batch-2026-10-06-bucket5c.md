# 桶 5c：回车家族 / 注释 —— 9 条判据逐条对上游核实（2026-10-06）

上游基准树：`D:\Backup\Downloads\intellij-community-master\intellij-community-master`（全程本地读源码，未上网）。
本桶文件归属范围内只动了 `src/enterHandlers.ts`、`src/editorEnterBlockComment.ts`、
`tests/editor-enter-handlers.test.mjs`、`tests/editor-enter-block-comment.test.mjs`。

## 0. 接手时的实况（与工单描述不一致，先记着）

工单里的跑测命令写的是 `tests/enter-handlers.test.mjs` —— **这个文件不存在**，真名是
`tests/editor-enter-handlers.test.mjs`（`node --test` 对不存在的路径不报错，所以那条命令看起来"跑了四条文件"）。
工单列的 9 条在我接手时**已经全绿**：主代理把 `src/editorEnterBlockComment.ts` 里 4 处 JSDoc 正文的裸
`/*` / `*/` 改成 `//` 行注释（01:06）之后，被嵌套块注释吞掉的实现代码回到运行期，那两条词法判据
（字符串/行注释里的 `/*` 不算、块注释那一步的次序）就恢复了对上游的语义。
最后一次红态留档：`full-test-snapshot2.txt:1312`（`blockCommentAt` 的 `"/* x */"` 返回 `{start:11, close:16}`
⇒ 字符串里的 `/*` 被当成注释）、`full-test-snapshot2.txt:1322`（次序门：注释两条排在字面量之后）。

因此本轮的工作不是"救红"，而是**把这 9 条逐条按上游重新判一遍**，结果：
1 条断言编码了被改坏的行为（#5）、2 处命令层实现与上游不等价（#5、#8，其中 #8 会写出编译不过的代码）、
1 处上游行号抄错（#9）、其余为"实现与断言都对，只缺订正理由"（#1、#2 补上游依据）。

## 1. 9 条逐条判决

| # | 测试（本仓文件:行） | 判的是 | 上游依据（相对路径:行号） | 本仓落点（文件:行） | 改了什么 |
|---|---|---|---|---|---|
| 1 | `blockCommentAt：…闭尾` `tests/editor-enter-block-comment.test.mjs:34` | 断言过期（`close:6`→`5`；工单给的判据成立） | `platform/lang-impl/src/com/intellij/codeInsight/editorActions/enter/EnterInBlockCommentHandler.java:113-119`：`tokenEnd = iterator.getEnd()` 是**排他**末尾，`offset > tokenEnd - suffix.length()` 比的就是闭尾 `*/` 的**起始**下标（`'/* a */'` ⇒ 7−2=5） | `src/editorEnterBlockComment.ts:79-84`（`text.indexOf(close, start + open.length)` = 5）、`:90-119` | 值已是 5，不动精度（保持 `deepEqual`）；在断言旁补 6 行订正留痕（上游 113-119 + 实现行号） |
| 2 | `blockCommentClose / blockCommentComplete` `tests/editor-enter-block-comment.test.mjs:47` | 断言过期（同上，`6`→`5`） | 同上 `:113-119`；「注释必须以 suffix 收尾」的默认判据 `platform/lang-impl/src/com/intellij/codeInsight/editorActions/EnterHandler.java:200-210`（`:209-210` 取 `getBlockCommentSuffix` 并 `endsWith`） | `src/editorEnterBlockComment.ts:79-84`、`:137-139` | 值已是 5；补一行订正理由指向 #1 的同处依据；`deepEqual`/`equal` 未放宽 |
| 3 | `smartEnterCommand 接上了块注释那一步（次序）` `tests/editor-enter-block-comment.test.mjs:114` | 实现曾被改坏（红态见 `full-test-snapshot2.txt:1322`），现已修好；断言正确 | 注册表 `platform/lang-impl/resources/intellij.platform.lang.impl.xml:1159-1171`；逐个问 `EnterHandler.java:136-137` | `src/enterHandlers.ts:236-249`（② 块注释，位于 ① 行注释 `:225-235` 与 ③ 字面量 `:251-266` 之间） | 未改行为；把注册表注释里漏掉的 `order="last"` 补记为 `:1161-1162`（见 §3） |
| 4 | `注释前有代码且光标正挨着一个空格 ⇒ 不补分隔（:80）` `tests/editor-enter-handlers.test.mjs:61` | 实现与断言都对 | `platform/lang-impl/src/com/intellij/codeInsight/editorActions/enter/EnterInLineCommentHandler.java:79-81`（`else { if (text.charAt(caretOffset) == ' ') spacing = ""; }`）+ `:82` 落 `prefixTrimmed + spacing` | `src/enterHandlers.ts:122-124` | 无（逐行核对：`'int x; // abc def'` caret 13 ⇒ `insert '//'`、caretAdvance 0，与 `:85-87` 只在 `onlyCommentInCaretLine` 时挪光标一致） |
| 5 | `光标后面紧跟又一个行注释前缀…` `tests/editor-enter-handlers.test.mjs:66` | **实现坏 + 断言过期**（断言把坏行为写成「光标不动」） | `EnterInLineCommentHandler.java:56-62`（补缺的那一个空格 + `caretOffsetRef.set(offset)`）与 **`:85-87` 在那个 if/else 之外** ⇒ `onlyCommentInCaretLine` 时 `caretAdvance = prefixTrimmed.length() + spacing.length()` = 3；`caretAdvance` 的初值 0 见 `EnterHandler.java:134` | `src/enterHandlers.ts:101-113` | 实现：这一支的 `caretAdvance` 由 `0` 改为 `onlyCommentInCaretLine ? prefixTrimmed.length + spacing.length : 0`，`spacing` 提到两支之前（`:55` 的初值就是 `" "`）；断言：`0`→`3`（两条，含已带空格那例）、标题去掉"光标不动"，并加端到端判据（`// abc\n// def`，光标 = 新行行首 + 3）。`:61` 的光标搬移动作由 CodeMirror `insertNewlineAndIndent` 吞掉光标后空白等价达成（`node_modules/@codemirror/commands/dist/index.js` `newlineAndIndent` 里 `while (to < line.to && /\s/…) to++`），已在代码注释里写明 |
| 6 | `三条退出门槛：offset < 1、语言没有行注释、前缀不在光标之前` `tests/editor-enter-handlers.test.mjs:84` | 实现与断言都对 | `EnterInLineCommentHandler.java:94`（`if (offset < 1) return pair(-1, null)`）、`:36`（commenter 为 null ⇒ Continue）、`:103-105`（`startOffset + prefix.length() <= offset` 才接管）、`:97`（光标前那个 token 得是行注释类型） | `src/enterHandlers.ts:92-95` | 无（`caret < 1 || start < 0 || start + prefix.length > caret` 与 `:94`/`:97`/`:103-105` 三条一一对应） |
| 7 | `structuralBraceCounts：只数代码里的花括号` `tests/editor-enter-handlers.test.mjs:99` | 实现与断言都对 | `platform/lang-impl/src/com/intellij/codeInsight/editorActions/enter/EnterAfterUnmatchedBraceHandler.java:322-378`，其中 `:327-329`（光标前一个字符必须就是 `{`）、`:344-375`（逐 token：`beforeOffset` 分侧计数、`:363-365` 左括号抵扣、`:369-372` 追平时 `return 0`）、`:377`（`lBracesBeforeOffset - rBracesAfterOffset`）；`:104-113` 数连续空白里的 `{`、`:135-144` 插在哪、`:173` 插 `"\n" + braces`、`:51` `maxRBraceCount > 0` | `src/enterHandlers.ts:134-159`（计数）、`:167-186`（落点）、`smartEnterCommand` ④ `:268-276` | 无；端到端复核 `if (x) {` + Enter ⇒ `if (x) {\n\n}`、光标在空行 ⇒ 与 `:57` 的 `Result.DefaultForceIndent` 一致 |
| 8 | `enterInStringLiteral：插 " + "，光标停在补出来的第二个引号之后` `tests/editor-enter-handlers.test.mjs:115` | **命令层实现坏**（函数返回值本身对上游；标题承诺的光标位置既没断言也没做到，且写出的代码是坏的） | `EnterInStringLiteralHandler.java:66-81`：`:71-72` 插 `首字符+" "+连接符` 再 `" "+首字符`（Java 连接符 `+`，`java/java-frontback-impl/src/com/intellij/codeInsight/editorActions/JavaQuoteHandler.java:83-86`）；**`:73` `caretOffset += insertedFragment.length()`**（切点在 `" +` 之后）；`:74` `caretAdvance = 1`；`:81` `Result.DefaultForceIndent`；门槛 `:46`（`psiAtOffset.getTextOffset() < caretOffset`） | `src/enterHandlers.ts:251-266`（命令层：插入的同一条事务里把切点显式设到 `at + insert.length - 2`，回车后 `+1`）、`:192-206`（函数） | 实现：旧写法只 dispatch 插入就换行 —— CodeMirror 把光标映射到插入文本**之前**，结果 `String s = "ab` / `" + "cd"`，上一行留下没闭合的字面量。现按 `:73-74` 定切点与光标，端到端判据钉成 `String s = "ab" +\n"cd"`、光标 = 补出来的第二个引号之后一位。断言：新增两条端到端 `equal`（未删未放宽） |
| 9 | `回车四条的问法次序与注释里引号的保护` `tests/editor-enter-handlers.test.mjs:132` | 断言核的是**抄错的上游行号** | 「逐个问、第一个接管」的循环是 `EnterHandler.java:136-137`（preprocessEnter）；`:181` 是 **postProcessEnter** 的循环 ⇒ 旧断言 `EnterHandler\.java:181` 指错了地方。次序表：`intellij.platform.lang.impl.xml:1159-1171`；返回值处置 `EnterHandler.java:145-151` | `src/enterHandlers.ts:3-12`（模块头）、`smartEnterCommand` ①②③④ `:225-276` | 模块头 `:181`→`:136-137`（并在注释里写明旧抄法错在哪）、`:145-149`→`:145-151`；断言的 `match` 同步改成 `/EnterHandler\.java:136-137/`，理由写进 message |

## 2. 验证数字

- 改前（接手时，本轮第一条命令实测）：`tests/editor-enter-block-comment.test.mjs` 12/12、
  `tests/editor-enter-handlers.test.mjs` 11/11、`tests/comment-toggle.test.mjs` 12/12、
  `tests/editor-brackets.test.mjs` 11/11 ⇒ **46 tests / 46 pass / 0 fail**（工单说的 9 条红，在这个时点已随
  主代理的注释修复转绿；最后一次红态 = `full-test-snapshot2.txt`，我域内 2 条）。
- 改后（同一批 + `tests/smart-enter.test.mjs`）：`node --test` ⇒ **56 tests / 56 pass / 0 fail**
  （块注释 13、回车 handler 11、注释切换 12、括号 11、完成语句 9）。
- 类型：`npx vue-tsc -b --force` 全仓只剩 1 条与本轮无关的
  `src/keymapBindings.ts(111,29): TS2322`；我域内 5 个源文件 0 条错误。
- 行数门：`src/enterHandlers.ts` 277 行、`src/editorEnterBlockComment.ts` 212 行（上限 900）；
  `tests/module-size.test.mjs` 唯一红项是 `src/components/WelcomePage.vue(920 行)`，别人的，与本轮无关。
- 引用门：`tests/source-citations.test.mjs` 的两条红项在
  `docs/batch-2026-10-06-bucket2c.md`、`docs/wiring-requests-2026-10-06-bucket14c.md`（别的桶），
  我新增/修改的 `src/` 引用全部核得过（路径存在且行号不越界，含本轮写进 `docs/` 的那些）。

### 反向验证（注入违规 ⇒ 确认会红 ⇒ 撤掉）

1. 把 `src/enterHandlers.ts` ② 那支的 `caretAdvance` 改回 `0`、并删掉字面量那条的
   `selection: { anchor: line.from + splitAt }` ⇒ `tests/editor-enter-handlers.test.mjs`
   **11 tests / 9 pass / 2 fail**，红的正是 #5 `光标后面紧跟又一个行注释前缀…` 与
   #8 `enterInStringLiteral…` 两条（不是别条误伤）。
2. 把命令里 `enterInBlockComment(doc…)` 改名成 `enterInBlockCommentX(doc…)` ⇒
   `tests/editor-enter-block-comment.test.mjs` **12 / 11 / 1**，红的是 #3 那条次序/接线门。
3. 两次注入都用改前备份覆盖回去（未使用 `git checkout`/`reset`/`stash`/`clean`），
   复跑 `56 / 56 / 0` 并 `grep -c enterInBlockCommentX src/enterHandlers.ts` = 0 确认无残留。

## 3. 订正留痕（动过的断言，全部给上游行号）

1. **#5** `assert.equal(result.caretAdvance, 0)` → `3`；标题「光标不动」→「光标仍按 :85-87 前进」。
   依据 `EnterInLineCommentHandler.java:85-87` 在 `:56-62`/`:63-83` 的 if/else **之外**，
   `spacing` 在这一支没被改过（`:55` 就是 `" "`）⇒ `prefixTrimmed.length() + spacing.length()` = 3；
   `:61` 另把光标推到那个前缀上（本仓由 CodeMirror 的吞空白行为等价达成）。同例再补一条
   `alreadySpaced.caretAdvance === 3`。
2. **#8** 新增两条端到端断言（`String s = "ab" +\n"cd"`、光标在补出来的第二个引号之后一位），
   依据 `EnterInStringLiteralHandler.java:72-74`。原 4 条函数级断言一字未动。
3. **#9** `EnterHandler.java:181` → `EnterHandler.java:136-137`（`:181` 是 postProcessEnter）。
4. **#1/#2** 断言值已是上游正确的 5，只补订正理由；未把 `deepEqual`/`equal` 放宽成 `match`/`ok`。
5. **模块头补记**：`intellij.platform.lang.impl.xml:1161-1162` 的 `EnterInBlockCommentHandler`
   带 `id="blockComment" order="last"` ⇒ 上游实际把它排到最后问。本仓把块注释排在第②步（行注释之后、
   字面量之前）是**有意差别**：本仓只有词法扫描、没有 token 类型，先问注释才能让
   `/* 里有引号` / `// 里有引号` 不被字面量那条误切（原由记在 `src/enterHandlers.ts:10-12`）；
   两条判据在构造上互斥（光标在块注释里 ⇒ 不在字面量里、也不在 `{` 之后），所以次序改动不产生新接管。

## 4. 已知与上游的偏差 / 做不到 / 无法核实

- **无法核实**：`EnterInBlockCommentHandler.java:70-84` 的 TODO 续行额外缩进（依赖
  `TodoConfiguration.isMultiLine()` 与图案表）—— 本仓 todo 面板归桶 2/别的桶，没做，模块头 `:15-16` 有记。
  同 `EnterInLineCommentHandler.java:68-72` 的 TODO 分隔多一个空格那一支同理。
- **做不到**：文档注释 `/** …` 那一族（`EnterAfterJavadocTagHandler.java`、`EnterHandler.java:417-428` 的
  javadoc 生成）要靠 PSI 找方法声明，本仓没有 PSI ⇒ 与上游 `:48-51` 一样退出（返回 null）。
  模块头 `:30-32` 有记。
- **判不准就不动**：`enterInStringLiteral` 光标落在转义序列里（上游 `:69 skipStringLiteralEscapes`）
  没有 token 边界可依据 ⇒ 返回 null 交回默认回车（测试钉着这条）。
- **实现更严的一处**：`EnterInBlockCommentHandler.java:53-54` 写的是
  `if (beforeWhitespace > 0 && text.charAt(beforeWhitespace) != '\n') return Continue` ——
  当下一个非空白字符正好落在**偏移 0**（如 `x/*abc`）时上游**不**退出，本仓退出（`src/editorEnterBlockComment.ts:186`
  用 `>= 0`）。上游那条 `> 0` 看着像 off-by-one：它会为一行中间的注释补出 `\n */` 并把缩进取成
  `subSequence(1, start)` 这种没有意义的切片。本仓保留更严的行为（宁可不接管也不写坏代码），
  如实记在这里，不当作"已对齐"。
- **`CLOSE_COMMENT_ON_ENTER` 没有设置项**：实现按上游默认 true（
  `platform/analysis-impl/src/com/intellij/codeInsight/CodeInsightSettings.java:132`），
  `enterInBlockComment` 留出 `closeOnEnter` 形参与判据（`tests/editor-enter-block-comment.test.mjs:93`），
  但**没有渲染任何假开关**；要露到设置里见 `docs/wiring-requests-2026-10-06-bucket5c.md` 第 2 条。
- **消费链缺口（重要）**：`src/components/CodeEditor.vue:114-118` 只把 `{ line }` 喂给 `smartEnterCommand`，
  没有给 `block` ⇒ 块注释回车那一条在真实编辑器里**永远问不到**。本轮补了转换助手
  `blockLexiconFor`（`src/editorEnterBlockComment.ts:54-60`，含 `tests/editor-enter-block-comment.test.mjs:22` 判据），
  替换代码写在 `docs/wiring-requests-2026-10-06-bucket5c.md` 第 1 条，等主代理落。
