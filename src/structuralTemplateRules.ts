// 结构化搜索**模板合法性**与**保留变量名**的纯逻辑（零 Vue）。判词 `ss/matcher` 里
// 「模板的 PSI 合法性（`PatternContext`/`MalformedPatternException`）」与「`$Args$` 一族」两条待办的落点。
//
// 上游那份合法性是**两半**，本模块逐半承接：
//   ① **词法/命名**：变量由 `TemplateTextLexer` 切出来 ——
//      `platform/analysis-impl/src/com/intellij/codeInsight/template/impl/TemplateTextLexer.flex:21-23`
//      （`ALPHA=[A-Za-z_]`、`DIGIT=[0-9]`、`VARIABLE="$"({ALPHA}|{DIGIT})+"$"`），
//      `$$` 是转义美元（`:27` `ESCAPE_DOLLAR`），其余一律 `TEXT`（`:29`）。
//      取名与判名在 `platform/lang-impl/src/com/intellij/codeInsight/template/impl/TemplateImplUtil.java:18-35`
//      （`parseVariableNames` 剥两端 `$`）、`:45-47`（`isValidVariableName`）、`:49-52`（`isValidVariable`）。
//   ② **语法/约束**：`'Var` 形态的变量与它后面的量词/条件块由
//      `platform/structuralsearch/source/com/intellij/structuralsearch/impl/matcher/compiler/StringToConstraintsTransformer.java`
//      逐字符读（`transformCriteria:34-213`、量词 `:94-167`、条件块 `:243-300`、
//      `parseCondition:331-410`、`handleOption:412-484`、`checkRegex:486-493`），
//      失败一律抛 `MalformedPatternException`，文案取自
//      `platform/structuralsearch/resources/messages/SSRBundle.properties`（`TEMPLATE_MESSAGES` 逐条给行号）。
// 本模块**只做合法性判定**，不做正则编译：把约束编进捕获组那一半在
// `src/structuralSearchConstraints.ts`（量词 min/max/greedy、`regex`/`regexw`/`!regex`、`contains`），
// 跨行/整段复核在 `src/structuralSearchModifiers.ts`。这里补的是它们都不管的那一层 ——
// **模板作为一个整体合不合法**：变量命名、`$$` 转义、目标变量唯一、约束只能写在首次引用、
// 保留变量名、`__$_` 前缀泄漏、表达式/非表达式错配、替换侧变量未定义。
// 上游那侧这些判定分散在 `transformCriteria` + `PatternCompiler.checkForUnknownVariables`
// （`impl/matcher/compiler/PatternCompiler.java:177-199`）+ `Matcher.buildMatcher`（`Matcher.java:95-105`）
// + `Replacer`（`plugin/replace/impl/Replacer.java:310-321`）+ 各 `StructuralSearchProfile` 子类。
//
// 关于任务书点名的 `$Args$` / `$ArgsCount$` / `$Field$` / `$Method$` **预定义变量**：
// 基准树里没有这样一份预定义表 —— 三条路都搜过（见 `ARGS_FAMILY_PROBE` 与报告「无法核实」清单）。
// 上游真正被特判的变量名只有两个（`__context__` / `__log__`）加一条替换侧后缀命名规则。
// `$Args$` 那类「列表变量」在上游**不是另一种变量**，就是量词 `*`/`+` 把 min/max 放宽
// （`StringToConstraintsTransformer.java:100-112`），`'_Args*` 里的 `Args` 是用户自己取的名字。

/** 无界重复的上界 = 上游 `Integer.MAX_VALUE`（`StringToConstraintsTransformer.java:101,110,154`）。 */
export const MAX_OCCURS = 2147483647

/** 上游 `'` 变量的编译器内部前缀（`java/structuralsearch-java/src/com/intellij/structuralsearch/impl/matcher/JavaCompiledPattern.java:12`）。 */
export const TYPED_VAR_PREFIX = '__$_'

/** 「整个模板」那个保留变量名（`plugin/ui/Configuration.java:29`），中文标签「完全匹配」。 */
export const COMPLETE_MATCH_VARIABLE = '__context__'

/** 脚本日志保留变量名（`impl/matcher/predicates/ScriptLog.java:18`）。 */
export const SCRIPT_LOG_VARIABLE = '__log__'

/** 替换侧变量的后缀（`plugin/replace/ui/ReplaceConfiguration.java:18`）。 */
export const REPLACEMENT_VARIABLE_SUFFIX = '$replacement'

/** 上游 `transformCriteria` 认识的选项名（`StringToConstraintsTransformer.java:20-31`）。 */
export const KNOWN_OPTIONS = [
  'ref', 'regex', 'regexw', 'exprtype', 'formal', 'script', 'contains', 'within', 'context',
] as const

/** 用户扩展选项的前缀（`StringToConstraintsTransformer.java:346,477` 的 `_` 分支）。 */
export const CUSTOM_OPTION_PREFIX = '_'

export type TemplateIssueCode =
  | 'malformed' | 'invalidRegex' | 'unrecognizedOption' | 'onlyOneTarget'
  | 'constraintOnlyOnFirstReference' | 'twoDifferentTypeConstraints' | 'characterExpected'
  | 'overflow' | 'digitExpected' | 'brace1Expected' | 'brace2Expected' | 'emptyQuantifier'
  | 'conditionExpected' | 'conditionNameMissing' | 'valueExpected' | 'unexpectedValue'
  | 'argumentExpected' | 'cannotInvert' | 'onlyApplicableToCompleteMatch' | 'badCharacterLiteral'
  | 'badLiteral' | 'recursiveReference' | 'configurationNotFound' | 'replacementVariableNotDefined'
  | 'replacementVariableNotValid' | 'replacementNotExpression' | 'searchNotExpression'
  | 'invalidModifierType' | 'replacementNotSupported' | 'willNotFindAnything' | 'scriptUntrusted'
  | 'groovyNotAvailable' | 'scriptProblem'

export interface TemplateMessage {
  key: string
  /** 英文原文（`platform/structuralsearch/resources/messages/SSRBundle.properties`）。 */
  en: string
  /** 中文原文（`localization-zh.jar` 的 `messages/SSRBundle.properties`）。 */
  zh: string
  enLine: number
  zhLine: number
}

/** `[键, 英文, 中文, 英文行号, 中文行号]` —— 照抄两份包，含 `''{0}''` 的引号形状。 */
type MessageRow = readonly [TemplateIssueCode, string, string, string, number, number]

const MESSAGE_ROWS: readonly MessageRow[] = [
  ['malformed', 'this.pattern.is.malformed.message', 'The specified template is malformed', '指定模板的格式错误', 56, 279],
  ['invalidRegex', 'invalid.regular.expression', 'Invalid regular expression\\: {0}', '无效的正则表达式\\: {0}', 234, 75],
  ['unrecognizedOption', 'option.is.not.recognized.error.message', "Constraint ''{0}'' not recognized", "未识别约束 ''{0}''", 253, 97],
  ['onlyOneTarget', 'error.only.one.target.allowed', 'Only one target allowed', '仅允许一个目标', 255, 44],
  ['constraintOnlyOnFirstReference', 'error.condition.only.on.first.variable.reference',
    'Constraints are only allowed on the first reference of a variable', '只有变量的第一个引用上允许约束', 256, 30],
  ['twoDifferentTypeConstraints', 'error.two.different.type.constraints', 'Two different type constraints', '两种不同的类型约束', 257, 48],
  ['characterExpected', 'error.expected.character', 'Character expected after single quote', '单引号后应为字符', 259, 35],
  ['overflow', 'error.overflow', 'Value overflow', '值溢出', 260, 45],
  ['digitExpected', 'error.expected.digit', 'Digit expected', '应为数字', 261, 38],
  ['brace1Expected', 'error.expected.brace1', "Digit, '}' or ',' expected", "应为数字、'}' 或 ','", 262, 33],
  ['brace2Expected', 'error.expected.brace2', "Digit or '}' expected", "应为数字或 '}'", 263, 34],
  ['emptyQuantifier', 'error.empty.quantifier', 'Empty quantifier', '空量词', 264, 32],
  ['conditionExpected', 'error.expected.condition', "Constraint expected after ''{0}''", "''{0}'' 之后应为约束", 265, 36],
  ['conditionNameMissing', 'error.expected.condition.name', 'Constraint name missing', '缺少约束名称', 266, 37],
  ['valueExpected', 'error.expected.value', "''{0}'' expected", "应为 ''{0}''", 267, 39],
  ['unexpectedValue', 'error.unexpected.value', "Unexpected ''{0}''", "意外的 ''{0}''", 268, 49],
  ['argumentExpected', 'error.argument.expected', "Argument expected on ''{0}'' constraint", "''{0}'' 约束上应为实参", 270, 26],
  ['cannotInvert', 'error.cannot.invert', "Cannot invert ''{0}'' constraint", "无法反转 ''{0}'' 约束", 271, 29],
  ['onlyApplicableToCompleteMatch', 'error.only.applicable.to.complete.match',
    "Constraint ''{0}'' is only applicable to Complete Match", "约束 ''{0}'' 仅适用于完全匹配", 272, 43],
  ['badCharacterLiteral', 'error.bad.character.literal', 'Bad character literal', '错误字符字面量', 273, 27],
  ['badLiteral', 'error.bad.literal', 'Bad literal', '不良字面量', 274, 28],
  ['recursiveReference', 'error.pattern.recursively.references.itself', 'Template recursively references itself', '模板以递归方式引用自身', 275, 46],
  ['configurationNotFound', 'error.configuration.0.not.found', "Template ''{0}'' not found", "找不到模板 ''{0}''", 276, 31],
  ['replacementVariableNotDefined', 'replacement.variable.is.not.defined.message',
    "Unknown search variable ''{0}'' or replacement variable ''{0}'' has no script",
    "未知搜索变量 ''{0}'' 或替换变量 ''{0}'' 没有脚本", 246, 235],
  ['replacementVariableNotValid', 'replacement.variable.is.not.valid',
    "Replacement variable ''{0}'' has script code problem: {1}", "替换变量 ''{0}'' 有脚本代码问题\\: {1}", 247, 236],
  ['replacementNotExpression', 'replacement.template.is.not.expression.error.message',
    'An expression cannot be replaced with a non-expression', '表达式无法替换为非表达式', 248, 233],
  ['searchNotExpression', 'search.template.is.not.expression.error.message',
    'A non-expression cannot be replaced with an expression', '非表达式无法替换为表达式', 250, 253],
  ['invalidModifierType', 'invalid.modifier.type', 'Invalid modifier type {0}', '无效的修饰符类型 {0}', 269, 74],
  ['replacementNotSupported', 'replacement.not.supported.for.filetype',
    'Replacement is not supported for {0} file type', '{0} 文件类型不支持替换', 249, 232],
  ['willNotFindAnything', 'ssr.will.not.find.anything',
    "The specified template does not match anything in scope ''{0}''",
    "指定模板与作用域 ''{0}'' 中的任何内容都不匹配", 289, 256],
  ['scriptUntrusted', 'error.scripts.untrusted',
    'Scripts will not be executed because the project is not trusted', '项目不受信任，脚本将不会执行', 278, 237],
  ['groovyNotAvailable', 'error.groovy.script.engine.not.available',
    'Groovy script engine is not available', 'Groovy 脚本引擎不可用', 279, 40],
  ['scriptProblem', 'error.script.constraint.for.0.has.problem.1',
    'The script constraint for the variable {0} has a problem: {1}', '{0} 的脚本约束存在问题 {1}', 277, 47],
]

/** 校验失败时上游给的那批文案（照抄，含转义形状）。 */
export const TEMPLATE_MESSAGES: Readonly<Record<TemplateIssueCode, TemplateMessage>> = Object.fromEntries(
  MESSAGE_ROWS.map(row => [row[0], { key: row[1], en: row[2], zh: row[3], enLine: row[4], zhLine: row[5] }]),
) as Readonly<Record<TemplateIssueCode, TemplateMessage>>

/** 填 `{0}`/`{1}`，并把 properties/MessageFormat 的转义还原成显示形态（`\:` → `:`、`''` → `'`）。 */
function fill(template: string, args: readonly (string | number)[]): string {
  return template
    .replace(/\\(:)/g, '$1')
    .replace(/''/g, "'")
    .replace(/\{(\d+)\}/g, (whole, index: string) => {
      const value = args[Number(index)]
      return value === undefined ? whole : String(value)
    })
}

/** 按中文包原文取一条文案。 */
export function templateMessage(code: TemplateIssueCode, ...args: readonly (string | number)[]): string {
  return fill(TEMPLATE_MESSAGES[code].zh, args)
}

/** 按英文包原文取一条文案。 */
export function templateMessageEn(code: TemplateIssueCode, ...args: readonly (string | number)[]): string {
  return fill(TEMPLATE_MESSAGES[code].en, args)
}

/** 一条校验失败。`at` = 模板里的字符下标（上游抛异常时没有位置，这是本仓加的可定位信息）。 */
export interface TemplateIssue {
  code: TemplateIssueCode
  message: string
  messageEn: string
  /** 出错位置；`-1` = 整模板级（如「仅允许一个目标」）。 */
  at: number
  /** 判定这一条的上游坐标。 */
  upstream: string
}

function issue(code: TemplateIssueCode, at: number, upstream: string, ...args: readonly (string | number)[]): TemplateIssue {
  return { code, message: templateMessage(code, ...args), messageEn: templateMessageEn(code, ...args), at, upstream }
}

/** 保留变量名（上游真正特判过的那几个，不是任务书猜的那一族）。 */
export interface ReservedVariable {
  name: string
  kind: 'completeMatch' | 'scriptLog'
  /** 面板上的档名。`complete.match.variable.name`（EN `SSRBundle.properties:293` / 中文包 `:14`）。 */
  label: string
  upstream: string
  note: string
}

export const RESERVED_VARIABLES: readonly ReservedVariable[] = [
  {
    name: COMPLETE_MATCH_VARIABLE, kind: 'completeMatch', label: '完全匹配',
    upstream: 'platform/structuralsearch/source/com/intellij/structuralsearch/plugin/ui/Configuration.java:29',
    note: '整条模板自己；`within`/`context` 只允许写在这一档（StringToConstraintsTransformer.java:463-474）。',
  },
  {
    name: SCRIPT_LOG_VARIABLE, kind: 'scriptLog', label: '脚本日志',
    upstream: 'platform/structuralsearch/source/com/intellij/structuralsearch/impl/matcher/predicates/ScriptLog.java:18',
    note: '脚本约束里可用的日志变量（ScriptSupport.java:80 注入）。',
  },
]

/** 按名字取保留变量。 */
export function reservedVariable(name: string): ReservedVariable | null {
  return RESERVED_VARIABLES.find(entry => entry.name === name) ?? null
}

/** 这个名字是不是上游特判过的保留变量。 */
export function isReservedVariableName(name: string): boolean {
  return reservedVariable(name) !== null
}

/** 变量名是否合法（`TemplateTextLexer.flex:21-23` 的 `({ALPHA}|{DIGIT})+`）。 */
export function isVariableName(name: string): boolean {
  return /^[A-Za-z_0-9]+$/.test(name)
}

/**
 * 整段 `$name$` 是不是一个合法变量（`TemplateImplUtil.java:49-52`）：
 * 长度 > 2、首尾都是 `$`、中间那段是合法变量名。
 */
export function isValidVariableToken(text: string): boolean {
  if (text.length <= 2) return false
  if (!text.startsWith('$') || !text.endsWith('$')) return false
  return isVariableName(text.slice(1, -1))
}

/** 替换侧变量名（`ReplaceConfiguration.java:18` 的 `名字$replacement`）。 */
export function replacementVariableName(name: string): string {
  return name + REPLACEMENT_VARIABLE_SUFFIX
}

/** 是不是替换侧变量名。 */
export function isReplacementVariableName(name: string): boolean {
  return name.length > REPLACEMENT_VARIABLE_SUFFIX.length && name.endsWith(REPLACEMENT_VARIABLE_SUFFIX)
}

/** `$` 语法里一次扫描到的 token（`TemplateTextLexer.flex:27-29` 的三档）。 */
export interface DollarToken {
  kind: 'variable' | 'escape' | 'text'
  /** 变量名（`kind==='variable'` 时才有）。 */
  name: string
  start: number
  end: number
}

/**
 * 按上游 `TemplateTextLexer` 的三条规则扫 `$` 语法（flex 取**最长匹配**）：
 * `$$` → 转义美元（`:27`）、`$name$`（名字 `[A-Za-z_0-9]+`）→ 变量（`:28`）、其余单字符 → 文本（`:29`）。
 * 落单的 `$` 不是错误，它就是文本（上游同样如此）。
 */
export function scanDollarTokens(text: string): DollarToken[] {
  const tokens: DollarToken[] = []
  let i = 0
  while (i < text.length) {
    if (text[i] !== '$') { tokens.push({ kind: 'text', name: '', start: i, end: i + 1 }); i += 1; continue }
    if (text[i + 1] === '$') { tokens.push({ kind: 'escape', name: '', start: i, end: i + 2 }); i += 2; continue }
    const match = /^\$([A-Za-z_0-9]+)\$/.exec(text.slice(i))
    if (match) {
      tokens.push({ kind: 'variable', name: match[1]!, start: i, end: i + match[0].length })
      i += match[0].length
      continue
    }
    tokens.push({ kind: 'text', name: '', start: i, end: i + 1 })
    i += 1
  }
  return tokens
}

/** `$` 语法里按出现顺序去重的变量名。 */
export function dollarVariableNames(text: string): string[] {
  const names: string[] = []
  for (const token of scanDollarTokens(text)) {
    if (token.kind === 'variable' && !names.includes(token.name)) names.push(token.name)
  }
  return names
}

/**
 * 目标变量（上游 `'x` 是目标、`'_x` 不是；`StringToConstraintsTransformer.java:65-83`）。
 * 本仓 `$` 语法里用**下划线开头**对应上游那个 `'_` 前缀：`$_x$` 非目标，`$x$` 是目标。
 * 注意：上游 `'` 分支**不**剥 `_`（`:76` 只在 `criteria.charAt(index) == '_'` 时剥一次），
 * 所以 `'__context__` 的名字是 `_context__`，不是 `__context__`。
 */
export function targetOfRawName(rawName: string): { name: string; target: boolean } {
  if (!rawName.startsWith('_')) return { name: rawName, target: true }
  if (rawName.length === 1) return { name: '', target: false }
  return { name: rawName.slice(1), target: false }
}

/** 上游 `'` 语法扫出来的一次变量引用。 */
export interface TypedVariableRef {
  /** 变量名（`_` 前缀已按上游剥掉；匿名变量是 `_1`/`_2`…）。 */
  name: string
  /** 原文里 `'` 之后那段名字（含下划线）。 */
  raw: string
  /** 进不进用法树（`partOfSearchResults`）。 */
  target: boolean
  minOccurs: number
  maxOccurs: number
  greedy: boolean
  /** `'` 在 criteria 里的下标。 */
  start: number
  /** 名字结束的下标（不含量词）。 */
  end: number
}

/** 上游 `'` 语法的扫描结果。 */
export interface TypedScan {
  variables: TypedVariableRef[]
  issues: TemplateIssue[]
}

/** 量词/条件读取的跨引用状态。 */
interface SuffixState {
  seenRegexp: string | null
}

function isDigitChar(c: string | undefined): boolean {
  return c !== undefined && c >= '0' && c <= '9'
}

/** 读 `{` 量词的数字段，照 `StringToConstraintsTransformer.java:113-158`。 */
function readBraceQuantifier(
  text: string,
  after: number,
  issues: TemplateIssue[],
): { min: number; max: number; index: number; error: boolean } {
  let cursor = after
  let rawMin = -1
  let rawMax = -1
  while (cursor < text.length && isDigitChar(text[cursor])) {
    if (rawMin < 0) rawMin = 0
    rawMin = rawMin * 10 + (text.charCodeAt(cursor) - 48)
    if (rawMin > MAX_OCCURS) issues.push(issue('overflow', cursor, UP.overflow))
    cursor += 1
  }
  // Java 的 `ch` 是**跨循环存活**的局部量（`:43`）：数字读完停在哪个字符上就是它；
  // 读到串尾时 `ch` 保持上一次赋的值（`:117`/`:127` 的 while 条件短路）。
  let ch = cursor < text.length ? text[cursor]! : (cursor > after ? text[cursor - 1]! : '{')
  if (ch === ',') {
    let c2 = cursor + 1
    while (c2 < text.length && isDigitChar(text[c2])) {
      if (rawMax < 0) rawMax = 0
      rawMax = rawMax * 10 + (text.charCodeAt(c2) - 48)
      if (rawMax > MAX_OCCURS) issues.push(issue('overflow', c2, UP.overflow))
      c2 += 1
    }
    if (c2 < text.length) ch = text[c2]!
    else if (c2 > cursor + 1) ch = text[c2 - 1]!
    cursor = c2
  }
  else {
    rawMax = -2
  }
  if (ch !== '}') {
    if (rawMin < 0 && rawMax < 0) issues.push(issue('digitExpected', cursor, UP.digitExpected))
    else if (rawMax < 0) issues.push(issue('brace1Expected', cursor, UP.brace1Expected))
    else issues.push(issue('brace2Expected', cursor, UP.brace2Expected))
    return { min: 1, max: 1, index: cursor, error: true }
  }
  if (rawMin < 0 && rawMax < 0) {
    issues.push(issue('emptyQuantifier', cursor, UP.emptyQuantifier))
    return { min: 1, max: 1, index: cursor + 1, error: true }
  }
  const min = rawMin === -1 ? 0 : rawMin
  const max = rawMax === -1 ? MAX_OCCURS : rawMax === -2 ? min : rawMax
  return { min, max, index: cursor + 1, error: false }
}

/**
 * 读 `'x` 后面的量词 + 条件块，照 `StringToConstraintsTransformer.java:94-197`。
 * `index` 指向名字结束处；返回新游标、量词与这条引用上的问题。
 */
function readSuffix(
  text: string,
  index: number,
  name: string,
  firstReference: boolean,
  state: SuffixState,
): { index: number; issues: TemplateIssue[]; minOccurs: number; maxOccurs: number; greedy: boolean } {
  const issues: TemplateIssue[] = []
  let i = index
  let minOccurs = 1
  let maxOccurs = 1
  let greedy = true
  let quantified = false
  const ch = text[i]

  if (ch === '+') { maxOccurs = MAX_OCCURS; i += 1; quantified = true }
  else if (ch === '?') { minOccurs = 0; i += 1; quantified = true }
  else if (ch === '*') { minOccurs = 0; maxOccurs = MAX_OCCURS; i += 1; quantified = true }
  else if (ch === '{') {
    quantified = true
    const brace = readBraceQuantifier(text, i + 1, issues)
    i = brace.index
    if (brace.error) return { index: i, issues, minOccurs: 1, maxOccurs: 1, greedy: true }
    minOccurs = brace.min
    maxOccurs = brace.max
  }

  // 量词之后那个 `?` 是「非贪婪」（`:160-166`），不是「可缺」。
  if (text[i] === '?') { greedy = false; i += 1 }

  // 量词只允许写在首次引用上（`:179-181`）。
  if (quantified && !firstReference) {
    issues.push(issue('constraintOnlyOnFirstReference', i, UP.constraintOnlyOnFirstReference))
  }

  if (text[i] === ':') {
    i += 1
    if (i >= text.length) {
      issues.push(issue('conditionExpected', i, UP.conditionExpected, ':'))
      return { index: i, issues, minOccurs, maxOccurs, greedy }
    }
    if (text[i] === ':') {
      // `::` 是转义的双冒号（`:187-190`），不是条件，一个字符都不消费。
      return { index: i, issues, minOccurs, maxOccurs, greedy }
    }
    if (!firstReference) {
      issues.push(issue('constraintOnlyOnFirstReference', i, UP.constraintOnlyOnFirstReference))
    }
    const block = readConditionBlock(text, i, name, state)
    issues.push(...block.issues)
    i = block.index
  }

  return { index: i, issues, minOccurs, maxOccurs, greedy }
}

/** 条件块 `[ … ]`，照 `handleTypedVarCondition` 的方括号分支（`StringToConstraintsTransformer.java:265-295`）。 */
function readConditionBlock(
  text: string,
  index: number,
  name: string,
  state: SuffixState,
): { index: number; issues: TemplateIssue[] } {
  const issues: TemplateIssue[] = []
  let i = index + 1
  let spaces = 0
  while (text[i] === ' ') { spaces += 1; i += 1 }
  let quoted = false
  let closed = false
  let end = i - 1
  while (end + 1 < text.length) {
    end += 1
    if (text[end - 1] !== '\\') {
      const c = text[end]!
      if (c === '"') quoted = !quoted
      else if (c === ']' && !quoted) {
        let j = 1
        while (j <= spaces && text[end - j] === ' ') j += 1
        if (j - 1 === spaces) { end -= spaces; closed = true; break }
      }
    }
  }
  if (quoted) issues.push(issue('valueExpected', index, UP.valueExpected, '"'))
  else if (!closed) issues.push(issue('valueExpected', index, UP.valueExpected, ' '.repeat(spaces) + ']'))
  if (i > end) {
    issues.push(issue('conditionExpected', index, UP.conditionExpected, '['))
    return { index: end + spaces + 1, issues }
  }
  issues.push(...checkCondition(text.slice(i, end), name, state, index))
  return { index: end + spaces + 1, issues }
}

/**
 * 条件文本的语法与合法性，照 `parseCondition`（`StringToConstraintsTransformer.java:331-410`）
 * 与 `handleOption`（`:412-484`）。`base` 只用于把问题定位回模板原文。
 */
function checkCondition(condition: string, name: string, state: SuffixState, base: number): TemplateIssue[] {
  const issues: TemplateIssue[] = []
  let text = ''
  let invert = false
  let optionExpected = true
  let i = 0

  const handle = (option: string, argument: string, negated: boolean, at: number): void => {
    issues.push(...checkOption(option, argument, negated, name, state, at))
  }

  while (i < condition.length) {
    const c = condition[i]!
    if (c === ' ' || c === '\t' || c === '\n' || c === '\r') {
      if (!text) { i += 1; continue }
      handle(text, '', invert, base + i)
      text = ''
      optionExpected = false
      i += 1
      continue
    }
    if (c === '(') {
      if (!text) {
        issues.push(issue('conditionNameMissing', base + i, UP.conditionNameMissing))
        return issues
      }
      const option = text
      if (!option.startsWith(CUSTOM_OPTION_PREFIX) && !isKnownOption(option)) {
        issues.push(issue('unrecognizedOption', base + i, UP.unrecognizedOption, option))
        return issues
      }
      text = ''
      let j = i + 1
      let innerSpaces = 0
      while (condition[j] === ' ') { innerSpaces += 1; j += 1 }
      let quoted = false
      let closed = false
      let body = ''
      let k = j
      while (k < condition.length) {
        const d = condition[k]!
        if (condition[k - 1] !== '\\') {
          if (d === '"') quoted = !quoted
          else if (d === ')' && !quoted) {
            let m = 1
            while (m <= innerSpaces && condition[k - m] === ' ') m += 1
            if (m - 1 === innerSpaces) { closed = true; break }
          }
        }
        body += d
        k += 1
      }
      if (!body.trim()) {
        issues.push(issue('argumentExpected', base + i, UP.argumentExpected, option))
        return issues
      }
      if (quoted) {
        issues.push(issue('valueExpected', base + i, UP.valueExpected, '"'))
        return issues
      }
      if (!closed) {
        issues.push(issue('valueExpected', base + i, UP.valueExpected, ' '.repeat(innerSpaces) + ')'))
        return issues
      }
      handle(option, body.trim(), invert, base + i)
      text = ''
      invert = false
      optionExpected = false
      i = closed ? k + 1 : k
      continue
    }
    if (c === '&') {
      if (text) {
        handle(text, '', invert, base + i)
        optionExpected = false
      }
      if (i + 1 >= condition.length || condition[i + 1] !== '&' || optionExpected) {
        issues.push(issue('unexpectedValue', base + i, UP.unexpectedValue, '&'))
        return issues
      }
      text = ''
      invert = false
      optionExpected = true
      i += 2
      continue
    }
    if (!optionExpected) {
      issues.push(issue('valueExpected', base + i, UP.valueExpected, '&&'))
      return issues
    }
    if (c === '!') {
      if (text) {
        issues.push(issue('unexpectedValue', base + i, UP.unexpectedValue, '!'))
        return issues
      }
      invert = !invert
      i += 1
      continue
    }
    text += c
    i += 1
  }

  if (text) handle(text, '', invert, base + condition.length)
  else if (invert) issues.push(issue('conditionExpected', base + condition.length, UP.conditionExpected, '!'))
  else if (optionExpected) {
    issues.push(issue('conditionExpected', base + condition.length, UP.conditionExpected,
      condition.length === 0 ? '[' : '&&'))
  }
  return issues
}

function isKnownOption(option: string): boolean {
  return (KNOWN_OPTIONS as readonly string[]).includes(option)
}

/** 单个选项的合法性，照 `handleOption`（`StringToConstraintsTransformer.java:412-484`）。 */
function checkOption(
  option: string,
  argument: string,
  invert: boolean,
  name: string,
  state: SuffixState,
  at: number,
): TemplateIssue[] {
  const issues: TemplateIssue[] = []
  if (option === 'regex' || option === 'regexw') {
    const body = argument.startsWith('*') ? argument.slice(1) : argument
    if (state.seenRegexp !== null && state.seenRegexp !== body) {
      issues.push(issue('twoDifferentTypeConstraints', at, UP.twoDifferentTypeConstraints))
    }
    state.seenRegexp = body
    if (body) {
      try { new RegExp(body) }
      catch (error) { issues.push(issue('invalidRegex', at, UP.invalidRegex, (error as Error).message)) }
    }
    return issues
  }
  if (option === 'script') {
    if (invert) issues.push(issue('cannotInvert', at, UP.cannotInvert, option))
    return issues
  }
  if (option === 'context') {
    if (invert) issues.push(issue('cannotInvert', at, UP.cannotInvert, option))
    if (name !== COMPLETE_MATCH_VARIABLE) {
      issues.push(issue('onlyApplicableToCompleteMatch', at, UP.onlyApplicableToCompleteMatch, option))
    }
    return issues
  }
  if (option === 'within') {
    if (name !== COMPLETE_MATCH_VARIABLE) {
      issues.push(issue('onlyApplicableToCompleteMatch', at, UP.onlyApplicableToCompleteMatch, option))
    }
    return issues
  }
  if (option.startsWith(CUSTOM_OPTION_PREFIX)) {
    if (invert) issues.push(issue('cannotInvert', at, UP.cannotInvert, option))
    return issues
  }
  if (!isKnownOption(option)) issues.push(issue('unrecognizedOption', at, UP.unrecognizedOption, option))
  return issues
}

/** 上游 `handleCharacterLiteral` 认得的那几种字符字面量（`StringToConstraintsTransformer.java:215-241`）。 */
function characterLiteralLength(text: string, index: number): number {
  const next = text[index + 1]
  if (next === "'") return 2
  if (text[index + 2] === "'") return 3
  if (next === '\\' && text[index + 3] === "'") return 4
  if (next === '\\' && text[index + 2] === 'u' && text[index + 7] === "'") return 8
  return 0
}

function anonymousName(raw: string, next: () => string): { name: string; target: boolean } {
  if (!raw.startsWith('_')) return { name: raw, target: true }
  if (raw.length === 1) return { name: next(), target: false }
  return { name: raw.slice(1), target: false }
}

/**
 * 扫上游 `'Var` 语法（`transformCriteria` 的 `'` 分支，`StringToConstraintsTransformer.java:53-207`）：
 * 变量名、匿名变量编号（`'_` → `_1`/`_2`…，`:70-77`）、目标标记（`:65-83`）、量词与条件块。
 * 模板**开头**的 `[cond]` 作用在「整个模板」上（`:45-49`）。
 * `'_Args*` 就是这里的一个普通变量 —— 没有「预定义列表变量」这回事。
 */
export function scanTypedVariables(criteria: string): TypedScan {
  const variables: TypedVariableRef[] = []
  const issues: TemplateIssue[] = []
  const state: SuffixState = { seenRegexp: null }
  const created = new Set<string>()
  let anonymous = 0
  let targetFound = false
  let i = 0

  if (criteria[0] === '[') {
    const block = readConditionBlock(criteria, 0, COMPLETE_MATCH_VARIABLE, state)
    issues.push(...block.issues)
    i = block.index
  }

  while (i < criteria.length) {
    if (criteria[i] !== "'") { i += 1; continue }
    const literal = characterLiteralLength(criteria, i)
    if (literal > 0) { i += literal; continue }
    const start = i
    i += 1
    let end = i
    while (end < criteria.length && /[A-Za-z0-9_$]/.test(criteria[end]!)) end += 1
    if (end === i) {
      issues.push(issue('characterExpected', start, UP.characterExpected))
      continue
    }
    const raw = criteria.slice(i, end)
    const { name, target } = anonymousName(raw, () => { anonymous += 1; return `_${anonymous}` })
    i = end
    const first = !created.has(name)
    if (first) {
      created.add(name)
      if (target) {
        if (targetFound) issues.push(issue('onlyOneTarget', start, UP.onlyOneTarget))
        targetFound = true
      }
    }
    const suffix = readSuffix(criteria, i, name, first, state)
    issues.push(...suffix.issues)
    variables.push({
      name, raw, target, minOccurs: suffix.minOccurs, maxOccurs: suffix.maxOccurs, greedy: suffix.greedy,
      start, end: i,
    })
    i = suffix.index
  }
  return { variables, issues }
}

/** `$` 语法模板的校验结果。 */
export interface DollarTemplateValidation {
  ok: boolean
  issues: TemplateIssue[]
  /** 按出现顺序去重的变量名（原文名字，含 `_` 前缀）。 */
  variables: string[]
  /** 模板里出现的保留变量名。 */
  reserved: string[]
  /** 条件块里第一个 `regex(...)` 的正则（供面板回显）。 */
  regexp: string | null
}

export interface DollarTemplateOptions {
  /** 替换串；给了就一并查「替换变量未定义」。 */
  replacement?: string
  /** 已定义脚本的替换变量名（本仓只有文本定义，留这个口给上游同一条判定）。 */
  definedVariables?: readonly string[]
  /** 搜索侧/替换侧是不是表达式；一起判 `:644` 那两条文案。 */
  searchIsExpression?: boolean
  replaceIsExpression?: boolean
  /** 文件类型名；给了就查 `replacement.not.supported.for.filetype`（`StructuralSearchProfile.java:241`）。 */
  fileType?: string
  /** 该文件类型支不支持替换。 */
  replacementSupported?: boolean
}

/**
 * 校验一段 `$Var$` 形态的模板（本仓既有语法）。
 *
 * **本通道不做「目标变量唯一」**：那条是上游 `'` 语法的规则（`StringToConstraintsTransformer.java:174-177`，
 * 一个模板只允许一个 `'x` 进用法树），本仓的 `$x$ + $y$` 本来就是多个捕获组，
 * 套上去会把能用的模板全挡掉。目标/`_` 前缀只在上游通道（`validateUpstreamTemplate`）里判。
 *
 * 判据逐条给坐标：
 *   · `__$_` 前缀泄漏 → `PatternCompiler.checkForUnknownVariables:177-199`（裸 `MalformedPatternException`，
 *     对话框兜底成 `this.pattern.is.malformed.message`，`StructuralSearchDialog.java:958-962`）；
 *   · 量词/条件的语法错 → 见 `readSuffix`/`checkCondition` 上方的坐标；
 *   · 替换侧变量 → `Replacer.java:310-321`；
 *   · 表达式错配 → `JavaStructuralSearchProfile.java:644`、`KotlinStructuralSearchProfile.kt:255`。
 */
export function validateDollarTemplate(text: string, options: DollarTemplateOptions = {}): DollarTemplateValidation {
  const issues: TemplateIssue[] = []
  const tokens = scanDollarTokens(text)
  const variables: string[] = []
  const reserved: string[] = []
  const state: SuffixState = { seenRegexp: null }
  const created = new Set<string>()

  if (text.includes(TYPED_VAR_PREFIX)) {
    issues.push(issue('malformed', text.indexOf(TYPED_VAR_PREFIX), UP.prefixLeak))
  }

  for (let index = 0; index < tokens.length; ++index) {
    const token = tokens[index]!
    if (token.kind !== 'variable') continue
    if (!variables.includes(token.name)) variables.push(token.name)
    if (isReservedVariableName(token.name) && !reserved.includes(token.name)) reserved.push(token.name)
    const first = !created.has(token.name)
    created.add(token.name)
    const suffix = readSuffix(text, token.end, token.name, first, state)
    issues.push(...suffix.issues)
    // 跳过被约束消费掉的那一段，免得把条件块里的 `$` 又当变量扫一遍。
    while (index + 1 < tokens.length && tokens[index + 1]!.start < suffix.index) index += 1
  }

  const validation: DollarTemplateValidation = {
    ok: issues.length === 0, issues, variables, reserved, regexp: state.seenRegexp,
  }
  if (options.fileType !== undefined && options.replacementSupported === false) {
    issues.push(issue('replacementNotSupported', -1, UP.replacementNotSupported, options.fileType))
    validation.ok = false
  }
  if (options.searchIsExpression !== undefined && options.replaceIsExpression !== undefined) {
    if (options.searchIsExpression && !options.replaceIsExpression) {
      issues.push(issue('replacementNotExpression', -1, UP.replacementNotExpression))
      validation.ok = false
    }
    else if (!options.searchIsExpression && options.replaceIsExpression) {
      issues.push(issue('searchNotExpression', -1, UP.searchNotExpression))
      validation.ok = false
    }
  }
  if (options.replacement) {
    for (const name of dollarVariableNames(options.replacement)) {
      const defined = options.definedVariables ?? []
      if (!variables.includes(name) && !defined.includes(name)) {
        issues.push(issue('replacementVariableNotDefined', -1, UP.replacementVariableNotDefined, name))
        validation.ok = false
      }
    }
  }
  return validation
}

/**
 * 上游 `'Var` 语法模板的校验（`transformCriteria` 那一条完整通道）：
 * `scanTypedVariables` 的那些判定 + `__$_` 前缀泄漏 + 保留变量名登记。
 * 保留变量在 `'` 语法里**不是变量引用**：`__context__` 出现在 `script(...)` 的脚本文本里
 * （例：`!__context__.interface`，`JavaPredefinedConfigurations.java:96`），所以按"整段文本里出现过"登记。
 */
export function validateUpstreamTemplate(criteria: string): TypedScan & { ok: boolean; reserved: string[] } {
  const scan = scanTypedVariables(criteria)
  const reserved = RESERVED_VARIABLES
    .filter(entry => new RegExp(`(^|[^A-Za-z0-9_$])${entry.name}([^A-Za-z0-9_$]|$)`).test(criteria))
    .map(entry => entry.name)
  if (criteria.includes(TYPED_VAR_PREFIX)) {
    scan.issues.push(issue('malformed', criteria.indexOf(TYPED_VAR_PREFIX), UP.prefixLeak))
  }
  return { ...scan, ok: scan.issues.length === 0, reserved }
}

/** 首条失败（面板只显示一条，与上游把首个异常弹出来同一口径）。 */
export function firstIssue(result: { issues: readonly TemplateIssue[] }): TemplateIssue | null {
  return result.issues[0] ?? null
}

/**
 * 递归引用的判定（`Matcher.buildMatcher`，`Matcher.java:95-105`）：
 * `within( 名字 )` / `ref( 名字 )` 按**模板名**去查配置，查不到 → `error.configuration.0.not.found`；
 * 名字已经在当前解析栈里 → `error.pattern.recursively.references.itself`。
 * 输入是"名字 → 它引用了哪些名字"的邻接表（本仓没有配置管理器，所以由调用方给）。
 */
export function checkRecursiveReference(
  name: string,
  references: Readonly<Record<string, readonly string[]>>,
  stack: readonly string[] = [],
): TemplateIssue | null {
  if (stack.includes(name)) return issue('recursiveReference', -1, UP.recursiveReference)
  const targets = references[name]
  if (targets === undefined) return issue('configurationNotFound', -1, UP.configurationNotFound, name)
  for (const target of targets) {
    const found = checkRecursiveReference(target, references, [...stack, name])
    if (found) return found
  }
  return null
}

/** 上游 `JavaStructuralSearchProfile.checkModifier` 认的那批修饰符（`:671-681`）。 */
export const MODIFIER_NAMES: readonly string[] = [
  'public', 'protected', 'private', 'static', 'final', 'abstract', 'synchronized', 'native',
  'transient', 'volatile', 'strictfp', 'default', 'sealed', 'non-sealed',
  'Instance', 'packageLocal',
]

/**
 * `@Modifier("…")` 的取值校验（`JavaStructuralSearchProfile.java:671-681`）。
 * 不在这批里 → `invalid.modifier.type`（`SSRBundle.properties:269`）。
 */
export function validateModifier(name: string): TemplateIssue | null {
  if (MODIFIER_NAMES.includes(name)) return null
  return issue('invalidModifierType', -1, UP.invalidModifierType, name)
}

/** 「一个都没匹配到」的提示（`PatternCompiler.java:124-126`，只在 `checkForErrors` 档出现）。 */
export function willNotFindAnything(scopeName: string): TemplateIssue {
  return issue('willNotFindAnything', -1, UP.willNotFindAnything, scopeName)
}

/**
 * 任务书点名的那一族名字在基准树里的核实结果。**这不是一份预定义表** ——
 * `verified: false` 表示"上游没有把这个名字特判成保留变量"，
 * 它就是一个普通变量名（用户自己取的），语义全靠量词与条件块。
 */
export interface ArgsFamilyProbe {
  name: string
  verified: boolean
  evidence: string
}

export const ARGS_FAMILY_PROBE: readonly ArgsFamilyProbe[] = [
  { name: '$Args$', verified: false, evidence: "全树 grep '\\$Args\\$' 零命中；普通变量名，列表语义靠 `*`/`+`（StringToConstraintsTransformer.java:100-112）" },
  { name: '$ArgsCount$', verified: false, evidence: "全树 grep 'ArgsCount' 唯一命中在 python/python-psi-impl/.../PyFunctionInsertHandler.java:58 的局部量，与结构搜索无关" },
  { name: '$Field$', verified: false, evidence: '命中全是用户模板与 .idea/inspectionProfiles 里的配置文本，非保留变量' },
  { name: '$Method$', verified: false, evidence: "同上；预定义模板里的写法是 'Method（JavaPredefinedConfigurations.java:89）" },
  { name: "'_ExceptionConstructorArgs*", verified: true, evidence: '真实出现点：java/structuralsearch-java/src/com/intellij/structuralsearch/JavaPredefinedConfigurations.java:387' },
]

/** 上游坐标常量表：只放本文件引用到的行，便于核对与测试。 */
export const UP = {
  characterExpected: 'platform/structuralsearch/source/com/intellij/structuralsearch/impl/matcher/compiler/StringToConstraintsTransformer.java:63',
  overflow: 'platform/structuralsearch/source/com/intellij/structuralsearch/impl/matcher/compiler/StringToConstraintsTransformer.java:120,130',
  digitExpected: 'platform/structuralsearch/source/com/intellij/structuralsearch/impl/matcher/compiler/StringToConstraintsTransformer.java:139',
  brace1Expected: 'platform/structuralsearch/source/com/intellij/structuralsearch/impl/matcher/compiler/StringToConstraintsTransformer.java:141',
  brace2Expected: 'platform/structuralsearch/source/com/intellij/structuralsearch/impl/matcher/compiler/StringToConstraintsTransformer.java:144',
  emptyQuantifier: 'platform/structuralsearch/source/com/intellij/structuralsearch/impl/matcher/compiler/StringToConstraintsTransformer.java:148',
  onlyOneTarget: 'platform/structuralsearch/source/com/intellij/structuralsearch/impl/matcher/compiler/StringToConstraintsTransformer.java:175',
  constraintOnlyOnFirstReference: 'platform/structuralsearch/source/com/intellij/structuralsearch/impl/matcher/compiler/StringToConstraintsTransformer.java:180,193',
  conditionExpected: 'platform/structuralsearch/source/com/intellij/structuralsearch/impl/matcher/compiler/StringToConstraintsTransformer.java:185,250,292,311,407,409',
  conditionNameMissing: 'platform/structuralsearch/source/com/intellij/structuralsearch/impl/matcher/compiler/StringToConstraintsTransformer.java:344',
  unrecognizedOption: 'platform/structuralsearch/source/com/intellij/structuralsearch/impl/matcher/compiler/StringToConstraintsTransformer.java:347',
  valueExpected: 'platform/structuralsearch/source/com/intellij/structuralsearch/impl/matcher/compiler/StringToConstraintsTransformer.java:290,373,393',
  unexpectedValue: 'platform/structuralsearch/source/com/intellij/structuralsearch/impl/matcher/compiler/StringToConstraintsTransformer.java:386,396',
  argumentExpected: 'platform/structuralsearch/source/com/intellij/structuralsearch/impl/matcher/compiler/StringToConstraintsTransformer.java:372',
  cannotInvert: 'platform/structuralsearch/source/com/intellij/structuralsearch/impl/matcher/compiler/StringToConstraintsTransformer.java:456,471,478',
  onlyApplicableToCompleteMatch: 'platform/structuralsearch/source/com/intellij/structuralsearch/impl/matcher/compiler/StringToConstraintsTransformer.java:465,473',
  twoDifferentTypeConstraints: 'platform/structuralsearch/source/com/intellij/structuralsearch/impl/matcher/compiler/StringToConstraintsTransformer.java:320',
  invalidRegex: 'platform/structuralsearch/source/com/intellij/structuralsearch/impl/matcher/compiler/StringToConstraintsTransformer.java:491',
  prefixLeak: 'platform/structuralsearch/source/com/intellij/structuralsearch/impl/matcher/compiler/PatternCompiler.java:177-199',
  recursiveReference: 'platform/structuralsearch/source/com/intellij/structuralsearch/Matcher.java:98',
  configurationNotFound: 'platform/structuralsearch/source/com/intellij/structuralsearch/Matcher.java:103',
  replacementVariableNotDefined: 'platform/structuralsearch/source/com/intellij/structuralsearch/plugin/replace/impl/Replacer.java:313',
  replacementNotExpression: 'java/structuralsearch-java/src/com/intellij/structuralsearch/JavaStructuralSearchProfile.java:644',
  searchNotExpression: 'plugins/kotlin/code-insight/structural-search-k2/src/org/jetbrains/kotlin/idea/k2/codeinsight/structuralsearch/KotlinStructuralSearchProfile.kt:255',
  replacementNotSupported: 'platform/structuralsearch/source/com/intellij/structuralsearch/StructuralSearchProfile.java:241',
  invalidModifierType: 'java/structuralsearch-java/src/com/intellij/structuralsearch/JavaStructuralSearchProfile.java:680',
  willNotFindAnything: 'platform/structuralsearch/source/com/intellij/structuralsearch/impl/matcher/compiler/PatternCompiler.java:125',
} as const