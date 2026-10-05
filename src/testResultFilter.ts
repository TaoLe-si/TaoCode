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
