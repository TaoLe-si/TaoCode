// 语句级上下移动（`lp/editor-actions` 判决缺项 ③：`MoveStatementHandler` / `MoverWrapper`）。
//
// 上游坐标：
//   · `platform/lang-impl/src/com/intellij/codeInsight/editorActions/moveUpDown/MoveStatementHandler.java:25-38`
//     —— 按 `StatementUpDownMover` 扩展点的顺序问「谁能处理光标」，谁先答应就交给谁
//     （`MoverWrapper` 就是「mover + 它算出来的 MoveInfo + 方向」这一包）。
//   · 键位 `$default.xml:782-784` `MoveStatementDown` = Ctrl+Shift+Down、`:785-787`
//     `MoveStatementUp` = Ctrl+Shift+Up（Alt+Shift+Up/Down 是 `MoveLineUp/Down`，
//     本仓已经挂在 `editingCommands` 的 `line.moveUp/Down` 上，两者不冲突）。
//
// **本仓的等价物**：上游那一套是 PSI 级的 —— `StatementUpDownMover` 的语言扩展点负责算出
// 「光标所在语句」的区间，所以它能把语句**从所在块里摘出来**再放到上一条语句的位置
// （本仓没有 PSI，也拿不到 `MoveInfo`）。这里做的是**词法级**的一档：把光标所在的最内层
// **花括号块**（表头行 + 块体 + 收尾行）整段上/下移一行；光标不在任何块里时就是它自己那一行
// 带上未闭合的行尾。也就是「用行移动器搬一条语句」—— 可用、可见、可测，
// 但**不等于**上游的语义搬运（把 `if` 体里的一条语句提到块外那种）。判词里点名的
// `StatementUpDownMover`/`MoverWrapper` 语义部分如实留在待办。
import { EditorSelection, type ChangeSpec } from '@codemirror/state'
import type { Command, EditorView } from '@codemirror/view'

export interface Span { from: number; to: number }

/** 行内的一段区间（`from`/`to` 是文档偏移，`to` 不含换行符）。 */
interface LineSpan extends Span { number: number }

/** 一行里的花括号净增减（字符串/注释里的不算 —— 与 `smartEnter.ts` 的扫描口径一致）。 */
export function braceDelta(line: string): number {
  let delta = 0
  let inBlock = false
  for (let i = 0; i < line.length; ++i) {
    const char = line[i]!
    const next = line[i + 1]
    if (inBlock) { if (char === '*' && next === '/') { inBlock = false; i++ } continue }
    if (char === '/' && next === '/') break
    if (char === '/' && next === '*') { inBlock = true; i++; continue }
    if (char === '"' || char === '\'' || char === '`') { i = skipString(line, i); continue }
    if (char === '{') ++delta
    else if (char === '}') --delta
  }
  return delta
}

function skipString(text: string, quoteIndex: number): number {
  const quote = text[quoteIndex]!
  for (let i = quoteIndex + 1; i < text.length; i++) {
    const char = text[i]!
    if (char === '\\') { i++; continue }
    if (char === quote) return i
  }
  return text.length - 1
}

function lineOf(text: string, number: number): LineSpan {
  let from = 0
  for (let n = 1; n < number; ++n) {
    const next = text.indexOf('\n', from)
    if (next < 0) return { number, from: text.length, to: text.length }
    from = next + 1
  }
  const end = text.indexOf('\n', from)
  return { number, from, to: end < 0 ? text.length : end }
}

/**
 * 光标在 `line` 行时，那一条「语句」的行区间（闭区间，含两端）。
 *
 * 判定：先算这一行**行首**的花括号深度 `d`。
 *   · 行尾深度 > `d`（这一行自己开了块没关）→ 往**下**吃到深度回到 `d` 的那一行；
 *   · 行首深度 > 0（光标在某个块里）→ 往**上**找到本层块的开头行（起始深度 `d-1` 且
 *     行尾深度 ≥ `d` 的最后一行），再往下吃到深度回到 `d-1` 的那一行；
 *   · 都不成立 → 就是光标这一行。
 * 找不到对应层（文件本身括号就不平）时退回「光标这一行」，不猜。
 */
export function statementLines(text: string, line: number): { first: number; last: number } {
  const count = text.length === 0 ? 1 : text.split(/\r?\n/).length
  const target = Math.min(Math.max(1, line), count)
  const before: number[] = [0]
  const after: number[] = [0]
  for (let number = 1; number <= count; ++number) {
    const span = lineOf(text, number)
    after[number] = after[number - 1]! + braceDelta(text.slice(span.from, span.to))
    before[number] = after[number - 1]!
  }
  const start = before[target]!
  let first = target
  let last = target
  if (after[target]! > start) {
    // 光标行自己开了一个块：吃掉它的收尾。
    for (let number = target; number <= count; ++number) if (after[number] === start) { last = number; break }
    if (last !== target) return { first, last }
    return { first, last }
  }
  if (start > 0) {
    for (let number = target; number >= 1; --number) {
      if (before[number] === start - 1 && after[number]! >= start) { first = number; break }
    }
    for (let number = target; number <= count; ++number) {
      if (after[number] === start - 1) { last = number; break }
    }
    if (first === target && last === target) return { first, last }
  }
  return { first, last }
}

/** 把 `text` 的第 `first`..`last` 行与相邻的一行整段对调（移动方向 `down` 时换的是下面那一行）。 */
export function moveStatementSpan(text: string, first: number, last: number, down: boolean): ChangeSpec | null {
  const block = lineOf(text, first)
  const neighbour = down ? last + 1 : first - 1
  const total = text.length === 0 ? 1 : text.split(/\r?\n/).length
  if (neighbour < 1 || neighbour > total) return null
  const other = lineOf(text, neighbour)
  const head = text.slice(block.from, block.to)
  const tail = text.slice(other.from, other.to)
  // 相邻那行是文件最后一行时没有换行符可搬，按行搬会粘行 —— 交给上/下一行去处理。
  if ((down && other.to >= text.length) || (!down && other.from === 0)) return null
  const insert = down ? `${head}\n${tail}` : `${tail}\n${head}`
  return { from: other.from, to: block.to, insert }
}

/** 语句上/下移（`MoveStatementUp` / `MoveStatementDown`）。到顶/到底时返回 false，不吞键。 */
export function moveStatement(down: boolean): Command {
  return (view: EditorView) => {
    if (view.state.readOnly) return false
    const { state } = view
    const text = state.doc.toString()
    const changes: ChangeSpec[] = []
    const ranges: ReturnType<typeof EditorSelection.range>[] = []
    for (const range of state.selection.ranges) {
      const { first, last } = statementLines(text, state.doc.lineAt(range.head).number)
      const span = moveStatementSpan(text, first, last, down)
      if (!span) return false
      const mapped = state.changes([span])
      ranges.push(EditorSelection.range(mapped.mapPos(range.anchor), mapped.mapPos(range.head)))
      changes.push(span)
    }
    if (!changes.length) return false
    view.dispatch({ changes, selection: EditorSelection.create(ranges, 0), scrollIntoView: true,
      userEvent: 'move.line' })
    return true
  }
}
