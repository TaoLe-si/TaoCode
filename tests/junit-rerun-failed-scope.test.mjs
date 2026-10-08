// exec/junit：**「重跑失败项」这一档到底重跑哪些**（上游 `AbstractRerunFailedTestsAction.getFailuresFilter`）。
//
// 上游对照（本轮逐条自己开文件核实）：
//   · `platform/testRunner/src/com/intellij/execution/testframework/actions/AbstractRerunFailedTestsAction.java:131-141`
//     —— `getFailuresFilter(consoleProperties)`：`includeNonStarted` 开着时
//     `Filter.NOT_PASSED.or(FAILED_OR_INTERRUPTED).and(IGNORED.not())`（`:138`），
//     关着时 `FAILED_OR_INTERRUPTED.and(IGNORED.not())`（`:140`）。
//     判的是 `model.getRoot().getAllTests()`（`:111`、`:124`）—— 也就是**上一次运行报过的**节点，
//     含「报了开始却没跑完」的那些，所以默认档（`:58 includeNonStarted=true`）会把它们一起重跑。
//   · `platform/testRunner/src/com/intellij/execution/testframework/TestConsoleProperties.java:58`
//     —— `INCLUDE_NON_STARTED_IN_RERUN_FAILED = new BooleanProperty("includeNonStarted", true)`：默认 **true**。
//   · `java/execution/impl/src/com/intellij/execution/actions/JavaRerunFailedTestsAction.java:22-30`
//     —— Java/JUnit 那支把过滤器再 `and(LEAF)`：`shouldAccept` 只认 `test.isLeaf()`。
//   · `plugins/junit/src/com/intellij/execution/junit2/ui/actions/RerunFailedTestsAction.java:29-50`
//     —— JUnit 的 `getRunProfile` 用 `new TestMethods(configuration, environment, getFailedTests(project))`，
//     即重跑集 = 上面那条过滤器选出来的测试；`:44-48` 的 `getState` 直接把这个集合当运行状态交出去。
//   · 这条开关**用户可见**（不是我造的控件）：
//     `platform/testRunner/src/com/intellij/execution/testframework/TestConsoleProperties.java:224-226`
//     的 `createIncludeNonStartedInRerun` 用键 `junit.running.info.include.non.started.in.rerun.failed.action.name`，
//     文案在 `platform/execution/resources/messages/ExecutionBundle.properties:157` =
//     `Include Non-Started Tests in Rerun Failed`；
//     `plugins/junit/src/com/intellij/execution/junit2/ui/properties/JUnitConsoleProperties.java:50`
//     在 `appendAdditionalActions` 里真的把它加进了工具栏（TestNG 那支 `plugins/testng/src/com/theoryinpractice/testng/model/TestNGConsoleProperties.java:46` 同样）。
//
// `LEAF` 的判据是**孩子数**，不是 kind（`rerunscope2` 补的那一条，全对照见
// `docs/batch-2026-10-06-rerunscope2.md` §1③）：
//   · `platform/smRunner/src/com/intellij/execution/testframework/sm/runner/SMTestProxy.java:238-240`
//     —— `isLeaf()` = `myChildren == null || myChildren.isEmpty()`；
//   · 所以「报过 `testSuiteStarted` 却没长出任何测试、也还没闭合」的类（类加载即崩）在上游
//     **就是叶子**，RUNNING 档（`platform/smRunner/src/com/intellij/execution/testframework/sm/runner/states/SuiteInProgressState.java:13`
//     继承 `platform/smRunner/src/com/intellij/execution/testframework/sm/runner/states/TestInProgressState.java:57-59`）
//     ⇒ `NOT_PASSED ∧ ¬IGNORED ∧ LEAF` 三条全过 ⇒ 进重跑集，这就是属性名里的 "Non-Started"；
//   · 但**闭合了的空 suite 不进**：`platform/smRunner/src/com/intellij/execution/testframework/sm/runner/states/SuiteFinishedState.java:94`
//     的 EMPTY_SUITE 走 `:140-143` 的 COMPLETE_INDEX ⇒ `SMTestProxy.java:279-283` 的 `isPassed()` 为真。
//
// 本仓的映射（登记清楚，别当成"少写了 interrupted"）：
//   · 上游有 `isInterrupted()`（整个运行被打断）与「testStarted 之后没有结束事件」两档；
//     本仓的结果只有 passed / failed / skipped 三档（`src/testRunner.ts:79`），
//     中断的表现形式就是**没有结束事件** ⇒ 统一落在 `outcome === null` 这一档，
//     来源是 `TestTreeBuilder.notFinished()`（`src/testTree.ts`：报过 testStarted、没报过任何结束事件）
//     与 `TestTreeBuilder.notStartedSuites()`（只报过 suiteStarted、没孩子、没闭合的类）。
//   · `Filter.IGNORED` ⇒ 本仓的 `skipped`（`src/testResultFilter.ts` 里既有同一条口径）；
//   · `Filter.LEAF` ⇒ `isRerunLeaf()`：**孩子数为 0**（不是 `kind === 'test'`）。
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { DEFAULT_INCLUDE_NON_STARTED, INCLUDE_NON_STARTED_NAME, isRerunLeaf, rerunFailureAccepted, rerunFailureNames } from '../src/testResultFilter.ts'
import { TestTreeBuilder } from '../src/testTree.ts'
import { formatTestEvent } from '../src/testEventChannel.ts'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const read = relative => readFileSync(join(root, relative), 'utf8')

const row = (overrides = {}) => ({ name: 'adds', kind: 'test', outcome: 'failed', ...overrides })
const on = { includeNonStarted: true }
const off = { includeNonStarted: false }

/** 按 path 在结果树里找节点（夹具形状的前提断言要用，不碰构建器的私有字段）。 */
function findNode(nodes, path) {
  for (const node of nodes) {
    if (node.path === path) return node
    const hit = findNode(node.children, path)
    if (hit) return hit
  }
  return null
}

test('默认档 = 上游那条属性的默认值 true（TestConsoleProperties.java:58）', () => {
  assert.equal(DEFAULT_INCLUDE_NON_STARTED, true)
  assert.equal(rerunFailureAccepted(row({ outcome: null })), true,
    '不带参数走默认档 ⇒ 没跑成的也在重跑集里（这正是本仓改前的缺口）')
})

test('开关开着：NOT_PASSED.or(FAILED_OR_INTERRUPTED).and(IGNORED.not())（:138）', () => {
  assert.equal(rerunFailureAccepted(row({ outcome: 'failed' }), on), true)
  assert.equal(rerunFailureAccepted(row({ outcome: null }), on), true, '报了开始没跑完 ⇒ NOT_PASSED')
  assert.equal(rerunFailureAccepted(row({ outcome: 'passed' }), on), false)
  assert.equal(rerunFailureAccepted(row({ outcome: 'skipped' }), on), false, 'IGNORED.not() 把跳过的排除掉')
  assert.equal(rerunFailureAccepted(row({ kind: 'suite', outcome: 'failed' }), on), false,
    'JavaRerunFailedTestsAction.java:22-30 的 and(LEAF)：childCount 未知的 suite 按「有孩子」处理 ⇒ 不进重跑集')
})

test('开关关掉：只剩 FAILED_OR_INTERRUPTED.and(IGNORED.not())（:140）', () => {
  assert.equal(rerunFailureAccepted(row({ outcome: 'failed' }), off), true)
  assert.equal(rerunFailureAccepted(row({ outcome: null }), off), false, '非通过不再算进来')
  assert.equal(rerunFailureAccepted(row({ outcome: 'skipped' }), off), false)
  assert.equal(rerunFailureAccepted(row({ outcome: 'passed' }), off), false)
})

test('isRerunLeaf：LEAF 判的是孩子数（SMTestProxy.java:238-240），不是 kind', () => {
  assert.equal(isRerunLeaf(row({})), true, '本仓的测试节点在 build() 里 children 恒空')
  assert.equal(isRerunLeaf(row({ kind: 'suite', childCount: 3 })), false, '有孩子的 suite ⇒ 非叶，挡掉')
  assert.equal(isRerunLeaf(row({ kind: 'suite', childCount: 0 })), true,
    '没有孩子的 suite 在上游就是叶子（类加载即崩那一档）')
  assert.equal(isRerunLeaf(row({ kind: 'suite' })), false, 'childCount 不填按「有孩子」处理：拿不准就少跑，不多跑')
  // 反证（这条判据不是空转）：同一 kind、只有孩子数不同 ⇒ 结论必须相反。
  assert.notEqual(isRerunLeaf(row({ kind: 'suite', childCount: 0 })), isRerunLeaf(row({ kind: 'suite', childCount: 1 })),
    '这条 max 断言只在「两种孩子数都能构造出来」时才有意义 ⇒ 上面两条就是它的阳性/阴性对照')
})

test('rerunFailureNames：按重跑集出名字，顺序稳定（同一份节点表进出一次）', () => {
  const rows = [
    row({ name: 'adds', outcome: 'passed' }),
    row({ name: 'subtracts', outcome: 'failed' }),
    row({ name: 'multiplies', outcome: null }),
    row({ name: 'divides', outcome: 'skipped' }),
    row({ name: 'S', kind: 'suite', outcome: 'failed' }),
  ]
  assert.deepEqual(rerunFailureNames(rows, on), ['subtracts', 'multiplies'])
  assert.deepEqual(rerunFailureNames(rows, off), ['subtracts'])
})

test('重跑集形状：一个类里 1 条失败 + 一个压根没跑起来的类 ⇒ 默认档两条、关档只留失败那条', () => {
  const rows = [
    row({ name: 'MathTest', kind: 'suite', outcome: 'failed', childCount: 1 }),
    row({ name: 'adds', outcome: 'failed' }),
    row({ name: 'CrashedTest', kind: 'suite', outcome: null, childCount: 0 }),
    row({ name: 'stillRunning', outcome: null }),
    row({ name: 'ignored', outcome: 'skipped' }),
  ]
  // 前提断言（防空过）：这张候选表里必须**同时**存在「有孩子的类」与「没孩子的类」，
  // 否则 LEAF 那一条永远只在一种形状上被验（本项目发生过夹具产不出两个分支 ⇒ max 断言空转）。
  assert.equal(rows.filter(item => item.kind === 'suite' && item.childCount === 0).length, 1, '夹具：没跑起来的类恰好一条')
  assert.equal(rows.filter(item => item.kind === 'suite' && (item.childCount ?? 0) > 0).length, 1, '夹具：有孩子的类恰好一条')
  assert.equal(rows.filter(item => item.outcome === null && item.kind === 'test').length, 1, '夹具：没跑完的测试恰好一条')
  assert.deepEqual(rerunFailureNames(rows, on), ['adds', 'CrashedTest', 'stillRunning'],
    '默认档 = NOT_PASSED ∪ FAILED_OR_INTERRUPTED，再 ¬IGNORED，再 LEAF：方法 + 没跑起来的类 + 没跑完的方法')
  assert.deepEqual(rerunFailureNames(rows, off), ['adds'], '关档 = FAILED_OR_INTERRUPTED：两类未跑成的都不算')
})

test('notFinished()：报过 testStarted、却没有任何结束事件的测试（重跑集里「没跑成」那一档的来源）', () => {
  const builder = new TestTreeBuilder()
  const line = event => formatTestEvent(event) + '\n'
  builder.feed(line({ kind: 'suiteStarted', name: 'com.foo.MathTest', id: 's1' }))
  builder.feed(line({ kind: 'testStarted', name: 'adds', id: 't1', parent: 's1' }))
  builder.feed(line({ kind: 'testFinished', name: 'adds', id: 't1', parent: 's1' }))
  builder.feed(line({ kind: 'testStarted', name: 'subtracts', id: 't2', parent: 's1' }))
  builder.feed(line({ kind: 'testStarted', name: 'crashed', id: 't3', parent: 's1' }))
  builder.feed(line({ kind: 'testFailed', name: 'crashed', id: 't3', parent: 's1', message: 'boom' }))
  const pending = builder.notFinished()
  assert.deepEqual(pending.map(entry => entry.name), ['subtracts'], '跑完的、失败过的都不算，只留下卡在开始的那条')
  assert.equal(pending[0].id, 'sm:t2')
  builder.feed(line({ kind: 'testFinished', name: 'subtracts', id: 't2', parent: 's1' }))
  assert.deepEqual(builder.notFinished(), [], '补上结束事件就清空')
})

test('notStartedSuites()：只报 suiteStarted、没孩子也没闭合的类（上游 "Non-Started" 那一支的取数处）', () => {
  const builder = new TestTreeBuilder()
  const line = event => formatTestEvent(event) + '\n'
  // (a) 跑过并失败的类：有孩子 ⇒ `isLeaf()` 为假 ⇒ LEAF 该挡（这正是「一个套件下只有一个失败测试」的形状）
  builder.feed(line({ kind: 'suiteStarted', name: 'com.foo.MathTest', id: 'sa' }))
  builder.feed(line({ kind: 'testStarted', name: 'adds', id: 'ta', parent: 'sa' }))
  builder.feed(line({ kind: 'testFailed', name: 'adds', id: 'ta', parent: 'sa', message: 'boom' }))
  builder.feed(line({ kind: 'suiteFinished', name: 'com.foo.MathTest', id: 'sa' }))
  // (c) 空类但**闭合了**：上游 EMPTY_SUITE = COMPLETE_INDEX ⇒ isPassed ⇒ 连 NOT_PASSED 都过不了
  builder.feed(line({ kind: 'suiteStarted', name: 'com.foo.EmptyTest', id: 'sc' }))
  builder.feed(line({ kind: 'suiteFinished', name: 'com.foo.EmptyTest', id: 'sc' }))
  // (b) 类被报出来、一条测试都没长、也还没闭合（类加载即崩）：上游的 Non-Started。
  //     必须**放在最后**喂：`src/testTree.ts` 的 `apply()` 里 suite 层级是**栈**语义
  //     （`pathOf` 的 `this.open.at(-1)`），一条没闭合的 suite 会把后面报的 suite 当自己的孩子吞进去，
  //     那样 (c) 的路径就不是我以为的那条了（真机上这条也不存在：进程死了就没有后续事件）。
  builder.feed(line({ kind: 'suiteStarted', name: 'com.foo.CrashedTest', id: 'sb' }))

  // 前提断言（防空过）：三种形状必须真的都长出来，并且 (b) 与 (c) 的**唯一**差别是「闭合」——
  // 少了这两条，下面那三条断言就只是在赌构建器还没坏。
  const tree = builder.build(new Map([['sm:ta', { id: 'sm:ta', name: 'adds', outcome: 'failed' }]]))
  const failedClass = findNode(tree, 'com.foo.MathTest')
  const crashed = findNode(tree, 'com.foo.CrashedTest')
  const empty = findNode(tree, 'com.foo.EmptyTest')
  assert.ok(failedClass && crashed && empty, '夹具：三个类都在树上')
  assert.equal(failedClass.children.length, 1, '夹具：(a) 真的有一个孩子（LEAF 有东西可挡）')
  assert.equal(crashed.children.length, 0, '夹具：(b) 真的没孩子')
  assert.equal(empty.children.length, 0, '夹具：(c) 也没孩子 ⇒ (b)/(c) 的差别只剩闭合')
  assert.equal(crashed.endTimeMillis, null, '夹具：(b) 没闭合')
  assert.notEqual(empty.endTimeMillis, null, '夹具：(c) 闭合了')

  assert.deepEqual(builder.notStartedSuites().map(entry => entry.name), ['CrashedTest'],
    '只交 (b)：有孩子的被 LEAF 挡，闭合的空类被 isPassed 挡')
  // 取数处 → 过滤器 → 重跑集：整条链在默认档里真收进这条类，关档就退回空集。
  const neverStarted = builder.notStartedSuites().map(entry => row({ name: entry.name, kind: 'suite', outcome: null, childCount: 0 }))
  assert.deepEqual(rerunFailureNames(neverStarted, on), ['CrashedTest'])
  assert.deepEqual(rerunFailureNames(neverStarted, off), [], '关档 = FAILED_OR_INTERRUPTED：没跑起来的类不算')
  builder.feed(line({ kind: 'suiteFinished', name: 'com.foo.CrashedTest', id: 'sb' }))
  assert.deepEqual(builder.notStartedSuites(), [], '补上闭合事件就清空（跑完的空类不是失败）')
})

test('文案常量直译自 ExecutionBundle.properties:157', () => {
  assert.equal(INCLUDE_NON_STARTED_NAME, 'Include Non-Started Tests in Rerun Failed')
})

test('消费链：面板的重跑集走过滤器，开关用户可见', () => {
  const panel = read('src/components/TestRunnerPanel.vue')
  assert.match(panel, /const rerunFilter = ref\(\{ \.\.\.DEFAULT_RERUN_FAILURE_FILTER \}\)/,
    '默认值取自模块（上游 `:58` true），不在面板里重抄字面量')
  assert.match(panel, /const done = \[\.\.\.results\.value\.values\(\)\]\.map\(toCandidate\)/,
    '有结果的那批（passed/failed/skipped）进重跑集的候选表')
  assert.match(panel, /const stuck = treeBuilder\.notFinished\(\)\.map\(toPendingCandidate\)/,
    '报过开始却没跑完的那批也进来 —— 上游判的是 `getAllTests()`（`AbstractRerunFailedTestsAction.java:111`）')
  assert.match(panel, /const neverStarted = treeBuilder\.notStartedSuites\(\)\.map\(toNeverStartedCandidate\)/,
    '压根没跑起来的类也进来 —— 上游属性名里的 "Non-Started"，判据 §1③')
  assert.match(panel, /kind: 'suite', outcome: null, childCount: 0/,
    'LEAF 在面板侧也按「孩子数为 0」交，不在面板里重述 kind 一刀切')
  assert.match(panel, /rerunFailureNames\(\[\.\.\.done, \.\.\.stuck, \.\.\.neverStarted\], rerunFilter\.value\)/,
    '三条合流后只过那一条过滤器，不在面板里重述代数')
  assert.match(panel, /rerunCommand\([\s\S]{0,200}rerunNames\.value\)/, '拼命令那一步没换：还是 src/testRunner.ts 的 rerunCommand')
  assert.match(panel, /:disabled="running \|\| !rerunNames\.length"/,
    '可用性门控跟着重跑集走（上游 isActive 的「一条都没有就不让点」，AbstractRerunFailedTestsAction.java:94-117）')
  assert.match(panel, /INCLUDE_NON_STARTED_NAME[\s\S]{0,200}toggleRerunFilter/, '开关在工具栏上真能点（上游 JUnitConsoleProperties.java:50）')
  assert.equal((panel.match(/@click="toggleRerunFilter"/g) ?? []).length, 1,
    '本批**没有**新加控件：上游工具栏就一条属性开关（`JUnitConsoleProperties.java:50`），这里也只能有一处')
})
