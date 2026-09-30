# 类级移植 TODO（唯一基准 = IntelliJ 源码类清单）

> 用户要求（2026-09-26 二次明确）：**源码有什么类，就移植什么类**，严格对照，严禁编造 / 跳过 / 虚假 / 错误逻辑。  
> 本文档 = 总控与执行顺序。**逐类清单**在 `docs/inventory/*_scan.md`（7 个域共 10400 行，每行一个真实源码类 + 机检状态），全量路径清单在 `docs/inventory/*.txt`。

---

## 0'. 重枚举（2026-09-27）—— 下面的 §0 / §1 数字已作废

**结论先说：原来的 7 域清单少算了 5349 类（5051 → 10400），而且它不可复跑。**

原枚举有两个致命问题，都不是"数字记错"，是方法错了：

1. **没有生成器。** 那 7 个 `.txt` 是临时命令的产物，没有脚本能重跑，也就没有任何东西会在源码变化时报警。
2. **源码根写死成了模块路径**（`platform/vcs-log/src`、`platform/searchEverywhere/src`、`platform/lang-impl/src/.../folding`…）。而基准源码是 **`263.SNAPSHOT`**（`build.txt` = `263.SNAPSHOT`），这些包在 263 里早已搬到别的模块、源码集也拆成了 `src` / `shared/src` / `testSrc`。枚举遇到不存在的根就**静默跳过**，只把名字记进 `_summary.json` 的 `missing_roots` —— 没人看。

**重枚举后的真实数字**（`python scripts/enumerate_inventory.py`，可随时重跑）：

| 域 | 旧 | 新 | 增量 |
|---|---:|---:|---:|
| `editor` | 569 | **2 551** | +1 982 |
| `toolwindow` | 392 | 350 | −42 |
| `vcs` | 1 002 | **1 783** | +781 |
| `actions` | 115 | 317 | +202 |
| `settings-run` | 1 676 | **3 247** | +1 571 |
| `projectviews` | 342 | 755 | +413 |
| `ui` | 955 | 1 397 | +442 |
| **合计** | **5 051** | **10 400** | **+5 349** |

机检（`python scripts/parity_scan.py`）：**444 类在 TaoCode 出现过 / 9 956 类从未出现**（旧口径写的是 184 / 4 867）。

**逐条对比，7 个包的缺口已从 1715 降到 0**（`python scripts/inventory_gaps.py --all`，**有洞就 exit 1**）：

| 包 | 旧：真实/已枚举 | 现在 |
|---|---|---|
| `com/intellij/openapi/editor` | 941 / 206 | 941 / 941 |
| `com/intellij/vcs/log`（Git Log） | 580 / **0** | 580 / 580 |
| `com/intellij/ide/projectView` | 163 / **0** | 163 / 163 |
| `com/intellij/ide/actions/searcheverywhere` | 146 / **0** | 146 / 146 |
| `com/intellij/codeInsight/folding` | 72 / 1 | 72 / 72 |
| `com/intellij/ui/tabs` | 63 / 53 | 63 / 63 |
| `com/intellij/ui/popup` | 64 / 54 | 64 / 64 |

`toolwindow` 的 −42 **不是丢类**：`com/intellij/openapi/wm/impl/welcomeScreen` 整包 97 类按"更长后缀优先"划给了 `projectviews`（旧清单把它拆散在 `toolwindow` 的 20 个子包条目里），同时 `wm` 其余部分新增 7 类，`350 = (401 − 97) + 46`。

**两个附带结论**：
- §1.1–1.7 的包分布表、以及 §0 的 `174 659` / `32 352` / `4 955` 全部基于旧枚举，**作废**（`174 658` 是含测试的实扫值；排除测试源码集后全树 73 511 类；`platform` 未归属 20 574）。要数字就跑脚本，别信文档里的。
- **B1 的判决少覆盖 20 类**：判决表原是 107 类（`ui/tabs` 53 + `ui/popup` 54），而这两个包真实是 63 + 64 = 127 类。**已于 2026-09-27 补判完毕**，见 `docs/inventory/verdict-ui-tabs-popup.md` 末节「补判：2026-09-27 重枚举带进来的 20 类」：9 类是**文件颜色**（`com.intellij.ui.tabs` 的 File Colors 一族，本轮已实现，闭合 B1 缺口里最大的一块）、7 类是**弹层详情面板**（`[ ]` 可移植）、3 类是**弹层位置与内容刷新**（`[~]`，其中 `PopupUpdateProcessor`「数据变了要刷新已开的弹层」是本族唯一有用户可感差异的缺口）。

**新工具（都在 `scripts/`，都带"骗人就会失败"的退出码）**：
| 脚本 | 作用 | 失败条件 |
|---|---|---|
| `enumerate_inventory.py` | 按**包路径后缀**重枚举 7 域 + 重算 `platform_rest` / `_platform`；`--check` 只报差异 | 任一定义好的包一个类都没匹配到 → exit 1 |
| `inventory_gaps.py` | 核实指定包真实类数 vs 已枚举数 | 有缺口 → exit 1 |
| `parity_scan.py` | 逐类机检（原有） | — |

域定义只写在 `docs/inventory/_domains.json` 一处（可审计、可版本化）。重叠归属按"更长后缀优先"，`com/intellij/ide/todo` 归 `projectviews`（TODO 工具窗口）。

**仍未覆盖**：559 个包根 / 56 358 类在 7 域之外（`org/jetbrains/kotlin` 5 589、`com/intellij/openapi` 2 941、`com/intellij/platform` 2 526、`com/intellij/psi` 1 293…）。语言插件那部分按 §3 走 LSP/DAP 口径，不逐类对照；平台其余部分按 §2 的 A/B/C 堆推进。

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
| **B1** | `ui/tabs`（53）+ `ui/popup`（54） | 判决见 `docs/inventory/verdict-ui-tabs-popup.md` | **判决 107/107 完成**（`[~]` 20 / `[ ]` 56 / `[-]` 30 / `[x]` 1）。已实现：① `TabsUtil` 拖拽分屏几何；② `ScrollableSingleRowLayout` 的**溢出压缩 + `…` 隐藏标签下拉**（判决表里最大的一块）。剩余 `[ ]`：~~`TabsListener.beforeSelectionChange` 否决~~（**更正**：它返回 void、是通知不是否决，真行为是切标签重同步 —— 已落，见 `docs/ui-placement-audit.md` §AB）、~~`TabLabel` 就地重命名~~（**更正**：IDEA 无此行为，双击的真语义是预览晋升+隐藏全部工具窗口 —— 已落，见 `docs/ui-placement-audit.md` §AC）、~~`ActionPanel` 多动作按钮~~（标签条右端「更多」下拉已落，见 §AD）、~~`AbstractPopup` 选项集~~（候选键逐条核过：Esc 两段式已落，见 §AG；尺寸/位置见 §AE）、~~`PopupState` 尺寸记忆~~（**更正**：真出处是 `AbstractPopup`；SE 弹窗已记尺寸+位置，见 §AE）、~~`MnemonicsSearch`~~（已落：`src/selectIn.ts`，见 §AF.1）、~~列表行内动作~~（已落：欢迎页项目行/通知列表，见 §AF.2）、多行布局（Wrap/Compressible/Scrollable）、`TabInfo` 的 hidden/alert 等 |
| **B2**   | `toolwindow/openapi/wm`（350）：条纹按钮、内容模型、`impl/status` 的 widget 工厂             | 判决见 `docs/inventory/verdict-toolwindow-openapi.md` | **判决 350/350 完成**（`[x]` 4 / `[~]` 68 / `[ ]` 96 / `[-]` 182），逐条表在 §G、门控 `tests/b2-verdict.test.mjs`。**已实现 §C 第一条**：状态栏组件注册表（`src/statusBarWidgets.ts` 纯逻辑 + `src/statusWidgets.ts` 工厂表，判据 `tests/status-bar-widgets.test.mjs`，见 `docs/ui-placement-audit.md` §AI）。**并补上此前完全不存在的状态栏文字通道**（`StatusBar.Info` → `InfoAndProgressPanel.setText` → `StatusPanel.updateText`，含 `ProcessTerminatedListener` 的退出码文案与 Unix 信号表，判据 `tests/status-bar-text.test.mjs`，见 §AJ）。剩余 `[ ]`：`StatusBarWidgetsManager` 的 EP 动态增删、`EditorBasedWidget` 基类、十个 widget 工厂的逐个折装、`ToolWindowManager` 查询面、工具窗口注册机制（EP→Factory） |
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
| B1 实现 | `[~]` 进行中：已落地 `TabsUtil` 拖拽分屏几何 + `ScrollableSingleRowLayout` 溢出压缩与 `…` 下拉（标签裁剪/丢弃/隐藏全部按源码公式）。待做：~~`beforeSelectionChange` 否决~~（更正为通知；切标签重同步已落，见 §AB）、~~`TabLabel` 就地重命名~~（**更正**：IDEA 无此行为，双击的真语义是预览晋升+隐藏全部工具窗口 —— 已落，见 `docs/ui-placement-audit.md` §AC）、~~`ActionPanel` 多动作按钮~~（标签条右端「更多」下拉已落，见 §AD）、~~`AbstractPopup` 选项集~~（候选键逐条核过：Esc 两段式已落，见 §AG；尺寸/位置见 §AE）、~~`PopupState` 尺寸记忆~~（**更正**：真出处是 `AbstractPopup`；SE 弹窗已记尺寸+位置，见 §AE）、~~`MnemonicsSearch`~~（已落：`src/selectIn.ts`，见 §AF.1）、~~列表行内动作~~（已落：欢迎页项目行/通知列表，见 §AF.2）、~~Wrap/Compressible/Scrollable 多行布局~~（换行布局早前已落，本批补上固定标签单独成排 + 固定标签宽度上限，见 §AH） |
| B2 判决（`toolwindow` + `openapi/wm` = 350 类） | `[x]` 完成：`[x]` 4 / `[~]` 68 / `[ ]` 96 / `[-]` 182，见 `docs/inventory/verdict-toolwindow-openapi.md`（§0 机械总账 / §A-§E 分档 / §G 350 行逐条表），门控 `tests/b2-verdict.test.mjs`（350 覆盖 + `[x]`/`[~]` 引用必须真实存在 + 四档计数自洽 + 9 个 testSources 判 `[-]`） |
| B3..B12 判决                            | `[ ]` 起点：0 / 4944（B2 已闭合 350）                                                                                                                                                        |

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
| 1 | `ToggleFullScreen` / `ToggleDistractionFreeMode`（`ToggleFullScreenGroup`，`PlatformActions.xml:524-528`） | 宿主全屏通道（Win32 窗口态） | `[x]` **三个独立开关全部移植**（2026-09-27）：宿主 `native/window_state.cpp`（`register_window` + `set_full_screen`，去窗口装饰 + 铺满 `rcMonitor`，退出时恢复原样式与位置；依据 `platform/platform-impl/src/com/intellij/ide/actions/ToggleFullScreenAction.java:21/33/56`）+ 路由 `app.setFullScreen` / `app.fullScreen` + 菜单 `view.fullScreen`（IDEA 顺序：演示模式 → 专注模式 → 全屏 → Zen）。测试 `workspace_test` 1 条（无窗口必须报 `NO_WINDOW`，不假装成功）。**本组四个动作的做法**（IDEA 的顺序与语义）：① `TogglePresentationMode` 早已实现（持久化设置 `presentationMode`）；② **专注模式**：`src/distractionFreeMode.ts` 定双向规则（依据 `ToggleDistractionFreeModeAction.applyAndSave:93-124` 的 15 项 + `DistractionFreeModeController:11-15` 的 BEFORE/AFTER 前缀），`src/distractionFreeSession.ts` 持有会话状态；TaoCode 侧真实映射 **6 项**（状态栏/行号/空白/缩进参考线/面包屑/右边距 —— 那两项是本次新加的真实设置，各有消费链路：状态栏 `v-if` + `.editor-right-margin` 的第 120 列线），其余 9 项 TaoCode **没有那个 UI 元素**（主工具栏/导航栏/新主工具栏/折叠大纲/gutter 图标/方法分隔线/工具条边纹/标签位置×2），按「没有真实消费链路的设置项不渲染」不造字段；③ **全屏**：`native/window_state.cpp`（宿主能力）；④ **Zen = 专注模式 + 全屏**（核实自 `ToggleZenModeAction.kt:59-80` 的 `applyZenMode` —— 它内部持有一个 `ToggleDistractionFreeModeAction` 并调 `frame.toggleFullScreen`，**不是**"再叠一层隐藏"）—— 三者由 `createImmersiveMode` 协调。测试：`distraction-free-mode.test.mjs` 8 条 + `workspace_test` 1 条（无窗口报 NO_WINDOW）。 |
| 2 | `EditorToggleShowGutterIcons`（EditorToggleActions 内） | gutter 图标层（断点/书签之外的可点击行内图标） | `[x]` **宿主能力 + 开关都已落地**（2026-09-27）。**宿主能力**（这是本项原先缺的东西）：`src/gutterIcons.ts`（纯逻辑：`GutterIcon` 模型对齐 `GutterIconRenderer` 的 `getTooltipText`/`getClickAction`/`getAlignment`/`getAccessibleName`/`equals`（`platform/editor-ui-api/.../markup/GutterIconRenderer.java:59/68/105/121/210`）；`collectGutterIcons` 把各数据源折成"每行有哪些图标"，同行多条诊断合成一个图标、严重度取最高，行号从 0 基折成 1 基）+ `src/editorGutterIcons.ts`（CodeMirror `gutter` + `GutterMarker` 渲染，同一行并排多个图标，`toDOM` 按档位画内联 SVG，`mousedown` 把点击交回宿主；`initialSpacer` 固定宽度）+ `src/gutterIconHost.ts`（宿主装配：合成 + 点击分派）。**三个生产者全部是已有真实数据**：① LSP 诊断（点击 = 跳到该行并提示消息）② DAP 断点（点击 = 切换）③ 书签（**不可点** —— IDEA 里点开的是弹层，本仓缺 gutter 右键弹层基建，按 `clickAction == null` 的形态渲染）。断点/书签原先的**整行 boxShadow** 已删除，统一由图标层表达（避免两套并存）。**开关**：`editorSettings.showGutterIcons`（默认 true，`EditorSettingsExternalizable.java:87` `ARE_GUTTER_ICONS_SHOWN = true`）+ 视图 › 编辑器开关 ›「显示装订线图标」（`ToggleShowGutterIconsAction`，`intellij.platform.ide.impl.actions.xml:415`；菜单位置 `PlatformActions.xml:577` 紧跟「显示行号」）+ 设置页「编辑器 › 常规 › 装订线图标」（`GutterIconsConfigurable`，`id=editor.preferences.gutterIcons`，`intellij.platform.lang.impl.xml:1187`，`:221` Apply 写回）。测试 `tests/gutter-icons.test.mjs` 10 条；`tests/menu-submenu.test.mjs` 里原先那条「不许出现 gutter icons 一项」的守卫改成 `showGutterIcons` 的正向断言。**仍待办**：① `GutterIconRenderer` 的右键菜单动作（`getPopupMenuActions`）与中键动作（`getMiddleButtonClickAction`）—— 需要 gutter 图标上的右键弹层；② 书签图标的点击弹层（删除/助记符/上一个/下一个）；③ `GutterIconsConfigurable` 里那张「按插件分组的行标记列表」（每项勾选启用/停用某插件的行标记）—— 依赖 `LineMarkerProvider` 扩展点体系；④ 图标对齐（`Alignment.LEFT/CENTER/RIGHT`）目前一律 `center`，`left`/`right` 需要 gutter 分区；⑤ `isNavigateAction()`（点击算导航 ⇒ 进后退历史）未区分，当前诊断点击走 `revealLocation`（已进历史），断点点击不算导航 —— 与源码一致，但"文件内导航点"的边界需再核。 |
| 3 | `AutoShowProcessPopupAction`（BackgroundTasks 内） | 持久化的 `autoShowProcessPopup` 开关 + 进度面板联动（IDEA 用注册表键 `ide.windowSystem.autoShowProcessPopup`，`registry.properties:209-210`，**默认 false**） | `[x]` **已实现**（2026-09-27 核实）：落点 `src/bridge.ts:199`（设置字段，注释里带 registry 出处）+ `:229`（默认 false，与 IDEA 一致）+ `:1293`（`settings.update` 白名单）+ `src/progressPanel.ts:29-33`（任务数增加且开关为真时自动展开面板）。**为什么没有菜单勾选项**：IDEA 的动作 id 是 `AutoShowProcessWindow`，`platform/platform-impl/resources/intellij.platform.ide.impl.actions.xml:522` **只有 action 定义、没有 `add-to-group`** —— 它本来就不在任何默认菜单里，所以「用设置项承载」是等价落点，不是缺项。 |
| 4 | `HelpDiagnosticTools` 子菜单及整个「帮助」菜单（ShowLog / CollectZippedLogs / ShowMemoryDialog…） | 菜单栏还没有 help 组；日志目录/压缩日志/内存对话框都需要宿主通道 | `[x]` **宿主能力 + 菜单组都已落地**（2026-09-27）。**先补的宿主能力**（这是本项原先缺的东西）：`native/diagnostics.hpp/.cpp`（日志文件 `%LOCALAPPDATA%\TaoCode\log\taocode.log` + 超过 5 MB 轮转成 `.1`；`app.logPaths` / `app.specialPaths` / `app.collectLogs` / `app.troubleshooting` / `app.info` 五条路由；启动、打开/关闭工作区、退出、致命错误都写日志）+ `native/zipstore.hpp/.cpp`（最小 ZIP 写入/读取，store 无压缩 —— IDEA 用 `LogPacker.packLogs` 打包日志，本仓不引压缩库也能做出**真能用**的 zip：测试里读回校验往返，含二进制内容与空包）+ `native/dialogs.cpp`（拆出去的文件夹选择器与图片读取，让 main.cpp 回到机检上限内）。**菜单**：`src/menus/helpMenu.ts`（主菜单末尾的「帮助」组，IDEA 顺序 Git → Window → Help）+ `src/helpActions.ts`（动作）+ `src/components/AboutDialog.vue` / `SpecialPathsDialog.vue`。**已落地并各有真实落点**：查找操作（`GotoAction`，HelpMenu 第一项）· 快捷键与键盘映射（`Help.KeymapReference` → 内置帮助面板）· 显示日志（`ShowLogAction.java:33-40` → `app.logPaths` + `file.reveal`，文件不存在时退回打开目录）· 收集日志并打包…（`CollectZippedLogsAction.kt:42-110`：敏感信息确认 → 打包 → 显示）· 浏览特殊目录…（`BrowseSpecialPathsAction` → `app.specialPaths`）· 复制排障信息（`CollectTroubleshootingInformationAction` → `app.troubleshooting` 文本进剪贴板）· 关于 TaoCode（`AboutAction` → `app.info`：版本 / 平台 / WebView2 版本 / 配置目录）。`ShowMemoryDialog` 的等价物**已存在**（状态栏内存芯片 + `app.memory`），不重复造。测试 `tests/help-menu.test.mjs` 6 条 + 原生 `diagnostics_test`（9 条）与 `zipstore_test`（5 条）。**仍待办（缺的能力已写明，见 `src/menus/helpMenu.ts` 文件头逐条）**：① `HelpTopics` / `OnlineDocAction` / `Help.JetBrainsTV` —— 本仓没有官方文档站点与视频站（需要先有可打开的本地/在线帮助内容）；② `TechnicalSupport` / `ReportProblem` / `SendFeedback` —— 没有工单与反馈渠道；③ `LearnGroup` —— 需要 IDEA 那套「学习」插件（交互式教程）；④ `Performance.ActivityMonitor` / `Performance.MemTester` —— 需要性能采样器与内存压力工具；⑤ `Performance.DumpThreads` —— 需要宿主线程栈 dump 通道（Win32 `StackWalk64`/`MiniDumpWriteDump`）；⑥ `LogDebugConfigure` —— 需要 logging 的级别配置读写通道；⑦ `ResetWindowsDefenderNotification` —— JetBrains 特有的 Defender 集成，Windows 通用 IDE 无对应物（判定依据待核）。**同批顺手修掉的两处重复实现**：`base64_encode` 原有 **3 份**（main.cpp / workspace.cpp / runner.cpp，其中 runner 那份在匿名 namespace 里导致重载歧义）、`utf8`/`wide` 有 **2 份**（main.cpp / watcher.cpp）—— 已分别合并为 `native/base64.hpp`、`native/text.hpp`（inline，失败语义统一为抛异常而不是静默返回空串），main.cpp 行数因此从 2223 降到 2110（机检上限同步下调 2200 → 2110）。 |
| 5 | `PasteGroup`（$Paste / PasteMultiple / PasteSimple） | 剪贴板多段历史（PasteMultiple）与「无格式粘贴」（PasteSimple） | `[x]` **三条已移植**（2026-09-27）。**剪贴板历史环**：`src/clipboardHistory.ts` 逐句复刻 `platform/platform-impl/src/com/intellij/ide/CopyPasteManagerWithHistory.java`（`setContents`→`addNewContentToStack:96-141` 的全表去重、`getAllContents:221-227` 先同步系统剪贴板、`removeContent:229-238` 删表头后回落到新表头、`moveContentToStackTop:240-252`）与 `CopyPasteManagerEx.deleteAfterAllowedMaximum:101-116`（先截条数，再从**尾**向头把超 `maxMemory/maxCount/10` 的项换成占位符，**下标 0 永不清理**、总和达标即停）；上限取 registry `clipboard.history.max.items=100`、`max.memory=10000000`（`platform/util/resources/misc/registry.properties:1881/1883`），占位符文案取 `UIBundle.properties:208`。**选择器**：`src/components/PasteHistoryDialog.vue` 复刻 `ContentChooser` 的行渲染与按键（`:394-400` 序号右对齐、`:419-441` 前 80 字符 + 换行折 `⏎`、`:160-181` Delete 删除 / Enter 确定 / 数字键 1..9（0 = 第 10 项）、`:144-149` 双击确定）。**三条入口**：`src/pasteActions.ts`（`$Paste` = Ctrl+V、`PasteMultiple` = Ctrl+Shift+V、`EditorPasteSimple` = Ctrl+Alt+Shift+V，键位取自 `$default.xml:632-634` / `:288-290` / `:637-638`）+ 菜单 `编辑 › 粘贴`（`src/menus/editMenu.ts` 的 `edit.pasteGroup`，位置照 `PlatformActions.xml:450-458` 的 `CutCopyPasteGroup`）+ 全局键位（`src/keymap.ts`）。编辑器内的 Ctrl+V / Ctrl+X 也会入环（`src/clipboard.ts` 的 `installClipboardCapture`，对应 `$Copy`/`$Cut` 同样经过 `CopyPasteManager`）。**PasteSimple 与 Paste 的真实差别**由新设置承载：`CodeInsightSettings.REFORMAT_ON_PASTE`（`analysis-impl/.../codeInsight/CodeInsightSettings.java:143-148`，默认 `INDENT_EACH_LINE`）—— 已进 `editorSettings.reformatOnPaste`（前端接口 / 默认值 / 白名单 + 原生 `settings_schema.hpp/.cpp` 的键白名单与取值校验），并在设置页「编辑器 › 常规 › 智能键」渲染为四档下拉（新页键 `editor.preferences.smartKeys`，对应 `intellij.platform.lang.impl.xml:1181` 的 `editorOptionsProvider`）。分派规则 `src/pasteOptions.ts` 照 `PasteHandler.java:247-257`（**没有格式化器时强制 INDENT_BLOCK**）+ `DefaultTypingActionsExtension.java:118-124`；`indentPlainTextBlock:215-236` 为逐句复刻（纯文本路径），有格式化器时交给 LSP `rangeFormatting`。测试 `tests/clipboard-history.test.mjs` 14 条。**仍待办**：① `PasteFromX11Action`（`$default.xml:642-643` 的鼠标中键粘贴）在 Windows / WebView2 下没有 X11 选择区，判 `[-]` 的依据尚未核实；② `INDENT_BLOCK` 在**有**格式化器时走 `indentBlockWithFormatter:237-350`（约 110 行，依赖 PSI 的行内块结构，作用是「先调首行缩进、再把差量套到后续行」），TaoCode 用 `rangeFormatting` 覆盖同一档，**保留块内相对行缩进这一点未复刻** —— 需在 LSP 侧补一个「只调缩进、不改排版」的能力后重做。**同批补完 `CutCopyPasteGroup` 其余三条**（2026-09-27 第二次）：`$Cut` = `EditorCut`、`$Copy` = `EditorCopy`（`intellij.platform.ide.impl.actions.xml:169-170`，`use-shortcut-of` 继承 `$Cut`/`$Copy`）—— `src/editorClipboard.ts` 复刻 `CopyAction.prepareSelectionToCopy:107-118`（有选区复制选区；**无选区先按 `EditorActionUtil.selectEntireLines:135-140` 选中整行，且整行含行尾换行**）与 `CutAction.Handler:22-33`（同一套选区准备 + `deleteSelectedTextForAllCarets`）；复制后整行**保持选中**（`CopyAction` 默认 `preserveOriginalCaretState = !isCopyFromEmptySelectionToSelectLine()` = false），两个 AdvancedSettings 开关（`editor.skip.copy.and.cut.for.empty.selection` / `editor.skip.selecting.line.after.copy.empty.selection`）按源码默认值实现、暂不做设置 UI（IDEA 里它们是 registry/advanced 项，不在设置页）。DOM 层接管编辑器的 `copy`/`cut`（`copyCutChannel`），菜单两行 `剪切`(Ctrl+X) / `复制`(Ctrl+C) 走同一实现。`CopyPaths`（Ctrl+Shift+C，`$default.xml:454-456`）**只绑键位、不渲染菜单行** —— 源码 `CopyPathsAction.update:44-48` 里 `enabled = KEYBOARD_SHORTCUT.equals(e.getPlace()) && …` 且 `setEnabledAndVisible(enabled)`，即菜单 place 下它本来就不可见。同批把仓库里 8 处 `navigator.clipboard.writeText` 全改走 `copyToClipboard`（对应 IDEA「所有复制都经 `CopyPasteManager`」⇒ 都进历史环），并删掉原先那个全局 `copy`/`cut` 监听（编辑器通道更忠实：`window.getSelection()` 无选区时是空串，做不出「复制整行」）。测试 `tests/editor-clipboard.test.mjs` 6 条 + `tests/editor-commands.test.mjs` 新增「剪贴板命令也要能从菜单走到」一条。 |
| 6 | `ConvertIndentsGroup`（转换为空格/制表符缩进，PlatformActions.xml:500-505） | 纯文本变换，无需新能力（前导空白按 tabSize 折算） | `[x]` **已移植**：`编辑 › 转换缩进` 子菜单（To Spaces / To Tabs），`src/App.vue` 的 `convertIndents(mode)`——整文件前导空白按 tabSize 折算，`setDraft` + 标脏，用户 Ctrl+S 保存；宽度跟随「编辑器 › 代码风格 › 制表符与缩进」 |
| 7 | `Macros` 菜单 | 宏录制/回放系统 | `[x]` **三条动作 + 录制/回放都已移植**（2026-09-27）。**模型**（`src/macros.ts`，纯逻辑、10 条单测）逐条对照 `platform/platform-impl/src/com/intellij/ide/actionMacro/ActionMacro.java`：三类步骤 = `IdActionDescriptor`（按动作 id 调用）/ `TypedDescriptor`（输入文字，`:203-213` 的 `appendKeyPressed` **把连续字符合并成一条**）/ `ShortcutActionDescription`（按键，**`playBack` 是空实现** `:325-327` —— 与源码一致，回放时跳过）；`:62/222` `MACRO_ACTION_PREFIX = "Macro."` ⇒ `macroActionId(name)`；`upsertMacro` 复刻 `ActionMacroManager.addRecordedMacroWithName:307-330`（命名宏入表，同名先删旧；**空名字 = 匿名宏，只有一个、新的覆盖旧的**）；`macroNameError` 对应 `checkCanCreateMacro` 的循环再问；`serializeMacros`/`parseMacros` 是 `macros.xml` 的等价持久化（localStorage，坏数据/未知步骤丢弃 —— 宏是用户数据，宁可丢也不要让 IDE 起不来）。**录制钩子**复刻 `ActionMacroManager:100-121` 的全局 `AnActionListener.beforeActionPerformed`：`src/menuUi.ts` 的 `pickMenuRow`（主菜单）与 `runAction`（Find Action）在执行前各记一步，`StartStopMacroRecording` 自身不录；**打字也录**（`:496+` 的 `KeyPostProcessor`）—— 编辑器新增 `@typing` 事件（`src/editorTyping.ts` 从 `ViewUpdate.changes` 取插入文本），宿主按 400ms 合并成一条 `TypedDescriptor`。**回放**（`playMacro`）：动作按 id 走 Find Action 的那份清单（= `ActionManager.getAction(id)`），输入写进活动编辑器，`playing` 期间宏动作禁用（`InvokeMacroAction.update` 的 `setEnabled(!isPlaying)`，防递归）；`startRecording/stopRecording` 对应 `:148-155` / `:279-305`（停止时问名字、取消即丢弃、`lastMacro` 供「回放上一个宏」）。**菜单**：`src/menus/macrosMenu.ts` 放在 EditMenu 里（`PlatformActions.xml:506-510`：`PlaybackLastMacro` · `StartStopMacroRecording` · `EditMacros` · `PlaySavedMacrosAction`），对话框 `src/components/MacrosDialog.vue`（看步骤 / 删步骤 / 删宏 / 重命名 / 回放）。**顺手补的宿主能力**：`MenuRow.childrenOf`（IDEA `ActionGroup.getChildren()` 的对应物）—— 「已保存的宏」是动态子菜单，早先的静态 `children` 表达不了（宏表一变菜单不刷新）；渲染（`submenuRows(row)`）与 Find Action 的扁平化都已改走它。**仍待办**：① 录制时 IDE 的状态栏有一个**动画录制指示器**（`ActionMacroManager.Widget`，`AnimatedIcon.Recording.ICONS`）且点击即停止 —— TaoCode 用通知代替（状态栏 widget 体系里没有"动画图标"这一档）；② 录制按键里的**退格/方向键等非输入键**没有对应的 `MacroStep`（源码把 keyCode/modifiers 一起存进 `TypedDescriptor`，用于导出回放脚本 `generateTo`）；③ `EditMacros` 在 IDEA 里是一个 Configurable 页（可从设置进入），TaoCode 只做了对话框（设置页放置待核）。 |
| 8 | `EditorBidiTextDirection`（内容自适应 / LTR / RTL） | 双向文本方向支持 | `[x]` **三档已移植**（2026-09-27）。源码依据：枚举 `BidiTextDirection.java:21-23`（只有 `CONTENT_BASED / LTR / RTL`）、设置字段与默认值 `EditorSettingsExternalizable.java:137`（`BIDI_TEXT_DIRECTION = CONTENT_BASED`，`@Storage("editor.xml")` ⇒ 归 `editorSettings`）、动作 `SetEditorBidiTextDirectionAction.java:20-32`（`ToggleAction`：`isSelected` 比较设置值 ⇒ 三选一；`setSelected` 写设置后 `EditorFactory.refreshAllEditors()`）、菜单位置 `PlatformActions.xml:591-595`（`ViewMenu` 末尾的 **popup 子菜单**，在 `ToggleFocusMode` 之后），动作类 `intellij.platform.ide.impl.actions.xml:418-422`。落点：`src/bidiTextDirection.ts`（模式 / 文案 / 动作 id / CSS 映射，纯函数且有单测）+ `editorSettings.bidiTextDirection`（前端接口 / 默认值 / 白名单 + 原生 `settings_schema.hpp/.cpp` 键白名单、默认值与三值校验）+ 视图菜单「文本方向」子菜单（`src/menus/viewMenu.ts`，三项按 `BIDI_DIRECTIONS` 展开，`checked` 走设置值互斥）+ 行为落点在 `src/style.css`：`.editor-stage[data-bidi="…"] .cm-content` 三档 —— `rtl` / `ltr` 用 `unicode-bidi: isolate` 强制方向，`contentBased` 用 **`unicode-bidi: plaintext`**（让每个换行分隔的段落各自按首个强方向字符定方向，对应 IDEA 的段落级内容判定；不是元素级的 `dir="auto"`），宿主的 `:data-bidi` 绑在编辑器 stage 上（`src/App.vue`）。**没有设置页行**：`grep BIDI_TEXT_DIRECTION` 在源码里只命中 `EditorSettingsExternalizable` 与三个动作类，IDEA 的 `EditorSettingsConfigurable` 里没有这一行，所以 TaoCode 也不造。测试 `tests/bidi-text-direction.test.mjs` 6 条（纯函数 3 + 接线 3：CSS 三档选择器与 `plaintext`、宿主属性、菜单展开与写回、前后端键白名单）。**仍待办**：`BidiContentNotificationProvider`（`platform-impl/.../editor/impl/BidiContentNotificationProvider.java:69`，IDE 在文件里出现双向文本时提示「文本方向」子菜单）——需要一个"检测文档含 RTL 字符"的判定与提示条（TaoCode 有 `NoticeList` 可承接），尚未做。 |
| 9 | `NavigateInFileGroup`（MethodDown/MethodUp / 模板参数导航 / GotoCustomRegion） | ~~需要语言服务符号边界~~ **已核实：不需要**——用已实现的 `textDocument/documentSymbol` 即可（~~原先写「SymbolKind 6=Method / 12=Function」~~ —— 那个 kind 过滤**是错的**，见本行末尾的更正①） | `[~]` **MethodDown/MethodUp 已移植**：规则落点 `src/navigateInFile.ts`（依据 `platform/lang-impl/src/com/intellij/codeInsight/navigation/MethodUpDownUtil.java:24/48/61-73`、`MethodDownHandler:23-31`、`MethodUpHandler:23-30`）+ `App.vue:jumpMethod` + 导航菜单两项，经 `revealLocation` 跳转并接入后退历史。**2026-09-27 更正两处早先的不忠实**：① **挑的元素不该按 kind 过滤** —— 名字叫 Method，但 `addStructureViewElements`（`:61-73`）收的是结构视图的**全部**元素（类/字段/嵌套结构都算）；② **本行原先写「Alt Down/Up 与 IDEA 一致」是错的** —— `grep -rn 'actionId="$MethodDown"' --include=*.xml` 零命中，IDEA 没有给这两个动作绑默认快捷键，只有菜单项；已去掉自造键位。测试 `tests/navigate-in-file.test.mjs` 6 条；模板参数导航与 GotoCustomRegion 仍 `[ ]`（需要 LSP 的签名/折叠区能力） |
| 10 | `ExportImportGroup`（导入设置 / 导出设置 / 恢复默认设置）+ `PowerSaveGroup`（`TogglePowerSave`） | `platform/platform-impl/resources/idea/PlatformActions.xml:419-424`（`ExportImportGroup` popup：ImportSettings · ExportSettings · sep · RestoreDefaultSettings）、`:437-440`（`PowerSaveGroup` = sep + TogglePowerSave）、`:430-436`（`PrintExportGroup` = FileExportGroup(ExportToHTML) + Print）；实现 `platform/configuration-store-impl/src/ExportSettingsAction.kt:54-66`（`saveFile.outputStream().use { exportSettings(markedComponents, it) }` —— 把设置打包成一个归档）、`ImportSettingsAction.kt:47-70`（文件选择器 → `:58-65` `validateSelectedFiles` 校验 → 导入后提示重启）；打开/保存对话框对应 `FileChooser`（`ImportSettingsAction` 用 `FileChooserDescriptorFactory.singleFileOrDir()`） | `[x]` **三项设置动作 + 省电模式菜单行都已落地**（2026-09-27）。**先补的宿主能力**：① `native/dialogs.cpp` 的通用「打开文件 / 保存文件」对话框（`dialog.pickFile` / `dialog.saveFile`；过滤器串 `名称|通配符|…` 由纯函数 `parse_file_filters` 解析，有独立单测 —— 原来只有"选文件夹"与"选图片"两种）；② `native/settings_transfer.cpp`（**归档 = 一个 zip + 一份 JSON**；`zipstore` 原有接口只收磁盘文件，为此加了内存条目重载）+ `ProjectStore::export_settings/import_settings/reset_settings` + 路由 `app.exportSettings` / `app.readSettingsArchive` / `app.importSettings` / `app.resetSettings`。**比 IDEA 强的一点**：`app.readSettingsArchive` 是**只读摘要**（只校验、不写盘，并报出包里有什么），UI 的顺序是「读摘要 → 用户确认 → 才写盘」，而且归档的值域校验**复用 settings_schema 的补丁校验器**（坏包在写盘前就被拒），不像 IDEA 那样先导入、重启时才发现。**导入与恢复默认都保留最近项目列表**（IDEA 的导出清单里没有 recentProjects，`read_archive` 也只带 `settings`/`general`/`perProject` 三段）。前端 `src/settingsTransfer.ts`（纯逻辑：文件名/文案/段落标签 + `createSettingsTransfer` 三个动作）+ `src/menus/fileMenu.ts` 的 `file.exportImport` 三行与 `file.togglePowerSave` 一行。测试：原生 `settings_transfer_test`（4 条：往返、九种坏包分支、包结构）与 `dialogs_test`（5 条过滤器解析）+ 前端 `tests/settings-transfer.test.mjs`（11 条：文案、菜单行顺序与启用条件、"读-确认-写"的顺序断言）。**第二批（同日）补上 `ExportToHTML`**：先加宿主能力 `native/export_file.hpp/.cpp`（批量写导出文件：只写绝对路径 + 扩展名白名单 `.html/.htm` + 父目录必须存在 + 拒绝重解析点 + 2000 文件/64 MiB 上限，任一条不合法**整体拒绝**、一个字都不写）+ 路由 `app.writeExportFiles`；前端 `src/htmlExport.ts`（纯逻辑：范围常量 1/2/4、输出名 = 原名 + `.html`、行号开关、内联颜色的完整 HTML、目录级 `index.html`、`file://` 链接、结果文案）+ `src/htmlExportDom.ts`（从**已渲染的编辑器 DOM** 读每行的带颜色文本段，相邻同样式合并）+ `src/components/ExportToHtmlDialog.vue`（三个范围单选 + 包含子目录 + 输出目录 + 浏览 + 显示行号 / 在浏览器中打开，逐条照 `ExportToHTMLDialog.kt:51-103` 与 `reset():117-134` / `apply():135-156`）+ `ExportToHtmlSettings` 进项目级设置（原生默认值 + `validate_export_to_html` + 前端 `settingsModel.ts` + 预览校验）+ 文件菜单 `file.exportGroup` › `file.exportToHtml`（`PlatformActions.xml:430-436` 的 `PrintExportGroup` = 分隔 + `FileExportGroup`(popup) + `Print`）。**TaoCode 的两处如实差异（已写进对话框提示与结果文案）**：① 语法高亮来自编辑器已渲染的 DOM，所以**没打开的文件**导出为纯文本 + 行号（结果提示里报「几个带高亮、几个是纯文本」）；② 目录范围会为每个被导出的目录生成 `index.html`（与 `:248-255` 一致）。测试：原生 `export_file_test`（4 条，含真写盘与「非法批次一个字都不写」）+ 前端 `tests/html-export.test.mjs`（15 条）。**仍待办**：① `Print` —— 需要 Win32 打印能力（`PrintDlg` + 打印 DC + 分页），宿主能力未补（也因此在菜单里**不渲染**假行）；② 导出**项目/选中多个文件**的范围（IDEA 的 `PrintOption` 扩展点与 `ExportToHTMLManager` 的多文件路径）；③ `TemplateProjectProperties`（`FileOtherSettingsGroup`，要读写模板工程的 `.idea` 属性文件）与 `FileSettingsGroup`（源码里是空组）。
| 11 | `Notifications` 子菜单 | **已移植**（`窗口 › 通知`：关闭最新 / 关闭全部，`src/App.vue` 的 `closeFirstNotification` + `clearNotices`） | `[x]` |
| 12 | `EditorToggleActions` 子菜单 | **已移植**（`视图 › 编辑器开关`，含字号 ±）。字号的上下限曾误写 10–32（上游是写入 [4,40]、菜单动作 [8,40]）—— 2026-09-29 已订正并抽成 `src/editorFontSize.ts` 单一来源，判据 `tests/editor-font-size.test.mjs`，见 `docs/ui-placement-audit.md` §AK | `[x]` |

> 追加新条目时同样遵守：`状态` 只允许 `[ ]` / `[~]` / `[x]`；`[x]` 必须带落点文件。

## §10 桃 2026-09-27 点名的对照缺口（逐项对照 IDEA 源码推进）

| # | 缺口 | 对照源码 | 状态 |
|---|---|---|---|
| 1 | 左侧活动条（activity bar）的**内容与顺序**与 IDEA 不同 | 已按源码证据改默认锚点：`intellij.platform.lang.impl.xml:1329`（Project=left）、`intellij.platform.bookmarks.xml:47`（Bookmarks=left）、workspace.xml 默认（TODO/Version Control/Run/Debug=bottom） | `[~]` 默认分布 + **底部停靠**（底部 dock 的 tab 条与内容区复用 `ToolWindowView` 宿主；`showView`/`activateToolWindow` 按锚点分派）已生效；右侧 dock 复用宿主、拖放跨边与 IDEA 完全一致仍待续 |
| 2 | 顶部主工具栏的**内容与顺序**与 IDEA 不同（Run/Debug 配置选择、构建/运行、设置齿轮…） | `PlatformActions.xml:839-853`（`MainToolbarNewUI` = Left/`main.toolbar.Project`+`MainToolbarVCSGroup`+`MainToolbarGeneralActionsGroup`；Center/`main.toolbar.Filename`；Right/`ExecutionTargetsToolbarGroup`+`NewUiRunWidget`+`SearchEverywhere`+`SettingsEntryPoint`）+ `ExecutionActions.xml:118-141`（`RunToolbarMainActionGroup`：RedesignedRunConfigurationSelector → compositeResumeGroup → RunToolbarTopLevelExecutorActionGroup → Stop → MoreRunToolbarActions）+ `git4idea/shared/resources/intellij.vcs.git.shared.xml:35-38` | `[~]` **本批按源码重排**：① 运行 widget 顺序改为**配置选择器在最前**（此前放在最后，位置错），并让选择器显示当前配置名（对应 `RedesignedRunConfigurationSelector`），之后 构建/运行/调试/停止；② 右段补上 **SearchEverywhere**（查找操作）并保持 `SearchEverywhere → SettingsEntryPoint` 的源码顺序；③ 分支 widget 由「切到源代码管理工具窗口」改为打开**分支弹窗**（`GitBranchesPopup`，新增 `src/components/BranchPopup.vue` + `src/branchPopup.ts`，含搜索/检出/新建/删除/比较/变基/合并/推送，动作清单逐条对应 `backend.xml:303-333`），`Git › 分支…`（Ctrl+Shift+\`）也指向它。**仍缺**：`main.toolbar.Project` widget 的完整形态（IDEA 的项目 widget 还带书签/路径菜单）、`ExecutionTargetsToolbarGroup`（运行目标，需多目标概念）、`MoreRunToolbarActions`（更多运行动作菜单）、`MainToolbarGeneralActionsGroup` 的用户自定义动作区（TaoCode 没有动作自定义）；主题切换与帮助是 TaoCode 额外入口，已排在设置之后并在代码里注明 IDE 里没有 |　**2026-09-27 第五批（桃：「工具栏几乎全是错的」）**：按 `PlatformActions.xml:839-854` 的 `MainToolbarNewUI` 复查，改了三处 —— ① 菜单栏与工具栏原先**挤在同一行**（默认档 `merged`），而 `UISettings.kt:863` 把初值设成 `SEPARATE_TOOLBAR`（`MainMenuDisplayMode.kt:13-16` 三档），默认值改成 `separate` 并让模板结构上就是两行（`.topbar-menubar-row` / `.topbar-toolbar`）；② 去掉顶栏的「TaoCode」品牌格（IDEA 第一行就是菜单栏）；③ 去掉工具栏末尾的主题切换与帮助按钮（IDEA 的 `MainToolbarRight` 只有 `SearchEverywhere` + `SettingsEntryPoint`）。工具栏整块抽成 `src/components/MainToolbar.vue`。**仍缺**：`main.toolbar.GeneralActionsGroup` 的用户自定义动作区、`ExecutionTargetsToolbarGroup`（运行目标，需要多目标概念）。**另一处发现（已改，2026-09-28 第八批）**：`AnalyzeMenu` **从未插入 `MainMenu`**（`actionGroupStructure.txt:2444-2456` 解析出的主菜单只有 12 档，无 Analyze）⇒ 本仓把「分析」档删掉，检查这一族并进 `CodeMenu › InspectCodeInCodeMenuGroup`（`src/menus/analyzeMenu.ts` 的行工厂 + `codeMenu.ts` 展开在补全组之后），并把 `AnalyzeMenu` 挂到它真正的宿主 —— 项目树右键菜单 `ReplaceInPath` 之后（`JavaActions.xml:61-66`）；编辑器右键那一处要先有自绘的 `EditorPopupMenu` 容器。文案与键位逐条照资源：`Inspect Code…` 无默认键，`Run Inspection by Name…` = Ctrl+Shift+Alt+I （`keymaps/$default.xml:276-278`）。机检 `tests/main-menu-parity.test.mjs` 5 条。详见 `docs/ui-placement-audit.md` §L。
| 3 | 活动条/工具栏**点击后的菜单项**与 IDEA 不同 | **已读源码**：`ToolWindowHeader.kt:119` 标题栏动作组 = `DefaultActionGroup(DockToolWindowAction(), ShowOptionsAction(), HideAction())`；`DockToolWindowAction.java:22-59` 是**把 FLOATING/WINDOWED 状态的窗口收回停靠**（不是 Move-to 菜单）；`ShowOptionsAction`（:345-368）弹出的 `gearProducer.get()` 是**各工具窗口自己的选项组**；`HideAction`（:379+，图标 `AllIcons.General.HideToolWindow`） | `[~]` 现状：TaoCode 的标题栏 ⋮ 菜单是「Move to Left/Right/Bottom + Hide」——**与 IDEA 不同**。`[~]` **本批新增书签窗口的齿轮组**（`Bookmarks.ToolWindow.GearActions`，`intellij.platform.bookmarks.xml:191-206` + `BookmarksViewState.kt:18-31`）：只渲染有真实落点的三个开关 —— `groupLineBookmarks`（按文件分组 / 平铺）、`autoscrollToSource`（键盘选中即跳转）、`autoscrollFromSource`（切文件时滚到该文件第一条书签），状态存 `ProjectSettings.bookmarksView`（per-project，native 白名单 + 布尔校验，默认值取自 `BookmarksViewState:23-29`）；`BookmarksPanel.vue` 同时补了键盘上下导航与分组标题行。**无落点不渲染**：`askBeforeDeletingLists`（无命名书签列表）、`openInPreviewTab`（无预览标签页）、`rewriteBookmarkType`（无书签类型）；**仍缺** git/vcslog/todo/debug/tests 各自齿轮组、以及项目视图 `SelectInProjectView`/`ExpandRecursively` 之外的其余 title actions。`[~]` 现状：TaoCode 的标题栏 ⋮ 菜单是「Move to Left/Right/Bottom + Hide」；**已补**：项目视图（files）标题行的**齿轮菜单**（对应 ProjectView 的 gearProducer —— 全部折叠/全部展开/刷新目录 + 树外观：紧凑缩进 / 单击展开目录，两项写回 `editorSettings.compactTreeIndents` / `expandNodesWithSingleClick`）+ 恢复标题行的折叠/展开/刷新按钮；待续：其余视图（git/vcslog/todo/debug/tests…）各自的齿轮组；Dock 按钮**不适用**（无 FLOATING/WINDOWED 窗口态，附源码理由） |
| 4 | **设置**缺巨量核心逻辑 | 各 `*Configurable`（Editor/General/Keymap/Plugins/Tools…） | `[~]` **本批新增 `project.scopes`（IDEA `ScopeChooserConfigurable`）全链路**：模式语言 `src/scopes.ts`（词法/语法/求值/`getText` 回写/Include·Exclude 合并，逐条对照 `_ScopesLexer.flex`、`PackageSetFactoryImpl.Parser:74-211`、`FilePatternPackageSet:39-120`、`ScopeEditorPanel:545-645`）+ 主从设置页 `src/components/ScopesSettingsPage.vue` + native `scopes` 项目键与形状校验 + 消费点「搜索 › 范围」下拉（`FindPopupScopeUIImpl.java:59,137`）。**本批（2026-09-27 第二次）做了设置树的放置位置校正**：对照 EP 注册行（`parentId`/`groupId`/`groupWeight`）发现并修正 **11 处放错位置**（`editor.breadcrumbs`/`editor.stickyLines`/`Errors`/`Console`/`editing.templates`/`preferences.fileTypes`/`preferences.toDoOptions`/`preferences.externalTools`/`diff.base`/`build.tools`/`vcs.log`），新增「构建、执行、部署」分组，「版本控制」由分组改为顶层页面（证据见 `docs/ui-placement-audit.md` §F 与 `docs/settings-parity.md` 末尾总表）；同时新增两个页内编辑器：`src/components/TodoPatternsPage.vue`（IDEA TODO 模式表）与 `src/components/FileTypesPage.vue`（IDEA File Types），校验抽成 `src/todoPatterns.ts` / `src/fileTypes.ts`（与原生校验同规则）。**仍缺**：TODO 模式表的**颜色**列（需颜色方案页）、文件类型页的「已识别类型列表」（本仓只用扩展名映射）、`project` 分组下未移植的页（Path Variables / Run Configurations …）、`structure` 仍是设置页而非独立对话框。**同批校正 `editor.breadcrumbs`**（`BreadcrumbsConfigurableUI.kt:44-70` 三项：总开关 + 位置上/下 + 每语言开关，默认位置按源码改为「下方」，旧三值 `disabled` 迁移为 `showBreadcrumbs=false`）。**同批登记的作用域缺口**：① 预定义作用域（`CustomScopesProvider`：Project Files / Project and Libraries / Problems / 变更列表…）；② `ScopeDescriptorProvider`（`com.intellij.scopeDescriptorProvider`，CE 里没有实现）与 `SearchScopeProvider` 分组（`analysis-impl/resources/intellij.platform.analysis.impl.xml:43`，已注册 `DefaultSearchScopeProviders$CustomNamed`「Other」= `LangBundle:462` 与 `ChangeListsSearchScopeProvider`）；③ `ScopeEditorPanel.createTreeToolbar:647-679` 的树工具条（`FlattenPackagesAction` / `ShowFilesAction` / `ShowModulesAction` / `ShowModuleGroupsAction` / `FilterLegalsAction` / `ChooseScopeTypeAction`——后者只在方言 >1 时出现，本仓只有 `file` 一种方言故不渲染）；④ `ScopesStateService` 的每作用域 UI 状态（树展开状态）；⑤ 项目视图按作用域过滤；⑥ 色板/颜色方案页（`ColorAndFontOptions` + `GeneralColorsPage`）：`editor.breadcrumbs` 页底的「配置面包屑颜色」链接（`BreadcrumbsConfigurableUI.kt:72-77`）指向它，本仓没有该页，所以链接不渲染；⑦ 搜索面板的「范围 ∩ 文件掩码」交集：native 搜索只吃一个 include 列表，现在掩码走原生、作用域在结果上精确过滤，「全部替换」在范围限定下改为只替换已列出的匹配（`SearchPanel.vue` 内注释） |
| 5 | **运行配置 / 编译**缺巨量核心逻辑 | `RunManager`/`RunConfigurationsDialog`/`CompilerManager`/`BuildView` | `[~]` **已核对具备**：构建前保存（`startBuild` 先 `saveAll()` 再起进程，对应 BeforeCompile）、**配置按类型分派**（`runSelectedConfig`：`debug` 类型走结构化 program/args/cwd 启 DAP，非 debug 走 `startRun`，类型不匹配会提示）、beforeLaunch 链、构建输出面板与构建错误跳转（`jumpToIssue`）、停止（`stopAnyProcess` 同停 run+dap）；**本批新增**：`RunConfigurationsDialog.vue`（运行/调试配置对话框：左列表 + 右表单，菜单 `运行 › 编辑配置…` 打开）。**本批补齐对话框骨架**（对照 `ConfigurationSettingsEditorWrapper.java:36-89` + `ConfigurationSettingsEditorPanel.kt:34-67` + `RunConfigurable.kt:170-183/520-586/989-1229`）：左树改为「类型节点 › 文件夹节点 › 配置节点」三层 + 工具条（添加▾/删除/复制/保存配置/新建文件夹），右栏改为「Configuration 标签页容器 + 可折叠的启动前行（展开状态持久化）」，分组规则抽成 `src/runConfigTree.ts`（7 条测试）；`RunConfig.folder` 走全链路；并修掉预览模式静默丢弃 `adapter` 的 bug。**Allow multiple instances 已实现**（2026-09-27）：先补宿主能力 `native/run_host.hpp/.cpp`（多实例 `Manager`：每实例一个 `Runner` + **独立的 Before launch 链** + 按实例的停止/写 stdin；事件都带 `instance` id；新增 `run.started` / `run.instances` 路由）；语义逐条照源码 —— `RunConfigurationOptions.kt:54-56` `isAllowRunningInParallel`（默认 false）、`ExecutionManagerImpl.kt:613-619`（为假时先停同名实例，为真则并存）、`CommonTags.parallelRun():9-18`（复选框属「操作系统」组，文案 `ExecutionBundle.properties:566`）。前端：`src/runInstances.ts`（实例缓冲 + 当前实例镜像 + 聚合运行状态）、`src/components/RunConsole.vue`（**每个实例一个标签**，标签上的 × 只停那一个，照 `RunContentDescriptor`/`RunContentManagerImpl`）、运行配置对话框里的「允许并行运行多个实例」复选框。测试：原生 `run_host_test`（7 条：实例 id 与事件、同名先停、允许并行、链中止、按实例停止、非法参数）+ 前端 `tests/run-instances.test.mjs`（11 条：事件归属、镜像切换、聚合状态、接线）。**映射差异**：IDEA 把复选框**只放在模板上**（`ConfigurationSettingsEditorWrapper.java:73-74` `setVisible(settings.isTemplate() && …)`），本仓没有模板体系，所以它是配置上的复选框。**仍缺**：~~Allow multiple instances~~（已完成）、**Store as project file**（要写 `.idea/runConfigurations/*.xml`，而原生按设计禁止在用户项目里建配置，有测试锁住）、**Run on target**（仅模板配置有，本仓无模板体系）、配置模板/共享（IDEA 的 ConfigurationType 工厂 —— 上面的映射差异正来自这一项的缺失）、复合配置（Compound）、临时配置（Temporary）
| 6 | **插件页**布局与 IDEA 完全不同、缺逻辑 | `platform/platform-impl/src/com/intellij/ide/plugins/`：`PluginsConfigurable`、`InstalledPluginsTab.kt:81-339/678-733`、`PluginsGroupType.kt:7-21`、`newui/PluginsGroup.kt:18-155`、`newui/SearchQueryParser.kt:127-252`、`newui/SearchWords.kt:8-16`、`MarketplacePluginsTab.kt`；文案 `IdeBundle.properties:1572-1671`；比较语义 `util/.../StringUtil.java:2706-2712` | `[~]` **本批（2026-09-27）补了「分组 + 分类 + 搜索语法 + 插件包安装」四块，规则全落在 `src/pluginGroups.ts`（纯函数，19 条测试）**：① 13 个分组类型枚举照 `PluginsGroupType.kt:7-21` 逐项一致；② 组标题两种形态照 `PluginsGroup.kt:58-79` —— `titleWithCount()` 是 `前缀 (n)`，`titleWithCount(enabled)` 是 `IdeBundle.properties:1671` 的「用户安装（已启用 n/m）」；③ 组级动作照 `ComparablePluginsGroup:714-718`（全员未启用 → 「全部启用」，否则「全部禁用」）+ `:720-722` 的批量启停，界面按钮 = 逐个走 `plugin.setEnabled`；④ 排序照 `StringUtil.compare(..., ignoreCase=true)`（`StringUtil.java:2706-2712`）—— **码元比较，不是语言排序**：先前想用 `localeCompare('zh-CN')` 会把汉字排在拉丁字母之前，与 IDEA 的顺序正好相反（测试锁住了这一点）；⑤ 类目 = `plugin.json` 的 `category`（对应 `displayCategory`），缺省 `Other Tools`（`IdeBundle.properties:1599`）恒排最后（`:283-288`）；⑥ 已安装页两组构成（正在安装 / 用户安装）照 `:81-84, 200-204, 303-317`，**空组不渲染**；⑦ 搜索框 `/xxx` 语法照 `SearchQueryParser.kt:127-213`（`/enabled` `/disabled` `/invalid` `/userInstalled`、别名 `/downloaded`、`/outdated` 特例、`splitQuery` 的引号与冒号分词），**过滤按钮 = 往搜索框里加减 `/xxx`**，与手打完全等价（`:486-515` `handleSearchOptionSelection`）。**清单与安装**：`plugin.json` 新增可选 `id`（决定安装目录名，优先于容器名）与 `category`；「从磁盘安装」现在接受 **`.zip` / `.jar` 插件包**（`native/plugins.cpp` 调系统自带 `tar.exe` 解压，解压后逐条目校验不越界 + 限 5000 文件 / 128 MB，包内允许一层顶层目录，`plugin.json` 在根或唯一顶层目录里都认），目录安装保留为第二个入口。**贡献点的落点（本批同时修掉的一处假承诺）**：原先对话框写着"启用后它贡献的命令与实时模板会立即出现在菜单与模板列表里"，但 `pluginList` 当时只喂给欢迎页计数与对话框本身 —— **命令与模板没有任何消费链路**。现在两条都接上了：① 命令 → `src/pluginCommands.ts` 把启用插件的命令折成菜单行（`plugin.<插件 id>.<命令 id>`，按 `group` 分子菜单，接进 `src/menuUi.ts` 的 `allMenuGroups`，插在「工具」之后；没有命令时整组不出现），执行时在动作表里按 id 找既有动作（找不到就整行置灰 —— IDEA 里没注册的 action 根本不会出现）；因为它就在 `allMenuGroups` 里，「查找操作」也自动能搜到（`actionList` 递归摊平）。② 模板 → `src/templates.ts` 的 `effectiveTemplates/availableTemplates/expand/candidates` 增加插件模板参数（pattern = `plugin:<插件 id>:<key>`），编辑器补全与「包围」选择器都透传，插件的 key 与内建同 key 时遮蔽内建、用户自定义模板仍优先。测试：前端 `tests/plugin-groups.test.mjs`（19 条）+ `tests/plugin-commands.test.mjs`（12 条）+ 原生 `native/plugins_test.cpp`（15 条，CMake 目标 `plugin_management`）。**仍缺（缺的都是「还没有的能力」，不是有意不做）**：① **插件市场与更新**（`MarketplacePluginsTab.kt`、`PluginUpdatesService`，以及 `PluginsGroupType` 里的 `UPDATE` / `BUNDLED_UPDATE` / `STAFF_PICKS` / `NEW_AND_UPDATED` / `TOP_DOWNLOADS` / `TOP_RATED` / `CUSTOM_REPOSITORY`）—— 需要插件仓库与更新源；因此筛选里的「需要更新 / 内置 / 已更新的内置」**不渲染成控件**（渲染了就是点不动的假筛选），`parseInstalledQuery` 会如实把它们报成 `unsupported` 并在界面写明原因；② `/vendor:` `/tag:` 属性（`SearchQueryParser.kt:202-211`）—— 需要 vendor / tags 元数据；③ 插件详情的「依赖 / 变更日志 / 截图 / 评分」区（`PluginDetailsPageComponent`）；④ 前置的**插件分类树侧栏**（IDE 那棵树的数据来自市场）；⑤ 清单其余项（`depends` / `since-build` / `until-build` 兼容性检查、`actions` 扩展点） |　**2026-09-27 第六批 · 底部面板与工具窗口的错位（桃：「下窗口有巨量错误逻辑，左侧边栏有巨量错放 UI，巨量错误嵌套 UI」）**：根因是**同一张表被抄了四五份且内容互不一致** ——　**2026-09-27 第六批 · 状态栏**：IDEA 的 `<statusBarWidgetFactory>` 注册有 24 个 （`Encoding` / `LineSeparator` / `Position` / `Memory` / `Notifications` / `PowerSaveMode` / `ReadOnlyAttribute` / `SmartModeIndicator` / `CodeStyleStatusBarWidget` / `InsertOverwrite` / `inspectionProfileWidget` / `git` / `VfsRefresh` / `IndexesAndVfsFlushIndicator` / `WriteThread` / `FatalError` / `LanguageServiceStatusBarWidget` …）。本仓**已删掉两处 IDEA 没有的**：左侧的**品牌图标**格与「原生桥接已连接/就绪」chip（后者对应的诊断在「帮助 › 显示日志」）。**仍缺（多数是宿主没有对应能力，如实登记）**：`InsertOverwrite`（CodeMirror 6 没有覆盖模式 ⇒ 要从编辑器宿主补）；`VfsRefresh` / `IndexesAndVfsFlushIndicator` / `WriteThread`（本仓没有索引与写线程等待模型）；`inspectionProfileWidget`（没有可切换的检查配置文件）；`FatalError`（宿主有崩溃日志但没有状态栏级的致命错误指示）；`CodeStyleStatusBarWidget` 的**等价物已有**（状态栏的「缩进」chip 走 `editor.codeStyle.indents`，只是名字与 IDEA 不同）；`Notifications` 现在**两处都有**（右侧工具窗口 + 状态栏 chip）—— IDEA 只有工具窗口，状态栏那个 chip 要不要删待定（它是有用的入口，但严格对照应当只在工具窗口）。
· `toolWindowStripes.toolOrder`：把 `vcslog/todo/debug` 列在 `left` 下、`bottom` 是**空数组**，而 `stripeOrder` 是 `toolOrder[side].filter(id => toolAnchors[id] === side)` ⇒ 底部那条永远排不出顺序；
· `toolLayouts.DEFAULT_TOOL_ORDER`：**另一套旧顺序**；
· `toolLayouts` 的 `anchors`：把**每个窗口都写成 `left`**（与真实锚点完全相反）；
· `BOTTOM_TABS` 两份（`toolWindowActions` / `toolLayouts`），且 `App.vue` 还有自己的 `leftView` 字面量联合与 `type BottomTabId = typeof bottomTab.value`。
**修法**：唯一来源统一到 `src/toolWindowMeta.ts`（`DEFAULT_TOOL_ANCHORS` / `DEFAULT_TOOL_ORDER` / `BOTTOM_TABS` / `BottomTabId` / `ToolWindowId`），其余四处全部改为 import；`App.vue` 的两份本地类型删除。**顺带删掉底部的 `about` 标签** —— IDEA 的「关于」是「帮助 › 关于」的**对话框**（`AboutAction`），不是工具窗口；本仓把它塞进底部面板是一处错放（`AboutDialog.vue` 本来就有）。**新增 Notifications 工具窗口**（`anchor="right"`，`intellij.platform.ide.impl.xml:1210`），复用状态栏那份通知列表。
**仍缺（已登记，证据在手）**：① **`blame` 应内嵌编辑器** —— IDEA 的 Annotate 走 `TextAnnotationGutterProvider`（`AnnotateToggleAction.java:18/139-153`），把注解画在编辑器装订线上，而本仓做成了底部 tab；② `references`/`hierarchy` 在 IDEA 里是**动态创建的工具窗口**（`UsageViewManager`/`HierarchyBrowserManager`，不在 XML 注册，所以 grep 不到 `toolWindow id="Find"`），本仓放在底部 tab 的形态与之一致，但**没有"可拖动的独立窗口"**这一层；③ Notification 是 `secondary="true"`（默认收在条末端的"更多"里），本仓没有 secondary 机制。
| 7' | **项目结构**（`ProjectStructureConfigurable`）：IDEA 是独立对话框不是设置页 | `ProjectStructureConfigurable` + `ShowStructureSettingsAction.java:26-32` + `JavaActions.xml:45-48`（FileMainSettingsGroup after ShowSettings）+ `$default.xml:23-26`（Ctrl+Alt+Shift+S） | `[~]` **本批已改成独立对话框**：`src/components/ProjectStructureDialog.vue`（左分类 SidePanel + 右详情 + 确定/应用/取消），文件菜单「项目结构…」+ Ctrl+Alt+Shift+S 指向它，设置树里的那一页已移除。**仍缺**：分类只做了 项目 / 模块 / 库 三类（Facets / Artifacts / SDKs / Global Libraries / Problems 需要构件与 SDK 概念，登记待办） |
| 7 | 主页面（欢迎页）项目行宽窄不一 | RecentProjectIconHelper 行布局 | `[x]` 固定列宽已修 |
| 8 | 欢迎页左下角布局混乱 | 欢迎页侧栏底部只有齿轮 | `[x]` 说明移顶部 + 清重复 CSS |

> 说明：#1-#5 每一项都是独立的多轮工程，按上表顺序推进；每项完成时补源码路径与行号证据。

## §11 Gradle（桃 2026-09-27 点名优先：「优先移植 gradle 相关」，并指出旧逻辑是假逻辑、UI 位置错）

| # | 缺口 | 对照源码（逐行核实） | 状态 |
|---|---|---|---|
| 1 | **Gradle 的识别口径**（什么算 Gradle 项目、脚本名、wrapper 位置） | `plugins/gradle/settings/src/util/GradleConstants.java`：`:15-21` 脚本名（`DEFAULT_SCRIPT_NAME="build.gradle"` / `KOTLIN_DSL_SCRIPT_NAME="build.gradle.kts"` / `SETTINGS_FILE_NAME` / `KOTLIN_DSL_SETTINGS_FILE_NAME`）；`:22-27` declarative/XDCL 四种；`:28-30` `BUILD_FILE_EXTENSIONS = {gradle, gradle.kts, gradle.dcl, gradle.xdcl}`；`:32-44` `KNOWN_GRADLE_SETTINGS_FILES` 与 `KNOWN_GRADLE_FILES`（八个精确名字）；`:66-68` `GRADLE_WRAPPER_PROPERTIES_FILE_NAME="gradle-wrapper.properties"` / `GRADLE_DIR_NAME="gradle"` / `GRADLE_CACHE_DIR_NAME=".gradle"`；`GradleConfigLocator.java:26-50`（**项目 = 目录**，类注释引用 `GradleConnector.forProjectDirectory`） | `[x]` **识别只有一份实现**：`src/gradle.ts` 的纯函数 `detectGradle(files, wrapperProperties)`（`GRADLE_BUILD_FILES` / `GRADLE_SETTINGS_FILES` / `GRADLE_KNOWN_FILES` / `GRADLE_BUILD_FILE_SUFFIXES` / `GRADLE_WRAPPER_PROPERTIES` / `GRADLE_WRAPPER_SCRIPTS` / `distributionUrlFrom` / `gradleVersionFromUrl`），由 `tests/gradle.test.mjs` 9 条覆盖。**顺带修掉一个真实重复**：`settings.gradle.dcl` 同时以后缀 `.gradle.dcl` 命中且本身是 settings 文件，早先会被**同时算进 buildFiles**（`KNOWN_GRADLE_FILES` 用精确名字区分两类）—— 这个 bug 在 native 与前端各存在一份（正是"两份实现必然漂移"的实例），现只剩一份并有断言锁住 |
| 2 | **Gradle 同步通道**（跑一条命令、把输出/退出码推回，且不占运行控制台） | IDEA 用 Gradle Tooling API 拿工程模型；TaoCode 的等价通道是 CLI（`--console=plain`）。源码依据：`ExternalSystemProjectTracker` 是独立于 Run 的进度通道 | `[x]` **宿主能力 + 前端状态域都已落地**。宿主 `native/gradle.hpp/.cpp` 的 `SyncSession`（后台线程跑 `cmd.exe /d /s /c <command>`，复用 `Runner` 的 Job Object ⇒ 取消会连子进程树一起杀，不留孤儿 daemon；并发 start 抛 `BUSY`）+ 路由 `gradle.sync` / `gradle.cancel` / `gradle.state` + 独立事件通道 `gradle.started` / `gradle.output` / `gradle.exit`（`native/main.cpp` 的 `gradle_event_message = WM_APP + 10`）。前端 `src/gradleEvents.ts`（字节流解码 + 20 万字符上限）→ `src/gradleHost.ts`（检测/同步/解析/自动重载的状态域）。测试：原生 `gradle_test`（2 条，**真跑 `echo` 校验退出码与输出**、**真跑 `ping` 校验 BUSY 与取消**）+ 前端 `tests/gradle-events.test.mjs` 9 条（含跨块多字节字符、上限裁剪、终端订阅缓冲） |
| 3 | **Gradle 工具窗口**（IDEA 停在右侧的工程/任务树） | `plugins/gradle/plugin-resources/intellij.gradle.xml:228` `<toolWindow id="Gradle" anchor="right" icon="GradleIcons.ToolWindowGradle" factoryClass="/…GradleToolWindowFactory"/>`；`:231-232` `externalSystemViewContributor id="gradle"`。树的形状在 `platform/external-system-impl/.../view/`：`ExternalProjectsViewImpl.java:151`（`Touchbar.setActions(this, "ExternalSystem.RefreshAllProjects")`）、`ExternalSystemViewDefaultContributor.java:241-243`（节点名 `Dependencies`）、`:245-253`（作用域节点名 = 配置名）、`:311-336`（依赖节点带 ` (*)` 引用后缀）、`:341-343`（依赖节点的菜单 id `ExternalSystemView.DependencyMenu`）。工具条与菜单的组合在 `ExternalSystemActions.xml`：工具条 `:138-151`、Project 菜单 `:99-104`、Task 菜单 `:153-163`、依赖菜单 `:114`（**空组**）。**注意**：源码里**没有** `ActivateGradleToolWindow` 动作 ⇒ 它不占 Alt+数字 | `[x]` `src/components/GradlePanel.vue` 逐条照源码：工具条 = 同步（`RefreshAllProjects`）→ 展开/折叠（`:32-37`）→ 设置组（`ShowCommonSettings`=build.tools 页 / `ShowSettings`=Gradle 页，`:24-27`）；内容 = 工程 / `Tasks`（分组 → 任务，双击即运行 = `GradleRunConfiguration`，走运行控制台通道）/ `Dependencies`；右键 = Project 组（打开构建脚本 = `OpenConfig`、同步项目 = `RefreshProject`）与 Task 组（运行、创建运行配置 = `CreateAction`、打开构建脚本 = `EditSource`）。`OpenConfig` 打开的脚本由新纯函数 `gradleConfigFile()` 决定（= `GradleConfigLocator.adjust` 的顺序，`OpenExternalConfigAction.perform:49-59` → `ExternalSystemNodeAction.getExternalConfig:76-92`）。`src/toolWindowMeta.ts` 新增 `gradle`（标题 Gradle、默认 `anchor: 'right'`、**不进 `TOOL_MNEMONIC_ORDER`** 所以没有 Alt+数字）+ `src/toolWindowStripes.ts`（停靠/顺序/可用性状态域）+ `ToolWindowView.vue` 的分派分支 + `gradleViewContext()`（外壳只展开一次，不抄十几行）。**仍待办**：① `SelectProjectDataToImport`（导入时挑数据结构，需要 Tooling API 的模型树）；② `DetachProject` / `IgnoreProject`（本仓只有"工作区根 = 唯一被链接的工程"，`IgnoreExternalProjectAction` 的对象是"根目录下发现的候选工程"，需要先有候选扫描）；③ `OpenTasksActivationManager` + `TaskActivationGroup`（同步前/后、编译前/后自动跑任务，需要任务激活配置对话框）；④ `AssignShortcut` / `AssignRunConfigurationShortcut`（快捷键分配 UI —— 本仓 `src/keymap.ts` 只有内置键位表，没有用户自定义快捷键的落点）；⑤ 工具条的 RunPanel / OtherActionsPanel 在源码里就是空组（`:123-126`），不渲染是对的；⑥ 任务树还没按工程分层（Gradle 的任务名带 `:app:build` 前缀，可以再按工程归拢成 IDEA 的三层） |
| 3b | **依赖树**（`Dependencies` 节点） | `ExternalSystemViewDefaultContributor.java:228-243`（`MyDependenciesNode`，名字是字面量 `"Dependencies"`）、`:245-303`（作用域节点 = 一个配置，name 取 `getScope()`，description 进 tooltip；`getChildrenErrorLevel` 递归判定 UnknownDependencyNode ⇒ 命令行版用 Gradle 自己打的 `(n)`）、`:311-350`（依赖节点的显示名 = `DependencyNode.getDisplayName()`，引用节点加 `" (*)"`，图标在库/工程之间二选一） | `[x]` **懒加载**（与 IDEA 一致：节点展开时才建子节点）：`src/gradle.ts` 的 `parseGradleDependencies()` 解析 `gradle dependencies --console=plain`（作用域行 `<配置名> - <说明>` / `<配置名> (n)`；树行按 Gradle 的 **5 字符一层**算深度；`(*)`/`(c)`/`(n)`/`-> <版本>` 四种标记都认出来）、`dependenciesByProject()` 按工程归拢，节点名取常量 `GRADLE_DEPENDENCIES_NODE_NAME`（= 源码的字面量）。`gradleHost.loadDependencies()` 只在展开时跑一次，**一次同步会作废它**（IDEA 同步后整棵树重建）；命令走同一条 `SyncSession`（`runningKind` 决定退出时用哪个解析器）。测试 5 条（含多工程分节、`No dependencies` 与"解析出 0 条"的区别、`(n)` 不是说明文案）。**仍待办**：① 依赖节点的右键菜单（源码里 `ExternalSystemView.DependencyMenu` 是**空组**，本仓同样不给动作；IDEA 的三个依赖分析器（`DependencyAnalyzer.DependencyListGroup` 等，`ExternalSystemActions.xml:191-193`）由插件提供，本仓没有）；② 版本冲突的"被解析到"与"实际解析出"两棵树（IDEA 用 DependencyAnalyzer 的 `UsagesTreeGroup`）；③ 依赖搜索/过滤（IDEA 的树支持快速过滤） |
| 4 | **`build.tools` 组里的「自动重新加载项目」是**假逻辑**（桃点名） | `platform/external-system-impl/.../service/settings/ExternalSystemGroupConfigurable.kt:22-26`（**projectConfigurable**、id=`build.tools`、`BackedByPersistentState`）；`:28-29` backing component = `ExternalSystemProjectTrackerSettings`；`:31-55` 复选框 + `全部(ALL)/选择性(SELECTIVE)` 单选（`.enabledIf(cbReload.selected)`）+ `onApply`（`autoReloadType = enabled ? value : NONE`，并把 value 记进 `PREVIOUS_KEY`）；`:58` `PREVIOUS_KEY = "settings.build.tools.auto.reload"`。三档语义 `platform/external-system-api/.../autoimport/ExternalSystemProjectTrackerSettings.kt:12-28`：**ALL** = 任何构建脚本改动；**SELECTIVE** = VCS 更新 **或 IDE 之外**的构建脚本改动；**NONE** = 全关 | `[x]` **旧实现是错作用域 + 错元数，已整体替换**（桃的原话：「现在的逻辑是假逻辑，错逻辑」）。旧：应用级布尔 `generalSettings.buildToolAutoReload`（`GENERAL_SETTING_KEYS` 里的键）→ diskSync 里"关掉就不再刷新项目视图"。新：**项目级** `ProjectSettings.buildTools = {autoReloadType, previousAutoReloadType, gradle}`（native `project_defaults()` + `validate_build_tools` 三档校验 + 局部补丁 `merge_patch` 合并；旧键从应用级键表移除，由 `prune_unknown` 剪掉 —— 它回答的是另一个问题，不做迁移）。前端消费者 `src/gradleHost.ts` 的 `onBuildFilesChanged`（纯函数 `shouldAutoReload(type, {changedBuildFile, changedOutsideIde, afterVcsUpdate})` 在 `src/gradle.ts`）；`src/diskSync.ts` 只把"这一批变了哪些文件"转交过去（**VFS 刷新与自动重载是两个独立机制**，前者照旧无条件做）；VCS 更新那条触发由 `src/vcsActions.ts` 的 `noteVcsUpdate()` 发出（checkout/create/rebase/merge/pull/stash.pop）。「IDE 之内 vs 之外」的判据：这个脚本此刻是否开在编辑器里（TaoCode 没有 IDE 自己的写盘之外的写者）。**仍待办**：① `ExternalSystemProjectTracker` 的「同步中」进度条与「重新加载」通知按钮（IDEA 在编辑器顶部给一条可撤销提示）；② 文件监听批次溢出（`fs.changed` 不带路径）时现在是"重新检测并比对脚本清单"，VCS 之外的多路径溢出仍无法逐文件判定 |
| 5 | **Gradle 设置页**（用哪个 Gradle / 用户主目录 / 离线模式），且要挂在 `build.tools` 之下 | `intellij.gradle.xml:177-179` `<projectConfigurable groupId="build.tools" groupWeight="110" id="reference.settingsdialog.project.gradle">`；`GradleProjectSettings.java:44/118-124`（`myDistributionType` + `gradleHome`）；`GradleSettings.java:30-31`（`@State(name="GradleSettings", storages=@Storage("gradle.xml"))` ⇒ **项目级**）、`:113-115`（`getServiceDirectoryPath()` → `GradleLocalSettings.getGradleUserHome()`）、`:118-131`（`isOfflineWork`；`GradleSystemSettings.java:74-83` 里那个同名方法**已废弃并注明"必须是项目级"**） | `[x]` `src/components/GradleSettingsPage.vue`（三项 + wrapper 检测结果提示行）与 `src/components/BuildToolsSettingsPage.vue`（复选框 + 两档单选，逐条照 `:31-55` 的 UI 与 `onApply` 语义），后者挂 `build.tools`、前者挂其子键 `reference.settingsdialog.project.gradle`（`PROJECT_SCOPED_PAGES` 两页都在，保存走 `project.settings.update`）；命令拼装在 `gradleCommand(detection, settings, task)`（wrapper 优先 → 指定路径 → 本机，恒带 `--console=plain`）。**仍待办**：`GradleConfigurable` 的其余项 —— Gradle JVM（`getGradleJvm()`）、`disableWrapperSourceDistributionNotification`、`resolveModulePerSourceSet`、`resolveExternalAnnotations`、composite build、`gradle.properties` / `gradle-daemon-jvm.properties` 文件与「构建并运行使用：Gradle / IntelliJ IDEA」的选择器（都需要 Tooling API 或 JVM/模块概念）；`GradleSystemSettings` 的应用级两项（`serviceDirectoryPath` 已废弃、`gradleVmOptions`）也未移植 |
| 6 | 顺手修掉的**重复实现**（Gradle 通道让 main.cpp 超了机检上限，逼出来的） | —— | `[x]` ① 九个域**逐字相同**的事件队列（clone/lsp/run/dap/term/watch/search/git/gradle 的 `mutex + deque + PostMessage`）收成 `native/event_channel.hpp/.cpp` 的 `EventChannel`（`push/take/size`，限长语义与原样一致：run/gradle 4096 丢 1024、term 8192 丢 2048、watch 256 丢 1、lsp 512 丢 1、dap 2048 丢 1、git 不限长），顺手删掉与 `queue_git_reply` 逐字相同的 `queue_git_reply_event`；`native/main.cpp` 2083 → 上限从 2110 降到 2084；原生测试 `event_channel_test` 6 条（含"push 真的投了窗口消息"与"limit=0 表示不限长"）。② 前端 `src/bridge.ts` 顶到 1450 上限 → 拆出 `src/base64.ts`、`src/gradleEvents.ts`、`src/terminalEvents.ts`（终端"订阅前的输出缓冲"那条真实逻辑一并搬过去），上限降到 1421。③ `src/components/SettingsDialog.vue` 顶到 1450 → 拆出 `src/settingsTreeMeta.ts`（设置树的表：页面键/分组/节点/随项目保存的页，与 `src/toolWindowMeta.ts` 同模式）与两个设置页组件，上限降到 1381。④ `src/App.vue` 顶到 2895 → 拆出 `src/toolWindowStripes.ts`（停靠边/顺序/可用性），上限降到 2877，并修掉一个真实缺陷：老用户 localStorage 里的 `toolOrder` 不含新窗口，`right` 侧原本只保留已存项 ⇒ **新加的右侧窗口永远看不到按钮**（现在按锚点补新窗口） |
| 7 | **「构建项目」按项目类型分派**（桃 2026-09-27：「主要是真的能构建 java 代码，gradle 等配置，IDEA 打开默认都是有的，现在；逻辑错误」） | `java/compiler/impl/src/com/intellij/compiler/actions/CompileDirtyAction.java:28-30`（`ProjectTaskManager.buildAllModules()`）、`CompileAction.java:44-60`、`GradleProjectTaskRunner.kt:186-214`、`TasksExecutionSettingsBuilder.java:52-58/151-181`、`MavenProjectTaskRunner.kt:176-193/215-220`、`JpsProjectTaskRunner`、`JavaHomeFinderBasic.java:59-71/238-256`、`JdkUtil.java:64-72`、`JdkVersionDetectorImpl.java:54-69`、`GradleProjectSettings.java:60`、`ExternalSystemJdkUtil.java:52` | `[~]` **本批（2026-09-27 第三批）修掉了桃点名的逻辑错误**：`src/runActions.ts` 的 `startBuild` 原先写死 `runCommand.value || 'cmake --build build'` —— 打开 Gradle / Java 项目按 Ctrl+F9 会去跑 cmake。现在折算规则在 `src/projectBuild.ts`（纯函数 + 14 条测试）：Gradle ⇒ `classes testClasses`（重建追加 `--rerun-tasks`，**不是** clean —— 源码用 init script 让 `AbstractCompile` 不 up-to-date）、Maven ⇒ `compile`（重建先 `clean`）、纯 Java ⇒ **javac**（`-g -encoding UTF-8 -d out/production/<模块名> -cp … @argfile`，JPS 的等价物）、其余退回项目配置的命令。**「IDEA 打开默认就有」补了三样**：① JDK 列表 —— 宿主 `native/jdk.cpp`（照 `JavaHomeFinderBasic` 的 finders 顺序 + `JdkUtil.checkForJdk` + 读 `release` 文件）+ 路由 `app.jdks`，前端打开项目时**只填空值**地写回 `JavaProjectSettings.jdkHome`；② 编译输出目录默认 `out/production/<模块名>`；③ **Gradle JVM**（`BuildToolsGradleSettings.gradleJvm`，默认 `#USE_PROJECT_JDK`；设置页第一项是下拉，跑 Gradle 时折成 `JAVA_HOME` → `gradle.sync` 的 env → `Runner::Spec.environment`）。**真实证据**：用生成的命令形状在本机编译 `Hello.java` ⇒ `out/production/demo/Hello.class`，`java -cp … Hello` 打印 `built ok`。测试：前端 `tests/project-build.test.mjs`（14 条）+ 原生 `native/jdk_test.cpp`（7 条，CMake 目标 `jdk_detection`）。**运行/调试入口（本批已补）**：`runContextConfiguration` 原先只会找 `${output}/${stem}.exe` —— 对 Java 完全不对。现在按扩展名分派：`.java` 走 `src/javaRun.ts`（`mainClassFor` 取**全限定名**，规则照 `AbstractApplicationConfigurationProducer.java:50-74` 与 `JvmMainMethodSearcher.java:197-227` —— 返回 `void`、`public static`、唯一参数是 `String[]`（`String...`/`String args[]` 都认）；`JvmMainMethodSearcher.java:31-37` 的 `MAIN_CLASS` 决定哪些类算顶层主类，嵌套类不算），命令 `java -cp "<输出目录>;<依赖>" <主类>`，调试走 DAP 的 `java` kind（program = `<jdk>/bin/java.exe`）。类里没有 main 时**照样启动并先提示**（与 IDEA 一致：让 JVM 去报 `no main method`）。**端到端验证**：带包名的源文件 ⇒ `javac` 编到 `out/production/demo` ⇒ `java -cp out/production/demo com.example.Main hello world` 输出 `java run ok: 2 args`。测试 `tests/java-run.test.mjs`（8 条）。**仍缺**：② Gradle 的「源码集分层」（`resolveModulePerSourceSet`）、composite build、**「构建并运行使用」已完成**（delegated build/run：`GradleProjectSettings.java:40` `DEFAULT_DELEGATE = true`、`:163-168` `getDelegatedBuild()`（存盘键就是 `delegatedBuild`，`:172-178` 的 `@OptionTag`）、`:194-196` `isDelegatedRunEnabled = isDelegatedBuildEnabled && AdvancedSettings.getBoolean("gradle.run.using.gradle")`（那个内部开关默认 true，见 `intellij.gradle.xml:313`）；UI 位置照 `IdeaGradleProjectSettingsControlBuilder.java:255-257` 的调用顺序放在 Gradle 组**之前**，文案 `GradleBundle.properties:46`，两档 = Gradle / IDE 名（`:808-814`））—— 选「TaoCode」时构建落到本仓的 **javac**（等价 IDEA 的 JPS：`GradleProjectTaskRunner.canRun:209-214` 返回 false），运行本来就不委托；**仍缺**：源码集分层（`resolveModulePerSourceSet`）、composite build、Maven 侧的委托设置；③ 编译输出的**增量**语义（IDEA 有 JPS 增量编译器，本仓 javac 是全量）；④ Gradle 任务的按模块裁剪（IDEA 查模块里真实存在的任务，CLI 版固定 `classes testClasses`）。 |

## §12 下一批的落点（2026-09-28 核实完证据；12.1 本轮已完工）

### 12.1 Alt+F1 的 **Select In 弹窗** —— ✅ 已修完（2026-09-28 本轮）

原来是 `src/keymap.ts` 把 Alt+F1 直接绑到 `selectInTree()`（一步跳项目树），状态栏 chip 的提示还写着
`(Alt+F1)` —— 等于给用户一个"背后没有弹窗"的键位。现在按上游的两步语义做完：
Alt+F1 → **目标列表弹窗**（`src/components/SelectInPopup.vue`）→ 按编号/方向键选落点。
纯规则在 `src/selectIn.ts`，表与分派在 `src/editorSideViews.ts`，测试 `tests/select-in.test.mjs`（11 条，含反例）。

证据（逐条读过原文；本轮把上一版登记错的三处也一并改正）：

| 事实 | 出处 |
|---|---|
| Alt+F1 这一步是**开弹窗**，不是执行第一项 | `SelectInAction.java:44-48` → `:62-72`（`popup.showInBestPositionFor(dataContext)`） |
| 默认走 **action group popup**（`ide.selectIn.experimental.popup` 默认 true），旧版 `BaseListPopupStep` 是 else 分支 | `SelectInAction.java:65`、`:88-106`、`:74-86` |
| 编号规则 `n<9 → 1..9`、`n==9 → 0`、`n>=10 → 'A'+n-10`，**分隔行不占号** | `ActionStepBuilder.java:120-131`；旧版字符串版同规则：`SelectInAction.numberingText`（`:184-195`） |
| 编号画在**行首独立一列**（`myMnemonicLabel`），不是文案里的 `1. ` 前缀；选中行改用选中前景 | `PopupListElementRenderer.java:363-369` |
| 该列颜色 = `Popup.mnemonicForeground` → `ActionsList.MNEMONIC_FOREGROUND` = `JBColor.namedColor("Component.infoForeground", new JBColor(Gray.x99, Gray.x78))`；expUI 两档都没定义 `Component.infoForeground` → 取回退值 **#999999 / #787878** | `JBUI.java:1635-1636`、`:393`；`expUI_light.theme.json:274-283`；`Gray.java:457`（`_153`）、`:424`（`_120`） |
| 顺序只认 `getWeight()` **升序**（稳定排序），默认权重 0 | `SelectInManager.java:23-27` + `:54-61`；`SelectInTarget.java:49-51`；常量表 `StandardTargetWeights.java:5-16` |
| **更正（上一版写错）**：不可选的目标**留在列表里置灰**，不是"不出现" —— 弹窗建时 `showDisabledActions=true`，`isSelectable` 只决定能不能选中 | `SelectInAction.java:99-105`（第 5 个实参）、`:171-176` |
| 按键：只在 `KEY_TYPED`、已被消费/速度搜索框**已有字**时不响应、仅字母数字、命中才选中并 `consume()`；映射表**大小写各登记一份** | `MnemonicsSearch.java:34-46`、`:25-31` |
| 选中后先 `commitAllDocuments()` 再 `target.selectIn(context, true)`（requestFocus） | `SelectInAction.java:147-151` |

出厂的六个落点（标题 ↔ 上游字面量 ↔ 本仓真实现；权重照抄 `StandardTargetWeights`）：

| # | 本仓标题 | 上游 | 权重 | 落点 | canSelect 判据 |
|---|---|---|---|---|---|
| 1 | 项目视图 | `ProjectViewSelectInGroupTarget.java:66` → `ProjectConceptBundle.properties:12` "Project View" | 0（接口默认） | `selectInTree()` | 有活动文件且有工作区 |
| 2 | 文件结构 | `StructureViewSelectInTarget.java:35-41` → `IdeBundle.properties:305` | 4 | `focusToolWindowContent('outline')` | 有文件编辑器（对应 `getFileEditorProvider() != null`） |
| 3 | 导航栏 | `SelectInNavBarTarget.java:41-43,102-104` → `IdeBundle.properties:261` | 8 | `showNavBar()` | 面包屑对该语言可见（`UISettings.getShowNavigationBar()` 那一档） |
| 4 | 提交 | `SelectInChangesViewTarget.java:29-38` → 名称取本地更改窗口标题（`ChangesViewManager.kt:360-368`） | 9 | `focusToolWindowContent('git')` | 该文件在 VCS 里有变更（`FileStatus != NOT_CHANGED`） |
| 5 | 在资源管理器中显示 | `ProjectViewSelectInExplorerTarget.java:29-37` → `RevealFileAction.getActionName()` = `ActionsBundle.properties:1937` "Show in {0}" + `IdeBundle.properties:3209` "Explorer" | 9.5 | `shell.reveal` / `file.reveal` | 磁盘上真有这个文件（合成条目 `\u0000` 前缀排除） |
| 6 | 项目结构 | `ProjectStructureSelectInTarget` → `JavaUiBundle.properties:25` "Project Structure" | 10 | `openProjectStructure()` | 有工作区 |

**书签目标刻意不做**（也更正上一版的登记）：上游 `BookmarksSelectInTarget.kt:26-33` 的 `canSelect` 只认
`FileBookmark`，而本仓的书签全是行书签（`src/bookmarks.ts` 的 `Bookmark { path; line }`）—— 加进来就是一条
永远灰着、还谎称"对齐上游"的行。等有文件书签模型时再补，位置在权重 1.001（`BOOKMARKS_WEIGHT`）。

菜单侧一并归位：`SelectIn` 在 IDEA 的 `GoToMenu › GoToCodeGroup` **开头**（`actionGroupStructure.txt:310 / :2243-2247`：
`<sep>` → SelectIn → ShowNavBar → `<sep>` → GotoDeclaration），所以「在…中选择… (Alt+F1)」与「显示导航栏 (Alt+Home)」
现在排在「转到声明/定义」**之前**，原来那条挂在书签区后面、写着 `Alt F1 1` 的「在项目中选中」已删除。

## 13. Gradle「链接 / 断开链接」已接上，两处刻意留的上限

2026-09-29 补上了 IDEA 的那条手动链接：项目树右键 `build.gradle(.kts|.dcl|.xdcl)` / `settings.gradle…`
⇒「链接 Gradle 项目」（`ImportProjectFromScriptAction.kt:18-30`，文案 `GradleBundle.properties:141-142`），
工具条补 `ExternalSystem.DetachProject`（`ExternalSystemActions.xml:120-122`，文案
`ExternalSystemBundle.properties:67`「Unlink {0} Project」）。链接列表存在项目级
`buildTools.gradle.linkedProjects`（对应 `GradleSettings` 的 `linkedProjectsSettings`，存 `.idea/gradle.xml`），
工具窗口可用性改成上游那条 `shouldBeAvailable = !linkedProjectsSettings.isEmpty()`
（`AbstractExternalSystemToolWindowFactory.java:32-34`）。

还差两块，都是**知道形状再留**的，不是漏的：

| # | 缺口 | 上游坐标 | 现在做到 | 要走到的下一步 |
| - | ---- | -------- | -------- | -------------- |
| 1 | 多工程并列 | `GradleSettings.getLinkedProjectsSettings()` 是**集合**，工具窗口把每个链接工程画成独立根节点（`ExternalProjectsViewImpl` + `ProjectNode`） | 列表能存 N 项、能显示全部；检测/同步只取**第一项**（`src/gradleHost.ts` 的 `ponytail:` 注释） | 给 `GradleProjectNode` / `GradleTaskNode` 加所属工程字段，工具窗口按"工程 → Tasks/Dependencies → 分组 → 任务"重排；`gradle.sync` 要按目录排队跑（宿主同一时刻只允许一条） |
| 2 | 编辑器右键那一份 | `intellij.gradle.xml:408-411`：同一个动作挂 `ProjectViewPopupMenuSettingsGroup` **和** `EditorPopupMenu` | 只有项目树那一份 | 等 `EditorPopupMenu` 骨架落地（§登记过：`PlatformActions.xml:857-878` + `LangActions.xml:30/77/84/102/597`、`JavaActions.xml:123`、`git4idea …backend.xml:545`）时把这一条一起挂进去 |

另一件不属于 IDE 但会影响"看起来没补全"的外部约束：JDT LS 的 Gradle 同步要跑真 Gradle，
AE2 这种 Forge 工程首次同步需要能访问 Maven 仓库；同步没完成前，服务器给不出该文件的语义项。
这条 IDE 只能**如实报告状态**（工具窗口的同步输出 + `lsp.request:status`），不能替它完成。

## 14. 工具窗口齿轮菜单：接住的与暂时接不住的（`ToolWindowImpl.kt:801-891`）

上游 `createPopupGroup(true)` = `GearActionGroup` + 分隔 + HideAction + 分隔 + HelpAction，
`GearActionGroup.getChildren`（`:857-891`）依次是：

| 上游 | 坐标 | TaoCode 现状 |
| ---- | ---- | ------------ |
| additionalGearActions（各窗口自己的） | `:859-868` | ✅ 项目视图的那一组已接（2026-09-29）：`ProjectViewImpl.java:1169` + `intellij.platform.projectView.xml:43-60` 的 Behavior 组（用预览标签打开 / 单击打开文件 / 始终选择打开的文件），存在项目视图设置里。其余窗口自己的组（Git 日志、TODO、书签、调试…）仍未逐窗口接 —— 需要哪个窗口的能力就先接哪个（本表保持逐条登记）。见 `docs/ui-placement-audit.md` §AA |
| SpeedSearch | `:869` | ✅ 已接（2026-09-29）：项目树装了速度搜索（Ctrl+F / 输入即选 / 上下键走 / Enter·Esc 收），齿轮第一条由宿主按"焦点处有没有可搜的列表"给行（上游 `isVisible = 有 handler`）。见 `docs/ui-placement-audit.md` §Y |
| TabbedContentAction.CloseAllAction | `:872` | ✅ 齿轮里的「关闭所有标签页」（引用 `window.closeAllTabs` = `TW.CloseAllTabs`，谓词就是 `ContentManagerImpl.canCloseAllContents()`）。内容条住在底部 dock，所以这一组 `contentsScoped` 的行只在那个 dock 的齿轮上出现 —— 侧栏齿轮拿到它会去清别人的标签（假控件的另一形态） |
| ToggleToolbarAction + ToggleContentUiTypeAction | `:874-879` | 「合并标签页」= `window.toggleContentUiType` ✅ 已进齿轮（底部 dock 那一份；`update()` 用 setEnabled ⇒ 灰着但不消失，与上面那条 setEnabledAndVisible 分开实现） |
| （底部 dock 的齿轮本身） | `ToolWindowHeader.kt:119` | ✅ 以前只有侧栏标题栏有 ⋮，底部 dock 的内容动作只能从主菜单进；现在 `.output-heading` 有同一个 `ToolWindowGear`（弹层 Teleport + fixed，因为 `.output-panel` 是 overflow:hidden） |
| `TW.ViewModeGroup`（Dock / Float / Window / Split） | `:880` | **未接**：本仓工具窗口只有停靠一种形态，浮动/独立窗口没有宿主实现 —— 放假控件是项目硬规则禁的 |
| 移动组（Move to Left/Right/Bottom） | `:882` / `:885` | ✅ 标题栏「移动到…」 |
| ResizeActionGroup | `:887` | 「调整工具窗口」四个拉伸方向 ✅ 已进齿轮（成员摊平显示，`.tool-menu` 里不再开一层浮层） |
| RemoveStripeButtonAction | `:889` | ✅ 已接（2026-09-29）：侧栏按钮可移除（持久化 `taocode.hiddenStripeButtons`），再激活即恢复（`showToolWindowImpl:942`）；齿轮最后一行由宿主给。见 `docs/ui-placement-audit.md` §Z |
| HideAction | `:810` | ✅ 标题栏「隐藏」（文案 UIBundle `tool.window.hide.action.name`） |
| HelpAction（ContextHelpAction） | `:813` | **未接**：需要每个内容的 `helpId`，本仓没有帮助映射表 |

判据：`tests/tool-window-gear.test.mjs`（引用 id 必须存在于主菜单索引；接不住的必须留在本表里）。

**同批补完（2026-09-29）**：`CloseAllAction` / `CloseOtherTabs` 的谓词原来按 **kind** 判（引用在不在、层次在不在），
现在按**条目**判（`src/toolContents.ts`）—— 见 `docs/ui-placement-audit.md` §X。同一格里挂多条内容之后，
「关闭其他」在引用那一格上收的是**同窗口的其它 content**（`ToolWindowCloseOtherTabsAction` 只看
`contentManager.contents`）；`PinToolwindowTab`（`intellij.platform.ide.impl.actions.xml:455`）与
`find.open.in.new.tab.action`（`FindBundle.properties:23`）两行进了 Window 菜单的 ActiveToolwindowGroup。

## 15. 语言服务进度：显示、取消、停机清理（2026-09-29 同日补完）

`$/progress` 的三拍（begin/report/end）现在一路到状态栏的后台任务与右下角的消息窗口
（判据在 `tests/lsp-progress.test.mjs` / `tests/progress-notices.test.mjs`）。

| 上游 | 位置 | 本仓状态 |
| :-- | :-- | :-- |
| 客户端声明 `window.workDoneProgress = true` | `LspClientCapabilities.kt:245-249` | ✅ `native/lsp_host_bootstrap.cpp` 的 initialize capabilities |
| `begin` 的 cancellable 决定这一行能不能取消 | `LspServerNotificationsHandlerImpl.kt:283` | ✅ `progressPanel.ts` 里那一行的 `cancellable` 直接跟着 `task.cancellable` 走，不常开也不常关 |
| 用户取消 → 回发 `window/workDoneProgress/cancel`（带同一个 token） | 同文件 `:286-292` | ✅ `Session::cancel_progress`（`native/lsp_session_progress.cpp`，挑目标在锁内、发送在锁外）+ 方法 `lsp.cancelProgress` |
| 服务器停机时把在跑的进度整条收掉 | 同文件 `cancelAllProgress()`（`:331-339`） | ✅ `Session::announce_progress_reset()` 在 `shutdown_all()` 里、`host->stop()` **之前**按语言各报一次 `lsp.progressReset`；界面据此收行，消息窗口写的是"语言服务已停止"而**不是**"已完成" |

**剩下的上限（如实）**：单台服务器**自己崩掉**（读线程退出、但会话没走 `shutdown_all`）时不会有人报 reset，
那条行会一直留在面板里 —— 上游是靠 `LspServerState` 的变更监听调 `cancelAllProgress()`，
本仓还没有"某台 Host 从活变死"的事件出口。要补就先补那条出口，别在界面上加超时猜测。

## 16. 工具窗口侧条：拖宽 + 「更多」按钮（2026-09-29 第三十六批）

B2 §C 里排"下一步优先级 1"的两条已落地（判决表 §G 的 `ResizeStripeManager` / `MoreSquareStripeButton`
改成 `[x]`，明细见 `docs/ui-placement-audit.md` §AN）：

| 上游 | 坐标 | 本仓 |
| :-- | :-- | :-- |
| 侧条宽度可拖（1px 分隔线，内沿） | `ResizeStripeManager.kt:79-86`（`createLayout`：左条 `width-1`、右条 `0`）、`:113-136`（`setProportion`，右侧取反）、`:138-150`（`checkMinMax` [40,100]，紧凑 33） | `src/stripeResize.ts`（夹取/方向/拖拽收尾）+ `src/components/ToolStripe.vue` 的 `.stripe-resize-handle` |
| 宽度 = 名称的开关 | `updateView:173-182`（`setOrUpdateShowName(myCustomWidth > 0)`）；2026.2 的 `Companion.enabled()` 是常量 true ⇒ `isShowNames() = UISettings.showToolWindowsNames` | 只有「显示工具窗口名称」开着才挂分隔线；宽度写回 `taocode.stripeWidths`（按边各一份，对应 UISettings 的两侧字段） |
| 开关名称 = 重置宽度 | `applyShowNames:215-228`（开 59 / 关 0，两侧） | `stripeWidthsAfterShowNames` + `toolWindowStripes.ts` 里那条 `watch`（只在**变化**时重置，启动不动用户拖过的宽度） |
| 「更多」= 没有侧条按钮的窗口 | `AbstractMoreSquareStripeButton.isAvailable:142` + `ToolWindowsGroup.java:47-77` 的跳过规则 | `moreButtonRows`（被「从侧栏移除」的可用窗口，助记符序 —— `ToolWindowsGroup.java:79-88` 的比较器在 `src/toolWindows.ts` 的 `sortedByMnemonicThenId`） |
| 「更多」停在 `getMoreButtonSide()` 那一侧 | `MoreSquareStripeButton.isAvailable:78-80`；状态在 `ToolWindowManagerState.moreButton`（默认 LEFT，只在非 LEFT 时写存档 `:86-87`） | `moreButtonSide` + `moreButtonVisible(side)`，存档键 `taocode.moreButtonSide` |
| 左键弹层 / 右键「移至对侧」/ 侧条空白处右键「显示工具窗口名称」 | `ShowMoreToolWindowsAction:100-123`（`minPopupWidth = 300`）、`createPopupGroup:49-61`、`ResizeStripeManager.kt:49-61` | `ToolStripe.vue` 的两个弹层 + 名称开关（文案取自随 IDE 发货的中文语言包） |

**同批的结构动作**：App.vue 顶在机检上限（2737 行），侧条这一域整体搬进
`src/components/ToolStripe.vue`（左右两条侧条本来就是同一份结构 —— IDEA 也只是
`ToolWindowLeftToolbar`/`RightToolbar` 两个薄子类）。判决表里 `ToolWindowToolbar` /
`ToolWindowLeftToolbar` / `ToolWindowRightToolbar` 三行原先按"窗口内工具栏"误判成 `[ ]`，
随本轮改成 `[~]`（缺的是 `topStripe`+`bottomStripe` 的双条纹/split 组那一半）。

**仍差**：`ToolWindowButtonManager` / `ToolWindowPaneNewButtonManager` / `ToolWindowPaneOldButtonManager`
（按钮管理器与工厂层）、`StripeActionGroup`（`TopStripeActionGroup`，顶部条纹的动作组 —— 本仓无顶部条纹）。
刻意偏差六条登记在 `docs/source-todo.md` §9。

## 17. 各窗口自己的 `additionalGearActions`：第二个落点（2026-09-29 第三十七批）

§14 的头一行记的是"项目视图的那一组已接（§AA），其余窗口自己的组（Git 日志、TODO、书签、调试…）仍未逐窗口接"。
这一批接**用法视图（引用 / IDEA 的 Find 窗口）**：`UsageViewContentManagerImpl.java:114-116` 的
「视图选项」组 —— 两条已接（按字母顺序排列成员 / 在新标签页中打开结果，见
`docs/ui-placement-audit.md` §AO），第三条「一键导航」（`UIBundle.properties:23`
"Navigate with Single Click"）**不接**（要结果列表的选择模型，登记在 `docs/source-todo.md` §10）。

本仓"窗口自己的齿轮项"的两条落点已经清楚，后续窗口照这个走：
- 项目视图 → 在它自己的树头部渲染（`ToolWindowView.vue` 的 `view-gear-menu`）；
- 底部 dock 的内容 → 宿主行（`src/usageViewGear.ts` 那种），经 `src/menus/toolWindowGear.ts` 的
  `{ fromHost: true, contentsScoped: true }` 进齿轮，位置在最前（`ToolWindowImpl.kt:859-868`）。

`vcslog`（Git 日志）**第三十八批已接**：它的那一组不在 `additionalGearActions` 而在**工具条右角**的
`Vcs.Log.PresentationSettings` 齿轮 —— 接住 `标签名称` 与 `列`，其余六条逐条登记（见
`docs/ui-placement-audit.md` §AP、`docs/source-todo.md` §11）。

**还没接的窗口**（上游各自的 `setAdditionalGearActions`，按"有没有真宿主"逐个判）：
`git`（提交窗口：`vcsToolWindowFactories.kt:34` → `LocalChangesView.GearActions`
= 「双击时显示」差异/源两条，`ShowOnDoubleClickToggleAction.kt:16-58` —— 「差异」要"diff 开进编辑器标签"这个形态，
本仓 `DiffView` 只活在面板里（提交面板/历史/日志/剪贴板对比），编辑器标签是 `DocumentData` 绑死的 ⇒
**要么先做 diff 标签，要么只接「源」那一条**，别做成两个都点了没反应的单选）、
`terminal`（`TerminalToolWindowTabsManagerImpl.kt:300` 的标签动作）、`debug`/`services`
（`ServiceViewSourceScrollHelper.java:41-47`）、`problems`（`InspectionResultsView.java:274-277`）、
`maven`（`MavenProjectsNavigator.kt:306`，本仓无 Maven）。

## 18. 工具窗口注册表落地（2026-09-29 第三十九批）

判决表 §C 第 8 条（`RegisterToolWindowTask` / `ToolWindowFactory` / `ToolWindowEP` / `ToolWindowAllowlistEP`）
可做的那一半已落：`src/toolWindowMeta.ts` 的 `TOOL_WINDOW_REGISTRY` —— 一个工具窗口 = 一条记录
（id / 条纹标题 / 图标 / 锚点 / 助记符 / `shouldBeAvailable`），标题/图标/锚点/次序/助记符四张表全部由它派生，
可用性从 `toolWindowStripes.ts` 里那三条 `if (id === …)` 搬进记录。

`ToolWindowEP` / `ToolWindowAllowlistEP`（插件声明 + 白名单）判 `[-]`：本仓没有插件运行时。
`createToolWindowContent`（内容挂载点）仍是 `ToolWindowView.vue` 的模板链 —— 登记在
`docs/source-todo.md` §12（要它数据化得先给 13 个视图一个统一的 `content(ctx)` 契约）。

明细与两条"差点踩坏"的记录（数组顺序 = Alt+数字的编号，不能按锚点重排）见
`docs/ui-placement-audit.md` §AQ；判据 `tests/tool-window-registry.test.mjs`。

**对后续批次的意义**：加一个工具窗口从"改 id 联合 + 四张表 + 一个可用性函数"降到"加一条记录 + 一个内容挂载点"。

## 19. 布局档案与项目级布局（2026-09-29 第四十批）

判决表 §C 第 10 条那一族已落地（明细见 `docs/ui-placement-audit.md` §AR）：

- `src/toolLayoutProfiles.ts`：档案（出厂默认 + 每窗口覆盖）+ `SEED_ONLY` / `FORCE_ONCE` 两条应用模式
  + 上游那条**应用级**迁移标记（`toolwindow.layout.profile.migration.<profileId>` 的等价键）。
- 布局改成**项目级**（`taocode.toolLayout:<root>`：anchors + order + hidden），旧的三键一次性迁进
  第一个打开的项目；此后新项目按档案播种。**这条改动对后续批次有两层意义**：
  ① 用户的布局从此跟着项目走（与 IDEA 一致）；② 档案机制就位，将来"某框架一套默认布局"只是加一条记录。

还差：档案里 `weight`/`split`/`sideWeight`/按窗口 `contentUiType` 这些字段要有落点，先得有每窗口状态
对象（§C 第 9 条，现标"最有价值的下一条"）；理由是这些字段在 IDEA 里属于 `WindowInfoImpl`，
而本仓把三张表平铺在一份项目布局记录里。

## 20. 主工具栏键盘焦点（2026-09-29 第四十一批）

`FocusMainToolbarAction` 判 `[x]`、`MainToolbarFocusSupport` 判 `[~]`（明细见 §AS）：
`src/mainToolbarFocus.ts`（聚焦第一个条目 / 守卫"已在工具栏里就不动" / Esc 回焦点 / ←→ 遍历）
+ `MainToolbar.vue` 根上的键盘处理 + 动作索引里的 `window.focusMainToolbar`（无键位，与 `FocusStatusBar` 同一处）。
同批抽出 `src/editorFocus.ts`（"回可见的那个编辑器"）并修掉状态栏那条同款写法里的无声失败。

**同批把 §C 里没有宿主的 12 条判成 `[-]`**（附理由），四档计数 → `12 + 77 + 65 + 196 = 350`：
`ToolWindowManager`、`ToolWindowManagerListener`、`StatusBarListener`、`WindowManager`、`WindowManagerListener`、
`ToolWindowHorizontalToolbar`、`ToolWindowStripeExtension`、`InspectionProfileWidgetFactory`、
`TogglePopupHintsPanel`、`LibraryDependentToolWindow`、`LibrarySearchHelper`、`OpenProjectSelectionPredicateSupplier`。
剩下的 `[ ]` 每一条都真有行为、都还没有。

## 21. 每窗口状态对象第一刀（2026-09-29 第四十二批）

§C 第 9 条落地一半：项目的布局记录改成**每窗口一条记录**（上游 `WindowInfoImpl` 的形状：
`anchor`/`order`/`showStripeButton`/`contentUiType` + 上游默认值），`contentUiType` 因此从"一个全局键"
变成**每个内容一份**（点「合并标签页」只影响当前那个内容，且跟着项目走）。明细见
`docs/ui-placement-audit.md` §AT，还差的字段（`isVisible` / `weight` / `sideWeight` / `isSplit`）
登记在 `docs/source-todo.md` §15。

**对后续批次的意义**：布局记录从此是"每窗口一条"的，往里面加字段（下一个最可能是 `isVisible`）
不用再动记录的形状 —— 那是这一批的主要收益。

## 22. 每窗口可见性（2026-09-29 第四十三批）

`WindowInfo.isVisible`（上游默认 false）落地：展开/收起跟着**项目**存，打开项目时按存档把上次那些
窗口放回（侧栏与底部各自）。明细见 `docs/ui-placement-audit.md` §AU；
`WindowInfoImpl` 那一族现在只剩 `weight`/`sideWeight`/`isSplit`（本仓的每窗口尺寸在
`panelResize.ts` 那条路上）与 `ToolWindowPaneState`/`ToolWindowEntry` 两个运行期对象（登记在
`docs/source-todo.md` §15）。

**接线约束（写给下一位）**：可见性的写入点 watch 会读宿主的 dock 状态，而 watch 建时求值一次 ⇒
被读的 ref 必须声明在 `createToolWindowStripes` 之前（`bottomTab` 已为此上移）。

## 23. 提交检查域（2026-09-30 第五十/五十一批）

B3 判决（`docs/inventory/verdict-vcs-commit.md`，78 类）里 §E 的 ①③ 落地：检查**一处来源**
（`src/commitChecks.ts`）、「只运行检查」（上游入口 = **失败行**上那把刷新按钮，不是常显按钮）、
「仍然提交」（失败后提交按钮改名、按下去跳过检查）、提交期间保存的否决。
明细见 `docs/ui-placement-audit.md` §AV/§AW。仍是 `[~]` 的：失败行的详情链接动作、面板内进度指示、
索引期间那条警告（登记在 `docs/source-todo.md` §16）。

**教训（写给下一位）**：这一批先是"看起来很合理"地把 `RunCommitChecksExecutor` 做成了一个**常显按钮**，
真机截图才发现上游没有这种东西（非模态面板里执行器挂在提交按钮的下拉上，而那个组是空的），
而且它把提交按钮那一排挤成了竖排文字。判决表里 `[~]` 的行**不要凭直觉补形状**：
先按上游源码找到「入口在哪个组件、什么条件下可见」，再动手。

## 24. 提交面板的文案与动作排布（2026-09-30 第五十二批）

从"真机抓到一处编造"变成"系统化核一遍"：面板里所有用户看得见的中文文案 × 随 IDE 发货的中文包
（1419 个 bundle / 95030 条含中文取值）逐个比对，命中的都改了 —— amend 的文案与浮层（`checkbox.amend`
= 修正(M)）、amend 与消息历史的位置（`ChangesView.CommitToolbar`，与图例同一行）、消息区不带工具条
（`CommitMessage(showToolbar=false)`）、占位文本（`commit.message.placeholder` = 提交消息）；
**删掉两件上游没有的东西**：「回滚提交信息」按钮 + 自造占位「默认信息」。顺带补上"一开 amend
就预填上次提交的信息"（`src/amendMessage.ts`）。明细见 `docs/ui-placement-audit.md` §AX，
判据 `tests/scm-panel-strings.test.mjs` + `tests/amend-message.test.mjs`。

**还没判的**（`.sc-toolbar` 那一行、折叠按钮、分支/标签/比较三行、reformat 的 Alt+L 键位、
失败行的详情链接）逐条登记在 `docs/source-todo.md` §17 —— **先找到上游的组件与行号再动**。

**方法（写给下一位）**：只要面板里出现一句中文，问三个问题 —— ①上游有没有这句话（在哪个 bundle、
key 是什么）？②如果没有，它是不是本仓措辞（那就在清单里写明"本仓"两字）？③控件本身呢
（哪个组件、哪一行、什么条件下可见）？这三问答不上来的，就是下一个 §AX。

## 25. B4 起域：`codeInsight/folding`（2026-09-30 第五十九批）

按 `docs/inventory/_domains.json` 挑了一个规模可控的包：69 类（清单 `docs/inventory/folding.txt`），
判决 `docs/inventory/verdict-folding.md`，门控 `tests/b4-verdict.test.mjs`。
四档：`[x]` 0 / `[~]` 10 / `[ ]` 33 / `[-]` 26 = 69。**下一批做 §C 那四条**（动作族 + 键位表 /
`CodeFoldingSettings` 五个开关 / 折叠状态持久化 /「全部收起」文案与弹层顺序）。
上游键位表（`$default.xml` 逐条核过）也抄在判决 §A 里 —— 接动作时直接查那张表，别再凭手感。

### 25.1 动作族已接（2026-09-30 第六十批）

§C① 与 §C④ 做完：15 条命令在 `src/editorCommands.ts`，实现与纯逻辑在 **`src/editorFolding.ts`**（新模块），
键位进 `CodeEditor.vue` 的**常驻** keymap，Code 菜单多了 `code.folding` 子菜单（13 条，照 `FoldingGroup` 顺序与
`ActionsBundle` 文案），编辑菜单里那四条删掉（上游不在那儿）。挑目标的规则逐条照上游（收起/展开/递归/到级别/
切换/选区，含"展开取最外层"这种反直觉的一条）—— 对照表与三处真机返工写在 `docs/ui-placement-audit.md` §BF。
判决四档随之变为 `[x]` 0 / `[~]` 31 / `[ ]` 12 / `[-]` 26 = 69。

**下一批做 §C 剩下的**：③ 折叠状态持久化（`EditorFoldingInfo` + necromancy；本仓没有 PSI 元素身份，
只能按偏移恢复）、⑤ 文档变更后区间重算与"折过的区间边界对不上"这两条自认的缺口。

### 25.3 §C③⑤ 已做（2026-09-30 第六十二批）

折叠状态的存/取与重算：`src/editorFoldingState.ts`（轻签名 + 存档 + 恢复计划 + 失效判定）+
`src/editorFoldingController.ts`（管道：存 → 装区间 → 记候选 → 按默认折 → 清失效 → 恢复，串行）。
四档：`[x]` 0 / `[~]` 38 / `[ ]` 5 / `[-]` 26 = 69。### 25.4 收尾两条（2026-09-30 第六十三批）

`caretInsideRange` 接进了默认折叠（`foldKinds` 折的时候跳过含光标的那几条）；「全部收起/展开」的两段式
**经分析在本仓退化成一段**（`keepExpandedOnFirstCollapseAll` 是语言侧钩子、LSP builder 没覆盖 ⇒ 第一步就
等于折全部展开着的），所以不写死代码、改判在判决 §G 里写清依据（审计 §BI）。
### 25.5 落盘也做了（2026-09-30 第六十四批）—— B4 收口

折叠状态写进**项目级设置**（`ProjectSettings.foldingState`），前端去抖写、打开工作区读回；
原生新增 `native/folding_state_schema.cpp`（形状 + 上限：50 文件 × 40 条、签名 ≤96 字节，
因为整份应用状态有 1 MiB 硬上限），前端再按"最近动过的"裁到 20×30。
真机取证：折两块 → 关标签 → **杀进程重启** → 打开同一文件，两处折叠都回来（审计 §BJ）。
### 25.6 B4 收口（2026-09-30 第六十五批）—— `[ ]` 归零

最后 5 条逐条判掉：`FoldingPolicy`/`FoldingUtil` 逐函数/逐职责有落点 ⇒ `[~]`；
`CollapseBlockHandler`（语言侧 EP 接口）、`CodeFoldingZombie`（注册表后的模型磁盘缓存）、
`FoldingHintMouseMotionListener`（要装订线折叠轮廓区，CodeMirror 装订线只在起始行画标记）⇒ `[-]`。
四档：`[x]` 0 / `[~]` 40 / `[ ]` 0 / `[-]` 29 = 69。**B4 没有未决项**，`[~]` 全是引擎差异（替身写在判决 §G 每行里）。

### 25.2 §C② 已做（2026-09-30 第六十一批）

「代码折叠」设置页 + 两条真开关（Import 默认开、自定义折叠区域默认关）：
`src/editorFoldingSettings.ts` + `src/components/CodeFoldingSettingsPage.vue`，值进 `EditorSettings`，
原生键表/默认值同步（`native/settings_schema.hpp`/`.cpp`），打开文件按 `kind` 预折叠、改了一键重算。
另三条（文件头/方法体/文档注释）上游只有语言侧 builder 读、上游自己的 LSP 路径也传 null ⇒ 不渲染，
判决 §G 里写着。四档：`[x]` 0 / `[~]` 33 / `[ ]` 10 / `[-]` 26 = 69。

## 26. B5 起域：`ide/bookmarks`（2026-09-30 第六十六批）

`projectviews` 域里最小的一组：5 类，判决 `docs/inventory/verdict-bookmarks.md`，清单
`docs/inventory/bookmarks.txt`，门控 `tests/b5-verdict.test.mjs`。四档：`[x]` 0 / `[~]` 5 / `[ ]` 0 / `[-]` 0 = 5
—— 五条都 `[~]`，缺口逐条写在 §G（编辑后重锚、描述与书签类型、列表项富渲染……）。
**下一批做 §C 三条**，第一条（编辑后按行文本重锚 + 自动描述）是最实的：
上游 `BookmarkManager` 记下"变化前那一行的原文"（`:439-444`）并在文档变化后按文本找回（`:449-495`），
本仓的 `Bookmark{path,line}` 只有行号。

### 26.1 B5 的域还剩哪些组（供后续排期）

`projectviews` 域共 11 组（按扫描件重算的规模）：`ide/bookmarks` 5（✅ 本轮）、
`platform/welcomeScreen` 1、`platform/lvcs/impl` 35、`platform/ide/nonModalWelcomeScreen` 38、
`notification` 67、`openapi/command/impl` 76、`ide/todo` 80、`ide/structureView` 93、
`openapi/wm/impl/welcomeScreen` 93、`ide/projectView` 158、`history` 94。
其余域的大组：`editor` 域 `openapi/editor` 928 与 `codeInsight/daemon` 629（最大两块）、
`vcs/openapi/vcs` 1122、`settings-run/execution` 1561、`ui` 域 `com/intellij/ui` 1136、`actions` 域 302。

### 26.2 §C① 已做（2026-09-30 第六十七批）

书签的行文本锚与编辑后对账：`src/bookmarks.ts` 的 `reconcileBookmarks`（越界丢弃 + 原文回来放回 +
单行上移 `line - 2` + 同一行只留一条）与 `Bookmark.text`；接线在 `src/bookmarkActions.ts`
（会话内的"丢掉表" + 模块级内容变更钩子）与 `src/lspNavigation.ts` 的 `onEditorChange`。
真机取证（临时探针记录 reconcile 的输入输出，取证后已撤）：删整行 ⇒ `before 1 → after 0`、丢掉表 `0 → 1`；
撤销后的下一次变更 ⇒ `before 1 → after 2`、丢掉表 `1 → 0`（顺带暴露的"同一行两条"已按上游 `isDuplicate` 修掉）。
**剩**：书签描述（`Bookmark` 行）、书签类型与文件书签、列表项富渲染；
**待查**：项目树/SCM 列表偶发零行（挡了面板级复验，见审计 §BM 与 checklist）。
