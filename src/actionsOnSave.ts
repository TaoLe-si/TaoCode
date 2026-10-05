// IDEA「工具 › 保存时操作」的**执行链**（`ActionsOnSaveFileDocumentManagerListener.kt`）。
//
// 上游 `FormatOnSaveAction.kt:24-77` 的顺序是固定的四段，逐段判开关后**链式**包起来
// （`OptimizeImportsProcessor(processor)`，`:52-63`），最后一次 `processor.run()` 落盘
// ——不是四遍各自写盘：
//   ① Reformat code         `FormatOnSaveOptions.isRunOnSaveEnabled`
//   ② Optimize imports      `OptimizeImportsOnSaveOptions.isRunOnSaveEnabled`
//   ③ Rearrange code        `RearrangeCodeOnSaveActionInfo.isRearrangeCodeOnSaveEnabled`
//   ④ Run code cleanup      `CodeCleanupOnSaveActionInfo.isCodeCleanupOnSaveEnabled`
// 每段还各自有"对哪些文件类型生效"的过滤（`isFileTypeSelected`），本仓的语言服务就绪判据
// （`lspOn(tab)`）承担同一角色：没有语言服务就没有可执行的处理器。
//
// 本仓能接的是 ①：语言服务的 `formatting` 请求与 `ReformatCodeProcessor` 对位。
// ②–④ 需要各自的**可持久化开关**才能执行，而设置键要同时跨三道口子：
// `native/settings_schema.hpp` 的键白名单、`native/settings_schema.cpp` 的默认值、
// `src/bridge.ts` 的 general 补丁白名单 —— `bridge.ts` 本轮被别的 lane 独占（禁改），
// 所以这里**不放假开关**：模块只执行已有开关的那一段，其余三段记成
// 「缺：可持久化开关（被禁改的 `src/bridge.ts` 挡住）」。
//
// 返回**要写盘的正文**而不是自己写盘：上游是"处理器改文档，保存流程再落盘"，
// 本仓写盘在 `App.vue save()` 的 `file.write`，所以这里只负责让缓冲区与将要落盘的内容一致。
import type { LspFormatResult } from './bridge.ts'
import { applyTextEdits } from './editorText.ts'
import { errorMessage } from './errors.ts'

export interface ActionsOnSaveInput {
  /** 正在保存的路径（`LspFileEdits.path` 用它挑出本文件那一份编辑）。 */
  path: string
  content: string
  /** `FormatOnSaveOptions.isRunOnSaveEnabled` 的本仓键（编辑器设置 `formatOnSave`）。 */
  formatOnSave: boolean
  /** 语言服务就绪：没有处理器可用时整条链直接短路（照上游 `getPsiFile(...) ?: return`）。 */
  lspAvailable: boolean
  /** 注入的格式化调用（单测用假实现；生产是 `lsp.request` 的 `formatting`）。 */
  format: () => Promise<LspFormatResult>
  /** 失败**不阻断保存**，但必须说清（上游把 processor 异常记进日志，本仓用通知）。 */
  notify: (message: string, error?: boolean) => void
}

export interface ActionsOnSaveResult {
  /** 写盘该用的正文；没有任何处理器改动时就是原样。 */
  content: string
  /** 缓冲区要不要跟着更新（`setDraft`）。 */
  changed: boolean
}

/**
 * 按上游四段的固定顺序执行；本仓当前只有第一段有落点。
 * 返回的是**新正文**，调用方负责 `setDraft` 与 `file.write`。
 */
export async function runActionsOnSave(input: ActionsOnSaveInput): Promise<ActionsOnSaveResult> {
  // ① 一段都没有就整个返回（上游 `isEnabledForProject` 全假时连文档都不查）。
  if (!input.formatOnSave || !input.lspAvailable) return { content: input.content, changed: false }
  try {
    const formatted = await input.format()
    const file = formatted.edits?.find(entry => entry.path === input.path)
    if (!file?.textEdits.length) return { content: input.content, changed: false }
    const next = applyTextEdits(input.content, file.textEdits)
    // 缓冲区必须与落盘内容一致，否则保存成功后编辑器还停在旧文本上（仍显示脏）。
    return { content: next, changed: next !== input.content }
  } catch (error) {
    input.notify(`保存前格式化失败，按原样保存：${errorMessage(error)}`, true)
    return { content: input.content, changed: false }
  }
}
