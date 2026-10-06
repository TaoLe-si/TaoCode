// 在所选各行行尾加光标（上游 `EditorAddCaretPerSelectedLine`）—— 多光标一族的第三条。
//
// 上游依据（逐个开文件核实过，行号是那一行本身）：
//  · 行为 `platform/platform-impl/src/com/intellij/openapi/editor/actions/AddCaretPerSelectedLineAction.java`
//    - `:22` 处理器是 `EditorActionHandler.ForEachCaret` ⇒ 每个已有光标各算一遍。
//    - `:27-30` 取这个光标的选区两端所在行（`getSelectionStart` / `getSelectionEnd`）。
//    - `:31` 选区尾**正好压在下一行行首**时，那一行不算（`endLine > startLine && selectionEnd ==
//      getLineStartOffset(endLine)` ⇒ `endLine--`）。
//    - `:33-36` 数量超过 `caretModel.getMaxCaretCount()` 就**不做事**；上限默认值
//      `editor.max.caret.count=1000` 在 `platform/util/resources/misc/registry.properties:484`
//      （本仓同一个数已经落在 `src/editorCaretClone.ts` 的 `MAX_CARET_COUNT`，这里复用，不写第二份）。
//    - `:40` `primary = caret.getOffset() != selectionStart` ⇒ 光标停在选区**尾**时新光标接管焦点。
//    - `:41-51` 从 startLine 到 endLine **每行的行尾**（`getLineEndOffset`，不含行分隔符）放一个光标。
//    - `:53` 最后删掉原来那个光标 ⇒ 结果是「一行一个、都在行尾」。
//  · 注册 `platform/platform-impl/resources/intellij.platform.ide.impl.actions.xml:358`。
//  · 菜单 `platform/platform-impl/resources/idea/PlatformActions.xml:485-487`
//    （EditMenu › `EditSelectGroup`，紧跟 `$SelectAll` 那一条）。
//  · 键位 `platform/platform-resources/src/keymaps/$default.xml:155-157` = `shift alt G`。
//  · 文案 `platform/platform-resources-en/src/messages/ActionsBundle.properties:130`
//    = `Add Carets to Ends of Selected Lines`。该 id 在同文件里**只有 `.text`、没有 `.description`**
//    （`grep -n EditorAddCaretPerSelectedLine` 只命中 :130 这一行）⇒ 菜单行不编描述文案。
//    本地参考树里没有随 IDE 发货的中文包 ⇒ 菜单标签是英文原文的直译。
//
// 三处与本仓架构有关的差别（如实记，都不是上游行为）：
//  1. `:44-48`「加新光标前先把原光标挪开」是因为 IDEA 在同一偏移已有光标时**拒绝**新增
//     （`platform/editor-ui-api/src/com/intellij/openapi/editor/CaretModel.java:236-241`
//     「Does nothing if … a caret already exists at specified location」）。CodeMirror 没有这条限制，
//     本仓是一次性换整个选区 ⇒ 不需要那个「挪开再挪回」的动作；但**同一偏移要去重**，
//     否则 `EditorSelection.create` 会因为区间重叠直接抛错。
//  2. `:33-36` 超限在上游只让**那一个光标**不做事（`ForEachCaret` 继续处理下一个），并弹一条 balloon
//     （`notifyMaxCarets`）。本仓的选区是**一次** dispatch ⇒ 超限就是整条不动作；
//     本仓也没有编辑器内 balloon 通道 ⇒ 静默，不编提示文案。
//  3. 上游 `EditorAction` 对只读/viewer 文档会把动作置灰；本仓这一条不改正文（只挪光标），
//     菜单行的可用条件由 `ctx.editable` 统一给 ⇒ 这里不加 `state.readOnly` 门，差异留在这里说明。

import { EditorSelection } from '@codemirror/state'
import type { Command } from '@codemirror/view'

import { MAX_CARET_COUNT, lineAt } from './editorCaretClone.ts'
import type { CloneRange } from './editorCaretClone.ts'

export interface CaretPerLineInput {
  /** 当前选区，**按文档顺序**（CodeMirror 的 `selection.ranges` 就是这个顺序）。 */
  ranges: CloneRange[]
  /** 每行的行首/行尾文档偏移（行尾不含换行），与 `src/editorCaretClone.ts` 同一套形状。 */
  lineStarts: number[]
  lineEnds: number[]
  maxCarets?: number
}

/** 新选区：一条一个光标 + 主光标下标。null = 什么都没发生（上游 `:33-36` 的不做事）。 */
export interface CaretPerLinePlan { ranges: CloneRange[]; mainIndex: number }

export function caretPerLinePlan(input: CaretPerLineInput): CaretPerLinePlan | null {
  const max = input.maxCarets ?? MAX_CARET_COUNT
  const points: { at: number, primary: boolean }[] = []
  for (const range of input.ranges) {
    const selectionStart = Math.min(range.anchor, range.head)          // :27
    const selectionEnd = Math.max(range.anchor, range.head)            // :29
    const startLine = lineAt(input.lineStarts, selectionStart)         // :28
    let endLine = lineAt(input.lineStarts, selectionEnd)               // :30
    // :31 选区尾正好压在行首 ⇒ 那一行不算。
    if (endLine > startLine && selectionEnd === input.lineStarts[endLine]) endLine -= 1
    // :40 光标停在选区尾（head != 起点）⇒ 新光标接管焦点。空选区时 head == 起点 ⇒ 不接管。
    const primary = range.head !== selectionStart
    // :41-51 每个选中行**在行尾**加一个光标。
    for (let line = startLine; line <= endLine; ++line) points.push({ at: input.lineEnds[line]!, primary })
  }
  if (!points.length) return null
  // 差别 1：同一偏移只留一个（两个相邻选区落在同一行时会撞点）。
  const kept: { at: number, primary: boolean }[] = []
  for (const point of points) {
    const previous = kept[kept.length - 1]
    if (previous && previous.at === point.at) { previous.primary = previous.primary || point.primary; continue }
    kept.push(point)
  }
  if (kept.length > max) return null                                   // :33-36（本仓整条不动作，见差别 2）
  // :53 原光标全部被换掉；焦点交给最后一个 primary 点（上游 `addCaret(pos, makePrimary)` 的逐个转焦点，
  // 最后一个接管的人就是 primary 链上最后加的那个）。一个 primary 都没有 ⇒ 退回第一条。
  const mainIndex = kept.reduce((last, point, index) => (point.primary ? index : last), 0)
  return { ranges: kept.map(point => ({ anchor: point.at, head: point.at })), mainIndex }
}

/** `EditorAddCaretPerSelectedLine`：命令表里的 `caret.perLine`（见 `src/editorCommands.ts`）。 */
export const addCaretPerSelectedLineCommand: Command = view => {
  const { state } = view
  const lineStarts: number[] = []
  const lineEnds: number[] = []
  for (let n = 1; n <= state.doc.lines; n++) {
    const line = state.doc.line(n)
    lineStarts.push(line.from)
    lineEnds.push(line.to)
  }
  const plan = caretPerLinePlan({
    ranges: state.selection.ranges.map(range => ({ anchor: range.anchor, head: range.head })),
    lineStarts, lineEnds,
  })
  if (!plan) return false
  view.dispatch({
    selection: EditorSelection.create(plan.ranges.map(range => EditorSelection.cursor(range.head)), plan.mainIndex),
    scrollIntoView: true, userEvent: 'select',
  })
  return true
}
