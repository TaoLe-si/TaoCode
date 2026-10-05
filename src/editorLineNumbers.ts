// 行号排法（上游 `EditorSettingsExternalizable.LINE_NUMERATION` =
// `EditorSettings.LineNumerationType`，默认 ABSOLUTE；UI 在 `EditorAppearanceConfigurable.kt:118-124`
// 的下拉框，文案 line.numeration.type.{absolute,relative,hybrid}）。
//
// 本仓的等价物：`src/settingsModel.ts` 的 `lineNumeration` 设置（绝对/相对/混合），
// 编辑器侧在 `src/components/CodeEditor.vue` 挂进 options compartment。
//
// 语义逐条照上游 `RelativeLineNumbersEditorCustomization` 用到的两个转换器：
//   · `RelativeLineNumberConverter`：显示 |当前行 - 光标行|（Vim 的 relativenumber，
//     光标行显示 0）；`RelativeLineHelper.getRelativeLine` 扣掉**折叠藏起来的行**
//     （折叠里的行不计数，本模块用 `foldedRanges` 复刻）；
//   · `HybridLineNumberConverter`：光标行显示**绝对行号**，其余行显示相对距离。
//
// 实现：CodeMirror 的内建行号 gutter 是 `basicSetup` 里那一个（固定 `.cm-lineNumbers`），
// 无法就地改格式，所以相对/混合模式另开一个 `.cm-relative-line-numbers` gutter，
// 由 `src/editorTheme.ts` 的 `editorOptionExtensions` 按模式切换两者的显隐。
import { foldedRanges } from '@codemirror/language'
import type { EditorState, Extension } from '@codemirror/state'
import { EditorView, GutterMarker, gutter, type BlockInfo, type ViewUpdate } from '@codemirror/view'

export type LineNumeration = 'absolute' | 'relative' | 'hybrid'

/** 设置值归一化：认不出的值按绝对行号（上游默认 ABSOLUTE）。 */
export function normalizeLineNumeration(value: unknown): LineNumeration {
  return value === 'relative' || value === 'hybrid' ? value : 'absolute'
}

/**
 * 被折叠藏起来的行数（`lineA..lineB` 之间，1 基，含两端）。
 * 照 `RelativeLineHelper.getRelativeLine` 的 `foldedBeforeLine - foldedBeforeCaret`：
 * 折叠区间覆盖的第 i+1 行起都算藏起来，区间起点那行仍可见。
 */
export function hiddenLineCount(state: EditorState, lineA: number, lineB: number): number {
  const start = Math.min(lineA, lineB)
  const end = Math.max(lineA, lineB)
  if (end === start) return 0
  const doc = state.doc
  let hidden = 0
  foldedRanges(state).between(doc.line(start).from, doc.line(end).to, (from, to) => {
    const firstHidden = doc.lineAt(from).number + 1
    const lastHidden = doc.lineAt(to).number
    const low = Math.max(firstHidden, start)
    const high = Math.min(lastHidden, end)
    if (high >= low) hidden += high - low + 1
  })
  return hidden
}

/** 显示文本（上游两个 converter 都取 `abs(...)`）：混合模式的光标行显示绝对行号。 */
export function lineNumberText(lineNo: number, caretLine: number, mode: LineNumeration, hidden = 0): string {
  if (mode === 'absolute') return String(lineNo)
  if (mode === 'hybrid' && lineNo === caretLine) return String(lineNo)
  return String(Math.max(0, Math.abs(lineNo - caretLine) - hidden))
}

class RelativeNumberMarker extends GutterMarker {
  readonly text: string
  constructor(text: string) { super(); this.text = text }
  eq(other: RelativeNumberMarker) { return other.text === this.text }
  toDOM() { return document.createTextNode(this.text) }
}

/** 相对/混合行号的 gutter（绝对模式不挂它）。 */
export function lineNumerationExtension(mode: LineNumeration): Extension {
  return [
    gutter({
      class: 'cm-relative-line-numbers',
      renderEmptyElements: false,
      lineMarker(view: EditorView, line: BlockInfo) {
        const state = view.state
        const lineNo = state.doc.lineAt(line.from).number
        const caretLine = state.doc.lineAt(state.selection.main.head).number
        const hidden = hiddenLineCount(state, lineNo, caretLine)
        return new RelativeNumberMarker(lineNumberText(lineNo, caretLine, mode, hidden))
      },
      // 光标一动所有行的数字都变（上游 `shouldRepaintOnCaretMovement() = true`）。
      lineMarkerChange: () => true,
      initialSpacer: (view: EditorView) => new RelativeNumberMarker(String(view.state.doc.lines)),
      updateSpacer: (spacer: GutterMarker, update: ViewUpdate) => {
        const next = String(update.view.state.doc.lines)
        return spacer instanceof RelativeNumberMarker && spacer.text === next ? spacer : new RelativeNumberMarker(next)
      },
    }),
    EditorView.theme({
      '.cm-relative-line-numbers .cm-gutterElement': { padding: '0 3px 0 5px', minWidth: '20px', textAlign: 'right', whiteSpace: 'nowrap' },
    }),
  ]
}
