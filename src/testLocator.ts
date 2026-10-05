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
//   :21 import `firstTestLocation` / `testIndexOf`；:246 用发现结果建索引；
//   :247-250 `sourceOf()` 给节点标题与行号（模板 :496 的 tooltip、:491 的双击 `jump(node)`）；
//   :400-408 「Navigate with Single Click / Scroll to running test」开着时用同一通道解析运行节点。
// 面板解析出来后 `emit('jump', { path, line })`，**最后一段在宿主**：渲染面板的那一行
// （订正 2026-10-06：原写 `src/App.vue:2254`，现树实测在 **`src/App.vue:2283`**，行号随并发漂移）
// 没挂 `@jump`（`revealLocation` 是 0 基，本模块给的是 1 基行号 —— `locateTestFromStack` 的
// `Math.max(1, …)`，:160/:185/:192），所以跳转目前停在面板里 ——
// App.vue 是保留文件 ⇒ 已写进 `docs/wiring-requests-2026-10-06-bucket11c.md`（请求 W-B11c-1），
// 待主代理粘的那一行逐字稿在 `docs/wiring-requests-2026-10-06-bucketW.md` 第一节。
// `src/testImport.ts:144` 只把 metainfo 写成 hint 的形状交给这里的 `resolveTestLocation` 认，
// 它本身不 import 本模块。判据 `tests/test-locator.test.mjs`。

/** 上游 `JavaTestLocator.SUITE_PROTOCOL` / `TEST_PROTOCOL`（:45-46）。 */
export const SUITE_PROTOCOL = 'java:suite'
export const TEST_PROTOCOL = 'java:test'

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
export function resolveTestLocation(location: string | null | undefined, index: TestIndex, metainfo?: string | null): TestLocation[] {
  if (!location) return []
  const plain = plainFileTarget(location)
  if (plain) return [plain]
  // hint 尾巴上写的 `9:4` 就是 metainfo（导入的 XML 里两者是分开的属性，通道里只有字符串）。
  const trailing = /(\d+:\d+)$/.exec(location.trim())
  const meta = (metainfo ?? (trailing ? trailing[1] : null)) ?? null
  const text = trailing && !metainfo ? location.trim().slice(0, -trailing[1].length).trim() : location
  const url = parseTestUrl(text)
  if (!url) return []
  const located = locateTest(url, index)
  if (located.length) {
    const line = metaLine(meta)
    // 上游 `:106-121`：只有导航到**类**（metainfo 给的是文件里的行列）时才改行号。
    if (line !== null && url.protocol === SUITE_PROTOCOL) {
      return located.map(hit => ({ ...hit, line: Math.max(1, line) }))
    }
    return located
  }
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
export function firstTestLocation(location: string | null | undefined, index: TestIndex): TestLocation | null {
  return resolveTestLocation(location, index)[0] ?? null
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
