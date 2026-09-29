// Code Vision（LSP `textDocument/codeLens`）的 **CodeMirror 落点 + 自包含调度**。
//
// 为什么整包导出（`createCodeLens(deps)` 返回 `{ extension, schedule, reset }`）而不是
// "CodeEditor 持状态、这里只渲染"：CodeEditor.vue 已经贴着机检上限（`tests/module-size.test.mjs`），
// 每个能力再往里塞 20 行"去抖 + 请求 + 转换"，它立刻超标。请求、节流、渲染、点击**都属于这一个能力**，
// 一起放在这里最内聚；CodeEditor 只留 3 行组装 + 几个触发点。
//
// 纯规则（挂哪一行、点击发什么）在 `src/codeLens.ts`；IDEA 的依据见那里的模块注释。

import { StateEffect, StateField, type EditorState, type Extension } from '@codemirror/state'
import { Decoration, EditorView, WidgetType, type DecorationSet } from '@codemirror/view'
import { anchoredLenses, codeLensCommand, codeLensTooltip, type AnchoredLens, type CodeLensResult } from './codeLens'

/** 一条可点击的 Code Vision 条目。 */
class CodeLensWidget extends WidgetType {
  constructor(readonly lens: AnchoredLens, readonly onCommand: (command: string, args?: unknown[]) => void) { super() }
  eq(other: CodeLensWidget) {
    return other.lens.item.title === this.lens.item.title && other.lens.item.command === this.lens.item.command
  }
  toDOM() {
    const host = document.createElement('span')
    host.className = 'cm-code-lens'
    const button = document.createElement('button')
    button.type = 'button'
    button.className = 'cm-code-lens-action'
    button.textContent = this.lens.item.title
    button.title = codeLensTooltip(this.lens.item)
    button.addEventListener('mousedown', event => {
      // 吃掉这次按下：Code Vision 的点击是**执行命令**，不该顺手把光标挪过去。
      event.preventDefault()
      event.stopPropagation()
      const payload = codeLensCommand(this.lens.item)
      if (payload) this.onCommand(payload.command, payload.arguments)
    })
    host.appendChild(button)
    return host
  }
  // 必须 false：否则 CodeMirror 会把点击当编辑器交互吞掉，按钮永远收不到事件。
  ignoreEvent() { return false }
}

export const setCodeLens = StateEffect.define<readonly AnchoredLens[]>()
const onCodeLensCommand = StateEffect.define<null>()   // 占位，保持 effect 类型集中

function buildDecorations(state: EditorState, lenses: readonly AnchoredLens[], onCommand: (command: string, args?: unknown[]) => void): DecorationSet {
  if (!lenses.length) return Decoration.none
  const decorations: ReturnType<Decoration['range']>[] = []
  for (const lens of lenses) {
    // 行号越界就跳过（服务端算的时候文档可能已经变了）。
    if (lens.line >= state.doc.lines) continue
    const line = state.doc.line(lens.line + 1)
    // `block: true` 是 CodeMirror 里唯一能表达"行**上方**"的方式（行内 widget 会挤在代码中间，
    // 那是 inlay hint 的位置，不是 Code Vision 的位置）。
    decorations.push(Decoration.widget({ widget: new CodeLensWidget(lens, onCommand), block: true, side: -1 }).range(line.from))
  }
  return Decoration.set(decorations, true)
}

export interface CodeLensDeps {
  /** 发一次 `lsp.request { kind: 'codeLens' }`。抛错由调用方兜（这里只清空）。 */
  query: () => Promise<CodeLensResult>
  /** 当前是否该问（LSP 开着、不是大文件、有视图）。 */
  enabled: () => boolean
  view: () => EditorView | undefined
  /** 点击一条 Code Vision → 执行它的命令。 */
  onCommand: (command: string, args?: unknown[]) => void
  /** 节流窗口，毫秒。 */
  delayMs?: number
}

export interface CodeLensController {
  extension: Extension
  schedule(): void
  reset(): void
  dispose(): void
}

export function createCodeLens(deps: CodeLensDeps): CodeLensController {
  const field = StateField.define<DecorationSet>({
    create: () => Decoration.none,
    update(_decorations, transaction) {
      // 行号依赖精确位置，内容一变整份作废（和语义着色/文档链接同理）。
      if (transaction.docChanged) return Decoration.none
      for (const effect of transaction.effects)
        if (effect.is(setCodeLens)) return buildDecorations(transaction.state, effect.value, deps.onCommand)
      return _decorations
    },
    provide: f => EditorView.decorations.from(f),
  })
  let timer: number | undefined
  let inFlight = false

  async function run() {
    const editor = deps.view()
    if (!editor || !deps.enabled() || inFlight) return
    inFlight = true
    try {
      const result = await deps.query()
      const target = deps.view()
      if (target !== editor) return      // 期间换过文档，这次的答案已经过期
      target.dispatch({ effects: setCodeLens.of(result.available ? anchoredLenses(result.items) : []) })
    } catch {
      // 服务器没有 codeLens 能力时什么都不显示（不是错误，别打断用户）。
      deps.view()?.dispatch({ effects: setCodeLens.of([]) })
    } finally { inFlight = false }
  }

  return {
    extension: [
      field,
      // 模块自带样式：它只服务这一个能力，放进 CodeEditor 的 theme 里会让那边的样式表继续膨胀。
      EditorView.theme({
        '.cm-code-lens': { display: 'block', lineHeight: '1.2' },
        '.cm-code-lens-action': {
          background: 'transparent', border: 'none', padding: '0 4px', cursor: 'pointer',
          color: 'var(--muted)', font: 'inherit', fontSize: '11px', textAlign: 'left',
        },
        '.cm-code-lens-action:hover': { color: 'var(--bright)', textDecoration: 'underline' },
      }),
    ],
    schedule() {
      if (!deps.enabled()) return
      if (timer !== undefined) clearTimeout(timer)
      timer = window.setTimeout(() => { timer = undefined; void run() }, deps.delayMs ?? 400)
    },
    reset() { deps.view()?.dispatch({ effects: setCodeLens.of([]) }) },
    dispose() { if (timer !== undefined) clearTimeout(timer) },
  }
}
