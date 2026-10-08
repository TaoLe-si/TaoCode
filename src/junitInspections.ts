// exec/junit-inspection：JUnit 代码检查的**纯文本子集** —— 上游 `plugins/junit` 的
// `com.intellij.execution.junit.codeInspection` 一族（逐类判决表的 `exec/junit-inspection` 族）。
//
// 上游那些检查是 PSI/UAST 规则（`BaseInspectionVisitor` + `AssertHint` + 类型解析），本仓没有
// PSI，但其中一批规则只靠**词法结构**就能判：对照的是 java-impl 的
// `MisorderedAssertEqualsArgumentsInspection`（字面量应在期望位）与 junit 插件的
// `JUnit3StyleTestMethodInJUnit4ClassInspection`（JUnit4 类里的 JUnit3 风格方法）、
// `UseOfObsoleteAssertInspection`（junit.framework.* 已废弃）、`JUnitIgnoredTestInspection`
// （@Ignore/@Disabled 无原因）、`ParameterizedParametersStaticCollectionInspection`
// （@Parameters 必须 static）。本仓把它们做成逐行规则，落进**本地检查通道**
// （`localDiagnostics`，由 `src/problems.ts` 与 LSP 诊断并列汇总进问题面板）。
//
// 明确不做（核对上游后仍然成立，逐条写着卡点）：
//   · `JUnitAssertEqualsOnArrayInspection` / `JUnitAssertEqualsMayBeAssertSameInspection`
//     （要知道参数静态类型是不是数组 / 是否只有 Object.equals）；
//   · `ExpectedExceptionNeverThrownInspection.java:40-53`（要看方法体是否真的抛出那个异常 ⇒ 数据流/调用图）；
//   · `deadCode/JUnit5ImplicitUsageProvider.kt:54-68` 整个建立在 `ReferencesSearch` 上，且本仓
//     没有「未使用符号」的本地检查 ⇒ 没有要抑制的误报，这条在本仓没有可见面。
// 第二批规则（`JUnitMixedFramework` / `JUnitMalformedDeclaration` 的词法可判子集 /
// `MultipleExceptionsDeclaredOnTestMethod` / naming 三条）在 `src/junitRules.ts` —— 原判定说它们
// 「需要 PSI 做不了」，核实上游后订正：判据本身是词法的，PSI 只用于放宽，见该模块头的留痕。
import { reactive } from 'vue'
import { DirtyScopeTracker, HighlightPassRegistrar, runMainHighlightPasses, type DirtyLineRange } from './highlightPasses.ts'
import { junitRuleProblems, type NamingOptions } from './junitRules.ts'
// 本地检查的 **EP 宿主**（上游 `com.intellij.localInspection`）：JUnit 规则集本身作为**一条 bundled
// 工具**登记进 EP，pass 跑的是 `runLocalInspectionTools`（全部登记的工具）—— 第三方插件按同一个
// EP id 挂的 localInspection 会跟着一起跑，不再是写死的一条通道。
import { registerLocalInspectionTool, runLocalInspectionTools } from './localInspectionTools.ts'

/** 规则声明的严重度沿用 IDEA「警告」档（问题面板里可被严重度过滤）。 */
const WARNING = 2

export interface JunitInspectionProblem {
  path: string
  /** 0 基行号（与 LSP 诊断同一基准，问题面板渲染时 +1）。 */
  line: number
  /** 0 基列号。 */
  character: number
  severity: number
  message: string
  /** 上游检查类的短名（诊断的「来源」列）。 */
  source: string
  /** 混用两代 API 那条给出的注解短名（快速修复要删的就是它）。 */
  annotation?: string
  /** 上游文案里的 `{1}`：这个类被判定为首选的那一代 JUnit（`3` / `4` / `5`）。 */
  framework?: '3' | '4' | '5'
}

/**
 * 把注释涂成空格、字符串/字符内容涂成 `x`（保留引号与换行），长度与原文一致。
 * 这样按行定位仍准确，而注释里的 `//`、字符串里的括号/逗号都不会参与规则匹配。
 */
export function maskNonCode(text: string): string {
  const out = text.split('')
  const n = text.length
  let i = 0
  while (i < n) {
    const ch = text[i]!
    if (ch === '/' && text[i + 1] === '/') {
      while (i < n && text[i] !== '\n') { out[i] = ' '; i++ }
      continue
    }
    if (ch === '/' && text[i + 1] === '*') {
      out[i] = ' '; out[i + 1] = ' '; i += 2
      while (i < n && !(text[i] === '*' && text[i + 1] === '/')) { if (text[i] !== '\n') out[i] = ' '; i++ }
      if (i < n) { out[i] = ' '; out[i + 1] = ' '; i += 2 }
      continue
    }
    if (ch === '"' && text[i + 1] === '"' && text[i + 2] === '"') {
      // 文本块：内容涂 x，开合三条引号保留（仍能被"字面量"形状认出来）。
      i += 3
      while (i < n && !(text[i] === '"' && text[i + 1] === '"' && text[i + 2] === '"')) { if (text[i] !== '\n') out[i] = 'x'; i++ }
      i = Math.min(n, i + 3)
      continue
    }
    if (ch === '"' || ch === "'") {
      const quote = ch
      i++
      while (i < n && text[i] !== quote && text[i] !== '\n') {
        if (text[i] === '\\') { out[i] = 'x'; i++; if (i < n) { out[i] = 'x'; i++ } continue }
        out[i] = 'x'; i++
      }
      if (i < n && text[i] === quote) i++
      continue
    }
    i++
  }
  return out.join('')
}

/** 原文下标 → 0 基行列（掩码不改长度，所以行列可直接用于原文）。 */
function locate(text: string, index: number): { line: number; character: number } {
  let line = 0
  let last = -1
  for (let at = text.indexOf('\n'); at >= 0 && at < index; at = text.indexOf('\n', at + 1)) { line++; last = at }
  return { line, character: index - last - 1 }
}

interface CallSite { name: string; args: string[]; argOffsets: number[] }

/** 找 `name(...)` 调用并切出顶层参数（掩码保证括号/逗号不会来自字符串或注释）。 */
function findCalls(code: string, pattern: RegExp): CallSite[] {
  const calls: CallSite[] = []
  let match: RegExpExecArray | null
  while ((match = pattern.exec(code)) !== null) {
    const open = match.index + match[0].length - 1
    let depth = 1
    let i = open + 1
    const raw: Array<{ text: string; at: number }> = []
    let start = i
    for (; i < code.length && depth > 0; i++) {
      const ch = code[i]!
      if (ch === '(' || ch === '{' || ch === '[') depth++
      else if (ch === ')' || ch === '}' || ch === ']') depth--
      else if (ch === ',' && depth === 1) { raw.push({ text: code.slice(start, i), at: start }); start = i + 1 }
    }
    if (depth !== 0) continue
    raw.push({ text: code.slice(start, i - 1), at: start })
    const args: string[] = []
    const argOffsets: number[] = []
    for (const item of raw) {
      const trimmed = item.text.trim()
      args.push(trimmed)
      argOffsets.push(item.at + (item.text.length - item.text.trimStart().length))
    }
    calls.push({ name: match[1]!, args, argOffsets })
  }
  return calls
}

/** 上游 `MisorderedAssertEqualsArgumentsInspection.looksLikeExpectedArgument` 的文本近似。 */
function looksLikeExpected(value: string): boolean {
  const text = value.trim()
  if (/^(?:"[^"]*"|'[^']*'|"""[\s\S]*""")$/.test(text)) return true            // 字符串/字符/文本块
  if (/^(?:true|false|null)$/.test(text)) return true
  if (/^(?:[+-]?(?:\d[\d_]*\.?[\d_]*|\.\d[\d_]*)(?:[eE][+-]?\d+)?[fFdDlL]?|0[xX][0-9a-fA-F_]+[lL]?)$/.test(text)) return true
  if (/^(?:[A-Z][A-Za-z0-9_]*\.)*[A-Z][A-Z0-9_]+$/.test(text)) return true      // 常量引用（MAX、TimeUnit.SECONDS）
  if (/^(?:"[^"]*"|'[^']*')(?:\s*\+\s*(?:"[^"]*"|'[^']*'))+$/.test(text)) return true // 字面量拼接
  return false
}

/** 规则一：`assertEquals` 等比较断言的参数顺序（上游 MisorderedAssertEqualsArgumentsInspection）。 */
function misorderedAssertProblems(path: string, text: string, code: string): JunitInspectionProblem[] {
  const methods = ['assertEqualsNoOrder', 'assertNotEquals', 'assertEquals', 'assertArrayEquals', 'assertSame', 'assertNotSame']
  const calls = findCalls(code, new RegExp(`\\b(${methods.join('|')})\\s*\\(`, 'g'))
  const problems: JunitInspectionProblem[] = []
  for (const call of calls) {
    const args = call.args
    let expected = -1
    let actual = -1
    if (args.length === 2) { expected = 0; actual = 1 }
    else if (args.length === 3) {
      // 三参：首参是消息字符串 → (message, expected, actual)；否则是 (expected, actual, delta)。
      if (/^"/.test(args[0]!)) { expected = 1; actual = 2 }
      else { expected = 0; actual = 1 }
    } else if (args.length === 4) { expected = 1; actual = 2 }   // (message, expected, actual, delta)
    else continue
    if (expected >= args.length || actual >= args.length) continue
    if (looksLikeExpected(args[expected]!) || !looksLikeExpected(args[actual]!)) continue
    const at = locate(text, call.argOffsets[expected]!)
    problems.push({ path, line: at.line, character: at.character, severity: WARNING,
      source: 'MisorderedAssertEqualsArguments',
      message: `${call.name} 的参数顺序可能颠倒：字面量/常量应在期望位（第一个参数）—— 上游 MisorderedAssertEqualsArgumentsInspection` })
  }
  return problems
}

/** 方法行上方紧邻的注解块（跳过空行；参数跨行的注解也收进来）。 */
function annotationsAbove(lines: readonly string[], methodLine: number): string[] {
  const collected: string[] = []
  let j = methodLine - 1
  while (j >= 0) {
    const line = lines[j]!
    const trimmed = line.trim()
    if (trimmed === '') { j--; continue }
    if (trimmed.startsWith('@')) { collected.unshift(trimmed); j--; continue }
    if (collected.length && /[(,]\s*$/.test(lines[j + 1]!.trim())) { collected.unshift(trimmed); j--; continue }
    break
  }
  return collected
}

/** 规则二/三：JUnit3 风格与过时 API 的迁移提示（上游 JUnit3StyleTestMethodInJUnit4Class、UseOfObsoleteAssert、JUnit4Converter）。 */
function junit3MigrationProblems(path: string, text: string, code: string): JunitInspectionProblem[] {
  const problems: JunitInspectionProblem[] = []
  const lines = code.split(/\r?\n/)
  const rawLines = text.split(/\r?\n/)   // 掩码保长度：同一列号在原文里也成立
  // JUnit4/5 的 API 出现过；JUnit3 类不做 JUnit3 风格提示（上游 TestUtils.isJUnitTestClass 的短路）。
  const javaUnit4 = /@(?:Test|Before|After|BeforeClass|AfterClass|RunWith|Rule|ClassRule)\b/.test(code) || /org\.junit\./.test(code)
  const junit3Class = /extends\s+(?:junit\.framework\.)?TestCase\b/.test(code)
  if (javaUnit4 && !junit3Class) {
    for (let i = 0; i < lines.length; i++) {
      const match = /^\s*(?:public\s+)?void\s+(test[A-Za-z0-9_]*)\s*\(\s*\)\s*(?:throws\b[^{]*)?\{/.exec(lines[i]!)
        ?? /^\s*(?:fun\s+)(test[A-Za-z0-9_]*)\s*\(\s*\)\s*\{/.exec(lines[i]!)
      if (!match) continue
      const annotations = annotationsAbove(lines, i)
      if (annotations.some(annotation => /^@Test\b|^@org\.junit\.Test\b|^@org\.junit\.jupiter\.api\.Test\b/.test(annotation))) continue
      if (annotations.some(annotation => /^@(?:Ignore|Disabled)\b/.test(annotation))) continue
      problems.push({ path, line: i, character: Math.max(0, rawLines[i]!.indexOf(match[1]!)), severity: WARNING,
        source: 'JUnit3StyleTestMethodInJUnit4Class',
        message: `JUnit 4/5 类里的 JUnit 3 风格测试方法（${match[1]} 没有 @Test）—— 上游 JUnit3StyleTestMethodInJUnit4ClassInspection` })
    }
  }
  // junit.framework.*：导入、直接引用、以及 `extends TestCase`（上游 UseOfObsoleteAssertInspection 的入口）。
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!
    if (/^\s*import\s+(?:static\s+)?junit\.framework\b/.test(line)) {
      problems.push({ path, line: i, character: 0, severity: WARNING, source: 'UseOfObsoleteAssertInspection',
        message: 'JUnit 3 的 junit.framework.* 已废弃：迁移到 org.junit（上游 UseOfObsoleteAssertInspection）' })
      continue
    }
    const used = /\bjunit\.framework\.(?:Assert|TestCase)\b/.exec(line)
    if (used) {
      problems.push({ path, line: i, character: used.index, severity: WARNING, source: 'UseOfObsoleteAssertInspection',
        message: 'JUnit 3 的 junit.framework.* 已废弃：迁移到 org.junit（上游 UseOfObsoleteAssertInspection）' })
      continue
    }
    const inherited = /\bextends\s+TestCase\b/.exec(line)
    if (inherited) {
      problems.push({ path, line: i, character: inherited.index, severity: WARNING, source: 'JUnit4ConverterInspection',
        message: 'JUnit 3 的 TestCase 已废弃：JUnit 4/5 用注解与断言类（上游 JUnit4ConverterInspection）' })
    }
  }
  return problems
}

/** 规则四：`@Ignore`/`@Disabled` 没写原因（上游 JUnitIgnoredTestInspection 的 onlyReportWithoutReason 默认档）。 */
function ignoredWithoutReasonProblems(path: string, code: string): JunitInspectionProblem[] {
  const problems: JunitInspectionProblem[] = []
  const lines = code.split(/\r?\n/)
  const annotation = /@(?:(?:org\.junit\.)?Ignore|(?:org\.junit\.jupiter\.api\.)?Disabled)\b/
  for (let i = 0; i < lines.length; i++) {
    const match = annotation.exec(lines[i]!)
    if (!match) continue
    const rest = lines[i]!.slice(match.index + match[0].length).trim()
    if (rest === '') {
      problems.push({ path, line: i, character: match.index, severity: WARNING, source: 'JUnitIgnoredTestInspection',
        message: `@${match[0].includes('Disabled') ? 'Disabled' : 'Ignore'} 没有写明原因（上游 JUnitIgnoredTestInspection）` })
      continue
    }
    if (rest.startsWith('(')) {
      const close = rest.indexOf(')')
      if (close < 0) continue                       // 参数跨行：不猜，交给 PSI 版规则的重活
      if (rest.slice(1, close).trim() === '')
        problems.push({ path, line: i, character: match.index, severity: WARNING, source: 'JUnitIgnoredTestInspection',
          message: `@${match[0].includes('Disabled') ? 'Disabled' : 'Ignore'} 没有写明原因（上游 JUnitIgnoredTestInspection）` })
    }
  }
  return problems
}

/** 规则五：`@Parameters` 的数据提供者必须 static（上游 ParameterizedParametersStaticCollectionInspection）。 */
function parameterizedProblems(path: string, code: string): JunitInspectionProblem[] {
  const problems: JunitInspectionProblem[] = []
  const lines = code.split(/\r?\n/)
  const signature = /^\s*(?:public\s+|protected\s+|private\s+)?(?:(static)\s+)?[\w<>\[\],.\s?]+\s+(\w+)\s*\(/
  for (let i = 0; i < lines.length; i++) {
    if (!/@(?:Parameterized\.)?Parameters\b/.test(lines[i]!)) continue
    for (let j = i + 1; j < Math.min(lines.length, i + 5); j++) {
      const line = lines[j]!
      if (line.trim() === '' || line.trim().startsWith('@')) continue
      const match = signature.exec(line)
      if (!match) break
      if (!match[1])
        problems.push({ path, line: j, character: line.indexOf(match[2]!), severity: WARNING,
          source: 'ParameterizedParametersStaticCollection',
          message: '@Parameters 的数据提供者必须是 static 方法（上游 ParameterizedParametersStaticCollectionInspection）' })
      break
    }
  }
  return problems
}

/** 命名规范的用户覆盖（上游是 `NamingConventionBean` 存在检查条目里；本仓一张表，面板/设置写它）。 */
export const junitNamingOptions: NamingOptions = reactive<Record<string, string>>({})

/** 全部规则 → 该文件的诊断（按行、列、来源排序；非 Java/Kotlin 文件返回空）。 */
export function junitInspectionProblems(path: string, text: string): JunitInspectionProblem[] {
  if (!/\.(java|kt)$/i.test(path)) return []
  const code = maskNonCode(text)
  const problems = [
    ...misorderedAssertProblems(path, text, code),
    ...junit3MigrationProblems(path, text, code),
    ...ignoredWithoutReasonProblems(path, code),
    ...parameterizedProblems(path, code),
    // 第二批（混用两代 API / 声明不合法 / throws 冗余 / 命名规范），见 src/junitRules.ts。
    ...junitRuleProblems(path, code, junitNamingOptions),

  ]
  problems.sort((a, b) => a.line - b.line || a.character - b.character || a.source.localeCompare(b.source))
  return problems
}

/**
 * 本地检查通道：按文件存 JUnit 检查结果。问题是**随编辑实时重算**的（IDEA 的 daemon 对打开
 * 文件做 on-the-fly 分析），所以写入口只有两个：`src/lspNavigation.ts` 的 `onEditorChange`
 * （每次编辑）与 `startLsp`（打开文件时算一次）。消费方是 `src/problems.ts` 的 `allProblems`。
 */
export const localDiagnostics = reactive(new Map<string, JunitInspectionProblem[]>())

// 本地检查的 pass 接线（上游 `TextEditorHighlightingPassRegistrar` +
// `MainHighlightingPassFactory` + `DirtyScopeTrackingHighlightingPassFactory`，
// 见 src/highlightPasses.ts）：本模块是注册表里的第一个 pass，
//   · 同一路径同一内容重复刷新（打开时算一次 + 随后内容没变的编辑事件）整拍短路，不再全文重扫；
//   · 每次真变化记下脏行范围，pass 跑完消费掉 —— 增量重扫的落点，判据 tests/highlight-passes.test.mjs。
const inspectionPasses = new HighlightPassRegistrar()
const inspectionDirtyScope = new DirtyScopeTracker()
/** 最近一次刷新消费掉的脏行范围（调试与判据可读；上游 dirty scope 也是这个语义）。 */
export const localInspectionDirtyRanges = new Map<string, DirtyLineRange[]>()
function recordDirtyRanges(path: string, ranges: readonly DirtyLineRange[]): void {
  if (ranges.length) localInspectionDirtyRanges.set(path, [...ranges])
  else localInspectionDirtyRanges.delete(path)
  // 有上限，避免长会话里攒路径（表只用于留档）。
  if (localInspectionDirtyRanges.size > 64) {
    const oldest = localInspectionDirtyRanges.keys().next().value
    if (oldest !== undefined) localInspectionDirtyRanges.delete(oldest)
  }
}
inspectionPasses.registerPass(context => {
  recordDirtyRanges(context.path, context.dirtyRanges)
  // pass 跑**全部登记的本地检查工具**（`com.intellij.localInspection` EP）：JUnit 规则集是其中的
  // bundled 一条，第三方插件挂进来的 localInspection 在这里一起产诊断，进同一条本地通道。
  const problems = runLocalInspectionTools({ path: context.path, text: context.text, code: maskNonCode(context.text) })
  if (problems.length) localDiagnostics.set(context.path, problems)
  else localDiagnostics.delete(context.path)
}, { kind: 'main' })

// JUnit 规则集作为 bundled 工具登记（上游 `plugins/junit` 的 `localInspection` 贡献在 plugin.xml 里
// 的那几条）：`shortName` 用检查类的短名口径，第三方可用同名覆盖。
registerLocalInspectionTool({
  shortName: 'JUnit',
  displayName: 'JUnit 检查',
  groupDisplayName: 'JUnit',
  severity: WARNING,
  check: context => junitInspectionProblems(context.path, context.text),
}, { source: 'bundled' })

/** 重算一个文件并写通道；没有问题时删掉条目（编辑修好即从问题面板消失）。 */
export function refreshLocalInspections(path: string, text: string): void {
  // 同一内容重复刷新整拍短路（`MainHighlightingPassFactory` 的判据），真变化才跑 pass。
  runMainHighlightPasses(inspectionPasses, inspectionDirtyScope, path, text)
}

export function clearLocalInspections(path: string): void {
  localDiagnostics.delete(path)
  inspectionDirtyScope.forget(path)
  localInspectionDirtyRanges.delete(path)
}
