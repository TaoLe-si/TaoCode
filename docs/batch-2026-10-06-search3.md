# 批报告 · 桶 9 搜索/比对的模块侧两条 · 代号 search3（2026-10-06）

上游基准树（唯一真源，本批所有行号都亲自打开过）：
`D:\Backup\Downloads\intellij-community-master\intellij-community-master`。
派单：① `findCodeBlockRange`（选中/扩展代码块）缺项；② 结构化取代的 matcher **纯函数**半区（模板解析 → 匹配 → 替换文本生成）；
③ 每条配会失败的判据 + 反向验证。UI 挂载一律写请求，见 `docs/wiring-requests-2026-10-06-search3.md`。

---

## 1. 判词表

| 族 / 项 | 判定 | 上游相对路径:行号 | 本仓落点 文件:行号 | 一句话说明 |
| --- | --- | --- | --- | --- |
| `lp/editor-actions` · `CodeBlockUtil` 合并「结构支持」那半（块尾） | `[x]` 已做（**核对期间由别处落盘，非本批写入**） | `platform/lang-impl/src/com/intellij/codeInsight/editorActions/CodeBlockUtil.java:108-120`（`:110` 问结构、`:111-113` 空则用括号、`:114-116` 括号为 -1 则用结构、`:118` `Math.min`） | `src/editorCodeBlock.ts:168-173`（`codeBlockTarget(…, language)`）+ `src/structuralCodeBlock.ts:480-484`（`mergeBlockEnd`） | 派单说这条"缺"，本批开工时 `src/editorCodeBlock.ts` 确实只有 3 参、无结构半；核对期间 W-1' 请求被落盘（`git diff` 里那 29 行不是本批写的），本批独立复算把它**验**住了 |
| 同上（块首） | `[x]` 已做 | `CodeBlockUtil.java:176-188`（`:178` 问结构、`:186` `Math.max`） | `src/editorCodeBlock.ts:168-173` + `src/structuralCodeBlock.ts:487-491`（`mergeBlockStart`） | 与块尾对称 |
| 「先向内找更小的块」 | `[x]` 判据补齐 | `platform/lang-impl/src/com/intellij/codeInsight/highlighting/AbstractCodeBlockSupportHandler.java:79-83`（`getCodeBlockRange` = `getParentByTokenSet(叶子, getBlockElementTypes())` 的 textRange）+ 同文件 `:103-109`（从叶子自己起一路 `getParent()`）；契约原文 `CodeBlockSupportHandler.java:49`「smallest code block cursor is in」 | `tests/editor-code-block.test.mjs:190-202`（新判据） | 同一份嵌套 `if/else` 里光标压内层 `if` ⇒ 块首落内层关键字（10），压外层 `if` ⇒ 落 0；取到的永远是**最小**那块 |
| 「到达边界时的行为」 | `[x]` 判据补齐 | `AbstractCodeBlockSupportHandler.java:82`（祖先里没有 block 类型 ⇒ `TextRange.EMPTY_RANGE`）+ `CodeBlockSupportHandler.java:60`/`:65`（取不到叶子 / 没有 handler ⇒ EMPTY_RANGE）+ `CodeBlockUtil.java:111-116`/`:179-184`（EMPTY_RANGE ⇒ 只剩括号那半） | `tests/editor-code-block.test.mjs:204-214`（新判据） | 两支都给空 ⇒ `codeBlockTarget` 返回 null ⇒ 命令不吞键、光标原位 |
| 「无代码块语言时不动光标」（整链路） | `[x]` 判据补齐（本批净新增） | `CodeBlockUtil.java:54-57`（`if (endOffset != -1)`）、`:91-93`（`if (start < 0) return;`）；EP 注册表 `platform/lang-impl/resources/intellij.platform.lang.impl.xml:147` + 全树唯一注册项 `python/pluginResources/intellij.python.community.impl.xml:439`（`<codeBlockSupportHandler language="Python">`，本批逐行打开确认） | `tests/editor-code-block.test.mjs:150-163`（facet 写 `java` + 无括号 ⇒ 四条命令全 `ran=false`、head/anchor 都不动）、`:165-188`（同一形状换 `python` 档 ⇒ 真的动） | 这条测的是 facet → 命令的生产链路，不是只测纯函数 |
| `ss/matcher` · 整份文件的替换计划（模板解析 → 全部命中 → 逐处生成替换文本） | `[x]` 本批净新增（纯函数） | `platform/structuralsearch/source/com/intellij/structuralsearch/plugin/replace/impl/Replacer.java:125-131`（`CollectingMatchResultSink` 收**全部**命中，逐条建 `ReplacementInfo`）+ `plugin/replace/impl/ReplacementBuilder.java:132-163`（`process` 逐处展开）+ `Replacer.java:180-211`（逐处写回） | `src/structuralSearchReplace.ts:288-318`（`structuralReplacementPlan`）、`:320-325`（`applyStructuralReplacements`）、`:171-185`（`hitsWithin`） | 输入输出全是值：`{edits:[{from,to,text,before,values}], unchanged, skipped}`；`accept` 是给 `verdictForHit` 留的口 |
| `ss/matcher` · 命中不重叠 | `[x]` 本批实现并钉判据 | `impl/matcher/handlers/TopLevelMatchingHandler.java:22-34`（匹配成功且没开递归档 ⇒ **不**往子节点里钻） | `src/structuralSearchReplace.ts:171-185`（下一处从上一处 `whole.end` 起）；判据 `tests/structural-search-replace.test.mjs:151-160` | 零宽命中另加 `+1` 推进保险（上游吃的是完整节点，不会有零字符命中，这一档是本仓自加的，函数头已写明） |
| `ss/replace` · 逆序写回 | `[x]` 本批实现并钉判据 | `ReplacementBuilder.java:140-141`（`sorted.sort(comparingInt(getStartIndex).reversed())`） | `src/structuralSearchReplace.ts:320-325`；判据 `tests/structural-search-replace.test.mjs:162-170` | 用"越换越短"的替换串（`$x$`）测，正序会把下标落在已改过的文本上 |
| `ss/replace` · 空替换 = 删掉这一段 | `[x]` 判据补齐 | `Replacer.java:70-76`（`if (!image.isEmpty())` ⇒ 空文本什么都不插） | `src/structuralSearchReplace.ts:288-318`；判据 `tests/structural-search-replace.test.mjs:186-191` | `if (a == null) {}` → `if () {}` |
| `ss/replace` · 预览与复核取的是不是**同一处**命中 | `[x]` 本批修掉的不一致 | `Replacer.java:129-131`（每条 `MatchResult` 各建一条 `ReplacementInfo` ⇒ "这一处"） | `src/structuralSearchReplace.ts:215-232`（`previewStructuralReplacement(…, at)`）、`:234-250`（`previewMany` 传 `row.column`）；判据 `tests/structural-search-replace.test.mjs:192-210` | 复核早就按列号取命中（`src/structuralSearchModifiers.ts:416-417` + `:426`），预览固定从 0 起 ⇒ 一行两处时第二条结果显示的是第一条的前后文本 |
| `ss/replace` · Reformat / Use static imports / Shorten FQN | `[-]` 不适用（本仓没有落点，登记而不画控件） | `plugin/replace/ReplaceOptions.java:27-29` | `src/structuralSearchReplace.ts:214-218`（`UNAVAILABLE_REPLACE_OPTIONS`，既有） | 三条都要 `CodeStyleManager` / 导入表 / PSI；文本层没有语法树可改写。判据在 `tests/structural-search-replace.test.mjs:129-134` |
| `ss/replace` · 脚本定义（Groovy） | `[-]` 不适用 | `NamedScriptableDefinition.java:16-17`（`scriptCodeConstraint`） | `src/structuralSearchReplace.ts` 文件头 20-22 行（既有说明） | 本仓不执行模板脚本，定义值取用户写的字面文本，`""` 哨兵照抄 `:43-45` |
| 「代码块导航的缩进参考线那一支」（`CodeBlockUtil.java:49-52`/`:86-89`） | `[ ]` 未做（本批没动） | 同上两行 | — | 要一份 `getCaretIndentGuide()` 的模型；`src/editorIndentGuides.ts` 只画线不出模型（`src/editorCodeBlock.ts:32-33` 已登记）。不是本派单点名的两条之一，故只登记不擅动 |
| 「`editorLanguageId` facet 的写入方」 | `[ ]` 做不到（保留文件） | `CodeBlockSupportHandler.java:57-66` 的按语言取 EP | 生产链路缺写入方：`src/editorMatchBrace.ts:54-56` 定义了扩展、`:190` 与 `src/editorCommands.ts:179` 在读，`grep -rn editorLanguageId src` 里**没有一处挂进 state** | ⇒ 结构那半在真实编辑器里今天恒拿空语言档。已写 R-1（并指出 `src/enterHandlers.ts:74` 说"挂载点写在 bucket5b 请求"是错的，实际在 `docs/wiring-requests-2026-10-06-editorinput.md:159-166` W-3） |
| 「Python 语法数据」 | `[ ]` 做不到（保留文件 `package.json`） | `intellij.python.community.impl.xml:439` | `src/editorLanguage.ts:15-21`（只装 Java/C++/TS/JSON/HTML/CSS）、`package.json:17-22`（无 `@codemirror/lang-python`） | 已写 R-3 |

**留痕（规约 §1「要改别人的结论就留痕」）**：
- `tests/editor-code-block.test.mjs` 里那三条合并判据开工时是**红**的，写的是 `blockEndOffset` = 19、块尾 = 86、块首 = 17（原写 X）。
  本批独立复算：`'(if a:\n    x = 1\n)\n'.length = 19`，`)` 在 17 ⇒ `CodeBlockUtil.java:173`
  （`return isBeforeLBrace ? iterator.getEnd() : iterator.getStart()`）给 **17**；
  `['def f():',…,'        z = 3'].join('\n').length = 82` ⇒ 块尾不可能是 86（越界），结构区间是 `{from:13,to:82}`；块首 `if` 关键字在 13。
  实际 Y：落盘版本已把这三处改成 17 / 82 / 13，与本批复算一致 ⇒ 断言形状未放松（仍是 `strictEqual`，没改成 `includes`、没删）。

---

## 2. 改动文件清单（`wc -l` 前后）

| 文件 | 前 | 后 | 本批做了什么 |
| --- | --- | --- | --- |
| `src/structuralSearchReplace.ts` | 287 | **413** | 新增 `hitsWithin`（`:171`）、`valuesOfSpans`、`StructuralReplacementEdit`（`:258`）、`StructuralReplacementPlan`（`:268`）、`structuralReplacementPlan`（`:288`）、`applyStructuralReplacements`（`:320`）；`previewStructuralReplacement` 加 `at`（`:215`）、`previewMany` 传 `row.column`（`:245`）；文件头补 8 行上游依据 |
| `tests/structural-search-replace.test.mjs` | 137 | **220** | +6 条判据（`:151`、`:162`、`:173`、`:186`、`:192`、`:212`），测试头补 4 行上游坐标 |
| `tests/editor-code-block.test.mjs` | 135 | **214** | +4 条判据（`:150`、`:165`、`:190`、`:204`）+ `runWithLanguage` 助手；**既有 13 条一字未改** |
| `docs/wiring-requests-2026-10-06-search3.md` | —— | **97（新）** | R-1 facet 写入方、R-2 「替换全部」走 plan、R-3 Python 语法数据、R-4 右支选区语义差异 |
| `docs/batch-2026-10-06-search3.md` | —— | 本文件 | 交付报告 |
| `src/editorCodeBlock.ts` | 150 → 173 | 173 | **本批净改动 0 行**：合并段是核对期间 W-1' 请求被落盘的（`git diff --stat` 的 29 行不属于本批）。本批只在此文件做过一次临时注入反向验证，已逐字还原（`grep -n "TEMP 反向验证" src/` = 0 命中） |

只读而未改的文件（本批亲自打开核实过）：`CodeBlockUtil.java`、`CodeBlockSupportHandler.java`、`AbstractCodeBlockSupportHandler.java`、
`CodeBlockProvider.java:12-15`、`CodeBlockProviders.java:9-15`、`intellij.python.community.impl.xml:439/:673`、
`intellij.platform.lang.impl.xml:147/:421`、`Replacer.java`、`ReplacementBuilder.java`、`TopLevelMatchingHandler.java`、
本仓 `src/structuralCodeBlock.ts`、`src/structuralSearch.ts`、`src/structuralSearchModifiers.ts`、`src/structuralSearchPanelModel.ts`、
`src/editorCommands.ts`、`src/editorLanguage.ts`、`src/editorMatchBrace.ts`。

---

## 3. §5 自查命令的前后数字

| 命令 | 开工/改前 | 收工/改后 | 归因 |
| --- | --- | --- | --- |
| `node --test tests/editor-code-block.test.mjs` | **加载失败**：`SyntaxError: Duplicate export of 'LSP_REFRESH_METHODS'`（`src/lspProgress.ts:146`，别域在途）→ 别域修好后基线 **13 tests / 13 pass / 0 fail** | **17 / 17 / 0** | 4 条新增判据全绿；别域的加载失败本批一条没代改 |
| `node --test tests/structural-search-replace.test.mjs`（含 structural-code-block / panel-model 同跑） | 域内 3 文件 **35** 条（11 条在 replace 文件里） | 4 文件合计 **61 tests / 61 pass / 0 fail**（replace 文件 17 条）；**收工再扩跑** 6 文件（加上 `structural-search-modifiers` + `structural-search-constraints`）**84 / 84 / 0** | `panel-model` 是别人刚落盘的，本批改 `previewMany` 后它仍全绿 ⇒ 没改坏既有行为 |
| `npx vue-tsc -b --force` | 未跑基线（别域在途） | 中途一次 **7 条错**（`src/App.vue(436,40)`、`src/refactorPreview.ts(207,7)`、`src/semanticHighlighting.ts(210,224,310,312)`×4）；**收工复跑 2 条错**：`src/lspServerMessages.ts(383,11)`（缺 `requestKey`）、`src/refactorPreview.ts(207,7)`——App.vue 与 semanticHighlighting 那五路已被各自收口 | 两条都在**别人名下**的文件；`src/structuralSearchReplace.ts`、`src/editorCodeBlock.ts`、`src/structuralCodeBlock.ts` **一条都没有** ⇒ 本域类型 0 错，全仓 0 错要等那两路收口 |
| `node --test tests/module-size.test.mjs` | —— | **5 tests / 4 pass / 1 fail**：`src/components/ProblemsPanel.vue(903 行)` 超 900 且未登记 | 别域文件。本批文件 `editorCodeBlock.ts` 173 / `structuralSearchReplace.ts` 413，上限只降不升、没登记任何豁免 |
| `node .tools/find-param-props.mjs` | —— | **共 0 处参数属性** | 干净 |
| `node .tools/find-ts-in-mjs.mjs` | —— | **干净：tests/\*.mjs 全部是纯 JavaScript** | 干净（新增两条测试里只写了注释与 JS） |
| `node .tools/find-missing-ext.mjs` | —— | 扫描 1300 个文件，**干净：没有漏扩展名** | `.ts` 值 import 全部带 `.ts`（本批新增 3 处：`./structuralCodeBlock.ts`、`./regexReplacement.ts` 既有、`MatchSpans` 用 `import type`） |
| `node .tools/find-orphan-modules.mjs --gate` | —— | 红 1 条：`src/quoteHandlerRegistry.ts`（**别人**新加的零消费方模块）；已登记孤儿 9 / 基线 9 | 本批**没有新建任何 src 模块**，两条落点都在既有文件里，见下面 §5 |
| `node --test tests/source-citations.test.mjs tests/source-citation-anchors.test.mjs` | —— | 红 **17** 条，来源全部是别域文档：`batch-…-projecttree.md`(1)、`batch-…-status2.md`(2)、`batch-…-status2defect.md`(7)、`batch-…-welcome2.md`(1)、`wiring-requests-…-plugins.md`(3)、`wiring-requests-…-vcs2.md`(3) | 本批的两份文档与本批代码注释**一条都没进红名单**（写文档前先跑了一次，确认口径；引用全部按 `相对路径:行号` 且本批打开过） |
| `npm test` 全量 / `npm run test:native` | 未跑 | 未跑 | 规约 §5「只跑自己域」；本批 `native/` 零改动，因此不需要 ctest |

---

## 4. 反向验证记录（注入 → 变红 → 撤掉 → 复绿）

一次同时注入两处违规，跑 `tests/editor-code-block.test.mjs` + `tests/structural-search-replace.test.mjs`（合计 34 条）：

1. **桶 9-①**：`src/editorCodeBlock.ts:169` 的 `findCodeBlockRange(text, caret, language)` 改成 `findCodeBlockRange(text, caret, '')`
   （= 假装语言档永远没接上 / 结构那半被摘掉）。
2. **桶 9-②**：`src/structuralSearchReplace.ts:222` 的
   `hits.find(hit => hit.whole.start === at) ?? hits[0]` 改成 `hits[0]`（= 忽略列号，永远取行内第一处）。

结果（原始输出，摘关键行）：

```
ℹ tests 34
ℹ pass 29
ℹ fail 5
✖ 合并块尾取 min(结构, 括号)（CodeBlockUtil.java:118）
✖ 括号那半扫不到 ⇒ 用结构那半（:114-116 / :182-184）
✖ 语言档经 facet 传到命令：python 的复合语句（零括号）真的会动光标
✖ 嵌套复合语句：光标压内层 if ⇒ 只到内层那条语句的边界（ getCodeBlockRange 给最小那块）
✖ 一行两处：预览按列号取"这一处"，与 verdictForHit 的起点同一档
```

⇒ 违规 1 打掉 4 条（含本批新增的 2 条 facet 链路判据），违规 2 打掉 1 条。撤掉两处注入后复绿：

```
ℹ tests 61
ℹ pass 61
ℹ fail 0
```

`grep -rn "TEMP 反向验证" src/` = 0 命中（注入痕迹已清）。
另注：「三个替换开关」那条既有判据（`:129-134`）与本批新判据互不重叠，未被改动过一字。

---

## 5. 零消费方自查

- 本批**没有新建 `src/*.ts` 模块**（只往 `src/structuralSearchReplace.ts` 里加导出）⇒ `find-orphan-modules.mjs --gate` 的红只指向
  别人的 `src/quoteHandlerRegistry.ts`，本批新增为 0。
- 新导出的消费方：
  - `hitsWithin` / `valuesOfSpans`（私有）← `previewStructuralReplacement`（`:215`）与 `structuralReplacementPlan`（`:288`）共用同一把扫描器
    ⇒ 预览与整文件替换**不可能各自算出两批命中**；
  - `previewStructuralReplacement(…, at)` ← `previewMany`（`:245` 传 `row.column`）← `src/structuralSearchPanelModel.ts:269`（`countPending`）
    ← `src/components/SearchPanel.vue` 的状态行 ⇒ 这一条是**生产链路，已经活**；
  - `structuralReplacementPlan` / `applyStructuralReplacements`：生产消费方**还没接**（替换按钮目前直连宿主
    `src/components/SearchPanel.vue:393`/`:455`）⇒ 按派单「UI 挂载一律写请求」交 R-2，并在函数头 `:277-287` 写清了为什么接不上、
    接上时要传什么（`accept` = `verdictForHit`）。
- 本批没有留下任何"只过自己测试"的假控件、没有新增 UI 元素、没有新增设置键（因此 §3 的"旧存档补默认"这条不适用）。

---

## 6. 做不到 / 无法核实

1. **做不到：全仓 `vue-tsc` 0 错**。收工时剩 **2 条**：`src/lspServerMessages.ts(383,11)`、`src/refactorPreview.ts(207,7)`（开工中途另有 5 条在
   `src/App.vue`（保留文件）与 `src/semanticHighlighting.ts`，已被各自代理收口）。
   卡点：12 路并行共用工作区，这两条都在别人的可改面里，本批不代改（规约 §2/§6）。
2. **做不到：`module-size` 与引用门复绿**。红分别是 `src/components/ProblemsPanel.vue(903 行)`（别域）与 17 条别域文档引用（projecttree / status2 / status2defect / welcome2 / plugins / vcs2），本批一条都不是来源。
3. **做不到：让「结构支持」那半在界面上真的走到 Python 分支**。两道门都在保留文件后面：facet 写入方要动 `src/components/CodeEditor.vue`（R-1），
   Python 词法要动 `package.json` + `src/editorLanguage.ts`（R-3）。⇒ 今天 Java/C++/TS 的行为与上游**一致**（上游对这三种语言返回 EMPTY_RANGE，
   `intellij.python.community.impl.xml:439` 是唯一注册项），但 Python 那条链只在测试里跑通。
4. **做不到：把「替换全部」与列表复核对齐**。生效点是 `src/components/SearchPanel.vue:385-400`/`:430-460` 的替换按钮 handler（.vue = UI 挂载）⇒ 只有纯函数 + R-2。
5. **无法核实**：Ultimate/商业版是否还有别的 `com.intellij.codeBlockSupportHandler` 或 `com.intellij.codeBlockProvider` 注册项
   —— 本机参考树是 community master，`grep` 只在这棵树里成立；具体卡在哪一环：没有企业版源码可打开，无法给出行号。
6. **无法核实**：上游 `moveCaretToCodeBlockEnd` 在 `endOffset == -1` 时那次 `scrollToCaret` + `removeSelection()`（`CodeBlockUtil.java:61-68`）
   对用户的实际观感（本仓 `codeBlockCommand` 两支都不动）。这条只能登记为差异（R-4），没有可比的界面实测（规约 §0 禁止像素比对，本批没启动 GUI）。

---

## 7. 需要主代理接的线

见 `docs/wiring-requests-2026-10-06-search3.md`：

- **R-1** `src/components/CodeEditor.vue`：挂 `editorLanguageIdExtension(props.language)`（与 `docs/wiring-requests-2026-10-06-editorinput.md` W-3 是同一条，本批补上"不挂则桶 9 结构半永久死"这一后果，并纠正 `src/enterHandlers.ts:74` 写错的请求文件名）。
- **R-2** `src/components/SearchPanel.vue`：替换按钮 handler 改走 `structuralReplacementPlan` + `applyStructuralReplacements`，`accept` 传 `verdictForHit`，让"列出来的命中"与"写下去的命中"是同一批（上游 `Replacer.java:125-131` 就是同一份列表）。
- **R-3** `package.json` + `src/editorLanguage.ts`：装 `@codemirror/lang-python` 并补 `.py` 分支。
- **R-4**（可选，需拍板）`src/editorCommands.ts:174-190`：找不到块时右手边那一支要不要按上游那样"不动光标但仍清选区/滚动"。本批判据钉的是现行为（不吞键、不清选区），没擅动。
