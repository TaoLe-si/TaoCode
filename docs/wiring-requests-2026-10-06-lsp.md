# 接线请求 · 2026-10-06 · `lsp` 域（桥 / App.vue / CodeEditor 那一侧）

> 我是 `lsp` 域：只能动 `src/ls*.ts`、`src/lsp*.ts`（除 `lspCompletion*`/`lspNavigation.ts`）、`native/lsp*.cpp`、`tests/ls-*`、`tests/lsp-*`。
> 下面每一条的目标文件都**不在我名下**（保留文件或别人的面），我一行都没动。
> 所有行号按 **2026-10-06 09:35** 复读；`src/App.vue` 与 `src/components/CodeEditor.vue` 正被 `appvue`/别的域并行改着，
> 落地前请再数一次行号（我只对**内容**负责，行号是复读值）。
> 上游坐标全部逐条打开本机参考树核过（`D:\Backup\Downloads\intellij-community-master\intellij-community-master`）。

---

## 0. 先记账：桶 3a / 3b 那些请求的现状（逐条复核，不重复提）

| 条目 | 目标 | 我复核到的实际现状 | 结论 |
| --- | --- | --- | --- |
| 3a **R4** 设置模型登记两把键 | `src/settingsModel.ts`（保留） | `EditorSettings` 里已有 `showQuickDocOnMouseHover: boolean`（:462）与 `autoUpdateDocumentation: boolean`（:464），`defaultEditorSettings`（:223 行尾）两项都是 `true` | **已落地**，不用再提；R2 的前置条件已经满足 |
| 3a **R3** 启动时把两档灌回运行时单例 | `src/settingsPersistence.ts:86` | 第 86 行仍是 `editorSettings.value = await request<EditorSettings>('settings.update', { settings })`，全仓 `grep docHoverPolicyFromSettings` 在 `src/settingsPersistence.ts` 里**零命中** | **未落地** ⇒ 本文件 L3 重述（行号确认就是 86） |
| 3a **R2** 弹层齿轮落盘 + 打开 hover 闸 | `src/App.vue` | `QuickDocPopup` 那一行现在在 **:2372**（3a 写的是 :2400，行号已漂）；`can-toggle-hover`/`policy-change` 两个属性全仓 `grep` 零命中 | **未落地** ⇒ 本文件 L2 重述（订正行号） |
| 3a **R1** 编辑器 hover 通道改共享取用面 | `src/components/CodeEditor.vue` | 第 64 行确实是那条 `import { dapState, lspDiagnostics, request, … } from '../bridge'`；要替换的 `try { const result = await request<LspHoverResult>('lsp.request', { kind: 'hover' … }` 现在是 **:511-516**（3a 写的 :512-517 多数了一行，:517 是 `}, { hoverTime: 250, hideOnChange: true })`） | **未落地** ⇒ 本文件 L1 重述（订正行号） |
| 3a **R5** native 透传 hover 的 `range` | `native/lsp_session.cpp`（**在我名下**） | 已经在树里：`lsp_session.cpp:159-173` 把 `result["range"]` 原样带上，`lsp_fake_server_requests.cpp:119-130` 回一条区间，`lsp_coding_test.cpp:206-214` 钉住往返 | **我这边已收**，本轮 ctest `lsp_coding` 绿；不再提请求 |
| 3b **W3** 语言服务状态栏部件 | `src/App.vue` + `src/statusBarWidgets.ts`（桶 6） | `src/App.vue:2273` 的状态栏里已经有 `<LspServicesWidget v-if="showWidget('lspServices')" :active-path="activePath" @notify=… />`，部件实现在 `src/components/LspServicesWidget.vue`，读的是 `src/lsSessionHost.ts` 的 `lspWidgetItemFor`/`lspSessionLine`/`runLspWidgetItemAction` | **已落地** ⇒ 撤回 W3 里「宿主未注册新的 LSP 部件」那句（判词也同条陈旧，见交付报告 §1） |
| 3b **W1 / W2 / W4** CodeVision 本地通道、点击路由、设置页 | `CodeEditor.vue` / `App.vue` / `settingsTreeMeta.ts` + `native/settings_schema.cpp` | 三条都不在我名下，也都不在我本轮的改动面上；W4 的模型侧（`src/codeLensSettings.ts:61/102/165` + `CodeVisionSettingsPage.vue` + `settingsModel.ts` 的 `codeVision*` 键）已经落地 | **不重复提**，仍以 3b 那份为准 |

---

## L1 · 编辑器 hover 通道改用共享的文档取用面（并把「在鼠标移动时显示」那档闸接上）

- **目标文件**：`src/components/CodeEditor.vue`（保留文件）
- **目标行号**：第 **64 行**那条 `import { … } from '../bridge'` 之后补一行 import；第 **511-516 行**整段替换
- **这段现在长什么样**（:511-516，逐字）：

```ts
  try {
    const result = await request<LspHoverResult>('lsp.request', { kind: 'hover', path: props.path, line: info.number - 1, character: pos - info.from })
    if (!result.available || !result.contents) return null
    const contents = result.contents
    return { pos, create: () => { const dom = document.createElement('div'); dom.className = 'lsp-hover'; dom.textContent = contents; return { dom } } }
  } catch { return null }
```

- **第 64 行之后加**：

```ts
// 文档取用面（闸 + 共享 hover 缓存 + 签名/描述整形）在 src/docHoverContent.ts；
// Ctrl+Q 那条入口（src/quickDocHost.ts）用的是同一张缓存，这里不再自己发 hover。
import { hoverDocStampOf, sharedDocHover } from '../docHoverContent.ts'
```

（本仓的 `src/docHoverContent.ts:122` 出 `hoverDocStampOf`、`:193` 出 `sharedDocHover`，两个名字逐字核对过。）

- **第 511-516 行整段替换为**：

```ts
  // 「在鼠标移动时显示」这一档关掉时这里返回 null —— 与上游一致：不是改成显示别的，
  // 而是文档这一部分整个不出现（EditorMouseHoverPopupManager.java:452）。
  const text = await sharedDocHover().tooltipText({
    path: props.path,
    line: info.number - 1,
    character: pos - info.from,
    // 标记按 CodeMirror 的不可变文档对象取：只有真改动才变（改选区不算变更）。
    stamp: hoverDocStampOf(hovered.state.doc),
    lineText: info.text,
  })
  if (!text) return null
  return { pos, create: () => { const dom = document.createElement('div'); dom.className = 'lsp-hover'; dom.textContent = text; dom.style.whiteSpace = 'pre-wrap'; return { dom } } }
```

- **上游依据**：
  - `platform/lang-impl/src/com/intellij/openapi/editor/EditorMouseHoverPopupManager.java:452`（`findElementForQuickDoc` 第一行就是 `isShowQuickDocOnMouseOverElement` 那道闸）
  - `platform/lang-impl/src/com/intellij/openapi/editor/HoverPopupContext.kt:106`（`showDocumentation && isShowQuickDocOnMouseOverElement` 才算文档）
  - `platform/lsp-impl/src/impl/LspRequestExecutor.kt:213-221`（hover 走一张 `hoverResultCache`，并把服务器给的 `hover.range` 映射成宿主区间）
  - `platform/lsp-impl/src/impl/features/documentation/HoverResultCache.kt:11-12`（命中规则 = `storedValue.textRange.contains(queriedOffset)`）
  - `platform/lsp-impl/src/impl/features/documentation/TextRangeAndMarkupContent.kt:14-20`（服务器没给区间 ⇒ 退化成零长区间，只剩「同位置」这一档）
- **为什么需要**：现在这段每次都发一条 `lsp.request` hover、把 markdown 原文（连 ``` 围栏一起）贴进 tooltip，既不过共享缓存（与 Ctrl+Q 各发各的），也不认 `showQuickDocOnMouseHover` 那档设置。
  **native 侧的 `range` 我这半已经通了**（`native/lsp_session.cpp:159-173` 原样透传 `Hover.range`，fake server 也回一条，判据 `lsp_coding`）——
  于是 TS 侧的「按文本区间命中」（`src/hoverDocumentation.ts` 的 `docHoverRangeContains`）**现在只差这一处消费方**：不接 L1，服务器给的区间就永远没人读。
- **判据**：`tests/doc-hover-content.test.mjs`（3a 名下）的「hover 那一档闸」+「接线」两条钉形状；接完之后 `src/components/QuickDocPopup.vue:50/61` 那颗 `canToggleHover` 才有生效点（否则按假控件禁令它本来就不渲染）。

---

## L2 · 弹层齿轮：`policy-change` 落持久化 + 打开 `can-toggle-hover`

- **目标文件**：`src/App.vue`（保留文件）
- **目标行号**：第 **2372** 行那一整行 `<Teleport v-if="quickDoc" to="body"><QuickDocPopup … /></Teleport>`
- **改法**（只在行尾 `/>` 之前插两个属性，其余一字不动）：
  - `:can-toggle-hover="true"`（与 L1 同批落地，缺一颗能点但没生效点的开关就是假控件）
  - `@policy-change="applyDocHoverPolicy($event)"`
- **并在 `createEditorFileOps({...})` 那个调用的收尾 `})`（第 **1130** 行）之后加一个两行的函数**：

```ts
// 弹层齿轮改了一档：运行时真值已经由 `src/docHoverPolicy.ts` 的单例翻好，这里只负责落盘。
// 上游那两个 ToggleAction 写的也是同一份持久化设置（EditorSettingsExternalizable / documentation.auto.update）。
function applyDocHoverPolicy(patch: Record<string, boolean>) { void saveSettingsPatch(patch as Partial<EditorSettings>) }
```

（`saveSettingsPatch` 就在同文件 :652，`EditorSettings` 类型 :43 已经 import 着，两把键 `settingsModel.ts:462/464` 已在类型里 ⇒ 这条现在**不会**再像 3a 写那样「R4 没落地会 TS 报错」。）
- **上游依据**（四条都是**本轮逐字打开参考树重数过**的；3a 那份里 `EditorSettingsExternalizable` 与 `DocumentationToolWindowManager` 两条只写了裸文件名、没带目录，
  引用门因此核不到 —— 这里补齐真实目录，行号与 3a 给的 76 / 55 一致）：
  - `platform/lang-impl/src/com/intellij/codeInsight/documentation/ToggleShowDocsOnHoverAction.java:22`、`:32`（动作读写 `EditorSettingsExternalizable` 那一格）
  - `platform/lang-impl/src/com/intellij/lang/documentation/ide/actions/ToggleAutoUpdateAction.kt:13`、`:17`、`:21`（同上，写 `documentation.auto.update`）
  - `platform/ide-core-impl/src/com/intellij/openapi/editor/ex/EditorSettingsExternalizable.java:76`（`public boolean SHOW_QUICK_DOC_ON_MOUSE_OVER_ELEMENT = true;`）
  - `platform/lang-impl/src/com/intellij/lang/documentation/ide/impl/DocumentationToolWindowManager.kt:55`（`by propComponentProperty(name = "documentation.auto.update", defaultValue = true)`）
  - 键名与默认档取自本仓 `src/docHoverPolicy.ts:47`（两档默认都开）与 `:54`（`DOC_HOVER_SETTING_KEYS`）
- **为什么需要**：`src/components/QuickDocPopup.vue:73` 已经在 `emit('policy-change', toggleDocHoverPolicy(key))`，而 `App.vue:2372` 没有 `@policy-change`
  ⇒ 用户点了只改运行时值，**重启就回到默认档**（「我关掉了，下次打开又自己开了」）。
- **判据**：`tests/doc-hover-policy.test.mjs`（3a 名下）里 `v-if="canToggleHover"` 与 `emit('policy-change'` 那两条。

---

## L3 · 启动/加载设置时把两档灌回运行时单例

- **目标文件**：`src/settingsPersistence.ts`（不在我名下）
- **目标行号**：第 **86** 行 `editorSettings.value = await request<EditorSettings>('settings.update', { settings })` **之后**
- **插一行**：

```ts
      // 文档面那两档（「在鼠标移动时显示」/「选区更改时自动刷新文档」）的运行时真值在
      // src/docHoverPolicy.ts 的单例里；从盘上读回来后灌进去，缺键按上游默认档（开）。
      docHoverPolicyFromSettings(editorSettings.value)
```

- **并在文件顶部 import 段补**：`import { docHoverPolicyFromSettings } from './docHoverPolicy.ts'`
- **上游依据**：`platform/ide-core-impl/src/com/intellij/openapi/editor/ex/EditorSettingsExternalizable.java:76`（持久化的运行时真值）、
  `platform/lang-impl/src/com/intellij/lang/documentation/ide/impl/DocumentationToolWindowManager.kt:55`（属性变了行为就跟着变）
- **迁移口径（别踩老存档）**：老 settings 文件里**没有**这两把键。`src/docHoverPolicy.ts:73` 的 `docHoverPolicyFromSettings` 认的是「只有显式 `false` 才算关」
  ⇒ 缺键 = 默认开 = 上游默认档，**不会**因为「少一个键」把用户当配置损坏（本仓出过这类事故，见 `.tools/agent-rules.md` §3）。
- **为什么需要**：与 L2 是同一个洞的两半（一个不管写、一个不管读）。

---

## L4 · 前端文档账缺 `lsp.change` / `lsp.close` 的写入方（**本轮新发现**）

- **目标文件**：`src/bridge.ts`（保留文件）—— 建议改在**唯一的那个咽喉**上，一处顶十二处
- **目标行号**：第 **876** 行 `export async function request<T>(method: Method, params …)` 体内的第 **878** 行
  （现在第 878 行是 `if (method === 'project.clone') cloneProgress.splice(0)`），在它**之后**插两行
- **import 段补**（`src/bridge.ts` 已经在 import `./lspProgress.ts`，同一段加一行）：

```ts
import { noteDocumentChanged, noteDocumentClosed } from './lsSessionHost.ts'
```

- **插的代码**：

```ts
  // 文档账（`src/lsSessionDocuments.ts` 的 `DocumentLedger`）是宿主那份 `struct Document`
  // （`native/lsp_session.hpp:143-149`，`lsp_session.cpp:84-92` 建文档 version=1、`:104` 每次 change ++version、
  // `:110-128` close 先 did_close 再 erase）在前端可对账的镜像。
  // 现在只有 `lsp.open` 那一拍有人记（`src/lspCompletionStartup.ts:41`），**change/close 两拍没人喂**：
  // `noteDocumentChanged` / `noteDocumentClosed` 全仓零生产调用方，于是账上的版本永远停在 1、
  // 关掉的标签页永远还挂在「这台服务器正在看着它」那一张表上（`syncedDocuments()` 就会说谎）。
  // 在咽喉上接一次，十二处调用点（`App.vue:1056`、`CodeEditor.vue:178/477/652`、`editorFileOps.ts:76/166/187/211`、
  // `diskSync.ts:97`、`semanticActions.ts:498`、`HistoryPanel.vue:200`、`ProblemsPanel.vue:358/389`、
  // `lspNavigation.ts:269` 那条 `lsp.close`）一处都不用改。
  if (method === 'lsp.change') noteDocumentChanged(String(params.path ?? ''))
  else if (method === 'lsp.close') noteDocumentClosed(String(params.path ?? ''))
```

- **上游依据**：
  - `platform/lsp-impl/src/impl/documentSync/LspOpenedFilesService.kt:94-98`（只有 `state == Running` 且还没 opened 才排 didOpen）、`:137-165`（收尾那半排 didClose）
  - `platform/lsp-impl/src/impl/LspDocumentMapping.kt:62-64`（`getDocumentsInFileSync`：普通文件是 1:1）
- **为什么需要**：`ls/session` 判词里那句「`LspOpenedFilesService` 的按文件打开集合（宿主自持，**前端没有查询面**）」已经不再成立——
  查询面就是 `src/lsSessionDocuments.ts` + `src/lsSessionHost.ts`（本轮核对结论，见交付报告 §1 的留痕）。
  剩下的**真洞**是这张账只被喂了一半事件；不接 L4，`pendingDidOpen()` / `syncedDocuments()` / `acceptsVersion()` 三个口都是空表。
- **预览模式安全**：`noteDocumentChanged` 对没登记过的路径返回 null（`lsSessionDocuments.ts:179-184`），非桌面（`previewRequest`）那条路上不会凭空造条目。
- **判据**：`tests/lsp-per-file-cache.test.mjs`/`tests/ls-*` 钉的是模块侧形状；这条接完之后请把「change 一次 ⇒ 账上版本 +1、close ⇒ 条目除名」补进
  `tests/ls-widget-action.test.mjs` 或那边的 bridge 接线判据里（我域内已经用 `tests/lsp-progress.test.mjs` 的「接线」条钉住我这一侧的锚点）。

---

## L5 · `window/showMessageRequest` 的那一排按钮（**本轮新链路的前端一半**）

我本轮已经把客户端与宿主侧接通了（`native/lsp.cpp` 认得 `window/showMessageRequest`、把 `actions` 原样带出、按协议回 `MessageActionItem | null`；
`native/lsp_host_bootstrap.cpp:83-105` 把 `method` + `actions` 放进既有的 `lsp.message` 事件；`src/lspProgress.ts` 把消息本身照 `showMessage` 显示、把选项标题写进语言服务日志）。
**还差两处不在我名下**：

### L5.1 通知面把选项做成动作按钮
- **目标文件**：`src/progressNotices.ts`（桶 6 名下）
- **目标行号**：第 **110-121** 行那个 `watch(() => lspServerMessages.length, …)` 循环体
- **要接什么**：读 `lspServerMessages` 条目的 `actions: string[]`（我这边先加，见下一句），把每一条变成一个动作按钮，点击回调走 L5.2 的那条通道。
  我域内的配套改动（等 L5.1 落地同批提交，避免先加出一个没人读的字段）：
  - `src/lspProgress.ts:127` 的 `LspServerMessage` 加 `actions: string[]`（缺省空表），`handleLspProgressEvent` 的 `ask` 分支把 `lspActionTitles(data.actions)` 一起塞进队列条目。
- **上游依据**：`platform/lsp-impl/src/impl/LspServerNotificationsHandlerImpl.kt:377-383`
  （`logInfo("window/showMessageRequest: ${params.message}: ${params.actions?.joinToString { it.title }}")` + `doNotify(params.message, …, params.actions)`，
  返回用户点的那一项、关掉就是 null）。
- **判据**：`tests/lsp-progress.test.mjs` 本轮新加的「window/showMessageRequest：消息本身照 showMessage 显示，选项标题另记一行日志」+
  「分派认得这四条」两条；按钮那半请桶 6 配一条「有 actions 的通知必须有可点的动作」。

### L5.2 「回给服务器」的通道（要动 `native/lsp.hpp` + `native/main.cpp` + `src/bridge.ts`）
- **卡在哪一环**：服务器这条是**请求**（带 id），必须有一份回包可发。本仓客户端现在**就地回 `null`**（= 用户没选，协议合法），
  因为 `Client::respond(...)` 是私有的、`Client` 里也没有「待决服务器请求」这张表 —— 加这张表要改 `native/lsp.hpp`（**不在我名下**：我只被授权改 `native/lsp*.cpp`）。
- **要接什么**（三步，给主代理拍板）：
  1. `native/lsp.hpp`：`Client` 加 `using ServerRequest = std::function<void(Json id, Json params)>;` + `void on_server_request(ServerRequest)` 与
     `void answer_server_request(Json id, Json result)`（回包内部仍走现成的私有 `respond`）。
  2. `native/main.cpp`：加一条 `case "lsp.answerMessageRequest"_h`（把 `{ id, chosen }` 交给 Session → Client）。
  3. `src/bridge.ts`：`Method` union 补 `'lsp.answerMessageRequest'`，事件侧**不用加新名字**（`lsp.message` 那条字段袋已经带得出 `id`）。
     我这一侧还需要把 `id` 一起放进 `lsp.message` 事件（`native/lsp_host_bootstrap.cpp`，我名下，等 1/2 落地我再补，不提前造没人读字段）。
- **上游依据**：`platform/lsp-impl/src/impl/LspServerNotificationsHandlerImpl.kt:377-383`（同一个方法名，返回 `CompletableFuture<MessageActionItem>`，
  由通知的按钮回调 complete 它）；`platform/lsp/src/api/Lsp4jClient.kt` 的 `showMessageRequest` 声明。
- **不做的后果（如实）**：jdt.ls 问「要不要把这个文件夹当成工程导入」这类话，用户看得见问题、看不见按钮，
  客户端一律答 null ⇒ 服务器按「用户拒绝」继续。这比改动前（整条被丢、还回一个 `-32601 MethodNotFound`）已经前进了一步，但它是 `[~]` 不是 `[x]`。

---

## L6 · 服务器要求刷新之后的「就地重取」（**本轮新链路的重取一半**）

- **现状（我域内已做）**：`workspace/semanticTokens/refresh` 等五条到前端后，
  `src/lspProgress.ts` 调 `clearAllLspCaches()`（注册表在 `src/lspPerFileCache.ts`，`LspPerFileCache`/`LspSingleSlotCache`/`HighlightingSnapshotCache`
  三族构造时自登记），并把这一条写进语言服务日志；**下一次读**自然重取。
- **上游还多做的一件事**：清完缓存要**主动踢一拍重取并重新贴回编辑器**，不是等用户去动文档：
  - `platform/lsp-impl/src/impl/LspClientImpl.kt:235-241`（`refreshSemanticTokens`：`semanticTokensCache.clearCache()` 之后对每个打开的文件
    `LspHighlightingApplier.scheduleHighlightingRefresh(file)`）
  - `:247-254`（`refreshInlayHints`：`invalidate` 保旧结果不闪断 + `LspInlayApplier.scheduleRefresh`）
  - `:260-265`（`refreshDiagnostics`：`forceFullRepull` + 重贴）
  - `:223-233`（`invalidateServerResults`：`requestExecutor.clearCaches()` + 逐文件 `invalidatePulledResults` + `refreshCodeLenses`）
- **要接什么**（消费方都不在我名下）：
  - `src/highlightPasses.ts`：语义高亮那两份 `HighlightingSnapshotCache` 实例在 refresh 之后自己排一拍重取；
  - `src/editorFolding.ts`：`foldingRange` 重取（上游 `platform/lsp-impl/src/impl/features/folding/LspFoldingRangeCache.kt:37-49` 的 `onResponseReceived` 就是 `scheduleAsyncFoldingUpdate`）；
  - `src/codeLensExtension.ts` / `src/codeLensCache.ts`：`workspace/codeLens/refresh` ⇒ 重取（上游 `platform/lsp-impl/src/impl/features/codeLens/LspCodeLensCache.kt:44-46` 的 `onResponseReceived` 调 `refreshCodeLenses`）。
- **我这边留的接缝**：`src/lspPerFileCache.ts` 的注册表是**整批**作废（粒度差异已在文件头注里写明「多出来的代价只是下一次读重新请求一次」）。
  等上面三处各自挂上「按名字的缓存」后，可把 `clearAllLspCaches()` 换成按方法名分派（`LSP_REFRESH_METHODS` 已经把五条方法名钉在 `src/lspProgress.ts`）；
  我不提前造按名注册表 —— 现在没有任何生产方按名字登记，造了就是只过自己测试的死出口。
- **判据**：`tests/lsp-progress.test.mjs`「workspace/…refresh：整批作废前端那一族 LSP 缓存，并留一行日志」（含反向验证：把 `clearAllLspCaches()` 换成 `0` ⇒ 该条与「接线」条一起红）。

---

## L7 · 「语言服务」独立输出窗口（Services 里的那一页）

- **目标**：`src/App.vue` 的工具窗口装配 + `src/statusBarWidgets.ts`/输出面板注册表（桶 6/桶 8 名下）
- **要接什么**：模型侧已经全部算好，UI 只读 —— `src/lspServerLog.ts` 的 `lspLogEntries`（按语言分组的环形日志）、
  `filterLspLog`（语言 / 级别 / 类别三档过滤）、`exportLspLogText`（导出文本）、`lspLogTail`（尾部几行）、`lspLogLanguages`（出现过的语言）、
  `clearLspLog`（清空动作）。本轮日志又多了一个类别：`LspLogKind` 加了 `'refresh'`（`src/lspServerLog.ts:22`）。
- **为什么现在只能落在消息窗口**：`src/lspServerLog.ts:10-13` 的头注写了 —— IDEA 那一页是 Services 里的 `LspClientConsole`，
  要改 `App.vue` 的工具窗口装配，本批冻结，所以消费方暂居 `src/progressNotices.ts` 的通知（detail = 日志尾部、动作 = 复制日志）。
- **上游依据**：`platform/lsp-impl/src/impl/logging/LanguageServiceLogger.kt`、`platform/lsp-impl/src/impl/serviceView/LspServiceViewSupport.kt`、
  `platform/lsp-impl/src/impl/serviceView/LspClientConsole.kt`（三条路径本机参考树里都在，逐字核过；**行号我没有逐条数** ⇒ 这条请求只给类名，不建行号）
- **判据**：`tests/lsp-server-log.test.mjs`（12 条，含「内联过的链接不再重复列一行」那族过滤）。

---

## 我做不了 / 不做的（写清楚，别当成漏项）

1. **`native/lsp.hpp`、`native/lsp_session.hpp` 等 `.hpp` 一律没动**：派单只授权 `native/lsp*.cpp`。
   本轮**不需要**改 `.hpp`（三种新处置都塞得进现成的 `server_message_` 那一条出口），
   只有 L5.2「把答案回给服务器」必须要动 `lsp.hpp` + `main.cpp` ⇒ 所以它只能走请求。
2. **多服务器 / 按 workspace folder 的客户端管理**（上游 `platform/lsp-impl/src/impl/LspClientManagerImpl.kt`）：
   本仓按语言选一台、由 `native/lsp_config.cpp` 的合成表决定，改成多客户端要动 `lsp_session.hpp` 的 `hosts_` 语义与 `main.cpp` 的路由 ⇒ 不在我面，也没写成请求（要写成需求请先拍板）。
3. **`LspNodeRuntimeManager`/`LspNodeRuntimeDownloads`**（下载 node 运行时）：派单禁网、禁外部配额调用，本仓只发现随发行的 JDT LS ⇒ 无法核实也做不到。
4. **`stdio` 之外的连接器**（上游 `Lsp4jServerConnectorSocket`）：`native/lsp_host.hpp` 的 `Host::Spec` 只有 stdio 一条口，改它要动 `.hpp` ⇒ 见第 1 条。
5. **流量级 JSON-RPC 逐条记录**（上游 `LspTrafficPayloadPopup`）：要宿主把每一条出入帧都转一份给前端 ⇒ 事件名要进 `src/bridge.ts` 的白名单（保留文件）⇒ 没做，也没写成 L 条（它比 L5 更大，等主代理排期）。

## 处理结果（wiring-backlog lane，2026-10-06）

- **L1** —— 目标 `src/components/CodeEditor.vue`（禁改清单）。需 CodeEditor owner。
- **L2 部分**：`@policy-change` 已接（`src/App.vue:2478`）；`:can-toggle-hover="true"` 未加（L1 未落地前不放假控件）。
- **L3 已接线（形状迁移）**：`docHoverPolicyFromSettings` 由 `src/workspaceLifecycle.ts:247` 调用。

结论：L2 的 policy-change 与 L3 已接；L1 与 can-toggle-hover 转 CodeEditor owner。

## 处理结果（接线 lane，2026-10-06）

复核（对当前工作区代码逐条核对）：上一条 `wiring-backlog lane` 的分解已逐项复核，其结论为「L2 的 policy-change 与 L3 已接；L1 与 can-toggle-hover 转 CodeEditor owner。」。
本 lane 本轮接线：无 —— 本份请求的挂载点目标均落在禁改/非本 lane 面（`src/components/CodeEditor.vue`、`src/bridge.ts`、`native/**`、`src/settingsModel.ts`、`src/keymapBindings.ts`、`src/*.ts` 等），或为上一条记录里的「登记待办 / 判定项」。
