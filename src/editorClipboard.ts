// 编辑器的复制 / 剪切通道 —— IDEA `com.intellij.openapi.editor.actions.CopyAction` / `CutAction` 的对应物。
//
// 对照源码（`D:\Backup\Downloads\intellij-community-master\intellij-community-master`）：
//   · `platform/platform-impl/src/com/intellij/openapi/editor/actions/CopyAction.java:107-118`
//     `prepareSelectionToCopy`：**有选区** → 直接复制选区（`CopyPasteOptions.DEFAULT`）；
//     **无选区** → 先 `EditorActionUtil.selectEntireLines(caret)` 选中整行再复制，并标记
//     `CopiedFromEmptySelectionPasteMode`（`CopyPasteOptions(true)`）。
//   · `platform/platform-impl/src/com/intellij/openapi/editor/actions/EditorActionUtil.java:135-140`
//     `selectEntireLines`：注释原文 "the resulting selection always includes the line ending character"
//     —— 整行选区**必须带行尾换行**（所以连续按会一行行往下扩）。
//   · `:107-111` 两个开关都来自 AdvancedSettings：`editor.skip.copy.and.cut.for.empty.selection`
//     （跳过空选区的复制/剪切，默认 false）与 `editor.skip.selecting.line.after.copy.empty.selection`
//     （复制整行后不要保持选中，默认 false ⇒ **默认保持整行选中**）。
//   · `CopyAction.java:96-104` 复制后是否恢复光标：`preserveOriginalCaretState = !isCopyFromEmptySelectionToSelectLine()`，
//     默认 false ⇒ **不恢复**，整行保持选中；`CopyAction.java:120-141` `restoreCaretStateIfNeeded`
//     只在 preserve 为真时执行。
//   · `platform/platform-impl/src/com/intellij/openapi/editor/actions/CutAction.java:22-33`
//     `prepareSelectionToCut` = `prepareSelectionToCopy(editor, false, false)`（**preserve 为 false**），
//     复制之后 `EditorModificationUtil.deleteSelectedTextForAllCarets(editor)` —— 剪切 = 复制 + 删掉选中的东西。
//   · 两条动作都走 `CopyPasteManager.setContents`（`CopyAction.java:126`）⇒ 都要进历史环（src/clipboardHistory.ts）。
//
// 为什么要在 CodeMirror 里接管 DOM 的 copy/cut（而不是放一个全局 document 监听）：
//   ① "无选区复制整行"只有拿到编辑器状态才能实现，`window.getSelection()` 在无选区时是空串；
//   ② `copy` 事件里 `clipboardData` 是**可写**的，同步写入比异步 `navigator.clipboard` 更贴近用户手势；
//   ③ 复制发生在编辑器动作里（IDEA 亦然），非编辑器的复制路径另有 `copyToClipboard` 兜底入环。
import { EditorView, type Command } from '@codemirror/view'
import type { Extension } from '@codemirror/state'

/** 只依赖 CodeMirror 文档接口的一小部分，便于单测（真身是 `Text`）。 */
export interface DocLike {
  lines: number
  length: number
  lineAt(pos: number): { from: number; to: number; number: number }
  sliceString(from: number, to: number): string
}

export interface SelectionLike { from: number; to: number; empty: boolean }

/** 一次复制/剪切要做的事：复制什么文本、操作哪个范围、之后选区停在哪。 */
export interface ClipboardPlan {
  text: string
  from: number
  to: number
  /** 复制整行时把整行选中（`CopyAction` 默认不恢复光标）；有选区时保持原选区。 */
  selection: { anchor: number; head: number }
  /** 是否为"从空选区复制整行"（`CopyPasteOptions.isCopiedFromEmptySelection`）。 */
  fromEmptySelection: boolean
}

/**
 * `EditorActionUtil.selectEntireLines` 的范围：光标所在行 + **行尾换行**（最后一行没有换行就到行尾）。
 * 注意它不是"行首到行尾"——少了那个 `+1` 连续复制就不会一行行往下扩。
 */
export function entireLineRange(doc: DocLike, pos: number): { from: number; to: number } {
  const line = doc.lineAt(Math.max(0, Math.min(pos, doc.length)))
  const end = line.number < doc.lines ? line.to + 1 : line.to
  return { from: line.from, to: end }
}

/**
 * `CopyAction.prepareSelectionToCopy`（:107-118）：
 *
 * @param skipEmpty 对应 AdvancedSettings `editor.skip.copy.and.cut.for.empty.selection`（默认 false）
 */
export function planCopy(doc: DocLike, selection: SelectionLike, skipEmpty = false): ClipboardPlan | null {
  if (!selection.empty) {
    return {
      text: doc.sliceString(selection.from, selection.to),
      from: selection.from,
      to: selection.to,
      selection: { anchor: selection.from, head: selection.to },
      fromEmptySelection: false,
    }
  }
  // 无选区：`isSkipCopyPasteForEmptySelection()` 为真时什么都不做
  if (skipEmpty) return null
  const range = entireLineRange(doc, selection.from)
  const text = doc.sliceString(range.from, range.to)
  if (!text) return null
  return {
    text,
    from: range.from,
    to: range.to,
    // preserveOriginalCaretState 默认 false ⇒ 整行保持选中（`isCopyFromEmptySelectionToSelectLine()` 默认 true）
    selection: { anchor: range.from, head: range.to },
    fromEmptySelection: true,
  }
}

/** `CutAction`：同一套选区准备，但**永远不保持**选中状态（preserve 传 false），之后还要删掉这一段。 */
export function planCut(doc: DocLike, selection: SelectionLike, skipEmpty = false): ClipboardPlan | null {
  const plan = planCopy(doc, selection, skipEmpty)
  if (!plan) return null
  return { ...plan, selection: { anchor: plan.from, head: plan.to } }
}

/**
 * `CopyAction.copyToClipboard`（:120-133）：把文本交给 `CopyPasteManager.setContents`。
 * 宿主侧就是 `src/clipboard.ts` 的 `copyToClipboard`（写系统剪贴板 + 压进历史环）。
 */
export type CopySink = (text: string) => void

/** 菜单 / 快捷键触发的复制（没有 DOM 事件可写，所以走宿主剪贴板通道）。 */
export function copySelection(view: EditorView, sink: CopySink): boolean {
  const plan = planCopy(view.state.doc, view.state.selection.main)
  if (!plan) return false
  sink(plan.text)
  applySelection(view, plan)
  return true
}

/** 菜单 / 快捷键触发的剪切：复制 + 删除选中范围。 */
export function cutSelection(view: EditorView, sink: CopySink): boolean {
  const plan = planCut(view.state.doc, view.state.selection.main)
  if (!plan) return false
  sink(plan.text)
  view.dispatch({
    changes: { from: plan.from, to: plan.to, insert: '' },
    selection: { anchor: plan.from },
    scrollIntoView: true,
  })
  return true
}

/** 菜单/键位用的命令表（编辑器把它 spread 进自己的命令表）。 */
export function clipboardCommands(sink: CopySink): Record<string, Command> {
  return {
    copy: view => copySelection(view, sink),
    cut: view => cutSelection(view, sink),
  }
}

function applySelection(view: EditorView, plan: ClipboardPlan) {
  view.dispatch({ selection: { anchor: plan.selection.anchor, head: plan.selection.head } })
}

/**
 * DOM 层通道：接管编辑器里的 Ctrl+C / Ctrl+X。
 * 文本直接写进 `clipboardData`（同步、在用户手势内），同时把它交给 `sink` 入历史环；
 * 拿不到内容时返回 `false`，交回 CodeMirror 的默认行为。
 */
export function copyCutChannel(sink: CopySink): Extension {
  return EditorView.domEventHandlers({
    copy(event, view) {
      const plan = planCopy(view.state.doc, view.state.selection.main)
      if (!plan) return false
      event.preventDefault()
      event.clipboardData?.setData('text/plain', plan.text)
      sink(plan.text)
      applySelection(view, plan)
      return true
    },
    cut(event, view) {
      const plan = planCut(view.state.doc, view.state.selection.main)
      if (!plan) return false
      event.preventDefault()
      event.clipboardData?.setData('text/plain', plan.text)
      sink(plan.text)
      view.dispatch({
        changes: { from: plan.from, to: plan.to, insert: '' },
        selection: { anchor: plan.from },
        scrollIntoView: true,
      })
      return true
    },
  })
}
