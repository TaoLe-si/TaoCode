// exec/sm-runner：**结构化测试事件通道** —— 上游 `SMTestRunnerConnectionUtil` 那条链的等价物。
//
// 上游证据链（`platform/smRunner/src/com/intellij/execution/testframework/sm/`）：
//   · `SMTestRunnerConnectionUtil.createAndAttachConsole` 把测试控制台挂到 `ProcessHandler` 上；
//     数据面不是 socket，而是**进程 stdout 上的 TeamCity service message**（`##teamcity[...]`）——
//     构造在 `ServiceMessageBuilder`、解析在 `ServiceMessageUtil`；
//   · `OutputToGeneralTestEventsConverter` 把服务消息转成 `events/` 的事件对象
//     （`TestStartedEvent` / `TestSuiteStartedEvent` / `TestFailedEvent` / `TestFinishedEvent` /
//     `TestIgnoredEvent` / `TestOutputEvent` / `TestSuiteFinishedEvent`），认不出的普通文本走
//     `onUncapturedOutput`（进控制台，不伪造结果）；
//   · 事件喂给 `GeneralTestEventsProcessor`（id 版是 `GeneralIdBasedToSMTRunnerEventsConvertor`，
//     负责按 `parent` 建层级），由 `states/` 的状态机决定节点呈现（`TestPassedState` /
//     `TestFailedState` / `TestComparisonFailedState` / `TestIgnoredState`…）；
//   · `OutputEventSplitter` 专门处理"输出按块 flush、一条服务消息可能被截断"的实情；
//   · `ui/SMTestRunnerResultsForm` / `TestTreeRenderer` 是 Swing 组件本体，本仓不搬。
//
// 本仓的等价物就是这里：给测试进程约定一行**机器可读事件**（`##taocode[{...}]`，JSON 与 TeamCity
// 服务消息同构，字段名对齐 `events/` 的事件类），`TestEventChannel` 是事件状态机，
// 消费方是 `src/assertionView.ts` 的 `TestResultFeed`（结果表 + 失败集）与测试面板。
// 认不出来的行一律返回 null —— 通道绝不臆造结果，普通文本仍走原来的逐行解析。
//
// 事件形状（字段都可省，kind 必填；与 `events/` 的对应）：
//   {"kind":"suiteStarted","name":"MathTest","id":"s1","parent":"s0","locationHint":"MathTest.java:3"}
//   {"kind":"suiteFinished","name":"MathTest","id":"s1"}
//   {"kind":"testStarted","name":"adds","id":"t1","parent":"s1","locationHint":"MathTest.java:12"}
//   {"kind":"testFinished","name":"adds","id":"t1","durationMs":12}
//   {"kind":"testFailed","name":"adds","id":"t1","message":"expected:<4> but was:<5>","details":"at …",
//    "expected":"4","actual":"5"}
//   {"kind":"testIgnored","name":"slow","id":"t2","message":"flaky"}
//   {"kind":"testOutput","id":"t1","output":"some stdout line","stderr":true}
import type { TestOutcome, TestResult } from './testRunner.ts'

/** 事件行的固定前缀（与 TeamCity 的 `##teamcity[` 对称）。 */
export const TEST_EVENT_PREFIX = '##taocode['

export type TestEventKind =
  | 'suiteStarted' | 'suiteFinished'
  | 'testStarted' | 'testFinished' | 'testFailed' | 'testIgnored'
  | 'testOutput'

const EVENT_KINDS: readonly TestEventKind[] =
  ['suiteStarted', 'suiteFinished', 'testStarted', 'testFinished', 'testFailed', 'testIgnored', 'testOutput']

/** 一条结构化事件（字段是 `events/` 事件类的最小并集）。 */
export interface TestEvent {
  kind: TestEventKind
  /** 展示名（`TreeNodeEvent` 的名字）。 */
  name?: string
  /** 稳定 id；给了 id 就按 id 配对（`GeneralIdBasedToSMTRunnerEventsConvertor` 的口径）。 */
  id?: string
  /** 父节点 id（树的层级）。 */
  parent?: string
  /** 源码位置提示，形如 `Foo.java:12`（`TestStartedEvent` 的 locationHint）。 */
  locationHint?: string
  durationMs?: number
  message?: string
  details?: string
  /** `TestComparisonFailedState` 的 expected/actual（两边都给才算比较失败）。 */
  expected?: string
  actual?: string
  /** `testOutput` 的输出行。 */
  output?: string
  stderr?: boolean
}

const STRING_KEYS = ['name', 'id', 'parent', 'locationHint', 'message', 'details', 'expected', 'actual', 'output'] as const

/** 解析一行；不是事件行（前缀/括号/JSON/kind 任一不成立）返回 null，从不抛异常。 */
export function parseTestEvent(line: string): TestEvent | null {
  const text = line.trim()
  if (!text.startsWith(TEST_EVENT_PREFIX) || !text.endsWith(']')) return null
  let raw: unknown
  try { raw = JSON.parse(text.slice(TEST_EVENT_PREFIX.length, -1)) } catch { return null }
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return null
  const record = raw as Record<string, unknown>
  if (typeof record.kind !== 'string' || !EVENT_KINDS.includes(record.kind as TestEventKind)) return null
  const event: TestEvent = { kind: record.kind as TestEventKind }
  for (const key of STRING_KEYS) {
    const value = record[key]
    if (typeof value === 'string' && value !== '') event[key] = value
  }
  const duration = record.durationMs
  if (typeof duration === 'number' && Number.isFinite(duration) && duration >= 0) event.durationMs = duration
  if (typeof record.stderr === 'boolean') event.stderr = record.stderr
  return event
}

/** 事件的序列化（`ServiceMessageBuilder` 的等价物）：适配器/测试用它产出通道能认的行。 */
export function formatTestEvent(event: TestEvent): string {
  const payload: Record<string, string | number | boolean> = { kind: event.kind }
  for (const key of STRING_KEYS) {
    const value = event[key]
    if (value !== undefined && value !== '') payload[key] = value
  }
  if (event.durationMs !== undefined) payload.durationMs = event.durationMs
  if (event.stderr !== undefined) payload.stderr = event.stderr
  return `${TEST_EVENT_PREFIX}${JSON.stringify(payload)}]`
}

/** 结构化失败详情（与 `src/assertionView.ts` 的 `AssertionView` 同形，不 import 以免环）。 */
export interface StructuredFailureView { expected: string | null; actual: string | null; text: string }

/** 认出来的一次事件产物：结果（进结果表/失败集）+ 失败详情（断言并排视图的输入）。 */
export interface ChannelOutcome { result: TestResult; view: StructuredFailureView | null }

/** 一个节点的输出/失败详情上限（上游 `LongLineCutter` 之外的另一道防无界增长）。 */
export const CHANNEL_OUTPUT_LIMIT = 200

interface TestNode { key: string; name: string; parent: string | null; suite: boolean }
interface FailureDetail { message: string; details: string; expected: string | null; actual: string | null }

/**
 * 事件 → 结果的状态机（`GeneralTestEventsProcessor` + `states/` 的等价物）。`apply` 逐行调用；
 * 结果 id 统一带 `sm:` 前缀，与文本解析（`npm:`/`ctest:`/`junit:`）各自成键、互不覆盖。
 */
export class TestEventChannel {
  private readonly nodes = new Map<string, TestNode>()
  /** 当前打开的 suite 链（`TestSuiteStack` 的等价物），决定无名事件的归属。 */
  private readonly suites: string[] = []
  private readonly outcomes = new Map<string, TestResult>()
  private readonly failures = new Map<string, FailureDetail>()
  private readonly outputs = new Map<string, string[]>()
  private current: string | null = null

  /** 一行事件 → 结果（`suiteStarted`/`testStarted`/`testOutput` 不产出结果，返回 null）。 */
  apply(line: string): ChannelOutcome | null {
    const event = parseTestEvent(line)
    if (!event) return null
    if (event.kind === 'suiteStarted') {
      const key = this.keyOf(event, true)
      if (key) { const node = this.nodes.get(key); if (node) node.suite = true; if (!this.suites.includes(key)) this.suites.push(key) }
      this.current = null
      return null
    }
    if (event.kind === 'suiteFinished') {
      const key = this.keyOf(event, false)
      const at = key === null ? -1 : this.suites.lastIndexOf(key)
      if (at >= 0) this.suites.splice(at, 1)
      return null
    }
    if (event.kind === 'testStarted') {
      this.current = this.keyOf(event, true)
      return null
    }
    if (event.kind === 'testOutput') {
      const key = this.keyOf(event, true)
      if (key === null) return null
      const list = this.outputs.get(key) ?? []
      if (list.length < CHANNEL_OUTPUT_LIMIT) { list.push(event.output ?? ''); this.outputs.set(key, list) }
      return null
    }
    const key = this.keyOf(event, true)
    if (key === null) return null
    if (event.kind === 'testFailed') {
      this.current = key
      this.failures.set(key, { message: event.message ?? '', details: event.details ?? '',
                                expected: event.expected ?? null, actual: event.actual ?? null })
      return this.emit(key, event, 'failed')
    }
    if (event.kind === 'testIgnored') {
      this.current = null
      const result: TestResult = { id: this.resultId(key), name: this.nameOf(key, event), outcome: 'skipped',
                                   ...(event.message ? { message: event.message } : {}) }
      this.outcomes.set(key, result)
      return { result, view: this.viewOf(key) }
    }
    // testFinished：失败过的保持 failed（`states/` 的口径 —— 结束事件不洗掉失败），否则 passed。
    this.current = null
    const previous = this.outcomes.get(key)
    if (previous && previous.outcome === 'failed')
      return { result: { ...previous, ...(event.durationMs !== undefined ? { durationMs: event.durationMs } : {}) }, view: this.viewOf(key) }
    return this.emit(key, event, 'passed')
  }

  /** 结果 id → 该失败的详情/输出行（喂给面板的失败详情区）。 */
  detailLines(resultId: string): string[] {
    const key = this.keyOfResult(resultId)
    if (key === null) return []
    const failure = this.failures.get(key)
    if (!failure) return [...(this.outputs.get(key) ?? [])]
    return [failure.message, failure.details, ...(this.outputs.get(key) ?? [])].filter(Boolean)
  }

  /** 结果 id → 结构化失败视图；这个节点没有失败/输出时返回 null（让文本解析接管）。 */
  view(resultId: string): StructuredFailureView | null {
    const key = this.keyOfResult(resultId)
    return key === null ? null : this.viewOf(key)
  }

  /** 结果 id → `Suite.test` 形式的全名（上游树的层级；本仓面板是平表，先留结构给后续分组）。 */
  fullName(resultId: string): string {
    const key = this.keyOfResult(resultId)
    if (key === null) return resultId
    const path: string[] = []
    let node: TestNode | undefined = this.nodes.get(key)
    while (node) {
      path.unshift(node.name)
      node = node.parent ? this.nodes.get(node.parent) : undefined
    }
    return path.length ? path.join('.') : resultId
  }

  reset(): void {
    this.nodes.clear(); this.suites.length = 0; this.outcomes.clear()
    this.failures.clear(); this.outputs.clear(); this.current = null
  }

  private emit(key: string, event: TestEvent, outcome: TestOutcome): ChannelOutcome {
    const result: TestResult = { id: this.resultId(key), name: this.nameOf(key, event), outcome,
                                 ...(event.durationMs !== undefined ? { durationMs: event.durationMs } : {}),
                                 ...(event.message ? { message: event.message } : {}) }
    this.outcomes.set(key, result)
    return { result, view: this.viewOf(key) }
  }

  private viewOf(key: string): StructuredFailureView | null {
    const failure = this.failures.get(key)
    const outputs = this.outputs.get(key) ?? []
    if (!failure && !outputs.length) return null
    const text = [failure?.message, failure?.details, ...outputs].filter(Boolean).join('\n')
    return { expected: failure?.expected ?? null, actual: failure?.actual ?? null, text }
  }

  private resultId(key: string): string { return `sm:${key}` }
  private keyOfResult(resultId: string): string | null {
    return resultId.startsWith('sm:') ? resultId.slice(3) : null
  }
  private nameOf(key: string, event: TestEvent): string { return event.name ?? this.nodes.get(key)?.name ?? key }

  /**
   * 事件 → 节点 key。显式 id 直接用；否则按 `parent::name` 找，找不到再退回当前 suite 下的同名节点，
   * 最后才是"最近注册的同名节点"（无 id 协议里重名测试的兜底；上游要求测试名唯一）。
   */
  private keyOf(event: TestEvent, create: boolean): string | null {
    if (event.id) {
      // 显式 id 的节点：父链优先取事件里的 parent，其次挂到当前打开的 suite（只给 id 不给 parent
      // 的适配器也就能落进正确的层级）。
      if (create && !this.nodes.has(event.id))
        this.nodes.set(event.id, { key: event.id, name: event.name ?? event.id,
                                   parent: event.parent ?? this.suites.at(-1) ?? null, suite: false })
      return event.id
    }
    if (!event.name) return this.current
    const parent = event.parent ?? this.suites.at(-1) ?? null
    const scoped = parent ? `${parent}::${event.name}` : event.name
    if (this.nodes.has(scoped)) return scoped
    const candidates = [...this.nodes.values()].filter(node => !node.suite && node.name === event.name)
    const inSuite = (parent ? candidates.filter(node => node.parent === parent) : candidates).pop()
    if (inSuite) return inSuite.key
    if (candidates.length && !create) return candidates[candidates.length - 1]!.key
    if (!create) return null
    this.nodes.set(scoped, { key: scoped, name: event.name, parent, suite: false })
    return scoped
  }
}
