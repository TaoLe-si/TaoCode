// 文本层的**结构判据**：一处文本处在括号深度的哪一层、这一段逗号列表是不是"同一个列表"、
// 一条 Python 复合语句从哪个关键字开始到哪里结束。
//
// 本文件有两批东西，用途不同，消费方也不同：
//
// ── A. 结构化搜索用的那半（**已有生产消费方**）────────────────────────────────
// 上游的结构化搜索在语法树上跑，一个"列表变量"（`$Args$` 那种 maxOccurs 不限的变量）吃的是
// **同一个父节点下的连续兄弟 token**：`SubstitutionHandler.matchSequentially` 遍历
// `matchNodes`，用 `VARS_DELIM_FILTER` 把逗号这类分隔符滤掉
// （`platform/structuralsearch/source/com/intellij/structuralsearch/impl/matcher/handlers/SubstitutionHandler.java:318`，
// 过滤器的定义在 `:45-56`），项数再由 `validate` 按 min/max 收口
// （`:264-269`）。"同一个父节点"在文本层没有语法树可问，但它有一个**能用字符算出来**的等价物：
// **括号深度**。`f(a, g(b, c))` 里 `a` 与 `g` 在 depth 1、`b` 与 `c` 在 depth 2，
// 所以 `b, c` 是一段列表、`a, g(b` 不是。于是本文件给结构化搜索提供三条判据：
//   · `depthProfile(text)` —— 每个字符位置**之前**的括号深度，以及每个字符是不是落在字符串/
//     注释里（字符串与注释里的括号不算，与 `src/editorCodeBlock.ts` 的 `structuralBraceTokens`
//     同一档口径）；
//   · `listRunStartsHere(text, at)` —— 这一段捕获是不是它所在列表的**开头**：往前第一个
//     算代码的字符是 `,` 就是别人家的后半截；`$` 也算标识符字符（正则里那条 `\b` 看不见它），
//     字符串/注释里的逗号不当分隔符（写进正则的那条 `(?<!,\s*)` 看不见词法，会把这两种逗号
//     也当分隔符 —— 这一档是搬进复核之后多出来的）；
//   · `listRunEndsHere(text, from, to)` —— 捕获段的括号必须**配平**：段首与段尾同层、中间不许
//     跌破那一层。上游一项是一个完整节点，`g(b` 这种半个调用根本不成一个可比的位置。
// 「段尾后面不许是逗号/左括号/点」那一条留在正则里（`structuralSearchConstraints.ts` 的 `runEnd`）：
// 只有编译期知道模板自己在变量后面写着什么，`$x$.equals($y$)` 里那个点是模板的下一个 token，
// 列表在它前面停下才对 —— 复核这一层看不见模板，重说一遍会把合法命中剔掉。
// 三条都挂在 `src/structuralSearchModifiers.ts` 的命中后复核里（`listRunVerdict`），
// 与 `contains`/`within` 同一层：宿主那一侧的 `std::regex` 用的是 ECMAScript 文法
// （`native/search.cpp:256`），**编不出后顾断言** —— 实测（MSVC 19.51 / `cl /std:c++20`）：
//   `(?=x)` `(?!x)` 编译通过，`(?<=x)` `(?<!x)` 抛 `regex_error(error_badrepeat)`。
// 所以那两条断言原先写在编译产物里（`structuralSearchConstraints.ts` 的 `RUN_START`）时，
// 带列表变量的模板一到宿主就报 `INVALID_QUERY`（`native/search.cpp:261`）—— 面板上写着
// "列表变量写量词"（`src/components/SearchPanel.vue` 的那行模板说明）却一条结果都拿不到。
// 本文件把它们从正则里搬到复核里，正则只留宿主支持的 `\b` 与前顾。
//
// ── B. 代码块导航用的那半（等 `src/editorCodeBlock.ts` 那一侧接）───────────────
// 判词点名的 `CodeBlockUtil.java:110`/`:178` 那两条 `CodeBlockSupportHandler.findCodeBlockRange`。
// 上游这一条链是：
//   · `platform/lang-impl/src/com/intellij/codeInsight/editorActions/CodeBlockUtil.java`
//     `calcBlockEndOffset:108-120` 与 `calcBlockStartOffset:176-188` —— 括号扫描之外**还要**问一次
//     结构支持，块尾取 `Math.min(结构, 括号)`（`:118`）、块首取 `Math.max(结构, 括号)`（`:186`）；
//     结构那半为空区间时用括号那半（`:111-113`/`:179-181`），括号那半是 -1 时用结构那半（`:114-116`/`:182-184`）。
//   · `platform/lang-impl/src/com/intellij/codeInsight/highlighting/CodeBlockSupportHandler.java`
//     `findCodeBlockRange:57-66` —— 先 `TargetElementUtil.adjustOffset`（`:58`），取光标处的 PSI 叶子
//     （`:59-60`，取不到 ⇒ EMPTY_RANGE），再遍历该语言的 handler，第一个非空区间算（`:62-65`）；
//     `getCodeBlockRange` 的契约在 `:47-52`：「光标所在的最小代码块区间，不在代码块里 ⇒ 空区间」。
//   · `platform/lang-impl/src/com/intellij/codeInsight/highlighting/AbstractCodeBlockSupportHandler.java`
//     `getCodeBlockRange:79-83` = 往上找第一个属于 `getBlockElementTypes()` 的祖先、取它的 textRange。
//   · 这份 community 参考树里**唯一**注册了这个 EP 的语言是 Python：
//     `python/pluginResources/intellij.python.community.impl.xml:439`（EP 声明
//     `platform/lang-impl/resources/intellij.platform.lang.impl.xml:147`）⇒ Java / C++ / TypeScript
//     在上游返回 EMPTY_RANGE，合并那一步自动退化成"只用括号扫描"。本仓对这三种语言同样返回 null，
//     **不是少做**。无法核实：Ultimate 侧是否还有别的注册项（本机参考树是 community）。
//   · Python 那一半的实现 `PyControlFlowKeywordMatcher.kt`：关键字表 `COMPOUND_PART_KEYWORDS:48-59`、
//     "先 offset 再 offset-1"的取叶子 `findKeywordContext:88-90`、语句区间 `compoundStatementRange:125-128`、
//     标记区间 `compoundStatementKeywordRanges:119-122`、部件归属 `enclosingCompoundStatement:130-137`、
//     同一条语句的部件收集 `compoundStatementKeywords:139-151`、三元/推导式关键字的忽略 `:84-86`。
//
// **为什么这一半还没接上**（不是"懒得接"）：它的合并点在
// `src/editorCodeBlock.ts:147-150` 的 `codeBlockTarget(text, caret, forward)`、调用方
// `src/editorCommands.ts:176`，两个文件都不在本域的可改面里 ⇒ 整段可照抄的替换代码与
// import 语句写在 `docs/wiring-requests-2026-10-06-search2.md` W-1'。
// A 那半有生产消费方（`src/structuralSearchModifiers.ts`），所以本文件不是零消费方模块。
//
// 判词留痕（规约 §1「要改别人的结论就留痕」）：`ss/matcher` 的判词把列表变量写成
// 「`$Args$` 这类**要按括号配平**的变量，上游由 `MatchingStrategy`/`TopLevelMatchingHandler` 处理」。
// 实际：`TopLevelMatchingHandler.java:14-40` 是"匹配完还要不要往子节点里递归"那一档
// （`match()` 里 `if ((!matched || options.isRecursiveSearch()) && …)` 那一段，`:23-38`），
// `MatchingStrategy` 只有 `continueMatching`（`:24`）与 `shouldSkip`（`:26`）两条谓词；
// 两者都不做括号配平。上游真正的机制是
// 「同一个父节点下的连续兄弟 token」（`SubstitutionHandler.java:318` + `:45-56`），
// 本仓按上面 A 那三条逼近它：配不配平用括号深度，分隔符用词法（字符串/注释里的逗号不算）。

// ── A. 结构化搜索的三条判据 ────────────────────────────────────────────────

/** `depthProfile` 认的括号对（与 `src/editorCodeBlock.ts:37-38` 的 OPENERS/CLOSERS 同一批字符）。 */
const OPEN_BRACKETS = '([{'
const CLOSE_BRACKETS = ')]}'

// 一段文本的结构剖面：每个位置**之前**的括号深度，以及每个字符是不是落在字符串/注释里。
//
// 口径与 `src/editorCodeBlock.ts` 的 `structuralBraceTokens` 一致：字符串里的括号不算、
// 注释里的括号不算（这里讲的是注释词法，按规约 §4 第 3 条用行注释写，块注释里出现
// "斜杠星 + 星斜杠"那一对字符会提前闭合注释，把后面的中文当代码读）。
// 行注释同时认 `//` 与 `#` —— 本仓的结果行可能是任意语言的源码，而 `#` 只出现在
// "这一行后半截不是代码"的位置（CSS 的 `#fff` 是个例外：它会把行尾当注释吃掉，
// 最坏结果是那一段不参与判定，不会把命中的行错说成不命中，因为复核只否决、不新增命中）。
// 块注释认"斜杠星"到"星斜杠"那一对；未闭合时到文本末尾为止（复核用的是单行文本）。
export interface DepthProfile {
  /** `depth[i]` = 第 i 个字符**之前**的括号深度；`depth[text.length]` = 段尾深度。 */
  depth: number[]
  /** `trivia[i]` = 第 i 个字符落在字符串或注释里（不能当代码结构看）。 */
  trivia: boolean[]
}

export function depthProfile(text: string): DepthProfile {
  const depth: number[] = []
  const trivia: boolean[] = []
  let level = 0
  let quote = ''
  let block = false
  let lineComment = false
  for (let i = 0; i < text.length; ++i) {
    const ch = text[i]!
    const next = text[i + 1]
    depth.push(level)
    if (lineComment) {
      trivia.push(true)
      if (ch === '\n') lineComment = false
      continue
    }
    if (quote) {
      trivia.push(true)
      if (ch === '\\') { depth.push(level); trivia.push(true); ++i; continue }
      if (ch === '\n') quote = ''   // 未闭合的单引号不外溢到下一行（复核只在一行内做）
      if (ch === quote) quote = ''
      continue
    }
    if (block) {
      trivia.push(true)
      if (ch === '*' && next === '/') block = false
      continue
    }
    if ((ch === '/' && next === '/') || ch === '#') {
      // 行注释：`//` 吃掉两个字符、`#` 吃掉一个，剩下的由 lineComment 那一档标成 trivia。
      if (ch === '#') { trivia.push(true); lineComment = true; continue }
      trivia.push(true)
      depth.push(level); trivia.push(true); i += 1
      lineComment = true
      continue
    }
    if (ch === '/' && next === '*') {
      block = true
      trivia.push(true)
      depth.push(level); trivia.push(true); i += 1
      continue
    }
    if (ch === '"' || ch === "'" || ch === '`') {
      quote = ch
      trivia.push(true)
      continue
    }
    trivia.push(false)
    if (OPEN_BRACKETS.includes(ch)) level += 1
    else if (CLOSE_BRACKETS.includes(ch)) level = Math.max(0, level - 1)
  }
  depth.push(level)
  return { depth, trivia }
}

/** 某个位置之前的括号深度；越界时按段首/段尾 clamp（复核只在命中行内部用，越界是调用方的边界情况）。 */
export function depthAt(profile: DepthProfile, offset: number, length: number): number {
  if (offset <= 0) return profile.depth[0] ?? 0
  if (offset >= length) return profile.depth[length] ?? profile.depth[profile.depth.length - 1] ?? 0
  return profile.depth[offset] ?? 0
}

/** 从 `from` 往左第一个**算代码**的下标（跳过空白与字符串/注释里的字符）；越界返回 -1。 */
function prevCodeChar(text: string, from: number, scan: DepthProfile): number {
  for (let i = from - 1; i >= 0; --i) if (!/\s/.test(text[i]!) && !scan.trivia[i]) return i
  return -1
}

/**
 * 这一段捕获是不是它所在列表的**开头**（判词「列表变量」那条的第一半）。
 *
 * 两档否决：
 *   · 前一个字符是标识符字符 —— 上游一个变量吃的是**完整节点**，`getUser` 里不能从 `User`
 *     切一刀当一项。正则里那 `\b` 是这条的子集：`\w` 不含 `$`，所以 `a$b` 那一刀只有这里看得见；
 *   · 前一个**算代码**的字符是 `,` —— 说明这一处是 `a, b, c` 的后半截，上游的父节点只有一个
 *     逗号链。字符串与注释里的逗号不算（`f(", ", x)` 里引号那一个是文本内容，不是分隔符；
 *     `f(x) // a, y` 里注释那一个根本不在这行代码里）—— 这一档是搬进复核之后**多出来**的，
 *     写在正则里的那条 `(?<!,\s*)` 看不见词法，会把这两种逗号也当分隔符。
 *
 * 与上游的落差如实登记：上游的递归下降（`TopLevelMatchingHandler.java:23-38`）允许一次匹配
 * **从列表中间开始**，所以 `a, b, c, tail` 里模板 `$x{2}, tail` 从 `b` 起也是合法命中；
 * 本仓这一条把它否了（收紧，不是放松）。原先那条后顾断言同样是否的，这一档行为没变。
 */
export function listRunStartsHere(text: string, at: number, profile?: DepthProfile): boolean {
  if (at <= 0) return true
  const before = text[at - 1]!
  if (/[A-Za-z0-9_$]/.test(before)) return false
  const scan = profile ?? depthProfile(text)
  const cut = prevCodeChar(text, at, scan)
  // 前一个**算代码**的字符是逗号 ⇒ 这一段是别人家的后半截。
  // 逗号与起点之间只可能隔着空白/字符串/注释，所以这里不需要再比一次深度：
  // 真正用到深度的是 `listRunEndsHere` 那一条（捕获段配不配得平）。
  return cut < 0 || text[cut] !== ','
}

/**
 * 这一段捕获在它所在的括号层里是不是**收全了**（判词「列表变量」那条的第二半）。
 *
 * 捕获段的起点与终点必须同层，且中间不许跌破那个深度：`g(b` 这种"半个调用"在上游是一个
 * 节点的**一半**，`SubstitutionHandler.matchSequentially` 走的是一条完整的兄弟链
 * （`:318` + `:45-56`），根本不会停在半层括号里。
 *
 * 这里**不**判"段尾后面是不是逗号/点/左括号"：那一条写在正则里
 * （`structuralSearchConstraints.ts` 的 `runEnd`），因为只有编译期才知道模板自己在变量后面
 * 写着什么 —— `$x$.equals($y$)` 里那个点是模板的下一个 token，列表在它前面停下才是对的，
 * 复核这一层看不见模板，再说一遍就会把合法命中剔掉。
 */
export function listRunEndsHere(text: string, from: number, to: number, profile?: DepthProfile): boolean {
  const scan = profile ?? depthProfile(text)
  const base = depthAt(scan, from, text.length)
  if (depthAt(scan, to, text.length) !== base) return false
  for (let i = from; i < to; ++i) if (depthAt(scan, i, text.length) < base) return false
  return true
}

/** 两条判据合起来的形状（`listRunVerdict` 用）。 */
export function listRunHolds(text: string, from: number, to: number): boolean {
  if (from < 0 || to > text.length || to < from) return false
  const scan = depthProfile(text)
  return listRunStartsHere(text, from, scan) && listRunEndsHere(text, from, to, scan)
}

// ── B. 代码块导航：Python 的一条复合语句（等 editorCodeBlock 那一侧接）─────

export interface BlockRange { from: number; to: number }

/** `PyControlFlowKeywordMatcher.kt:48-59` 的 COMPOUND_PART_KEYWORDS。 */
const PART_KEYWORDS = new Set(['if', 'elif', 'else', 'for', 'while', 'try', 'except', 'finally', 'match', 'case'])
/** 能开一条复合语句的关键字（其余的只能挂在别人后面，`enclosingCompoundStatement:130-137` 里它们是 part）。 */
const HEADER_KEYWORDS = new Set(['if', 'for', 'while', 'try', 'match'])

interface PyLine {
  start: number; end: number
  /** 前导空白数；-1 = 空行（缩进不参与判定）。 */
  indent: number
  /** 行首的括号深度：>0 ⇒ 这是上一条逻辑行的续行，行首词不算语句关键字。 */
  depth: number
  keyword: string | null
  keywordFrom: number
  keywordTo: number
}

const WORD = /[A-Za-z_][A-Za-z0-9_]*/

/** 逐行扫一遍：字符串/注释/括号深度都算准，好让「行首的第一个词」这条判据不被字符串里的关键字骗到。 */
function scanLines(text: string): PyLine[] {
  const lines: PyLine[] = []
  let quote = ''
  let triple = false
  let comment = false
  let depth = 0
  let start = 0
  let lineDepth = 0
  for (let i = 0; i <= text.length; ++i) {
    const ch = text[i]
    if (i === text.length || ch === '\n') {
      const body = text.slice(start, i)
      const lead = body.length - body.replace(/^[ \t\f]*/, '').length
      const content = body.slice(lead)
      const blank = content === '' || content.startsWith('#')
      let keyword: string | null = null
      let keywordFrom = 0
      let keywordTo = 0
      if (lineDepth === 0 && !blank) {
        const hit = WORD.exec(content)
        if (hit) {
          const word = hit[0]
          if (PART_KEYWORDS.has(word)) {
            keyword = word
            keywordFrom = start + lead
            keywordTo = keywordFrom + word.length
          }
        }
      }
      lines.push({ start, end: i, indent: blank ? -1 : lead, depth: lineDepth, keyword, keywordFrom, keywordTo })
      if (i === text.length) break
      start = i + 1
      lineDepth = depth
      comment = false
      continue
    }
    if (comment) continue
    if (quote) {
      if (ch === '\\') { i += 1; continue }
      const pair = text.slice(i, i + 3)
      if (triple && (pair === `'''` || pair === '"""')) { quote = ''; triple = false; i += 2; continue }
      if (!triple && ch === quote) quote = ''
      continue
    }
    if (ch === '#') { comment = true; continue }
    if (ch === '"' || ch === "'") {
      const pair = text.slice(i, i + 3)
      if (pair === `'''` || pair === '"""') { quote = ch; triple = true; i += 2; continue }
      quote = ch
      continue
    }
    if (ch === '(' || ch === '[' || ch === '{') { depth += 1; continue }
    if (ch === ')' || ch === ']' || ch === '}') { depth = Math.max(0, depth - 1); continue }
  }
  return lines
}

/** 最近的非空行（空行与整行注释不打断一条复合语句，`PyControlFlowKeywordMatcher.kt:139-151` 走的是 PSI 兄弟链）。 */
function prevContent(lines: readonly PyLine[], index: number): number {
  for (let i = index - 1; i >= 0; --i) if (lines[i]!.indent >= 0) return i
  return -1
}
function nextContent(lines: readonly PyLine[], index: number): number {
  for (let i = index + 1; i < lines.length; ++i) if (lines[i]!.indent >= 0) return i
  return -1
}

/**
 * 这一段能不能接下一个关键字 —— `compoundStatementKeywords:139-151` 收集的是**同一条**语句的部件，
 * 接不上就是另一条语句（上游由 PSI 的父子关系给出，本仓按 Python 文法给）。
 */
function acceptsNext(parts: readonly string[], next: string): boolean {
  const header = parts[0]!
  switch (header) {
    case 'if':
      if (parts.includes('else')) return false
      return next === 'elif' || next === 'else'
    case 'for':
    case 'while':
      return next === 'else' && !parts.includes('else')
    case 'try':
      if (parts.includes('finally')) return false
      if (next === 'except') return true
      if (next === 'finally') return true
      // `else` 只在至少一个 `except` 之后出现一次（CPython 的 try_stmt 那一档）。
      return next === 'else' && parts.includes('except') && !parts.includes('else')
    case 'match':
      return next === 'case'
    default:
      return false
  }
}

/** 光标压在这一行的关键字上吗（含 `findKeywordContext:88-90` 那条「offset 或 offset-1」）。 */
function onKeyword(line: PyLine, caret: number): boolean {
  if (line.keyword === null) return false
  return (caret >= line.keywordFrom && caret < line.keywordTo) || line.keywordTo === caret
}

interface CompoundStatement {
  /** 部件关键字在 `lines` 里的下标，文档顺序（`compoundStatementKeywords:139-151` 的那个列表）。 */
  parts: number[]
  /** 整条语句的区间：从头部关键字的第一个字符，到最后一个部件所属块级的最后一行末尾。 */
  range: BlockRange
}

/**
 * Python 的一条多段复合语句（上游 `compoundStatementRange:125-128` 的文本等价物）。
 * 光标没压在 if/elif/else/for/while/try/except/finally/match/case 这些**语句位置**的关键字上 ⇒ null
 * （= 上游 `PyControlFlowKeywordMatcher.kt:120`/`:126` 的 `!in COMPOUND_PART_KEYWORDS` 那两条早退，
 * 以及 `CodeBlockSupportHandler.java:60`/`:65` 的 EMPTY_RANGE）。
 */
export function pythonCompoundStatement(text: string, caret: number): CompoundStatement | null {
  const lines = scanLines(text)
  const index = lines.findIndex(line => caret >= line.start && caret <= line.end)
  if (index < 0) return null
  const line = lines[index]!
  if (!onKeyword(line, caret)) return null

  // 1) 同一列上、以部件关键字开头的连续一段（中间只夹更深缩进的块级行）。
  const indent = line.indent
  let first = index
  for (;;) {
    const before = prevContent(lines, first)
    if (before < 0) break
    const upper = lines[before]!
    // 更深缩进的行属于**上一个部件的块**，跳过它们继续往上找。
    if (upper.indent > indent) { first = before; continue }
    if (upper.indent === indent && upper.keyword !== null) { first = before; continue }
    break
  }
  let last = index
  for (;;) {
    const after = nextContent(lines, last)
    if (after < 0) break
    const lower = lines[after]!
    if (lower.indent > indent) { last = after; continue }
    if (lower.indent === indent && lower.keyword !== null) { last = after; continue }
    break
  }
  const run: number[] = []
  for (let i = first; i <= last; ++i) {
    const current = lines[i]!
    if (current.indent === indent && current.keyword !== null) run.push(i)
  }
  // 2) 从段首贪心地切出「一条语句的部件链」，取包含光标那一行的那条。
  const parts = extendMatchRun(lines, run, line)
  let chain: number[] = []
  for (const candidate of parts) {
    const word = lines[candidate]!.keyword!
    if (chain.length && acceptsNext(chain.map(i => lines[i]!.keyword!), word)) chain.push(candidate)
    else chain = HEADER_KEYWORDS.has(word) ? [candidate] : []
    if (chain.includes(index)) {
      // 光标这一行落在一条以合法头部关键字开头的链里 —— 再往后把这条链收完。
      for (const follow of parts.slice(parts.indexOf(candidate) + 1)) {
        const nextWord = lines[follow]!.keyword!
        if (!acceptsNext(chain.map(i => lines[i]!.keyword!), nextWord)) break
        chain.push(follow)
      }
      return { parts: chain, range: extentOf(lines, indent, chain) }
    }
  }
  return null
}

/**
 * `match`/`case` 的缩进档与别的复合语句不同：CPython 的 `case_block` 比 `match` **深一级**，
 * 而 `match` 关键字本身是 `PyMatchStatement` 的直接子 token
 * （`PyControlFlowKeywordMatcher.kt:134-135` 那条 "the bare `match` keyword is a direct token
 * child of the match statement" 说的就是这件事，`compoundStatementKeywords:139-151` 因此把
 * `match` 与各个 `case` 收进同一条链）。同列收集只看得到其中一档，这里把另一档并进来。
 */
function extendMatchRun(lines: readonly PyLine[], run: readonly number[], caret: PyLine): number[] {
  if (!run.length) return []
  const head = lines[run[0]!]!
  if (head.keyword === 'case') {
    const above = prevContent(lines, run[0]!)
    if (above >= 0 && lines[above]!.keyword === 'match' && lines[above]!.indent < head.indent) return [above, ...run]
    return [...run]
  }
  if (head.keyword === 'match') {
    const firstCase = nextContent(lines, run[0]!)
    if (firstCase < 0 || lines[firstCase]!.keyword !== 'case') return [...run]
    const caseIndent = lines[firstCase]!.indent
    const collected = [...run]
    let cursor = firstCase
    for (;;) {
      collected.push(cursor)
      let after = nextContent(lines, cursor)
      while (after >= 0 && lines[after]!.indent > caseIndent) after = nextContent(lines, after)
      if (after < 0 || lines[after]!.indent !== caseIndent || lines[after]!.keyword !== 'case') break
      cursor = after
    }
    return collected
  }
  return [...run]
}

/** 整条语句的区间：头部关键字的第一个字符 → 最后一个部件那一块的最后一行末尾。 */
function extentOf(lines: readonly PyLine[], indent: number, chain: readonly number[]): BlockRange {
  const header = lines[chain[0]!]!
  let tailIndex = chain[chain.length - 1]!
  let end = lines[tailIndex]!.end
  for (;;) {
    const after = nextContent(lines, tailIndex)
    if (after < 0 || lines[after]!.indent <= indent) break
    tailIndex = after
    end = lines[after]!.end
  }
  // 上游取的是 PSI 节点的 textRange：语句不含前导缩进（那是父 statement list 的），也不含行尾换行。
  return { from: header.keywordFrom, to: end }
}

/**
 * 同一条语句的全部部件关键字区间（`PyControlFlowKeywordMatcher.kt:119-122` 的
 * `compoundStatementKeywordRanges`，也就是 `AbstractCodeBlockSupportHandler.java:66-76` 的
 * `getCodeBlockMarkerRanges`）。文档顺序，头部关键字在前。
 */
export function pythonCompoundKeywordRanges(text: string, caret: number): BlockRange[] {
  const statement = pythonCompoundStatement(text, caret)
  if (!statement) return []
  const lines = scanLines(text)
  return statement.parts.map(index => ({ from: lines[index]!.keywordFrom, to: lines[index]!.keywordTo }))
}

/**
 * `CodeBlockSupportHandler.java:57-66` 的 `findCodeBlockRange`。
 * 这份参考树里只有 Python 注册了这个 EP（`intellij.python.community.impl.xml:439`），
 * 其余语言 ⇒ null（上游的 EMPTY_RANGE，合并那一步因此只用括号扫描）。
 */
export function findCodeBlockRange(text: string, caret: number, language: string): BlockRange | null {
  if (language !== 'python' && language !== 'py') return null
  return pythonCompoundStatement(text, caret)?.range ?? null
}

/**
 * `CodeBlockUtil.java:108-120` 的块尾合并：结构那半为空 ⇒ 用括号那半（`:111-113`）；
 * 括号那半是 -1（本仓的 null）⇒ 用结构那半（`:114-116`）；否则 `Math.min`（`:118`）。
 */
export function mergeBlockEnd(braceEnd: number | null, structural: BlockRange | null): number | null {
  if (!structural) return braceEnd
  if (braceEnd === null) return structural.to
  return Math.min(structural.to, braceEnd)
}

/** `CodeBlockUtil.java:176-188` 的块首合并：与上一函数对称，只是 `Math.max`（`:186`）。 */
export function mergeBlockStart(braceStart: number | null, structural: BlockRange | null): number | null {
  if (!structural) return braceStart
  if (braceStart === null) return structural.from
  return Math.max(structural.from, braceStart)
}
