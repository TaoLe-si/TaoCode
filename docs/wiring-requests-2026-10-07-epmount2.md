# 接线请求 · 第二批（EP 挂载线 2026-10-07 epmount2）

本批把 `src/ideViewExtensionPoints.ts` 的 EP 消费点再往组件里收一层。凡挂点在**禁改文件**
（`src/App.vue` / `src/components/CodeEditor.vue`）上的，按规矩写在这里；能在 `src/**`（组件侧）
真接的都已真接（见下「已落地」）。每条给出：EP / 已就位的消费函数 / 缺的那一步 / 挂点 / 建议改法。

（上一批的 W-EP-1..W-EP-5 现状见 `docs/wiring-requests-2026-10-07-epmount.md`，本批已逐条复核并标注。）

## 本批已落地（不是请求，是已改的代码，列出以便复核）

- **`com.intellij.todoIndexer` 接进 TODO 工具窗口**：新模块 `src/todoIndexerEntries.ts`
  （bundled 那支 `PlainTextTodoIndexer` 按上游类名登记；`providerTodoIndexerPaths` /
  `providerTodoItems` / `mergeTodoItems` 三条入口）→ `src/components/TodoPanel.vue:129-133,106-124`
  （扫描末尾合并第三方索引器条目；**没有第三方索引器时一次读盘都不发**，既有行为零改动）。
- **`com.intellij.undoProvider` 接进文件级撤销/重做**：新模块 `src/undoProviderHost.ts`
  （bundled 那支 `FileUndoProvider` 按上游类名登记，`commandStarted`/`commandFinished` 维护
  「命令内」标志；`runFileUndoRedo()` 围绕一次撤销/重做通知全部 provider）→
  `src/components/FileTree.vue:205-215`（Ctrl+Z / Ctrl+Shift+Z 那条链）。
- **`com.intellij.editorNotificationProvider` 的收集路径真的被走**：`src/bidiNotification.ts` 的
  `bidiPanelForText(text, path, root)` 改为经 `editorNotificationsFor()` 收集后按 id 取内建那支
  —— 第三方按**同一 id** 覆盖它就能换掉双向文本提示的文案（此前是本地硬编码一条）。
- **`com.intellij.usageGroupingRuleProvider` 的 root 可注入了**：`src/referenceContents.ts` 新增
  `setUsageGroupingRoot(root)` / `currentUsageGroupingRoot()`，`referenceUsageTree` 的
  `rules: usageGroupingRulesFor(usageGroupingRoot)` 改读它 —— 宿主那一行是 W2-EP-3。
- **`com.intellij.fileEditorProvider` 的宿主决策面**：`src/fileEditorProviders.ts` 新增
  `editorProviderDecision(input)`（返回 `{providerId, editorTypeId, policy, accepted, suppressed,
  readOnly}`），把 `getProvider` + `getPolicy` + 抑制器判定收成一个函数 —— 宿主那一行是 W2-EP-1。
- **编辑器侧的降级**粒度**纯逻辑侧落点**：`src/largeFileBytes.ts` 新增 `editorLargeFilePlan(policy,
  diskReadOnly)`（把 `features` 的三个分量逐个透出，不再压成一个布尔）—— 宿主那一行是 W2-EP-2。

## W2-EP-1 `com.intellij.fileEditorProvider` 接进打开文件路径（挂点 `src/App.vue:922` `openFile`）

- EP：`com.intellij.fileEditorProvider` + `com.intellij.fileEditorProviderSuppressor`
  （`src/fileEditorProviders.ts`）；**已就位的宿主入口**：`editorProviderDecision(input)`
  （本批新增，`src/fileEditorProviders.ts` 末尾一节）；bundled 贡献是 `src/largeFileViewer.ts` 的
  `LargeFileEditor`（`id === LARGE_FILE_EDITOR_PROVIDER_ID`）。
- 还缺：`src/App.vue:922` 的 `async function openFile(path, internal, options)` 里没有问
  `editorProviderDecision` —— 第三方插件按 id 挂一个「自定义编辑器」（例如给 `.foo` 换一个只读
  查看器）在**非大文件**上仍没有落点（大文件那一半已由 `largeFileBytes` → `largeFileViewer` 走通）。
- 建议改法（一处、约 8 行）：`openFile` 拿到 `doc` 之后、
  ```ts
  const decision = editorProviderDecision({ path, root: workspace.value?.root ?? '', text: doc.content })
  ```
  - `decision.suppressed` 为真 ⇒ 完全走默认文本编辑器（忽略 `providerId`）；
  - 否则 `decision.providerId && decision.providerId !== LARGE_FILE_EDITOR_PROVIDER_ID` ⇒
    把 `decision.editorTypeId` / `decision.policy` / `decision.readOnly` 记在 Tab 上，
    由 `CodeEditor.vue` / `BinaryViewer.vue` 那一层的渲染按 `editorTypeId` 选组件
    （`PLACE_BEFORE_DEFAULT_EDITOR` / `PLACE_AFTER_DEFAULT_EDITOR` 是并存，
    `HIDE_OTHER_EDITORS` / `HIDE_DEFAULT_EDITOR` 是替换）。
- 为什么写在这里：挂点 `openFile` 在 `src/App.vue`（禁改，贴死 2680 行）；渲染选择在
  `src/components/CodeEditor.vue`（禁改，1032 行）。
- 判据：`tests/ep-component-mount.test.mjs` 的 item2b（`editorProviderDecision` 三档：抑制 /
  第三方抢先 / 默认）与 item7（本文件那条锚点）。

## W2-EP-2 大文件查看器的 **features 粒度**（挂点 `src/components/CodeEditor.vue`）

- EP：同 W2-EP-1（`LargeFileEditor`）；已就位的消费函数 `largeFilePolicyForText(text, path, root)`
  （`src/largeFileBytes.ts`，超限后问 EP）与 `editorLargeFilePlan(policy, diskReadOnly)`（本批新增）。
- **已落地的那一半**：`src/largeFileBytes.ts` 的判定过 EP（第三方覆盖/抑制器已能改变 `large.large`）；
  `src/largeFileNotice.ts` 的 `largeFileNoticeText(bytes, path, root)` **已经消费 `features`**：
  它读 `view?.features` 并按**实际关掉的分量**列清单（`featureSummary`：只关 wordWrap 就只写
  「自动换行已关闭」），所以第三方只关一项时**提示条文案已经跟着走**。
- **还缺的那一半（都在禁改文件里）**：
  1. `src/components/CodeEditor.vue:130-131`
     ```ts
     const large = largeFilePolicyForText(props.content)   // ← 应传 props.path 与工作区根
     const heavy = large.large                              // ← features 被丢掉
     ```
     要改成：
     ```ts
     const large = largeFilePolicyForText(props.content, props.path, props.root ?? '')
     const plan = editorLargeFilePlan(large, props.readOnly ?? false)
     ```
     然后把三处 `heavy` 换成 `plan` 的对应分量：
     - `:832` 的 `syntaxHighlighting` 扩展：`plan.syntaxHighlighting` 为假才不进；
     - `:835` 的 `lspExtensions()`：`plan.lsp` 为假才不进；
     - `editorOptions()` 里的 `wordWrap`：`plan.wordWrap`（与 `props.settings.wordWrap` 相与）；
     - `let largeProtected = heavy` → `plan.readOnly`（`:135`）。
  2. `:130` 的调用点只传 `props.content`，没传 `path` / `root`：按路径认领的提供者拿不到路径。
     `largeFilePolicyForText` 的 `path`/`root` 形参已就位（判据里已断言透传），补这一个调用点
     同样要改 `CodeEditor.vue`（禁改）。
  3. `view.readOnly` / `policy` 未消费：本仓大文件一律只读（与上游 `EditorModel.java:1017`
     的 `createViewer` 同口径），`plan.readOnly` 已把它折进去，接线时一并读。
- 为什么写在这里：`src/components/CodeEditor.vue` 是禁改文件（1032 行贴死）。
- 判据：`tests/large-file-bytes.test.mjs`（`editorLargeFilePlan` 的三分量粒度）与
  `tests/ep-component-mount.test.mjs` 的 item9b/item9c。

## W2-EP-3 引用面板的分组规则拿不到工作区根（挂点 `src/App.vue`）

- EP：`com.intellij.usageGroupingRuleProvider`；消费函数 `usageGroupingRulesFor(root)`。
- **已就位**：`src/referenceContents.ts` 新增 `setUsageGroupingRoot(root)` 与
  `currentUsageGroupingRoot()`，`referenceUsageTree` 已改读它（本批新增）。
- 还缺：没有任何地方调 `setUsageGroupingRoot` —— `App.vue` 在**工作区打开/换项目**时应调一次
  `setUsageGroupingRoot(workspace.root)`（`workspace` 是 `App.vue` 里的 ref；调用点可以放在
  `openWorkspace` 那一支，或紧跟现有 `watch(workspace, …)` 那几处）。
  在它落地之前，需要根的分组规则（例如按模块名分组）拿到的仍是空串。
- 为什么写在这里：`referenceContents` 的初始化在 `src/App.vue`（禁改）。
- 判据：`tests/ep-component-mount.test.mjs` 的 item6b（灌根后第三方规则真的拿到根）。

## W2-EP-4 编辑器通知面板的**多面板渲染**（挂点 `src/components/CodeEditor.vue`）

- EP：`com.intellij.editorNotificationProvider`；消费函数 `editorNotificationsFor(input)`
  （`src/ideViewExtensionPoints.ts`）与 `editorPanelsForText(input)`（`src/bidiNotification.ts`）。
- 现状：内建的双向文本提示已经**真的走收集路径**（`bidiPanelForText` → `editorNotificationsFor`，
  第三方按同一 id 覆盖即可换文案）。但**按别的 id 挂的第三方面板**仍没有渲染点：
  `CodeEditor.vue:829` 只装了 `bidiNotificationExtension(...)` 一条。
- 还缺：一个「把 `editorPanelsForText({path, root, text})` 的每一条都画成顶部面板」的扩展
  （上游 `EditorNotifications` 逐 provider 收集 `JComponent` 后叠在编辑器顶部）。
  本仓可照 `src/editorBidiNotification.ts` 的形状写一个 `editorNotificationPanelsExtension(...)`，
  然后在 `CodeEditor.vue:829` 的扩展数组里加一项 —— 那一行在禁改文件里。
- 为什么写在这里：扩展组装点在 `src/components/CodeEditor.vue`（禁改）。
- 判据：`tests/ep-component-mount.test.mjs` 的 item5b（收集路径按 id 覆盖内建文案 + 第三方面板被
  `editorPanelsForText` 收到）。

## 与上一批接线单的关系

- `docs/wiring-requests-2026-10-07-epmount.md` 的 W-EP-1 / W-EP-2 由本批的 W2-EP-1 / W2-EP-2 接续
  （W-EP-2 的第 1 条「消费粒度」= 本批 W2-EP-2；第 2 条「传 path/root」已并入 W2-EP-2 的第 2 点）。
- W-EP-3 由本批 W2-EP-3 接续（纯逻辑入口已就位，只剩宿主一行）。
- W-EP-4（窗格内容差异）与 W-EP-5（TODO 额外位置数据源）本批未动，仍在旧单里有效。
