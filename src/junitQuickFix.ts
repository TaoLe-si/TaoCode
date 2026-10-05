// exec/junit-inspection：**本地检查的快速修复**（上游那两个 `LocalQuickFix` 的文本版）。
//
// 上游依据：
//   · `java/java-analysis-impl/src/com/siyeh/ig/testFrameworks/MisorderedAssertEqualsArgumentsInspection.java`
//     `:55-57` `buildFix` 返回 `FlipArgumentsFix`；`:59-87` 的 `applyFix` 是**互换
//     expected 与 actual 两个表达式**（`expectedArgument.replace(actualArgument)` 之后换回来），
//     方法名清单在 `:45-47`（`assertEquals` / `assertEqualsNoOrder` / `assertNotEquals` /
//     `assertArrayEquals` / `assertSame` / `assertNotSame` / `failNotSame` / `failNotEquals`）；
//   · `plugins/junit/src/com/intellij/execution/junit/codeInspection/JUnit3StyleTestMethodInJUnit4ClassInspection.java:32-34`
//     —— `buildFix` 给出的是 `AddAnnotationModCommandAction("org.junit.Test", method)`：
//     给 JUnit3 风格的 `testXxx` 方法补上 `@org.junit.Test`；
//   · expected/actual 落在哪两个参数上由 `AssertHint` 决定
//     （`java/java-analysis-impl/src/com/siyeh/ig/testFrameworks/AssertHint.kt`）：
//     `:24-28` 参数序（JUnit3/4 是 `MESSAGE_EXPECTED_ACTUAL`，JUnit 5 是
//     `EXPECTED_ACTUAL_MESSAGE`，TestNG 是 `ACTUAL_EXPECTED_MESSAGE`）、`:30-40` 消息在首/末位的
//     判定、`:111-130` `getMessage`（首位的必须是 String；末位的**不能**是 delta
//     —— `assertEquals(double,double,double)` 的第三参不是消息）、`:82-84` `expected`/`actual` 取哪两个。
//
// 本仓没有 PSI，所以「哪个参数是 expected/actual」走**词法判据**：首参是字符串字面量 ⇒ 消息在首位
// （JUnit3/4 形）；否则末参是字符串字面量 ⇒ 消息在末位（JUnit 5 形）；再否则三参形是
// `(expected, actual, delta)`。这与 `src/junitInspections.ts` 的 `misorderedAssertProblems` 同一口径。
// 输出是 `LspCodeAction`（与 `src/localIntentions.ts` 的本地条目同形），进 Alt+Enter 列表
// （`src/semanticActions.ts` 的 `openCodeActions` 把本地条目与语言服务的 quickfix 并列）。
// 判据 `tests/junit-quickfix.test.mjs`。
import type { LspCodeAction, LspTextEdit } from './bridge'
import { maskNonCode } from './junitInspections.ts'

/** 上游 `MisorderedAssertEqualsArgumentsInspection.methodNames`（:45-47）。 */
export const FLIPPABLE_ASSERT_METHODS: readonly string[] = [
  'assertEquals', 'assertEqualsNoOrder', 'assertNotEquals', 'assertArrayEquals',
  'assertSame', 'assertNotSame', 'failNotSame', 'failNotEquals',
]

export interface AssertArgument { text: string; /** 在原文（掩码）里的起点。 */ start: number; end: number }

/** 切出 `name(...)` 的顶层参数（掩码保证括号/逗号不会来自字符串或注释）。 */
function callArguments(code: string, line: number): { name: string; open: number; args: AssertArgument[] } | null {
  const from = line >= 0 && line < code.length ? line : 0
  const slice = code.slice(from)
  const match = /\b([A-Za-z_][A-Za-z0-9_]*)\s*\(/.exec(slice)
  if (!match || !FLIPPABLE_ASSERT_METHODS.includes(match[1]!)) return null
  const open = from + match.index + match[0].length - 1
  let depth = 1
  let i = open + 1
  let start = i
  const args: AssertArgument[] = []
  for (; i < code.length && depth > 0; i++) {
    const ch = code[i]!
    if (ch === '(' || ch === '{' || ch === '[') ++depth
    else if (ch === ')' || ch === '}' || ch === ']') --depth
    else if (ch === ',' && depth === 1) {
      args.push({ text: code.slice(start, i), start, end: i })
      start = i + 1
    }
  }
  if (depth !== 0 || !args.length) return null
  args.push({ text: code.slice(start, i - 1), start, end: i - 1 })
  return { name: match[1]!, open, args }
}

const isStringLiteral = (arg: AssertArgument): boolean => /^\s*"/.test(arg.text)

/**
 * 哪个参数是 expected、哪个是 actual（`AssertHint` 的词法版）。返回 null = 这个调用
 * 没有可互换的两个参数（三参且末位是 delta、单参等）。
 */
export function assertArgumentRoles(
  args: readonly AssertArgument[],
): { expected: number; actual: number } | null {
  if (args.length < 2) return null
  if (isStringLiteral(args[0]!)) return { expected: 1, actual: 2 }                 // 消息在首位
  if (args.length >= 3 && isStringLiteral(args[args.length - 1]!)) return { expected: 0, actual: 1 }  // 消息在末位
  if (args.length === 2) return { expected: 0, actual: 1 }
  if (args.length === 3) return { expected: 0, actual: 1 }                        // (expected, actual, delta)
  return null
}

function replaceEdit(document: string, from: number, to: number, text: string): LspTextEdit {
  const before = document.slice(0, from)
  const line = before.split('\n').length - 1
  const lineStart = before.lastIndexOf('\n') + 1
  const prefix = document.slice(lineStart, from)
  const target = document.slice(from, to)
  const at = { line, character: prefix.length }
  return {
    text,
    startLine: at.line, startChar: at.character,
    // 末行可能还有内容（`assertEquals(a, b);`），所以按行内偏移算终点。
    endLine: at.line, endChar: at.character + target.length,
  }
}

/**
 * 「Flip arguments」修复：互换 expected / actual 两个表达式（上游 `FlipArgumentsFix.applyFix`，:67-86）。
 * 一次编辑覆盖整段实参列表（换行调用也不会错位）。
 */
export function flipArgumentsAction(document: string, line: number): LspCodeAction | null {
  const code = maskNonCode(document)
  // 行首偏移：从掩码逐行数出来（`maskNonCode` 保长度，所以两边下标通用）。
  const lines = code.split('\n')
  let offset = 0
  for (let i = 0; i < line && i < lines.length; ++i) offset += lines[i]!.length + 1
  const call = callArguments(code, offset)
  if (!call) return null
  const roles = assertArgumentRoles(call.args)
  if (!roles || roles.actual >= call.args.length) return null
  const expected = call.args[roles.expected]!
  const actual = call.args[roles.actual]!
  // 实参文本取**原文**（掩码只用于定位：字符串内容被涂成了 x）。
  const original = (arg: AssertArgument) => document.slice(arg.start, arg.end)
  const rewritten = call.args
    .map((arg, index) => (index === roles.expected ? original(actual) : index === roles.actual ? original(expected) : arg.text))
    .join(',')
  const edit = replaceEdit(document, expected.start, actual.end, rewritten)
  return {
    title: '交换 assertEquals() 的预期值与实际值参数',
    index: -1,
    kind: 'quickfix',
    preferred: true,
    edits: [{ path: '', textEdits: [edit] }],
  }
}

/** JUnit3 风格 `testXxx` 方法上补 `@org.junit.Test`（上游 `AddAnnotationModCommandAction`）。 */
export function addTestAnnotationAction(document: string, line: number, annotation = 'org.junit.Test'): LspCodeAction | null {
  const lines = document.split('\n')
  if (line < 0 || line >= lines.length) return null
  const code = maskNonCode(document).split('\n')
  const codeLine = code[line] ?? ''
  const match = /^\s*(?:public\s+|protected\s+|private\s+)?void\s+(test[A-Za-z0-9_]*)\s*\(/.exec(codeLine)
  if (!match) return null
  // 上游的补注解会跳过已有 `@Test` 的方法（`JUnit3StyleTestMethodInJUnit4ClassInspectionVisitor` 的短路）。
  if (lines.slice(0, line).some(before => /^\s*@(?:Test|org\.junit\.Test|org\.junit\.jupiter\.api\.Test)\b/.test(before))) return null
  const indent = /^[ \t]*/.exec(lines[line]!)![0]
  const edit: LspTextEdit = { text: `${indent}@${annotation}\n`, startLine: line, startChar: 0, endLine: line, endChar: 0 }
  return {
    title: `给 ${match[1]!} 加上 @${annotation}`,
    index: -1,
    kind: 'quickfix',
    preferred: true,
    edits: [{ path: '', textEdits: [edit] }],
  }
}

export interface JunitQuickFixInput {
  path: string
  /** 当前缓冲区文本（不是磁盘内容）。 */
  text: string
  /** 落在该行上的本地检查诊断（`src/junitInspections.ts` 的 `JunitInspectionProblem`）。 */
  diagnostics: readonly { line: number; source: string; annotation?: string; framework?: '3' | '4' | '5' }[]
}

/**
 * 「删掉这个注解」（上游 `RemoveAnnotationQuickFix` / `RemoveAnnotationAndPrefixQuickFix`）。
 * 标题逐字取自 `platform/analysis-api/resources/messages/CommonQuickFixBundle.properties:29`
 * 的 `fix.remove.annotation.text` = `Remove ''@{0}'' annotation`。
 * 整行只有注解时连行一起删（`JUnitMixedFrameworkInspection.kt:216-218` 删的就是注解节点）。
 */
export function removeAnnotationAction(document: string, line: number, annotation: string): LspCodeAction | null {
  const lines = document.split('\n')
  if (line < 0 || line >= lines.length || !annotation) return null
  const text = lines[line]!
  const at = text.indexOf(`@${annotation}`)
  if (at < 0) return null
  const onlyAnnotation = text.slice(0, at).trim() === '' && text.slice(at + annotation.length + 1).trim() === ''
  const edit: LspTextEdit = onlyAnnotation
    ? { text: '', startLine: line, startChar: 0, endLine: line + 1, endChar: 0 }
    : { text: '', startLine: line, startChar: at, endLine: line, endChar: at + annotation.length + 1 }
  return { title: `Remove '@${annotation}' annotation`, index: -1, kind: 'quickfix', preferred: false,
    edits: [{ path: '', textEdits: [edit] }] }
}

/**
 * 删注解之外还要把方法改名成 `testXxx`（上游 `JUnitMixedFrameworkInspection.kt:212-214`：
 * `RenameQuickFix(method, prefix + method.name.capitalize())`；`@Ignore` 那一支的前缀是 `_`
 * 且不首字母大写，`:85`/`:89`）。
 */
export function renameWithPrefixAction(document: string, methodLine: number, prefix: string, capitalize: boolean): LspCodeAction | null {
  const lines = document.split('\n')
  if (methodLine < 0 || methodLine >= lines.length) return null
  const match = /\b([\w$]+)\s*\(/.exec(lines[methodLine]!)
  if (!match) return null
  const name = match[1]!
  if (name.startsWith(prefix)) return null                     // 上游 :202/:212 的 `startsWith(prefix) == false` 短路
  const renamed = capitalize ? name.replace(/^./, char => char.toUpperCase()) : name
  const at = match.index + match[0].indexOf(name)
  return {
    title: `Rename '${name}' to '${prefix}${renamed}'`,
    index: -1, kind: 'quickfix', preferred: false,
    edits: [{ path: '', textEdits: [{ text: `${prefix}${renamed}`, startLine: methodLine, startChar: at, endLine: methodLine, endChar: at + name.length }] }],
  }
}

/**
 * `throws A, B` ⇒ `throws Exception`（上游
 * `MultipleExceptionsDeclaredOnTestMethodInspection.java:41-51`：先删掉 throws 列表里的每个引用，
 * 再补一个 `java.lang.Exception`）。标题取自 `CommonQuickFixBundle.properties:18`
 * 的 `fix.replace.with.x` = `Replace with ''{0}''`。
 */
export function throwsExceptionAction(document: string, line: number): LspCodeAction | null {
  const lines = document.split('\n')
  if (line < 0 || line >= lines.length) return null
  const match = /\bthrows\s+([^{;\n]+)/.exec(lines[line]!)
  if (!match) return null
  const names = match[1]!.split(',').map(part => part.trim()).filter(Boolean)
  if (names.length < 2) return null                             // 上游 :82-84 的判据
  const at = match.index + match[0].indexOf(match[1]!)
  return {
    title: "Replace with 'throws Exception'",
    index: -1, kind: 'quickfix', preferred: false,
    edits: [{ path: '', textEdits: [{ text: 'Exception', startLine: line, startChar: at, endLine: line, endChar: at + match[1]!.length }] }],
  }
}

/** 该行可用的 JUnit 修复条目（与 `suppressionActionsFor` 同形，`edits.path` 由调用方补路径）。 */
export function junitQuickFixActions(input: JunitQuickFixInput): LspCodeAction[] {
  const out: LspCodeAction[] = []
  const seen = new Set<string>()
  for (const diagnostic of input.diagnostics) {
    const candidates: (LspCodeAction | null)[] = []
    if (diagnostic.source === 'MisorderedAssertEqualsArguments') {
      candidates.push(flipArgumentsAction(input.text, diagnostic.line))
    } else if (diagnostic.source === 'JUnit3StyleTestMethodInJUnit4Class') {
      candidates.push(addTestAnnotationAction(input.text, diagnostic.line))
    } else if (diagnostic.source === 'MultipleExceptionsDeclaredOnTestMethod') {
      candidates.push(throwsExceptionAction(input.text, diagnostic.line))
    } else if (diagnostic.source === 'JUnitMixedFramework' && diagnostic.annotation) {
      // 上游 `:86-88`/`:91-93`：这些注解的修复就是「删掉它」；只有 JUnit3 那一支额外改名。
      candidates.push(removeAnnotationAction(input.text, diagnostic.line, diagnostic.annotation))
      if (diagnostic.framework === '3') {
        const prefix = diagnostic.annotation === 'Test' ? 'test' : '_'
        const methodLine = signatureBelow(input.text, diagnostic.line)
        if (methodLine !== null) candidates.push(renameWithPrefixAction(input.text, methodLine, prefix, diagnostic.annotation === 'Test'))
      }
    }
    for (const action of candidates) {
      if (!action || seen.has(action.title)) continue
      seen.add(action.title)
      out.push({ ...action, edits: (action.edits ?? []).map(edit => ({ path: input.path, textEdits: edit.textEdits })) })
    }
  }
  return out
}

/** 注解行往下找签名行（上游的 `annotation.parentOfType<PsiMethod>()` 的词法等价物）。 */
function signatureBelow(document: string, annotationLine: number): number | null {
  const lines = document.split('\n')
  for (let i = annotationLine + 1; i < Math.min(lines.length, annotationLine + 8); ++i) {
    const trimmed = lines[i]!.trim()
    if (trimmed === '') continue
    if (trimmed.startsWith('@')) continue
    return /\b[\w$]+\s*\(/.test(trimmed) ? i : null
  }
  return null
}
