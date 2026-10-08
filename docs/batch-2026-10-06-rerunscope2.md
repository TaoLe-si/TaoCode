# 批次 2026-10-06 · rerunscope2 — 「重跑失败项」取集口径对齐上游默认档

上游参考树：`D:\Backup\Downloads\intellij-community-master\intellij-community-master`（唯一可用）
本仓 `third_party/intellij-community` = 坏树，不作证据。
继承账本：`docs/batch-2026-10-06-junit2.md`（堆栈定位 + 重跑集已落，本批**不推翻**，只补它没做完的那一条）。

范围：**只做一件事** —— 「重跑失败项」的取集口径对齐上游默认档
（上游 `includeNonStarted=true` ⇒ `NOT_PASSED.or(FAILED_OR_INTERRUPTED).and(¬IGNORED)` 再 `and(LEAF)`）。

## 0. 现场账（先读后写，磁盘实测）

落点文件 mtime（`ls --time-style` 实测）与 git 状态：

| 文件 | mtime | git |
|---|---|---|
| `src/testResultFilter.ts` | 2026-10-06_15:43 | ` M` |
| `src/testTree.ts` | 2026-10-06_15:38 | ` M` |
| `src/components/TestRunnerPanel.vue` | 2026-10-06_15:43 | ` M` |
| `src/testRunner.ts` | 2026-10-05_00:04 | 干净（junit2 没动它） |
| `tests/junit-rerun-failed-scope.test.mjs` | 2026-10-06_15:41 | `??`（新增未跟踪） |

junit2 §2b 声称的四处**都在盘上**，逐条对到行：
`src/testResultFilter.ts:148`（`DEFAULT_INCLUDE_NON_STARTED = true`）、`:150`（`INCLUDE_NON_STARTED_NAME`）、
`:152-173`（`RerunFailureFilter` / `RerunCandidate` / `rerunFailureAccepted` / `rerunFailureNames`）、
`src/testTree.ts:288-296`（`notFinished()`）、`src/components/TestRunnerPanel.vue:181-197`（`rerunFilter` /
`rerunNames` = `[...done, ...stuck]` 过 `rerunFailureNames`）+ `:516-517`（按钮的 `disabled` 与计数跟重跑集）+
`:527-528`（工具栏那条 `INCLUDE_NON_STARTED_NAME` 开关）、判据 7 条在 `tests/junit-rerun-failed-scope.test.mjs`。

⇒ **「本仓 `rerunFailed` 只把 `outcome==='failed'` 的名字交出去」这句在盘上已不成立** —— 那是 junit2 `docs/batch-2026-10-06-junit2.md:27`
（§1 表 #2）**改前**现状列的文字，同批 §2b 已按上游还原（`:55-57`、§3 探针 A 自证默认档）。本批**不推翻这条账**，只补它没覆盖到的那一支。

**真正的残余缺口（本批的活）**：上游默认档里 `NOT_PASSED` 的 **NOT_RUN / RUNNING 那一支（压根没跑起来的类）在本仓不可达**。三处实证：

1. `src/testResultFilter.ts:163` 把上游 `Filter.LEAF` 翻成 `if (row.kind !== 'test') return false`；
   上游 `platform/smRunner/src/com/intellij/execution/testframework/sm/runner/SMTestProxy.java:238-240` 的
   `isLeaf()` 是 `myChildren == null || myChildren.isEmpty()` ⇒ **没有孩子的 suite 本身就是叶子**，
   正是 LEAF 要**留下**的那一条，被本仓这句按 `kind` 一刀切误杀（见 §1③）。
2. `src/testTree.ts:288-296` 的 `notFinished()` 只遍历 `this.started`（只有 `testStarted` 才登记，`:163`）
   ⇒ 「只报过 `suiteStarted`」的类**连取数处都没有**。
3. 后果（用户可见）：类加载即崩 / JVM 在第一条 `testStarted` 之前死掉 / 导入的 XML 里 `<suite>` 没有 `<test>`
   且没闭合（`src/testImport.ts:241`/`:269` 会报 `suiteStarted`）⇒ 重跑集为空 ⇒
   `TestRunnerPanel.vue:516` 的 `:disabled="running || !rerunNames.length"` 让「重跑失败项」**点不动**；
   上游同一次运行里那个类会被一起重跑（属性名里的 "Non-Started" 就是指它）。

## 1. 上游核实（四问，坐标全部本次自开；`third_party/intellij-community` 坏树未用）

### ① `NOT_PASSED` 到底是哪几档的并集
- `platform/testRunner/src/com/intellij/execution/testframework/Filter.java:64-69` —— `NOT_PASSED` 不是并集，是**一条取补**：`!test.isPassed()`。
- `platform/smRunner/.../SMTestProxy.java:279-283` —— `isPassed()` = magnitude ∈ {`SKIPPED_INDEX`, `COMPLETE_INDEX`, `PASSED_INDEX`}。
- `platform/lang-api/src/com/intellij/execution/testframework/sm/runner/states/TestStateInfo.java:61-70` —— Magnitude 全集共 9 个声明：
  `SKIPPED_INDEX(0,1)`、`COMPLETE_INDEX(1,3)`、`NOT_RUN_INDEX(2,0)`、`RUNNING_INDEX(3,7)`、`TERMINATED_INDEX(4,6)`、
  `IGNORED_INDEX(5,2)`、`FAILED_INDEX(6,4)`、`ERROR_INDEX(8,5)`、`PASSED_INDEX(COMPLETE_INDEX.getValue(), …)`
  ⇒ **`PASSED_INDEX` 的 value 就是 `COMPLETE_INDEX` 的 1（别名）**，判 `==PASSED_INDEX` 与 `==COMPLETE_INDEX` 是同一件事。
- 补集 ⇒ `NOT_PASSED` = **`{NOT_RUN, RUNNING, TERMINATED, IGNORED, FAILED, ERROR}` 六档**（不是「失败 ∪ 中断」那么窄）。
  状态出处：`states/NotRunState.java:48-50`（NOT_RUN）、`states/TestInProgressState.java:57-59`（RUNNING）、
  `states/TerminatedState.java:53-55`（TERMINATED）、`states/TestIgnoredState.java:53-55`（IGNORED）。
- `Filter.java:85-90` `FAILED_OR_INTERRUPTED` = `isInterrupted()`（`SMTestProxy.java:257-259` = `myState.wasTerminated()`）∨ `isDefect()`（`:188-190`）
  ⇒ 它是 `NOT_PASSED` 的**子集**（FAILED/ERROR/TERMINATED 都不算 passed），所以 `AbstractRerunFailedTestsAction.java:138`
  那句 `.or(FAILED_OR_INTERRUPTED)` 在开档下是**冗余**（只在关档 `:140` 里是唯一来源）。
- 候选池：`AbstractRerunFailedTestsAction.java:111`（isActive）与 `:124`（getFailedTests）判的都是
  `model.getRoot().getAllTests()`，而 `SMTestProxy.java:438-448` 的 `getAllTests()` 是「**先 add 自己，再递归 add 全部后代**」
  ⇒ suite 节点也在池里，LEAF 不是摆设（见③）。

### ② `IGNORED` 为什么要排除、排除后行为差在哪
- 关键是 ①里那条不对称：`isPassed()` 的集合**含 `SKIPPED_INDEX`、不含 `IGNORED_INDEX`**（`SMTestProxy.java:280-282` 对比 `TestStateInfo.java:67`）
  ⇒ 光靠 `NOT_PASSED` 会把 `@Ignore`/`@Disabled` 的用例（`states/TestIgnoredState.java:53-55` = IGNORED）**一并扫进重跑集**。
  `Filter.IGNORED`（`Filter.java:57-62`）经 `not()`（`:31`，NotFilter 在 `:140`）就是挡它的唯一一道。
- 行为差：
  · **开档**（`:138`）差得最多 —— 没有这道 `IGNORED.not()`，被忽略的方法会进 `TestMethods`
    （`plugins/junit/src/com/intellij/execution/junit2/ui/actions/RerunFailedTestsAction.java:29-50`），
    明知用户禁用了还去跑一遍，跑出来仍是 ignored ⇒ 白跑 + 结果计数被改动。
  · **关档**（`:140`）差得几乎没有 —— `FAILED_OR_INTERRUPTED` 本身不含 IGNORED（isDefect/wasTerminated 都不是 ignored），
    所以那条 `.and(IGNORED.not())` 是**一致性写法 / 不变式**，不是必要分支。上游两档都写，就是把它当不变式。
- 本仓映射：`src/testResultFilter.ts:164` 用 `outcome === 'skipped'` 一条同时挡住上游的 IGNORED 与 SKIPPED
  （本仓结果只有 `passed|failed|skipped` 三档，`src/testRunner.ts:77`）⇒ **同结果、不同来源**，登记为口径合并，不改。

### ③ `LEAF` 过滤在「套件下只有一个失败测试」这种形状上改变了什么
- `java/execution/impl/src/com/intellij/execution/actions/JavaRerunFailedTestsAction.java:22-30`：在基类过滤器上再 `and` 一条
  `shouldAccept = test.isLeaf()`；`isLeaf()` = `myChildren == null || myChildren.isEmpty()`（`SMTestProxy.java:238-240`）。
- **套件下只有一个失败测试**（`MathTest` 有 1 个孩子 `adds`，失败）：
  那个 suite 自己也是 `NOT_PASSED` —— 跑动中是 `SuiteInProgressState`（`states/SuiteInProgressState.java:13` 继承
  `TestInProgressState`，magnitude = RUNNING，`states/TestInProgressState.java:57-59`），跑完是 `FAILED_SUITE`
  （`states/SuiteFinishedState.java:37-45` magnitude FAILED_INDEX），两个都不在 `isPassed()` 的集合里；
  而 ①已证 `getAllTests()` 把 suite 也交给过滤器 ⇒ **没有 LEAF 时重跑集同时含 `MathTest` 与 `MathTest.adds`**，
  JUnit 那支把集合交给 `TestMethods`（`junit2/ui/actions/RerunFailedTestsAction.java:29-50`），收到类名就整类跑
  ⇒ 重跑范围从「那一条方法」放大成「整个类」。**LEAF 改变的就是这件事**：挡掉「有孩子的节点」，只留方法。
- **反过来**（本批的缺口）：一条孩子都没有的 suite（类被 `testSuiteStarted` 报出来，却没有任何 `testStarted`）在 LEAF 眼里
  **就是叶子**（`myChildren == null`）：只报过 suiteStarted 时状态是 `SMTestProxy.setSuiteStarted():474-482` 给的
  `SuiteInProgressState` ⇒ RUNNING ⇒ `NOT_PASSED ∧ ¬IGNORED ∧ LEAF` 三条全过 ⇒ **进重跑集**。这才是属性名里 "Non-Started" 的正身。
- **但「没有孩子」不等于「一定进」**：闭合了的空 suite 走 `SuiteFinishedState.EMPTY_SUITE`
  （`states/SuiteFinishedState.java:94`，实现 `:140-143` 的 `EmptySuite.getMagnitude() = COMPLETE_INDEX`）
  ⇒ `isPassed()` 为真 ⇒ **不进**重跑集。⇒ 本仓新增的取数处必须**同时排掉已闭合（报过 `suiteFinished`）的空 suite**，
  否则会把「跑完了但本来就没有测试」的类当失败重跑 —— 那是比原缺口更糟的过度重跑。

### ④ 该开关在 JUnit 工具栏真可见吗（结论：真可见；本批**不加控件**）
- `platform/testRunner/src/com/intellij/execution/testframework/TestConsoleProperties.java:224-226`
  `createIncludeNonStartedInRerun(target)` 取键 `junit.running.info.include.non.started.in.rerun.failed.action.name`；
- `platform/execution/resources/messages/ExecutionBundle.properties:157`
  = `junit.running.info.include.non.started.in.rerun.failed.action.name=Include Non-Started Tests in Rerun Failed`；
- `plugins/junit/src/com/intellij/execution/junit2/ui/properties/JUnitConsoleProperties.java:46-51`
  —— `:48` `super.appendAdditionalActions(...)`、`:49` `addSeparator()`、`:50` `actionGroup.add(createIncludeNonStartedInRerun(target))`；
  这支 `appendAdditionalActions` 的落点是 `platform/testRunner/src/com/intellij/execution/testframework/ToolbarPanel.java:200`
  的 `secondaryGroup`（同组 `:158` 建，装的都是这类 inverted 属性开关）⇒ **在工具栏的「更多/gear」组里，真用户可见**；
  TestNG 那支同样：`plugins/testng/src/com/theoryinpractice/testng/model/TestNGConsoleProperties.java:46`；
- 默认值 `TestConsoleProperties.java:58` = `new BooleanProperty("includeNonStarted", true)`（会话级属性，不是持久化配置）；
- 动作英文名核对：`platform/platform-resources-en/src/messages/ActionsBundle.properties:1843`
  = `action.RerunFailedTests.text=Rerun Failed Tests`。
- **本仓有没有真配置来源**：上游这条是 `TestConsoleProperties` 上的 `BooleanProperty`（运行会话属性，不落盘）。
  本仓同档的现成落点 = `TestRunnerPanel.vue:181` 的 `rerunFilter = ref({ ...DEFAULT_RERUN_FAILURE_FILTER })`
  （会话内状态，与显示过滤器/排序/跟踪开关同一口径，junit2 §2b 已记「没有新键」）。
  ⇒ **本批不加任何新控件**，沿用那一条开关（判据里钉「`@click="toggleRerunFilter"` 全仓只有一处」防重复控件）。

## 2. 实现
- （待 §1 结论 + §0 缺口确定后追加）

## 3. 判据与反向验证（前缀 `RERUNSCOPE2`）
- [ ] 前提断言钉夹具形状（防空过）
- [ ] 注入 → 红 → 还原 → sha1 → grep 0 残留
- （逐块追加）

## 4. 门禁原始数字
- （收工后追加）

## 5. 无法核实 / 订正留痕 / 遗留
- （逐块追加）
