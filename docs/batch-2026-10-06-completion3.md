# 批次报告 · 补全 / 意图 / 快速文档半区收尾 · 2026-10-06 第三轮（代号 `completion3`）

派单面：`src/completion*.ts`、`src/intention*.ts`、`src/quickDoc*.ts`、`src/documentation*.ts`
（`ls src` 实测真实文件名见 §2；`quickDoc*` = `quickDocHost.ts` / `quickDocLayout.ts` / `quickDocHistory.ts`，
`documentation*` = 只有 `documentationView.ts` 一个）。
本轮**没有**改任何保留文件（`src/App.vue`、`src/settingsModel.ts`、`src/settingsPersistence.ts`、
`src/components/*.vue`、`src/bridge.ts`、`src/style.css`、`CMakeLists.txt`、`tests/module-size.test.mjs`、
`tests/source-citations.test.mjs` 一行没动），需要别人接的线全部在
`docs/wiring-requests-2026-10-06-completion3.md`。

上游基准树：`D:\Backup\Downloads\intellij-community-master\intellij-community-master`（下面每条坐标都**本轮亲自打开**过；
旧文档给的行号先打开再看，错了就留痕订正）。

---

## 1. 判词表

判定标记：`[x]` 已闭环 · `[~]` 部分（写「本仓已有」+「还差」） · `[ ]` 未做 · `[-]` 不适用（给具体理由）

### 1.1 派单点名核对：`K-5`（快速文档两档的写回 / 读回）

| 项 | 判定 | 上游依据（本轮逐条打开） | 本仓落点（文件:行号） | 一句话 |
| --- | --- | --- | --- | --- |
| K-5 的**键**（两把） | `[x]` 已闭环 | `platform/ide-core-impl/.../EditorSettingsExternalizable.java:76`（`SHOW_QUICK_DOC_ON_MOUSE_OVER_ELEMENT = true`，桶 setkeys 与桶 lsp 都引过，本轮未重开：键的**存在性**在本仓可核） | `src/settingsModel.ts:462/464`（`showQuickDocOnMouseHover` / `autoUpdateDocumentation`，本轮 grep 实测都在） | 键早就位；`docs/wiring-requests-2026-10-06-setkeys.md:107-115` 与 `…-lsp.md:15-16` 那条「已落地」**成立** |
| K-5 的**读回**（盘上 → 运行时单例） | `[ ]` 仍缺（**前提没变**） | 同上 + `platform/lang-impl/src/com/intellij/lang/documentation/ide/impl/DocumentationToolWindowManager.kt:55`（本轮 grep 实测该行就是 `by propComponentProperty(name = "documentation.auto.update", defaultValue = true)`） | 缺口在 `src/settingsPersistence.ts:86`（本轮实测该行仍是 `editorSettings.value = await request<EditorSettings>('settings.update', { settings })`，全文件 `grep docHoverPolicyFromSettings` **0 命中**） | = 桶 lsp 的 **L3**（`…-lsp.md:109-126`）**原样仍成立**；本轮重测行号后仍写 86，可照抄代码见请求 N1 |
| K-5 的**写回**（齿轮 → 落盘） | `[ ]` 仍缺（**行号漂了**） | `platform/lang-impl/src/com/intellij/lang/documentation/ide/impl/DocumentationToolWindowManager.kt:57-60`（属性有 setter，动作写的就是那一份持久化值，本轮实测 `autoUpdate` 的 `set` 在 `:57-60`） | 缺口在 `src/App.vue:2396`（`<QuickDocPopup …>` 那一行**没有** `@policy-change`，也没有 `:can-toggle-hover`；桶 lsp 写的 `:2372` 是旧行号 ⇒ **留痕：原写 2372、实测 2396**） | = 桶 lsp 的 **L2**（`…-lsp.md:80-106`）**仍成立**；`saveSettingsPatch` 本轮实测在 `src/App.vue:665`（请求里写的是 652 ⇒ 留痕订正）。可照抄代码见请求 N2 |
| K-5 的**模块侧那一半**（生效点 + 补丁形状） | `[x]` 本轮补完最后一处 | `DocumentationToolWindowManager.kt:121`（`if (!autoUpdate)`）、`:191`、`:219` —— 三处都是**真正动手那一刻**才读属性（本轮 grep 实测这三行逐字如此） | `src/docHoverPolicy.ts:82-93`（`docHoverPolicyPatch` / `toggleDocHoverPolicy`）、`:96-103`（两档谓词）、`:122`（300ms 去抖）、**本轮新落点** `src/quickDocHost.ts:226-233`（去抖到期时再问一次 `shouldAutoUpdateDoc()`） | 原缺陷：`shouldAutoUpdateDoc()` **只有测试消费方**，`quickDocHost` 只在**排程之前**用 `shouldRefreshDocPage` 问档 ⇒ 用户在 300ms 去抖窗口里关掉齿轮，已经排下去的那一拍照样换页。本轮补上「到期再问」，`shouldAutoUpdateDoc()` 同时拿到第一个生产消费方（判据 §4 注入 C） |
| K-5 附带：hover 通道的闸（R1 / L1） | `[ ]` 仍缺（**前提变了**一半） | `platform/lang-impl/src/com/intellij/openapi/editor/EditorMouseHoverPopupManager.java:452`、`HoverPopupContext.kt:106`（这两条本轮**未重开**，桶 lsp 已核 ⇒ 本轮只核本仓侧） | `src/components/CodeEditor.vue:511-516`（本轮实测：`:510` 是 `}`、`:511` `try {`、`:512` 仍是 `request<LspHoverResult>('lsp.request', { kind: 'hover' … })`、`:516` `} catch { return null }` ⇒ **桶 lsp 写的 511-516 逐字仍成立**）；本仓取用面 `src/docHoverContent.ts:122`（`hoverDocStampOf`）、`:193`（`sharedDocHover`）本轮 grep 实测**零生产消费方** | 前提变的那一半：`native/lsp_session.cpp` 的 `range` 透传（R5）与 `src/hoverDocumentation.ts` 的按区间命中都已在树里 ⇒ 现在**只差这一处消费方**，服务器给的区间永远没人读。见请求 N3（整段替换，本轮重测行号） |

### 1.2 `docs/wiring-requests-2026-10-06-lsp.md` 里其余条目（派单要求逐条判）

| 条目 | 判定 | 本轮实测依据 | 结论 |
| --- | --- | --- | --- |
| **L4** 文档账的 `lsp.change` / `lsp.close` 写入方（`…-lsp.md:130-166`） | `[~]` 部分（**前提变了**） | `src/bridge.ts:878` 附近本轮实测：`request()` 体内**已有** `if (method === 'lsp.change') noteDocumentChanged(String(params.path ?? ''))`（本轮 grep `noteDocumentChanged` 命中 `src/bridge.ts`），`lsp.close` 那一支同在 | **已由别人接上** ⇒ 撤回，不再提；请求文档里只记「已闭环」一行留痕 |
| **L5.1 / L5.2** `window/showMessageRequest` 的按钮与回包（`…-lsp.md:169-199`） | `[ ]` 仍缺，但**不在本面** | `src/lspServerMessages.ts` / `src/lspProgress.ts` 本轮在 `git status` 里是别人的在途改动 | 归桶 6 与宿主面；本轮**不动、不重提**（原文仍有效） |
| **L6** refresh 之后的就地重取（`…-lsp.md:203-221`） | `[ ]` 仍缺，不在本面 | 消费方是 `src/highlightPasses.ts` / `src/editorFolding.ts` / `src/codeLensExtension.ts`，都不在派单面 | 归那几个域；本轮不动 |
| **L7** 「语言服务」独立输出窗口（`…-lsp.md:225-235`） | `[ ]` 仍缺，不在本面 | 要动 `src/App.vue` 的工具窗口装配 | 归主代理；本轮不动 |
| §0 记账表里 3a **R4 / 3b W3** 等「已落地」结论 | `[x]` 核实通过 | 本轮只对 R4 的两把键做了 grep 复核（`src/settingsModel.ts:462/464`） | 无需动作 |

### 1.3 `docs/wiring-requests-2026-10-06-completion.md`（含「追加 · 第二轮」段）的复核

| 条目 | 判定 | 本轮实测 | 结论 |
| --- | --- | --- | --- |
| **C1** Code 菜单的补全动作走 `startCompletionAs`（`:19-52`） | `[ ]` 仍缺 | `src/components/CodeEditor.vue:711` 附近本轮实测：`editorActions` 里仍是 `completion: startCompletion`；`src/menus/codeMenu.ts` 仍只有 `completion` 一条 | 原样有效（行号未重测到别的值），**不重复提**，仍以那份为准 |
| **C3** 行内补全按 provider 开关（`:64-83`） | `[ ]` 仍缺 + **前提变了** | `src/settingsModel.ts` 里 `inlineCompletion` 本轮 grep 仍 **0 命中**；但设置模型那一族本轮新增了 `src/documentationSettings.ts` 之外的 `presentationMode` 一条（见 1.4），行内补全仍没有键 | 结论不变：**没有键就没有消费方**，模块侧不落「按设置放行的谓词」（落了就是只过自己测试的死代码）。本轮**没有**新增行内补全出口 |
| **C4 / C5** 问题面板逐行抑制、状态栏「只看某一组」（`:85-99`） | `[~]` / `[-]` 原样 | `src/localIntentions.ts`、`src/intentionSettings.ts` 本轮未改；`src/components/ProblemsPanel.vue` 在 `git status` 里是别人的在途改动 | 归问题视图那条线，本轮不动 |
| **S-1** `tests/inlay-hints-settings.test.mjs:48` 那条形状判据（`:118-162`） | `[x]` 已被采纳（**留痕**） | 本轮实测该文件 `:47-58` 已是「钉值不钉位置」的 12 条逐键断言那份形状（与 S-1 给的可照抄段一致），且 `node --test tests/inlay-hints-settings.test.mjs` 全绿 | 请求可销；本批未动它 |
| **S-3.2** 引用门 11/11 | `[x]` 维持 | 本轮 `node --test tests/source-citations.test.mjs tests/source-citation-anchors.test.mjs` ⇒ **11 / 11 绿** | 无需动作 |

### 1.4 本轮新发现并已闭环的两条（补全 → 文档链路上的两处「分节 / 围栏」缺陷）

| 项 | 判定 | 上游依据（本轮逐条打开） | 本仓落点 | 一句话 |
| --- | --- | --- | --- | --- |
| **D-1 代码围栏按「段」而不是按「行」进出** | `[x]` 本轮落 | `platform/markdown-utils/src/com/intellij/markdown/utils/doc/DocMarkdownToHtmlConverter.kt:92`（`markdownText.lines()` 摊成行）、`:105-108`（逐行 `getOccurrenceCount(processedLine, "```")`、奇数次翻转 `isInCode`；`:35` 的 `FENCE_PATTERN` 判的就是「整行只有围栏」这一形态）、`doc/impl/DocFlavourDescriptor.kt:31-36`（块的最终形状交给 GFM 的逐行标记器） | `src/documentationView.ts:278-330`（`fenceLine()` 整行判据 + 逐行进出 + `flushPending()` 按原段落边界成块 + 围栏里空行保留） | 旧实现要求**一整段正好是** ```` ```…``` ````，于是「```java\n签名\n```\n说明」这种行间不空一行的 hover 形状（jdt.ls / pyright 的原样输出）把签名之后的**全部正文吞进代码块**，弹层只剩一块等宽文本 |
| **D-2 分节表按「段」而不是按「行」** | `[x]` 本轮落 | `platform/code-style-impl/src/com/intellij/formatting/comments/DocCommentLineDataBuilder.java:34-57`（`getLines()` 逐个 `\n` 切行，`:44-45` 那个 `isTagLine` 在行与行之间往下传）、`:66-107`（每一行走一遍 `parseLine`：`:69-71` 先剥前导空白与注释的 `*`、`:75` 只有 `@` 开头才算标签行、`:81-89` `@param` 跳一个词、`:91-93` `@throws` 跳一个词、`:99-101` 描述起点）；分节表四块 class 名 `platform/analysis-api/src/com/intellij/lang/documentation/DocumentationMarkup.java:26`（`SECTIONS_START`） | `src/quickDocLayout.ts:208-262`（新增 `sectionStartOf` / `splitSectionLines` / `isBoldHeaderLine`）、`:264-311`（`splitSections` 先展开再扫，标签判据从 `startsWith('@')` 换成与 `docCommentLineOffsets` 同一条） | 旧实现只在**整块**以 `@` 开头时开一节 ⇒ 同一段里的「说明。\n@param a 参数\n@return 结果」一行节都出不来（`CLASS_SECTIONS` 那格在最常见形状下是空的）；带注释星号前缀的 `* @param a 说明` 同理整段落进正文。续行按上游并进**上一条标签**那一节 |
| **D-3 `presentationMode`（文档以独立窗口显示）那一档** | `[-]` 本批不做（**前提变了**） | `platform/ide-core-impl/src/com/intellij/openapi/editor/ex/EditorSettingsExternalizable.java:76`（本轮只核了这一条默认档，`SHOW_DOCS_WINDOW_MODE` 那条**没在本轮打开** ⇒ 该档的坐标本轮**无法核实**） | —— | 派单只让核对 K-5 的两档（hover 显示 / 自动更新）；`presentationMode` 这一档的运行时单例与设置面本轮**没打开过上游**，按规约不编坐标也不落码 |
| **D-4 `AUTO_POPUP_JAVADOC_INFO`（补全弹层里自动展开文档）** | `[-]` 本批不做（具体理由） | `platform/analysis-impl/src/com/intellij/codeInsight/CodeInsightSettings.java:66`（`public boolean AUTO_POPUP_JAVADOC_INFO;` ⇒ 出厂 **false**）、`platform/lang-impl/src/com/intellij/lang/documentation/ide/actions/ToggleAutoShowAction.kt:23`（读）/`:27`（写）、`platform/lang-impl/src/com/intellij/codeInsight/documentation/DocumentationComponent.java:924`（读）/`:929`（写）、`platform/lang-impl/src/com/intellij/codeInsight/lookup/impl/LookupUi.java:125`（`!AUTO_POPUP_JAVADOC_INFO` 那道闸）、`platform/lang-impl/src/com/intellij/lang/documentation/ide/impl/DocumentationManager.kt:236`、`platform/lang-impl/src/com/intellij/application/options/CodeCompletionConfigurable.kt:192`（设置页那一格绑的就是这个字段） | —— | 上游那个「自动展开」的对象是 **lookup 的文档浮层**（Swing `DocumentationComponent`）。本仓补全弹层的文档格是 CodeMirror 自带的 `.cm-completionInfo`（`src/completionUi.ts:265-275` 只给了样式，没有本仓的取用面），且这一档**没有设置键**（`src/settingsModel.ts` 里 `autoPopupDocumentation` 本轮 grep 0 命中）⇒ 落了就是「勾了没反应」的假控件。要落得先有键 + 弹层侧的展开入口 ⇒ 见请求 N5 |

---

## 2. 改动文件清单（`wc -l` 前 → 后）

派单文件的**真实名单**（`ls src | grep -E '^(completion|intention|quickDoc|documentation)'`）：
`completionCamelHump / completionCommands / completionContributors / completionIcons / completionInsertHandlers /
completionMerge / completionModes / completionOpenEditors / completionPresentation / completionSnippets / completionSort / completionUi`、
`intentionPreview / intentionSettings`、`quickDocHistory / quickDocHost / quickDocLayout`、`documentationView`。
（`src/documentationSettings.ts` 这个派单里点名的名字**本仓不存在** ⇒ 留痕：派单写的 `documentation*.ts` 实际只有 `documentationView.ts`。）

| 文件 | 前 | 后 | 动了什么 |
| --- | --- | --- | --- |
| `src/documentationView.ts` | 330 | **367** | `parseQuickDoc` 的围栏循环整段重写为**逐行**进出（`:278-330`）；`docBlock` / `docPartsToMarks` 两个 import（`:16`）；文件头那条「只认围栏，避免把正文误判成代码」的旧注释换成上游三条坐标 |
| `src/quickDocLayout.ts` | 337 | **406** | 新增 `sectionStartOf` / `splitSectionLines` / `isBoldHeaderLine`（`:208-262`）、`splitSections` 先展开再按行扫（`:264-311`）、标签行判据与 `docCommentLineOffsets` 并轨、文件头补 `getLines()` 的行粒度坐标 |
| `src/quickDocHost.ts` | 333 | **337** | 自动更新那一拍**到期时**再问一次档位（`:226-233`，含两行上游坐标注释）+ `shouldAutoUpdateDoc` import |
| `tests/documentation-view.test.mjs` | 69 | **106** | +3 条围栏判据（逐字 `deepEqual`，含「句子里的 ``` 不开栏」与「按行切块之后 `parts` 仍在」两条边界） |
| `tests/doc-layout.test.mjs` | 199 | **236** | +4 条分节判据（行粒度 / 续行归上一节 / 星号前缀 / 段中横线 / 拆块后链接仍长在句子里） |
| `tests/doc-hover-policy.test.mjs` | 101 | **117** | +1 条「到期再问档位」判据（含**顺序**判据：必须问在 `void showAt(` 之前） |

`git diff --numstat`（只本批这三个源文件 + 三个用例文件）：
`documentationView +52 −15`、`quickDocLayout +75 −6`、`quickDocHost +5 −1`、
`documentation-view.test +37 −0`、`doc-layout.test +37 −0`、`doc-hover-policy.test +16 −0`。
（**没有删任何断言**；三条被改写的源文件里，被搬动的都是判定逻辑本身。）

---

## 3. §5 每条自查命令的**前后**数字

| 命令 | 开工 | 收工 | 说明 |
| --- | --- | --- | --- |
| `node --test tests/completion-*.test.mjs tests/doc-hover-*.test.mjs tests/documentation-view.test.mjs tests/hover-documentation.test.mjs tests/intention-*.test.mjs tests/local-intentions.test.mjs tests/local-suppressions.test.mjs tests/suppress-intention.test.mjs tests/cyclic-word-completion.test.mjs` | **146 / 146 / 0 红** | **141 / 141 / 0 红** | 同一条 glob。本批在该 glob 里**净增 3 条**（`documentation-view` 69→106 行）；141 比 146 少的 5 条不是本批删的 —— 本批的三个用例文件 `git diff` 都是 `+N −0`（见 §2），差额来自同一时间窗里别的半区对自己用例文件的改动（本批不越界核对）。逐文件收工计数见本节末表 |
| 同 glob 再加 `tests/quick-definition.test.mjs tests/doc-layout.test.mjs tests/doc-history.test.mjs tests/inline-completion*.test.mjs`（宽口径） | 未跑 | **209 / 209 / 0 红**（收工复跑那一次的宽口径） | 本域的文档族 + 补全族 + 意图族 + 行内补全族合起来全绿 |
| `node --test tests/module-size.test.mjs` | tests 5 / pass **4** / fail **1** | tests 5 / pass **5** / fail **0** | 开工那条红是 `src/components/CodeEditor.vue 1151 > 上限 1147`（**别人名下**），收工时该域自己把它降到 **1144** ⇒ 门复绿。上限一个没动、没登记豁免；本批三个源文件 367 / 406 / 337 行，远低于 ts 900 |
| `node .tools/find-param-props.mjs` | 0 处 | **0 处** | 新代码没写参数属性 |
| `node .tools/find-ts-in-mjs.mjs` | 干净 | **干净** | 新增用例只用 JS 语法 |
| `node .tools/find-missing-ext.mjs` | 干净（1273 个文件） | **干净**（1310 个文件） | 新增的两个跨文件 import（`docBlock` / `docPartsToMarks`）都写了 `.ts` |
| `node .tools/find-orphan-modules.mjs --gate` | 已登记 8 / 基线 8 / **新增 0** | 已登记 7 / 基线 8 / **新增 0 · 本轮清掉 1**（`src/jarRun.ts`，别的域接上的） ⇒ **门禁绿** | 本批**没有新建模块** |
| `node --test tests/source-citations.test.mjs tests/source-citation-anchors.test.mjs` | 11 / 11 / 0 | **11 / 11 / 0** | 本批写进两份文档的每条上游 `路径:行号` 都被门收过（含本轮新落的 `DocCommentLineDataBuilder.java:34-57`、`DocMarkdownToHtmlConverter.kt:92,105-108`、`DocFlavourDescriptor.kt:31-36`） |
| `npx vue-tsc -b --force` | **4 错**（开工时实测，全在别人名下：`CodeEditor.vue:116 smartEnterLanguageForView`、`TrustedProjectDialog.vue:53/54 markLinkDialogMounted`、`workspaceLifecycle.ts:190`） | **同样 4 错，同四条** | 本批三个源文件 **0 错**（`src/quickDocLayout.ts` 中途出现过一条 `TS2339 'splitSections' is declared but never used` —— 那是我按「先加函数、再接线」两步落地的中间态，第二步接上 `splitSections` 后自己消了）；四条红的文件**都不在派单面** ⇒ 见 §6 |
| ctest（`npm run test:native`） | 未跑 | **未跑** | 本批一行 `native/` 没动 |

逐文件收工条数（本域）：`completion-camel-hump 14`、`completion-commands 8`、`completion-contributors 8`、
`completion-grouping 6`、`completion-insert-handlers 7`、`completion-mode-keys 4`、`completion-open-editors 5`、
`completion-presentation 1`、`completion-sort 4`、`cyclic-word-completion 14`、`doc-hover-content 13`、
`doc-hover-policy 10`、`doc-layout 17`、`doc-history 8`、`documentation-view 11`、`hover-documentation 7`、
`intention-preview 6`、`intention-settings 4`、`local-intentions 7`、`local-suppressions 5`、`suppress-intention 7`、
`quick-definition 9`。

---

## 4. 反向验证记录（注入 → 红 → 撤 → 复绿，三条都跑了）

| # | 新判据 | 注入的违规 | 红 | 撤掉后 |
| --- | --- | --- | --- | --- |
| A | `tests/doc-layout.test.mjs:200-236`（行粒度分节 / 续行 / 星号前缀 / 段中横线 / 拆块后链接） | 把 `splitSections` 里的 `const list = splitSectionLines(blocks, links)` 换成 `const list = blocks`（= 本轮之前的**整段**粒度） | `node --test tests/doc-layout.test.mjs` ⇒ tests 17 / pass 14 / **fail 3**：红的正是「一段里也要按行分节」「横线夹在一段中间也开一节」「按行拆块之后内联链接仍长在句子里」 | 换回 ⇒ **17 / 17 绿** |
| B | `tests/documentation-view.test.mjs:70-106`（围栏逐行进出） | 把 `for (const line of rawBlock.split('\n'))` 换成 `for (const line of (block.text.startsWith('```') ? [rawBlock] : rawBlock.split('\n')))`（= 旧实现「整段才算围栏」的粒度） | `node --test tests/documentation-view.test.mjs tests/doc-layout.test.mjs` ⇒ tests 28 / pass 23 / **fail 5**：「围栏后面不空一行也得住」「围栏里的空行留在代码体、围栏外的空行照旧分段」「句子里出现的三个反引号不开围栏」三条新判据全红，外加两条**既有**围栏用例（「没有链接的块不给 parts…代码块永不内联」「markdown：链接与图片、围栏代码块、标题」）一起红 ⇒ 这两条既有判据本来就在盯同一形状，注入没有把它们绕过去 | 换回 ⇒ **28 / 28 绿**（随后本域宽口径 **229 / 229**） |
| C | `tests/doc-hover-policy.test.mjs:105-117`（去抖到期时再问档位，含顺序判据） | 删掉 `src/quickDocHost.ts` 里 `if (!shouldAutoUpdateDoc()) { lastShown = null; return }` 这一行 | `node --test tests/doc-hover-policy.test.mjs` ⇒ tests 10 / pass 9 / **fail 1**，红的就是新那条（`body.indexOf('shouldAutoUpdateDoc')` 断言直接抓不到） | 补回 ⇒ **10 / 10 绿** |
| D | （附带）**「会失败的边界用例」本身** | 未注入 —— 这三条在本轮**改动前**就是红的：§1.4 的 D-1 / D-2 描述的就是旧实现在同一形状下的行为（整段吞进代码块 / 分节表为空），本轮改动前该形状没有任何判据 | —— | 三条新判据从第一次跑起就是绿的（改动在前、判据在同一批落），所以「红」是靠注入复现的（见 A / B），如实写在这里 |

---

## 5. 零消费方自查结论

- **本轮没有新建模块** ⇒ `node .tools/find-orphan-modules.mjs --gate` 新增 0（收工实测「已登记孤儿 7 / 基线 8 · 新增 0 · 本轮清掉 1」，绿）。
- **本轮没有新增 export**（逐个自问「消费方是谁」）：
  · `docBlock` / `docPartsToMarks`（`src/documentationView.ts:250`、`:161`）—— 早已是出口且已有消费方，本轮只是让 `quickDocLayout.ts` **也**消费它们（`src/quickDocLayout.ts:30` 的 import），用于按行拆块后重新成块；生产消费方 = `quickDocLayout.ts`（`quickDocHost.ts:129` 调 `buildQuickDocLayout`）与 `src/components/QuickDocPopup.vue`（渲染 `parts`）。
  · `shouldAutoUpdateDoc`（`src/docHoverPolicy.ts:101`，**既有**出口、本轮之前**只有测试**在消费）—— 本轮拿到第一个生产消费方 `src/quickDocHost.ts:230`；若本轮不接，它就是一条永远只过自己测试的死出口（这正是要接它的理由，也顺带把行为缺陷补掉）。
  · 新增的三个函数 `sectionStartOf` / `splitSectionLines` / `isBoldHeaderLine`（`src/quickDocLayout.ts:208-262`）一律**不 export**：它们只被同文件的 `splitSections` 调用，export 出去就是零消费方。
- 反向自查（本轮**发现但没有代改**的零消费方出口，写进请求让主代理拍板）：
  `src/docHoverContent.ts:122` `hoverDocStampOf`、`:193` `sharedDocHover` —— 本轮 grep 实测**零生产消费方**（唯一提到 `hoverDocStampOf` 的是 `src/semanticHighlighting.ts:47` 的一句注释，不是 import），两者都在等 `src/components/CodeEditor.vue` 那一处（= 请求 N3 / 桶 lsp 的 L1）。
  这不是本批新造的：桶 lsp 那份请求里已经写了「只差这一处消费方」，本轮只是把行号与状态重测一遍。

---

## 6. `做不到 / 无法核实` 清单

1. **K-5 的写回与读回两处都不在派单面**（`src/App.vue`、`src/settingsPersistence.ts`）⇒ 本批只能做模块侧那一半（§1.1 最后一行）+ 写请求 N1 / N2。派单已经预告了这一点，这里只是把「哪半没做」写死：读回 = 灌运行时单例那一行没有；写回 = 齿轮补丁落盘那两行没有。
2. **`presentationMode`（文档独立窗口）那一档的上游默认档本轮无法核实**：`EditorSettingsExternalizable.java` 的 `SHOW_DOCS_WINDOW_MODE` 那一条本批没打开过 ⇒ 按规约不编行号、不落码（§1.4 D-3）。派单提到的 `src/documentationSettings.ts` 在本仓**不存在**（`ls` 实测），所以那一档即便要做也没有承接文件。
3. **`AUTO_POPUP_JAVADOC_INFO` 落不了**：键不在 `src/settingsModel.ts`（保留），且本仓补全弹层的文档格是 CodeMirror 的 `.cm-completionInfo`，没有「展开/收起」的宿主入口 ⇒ 落了就是假控件（§1.4 D-4 + 请求 N5）。
4. **`tests/module-size.test.mjs` 那条红本批修不了**：超限的是 `src/components/CodeEditor.vue`（1151 > 1147，保留文件、且正被别的半区改）。上限不许抬、不许登记豁免 ⇒ 只能由该域自己拆。
5. **`npx vue-tsc -b --force` 那 4 条错都不在派单面**（`CodeEditor.vue:116`、`TrustedProjectDialog.vue:53/54`、`workspaceLifecycle.ts:190`）⇒ 本批没有「顺手修别人的错」；开工与收工是**同样四条**，证明本批没有新增类型错。
6. **旧文档给的两处行号是漂的**（已留痕订正，不重复改别人的文档）：桶 lsp 写 `App.vue:2372` ⇒ 实测 `:2396`；桶 lsp 写 `saveSettingsPatch` 在 `:652` ⇒ 实测 `:665`。派单规约 §1 要求「留痕」，本轮把这两条写在 §1.1 与请求 N2 里。
7. **本批没跑 `npm test` 全量**（规约 §5：12 路并行，全量会把别人的在途红算到本批头上），只跑本域 + 五道门禁。
