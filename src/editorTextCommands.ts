// 编辑器文本操作命令：复制整行 / 转置 / 交换选区边界 / 在当前行之前开始新行。
//
// 这四条上游都是**纯文本变换**（给定文本与选区 → 新文本与新选区），本模块照此把规则写成纯函数，
// 再把「CodeMirror 的 state → 纯函数 → dispatch」那几行接成 `Command`（与 src/editorLineOps.ts 同形状）。
// 零 Vue、零 DOM：只用 `@codemirror/state` 的 `EditorSelection` 与 `@codemirror/view` 的 `Command` 类型。
//
// 上游依据（逐条打开确认存在，行号是本地基准树的实测值）：
//  · 动作注册 `platform/platform-impl/resources/intellij.platform.ide.impl.actions.xml:221`
//    （`EditorSwapSelectionBoundaries`）· `:261`（`EditorDuplicateLines`）· `:283`
//    （`EditorStartNewLineBefore`）· `:284`（`EditorTranspose`）。
//  · 动作组（Find Action 够得到的那张表）`platform/platform-impl/resources/idea/PlatformActions.xml:202`
//    Swap · `:237` DuplicateLines · `:256` StartNewLineBefore · `:257` Transpose；
//    EditMenu 的 EditSmartGroup 里只有 `:493` `EditorDuplicate` 与 `:497` `EditorTranspose`
//    （DuplicateLines / Swap / StartNewLineBefore **没有** EditMenu 行）。
//  · 文案（英文原文）`platform/platform-resources-en/src/messages/ActionsBundle.properties:132`
//    `Swap Selection Boundaries` · `:172` `Duplicate Entire Lines` · `:227` `Start New Line Before Current`
//    · `:2698` `Transpose`。
//    中文取自随 IDE 发货的 `plugins/localization-zh/lib/localization-zh.jar` 里的
//    `messages/ActionsBundle.properties:688` 交换选区边界 · `:595` 重复整行 ·
//    `:680` 在当前行之前开始新行 · `:715` 转置（这四行是解包实测，不是直译）。
//  · 键位 `platform/platform-resources/src/keymaps/$default.xml:550-552` = `EditorStartNewLineBefore`
//    的 `control alt ENTER`（**唯一有出厂键位的一条**）；
//    `EditorTranspose` / `EditorSwapSelectionBoundaries` / `EditorDuplicateLines` 在 `$default.xml`
//    里**查无绑定**（全 `platform/platform-resources/src/keymaps/` 十张表里只有 `Emacs.xml:40-42` 给
//    Swap 绑过 `control X` `X`、`macOS System Shortcuts.xml:162` 给 Transpose 绑过 `ctrl T`，
//    都不是出厂默认；DuplicateLines 只有插件方案 `plugins/keymaps/*` 绑过）⇒ 本仓这三条不编加速键。
//  · 行为判据（上游自带测试，逐条对过）：`platform/platform-tests/testSrc/com/intellij/openapi/editor/actions/`
//    的 `EditorActionTest.java:329-342`（Swap 两条）· `:344-354`（DuplicateLines 两条）
//    `TransposeTest.kt:8-42`（Transpose 六条），以及
//    `platform/platform-tests/testSrc/com/intellij/codeInsight/PlainTextEditingTest.java:140-170`
//    （StartNewLineBefore）。本模块的测试按这些用例逐条复刻。
//
// 本模块**不重复**排序行 / 删除重复行 / 反串行（`EditorSortLines` / `EditorUniqueLines` /
// `EditorReverseLines`）：那三条本仓早已落在 `src/editorLineOps.ts`（`sortLinesCommand` 等），
// 侦察报告把它们列为缺口是**误报**，实测命令表与菜单行都在。

import { EditorSelection } from '@codemirror/state'
import type { Command } from '@codemirror/view'
// 行首表与「偏移 → 行号」复用 src/autoIndentLines.ts 里已有的两份实现，不写第二份。
import { lineAt, lineStarts } from './autoIndentLines.ts'

/** 文档偏移区间（半开）。 */
export interface TextRange { from: number; to: number }
/** 选区（`anchor`/`head` 与 CodeMirror 同口径；相等即光标）。 */
export interface TextSelection { anchor: number; head: number }
/** 一次编辑：把 `[from, to)` 换成 `insert`。 */
export interface TextEdit { from: number; to: number; insert: string }
/** 单光标命令的结果：新文本 + 新选区。 */
export interface TextCommandResult { text: string; selection: TextSelection }

/** 按 `from` 升序套用编辑（重叠的后者跳过 —— 上游逐光标就地改，这种输入本身未定义）。 */
export function applyEdits(text: string, edits: readonly TextEdit[]): string {
  const sorted = [...edits].sort((a, b) => a.from - b.from)
  let out = ''
  let at = 0
  for (const edit of sorted) {
    if (edit.from < at) continue
    out += text.slice(at, edit.from) + edit.insert
    at = edit.to
  }
  return out + text.slice(at)
}

/** 编辑两两不重叠（`CodeMirror` 一次事务里不接受重叠改动）。 */
export function editsAreDisjoint(edits: readonly TextEdit[]): boolean {
  const sorted = [...edits].sort((a, b) => a.from - b.from)
  for (let i = 1; i < sorted.length; i++) if (sorted[i].from < sorted[i - 1].to) return false
  return true
}

/**
 * 偏移是否压在某一行的行首 —— `platform/core-impl/src/com/intellij/util/DocumentUtil.java:103-105`
 * 的 `isAtLineStart`（`offset == getLineStartOffset(getLineNumber(offset))`）。
 */
export function isAtLineStart(text: string, starts: readonly number[], offset: number): boolean {
  if (offset < 0 || offset > text.length) return false
  return offset === starts[lineAt(starts, offset)]
}

/**
 * 覆盖 `[from, to]` 所在**整行**的区间：起 = 首行行首，止 = 末行的下一行行首（末行时到文末）。
 * 上游 `EditorUtil.calcSurroundingTextRange:590-594` → `calcSurroundingRange:631-680`
 * （无折叠时 `second` 就是「末行 + 1 行的行首」，越过文末则钳到 `textLength`，`:675-677`）。
 */
export function surroundingLinesRange(text: string, starts: readonly number[], from: number, to: number): TextRange {
  const firstLine = lineAt(starts, from)
  const lastLine = lineAt(starts, to)
  const nextLineStart = lastLine + 1 < starts.length ? starts[lastLine + 1] : text.length
  return { from: starts[firstLine], to: nextLineStart }
}

// ── ① 复制整行（`EditorDuplicateLines` = `DuplicateLinesAction.java:17,24,43`）──────────────
//
// `DuplicateLinesAction` 是 `EditorWriteActionHandler.ForEachCaret`（`:22`）且
// `reverseCaretOrder() = true`（`:43`）：**逐个光标各复制一次**，从文档靠后的光标先做。
//   · 有选区（`:25-35`）：`selEnd` 正好压在行首时先减一（`:28-30`），再把「选区覆盖的整行」
//     交给 `DuplicateAction.duplicateLinesRange`，最后把复制出来的那一块**重新选中**。
//   · 没有选区（`:36-39`）：把光标所在整行复制一份，光标停在复制行的行首。
// 复制本体 `platform/platform-impl/src/com/intellij/openapi/editor/actions/DuplicateAction.java:63-81`：
//   `:66-67` 取整行文本；`:68-69` 新光标 = 原光标 + 块长；`:71-75` **末行**（块不以 `\n` 收尾）时
//   在复制串前补一个 `\n`，光标与选区起点各 +1；`:76` 在块尾插入；`:80` 选区 = [起点, 块尾 + 串长)。

export interface DuplicateLinesPlan {
  /** 插入点（= 被复制块的块尾，`DuplicateAction.java:76`）。 */
  at: number
  /** 插入串（末行时前面补 `\n`，`:71-75`）。 */
  insert: string
  /** 无选区时的光标落点（`:78`）。 */
  caret: number
  /** 有选区时的重选区间（`:80`）；无选区时两端都等于 `caret`。 */
  selection: TextRange
}

/**
 * 复制整行的纯规则。`from`/`to` 是选区（相等 = 光标），`caretOffset` 是光标偏移
 * （上游 `caretModel.getOffset()`，`DuplicateAction.java:68`）。
 */
export function duplicateLinesPlan(
  text: string, starts: readonly number[], from: number, to: number, caretOffset: number,
): DuplicateLinesPlan {
  const hasSelection = from !== to
  let selStart = Math.min(from, to)
  let selEnd = Math.max(from, to)
  // `DuplicateLinesAction.java:28-30`：选区尾正好压在行首 ⇒ 把尾拉回一格（含住上一行那个换行）。
  if (hasSelection && selEnd > selStart && isAtLineStart(text, starts, selEnd)) selEnd--
  const block = surroundingLinesRange(text, starts, selStart, selEnd)
  let insert = text.slice(block.from, block.to)
  let caret = caretOffset + (block.to - block.from)
  let selectionStart = block.to
  if (!insert.endsWith('\n')) {
    // 末行没有换行符 ⇒ 复制串前补一个，让副本自成一行（`DuplicateAction.java:71-75`）。
    insert = `\n${insert}`
    caret++
    selectionStart++
  }
  return {
    at: block.to, insert, caret,
    selection: hasSelection ? { from: selectionStart, to: block.to + insert.length } : { from: caret, to: caret },
  }
}

/** 单选区版本的复制整行（新文本 + 新选区）。 */
export function duplicateLines(text: string, range: TextRange, caretOffset = range.to): TextCommandResult {
  const starts = lineStarts(text)
  const plan = duplicateLinesPlan(text, starts, range.from, range.to, caretOffset)
  const selection = plan.selection
  return {
    text: text.slice(0, plan.at) + plan.insert + text.slice(plan.at),
    selection: range.from === range.to
      ? { anchor: plan.caret, head: plan.caret }
      : { anchor: selection.from, head: selection.to },
  }
}

// ── ② 转置（`EditorTranspose` = `TransposeAction.kt:13`）────────────────────────────────────
//
// 两种模式（`TransposeAction.kt:16-21`）：**全部光标都无选区**时逐光标交换（`:23-53`）；
// **全部光标都有选区**时轮转选区内容（`:55-78`）；两者混合时**什么都不做**。
//   · 逐光标（`:27-53`）：光标在行中 ⇒ 交换光标左右两个码点并把光标推到右码点之后（`:32-40`）；
//     光标在行尾 ⇒ 交换**光标前**两个码点、光标**不动**（`:42-51`）；`offset == 0` 的光标跳过（`:29`）。
//   · 码点边界 `DocumentUtil.java:132-134`/`:141-143`（+ `isSurrogatePair:115-121`）⇒ 代理对整对交换。
//   · 轮转选区（`:59-77`）：按选区**尾降序**排；`rotateElements(true)`（`:80-87`）= 去掉首元素再接到末尾，
//     即第 k 个选区拿到第 k+1 个的文本、最后一个拿到第一个的；各自重选并落光标。
// 上游测试 `TransposeTest.kt:8-42` 六条逐条复刻在本模块的测试里。

/** 上一个码点起点（`DocumentUtil.java:132-134`）。 */
export function previousCodePointOffset(text: string, offset: number): number {
  return offset - (isSurrogatePair(text, offset - 2) ? 2 : 1)
}

/** 下一个码点终点（`DocumentUtil.java:141-143`）。 */
export function nextCodePointOffset(text: string, offset: number): number {
  return offset + (isSurrogatePair(text, offset) ? 2 : 1)
}

/** `DocumentUtil.java:115-121` 的 `isSurrogatePair`。 */
function isSurrogatePair(text: string, offset: number): boolean {
  if (offset < 0 || offset + 1 >= text.length) return false
  const high = text.charCodeAt(offset)
  const low = text.charCodeAt(offset + 1)
  return high >= 0xd800 && high <= 0xdbff && low >= 0xdc00 && low <= 0xdfff
}

export interface TransposeResult {
  text: string
  selections: TextSelection[]
  /** 非重叠编辑（重叠时退化成一条整篇替换，见 `editsAreDisjoint`）。 */
  edits: TextEdit[]
}

/** 逐光标交换（`TransposeAction.kt:27-53`）。返回 null = 一个光标都没得换（不吞键）。 */
export function transposeCarets(text: string, carets: readonly number[]): { text: string; carets: number[]; edits: TextEdit[] } | null {
  const starts = lineStarts(text)
  const edits: TextEdit[] = []
  const next: number[] = []
  for (const offset of carets) {
    if (offset === 0) { next.push(offset); continue }              // `:29`
    const lineEnd = lineEndOffset(text, starts, lineAt(starts, offset))
    if (offset < lineEnd) {
      const before = previousCodePointOffset(text, offset)          // `:33`
      const after = nextCodePointOffset(text, offset)               // `:34`
      if (before >= 0) {                                            // `:35`
        edits.push({ from: before, to: after, insert: text.slice(offset, after) + text.slice(before, offset) })
        next.push(after)                                            // `:39` 光标推到右码点之后
        continue
      }
      next.push(offset)
      continue
    }
    // 行尾：换光标前两个码点，光标不动（`:42-51`）。
    const before = previousCodePointOffset(text, offset)
    const before2 = previousCodePointOffset(text, before)
    if (before2 >= 0) {
      edits.push({ from: before2, to: offset, insert: text.slice(before, offset) + text.slice(before2, before) })
    }
    next.push(offset)
  }
  if (!edits.length) return null
  return { text: applyEdits(text, edits), carets: next, edits }
}

/** 轮转选区内容（`TransposeAction.kt:55-78`）。返回 null = 少于两个选区（`:60`）。 */
export function rotateSelections(
  text: string, ranges: readonly TextRange[],
): { text: string; selections: TextRange[]; edits: TextEdit[] } | null {
  if (ranges.length <= 1) return null
  // `:63-64` 按选区尾降序；`:66-68` 取文本后 rotateElements(!false) = 去首接尾。
  const order = ranges.map((_, index) => index).sort((a, b) => ranges[b].to - ranges[a].to)
  const texts = order.map(index => text.slice(ranges[index].from, ranges[index].to))
  const rotated = [...texts.slice(1), texts[0]]
  const edits: TextEdit[] = []
  const selections: TextRange[] = new Array(ranges.length)
  order.forEach((index, slot) => {
    const range = ranges[index]
    const insert = rotated[slot]
    edits.push({ from: range.from, to: range.to, insert })
    // `:74-76` 重选新文本并把光标落到选区尾。
    selections[index] = { from: range.from, to: range.from + insert.length }
  })
  return { text: applyEdits(text, edits), selections, edits }
}

/** 转置的分派：全无选区 ⇒ 逐光标；全有选区 ⇒ 轮转；混合或无光标 ⇒ null。 */
export function transpose(text: string, ranges: readonly TextSelection[]): TransposeResult | null {
  if (!ranges.length) return null
  if (ranges.every(range => range.anchor === range.head)) {
    const swapped = transposeCarets(text, ranges.map(range => range.head))
    if (!swapped) return null
    // 逐光标那条按码点边界交换，编辑天然不重叠；重叠时退化成一条整篇替换（CodeMirror 不接受重叠改动）。
    return {
      text: swapped.text,
      selections: swapped.carets.map(offset => ({ anchor: offset, head: offset })),
      edits: editsAreDisjoint(swapped.edits) ? swapped.edits : [{ from: 0, to: text.length, insert: swapped.text }],
    }
  }
  if (ranges.every(range => range.anchor !== range.head)) {
    const rotated = rotateSelections(text, ranges.map(range => ({ from: Math.min(range.anchor, range.head), to: Math.max(range.anchor, range.head) })))
    if (!rotated) return null
    return {
      text: rotated.text,
      selections: rotated.selections.map(range => ({ anchor: range.from, head: range.to })),
      edits: editsAreDisjoint(rotated.edits) ? rotated.edits : [{ from: 0, to: text.length, insert: rotated.text }],
    }
  }
  return null
}

/** 一行行尾偏移（行尾 = 该行文本结束处，不含换行符）。 */
function lineEndOffset(text: string, starts: readonly number[], line: number): number {
  const next = line + 1 < starts.length ? starts[line + 1] : text.length
  return next > starts[line] && text[next - 1] === '\n' ? next - 1 : next
}

// ── ③ 交换选区边界（`EditorSwapSelectionBoundaries` = `SwapSelectionBoundariesAction.java:18,26`）─
//
// `EditorActionHandler.ForEachCaret`（`:24`）：没有选区就**什么都不做**（`:27-29`）；否则
// `moveToEnd = caret.getOffset() == selectionStart`（`:32`）—— 光标在**起点**就把光标挪到终点，
// 在终点就挪到起点（`:41-46`）。等价于把 `anchor`/`head` 对调。
// `:34-39` 的粘性选区（sticky selection）开合是**编辑器级状态**，本仓没有那个模型 ⇒ 不做（见回复）。
// 上游测试 `EditorActionTest.java:329-334`：`a<selection>b<caret></selection>c` → 光标落到 b 之前。

/** 对调 `anchor`/`head`；空选区返回 null（上游 `:27-29` 不动）。 */
export function swapSelectionBoundaries(range: TextSelection): TextSelection | null {
  if (range.anchor === range.head) return null
  return { anchor: range.head, head: range.anchor }
}

// ── ④ 在当前行之前开始新行（`EditorStartNewLineBefore` = `StartNewLineBeforeAction.java:17,25`）─
//
// `ForEachCaret`（`:23`）：先 `removeSelection`（`:31`），把光标移到当前行行首（`:34-35`），
// 执行 `EditorEnter`（`:36`），再回到（原）行的行首（`:37`），最后执行「移到行尾」（`:38`）。
// `EditorEnter` 的落点由 `EnterAction.insertNewLineAtCaret`（`EnterAction.java:43-71`）决定：
// `:64-67` 插的是 `"\n" + 行首到 min(光标, 前导空白末) 的子串`。光标已在行首 ⇒ 那截子串为空
// ⇒ 只插一个 `"\n"`；`getLineStartOffset(line)` 落在**新插入的空行**行首，`MOVE_LINE_END` 又把它
// 推到该空行行尾（空行 ⇒ 同一偏移）。净效果：当前行之前多一个空行，光标停在这个空行上。
// 上游测试 `PlainTextEditingTest.java:140-170`（纯文本档就是这一条）。

/** 在当前行之前插入一个空行；选区先被清掉（`StartNewLineBeforeAction.java:31`）。 */
export function startNewLineBefore(text: string, offset: number): TextCommandResult {
  const starts = lineStarts(text)
  const lineStart = starts[lineAt(starts, offset)]
  return {
    text: `${text.slice(0, lineStart)}\n${text.slice(lineStart)}`,
    selection: { anchor: lineStart, head: lineStart },
  }
}

// ── CodeMirror 命令（宿主接线用；`run` 的返回 false = 没做事，菜单据此提示）────────────────

/** 复制整行（`EditorDuplicateLines`）。逐个选区各复制一次。 */
export const duplicateLinesCommand: Command = view => {
  const { state } = view
  if (state.readOnly) return false
  const text = state.doc.toString()
  const starts = lineStarts(text)
  let handled = false
  const spec = state.changeByRange(range => {
    const plan = duplicateLinesPlan(text, starts, range.from, range.to, range.head)
    handled = true
    return {
      changes: { from: plan.at, insert: plan.insert },
      range: EditorSelection.range(plan.selection.from, plan.selection.to),
    }
  })
  if (!handled || spec.changes.empty) return false
  view.dispatch(spec, { scrollIntoView: true, userEvent: 'input.duplicateLines' })
  return true
}

/** 转置（`EditorTranspose`）。 */
export const transposeCommand: Command = view => {
  const { state } = view
  if (state.readOnly) return false
  const result = transpose(state.doc.toString(), state.selection.ranges.map(range => ({ anchor: range.anchor, head: range.head })))
  if (!result) return false
  view.dispatch({
    changes: result.edits,
    selection: EditorSelection.create(
      result.selections.map(selection => EditorSelection.range(selection.anchor, selection.head)),
      state.selection.mainIndex,
    ),
    userEvent: 'input.transpose', scrollIntoView: true,
  })
  return true
}

/** 交换选区边界（`EditorSwapSelectionBoundaries`）。 */
export const swapSelectionBoundariesCommand: Command = view => {
  const { state } = view
  let handled = false
  const ranges = state.selection.ranges.map(range => {
    const swapped = swapSelectionBoundaries({ anchor: range.anchor, head: range.head })
    if (!swapped) return EditorSelection.cursor(range.head)
    handled = true
    return EditorSelection.range(swapped.anchor, swapped.head)
  })
  if (!handled) return false
  view.dispatch({ selection: EditorSelection.create(ranges, state.selection.mainIndex), userEvent: 'select' })
  return true
}

/** 在当前行之前开始新行（`EditorStartNewLineBefore`）。 */
export const startNewLineBeforeCommand: Command = view => {
  const { state } = view
  if (state.readOnly) return false
  const starts = lineStarts(state.doc.toString())
  let handled = false
  const spec = state.changeByRange(range => {
    const lineStart = starts[lineAt(starts, range.head)]
    handled = true
    return { changes: { from: lineStart, insert: '\n' }, range: EditorSelection.cursor(lineStart) }
  })
  if (!handled || spec.changes.empty) return false
  view.dispatch(spec, { scrollIntoView: true, userEvent: 'input.startNewLineBefore' })
  return true
}
