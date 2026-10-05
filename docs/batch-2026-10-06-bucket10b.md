# 桶 10b · 运行实例 / 控制台 / 终端 / 大文件 —— 四个孤儿接线 + 族缺口（2026-10-06）

接手对象：上一轮撞到调用上限被切断的「运行实例 / 控制台 / 终端 / 大文件」代理留下的四个**只有模型、零生产消费方**的模块。
本轮把它们逐个接进真实宿主 `src/components/TerminalPanel.vue` + `src/terminalActions.ts`，并清 `docs/inventory/verdict-platform_rest.md`
（`ex/terminal`、`ex/terminal-actions`、`lp/large-files`）与 `docs/inventory/verdict-execution.md`
（`exec/run-instances`、`exec/ui`、`exec/run-toolbar`、`exec/console`、`exec/target`）里「缺：」的条目。

上游基准树：`D:\Backup\Downloads\intellij-community-master\intellij-community-master`（下列坐标都是本轮亲手打开那一行核对过的）。

---

## 1. 四个孤儿的接线结论

| 模块 | 接线结论 | 生产消费方（文件:行） | 用户可见的东西 | 判据 |
|---|---|---|---|---|
| `src/terminalClipboard.ts`(190) | **已接上** | `TerminalPanel.vue:331`（右键菜单条目）、`:382-392`（`attachCustomKeyEventHandler`）、`:303`（复制进系统剪贴板）、`:319`（历史清单）、`:584/587`（菜单与历史子菜单） | 窗格右键「复制 / 粘贴 / 从历史粘贴」+ 历史子菜单；`Ctrl+C`/`Ctrl+Insert` 复制、`Ctrl+V`/`Shift+Insert` 粘贴；没选区时 `Ctrl+C` 仍送进 PTY 中断命令 | `tests/terminal-clipboard.test.mjs`（9 条，含消费链那条） |
| `src/terminalFontSize.ts`(92) | **已接上** | `TerminalPanel.vue:292`（Ctrl+滚轮那道双条件门）、`:294`（滚轮那一档）、`:279`（放大/缩小）、`:284`（复位）、`:563`（字号读数与 title） | 工具条 `ZoomOut/ZoomIn/RotateCcw` 三枚 + 「13px」读数（临时缩放时 title 写明）；Ctrl+滚轮缩放时**不再滚缓冲区**；越界保持原值 | `tests/terminal-font-size.test.mjs`（8 条） |
| `src/terminalSplits.ts`(132) | **已接上** | `TerminalPanel.vue:206-224`（`split(orientation)`，启用问 `canTerminalSplit`、落点问 `paneIndexAfterSplit`）、`:152`（`terminalGridSize` 排网格）、`:340`（`nextTerminalPaneCell` 跳转）、`:362`（`unsplit`）、`:455`（整组关完清计数）；`terminalActions.ts:43` 起把 5 条动作挂进登记表 | 右侧分屏 + **下侧分屏**（原先只有右侧）、**窗格数不再限死两个**、右键「取消分屏 / 上一个窗格 / 下一个窗格」，多格时按网格并排 | `tests/terminal-splits.test.mjs`（8 条） |
| `src/terminalTitle.ts`(115) | **已接上** | `TerminalPanel.vue:118`（标签文字）、`:119`（tooltip）、`:380`（xterm `onTitleChange` ⇒ `setApplicationTitle`）、`:126`（值没变不重绘）、`:503`（重命名走 `renameTerminal`） | 标签显示「重命名 > shell 自己用 OSC 0/2 设的标题（截断 30）> 终端 N」，tooltip 是不截断的那一条；双击重命名/清空重命名 | `tests/terminal-title.test.mjs`（7 条） |

顺带修掉的一个真 bug：`spawn(group)` 的 `group` 参数以前**没有被传进 `attachPane`**（旧 `TerminalPanel.vue:171-172` 恒 `group: ++groups`），
于是「分屏」开出来的窗格落在**新组**里、`visible()` 直接把原来那格藏掉 —— 也就是右侧分屏从来没真的并排过。
现在 `attachPane(id, defaultTitle, group?)`（`TerminalPanel.vue:397`）接住这个参数，分屏与重启都留在同组。

四个模块头部的「本仓落点」都是真的了；`src/terminalSplits.ts:32-43` 的头部同时订正了上游 `TW.*` 的行号（`:463-472` / `:474` / `:475-478`，本轮打开 `intellij.platform.ide.impl.actions.xml` 数过）。

---

## 2. 族判词表

### `ex/terminal`（32 类，`docs/inventory/verdict-platform_rest.md:172`）

| 项（判词里的「缺」） | 判定 | 上游依据（相对路径:行号） | 本仓落点（文件:行号） |
|---|---|---|---|
| 更多窗格形态：**上下分屏** | 已做 | `platform/platform-impl/resources/intellij.platform.ide.impl.actions.xml:469-472`（`TW.SplitDown`）；`platform/platform-impl/src/com/intellij/ide/actions/ToolWindowSplitActions.kt:15-31`（`splitWithContent(…, SwingConstants.RIGHT｜BOTTOM, -1)`） | `src/components/TerminalPanel.vue:206`、`:217`、`:152`；`src/terminalActions.ts:146` |
| 更多窗格形态：**单标签三栏以上**（原判词写「每个标签最多两个」） | 已做（删掉本仓自加上限） | `plugins/terminal/src/org/jetbrains/plugins/terminal/TerminalToolWindowManager.java:431-434`（`canSplit` 只把 `TW.SplitRight`/`TW.SplitDown` 的可用性原样转出来，**没有数量上限**）；`InternalDecoratorImpl.kt:376-410`（每格还能再分） | `src/terminalActions.ts:133-145`（`MAX_PANES_PER_GROUP` 已删，启用只问 `canTerminalSplit`）；`TerminalPanel.vue:152`（列=1+右侧次数、行=1+下侧次数） |
| 窗格间跳转 / 取消分屏 | 已做 | `intellij.platform.ide.impl.actions.xml:474`（`TW.Unsplit`）、`:475-478`（`TW.MoveToNext/PreviousSplitter`）；`InternalDecoratorImpl.kt:516-534`（`getNextPrevCellImpl` 顺序 ±1、首尾循环、非分屏返回 null） | `src/terminalActions.ts:155/164/173`；`TerminalPanel.vue:340/362`；`src/terminalSplits.ts:99-106` |
| `IdeTerminalCopyPasteHandler`（复制/粘贴规则） | 已做（可核实那一层） | `platform/execution-impl/src/com/intellij/terminal/IdeTerminalCopyPasteHandler.java:12-18`（选区 → `CopyPasteManager`）；`plugins/terminal/resources/META-INF/plugin.xml:128-135`（`Ctrl+C`/`Ctrl+Insert`）；`plugins/terminal/frontend/resources/intellij.terminal.frontend.xml:136-143`（`Ctrl+V`/`Shift+Insert`）；`TerminalCopyTextAction.kt:29-40`、`TerminalCtrlCActionsPromoter.kt:8-18` | `TerminalPanel.vue:303`（复制）、`:306`（粘贴走 `instance.paste` → `onData` → `term.write`）、`:382-392`（四组键）；`src/terminalClipboard.ts:141-166` |
| `Terminal.PasteFromHistory` | 已做 | `intellij.terminal.frontend.xml:144-147`；`plugins/terminal/resources/messages/TerminalBundle.properties:22-23` | `TerminalPanel.vue:319`（`readClipboardHistory()` 来自 `src/clipboard.ts:45`）、`:584`（菜单行）与 `:587`（历史子菜单）、`:312`（条目直接粘进会话） |
| `Terminal.SelectAll`（原判词没列，属同一组菜单） | 已做 | `plugins/terminal/resources/META-INF/plugin.xml:137-141`；`intellij.terminal.frontend.xml:264`（在 `Terminal.ReworkedTerminalContextMenu` 里） | `src/terminalActions.ts:205`；`TerminalPanel.vue:345-348` |
| `Terminal.ClearBuffer` | 已做（一半做不到，见下） | `intellij.terminal.frontend.xml:132-135`、`:266`；`TerminalClearAction.kt:27-31` | `src/terminalActions.ts:214`；`TerminalPanel.vue:352-359` |
| 标签标题链路（原判词没列，但 `TerminalTitle.kt` 就是这个族） | 已做 | `platform/execution-impl/src/com/intellij/terminal/TerminalTitle.kt:78-86`、`:93-98`、`:100-102`、`:112-117`、`:125-137`、`:26-41`；`platform/util/src/com/intellij/openapi/util/text/StringUtil.java:2817-2838`；兜底 `ExecutionBundle.properties:728` | `TerminalPanel.vue:118/119/126/380/503`；`src/terminalTitle.ts:60-115` |
| 字号缩放三件套 + Ctrl+滚轮 | 已做（总闸那一半见「做不到」） | `platform/execution-impl/src/com/intellij/terminal/JBTerminalPanel.java:381-390`；`platform/execution-impl/src/com/intellij/openapi/editor/actions/TerminalChangeFontSizeAction.kt:26-28`、`:57-68`；`platform/editor-ui-ex/src/com/intellij/application/options/EditorFontsConstants.java:11-17`；`intellij.platform.execution.impl.actions.xml:34-45` | `TerminalPanel.vue:279/284/292/294/563`；`src/terminalActions.ts:182/189/196`；`src/terminalFontSize.ts` |
| **ANSI 数据流解析与命令块颜色**（`AppendableTerminalDataStream`/`BlockTerminalColors`） | 做不到 | `platform/execution-impl/src/com/intellij/terminal/AppendableTerminalDataStream.java`（文件存在，本轮 find 到）；块边界来自 shell integration 注入脚本 `plugins/terminal/resources/shell-integrations/`（实测四个目录：bash / fish / powershell / zsh） | 无。卡点：本仓宿主是裸 ConPTY（`native/terminal.hpp` 注释「Bytes are carried untouched in both directions」，起 `%COMSPEC%`，不注入任何 rc/profile）⇒ **没有 OSC 133 的产生者**，命令块的边界无从判定。与 `src/terminalClipboard.ts:180-190` 登记的 `Terminal.CopyBlock` 是同一条卡点，两条都指向「先补宿主侧 shell integration」。 |
| **按色号的用户自定义**（`JBTerminalSchemeColorPalette` 逐 ANSI 键从 `EditorColorsScheme` 取） | 做不到（本轮）| `platform/execution-impl/src/com/intellij/terminal/JBTerminalSchemeColorPalette.kt:14-26` | 只有内置两套表 + 默认前后景（`src/terminalColors.ts`）。卡点：用户改色要有一格 16 色的编辑页；本仓设置页数据在 `src/settingsModel.ts`、树在 `src/settingsTreeMeta.ts`（都是保留文件），渲染在 `src/components/SettingsDialog.vue`（非本桶名下）⇒ **已写进接线请求**。 |

### `ex/terminal-actions`（3 类，`verdict-platform_rest.md:350`）

| 项 | 判定 | 上游依据 | 本仓落点 |
|---|---|---|---|
| 「缺统一动作上下文层」 | **已做**（判词陈旧：`src/terminalActions.ts` 已存在并被面板消费；本轮把这张表从 10 条扩到 19 条） | `platform/execution-impl/src/com/intellij/terminal/actions/TerminalBaseContextAction.java:18-25`（`setEnabledAndVisible(terminal != null)` + `TERMINAL_DATA_KEY`）、`TerminalActionUtil.java:36-40/45-49/68-78` | `src/terminalActions.ts:46-72`（上下文含 `hasSelection`/`historyCount`/`fontSize`/`baseFontSize`）、`:126-236`（19 条）、`TerminalPanel.vue:88-105`（`actionContext()`） |

### `lp/large-files`（76 类，`verdict-platform_rest.md:93`）

| 项 | 判定 | 上游依据 | 本仓落点 / 卡点 |
|---|---|---|---|
| ① 判定按**字节** + `formatFileSize` 进提示 | **已做**（判词陈旧，本轮核实消费方在位） | `platform/lang-impl/src/com/intellij/largeFilesEditor/editor/LargeFileNotificationProvider.java:36-53`（气泡带 `StringUtil.formatFileSize`） | `src/largeFileBytes.ts:29`（UTF-8 逐码点）、`:34`（`largeFilePolicyForText`）、`src/components/CodeEditor.vue:86`（import）、`:129-130`（按字节判定 + 大小）、`:1127-1128`（提示条用 `largeFileNoticeText(largeBytes)`） |
| ② 大文件**只读保护** + 隐藏/不再显示持久化 | **已做**（判词陈旧：说「没有只读/可编辑的切换动作」） | `platform/lang-impl/src/com/intellij/largeFilesEditor/editor/…`；`EditorModel.java:1017`（`EditorFactory.createViewer` 打开即只读） | `CodeEditor.vue:132-136`（`largeProtected` + `applyReadOnly` + `allowLargeEditing`）、`:1128-1131`（解除只读 / 隐藏 / 不再显示三枚）、`src/largeFileNotice.ts:15-45`（`localStorage` 那一档） |
| ③ 大文件模式下的**动作替换**（`PlatformActionsReplacer`） | 做不到（本桶） | `platform/lang-impl/src/com/intellij/largeFilesEditor/PlatformActionsReplacer.java:22`（类）、`:57`（`addEditorActionHandler(actionId, LfeEditorActionHandlerDisabled::new)`）；`platform/lang-impl/src/com/intellij/largeFilesEditor/actions/LfeEditorActionHandlerDisabled.java:13-17` | 卡点：规则表能写，但**生效点在按键分发那一层** —— 本仓键位与分发在冻结的 `src/components/CodeEditor.vue`，动作表在 `src/editorCommands.ts`（非本桶名下）⇒ 已写进接线请求（含建议的规则出口）。 |
| ④ 按页加载的编辑器模型 | 做不到 | `platform/lang-impl/src/com/intellij/largeFilesEditor/editor/DocumentOfPagesModel.java`（本轮 find 到；配套 `LargeFileManagerImpl`/`FileAdapter`/`Page`/`GlobalScrollBar`） | 卡点：本仓整份文本经 `bridge.ts` 的 `file.read` 交给 CodeMirror 单文档；要分页就得改**宿主读盘通道**（`file.read` 的范围读 + 前端按页缓存），`src/bridge.ts` 是保留文件且不在本桶名下。5 MiB 那条降级（①②）已经把用户可见症状压住。 |
| ⑤ `LargeFileRegexSearchNotificationProvider`（大文件里正则搜索不可用） | 做不到（本桶） | `platform/lang-impl/src/com/intellij/largeFilesEditor/editor/LargeFileRegexSearchNotificationProvider.java:21` | 卡点：提示条要挂在查找条上，本仓查找条是 `src/components/EditorFindBar.vue` / `SearchPanel.vue`（都不是本桶名下），本桶只有纯逻辑文件 `src/largeFileNotice.ts` 可写；只加一个没人调的函数就是「只过自己测试的死代码」⇒ 已写进接线请求（规则出口在 `src/largeFileNotice.ts` 里加 `largeFileRegexNoticeText()`，渲染由编辑器桶接）。 |

### `exec/run-instances`（382 类，`docs/inventory/verdict-execution.md`）

| 项 | 判定 | 上游依据 | 本仓落点 / 卡点 |
|---|---|---|---|
| ① `ExecutionListener`/`ExecutionManager` 插件扩展点 | 做不到 | `platform/execution/…` 的 EP 声明（本仓无插件贡献点宿主） | 实例事件在本仓是内部订阅（`src/runInstances.ts` 的 reactive 表 + `src/terminalEvents.ts` 同形），没有第三方贡献者 ⇒ 没有可注册的面。 |
| ② 进程中介 / 远程 / 守护进程执行 | 做不到 | `platform/execution-impl/src/com/intellij/execution/process/mediator/`、`execution/remote/` | 宿主只做本机 CreateProcess（`native/run_host.cpp`），没有远程 runner，也没有 daemon/client 通道。 |
| ③ 提权运行（`execution/process/elevation`） | 做不到（本轮） | `platform/execution-process-elevation/src/com/intellij/execution/process/elevation/ElevationDaemonProcessLauncher.kt`、`ElevationServiceImpl.kt`、`settings/ElevationSettings.kt`（本轮 find 到整包 5 个文件） | 卡点：要 `run.start` 多一个提权参数（`src/bridge.ts` 的 `RunStartParams` 是保留文件）+ 一条提权后的输出回传通道（上游用 daemon + 命名管道）；本仓 `native/run_host.cpp` 是直接继承标准管道，提权进程（UAC 拉起）**拿不到同一根管道**。⇒ 写进接线请求。 |
| ④ 端口监视器 | **已做**（上一轮） | `platform/execution-impl/src/com/intellij/execution/portsWatcher/` | `native/run_host.cpp` 的 `listening_tcp_ports` + `src/runInstances.ts` 合入 + `RunConsole.vue` 的「进程」区，判据 `tests/run-instance-ports.test.mjs` |
| ④′ 运行统计（FUS） | 判定保留（不翻案） | `platform/execution-impl/src/com/intellij/execution/impl/statistics/` 实测 10 个文件都是 `*UsagesCollector` | 本仓不收集遥测（平台族 `statistics` 同一取舍），无用户可见面。 |
| ⑤ Java/JAR 配置形态 | **已做**（表单格待 `'jar'` ⇒ 请求已在上一批） | `java/execution/impl` 的 `ApplicationConfiguration`/`JarApplicationConfiguration` | `src/javaRun.ts`、`src/jarRun.ts`（判据 `tests/jar-run.test.mjs`）；`RemoteRunProfile` 这类远程配置 = ②同一条卡点 |

### `exec/ui`（99 类）

| 项 | 判定 | 上游依据 | 本仓落点 |
|---|---|---|---|
| `Runner.RestoreLayout` / `MinimizeViewAction` | **不做（已定判定，本轮没翻案）** | 理由已导出成常量并被测试断言 | `src/runToolWindowLayout.ts:156-170`；`tests/runner-view-actions.test.mjs:98-113` |
| `FocusOnStartAction` | 本轮登记为**不渲染**（同一条架构卡点，附坐标） | `platform/lang-api/src/com/intellij/execution/ui/actions/FocusOnStartAction.java:21-24`（`super(LayoutViewOptions.STARTUP)`）、登记 `platform/lang-api/resources/intellij.platform.lang.actions.xml:3`（id `Runner.FocusOnStartup`）；`AbstractFocusOnAction.java:20-26`（`content.length == 1` 才显示）、`:28-31`、`:33-36`（`getRunnerLayoutUi().getOptions().setToFocus(content, STARTUP)`） | `src/runToolWindowLayout.ts:172-181` 第三条 `RUNNER_VIEW_ACTIONS_NOT_PORTED`；判据 `tests/runner-view-actions.test.mjs`（断言三条 id 与坐标齐全） |
| `RunnerLayoutSettings` / `CustomContentLayoutSettings` 布局设置页 | 做不到 | `platform/execution-impl/src/com/intellij/execution/ui/layout/impl/RunnerLayoutSettings.java:18-21`（存 `runner.layout.xml`）、`…/layout/actions/CustomContentLayoutSettings.java` | 卡点：设置页三件套（`src/settingsModel.ts`、`src/settingsTreeMeta.ts` 保留文件、`src/components/SettingsDialog.vue` 非本桶名下）+ 本仓运行视图是**一条扁平实例标签**（`src/components/RunConsole.vue`），没有可摆放的视图格 ⇒ 已写进接线请求（一并说明与 `Runner.RestoreLayout` 同源）。 |

### `exec/run-toolbar`（71 类）

| 项 | 判定 | 上游依据 | 本仓落点 |
|---|---|---|---|
| ① `ExecutionTargetsToolbarGroup` 弹层 | **已做**（上一轮） | `intellij.platform.execution.impl.actions.xml:127-129`、`ExecutionTargetComboBoxAction.kt:47/60-63/65/86-104` | `src/executionTargets.ts` + `src/components/MainToolbar.vue` |
| ② Run Dashboard 分组 | **已做**（分组档） | `RunDashboardGroup.java:23-27`、`RunDashboardManager.java:40-44` | `src/runDashboard.ts` + 工具栏弹层 |
| ②′ Services 树 + 自定义规则 | 做不到 | `RunDashboardService`/`RunDashboardCustomizer`（EP） | 卡点：Services 工具窗口不在本桶名下；`RunDashboardCustomizer` 是插件 EP，本仓没有贡献点宿主。 |
| ③ 工具条槽位与拖拽调整 | 做不到 | `platform/execution-impl/src/com/intellij/execution/runToolbar/RunToolbarSlotManager.kt:42`（本轮打开确认类声明） | 卡点：本仓工具条是固定布局的 `src/components/MainToolbar.vue`（非本桶名下）⇒ 若要做，属该文件的槽位改造，本桶只提供动作表（`src/runToolbar.ts`）。 |

### `exec/console`（40 类）

| 项 | 判定 | 上游依据 | 本仓落点 |
|---|---|---|---|
| `useProcessStdIn` 那一半（输入行进运行中进程 stdin） | **已做** | `platform/lang-impl/src/com/intellij/execution/console/ConsoleExecuteAction.java:148-151` | `src/runActions.ts` 的 `sendRunInput` → `run.write` → `native/run_host.hpp:90` `write_line`，可切编码（`src/consoleEncoding.ts`） |
| `addToCommandHistoryAndExecute`（解释器子进程回路） | 有界等价物已存在，完整回路做不到 | `ConsoleExecuteAction.java:113`、`:153`、`:157`（本轮核对到这三行都在） | 卡点：上游这条要 `BaseConsoleExecuteActionHandler` 起一个**解释器子进程**并把片段喂进去、回填输出。本仓今天能用 `run.start` 起交互式解释器（`command: 'jshell'` 之类）并靠 `run.write` 送行 —— 用户可见的「REPL」通道是通的；缺的是上游那半的**补全 / 多行片段折叠 / 独立 console 根类型**（`ConsoleRootType`、`ConsoleOptionsProvider` 都是 EP），本仓没有 EP 宿主。 |
| `GutterContentProvider` | 做不到 | `platform/execution/…/ConsoleView` 的 gutter EP | 控制台没有编辑器沟槽（本仓输出区是纯文本流），要落地得先给 `RunConsole.vue` 加一条带 gutter 的文档视图。 |

### `exec/target`（85 类）

| 项 | 判定 | 上游依据 | 本仓落点 / 卡点 |
|---|---|---|---|
| 目标环境管理（对话框 + 用户自定义目标） | 做不到（本桶） | `platform/execution-impl/src/com/intellij/execution/target/TargetEnvironmentWizard.kt:14`、`…/target/ManageTargetEnvironmentsAction.kt`（本轮 find 到） | 卡点：模型在 `src/executionTargets.ts`/`src/targetEnvironments.ts`，但**对话框组件**不在本桶名下（本桶只拥有 `RunConsole.vue`/`RunningDot.vue`/`TerminalPanel.vue`），且入口在 `RunConfigurationsDialog.vue` ⇒ 写进接线请求（本桶可提供纯规则出口）。 |
| `LanguageRuntimeType` 全表（语言运行时一档一档） | 做不到 | `platform/execution-impl/src/com/intellij/execution/target/`（`JavaLanguageRuntimeUI` 一族） | 卡点：宿主只提供 `app.jdks` 探测（`src/bridge.ts` 的 `app.jdks`），没有 Node/Python 运行时清单的采集口 ⇒ 本仓只有 JDK 一档（如实呈现，不编运行时列表）。 |

---

## 3. 改动文件

**修改**
- `src/components/TerminalPanel.vue`（356 → 633 行，上限 900）：四个模块接线、窗格网格布局、右键菜单、`group` 参数修复、字号/分屏/剪贴板/全选/清屏入口。
- `src/terminalActions.ts`（259 → 375 行）：新增 9 条动作（split.down / unsplit / pane.next / pane.previous / font.increase / font.decrease / font.reset / select.all / clear.buffer），上下文新增 4 个字段，**删除** `MAX_PANES_PER_GROUP`，启用判定改为问 `terminalSplits` / `terminalFontSize`。
- `src/terminalSplits.ts`：头部「本仓落点」改写为真实消费链 + 订正 `TW.*` 行号。
- `src/runToolWindowLayout.ts`：`RUNNER_VIEW_ACTIONS_NOT_PORTED` 加第三条 `Runner.FocusOnStartup`（带上游坐标），头部「两条」改「那几条」。
- `src/runActions.ts`：`runExternalTool(command, name, cwd?)` + `run.start` 的 `cwd` 改为「调用方给了就用、否则退回工作区根」（为 Run Anything 的执行上下文留出出口）。
- `tests/terminal-actions.test.mjs`：分屏上限那条改成「没有窗格数上限」（引 `TerminalToolWindowManager.java:431-434`），新增分屏/跳转/字号三组启用断言，`ctx()` 补 4 个字段，title 断言随文案改为「右侧分屏」。
- `tests/runner-view-actions.test.mjs`：不渲染清单改为三条并核 `Runner.FocusOnStartup` 的坐标。
- `tests/run-anything.test.mjs`：加一条「执行侧收得下执行上下文目录」的消费链断言。

**新增**
- `tests/terminal-clipboard.test.mjs`（9 条）、`tests/terminal-font-size.test.mjs`（8 条）、`tests/terminal-splits.test.mjs`（8 条）、`tests/terminal-title.test.mjs`（7 条）——四个孤儿模块的头部一直写着「判据：tests/terminal-*.test.mjs」，上一轮其实**没有**这些测试文件，本轮补齐。

**未动**（归属/冻结）：`src/bridge.ts`、`src/App.vue`、`src/components/CodeEditor.vue`、`src/settingsModel.ts`、`src/settingsTreeMeta.ts`、`src/editorCommands.ts`、`src/components/SettingsDialog.vue`、`src/components/MainToolbar.vue`、`native/*`（本轮无 native 改动，因此没有 ctest）。

---

## 4. 验证

- `node --test tests/terminal-*.test.mjs tests/run-*.test.mjs tests/console-*.test.mjs tests/large-file-*.test.mjs tests/runner-view-actions.test.mjs tests/editor-large-file-guard.test.mjs` → **163 tests / 163 pass / 0 fail**。
- 其中 `node --test tests/terminal-*.test.mjs` → **48 / 48 pass**（上一轮基线是 16 条，只有 actions + colors 两个文件）。
- `node .tools/find-orphan-modules.mjs --gate`：**四个 terminal 孤儿全部从红名单消失**（门禁只剩 `src/editorCodeBlock.ts`、`src/editorJoinComments.ts`、`src/externalSystemDataStorage.ts` 三条，都不是本桶名下）。
- `node .tools/find-param-props.mjs` → 0 处参数属性；`node .tools/find-ts-in-mjs.mjs` → 干净；`node .tools/find-missing-ext.mjs` → 干净。
- 逐模块 ESM 真判据（`node --input-type=module -e "await import('./src/<文件>.ts')"`）：`terminalClipboard` / `terminalFontSize` / `terminalSplits` / `terminalTitle` / `terminalActions` / `runToolWindowLayout` 全部 ok（无 `ERR_MODULE_NOT_FOUND`）。
- `node --test tests/source-citations.test.mjs tests/semantic-tokens.test.mjs tests/source-citation-anchors.test.mjs tests/code-style.test.mjs tests/header-color-tokens.test.mjs tests/icon-glyph-role.test.mjs` → 只有 `tests/ui-icons.test.mjs` 一条红，原因是别人正在写的 `src/components/StructuralSearchFilters.vue` 模板里有未闭合字符串（`Error parsing JavaScript expression: Unterminated string constant`），**与本桶无关**。
- `npx vue-tsc -b`：整棵树仍红 **1 条**，红的不是本桶文件 —— `src/customFoldingProviders.ts(48,103) TS1002 Unterminated string literal`
  （别的桶在写的文件，本轮两次采样都在变；上一轮的 `src/codeVisionProviders.ts` 5 条已消失）。
  为了拿到本桶的类型结论，用一份临时 `tsconfig`（`extends ./tsconfig.json` + `exclude` 那两个坏文件，跑完即删）重扫一遍
  `npx vue-tsc -p … --noEmit`：**全树只剩那 1 条错误，本桶的 `TerminalPanel.vue` / `terminalActions.ts` /
  `terminalSplits.ts` / `terminalFontSize.ts` / `terminalClipboard.ts` / `terminalTitle.ts` / `runToolWindowLayout.ts` / `runActions.ts` 零错误**。
  临时 config 已删除（`git status` 干净）。**未跑全量 `npm test`**（按要求）。
- 新文件行数全部在上限内（面板 633 / 900，`terminalActions.ts` 375 / 900）；`tests/module-size.test.mjs` 通过，未改任何上限数字。

## 5. 反向验证（新门禁真的会红）

把 `TerminalPanel.vue` 里四处「消费链」锚点临时改掉（备份 → 打补丁 → 跑测试 → 还原）：
`instance.onTitleChange(raw => setPaneTitle(pane, setApplicationTitle(pane.title, raw)))` → `instance.onTitleChange(() => undefined)`；
`terminalClipboardKeyFor(event)` → `clipboardKey(event)`；
`terminalWheelZoomApplies(event, WHEEL_FONT_ZOOM_ENABLED)` → `wheelZoomGate(event, true)`；
`canTerminalSplit(orientation, { … })` → `splitGate(orientation)`。

结果：4 个测试文件 30 条里 **fail 4**（正好是四个「消费链」那条，`grep -cE '^✖|消费链'` = 9 行输出）；还原后 `node --test tests/terminal-*.test.mjs` 回到 **48 / 48 pass**，文件哈希一致（用 `.bak` 原样 copy 回再删）。

## 6. 做不到 / 无法核实（逐条具体卡点）

1. **命令块选择与块配色 / `Terminal.CopyBlock`**：要 OSC 133 的提示符-命令边界；上游靠 `plugins/terminal/resources/shell-integrations/{bash,fish,powershell,zsh}` 注入，本仓 `native/terminal.cpp` 是裸 ConPTY（不注入 rc/profile，字节原样双向搬运），没有信号产生者。先补宿主侧 shell integration 才谈得上。
2. **按 ANSI 色号的用户自定义**：需要 16 色编辑格；设置数据与树（`settingsModel.ts`/`settingsTreeMeta.ts`）是保留文件，渲染在 `SettingsDialog.vue`（非本桶）⇒ 交请求。
3. **Ctrl+滚轮缩放的用户总闸**（`EditorSettingsExternalizable.java:1043`）：同上，本仓设置页没有这一格，本轮按上游默认「开着」（`TerminalPanel.vue:81` 的 `WHEEL_FONT_ZOOM_ENABLED = true`，写明理由）⇒ 交请求。
4. **大文件动作替换（③）与「大文件里正则搜索不可用」提示（⑤）**：生效点在冻结的 `CodeEditor.vue` 按键分发与 `editorCommands.ts`、`EditorFindBar.vue`（非本桶）⇒ 交请求。
5. **按页加载的编辑器模型（④）**：要改 `file.read` 的范围读 + 前端分页缓存，`bridge.ts` 保留、分页宿主不在本桶。
6. **提权运行**：`RunStartParams` 在 `bridge.ts`（保留），且提权进程无法与本仓 `native/run_host.cpp` 共用继承的标准管道（上游用 elevation daemon）⇒ 交请求。
7. **`Runner.FocusOnStartup` / `RunnerLayoutSettings` 布局页**：本仓运行视图是扁平单标签条，没有 `RunnerLayoutUi` 的 Content 格可标「启动时聚焦」，也没有可恢复的布局状态（与已定不做的 `Runner.RestoreLayout` 同源）⇒ 登记为不渲染（有常量、有测试），不放假控件。
8. **Run Toolbar 槽位定制 / Services 树 / `RunDashboardCustomizer` / `ExecutionListener` 等 EP**：本仓没有插件贡献点宿主；`MainToolbar.vue`/Services 工具窗口不在本桶名下。
9. **目标环境对话框 / 非 JDK 运行时全表**：对话框组件不在本桶；宿主只有 `app.jdks` 探测，没有 Node/Python 运行时采集口。
10. **`AbstractFocusOnAction` 之外的 exec/ui 剩余类**、**`ConsoleViewImpl` 的 Swing 本体**：沿用机械降级，未新增代码。
11. **Run Anything 的「上下文目录 → runner」在上游的对应文件**：本轮按 `platform/execution-impl/src/com/intellij/execution/runAnything/` 路径 find **无命中** ⇒ 该条上游坐标**无法核实**，本仓只在 `runActions.ts:444/465` 留了 `cwd` 出口，注释里如实写了不引坐标。
