// 实时模板的**宏**（live template macros）—— 上游 `com.intellij.codeInsight.template.Macro` 那一族，
// 「一处表吃一族」的那张表。本模块只有三段：注册表、表达式解析、求值；**没有第四段**
// （模板文本的词法仍是 `src/templates.ts` 的既有契约，本模块不另造一套模板语言）。
//
// 逐条对照的源码（`D:\Backup\Downloads\intellij-community-master\intellij-community-master`）：
//   · 契约 `platform/analysis-api/src/com/intellij/codeInsight/template/Macro.java`
//       - `:18` 注册点 = 扩展点 `com.intellij.liveTemplateMacro`
//       - `:20` `getName()`、`:26-28` `getPresentableName()` = 名字 + `()`（有参数的宏自己覆写）
//       - `:30-32` `getDefaultValue()` = `""`、`:34` `calculateResult(params, context)`、
//         `:40` `calculateLookupItems`、`:44` `isAcceptableInContext`
//   · **那张表** `platform/lang-impl/resources/intellij.platform.lang.impl.xml:1031-1063`
//       —— 33 条 `<liveTemplateMacro implementation=…/>`；查表侧 `MacroService.java:38-51`
//       （按 `getName()` 建 MultiMap）与 `MacroFactory.java:13-24`（`createMacro(name)`/`getMacros(name)`），
//       这两个文件在 `platform/analysis-impl/src/com/intellij/codeInsight/template/macro/`，
//       上面那 33 条实现类在 `platform/lang-impl/src/com/intellij/codeInsight/template/macro/`。
//       留痕：派单给的坐标 `platform/lang-impl/src/com/intellij/codeInsight/template/impl/Macros.java`
//       **在本仓的基准树里不存在**（那个目录只有 `EditVariableDialog.java` 等界面件，见上一行）；
//       宏族的真身就是上面那个 `template/macro/` 包，本模块按它对齐。
//       门禁 `tests/template-macro-registry.test.mjs` 拿这 33 行对账（实现侧 + 登记侧 = 33，多一条红、少一条也红）；
//       行为侧的判据在 `tests/template-macros.test.mjs`。
//   · 表达式语法 `platform/analysis-impl/src/com/intellij/codeInsight/template/impl/MacroParser.java`
//       - `:23-31` 空串 → ConstantNode("")；`:53-89` 主流程：字符串字面量 / 标识符；
//         **标识符先查宏表，查不到就按变量处理**（`:67-70`）；
//       - `:74-80` 标识符后面**没有** `(` 就是零参宏调用；`:82-88` 有就接着吃参数，
//         右括号缺失**只记日志不报错**（`:84-86`），已吃到的参数照用 —— 这就是「参数解析失败」的既定行为；
//       - `:91-111` 字符串字面量：`\n \t \f` 转义、其它 `\X` 退化成 `X`、整串长度不足 2 → 空串；
//       - `:113-127` 参数逗号分隔；`:129-148` 变量：`NAME`、`NAME=初值`；**独立成串的 `END`**
//         才是 EmptyNode（`:133-138`），`END` 出现在参数里仍是变量（`:141-143`）。
//     词法 `platform/analysis-impl/src/com/intellij/codeInsight/template/impl/_MacroLexer.flex:22-36`：
//       IDENTIFIER = `[:jletter:][:jletterdigit:]*`（**`$` 也算字母**、数字不能开头）、
//       STRING_LITERAL 允许**不闭合**（`(\"|\\)?`）、其它单字符 = BAD_CHARACTER。
//     判据来源 `java/java-tests/testSrc/com/intellij/java/codeInsight/template/MacroParserTest.java:18-71`
//       （空串、带空格的实参、`E="t"`、`END`、多实参、`\x` 退化、未闭合的 `"` → 空串）。
//   · 求值侧 `platform/analysis-impl/src/com/intellij/codeInsight/template/impl/`
//       - `TemplateStateBase.java:72-97` `getVariableValue`：`SELECTION` → 选区、`END` → 空串、
//         **预定义变量表先查**（`:79-84`），否则读该变量在文档里那一段的**当前文本**（`:85-96`）
//         —— 「不重算已算出的量」的原始形态；
//       - `TemplateState.java:637-680` `calcResults`：一轮里逐个变量重算，**只要有一段变了就再来一轮**，
//         轮数上限 `maxAttempts = (变量数 + 1) * 3`（`:660`）—— 宏互相引用/自引用靠这个封顶，不靠递归检测；
//       - `TemplateState.java:763-803` `recalcSegment`：表达式结果为 null 或空 → 用默认值表达式
//         （`:795-797`）；两者都没有 → 保留原有文本（`:801`）；
//       - `TemplateState.java:1122-1149` `initEmptyVariables`：收尾时**空**的段落写入 marker，
//         marker = 该宏的 `getDefaultValue()`（`:1137-1141`），不是宏调用就写 `"a"`（`:1137`）。
//     实参进宏之前就已经是字符串了（`MacroBase.java:51-67` `getTextResult`：`params.length` 不是 1 直接
//     null；是 1 就取该实参的 `toString()`），所以本模块的宏签名收的是 `readonly (string | null)[]`，
//     嵌套宏由解析器自底向上先算完。
//
// 宏调用写在哪一段（**为什么不重定义既有契约**）：
//   上游模板文本的词法只有 `$NAME$`（`TemplateTextLexer.flex:21-28`），表达式与默认值是变量表的**两列**
//   （`TemplateSettings.java:732-734` 的 `expression`/`defaultValue`/`alwaysStopAt`；`Variable.java:83-88`
//   把默认值字符串也丢给同一个 MacroParser）。本仓早就把两列压成一段 `$NAME:默认值$`
//   （`src/templates.ts` 的 `render()`，既有单测钉着 `$LIMIT:10$` → `10`、`$TYPE:Exception$` → `Exception`）。
//   所以本批只在那一段里**认出宏调用**：首 token 是已注册宏名才算表达式（与上游
//   `MacroParser.java:67` 的判据同一条 —— 查表命中才当宏），其余一律照旧当字面量默认值。
//   代价是 `$NAME:date$` 这种「字面量恰好等于宏名」会被当零参宏（上游也是这么认的），已写进单测。
//
// 消费链路（规约 §3：没有消费方就不渲染）：
//   · `src/templates.ts` 的 `render()` —— 唯一求值方（`expand()` 把展开点的文件路径当 context 传进来）；
//   · `src/components/TemplateSettingsPage.vue` —— 只渲染本表里的宏（`LIVE_TEMPLATE_MACROS`），
//     并用 `templateMacroOfExpression()` 拆「表达式 / 默认值」、用 `unknownMacroCall()` 警告没注册的名字；
//   · 单测 `tests/template-macros.test.mjs`（行为）+ 门禁 `tests/template-macro-registry.test.mjs`（对账 + 消费锚点）。
//
// 上游 33 条里本模块只装**有求值原料的 21 条**；另外 12 条登记在 `DEFERRED_TEMPLATE_MACROS` 里
// 并写明为什么接不上 —— 那份清单的消费方是上面那条门禁（逐条要求有具体理由、且宏表里查不到这个名字），
// 设置页**不渲染**它们。缺的挂点写在 `docs/wiring-requests-2026-10-06-fix-macros.md`。

import { fileNameStem } from './fileTemplateVars.ts'

/** 一次展开可供宏读取的环境 —— 字段都是展开点已经拿得到的东西。 */
export interface TemplateMacroContext {
  /** 被展开文件的路径。上游是 `context.getPsiFile().getVirtualFile()`（`FilePathMacroBase.java:24-31`）。 */
  readonly path: string
  /** 时间源（上游 `Clock.getTime()`，`CurrentDateMacro.java:28`）；缺省 = 当下，测试注入固定值。 */
  readonly now?: () => Date
}

/** 进宏之前实参已算成字符串；`null` = 这一格什么都没算出来（上游 `result == null`）。 */
export type MacroParameters = readonly (string | null)[]

export interface TemplateMacro {
  readonly name: string
  /** 上游 `getPresentableName()`：`EditVariableDialog` 表达式列下拉里的文案（`Macro.java:26-28`）。 */
  readonly presentableName: string
  /** 上游 `getDefaultValue()`：结果为空时写进槽位的 marker（`TemplateState.java:1137-1141`）。 */
  readonly defaultValue: string
  /** 上游实现类名（含嵌套类的 `$`）；门禁用它对账 XML 里那 33 条注册。 */
  readonly upstream: string
  calculate: (parameters: MacroParameters, context: TemplateMacroContext) => string | null
}

/** 装不进表的上游宏：`reason` 必须具体（规约 §3、§6）。 */
export interface DeferredTemplateMacro {
  readonly name: string
  readonly upstream: string
  readonly reason: string
}

// ---------------------------------------------------------------------------
// StringUtil / NameUtilCore / NameUtil 的等价件（纯文本，零 PSI）
// ---------------------------------------------------------------------------

/** `Strings.toLowerCase`（`StringUtil.java:262-264` 转发）：Locale.ROOT 档 ⇒ JS 的 toLowerCase 与区域无关。 */
const lowerCase = (text: string): string => text.toLowerCase()
const upperCase = (text: string): string => text.toUpperCase()
/** `Strings.capitalize`：首字符大写、其余原样（`ConvertToCamelCaseMacro.java:49` 用的就是它）。 */
const capitalizeWord = (text: string): string => (text ? upperCase(text[0]!) + text.slice(1) : text)
const isDigitUnit = (char: string): boolean => /\p{N}/u.test(char)
const isUpperUnit = (char: string): boolean => /\p{Lu}/u.test(char)
const isLowerUnit = (char: string): boolean => /\p{Ll}/u.test(char)
const isLetterOrDigitUnit = (char: string): boolean => /\p{L}|\p{N}/u.test(char)

/**
 * `NameUtilCore.kt:143-183` 的 `nameToWordList`：数字段 / 连续大写段 / 小写段 / 其它符号段各自成词，
 * 空白词丢弃。`camelCase`、`snakeCase`、`lowercaseAndDash`、`spaceSeparated`、`capitalizeAndUnderscore`
 * 全建在这一个分词上（`SplitWordsMacro.java:34`、`ConvertToCamelCaseMacro.java:56`）。
 */
export function nameToWordList(name: string): string[] {
  const words: string[] = []
  let index = 0
  while (index < name.length) {
    const wordStart = index
    let upperCaseCount = 0
    let lowerCaseCount = 0
    let digitCount = 0
    let specialCount = 0
    while (index < name.length) {
      const char = name[index]!
      if (isDigitUnit(char)) {
        if (upperCaseCount > 0 || lowerCaseCount > 0 || specialCount > 0) break
        digitCount++
      } else if (isUpperUnit(char)) {
        if (lowerCaseCount > 0 || digitCount > 0 || specialCount > 0) break
        upperCaseCount++
      } else if (isLowerUnit(char)) {
        if (digitCount > 0 || specialCount > 0) break
        if (upperCaseCount > 1) { index--; break }
        lowerCaseCount++
      } else {
        if (upperCaseCount > 0 || lowerCaseCount > 0 || digitCount > 0) break
        specialCount++
      }
      index++
    }
    const word = name.slice(wordStart, index)
    if (word.trim() !== '') words.push(word)
  }
  return words
}

/** `NameUtil.java:385-403` 的 `splitWords`：非字母数字开头的段只留下分隔符，不产出词。 */
function joinWords(text: string, separator: string, transformWord: (word: string) => string): string {
  let buffer = ''
  let insertSeparator = false
  for (const word of nameToWordList(text)) {
    if (!isLetterOrDigitUnit(word[0]!)) {
      buffer += separator
      insertSeparator = false
      continue
    }
    if (insertSeparator) buffer += separator
    else insertSeparator = true
    buffer += transformWord(word)
  }
  return buffer
}

/**
 * `StringUtil.java:549-618` 的 `escapeStringCharacters`（`additionalChars` = `"`、
 * `escapeSlash` 与 `escapeUnicode` 都开着的单参重载，`:614-618`）。
 * 不可打印 = `Character.getType` 的 UNASSIGNED/CONTROL/FORMAT/PRIVATE_USE/SURROGATE 加
 * LINE/PARAGRAPH_SEPARATOR（`:605-611`），这里用等价的 Unicode 类别集合表达。
 * 逐**码元**处理（与 Java 的 `charAt` 同口径，代理对的两半各自成 `\uDxxx`）。
 */
const NON_PRINTABLE = /[\p{Cc}\p{Cf}\p{Co}\p{Cs}\p{Cn}\p{Zl}\p{Zp}]/u
const ESCAPE_TABLE: Record<string, string> = { '\b': '\\b', '\t': '\\t', '\n': '\\n', '\f': '\\f', '\r': '\\r' }
// 不导出：外部没有消费方，行为由 `escapeString` 那条宏钉住（tests/template-macros.test.mjs）。
function escapeStringCharacters(text: string): string {
  let buffer = ''
  for (let index = 0; index < text.length; index++) {
    const char = text[index]!
    if (char in ESCAPE_TABLE) { buffer += ESCAPE_TABLE[char]; continue }
    if (char === '\\') { buffer += '\\\\'; continue }
    if (char === '"') { buffer += '\\"'; continue }
    if (NON_PRINTABLE.test(char)) {
      const hex = upperCase(char.charCodeAt(0).toString(16))
      buffer += '\\u' + '0'.repeat(Math.max(0, 4 - hex.length)) + hex
      continue
    }
    buffer += char
  }
  return buffer
}

/**
 * `CurrentDateMacro.java:27-42` 的 `formatUserDefined`（`time` 走同一份，`CurrentTimeMacro.java:15-17`）。
 * 无参数那一条上游是 `DateFormatUtil.formatDate/formatTime`，而它读的是**区域设置**
 * （`DateFormatUtil.java:103-109` → `formats().date()`）；本仓没有区域设置页，于是沿用本仓已经钉死的
 * 同一档（`src/fileTemplateVars.ts:112-113`：`yyyy/M/d`、`H:mm`），并在这里写明那是**本仓档**不是上游档。
 * 带参数 = `SimpleDateFormat(pattern)`；本仓实现常用字母子集，认不出的字母走上游那条异常文案
 * （`CurrentDateMacro.java:36-38`），不静默产出错日期。
 */
const UNSUPPORTED_PATTERN_LETTER = /[GzZDSweku]/

function formatDateTimePattern(pattern: string, date: Date): string {
  if (UNSUPPORTED_PATTERN_LETTER.test(pattern)) {
    return `Problem when formatting date/time for pattern "${pattern}": Unsupported pattern letter`
  }
  const pad = (value: number, width: number): string => String(Math.abs(value)).padStart(width, '0')
  const year = date.getFullYear()
  const month = date.getMonth() + 1
  const hours24 = date.getHours()
  const hours12 = hours24 % 12 === 0 ? 12 : hours24 % 12
  const monthShort = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
  const monthFull = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']
  const dayShort = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
  const dayFull = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']
  const emit = (value: string, width: number): string => (value.length >= width ? value : value.padStart(width, '0'))
  let output = ''
  let index = 0
  while (index < pattern.length) {
    const char = pattern[index]!
    if (char === "'") {
      // SimpleDateFormat 的引号档：`''` = 一个引号，`'...'` = 原文；不成对的引号被吞掉。
      if (pattern[index + 1] === "'") { output += "'"; index += 2; continue }
      const close = pattern.indexOf("'", index + 1)
      if (close < 0) { index++; continue }
      output += pattern.slice(index + 1, close)
      index = close + 1
      continue
    }
    let run = 0
    while (index + run < pattern.length && pattern[index + run] === char) run++
    switch (char) {
      case 'y': output += run <= 2 ? pad(year % 100, run) : pad(year, run); break
      case 'M': output += run <= 2 ? emit(String(month), run) : run === 3 ? monthShort[month - 1]! : monthFull[month - 1]!; break
      case 'd': output += emit(String(date.getDate()), run); break
      case 'H': output += emit(String(hours24), run); break
      case 'h': output += emit(String(hours12), run); break
      case 'm': output += emit(String(date.getMinutes()), run); break
      case 's': output += emit(String(date.getSeconds()), run); break
      case 'E': output += run <= 3 ? dayShort[date.getDay()]! : dayFull[date.getDay()]!; break
      case 'a': output += hours24 < 12 ? 'AM' : 'PM'; break
      default: output += char.repeat(run); break
    }
    index += run
  }
  return output
}

// ---------------------------------------------------------------------------
// 表达式解析（MacroParser 的移植）
// ---------------------------------------------------------------------------

/** `_MacroLexer.flex:22-36` 的六种 token（BAD_CHARACTER 也留着，解析侧照上游那样当「不是标识符」处理）。 */
type ExpressionTokenKind = 'identifier' | 'string' | 'lparen' | 'rparen' | 'comma' | 'eq' | 'bad'
interface ExpressionToken { kind: ExpressionTokenKind; text: string }

const IDENTIFIER_START = /[\p{L}_$]/u
const IDENTIFIER_PART = /[\p{L}\p{N}_$]/u
const STRING_LITERAL = /"(?:[^"\\\r\n]|\\[^\r\n])*(?:"|\\)?/y
const WHITESPACE = /[ \n\r\t\f]/

// 不导出：只有 parseTemplateExpression 与「这段是不是宏调用」那两个判据用它（词法本身由解析用例钉住）。
function tokenizeTemplateExpression(source: string): ExpressionToken[] {
  const tokens: ExpressionToken[] = []
  let index = 0
  const bracket: Record<string, ExpressionTokenKind> = { '(': 'lparen', ')': 'rparen', ',': 'comma', '=': 'eq' }
  while (index < source.length) {
    const char = source[index]!
    if (WHITESPACE.test(char)) { index++; continue }
    if (char === '"') {
      STRING_LITERAL.lastIndex = index
      const match = STRING_LITERAL.exec(source)
      if (match && match[0].length) { tokens.push({ kind: 'string', text: match[0] }); index = STRING_LITERAL.lastIndex; continue }
    }
    if (IDENTIFIER_START.test(char)) {
      let end = index + 1
      while (end < source.length && IDENTIFIER_PART.test(source[end]!)) end++
      tokens.push({ kind: 'identifier', text: source.slice(index, end) })
      index = end
      continue
    }
    tokens.push({ kind: bracket[char] ?? 'bad', text: char })
    index++
  }
  return tokens
}

/** 表达式树；与上游的四种 `Expression` 子类一一对应（ConstantNode / EmptyNode / VariableNode / MacroCallNode）。 */
export type TemplateExpressionNode =
  | { kind: 'constant'; text: string }
  | { kind: 'end' }
  | { kind: 'variable'; name: string; initial: TemplateExpressionNode | null }
  | { kind: 'macro'; name: string; parameters: TemplateExpressionNode[] }

/** `MacroParser.java:91-111`：剥掉首尾两字符（末字符是 `"` 或半个 `\` 都一样）、
 * `\n \t \f` 转义、其它 `\X` 退化成 `X`；整串长度不足 2 → 空串。 */
function parseStringLiteral(token: string): string {
  if (token.length < 2) return ''
  const body = token.slice(1, -1)
  let output = ''
  let index = 0
  while (index < body.length) {
    const char = body[index]!
    if (char === '\\') {
      index++
      const next = body[index]
      if (next === undefined) break
      output += next === 'n' ? '\n' : next === 't' ? '\t' : next === 'f' ? '\f' : next
      index++
      continue
    }
    output += char
    index++
  }
  return output
}

/**
 * 把一个宏表达式字符串解析成节点。上游同样**永不抛**：认不出的首 token 直接成空常量
 * （`MacroParser.java:61-65`，只记一条日志），右括号缺失也只是日志（`:84-86`）。
 */
export function parseTemplateExpression(source: string): TemplateExpressionNode {
  if (!source) return { kind: 'constant', text: '' }
  const tokens = tokenizeTemplateExpression(source)
  let at = 0
  const peek = (): ExpressionToken | undefined => tokens[at]
  const parseNode = (): TemplateExpressionNode => {
    const token = peek()
    if (!token) return { kind: 'constant', text: '' }
    if (token.kind === 'string') { at++; return { kind: 'constant', text: parseStringLiteral(token.text) } }
    if (token.kind !== 'identifier') { at++; return { kind: 'constant', text: '' } }
    at++
    if (!templateMacroByName(token.text)) return parseVariable(token.text)
    if (peek()?.kind !== 'lparen') return { kind: 'macro', name: token.text, parameters: [] }
    at++
    const parameters = parseParameters()
    if (peek()?.kind === 'rparen') at++
    return { kind: 'macro', name: token.text, parameters }
  }
  const parseVariable = (name: string): TemplateExpressionNode => {
    const next = peek()
    if (next && next.kind !== 'eq') return { kind: 'variable', name, initial: null }
    if (next) {
      at++
      return { kind: 'variable', name, initial: parseNode() }
    }
    // MacroParser.java:133-138 —— 只剩这一个标识符、且它就是 END 时才是 EmptyNode。
    if (name === 'END') return { kind: 'end' }
    return { kind: 'variable', name, initial: null }
  }
  const parseParameters = (): TemplateExpressionNode[] => {
    const list: TemplateExpressionNode[] = []
    while (peek() && peek()!.kind !== 'rparen') {
      list.push(parseNode())
      if (peek()?.kind === 'comma') { at++; continue }
      break
    }
    return list
  }
  return parseNode()
}

// ---------------------------------------------------------------------------
// 那张表
// ---------------------------------------------------------------------------

/** `MacroBase.getTextResult(params, context)`：只认**恰好一个**实参（`MacroBase.java:55-67`）。 */
const singleText = (parameters: MacroParameters): string | null => (parameters.length === 1 ? parameters[0] : null)

/** 时间类宏的公共体（`CurrentDateMacro.java:27-42`）。 */
const dateTimeMacro = (date: boolean) => (parameters: MacroParameters, context: TemplateMacroContext): string => {
  const time = (context.now ?? (() => new Date()))()
  if (parameters.length === 1 && parameters[0] !== null) return formatDateTimePattern(parameters[0], time)
  return date
    ? `${time.getFullYear()}/${time.getMonth() + 1}/${time.getDate()}`
    : `${time.getHours()}:${String(time.getMinutes()).padStart(2, '0')}`
}

/** `ConvertToCamelCaseMacro.java:40-53`（`underscoresToCamelCase` 只是换了分词，`:59-68`）。 */
const camelCaseOf = (words: readonly string[]): string => {
  let output = ''
  words.forEach((word, index) => {
    if (index === 0) { output += lowerCase(word); return }
    // 上游这里对**空段**会抛 StringIndexOutOfBoundsException（`text.split("_")` 会留下空串）；
    // 本仓把空段按「非字母数字」跳过，见报告的「做不到」清单。
    if (word && isLetterOrDigitUnit(word[0]!)) output += capitalizeWord(lowerCase(word))
  })
  return output
}

/** 文件路径类宏（`FilePathMacroBase.java:34-73`）。 */
const filePathMacro = (mode: 'name' | 'stem' | 'full') => (parameters: MacroParameters, context: TemplateMacroContext): string => {
  const path = context.path.replace(/\\/g, '/')
  if (mode === 'stem') return fileNameStem(path)
  if (mode === 'name') return path.split('/').pop() ?? ''
  // 上游 `:71` 走 FileUtil.toSystemDependentName；本仓内部路径一律 `/`（`src/fileTemplateVars.ts:101`
  // 的同一口径），这里不做平台改写。
  return path
}

export const LIVE_TEMPLATE_MACROS: readonly TemplateMacro[] = [
  { name: 'date', presentableName: 'date()', defaultValue: '11.11.1111', upstream: 'CurrentDateMacro',
    calculate: dateTimeMacro(true) },
  { name: 'time', presentableName: 'time()', defaultValue: '11.11.1111', upstream: 'CurrentTimeMacro',
    calculate: dateTimeMacro(false) },
  { name: 'capitalize', presentableName: 'capitalize(String)', defaultValue: 'a', upstream: 'CapitalizeMacro',
    calculate: parameters => { const text = singleText(parameters); if (text === null) return null
      return text ? upperCase(text[0]!) + text.slice(1) : '' } },
  { name: 'decapitalize', presentableName: 'decapitalize(String)', defaultValue: 'a', upstream: 'DecapitalizeMacro',
    // `DecapitalizeMacro.java:26` 与 capitalize 的**不对称**要保住：空串时上游返回 null。
    calculate: parameters => { const text = singleText(parameters); if (text === null || !text) return null
      return lowerCase(text[0]!) + text.slice(1) } },
  { name: 'firstWord', presentableName: 'firstWord(String)', defaultValue: 'a', upstream: 'FirstWordMacro',
    calculate: parameters => { const text = singleText(parameters); if (text === null) return null
      const index = text.indexOf(' '); return index >= 0 ? text.slice(0, index) : text } },
  { name: 'escapeString', presentableName: 'escapeString(String)', defaultValue: 'a', upstream: 'EscapeStringMacro',
    calculate: parameters => { const text = singleText(parameters); return text === null ? null : escapeStringCharacters(text) } },
  { name: 'underscoresToSpaces', presentableName: 'underscoresToSpaces(String)', defaultValue: 'a', upstream: 'ReplaceUnderscoresWithSpacesMacro',
    calculate: parameters => { const text = singleText(parameters); return text === null ? null : text.replaceAll('_', ' ') } },
  { name: 'spacesToUnderscores', presentableName: 'spacesToUnderscores(String)', defaultValue: 'a', upstream: 'ReplaceSpacesWithUnderscoresMacro',
    calculate: parameters => { const text = singleText(parameters); return text === null ? null : text.replaceAll(' ', '_') } },
  { name: 'fileName', presentableName: 'fileName()', defaultValue: '', upstream: 'FilePathMacroBase$FileNameMacro',
    calculate: filePathMacro('name') },
  { name: 'fileNameWithoutExtension', presentableName: 'fileNameWithoutExtension()', defaultValue: '',
    upstream: 'FilePathMacroBase$FileNameWithoutExtensionMacro', calculate: filePathMacro('stem') },
  { name: 'filePath', presentableName: 'filePath()', defaultValue: '', upstream: 'FilePathMacroBase$FilePathMacro',
    calculate: filePathMacro('full') },
  { name: 'underscoresToCamelCase', presentableName: 'underscoresToCamelCase(String)', defaultValue: 'a',
    upstream: 'ConvertToCamelCaseMacro$ReplaceUnderscoresToCamelCaseMacro',
    calculate: parameters => { const text = singleText(parameters); return text === null ? null : camelCaseOf(text.split('_')) } },
  { name: 'camelCase', presentableName: 'camelCase(String)', defaultValue: 'a', upstream: 'ConvertToCamelCaseMacro',
    calculate: parameters => { const text = singleText(parameters); return text === null ? null : camelCaseOf(nameToWordList(text)) } },
  { name: 'capitalizeAndUnderscore', presentableName: 'capitalizeAndUnderscore(String)', defaultValue: 'a',
    upstream: 'CapitalizeAndUnderscoreMacro',
    // `CapitalizeAndUnderscoreMacro.java:23-24`：空串 → TextResult("")，不是 null。
    calculate: parameters => { const text = singleText(parameters); if (text === null) return null
      return text ? joinWords(text, '_', upperCase) : '' } },
  { name: 'snakeCase', presentableName: 'snakeCase(String)', defaultValue: 'a', upstream: 'SplitWordsMacro$SnakeCaseMacro',
    calculate: parameters => { const text = singleText(parameters); if (text === null) return null
      return text ? joinWords(text, '_', lowerCase) : '' } },
  { name: 'lowercaseAndDash', presentableName: 'lowercaseAndDash(String)', defaultValue: 'a', upstream: 'SplitWordsMacro$LowercaseAndDash',
    calculate: parameters => { const text = singleText(parameters); if (text === null) return null
      return text ? joinWords(text, '-', lowerCase) : '' } },
  { name: 'spaceSeparated', presentableName: 'spaceSeparated(String)', defaultValue: 'a', upstream: 'SplitWordsMacro$SpaceSeparated',
    calculate: parameters => { const text = singleText(parameters); if (text === null) return null
      return text ? joinWords(text, ' ', word => word) : '' } },
  { name: 'concat', presentableName: 'concat(expressions...)', defaultValue: 'a', upstream: 'ConcatMacro',
    // `ConcatMacro.java:20-28`：null 的实参当空串跳过（`StringUtil.notNullize`），结果为空 → null。
    calculate: parameters => { let result = ''
      for (const value of parameters) result += value ?? ''
      return result || null } },
  { name: 'substringBefore', presentableName: 'substringBefore(String, Delimiter)', defaultValue: 'a', upstream: 'SubstringBeforeMacro',
    // `SubstringBeforeMacro.java:20-31`：恰好两个实参；分隔符**在 0 位**时返回空串（`indexOf > 0` 的原样口径）。
    calculate: parameters => { if (parameters.length !== 2) return null
      const [text, delimiter] = parameters
      if (text === null || delimiter === null) return null
      const index = text.indexOf(delimiter)
      return index > 0 ? text.slice(0, index) : '' } },
  { name: 'regularExpression', presentableName: 'regularExpression(String, Pattern, Replacement)', defaultValue: 'a',
    upstream: 'RegExMacro',
    // `RegExMacro.java:26-50`：三个实参、坏正则或组引用越界（`IndexOutOfBoundsException`，`:44-45`）
    // 都是「记一条 warn 然后返回 null」。
    calculate: parameters => { if (parameters.length !== 3) return null
      const [value, pattern, replacement] = parameters
      if (value === null || pattern === null || replacement === null) return null
      try {
        const expression = new RegExp(pattern, 'g')
        const groups = expression.source.match(/\((?!\?)/g)?.length ?? 0
        for (const reference of replacement.match(/\$\{?(\d+)\}?/g) ?? []) {
          if (Number(reference.replace(/\D/g, '')) > groups) return null
        }
        return value.replace(expression, replacement)
      } catch { return null } } },
  { name: 'enum', presentableName: 'enum(...)', defaultValue: '', upstream: 'EnumMacro',
    // `EnumMacro.java:42-45`：取**第一个**实参的结果；候选列表那条（`:54-65`）需要槽位上的 lookup，本仓还没有那条链路。
    calculate: parameters => (parameters.length === 0 ? null : parameters[0]) },
]

/** 上游注册了、本批**没有**装进表的宏；`reason` 就是报告的「做不到」清单内容。 */
export const DEFERRED_TEMPLATE_MACROS: readonly DeferredTemplateMacro[] = [
  { name: 'user', upstream: 'CurrentUserMacro', reason: '上游取 SystemProperties.getUserName()，本仓 Web 侧没有同步的 OS 用户名通道' },
  { name: 'clipboard', upstream: 'ClipboardMacro', reason: '上游同步读系统剪贴板；本仓剪贴板是异步通道（src/clipboard.ts 的 readClipboardText），同步求值路径上拿不到' },
  { name: 'lineNumber', upstream: 'LineNumberMacro', reason: '上游 offsetToLogicalPosition(展开点偏移)；模板展开处只把**行内**文本交给 render()' },
  { name: 'fileRelativePath', upstream: 'FilePathMacroBase$FileRelativePathMacro', reason: '上游要项目与源根（FqnUtil.getVirtualFileFqn）；expand() 只有文件路径' },
  { name: 'complete', upstream: 'CompleteMacro', reason: 'InvokeActionResult：要在编辑器里再拉起一次补全并等选中项（BaseCompleteMacro.java:65-90），展开点没有那个能力' },
  { name: 'completeSmart', upstream: 'CompleteSmartMacro', reason: '同 complete，且要智能补全档' },
  { name: 'showParameterInfo', upstream: 'ShowParameterInfoMacro', reason: '要先 finishTemplate 再拉起参数信息浮层（ShowParameterInfoMacro.java:36-43）' },
  { name: 'lineCommentStart', upstream: 'CommentMacro$LineCommentStart', reason: '注释标记表在 src/commentToggle.ts，该模块 value-import 了 @codemirror/state；拉进 templates.ts 的依赖图会破掉「模板规则不依赖 CodeMirror、可独立单测」的既有契约' },
  { name: 'blockCommentStart', upstream: 'CommentMacro$BlockCommentStart', reason: '同 lineCommentStart' },
  { name: 'blockCommentEnd', upstream: 'CommentMacro$BlockCommentEnd', reason: '同 lineCommentStart' },
  { name: 'commentStart', upstream: 'CommentMacro$AnyCommentStart', reason: '同 lineCommentStart' },
  { name: 'commentEnd', upstream: 'CommentMacro$AnyCommentEnd', reason: '同 lineCommentStart' },
]

const macroIndex = new Map<string, TemplateMacro>(LIVE_TEMPLATE_MACROS.map(macro => [macro.name, macro] as const))

/** 上游 `MacroFactory.createMacro(name)`（`MacroFactory.java:13-15`）：查不到就是 undefined。 */
export function templateMacroByName(name: string): TemplateMacro | undefined {
  return macroIndex.get(name)
}

/**
 * 「这段默认值到底是不是宏调用」—— 与上游同一判据（`MacroParser.java:67`：首 token 是**已注册宏名**才当宏）。
 * 其余一律照旧是字面量默认值，`$LIMIT:10$` / `$TYPE:Exception$` / `$TEXT:待补充$` 因此不受影响。
 */
export function isTemplateMacroExpression(text: string): boolean {
  const first = tokenizeTemplateExpression(text)[0]
  return Boolean(first && first.kind === 'identifier' && macroIndex.has(first.text))
}

/** 顶层宏名（用于空结果时取那条宏自己的 `getDefaultValue()`）。 */
function leadingMacroName(text: string): string | null {
  const first = tokenizeTemplateExpression(text)[0]
  return first && first.kind === 'identifier' && macroIndex.has(first.text) ? first.text : null
}

/** 这段写法用的是哪条宏；不是宏调用就 `undefined`（设置页的「表达式」列与门禁清单都读它）。 */
export function templateMacroOfExpression(text: string): TemplateMacro | undefined {
  return macroIndex.get(leadingMacroName(text) ?? '')
}

/**
 * 看着像宏调用、宏表里却没有这个名字：`spacesToUnderscore(EXPR)` 这种拼错的写法。
 * 上游此时把它当**变量引用**（`MacroParser.java:67-70`），本仓当字面量默认值 —— 两边都不会崩，
 * 但用户需要知道那一格不会算。返回那个名字，不是这种写法时返回 `null`。
 */
export function unknownMacroCall(text: string): string | null {
  const [first, second] = tokenizeTemplateExpression(text)
  if (!first || first.kind !== 'identifier' || second?.kind !== 'lparen') return null
  return macroIndex.has(first.text) ? null : first.text
}

// ---------------------------------------------------------------------------
// 求值
// ---------------------------------------------------------------------------

/** 变量读取环境：`END` 与预定义变量的口径都照上游。 */
export interface TemplateExpressionEnvironment {
  /** 已经算出来的量（`TemplateStateBase.java:85-96` 读段落当前文本的那条路的等价物）。 */
  readonly variables: Record<string, string>
  /** 预定义变量表（`TemplateStateBase.java:55-57` + `:79-84`）：**先于** variables 查。 */
  readonly predefined?: Record<string, string>
}

/** 表里取字符串；`constructor`/`toString` 这类名字不能顺着原型链读出来（上游是 Map，这里显式判自有键）。 */
function ownText(table: Record<string, string> | undefined, name: string): string | undefined {
  if (!table || !Object.prototype.hasOwnProperty.call(table, name)) return undefined
  const value = table[name]
  return typeof value === 'string' ? value : undefined
}

/**
 * 单个节点的求值。返回 `null` = 上游的「没有结果」（`Result == null`），空串与 null 在
 * `recalcSegment` 里是**两种**判据（`:787` 把两者并成 `resultIsNullOrEmpty`），所以这里不混用。
 */
export function evaluateTemplateExpression(
  node: TemplateExpressionNode,
  environment: TemplateExpressionEnvironment,
  context: TemplateMacroContext,
): string | null {
  switch (node.kind) {
    case 'constant':
      return node.text
    case 'end':
      // EmptyNode.calculateResult 恒为 null（EmptyNode.java:15-17）。
      return null
    case 'variable': {
      // VariableNode.java:21-26：带初值时用**初值**（不看变量当前文本）。
      if (node.initial) return evaluateTemplateExpression(node.initial, environment, context)
      if (node.name === 'END') return ''           // TemplateStateBase.java:76-78
      const predefined = ownText(environment.predefined, node.name)
      if (predefined !== undefined) return predefined
      const current = ownText(environment.variables, node.name)
      return current === undefined ? null : current
    }
    case 'macro': {
      const macro = macroIndex.get(node.name)
      if (!macro) return null
      const parameters = node.parameters.map(parameter => evaluateTemplateExpression(parameter, environment, context))
      return macro.calculate(parameters, context)
    }
  }
}

/** 一个槽位：`rawDefault` 是模板正文里 `:` 到 `$` 之间的那一段原文。 */
export interface TemplateSlotDefinition {
  name: string
  rawDefault: string
}

/**
 * 一次展开里所有槽位的值。定形迭代 + 封顶，两条都照 `TemplateState.calcResults`：
 *   · 段落初值 = 字面默认值文本；宏调用那一段没有独立默认值，初值为空串；
 *   · 只要有一段变了就再来一轮，轮数上限 `(槽位数 + 1) * 3`（`TemplateState.java:660`）；
 *   · 结果为 null 或空 → 该宏的 `getDefaultValue()`（`TemplateState.java:1137-1141` 的 marker；
 *     `recalcSegment:795-797` 的「变量默认值」在本仓与宏调用共用同一段，已被宏占位）。
 */
export function resolveTemplateSlotValues(
  slots: readonly TemplateSlotDefinition[],
  predefined: Record<string, string>,
  context: TemplateMacroContext,
): Record<string, string> {
  const values: Record<string, string> = {}
  const macroSlots: TemplateSlotDefinition[] = []
  for (const slot of slots) {
    if (Object.prototype.hasOwnProperty.call(values, slot.name)) continue
    if (isTemplateMacroExpression(slot.rawDefault)) { macroSlots.push(slot); values[slot.name] = '' }
    else values[slot.name] = slot.rawDefault
  }
  if (!macroSlots.length) return values
  const environment: TemplateExpressionEnvironment = { variables: values, predefined }
  let attempts = (Object.keys(values).length + 1) * 3
  for (;;) {
    let changed = false
    for (const slot of macroSlots) {
      const result = evaluateTemplateExpression(parseTemplateExpression(slot.rawDefault), environment, context)
      const marker = leadingMacroName(slot.rawDefault)
      const next = result === null || result === '' ? (macroIndex.get(marker ?? '')?.defaultValue ?? '') : result
      if (next !== ownText(values, slot.name)) { values[slot.name] = next; changed = true }
    }
    if (!changed || --attempts <= 0) return values
  }
}
