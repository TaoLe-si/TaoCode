# 桶 3b · 提示 / CodeVision / 语言服务面 · 2026-10-06

接手被 150 次调用切断的那半区（**提示与语言服务面**）；文档半区在 `docs/batch-2026-10-06-bucket3a.md`，
两个文件集合没有交集（3a 名下：`src/documentationView.ts`/`hoverDocumentation.ts`/`quickDoc*`/`quickDefinition*`/
`documentLinks*`/`MarkdownPreview.vue`/`QuickDocPopup.vue`/`lsFeaturesWidget` 的组件 —— 一条都没碰）。

## 判词

| 族 | 项 | 判定 | 上游依据（相对路径:行号） | 本仓落点（文件:行号） | 说明 |
|---|---|---|---|---|---|
| `ls/completion` | 「late resolve 不得插进已改文档」「服务端有条目不掺本地词」两条**红** | 已修 | `platform/analysis-impl/src/com/intellij/codeInsight/completion/impl/CamelHumpMatcher.java`（前缀过滤的真实存在性已 `find` 确认） | `tests/lsp-completion.test.mjs:148-158,182-189` | 两条不是功能坏，是**夹具自相矛盾**：前任把表内过滤改成按 `CamelHumpMatcher` 判（`src/completionCamelHump.ts`），但这两条用例仍拿 `println` 当 `Lis`/`val` 点位的服务端条目 ⇒ 被过滤掉，第一条变成「占位行没有 resolve 可调」（`reply is not a function`）、第二条拿到「无建议」。改成前缀能命中的条目（`List`/`validate`），断言意图一字未改。14/14 绿 |
| `lp/code-vision` | 内置 provider 的本地计数（usages / inheritors）—— 判词写「缺」 | **本轮补上** | `java/java-impl/src/com/intellij/codeInsight/daemon/impl/JavaReferencesCodeVisionProvider.kt:17-38`、`JavaInheritorsCodeVisionProvider.kt:31-44`、`JavaTelescope.java:32-51,115-131`、`PlatformCodeVisionIds.kt:5-6`、`ReferencesCodeVisionProvider.kt:12-14`（点击=查找用法） | `src/codeVisionProviders.ts:205,240,268`（三档文案 + 两个 provider）、`src/cvLocalVision.ts:58,133,178`（抓取层） | **订正 3a/前任留的那句「usages/inheritors 走服务端通道，不在这里伪造数字」**：计数不需要伪造，宿主早就有 `references`（`native/lsp_session_kinds.cpp:108-118`）与 `prepareTypeHierarchy`/`typeHierarchy/subtypes`（同文件 `:196-231`）两条通道，只是没人问。现在逐符号问真数，**问不到就不画**（不填 0）。文案逐字取中文包：`usages.telescope` = 「N 个用法」（英文 `java/openapi/resources/messages/JavaBundle.properties:1805`）、`code.vision.inheritors.hint`/`implementations.hint` = 「N 个继承者 / N 个实现」（同文件 `:1767-1768`） |
| `lp/code-vision` | 「0 个用法也显示」/「0 个继承者不显示」/「入口点不显示」/「usages 排在 inheritors 前」 | 已落（按上游档位） | `java/java-backend/resources/META-INF/JavaPlugin.xml:227`（`code.vision.java.minimal.usages` default=0）、`JavaInheritorsCodeVisionProvider.kt:37,43`、`JavaReferencesCodeVisionProvider.kt:21,25,33-34` | `src/codeVisionProviders.ts:240-296`、`src/cvLocalVision.ts:133-176` | 声明点不计数这条是**推出来再验回去**的：宿主 `includeDeclaration: true`（`native/lsp_session_kinds.cpp:109-111`）而上游有 `0#0 个用法` 这一支 ⇒ 声明自己不算一次用法，故按名字位置摘掉。字段（LSP kind 7/8/14）也进 usages 锚点（`PsiMember` 含字段），`main` 连问都不问 |
| `lp/code-vision` | 「更多…」弹层 | 判词过期：出厂没有这个入口 | `platform/util/resources/misc/registry.properties:1759` `editor.codeVision.more.inlay=false`（本轮亲自 grep 到该行） | `src/registryKeys.ts:145`（同一键已登记）、`src/codeLens.ts` 的 `CODE_LENS_VISIBLE_MAX`（5，`CodeVisionSettings.kt:38-39`） | 上游那枚「More …」inlay 默认关；本仓同形态 = 超上限的条目没有入口。**不是**遗漏，也就不用假弹层 |
| `lp/code-vision` | 本地通道的**生产入口** | 未接（接线请求 W1） | `CodeVisionProvider.kt:25,62`（EP 与 `computeForEditor`，不经过 LSP） | `src/codeLensExtension.ts:257,355`（`localChannel` 依赖 + 自己挂补刷） | 渲染侧早就会读 `local`，但 `CodeEditor.vue:151` 那次 `createCodeLens` 没给 ⇒ 三个内置 provider 仍无生产消费方。已把宿主需要写的行数压到 1（`localChannel:`） |
| `lp/code-vision` | 本地条目的**点击** | 未接（接线请求 W2） | `CodeVisionProvider.kt:76`（`handleClick`）、`ReferencesCodeVisionProvider.kt:12-14` | `src/codeVisionProviders.ts:181-200`（`localCodeVisionAction`） | `App.vue:1009` 把任何命令名都发 `workspace/executeCommand`，本地 `codeVision.*` 点一下就是「未注册命令」报错。收口函数已备好，参数残缺一律回 `none` |
| `lp/code-vision` | 按 provider 开关 + 右键隐藏、按文件 lens 缓存 | **判词过期：已落** | `CodeVisionSettings.kt:38-39,55-60,106`、`ProjectCodeVisionModelImpl.kt:26-27,50-59`、`LspCodeVisionProvider.kt:20,65`、`LspCodeLensCache` | `src/codeLensSettings.ts`（表 + 两个动作 + 设置进出口）、`src/codeLensCache.ts`（旧 lens 跟着文档挪）、`src/codeLensExtension.ts:30-31`（渲染只问两个判据） | 判词那句「LSP 条目不带 provider id，无法定位到某个 provider」被 `LspCodeVisionProvider.kt:20,65` 证伪：服务端 lens 全挂 `LspCodeVisionProvider` 这一个 group id |
| `lp/inlay-hints` | 宿主只转发 label/padding/kind，`tooltip`/`command` 未转发 | **判词过期：已落** | `platform/lang-api/src/com/intellij/codeInsight/hints/declarative/InlayTreeSink.kt:27-31`（sink 的 `payloads` + `tooltip` 那一对参数） | `native/lsp_session_kinds.cpp:552-590`（command 名校验 + tooltip 两种形状原样转发）、`src/editorInlayHints.ts:32-74`（有命令=可点按钮并带 `title`/`aria-label`；无命令=原生 title）、`src/components/CodeEditor.vue:218-227`（`onCommand` → `executeCommand`，路径取本编辑器） | 判据：`native/lsp_coding_test.cpp:610`「inlayHint forwards command and both tooltip shapes」 |
| `lp/inlay-hints` | 三个设置键要进 `settingsModel` 与设置页 | **判词过期：已落** | `InlaySettingsConfigurable`（注册行 `intellij.platform.lang.impl.xml:935-941`，`id="inlay.hints"`） | `src/inlayHints.ts:57-73`（键名与默认全开的唯一出处）、`src/settingsModel.ts:389-396`（三格字段与出处注释）、`src/settingsTreeMeta.ts:119-121`（设置树那一行）、`src/components/InlayHintsSettingsPage.vue:24-53`、`native/settings_schema.cpp:315`（默认值）、`src/components/CodeEditor.vue:1050`（开关一变就重问） | 判据：`tests/inlay-hints-settings.test.mjs` |
| `lp/inlay-hints` | declarative hints 与本地 provider EP（`FactoryInlayHintsCollector`/`HintsBuffer`/`InlayTags`/各 `*Presentation`） | 做不到（架构） | `platform/lang-api/src/com/intellij/codeInsight/hints/declarative/`（整包） | —— | 这一族要的是**插件扩展点宿主 + PSI daemon**：本仓的提示只有 LSP `inlayHint` 一个来源，宿主侧没有 collector/buffer 的推送模型。做出一个没有 provider 的 EP 宿主就是假控件 |
| `lp/inlay-hints` | 参数提示排除列表的设置面与通道 | 未做（有具体卡点） | `ParameterHintExcludeListService`/`ParameterHintsExcludeListConfigProvider`/`MethodMatcher`（社区树里按这三个名字**未定位到实现文件** ⇒ 上游坐标本轮无法核实） | —— | 两条卡点：① 参数提示文本与档位来自服务端 `inlayHint`（`kind=2`），排除要按**方法全限定名**判，而宿主转发回来的只有 label/padding/kind/tooltip/command（`native/lsp_session_kinds.cpp:552-590`），没有"这条属于哪个方法"的归属；② 设置页与 `settingsModel` 都是保留文件。要么宿主把 hint 的父区间（`InlayHint.parent`，LSP 4 协议有）也带回来，要么这一档做不了 |
| `lp/inlay-hints` | 多建议循环 Alt+`]`/Alt+`[` | 未接（在别人名下） | `CodeCompletionClient` 的多档语义 | `src/inlineCompletionNav.ts`（模型已在，循环/去重/触发类型） | 落点是 `CodeEditor.vue:1007` 那条 `scheduleInlineCompletion` 只取第一条建议；`src/inlineCompletion*` 是桶 2 名下 ⇒ 不越权，登记给主代理转桶 2 |
| `ls/platform` | `lsWidget` 条目上的**停止/重启**动作 | **本轮补上** | `platform/lsp/src/api/lsWidget/LspClientWidgetItem.kt:115-127`、文案 `platform/lsp/resources/messages/LspBundle.properties:26-27`（中文包 `StopLspServerAction`/`RestartLspServerAction`） | `src/lsSessionHost.ts:265-300`（`runLspWidgetItemAction`）、`src/lsFeaturesWidget.ts:62-64,168-175`（文案与"哪一档出哪个动作"） | 通道是宿主 `lsp.stop`（`native/main.cpp:1079-1082`：不排队、就地收线程换新的，理由见 `native/lsp_recover.cpp` 头）；顺序抄 `src/lspCompletionStartup.ts:68-73`：**先清状态表再 stop**，否则终态闸（`lsSessionState.ts` 的 `canTransitionLspState`）会把重启后第一份 `running` 拒掉。`stopOrRestart === null` 那一档一条请求都不发 |
| `ls/platform` | 状态栏那颗 LSP 部件 | 未接（接线请求 W3） | `platform/lsp-impl/src/impl/lsWidget/LspWidgetItemsProvider.kt:15-26`、`LanguageServiceWidgetItem.kt:53-80` | `src/lsSessionHost.ts:200-215`（`lspWidgetItemFor`/`lspSessionLine`）、`src/lsFeaturesWidget.ts:203-225` | 模型侧一行摘要/tooltip/条目/动作全齐，`lspSessionStates` 也已有两处生产写入方（`src/lspCompletionStartup.ts:41-44`、`src/quickDocHost.ts`）⇒ 不是空壳；缺的只是挂载（`App.vue:2307` 状态栏 + `src/statusBarWidgets.ts`，桶 6 名下） |
| `ls/platform` | 语言服务输出（`LanguageServiceLogger`/`LspClientConsole`） | 已落 | `platform/lsp-impl/src/impl/logging/LanguageServiceLogger`、`serviceView/LspClientConsole` | `src/lspServerLog.ts` + 消费者 `src/progressNotices.ts` | 判据 `tests/lsp-server-log.test.mjs` |
| `ls/platform` | `LspClientManagerImpl` 多客户端、`LspDocumentAdapter` 每文档映射、`fileEvents/LspWatchedFiles`、`LspTrafficPayloadPopup` | 做不到（架构不等价，逐条） | `platform/lsp-impl/src/impl/` 各该族文件 | `native/lsp_config.cpp`（一种语言一台）、`native/lsp_session.cpp`（文档同步在宿主）、`native/watcher.cpp` | 三条独立卡点：本仓按语言选一台服务器（没有 workspace-folder 级多客户端生命周期事件）；`workspace/didChangeWatchedFiles` 的注册面在宿主且不向前端暴露；流量级记录要宿主逐条转发 JSON-RPC 而 `src/bridge.ts` 本批冻结 |
| `ls/session` | 前端文档账 / 按文件缓存 / 单槽缓存 | 已落 | `LspOpenedFilesService.kt:94-98`、`LspDocumentMapping.kt:62-64`、`LspPerFileCache`/`LspSingleSlotCache` | `src/lsSessionDocuments.ts`、`src/lsSessionHost.ts:74-77,166-173,221-235`（`pendingDidOpen`/`syncedDocuments`）、`src/lspPerFileCache.ts` + 消费链 `src/lspNavigation.ts:39,473` | 本轮把 `tests/lsp-per-file-cache.test.mjs:104` 那条**过时锚**改对了（原锁死「import 不带 `.ts` 扩展名」的字面量；值 import 写全 `.ts` 是仓库规矩，代码改对反而变红 ⇒ 按 §7 改测试不改代码） |
| `ls/session` | `Lsp4jServerConnector*`（stdio/socket/包装器）、`LspNodeRuntimeManager`/`Downloads` | 做不到（本仓设计） | `platform/lsp-impl/src/impl/connect`、`nodeRuntime` | `native/lsp_discovery.cpp`（只发现随发行的 JDT LS） | 只发现不下载；连接器只有 stdio 一种，是宿主设计而非缺口翻译 |
| `ls/features` | 能力降级表 + 用户点名的回退话术 | 已落 | `platform/lsp-impl/src/impl/features/*` 各 provider | `src/lspFeatureMatrix.ts`、`src/lsFeaturesWidget.ts:227-258`（`localFallbackKinds`/`featureStillUsable`） | 判据 `tests/lsp-feature-matrix.test.mjs` 核对覆盖 `LspRequestKind` 全集 + native `provider_for` 对得上 |
| `ls/features` | 按特性缓存与「等待-重取」（`LspFoldingRangeCache`/`LspFeaturesRefreshing`/`LspPendingClient`） | 部分落 | `LspFeaturesRefreshing`、`LspPendingClient.kt:33-39` | `src/codeLensCache.ts`、`src/lspHighlightingCache.ts`、`src/editorFolding.ts`、`src/lsSessionState.ts:139-152`（`findPendingLspClient`）、`src/lsSessionHost.ts:188-199`（`serverHintFor`） | 「等待-重取」本仓只做**提示**不重放：宿主没有请求队列（`lsp.request` 是即投即回，`native/main.cpp:1085-1095`），前端要重放就得把每个 kind 的调用方都改成可重入闭包 —— 落点全在保留文件里 |
| `ls/code-lens` | 命令与参数校验（渲染 + 点击两条路） | 已落 | `LspCodeVisionProvider.kt:20,65`、`CodeVisionEntry.kt` | `src/codeLens.ts`（`codeLensItemProblem`/`codeLensArgumentsProblem`）、`src/codeLensExtension.ts` | 判据 `tests/code-lens-command.test.mjs` |
| `lp/preview` | 字面量色/图预览（Shift+悬停） | 已落 | `ImageOrColorPreviewService.kt:145-158,176-203,206-232` | `src/literalPreview.ts`、`src/literalPreviewExtension.ts`、挂点 `src/components/CodeEditor.vue:140,979` | 判据 `tests/literal-preview.test.mjs`；`ElementPreviewProvider` 的插件 EP 与 Java `new Color(...)` 一类非 CSS 字面量：**上游 provider 本体不在社区树**，接受哪些写法无法核实 ⇒ 不照经验加 |

## 改动文件

- 新增 `src/cvLocalVision.ts`（305 行）—— 本地提供者的抓取/缓存层：一次 `documentSymbol` + 逐符号 `references`（≤24）+ 逐类两跳 `typeHierarchy`（≤8），旧值先用、在飞合并、代际守卫、上限。
- 新增 `tests/cv-local-vision.test.mjs`（15 条）、`tests/ls-widget-action.test.mjs`（7 条）。
- 修改 `src/codeVisionProviders.ts`（380 行）—— `usages`/`inheritors` 两个内置 provider、三档中文文案、`VisionSymbol.startChar`、`context.usages/inheritors`、`localCodeVisionAction` 收口、`isUsageAnchorKind`/`isInheritorAnchorKind`、默认注册表补两个 provider；文件头那条「usages/inheritors 不在这层做」的旧判断已就地订正并留痕。
- 修改 `src/codeLensExtension.ts` —— 新依赖 `localChannel`（`src/codeLensExtension.ts:257`）、`readLocalEntries` 认通道对象（`:288-293`）、渲染层自己挂"抓完补刷"（`:355`）。
- 修改 `src/lsSessionHost.ts` —— `runLspWidgetItemAction`（`:265-300`）+ 引 `RESTART_ACTION`/`STOP_ACTION`。
- 修改 `tests/code-vision-local-channel.test.mjs` —— 追加 2 条（通道对象 → 补刷一拍；通道抛错只丢本地那半）。
- 修改 `tests/lsp-completion.test.mjs` —— 两条夹具与前缀过滤对齐（意图不变）。
- 修改 `tests/lsp-per-file-cache.test.mjs:104` —— import 锚改成不锁扩展名的正则。
- 新增 `docs/batch-2026-10-06-bucket3b.md`、`docs/wiring-requests-2026-10-06-bucket3b.md`。

## 验证

- `node --test tests/code-lens*.test.mjs tests/code-vision*.test.mjs tests/cv-*.test.mjs tests/inlay*.test.mjs tests/ls-*.test.mjs tests/lsp-*.test.mjs tests/literal-preview.test.mjs`：**184 通过 / 0 失败**（含本轮新增 24 条与 `lsp-completion` 从 12/14 → 14/14）。
- `npx vue-tsc -b`：我名下文件**零错误**。全树剩 4 条**别人的语法错**（`src/customFoldingProviders.ts:48` 未闭合字符串、`src/components/StructuralSearchFilters.vue:238`），属桶 1/5，未动。
- `node .tools/find-param-props.mjs`：0 处参数属性。`node .tools/find-ts-in-mjs.mjs`：干净（新测试都是纯 JS）。
- `node .tools/find-orphan-modules.mjs --gate`：红 5 个，**全是别人的**（`src/customFoldingSurround.ts`、`src/editorCodeBlock.ts`、`src/editorFillParagraph.ts`、`src/editorJoinComments.ts`、`src/structureFollow.ts`）；本轮新模块未被点名（`src/cvLocalVision.ts` 的类型出口在 `codeLensExtension.ts`）。
- `node --test tests/module-size.test.mjs`：4/5，红那条是 `src/components/SearchPanel.vue(903 行)` 超 900 未登记 —— 不是我名下；我的新文件 305 行，未调任何上限。
- `node --input-type=module -e "await import('./src/cvLocalVision.ts')"`：`load ok`（`true` 扩展名这条坑没踩）。
- native：本轮**没有**改任何 `native/*`（inlay hint 的 tooltip/command 转发上一轮已在 `native/lsp_session_kinds.cpp:552-590` 并有 ctest 用例 `native/lsp_coding_test.cpp:610`）⇒ 未跑 ctest，如实登记为"本轮无 native 改动"。

### 反向验证（新门禁都注了违规、确认变红再撤）

1. `src/cvLocalVision.ts:141` 把 `if (!isOwnDeclaration) ++count` 改成 `if (true) ++count` ⇒ `tests/cv-local-vision.test.mjs` 变 **14/15**，红的那条正是「声明点自己不算用法」；撤掉后回 15/15。
2. `src/codeLensExtension.ts:355` 注掉 `deps.localChannel?.attach(...)` ⇒ `tests/code-vision-local-channel.test.mjs` 变 **8/9**，红的那条是「宿主只交一个通道对象…」；撤掉后回 9/9。
3. `tests/lsp-completion.test.mjs` 的两条改动是**跟随已存在的过滤行为**（前任的 `src/completionCamelHump.ts`），不是新门禁；`tests/lsp-per-file-cache.test.mjs:104` 那条锚改成正则后，把 `src/lspNavigation.ts:39` 的 import 去掉就会红（该文件我没动，仅记录锚的意图）。

## 接线请求

见 `docs/wiring-requests-2026-10-06-bucket3b.md`：W1 CodeEditor 交本地通道、W2 App 的 CodeVision 点击路由、W3 状态栏 LSP 部件（含桶 6 的 `statusBarWidgets` 注册）、W4 Code Vision 设置页与持久化。

## 做不到 / 无法核实

1. declarative inlay hints 的 EP 宿主（`FactoryInlayHintsCollector`/`HintsBuffer`/`InlayTags`/`*Presentation`）—— 卡点是架构：本仓提示只有 LSP 一个来源，宿主没有 collector/buffer 推送模型；空挂一个没有 provider 的 EP 属于假控件。
2. 参数提示**排除列表** —— 上游三个类名（`ParameterHintExcludeListService`/`ParameterHintsExcludeListConfigProvider`/`MethodMatcher`）在本 checkout 按文件名/包路径/XML `id` 三条路都没定位到实现文件 ⇒ **上游坐标无法核实**；即便照做，本仓缺"这条 hint 属于哪个方法"的归属（宿主没转发 `InlayHint.parent`）+ 设置面在保留文件。
3. `lsWidget` 的**每客户端**语义（上游一个文件可有多个客户端、`rootPostfix` 显示 `…/子目录`）与 `versionPostfix`（`Session::language_status` 回包没 `serverInfo`，`native/lsp_capability_queries.cpp:139-144`）⇒ 恒空，已在 `src/lsFeaturesWidget.ts` 头注 1/2 留痕。
4. `LspTrafficPayloadPopup` 级流量记录 —— 要宿主逐条转发 JSON-RPC，`src/bridge.ts` 本批冻结。
5. 「等待-重取」的请求重放 —— 需要把所有 kind 的调用方改成可重入闭包，落点全在保留文件；本仓只做 `serverHintFor` 的提示档。
6. `main` 之外的入口点判不出来（`isEntryPoint` 在上游靠 `UnusedDeclarationInspectionBase` + PSI/注解），本仓 LSP 符号表没有修饰符与注解 ⇒ 只挡 `main`，其余按上游口径**多画**而非少画，已写进 `src/codeVisionProviders.ts:236-238`。
7. `lp/preview` 的 Java `new Color(...)` 等非 CSS 字面量 —— 上游 `ElementPreviewProvider` 的 provider 本体不在社区插件树里，接受哪些写法**无法核实**，没有照经验补。
8. usages/inheritors 计数**没有生产入口**（等 W1）；在 W1 落地前这三档只在测试里驱动 —— 如实登记，不放没有数据的条目。
