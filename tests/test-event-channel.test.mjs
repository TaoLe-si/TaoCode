// exec/sm-runner 结构化事件通道（`src/testEventChannel.ts`）的判据。
//
// 上游依据（`platform/smRunner`）：`SMTestRunnerConnectionUtil.createAndAttachConsole` 挂在
// `ProcessHandler` 上的测试控制台，数据面是 stdout 上的 TeamCity service message
// （`ServiceMessageBuilder` / `ServiceMessageUtil`），由 `OutputToGeneralTestEventsConverter`
// 转成 `events/` 的事件对象、交给 `GeneralTestEventsProcessor` 与 `states/` 的状态机，
// `OutputEventSplitter` 负责"消息被 flush 截断"的实情。这里逐条钉住本仓的等价物：
// 协议解析（认错就返回 null，不臆造）、状态机（失败不被 finish 洗掉、ignored、层级）、
// 以及喂入器**先事件后文本**的优先级与分块缓存。
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
const {
  TestEventChannel, parseTestEvent, formatTestEvent, TEST_EVENT_PREFIX,
} = await import('../src/testRunner.ts')
const { TestResultFeed } = await import('../src/assertionView.ts')

const event = (value) => formatTestEvent(value)

test('协议：合法事件行解析，前缀/括号/JSON/kind 任一不成立都返回 null', () => {
  const parsed = parseTestEvent(event({ kind: 'testStarted', name: 'adds', id: 't1', parent: 's1', locationHint: 'MathTest.java:12' }))
  assert.deepEqual(parsed, { kind: 'testStarted', name: 'adds', id: 't1', parent: 's1', locationHint: 'MathTest.java:12' })
  assert.equal(parseTestEvent('普通输出行'), null)
  assert.equal(parseTestEvent('##tc[{"kind":"testStarted"}]'), null, '前缀不对')
  assert.equal(parseTestEvent(`${TEST_EVENT_PREFIX}{"kind":"testStarted"`), null, '没有收尾括号')
  assert.equal(parseTestEvent(`${TEST_EVENT_PREFIX}not json]`), null, '不是 JSON')
  assert.equal(parseTestEvent(`${TEST_EVENT_PREFIX}[1,2,3]]`), null, '不是对象')
  assert.equal(parseTestEvent(`${TEST_EVENT_PREFIX}{"kind":"noSuchKind"}]]`), null, '不认识的 kind')
  assert.equal(parseTestEvent(`${TEST_EVENT_PREFIX}{"name":"x"}]]`), null, '缺 kind')
  // JSON 里的坏字段类型被丢掉，不影响这条事件本身（durationMs 负数/字符串都不认）。
  const loose = parseTestEvent(`${TEST_EVENT_PREFIX}{"kind":"testFinished","name":"a","durationMs":-3,"stderr":"yes"}]`)
  assert.deepEqual(loose, { kind: 'testFinished', name: 'a' })
})

test('协议：formatTestEvent 与 parseTestEvent 往返（ServiceMessageBuilder 的等价物）', () => {
  const line = event({ kind: 'testFailed', name: 'adds', id: 't1', message: 'expected:<4> but was:<5>', expected: '4', actual: '5' })
  assert.ok(line.startsWith(TEST_EVENT_PREFIX) && line.endsWith(']'))
  assert.deepEqual(parseTestEvent(line), { kind: 'testFailed', name: 'adds', id: 't1',
    message: 'expected:<4> but was:<5>', expected: '4', actual: '5' })
})

test('状态机：suite/test 通过流，duration 进结果（TestPassedState）', () => {
  const channel = new TestEventChannel()
  assert.equal(channel.apply(event({ kind: 'suiteStarted', name: 'MathTest', id: 's1', locationHint: 'MathTest.java:3' })), null)
  assert.equal(channel.apply(event({ kind: 'testStarted', name: 'adds', id: 't1', parent: 's1' })), null)
  const outcome = channel.apply(event({ kind: 'testFinished', name: 'adds', id: 't1', durationMs: 12 }))
  assert.deepEqual(outcome.result, { id: 'sm:t1', name: 'adds', outcome: 'passed', durationMs: 12 })
  assert.equal(outcome.view, null)
  assert.equal(channel.apply(event({ kind: 'suiteFinished', id: 's1' })), null)
})

test('状态机：比较失败带 expected/actual，随后的 testFinished 不把 failed 洗成 passed', () => {
  const channel = new TestEventChannel()
  channel.apply(event({ kind: 'testStarted', name: 'adds', id: 't1' }))
  const failed = channel.apply(event({ kind: 'testFailed', name: 'adds', id: 't1',
    message: 'org.opentest4j.AssertionFailedError: expected:<4> but was:<5>', details: 'at MathTest.adds(MathTest.java:12)',
    expected: '4', actual: '5' }))
  assert.equal(failed.result.outcome, 'failed')
  assert.equal(failed.result.message, 'org.opentest4j.AssertionFailedError: expected:<4> but was:<5>')
  assert.deepEqual(failed.view, { expected: '4', actual: '5',
    text: 'org.opentest4j.AssertionFailedError: expected:<4> but was:<5>\nat MathTest.adds(MathTest.java:12)' })
  const finished = channel.apply(event({ kind: 'testFinished', name: 'adds', id: 't1', durationMs: 30 }))
  assert.equal(finished.result.outcome, 'failed')
  assert.equal(finished.result.durationMs, 30)
  assert.equal(channel.view('sm:t1').expected, '4')
})

test('状态机：ignored / testOutput / 层级全名（TestIgnoredState、TestSuiteStack）', () => {
  const channel = new TestEventChannel()
  channel.apply(event({ kind: 'suiteStarted', name: 'MathTest', id: 's1' }))
  channel.apply(event({ kind: 'testStarted', name: 'slow', id: 't2' }))
  channel.apply(event({ kind: 'testOutput', id: 't2', output: 'warming up' }))
  const ignored = channel.apply(event({ kind: 'testIgnored', name: 'slow', id: 't2', message: 'flaky' }))
  assert.equal(ignored.result.outcome, 'skipped')
  assert.deepEqual(channel.detailLines('sm:t2'), ['warming up'])
  assert.equal(channel.fullName('sm:t2'), 'MathTest.slow', 'suite 链给出层级全名')
  // 无 id 的协议：按 parent::name 建键，父链来自当前打开的 suite。
  const derived = new TestEventChannel()
  derived.apply(event({ kind: 'suiteStarted', name: 'A' }))
  derived.apply(event({ kind: 'testStarted', name: 'x' }))
  const done = derived.apply(event({ kind: 'testFinished', name: 'x' }))
  assert.equal(done.result.id, 'sm:A::x')
  assert.equal(derived.fullName('sm:A::x'), 'A.x')
  channel.reset()
  assert.equal(channel.view('sm:t2'), null)
})

test('喂入器：结构化行驱动结果表/失败集/最新失败，文本行仍能回退解析', () => {
  const feed = new TestResultFeed()
  const structured = feed.feedLine(event({ kind: 'testFailed', name: 'adds', id: 't1', expected: '4', actual: '5' }))
  assert.equal(structured.id, 'sm:t1')
  assert.equal(feed.failed.size, 1)
  assert.equal(feed.latestFailedId(), 'sm:t1')
  assert.equal(feed.view('sm:t1').expected, '4')
  // 事件之后的行仍挂到这条失败（普通输出进控制台/详情的那条路）。
  assert.deepEqual(feed.detailLines('sm:t1'), [])
  feed.feedLine('extra stdout line')
  assert.deepEqual(feed.detailLines('sm:t1'), ['extra stdout line'])
  // 文本行（TAP）不受影响，两种来源的 id 各自成键。
  assert.equal(feed.feedLine('✖ beta (1ms)')?.id, 'npm:beta')
  assert.equal(feed.failed.size, 2)
  // 认不出的“事件形状”行退回文本解析：不是合法 JSON 就当普通文本丢掉（不崩、不产生结果）。
  assert.equal(feed.feedLine('##taocode[broken]'), null)
})

test('喂入器：被分块截断的事件行在 feedChunk 里重组（OutputEventSplitter 的等价物）', () => {
  const feed = new TestResultFeed()
  const line = event({ kind: 'testFinished', name: 'adds', id: 't1', durationMs: 7 })
  const cut = Math.floor(line.length / 2)
  assert.deepEqual(feed.feedChunk(line.slice(0, cut)), [], '残段先缓存，不产出也不当文本消费')
  const produced = feed.feedChunk(`${line.slice(cut)}\n`)
  assert.equal(produced.length, 1)
  assert.deepEqual(produced[0], { id: 'sm:t1', name: 'adds', outcome: 'passed', durationMs: 7 })
  assert.ok(feed.results.has('sm:t1'))
  // 没有换行的完整事件行（输出最后一块没有收尾换行）也要消费。
  const feed2 = new TestResultFeed()
  assert.equal(feed2.feedChunk(event({ kind: 'testIgnored', name: 'x', id: 'i1' })).length, 1)
})

test('面板真的接了这条通道（不是死代码）：feedChunk + runOutput + 结构化前缀', () => {
  const panel = readFileSync('src/components/TestRunnerPanel.vue', 'utf8')
  assert.match(panel, /feedChunk/)
  assert.match(panel, /runOutput/)
  assert.match(panel, /##taocode/)
  const runner = readFileSync('src/testRunner.ts', 'utf8')
  assert.match(runner, /testEventChannel/)
  assert.match(runner, /TestEventChannel/)
})
