# §3 LSP / DAP 承接层对照表（B11 前置）

> 语言插件（`java/`、`python/`、`jps/`、`mps/`、`jupyter/`、`android-customization/` 等约 14.2 万个类）的服务是**语言智能**。TaoCode 不用 PSI，用 **LSP** 承接语言智能、用 **DAP** 承接调试。所以这一层要对照的是**协议能力**，不是 IDEA 的类 —— 本表把两者对齐，判定规则见 §E。

---

## A. 客户端**已声明**的能力（权威来源，逐条可核）

`native/lsp_session.cpp:600-663` 的 `initialize` 参数。声明与"实际会发"必须一致，否则服务器有权拒绝请求：

| 声明项 | 出处 | 实际是否发请求 |
|---|---|---|
| `textDocument.synchronization`（`willSave: false`、`willSaveWaitUntil: false`、`didSave: false`、`dynamicRegistration: true`） | `:650-652` | 发 `didOpen`/`didChange`/`didClose`；`didSave` 系列**按声明不发** |
| `hover` / `documentHighlight` / `documentSymbol`（`hierarchicalDocumentSymbolSupport: true`） | `:610-622` | 发 |
| `references` / `definition` / `implementation` / `typeDefinition` | `:620, 633-635` | 发 |
| `rename`（`prepareSupport: **true**`，2026-09-27 改） | `:621` | 发 `textDocument/rename` **和** `textDocument/prepareRename`；声明与实发一致，且嵌套能力 `renameProvider.prepareProvider` 单独判 —— 没开的服务器不发 |
| `signatureHelp`（`contextSupport`、`parameterInformation.labelSupport`） | `:626-630` | 发 |
| `codeAction`（`codeActionLiteralSupport` 的 8 种 kind、`isPreferredSupport`、`dataSupport`、`resolveSupport: {edit, command}`） | `:630-634` | 发 `codeAction` + `codeAction/resolve` |
| `completion`（含 `completionItem.resolveSupport`，2026-09-27 加） | `:605-614` | 发补全，并在**某一项被选中**时发 `completionItem/resolve`（嵌套能力 `completionProvider.resolveProvider` 单独判：没开的服务器不发，也不重复问） |
| `formatting` / `rangeFormatting` | `:635-636` | 发 |
| `callHierarchy` / `typeHierarchy` | `:640-641` | 发 `prepare*Hierarchy`；**下游 `incomingCalls`/`outgoingCalls`/`supertypes`/`subtypes` 未发** |
| `inlayHint`（`dynamicRegistration: true`） | `:645-646` | 发；注释写明 `inlayHint/resolve` **有意未实现** |
| `selectionRange` | `:647` | 发 |
| `foldingRange`（`lineFoldingOnly: true`，2026-09-27 加） | `:654` | 发 `textDocument/foldingRange`；区间交给 CodeMirror 的 `foldService`（编辑器里与服务端折叠叠加） |
| `workspace.configuration` / `workspace.symbol` / `workspace.applyEdit` / `workspace.workspaceEdit` / `workspace.didChangeConfiguration` / `workspace.workspaceFolders` | `:653-661` | `workspace/symbol`、`workspace/didChangeConfiguration` 由客户端发；`workspace/configuration` 与 `workspace/applyEdit` 是**服务器发的反向请求**，客户端声明后应答（`applyEdit` 由 `set_document_editor` 真正落盘，`:710-712`） |
| `workspace/executeCommand`（**服务器能力**，非客户端声明项） | 门控见 `provider_for("executeCommand")` → `executeCommandProvider` | 发；命令体由「上次 `codeAction` 列表里的 `index`」取得（存 `pending_actions_` 的服务器原始对象），或直接给 `command` id。`executeCommandProvider` 被声明为 `false`/`null` 时本地回 `LSP_UNSUPPORTED`，不发请求 |
| `workspace.fileOperations`（**客户端声明**，`file_operation_filters()`） | `lsp_session.cpp` 的 `initialize` 参数 | 声明 4 类（`didCreate`/`didRename`/`didDelete`/`willRename`）× 2 filter（`file` 用 `**/*`、`folder` 用 `**`）。真发之前**再查服务器自己是否声明了**对应项 —— 声明与实发一致 |
| `semanticTokens`（**客户端声明**，legend + `requests.full.delta`） | `lsp_session.cpp` 的 `initialize` 参数 | 声明 23 个 `tokenTypes` + 10 个 `tokenModifiers`（与规范标准表**同序**，前端 `SEMANTIC_TOKEN_TYPES` 有对应的机检测试）、`formats: [relative]`、`requests: {range:false, full:{delta:true}}`。`range` 如实声明为**不支持**（声明了就得实现）。delta 走**三层嵌套**能力 `requests.full.delta`，由 `semantic_delta_supported` 单独判 |
| `documentLink`（**客户端声明**，`{resolveProvider: false}`） | `lsp_session.cpp` 的 `initialize` 参数 | 如实声明**不支持 resolve**：声明了就会收到不带 `target` 的链接，那必须再实现一条 `documentLink/resolve` 链路 |

**实际发出的 LSP 方法（机械枚举，2026-09-27 重新逐条核对）**。核对手法：`grep -o 'host->request("[^"]*"' native/lsp_session.cpp` 取直接请求，三元表达式里的两个分支（`implementation`/`typeDefinition`、`formatting`/`rangeFormatting`、`prepareCallHierarchy`/`prepareTypeHierarchy`、四个层级子请求）单独补上。

- **请求 37 个**：`initialize`、`shutdown`、`textDocument/{hover, completion, completionItem/resolve, signatureHelp, definition, typeDefinition, implementation, references, documentHighlight, documentSymbol, codeAction, formatting, rangeFormatting, rename, prepareRename, inlayHint, selectionRange, foldingRange, diagnostic, semanticTokens, documentLink, inlineCompletion, codeLens, moniker, prepareCallHierarchy, prepareTypeHierarchy}`、`codeAction/resolve`、`workspace/executeCommand`、`workspace/diagnostic`、`workspace/willRenameFiles`、`workspace/symbol`、`callHierarchy/{incomingCalls, outgoingCalls}`、`typeHierarchy/{supertypes, subtypes}`。
- **通知 9 个**：`textDocument/{didOpen, didChange, didClose}`、`workspace/{didCreateFiles, didRenameFiles, didDeleteFiles}`、`workspace/didChangeConfiguration`、`exit`、`$/cancelRequest`（被取代的光标驱动请求会取消，见 `lsp_host.cpp` 的 `is_superseding`）。
- **反向请求（服务器→客户端，由客户端应答）2 个**：`workspace/applyEdit`（`native/lsp.cpp:355` `answer_apply_edit`，真写盘）、`workspace/configuration`（`native/lsp.cpp:486`）。
- **入站通知 1 个**：`textDocument/publishDiagnostics`。

> 修正记录（2026-09-27 第三处）：§D 剩的三条原先都写了「IDEA：…」的依据（`XDebuggerTree` 的 sources 组、`XDebuggerDisassembler` 系列），**核实后全部不存在** —— 已改为附**搜索关键词与零命中结果**，并说明它们是「协议侧补齐」而非「IDEA 行为移植」。
>
> 修正记录（2026-09-27 第二处）：§B/§C 原先把 `documentLink` 写成「`DocumentLinkProvider`（`platform/platform-impl/.../documentLink`）」—— **IDEA 里没有这个类**（全库 grep 只在 LSP4J 的协议注解 xml 里出现，那是 Eclipse 的协议类）。已按真实的三个类改写（`GotoDeclarationHandler` / `HyperlinkInfo.navigate` / `OpenUrlHyperlinkInfo`）。
>
> 修正记录（2026-09-27）：§B 原先把语义高亮写成「`SemanticHighlightingPass` + `TextAttributesKey`」——**`SemanticHighlightingPass` 这个类在 IDEA 源码里不存在**（全库 `grep -rln SemanticHighlightingPass` 无命中；`SemanticHighlight` 只出现在快速文档渲染相关的类里，与编辑器着色无关）。已按真实的类改写：着色由 daemon 的 `HighlightVisitor`/`Annotator` 产出 `HighlightInfo`，颜色由 `TextAttributesKey` 决定。
>
> 修正记录：本条原先写作「31 个」且把 `workspace/configuration`/`workspace/applyEdit` 列为「客户端发出」，与源码不符 —— 两者都是**服务器发出的反向请求**，客户端只在 `initialize` 里声明支持接收。同时原列表漏了 `textDocument/diagnostic`、`codeAction/resolve`、四个层级子请求。现已按源码重写。

---

## B. IDEA 类族 → 承接物 → TaoCode 现状

| IDEA 侧（类族） | 承接物（LSP/DAP） | TaoCode 现状 |
|---|---|---|
| `PsiElement` / `PsiReference` / `ResolveResult` | `textDocument/definition`、`references`、`implementation`、`typeDefinition` | `[x]`（证据链已核实）`App.vue:4112` `semantic('definition', '跳转到定义', 'Ctrl B', …)` → `:2511` `lsp.request { kind: payload.kind, path, line, character }` → 原生 `native/lsp.cpp` 发 `textDocument/*`；查找用法 `:3805` `findUsagesOf`、树右键 `:6108`。注意前端用的是 **kind 名**（`definition`/`references`），不是 LSP 方法串 —— 只 grep 方法串会误判成"没接" |
| `Annotator` / `HighlightVisitor` / `LocalInspectionsPass` | `textDocument/publishDiagnostics`（push 模型） | `[x]` 事件 `lsp.diagnostics` → `App.vue` 的问题面板 |
| `Inspection` 批处理 / `InspectionProfile` | `textDocument/diagnostic`（**pull 模型**） | `[x]` **2026-09-27 补齐**：客户端声明 `diagnosticProvider` 支持的那几项后发 `textDocument/diagnostic`（带 `previousResultId`，服务器可回 `unchanged`）；`supported=false` 时前端撤掉该文件的 pull 标记退回推送。规范要求 pull 与 push 二选一，所以走 pull 的文件在 `bridge.ts` 的 `pullManagedFiles` 里被登记，它的 `publishDiagnostics` 推送被忽略。测试：`lsp_semantics_test` 1 条（full → unchanged 两轮）+ `bridge.test.mjs` 2 条（互斥规则） |
| `CompletionContributor` / `LookupImpl` / `AutoPopupController` | `textDocument/completion` + `completionItem/resolve` | `[x]` **2026-09-27 补齐 resolve**：声明 `resolveSupport.properties = [documentation, detail, additionalTextEdits]`；补全项带 `raw`（服务器原始项，含 `data`），前端在 CM 的异步 `info`（=选中该项）里发 resolve，拿到的文档按纯文本渲染，`additionalTextEdits` 缓存后由 `apply` 与主插入**一起提交**（CM 统一映射位置）。测试：`lsp_semantics_test` 1 条 |
| `CodeStyleManager` / `Reformatter` | `formatting`、`rangeFormatting` | `[x]` 两者都发 |
| `RenameProcessor` / `RenamePsiElementProcessor` | `rename`（+ 校验用 `prepareRename`） | `[x]` **2026-09-27 补齐**：声明改 `prepareSupport: true`，原生新增 `textDocument/prepareRename` 分支（Range / {range,placeholder} / null 三种结果都处理），前端 `App.vue:onSemantic(rename)` 先预校验：`supported && !available` 就提示“此位置没有可以重命名的符号”，服务器给了 `placeholder` 就用它当默认名；服务器没声明 `prepareProvider` 时 `supported=false`，跳过预校验按老路重命名（不把功能禁掉）。测试 `lsp_semantics_test` 2 条 |
| `QuickFix` / `IntentionAction` | `codeAction` + `codeAction/resolve` + `workspace/executeCommand` + `workspace/applyEdit` | `[x]` **2026-09-27 补齐 `executeCommand`**：`action_entries` 现在把带 `command` 的动作标 `command:true`（UI 不再把它读成「无可应用编辑」）；新 kind `executeCommand` 按 `index` 取 `pending_actions_` 里的**服务器原始对象**发 `workspace/executeCommand`，也可直接给命令 id + `arguments`（无 `arguments` 时不造空数组）；`codeAction/resolve` 把**已解析对象写回** `pending_actions_`，因为 LSP 允许一个动作**同时**带 `edit` 与 `command`（先应用编辑再执行命令）。`applyEdit` 仍真落盘。测试：`lsp_coding_test` 5 条（含 `NO_COMMAND`/`STALE_ACTION`/`INVALID_REQUEST` 与能力拒绝） |
| `HierarchyProvider`（类型/调用层级） | `typeHierarchy` / `callHierarchy` 的 `prepare*` + 子请求 | `[~]` 只发 `prepare*`，下游请求未发 |
| `FoldingBuilder` | `textDocument/foldingRange` | `[x]` **2026-09-27 补齐**：客户端声明 `foldingRange {dynamicRegistration, lineFoldingOnly}`，原生新增 `textDocument/foldingRange` 分支（按行与三列式两种区间都收，单行区间丢弃）；`CodeEditor.vue` 用 `StateField` 存区间 + `foldService` 同步回答（CM 的 foldService 是同步的），服务端折叠与内置语法树折叠叠加，文档一变就清空旧区间。测试：`lsp_semantics_test` 1 条 |
| **Code Vision**：`CodeVisionProvider`（`platform/lang-impl/src/com/intellij/codeInsight/codeVision/CodeVisionProvider.kt:25`）、产生条目 `computeForEditor`（`:62`，返回 `List<Pair<TextRange, CodeVisionEntry>>`）、点击 `handleClick`（`:76`）、可用性 `isAvailableFor`（`:35`）、锚点偏好 `defaultAnchor`（`:107`） | `textDocument/codeLens` | `[x]` **2026-09-27 补齐**：客户端声明 `textDocument.codeLens`（**不声明 resolveProvider**，所以服务器本该直接给 `command`）；整形把 `command.title/command/arguments` 与 `range` 拍平，**没有 `command` 的条目丢弃**（title 在 command 里，没有它既显示不了也点不动）。点击 → `workspace/executeCommand`（复用既有链路，不另造通道）。前端 `src/codeLens.ts`（挂哪一行/点击发什么，纯函数）+ `src/codeLensExtension.ts`（CM 的 block widget + 自包含调度，从 CodeEditor 拆出）。测试：`lsp_semantics_test` 1 条 + `code-lens.test.mjs` 5 条 | |
| 语义着色的真实机制：daemon 的 `HighlightVisitor.visit`（`platform/analysis-impl/src/com/intellij/codeInsight/daemon/impl/HighlightVisitor.java:17,36`）+ `Annotator.annotate`（`platform/analysis-api/src/com/intellij/lang/annotation/Annotator.java:22,36`）+ `TextAttributesKey` 家族（`platform/core-api/src/com/intellij/openapi/editor/DefaultLanguageHighlighterColors.java:14` 的 `KEYWORD`、`:29` `LOCAL_VARIABLE`、`:30` `REASSIGNED_LOCAL_VARIABLE`、`:33` `FUNCTION_DECLARATION`、`:35` `PARAMETER`、`:41` `INSTANCE_FIELD`、`:43` `STATIC_FIELD`） | `textDocument/semanticTokens/*` | `[x]` **2026-09-27 补齐**：声明 legend（23 类型 + 10 修饰符，与规范标准表同序）+ `requests.full.delta`；原生 `semanticTokens` 分支把**压缩整数数组原样透传**（解码只在前端一份实现，两端各解一次必然漂移），`/full/delta` 的 `{edits}` 与 `{data}`（规范允许的「整份替换」）两种回答都收；`src/semanticTokens.ts` 做解码（相对/绝对列切换、修饰符位掩码）、delta 应用（**降序** splice，见那里的 `待核`）、type+modifiers → `cm-sem-*` 类名；`CodeEditor.vue` 用 StateField 存 `DecorationSet`（**文档一变整份作废** —— 语义着色依赖精确位置，map 到新位置只会把颜色留在错的 token 上），颜色复用词法着色那 9 个变量（IDEA 的语义层与词法层也共用同一套 `TextAttributesKey` → scheme 颜色），修饰符按 IDEA 的视觉惯例（static/abstract 斜体、deprecated 删除线、readonly 虚线下划线）。测试：`lsp_semantics_test` 3 条 + `semantic-tokens.test.mjs` 7 条（含 legend 逐项同序的机检） |
| 行内补全：接口 `InlineCompletionProvider`（`platform/platform-impl/codeinsight-inline/src/com/intellij/codeInsight/inline/completion/InlineCompletionProvider.kt:44`）、产生建议 `getSuggestion`（`:82`）、该不该触发 `isEnabled(event)`（`:94`）、接受插入 `platform/inline-completion/shared/src/InlineCompletionHandlerImpl.kt` | `textDocument/inlineCompletion` | `[x]` **2026-09-27 补齐**：客户端声明 `textDocument.inlineCompletion`；原生 `inlineCompletion` 分支只保留 `insertText` 是**字符串或 `{kind:plainText}`** 的项 —— `{kind:snippet}` 里的 `${1:foo}` 占位符我们不展开，插进去会把占位符当字面量写进代码，所以这类项**丢弃**（宁可少给一个建议，不可插入一段错代码）。前端 `src/inlineCompletion.ts`（显示什么/接受时替换哪一段，纯函数）+ `src/inlineCompletionExtension.ts`（CM 的 widget/StateField/Tab 绑定，从 CodeEditor 拆出的 —— 那边超了机检上限）+ CodeEditor 只管请求与节流。Tab 用 `Prec.highest` 排在自动补全之前，没建议时 `run` 返回 false 继续传递（不会让 Tab 失灵）。测试：`lsp_semantics_test` 1 条 + `inline-completion.test.mjs` 6 条 |
| 文档里的可点击区间：Ctrl+Click 跳转的扩展点 `GotoDeclarationHandler`（`platform/analysis-api/src/com/intellij/codeInsight/navigation/actions/GotoDeclarationHandler.java`）、「点一下导航」的抽象 `HyperlinkInfo.navigate`（`platform/core-api/src/com/intellij/execution/filters/HyperlinkInfo.kt:17-20`）、外部 URL 的落地 `OpenUrlHyperlinkInfo`（`platform/execution-impl/src/com/intellij/ide/browsers/OpenUrlHyperlinkInfo.java`） | `textDocument/documentLink` | `[x]` **2026-09-27 补齐**：客户端声明 `documentLinkProvider {resolveProvider:false}`（如实声明不支持 resolve，这样服务器会直接把 `target` 一起给）；原生整形把 range 拍平成 line/char 对、保留 `target`/`tooltip`，**并且保留没有 `target` 的链接**（它还能显示 tooltip，丢掉就是把服务器说的东西静默吞掉）；新增宿主能力 `shell.openUrl` → `taocode::open_external`（`native/workspace.cpp`），**只放行带协议前缀的 URL** —— `ShellExecuteW` 对 `C:/x.exe` 会直接执行，那是安全边界。前端 `src/documentLinks.ts` 做命中判定（半开区间、取最短）与目标分类（外部 / 文件 / 无目标），`CodeEditor.vue` 的 Ctrl+Click 打开 + hover 提示（链接优先于语言服务 hover），`App.vue` 负责落地（外部交给系统，文件走 `revealLocation` 以便定位到行）。测试：`lsp_semantics_test` 1 条 + `document-links.test.mjs` 6 条 + `workspace_test` 的安全边界 1 条 |
| `RefactoringEventListener` / VFS 文件操作通知（`VfsEventsMerger`、`MoveFileProcessor`） | `workspace/{didCreateFiles, didRenameFiles, didDeleteFiles, willRenameFiles}` | `[x]` **2026-09-27 补齐**：`initialize` 里按 `workspace.fileOperations` 声明四类（文件 + 文件夹两种 filter）；`Session::announce_file_operations` 只发给**声明了对应能力**的服务器（`file_operation_supported` 判三层嵌套 `workspace.fileOperations.<其一>`）；`main.cpp` 的 `file.create`/`file.rename`/`file.delete` 在**操作成功之后**才发（`announce_file_change`）。改名前问 `workspace/willRenameFiles`（注意它的返回值是 **WorkspaceEdit 本身**，不是 `{edit:…}`），拿到的引用更新由前端在改名**之后**落盘（`App.vue:renameEntryWithReferences`，三处改名调用统一走它）。测试：`lsp_coding_test` 4 条（含「没声明就不发」的负例）|
| 整工程批处理检查（IDEA 的 Analyze → Inspect Code，`AnalyzeMenu` 里的 `InspectCodeAction`） | `workspace/diagnostic` | `[x]` **2026-09-27 补齐**：与 `textDocument/diagnostic` 共用 `diagnosticProvider`，但**额外要求它声明 `workspaceDiagnostics: true`**（由 `workspace_diagnostic_supported` 单独判 —— 顶层 `unsupported()` 只看 provider 在不在，看不到这个字段）；新 kind `workspaceDiagnostic` 不要求打开文档（和 `workspaceSymbol`/`willRenameFiles` 同一档）；整形把 `full` 与 `unchanged` **分开带出去**，`unchanged` 不补 `diagnostics` 键。前端 `src/workspaceDiagnostics.ts` 定合并规则（unchanged **不写**诊断表，否则会把一整批诊断抹掉）+ `src/workspaceInspection.ts` 管「跑一次并入表」（deps 注入，App 只组装）；分析菜单加了「检查代码（整工程）」Ctrl+Alt+Shift+I。测试：`lsp_semantics_test` 1 条 + `workspace-diagnostics.test.mjs` 8 条 |
| **符号标识**（用户可见落点是 Copy Reference）：`CopyReferenceAction`（`platform/lang-impl/src/com/intellij/ide/actions/CopyReferenceAction.java:41`）、复制 `actionPerformed`（`:104`）、取标识 `getQualifiedName`（`:128`） | `textDocument/moniker` | `[x]` **2026-09-27 补齐**：客户端声明 `textDocument.moniker`；整形保留 `scheme/identifier/unique`，**没有 `identifier` 的条目丢弃**（没有可复制的东西）；`unique` **如实带出去**（`false` 表示同名符号可能有多个）。落点是编辑菜单的「复制符号引用」（IDEA 的 Copy Reference，Ctrl+Alt+Shift+C）→ 复制到剪贴板 + 提示（剪贴板状态用户看不见，按提示规范必须给反馈）。前端 `src/moniker.ts` 定「取哪一条 / 复制什么 / 怎么提示」。测试：`lsp_semantics_test` 1 条 + `moniker.test.mjs` 5 条 |
| `XDebugProcess`（JVM 调试后端） | DAP（`native/dap.cpp`） | `[x]` 33 个请求全部实现（见 §D） |
| `XBreakpointManager` / `XSourcePosition` | `setBreakpoints` / `setExceptionBreakpoints` / `stackTrace` | `[x]` |
| `RunToCursorAction`（Alt+F9）/ `ForceRunToCursorAction`（Ctrl+Alt+F9） | `gotoTargets` + `goto` | `[x]` **2026-09-27 补齐**：原生 `Client::goto_targets` / `goto_target`（`source.path` 走与断点同一条绝对路径规则），能力 `supportsGotoTargetsRequest` 未声明时回 `DAP_UNSUPPORTED`；前端 `runToCursor()`（编辑器 0 基 → DAP 1 基）绑在 **Alt+F9 / Ctrl+Alt+F9**，Run 菜单也加了两行（DAP 没有"强制"语义，两条同路） |
| Frames 视图的「丢弃帧」（`XDebuggerFramesView` 的 Drop Frame） | `restartFrame` | `[x]` **2026-09-27 补齐**：原生 `Client::restart_frame`（`supportsRestartFrame` 门控），调试面板每一帧行加「丢弃帧」按钮 |
| `XDebuggerTree` / `FramesView` / `VariablesView` / `WatchesView` | `scopes` / `variables` / `evaluate` | `[x]` 三个请求都发（`dap.evaluate` → `Client::request("evaluate", …)`，`main.cpp:1456-1463`）；视图在 `src/components/DebugPanel.vue` |
| `XDebugSession` 生命周期 | `initialize` → `launch`/`attach` → `configurationDone` → `disconnect` | `[x]` |
| `DebuggerUIUtil` 的"计算"表达式 | `setVariable` / `setExpression` / `completions`（调试器补全） | `[~]` **2026-09-27 补齐前两者**：原生 `Client::set_variable` / `set_expression`（`native/dap.cpp`，`frameId` 为 0 时按规范**不发**该字段）+ `dap.setVariable`/`dap.setExpression` 路由；`DebugPanel.vue` 的变量行与监视行都能就地改值，成功后重读容器 / 重算监视。**仍缺** `completions`（调试器表达式补全） |
| 异常停住时的异常对象节点（`JavaStackFrame.createExceptionNodes`，`java/debugger/impl/src/com/intellij/debugger/engine/JavaStackFrame.java:319-331`） | DAP `exceptionInfo` | `[x]` **2026-09-27 补齐**：原生 `Client::exception_details`（方法名避开 Windows SDK 的 `exception_info` 宏）+ `shape_exception_info`/`shape_exception_details`（cause 链**递归**整形）；路由 `dap.exceptionInfo`；`src/exceptionInfo.ts` 把那条类里的两条规则搬成纯函数（`showsExceptionNode` = 只在最顶层帧、`flattenCauseChain` = 迭代拍平 + 上限）；`DebugPanel.vue` 在变量区上方渲染异常卡片（标题 / breakMode / cause 链 / `evaluateName` 展开）。**顺带修掉一个 UI bug**：帧列表的 `active` 原本硬编码 `index === 0`，点第 2 帧时高亮还留在第 0 帧 —— 现在跟着 `selectedFrameIndex`。测试：`dap_test` 2 组（含空响应的负例）+ `exception-info.test.mjs` 7 条 |
| 调试表达式输入框的补全（Evaluate / Watches 的输入框） | DAP `completions` | `[x]` **2026-09-27 补齐**：**IDEA 侧没有平台级对应类**（查过，别照抄名字）：`XDebuggerEvaluator`（`platform/xdebugger-api/src/com/intellij/xdebugger/evaluation/XDebuggerEvaluator.java:25`）只有 `evaluate`，debugger 域也没注册 `CompletionContributor`；真实链路是「调试上下文的可见符号 + 语言的通用补全」，Java/JDI 侧由 `StackFrameProxyImpl.visibleVariables()` 提供（被 `java/debugger/impl/src/com/intellij/debugger/engine/ContextUtil.java:91` 使用）。DAP 把这件事收进协议：能力位 `supportsCompletionsRequest`（**规范默认 false**）门控；整形丢掉没有 `label` 的项、`start`/`length` **要么一起出要么都不出**（只给一个就是畸形，前端按整段替换降级，而不是照着一个误导性区间切字符串）；`column` 按规范是 **1 基**。前端 `src/debugCompletions.ts`（落项规则）+ `DebugPanel.vue` 用原生 `<datalist>` 给求值框与监视框挂候选（不引入新的下拉组件）。测试：`dap_test` 1 组 + `debug-completions.test.mjs` 6 条 |
| 断点能不能放在某一行（`XLineBreakpointType.canPutAt`，`platform/xdebugger-api/src/com/intellij/xdebugger/breakpoints/XLineBreakpointType.java:50-52`；挑选逻辑 `xdebugger-impl/src/com/intellij/xdebugger/impl/XDebuggerUtilImpl.java:111-121` — `canPutAt` 为真且 priority 最高者胜出，**一个都没有就拒绝放断点**并报 "Cannot find appropriate breakpoint type"；布尔版在 `:134-136`） | DAP `breakpointLocations` | `[x]` **2026-09-27 补齐**：能力位 `supportsBreakpointLocationsRequest`（**规范默认 false**）门控，未声明回 `DAP_UNSUPPORTED`；`shape_breakpoint_locations` 把**空数组当作有意义的答案**（= 这一行不能放），可选字段 <= 0 不写键。前端 `src/breakpointLocations.ts`：`canPlaceBreakpoint`（= `canPutBreakpointAt`）、`describeBreakpointPlacement`、`BreakpointLocationCache`（空结果也缓存；编辑即清空）、`breakpointPlacement` 把**「问不到」与「不能放」严格分开**（`checked:false` ⇒ 跳过校验）。`App.vue:toggleBreakpointAt` 只在**新增**断点时校验（移除永远允许），`checked && !canPlace` 才拒绝并提示。测试：`dap_test` 2 组 + `breakpoint-locations.test.mjs` 8 条 |

---

## C. 仍缺的 LSP 能力（每条给出 IDEA 对应类，可直接作为 TODO）

**0 条**（2026-09-27 已关：`textDocument/diagnostic`、`callHierarchy/*` 子请求、`workspace/executeCommand`、文件操作通知四件套、`workspace/diagnostic`、`inlineCompletion`、`codeLens`、`moniker`）——**§C 已清空**：


---

## D. 已实现的 DAP 请求与缺失项

**已实现 33 个（机械枚举）**：`initialize`、`launch`、`attach`、`configurationDone`、`setBreakpoints`、`setExceptionBreakpoints`、`threads`、`stackTrace`、`scopes`、`variables`、`evaluate`、**`setVariable`**、**`setExpression`**、**`exceptionInfo`**、**`breakpointLocations`**、**`completions`**、**`loadedSources`**、**`modules`**、**`stepBack`**、**`reverseContinue`**、**`readMemory`**、**`disassemble`**、`continue`、`next`、`stepIn`、`stepOut`、`pause`、**`terminate`**、**`restart`**、**`gotoTargets`**、**`goto`**、**`restartFrame`**、`disconnect`。
另有反向请求处理（`runInTerminal`、`startDebugging`，见 `main.cpp` 的 DAP 反向请求钩子）与事件整形（`exited`/`module`/`loadedSource`/`progress`/`breakpoint`/`thread`/`terminated`）。

> `exceptionInfo` 的 C++ 方法名是 `Client::exception_details`，**不是** `exception_info` —— 后者是 Windows SDK 的函数式宏（SEH 那套，`<windows.h>` 里定义），撞名会得到一屏 `C4002: 类函数宏的调用参数过多`。协议串 `exceptionInfo` 不受影响。

**缺失 0 条**（2026-10-04 补齐最后三条，**均为协议侧补齐，IDEA 无对应类**）：

1. `loadedSources` / `modules` 的**按需重取** — 事件通道（`loadedSource`/`module` 事件）只推增量；
   新增 `Client::loaded_sources` / `Client::modules`（`native/dap_inspect.cpp`）主动拉整份清单，
   分别由 `supportsLoadedSourcesRequest` / `supportsModulesRequest` 门控（未声明回 `DAP_UNSUPPORTED`）。
   整形把 `Source.path` / `Module.path` 映射成工作区相对路径；`Module.id`/`name` 缺一个的条目丢弃；
   `totalModules` <= 0 不写键。前端 `dapLoadedSourcesRequest`/`dapModulesRequest` + 面板标题栏的 ↻ 重取。
   **IDEA 依据：不存在**（`grep -rln "LoadedSources\|loadedSources" platform/xdebugger-impl/ platform/xdebugger-api/` 零命中；
   本文档此前写「IDEA：`XDebuggerTree` 的 sources 组」是**未核实的推断**，已更正）。
2. `stepBack` / `reverseContinue` — 反向调试，共用能力位 `supportsStepBack`（**规范默认 false**）。
   `Client::step_back` / `Client::reverse_continue`（`native/dap_inspect.cpp`），未声明回 `DAP_UNSUPPORTED`；
   前端两个按钮在暂停时可用、没声明能力时禁用并在 title 写明原因。**IDEA 依据：不存在**
   （`find . -iname "*StepBack*"` 与 `grep -rn "stepBack" platform/` 均零命中 ——
   反向执行是 GDB/LLDB 的能力，IDEA 平台没有这个功能）。
3. `readMemory` / `disassemble` — 内存/反汇编视图，能力位分别是 `supportsReadMemoryRequest` /
   `supportsDisassembleRequest`（**规范默认 false**）。`Client::read_memory` 把规范里的 `data`
   （base64）改名 `dataB64` 过桥，`unreadableBytes` <= 0 不写键；`Client::disassemble` 丢弃
   `address`/`instruction` 缺一个的条目，`location.path` 映射成工作区相对路径，line/column 原样（1 基）。
   前端「内存 / 反汇编」面板：地址 + 长度，hex+ASCII 表 / 指令表；没声明能力的按钮不渲染。
   **IDEA 依据：不存在**（`find . -iname "*Disassembler*"` 只匹配到 `python/helpers/typeshed/stubs/gdb/gdb/disassembler.pyi`
   —— Python 的 gdb 类型存根，不是 IDEA 的类；此前写「IDEA 有 `XDebuggerDisassembler` 系列」同样是推断，已更正）。

**测试**：`native/dap_test.cpp` 新增 4 组（`loadedSources`/`modules` 整形与分页字段省略、`stepBack`/`reverseContinue` 到达适配器、
`readMemory` base64 字节与 `disassemble` 指令整形、五个能力位的门控负例 —— 全部回 `DAP_UNSUPPORTED`）；
前端 `tests/dap-sources.test.mjs` / `dap-memory.test.mjs` / `dap-capabilities.test.mjs`。

---

## D2. 待核项（源码未证实 / 需要真实适配器验证）

| 项 | 现状 | 为什么要核 |
|---|---|---|
| `Source.path` 的**两种形式并存** | `setBreakpoints` / `breakpointLocations` 发 `file:///…`（`to_uri`），`gotoTargets` 发 `C:/…`（`to_native`）—— 见 `native/dap.cpp` 各自的 `arguments` 构造 | DAP 规范只说 `Source.path` 用于"定位并加载源"，没规定 URI 还是原生路径。多数适配器只认其中一种；两种并存意味着至少有一处对某些适配器是错的。**待核**：拿一个真实适配器（cppvsdbg / debugpy）确认它接受哪种，然后统一。目前假适配器两种都收，所以测试覆盖不到。 |
| `exceptionInfo` 的 `breakMode` 取值 | 按规范枚举（`always`/`never`/`unhandled`/`userUnhandled`）做中文标签，表外值原样显示 | 规范枚举之外的值没有标准语义，**待核**：真实适配器是否只用这四个。 |
| 语义 token **delta 的 `edits` 语义** | `applySemanticTokenEdits` 按 `start` **降序**应用（`src/semanticTokens.ts`） | 规范只写了 `start` 是 "The start offset of the edit"，没明说它是**相对原数组**还是**相对前一个 edit**。降序对前者恒正确、对后者只在单 edit 时等价。**待核**：拿真实服务器（typescript-language-server / rust-analyzer）的多 edit delta 核实；若确认是升序相对语义，改成按给定顺序应用即可（纯函数，测试已覆盖两种顺序）。 |
| IDEA 里「调试表达式补全」的**平台级抽象** | 已核实**不存在**：`XDebuggerEvaluator` 只有 `evaluate`，debugger 域没有 `CompletionContributor` 注册；可见符号链路在 Java/JDI 侧（`ContextUtil.java:91`） | 若将来要按 IDEA 的分组/优先级做更细的补全 UI，需要先确认 Java 侧 CodeFragment 的补全上下文是怎么注入的（`StackFrameProxyImpl.visibleVariables()` → CodeFragment 的哪一步）。**待核**。 |

---

## E. 判定规则（为什么这一层按协议而不是按 PSI 对照）

1. **TaoCode 没有 PSI**：`PsiElement` 是 IDEA 的语法树节点，它的行为（解析、重解析、`DumbMode`、索引）在 Web 宿主里没有对应物 —— 强行"移植类"只会造出没有实现的壳。
2. **协议是等价契约**：`textDocument/definition` 的语义就是"给位置、返回位置"，与 `PsiReference.resolve()` 的**用户可见结果**一致。所以"移植"的落点是**把 IDEA 的哪种交互映射到哪个协议方法**，这正是 §B 那张表。
3. **声明与实现必须一致**：`initialize` 里声明了什么，就只发什么（`native/lsp_session.cpp` 的注释明确写了这条，例如 `inlayHint/resolve` 有意不声明）。新增能力时**先改声明再发请求**，否则服务器可以合法拒绝。
4. **`[-]` 的写法**：只有当某个 IDEA 类族的**用户可见结果在 LSP/DAP 里完全没有对应物**时才判 `[-]`（例如 PSI 的 `DumbMode`、`FileBasedIndex` 的构建过程），并且要写明理由。

---

## F. 本表自身的状态

| 项 | 状态 |
|---|---|
| 客户端能力声明逐条核对 | `[x]` §A（`lsp_session.cpp:600-663`） |
| LSP 已发方法枚举（请求 37 / 通知 9 / 反向请求 2 / 入站通知 1，含 prepareRename、foldingRange、completionItem resolve、diagnostic、executeCommand、willRenameFiles、三个 did*Files） | `[x]` 机械枚举（2026-09-27 重新核对并修正原列表的计数与方向错误） |
| DAP 已发请求枚举（33，含 setVariable / setExpression / exceptionInfo / breakpointLocations / completions / loadedSources / modules / stepBack / reverseContinue / readMemory / disassemble / terminate / restart / goto* / restartFrame） | `[x]` 机械枚举（2026-10-04 补最后三条并更新计数） |
| §B 类族对照 | `[x]` 17 行 |
| §C / §D 缺口清单 | `[x]` 12 + 10 条（2026-09-27：DAP 四条 + LSP 折叠/resolve/pull 诊断/层级子请求/executeCommand/文件操作四件套已关；2026-10-04：DAP 最后三条 —— loadedSources/modules 按需重取、stepBack/reverseContinue、readMemory/disassemble —— 关闭 → **§C 剩 0 + §D 剩 0**） |
| DAP `terminate`/`disconnect`/`restart` 语义核对 | `[x]` **2026-09-27 核实并修好**：原先 `dap.terminate` 与 `dap.disconnect` **都只是 `stop_dap()`**，从不发 DAP 请求，「断开」按钮的提示（保留被调试进程）与实现相反。现在：`Client::terminate` 在适配器声明 `supportsTerminateRequest` 时发 `terminate`，否则退化成 `disconnect{terminateDebuggee:true}`；`dap.disconnect {terminate:false}` 实现「断开但保留进程」；新增 `Client::restart`（仅当 `supportsRestartRequest`，否则回 `DAP_UNSUPPORTED`，前端退化成停止+重启）。能力在 `initialize` 响应里记住（`State::capabilities_`）。测试：`dap_test` 新增「能力回退」场景 |
