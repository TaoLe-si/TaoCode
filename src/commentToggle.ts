// 注释切换 —— 上游 `codeInsight/generation` 的《注释》一族在本仓的文本落点。
//
// 对照源码：
//   · `CommentByLineCommentHandler.java` + `CommentByLineCommentAction`（编辑菜单「行注释」，
//     `$default.xml` 的 Ctrl+/）。判定与动作分散在 `invoke:72-147`（按选区定行区间，`:118-120`
//     选区末尾正好落在行首时不含最后一行）、`postInvoke:166-304`（三趟：先判"是不是全都注释了"，
//     再逐行注释/取消）、`doIndentCommenting:473-501`（注释插在**块内最小缩进**处）、
//     `doUncommentLine:562-604`（删前缀 + 一个后随空格；整行只剩空白时清空该行）。
//   · `CommentByBlockCommentHandler.java` + `CommentByBlockCommentAction`（Ctrl+Shift+/）：
//     选区正好被一对标记包住 → 拆掉（`invoke:119-135`）；空选区 → 插入 `prefix + "  " + suffix`
//     且光标落在两个空格之间（`:153-159`，`BLOCK_COMMENT_ADD_SPACE` 默认 true）；否则把选区
//     包进一对标记（`commentRange:409-463` 的普通分支，`:452-456` 前后各加一个空格）。
//   · Commenter 的语义（每种语言的行/块标记）本仓不搬 PSI 扩展点，改由 CodeMirror 的语言数据
//     `commentTokens`（`EditorState.languageDataAt('commentTokens')`）提供 —— 与上游
//     `LanguageCommenters.forLanguage` 是同一层"语言 → 注释词法"的查询；没有语言数据的文件
//     （语言未关联）与 IDEA 里没有 Commenter 的文件一样不可用。`commentStyleFor` 另给一张
//     扩展名表，供没有语言数据的调用方（如批量脚本）取同一套标记。
//
// **明确不做**（上游有、本子集没有，判词同点名）：嵌套注释的转义/重包与"会包住已有注释"的
// 警告（`CommentByBlockCommentHandler.insertNestedComments:523-626`、`breaksExistingComment:465-474`）；
// `SelfManagingCommenter`/`EscapingCommenter`/`CommenterWithLineSuffix` 三类扩展点（HTML 的
// `<!-- -->` 行后缀、字符串内转义）；`IndentedCommenter` 的逐语言缩进覆盖与"与上一行注释对齐"
// （`computeMinIndent:433-448` 的上一行分支）；文档注释 `/** */`（DocComment 是另一个动作）。
import { EditorSelection, type EditorState } from '@codemirror/state'
import type { Command } from '@codemirror/view'

/** 一门语言的注释词法（上游 `Commenter` 的两个 getter 的最小字段集）。 */
export interface CommentStyle {
  /** 行注释前缀，如 `//`、`#`、`--`。 */
  line?: string
  /** 块注释标记（开, 闭），如 `/*` / `*​/`。 */
  block?: [string, string]
  /** 行注释后是否补一个空格（`LINE_COMMENT_ADD_SPACE`，默认开）。 */
  lineSpace?: boolean
  /** 块注释标记内是否补空格（`BLOCK_COMMENT_ADD_SPACE`，默认开）。 */
  blockSpace?: boolean
}

// 扩展名/语言 id → 注释标记的只读表与 `commentStyleFor` 本体都在 `src/commentStyles.ts`（零 CodeMirror
// 依赖，好让 live-template 的 comment 宏也能复用同一份表而不把 `@codemirror/state` 拽进 templates 的
// 依赖图）。这里原样再导出，既有 consumer 的 `import { commentStyleFor } from './commentToggle.ts'` 不改。
export { commentStyleFor } from './commentStyles.ts'

export interface CommentEdit { from: number; to: number; insert: string }
export interface CommentOutcome {
  edits: CommentEdit[]
  /** 编辑**之后**坐标系里的新选区；缺省表示命令把原选区映射过去即可。 */
  selection?: { from: number; to: number }
}

interface DocLine { start: number; end: number }

/** 第 `index` 行（0 基）的区间；`end` 不含换行符。超界钳到文末。 */
function lineAt(text: string, index: number): DocLine {
  let start = 0
  for (let n = 0; n < index; ++n) {
    const next = text.indexOf('\n', start)
    if (next < 0) return { start: text.length, end: text.length }
    start = next + 1
  }
  const next = text.indexOf('\n', start)
  return { start, end: next < 0 ? text.length : next }
}

function lineIndexOf(text: string, offset: number): number {
  let line = 0
  for (let at = text.indexOf('\n'); at >= 0 && at < offset; at = text.indexOf('\n', at + 1)) ++line
  return line
}

/** 行首空白宽度（空格与制表符都算一个位置；上游按 TAB_SIZE 折算是另一处差异，见模块头）。 */
function leadingWidth(text: string, line: DocLine): number {
  let width = 0
  while (line.start + width < line.end) {
    const char = text[line.start + width]
    if (char !== ' ' && char !== '\t') break
    ++width
  }
  return width
}

/**
 * 行首（跳过空白后）是否已有行注释前缀；是则返回前缀的**行内偏移**，否则 -1。
 * 上游 `isLineCommented:366-407` 的 `regionMatches(lineStart, trimTrailing(prefix))` 一支。
 */
function commentPrefixOffset(text: string, line: DocLine, prefix: string): number {
  const at = line.start + leadingWidth(text, line)
  return text.startsWith(prefix, at) && at + prefix.length <= line.end ? at - line.start : -1
}

/** 把编辑按位置排序后套到文本上（测试与选区换算共用；编辑之间不允许重叠）。 */
export function applyCommentEdits(text: string, edits: readonly CommentEdit[]): string {
  const sorted = [...edits].sort((a, b) => a.from - b.from || a.to - b.to)
  let out = ''
  let at = 0
  for (const edit of sorted) {
    out += text.slice(at, edit.from) + edit.insert
    at = edit.to
  }
  return out + text.slice(at)
}

function shifted(text: string, edits: readonly CommentEdit[]): number {
  return edits.reduce((delta, edit) => delta + edit.insert.length - (edit.to - edit.from), 0)
}

/**
 * 行注释切换。语义逐条按 `CommentByLineCommentHandler`：
 * 选区定行（末尾落在行首不含该行）、"全都注释了"才取消、注释插在块内最小缩进处、
 * 取消时删前缀与一个后随空格、整行只剩空白时清空该行。
 */
export function toggleLineComment(text: string, from: number, to: number, style: CommentStyle): CommentOutcome | null {
  const prefix = style.line
  if (!prefix || text.length === 0) return null
  const addSpace = style.lineSpace !== false
  let startLine = lineIndexOf(text, Math.min(from, text.length))
  let endLine = lineIndexOf(text, Math.min(to, text.length))
  // 上游 :118-120：选区末尾正好落在行首时，最后一行不进选区。
  if (to > from && endLine > startLine && lineAt(text, endLine).start === to) --endLine
  const lines: DocLine[] = []
  for (let line = startLine; line <= endLine; ++line) lines.push(lineAt(text, line))
  const single = lines.length === 1

  const commented = lines.map(line => commentPrefixOffset(text, line, prefix))
  let allCommented = true
  let hasCommentedNonEmpty = false
  for (let index = 0; index < lines.length; ++index) {
    const empty = text.slice(lines[index]!.start, lines[index]!.end).trim() === ''
    if (commented[index]! >= 0 && !empty) hasCommentedNonEmpty = true
    if (allCommented && commented[index]! < 0 && (single || !empty)) allCommented = false
  }
  if (allCommented && !single && !hasCommentedNonEmpty) allCommented = false

  const edits: CommentEdit[] = []
  if (allCommented) {
    for (let index = 0; index < lines.length; ++index) {
      const line = lines[index]!
      const at = commented[index]!
      if (at < 0) continue
      let cut = line.start + at + prefix.length
      if (addSpace && text[cut] === ' ') ++cut
      // 行内只剩空白（或整行就是那条注释）：按上游把整行内容删空（缩进一起去掉）。
      const rest = text.slice(cut, line.end)
      if (rest.trim() === '') edits.push({ from: line.start, to: line.end, insert: '' })
      else edits.push({ from: line.start + at, to: cut, insert: '' })
    }
  } else {
    // 空行不参与最小缩进（`CommentUtil.getMinLineIndent:21-33` 跳过空行）；块内全空时取 0。
    const indents = lines.filter(line => text.slice(line.start, line.end).trim() !== '')
      .map(line => leadingWidth(text, line))
    const minIndent = indents.length ? Math.min(...indents) : 0
    for (const line of lines) {
      const width = leadingWidth(text, line)
      const at = line.start + Math.min(width, minIndent)
      const empty = text.slice(line.start, line.end).trim() === ''
      edits.push({ from: at, to: at, insert: empty ? prefix : prefix + (addSpace ? ' ' : '') })
    }
  }
  if (!edits.length) return null
  const outcome: CommentOutcome = { edits }
  if (from !== to) {
    const last = lines[lines.length - 1]!
    outcome.selection = { from: lines[0]!.start, to: last.end + shifted(text, edits) }
  }
  return outcome
}

/**
 * 块注释切换。三态照 `CommentByBlockCommentHandler.invoke`：正好包住 → 拆；
 * 空选区 → 插入一对标记并把光标放进中间；否则把选区包起来。
 */
export function toggleBlockComment(text: string, from: number, to: number, style: CommentStyle): CommentOutcome | null {
  const block = style.block
  if (!block || text.length === 0) return null
  const [open, close] = block
  const space = style.blockSpace !== false
  let start = Math.min(from, text.length)
  let end = Math.min(to, text.length)
  while (start < end && /\s/.test(text[start]!)) ++start
  while (end > start && /\s/.test(text[end - 1]!)) --end

  if (start < end && end - start >= open.length + close.length &&
      text.startsWith(open, start) && text.endsWith(close, end)) {
    let closeFrom = end - close.length
    if (space && text[closeFrom - 1] === ' ') --closeFrom
    let openTo = start + open.length
    if (space && text[openTo] === ' ') ++openTo
    const edits: CommentEdit[] = [
      { from: closeFrom, to: end, insert: '' },
      { from: start, to: openTo, insert: '' },
    ]
    return { edits, selection: { from: start, to: start + (closeFrom - openTo) } }
  }
  const openPart = open + (space ? ' ' : '')
  const closePart = (space ? ' ' : '') + close
  if (from === to) {
    const insert = open + (space ? '  ' : '') + close
    return {
      edits: [{ from: start, to: start, insert }],
      selection: { from: start + open.length + (space ? 1 : 0), to: start + open.length + (space ? 1 : 0) },
    }
  }
  return {
    edits: [
      { from: end, to: end, insert: closePart },
      { from: start, to: start, insert: openPart },
    ],
    selection: { from: start + openPart.length, to: end + openPart.length },
  }
}

// ── CodeMirror 命令 ───────────────────────────────────────────────────────────

/** 从语言数据取注释标记（`CommentTokens`，见 `@codemirror/commands` 的同名字段）。 */
export function commentStyleFromState(state: EditorState, pos: number): CommentStyle | null {
  const data = state.languageDataAt<{ line?: string; block?: { open: string; close: string } }>('commentTokens', pos, 1)
  for (const entry of data) {
    if (!entry) continue
    const style: CommentStyle = {}
    if (entry.line) style.line = entry.line
    if (entry.block?.open && entry.block.close) style.block = [entry.block.open, entry.block.close]
    if (style.line || style.block) return style
  }
  return null
}

function styleOf(state: EditorState, pos: number): CommentStyle | null {
  return commentStyleFromState(state, pos)
}


function runToggle(state: EditorState, toggle: typeof toggleLineComment, forceBlock: boolean): { changes: CommentEdit[]; selection: EditorSelection } | null {
  const seen = new Set<string>()
  const changes: CommentEdit[] = []
  const ranges: Array<ReturnType<typeof EditorSelection.range>> = []
  for (const range of state.selection.ranges) {
    const style = styleOf(state, range.head)
    if (!style || (forceBlock && !style.block)) return null
    const key = `${range.from}:${range.to}`
    if (seen.has(key)) continue
    seen.add(key)
    const outcome = toggle(state.doc.toString(), range.from, range.to, style)
    if (!outcome) return null
    const mapped = state.changes(outcome.edits)
    ranges.push(outcome.selection
      ? EditorSelection.range(outcome.selection.from, outcome.selection.to)
      : range.map(mapped))
    changes.push(...outcome.edits)
  }
  if (!changes.length) return null
  return { changes, selection: EditorSelection.create(ranges, 0) }
}

export const lineCommentCommand: Command = view => {
  const spec = runToggle(view.state, toggleLineComment, false)
  if (!spec) return false
  view.dispatch({ changes: spec.changes, selection: spec.selection, userEvent: 'input.comment' })
  return true
}

export const blockCommentCommand: Command = view => {
  const spec = runToggle(view.state, toggleBlockComment, true)
  if (!spec) return false
  view.dispatch({ changes: spec.changes, selection: spec.selection, userEvent: 'input.comment' })
  return true
}
