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
| `rename`（`prepareSupport: **false**`） | `:621` | 发 `textDocument/rename`，**不发 `prepareRename`**（与声明一致） |
| `signatureHelp`（`contextSupport`、`parameterInformation.labelSupport`） | `:626-630` | 发 |
| `codeAction`（`codeActionLiteralSupport` 的 8 种 kind、`isPreferredSupport`、`dataSupport`、`resolveSupport: {edit, command}`） | `:630-634` | 发 `codeAction` + `codeAction/resolve` |
| `completion` | 见 `:600-610` 段 | 发（**未声明 `completionItem/resolve`**） |
| `formatting` / `rangeFormatting` | `:635-636` | 发 |
| `callHierarchy` / `typeHierarchy` | `:640-641` | 发 `prepare*Hierarchy`；**下游 `incomingCalls`/`outgoingCalls`/`supertypes`/`subtypes` 未发** |
| `inlayHint`（`dynamicRegistration: true`） | `:645-646` | 发；注释写明 `inlayHint/resolve` **有意未实现** |
| `selectionRange` | `:647` | 发 |
| `workspace.configuration` / `workspace.symbol` / `workspace.applyEdit` / `workspace.workspaceEdit` / `workspace.didChangeConfiguration` / `workspace.workspaceFolders` | `:653-661` | 全部发；`applyEdit` 由 `set_document_editor` 真正落盘（`:665-668`） |

**实际发出的 LSP 方法（28 个，机械枚举）**：`initialize`、`shutdown`、`exit`、`textDocument/{didOpen, didChange, didClose, hover, completion, signatureHelp, definition, typeDefinition, implementation, references, documentHighlight, documentSymbol, codeAction, formatting, rangeFormatting, rename, inlayHint, selectionRange, prepareCallHierarchy, prepareTypeHierarchy, publishDiagnostics}`、`workspace/{symbol, configuration, didChangeConfiguration, applyEdit}`，另加 `$/cancelRequest`（`native/lsp.cpp:334`，被取代的光标驱动请求会取消，见 `lsp_host.cpp` 的 `is_superseding`）。

---

## B. IDEA 类族 → 承接物 → TaoCode 现状

| IDEA 侧（类族） | 承接物（LSP/DAP） | TaoCode 现状 |
|---|---|---|
| `PsiElement` / `PsiReference` / `ResolveResult` | `textDocument/definition`、`references`、`implementation`、`typeDefinition` | `[x]`（证据链已核实）`App.vue:4112` `semantic('definition', '跳转到定义', 'Ctrl B', …)` → `:2511` `lsp.request { kind: payload.kind, path, line, character }` → 原生 `native/lsp.cpp` 发 `textDocument/*`；查找用法 `:3805` `findUsagesOf`、树右键 `:6108`。注意前端用的是 **kind 名**（`definition`/`references`），不是 LSP 方法串 —— 只 grep 方法串会误判成"没接" |
| `Annotator` / `HighlightVisitor` / `LocalInspectionsPass` | `textDocument/publishDiagnostics`（push 模型） | `[x]` 事件 `lsp.diagnostics` → `App.vue` 的问题面板 |
| `Inspection` 批处理 / `InspectionProfile` | `textDocument/diagnostic`（**pull 模型**） | `[ ]` 未实现（见 §C） |
| `CompletionContributor` / `LookupImpl` / `AutoPopupController` | `textDocument/completion` | `[~]` 请求已发；`completionItem/resolve` 未声明，`additionalTextEdits` 等增量未接 |
| `CodeStyleManager` / `Reformatter` | `formatting`、`rangeFormatting` | `[x]` 两者都发 |
| `RenameProcessor` / `RenamePsiElementProcessor` | `rename`（+ 校验用 `prepareRename`） | `[~]` `rename` 已发；**`prepareRename` 未发且 `prepareSupport: false`**，所以重命名前无法预校验新名 |
| `QuickFix` / `IntentionAction` | `codeAction` + `codeAction/resolve` + `workspace/applyEdit` | `[x]` 三者齐备，`applyEdit` 真落盘 |
| `HierarchyProvider`（类型/调用层级） | `typeHierarchy` / `callHierarchy` 的 `prepare*` + 子请求 | `[~]` 只发 `prepare*`，下游请求未发 |
| `FoldingBuilder` | `textDocument/foldingRange` | `[ ]` 未实现 |
| `CodeVisionProvider` | `textDocument/codeLens` | `[ ]` 未实现 |
| `SemanticHighlightingPass` / `TextAttributesKey` | `textDocument/semanticTokens/*` | `[ ]` 未实现（前端用 CodeMirror 的词法高亮） |
| `InlineCompletionProvider`（`platform/inline-completion/`） | `textDocument/inlineCompletion` | `[ ]` 未实现 |
| `DocumentLinkProvider`（`platform/platform-impl/.../documentLink`） | `textDocument/documentLink` | `[ ]` 未实现 |
| `RefactoringEventListener` / VFS 文件操作通知 | `workspace/{didCreateFiles, didRenameFiles, didDeleteFiles, willRenameFiles}` | `[ ]` 未实现 |
| `PhpTypeProvider`-类身份（跨仓库跳转） | `textDocument/moniker` | `[ ]` 未实现 |
| `XDebugProcess`（JVM 调试后端） | DAP（`native/dap.cpp`） | `[x]` 17 个请求全部实现（见 §D） |
| `XBreakpointManager` / `XSourcePosition` | `setBreakpoints` / `setExceptionBreakpoints` / `stackTrace` | `[x]` |
| `XDebuggerTree` / `FramesView` / `VariablesView` / `WatchesView` | `scopes` / `variables` / `evaluate` | `[x]` 三个请求都发（`dap.evaluate` → `Client::request("evaluate", …)`，`main.cpp:1456-1463`）；视图在 `src/components/DebugPanel.vue` |
| `XDebugSession` 生命周期 | `initialize` → `launch`/`attach` → `configurationDone` → `disconnect` | `[x]` |
| `DebuggerUIUtil` 的"计算"表达式 | `setVariable` / `setExpression` / `completions`（调试器补全） | `[ ]` 未实现 |

---

## C. 仍缺的 LSP 能力（每条给出 IDEA 对应类，可直接作为 TODO）

1. `textDocument/foldingRange` — 折叠。IDEA：`FoldingBuilder`（`platform/lang-impl/src/com/intellij/lang/folding/`）。TaoCode 目前在编辑器里只有 CodeMirror 自带的括号折叠。
2. `textDocument/codeLens` — 代码透视（"N 个用法"/"N 个实现"）。IDEA：`CodeVisionProvider`。
3. `textDocument/semanticTokens/full` — 语义高亮。IDEA：`SemanticHighlightingPass` + `TextAttributesKey`。
4. `textDocument/inlineCompletion` — 行内补全。IDEA：`InlineCompletionProvider`（对应平台模块 `platform/inline-completion/`）。
5. `textDocument/prepareRename` — 重命名预校验（需要同时把 `rename.prepareSupport` 改成 `true`）。IDEA：`RenameProcessor` 的 `prepareRenaming`。
6. `textDocument/completionItem/resolve` — 补全项的二次解析（`additionalTextEdits`、文档）。IDEA：`CompletionResultSet` + `InsertHandler`。
7. `callHierarchy/{incomingCalls, outgoingCalls}`、`typeHierarchy/{supertypes, subtypes}` — 当前只发了 `prepare*`。
8. `textDocument/diagnostic`（pull 模型）— IDEA：`Inspection` 的批处理模式，可按需拉取而不是等服务器推。
9. `textDocument/documentLink` — IDEA：`DocumentLinkProvider`。
10. `textDocument/moniker` — 符号身份，用于跨仓库/跨语言跳转。
11. `workspace/{didCreateFiles, didRenameFiles, didDeleteFiles, willRenameFiles}` — 文件操作通知。IDEA：`RefactoringEventListener` + VFS 事件；不发这些会让服务器索引与磁盘不一致。
12. `workspace/executeCommand` — 由 `codeAction` 返回的 `command`（无 `edit` 时）需要它才能真正执行。

---

## D. 已实现的 DAP 请求与缺失项

**已实现 17 个（机械枚举）**：`initialize`、`launch`、`attach`、`configurationDone`、`setBreakpoints`、`setExceptionBreakpoints`、`threads`、`stackTrace`、`scopes`、`variables`、`evaluate`、`continue`、`next`、`stepIn`、`stepOut`、`pause`、`disconnect`。
另有反向请求处理（`runInTerminal`、`startDebugging`，见 `main.cpp` 的 DAP 反向请求钩子）与事件整形（`exited`/`module`/`loadedSource`/`progress`/`breakpoint`/`thread`/`terminated`）。

**缺失（按 IDEA 工作流的重要性排序）**：
1. `setVariable` / `setExpression` — 调试时改变量值。IDEA：`XValue.setValue` / `XDebuggerTree` 的编辑。
2. `restart` / `terminate`（作为**请求**）— TaoCode 的 `dap.terminate` 与 `dap.disconnect` 都走 `stop_dap()`（`main.cpp:1475-1478`），**没有发 DAP 的 `terminate`/`restart` 请求**；这与 IDEA 里"终止进程"与"断开但保留进程"的区别是否等价，**待核**（已登记，不算已实现）。
3. `breakpointLocations` — 断点可放置位置（编辑器 gutter 预览）。IDEA：`XLineBreakpointType`。
4. `loadedSources` / `modules` — 已加载源与模块视图。IDEA：`XDebuggerTree` 的 sources 组。
5. `exceptionInfo` — 异常详情面板。
6. `gotoTargets` — "运行到光标处"。IDEA：`RunToCursorAction`。
7. `completions`（调试器表达式补全）。
8. `stepBack` / `reverseContinue` — 反向调试。
9. `readMemory` / `disassemble` — 反汇编/内存视图（IDEA 有 `XDebuggerDisassembler` 系列）。
10. `restartFrame` — 重跑当前帧。

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
| LSP 已发方法枚举（28） | `[x]` 机械枚举 |
| DAP 已发请求枚举（17） | `[x]` 机械枚举 |
| §B 类族对照 | `[x]` 17 行 |
| §C / §D 缺口清单 | `[x]` 12 + 10 条 |
| DAP `terminate`/`disconnect` 语义核对 | `[ ]` 待核（`main.cpp:1475-1478` 两者都调 `stop_dap()`） |
