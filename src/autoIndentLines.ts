// 自动缩进整行（上游 `AutoIndentLinesHandler` + `AutoIndentLinesAction`，Code 菜单的
// 「Auto-Indent Lines」= Ctrl+Alt+I，`platform/platform-resources/src/keymaps/$default.xml:150-152`
// 的 `AutoIndentLines`；动作注册 `platform/lang-impl/resources/intellij.platform.lang.impl.actions.xml:200`）。
//
// 上游是什么（`AutoIndentLinesHandler.java` 逐段）：
//   · `invoke`（`:29-66`）：有选区 ⇒ `[selectionStart, selectionEnd - 1]`；无选区 ⇒ 两点都取光标偏移。
//     `line1` = startOffset 所在行，`col` = 光标的**逻辑列**。
//   · `adjustLineIndent`（`:68-82`）：无选区（`startOffset == endOffset`）时只看**一行** ——
//     先问 `codeStyleManager.isLineToBeIndented(file, lineStart)`，为真才 `adjustLineIndent(file, lineStart)`；
//     有选区时对 `[lineStartOffset(startOffset), endOffset]` 这一段整体 `adjustLineIndent`。
//     两处调的都是 `CodeStyleManager.adjustLineIndent` —— **把行首空白重算成语言要求的缩进**，
//     不是「加一级」。
//   · 收尾（`:57-65`）：无选区且 `line1 < lineCount - 1` 时，光标移到**下一行的同一列**
//     （列超过下一行长度就夹到行尾），清选区、相对滚动。
//
// 本仓的架构还原（没有 PSI / CodeStyleManager）：
//   · `adjustLineIndent` 的「语言要求的缩进」用**结构括号深度**逼近 —— 与 `src/structuralCodeBlock.ts`
//     的 `depthProfile` 同一份词法（字符串/注释里的括号不算），深度即「这一行应该在的层数」；
//     行的第一个**算代码**的字符是右括号时层数减一（闭括号要退到它的开括号那一层，上游
//     `FormatterImpl` 对 `}` 同样退一级）。缩进单位 = 编辑器设置的 `indentUnit`。
//   · `isLineToBeIndented` 的两档否决照抄：**空行/纯空白行不缩进**、**第一个算代码的字符落在
//     字符串或注释里不缩进**（上游那两种 `isLineToBeIndented` 都返回 false）。
//   · 收尾的光标移动与滚动是纯计算，交给 CodeMirror 的 `dispatch`（`scrollIntoView`）。
//
// 与上游的落差（如实登记）：上游按 PSI + `CodeStyleManager` 算缩进，能处理续行对齐、注解、
// 语言专属规则；本仓只有括号深度这一档，所以**只在括号结构上是代码的文件里给得出正确缩进**，
// 语言服务那一侧真正的重排仍走 LSP `textDocument/formatting`（`src/semanticActions.ts`）。
// 本模块补的是「不改整篇、只把光标/选区那几行的行首空白拨正」这条**本地、即时**的动作。
//
// 消费链路：`src/editorCommands.ts` 的 `indent.auto` 命令 + Code 菜单「自动缩进」那一行
// （`src/menus/codeMenu.ts`）；判据 `tests/auto-indent-lines.test.mjs`。
import type { Command, EditorView } from '@codemirror/view'
import { depthProfile } from './structuralCodeBlock.ts'

/** 一行的缩进改动：`from`..`to` 是原来的行首空白区间，`insert` 是重算后的缩进串。 */
export interface AutoIndentEdit {
  from: number
  to: number
  insert: string
  /** 这一行算出来的层数（0 = 顶格）；排错与判据用。 */
  level: number
}

/** 行首偏移表（每个元素是一行的起始文档偏移；与 `String.prototype.split` 的行对齐）。 */
export function lineStarts(text: string): number[] {
  const starts = [0]
  for (let i = 0; i < text.length; ++i) if (text[i] === '\n') starts.push(i + 1)
  return starts
}

/** 偏移 → 0 基行号。 */
export function lineAt(starts: readonly number[], offset: number): number {
  let low = 0
  let high = starts.length - 1
  while (low < high) {
    const mid = (low + high + 1) >> 1
    if (starts[mid]! <= offset) low = mid
    else high = mid - 1
  }
  return low
}

/** 一行行首到第一个非空白字符之间的长度（= 现有缩进宽度，用于比对是否需要改）。 */
export function leadingWhitespace(text: string, from: number): { to: number; indent: string } {
  let at = from
  while (at < text.length && (text[at] === ' ' || text[at] === '\t')) ++at
  return { to: at, indent: text.slice(from, at) }
}

const CLOSERS = ')]}'

/**
 * 这一行**要不要**重算缩进（上游 `CodeStyleManager.isLineToBeIndented` 的两档否决）。
 * `profile` 是整篇的 `depthProfile`（同一份词法，避免每行各扫一遍）。
 */
export function lineToBeIndented(text: string, from: number, to: number, trivia: readonly boolean[]): boolean {
  if (from >= to) return false                       // 空行（行尾即行首）
  const first = text[from]!
  if (first === '\n') return false                   // 纯空白行
  return !trivia[from]                               // 第一个非空白字符在字符串/注释里 ⇒ 不缩进
}

/**
 * 这一行应该缩进到第几层（0 = 顶格）。
 * 深度取第一个非空白字符**之前**的括号深度；闭括号行退一级（`}` 回到它的 `{` 那一层）。
 */
export function expectedIndentLevel(text: string, from: number, depth: readonly number[]): number {
  const base = depth[from] ?? 0
  return text[from] === undefined ? 0 : (CLOSERS.includes(text[from]!) ? Math.max(0, base - 1) : base)
}

/** 按单位串重复 `level` 次。 */
export function indentText(level: number, unit: string): string {
  return unit.repeat(Math.max(0, level))
}

/**
 * `adjustLineIndent` 的纯函数形态：算出这一段里每一行的缩进改动。
 * `[from, to]` 是上游传的区间 —— 无选区时是「单行的行首」（`from == to == lineStart`），
 * 有选区时是 `[lineStartOffset(selectionStart), selectionEnd - 1]`。
 */
export function autoIndentEdits(text: string, from: number, to: number, unit: string): AutoIndentEdit[] {
  const profile = depthProfile(text)
  const starts = lineStarts(text)
  const firstLine = lineAt(starts, from)
  const lastLine = lineAt(starts, Math.max(from, to))
  const edits: AutoIndentEdit[] = []
  for (let line = firstLine; line <= lastLine; ++line) {
    const start = starts[line]!
    const end = line + 1 < starts.length ? starts[line + 1]! - 1 : text.length
    const { to: after, indent } = leadingWhitespace(text, start)
    // 区间只覆盖到 `to`：上游有选区时最后一行可能只选到中间，那一行的行首仍算在内
    // （`DocumentUtil.getLineStartOffset(startOffset, document)` 起、`endOffset` 止），
    // 行首空白永远在 `[start, after)` 里，`after <= to + 1` 时才处理。
    if (line > firstLine && start > to) break
    if (!lineToBeIndented(text, after, end, profile.trivia)) continue
    const level = expectedIndentLevel(text, after, profile.depth)
    const want = indentText(level, unit)
    if (want !== indent) edits.push({ from: start, to: after, insert: want, level })
  }
  return edits
}

/**
 * 上游 `getTargetLineRange` 那一半：从选区/光标算出 `[from, to]` 与 `line1`/`col`。
 * 有选区 ⇒ `from = selectionStart`、`to = selectionEnd - 1`；无选区 ⇒ 两点都是光标偏移。
 */
export function autoIndentTarget(input: {
  hasSelection: boolean
  selectionStart: number
  selectionEnd: number
  caret: number
  /** 光标的逻辑列（上游 `getCaretModel().getLogicalPosition().column`）。 */
  column: number
}): { from: number; to: number; line: number; column: number } {
  const from = input.hasSelection ? input.selectionStart : input.caret
  const to = input.hasSelection ? Math.max(input.selectionStart, input.selectionEnd - 1) : input.caret
  return { from, to, line: 0, column: input.column }
}

/**
 * 收尾的光标落点（上游 `:57-65`）：无选区且光标不在最后一行时，移到**下一行的同一列**，
 * 列超过下一行长度就夹到下一行行尾。返回 null 表示不动光标。
 */
export function autoIndentCaretAfter(text: string, line: number, column: number): { line: number; column: number } | null {
  const starts = lineStarts(text)
  if (line >= starts.length - 1) return null
  const nextStart = starts[line + 1]!
  const nextEnd = line + 2 < starts.length ? starts[line + 2]! - 1 : text.length
  const width = nextEnd - nextStart
  return { line: line + 1, column: Math.min(column, width) }
}

/**
 * 编辑器命令：自动缩进光标所在行 / 选中的行（上游 `AutoIndentLinesHandler.invoke` 的等价物）。
 * `indentUnit` 是缩进单位串（编辑器设置：制表符或 `tabSize` 个空格）。
 */
export function createAutoIndentCommand(indentUnit: string): Command {
  return (view: EditorView) => {
    const state = view.state
    const range = state.selection.main
    const text = state.doc.toString()
    const hasSelection = !range.empty
    const line = state.doc.lineAt(range.head).number - 1
    const column = range.head - state.doc.lineAt(range.head).from
    const { from, to } = autoIndentTarget({
      hasSelection,
      selectionStart: range.from,
      selectionEnd: range.to,
      caret: range.head,
      column,
    })
    const edits = autoIndentEdits(text, from, to, indentUnit)
    const changes = edits.map(edit => ({ from: edit.from, to: edit.to, insert: edit.insert }))
    if (!hasSelection) {
      const caret = autoIndentCaretAfter(text, line, column)
      if (caret) {
        const target = state.doc.line(caret.line + 1)
        const anchor = Math.min(target.from + caret.column, target.to)
        view.dispatch({ changes, selection: { anchor }, scrollIntoView: true, userEvent: 'input.indent' })
        return true
      }
    }
    if (!changes.length) return false
    view.dispatch({ changes, scrollIntoView: true, userEvent: 'input.indent' })
    return true
  }
}

/** 默认单位：4 个空格（编辑器设置未接通时的兜底；接通的路径见 `src/editorCommands.ts` 的 `indent.auto`）。 */
export const autoIndentLinesCommand: Command = createAutoIndentCommand('    ')