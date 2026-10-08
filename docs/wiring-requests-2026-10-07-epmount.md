# 接线请求 · EP 消费点接进组件（2026-10-07 epmount lane）

> **状态复核（2026-10-07 epmount2 lane）**：本文件的 W-EP-1 / W-EP-2 / W-EP-3 已由第二批接线单
> `docs/wiring-requests-2026-10-07-epmount2.md`（W2-EP-1 / W2-EP-2 / W2-EP-3）接续并推进：
> · W-EP-2 的第 1 条（消费 `features` 粒度）→ W2-EP-2，纯逻辑侧落点 `editorLargeFilePlan` 已落地；
>   提示条那条链**已确认消费 features**（`src/largeFileNotice.ts` 的 `featureSummary`）。
> · W-EP-1 / W-EP-3 的宿主入口已就位（`editorProviderDecision` / `setUsageGroupingRoot`），只剩
>   `App.vue` 那两行。
> W-EP-4 / W-EP-5 仍未动，仍在本文件有效。

本 lane 把 `src/ideViewExtensionPoints.ts` 里第二批七条 EP + `todoExtraPlaces` 的**消费点接进组件**
（`src/components/**`），凡挂点在**禁改文件**（`src/App.vue` / `src/components/CodeEditor.vue`）
上的，按规矩写在这里。每条给出：EP / 已就位的消费函数 / 缺的那一步 / 挂点 / 建议改法。

（本 lane 已落地的八项与判据见 `docs/inventory/` 与本 lane 的收尾报告，不在此重复。）

## W-EP-1 `com.intellij.fileEditorProvider` 接进打开文件路径（挂点 App.vue / CodeEditor.vue）

- EP：`com.intellij.fileEditorProvider` + `com.intellij.fileEditorProviderSuppressor`
  （`src/fileEditorProviders.ts`）；消费函数 `editorProviderFor(input)` / `editorProviderSuppressed(input)`
  / `editorProviderCatalog()`，bundled 贡献是 `src/largeFileViewer.ts` 的 `LargeFileEditor`。
- 已落地的那一半：`src/largeFileNotice.ts` 的 `largeFileNoticeText(bytes, path, root)` 已改为
  **经 `largeFileEditorViewFor()` 取大小与降级清单**（这条提示由 `CodeEditor.vue:1017` 渲染），
  所以一条第三方提供者/抑制器**已经能改变提示条文案**。判据 `tests/ep-component-mount.test.mjs`。
- 还缺：`src/App.vue:922` 的 `openFile(path)` 里没有问 `editorProviderFor` —— 于是第三方插件
  按 id 挂一个「自定义编辑器」（例如给 `.foo` 换一个只读查看器）在**非大文件**上仍没有落点。
  `openFile` 拿到 `doc` 后应构造 `input = { path, root: workspace.root, text: doc.content, bytes }`：
  - `editorProviderSuppressed(input)` 为真 ⇒ 完全走默认文本编辑器；
  - 否则 `editorProviderFor(input)` 命中且 `id !== 'LargeFileEditor'` ⇒ 按 `getPolicy()` 决定
    是「替换默认编辑器」还是「在默认编辑器之外并存」，把 Tab 的 `editorTypeId` 记下来，
    由 `CodeEditor.vue` / `BinaryViewer.vue` 那一层的渲染按 `editorTypeId` 选组件。
- 为什么写在这里：挂点 `openFile` 在 `src/App.vue`（禁改，贴死 2680 行），渲染选择在
  `src/components/CodeEditor.vue`（禁改，1032 行）。

## W-EP-2 大文件查看器的**只读降级档**改由 EP 决定（挂点 CodeEditor.vue）

- EP：同 W-EP-1（`LargeFileEditor`）；消费函数 `largeFileEditorViewFor(input)`
  （`src/largeFileViewer.ts`），返回 `{ readOnly: true, policy, sizeText, features, notice }`。
- **已落地的这一半（2026-10-07 本 lane 补）**：判定不再本地写死 —— `src/largeFileBytes.ts` 的
  `largeFilePolicyForText(text, path = '', root = '')` 现在先按字节算 `bytes` 与本地档，
  **超限后问 `largeFileEditorViewFor({ path, root, bytes })`**：
  - 没有视图（被抑制器挡住 / 被别的 provider 抢先 / 走了别的档）⇒ 退回本地档，行为与旧版逐字一致；
  - 有视图 ⇒ `degraded = !features.lsp || !features.syntaxHighlighting || !features.wordWrap`，
    `notice` 取视图的（空串则退回本地那句），`features` 原样透给调用方。
  于是第三方按同一 id 覆盖 `LargeFileEditor`（或挂抑制器）**已经能改变编辑器侧的降级结果**
  （`CodeEditor.vue:130` 读的 `large.large` 就是它），不再只影响提示条文案。只挂 bundled 时
  `features` 仍是 `{lsp:false,syntaxHighlighting:false,wordWrap:false}`、`notice` 仍是本地那句，
  与旧行为**逐字一致**。判据：`tests/large-file-bytes.test.mjs`（判定过 EP、第三方全开/部分关/
  抑制器三档）与 `tests/ep-component-mount.test.mjs` 的 item9b。
  为打断 `largeFileBytes → largeFileViewer → largeFileBytes` 的循环，`utf8ByteLength` /
  `formatFileSize` 搬到了新模块 `src/fileSizeFormat.ts`（`largeFileBytes.ts` 原样再导出，
  既有 import 点不动）。
- **还缺的只剩「消费粒度」这一半**（都在禁改文件里）：
  1. `CodeEditor.vue:131` 把结论压成一个布尔 `heavy = large.large`，三件事（语法高亮 / LSP /
     自动换行）一起开关。第三方若只想关一项（例如只关 wordWrap），本仓仍会三项全关 ——
     要消费 `large.features` 的三个分量（`:832` 的 `syntaxHighlighting`、`:835` 的 `lspExtensions()`、
     `editorOptions()` 里的 `wordWrap`），得改 `CodeEditor.vue`（禁改，1032 行贴死）。
  2. `CodeEditor.vue:130` 的调用点只传 `props.content`，没传 `path`/`root`：按路径认领的提供者
     拿不到路径。`largeFilePolicyForText` 的 `path`/`root` 形参已就位（判据里已断言透传），
     补这一个调用点同样要改 `CodeEditor.vue`（禁改）。
  3. `view.readOnly` / `policy` 未消费：本仓大文件一律只读（与上游 `EditorModel.java:1017`
     的 `createViewer` 同口径），优先级低。

## W-EP-3 引用面板的分组规则拿不到工作区根（挂点 App.vue / ToolWindowViewContext）

- EP：`com.intellij.usageGroupingRuleProvider`；消费函数 `usageGroupingRulesFor(root)`。
- 现状（本 lane 已接）：`src/referenceContents.ts` 的 `referenceUsageTree` 已把
  `usageGroupingRulesFor('')` 交给 `buildUsageTree` 的新 `rules` 选项，第三方规则会在
  「目录层与文件层之间」加一层通用组。判据 `tests/ep-component-mount.test.mjs`。
- 缺的那一步：`src/referenceContents.ts` 是纯存储、**没有工作区根**，所以 `root` 只能传空串 ——
  需要根的分组规则（例如按模块名分组）拿不到根。
  建议：`App.vue` 在初始化时调一个新入口 `setUsageGroupingRoot(workspace.root)`（该入口由
  `src/referenceContents.ts` 导出，`referenceUsageTree` 改读它），或把 `root` 塞进
  `ToolWindowViewContext` 由宿主透传。
- 为什么写在这里：`referenceContents` 的初始化在 `src/App.vue`（禁改）。

## W-EP-4 项目视图窗格的**内容差异**（挂点 App.vue / symbolModel）

- EP：`com.intellij.projectViewPane`；`src/projectViewPanes.ts` 已登记 bundled 三支
  （项目 / 包 / 范围）并给出选择宿主 `createProjectViewPaneHost`。本 lane 已把**窗格选择**接进
  `src/components/ToolWindowView.vue` 的齿轮下拉（`paneChoices` / `selectPane`），跨会话持久化。
- 缺的那一步：三个窗格目前渲染的是**同一张树**（`src/components/FileTree.vue`）。上游
  「包」窗格是 `PackageViewPane` 按包/命名空间折树、「范围」窗格是 `ScopeViewPane` 按命名范围筛。
  本仓的包树在 `src/symbolModel.ts`，但它没有接到项目视图工具窗口上。
  建议：`ToolWindowView.vue` 按当前窗格 id 选树数据源（`ProjectPane` → `ctx.treeEntries`；
  `PackagesPane` → 包树；`Scope` → 按选中命名范围过滤），这一步需要宿主（App.vue）把包树
  与范围表递进 `ToolWindowViewContext`。
- 为什么写在这里：包树/范围表的来源在 `src/App.vue`（禁改）。

## W-EP-5 TODO 的额外位置需要「路径」才完整（数据层缺口，不是组件缺口）

- EP：`com.intellij.todoExtraPlaces`；消费函数 `todoExtraPlaceAccepts(path, root)`。
- 本 lane 已接：`src/todoExtraPlaces.ts` 登记了上游那支 `ScratchTodoExtraPlaces`，并给出
  `needsTodoIndex(path, root)` 入口判据，`src/components/TodoPanel.vue` 的扫描结果已过这道门
  （工作区外的标记要么被 checker 认领、要么被挡掉并如实写在状态行里）。
- 数据层还缺的：本仓的 TODO 扫描是 `search.run` 的工作区遍历，返回的都是**根相对路径**，
  所以「额外位置」目前只能在"路径绝对/带 `../`"时才起作用；上游那种
  `IndexableSetContributor` 额外索引集本仓没有对应数据源。这不是组件能补的。
