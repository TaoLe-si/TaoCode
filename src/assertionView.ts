// 失败断言的「预期 / 实际」两列视图 —— IDEA Test Runner 失败详情里的那个并排面板。
//
// IDEA 侧的证据链：`SMTestRunnerResultsForm` 把失败节点的 `getErrorMessage()` 交给
// `StackTraceFilter` / `AssertionFailedError` 渲染；`ExpectedPatterns` 定义了各测试框架
// 输出 expected/actual 的常见形状（JUnit 的 `expected:<x> but was:<y>`、TestNG 的
// `expected [x] but found [y]`、AssertJ 的 `expected: x but was: y`）。本仓不移植 Swing
// 组件，但**抽值与并排显示是用户可见行为**，所以这里做纯函数：先从失败文本里抽
// `{expected, actual}`，抽不出来就原样返回整段（绝不臆造）。
//
// 另外，结果行（`✔ name` / `1) Class.method` …）之间的**普通输出行**是失败详情：IDEA 的
// test framework 也是这么收的（失败节点把后续输出挂在 error message 上）。`TestResultFeed`
// 把「结果行 → 结果表 + 失败集、其余行 → 当前失败详情」这条流做成可测的纯状态机，
// 面板只负责把运行输出喂进来（`runOutput`，见 src/runInstances.ts）。结果的第一来源是
// **结构化事件行**（`##taocode[...]`，见 src/testEventChannel.ts 的 smRunner 对照），
// 文本解析只是认不出事件时的回退。
import { FailedSet, parseResultLine, TestEventChannel, TEST_EVENT_PREFIX, type TestResult } from './testRunner.ts'

export interface AssertionView {
  /** 结构化抽出的期望值；null = 这段失败文本里没有这个形状。 */
  expected: string | null
  /** 结构化抽出的实际值；null = 没有这个形状。 */
  actual: string | null
  /** 原始失败文本（总是给了，抽不出结构时面板显示它）。 */
  text: string
}

const compact = (value: string): string => value.replace(/\r/g, '').trim()

/**
 * 从失败详情里抽 expected/actual。识别的形状（按上游各框架的实际输出）：
 *   1. JUnit 4/5：`expected:<4> but was:<5>`
 *   2. TestNG / PHPUnit：`expected [4] but found [5]`
 *   3. AssertJ / Kotlin.test：`expected: 4 but was: 5`（同一行）
 *   4. node:test assert.strictEqual：`Expected values to be strictly equal:` + `+ actual - expected` 块
 *   5. pytest：`assert 1 == 2`（左操作数是实际值、右是期望值）
 */
export function assertionView(lines: readonly string[]): AssertionView {
  const text = compact(lines.join('\n'))
  const junit = /expected:\s*<([\s\S]*?)>\s*but was:\s*<([\s\S]*?)>/i.exec(text)
  if (junit) return { expected: compact(junit[1]!), actual: compact(junit[2]!), text }
  const testng = /expected\s*\[([\s\S]*?)\]\s*but (?:was|found)\s*\[([\s\S]*?)\]/i.exec(text)
  if (testng) return { expected: compact(testng[1]!), actual: compact(testng[2]!), text }
  const inline = /expected:?\s*(\S[^\n]*?)\s*but (?:was|found):?\s*(\S[^\n]*)$/im.exec(text)
  if (inline) return { expected: compact(inline[1]!), actual: compact(inline[2]!), text }
  const node = nodeAssertionView(text)
  if (node) return node
  const pytest = /^.*assert\s+([^\n=]{1,200}?)\s*==\s*([^\n]{1,200})$/m.exec(text)
  if (pytest) return { expected: compact(pytest[2]!), actual: compact(pytest[1]!), text }
  return { expected: null, actual: null, text }
}

/** node:test 的严格相等失败：标题行 + `+ actual - expected` 块（`+` 是实际、`-` 是期望）。 */
function nodeAssertionView(text: string): AssertionView | null {
  if (!/Expected values to be (?:strictly|loosely) equal/.test(text)) return null
  let expected: string | null = null
  let actual: string | null = null
  for (const raw of text.split('\n')) {
    const line = raw.trim()
    if (line === '+ actual - expected' || line === '- expected + actual') continue
    if (actual === null && line.startsWith('+ ')) actual = compact(line.slice(2))
    else if (expected === null && line.startsWith('- ')) expected = compact(line.slice(2))
  }
  if (actual === null && expected === null) return null
  return { expected, actual, text }
}

/** 一条失败最多记住的详情行数（面板只显示前几行，这里防的是无界增长）。 */
export const FAILURE_DETAIL_LIMIT = 200

/**
 * 测试输出的增量喂入器。`feedLine` 返回这次消费出来的结果行（没消费到返回 null），
 * 普通行在「上一条结果行是失败」时挂到那条失败的详情里 —— 这就是失败重跑（FailedSet）
 * 与断言视图共用的数据源。喂入是逐行的，所以要按输出顺序调用。
 *
 * 结果的两条来源与优先级：**先结构化事件**（`##taocode[...]`，见 src/testEventChannel.ts /
 * 上游 `SMTestRunnerConnectionUtil` 那条链），认不出该行才退回文本解析。运行输出按块到达时
 * 用 `feedChunk`：结构化事件行可能被块边界截断（上游 `OutputEventSplitter` 处理的同一件事）。
 */
export class TestResultFeed {
  readonly results = new Map<string, TestResult>()
  readonly failed = new FailedSet()
  /** 结构化事件通道（`smRunner` 等价物）：结果表/失败集/失败详情的第一来源。 */
  readonly channel = new TestEventChannel()
  private readonly details = new Map<string, string[]>()
  private current: string | null = null
  private lastFailed: string | null = null
  /** 上一块留下的、可能被截断的事件行残段。 */
  private pending = ''

  feedLine(line: string): TestResult | null {
    const structured = this.channel.apply(line)
    if (structured) {
      const result = structured.result
      this.results.set(result.id, result)
      this.failed.apply(result)
      this.current = result.outcome === 'failed' ? result.id : null
      if (result.outcome === 'failed') this.lastFailed = result.id
      else if (this.lastFailed === result.id) this.lastFailed = null
      return result
    }
    const result = parseResultLine(line)
    if (result) {
      this.results.set(result.id, result)
      this.failed.apply(result)
      // 失败行之后的输出属于这条失败；通过/跳过的行不挂详情。失败行**本身**也进详情
      // （它的行内断言文本是别的字段装不下的，例如 JUnit 的 `expected:<4> but was:<5>`）。
      this.current = result.outcome === 'failed' ? result.id : null
      if (result.outcome === 'failed') {
        this.details.set(result.id, [line])
        this.lastFailed = result.id
      } else if (this.lastFailed === result.id) this.lastFailed = null
      return result
    }
    if (this.current && line.trim()) {
      const list = this.details.get(this.current) ?? []
      if (list.length < FAILURE_DETAIL_LIMIT) {
        list.push(line)
        this.details.set(this.current, list)
      }
    }
    return null
  }

  /**
   * 按输出块喂入（`runOutput` 的元素）。块内先按换行切；**以事件前缀开头、且没有以 `]` 收尾**的
   * 残段留到下一块（这一条事件被 flush 截断了）；普通文本残段照旧即时消费（不改变旧行为）。
   */
  feedChunk(chunk: string): TestResult[] {
    const produced: TestResult[] = []
    this.pending += chunk
    let index: number
    while ((index = this.pending.indexOf('\n')) >= 0) {
      const line = this.pending.slice(0, index)
      this.pending = this.pending.slice(index + 1)
      const result = this.feedLine(line)
      if (result) produced.push(result)
    }
    if (this.pending.trimStart().startsWith(TEST_EVENT_PREFIX) && !this.pending.trimEnd().endsWith(']'))
      return produced
    if (this.pending) {
      const result = this.feedLine(this.pending)
      if (result) produced.push(result)
    }
    this.pending = ''
    return produced
  }

  /** 一条失败的全部详情行（按喂入顺序）：结构化事件给的详情 + 后续文本行，结构化在前。 */
  detailLines(id: string): string[] {
    const structured = this.channel.detailLines(id)
    const text = this.details.get(id) ?? []
    return structured.length ? [...structured, ...text] : text
  }

  /** 该失败的断言两列视图：结构化 expected/actual 优先，其次文本抽取，最后结构化文本。 */
  view(id: string): AssertionView {
    const structured = this.channel.view(id)
    if (structured && (structured.expected !== null || structured.actual !== null)) return structured
    const text = assertionView(this.detailLines(id))
    if (text.expected !== null || text.actual !== null) return text
    return structured ?? text
  }

  /** 最近一条仍失败的测试 id —— 面板默认就显示它。 */
  latestFailedId(): string | null { return this.lastFailed }

  reset(): void {
    this.results.clear()
    this.failed.clear()
    this.details.clear()
    this.channel.reset()
    this.pending = ''
    this.current = null
    this.lastFailed = null
  }
}
