// 编辑器内 TODO 标记高亮的**范围计算** —— 上游 `TodoHighlightVisitor`
// （platform/todo/src/com/intellij/ide/todo/codeInsight/TodoHighlightVisitor.java）在本仓的纯逻辑层。
//
// 为什么单独一个模块：本仓此前只给 **TODO 工具窗口的预览行**上色
// （`src/todoMultiLine.ts:todoMarkerRegions` → `src/components/TodoPanel.vue:90,452`），
// 编辑器里注释中的 TODO/FIXME 一律不着色 —— 而上游那支 visitor 是挂在编辑器 daemon 上的
// （`platform/todo/resources/intellij.platform.todo.xml:44`
//  `<highlightVisitor implementation="com.intellij.ide.todo.codeInsight.TodoHighlightVisitor"/>`）。
// 本模块只做「文本 + 模式表 → 待高亮范围」，不含 Vue / DOM / CodeMirror；装饰层由宿主接线。
//
// ## 上游逐条对照（每条都自己打开确认过那一行）
//
// 1. **只扫注释**：`IndexPatternSearcher.java:89` 先 `findCommentTokenRanges(...)`，
//    `:94-103` 只在注释区间里跑模式；`:192` 的判据是
//    `commentTokens.contains(tokenType) || CacheUtil.isInComments(tokenType)`。
//    ⇒ 字符串字面量里的 `TODO` 在编辑器里**不**高亮。本仓用 `src/usageHighlight.ts` 的
//    `commentRanges()`（与注解器/用法高亮同一份注释区间）承担这一层。
//    纯文本文件是特例：`IndexPatternSearcher.java:114-123` 对 `PsiPlainTextFile`
//    直接 `new CommentRange(0, chars.length())`（**整份文件就是一个注释区间**）——
//    本仓的等价入口是 `commentStyle === null`。
//
// 2. **匹配规则**：`IndexPattern.compilePattern()`（platform/indexing-api/src/com/intellij/psi/search/
//    IndexPattern.java:80-89）把 `patternString` **原样**交给 `Pattern.compile`，
//    `caseSensitive == false` 时补 `CASE_INSENSITIVE`（`:83-84`），模式里出现 ≥ 0x80 的字符
//    再补 `UNICODE_CASE`（`:85-87`）；命中是 `matcher.find()` 的**子串语义**
//    （`IndexPatternSearcher.java:245-247`）。⇒ **没有隐式 `\b`、没有 glob 档**；
//    模式串两端的空白由 `TodoPattern.java:29` 的 `.trim()` 去掉。
//    空匹配要跳过：`IndexPatternSearcher.java:252`（`start != end`）与
//    `PlainTextTodoIndexer.java:43`。
//
// 3. **高亮范围 = 正则命中本身**（不是"标记词"，也不是无条件"整行"）：
//    `TodoHighlightVisitor.java:74` 取 `todoItem.getTextRange()`，`:81` 交给
//    `addTodoItem(...)`；那个范围就是 `IndexPatternSearcher.java:250-251` 算出的
//    `[start, end)`（`matcher.start()/end()` 经 `fitToRange` 夹回注释正文内）。
//    出厂模式 `\btodo\b.*` 的 `.*` 让它**一直吃到注释正文行尾**，
//    所以默认外观是"整条 `TODO: …` 都变色"，而不是只有 `TODO` 四个字母。
//
// 4. **续行**（多行条目）：`TodoHighlightVisitor.java:82-88` 把
//    `todoItem.getAdditionalTextRanges()` 逐条也画上，且 `:83-84` 把 error stripe 清掉
//    （续行没有行号旁的标记条）。那些区间来自 `IndexPatternSearcher.java:254` 的
//    `findContinuation(...)`（`:278-313`）：`:291` 从**标记列往后跳过空白**起算，
//    `:300` 到行尾或注释正文终点为止。
//    ⇒ "哪几行算续行"**不重写**：复用本仓已有的同一份规则
//    `src/todoMultiLine.ts:todoContinuationLines`（它逐条对照 `findContinuation` 写，
//    见该文件头 `:9-26` 与 `:70-78`）；区间端点按上游那两行公式现算。
//    于是面板与编辑器对"一条 TODO 到哪结束"必然一致（同一份行判定，不存在两处漂移）。
//
// 5. **标记词链接**：`TodoHighlightVisitor.java:90-102` 另画一条
//    `CodeInsightColors.INACTIVE_HYPERLINK_ATTRIBUTES` 的范围，位置由
//    `IndexPattern.getIndexPattern().getWordToHighlight()`（`IndexPattern.java:61-65`）
//    + `Strings.indexOfIgnoreCase(text, word, range.start, range.end)`（`:93`）定。
//    整条特性由 registry 开关 `todo.navigation` 把守（`:65`），
//    **默认关**（`platform/ide-core-impl/resources/intellij.platform.ide.core.impl.xml:382`
//    `<registryKey defaultValue="false" ... key="todo.navigation"/>`）。
//    `getWordToHighlight()` 标着 `@ApiStatus.Experimental`（`IndexPattern.java:60`），
//    它的字面词来自 `IndexPatternOptimizerImpl.java:22-25`（内置两条短路成 `todo`/`fixme`）
//    或 `FindInProjectUtil.extractStringToFind` + `StringUtil.getWordsIn`（通用路径，不可移植）。
//    本模块取**可移植子集**：命中串开头的词面段（与 `src/todoMultiLine.ts:140,166` 的
//    `WORD_RUN` 同一口径），且默认不产出（开关默认关）。
//
// 6. **同一起点去重、表序**：`IndexPatternSearcher.java:94-103` 对每个注释区间
//    `for (int j = patterns.length - 1; j >= 0; --j)` **倒着**遍历模式表，`:253` 用
//    `!matches.contains(start)` 按**起点**去重 ⇒ 同一个起点上，模式表里**靠后**的那条赢。
//
// 7. **外观**（不是范围，但同一支 visitor 决定）：`TodoHighlightVisitor.java:80`
//    `todoPattern.getAttributes().getTextAttributes()` —— 编辑器里只用**文字属性**；
//    图标（`TodoAttributes.java:33-39` 的 TodoDefault/TodoQuestion/TodoImportant）只出现在
//    TODO 工具窗口与设置页（`nodes/TodoItemNode.java:127`、`configurable/PatternsTableModel.java:49`、
//    `configurable/PatternDialog.java:62`），**编辑器高亮不画图标**。
//    出厂两条模式的属性都是 `TodoAttributesUtil.createDefault()`（`TodoDefaultPatternProvider.kt:23-24`）
//    = 颜色方案的 `CodeInsightColors.TODO_DEFAULT_ATTRIBUTES`
//    （`TodoAttributesUtil.java:14-20`；key 定义在 `platform/core-api/.../CodeInsightColors.java:58`），
//    `shouldUseCustomTodoColor` 为 false（`TodoAttributes.java:41-42`）⇒ **两条模式同色**。
//    本仓把"用方案默认色"落成一个语义键 `TODO_MARKER_STYLE_KEY`，把"模式自带自定义色"
//    落成 `TodoPattern.color`（与 `src/todoView.ts:82-85` 的面板口径同源）；具体色值走
//    `src/tokens.css` 的令牌，不在本文件里写死。
//
// 与 `src/todoScan.ts` 的关系：**不是同一套**。`todoScan.ts:15-30` 是**提交前检查**的编排
// （逐条模式调 `search.run` 求命中**数**），没有注释区间、不产出偏移、大小写由宿主那一个全局开关定；
// 它没有可复用的范围计算导出。真正与本模块同源的是 `src/todoView.ts:markerMatches`
// （"模式原样当正则"的语义）与 `src/usageHighlight.ts:commentRanges`（注释区间），
// 本模块在语义上对齐它们（坏正则同样退化为字面包含，见 `markerMatches` 的 catch 分支）。

import { commentRanges } from './usageHighlight.ts'
import { todoContinuationLines } from './todoMultiLine.ts'

/** 一条 TODO 模式（`TodoPattern` 的可移植面；`caseSensitive` 默认 false，见 `TodoPattern.java:22,30`）。 */
export interface TodoHighlightPattern {
  pattern: string
  caseSensitive?: boolean
  /** 该模式自带的自定义色（`TodoAttributes` 的 `useCustomColors` 分支，`TodoAttributes.java:41-42`）。 */
  color?: string
}

/** 一条待高亮的范围。`kind` 对应 `TodoHighlightVisitor` 里三条不同的画法。 */
export type TodoHighlightKind = 'marker' | 'continuation' | 'navigation'

export interface TodoHighlightRange {
  /** 文档偏移（半开区间 `[from, to)`，与 `TextRange` 同形）。 */
  from: number
  to: number
  /**
   * `marker` = 正则命中本身（`TodoHighlightVisitor.java:74,81`）；
   * `continuation` = 多行条目的续行（`:82-88`，上游这一档清掉 error stripe）；
   * `navigation` = 标记词链接（`:90-102`，仅在 `todo.navigation` 开启时）。
   */
  kind: TodoHighlightKind
  /** 命中的模式串（模式表里的那一条）。 */
  pattern: string
}

export interface TodoHighlightOptions {
  /** 是否收集续行（`TodoConfiguration.java:48` `private boolean myMultiLine = true`，**默认开**）。 */
  multiLine?: boolean
  /**
   * 是否产出标记词链接范围（registry `todo.navigation`，`TodoHighlightVisitor.java:65`；
   * `intellij.platform.ide.core.impl.xml:382` 的 `defaultValue="false"` ⇒ 这里也默认 false）。
   */
  navigation?: boolean
  /** 范围条数上限（防病态模式画满整篇；与 `src/usageHighlight.ts:120` 的 `limit = 1000` 同一策略）。 */
  limit?: number
}

/** 本仓语言侧的注释词法（`CommentStyle` 的结构子集；`null` = 按上游纯文本分支整份当注释）。 */
export interface TodoCommentStyle {
  line?: string
  block?: [string, string]
}

/**
 * "用颜色方案的 TODO 默认色"的语义键（`TodoAttributesUtil.getDefaultColorSchemeTextAttributes()`
 * 那条路径，`TodoAttributesUtil.java:14-20`）。宿主把它映射到 `src/tokens.css` 的令牌 ——
 * 本文件不写裸色值。
 */
export const TODO_MARKER_STYLE_KEY = 'todoMarker'

/** 三档的装饰类名（外观在宿主的主题扩展里给，令牌见接线请求）。 */
export const TODO_MARKER_CLASS = 'cm-todo-marker'
export const TODO_CONTINUATION_CLASS = 'cm-todo-continuation'
export const TODO_NAVIGATION_CLASS = 'cm-todo-navigation'

/** 这条模式该用哪个样式键：自带自定义色就用它，否则用方案默认色（`TodoAttributes.java:41-42`）。 */
export function todoHighlightStyleKey(pattern: TodoHighlightPattern): string {
  return typeof pattern.color === 'string' && /^#[0-9a-fA-F]{6}$/.test(pattern.color) ? pattern.color : TODO_MARKER_STYLE_KEY
}

/** 三档 kind → 类名（宿主按它挂装饰）。 */
export function todoHighlightClass(kind: TodoHighlightKind): string {
  if (kind === 'continuation') return TODO_CONTINUATION_CLASS
  if (kind === 'navigation') return TODO_NAVIGATION_CLASS
  return TODO_MARKER_CLASS
}

/** 命中串开头的词面段（`WORD_RUN`；与 `src/todoMultiLine.ts:140` 同一口径）。 */
const WORD_RUN = /^[0-9A-Za-z_]*/

/**
 * 编译一条 TODO 模式（`IndexPattern.compilePattern()`，`IndexPattern.java:80-89`）。
 * · 原样当正则，**不加**隐式 `\b`；
 * · `caseSensitive == false` ⇒ `i`（上游 `CASE_INSENSITIVE`，`:83-84`）；
 * · 不区分大小写且模式含非 ASCII ⇒ 再补 `u`（上游 `UNICODE_CASE`，`:85-87`；
 *   JS 里 Unicode 感知的大小写折叠要 `u` 才有）。`u` 会同时收紧语法（Java 不会），
 *   所以 `u` 版编译失败就退回 `i` 版 —— 宁可少一层 Unicode 折叠，也不能把合法模式判死。
 * 编译失败（正则写坏）返回 null，由调用方走字面包含的退化路径。
 */
function compileTodoRegex(source: string, caseSensitive: boolean): RegExp | null {
  if (caseSensitive) {
    try { return new RegExp(source, 'g') } catch { return null }
  }
  if (/[^\x00-\x7f]/.test(source)) {
    try { return new RegExp(source, 'giu') } catch { /* u 收紧语法导致失败：退回 i */ }
  }
  try { return new RegExp(source, 'gi') } catch { return null }
}

/**
 * 一段文本里这条模式的全部命中（相对偏移，升序）。
 * 空匹配跳过（`IndexPatternSearcher.java:252`）；正则写坏时退化为字面包含，
 * 与 `src/todoView.ts:47-52` 的 `markerMatches` catch 分支同一容错口径。
 */
export function todoPatternMatchRanges(text: string, pattern: TodoHighlightPattern): Array<{ from: number; to: number }> {
  const source = pattern.pattern.trim()
  if (!source) return []
  const caseSensitive = pattern.caseSensitive === true
  const expression = compileTodoRegex(source, caseSensitive)
  const out: Array<{ from: number; to: number }> = []
  if (expression) {
    let match: RegExpExecArray | null
    while ((match = expression.exec(text)) !== null) {
      // 空匹配：`exec` 在 g 模式下不自动前进，手动挪一格（否则原地打转）。
      if (match[0] === '') { expression.lastIndex++; continue }
      out.push({ from: match.index, to: match.index + match[0].length })
    }
    return out
  }
  const needle = caseSensitive ? source : source.toLowerCase()
  const haystack = caseSensitive ? text : text.toLowerCase()
  let at = haystack.indexOf(needle)
  while (at >= 0) {
    out.push({ from: at, to: at + needle.length })
    at = haystack.indexOf(needle, at + needle.length)
  }
  return out
}

interface CommentBody { from: number; to: number }

/**
 * 注释**正文**区间（去掉行/块注释标记）。上游 `IndexPatternSearcher.java:195-201` 的
 * `getCommentStartDelta`/`getCommentEndDelta` 就是把 token 区间往内收：
 * `//` 收 2（`JavaIndexPatternBuilder.java:42`）、C 风格块注释开标记收 2、闭标记收 2（`:48`）。
 * 未闭合的块注释收到文末（与 `commentRanges` 同一条口径）。
 */
function commentBodies(text: string, style: TodoCommentStyle | null): CommentBody[] {
  // 纯文本分支（`IndexPatternSearcher.java:114-123`）：整份文件就是一个注释区间。
  if (!style || (!style.line && !style.block)) return [{ from: 0, to: text.length }]
  const bodies: CommentBody[] = []
  for (const range of commentRanges(text, style)) {
    let from = range.from
    let to = range.to
    if (style.line && text.startsWith(style.line, from)) {
      from += style.line.length
    }
    else if (style.block && text.startsWith(style.block[0], from)) {
      from += style.block[0].length
      if (to >= style.block[1].length && text.startsWith(style.block[1], to - style.block[1].length)) {
        to -= style.block[1].length
      }
    }
    if (from < to) bodies.push({ from, to })
  }
  return bodies
}

/** 每行的起始偏移（只认 `\n`，与上游 `CharArrayUtil` 的 `"\n"` 口径一致；CRLF 的 `\r` 留在行内）。 */
function lineStartsOf(text: string): number[] {
  const starts = [0]
  let at = text.indexOf('\n')
  while (at >= 0) { starts.push(at + 1); at = text.indexOf('\n', at + 1) }
  return starts
}

/** 偏移落在哪一行（0 基，二分）。 */
function lineIndexOf(starts: readonly number[], offset: number): number {
  let lo = 0
  let hi = starts.length - 1
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1
    if (starts[mid]! <= offset) lo = mid
    else hi = mid - 1
  }
  return lo
}

/** 从 `from` 往后跳过空格/制表符，不越过 `to`（上游 `CharArrayUtil.shiftForward(..., WHITESPACE)`）。 */
function shiftForwardWhitespace(text: string, from: number, to: number): number {
  let at = from
  while (at < to && (text[at] === ' ' || text[at] === '\t')) at++
  return at
}

/**
 * 一条主命中带的续行**高亮范围**。哪几行算续行**不在这里重写** —— 调
 * `src/todoMultiLine.ts:todoContinuationLines`（面板用的同一份 `findContinuation` 等价物），
 * 它按行返回续行的显示文本、且与"标记行的下一行开始连续若干行"一一对应
 * （第一条不满足就 break，见 `src/todoMultiLine.ts:90-107`）。
 *
 * 但**区间本身**按上游公式算，不是"整行"也不是"去空白的整行"：
 * `IndexPatternSearcher.java:291` 的
 * `continuationStartOffset = shiftForward(text, refOffset, lineEndOffset, WHITESPACE)`，
 * 其中 `:290` 的 `refOffset = lineStartOffset + offsetInLine`（标记在标记行里的列）——
 * 所以续行高亮**从标记列往后跳过空白**起算（注释前缀 `//` 与它前面的缩进都不画）；
 * `:300` 的 `continuationEndOffset = min(lineEndOffset, commentRange.endOffset)`。
 * `:292` 的两个 break 条件（标记列不是空白 / 已到行尾）由 `todoContinuationLines` 覆盖。
 */
function continuationRanges(
  text: string, lines: readonly string[], starts: readonly number[], bodies: readonly CommentBody[],
  markerLine: number, markerColumn: number, patterns: readonly TodoHighlightPattern[],
): CommentBody[] {
  const texts = todoContinuationLines(lines, markerLine, markerColumn, patterns)
  if (!texts.length) return []
  const out: CommentBody[] = []
  for (let k = 0; k < texts.length; k++) {
    const lineIndex = markerLine + k
    const line = lines[lineIndex]
    const lineStart = starts[lineIndex]
    if (line === undefined || lineStart === undefined) break
    // 自洽性检查：行映射错了就不画（少画一条续行只是短一点）。
    if (line.trim() !== texts[k]) break
    const lineEnd = lineStart + line.length
    // 续行自己的注释正文区间。行注释是**独立**的注释 token（`IndexPatternSearcher.java:172-210`
    // 每个注释 token 一个 CommentRange），所以上游在 `:293-298` 遇到"续行起点已越过当前注释终点"
    // 时会 `commentNum++` 换到下一条注释区间；块注释则整块是一个区间。
    // 这里按同一语义取：优先"从本行开始的注释区间"，退而取"覆盖本行的注释区间"。
    const body = bodies.find(candidate => candidate.from >= lineStart && candidate.from < lineEnd)
      ?? bodies.find(candidate => candidate.from <= lineStart && lineStart < candidate.to)
    if (!body) break
    const from = shiftForwardWhitespace(text, lineStart + markerColumn, lineEnd)
    // 上游 `:292`：标记列上没有空白可跳、或跳到了行尾 ⇒ 不算续行。
    if (from === lineStart + markerColumn || from >= lineEnd) break
    out.push({ from, to: Math.min(lineEnd, body.to) })
  }
  return out
}

/**
 * 编辑器里这份文本的 TODO 高亮范围（上游 `TodoHighlightVisitor.highlightTodos`，`:57-104`）。
 *
 * 顺序：注释区间（升序）→ 区间内**倒序**遍历模式表（`:97`）→ 按起点去重（`:253`）
 * → 每个命中补续行（`:82-88`，`multiLine` 开时）→ 最后按 `from` 排序输出。
 * 模式表为空 ⇒ 什么都不产出（没有定义任何标记就没有任何 TODO；与 `src/todoView.ts:68-69` 同口径）。
 */
export function todoHighlightRanges(
  text: string,
  patterns: readonly TodoHighlightPattern[],
  commentStyle: TodoCommentStyle | null,
  options: TodoHighlightOptions = {},
): TodoHighlightRange[] {
  if (!patterns.length || !text) return []
  const multiLine = options.multiLine !== false
  const navigation = options.navigation === true
  const limit = options.limit ?? 1000
  const lines = text.split(/\r?\n/)
  const starts = lineStartsOf(text)
  const bodies = commentBodies(text, commentStyle)
  const out: TodoHighlightRange[] = []

  for (const body of bodies) {
    const bodyText = text.slice(body.from, body.to)
    // 同一注释区间内按起点去重（`:90,95,253` 的 `occurrences` 每区间清一次）。
    const claimed = new Set<number>()
    // 倒序遍历模式表：同一起点上**靠后**的模式赢（`:97` + `:253`）。
    for (let j = patterns.length - 1; j >= 0; --j) {
      const pattern = patterns[j]!
      for (const hit of todoPatternMatchRanges(bodyText, pattern)) {
        if (claimed.has(hit.from)) continue
        claimed.add(hit.from)
        const from = body.from + hit.from
        const to = body.from + hit.to
        out.push({ from, to, kind: 'marker', pattern: pattern.pattern })
        if (navigation) {
          // 标记词链接：命中串开头的词面段（`getWordToHighlight` 的可移植子集，见文件头第 5 条）。
          const word = WORD_RUN.exec(text.slice(from, to))?.[0] ?? ''
          if (word) out.push({ from, to: from + word.length, kind: 'navigation', pattern: pattern.pattern })
        }
        if (multiLine) {
          // 主命中的起点落在第几行（0 基 → 1 基），以及它在行内的 0 基列 ——
          // 与面板喂 `todoContinuationLines` 的口径一致（`SearchMatch.column` 的 1 基值由面板换算，
          // 见 `src/todoMultiLine.ts:66-68` 与 `TodoPanel.vue:187`）。
          const lineIndex = lineIndexOf(starts, from)
          const markerLine = lineIndex + 1
          for (const extra of continuationRanges(text, lines, starts, bodies, markerLine, from - starts[lineIndex]!, patterns)) {
            out.push({ from: extra.from, to: extra.to, kind: 'continuation', pattern: pattern.pattern })
          }
        }
        if (out.length >= limit) break
      }
      if (out.length >= limit) break
    }
    if (out.length >= limit) break
  }

  // 输出顺序：起点升序；同起点时主范围在前（导航链接是叠在主范围上的窄区间），
  // 续行在最后。宿主建 `DecorationSet` 需要有序输入。
  const rank: Record<TodoHighlightKind, number> = { marker: 0, navigation: 1, continuation: 2 }
  return out.sort((a, b) => a.from - b.from || rank[a.kind] - rank[b.kind] || a.to - b.to).slice(0, limit)
}