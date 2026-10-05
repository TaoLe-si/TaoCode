// 同一符号高亮（IDEA 的 `HighlightUsagesHandler` 走 daemon 的那条链路在本仓的
// LSP 等价物：`textDocument/documentHighlight`）。光标移动后去抖地问一次语言服务，
// 把返回的整词出现位置标成 `.cm-lsp-highlight`。
//
// 从 `CodeEditor.vue` 拆出（那个文件贴着机检上限）：调度（去抖 + 飞行中丢弃过期结果）
// 与装饰状态机是自包含的，宿主只注入「当前视图 / 当前路径 / 能力是否可用」。
//
// 真正的临时高亮（`HighlightUsagesAction` = Ctrl+Shift+F7）在
// `src/usageHighlightExtension.ts`；本模块只跟 LSP 的 documentHighlight。
import { RangeSetBuilder, StateEffect, StateField, type Extension } from '@codemirror/state'
import { Decoration, EditorView } from '@codemirror/view'
import { request, type LspHighlightResult } from './bridge.ts'
import { lspPosition } from './editorDiagnosticMarkers.ts'

export const setSymbolHighlights = StateEffect.define<{ from: number; to: number }[]>()

const highlightField = StateField.define<{ from: number; to: number }[]>({
  create: () => [],
  update(value, transaction) {
    for (const effect of transaction.effects) if (effect.is(setSymbolHighlights)) return effect.value
    return value
  },
  provide: f => EditorView.decorations.compute([f], state => {
    const builder = new RangeSetBuilder<Decoration>()
    let last = -1
    for (const range of [...state.field(f)].sort((a, b) => a.from - b.from || a.to - b.to)) {
      if (range.to <= range.from || range.from < last) continue
      builder.add(range.from, range.to, Decoration.mark({ class: 'cm-lsp-highlight' }))
      last = range.to
    }
    return builder.finish()
  }),
})

export interface SymbolHighlightDeps {
  /** LSP 可用且不是大文件模式。 */
  enabled: () => boolean
  path: () => string
  view: () => EditorView | undefined
}

/** 去抖时长：跟着编辑走，比补全宽松一点即可（与 LSP 请求的 400ms 同一量级）。 */
const DEBOUNCE_MS = 160

export function createSymbolHighlight(deps: SymbolHighlightDeps) {
  let timer: number | undefined
  let generation = 0

  async function run() {
    const editor = deps.view()
    if (!editor || !deps.enabled()) return
    const current = ++generation
    const head = editor.state.selection.main.head
    const info = editor.state.doc.lineAt(head)
    try {
      const result = await request<LspHighlightResult>('lsp.request', { kind: 'documentHighlight', path: deps.path(), line: info.number - 1, character: head - info.from })
      const target = deps.view()
      if (!target || current !== generation) return
      const ranges = (result.highlights ?? []).flatMap(item => {
        try {
          const from = lspPosition(target.state.doc, item.startLine, item.startChar)
          const to = lspPosition(target.state.doc, item.endLine, item.endChar)
          return to > from ? [{ from, to }] : []
        } catch { return [] }
      })
      target.dispatch({ effects: setSymbolHighlights.of(ranges) })
    } catch { /* 服务器可能正在关闭；旧高亮留着无害 */ }
  }

  function schedule() {
    if (!deps.enabled()) return
    if (timer !== undefined) clearTimeout(timer)
    timer = window.setTimeout(() => { timer = undefined; void run() }, DEBOUNCE_MS)
  }

  /** 关掉语言服务/大文件模式时把已画的去样撤掉 —— 留着就是一份没人再更新的旧标记。 */
  function clear() {
    ++generation
    deps.view()?.dispatch({ effects: setSymbolHighlights.of([]) })
  }

  function dispose() {
    ++generation
    if (timer !== undefined) clearTimeout(timer)
    timer = undefined
  }

  return { extension: highlightField as Extension, schedule, clear, dispose }
}
