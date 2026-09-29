// 行内补全的 **CodeMirror 落点**（幽灵文本 widget + StateField + Tab 绑定）。
//
// 从 `CodeEditor.vue` 拆出来的：那边是"CodeMirror 宿主"，不该再塞各个 LSP 能力的渲染细节
// （拆之前 CodeEditor 已经 1284 行，机检 `tests/module-size.test.mjs` 直接红了）。
// 「显示什么 / 接受时替换哪一段」这些**纯规则**在 `src/inlineCompletion.ts`；
// 「什么时候去问」留在 CodeEditor（它才知道编辑器状态与节流）。
//
// IDEA 侧的依据见 `src/inlineCompletion.ts` 的模块注释（`InlineCompletionProvider.kt:44/82/94`）。

import { Prec, StateEffect, StateField, type EditorState } from '@codemirror/state'
import { Decoration, EditorView, WidgetType, keymap, type DecorationSet } from '@codemirror/view'
import { inlineAcceptSpan, inlineGhostText, type InlineCompletionItem } from './inlineCompletion'

/** 当前光标处待接受的建议。`span` 是**接受时要替换的区间**。 */
export interface InlineSuggestion {
  text: string
  insertText: string
  span: ReturnType<typeof inlineAcceptSpan>
}

export const setInlineSuggestion = StateEffect.define<InlineSuggestion | null>()

// 文档变了、或光标动了，旧建议就失效：它是**针对某个位置**算出来的，留着只会插错地方。
// 这条对应 IDEA 的 `isEnabled(event)`（`InlineCompletionProvider.kt:94`）—— 事件变了就重新判断。
export const inlineSuggestionField = StateField.define<InlineSuggestion | null>({
  create: () => null,
  update(value, transaction) {
    if (transaction.docChanged || transaction.selection) return null
    for (const effect of transaction.effects)
      if (effect.is(setInlineSuggestion)) return effect.value
    return value
  },
})

class GhostTextWidget extends WidgetType {
  constructor(readonly text: string) { super() }
  eq(other: GhostTextWidget) { return other.text === this.text }
  toDOM() {
    const span = document.createElement('span')
    span.className = 'cm-inline-suggestion'
    span.textContent = this.text
    // 屏幕阅读器不该念出这段"还没被接受"的文本（IDEA 的 ghost text 也不进无障碍树）。
    span.setAttribute('aria-hidden', 'true')
    return span
  }
  ignoreEvent() { return true }
}

/** `(line, char)` → CodeMirror 位置；越界返回 null（服务端给的坐标不保证落在当前文档里）。 */
export function positionOf(state: EditorState, line: number, character: number): number | null {
  if (!Number.isInteger(line) || line < 0 || line >= state.doc.lines) return null
  const target = state.doc.line(line + 1)
  const offset = target.from + Math.max(0, character)
  return offset > target.to ? null : offset
}

export const inlineDecorationsField = StateField.define<DecorationSet>({
  create: () => Decoration.none,
  update(_decorations, transaction) {
    const suggestion = transaction.state.field(inlineSuggestionField, false)
    if (!suggestion) return Decoration.none
    const to = positionOf(transaction.state, suggestion.span.endLine, suggestion.span.endChar)
    if (to === null) return Decoration.none
    return Decoration.set([Decoration.widget({ widget: new GhostTextWidget(suggestion.text), side: 1 }).range(to)])
  },
  provide: field => EditorView.decorations.from(field),
})

/**
 * 接受建议：替换 `span` 那一段（没有 range 时是零宽插入），光标放到插入内容之后。
 * **返回 false 表示"我这里没接"** —— Tab 必须继续传给缩进/自动补全，否则用户的 Tab 会失灵。
 */
export function acceptInlineSuggestion(editor: EditorView): boolean {
  const suggestion = editor.state.field(inlineSuggestionField, false)
  if (!suggestion) return false
  const from = positionOf(editor.state, suggestion.span.startLine, suggestion.span.startChar)
  const to = positionOf(editor.state, suggestion.span.endLine, suggestion.span.endChar)
  if (from === null || to === null || to < from) return false
  editor.dispatch({
    changes: { from, to, insert: suggestion.insertText },
    selection: { anchor: from + suggestion.insertText.length },
    effects: setInlineSuggestion.of(null),
  })
  return true
}

/**
 * Tab 接受行内建议。**必须排在自动补全的 Tab 之前**，否则补全弹窗会先把 Tab 吃掉 ——
 * 所以用 `Prec.highest`；而没建议时 `run` 返回 false，Tab 会继续传给下一个绑定。
 */
export const inlineCompletionKeymap = Prec.highest(keymap.of([{ key: 'Tab', preventDefault: false, run: acceptInlineSuggestion }]))

/** 把适配器返回的一项落成编辑器状态；没有可显示的文本时返回 null（调用方据此清掉旧建议）。 */
export function suggestionFor(
  item: InlineCompletionItem | undefined,
  cursor: { line: number; char: number },
): InlineSuggestion | null {
  const text = inlineGhostText(item)
  if (!item || !text) return null
  return { text, insertText: item.insertText, span: inlineAcceptSpan(item, cursor) }
}
