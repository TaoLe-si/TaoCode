# 接线请求总清单 · 2026-10-05 19:40

> 前面七个工作桶全部交付。这是它们**不能自己做**（文件归属在别人名下 / 落在保留文件里）而交出来的请求。
> 你是**桶 8**，本批最后一个桶 —— 这些请求由你统一落地。
> 每条都带了提出方的上游依据与「为什么需要」，**不要凭猜测实现**，先读那份依据再动手。

## 你独占的保留文件（前七桶全程只读）

`src/App.vue`（2702 行 / 上限 2737，**只剩 35 行余量**）、`src/components/CodeEditor.vue`、
`src/style.css`、`src/tokens.css`、`src/uiIcons.ts`、`src/settingsModel.ts`、`src/settingsTreeMeta.ts`、
`src/bridge.ts`、`src/problems.ts`、`src/semanticActions.ts`、`src/menus/codeMenu.ts`、
`src/menus/editMenu.ts`、`src/lspFeatureMatrix.ts`

> **`App.vue` 的硬约束**：35 行余量。**逻辑一律写进新文件，App.vue 里只做接线**（import + 解构 + 模板一行）。
> 每接一处就 `node --test tests/module-size.test.mjs` 确认还在 2737 以下。

---

## A. `src/App.vue`

| # | 提出方 | 目标 | 要接什么 | 上游依据 / 为什么 |
|---|---|---|---|---|
| A1 | 桶2 | `:2444-2448` | 内联 `quickdoc-popup` div + `<pre>{{ quickDoc.contents }}</pre>` → 换成 `<QuickDocPopup>`；`:1202` 补解构 8 个出口 + import | **这条同时修掉一个类型错误**：`quickDoc` 现在是 `QuickDocPage`（`quickDocHost.ts:33-40` = `{layout,x,y,origin}`），`contents` 字段已不存在 ⇒ `App.vue(2447,48) TS2339` 的根因。而且 `buildQuickDocLayout` 算出的 DocumentationMarkup 布局（签名/分节表/外部链接/图片）现在算完被丢弃，用户只看到一坨原文 |
| A2 | 桶3 | `:2196` 与 `:2220` | `.breadcrumbs` 两处内联模板 → `<BreadcrumbsBar :path :entries :outline :line :language :root-name :active @reveal @navigate="revealLocation" />`（组件已落地 `src/components/BreadcrumbsBar.vue` 173 行） | 规则层全在 `breadcrumbs.ts` + `navToolbarCrumbs.ts` + `navToolbarPresentation.ts`，但渲染冻结在 App.vue；内联写符号段+兄弟下拉+键盘**会超 App.vue 余量**。`line` 是 **1 基**（与 `:556` 喂 `createStickyLines` 的 `currentLine` 同口径） |
| A3 | 桶2 | `:1049-1053` | `createSemanticActions` 解构块补 5 个 + 渲染 `<RefactorPreviewDialog v-if="refactorPreviewState" ...>` | `semanticActions.ts:631-632` 已导出，注释写着「宿主只负责把组件挂上 + 转发动作」。**不接的话重命名从不弹预览**，整个重构预览对话框是死模块 |
| A4 | 桶4 | 状态栏区域 | `inspectionProfile.ts` 的 `currentProfileName()` / `profileNames()` / `selectProfile(name)` 接到状态栏 profile 切换器 | `InspectionProfileImpl.java:87-88`。多 profile 模型与切换语义已全部落地并有测试（`tests/inspection-profile-multi.test.mjs`），缺的只是 UI 挂点 |
| A5 | 桶6 | 调试器工具窗口装配 | `hideDebuggerOnProcessTermination` / `showDebuggerOnBreakpoint` / 逻辑断点组（`XBreakpointGroup`） | 设置键已登记、开关已有（`src/components/DebuggerSettingsPage.vue`），消费点在 App.vue。`dbg/settings` 与 `dbg/breakpoints` 的判词缺口① |
| A6 | 桶7 | `:1205` `createEditorFileOps({...})` | 补 `revealLocation: (...a) => revealLocation(...a)` 与 `workspaceRoot: () => workspace.value?.root ?? ''` | 桶7 已把这两个 dep 转成可选并加降级（缺导航时弹「本宿主没有接上内部链接跳转」）。接上后快速文档的内部链接跳转与工作区外路径判定才真正生效 |
| A7 | 桶7 | `PluginDialog` 挂载处 | `<FileChooserDialog :descriptor @pick @outside @close />` | 组件已落地（树导航/最近/收藏/文件名输入/两种视图模式/大小写冲突检测/覆盖确认），**没有挂载点 = 零消费组件** |
| A8 | 桶1 | `createStickyLines({...})` | 加 `language: () => (active.value ? associationOf(active.value.path, active.value.content) : undefined)` | `tests/tab-sticky-lines.test.mjs:72` 转红；顶边粘性行目前只过通用表，Java 会误认 `struct`（`verdict-platform_rest.md:362` 唯一缺口） |
| A9 | 桶3 | `:2696` `<RunAnythingDialog>` 的 `@run-command` | `payload.cwd` 透传给执行域 | `src/runAnythingContext.ts` 的 Project/Module/RecentDirectory 三类上下文已成型，**只有执行侧不接 cwd**。不接则对话框不渲染上下文选择器（不画没有消费链路的控件） |

---

## B. 宿主类型补齐（这两条会解锁整条功能链）

| # | 提出方 | 目标 | 要接什么 | 为什么 |
|---|---|---|---|---|
| B1 | 桶4 | `src/bridge.ts:117` | `LspDiagnostic` 加 `code?: string \| number` 与 `tags?: number[]` | **`native/lsp_support.cpp:148-149` 已经把这两个字段原样传上来了**，宿主类型却没收 —— 这是 `dm/highlight` 判词「code/tags 不透传」那条阻塞的**唯一真实卡点**（判词本身已过期）。加上之后 `TaggedLspDiagnostic` 就不必做扩展断言 |
| B2 | 桶4 | `src/problems.ts:31-40` 与 `:54-73` | `ProblemRow` 加 `code?: string`，两处 `result.push` 从 `item.code` 透传 | **「诊断码 → IDEA 检查项」这条主杠杆的地基**。没有它，`problemsView.ts` 的分组维度加不了 `'code'`，面板给不出「按诊断码分组」。上游依据 `ProblemsViewState.kt:28` 的 `groupByToolId` |

> B1 + B2 做完后，**请通知我**，我把「按诊断码分组」那条记为已解锁（分组维度 + 面板下拉 + 过滤 + 抑制）。

---

## C. `src/style.css`

| # | 提出方 | 目标 | 要接什么 | 为什么 |
|---|---|---|---|---|
| C1 | 桶2 | `:1300-1302` 附近 | 给 `QuickDocPopup.vue` 的 12 个类名补样式：`.quickdoc-title`、`.quickdoc-origin`、`.quickdoc-definition`、`.quickdoc-content`（`is-text/is-code/is-heading`）、`.quickdoc-sections`、`.quickdoc-section`、`.quickdoc-section-body`、`.quickdoc-links`、`.quickdoc-link`、`.quickdoc-figure`、`.quickdoc-bottom`；另加 `.lsp-hover` | 该组件**没有 `<style>` 块**，这 12 个类名在 `style.css` 里一个都没有 ⇒ A1 接上去就是无样式的裸标记 |
| C2 | 桶3 | 任意位置 | 补 `.crumb-bg-hovered` / `.crumb-bg-current` / `.crumb-bg-inactive` / `.crumb-bg-default` 四条 | `src/navToolbarCrumbs.ts:54-59` 的 `CRUMB_TOKEN_CLASS` 已产出这四个类名，组件同时输出 `data-color-key` 便于核对。**四档的判定顺序照抄 `BreadcrumbsComponent.java:639-661`**（`hovered > selected > (light && !navigation) > DEFAULT`），`navigationCrumb` 只影响 INACTIVE 那一档 |

---

## D. `src/settingsModel.ts`

| # | 提出方 | 目标 | 要接什么 | 为什么 |
|---|---|---|---|---|
| D1 | 桶6 | `RunConfig.type` 联合（`:17-19`） | 联合里加 `'jar'` | `src/runConfigTree.ts:16` 的 `RUN_CONFIG_TYPES` 是 `NonNullable<RunConfig['type']>`，不加联合**编译不过**。加了之后 `RunConfigurationsDialog.vue` 的类型节点与模板编辑器按 `JAR_FORM_FIELDS`（`src/jarRun.ts`）渲染即可。上游 `JarApplicationConfigurationType.java:20` |
| D2 | 桶3 | `EditorSettings` | 加 `showMembersInNavigationBar` + `editor.breadcrumbs` 设置页一行 | 上游 `ViewMembersInNavigationBar`（`intellij.platform.navbar.frontend.xml:58`）。现在符号层只要有 `documentSymbol` 就显示，没有上游那个独立开关 |

---

## E. `src/components/CodeEditor.vue`（桶6 提的一条）

**调试器悬停快速求值**：`dbg/evaluate` 判词缺口①。规则层全齐（延迟 700ms / 弹层上下限 / 同值不重画 / 过期丢弃，在 `src/debugQuickEvaluate.ts`），**只差编辑器悬停通道 + 后台求值节流**。

要接：hover 时取「光标处的词」→ `quickEvaluateDecision(word, { showTooltip, valueLookupDelay })` → 延迟 `delay` 毫秒发 `dap.evaluate` → `acceptQuickEvaluateResult(issued, latest, res)` 过滤过期 → `quickEvaluatePopupSize(...)` 定尺寸 → 用 `QUICK_EVALUATE_TOOLBAR`（`src/debugQuickEvaluate.ts:127`，含 F2 / Ctrl+Enter / Esc）渲染弹层；会话可用性用 `setQuickEvaluateSessionProbe`（`:139`）注入。

上游：`QuickEvaluateHandler.java:17-31`、`XDebuggerTextPopup.java:62-66/218-241`。

> ⚠️ `CodeEditor.vue` 刚被桶1/桶4 改到 **1134 行 / 上限 1147，只剩 13 行余量**。
> **逻辑一律写进新文件**，`CodeEditor.vue` 里只做接线；接完立刻 `node --test tests/module-size.test.mjs`。

---

## F. `src/semanticActions.ts`（桶6 提的一条）

`openCodeActions`（`:343-378`）里与 `:351-357` 的 `suppressionActionsFor` 并列，加一句
`junitQuickFixActions({ path, text: tab.content, diagnostics })`（`src/junitQuickFix.ts:154`）进 `localActions`。

**⚠️ 额外卡点**：`openCodeActions` 只读 `lspDiagnostics`，而本地检查的诊断在**另一张表** `localDiagnostics`（`src/junitInspections.ts:281`），两者只在 `src/problems.ts:48-66` 的 `allProblems` 里并列 —— 接的时候要**一并把 `localDiagnostics` 的对应行喂进去**，否则 JUnit 检查的诊断根本到不了 Alt+Enter（现有的 `suppressionActionsFor` 同理）。

上游：`MisorderedAssertEqualsArgumentsInspection.java:45-47/59-87`、`JUnit3StyleTestMethodInJUnit4ClassInspection.java:32-34`。

---

## G. 已完成、**不需要你做**的（供你写 `App.vue` 时知道已有什么）

- `src/externalSystemSettingsCrc.ts` → `src/gradleHost.ts:519-591`（桶6 已接：CRC 去重）
- `src/externalSystemAutoLink.ts` → `src/gradleHost.ts:642-646`（桶6 已接）
- `src/externalSystemAfterBuild.ts` → `src/runActions.ts:430-435`（桶6 已接）
- `src/fileChooserModel.ts` / `src/fileChooserCase.ts` → `src/fileChooserDescriptor.ts` 的 `confirmOverwrite`（桶7 已接）
- `src/libraryModel.ts` / `src/rootsSdkTable.ts` → `src/externalLibraries.ts` / `src/workspaceLifecycle.ts`（桶7 已接）
- `src/annotatorHighlightLayer.ts` → CodeEditor 扩展数组（桶4 已接）
- `src/inspectionProfileIo.ts` → `src/inspectionProfileHost.ts` → ProblemsPanel（桶4 已接）
- `src/breadcrumbs.ts` / `navToolbarCrumbs.ts` / `navToolbarPresentation.ts` / `runAnythingContext.ts` → **`BreadcrumbsBar.vue` 已接**（桶3 接的），**但 `BreadcrumbsBar` 自己还没挂到 App.vue** ⇒ 就是 A2
- `src/editorExtendSelection.ts` → `src/editorCommands.ts` + `src/menus/editMenu.ts`（桶1 已接）

---

## H. 文本更正（不改行为，只改说错的话）

| # | 文件 | 要改什么 |
|---|---|---|
| H1 | `src/lspFeatureMatrix.ts:44` | `detail` 里「悬停不弹文档；Ctrl+Q 走同一条请求，也保持安静」**与实现矛盾** —— `CodeEditor.vue:518-534` 已经在弹 hover。照实际改写 |

---

## I. 你自己桶里的活（类型错误 + 族缺口）

**当前全仓仅剩 5 个类型错误，全是你的文件**：

| 文件 | 错误 |
|---|---|
| `src/App.vue` | 1（`:2447` 的 `quickDoc.contents` ⇒ **A1 接线后自动消失**） |
| `src/macroHost.ts` | 2（`:53`、`:137`） |
| `src/lsSessionDocuments.ts` | 1（`:33`） |
| `src/dragAndDropTargets.ts` | 1（`:274`） |

你负责的族（判词在 `docs/inventory/verdict-platform_rest.md` 与 `verdict-projectviews.md` / `verdict-ui-tabs-popup.md`）：

`pf/actions`（259 类）、`pf/keymap`（53）、`pf/action-macro`（11）、`pf/trusted`（24）、`pf/general-settings`（7）、`pf/audio-cues`（11）、`pf/browsers`（25）、
`ic/dialogs`（20）、`ici/progress`（8）、`pf/progress`（33）、`pf/dnd`（12）、`ic/dnd`（9）、`ic/wizard`（7）、`pf/wizard`（48）、
`pf/platform-ide`（55）、`ic/application`（13）、`pf/lifecycle`（133）、`pf/startup`（14）、`pf/registry`（5）、`pf/openapi-ui`（48）、
`ex/terminal`（32）、`ex/terminal-actions`（3）、`lp/external-tools`（32）、`lp/file-templates`（36）、`ici/file-templates`（5）、
`lp/microservices`（40）、`ls/platform`（39）、`ls/features`（31）、`ls/session`（14）、
`pv/welcome`（98）、`pv/history`（94）、`pv/structure-view`（94）、`pv/todo`（80）、`pv/notification`（69）、`pv/bookmarks-alias`（5）、
`verdict-ui-tabs-popup.md` 的 6 条（`FileColorManagerImpl.java` / `FileColorsConfigurable.kt` / `DetailController.java` / `ItemWrapperListRenderer.java` / `PopupPositionManager.java` / `PopupUpdateProcessor.java`）

⚠️ 注意 `pf/file-chooser` 已被**桶 7** 做完（族级判词），你不要重复。

## 处理结果（wiring-backlog lane，2026-10-06）

逐条复核（全部**已接线**，由先前的桶 8 / 大组件 lane 落地，本轮无需再改）：

- A1 `QuickDocPopup`：`src/App.vue:2460` 已用 `<QuickDocPopup :layout :origin …>` 替换内联 div，`quickDoc.contents` 的 TS2339 已消失。
- A2 `BreadcrumbsBar`：`src/App.vue:2198`（top）与 `:2225`（bottom）两处均已挂载，含 `:line="… + 1"`、`:show-members`、`@navigate="revealLocation"`。
- A3 `RefactorPreviewDialog`：`src/App.vue:2453` 已挂载。
- A4 `InspectionProfileSwitcher`：`src/App.vue:2361` 状态栏右侧已挂载。
- A5 调试器终止/断点策略：`src/App.vue:276` 已 `watch(dapState.running)` → `applyDebuggerTermination(… hideDebuggerOnProcessTermination)`。
- A6 `createEditorFileOps` 的两个 dep：`src/App.vue:1202-1203` 已补 `revealLocation` 与 `workspaceRoot`。
- A7 `FileChooserDialog`：`src/App.vue:2452` 已挂载。
- A8 `createStickyLines` 的 `language`：`src/App.vue:549` 已补 `language: () => associationOf(…)`。
- A9 `RunAnythingDialog` 的 `payload.cwd`：`src/App.vue:2638` 已透传 `payload.cwd`，且 `:module-roots` 已传。
- B1 `LspDiagnostic.code/tags`：`src/bridge.ts:118` 已有 `code?: string | number; tags?: number[]`。
- B2 `ProblemRow.code`：`src/problems.ts:62` 已有 `code?: string`，`allProblems` 已透传。
- C1 QuickDoc 12 类名样式：`src/style.css` 已含 `quickdoc*` 34 处命中。
- C2 `.crumb-bg-*` 四档：`src/style.css` 已含 5 处命中。
- D1 `RunConfig.type` 加 `'jar'`：`src/settingsModel.ts:31` 已有 `'jar'`。
- D2 `showMembersInNavigationBar`：`src/settingsModel.ts:265/:344` 已登记并有默认值。
- E 调试器悬停快速求值：`src/components/CodeEditor.vue:59/:65/:837` 已装配 `createQuickEvaluateHint`（宿主在 CodeEditor 名下，非本 lane 可改面，但已接）。
- F `junitQuickFixActions`：`src/semanticActions.ts:37/:466` 已接入。
- H1 `lspFeatureMatrix.ts:44` 文本更正：已照实改为「两条都在弹」。

结论：本份 17 条**零待接**，未改任何文件。
