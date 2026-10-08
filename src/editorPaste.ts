// 编辑器粘贴通道 —— IDEA `EditorCopyPasteHelperImpl.insertStringAtCaret` 的对应物（CodeMirror 版）。
//
// 对照源码（`D:\Backup\Downloads\intellij-community-master\intellij-community-master`）：
//   · `platform/platform-impl/src/com/intellij/openapi/editor/impl/EditorCopyPasteHelperImpl.java:114-186`
//     `pasteTransferable`：取出文本 → 在光标处插入（有选区时替换它），返回插入范围
//   · `platform/lang-impl/src/com/intellij/codeInsight/editorActions/PasteHandler.java:205-219`
//     `blockIndentAnchorColumn` = 光标逻辑列（有选区且光标在选区内时取选区起点列）
//   · `platform/lang-impl/.../DefaultTypingActionsExtension.java:215-236` `indentPlainTextBlock`
//     需要一个"光标所在行是不是文档最后一行"的判断（宿主只有文本，算不出来）→ 由本模块回传
//
// 把这两件事放在模块里（而不是 CodeEditor.vue）有两个理由：① 它们不需要 Vue，只需要 EditorView；
// ② 纯函数可单测。`.vue` 里只留 `insertText` / `replaceRange` 两个薄包装。
//
// **2026-10-06 本 lane 补**：这条粘贴通道现在是三条扩展点的真实消费点
// （`src/editorActionExtraExtensionPoints.ts` 声明与出处）——
//   · `com.intellij.customPasteProvider`：`PasteHandler.java:113-117` 的循环，
//     **第一条** `isPasteEnabled` 为真的接管这次粘贴（`performPaste` 跑完就 return，默认粘贴不跑）；
//   · `com.intellij.copyPastePreProcessor`：`PasteHandler.java:239-246` 的循环，
//     逐条 `preprocessOnPaste` 把上一条的输出喂给下一条，改过文本还要看
//     `isReformatCodeBeforePaste`（本仓的 `REFORMAT_BLOCK` 升级那一档见 `src/pasteOptions.ts` 文件头）；
//   · `com.intellij.typingActionsExtension`：`doPaste`（`:164-170`）外面包的
//     `startPaste` … `finally endPaste` 两个时相，由 `findForContext` 选出的那**一个**接。
// 三条的 bundled 贡献都是 passthrough（不接管 / 不改文本 / 不做事）⇒ 没有第三方挂进来时，
// 下面的行为与本文件此前逐字相同。
//
// 如实差异：本仓的粘贴事件只带 `text/plain`，没有 `Transferable`/`RawText` 的富类型
// （`raw` 就是原样的剪贴板文本）；宿主注入点（`src/components/CodeEditor.vue:859` 的
// `pasteChannel(...)`）在禁改文件里，所以调用方**没有**传路径与语言 ⇒ EP 的语言收窄不生效
// （见 `acceptsLanguage` 的注释），其余上下文（文本 / 行列 / 选区 / 剪贴板原文）都齐。
import { EditorView } from '@codemirror/view'
import type { Extension } from '@codemirror/state'
import { caretStateFromRanges, copiedCaretsForPaste, rememberCopiedCarets, splitTextPerCaret } from './clipboardPerCaret.ts'
import {
  customPasteProviderFor, notifyTypingActions, performCustomPaste, preprocessPastedText,
  requiresAllDocumentsCommitted, type PastePreprocessResult, type PasteProviderInput,
} from './editorActionExtraExtensionPoints.ts'

/** 一次粘贴插入的结果：宿主需要的三个上下文 + 供 `rangeFormatting` 用的范围。 */
export interface PasteInsertion {
  from: number
  to: number
  /** 0 基逻辑列（`PasteHandler.java:212-219`）。 */
  anchorColumn: number
  /** 光标落点所在行是否为文档最后一行（`indentPlainTextBlock` 的前置判断之一）。 */
  caretLineIsLast: boolean
  /** 插入内容的 0 基 LSP 范围（`start/end` 的 line 为 0 基，character 为行内 0 基列）。 */
  range: { start: { line: number; character: number }; end: { line: number; character: number } }
}

/** 在光标处插入文本（有选区先替换），并把插入前后需要的上下文一起回传。 */
export function insertTextAtCaret(view: EditorView, text: string): PasteInsertion {
  const selection = view.state.selection.main
  const from = selection.from
  const to = selection.to
  view.dispatch({
    changes: { from, to, insert: text },
    selection: { anchor: from + text.length },
    scrollIntoView: true,
  })
  const end = from + text.length
  const first = view.state.doc.lineAt(from)
  const last = view.state.doc.lineAt(end)
  const caret = view.state.doc.lineAt(view.state.selection.main.head)
  return {
    from,
    to: end,
    anchorColumn: from - first.from,
    caretLineIsLast: caret.number === view.state.doc.lines,
    range: {
      start: { line: first.number - 1, character: from - first.from },
      end: { line: last.number - 1, character: end - last.from },
    },
  }
}

/** 纯文本缩进路径要重写刚插入的那一段（IDEA 直接在 Document 的行首插缩进串）。 */
export function replaceInsertedRange(view: EditorView, from: number, to: number, text: string): boolean {
  view.dispatch({
    changes: { from, to, insert: text },
    selection: { anchor: from + text.length },
    scrollIntoView: true,
  })
  return true
}

/**
 * 多光标粘贴：按**目标光标数**切分文本、逐光标插入（上游
 * `EditorCopyPasteHelperImpl.pasteTransferable` 的 `runForEachCaret` 那一支，`:174-180`）。
 *
 * 单光标时与 `insertTextAtCaret` 逐字等价（切分器 `caretCount === 1` 直接给整段）。
 * 返回**主光标**那次插入的上下文 —— 粘贴后处理（`rangeFormatting`）按主光标那一段走，
 * 与上游「每段各插一次、返回 `TextRange[]`」的形态差记在 `src/clipboardPerCaret.ts` 文件头。
 * 切分来源：本进程上一次复制记下的逐光标偏移（`copiedCaretsForPaste()`），没有就按 `\n` 切。
 */
export function insertTextPerCaret(view: EditorView, text: string): PasteInsertion {
  const ranges = view.state.selection.ranges
  if (ranges.length <= 1) return insertTextAtCaret(view, text)
  const segments = splitTextPerCaret(text, copiedCaretsForPaste(), ranges.length)
  // 一次 dispatch 把所有光标都插上（CodeMirror 会按 change 的先后自行换算偏移）。
  // 先按位置**升序**排序，插入时不互相影响（上游 runForEachCaret 的顺序是光标序，本仓取位置序）。
  const ordered = ranges.map((range, index) => ({ from: range.from, to: range.to, text: segments[index]!, index }))
    .sort((left, right) => left.from - right.from)
  view.dispatch({
    changes: ordered.map(entry => ({ from: entry.from, to: entry.to, insert: entry.text })),
    scrollIntoView: true,
  })
  // 主光标那一段决定返回的上下文（它是 `view.state.selection.main`）。
  const mainIndex = ranges.indexOf(view.state.selection.main)
  const main = ordered.find(entry => entry.index === Math.max(0, mainIndex)) ?? ordered[0]!
  const from = main.from
  const end = from + main.text.length
  const first = view.state.doc.lineAt(from)
  const last = view.state.doc.lineAt(end)
  const caret = view.state.doc.lineAt(view.state.selection.main.head)
  return {
    from,
    to: end,
    anchorColumn: from - first.from,
    caretLineIsLast: caret.number === view.state.doc.lines,
    range: {
      start: { line: first.number - 1, character: from - first.from },
      end: { line: last.number - 1, character: end - last.from },
    },
  }
}

/** 复制侧记下各光标偏移（上游 `EditorCopyPasteHelperImpl.java:94`），供本进程内的多光标粘贴切分。 */
export function rememberCaretsForCopy(view: EditorView): void {
  rememberCopiedCarets(caretStateFromRanges(view.state.selection.ranges.map(range => ({ from: range.from, to: range.to }))))
}

/** 编辑器把粘贴交给宿主时带的信息（插入结果 + 原始文本）。 */
export interface PasteEvent {
  info: PasteInsertion
  /** 原始剪贴板文本。 */
  text: string
  /** 真正插进文档的文本（预处理器可能改过它；没有贡献时逐字等于 `text`）。 */
  inserted: string
  /** 这一趟粘贴走的三条 EP 的结果（诊断/判据用）。 */
  extensions: {
    /** `com.intellij.customPasteProvider`：接管这次粘贴的那条贡献 id（没接管 = null）。 */
    customPasteProvider: string | null
    /** `com.intellij.copyPastePreProcessor` 的累积结果。 */
    preprocess: PastePreprocessResult
    /** `com.intellij.typingActionsExtension` 的 `startPaste` / `endPaste` 有没有人接。 */
    typingActions: { startPaste: boolean; endPaste: boolean }
    /** `requiresAllDocumentsToBeCommitted`：粘贴前要不要把文档都 commit 掉（缺省 true）。 */
    requiresAllDocumentsCommitted: boolean
  }
}

/** 粘贴通道的注入点（宿主能把当前文件的事实喂进来时给这些；不给 = 各项按未知档）。 */
export interface PasteChannelDeps {
  /** 当前文件路径（缺省 `''` = 未知）。 */
  path?: () => string
  /** 当前语言 id（缺省 `''` = 未知，EP 不收窄语言）。 */
  language?: () => string
}

/** 从活动视图折出 EP 要的上下文（路径/语言未知时留空 —— 见文件头「如实差异」）。 */
function pasteContextOf(view: EditorView, deps: PasteChannelDeps, text: string) {
  const head = view.state.selection.main.head
  const line = view.state.doc.lineAt(head)
  const selection = view.state.selection.main
  return {
    path: deps.path?.() ?? '',
    language: deps.language?.() ?? '',
    text: view.state.doc.toString(),
    line: line.number - 1,
    character: head - line.from,
    selectedText: selection.empty ? '' : view.state.sliceDoc(selection.from, selection.to),
    raw: text,
  }
}

/** 当前位置的插入上下文（**不改文档**）—— 自定义粘贴接管时用它回填 `PasteEvent`。 */
function currentInsertion(view: EditorView, from: number, length: number): PasteInsertion {
  const end = from + length
  const first = view.state.doc.lineAt(from)
  const last = view.state.doc.lineAt(Math.min(end, view.state.doc.length))
  const caret = view.state.doc.lineAt(view.state.selection.main.head)
  return {
    from,
    to: end,
    anchorColumn: from - first.from,
    caretLineIsLast: caret.number === view.state.doc.lines,
    range: {
      start: { line: first.number - 1, character: from - first.from },
      end: { line: last.number - 1, character: end - last.from },
    },
  }
}

/**
 * 接管编辑器的粘贴事件（IDEA 里是编辑器插件的 `EditorPaste` 处理器）：
 * CodeMirror 默认也是"原样插入"，这里改成先插入再把插入结果交回宿主，
 * 以便按 `REFORMAT_ON_PASTE` 决定要不要让语言服务重新缩进这一段。
 * 只有拿得到 `text/plain` 时才接管，其它情况交回 CodeMirror 的默认行为。
 *
 * 三条 EP 的顺序照上游 `PasteHandler`：
 *   ① `customPasteProvider`（`:113-117`，在 `doPaste` **之前**，为真即整趟接管）；
 *   ② `typingActionsExtension.startPaste`（`:166`，在 `doPaste` **里面**的最外圈）；
 *   ③ `copyPastePreProcessor.preprocessOnPaste`（`:239-246`，插入**之前**逐条串起来）；
 *   ④ 插入之后 `endPaste`（`:169-170` 的 `finally`）。
 */
export function pasteChannel(onPaste: (event: PasteEvent) => void, deps: PasteChannelDeps = {}): Extension {
  return EditorView.domEventHandlers({
    paste(event, view) {
      const text = event.clipboardData?.getData('text/plain') ?? ''
      if (!text) return false
      event.preventDefault()
      const context = pasteContextOf(view, deps, text)
      // ① 自定义粘贴提供方：第一条 `isPasteEnabled` 为真的接管（上游 `PasteHandler.java:113-117`）。
      // 它自己决定插什么（`insertText` 回调），本模块只把上下文递过去、不再走默认插入。
      const caretFrom = view.state.selection.main.from
      const providerInput: PasteProviderInput = {
        path: context.path, language: context.language, text: context.text,
        line: context.line, character: context.character, selectedText: context.selectedText,
        clipboardText: text,
        insertText: (value: string) => { insertTextPerCaret(view, value) },
      }
      const provider = customPasteProviderFor(providerInput)
      if (provider && performCustomPaste(provider, providerInput)) {
        // 插什么由提供方通过 `insertText` 回调自己决定，本模块只把「接管者是谁」记进事件里
        // （`inserted` 说不上具体文本，如实留空；`info` 是**不插入**的位置快照）。
        onPaste({
          info: currentInsertion(view, caretFrom, 0),
          text, inserted: '',
          extensions: {
            customPasteProvider: provider.id,
            preprocess: { text, changed: false, reformatBeforePaste: false, applied: [] },
            typingActions: { startPaste: false, endPaste: false },
            requiresAllDocumentsCommitted: requiresAllDocumentsCommitted(context).required,
          },
        })
        return true
      }
      // ② 打字动作的 `startPaste`（上游 `PasteHandler.java:166`）。
      const started = notifyTypingActions('startPaste', context)
      // ③ 复制粘贴预处理器：逐条串起来（上游 `:239-246`）。
      const preprocess = preprocessPastedText(context)
      // 多光标时按光标切分（`insertTextPerCaret`；单光标路径与旧行为逐字等价）。
      const info = insertTextPerCaret(view, preprocess.text)
      // ④ `endPaste`（上游 `:169-170` 的 finally，总要跑）。
      const ended = notifyTypingActions('endPaste', context)
      onPaste({
        info,
        text,
        inserted: preprocess.text,
        extensions: {
          customPasteProvider: null,
          preprocess,
          typingActions: { startPaste: started, endPaste: ended },
          requiresAllDocumentsCommitted: requiresAllDocumentsCommitted(context).required,
        },
      })
      return true
    },
  })
}

