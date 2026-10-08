// exec/testframework / exec/filters：结果树的**显示过滤器**（上游 `Filter` 一族 +
// `TestFrameworkActions.installFilterAction`）。
//
// 上游依据：
//   · `platform/testRunner/src/com/intellij/execution/testframework/Filter.java:38-90`
//     —— 谓词本体：`NO_FILTER`（:38-43）、`DEFECT`（:45-50，`test.isDefect()`）、
//     `IGNORED`（:52-57）、`NOT_PASSED`（:59-64）、`PASSED`（:66-71）、
//     `HAS_PASSED`（:73-78，`hasPassedTests()` ⇒ 子树里有通过的）、
//     `FAILED_OR_INTERRUPTED`（:80-85）；`:29-37` 的 `not/and/or` 组合子。
//   · `platform/testRunner/src/com/intellij/execution/testframework/actions/TestFrameworkActions.java:28-41`
//     —— 三个开关怎么合成一条过滤器（**逐分支照抄**）：
//       `hidePassed  ? NOT_PASSED.or(DEFECT) : NO_FILTER`
//       `hideIgnored ? (hidePassed ? IGNORED.not() : IGNORED.not().or(HAS_PASSED)) : NO_FILTER`
//       `hideConfig  ? HIDE_SUCCESSFUL_CONFIGS : NO_FILTER`
//       最后 `.and().and()` 串起来。
//     `platform/testRunner/src/com/intellij/execution/testframework/actions/TestFrameworkActions.java:15-25`
//     的 `installFilterAction`：开关一变就 `model.setFilter(getFilter(properties))`，
//     也就是**重算整棵树的可见性**，不是重新跑测试。
//   · 开关的默认值与文案：
//     `platform/testRunner/src/com/intellij/execution/testframework/TestConsoleProperties.java:51`
//     `hideIgnoredTests` 默认 **false**、`:52` `hidePassedTests` 默认 **true**、`:59` `hideConfig` 默认 **false**；
//     但 Java 测试框架在 `java/execution/impl/src/com/intellij/execution/JavaTestFrameworkRunnableState.java:322`
//     用 `setIfUndefined(HIDE_PASSED_TESTS, false)` 把「隐藏通过的」对 Java 运行**关掉**了
//     —— 本仓的测试面板只跑 Java/JS/CMake 测试，所以采用这条更具体的默认（显示通过的）。
//     按钮文案（`platform/testRunner/src/com/intellij/execution/testframework/ToolbarPanel.java:58-66`
//     用的是 **inverted** 布尔属性，名字是「显示」而不是「隐藏」）：
//       `platform/execution/resources/messages/ExecutionBundle.properties:139` = `Show Passed`、
//       `:140` = `Show passed tests`；
//       `platform/testRunner/resources/messages/TestRunnerBundle.properties:49` = `Show Ignored`、
//       `:48` = `Show ignored`。
//
// 架构不等价的落点：上游过滤器作用在 `AbstractTestProxy` 树上（Swing 的 `DynamicTree` 每层
// 问一次 `shouldAccept`）。本仓的树是 `src/testTree.ts` 的 `TestTreeNode[]`（纯数据），
// 所以这里是**纯函数**：`nodeAccepted` 复刻三个开关的合成，`filterTestTree` 递归产出可见树。
// 消费点：`src/components/TestRunnerPanel.vue` 的「显示通过的 / 显示跳过的」两个开关。
// 判据 `tests/test-result-filter.test.mjs`。
//
// 没做的第三条开关（`Hide Successful setUp/tearDown`）不是漏写，是**没有落点**：
// 那条判据的前提是树里有 config 节点（`proxy.isConfig()`），而本仓的通道行协议
// （`src/testEventChannel.ts` 的 `TestEvent`）与发现结果都不携带 config/setUp 这一层 ——
// 上游的 config 节点由 runner 侧的 `<test isConfig="true">`
// （`platform/smRunner/src/com/intellij/execution/testframework/sm/runner/history/ImportedTestContentHandler.java:52-68`）
// 或 `SMTestRunnerEventsExporter` 给出，本仓没有真实 JUnit runner 的事件源可问，
// 造出来的只会是假节点。⇒ 见 `docs/wiring-requests-2026-10-06-bucket11b.md`。
import type { TestTreeNode } from './testTree.ts'

/** 上游 `ExecutionBundle.properties:139-140`（inverted 属性，所以文案是「显示」）。 */
export const SHOW_PASSED_NAME = 'Show Passed'
export const SHOW_PASSED_DESCRIPTION = 'Show passed tests'
/** 上游 `TestRunnerBundle.properties:49-48`。 */
export const SHOW_IGNORED_NAME = 'Show Ignored'
export const SHOW_IGNORED_DESCRIPTION = 'Show ignored'

/** 三个开关的合成结果（本仓只有两条有落点，见文件头）。 */
export interface TestDisplayFilter {
  /** `TestConsoleProperties.HIDE_PASSED_TESTS` 的反面（`:52` 默认隐藏，Java 运行 `setIfUndefined(false)` ⇒ 显示）。 */
  showPassed: boolean
  /** `TestConsoleProperties.HIDE_IGNORED_TEST` 的反面（`:51` 默认 **false** = 不隐藏 ⇒ 显示）。 */
  showIgnored: boolean
}

/** 上游 `JavaTestFrameworkRunnableState.java:322` 把 `HIDE_PASSED_TESTS` 设成 false，
 *  而 `TestConsoleProperties.java:51` 的 `HIDE_IGNORED_TEST` 本来就是 false ⇒ Java 运行两条都不隐藏。 */
export const DEFAULT_DISPLAY_FILTER: TestDisplayFilter = { showPassed: true, showIgnored: true }

/** 上游 `Filter.IGNORED`：本仓的 skipped 就是 ignored（跳过的/被忽略的同一档结果）。 */
const isIgnored = (node: TestTreeNode): boolean => node.outcome === 'skipped'
/** 上游 `Filter.PASSED` / `NOT_PASSED`。null（还没结果）不算通过。 */
const isPassed = (node: TestTreeNode): boolean => node.outcome === 'passed'
const isNotPassed = (node: TestTreeNode): boolean => !isPassed(node)
/** 上游 `Filter.DEFECT`（`AbstractTestProxy.isDefect()`）：本仓的结果只有 failed 是缺陷。 */
const isDefect = (node: TestTreeNode): boolean => node.outcome === 'failed'
/** 上游 `Filter.HAS_PASSED`（`hasPassedTests()`）：整棵子树里有通过的。 */
export function hasPassedTests(node: TestTreeNode): boolean {
  for (const child of node.children) if (isPassed(child) || hasPassedTests(child)) return true
  return false
}

/**
 * `TestFrameworkActions.getFilter`（:28-41）的逐分支翻译：先算「隐藏通过的」那半条，
 * 再算「隐藏跳过的」那半条，`and` 起来。
 * `hidePassed` 分支里 `NOT_PASSED.or(DEFECT)` 的字面并集保留着 —— 上游就是这么写的，
 * 一个「不是通过」的节点本来就包含缺陷，但两半各自可能单独被复用。
 */
export function nodeAccepted(node: TestTreeNode, filter: TestDisplayFilter = DEFAULT_DISPLAY_FILTER): boolean {
  const hidePassed = !filter.showPassed
  const hidePassedAccepted = !hidePassed || (isNotPassed(node) || isDefect(node))
  if (!hidePassedAccepted) return false
  const hideIgnored = !filter.showIgnored
  if (!hideIgnored) return true
  // 上游 `:33-37`：隐藏跳过时，「不是跳过的」或「子树里有通过的（suite 因为孩子被留着）」。
  // `hidePassed` 也开着时只用前半条（`IGNORED.not()`），没有 `HAS_PASSED` 的兜底。
  return isIgnored(node) ? (hidePassed ? false : hasPassedTests(node)) : true
}

/** 树可见性 = 自己过 && 孩子过滤后还有（上游对每层各问一次 `shouldAccept`）。 */
export function filterTestTree(nodes: readonly TestTreeNode[], filter: TestDisplayFilter = DEFAULT_DISPLAY_FILTER): TestTreeNode[] {
  const out: TestTreeNode[] = []
  for (const node of nodes) {
    if (!nodeAccepted(node, filter)) continue
    if (node.children.length === 0) { out.push(node); continue }
    const children = filterTestTree(node.children, filter)
    if (children.length) out.push({ ...node, children })
  }
  return out
}

/** 开关的另一半（上游 `DumbAwareToggleInvertedBooleanProperty`）：按钮只管「显示」。 */
export function toggleDisplayFilter(filter: TestDisplayFilter, key: keyof TestDisplayFilter): TestDisplayFilter {
  return { ...filter, [key]: !filter[key] }
}

// --- 「重跑失败项」这一档到底重跑哪些（上游 `AbstractRerunFailedTestsAction.getFailuresFilter`）----
//
// 上游依据（本轮逐条自己开文件，行号按 `grep -n` 的实际输出）：
//   · `platform/testRunner/src/com/intellij/execution/testframework/actions/AbstractRerunFailedTestsAction.java:131-141`
//     —— `getFailuresFilter(consoleProperties)`：`includeNonStarted` 开着时
//     `Filter.NOT_PASSED.or(FAILED_OR_INTERRUPTED).and(IGNORED.not())`（`:138`，Java 的结合顺序是
//     `(NOT_PASSED ∨ FAILED_OR_INTERRUPTED) ∧ ¬IGNORED`）；关着时 `FAILED_OR_INTERRUPTED.and(IGNORED.not())`（`:140`）。
//     判的是 `model.getRoot().getAllTests()`（`:111`、`:124`）——**上一次运行报过的**节点，
//     所以「报了开始却没跑完」的那几条在默认档里会被一起重跑。
//   · `platform/testRunner/src/com/intellij/execution/testframework/TestConsoleProperties.java:58`
//     —— `INCLUDE_NON_STARTED_IN_RERUN_FAILED = new BooleanProperty("includeNonStarted", true)`：默认 **true**。
//   · `java/execution/impl/src/com/intellij/execution/actions/JavaRerunFailedTestsAction.java:22-30`
//     —— Java/JUnit 那支在这条过滤器上再 `and(LEAF)`：`shouldAccept` 只认 `test.isLeaf()` ⇒ suite 不进重跑集。
//   · `plugins/junit/src/com/intellij/execution/junit2/ui/actions/RerunFailedTestsAction.java:29-50`
//     —— `getRunProfile` 把 `getFailedTests(project)`（= 上面那条过滤器的产物）交给 `TestMethods`，
//     即「重跑哪些」完全由那条过滤器决定。
//   · 这条开关**用户可见**（不是本仓自造的控件）：
//     `platform/testRunner/src/com/intellij/execution/testframework/TestConsoleProperties.java:224-226`
//     的 `createIncludeNonStartedInRerun` 取键
//     `platform/execution/resources/messages/ExecutionBundle.properties:157`
//     = `Include Non-Started Tests in Rerun Failed`；
//     `plugins/junit/src/com/intellij/execution/junit2/ui/properties/JUnitConsoleProperties.java:50`
//     在 `appendAdditionalActions` 里真的把它加进工具栏（TestNG 那支同样：
//     `plugins/testng/src/com/theoryinpractice/testng/model/TestNGConsoleProperties.java:46`）。
//
// 本仓的映射（登记清楚，别当成「少写了 interrupted」）：
//   · 上游 `isInterrupted()`（整次运行被打断）与「testStarted 之后没有结束事件」两档，在本仓
//     都是**没有结果行**（`src/testEventChannel.ts:141-144` 的 testStarted 不产出结果）⇒ 统一落在
//     `outcome === null`，取数处 `TestTreeBuilder.notFinished()`；
//   · `Filter.IGNORED` ⇒ 本仓的 `skipped`（与上面 `isIgnored` 同一条口径）。这里有个必须记下来的
//     不对称：上游 `isPassed()`（`platform/smRunner/src/com/intellij/execution/testframework/sm/runner/SMTestProxy.java:279-283`）
//     认 SKIPPED/COMPLETE/PASSED 三档，**不认 IGNORED**（`platform/lang-api/src/com/intellij/execution/testframework/sm/runner/states/TestStateInfo.java:61-70`
//     的 Magnitude 全集里 IGNORED_INDEX 是独立一档）⇒ 光靠 `NOT_PASSED` 会把 `@Ignore`/`@Disabled` 扫进重跑集，
//     `IGNORED.not()` 是挡它的唯一一道（`platform/testRunner/src/com/intellij/execution/testframework/Filter.java:57-62` + `not():31`）；
//   · `Filter.LEAF` ⇒ **不是「`kind === 'test'`」**。上游本体是
//     `platform/smRunner/src/com/intellij/execution/testframework/sm/runner/SMTestProxy.java:238-240`
//     的 `myChildren == null || myChildren.isEmpty()`，也就是「**没有孩子的节点**」，于是：
//       —— 有孩子的 suite（哪怕它自己 NOT_PASSED）被挡掉，重跑集只剩方法；这挡的就是
//          「一个套件下只有一条失败测试」那种形状 —— 不挡的话 JUnit 的 `TestMethods` 收到类名会整类重跑；
//       —— 只报过 `testSuiteStarted`、既没长出测试也还没闭合的 suite（类加载即崩）在这里**就是叶子**，
//          它的状态是 `SMTestProxy.setSuiteStarted():474-482` 给的 SuiteInProgressState
//          （`platform/smRunner/src/com/intellij/execution/testframework/sm/runner/states/SuiteInProgressState.java:13`
//          继承 `.../states/TestInProgressState.java:57-59` 的 RUNNING_INDEX）⇒ 该进默认档，
//          这正是属性名里 "Non-Started" 的正身，取数处 `TestTreeBuilder.notStartedSuites()`；
//       —— **闭合了的空 suite 不算**：`platform/smRunner/src/com/intellij/execution/testframework/sm/runner/states/SuiteFinishedState.java:94`
//          的 EMPTY_SUITE 走 `:140-143` 的 COMPLETE_INDEX ⇒ `isPassed()` 为真 ⇒ NOT_PASSED 就把它挡了。
//     所以判据是「孩子数 = 0」，不是「kind 是不是 test」；拿不准孩子数时按**有孩子**处理（宁少不多）。
// 消费点：`src/components/TestRunnerPanel.vue` 的「失败」按钮与它的工具栏开关。
// 判据 `tests/junit-rerun-failed-scope.test.mjs`。

/** 上游 `TestConsoleProperties.java:58` 的默认值。 */
export const DEFAULT_INCLUDE_NON_STARTED = true
/** 上游 `ExecutionBundle.properties:157` 的原文。 */
export const INCLUDE_NON_STARTED_NAME = 'Include Non-Started Tests in Rerun Failed'

export interface RerunFailureFilter { includeNonStarted: boolean }
export const DEFAULT_RERUN_FAILURE_FILTER: RerunFailureFilter = { includeNonStarted: DEFAULT_INCLUDE_NON_STARTED }

/**
 * 重跑集里的一条候选：需要「有几个孩子 + 结果是什么」两件事。
 * `childCount` 是给 `LEAF` 用的（上游 `SMTestProxy.java:238-240` 判的就是孩子数，不是 kind）；
 * 不填时按保守值取 —— `test` 算 0（本仓的测试节点在 `src/testTree.ts` 的 `build()` 里一律 `children: []`），
 * `suite` 算「有孩子」⇒ 不进重跑集（拿不准就少跑，不多跑）。
 */
export interface RerunCandidate {
  name: string
  kind: 'test' | 'suite'
  outcome: 'passed' | 'failed' | 'skipped' | null
  childCount?: number
}

/** 上游 `Filter.LEAF`：`platform/smRunner/src/com/intellij/execution/testframework/sm/runner/SMTestProxy.java:238-240` 的「孩子数为 0」。 */
export function isRerunLeaf(row: RerunCandidate): boolean {
  return (row.childCount ?? (row.kind === 'test' ? 0 : 1)) === 0
}

/**
 * `getFailuresFilter`（`:131-141`）+ `and(LEAF)`（`JavaRerunFailedTestsAction.java:22-30`）的翻译：
 * 先 `LEAF`（**孩子数为 0**，不是「kind 是不是 test」），再 `¬IGNORED`，最后按开关决定
 * 要不要把「非通过」（NOT_RUN / RUNNING / FAILED 那一支）也算进来。
 */
export function rerunFailureAccepted(row: RerunCandidate, filter: RerunFailureFilter = DEFAULT_RERUN_FAILURE_FILTER): boolean {
  if (!isRerunLeaf(row)) return false
  if (row.outcome === 'skipped') return false
  const defectOrInterrupted = row.outcome === 'failed'
  if (!filter.includeNonStarted) return defectOrInterrupted
  return defectOrInterrupted || row.outcome !== 'passed'
}

/** 重跑集（上游 `getFailedTests:120-125` 的 `select`）：按输入顺序出名字，不重排。 */
export function rerunFailureNames(rows: readonly RerunCandidate[], filter: RerunFailureFilter = DEFAULT_RERUN_FAILURE_FILTER): string[] {
  return rows.filter(row => rerunFailureAccepted(row, filter)).map(row => row.name)
}
