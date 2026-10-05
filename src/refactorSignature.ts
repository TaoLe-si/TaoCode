// 更改签名（ChangeSignature）的**文本层**模型 —— 上游 `platform/lang-impl/src/com/intellij/refactoring/changeSignature/`
// 那一族（`ChangeSignatureDialogBase` / `ParameterTableModelBase` / `MethodDescriptor` / `DefaultValueChooser`）
// 在本仓的等价物。
//
// **本仓用什么承接了上游的什么**：
//   · 上游用 PSI（`PsiMethod`/`ParameterInfoImpl`）读方法声明、用 `RenameProcessor`+
//     `JavaChangeSignatureUsageProcessor` 改所有调用点；本仓没有语法树（lp/psi 族判 `[-]`），
//     所以这一层是**括号/引号感知的文本扫描**（与 `src/unwrap.ts` 同一套扫描器口径）：
//     从光标处回溯到声明头，切参数表，再按名字在工作区文本里找 `name(` 的调用点。
//   · 对话框的账（哪几个文件、哪几处）交回既有的预览链路
//     （`src/refactorPreview.ts` + `src/components/RefactorPreviewDialog.vue`），
//     对应上游 `ChangeSignatureDialogBase extends RefactoringDialog`（`:97`）带的那套预览/用法树。
//   · 调用点的参数改写规则照上游 `ChangeSignatureProcessor` 的可见结果：
//     留下的形参**按位置**把原实参带过去、删掉的形参把实参一起去掉、
//     新增的形参用对话框里填的默认值（上游 `ParameterTableModelItemBase.getDefaultValue()`，
//     `:14-17`；编辑那一格的控件是 `DefaultValueChooser.java`）。
//
// 键位：`ChangeSignature` = `platform/platform-resources/src/keymaps/$default.xml:469-471`
// （`control F6`）。上游 Java 的**同名**动作 `ChangeTypeSignature` 在 `:472-474`（Ctrl+Shift+F6），
// 那是「改返回类型」的单独入口，本仓把返回类型放在同一个对话框里改（`changeSignature.return.type.prompt`），
// 所以不移植第二条键位。
//
// 标题与列名（`messages/RefactoringBundle.properties` 的 zh 语言包值，助记符按本仓惯例去掉）：
//   · `changeSignature.refactoring.name` = 更改签名（`ChangeSignatureDialogBase.java:151`）
//   · `changeSignature.name.prompt` = 名称:（`:236`）
//   · `changeSignature.return.type.prompt` = 返回值类型:（`:261`）
//   · `parameters.border.title` = 形参（`:340`）
//   · `signature.preview.border.title` = 签名预览（`:556`）
//   · 表列 = 类型 / 名称 / 默认值（`java/java-impl/src/com/intellij/refactoring/changeSignature/JavaParameterTableModel.java:54-56`
//     的 `JavaTypeColumn` / `JavaNameColumn` / `DefaultValueColumn`）

import type { LspFileEdits, LspTextEdit } from './bridge.ts'

/** 本仓认得的签名语言档（取自 `src/editorLanguage.ts` 的语言 id，认不出的走 `other` = C 族规则）。 */
export type SignatureLanguage =
  'typescript' | 'javascript' | 'java' | 'kotlin' | 'cpp' | 'c' | 'python' | 'go' | 'rust' | 'other'

/** 一个形参（上游 `ParameterInfoImpl` 在本仓的三列形态：类型 / 名称 / 默认值）。 */
export interface SignatureParam {
  /** 参数名（`JavaNameColumn`）。 */
  name: string
  /** 类型文本（`JavaTypeColumn`）；无类型的语言档为空串。 */
  type: string
  /** 默认值文本（`DefaultValueColumn`）；没有为空串。 */
  defaultValue: string
  /** 不定长参数（`T… args` / `args...` / `*args`）—— 渲染时要把标记带回去。 */
  variadic: boolean
  /**
   * 解析时的**原始位置**（新增的形参为 -1）。上游 `ChangeSignatureProcessor` 按 `ParameterInfoImpl`
   * 的**对象身份**把实参带过去，所以改了参数名不影响对应关系；本仓用这个序号做同一件事
   * （只按名字对应会把「改名」误判成「删一个 + 加一个」，实参就丢了）。
   */
  originalIndex: number
}

/** 解析出来的一处函数/方法声明。偏移都是**文档内 0 基字符偏移**。 */
export interface ParsedSignature {
  language: SignatureLanguage
  name: string
  /** 返回类型文本；没有返回类型的语言档为 null。 */
  returnType: string | null
  params: SignatureParam[]
  /** 声明头的起点（含修饰符/`def`/`func` 关键字）。 */
  headerFrom: number
  /** 名字区间。 */
  nameFrom: number
  nameTo: number
  /** 参数表**左右括号**的区间（含括号）。 */
  argsFrom: number
  argsTo: number
  /** 返回类型区间（null = 该语言档没有这一段）。 */
  returnTypeFrom: number | null
  returnTypeTo: number | null
}

/** 一处调用（`name(实参…)`）。 */
export interface CallSite {
  path: string
  /** 参数表括号的区间（含括号）。 */
  argsFrom: number
  argsTo: number
  /** 按顶层逗号切开的实参文本。 */
  args: string[]
}

/** 语言档 -> 是否「类型在名字前」（Java/C/C++ 的 `int a`）还是「名字在类型前」（TS/Python/Kotlin）。 */
const NAME_BEFORE_TYPE: readonly SignatureLanguage[] = ['java', 'cpp', 'c', 'rust', 'other']
/** 类型用 `:` 标的语言档。 */
const COLON_TYPED: readonly SignatureLanguage[] = ['typescript', 'javascript', 'python', 'kotlin', 'rust']
/** Go 是 `名字 类型`（`func add(x int)`），既不是冒号族也不是 Java 族。 */
const NAME_FIRST_SPACED: readonly SignatureLanguage[] = ['go']

function languageOf(language: string): SignatureLanguage {
  const known: SignatureLanguage[] = ['typescript', 'javascript', 'java', 'kotlin', 'cpp', 'c', 'python', 'go', 'rust']
  return (known as string[]).includes(language) ? language as SignatureLanguage : 'other'
}

/** 括号配对（跳过字符串与注释），返回闭括号下标或 -1。与 `src/unwrap.ts` 的 `matchBrace` 同一口径，但认 `()`。 */
export function matchParen(text: string, open: number): number {
  let depth = 0
  let quote = ''
  for (let index = open; index < text.length; ++index) {
    const char = text[index]!
    if (quote) {
      if (char === '\\') ++index
      else if (char === quote) quote = ''
      continue
    }
    if (char === '"' || char === "'" || char === '`') { quote = char; continue }
    if (char === '/' && text[index + 1] === '/') { const nl = text.indexOf('\n', index); if (nl < 0) break; index = nl; continue }
    if (char === '/' && text[index + 1] === '*') { const end = text.indexOf('*/', index + 2); if (end < 0) break; index = end + 1; continue }
    if (char === '#') { const nl = text.indexOf('\n', index); if (nl < 0) break; index = nl; continue }
    if (char === '(') ++depth
    else if (char === ')' && --depth === 0) return index
  }
  return -1
}

/** 把参数表文本按**顶层逗号**切开（尖括号/方括号/圆括号内的逗号不算）。 */
export function splitTopLevel(text: string): string[] {
  const parts: string[] = []
  let depth = 0
  let quote = ''
  let current = ''
  for (let index = 0; index < text.length; ++index) {
    const char = text[index]!
    if (quote) {
      current += char
      if (char === '\\') { current += text[++index] ?? '' ; continue }
      if (char === quote) quote = ''
      continue
    }
    if (char === '"' || char === "'" || char === '`') { quote = char; current += char; continue }
    if (char === '(' || char === '[' || char === '<' || char === '{') ++depth
    else if (char === ')' || char === ']' || char === '>' || char === '}') depth = Math.max(0, depth - 1)
    if (char === ',' && depth === 0) { parts.push(current); current = ''; continue }
    current += char
  }
  if (current.trim() || parts.length) parts.push(current)
  return parts.map(part => part.trim()).filter((part, index) => part.length || index < parts.length - 1)
}

/** 找一个顶层 `:`（类型标记）或顶层空格分隔点；深度里的都不算。 */
function topLevelColon(text: string): number {
  let depth = 0
  let quote = ''
  for (let index = 0; index < text.length; ++index) {
    const char = text[index]!
    if (quote) { if (char === '\\') ++index; else if (char === quote) quote = ''; continue }
    if (char === '"' || char === "'" || char === '`') { quote = char; continue }
    if (char === '(' || char === '[' || char === '<' || char === '{') ++depth
    else if (char === ')' || char === ']' || char === '>' || char === '}') depth = Math.max(0, depth - 1)
    else if (char === '=' && depth === 0 && text[index + 1] !== '=' && text[index - 1] !== '='
      && text[index + 1] !== '>' && !['<', '>', '!', '='].includes(text[index - 1] ?? '')) return -2  // 默认值起点，交给调用方处理
    else if (char === ':' && depth === 0) return index
  }
  return -1
}

/** 参数段里的默认值切分：` = ` 或 `=`（Python 无空格），排除 `=>` 与比较。 */
function splitDefault(segment: string): { head: string; value: string } {
  let depth = 0
  let quote = ''
  for (let index = 0; index < segment.length; ++index) {
    const char = segment[index]!
    if (quote) { if (char === '\\') ++index; else if (char === quote) quote = ''; continue }
    if (char === '"' || char === "'" || char === '`') { quote = char; continue }
    if (char === '(' || char === '[' || char === '<' || char === '{') ++depth
    else if (char === ')' || char === ']' || char === '>' || char === '}') depth = Math.max(0, depth - 1)
    else if (char === '=' && depth === 0 && segment[index + 1] !== '=' && segment[index - 1] !== '='
      && segment[index + 1] !== '>' && !['<', '>', '!'].includes(segment[index - 1] ?? '')) {
      return { head: segment.slice(0, index).trim(), value: segment.slice(index + 1).trim() }
    }
  }
  return { head: segment, value: '' }
}

const IDENT = /[$\p{L}_][$\p{L}\p{N}_]*/u
/** 完整标识符（校验用 —— `IDENT` 不带锚点，`'a b'` 也会命中，踩过）。 */
const IDENT_FULL = /^[$\p{L}_][$\p{L}\p{N}_]*$/u

/** 把一个参数段解析成「类型 / 名称 / 默认值」三列（`index` = 原始位置，见 `SignatureParam.originalIndex`）。 */
export function parseParam(segment: string, language: SignatureLanguage, index = -1): SignatureParam {
  const { head, value } = splitDefault(segment)
  let variadic = false
  let body = head
  if (body.endsWith('...')) { variadic = true; body = body.slice(0, -3).trim() }
  if (/^[*&]?\s*\w+\s*\.\.\.$/.test(body) && body.includes('...')) { variadic = true; body = body.replace(/\s*\.\.\.\s*$/, '').trim() }
  if (body.startsWith('...')) { variadic = true; body = body.slice(3).trim() }
  const optional = language === 'typescript' && body.endsWith('?')
  if (optional) body = body.slice(0, -1)

  if (COLON_TYPED.includes(language)) {
    const at = topLevelColon(body)
    if (at >= 0) return { name: body.slice(0, at).trim(), type: body.slice(at + 1).trim(), defaultValue: value, variadic, originalIndex: index }
    return { name: body, type: '', defaultValue: value, variadic, originalIndex: index }
  }
  if (NAME_FIRST_SPACED.includes(language)) {
    // Go：`x int` / `x, y int`（后者在切分时已经是单段）—— 第一个标识符是名字，剩下是类型。
    const matches = [...body.matchAll(new RegExp(IDENT.source, 'gu'))]
    if (matches.length > 1) return { name: matches[0]![0], type: body.slice(matches[1]!.index ?? 0).trim(), defaultValue: value, variadic, originalIndex: index }
    return { name: body, type: '', defaultValue: value, variadic, originalIndex: index }
  }
  if (NAME_BEFORE_TYPE.includes(language) || language === 'other') {
    // `Type name` / `const Type& name`：最后一个标识符是名字，前面全是类型。
    const matches = [...body.matchAll(new RegExp(IDENT.source, 'gu'))]
    if (matches.length > 1) {
      const last = matches[matches.length - 1]!
      return { name: last[0], type: body.slice(0, last.index).trim(), defaultValue: value, variadic, originalIndex: index }
    }
    return { name: body, type: matches.length ? '' : body, defaultValue: value, variadic, originalIndex: index }
  }
  return { name: body, type: '', defaultValue: value, variadic, originalIndex: index }
}

/** 按语言档把三列渲染回一段参数文本。 */
export function renderParam(param: SignatureParam, language: SignatureLanguage): string {
  const mark = param.variadic ? (['python'].includes(language) ? '*' : '...') : ''
  const name = `${mark}${param.name}`
  if (NAME_FIRST_SPACED.includes(language)) return param.type ? `${name} ${param.type}${param.defaultValue ? ` = ${param.defaultValue}` : ''}` : name
  let text: string
  if (COLON_TYPED.includes(language)) text = param.type ? `${name}: ${param.type}` : name
  else text = param.type ? `${param.type} ${name}` : name
  if (param.defaultValue) text += language === 'python' || language === 'rust' ? `=${param.defaultValue}` : ` = ${param.defaultValue}`
  return text
}

/** 参数表文本（含括号），与上游 `MethodDescriptor` 渲染出来的形态一致。 */
export function renderParams(params: readonly SignatureParam[], language: SignatureLanguage): string {
  return `(${params.map(param => renderParam(param, language)).join(language === 'python' || language === 'go' ? ', ' : ', ')})`
}

/** 声明头关键字（`def`/`func`/`function`）——渲染时要原样保留，本仓只在解析时记下偏移。 */
const KEYWORD_LEAD = /^(?:async\s+def|async\s+function|def|function|func|fn)\s+/
/** 关键字本身（正则匹配到的是**单个标识符**，所以要用集合判，`KEYWORD_LEAD` 那种带空白的形态匹配不上）。 */
const KEYWORD_NAMES = new Set(['function', 'def', 'func', 'fn'])

/**
 * 从 `offset` 起**逐行向上**找包住它的那一处函数/方法声明。
 * 返回 null 表示光标不在任何函数声明里（上游 `JavaChangeSignatureHandler` 找不到方法时同样
 * 什么都不做，只在「光标应位于…」那一档给提示：`RefactoringBundle.properties:479`
 * `the.caret.should.be.positioned.inside.a.class.to.pull.members.from` 是同族文案）。
 *
 * 判据是**声明头形状**（这是文本层与 PSI 的唯一可靠分界）：`name(` 之后配对的 `)` 再往后必须接
 * `{` / `:` / `->` / `=>` / 行尾，才算是声明；接 `;` `,` `)` 的是表达式调用，跳过。
 * 参数表跨行时从声明头那一行起算，所以候选行逐行向上（上限 60 行：装饰器 + 修饰符 + 多行参数表）。
 */
export function parseSignature(text: string, offset: number, language: string): ParsedSignature | null {
  const lang = languageOf(language)
  let lineStart = text.lastIndexOf('\n', Math.max(0, offset - 1)) + 1
  for (let guard = 0; guard < 60; ++guard) {
    const lineEnd = text.indexOf('\n', lineStart)
    const limit = lineEnd < 0 ? text.length : lineEnd
    const line = text.slice(lineStart, limit)
    const found = headerOnLine(text, line, lineStart, offset, lang)
    if (found) return found
    if (lineStart === 0) break
    lineStart = text.lastIndexOf('\n', Math.max(0, lineStart - 2)) + 1
  }
  return null
}

/** 声明头之后允许出现的收尾（`{` 块体、`:` 类型/Python 头、`->`/`=>` 返回、`;`/行尾 = 无体的抽象声明）。 */
function isDeclarationTail(text: string, close: number, lineEnd: number, lang: SignatureLanguage, nameFrom: number, lineStart: number): boolean {
  const rest = text.slice(close + 1, Math.min(text.length, lineEnd + 40))
  // Go 的接收器 `func (r T) name(`：闭括号后跟「一个标识符 + 又一个左括号」时，这对括号只是接收器 ——
  // 放行给同行下一个候选（真正的参数表在后面）。
  if (/^\s*[\p{L}_][\p{L}\p{N}_]*\s*\(/u.test(rest)) return false
  if (/^\s*(?:\{|=>|:|->|where\b)/.test(rest)) return true
  if (/^\s*[^\n{;=)]*\{\s*$/m.test(rest)) return true
  // 无括号体的语言档（Go/Rust/Java 的抽象方法）：`;` 之前那段是返回类型。
  if ((lang === 'go' || lang === 'rust') && /^\s*[A-Za-z_[(]/.test(rest)) return true
  // 参数表之后**一直到行尾**什么都没有（或只有 `;`）：只有「这一行在名字之前只剩类型/修饰符」时才算声明。
  // 少了这道判定，`return inner(b)`、`doWork();` 这类**调用**会被当成声明头（实测踩过）。
  if (!/^\s*;?\s*$/.test(text.slice(close + 1, lineEnd))) return false
  return isModifierPrefix(text.slice(lineStart, nameFrom))
}

/** 名字之前那串是否「只有类型 + 修饰符」：至少一个词、不含 `=`/`(`/关键字/运算符。 */
function isModifierPrefix(prefix: string): boolean {
  const trimmed = prefix.trim()
  if (!trimmed) return false
  if (!/^[\w\s<>[\]().,*&]*$/.test(trimmed)) return false
  if (/\b(?:return|await|new|throw|else|do|in|of|and|or|not|is|typeof|function|def|fn)\b/.test(trimmed)) return false
  return true
}

/** 这一行里有没有声明头；有就解析出来（同一行多个候选时取**第一个**形状成立的，即最外层的）。 */
function headerOnLine(text: string, line: string, lineStart: number, offset: number, lang: SignatureLanguage): ParsedSignature | null {
  const pattern = /([$A-Z_][$\w.]*|[\p{L}_][\p{L}\p{N}_]*)\s*\(/gu
  let match: RegExpExecArray | null
  while ((match = pattern.exec(line))) {
    const open = lineStart + (match.index ?? 0) + match[0].indexOf('(')
    const close = matchParen(text, open)
    if (close < 0) continue
    // 整个构造（名字带括号）都在光标之后 = 那是光标**后面**的一处调用，不是包住光标的声明。
    // 光标落在声明头的**方法名上**时 `open > offset` 是常态，所以只有名字也在光标之后才排除。
    if (open > offset && lineStart + (match.index ?? 0) > offset) continue
    const lineEnd = text.indexOf('\n', open)
    const nameFrom = lineStart + (match.index ?? 0)
    if (!isDeclarationTail(text, close, lineEnd < 0 ? text.length : lineEnd, lang, nameFrom, lineStart)) continue
    const name = match[1]!
    if (KEYWORD_NAMES.has(name) || RESERVED_HEAD.has(name)) continue
    return finish(text, lineStart, nameFrom, nameFrom + name.length, open, close, name, lang)
  }
  return arrowHeader(text, line, lineStart, offset, lang)
}

/**
 * 匿名/箭头形态：`const inner = (q) => …`、`inner = async (q) => …`。
 * 上游对 lambda 的参数表也改得动（`PsiParameterList` 那一层），本仓只有在**带绑定名**的形态上
 * 才能把名字与调用点对上，所以只认「名字 = (」。
 */
function arrowHeader(text: string, line: string, lineStart: number, offset: number, lang: SignatureLanguage): ParsedSignature | null {
  const match = /(?:^|[^.\w$])((?:const|let|var)\s+)?([$A-Z_][\w.]*|[\p{L}_][\p{L}\p{N}_]*)\s*=\s*(?:async\s*)?\(/u.exec(line)
  if (!match) return null
  const name = match[2]!
  if (KEYWORD_NAMES.has(name) || RESERVED_HEAD.has(name)) return null
  const open = lineStart + (match.index ?? 0) + match[0].indexOf('(')
  if (open > offset) return null
  const close = matchParen(text, open)
  if (close < 0) return null
  const lineEnd = text.indexOf('\n', open)
  const nameFrom = lineStart + match[0].indexOf(name, match[1]?.length ?? 0)
  if (!isDeclarationTail(text, close, lineEnd < 0 ? text.length : lineEnd, lang, nameFrom, lineStart)) return null
  return finish(text, lineStart, nameFrom, nameFrom + name.length, open, close, name, lang)
}

/** 会被误当方法名的公共关键字（`if (`/`for (`/`return (`/`new (` …）。 */
const RESERVED_HEAD = new Set(['if', 'for', 'while', 'switch', 'catch', 'return', 'new', 'do', 'else', 'typeof', 'await', 'yield', 'synchronized', 'with', 'print', 'println', 'assert', 'throw'])

/**
 * 括号区间确定后补齐名字 / 返回类型 / 参数表。
 * 返回类型的两种形态都照上游 `MethodDescriptor.getReturnType()` 的可见结果：
 *   · 尾置（TS `): T {`、Python `) -> T:`、Kotlin `): T {`、Go `) T {`、Rust `) -> T {`）
 *   · 前置（Java/C/C++：`T name(…)`，修饰符 `public static final` 那串不算类型）
 */
function finish(text: string, windowStart: number, nameFrom: number, nameTo: number, open: number, close: number,
  name: string, lang: SignatureLanguage): ParsedSignature | null {
  if (!name) return null
  const argsText = text.slice(open + 1, close)
  const params = splitTopLevel(argsText).map((segment, index) => parseParam(segment, lang, index))
  const after = text.slice(close + 1)
  let returnType: string | null = null
  let returnTypeFrom: number | null = null
  let returnTypeTo: number | null = null
  // 尾置类型：**不跨行**（跨行会把 Python 的函数体首行吞进来，实测踩过）。
  const tail = /^\s*(?::|->)\s*([^\n{;=]+?)(?=\s*(?:\{|;|:|=|where|\n|$))/.exec(after)
  if (tail?.[1]?.trim()) {
    returnTypeFrom = close + 1 + tail[0].indexOf(tail[1])
    returnType = tail[1].trim()
    returnTypeTo = returnTypeFrom + returnType.length
  } else if (lang === 'go' || lang === 'rust') {
    const plain = /^\s*([A-Za-z_(][^\n{]*?)(?=\s*\{|\s*$)/.exec(after)
    if (plain?.[1]?.trim()) {
      returnTypeFrom = close + 1 + plain[0].indexOf(plain[1])
      returnType = plain[1].trim()
      returnTypeTo = returnTypeFrom + returnType.length
    }
  }
  if (returnType === null && !COLON_TYPED.includes(lang) && lang !== 'kotlin') {
    // 前置类型：名字之前的那串。**带括号就不是类型**（Go 的接收器 `func (r T) Name(` 会走到这条排除）。
    const before = text.slice(windowStart, nameFrom)
      .replace(/\b(?:public|private|protected|static|final|inline|virtual|export|async|override|const|default|abstract)\b/g, '')
      .trim()
    if (before && !/[(){};=]/.test(before) && !KEYWORD_LEAD.test(before + ' ') && !/\bnew\b/.test(before)) returnType = before
  }
  return {
    language: lang, name, returnType, params,
    headerFrom: windowStart, nameFrom, nameTo, argsFrom: open, argsTo: close,
    returnTypeFrom, returnTypeTo,
  }
}

/** 整条声明头的渲染（签名预览用；上游 `calculateSignature()`）。 */
export function signaturePreview(parsed: ParsedSignature, name: string, returnType: string | null, params: readonly SignatureParam[]): string {
  const args = renderParams(params, parsed.language)
  if (COLON_TYPED.includes(parsed.language) || parsed.language === 'other') {
    if (parsed.language === 'python') return `def ${name}${args}${returnType ? ` -> ${returnType}` : ''}:`
    if (parsed.language === 'kotlin') return `fun ${name}${args}${returnType ? `: ${returnType}` : ''}`
    return `function ${name}${args}${returnType && returnType !== 'void' ? `: ${returnType}` : ''}`
  }
  if (parsed.language === 'go') return `func ${name}${args}${returnType ? ` ${returnType}` : ''}`
  if (parsed.language === 'rust') return `fn ${name}${args}${returnType ? ` -> ${returnType}` : ''}`
  return `${returnType ? `${returnType} ` : ''}${name}${args}`
}

/** 把声明处的改动写成 LSP 编辑（参数表 + 名字 + 返回类型三段，行/列按 `text` 折算）。 */
export function declarationEdits(parsed: ParsedSignature, text: string, path: string,
  name: string, returnType: string | null, params: readonly SignatureParam[]): LspTextEdit[] {
  const edits: LspTextEdit[] = []
  const argsText = renderParams(params, parsed.language)
  if (argsText !== text.slice(parsed.argsFrom, parsed.argsTo + 1)) edits.push(editOf(text, path, parsed.argsFrom, parsed.argsTo + 1, argsText))
  if (name !== parsed.name) edits.push(editOf(text, path, parsed.nameFrom, parsed.nameTo, name))
  if (returnType !== null && parsed.returnType !== null && returnType !== parsed.returnType && parsed.returnTypeFrom !== null && parsed.returnTypeTo !== null)
    edits.push(editOf(text, path, parsed.returnTypeFrom, parsed.returnTypeTo, returnType))
  return edits.filter(Boolean)
}

/** 偏移区间 -> 行列编辑（行内偏移按 UTF-16 单元数，与 LSP 口径一致）。 */
function editOf(text: string, path: string, from: number, to: number, replacement: string): LspTextEdit {
  const start = positionOf(text, from)
  const end = positionOf(text, to)
  void path
  return { text: replacement, startLine: start.line, startChar: start.character, endLine: end.line, endChar: end.character }
}

function positionOf(text: string, offset: number): { line: number; character: number } {
  const clipped = Math.max(0, Math.min(text.length, offset))
  const line = text.slice(0, clipped).split('\n').length - 1
  const lineStart = clipped - (text.lastIndexOf('\n', clipped - 1) + 1)
  return { line, character: lineStart }
}

/** 注释/字符串里的命中不算调用（复用 `src/nonCodeUsages.ts` 的区间表）。 */
function inRange(ranges: readonly { from: number; to: number }[], at: number): boolean {
  return ranges.some(range => at >= range.from && at < range.to)
}

/**
 * 在一份文本里找 `name(` 的调用点（顶层词法匹配：前面的字符不能是标识符字符或 `.` 之外的名字尾巴）。
 * 声明本身也在这份表里，调用方按 `exclude` 去掉。
 */
/** 正则字面量转义（方法名可能带 `$`/`_`，但绝不可能带元字符；这里只是防御性写法）。 */
const escapeRegExp = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

export function findCallSites(path: string, text: string, name: string,
  nonCode: readonly { from: number; to: number }[], exclude?: { from: number; to: number }): CallSite[] {
  const out: CallSite[] = []
  const pattern = new RegExp(`(?:^|[^$\\p{L}\\p{N}_])(${escapeRegExp(name)})\\s*\\(`, 'gu')
  let match: RegExpExecArray | null
  while ((match = pattern.exec(text))) {
    const start = (match.index ?? 0) + match[0].indexOf(name)
    if (inRange(nonCode, start)) continue
    const open = text.indexOf('(', start + name.length)
    const close = matchParen(text, open)
    if (close < 0) continue
    if (exclude && start >= exclude.from && start < exclude.to) continue
    const args = splitTopLevel(text.slice(open + 1, close))
    out.push({ path, argsFrom: open, argsTo: close, args })
  }
  return out
}

/** 一次调用点改写的结果：新参数表文本 + 需要用户确认的缺默认值项。 */
export interface CallRewrite {
  text: string
  /** 新增形参没有默认值（上游会**报错要求填**，本仓按空实参落，并把这一处标出来）。 */
  missingDefaults: string[]
  /** 被删掉的实参文本（上游 `ChangeSignatureProcessor` 直接删；本仓如实列出来好核对）。 */
  droppedArgs: string[]
}

/**
 * 按「旧形参 -> 新形参」的**身份**对应改写一处实参表。
 * 身份 = `originalIndex`（解析时的那一位），所以**改名字不会丢实参**；重排时实参跟着形参一起重排
 * （上游 `ChangeSignatureProcessor` 就是按 `ParameterInfoImpl` 的对象身份走的）。
 * 删掉的形参把那一位实参一起去掉；新增的形参取默认值，没填默认值就记进 `missingDefaults`。
 */
export function rewriteCall(oldParams: readonly SignatureParam[], newParams: readonly SignatureParam[],
  args: readonly string[]): CallRewrite {
  const missingDefaults: string[] = []
  const droppedArgs: string[] = []
  // 新表里占用的旧位序（重排/复制一行时同一位只能被认领一次）。
  const claimed = new Set<number>()
  for (const param of newParams)
    if (param.originalIndex >= 0 && param.originalIndex < oldParams.length) claimed.add(param.originalIndex)
  for (const [index, param] of oldParams.entries())
    if (!claimed.has(index)) droppedArgs.push(args[index] ?? '')
  const taken = new Set<number>()
  const out = newParams.map(param => {
    // 先按身份认领那一位的实参；身份缺失（-1，对话框里新加的行）才退回按名字找。
    let source = param.originalIndex >= 0 && param.originalIndex < oldParams.length && !taken.has(param.originalIndex)
      ? param.originalIndex
      : oldParams.findIndex((old, index) => !taken.has(index) && old.name && old.name === param.name)
    if (source >= 0) { taken.add(source); return args[source] ?? '' }
    if (param.defaultValue) return param.defaultValue
    missingDefaults.push(param.name)
    return ''
  })
  // 尾部不定长实参（`...rest`）原样接在最后，上游 `ParameterInfoImpl.isVarargs()` 同样不参与重排。
  const lastOld = oldParams[oldParams.length - 1]
  const lastNew = newParams[newParams.length - 1]
  if (lastOld?.variadic && args.length > oldParams.length && !lastNew?.variadic)
    out.push(...args.slice(oldParams.length))
  return { text: `(${out.map(arg => arg.trim()).join(', ')})`, missingDefaults, droppedArgs }
}

/** 调用点编辑（一份文件一组）。 */
export function callSiteEdits(text: string, site: CallSite, rewrite: CallRewrite): LspTextEdit {
  return editOf(text, site.path, site.argsFrom, site.argsTo + 1, rewrite.text)
}

/** 一份工作区文本（路径 -> 文本 + 注释区间）。 */
export interface SignatureFileText { path: string; text: string; nonCode?: { from: number; to: number }[] }

/**
 * 端到端：把「新签名」落到声明 + 全部文本可见的调用点上，产出预览链路要的 `LspFileEdits[]`。
 * 声明文件里的那一处用 `declarationEdits`，其余文件里每个调用点一条编辑。
 */
export function changeSignatureEdits(parsed: ParsedSignature, declPath: string, declText: string,
  name: string, returnType: string | null, params: readonly SignatureParam[],
  files: readonly SignatureFileText[]): { edits: LspFileEdits[]; rewrites: { path: string; missingDefaults: string[]; droppedArgs: string[] }[] } {
  const declEdits = declarationEdits(parsed, declText, declPath, name, returnType, params)
  const byPath = new Map<string, LspTextEdit[]>()
  if (declEdits.length) byPath.set(declPath, [...declEdits])
  const rewrites: { path: string; missingDefaults: string[]; droppedArgs: string[] }[] = []
  const nameChanged = name !== parsed.name
  const targetName = nameChanged ? parsed.name : name
  for (const file of files) {
    // 声明自己的那一段不能当调用点处理：参数表由 `declarationEdits` 改，名字也在那儿。
    const skip = file.path === declPath ? { from: parsed.nameFrom, to: parsed.argsTo + 1 } : undefined
    const sites = findCallSites(file.path, file.text, targetName, file.nonCode ?? [], skip)
    if (!sites.length) continue
    const list: LspTextEdit[] = []
    for (const site of sites) {
      const rewrite = rewriteCall(parsed.params, params, site.args)
      if (rewrite.missingDefaults.length || rewrite.droppedArgs.length)
        rewrites.push({ path: file.path, missingDefaults: rewrite.missingDefaults, droppedArgs: rewrite.droppedArgs })
      const original = file.text.slice(site.argsFrom, site.argsTo + 1)
      if (rewrite.text !== original) list.push(callSiteEdits(file.text, site, rewrite))
      if (nameChanged) list.push(...callNameEdit(file.text, file.path, site, name))
    }
    if (list.length) byPath.set(file.path, [...(byPath.get(file.path) ?? []), ...list])
  }
  const edits = [...byPath].map(([path, textEdits]) => ({ path, textEdits }))
  return { edits, rewrites }
}

/** 改了方法名时，调用点那一段文本里除了参数表还要把名字换掉（只换标识符本身，不动中间的空格）。 */
function callNameEdit(text: string, path: string, site: CallSite, name: string): LspTextEdit[] {
  const match = /([$A-Z_][$\w]*|[\p{L}_][\p{L}\p{N}_]*)\s*$/u.exec(text.slice(0, site.argsFrom))
  if (!match) return []
  const from = site.argsFrom - (match[0].length - (match[1]?.length ?? 0)) - (match[1]?.length ?? 0)
  return [editOf(text, path, from, from + (match[1]?.length ?? 0), name)]
}

/**
 * 输入校验（上游 `validateAndCommitData()`，`ChangeSignatureDialogBase.java:136` 声明、
 * Java 侧实现里第一道就是标识符与重名）。返回错误文案，空串 = 合法 ——
 * 与本仓 `invalidRenameName` 的契约一致（`src/refactorPreview.ts` 的 `validateRenameName` 同形）。
 */
export function validateSignatureChange(parsed: ParsedSignature, name: string, params: readonly SignatureParam[],
  language: string): string {
  const trimmed = name.trim()
  if (!trimmed) return '名字不能为空。'
  if (!IDENT_FULL.test(trimmed)) return '名字必须是合法标识符。'
  const seen = new Set<string>()
  for (const param of params) {
    const pname = param.name.trim()
    if (!pname) return '形参名不能为空。'
    if (!IDENT_FULL.test(pname)) return `形参「${pname}」不是合法标识符。`
    if (seen.has(pname)) return `形参名「${pname}」重复。`
    seen.add(pname)
  }
  const arity = params.filter(param => !param.defaultValue).length
  const optionalAfterRequired = params.some((param, index) => index < arity && param.defaultValue && language === 'python')
  if (optionalAfterRequired) return 'Python 的缺省形参必须排在非缺省形参之后。'
  const variadicIndex = params.findIndex(param => param.variadic)
  if (variadicIndex >= 0 && variadicIndex !== params.length - 1 && ['java', 'typescript', 'javascript'].includes(language))
    return '不定长形参必须排在最后。'
  void parsed
  return ''
}

/** 上移/下移一列（上游 `ToolbarDecorator` 的 `moveRowUp/moveRowDown`，`:480` 的装饰器给的四钮）。 */
export function moveParam(params: readonly SignatureParam[], index: number, delta: number): SignatureParam[] {
  const next = [...params]
  const target = index + delta
  if (target < 0 || target >= next.length) return next
  const [moved] = next.splice(index, 1)
  next.splice(target, 0, moved!)
  return next
}

/** 三列的表头（`JavaParameterTableModel.java:54-56` 的三列顺序）。 */
export const PARAMETER_COLUMNS: readonly { key: 'type' | 'name' | 'defaultValue'; label: string }[] = [
  { key: 'type', label: '类型' },
  { key: 'name', label: '名称' },
  { key: 'defaultValue', label: '默认值' },
]
