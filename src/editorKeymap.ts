// 编辑器**动作表 + 常驻键位表**（CodeEditor.vue 的装配侧搬出来的两段）。
//
// 为什么单独成模块（2026-10-06）：`src/components/CodeEditor.vue` 顶着
// `tests/module-size.test.mjs` 的登记上限（1147，**只许降不许抬**）。本文件是它的第 N 次
// "拆一次降一次"——被搬走的是两段**表**：菜单动作表（`editorActions`，一个动作一个函数）
// 与常驻 keymap（`editorKeymap`，键位 → 同一个函数）。它们与 CodeMirror 的生命周期
// （onMounted / watch / 扩展组装）不共一个职责域：前者是"有哪些命令、键位是什么"，
// 后者是"编辑器什么时候建、什么时候重配"。既有先例同属一条纪律（`src/editorCommands.ts`
// 的 `editingCommands`/`foldingKeymap`、`src/editorTheme.ts` 的选项扩展）。
//
// 口径：**搬动时实现一个字没改**。键位注释、上游 `$default.xml` 的行号引用、每一条
// "为什么不绑"的判决全部逐字随行搬过来 —— 那些注释就是这些键位的真源，拆表不能顺手
// 把它们丢在原文件里（丢了以后没人知道 `Ctrl--` 为什么这么写）。
//
// 依赖注入的形状：宿主把 14 个**只在本文件里存在**的闭包（`openFindBar` / `findCommand` /
// `findBar` / `quickDefinitionCommand` / `adjustSelection` / `emitSemantic` / `emitEvaluate` /
// `expandTemplate` / `columnSelection.toggle` / `lastEditLocation` / `toggleOverwrite` /
// `goToError` / `revealDefinition` / `copyToClipboard`）交进来；表本身不认识 props、view、
// emit，所以它可以被单测直接加载（见 `tests/editor-keymap-table.test.mjs`）。

import type { Command, KeyBinding } from '@codemirror/view'
import type { EditorView } from '@codemirror/view'
import { startCompletion } from '@codemirror/autocomplete'
import { indentLess, indentMore } from '@codemirror/commands'
import { EditorSelection } from '@codemirror/state'
import { editingCommands, foldingKeymap } from './editorCommands.ts'
import { clipboardCommands, type RichCopySink, type RichHtmlProducer } from './editorClipboard.ts'

/** 本模块需要的宿主闭包（全部由 CodeEditor.vue 在装配期提供）。 */
export interface EditorCommandDeps {
  /** 打开编辑器内查找栏（`false` = 查找、`true` = 替换）。 */
  openFindBar: (replaceMode: boolean) => void
  /** 查找栏的上一条/下一条（`backwards` 为真时向上）。 */
  findCommand: (backwards: boolean) => Command
  /** 查找栏控制器（`wordAtCaret` / `toggleInSelection` 三个动作要用）。 */
  findBar: { findWordAtCaret: (backwards: boolean) => boolean; toggleInSelection: () => void }
  /** 「快速定义」命令（QuickImplementations）。 */
  quickDefinitionCommand: Command
  /** 扩大/缩小选区（`SelectionRange` 链）。 */
  adjustSelection: (grow: boolean) => boolean
  /** LSP 语义动作（重命名/引用/代码操作/格式化/签名/实现/调用层次/类型层次/类型声明）。 */
  emitSemantic: (kind: 'rename' | 'references' | 'codeAction' | 'format' | 'signature' | 'implementation' | 'callHierarchy' | 'typeHierarchy' | 'typeDefinition') => Command
  /** 「求值表达式」（选区优先，否则光标下的词）。 */
  emitEvaluate: Command
  /** 展开实时模板。 */
  expandTemplate: (editor: EditorView) => boolean
  /** 切换列选择模式。 */
  toggleColumnSelection: () => boolean
  /** 跳回上一次编辑位置（Ctrl+Shift+Backspace）。 */
  lastEditLocation: (editor: EditorView) => boolean
  /** 切换插入/覆盖模式。 */
  toggleOverwrite: (editor: EditorView) => void
  /** 跳到上一条/下一条错误。 */
  goToError: (forward: boolean) => boolean
  /** 跳到声明。 */
  revealDefinition: (pos: number) => void
  /** 写剪贴板（复制/剪切通道用；宿主注入 `src/clipboard.ts` 的 `copyToClipboard`）。 */
  copyToClipboard: (text: string) => Promise<unknown>
  richHtml?: RichHtmlProducer
  copyRichToClipboard?: (text: string, html: string) => Promise<unknown>
}

/**
 * 一个扁平的**动作面**给菜单用：共享的编辑命令 + 编辑器本地的动作（查找栏、补全、由父级
 * 渲染的 LSP 查询）。菜单项与它的键位解析到**同一个函数**，两个面因此不可能漂移。
 */
export function createEditorActions(deps: EditorCommandDeps): Record<string, Command> {
  // 全部拆成裸名：下面这一段是从 CodeEditor.vue 逐字搬过来的，保持原样最不容易出错。
  const {
    openFindBar, findCommand, findBar, quickDefinitionCommand, adjustSelection, emitSemantic,
    emitEvaluate, expandTemplate, toggleColumnSelection, lastEditLocation, toggleOverwrite, goToError,
    revealDefinition, copyToClipboard, richHtml, copyRichToClipboard,
  } = deps
  const copy = copyToClipboard
  const richCopySink: RichCopySink | undefined = copyRichToClipboard
    ? (text, html) => { void copyRichToClipboard(text, html) }
    : undefined
  return {
    ...editingCommands,
    ...clipboardCommands((text: string) => void copy(text), richHtml, richCopySink), // IDEA EditorCopy/EditorCut：无选区时先选中整行（src/editorClipboard.ts）
    // 查找那一族改走**编辑器内查找栏**（上游 `SearchReplaceComponent`）：`editingCommands` 的 find 族指向
    // CodeMirror 自己的面板（本仓是空操作），整族在此覆盖；`replace.next`/`replace.all` 上游是按钮、一并撤掉。
    find: () => { openFindBar(false); return true },
    replace: () => { openFindBar(true); return true },
    'find.next': findCommand(false),
    'find.previous': findCommand(true),
    'find.wordAtCaret': () => findBar.findWordAtCaret(false),
    'find.prevWordAtCaret': () => findBar.findWordAtCaret(true),
    'find.toggleInSelection': () => { findBar.toggleInSelection(); return true },
    completion: startCompletion,
    definition: editor => { void revealDefinition(editor.state.selection.main.head); return true },
    // 「快速定义」QuickImplementations（$default.xml:162-164 control shift I）：在原地看一眼定义。
    quickDefinition: editor => quickDefinitionCommand(editor),
    'selection.grow': () => adjustSelection(true),
    'selection.shrink': () => adjustSelection(false),
    rename: emitSemantic('rename'),
    references: emitSemantic('references'),
    codeAction: emitSemantic('codeAction'),
    format: emitSemantic('format'),
    signature: emitSemantic('signature'),
    implementation: emitSemantic('implementation'),
    callHierarchy: emitSemantic('callHierarchy'),
    typeHierarchy: emitSemantic('typeHierarchy'),
    // Navigate › 类型声明 (IDEA GotoTypeDeclaration, Ctrl+Shift+B); the LSP
    // typeDefinition request feeds the same references list as implementation.
    typeDeclaration: emitSemantic('typeDefinition'),
    evaluate: emitEvaluate,
    'template.expand': expandTemplate,
    'column.select': toggleColumnSelection,
    'edit.last': lastEditLocation,
    // 切换插入/覆盖（Insert 键与 Code 菜单走同一个实现）。
    'editor.overwrite': editor => { toggleOverwrite(editor); return true },
    // IDEA's Navigate menu: GotoNextError / GotoPreviousError (PlatformActions.xml:612-615).
    'error.next': () => goToError(true),
    'error.previous': () => goToError(false),
  }
}

/** 常驻 keymap 需要的宿主闭包（比动作表少一半：键位只覆盖其中几条）。 */
export interface EditorKeymapDeps {
  /** 打开查找栏（`Mod-f`/`Mod-r`；`false` = 查找、`true` = 替换）。 */
  openFindBar: (replaceMode: boolean) => void
  findCommand: (backwards: boolean) => Command
  findBar: { findWordAtCaret: (backwards: boolean) => boolean; toggleInSelection: () => void; state: { open: boolean }; close: () => void }
  adjustSelection: (grow: boolean) => boolean
  emitSemantic: EditorCommandDeps['emitSemantic']
  emitEvaluate: Command
  expandTemplate: (editor: EditorView) => boolean
  toggleColumnSelection: () => boolean
  lastEditLocation: (editor: EditorView) => boolean
  toggleOverwrite: (editor: EditorView) => void
  goToError: (forward: boolean) => boolean
  /** 折叠选区（`CollapseSelectionHandler`），实现在 CodeEditor.vue（要 hint 与确认框）。 */
  foldSelection: Command
  /** 拆行 = Ctrl+Enter（`SplitLineAction`）。 */
  splitLine: Command
  /** 未配对左花括号后回车那一族（`smartEnter`）。 */
  smartEnter: Command
  /** 列模式里的 Delete（`DeleteInColumnModeHandler`）。 */
  columnDelete: Command
  /** 自定义折叠区域弹层（`Ctrl+Alt+.`）：返回 false 表示"没有区域"。 */
  showCustomRegions: () => boolean
  /** 轻量信息提示（没有自定义区域时那句）。 */
  showHint: (text: string) => void
  /** Tab / Shift+Tab 的缩进（选区整段缩进、光标插入一个缩进单位）。 */
  indentCommand: Command
  outdentCommand: Command
  /** 下一个实时模板槽位（Tab 先喂槽位，没有才缩进）。 */
  nextTemplateStop: (editor: EditorView) => boolean
  /** 解包（`UnwrapAction`）。 */
  unwrap: Command
  /** 插入实时模板（Ctrl+J → 模板选择器）。 */
  emitTemplateChooser: () => void
  /** 包围模板（Ctrl+Alt+T → Surround With）。 */
  emitSurround: () => void
  /** 语句级上下移动（`MoveStatementUp`/`Down`，Ctrl+Shift+↑/↓）。 */
  moveStatement: (down: boolean) => Command
}

/**
 * 常驻 keymap（**不随语言服务开关**）。折叠那一族必须挂在这里：折叠只依赖 CodeMirror
 * 自己的区间与 LSP `foldingRange`，与语言服务在不在无关 —— 早先挂在 lspExtensions() 里，
 * 未接语言服务的文件（未跟踪/无服务器）整族都按不出来。
 */
export function createEditorKeymap(deps: EditorKeymapDeps): KeyBinding[] {
  // 同上：拆成裸名，键位那一段与 CodeEditor.vue 里原来的写法逐字一致。
  const {
    openFindBar, findCommand, findBar, adjustSelection, emitSemantic, emitEvaluate, expandTemplate,
    toggleColumnSelection, lastEditLocation, toggleOverwrite, goToError, foldSelection, splitLine,
    smartEnter, columnDelete, showCustomRegions, showHint, indentCommand, outdentCommand,
    nextTemplateStop, unwrap, emitTemplateChooser, emitSurround, moveStatement,
  } = deps
  return [
    // Every binding runs the same function the 编辑 menu calls, so the two
    // surfaces cannot drift apart.
    { key: 'Mod-slash', preventDefault: true, run: editingCommands['comment.line']! },
    { key: 'Mod-Shift-slash', preventDefault: true, run: editingCommands['comment.block']! },
    { key: 'Mod-d', preventDefault: true, run: editingCommands['line.duplicate']! },
    { key: 'Mod-y', preventDefault: true, run: editingCommands['line.delete']! },
    // MoveLineUp/Down = Alt+Shift+Up/Down ($default.xml keeps Ctrl+Shift for
    // MoveStatement, which TaoCode does not ship).
    { key: 'Alt-Shift-ArrowUp', preventDefault: true, run: editingCommands['line.moveUp']! },
    { key: 'Alt-Shift-ArrowDown', preventDefault: true, run: editingCommands['line.moveDown']! },
    { key: 'Mod-Shift-j', preventDefault: true, run: editingCommands['line.join']! },
    // 移动到配对的括号 = Ctrl+Shift+M（`EditorMatchBrace`，`$default.xml:1146-1148`；Mac 那份 `:642` 也是 shift control M）。
    { key: 'Ctrl-Shift-m', preventDefault: true, run: editingCommands['brace.match']! },
    { key: 'Mod-Shift-u', preventDefault: true, run: editingCommands['case.toggle']! },
    // FindNext/FindPrevious = F3 / Shift+F3（$default.xml:707-708 / :507-508），编辑菜单公布的正是这两条。
    // 必须走查找栏会话：CodeMirror 自带的 findNext/findPrevious 只在它自己的面板打开时才有事做（见 editorSearchExtension.ts）。
    { key: 'F3', preventDefault: true, run: findCommand(false) },
    { key: 'Shift-F3', preventDefault: true, run: findCommand(true) },
    // Find = Ctrl+F / Replace = Ctrl+R（$default.xml:565-567 / :374-376）。
    { key: 'Mod-f', preventDefault: true, run: () => { openFindBar(false); return true } },
    { key: 'Mod-r', preventDefault: true, run: () => { openFindBar(true); return true } },
    // FindWordAtCaret = Ctrl+F3 / FindPrevWordAtCaret = Ctrl+Shift+F3（$default.xml）。
    { key: 'Ctrl-F3', preventDefault: true, run: () => findBar.findWordAtCaret(false) },
    { key: 'Ctrl-Shift-F3', preventDefault: true, run: () => findBar.findWordAtCaret(true) },
    // ToggleFindInSelection = Ctrl+Alt+E（$default.xml）。
    { key: 'Ctrl-Alt-e', preventDefault: true, run: () => { findBar.toggleInSelection(); return true } },
    // UnselectPreviousOccurrence = Alt+Shift+J（$default.xml，`RemoveOccurrenceAction.java:14`）。
    { key: 'Alt-Shift-j', preventDefault: true, run: editingCommands['occurrence.unselect']! },
    // Esc：栏开着就关栏（上游 `EscapeHandler.java:41` 清 headerComponent）；
    // 没开时返回 false，让出给窗口级那些 Esc 语义，不吞键。
    { key: 'Escape', preventDefault: true, run: () => { if (!findBar.state.open) return false; findBar.close(); return true } },
    // Ctrl+Alt+Shift+↑/↓ **不绑给克隆光标**（R3 判决 2026-10-06）：上游那把键的主人是 `ResizeToolWindowUp`/`Down`
    // （platform/platform-resources/src/keymaps/$default.xml:879-884）⇒ 编辑器再绑就是抢键；命令留着走菜单行与「查找操作」。
    { key: 'Alt-j', preventDefault: true, run: editingCommands['occurrence.next']! },
    { key: 'Ctrl-Shift-Alt-j', preventDefault: true, run: editingCommands['occurrence.select']! },
    // 折叠这一族（B4 = codeInsight/folding；键位逐条核过 $default.xml，对应表见
    // docs/inventory/verdict-folding.md §A）。**必须挂在常驻 keymap 上**：折叠只依赖
    // CodeMirror 自己的区间与 LSP `foldingRange`，与语言服务在不在无关 ——
    // 早先挂在 lspExtensions() 里，未接语言服务的文件（未跟踪/无服务器）整族都按不出来。
    //
    // 键名只有一套：`$default.xml` 那边写 SUBTRACT/ADD/MULTIPLY（Swing 认两套物理键），
    // 浏览器这边 `w3c-keyname` 按 keyCode 查表，数字键盘的减号与主键区减号**同名**（109/189 → '-'），
    // 所以主键区那一条就把数字键盘也覆盖了；加号（107/187 → '='）与乘号（106 → '*'）同理。
    // 代价是 Shift 变体分不开：Shift+= 与数字键盘 + 都报 '+'，Shift+数字键盘- 仍报 '-'，
    // 会先命中不带 Shift 的那条 —— 所以**只写主键区可靠的写法**，不为数字键盘编一条死键位
    // （`Ctrl-NumPad-` 这种写法在 CodeMirror 里永远匹配不到，判决 §A 登记了这一点）。
    { key: 'Ctrl--', preventDefault: true, run: editingCommands.fold! },
    { key: 'Ctrl-=', preventDefault: true, run: editingCommands.unfold! },
    { key: 'Ctrl-Shift--', preventDefault: true, run: editingCommands.foldAll! },
    { key: 'Ctrl-Shift-=', preventDefault: true, run: editingCommands.unfoldAll! },
    { key: 'Ctrl-Alt--', preventDefault: true, run: editingCommands['fold.recursively']! },
    { key: 'Ctrl-Alt-=', preventDefault: true, run: editingCommands['unfold.recursively']! },
    // 折叠选区（`CollapseSelectionHandler.java:42-45`）：命中一条**自动生成**的区间时不移除它，
    // 而是在光标上方弹一条轻量信息提示（`HintManager.showInformationHint`）。默认结果（重叠时
    // 「取消」不动）与确认框的「确定」分支在 `collapseSelectionAfterOverlapConfirm`，那条要
    // 模态框宿主（`src/App.vue`，保留文件）⇒ 见 `docs/wiring-requests-2026-10-06-fold3.md` 的 W-1。
    { key: 'Ctrl-.', preventDefault: true, run: foldSelection },
    { key: 'Ctrl-Shift-.', preventDefault: true, run: editingCommands['fold.block']! },
    // 展开到级别 1–5 = 两段式 chord（`$default.xml:385-403`：`control MULTIPLY` + `1`..`5`）。
    // 权威表在 `src/foldingKeymap.ts`（`foldingLevelChords`），经 `src/editorCommands.ts` 的
    // `foldingKeymap` 接成 CodeMirror 认的 `KeyBinding[]`。**不许**在这里再写一条单段
    // `Ctrl-*`：CodeMirror 的 `checkPrefix`（`node_modules/@codemirror/view/dist/index.js:9154-9160`）
    // 禁止同一键名既当普通绑定又当多段前缀，会直接抛；而且单段只绑到级别 1 也丢了 2–5。
    ...foldingKeymap,
    { key: 'Alt-Shift-Insert', preventDefault: true, run: toggleColumnSelection },
    // IDEA's template keys. Tab only consumes a pending slot; when there is none
    // the command returns false and normal indentation (or accepting a completion)
    // proceeds.
    { key: 'Ctrl-Alt-j', preventDefault: true, run: expandTemplate },
    // InsertLiveTemplate = Ctrl+J ($default.xml:438-440).
    { key: 'Ctrl-j', preventDefault: true, run: () => { emitTemplateChooser(); return true } },
    { key: 'Ctrl-Alt-t', preventDefault: true, run: () => { emitSurround(); return true } },
    // Tab first feeds a pending live-template slot; otherwise it indents.
    // (A snippet inserted by a completion owns Tab through @codemirror/autocomplete's
    // own highest-precedence keymap, which runs before this one.)
    { key: 'Tab', preventDefault: true, run: editor => nextTemplateStop(editor) || indentCommand(editor), shift: outdentCommand },
    { key: 'Ctrl-Shift-Backspace', preventDefault: true, run: lastEditLocation },
    // Unwrap（上游 Code 菜单 `UnwrapAction`，$default.xml:917-920 = Ctrl+Shift+Delete）。
    { key: 'Ctrl-Shift-Delete', preventDefault: true, run: unwrap },
    // EditorToggleInsertState = INSERT（`$default.xml:457-459`）。
    { key: 'Insert', preventDefault: true, run: editor => { toggleOverwrite(editor); return true } },
    // 回车：上游 `enter/*` 里本仓原先没有的三条（行注释中间续注释、未配对左花括号后补 `}`、
    // 字符串里插 `" + "`）。**排在 basicSetup 之前**，否则 `insertNewlineAndIndent` 先赢；
    // 三条都不认得时本命令返回 false，键继续往 basicSetup 走（成对花括号之间多插一个换行
    // 那一条是 `insertNewlineAndIndent` 自己在做，见 src/enterHandlers.ts 的模块头）。
    { key: 'Enter', preventDefault: true, run: smartEnter },
    // 拆行 = Ctrl+Enter（`$default.xml:959-961`）：整刀交给上面那条回车链，再把光标拽回切点
    // （`SplitLineAction.java:57-65`）；列模式里 Delete 少删行尾那一条（`DeleteInColumnModeHandler.java:33`）。
    { key: 'Ctrl-Enter', preventDefault: true, run: splitLine },
    { key: 'Delete', preventDefault: true, run: columnDelete },
    // 语句级上下移动（`$default.xml:782-787`：MoveStatementDown = Ctrl+Shift+Down、
    // MoveStatementUp = Ctrl+Shift+Up；Alt+Shift+Up/Down 是 MoveLineUp/Down，上面已挂）。
    { key: 'Ctrl-Shift-ArrowUp', preventDefault: true, run: moveStatement(false) },
    { key: 'Ctrl-Shift-ArrowDown', preventDefault: true, run: moveStatement(true) },
    // GotoCustomRegion = Ctrl+Alt+.（`$default.xml:535-537`）：弹自定义折叠区域列表。
    // 一个区域都没有时给提示，与 `GotoCustomRegionAction.java:65` 一致。
    { key: 'Ctrl-Alt-.', preventDefault: true, run: () => {
      if (showCustomRegions()) return true
      showHint('这个文件里没有自定义折叠区域')
      return true
    } },
    // Keys the library would otherwise answer with something IDEA does not do. These
    // bindings have to precede basicSetup: a CodeMirror keymap facet is a plain facet, so
    // the extension listed first wins the key.
    // $default.xml:849-851 — F8 is Step Over; dapStep runs from the window-level handler, and
    // @codemirror/lint's lintKeymap also binds F8 to nextDiagnostic. Consuming it here shadows only
    // the library binding: the browser default is prevented but the event still reaches the window handler.
    { key: 'F8', preventDefault: true, run: () => true },
    // $default.xml:309-311 / :717-719 — Alt+Left/Right is PreviousTab/NextTab, and
    // TabNavigationActionBase.java:71-78 routes it to the editor's tabs. CodeMirror binds the
    // same chord to cursorSyntaxLeft/Right, so the caret would also jump a syntax unit.
    { key: 'Alt-ArrowLeft', preventDefault: true, run: () => true },
    { key: 'Alt-ArrowRight', preventDefault: true, run: () => true },
  ]
}

/**
 * Tab / Shift+Tab（IDEA 的缩进与反缩进）。basicSetup 刻意不带 `indentWithTab`，所以这把键
 * 原先会漏给浏览器。有选区时整段缩进；光标时插入一个缩进单位（「使用制表符」开着就是真
 * 制表符，否则 `tabSize` 个空格）—— 两者读同一个 facet。
 */
export function createIndentCommands(options: { useTabCharacter: boolean; tabSize: number }): { indent: Command; outdent: Command } {
  const unitText = () => (options.useTabCharacter ? '\t' : ' '.repeat(options.tabSize))
  const change = (direction: 1 | -1): Command => {
    const outdent = direction < 0
    return editor => {
      const state = editor.state
      if (state.readOnly) return false
      if (outdent || state.selection.ranges.some(range => !range.empty)) return (outdent ? indentLess : indentMore)(editor)
      const text = unitText()
      editor.dispatch(state.changeByRange(range => ({
        changes: { from: range.from, to: range.to, insert: text },
        range: EditorSelection.cursor(range.from + text.length),
      })), { scrollIntoView: true, userEvent: 'input.indent' })
      return true
    }
  }
  return { indent: change(1), outdent: change(-1) }
}
