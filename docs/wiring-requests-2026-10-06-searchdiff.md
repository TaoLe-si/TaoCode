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

---

# 增补 · `searchdiff` lane（2026-10-06 17:0x）· 桶9「搜索 / 比对」族接线请求收拢

收件人：主代理。来源 lane：`findrep2`、`ssreplace`、`ss4`、`diffverdict`、本 lane。
**本 lane 一行保留文件都没动**（`src/App.vue` / `src/bridge.ts` / `src/components/CodeEditor.vue` / `native/main.cpp` / `docs/inventory/**` 全程只读）。
下面每一条的**出口名与行号都是本 lane 自己打开文件核对过的当前值**；与来源 lane 原文不一致的地方**显式写"对不上"**。
行数口径统一用 `tests/module-size.test.mjs:157` 的 `readFileSync(...).split('\n').length`（**比 `wc -l` 多 1**），门就是这么判的。

| 保留文件 | 现在（门口径） | 上限 | **真实余量** |
| --- | --- | --- | --- |
| `src/App.vue` | 2713 | 2737 | **24**（⇦ 派单里流传的"30"是错的，实测少 6 行） |
| `src/bridge.ts` | 905 | 905 | **0 贴顶**（只能就地改，多一个换行就红） |
| `src/components/CodeEditor.vue` | 1145 | 1147 | **2** |
| `native/main.cpp` | 1846 | 2000 | **154**（上限被 `module-size.test.mjs:46` 钉死"新能力一律抽成 `native/xxx.cpp`"） |
| `src/components/SearchPanel.vue` | 898 | 900（未登记，走默认） | **2** |

## 销账 · 本文件上面的 W-1 **已经落地了**，请关掉它（别再"恢复"那 321 行）

`fix-searchpanel` 批写这份请求时，实现被从 `src/structuralCodeBlock.ts` 删走、消费方在别人的文件面里。现在磁盘上两半都在：

- **① 已接**：`src/editorCodeBlock.ts:41` `import { findCodeBlockRange, mergeBlockEnd, mergeBlockStart } from './structuralCodeBlock.ts'`；`:168` `export function codeBlockTarget(text, caret, forward, language = '')`，`:169-172` 正是请求里那份合并体。
- **② 已接**：`src/editorCommands.ts:50` 引 `editorLanguageId`、`:187` `codeBlockTarget(text, range.head, forward, state.facet(editorLanguageId) ?? '')`（语言档 facet 真源 `src/editorMatchBrace.ts:51`，挂载点 `src/components/CodeEditor.vue:91` + `:481`）。
- **实现本体**：`src/structuralCodeBlock.ts:532 findCodeBlockRange` / `:541 mergeBlockEnd` / `:548 mergeBlockStart`（另带 `:409 pythonCompoundStatement`、`:515 pythonCompoundKeywordRanges`）。
- **「附：还差的那一条判据」也已补**：`tests/editor-code-block.test.mjs:98`「合并块尾取 min(结构, 括号)（CodeBlockUtil.java:118）」、`:116`「括号那半扫不到 ⇒ 用结构那半」（fixture 光标压在 `elif` 上）。本 lane 复跑 `node --test tests/editor-code-block.test.mjs` ⇒ **tests 17 / pass 17 / fail 0**。

⇒ **风险**：本文件 `:73-508` 那 321 行「待恢复的实现（逐字）」现在与 `src/structuralCodeBlock.ts` 里的真源**内容重复**。下一个读到它的人若照单"恢复"，就会做出第二份真源（本仓反复踩的那类坑）。请把 `:73-508` 标成**过期/仅供对账**，不要执行。

## W-2 · 工程内替换的「保留大小写」全链（来源 `findrep2`；出口名逐条复核，**全部对得上**）

上游依据本 lane 自己开树复量过（不是转抄）：`platform/util/resources/misc/registry.properties:1414` 确为 `ide.find.word.based.preserve.case=true`；`platform/lang-impl/src/com/intellij/find/impl/FindManagerBase.java:293-295` 确为 `Registry.is(...) ? PreserveCaseUtil.applyCase(foundString, replacement) : PreserveCaseUtil.replaceWithCaseRespect(replacement, foundString)`；`platform/indexing-api/src/com/intellij/find/FindModel.kt:411` 确为 `var isPreserveCase: Boolean = false`。⇒ 用户档默认关、算法默认逐词，两件事不矛盾。

按依赖顺序，每条给「真实出口名（本 lane 打开核过）+ 净行数 + 余量」：

| 序 | 目标 | 真实出口名 / 位置（实测） | 要加什么 | 净行数 / 余量 |
| --- | --- | --- | --- | --- |
| 1 | `native/main.cpp`（保留） | `:1300` `case "workspace.files"_h: case "search.run"_h: case "search.replace"_h: case "search.preview"_h: case "search.replaceSelected"_h: {`，其下 `:1302-1310` 逐字段 `params.value(...)`（`:1305` = `options.case_sensitive = params.value("caseSensitive", true);`） | `options.preserve_case = params.value("preserveCase", false);` | **+1 / 154** ✓ 挂得上 |
| 2 | `native/search.hpp` | `:15` `struct Options {`，字段实测 `:16 query`、`:17 replacement`、`:18 regex`、`:19 case_sensitive`、`:20 whole_word`（findrep2 说的 `:15-22` 里 `:21-22` 其实是 `include/exclude`，`Options` 到 `:26` 还有 `cancelled`） | `bool preserve_case = false;` | +1（该文件 93 行，非保留） |
| 3 | `native/search.cpp` | 两个生效点实测**与 findrep2 写的一致**：`:750` `if (match) result += build_replacement(...)`（`replace()` 内联）、`:778` `static std::string substitution_text(...)` 且 `:782` 那一行调 `build_replacement`；`build_replacement` 本体在 `:503`；`preview()` `:797` 走 `:830`、`replace_selected()` `:861` 走 `:904` | 两处各包一层 `apply_preserve_case(options.preserve_case, found, text)`，算法照 `src/preserveCase.ts:143 applyCase` | ~+6 / 176（该文件 924 行，native 默认上限 1100） |
| 4 | `src/bridge.ts`（保留，**余量 0**） | `:192` `export interface SearchOptions { query: string; regex: boolean; caseSensitive: boolean; wholeWord: boolean; include: string; exclude: string }` —— **一行式，就地加 `preserveCase: boolean` 净 0** | 只能在同一行内改；**写成多行立刻把 `module-size` 判红** | +0 / 0 |
| 5 | `src/components/SearchPanel.vue`（非保留，余量 **2**） | 现有三颗 `fs-toggle` 在 `:641-643`（`caseSensitive`/`regex`/`wholeWord`），无 preserve；确认语两处已改调 `replaceAllConfirmNote`（`:437`、`:446`） | 一颗 toggle + 一个 `ref` | +2 ⇒ **正好顶到 900**。先在该文件内腾 2 行（或把 toggles 抽成子组件）再加 |
| 6 | 开关文案 | 上游图标 `AllIcons.Actions.PreserveCase` 本仓无对应物；现成先例 = `src/components/EditorFindBar.vue:212` 那颗 `Aa`（`:41` 已有 `preserveCase: boolean` prop） | 复用文本档 `Aa`，不新造图标键 | 面板侧 |
| 7 | 持久化 | 若要记住这一档，新键**缺键补默认**（先例 `src/editorFindController.ts:143` 写 `taocode.findOptions`、`:29-30` 用 `Boolean(parsed.preserveCase)` 读回） | 缺键 = `false` | — |

**挂不上的退化后果**：编辑器查找栏的「保留大小写」已经生效（`src/editorFindController.ts:231` → `preserveCaseReplacement`），工程内替换那一半只能原样插入 ⇒ **同一个功能在两个入口行为分叉**；`src/preserveCase.ts` 的逐词算法在上游是两支共用（`FindManagerBase.getStringToReplace`），本仓只有 JS 侧一份 ⇒ 上游那一档在本仓只落地了一半。
**不许做的事**：只加面板开关不接链路 = 假控件（本仓规则⑧）；findrep2 已经据此**故意没加**那颗 toggle。

## W-3 · Python 结构块在生产里走不到（来源 `ss4` §六.1；**它点名的文件有一处不准**）

- `ss4` 原文说"涉及 `src/bridge.ts`" ⇒ **不准确**：真正的档表是 **`src/languages.ts:8`** `export const EDITOR_LANGUAGES = ['java', 'cpp', 'typescript', 'other'] as const`（全仓唯一一份）。`src/bridge.ts:87` 只是 `export { EDITOR_LANGUAGES } from './languages.ts'` 原样转出 ⇒ **不需要动余量 0 的 `src/bridge.ts`**。这是"名字对不上就写清真名"的现例。
- 名单（实测）：`src/languages.ts:8`（同数组加 `'python'`，**净 0**）→ `src/editorLanguage.ts:15-18`（加一条 `forced === 'python'` 分支）→ `src/appLanguageLabels.ts:15`（`languageLabels` 那张 `Record`，现写 `java/cpp/typescript/other`）→ `src/components/FileTypesPage.vue`（**名字对、文件在**，35 KB）→ `src/components/CodeEditor.vue:91` / `:481`（`editorLanguageIdExtension` 挂载链，**余量 2**）。
- **硬门槛（本 lane 实测）**：`@codemirror/lang-python` **既不在 `package.json`（现有 `lang-java`/`lang-cpp`/`lang-javascript`/`lang-css`/`lang-html`）也不在 `node_modules`** ⇒ 这条不是"加一行语言档"，要引新依赖；`src/fileTypeRegistry.ts:819` 那条 `{ id: 'Python', … language: 'other' }` 与 `:850 seedHashBang('Python', ['python'])` 只给**类型名**，词法层仍是空的（`src/fileTypeDetection.ts:59` 同理把 python shebang 判成 `language: 'other'`）。
- **挂不上的退化后果**：`src/structuralCodeBlock.ts` 的 Python 那一整块（`:409`、`:515`、`:532`）在生产里永远收到 `language='other'` ⇒ `findCodeBlockRange` 返回 null，刚销账的 W-1 只剩括号那半在跑，**判据全绿但链路不通**（本仓典型的"有判据没实现"变体）。上游只有 Python 注册了这个 EP（`python/pluginResources/intellij.python.community.impl.xml:439`），所以 Java/C++/TS 返回 null 不是少做 —— 但 Python 这条在本仓是**真缺**。
- 无法核实：Ultimate 侧是否另有 `codeBlockSupportHandler` 注册项（本机是 community 树）。

## W-4 · `VcsLogTable` 速度搜索多字符追加仍丢（来源 `ssreplace` §1；**出口名全对、行号已漂**）

`ssreplace` 写的行号对不上当前文件（`src/components/VcsLogTable.vue` 现在 301 行，且被别路改着：numstat +103/−38）。本 lane 实测的当前值：

| 名字 | ssreplace 原文 | **实测现在** |
| --- | --- | --- |
| `focusHash` | `:92-98` | **`:114`** `async function focusHash(hash: string)` |
| 抢焦点那一行 | `:96-97` | **`:118`** `const row = list.value?.querySelector<HTMLElement>(\`[data-index="${index}"]\`)` + 紧随的 `row?.focus()` |
| 命中后定位 | `:92-98` | **`:152`**（`void focusHash(commit.hash)`）、**`:217`**（`emit('select', …)` 后 `void focusHash(…)`） |
| `onSearchInput` / 覆盖串 | `:178-182`、`:132-133` | **`:154-155`** `function onSearchInput(value) { search.value = value }`、**`:202-203`** 键路（`searchOpen.value = true` → `onSearchInput(event.key)`） |
| 共享件挂载 | — | **`:224`** `<SpeedSearchBar :open="searchOpen" :query="search" …>`；对外暴露 **`:219`** `defineExpose({ focusHash })` |

请求（归 vcsLog lane）：速度搜索激活期间命中定位只做 `scrollIntoView`、**不要** `row?.focus()`；或改吃 `src/speedSearch.ts` 的 `speedSearchNextInput` 状态机（先例 `src/components/TodoPanel.vue:8` import、`:191` 调用），让"框在场 = 追加"由同一真源决定，不靠 DOM 焦点是否守住。
**退化后果**：`src/components/SpeedSearchBar.vue`（ssreplace 15:25 已把焦点收放上移到 `watch(open)`）修不到这块面板 ⇒ 在 VCS 日志上连打两个字符仍只留最后一个 = 上游 SpeedSearch「输入框在场时追加」在这一处仍缺。
**引用警告**：`src/speedSearch.ts` 在本 lane 核对期间被 `ssmatch` 改写（mtime 13:41:33 → **17:02:48**，353 → **392** 行）⇒ 引用它的**行号一律现取现说**，别照抄本报告或它报告里的数字。

## W-5 · 可选清理（非必须，`ssreplace` §2）

`src/components/FileTree.vue:231`（该文件现在 315 行）在 `openSpeedSearch()` 里自己 `querySelector('.speed-search-input').focus()` —— 焦点收放已上移到 `SpeedSearchBar.vue`，这处冗余但无害；删不删归 project-tree lane，`tests/speed-search-wiring.test.mjs` 只钉接线存在、不钉这行。

## 门禁现状（本 lane 现跑，供主代理决定优先级）

- 族门 `node --test tests/find*.test.mjs tests/search*.test.mjs tests/replace*.test.mjs tests/speed-search*.test.mjs tests/diff*.test.mjs tests/module-size.test.mjs` ⇒ **371 / 371 / 0 红**（16:53–16:55 的树；`tests/replace*.test.mjs` **无匹配文件**）。
- 死模块门 `node .tools/find-orphan-modules.mjs --gate` ⇒ **绿**（已登记孤儿 6 / 基线 8 · 新增 0 · 本轮清掉 2）⇒ **基线该由主代理下调到 6**。
- 引用门 `node --test tests/source-citations.test.mjs tests/source-citation-anchors.test.mjs` ⇒ 11 / 8 / **3 红**（1 条越界行号在 `docs/batch-2026-10-06-findrep2.md`，4 条 moved 锚点在 `src/commitChecks.ts`、`src/components/ProblemsPanel.vue`×2、`src/runStartupFocus.ts`）⇒ **全部不归桶9**，详见 `docs/batch-2026-10-06-searchdiff.md` §6。
- 桶9 判决门 `tests/b9-verdict.test.mjs` **9/9 绿**、`tests/b7-verdict.test.mjs` **10/10 绿**。

## 处理结果（wiring-backlog lane，2026-10-06）

- **W-1** —— 请求原文自述「已经落地了，请关掉它」。**W-2（保留大小写全链）** —— 与 findrep2 同一条（跨 VCS lane / bridge），转 owner。
- **W-3（Python 结构块）** —— `package.json`（保留），非本 lane。
- **W-4（VcsLogTable 速度搜索追加）** —— `src/components/VcsLogTable.vue`（本 lane，属 VCS 半区），登记。
- **W-5** —— 可选清理。

结论：零接线（W-1 已落，W-2 转 owner，W-4 登记）。

## 处理结果（接线 lane，2026-10-06）

复核（对当前工作区代码逐条核对）：上一条 `wiring-backlog lane` 的分解已逐项复核，其结论为「零接线（W-1 已落，W-2 转 owner，W-4 登记）。」。
本 lane 本轮接线：无 —— 本份请求的挂载点目标均落在禁改/非本 lane 面（`src/components/CodeEditor.vue`、`src/bridge.ts`、`native/**`、`src/settingsModel.ts`、`src/keymapBindings.ts`、`src/*.ts` 等），或为上一条记录里的「登记待办 / 判定项」。
