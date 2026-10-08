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
import { caretStateFromRanges, rememberCopiedCarets } from './clipboardPerCaret.ts'
// 富文本复制（IDEA Rich-Text Copy）的**纯逻辑**在 src/richCopy.ts；本模块只做 DOM 取数。
// 这三个 import 的图都是"零 Vue / 零副作用"：`htmlExportDom.ts` 只 type-import `htmlExport.ts`
//（Node 擦除 type import ⇒ 不会把 Vue / bridge 拉进来），`appExportTheme.ts` 与 `richCopy.ts` 无 import。
import { readStyledLines } from './htmlExportDom.ts'
import { readExportThemeTokens } from './appExportTheme.ts'
import { RICH_COPY_MAX_SIZE_MB, richCopyFromEditor, selectRenderedLines, type RichCopySettingsState } from './richCopy.ts'

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

/**
 * 富文本（HTML）生产者 —— IDEA `TextWithMarkupProcessor.createResult`（:137-141）那一路的可选注入。
 *
 * 为什么是注入而不是在这里 import：`editorClipboard.ts` 必须能被 Node 直接加载（`tests/editor-commands.test.mjs`
 * 真的 import 它），所以它不认识 Vue / 主题 / `getComputedStyle`。宿主（`CodeEditor.vue`）把
 * `readStyledLines(view)` + 主题 + `src/richCopy.ts` 的 `richCopyFromEditor` 合成这个闭包交进来。
 *
 * 返回 `null`/空串 ⇒ 这一次复制不带 HTML（等价于上游 `RichCopySettings.isEnabled() === false`，
 * `TextWithMarkupProcessor.java:53-54` 直接返回空列表）。
 */
export type RichHtmlProducer = (view: EditorView, plan: ClipboardPlan) => string | null

export type RichCopySink = (text: string, html: string) => void

/** 菜单 / 快捷键触发的复制（没有 DOM 事件可写，所以走宿主剪贴板通道）。 */
export function copySelection(view: EditorView, sink: CopySink, richHtml?: RichHtmlProducer, richSink?: RichCopySink): boolean {
  const plan = planCopy(view.state.doc, view.state.selection.main)
  if (!plan) return false
  const html = richHtml ? safeRichHtml(richHtml, view, plan) : null
  if (html && richSink) richSink(plan.text, html)
  else sink(plan.text)
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
export function clipboardCommands(sink: CopySink, richHtml?: RichHtmlProducer, richSink?: RichCopySink): Record<string, Command> {
  return {
    copy: view => copySelection(view, sink, richHtml, richSink),
    cut: view => cutSelection(view, sink),
  }
}

function applySelection(view: EditorView, plan: ClipboardPlan) {
  view.dispatch({ selection: { anchor: plan.selection.anchor, head: plan.selection.head } })
}

/**
 * 一次复制要写进 `clipboardData` 的 flavor 清单（上游 `TextBlockTransferable.java:40-47` 的多 flavor 形状）。
 * 纯函数，便于单测；`html` 为空时退化成只有 `text/plain` 的旧行为。
 */
export function copyFlavors(plan: ClipboardPlan, html: string | null): Array<[string, string]> {
  const entries: Array<[string, string]> = [['text/plain', plan.text]]
  if (html) entries.push(['text/html', html])
  return entries
}

/** `RichHtmlProducer` 需要的那点宿主状态（`CodeEditor.vue` 在装配期注入）。 */
export interface RichCopyHost {
  /**
   * `RichCopySettings` 的当前值。**可选**：本仓还没把 `editor.rich.copy.xml` 那两条
   * （`enabled` / `schemeName`）接进 `settingsModel`，缺省即"开"（上游默认值，
   * `RichCopySettings.java:20`）—— 所以现在只传另外两项就能跑。
   */
  settings?: () => RichCopySettingsState
  /** `document.documentElement` 的计算样式（读 `--panel` / `--text` / `--font-mono`）。 */
  rootStyle: () => CSSStyleDeclaration
  /** 编辑器字号（`editorSettings.fontSize`）。 */
  fontSize: () => number
}

/**
 * 造一个 `RichHtmlProducer`：把 `readStyledLines(view)`（已渲染的带色行）+ 主题 + `view.state.tabSize`
 * 交给 `src/richCopy.ts` 的 `richCopyFromEditor`，产出 HTML 片段。
 *
 * 这是 `TextWithMarkupProcessor.collectTransferableData`（:53-134）的等价物：
 * `:53-54` 关掉就直接返回 `null`（不带 HTML）、`:59-60` 取颜色方案、`:67-71` 剥缩进、
 * `:139` 取 tab 宽、`:137-141` 产出。行号**不带**（`HtmlSyntaxInfoReader` 无 gutter）。
 *
 * 只覆盖**单个连续选区**：上游的多光标/块选择会逐 caret 拼片段（`:87-117`），
 * 本仓这里取主选区（`selection.main`）—— 与 `planCopy` 的既有口径一致。
 */
export function richCopyProducer(host: RichCopyHost): RichHtmlProducer {
  return (view, plan) => {
    if (host.settings && !host.settings().enabled) return null
    const lines = readStyledLines(view)
    if (!lines.length) return null
    // 视口渲染的行下标从 0 起，但文档行号要从 `viewportLineBlocks[0]` 折算 —— 否则选中的行会错位。
    const blocks = view.viewportLineBlocks
    const firstLineNumber = blocks.length
      ? view.state.doc.lineAt(blocks[0]!.from).number
      : view.state.doc.lineAt(view.state.selection.main.from).number
    const startLine = view.state.doc.lineAt(plan.from).number
    const endLine = view.state.doc.lineAt(plan.to).number
    const selectedLines = selectRenderedLines(lines, firstLineNumber, startLine, endLine)
    if (selectedLines.length !== endLine - startLine + 1) return null
    const clippedLines = []
    for (let index = 0; index < selectedLines.length; index++) {
      const lineNumber = startLine + index
      const documentLine = view.state.doc.line(lineNumber)
      const renderedRuns = selectedLines[index]!
      const renderedText = renderedRuns.map(run => run.text).join('')
      const completeRuns = documentLine.length === 0 && renderedText === '\n' ? [] : renderedRuns
      if (completeRuns.map(run => run.text).join('') !== documentLine.text) return null
      const from = Math.min(documentLine.length, Math.max(0, plan.from - documentLine.from))
      const to = Math.min(documentLine.length, Math.max(from, plan.to - documentLine.from))
      clippedLines.push(clipStyledRuns(completeRuns, from, to))
    }
    const theme = readExportThemeTokens(host.rootStyle(), host.fontSize())
    return richCopyFromEditor({
      text: plan.text,
      lines: clippedLines,
      theme,
      tabSize: view.state.tabSize,
      maxLength: RICH_COPY_MAX_SIZE_MB * 1024 * 1024,
    }).html
  }
}

function clipStyledRuns<T extends { text: string }>(runs: readonly T[], from: number, to: number): T[] {
  const clipped: T[] = []
  let offset = 0
  for (const run of runs) {
    const end = offset + run.text.length
    const startInRun = Math.max(0, from - offset)
    const endInRun = Math.min(run.text.length, to - offset)
    if (startInRun < endInRun) clipped.push({ ...run, text: run.text.slice(startInRun, endInRun) })
    offset = end
  }
  return clipped
}

function safeRichHtml(producer: RichHtmlProducer, view: EditorView, plan: ClipboardPlan): string | null {
  try { return producer(view, plan) || null } catch { return null }
}

/**
 * DOM 层通道：接管编辑器里的 Ctrl+C / Ctrl+X。
 * 文本直接写进 `clipboardData`（同步、在用户手势内），同时记入剪贴板环；
 * 拿不到内容时返回 `false`，交回 CodeMirror 的默认行为。
 *
 * 可选第二个参数 `richHtml`：给了就在同一趟里再写一条 `text/html` flavor
 * —— 这就是上游剪贴板里 纯文本 + HTML 两条并存（`TextBlockTransferable.java:40-47`）的对应物。
 * 不传则与旧行为逐字相同（只有 `text/plain`）。
 */
export function copyCutChannel(sink: CopySink, richHtml?: RichHtmlProducer, historySink: CopySink = sink, richSink?: RichCopySink): Extension {
  return EditorView.domEventHandlers({
    copy(event, view) {
      const plan = planCopy(view.state.doc, view.state.selection.main)
      if (!plan) return false
      event.preventDefault()
      const html = richHtml ? safeRichHtml(richHtml, view, plan) : null
      for (const [flavor, data] of copyFlavors(plan, html)) event.clipboardData?.setData(flavor, data)
      // 复制侧记下各光标偏移（上游 `EditorCopyPasteHelperImpl.java:94` 的 `CaretStateTransferableData`），
      // 供本进程内的多光标粘贴按光标切分（`src/clipboardPerCaret.ts`）。
      rememberCopiedCarets(caretStateFromRanges(view.state.selection.ranges.map(range => ({ from: range.from, to: range.to }))))
      if (event.clipboardData) historySink(plan.text)
      else if (html && richSink) richSink(plan.text, html)
      else sink(plan.text)
      applySelection(view, plan)
      return true
    },
    cut(event, view) {
      const plan = planCut(view.state.doc, view.state.selection.main)
      if (!plan) return false
      event.preventDefault()
      // 剪切只写纯文本：富文本那一路在剪切语义下没有对应的用户可见行为，故不注入。
      for (const [flavor, data] of copyFlavors(plan, null)) event.clipboardData?.setData(flavor, data)
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
