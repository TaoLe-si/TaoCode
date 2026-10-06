# 接线请求 · 桶 9（searchdiff 收尾批）· 2026-10-06

收件人：主代理（Tao）／ `src/editorCodeBlock.ts` + `src/editorCommands.ts` 的那一侧（桶 5 编辑器输入/折叠）。
本文件由「收拾半途中断」这一批（代号 `fix-searchpanel`）落盘：上一批（桶 9）把下面这份实现写进了
`src/structuralCodeBlock.ts`，但它的**生产消费方在别人的文件面里**，接线没落、门禁红（零消费方孤儿）。
本批按规约 §2/§3 处理：**删除孤儿 + 把可照抄的整段代码与上游依据原样转到本文件**，等这一侧接。

## W-1 · 代码块导航补上「结构支持」那一半（`CodeBlockSupportHandler.findCodeBlockRange`）

### 判词与上游依据（行号是本批自己数的，逐条复核过）

| 上游相对路径 | 行号 | 说的是什么 |
| --- | --- | --- |
| `platform/lang-impl/src/com/intellij/codeInsight/editorActions/CodeBlockUtil.java` | `:108-120` | `calcBlockEndOffset`：先算括号那半（`:109`），再问结构支持（`:110`），块尾取 `Math.min(结构, 括号)`（`:118`）；结构那半为空区间 ⇒ 用括号那半（`:111-113`）；括号那半是 -1 ⇒ 用结构那半（`:114-116`） |
| 同上 | `:176-188` | `calcBlockStartOffset`：同一对分支，块首取 `Math.max`（`:186`），早退在 `:179-181` / `:182-184` |
| `platform/lang-impl/src/com/intellij/codeInsight/highlighting/CodeBlockSupportHandler.java` | `:57-66` | `findCodeBlockRange`：`TargetElementUtil.adjustOffset`（`:58`）→ 取光标处叶子（`:59`，取不到 ⇒ EMPTY_RANGE `:60`）→ 遍历该语言的 handler，第一个非空区间算（`:62-65`） |
| 同上 | `:47-52` | `getCodeBlockRange` 的契约：「光标所在的最小代码块区间，不在代码块里 ⇒ 空区间」 |
| `platform/lang-impl/src/com/intellij/codeInsight/highlighting/AbstractCodeBlockSupportHandler.java` | `:79-83` / `:66-76` | 往上找第一个 `getBlockElementTypes()` 的祖先取 textRange / 标记区间要求光标压在 keyword 叶子上 |
| `platform/lang-impl/resources/intellij.platform.lang.impl.xml` | `:147` | EP `com.intellij.codeBlockSupportHandler` 的声明 |
| `python/pluginResources/intellij.python.community.impl.xml` | `:439` | **这份（community）树里唯一一条注册**：`<codeBlockSupportHandler language="Python" …PyControlFlowKeywordCodeBlockSupportHandler/>` |
| `python/python-psi-impl/src/com/jetbrains/python/codeInsight/highlighting/PyControlFlowKeywordMatcher.kt` | `:48-59`、`:88-90`、`:119-128`、`:130-137`、`:139-151` | 复合关键字表、"先 offset 再 offset-1"的取叶子、标记区间与语句区间、部件归属、同一条语句的部件收集 |

按 EP 名全树搜（`grep -rn codeBlockSupportHandler`）只有 Python 那一条注册项 ⇒ **Java / C++ / TypeScript 在上游返回
EMPTY_RANGE**，合并那一步自动退化成「只用括号扫描」。本仓对这三种语言同样返回 null，不是少做。
无法核实：Ultimate 侧是否还有别的注册项（本机参考树是 community）。

### 为什么本批接不上（不是"懒得接"）

`findCodeBlockRange` 的唯一消费者是本仓 `src/editorCodeBlock.ts` 的 `blockEndOffset`/`blockStartOffset`
（`src/editorCodeBlock.ts:90-145`，合并点在 `codeBlockTarget`，`:148-150`），而它的调用方是
`src/editorCommands.ts:176`（`codeBlockTarget(text, range.head, forward)`）。
这两个文件都**不在本批的可改面**里（`src/editorCommands.ts` 本批开工时还是别人正在改的在途文件），
规约 §2 写明"派单没写的一律只读"，所以只能走这份请求。

### 要落的两处改动（可照抄）

**① `src/editorCodeBlock.ts`**：在文件头的 import 区（`:23` 之前那一片注释之后）加一行

```ts
// 代码块导航的「结构支持」那一半（CodeBlockSupportHandler.findCodeBlockRange，CodeBlockUtil.java:110/:178）。
import { findCodeBlockRange, mergeBlockEnd, mergeBlockStart } from './structuralCodeBlock.ts'
```

把 `:147-150` 那段 `codeBlockTarget` 整体换成下面这份（多一个 `language` 形参，默认空串 = 不问结构那半，
既有调用方不改也能过类型）：

```ts
/**
 * 光标要落到哪儿（null = 这里没有代码块，命令不吞键）。
 * 上游把两支合起来：括号扫描（`calcBlockEndOffsetFromBraceMatcher` / `…StartOffsetFrom…`）与
 * 结构支持（`CodeBlockSupportHandler.findCodeBlockRange`），块尾取 `Math.min`（`CodeBlockUtil.java:118`）、
 * 块首取 `Math.max`（`:186`），某一半没有时用另一半（`:111-116` / `:179-184`）。
 * 合并规则在 `src/structuralCodeBlock.ts` 的 `mergeBlockEnd`/`mergeBlockStart`，本函数只负责接线。
 */
export function codeBlockTarget(text: string, caret: number, forward: boolean, language = ''): number | null {
  const structural = findCodeBlockRange(text, caret, language)
  return forward
    ? mergeBlockEnd(blockEndOffset(text, caret), structural)
    : mergeBlockStart(blockStartOffset(text, caret), structural)
}
```

**② `src/editorCommands.ts:176`**：把当前语言的标识传进去（这一侧知道语言；上游是按 PSI 叶子的
`getLanguage()` 分的，`BraceMatchingUtil.java:30-33`）：

```ts
    const target = codeBlockTarget(text, range.head, forward, languageId)
```

`languageId` 从编辑器既有的语言/扩展名通道取（这一行由那一侧按自己现成的上下文填；取不到就传空串，
行为与今天完全一致 —— 只有 Python 有结构那半）。

### 待恢复的实现（本批从 `src/structuralCodeBlock.ts` 删掉的原文，逐字）

```ts
// 代码块导航的**结构支持**那一半 —— 判词点名的 `CodeBlockUtil.java:110`/`:178` 那两条
// `CodeBlockSupportHandler.findCodeBlockRange(editor, file)`。
//
// 上游这条链是这样的（行号是本批按参考树逐行数出来的）：
//   · `platform/lang-impl/src/com/intellij/codeInsight/editorActions/CodeBlockUtil.java`
//     `calcBlockEndOffset:108-120` 与 `calcBlockStartOffset:176-188` —— 括号扫描之外**还要**问一次
//     结构支持，然后按两条规则合并：块尾取 `Math.min(结构, 括号)`（`:118`）、块首取
//     `Math.max(结构, 括号)`（`:186`）；结构那半为空区间时用括号那半（`:111-113`/`:179-181`），
//     括号那半是 -1 时用结构那半（`:114-116`/`:182-184`）。
//     本仓已有的括号扫描在 `src/editorCodeBlock.ts`（它自己那份头注释写明「走上游第 3 支的文本等价」），
//     **缺的就是这半条边** —— 见 `docs/wiring-requests-2026-10-06-searchdiff.md` W-1。
//   · `platform/lang-impl/src/com/intellij/codeInsight/highlighting/CodeBlockSupportHandler.java`
//     `findCodeBlockRange:57-66` —— 先 `TargetElementUtil.adjustOffset`（`:58`），取光标处的 PSI 叶子
//     （`:59-60`，取不到 ⇒ EMPTY_RANGE），再遍历该语言的 handler，**第一个非空区间**算（`:62-65`）。
//     `getCodeBlockRange` 的契约在 `:47-52`：「光标所在的最小代码块区间，不在代码块里 ⇒ 空区间」。
//   · `platform/lang-impl/src/com/intellij/codeInsight/highlighting/AbstractCodeBlockSupportHandler.java`
//     `getCodeBlockRange:79-83` = 往上找第一个属于 `getBlockElementTypes()` 的祖先、取它的 textRange；
//     `getCodeBlockMarkerRanges:66-76` = 光标必须压在 keyword 叶子上的那些同类标记。
//   · 这份树里**唯一**注册了这个 EP 的语言是 Python：
//     `python/pluginResources/intellij.python.community.impl.xml:439`
//     （`<codeBlockSupportHandler language="Python" …PyControlFlowKeywordCodeBlockSupportHandler/>`，
//     EP 声明 `platform/lang-impl/resources/intellij.platform.lang.impl.xml:147-149`），
//     实现 `python/src/com/jetbrains/python/codeInsight/highlighting/PyControlFlowKeywordCodeBlockSupportHandler.kt:16-22`
//     → `python/python-psi-impl/src/com/jetbrains/python/codeInsight/highlighting/PyControlFlowKeywordMatcher.kt`
//     的 `compoundStatementRange:125-128`（区间）与 `compoundStatementKeywordRanges:119-122`（标记），
//     关键字表 `COMPOUND_PART_KEYWORDS:48-59`（if/elif/else/for/while/try/except/finally/match/case），
//     归属判定 `enclosingCompoundStatement:130-137`，同一条语句的部件收集 `compoundStatementKeywords:139-151`，
//     「先 offset、再 offset-1」的取叶子规则 `findKeywordContext:88-90`（与
//     `platform/analysis-impl/src/com/intellij/codeInsight/TargetElementUtilBase.java:56-74` 的
//     `adjustOffset` 同一档：光标压在词尾那个字符上时算在这个词里）。
//     它 doc 注释 `PyControlFlowKeywordMatcher.kt:34-35` 写明的多段复合语句就是这一族：
//     `if`/`elif`/`else`、`for`/`else`、`while`/`else`、`try`/`except`/`else`/`finally`、`match`/`case`。
//   · **Java / C++ / TypeScript 在这份树里没有注册 handler**（按 EP 名 `codeBlockSupportHandler` 全树搜
//     只有上面那一条注册项）⇒ 上游对这三种语言 `findCodeBlockRange` 返回 EMPTY_RANGE，合并那一步
//     自动退化成「只用括号扫描」。本仓对这三种语言同样返回 null，**不是本仓少做**，是上游就没有。
//
// 本仓怎么承接：没有 PSI 与 Python parser，所以按**文本 + 缩进**做同一件事 —— Python 的语句归属
// 本来就用缩进表达（`PyStatementPart` 的那条链在文本里就是「同一列上、以复合关键字开头、
// 中间只夹更深缩进行」的若干行）。三元 `x if y else z`、推导式里的 `for`/`if` 上游明确忽略
// （`PyControlFlowKeywordMatcher.kt:84-86`），本仓用「必须是该逻辑行的第一个词、且这一行不在
// 未闭合的括号里」这同一条挡掉。
//
// 无法核实：Ultimate 侧是否还有别的 `codeBlockSupportHandler` 注册项（本机参考树是 community）。

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
```

### 判据测试（本批一并从 `tests/structural-code-block.test.mjs` 删掉，接线时随模块一起恢复）

模块头注释里的那批上游行号 + 下面这 8 条用例就是它的判据；恢复后跑
`node --test tests/structural-code-block.test.mjs tests/editor-code-block.test.mjs`。

```js
// 代码块导航的「结构支持」那一半（判词点名的 `CodeBlockUtil.java:110`/`:178`）。
// 上游依据（行号按参考树逐行数过，与 src/structuralCodeBlock.ts 的头注释同一套）：
//   · `platform/lang-impl/src/com/intellij/codeInsight/editorActions/CodeBlockUtil.java:108-120`（块尾 min）、
//     `:176-188`（块首 max）
//   · `platform/lang-impl/src/com/intellij/codeInsight/highlighting/CodeBlockSupportHandler.java:57-66`
//   · `python/python-psi-impl/src/com/jetbrains/python/codeInsight/highlighting/PyControlFlowKeywordMatcher.kt`
//     `:48-59`（关键字表）、`:88-90`（offset 或 offset-1）、`:119-128`（标记区间与语句区间）、
//     `:130-137`（部件归属）、`:139-151`（同一条语句的部件收集）
import test from 'node:test'
import assert from 'node:assert/strict'

import {
  findCodeBlockRange, mergeBlockEnd, mergeBlockStart,
  pythonCompoundKeywordRanges, pythonCompoundStatement,
} from '../src/structuralCodeBlock.ts'

const caretOn = (text, word, nth = 0) => {
  let at = -1
  for (let i = 0; i <= nth; ++i) at = text.indexOf(word, at + 1)
  assert.ok(at >= 0, `找不到 ${word}`)
  return at
}

test('if/elif/else：光标压在 elif 上时，整条复合语句的区间从头部关键字起、到最后一个部件的块尾止', () => {
  const text = ['if a:', '    x = 1', 'elif b:', '    y = 2', 'else:', '    z = 3', 'w = 4'].join('\n')
  const statement = pythonCompoundStatement(text, caretOn(text, 'elif') + 1)
  assert.ok(statement)
  assert.equal(statement.range.from, 0, 'PSI 的 statement textRange 不含前导缩进（这里本来也没有）')
  assert.equal(statement.range.to, text.indexOf('w = 4') - 1, '块尾在 else 的块之后、下一条语句之前，不含换行')
  assert.deepEqual(pythonCompoundKeywordRanges(text, caretOn(text, 'elif') + 1).map(r => text.slice(r.from, r.to)),
    ['if', 'elif', 'else'], 'compoundStatementKeywordRanges:119-122 按文档顺序给出部件关键字')
})

test('try/except/else/finally 收进同一条链（PyControlFlowKeywordMatcher.kt:34-35 那一族）', () => {
  const text = ['try:', '    a = 1', 'except ValueError:', '    a = 2', 'else:', '    a = 3', 'finally:', '    a = 4', 'b = 5'].join('\n')
  const ranges = pythonCompoundKeywordRanges(text, caretOn(text, 'finally') + 2)
  assert.deepEqual(ranges.map(r => text.slice(r.from, r.to)), ['try', 'except', 'else', 'finally'])
  assert.equal(ranges[0].from, 0)
  const statement = pythonCompoundStatement(text, caretOn(text, 'except') + 1)
  assert.ok(statement)
  assert.equal(statement.range.to, text.indexOf('b = 5') - 1, '最后一个部件的块级也算进来')
})

test('for/while 的 else 属于循环本身，接不上的关键字另起一条语句', () => {
  const loop = ['for i in xs:', '    use(i)', 'else:', '    spare()', 'if c:', '    d()'].join('\n')
  assert.deepEqual(pythonCompoundKeywordRanges(loop, caretOn(loop, 'else') + 1).map(r => loop.slice(r.from, r.to)),
    ['for', 'else'], 'for/else（同文件 :34 的那一档）')
  const second = ['if a:', '    x = 1', 'if b:', '    y = 2'].join('\n')
  const statement = pythonCompoundStatement(second, caretOn(second, 'if', 1) + 1)
  assert.ok(statement)
  assert.equal(statement.range.from, caretOn(second, 'if', 1), '同列的第二个 if 不是第一个 if 的部件：另起一条')
  assert.deepEqual(pythonCompoundKeywordRanges(second, caretOn(second, 'if', 1) + 1).map(r => second.slice(r.from, r.to)), ['if'])
})

test('match/case：case_block 比 match 深一级，两边都能收进同一条语句', () => {
  const text = ['match point:', '    case (1, 2):', '        pass', '    case _:', '        other()', 'x = 1'].join('\n')
  assert.deepEqual(pythonCompoundKeywordRanges(text, caretOn(text, 'case', 1) + 2).map(r => text.slice(r.from, r.to)),
    ['match', 'case', 'case'], '光标在 case 上 ⇒ 往上并上 match（enclosingCompoundStatement:130-137 的那条父子边）')
  assert.deepEqual(pythonCompoundKeywordRanges(text, caretOn(text, 'match') + 3).map(r => text.slice(r.from, r.to)),
    ['match', 'case', 'case'], '光标在 match 上 ⇒ 往下收 case_block')
  const statement = pythonCompoundStatement(text, caretOn(text, 'match') + 3)
  assert.ok(statement)
  assert.equal(statement.range.to, text.indexOf('x = 1') - 1)
})

test('不是语句位置的关键字一律不算（上游 doc 注释里那句「三元 if/else、推导式 for 忽略」）', () => {
  const ternary = 'value = 1 if flag else 2'
  assert.equal(pythonCompoundStatement(ternary, caretOn(ternary, 'else') + 1), null)
  const comprehension = 'total = [n for n in ns]'
  assert.equal(pythonCompoundStatement(comprehension, caretOn(comprehension, 'for') + 1), null)
  const wrapped = ['values = (', '    1', '    for n in ns', ')'].join('\n')
  assert.equal(pythonCompoundStatement(wrapped, caretOn(wrapped, 'for') + 1), null, '未闭合括号里的续行不是逻辑行的开头')
  const body = ['if a:', '    x = 1'].join('\n')
  assert.equal(pythonCompoundStatement(body, caretOn(body, 'x') + 1), null, '光标不在关键字上 ⇒ EMPTY_RANGE 那一档')
  assert.equal(pythonCompoundStatement('else:\n    x = 1', 1), null, '没有头部的 else 不是复合语句')
})

test('光标压在词尾之后那一个字符上仍算这个词（TargetElementUtilBase.java:56-74 + findKeywordContext:88-90）', () => {
  const text = ['if a:', '    x = 1', 'else:', '    y = 2'].join('\n')
  const after = caretOn(text, 'else') + 'else'.length
  assert.equal(after, text.indexOf('else') + 4, '光标紧贴关键字之后')
  assert.ok(pythonCompoundStatement(text, after))
  assert.equal(pythonCompoundStatement(text, after + 1), null, '再往右一格就离开关键字了')
})

test('只有 Python 注册了这个 EP：其余语言返回 null（= 上游的 EMPTY_RANGE）', () => {
  const text = ['if a:', '    x = 1', 'else:', '    y = 2'].join('\n')
  const caret = caretOn(text, 'else') + 1
  assert.ok(findCodeBlockRange(text, caret, 'python'))
  assert.equal(findCodeBlockRange(text, caret, 'py')?.from, 0)
  assert.equal(findCodeBlockRange(text, caret, 'java'), null)
  assert.equal(findCodeBlockRange(text, caret, 'typescript'), null)
  assert.equal(findCodeBlockRange(text, caret, 'cpp'), null)
})

test('块尾取 min、块首取 max；某一半没有时不合并（CodeBlockUtil.java:108-120、:176-188）', () => {
  const block = { from: 10, to: 40 }
  assert.equal(mergeBlockEnd(30, block), 30, ':118 min(结构 40, 括号 30)')
  assert.equal(mergeBlockEnd(50, block), 40, ':118 min(结构 40, 括号 50)')
  assert.equal(mergeBlockEnd(null, block), 40, ':114-116 括号那半是 -1 ⇒ 用结构那半')
  assert.equal(mergeBlockEnd(30, null), 30, ':111-113 结构那半为空 ⇒ 用括号那半')
  assert.equal(mergeBlockStart(20, block), 20, ':186 max(结构 10, 括号 20)')
  assert.equal(mergeBlockStart(5, block), 10, ':186 max(结构 10, 括号 5)')
  assert.equal(mergeBlockStart(null, block), 10, ':182-184')
  assert.equal(mergeBlockStart(20, null), 20, ':179-181')
  assert.equal(mergeBlockEnd(null, null), null, '两边都没有 ⇒ 本仓的「不吞键」那一档（上游 -1）')
})
```

### 附：还差的一件事（接线那一侧补）

`tests/editor-code-block.test.mjs` 现在钉的是「只用括号扫描」那一条链。合并边一旦接上，需要补一条
判据：**Python 文档里光标压在 `elif` 上时，`codeBlockTarget(…, true, 'python')` 走的是 min(结构, 括号)
而不是括号那半**（上游 `CodeBlockUtil.java:118`），否则这条边又被退回成括号那一支而没人发现。
