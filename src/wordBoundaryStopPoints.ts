// **词边界停点算法** —— 按词跳转（Ctrl+Left / Ctrl+Right 那一族）的停点判据。
//
// 唯一事实来源：`platform/platform-impl/src/com/intellij/openapi/editor/actions/EditorActionUtil.java`
// 与同目录 `NextPrevWordHandler.java`；停点档位枚举在
// `platform/ide-core-impl/src/com/intellij/openapi/editor/actions/CaretStopOptions.kt`。
//
// 本文件只做「给文本 + 光标偏移，算出下一个/上一个词起点、词终点」这一件事：
//   · 字符分类逐条对着上游 `java.lang.Character` 的调用写，下面每条都给出 `文件:行号`；
//   · 停点扫描照抄 `getNextWordStopOffset`(`:249-258`) / `getPreviousWordStopOffset`(`:260-269`)
//     的循环边界，以及 `isWordStopOffset`(`:271-281`) 的三档布尔式。
//
// **不做的部分**（都依赖编辑器实例，纯逻辑无法复刻，文件尾「无法核实」登记）：
//   · `isLexemeBoundary`(`:344-350`) / `advanceTokenOnBoundary`(`:283-295`) /
//     `retreatTokenOnBoundary`(`:297-309`) —— 要语法高亮 token 迭代器；本文件把
//     `isLexemeBoundary` 默认按 `false` 处理，并把它做成可注入的回调，保留上游的按偏移计算形状；
//   · `handleQuoted`(`:205-215`、`:235-245`) —— 引号 token 特例，同上依赖 token 迭代器；
//   · 折叠区(`:691-703`)、双向文本(`NextPrevWordHandler.java:32-39`)、选区(`:716-735`)、
//     密码框(`NextPrevWordHandler.java:25-29`) —— 与停点算法无关。

// ─────────────────────────── 字符分类（照 java.lang.Character 的调用）───────────────────────────
//
// `EditorActionUtil.java:44-49` 静态导入的正是这几个 `Character.*`：
//   `isDigit` / `isJavaIdentifierPart` / `isLetterOrDigit` / `isLowerCase` / `isUpperCase` / `isWhitespace`。

/** `EditorActionUtil.java:951,952,981`：`Character.isJavaIdentifierPart`。
 *  上游用的是 JDK 分类：字母(含 Nl)、数字(Nd)、组合记号(Mc/Mn)、货币符号(Sc)、
 *  连接标点(Pc)、格式字符(Cf)，外加「可忽略控制符」U+0000-U+0008 / U+000E-U+001B / U+007F-U+009F。 */
const IDENTIFIER_PART =
  /^(?:[\p{L}\p{Nl}\p{Nd}\p{Mc}\p{Mn}\p{Sc}\p{Pc}\p{Cf}]|[\u0000-\u0008\u000E-\u001B\u007F-\u009F])$/u

/** `EditorActionUtil.java:930,931,981`：`Character.isWhitespace`。
 *  上游含 Zs/Zl/Zp 三类，但**排除**三个不断行空格（U+00A0 / U+2007 / U+202F），
 *  另外把 \t \n \u000B \f \r 与 U+001C-U+001F 也算空白。 */
const WHITESPACE =
  /^(?:[\p{Zs}\p{Zl}\p{Zp}]|[\t\n\u000B\f\r\u001C-\u001F])$/u
const NON_BREAKING_SPACES = '\u00A0\u2007\u202F'

/** `EditorActionUtil.java:970,973,976-978`：`Character.isLowerCase`。 */
const LOWERCASE = /^\p{Lowercase}$/u
/** `EditorActionUtil.java:970,973,976-978`：`Character.isUpperCase`。 */
const UPPERCASE = /^\p{Uppercase}$/u
/** `EditorActionUtil.java:976-978`：`Character.isDigit`。 */
const DIGIT = /^\p{Nd}$/u
/** `EditorActionUtil.java:972`：`Character.isLetterOrDigit`。 */
const LETTER_OR_DIGIT = /^[\p{L}\p{Nd}]$/u

export function isIdentifierPart(char: string): boolean { return IDENTIFIER_PART.test(char) }
export function isWhitespaceChar(char: string): boolean {
  return !NON_BREAKING_SPACES.includes(char) && WHITESPACE.test(char)
}
export function isLowerCaseChar(char: string): boolean { return LOWERCASE.test(char) }
export function isUpperCaseChar(char: string): boolean { return UPPERCASE.test(char) }
export function isDigitChar(char: string): boolean { return DIGIT.test(char) }
export function isLetterOrDigitChar(char: string): boolean { return LETTER_OR_DIGIT.test(char) }

/** `EditorActionUtil.java:980-982`：`isPunctuation(c) = !(isJavaIdentifierPart(c) || isWhitespace(c))`。
 *  注意 NUL(U+0000) 是标识符字符 ⇒ 不是标点，这是 `isWordBoundary` 里用 0 当哨兵的前提。 */
export function isPunctuation(char: string): boolean {
  return !(isIdentifierPart(char) || isWhitespaceChar(char))
}

/** 上游 `text.charAt(i)`：越界返回 0（`EditorActionUtil.java:945-946,965`），JS 里用 NUL 顶。 */
function charAt(text: string, index: number): string {
  return index >= 0 && index < text.length ? text[index]! : '\u0000'
}

// ─────────────────────────── 词边界判定 ───────────────────────────

/** `EditorActionUtil.java:928-932`：`isBetweenWhitespaces`。 */
export function isBetweenWhitespaces(text: string, offset: number): boolean {
  return offset > 0 && offset < text.length
    && isWhitespaceChar(text[offset - 1]!)
    && isWhitespaceChar(text[offset]!)
}

/** `EditorActionUtil.java:976-978`：`isLowerCaseOrDigit`。 */
function isLowerCaseOrDigit(char: string): boolean {
  return isLowerCaseChar(char) || isDigitChar(char)
}

/** `EditorActionUtil.java:960-974`：`isHumpBound` —— 偏移处是否落在一个驼峰切口上。
 *  前两条与末条只看 prev/curr/next（与 isStart 无关），中间两条才用到 hump/neighbor。 */
export function isHumpBound(text: string, offset: number, isStart: boolean): boolean {
  if (offset <= 0 || offset >= text.length) return false
  const prev = charAt(text, offset - 1)
  const curr = charAt(text, offset)
  const next = charAt(text, offset + 1)
  const hump = isStart ? curr : prev
  const neighbor = isStart ? prev : curr
  return (isLowerCaseOrDigit(prev) && isUpperCaseChar(curr))
    || (neighbor === '_' && hump !== '_')
    || (neighbor === '$' && isLetterOrDigitChar(hump))
    || (isUpperCaseChar(prev) && isUpperCaseChar(curr) && isLowerCaseChar(next))
}

/** `EditorActionUtil.java:942-958`：`isWordBoundary`。
 *  `isStart=true` 取右字符为 word、左字符为 neighbor；`isStart=false` 反之。 */
export function isWordBoundary(text: string, offset: number, isCamel: boolean, isStart: boolean): boolean {
  if (offset < 0 || offset > text.length) return false
  const prev = charAt(text, offset - 1)
  const curr = charAt(text, offset)
  const word = isStart ? curr : prev
  const neighbor = isStart ? prev : curr
  if (isIdentifierPart(word)) {
    if (!isIdentifierPart(neighbor)) return true
    if (isCamel && isHumpBound(text, offset, isStart)) return true
  }
  if (isPunctuation(word) && !isPunctuation(neighbor)) return true
  return false
}

/** `EditorActionUtil.java:934-936`：`isWordStart` = `isWordBoundary(..., isStart=true)`。 */
export function isWordStart(text: string, offset: number, isCamel: boolean): boolean {
  return isWordBoundary(text, offset, isCamel, true)
}

/** `EditorActionUtil.java:938-940`：`isWordEnd` = `isWordBoundary(..., isStart=false)`。 */
export function isWordEnd(text: string, offset: number, isCamel: boolean): boolean {
  return isWordBoundary(text, offset, isCamel, false)
}

// ─────────────────────────── 停点档位（CaretStopPolicy）───────────────────────────

/** `CaretStopOptions.kt:9-18`：`CaretStop`（start/end 两个布尔）。 */
export interface CaretStop { atStart: boolean; atEnd: boolean }

/** `CaretStopOptions.kt:13-16` 的四个常量。 */
export const CARET_STOP: { NONE: CaretStop; START: CaretStop; END: CaretStop; BOTH: CaretStop } = {
  NONE: { atStart: false, atEnd: false },
  START: { atStart: true, atEnd: false },
  END: { atStart: false, atEnd: true },
  BOTH: { atStart: true, atEnd: true },
}

/** `CaretStopOptions.kt:21-22`：`CaretStopPolicy`（词档 + 行档）。 */
export interface CaretStopPolicy { wordStop: CaretStop; lineStop: CaretStop }

/** `CaretStopOptions.kt:24-27` 的四个策略常量。 */
export const CARET_STOP_POLICY: {
  NONE: CaretStopPolicy; WORD_START: CaretStopPolicy; WORD_END: CaretStopPolicy; BOTH: CaretStopPolicy
} = {
  NONE: { wordStop: CARET_STOP.NONE, lineStop: CARET_STOP.NONE },
  WORD_START: { wordStop: CARET_STOP.START, lineStop: CARET_STOP.BOTH },
  WORD_END: { wordStop: CARET_STOP.END, lineStop: CARET_STOP.BOTH },
  BOTH: { wordStop: CARET_STOP.BOTH, lineStop: CARET_STOP.BOTH },
}

/** `CaretStopOptions.kt:71-78`：上游三种平台默认。
 *  `DEFAULT_UNIX` 的行档是 NONE ⇒ 词扫描边界退化成 [0, text.length]，正是本文件四个
 *  `next…`/`prev…Word…` 用的「整篇文本 + 一个偏移」模型；`DEFAULT` 的行档是 NEIGHBOR（反序列化回退）。 */
export const DEFAULT_WORD_BOUNDARY = {
  /** `CaretStopOptions.kt:71-72` `DEFAULT_WINDOWS`：wordBoundary = START。 */
  WINDOWS: { backward: CARET_STOP.START, forward: CARET_STOP.START },
  /** `CaretStopOptions.kt:74-75` `DEFAULT_UNIX`：wordBoundary = CURRENT(backward START / forward END)。 */
  UNIX: { backward: CARET_STOP.START, forward: CARET_STOP.END },
  /** `CaretStopOptions.kt:77-78` `DEFAULT`：wordBoundary = CURRENT。 */
  DEFAULT: { backward: CARET_STOP.START, forward: CARET_STOP.END },
}

// ─────────────────────────── 停点判定 + 扫描 ───────────────────────────

/** 上游按偏移计算 `isLexemeBoundary`（`EditorActionUtil.java:421-430` 走高亮 token）；
 *  本文件无 token 迭代器，默认恒 false，允许注入以便复刻词法边界。 */
export type LexemeBoundaryAt = (offset: number) => boolean

const NO_LEXEME_BOUNDARY: LexemeBoundaryAt = () => false

/** `EditorActionUtil.java:271-281`：`isWordStopOffset`。
 *  BOTH 档取「词法边界 或 词首 或 词尾」；START 档取「(词法边界 且 非词尾) 或 词首」；
 *  END 档取「(词法边界 且 非词首) 或 词尾」；NONE 档永不为停点。 */
export function isWordStopOffset(
  text: string, wordStop: CaretStop, offset: number, isCamel: boolean, isLexemeBoundary = false,
): boolean {
  const atStart = isWordStart(text, offset, isCamel)
  const atEnd = isWordEnd(text, offset, isCamel)
  if (wordStop.atStart && wordStop.atEnd) return isLexemeBoundary || atStart || atEnd
  if (wordStop.atStart) return (isLexemeBoundary && !atEnd) || atStart
  if (wordStop.atEnd) return (isLexemeBoundary && !atStart) || atEnd
  return false
}

/** `EditorActionUtil.java:249-258`：`getNextWordStopOffset`。
 *  从 `offset+1` 起向 `maxOffset` 扫描，命中即停；扫不到返回 `maxOffset`。
 *  上游调用方先判 `offset == maxOffset` 就直接返回（`:198-199`），这里同样先挡。 */
export function nextWordStopOffset(
  text: string, wordStop: CaretStop, offset: number, maxOffset: number,
  isCamel: boolean, isLexemeBoundaryAt: LexemeBoundaryAt = NO_LEXEME_BOUNDARY,
): number {
  if (offset >= maxOffset) return maxOffset
  let at = offset + 1
  for (; at < maxOffset; at++) {
    if (isWordStopOffset(text, wordStop, at, isCamel, isLexemeBoundaryAt(at))) break
  }
  return at
}

/** `EditorActionUtil.java:260-269`：`getPreviousWordStopOffset`。
 *  从 `offset-1` 起向 `minOffset` 扫描，命中即停；扫不到返回 `minOffset`。 */
export function prevWordStopOffset(
  text: string, wordStop: CaretStop, offset: number, minOffset: number,
  isCamel: boolean, isLexemeBoundaryAt: LexemeBoundaryAt = NO_LEXEME_BOUNDARY,
): number {
  if (offset <= minOffset) return minOffset
  let at = offset - 1
  for (; at > minOffset; at--) {
    if (isWordStopOffset(text, wordStop, at, isCamel, isLexemeBoundaryAt(at))) break
  }
  return at
}

// ─────────────────────────── 四个对外停点 ───────────────────────────
//
// 上游 `getRangeToWordEnd`(`:166-171`) / `getRangeToWordStart`(`:173-177`) 取的是
// `getNextCaretStopOffset(policy=BOTH)` / `getPreviousCaretStopOffset(policy=WORD_START)`。
// 本文件把「下一个词起点 / 上一个词起点 / 下一个词终点 / 上一个词终点」四件事单独拆出，
// 用 `DEFAULT_UNIX` 的行档（NONE）⇒ 扫描边界为整篇文本 [0, text.length]。

/** 下一个词起点：`wordStop = START`，向前扫到文本末尾。 */
export function nextWordStart(text: string, offset: number, isCamel = false): number {
  return nextWordStopOffset(text, CARET_STOP.START, offset, text.length, isCamel)
}

/** 上一个词起点：`wordStop = START`，向后扫到文本开头。 */
export function prevWordStart(text: string, offset: number, isCamel = false): number {
  return prevWordStopOffset(text, CARET_STOP.START, offset, 0, isCamel)
}

/** 下一个词终点：`wordStop = END`，向前扫到文本末尾。 */
export function nextWordEnd(text: string, offset: number, isCamel = false): number {
  return nextWordStopOffset(text, CARET_STOP.END, offset, text.length, isCamel)
}

/** 上一个词终点：`wordStop = END`，向后扫到文本开头。 */
export function prevWordEnd(text: string, offset: number, isCamel = false): number {
  return prevWordStopOffset(text, CARET_STOP.END, offset, 0, isCamel)
}

// ─────────────────────────── 带行档的完整停点（上游真正的入口）───────────────────────────
//
// `moveCaretToNextWord`(`:670-673`) 走 `moveToNextCaretStop(forwardPolicy)`
// (`:676-714`) → `getNextCaretStopOffset`(`:191-217`)；上一个词对称走 `:764-809`。
// 行档决定词扫描的边界（`getNextLineStopOffset` `:363-378` / `getPreviousLineStopOffset` `:391-406`）。
// 本文件按 `\n` 分行；CRLF 的 `\r` 归入分隔符（`getLineEndOffset` 不含行分隔符）。

/** 行数 = `\n` 个数 + 1（末行可为空，与 Document 一致）。 */
function lineCountOf(text: string): number {
  let count = 1
  for (let i = 0; i < text.length; i++) if (text[i] === '\n') count++
  return count
}

/** `offset` 所在行号 = 之前的 `\n` 个数。 */
function lineNumberOf(text: string, offset: number): number {
  let line = 0
  const end = Math.min(offset, text.length)
  for (let i = 0; i < end; i++) if (text[i] === '\n') line++
  return line
}

/** 第 `line` 行起点（该行第一个字符的偏移）。 */
function lineStartOffset(text: string, line: number): number {
  if (line <= 0) return 0
  let seen = 0
  for (let i = 0; i < text.length; i++) {
    if (text[i] === '\n') {
      seen++
      if (seen === line) return i + 1
    }
  }
  return text.length
}

/** 第 `line` 行终点（不含行分隔符；CRLF 时不含 `\r`）。 */
function lineEndOffset(text: string, line: number): number {
  let seen = 0
  for (let i = 0; i < text.length; i++) {
    if (text[i] === '\n') {
      if (seen === line) return i > 0 && text[i - 1] === '\r' ? i - 1 : i
      seen++
    }
  }
  return text.length
}

/** `EditorActionUtil.java:363-378`：`getNextLineStopOffset`（行档决定向前扫描的上界）。 */
function nextLineStopOffset(text: string, lineStop: CaretStop, lineNumber: number, isAtLineEnd: boolean): number {
  if (lineNumber + 1 >= lineCountOf(text)) return text.length
  if (!isAtLineEnd) {
    if (lineStop.atEnd) return lineEndOffset(text, lineNumber)
    if (lineStop.atStart) return lineStartOffset(text, lineNumber + 1)
    return text.length
  }
  if (lineStop.atStart) return lineStartOffset(text, lineNumber + 1)
  if (lineStop.atEnd) return lineEndOffset(text, lineNumber + 1)
  return text.length
}

/** `EditorActionUtil.java:391-406`：`getPreviousLineStopOffset`（行档决定向后扫描的下界）。 */
function prevLineStopOffset(text: string, lineStop: CaretStop, lineNumber: number, isAtLineStart: boolean): number {
  if (lineNumber - 1 < 0) return 0
  if (!isAtLineStart) {
    if (lineStop.atStart) return lineStartOffset(text, lineNumber)
    if (lineStop.atEnd) return lineEndOffset(text, lineNumber - 1)
    return 0
  }
  if (lineStop.atEnd) return lineEndOffset(text, lineNumber - 1)
  if (lineStop.atStart) return lineStartOffset(text, lineNumber - 1)
  return 0
}

/** `EditorActionUtil.java:191-217`：`getNextCaretStopOffset`（去掉 handleQuoted 特例，见文件头）。 */
export function nextCaretStopOffset(
  text: string, policy: CaretStopPolicy, offset: number, isCamel: boolean,
  isLexemeBoundaryAt: LexemeBoundaryAt = NO_LEXEME_BOUNDARY,
): number {
  const line = lineNumberOf(text, offset)
  const maxOffset = nextLineStopOffset(text, policy.lineStop, line, offset === lineEndOffset(text, line))
  if (!policy.wordStop.atStart && !policy.wordStop.atEnd) return maxOffset
  if (offset === maxOffset) return maxOffset
  return nextWordStopOffset(text, policy.wordStop, offset, maxOffset, isCamel, isLexemeBoundaryAt)
}

/** `EditorActionUtil.java:221-247`：`getPreviousCaretStopOffset`（去掉 handleQuoted 特例）。 */
export function prevCaretStopOffset(
  text: string, policy: CaretStopPolicy, offset: number, isCamel: boolean,
  isLexemeBoundaryAt: LexemeBoundaryAt = NO_LEXEME_BOUNDARY,
): number {
  const line = lineNumberOf(text, offset)
  const minOffset = prevLineStopOffset(text, policy.lineStop, line, offset === lineStartOffset(text, line))
  if (!policy.wordStop.atStart && !policy.wordStop.atEnd) return minOffset
  if (offset === minOffset) return minOffset
  return prevWordStopOffset(text, policy.wordStop, offset, minOffset, isCamel, isLexemeBoundaryAt)
}

// ─────────────────────────── 与 completionCamelHump.ts 的关系 ───────────────────────────
//
// 本仓 `src/completionCamelHump.ts` 里已有一份 `isWordStart` / `nextWord`，来源是
// **补全匹配器** `NameUtilCore.kt:95-117` / `:53-92`，与上游 `EditorActionUtil.isWordStart`
// (`:934-936`) 不是同一套：
//   · `completionCamelHump.isWordStart`：**字符自身的性质**（大写是词首、数字是词首、
//     小写只在串首或前一个非字母数字时是词首）—— 不涉及「相邻两字符的分类差」；
//   · 本文件的 `isWordStart`：**两个字符之间的边界**（右字符是标识符字符、左字符不是，
//     或驼峰切口，或标点与非标点之间）—— 判据里带 `neighbor`，还带标点分支。
// 例：`getName` 偏移 3，两者都 true；但 `abc` 偏移 1，`NameUtilCore` 的判据看的是
// 「小写在字母中间」⇒ false，而本文件的判据看的是「左右都是标识符字符、无驼峰切口」⇒ false，
// 结论相同但**理由不同**；`a.b` 偏移 2：前者 true（前一个不是字母数字），后者也 true（标点后）。
// 反例：`a b` 偏移 2（'b'），本文件 true；`NameUtilCore.isWordStart('a b',2)` 也 true。
// 真正分道的是标点串内部：`--x` 偏移 1，本文件对第二个 '-' 判 false（左也是标点），
// 而 `NameUtilCore.isWordStart` 对非字母数字一律 false —— 同样巧合一致，但 `:955`
// 的「标点与非标点交界」分支是补全匹配器**根本没有**的规则。故**不复用** `completionCamelHump.ts`。

export {}