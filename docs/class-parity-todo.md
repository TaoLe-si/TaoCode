# 类级移植 TODO（唯一基准 = IntelliJ 源码类清单）

> 用户要求（2026-09-26 二次明确）：**源码有什么类，就移植什么类**，严格对照，严禁编造 / 跳过 / 虚假 / 错误逻辑。  
> 本文档 = 总控与执行顺序。**逐类清单**在 `docs/inventory/*_scan.md`（7 个域共 5051 行，每行一个真实源码类 + 机检状态），全量路径清单在 `docs/inventory/*.txt`。

---

## 0. 真实数据（机械枚举，可复核）

源码根：`D:\Backup\Downloads\intellij-community-master\intellij-community-master`

| 层                     |        类文件数 | 来源                                                                                |
| --------------------- | ----------: | --------------------------------------------------------------------------------- |
| 整棵源码树                 | **174 659** | `find -name '*.java' \|\| '*.kt'`（9.1 万 java + 8.3 万 kt）                          |
| `platform/`（IDE 平台本体） |  **32 352** | `docs/inventory/_platform.json`                                                   |
| └ 本清单已逐类枚举的 7 个域      |       4 955 | `docs/inventory/{editor,toolwindow,vcs,actions,settings-run,projectviews,ui}.txt` |
| └ 其余 platform 子模块     |      27 397 | `docs/inventory/platform_rest.txt`                                                |

**机检对照结果**（脚本 `scripts/parity_scan.py`，可随时重跑）：

| 域            |      枚举类数 | TaoCode 里出现过名字 |  **从未出现** |
| ------------ | --------: | -------------: | --------: |
| editor       |       569 |             10 |   **559** |
| toolwindow   |       392 |             68 |   **324** |
| vcs          |     1 002 |             30 |   **972** |
| actions      |       115 |              3 |   **112** |
| settings-run |     1 676 |             28 | **1 648** |
| projectviews |       342 |             12 |   **330** |
| ui           |       955 |             33 |   **922** |
| **合计**       | **5 051** |        **184** | **4 867** |

> 口径说明（防自欺）：「出现过名字」只是机检命中，**不等于已移植**（很多命中是文档里的"判定不做"记录）。「从未出现」= 该类从未以任何形式被对照过 —— 这是本轮要消掉的主体。

**移植的定义（本清单执行口径）**：把源码类承载的**行为**移植进 TaoCode 的架构（Vue3/DOM + C++20 宿主 + LSP/DAP），而不是照抄 Java 代码。判定四档：

- `[x]` 已移植：有对应实现且真实工作，附 `文件:行号` 证据。
- `[~]` 部分移植：有对应物但缺关键行为（写清缺什么）。
- `[ ]` 未移植：源码有、TaoCode 无、本架构下可实现 → **TODO**。
- `[-]` 不适用：只有在 JVM/Swing/AWT/PSI/JGit 语义下才存在。**必须附源码路径+行号理由**。

**语言插件坐标系**（界定，非跳过）：`java/`、`python/`、`mps/`、`jupyter/`、`jps/`、`android-customization/` 等约 14.2 万个类的服务是**语言智能**，TaoCode 用 LSP / DAP 承接 —— 那里要对照的是 **LSP 规范与 DAP 规范**，不是 IDEA 的 PSI 类。该坐标系见 §3。

---

## 1. 七域包级分布（真实计数，来自枚举文件）

### 1.1 `editor`（569）

|  类数 | 包                                                                                                                                    |
| --: | ------------------------------------------------------------------------------------------------------------------------------------ |
| 226 | `com/intellij/openapi/editor`（含 actions/ event/ impl/ caret/ document/ folding/ softwrap/ scrolling/ colormap/ highlighter/ markup/） |
| 150 | `com/intellij/codeInsight/daemon`（高亮/检查/意图的框架层）                                                                                      |
| 138 | `com/intellij/codeInsight/template`（实时模板）                                                                                            |
|  38 | `com/intellij/codeInsight/hint`（参数信息/文档提示）                                                                                           |
|  17 | 其余（psi/impl、ide/todo、codeStyle、injected、application/options、folding）                                                                 |

### 1.2 `toolwindow`（392）

|  类数 | 包                                                                                         |
| --: | ----------------------------------------------------------------------------------------- |
| 353 | `com/intellij/openapi/wm`（impl/、impl/statusBar/、impl/stripe/、impl/content/、impl/command/） |
|  32 | `com/intellij/toolWindow`                                                                 |
|   7 | extendedToolWindowsUi / innerDrag / xNext                                                 |

### 1.3 `vcs`（1 002）

|  类数 | 包                                                                                                            |
| --: | ------------------------------------------------------------------------------------------------------------ |
| 935 | `com/intellij/openapi/vcs`（changes/、changes/ui/、changes/actions/、checkin/、history/、diff/、update/、vfs/、impl/） |
|  67 | `com/intellij/vcs/commit`（提交面板本体）                                                                            |

### 1.4 `actions`（115）

`com/intellij/openapi/actionSystem` 全部（含 `impl/`）。

### 1.5 `settings-run`（1 676，最大的域）

|  类数 | 包                         | 类数 | 包                          |
| --: | ------------------------- | -: | -------------------------- |
| 189 | `ide/ui`（外观/主题/编辑器选项页）    | 41 | `diff/merge`               |
| 172 | `xdebugger/impl`          | 33 | `diff/actions`             |
| 121 | `diff/tools`              | 33 | `xdebugger/frame`          |
|  96 | `openapi/options`         | 30 | `execution/actions`        |
|  79 | `execution/target`        | 30 | `find/editorHeaderActions` |
|  71 | `execution/ui`            | 28 | `find/actions`             |
|  62 | `execution/impl`          | 57 | `find/impl`                |
|  61 | `execution/testframework` | 52 | `execution`                |
|  52 | `execution/runToolbar`    | 49 | `execution/configurations` |

### 1.6 `projectviews`（342）

| 类数 | 包                     |  类数 | 包                              |
| -: | --------------------- | --: | ------------------------------ |
| 66 | `ide/todo`            |  38 | `history/core`（本地历史）           |
| 46 | `history/integration` |  37 | `platform/lvcs`                |
| 44 | `notification/impl`   |   9 | `openapi/wm`                   |
| 41 | `ide/structureView`   |   8 | `history`                      |
| 38 | `platform/ide`        | 5+5 | `ide/bookmarks`、`notification` |

### 1.7 `ui`（955）

|  类数 | 包                         |    类数 | 包                                         |
| --: | ------------------------- | ----: | ----------------------------------------- |
| 296 | `com/intellij/ui`（根）      |    40 | `ui/tree`                                 |
| 113 | `ui/components`（JB* 系列）   |    37 | `util/ui`                                 |
|  91 | `ui/dsl`（Kotlin DSL 面板构建） |    32 | `ui/treeStructure`                        |
|  54 | `ui/popup`                |    21 | `ui/colorpicker`                          |
|  53 | `ui/tabs`                 |    17 | `ui/content`                              |
|  46 | `ui/mac`                  | 10+10 | `ui/speedSearch`、`ui/codeFloatingToolbar` |
|   — | —                         | 8+8+8 | `ui/layout`、`ui/docking`、`ui/viewModel`   |

---

## 2. 其余 27 397 个 platform 类（按子模块，真实计数）

按"用户能不能看见"分三堆（判定必须逐类做，下面是聚合视角，不是结论）：

**A 堆 · 用户可见特性的实现体（要逐类过）**：`lang-impl` 3894（编辑器/高亮/折叠/查找的框架层）、`platform-impl` 3416（wm/ui/options/notification 之外的实现体）、`vcs-log` 574、`searchEverywhere` 187、`structuralsearch` 180、`code-style-impl` 118、`projectModel-impl` 226、`ide-core` 233、`diff-impl` 109、`smRunner` 106、`bookmarks`/`todo` 已在域内、`indexing-impl` 161、`configuration-store-impl` 100。

**B 堆 · 基础设施（要判定是否 Web 可移植）**：`util` 1730、`core-api` 883、`core-impl` 658、`workspace` 907、`projectModel-api` 143、`analysis-api/impl` 955、`lang-api` 701、`platform-api` 563、`external-system-*` 588、`remote-*` 476、`eel*` 200+、`settings-sync-core` 102、`pluginSystem`/`pluginManager` 60、`tracing*`、`statistics` 290、`feedback` 119、`ml-*` / `polySymbols*` / `collaboration-tools` 354 / `script-debugger` 116 / `testFramework` 612 / `platform-tests` 1365。

**C 堆 · 明确不适用（给理由，不逐类移植）**：`jewel` 669（Compose 桌面 UI 工具包）、`build-scripts` 714（Gradle 构建）、`jps-bootstrap`/`jps`（构建系统）、`jbr`（JetBrains Runtime 打包）、`bazel-runfiles`、`distribution-content`、`icons-impl` 100 的位图管线（TaoCode 用 SVG 图标）、`threadDumpParser`、`kernel`/`pratt`/`syntax` 中与 PSI 绑定的部分、`forms_rt`（Swing 表单）、`compose` 46、`ui.jcef` 57、`xdebugger` 的 JVM 后端（TaoCode 用 DAP）。

---

## 3. LSP / DAP 承接层（语言智能与调试的对照入口）

`java/`、`python/`、`jps/`、`mps/`、`jupyter/`、`android-customization/` 的 14.2 万类提供的是语言智能。TaoCode 的对标物是：

| IDEA 对应物                                         | TaoCode 对标                                                                   | 现状                                                   |
| ------------------------------------------------ | ---------------------------------------------------------------------------- | ---------------------------------------------------- |
| `PsiElement` / `Reference` / `ResolveResult`     | LSP `textDocument/definition`、`references`、`implementation`、`typeDefinition` | 见 `native/lsp.cpp`、`native/lsp_host.cpp`             |
| `Annotator` / `HighlightVisitor` / `Inspection`  | LSP `publishDiagnostics`、`textDocument/codeAction`                           | 见 `src/bridge.ts` 的 `lspDiagnostics`、`App.vue` 的问题面板 |
| `CompletionContributor` / `LookupImpl`           | LSP `textDocument/completion` + 前端补全 UI                                      | 部分                                                   |
| `CodeStyleManager` / `Reformatter`               | LSP `textDocument/formatting`、`rangeFormatting`                              | 部分                                                   |
| `RenameProcessor` / `MoveProcessor`              | LSP `textDocument/rename`、`prepareRename`                                    | 部分                                                   |
| `HierarchyProvider`                              | LSP `typeHierarchy`、`callHierarchy`                                          | 部分                                                   |
| `XDebugProcess`（JVM 调试后端）                        | DAP（`native/dap.cpp`）                                                        | `[x]`                                                |
| `XBreakpointManager` / `XSourcePosition`         | DAP `setBreakpoints` / `stackTrace`                                          | `[x]`                                                |
| `XDebuggerTree` / `FramesView` / `VariablesView` | `src/components/DebugPanel.vue`                                              | 部分（要逐控件对）                                            |

**已完成**：`docs/enum-lsp-dap.md`（B1-e）—— 含①客户端**已声明**能力逐条核对（`native/lsp_session.cpp:600-663`，声明与"实际会发"必须一致）；②LSP 已发方法**28 个**、DAP 已发请求**17 个**（机械枚举）；③17 行"IDEA 类族 → 承接物 → TaoCode 现状"对照；④缺口清单：LSP **12** 条（`foldingRange`/`codeLens`/`semanticTokens`/`inlineCompletion`/`prepareRename`/`completionItem/resolve`/层级下游请求/pull 诊断/`documentLink`/`moniker`/文件操作通知/`executeCommand`）、DAP **10** 条（`setVariable`+`setExpression` 优先）；⑤为什么这一层按协议而非 PSI 对照的四条判定规则。

**已知待核**：`dap.terminate` 与 `dap.disconnect` 在原生侧都调用 `stop_dap()`（`native/main.cpp:1475-1478`），**没有发 DAP 的 `terminate`/`restart` 请求** —— 与 IDEA"终止进程"vs"断开但保留进程"的区别是否等价，尚未核实，**不按已实现计数**。

---

## 4. 执行顺序（每批一个可验收的闭环）

优先级 = 「用户能不能看见」× 「能不能独立验证」。每批都必须跑完 §5 全部六条验证。

| 批        | 范围                                                                              | 入口                                            | 状态                                                                                        |
| -------- | ------------------------------------------------------------------------------- | --------------------------------------------- | ----------------------------------------------------------------------------------------- |
| **B1** | `ui/tabs`（53）+ `ui/popup`（54） | 判决见 `docs/inventory/verdict-ui-tabs-popup.md` | **判决 107/107 完成**（`[~]` 20 / `[ ]` 56 / `[-]` 30 / `[x]` 1）。已实现：① `TabsUtil` 拖拽分屏几何；② `ScrollableSingleRowLayout` 的**溢出压缩 + `…` 隐藏标签下拉**（判决表里最大的一块）。剩余 `[ ]`：`TabsListener.beforeSelectionChange` 否决、`TabLabel` 就地重命名、`ActionPanel` 多动作按钮、`AbstractPopup` 选项集、`PopupState` 尺寸记忆、`MnemonicsSearch`、列表行内动作、多行布局（Wrap/Compressible/Scrollable）、`TabInfo` 的 hidden/alert 等 |
| **B2**   | `toolwindow/openapi/wm`（353）：条纹按钮、内容模型、`impl/statusBar` 的 widget 工厂             | `docs/inventory/toolwindow_scan.md`           |                                                                                           |
| **B3**   | `vcs/commit`（67）全量 + `vcs/changes` 的行为层                                         | `docs/inventory/vcs_scan.md`                  |                                                                                           |
| **B4**   | `editor/openapi/editor`（226）的 actions/ caret/ 事件层；`codeInsight/hint`（38）        | `docs/inventory/editor_scan.md`               |                                                                                           |
| **B5**   | `codeInsight/template`（138）：实时模板（TaoCode 已有 `src/templates.ts`）                 | 同上                                            |                                                                                           |
| **B6**   | `settings-run`：`ui/dsl` 对应物 + `openapi/options`（96）+ `ide/ui`（189）              | `docs/inventory/settings-run_scan.md`         |                                                                                           |
| **B7**   | `find`（约 115）+ `diff`（约 194）                                                    | 同上                                            |                                                                                           |
| **B8**   | `execution`（约 300）+ `xdebugger`（约 250，按 DAP 口径）                                 | 同上                                            |                                                                                           |
| **B9**   | `projectviews`：`ide/todo`（66）、`structureView`（41）、`lvcs`（84）、`notification`（49） | `docs/inventory/projectviews_scan.md`         |                                                                                           |
| **B10**  | `actions`（115）                                                                  | `docs/inventory/actions_scan.md`              |                                                                                           |
| **B11**  | `codeInsight/daemon`（150，按 LSP 诊断口径，依赖 §3）                                      | `docs/inventory/editor_scan.md`               |                                                                                           |
| **B12+** | §2 A 堆逐模块；B 堆逐模块判定可移植性；C 堆逐类写理由                                                 | `docs/inventory/platform_rest.txt`            |                                                                                           |



---

## 5. 每批验证口径（六条，缺一不可）

| 项    | 命令                                                           | 通过标准                                                                               |
| ---- | ------------------------------------------------------------ | ---------------------------------------------------------------------------------- |
| 类型检查 | `npx vue-tsc --noEmit -p tsconfig.json`                      | exit 0 / 0 错误                                                                      |
| 前端测试 | `npm test`                                                   | fail 0                                                                             |
| 前端构建 | `npx vite build --emptyOutDir false`                         | exit 0。**tsc 不报模板语法错误，只有 vite 报** —— 本轮已靠它抓到 `SettingsDialog.vue` 的未闭合 `<section>` |
| 原生构建 | `cmd /c scripts\build-native-locked.bat`                     | RC 0 且 **0 error / 0 warning**                                                     |
| 原生测试 | `cd build && ctest --output-on-failure`                      | 全绿                                                                                 |
| 启动冒烟 | 在 `build/` 下 `subprocess.run(['./TaoCode.exe'], timeout=15)` | `TimeoutExpired` = ALIVE                                                           |

---

## 6. 本清单自身的进度| 里程碑                                   | 状态                                                                                                                                                                                       |
| ------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 7 域逐类枚举（5051 行）                       | `[x]` 完成，见 `docs/inventory/`                                                                                                                                                             |
| platform 全量枚举（32352）                  | `[x]` 完成                                                                                                                                                                                 |
| 机检对照（184 提及 / 4867 未出现）               | `[x]` 完成，脚本 `scripts/parity_scan.py`                                                                                                                                                     |
| LSP/DAP 承接层对照（§3） | `[x]` 完成 → `docs/enum-lsp-dap.md`（B1-e）：声明逐条核对 + 28 个 LSP 方法 / 17 个 DAP 请求 + 12/10 条缺口 |
| B1 判决（`ui/tabs` + `ui/popup` = 107 类） | `[x]` 完成：`[~]` 20 / `[ ]` 56 / `[-]` 30 / `[x]` 1                                                                                                                                        |
| B1 实现 | `[~]` 进行中：已落地 `TabsUtil` 拖拽分屏几何 + `ScrollableSingleRowLayout` 溢出压缩与 `…` 下拉（标签裁剪/丢弃/隐藏全部按源码公式）。待做：`beforeSelectionChange` 否决、`TabLabel` 就地重命名、`ActionPanel` 多动作按钮、`AbstractPopup` 选项集、`PopupState` 尺寸记忆、`MnemonicsSearch`、列表行内动作、Wrap/Compressible/Scrollable 多行布局 |
| B2..B12 判决                            | `[ ]` 起点：0 / 4944                                                                                                                                                                        |

---

## 7. B1-c：装饰性设置缺陷（本轮查实，必须修）

**证据（可复核）**：`generalSettings` 在 `src/App.vue` 里只有 **2 处赋值、0 处读取**（`:1798` 从 `app.state` 载入、`:2011` 保存回宿主）；原生侧 `native/{main,workspace,projects}.cpp` 对 `general` 只有**存储、校验、持久化**（`projects.cpp:894-895, 1064, 1685-1692`、`main.cpp:1031`），**没有任何读取**。

结论：这批新增的 **13 个键全部是装饰性设置** —— 设置页把它们渲染成可用控件，它们也能存下来，但**没有任何行为依赖它们**。这正是硬规则第 4 条禁止的形态。

| 键 | 应有的消费点（IDEA 出处） | TaoCode 现状 |
|---|---|---|
| `deleteToBin` | `GeneralSettings.isDeletingToBin`（`GeneralSettings.kt:55-60`）→ 删除时走回收站；消费者 `DeleteHandler.java:345`、`DeleteHandlerHelper.kt:30`、`FileDeleteAction.java:57`、`VirtualFileDeleteProvider.java:54`（一律 `TrashBin.isSupported() && isDeletingToBin()`） | `[x]` **已接通（B1-c）**：删除对话框的复选框改读写本键；同时删掉重复键 `EditorSettings.deleteToTrash`（5 处：接口 / 默认值 / 预览白名单 / 原生默认值 / 原生 `known_keys`），并把局部别名改名为 `deleteToBin` |
| `autoSyncFiles` | `GeneralSettings.isSyncOnFrameActivation`（`GeneralSettings.kt:61-64`）→ 窗口激活/切标签时重新同步；消费者 `SaveAndSyncHandlerImpl.kt:221,326`（VFS 刷新门控）与 `EditorWindow.kt:211`（切标签重读） | `[x]` **已接通（B1-c）**：`syncFromDisk()`（`App.vue` 的窗口 focus / visibilitychange / 文件监听三条路径共用）改为门控在本键；同时删掉重复键 `EditorSettings.syncOnFocus`（接口 / 默认值 / 白名单 / 编辑器设置页那一行 / 原生默认值 / `known_keys`） |
| `isUseSafeWrite` | `GeneralSettings.isUseSafeWrite`（`GeneralSettings.kt:92-97`）；消费者 `SafeWriteRequestor.java:12-15` 的 `shouldUseSafeWrite`；文案 `IdeBundle.properties:85` `checkbox.safe.write=Back up files before saving`；失败语义 `UtilBundle.properties:25-28`（`The file left unchanged` / `backup was created in {1}`） | `[x]` **已接通（B1-c 续）**：`Workspace::write` 新增 `safe_write` 参数（默认 true，向后兼容）—— **本仓原本就是无条件的安全写入**（临时文件 + 备份 + `replace_safely`），现在关掉该设置时走新的 `write_directly()` 就地截断写入（`TRUNCATE_EXISTING` + `FlushFileBuffers`）。`file.write` 透传 `safeWrite`，前端三处保存调用带上 `generalSettings.isUseSafeWrite`。**冲突与只读检查不受该开关影响**（丢别人的改动不是这个选项要交换的东西），并有原生测试锁住 |
| `autoSaveFiles` | `GeneralSettings.isSaveOnFrameDeactivation`（`GeneralSettings.kt:73-78`）→ 窗口失活时保存；消费者 `SaveAndSyncHandlerImpl.kt:300-319`（`applicationDeactivated` 里 `isSaveOnFrameDeactivation && canSyncOrSave()` → `saveAllDocuments`），另有 `TerminalVfsSynchronizer.kt:50`、`ConsoleExecutionEditor.java:75`、`LineStatusTracker.kt:241` | `[x]` **已接通（B1-c 续）**：新增 `window.blur` → `onWindowBlur()`，门控在本键；`blur` 监听在 `onMounted`/`onBeforeUnmount` 里注册与注销 |
| `autoSaveIfInactive` + `inactiveTimeout` | `GeneralSettings.isAutoSaveIfInactive`（`GeneralSettings.kt:81-91`）+ `SAVE_FILES_AFTER_IDLE_SEC`（`:163` = 15，范围 1–300，`:193-202` 经 `fit` 钳位）；消费者 `SaveAndSyncHandlerImpl.kt:332-350`（`isAutoSaveIfInactive` → `debounce(inactiveTimeout.seconds)` → 保存全部文档，`:356-361` 的 `executeOnIdle`） | `[x]` **已接通（B1-c 续）**：`scheduleAutoSave()` 改为门控在 `autoSaveIfInactive`、延时取 `inactiveTimeout` 秒（每次编辑重启计时器＝源码的 idle 信号）；同时删掉编辑器页的重复键 `EditorSettings.autoSave`（硬编码 5s，接口 / 默认值 / 前端白名单 / 编辑器设置页那一行 / 原生默认值 / 原生 `known_keys`） |
| `backgroundSyncFiles` | `GeneralSettings.isBackgroundSync`（`GeneralSettings.kt:67-71`，默认 true `:259`）；消费者 `SaveAndSyncHandlerImpl.kt`：控制器选择 `:555-563`、idle 变体 `:578-611`（门控 `:610`）、失焦变体 `:631-662`（门控 `:649`）、刷新循环 `:664-690`（门控 `:679`）；间隔 = registry `vfs.background.refresh.interval`（`registry.properties:1656` = 15s，`:750-752` 读取）；控制器选择键 `vfs.background.refresh.on.idle` **默认 true**（`intellij.platform.ide.core.impl.xml:77-80`，描述原文：在**无用户活动**时刷新而非窗口失焦时） | `[x]` **已接通（B1-c 续）**：`syncFromDisk()` 拆成 `syncFromDisk()`（激活门控，`autoSyncFiles`）+ `performDiskSync(quiet)`；新增 15s 定时器 `backgroundRefreshOnce()`，仅当**距上次用户活动满一个间隔**（`noteActivity()` 由 keydown / pointerdown / wheel 记录）且 `backgroundSyncFiles` 为真时执行，且 `quiet = true`（后台刷新不弹"已同步"通知）。`onBeforeUnmount` 里停表并注销监听 |
| `confirmExit` | `GeneralSettings.isConfirmExit`（`GeneralSettings.kt:107-112`，还 `&& IdeLifecycleUiCustomization.canShowExitConfirmation`）；消费者 `ApplicationImpl.canExit`（`:1073`，由 `:840` 调用）里的 `DoNotAskOption.isToBeShown()` = `isConfirmExit && getOpenProjects().length > 0`（`:1002-1004`），「不再询问」勾选后走 `setToBeShown` → `setConfirmExit(false)`（`:1012-1018`）；另有 `RestartDialog.kt:33` | `[x]` **已接通（B1-c 续）**：新增退出确认对话框（`exitPrompt` / `exitPromptDontAsk` / `resolveExit`），File→退出 改走 `quitApp()`；「不再询问」把 `confirmExit` 写回 false。`beforeunload` 的守卫也并入同一条件（窗口自身关闭时浏览器只能给标准提示，注释已写明） |
| `reopenLastProject` | `GeneralSettings.isReopenLastProject`（`GeneralSettings.kt:41-53`，还受 `ProjectLifecycleUiCustomization.reopenProjectsOnStartupMode` 影响）；消费者 `RecentProjectsManagerBase.kt:657` | `[x]` **已接通（B1-c）**：启动恢复改门控在本键（`App.vue` 的 `bootstrap()`）；同时删掉重复键 `EditorSettings.restoreLastProject`（接口 / 默认值 / 前端白名单 / 编辑器设置页那一行 / 原生默认值 / 原生 `known_keys` / 原生测试两处夹具） |
| `isShowWelcomeScreen` | `GeneralSettings.isShowWelcomeScreen`（`GeneralSettings.kt:113-118`，默认 true `:256`）。**唯一消费者**是 `CloseProjectWindowHelper.kt:40-44`，而那里的 `isShowWelcomeScreen = isMacSystemMenu && isShowWelcomeScreenFromSettings`，`MacMenuSettings.java:13-14` 又写死 `OS.CURRENT == OS.macOS && …` | `[-]` **不适用（B1-c 续）**：Windows 上 `isMacSystemMenu` 恒为 false ⇒ 该键在 **IDEA 的 Windows 版也没有任何效果**；IDEA 的设置页同样不渲染这一项（`GeneralSettingsConfigurable` 里没有它的行），TaoCode 也只存储 / 校验、不渲染 —— 两边一致，故判 `[-]` 而非未接通 |
| `confirmOpenNewProject2` | `GeneralSettings.confirmOpenNewProject`（`GeneralSettings.kt:120-135`，常量 `:157-158` 与 `defaultConfirmNewProject()` `:168` = **ASK(-1)**）；消费者 `ProjectManagerImpl.kt:1249-1257`（`OPEN_PROJECT_NEW_WINDOW` → `processPerProjectSupport().openInChildProcess()`，即独立窗口/进程）与 `AttachProjectAction.kt:42` | `[-]` **不适用（B1-c 续）**：单窗口单进程架构下 `NEW_WINDOW` 无法实现，而 `ASK`（IDEA 默认）存在的意义就是提供"新窗口"这个选项 ⇒ 三选一里两个永远不会生效。**已从设置页移除那组单选**（连同说明注释），状态字段仍按 IDEA 保留并校验 |
| `processCloseConfirmation` | `GeneralSettings.processCloseConfirmation`（`GeneralSettings.kt:137-142`，默认 ASK `:261`）；消费者 `TerminateRemoteProcessDialog.java`：无对话框的分支 `:53-64`、按钮集 `:66-71`、默认按钮 `:105`、全已退出 `:116-118`、按钮→结果 `:148-151`、「不再询问」写回 `:74-84`；终端入口 `TerminalCloseConfirmation.kt:15-22` + `TerminalTabCloseListener.kt:87`（置 `ALWAYS_USE_DEFAULT_STOPPING_BEHAVIOUR_KEY` ⇒ **终端 canDisconnect = false**，对话框只有「终止 / 取消」）；文案 `ExecutionBundle.properties:94-100` | `[x]` **已接通（B1-c 续）**：新增 `src/processClose.ts`（纯逻辑 + 9 条测试，覆盖无对话框分支、按钮集、默认按钮、结果映射、写回、全退出、单/复数文案）；`TerminalPanel` 新增 `confirmClose` 回调，关闭**未退出**的终端前先问（已退出的直接关；`restart` 改走 `disposePane`，因为重启按钮只在 exited 时出现）；`App.vue` 加确认弹层与「不再询问」→ 写回 TERMINATE |
| `defaultProjectDirectory` | **不在 `GeneralSettings` 而在 `GeneralLocalSettings`**（`GeneralSettings.kt:223-225` 属于本地设置类，`GeneralLocalSettings.kt:60-63,80`；`:51,55` 还有一次性迁移：从旧位置拷进本地状态再把旧位置清空）。消费者 `WelcomeScreenProjectProvider.kt:231`（欢迎页新项目路径）、`AttachProjectAction.kt:73`（附加项目对话框） | `[x]` **已接通（B1-c 续）**：新增 `defaultProjectParent()` = 设置非空则用它、否则用宿主建议的 `defaultParent`（来自系统「文档」目录，**运行时**值、不持久化，与 IDEA 的**用户设定**是两回事，所以是覆盖关系而非重复键）。接到三处：新建/克隆项目表单的初始父目录、`browseParent()` 重开时定位到当前值、以及 `workspace.open` / `dialog.pickDirectory` 的文件夹选择器 —— 原生 `select_directory(title, initial)` 新增 `initial` 参数并调用 `IFileOpenDialog::SetFolder`，**路径不是目录时忽略**（否则与 `FOS_PATHMUSTEXIST` 组合会让对话框打不开） |

**处理原则（二选一，不许第三条）**：
1. **接通**：让行为真实依赖该键（优先，因为 IDEA 有、且都是用户可见行为）；
2. **不渲染**：本架构下确实无从消费的，从设置页移除并登记理由。
**不允许**保持"渲染了但没人读"。

**修的前提**：先逐键核对与已有键的重复（`deleteToBin`↔`deleteToTrash`、`reopenLastProject`↔`restoreLastProject`），重复的先合并成一个键再接通。

---

## 8. B1-d：键放错家（同类问题，待修）

| 键 | IDEA 的家 | TaoCode 的家 | 影响 |
|---|---|---|---|
| `supportScreenReaders` | `GeneralSettingsState.supportScreenReaders`（`GeneralSettings.kt:265`，默认 false）+ 语义 getter `isSupportScreenReaders`（`:179-186`，带 `PropertyNames.supportScreenReaders` 变更通知，且受 `SUPPORT_SCREEN_READERS_OVERRIDDEN` 覆盖）；设置行在 **`AppearanceConfigurable.kt:363-372`（外观页）**，绑定 `generalSettings::isSupportScreenReaders` | ~~`EditorSettings.supportScreenReaders`~~ | `[x]` **已归位（B1-d）**：字段从 `EditorSettings` 移到 `GeneralSettingsState`（bridge 接口 / 默认值 / 编辑器白名单 → general 校验白名单；原生编辑器默认值与 `known_keys` → general 默认值与 `known_keys`）。设置行**本来就在外观页**（与 `AppearanceConfigurable` 一致），只把绑定从 `editor.` 改成 `general.`；Apply 路径已由 `applyAll()` 的 `generalDirty` 分支覆盖。三处消费者改读 general：`dataset.screenReader` 的 watch、状态栏 `sr-live`、状态栏通知中心 `NoticeList` 的 `live`（`WelcomePage` 另加 `screenReaderLive` prop 直传） |

**处理原则同 §7**：先确认行为消费点在不在，再决定「搬家」还是「新增 + 合并」。


## 9. 全量移植待办（桃 2026-09-26 明确：不允许「不做」，只允许「待办+排期」）

审计时发现的每一处缺口都登记于此。没有宿主能力的先补宿主能力，再做移植。

**「缺的能力」一列目前是推断，不是源码结论**（桃 2026-09-26：任何移植以源代码为基准）。动手前必须先逐条核实，
例如 #9 的方法级跳转未必需要新的语言服务能力 —— LSP 已有 `textDocument/documentSymbol`（本仓已实现并发），
用它就能做 MethodDown/MethodUp。核实后再把该列改写成确认结论。

| # | IDEA 侧 | 缺的能力 | 状态 |
|---|---|---|---|
| 1 | `ToggleFullScreen` / `ToggleDistractionFreeMode`（ViewAppearanceGroup 内） | 宿主全屏通道（Win32 窗口态或 Fullscreen API） | `[ ]` |
| 2 | `EditorToggleShowGutterIcons`（EditorToggleActions 内） | gutter 图标层（断点/书签之外的可点击行内图标） | `[ ]` |
| 3 | `AutoShowProcessPopupAction`（BackgroundTasks 内） | 持久化的 `autoShowProcessPopup` 开关 + 进度面板联动（IDEA 用注册表键 `ide.windowSystem.autoShowProcessPopup`，:209-210） | `[ ]` |
| 4 | `HelpDiagnosticTools` 子菜单及整个「帮助」菜单（ShowLog / CollectZippedLogs / ShowMemoryDialog…） | 菜单栏还没有 help 组；日志目录/压缩日志/内存对话框都需要宿主通道 | `[ ]` |
| 5 | `PasteGroup`（$Paste / PasteMultiple / PasteSimple） | 剪贴板多段历史（PasteMultiple）与"无格式粘贴"（PasteSimple） | `[ ]` |
| 6 | `ConvertIndentsGroup`（转换为空格/制表符缩进，PlatformActions.xml:500-505） | 纯文本变换，无需新能力（前导空白按 tabSize 折算） | `[x]` **已移植**：`编辑 › 转换缩进` 子菜单（To Spaces / To Tabs），`src/App.vue` 的 `convertIndents(mode)`——整文件前导空白按 tabSize 折算，`setDraft` + 标脏，用户 Ctrl+S 保存；宽度跟随「编辑器 › 代码风格 › 制表符与缩进」 |
| 7 | `Macros` 菜单 | 宏录制/回放系统 | `[ ]` |
| 8 | `EditorBidiTextDirection`（内容自适应 / LTR / RTL） | 双向文本方向支持 | `[ ]` |
| 9 | `NavigateInFileGroup`（MethodDown/MethodUp / 模板参数导航 / GotoCustomRegion） | ~~需要语言服务符号边界~~ **已核实：不需要**——用已实现的 `textDocument/documentSymbol`（SymbolKind 6=Method / 12=Function）即可 | `[~]` **MethodDown/MethodUp 已移植**（`navigate.methodDown/methodUp`，Alt Down/Up 与 IDEA 一致，`src/App.vue` 的 `jumpMethod`，经 `revealLocation` 跳转并接入后退历史）；模板参数导航与 GotoCustomRegion 仍 `[ ]`（需要 LSP 的签名/折叠区能力） |
| 10 | `ExportImportGroup` / `FileExportGroup`（导出到 HTML/图片、导入…） | 导出通道 | `[ ]` |
| 11 | `Notifications` 子菜单 | **已移植**（`窗口 › 通知`：关闭最新 / 关闭全部，`src/App.vue` 的 `closeFirstNotification` + `clearNotices`） | `[x]` |
| 12 | `EditorToggleActions` 子菜单 | **已移植**（`视图 › 编辑器开关`，含字号 ±） | `[x]` |

> 追加新条目时同样遵守：`状态` 只允许 `[ ]` / `[~]` / `[x]`；`[x]` 必须带落点文件。
