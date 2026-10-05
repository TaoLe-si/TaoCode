// exec/testframework：结果树上的失败导航与「跟随运行中的测试」。
// 上游对照：platform/testRunner/.../FailedTestsNavigator.java:118-128,165-175、
// ScrollToRunningTestAction.java:20-33、ScrollToTestSourceAction.java:28-29、
// TestConsoleProperties.java:50,53、ToolbarPanel.java:162-164、
// ExecutionBundle.properties:141-143,153,169、UIBundle.properties:23。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import {
  NAVIGATE_WITH_SINGLE_CLICK_DESCRIPTION, NAVIGATE_WITH_SINGLE_CLICK_NAME, NEXT_FAILED_TEST_NAME, PREVIOUS_FAILED_TEST_NAME,
  SCROLL_TO_RUNNING_TEST_DESCRIPTION, SCROLL_TO_RUNNING_TEST_NAME, TRACK_RUNNING_TEST_DESCRIPTION, TRACK_RUNNING_TEST_NAME,
  autoScrollTarget, flattenTree, isDefectiveLeaf, nextFailedTest, occurrenceInfo, previousFailedTest, runningTestNode, testSourceTarget,
} from '../src/testNavigation.ts'

/** TestTreeNode 的最小可用形状（src/testTree.ts 的接口，缺一个字段就会掩盖真实判据）。 */
function node(overrides) {
  return {
    id: 'junit:t1', name: 't1', kind: 'test', depth: 1, path: 'S.t1', parent: 'suite:S',
    children: [], outcome: 'passed', counts: { passed: 1, failed: 0, skipped: 0, total: 1 },
    durationMs: 0, location: null, running: false, ...overrides,
  }
}

const TREE = [node({
  id: 'suite:S', name: 'S', kind: 'suite', depth: 0, path: 'S', parent: null,
  outcome: 'failed', running: false,
  children: [
    node({ id: 'junit:S.a', name: 'a', path: 'S.a', outcome: 'failed', location: 'S.java:10' }),
    node({ id: 'junit:S.b', name: 'b', path: 'S.b', outcome: 'passed', location: 'S.java:20' }),
    node({ id: 'junit:S.c', name: 'c', path: 'S.c', outcome: 'failed', location: 'S.java:30' }),
  ],
})]

test('前序拍平与缺陷叶子：失败叶子算，有失败孩子的 suite 不重复算', () => {
  assert.deepEqual(flattenTree(TREE).map(item => item.id), ['suite:S', 'junit:S.a', 'junit:S.b', 'junit:S.c'])
  assert.equal(isDefectiveLeaf(TREE[0]), false, 'suite 聚合了失败 ⇒ 不是一条失败项（上游 DEFECTIVE_LEAF）')
  assert.equal(isDefectiveLeaf(node({ kind: 'suite', outcome: 'passed', children: [] })), true, '没有失败孩子的 suite 算一条')
})

test('下一个 / 上一个失败：没选中给首/末，往后走完就停住', () => {
  assert.equal(nextFailedTest(TREE)?.id, 'junit:S.a')
  assert.equal(previousFailedTest(TREE)?.id, 'junit:S.c')
  assert.deepEqual(nextFailedTest(TREE, 'junit:S.a'), { id: 'junit:S.c', number: 2, count: 2 })
  assert.equal(nextFailedTest(TREE, 'junit:S.c'), null, '最后一个失败之后没有下一个（不回头绕圈）')
  assert.equal(previousFailedTest(TREE, 'junit:S.a'), null, '第一个失败之前没有上一个')
  assert.equal(occurrenceInfo({ id: 'x', number: 2, count: 3 }), '2 / 3')
  assert.equal(nextFailedTest([]), null)
})

test('在跑的节点：只有 test -kind 且 running 才算（ScrollToRunningTestAction 的可用前提）', () => {
  assert.equal(runningTestNode(TREE), null)
  const withRunning = [node({
    id: 'suite:S', name: 'S', kind: 'suite', depth: 0, path: 'S', parent: null, outcome: null,
    children: [node({ id: 'junit:S.b', name: 'b', path: 'S.b', outcome: null, running: true, location: 'S.java:20' })],
  })]
  assert.equal(runningTestNode(withRunning)?.id, 'junit:S.b')
  // suite 的 running 聚合不算（上游只滚到正在执行的那个**测试**）。
  assert.equal(runningTestNode([node({ id: 'suite:X', name: 'X', kind: 'suite', path: 'X', running: true, children: [] })]), null)
})

test('跟随目标：开关关着不给目标；file:line 自己解，URL 位置由调用方注入的定位器解', () => {
  const running = [node({
    id: 'suite:S', name: 'S', kind: 'suite', depth: 0, path: 'S', parent: null, outcome: null,
    children: [node({ id: 'junit:S.b', name: 'b', path: 'S.b', outcome: null, running: true, location: 'java:test://com.foo.S/b' })],
  })]
  assert.equal(autoScrollTarget(running, false), null, 'SCROLL_TO_SOURCE 关着（上游默认 false）就不开编辑器')
  // 默认解析器只认本仓通道的 file:line：URL 位置解不出 ⇒ null，不臆造目标。
  assert.equal(autoScrollTarget(running, true), null)
  assert.deepEqual(testSourceTarget('S.java:12'), { path: 'S.java', line: 12 })
  assert.equal(testSourceTarget(null), null)
  // 面板传进来的定位器链让导入 XML 的 URL 位置也跟得上。
  const located = autoScrollTarget(running, true, location => (location === 'java:test://com.foo.S/b' ? { path: 'src/S.java', line: 44 } : null))
  assert.deepEqual(located, { path: 'src/S.java', line: 44 })
})

test('动作文案逐字取自上游 bundle（不是自己编的）', () => {
  assert.equal(NEXT_FAILED_TEST_NAME, 'Next Failed Test')
  assert.equal(PREVIOUS_FAILED_TEST_NAME, 'Previous Failed Test')
  // ExecutionBundle.properties:142 / :143
  assert.equal(SCROLL_TO_RUNNING_TEST_NAME, 'Scroll to Running Test')
  assert.equal(SCROLL_TO_RUNNING_TEST_DESCRIPTION, 'Select the currently running test and resume tracking it')
  // ExecutionBundle.properties:141 / :153
  assert.equal(TRACK_RUNNING_TEST_NAME, 'Track Running Test')
  assert.equal(TRACK_RUNNING_TEST_DESCRIPTION, 'Select the currently running test in the tree')
  // UIBundle.properties:23 + ExecutionBundle.properties:169
  assert.equal(NAVIGATE_WITH_SINGLE_CLICK_NAME, 'Navigate with Single Click')
  assert.equal(NAVIGATE_WITH_SINGLE_CLICK_DESCRIPTION, 'Open selected test in editor')
})

test('接线：面板真的跟着运行中的测试走（不是只躺在模块里）', () => {
  const source = readFileSync(new URL('../src/components/TestRunnerPanel.vue', import.meta.url), 'utf8')
  assert.match(source, /runningTestNode|autoScrollTarget/, '面板没有引用运行中节点/跟随目标')
  assert.match(source, /SCROLL_TO_RUNNING_TEST_NAME/, '面板没有挂上游的滚动到运行中测试动作')
  assert.match(source, /TRACK_RUNNING_TEST_NAME/, '面板没有跟踪开关（上游默认开着）')
  assert.match(source, /NAVIGATE_WITH_SINGLE_CLICK_NAME/, '面板没有 Navigate with Single Click 这一档')
  assert.match(source, /scrollIntoView/, '面板没有真的滚动到那一行')
  assert.match(source, /data-node-id/, '行上没有可用于定位的节点标识')
})
