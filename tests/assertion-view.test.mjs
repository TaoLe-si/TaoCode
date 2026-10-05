// exec/junit 断言视图（`src/assertionView.ts`）的判据。
//
// 上游依据：IDEA Test Runner 的失败详情把断言的两侧并排显示；`ExpectedPatterns` 定义了
// 各框架输出 expected/actual 的常见形状（JUnit 的 `expected:<x> but was:<y>`、TestNG 的
// `expected [x] but found [y]`、node 的 `+ actual - expected` 块…）。这里逐形状钉住解析，
// 并钉住喂入器（结果行 → 结果表 / 其余行 → 当前失败详情）不把详情串错节点。
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { assertionView, TestResultFeed } from '../src/assertionView.ts'

test('JUnit 形状：expected:<x> but was:<y>', () => {
  const view = assertionView(['org.opentest4j.AssertionFailedError: expected:<4> but was:<5>', '\tat MathTest.adds(MathTest.java:12)'])
  assert.equal(view.expected, '4')
  assert.equal(view.actual, '5')
})

test('JUnit 5 的同义形状（带空格与多行值）', () => {
  const view = assertionView(['expected: <[1, 2]> but was: <[1, 3]>'])
  assert.equal(view.expected, '[1, 2]')
  assert.equal(view.actual, '[1, 3]')
})

test('TestNG 形状：expected [x] but found [y]', () => {
  const view = assertionView(['java.lang.AssertionError: expected [hello] but found [world]'])
  assert.equal(view.expected, 'hello')
  assert.equal(view.actual, 'world')
})

test('AssertJ / kotlin.test 的行内形状', () => {
  const view = assertionView(['org.opentest4j.AssertionFailedError: expected: 3 but was: 4'])
  assert.equal(view.expected, '3')
  assert.equal(view.actual, '4')
})

test('node:test 严格相等：+ 实际 / - 期望', () => {
  const view = assertionView([
    'AssertionError [ERR_ASSERTION]: Expected values to be strictly equal:',
    '+ actual - expected',
    '',
    "+ 'a'",
    "- 'b'",
    '    at TestContext.<anonymous> (tests/x.test.mjs:4:10)',
  ])
  assert.equal(view.actual, "'a'")
  assert.equal(view.expected, "'b'")
})

test('pytest：assert 左实际右期望', () => {
  const view = assertionView(['>       assert add(1, 2) == 4', 'E       assert 3 == 4'])
  const last = assertionView(['E       assert 3 == 4'])
  assert.equal(last.actual, '3')
  assert.equal(last.expected, '4')
  assert.equal(view.expected, '4')
})

test('抽不出结构时原样保留文本，绝不臆造 expected/actual', () => {
  const view = assertionView(['Segmentation fault (core dumped)', 'exit code 139'])
  assert.equal(view.expected, null)
  assert.equal(view.actual, null)
  assert.match(view.text, /Segmentation fault/)
})

test('喂入器：失败行后的输出挂到该失败，别的成功行不挂', () => {
  const feed = new TestResultFeed()
  assert.equal(feed.feedLine('✔ alpha (1.0ms)')?.outcome, 'passed')
  assert.equal(feed.feedLine('✖ beta (2.0ms)')?.outcome, 'failed')
  assert.equal(feed.feedLine('expected:<4> but was:<5>'), null)
  assert.equal(feed.feedLine('    at Beta.test (B.test.mjs:9:3)'), null)
  assert.equal(feed.latestFailedId(), 'npm:beta')
  assert.equal(feed.detailLines('npm:beta').length, 3, '失败行本身 + 两行详情')
  assert.match(feed.detailLines('npm:beta')[0], /✖ beta/)
  const view = feed.view('npm:beta')
  assert.equal(view.expected, '4')
  assert.equal(view.actual, '5')
  assert.equal(feed.failed.size, 1)
})

test('喂入器：重跑通过后失败集与最新失败都清掉，旧详情不串到新结果', () => {
  const feed = new TestResultFeed()
  feed.feedLine('✖ beta (1ms)')
  feed.feedLine('expected:<1> but was:<2>')
  assert.equal(feed.failed.size, 1)
  feed.feedLine('✔ beta (1ms)')
  assert.equal(feed.failed.size, 0)
  assert.equal(feed.latestFailedId(), null)
  feed.feedLine('✖ gamma (1ms)')
  // gamma 是新的失败：它的详情只能是它自己的（beta 的旧行不出现）。
  assert.deepEqual(feed.detailLines('npm:gamma'), ['✖ gamma (1ms)'])
  assert.doesNotMatch(feed.view('npm:gamma').text, /expected/)
})

test('喂入器：JUnit 的失败头行本身进结果表，后续断言行进它自己的详情', () => {
  const feed = new TestResultFeed()
  const head = feed.feedLine('1) MathTest.adds expected:<4> but was:<5>')
  assert.equal(head?.outcome, 'failed')
  assert.equal(head?.name, 'adds')
  assert.equal(head?.message, 'MathTest')
  assert.equal(feed.view(head.id).expected, '4')
})

test('面板真的用了喂入器与并排视图（不是死代码）', () => {
  const panel = readFileSync('src/components/TestRunnerPanel.vue', 'utf8')
  assert.match(panel, /TestResultFeed/)
  assert.match(panel, /testrun-assert-panes/)
  assert.match(panel, /runOutput/)
  assert.match(panel, /预期/)
  assert.match(panel, /实际/)
})
