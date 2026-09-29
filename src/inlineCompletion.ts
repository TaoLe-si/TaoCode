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
