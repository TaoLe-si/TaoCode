// "当前执行行"的整行高亮 —— IDEA `ExecutionPointHighlighter` 的对应物（**不是** gutter 图标）。
//
// 为什么单独成模块：它和 gutter 图标层是两回事 —— IDEA 里断点/书签/书签标记属于 `GutterIconRenderer`
// 那一层（画在装订线上，见 src/gutterIcons.ts），而"调试停在哪一行"是画在文本行上的高亮
// （`platform/xdebugger-impl/.../ExecutionPointHighlighter`，与 gutter 无关）。
// 另外它把 CodeEditor.vue 里那 20 行 CodeMirror 状态机挪了出来，组件只留一行同步调用。
//
// 本模块只 import npm 包，且**不被测试直接 import**（需要 DOM 之外的 CodeMirror 运行时即满足，
// 但目前没有针对它的单测；纯规则在 src/gutterIcons.ts）。
import { Decoration, EditorView } from '@codemirror/view'
import type { Extension } from '@codemirror/state'
import { RangeSetBuilder, StateEffect, StateField } from '@codemirror/state'

/** 调试当前行（DAP 是 1 基行号；0 = 没有）。 */
export const setDebugLine = StateEffect.define<number>()

export const debugLineField = StateField.define<number>({
  create: () => 0,
  update(value, tr) {
    let next = value
    for (const effect of tr.effects) if (effect.is(setDebugLine)) next = effect.value
    return next
  },
  provide: field => EditorView.decorations.compute([field], state => {
    const line = state.field(field)
    if (line < 1 || line > state.doc.lines) return Decoration.none
    const from = state.doc.line(line).from
    const builder = new RangeSetBuilder<Decoration>()
    builder.add(from, from, Decoration.line({ class: 'cm-debug-line' }))
    return builder.finish()
  }),
})

/** 同步入口：编辑器挂载时与 `debugLine` 变化时各调一次。 */
export function syncDebugLine(view: EditorView | undefined, line: number): void {
  view?.dispatch({ effects: setDebugLine.of(line) })
}

/** 供编辑器把它装进扩展表（`debugLineField` 必须在扩展里，否则 `state.field` 会抛）。 */
export const debugLineExtension: Extension = debugLineField
