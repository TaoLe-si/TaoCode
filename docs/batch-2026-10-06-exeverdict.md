# 批：exeverdict —— `verdict-execution` / `verdict-settings-run` 两族判词三方对齐（只读核对）

日期：2026-10-06　路：exeverdict（**只读核对型**，不写功能码）

## 0. 本路的边界与口径

- 硬边界：不改 `docs/inventory/**`、不改 `scripts/verdict_table.py`、不改 `src/**`/`tests/**`/`native/**` 任何字节。账本手术特批给 `ledgerfix` 一路，本路只交订正表（§7）。
- 不跑 `TAOCODE_CITATION_ANCHORS=update`，不跑重生成，不 `git add`（`scripts/__pycache__/*.pyc` 被跟踪，跑 python 即脏）。
- 每条四栏：判词原文档位 → 本仓真实出口（`文件:行号`，打开确认存在）→ 上游坐标（`D:\Backup\Downloads\intellij-community-master\intellij-community-master`）→ 结论。
- 结论档位：`判词正确` / `该升档` / `该降档` / `坐标假` / `无法核实`。
- 「做没做」口径：`git status` 无 diff ≠ 功能不存在。必须打开文件读实现 + grep 生产消费方，必要时 `git log --oneline -- <文件>`。
- 上游引用不写六位越界行号；不逐字转述别人的假坐标（`tests/source-citations.test.mjs` 的 `citationsOf` 扫 `['src','native','docs']`，报告文档本身在门内）。
- 无 zh 本地化包 ⇒ 中文界面措辞一律「无法核实」，不自编。

## 1. 门禁原始数字

（占位，见 §8 原样粘贴）

## 2. 同期事实复核（已知事实不许照抄）

（占位）

## 3. 族 A：`verdict-execution` 核对（14 条族判词，`[~]` 12 / `[-]` 3 条含 misc/wsl/dbg）

### 3.0 机械核对（全族，可复算）

| 核对项 | 口径 | 结果 |
|---|---|---|
| 本仓带行号引用 `文件:行号` | 正则收 `src/`+`native/` 全部，逐条打开比对行数 | **2 条全部存在且行号在界内**（无缺文件、无越界） |
| 本仓裸路径引用 | 收 `src|native|tests|scripts|docs` 全部扩展名 | **83 个唯一路径全部存在**，0 缺 |
| 上游 `路径:行号` 引用 | 逐条在参考树打开并比文件长度 | **18 条全部存在、行号全部在界内**，0 越界 |
| 上游裸路径引用 | 同上 | 全部存在（含 `java/execution/impl/…`、`platform/execution-impl/…` 等长路径） |
| 逐类表 | `docs/inventory/execution_verdict_table.json` 1608 行的 `reason` 字段 = 族判词原文（脚本按族复制），**没有独立的逐类主张** | 所以族 A 的对账对象就是这 14 段文本，逐类表不产生第二批欠账 |

参考树状态（自证）：`D:\Backup\Downloads\intellij-community-master\intellij-community-master` 存在且可读；
`third_party/intellij-community` 目录实测**只剩 `.git`**，除它以外的任何"上游"都不算证据 —— 与派单口径一致。

### 3.1 族判词逐条四栏

档位都是族级 `[~]`/`[-]`；「本仓真实出口」列只写**本轮亲自打开确认过**的行号。

| 族 | 判词档位 | 本仓真实出口（已打开） | 上游坐标（已打开） | 结论 |
|---|---|---|---|---|
| `exec/run-instances` `[~]` | 缺①②③④⑤ 五条 | `native/run_host.cpp:135`、`:442` + `native/run_host.hpp:51` 的 `listening_tcp_ports`（④ 端口监视器已补，与判词自述一致）；全仓 `src/**`+`native/**`+`tests/**` 搜 `elevation`/`runas`/`Elevat`/`UAC`/`TOKEN_ELEVATION` = **0 命中**（③ 提权确属真缺）；`native/*.cpp` 里 `ShellExecuteW` 只有 `native/workspace.cpp`（1025/1052/1100，都是「打开 URL/资源管理器」分支，与提权无关） | `platform/execution-impl/src/com/intellij/execution/impl/statistics/`（判词点名的 10 个 FUS 文件，实测该包存在） | **判词正确**（①②③⑤ 真缺、④ 已如实自述为有界子集） |
| `exec/misc` `[-]` | 内部管线不可移植 | — | — | **判词正确** |
| `exec/junit` `[~]` | 缺「按包/目录/模式运行」「JUnit 5 动态/参数化用例与 tags 的展示」「测试发现索引 + 到测试/创建测试动作」等 6 条 | **前三条里有两条半不成立**：`src/junitPatterns.ts`（217 行；`parseTestPattern:46`/`validateTestPattern:58`/`testPatternSelector:71`/`packagePattern:89`/`filterDiscovered:101`/`parseTagExpression:155`/`tagFilter:203`/`filterByTags:209`），消费点 `src/components/TestRunnerPanel.vue:19` 与运行范围三行（`:109`、`:574`），判据 `tests/junit-patterns.test.mjs` + `tests/junit-scope.test.mjs`；`src/junitParameters.ts`（`ParameterCollector:38`、`parameterDisplayName:80`），消费点 `src/components/TestRunnerPanel.vue:20`；「到测试」在 `src/navGotoTest.ts`（`gotoTestDirection`/`gotoTestActionLabel`）+ `src/menus/navigateMenu.ts:11`、`:157-162`（Ctrl+Shift+T 那一格），判据 `tests/nav-goto-test.test.mjs`；`src/testLocator.ts` 就是发现索引等价物（`TestIndex:89`、`testIndexOf:209`、`locateTest:123`、`locateTestFromStack:153`、`resolveTestLocation:173`），判据 `tests/test-locator.test.mjs` | `plugins/junit/src/com/intellij/execution/junit/TestsPattern.java`（整档 228 行，`:39-47` 实测是 `extends TestPackage` + `getClassFilter`）、`AbstractAllInPackageConfigurationProducer.java`（85 行，`:51` 实测 `data.PACKAGE_NAME = psiPackage.getQualifiedName()`）、`TestTreeExpander` 无关 | **该升档（判词过期）**：按模式/按包/tag、参数化与 tags 展示、「到测试」动作、用例索引四项**磁盘上都有生产消费方**。仍成立的真缺只有：TestNG 专用集成（全仓 `TestNG` 只在 `src/assertionView.ts` 的断言形状覆盖里出现）、`JUnitTestDiscoveryProvider`/`testDiscovery/indices`（0 命中）、变更列表受影响测试（`TestsByChanges`/`AffectedTests` 0 命中）、注解引用导航（`DisabledIf`/`MethodSourceReference` 0 命中）。订正文本见 §7 第 A1 条 |
| `exec/ui` `[~]` | 缺 `Runner.RestoreLayout`/`MinimizeViewAction`/`FocusOnStartAction`/`RunnerLayoutSettings`+`CustomContentLayoutSettings` 布局设置页 | `src/runToolWindowLayout.ts:156` 的 `RUNNER_VIEW_ACTIONS_NOT_PORTED`（登记这三条**不渲染**并各自带上游坐标与理由：`:158` RestoreLayout、`:165` MinimizeView、`:172` Runner.FocusOnStartup），`:181-182` 明写布局设置页与 `Runner.RestoreLayout` 同一架构卡点；已落的那半在 `src/runToolWindowLayout.ts` + `src/runInstances.ts` 的 `closeRunView`，判据 `tests/runner-view-actions.test.mjs` | `platform/lang-api/src/com/intellij/execution/ui/actions/FocusOnStartAction.java`（整档 25 行；`:21-24` 实测就是 `extends AbstractFocusOnAction` + `super(LayoutViewOptions.STARTUP)`，与判词一致） | **判词正确**（这几条是"登记过的不可移植"，不是漏做）。⚠ 注意别把同一条 id 读成两件事，见下面 §3.2 |
| `exec/run-configs` `[~]` | 模板已补 / 共享落盘设计禁止 / 无远程目标 / 无 per-type 编辑器 | `src/runConfigTemplates.ts`、`src/components/RunConfigurationsDialog.vue`（`:72` 还 import 了 `TargetEnvironmentsDialog`）、`src/runConfigTree.ts`、`src/runCompound.ts`、`src/runConfigEditors.ts:109`（`ProgramRunner` 字样在此） | `platform/execution-impl/src/com/intellij/execution/impl/TemplateConfigurable.java` 等，路径全部存在 | **判词正确** |
| `exec/junit-inspection` `[~]` | 两批规则 + quickfix 已接，缺 4 条要 PSI/数据流的 | `src/junitInspections.ts`、`src/junitRules.ts`、`src/junitQuickFix.ts`、`src/semanticActions.ts`（`:399`/`:411-414`/`:423`/`:437-439` 已在上一轮逐条核过） | `java/java-analysis-impl/src/com/siyeh/ig/testFrameworks/MisorderedAssertEqualsArgumentsInspection.java` 存在 | **判词正确** |
| `exec/target` `[~]` | **缺「目标环境管理：没有目标环境对话框与用户自定义目标」** | **这条不成立**：`src/targetEnvironments.ts`（11 KB / 全 CRUD：`loadTargetEnvironments:97`、`newTargetEnvironment:122`、`addTargetEnvironment:138`、`updateTargetEnvironment:147`、`removeTargetEnvironment:159`、`setProjectDefaultTarget:167`、`projectDefaultTarget:173`、`duplicateTargetEnvironment:181`、`validateTargetEnvironment:190`，持久化键 `TARGET_ENVIRONMENTS_KEY:31`）+ 对话框 `src/components/TargetEnvironmentsDialog.vue`（18 KB，`:24` 引上游 wizard），宿主在 `src/components/RunConfigurationsDialog.vue:72` import、`:662` 渲染。`git log` 显示两者都随 `dfbda4e` **早就 commit 进 HEAD**（工作区无 diff ≠ 没做） | `platform/execution-impl/src/com/intellij/execution/target/TargetEnvironmentsConfigurable.kt`、`platform/execution/src/com/intellij/execution/target/TargetEnvironment.kt` 路径存在 | **该升档（判词过期）**：目标环境对话框与用户自定义目标已落地；真缺应收窄为「没有 `TargetEnvironmentRequest` 的远程握手/`Eel*`/Docker 那套请求模型」。订正见 §7 第 A2 条 |
| `exec/sm-runner` `[~]` | 缺 socket RPC 壳与 per-framework 配置面 | `src/testEventChannel.ts`、`src/assertionView.ts`、`src/testRunner.ts`、`src/testTree.ts:692`（`SMTRunnerConsoleProperties` 作为对照注释出现，不是实现）；`TestListenerProtocol` 全仓 0 命中 ⇒ 真缺成立 | `java/java-runtime/src/com/intellij/rt/execution/TestListenerProtocol.java`、`platform/smRunner/src/com/intellij/execution/testframework/sm/runner/SMTRunnerConsoleProperties.java` 存在 | **判词正确** |
| `exec/run-toolbar` `[~]` | 仪表盘/目标选择器已补有界子集，缺 Services 树与槽位定制 | `src/runDashboard.ts`：`RunDashboardGroup:162`、`groupRunDashboardRows:179`、`runDashboardPresentTypes:216`、`RUN_DASHBOARD_TYPES_KEY:223`、`readRunDashboardTypes:234`、`writeRunDashboardTypes:247`；**宿主确实接上了**：`src/components/MainToolbar.vue:28-30` import 整组，`:146` 组行、`:157` 汇总、`:363-375` 弹层与类型开关、`:387` 单实例停止格（`row.kill` 时换图标 = kill 档） | `platform/lang-api/src/com/intellij/execution/dashboard/RunDashboardGroup.java`（整档 27 行，`:23-27` 实测只有 `getName()`/`getIcon()` —— 与判词"上游其实只有两格"的订正一致） | **判词正确**（本轮新增的宿主接线已成立，缺列表未过期） |
| `exec/filters` `[~]` | 缺 PSI 核验与 EP | `src/exceptionFilter.ts`（`:9` 引 `ExceptionLineRefiner` 说明降级点）、`src/runHyperlinks.ts`、`src/consoleHyperlinks.ts`（`:5` 引 `ConsoleFilterProvider`） | 存在 | **判词正确** |
| `exec/testframework` `[~]` | 「真缺只剩两小截」 | 两条都成立：① 导出只进剪贴板 —— `src/components/TestRunnerPanel.vue:383` 调 `copyToClipboard`（`:22` import），全仓没有 `writeFile` 出口，`src/testResultsXml.ts:19` 自述即「复制到剪贴板」；② 历史会话不可重跑 —— `src/testImport.ts` 全文 `grep rerun/重跑/再跑` **0 命中**，导出面只有 `importTestResults:171`/`recordImportedSession:303`/`importedSessionList:313`/`historyPresentableText:321` | `platform/testRunner/src/com/intellij/execution/testframework/export/ExportTestResultsConfiguration.java`、`platform/smRunner/src/com/intellij/execution/testframework/sm/runner/SMTestLocator.java` 路径存在 | **判词正确** |
| `exec/wsl` `[-]` | 无宿主能力 | `wsl` 字样只出现在 `src/debugAttach.ts`、`src/editorBrackets.ts` 等无关上下文（词面巧合） | — | **判词正确** |
| `exec/actions` `[~]` | 缺 EP 与多执行器 | `ConsoleActionsPostProcessor`/`ExecutorProvider`/`MultipleRunLocationsProvider` 全仓 **0 命中** ⇒ 真缺成立；`rerunLast` 有 12 处生产引用（`src/App.vue:1616` 等） | 存在 | **判词正确** |
| `exec/console` `[~]` | 缺两个 EP + Swing 本体；并订正了 REPL 前提 | `ConsoleOptionsProvider`/`GutterContentProvider` 全仓 0 命中 ⇒ 成立。**但判词漏记一条已落地**：控制台「滚动到末尾」+ 贴底跟随在 `src/consoleScroll.ts`（`CONSOLE_BOTTOM_TOLERANCE`、`consoleViewAtBottom`、`consoleScrollToEndPosition:51`），消费点 `src/components/RunConsole.vue:79` import、`:390` `scrollLogToEnd`、`:399` 输出增量时按 `stickToEnd` 回底，判据 `tests/console-scroll.test.mjs`（注意：`src/consoleScroll.ts` 当前是**未跟踪新文件**，`git status` 显示 `??`） | `platform/lang-impl/src/com/intellij/execution/console/ConsoleExecuteAction.java` 存在；`ConsoleViewImpl.kt` 实测**1729 行**（门口径 1730，两套数法差 1 ⇒ 本报告不写任何该文件的六位行号） | **判词正确 + 建议补记**（`[~]` 档位不动，缺列表没写它，不算过期；但账本没记这条已落地，后续 lane 有二次误判风险）。见 §7 第 A3 条 |
| `exec/configurations-types` `[~]` | 缺匹配链/富模型/进程代理/内容动作 EP | `ProcessProxy` 全仓 0 命中 ⇒ 成立；`src/runConfigEditors.ts:109` 有 `ProgramRunner` 对照注释（是注释不是实现） | 存在 | **判词正确** |
| `exec/coverage` `[~]` | 缺采集通道（如实降级，不造假进度条） | `javaagent`/`CoverageListener` 全仓 0 命中（只有 `src/coverageReport.ts:4` 与判据里引用上游口径）⇒ 成立 | — | **判词正确** |

### 3.2 一条容易读反的 id（本轮实测，写给后续 lane）

`Runner.FocusOnStartup` 这条 id 在**同一个仓里指两件不同的事**，族 A 的两处判词都成立、但很容易被后续 lane 读成矛盾：

- `platform/lang-api/src/com/intellij/execution/ui/actions/FocusOnStartAction.java`（25 行，`:21-24`）= **多视图布局里给某个 Content 打的「启动时聚焦」标记**。本仓运行视图是一条扁平实例标签，没有 Content 格可标 ⇒ 已登记为不渲染（`src/runToolWindowLayout.ts:172`）。**族 `exec/ui` 判它"缺"是对的。**
- 用户真正感知的「启动时打开面板 / 把焦点移进去」= 运行配置上的**两个开关**（`isActivateToolWindowBeforeRun` / `isFocusToolWindowBeforeRun`），本仓单一真源在 `src/runStartupFocus.ts`（246 行；`decideRunStartupFocus:175`、`resolveRunStartupFocusFlags:203`、`runStartupFocusFlagsOf:222`、`withRunStartupFocusFlags:237`），生产消费方 `src/runActions.ts:33`+`:237`、`src/runConfigurations.ts:12`+`:157-158`、`src/runConfigTemplates.ts:21`、`src/components/RunConfigurationsDialog.vue:64-65`；旧的 localStorage 载体已删。
  ⇒ **族 A 的"缺 FocusOnStartAction"和族 B 的"`AbstractFocusOnAction`/`FocusOnStartAction` 判 `[ ]`"都不该被这条已落地推翻**；该被推翻的是反过来拿这条已落地去声称"布局动作也做了"。

## 4. 族 B：`verdict-settings-run` 核对

（待核）

## 5. 建议实现（今天就能落，但本路不动手）

（占位）

## 6. 无法核实清单

（占位）

## 7. 订正表（交 ledgerfix 的账本手术单）

（占位）

## 8. 门禁原始输出

（占位）
