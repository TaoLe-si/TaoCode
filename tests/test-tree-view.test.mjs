// exec/testframework：测试树视图（`src/testTree.ts`）的判据。
//
// 上游依据：`platform/testRunner/src/com/intellij/execution/testframework/TestTreeView.java:48/72-88`
// （树本体）、`actions/TestTreeExpander.java:40-61`（expandAll / collapseAll(树,1) /
// canExpand=hasTestSuites）、`ToggleModelAction.java:16-31`。
// 这里钉住三件事：层级是从结果全路径拼出来的、空 suite 也上树、折叠口径与上游一致。
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const { TestTreeBuilder, TestTreeExpander, TREE_NODE_LIMIT } = await import('../src/testTree.ts')
const { formatTestEvent } = await import('../src/testEventChannel.ts')

const run = builder => {
  const lines = []
  const suite = (name, parent) => lines.push(formatTestEvent({ kind: 'suiteStarted', name, id: name, ...(parent ? { parent } : {}) }))
  const test = (name, parent, extra = {}) => lines.push(formatTestEvent({ kind: 'testFinished', name, id: `${parent}/${name}`, parent, ...extra }))
  suite('MathTest')
  test('adds', 'MathTest', { durationMs: 12 })
  test('subs', 'MathTest', { durationMs: 4 })
  lines.push(formatTestEvent({ kind: 'testFailed', name: 'divides', id: 'MathTest/divides', parent: 'MathTest', message: 'expected:<4> but was:<5>', expected: '4', actual: '5' }))
  suite('Outer', 'MathTest')
  test('nested', 'Outer')
  return lines
}

function resultsFor(builder) {
  // 树只看结果表：这里用通道自己的结果（TestResultFeed 那边同一份），判据里直接造。
  return null
}
void resultsFor

test('层级：结果按全路径挂成 suite → test，计数与时长自底向上聚合', () => {
  const builder = new TestTreeBuilder()
  for (const line of run(builder)) builder.apply(line)
  const results = new Map([
    ['sm:MathTest/adds', { id: 'sm:MathTest/adds', name: 'adds', outcome: 'passed', durationMs: 12 }],
    ['sm:MathTest/subs', { id: 'sm:MathTest/subs', name: 'subs', outcome: 'passed', durationMs: 4 }],
    ['sm:MathTest/divides', { id: 'sm:MathTest/divides', name: 'divides', outcome: 'failed' }],
    // 结果 id 是通道按**事件 id** 发的（`sm:` + 事件 id），而嵌套用例的事件 id 是 `Outer/nested`
    // （见上面 `run()` 的 `${parent}/${name}`），不是全路径 —— 树靠它反查层级。
    ['sm:Outer/nested', { id: 'sm:Outer/nested', name: 'nested', outcome: 'skipped' }],
  ])
  const tree = builder.build(results)
  assert.deepEqual(tree.map(node => node.path), ['MathTest'], '根只有 MathTest 一个 suite')
  const math = tree[0]
  assert.equal(math.kind, 'suite')
  assert.deepEqual([math.counts.passed, math.counts.failed, math.counts.skipped, math.counts.total], [2, 1, 1, 4])
  assert.equal(math.outcome, 'failed', '聚合口径 failed > skipped > passed')
  assert.equal(math.durationMs, 16)
  const outer = math.children.find(node => node.path === 'MathTest.Outer')
  assert.equal(outer.children[0].name, 'nested')
  assert.equal(outer.children[0].depth, 2)
})

test('适配器没报 suiteStarted 时，层级照样从结果全路径里长出来', () => {
  const builder = new TestTreeBuilder()
  // 只给 testFinished，不给 suiteStarted：通道仍按当前 suite 栈建节点，fullName 仍有两级。
  builder.apply(formatTestEvent({ kind: 'testFinished', name: 'adds', id: 't1', parent: 'MathTest' }))
  const tree = builder.build(new Map([['sm:t1', { id: 'sm:t1', name: 'adds', outcome: 'passed' }]]))
  assert.deepEqual(tree.map(node => node.path), ['MathTest'])
  assert.equal(tree[0].children.length, 1)
})

test('报过但没有结果的 suite 也在树上（上游跑空的 suite 节点同样留着）', () => {
  const builder = new TestTreeBuilder()
  builder.apply(formatTestEvent({ kind: 'suiteStarted', name: 'EmptyTest', id: 's-empty' }))
  const tree = builder.build(new Map())
  assert.deepEqual(tree.map(node => node.path), ['EmptyTest'])
  assert.equal(tree[0].counts.total, 0)
  assert.equal(tree[0].outcome, null, '没有叶子就没有状态')
})

test('locationHint 与发现位置合成一处；testStarted 未结束时算「运行中」', () => {
  const builder = new TestTreeBuilder()
  builder.apply(formatTestEvent({ kind: 'testStarted', name: 'adds', id: 't1', parent: 'MathTest', locationHint: 'MathTest.java:12' }))
  builder.apply(formatTestEvent({ kind: 'testStarted', name: 'subs', id: 't2', parent: 'MathTest' }))
  const tree = builder.build(new Map([
    ['sm:t1', { id: 'sm:t1', name: 'adds', outcome: 'passed' }],
    ['sm:t2', { id: 'sm:t2', name: 'subs', outcome: 'passed' }],
  ]), new Map([['sm:t2', { path: 'src/MathTest.kt', line: 30 }]]))
  const adds = tree[0].children[0]
  assert.equal(adds.location, 'MathTest.java:12')
  assert.equal(adds.running, true)
  const subs = tree[0].children[1]
  assert.equal(subs.location, 'src/MathTest.kt:30', '发现到的位置兜底')
})

test('块边界截断的事件行照样进树（OutputEventSplitter 那一层）', () => {
  const builder = new TestTreeBuilder()
  const [head] = run(builder)
  const cut = head.slice(0, 20)
  builder.feed(cut)
  assert.equal(builder.build(new Map()).length, 0, '半条事件不算数')
  builder.feed(head.slice(20) + '\n')
  assert.deepEqual(builder.build(new Map()).map(node => node.path), ['MathTest'])
})

test('节点数有上限，超出后不再新建（与 CHANNEL_OUTPUT_LIMIT 同一量级）', () => {
  const builder = new TestTreeBuilder()
  const results = new Map()
  for (let i = 0; i < TREE_NODE_LIMIT + 20; ++i)
    results.set(`sm:t${i}`, { id: `sm:t${i}`, name: `t${i}`, outcome: 'passed' })
  const tree = builder.build(results)
  assert.ok(tree.length <= TREE_NODE_LIMIT)
})

test('展开/折叠：collapseAll 只留根下一层，canExpand 以「有 suite 层」为前提', () => {
  const builder = new TestTreeBuilder()
  for (const line of run(builder)) builder.apply(line)
  const tree = builder.build(new Map([
    ['sm:MathTest/adds', { id: 'sm:MathTest/adds', name: 'adds', outcome: 'passed' }],
    ['sm:Outer/nested', { id: 'sm:Outer/nested', name: 'nested', outcome: 'passed' }],
  ]))
  const expander = new TestTreeExpander()
  const outer = tree[0].children.find(node => node.path === 'MathTest.Outer')
  assert.equal(expander.canExpand(tree), true)
  expander.expandAll(tree)
  assert.equal(expander.isExpanded(tree[0].id), true)
  assert.equal(expander.isExpanded(outer.id), true)
  expander.collapseAll(tree)
  assert.equal(expander.isExpanded(tree[0].id), true, '根下一层留着')
  assert.equal(expander.isExpanded(outer.id), false, '更深的折起来（TreeUtil.collapseAll(view, 1)）')
  expander.toggle(outer.id)
  assert.equal(expander.isExpanded(outer.id), true)
  // 平表（没有 suite 层）⇒ 谈不上折叠，与上游 hasTestSuites 同一前提。
  const flat = [tree[0].children.find(node => node.kind === 'test')].filter(Boolean)
  assert.equal(expander.canExpand(flat), false)
})

test('接线：面板渲染这棵树并挂上展开/折叠全部（不是只躺在模块里）', () => {
  const panel = readFileSync('src/components/TestRunnerPanel.vue', 'utf8')
  assert.match(panel, /TestTreeBuilder/)
  assert.match(panel, /TestTreeExpander/)
  assert.match(panel, /expandAll\(/)
  assert.match(panel, /collapseAll\(/)
})
