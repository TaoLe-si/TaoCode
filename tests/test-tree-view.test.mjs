// exec/testframework：测试树视图（`src/testTree.ts`）的判据。
//
// 上游依据：`platform/testRunner/src/com/intellij/execution/testframework/TestTreeView.java:48/72-88`
// （树本体）、`actions/TestTreeExpander.java:40-61`（expandAll / collapseAll(树,1) /
// canExpand=hasTestSuites）、`ToggleModelAction.java:16-31`。
// 这里钉住三件事：层级是从结果全路径拼出来的、空 suite 也上树、折叠口径与上游一致。
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const { TestTreeBuilder, TestTreeExpander, TREE_NODE_LIMIT,
        DEFAULT_TEST_TREE_SORT, OVERALL_TIME_MESSAGE, SUM_TIME_MESSAGE,
        SORT_ALPHABETICALLY_NAME, SORT_BY_DECLARATION_ORDER_NAME, SORT_BY_DURATION_NAME,
        SHOW_INLINE_STATISTICS_NAME, SUITES_ALWAYS_ON_TOP_NAME, sortTestTree,
        testDurationText, testNodeDurationMs, testNodeDurationText, testNodeDurationTooltip, withTestTreeSort } =
  await import('../src/testTree.ts')
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

// --- 排序与行内统计（上游 TestConsoleProperties.java:45-48/57 + TestFrameworkRunningModel.java:41-78
//     + ToolbarPanel.java:82-114/165-167 + SMTestProxy.java:546-549 的 narrow 时长格式）-----------
const counts = (passed = 0, failed = 0, skipped = 0, total = 0) => ({ passed, failed, skipped, total })
const suite = (name, children, extra = {}) => ({
  id: `suite:${name}`, name, kind: 'suite', depth: 0, path: name, parent: null, children,
  outcome: 'passed', counts: counts(1, 0, 0, 1), durationMs: 0, location: null,
  running: false, startTimeMillis: null, endTimeMillis: null, ...extra,
})
const leaf = (name, extra = {}) => ({
  id: `sm:${name}`, name, kind: 'test', depth: 1, path: `S.${name}`, parent: 'suite:S', children: [],
  outcome: 'passed', counts: counts(1, 0, 0, 1), durationMs: 0, location: null,
  running: false, startTimeMillis: null, endTimeMillis: null, ...extra,
})
/** 一层兄弟：`S` 里混着两个 test 与一个 sub suite（顺序故意排成「test, suite, test」）。 */
const mixed = () => suite('S', [
  leaf('beta', { durationMs: 5, location: 'src/S.java:21' }),
  suite('S.Alphabet', [], { depth: 1, location: 'src/S.java:1' }),
  leaf('Alpha', { durationMs: 120, location: 'src/S.java:9' }),
])
const childNames = nodes => nodes[0].children.map(node => node.name)

test('四个开关的默认值照上游 TestConsoleProperties.java:45-48（suitesAlwaysOnTop 是唯一默认 true 的）', () => {
  assert.deepEqual(DEFAULT_TEST_TREE_SORT, {
    sortAlphabetically: false, sortByDuration: false, sortByDeclarationOrder: false, suitesAlwaysOnTop: true,
  })
  // 全关 ⇒ 不排序，原样返回（连节点身份都不换）。
  const node = mixed()
  assert.equal(sortTestTree([node], DEFAULT_TEST_TREE_SORT)[0], node)
})

test('三个排序键互斥：打开一个就关掉另外两个，置顶不受影响（ToolbarPanel.java:84-95/98-110/306-334）', () => {
  const base = { ...DEFAULT_TEST_TREE_SORT, sortAlphabetically: true }
  const duration = withTestTreeSort(base, 'duration')
  assert.deepEqual(duration, { sortAlphabetically: false, sortByDuration: true, sortByDeclarationOrder: false, suitesAlwaysOnTop: true })
  const declaration = withTestTreeSort(base, 'declaration')
  assert.equal(declaration.sortByDeclarationOrder, true)
  assert.equal(declaration.sortAlphabetically, false)
  assert.equal(declaration.sortByDuration, false)
  // 再点一次同一个 ⇒ 三个全关（回到建模顺序）。
  const off = withTestTreeSort(declaration, null)
  assert.deepEqual([off.sortAlphabetically, off.sortByDuration, off.sortByDeclarationOrder], [false, false, false])
  assert.equal(off.suitesAlwaysOnTop, true, '置顶是独立开关，不参与互斥')
})

test('耗时排序：同层降序，suite 与 test 混排时套件在前（TestFrameworkRunningModel.java:44-52）', () => {
  const sorted = sortTestTree([mixed()], { ...DEFAULT_TEST_TREE_SORT, sortByDuration: true })
  assert.deepEqual(childNames(sorted), ['S.Alphabet', 'Alpha', 'beta'], '置顶开着：suite 先，再按耗时降序')
  const interleaved = sortTestTree([mixed()], { ...DEFAULT_TEST_TREE_SORT, sortByDuration: true, suitesAlwaysOnTop: false })
  assert.deepEqual(childNames(interleaved), ['Alpha', 'beta', 'S.Alphabet'], '关掉置顶就纯按耗时排（120 > 5 > 0）')
})

test('耗时排序只在没在跑时生效；还在跑就什么也不排（:44 的 && !isRunning()）', () => {
  const options = { ...DEFAULT_TEST_TREE_SORT, sortByDuration: true }
  assert.deepEqual(childNames(sortTestTree([mixed()], options, true)), ['beta', 'S.Alphabet', 'Alpha'])
  assert.deepEqual(childNames(sortTestTree([mixed()], options, false)), ['S.Alphabet', 'Alpha', 'beta'])
})

test('声明顺序：按源码行号升序，拿不到位置的排最后（:58-71 的 textOffset，本仓用 location 的行）', () => {
  const options = { ...DEFAULT_TEST_TREE_SORT, sortByDeclarationOrder: true }
  const node = mixed()
  node.children[1].location = null // 让那个 suite 变成「拿不到位置」
  const sorted = sortTestTree([node], options)
  assert.deepEqual(childNames(sorted), ['S.Alphabet', 'Alpha', 'beta'], '置顶开着时 suite 仍在前，其余按行号')
  const noTop = sortTestTree([node], { ...options, suitesAlwaysOnTop: false })
  assert.deepEqual(childNames(noTop), ['Alpha', 'beta', 'S.Alphabet'], '关掉置顶就纯按行号，拿不到位置的排最后（:69-70）')
})

test('字母序忽略大小写（AlphaComparator.java:33 的 FileNameComparator 两级判据）', () => {
  const node = suite('S', [leaf('bTest'), leaf('Alpha'), leaf('aZul')])
  const sorted = sortTestTree([node], { ...DEFAULT_TEST_TREE_SORT, sortAlphabetically: true })
  assert.deepEqual(childNames(sorted), ['Alpha', 'aZul', 'bTest'], '先忽略大小写，同首字母时大写在前')
})

test('排序递归到每一层兄弟之间，且不改节点自身字段', () => {
  const inner = suite('S.Inner', [leaf('z', { durationMs: 30, path: 'S.Inner.z' }), leaf('a', { durationMs: 7, path: 'S.Inner.a' })], { depth: 1, durationMs: 37 })
  const node = suite('S', [inner, leaf('slow', { durationMs: 200 })])
  const sorted = sortTestTree([node], { ...DEFAULT_TEST_TREE_SORT, sortByDuration: true, suitesAlwaysOnTop: false })
  assert.deepEqual(childNames(sorted), ['slow', 'S.Inner'], '第一层按耗时降序')
  assert.deepEqual(sorted[0].children[1].children.map(child => child.name), ['z', 'a'], '第二层同样排序')
  assert.equal(sorted[0].children[1].durationMs, 37)
  assert.deepEqual(sorted[0].children[1].counts, counts(1, 0, 0, 1), 'counts 原样带过去')
})

test('行内统计的时长文本：最多两个单位、单位名取自 NlsMessages.java:32（narrow 档）', () => {
  assert.equal(testDurationText(123_456), '2 min 3 sec')
  assert.equal(testDurationText(999), '999 ms')
  assert.equal(testDurationText(3_725_000), '1 hr 2 min')
  assert.equal(testDurationText(61_000), '1 min 1 sec', '两个非零单位都在「最多两段」里')
  assert.equal(testDurationText(0), '0 ms')
  assert.equal(testDurationText(null), null, '没有时长就不画（AbstractTestProxy.java:62-64 的 null 档）')
  assert.equal(testDurationText(-1), null)
})

test('开关文案取自上游 bundle，且面板真的挂了这五个动作', () => {
  assert.deepEqual([SORT_ALPHABETICALLY_NAME, SORT_BY_DECLARATION_ORDER_NAME, SORT_BY_DURATION_NAME,
                    SUITES_ALWAYS_ON_TOP_NAME, SHOW_INLINE_STATISTICS_NAME],
                   ['Sort Alphabetically', 'Sort By Declaration Order', 'Sort By Duration',
                    'Suites Always on Top', 'Show Inline Statistics'])
  const panel = readFileSync('src/components/TestRunnerPanel.vue', 'utf8')
  assert.match(panel, /sortTestTree\(/)
  assert.match(panel, /withTestTreeSort\(/)
  // **留痕（2026-10-06 第二批）**：这条原本钉的是 /testDurationText\(/。行内统计现在走
  // `testNodeDurationText`（wall time / 运行中实时时长 / 孩子之和三档，`JavaSMTRunnerTestTreeView.java:56-86`），
  // 纯格式化函数 `testDurationText` 仍在模块里被它调用（本文件上面那条值判据没动）⇒ 锚点跟着换成真在面板里的那一个，
  // 断言强度只增不减（下面还多了 tooltip 与 title 两条）。
  assert.match(panel, /testNodeDurationText\(/)
  assert.match(panel, /testNodeDurationTooltip\(/)
  assert.match(panel, /:title="durationHint\(node\)"/, 'Overall/Sum 两行挂在行右侧那一格（上游只有行右半侧有 tooltip）')
  assert.match(panel, /showInlineStatistics = ref\(true\)/, '上游 SHOW_INLINE_STATISTICS 默认 true（TestConsoleProperties.java:57）')
  // 面板的 title 走这些常量（文案本身由上一条 deepEqual 钉住），所以这里核对**引用点**而不是英文字面。
  for (const [name, symbol] of [['Sort Alphabetically', 'SORT_ALPHABETICALLY_NAME'],
                                ['Sort By Declaration Order', 'SORT_BY_DECLARATION_ORDER_NAME'],
                                ['Sort By Duration', 'SORT_BY_DURATION_NAME'],
                                ['Suites Always on Top', 'SUITES_ALWAYS_ON_TOP_NAME'],
                                ['Show Inline Statistics', 'SHOW_INLINE_STATISTICS_NAME']])
    assert.match(panel, new RegExp(symbol), `面板里要有「${name}」这一格（引用 ${symbol}）`)
})

// --- 时间戳、wall time 与 Overall/Sum tooltip --------------------------------------
// 上游依据：`platform/smRunner/src/com/intellij/execution/testframework/sm/runner/SMTestProxy.java:456-457`
// （`setStarted()` 事件到达时盖 `myStartTime`，已有值不覆盖）、`:475-477`（`setSuiteStarted()` 同一口径）、
// `:629-630` 与 `:645-646`（结束侧 `if (myEndTime == null)` 才盖）、`:489-511`（suite 的时长是孩子之和）、
// `:546-549`（`getDurationString()` = narrow 档时长，可为 null）、
// `java/execution/impl/src/com/intellij/execution/testframework/JavaSMTRunnerTestTreeView.java:56-86`
// （三档呈现：在跑 ⇒ 实时整秒 / 已结束的 suite ⇒ wall time / 其余 ⇒ 自己的时长或孩子之和）、
// `:117-150`（非叶子右侧的 Overall+Sum 两行 tooltip）、
// `java/execution/impl/src/com/intellij/execution/testframework/JavaAwareTestConsoleProperties.java:55`
// （`USE_WALL_TIME` 默认 **true**，`:202` 的开关动作被 Registry 挡着 ⇒ 本仓不画那一格、只落默认档行为）、
// `java/openapi/resources/messages/JavaBundle.properties:2038`/`:2039`（两行文案）。
/** 假时钟：从 `start` 起，每取一次走 `step` 毫秒（上游用 `System.currentTimeMillis()`，这里只为可测）。 */
const clock = (start, step) => { let value = start; return () => { const at = value; value += step; return at } }

test('事件到达即盖开始/结束时间戳，且已有的不覆盖（SMTestProxy.java:456-457/475-477/629-630）', () => {
  const builder = new TestTreeBuilder(clock(1_000, 500))
  builder.apply(formatTestEvent({ kind: 'suiteStarted', name: 'MathTest', id: 's1' }))
  builder.apply(formatTestEvent({ kind: 'testStarted', name: 'adds', id: 't1', parent: 's1' }))
  // 同一节点的第二条开始事件（重跑/适配器重复报）不许把已经盖好的开始戳挪走
  // —— 上游 `SMTestProxy.java:456-457` 的 `if (myStartTime == null)` 拦的就是这个。
  builder.apply(formatTestEvent({ kind: 'testStarted', name: 'adds', id: 't1', parent: 's1' }))
  builder.apply(formatTestEvent({ kind: 'testFinished', name: 'adds', id: 't1', parent: 's1', durationMs: 400 }))
  builder.apply(formatTestEvent({ kind: 'suiteFinished', name: 'MathTest', id: 's1' }))
  // 迟到的第二条结束事件同理（时钟继续走，节点上的戳不能变）。
  builder.apply(formatTestEvent({ kind: 'testFinished', name: 'adds', id: 't1', parent: 's1', durationMs: 400 }))
  const tree = builder.build(new Map([['sm:t1', { id: 'sm:t1', name: 'adds', outcome: 'passed', durationMs: 400 }]]))
  const math = tree[0]
  const adds = math.children[0]
  assert.deepEqual([math.startTimeMillis, math.endTimeMillis], [1_000, 2_500], 'suite：suiteStarted 盖开始、suiteFinished 盖结束')
  assert.deepEqual([adds.startTimeMillis, adds.endTimeMillis], [1_500, 2_000], 'test：testStarted 盖开始、testFinished 盖结束')
  // 呈现：已结束的 suite 用 **wall time**（1500ms），不是孩子之和（400ms）—— `:75-84`；
  // 叶子用的是**报上来的时长**（400ms），不是到达差（500ms）—— `:85` + `SMTestProxy.java:596-600`。
  assert.equal(testNodeDurationText(math, 9_000), '1 sec 500 ms')
  assert.equal(testNodeDurationText(adds, 9_000), '400 ms')
  assert.equal(testNodeDurationTooltip(math), 'Overall time: 1 sec 500 ms\nSum time: 400 ms')
})

test('隐式层级（没报 suiteStarted）没有时间戳 ⇒ 退回孩子之和，tooltip 不画', () => {
  const builder = new TestTreeBuilder()
  builder.apply(formatTestEvent({ kind: 'testFinished', name: 'adds', id: 't1', parent: 'MathTest', durationMs: 250 }))
  const tree = builder.build(new Map([['sm:t1', { id: 'sm:t1', name: 'adds', outcome: 'passed', durationMs: 250 }]]))
  assert.equal(tree[0].startTimeMillis, null)
  assert.equal(tree[0].endTimeMillis, null)
  assert.equal(testNodeDurationText(tree[0], 1e6), '250 ms', '`JavaSMTRunnerTestTreeView.java:81` 的条件不成立 ⇒ 走 `:85`')
  assert.equal(testNodeDurationTooltip(tree[0]), null)
})

test('运行中的节点：画已经跑掉的整秒，不足 1 秒不画，没有开始戳不画（JavaSMTRunnerTestTreeView.java:58-74）', () => {
  const node = leaf('slow', { running: true, startTimeMillis: 10_000 })
  assert.equal(testNodeDurationText(node, 13_400), '3 sec', '`：69-73` 向下取整到整秒')
  assert.equal(testNodeDurationText(node, 10_900), null, '`:70-71` 不足 1 秒不画（免得闪个位数）')
  assert.equal(testNodeDurationText(leaf('x', { running: true, startTimeMillis: null }), 20_000), null, '`:66-68`')
  const parent = suite('S', [leaf('a', { startTimeMillis: 12_000 })], { running: true, startTimeMillis: 10_000 })
  assert.equal(testNodeDurationText(parent, 21_500), '11 sec',
               'wall time 默认开着 ⇒ 在跑的 suite 也用**自己的**开始戳（`:60-64`，取第一个孩子那一支是 wall time 关着时才走）')
})

test('Overall/Sum 两行只在非叶子 + 两个时间戳齐全时给（JavaSMTRunnerTestTreeView.java:117-150）', () => {
  const node = suite('S', [leaf('a')], { startTimeMillis: 1_000, endTimeMillis: 4_500, durationMs: 1_200 })
  assert.equal(testNodeDurationTooltip(node), 'Overall time: 3 sec 500 ms\nSum time: 1 sec 200 ms')
  assert.equal(testNodeDurationTooltip(suite('S', [], { startTimeMillis: 1_000, endTimeMillis: 4_000 })), null,
               '有戳但没有孩子 ⇒ 上游那一档就是叶子（`SMTestProxy.isLeaf()`），`:133` 拦住 ⇒ 不画')
  assert.equal(testNodeDurationTooltip(leaf('a', { startTimeMillis: 1, endTimeMillis: 5, durationMs: 4 })), null, '叶子没有这一条 tooltip')
  assert.equal(testNodeDurationTooltip(suite('S', [leaf('a')], { startTimeMillis: 4_500, endTimeMillis: 1_000 })), null,
               'end <= start 不画（`:135`）')
  assert.equal(testNodeDurationTooltip(suite('S', [leaf('a')], { startTimeMillis: 1_000, endTimeMillis: 2_000, durationMs: 0 })),
               'Overall time: 1 sec', '孩子时长之和没测到 ⇒ 只给 Overall（`SMTestProxy.java:547-548` 的 null 档）')
  assert.deepEqual([OVERALL_TIME_MESSAGE, SUM_TIME_MESSAGE], ['Overall time: {0}', 'Sum time: {0}'],
                   '文案逐字取自 JavaBundle.properties:2038/:2039')
})

test('耗时排序比的是 customized duration：suite 用 wall time，没时间戳算「没有时长」排最后'
      + '（TestFrameworkRunningModel.java:52 + JavaAwareTestConsoleProperties.java:184-197 + Comparing.java:155-160）', () => {
  const options = { ...DEFAULT_TEST_TREE_SORT, sortByDuration: true, suitesAlwaysOnTop: false }
  // `Wall` 的孩子合计只有 10ms，但整层从第一条事件到结束跑了 5000ms；
  // `Sum` 的孩子合计 9000ms 却**没有** suite 事件 ⇒ 上游那一档 `getCustomizedDuration` 返回 null（`:193-195`）。
  const wall = suite('Wall', [leaf('w', { durationMs: 10 })], { durationMs: 10, startTimeMillis: 1_000, endTimeMillis: 6_000 })
  const sum = suite('Sum', [leaf('s', { durationMs: 9_000 })], { durationMs: 9_000 })
  assert.deepEqual(testNodeDurationMs(wall), 5_000)
  assert.equal(testNodeDurationMs(sum), null, '不是退回孩子之和（排序档与显示档在这里分岔）')
  assert.equal(testNodeDurationText(sum, 9_999), '9 sec', '显示仍走 `:85` 的 getDurationString = 孩子之和')
  assert.equal(testNodeDurationMs(leaf('x', { durationMs: 3 })), 3, '叶子就是自己的时长')
  const root = suite('Root', [sum, wall])
  assert.deepEqual(root.children.map(child => child.name), ['Sum', 'Wall'], '建模顺序是「合计大的在前」')
  assert.deepEqual(childNames(sortTestTree([root], options)), ['Wall', 'Sum'], '排序按 wall time：5000 > 没有时长 ⇒ 没有时长的排最后')
})
