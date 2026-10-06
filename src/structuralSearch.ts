// 结构化搜索/替换的**文本子集**。上游是 PSI 上的模板匹配
// （`platform/structuralsearch/source/com/intellij/structuralsearch/impl/matcher/StructuralSearchUtil.java`
// 的 `parsePattern` 把 `$x$` 变量编成 `MatchVariableConstraint`，再在语法树上跑 `Matcher`）。
// 本仓没有 PSI（lp/psi 族判 `[-]`），所以这里在**文本层**做一个真子集：
//
//   · 模板 = 带 `$Var$` 占位符的代码片段，编译成正则（`compileStructuralPattern`）；
//   · 第一处 `$Var$` → `([A-Za-z_$][\w$]*)`（IDEA 未加约束的变量默认按「标识符」匹配，
//     见 `MatchVariableConstraint` 的默认 name/value 语义）；同一名字再次出现 → `\1`
//     反向引用，等于上游「同名变量必须匹配同一段文本」；
//   · 替换串里的 `$Var$` 翻成 `$N`（原生 `search.replace` 走 `std::regex_replace` 的 `$N` 语义，
//     见 native/search.cpp 的 `apply_replacement`）。
//
// **不做**（逐条对应上游能力，判词里同样点名，且都有"为什么"）：
//   · PSI 语义 —— 模板必须构成合法语法树（`PatternContext`）、按语言解析（`StructuralSearchProfile`）；
//   · 变量的**类型/引用/上下文/脚本**约束（`plugin/ui/filters/` 的 Type / Reference / Context /
//     Script 四档，见 `src/structuralSearchFilters.ts` 头部）—— 全都要语法树或脚本宿主；
//   · 命中落在字符串字面量/注释里的**上下文**判定 —— 顺带更正一处旧判词：上游
//     `MatchOptions` **没有** `searchInComments`/`searchInLiterals` 这两个位
//     （`MatchOptions.java:25-53` 的全部字段里没这两项，`grep -rn searchInComments
//     platform/structuralsearch/` 零命中），所以这一条不是"本仓缺的功能"，是上游就没有的东西。
// 因此 `lp/*` 的语义级检查不受影响，本模块只服务用户主动做的结构化搜索/替换。
//
// 为什么变量默认按标识符而不是「任意文本」：`([\s\S]*?)` 这种贪婪兜底会把模板匹配成
// 任意长文本，结果集没有意义；IDEA 的默认同样是一个词法单元。用户可以给变量加约束
// （`$x$+`、`$x${2,3}`、`$x$[regex(...)]`）来放宽或收紧它 —— 规则在
// `src/structuralSearchConstraints.ts`，对应上游 `MatchVariableConstraint` 的
// minCount/maxCount/regExp/invertRegExp/wholeWordsOnly 五项，是判词「变量约束」那条待办
// 在本仓能真正兑现的部分。`$Args$` 那类**列表变量**在上游不是另一种模型：
// `MatchVariableConstraint.java` 里没有任何按名字特判列表的分支（`grep ARGS|args` 零命中），
// 列表就是"同一变量允许出现 0 到无穷多次"这一条约束
// （`StringToConstraintsTransformer.java:101,110` 的 `maxOccurs = Integer.MAX_VALUE`），
// 所以本仓的写法是 `$Args{0,}$` 或 `$Args$*`，项与项之间按逗号分隔。

import { constraintCaptureGroup, isPlainIdentifier, parseVariableConstraint, type VariableConstraint } from './structuralSearchConstraints.ts'

export interface StructuralPattern {
  /** 编译后的正则（喂给原生 `search.run`/`search.replace` 的 `query`）。 */
  regex: string
  /** 按出现顺序去重的变量名；下标 + 1 即捕获组号。 */
  variables: string[]
  /** 每个变量带的约束（没写约束就是"一个裸标识符"那一条）。 */
  constraints: Map<string, VariableConstraint>
}

export interface StructuralError {
  error: string
}

/**
 * 编译期的**面板开关**（上游 `MatchOptions` 那几个位在本仓只有两个真的有生效点）。
 * 类型写在本文件而不是从 `structuralSearchModifiers.ts` 引：那边 `import` 了这里的
 * `compileStructuralPattern`，反向引会成环；两边按同一个形状（`{ wholeWords }`）对接，
 * 生产侧的取数函数是 `compileSwitches()`（`src/structuralSearchModifiers.ts`）。
 *
 * `wholeWords` = 整模板档的「全词」：把它写进**每个变量**的 `wholeWordsOnly`
 * （上游"Modifiers for the whole template"那一行的作用方式，`plugin/ui/filters/FilterPanel.java:291,339`
 * + `FilterTable.java:22-25` 的 `getMatchVariable()`；字段与写入点
 * `MatchVariableConstraint.java:33,312-318` ← `StringToConstraintsTransformer.java:427-429`；
 * 生效形状 `RegExpPredicate.java:54-56` 的两端 `\b`）。
 */
export interface StructuralCompileOptions {
  wholeWords?: boolean
}

const VAR = /\$([A-Za-z_][A-Za-z0-9_]*)\$/g
const IDENTIFIER = '[A-Za-z_$][\\w$]*'
/** 会跟下一个词粘在一起的字符（上游按 token 比，两个 token 之间至少要留一个空白）。 */
const WORD_CHAR = /[\w$]/

/** 正则里需要转义的字面字符。`$` 单独处理（变量/字面两种含义）。 */
function escapeLiteral(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/**
 * 模板里的空白不参与比对（上游 `MatchOptions.java:28,60` 的 `looseMatching` 恒为真 ——
 * `setLooseMatching` 在**整棵上游树里没有任何调用者**，所以用户改不了它；
 * 生效点在 `impl/matcher/GlobalMatchingVisitor.java:93` + `:234-236`：匹配模式侧节点时
 * 走 "left loose"，也就是模板里的空白/换行节点被跳过）。
 *
 * 文本层的等价物按**能不能粘成一个 token** 分两种：
 *   · 两端都是"词"（标识符字符，或一个变量捕获组/反向引用）⇒ `\s+`：
 *     两个相邻的标识符 token 在语法树上永远是两个节点，中间必须有边界，
 *     所以 `foo bar` 这个模板**不许**匹配 `foobar`；
 *   · 任一端是标点（`(`、`==`、`,`…）⇒ `\s*`：
 *     上游跳过空白节点后 `a == b` 与 `a==b` 的 token 序列完全相同，所以零个空白也要能过。
 * 段首/段尾的空白直接丢掉（整条正则不锚定，两端留白没有意义）。
 */
function emitLiteralSegment(text: string, wordBefore: boolean, nextPartStartsWord: boolean): string {
  let out = ''
  /** 目前这一段（或上一段）的末尾是不是"词"。跨段时要带着走，见上面的 `\\s+` 判据。 */
  let prevWord = wordBefore
  let i = 0
  while (i < text.length) {
    if (!/\s/.test(text[i]!)) {
      const end = nextBoundary(text, i, false)
      out += escapeLiteral(text.slice(i, end))
      prevWord = WORD_CHAR.test(text[end - 1]!)
      i = end
      continue
    }
    const runEnd = nextBoundary(text, i, true)
    // 这一段空白之后紧跟着的第一个非空白字符决定"后邻"是不是词；整段字面量都跑完了才用
    // 下一个 part 给的那一档（变量 ⇒ 词，字面量 ⇒ 看它自己的首字符）。
    const after = runEnd < text.length ? WORD_CHAR.test(text[runEnd]!) : nextPartStartsWord
    if (out || prevWord) out += after && prevWord ? '\\s+' : '\\s*'
    // 段首空白（out 空且前一段不是词）直接丢：模板开头留空格不该影响匹配。
    prevWord = false
    i = runEnd
  }
  return out
}

/** 从 `from` 起的下一段边界：`space=true` 取连续空白，false 取连续非空白。 */
function nextBoundary(text: string, from: number, space: boolean): number {
  let i = from
  while (i < text.length && (/\s/.test(text[i]!) === space)) i++
  return i
}

/** 一个字面量 part 的首/尾是不是"词"（整段都是空白时两头都不算）。 */
function literalStartsWord(text: string): boolean {
  const i = nextBoundary(text, 0, true)
  return i < text.length && WORD_CHAR.test(text[i]!)
}
function literalEndsWord(text: string): boolean {
  let i = text.length
  while (i > 0 && /\s/.test(text[i - 1]!)) i--
  return i > 0 && WORD_CHAR.test(text[i - 1]!)
}



/**
 * 把结构化模板编译成正则。第一个出现的变量成为捕获组，之后同名的复用反向引用
 * （`\1`、`\2`…），所以 `$x$ + $x$` 只匹配「同一个标识符相加」。
 *
 * **变量约束**（`$x$+` / `$x${2,3}` / `$x$[regex(...)]` / `$x$[regexw(...)]` /
 * `$x$[!regex(...)]`）由 `src/structuralSearchConstraints.ts` 解析并编进捕获组 ——
 * 那是上游 `MatchVariableConstraint`（`MatchVariableConstraint.java:29-36` 的
 * minCount/maxCount/regExp/invertRegExp/wholeWordsOnly 五项）在本仓的文本子集。
 * 没有约束时捕获组仍是老的 `(IDENTIFIER)`，**已编译出来的正则一字不变**。
 */
export function compileStructuralPattern(template: string, options?: StructuralCompileOptions): StructuralPattern | StructuralError {
  if (!template.trim()) return { error: '模板不能为空。' }
  /** 整模板档的「全词」（上游 `wholeWordsOnly` 的整模板写法，见 `StructuralCompileOptions`）。 */
  const wholeWords = options?.wholeWords === true
  const variables: string[] = []
  /** 变量名 → 它第一处出现时带的约束。约束只能写在首次引用上（与上游同一条规则）。 */
  const constraints = new Map<string, VariableConstraint>()
  /**
   * 先把模板切成 part（字面量 / 变量），再一次性生成正则：空白要不要 `\s+`、要不要 `\s*`
   * 取决于**下一段**的首字符是不是词，所以必须先看后邻再生成，不能一遍扫到底。
   */
  const parts: { literal?: string; regex?: string; startsWord: boolean; endsWord: boolean }[] = []
  let cursor = 0
  VAR.lastIndex = 0
  let match: RegExpExecArray | null
  while ((match = VAR.exec(template)) !== null) {
    const before = template.slice(cursor, match.index)
    if (before) {
      parts.push({ literal: before, startsWord: literalStartsWord(before), endsWord: literalEndsWord(before) })
    }
    const name = match[1]!
    const after = match.index + match[0].length
    const group = variables.indexOf(name)
    // 约束后缀只在**首次**引用上生效：上游 `StringToConstraintsTransformer.java:179-181`
    // 对第二次引用带条件报 `error.condition.only.on.first.variable.reference`。
    const parsed = parseVariableConstraint(name, template, after)
    if (!parsed.ok) return { error: parsed.error }
    // 变量（捕获组或反向引用）两端永远是"词"：它匹配的就是一段标识符文本。
    const wordy = { startsWord: true, endsWord: true }
    if (group < 0) {
      variables.push(name)
      // 整模板档的「全词」写进每一个变量（上游那一行的作用方式），其余约束保持用户写的那一份。
      if (wholeWords) parsed.constraint.wholeWordsOnly = true
      constraints.set(name, parsed.constraint)
      // `contains` 不进正则（它判的是"捕获段里还要含子模板"，见 structuralSearchModifiers.ts），
      // 所以只有真的改变了**形状**的约束才换用 constraintCaptureGroup，其余保持旧的那一条正则。
      const shape = (parsed.constrained || wholeWords) && !isPlainIdentifier(parsed.constraint)
      // `template.slice(parsed.index)` = 写在这个变量后面的那一段原文：列表变量的"整段"前顾
      // 要知道模板自己消费掉了哪个字符（`$x$.equals($y$)` 里那个点），只有这里有这个信息。
      parts.push({ regex: shape ? constraintCaptureGroup(parsed.constraint, template.slice(parsed.index)) : `(${IDENTIFIER})`, ...wordy })
      VAR.lastIndex = parsed.index
    } else {
      if (parsed.constrained) {
        return { error: `变量 \`$${name}$\` 的约束只能写在第一次出现的地方（上游同一条规则）。` }
      }
      // 反向引用：同一变量必须匹配同一段文本（`MatchVariableConstraint` 的同名约束）。
      parts.push({ regex: `\\${group + 1}`, ...wordy })
    }
    cursor = parsed.index
  }
  const tail = template.slice(cursor)
  if (tail) parts.push({ literal: tail, startsWord: literalStartsWord(tail), endsWord: literalEndsWord(tail) })

  let source = ''
  parts.forEach((part, index) => {
    if (part.regex !== undefined) { source += part.regex; return }
    const previous = parts[index - 1]
    const next = parts[index + 1]
    source += emitLiteralSegment(part.literal!, previous?.endsWord === true, next?.startsWord === true)
  })
  if (!source) return { error: '模板里没有任何可匹配的内容。' }
  try {
    new RegExp(source)
  } catch (error) {
    // 约束编出来的正则自己也要过一遍引擎（上游 `checkRegex`，`StringToConstraintsTransformer.java:486-493`）。
    return { error: `编译出来的正则不合法：${(error as Error).message}` }
  }
  // 模板里若出现落单的 `$`（不是 `$Var$`），escapeLiteral 已把它转义成字面量；
  // 这是有意的 —— 用户写 `"$"` 时就该匹配美元符号本身。
  const byName = new Map<string, VariableConstraint>()
  for (const name of variables) {
    byName.set(name, constraints.get(name) ?? {
      name, minOccurs: 1, maxOccurs: 1, greedy: true, regexp: null, invertRegExp: false, wholeWordsOnly: false,
      contains: null, invertContains: false,
    })
  }
  return { regex: source, variables, constraints: byName }
}


/**
 * 把替换串转换成原生替换通道认得的 `$N` 形式。未知的 `$Var$` 保留为字面文本，
 * 免得把用户输入悄悄吞掉；其余字面 `$` 不转义（原生按 `std::regex_replace` 解释，
 * 普通文本里的 `$` 不是特殊字符）。
 */
export function compileStructuralReplacement(replacement: string, variables: string[]): string {
  return replacement.replace(VAR, (whole, name) => {
    const group = variables.indexOf(name)
    return group >= 0 ? `$${group + 1}` : whole
  })
}

/** 变量在替换串里出现过的名字（对话框用来提示「必须有捕获」）。 */
export function replacementVariables(replacement: string): string[] {
  const names: string[] = []
  VAR.lastIndex = 0
  let match: RegExpExecArray | null
  while ((match = VAR.exec(replacement)) !== null) if (!names.includes(match[1]!)) names.push(match[1]!)
  return names
}
