# Lane exec-test（2026-10-08）：exec/junit · exec/junit-inspection · exec/testframework · exec/sm-runner

## 1. 做了什么

**A. 逐条核实四族判词的「缺」**（结论：两条订正/误报，其余成立）
- `exec/junit`：① TestNG 参数 → CLI 侧本轮补齐（§2），三页配置界面仍缺（本仓无「直跑主类」的 classpath 来源，给输入框即假控件）；② 测试发现索引仍缺（只到文件级命名关联，`src/affectedTests.ts` 模块头写着）；③ 「创建测试」动作仍缺；④ 注解引用导航（`references/` 九类）仍缺 —— 无 PSI 引用宿主，词法近似会把「找不到」报成「没有引用」。
- `exec/junit-inspection`：① 旧判词写 `JUnit5ImplicitUsageProvider`「本仓没有可见面」**不成立** —— 词法子集在 `src/junitImplicitUsage.ts`，消费点 `src/annotatorHighlights.ts:118`（`unusedSymbol` 抑制）与 `:262`（注册 EP）；② `ExpectedExceptionNeverThrown`/`JUnitAssertEqualsOnArray`/`MayBeAssertSame`（无类型系统/数据流宿主）与四条整代转换器、两个 Merger 确实做不到 ⇒ 逐类改判 `[-]`；③ `kotlin-tests-shared/test/**` 三类上游测试源码被机械信号漏降 ⇒ 改判 `[-]`。
- `exec/testframework`：XML 写盘仍被白名单挡住（`native/export_file.hpp:29` 只有 `.html`/`.htm`/`.txt`，见 §5）；`UserTemplate`（XSL）仍缺；历史导入消费点三处全接（`TestRunnerPanel.vue:456/:473/:641`，判据已绿）。
- `exec/sm-runner`：「没有 socket 服务」**成立** —— `native/` 只有 DAP 客户端与 `CreatePipe` 管道，无监听/接受连接（`dap_shaping.hpp:5` 只一句注释）。
- `presence` 两行：`Filter.java` 的「真实代码」是**名字碰撞**（`settingsTreeMeta.ts:10` 图标名 + `filterDiscovered` 等普通词），真实落点是 `src/testResultFilter.ts` 七谓词 + `src/testNavigation.ts:isDefectiveLeaf`；组合子本体（`Filter.java:29-37`）未落且无第二消费者，不为对齐形状造层。`Printable.java` 是注释同名词（`BinaryViewer.vue:42`）。

**B. 两处按本仓架构补齐**（都是判词点名的缺口）
- `super.tearDown()` 规则：`src/junitInspections.ts` 的 `superTearDownProblems`（接收者 `super`／方法名 `tearDown`／不在 finally／方法里还有别的调用，照 `JUnit3SuperTearDownInspection.kt:34-56`；文案照 `JUnitBundle.properties:107-108`）+ 说明进 `src/inspectionDescription.ts`；两条降级点（`isJUnit3InScope` 按 `extends TestCase`、`isInFinallyBlock` 按花括号配平+块头词跟踪）写在规则头。
- TestNG 三开关：`src/testng.ts` 的 `testngParameterArguments`（`-d` 仅目录非空、`-usedefaultlisteners` 无条件且默认 `TestData.java:53`=false、`-listener` 以 `;` 连接，照 `TestNGRunnableState.java:109-120`）。

## 2. 落点文件（diff 规模）

`src/testng.ts`(40) · `src/junitInspections.ts`(118) · `src/inspectionDescription.ts`(9) · `tests/testng.test.mjs`(30) · `tests/junit-inspections.test.mjs`(85) · `scripts/verdict_table.py`(56：四族判词追加 `2026-10-08 lane exec-test：…` + `OVERRIDES` 逐类 29 条)；生成物 `docs/inventory/execution_verdict_table.{json,md}`、`docs/inventory/verdict-execution.md`。未动禁改文件、未动 native、未 commit。

## 3. 判据与条数（做了反向验证）

- `tests/testng.test.mjs` **8/8 绿**：新增「三个 CLI 开关按上游的门控拼」（6 组断言）；两条既有主类命令断言改成含 `-usedefaultlisteners false`（**收紧**，非放宽）。
- `tests/junit-inspections.test.mjs` **11/11 绿**：新增 3 条（报的那档含行/列/文案正则；不报的 5 档含 finally 嵌套块与 catch；说明表条目）。
- 反向验证：`DEFAULT_USE_DEFAULT_LISTENERS` 改 true → testng **2 条红**；`inFinallyBlock` 恒 false → junit-inspections **1 条红**；已恢复并复读。

## 4. 门禁实测读数

| 命令 | 读数 |
|---|---|
| `node --test tests/test-runner.test.mjs` | 12 / pass 12 / fail 0 |
| `node --test tests/testng.test.mjs tests/junit-inspections.test.mjs tests/junit-rules.test.mjs tests/inspection-description.test.mjs` | 40 / pass 40 / fail 0 |
| 批① `test-runner`+`testng`+`junit-{inspections,rules,patterns,scope,rerun-failed-scope,stacktrace-navigation}` | 80 / pass 80 / fail 0 |
| 批② `assertion-view` `test-event-channel` `test-import` `test-locator` `test-navigation` `test-tree-view` `test-result-filter` `test-results-export` `test-results-xml` `affected-tests` `junit-parameters` `local-intentions` | 106 / pass 106 / fail 0 |
| `node --test tests/module-size.test.mjs` | 5 / pass 5 / fail 0（新逻辑进既有文件，未抬上限） |
| `node --test tests/verdict-generated.test.mjs` | 5 / pass 5 / fail 0 |
| `npx vue-tsc --noEmit` | exit 0 / 0 error（首跑曾有 2 条在 `RunConfigurationsDialog.vue`，是别的 lane 编辑中的瞬时态，其修好后复跑 0） |
| `python scripts/verdict_table.py execution --check` | 一致 3 / 3 条产物 |

## 5. 族档位与计数变化

四族档位**不变**（都有真实落点，`~`）；`[~]` 917→**901**、`[-]` 617→**633**、total 1608 不变 —— 16 行 junit-inspection 检查器本体改判 `[-]`，另 13 行 `~` 改为 `OVERRIDES` 逐类点名（不吃族档背书）。

## 6. 仍缺什么 / 接线清单

- 仍缺：TestNG 三页配置界面、测试发现索引、创建测试、注解引用导航；`ExpectedExceptionNeverThrown`／`JUnitAssertEqualsOnArray`／`MayBeAssertSame`／四个整代转换器 + 两 Merger／`naming` 两条短名读不到；XML 落盘与 `UserTemplate`；`Filter` 组合子；`TestListenerProtocol` 的 socket 数据面。
- 接线（只写改法，未动）：`native/export_file.hpp:29` 的 `kAllowedExtensions` 加 `".xml"`，并同步 `src/htmlExport.ts`/`src/errorTree.ts` 的提示（该文件注释要求）；需 native 重建 + `ctest`。接上后 XML 档可从剪贴板换成落盘（`src/testResultsExport.ts` 的校验已就绪）。其余无需接线：两次补齐都落在既有模块内，面板/问题面板/Alt+Enter 已是真消费链。
