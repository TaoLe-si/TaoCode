// 拆行（上游 `EditorSplitLine` = Ctrl+Enter）—— 编辑器输入域，`SplitLineAction` 那条 `[~]` 的欠账。
//
// 判词原话（`docs/inventory/verdict-editor.md:2254`）：「还差：『拆完光标不移到下一行』这一条精确
// 语义与 `:38` 里对多光标的逐段处理没有单独成命令、也没配判据」。本模块把这两条补上：
// 纯算式 `splitLinePlan` + 命令 `splitLineCommand`，命令名 `line.split`（见 `src/editorCommands.ts`），
// 键位 Ctrl+Enter 挂在 `src/components/CodeEditor.vue` 的第一张 keymap（排在 basicSetup 之前）。
//
// 上游依据（逐行开文件核过）：
//  · `platform/platform-impl/src/com/intellij/openapi/editor/actions/SplitLineAction.java`
//    - `:22` `extends EditorAction`；`:30` 处理器是 `EditorWriteActionHandler.ForEachCaret`
//      ⇒ **每个光标各拆一刀**。
//    - `:50` `CharArrayUtil.containsOnlyWhiteSpaces(chars[lineStart, caret))`（空串也算「只有空白」，
//      所以光标停在本行第一列也走这一支）⇒ `:52-54` 把「那段空白 + 换行」**插到行首**、
//      `:55` `moveToOffset(offset)` 用的是**拆行之前的那个数值偏移** ⇒ 效果 = 在本行之上开一条
//      同样缩进的空行，光标留在那条空行的末尾。
//    - 其余场合：`:57-63` 打上 `SPLIT_LINE_KEY` 后**整刀委托给回车处理器**（`:71-73` 取
//      `IdeActions.ACTION_EDITOR_ENTER`），回来 `:65` 把光标 `moveToOffset(rangeMarker.getStartOffset())`
//      —— 回车在切点插了「换行 + 缩进」之后，**光标要回到切点**（留在前半段末尾，不跟到下一行）。
//      `:42` 那个 rangeMarker 是零宽标记，同一位置的插入不移动它 ⇒ 「回到原数值偏移」。
//  · 被委托的那条回车的默认档（delegate 全部 Continue 时）在
//    `platform/platform-impl/src/com/intellij/openapi/editor/actions/EnterAction.java`：
//    `:60` 先 `deleteSelectedText`，`:63-67` 插 `"\n" + text[lineStart, min(caret, 行首空白结束)]`
//    （光标在缩进里时只带到光标处，不在缩进里时带上整段缩进），`:68` 光标停在插入之后
//    —— 拆行这条把 `:68` 的结果又用 `SplitLineAction.java:65` 拽回切点。
//  · 键位 `platform/platform-resources/src/keymaps/$default.xml:959-961` = `control ENTER`。
//
// 与本仓架构有关的三处差别，照实记（都不是上游行为，别当成对齐）：
//  1. **单空光标**那一刀我们把整刀交给本仓的回车链（`smartEnterCommand`：注释续行、Java 的
//     `" + "` 切分、补 `}`、块注释闭尾四条都在里面），再把光标拽回切点 —— 与 `:57-65` 同构。
//     拽回用的是「原数值偏移夹到文档长度」：本仓四条分支要么在切点**处或之后**插入、要么删切点
//     **之后**的空白（`enter/EnterInLineCommentHandler.java:76-77`），都不会让切点自身漂移，
//     所以数值夹取与上游那个零宽 rangeMarker 同解。
//  2. **多光标 / 有选区**时本仓那条回车链整条不接管（`src/enterHandlers.ts` 的
//     `state.selection.ranges.length > 1 || !selection.empty` 那一行，理由写在上游 delegate 只按
//     单光标写），于是走本文件的纯算式 = `EnterAction.java:60-67` 的默认档逐光标版。
//     上游 `:38` 的 `ForEachCaret` 会**逐光标各问一次** delegate（`EnterAction` 那条 `[~]` 的
//     「多光标逐段」还挂着），这里不假装做了。
//  3. `:42` 的 rangeMarker 取的是 `getCaretModel().getOffset()`（主光标），多光标时上游会把每条
//     光标都往那一个偏移上搬；本仓按「每条回到自己那一刀的切点」实现。`:39` 的
//     `stopKillRings()` 本仓没有 kill ring；`:66` 的 `scrollToCaret(RELATIVE)` 由事务的
//     `scrollIntoView` 承担。
import { EditorSelection, type ChangeSpec, type Text } from '@codemirror/state'
import { insertNewlineAndIndent } from '@codemirror/commands'
import type { Command, EditorView } from '@codemirror/view'

/** 一条 range 拆完之后的落点（`heads` 与 `changes` 同序，都是文档坐标）。 */
export interface SplitLinePlan {
  changes: ChangeSpec[]
  heads: number[]
  /** 主光标的下标：正向选区那条排第一（上游 `:65` 的标记取的是主光标）。 */
  mainIndex: number
}

/** 上游 `CharArrayUtil.containsOnlyWhiteSpaces`：空区间也算「只有空白」。 */
export function onlySpaces(text: string, from: number, to: number): boolean {
  for (let at = from; at < to; ++at) if (text[at] !== ' ' && text[at] !== '\t') return false
  return true
}

/** `EnterAction.java:65-66` 的 `text[lineStart, min(caret, 行首空白结束)]`。 */
export function indentUpTo(text: string, lineStart: number, caret: number): string {
  let at = lineStart
  while (at < caret && (text[at] === ' ' || text[at] === '\t')) ++at
  return text.slice(lineStart, at)
}

/**
 * 逐光标算出「拆这一刀」的编辑与落点。
 *
 * 两条规则（对应上面记的 `SplitLineAction.java:50-67`）：
 *  · 空选区且切点前面只有空白 ⇒ 在**行首**插「那段空白 + 换行」，落点 = 切点（`:52-55`）；
 *  · 其余 ⇒ 删掉选区（`EnterAction.java:60`）并在切点插「换行 + 该行前导空白（最多到切点）」
 *    （`EnterAction.java:63-67`），落点 = 切点（`SplitLineAction.java:65`）。
 */
export function splitLinePlan(text: string, doc: Text, ranges: readonly { from: number; to: number }[], mainIndex = 0): SplitLinePlan {
  // 先按切点排序算出每一刀的净增减，再逐刀换算落点：CM 的 ranges 本来就互不重叠且升序。
  const changes: ChangeSpec[] = []
  const heads: number[] = []
  let shift = 0
  for (const range of ranges) {
    const cut = Math.min(range.from, range.to)
    const line = doc.lineAt(cut)
    const blankOnlyAhead = range.from === range.to && onlySpaces(text, line.from, cut)
    const insert = blankOnlyAhead ? `${text.slice(line.from, cut)}\n` : `\n${indentUpTo(text, line.from, cut)}`
    const at = blankOnlyAhead ? line.from : cut
    const to = blankOnlyAhead ? line.from : range.to
    changes.push({ from: at, to, insert })
    // 落点 = 切点 + **切点之前**那些刀子的净增减；本刀在切点处插入的不移动切点（`:65` 的零宽标记）。
    heads.push(cut + shift)
    shift += insert.length - (to - at)
  }
  return { changes, heads, mainIndex }
}

/**
 * `line.split`（Ctrl+Enter）：在光标处把本行拆成两行，**光标留在原地**。
 * 只读文档、以及回车链与默认档都动不了的场合返回 false（键位让给下一张 keymap）。
 */
export function splitLineCommand(enter: Command): Command {
  return (view: EditorView) => {
    const { state } = view
    if (state.readOnly) return false
    const ranges = state.selection.ranges
    const single = ranges.length === 1 && ranges[0]!.empty ? ranges[0]!.head : -1
    const line = single >= 0 ? state.doc.lineAt(single) : null
    // `:50-55` 那一支不问 delegate（上游也是自己直接动文档），单光标时在这里算；
    // 其余单光标场合整刀交给回车链（差别 1），多光标/有选区走纯算式的逐刀版（差别 2）。
    if (single >= 0 && line && !onlySpaces(state.doc.toString(), line.from, single)) {
      if (!(enter(view) || insertNewlineAndIndent(view))) return false
      view.dispatch({ selection: EditorSelection.cursor(Math.min(single, view.state.doc.length)), userEvent: 'input', scrollIntoView: true })
      return true
    }
    const plan = splitLinePlan(state.doc.toString(), state.doc, ranges, ranges.indexOf(state.selection.main))
    if (plan.heads.length === 0) return false
    view.dispatch({
      changes: plan.changes,
      selection: EditorSelection.create(plan.heads.map(offset => EditorSelection.cursor(offset)), Math.min(plan.mainIndex, plan.heads.length - 1)),
      userEvent: 'input', scrollIntoView: true,
    })
    return true
  }
}
