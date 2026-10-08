# batch 2026-10-06 · lane `hlregistry` — `ls/highlighting` 族「按特性注册表 + 缓存」模块侧缺项核对

> 上游基准树：`D:\Backup\Downloads\intellij-community-master\intellij-community-master`（唯一事实来源；
> `third_party/intellij-community` 坏树未用）。本地**没有** zh 本地化包 ⇒ 一切中文措辞标「无法核实」（本 lane 没新增界面文案）。
> 本 lane 可写面：`src/lspHighlightingCache.ts`、`src/semanticHighlighting.ts`、`src/documentRevisions.ts`、
> （`src/codeLensCache.ts` 在并发黑名单里点名过 `codeLens*` 两条 lane，mtime 15:45 ⇒ **本轮不动**）；
> `src/highlightFeature*` 经 `ls` 核实**不存在**，且没有可接的生产消费点 ⇒ **不新建**（理由见 §5）。

## 0. 派单头号任务（`.seq` 真缺陷）的核实结论

**结论：这条在本仓已经不成立了 —— 上一道 `codelensfix` 把它改完了，本轮核的是"还有没有残留"，答案是 0 处。**
派单原写「本仓任何还拿 `state.seq` 当修订号的地方都是真缺陷」；**实际**：`grep -rn "\.seq" src/` 全部 6 条命中，
逐条开文件看过，**没有一条是 `EditorState.seq`**：

| 命中 | 实际是什么 |
| --- | --- |
| `src/codeLensCache.ts:57`、`:60` | 注释正文（那条 lane 的订正留痕本身就在讲 `EditorState` 上没有 `seq`） |
| `src/codeLensCache.ts:222`、`:256`、`:273` | 该缓存**自己的私有字段** `seq`（`:133` 声明、`:208` 初始化），号由调用方 `semanticRevisionOf(editor.state.doc)` 供给（`src/codeLensExtension.ts:417`、`:437`、`:460`） |
| `src/codeLensExtension.ts:47` | 注释正文（同一批留痕） |

（另外 `grep -rnw "seq" src/` 还有几处同名**局部变量**，与修订号无关：`src/components/SearchPanel.vue:521-537`
的 `previewSeq` 计数器、`src/editorConfig.ts:63` 讲的 `[seq]` 是 glob 字符类。本轮一并看过，都不是 `EditorState` 的属性。）

号源核对（本轮逐条打开过）：`src/codeLensExtension.ts:417`、`:437`、`:460`、`src/editorInlayHints.ts:230`、
`:259`、`src/editorSymbolHighlight.ts:151`、`:173`、`src/editorSemanticField.ts:119`、`:147`、`:152` ——
**全部走 `semanticRevisionOf(...)`**（`src/semanticHighlighting.ts:384`，本轮改动后的行号；
CodeMirror 的 `Text` 不可变 ⇒ 对象身份即修订号，与上游 `Document.modificationStamp` 同形：
`platform/core-api/src/com/intellij/openapi/editor/Document.java:25`、`:184-185`、`:191-192`；
换号动作 `platform/core-impl/src/com/intellij/openapi/editor/impl/DocumentImpl.java:171`，
号源 `platform/core-impl/src/com/intellij/openapi/editor/impl/DocumentModStamp.java:6-12`）。

顺着这条号源路，本轮在**本模块自己家里**查出并修掉 2 条同源缺陷（见 §1 的 A1/A2）：
一处是「闸门把别人的在途标记一起抹掉」（症状 = 同一个文档版本向服务器发第二遍，正是上游
`:96-102` 要拦的那一串），一处是「pending edit 的记录条件比上游宽」。

## 1. 判词表

判定：`[x]` 已做 · `[~]` 部分（写「本仓已有」+「还差」）· `[ ]` 未做 · `[-]` 不适用（给具体理由）。
「本仓落点」是**本轮交接时**的工作区行号。

### A. `highlightingCommon`（族规本身：状态机 + 注册表）

| # | 项 | 判定 | 上游相对路径:行号 | 本仓落点 | 一句话说明 |
| --- | --- | --- | --- | --- | --- |
| A1 | 在途去重标记**按值**释放 | `[x]` 本轮补 | `platform/lsp-impl/src/impl/features/highlightingCommon/LspHighlightingCache.kt:122-131`、`:209`、`:236-238` | `src/lspHighlightingCache.ts:327`（`releaseSentStamp`）+ `:332-365`（三处 accept 都改用它） | 原来三处都无条件 `delete`，会把「为更新版本发的那一发」的标记一起抹掉 ⇒ 重复请求；现改成键值都对上才删 |
| A2 | `fileEdited` 只为真画着东西的快照记 pending edit | `[x]` 本轮补 | `LspHighlightingCache.kt:249-253` | `src/lspHighlightingCache.ts:287-300` | 上游问的是 `cachedHighlightings.isNullOrEmpty()`，本仓原来只问「有没有快照」⇒ 空快照按编辑次数无界攒 pending edit |
| A3 | `supportsPull` 这一格（推的族不参与拉取作废） | `[~]` 本轮补一半 | `LspHighlightingCache.kt:55`、`LspHighlightingCacheRegistry.kt:54-56`、`highlighting/LspPublishDiagnosticsCache.kt:31` | `src/lspHighlightingCache.ts:244-268`（属性 + 构造入参）、`src/semanticHighlighting.ts:358-364`（扇出过滤） | 注册表的**读方**本轮已生效（扇出跳过 `false` 的那条）；**写方**要等持有 push 缓存的 `src/lspNavigation.ts:217` 显式传 `supportsPull: false` ⇒ 请求 R3 |
| A4 | 按文件快照 + `docModStamp` 陈旧判定 | `[x]` 已有 | `LspHighlightingCache.kt:37-84`、`:306-313` | `src/lspHighlightingCache.ts:278-312`（`pullPlan`/`highlightingsFor`）、`:205`（`STALE_DOC_STAMP`） | 首拍绕静默窗口也在（`:270` 的 `quiescenceDelayFor`，对应 `:146` + `:161-163`） |
| A5 | 静默窗口两档 250 / 300 的**数值** | `[x]` 已有 | `LspHighlightingCache.kt:321`（诊断 250，理由 `:316-320`）、`:328`（低优先级 300，`:324-327` 点名 semantic tokens / document links / folding / code lens / inlay hints / colors）、`:52`（缺省引用同一个数） | `src/lspHighlightingCache.ts:226-227` | 数值与上游同源；`codeLens` 那条 400→300 已由 `codelensfix` lane 改过（留痕在 `src/lspHighlightingCache.ts:221-225`） |
| A6 | 静默窗口的**用**：首次拉取绕开窗口 | `[ ]` 缺（不在本 lane 可写面） | `LspHighlightingCache.kt:140-155`（`settleRequestStamp`）、`:146`、`:161-163` | 模块侧 API 已有（`src/lspHighlightingCache.ts:270-272` 的 `quiescenceDelayFor()`，**生产零调用**） | 语义着色与 pull 诊断这两条的调度点在保留文件 `src/components/CodeEditor.vue:305-310`、`:352-358`，写死 400 / 350 且首拍也等 ⇒ 请求 R1 |
| A7 | `LspPullResult` Full / Unchanged / Failed | `[x]` 已有 | `highlightingCommon/LspPullResult.kt`、`LspHighlightingCache.kt:109-113` | `src/lspHighlightingCache.ts:93-97`、`:343-350` | 三态齐全，`Unchanged` 只刷号保留内容（`:192-213`）也照抄了 |
| A8 | `aggregateToPullResult`（任一文档失败 → Failed） | `[-]` 本仓形状用不上 | `codeLens/LspCodeLensCache.kt:41`、`inlayHint/LspInlayHintsCache.kt:33` 用的 `forEachDocumentInFile` + `aggregateToPullResult` | `src/lspHighlightingCache.ts:99-104`（端口还在，生产零调用） | 宿主一个 path 只开一个 LSP 文档（`native/lsp_session.cpp:40` 的 `to_uri`、`:86` 的 `doc.uri = to_uri(path)`），没有 notebook 那种「一文件多文档」，聚合恒等 ⇒ 不接线，理由写在这格 |
| A9 | `invalidate`（强制刷新：留在屏上不闪断） | `[~]` 已有实现，生产走的是整族清 | `LspHighlightingCache.kt:282-303`、`LspClientImpl.kt:242-252`（`refreshInlayHints` 逐文件 `invalidate`）、`:235-240`（`refreshSemanticTokens` 只清 tokens 那一条） | `src/lspHighlightingCache.ts:368-372` | 本仓 `workspace/…/refresh` 的分派是**一次 `clearAllLspCaches()` 清整族**（`src/lspPerFileCache.ts:36-40` 自己记了这条差异），代价 = 别的族也多问一次；逐族清已提请求 R4 |
| A10 | 按特性注册表九条 + 三条扇出 | `[~]` 本轮补过滤，登记面仍只 1 条 | `LspHighlightingCacheRegistry.kt:23-56`（`:26-35` 九条具名缓存、`:42-44` `fileEdited` 扇出、`:46-48` `clearCache`、`:54-56` 只扇 `supportsPull`） | `src/semanticHighlighting.ts:305-364` | 本仓表里目前只有 `semanticTokens` 一条（`:374-375` 那份），`editorSemanticField.ts:143` 的注释自己就写着这件事；其余八条的实例都在**别人的文件**里 `new`（见 §6「卡在哪一环」），本轮先把 `supportsPull` 这道过滤做对并登记入表形状放宽（结构类型），使 R3 一接就通 |
| A11 | 注册表的 `fileEdited` 扇出 | `[ ]` 缺 | `LspHighlightingCacheRegistry.kt:42-44` + `LspClientImpl.kt:213-221`（注释 `:217-219` 明写不做的后果：「编辑之前应用上的高亮会一直停在旧偏移上」） | 单点已有：`src/lspNavigation.ts:243`（push 诊断那一族） | inlayHint 那一族的快照**从不**收 pending edit（`src/editorInlayHints.ts:171` 的实例没人喂 `fileEdited`）⇒ 编辑后旧提示停在改前偏移，直到新答案落地；持有方文件是黑名单 ⇒ 请求 R2 |
| A12 | `forceFullRepull` 丢掉「可以答 unchanged」的凭据（`resultId`） | `[~]` 模块侧无凭据可丢 | `LspHighlightingCache.kt:274-280`、`highlighting/LspPullDiagnosticsCache.kt:96-110`、`:112-114` | `src/lspHighlightingCache.ts:376-378` | 本仓 `resultId` 存在调度侧局部变量（`src/components/CodeEditor.vue:299`、`:352` 的 `diagnosticIds`），不在缓存里 ⇒ 缓存的 `forceFullRepull` 只能做到「作废快照」那一半，另一半分派在保留文件 ⇒ 请求 R1 附带 |

### B. `highlighting`（逐类）

| # | 项 | 判定 | 上游相对路径:行号 | 本仓落点 | 一句话说明 |
| --- | --- | --- | --- | --- | --- |
| B1 | `LspCachedHighlighting` + 四条分支平移/裁剪 | `[x]` 已有 | `highlightingCommon/LspCachedHighlighting.kt:41-53`、`:55-87`（四条分支 `:65-68`/`:70-75`/`:77-82`/`:84-85`） | `src/lspHighlightingCache.ts:110-137` | 四条逐一照抄，判据在 `tests/lsp-highlighting-cache.test.mjs:23-41`、`:108-128` |
| B2 | publish（push）诊断：按 documentUri 分桶 + 版本闸门 | `[~]` 端口在、宿主没喂 | `highlighting/LspPublishDiagnosticsCache.kt:44-56`、`:78-88`、`:31` | `src/lspHighlightingCache.ts:426-437` | `native/lsp_support.cpp:127-152` 的 `shape_diagnostics` 不搬 `version` ⇒ 本仓 `acceptsPublishedVersion()` 无数据可判；要么宿主补 `version`（R5），要么承认「无版本闸门」这条差异（文件头 `:48-52` 已经写着） |
| B3 | 惰性 quick fix 记忆化 | `[~]` 规则在，消费方待接 | `highlighting/LspDiagnosticAndLazyQuickFixes.kt:37-54` | `src/lspHighlightingCache.ts:451-459` | 本仓 `codeAction` 的 resolve 走的是另一条（`src/semanticActions.ts`），诊断 → 修复列表目前不做「只有真要显示时才要」；判据只钉模块本体 |
| B4 | documentHighlight 单槽命中 | `[x]` 已有 | `highlighting/LspDocumentHighlightCache.kt:6-11` | `src/lspHighlightingCache.ts:469-471` + 生产消费 `src/editorSymbolHighlight.ts:74` | 光标在同一条引用上来回挪不再重发 |
| B5 | `TextRangeAndHighlightKind` | `[x]` 已有 | `highlighting/TextRangeAndHighlightKind.kt`（18 行） | `src/lspHighlightingCache.ts:474-476` | 形状转换，区间可达性由调用方判 |
| B6 | `LspHighlightingApplier`（不走 daemon 的反应式上色 + 每文件代号去重） | `[~]` 分散等价物 | `highlighting/LspHighlightingApplier.kt:47-60`（类注释：serializes dispatcher + per-file generation counter 丢掉被取代的那一拍） | `src/annotatorHighlightLayer.ts`、`src/editorSemanticField.ts:134-165`、`src/editorSymbolHighlight.ts:151-177` | 本仓每族各自「按修订号判陈旧」，**没有**那一个「每文件代号」的统一闸；跨族排序（谁先画）因此不成体系 ⇒ 记在 §6，不改别人的文件 |
| B7 | `LspHighlightingPass` / `PassFactory`（daemon pass 的接线） | `[-]` 架构没有这一层 | `highlighting/LspHighlightingPass.kt`（94 行）、`LspHighlightingPassFactory.kt`（49 行） | — | 本仓无 `HighlightingPass`/`DaemonCodeAnalyzer` 体系，上色走 CodeMirror `StateField` + 主动拉取；等价用户行为（改完字上色跟着走）已由 B1/A4/`remapHighlightRanges` 覆盖 |
| B8 | `LspProblemFileHighlightFilter` | `[-]` 等价物在另一族 | `highlighting/LspProblemFileHighlightFilter.kt`（18 行） | `src/problems.ts` / 标签条与树的问题标记（非本 lane 可写面） | 上游这一条是「哪些文件在编辑器标签上显示问题色」的过滤器，本仓那一条挂在 problems/标签族名下，不在 `ls/highlighting` 的注册表里 |
| B9 | `LspSemanticTokensCache`：请求前后比号、legend 缺失即 Failed、越界 token 整条丢 | `[x]` 已有 | `highlighting/LspSemanticTokensCache.kt:29-36`、`:39`、`:40-41`、`:51-54`、`:102-105` | `src/semanticHighlighting.ts:239-246`（`plan`）、`:263-268`（`tokensFor` 修订不符即 null）、`src/semanticTokens.ts` 解码 | 判据在 `tests/semantic-highlighting.test.mjs:107-126`、`:130-149` |
| B10 | `LspSemanticTokensCache.plan` 的**在途去重**（同修订不重发） | `[ ]` 缺 | `LspHighlightingCache.kt:40`（`fileToStampWhenRequestSent`）、`:95-102`（同版本只发一次的注释） | `src/semanticHighlighting.ts:240-246`（`plan`）只有 `cached`/`request` 两档，没有 `dedup` | 而且 `plan()`/`capabilityDeclared()`/`noteServerDeclined()` 三个口**生产零调用** —— 语义着色的拉取点在保留文件 `src/components/CodeEditor.vue:311-334`，它每次都发、只看 `result.available` ⇒ 请求 R1（同一处一并补 `lspFileFeatures.plan('semanticTokens', …)` 那道逐文件闸，与 `src/editorInlayHints.ts:235` 同形） |

### C. 其余按特性缓存（注册表里另外几条）

| # | 特性 | 判定 | 上游 | 本仓落点 | 一句话说明 |
| --- | --- | --- | --- | --- | --- |
| C1 | inlayHint | `[~]` | `inlayHint/LspInlayHintsCache.kt:17-39`（`isSupportedForFile` 三条、`onResponseReceived` → `LspInlayApplier.scheduleRefresh`） | `src/editorInlayHints.ts:171`（缓存实例）、`:238`（`pullPlan`）、`:259`（接受闸门）、`:277`（refresh 补刷） | 快照 + 逐文件闸 + refresh 都有；**缺** `fileEdited`（A11）与入表（A10）⇒ R2/R3 |
| C2 | codeLens | `[x]` 已有（他道） | `codeLens/LspCodeLensCache.kt:14-46`（含 `:23-37` 的 `resolveProvider` 逐条 resolve） | `src/codeLensCache.ts:130-278`、`src/codeLensExtension.ts:417-460` | 本轮**未动**（并发黑名单 + mtime 15:45）；它的 `resolve` 那一半在 `src/semanticActions.ts` 的 codeActionResolve 通道里另有落点 |
| C3 | documentLink | `[ ]` 无缓存 | `highlighting/LspDocumentLinkCache.kt:17-35` + `:38-53`（`LspDocumentLink.resolveDocumentLink` 惰性补 target） | `src/documentLinks.ts`（本地 URL 识别回退，无按文件快照） | 上游把 link 归在 300ms 那一族（`:324-327`）并缓存按文件；本仓每次现问 ⇒ 不属本 lane 可写面，也未新建模块（§5） |
| C4 | foldingRange | `[ ]` 无缓存 | `folding/LspFoldingRangeCache.kt:20-38`（60 行，同族 300ms） | `src/editorFoldingController.ts:42`（`debounceMs ?? 400`，且 `CodeEditor.vue:336-348` 没传 ⇒ 实跑 400）、`src/editorFolding.ts` | 数值与上游 300 不同源且**不是常量引用** ⇒ 请求 R1b（`src/editorFoldingController.ts:42` 一处默认值） |
| C5 | documentColor | `[ ]` 无拉取面 | `inlayHintColor/LspDocumentColorCache.kt:18-33` | `src/lspServerMessages.ts:307` 认得这条注册通知，但没有取色请求 | 本仓 `colorProvider` 没有宿主 kind（`native/lsp_support.cpp:238` 一带的 kind 表里没有）⇒ 接不上去，标 `[ ]` 并写进 §6 |
| C6 | inheritanceMarkers | `[-]` 本仓无这一族 | `lineMarkers/LspInheritanceMarkersCache.kt:33-56`（`:53-54` 把这一族的窗口单独放宽到 1000ms：`lsp.inheritance.markers.quiescence.ms`） | — | 本仓没有「方法行 ∩/△ 覆写标记」那一条 gutter 族；不适用，不是漏项 |
| C7 | pullDiagnostics | `[~]` | `highlighting/LspPullDiagnosticsCache.kt:26-30`（唯一显式 override 成 250 的一条）、`:96-114` | `src/components/CodeEditor.vue:352-374`（发 `kind:'diagnostic'` + `previousResultId`、认 `kind==='unchanged'`） | 请求侧真在跑，但 250 与「首拍绕窗口」都没接上（R1），且结果不进 `HighlightingSnapshotCache`（本地重锚走 `src/lspNavigation.ts:217` 那一实例） |

## 2. 改动文件清单（`wc -l` 前后）

「接手时」= 本轮第一次打开该文件时的工作区行数（含他道未提交改动）；HEAD 一并给，方便主代理核对归属。

| 文件 | HEAD | 接手时 | 交出时 | 本轮做了什么 |
| --- | --- | --- | --- | --- |
| `src/lspHighlightingCache.ts` | 312 | 390 | **482** | A1 在途标记按值释放（新增私有 `releaseSentStamp`，三处 accept 改用它；`acceptFailed` 加**可选** stamp 形参，不传即维持旧行为，未Ready 的调用点走请求 R2）；A2 `fileEdited` 记录条件收紧 + `pendingEditCount()` 观察口；A3 `supportsPull` 属性与构造入参；文件头三条订正留痕（`.seq` 实况、`contentStamp` ≠ 上游那颗号、`shape_diagnostics` 不带 version）；两处假锚点订正：① 分派点 `lspProgress.ts` → `src/lspServerMessages.ts` 的 `handleRefresh`（与 `src/lspPerFileCache.ts:36-38` 已记的同一事）；② `forceFullRepull` 的注释原引 `LspHighlightingCache.kt:230-236`（那一段是 `applyServerHighlightings`），实际基类实现在 `:274-280`，而「连可以答 unchanged 的凭据一起丢弃」那一半在子类 override `highlighting/LspPullDiagnosticsCache.kt:100-110` |
| `src/semanticHighlighting.ts` | 354 | 354 | **392** | A10：注册表条目加 `supportsPull`，`invalidatePulledResults` 按上游 `:54-56` 过滤并返回**真的作废了几条**（原来返回表的大小，过滤生效后就必须区分）；`registerHighlightingFeature` 的参数从具体类放宽成结构类型（否则第二族永远进不了表）；表头注释补上游三条扇出的坐标 |
| `tests/lsp-highlighting-cache.test.mjs` | 165 | 160 | **241** | 新增 4 条判据（A1×2、A2、A3） |
| `tests/semantic-highlighting.test.mjs` | 235 | 235 | **265** | 新增 1 条判据（A10 扇出过滤），并补 `invalidatePulledResults` 的 import |
| `docs/batch-2026-10-06-hlregistry.md` | — | — | 本文件 | 交付 |
| `docs/wiring-requests-2026-10-06-hlregistry.md` | — | — | 另一份 | 需要主代理接的线（R1/R1b/R2/R3/R4/R5） |

未新建模块：`src/highlightFeatureRegistry.ts` / `src/inlayHintCache.ts` 都**没建**（理由见 §5）。
`git diff` 自查：本轮 4 个文件的 hunk 全部落在这四处改动上；同文件里他道的未提交段落（如 `:33-47` 那段
`LspCachedHighlighting.kt:38-80` 的留痕）是**上一道 lane 的在途内容**，本轮一字未重排。

## 3. §5 每条自查命令的前后数字

| 命令 | 改前 | 改后 |
| --- | --- | --- |
| `node --test tests/*highlight*.test.mjs tests/*lsp*.test.mjs tests/code-lens*.test.mjs tests/module-size.test.mjs` | **257 tests / 257 pass / 0 fail** | **269 tests / 269 pass / 0 fail**（本 lane +5；余下 +7 是他道并发新增，原始数字未逐条归因） |
| ┗ 子集 `tests/lsp-highlighting-cache.test.mjs tests/semantic-highlighting.test.mjs` | 21 / 21 / 0 | **26 / 26 / 0** |
| ┗ 子集（三个高亮缓存相关文件，含 `lsp-result-cache`） | 40 / 40 / 0 | 45 / 45 / 0 |
| `node .tools/find-orphan-modules.mjs --gate` | 已登记孤儿 6 / 基线 8 · 新增 0 · 本轮清掉 2 ⇒ **绿** | 同左 ⇒ **绿**（本轮没新建文件，孤儿数不变） |
| `node .tools/find-missing-ext.mjs` | 扫描 1375 个文件，干净 | 扫描 **1379** 个文件，干净（+4 是他道新增文件；本 lane 零新建源文件） |
| `node .tools/find-param-props.mjs` | 0 处 | 0 处 |
| `node .tools/find-ts-in-mjs.mjs` | 干净 | 干净 |
| 隔离 `npx tsc --noEmit -p build/tsconfig.hlregistry.json`（只圈 `lspHighlightingCache.ts` + `semanticHighlighting.ts` + `documentRevisions.ts` 及其传递 import） | — | **0 错**（exit 0、无输出）；该 config 是本轮临时件，已按规约删在 `build/` 里 ⇒ 重跑要先把 `tsconfig.json` 的 compilerOptions 原样抄进 `build/tsconfig.hlregistry.json` 并用 `"files": ["../src/<三个文件>"]`（`../../` 会解析到仓库外面去，本轮踩过一次） |
| `node --test tests/source-citations.test.mjs tests/source-citation-anchors.test.mjs` | **3 红**（11 tests / 8 pass / 3 fail，其中一条同名用例在两个文件里各计一次） | **仍 3 红，条目都不是本 lane 的**（`source-citations.test.mjs` 单跑：3 tests / 2 pass / 1 红）：① 他道在途文档 `docs/batch-2026-10-06-findrep2.md` 里转述 `ConsoleViewImpl` 的那一条上游引用，
     行号写成了越界的九位数（该文件 1730 行），本 lane 未动那份文档；
     **留痕**：本轮一开始把它的完整形状（带路径与行号）抄进了本报告，于是引用门把这条**转述**也当成一条真引用收了进去
     （`.tools/agent-rules.md:54` 警告的正是这一手），所以这里改成不带路径行号的写法；② `moved :: src/commitChecks.ts|…CommonCheckinFilesAction.kt|26-78`、`moved :: src/components/ProblemsPanel.vue|…SuppressIntentionAction.java|19-19`、`moved :: src/components/ProblemsPanel.vue|…IntentionSource.java|37-40`、`moved :: src/runStartupFocus.ts|…RunnerAndConfigurationSettings.java|242-242`（快照锚点与他道在途文件，本 lane 四个文件一条未出现在清单里） |
| `npx vue-tsc -b --force` | **未跑** | **未跑** —— 并发期全仓 0 错不可信（派单明写），改跑上面那条隔离 tsconfig；主代理收口时需全跑一次 |
| ctest / `npm run test:native` | 不适用 | 不适用：本轮**没动** `native/`（R5 只是请求，没替宿主加 `version` 字段） |

## 4. 反向验证记录（注入违规 → 红 → 撤 → 绿）

新判据 5 条，全部按 `HLREGISTRY-TEMP` 前缀注入、撤后 `grep` 归零、`sha1sum -c` 核过。

| 轮 | 注入了什么 | 红了什么 | 撤后 |
| --- | --- | --- | --- |
| 1 | ① `acceptFull` 的 `releaseSentStamp(file, stamp)` → 无条件 `this.sentStamps.delete(file)`；② `fileEdited` 的 `snapshot.cached.length === 0` 判据短路成 `&& false`；③ `invalidatePulledResults` 的 `if (!feature.supportsPull) continue` 短路成 `&& false` | `node --test tests/lsp-highlighting-cache.test.mjs tests/semantic-highlighting.test.mjs`：**26 tests / 23 pass / 3 fail** —— 红的正是「在途去重标记按值释放…」「fileEdited 只为「真的画着东西」的快照记 pending edit…」「注册表的作废扇出只给拉取族…」 | 三处逐字还原 ⇒ **26 / 26 / 0**；`sha1sum -c` 四个文件全 `OK`；`grep -rn "HLREGISTRY" src/ tests/` = **0** 条 |
| 2（补测第二组判据的独立性） | 只把 `releaseSentStamp` 的函数体改成无条件 `delete`（覆盖 `acceptUnchanged`/`acceptFailed` 两条路径） | `tests/lsp-highlighting-cache.test.mjs`：**14 / 12 / 2** —— 「在途去重标记按值释放…」+「Unchanged / Failed 同样按值释放在途标记…」同时红 | 还原 ⇒ sha1 四文件全 `OK`、残留 0、域内测试 26/26 绿 |

两轮注入还原后都跑过 `sha1sum -c`，四个文件当时全部 `OK`（即：**还原确实回到了注入前的字节**，不是"看着像"）。
之后本轮又做了两处**注释级**订正（`forceFullRepull` 的假锚点、`supportsPull` 指向的请求号），所以交出的 sha1 是：

```
1e1dec09a42083aa448efcc8e3d81906e242a182  src/lspHighlightingCache.ts
5dd16462177f0c4f03c88784b0783aa0bfb89def  src/semanticHighlighting.ts
6d1a1458d8f2640a494cd95bcfbbe3fa5295bd0a  tests/lsp-highlighting-cache.test.mjs
131cfde53d05006b20ad625d47c11a138a01608d  tests/semantic-highlighting.test.mjs
```

结论：这 5 条判据**能失败**，且失败点各自对得上被拆掉的那一条判据（不是"整片红"式的假阳性）。

## 5. 零消费方自查结论

- 本轮**没有新建源文件** ⇒ `find-orphan-modules --gate` 的新增数仍为 0（改前改后同：已登记 6 / 基线 8）。
- 为什么没建 `src/highlightFeatureRegistry.ts`（派单候选名 `src/highlightFeature*`）：
  ① 上游那张注册表的形状是「**注册表自己 new 九条缓存**」（`LspHighlightingCacheRegistry.kt:26-35`），
  本仓的九条实例散在各族自己的模块顶层（`src/editorInlayHints.ts:171`、`src/lspNavigation.ts:217`、
  `src/codeLensCache.ts` 等），新建一个叶子模块**导入它们就会成环**
  （`lspHighlightingCache.ts → registry → editorInlayHints.ts → semanticHighlighting.ts / lspHighlightingCache.ts`，
  ESM 深度优先求值时 `HighlightingSnapshotCache` 还在 TDZ ⇒ 整个测试文件加载失败）；
  ② 不导入它们，这张表就只能靠各持有方来自登记，而那些文件不是本 lane 的可写面 ⇒ 建出来是一张**空表 + 一套只有判据在调的 API**，
  正是规约第 3 条禁的「只过自己测试的死模块」。
  （**留痕订正**：本轮一开始把不成环写成硬结论，后来核过 `src/semanticHighlighting.ts:49-52` 的四个 import
  目标（`editorSemanticColors`/`lspFeatureMatrix`/`lspPerFileCache`/`semanticTokens`）**一条 import 都没有**
  ⇒ 「叶子注册表模块 + 两个缓存模块各自登记」这条路**在 import 图上走得通**，上面①那句"会成环"只针对
  「注册表反过来 import 各 feature 模块」那种写法（`lspHighlightingCache.ts → registry → editorInlayHints.ts →
  semanticHighlighting.ts` 深度优先求值时类还在 TDZ）。真正拦住本轮建表的是②：今天没有生产读者。）
  ⇒ 结论：把注册表留在已经有生产消费方（`src/editorSemanticField.ts:145` 调 `invalidatePulledResults`）的
  `src/semanticHighlighting.ts:305-364`，本轮只做「条目形状 + `supportsPull` 过滤」，登记动作以请求 R3 交出去。
- 本轮新增/改动的出口逐个核过消费方：
  `releaseSentStamp`（私有，三个 accept 调）、`pendingEditCount`（判据 + 排查口，与既有 `snapshotStamp`/`lspCacheCount`
  /`highlightingFeatureIds` 同族形状）、`supportsPull`（注册表扇出读，见 A3）、`registerHighlightingFeature`
  （生产 `src/semanticHighlighting.ts:375` + 判据两处）、`invalidatePulledResults`
  （生产 `src/editorSemanticField.ts:145`）、`acceptFailed(file, stamp?)`（新形参**可选**，现存三个调用点不改也能跑，
  传号那一步在 R2）。
- `src/documentRevisions.ts`（名下候选，存在）本轮**未改**：它的三条口径与上游逐字对齐（文件头 `:22-28`），
  生产链 `src/lspNavigation.ts:255` + `src/editorFileOps.ts:172` → `src/commitChecksResult.ts` 的账，
  判据在 `tests/commit-checks-result.test.mjs:239-252`。

## 6. 做不到 / 无法核实

1. **`quiescenceDelayFor()` 生产零调用** —— 模块侧 API 已对（首拍 0ms、其余 `quiescenceMs`），
   三个调度点分别在 `src/components/CodeEditor.vue`（禁写、且派单标注只剩 2 行预算）、
   `src/editorInlayHints.ts`（黑名单只读）、`src/editorFoldingController.ts`（不在名下）。**卡在哪一环**：调用点所有权，不是技术。
2. **注册表其余八条登记不进来** —— 同 1，登记动作必须写在各自 `new` 缓存的那个文件里（上游是注册表 new，
   本仓是各模块 new + 自登记 `registerLspCache`，两种键型：`path` 与 `document`）。
   **卡在哪一环**：那些文件不是本 lane 可写面；本轮已把 `registerHighlightingFeature` 的参数换成结构类型，使 R3 只需一行。
3. **`invalidate` 的「取消在飞那一发」没做** —— 上游靠协程取消（`:105` 的 `?.cancel()`、`:183`/`:203` 的
   `ensureActive()`）实现「强制刷新之前发出的答复不能把快照刷成新鲜」。本模块的缓存是同步状态机、没有 job 句柄，
   等价物要一个「刷新代号」，而那要改 `pullPlan` 的返回形状（`editorInlayHints.ts:238-240` 按字符串比较 `fresh`/`dedup`，
   新增枚举值会**悄悄落到发请求那一支** ⇒ 更糟）。**卡在哪一环**：不改消费者就做不成，已写进 R2 的第二段。
   今天没有生产路径调快照缓存的 `invalidate`（走的是整族 `clearAllLspCaches()`），所以是**潜在**缺陷不是现行缺陷。
4. **`acceptsPublishedVersion` / `mergePublishedDiagnostics` / `aggregatePullResults` / `createLazyQuickFixes` 生产零调用** ——
   前两条卡在宿主：`native/lsp_support.cpp:127-152` 不搬 `PublishDiagnosticsParams.version`（本轮亲自核过），
   一个 path 只有一个 LSP 文档（`native/lsp_session.cpp:40`、`:86`）⇒ 分桶/聚合恒等；后两条卡在消费链（B3）。
   没有把它们删掉：删了等于把上游规则从仓里抹掉，将来宿主补字段时无处接；已在文件头写明"端口在、没人喂"。
5. **`documentColor` 一族接不上** —— 宿主 kind 表里没有 `colorProvider`（`native/lsp_support.cpp:238` 一带），
   前端也就无法发这一问；本 lane 不改 `native/`（且新建 native 文件要交 CMakeLists 请求），标 `[ ]`。
6. **中文措辞一律「无法核实」** —— 本地树没有 zh 本地化包，本 lane 没新增任何界面文案，
   凡涉及"上游那句话中文怎么说"的判断都没写。
7. **`native/lsp_host_bootstrap.cpp:266` 的 `diagnostic` capability 是否真被 jdtls 接受** —— 没跑真机（规约第 6 条：
   不启动图形界面、不花外部配额），只读了 `src/components/CodeEditor.vue:359-374` 的代码形状与
   `native/lsp_kinds_test.cpp:298-310` 的用例名。
