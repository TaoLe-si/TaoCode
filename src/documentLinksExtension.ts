// LSP `textDocument/documentLink` 的 **CodeMirror 落点 + 自包含调度**。
//
// 从 `CodeEditor.vue` 搬出来的（那边贴着机检上限）：`linkField` 只服务这一个能力，
// 请求与节流也只服务这一个能力，一起放这里最内聚。CodeEditor 只留：
//   · 把 controller 的 extension 挂进 LSP compartment；
//   · 在触发点调 `schedule()`；
//   · hover 与 Ctrl+Click 读 `linkField` + `linkAt`（后者的纯规则在 `src/documentLinks.ts`）。
//
// IDEA 的依据（`GotoDeclarationHandler` / `HyperlinkInfo.navigate` / `OpenUrlHyperlinkInfo`）
// 见 `src/documentLinks.ts` 的模块注释。

import { StateEffect, StateField, type Extension } from '@codemirror/state'
import { EditorView } from '@codemirror/view'
import type { DocumentLink, DocumentLinkResult } from './documentLinks.ts'

export const setDocumentLinks = StateEffect.define<readonly DocumentLink[]>()

/** 当前文档的可点击区间。**文档一变整份作废**（区间依赖精确位置）。 */
export const linkField = StateField.define<readonly DocumentLink[]>({
  create: () => [],
  update: (links, transaction) => {
    if (transaction.docChanged) return []
    for (const effect of transaction.effects)
      if (effect.is(setDocumentLinks)) return effect.value
    return links
  },
})

export interface DocumentLinksDeps {
  query: () => Promise<DocumentLinkResult>
  enabled: () => boolean
  view: () => EditorView | undefined
  delayMs?: number
}

export interface DocumentLinksController {
  extension: Extension
  schedule(): void
  reset(): void
  dispose(): void
}

export function createDocumentLinks(deps: DocumentLinksDeps): DocumentLinksController {
  let timer: number | undefined
  let inFlight = false

  async function run() {
    const editor = deps.view()
    if (!editor || !deps.enabled() || inFlight) return
    inFlight = true
    try {
      const result = await deps.query()
      const target = deps.view()
      if (target !== editor) return       // 期间换过文档，答案已过期
      target.dispatch({ effects: setDocumentLinks.of(result.available ? result.links ?? [] : []) })
    } catch {
      // 服务器没有链接能力时保持原样（不是错误，不影响编辑）。
    } finally { inFlight = false }
  }

  return {
    extension: linkField,
    schedule() {
      if (!deps.enabled()) return
      if (timer !== undefined) clearTimeout(timer)
      timer = window.setTimeout(() => { timer = undefined; void run() }, deps.delayMs ?? 400)
    },
    reset() { deps.view()?.dispatch({ effects: setDocumentLinks.of([]) }) },
    dispose() { if (timer !== undefined) clearTimeout(timer) },
  }
}
