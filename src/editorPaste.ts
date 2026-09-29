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
import { EditorView } from '@codemirror/view'
import type { Extension } from '@codemirror/state'

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

/** 编辑器把粘贴交给宿主时带的信息（插入结果 + 原始文本）。 */
export interface PasteEvent { info: PasteInsertion; text: string }

/**
 * 接管编辑器的粘贴事件（IDEA 里是编辑器插件的 `EditorPaste` 处理器）：
 * CodeMirror 默认也是"原样插入"，这里改成先插入再把插入结果交回宿主，
 * 以便按 `REFORMAT_ON_PASTE` 决定要不要让语言服务重新缩进这一段。
 * 只有拿得到 `text/plain` 时才接管，其它情况交回 CodeMirror 的默认行为。
 */
export function pasteChannel(onPaste: (event: PasteEvent) => void): Extension {
  return EditorView.domEventHandlers({
    paste(event, view) {
      const text = event.clipboardData?.getData('text/plain') ?? ''
      if (!text) return false
      event.preventDefault()
      onPaste({ info: insertTextAtCaret(view, text), text })
      return true
    },
  })
}

