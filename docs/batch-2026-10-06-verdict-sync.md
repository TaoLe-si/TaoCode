# 批次：verdict-sync —— 族级判决产物对回真源（2026-10-06）

范围：`docs/inventory/verdict-execution-debug.md` / `verdict-execution.md` / `verdict-xdebugger.md`
与两份 `*_verdict_table.json` 的族判词、`scripts/verdict_table.py` 的 `FAMILIES`、新门
`tests/verdict-table-check.test.mjs`。开工时 HEAD = `200232e`（会话期间别的 lane 提交过一次，
`11a736e → 200232e`，共享工作树，我没提交任何东西）。

## 0. 结论

1. `--check` 报的那 1 条不一致是真的，但**方向与请求里写的相反**：不是「盘上比 `FAMILIES` 长」，
   而是 **`FAMILIES` 比盘上长 —— 盘上那份是旧生成物**（6 行差异行全部是「生成物更长」）。
   ⇒ 盘上没有任何一条独有的本仓落点可并回（逐行取引用清单比对：`only-disk refs = []`，6 行都是 0）。
2. 逐条打开核对之后，**真源侧反而有 8 处假 `文件:行号` 和 5 族的过期判词**（判词比代码旧）。
   直接把产物「按真源重生成」会把假坐标与过期判词原样印到磁盘上，所以先订正 `FAMILIES` 再重生成。
3. 门已接进 node 回归：`tests/verdict-table-check.test.mjs`，4 条判据、**两组反向验证都真红过**，
   其中第 1 条不依赖 python（本次 HEAD 级漂移就是被它单独抓住的）。
4. `python scripts/verdict_table.py --check` ⇒ **一致 7 / 7**；`node --test` 五份 verdict 门 ⇒ **38/38 绿**。

## 1. 前提核对（原始数字）

`python scripts/verdict_table.py --check`（改之前）：

```
  不一致 docs/inventory/verdict-execution-debug.md（生成 38184 字节 / 磁盘 33690 字节）
不一致 1 / 7 条产物：docs/inventory/verdict-execution-debug.md
```

6 行差异，逐行的**整行字符数**（`-` 生成物 / `+` 磁盘，`check_verdict_tables.diff_lines` 的口径）：

| 族 | 生成物（= `FAMILIES`） | 磁盘 |
|---|---:|---:|
| `exec/run-instances` | 2137 | 1412 |
| `exec/junit-inspection` | 1605 | 1048 |
| `exec/run-toolbar` | 1646 | 858 |
| `exec/testframework` | 1025 | 664 |
| `exec/console` | 1322 | 984 |
| `dbg/inline` | 1166 | 779 |

`difflib` 逐字符取「只出现在盘上」的片段：只有 6 段散文残片（`运行统计（`、`仍未接`、`只做了…扁平实例清单`、
`折叠/展开；本仓是一张扁平表`、`InlineWatch…未做 —— 刷新时机`、语言控制台 REPL 那整句），
**盘上独有的文件引用 = 0 条**（脚本比对两侧 `src|native|tests|docs|scripts` 引用集合，六个族全部 `only-disk refs: []`）。
⇒ 请求里「盘上的判词文本比 `FAMILIES` 的长」这条不成立，实际是盘上那份是**旧版生成物**：
后面几轮的批次改了 `FAMILIES` 并重生了 `verdict-execution.md`/`verdict-xdebugger.md`/两份 JSON（它们 `--check` 全绿），
唯独这份 B8 合并判决书没跟着重生（它只在 `domains == [execution, xdebugger]` 时才写，见 `scripts/verdict_table.py:1019-1021`）。

## 2. 盘上那 6 段判词为什么站不住（逐条，含出处）

盘上每句都读原始文件核过；结论统一是「说过头 / 已被后来的实现超越」，**一条都不并回**。

| # | 盘上原话（摘要） | 站不住的理由 |
|---|---|---|
| 1 | `exec/run-instances`：「运行统计（`execution/impl/statistics`）仍没有落点」 | 上游那个包 10 个文件全是 FUS 上报（`ProgramRunnerUsageCollector.kt`/`RunConfigurationTypeUsagesCollector.java`/`MacroUsageCollector.kt`/`FusAwareRunConfiguration.java`/… 与两个 `*LanguageExtension`，`ls` 实测正好 10 个），**不是**「运行次数/时长」那种统计 ⇒ 「没有落点」这个说法本身预设了一个不存在的面。真源里那段订正保留。 |
| 2 | `exec/run-instances`：「但没有 JAR 运行表单」 | 规则层与编辑器行都已存在：`src/jarRun.ts`（`JAR_APPLICATION_TYPE_ID`/`jarTemplateConfiguration`/`jarValidation`/`jarRunArgs`）、`src/runConfigEditors.ts:130` 的 `RUN_CONFIG_TYPE_FAMILY_EDITORS.jar`；只有「宿主两处白名单」那一步当时没接。 |
| 3 | `exec/junit-inspection`：「quickfix（FlipArguments / AddAnnotation / JUnit4 转换器）未接动作入口」 | 已接：`src/semanticActions.ts:423` 调 `junitQuickFixActions`，判据 `tests/local-intentions.test.mjs:78-79` 就是钉这件事的。 |
| 4 | `exec/run-toolbar`：「Run Dashboard 只做了工具栏弹层的扁平实例清单…没有按类型分组」 | 已按类型分组：`src/runDashboard.ts` 的 `groupRunDashboardRows`（分组键 = `RunConfig['type']`）+ `src/components/MainToolbar.vue:349-357` 的弹层。 |
| 5 | `exec/testframework`：「测试**树**视图…本仓是一张扁平表」、失败导航/自动测试/XML 导出/历史测试都缺 | 四个都有落点了：`src/testTree.ts`、`src/testNavigation.ts`、`src/autoTest.ts`、`src/testResultsXml.ts` + `src/testImport.ts`，消费点全在 `src/components/TestRunnerPanel.vue`，判据 `tests/test-tree-view.test.mjs`/`test-navigation`/`test-import`/`test-locator`。 |
| 6 | `exec/console`：「语言控制台 REPL…需要『对运行中进程执行片段』的解释器回路，本仓只有 stdin 行通道」 | 前提不成立（这条真源里早就订正过，我复核了上游代码）：`platform/lang-impl/src/com/intellij/execution/console/ConsoleExecuteAction.java:148-151` 的 `myUseProcessStdIn` 分支就是把输入行按 `USER_INPUT` 打进控制台送进进程 stdin，本仓这条链在（`src/runActions.ts` 的 `sendRunInput` → `native/run_host.hpp:90` 的 `write_line`）。真缺的只有 `:157-160` 的 `addToCommandHistoryAndExecute` → `:162` 抽象 `doExecute`（`BaseConsoleExecuteActionHandler` 起解释器子进程）那一半。 |
| 7 | `dbg/inline`：「`InlineWatch` 未做 —— 刷新时机在面板的会话状态里，编辑器只收最终文本」 | 已做且两层都在：`src/debugInlineWatch.ts` + `src/debugInlineWatchSync.ts` + `src/editorDebugLine.ts:210` 的 `inlineWatchesField`。 |

## 3. 真源侧的 8 处假坐标（打开原文件逐条核对后订正）

`文件:行号` 全按规约自己开过；**改在 `FAMILIES`（真源只留一份）**，然后重生成产物。

| 原判词 | 真相 | 处置 |
|---|---|---|
| `src/semanticActions.ts:343-378` 的 `openCodeActions`，「它只读 `lspDiagnostics`」 | `openCodeActions` 在 `:399`；`:411-414` 读的是 `lspDiagnostics` **与** `localDiagnostics` 两张表，`:417` 抑制条目、`:423` JUnit 修复、`:437-439` 与服务端条目合流 | 行号与结论一起订正 |
| `localDiagnostics`（`src/junitInspections.ts:281`） | 声明在 `:295`（`:281` 是函数体里的一行 `...parameterizedProblems`） | 改 `:295` |
| `src/problems.ts:48-66` 的 `allProblems` | `allProblems` 在 `:90`（`:48-66` 是 `ProblemRow` 接口） | 改 `:90` |
| `ExecutionTargetComboBoxAction.kt:65` 的 `MAX_TARGET_DISPLAY_LENGTH` | `:65` 是 `presentation.isEnabledAndVisible = true`；`trimMiddle` 在 `:66`，常量声明在 `:34`（值 = 80 ✓） | 改成 `:66` + `:34` |
| `:86-104` 的 `getTargetActions`「各带分隔条」 | `getTargetActions` 是 `:87-107`（无名组在前 `:96-99`、`sortedBy { it.key }` `:101-104`）；**分隔条不在这个函数里**，在 `getTargetGroupActions` 的 `:114-116`（`Separator.create(targetGroupName)`） | 拆开写，各给真坐标 |
| `RunDashboardGroup.java:23-27` 的「分组键」、`RunDashboardManager.java:40-44` 的「默认类型表」 | `:23-27` 只有 `getName()`/`getIcon()` 两格（是组的形状，不是分组键）；`:40-44` 是 `getTypes()`/`setTypes()` 两个访问器（不是默认类型表） | 按实写入，并把本仓的对应物（`RUN_DASHBOARD_TYPES_KEY` + `runDashboardPresentTypes` 取 `RUN_CONFIG_TYPES` 顺序）写实 |
| `ConsoleExecuteAction.java`「`addToCommandHistoryAndExecute`，`:159-162`」 | 方法是 `:157-160`；`:162` 是抽象 `doExecute` | 改 `:157-160` + 点明 `:162` |
| 「全树 grep 不到 `RunStatistics`/`ExecutionStatistics`/`ExecutionStatisticsManager`」 | 全树 grep（`--include=*.java --include=*.kt`）有 3 处 `ExecutionStatistics` 字样命中：`LightPlatformTestCase.java:149` 的 `reportTestExecutionStatistics()` 与两个调用点（`JUnit5TestSessionListener.java:192`、`_LastInSuiteTest.java:56`）⇒ 「grep 不到」作为字面断言是假的 | 改写成「全树没有 `RunStatistics`/`ExecutionStatisticsManager` 这类**运行统计**服务，`ExecutionStatistics` 字样只在测试遥测那一处命中」 |

顺带核过、**为真**因而保留的坐标：`intellij.platform.execution.impl.actions.xml:127-129`（`ExecutionTargetsToolbarGroup searchable=false popup=false`，里面只有 `ExecutionTargets`）、
`ExecutionActions.xml:133-135`（挂 `MainToolbarRight`）、`ExecutionTargetComboBoxAction.kt:60-63`（本机目标 ⇒ `isEnabledAndVisible=false`）、
`TestTreeExpander.java:40-61`（`expandAll` / `TreeUtil.collapseAll(…,1)` / `canExpand = hasTestSuites`，三条逐行对上）、
`native/run_host.hpp:90`（`write_line`）、`MisorderedAssertEqualsArgumentsInspection.java:67` 的 `applyFix`、
`InlineWatch.kt:35-44`/`:70-72`/`:79-81`。引用到的上游类名全部 `find` 到过（`SMTestLocator`、`TestListenerProtocol`、
`SMTRunnerConsoleProperties`、`ExportTestResultsConfiguration`、`TestResultsXmlFormatter`、`FailedTestsNavigator`、
`ScrollToRunningTestAction`、`ToggleAutoTestAction`、`AbstractAutoTestManager`、`DelayedDocumentWatcher`、
`ApplicationConfiguration`、`JarApplicationConfiguration`、`ApplicationConfigurationProducer`、`RemoteRunProfile`、
`JUnit4ConverterQuickfix`、`JUnit5ConverterInspection`、`JUnit5AssertionsConverterInspection`、`HamcrestAssertionsConverterInspection`、
`RunDashboardCustomizer`、`BaseConsoleExecuteActionHandler`）；核不到的没有写进去。

## 4. 过期判词的 5 族（判词比代码旧，订正后才有 7/7 的意义）

| 族 | 订正内容 | 磁盘证据 |
|---|---|---|
| `exec/junit-inspection` | 第二批规则（`JUnitMixedFramework`/`JUnitMalformedDeclaration`/`MultipleExceptionsDeclaredOnTestMethod` + naming 三条默认正则）已在 `src/junitRules.ts`；quickfix 已接 Alt+Enter。**真缺**缩到：`ExpectedExceptionNeverThrown`（要数据流）、`JUnitAssertEqualsOnArray`/`MayBeAssertSame`（要静态类型）、`JUnit5ImplicitUsageProvider`（建在 `ReferencesSearch` 上）与整代转换器动作 | 检查器 id 实测：`grep -ho "source: '…'" src/junitInspections.ts src/junitRules.ts \| sort -u` = **9 个静态 id**（第一批 6 + 第二批 3），naming 那三条走 `source: convention.shortName`（`src/junitRules.ts:389`/`:404`）⇒ 运行时再加 3 个短名；`src/semanticActions.ts:423` 是 JUnit 修复的消费点；`tests/junit-rules.test.mjs` 存在 |
| `exec/testframework` | 树 / 失败导航 / 自动测试 / XML 导出 / 历史导入 / 用例定位全部有落点；**真缺**只剩两小截：导出的 XML 只进剪贴板（`src/clipboard.ts`），没有「选目录 + 写文件」的出口；导入的历史会话不能重跑（`src/testImport.ts` 里没有 rerun 通道，grep 零命中） | `src/testTree.ts:67`（`TREE_NODE_LIMIT = 500`）、`src/testNavigation.ts:28-51`、`src/autoTest.ts:22`（`AUTO_TEST_DELAY_KEY = 'auto.test.manager.delay'`）、`src/components/TestRunnerPanel.vue:14-18`/`:322-325`/`:383-393`/`:421`/`:464-465` |
| `dbg/inline` | 行内监视的重锚（`tr.changes.mapPos` ⇒ `mapWatchLine`）与就地编辑（点行内监视换输入框、Enter 提交 / Esc 取消，走 `setInlineWatchExpressionEditor`）**都已落地**；「没有 RangeMarker 通道、不重锚」这条旧差异撤销；**仍缺** `InlineVariablesPanel`（断点行下方展开的变量面板） | `src/editorDebugLine.ts:126`/`:148`/`:193-194`/`:204-207`/`:210`、`src/debugInlineWatchSync.ts:99`、`src/components/DebugPanel.vue:139`/`:734`、`tests/debug-inline-watch.test.mjs:68` |
| `exec/sm-runner` | 原先记为缺口的 `SMTestLocator` 与 `history/` 导入历史测试已有落点，改指向 `exec/testframework`；**真缺**是 socket 侧协议壳与 per-framework 配置面 | `src/testLocator.ts:44-45`（`java:suite`/`java:test`）、`src/testImport.ts` |
| `exec/run-instances` | JAR 一段改成「规则层 + 编辑器行已在，是否渲染由 `RUN_CONFIG_TYPE_IDS_HOST_PENDING` 门控（宿主两处 = `src/settingsModel.ts` 的联合 + `native/settings_schema.cpp` 的 type 白名单）」；并如实记下**上游逐格表单没到渲染**：`Path to JAR` 浏览按钮与 JRE/VM options 三格只有 `src/jarRun.ts` 的 `JAR_FORM_FIELDS` 描述（`moduleClasspath` 标 `available: false`），没有任何消费者（`grep -rn JAR_FORM_FIELDS src tests` 只有定义 + 那份判据） | `src/jarRun.ts:101-119`、`src/runConfigEditors.ts:130`、`tests/jar-run.test.mjs:40-45` |

**刻意没钉进判词的一件事**：JAR 的宿主接线在我开工时是**别的 lane 的在途改动**
（`src/settingsModel.ts` 的 `| 'jar'`、`src/runConfigurationSchema.ts` 把 pending 清空、`native/settings_schema.cpp:1011` 认 `jar`
—— 三个文件都在 `git status` 的 M 列，`git show HEAD:src/settingsModel.ts` 里还没有 `'jar'`）。
判词因此写成「机制 + 未渲染的形态」，没有把「pending 已空」这种会随他们回退而变假的句子钉进真源。
他们收工后要把这一格改成「已全部接通」，应由那条 lane 改 `FAMILIES` 再重生成。

## 5. 门怎么接的，以及取舍

现状确认：`tests/*.mjs` 是纯 JavaScript、`npm test = node --test tests/*.mjs`；
`tests/verdict-generated.test.mjs` 读的是 `*_verdict_table.json`（JSON 与真源同步 ⇒ 它看不见 md 那份漂移），
`tests/b9/b11/b12-verdict.test.mjs` 读的是**手写 §G 逐类表**，`grep -rn "verdict_table.py" tests/` 零命中
⇒ 「族级 md == `FAMILIES`」这件事在 node 回归里**一条都没有**，请求里的定性成立。

两条路的取舍：

* **B：python 把 `--check` 结论落成一份受版本控制的 JSON，node 只读那份 JSON** —— 放弃。
  它必然假绿：真源改了而 python 没重跑时，快照和真源**一起漂**，node 看不出任何差别；
  要让快照有牙就得在 node 里重写 `write_verdict_doc` 的分族/排序/计数/合计，那就是第二份真源，
  直接违反本仓「判词真源只留 `FAMILIES` 一份」的口径（`scripts/verdict_table.py:897` 那句话）。
* **A：node 门 spawn python** —— 采用，但补一条**不依赖 python 的硬断言**顶在最前面，这样
  python 缺席时不是「整条门消失」，只是丢掉字节级那一半。仓里已有先例：
  `tests/patch-hunk-counts.test.mjs:137-152` 就是「真 git 在就跑、不在就 `t.skip`」的口径，
  所以 spawn 外部程序本身不违反「测试是纯 JavaScript」（我的文件里没有任何 TS 语法，
  `node .tools/find-ts-in-mjs.mjs` 对我这条零命中）。

新门 `tests/verdict-table-check.test.mjs` 的四条：

1. **纯 JS**：三份族级判决书（`verdict-execution.md`/`verdict-xdebugger.md`/`verdict-execution-debug.md`）
   里每一格 `| \`族\` | \`[档]\` | 判词 | 行数 |` 必须**逐字**能在同名 JSON 的 `families[族].reason` 里找到。
   不需要生成器就能抓住「md 被手改」与「md 是旧版生成物」两类 —— 本次 HEAD 那份漂移属于后者。
2. `python scripts/verdict_table.py --check` 退出码必须 0，且必须打印「一致 N / N」（N ≥ 7）；
   再跑一次并比对 7 份产物的 sha256 ⇒ **`--check` 自己一个字节都不许写**（2026-10-05 那个事故的口径也钉进门里）。
3. **反向验证的门禁化**：在 `build/`（已 gitignore）的临时副本里把 `exec/misc` 的判词改一个字 ⇒
   `--check` 必须 exit 1 且打印「不一致 k / N」，且差异行里要点名 `exec/misc`；改回 ⇒ 必须绿。
   副本先按真源生成一遍建立绿基线，所以那个红只能是「改一个字」造成的。锚点找不到时测试自己红
   （「这条测试自己失效，必须改」）—— 不给自己留永远绿的机会。
4. **§G 护栏仍然挡着**：副本里造一份带手写 `## G. 逐条总表` 的判决书跑写盘档 ⇒ 必须 exit 1 + 打印「拒绝生成」
   + 那份文件一字节不动；并核真仓 `verdict-find-diff.md`/`verdict-actions.md`/`verdict-settings-run.md` 的 §G 还在。
   **没有为了让产物变绿而动 `MAX_DIFF_LINES`/`MAX_DIFF_CHARS`/§G 护栏，也没有手改任何生成物**
   （产物只由 `python scripts/verdict_table.py execution xdebugger` 重写）。

## 6. 反向验证（两组，原始数字）

A. 真源侧：把 `FAMILIES` 的 `exec/misc`「没有 JVM…」改成「真 JVM…」（一个词），当场跑：

```
python scripts/verdict_table.py --check            → 退出 1，不一致 4 / 7 条产物：
   execution_verdict_table.json、xdebugger_verdict_table.json、verdict-execution.md、verdict-execution-debug.md
node --test tests/verdict-table-check.test.mjs     → 退出 1，tests 4 / pass 2 / fail 2
   ✖ python … --check 必须一致…            AssertionError: --check 应当退出 0，实际 1
   ✖ 反向验证：FAMILIES 改一个字…          AssertionError: 变异锚点在 FAMILIES 里找不到了（这条测试自己失效，必须改）
node --test tests/verdict-generated.test.mjs       → 退出 0，5/5 **仍然绿**（它只看 JSON，看不见这件事）
```
改回 ⇒ `python … --check` 退出 0「一致 7 / 7」、新门 4/4 绿。

B. 产物侧（证明第 1 条不靠 python 也有牙）：往 `verdict-execution-debug.md` 的 `exec/run-instances`
那一格插入了一段探针文本（`PROBE-…-SYNC-TEMP` 形状，16 字符，已随下一次重生成消失）：

```
node --test tests/verdict-table-check.test.mjs → 退出 1，pass 2 / fail 2
   ✖ 族级判决书的每一格判词都逐字等于 JSON 真源映射
       verdict-execution-debug.md: exec/run-instances 那格与 JSON 不符（磁盘判词 3218 字 / 真源 3194 字）
   ✖ python … --check（顺带也红，符合预期）
node --test tests/verdict-generated.test.mjs   → 5/5 仍绿（同上，它不读 md 判词）
```
还原用重生成（不手补）：`python scripts/verdict_table.py execution xdebugger` → 7/7 一致、新门 4/4 绿。
标记残留：**0**（`src tests docs scripts native` 全域 grep = 0；整仓排除 `build/`、`node_modules/`、`.git/` 再 grep = 空；
`build/` 里两个副本目录也已被测试的 `finally` 删干净）。

## 7. 跑测数字（收工前）

| 命令 | 结果 |
|---|---|
| `python scripts/verdict_table.py --check` | 退出 0，**一致 7 / 7 条产物**（改前：不一致 1 / 7） |
| `node --test tests/verdict-generated.test.mjs tests/b9-verdict.test.mjs tests/b11-verdict.test.mjs tests/b12-verdict.test.mjs tests/verdict-table-check.test.mjs` | 退出 0，**38 tests / 38 pass / 0 fail / 0 skipped**（去掉新门是 34/34） |
| `node --test tests/module-size.test.mjs` | 退出 0，5 / 5 pass |
| `node .tools/find-missing-ext.mjs` | 退出 0，扫描 1329 个文件，干净 |
| `node .tools/find-ts-in-mjs.mjs` | 退出 0，但报 **1 个文件含真 TS**：`tests/custom-folding-regions.test.mjs`（不是我的，见 §8） |
| 判词背书那批（15 份：`junit-rules`/`junit-inspections`/`local-intentions`/`test-tree-view`/`test-navigation`/`test-import`/`test-locator`/`debug-inline-watch`/`debug-inline-watch-wiring`/`debug-inline-values`/`run-dashboard`/`run-instance-ports`/`console-input`/`jar-run`/`run-config-types`） | 149 tests / **148 pass / 1 fail** / 0 skipped；唯一那条红不是本批造成的（见 §8） |
| 产物体积 | `verdict-execution-debug.md` 33690 → **45076** 字节；`execution_verdict_table.json` 2883145 → 3674544；`verdict-execution.md` 25902 → 31857…（订正后判词变长，全部由生成器写盘） |

改动清单（`git status --porcelain` 里属于本批的只有这些）：
`scripts/verdict_table.py`、`docs/inventory/execution_verdict_table.json`、
`docs/inventory/xdebugger_verdict_table.json`、`docs/inventory/verdict-execution.md`、
`docs/inventory/verdict-xdebugger.md`、`docs/inventory/verdict-execution-debug.md`、新增 `tests/verdict-table-check.test.mjs`。
两份 `*_verdict_table.md`（逐类表）不印判词，字节未变。
**没动**的三份手写判决书（md5 开工/收工各取一次，逐字相同）：
`verdict-settings-run.md` `5773344f5161c22513ce8298dbe67bec`、`verdict-editor.md` `6824a67deb393fcf15025f7dbb4c0cdc`、
`verdict-find-diff.md` `e0aaef2b26ba7e248adbe329d1e15484`。保留文件一个没碰；没有 `checkout`/`reset`/`stash`/`clean`/commit/push。

## 8. 交给别的 lane 的三件事（不在本批动手）

1. **`tests/console-input.test.mjs:123`「订正钉子：控制台编码是应用级默认」现在是红的**（execui2 lane 的文件，
   `src/consoleEncoding.ts` 与这份测试都在 M 列）。原因很细：`src/consoleEncoding.ts:9` 那行折行后是
   「接口 `platform/execution/src/com/intellij/execution/ui/ConsoleView.java` 都 grep 不到 `setEncoding`，」，
   行内含 `setEncoding` 但不含那条测试要求的 `不是|没有|订正|原先|旧注释` 任一否定词 ⇒ 自己的钉子绊自己。
   修法只在他们那句注释里加一个否定词；本批判词（`exec/console`）不含 `setEncoding`，没有被这条拖累。
2. **`tests/custom-folding-regions.test.mjs`（未跟踪，`??`）里有真 TypeScript 语法**
   （`:61` 函数参数类型标注、`:63` 变量类型标注、`:86` `as` 断言、`:110` 箭头函数参数标注），
   `node --test` 直接 `SyntaxError: Unexpected token ':'` ⇒ `npm test` 里这一条加载失败。归 folding lane。
3. **JAR 宿主接线**（§4 最后一段）：那条 lane 收工后若要判词写「pending 已空、表单已渲染」，
   请改 `scripts/verdict_table.py` 的 `exec/run-instances` 条目再跑 `python scripts/verdict_table.py execution xdebugger`
   —— 不要手改 `docs/inventory/` 里的生成物，新门第 1 条会红。
4. 顺带：`scripts/__pycache__/verdict_table.cpython-314.pyc` **被 git 跟踪**，任何人跑一次 python 它就进 M 列，
   建议纳入 `.gitignore`（本批没动它，只让它随跑测自然变化）。

## 9. 复算

```
python scripts/verdict_table.py --check
node --test tests/verdict-table-check.test.mjs
node --test tests/verdict-generated.test.mjs tests/b9-verdict.test.mjs tests/b11-verdict.test.mjs \
          tests/b12-verdict.test.mjs tests/verdict-table-check.test.mjs
# 自己重跑一次反向验证（改一个字 ⇒ 门必须红；改回 ⇒ 绿）：
#   scripts/verdict_table.py 里 exec/misc 的「没有 JVM 对象模型可移植」↔「真 JVM 对象模型可移植」
```
