// exec/testframework / exec/filters：结果树显示过滤器的判据。
// 上游对照：platform/testRunner/.../Filter.java:38-90、
// actions/TestFrameworkActions.java:15-41（三个开关的合成）、
// TestConsoleProperties.java:51,52,59（默认值）、ToolbarPanel.java:58-66（inverted 文案）、
// JavaTestFrameworkRunnableState.java:322（Java 运行把「隐藏通过的」关掉）。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import {
  DEFAULT_DISPLAY_FILTER, SHOW_IGNORED_DESCRIPTION, SHOW_IGNORED_NAME, SHOW_PASSED_DESCRIPTION, SHOW_PASSED_NAME,
  filterTestTree, hasPassedTests, nodeAccepted, toggleDisplayFilter,
} from '../src/testResultFilter.ts'

function node(overrides) {
  return {
    id: 'junit:t', name: 't', kind: 'test', depth: 1, path: 'S.t', parent: 'suite:S',
    children: [], outcome: 'passed', counts: { passed: 1, failed: 0, skipped: 0, total: 1 },
    durationMs: 0, location: null, running: false, ...overrides,
  }
}
const suite = (children, outcome = null) => node({
  id: 'suite:S', name: 'S', kind: 'suite', depth: 0, path: 'S', parent: null, children, outcome,
})

test('默认档：Java 运行两条都不隐藏（JavaTestFrameworkRunnableState:322 把 HIDE_PASSED_TESTS 设 false，TestConsoleProperties:51 的 HIDE_IGNORED_TEST 本就是 false）', () => {
  assert.deepEqual(DEFAULT_DISPLAY_FILTER, { showPassed: true, showIgnored: true })
  assert.equal(nodeAccepted(node({ outcome: 'passed' })), true)
  assert.equal(nodeAccepted(node({ outcome: 'failed' })), true)
  assert.equal(nodeAccepted(node({ outcome: 'skipped' })), true, 'hideIgnoredTests 默认 false ⇒ 跳过的也显示')
  assert.equal(nodeAccepted(node({ outcome: null })), true, '还没有结果不等于通过')
  // 上游的通用默认（非 Java 运行）是隐藏通过的：同一份代数要能表达。
  assert.equal(nodeAccepted(node({ outcome: 'passed' }), { showPassed: false, showIgnored: true }), false)
})

test('隐藏通过时：非通过或缺陷留下（NOT_PASSED.or(DEFECT)）', () => {
  const hidePassed = { showPassed: false, showIgnored: true }
  assert.equal(nodeAccepted(node({ outcome: 'passed' }), hidePassed), false)
  assert.equal(nodeAccepted(node({ outcome: 'failed' }), hidePassed), true)
  assert.equal(nodeAccepted(node({ outcome: 'skipped' }), hidePassed), true)
  assert.equal(nodeAccepted(node({ outcome: null }), hidePassed), true)
})

test('两个开关都开时只用 IGNORED.not()，没有 HAS_PASSED 兜底（TestFrameworkActions:33-37 的分支不对称）', () => {
  // 一条「自己被判为跳过、子树里有通过的」suite：这正是 HAS_PASSED 兜底存在的理由
  // （上游 suite 节点会被孩子的状态聚合，聚合不出 skipped，但 isConfig/忽略传播会给出）。
  const ignoredSuiteWithPassedChild = suite([node({ id: 'junit:S.a', path: 'S.a', outcome: 'passed' })], 'skipped')
  assert.equal(hasPassedTests(ignoredSuiteWithPassedChild), true)
  // 显示通过 + 隐藏跳过 ⇒ IGNORED.not().or(HAS_PASSED) ⇒ 留着。
  assert.equal(nodeAccepted(ignoredSuiteWithPassedChild, { showPassed: true, showIgnored: false }), true)
  // 隐藏通过 + 隐藏跳过 ⇒ 只剩 IGNORED.not() ⇒ 同一条被判掉（兜底不参与）。
  assert.equal(nodeAccepted(ignoredSuiteWithPassedChild, { showPassed: false, showIgnored: false }), false)
  // 只隐藏通过（不隐藏跳过）时它照样留着。
  assert.equal(nodeAccepted(ignoredSuiteWithPassedChild, { showPassed: false, showIgnored: true }), true)
})

test('过滤是递归的：suite 留下但通过的孩子被裁；孩子全被裁的 suite 不出现', () => {
  const tree = [suite([
    node({ id: 'junit:S.a', path: 'S.a', outcome: 'passed' }),
    node({ id: 'junit:S.b', path: 'S.b', outcome: 'failed' }),
  ])]
  const hidden = filterTestTree(tree, { showPassed: false, showIgnored: false })
  assert.deepEqual(hidden[0].children.map(item => item.id), ['junit:S.b'])
  assert.equal(hidden[0].id, 'suite:S')
  const allPassed = [suite([node({ id: 'junit:S.a', path: 'S.a', outcome: 'passed' })])]
  assert.deepEqual(filterTestTree(allPassed, { showPassed: false, showIgnored: false }), [])
  // 原树不被改动（面板的展开状态与喂入器都拿的是同一份节点）。
  assert.equal(tree[0].children.length, 2)
})

test('开关是 inverted：按钮文案是「显示」，取自上游 bundle', () => {
  assert.equal(SHOW_PASSED_NAME, 'Show Passed')
  assert.equal(SHOW_PASSED_DESCRIPTION, 'Show passed tests')
  assert.equal(SHOW_IGNORED_NAME, 'Show Ignored')
  assert.equal(SHOW_IGNORED_DESCRIPTION, 'Show ignored')
  assert.deepEqual(toggleDisplayFilter(DEFAULT_DISPLAY_FILTER, 'showPassed'), { showPassed: false, showIgnored: true })
  assert.deepEqual(toggleDisplayFilter(DEFAULT_DISPLAY_FILTER, 'showIgnored'), { showPassed: true, showIgnored: false })
})

test('接线：面板的树过这道过滤器（不是只躺在模块里）', () => {
  const source = readFileSync(new URL('../src/components/TestRunnerPanel.vue', import.meta.url), 'utf8')
  assert.match(source, /from '\.\.\/testResultFilter'/, '面板没有引用显示过滤器')
  assert.match(source, /filterTestTree/, '面板没有真的过滤树')
  assert.match(source, /SHOW_PASSED_NAME/, '面板没有 Show Passed 开关')
  assert.match(source, /SHOW_IGNORED_NAME/, '面板没有 Show Ignored 开关')
})
