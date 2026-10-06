// 列选择模式（IDEA 的 Column Selection Mode）的一等状态，加上 `DeleteInColumnModeHandler` 那一档。
//
// 判词原话（`docs/inventory/verdict-editor.md:2161`，`DeleteInColumnModeHandler` 那条 `[~]`）：
// 「本仓在列模式里删除走 CM 的逐选区删除……没有 `:24` 里对短行的补齐口径 ⇒ 缺 = 短行口径与独立命令」。
// 本模块把口径补上：**列模式里光标停在本行行尾、又没有选区的那一条不删**（否则会把下一行拉上来接走，
// 而列块比那些行长 ⇒ 用户看到的是「矩形右边那几条短行被并进来了」）。
//
// 上游依据（逐行开文件核过）：
//  · `platform/platform-impl/src/com/intellij/openapi/editor/actions/DeleteInColumnModeHandler.java`
//    - `:18` `extends EditorWriteActionHandler`、`:21` 包着原 handler（`EditorDelete` 的执行体）。
//    - `:25` 门槛三件：`editor.isColumnMode()` && `caret == null`（整编辑器一次，不是逐光标跑）
//      && `getCaretModel().getCaretCount() > 1`。
//    - `:30-34` `runForEachCaret`：`offset < getLineEndOffset(offset) || c.hasSelection()` 才把这一条
//      交回原 handler；**否则整条跳过**（`DocumentUtil.getLineEndOffset` 是**不含**行分隔符的那个行尾）。
//    - `:37` 不满足 `:25` 时原样交回原 handler。
//  · 注册 `platform/platform-impl/resources/intellij.platform.ide.impl.xml:1084`
//    （`<editorActionHandler action="EditorDelete" …>`）—— 上游只包了 **EditorDelete**，
//    Backspace 没有这一档（`grep -rn DeleteInColumnModeHandler` 全树只有定义处与这一行注册）
//    ⇒ 本仓也只改 Delete 键，不要顺手给 Backspace 加一档。
//  · 列模式开关本体 `platform/platform-impl/src/com/intellij/openapi/editor/actions/ToggleColumnModeAction.java`
//    （Alt+Shift+Insert），已落在 `src/components/CodeEditor.vue`；本模块把「现在到底在不在列模式」
//    从那个 Compartment 里提成一条 facet，命令才问得到（原来只有宿主的局部布尔，命令层看不见）。
//
// 与本仓架构有关的差别，照实记（都不是上游行为）：
//  1. `:25` 的 `editor.isColumnMode()` 是编辑器对象的属性，CodeMirror 的 `rectangularSelection()`
//     没有可读的状态 ⇒ 本模块自己发一条 facet（`inColumnMode`），挂在宿主**同一个** Compartment 里，
//     与 `rectangularSelection` 一起 reconfigure ⇒ 两者不会各说各话。
//  2. 上游 `:30-34` 逐光标问、本仓一次 dispatch；**每条光标都不必动手时返回 false**，
//     让键继续走 basicSetup 的 `deleteCharForward`（结果与上游「全部交回原 handler」同解）。
//  3. `:27-28` 的 command group 与 `stopKillRings()` 本仓没有对应通道。
import { Compartment, EditorSelection, Facet, type Extension, type Text } from '@codemirror/state'
import { rectangularSelection, type Command, type EditorView } from '@codemirror/view'

/** 「这个编辑器现在在列模式里」——上游 `editor.isColumnMode()` 的本仓等价物（差别 1）。 */
export const inColumnMode = Facet.define<boolean, boolean>({ combine: values => values.some(value => value) })

/** 挂进宿主的 `columnMode` Compartment，与 `rectangularSelection` 同生同灭。 */
export const columnModeMarker: Extension = inColumnMode.of(true)

/** 列模式里哪些光标该动手（`:33`）：有选区，或切点还没到本行行尾。 */
export function columnBlockDeletable(range: { from: number; to: number; head: number }, doc: Text): boolean {
  return range.from !== range.to || range.head < doc.lineAt(range.head).to
}

/** 下一个字符的末尾（代理对算一个字符，与 CM 的 `deleteCharForward` 同一口径）。 */
function forwardEnd(doc: Text, at: number): number {
  const pair = doc.sliceString(at, at + 2)
  const code = pair.codePointAt(0)
  return code === undefined ? at : at + String.fromCodePoint(code).length
}

/**
 * 列模式里按 Delete 的算式（`:30-34`）：能动的那些光标交回原 `EditorDelete` 的语义 ——
 * 有选区就删选区、空光标就**向后删一个字符**；行尾那些原地不动。
 *
 * 坐标口径：`changes` 在**改动前**的文档里（CodeMirror 就是这个约定），`heads` 在**改动后**的文档里
 * （`TransactionSpec.selection` 的约定），所以每条落点都要减去它之前那些删除的净增减。
 * 全部可动时返回 null（= 与默认档同解，让键走 basicSetup，见差别 2）。
 */
export function columnBlockDeletePlan(ranges: readonly { from: number; to: number; head: number }[], doc: Text, mainIndex = 0):
  { changes: { from: number; to: number; insert: string }[]; heads: number[]; mainIndex: number } | null {
  let protectedCount = 0
  const changes: { from: number; to: number; insert: string }[] = []
  const heads: number[] = []
  let mainTarget = -1
  let shift = 0
  ranges.forEach((range, index) => {
    const deletable = columnBlockDeletable(range, doc)
    if (!deletable) {
      ++protectedCount
      heads.push(range.head + shift)
      if (index === mainIndex) mainTarget = heads.length - 1
      return
    }
    // 空光标 ⇒ 原 handler 向后删一个字符（`:33` 落进 if 的那一支就是 `myOriginalHandler.execute`）。
    const to = range.from === range.to ? forwardEnd(doc, range.from) : range.to
    changes.push({ from: range.from, to, insert: '' })
    heads.push(range.from + shift)
    if (index === mainIndex) mainTarget = heads.length - 1
    shift -= to - range.from
  })
  if (protectedCount === 0) return null
  const sorted = [...new Set(heads)].sort((left, right) => left - right)
  return { changes, heads: sorted, mainIndex: Math.max(0, sorted.indexOf(heads[mainTarget])) }
}

/** `EditorDelete` 在列模式里的那一档（上游 `intellij.platform.ide.impl.xml:1084` 的注册位）。 */
export const deleteInColumnModeCommand: Command = (view: EditorView) => {
  const { state } = view
  if (!state.facet(inColumnMode) || state.readOnly) return false          // `:25`
  const ranges = state.selection.ranges
  if (ranges.length <= 1) return false                                    // `:25` caretCount > 1
  const plan = columnBlockDeletePlan(ranges, state.doc, ranges.indexOf(state.selection.main))
  if (!plan) return false                                                 // 差别 2
  view.dispatch({
    changes: plan.changes,
    selection: EditorSelection.create(plan.heads.map(offset => EditorSelection.cursor(offset)), plan.mainIndex),
    userEvent: 'delete', scrollIntoView: true,
  })
  return true
}

export interface ColumnSelectionState {
  /** 挂进 extensions 的那一条（Compartment 初值：关着）。 */
  extension: Extension
  /** 当前是否在列模式（状态栏那枚芯片读它）。 */
  active: () => boolean
  /** 切一下：reconfigure Compartment 并通知宿主（上游 Alt+Shift+Insert 的那一步）。 */
  toggle: () => boolean
  /** 绑在 Delete 键上的那一档。 */
  deleteForward: Command
}

/**
 * 宿主的列模式状态：模式位、鼠标事件过滤（只认左键，与改动前同一档）、状态栏通知、
 * 以及 `DeleteInColumnModeHandler` 那一档的入口。
 * 搬到本模块的原因：`src/components/CodeEditor.vue` 顶在 1147 行的登记上限
 * （`tests/module-size.test.mjs:135`），要加 Delete 那一行键位就得先从这里搬走等量代码。
 */
export function createColumnSelection(getView: () => EditorView | null | undefined, onChange: (active: boolean) => void): ColumnSelectionState {
  const columnMode = new Compartment
  let active = false
  return {
    extension: columnMode.of([]),
    active: () => active,
    toggle: () => {
      active = !active
      // `rectangularSelection` 只吃一个 eventFilter ⇒ 换档就是换这条扩展（与改动前同解），
      // 再叠上 `columnModeMarker` 让命令层也看得见模式位（差别 1）。
      getView()?.dispatch({
        effects: columnMode.reconfigure(active ? [rectangularSelection({ eventFilter: event => event.button === 0 }), columnModeMarker] : []),
      })
      onChange(active)
      return true
    },
    deleteForward: deleteInColumnModeCommand,
  }
}
