// 行操作一族：排序行 / 删除重复行 / 反串行。
//
// 上游三个动作都只是 `AbstractPermuteLinesHandler` 的一个 `permute(String[])` 实现，
// 所以本模块把「取哪几行 → 取出这些行 → 置换 → 写回 → 光标/选区怎么放」这一整段照抄，
// 再把三条置换规则各写成一条纯函数（可单测，不需要 CodeMirror）。
//
// 上游依据（逐条）：
//  · 动作注册 `platform/platform-impl/resources/intellij.platform.ide.impl.actions.xml:262-264`
//    （`EditorSortLines` / `EditorReverseLines` / `EditorUniqueLines` 三条，类都在
//    `com.intellij.openapi.editor.actions` 包里）。
//  · 菜单/动作组次序 `platform/platform-impl/resources/idea/PlatformActions.xml:238-240`（动作组）
//    与 `:491-502`（EditMenu › EditSmartGroup：ToggleCase → JoinLines → Duplicate → FillParagraph →
//    **SortLines → ReverseLines** → Transpose → 分隔 → UnindentSelection）。
//    `EditorUniqueLines` 在 EditSmartGroup 里**没有**行，只挂在 :240 那个动作组里。
//  · 文案 `platform/platform-resources-en/src/messages/ActionsBundle.properties:173-175`
//    （`Sort Lines` / `Reverse Lines` / `Delete Duplicate Lines`）。
//    本地参考树里没有随 IDE 发货的中文包（`plugins/localization-zh` 不在 community 源里）⇒
//    菜单行的中文是这三条英文的直译，不假称取自某个中文行号。
//  · 键位：`platform/platform-resources/src/keymaps/$default.xml` 里**查不到**这三条的绑定
//    （全树只有 `platform/platform-resources/src/keymaps/Sublime Text.xml:105` 给 `EditorSortLines` 绑过键）
//    ⇒ 菜单行的键位栏留空，等 `$default.xml` 那一族真的进了本仓键位表再填。
//  · 算法本体 `platform/platform-impl/src/com/intellij/openapi/editor/actions/AbstractPermuteLinesHandler.java:18-101`：
//      - `:88-98` `getTargetLineRange`：**有选区**取选区覆盖的行（选区尾正好压在行首时不算那一行），
//        **没有选区取整篇文档**（`startOffset=0`、`endOffset=textLength`）；不足两行返回 null ⇒ 动作不可用。
//      - `:26` 只用主光标（`getPrimaryCaret`），不是 ForEachCaret ⇒ 多光标时也只置换一次。
//      - `:36-39` 取出的是「行首 → 行尾」，**不含行分隔符**。
//      - `:64-67` 用 `String.join("\n", …)` 写回 ⇒ 分隔符固定按换行重排；`:51-64` 被标成 null 的行直接消失。
//      - `:71` 替换区间 = 起始行的行首 → 结束行的行尾（结束行后面那个换行不动）。
//      - `:72-76` 有选区 ⇒ 结果整块重新选中（尾到「块的下一行行首」，块是最后一块时到文档末尾）。
//      - `:77-84` 无选区 ⇒ 光标**跟着原来那一行走**（按对象同一性在置换后的数组里找它），并保持行内列偏移。
//  · 三条置换规则：
//      - 排序 `platform/platform-impl/src/com/intellij/openapi/editor/actions/SortLinesAction.java:14`
//        `Arrays.parallelSort(lines)` = 字符串自然序（`String.compareTo`，按 UTF-16 码元比，**大小写敏感**、
//        不 trim、不区分区域设置；对象数组的 parallelSort 是归并排序 ⇒ 等值行保持原相对次序）。
//        JS 的 `<`/`>` 与 `Array#sort` 默认排序同样按 UTF-16 码元 ⇒ 用显式比较器等价。
//      - 去重 `…/UniqueLinesAction.java:13-18` `HashSet`：逐行 `set.add`，加不进去的置 null
//        ⇒ **保留首次出现、保持原顺序、不排序**，比较是大小写/空白敏感的整行相等。
//      - 反串 `…/ReverseLinesAction.java:11-19` 首尾两两交换 ⇒ 整段倒序（奇数行长不变）。

import { EditorSelection } from '@codemirror/state'
import type { Command } from '@codemirror/view'

/** 一行的 0 基行号区间（含两端），对应上游 `Couple<Integer>`。 */
export interface PermuteRange { startLine: number; endLine: number }

/** 置换结果：新的行数组 + 每一行来自入参的第几行（下标与 `lines` 对齐）。 */
export interface Permutation { lines: string[]; sources: number[] }

/** 行内偏移 → 0 基行号：`lineStarts` 是每行行首的文档偏移（升序）。 */
export function lineIndexOf(lineStarts: number[], offset: number): number {
  let low = 0
  let high = lineStarts.length - 1
  while (low < high) {
    const mid = (low + high + 1) >> 1
    if (lineStarts[mid] <= offset) low = mid
    else high = mid - 1
  }
  return low
}

/**
 * 上游 `AbstractPermuteLinesHandler.getTargetLineRange:88-98`。
 * 没有选区 ⇒ 整篇文档；不足两行 ⇒ null（动作 disable，命令据此返回 false 不吞键）。
 */
export function permuteTargetRange(input: {
  hasSelection: boolean
  /** 选区的 `getSelectionStart()`（已是小偏移）。 */
  selFrom: number
  /** 选区的 `getSelectionEnd()`。 */
  selTo: number
  lineStarts: number[]
  textLength: number
}): PermuteRange | null {
  const startOffset = input.hasSelection ? input.selFrom : 0
  const endOffset = input.hasSelection ? input.selTo : input.textLength
  let startLine = lineIndexOf(input.lineStarts, startOffset)
  let endLine = lineIndexOf(input.lineStarts, endOffset)
  // `:94-96` 选区尾正好压在某一行的行首 ⇒ 那一行没被选到，不算进来。
  if (endOffset === input.lineStarts[endLine]) endLine--
  startLine = Math.max(0, startLine)
  endLine = Math.min(input.lineStarts.length - 1, endLine)
  return startLine < endLine ? { startLine, endLine } : null
}

/** Java `String.compareTo` 的等价物：按 UTF-16 码元比，大小写敏感（`SortLinesAction.java:14`）。 */
export function compareLinesNatural(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0
}

/** 排序行（`SortLinesAction.java:14`）。等值行保持原次序：`Array#sort` 自 ES2019 起是稳定排序。 */
export function sortPermutation(lines: string[]): Permutation {
  const order = lines.map((line, index) => ({ line, index }))
  order.sort((a, b) => compareLinesNatural(a.line, b.line) || a.index - b.index)
  return { lines: order.map(item => item.line), sources: order.map(item => item.index) }
}

/** 删除重复行（`UniqueLinesAction.java:13-18`）：整行相等才算重复，保序、留第一次出现、不排序。 */
export function uniquePermutation(lines: string[]): Permutation {
  const seen = new Set<string>()
  const out: Permutation = { lines: [], sources: [] }
  lines.forEach((line, index) => {
    if (seen.has(line)) return
    seen.add(line)
    out.lines.push(line)
    out.sources.push(index)
  })
  return out
}

/** 反串行（`ReverseLinesAction.java:11-19`）。 */
export function reversePermutation(lines: string[]): Permutation {
  const out: Permutation = { lines: [], sources: [] }
  for (let i = lines.length - 1; i >= 0; i--) {
    out.lines.push(lines[i])
    out.sources.push(i)
  }
  return out
}

/** 一次置换需要的全部输入（纯数据，测试里不用造假文档）。 */
export interface PermuteInput {
  lines: string[]
  /** 块内每一行的行首文档偏移（与 `lines` 对齐）。 */
  starts: number[]
  /** 块最后一行的行尾文档偏移（替换区间的右端点，`:70`）。 */
  blockEnd: number
  /** 写回前的文档长度。 */
  textLength: number
  /** 块后面还有没有行（上游 `:73` 的那两个分支）。 */
  hasLineAfter: boolean
  /** 无选区时光标所在的块内行号（0 基）与行内列偏移；有选区时传 null。 */
  caret: { line: number; column: number } | null
}

/** 置换后应落到哪（文档坐标）。 */
export interface PermutePlacement {
  insert: string
  /** 有选区：anchor/head 把整块选中；无选区：两者同值 = 光标跟行走。 */
  anchor: number
  head: number
}

/**
 * 上游 `executeWriteAction:32-85` 的纯函数版本：算出新文本与落点，不碰文档。
 * 落点口径见文件头 `:72-76`（有选区，整块重选）与 `:77-84`（无选区，光标跟着原来那一行走）。
 */
export function placePermutation(input: PermuteInput, perm: Permutation): PermutePlacement {
  const inserted = perm.lines.join('\n')
  const blockStart = input.starts[0]
  const written = input.textLength - (input.blockEnd - blockStart) + inserted.length
  // 块后面还有行 ⇒ 选区尾 = 块的下一行行首（替换区间不含结束行的换行，所以是 +1）；否则到文档末尾。
  const afterBlock = input.hasLineAfter ? blockStart + inserted.length + 1 : written
  if (input.caret === null) return { insert: inserted, anchor: blockStart, head: afterBlock }
  // 无选区：在置换后的数组里找回原来那一行（上游比的是同一个 String 对象 ⇒ 这里比来源下标），
  // 找到就落在它的新行首 + 原列偏移上；被去重删掉了就找不到（上游那一支同样不动光标）。
  const slot = perm.sources.indexOf(input.caret.line)
  if (slot < 0) return { insert: inserted, anchor: afterBlock, head: afterBlock }
  let offsetInBlock = 0
  for (let i = 0; i < slot; i++) offsetInBlock += perm.lines[i].length + 1
  const caret = Math.min(blockStart + offsetInBlock + input.caret.column, written)
  return { insert: inserted, anchor: caret, head: caret }
}

/** 三条命令共用的执行体（`AbstractPermuteLinesHandler` 的 doExecute）。 */
const permuteLines = (permute: (lines: string[]) => Permutation): Command => view => {
  const { state } = view
  if (state.readOnly) return false
  const doc = state.doc
  const lineStarts: number[] = []
  for (let n = 1; n <= doc.lines; n++) lineStarts.push(doc.line(n).from)
  const range = state.selection.main
  const target = permuteTargetRange({
    hasSelection: !range.empty, selFrom: range.from, selTo: range.to,
    lineStarts, textLength: doc.length,
  })
  if (!target) return false
  const lines: string[] = []
  const starts: number[] = []
  for (let line = target.startLine; line <= target.endLine; line++) {
    const info = doc.line(line + 1)
    lines.push(info.text)
    starts.push(info.from)
  }
  const blockEnd = doc.line(target.endLine + 1).to
  const caretLine = lineIndexOf(lineStarts, range.head)
  const placement = placePermutation({
    lines, starts, blockEnd, textLength: doc.length,
    hasLineAfter: target.endLine + 1 < doc.lines,
    caret: range.empty ? { line: caretLine - target.startLine, column: range.head - lineStarts[caretLine] } : null,
  }, permute(lines))
  view.dispatch({
    changes: { from: starts[0], to: blockEnd, insert: placement.insert },
    selection: EditorSelection.range(placement.anchor, placement.head),
    userEvent: 'input.permuteLines', scrollIntoView: true,
  })
  return true
}

export const sortLinesCommand = permuteLines(sortPermutation)
export const uniqueLinesCommand = permuteLines(uniquePermutation)
export const reverseLinesCommand = permuteLines(reversePermutation)
