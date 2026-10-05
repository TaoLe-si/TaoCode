// 编辑器的 CodeMirror 主题与词法着色表。
//
// 从 `CodeEditor.vue` 拆出来（那个文件贴着机检上限）：这一段只依赖入参（字号、行号开关、
// 深色与否），不碰编辑器实例、props 或 LSP —— 是本文件里最自足的一块。
//
// **配色是我们的**（`src/tokens.css`），几何/常量才去源码找依据；LSP 语义着色的表在
// `src/editorSemanticColors.ts`（那里写了「为什么选择器都要带 `.cm-content`」）。
import { HighlightStyle, indentUnit } from '@codemirror/language'
import { EditorView } from '@codemirror/view'
import { EditorState, type Extension } from '@codemirror/state'
import { tags } from '@lezer/highlight'
import { semanticHighlightThemeRules } from './editorSemanticColors.ts'
import { lineNumerationExtension, type LineNumeration } from './editorLineNumbers.ts'

/** 词法着色（`HighlightStyle`）：九档色相，全部走 tokens.css 的 `--syntax-*`。 */
export const syntaxColors = HighlightStyle.define([
  { tag: [tags.keyword, tags.modifier, tags.controlKeyword], color: 'var(--syntax-keyword)', fontWeight: '600' },
  { tag: [tags.string, tags.special(tags.string), tags.regexp], color: 'var(--syntax-string)' },
  { tag: tags.comment, color: 'var(--syntax-comment)', fontStyle: 'italic' },
  { tag: [tags.number, tags.bool, tags.null], color: 'var(--syntax-number)' },
  { tag: [tags.typeName, tags.className, tags.namespace, tags.tagName], color: 'var(--syntax-type)' },
  { tag: [tags.function(tags.variableName), tags.function(tags.propertyName)], color: 'var(--syntax-function)' },
  { tag: [tags.propertyName, tags.attributeName, tags.labelName], color: 'var(--syntax-property)' },
  { tag: [tags.operator, tags.punctuation], color: 'var(--syntax-operator)' },
  { tag: [tags.meta, tags.annotation, tags.processingInstruction], color: 'var(--syntax-meta)' },
])

export interface EditorThemeOptions { fontSize: number; lineNumbers: boolean; dark: boolean }

/** 编辑器外观主题。IDE 侧没有对应类 —— 这是"CodeMirror 宿主长什么样"的本仓实现。 */
export function editorTheme({ fontSize, lineNumbers, dark }: EditorThemeOptions) {
  return EditorView.theme({
    '&': { height: '100%', color: 'var(--text)', backgroundColor: 'var(--editor)', fontSize: `${fontSize}px` },
    '.cm-scroller': { overflow: 'auto', fontFamily: 'var(--font-mono)', lineHeight: '1.7' },
    '.cm-content': { padding: '12px 0', caretColor: 'var(--bright)' },
    '.cm-line': { padding: '0 20px 0 12px' },
    '.cm-gutters': { backgroundColor: 'var(--gutter)', color: 'var(--muted)', border: 'none', minWidth: lineNumbers ? '48px' : '16px', cursor: 'pointer' },
    '.cm-activeLineGutter': { backgroundColor: 'var(--active-line)', color: 'var(--secondary)' },
    // CodeMirror draws selection rectangles underneath line backgrounds.
    '.cm-activeLine': { backgroundColor: 'var(--active-line)' },
    // LSP 语义高亮（IDEA 的 daemon 着色）。
    ...semanticHighlightThemeRules(),
    // 行内补全的幽灵文本：灰色、不占位（`aria-hidden` 已在 widget 里设了）。
    '.cm-inline-suggestion': { color: 'var(--muted)', fontStyle: 'italic', pointerEvents: 'none' },
    // 行内装订线图标（IDEA `GutterIconRenderer`）。断点/书签/诊断不再用整行 boxShadow 表达。
    '.cm-gutter-icons': { minWidth: '16px' },
    '.cm-gutter-icon-cell': { display: 'inline-flex', alignItems: 'center', gap: '1px' },
    '.cm-gutter-icon': { display: 'inline-flex', alignItems: 'center', justifyContent: 'center', width: '14px', height: '14px' },
    '.cm-gutter-icon.clickable': { cursor: 'pointer' },
    '.cm-line.cm-debug-line': { backgroundColor: 'var(--debug-line)' },
    '.cm-lsp-highlight': { backgroundColor: 'var(--symbol-highlight)', borderRadius: '2px' },
    // 「高亮用法」的临时高亮（`src/usageHighlightExtension.ts`，上游 `HighlightUsagesAction`）：
    // 与 LSP documentHighlight 同一档底色，光标所在那条再叠一圈强调色。
    '.cm-usageHighlight': { backgroundColor: 'var(--symbol-highlight)', borderRadius: '2px' },
    '.cm-usageHighlight-current': { backgroundColor: 'var(--accent-soft)', outline: '1px solid var(--accent)' },
    '.cm-lsp-inlay': { color: 'var(--muted)', fontStyle: 'italic', fontSize: '0.92em' },
    // 行内调试值（`src/editorInlineValues.ts`，上游 `InlineDebugRenderer`）：值的小字比
    // inlay 再淡一档，不抢代码的阅读。
    '.cm-inline-value': { color: 'var(--muted)', fontStyle: 'italic', fontSize: '0.9em', opacity: '0.9' },
    '.cm-selectionBackground': { backgroundColor: 'var(--selection-inactive)' },
    '&.cm-focused > .cm-scroller > .cm-selectionLayer .cm-selectionBackground': { backgroundColor: 'var(--selection)' },
    '&.cm-focused': { outline: 'none' },
    '.cm-cursor': { borderLeftColor: 'var(--bright)' },
    '.cm-panels': { backgroundColor: 'var(--panel)', color: 'var(--text)' },
    // 查找命中（`var(--search-match)` 就是上游 `EditorColors.TEXT_SEARCH_RESULT_ATTRIBUTES` 的那一档；
    // 当前条由 `src/editorSearchExtension.ts` 再叠一个 `.cm-searchMatch-current`）。
    '.cm-searchMatch': { backgroundColor: 'var(--search-match)' },
    '.cm-tooltip': { backgroundColor: 'var(--elevated)', color: 'var(--text)', borderColor: 'var(--line-strong)' },
    '.cm-tooltip-autocomplete > ul > li[aria-selected]': { backgroundColor: 'var(--selected)', color: 'var(--bright)' },
    '.lsp-hover': { padding: '7px 9px', maxWidth: '460px', whiteSpace: 'pre-wrap', fontFamily: 'var(--font-mono)', fontSize: '12px' },
  }, { dark })
}

export interface EditorOptionInput { tabSize: number; indentUnit: string; wordWrap: boolean; lineNumbers: boolean; showWhitespaces: boolean; lineNumeration: LineNumeration }

/**
 * 编辑器的那几条状态扩展（制表符/换行/行号/空白可视化）。
 * 从 `CodeEditor.vue` 拆出来（那个文件贴着机检上限）；`EditorState`/`indentUnit` 的用法与
 * 组件里那处逐字相同 —— 只是参数从 props 变成了入参。
 *
 * 行号排法（`lineNumeration`）里的相对/混合两档不改进内建 gutter 的格式，而是换一棵
 * `.cm-relative-line-numbers`（见 `src/editorLineNumbers.ts` 头部的取舍说明），
 * 所以这里要同时控制两棵 gutter 的显隐。
 */
export function editorOptionExtensions(input: EditorOptionInput, heavy: boolean, whitespaceLayer: Extension): Extension[] {
  const relative = input.lineNumeration !== 'absolute'
  return [
    EditorState.tabSize.of(input.tabSize),
    indentUnit.of(input.indentUnit),
    input.wordWrap && !heavy ? EditorView.lineWrapping : [],
    EditorView.theme({
      '.cm-lineNumbers': { display: input.lineNumbers && !relative ? 'flex' : 'none' },
      '.cm-relative-line-numbers': { display: input.lineNumbers && relative ? 'flex' : 'none' },
    }),
    relative ? lineNumerationExtension(input.lineNumeration) : [],
    // "Show whitespaces": every space becomes a faint dot and every tab an arrow.
    input.showWhitespaces ? whitespaceLayer : [],
  ]
}
