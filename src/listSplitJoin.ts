// 列表拆行 / 合行（上游两个 intention：`SplitLineIntention` / `JoinLinesIntention`）——
// 纯文本档：给文本 + 选区，算出新文本 + 新选区。零 Vue、零 DOM。
//
// 上游是什么（逐条打开确认存在，行号是本地基准树实测值）：
//  · 两个 intention 的类体 `platform/lang-impl/src/com/intellij/openapi/editor/actions/lists/ListSplitJoinIntentions.kt`
//    —— `SplitLineIntention:76-85`、`JoinLinesIntention:88-97`，都继承 `SplitJoinIntention:18-73`；
//    `:26-30` 的 `isAvailable` 把 `getIntentionText(...)` 写进 `text`（弹层里显示的那一行）；
//    `:32-49` 的 `invoke` 取 `data.list.textRange` 做 rangeMarker、逐条套 `getReplacements`（`:42-44`），
//    最后 `:47` 对 marker 的区间做 `reformatRange`；`:56-67` 的 `validateOrder` 要求替换区间升序。
//  · 注册：`platform/lang-impl/resources/intellij.platform.lang.impl.xml:635-640`（JoinLinesIntention）
//    与 `:641-646`（SplitLineIntention），两个都是 `<language/>` 空 ⇒ 所有语言都挂，
//    `categoryKey` = `intention.category.other`（文案 `platform/lang-api/resources/messages/LangBundle.properties:493`）。
//  · 触发方式：**Alt+Enter 的意图弹层**（`ShowIntentionActions`，键位
//    `platform/platform-resources/src/keymaps/$default.xml:480-482` = `alt ENTER`）；
//    这两个动作**没有自己的键位**（`$default.xml` 1308 行里没有它们的 `id`，它们不是 action 而是 intention）。
//  · 规则真源：`…/lists/DefaultListSplitJoinContext.kt`（纯文本档的默认实现，本文件逐条照抄）
//    与 `…/lists/ListSplitJoinContext.kt`（接口 `:27-74` + 语言扩展点 `:29-31` / `:79-90`）。
//    逗号档 `CommaListSplitJoinContext`（`DefaultListSplitJoinContext.kt:315-358`）：分隔符就是 `,`
//    （`:316` 的 `isSeparator` 委托给 `:360` 的 `isComma` = `element is LeafElement && textMatches(",")`）。
//    尾逗号档 `TrailingComma`（`:313`）默认 `IGNORE`（`:355-357`）—— 全树 `grep "override fun getTrailingComma"`
//    零命中 ⇒ **不添也不删尾逗号**，本仓照此。
//
// 本仓的架构还原（没有 PSI / CodeStyleManager）：
//  · 上游的 `data.list` / `data.elements` / `PsiWhiteSpace` / `PsiComment` 用「最内层括号对 +
//    顶层分隔符切段 + 词法空白/注释 token」逼近（`scanListTokens` / `listSpanAt`）。
//    **语言元素识别那半不移植** —— Java 的 `JavaSplitJoinArgumentsContext` 一族要 PSI
//    （`java/java-impl/src/com/intellij/codeInsight/intention/impl/lists/JavaListSplitJoinContexts.kt:21-85`），
//    这里只做「分隔符 ↔ 换行」这一档。
//  · 上游 `reformatRange`（`DefaultListSplitJoinContext.kt:90-91`）调 `CodeStyleManager.adjustLineIndent`，
//    契约是「**只**重算行首空白、其余空白原样」（`platform/core-api/src/com/intellij/psi/codeStyle/CodeStyleManager.java:171-179`）；
//    本仓按「列表首行缩进 + 一个缩进单位」重算**拆出来的续行**（`listContinuationIndent`）。
//    上游能处理嵌套续行与语言专属对齐，本仓这一档做不到（如实登记在回复的「无法核实/落差」里）。
//  · `listValidateRange`（`:229-234` + `:245-265`）在默认档下等价于「列表里**顶层**不许有注释」
//    （默认 `isValidIntermediateElement` 只认空白，`:34`）。
//
// 与 `src/editorTextCommands.ts` 的关系：**形状完全一致**，所以**直接复用**它已定的
// `TextEdit` / `TextSelection` / `TextCommandResult` 与 `applyEdits`（那边就是上游
// `document.replaceString` 逐条套用的等价物），本模块不写第二份。

import { lineAt, lineStarts } from './autoIndentLines.ts'
import { applyEdits } from './editorTextCommands.ts'
import type { TextCommandResult, TextEdit, TextSelection } from './editorTextCommands.ts'

/** 括号对（与 `src/editorCodeBlock.ts:43-44` / `src/structuralCodeBlock.ts:87-88` 同一批字符）。 */
const OPENERS = '([{'
const CLOSERS = ')]}'
const MATCHING: Record<string, string> = { '(': ')', '[': ']', '{': '}' }

/** 列表内容里的一个词法 token（对应上游 `list` 的一个兄弟节点）。 */
export interface ListToken {
  kind: 'space' | 'comment' | 'separator' | 'code' | 'open' | 'close'
  from: number
  to: number
  /** 该 token **之前**的括号深度；`close` 用配对开括号那一层（即内容层 - 1）。 */
  depth: number
}

/** 一个可拆/可合的列表：`open` 是开括号偏移，`close` 是配对闭括号偏移。 */
export interface ListSpan {
  open: number
  close: number
  /** 列表内容层的深度（= 开括号那一层 + 1）；分隔符都取这一层。 */
  depth: number
  /** 顶层分隔符偏移，升序（上游 `isSeparator` 为真的那些兄弟节点）。 */
  separators: number[]
  /** 顶层元素（两端已去空白），升序；上游 `data.elements`。 */
  elements: { from: number; to: number }[]
  /** 覆盖整个列表区间的 token（`listSpanAt` 顺手给出，免得调用方重扫一遍）。 */
  tokens: ListToken[]
}

/** 拆/合的一次落地：新文本 + 新选区 + 可 dispatch 的编辑（与 `editorTextCommands` 同形状）。 */
export interface ListPlan extends TextCommandResult {
  edits: TextEdit[]
}

// ── 词法扫描 ────────────────────────────────────────────────────────────────────────────

/** 跳过一段字符串字面量（返回闭引号之后；未闭合的引号不外溢到下一行，同 `structuralCodeBlock`）。 */
function skipString(text: string, at: number, quote: string): number {
  let i = at + 1
  while (i < text.length) {
    const ch = text[i]!
    if (ch === '\\') { i += 2; continue }
    if (ch === quote) return i + 1
    if (ch === '\n' && quote !== '`') return i
    ++i
  }
  return text.length
}

/** 一段「算代码」的连续字符（字符串整段吞掉，所以串里的分隔符不算分隔符）。 */
function consumeCodeRun(text: string, at: number, separator: string): number {
  let i = at
  while (i < text.length) {
    const ch = text[i]!
    if (/\s/.test(ch)) break
    if (OPENERS.includes(ch) || CLOSERS.includes(ch)) break
    if (separator !== '' && ch === separator) break
    if (ch === '/' && (text[i + 1] === '/' || text[i + 1] === '*')) break
    if (ch === '#') break
    if (ch === '"' || ch === '\'' || ch === '`') { i = skipString(text, i, ch); continue }
    ++i
  }
  return i
}

/**
 * 扫全文，切出空白 / 注释 / 括号 / 分隔符 / 其余代码五种 token。
 * `separator === ''` = 这一档没有分隔符（上游 `XmlAttributesSplitJoinContext.isSeparator` 恒 false，
 * `xml/impl/src/com/intellij/codeInsight/intentions/XmlAttributesSplitJoinContext.kt:31`）。
 * 行注释同时认 `//` 与 `#`（与 `src/structuralCodeBlock.ts:95-98` 同一档口径，理由写在那里）。
 */
export function scanListTokens(text: string, separator = ','): ListToken[] {
  const tokens: ListToken[] = []
  let level = 0
  let at = 0
  while (at < text.length) {
    const ch = text[at]!
    const next = text[at + 1]
    if (/\s/.test(ch)) {
      let to = at + 1
      while (to < text.length && /\s/.test(text[to]!)) ++to
      tokens.push({ kind: 'space', from: at, to, depth: level })
      at = to
      continue
    }
    if ((ch === '/' && next === '/') || ch === '#') {
      const eol = text.indexOf('\n', at)
      const to = eol < 0 ? text.length : eol
      tokens.push({ kind: 'comment', from: at, to, depth: level })
      at = to
      continue
    }
    if (ch === '/' && next === '*') {
      const end = text.indexOf('*/', at + 2)
      const to = end < 0 ? text.length : end + 2
      tokens.push({ kind: 'comment', from: at, to, depth: level })
      at = to
      continue
    }
    if (OPENERS.includes(ch)) {
      tokens.push({ kind: 'open', from: at, to: at + 1, depth: level })
      ++level
      ++at
      continue
    }
    if (CLOSERS.includes(ch)) {
      level = Math.max(0, level - 1)
      tokens.push({ kind: 'close', from: at, to: at + 1, depth: level })
      ++at
      continue
    }
    if (separator !== '' && ch === separator) {
      tokens.push({ kind: 'separator', from: at, to: at + 1, depth: level })
      ++at
      continue
    }
    const to = consumeCodeRun(text, at, separator)
    const end = Math.max(to, at + 1)
    tokens.push({ kind: 'code', from: at, to: end, depth: level })
    at = end
  }
  return tokens
}

/** 从 `[from, to)` 里切出一个元素：两端去空白，空的丢掉（尾逗号后面那一段不是元素）。 */
function pushElement(text: string, from: number, to: number, out: { from: number; to: number }[]): void {
  let lo = from
  while (lo < to && /\s/.test(text[lo]!)) ++lo
  let hi = to
  while (hi > lo && /\s/.test(text[hi - 1]!)) --hi
  if (hi > lo) out.push({ from: lo, to: hi })
}

/** 由一对配好的括号 token 建出 `ListSpan`（顶层分隔符切段，段两端去空白即元素）。 */
function buildSpan(text: string, tokens: ListToken[], openIdx: number, closeIdx: number): ListSpan {
  const opener = tokens[openIdx]!
  const closer = tokens[closeIdx]!
  const depth = opener.depth + 1
  const separators: number[] = []
  const elements: { from: number; to: number }[] = []
  let segStart = opener.to
  for (let i = openIdx + 1; i < closeIdx; ++i) {
    const token = tokens[i]!
    if (token.kind === 'separator' && token.depth === depth) {
      separators.push(token.from)
      pushElement(text, segStart, token.from, elements)
      segStart = token.to
    }
  }
  pushElement(text, segStart, closer.from, elements)
  return { open: opener.from, close: closer.from, depth, separators, elements, tokens }
}

/**
 * 光标处**最内层**的那个列表；不在任何括号里返回 null。
 * 元素不足两个仍返回 span（上游 `extractData` 照样给 `ListWithElements`，
 * 「够不够拆」由 `isSplitAvailable`（`:84`）判 —— 所以可用性在 `splitListPlan`/`joinListPlan` 那一层判）。
 */
export function listSpanAt(text: string, offset: number, separator = ','): ListSpan | null {
  const tokens = scanListTokens(text, separator)
  const stack: number[] = []
  let best: { openIdx: number; closeIdx: number } | null = null
  for (let i = 0; i < tokens.length; ++i) {
    const token = tokens[i]!
    if (token.kind === 'open') { stack.push(i); continue }
    if (token.kind !== 'close') continue
    const openIdx = stack.pop()
    if (openIdx === undefined) continue
    const opener = tokens[openIdx]!
    if (MATCHING[text[opener.from]!] !== text[token.from]) continue
    if (opener.from > offset || offset > token.from) continue
    if (!best || opener.depth > tokens[best.openIdx]!.depth) best = { openIdx, closeIdx: i }
  }
  return best ? buildSpan(text, tokens, best.openIdx, best.closeIdx) : null
}

/**
 * 上游 `validateRange:229-234` + `validateHeadOrTail:245-265` 在**默认档**下的等价物：
 * `isValidIntermediateElement` 默认只认空白（`:34`）⇒ 列表内容层里出现注释就不允许拆/合。
 * （Java 覆写它放行块注释，见 `JavaListSplitJoinContexts.kt:22-25` —— 本仓不做语言那半。）
 */
export function listValidateRange(span: ListSpan): boolean {
  for (const token of span.tokens) {
    if (token.kind !== 'comment') continue
    if (token.from < span.open || token.from > span.close) continue
    if (token.depth === span.depth) return false
  }
  return true
}

// ── 上游的 nextBreak / prevBreak / skipAcceptableElements / findOffsetForBreakAfter ──────

/** 含换行的那个空白 token（`textContains('\n')`）。 */
function isLineBreak(text: string, token: ListToken): boolean {
  return token.kind === 'space' && text.slice(token.from, token.to).includes('\n')
}

/** 上游 `nextBreak:76-78` → `nextPrevBreak(..., true)`（`:220-227`）。 */
function nextBreakAfter(text: string, span: ListSpan, element: { from: number; to: number }): ListToken | null {
  for (const token of span.tokens) {
    if (token.from < element.to) continue
    if (token.to > span.close + 1) break
    if (isLineBreak(text, token)) return token
    if (token.kind === 'space') continue
    if (token.kind === 'separator' && token.depth === span.depth) continue
    break
  }
  return null
}

/** 上游 `prevBreak:69-71` → `nextPrevBreak(..., false)`。 */
function prevBreakBefore(text: string, span: ListSpan, element: { from: number; to: number }): ListToken | null {
  for (let i = span.tokens.length - 1; i >= 0; --i) {
    const token = span.tokens[i]!
    // 断行可以**紧贴**元素起点（`f(\n a, b)` 里首元素之前那个空白 `to == element.from`）⇒ 用 `>`。
    if (token.to > element.from) continue
    if (token.from < span.open + 1) break
    if (isLineBreak(text, token)) return token
    if (token.kind === 'space') continue
    if (token.kind === 'separator' && token.depth === span.depth) continue
    break
  }
  return null
}

/**
 * 上游 `findOffsetForBreakAfter:184-192`：跳过元素后的空白（`skipAcceptableElements:200-210`），
 * 后面是分隔符就落在**分隔符之后**，否则落在最后一段空白之后（没有空白就是元素末尾）。
 */
function breakOffsetAfter(text: string, span: ListSpan, element: { from: number; to: number }): number {
  let lastSpaceEnd = element.to
  for (const token of span.tokens) {
    if (token.from < element.to) continue
    if (token.to > span.close + 1) break
    if (token.kind === 'space') { lastSpaceEnd = token.to; continue }
    if (token.kind === 'separator' && token.depth === span.depth) return token.to
    break
  }
  return lastSpaceEnd
}

// ── 上游 getReplacementsForSplitting / getReplacementsForJoining ─────────────────────────

/**
 * 拆行的编辑（`DefaultListSplitJoinContext.kt:93-117`）。
 * 逐条：`:100` 头那一支（`needHeadBreak` 默认 false ⇒ 默认档不插）；`:103-109` 每个非末元素，
 * `:104` 已经有断行的跳过，`:105-107` 在 `findOffsetForBreakAfter` 处插 `"\n"`；
 * `:112` 一条内层替换都没有 ⇒ 返回空（**已经拆开过的列表不再可用**）；
 * `:114` 尾那一支（`needTailBreak` 默认 false ⇒ 不插）。
 * 本仓多做的两件：`:105-107` 之后紧跟的空白（`a, b` 里逗号后那个空格）一并换成
 * 「换行 + 续行缩进」—— 上游由 `reformatRange` 的 `adjustLineIndent` 重算那一段行首空白（`:90-91`），
 * 本仓没有 CodeStyleManager，所以在编辑里直接给出缩进（`listContinuationIndent`）。
 */
export function listSplitEdits(text: string, span: ListSpan, indentUnit: string, separator = ','): TextEdit[] {
  if (span.elements.length <= 1 || !listValidateRange(span)) return []
  const indent = listContinuationIndent(text, span, indentUnit)
  const edits: TextEdit[] = []
  for (let i = 0; i < span.elements.length - 1; ++i) {
    const element = span.elements[i]!
    if (nextBreakAfter(text, span, element)) continue
    const at = breakOffsetAfter(text, span, element)
    let to = at
    while (to < span.close && (text[to] === ' ' || text[to] === '\t')) ++to
    edits.push({ from: at, to, insert: `\n${indent}` })
  }
  return edits
}

/**
 * 合行的编辑（`DefaultListSplitJoinContext.kt:119-137`）。
 * 逐条：`:126` 头（`!needHeadBreak` ⇒ 默认档走这一支，`:151-157`）把首元素**之前**那个断行换成
 * `getHeadBreakJoinReplacement`（默认 `""`，`:182`）；`:128-132` 每个非末元素，把 `nextBreak` 那个
 * 断行换成 `" "`（`:130`）并再删掉紧跟的空白兄弟（`:212-218`，本仓空白是一个 token，一次替换即可）；
 * `:134` 尾（`!needTailBreak` ⇒ 默认档走，`:172-178`）把末元素**之后**那个断行换成
 * `getTailBreakJoinReplacement`（默认 `""`，`:181`）。
 */
export function listJoinEdits(text: string, span: ListSpan, separator = ','): TextEdit[] {
  if (span.elements.length <= 1 || !listValidateRange(span)) return []
  const edits: TextEdit[] = []
  const first = span.elements[0]!
  const last = span.elements[span.elements.length - 1]!
  const head = prevBreakBefore(text, span, first)
  if (head) edits.push({ from: head.from, to: head.to, insert: '' })
  for (let i = 0; i < span.elements.length - 1; ++i) {
    const brk = nextBreakAfter(text, span, span.elements[i]!)
    if (brk) edits.push({ from: brk.from, to: brk.to, insert: ' ' })
  }
  const tail = nextBreakAfter(text, span, last)
  if (tail) edits.push({ from: tail.from, to: tail.to, insert: '' })
  return edits
}

/**
 * 拆出来的续行该缩进到哪（上游 `reformatRange` → `adjustLineIndent`，`DefaultListSplitJoinContext.kt:90-91`；
 * 契约见 `CodeStyleManager.java:171-179`「只重算行首空白」）。
 * 上游这一步的数值由 CodeStyle 的 continuation indent 决定（Java 默认 8，测试数据
 * `java/java-tests/testData/codeInsight/daemonCodeAnalyzer/quickFix/splitJoinLines/afterSplitArrayElements.java`
 * 里续行是「语句缩进 + 8」）—— 本仓没有那份设置，取**列表首行的缩进 + 一个缩进单位**。
 */
export function listContinuationIndent(text: string, span: ListSpan, indentUnit: string): string {
  const starts = lineStarts(text)
  const from = starts[lineAt(starts, span.open)]!
  let at = from
  while (at < text.length && (text[at] === ' ' || text[at] === '\t')) ++at
  return text.slice(from, at) + indentUnit
}

// ── 对外的两个计划 ──────────────────────────────────────────────────────────────────────

/** 把原坐标映射过一遍编辑（上游 caret 由 `document.replaceString` 自动跟着走）。 */
function mapOffset(offset: number, edits: readonly TextEdit[]): number {
  let shift = 0
  for (const edit of edits) {
    if (edit.to <= offset) { shift += edit.insert.length - (edit.to - edit.from); continue }
    if (edit.from < offset) return edit.from + shift + edit.insert.length
  }
  return offset + shift
}

function planFrom(text: string, range: TextSelection, edits: TextEdit[]): ListPlan {
  const sorted = [...edits].sort((a, b) => a.from - b.from)
  return {
    text: applyEdits(text, sorted),
    selection: { anchor: mapOffset(range.anchor, sorted), head: mapOffset(range.head, sorted) },
    edits: sorted,
  }
}

/**
 * 拆行：`f(a, b)` → `f(a,\n<缩进>b)`。
 * null = 这一处不可拆（上游 `isSplitAvailable:84-85`：元素 > 1、`validateRange` 过、替换非空）。
 */
export function splitListPlan(
  text: string, range: TextSelection, indentUnit = '    ', separator = ',',
): ListPlan | null {
  const span = listSpanAt(text, Math.min(range.anchor, range.head), separator)
  if (!span) return null
  const edits = listSplitEdits(text, span, indentUnit, separator)
  return edits.length ? planFrom(text, range, edits) : null
}

/**
 * 合行：`f(\n a,\n b\n)` → `f(a, b)`。
 * null = 这一处不可合（上游 `isJoinAvailable:87-88`：元素 > 1、`validateRange` 过、替换非空）。
 */
export function joinListPlan(text: string, range: TextSelection, separator = ','): ListPlan | null {
  const span = listSpanAt(text, Math.min(range.anchor, range.head), separator)
  if (!span) return null
  const edits = listJoinEdits(text, span, separator)
  return edits.length ? planFrom(text, range, edits) : null
}

// ── 文案（弹层里显示的那一行）────────────────────────────────────────────────────────────

/**
 * 意图文案：英文原文 `platform/lang-api/resources/messages/CodeInsightBundle.properties:539-542`；
 * 中文取自随 IDE 发货的 `plugins/localization-zh/lib/localization-zh.jar` 里
 * `messages/CodeInsightBundle.properties:274-275,283-284`（解包实测，不是直译）。
 * 逗号档取 `comma` 那对（`CommaListSplitJoinContext:318-319` 覆写了 `getSplitText`/`getJoinText`），
 * 其余档取 `family` 那对（`DefaultListSplitJoinContext:80-82`）。
 */
export const LIST_SPLIT_JOIN_TEXTS = {
  commaSplit: 'Put comma-separated elements on multiple lines',
  commaJoin: 'Put comma-separated elements on one line',
  familySplit: 'Put elements on multiple lines',
  familyJoin: 'Put elements on one line',
  commaSplitZh: '将逗号分隔的元素放在多行中',
  commaJoinZh: '将逗号分隔的元素放在同一行中',
  familySplitZh: '将元素放在多行中',
  familyJoinZh: '将元素放在同一行中',
}

/** 这一档该显示哪两行（逗号档取 comma 那对，其余取 family 那对）。 */
export function listIntentionTitles(separator = ','): { split: string; join: string; splitZh: string; joinZh: string } {
  const comma = separator === ','
  return {
    split: comma ? LIST_SPLIT_JOIN_TEXTS.commaSplit : LIST_SPLIT_JOIN_TEXTS.familySplit,
    join: comma ? LIST_SPLIT_JOIN_TEXTS.commaJoin : LIST_SPLIT_JOIN_TEXTS.familyJoin,
    splitZh: comma ? LIST_SPLIT_JOIN_TEXTS.commaSplitZh : LIST_SPLIT_JOIN_TEXTS.familySplitZh,
    joinZh: comma ? LIST_SPLIT_JOIN_TEXTS.commaJoinZh : LIST_SPLIT_JOIN_TEXTS.familyJoinZh,
  }
}