// Editor operations that CodeMirror does not ship: IDEA's Join Lines and Toggle
// Case, plus the single map the keymap AND the 编辑 menu both read from, so a menu
// entry can never point at something the keyboard does not do.
import {
  copyLineDown, deleteLine, indentLess, indentMore, moveLineDown, moveLineUp,
  redo, selectAll, undo,
} from '@codemirror/commands'
import { expandAllToLevel, expandCaretToLevel, foldAllCommand, foldAtCaret, foldBlockAtCaret, foldDocComments,
  foldRecursively, toggleFoldAtCaret, toggleFoldSelection, unfoldAllCommand, unfoldAtCaret, unfoldDocComments,
  unfoldRecursively } from './editorFolding.ts'
// 查找/替换**不在这个表里**：编辑器内查找栏是自绘的（src/editorSearch*.ts +
// src/editorFindController.ts），命令覆盖在 CodeEditor.vue 的 editorActions 里。
// 这里只剩多光标那一条 CodeMirror 命令。
import { selectMatches, selectNextOccurrence } from '@codemirror/search'
import { EditorSelection, type StateCommand } from '@codemirror/state'
import type { Command, EditorView } from '@codemirror/view'
// Unwrap/Remove（上游 Code 菜单的 `UnwrapAction`）：文本子集实现在 src/unwrap.ts。
import { unwrapCommand } from './unwrap.ts'
// 「完成当前语句」（上游 `EditorCompleteStatement`/`SmartEnterAction`）：文本子集在 src/smartEnter.ts。
import { completeStatement } from './smartEnter.ts'
// 注释切换（上游 `CommentByLineCommentHandler`/`CommentByBlockCommentHandler`）：文本子集在
// src/commentToggle.ts —— CodeMirror 自带的 `toggleLineComment`/`toggleBlockComment` 语义不同
// （空选区的块注释是空操作、取消注释不认"前缀 + 空格"、注释不按块内最小缩进对齐），所以换掉。
import { blockCommentCommand, commentStyleFromState, lineCommentCommand } from './commentToggle.ts'
// 扩展选区（IDEA Extend Selection 一族，含 `BlockCommentSelectioner` 那个块注释选择器）：
// 范围计算在 src/editorExtendSelection.ts。
import { extendSelection } from './editorExtendSelection.ts'
// 「高亮用法」（上游 `HighlightUsagesInFile` = Ctrl+Shift+F7，`$default.xml:362-364`）：
// 规则在 src/usageHighlight.ts，CodeMirror 层在 src/usageHighlightExtension.ts。
import { highlightUsagesCommand } from './usageHighlightExtension.ts'
// 注释里的合并行（上游 `CommentJoinLinesHandler`，注册在
// `intellij.platform.lang.impl.xml:1676`）：规则在 src/editorJoinComments.ts。
import { joinCommentLines } from './editorJoinComments.ts'
// 代码块首尾移动（上游 `EditorCodeBlockStart`/`EditorCodeBlockEnd` 与 ±WithSelection 两条，
// `$default.xml:569-571`/`:315-317`/`:318-320`/`:824-826`）：扫描在 src/editorCodeBlock.ts。
import { codeBlockTarget } from './editorCodeBlock.ts'
// 填充段落（上游 `FillParagraphAction`，只在纯文本那一档有效：
// `ParagraphFillHandler.java:208-210`）：规则在 src/editorFillParagraph.ts。
import { fillParagraphCommand } from './editorFillParagraph.ts'
// 移动到配对的括号（上游 `EditorMatchBrace` = `MatchBraceAction`，Ctrl+Shift+M，
// `intellij.platform.lang.impl.actions.xml:23` + `$default.xml:1146-1148`）：规则在 src/editorMatchBrace.ts。
// `editorLanguageId` 同一个文件里的语言档 facet：代码块导航的「结构支持」那一半按它问语言
// （上游那一侧读的是 PSI 叶子自己的 `getLanguage()`，`CodeBlockSupportHandler.java:62`，本仓的等价通道
// 就是这个 facet；读法与 `src/editorMatchBrace.ts:190` 同一处）。
import { editorLanguageId, matchBraceCommand } from './editorMatchBrace.ts'
// 用自定义折叠标记包围选区（上游 `CustomFoldingSurroundDescriptor`）：
// provider 表在 src/customFoldingProviders.ts，落地形状在 src/customFoldingSurround.ts。
import { customFoldingSurrounder, surroundWithRegion } from './customFoldingSurround.ts'
// 排序行 / 删除重复行 / 反串行（上游 `EditorSortLines`/`EditorUniqueLines`/`EditorReverseLines`，
// 三条共用 `AbstractPermuteLinesHandler` 那一段取行→写回的骨架）：规则在 src/editorLineOps.ts。
import { reverseLinesCommand, sortLinesCommand, uniqueLinesCommand } from './editorLineOps.ts'
// 克隆光标上/下（上游 `EditorCloneCaretAbove`/`EditorCloneCaretBelow`）：规则在 src/editorCaretClone.ts。
// 换掉 CodeMirror 自带的 `addCursorAbove`/`addCursorBelow` —— 那两条在「按反方向再按一次」时继续往外长，
// 上游 `CloneCaretActionHandler.java:76-81` 是收回最外圈；且它要真 EditorView（`view.moveVertically`），
// 纯函数版能在测试里跑。命令名 `cursor.above`/`cursor.below` 不变 ⇒ 冻结的键位表不用动。
import { cloneCaretAboveCommand, cloneCaretBelowCommand } from './editorCaretClone.ts'
// 在所选各行行尾加光标（上游 `EditorAddCaretPerSelectedLine`，AddCaretPerSelectedLineAction.java:22-54）：
// 规则在 src/editorCaretPerLine.ts（同族的上限常量 `MAX_CARET_COUNT` 也从那里复用，不写第二份）。
import { addCaretPerSelectedLineCommand } from './editorCaretPerLine.ts'

// StateCommand only needs {state, dispatch}, which an EditorView satisfies.
const fromState = (command: StateCommand): Command => view => command(view)

export const joinLinesCommand: Command = view => {
  const { state } = view
  // 注释那一档先问（上游 `CommentJoinLinesHandler`：吃掉第二行的 `//`、块注释每行开头的 `*`，
  // 并且不把合并后的行拉过右边距）。整段都是注释时它才接管，否则退回下面的普通粘连
  // （多光标的场合逐光标要各算一遍注释词法，上游那条委托是按单个光标写的 ⇒ 一律走普通粘连）。
  if (state.selection.ranges.length === 1) {
    const range = state.selection.main
    const style = commentStyleFromState(state, range.head)
    const joined = style && joinCommentLines(state.doc.toString(), range.from, range.to, style)
    if (joined) {
      view.dispatch({
        changes: { from: joined.from, to: joined.to, insert: joined.filled },
        selection: EditorSelection.cursor(joined.caret),
        userEvent: 'delete.join', scrollIntoView: true,
      })
      return true
    }
  }
  const edit = state.changeByRange(range => {
    const first = state.doc.lineAt(range.from)
    const endLine = range.empty ? first.number + 1 : state.doc.lineAt(range.to).number
    if (endLine > state.doc.lines || endLine <= first.number) return { range, effects: [] }
    let joined = first.text.trimEnd()
    for (let line = first.number + 1; line <= endLine; ++line) {
      const text = state.doc.line(line).text.trim()
      if (text) joined += (joined ? ' ' : '') + text
    }
    return {
      changes: { from: first.from, to: state.doc.line(endLine).to, insert: joined },
      range: EditorSelection.cursor(first.from + joined.length),
    }
  })
  // Nothing to join is not "handled": returning true here swallowed the key and made
  // CodeMirror skip every later binding for it.
  if (edit.changes.empty) return false
  view.dispatch(edit, { scrollIntoView: true, userEvent: 'delete.join' })
  return true
}

export const toggleCaseCommand: Command = view => {
  const changes: { from: number; to: number; insert: string }[] = []
  for (const range of view.state.selection.ranges) {
    const span = range.empty ? view.state.wordAt(range.head) : { from: range.from, to: range.to }
    if (!span || span.to <= span.from) continue
    const text = view.state.sliceDoc(span.from, span.to)
    const next = flipCase(text)
    if (next !== text) changes.push({ from: span.from, to: span.to, insert: next })
  }
  if (!changes.length) return false
  view.dispatch({ changes, userEvent: 'input.changeCase' })
  return true
}

// All-lower (or caseless) text goes up; anything with a capital goes down.
function flipCase(text: string) {
  return text === text.toLowerCase() ? text.toUpperCase() : text.toLowerCase()
}

// UnselectPreviousOccurrence = Alt+Shift+J（`$default.xml` 的 `UnselectPreviousOccurrence`）：
// 把**最后加进来的那个**光标/选区从多光标集合里摘掉（`RemoveOccurrenceAction.java:14` 的
// `ACTION_UNSELECT_PREVIOUS_OCCURENCE`）。本仓的 `selectNextOccurrence` 是往选区尾部追加，
// 所以"最后加进来的"就是 `ranges` 的最后一条 —— 只剩一条时返回 false（无对象可摘）。
export const unselectPreviousOccurrenceCommand: StateCommand = ({ state, dispatch }) => {
  if (state.selection.ranges.length <= 1) return false
  const ranges = state.selection.ranges.slice(0, -1)
  dispatch(state.update({ selection: EditorSelection.create(ranges, ranges.length - 1) }))
  return true
}

// 「完成当前语句」（`EditorCompleteStatement`，上游 Ctrl+Shift+Enter）：逐个光标补上当前行里
// 未闭合的圆/方/花括号（字符串与注释里的不算）和落单的块注释。纯规则在 src/smartEnter.ts，
// 这里只把「行内偏移」翻成文档坐标。没有任何一个光标有可补的东西时返回 false ——
// 菜单据此提示"没有可做的改动"，而不是吞掉这一下。
export const completeStatementCommand: Command = view => {
  const { state } = view
  const visited = new Set<number>()
  const edit = state.changeByRange(range => {
    const line = state.doc.lineAt(range.head)
    if (visited.has(line.number)) return { range, effects: [] }
    visited.add(line.number)
    const completion = completeStatement(line.text, range.head - line.from)
    if (!completion) return { range, effects: [] }
    return {
      changes: { from: line.from + completion.from, to: line.to, insert: completion.insert },
      range: EditorSelection.cursor(line.from + completion.from + completion.insert.length),
    }
  })
  if (edit.changes.empty) return false
  view.dispatch(edit, { scrollIntoView: true, userEvent: 'input.completeStatement' })
  return true
}

// 扩展选区（上游 Extend Selection：`SelectWordUtil.processElement` 驱动的那条
// `ExtendWordSelectionHandler` 扩展点链）。按下一次长一级，层级由内到外见
// `src/editorExtendSelection.ts` 的 `extendLevels`（词素 → 词 → 行注释链 → 块注释内容）。
// 长到头返回 false —— 不吞键，让后面的绑定还有机会。
// **键位不挂**：`$default.xml` 里没有 ExtendSelection 的绑定（详见那个模块头的第 5 条）。
const extendSelectionCommand = (forward: boolean): Command => view => {
  const range = view.state.selection.main
  const next = extendSelection({
    text: view.state.doc.toString(),
    head: range.head,
    current: { from: range.from, to: range.to },
    style: commentStyleFromState(view.state, range.head),
  }, forward)
  if (!next) return false
  view.dispatch({ selection: EditorSelection.range(next.from, next.to), userEvent: 'select' })
  return true
}

// 代码块首尾移动（上游 `CodeBlockStartAction.java:22-30` 的 `EditorActionHandler.ForEachCaret`
// ⇒ 每个光标各算一次；带 `Shift` 的那两条把「原来的 lead 偏移 → 落点」选上，
// `CodeBlockUtil.java:63-68`/`:100-105`）。认不出块的那个光标不动（上游 `:55`/`:92` 的 -1 分支）。
const codeBlockCommand = (forward: boolean, select: boolean): Command => view => {
  const { state } = view
  const text = state.doc.toString()
  let moved = false
  const ranges = state.selection.ranges.map(range => {
    const target = codeBlockTarget(text, range.head, forward, state.facet(editorLanguageId) ?? '')
    if (target === null || target < 0 || target > text.length) return range
    moved = true
    return select ? EditorSelection.range(range.head, target) : EditorSelection.cursor(target)
  })
  if (!moved) return false
  view.dispatch({
    selection: EditorSelection.create(ranges, state.selection.mainIndex),
    scrollIntoView: true, userEvent: 'select',
  })
  return true
}

// 用自定义折叠标记包围选区。上游这一项在 Ctrl+Alt+T 的「Surround With」列表里，
// **每个 provider 一行**（`CustomFoldingSurroundDescriptor.java:217-227`）；本仓那个列表在
// `src/surroundTemplates.ts`（别的桶名下）⇒ 这里先按本仓默认那一族标记落地
// （provider 表里 id 为空的那一条 `//<region>`，与 `src/surround.ts` 的「折叠区域」模板同一族），
// 列表侧的接线写在交接请求里。
const surroundRegionCommand: Command = (view: EditorView) => {
  const { state } = view
  if (state.readOnly) return false
  const range = state.selection.main
  if (range.empty) return false
  const item = customFoldingSurrounder('')
  const style = commentStyleFromState(state, range.head)
  if (!item || !style) return false
  const result = surroundWithRegion(state.doc.toString(), range.from, range.to, item.provider, style)
  if (!result) return false
  view.dispatch({
    changes: result.edits.map(edit => ({ from: edit.from, insert: edit.insert })),
    selection: { anchor: result.selection.from, head: result.selection.to },
    userEvent: 'input', scrollIntoView: true,
  })
  return true
}

// Names are the contract: the keymap, the 编辑/查找 menus and the offline test all
// address these commands by the same string.
export const editingCommands: Record<string, Command> = {
  undo, redo, selectAll,
  'line.duplicate': copyLineDown, 'line.delete': deleteLine, 'line.moveUp': moveLineUp, 'line.moveDown': moveLineDown,
  'line.join': joinLinesCommand, 'case.toggle': toggleCaseCommand,
  // 排序行 / 删除重复行 / 反串行（上游 `EditorSortLines`/`EditorUniqueLines`/`EditorReverseLines`）。
  // EditSmartGroup 里 Sort(:495) → Reverse(:496) 紧跟 FillParagraph(:494)；Unique 上游没有菜单行
  // （只在动作组 :240），本仓给它一行才有消费点，见 src/menus/editMenu.ts 的注释。
  'line.sort': sortLinesCommand, 'line.reverse': reverseLinesCommand, 'line.unique': uniqueLinesCommand,
  // 填充段落（上游 `EditSmartGroup` 里紧跟 `EditorJoinLines`/`EditorDuplicate` 的那一条，
  // `PlatformActions.xml:494`；`$default.xml` 没有它的键位 ⇒ 只有菜单/Find Action 到得了）。
  'paragraph.fill': fillParagraphCommand,
  // 代码块首尾（Ctrl+[ / Ctrl+] 与 ±Shift 两条，`$default.xml:569-571`/`:315-317`/`:318-320`/`:824-826`）。
  'block.start': codeBlockCommand(false, false), 'block.end': codeBlockCommand(true, false),
  'block.startSelect': codeBlockCommand(false, true), 'block.endSelect': codeBlockCommand(true, true),
  // 用自定义折叠标记包围选区（上游是 Surround With 列表里的一族，见 src/customFoldingSurround.ts 头部）。
  'fold.surroundRegion': surroundRegionCommand,
  // 完成当前语句（上游 Code 菜单 CodeCompletionGroup 里的 `EditorCompleteStatement`）。
  'statement.complete': completeStatementCommand,
  // Unwrap/Remove（Ctrl+Shift+Delete，$default.xml:917-920）：去掉最内层的 if/for/… 包裹。
  unwrap: unwrapCommand,
  // 克隆光标上/下（上游 `EditorCloneCaretAbove`/`EditorCloneCaretBelow`）：名字沿用仓里既有的两条，
  // 实现在 src/editorCaretClone.ts（语义按 CloneCaretActionHandler 的层级逻辑，不是 CodeMirror 那两条）。
  'cursor.above': cloneCaretAboveCommand, 'cursor.below': cloneCaretBelowCommand, 'occurrence.select': selectMatches,
  // 在所选各行行尾加光标（上游 `EditorAddCaretPerSelectedLine`，菜单位置 `PlatformActions.xml:485-487`
  // 紧跟 `$SelectAll`）。键位 `$default.xml:155-157` = `shift alt G` —— 键位面是保留文件 ⇒ 已提接线请求，
  // 菜单行先把这条命令接住（与 `line.sort` 一族同一做法），键位栏留空。
  'caret.perLine': addCaretPerSelectedLineCommand,
  // 扩展选区（含块注释智能选择器）。菜单行同名，见 src/menus/editMenu.ts。
  'selection.extend': extendSelectionCommand(true), 'selection.extendLeft': extendSelectionCommand(false),
  // 移动到配对的括号（上游 `EditorMatchBrace`，`$default.xml:1146-1148` 的 Ctrl+Shift+M）。
  // 键位还没进 keymap（保留文件 ⇒ 接线请求），菜单行先把这条命令接住，不放假控件。
  'brace.match': matchBraceCommand,
  // Ctrl+D belongs to "duplicate line" here (IDEA), so CM's own Mod-d binding is
  // replaced and "add next occurrence" moves to Alt+J (also IDEA's).
  'occurrence.next': fromState(selectNextOccurrence),
  // UnselectPreviousOccurrence = Alt+Shift+J（上面那个的逆动作）。
  'occurrence.unselect': fromState(unselectPreviousOccurrenceCommand),
  // 注释标记取自 CodeMirror 语言数据 `commentTokens`（见 src/commentToggle.ts 的模块头）。
  'comment.line': lineCommentCommand, 'comment.block': blockCommentCommand,
  // 高亮用法（临时高亮，Ctrl+Shift+F7）：与菜单行同名，见 src/menus/editMenu.ts。
  'usage.highlight': highlightUsagesCommand,
  // 收起/展开 = 上游 `CollapseRegion` / `ExpandRegion`（在 `src/editorFolding.ts` 里按
  // `CollapseRegionAction` / `ExpandRegionAction` 的挑法实现）；`foldAll`/`unfoldAll` 是本仓自己的
  // 那两条（`foldAllCommand` / `unfoldAllCommand`）：CodeMirror 自带的只有整篇版，
  // 上游 `BaseFoldingHandler.getFoldRegionsForSelection:43-58` 的「有选区就只作用于选区里那几条」
  // 要靠这一层，没有选区时才退回 CodeMirror 的整篇实现。
  fold: foldAtCaret, unfold: unfoldAtCaret, foldAll: foldAllCommand, unfoldAll: unfoldAllCommand,
  // B4（codeInsight/folding）那一族的其余命令：实现在 src/editorFolding.ts（纯逻辑 + 命令），
  // 名字与上游动作的对应写在那个模块头上，键位见 CodeEditor.vue 的 keymap。
  'fold.recursively': foldRecursively, 'unfold.recursively': unfoldRecursively,
  'fold.toggle': toggleFoldAtCaret, 'fold.block': foldBlockAtCaret,
  'fold.selection': toggleFoldSelection, 'fold.docs': foldDocComments, 'unfold.docs': unfoldDocComments,
  'unfold.level1': expandCaretToLevel(1), 'unfold.all.level1': expandAllToLevel(1),
  'unfold.level2': expandCaretToLevel(2), 'unfold.all.level2': expandAllToLevel(2),
  'unfold.level3': expandCaretToLevel(3), 'unfold.all.level3': expandAllToLevel(3),
  'unfold.level4': expandCaretToLevel(4), 'unfold.all.level4': expandAllToLevel(4),
  'unfold.level5': expandCaretToLevel(5), 'unfold.all.level5': expandAllToLevel(5),
  // IDEA's Code menu: 自动缩进 (Auto Indent, Ctrl+Alt+I) re-indents the selection
  // by one step per CodeMirror's indentUnit.
  'indent.selection': indentMore, 'indent.selection.less': indentLess,
  // 复制/剪切命令在 src/editorClipboard.ts（那里能 import 剪贴板通道而不污染本模块的零依赖）。
}

// 命令分派（编辑器组件只保留一行包装）：表里没有的名字返回 false，调用方据此提示"这个操作没做事"。
export function runEditorCommand(view: EditorView | undefined, table: Record<string, Command>, name: string): boolean {
  const run = table[name]
  return Boolean(view && run && run(view))
}
