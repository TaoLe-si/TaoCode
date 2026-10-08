# 批次 2026-10-06 · JUnit / 测试框架族（桶11 测试半边）— 先核后做

上游参考树：`D:\Backup\Downloads\intellij-community-master\intellij-community-master`（唯一可用）
本仓 `third_party/intellij-community` = 坏树，不作证据。

## 0. 口径（继承，别推翻）
- JAR 运行配置已落。
- 真缺的是 `RemoteRunProfile`。
- `src/runConfigurationSchema.ts` 的 `RUN_CONFIG_TYPE_IDS_HOST_PENDING = []` 是**拦截器**：不许为让测试绿往里加 id。
- 保留文件不动：`src/App.vue`(余量30)、`src/bridge.ts`(0)、`src/components/CodeEditor.vue`(2)、`src/runActions.ts`、`src/settingsModel.ts`、`native/main.cpp`、`scripts/verdict_table.py`、`docs/inventory/*`。
- 并发黑名单（只读）：`src/runConfig*`、`src/runAnything*`、`src/progress*`、`src/diff*` 等。

## 1. 三档表（上游与磁盘均已自己开过）

上游坐标（本次逐条开文件核实的**声明行**，非引用二手）：
- `platform/testRunner/src/com/intellij/execution/testframework/Filter.java:43-123` —— `NO_FILTER:43`、`DEFECT:50`、`IGNORED:57`、`NOT_PASSED:64`、`PASSED:71`、`HAS_PASSED:78`、`FAILED_OR_INTERRUPTED:85`、`LEAF:92`、`DEFECTIVE_LEAF:99`、`HIDE_SUCCESSFUL_CONFIGS:110`；组合子 `not/and/or` 在 `:31-41`。
- `platform/testRunner/src/com/intellij/execution/testframework/actions/TestFrameworkActions.java:15-26`（`installFilterAction`）与 `:28-45`（`getFilter` 三分支合成）。
- `platform/testRunner/src/com/intellij/execution/testframework/TestConsoleProperties.java:43-60` —— `:51 hideIgnoredTests=false`、`:52 hidePassedTests=true`、`:54 openFailureLine=true`、`:58 includeNonStarted=true`、`:59 hideConfig=false`；`:224-226 createIncludeNonStartedInRerun`（文案键 `junit.running.info.include.non.started.in.rerun.failed.action.name`）。
- `platform/execution/resources/messages/ExecutionBundle.properties:139-140` = `Show Passed` / `Show passed tests`；`:157` = `Include Non-Started Tests in Rerun Failed`。`TestRunnerBundle.properties:48-49` = `Show ignored` / `Show Ignored`。
- `plugins/junit/src/com/intellij/execution/junit2/ui/properties/JUnitConsoleProperties.java:50` 真的把 `createIncludeNonStartedInRerun` 加进了工具栏（TestNG 同：`plugins/testng/src/com/theoryinpractice/testng/model/TestNGConsoleProperties.java:46`）⇒ 这条开关在 JUnit 运行里**用户可见**，不是我造的控件。
- `platform/testRunner/src/com/intellij/execution/testframework/actions/AbstractRerunFailedTestsAction.java:335 行`、`RerunFailedTestsAction.java:70 行`、`plugins/junit/src/com/intellij/execution/junit2/ui/actions/RerunFailedTestsAction.java` —— 三个文件都真实存在（判词里的坐标没假）。`AbstractRerunFailedTestsAction.java:94-117 isActive`（可用性门控）、`:131-141 getFailuresFilter`：`includeNonStarted ? NOT_PASSED.or(FAILED_OR_INTERRUPTED).and(IGNORED.not()) : FAILED_OR_INTERRUPTED.and(IGNORED.not())`。
- 堆栈定位链：`platform/smRunner/src/com/intellij/execution/testframework/sm/SMStacktraceParser.java:29-38`（`getErrorNavigatable`，注释原文 "Used for navigation from tests view to the editor if 'open failed line' option is selected"）→ `platform/smRunner/src/com/intellij/execution/testframework/sm/runner/SMTestProxy.java:406-421`（`getDescriptor`：先取堆栈给出的 navigatable，再退 `location.getNavigatable()`）→ `java/execution/impl/src/com/intellij/execution/testframework/JavaAwareTestConsoleProperties.java:84-90`（`//navigate to the first stack trace`）→ `platform/smRunner/src/com/intellij/execution/testframework/sm/runner/ui/TestStackTraceParser.java:18-21`（`outerPattern = \tat (.*)\.([^.]*)\((.*)\)`、`innerPattern = (.*):(\d*)`，产出 failedLine/failedMethodName）。

| # | 判词出处（docs/inventory 行号） | 判词 | 磁盘现状（可复现） | 档位 |
|---|---|---|---|---|
| 1 | `verdict-settings-run.md:2385/2387`、`:3498`：`AbstractRerunFailedTestsAction`/`RerunFailedTestsAction` `[ ]`「从未出现」 | 动作整体未移植 | 「重跑失败项」**已闭环**：`src/testRunner.ts:126-140 rerunCommand`（按框架拼 `-Dtest=` / `-R` / `--test-name-pattern`）+ `src/components/TestRunnerPanel.vue:173-176 rerunFailed()` + 工具栏按钮 `:463`（`:disabled="running \|\| !failed.size"`，与上游 `isActive` 的「没有失败就不让点」同档）。判词按**英文类名**全文搜，本仓用的是中文标签 + `rerunCommand`，故误判。 | **A 已闭环被误判**（但语义缺一档，见 #2） |
| 2 | 同上（`RerunFailedTestsAction` 那一档） | —— | **不等价**：本仓 `rerunFailed` 只把 `outcome==='failed'` 的名字交出去；上游默认档（`TestConsoleProperties.java:58 includeNonStarted=true`）是 `NOT_PASSED ∪ FAILED_OR_INTERRUPTED` 再排除 `IGNORED`，即**「跑过的失败 + 压根没跑起来的用例」一起重跑**，且这条在 JUnit 工具栏上有开关（`JUnitConsoleProperties.java:50`，文案 `ExecutionBundle.properties:157`）。 | **C 不等价 ⇒ 本轮还原**（§2 实现 2） |
| 3 | `verdict-settings-run.md:50/88/89` 的 `TestTreeExpander [~]`「本仓只落了逐节点 toggle/isExpanded」 | 缺 expandAll/collapseAll/canExpand/setModel/dispose | **过时**：`src/testTree.ts:336-360` 的 `TestTreeExpander` 有 `isExpanded/toggle/expandAll/collapseAll/canExpand/canCollapse/clear`，面板 `TestRunnerPanel.vue:451-452` 两个按钮 + `:256 expandable` 门控真在消费。`setModel/dispose` 是 Swing 模型句柄，本仓把树当参数传入（`expandAll(nodes)`），无落点。 | **A 已闭环被误判** |
| 4 | `verdict-settings-run.md` 关于按状态过滤（`Filter` 族 `[~]`，如 `:2387` 同行段与 `execution_verdict_table.md:1197`） | 缺过滤器合成 | **已闭环**：`src/testResultFilter.ts:85-106`（`nodeAccepted` 逐分支照抄 `TestFrameworkActions.java:28-45`，含 `hidePassed` 开着时不加 `HAS_PASSED` 兜底那条）+ 面板两个 inverted 开关 `:467-470`（文案常量 `:48-52`）。第三条 `HIDE_SUCCESSFUL_CONFIG` **不是漏写是没落点**（通道无 config 节点，`testResultFilter.ts:38-44` 已登记并挂 wiring-requests）。 | **A 已闭环被误判**（第三条开关 = B 类里明确不可做，不动） |
| 5 | `verdict-settings-run.md:2277 SMStacktraceParser [ ]`、`:2350 TestStackTraceParser [ ]`「从未出现」 | 缺失败堆栈定位 | **确缺**：`TestRunnerPanel.vue:521-524` 把 `kind==='file'` 的片段渲染成 `<span class="testrun-link">`——**只画了下划线，没有 `@click`**，同屏的 `rerun` 链接（`:522-523`）反而是 `<button>`；而 `RunConsole.vue:234-236 jumpLink()` 早就 `emit('jump', {path,line,column})`，App.vue `:2265` 也已在听 `@jump` ⇒ 通道现成，只差面板里把详情区的文件位置接上去。另外 `sourceOf(node)`（`:275-278`）只给**声明行**，没有上游 `getDescriptor` 的「失败行优先」。 | **B 缺且可做 ⇒ 本轮实现**（§2 实现 1） |
| 6 | `verdict-settings-run.md:1318 RemoteRunProfile [ ]` | 未移植 | 与本 lane 无关，按既定口径记为「真缺」，不在本批做。 | 不动（既定） |

## 1b. 假坐标 / 行号漂移订正留痕
- `src/testResultFilter.ts:5-9` 的文件头把 `Filter.java` 的成员写成 `:38-43 / :45-50 / :52-57 / :59-64 / :66-71 / :73-78 / :80-85`，并说组合子在 `:29-37`；**实际**（本次 `cat -n` 全量）`not/and/or` 在 `:31-41`，`NO_FILTER:43`、`DEFECT:50`、`IGNORED:57`、`NOT_PASSED:64`、`PASSED:71`、`HAS_PASSED:78`、`FAILED_OR_INTERRUPTED:85`。判词行号是**旧漂移**，成员与语义对得上，只有坐标偏 3–12 行。本批只改这条注释的坐标，不动逻辑。
- `verdict-settings-run.md:2387` 与 `execution_verdict_table.md:1197-1199` 对同三个类给的档不同（前者 `[ ]`，后者 `[-]`），两者对「本仓有没有实现」的结论一致（按类名搜不到）⇒ 记为口径问题，不改 `docs/inventory/*`（保留文件）。
- 「折叠已通过项」这条候选**上游没有对应控件**：`ToolbarPanel.java:59-66` 只有 Show Passed / Show Ignored 两个 inverted 开关，`:127-133` 是 Expand All / Collapse All（整棵树），没有任何「只折叠通过的」动作 ⇒ 该候选按上游不存在处理，不自造。

## 2. 实现（两块，都不动保留文件、都用户可见）

### 2a. 失败堆栈点击定位（§1 表 #5，档位 B）
上游链：`SMStacktraceParser.java:29-38` → `SMTestProxy.java:406-421`（先堆栈、后声明）→ `JavaAwareTestConsoleProperties.java:84-121`（`//navigate to the first stack trace`；逐帧比「方法名 + 限定类名」，命中即 break；文件取类的 containingFile，行号取那一帧）→ `TestStackTraceParser.java:20-21/79-82`（两个正则；内层不成立就**中止**）。开关本体 `ToolbarPanel.java:187-189` + 文案 `ExecutionBundle.properties:166-167`，默认值 `TestConsoleProperties.java:54`（true）。

改动：
- `src/testLocator.ts`：新增 `parseStackFrame`、`failureLocation`、`resolveFrameFile` 与 `DEFAULT_OPEN_FAILURE_LINE` / `OPEN_FAILURE_LINE_NAME` / `OPEN_FAILURE_LINE_DESCRIPTION`。类名比对沿用本模块 `classMatches` 的短名放宽（本仓发现器把 JUnit 的 suite 记成字面量 `JUnit`，严格按限定名一帧也认不出）；PSI 那道「行号必须落在方法 TextRange 内」的校验本仓没有 ⇒ 登记为架构不等价，行号原样交编辑器。
- `src/components/TestRunnerPanel.vue`：
  1. 失败详情里的 `file:line` 片段由 `<span>` 换成带 `@click="jumpDetailLink(...)"` 的 `<button>`（改前只画了下划线点不动）；裸文件名先经 `resolveFrameFile` 落到发现索引里的真实路径，**认不出就不跳**并在状态行说明，不造打不开的路径。
  2. `jump(node)` 走新的 `navigateTarget()`：失败的叶子先问堆栈那一帧，认不出退声明位置；tooltip 仍报声明位置（上游 descriptor / locationHint 的分工）。
  3. 工具栏加「Open Source at Exception」开关（`Crosshair`，默认开）。
- 宿主段不欠接线：`@jump` 在 `src/App.vue:2265` 已挂 `revealLocation`（`src/testLocator.ts` 头部那条「跳转停在面板里 / wiring-request W-B11c-1 待粘」的旧记录已按现树订正）。

### 2b. 重跑失败项含「没跑完的」（§1 表 #2，档位 C 的还原）
上游：`AbstractRerunFailedTestsAction.java:131-141`（`includeNonStarted ? NOT_PASSED.or(FAILED_OR_INTERRUPTED).and(¬IGNORED) : FAILED_OR_INTERRUPTED.and(¬IGNORED)`）、`:107`（判的是 `getAllTests()`）、`TestConsoleProperties.java:58`（默认 **true**）、`JavaRerunFailedTestsAction.java:22-30`（再 `and(LEAF)`）、`plugins/junit/.../junit2/ui/actions/RerunFailedTestsAction.java:29-50`（重跑集直接交 `TestMethods`）；开关用户可见：`TestConsoleProperties.java:224-226` + `JUnitConsoleProperties.java:50`，文案 `ExecutionBundle.properties:157` = `Include Non-Started Tests in Rerun Failed`；动作英文名核对自 `platform/platform-resources-en/src/messages/ActionsBundle.properties:1843` = `Rerun Failed Tests`（面板 title 里原来写的 "Rerun Failed" 已订正）。

改动：
- `src/testResultFilter.ts`：新增 `DEFAULT_INCLUDE_NON_STARTED` / `INCLUDE_NON_STARTED_NAME` / `RerunFailureFilter` / `rerunFailureAccepted` / `rerunFailureNames`（逐分支翻译上游的合成，`IGNORED`⇒`skipped`、`LEAF`⇒`kind==='test'`）。
- `src/testTree.ts`：`TestTreeBuilder.notFinished()` —— 上游 `NOT_PASSED` 那一档在本仓的取数处（`testStarted` 不产出结果行，见 `src/testEventChannel.ts:141-144`，所以这批节点进不了 `build()` 的树）。
- `src/components/TestRunnerPanel.vue`：重跑集 = `[...results] + notFinished()` 过 `rerunFailureNames`；「失败 (n)」的计数、`disabled` 门控与 `rerunCommand` 都改用这个集合；工具栏加 `ListChecks` 开关。
- 持久化：没有新键。这组开关与面板既有的显示过滤器/排序/跟踪开关同一口径（会话内状态，不落盘），因此 §6 的「缺键补默认」在本批不触发。

判据（先红后绿，注入前缀见 §3）：
- `tests/junit-stacktrace-navigation.test.mjs`（9 条）
- `tests/junit-rerun-failed-scope.test.mjs`（7 条）
- 实现前的红：两文件都因 `does not provide an export named …` 整体失败（`SyntaxError` 于 `testLocator.ts` / `testResultFilter.ts` 的具名导入），实现后 16/16 绿。

## 3. 反向验证（判据能失败）
注入标记用 `JUNIT2` + `-PROBE` 拼写（本文件不出现完整标记串，收工 grep 为 0）。三处探针，逐处跑对应判据：

| 探针 | 注入点 | 注入内容 | 结果（原始） |
|---|---|---|---|
| A | `src/testResultFilter.ts` 的 `DEFAULT_INCLUDE_NON_STARTED` | 改成 `false`（默认档被改坏） | `node --test tests/junit-stacktrace-navigation.test.mjs tests/junit-rerun-failed-scope.test.mjs` ⇒ exit=1，`tests 16 / pass 14 / fail 2`，红的那条：「默认档 = 上游那条属性的默认值 true（TestConsoleProperties.java:58）」 |
| B | `src/testLocator.ts` 的 `failureLocation` 首行门 | 去掉 `!openFailureLine \|\|`（开关失效） | 同批跑 ⇒ 红的那条：「failureLocation：Open Source at Exception 关着就不定位（TestConsoleProperties.java:54 的那条开关）」 |
| C | `src/components/TestRunnerPanel.vue` 的「失败」按钮 | `:disabled` 退回 `!failed.size`（重跑集接线断开） | `node --test tests/junit-rerun-failed-scope.test.mjs` ⇒ exit=1，`tests 7 / pass 5 / fail 2`，新增红：「消费链：面板的重跑集走过滤器，开关用户可见」 |

三处全部还原后复读盘（`grep -n` 实测）：
- `src/testResultFilter.ts:148` = `export const DEFAULT_INCLUDE_NON_STARTED = true`
- `src/testLocator.ts:302` = `  if (!openFailureLine || !stacktrace.length) return null`
- `src/components/TestRunnerPanel.vue:516` = `      <button class="subtle-button" :disabled="running || !rerunNames.length"`

收工 grep：`grep -rn "$('JUNIT2')-$('PROBE')" src tests docs native scripts --include=*` 的等价物（标记在本文件里一律拆成两段写，免得本文件自己算一处命中）⇒ **0 条**：代码、判据、文档都没有残留；探针只存在于本次会话的三次「改坏—还原」里。

## 4. 门禁原始数字（收工后复跑）
1. `node --test tests/junit*.test.mjs tests/test-runner*.test.mjs tests/module-size.test.mjs`
   ⇒ `exit=0`；`tests 71 / suites 0 / pass 71 / fail 0 / cancelled 0 / skipped 0 / todo 0 / duration_ms 376.8806`（含本批新增 16 条：junit-stacktrace-navigation 9 + junit-rerun-failed-scope 7）
2. `npx vue-tsc -b --force`
   ⇒ `exit=1`；`grep -cE "error TS"` = **2**：`src/gradleHost.ts(880,74): TS2304 Cannot find name 'UNLINKED_PROJECT_DISPLAY_ID'`、`src/semanticActions.ts(509,71): TS2345 …OrganizeImportsRequestParams…`。
   本域文件（`src/testLocator.ts`、`src/testResultFilter.ts`、`src/testTree.ts`、`src/testRunner.ts`、`src/components/TestRunnerPanel.vue`、`src/junit*.ts`）命中 **0 条**。
   留痕：第一次跑还多一条 `src/codeLensExtension.ts(469,55): TS18047 'decision' is possibly 'null'`，第二次跑消失 ⇒ 他域在飞、行号也在漂（预告的 `semanticActions.ts:507` 实测在 509）。都不是我的，也没动。
3. `node .tools/find-orphan-modules.mjs --gate`
   ⇒ `exit=0`；尾行「门禁绿：没有基线之外的新增零消费方模块」「已登记孤儿 6 / 基线 8 · 新增 0 · 本轮清掉 2」（清掉的两条是别批的 `src/jarRun.ts`、`src/runAnythingContext.ts`，与本批无关）。
4. 相关面扩跑（我自己的回归网）：`node --test tests/test-*.test.mjs tests/junit-*.test.mjs tests/run-*.test.mjs tests/runner-view-actions.test.mjs tests/assertion-view.test.mjs tests/console-hyperlinks.test.mjs tests/ui-icons.test.mjs tests/sfc-single-root.test.mjs tests/source-cit*.test.mjs`
   ⇒ `exit=1`；`tests 389 / pass 388 / fail 1`。
   唯一红：`source-citation-anchors.test.mjs` 的「已入快照的每条引用，被引区间内容必须仍与快照一致」，列出的 4 条 moved 全在
   `src/commitChecks.ts`（`CommonCheckinFilesAction.kt:26-78`）、`src/components/ProblemsPanel.vue`（`SuppressIntentionAction.java:19-19`、`IntentionSource.java:37-40`）、`src/runStartupFocus.ts`（`RunnerAndConfigurationSettings.java:242-242`）——
   **都不是本批改的文件**（本批只动 `src/testLocator.ts`、`src/testResultFilter.ts`、`src/testTree.ts`、`src/components/TestRunnerPanel.vue` 与两个新判据；`git diff --name-only` 可复现）。按纪律记为「他域在飞红，只记录不修」。
5. `node --test tests/b11-verdict.test.mjs tests/b10-verdict.test.mjs tests/verdict-generated.test.mjs tests/verdict-table-check.test.mjs tests/junit-scope.test.mjs`
   ⇒ `exit=0`；`tests 34 / pass 34 / fail 0`（判决簿的门禁没被我动 `docs/inventory/*` 之外的东西影响）。
6. 收工前复跑（本文最后两处编辑之后）：
   - `node --test tests/junit*.test.mjs tests/test-runner*.test.mjs tests/module-size.test.mjs` ⇒ `exit=0`；`tests 71 / pass 71 / fail 0 / duration_ms 459.2296`
   - `node --test tests/source-citations.test.mjs tests/source-citation-anchors.test.mjs` ⇒ `exit=1`；`tests 11 / pass 10 / fail 1`。
     红的是锚点内容门，原始串「共 11 条（按文件：**docs/batch-2026-10-06-termset.md 7 条**、src/components/ProblemsPanel.vue 2 条、src/commitChecks.ts 1 条、src/runStartupFocus.ts 1 条）」——
     比 §4-4 那次多出的 7 条来自**别批正在写的 `docs/batch-2026-10-06-termset.md`**（它新加的引用还没进快照，同批作者要重算快照），4 条旧的仍在他域源文件里。
     **本批两个文件（`docs/batch-2026-10-06-junit2.md` 与 `src/testLocator.ts`/`src/testResultFilter.ts`/`src/testTree.ts`/`src/components/TestRunnerPanel.vue` 的新引用）都没出现在红名单上**；
     带路径引用的**存在/界内**那条门（`source-citations.test.mjs` 全绿）本批 12 条新引用全过。快照重算是 `docs/inventory/citation-anchors.json` 的写入口＝保留文件，本批不碰。

## 6. 本批改动清单（逐个 `git diff --name-only` 可复现）
- `src/testLocator.ts`（+97 行：栈帧解析 / `failureLocation` / `resolveFrameFile` / Open-Source-at-Exception 三个常量；文件头的 wiring-request 旧记录原地订正）——313 行
- `src/testResultFilter.ts`（+62 行：重跑集过滤器与常量、上游合成逐分支注释）——173 行
- `src/testTree.ts`（+18 行：`TestTreeBuilder.notFinished()`）——665 行
- `src/components/TestRunnerPanel.vue`（详情区 file 片段换成按钮 + `jumpDetailLink`、`navigateTarget`、重跑集、两个新开关）——671 行（上限 900）
- 新增判据：`tests/junit-stacktrace-navigation.test.mjs`（9 条）、`tests/junit-rerun-failed-scope.test.mjs`（7 条）
- 本报告：`docs/batch-2026-10-06-junit2.md`
- **没动**：`src/App.vue`、`src/bridge.ts`、`src/components/CodeEditor.vue`、`src/runActions.ts`、`src/settingsModel.ts`、`native/main.cpp`、`scripts/verdict_table.py`、`docs/inventory/*`；并发黑名单里的 `src/runConfig*`、`src/runAnything*`、`src/progress*`、`src/commit*`、`src/diff*` 等一律只读。
  因此**没有**新的 `docs/wiring-requests-*.md`：两处用户可见的接线都长在面板自己 + 现成的 `@jump` 通道上（§2a 末尾那条旧记录订正即此意）。

## 5. 无法核实 / 订正留痕 / 遗留
- **无法核实**：本批新增的两条中文说明（重跑按钮 title 的「重跑失败的与没跑完的」/「只重跑失败的测试」、裸文件名认不出时的状态行「栈帧里的『…』不在发现结果里，打不开。」）是仓内自述文案，上游没有对应中文条目可核 ⇒ 登记为无法核实；随附的 IDEA 英文名都核过：`Rerun Failed Tests`（`platform/platform-resources-en/src/messages/ActionsBundle.properties:1843`）、`Open Source at Exception` / `Go to the line which caused an exception when opening a test source`（`ExecutionBundle.properties:166-167`）、`Include Non-Started Tests in Rerun Failed`（`:157`）。
- **订正留痕（不改 `src/**` 的既有引用，因为锚点快照钉着它们，改一条就要重算 `docs/inventory/citation-anchors.json`＝保留文件）**：
  1. `src/testResultFilter.ts` 文件头把 `Filter.java` 各成员的行号写成 `:38-43 / :45-50 / :52-57 / :59-64 / :66-71 / :73-78 / :80-85`、组合子写成 `:29-37`；本轮 `cat -n` 实测 `not/and/or` 在 `:31-41`，`NO_FILTER:43`、`DEFECT:50`、`IGNORED:57`、`NOT_PASSED:64`、`PASSED:71`、`HAS_PASSED:78`、`FAILED_OR_INTERRUPTED:85`（偏 3–12 行，语义与成员名都对得上，只是行号漂）。
  2. `src/testLocator.ts` 文件头旧记录「App.vue 没挂 `@jump`、跳转停在面板里、已提 wiring-request W-B11c-1」——现树 `grep -n "@jump" src/App.vue` 实测 **已挂**（TestRunnerPanel 那一行 = `src/App.vue:2265`，处理函数 `revealLocation`）⇒ 本批原地订正为「已闭合」，因此**没有**新的 wiring-request 要写。
  3. 面板上原来写的 `IDEA: Rerun Failed` 与上游原文不符（原文 `Rerun Failed Tests`，ActionsBundle:1843）⇒ 本批改成原文。
  4. 「折叠已通过项」这条候选**上游不存在**对应控件（`ToolbarPanel.java:59-66` 只有 Show Passed / Show Ignored，`:127-133` 是整树 Expand/Collapse All），所以按「上游没有 ⇒ 不造」处理，落在 §1 表 #3/#4 的 A 档，没有实现。
- **遗留（登记，不自扩范围）**：
  1. `HIDE_SUCCESSFUL_CONFIG` 第三条显示过滤器仍无落点（本仓通道没有 config 节点，`src/testResultFilter.ts:38-44` 已挂 `docs/wiring-requests-2026-10-06-bucket11b.md`）。
  2. 本仓没有 `interrupted` 这一结果档，也没有运行级中断事件 ⇒ 上游 `FAILED_OR_INTERRUPTED` 只能落到 `failed` + `notFinished()` 两处；真要还原 interrupted，得先有宿主把 `run.stop`/进程异常退出映射成测试事件（`src/testEventChannel.ts` 的协议扩展），属运行器侧改造，不在本窄 lane。
  3. `RemoteRunProfile`（`verdict-settings-run.md:1318`）按既定口径仍是真缺；`RUN_CONFIG_TYPE_IDS_HOST_PENDING = []` 保持拦截器原样，本批没往里加任何 id。
  4. JUnit 的 `TestMethods` 重跑是「按类 + 方法集合」精确定位（`plugins/junit/.../junit2/ui/actions/RerunFailedTestsAction.java:29-50`）；本仓 `rerunCommand` 对 maven 只拼 `-Dtest=名字`（`src/testRunner.ts:136-138`），跨类同名方法会跑宽。要精确就得让重跑集带类名（`TestTreeNode.path` 有），那是 `rerunCommand` 的签名改动，牵动 `tests/test-runner.test.mjs` 既有断言 ⇒ 留给下一批。
