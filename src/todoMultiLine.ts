// TODO 的**多行条目**（`pv/todo` 判词里缺的 `MultiLineTodoLocalityDetector` 那一条）
// 与条目文本里**标记词的高亮区间**（缺的 `TodoHighlightVisitor` 那一条的本仓可见面）。
//
// 上游依据：
//   · 开关与默认档：`TodoConfiguration.java:48` `private boolean myMultiLine = true`
//     （**默认开**），`:138-146` 的 getter/setter 发 `PROP_MULTILINE`（`:41`）；
//     设置页那一格是 `TodoConfigurableUI.kt:15-22`（`multiLineCheckBox` 绑
//     `settings::isMultiLine`，文案 `IdeBundle` 的 `label.todo.multiline`）。
//   · 续行判定：`IndexPatternSearcher.java:278-313` 的 `findContinuation(...)`，
//     由 `:88` 的 `boolean multiLine = queryParameters.isMultiLine()` 决定是否收集，
//     命中的续行以 `additionalRanges` 交出去（`IndexPatternSearcher.java:254`），
//     判定细节见下面 `todoContinuationLines()` 的注释逐条对照。
//   · 显示：`TodoItemNode.java:152-169`（每条续行取「去掉行首空白后的整行」，`:169`）、
//     `MultiLineTodoRenderer.java:21` `MAX_DISPLAYED_LINES = 10`、`:76` 超过 10 行时
//     显示 `node.todo.more.items` 那一行。
//   · 标记高亮：`TodoHighlightVisitor.java:91-93`（`getWordToHighlight()` +
//     `Strings.indexOfIgnoreCase` 定位标记词）与 `:106-111` 的 `formatDescription`
//     （主行 + 续行按 `\n` 连接）。
//
// 架构不等价（如实写明）：上游判定续行靠 lexer 给的**注释 token 区间**
// （`IndexPatternSearcher.java:172-210` 的 `findComments`，行注释的正文起点由
// `getCommentStartDelta` 往后挪），本仓的 TODO 扫描是 `search.run` 的文本正则（见
// `src/components/TodoPanel.vue` 的 `scan()`），没有注释 token，
// 所以「这一行还在注释里」用词面判定替代：续行去掉行首空白后必须以注释前缀开头
// （`TODO_COMMENT_PREFIXES`），或整行只是 `*` 这类块注释续行符。判定不了的宁可**不并**
// （少并一行只是条目短一点，错并会把代码当成 TODO 文本显示）。
import { markerMatches } from './todoView.ts'

/** `MultiLineTodoRenderer.java:21` 的 `MAX_DISPLAYED_LINES`。 */
export const TODO_MAX_DISPLAYED_LINES = 10

/** 词面意义上的「这行还是注释」的前缀（上游由注释 token 决定，本仓只能按前缀认）。 */
export const TODO_COMMENT_PREFIXES = ['//', '/*', '#', '--', '///', '"""', "'''", '<!--', ';', '%%', '*', '/**']

const isWhitespace = (ch: string | undefined) => ch === undefined || ch === ' ' || ch === '\t'

/** 去掉行首空白后的列（`TodoItemNode.java:169` 取文本时用的同一列）。 */
function firstContentColumn(line: string): number {
  let index = 0
  while (index < line.length && isWhitespace(line[index])) index++
  return index
}

/**
 * 一行的**注释正文起始列**。上游这一列是注释 token 的起点加
 * `IndexPatternBuilder.getCommentStartDelta(...)`（`IndexPatternSearcher.java:194-201`：
 * 行注释的正文从 `//` 之后算起），本仓没有 lexer，只能按前缀词面认；认不出前缀就返回
 * null —— 判不出「还在注释里」的宁可**不并**。前缀按长度从长到短试，否则 `//` 会抢走 `///`。
 * `*`（块注释的续行符，上游的 allowedContinuationPrefixChars）也算前缀，正文从它后面算。
 */
function commentContentColumn(line: string): number | null {
  const at = firstContentColumn(line)
  if (at >= line.length) return null
  const rest = line.slice(at)
  const sorted = [...TODO_COMMENT_PREFIXES].sort((a, b) => b.length - a.length)
  for (const marker of sorted) {
    if (rest.startsWith(marker)) return at + marker.length
  }
  return null
}

/**
 * 一条 TODO 的续行（`findContinuation` 的本仓等价物）。入参：文件按行切好的数组、
 * 标记所在行（**1 基**，与 `SearchMatch.line` 同口径）、标记起始列（**0 基**，与
 * `SearchMatch.column` 同口径）、模式表（用于「续行自己又是一个新 TODO」时停止，
 * `IndexPatternSearcher.java:309-312` 的 `break outer`）。
 *
 * 逐条对照上游的停止条件（`IndexPatternSearcher.java:283-313`）：
 *   1. 续行必须比标记列更长，且标记列那一个字符是空白/行尾
 *      （`:285-287` 的 `continuationStartOffset == refOffset || >= lineEnd` 就 break）；
 *   2. 续行的注释起点不能比标记行自己的注释起点更靠右
 *      （`:304` 的 `commentStartOffset > lineStart + maxCommentStartOffsetInLine`）；
 *   3. 注释起点到标记列之间只允许空白与块注释续行符 `*`
 *      （`:304-306` 的 `shiftBackward(..., WHITESPACE + allowedContinuationPrefixChars)`）；
 *   4. 续行里再命中任何 TODO 模式 → 停（那是**另一条** TODO）；
 *   5. 取「去行首空白后的整行」作为显示文本（`TodoItemNode.java:167`）。
 */
export function todoContinuationLines(
  lines: readonly string[], markerLine: number, markerColumn: number,
  patterns: readonly { pattern: string; caseSensitive?: boolean }[],
): string[] {
  const index = markerLine - 1
  const marker = lines[index]
  if (marker === undefined) return []
  const markerContent = commentContentColumn(marker)
  if (markerContent === null) return []
  const additional: string[] = []
  for (let next = index + 1; next < lines.length; next++) {
    const line = lines[next]!
    // 上游 `:285-287`：标记列那一个字符必须是空白（续行的正文要比标记更靠右），
    // 或者整行到不了那一列 —— 那就不算延续。
    if (markerColumn >= line.length || !isWhitespace(line[markerColumn])) break
    const cont = commentContentColumn(line)
    if (cont === null) break
    // 上游 `:304`：这一行的注释正文起点不能比标记行的注释正文起点更靠右
    // （`commentStartOffset > lineStart + maxCommentStartOffsetInLine`）。
    if (cont > markerContent) break
    // 正文起点到标记列之间只允许空白与块注释续行符 `*`（`:304-306` 的
    // `shiftBackward(..., WHITESPACE + allowedContinuationPrefixChars)`）。
    if (!/^[\s*]*$/.test(line.slice(cont, markerColumn))) break
    const text = line.trim()
    // 上游 `:309-312`：续行里再命中任何 TODO 模式就整段停 —— 那是**另一条** TODO 的开头。
    if (patterns.some(pattern => markerMatches(text, pattern.pattern, pattern.caseSensitive))) break
    additional.push(text)
  }
  return additional
}

export interface TodoDisplayText {
  /** 单元格第一行（上游把「行号前缀 + 主行」放第一行，`MultiLineTodoRenderer.java:64`）。 */
  head: string
  /** 续行，已按 `TODO_MAX_DISPLAYED_LINES` 截断。 */
  lines: string[]
  /** 续行超过 10 行（上游 `:76` 的 `myMoreLabel`，文案键 `node.todo.more.items`）。 */
  more: boolean
}

/** 多行条目怎么画：主行 + 最多 10 条续行，超了就给「更多」标记。 */
export function todoDisplayText(head: string, additional: readonly string[]): TodoDisplayText {
  return { head, lines: additional.slice(0, TODO_MAX_DISPLAYED_LINES), more: additional.length > TODO_MAX_DISPLAYED_LINES }
}

export interface MarkerRegion { start: number; length: number }

/**
 * 一行文本里标记词的位置（`TodoHighlightVisitor.java:96-107`：拿 `getWordToHighlight()`
 * 在区间里 `indexOfIgnoreCase`）。这里收全部出现而不是第一处，预览里要把整条注释的
 * 标记都上色。正则写法（`TODO|FIXME`）退化成「逐条模式按字面找」—— 与本仓
 * `markerMatches` 的容错口径一致，坏正则不抛异常。
 */
export function todoMarkerRegions(
  text: string, patterns: readonly { pattern: string; caseSensitive?: boolean }[],
): MarkerRegion[] {
  const regions: MarkerRegion[] = []
  for (const pattern of patterns) {
    const source = pattern.pattern.trim()
    if (!source) continue
    const alternatives = source.split('|').map(part => part.trim()).filter(Boolean)
    for (const word of alternatives) {
      const needle = pattern.caseSensitive ? word : word.toLowerCase()
      const haystack = pattern.caseSensitive ? text : text.toLowerCase()
      let at = haystack.indexOf(needle)
      while (at >= 0) {
        regions.push({ start: at, length: needle.length })
        at = haystack.indexOf(needle, at + needle.length)
      }
    }
  }
  return regions.sort((a, b) => a.start - b.start)
}

/** 一条 TODO 的完整描述文本：主行 + 续行按 `\n` 连（`TodoHighlightVisitor.java:110-118`）。 */
export function todoFullText(head: string, additional: readonly string[]): string {
  return additional.length ? `${head}\n${additional.join('\n')}` : head
}
