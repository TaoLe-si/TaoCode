// 行内补全的 **CodeMirror 落点**（幽灵文本 widget + StateField + Tab 接受 / Esc 收起）。
//
// 从 `CodeEditor.vue` 拆出来的：那边是"CodeMirror 宿主"，不该再塞各个 LSP 能力的渲染细节
// （拆之前 CodeEditor 已经 1284 行，机检 `tests/module-size.test.mjs` 直接红了）。
// 「显示什么 / 接受时替换哪一段 / 该不该收」这些**纯规则**在 `src/inlineCompletion.ts`；
// 「什么时候去问」留在 CodeEditor（它才知道编辑器状态与节流）。
//
// IDEA 侧的依据见 `src/inlineCompletion.ts` 的模块注释（`InlineCompletionProvider.kt:44/82/94`）。

import { completionStatus } from '@codemirror/autocomplete'
import { Prec, StateEffect, StateField, type EditorState, type Extension, type Transaction } from '@codemirror/state'
import { Decoration, EditorView, WidgetType, keymap, type DecorationSet } from '@codemirror/view'
import { advanceSuggestionOnTyping, inlineAcceptSpan, inlineGhostText, inlinePartialAcceptLength, shouldDismissInlineSuggestion, truncateSuggestion,
         type InlineCompletionItem, type InlinePartialAcceptMode } from './inlineCompletion.ts'
import { hideInlineCompletionTooltip, inlineTooltipEntries, isInlineTooltipProvoker, toggleInlineCompletionTooltip } from './inlineCompletionTooltip.ts'

/** 当前光标处待接受的建议。`span` 是**接受时要替换的区间**。 */
export interface InlineSuggestion {
  text: string
  insertText: string
  span: ReturnType<typeof inlineAcceptSpan>
}

export const setInlineSuggestion = StateEffect.define<InlineSuggestion | null>()

// 文档变了、或光标动了，旧建议就失效：它是**针对某个位置**算出来的，留着只会插错地方。
// 这条对应 IDEA 的 `isEnabled(event)`（`InlineCompletionProvider.kt:94`）—— 事件变了就重新判断。
//
// **例外（上游 `isValidTyping`）**：单字符输入且正是建议的下一个字符时，建议保留并缩短一个字符
// （`advanceSuggestionOnTyping`）；用户照着建议打字不该让灰色文本闪没。规则全在纯函数里。
export const inlineSuggestionField = StateField.define<InlineSuggestion | null>({
  create: () => null,
  update(value, transaction) {
    for (const effect of transaction.effects)
      if (effect.is(setInlineSuggestion)) return effect.value
    if (!value) return null
    if (transaction.docChanged) {
      const typed = singleInsertedCharacter(transaction)
      return typed === null ? null : advanceSuggestionOnTyping(value, typed)
    }
    if (transaction.selection) return null
    return value
  },
})

/** 一次事务恰好"插入一个字符"时返回它；删除、粘贴、多变更一律返回 null（不猜）。 */
function singleInsertedCharacter(transaction: Transaction): string | null {
  let count = 0
  let inserted = ''
  let pureInsertion = true
  transaction.changes.iterChanges((fromA, toA, _fromB, _toB, text) => {
    count += 1
    if (toA !== fromA || text.length > 1) pureInsertion = false
    if (count === 1) inserted = text.toString()
  })
  return count === 1 && pureInsertion && inserted.length === 1 ? inserted : null
}

class GhostTextWidget extends WidgetType {
  // 不用构造器参数属性：`node --test` 的类型擦除模式不支持它（`ERR_UNSUPPORTED_TYPESCRIPT_SYNTAX`），
  // 而 `tests/inline-completion-dismiss.test.mjs` 要直接检查这个模块导出的键位绑定。
  readonly text: string
  constructor(text: string) { super(); this.text = text }
  eq(other: GhostTextWidget) { return other.text === this.text }
  toDOM(view: EditorView) {
    const span = document.createElement('span')
    span.className = 'cm-inline-suggestion'
    span.textContent = this.text
    // 屏幕阅读器不该念出这段"还没被接受"的文本（IDEA 的 ghost text 也不进无障碍树）。
    span.setAttribute('aria-hidden', 'true')
    // 右键 ⇄ 悬浮操作条（上游 `InlineCompletionTooltipProvokerMouseListener.kt:11-25`：只认 BUTTON3
    // （`:40`）、点必须在正在显示的幽灵文本范围内（`:44-49`，绑在这个元素上就是天然满足）、
    // `:17` 的 `event.consume()` ⇒ 这里 preventDefault + stopPropagation，不再弹编辑器自己的右键菜单）。
    // 浮层内容与键位都来自本文件的真实绑定表（`inlineTooltipEntries`），不放没有后端的动作。
    span.addEventListener('contextmenu', event => {
      if (!isInlineTooltipProvoker(event.button, true, event.defaultPrevented)) return
      event.preventDefault()
      event.stopPropagation()
      toggleInlineCompletionTooltip(view, span.getBoundingClientRect(), inlineTooltipEntries(inlineCompletionBindings))
    })
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
  hideInlineCompletionTooltip(editor)      // 上游：文本一变就收（HIDE_BY_TEXT_CHANGE，`InlineCompletionTooltip.kt:76-78`）
  return true
}

/**
 * Esc 收起幽灵文本（IDEA 的 `InlineCompletionHandler` 同款：Esc 让建议消失，不插入）。
 * **不抢补全弹窗的 Esc**：弹窗开着时返回 false，让自动补全先收；没有建议时也返回 false，
 * Esc 继续去干它本来要干的事（退选择/关别的浮层）。判定在 `shouldDismissInlineSuggestion`。
 */
export function dismissInlineSuggestion(editor: EditorView): boolean {
  const hasSuggestion = editor.state.field(inlineSuggestionField, false) !== null
  if (!shouldDismissInlineSuggestion(hasSuggestion, completionStatus(editor.state) === 'active')) return false
  editor.dispatch({ effects: setInlineSuggestion.of(null) })
  hideInlineCompletionTooltip(editor)
  return true
}

/**
 * 部分接受：`word` = `InsertInlineCompletionWordAction`（上游用 EditorNextWord 的键，Ctrl+→），
 * `line` = `InsertInlineCompletionLineAction`（上游用 EditorLineEnd 的键，End）。
 * 插入前缀后建议**不消失**，剩下的文本继续作幽灵文本挂在新光标处；前缀已经覆盖整段时
 * 等价于整段接受（转到 `acceptInlineSuggestion`）。返回 false = 这次按键不归我。
 */
export function acceptInlineSuggestionPartially(editor: EditorView, mode: InlinePartialAcceptMode): boolean {
  const suggestion = editor.state.field(inlineSuggestionField, false)
  if (!suggestion) return false
  const length = inlinePartialAcceptLength(suggestion.insertText, mode)
  if (length <= 0) return false
  const remaining = truncateSuggestion(suggestion, length)
  if (!remaining) return acceptInlineSuggestion(editor)
  const from = positionOf(editor.state, suggestion.span.startLine, suggestion.span.startChar)
  const to = positionOf(editor.state, suggestion.span.endLine, suggestion.span.endChar)
  if (from === null || to === null || to < from) return false
  const inserted = suggestion.insertText.slice(0, length)
  editor.dispatch({
    changes: { from, to, insert: inserted },
    selection: { anchor: from + inserted.length },
    effects: setInlineSuggestion.of(remaining),
    userEvent: 'input.inlineCompletion.partialAccept',
  })
  hideInlineCompletionTooltip(editor)
  return true
}

/**
 * Tab 接受 / Esc 收起 / Ctrl+→ 接受下一个词 / End 接受下一行。
 * Tab **必须排在自动补全的 Tab 之前**，否则补全弹窗会先把 Tab 吃掉 ——
 * 所以整组用 `Prec.highest`；没建议时 `run` 返回 false，按键继续传给下一个绑定
 * （Ctrl+→ 与 End 在没建议时就是普通的词/行导航）。
 * 绑定表单独导出，判据（`tests/inline-completion-dismiss.test.mjs`）直接驱动它。
 */
export const inlineCompletionBindings = [
  { key: 'Tab', role: 'accept' as const, preventDefault: false, run: acceptInlineSuggestion },
  { key: 'Escape', role: 'dismiss' as const, preventDefault: false, run: dismissInlineSuggestion },
  { key: 'Ctrl-ArrowRight', role: 'accept-word' as const, preventDefault: false, run: (editor: EditorView) => acceptInlineSuggestionPartially(editor, 'word') },
  { key: 'End', role: 'accept-line' as const, preventDefault: false, run: (editor: EditorView) => acceptInlineSuggestionPartially(editor, 'line') },
]
export const inlineCompletionKeymap = Prec.highest(keymap.of(inlineCompletionBindings))

/**
 * 「切建议」与「显式索取」三条键位。
 *
 * 上游的键位表（`platform/lang-impl/resources/intellij.platform.lang.impl.actions.xml`）：
 *   · `NextInlineCompletionSuggestionAction` = `alt CLOSE_BRACKET`（`:127-129`），
 *     `PrevInlineCompletionSuggestionAction` = `alt OPEN_BRACKET`（`:130-132`）
 *     —— 类是 `SwitchInlineCompletionVariantAction$Next/$Prev`（`InlineCompletionActions.kt:35/37`）；
 *   · `CallInlineCompletionAction` = `shift alt BACK_SLASH`（`:115-117`），显式触发一次请求。
 *
 * 可用性照 `SwitchInlineCompletionVariantAction.Handler.isEnabledForCaret`
 * （`InlineCompletionActions.kt:48-50`：context 存在且 `startOffset == caret.offset`）：
 * 没有建议时 `run` 返回 false，按键继续往下传 —— 没建议时 Alt+] 就是普通按键。
 * 切哪一条、往返怎么绕，由 `src/inlineCompletionNav.ts` 的 `cycleSuggestionIndex` 决定
 * （上游 `findStateIndex` 走整个圆环，`InlineCompletionVariantsProvider.kt:339-352`）。
 */
export interface InlineNavigationDeps {
  /** 切到第 `delta` 条（+1 下一条 / -1 上一条）。没有可切的建议时返回 false。 */
  cycle: (view: EditorView, delta: number) => boolean
  /** 显式索取一次（Shift+Alt+\）。 */
  call: (view: EditorView) => boolean
}

export function inlineNavigationBindings(deps: InlineNavigationDeps) {
  return [
    { key: 'Alt-]', preventDefault: false, run: (view: EditorView) => deps.cycle(view, 1) },
    { key: 'Alt-[', preventDefault: false, run: (view: EditorView) => deps.cycle(view, -1) },
    { key: 'Shift-Alt-\\', preventDefault: false, run: (view: EditorView) => deps.call(view) },
  ]
}

export function inlineNavigationKeymap(deps: InlineNavigationDeps): Extension {
  return Prec.highest(keymap.of(inlineNavigationBindings(deps)))
}

/** 把适配器返回的一项落成编辑器状态；没有可显示的文本时返回 null（调用方据此清掉旧建议）。 */
export function suggestionFor(
  item: InlineCompletionItem | undefined,
  cursor: { line: number; char: number },
): InlineSuggestion | null {
  const text = inlineGhostText(item)
  if (!item || !text) return null
  return { text, insertText: item.insertText, span: inlineAcceptSpan(item, cursor) }
}
