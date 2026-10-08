// exec/sm-runner / exec/testframework：**从 XML 导入历史测试结果**
// （上游 `sm/runner/history/` 那一族的等价物）。
//
// 上游依据：
//   · `platform/smRunner/src/com/intellij/execution/testframework/sm/runner/history/ImportTestOutputExtension.java:18-31`
//     —— 「导入测试输出」的扩展点（注释点名支持 ant task 那种 XML）；`:33-45` `findHandler`
//     逐个问扩展，**第一个认下这份 XML 的赢**，都不认就用 IDEA 自己导出格式的 handler；
//   · `java/execution/impl/resources/intellij.java.execution.impl.xml:127` 注册了
//     `AntTestContentHandler$AntTestOutputExtension`；
//     `java/execution/impl/src/com/intellij/execution/AntTestContentHandler.java:29-43` ——
//     认格式的方式就是**读根元素名**：`testsuites` 才接手，否则返回 null；
//   · `ImportedTestContentHandler.java:41-129` —— IDEA 自己导出格式（`<testrun>`）的读法：
//     `:42-51` `<suite name location metainfo>` → suiteStarted；`:52-68` `<test name duration
//     status isConfig location metainfo>` → testStarted（`isConfig` 打上 config 标记）；
//     `:69-75` `<output type="stderr">` 切错误流；`:76-78` 根元素给出 root 的名字/注释/位置；
//     `:79-82` `<diff expected actual>` 给出断言两侧；
//     `:91-120` 收尾：`failed`/`error` → onTestFailure（**error 也算失败但带 isError**）、
//     `ignored`/`skipped` → onTestIgnored、**无论什么状态都要 onTestFinished**，
//     duration 缺失写 `-1`（`:113`）；
//   · `AntTestContentHandler.java:81-108` —— ant 格式的映射：`<testsuite name package>` 的位置
//     是 `java:suite://包.类`（`:87-88`），`<testcase name classname time>` 的位置是
//     `java:test://类/名`（`:98-101`）；`<failure>/<error>` 置状态（`:109-117`）、
//     `<skipped>/<ignored>` 置状态；`:137` 遇到认不出的状态**直接抛**（不猜）；
//     `:141-147` `time` 是**秒**，× 1000 转毫秒，解析失败退回 `-1`；
//     `:149-156` `system-out`/`system-err` 变成测试输出（当前没有测试就归成未捕获输出）。
//   · 动作面：`.../history/actions/ImportTestsFromFileAction.java:19-38`
//     —— 文案 `Import Tests from File…`（`SmRunnerBundle.properties:42`）、
//     描述 `Import the results of a test execution from an XML file`（`:43`）、
//     选择框标题 `Choose a File with Tests Result`（`:40`）、非 XML 文件给警告
//     （`:31-36`，标题 `Failed to Parse {0}`，`:39`）；
//   · `ImportTestsGroup.java:24-31/44-60` —— 「Test History」弹层：列出历史会话，
//     按**最后修改时间倒序**（`:53`）、只列还存在的文件（`:52`）；
//   · `AbstractImportTestsAction.java:61` 历史条数键 `test_history_size`、`:84-94` 默认 10、
//     解析失败退回 10、下限 0；
//   · `ImportTestsFromHistoryAction.java:39-53` —— 历史项的显示名：
//     `文件名去掉扩展名` 里最后一个 `" - "` 之后是导出时间戳（格式
//     `SMTestRunnerResultsForm.java:101` = `yyyy.MM.dd 'at' HH'h' mm'm' ss's'`），
//     解析得动就显示成 `<配置名> (<日期时间>)`，否则原样。
//
// 架构不等价的落点：上游是 SAX 流式 handler 喂 `GeneralTestEventsProcessor`；本仓没有 SAX，
// 也没有插件扩展点 ⇒ 这里做成**纯函数**：XML 文本 → 一串结构化事件（`src/testEventChannel.ts`
// 的 `TestEvent`），面板把事件用 `formatTestEvent` 转成 `##taocode[…]` 行喂给现成的
// 通道/结果树/断言视图 —— **同一份处理器，两种来源**，与上游 `ImportedToGeneralTestEventsConverter`
// 继承 `OutputToGeneralTestEventsConverter` 的关系一致（`:29-43`）。
// 消费点：`src/components/TestRunnerPanel.vue` 的「导入测试结果」按钮 + 「测试历史」列表。
// 判据 `tests/test-import.test.mjs`。
import type { TestEvent } from './testEventChannel.ts'

/** 上游 `TestResultsXmlFormatter.java:58-62` 的五个状态串。 */
export const IMPORT_STATUS_PASSED = 'passed'
export const IMPORT_STATUS_FAILED = 'failed'
export const IMPORT_STATUS_ERROR = 'error'
export const IMPORT_STATUS_IGNORED = 'ignored'
export const IMPORT_STATUS_SKIPPED = 'skipped'

/** 上游 `ImportTestsFromFileAction.java:21-23` + `SmRunnerBundle.properties:39-43` 的文案。 */
export const IMPORT_TESTS_NAME = 'Import Tests from File…'
export const IMPORT_TESTS_DESCRIPTION = 'Import the results of a test execution from an XML file'
export const IMPORT_TESTS_CHOOSER_TITLE = 'Choose a File with Tests Result'
export const IMPORT_HISTORY_GROUP_NAME = 'Test History'
export const IMPORT_HISTORY_SIZE_KEY = 'test_history_size'
/** 上游 `AbstractImportTestsAction.java:87-92`：默认 10，坏值退回 10，下限 0。 */
export function importedHistorySize(raw: string | null | undefined): number {
  const text = raw ?? '10'
  const parsed = Number.parseInt(text, 10)
  return Number.isNaN(parsed) ? 10 : Math.max(0, parsed)
}

export interface ImportedRoot { name: string | null; comment: string | null; location: string | null }
export interface ImportedResults {
  /** 'idea' = `<testrun>`（本仓导出格式，可回环）；'ant' = `<testsuites>`。 */
  format: 'idea' | 'ant' | null
  events: TestEvent[]
  root: ImportedRoot | null
  /** 认不出格式 / 结构不合法的原因；有原因时 events 为空（不臆造结果）。 */
  error: string | null
}

// --- 极简 XML 词法（只到「元素流 + 文本」这一层，与上游用到的 SAX 回调同粒度）----
interface XmlToken { kind: 'open' | 'close' | 'text'; name: string; attributes: Record<string, string>; text: string }

function decodeEntities(value: string): string {
  return value.replace(/&(amp|lt|gt|quot|apos|#\d+);/g, (whole, entity: string) => {
    switch (entity) {
      case 'amp': return '&'
      case 'lt': return '<'
      case 'gt': return '>'
      case 'quot': return '"'
      case 'apos': return "'"
      case 'numeric': return whole
      default: {
        if (!entity.startsWith('#')) return whole
        const code = Number.parseInt(entity.slice(1), 10)
        return Number.isNaN(code) ? whole : String.fromCodePoint(code)
      }
    }
  })
}

function tokenize(xml: string): XmlToken[] {
  const out: XmlToken[] = []
  let i = 0
  while (i < xml.length) {
    const lt = xml.indexOf('<', i)
    if (lt < 0) { pushText(out, xml.slice(i)); break }
    if (lt > i) pushText(out, xml.slice(i, lt))
    if (xml.startsWith('<!--', lt)) { const end = xml.indexOf('-->', lt); i = end < 0 ? xml.length : end + 3; continue }
    if (xml.startsWith('<![CDATA[', lt)) { const end = xml.indexOf(']]>', lt); pushText(out, xml.slice(lt + 9, end < 0 ? xml.length : end)); i = end < 0 ? xml.length : end + 3; continue }
    if (xml.startsWith('<?', lt) || xml.startsWith('<!', lt)) { const end = xml.indexOf('>', lt); i = end < 0 ? xml.length : end + 1; continue }
    const gt = xml.indexOf('>', lt)
    if (gt < 0) break
    const body = xml.slice(lt + 1, gt)
    const selfClosing = body.endsWith('/')
    const inner = selfClosing ? body.slice(0, -1) : body
    if (inner.startsWith('/')) {
      out.push({ kind: 'close', name: inner.slice(1).trim(), attributes: {}, text: '' })
    } else {
      const nameMatch = /^([^\s/>]+)/.exec(inner)
      const name = nameMatch ? nameMatch[1]! : ''
      const attributes: Record<string, string> = {}
      const attribute = /([^\s=/]+)\s*=\s*"([^"]*)"|([^\s=/]+)\s*=\s*'([^']*)'/g
      let match: RegExpExecArray | null
      while ((match = attribute.exec(inner)) !== null) {
        const key = match[1] ?? match[3]!
        attributes[key] = decodeEntities(match[2] ?? match[4]!)
      }
      out.push({ kind: 'open', name, attributes, text: '' })
      // `<test …/>` 自闭：SAX 会给 start+end 两个回调，这里同样补一个 close。
      if (selfClosing) out.push({ kind: 'close', name, attributes: {}, text: '' })
    }
    i = gt + 1
  }
  return out
}

function pushText(out: XmlToken[], text: string): void {
  // 上游每处取文本都过 `StringUtil.unescapeXmlEntities`（`ImportedTestContentHandler.java:92`）。
  if (text.trim().length) out.push({ kind: 'text', name: '', attributes: {}, text: decodeEntities(text) })
}

/** 上游 `:91-97`：文本段按内容类型归并后**去一处**，本仓直接在 close 时取累计文本。 */
function locationHintOf(location: string | undefined, metainfo: string | undefined): string | undefined {
  if (!location) return metainfo
  // 本仓的 hint 只有一个字段：metainfo 写在 URL 末尾（`src/testLocator.ts` 的 resolveTestLocation 认这个形状）。
  if (!metainfo) return location
  return /^\w+:\/\/\S+$/.test(location) ? `${location} ${metainfo}` : location
}

function durationOf(raw: string | undefined, seconds: boolean): number {
  if (raw === undefined || raw === '') return -1                    // 上游 `:113` 缺省写 -1
  const value = Number.parseFloat(raw)
  if (Number.isNaN(value)) return -1                               // 上游 `:141-147` 解析失败退 -1
  return Math.trunc(seconds ? value * 1000 : value)                 // ant 的 time 是秒（:143）
}

const antStatusOf = (name: string): string | null =>
  name === 'failure' ? IMPORT_STATUS_FAILED : name === 'error' ? IMPORT_STATUS_ERROR
    : name === 'skipped' ? IMPORT_STATUS_SKIPPED : name === 'ignored' ? IMPORT_STATUS_IGNORED : null

/** 根元素名（上游 `AntTestContentHandler.java:29-43` 就是靠它决定接手与否）。 */
export function rootElementName(xml: string): string | null {
  for (const token of tokenize(xml)) if (token.kind === 'open') return token.name
  return null
}

/**
 * XML → 结构化事件。`<testrun>` 走 IDEA 导出格式，`<testsuites>` 走 ant 格式，
 * 其它根元素 ⇒ `format: null` + 原因（上游 `findHandler` 都不认时也用默认 handler，
 * 但那份 handler 只吃 `<testrun>`，所以对别的根元素同样什么也不产出）。
 */
export function importTestResults(xml: string): ImportedResults {
  const root = rootElementName(xml)
  if (root !== 'testrun' && root !== 'testsuites') {
    return { format: null, events: [], root: null, error: root ? `不是测试结果 XML（根元素 <${root}>）。` : '空的 XML 文件。' }
  }
  const events: TestEvent[] = []
  let importedRoot: ImportedRoot | null = null
  let currentTest: string | null = null
  let status: string | null = null
  let duration = -1
  let stderr = false
  let expected: string | undefined
  let actual: string | undefined
  let text = ''
  const suiteStack: string[] = []
  const isAnt = root === 'testsuites'

  for (const token of tokenize(xml)) {
    if (token.kind === 'text') { text += token.text; continue }
    if (token.kind === 'close') {
      const name = token.name
      if (name === 'test') {
        // 上游 `:100-117`：failed/error 出失败事件，ignored/skipped 出忽略事件，
        // 然后**不管什么状态**都补 finished。
        if (status === IMPORT_STATUS_FAILED || status === IMPORT_STATUS_ERROR) {
          events.push({ kind: 'testFailed', name: currentTest ?? '', message: '', details: text, ...(expected !== undefined ? { expected } : {}), ...(actual !== undefined ? { actual } : {}) })
        } else if (status === IMPORT_STATUS_IGNORED || status === IMPORT_STATUS_SKIPPED) {
          events.push({ kind: 'testIgnored', name: currentTest ?? '', message: text.trim() ? text : '' })
        }
        events.push({ kind: 'testFinished', name: currentTest ?? '', durationMs: duration >= 0 ? duration : undefined })
        currentTest = null; status = null; expected = undefined; actual = undefined; text = ''
      } else if (name === 'suite') {
        events.push({ kind: 'suiteFinished', name: suiteStack.pop() ?? '' })
      } else if (name === 'testcase') {
        // ant：状态是子元素给的，`<testcase>` 收尾时结算（上游 `:131-148`）。
        if (status === IMPORT_STATUS_FAILED || status === IMPORT_STATUS_ERROR) {
          events.push({ kind: 'testFailed', name: currentTest ?? '', message: '', details: text })
        } else if (status === IMPORT_STATUS_IGNORED || status === IMPORT_STATUS_SKIPPED) {
          events.push({ kind: 'testIgnored', name: currentTest ?? '', message: '' })
        } else if (status !== null && status !== IMPORT_STATUS_PASSED) {
          // 上游 `:137` 直接抛 IllegalStateException：认不出的状态不猜。
          return { format: 'ant', events: [], root: importedRoot, error: `Unknown status: ${status}` }
        }
        events.push({ kind: 'testFinished', name: currentTest ?? '', durationMs: duration >= 0 ? duration : undefined })
        currentTest = null; status = null; text = ''
      } else if (name === 'testsuite' && isAnt) {
        events.push({ kind: 'suiteFinished', name: suiteStack.pop() ?? '' })
      } else if (name === 'output' || name === 'system-out' || name === 'system-err') {
        // 上游 `:93` 的 `isTestOutput`：`当前没有测试` 或 `测试是通过的` 或 `不是 stderr` 才算输出；
        // 失败测试的 stderr 文本**留着**，等 `</test>` 时当失败详情（`:103` 的 currentText）。
        const isError = name === 'system-err' || (name === 'output' && stderr)
        const isTestOutput = currentTest === null || status === IMPORT_STATUS_PASSED || !isError
        if (isTestOutput) {
          if (text.trim().length) {
            if (currentTest) events.push({ kind: 'testOutput', name: currentTest, output: text, stderr: isError })
            else events.push({ kind: 'testOutput', output: text, stderr: isError })   // onUncapturedOutput
          }
          text = ''
        }
      }
      continue
    }
    const attributes = token.attributes
    if (token.name === 'testrun' && !isAnt) {
      importedRoot = { name: attributes.name ?? null, comment: attributes.comment ?? null, location: attributes.location ?? null }
      continue
    }
    if (token.name === 'suite' && !isAnt) {
      const name = attributes.name ?? ''
      suiteStack.push(name)
      events.push({ kind: 'suiteStarted', name, ...(locationHintOf(attributes.location, attributes.metainfo) ? { locationHint: locationHintOf(attributes.location, attributes.metainfo) } : {}) })
      text = ''
      continue
    }
    if (token.name === 'test' && !isAnt) {
      currentTest = attributes.name ?? ''
      status = attributes.status ?? null
      duration = durationOf(attributes.duration, false)
      const hint = locationHintOf(attributes.location, attributes.metainfo)
      events.push({ kind: 'testStarted', name: currentTest, ...(hint ? { locationHint: hint } : {}) })
      text = ''
      continue
    }
    if (token.name === 'output' && !isAnt) {                       // 上游 `:69-75`：按类型切流
      stderr = attributes.type === 'stderr'
      text = ''
      continue
    }
    if (token.name === 'diff' && !isAnt) {                         // 上游 `:79-82`
      expected = attributes.expected
      actual = attributes.actual
      continue
    }
    if (token.name === 'testsuite' && isAnt) {                     // 上游 `:81-90`
      const name = attributes.name ?? ''
      const packageName = attributes.package
      suiteStack.push(name)
      const qualified = packageName ? `${packageName}.${name}` : name
      events.push({ kind: 'suiteStarted', name, locationHint: `java:suite://${qualified}` })
      text = ''
      continue
    }
    if (token.name === 'testcase' && isAnt) {                      // 上游 `:91-103`
      const name = attributes.name ?? ''
      currentTest = name
      status = null
      duration = durationOf(attributes.time, true)
      const className = attributes.classname
      events.push({ kind: 'testStarted', name, locationHint: `java:test://${className ? `${className}/${name}` : name}` })
      text = ''
      continue
    }
    if (isAnt) {                                                   // 上游 `:104-117`
      const next = antStatusOf(token.name)
      if (next) status = next
      if (token.name === 'system-err') stderr = true
      text = ''
      continue
    }
  }
  return { format: isAnt ? 'ant' : 'idea', events, root: importedRoot, error: null }
}

/** 事件 → 通道能认的行（面板把导入的结果当**一次运行的输出**喂进去）。 */
export function importedEventLines(events: readonly TestEvent[], formatEvent: (event: TestEvent) => string): string[] {
  return events.map(event => formatEvent(event))
}

/**
 * 历史列表（`ImportTestsGroup.java:44-60` 的等价物：只列还在的、按时间倒序）。
 * 本仓的「还在」由面板按工作区清单过滤；这里管**顺序与条数上限**。
 */
export function recordImportedSession(storage: { getItem(k: string): string | null; setItem(k: string, v: string): void } | null,
  fileName: string, limit: number): string[] {
  if (!storage || !fileName) return []
  const list = importedSessionList(storage, Infinity).filter(name => name !== fileName)
  list.unshift(fileName)
  const trimmed = list.slice(0, Math.max(0, limit))
  storage.setItem('taocode.testImport.history', trimmed.join('\n'))
  return trimmed
}

export function importedSessionList(storage: { getItem(k: string): string | null } | null, limit: number): string[] {
  if (!storage) return []
  const raw = storage.getItem('taocode.testImport.history')
  if (!raw) return []
  return raw.split('\n').filter(Boolean).slice(0, Math.max(0, limit))
}

/** 上游 `ImportTestsFromHistoryAction.java:39-53` 的显示名折算。 */
export function historyPresentableText(fileName: string, configurationName?: string | null): string {
  const withoutExtension = fileName.replace(/\.[A-Za-z0-9]+$/, '')
  const at = withoutExtension.lastIndexOf(' - ')
  if (at <= 0) return withoutExtension
  const date = withoutExtension.slice(at + 3)
  // 上游格式 `yyyy.MM.dd 'at' HH'h' mm'm' ss's'`（SMTestRunnerResultsForm.java:101）；认不动就原样。
  if (!/^\d{4}\.\d{2}\.\d{2} at \d{2}h\d{2}m\d{2}s$/.test(date)) return withoutExtension
  const [day, clock = ''] = date.split(' at ')
  const hhmmss = clock.replace(/h/, ':').replace(/m/, ':').replace(/s$/, '')
  return `${configurationName ?? withoutExtension.slice(0, at)} (${day} ${hhmmss})`
}

/**
 * 导入历史会话里**失败的用例名**（上游 `ImportedTestRunnableState.java:67-78` 给导入的结果挂
 * `AbstractRerunFailedTestsAction`：导入的会话照样能「重跑失败的」）。
 * 本仓从导入的事件里抽 `testFailed` 的 `name`（去重保序）；名字交给 `src/testRunner.ts` 的
 * `rerunCommand` 拼进命令（与本仓自己跑出来的失败重跑同一条链路）。
 * 消费点 `src/components/TestRunnerPanel.vue` 的「重跑导入的失败」按钮。
 */
export function importedFailedNames(events: readonly TestEvent[]): string[] {
  const out: string[] = []
  for (const event of events) {
    if (event.kind !== 'testFailed') continue
    const name = (event.name ?? '').trim()
    if (name && !out.includes(name)) out.push(name)
  }
  return out
}
