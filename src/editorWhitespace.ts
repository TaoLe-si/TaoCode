// IDEA 的 "Visualize whitespaces"（设置页 `Editor › General › Appearance › Show whitespaces`）：
// 每个空格画一个点、每个制表符画一个箭头，用**替换字符**表达，所以不会挤动被标注的文本。
//
// 从 `CodeEditor.vue` 拆出来（那个文件贴着机检上限）：这一段是自足的 —— 只依赖 CodeMirror 的
// 装饰 API，与编辑器实例、props、LSP 都无关。
import { Decoration, EditorView, ViewPlugin, WidgetType, type DecorationSet, type ViewUpdate } from '@codemirror/view'
import { RangeSetBuilder } from '@codemirror/state'

class WhitespaceWidget extends WidgetType {
  constructor(readonly tab: boolean) { super() }
  eq(other: WhitespaceWidget) { return other.tab === this.tab }
  toDOM() {
    const span = document.createElement('span')
    span.className = this.tab ? 'cm-whitespace-tab' : 'cm-whitespace-space'
    span.textContent = this.tab ? '→' : '·'
    span.setAttribute('aria-hidden', 'true')
    return span
  }
  ignoreEvent() { return false }
}

// 一次重绘的 widget 预算：压缩过的 bundle 或生成的表格能让一屏出现上万个空格，
// 每个都是真实 DOM 节点。超预算就**停止标注**，而不是把编辑器卡住。
const WHITESPACE_BUDGET = 50000

function buildWhitespace(view: EditorView): DecorationSet {
  const builder = new RangeSetBuilder<Decoration>()
  let budget = WHITESPACE_BUDGET
  for (const { from, to } of view.visibleRanges) {
    const text = view.state.doc.sliceString(from, to)
    for (let index = 0; index < text.length && budget > 0; ++index) {
      const character = text[index]!
      if (character !== ' ' && character !== '\t') continue
      --budget
      builder.add(from + index, from + index + 1, Decoration.replace({ widget: new WhitespaceWidget(character === '\t') }))
    }
  }
  return builder.finish()
}

export const whitespaceLayer = [
  ViewPlugin.fromClass(class {
    decorations: DecorationSet
    constructor(readonly view: EditorView) { this.decorations = buildWhitespace(view) }
    update(update: ViewUpdate) { if (update.docChanged || update.viewportChanged) this.decorations = buildWhitespace(update.view) }
  }, { decorations: plugin => plugin.decorations }),
  EditorView.theme({
    '.cm-whitespace-space': { color: 'var(--muted)', opacity: '0.55' },
    '.cm-whitespace-tab': { color: 'var(--muted)', opacity: '0.55' },
  }),
]
