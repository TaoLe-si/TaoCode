// exec/junit：**按模式 / 按包 / 按 tag 选要跑哪些测试**（上游 `plugins/junit` 的
// `TestsPattern` / `AbstractAllInPackageConfigurationProducer` /
// `AbstractAllInDirectoryConfigurationProducer` / `TestTags` 这一族）。
//
// 上游依据（`plugins/junit/src/com/intellij/execution/junit/`）：
//   · `TestsPattern.java:39-47` —— 「模式」这一运行目标：配置里存的是一串**模式**，
//     `getFilters`（:120-122）在没解析出类时把模式原样交给运行器当过滤器；
//   · `TestsPattern.java:74-105` + `findLocation`（:108-117）—— 模式的三种形状：
//     `com.foo.BarTest`（整类）、`com.foo.BarTest,methodName`（类的一个方法，`split(',')` 得类名）、
//     含 `*` 的通配（类解析不出来就交给运行器）；JUnit 5 另有 `Outer$Inner` 形态（:84-95）；
//     `checkConfiguration`（:205-227）—— 空模式报错、类不是测试类报错、类找不到且没有 `*` 报错；
//   · `AbstractAllInPackageConfigurationProducer.java:24-51` —— 右键一个**包**生成
//     「包内全部测试」配置（`data.PACKAGE_NAME = psiPackage.getQualifiedName()`）；
//   · `AbstractAllInDirectoryConfigurationProducer.java` —— 同形的「目录内全部测试」目标；
//   · `TestTags.java:38-58` —— tag 是另一种目标：`getTags()` 非空才合法，并按
//     **Java 表达式**解析（`parseAsJavaExpression`，:66-91：允许 `1+2`、`!tag`、`&`/`|`、
//     括号；顶层出现 `&&`/`||` 或括号不配平都判为非法）。
//
// 本仓的等价物（纯函数，判据 `tests/junit-patterns.test.mjs` 一份覆盖模式与 tag 两半，
// 包/目录范围在 `tests/junit-scope.test.mjs`）：
//   · `parseTestPattern` / `testPatternSelector` / `packagePattern` / `directoryPattern`
//     —— 模式语法与 `-Dtest=` 写法（`rerunCommand` 的 junit 分支同源，`src/testRunner.ts:136-138`）；
//   · `parseTagExpression` —— tag 表达式的解析与校验（含 `&&`/`||` 顶层非法这条上游规则）。
// 消费点：`src/components/TestRunnerPanel.vue` 的「模式」「包/目录」「tag」三行（真跑、真过滤）。
// 目录这一档不做**合成模式**：上游的目录生产者（`AbstractAllInDirectoryConfigurationProducer.java`）
// 是把范围内的类收集成列表，本仓由发现索引做同一件事（`scopedRows`），所以这里
// 只有包名退路 `packagePattern`；`directoryPattern` 那种「把路径里的 / 换成点」的合成
// 形状会把 `src/test/java` 变成假包名，已删（判据 `tests/junit-scope.test.mjs`）。
import type { DiscoveredTest } from './testRunner.ts'

/** 上游 `MisorderedAssertEqualsArgumentsInspection` 之外的模式语法：整类 / 类+方法 / 通配。 */
export interface TestPattern {
  /** 原始输入（去空白）。 */
  raw: string
  /** 类名部分（`Class,method` 拆出来的那一半）。 */
  className: string
  /** `Class,method` 的 method；没有就是 null。 */
  methodName: string | null
  /** 含 `*`（上游 `checkConfiguration` 允许通配并把过滤器原样交给运行器）。 */
  wildcard: boolean
  /** JUnit 5 嵌套类形态 `Outer$Inner`。 */
  nested: boolean
}

export function parseTestPattern(text: string): TestPattern | null {
  const raw = text.trim()
  if (!raw) return null
  const comma = raw.indexOf(',')
  const className = comma < 0 ? raw : raw.slice(0, comma).trim()
  const methodName = comma < 0 ? null : raw.slice(comma + 1).trim() || null
  if (!className) return null
  return { raw, className, methodName, wildcard: className.includes('*') || (methodName?.includes('*') ?? false),
           nested: className.includes('$') }
}

/** 上游的校验（`TestsPattern.checkConfiguration`，:205-227），返回人话原因或 null（合法）。 */
export function validateTestPattern(pattern: TestPattern, classNames: ReadonlySet<string>): string | null {
  if (pattern.className.includes('*') || pattern.wildcard) return null
  if (!classNames.size) return null          // 没有类清单时无法核实（上游靠 PSI，本仓不猜）
  if (!classNames.has(pattern.className) && !classNames.has(pattern.className.split('.').pop()!)) {
    return `类 ${pattern.className} 不在工作区的测试文件里。`
  }
  return null
}

/**
 * 模式 → `-Dtest=` 选择器。上游把模式原样当过滤器（`TestsPattern.getFilters`，:120-122），
 * 本仓还原成 surefire 的 `Class#method` 形状（`rerunCommand` 的 junit 分支同口径）。
 */
export function testPatternSelector(patterns: readonly string[]): string {
  return patterns.map(text => {
    const pattern = parseTestPattern(text)
    if (!pattern) return ''
    if (!pattern.wildcard) return pattern.methodName ? `${pattern.className}#${pattern.methodName}` : pattern.className
    // 通配：方法位带 `*` 时只写方法，类名原样（上游也是把模式整串交出去）。
    return pattern.methodName ? `${pattern.className}#${pattern.methodName}` : pattern.className
  }).filter(Boolean).join(',')
}

/**
 * 「包内全部测试」的命令形状。上游存的是**包名本身**
 * （`AbstractAllInPackageConfigurationProducer.java:48-49`：`data.PACKAGE_NAME = 限定名` +
 * `TEST_OBJECT = TEST_PACKAGE`），由运行器再去把包里的类解析出来；本仓没有运行器侧的包解析，
 * 所以这条只在**发现索引里一条都没命中**时当退路的过滤器文本（与
 * `TestsPattern.getFilters`，`:120-122`「类解析不出来就把模式原样交出去」同一条退路），
 * 形状取类名通配 `包.**.*Test`，与 `testPatternSelector` 给出的类名形状同源。
 */
export function packagePattern(packageName: string): string {
  const trimmed = packageName.trim().replace(/\/+$/i, '').replace(/\//g, '.')
  return trimmed ? `${trimmed}.**.*Test` : '**.*Test'
}

/**
 * 模式对已发现的测试做筛选（面板的「模式」输入框的即时效果）。
 *
 * 泛型 `T extends DiscoveredTest`：筛选只读 `name`/`suite` 两个字段，但调用方的行上还有
 * 面板自己要用的 `path`/`framework`（`TestRunnerPanel.vue` 的 `TestRow`）。收窄到
 * `DiscoveredTest[]` 会把那两个字段从类型上抹掉，所以这里原样透传行的类型。
 */
export function filterDiscovered<T extends DiscoveredTest>(patterns: readonly string[], found: readonly T[]): T[] {
  const parsed = patterns.map(parseTestPattern).filter((p): p is TestPattern => p !== null)
  if (!parsed.length) return [...found]
  return found.filter(test => parsed.some(pattern => {
    if (!classMatches(pattern, test.suite)) return false
    if (!pattern.methodName) return true
    // 方法位带 `*` 时按段通配（`adds*` 命中 `addsTwo`），否则要完全同名。
    return pattern.methodName.includes('*')
      ? globToRegExp(pattern.methodName).test(test.name)
      : test.name === pattern.methodName
  }))
}

/** 工作区里所有测试**类**的限定名 + 短名（`TestsPattern.checkConfiguration` 的类清单口径）。 */
export function classNamesOf(found: readonly DiscoveredTest[]): Set<string> {
  const names = new Set<string>()
  for (const test of found) {
    names.add(test.suite)
    names.add(test.suite.split('.').pop() ?? test.suite)
  }
  return names
}

/** 把类名通配编成正则：`*` 只吃一个包段（`com.foo.*` 不该穿透到 `com.foo.bar.X`）。 */
function globToRegExp(text: string): RegExp {
  const escaped = text.split('*').map(part => part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('[^.]*')
  return new RegExp(`^${escaped}$`)
}

/** 模式里的类名部分是否命中某个测试类：整串与短名各试一次（`*` 按段匹配）。 */
function classMatches(pattern: TestPattern, suite: string): boolean {
  const simple = suite.split('.').pop() ?? suite
  if (pattern.wildcard) return globToRegExp(pattern.className).test(suite) || globToRegExp(pattern.className).test(simple)
  return pattern.className === suite || pattern.className === simple
}

// --- tags（上游 TestTags）----------------------------------------------------

export interface TagExpression {
  /** 原始输入（去首尾空白）；交给运行器时用的就是这一串。 */
  raw: string
  /** 解析出的 tag 词（已去掉 `!` 的否定标记，`!` 记在 negated 里）。 */
  tags: string[]
  /** `!tag` 的那些 tag。 */
  negated: string[]
  /** 顶层出现 `&&`/`||`（上游 :77-82 判非法）或括号不配平 → 原因。 */
  error: string | null
}

/**
 * tag 表达式解析（`TestTags.parseAsJavaExpression`，:66-91）。上游用 PSI 把它当 Java 表达式
 * 解析，所以 `1+2` 是合法 tag、`!1+2` 是「tag 1+2 的否定」；本仓按同一语法手写解析：
 * `&`/`|`/括号/`!` 都认，**顶层**的 `&&`/`||` 与括号不配平判非法。
 */
export function parseTagExpression(text: string): TagExpression {
  // 上游对两类问题给两句话（都在 `plugins/junit/resources/messages/JUnitBundle.properties`）：
  //   · 空/全空白 ⇒ `tags.are.not.specified.error.message`（`:60`，`TestTags.checkConfiguration:49-52` 抛 Error）
  //   · 语法不对 ⇒ `tag.name.0.must.be.syntactically.valid.warning`（`:61`，`:88-90 invalidTagException`）
  const raw = text.trim()
  const blank = (): TagExpression => ({ raw, tags: [], negated: [], error: 'Tags are not specified（没有填 tag）' })
  if (!raw) return blank()
  const invalid = (why: string): TagExpression => ({ raw, tags: [], negated: [], error: `Tag name [${raw}] must be syntactically valid（${why}）` })
  if (/&&|\|\|/.test(stripParens(raw))) return invalid('顶层只能用 & 与 |，上游拒绝 && 与 ||')
  if (!balanced(raw)) return invalid('括号不配平')
  const tags: string[] = []
  const negated: string[] = []
  for (const term of raw.split(/[&|]/)) {
    // 括号只是分组，不是 tag 名的一部分（上游按 Java 表达式解析，括号进的是语法树不是词）。
    const word = term.replace(/[()]/g, '').trim()
    if (!word) continue
    if (word.startsWith('!')) negated.push(word.slice(1).trim())
    else tags.push(word)
  }
  return tags.length + negated.length ? { raw, tags, negated, error: null } : invalid('没有解析出 tag')
}

/** 去掉成对的括号后检查顶层还有没有 `&&`/`||`（上游只判顶层）。 */
function stripParens(text: string): string {
  let out = text
  let previous = ''
  while (out !== previous) {
    previous = out
    out = out.replace(/\([^()]*\)/g, '')
  }
  return out
}

function balanced(text: string): boolean {
  let depth = 0
  for (const ch of text) {
    if (ch === '(') ++depth
    else if (ch === ')') { --depth; if (depth < 0) return false }
  }
  return depth === 0
}

/**
 * tag 表达式 → 交给运行器的那一串。上游不重排、不改写，只把空格去掉
 * （`TestTags.java:115`：`configuration.getPersistentData().getTags().replaceAll(" ", "")`
 * 直接进 `JUnitStarter.printClassesList`），所以本仓同样**原样透传**；
 * 语法不过就什么都不交（不猜）。
 */
export function tagFilter(expression: TagExpression): string {
  if (expression.error) return ''
  return expression.raw.replace(/ /g, '')
}

/** 已发现测试的 tag 筛选（面板的「tag」输入框的即时效果；tag 由源码上的 `@Tag` 给出）。 */
export function filterByTags(found: readonly { tags?: readonly string[] }[], expression: TagExpression): number[] {
  if (expression.error) return []
  const keep: number[] = []
  found.forEach((test, index) => {
    const tags = test.tags ?? []
    const hit = expression.tags.every(tag => tags.includes(tag)) && expression.negated.every(tag => !tags.includes(tag))
    if (hit) keep.push(index)
  })
  return keep
}
