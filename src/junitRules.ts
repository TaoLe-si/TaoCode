// exec/junit-inspection：**JUnit 检查的第二批规则**（词法可判的那些）。
//
// 上一条判词把这一批全归到「需要 PSI/类型解析」，核对上游后订正如下（判词会过期，留痕）：
//   原判定：`JUnitMixedFramework` / `JUnitMalformedDeclaration` / `MultipleExceptionsDeclaredOnTestMethod`
//     / naming 族「需要 PSI，做不了」。
//   核实后：这四条的**判据本身**是词法可表达的（注解名 + 修饰符 + throws 列表 + 名字正则），
//     PSI 只用于「解析引用/查超类/查用法」这几处放宽；本仓用同一形状的词法判据实现，
//     并把依赖索引的那一小步如实降级（下面逐条写着降级点）。
//   仍然做不到的：`ExpectedExceptionNeverThrown`（要看方法体是否真的抛出该异常 ⇒ 数据流/调用图）、
//     `JUnitAssertEqualsOnArray`/`MayBeAssertSame`（要参数静态类型）、
//     `JUnit5ImplicitUsageProvider`（`codeInspection/deadCode/JUnit5ImplicitUsageProvider.kt:54-68`
//     整个建立在 `ReferencesSearch` 上；本仓没有「未使用符号」的本地检查 ⇒ 没有要抑制的误报，
//     等价物在这一面没有可见效果）。
//
// 上游依据（相对路径:行号）：
//   · `plugins/junit/src/com/intellij/execution/junit/codeInspection/JUnitMixedFrameworkInspection.kt`
//     `:59-65` shouldInspect —— JUnit3/4/5 三种 API 在文件里**出现两种以上**才查；
//     `:80` 类上有 `@RunWith` 就整类跳过；
//     `:82-101` 按「首选框架」分派；`:166-179` 首选框架的算法（超类是 TestCase ⇒ 3；
//     否则数 junit4/junit5 注解的方法数，4 的多 ⇒ 4，否则有 5 的 ⇒ 5）；
//     `:128-161` 三组注解清单（junit4Annotations / junit5Annotations / 可删的那几个）；
//     `:122-125` 文案 `jvm.inspections.junit.mixed.annotations.junit.descriptor`
//     （`plugins/junit/resources/messages/JUnitBundle.properties:111`
//      = `Method <code>#ref()</code> annotated with ''@{0}'' inside class extending JUnit {1} TestCase`）；
//     检查显示名 `:110` = `JUnit API usage from multiple versions in a single TestCase`；
//     `:183-227` 修复 `RemoveAnnotationAndPrefixQuickFix`：删注解 + 把方法改名为
//     `前缀 + 首字母大写`（`:212-214`），标题 `fix.remove.annotation.text`
//     （`platform/analysis-api/resources/messages/CommonQuickFixBundle.properties:29`
//      = `Remove ''@{0}'' annotation`）。
//   · `plugins/junit/src/com/intellij/execution/junit/codeInspection/JUnitMalformedDeclarationInspection.kt`
//     `:615` JUnit5 的 `@Test`：`should be public, non-static, have no parameters and of type void`
//     （模板 `JUnitBundle.properties:141`）；`:507`/`:548` 嵌套类缺 `@Nested`
//     （`:164` = `Tests in nested class will not be executed`）；`:698` `@RepeatedTest` 次数 ≤ 0
//     （`:163` = `The number of repetitions must be greater than zero`）；显示名 `:139`
//     = `JUnit malformed declaration`。
//   · `plugins/junit/src/com/intellij/execution/junit/codeInspection/MultipleExceptionsDeclaredOnTestMethodInspection.java`
//     `:74-89` 判据 = 是 JUnit 测试方法 且 `throws` 列了 **2 个以上** 且 方法**没有任何引用**；
//     `:40-51` 修复 = 删掉 throws 列表再加 `java.lang.Exception`，标题
//     `fix.replace.with.x`（`CommonQuickFixBundle.properties:18` = `Replace with ''{0}''`）；
//     文案 `JUnitBundle.properties:228` = `<code>#ref</code> could be replaced with 'throws Exception'`，
//     显示名 `:227` = `Multiple exceptions declared on test method`。
//     降级点：`:88-92` 的「没有任何引用」要 `MethodReferencesSearch`（按方法的用法索引），
//     本仓只有 `file.usages`（按文件）⇒ 这里退化成「同一个文件内没有被调用」，登记在测试里。
//   · `plugins/junit/src/com/intellij/execution/junit/codeInspection/naming/`
//     `TestClassNamingConvention.java:37` 默认正则 `[A-Z][A-Za-z\d]*Test(s|Case)?|Test[A-Z][A-Za-z\d]*|IT(.*)|(.*)IT(Case)?`
//     与 `:31-32` 长度 5..255、`:33` 短名 `JUnitTestClassNamingConvention`、`:41-43` 默认启用、
//     `:46-55` 适用条件（不是类型参数、顶层或 static、是测试类且不是 suite 类）；
//     `JUnit3MethodNamingConvention.java:22` `test[A-Za-z_\d]*` 8..64、`:32` 短名；
//     `JUnit4MethodNamingConvention.java:33` `[a-z][A-Za-z_\d]*` 4..64、`:28` 短名、`:23` 适用「可执行的 4/5/6 测试方法」；
//     文案模板 `java/java-analysis-impl/resources/messages/InspectionGadgetsBundle.properties:1116-1118`
//     （too short / too long / doesn''t match regex）+ 元素名 `:791`/`:2041`/`:2042`。
//
// 本仓的等价物：`junitRuleProblems()` 出诊断（进 `src/junitInspections.ts` 的本地检查通道，
// 与已有 5 条规则同一条链路），`removeAnnotationAction()` / `renameToPrefixAction()` /
// `throwsExceptionAction()` 出快速修复（进 `src/junitQuickFix.ts` ⇒ Alt+Enter）。
// 判据 `tests/junit-rules.test.mjs`。
import type { JunitInspectionProblem } from './junitInspections.ts'

const WARNING = 2

/** 上游 `JUnitMixedFrameworkInspection.kt:142-161` 的两组注解（短名与 FQN 都收）。 */
export const JUNIT4_ANNOTATIONS = ['Test', 'Ignore', 'Before', 'After', 'BeforeClass', 'AfterClass'] as const
export const JUNIT5_ANNOTATIONS = ['Test', 'ParameterizedTest', 'TestFactory', 'RepeatedTest', 'Disabled',
  'BeforeEach', 'AfterEach', 'BeforeAll', 'AfterAll'] as const
/** `:128-140` 那两组「只能删」的注解（JUnit3 首选时 @Before/@After 系列没有对应物）；
 *  本仓按 `:84-93` 的分派统一处理，这里只留清单备查。 */
const JUNIT4_REMOVE_ONLY = ['Before', 'After', 'BeforeClass', 'AfterClass'] as const
const JUNIT5_REMOVE_ONLY = ['BeforeEach', 'AfterEach', 'BeforeAll', 'AfterAll'] as const
export const JUNIT4_CLASS_ONLY_ANNOTATIONS: readonly string[] = JUNIT4_REMOVE_ONLY
export const JUNIT5_CLASS_ONLY_ANNOTATIONS: readonly string[] = JUNIT5_REMOVE_ONLY
const JUNIT4_FQN_PREFIX = 'org.junit.'
const JUNIT5_FQN_PREFIX = 'org.junit.jupiter.'

export interface MethodModel {
  name: string
  /** 0 基，签名所在行。 */
  line: number
  /** 注解短名（去掉 `org.junit.` 之类前缀）；`@RepeatedTest(3)` 的括号内容在 arguments 里。 */
  annotations: string[]
  annotationsWithArgs: { name: string; arguments: string }[]
  modifiers: string[]
  returnType: string
  parameters: string
  throws: string[]
  /** 同类里已经出现过的「方法名」，用于上游那句「同一个文件内没有被调用」。 */
  declaredNames: string[]
}

const annotationName = (text: string): { name: string; arguments: string } | null => {
  const match = /^@([\w.]+)/.exec(text)
  if (!match) return null
  const open = text.indexOf('(', match[0].length)
  const close = text.lastIndexOf(')')
  return { name: match[1]!, arguments: open >= 0 && close > open ? text.slice(open + 1, close).trim() : '' }
}

const shortOf = (name: string): string => name.split('.').pop() ?? name

/**
 * 词法方法模型：`@Override void foo(int a) throws IOException, SQLException {`。
 * 只解析签名行（注解可以从上一行/上上行来，`annotationsAbove` 那一套在 `src/junitInspections.ts`）；
 * 拿不准的一律**不收**，宁缺毋假。
 */
export function parseMethods(code: string): MethodModel[] {
  const lines = code.split(/\r?\n/)
  const out: MethodModel[] = []
  const signature = /^\s*((?:(?:public|protected|private|static|final|abstract|synchronized|default)\s+)*)((?:[\w$.<>\[\],?\s]+\s+)|)([\w$]+)\s*\(([^)]*)\)\s*(?:throws\s+([^{\n]+))?\s*\{?/
  for (let i = 0; i < lines.length; i++) {
    // 注解可以写在签名行的**同一行**（`@Test public void a() {}`），也可以在上面几行。
    const raw = lines[i]!
    const leading = /^\s*((?:@[\w.]+(?:\([^)]*\))?\s*)+)/.exec(raw)
    const rest = leading ? raw.slice(leading[0].length) : raw
    const match = signature.exec(rest)
    if (!match) continue
    const name = match[3]!
    if (['if', 'for', 'while', 'switch', 'catch', 'return', 'new'].includes(name)) continue
    const collected: string[] = []
    if (leading) for (const item of leading[1]!.matchAll(/@[\w.]+(?:\([^)]*\))?/g)) collected.push(item[0]!)
    let j = i - 1
    while (j >= 0) {
      const trimmed = lines[j]!.trim()
      if (trimmed === '') { j--; continue }
      if (trimmed.startsWith('@')) { collected.unshift(trimmed); j--; continue }
      if (collected.length && /[({,]\s*$/.test(lines[j + 1]!.trim())) { collected.unshift(trimmed); j--; continue }
      break
    }
    const parsed = collected.map(annotationName).filter((a): a is { name: string; arguments: string } => a !== null)
    out.push({
      name,
      line: i,
      annotations: parsed.map(item => shortOf(item.name)),
      annotationsWithArgs: parsed,
      modifiers: (match[1] ?? '').trim().split(/\s+/).filter(Boolean),
      returnType: (match[2] ?? '').trim() || 'void',
      parameters: (match[4] ?? '').trim(),
      throws: (match[5] ?? '').split(',').map(part => part.trim()).filter(Boolean),
      declaredNames: [],
    })
  }
  const all = out.map(method => method.name)
  for (const method of out) method.declaredNames = all.filter(name => name !== method.name)
  return out
}

/**
 * 上游 `:59-65` 的三个 `isXxxInScope` 判的是**依赖库在不在 classpath**（不是注解出没出现过），
 * 本仓能看到的等价证据就是 import / 全限定名：只按这个判，避免「裸 `@Test` 被当成两代都用了」。
 */
export function frameworksInScope(code: string): { junit3: boolean; junit4: boolean; junit5: boolean } {
  const imports = code.match(/^\s*import\s+(?:static\s+)?[\w.*]+\s*;/gm) ?? []
  const junit3 = /\bextends\s+(?:junit\.framework\.)?TestCase\b/.test(code)
    || imports.some(entry => /(^|\s|\.)junit\.framework\./.test(entry))
  const junit4 = imports.some(entry => /org\.junit\.(?!jupiter|platform|vintage)/.test(entry))
    || /@org\.junit\.(?!jupiter)/.test(code)
  const junit5 = /org\.junit\.jupiter\.|org\.junit\.platform\.|org\.junit\.vintage\./.test(imports.join('\n'))
    || /@org\.junit\.jupiter\./.test(code)
  return { junit3, junit4, junit5 }
}

/** 裸短名在两个框架里都有（`@Test` 就是），所以按 **import 的 FQN** 判归属；没有 import 信息时才按短名默认档。 */
export function importsByShortName(code: string): Record<string, string> {
  const out: Record<string, string> = {}
  const pattern = /^\s*import\s+(?:static\s+)?([\w.]+)\s*;/gm
  let match: RegExpExecArray | null
  while ((match = pattern.exec(code)) !== null) {
    const fqn = match[1]!
    const short = fqn.split('.').pop()!
    if (!(short in out)) out[short] = fqn
  }
  return out
}

/** 一个注解名属于哪一代：3 = junit.framework / TestCase，4 = org.junit.*，5 = org.junit.jupiter.*。 */
export function annotationFamily(name: string, imports: Record<string, string>): '3' | '4' | '5' | null {
  const fqn = name.includes('.') ? name : (imports[shortOf(name)] ?? '')
  if (fqn.startsWith(JUNIT5_FQN_PREFIX) || fqn.startsWith('org.junit.platform.')) return '5'
  if (fqn.startsWith('junit.framework.')) return '3'
  if (fqn.startsWith(JUNIT4_FQN_PREFIX)) return '4'
  const short = shortOf(name)
  if (JUNIT5_ANNOTATIONS.includes(short as never) && !JUNIT4_ANNOTATIONS.includes(short as never)) return '5'
  if (JUNIT4_ANNOTATIONS.includes(short as never)) return '4'
  if (JUNIT5_ANNOTATIONS.includes(short as never)) return '5'
  return null
}

/** 上游 `:166-179` 的首选框架算法（词法版：超类/方法注解计数同一口径）。 */
export function preferredFramework(code: string, methods: readonly MethodModel[]): '3' | '4' | '5' | null {
  if (/\bextends\s+(?:junit\.framework\.)?TestCase\b/.test(code)) return '3'
  const imports = importsByShortName(code)
  const familyCount = (family: '4' | '5') => methods.filter(method =>
    method.annotationsWithArgs.some(item => annotationFamily(item.name, imports) === family)).length
  const junit4Count = familyCount('4')
  const junit5Count = familyCount('5')
  if (junit4Count > junit5Count) return '4'
  if (junit5Count > 0) return '5'
  return null
}

/** 上游 `JUnitBundle.properties:111` 的文案（`#ref` 换成方法名）。 */
export function mixedFrameworkMessage(method: string, annotation: string, version: string): string {
  return `Method ${method}() annotated with '@${annotation}' inside class extending JUnit ${version} TestCase`
}

function mixedFrameworkProblems(path: string, code: string, methods: readonly MethodModel[]): JunitInspectionProblem[] {
  const scope = frameworksInScope(code)
  const kinds = [scope.junit3, scope.junit4, scope.junit5].filter(Boolean).length
  if (kinds < 2) return []                                   // 上游 :59-65
  if (/@RunWith\b/.test(code)) return []                       // 上游 :80
  const preferred = preferredFramework(code, methods)
  if (!preferred) return []
  const problems: JunitInspectionProblem[] = []
  const imports = importsByShortName(code)
  const report = (method: MethodModel, annotationName: string, version: '3' | '4' | '5') => {
    const at = annotationPosition(code, method.line, annotationName)
    problems.push({ path, line: at.line, character: at.character, severity: WARNING, source: 'JUnitMixedFramework',
      // 注解短名与首选那一代带在诊断上，快速修复（`src/junitQuickFix.ts`）据此删注解/改名。
      annotation: annotationName, framework: version,
      message: `${mixedFrameworkMessage(method.name, annotationName, version)}（上游 JUnitMixedFrameworkInspection）` })
  }
  for (const method of methods) {
    const annotated = method.annotationsWithArgs
    // 文案的 `{1}` 是**首选框架**那一代（上游三个分支都传 `version = preferedTestFramework`，
    // 即 `:122-125` 的 `junitMessage(annotation, version)`）。
    if (preferred === '3') {
      // 上游 :84-93：JUnit3 首选时，4 与 5 的注解一律是「多余的那一个」。
      for (const item of annotated) {
        const family = annotationFamily(item.name, imports)
        if (family === '4' || family === '5') report(method, shortOf(item.name), '3')
      }
      continue
    }
    if (preferred === '4') {
      // 上游 :96 —— 这一支的修复是 `// TODO quickfix`，本仓同样只报不修（不假装有个转换按钮）。
      for (const item of annotated) if (annotationFamily(item.name, imports) === '5') report(method, shortOf(item.name), '4')
      continue
    }
    for (const item of annotated) if (annotationFamily(item.name, imports) === '4') report(method, shortOf(item.name), '5')
  }
  return problems
}

function line(code: string, index: number): string {
  const lines = code.split(/\r?\n/)
  return lines[index] ?? ''
}

/** 注解通常写在签名行的上方：给出它自己那一行与列（找不到就退回签名行）。 */
function annotationPosition(code: string, methodLine: number, annotation: string): { line: number; character: number } {
  const lines = code.split(/\r?\n/)
  for (let i = methodLine; i >= 0 && i >= methodLine - 8; --i) {
    const text = lines[i] ?? ''
    const at = text.indexOf(`@${annotation}`)
    if (at >= 0) return { line: i, character: at }
  }
  return { line: methodLine, character: 0 }
}

export const isTestAnnotated = (method: MethodModel): boolean =>
  method.annotations.some(name => ['Test', 'ParameterizedTest', 'TestFactory', 'RepeatedTest'].includes(name)) ||
  /^test[A-Z0-9]/.test(method.name)

/** 上游 `JUnitBundle.properties:141/:163/:164` 的三条词法可判的 malformed 规则。 */
function malformedProblems(path: string, code: string, methods: readonly MethodModel[]): JunitInspectionProblem[] {
  const problems: JunitInspectionProblem[] = []
  const imports = importsByShortName(code)
  for (const method of methods) {
    const jupiter = method.annotationsWithArgs.some(item => annotationFamily(item.name, imports) === '5')
    if (jupiter && (method.annotations.includes('Test') || method.annotations.includes('ParameterizedTest'))) {
      const privateMethod = method.modifiers.includes('private')
      const staticMethod = method.modifiers.includes('static')
      const hasParams = method.parameters !== '' && !/^@/.test(method.parameters)
      const notVoid = method.returnType !== 'void'
      // 上游 :615 —— JUnit 5 的 @Test 要 public / non-static / 无参 / void。
      // `@ParameterizedTest` 的「无参」那半不适用（参数就是数据），本仓同样不报。
      const violated = privateMethod || staticMethod || notVoid || (hasParams && method.annotations.includes('Test'))
      if (violated) {
        problems.push({ path, line: method.line, character: Math.max(0, line(code, method.line).indexOf(method.name)),
          severity: WARNING, source: 'JUnitMalformedDeclaration',
          message: `Method ${method.name} should be public, non-static, have no parameters and of type void（上游 JUnitMalformedDeclarationInspection:615）` })
      }
    }
    for (const item of method.annotationsWithArgs) {
      if (shortOf(item.name) !== 'RepeatedTest') continue
      const count = Number.parseInt(item.arguments.replace(/[^\d-]/g, ''), 10)
      if (!Number.isNaN(count) && count <= 0) {
        problems.push({ path, line: method.line, character: Math.max(0, line(code, method.line).indexOf('@')),
          severity: WARNING, source: 'JUnitMalformedDeclaration',
          message: 'The number of repetitions must be greater than zero（上游 :698）' })
      }
    }
  }
  // 上游 :507/:548：内部类里有测试方法但类上没 `@Nested` ⇒ 不会被执行。
  const inner = /\b(?:class|interface)\s+([A-Z]\w*)[^{]*\{[\s\S]*\b(public|private|protected)?\s*(?:static\s+)?class\s+([A-Z]\w*)/.exec(code)
  if (inner && !/@Nested\b/.test(code)) {
    const nested = new RegExp(`class\\s+(${inner[3]})`).exec(code)
    if (nested) {
      const at = code.slice(0, nested.index).split('\n').length - 1
      problems.push({ path, line: at, character: Math.max(0, nested.index - code.lastIndexOf('\n', nested.index) - 1),
        severity: WARNING, source: 'JUnitMalformedDeclaration',
        message: 'Tests in nested class will not be executed（上游 :507/:548）' })
    }
  }
  return problems
}

/** 上游 `JUnitBundle.properties:228` 的文案。 */
export function multipleExceptionsMessage(method: string): string {
  return `Method ${method} throws list could be replaced with 'throws Exception'`
}

function multipleExceptionsProblems(path: string, code: string, methods: readonly MethodModel[]): JunitInspectionProblem[] {
  const problems: JunitInspectionProblem[] = []
  for (const method of methods) {
    if (method.throws.length < 2) continue                    // 上游 :82-84
    if (!isTestAnnotated(method)) continue                    // 上游 :77-79 TestUtils.isJUnitTestMethod
    // 降级点：上游 :86-91 还要「方法没有任何引用」；本仓没有按方法的用法索引，
    // 只在同一个文件内没有任何调用时报（跨文件的调用查不到 ⇒ 可能多报，登记在此）。
    const used = new RegExp(`\\b${method.name}\\s*\\(`).test(code.replace(new RegExp(`\\b${method.name}\\s*\\([^)]*\\)\\s*(?:throws[^{]*)?\\{`), ''))
    if (used) continue
    problems.push({ path, line: method.line, character: Math.max(0, line(code, method.line).indexOf('throws')),
      severity: WARNING, source: 'MultipleExceptionsDeclaredOnTestMethod',
      message: `${multipleExceptionsMessage(method.name)}（上游 MultipleExceptionsDeclaredOnTestMethodInspection:74-89）` })
  }
  return problems
}

// --- naming（可配置正则）------------------------------------------------------

/** 一条命名规范：短名 / 元素名（文案的 {0}）/ 默认正则 / 最短 / 最长。 */
export interface NamingConvention {
  shortName: string
  elementDescription: string
  pattern: string
  minLength: number
  maxLength: number
}

/** 上游 `naming/` 目录里**短名可核实**的三条（其它两条的 shortName 在本 checkout 里没读到，不猜）。 */
export const NAMING_CONVENTIONS: readonly NamingConvention[] = [
  { shortName: 'JUnitTestClassNamingConvention', elementDescription: 'Test class',
    pattern: '[A-Z][A-Za-z\\d]*Test(s|Case)?|Test[A-Z][A-Za-z\\d]*|IT(.*)|(.*)IT(Case)?', minLength: 5, maxLength: 255 },
  { shortName: 'JUnit3MethodNamingConvention', elementDescription: 'JUnit 3 test method',
    pattern: 'test[A-Za-z_\\d]*', minLength: 8, maxLength: 64 },
  { shortName: 'JUnit4MethodNamingConvention', elementDescription: 'JUnit 4+ test method',
    pattern: '[a-z][A-Za-z_\\d]*', minLength: 4, maxLength: 64 },
]

/** 用户改过的正则：`{ 短名: 正则 }`，没改的用上方的默认值（上游是 `NamingConventionBean`）。 */
export type NamingOptions = Readonly<Record<string, string>>

export function conventionOf(shortName: string, options: NamingOptions = {}): NamingConvention {
  const base = NAMING_CONVENTIONS.find(item => item.shortName === shortName) ?? NAMING_CONVENTIONS[0]!
  const pattern = options[shortName]
  return pattern ? { ...base, pattern } : base
}

/** 上游 `InspectionGadgetsBundle.properties:1116-1118` 的三条文案。 */
export function namingMessage(convention: NamingConvention, name: string): string | null {
  if (name.length < convention.minLength) return `${convention.elementDescription} name ${name} is too short (${name.length} < ${convention.minLength})`
  if (name.length > convention.maxLength) return `${convention.elementDescription} name ${name} is too long (${name.length} > ${convention.maxLength})`
  let matched: boolean
  try { matched = new RegExp(`^(?:${convention.pattern})$`).test(name) } catch { return null }
  if (!matched) return `${convention.elementDescription} name ${name} doesn't match regex '${convention.pattern}'`
  return null
}

function classNames(code: string): { name: string; line: number }[] {
  const out: { name: string; line: number }[] = []
  const pattern = /(?:^|\n)\s*(?:public\s+|final\s+|abstract\s+)*(?:class|interface)\s+([A-Z]\w*)/g
  let match: RegExpExecArray | null
  while ((match = pattern.exec(code)) !== null) {
    out.push({ name: match[1]!, line: code.slice(0, match.index).split('\n').length - 1 + 1 })
  }
  return out
}

function namingProblems(path: string, code: string, methods: readonly MethodModel[], options: NamingOptions): JunitInspectionProblem[] {
  const problems: JunitInspectionProblem[] = []
  const scope = frameworksInScope(code)
  const junit3 = scope.junit3
  // 类名规范：上游 `:46-55` 要求「是测试类且不是 suite 类」；本仓的词法判据 = 类里有测试方法。
  const testClass = methods.some(method => isTestAnnotated(method)) || /\bextends\s+(?:junit\.framework\.)?TestCase\b/.test(code)
  if (testClass && !/@Suite\b|@RunWith\(Parameterized/.test(code)) {
    const convention = conventionOf('JUnitTestClassNamingConvention', options)
    for (const declared of classNames(code)) {
      const message = namingMessage(convention, declared.name)
      if (!message) continue
      problems.push({ path, line: declared.line, character: 0, severity: WARNING,
        source: convention.shortName, message: `${message}（上游 naming/TestClassNamingConvention:37）` })
    }
  }
  for (const method of methods) {
    if (!method.modifiers.includes('public') && method.modifiers.length) continue
    const executable = isTestAnnotated(method)
    if (!executable) continue
    // 上游 JUnit3/JUnit4 两条的适用面分别是 JUnit3 测试方法与「可执行的 4/5/6 测试方法」
    // （JUnit3MethodNamingConvention.java:26、JUnit4MethodNamingConvention.java:23）。
    const shortName = junit3 ? 'JUnit3MethodNamingConvention' : 'JUnit4MethodNamingConvention'
    if (junit3 && !/^test/.test(method.name)) continue       // JUnit3 只查 testXxx 那批
    const convention = conventionOf(shortName, options)
    const message = namingMessage(convention, method.name)
    if (!message) continue
    problems.push({ path, line: method.line, character: Math.max(0, line(code, method.line).indexOf(method.name)),
      severity: WARNING, source: convention.shortName, message: `${message}（上游 naming/${shortName}）` })
  }
  return problems
}

/** 第二批全部规则（`src/junitInspections.ts` 直接并表）。 */
export function junitRuleProblems(path: string, text: string, options?: NamingOptions): JunitInspectionProblem[] {
  if (!/\.(java|kt)$/i.test(path)) return []
  // 掩码由调用方给（同一份 `maskNonCode`，避免在这里重复扫一遍全文）。
  const code = text
  const methods = parseMethods(code)
  return [...mixedFrameworkProblems(path, code, methods), ...malformedProblems(path, code, methods),
    ...multipleExceptionsProblems(path, code, methods), ...namingProblems(path, code, methods, options ?? {})]
}
