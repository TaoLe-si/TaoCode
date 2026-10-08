// 「隐式使用」查询的**元素形状与词法归类** —— 上游 `ImplicitUsageProvider` 的入参是 `PsiElement`，
// 本仓没有 PSI，于是把「诊断说这里有未使用符号」那一拍手边真有的东西收成一个元素：
// 工作区相对路径 + 0 基行/列 + 符号名 + **词法判出来的**声明形态 + 就近行文本 + 整份文本 + 语言 id。
//
// 上游 provider 靠 PSI 的形态分档（`plugins/junit/src/com/intellij/execution/junit/codeInspection/deadCode/JUnit5ImplicitUsageProvider.kt`
// 的 `when (element)` 分 `PsiParameter` / `PsiEnumConstant` / `PsiMethod` / `PsiField` / `PsiClass`）；
// 本仓的等价物是 `kindOfDeclaration` 的几条**词法规则**：只看这一行（必要时回看上一行）就把形态
// 归到七档之一，认不出给 `unknown`。这是**有界的近似**，不是 PSI 类型判定 —— 每条规则旁边写了
// 它认什么、认不出什么，宁可给 `unknown`（provider 据此不认）也不猜：
//   · `enumConstant`：整行只有一个大写下划线标识符（可带注解前缀与 `,`/`;` 尾巴）；
//   · `class`：名字前面出现 `class`/`interface`/`enum`/`struct`/`trait`/`record`/`namespace`/`type`；
//   · `parameter`：名字落在本行**未闭合的** `(` … `)` 里（方法签名的形参表）；
//   · `method`：名字后面还有 `(`，或前面出现 `def`/`function`/`fn`/`func`/`fun`/`method`/`proc`；
//   · `local`：前面出现 `let`/`const`/`var`/`val`/`auto`；
//   · `field`：`;` 或 `=` 收尾（声明行的常见写法）；
//   · `unknown`：都不像。
// 认不出的差别（如实记）：Java 的 `void run() {` 归 `method`（名字后面有 `(`）✓，但
// Kotlin 的 `val x = 1` 归 `local`（上游可能是属性 = field）；Python 模块级 `x = 1` 归 `unknown`。
//
// 纯函数、零依赖（只 import `src/daemonAnalysisExtensionPoints.ts` 的**类型**），便于 `node --test` 直测。
// 判据：`tests/daemon-analysis-extension-points.test.mjs`。

import type { ImplicitUsageElement, ImplicitUsageElementKind } from './daemonAnalysisExtensionPoints.ts'

/** 标识符字符（与 `src/usageHighlight.ts` 的取词口径同族：字母/数字/下划线/`$`）。 */
const WORD = /[A-Za-z0-9_$]/
/** 类型声明关键字（出现在名字**之前** ⇒ 这一行在声明一个类型）。 */
const TYPE_KEYWORDS = /\b(class|interface|enum|struct|trait|record|namespace|type)\b/
/** 函数声明关键字（有些语言没有 `(` 也能认出来）。 */
const FUNCTION_KEYWORDS = /\b(def|function|fn|func|fun|method|proc)\b/
/** 局部变量声明关键字。 */
const LOCAL_KEYWORDS = /\b(let|const|var|val|auto)\b/
/** 枚举常量的常见形态：全大写标识符。 */
const UPPER_CASE_NAME = /^[A-Z][A-Z0-9_]*$/

/** 正则里要转义的字面（`$` 也在标识符字符集里，不转义会被当成行尾锚）。 */
function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/** 第 `line` 行（0 基）的文本，不含行尾的 `\r`（行号越界给空串）。 */
export function lineTextOf(text: string, line: number): string {
  if (!Number.isFinite(line) || line < 0) return ''
  let at = 0
  for (let current = 0; current < line; ++current) {
    const next = text.indexOf('\n', at)
    if (next < 0) return ''
    at = next + 1
  }
  const end = text.indexOf('\n', at)
  return (end < 0 ? text.slice(at) : text.slice(at, end)).replace(/\r$/, '')
}

/** `column`（0 基）处的整词；不在词上给空串（不猜、不去别处找名字）。 */
export function wordAt(lineText: string, column: number): string {
  if (!Number.isFinite(column) || column < 0 || column >= lineText.length) return ''
  if (!WORD.test(lineText[column])) return ''
  let start = column
  while (start > 0 && WORD.test(lineText[start - 1])) start -= 1
  let end = column
  while (end + 1 < lineText.length && WORD.test(lineText[end + 1])) end += 1
  return lineText.slice(start, end + 1)
}

/** `end` 这个位置是否落在本行一个**还没闭合**的 `(` 里（形参表的词法判定）。 */
function insideParens(lineText: string, end: number): boolean {
  let depth = 0
  for (let index = 0; index < end && index < lineText.length; ++index) {
    if (lineText[index] === '(') depth += 1
    else if (lineText[index] === ')') depth = Math.max(0, depth - 1)
  }
  return depth > 0
}

/** 就近词法归类（规则逐条见文件头；认不出给 `unknown`）。 */
export function kindOfDeclaration(lineText: string, name: string, column: number): ImplicitUsageElementKind {
  const before = lineText.slice(0, Math.max(0, column))
  const after = lineText.slice(Math.max(0, column) + name.length)
  // 枚举常量：整行就是它一个（可带注解前缀与 `,`/`;` 尾巴），且名字全大写。
  if (name && UPPER_CASE_NAME.test(name)) {
    const only = new RegExp(`^\\s*(?:@[\\w.$]+\\s*)*${escapeRegExp(name)}\\s*[,;]?\\s*$`)
    if (only.test(lineText)) return 'enumConstant'
  }
  if (TYPE_KEYWORDS.test(before)) return 'class'
  if (name && insideParens(lineText, column + name.length)) return 'parameter'
  if (after.includes('(')) return 'method'
  if (FUNCTION_KEYWORDS.test(before)) return 'method'
  if (LOCAL_KEYWORDS.test(before)) return 'local'
  if (/[;=]\s*$/.test(lineText.trimEnd())) return 'field'
  return 'unknown'
}

/** 构造元素的入参：诊断（或调用方）给得出来的那几格。 */
export interface ImplicitUsageQuery {
  /** 工作区相对路径。 */
  path: string
  /** 语言 id。 */
  language: string
  /** 整份文件文本。 */
  text: string
  /** 0 基行号（诊断的起点行）。 */
  line: number
  /** 0 基列号（诊断的起点列）。 */
  column: number
}

/**
 * 把「诊断指向的位置」构造成 `ImplicitUsageElement`：行/列先夹到文本内（坏值不抛错），
 * 名字取列处的整词，形态按 `kindOfDeclaration` 归类。纯函数，不改入参。
 */
export function implicitUsageElementOf(query: ImplicitUsageQuery): ImplicitUsageElement {
  const text = typeof query.text === 'string' ? query.text : ''
  const line = Number.isFinite(query.line) ? Math.max(0, Math.trunc(query.line)) : 0
  const lineText = lineTextOf(text, line)
  const column = Number.isFinite(query.column)
    ? Math.min(Math.max(0, Math.trunc(query.column)), Math.max(0, lineText.length))
    : 0
  const name = wordAt(lineText, column)
  return {
    path: query.path,
    line,
    column,
    name,
    kind: kindOfDeclaration(lineText, name, column),
    lineText,
    text,
    language: query.language,
  }
}
