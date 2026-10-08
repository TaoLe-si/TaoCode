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
//
// **本轮补的是「保存那条链少了三道本地闸」**（`docs/wiring-requests-2026-10-06-format.md` W4 的模块侧那一半）：
// `Ctrl+Alt+L` 那一条（`src/semanticActions.ts` 的 `runFormatting`）走完准入 → 请求 → 禁用段过滤 →
// 后处理；保存这一条此前只有「请求 → `applyTextEdits`」，三件事都没做。三道闸的上游出处：
//   · 准入 —— `ExcludedFileFormattingRestriction.isFormatterAllowed`
//     （`platform/lang-impl/src/com/intellij/formatting/ExcludedFileFormattingRestriction.java:16-25`），
//     汇总口是 `LanguageFormatting.forContext`（`platform/code-style-api/src/com/intellij/lang/LanguageFormatting.java:25-28`）
//     与自动重排那一档 `isAutoFormatAllowed`（同文件 `:52-61`，注释写明"automatic reformat"= 保存时这一类）；
//     ⇒ 「不格式化」清单对**保存路径同样成立**，规则复用 `src/formattingRestriction.ts`，不复制一份。
//   · 禁用段 —— `FormatterTagHandler`（`@formatter:off`），规则复用 `src/formatterTags.ts`。
//   · 后处理 —— `CoreCodeStyleUtil.postProcessText`（`:121-142`，只跑启用段），规则复用
//     `src/postFormatProcessors.ts` 的 `processFormattedText()` ⇒ 两条链路现在共用同一份实现，
//     「开了设置却只有 Ctrl+Alt+L 生效」那种分叉不会再出现。
import type { LspFormatResult } from './bridge.ts'
import { applyTextEdits } from './editorText.ts'
import { errorMessage } from './errors.ts'
import { filterFormatEdits } from './formatterTags.ts'
import { processFormattedText, type PostFormatSettings } from './postFormatProcessors.ts'
import { formattingRestrictionFor } from './formattingRestriction.ts'
import { postFormatSettings } from './codeStyleSettings.ts'
import { commentStyleFor } from './commentToggle.ts'
// `com.intellij.formatOnSaveOptions.defaultsProvider` 的消费端：上游这集合决定「Reformat code」
// 勾选框对某文件类型的**默认档**（`FormatOnSaveOptionsBase.java:29-46`）；本仓项目设置只有一档布尔
// （`ProjectSettings.formatOnSave`），所以等价问法收成「显式设置 || 该文件类型的默认档」。
// 没有贡献者时 `formatsOnSaveByDefault` 恒假 ⇒ 判据逐字等于本模块此前的 `input.formatOnSave`。
import { formatsOnSaveByDefault } from './editorActionExtraExtensionPoints.ts'

export interface ActionsOnSaveInput {
  /** 正在保存的路径（`LspFileEdits.path` 用它挑出本文件那一份编辑）。 */
  path: string
  content: string
  /** `FormatOnSaveOptions.isRunOnSaveEnabled` 的项目设置值（`ProjectSettings.formatOnSave`）。 */
  formatOnSave: boolean
  /** 语言服务就绪：没有处理器可用时整条链直接短路（照上游 `getPsiFile(...) ?: return`）。 */
  lspAvailable: boolean
  /** 注入的格式化调用（单测用假实现；生产是 `lsp.request` 的 `formatting`）。 */
  format: () => Promise<LspFormatResult>
  /** 失败**不阻断保存**，但必须说清（上游把 processor 异常记进日志，本仓用通知）。 */
  notify: (message: string, error?: boolean) => void
  /** 覆盖后处理设置（单测与设置页用）；缺省读 `postFormatSettings`（本仓的本地 `CodeStyleSettings` 档）。 */
  postFormat?: PostFormatSettings
  /** 覆盖「不格式化」清单（单测用）；缺省读 `formatExcludedPatterns`。 */
  excludedPatterns?: readonly string[]
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
  // `formatOnSave` 这一格是**显式设置**；`com.intellij.formatOnSaveOptions.defaultsProvider`
  // 登记过的文件类型说「默认就该格式化」时也走（上游那集合就是勾选框的初值）。
  if (!(input.formatOnSave || formatsOnSaveByDefault(input.path)) || !input.lspAvailable) {
    return { content: input.content, changed: false }
  }
  // ② 准入（`LanguageFormatting.isAutoFormatAllowed`，`:59-61`）：自动重排这一路同样受「不格式化」清单管。
  // **静默跳过**——用户没点任何命令，弹一条"这个文件不格式化"的气球是上游没有的噪音；
  // 同一道闸在 Ctrl+Alt+L 那条（`runFormatting`）是**要**通知的，因为那里是用户主动点的。
  if (formattingRestrictionFor(input.path, { patterns: input.excludedPatterns })) return { content: input.content, changed: false }
  try {
    const formatted = await input.format()
    const file = formatted.edits?.find(entry => entry.path === input.path)
    if (!file?.textEdits.length) return { content: input.content, changed: false }
    // ③ `@formatter:off` 段里的编辑整条丢掉（此前保存时照样落盘，等于标记形同虚设）。
    const edits = filterFormatEdits(input.content, file.textEdits)
    if (!edits.length) return { content: input.content, changed: false }
    // ④ 后处理（空行上限 + 行注释补空格），跑在启用段里；`[]` = 整份文件重排（保存时没有选区）。
    const applied = applyTextEdits(input.content, edits)
    const next = processFormattedText(
      applied, [],
      input.postFormat ?? postFormatSettings.value, commentStyleFor(undefined, input.path),
    ).text
    // 缓冲区必须与落盘内容一致，否则保存成功后编辑器还停在旧文本上（仍显示脏）。
    return { content: next, changed: next !== input.content }
  } catch (error) {
    input.notify(`保存前格式化失败，按原样保存：${errorMessage(error)}`, true)
    return { content: input.content, changed: false }
  }
}
