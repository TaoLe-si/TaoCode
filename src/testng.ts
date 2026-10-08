// exec/junit：**TestNG 集成**（上游 `plugins/testng` 的可移植子集）。
//
// 上游坐标：
//   · `plugins/testng/src/com/theoryinpractice/testng/configuration/TestNGConfigurationType.java:28`
//     —— `super("TestNG", "TestNG", null, …)`：配置类型 id = `TestNG`，显示名 = `TestNG`；
//     `:39-41` `getTag()` = `testNg`。
//   · `plugins/testng/src/com/theoryinpractice/testng/util/TestNGUtil.java:78`
//     —— `TESTNG_GROUP_NAME = "TestNG"`（结果树里的框架名）；`:94` `TEST_ANNOTATION_FQN =
//     "org.testng.annotations.Test"`；`:95-107` 生命周期注解（`Before/After` × `Class/Method/
//     Suite/Test/Groups`）与 `DataProvider`/`Factory` 的 FQN；`:92` `TESTNG_FQN = "org.testng.TestNG"`
//     （跑测试的主类）；`:89` `MAVEN_TEST_NG = "org.testng:testng"`。
//   · `plugins/testng/src/com/theoryinpractice/testng/TestNGCommonClassNames.java:10-30`
//     —— `ORG_TESTNG_ANNOTATIONS_TEST` 与 `LIFE_CYCLE_CLASSES` 那八个。
//   · `plugins/testng/src/com/theoryinpractice/testng/model/TestType.java:21-27`
//     —— 七种运行目标：PACKAGE/CLASS/METHOD/GROUP/SUITE/PATTERN/SOURCE（值 0-6）；
//     文案在 `TestngBundle.properties:28-41`（`testng.configuration.*.label`）。
//   · `plugins/testng/src/com/theoryinpractice/testng/configuration/TestNGRunnableState.java:51-53`
//     —— CLI 三个开关 `-d`（输出目录）/ `-usedefaultlisteners` / `-listener`。
//
// 本仓的等价物（纯文本、可移植的那一半）：TestNG 与 JUnit 的差别在**注解与主类**上，
// 两者的测试发现、结果解析、失败重跑都是同一套形状，所以：
//   · 发现：`@Test`（含 `@org.testng.annotations.Test` 全限定）与 JUnit 的 `@Test` 词法相同，
//     但 TestNG 的用例方法**不要求** `public void`，且带 `dataProvider`/`groups` 等属性；
//   · 主类：`org.testng.TestNG`（JUnit 走 `mvn test`/`junit`），TestNG 走
//     `mvn test -Dtest=…` 或直接 `java org.testng.TestNG -testclass …`；
//   · 生命周期注解：`@BeforeMethod`/`@AfterClass` 一族在 JUnit 里是 `@BeforeEach`/`@AfterAll`，
//     迁移检查（`src/junitInspections.ts` 一族）靠这张表识别"这是 TestNG 不是 JUnit"。
//
// 消费点：`src/testRunner.ts` 的 `discover`（按文件里出现的注解选框架）、
// `src/components/TestRunnerPanel.vue` 的框架标签与命令。判据 `tests/testng.test.mjs`。

/** 上游 `TestNGUtil.java:78`。 */
export const TESTNG_FRAMEWORK_NAME = 'TestNG'
/** 上游 `TestNGConfigurationType.java:28` 的配置类型 id 与显示名（同串）。 */
export const TESTNG_TYPE_ID = 'TestNG'
/** 上游 `TestNGConfigurationType.java:39-41`。 */
export const TESTNG_TAG = 'testNg'
/** 上游 `TestNGUtil.java:94`。 */
export const TESTNG_TEST_ANNOTATION = 'org.testng.annotations.Test'
/** 上游 `TestNGUtil.java:92`（跑测试的主类）。 */
export const TESTNG_MAIN_CLASS = 'org.testng.TestNG'
/** 上游 `TestNGUtil.java:89`。 */
export const TESTNG_MAVEN_COORDINATE = 'org.testng:testng'

/** 上游 `TestNGCommonClassNames.java:12-28` 的八个生命周期注解（全限定名）。 */
export const TESTNG_LIFE_CYCLE_ANNOTATIONS: readonly string[] = [
  'org.testng.annotations.AfterClass',
  'org.testng.annotations.AfterGroups',
  'org.testng.annotations.AfterSuite',
  'org.testng.annotations.AfterTest',
  'org.testng.annotations.BeforeClass',
  'org.testng.annotations.BeforeGroups',
  'org.testng.annotations.BeforeSuite',
  'org.testng.annotations.BeforeTest',
]

/** 上游 `TestNGUtil.java:105-107` 的另外三个（数据/工厂/对象工厂）。 */
export const TESTNG_SUPPORT_ANNOTATIONS: readonly string[] = [
  'org.testng.annotations.DataProvider',
  'org.testng.annotations.Factory',
  'org.testng.annotations.ObjectFactory',
]

/** 上游 `TestType.java:21-27` 的七种运行目标（`type` 串与序号逐字照抄）。 */
export const TESTNG_TEST_TYPES = ['PACKAGE', 'CLASS', 'METHOD', 'GROUP', 'SUITE', 'PATTERN', 'SOURCE'] as const
export type TestngTestType = typeof TESTNG_TEST_TYPES[number]

/** 上游 `TestngBundle.properties:28-41` 的七条目标文案（直译，无 zh 包）。 */
export const TESTNG_TEST_TYPE_LABELS: Record<TestngTestType, string> = {
  PACKAGE: '包',
  CLASS: '类',
  METHOD: '方法',
  GROUP: '组',
  SUITE: '套件',
  PATTERN: '模式',
  SOURCE: '源码位置',
}

/** 上游 `TestNGUtil.java:111-126` 的配置注解表（生命周期 + 支持注解，不含 `@Test`）。 */
export const TESTNG_CONFIG_ANNOTATIONS: readonly string[] = [
  ...TESTNG_LIFE_CYCLE_ANNOTATIONS,
  ...TESTNG_SUPPORT_ANNOTATIONS,
]

/**
 * 这段源码是不是 TestNG 的（按注解的全限定名或短名判定）。
 * 判定顺序：出现 `org.testng.annotations.*` 的**任一**注解即 TestNG —— 比 JUnit 的
 * `org.junit.*` 更早、更明确（两者都有 `@Test`，只看短名分不开）。
 */
export function isTestngSource(text: string): boolean {
  return /org\.testng\.annotations\.[A-Za-z]/.test(text)
}

/** 这段源码是不是 JUnit 的（`org.junit.*` / `org.junit.jupiter.*` / `junit.framework.*`）。 */
export function isJunitSource(text: string): boolean {
  return /\borg\.junit(\.jupiter)?\.|\bjunit\.framework\./.test(text)
}

/**
 * 按源码里的注解选测试框架：TestNG 优先（它有全限定名可判），其次 JUnit，都没有就是 `null`。
 * `src/testRunner.ts` 的 `discover` 用它决定给发现结果打哪个框架标签。
 */
export function frameworkOfSource(text: string): 'TestNG' | 'JUnit' | null {
  if (isTestngSource(text)) return TESTNG_FRAMEWORK_NAME
  if (isJunitSource(text)) return 'JUnit'
  return null
}

/** 一条发现的 TestNG 用例（`name` 是方法名；`groups` 是 `@Test(groups={…})` 里的组）。 */
export interface TestngDiscoveredTest {
  name: string
  line: number
  /** `@Test(groups = {"a","b"})` 里的组名（解析不动就是空数组，不臆造）。 */
  groups: string[]
  /** 这个方法带 `dataProvider` 属性（参数化用例，上游 `DataProviderReference`）。 */
  parameterized: boolean
}

/**
 * 词法发现 TestNG 用例：`@Test` 之后那个方法（**不要求** `public void` —— TestNG 允许
 * 包私有、允许返回值）。与 JUnit 的 `discoverJunit` 分开，因为约束不同：
 * JUnit 5 的 `@Test` 方法要 `void`，TestNG 的可以是任意返回类型。
 * 属性里认 `groups` 与 `dataProvider`（两个都在上游有独立 UI 面）。
 */
export function discoverTestngTests(text: string): TestngDiscoveredTest[] {
  const found: TestngDiscoveredTest[] = []
  // `@Test` 可选带括号属性；随后到第一个方法名。属性里可能有换行（`groups = {\n"a"}`）。
  const re = /@(?:org\.testng\.annotations\.)?Test\s*(\(([\s\S]*?)\))?\s*(?:@[\w.]+(?:\([^)]*\))?\s*)*(?:public|private|protected)?\s*(?:static\s+)?(?:final\s+)?[\w<>\[\],.\s]+\s+([A-Za-z_$][\w$]*)\s*\(/g
  let match: RegExpExecArray | null
  let line = 1
  let cursor = 0
  while ((match = re.exec(text)) !== null) {
    const name = match[3]!
    const at = match.index + match[0].lastIndexOf(name)
    for (let i = cursor; i < at; ++i) if (text[i] === '\n') ++line
    cursor = at
    const attributes = match[2] ?? ''
    found.push({
      name,
      line,
      groups: parseGroups(attributes),
      parameterized: /\bdataProvider\s*=/.test(attributes),
    })
  }
  return found
}

/** 从 `@Test` 的属性串里抽 `groups = {"a", "b"}`（也认单引号与不带花括号的单值）。 */
export function parseGroups(attributes: string): string[] {
  const brace = /\bgroups\s*=\s*\{([^}]*)\}/.exec(attributes)
  if (brace) return [...brace[1]!.matchAll(/["']([^"']+)["']/g)].map(entry => entry[1]!).filter(Boolean)
  // 不带花括号的单值：`groups = "solo"` —— 这里那个值本身就是结果（不再找引号）。
  const single = /\bgroups\s*=\s*["']([^"']+)["']/.exec(attributes)
  return single ? [single[1]!] : []
}

/**
 * TestNG 配置页那三格落到 CLI 上的三个开关 —— 上游 `TestNGRunnableState.java:109-120` 的
 * 加参数顺序与门控逐条照抄（`TestNGConfigurationEditor` 的「Parameters / Properties file /
 * Listeners」是三页，落到命令行上就是这三条）：
 *   · `-d <目录>`：只在该目录**非空**时加（`:109-111` 的两道门 `!= null && !isEmpty()`）；
 *   · `-usedefaultlisteners <true|false>`：**无条件**加（`:113`），值取 `USE_DEFAULT_REPORTERS`
 *     （`model/TestData.java:53` 默认 **false**）；
 *   · `-listener a;b`：监听器表非空时加，多个用 `;` 连接（`:115-120`）。上游 `:119` 还会把
 *     `IDEATestNGListener` EP 的贡献并进同一个串；本仓没有那条 EP，如实只拼配置里的表。
 *
 * 适用面同上游：这三条是**直跑主类**那支的程序参数（`RemoteTestNGStarter`），
 * Maven/surefire 那支由 surefire 自己管，不在这里拼。
 */
export interface TestngRunParameters {
  outputDirectory?: string | null
  useDefaultListeners?: boolean
  listeners?: readonly string[]
}

/** 上游 `model/TestData.java:53`。 */
export const DEFAULT_USE_DEFAULT_LISTENERS = false

export function testngParameterArguments(parameters: TestngRunParameters = {}): string[] {
  const args: string[] = []
  const directory = (parameters.outputDirectory ?? '').trim()
  if (directory) args.push(`-d ${directory}`)                                     // :109-111
  args.push(`-usedefaultlisteners ${parameters.useDefaultListeners ?? DEFAULT_USE_DEFAULT_LISTENERS}`)  // :113
  const listeners = (parameters.listeners ?? []).map(entry => entry.trim()).filter(Boolean)
  if (listeners.length) args.push(`-listener ${listeners.join(';')}`)             // :115-120
  return args
}

/**
 * TestNG 的运行命令。
 *   · 走 Maven（`mvn test`）时用 `-Dtest=<类或方法>` 选目标（与 JUnit 同一形状）；
 *   · 直接跑主类时 `java -cp <cp> org.testng.TestNG -testclass <类> [-methods <方法>]`
 *     再跟上 `testngParameterArguments(options.parameters)` 的三条
 *     （上游 `TestNGRunnableState.java:51-53` 的三个开关常量）。
 * `target` 是 `com.foo.Bar` 或 `com.foo.Bar#method`（`#` 分隔类与方法，本仓约定）。
 */
export function testngCommand(base: string, target: string,
  options: { mainClass?: boolean; classpath?: string; parameters?: TestngRunParameters } = {}): string {
  const [className = '', method = ''] = target.split('#')
  if (!options.mainClass) {
    // Maven 的 surefire 用 `-Dtest=`（与 JUnit 同一条），类#方法也认。
    return method ? `${base} -Dtest=${className}#${method}` : `${base} -Dtest=${className}`
  }
  const classpath = options.classpath ?? '.'
  const args = [`-testclass ${className}`]
  if (method) args.push(`-methods ${className}.${method}`)
  args.push(...testngParameterArguments(options.parameters))
  return `java -cp "${classpath}" ${TESTNG_MAIN_CLASS} ${args.join(' ')}`
}

/** 重跑失败的 TestNG 用例（与 JUnit 同形状：`-Dtest=Class#m1,Class#m2`）。 */
export function testngRerunCommand(base: string, failures: readonly string[]): string {
  return failures.length ? `${base} -Dtest=${failures.join(',')}` : base
}

/** 结果树里的框架名（上游 `TestNGUtil.java:78`；`TestRunnerPanel` 的框架标签用它）。 */
export function testngSuiteLabel(): string {
  return TESTNG_FRAMEWORK_NAME
}