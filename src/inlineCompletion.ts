// LSP `textDocument/inlineCompletion` —— IDEA 的**行内补全**：光标处一段灰色"幽灵文本"，Tab 接受。
//
// IDEA 侧的依据（已核实的类与行号）：
//   · 接口 `platform/platform-impl/codeinsight-inline/src/com/intellij/codeInsight/inline/completion/InlineCompletionProvider.kt:44`
//   · 产生建议 `getSuggestion(request)`（同文件 `:82`）
//   · 该不该触发 `isEnabled(event)`（同文件 `:94`）—— 对应这里的 triggerKind 与"只在无选区时问"
//   · 接受/插入 `platform/inline-completion/shared/src/InlineCompletionHandlerImpl.kt`
//
// 这个模块只管两件事：**显示什么**、**接受时替换哪一段**。请求与渲染在 CodeEditor.vue。

export interface InlineCompletionItem {
  /** 真正的插入内容（适配器给的 `insertText`；`snippet` 形式已在原生层丢弃，见 lsp_session.cpp）。 */
  insertText: string
  /** 匹配用文本。显示幽灵文本时优先用它 —— 它更贴近用户已经打出来的内容。 */
  filterText?: string
  /** 建议替换的区间（可选）。给了它，接受时就替换这一段，而不是在光标处插入。 */
  range?: { startLine: number; startChar: number; endLine: number; endChar: number }
}

export interface InlineCompletionResult {
  available: boolean
  items?: InlineCompletionItem[]
}

/** 协议里的 `InlineCompletionTriggerKind`：1 自动、2 显式、3 上一个建议被拒后重试。 */
export const INLINE_TRIGGER_KINDS = { automatic: 1, explicit: 2, retrigger: 3 } as const

/**
 * 幽灵文本显示什么。
 *
 * 优先 `filterText`：它是"这段建议和用户输入怎么对齐"的文本，IDEA 的灰色提示也是显示这一层
 * （`InlineCompletionSuggestion` 的 presentation 与 insertText 是分开的）。
 * 都没有就回空串，调用方据此不渲染 —— 而不是显示一段空白的灰色装饰。
 */
export function inlineGhostText(item: InlineCompletionItem | undefined | null): string {
  if (!item) return ''
  return item.filterText || item.insertText || ''
}

export interface InlineAcceptSpan {
  startLine: number
  startChar: number
  endLine: number
  endChar: number
}

/**
 * 接受建议时**替换哪一段**。
 *
 * 有合法 `range` 就用它（规范里它就是"这段被建议替换"，通常是从当前词开头到光标）；
 * 没有/畸形则在 (line, char) 处插入（零宽区间）。
 *
 * 为什么要校验：`range` 是适配器给的任意坐标，负值或倒序会让 CodeMirror 的
 * `changes` 抛异常（`from > to`）—— 而这段代码跑在编辑器的按键路径上，抛异常就是"按 Tab 崩了"。
 */
export function inlineAcceptSpan(
  item: InlineCompletionItem | undefined | null,
  cursor: { line: number; char: number },
): InlineAcceptSpan {
  const fallback: InlineAcceptSpan = { startLine: cursor.line, startChar: cursor.char, endLine: cursor.line, endChar: cursor.char }
  const range = item?.range
  if (!range) return fallback
  for (const value of [range.startLine, range.startChar, range.endLine, range.endChar])
    if (!Number.isInteger(value) || value < 0) return fallback
  // 倒序（start > end）或跨行时 start 行大于 end 行 → 当畸形处理。
  if (range.startLine > range.endLine) return fallback
  if (range.startLine === range.endLine && range.startChar > range.endChar) return fallback
  return { ...range }
}

/** 幽灵文本的点缀：多行建议只显示第一行（第二行开始会撑破行内布局）。 */
export function inlineGhostLines(item: InlineCompletionItem | undefined | null, limit = 1): string[] {
  const text = inlineGhostText(item)
  if (!text) return []
  const lines = text.split('\n')
  // 尾随空行不算内容（很多服务器以换行结尾）。
  while (lines.length && lines[lines.length - 1] === '') lines.pop()
  return lines.slice(0, Math.max(1, limit))
}

/**
 * 按 Esc 该不该收掉幽灵文本：
 *   · 没有待接受的建议 → **不消费**这次 Esc（放它去干别的：退选择、关别的浮层）；
 *   · 补全弹窗正开着 → 先让弹窗收（用户下一步再按才轮到幽灵文本，IDEA 也是这个先后）；
 *   · 其余情况收掉。
 * 判定是纯的，真正的 dispatch 在 `src/inlineCompletionExtension.ts` 的 `dismissInlineSuggestion`。
 */
export function shouldDismissInlineSuggestion(hasSuggestion: boolean, completionActive: boolean): boolean {
  return hasSuggestion && !completionActive
}

/** 幽灵文本 + 接受区间的最小形状（`src/inlineCompletionExtension.ts` 的 `InlineSuggestion` 就是它）。 */
export interface InlineTypedSuggestion {
  text: string
  insertText: string
  span: InlineAcceptSpan
}

/**
 * 用户**照着建议打字**时，建议不失效而是缩短。
 *
 * 上游 `InlineCompletionSuggestionUpdateManager.isValidTyping`（`…/suggestion/InlineCompletionSuggestionUpdateManager.kt:229-236`）：
 * 一次输入事件是**单个符号**且 `textToInsert.startsWith(typed)` 时，建议保留并
 * `truncateFirstSymbol`（`:239-253`）把已打出的那一个字符从建议头上削掉；对不上才失效。
 * 本仓原来在 `docChanged` 时一律作废 —— 用户打建议的第一个字符，灰色文本立刻消失、
 * 要等 300ms 去抖 + 服务端往返才可能重新出现（有的服务器还不重发），观感是"一打字就闪没"。
 *
 * 保守边界（都对不上就返回 null = 按旧行为作废）：
 *   · 一次只插入**一个字符**（多字符粘贴/删除不猜）；
 *   · 建议的显示文本与插入文本**都**以这个字符开头（两者不同源时不冒险）；
 *   · 接受区间是零宽（在光标处插入）。带 range 的建议坐标会随打字移动，交给下一次请求重算。
 * 返回时 span 跟着光标右移一格，余下的建议仍显示在新光标处（LSP 列为 0 基，插入发生在
 * `endChar` 之后，所以剩余文本的位置是 `endChar + 1`）。
 */
export function advanceSuggestionOnTyping(suggestion: InlineTypedSuggestion | null, typed: string): InlineTypedSuggestion | null {
  if (!suggestion || typed.length !== 1) return null
  const { span } = suggestion
  if (span.startLine !== span.endLine || span.startChar !== span.endChar) return null
  if (!suggestion.text.startsWith(typed) || !suggestion.insertText.startsWith(typed)) return null
  const insertText = suggestion.insertText.slice(1)
  if (!insertText) return null                       // 整段建议都打完了：幽灵文本收场
  return {
    text: suggestion.text.slice(1) || insertText,
    insertText,
    span: { startLine: span.startLine, startChar: span.startChar + 1, endLine: span.endLine, endChar: span.endChar + 1 },
  }
}

/** 部分接受的粒度：按词（`InsertInlineCompletionWordAction`）或按行（`InsertInlineCompletionLineAction`）。 */
export type InlinePartialAcceptMode = 'word' | 'line'

/**
 * 这一次部分接受该插入多少个字符。
 *
 * 上游 `InlineCompletionPartialAcceptHandlerImpl.kt`：
 *   · `insertNextWord`（`:218-225`）把光标按 `EditorActionUtil.moveCaretToNextWord` 移到下一个**词尾**
 *     （默认 caret-stop 策略 WORD_END），插入长度就是这段位移；没有下一个词时停点就是文本末尾
 *     （所以 `()` 这类建议按词接受等于整段接受）；
 *   · `insertNextLine`（`:200-215`）取到第一个换行为止；补全本身以换行开头时把这一行空出来
 *     （registry `inline.completion.insert.line.with.leading.whitespaces` 默认 false）。
 * 词规则与 `src/inlineCompletionNav.ts` 的 `nextWordEnd` 同口径（那个模块还没接线；
 * 判据里有一条交叉核对，防止两份定义漂移）。
 */
export function inlinePartialAcceptLength(text: string, mode: InlinePartialAcceptMode): number {
  if (!text) return 0
  if (mode === 'line') {
    const newline = text.indexOf('\n')
    if (newline < 0) return text.length
    return newline === 0 ? 1 : newline               // 光一个换行也要吃掉它，否则原地不动
  }
  const match = /^(?:\s+)?[$\p{L}\p{N}_]+/u.exec(text)
  return match ? match[0].length : text.length
}

/**
 * 部分接受之后剩下的建议：把已接受的前缀从文本里削掉，幽灵文本落在**新光标处**（零宽区间）。
 * `text` 与 `insertText` 不同源（`filterText` 显示用）时只在 `text` 以已接受文本开头时同步削，
 * 否则显示文本回落到剩余插入文本 —— 宁可显示得直白，也不要错位。
 * 前缀里带换行、或剩余为空（等于全接受）时返回 null，调用方走整段接受。
 */
export function truncateSuggestion(suggestion: InlineTypedSuggestion | null, length: number): InlineTypedSuggestion | null {
  if (!suggestion || length <= 0 || length >= suggestion.insertText.length) return null
  const inserted = suggestion.insertText.slice(0, length)
  if (inserted.includes('\n')) return null
  const insertText = suggestion.insertText.slice(length)
  const { span } = suggestion
  return {
    text: suggestion.text.startsWith(inserted) ? suggestion.text.slice(length) || insertText : insertText,
    insertText,
    span: { startLine: span.startLine, startChar: span.startChar + inserted.length, endLine: span.startLine, endChar: span.startChar + inserted.length },
  }
}
