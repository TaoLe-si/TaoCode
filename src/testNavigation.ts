// exec/testframework：**失败导航 + 定位到测试源码**（上游
// `platform/testRunner/src/com/intellij/execution/testframework/FailedTestsNavigator.java`
// 与 `actions/ScrollToTestSourceAction.java` / `actions/ScrollToRunningTestAction.java`）。
//
// 上游依据：
//   · `FailedTestsNavigator.java:18` 实现 `OccurenceNavigator`（工具条上的「上一个/下一个失败」）；
//     `:93-116` 是它的算法：把树上所有节点**前序**拍平（`collectTests`），用
//     `Filter.DEFECTIVE_LEAF`（`Filter.java:99-108`：**缺陷叶子** —— 叶子节点本身是缺陷就收，
//     有缺陷子节点的 suite 不收）挑出失败集；从当前选中位置往后找第一个缺陷
//     （`findNextDefect`，:131-138）；若它就是当前选中项，则在失败集里**再走一格**
//     （否则点两次不动），到头就停 —— `NextFailedTestInfo` 的 `nextIndex=+1`/`bound=count-1`
//     与 `PreviousFailedTestInfo` 的 `nextIndex=-1`/`bound=0`（:153-175）；
//     返回的 `OccurenceInfo` 带 `getOpenFileDescriptor`（跳到失败处的源码）与「第 n 个 / 共 m 个」。
//   · 动作名取自 `platform/execution/resources/messages/ExecutionBundle.properties:128-129`
//     （`Next Failed Test` / `Previous Failed Test`）；
//   · `ScrollToTestSourceAction.java:26-46` —— 「在编辑器里打开选中的测试」是一个
//     `TestConsoleProperties.SCROLL_TO_SOURCE` 开关（恒可见、有模型才可用）；
//     `ScrollToRunningTestAction.java:20-56` —— 「滚动到运行中的测试」只在
//     `TRACK_RUNNING_TEST` 开着时可见，且运行中才可用。
//
// 本仓的等价物：`FailedTestsNavigator`（前序 + 缺陷叶子 + 同样的到头规则）、
// `testSourceTarget`（locationHint → `path:line`）、`runningTestNode`（树里在跑的那个）。
// 消费点：`src/components/TestRunnerPanel.vue` 的「上一个/下一个失败」与「跟随运行中测试」，
// 判据 `tests/test-navigation.test.mjs`。
import type { TestTreeNode } from './testTree.ts'

/** 上游动作名（ExecutionBundle.properties:128-129），本仓的 `title`/`aria-label` 用同一句话。 */
export const NEXT_FAILED_TEST_NAME = 'Next Failed Test'
export const PREVIOUS_FAILED_TEST_NAME = 'Previous Failed Test'
export const SCROLL_TO_RUNNING_TEST_NAME = 'Scroll to Running Test'
// 「跟随运行中的测试」这一档的两个开关与那个定位动作，逐字取自上游：
//   · `platform/execution/resources/messages/ExecutionBundle.properties:142` = `Scroll to Running Test`
//     （动作本体 `platform/testRunner/src/com/intellij/execution/testframework/actions/ScrollToRunningTestAction.java:20-23`）
//   · `platform/execution/resources/messages/ExecutionBundle.properties:141` / `:153` —— `Track Running Test`
//     （`platform/testRunner/src/com/intellij/execution/testframework/ToolbarPanel.java:162-164` 把它挂成
//     `TestConsoleProperties.TRACK_RUNNING_TEST`，`platform/testRunner/src/com/intellij/execution/testframework/TestConsoleProperties.java:50` 默认 **true**）
//   · `platform/platform-api/resources/messages/UIBundle.properties:23` = `Navigate with Single Click`
//     （`platform/testRunner/src/com/intellij/execution/testframework/actions/ScrollToTestSourceAction.java:28-29`
//     用的名字，挂在 `TestConsoleProperties.SCROLL_TO_SOURCE`（同一文件 `:53`）上，默认 **false**）；
//     `platform/execution/resources/messages/ExecutionBundle.properties:169` = `Open selected test in editor` 是它的描述。
export const TRACK_RUNNING_TEST_NAME = 'Track Running Test'
export const TRACK_RUNNING_TEST_DESCRIPTION = 'Select the currently running test in the tree'
export const NAVIGATE_WITH_SINGLE_CLICK_NAME = 'Navigate with Single Click'
export const NAVIGATE_WITH_SINGLE_CLICK_DESCRIPTION = 'Open selected test in editor'
/** 上游 `ScrollToRunningTestAction.java:20-23` + `:28-33`：只有开着跟踪才可见，运行中才可用。 */
export const SCROLL_TO_RUNNING_TEST_DESCRIPTION = 'Select the currently running test and resume tracking it'
/**
 * 上游的进度文案（`platform/platform-impl/.../OccurenceNavigatorActionBase.java:73-77`
 * → `IdeBundle` 的 `message.occurrence.N.of.M`），本仓在面板里原样显示「第 n / 共 m 个」。
 */
export function occurrenceInfo(target: DefectTarget): string {
  return `${target.number} / ${target.count}`
}

export interface DefectTarget { id: string; number: number; count: number }

/** 树的**前序**拍平（`FailedTestsNavigator.collectTests`，:118-128）。 */
export function flattenTree(nodes: readonly TestTreeNode[]): TestTreeNode[] {
  const out: TestTreeNode[] = []
  const walk = (list: readonly TestTreeNode[]) => { for (const node of list) { out.push(node); walk(node.children) } }
  walk(nodes)
  return out
}

/** `Filter.DEFECTIVE_LEAF` 的文本版：失败叶子；有失败子节点的 suite 不算一个失败项。 */
export function isDefectiveLeaf(node: TestTreeNode): boolean {
  if (node.kind === 'test') return node.outcome === 'failed'
  return node.children.every(child => child.outcome !== 'failed')
}

function findNext(order: readonly TestTreeNode[], from: number, direction: 1 | -1): string | null {
  for (let i = from + direction; i >= 0 && i < order.length; i += direction) if (isDefectiveLeaf(order[i]!)) return order[i]!.id
  return null
}

/**
 * 「下一个失败」。`selected` 为空（还没选中任何行）时给第一个失败；
 * 当前选中项本身是失败时按上游多走一格；已经是最后一个失败则停住不动。
 */
export function nextFailedTest(nodes: readonly TestTreeNode[], selected?: string | null): DefectTarget | null {
  const order = flattenTree(nodes)
  const defects = order.filter(isDefectiveLeaf)
  if (!defects.length) return null
  const at = selected ? order.findIndex(node => node.id === selected) : -1
  if (at < 0) return { id: defects[0]!.id, number: 1, count: defects.length }
  const scan = findNext(order, at, 1)
  if (scan === null) return null
  if (scan !== selected) return targetOf(defects, scan)
  const index = defects.findIndex(node => node.id === scan)
  if (index < 0 || index === defects.length - 1) return null
  return targetOf(defects, defects[index + 1]!.id)
}

/** 「上一个失败」：`nextIndex=-1`、`bound=0`（上游 `PreviousFailedTestInfo`，:165-175）。 */
export function previousFailedTest(nodes: readonly TestTreeNode[], selected?: string | null): DefectTarget | null {
  const order = flattenTree(nodes)
  const defects = order.filter(isDefectiveLeaf)
  if (!defects.length) return null
  const at = selected ? order.findIndex(node => node.id === selected) : -1
  if (at < 0) return { id: defects[defects.length - 1]!.id, number: defects.length, count: defects.length }
  const scan = findNext(order, at, -1)
  if (scan === null) return null
  if (scan !== selected) return targetOf(defects, scan)
  const index = defects.findIndex(node => node.id === scan)
  if (index <= 0) return null
  return targetOf(defects, defects[index - 1]!.id)
}

function targetOf(defects: readonly TestTreeNode[], id: string): DefectTarget {
  return { id, number: defects.findIndex(node => node.id === id) + 1, count: defects.length }
}

/** 树里在跑的节点（`ScrollToRunningTestAction` 的 `scrollToRunningTest` 的可见前提）。 */
export function runningTestNode(nodes: readonly TestTreeNode[]): TestTreeNode | null {
  return flattenTree(nodes).find(node => node.kind === 'test' && node.running) ?? null
}

/**
 * `locationHint`（`Foo.java:12`）→ 可跳转目标。取不到就返回 null（面板据此不跳，不臆造）。
 * `ScrollToTestSourceAction` 的可见性/可用性由调用方按模型是否有节点决定。
 */
export function testSourceTarget(location: string | null | undefined): { path: string; line: number } | null {
  if (!location) return null
  const match = /^(.*?\.[A-Za-z0-9_]+):(\d+)(?::\d+)?$/.exec(location.trim())
  if (!match) return null
  return { path: match[1]!.replace(/\\/g, '/'), line: Math.max(1, Number(match[2])) }
}

/**
 * `TRACK_RUNNING_TEST` + `SCROLL_TO_SOURCE` 两个开关合并成一档（面板的「跟随运行中测试」）。
 * 位置解析默认只认本仓通道的 `file:line`；调用方（面板）传定位器链
 * （`src/testLocator.ts` 的 `firstTestLocation`）就能连导入的 XML 里
 * `java:test://类/方法` 这种 URL 位置一起跟上。
 */
export function autoScrollTarget(nodes: readonly TestTreeNode[], track: boolean,
  resolve: (location: string | null) => { path: string; line: number } | null = testSourceTarget): { path: string; line: number } | null {
  if (!track) return null
  const running = runningTestNode(nodes)
  return running ? resolve(running.location) : null
}
