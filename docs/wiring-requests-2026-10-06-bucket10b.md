# 接线请求 · 桶 10b（运行实例 / 控制台 / 终端 / 大文件）2026-10-06

本桶不能动的都是保留文件（`App.vue`/`CodeEditor.vue`/`settingsModel.ts`/`settingsTreeMeta.ts`/`bridge.ts`）或非本桶名下组件
（`SettingsDialog.vue`/`EditorFindBar.vue`/`editorCommands.ts`/`MainToolbar.vue`）。以下每条都**已经在本桶把生产侧准备好**，
只差目标文件那一行/那一格；本桶不自建假消费方。

## 接线请求（给桶 8）

- **目标文件**：`src/App.vue` 第 2648 行（`<RunAnythingDialog … @run-command="payload => { void runExternalTool(payload.command, payload.command); … }"`）
  - **要接什么**：把 payload 的**执行上下文目录**一起交给执行侧 —— `runExternalTool(payload.command, payload.command, payload.cwd)`。
    接收方签名已经就位：`src/runActions.ts:444` 现在是 `async function runExternalTool(command: string, name: string, cwd?: string)`，
    `:465` 发的是 `cwd: cwd?.trim() || workspace.value.root`（没给就退回工作区根，行为与今天一致）。
  - **为什么需要**：Run Anything 的「在项目 / 在模块 / 在浏览过的目录」那格上下文（`src/runAnythingContext.ts` 的 `contextPath()`，属桶 9b）
    现在算了但没人接，命令一律在工作区根跑 —— 用户在 `cd build` 那种多行命令之外的上下文选择是失效的。
  - **同一条的另一半（给桶 9b）**：`src/components/RunAnythingDialog.vue:43` 目前 `emit('runCommand', { command: row.name })`，
    payload 里没有 `cwd`。请把 `contextPath(...)` 的结果一并放进 payload（字段名建议就叫 `cwd`，空/null 表示「用工作区根」）。
    上游对应文件 `platform/execution-impl/src/com/intellij/execution/runAnything/` 在本 checkout **find 无命中** ⇒ 这条按「本仓架构还原用户可见功能」做，不引上游坐标。

- **目标文件**：`src/settingsModel.ts` + `src/settingsTreeMeta.ts` + `src/components/SettingsDialog.vue`（外观/编辑器那一节）
  - **要接什么**：两格设置项，出口本桶已备好，接上就能生效：
    1. **「Ctrl+鼠标滚轮改变终端字号」**（上游 `EditorSettingsExternalizable.java:1043` 的 `isWheelFontChangeEnabled()`）
       ⇒ 把 `src/components/TerminalPanel.vue:81` 那个占位常量 `WHEEL_FONT_ZOOM_ENABLED = true` 换成读设置；
       判定函数本身在 `src/terminalFontSize.ts:79`（`terminalWheelZoomApplies(event, wheelEnabled)`），面板已经在问它。
    2. **「终端基准字号」**（上游控制台字号，`TerminalFontSizeProvider.kt:16-25` 的 `detectFontSize()` 那一档）
       ⇒ 传进 `resetTerminalFontSize(base)`（`src/terminalFontSize.ts:71`）与 `TERMINAL_BASE_FONT_SIZE` 的用法点
       （`TerminalPanel.vue:88-105` 的 `actionContext()` 里 `baseFontSize`）。现在基准是写死的 13。
  - **为什么需要**：没有这两格，滚轮缩放与「复位」只能按内置默认跑，用户改不了，且总闸在上游是可关的。

- **目标文件**：`src/components/SettingsDialog.vue`（配色方案 › 控制台那一节）+ `src/settingsModel.ts`
  - **要接什么**：ANSI 16 色**逐色号**自定义（上游 `JBTerminalSchemeColorPalette.kt:14-26` 逐 ANSI 键从 `EditorColorsScheme` 取值）。
    出口在 `src/terminalColors.ts`：`terminalPalette(theme, defaultForeground, defaultBackground)` 现在只吃默认前后景 + 内置两套表，
    请给它加第四参 `overrides?: Partial<Record<0..15, string>>`，由设置页写入；面板侧无需改（`TerminalPanel.vue` 的 `currentPalette()` 会跟着走）。
  - **为什么需要**：本桶只有内置两套表，用户改不了单个色号 —— 判词 `ex/terminal` 的「按色号的用户自定义」这条**必须**有设置页才成立，
    本桶单独加个没人能写的参数就是死代码。

- **目标文件**：`src/components/CodeEditor.vue`（按键分发/动作那一层）+ `src/editorCommands.ts`
  - **要接什么**：大文件模式下的**动作替换**（上游 `platform/lang-impl/src/com/intellij/largeFilesEditor/PlatformActionsReplacer.java:22`、`:57`
    的 `addEditorActionHandler(actionId, LfeEditorActionHandlerDisabled::new)`；被禁清单见
    `platform/lang-impl/src/com/intellij/largeFilesEditor/actions/LfeEditorActionHandlerDisabled.java:13-17`）：
    查找替换 / Select All Occurrences / Select Next·Previous Occurrence / Highlight Usages / GotoLine 在 `heavy === true` 时禁用，
    Find Next/Previous 换成「只搜不替换」的那一档。
    出口在 `src/largeFileMode.ts`：`largeFilePolicy()` / `src/largeFileBytes.ts` 的 `largeFilePolicyForText()` 已经给出 `features` 三面旗，
    本桶可以再加一张 `LARGE_FILE_DISABLED_ACTIONS` 纯表（等这条被认领再写，避免空转）。
  - **为什么需要**：降级规则只有按键分发层能生效，而 `CodeEditor.vue` 是保留文件、`editorCommands.ts` 不属本桶。

- **目标文件**：`src/components/EditorFindBar.vue`（或 `SearchPanel.vue` 的查找条）+ `src/largeFileNotice.ts`
  - **要接什么**：大文件里勾选「正则」时那条「正则搜索在大文件模式不可用」提示
    （上游 `platform/lang-impl/src/com/intellij/largeFilesEditor/editor/LargeFileRegexSearchNotificationProvider.java:21`）。
    本桶在 `src/largeFileNotice.ts` 里加 `largeFileRegexNoticeText(bytes: number): string`（与现有 `largeFileNoticeText()` 同形），
    渲染点请接查找条的 `role="status"` 那一行。
  - **为什么需要**：本桶没有查找条组件；只加纯函数不接就等于留了个没人调的死分支。

- **目标文件**：`src/bridge.ts` 的 `RunStartParams`（保留文件）
  - **要接什么**：`elevate?: boolean`，由本桶在 `native/run_host.cpp` 侧消费（UAC 拉起 + 输出回传）。
  - **为什么需要**：判词 `exec/run-instances` 的「提权运行」条；上游是
    `platform/execution-process-elevation/src/com/intellij/execution/process/elevation/ElevationDaemonProcessLauncher.kt`（整包 5 个文件，本轮 find 到）。
    **注意**：本仓今天的输出通道是 `run_host` 继承的标准管道，提权进程拿不到同一根管道 —— 这条不是加个参数就能收工，
    需要先定 daemon/命名管道那一层（所以本轮只登记，不动 native）。

## 本桶明确**不请求**的（免得桶 8 白等）

- `Runner.RestoreLayout` / `MinimizeViewAction`：已定不做（理由在 `src/runToolWindowLayout.ts:156-170`，被 `tests/runner-view-actions.test.mjs` 断言）。
- `Runner.FocusOnStartAction`：本轮已登记为第三条不渲染（`src/runToolWindowLayout.ts:172-181`）——
  它作用在 `RunnerLayoutUi` 的多视图格上（`AbstractFocusOnAction.java:20-26`、`:33-36`），本仓运行视图是扁平单标签条，
  接不进任何组件；`RunnerLayoutSettings`/`CustomContentLayoutSettings` 那个「布局设置页」也就没有可设的对象，同源不请求。
- 按页加载的大文件编辑器（`DocumentOfPagesModel.java`）：要改宿主读盘范围（`file.read`），不是一处接线，属独立批次。

## 处理结果（wiring-backlog lane，2026-10-06）

本桶 6 条与 `docs/wiring-requests-2026-10-06-b10audit.md` 逐条同源（该审计文件是它的复核版），状态见该文件的「处理结果」一节。摘要：

- **Run Anything cwd**：已接线（`App.vue:2638` + `RunAnythingDialog.vue:51/:153-154`）。
- **终端两格设置（Ctrl+滚轮 / 基准字号）**：已接线（settingsModel + native schema + SettingsDialog + TerminalPanel + App 挂载）。
- **ANSI 16 色覆盖**：宿主取数已接（`TerminalPanel.vue:351`、`RunConsole.vue:161/:163`），**设置键 `general.terminalAnsiColors` 仍缺**（`GeneralSettingsState` 无该字段）⇒ 需 settings owner + native owner 同批补键。
- **大文件动作替换**：菜单侧本 lane 已接（`App.vue` 的 `editable` 与 `runEditor` 门，`src/largeFileMode.ts:81/:88`）；键位面与查找栏替换行在 `CodeEditor.vue` / `EditorFindBar.vue` 名下 ⇒ 需对应 owner。
- **大文件正则提示 / `RunStartParams.elevate`**：不落（前提不成立 / 缺传输层），维持原判。

App.vue 行数：2677 → 2695（跨本文件与 b10audit 同一批）。
