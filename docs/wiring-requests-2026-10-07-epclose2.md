# 接线请求（2026-10-07 · epclose2：projectviews / daemon 扩展点 EP 化续做）

本 lane 的可改面：`src/ideViewExtensionPoints.ts`、`src/daemonExtensionPoints.ts`、`src/projectTree*.ts`、
`src/projectTreeDecorations.ts`、`src/usageViewGrouping.ts`、`src/workspaceLifecycle.ts`、
`src/bidiNotification.ts`、`src/editorBidiNotification.ts`、`src/inspection*.ts`、
`src/inspectionIdentity.ts`、`src/problems*.ts`、`src/todo*.ts`、`src/notification*.ts`、
`src/command*.ts`、`src/history*.ts`、`src/outlineView.ts`、`src/pvFileUndoProvider.ts`、
`src/symbolModel.ts`，以及 `docs/inventory/**` 的生成物（跑生成器）与 `scripts/verdict_table.py` 里
**本域**的族键。**没动** `src/App.vue`、`src/components/**`、`src/bridge.ts`、`native/main.cpp`、
`scripts/verdict_table.py` 里别人的族键。

下面这几处**数据层已经就位、判据已绿**，缺的只是 `src/components/**` / `src/App.vue`（本 lane 禁改）
里的那一次调用。请组件 lane 按条目接线。

## W-1 `fileIconProvider` 真正画到树行上（FileTree.vue）

- EP：`com.intellij.fileIconProvider`（`treeStructureProvider`…下详）—— 消费函数
  `fileIconFor({ path, isDirectory, flags, root })`（`src/ideViewExtensionPoints.ts`），内建两支
  （外部库 / 临时文件合成根）已登记在 `src/workspaceLifecycle.ts`（`LibrariesFileIconProvider` /
  `ScratchFileIconProvider`），并由 `syntheticIcon()` 消费。
- 缺口：真实文件行的图标仍只走 `src/components/FileTree.vue:291-292` 那两条 `synthetic` 分支，
  第三方 provider 给真实文件返回的图标名没有落点。**请在 FileTree 每一行渲染时调用
  `fileIconFor({ path: row.entry.path, isDirectory: row.entry.kind === 'directory', root })`，
  非 null 时用它代替默认图标**（`flags` 传 0 即可；本仓没有 `ICON_FLAG_VISIBILITY` 的图形变体）。
- 判据（已绿）：`tests/ide-view-extension-points.test.mjs`「FileIconProvider：第一个给出图标者赢…」。

## W-2 `projectViewNodeDecorator` 叠到树行上（FileTree.vue）

- EP：`com.intellij.projectViewNodeDecorator` —— 消费函数 `nodeDecorationFor(node)` /
  `decorationForDiagnostics(node, diagnostics)`（`src/projectTreeDecorations.ts`），内建诊断装饰器
  （`TaoCode.diagnosticNodeDecorator`）已在模块加载时登记。
- 缺口：`src/projectTreeDecorations.ts` 旧的 `decorationOf` / `decorationTitle` 仍是被 FileTree
  直接调的那条；第三方装饰器（`presentableText` / `icon` / `tooltipSuffix`）没有落点。
  **请 FileTree 改调 `decorationForDiagnostics()`**，把返回的 `className` / `tooltipSuffix` /
  `presentableText` / `icon` 叠加到现有渲染上（旧函数保留，行为一致）。
- 判据（已绿）：`tests/ide-view-extension-points.test.mjs`「ProjectViewNodeDecorator：内建诊断装饰已登记…」。

## W-3 `usageGroupingRuleProvider` 接进引用面板（App.vue references 面板 / referenceContents.ts）

- EP：`com.intellij.usageGroupingRuleProvider` —— 消费函数 `activeUsageGroupingRules(root)`
  （`src/ideViewExtensionPoints.ts`）与 `usageGroupingRulesFor(root)`
  （`src/usageViewGrouping.ts`，内建目录 400 / 文件 500 两支已登记）。
- 缺口：引用树的分层仍是 `buildUsageTree` 里写死的「目录 → 文件」两档，第三方的分组规则（例如
  Kotlin 的模块/包分组）没有落点。**请在引用面板组装前把 `usageGroupingRulesFor(root)` 交给
  `buildUsageTree`**（规则按 `rank` 升序、`groupKeyOf` 定组、`labelOf` 定显示名）。
- 判据（已绿）：`tests/ide-view-extension-points.test.mjs`「UsageGroupingRuleProvider：getActiveRules 并起来按档号升序…」。

## W-4 `structureViewExtension` / `psiStructureViewFactory` 接进结构视图面板（OutlinePanel.vue）

- EP：`com.intellij.lang.structureViewExtension` —— 消费函数
  `applyStructureViewExtensions(rows, parent)`；`com.intellij.lang.psiStructureViewFactory` ——
  消费函数 `structureViewBuilderFor(path, language)`（`structureViewRows` 已优先走它）。
- 缺口：`src/outlineView.ts` 的 `arrange` 只按 LSP `documentSymbol` 折层，第三方的结构视图扩展
  （给某类符号补子行）与 PSI 工厂没有落点。**请在 `src/components/OutlinePanel.vue` 把折好的行交给
  `applyStructureViewExtensions` 再渲染**；工厂那一支已在 `structureViewRows` 内接好。
- 判据（已绿）：`tests/ide-view-extension-points.test.mjs`「StructureViewExtension…」「PsiStructureViewFactory…」。

## W-5 `editorNotificationProvider` 的通用挂载点（编辑器顶部横幅）

- EP：`com.intellij.editorNotificationProvider` —— 消费函数 `editorNotificationsFor(...)` /
  `editorPanelsForText(...)`（`src/bidiNotification.ts`），内建双向文本提示已登记.
- 缺口：`src/editorBidiNotification.ts` 只画**内建那一条**（文案已改走 EP：`bidiPanelForText`）；
  第三方 provider 返回的 `{ id, text, actions }` 面板没有通用渲染。**请在编辑器顶部横幅处遍历
  `editorPanelsForText({ path, root, text })` 逐条画**（本仓现有那条 bidi 面板可作为第一条的渲染样板）。
- 判据（已绿）：`tests/ide-view-extension-points.test.mjs`「EditorNotificationProvider…」。

## W-6 `todoExtraPlaces` 接进 TODO 扫描（App.vue / todo pipeline）

- EP：`com.intellij.todoExtraPlaces` —— 消费函数 `todoExtraPlaceAccepts(path, root)`
  （`src/ideViewExtensionPoints.ts`）。
- 缺口：TODO 工具窗口与提交前 TODO 检查（`src/todoScan.ts` / `src/todoView.ts`）只扫工作区内容，
  第三方登记的「额外位置」（上游 `ScratchTodoExtraPlaces` 那一档）没有落点。**请在决定「哪些文件
  进 TODO 扫描」时叠加 `todoExtraPlaceAccepts(path, root)`**（任一为真即收）。
- 判据（已绿）：`tests/ide-view-extension-points.test.mjs`「TodoExtraPlaces：accept 任一为真即真…」。

## 已接线、**不需要**请求的（复核留痕）

- `com.intellij.treeStructureProvider`：已接进 `src/projectTreeModel.ts:49` 的 `nest()`
  （EP 折叠在内建 `nestSiblings` **之前**跑，无 provider 时恒等）。
- `com.intellij.inspectionElementsMerger`：已接进 `src/inspectionProfile.ts:applyInspectionProfile`
  的门控候选键（`src/inspectionIdentity.ts:inspectionKeyCandidates`）。
- `dm/quickfix` 的 Alt+Enter 弹层：`src/components/CodeActionPopup.vue` **已在 `src/App.vue:2643` 挂载**
  （<CodeActionPopup :actions="codeActions" …>），无需新请求。
- `pv/notification` 的 Event Log：`src/components/EventLogPanel.vue` 已在
  `src/components/ToolWindowView.vue:219` 挂载。
- `pv/history` 跨文件会话视图：`src/historySessions.ts` 已被
  `src/components/HistoryPanel.vue:7/102/109` 消费。
