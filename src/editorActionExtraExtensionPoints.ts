// **编辑器动作（第二批）的扩展点宿主接线** —— 粘贴预处理 / 复制粘贴打字动作 / 注释补全 /
// 词选择过滤 / 自定义粘贴 / 选区去引号过滤 / 保存时格式化默认档，这七条上游本来就是 EP 的接口，
// 按 `src/extensionPoints.ts` 的 `EXTENSIONS` 宿主登记出来，并给出与上游**同名的方法面**
// （于是按上游接口写的第三方插件能原样挂进来、并在本仓被真实消费）。
//
// 与 `src/editorActionExtensionPoints.ts` 同一形状（EP 声明 + 注册/注销 + 消费方从注册表取 +
// bundled 默认贡献者），落点是上一轮 `editact` 没覆盖的那几支：输入/配对/回车/退格已在那里，
// 这里补「剪贴板 + 注释 + 选择 + 保存」四块。
//
// 上游依据（qualifiedName **逐字**取自各处的 `<extensionPoint>` 声明与 `ExtensionPointName.create`；
// 本文件不发明 id）：
//   · `com.intellij.copyPastePreProcessor` —— `platform/lang-impl/resources/intellij.platform.lang.impl.xml:412`
//     （`interface="com.intellij.codeInsight.editorActions.CopyPastePreProcessor"` dynamic="true"）；
//     接口 `platform/lang-impl/src/com/intellij/codeInsight/editorActions/CopyPastePreProcessor.java:16`
//     （`EP_NAME` 在 `:17`）；方法面 `preprocessOnCopy(file, startOffsets, endOffsets, text)`（`:23`，
//     非 null 即替换、且**后面的处理器不再问**）、`preprocessOnPaste(project, file, editor, text, rawText)`
//     （`:29`，不需要处理就原样返回 text）、`isReformatCodeBeforePaste()`（`:33`，缺省 true）、
//     `requiresAllDocumentsToBeCommitted(editor, project)`（`:38`，缺省 true）。
//     消费点（上游）：`PasteHandler.java:239-246` 的循环 —— 逐条把上一条的输出喂给下一条。
//   · `com.intellij.typingActionsExtension` —— 同文件 `:411`（`interface="…TypingActionsExtension"`）；
//     接口 `…/editorActions/TypingActionsExtension.java:16`（`EP_NAME` 在 `:17`）；静态入口
//     `findForContext(project, editor)`（`:19-26`，**第一个** `isSuitableContext` 为真的说了算，
//     没有就 `new DefaultTypingActionsExtension()`）；方法面 `isSuitableContext`（`:31`）/
//     `format(project, editor, howtoReformat, startOffset, endOffset, anchorColumn,
//     indentationBeforeReformat, formatInjected)`（`:41-47`）/`startPaste`（`:54`）/`endPaste`（`:61`）/
//     `startCopy`（`:68`）/`endCopy`（`:75`）。消费点（上游）：`PasteHandler.java:164-170`
//     （`doPaste` 外面包一层 `startPaste` … `finally endPaste`）。
//   · `com.intellij.commentCompleteHandler` —— 同文件 `:414`（`interface="…CommentCompleteHandler"`）；
//     接口 `…/editorActions/CommentCompleteHandler.java:26`（`EP_NAME` 在 `:27`）；方法面
//     `isCommentComplete(comment, commenter, editor)`（`:29`）与 `isApplicable(comment, commenter)`（`:31`）。
//     消费点（上游）：`EnterHandler.java:200-204` —— **第一个** `isApplicable` 为真的处理器说了算；
//     一个都不适用才落到「注释文本要以 suffix 收尾」那条词法兜底（`:206-210`）。
//     **如实差异**：协调单里写的 `getCommentStartOffset` 在 `CommentCompleteHandler` 上**不存在** ——
//     它是 `CodeDocumentationAwareCommenter.getCommentStartOffset`（本仓的同名量由调用方算好后
//     作为 `commentStart` 传进来，见 `CommentCompleteInput`），所以方法面按真实的两个问法落。
//   · `com.intellij.basicWordSelectionFilter` —— `platform/core-api/resources/intellij.platform.core.xml:78`
//     （`interface="com.intellij.openapi.util.Condition"` dynamic="true"）；使用方
//     `platform/lang-impl/src/com/intellij/codeInsight/editorActions/wordSelection/WordSelectioner.java:15`
//     （`EP_NAME` 在 `:16`）；判据在 `canSelect(PsiElement)`（`:19-29`）—— 注释元素直接 false，
//     然后**每一个**注册的 `Condition<PsiElement>` 都 `value(e)` 为真才放行（任一 false 即 false）。
//   · `com.intellij.customPasteProvider` —— `platform/platform-api/resources/intellij.platform.ide.xml:157`
//     （`interface="com.intellij.ide.PasteProvider"` dynamic="true"）；接口
//     `platform/platform-api/src/com/intellij/ide/PasteProvider.java:33`；方法面 `performPaste`（`:34`）/
//     `isPastePossible`（`:40`）/`isPasteEnabled`（`:41`）。消费点（上游）：`PasteHandler.java:113-117`
//     —— 逐条问 `isPasteEnabled`，**第一条为真**的执行 `performPaste` 并 `return`（默认粘贴不跑）。
//   · `com.intellij.selectionUnquotingFilter` —— `platform/lang-impl/resources/intellij.platform.lang.impl.xml:398`
//     （`interface="com.intellij.codeInsight.editorActions.SelectionQuotingTypedHandler$UnquotingFilter"`）；
//     接口体 `…/editorActions/SelectionQuotingTypedHandler.java:249-255` 的 `UnquotingFilter`
//     （`EP_NAME` 在同文件 `:29` 的私有字段）；方法面 `skipReplacementQuotesOrBraces(file, editor,
//     selectedText, char c)`（`:250-254`）—— true = 这一键**不要**替换引号 / 不要包住选区。
//   · `com.intellij.formatOnSaveOptions.defaultsProvider` —— 同 lang-impl 文件 `:479`
//     （`interface="com.intellij.codeInsight.actions.onSave.FormatOnSaveOptionsBase$DefaultsProvider"`）；
//     接口体 `…/onSave/FormatOnSaveOptionsBase.java:29-38`（`EP_NAME` 在 `:21-22`）；方法面
//     `getFileTypesFormattedOnSaveByDefault()`（`:30`）与
//     `getFileTypesWithOptimizeImportsOnSaveByDefault()`（`:34`），两者缺省都返回空集合。
//
// 本仓此前：七支各有私有实现或干脆没有 —— 粘贴通道在 `src/editorPaste.ts`、引号/选区在
// `src/editorTyping.ts`、块注释回车在 `src/editorEnterBlockComment.ts`、词选择在
// `src/editorExtendSelection.ts`、保存时格式化在 `src/actionsOnSave.ts` —— 但**没有一条能被第三方
// 按 id 挂进去**（判词 lp/editor-actions 那几条「缺 EP 宿主」）。本文件补上那一层。
//
// 与上游的如实差异：① 本仓没有 `Document`/`Editor`/`PsiElement` 载具，位置与文本一律收成
// `EditorTextInput`（路径 + 语言 + 文本 + 行列 + 选区）；② `RawText` 收成可选的 `raw`（原样的
// 剪贴板文本）；③ `Condition<PsiElement>` 收成 `value(input)` 谓词，`PsiElement` 换成
// 「词在文本里的区间 + 词本身」；④ `format` 的七个参数收成一个 `TypingActionsFormatInput`
// （`howtoReformat` 用 `src/pasteOptions.ts` 的四档字符串而不是上游的魔数）。
//
// 纯数据层：只 import `src/extensionPoints.ts`（不 import vue/DOM/bridge），便于 `node --test` 直测。
//
// 判据：`tests/editor-action-extra-extension-points.test.mjs`。

import { APPLICATION_SCOPE, EXTENSIONS, type ExtensionHandle, type RegisterExtensionOptions } from './extensionPoints.ts'

/** 七条 EP 的 id（逐字取自上游 qualifiedName，见文件头逐条出处）。 */
export const COPY_PASTE_PRE_PROCESSOR_EP = 'com.intellij.copyPastePreProcessor'
export const TYPING_ACTIONS_EXTENSION_EP = 'com.intellij.typingActionsExtension'
export const COMMENT_COMPLETE_HANDLER_EP = 'com.intellij.commentCompleteHandler'
export const BASIC_WORD_SELECTION_FILTER_EP = 'com.intellij.basicWordSelectionFilter'
export const CUSTOM_PASTE_PROVIDER_EP = 'com.intellij.customPasteProvider'
export const SELECTION_UNQUOTING_FILTER_EP = 'com.intellij.selectionUnquotingFilter'
export const FORMAT_ON_SAVE_DEFAULTS_PROVIDER_EP = 'com.intellij.formatOnSaveOptions.defaultsProvider'

/** 一次编辑器动作的上下文（上游 `Project` + `Editor` + `PsiFile` 的可移植替代）。 */
export interface EditorTextInput {
  /** 工作区相对路径（本仓没有 `PsiFile`，路径就是文件身份）。 */
  path: string
  /** 编辑器语言 id（本仓的四档 `java`/`cpp`/`typescript`/`other`）。 */
  language: string
  /** 文件类型名（上游 `FileType`；缺省由语言折出，见 `fileTypeOfPath`）。 */
  fileType?: string
  /** 文档全文。 */
  text: string
  /** 0 基行号。 */
  line: number
  /** 行内 0 基偏移。 */
  character: number
  /** 选区文本（没有选区时是空串）—— 上游的 `selectionModel.getSelectedText()`。 */
  selectedText?: string
  /** 本次输入的那个字符（引号 / 分隔符）。 */
  typed?: string
}

/** 路径 → 上游口径的文件类型名（本仓没有 `FileType` 表，按扩展名大写折；认不出给空串 = 通吃）。 */
export function fileTypeOfPath(path: string): string {
  const dot = path.lastIndexOf('.')
  const slash = Math.max(path.lastIndexOf('/'), path.lastIndexOf('\\'))
  if (dot <= slash + 1) return ''
  return path.slice(dot + 1).toUpperCase()
}

/**
 * 语言过滤：贡献没写 `languages`（或空表）= 通吃；**调用方说不上语言时也不过滤**
 * （`''` / `'other'` —— 宿主在几处注入点拿不到当前语言，例如粘贴通道的
 * `src/editorPaste.ts`，那一行的宿主在禁改的 `src/components/CodeEditor.vue` 里）。
 * 这七条 EP 上游本来就**不是按语言注册**的（plugin.xml 里都是
 * `interface="…" dynamic="true"`，没有 `LanguageExtensionPoint` 的 language 属性），
 * `languages` 是本仓给贡献者的一个可选收窄手段，故「未知就不收窄」不改变上游语义。
 */
function acceptsLanguage(contribution: { languages?: readonly string[] }, language: string): boolean {
  const list = contribution.languages
  if (!list || list.length === 0) return true
  if (!language || language === 'other') return true
  return list.includes(language)
}

// ── ① 复制粘贴预处理器：`CopyPastePreProcessor`（`com.intellij.copyPastePreProcessor`） ────────

/** 复制/粘贴时喂给预处理器的输入（上游 `(file, startOffsets, endOffsets, text)` 的可移植形状）。 */
export interface CopyPasteTextInput extends EditorTextInput {
  /** 复制侧：各光标起点偏移（上游 `int[] startOffsets`）；粘贴侧没有。 */
  startOffsets?: readonly number[]
  /** 复制侧：各光标终点偏移（上游 `int[] endOffsets`）；粘贴侧没有。 */
  endOffsets?: readonly number[]
  /** 粘贴侧：原样的剪贴板文本（上游 `RawText`）。 */
  raw?: string
  /** 这个方向是复制还是粘贴（一条贡献两边方法都有，靠它分流）。 */
  direction: 'copy' | 'paste'
}

/** 一条复制粘贴预处理器（`CopyPastePreProcessor` 的方法面，名字与上游逐字相同）。 */
export interface CopyPastePreProcessorContribution {
  id: string
  languages?: readonly string[]
  /** `preprocessOnCopy(file, startOffsets, endOffsets, text)` —— 非 null 即替换，且不再问后面的。 */
  preprocessOnCopy?: (input: CopyPasteTextInput) => string | null
  /** `preprocessOnPaste(project, file, editor, text, rawText)` —— 必须返回文本（不处理就原样返回）。 */
  preprocessOnPaste?: (input: CopyPasteTextInput) => string
  /** `isReformatCodeBeforePaste()`（缺省 true）。 */
  isReformatCodeBeforePaste?: (input: CopyPasteTextInput) => boolean
  /** `requiresAllDocumentsToBeCommitted(editor, project)`（缺省 true）。 */
  requiresAllDocumentsToBeCommitted?: (input: CopyPasteTextInput) => boolean
}

/** `CopyPastePreProcessor.EP_NAME.getExtensionList()` 的等价物（按语言过滤）。 */
export function copyPastePreProcessors(language: string, scope: string = APPLICATION_SCOPE): CopyPastePreProcessorContribution[] {
  return EXTENSIONS.extensionsOf<CopyPastePreProcessorContribution>(COPY_PASTE_PRE_PROCESSOR_EP, scope)
    .filter(contribution => acceptsLanguage(contribution, language))
}

/** 一次粘贴预处理的结果（上游 `PasteHandler.java:239-247` 的两个累积量）。 */
export interface PastePreprocessResult {
  /** 最终要插进文档的文本。 */
  text: string
  /** 有没有哪一条改过文本（上游 `pastedTextWasChanged`）。 */
  changed: boolean
  /** 改过文本的那些贡献里，有没有要求「粘贴前重新格式化」。 */
  reformatBeforePaste: boolean
  /** 实际改过文本的贡献 id（诊断/判据用）。 */
  applied: string[]
}

/**
 * `PasteHandler.java:239-246` 那个循环的等价物：逐条问 `preprocessOnPaste`，
 * 上一条的输出喂给下一条；坏贡献跳过（不能因为第三方抛错就吃掉这次粘贴）。
 * 没有贡献时 `text` 原样返回（**不因为有 EP 就改变既有行为**）。
 */
export function preprocessPastedText(
  input: Omit<CopyPasteTextInput, 'direction'>, scope: string = APPLICATION_SCOPE,
): PastePreprocessResult {
  let text = input.text
  let changed = false
  let reformat = false
  const applied: string[] = []
  for (const processor of copyPastePreProcessors(input.language, scope)) {
    if (typeof processor.preprocessOnPaste !== 'function') continue
    let next: string
    try {
      next = processor.preprocessOnPaste({ ...input, text, direction: 'paste' })
    } catch {
      continue
    }
    if (typeof next !== 'string' || next === text) continue
    applied.push(processor.id)
    if (processor.isReformatCodeBeforePaste ? processor.isReformatCodeBeforePaste({ ...input, text, direction: 'paste' }) : true) {
      reformat = true
    }
    changed = true
    text = next
  }
  return { text, changed, reformatBeforePaste: reformat, applied }
}

/**
 * `preprocessOnCopy`：**第一个**返回非 null 的说了算（上游 `EditorCopyPasteHelperImpl` 的复制路径
 * 注释写明 "No other preprocessor will be invoked at copy time after this"）。
 * 没有贡献接管时返回原文本。
 */
export function preprocessCopiedText(
  input: Omit<CopyPasteTextInput, 'direction'>, scope: string = APPLICATION_SCOPE,
): { text: string; handledBy: string | null } {
  for (const processor of copyPastePreProcessors(input.language, scope)) {
    if (typeof processor.preprocessOnCopy !== 'function') continue
    let next: string | null = null
    try {
      next = processor.preprocessOnCopy({ ...input, direction: 'copy' })
    } catch {
      continue
    }
    if (typeof next === 'string' && next !== input.text) return { text: next, handledBy: processor.id }
  }
  return { text: input.text, handledBy: null }
}

/** 这一次粘贴要不要在插入后重新格式化（任一改过文本的贡献要求即是）。 */
export function reformatBeforePaste(input: Omit<CopyPasteTextInput, 'direction'>, scope: string = APPLICATION_SCOPE): boolean {
  return preprocessPastedText(input, scope).reformatBeforePaste
}

// ── ② 打字动作：`TypingActionsExtension`（`com.intellij.typingActionsExtension`） ─────────────

/** 一次打字动作的上下文（上游 `(Project, Editor)` 的可移植替代）。 */
export interface TypingActionsContext extends EditorTextInput {}

/** `format(...)` 的七个入参（上游魔数收成 `src/pasteOptions.ts` 的四档字符串，见文件头差异④）。 */
export interface TypingActionsFormatInput extends TypingActionsContext {
  /** `NO_REFORMAT` / `INDENT_BLOCK` / `INDENT_EACH_LINE` / `REFORMAT_BLOCK` 四档。 */
  howtoReformat: string
  /** 片段起点偏移（`startOffset`）。 */
  startOffset: number
  /** 片段终点偏移（`endOffset`）。 */
  endOffset: number
  /** 首行缩进量（`anchorColumn`，只有 `INDENT_BLOCK` 非零）。 */
  anchorColumn: number
  /** `REFORMAT_BLOCK` 时先缩进整块（`indentationBeforeReformat`）。 */
  indentationBeforeReformat: boolean
  /** 片段是否在注入的编辑器里（`formatInjected`）。 */
  formatInjected: boolean
}

/** 一条打字动作扩展（`TypingActionsExtension` 的方法面，名字与上游逐字相同）。 */
export interface TypingActionsExtensionContribution {
  id: string
  languages?: readonly string[]
  /** `isSuitableContext(project, editor)` —— 这一条接不接这次上下文。 */
  isSuitableContext: (input: TypingActionsContext) => boolean
  /** `format(...)`（缺省什么都不做 = 上游空实现）。 */
  format?: (input: TypingActionsFormatInput) => void
  /** `startPaste(project, editor)`。 */
  startPaste?: (input: TypingActionsContext) => void
  /** `endPaste(project, editor)`。 */
  endPaste?: (input: TypingActionsContext) => void
  /** `startCopy(project, editor)`。 */
  startCopy?: (input: TypingActionsContext) => void
  /** `endCopy(project, editor)`。 */
  endCopy?: (input: TypingActionsContext) => void
}

/** 一次打字动作的四个时相（上游四个方法名逐字）。 */
export type TypingActionsPhase = 'startPaste' | 'endPaste' | 'startCopy' | 'endCopy'

/** `TypingActionsExtension.EP_NAME.getExtensionList()` 的等价物（按语言过滤）。 */
export function typingActionsExtensions(language: string, scope: string = APPLICATION_SCOPE): TypingActionsExtensionContribution[] {
  return EXTENSIONS.extensionsOf<TypingActionsExtensionContribution>(TYPING_ACTIONS_EXTENSION_EP, scope)
    .filter(contribution => acceptsLanguage(contribution, language))
}

/**
 * `TypingActionsExtension.findForContext(project, editor)` 的等价物：**第一个**
 * `isSuitableContext` 为真的说了算；一个都没有返回 null（调用方照上游 `:22-25` 的
 * `new DefaultTypingActionsExtension()` 走本仓的默认路径 —— 那支不需要对象，
 * 所以这里用 null 表示「落到默认」）。
 */
export function suitableTypingActionsExtension(
  input: TypingActionsContext, scope: string = APPLICATION_SCOPE,
): TypingActionsExtensionContribution | null {
  for (const extension of typingActionsExtensions(input.language, scope)) {
    let suitable = false
    try {
      suitable = extension.isSuitableContext(input) === true
    } catch {
      continue
    }
    if (suitable) return extension
  }
  return null
}

/**
 * 问一次时相（`startPaste` / `endPaste` / `startCopy` / `endCopy`）。
 * 只问 `findForContext` 选中的那一条（与上游 `doPaste` 里 `typingActionsExtension.xxx(...)`
 * 只调一个对象的形态一致）；没选中或没实现该时相返回 false。
 */
export function notifyTypingActions(
  phase: TypingActionsPhase, input: TypingActionsContext, scope: string = APPLICATION_SCOPE,
): boolean {
  const extension = suitableTypingActionsExtension(input, scope)
  if (!extension) return false
  const handler = extension[phase]
  if (typeof handler !== 'function') return false
  try {
    handler(input)
    return true
  } catch {
    return false
  }
}

/** `format(...)` 的分发（上游 `PasteHandler.java:288-302` 调的那一次）。返回有没有人接手。 */
export function dispatchTypingActionsFormat(
  input: TypingActionsFormatInput, scope: string = APPLICATION_SCOPE,
): boolean {
  const extension = suitableTypingActionsExtension(input, scope)
  if (!extension || typeof extension.format !== 'function') return false
  try {
    extension.format(input)
    return true
  } catch {
    return false
  }
}

/** `requiresAllDocumentsToBeCommitted` 的结果（含说「要」的那条贡献，便于诊断）。 */
export interface AllDocumentsCommittedVerdict {
  required: boolean
  by: string[]
}

/**
 * `CopyPastePreProcessor.requiresAllDocumentsToBeCommitted(editor, project)` 的合并版
 * （上游 `:36-40` 的注释：实现方可以在不碰别的文档时返回 false 做性能优化）。
 * 缺省 true —— 只要没有贡献明确说「不用」，调用方就该照上游的保守口径把文档 commit 掉。
 */
export function requiresAllDocumentsCommitted(
  input: Omit<CopyPasteTextInput, 'direction'>, scope: string = APPLICATION_SCOPE,
): AllDocumentsCommittedVerdict {
  const by: string[] = []
  let required = true
  for (const processor of copyPastePreProcessors(input.language, scope)) {
    if (typeof processor.requiresAllDocumentsToBeCommitted !== 'function') continue
    let value = true
    try {
      value = processor.requiresAllDocumentsToBeCommitted({ ...input, direction: 'paste' }) === true
    } catch {
      continue
    }
    if (!value) by.push(processor.id)
    required = required && value
  }
  return { required, by }
}

// ── ③ 注释补全：`CommentCompleteHandler`（`com.intellij.commentCompleteHandler`） ─────────────

/**
 * 问「这条注释写完了吗」的输入（上游 `(PsiComment, CodeDocumentationAwareCommenter, Editor)`）。
 * `commentStart` 是 `CodeDocumentationAwareCommenter.getCommentStartOffset` 的等价物 ——
 * 由调用方（本仓是 `src/editorEnterBlockComment.ts` 的词法扫描）算好传进来。
 */
export interface CommentCompleteInput extends EditorTextInput {
  /** 注释起点偏移（上游 `getCommentStartOffset()`）。 */
  commentStart: number
  /** 注释前缀（`getLineCommentPrefix()` / `getBlockCommentPrefix()`）。 */
  commentPrefix?: string
  /** 收尾标记（`getBlockCommentSuffix()` / `getDocumentationCommentSuffix()`；行注释没有）。 */
  commentSuffix?: string
}

/** 一条注释补全处理器（`CommentCompleteHandler` 的方法面，名字与上游逐字相同）。 */
export interface CommentCompleteHandlerContribution {
  id: string
  languages?: readonly string[]
  /** `isApplicable(comment, commenter)`（缺省 = 适用）。 */
  isApplicable?: (input: CommentCompleteInput) => boolean
  /** `isCommentComplete(comment, commenter, editor)`。 */
  isCommentComplete: (input: CommentCompleteInput) => boolean
}

/** `CommentCompleteHandler.EP_NAME.getExtensionList()` 的等价物（按语言过滤）。 */
export function commentCompleteHandlers(language: string, scope: string = APPLICATION_SCOPE): CommentCompleteHandlerContribution[] {
  return EXTENSIONS.extensionsOf<CommentCompleteHandlerContribution>(COMMENT_COMPLETE_HANDLER_EP, scope)
    .filter(contribution => acceptsLanguage(contribution, language))
}

/**
 * `EnterHandler.isCommentComplete(comment, commenter, editor)`（`:200-204`）的等价物：
 * **第一个** `isApplicable` 为真的处理器说了算；一个都不适用返回 null
 * （= 上游继续走 `:206-210` 那条「注释文本要以 suffix 收尾」的词法兜底）。
 */
export function commentCompleteVerdict(
  input: CommentCompleteInput, scope: string = APPLICATION_SCOPE,
): { handler: CommentCompleteHandlerContribution; complete: boolean } | null {
  for (const handler of commentCompleteHandlers(input.language, scope)) {
    let applicable = true
    try {
      applicable = handler.isApplicable ? handler.isApplicable(input) === true : true
    } catch {
      continue
    }
    if (!applicable) continue
    try {
      return { handler, complete: handler.isCommentComplete(input) === true }
    } catch {
      continue
    }
  }
  return null
}

// ── ④ 词选择过滤：`Condition<PsiElement>`（`com.intellij.basicWordSelectionFilter`） ──────────

/** 一个词在文本里的位置（上游 `PsiElement` 的可移植替代）。 */
export interface WordSelectionInput extends EditorTextInput {
  /** 词的区间 [from, to)。 */
  from: number
  to: number
  /** 词文本本身。 */
  word: string
  /** 这个词所在的词法种类（本仓的词法扫描结果：`word` / `comment` / `string` / `other`）。 */
  lexicalKind: string
}

/** 一条词选择过滤（`Condition<PsiElement>.value(element)` 的同名方法面）。 */
export interface WordSelectionFilterContribution {
  id: string
  languages?: readonly string[]
  /** `condition.value(element)` —— false = 这个词不能被选中。 */
  value: (input: WordSelectionInput) => boolean
}

/** `WordSelectioner.EP_NAME.getExtensionList()` 的等价物（按语言过滤）。 */
export function wordSelectionFilters(language: string, scope: string = APPLICATION_SCOPE): WordSelectionFilterContribution[] {
  return EXTENSIONS.extensionsOf<WordSelectionFilterContribution>(BASIC_WORD_SELECTION_FILTER_EP, scope)
    .filter(contribution => acceptsLanguage(contribution, language))
}

/**
 * `WordSelectioner.canSelect(PsiElement)`（`WordSelectioner.java:19-29`）的等价物：
 * **每一个**过滤都要 `value` 为真（任一 false 即 false）。没有过滤时返回 true
 * （本仓的既有行为：`src/editorExtendSelection.ts` 的 `wordRange` 不认元素种类 ——
 * 不因为有 EP 就改变它）。
 */
export function canSelectWord(input: WordSelectionInput, scope: string = APPLICATION_SCOPE): boolean {
  for (const filter of wordSelectionFilters(input.language, scope)) {
    try {
      if (filter.value(input) !== true) return false
    } catch {
      // 坏过滤跳过（上游没有 try，但一个第三方过滤抛错不该让词选择整个瘫掉）。
      continue
    }
  }
  return true
}

// ── ⑤ 自定义粘贴：`PasteProvider`（`com.intellij.customPasteProvider`） ─────────────────────

/**
 * 问自定义粘贴的输入（上游 `DataContext` 的可移植替代）。
 * `performPaste` 的副作用回调用宿主注入的回调表达（本仓没有 `Transferable` 直接写文档的通道）。
 */
export interface PasteProviderInput extends EditorTextInput {
  /** 剪贴板里的文本（上游从 `DataContext` 的 `TRANSFERABLE_PROVIDER` 取）。 */
  clipboardText: string
  /** 宿主副作用：把 `text` 插到光标处（自定义粘贴自己决定插什么）。 */
  insertText?: (text: string) => void
}

/** 一条自定义粘贴提供方（`PasteProvider` 的方法面，名字与上游逐字相同）。 */
export interface CustomPasteProviderContribution {
  id: string
  languages?: readonly string[]
  /** `performPaste(dataContext)`。 */
  performPaste: (input: PasteProviderInput) => void
  /** `isPastePossible(dataContext)`（缺省 = 可能）。 */
  isPastePossible?: (input: PasteProviderInput) => boolean
  /** `isPasteEnabled(dataContext)` —— 为真即由它接管默认粘贴。 */
  isPasteEnabled: (input: PasteProviderInput) => boolean
}

/** `PasteHandler.EP_NAME.getExtensionList()` 的等价物（按语言过滤）。 */
export function customPasteProviders(language: string, scope: string = APPLICATION_SCOPE): CustomPasteProviderContribution[] {
  return EXTENSIONS.extensionsOf<CustomPasteProviderContribution>(CUSTOM_PASTE_PROVIDER_EP, scope)
    .filter(contribution => acceptsLanguage(contribution, language))
}

/**
 * `PasteHandler.java:113-117` 那个循环的等价物：逐条问 `isPasteEnabled`，
 * **第一条为真**的返回；一条都不接管返回 null（调用方走默认粘贴）。
 */
export function customPasteProviderFor(
  input: PasteProviderInput, scope: string = APPLICATION_SCOPE,
): CustomPasteProviderContribution | null {
  for (const provider of customPasteProviders(input.language, scope)) {
    try {
      if (provider.isPasteEnabled(input) === true) return provider
    } catch {
      continue
    }
  }
  return null
}

/** 执行某条自定义粘贴（`performPaste`；抛错返回 false 让调用方回落到默认粘贴）。 */
export function performCustomPaste(
  provider: CustomPasteProviderContribution, input: PasteProviderInput,
): boolean {
  try {
    provider.performPaste(input)
    return true
  } catch {
    return false
  }
}

// ── ⑥ 选区去引号过滤：`UnquotingFilter`（`com.intellij.selectionUnquotingFilter`） ───────────

/** 问「这一键要不要跳过替换/包住」的输入（上游 `(PsiFile, Editor, String selectedText, char c)`）。 */
export interface SelectionUnquotingInput extends EditorTextInput {
  /** 选区文本（上游 `selectedText`）。 */
  selectedText: string
  /** 敲进去的那个字符 c。 */
  typed: string
}

/** 一条去引号过滤（`UnquotingFilter` 的方法面，名字与上游逐字相同）。 */
export interface SelectionUnquotingFilterContribution {
  id: string
  languages?: readonly string[]
  /** `skipReplacementQuotesOrBraces(file, editor, selectedText, c)` —— true = 不要替换/包住。 */
  skipReplacementQuotesOrBraces: (input: SelectionUnquotingInput) => boolean
}

/** `SelectionQuotingTypedHandler.EP_NAME.getExtensionList()` 的等价物（按语言过滤）。 */
export function selectionUnquotingFilters(language: string, scope: string = APPLICATION_SCOPE): SelectionUnquotingFilterContribution[] {
  return EXTENSIONS.extensionsOf<SelectionUnquotingFilterContribution>(SELECTION_UNQUOTING_FILTER_EP, scope)
    .filter(contribution => acceptsLanguage(contribution, language))
}

/** `shouldSkipReplacementOfQuotesOrBraces`（`:152-157` 那个合并版）：**任一**为真即真。 */
export function shouldSkipQuoteReplacement(
  input: SelectionUnquotingInput, scope: string = APPLICATION_SCOPE,
): boolean {
  for (const filter of selectionUnquotingFilters(input.language, scope)) {
    try {
      if (filter.skipReplacementQuotesOrBraces(input) === true) return true
    } catch {
      continue
    }
  }
  return false
}

// ── ⑦ 保存时格式化默认档：`DefaultsProvider`（`com.intellij.formatOnSaveOptions.defaultsProvider`） ─

/** 一条默认档提供方（`DefaultsProvider` 的方法面，名字与上游逐字相同）。 */
export interface FormatOnSaveDefaultsProviderContribution {
  id: string
  /** `getFileTypesFormattedOnSaveByDefault()`。 */
  getFileTypesFormattedOnSaveByDefault: () => readonly string[]
  /** `getFileTypesWithOptimizeImportsOnSaveByDefault()`。 */
  getFileTypesWithOptimizeImportsOnSaveByDefault: () => readonly string[]
}

/** `FormatOnSaveOptionsBase.EP_NAME.getExtensionList()` 的等价物。 */
export function formatOnSaveDefaultsProviders(scope: string = APPLICATION_SCOPE): FormatOnSaveDefaultsProviderContribution[] {
  return EXTENSIONS.extensionsOf<FormatOnSaveDefaultsProviderContribution>(FORMAT_ON_SAVE_DEFAULTS_PROVIDER_EP, scope)
}

/**
 * 全部「默认勾选『保存时重新格式化』」的文件类型（各贡献的并集，大小写不敏感已归一成大写）。
 * 上游 `FormatOnSaveOptionsBase.StateBase` 的构造里就是拿这个集合去初始化勾选状态（`:39-46`）。
 */
export function formatOnSaveDefaultFileTypes(scope: string = APPLICATION_SCOPE): string[] {
  const out = new Set<string>()
  for (const provider of formatOnSaveDefaultsProviders(scope)) {
    try {
      for (const type of provider.getFileTypesFormattedOnSaveByDefault()) if (type) out.add(type.toUpperCase())
    } catch { /* 坏贡献跳过。 */ }
  }
  return [...out]
}

/** 全部「默认勾选『保存时优化 import』」的文件类型（上游第二个问法）。 */
export function optimizeImportsOnSaveDefaultFileTypes(scope: string = APPLICATION_SCOPE): string[] {
  const out = new Set<string>()
  for (const provider of formatOnSaveDefaultsProviders(scope)) {
    try {
      for (const type of provider.getFileTypesWithOptimizeImportsOnSaveByDefault()) if (type) out.add(type.toUpperCase())
    } catch { /* 坏贡献跳过。 */ }
  }
  return [...out]
}

/**
 * 这个路径的文件类型是不是「默认就该在保存时重新格式化」。
 * 消费点是 `src/actionsOnSave.ts` 的 `runActionsOnSave`：上游这集合决定的是**勾选框的初值**，
 * 本仓项目设置只有一档布尔（`ProjectSettings.formatOnSave`），所以等价问法收成
 * 「显式设置 || 该文件类型的默认档」—— 没有贡献时逐字等于原判据。
 */
export function formatsOnSaveByDefault(path: string, scope: string = APPLICATION_SCOPE): boolean {
  const type = fileTypeOfPath(path)
  if (!type) return false
  return formatOnSaveDefaultFileTypes(scope).includes(type)
}

// ── EP 声明 / 注册 / 注销 ─────────────────────────────────────────────────────────────────

/** 七条 EP 的声明（幂等：重复调用只覆盖同名声明）。 */
export function declareEditorActionExtraExtensionPoints(): void {
  for (const [id, name] of [
    [COPY_PASTE_PRE_PROCESSOR_EP, '复制粘贴预处理器'],
    [TYPING_ACTIONS_EXTENSION_EP, '打字动作扩展'],
    [COMMENT_COMPLETE_HANDLER_EP, '注释补全处理器'],
    [BASIC_WORD_SELECTION_FILTER_EP, '词选择过滤'],
    [CUSTOM_PASTE_PROVIDER_EP, '自定义粘贴提供方'],
    [SELECTION_UNQUOTING_FILTER_EP, '选区去引号过滤'],
    [FORMAT_ON_SAVE_DEFAULTS_PROVIDER_EP, '保存时格式化默认档'],
  ] as const) {
    EXTENSIONS.declareExtensionPoint({ id, name, scope: APPLICATION_SCOPE, dynamic: true })
  }
}

declareEditorActionExtraExtensionPoints()

/** 按 id 注册一条贡献（同 id 覆盖，与宿主同口径）。 */
export function registerEditorActionExtraExtension<T>(
  extensionPoint: string, id: string, value: T, options: RegisterExtensionOptions = {},
): ExtensionHandle {
  return EXTENSIONS.registerExtension(extensionPoint, id, value, options)
}

/** 注销一条贡献（返回是否真的删掉了）。 */
export function unregisterEditorActionExtraExtension(extensionPoint: string, id: string): boolean {
  return EXTENSIONS.unregisterExtension(extensionPoint, id)
}

// ── bundled：本仓在跑的几支作为默认贡献登记（消费侧调用，重复调用只覆盖同 id）──────────────

/** 内建：复制粘贴预处理器（passthrough —— 逐字返回输入文本，不改变既有粘贴行为）。 */
export const BUNDLED_COPY_PASTE_PRE_PROCESSOR_ID = 'taocode.copyPastePreProcessor.bundled'
/** 内建：打字动作扩展（缺省上下文，见 `builtinTypingActionsExtension`）。 */
export const BUNDLED_TYPING_ACTIONS_EXTENSION_ID = 'taocode.typingActionsExtension.bundled'
/** 内建：注释补全处理器（passthrough —— 不接管，交给词法兜底）。 */
export const BUNDLED_COMMENT_COMPLETE_HANDLER_ID = 'taocode.commentCompleteHandler.bundled'
/** 内建：词选择过滤（passthrough —— 恒放行）。 */
export const BUNDLED_WORD_SELECTION_FILTER_ID = 'taocode.basicWordSelectionFilter.bundled'
/** 内建：自定义粘贴提供方（passthrough —— 从不接管）。 */
export const BUNDLED_CUSTOM_PASTE_PROVIDER_ID = 'taocode.customPasteProvider.bundled'
/** 内建：选区去引号过滤（passthrough —— 从不跳过）。 */
export const BUNDLED_SELECTION_UNQUOTING_FILTER_ID = 'taocode.selectionUnquotingFilter.bundled'
/** 内建：保存时格式化默认档（空表 —— 上游平台这一支本来就没有内建提供方）。 */
export const BUNDLED_FORMAT_ON_SAVE_DEFAULTS_ID = 'taocode.formatOnSaveOptions.defaultsProvider.bundled'

/** 内建：复制粘贴预处理器 —— 本仓的粘贴整形在 `src/editorPaste.ts` / `src/pasteOptions.ts`，
 *  这里给 passthrough 贡献，保证 EP 里有一条 bundled 项、第三方能排在它前面或后面。 */
export function builtinCopyPastePreProcessor(): CopyPastePreProcessorContribution {
  return {
    id: BUNDLED_COPY_PASTE_PRE_PROCESSOR_ID,
    preprocessOnCopy: () => null,
    preprocessOnPaste: input => input.text,
    isReformatCodeBeforePaste: () => true,
    requiresAllDocumentsToBeCommitted: () => true,
  }
}

/**
 * 内建：打字动作扩展 —— 本仓的粘贴/复制整形在 `src/pasteOptions.ts` 与宿主的
 * `rangeFormatting` 请求里（上游 `DefaultTypingActionsExtension` 的等价物散在各消费点），
 * 这里给一个「任何上下文都适用、四个时相都不做事」的缺省项。
 * **排序**：它按 `priority: -1` 注册，`ExtensionPointHost` 的排序是同档 priority 降序
 * ⇒ 第三方（默认 priority 0）排在它**前面**，于是 `suitableTypingActionsExtension` 那
 * 「第一个适用者说了算」的语义与上游 `findForContext` 一致，这条只在没人接管时兜底。
 */
export function builtinTypingActionsExtension(): TypingActionsExtensionContribution {
  return {
    id: BUNDLED_TYPING_ACTIONS_EXTENSION_ID,
    isSuitableContext: () => true,
  }
}

/** 内建：注释补全处理器 —— 不适用（`isApplicable: () => false`），于是词法兜底照旧
 *  （上游 `EnterHandler.java:206-210` 那一段；本仓在 `src/editorEnterBlockComment.ts`）。 */
export function builtinCommentCompleteHandler(): CommentCompleteHandlerContribution {
  return {
    id: BUNDLED_COMMENT_COMPLETE_HANDLER_ID,
    isApplicable: () => false,
    isCommentComplete: () => false,
  }
}

/** 内建：词选择过滤 —— 恒放行（上游平台这一支没有内建 filter，空表的行为就是「全过」）。 */
export function builtinWordSelectionFilter(): WordSelectionFilterContribution {
  return { id: BUNDLED_WORD_SELECTION_FILTER_ID, value: () => true }
}

/** 内建：自定义粘贴提供方 —— 从不接管（`isPasteEnabled` 恒假，默认粘贴照旧）。 */
export function builtinCustomPasteProvider(): CustomPasteProviderContribution {
  return {
    id: BUNDLED_CUSTOM_PASTE_PROVIDER_ID,
    isPasteEnabled: () => false,
    isPastePossible: () => false,
    performPaste: () => {},
  }
}

/** 内建：选区去引号过滤 —— 从不跳过（引号替换/包住选区的既有行为逐字不变）。 */
export function builtinSelectionUnquotingFilter(): SelectionUnquotingFilterContribution {
  return { id: BUNDLED_SELECTION_UNQUOTING_FILTER_ID, skipReplacementQuotesOrBraces: () => false }
}

/** 内建：保存时格式化默认档 —— 两个问法都给空表（没有贡献时判据逐字等于原样）。 */
export function builtinFormatOnSaveDefaultsProvider(): FormatOnSaveDefaultsProviderContribution {
  return {
    id: BUNDLED_FORMAT_ON_SAVE_DEFAULTS_ID,
    getFileTypesFormattedOnSaveByDefault: () => [],
    getFileTypesWithOptimizeImportsOnSaveByDefault: () => [],
  }
}

/** 注册一条复制粘贴预处理器（缺省 bundled）。 */
export function registerCopyPastePreProcessor(
  contribution: CopyPastePreProcessorContribution, options: RegisterExtensionOptions = {},
): ExtensionHandle {
  return registerEditorActionExtraExtension(COPY_PASTE_PRE_PROCESSOR_EP, contribution.id, contribution, { source: 'bundled', ...options })
}

/** 注册一条打字动作扩展（缺省 bundled）。 */
export function registerTypingActionsExtension(
  contribution: TypingActionsExtensionContribution, options: RegisterExtensionOptions = {},
): ExtensionHandle {
  return registerEditorActionExtraExtension(TYPING_ACTIONS_EXTENSION_EP, contribution.id, contribution, { source: 'bundled', ...options })
}

/** 注册一条注释补全处理器（缺省 bundled）。 */
export function registerCommentCompleteHandler(
  contribution: CommentCompleteHandlerContribution, options: RegisterExtensionOptions = {},
): ExtensionHandle {
  return registerEditorActionExtraExtension(COMMENT_COMPLETE_HANDLER_EP, contribution.id, contribution, { source: 'bundled', ...options })
}

/** 注册一条词选择过滤（缺省 bundled）。 */
export function registerWordSelectionFilter(
  contribution: WordSelectionFilterContribution, options: RegisterExtensionOptions = {},
): ExtensionHandle {
  return registerEditorActionExtraExtension(BASIC_WORD_SELECTION_FILTER_EP, contribution.id, contribution, { source: 'bundled', ...options })
}

/** 注册一条自定义粘贴提供方（缺省 bundled）。 */
export function registerCustomPasteProvider(
  contribution: CustomPasteProviderContribution, options: RegisterExtensionOptions = {},
): ExtensionHandle {
  return registerEditorActionExtraExtension(CUSTOM_PASTE_PROVIDER_EP, contribution.id, contribution, { source: 'bundled', ...options })
}

/** 注册一条选区去引号过滤（缺省 bundled）。 */
export function registerSelectionUnquotingFilter(
  contribution: SelectionUnquotingFilterContribution, options: RegisterExtensionOptions = {},
): ExtensionHandle {
  return registerEditorActionExtraExtension(SELECTION_UNQUOTING_FILTER_EP, contribution.id, contribution, { source: 'bundled', ...options })
}

/** 注册一条保存时格式化默认档（缺省 bundled）。 */
export function registerFormatOnSaveDefaultsProvider(
  contribution: FormatOnSaveDefaultsProviderContribution, options: RegisterExtensionOptions = {},
): ExtensionHandle {
  return registerEditorActionExtraExtension(FORMAT_ON_SAVE_DEFAULTS_PROVIDER_EP, contribution.id, contribution, { source: 'bundled', ...options })
}

/**
 * 登记本仓在跑的七支默认贡献（幂等：同 id 覆盖）。
 * 七支都是 passthrough / 空表 ⇒ **不改变任何既有行为**，只让 EP 里看得见、第三方能挂进来。
 */
export function registerBundledEditorActionExtraDefaults(): void {
  registerCopyPastePreProcessor(builtinCopyPastePreProcessor())
  registerTypingActionsExtension(builtinTypingActionsExtension(), { priority: -1 })
  registerCommentCompleteHandler(builtinCommentCompleteHandler())
  registerWordSelectionFilter(builtinWordSelectionFilter())
  registerCustomPasteProvider(builtinCustomPasteProvider())
  registerSelectionUnquotingFilter(builtinSelectionUnquotingFilter())
  registerFormatOnSaveDefaultsProvider(builtinFormatOnSaveDefaultsProvider())
}

registerBundledEditorActionExtraDefaults()
