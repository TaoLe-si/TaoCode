# 批量 2026-10-06 · CVAUDIT：文档悬浮 / CodeVision / 内联提示 / 语言服务特性面 —— 判决行 × 盘上现状 对跑

**本 lane 只核对、不写码**：本轮没有改任何 `src/`、`tests/`、`native/` 文件，只新建本文件。
并发黑名单（`src/codeLens*.ts`、`src/components/CodeVisionSettingsPage.vue`、`src/components/OutlinePanel.vue`、
`src/outlineView.ts`、`src/editorInlayHints.ts`、`native/settings_editor_keys.hpp`）**只读未写**；
读到的内容与预期不符处一律以盘上为准，并记进下面的「订正留痕」。

- 上游参考树（唯一可用）：`D:\Backup\Downloads\intellij-community-master\intellij-community-master`
  （仓内 `third_party/intellij-community` 是坏树，本轮一次都没打开）。
- 对跑的判决行：`docs/inventory/verdict-platform_rest.md` 与 `docs/inventory/platform_rest_verdict_table.json` 里
  这 6 族 —— `lp/documentation`(行 54) / `lp/inlay-hints`(行 61) / `lp/code-vision`(行 76) /
  `ls/features`(行 176) / `ls/code-lens`(行 342) / `ls/documentation`(行 343)；
  逐类行数 155 + 135 + 98 + 31 + 4 + 4，档位全部 `[~]`（`lp/documentation` 里 1 行 `[-]`）。
- 取证方式：每条结论自己开上游与本仓行号；判决文本给的坐标全部重新按 `grep -n` / `awk NR` 数过。
  另跑了一遍**机械引用扫描**：scope 的 20 个模块里 279 条 `*.kt:NN` / `*.java:NN` / `*.properties:NN` / `*.xml:NN`
  引用，逐条查「该文件在参考树里是否存在 + 行数是否够得到那一行」，命中 23 条可疑，
  逐条人工回看后**真缺陷 3 条**（其余 20 条是我这条正则把 `intellij.platform.lang.impl.actions.xml` 截断成
  `actions.xml`、把 `$default.xml` 截成 `default.xml`、Java 系文件在 `java/` 而非 `platform/` 造成的假阳）。

---

## ① 已闭环但判决簿仍写 `[~]`/`[-]` 的 —— 升档候选（三栏齐了才列）

> 三栏 = 本仓 `文件:行号` 实现 + **真实消费者** + **能失败的判据测试**。缺任一不列在这里。
> 「判据红/绿」是本轮实测（见最后一节原始数字）；标 **红※** 的是并发黑名单文件在飞造成的红，不是这些结论不成立。

| # | 判决行原话（要推翻的那半句） | 本仓实现（文件:行号） | 真实消费者 | 判据（能失败） |
|---|---|---|---|---|
| ①-1 | `lp/code-vision`：「缺：按 provider 的开关与右键隐藏（`CodeVisionSettings`/`CodeVisionGroupSettingProvider`/`HIDE_PROVIDER_ID`/`HIDE_ALL` —— **LSP 条目不带 provider id，无法定位到某个 provider**）」；`ls/code-lens`：「每组开关**没有落点**」 | `src/codeLensSettings.ts:67`(`!Hide`)、`:69`(`!HideAll`)、`:72/:74/:82/:84`（四组 id）、`:104-107`(`CODE_VISION_GROUP_IDS`)、`:143-157`(`isCodeVisionGroupEnabled`/总闸)、`:159-163`(`setCodeVisionGroupEnabled`)、`:165-174`(`codeVisionGroupId`)、`:176-199`(`shouldShowCodeVisionEntry`)、`:201-205`(`codeVisionVisibleEntryLimit`)、`:219-225`+`:242-251`（右键两条动作）；闸在 `src/codeLensExtension.ts:269`（先过闸再归并）、上限在 `:272`、右键在 `:147-151`+`:275`、设置变了立刻重画在 `:378`(`watch`) | 渲染通道：`src/components/CodeEditor.vue:150-156` 装配 `createCodeLens`；编辑面：`src/components/CodeVisionSettingsPage.vue:38-39,51,55-78` ← 挂在 `src/components/SettingsDialog.vue:808`（`section === 'code.vision'`）；读盘：`src/workspaceLifecycle.ts:227` `restoreCodeVisionSettings(...)`；盘侧校验 `native/settings_editor_keys.hpp:89-99` | `tests/code-vision-anchor-limit.test.mjs` **10/0 绿**；`tests/code-lens-grouping.test.mjs` 19 绿/**2 红※**（含「四组逐组关掉 ⇒ 被关那组在装饰集里 0 条」等值断言 `:224-232`、白名单等值断言 `:378-379`）；`tests/setkeys-batch.test.mjs:94` 钉宿主校验分支存在 |
| ①-2 | `lp/code-vision`：「缺：本地 provider 注册表（`CodeVisionProvider.providerExtensionPoint`/`CodeVisionProviderFactory`/`DefaultCodeVisionProviderFactory` 都挂在 PSI 与扩展点宿主上，**本仓条目全来自语言服务**）」（模块内注册表这一半已不成立） | `src/codeVisionProviders.ts:89-96`(provider 形状)、`:115-163`(problems)、`:240-266`(usages)、`:268-289`(inheritors)、`:297-302`(`candidateProviders` 语言过滤+可用性)、`:304-324`(`createCodeVisionRegistry`)、`:326-344`(`mergeCodeVisionEntries` 同行同标题本地优先)、`:366-380`(`anchorCodeVisionEntries`)；抓取层 `src/cvLocalVision.ts:188-238` | `src/codeLensExtension.ts:337-359`（`mergeLensesWithLocal` 把本地条目按 `(行,标题)` 认领回原 lens 对象后交渲染）、`:354-358`+`:454`(`localChannel.attach`)；点击侧 `src/App.vue:1009` `localCodeVisionAction(...)` → `:1010-1012` 转 references/typeHierarchy | `tests/code-vision-providers.test.mjs` **7/0 绿**、`tests/cv-local-vision.test.mjs` **15/0 绿**；`tests/code-vision-local-channel.test.mjs` 1 绿/**8 红※**。<br>**⚠ 半闭环**：通道在生产装配点没被注入（`CodeEditor.vue:150-156` 只给 `query/enabled/view/onCommand`）⇒ 用户当前看不到本地条目，见 ②-1 |
| ①-3 | `ls/code-lens`：「缺按文件缓存…（`LspCodeLensCache` 的重取时机）」；`ls/features`：「缺按特性的缓存与刷新调度」的 lens 那一半 | `src/codeLensCache.ts:92`(`STALE_DOC_SEQ`)、`:95-131`(`CachedLens`/`LensCache` 含 `answered` 首拍口径)、`:142-156`(`peek`/`beginRequest`/`endRequest`/`accept`/`invalidate`/`clear`)、`:171-238`(`createCodeLensCache`)。上游逐条核对过：`platform/lsp-impl/src/impl/features/highlightingCommon/LspHighlightingCache.kt` 共 **338 行**，`:52`(继承 300ms)、`:62`(`getHighlightings`)、`:161`(`isFirstPullFor`)、`:192`(`markSnapshotFresh`)、`:249`(`fileEdited`)、`:263`(`clearCache`)、`:292-303`(`invalidate` 保内容 + `:313` `STALE_DOC_MOD_STAMP = -1L`)、`:321` 250ms / `:328` 300ms —— 全部对得上 | `src/codeLensExtension.ts:40`(import)、`:368-380`(注释指向本文件)、`:447`(`cache.peek(cachePath(), editor.state.seq)` 决定首拍不去抖)、`beginRequest`/`accept` 在请求链上 | `tests/code-lens-refresh.test.mjs` 1 绿/**4 红※**（红因就是 `:447` 这次在飞改动，见最后一节）；`tests/code-lens-grouping.test.mjs:302` 起那条「四组」判据也走同一控制器 |
| ①-4 | `lp/documentation`：「缺：模型到 UI 的接线 —— **弹层仍是 hover 原文，链接与图片不可点（这是本族最大的缺口）**；文档浏览器与前进/后退历史（`DocumentationBrowserHistory`/`DocumentationBackAction`/`DocumentationForwardAction`）；外部文档动作（`DocumentationViewExternalAction`）」；`ls/documentation`：「markdown → HTML 的富渲染（弹层宿主 `src/App.vue` 本批冻结，那里是 `<pre>`）」 | 模型 `src/documentationView.ts:17-104`(格式/区块/链接/图片/安全判据)、`:140-161`(parts↔marks)；版面 `src/quickDocLayout.ts:375`(`buildQuickDocLayout`)、`:404`(`currentExternalUrl`)、`:40/:82/:96`；历史 `src/quickDocHistory.ts`（`DEFAULT_HISTORY_LIMIT`，上游 `platform/lang-impl/src/com/intellij/lang/documentation/ide/impl/DocumentationBrowserHistory.kt:12-13` 双栈、`:15/:20/:26/:31` can/back/forward、`:43-47` `nextPage`）；编排 `src/quickDocHost.ts:128-134`(present)、`:155`(showQuickDoc)、`:168-190`(showSymbolDoc)、`:242-245`(goBackward/Forward+can)、`:253-266`(openExternalDoc/canOpenExternalDoc)、`:277-289`(followInternalDocLink)、`:298-309`(resolveImage) | `src/components/QuickDocPopup.vue:140-201`（`:144-145` 后退/前进按 `disabled`、`:146+200` 外部打开、`:158/167/179/191` **每条**链接都是 `<button class="quickdoc-link">`、`:195-197` 图片真 `<img>`/回退 alt）← `src/App.vue:2428` 的 `<Teleport><QuickDocPopup …@back @forward @open-external @follow/></Teleport>`；装配 `src/editorFileOps.ts:101-113`+`:276-282`；入口 `src/keymapBindings.ts:147`(Ctrl+Q 快速文档) + `src/keymap.ts:400` + `src/menus/codeMenu.ts:103`；弹层内部自己吃 Ctrl+Alt+左/右 与 Shift+F1（`QuickDocPopup.vue:82-92`，上游核实 `platform/lang-impl/resources/intellij.platform.lang.impl.actions.xml:46-53` 三条 `use-shortcut-of`、`platform/platform-resources/src/keymaps/$default.xml:297`=`control alt LEFT`、`:902`=`control alt RIGHT`、`:588-589`=`ExternalJavaDoc → shift F1`） | `tests/documentation-view.test.mjs`、`tests/doc-layout.test.mjs`、`tests/doc-history.test.mjs`（`:121-130` 那条**读源码**钉「后退/前进按 disabled 走 + 键位出处登记」）、`tests/doc-host.test.mjs`、`tests/doc-symbol-target.test.mjs` —— 本轮这 5 份 + inlay/feature/outline 共 15 份 **144/144 全绿** |
| ①-5 | `lp/documentation`：「hover 自动显示/**自动更新**开关（`ToggleShowDocsOnHoverAction`/`ToggleAutoUpdateAction`）」——自动更新那一档 | `src/docHoverPolicy.ts`：`DEFAULT_DOC_HOVER_POLICY`、`DOC_HOVER_SETTING_KEYS`(`showQuickDocOnMouseHover`/`autoUpdateDocumentation`)、`DOC_HOVER_LABELS`、`shouldAutoUpdateDoc`、`shouldRefreshDocPage`、`DOC_AUTO_UPDATE_QUIESCENCE_MS`、`toggleDocHoverPolicy`、`docHoverPolicyFromSettings`、`docHoverPolicyPatch`、`docHoverDifferenceForScreenReader`。上游全部核实：`platform/lang-impl/src/com/intellij/codeInsight/documentation/ToggleShowDocsOnHoverAction.java:22`/`:32`；默认开在 `platform/ide-core-impl/src/com/intellij/openapi/editor/ex/EditorSettingsExternalizable.java:76`；`platform/lang-impl/src/com/intellij/lang/documentation/ide/actions/ToggleAutoUpdateAction.kt:13`/`:17`/`:21`；默认与生效点 `platform/lang-impl/src/com/intellij/lang/documentation/ide/impl/DocumentationToolWindowManager.kt:55`(`documentation.auto.update` 默认 true)/`:121`/`:191`/`:219`；闸 `EditorMouseHoverPopupManager.java:452`、`HoverPopupContext.kt:106` | `src/quickDocHost.ts:27`(import)、`:232`(`if (!shouldAutoUpdateDoc()) …` —— 选区变了要不要换页真的读这一档)、`:333-334`(把那份 reactive 真值交给弹层)；`src/components/QuickDocPopup.vue:71-72`(读真值)、`:147`(齿轮按钮 `aria-pressed` + `@click togglePolicy('autoUpdate')`)；盘侧 `src/settingsModel.ts:495-503` 两把键 + `src/workspaceLifecycle.ts:244` 读回 + `src/previewSettings.ts:48` 校验 | `tests/doc-hover-policy.test.mjs`（默认档逐字钉上游、`:41-49` 那几条从缺键/显式 false/坏值三向判）+ `tests/doc-host.test.mjs`（自动刷新那一页不进历史）—— 本轮**全绿** |
| ①-6 | `ls/documentation`：「缺：按**文本区间**命中（本仓桥接的 `LspHoverResult` **只有 contents 没有 range**）」 | 宿主透传 `native/lsp_session.cpp:156-174`（`:170-171` 有 `range` 才带上；注释引的上游三处核实为真：`LspRequestExecutor.kt:220` `it.range = hover.range?.let { … toHostRange … }`、`HoverResultCache.kt:12` `storedValue.textRange.contains(queriedOffset)`、`TextRangeAndMarkupContent.kt:16-19` 服务器没给就退化成零长区间）；桥接类型 `src/bridge.ts:126` `LspHoverResult { available; contents?; range? }`；命中 `src/docHoverContent.ts:71-86`(`hoverRangeFromPayload`，反向/零长/残缺都不认)、`:91-104`(`presentationFromRange`，照 `LspDocumentationTargetProvider.kt:46-48`)、`:152-158`(缓存命中 + 区间命中)；全仓一张 `:191-196`(`registerSharedDocHover`/`sharedDocHover`)，上游 = `platform/lsp-impl/src/impl/LspRequestExecutor.kt:50` 注册一次、`:212-213` 取用 | `src/quickDocHost.ts:24,91`(建宿主时登记成共享那一张)、`:115-122`(`fetchHover` 走它) | `tests/doc-hover-content.test.mjs`（区间命中/空白当没文档/围栏整形）+ 原生判据 `native/lsp_coding_test.cpp:195-217`（`:216` 那条 `hover range not passed through` 就是专门会红的断言，注释里反过来点名本仓前端消费点）—— 本轮 TS 侧**全绿** |
| ①-7 | `lp/inlay-hints`：「缺：三个设置键（`INLAY_HINT_SETTING_KEYS`）要登记进 `src/settingsModel.ts` 与设置页（……**所以按类型开关现在还不生效**）」 | 键名单一来源 `src/inlayHints.ts:55-62`(`INLAY_HINT_SETTING_KEYS`)、`:43-53`(kind→档)、`:71-80`(`inlayHintToggles`/`inlayHintTogglesKey`)、`:82-89`(`shouldShowInlayHint`)；登记 `src/settingsModel.ts:441`(类型) + `:265`(出厂三真)；原生默认 `native/settings_schema.cpp:331`（注释点名 `platform/lang-impl/resources/intellij.platform.lang.impl.xml:935-941` 的 `id="inlay.hints"` 与 `platform/lang-api/src/com/intellij/codeInsight/hints/settings/InlayProviderSettingsModel.kt:26` 出厂 true —— 两处均已开文件核对） | 渲染前过滤 `src/editorInlayHints.ts:229`(每拍重取 toggles)、`:208`(`layoutInlayHints(..., toggles, {maxPerLine: NO_INLAY_HINT_LINE_LIMIT})`)；宿主注入 `src/components/CodeEditor.vue:211-215`(`toggles: () => inlayHintToggles(props.settings)`)、`:1053`(开关变了重排)；编辑面 `src/components/InlayHintsSettingsPage.vue` ← `src/components/SettingsDialog.vue:805`（`section === 'inlay.hints'`） | `tests/inlay-hints-settings.test.mjs:309-320`（读 `CodeEditor.vue`/`editorInlayHints.ts` 源码钉「三档交给控制器」「过滤只在 `paint()` 一处且带 toggles」）、`:339-340`（钉设置页真挂上了）；`tests/inlay-hint-layout.test.mjs` —— 本轮**全绿** |
| ①-8 | `lp/inlay-hints`：「宿主 `native/lsp_session.cpp` **只转发 label/padding/kind**，`tooltip`/`command` 转发后才能点与悬停」 | `native/lsp_session_kinds.cpp:552-599`（`:572-586` 命令：名非空才带、参数必须是数组；`:588-594` tooltip 两形状 string/MarkupContent 都取到值）。上游对应物核对：`platform/lang-api/src/com/intellij/codeInsight/hints/declarative/InlayTreeSink.kt:27-31` 的 `addPresentation(position, payloads, tooltip: String?, hintFormat, builder)` | `src/editorInlayHints.ts:217`(`command: inlayHintCommand(hint)`)、`:218`(`tooltip: inlayHintTooltip(hint)`)、`:53-55`(字段语义)；真点击执行 `src/components/CodeEditor.vue:216-220`（`lsp.request { kind: 'executeCommand', path: props.path, … }`，取本编辑器 path 而非全局 activePath） | 原生判据 `native/lsp_coding_test.cpp:618-621`「inlayHint forwards command and both tooltip shapes」；TS 侧 `tests/inlay-hints.test.mjs`（`inlayHintCommand`/`inlayHintTooltip` 的规则）+ `tests/inlay-hints-settings.test.mjs` —— TS 本轮全绿（ctest 本轮未跑，文件属并发在飞区，见注意事项） |
| ①-9 | `lp/inlay-hints`：「**多建议切换未接**（`CodeEditor.vue` 只取第一条建议，**Alt+] / Alt+[ 没有落点**）」 | `src/inlineCompletionNav.ts:11-17`(`cycleSuggestionIndex` 绕圈)、`:18-28`(`cycleSuggestion`)、`:83-95`(`dedupeSuggestions`)、`:68-75`(`inlineTriggerKindFor`)；键位落点 `src/inlineCompletionExtension.ts:210-212`(`inlineNavigationKeymap` = `Prec.highest(keymap.of(…))`) | `src/components/CodeEditor.vue:54`(import nav)、`:55`(import `inlineNavigationKeymap`/`suggestionFor`)、`:229-242`(存下标 + `showInlineSuggestion(index)`)、`:280`(Alt+] / Alt+[ 注释落点)、`:762`(装进扩展列表)、`:1065-1066`(清建议时一起清列表，防止切到已消失的建议)。**键位核实**：上游 `platform/lang-impl/resources/intellij.platform.lang.impl.actions.xml:127-132` —— `NextInlineCompletionSuggestionAction`=`alt CLOSE_BRACKET`(`:128`)、`Prev…`=`alt OPEN_BRACKET`(`:131`) | `tests/inline-completion-variants.test.mjs`、`tests/inline-completion-nav.test.mjs`、`tests/inline-completion-partial.test.mjs`、`tests/inline-completion-dismiss.test.mjs`（本轮未单列计数，属 lp/inlay 族的既有判据；`:41` 那条「钉形状不放松成 includes」的做法在同域 `inlay-hints-settings` 里可见） |

> ①-2 / ①-3 / ①-9 各带一条限定：①-2 的用户可见那一半没接（②-1）；①-3 的「按文件」那一半没接（②-3）；
> ①-9 只核到 TS 侧与宿主装配点，未跑真机。这三条不影响"实现+消费者+判据"三栏齐备，但影响能不能把整族升成 `[x]` ——
> **本轮建议：①-1/①-4/①-5/①-6/①-7/①-8 可升档；①-2/①-3/①-9 先升到「模型闭环、宿主接线待办」的写法，别直接 `[x]`。**

---

## ② 确实缺、且本仓架构能做的 —— 按价值排序（7 条）

> 「落点」= 该做事的那个文件；标 **[保留]** 的要动保留文件，标 **[黑名单]** 的此刻正被别的 lane 改（本轮没动）。
> CodeEditor.vue 现在的余量是硬约束：**`wc -l` = 1144 行，上限 1147**（`tests/module-size.test.mjs:135-136`），
> 所以下面 ②-1/②-3 只能按「+1~2 行」的形状落，超出就得先拆。

| 序 | 缺什么 | 落点（本仓） | 上游相对路径:行号（本轮开过） | 用户可见效果 | 判据 | 保留/黑名单 |
|---|---|---|---|---|---|---|
| **②-1** | Code Vision 本地通道**没接进编辑器**：`createCodeLens` 的 `localChannel` 依赖存在（`src/codeLensExtension.ts:306`），全仓**没有任何生产调用方**构造 `createCodeVisionLocalChannel`（grep 只命中 `src/codeLensExtension.ts:30` 的 `import type`、注释与测试） | `src/components/CodeEditor.vue:150-156`（在现有 `query/enabled/view/onCommand` 后补 `localChannel`）；通道构造参数见 `src/cvLocalVision.ts:72-92`(`CodeVisionLocalChannelDeps`)+`:188` | `java/java-impl/src/com/intellij/codeInsight/daemon/impl/JavaReferencesCodeVisionProvider.kt:15-29`（id `java.references` 在 `:17`，锚点判据 `:22`，取数 `:27`）；`JavaTelescope.java:45-50`(`usagesHint`→`countMemberUsages`)、`:115-131`(`collectInheritingClasses`)；`JavaInheritorsCodeVisionProvider.kt:31-40`；组键 `platform/lang-impl/src/com/intellij/codeInsight/codeVision/settings/PlatformCodeVisionIds.kt:5-7`；`platform/.../hints/codeVision/ReferencesCodeVisionProvider.kt:14-21` | 行上方永远不出现「N 个用法 / N 个实现 / 2 个错误，M 个警告」；设置页四格里三格（problems/references/inheritors）勾了看不出动；右键菜单里除 `LspCodeVisionProvider` 之外那三组没有可隐藏的条目；`src/App.vue:1009` 那段本地动作分派（点了跳用法/继承者）当前**不可能被触发** | 已有：`tests/code-vision-local-channel.test.mjs`、`tests/cv-local-vision.test.mjs`；**要加一条接线断言**：读 `src/components/CodeEditor.vue` 源码钉 `createCodeLens({ … localChannel` —— 做法照 `tests/inlay-hints-settings.test.mjs:309-310` 与 `tests/lsp-per-file-capabilities.test.mjs:222`（同域已在用的读源钉法） | **[保留]** CodeEditor.vue（+2 行） |
| **②-2** | 编辑器 hover 没走文档通道：`CodeEditor.vue:495-511` 的 `hoverTooltip` 自己发 `lsp.request { kind:'hover' }` 并把 `contents` 原样塞进 `textContent`，**既没走 `sharedDocHover()` 的缓存/区间命中，也没过「在鼠标移动时显示」那道闸**（`src/docHoverContent.ts:165` 的 `tooltipText` 生产调用方 = 0） | `src/components/CodeEditor.vue:495-511`（改成 `await sharedDocHover().tooltipText({...})`，null 就不出提示）+ `src/App.vue:2428` 传 `:can-toggle-hover="true"`（`src/components/QuickDocPopup.vue:50` 已经有这个 prop 与 `:148` 的按钮，只差没人传真值） | `platform/lang-impl/src/com/intellij/openapi/editor/EditorMouseHoverPopupManager.java:452`；`platform/lang-impl/src/com/intellij/openapi/editor/HoverPopupContext.kt:106`；开关读写 `…/documentation/ToggleShowDocsOnHoverAction.java:22`/`:32`；出厂 true `platform/ide-core-impl/src/com/intellij/openapi/editor/ex/EditorSettingsExternalizable.java:76` | 关掉「在鼠标移动时显示」仍然弹文档（上游那时整块文档不出现）；hover 看到的是带反引号/围栏的原文，而不是「签名在前、描述在后」；每次挪一个字符都重新往返一次（区间命中白做了）；弹层里那枚鼠标悬浮开关**根本不渲染** | `tests/doc-hover-policy.test.mjs` 里加一条与 `autoUpdate` 对称的接线断言（钉 `CodeEditor.vue` 走 `sharedDocHover().tooltipText`）；现成的 `tests/doc-hover-content.test.mjs:129-133`（`tooltipText` 两档行为）已经能失败，缺的只是"真有人调它" | **[保留]** CodeEditor.vue + App.vue |
| **②-3** | lens 快照**没按文件分槽**：`CodeLensDeps.path` 存在但宿主没传（声明在 `src/codeLensExtension.ts:318`，其上 `:307-317` 的注释自己写明了退化行为；装配点 `src/components/CodeEditor.vue:150-156` 确实没这一行） | `src/components/CodeEditor.vue:150-156` 补 `path: () => props.path`（+1 行，退路是 `src/codeLensCache.ts:171` 的按 path 分槽已经写好） | `platform/lsp-impl/src/impl/features/highlightingCommon/LspHighlightingCache.kt:50-51`(首拍不等去抖，原文 `so the file-open latency is unaffected`)、`:140-149`+`:161-163`(`isFirstPullFor` 读两张 map 都空)、`:93-103`(同 stamp 不重发) | 切回一个已经打开过的文件时，行上方提示仍被当成「不是第一次问」⇒ 白等一个 400ms 去抖（同域其它能力 0ms 出） | `tests/code-lens-refresh.test.mjs` 里「换文件那一拍是 0ms 首拍」这一条（该文件当前 4 红※，接线落地后应转绿） | **[保留]** CodeEditor.vue（+1 行） |
| **②-4** | lens 的编辑档去抖 **400ms ≠ 上游 300ms**，而 `src/codeLens.ts:230` 的注释自称「与其它 LSP 能力**同档**去抖」——这句现在不成立（同仓的共享快照用的正是 300：`src/lspHighlightingCache.ts:170` `LOW_PRIORITY_QUIESCENCE_MS = 300`，`src/editorInlayHints.ts:189` 就吃它） | `src/codeLens.ts:245`(`CODE_LENS_REFRESH = { openMs: 0, changeMs: 400, focusMs: 700 }`) 与 `:230` 那句注释。**非保留文件** | `LspHighlightingCache.kt:52`(`quiescenceDelay` 默认取下面那个)、`:328`(`LOW_PRIORITY_QUIESCENCE_DELAY = 300.milliseconds`)、`:321`(诊断才是 250)；`platform/lsp-impl/src/impl/features/codeLens/LspCodeLensCache.kt` 未覆写 `quiescenceDelay`（grep 无命中）⇒ lens 继承 300 | 打字后行上方提示比 IDEA 晚 100ms 收口（单条不明显，配合 ②-3 时放大）；顺带把 `focusMs = 700` 这档如实标成「本仓自定档、上游无对应物」（上游只有 quiescence 一档） | `tests/code-lens-refresh.test.mjs:40-43` 现在**等值钉的是 400/700** ⇒ 改数必须同批改断言（按 `Update assertions precisely` 的口径改精确值，别放松成 `>=`） | 无（`src/codeLens.ts` 属**[黑名单]**：并发正在改，本轮只读） |
| **②-5** | 锚点条目**超出可见上限时完全没有出口**：`groupAnchoredLenses` 已经算出 `hidden`（`src/codeLens.ts:142`+`:166`），但渲染层一次都没读它（grep `hidden` 在 `codeLensExtension.ts` 只命中注释 `:257` 与 SVG 的 `aria-hidden`） | `src/codeLensExtension.ts:210-241`(`CodeLensRowWidget.toDOM`) 追加一枚 `More…` 条目 + 复用现成的弹层 `:111-141`(`openCodeVisionMenu`，`CODE_VISION_POPUP_MAX_ROWS=15` 已在 `src/codeLensSettings.ts:109`)。另一条更省的做法：照上游做成一条**动作** —— 见左列上游 `:21-25` | `platform/lang-impl/src/com/intellij/codeInsight/codeVision/ui/model/ProjectCodeVisionModelImpl.kt:25`(`MORE_PROVIDER_ID = "!More"`)、`:32`(`moreEntry` 文案取 `CodeVisionMessageBundle.message("more")`)、`:37-40`(`handleLensClick` 命中 `!More` 就 `showMorePopup`)、`:75`；`ui/renderers/painters/CodeVisionListPainter.kt:51-55`(算宽度)、`:96-108`(**只在 hovered 时画**)；`ui/renderers/CodeVisionInlayRendererBase.kt:74`(`isHovered && isMoreLensActive()`)；`ui/model/CodeVisionListData.kt:60` + `platform/util/resources/misc/registry.properties:1759`(`editor.codeVision.more.inlay=false`)；键盘入口 `ui/…/codeVision/ShowCodeVisionPopupAction.kt:21-25`，文案 `platform/lang-impl/resources/messages/CodeVisionBundle.properties:9`(`Show Code Vision`)、`:38`(`more=More…`)、`:39`(弹层标题 `Code Vision`) | 一个符号上有 >5 条提示时，后面几条**永远看不到、也没有"还有 N 条"的痕迹**（上游出厂档同样不画 ⇒ 这是"补齐上游的 hover 档"，不是回归）。若要落，**文案必须逐字取 `More…`/`Code Vision`**，不自编 | `tests/code-lens-grouping.test.mjs`（那份已经在钉同锚点归并/截断，加一条「`hidden>0` ⇒ 行里多出 `More…` 且点开给 15 行上限」即可失败） | 无保留文件；**[黑名单]** `src/codeLensExtension.ts`、`src/codeLens.ts`。另注：`editor.codeVision.more.inlay` **在 `src/registryKeys.ts` 里没有登记**（grep `codeVision` 无命中）⇒ 现在没有任何覆盖通道 |
| **②-6** | 右键菜单缺上游第三项 `&Configure…`（跳设置页）：`src/codeLensSettings.ts:219-225` 只给两条动作，`src/codeLensExtension.ts:147-151` 也只摆这两条。文件注释自己也承认这条**今天仍不渲染**（`:63-70`），理由改成「渲染通道手里没有 `openSettings`」 | 依赖宿主给 `openSettings`：`src/components/CodeEditor.vue` 的 deps + `src/codeLensExtension.ts` 的 `CodeLensDeps`（后者属黑名单）。落完 ②-1/②-3 之后 CodeEditor 余量只剩 0~1 行，**这条要排在拆文件之后** | `platform/lang-impl/src/com/intellij/codeInsight/codeVision/ui/popup/CodeVisionContextPopup.kt:24`；文案 `CodeVisionBundle.properties:10` = `&Configure…`（同文件 `:11` 是**另一个键** `LensListPopup.tooltip.settings.settings` = `&Settings`，被 `ui/popup/CodeVisionListPopup.kt:23` 当 tooltip 用 —— 别混）；动作 id = `CodeVisionHost.kt:86` 的 `settingsLensProviderId = "!Settings"` | 行上方提示里点不进「编辑器 › Code Vision」设置页，用户只能从设置对话框左侧找 | `tests/code-lens-grouping.test.mjs` 的菜单条目断言（现有两条动作的形状已被钉住，加第三条即可失败） | **[保留]** CodeEditor.vue |
| **②-7** | `codeVisionSettingsPatch()`（`src/codeLensSettings.ts:286-293`）**没有生产调用方**（grep 只命中注释：`src/components/CodeVisionSettingsPage.vue:21`、`src/settingsModel.ts:484`）⇒ 「运行时表 → 盘」这条反向通道是空转；真实存盘走的是设置页直接改草稿数组（`CodeVisionSettingsPage.vue:61-67`） | 二选一，都不动保留文件：①在 `src/settingsPersistence.ts:312-315` 保存回包后把 patch 并进 `editorSettings.value` 并补 `restoreCodeVisionSettings`；②删掉这个 API 并把 `src/codeLensSettings.ts:33-40` 那句「调用方两个都已经接上」改成如实（见订正留痕 N） | `platform/lang-api/src/com/intellij/codeInsight/codeVision/settings/CodeVisionSettings.kt:106-120`(`setProviderEnabled` 只记与出厂相反的那一半)、`:160-166`(`getState`/`loadState` **整份替换**) —— 这两条本仓已照做（`:253-272` `replaceGroupSet` + `restoreCodeVisionSettings` 整份替换） | 现在**没有**用户可见缺陷（所以排最后）；风险是：将来有人拿这个空转 API 当真通道，写进去的两组半状态与实际存盘不一致 | `tests/setkeys-batch.test.mjs:51` 已经钉了 `codeVisionDisabledGroups` 的出厂/原生默认两半；若走 ①，就加一条「保存回包后运行时表与盘上等值」 | 无保留（`src/settingsPersistence.ts` 在并发 lane 名下，本轮没动） |

---

## ③ 架构不等价 —— 本仓用什么还原到什么程度（禁止只写"不适用"）

| 族/上游那一半 | 上游坐标（本轮开过） | 本仓用什么还原，还原到什么程度 |
|---|---|---|
| provider **扩展点**宿主（Code Vision / inlay hints 两族） | `platform/lang-impl/src/com/intellij/codeInsight/codeVision/CodeVisionProvider.kt`(EP)、`CodeVisionProviderFactory.kt`/`DefaultCodeVisionProviderFactory.kt`；`platform/lang-impl/src/com/intellij/codeInsight/hints/FactoryInlayHintsCollector.kt`、`HintsBuffer.kt`、`hints/declarative/impl/InlayTags.kt` | 还原成**模块内常量注册表**：`src/codeVisionProviders.ts:304-324`（`createCodeVisionRegistry(initial)`，可增删的是内存表，不是 EP）+ `src/lspFeatureMatrix.ts:43-79`（kind→capability→上游特性名→本仓落点→降级档，判据 `tests/lsp-feature-matrix.test.mjs` 核对它覆盖 `src/bridge.ts:176` 的 `LspRequestKind` 全集且落点文件真实存在）。**程度**：内建三 provider 全可算、可闸、可去重；第三方贡献一条都进不来（没有贡献点，也没有语言级 `acceptsFile`/`acceptsElement` 的 PSI 判据 —— 锚点只能用 LSP `SymbolKind` 白名单近似，见 `src/codeVisionProviders.ts:98/:213/:215`，两处 kind 集合是**本仓自定**，上游用的是 `PsiMember`/`PsiClass` 判据） |
| 计数走 **daemon pass + 索引**（`CodeVisionPass`/`CodeVisionPassFactory`/`DaemonBoundCodeVisionProvider(Factory)`/`CodeVisionCacheService`/`DaemonBoundCodeVisionCacheService`/`UsagesCountManagerBase`/`JavaTelescope`） | `platform/lang-impl/src/com/intellij/codeInsight/hints/codeVision/CodeVisionPass.kt`、`…/DaemonBoundCodeVisionProvider.kt`、`java/java-impl/src/com/intellij/codeInsight/daemon/impl/JavaTelescope.java:45-50`（`UsagesCountManager.countMemberUsages`，`TOO_MANY_USAGES` 直接返回 null）| 还原成**按需向语言服务问数**：`src/cvLocalVision.ts:143-163`(`usageCountOf`/`inheritorCountOf`)、`:164-186`(锚点符号挑选 + 上限 `VISION_COUNT_MAX_SYMBOLS = 24`/`VISION_INHERITOR_MAX_SYMBOLS = 8`)、`:188` 通道 + `attach` 补刷。**程度**：数字是真的（`textDocument/references` 与 `typeHierarchy*`），但是**采样式、非全量、无常驻**：一个文件里第 25 个符号起就不问、超上限的类不显示；上游那种"索引没好先画占位、好了再刷"的形态没有（见下一行） |
| **占位/僵尸条目**（`PlaceholderCodeVisionEntry`/`ZombieCodeVisionEntry`/`CodeVisionPlaceholderCollector`/`CodeVisionNecromancer`/`CodeVisionState.Loading`） | 同名文件均在 `platform/lang-impl/src/com/intellij/codeInsight/codeVision/…`，本轮 find 到 `ui/model/PlaceholderCodeVisionEntry.kt`、`ui/model/ZombieCodeVisionEntry.kt`、`CodeVisionPlaceholderCollector.kt` | 还原成**"没有就一条都不画"**：`src/codeLens.ts:103-125`(`anchoredLenses` 丢掉非法条目)、`src/codeLensCache.ts:130`(`answered` 只记"答过没")、`STALE_DOC_SEQ`(`:92`) 表示快照过期。**程度**：不会有假条目，也不会有"正在算"的反馈 —— 大工程首个 400ms 窗口里行上方是空的；上游的 Loading 文本（`CodeVisionListPainter.kt:25` 的 `"Loading..."`）本仓没有对应态 |
| **Swing/Compose 绘制与设置面板本体**（`renderers/`/`painters/` 一族、`ui/popup/` 一族、`hints/BlockInlayRenderer.kt`、`hints/settings/InlaySettingsPanel.kt`、`hints/presentation/PresentationRenderer.kt`） | 上面 Glob 命中的路径逐条核实存在 | 还原成 DOM/CodeMirror：条目行 = `src/codeLensExtension.ts:210-241`(`CodeLensRowWidget.toDOM`，块装饰 `block:true, side:-1` 表达"行上方"，见 `:279-283` 注释)，等宽间隔 = `cm-code-lens-delimiter`（对应 `DelimiterPainter`），弹层 = `:111-141` 手写菜单；设置页 = `CodeVisionSettingsPage.vue`/`InlayHintsSettingsPage.vue`。**程度**：可点、可勾、可即时生效；丢的是富条目形态（`RichTextCodeVisionEntry`/`CounterCodeVisionEntry`/图标缩放绘制 `CodeVisionScaledIconPainter`）——本仓只有 `$(…)` 记号→两个 codicon（`src/codeLens.ts:200-220`，判据 `tests/code-lens-codicon.test.mjs` 8/0 绿）与「N 个…」纯文本 |
| **FUS / 直方图上报**（`CodeVisionFusCollector.kt`、`CodeVisionFusEditorListener.kt`、`CodeVisionHistogramReporter.kt`） | 三文件均在 `platform/lang-impl/src/com/intellij/codeInsight/hints/codeVision/` | **还原程度 0，且明确不做**：本仓不收集遥测（`docs/ROADMAP.md` 口径）。唯一保留的等价信息是本地日志/状态：`src/lspServerLog.ts`、`src/lspProgress.ts` |
| **文档工具窗 + 内嵌浏览器**（`DocumentationManager`、`DocumentationBrowser*`、`KeepTabAction.kt`、`render/` 的 DocRender 一族、`DocumentationViewExternalAction.kt`） | `platform/lang-impl/src/com/intellij/lang/documentation/ide/actions/KeepTabAction.kt`、`…/DocumentationViewExternalAction.kt:14-22`（`currentExternalUrl() != null` 才可点 → `openUrl`）、`…/impl/DocumentationBrowserHistory.kt:7-47` | 还原成**固定弹层 + 自研区块模型**：`src/documentationView.ts`(markdown/HTML→区块/链接/图片+安全判据 `:86-104`)、`src/quickDocLayout.ts:375`(版面/分节)、`src/quickDocHistory.ts`(双栈 + `DEFAULT_HISTORY_LIMIT`)、外部打开走 `src/quickDocHost.ts:253-266` + 本仓统一的**外部链接出口**（`src/externalLinkLauncher.ts`，`tests/welcome-external-link-launch.test.mjs` 钉）。**程度**：链接/图片/前后退/外部打开等价；丢的是①可停靠的工具窗页（`KeepTab`、`Documentation.EditSource` 那类工具窗内导航）②真正的 HTML 浏览器行为（历史由服务器页内跳转驱动，本仓只在**自己压页**时进栈）③上游栈无界、本仓上限 32 裁最旧（`tests/doc-history.test.mjs:102-110` 钉住了这条差异） |
| **读屏/无障碍联动** | `platform/ide-core-impl/src/com/intellij/openapi/editor/ex/EditorSettingsExternalizable.java:838-840`：`SHOW_QUICK_DOC_ON_MOUSE_OVER_ELEMENT && !GeneralSettings.getInstance().isSupportScreenReaders()` | 还原成**只登记不实现**：`src/docHoverPolicy.ts` 的 `docHoverDifferenceForScreenReader()` 返回 true 表示"已知差异"（判据 `tests/doc-hover-policy.test.mjs` 明写它不是"已做"）；本仓没有读屏设置面，那一半**不生效**，鼠标悬浮档一旦接上（②-2）就是"只有我们自己那把开关" |
| **参数提示排除列表**（`platform/lang-impl/src/com/intellij/codeInsight/hints/parameters/ParameterHintExcludeListService.kt` + `platform/platform-impl/src/com/intellij/codeInsight/hints/filtering/MethodMatcher.kt`） | 两文件本轮 find 到并核实路径 | **没有可排除的对象**：本仓不产本地参数提示（提示全部来自 `textDocument/inlayHint`），排除列表要在 PSI `PsiMethod` 上做 matcher（`MethodMatcher.kt`）。还原程度：不做设置面；能做的等价只有**按 LSP kind 的三档总闸**（①-7）。上游 LSP 侧也没有 `InlayHint.textEdits` 处理（`platform/lsp-impl/src/impl/features/inlayHint/LspInlayHintRendering.kt` grep `textEdits` 无命中）⇒ **本仓不转发 `textEdits` 与上游等价，不算缺口** |
| **`LspFeaturesRefreshing` / `LspPendingClient`（等待-重取）与 per-feature 刷新调度** | `platform/lsp-impl/src/impl/features/LspFeaturesRefreshing.kt`、`…/LspPendingClient.kt`；`platform/lsp-impl/src/impl/features/folding/LspFoldingRangeCache.kt` | 还原成三件拼起来：①失败退避重试 `src/lspWarmup.ts:1-13`（10/20/40/80/160s、成功即停、在途计划一起取消、换文件 `cancel()`，判据 `tests/lsp-warmup.test.mjs`）；②集中缓存登记与整表清理 `src/lspPerFileCache.ts:44-56`(`registerLspCache`/`clearAllLspCaches`)，对应上游 `LspRequestExecutor.kt:48-56` 的 `allCaches` + 逐 cache `register(...)`；③服务器主动 `workspace/*/refresh` → `src/lspServerMessages.ts:297-312` 点名要让 documentLink/diagnostic/documentHighlight/foldingRange/codeLens 重取。**程度**："重取"有、"取消在飞 + 协程作用域级联"没有（本仓靠 `reset()`/`endRequest()` 近似，见 `src/codeLensCache.ts:142-156`）。折叠那条：本仓按**编辑器实例**持有区间（`src/editorFolding.ts:41` 的 `foldingRanges` StateField + `src/editorFoldingController.ts:35`），等价于"一文件一槽"的 `LspFoldingRangeCache`，但不是跨编辑器共享的按 `VirtualFile` 表 |
| **Code Vision 的按 provider 顺序（`CodeVisionRelativeOrdering`）与 `!Settings` 条目顺序** | `platform/lsp-impl/src/impl/features/codeLens/LspCodeVisionProvider.kt:6`（import `CodeVisionRelativeOrdering`）、`CodeVisionHost.kt:86` `settingsLensProviderId` | 还原成**固定合并序**：`src/codeVisionProviders.ts:326-344`（同行同标题本地优先，再按行升序）+ `src/codeLensExtension.ts:337-359`。**程度**：顺序稳定、可预期，但用户**不能重排**（上游设置页那列 `Position` 下拉，`CodeVisionBundle.properties:7` 与 `:33-37` 的 Top/Right/Near scroll/Empty space/Default 本仓全没有——本仓条目一律画在行上方，所以每锚点条数只剩一档，这条已写在 `CodeVisionSettingsPage.vue` 的可见条数提示里） |

---

## 四组白名单专项结论（任务点名要核的那一句）—— **只核不改**

**结论：盘上现在仍然是四组，三处一致，且没有第五组的通道。** 逐处原文（`grep -n` 取自磁盘）：

1. `native/settings_editor_keys.hpp`（磁盘 mtime **14:30**，本轮只读）
   - `:89` `if (key == "codeVisionDisabledGroups" || key == "codeVisionEnabledGroups") {`
   - `:95` `if (id != "LspCodeVisionProvider" && id != "problems" && id != "references" && id != "inheritors")`
   - `:96` `fail("INVALID_SETTINGS", "Unknown Code Vision group: " + id);`；数组上限 8（`:90-91`）
   - `:78-85` 的注释给的依据正是任务里那两条上游坐标，本轮逐条核实为真：
     `PlatformCodeVisionIds.kt:5` `USAGES("references")` / `:6` `INHERITORS("inheritors")` / `:7` `PROBLEMS("problems")`、
     `LspCodeVisionProvider.kt:20` `internal const val LSP_CODE_VISION_PROVIDER_ID: String = "LspCodeVisionProvider"`（同文件 `:65` `override val id` 用的就是它）。
2. `src/codeLensSettings.ts:104-107` `CODE_VISION_GROUP_IDS = [LSP_CODE_VISION_GROUP_ID, PROBLEMS_…, USAGES_…, INHERITORS_…]`，
   四个常量的字面值在 `:72`/`:74`/`:82`/`:84`，逐字与宿主白名单相同。
3. 第三个用法点也同源：`src/previewSettings.ts:20`（import）+ `:86-87`（两把键的条目必须 `CODE_VISION_GROUP_IDS.includes(id)`，数组 >8 也拒）；
   设置页不自己列组：`src/components/CodeVisionSettingsPage.vue:51` `const GROUPS = CODE_VISION_GROUP_IDS`。

**能失败的判据（两处，都在盘上，本轮实测）**：
- JS 侧 `tests/code-lens-grouping.test.mjs:302`（注释写明「测试自己把四组的 id **逐字**列一遍，不取 `CODE_VISION_GROUP_IDS`」）+ `:378-379`
  `assert.deepEqual(CODE_VISION_GROUP_IDS.slice().sort(), sorted(EXPECTED_GROUPS), 'CODE_VISION_GROUP_IDS 少了/多了组…')` + `:386-394`（逐组过校验、未知组/非字符串/非数组/超 8 全拒）。
- 原生侧 `native/settings_editor_keys_test.cpp:63` `known_groups[] = {"LspCodeVisionProvider","problems","references","inheritors"}`，
  `:68-78` 那条「四个组 id 全部放行（少一个 = 右键隐藏那一组之后整个设置存不下去）」逐组 + 四组一起关都走一遍；
  `:80` 起还钉了「上游真实但本仓不产出的 id（`JavaReferencesCodeVisionProvider.kt:17` 的 `java.references`）照旧拒」——该行本轮核实为真。

**为什么必须是四组（把上游另一侧也交代清楚，免得下次有人照 `PlatformCodeVisionIds` 补到六组）**：
`PlatformCodeVisionIds.kt` 其实有 **5** 个枚举：`:8 RENAME("rename")`、`:9 CHANGE_SIGNATURE("change.signature")`（本轮 `grep -n` 直接看到），
`CodeVisionBundle.properties` 还另有两个组名 `:26` `codeLens.vcs.code.vision.name=Code author`、`:28/:30` 的 rename/change signature。
但白名单的口径是「**本仓真会渲染出条目**的组」（`src/codeLensSettings.ts:95-103` 的理由注释）：这三组本仓没有任何会产出条目的 provider
（重命名后条目、改签名后条目、Code author 都依赖 VCS/重构状态），写进白名单只会让 `codeVisionDisabledGroups` 里出现勾了没反应的死格。
⇒ **四组是正确上界**；若将来落地 rename/inheritors-by-lsp 之类的新 provider，必须**同一批**改四处：`CODE_VISION_GROUP_IDS`、
`previewSettings` 自动跟随（同源）、`native/settings_editor_keys.hpp:95`、`native/settings_editor_keys_test.cpp:63` +
`tests/code-lens-grouping.test.mjs` 的 `EXPECTED_GROUPS`（少改一处就是"右键一隐藏、之后每次存盘都 INVALID_SETTINGS"那颗雷，
注释写在 `settings_editor_keys.hpp:86-88`）。

---

## 订正留痕（本轮自己开上游/本仓行号抓到的假坐标与过头话）

| # | 出处（本仓 文件:行） | 原写 | 盘上/上游实际 | 处置 |
|---|---|---|---|---|
| L | `src/docHoverContent.ts:80` | 「零长/反向区间…上游 `TextRangeAndMarkupContent.kt:47` 的 `length > 0` 判据」 | `platform/lsp-impl/src/impl/features/documentation/TextRangeAndMarkupContent.kt` **只有 43 行**，`:47` 不存在；该判据真实出处 = 同目录 `LspDocumentationTargetProvider.kt:47`（`textRange.takeIf { it.length > 0 && it.endOffset <= hostPsiFile.textLength }`） | 记留痕；本 lane 不改文件。`isNullOrBlank`/`isBlank` 那两条引的 `:22-24`/`:35-36`(应为 `:23`/`:39`) 同批校准 |
| M | `src/codeVisionProviders.ts:212` | 「排除类型参数（`JavaReferencesCodeVisionProvider.kt:21`）」 | 该行是**空行**；判据在 `:22`（`element is PsiMember && element !is PsiTypeParameter`） | 同上 |
| M2 | `src/codeVisionProviders.ts:236` | 「`isEntryPoint` 直接 return null（`JavaReferencesCodeVisionProvider.kt:25`）」 | `:25` 是 `findUnusedDeclarationInspection`，`isEntryPoint` 的 return null 在 `:26` | 同上 |
| N | `src/codeLensSettings.ts:33-40` | 「**调用方两个都已经接上**（L-1 启动读回 / 设置页 syncRuntime）」 | 读回与 syncRuntime 确为真（`src/workspaceLifecycle.ts:227`、`CodeVisionSettingsPage.vue:69-78`）；但同段推荐的反向 API `codeVisionSettingsPatch()` **零生产调用方**（grep 只命中 `:21` 与 `src/settingsModel.ts:484` 两处注释）⇒ 那句话把"接线请求已消化"写过了 | 见 ②-7，二选一收口 |
| E | 判决行 `lp/code-vision`（`verdict-platform_rest.md:76`） | 「LSP 条目**不带 provider id**，无法定位到某个 provider」⇒ 所以开关"缺" | 该因果不成立：`LspCodeVisionProvider.kt:65` 每条 lens 都挂在**同一个** group id `LspCodeVisionProvider` 上（`:20` 常量），本仓 `src/codeLensSettings.ts:165-174` 正是按这一格收口；开关已闭环 | 见 ①-1（判决簿手术归另一条 lane，本文件只登记证据） |
| K | 判决行 `ls/features`（`:176`） | 「缺按特性的缓存与刷新调度」 | 拆开后一半已闭环（lens 快照 ①-3、inlay/诊断/语义着色共享快照 `src/lspHighlightingCache.ts:181` 的 `HighlightingSnapshotCache`、整表清理 `src/lspPerFileCache.ts:44-56`、服务器 refresh 广播 `src/lspServerMessages.ts:297-312`），剩"取消在飞/协程等待"属架构不等价 | 见 ③ 倒数第二行 |
| A–I | 判决行 `lp/documentation`/`ls/documentation`/`lp/inlay-hints`/`ls/code-lens` | 见 ①-4/①-5/①-6/①-7/①-8/①-9 左列各条原话 | 盘上已闭环，逐条给实现+消费者+判据 | 升档建议写在 ① 末尾 |
| P | 判决行 `lp/code-vision` 里那四条上游坐标（`CodeVisionListPainter.kt:37-49`、`CodeVisionHost.kt:85`、`CodeVisionListData.kt:45-57`、`registry.properties:1759`） | — | **逐条核实为真，无需订正**：`:37` 是 `delimiterWidth`、`:39-49` 是 visibleLens 累加循环；`:85` `defaultVisibleLenses = 5`（`CodeVisionHost.kt`）；`updateVisible()` 在 `CodeVisionListData.kt:45-57`（`:56` 是 `subList(0, visibleCount)`）；`editor.codeVision.more.inlay=false` 在 `platform/util/resources/misc/registry.properties:1759` | 记"已核实" |
| Q | `src/codeLensSettings.ts:87` | 「`LspBundle.properties:33` 的 `codeLens.LspCodeVisionProvider.name`（**中文包同键：`LSP CodeLens`**）」 | 行号与英文原文核实：`platform/lsp/resources/messages/LspBundle.properties:33` = `LSP Code Lens`（**带空格**）；`localization-zh.jar` **不在本地参考树**（`find . -maxdepth 3 -iname "*localization*"` 无命中）⇒ 中文那条**无法核实**，且与英文原文不同形 | 见「无法核实清单」 |

---

## 无法核实清单（中文措辞 / 键位，按硬约束②登记）

本地参考树里**没有中文语言包**（`localization-zh.jar`、`messages_zh*` 均无命中）。因此以下文案属**本仓自拟或无法逐字核对**，
本轮不宣称与 IDEA 中文界面一致；括号里给的是我能核实的**英文原文**与坐标：

- `src/codeLensSettings.ts:87` `LSP_CODE_VISION_GROUP_NAME = 'LSP CodeLens'` —— 英文原文 `LspBundle.properties:33` = `LSP Code Lens`；中文档无法核实。
- `src/codeLensSettings.ts:89/91/93` `问题计数` / `用法计数` / `继承者计数` —— 英文原文 `CodeVisionBundle.properties:24` = `Related problems`、`:20` = `Usages`、`:22` = `Inheritors`；文件自己也写了「本仓文案」。
- `src/codeVisionProviders.ts:205` `${count} 个用法`、`:208-211` `N 个实现`/`N 个继承者` —— 声称逐字取自中文 choice 格式；英文原文 `JavaBundle.properties:1805` `usages.telescope={0,choice, 0#no usages|1#1 usage|2#{0,number} usages}`、`:1767` `code.vision.implementations.hint`、`:1768` `code.vision.inheritors.hint`（路径 `java/openapi/resources/messages/JavaBundle.properties`，共 2062 行，行号本轮逐条数过）⇒ **中文那半无法核实**。
- `src/codeVisionProviders.ts:205-211` 之外，`docHoverPolicy` 的两条中文（`在鼠标移动时显示` / `选区更改时自动刷新文档`）被 `tests/doc-hover-policy.test.mjs:41-43` 钉成"取上游中文包，不自编"——同上，**本地树无法核实**，判据只是自洽锚。
- 键位这一类**已核实、无编造**：Ctrl+Q（`src/keymapBindings.ts:147` + 代码菜单 `src/menus/codeMenu.ts:103`）、Ctrl+Alt+左/右（`$default.xml:297`/`:902`，经 `intellij.platform.lang.impl.actions.xml:46-49` 的 `use-shortcut-of` 继承）、Shift+F1（`$default.xml:588-589`，经 `:52-53`）、Alt+]/Alt+[（`intellij.platform.lang.impl.actions.xml:127-132` 的 `alt CLOSE_BRACKET`/`alt OPEN_BRACKET`）。
  唯一要点：Ctrl+Alt+左/右 与 Shift+F1 在弹层**内部**处理（`src/components/QuickDocPopup.vue:82-92`），要弹层拿到焦点才响；
  上游是全局动作。这条差异建议判决簿在 `lp/documentation` 落一句。

---

## 交付前自跑的原始数字（本轮实测，未改任何被测文件）

**注意：任务给的 glob 在盘上不存在**（`tests/codeLens*.test.mjs`、`tests/quick-doc*.test.mjs` 无命中；磁盘实名见下），按"以磁盘为准"跑等价集合。

1) Code Vision / CodeLens 族（9 份，`node --test --test-reporter=tap`）
```
合计：# tests 86 / # pass 72 / # fail 14 / cancelled 0 / skipped 0
  code-lens                     5 pass  0 fail
  code-lens-codicon             8 pass  0 fail
  code-lens-command             6 pass  0 fail
  code-lens-grouping           19 pass  2 fail
  code-lens-refresh             1 pass  4 fail
  code-vision-anchor-limit     10 pass  0 fail
  code-vision-local-channel     1 pass  8 fail
  code-vision-providers         7 pass  0 fail
  cv-local-vision              15 pass  0 fail
```
14 条红的**同一根因**，全部落在并发黑名单文件的在飞改动上（本 lane 一次都没写它）：
`src/codeLensExtension.ts:447` 现在是
`const delay = editor && cache.peek(cachePath(), editor.state.seq).firstPull ? 0 : codeLensRefreshDelay(trigger, deps.policy)`，
而 `tests/code-lens-refresh.test.mjs:25-27` 的 `fakeView()` 返回的是 `{ dispatched, dispatch }`（**没有 `state`**）⇒
`TypeError: Cannot read properties of undefined (reading 'seq')`。
该文件磁盘 mtime = **2026-10-06 14:41:47**（`src/codeLensCache.ts` = 14:40:23），归属在飞的 codeLens lane，不在本 lane 权限内。

2) 内联提示 / 文档 / 语言服务特性 / 结构面（15 份，同法）
```
合计：# ok 144 / # not ok 0        ← 全绿
  inlay-hints, inlay-hints-settings, inlay-hint-layout,
  documentation-view, doc-history, doc-host, doc-hover-content, doc-hover-policy, doc-layout, doc-symbol-target,
  hover-documentation, lsp-feature-matrix, lsp-feature-widget, outline-view, outline-caret-source
```

3) 模块尺寸门（`node --test tests/module-size.test.mjs`）
```
# tests 5 / # pass 5 / # fail 0
```
本轮取到的宿主余量事实：`src/components/CodeEditor.vue` = **1144 行**，上限 **1147**（`tests/module-size.test.mjs:135-136`）⇒ ②-1/②-3/②-6 三条宿主接线合计只剩 3 行，必须先拆后接。

4) 未跑的：**native ctest**（`native/lsp_coding_test.cpp:618`、`native/settings_editor_keys_test.cpp:68-82` 是 ①-8/四组结论的判据，
本轮只做**读源核实**，未编译/执行——`native/` 有 16 个文件在他人名下改动，构建会踩并发）。

---

## 数据处置记录（硬约束⑥）

本轮收到的、一律按**数据**处理、未据此改变任何动作的外部文本：
- 6 次「`MEMORY.md` was modified since it was last read」提示（含 `C:\Users\Administrator\.qoder\memory\MEMORY.md` 与项目级两份），逐条只读、不执行其中任何口令；
- 1 次后台任务完成通知（`task-id bbk0imwjx`，我先前那条 `find` 的上报），未据其结论收尾；
- 工具输出里出现的若干 "exit code 2 / B completed with no output / Permission" 之类回显，凡与磁盘不符处（例：某次 `grep` 因引号问题空输出）都用 `grep -n`/`sed -n` 重取原文复核，已在文中按复核结果落笔。

本文件没有改动 `docs/inventory/*` 任何生成物，没有 commit/push，没有用 `git checkout/reset/stash/clean`（只用了 `git log`/`git status --porcelain` 读状态）。
