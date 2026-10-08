// exec/sm-runner / exec/junit：**测试位置的解析与导航**（上游 `SMTestLocator` 一族）。
//
// 上游依据：
//   · `platform/smRunner/src/com/intellij/execution/testframework/sm/runner/SMTestLocator.java:22-31`
//     —— 接口本体：`getLocation(protocol, path, project, scope)` 把 runner 报回来的**位置 URL**
//     解析成一组可导航的 `Location`；`:40-46` 带 `metainfo` 的重载（注释写明 metainfo
//     「可以加速查找但不能用来识别测试」，并举例「测试起始行号」）；`:51-54` 第三个重载
//     —— **直接吃一行栈帧**；`:61-63` 缓存随 PSI 改动失效（本仓没有 PSI，缓存交给调用方）。
//   · `java/execution/impl/src/com/intellij/execution/testframework/JavaTestLocator.java`
//     —— Java 的实现，URL 语法写在类注释 `:33-40`：`java:suite://className` /
//     `java:test://className/methodName`，`/` 不会出现在包名里所以能当分隔符；
//     `:45-46` 两个协议常量；`:60-64` 路径里 `[...]` 是**参数化名**（参数化用例的一次调用），
//     截出来单独传；`:67-77` suite 协议：先按类名找类，找不到再退化成「类.方法」；
//     `:78-80` test 协议：直接走方法；`:145-151` **旧格式兼容**（`java:test://包名.方法名`）；
//     `:161-179` 同名多个重载全部返回（`findMethodsByName` 给几个就要几个）；
//     `:164-166` 「方法名等于类名」= 构造器测试 ⇒ 导航到**类**；
//     `:98-124` metainfo：方法按 VM 签名精配，类则把 `line:col` 变成打开位置；
//     `:129-132` 栈帧重载 = `new StackTraceLine(...)` 后按 `class/method` 走 test 协议
//     （类名/方法名的提取在上游 `java/execution/impl/src/com/intellij/execution/stacktrace/StackTraceLine.java:33/:78`）；
//     `:186-209` `createLocationUrl` —— URL 的**生成**侧（`protocol://类[/方法[参数]]`）。
//   · `plugins/gradle/java/src/execution/test/runner/GradleTestLocator.kt:29-33`
//     —— 定位器是**链**：先问 Java 的，拿到非空就用它；`:48-56` 否则逐个问扩展，第一个非空的赢。
//
// 架构不等价的落点（本仓没有 PsiManager/ClassUtil）：上游靠索引把类名解析成 PsiClass，
// 本仓把「类名 → 工作区里的测试文件 + 方法所在行」做成一张**发现索引**
// （`TestIndex`，由调用方从 `src/testRunner.ts` 的发现结果喂），语义对齐：
//   同一个类名可以有多条 ⇒ 返回**列表**（上游 `:168` 返回多个重载）；
//   解析不出来 ⇒ 返回空表（上游 `:82`/`:152`/`:87` 都是空表，绝不臆造位置）；
//   旧格式与 `Outer$Inner` 嵌套类都兼容。
// 消费点（实测，不是打算接）：`src/components/TestRunnerPanel.vue`
//   :26 import `firstTestLocation` / `testIndexOf`；建索引在 `testIndex`（结果树的 `sourceOf()` 用它）；
//   「Navigate with Single Click / Scroll to running test」开着时用同一通道解析运行节点；
//   本轮（junit2）新增：失败节点的落点先问 `failureLocation()`（堆栈那一帧），详情区的 `file:` 片段用
//   `resolveFrameFile()` 落到工作区路径后再 `emit('jump', …)`。
// 面板解析出来后 `emit('jump', { path, line })`，**最后一段在宿主**：渲染面板的那一行
// （订正 2026-10-06：这里原先记的是「没挂 `@jump`、跳转停在面板里，已提 wiring-request W-B11c-1」，
// 现树 `grep -n "@jump" src/App.vue` 实测**已经挂上**（TestRunnerPanel 那一行在 `src/App.vue:2265`，
// 处理函数 `revealLocation` 是 0 基 ⇒ 面板给的要减一行，行号随并发漂移）⇒ 那条 wiring-request 已闭合，
// 本模块不再欠宿主一段接线。`locateTestFromStack` 的 `Math.max(1, …)` 给的仍是 1 基行号。
// `src/testImport.ts:144` 只把 metainfo 写成 hint 的形状交给这里的 `resolveTestLocation` 认，
// 它本身不 import 本模块。判据 `tests/test-locator.test.mjs`。

/** 上游 `JavaTestLocator.SUITE_PROTOCOL` / `TEST_PROTOCOL`（:45-46）。 */
export const SUITE_PROTOCOL = 'java:suite'
export const TEST_PROTOCOL = 'java:test'

// 测试位置 EP（`com.intellij.testSrcLocator` 的 `TestLocationProvider`，上游
// `TestLocationProvider.java:13-19`；EP 宿主在 `src/executionRunExtensionPoints.ts`）：
// `resolveTestLocation` 是本仓的真实消费点 —— 自己的协议解析给不出落点时按上游那条
// 「逐个问扩展」的链（`GradleTestLocator.kt:48-56`）问一遍。
import { locationFromTestProviders, type TestLocationProject } from './executionRunExtensionPoints.ts'

/** 一条位置 URL 拆出来的三段（上游 `:57-64`）。 */
export interface TestUrl {
  /** `java:suite` / `java:test`；没有 `://` 的裸路径记为 null 走兼容分支。 */
  protocol: string | null
  /** 去掉协议与参数名之后的路径。 */
  path: string
  /** `[1]` / `[index=2]` 这样的参数化名（上游 `:60-64`）；没有就是 null。 */
  paramName: string | null
}

/** `java:test://com.foo.BarTest/adds[1]` → 三段；不是 URL 形态也照样返回（protocol 为 null）。 */
export function parseTestUrl(location: string): TestUrl | null {
  const text = location.trim()
  if (!text) return null
  const separator = text.indexOf('://')
  const protocol = separator < 0 ? null : text.slice(0, separator)
  const rest = separator < 0 ? text : text.slice(separator + 3)
  const bracket = rest.indexOf('[')
  if (bracket < 0) return { protocol, path: rest, paramName: null }
  return { protocol, path: rest.slice(0, bracket), paramName: rest.slice(bracket) }
}

/** 上游 `createLocationUrl`（:186-209）的生成侧：适配器与测试用它拼 URL。 */
export function createTestUrl(protocol: string, className: string, methodName?: string | null, paramName?: string | null): string {
  const base = `${protocol}://`
  if (!methodName) return `${base}${className}`
  const method = methodName.endsWith('()') ? methodName.slice(0, -2) : methodName
  return `${base}${className}/${method}${paramName ?? ''}`
}

/** 发现索引里的一条：一个类（或类里的一个方法）落在工作区哪个文件的哪一行。 */
export interface TestIndexEntry {
  /** 限定类名（`com.foo.BarTest`）；没有包名时就是短名。 */
  className: string
  /** 方法名；类级条目（构造器测试/整类）为 null。 */
  method: string | null
  /** 相对工作区根的路径。 */
  path: string
  /** 1 基行号。 */
  line: number
}

export type TestIndex = readonly TestIndexEntry[]

const shortNameOf = (name: string): string => name.split('.').pop() ?? name

/** 类名匹配：限定名相等，或短名相等（上游 `ClassUtil.findPsiClass(..., checkQualifiedName=false)` 的同名放宽）。 */
function classMatches(entry: TestIndexEntry, className: string): boolean {
  if (entry.className === className) return true
  // JUnit 5 的嵌套类写成 `Outer$Inner`（上游 `JavaTMHTestProtocol` 的运行时名）：按 `$` 前的外层名比。
  const outer = className.split('$')[0]!
  return shortNameOf(entry.className) === shortNameOf(outer)
}

/**
 * 上游 `:138-152` 的拆法：先按 `/` 分类/方法，没有 `/` 时退化成旧格式「包名.方法名」。
 * 返回 `null` = 拆不出方法名（只给了类，或只给了裸名字）。
 */
export function splitTestPath(path: string): { className: string; method: string | null } {
  const trimmed = path.replace(/\.$/, '')            // 上游 `:68` trimEnd(path, ".")
  const slash = trimmed.indexOf('/')
  if (slash > 0) return { className: trimmed.slice(0, slash), method: trimmed.slice(slash + 1) || null }
  const lastDot = trimmed.lastIndexOf('.')
  if (lastDot <= 0) return { className: trimmed, method: null }
  return { className: trimmed.slice(0, lastDot), method: trimmed.slice(lastDot + 1) }
}

export interface TestLocation { path: string; line: number; /** 参数化名，导航到某一次调用（上游 `PsiMemberParameterizedLocation`）。 */ paramName: string | null }

/**
 * 解析一条位置 URL ⇒ 若干个可跳转位置（`SMTestLocator.getLocation` 的等价物，返回列表而非单个）。
 * 分支顺序照抄上游 `JavaTestLocator.java:67-80`：
 *   `java:suite://` ⇒ **先整串当类名**找类（`:69-73`），找不到才退化成「类.方法」（`:75`）；
 *   `java:test://` ⇒ 直接走方法（`:78-80`）；
 *   其它协议 ⇒ 空表（本仓没有别的框架 URL）。
 */
export function locateTest(url: TestUrl, index: TestIndex): TestLocation[] {
  const path = url.path.replace(/\.$/, '')          // 上游 `:68` trimEnd(path, ".")
  if (!path) return []
  const asClass = (className: string): TestLocation[] => {
    const hits = index.filter(entry => classMatches(entry, className))
    if (!hits.length) return []
    const classLevel = hits.filter(entry => entry.method === null)
    return (classLevel.length ? classLevel : hits).map(entry => ({ path: entry.path, line: entry.line, paramName: url.paramName ?? null }))
  }
  const asMethod = (candidate: string): TestLocation[] => {
    const { className, method } = splitTestPath(candidate)
    if (!method) return asClass(className)
    // 上游 `:164-166`：方法名等于类名 ⇒ 构造器测试，导航到类本身。
    if (method.trim() === shortNameOf(className) || method.trim() === className) return asClass(className)
    const hits = index.filter(entry => classMatches(entry, className))
    const name = method.trim()
    // 上游 `:168-171`：先按 trim 后的名字找，找不到再用原始名找一次；**全部重载**都返回。
    let matched = hits.filter(entry => entry.method === name)
    if (!matched.length && name !== method) matched = hits.filter(entry => entry.method === method)
    return matched.map(entry => ({ path: entry.path, line: entry.line, paramName: url.paramName ?? null }))
  }
  if (url.protocol === SUITE_PROTOCOL) {
    const direct = asClass(path)
    return direct.length ? direct : asMethod(path)
  }
  if (url.protocol === TEST_PROTOCOL) return asMethod(path)
  return []
}

/** 栈帧行（`at com.foo.BarTest.adds(BarTest.java:12)`）→ 位置。上游 `:129-132`。 */
export function locateTestFromStack(line: string, index: TestIndex): TestLocation[] {
  const match = /(?:^|\bat\s+)([A-Za-z_$][\w.$]*)\.([A-Za-z_$][\w$]*)\s*\(/.exec(line)
  if (!match) return []
  return locateTest({ protocol: TEST_PROTOCOL, path: `${match[1]}/${match[2]}`, paramName: null }, index)
}

/** `Foo.java:12` / `Foo.java:12:5` 这种**本仓通道里已有的**位置写法（`src/testNavigation.ts` 的口径）。 */
function plainFileTarget(location: string): TestLocation | null {
  const match = /^(.*?\.[A-Za-z0-9_]+):(\d+)(?::\d+)?$/.exec(location.trim())
  if (!match) return null
  return { path: match[1]!.replace(/\\/g, '/'), line: Math.max(1, Number(match[2])), paramName: null }
}

/**
 * 面板的入口：一条 locationHint 先按 `file:line` 认（本仓通道的写法），认不出再按
 * 上游的 `java:suite://` / `java:test://` URL 认。**定位器链**的等价物
 * （`GradleTestLocator.kt:29-33`：前一个给出非空就用它）。
 * `metainfo` 是上游那个 5 参重载的第五个参数（`:40-46`，注释：加速查找但不用于识别）：
 * 类级命中时用它的行号覆盖节点自带行（`:106-121`）。也接受写在 hint 末尾的 `行:列`。
 */
export function resolveTestLocation(location: string | null | undefined, index: TestIndex, metainfo?: string | null, project: TestLocationProject = {}): TestLocation[] {
  if (!location) return []
  const plain = plainFileTarget(location)
  if (plain) return [plain]
  // hint 尾巴上写的 `9:4` 就是 metainfo（导入的 XML 里两者是分开的属性，通道里只有字符串）。
  const trailing = /(\d+:\d+)$/.exec(location.trim())
  const meta = (metainfo ?? (trailing ? trailing[1] : null)) ?? null
  const text = trailing && !metainfo ? location.trim().slice(0, -trailing[1].length).trim() : location
  const url = parseTestUrl(text)
  // 本仓的协议解析给不出落点时，问 EP（`com.intellij.testSrcLocator` 的 `TestLocationProvider`）——
  // 上游 `GradleTestLocator.kt:48-56` 的「逐个问扩展，第一个非空赢」那条链的等价物。
  // 认不出协议（`url` 为空）也照样问一次：插件可以用自己的协议名贡献位置（locationData 给原文）。
  // 无插件时这里恒为空表 ⇒ 与接线前逐字一致。
  if (!url) return locationFromTestProviders('', text, project).map(hit => ({ ...hit, paramName: hit.paramName ?? null }))
  const located = locateTest(url, index)
  if (located.length) {
    const line = metaLine(meta)
    // 上游 `:106-121`：只有导航到**类**（metainfo 给的是文件里的行列）时才改行号。
    if (line !== null && url.protocol === SUITE_PROTOCOL) {
      return located.map(hit => ({ ...hit, line: Math.max(1, line) }))
    }
    return located
  }
  const contributed = locationFromTestProviders(url.protocol ?? '', url.path, project)
  if (contributed.length) return contributed.map(hit => ({ ...hit, paramName: hit.paramName ?? url.paramName ?? null }))
  if (metaLine(meta) === null) return []
  const hits = index.filter(entry => classMatches(entry, splitTestPath(url.path).className))
  if (!hits.length) return []
  return [{ path: hits[0]!.path, line: Math.max(1, metaLine(meta)!), paramName: url.paramName ?? null }]
}

function metaLine(meta: string | null): number | null {
  const match = /^(\d+):(\d+)$/.exec(meta ?? '')
  return match ? Number(match[1]) : null
}

/** 第一个可跳转位置（面板只跳一个）；没有就 null。 */
export function firstTestLocation(
  location: string | null | undefined, index: TestIndex, project: TestLocationProject = {},
): TestLocation | null {
  return resolveTestLocation(location, index, null, project)[0] ?? null
}

/** 由 `src/testRunner.ts` 的发现结果造索引：类条目 + 每个方法条目（限定名与短名各一条）。 */
export function testIndexOf(rows: readonly { suite: string; name: string; path: string; line: number }[]): TestIndex {
  const out: TestIndexEntry[] = []
  for (const row of rows) {
    out.push({ className: row.suite, method: row.name, path: row.path, line: row.line })
    if (row.suite.includes('.')) out.push({ className: shortNameOf(row.suite), method: row.name, path: row.path, line: row.line })
  }
  return out
}

// --- 失败堆栈的定位（上游 `SMStacktraceParser` / `TestStackTraceParser` 那一族）------------------
//
// 上游依据（本轮逐条自己开文件，行号按 `grep -n` 的实际输出）：
//   · `platform/smRunner/src/com/intellij/execution/testframework/sm/SMStacktraceParser.java:29-38`
//     —— 接口本体 `getErrorNavigatable(location, stacktrace)`，注释原文
//     "Used for navigation from tests view to the editor if 'open failed line' option is selected"；
//     `:36-38` 用 `proxy.getStacktrace()` 建 `TestStackTraceParser`。
//   · `platform/smRunner/src/com/intellij/execution/testframework/sm/runner/SMTestProxy.java:406-421`
//     —— 树上导航的取法：`getDescriptor` **先**问堆栈给出的 navigatable，给了就用它，
//     否则退 `location.getNavigatable()`（声明位置）。⇒ 「堆栈优先、认不出退声明」是上游自己的形状。
//   · `java/execution/impl/src/com/intellij/execution/testframework/JavaAwareTestConsoleProperties.java:84-121`
//     —— `:84-87` 的注释 "//navigate to the first stack trace"；`:107-114` 逐帧比
//     `methodName.equals(line.getMethodName()) && qualifiedName.equals(className)`，**命中即 break**；
//     `:132-136` 的 `getQualifiedName` 只把帧里的 `$` 换成 `.`；落点文件 = 那个类的
//     `containingFile`（`:118`），行号 = 那一帧自己报的 `File.java:行`（`:117`）。
//   · `platform/smRunner/src/com/intellij/execution/testframework/sm/runner/ui/TestStackTraceParser.java:20-21`
//     —— 两个正则（外层 `at 类.方法(参数)`、内层 `文件:行`）；`:79-82` 内层不成立就 `return`，
//     也就是**中止整次解析**，不是跳过这一帧。
//   · `platform/testRunner/src/com/intellij/execution/testframework/TestConsoleProperties.java:54`
//     —— `openFailureLine` 默认 **true**；那条开关在工具栏上是真件（
//     `platform/testRunner/src/com/intellij/execution/testframework/ToolbarPanel.java:187-189`），
//     文案 `platform/execution/resources/messages/ExecutionBundle.properties:166-167`。
//
// 架构不等价（登记，不是省略）：
//   · 上游 `:120-121` 还有一道 PSI 校验（行号必须落在该方法的 `TextRange` 内、且小于文档行数），
//     本仓没有 PSI，也不去猜文件有多少行 —— 行号原样交给编辑器，真越界由宿主如实报错；
//   · 类名比对沿用本模块 `classMatches` 的**同名放宽**（上游 `:132-136` 只做 `$`→`.`，不放宽短名）：
//     本仓的发现器给不出包名（`src/testRunner.ts` 的 `discoverJunit` 把 suite 记成 `JUnit`），
//     严格按限定名比就一帧也认不出。判据里钉着「别的类仍然不算命中」那一条，放宽只到短名为止。

/** 上游 `TestConsoleProperties.java:54` 的默认值（`openFailureLine` 默认 true）。 */
export const DEFAULT_OPEN_FAILURE_LINE = true
/** 上游 `ExecutionBundle.properties:166`。 */
export const OPEN_FAILURE_LINE_NAME = 'Open Source at Exception'
/** 上游 `ExecutionBundle.properties:167`。 */
export const OPEN_FAILURE_LINE_DESCRIPTION = 'Go to the line which caused an exception when opening a test source'

/** 上游 `TestStackTraceParser.java:20` 的 outerPattern：`\tat 类.方法(参数)`。 */
const FRAME_OUTER = /^\s*at\s+([\w.$]+)\.([\w$<>]+)\s*\(([^()]*)\)$/
/** 上游 `:21` 的 innerPattern：`文件:行`。`(CompiledCode)` / `(Native Method)` 那两型不成立。 */
const FRAME_INNER = /^(.*):(\d+)$/

/** 一条栈帧拆出来的四段（上游 `TestStackTraceParser` 的 failedLine / failedMethodName 两个字段都在这里）。 */
export interface FailureFrame { className: string; methodName: string; file: string | null; line: number | null }

/** 一行栈帧 → 四段；不是栈帧 ⇒ null（上游那两个正则的 `matches()` 不成立就是不成）。 */
export function parseStackFrame(text: string): FailureFrame | null {
  const outer = FRAME_OUTER.exec(text)
  if (!outer) return null
  const argumentsPart = outer[3] ?? ''
  const inner = FRAME_INNER.exec(argumentsPart)
  if (!inner) return { className: outer[1]!, methodName: outer[2]!, file: argumentsPart ? argumentsPart : null, line: null }
  return { className: outer[1]!, methodName: outer[2]!, file: inner[1]!, line: Number(inner[2]) }
}

/** 类名 → 那个类所在的文件（上游 `:118` 的 `containingFile` 在本仓的等价物 = 发现索引里的 path）。 */
function classFilePath(index: TestIndex, className: string): string | null {
  const hit = index.find(entry => classMatches(entry, className))
  return hit ? hit.path : null
}

/**
 * 栈帧里的**裸文件名**（`MathTest.java`）→ 发现索引里真实存在的工作区路径。
 * 认不出 ⇒ null：与 `locateTest` 的「解析不出来返回空表」同一条口径，不给用户造一个打不开的路径。
 */
export function resolveFrameFile(file: string, line: number, index: TestIndex): TestLocation | null {
  const normalized = file.trim().replace(/\\/g, '/')
  if (!normalized) return null
  const base = normalized.split('/').pop() ?? normalized
  const hit = index.find(entry => entry.path === normalized)
    ?? index.find(entry => entry.path === base || entry.path.endsWith(`/${base}`))
  return hit ? { path: hit.path, line: Math.max(1, line), paramName: null } : null
}

/**
 * 失败栈里「本类本方法」的那一帧 ⇒ 可跳转位置
 * （`JavaAwareTestConsoleProperties.java:84-121` 的 `getErrorNavigatable`：逐帧比方法名与类名，
 *  命中即停；文件取类所在的文件，行号取那一帧的）。
 * `openFailureLine` 关着 ⇒ 直接 null（上游 `TestConsoleProperties.java:54`，关着时
 * `SMTestProxy.java:406-421` 就只剩声明位置那条退路）。
 * 认不出（没有匹配的帧 / 匹配的帧没报行号 ⇒ 中止 / 类落不到文件）⇒ null，**不臆造位置**。
 */
export function failureLocation(stacktrace: readonly string[], className: string, methodName: string,
                                 index: TestIndex, openFailureLine: boolean = DEFAULT_OPEN_FAILURE_LINE): TestLocation | null {
  if (!openFailureLine || !stacktrace.length) return null
  for (const raw of stacktrace) {
    const frame = parseStackFrame(raw)
    if (!frame || frame.methodName !== methodName) continue
    if (frame.className !== className && shortNameOf(frame.className) !== shortNameOf(className)) continue
    if (frame.line === null) return null   // 上游 `TestStackTraceParser.java:79-82`：内层不成立就中止
    const path = classFilePath(index, className) ?? resolveFrameFile(frame.file ?? '', frame.line, index)?.path ?? null
    if (!path) return null
    return { path, line: Math.max(1, frame.line), paramName: null }
  }
  return null
}
