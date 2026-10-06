# 批次报告 · 2026-10-06 · `lshl`（语言服务 / 高亮域模块侧缺项）

范围：① 复核接线请求「R5 native hover range 透传」的真伪；② 补 `ls/highlighting` 判词 ③
（语义高亮的**按特性注册表 + 可失效缓存**）。未动 native、未动保留文件、未 commit/push、未跑 git 破坏性命令。

---

## 1. 判词表

| 族 | 项 | 判定 | 上游相对路径:行号（亲自打开核对） | 本仓落点文件:行号 | 一句话 |
|---|---|---|---|---|---|
| `ls/documentation` | **R5 native hover range 透传** | **`[x]` 不成立（请求本身过期：上游该消费、本仓已消费）** | `platform/lsp-impl/src/impl/LspRequestExecutor.kt:212-224`（`:220` `it.range = hover.range?.let { range -> lspDocument.toHostRange(range) }`）；`platform/lsp-impl/src/impl/features/documentation/HoverResultCache.kt:10-12`（`matches = … storedValue.textRange.contains(queriedOffset)`）；`platform/lsp-impl/src/impl/features/documentation/TextRangeAndMarkupContent.kt:14-19`（服务器没给 ⇒ `TextRange(offset, offset)`）、`:21-24`（内容空白 ⇒ 整条 `null`）；协议侧 `fleet/lsp.protocol/srcCommonMain/com/jetbrains/lsp/protocol/Hover.kt:32-36`（`val range: Range?` = 可选） | `native/lsp_session.cpp:166-171`（已透传）、`native/lsp_fake_server_requests.cpp:120-130`（回一条区间）、`native/lsp_coding_test.cpp:209-216`（往返钉住）、`src/docHoverContent.ts:68-96`（`hoverRangeFromPayload`/`presentationFromRange` 消费）、`src/hoverDocumentation.ts:129-132,175`（区间命中） | **结论：range 该被消费，且本仓 native + TS 两侧都已在消费 ⇒ 这条请求不再成立**；只剩两处陈旧注释（已留痕改掉一处，另一处归桶 3a，见 wiring W3） |
| `ls/highlighting` | 语义高亮**按特性渲染注册表**（token 类型未注册不高亮） | `[x]` 新做 | `platform/lsp/src/api/customization/LspSemanticTokensCustomizer.kt:91-122`（`:100` Variable→LOCAL_VARIABLE、`:113` Keyword→KEYWORD、**`:121 else -> null`**）；`platform/lsp-impl/src/impl/features/highlighting/LspSemanticTokensCache.kt:102-105`（索引越界整条 `continue`） | `src/semanticHighlighting.ts:63-108`（两张注册表）、`:120-146`（`semanticHighlightClasses`）、`src/editorSemanticField.ts:56-73`（未注册的类型连修饰符都不画） | 声明表 ↔ 渲染注册表 ↔ 颜色表一一对应；认不出的类型整条不出现，不再「类型没有、删除线照画」 |
| `ls/highlighting` | **capabilities 声明与实际可用 token 类型一一对应** | `[x]` 新做（跨语言只能机检） | `platform/lsp/src/api/LspClientCapabilities.kt:185-201`（`:193-194` `tokenTypes = semanticTokensSupport.tokenTypes` —— 上游**声明与渲染同源**）；`LspSemanticTokensCustomizer.kt:38-62`、`:71-82` | `src/semanticHighlighting.ts:148-178`（`capabilityRenderDrift()` 三向）、`tests/semantic-highlighting.test.mjs:56-66`（恒空钉死）、`tests/semantic-tokens.test.mjs:86`（与 `native/lsp_host_bootstrap.cpp:237-245` 逐项同序，既有门） | 本仓声明在 C++、渲染在 TS，结构上会漂 ⇒ 用「键类型是声明表 + 三向漂移恒空」两道门钉住；**实测已漂过一次**（`keyword` 发 `cm-sem-keyword`、颜色表只有 `.cm-sem-key` ⇒ 关键字整层不着色），已修 |
| `ls/highlighting` | **capability 没声明就不请求** | `[~]` 模块侧已做、消费点在冻结文件 | `LspSemanticTokensCache.kt:29-36`（`isSupportedForFile` 三条闸）、`:125`（`LspSemanticTokensDisabled` ⇒ 转型失败即不发）、`native/lsp_capability_queries.cpp:105`（回 `LSP_UNSUPPORTED`） | `src/semanticHighlighting.ts:216-243`（`capabilityDeclared()`/`noteServerDeclined()`/`plan()`）；请求点 `src/components/CodeEditor.vue:317-340`（**未接**） | 原生层早就本地拒发（`native/lsp_kinds_test.cpp:360` 有 ctest）；TS 侧这份「问过一次就不再问」的闸已建好并有判据，接进宿主那 4 行的整段写在 `docs/wiring-requests-2026-10-06-lshl.md` W1 |
| `ls/highlighting` | **可失效缓存（文档修订号变化即失效并重新取）** | `[x]` 新做并接进生产 | `LspSemanticTokensCache.kt:40-41,51-54`（请求前后比 `modificationStamp`，变了连解码都不做）；`LspPullResult.kt` 的 Full/Unchanged/Failed；`LspHighlightingCacheRegistry.kt:23-56`（`:28` `semanticTokensCache`、`:37-40` register、`:54-56` 按文件作废） | `src/semanticHighlighting.ts:194-299`（`SemanticHighlightingCache`，键=CodeMirror 不可变 `Text` 对象身份）、`:301-334`（按特性注册表）、`src/editorSemanticField.ts:139`（编辑即 `invalidate` 旧文档）、`:143-152`（同修订复用 / miss 就重建并 `store`） | 修订一变必然 miss ⇒ 旧答案顶不上新文档；同修订重复派发（warmup 重试、同文档第二个编辑器）复用已建 `DecorationSet` |
| `ls/highlighting` | 编辑后高亮**跟着走**而不是整层清空 | `[x]` 新做（留痕：原写「文档一变就整份作废」） | `LspCachedHighlighting.kt:38-80`（四条分支：之后不动 / 之前右移 / 内含则 grow-shrink / 部分相交**删除**）——本仓 `src/lspHighlightingCache.ts:8-12` 已记着那四条 | `src/editorSemanticField.ts:79-100`（`ChangeSet.mapPos` 精确映射 + 零宽即丢）| 用户可见差别：打字时语义颜色不再闪断约 400ms；被编辑吃掉的 token 不画在错位置 |
| `ls/highlighting` | `LspHighlightingApplier` / `LspHighlightingPass` 排期 | `[-]` 本轮不做 | `LspHighlightingApplier.kt:206`（`getSemanticTokens`）、`LspHighlightingPass.kt:53-63` | 本仓已有 `src/highlightPasses.ts`（`HighlightingApplier` 状态机在 :230-300 那一段） | 判词 ①② 归 `highlightPasses` 那条线，与本批的注册表/缓存不是同一个缺口；不在我派单面内 |

`R5` 判定的关键取证（都自己打开过）：native 分支 `native/lsp_session.cpp:159-172` 注释就写着
「`Hover.range` 原样透传（服务器没给就不带这一格）」并给出上游坐标；TS 侧 `src/docHoverContent.ts:150-157`
把 `payload.range` 解出来存进 hover 缓存条目，`src/hoverDocumentation.ts:175` 按区间命中。
**所以「本仓已经不吃 range」不成立、「上游 range 是可选所以不该接」也不成立** ——
它是可选的（`Hover.kt:36` `Range?`），上游在给了的时候用它做缓存命中与展示区间，本仓同款。

---

## 2. 改动文件清单（`wc -l` 前后）

| 文件 | 前 | 后 | 说明 |
|---|---|---|---|
| `src/semanticHighlighting.ts` | — | **354**（新） | 渲染注册表 + 漂移门 + 按文档修订的语义 token 快照 + 按特性注册表 |
| `src/editorSemanticField.ts` | 43 | **162** | 装饰层改为走注册表；层值换成 `{revision, marks, decorations}`；接上快照缓存的失效/复用；编辑后区间随动 |
| `src/hoverDocumentation.ts` | 227 | **233** | 只改文件头注释：留痕「原写 native 不透传 range、实际已透传」并给真实坐标（R5 复核结论落盘） |
| `tests/semantic-highlighting.test.mjs` | — | **235**（新） | 11 条判据（见 §3） |
| `docs/wiring-requests-2026-10-06-lshl.md` | — | **95**（新） | W1（宿主拉取接两道闸，整段可照抄）· W2（已自接，说明用）· W3（`src/docHoverContent.ts:31-34` 陈旧注释，归桶 3a） |

`git status` 自查：以上 5 个就是我全部改动面；`src/semanticTokens.ts`、`src/editorSemanticColors.ts`、
`src/components/CodeEditor.vue`、保留文件一律未动（`git diff --stat` 只列出上面 2 个已跟踪文件的 hunk）。

---

## 3. §5 每条自查命令的前后数字

| 检查 | 开工时（我实测/快照） | 收工时 | 备注 |
|---|---|---|---|
| `npx vue-tsc -b --force` | 开工时另有代理在途，错误表里含 `src/semanticTokens.ts` 等 6 条（非我改动） | **我这三个文件 0 条**；收工最后一条全仓实测：1 条，在 `src/refactorPreview.ts:207`（他人名下在途文件，此前同一轮还见到 `src/lspServerMessages.ts:383`、`src/components/ProblemsPanel.vue:218`，均为他人文件） | 本批零 native 改动，不涉 ctest |
| 本域测试（11 个文件：`semantic-highlighting` `semantic-tokens` `lsp-highlighting-cache` `lsp-per-file-cache` `lsp-feature-matrix` `lsp-progress` `editor-lsp-warmup-wiring` `lsp-warmup` `hover-documentation` `doc-hover-content` `doc-hover-policy`） | 单独跑旧集时 81 条（`doc-hover-content` 开工快照 12/13，1 条他人红） | **92 通过 / 0 失败**（其中我新增 11 条） | 没有放松任何既有断言：`semantic-tokens.test.mjs` 7 条（含 `:53` 空类型、`:86` 原生 legend 同序）逐字未动 |
| `node --test tests/module-size.test.mjs` | 4/5（1 红：`src/components/ProblemsPanel.vue` 903 行，他人文件） | **4/5，同一条红**，新增文件 `semanticHighlighting.ts` 354 行、`editorSemanticField.ts` 162 行，远低于 900 | 未改上限、未登记豁免 |
| `node .tools/find-param-props.mjs` | 0 处 | **0 处** | 中途我用过 `constructor(readonly featureId = …)`，被这条门拦住 ⇒ 改成显式字段 |
| `node .tools/find-ts-in-mjs.mjs` | 干净 | **干净** | 新 `.mjs` 里没有 TS 语法 |
| `node .tools/find-missing-ext.mjs` | 干净（1301 文件） | **干净** | 新模块的 `.ts` 值 import 全带扩展名 |
| `node .tools/find-orphan-modules.mjs --gate` | 基线 9 | **绿：已登记 9 / 新增 0 / 本轮清掉 0**；词法自检 0 异常 | `semanticHighlighting.ts` 的生产消费方是 `src/editorSemanticField.ts`（→ `CodeEditor.vue:39`） |
| `node --test tests/source-citations.test.mjs tests/source-citation-anchors.test.mjs` | 3 条红（他人的 `docs/batch-2026-10-06-{projecttree,status2,status2defect,welcome2}.md`、`wiring-requests-…{plugins,vcs2}.md` 引用了参考树里不存在的文件） | **11 条：8 通过 / 3 失败，失败项一条不来自本批**（`grep lshl` = 0，offender 列表里没有我的文件） | 我新写的上游坐标逐条 `find`+`cat -n` 验过存在 |
| ctest | 未跑 | **未跑（本批零 native 改动）** | 无 `native/*.cpp` 修改，不需要重建 |

---

## 4. 反向验证记录（注入违规 → 红 → 撤掉 → 绿）

**门 1：渲染注册表 ↔ 颜色表一一对应**
1. 注入：`src/semanticHighlighting.ts` 把 `keyword: 'key'` 改成 `keyword: 'keyword'`（即"注册了一条颜色表里不存在的规则"）。
2. 结果：`node --test tests/semantic-highlighting.test.mjs` → **11 条里 4 条红**
   （「三个方向的漂移恒为空」「keyword 落得下一条真有颜色的规则」「装饰层只留注册过的类型」「编辑后区间跟着走…」）。
3. 撤掉：改回 `keyword: 'key'` → **11/11 绿**。

**门 2：capability 没声明就不请求**
1. 注入：`plan()` 里把 `if (!this.capabilityDeclared()) return 'unsupported'` 短路成永不生效。
2. 结果：**1 条红**（「能力没声明（或宿主回过 LSP_UNSUPPORTED）时 plan 永远是 unsupported，不发请求」）。
3. 撤掉 → **11/11 绿**（复跑实测）。

**门 3：编辑后映射方向**（写反就是真 bug，不是测试挑刺）
`mapPos(from, -1)/mapPos(to, +1)` 会把插在 token 前后的字符染进这个 token：
实测红在两处 —— `//class`（应为 `class`）与 `xin`（应为 `int`）；改成 `mapPos(from, +1)`/`mapPos(to, -1)` 后绿。

会失败的边界用例（判据里恒存在，不是摆设）：
① 未登记特性 `noSuchHighlightingFeature` ⇒ `registerHighlightingFeature` 返回 false、`plan` 恒 `unsupported`；
② `SEMANTIC_SNAPSHOT_LIMIT + 10` 份文档 ⇒ `size` 恰为上限且最旧一份已失效；
③ 同修订号配新文档对象（`tokensFor(second, 10)`）⇒ 必须 null；
④ 服务端 legend 自加类型 `templateExpression` + `deprecated` ⇒ 整条空串（不出现半截删除线）。

---

## 5. 零消费方自查结论

- `src/semanticHighlighting.ts`：生产消费方 `src/editorSemanticField.ts`（`semanticHighlightClasses`、
  `semanticHighlightingCache`、`semanticRevisionOf`），该文件被 `src/components/CodeEditor.vue:39` 引用；
  `orphan --gate` 实测新增 0。
- 模块内**故意留给 W1** 的入口：`plan()`、`noteServerDeclined()` —— 生产调用点在冻结的
  `src/components/CodeEditor.vue:317-340`，整段替换代码已写进 wiring W1（不接不会错，只是那条
  warmup 重试链仍会反复打一条服务端声明不支持的能力）。
- **如实登记的副作用**：`src/semanticTokens.ts` 的 `semanticTokenClass()`（原 decoration 层用它）
  现在**生产侧零调用**，只剩 `tests/semantic-tokens.test.mjs:41` 的断言。我没有删它、也没有动那条断言
  （删断言属违规）。它在文件级不触发孤儿门（同文件其余导出仍在生产链上）。建议主代理二选一：
  把它标成「原始名字映射，仅排查用」或在同一批里连同那条断言一起撤（撤的理由就是本批判词：
  它绕过了渲染注册表，正是 `keyword` 那次漂移的来源）。

---

## 6. 做不到 / 无法核实

1. **`Hover.java`（lsp4j）不在这棵本地树里**：`find . -name Hover.java` / `MarkupContent.java` 在
   `intellij-community-master` 全树 0 命中，`platform/lsp-impl/.../TextRangeAndMarkupContent.kt:6-8`
   只是 `import org.eclipse.lsp4j.Hover`（外部依赖未随源码发布）。⇒ 「lsp4j `Hover.java` 里 range 的
   原始声明」无法核实；协议侧用本树自带的 `fleet/lsp.protocol/srcCommonMain/com/jetbrains/lsp/protocol/Hover.kt:32-36`
   替代取证，消费侧用 `LspRequestExecutor.kt:220` + `HoverResultCache.kt:12` + `TextRangeAndMarkupContent.kt:14-19`。
2. **`SemanticTokensRegistry` 与 `LanguageSemanticHighlightingSettingsProvider` 两个名字按文件名/符号名都搜不到**
   （`find -name` 与 `grep -rl` 各两轮，含 XML `action id` 一路）⇒ 无法核实，判词表里用的是真实存在的
   `LspSemanticTokensCustomizer.kt`（`tokenTypes`/`tokenModifiers`/`getTextAttributesKey`）与
   `LspHighlightingCacheRegistry.kt`。派单给的候选坐标本身写错了名字，这里按实际文件留痕。
   `semantic.highlighting` 这个开关（`Registry.is("diff.semantic.highlighting", false)` 一类）不在本域，没动。
3. **没接进宿主的语义拉取**（wiring W1 的两道闸）：不是做不到，是消费点 `src/components/CodeEditor.vue`
   不在我的面内，且它同时是他人接线请求（R1）的目标行范围。
4. **hover 自动弹出的真机判据**：接不上，本仓没有 hover 的 DOM 自动化层（沿用桶 3a 的同一结论）。
5. 上游 3 条门禁（`isSupportedForFile` 的 `psiFile.language.id == "TEXT" || "textmate"` 那条按文件判定）
   在本仓没有 PSI 语言 id 面，本批用「特性是否在能力表登记 + 宿主是否回过 `LSP_UNSUPPORTED`」承接，
   差异已写在 `src/semanticHighlighting.ts:216-221` 的注释里。

## 7. 需要主代理接的线

见 `docs/wiring-requests-2026-10-06-lshl.md`：W1（`CodeEditor.vue:317-340` 整段替换 + 第 64 行后一行 import）、
W3（`src/docHoverContent.ts:31-34` 陈旧注释，桶 3a 名下）。另外 §5 那条 `semanticTokenClass()` 的处置请拍板。
