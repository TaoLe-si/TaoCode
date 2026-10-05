# 桶 3 · 文档半区交付报告 · 2026-10-06

族：`lp/documentation`(155 类) 与 `ls/documentation`(4)。判词原文取自
`docs/inventory/verdict-platform_rest.md:54`（lp 那两行的「缺：」）与 `:343`（ls 那行）。
上游基准树：`D:\Backup\Downloads\intellij-community-master\intellij-community-master`（全部结论逐条开文件核到行号，未上网、未截图）。

判定口径：**已做** = 本仓有实现 + 有生产消费链路 + 有判据测试；**部分** = 实现与判据在，
生效点在保留文件/别人名下文件 ⇒ 已写成可照抄的接线请求（`docs/wiring-requests-2026-10-06-bucket3a.md`）；
**未做** = 给出**具体**卡点（缺哪层、谁的现场、哪个请求不提供）。

---

## 判词

### 族 `lp/documentation`（判词 `verdict-platform_rest.md:54` 的「缺：」逐条）

| 族 | 项 | 判定 | 上游依据（相对路径:行号） | 本仓落点（文件:行号） | 说明 |
|---|---|---|---|---|---|
| lp/documentation | 模型到 UI 的接线：链接可点 | **已做**（本轮订正为「长在句子里」） | `platform/analysis-api/src/com/intellij/lang/documentation/DocumentationMarkup.java:13-31`；`platform/lsp-impl/src/impl/features/documentation/LspDocumentationData.kt:91-103` | `src/documentationView.ts:27`（`DocPart`）、`:39`（`DocBlock.parts`）、`:98-133`（占位符与两个折回函数）、`:196`（`docBlock`）；`src/components/QuickDocPopup.vue:159-161`（正文内联）、`:170-175`（分节右格内联）；分派 `src/quickDocHost.ts:270-287`（`followInternalDocLink`） | 上游正文是一段 HTML，javadoc/markdown 的引用转成**正文里的 `<a href>`**，没有第二块「链接清单」。上一轮的弹层把链接抽成一行按钮（正文只剩死文本），本轮改成内联分段：`{@link Bar}` 与句中普通词 `Bar` 撞字时也贴在对的位置（占位符 `\u0002{n}\u0003`，`documentationView.ts:93-97` 说明为什么不能折回后再找）。已内联的不再重复列行（`src/quickDocLayout.ts:266-270`），进不了正文的（`@param` 被 `parseDocCommentLine` 重排掉的那些）仍留在链接行里可点 |
| lp/documentation | 图片可显示 | **已做** | `platform/lang-impl/src/com/intellij/lang/documentation/DocumentationImageResolver.java:21`（解不出来返回 `null` 的契约） | `src/quickDocHost.ts:291-307`（`resolveImage`：http 直给、`file:` 不硬转、工作区相对按**所在文件目录**解析、认不出的扩展名 null）；渲染 `src/components/QuickDocPopup.vue:128-135`（按需解析 + 退回 alt） | 判据 `tests/doc-host.test.mjs:178-186`（四条分支各一条） |
| lp/documentation | 前进/后退历史（`DocumentationBrowserHistory`/`Back`/`Forward`） | **已做**（本轮补判据与键位判据） | `platform/lang-impl/src/com/intellij/lang/documentation/ide/impl/DocumentationBrowserHistory.kt:15/20/26/31/37/43`；`platform/lang-impl/resources/intellij.platform.lang.impl.actions.xml:46-49`（两个动作 `use-shortcut-of="Back"/"Forward"`） | `src/quickDocHistory.ts:35-76`；宿主 `src/quickDocHost.ts:100-103`、`present()` 的 `remember`；弹层 `src/components/QuickDocPopup.vue:80-96`（Ctrl+Alt+左/右）、`:144-145`（按 `canBackward`/`canForward` 置灰） | 上一轮已落地但**零判据**。本轮钉：空栈不可用、`nextPage` 清前进栈、`backward` 的「先存后弹」顺序、上限 32 裁最旧、自动刷新那一拍**不**压历史（`tests/doc-history.test.mjs:44-101`） |
| lp/documentation | 外部文档动作（`DocumentationViewExternal`） | **已做**（本轮补判据） | `platform/lang-impl/src/com/intellij/lang/documentation/ide/actions/DocumentationViewExternalAction.kt:15/18-23`；`platform/lang-impl/src/com/intellij/lang/documentation/ide/impl/links.kt:51-58` | `src/quickDocLayout.ts:287-289`（`currentExternalUrl`）；`src/quickDocHost.ts:246-258`（`openExternalDoc`/`canOpenExternalDoc`）；弹层 `:146`（按钮 disabled）+ `:90-95`（Shift+F1） | 「没有外部 URL 时这个动作整个不可见」⇒ 按钮 disabled 且不发事件；浏览器预览里 `shell.openUrl` 不存在 ⇒ 如实说不能开，不假装（`tests/doc-host.test.mjs:160-176`） |
| lp/documentation | 符号型 target（`DefaultTargetSymbolDocumentationTargetProvider`/`PsiElementDocumentationTarget`） | **已做**（用 LSP 两半拼，非 PSI） | `platform/lang-impl/src/com/intellij/lang/documentation/symbol/impl/DefaultTargetSymbolDocumentationTargetProvider.kt:18-20/27-41`；`platform/lang-impl/src/com/intellij/platform/backend/documentation/DocumentationTargetProvider.java:31` | `src/docSymbolTarget.ts:79-94`（引用语法四形态）、`:137-163`（两步：容器 → 那个文件里的成员）、`:172-179`（哪些链接算符号引用）；消费 `src/quickDocHost.ts:167-209`（`showSymbolDoc` → 换页 + 压历史） | 本仓没有 PSI，但 `workspace/symbol` + `documentSymbol` + `hover` 三个真请求拼出同一条链。**成员查不到时落回容器文档、origin 照实写容器名**（不假装是 `Foo#helper` 的）；判据 8 条，含档位顺序（精确 > 忽略大小写 > 末段 > 前缀 > 包含）与残缺条目不算命中（`tests/doc-symbol-target.test.mjs`） |
| lp/documentation | hover 自动显示开关（`ToggleShowDocsOnHoverAction`） | **部分**（判据与消费函数已做，生效点在保留文件） | `platform/lang-impl/src/com/intellij/codeInsight/documentation/ToggleShowDocsOnHoverAction.java:22/32`；默认档 `platform/ide-core-impl/src/com/intellij/openapi/editor/ex/EditorSettingsExternalizable.java:76`；生效点 `EditorMouseHoverPopupManager.java:452` + `HoverPopupContext.kt:106` | `src/docHoverPolicy.ts:47/54/73-98`；闸的消费 `src/docHoverContent.ts:160-167`（`tooltipText` 关掉 ⇒ `null` 且**连请求都不发**）；按钮 `src/components/QuickDocPopup.vue:148`（`v-if="canToggleHover"`） | 生效点是 `src/components/CodeEditor.vue:512-517`（保留文件，红线：「`CodeEditor.vue` 的 hover 通道 ⇒ 交请求」）⇒ **R1**；持久化 ⇒ **R2 + R3 + R4**。请求没落地前 `canToggleHover` 缺省为假，那颗按钮**不渲染**（不放假控件，判据钉在 `tests/doc-hover-policy.test.mjs:96-99`） |
| lp/documentation | 自动更新开关（`ToggleAutoUpdateAction`） | **已做** | `platform/lang-impl/src/com/intellij/lang/documentation/ide/actions/ToggleAutoUpdateAction.kt:13/17/21`；默认档 `DocumentationToolWindowManager.kt:55`；去抖 `platform/lsp-impl/src/impl/features/highlightingCommon/LspHighlightingCache.kt:264-269`（`LOW_PRIORITY_QUIESCENCE_DELAY = 300.milliseconds`） | `src/docHoverPolicy.ts:100-136`；消费 `src/quickDocHost.ts:213-234`（watch 当前标签页 line/column，300ms 去抖，别的文件的符号页不被当前光标抢走） | 「关了就整条不刷」+「光标没挪不重发」+ 点链接换页与自动刷新都不互相压历史，判据 `tests/doc-hover-policy.test.mjs:71-80`、`tests/doc-history.test.mjs:103-110` |
| lp/documentation | 文档浏览器（`DocumentationBrowser` 停靠面 + `KeepTab`） | **未做** | `platform/lang-impl/src/com/intellij/lang/documentation/ide/actions/KeepTabAction.kt:12`（`ToolWindowContextMenuActionBase` 的子类）、`DocumentationToolWindowManager.kt:44/55/112-114`、`DocumentationTargetHoverInfo.kt:53`（`updateVisibleAutoUpdatingTab`：工具窗已有自动更新的可见页时 hover 就不弹） | 无 | **具体卡点**：①`KeepTab` 在上游是**工具窗右键菜单**动作（`KeepTabAction.kt:12` 的基类就写死了这一点），本仓的可停靠工具窗注册面不在我名下（桶 8 + `src/App.vue`/`src/style.css` 保留），我无法在没有装配的情况下造一个只有模型的死模块（§2 第 2 段禁止「只过自己测试的死模块」）；②上游这条与 hover 那条是**互相抑制**的（`DocumentationTargetHoverInfo.kt:49-56`），没有工具窗时这条的一半行为也无从落。已落的是**同一族里弹层能承接的部分**：历史（上面一行）+ `currentExternalUrl`（浏览器的那个动作）。要接的整面写在下节「还差的面」里 |
| lp/documentation | 内联文档渲染（`codeInsight/documentation/render/` 的 `DocRender` 一族） | **未做** | `platform/lang-impl/src/com/intellij/codeInsight/documentation/render/DocRenderManager.java:22`、`DocRenderer.java:424`（`.section` 的 5px 与 `DocumentationHtmlUtil.kt:135` 的 4px 不一致，本轮在 `src/quickDocLayout.ts:63-68` 登记了取哪个）、`ToggleRenderAllDocs.java:11`、`DocRenderDefaultLinkActivationHandler.kt` | 无 | **具体卡点**：这一族不是「把文档显示得好看点」，而是把文档**渲染成一段可编辑的注入语言画进编辑器里**（`DocRenderPassFactory` 的编辑器绘制通道 + `DocRenderItemUpdater` 的增量刷新 + `DocRenderCopyHandler`/`DocRenderSelectionManager` 的选区复制 + 编辑后写回注释）。本仓的编辑器是 CodeMirror 6，注册扩展的位置在保留文件 `src/components/CodeEditor.vue` 的 extensions 数组，而「文档 → 注入语言 → 编辑写回」在本仓没有任何等价面（既没有注入语言宿主，也没有把编辑结果写回源码注释的通道）。能做的一半已经做了：区块/分节/内联链接/图片的**数据渲染**与点击分派（上面几行） |
| lp/documentation | `Documentation.ToggleAutoShow`（补全弹层里自动展开文档） | **未做**（归属不在本半区） | `intellij.platform.lang.impl.actions.xml:56-57`；`ToggleAutoShowAction.kt:16-20/23-28`（读写 `CodeInsightSettings.AUTO_POPUP_JAVADOC_INFO`，`update()` 只在有 active lookup 时可见） | 无 | **具体卡点**：生效点是补全弹层（`src/completionUi.ts`、`src/lspCompletion.ts`），那是**桶 2 名下**（`docs/batches-2026-10-06-buckets.md:53-68`）。我没有代收别人名下的开关；`src/docHoverPolicy.ts:25-28` 已把这条的坐标与「不代收」写进注释。要接需要桶 2 侧先把补全文档面板的可展开状态暴露出来 |

### 族 `ls/documentation`（判词 `verdict-platform_rest.md:343` 的「缺：」逐条）

| 族 | 项 | 判定 | 上游依据（相对路径:行号） | 本仓落点（文件:行号） | 说明 |
|---|---|---|---|---|---|
| ls/documentation | `LspDocumentationTargetProvider` 的 `DocumentationTarget` 注入面（判词原话：「上游把 hover 包成 target 供 `DocumentationManager` 在任意位置取文档，本仓只有 Ctrl+Q 一条入口」） | **已做**（Ctrl+Q 已走这条；第二条入口生效点等 R1） | `platform/lsp-impl/src/impl/features/documentation/LspDocumentationTargetProvider.kt:20-51`（`:29-31` 客户端与 hover 能力检查、`:43` 小超时、`:45` `getHoverCaching`、`:46-48` `presentableText`、`:55-70` target 的 `computePresentation`/`computeDocumentation`）；入口两条：`platform/lang-impl/src/com/intellij/lang/documentation/ide/impl/DocumentationTargetHoverInfo.kt:35-45` 与 `platform/lang-impl/src/com/intellij/lang/documentation/ide/impl/IdeDocumentationTargetProviderImpl.kt:23/43` | 新增 `src/docHoverContent.ts`：`:138-170`（`createDocHoverContent`：查缓存 → 未命中才发 `textDocument/hover`）、`:64-65`（`tooltipText` = hover 那条入口）、`:88-100`（`presentationFromRange` = 上游的 `presentableText`）、`:68-86`（`hoverRangeFromPayload`）、`:184-197`（全仓一张的登记）；Ctrl+Q 消费 `src/quickDocHost.ts:90-94`、`:114-119` | 本仓用什么承接了什么：**一个「按位置取文档」的层**（缓存 + 区间命中 + 空内容判定 + 闸 + presentableText），两个入口共用。行为判据 `tests/doc-hover-content.test.mjs:83-141`（同位置/区间内只发一次、空白不算文档且不缓存、`available:false` 不缓存、闸只影响 hover 不影响 Ctrl+Q） |
| ls/documentation | 按**文本区间**命中（判词原话：「本仓桥接的 `LspHoverResult` 只有 contents 没有 range，同符号内移动光标不命中」） | **部分**（TS 侧已做完并测死；数据缺 native 那一行） | `platform/lsp-impl/src/impl/features/documentation/HoverResultCache.kt:11-12`（`matches = storedValue.textRange.contains(queriedOffset)`）；`platform/lsp-impl/src/impl/cache/LspPerFileCache.kt:45/63-73`（戳不变才谈命中、命中后 `s.key = key` **重锚**）；`TextRangeAndMarkupContent.kt:14-20`（服务器没给 range ⇒ `TextRange(offset, offset)` 零长 ⇒ 只剩同位置）；`LspRequestExecutor.kt:213-221`（range 由服务器给并映射到宿主） | `src/hoverDocumentation.ts:112-141`（`DocHoverRange` / `docHoverRangeContains` 左闭右开 / 位置键）、`:166-200`（`createHoverCache` 的两条命中 + 重锚）、`src/docHoverContent.ts:68-86`（读 `payload.range`，残缺/零长/反向都不认） | 上游那条「同符号内移动光标不再往返服务器」的行为在 TS 侧已经是真的：判据 `tests/doc-hover-content.test.mjs:33-62`（区间内命中、重锚不增条目、区间外不命中、戳变整文件失效、没 range 时退化成同位置）。**唯一还差的是数据**：`native/lsp_session.cpp:162` 只回 `{available, contents}`，把服务器的 `range` 丢了 ⇒ `payload.range` 恒 `undefined` ⇒ 现在跑的是上游的零长回退档。native 文件当前被桶 3 另一个半区改着（`git status` 显示 ` M native/lsp_session.cpp`），我**没动它**，改法与验证义务写在 **R5** |
| ls/documentation | markdown → HTML 的富渲染（判词原话：「弹层宿主 `src/App.vue` 本批冻结，那里是 `<pre>`」） | **已做**（数据驱动渲染，不注 HTML） | `LspDocumentationData.kt:81-104`（`DEFINITION_START + 签名 + DEFINITION_END`、`CONTENT_START + 描述 + CONTENT_END`）、`DocumentationMarkup.java:13-31`、`DocumentationHtmlUtil.kt:116-138/143-149/152-159` | `src/quickDocLayout.ts:258-280`（`buildQuickDocLayout`：definition/content/sections/bottom 四块 + 空节删除 + 外链图标位）、`src/components/QuickDocPopup.vue:151-192`（按四块与 class 名渲染）；样式 `src/style.css:1321-1351`（`.quickdoc-*`，上一轮已落） | 本仓不 `v-html` 服务器给的 HTML（白名单思路：`documentationView.ts:166-192` 的 `markHtml` 把 `<pre>/<img>/<a>` 记录后剥标签），把内容拆成数据再按上游的 class 名渲染 —— 架构不等价下的功能等价。tooltip 侧仍是纯文本（签名在前、描述在后，不带围栏），因为它落在保留文件里 ⇒ R1 |
| ls/documentation | `LspDocumentationData` 整形 + `HoverResultCache` 等价物（判词说「本批补两块」） | **已做**（上一轮）+ 本轮补区间命中 | `LspDocumentationData.kt:26-59`（`convertLineSeparators`/`parseLeadingCodeFence`/`trimIndent`）、`HoverResultCache.kt:11-12` | `src/hoverDocumentation.ts:25-94`（整形四件）、`:96-227`（缓存） | 上游 `:28` 那一支（开头**没有**闭合围栏 ⇒ 整段当描述、markup 记 MARKDOWN）在本仓等价（`createHoverDocumentation` 的 `markup: 'plain'` 分支只影响后续渲染，弹层侧仍按 markdown 拆链接/图片）。围栏至少 3 个反引号、闭合不少于开围栏、语言取信息行第一个词，都已钉（`tests/hover-documentation.test.mjs:17-26`） |

### 本轮顺带修掉的破损（不是判词项，但都是本族的交付缺陷）

| 项 | 判定 | 本仓落点 | 说明 |
|---|---|---|---|
| `tests/hover-documentation.test.mjs` 的「接线：Ctrl+Q 走整形与缓存」在本轮之前是**红的** | **已修** | `tests/hover-documentation.test.mjs:88-101`（第 97 行的正则锚点） | 上一轮把「查缓存 + 发 hover」从 `editorFileOps.ts` 搬进 `quickDocHost.ts` 时，锚点还写着 `cache.get(tab.path, position, stamp)`，而搬过去的是 `cache.get(path, position, stamp)` ⇒ 断言必然不中（基线实测：域内 1 条红）。本轮按 playbook §7 把 **read 路径改指实现真正所在的 `src/docHoverContent.ts`**，断言体（消息「取文档没有先查缓存」）一字不动。这条红**不在** `batches-2026-10-06-buckets.md:18-22` 列的 17 条里，是本轮新暴露的 |
| `src/quickDocHost.ts` 的相对 import 漏 `.ts` 扩展名（3 处），导致这个模块在 node 下**根本 import 不进来** | **已修** | `src/quickDocHost.ts:23`（`'./bridge.ts'`）、`:27`（`'./errors.ts'`）、`:35`（`'./editorTab.ts'`） | 症状正是 playbook §0.5 说的那种「不是断言失败，是模块加载失败」：`node -e "import('./src/quickDocHost.ts')"` 报 `Cannot find module D:\TaoCode\src\bridge`。修完才有 `tests/doc-host.test.mjs` 这 12 条**真行为**判据（之前这族只能做源码形状断言）。`node .tools/find-missing-ext.mjs` 现在全仓 0 处 |
| 分节表头在正文里留了副本 | **已修** | `src/quickDocLayout.ts:195-203`（横线消费表头时从正文/上一节尾巴里撤走那块）、`:227-241`（`finishSection`） | `**返回**\n---\n值` 这种写法，上一轮把 `**返回**` 既当节表头又留在正文（或并进**上一节**的尾巴，变成 `参数二\n\n**返回**`）。上游一行节表就是「左格表头 + 右格内容」，正文里没有第二处（`DocumentationMarkup.java:28-31`）。判据 `tests/doc-layout.test.mjs:54-66` |

---

## 改动文件

**新增（6 个实现/测试文件之外的新实现 1 个）**
- `src/docHoverContent.ts`（**203 行**）：按位置取文档的注入面（缓存/区间命中/空内容判定/hover 闸/presentableText/全仓一张登记/编辑器 hover 用的文档戳）。上限 900，未超。
- `tests/doc-hover-content.test.mjs`（13 用例）
- `tests/doc-host.test.mjs`（12 用例，真行为：假 `request` 驱动 `createQuickDocHost`）
- `tests/doc-history.test.mjs`（8 用例）
- `tests/doc-hover-policy.test.mjs`（9 用例）
- `tests/doc-layout.test.mjs`（11 用例）
- `tests/doc-symbol-target.test.mjs`（8 用例）

**修改**
- `src/hoverDocumentation.ts`（+`DocHoverRange`/`docHoverRangeContains`/位置键/`createHoverCache` 的两条命中与重锚；文件头「与上游的差异」那一段按现状改写）
- `src/documentationView.ts`（`DocPart` + `DocBlock.parts` + 占位符管线；`extractJavadocLinks` 公开行为逐字不变，内部换成 `markJavadocLinks`）
- `src/quickDocLayout.ts`（`DocSection.parts`、`splitSections` 重写为草稿节 + `finishSection`、表头去重、`links` 只留进不了正文的）
- `src/quickDocHost.ts`（`fetchHover` 改走共享取用面并登记共享缓存；3 处 import 补 `.ts`；`LspHoverResult` 这个不再用的类型 import 删掉）
- `src/components/QuickDocPopup.vue`（正文与分节右格按 `parts` 贴内联链接；`partLink`/`partText`；`onLink` 收 `null`）
- `tests/hover-documentation.test.mjs`（**只**改第 97 行的 read 路径锚点，见上表）

**没动**：`src/App.vue`、`src/components/CodeEditor.vue`、`src/style.css`、`src/settingsModel.ts`、`src/editorFileOps.ts`（桶 5 名下，本轮之前已被上一轮改过，现在 ` M`）、`src/bridge.ts`、`native/*`（`native/lsp_session.cpp` 正被桶 3 另一个半区改）、以及 `src/codeLens*`/`src/inlay*`/`src/ls*`/`src/problems*`/`src/inspection*`。

**共享文件自陈**：我只在 `tests/hover-documentation.test.mjs`（不在我名下的测试文件）改了 1 行的 read 锚点 + 注释，理由与 playbook §7 的「搬走实现必须把 read 路径一起改指」一致；断言体未动。

---

## 验证

- `node --test tests/doc-*.test.mjs tests/hover-documentation.test.mjs tests/documentation-view.test.mjs tests/document-links.test.mjs tests/document-link-targets.test.mjs tests/markdown.test.mjs tests/quick-definition.test.mjs`
  ⇒ **108 用例 / 108 通过 / 0 失败**（本轮新增 61 条，全在我名下；本轮修掉 1 条既有的红）。
  逐文件：`doc-hover-content` 13、`doc-host` 12、`doc-history` 8、`doc-hover-policy` 9、`doc-layout` 11、`doc-symbol-target` 8、`hover-documentation` 7、`documentation-view` 8。
- **只跑了本域测试**，没跑全量 `npm test`（按 §3 第 6 条）。
- `npx vue-tsc -b` ⇒ 本域 **0 错**。全量输出只剩 1 行：`src/customFoldingProviders.ts(48,103): error TS1002: Unterminated string literal.` —— 那是**桶 5**（`src/editor*`/`customFolding*`）名下的文件，`git status` 显示它正在被别人改，我没碰。
- 三条系统性禁令检测器（收工前）：
  - `node .tools/find-param-props.mjs` ⇒ `共 0 处参数属性`
  - `node .tools/find-ts-in-mjs.mjs` ⇒ `干净：tests/*.mjs 全部是纯 JavaScript。`
  - `node .tools/find-missing-ext.mjs` ⇒ `扫描 1106 个文件… 干净`（本轮顺手把 `quickDocHost.ts` 的 3 处补全，见上表）
- 模块上限：`src/docHoverContent.ts` 205 行；改完的 `quickDocHost.ts` 318、`quickDocLayout.ts` 289、`documentationView.ts` 279、`hoverDocumentation.ts` 227、`QuickDocPopup.vue` 208 —— 全部 < 900（`tests/module-size.test.mjs` 的 `DEFAULT_LIMIT`），未调任何上限。
- 未跑 native（本轮没有 native 改动，故无 ctest 结果；R5 里写明了落地后要跑的 `lsp_fake_server_requests.cpp` + `nctest-all.bat` 义务）。

### 反向验证记录（新门禁不空转）

一次性注入 4 处违规（都是「把新行为关掉」的形状，不是语法破坏），跑 `node --test tests/doc-*.test.mjs`：
⇒ **60 用例 / 50 通过 / 10 失败**，失败集合与 4 处注入一一对应：

| 注入 | 位置 | 变红的判据 |
|---|---|---|
| `containedEntry` 提前 `return undefined`（区间命中关掉） | `src/hoverDocumentation.ts:170` | 「缓存：带区间的条目在同符号内移动光标命中…」「取用面：同位置与区间内都只发一次请求」 |
| hover 的闸短路（`if (false && !shouldShowDocOnHover())`） | `src/docHoverContent.ts:162` | 「hover 那一档闸：关掉就整个不弹，也不发请求」 |
| `markJavadocLinks` 折回 label 而不是占位符 | `src/documentationView.ts:139-151` | 「内联链接：占位符让 `{@link Bar}` 贴在该在的位置」「三种链接来源都落在句子里」「没有链接的块不给 parts」「已经长在句子里的链接不再重复列一行」+ 宿主两条（`doc-host` 的 `{@link}` 换页、外部可点性） |
| 假控件按钮的 `v-if="canToggleHover"` 改成 `v-if="true"` | `src/components/QuickDocPopup.vue:148` | 「接线：两档都有真消费方，没有消费链路的开关不渲染（假控件禁令）」 |

四处全部撤掉后复跑 ⇒ 76/76（本域子集）与 108/108（全套）皆绿；`git status` 复核这些文件都是未跟踪的本族文件，没有覆盖别人的 hunk。

---

## 接线请求

见 `docs/wiring-requests-2026-10-06-bucket3a.md`，共 **5 条**：
- **R1** `src/components/CodeEditor.vue:512-517`（+64 行 import）：hover 通道改走 `sharedDocHover().tooltipText(...)` ⇒ 「在鼠标移动时显示」那档闸生效、与 Ctrl+Q 共用一张 `HoverResultCache`、tooltip 不再贴围栏原文。
- **R2** `src/App.vue:2400`：补 `@policy-change="applyDocHoverPolicy($event)"` 与 `:can-toggle-hover="true"`（后者仅当 R1 落地）+ 一个两行的 `applyDocHoverPolicy`（`saveSettingsPatch` 就在同文件 `:639`）。
  ⚠️ 上一轮编号 A1（`QuickDocPopup` 挂载）**我复核过：已经落地且完整**（链接分派、图片解析、前进/后退、外部文档四条链都有真消费方，现在还有 12 条行为判据）⇒ **不要再交那条请求**。
- **R3** `src/settingsPersistence.ts:86`：读回设置后 `docHoverPolicyFromSettings(editorSettings.value)`（缺键 ⇒ 上游默认档「开」，不会因为少键判损坏）。
- **R4** `src/settingsModel.ts`：`EditorSettings` 登记 `showQuickDocOnMouseHover` / `autoUpdateDocumentation` 两格，默认 `true`（与 `EditorSettingsExternalizable.java:76`、`DocumentationToolWindowManager.kt:55` 一致）。R2 的 `@policy-change` 必须在 R4 之后接，否则 `Partial<EditorSettings>` 装不下这两把键。
- **R5** `native/lsp_session.cpp:162` 把服务器的 `hover.range` 透传上来（+ 可选 `src/bridge.ts:126` 加一个 `range?` 字段；不加也能跑，`docHoverContent.ts` 用自己的结构类型读）。**TS 侧已做完**，这一行是「同符号内移动光标命中缓存」唯一还缺的数据来源。native 文件正被另一个半区改着，所以我没碰。

### 还差的面（没有请求可写，如实登记）

- **文档浏览器 / `KeepTab`**：需要可停靠的工具窗注册面（桶 8 + 保留文件）。上游这一族的行为面（自动更新的可见页抑制 hover，`DocumentationTargetHoverInfo.kt:49-56`；`KeepTabAction.kt:12` 的右键菜单）在没有工具窗时无法只靠模型承接 —— 我没有为它造一个零消费方的 `docBrowser*` 模块。
- **`render/` 内联文档渲染 + `Documentation.EditSource`（`actions.xml:50-51`）**：需要「文档 → 编辑器内注入语言 + 编辑写回」那一层，本仓不存在，注册点又在保留文件 `CodeEditor.vue` 的 extensions 数组。
- **`Documentation.ToggleAutoShow`**：生效点在桶 2 名下的补全弹层。
- **`documentationView.ts:271-274` 的 `firstInternalDocLink`**：现在只有测试消费（`tests/documentation-view.test.mjs` 把它当模型 API 钉住），生产链路的分派走 `quickDocHost.followInternalDocLink`（对**每条**链接分派，不只第一条）。上一轮判词把它列为模型能力，我没有为了「有消费方」把它硬塞进链路，也没删（删会撞那条既有测试）。

## 做不到 / 无法核实

| 项 | 状态 | 具体卡点 |
|---|---|---|
| 「在鼠标移动时显示」对用户真的生效 | 做不到（在本半区内） | 生效点是保留文件 `src/components/CodeEditor.vue:502-518` 的 `hoverTooltip`（桶 3 红线明确写「hover 通道是保留文件 ⇒ 交请求」）。判据、闸的消费函数、共享缓存、tooltip 文本全已落地并有 13 条测试，只差那 6 行替换 ⇒ **R1** |
| 两档开关重启后还在 | 做不到 | 写盘要 `App.vue` 接 `@policy-change`（**R2**）+ `settingsModel.ts` 登记两把键（**R4**）；读盘要在设置装配处灌回单例（**R3**）。三处都不在本半区名下 |
| 「同符号内移动光标不再往返语言服务」用真服务器数据 | 做不到 | `native/lsp_session.cpp:156-162` 的 hover 分支只回 `{available, contents}`，服务器的 `range` 被丢掉；`src/bridge.ts:126` 的 `LspHoverResult` 也没有这一格。TS 侧读 `payload.range` 的代码与判据都在（**R5** 给的就是这一行补丁）；补之前跑的是上游 `TextRangeAndMarkupContent.kt:16-20` 那条零长回退档，行为与判词里「本仓只有 contents」的描述一致 |
| `DocRender`（内联文档渲染）一族的用户可见行为 | 做不到 | 见上一节：注入语言 + 编辑器绘制通道 + 编辑写回三件都没有等价物，注册点还在保留文件 |
| 文档工具窗（`DocumentationBrowser`/`KeepTab`/自动更新页抑制 hover） | 做不到 | 工具窗注册面不在本半区（桶 8 / `App.vue` / `style.css`）；造只有模型的 `docBrowser*` 会留下零消费方死模块，§2 第 2 段禁止 |
| 「`DocRenderer.java:424` 的 5px 与 `DocumentationHtmlUtil.kt:135` 的 4px 到底哪个是节表右间距」 | 无法核实 | 上游两处真的不一致（我两边都开了：`scaleFunction.apply(5)` 与 CSS 侧 `padding-right: 4px`）。本仓取弹层 CSS 那一处（4），已在 `src/quickDocLayout.ts:63-68` 注释登记两处坐标与取谁 —— 没有证据说上游自己裁定过 |
| `EditorMouseHoverPopupManager` 的 hover 延时是否等于本仓 `hoverTime: 250` | 无法核实 | 上游 `:127-133` 那条链给的是 `showImmediately`/context，没有本仓那种「固定 250ms」常数的等价物（250 这个数在保留文件 `CodeEditor.vue:518` 里，是上一批留下的既有值，本轮没有为它编造上游出处，也没改） |
