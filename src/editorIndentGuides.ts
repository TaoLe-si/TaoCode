// 缩进参考线的装饰层（IDEA `EditorSettings.isIndentGuidesShown` + 编辑器外观
// `EditorAppearanceConfigurable` 的「显示缩进参考线」复选框）。
//
// 从 `CodeEditor.vue` 拆出（那个文件贴着机检上限）：每行按缩进宽度画淡竖线，
// 行内 widget 只依赖「当前制表符宽度」这一个入参，与 props/视图/LSP 都无关。
//
// 落点说明：IDEA 侧参考线由编辑器渲染器按 indent 画；CodeMirror 没有这个能力，
// 等价物是每行在 `tabSize` 的整数倍列上放一个 1px 高的行内 widget（`Decoration.widget`）。
// 只对缩进 > 1 级的行画（第 1 级没有左侧参照），与 IDEA 的观感一致。
import { RangeSetBuilder, StateEffect, StateField, type Extension } from '@codemirror/state'
import { Decoration, EditorView, WidgetType } from '@codemirror/view'

/** 设置一改就重配（`CodeEditor.vue` 的 settings watcher 派发它）。 */
export const setIndentGuides = StateEffect.define<boolean>()

class IndentGuideWidget extends WidgetType {
  toDOM() {
    const element = document.createElement('span')
    element.className = 'cm-indent-guide'
    return element
  }
  eq() { return true }
}

/**
 * 缩进参考线的扩展工厂。`tabSize` 传取值函数而不是数字：设置页改制表符宽度后
 * 组件只重配 options compartment，重建的扩展要立刻用新宽度画线。
 * `enabled` 是初始值（挂在 compartment 里的那一刻），之后靠 `setIndentGuides` 改。
 */
export function indentGuidesExtension(tabSize: () => number, enabled: () => boolean): Extension {
  const field = StateField.define<boolean>({
    create: () => enabled(),
    update(value, transaction) {
      for (const effect of transaction.effects) if (effect.is(setIndentGuides)) return effect.value
      return value
    },
    provide: f => EditorView.decorations.compute([f, EditorView.scrollMargins], state => {
      if (!state.field(f)) return Decoration.none
      const width = tabSize()
      const builder = new RangeSetBuilder<Decoration>()
      let lineNo = 1
      let iter = state.doc.iterLines()
      while (true) {
        const next = iter.next()
        if (next.done) break
        const text = next.value
        const indent = text.match(/^[ \t]*/)?.[0] ?? ''
        const cols = Math.floor(indent.replace(/\t/g, ' '.repeat(width)).length / width)
        if (cols > 1) {
          const from = state.doc.line(lineNo).from
          for (let column = 1; column < cols; ++column)
            builder.add(from + column * width - 1, from + column * width, Decoration.widget({ widget: new IndentGuideWidget(), side: -1 }))
        }
        ++lineNo
        iter = next
      }
      return builder.finish()
    }),
  })
  return [
    field,
    EditorView.theme({
      '& .cm-indent-guide': { display: 'inline-block', width: '1px', height: '1em', background: 'var(--border)', opacity: '0.55' },
    }),
  ]
}
