// 结构化模板的**变量约束**（上游 `MatchVariableConstraint` 的文本子集）。
//
// 上游那份约束模型有一大堆字段（`platform/structuralsearch/source/com/intellij/structuralsearch/
// MatchVariableConstraint.java:29-56`）：regExp / invertRegExp / wholeWordsOnly / minCount /
// maxCount / greedy / reference / within / contains / script / exprType / formalArgType …。
// 其中**要 PSI 或脚本宿主**的那些在本仓没有落点（见文末「不做」），本模块只接文本层能
// 真正兑现的那几项，并且每一项都对应上游的一条具体判定：
//
//   · **重复次数** min/maxCount —— 上游在 `StringToConstraintsTransformer.java:94-158` 把变量名
//     后面紧跟的 `+` / `?` / `*` / `{n}` / `{n,m}` / `{,m}` 读成 minOccurs/maxOccurs
//     （`+` → 上界 MAX_VALUE、`?` → 下界 0、`*` → 两者、`{n,m}` → 逐位读数字），
//     紧跟其后的第二个 `?` 是 `greedy = false`（`:160-166`）。
//     语义由 `SubstitutionHandler.java:264-269` 的 `validate(context, matchedOccurs)` 兜底：
//     `minOccurs > matchedOccurs` 失败、`maxOccurs < matchedOccurs` 失败 —— 即"这个变量在
//     匹配到的代码里要出现几次"。在语法树上它数的是**同级兄弟节点**（`matchSequentially` 遍历
//     `matchNodes`，`VARS_DELIM_FILTER` 滤掉逗号这类分隔符，`:45-56`/`:318`），文本层的等价物
//     就是「一段按逗号分隔的标识符列表」。
//   · **名字正则** regExp —— 上游 `RegExpPredicate.java:101-120` 的 `doMatch` 用
//     `matcher.matches()`，即**整段文本**必须整体匹配该正则（不是 find）；失败还会退一步试
//     `getAlternativeText`（`:86-93`）。文本层没有"节点的另一种文本形态"，只保留整段匹配这一半。
//   · **取反** invertRegExp —— 上游的 `!` 前缀（`StringToConstraintsTransformer.java:247-252`
//     置 `setInvertRegExp(true)`）。
//   · **全词** wholeWordsOnly —— 上游 `RegExpPredicate.java:54-56` 把正则包成
//     `.*?\b(?:REAL)\b.*?` 再 `matches()`；文本层等价就是捕获组两端各一个 `\b`。
//
// **不做**（逐条对应上游能力，本仓没有落点，不做假开关）：
//   · `ref`（`MatchVariableConstraint.java:37-39`）/ `exprtype` / `formal`（`:41-49`）—— 比对的是**引用到的
//     元素**与**表达式/形参类型**，要语法树与类型推导；结构化搜索在本仓只走宿主文本扫描这条通道，
//     拿不到类型信息；
//   · `script` —— 脚本约束存在基类字段 `scriptCodeConstraint`（`NamedScriptableDefinition.java:17`，
//     setter `:43-45`；`MatchVariableConstraint.java:24` 继承它），跑的是 Groovy 宿主
//     （`StructuralSearchScriptEngine`），本仓没有脚本引擎，也不会为了这一档去 eval 用户模板；
//   · `within` / `context`（`MatchVariableConstraint.java:51,56`）—— 上游**只允许写在「整个模板」上**
//     （`StringToConstraintsTransformer.java:463-466`、`:470-474` 都拿 `Configuration.CONTEXT_VAR_NAME`
//     比对变量名，不等就抛 `error.only.applicable.to.complete.match`，`SSRBundle.properties:272`），
//     所以这两个选项在变量后缀上是**报错**而不是"没落点"；`within` 在整模板档有文本层等价物，
//     模型与求值在 `src/structuralSearchModifiers.ts`；
//   · `contains`（`:52-53`）—— **已接**：变量级的子串/子模板包含判定，做完整捕获段再判，
//     所以不进正则，见 `src/structuralSearchModifiers.ts` 的 `containsHolds`；
//   · `partOfSearchResults`（target，即上游 `_$x$` 的下划线前缀）—— 那是"这条要不要进用法树"
//     的标记，本仓没有用法视图；
//   · **裸正则形式**（`StringToConstraintsTransformer.java:302-328` 的 `handleRegExp`：变量名
//     后面第一个非空白 token 直接当正则）—— 上游的变量在用户输入里是引号前缀的 `'x`，所以
//     "变量后面紧跟的 token" 一定是约束；本仓的用户语法是 `$x$` 本身，后面紧跟的普通文本就是
//     字面量，裸正则形式会把字面文本悄悄吃掉。**故意不接**，只保留方括号条件形式。
//
// 条件语法照 `parseCondition`（`StringToConstraintsTransformer.java:331-410`）：
// `[` 选项 [`&&` 选项]… `]`，选项是 `名字` 或 `!名字` 或 `名字(参数)`，参数里可带引号。

/** 捕获组里那个"标识符"的词法（与 `structuralSearch.ts` 里的 IDENTIFIER 同一份口径）。 */
export const CONSTRAINT_IDENTIFIER = '[A-Za-z_$][\\w$]*'

/** 无界重复的上界。与上游 `Integer.MAX_VALUE`（`:101`）同一个意思。 */
export const UNLIMITED = Number.POSITIVE_INFINITY

export interface VariableConstraint {
  /** 变量名（不含 `$`）。 */
  name: string
  /** 至少匹配几项。上游 `setMinCount`（`MatchVariableConstraint.java:222-224`）。 */
  minOccurs: number
  /** 至多匹配几项，`UNLIMITED` = 不限。上游 `setMaxCount`（`:230-232`）。 */
  maxOccurs: number
  /** false = 非贪婪。上游 `setGreedy(false)`（`:192`）。 */
  greedy: boolean
  /** 名字必须整体匹配的正则；null = 不限。上游 `setRegExp`（`:198-200`）。 */
  regexp: string | null
  /** 取反：匹配**不**满足 `regexp` 的名字。上游 `setInvertRegExp(true)`（`:206-208`）。 */
  invertRegExp: boolean
  /** 名字两端必须是词边界。上游 `setWholeWordsOnly(true)`（`:316-318`）。 */
  wholeWordsOnly: boolean
  /**
   * 子树修饰符：变量的**捕获段里还要含**另一个子模板的命中。上游 `setContainsConstraint`
   * （字段 `MatchVariableConstraint.java:52-53`，写入点 `StringToConstraintsTransformer.java:459-461`）。
   * 上游那一侧的谓词是死代码（`ContainsPredicate.java:12-18`：构造器把参数丢掉、`match` 恒 `false`），
   * 所以这里按**面板承诺的语义**实现（子串包含判定），求值在 `src/structuralSearchModifiers.ts`，
   * 不进正则 —— 正则只做"这段是不是一个标识符"，包含判定要看完整个捕获段。
   */
  contains: string | null
  /** `!contains(...)`。上游 `setInvertContainsConstraint`（`:461`）+ `NotPredicate` 包裹（`PatternCompiler.java:507-509`）。 */
  invertContains: boolean
}

export type ConstraintResult =
  | { ok: true; constraint: VariableConstraint }
  | { ok: false; error: string }

function constraint(name: string): VariableConstraint {
  return {
    name, minOccurs: 1, maxOccurs: 1, greedy: true, regexp: null, invertRegExp: false, wholeWordsOnly: false,
    contains: null, invertContains: false,
  }
}

/** 上游认识的选项名（`StringToConstraintsTransformer.java:20-31` 的 knownOptions）。 */
const KNOWN_OPTIONS = ['ref', 'regex', 'regexw', 'exprtype', 'formal', 'script', 'contains', 'within', 'context'] as const

/** 本仓文本层真正实现了的选项（其余解析得出来但会明说"没落点"）。 */
const SUPPORTED_OPTIONS = ['regex', 'regexw', 'contains'] as const

type SupportedOption = (typeof SUPPORTED_OPTIONS)[number]

function isSupported(name: string): name is SupportedOption {
  return (SUPPORTED_OPTIONS as readonly string[]).includes(name)
}

/**
 * 没实现的选项按上游的两类失败分别报：
 *   · `within` / `context` 在上游**不是变量档的选项** —— 写在变量上时
 *     `StringToConstraintsTransformer.java:463-466`、`:470-474` 拿 `Configuration.CONTEXT_VAR_NAME`
 *     （`plugin/ui/Configuration.java:29` 的 `"__context__"`）比对，不等就抛
 *     `error.only.applicable.to.complete.match`（`SSRBundle.properties:272`
 *     "Constraint ''{0}'' is only applicable to Complete Match"）；本仓的「整个模板」档
 *     等价物在 `src/structuralSearchModifiers.ts`；
 *   · 其余（`ref`/`exprtype`/`formal`/`script`）是真的没有落点（要语法树 / 类型 / 脚本宿主）。
 */
function unavailableMessage(option: string): string {
  if (option === 'within' || option === 'context') {
    return `选项 \`${option}\` 只适用于「整个模板」那一档（上游同一条报错，见 SSRBundle.properties:272），变量后缀上不接受。`
  }
  return `选项 \`${option}\` 要 PSI 或脚本宿主，文本子集没有落点。`
}

/**
 * 读重复次数后缀。`index` 指向 `$x$` 之后第一个字符。
 * 返回 min/max/greedy 与**新的游标**（没读到量词时游标不变）。
 *
 * 逐位照 `StringToConstraintsTransformer.java:98-158`：量词缺失时 min=max=1（默认），
 * `{n}` 与 `{n,}` 分别是上界缺失 → MAX_VALUE（`:155`），`{,m}` 是下界缺失 → 0（`:152`）。
 */
function readQuantifier(
  text: string,
  index: number,
  into: VariableConstraint,
): { index: number; error?: string } {
  const ch = text[index]
  if (ch === '+') { into.maxOccurs = UNLIMITED; index++; }
  else if (ch === '?') { into.minOccurs = 0; index++; }
  else if (ch === '*') { into.minOccurs = 0; into.maxOccurs = UNLIMITED; index++; }
  else if (ch === '{') {
    const close = text.indexOf('}', index + 1)
    if (close < 0) return { index, error: '重复次数缺 `}`。' }
    const body = text.slice(index + 1, close)
    // 逗号两段：下界可空（→0）、上界可空（→不限），空段按上游 `-1` 哨兵处理（`:147-156`）。
    const [rawMin, rawMax] = body.split(',')
    const min = rawMin === undefined || rawMin === '' ? 0 : Number(rawMin)
    const max = body.includes(',') ? (rawMax === undefined || rawMax === '' ? UNLIMITED : Number(rawMax)) : min
    if (Number.isNaN(min) || (max !== UNLIMITED && Number.isNaN(max))) return { index, error: `重复次数 \`${body}\` 不是数字。` }
    if (max !== UNLIMITED && min > max) return { index, error: `重复次数下界 ${min} 大于上界 ${max === UNLIMITED ? '∞' : max}。` }
    into.minOccurs = min
    into.maxOccurs = max
    index = close + 1
  } else {
    return { index }
  }
  // 量词之后那个 `?` 是"非贪婪"（`:160-166`），不是"可缺" —— 后者已经被上面读走了。
  if (text[index] === '?') { into.greedy = false; index++ }
  return { index }
}

/** 读一个括号参数里的条件值，允许引号（上游 `:351-371` 的 quoted 处理）。 */
function readConditionArgument(text: string, start: number): { value: string; index: number; error?: string } {
  let quoted = false
  let value = ''
  let i = start
  for (; i < text.length; ++i) {
    const ch = text[i]!
    if (ch === '"') { quoted = !quoted; value += ch; continue }
    if (ch === ')' && !quoted) return { value: value.trim(), index: i + 1 }
    value += ch
  }
  return { value, index: i, error: '条件缺右括号 `)`。' }
}

/**
 * 解析 `[...]` 条件块（`parseCondition`，`StringToConstraintsTransformer.java:331-410`）。
 * `index` 指向 `[`。空条件块在上游是 `error.expected.condition`（`:409`），这里同样报错。
 */
function readConditions(text: string, index: number, into: VariableConstraint): { index: number; error?: string } {
  let i = index + 1
  let pending = ''
  let invert = false
  let sawAnything = false
  /** `&&` 之后必须还有选项（上游 `optionExpected`，`StringToConstraintsTransformer.java:335`）。 */
  let sawAmpersand = false

  const flush = (): string | undefined => {
    const option = pending.trim()
    pending = ''
    const wasInvert = invert
    invert = false
    // 空选项名不算"读到了东西"（上游 `:403-405` 是"有 leftover 才处理"，`:409` 才报空条件）。
    if (!option) return wasInvert ? '条件里不能只有 `!`。' : undefined
    sawAnything = true
    if (!(KNOWN_OPTIONS as readonly string[]).includes(option)) return `不认识的选项 \`${option}\`。`
    if (!isSupported(option)) return unavailableMessage(option)
    return applyOption(into, option, wasInvert)
  }

  for (; i < text.length; ++i) {
    const ch = text[i]!
    if (ch === ']') {
      const error = flush()
      if (error) return { index: i, error }
      if (sawAmpersand) return { index: i, error: '`&&` 后面要有下一个选项。' }
      if (!sawAnything) return { index: i, error: '空的 `[]` 里要有条件。' }
      return { index: i + 1 }
    }
    if (ch === '(') {
      const option = pending.trim()
      if (!option) return { index: i, error: sawAmpersand ? '`&&` 后面要有下一个选项。' : '`(` 前面要有选项名。' }
      if (!(KNOWN_OPTIONS as readonly string[]).includes(option)) return { index: i, error: `不认识的选项 \`${option}\`。` }
      if (!isSupported(option)) return { index: i, error: unavailableMessage(option) }
      const argument = readConditionArgument(text, i + 1)
      if (argument.error) return { index: i, error: argument.error }
      if (!argument.value) return { index: i, error: `选项 \`${option}\` 缺参数。` }
      const error = applyOption(into, option, invert, argument.value)
      pending = ''
      invert = false
      sawAnything = true
      sawAmpersand = false
      if (error) return { index: i, error }
      i = argument.index - 1
      continue
    }
    if (/\s/.test(ch)) { if (pending.trim()) pending += ' '; continue }
    if (ch === '!') { if (pending.trim()) return { index: i, error: '`!` 只能放在选项名前面。' }; invert = !invert; continue }
    if (ch === '&') {
      const error = flush()
      if (error) return { index: i, error }
      // 上游 `parseCondition` 的 `optionExpected` 标志（`:335`/`:378`/`:390`）：`&&` 后面
      // 必须还有一个选项，否则报 "Constraint expected after '&&'"（见它的 testIncompleteMultipleCondition）。
      if (text[i + 1] !== '&') return { index: i, error: '两个选项之间要写 `&&`。' }
      i++
      sawAmpersand = true
      continue
    }
    pending += ch
  }
  return { index: i, error: '条件块缺 `]`。' }
}

function applyOption(into: VariableConstraint, option: SupportedOption, invert: boolean, argument?: string): string | undefined {
  if (option === 'contains') {
    // 上游 `StringToConstraintsTransformer.java:459-461`：`argument.trim()`（在 `:414`）之后
    // 原样存进 containsConstraint（字段 `MatchVariableConstraint.java:52-53`）。子模板**能不能编译**
    // 上游压根不校验 —— 因为它那一侧的谓词是死代码（`ContainsPredicate.java:12-18` 的 `match` 恒 `false`）。
    // 本仓要真的拿它做判定，所以把子模板存下来、由 `src/structuralSearchModifiers.ts` 在求值前编一遍，
    // 编不动就明说（这里不回头调 `compileStructuralPattern`：那是 structuralSearch.ts 的出口，
    // 它已经 import 本文件，反手 import 会成环）。
    const value = (argument ?? '').trim()
    if (!value) return '`contains` 要一个子模板参数。'
    into.contains = value
    into.invertContains = invert
    return undefined
  }
  if (option === 'regex' || option === 'regexw') {
    const value = argument ?? ''
    if (!value) return '`regex`/`regexw` 要一个正则参数。'
    try { new RegExp(value) } catch (error) {
      return `正则 \`${value}\` 编译失败：${(error as Error).message}`
    }
    if (into.regexp !== null && into.regexp !== value) return '同一条约束里给了两个不同的正则。'
    into.regexp = value
    into.invertRegExp = invert
    if (option === 'regexw') into.wholeWordsOnly = true
    return undefined
  }
  return unavailableMessage(option)
}

/**
 * 解析 `$x$` 之后跟着的约束后缀（量词 + 可选条件块）。
 *
 * `index` 指向 `$x$` 结束位置（`$` 之后）。没有约束时 `ok` 也为 true，只是
 * `quantified`/`constrained` 为 false —— 调用方据此保持"变量 = 一个标识符"的旧形状。
 */
export function parseVariableConstraint(name: string, text: string, index: number): ConstraintResult & { index: number; constrained: boolean } {
  const into = constraint(name)
  let cursor = index
  const quantified = cursor < text.length && '+?*{'.includes(text[cursor]!)
  const quantifier = readQuantifier(text, cursor, into)
  if (quantifier.error) return { ok: false, error: quantifier.error, index, constrained: false }
  cursor = quantifier.index
  if (into.minOccurs > into.maxOccurs) {
    return { ok: false, error: `重复次数下界 ${into.minOccurs} 大于上界 ${into.maxOccurs === UNLIMITED ? '∞' : into.maxOccurs}。`, index, constrained: false }
  }
  // 上游的条件块跟在 `:` 之后（`:183-197`）；`::` 是转义的双冒号（`:187-190`：`pattern.append(ch)`
  // 只追加**一个** `:`，另一个留给主循环当字面量，于是最终是 `::` —— 见它的 testMethodReference
  // 断言 `"$a$::$b$"`）。所以 `::` 这一支**一个字符都不消费**：两个冒号都要落回字面量，
  // 第一个是 `:189` 追加的那个，第二个由主循环（`:203-205` 的 rewind）再补一次。
  // 冒号本身可省：`$x$[regex(...)]` 与 `$x$:[regex(...)]` 等价。
  if (text[cursor] === ':' && text[cursor + 1] !== ':') {
    cursor++
    if (cursor >= text.length) return { ok: false, error: '`:` 后面要有条件。', index, constrained: false }
  }
  let constrained = quantified || !into.greedy
  if (text[cursor] === '[') {
    const conditions = readConditions(text, cursor, into)
    if (conditions.error) return { ok: false, error: conditions.error, index, constrained: false }
    cursor = conditions.index
    constrained = true
  }
  return { ok: true, constraint: into, index: cursor, constrained }
}

/**
 * 把"一项"重复成 min..max 项的逗号分隔列表。
 *
 * 列表的形状恒定是「第一项 + `,` 分隔的后续项」，所以**第一项不能是可选项** ——
 * 否则 `min=0` 会编出 `(?:\s*,\s*X)?` 这种"只有逗号没有内容"的东西。
 * `min=0` 的正确形状是「整个列表可选，列表里至少一项」（上游 `minOccurs=0` 同样仍要匹配到
 * 至少一个节点才成立，见 `SubstitutionHandler.java:329` 的 `matchedOccurs < minOccurs` 循环）。
 */
function bounded(body: string, min: number, max: number): string {
  if (min === 0 && max === 0) return '(?!)'   // 一项都不许有：匹配不到任何东西（不是空串）
  // `X` 后跟 `{,}` —— JS 里 `{n,}` 就是"至少 n 项"，`{n,m}` 是"n 到 m 项"。
  const tail = (from: number, to: number) => (from === 0 ? '' : `(?:\\s*,\\s*${body}){${from - 1}${to === UNLIMITED ? ',' : `,${to - 1}`}}`)
  if (min === 0) return `(?:${body}${tail(1, max)})?`
  return `${body}${tail(min, max)}`
}

/**
 * 贪婪列表的「整段」断言：吃完整段逗号列表之后，后面**不能**再是逗号项、也不能是
 * 一项没写完的样子（后面接 `(` 说明最后一个标识符是被调用的函数名、接 `.` 说明后面还有成员访问）。
 * 开头也不许是某一段的**后半截**（否则裸模板 `$x{2}` 会在 `a, b, c` 里拿 `b, c` 当成"两项的列表"）。
 *
 * 上游在语法树上把变量的项数定死成那一段同级节点：`doMatchSequentially` 用
 * `VARS_DELIM_FILTER` 把逗号这类分隔符**滤掉**（`SubstitutionHandler.java:318`，过滤器定义在
 * `:45-56`），于是项数就是「这一段里能连续匹配几个」；`validate` 再按这个数判 min/max
 * （`:264-269`），同一个变量在模板里再次出现时项数还要相等
 * （`checkSameOccurrencesConstraint`，`:457-466`）。上游那种"只吃前两项就收工"要靠模板
 * **后面**的节点（`)`、`,` 等）去对剩下的内容——裸模板 `$x{2}` 后面没有节点可对，文本层
 * 就必须自己断言列表到此为止。语法树里没有「一段列表的后半截」这种东西，所以文本层
 * 两端都要各判一次。
 *
 * 非贪婪（`{n,m}?`）不加这些：上游那一支本来就允许停在 minOccurs 再让后面的节点接着走
 * （`SubstitutionHandler.java:408-441` 的回退循环）。
 *
 * **两端能写进正则的只有前顾**：原生搜索通道用的是 `std::regex` 的 ECMAScript 文法
 * （`native/search.cpp:256`），它**不实现后顾断言** —— 实测（本机 MSVC，`cl /std:c++20`）
 * `(?=x)`、`(?!x)` 编译通过，`(?<=x)`、`(?<!x)` 抛 `regex_error(error_badrepeat)`。
 * 上一版在这里写着 `(?<![A-Za-z0-9_$])(?<!,\s*)`，于是**任何**带贪婪列表变量的结构化模板
 * 到了宿主都报 `INVALID_QUERY`（`native/search.cpp:261`），面板一条结果都拿不到。
 * 现在正则这一侧只留宿主认得的形状：起点用 `\b`、终点用前顾（`runEnd`，它要知道模板在变量
 * 后面写着什么）；剩下的两条搬到命中后的复核里，与 `contains`/`within` 同一层 ——
 * 一条是"前一个分隔符是不是逗号"（要认词法：字符串与注释里的逗号不算，`$` 也算标识符字符），
 * 一条是"这一段括号配不配得平"（要算深度）。判据本体在 `src/structuralCodeBlock.ts` 的
 * `listRunStartsHere`/`listRunEndsHere`，挂在 `src/structuralSearchModifiers.ts` 的 `listRunVerdict`。
 */
const RUN_TAIL_CHARS = [',', '(', '.']

/**
 * 列表尾巴上不许剩下什么：`,`（列表没完）、`(`（最后一个标识符其实是被调用的函数名）、
 * `.`（最后一项其实是成员访问的前半）。
 *
 * **模板自己写在变量后面的那个字符要排除掉**：`$x$.equals($y$)` 里点号是模板的下一个 token，
 * 列表在它前面停下才是对的（上游同一条：模式的下一个节点接得住它）。
 * 所以这一条只能由知道"变量后面还写着什么"的调用方给 —— `following` 就是模板里
 * `$Var$` + 量词之后剩下的那一段原文。
 */
function runEnd(following: string): string {
  const next = following.trimStart().charAt(0)
  const banned = RUN_TAIL_CHARS.filter(ch => ch !== next).join('')
  return banned ? `(?!\\s*[${banned}])` : ''
}

/**
 * 列表的一项。上游一项是一个**完整的表达式节点**，所以 `g(b, c)`、`a[0]`、`{k: v}`
 * 整体算一项；文本层的等价物 = 一个标识符后面可以跟**一层**括号组（`bounded()` 只给
 * 列表变量用这一份，普通变量仍是一个裸标识符，见 `isPlainIdentifier`）。
 * 两层以上嵌套（`g(h(1), 2)`）在这一档配不出来，那一条命中会被复核阶段否决而不是
 * 被切成半截 —— 少报，不误报。
 */
const LIST_ITEM_TAIL = '(?:\\s*(?:\\([^()]*\\)|\\[[^\\]]*\\]|\\{[^{}]*\\}))?'


/**
 * 变量名那一份的正则片段（还没加捕获组括号）：重复、名字正则、全词都作用在这里。
 *
 * **名字正则按整段算**（`RegExpPredicate.java:101-106`：`doMatch` 里的 `matcher.matches()`
 * 作用在**节点自己的完整文本**上，不是 find）。文本层没有节点边界，于是两端都要断言：
 * 起点 `\b`（这一项从一个标识符字符开始，`getUser` 里不能从 `etUser` 切一刀）与末尾的
 * `(?![A-Za-z0-9_$])`（后面不能再接标识符字符）。`regexw` 在上游是把正则包成
 * `.*?\b(?:REAL)\b.*?`（`:54-56`）——同样是两端词边界，所以两条路径收敛成同一个形状。
 *
 * **取反的形状**：`!regex(R)` 的语义是「这个名字**不是** R 匹配的东西」——被匹配的文本
 * 仍然是标识符（`RegExpPredicate.match` 那条路上传给 `doMatch` 的 `text` 是节点自己的文本，
 * `invertRegExp` 由 `NotPredicate` 包在外层，见 `MatchVariableConstraint.java:202-208`）。
 * 所以正确形状是「先断言此处不是 R，再吃掉一个标识符」；断言里那两端的边界也要跟着走，
 * 否则 `!regex(get.*)` 会在 `getUser` 中间找到 `etUser` 就当成命中。
 */
function nameFragment(into: VariableConstraint, following: string): string {
  const plain = into.wholeWordsOnly ? `\\b${CONSTRAINT_IDENTIFIER}\\b` : CONSTRAINT_IDENTIFIER
  /**
   * 重复次数 + 整段断言。只有**可能吃多于一项**（`maxOccurs > 1`）的列表才需要"整段"那几条断言：
   * 只吃一项的变量在上游也是一个节点，模板后面跟的 `,` 之类照样对得上，断言反而会误杀
   * `f($x{1}, 2)` 这种合法模板。
   * 起点那一条 = `\b`（宿主认得的最接近形状），列表项在这里才允许带一层括号组；
   * 判得更准的那两条要算括号深度，在命中后的复核里，见 `runEnd` 上面那段。
   */
  const counted = (item: string) => {
    const one = into.maxOccurs > 1 ? `${item}${LIST_ITEM_TAIL}` : item
    const body = bounded(one, into.minOccurs, into.maxOccurs)
    if (!into.greedy) return `${body}?`
    return into.maxOccurs > 1 ? `\\b${body}${runEnd(following)}` : body
  }
  if (into.regexp === null) return counted(plain)
  const assertion = `(?:${into.regexp})(?![A-Za-z0-9_$])`
  // 不取反：整个名字片段由正则决定，列表的每一项都吃这个正则。
  if (!into.invertRegExp) return counted(`\\b${assertion}`)
  // 取反：断言作用在**每一项**上，被吃掉的仍是标识符。
  return counted(`\\b(?!${assertion})${plain}`)
}

/** 该约束是否与"一个裸标识符"完全等价（是的话调用方可以少套一层分组）。 */
export function isPlainIdentifier(into: VariableConstraint): boolean {
  return into.minOccurs === 1 && into.maxOccurs === 1 && into.regexp === null && !into.invertRegExp && !into.wholeWordsOnly
}

/**
 * 把一条约束编成正则的**捕获组**（含外层圆括号）。组号 + 1 就是替换串里 `$N` 的那个 N。
 *
 * 非贪婪只加在"整段列表"的尾巴上（`?` 紧跟最大重复的那一段），与上游 `greedy=false`
 * 让匹配尽量少吃的意图一致。
 *
 * `following` = 模板里写在这个变量**后面**的那一段原文（`compileStructuralPattern` 传的
 * 是 `$Var$` + 量词/条件之后剩下的全部）。贪婪列表要往尾巴上加一条"不许剩下分隔符"的前顾，
 * 而模板自己写掉的那个字符不该算剩下 —— 那一档信息只有调用方有。
 */
export function constraintCaptureGroup(into: VariableConstraint, following = ''): string {
  return `(${nameFragment(into, following)})`
}
