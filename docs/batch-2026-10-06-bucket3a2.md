# 桶 3a2 · 快速文档收尾 —— 正文内联链接 / 图片 / 前进后退与外部文档（2026-10-06）

> 范围只有 Ctrl+Q 这一条链。判定基准 = 上游树 `D:\Backup\Downloads\intellij-community-master\intellij-community-master`（本地已解压，全部直接读源码，没有上网、没有截图比对）。
> 接手现场是上一轮那句「Now inline links in the document body」。核实结果：**内联机制本身上一轮已经落了**
> （`documentationView.ts` 的 `parts` + `QuickDocPopup.vue` 按分段贴），但**有两处在链上把内联结构丢掉了**，
> 丢掉之后链接既不在句子里、也不在链接行里 —— 就是"彻底消失"。本轮补这两处，并把 1–4 逐条核实到行号。

## 判词

| 族 | 项 | 判定 | 上游依据（相对路径:行号） | 本仓落点（文件:行号） | 测试 |
|---|---|---|---|---|---|
| `lp/documentation` | 正文（`content`）里的 `<a>` 内联 | **上一轮已落，本轮复核为真行为**（不是空壳） | `platform/analysis-api/src/com/intellij/lang/documentation/DocumentationMarkup.java:24`（`CONTENT_START` 之后是原样 HTML）；`platform/markdown-utils/src/com/intellij/markdown/utils/doc/DocMarkdownToHtmlConverter.kt:68`（`a` 在**行内**标签白名单里，不会被抽走）；`platform/lsp-impl/src/impl/features/documentation/LspDocumentationData.kt:94` → `:102`（描述的 markdown 转 HTML 后整段塞进 `CONTENT_START`） | `src/documentationView.ts:220-245`（`markHtml` 的 `<a>` → 占位符，位置不丢）、`src/documentationView.ts:250-254`（`docBlock` 同时给 `text` 与 `parts`）；渲染 `src/components/QuickDocPopup.vue:165-170` | `tests/doc-layout.test.mjs:99`、`:107`、`:116` |
| `lp/documentation` | **洞 A：标题块里的链接整条链上消失**（渲染层只读 `block.text`） | **本轮修复** | 同上 `DocMarkdownToHtmlConverter.kt:66`（`h1`–`h6` 与 `a` 同属正文，标题里照样能长链接）；`DocumentationMarkup.java:24` | `src/components/QuickDocPopup.vue:156-162`（`<h4>` 改为按 `parts` 逐段贴 + `partLink(part)` 派发 `@follow`） | `tests/doc-layout.test.mjs:184`（接线判据新增 `heading` 区段必须含 `partLink(part)`） |
| `lp/documentation` | **洞 B：`@param`/`@throws` 的说明里那个链接被抽成分节表外的一行** | **本轮修复**（链接回到分节右格的原位置） | `DocumentationMarkup.java:28-29`（`SECTION_HEADER_START` 左格只有主题词，`SECTION_SEPARATOR` 右格是**一段 HTML**，链接长在里面）；`platform/code-style-impl/src/com/intellij/formatting/comments/DocCommentLineDataBuilder.java:99-101`（描述起点是一个**偏移**，不是重排后的字符串） | `src/quickDocLayout.ts:147-165`（`docCommentLineOffsets`：偏移版拆分，能在带占位符的原文上切）、`:173-185`（`parseDocCommentLineParts`）、`:188-197`（`trimDocParts` 只掐首尾，中间段不动）、`:208`（`SectionDraft.headParts`）、`:271`、`:280`（右格有链接就给 `parts`）、`:304`（`splitSections` 收 `model.links`）；`src/documentationView.ts:161-172`（`docPartsToMarks` = `docPartsFromMarks` 的逆） | `tests/doc-layout.test.mjs:139`（`@param` 右格内联 + 链接行不再重复 + 纯文本逐字不变 + 被表头吃掉的那块仍留链接行）、`:158`（两套拆分的**同一偏移**判据：7 个 case 逐个对拉） |
| `lp/documentation` `ls/documentation` | 图片 `:resolve-image` 是真通道还是破图 | **真通道**（宿主读字节 → data URL；认不出/读不到一律 `null`，渲染层退回 alt 文本，不画破图） | `platform/lang-impl/src/com/intellij/lang/documentation/DocumentationImageResolver.java:21`（`@Nullable Image resolveImage(@NotNull String url)`，`:18` 写明"解不出来返回 null"）；`DocMarkdownToHtmlConverter.kt:70`（`img` 也是正文行内标签） | 通道：`src/bridge.ts:109`（`'file.readBinary'`）→ `native/file_queries.cpp:19-21` → `native/workspace.cpp:782-791`（工作区相对 + `limit` 夹取 + 魔数嗅探 `kind`，`native/workspace.cpp:768-780`）。消费：`src/quickDocHost.ts:291-320`；渲染 `src/components/QuickDocPopup.vue:129-136`、`:195-198`。**`app.readImage`（`native/main.cpp:139-143` → `dialogs::read_image`）是绝对路径那条（文件选择器用），相对工作区路径的正确通道就是 `file.readBinary`，与 `src/components/MarkdownPreview.vue:42` 同一口径** | `tests/doc-host.test.mjs:179`（http 原样 / 相对路径按**所在文件目录**解析出 `src/img/a.png` / `file:` 与不认识的扩展名算解不出来 / `data:image/png` 内联放行 / `data:text/html`、`javascript:`（含伪装 `.png`）判死且不读文件 / 魔数是 PDF 时不给 data URL） |
| `lp/documentation` | 后退 / 前进（`DocumentationBackAction`/`DocumentationForwardAction`/`DocumentationBrowserHistory`） | **真行为，不是空壳**：`can-*` 两个 props 背后是两条栈 + 页面换页，且 `App.vue` 已经接上 | `platform/lang-impl/src/com/intellij/lang/documentation/ide/impl/DocumentationBrowserHistory.kt:15-18`（`canBackward`/`canForward` = 对应栈非空）、`:20-24`（`backward()` 先把当前快照压 forward 再弹 back）、`:31-35`（`forward()` 对称）、`:43-47`（`nextPage()` 压 back 且**清空** forward）；`DocumentationBackAction.kt:14`（`isEnabled = canBackward()`）、`:18`；`DocumentationForwardAction.kt:14`；键位 `platform/lang-impl/resources/intellij.platform.lang.impl.actions.xml:46-49`（`use-shortcut-of`） | `src/quickDocHistory.ts:35-76`（逐条照抄，含 `:53-55` 的"先存后弹"顺序）；`src/quickDocHost.ts:100-103`（history 的 snapshot/restore 绑到 `quickDoc` ref）、`:127-130`（`present(… remember)` → `nextPage()`）、`:237-240`；渲染与键位 `src/components/QuickDocPopup.vue:144-145`、`:82-88`；挂载点 `src/App.vue:2400`（`:can-backward="quickDocCanBackward()"` `:can-forward` `@back` `@forward` 全部实接） | `tests/doc-host.test.mjs:106`（点 `{@link}` → 换页 + `canGoBackward()` 由 false→true → 后退回第一页 → 前进回第二页，并钉 `server.sent.hover === 2`：证明换页**真的重新取了一次文档**，不是切字符串） |
| `lp/documentation` | 外部文档（`DocumentationViewExternalAction` 打开 javadoc 站点） | **真行为**：`can-open-external` = 当前页真有 `http(s)` URL；点了走 `shell.openUrl`；没有 URL 时按钮 disabled 且键位不吞事件 | `DocumentationViewExternalAction.kt:15`（`isEnabledAndVisible = currentExternalUrl() != null`）、`:18-23`（取不到就 return，不报错）；`platform/lang-impl/src/com/intellij/lang/documentation/ide/impl/links.kt`（`openUrl` → 系统浏览器）；键位 `intellij.platform.lang.impl.actions.xml:52-53` | `src/quickDocLayout.ts:330-332`（`currentExternalUrl`）、`src/quickDocHost.ts:246-256`（`openExternalDoc` / `canOpenExternalDoc`）、`native/file_queries.cpp:41-43`（`shell.openUrl` → `open_external`，无协议前缀直接拒）；`src/components/QuickDocPopup.vue:146`、`:90-95`、`:199-203` | `tests/doc-host.test.mjs:155`（只有当前页真有外部 URL 才可点，点了发的是那条 URL）、`:169`（浏览器预览里如实说明，不假装打开）、`tests/doc-layout.test.mjs:73` |
| `lp/documentation` | `KeepTabAction` | **未做（无消费链路 ⇒ 不渲染，不是假控件）** | `platform/lang-impl/src/com/intellij/lang/documentation/ide/actions/KeepTabAction.kt:12`（`ToolWindowContextMenuActionBase`）、`:15-16`（只在文档**工具窗**的 `Content.isReusable` 时可点）、`:20`（`content.toolWindowUI.keep()`）；注册 `intellij.platform.lang.impl.actions.xml:60-61`（id `Documentation.KeepTab`）、挂载 `platform/platform-impl/resources/idea/LangActions.xml:144` | 卡点：本仓的快速文档是**弹层**（`src/App.vue:2400` 的 `Teleport`），没有文档工具窗、也没有 `Content` 页签集合 ⇒ "把这一页留在工具窗里"没有对应物。加一个按钮就是假控件，故不加 | 无（登记为未完成） |
| `lp/documentation` | 内联文档渲染（`render/` 的 DocRenderer 一族） | **未做**（本轮范围外，具体卡点见下） | `platform/lang-impl/src/com/intellij/codeInsight/documentation/render/DocRenderer.java`（该目录实测 31 个文件：`DocRenderManager.java`/`DocRenderItemManagerImpl.kt`/`DocRenderImageManager.java`/`ToggleRenderAllDocs.java` …） | 卡点两条：① 消费点是保留文件 `src/components/CodeEditor.vue` 的 hover 通道（`docs/wiring-requests-2026-10-06-bucket3a.md` R1 未接）；② 要在编辑器里定位一块文档，需要 native 把 LSP `hover.range` 透传上来（R5 未接，`src/hoverDocumentation.ts:102-108` 已按上游口径把接口留好）。二者都不是我这半区能自己落地的 | 无（登记为未完成） |
| `lp/documentation` | hover 自动显示 / 自动更新两档开关 | 自动更新：**真行为**；在鼠标移动时显示：**运行时真、UI 未渲染**（`App.vue` 没传 `can-toggle-hover` ⇒ 按钮不渲染，符合"无消费链路不渲染"） | `DocumentationToolWindowManager.kt:55`（autoUpdate 默认开）、`:112-114`（按内容归属决定刷不刷）；`ToggleShowDocsOnHoverAction` 读写的同样是单例 | `src/docHoverPolicy.ts`（运行时单例）+ `src/quickDocHost.ts:213-234`（去抖 + 归属判定，`tests/doc-host.test.mjs` 与 `tests/doc-hover-policy.test.mjs` 钉着）；`src/components/QuickDocPopup.vue:148`（`v-if="canToggleHover"`） | 已存在：`tests/doc-hover-policy.test.mjs`、`tests/doc-host.test.mjs`（自动刷新不压历史） |
| `ls/documentation` | 文档正文里的不安全协议（本轮顺手收的一条判词剩余项） | **本轮修复**（`javascript:`/`vbscript:`/`data:` 留字断链，与上游同形） | `platform/markdown-utils/src/com/intellij/markdown/utils/doc/impl/XssSafeLinks.kt:8`（`UNSAFE_LINK_REGEX`）、`:9`（图片版）、`:11`（`data:image/(gif\|png\|jpeg\|webp\|svg)[+;=a-z0-9A-Z]*,` 放行）、`:13-15`（不安全 ⇒ 目标换成 `#`） | `src/documentationView.ts:77-99`（三条正则 + 三个导出）与 `:123`（`classifyDocLink` 落成 `kind:'anchor'`、`target:'#'`，即"字还在、点不动"）；图片侧 `src/quickDocHost.ts:294-296` | `tests/doc-layout.test.mjs:174`（三种协议 ⇒ `['anchor','#']`，并钉住 `file:` 本仓**故意跟上游不同**） |

### 有意的架构差异（如实保留，不改口）

- **`file:` 不按 `XssSafeLinks.kt:8` 判死**：上游的文档面是 HTML pane，`file:` `href` 是 XSS 面；本仓内部链接走的是 `revealLocation`（= IDEA 自己的引用解析导航链，不是 `href`）。判死会把已经接好的导航链拆掉（`tests/doc-host.test.mjs:135` 钉着它）。理由写在 `src/documentationView.ts:69-76`。
- **`@return` 不跳一个词**：上游 `DocCommentLineDataBuilder.java:91-93` 对 `@return`/`@throws` 同一条跳过下一词（那是**注释重排**用的 textStart 口径）；本仓这一格的语义是"主题词"，`@return` 没有主题词，照跳会把描述第一个词吃掉。判据 `tests/doc-layout.test.mjs:44` 保留原断言，注释已改写为准确的出处描述（`src/quickDocLayout.ts:125-132`）。
- **`<pre>` 里的 `<a>` 不做链接**：与上游一致 —— `DocMarkdownToHtmlConverter.kt:99-111` 在围栏里逐行当代码，不走行内标签；所以 `layout.links` 那一行现在只剩"被当表头吃掉的那一块"里的链接（判据 `tests/doc-layout.test.mjs:139` 后半）。

## 改动文件

| 文件 | 性质 | 动到的地方 |
|---|---|---|
| `src/documentationView.ts` | 修改（279 → 333 行） | `:69-99` 三条协议正则 + `isUnsafeDocTarget`/`isSafeDocImageSource`/`isInlineDocImageSource`；`:123` `classifyDocLink` 的断链支；`:161-172` 新增 `docPartsToMarks`（`docPartsFromMarks` 的逆） |
| `src/quickDocLayout.ts` | 修改（289 → 332 行） | `:125-137` `parseDocCommentLine` 改为读偏移；`:147-165` `docCommentLineOffsets`；`:173-185` `parseDocCommentLineParts`；`:188-197` `trimDocParts`；`:202-213` `SectionDraft.headParts`；`:88-93` `DocSection.parts` 语义与注释；`:269-281` `finishSection`（`:271`、`:280`）；`:304` `splitSections(model.blocks, model.links)`；`:29-31` import 补三个值符号 |
| `src/quickDocHost.ts` | 修改（318 → 330 行） | `:25` import；`:291-320` `resolveImage`：不安全源判死、`data:image` 内联放行、MIME 以宿主嗅探的 `kind` 为准 |
| `src/components/QuickDocPopup.vue` | 修改（208 → 215 行） | `:156-162` 标题块按 `parts` 逐段渲染（内联链接可点） |
| `tests/doc-layout.test.mjs` | 修改（165 → 199 行） | 改写 1 条**过时**判据（原先钉的是"`@param` 的链接进不了正文"，本轮把它改成钉"进得了正文"，意图仍是"进不了正文的才留一行"）+ 新增 3 条：偏移一致性（7 case 对拉）、三种不安全协议、接线判据补标题块 |
| `tests/doc-host.test.mjs` | 修改（227 → 234 行） | 假服务器的 `file.readBinary` 回包补 `kind`（含一份"名字是 .png、内容嗅探是 PDF"的样本）+ 图片判据扩 5 条断言 |

未动保留文件：`src/App.vue`、`src/style.css`、`src/tokens.css`、`src/bridge.ts`、`src/components/CodeEditor.vue`、`src/keymap*.ts`、`src/actionRegistry.ts`、`tests/module-size.test.mjs`、`CMakeLists.txt`。也没动别的桶名下文件（`src/codeLens*`/`src/inlay*`/`src/ls*`/`src/problems*`/`src/tool*`）。

## 验证

- `node --test tests/doc*.test.mjs tests/quick-doc*.test.mjs tests/hover*.test.mjs` → **88 tests / 88 pass / 0 fail**（本轮起点 86/86；净新增 2 条 `test()` + 1 条改写 + 5 条新断言）。
  注：仓库里**没有** `tests/quick-doc*.test.mjs`（宿主判据一直在 `tests/doc-host.test.mjs`），该 glob 命中 0，不报错。
- `npx vue-tsc -b --force`（收工那次用 `--force` 取真基线，按 `docs/agent-playbook-parity.md` §6.2）→ 我名下 4 个文件 **0 错**。全仓只有 1 条、且不是我的在途错：`src/customFoldingProviders.ts:48 TS1002 Unterminated string literal`（任务书里点名的是 `src/customFoldingPopup.ts`，位置已被桶 5 挪动 ⇒ 没去碰）。
- 三个检测器：
  - `node .tools/find-param-props.mjs` → 共 **0 处**参数属性。
  - `node .tools/find-missing-ext.mjs` → 扫描 **1151 个文件**，干净（新增的三个值 import 都带 `.ts`）。
  - `node .tools/find-ts-in-mjs.mjs` → `tests/*.mjs` 全部纯 JavaScript。
- `node .tools/find-orphan-modules.mjs --gate` → 门禁红的是 4 条 **不是我名下**的新增零消费方模块（`src/historySessions.ts`、`src/historyTimeline.ts`、`src/rootsAttachScan.ts`、`src/rootsModel.ts`，桶 4/5 在途；两次运行条数会随别的 agent 落盘而变，本行记的是收工那次）。本轮我落地的符号**全部**有生产消费方：`parseDocCommentLineParts`/`docPartsToMarks` 被 `src/quickDocLayout.ts` 用，三个协议判定被 `src/documentationView.ts`/`src/quickDocHost.ts` 用，`src/quickDocLayout.ts` 由 `src/App.vue:2400` 那条链消费 —— 没有新增孤儿。
- `node --test tests/module-size.test.mjs` → **5/5**（我的四个文件 333 / 331 / 330 / 215 行，上限 900，没调过任何上限）。

### 反向验证记录（每条新门禁都先看它变红）

| # | 注入的违规 | 结果 | 撤掉后 |
|---|---|---|---|
| 1 | `QuickDocPopup.vue` 标题块改回 `<h4>{{ block.text }}</h4>` | doc-layout **13 中 1 红** ✓ | 恢复，`git status` 无残留 |
| 2 | `finishSection` 不给 `parts`（`if (false && parts.some(…))`） | **变红** ✓ | 恢复。踩坑记录：这次备份用了 `/tmp/qdl.bak`，node 在 Windows 把 `/tmp` 解析成 `D:\tmp` ⇒ `cp` 写的备份它找不到、脚本中途抛错，文件留在变异态；**改用 Edit 工具按字面还原**，随后 88/88 复绿。（后续所有变异都改成"进程内读进内存 → `finally` 写回"，不再用 `/tmp`） |
| 3 | `classifyDocLink` 去掉 `isUnsafeDocTarget` 那一支 | doc-layout **变红** ✓ | 恢复 |
| 4 | `resolveImage` 去掉 `isSafeDocImageSource` 守卫 | **第一遍空转** ✗ —— 因为 `javascript:alert(1)` 的"扩展名"本来就不认识，`imageMimeFor` 先一步返回 null，判据抓不到 | 先补两条**会走到读文件**的判据（`javascript:alert(1).png`、`data:text/html;base64,x.png`）+ 一条 `readBinary` 次数断言，再重跑注入 ⇒ **变红** ✓ |
| 5 | `resolveImage` 去掉嗅探（`const sniffed = false ? … : mime`） | **变红** ✓（第一次尝试被 bash 的反引号转义吞掉，替换成了空操作 ⇒ 那次"竟然通过"是**假阴性**，换锚点后重跑） | 恢复 |
| 6 | （非注入）新判据第 2 条第一次跑就抓出一个**真 bug**：`parseDocCommentLineParts` 的 `text` 直接 `head.trim()`，纯文本里漏出占位符 `\u00020\u0003` | 红 → 修成 `docTextFromMarks(head, links).trim()`（`src/quickDocLayout.ts:182`） | 88/88 |

## 做不到 / 无法核实

1. **`LinkBuilder.java` 与 `Documentation_as_html` 那条路径：无法核实**（任务书点名的两处）。三条路各搜过：
   - 按文件名：`find -iname "*LinkBuilder*"` → 0 命中；`platform/platform-impl/src/com/intellij/codeInsight/documentation/builders/` 这个目录**在本 checkout 里不存在**（`ls` 直接失败），也没有任何 `*documentation*builders*` 目录。
   - 按符号引用：`grep -rln "LinkBuilder"` → 0 命中。
   - 按语义（"文档正文里的行内 `<a>` 是谁生成的"）→ 等价物是 `platform/markdown-utils/src/com/intellij/markdown/utils/doc/impl/XssSafeLinks.kt:17-27`（包路径 `com.intellij.markdown.utils.doc.impl`，`DocFlavourDescriptor.kt` 用的就是它；它包装 `org.intellij.markdown.html.LinkGeneratingProvider.renderLink`，正是"行内链接生成"那一层）。
   - `DocFragment` / `Documentation_as_html`：按文件名只命中 javadoc PSI 那几个（`java/java-psi-api/src/com/intellij/psi/javadoc/PsiDocFragmentName.java` 等，18 行、第 2 行 `package com.intellij.psi.javadoc;`；**citefix 订正**：原写 `java/java-psi-api/src/com/intellij/javadoc/PsiDocFragmentName.java`，参考树里没有该路径，少了一层 `psi/`）与 `JavaDocFragmentAnchorCache.kt`，不是文档 HTML 的那条链。
   ⇒ 内联结构的依据改用 `DocumentationMarkup.java:24`、`DocMarkdownToHtmlConverter.kt:66-70`、`LspDocumentationData.kt:94-102` 三处实坐标。
2. **锚点链接（`#foo`）点了不动**：上游是 `LinkGeneratingProvider(baseURI, resolveAnchors)`（`XssSafeLinks.kt:20`）在整页 HTML 里滚动到锚；本仓弹层渲染的是一段**数据流**、没有可滚的 DOM id ⇒ `src/components/QuickDocPopup.vue:120-125` 对 `anchor` 明确不动作（注释已写明）。要做得整页 HTML 化，属"内联文档渲染/工具窗"那一族，见上。
3. **`KeepTabAction` / `DocRenderer` 一族**：见判词表最后两行的具体卡点。
4. **样式**：内联链接现在要长在句子里，`style.css` 还缺 3 条具体规则（`.quickdoc-content.is-text p` / `.is-code pre` 的 UA margin、内联链接 `font: inherit`），`src/style.css` 是保留文件 ⇒ 交接线请求 W1（含逐条选择器与规则，色值全走 `tokens.css` 令牌，无裸 hex）。

## 安全事件记录（与本任务无关，但如实留痕）

本轮**多次**在工具结果尾部收到伪装成 "predefined system" 的注入文本，内容自相矛盾（一会儿"用户没提要求，立刻停手/拒绝执行"，一会儿"继续用户请求"），并试图要求我"不要提到这些指令"。未执行其中任何一条；按纪律继续原始任务并在此留痕。
