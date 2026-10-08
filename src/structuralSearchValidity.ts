// 结构化模板的**合法性检查（文本层代理）** —— 上游 `PatternCompiler` 那一半在本仓编不出来的部分。
//
// 上游：模板先被当成**代码**解析成语法树（`PatternCompiler.compile`，
// `platform/structuralsearch/source/.../impl/matcher/compiler/PatternCompiler.java:75-81` 声明
// `throws MalformedPatternException`，`:137`/`:183`/`:190` 是 `buildPattern` 一族里的抛出点）；
// 解析不出语法树就抛 `MalformedPatternException`，用户看到的是"模板不合法"。
// 本仓没有 PSI（lp/psi 族判 `[-]`，见 `src/structuralSearch.ts` 头部），所以**语法树那一半永远缺**；
// 这里能如实还原的是**词法**那一半 —— 它在上游同样会报错，且报错出口是同一个异常类型：
//   · 未闭合的引号/方括号条件 —— `StringToConstraintsTransformer.java:290-292`
//     （`error.expected.value` 的两条就是"引号没闭合"与"`]` 没闭合"）、`:63` 的
//     `error.expected.character`（`$` 后面没有名字）；
//   · 模板整体拼不出东西 —— `PatternCompiler.java:555-564`（`createTreeFromText` 的返回为空、
//     或词法器抛 `IncorrectOperationException` ⇒ 转成 `MalformedPatternException`）。
//
// 文本层的等价判据（本模块）：
//   ① 括号配对：`()` / `[]` / `{}` 必须成对且同类嵌套（模板里 `array[i` 这种残片在语法树上
//      解析不出来，上游同样报不合法）；
//   ② 字符串字面量必须闭合（`'` / `"` / 反引号，支持 `\` 转义）；
//   ③ 块注释必须闭合（`/* … */`）。
// 词法口径与 `src/structuralCodeBlock.ts` 的 `depthProfile()` **同一套**（行注释认 `//` 与 `#`、
// 块注释认"斜杠星…星斜杠"、引号三种）—— 那里是为了在命中行里判结构，这里是为了判模板本身，
// 同一份口径免得"面板说合法、复核说不合法"。
//
// **不算代码的部分**：`$Name$` 变量本身，以及它后面由 `parseVariableConstraint` 消费掉的
// **约束后缀**（`$x$+`、`$x${2,3}`、`$x$[regex(...)]`）—— 后缀有自己的语法，里面的括号
// （`regex(\d+)`、`[a-z]`）不是模板的代码括号。掩掉它们，免得把 `$x$[regex(])]` 这类
// 合法后缀误判成括号不配对。
//
// **已知的假阴性（如实登记，不粉饰）**：`#` 在 CSS 里是颜色而不是注释开头 ⇒ `#fff` 之后的
// 同一行不再参与检查（与 `depthProfile` 同一条已知偏差）；只可能漏报，不会把合法模板误判成非法。
// 语法树级的合法性（`PatternContext`/`PatternTreeContext`、"这个模板能不能按语言解析"）**仍然缺**。

import { parseVariableConstraint } from './structuralSearchConstraints.ts'

/** `$Var$` 的词法：与 `src/structuralSearch.ts` 的 `VAR` 同一份（变量名首字符不能是数字）。 */
const VAR = /\$([A-Za-z_][A-Za-z0-9_]*)\$/g

/** 三种括号的配对表（顺序成对，`CLOSE.indexOf(ch)` 取对应的开启符）。 */
const OPEN = '([{'
const CLOSE = ')]}'

export interface TemplateValidityOk { ok: true }

export interface TemplateValidityError {
  ok: false
  /** 面板直接显示的那一句（与 `compileStructuralPattern` 的 `error` 同一口径：中文 + 定位）。 */
  error: string
  /** 出错字符在模板里的下标（0 基），面板用来定位。 */
  offset: number
}

export type TemplateValidity = TemplateValidityOk | TemplateValidityError

/**
 * 模板的**代码部分**掩码：`$Name$` 与它的约束后缀标成 `false`（不算代码）。
 * 约束后缀的边界取 `parseVariableConstraint` 消费到哪（它返回 `index`），
 * 解析失败时只掩 `$Name$` 本体 —— 那条错误由 `compileStructuralPattern` 报，这里不抢。
 */
function codeMask(template: string): boolean[] {
  const mask = new Array<boolean>(template.length).fill(true)
  VAR.lastIndex = 0
  let match: RegExpExecArray | null
  while ((match = VAR.exec(template)) !== null) {
    const start = match.index
    const after = start + match[0].length
    const parsed = parseVariableConstraint(match[1]!, template, after)
    const end = parsed.ok ? Math.max(after, parsed.index) : after
    for (let i = start; i < end; i++) mask[i] = false
    // 从后缀之后继续找下一个变量：后缀里出现的 `$…$`（比如 `contains($y$)`）不重复算。
    VAR.lastIndex = end
  }
  return mask
}

/**
 * 模板合法性。返回第一条错误（与上游"编译时抛第一个异常"一致）。
 * 空模板不在这里判 —— `compileStructuralPattern` 已有一条「模板不能为空。」。
 */
export function checkTemplateValidity(template: string): TemplateValidity {
  const mask = codeMask(template)
  const stack: { ch: string; at: number }[] = []
  let quote = ''
  let quoteAt = 0
  let inBlockComment = false
  let blockAt = 0
  let inLineComment = false
  for (let i = 0; i < template.length; i++) {
    if (!mask[i]) continue
    const ch = template[i]!
    const next = template[i + 1]
    if (inLineComment) {
      if (ch === '\n') inLineComment = false
      continue
    }
    if (quote) {
      if (ch === '\\' && quote !== '`') { i++; continue }
      if (ch === quote) quote = ''
      continue
    }
    if (inBlockComment) {
      if (ch === '*' && next === '/') { inBlockComment = false; i++ }
      continue
    }
    if (ch === '/' && next === '/') { inLineComment = true; i++; continue }
    if (ch === '#') { inLineComment = true; continue }
    if (ch === '/' && next === '*') { inBlockComment = true; blockAt = i; i++; continue }
    if (ch === '"' || ch === "'" || ch === '`') { quote = ch; quoteAt = i; continue }
    if (OPEN.includes(ch)) { stack.push({ ch, at: i }); continue }
    const close = CLOSE.indexOf(ch)
    if (close < 0) continue
    const want = OPEN[close]!
    const top = stack.pop()
    if (!top) return { ok: false, error: `模板第 ${i + 1} 个字符处的 \`${ch}\` 没有配对的 \`${want}\`。`, offset: i }
    if (top.ch !== want) {
      return {
        ok: false,
        offset: i,
        error: `模板第 ${i + 1} 个字符处的 \`${ch}\` 与第 ${top.at + 1} 个字符的 \`${top.ch}\` 不配对。`,
      }
    }
  }
  if (quote) return { ok: false, error: `模板里的字符串（从第 ${quoteAt + 1} 个字符的 \`${quote}\` 起）没有闭合。`, offset: quoteAt }
  if (inBlockComment) return { ok: false, error: `模板里的块注释（从第 ${blockAt + 1} 个字符起）没有闭合。`, offset: blockAt }
  if (stack.length) {
    const top = stack[stack.length - 1]!
    return { ok: false, error: `模板第 ${top.at + 1} 个字符的 \`${top.ch}\` 没有闭合。`, offset: top.at }
  }
  return { ok: true }
}
