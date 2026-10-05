// LSP 语义着色的 decoration 层（上游 daemon 着色路径见 `src/semanticTokens.ts`：
// `HighlightVisitor`/`Annotator` + `TextAttributesKey`）。
//
// 从 `CodeEditor.vue` 拆出（那个文件贴着机检上限）：这一半只做「token 列表 → 装饰」，
// 拉取/增量/delta 合并与导入期重试留在宿主（它们要和 request/warmup 的生命周期绑一起）。
//
// **文档一变就整份作废**：语义着色依赖精确的 (行, 列)，把旧 decoration map 到新位置
// 只会把颜色留在错误的 token 上；下一次拉取回来重建。
import { RangeSetBuilder, StateEffect, StateField, type EditorState, type Extension } from '@codemirror/state'
import { Decoration, EditorView, type DecorationSet } from '@codemirror/view'
import { semanticTokenClass, type SemanticToken } from './semanticTokens.ts'

export const setSemanticTokens = StateEffect.define<readonly SemanticToken[]>()

// 越界的行/列直接跳过：服务端的 legend 版本与文档版本都可能和客户端不一致，
// 一个畸形 token 不该把编辑器打挂（更不该抛进 CodeMirror 的 update 里）。
export function buildSemanticDecorations(state: EditorState, tokens: readonly SemanticToken[]): DecorationSet {
  const builder = new RangeSetBuilder<Decoration>()
  // `RangeSetBuilder` 要求**按位置升序**添加，所以先排序（服务端的顺序不保证）。
  const ordered = [...tokens].sort((left, right) => left.line - right.line || left.startChar - right.startChar)
  for (const token of ordered) {
    if (token.line < 0 || token.line >= state.doc.lines) continue
    const line = state.doc.line(token.line + 1)
    const from = line.from + Math.max(0, token.startChar)
    const to = Math.min(line.to, from + Math.max(0, token.length))
    if (to <= from) continue
    const classes = semanticTokenClass(token)
    if (!classes) continue
    builder.add(from, to, Decoration.mark({ class: classes }))
  }
  return builder.finish()
}

export const semanticTokensField: Extension = StateField.define<DecorationSet>({
  create: () => Decoration.none,
  update: (decorations, transaction) => {
    if (transaction.docChanged) return Decoration.none
    for (const effect of transaction.effects)
      if (effect.is(setSemanticTokens)) return buildSemanticDecorations(transaction.state, effect.value)
    return decorations
  },
  provide: field => EditorView.decorations.from(field),
})
