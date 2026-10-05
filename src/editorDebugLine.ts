// "当前执行行"的整行高亮 + **行内值** —— IDEA `ExecutionPointHighlighter` 与
// `InlineDebugRenderer`/`InlineVariablesPanel` 的对应物（**不是** gutter 图标）。
//
// 为什么单独成模块：它和 gutter 图标层是两回事 —— IDEA 里断点/书签/书签标记属于 `GutterIconRenderer`
// 那一层（画在装订线上，见 src/gutterIcons.ts），而"调试停在哪一行"是画在文本行上的高亮
// （`platform/xdebugger-impl/.../ExecutionPointHighlighter`，与 gutter 无关）；
// 行内值（`XDebuggerInlineValuesProvider`）也是同一层。
//
// CodeEditor.vue 在扩展表里装了 `debugLineExtension`（那是本模块的导出），所以**行内值不需要
// 改编辑器组件**：同一个 Extension 里再提供一个 StateField，值由 DebugPanel 通过
// `setDebugInlineValues()` 推进来（见下）。
//
// 本模块 import 的是 npm 包 + 规则/装配模块（`debugInlineValues` / `dbgRunToCursorGutter` /
// `debugSettingsStore`），**不 import `bridge.ts`**：DAP 状态由挂进来的扩展自己去读，
// 所以本文件仍可单测
// （用 `EditorState.create({extensions:[debugLineExtension]})` + update 就能验状态机，
// 见 tests/debug-inline-values.test.mjs）。
import { Decoration, EditorView, WidgetType } from '@codemirror/view'
import type { Extension, Transaction } from '@codemirror/state'
import { RangeSetBuilder, StateEffect, StateField } from '@codemirror/state'
import { inlineValueText, type InlineValueEntry } from './debugInlineValues.ts'
import { runToCursorGutterExtension } from './dbgRunToCursorGutter.ts'
import { debuggerExtras } from './debugSettingsStore.ts'

/** 调试当前行（DAP 是 1 基行号；0 = 没有）。 */
export const setDebugLine = StateEffect.define<number>()

export const debugLineField = StateField.define<number>({
  create: () => 0,
  update(value, tr) {
    let next = value
    for (const effect of tr.effects) if (effect.is(setDebugLine)) next = effect.value
    return next
  },
  provide: field => EditorView.decorations.compute([field], state => {
    const line = state.field(field)
    if (line < 1 || line > state.doc.lines) return Decoration.none
    const from = state.doc.line(line).from
    const builder = new RangeSetBuilder<Decoration>()
    builder.add(from, from, Decoration.line({ class: 'cm-debug-line' }))
    return builder.finish()
  }),
})

/** 行内值（当前执行行 + 条目；空条目 = 不画）。DebugPanel 每次停住后推一次。 */
export interface InlineValuesState {
  line: number
  entries: InlineValueEntry[]
}

export const setInlineValues = StateEffect.define<InlineValuesState>()

const EMPTY_INLINE_VALUES: InlineValuesState = { line: 0, entries: [] }

class InlineValuesWidget extends WidgetType {
  readonly text: string
  constructor(text: string) { super(); this.text = text }
  eq(other: InlineValuesWidget) { return other.text === this.text }
  toDOM() {
    const span = document.createElement('span')
    span.className = 'cm-inline-values'
    span.textContent = `  ${this.text}`
    return span
  }
  ignoreEvent() { return true }
}

export const inlineValuesField = StateField.define<InlineValuesState>({
  create: () => EMPTY_INLINE_VALUES,
  update(value, tr) {
    let next = value
    for (const effect of tr.effects) if (effect.is(setInlineValues)) next = effect.value
    return next
  },
  provide: field => EditorView.decorations.compute([field, debugLineField], state => {
    const values = state.field(field)
    const line = state.field(debugLineField)
    const text = inlineValueText(values.entries)
    // 只有「值所属行 == 当前执行行」且真的有条目时才画：同一份值不该在别的文件/别的行冒出来。
    if (!text || values.line < 1 || values.line !== line || line > state.doc.lines) return Decoration.none
    const end = state.doc.line(line).to
    const builder = new RangeSetBuilder<Decoration>()
    builder.add(end, end, Decoration.widget({ widget: new InlineValuesWidget(text), side: 1 }))
    return builder.finish()
  }),
})

// ── 行内监视（上游 `InlineWatch`，规则在 `src/debugInlineWatch.ts`）──
// 与行内值的差别是**锚点**：行内值画在当前执行行，行内监视画在它自己锚定的那一行行尾
// （上游 `document.getLineEndOffset(line)`，`InlineWatch.kt:70-72`），所以是两个字段。
// 复用 `.cm-inline-value` 那个 class（`src/editorTheme.ts:59` 的小字弱化样式），与行内值同一外观。
//
// 2026-10-06 补齐的两件事（都在本文件，没动保留的 CodeEditor.vue）：
//   ① **重锚**：上游靠 `RangeMarker` 跟着文档偏移走（`InlineWatch.kt:70-72` 建 marker、
//      `:35-44` 的 `updatePosition` 搬行号、`:79-81` 判定失效即移除）。本仓此前只有
//      「行号越界就不画」，现在在 `inlineWatchesField.update` 里用 `tr.changes.mapPos`
//      把锚点偏移跟着每次编辑走 —— CodeMirror 版的 RangeMarker；判词里那条
//      「文档改动后不重锚」的差异按此订正。
//   ② **就地编辑表达式**（`dbg/inline` 缺口③）：上游点行内监视 ⇒ 弹层工具条挂
//      `EditInlineWatch`（`ui/src/com/intellij/xdebugger/impl/inline/XDebuggerTreeInlayPopup.java:53-61`：
//      节点是 `InlineWatchNodeImpl` 时挂 Edit，否则挂 Add），动作体 `:107-118` 调
//      `watchesManager.showInplaceEditor(position, editor, session, expression)`；
//      编辑器本体 `InlineWatchInplaceEditor.java:49-56`（`XDebuggerExpressionComboBox`，
//      历史 id `inlineWatch`，预填当前表达式，`doOKAction` 提交）。
//      本仓：点击行内监视 ⇒ 就地换成输入框（预填表达式），Enter 提交 / Esc 取消，
//      提交经 `setInlineWatchExpressionEditor()` 注入的通道改名并重算值。
export interface InlineWatchItem {
  line: number
  text: string
  /** 表达式本体（上游 `InlineWatch.getExpression()`）：就地编辑要用它，光有渲染文本不够。 */
  expression: string
}
/** `path` 只是给调试用的来源标注（编辑器视图里查不到自己的路径，见下面 `debugLineField` 的判据）。 */
export interface InlineWatchState { path: string; items: readonly InlineWatchItem[] }

export const setInlineWatches = StateEffect.define<InlineWatchState>()

const EMPTY_INLINE_WATCHES: InlineWatchState = { path: '', items: [] }

/**
 * 提交就地编辑的通道（`InlineWatchInplaceEditor.doOKAction` 那一跳的等价物）。
 * 由 `src/debugInlineWatchSync.ts` 注册 —— 没有注册就没有编辑面：`canEditInlineWatch()`
 * 决定要不要把点击变成输入框，不会出现「点了没反应」的假控件。
 */
let editCommitter: ((from: string, to: string) => void) | null = null
export function setInlineWatchExpressionEditor(handler: ((from: string, to: string) => void) | null): void {
  editCommitter = handler
}
export function canEditInlineWatch(): boolean {
  return editCommitter !== null
}
/** 输入框初值：预填表达式（上游 `setExpression(myInitialExpression)`，`:53-55`）。 */
export function inlineWatchEditValue(expression: string): string {
  return expression
}
/** 提交判据（上游 `doOKAction` 走 OK 路径；空表达式与改名失败都不提交）。 */
export function commitInlineWatchEdit(from: string, raw: string): boolean {
  const to = raw.trim()
  if (!to || to === from) return false
  editCommitter?.(from, to)
  return true
}

/**
 * 同一行可能挂着好几条行内监视：本仓把它们画在同一个行尾控件里，但**每条是自己的 span**
 * —— 上游就是一条一个 inlay（`InlineDebugRenderer`），逐条才点得动、才编辑得动。
 */
class InlineWatchesWidget extends WidgetType {
  readonly entries: readonly InlineWatchItem[]
  constructor(entries: readonly InlineWatchItem[]) { super(); this.entries = entries }
  eq(other: InlineWatchesWidget) {
    if (other.entries.length !== this.entries.length) return false
    return this.entries.every((entry, index) => entry.text === other.entries[index]?.text
      && entry.expression === other.entries[index]?.expression)
  }
  get valueText() { return this.entries.map(entry => entry.text).join(' · ') }
  toDOM() {
    const span = document.createElement('span')
    span.className = 'cm-inline-value'
    for (const entry of this.entries) {
      const one = document.createElement('span')
      one.textContent = `  ${entry.text}`
      if (canEditInlineWatch()) {
        one.classList.add('cm-inline-watch-editable')
        one.title = '点击就地编辑这条行内监视'
        one.addEventListener('click', event => {
          event.preventDefault()
          event.stopPropagation()
          openInlineWatchEditor(one, entry.expression, entry.text)
        })
      }
      span.append(one)
    }
    return span
  }
  // 有点击动作 ⇒ 不能再把事件交回编辑器（上游弹层也是自己吃掉事件的）。
  ignoreEvent() { return !canEditInlineWatch() }
}

/** 就地编辑器：把这一条的渲染文本换成输入框，Enter 提交、Esc 还原。 */
function openInlineWatchEditor(host: HTMLElement, expression: string, restoreText: string): void {
  if (host.querySelector('input.cm-inline-watch-input')) return
  const box = document.createElement('input')
  box.className = 'cm-inline-watch-input'
  box.value = inlineWatchEditValue(expression)
  box.setAttribute('aria-label', '行内监视表达式')
  host.textContent = ''
  host.append(box)
  box.focus()
  box.select()
  const close = () => { host.textContent = `  ${restoreText}` }
  box.addEventListener('keydown', event => {
    if (event.key === 'Enter') { event.preventDefault(); event.stopPropagation(); commitInlineWatchEdit(expression, box.value); close() }
    else if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); close() }
  })
  box.addEventListener('blur', close)
}

/**
 * 把一条行内监视的锚点跟着这次编辑搬走（上游 `InlineWatch.updatePosition`，
 * `InlineWatch.kt:35-44`；锚点偏移来自 `:70-72` 的 `getLineEndOffset` + `createRangeMarker`）。
 * 搬不动（原文档里没这一行）就保留原行号，交由渲染那层的上界过滤掉（越界不画）。
 */
function mapWatchLine(tr: Transaction, line: number): number {
  if (!tr.docChanged || line < 1 || line > tr.startState.doc.lines) return line
  const from = tr.startState.doc.line(line).from
  return tr.state.doc.lineAt(tr.changes.mapPos(from, -1)).number
}

export const inlineWatchesField = StateField.define<InlineWatchState>({
  create: () => EMPTY_INLINE_WATCHES,
  update(value, tr) {
    let next = value
    for (const effect of tr.effects) if (effect.is(setInlineWatches)) next = effect.value
    // 文档改动 ⇒ 锚点跟着走（RangeMarker 的等价物）；effect 刚推进来的那一帧不重算。
    if (tr.docChanged && next.items.length && !tr.effects.some(effect => effect.is(setInlineWatches))) {
      const items = next.items.map(item => ({ ...item, line: mapWatchLine(tr, item.line) }))
      return { path: next.path, items }
    }
    return next
  },
  provide: field => EditorView.decorations.compute([field, debugLineField], state => {
    const watches = state.field(field)
    // 文件判据：编辑器视图不知道自己是谁，本仓用「这个视图有执行行」当下界 ——
    // `src/App.vue` 的 `currentDebugLine(path)`（同文件模板里的 `:debug-line` 绑定）只给
    // `dapState.currentLocation.path` 命中的那个编辑器发非零行号，其余一律 0。
    // 文件级的口径（只在同一文件暂停时可见）在调用侧已过一遍 `visibleInlineWatches`。
    if (state.field(debugLineField) < 1) return Decoration.none
    const byLine = new Map<number, InlineWatchItem[]>()
    for (const item of watches.items) {
      if (item.line < 1 || item.line > state.doc.lines) continue
      const group = byLine.get(item.line) ?? []
      group.push(item)
      byLine.set(item.line, group)
    }
    // RangeSetBuilder 要求区间升序，所以按行号排序后再 add（同一行的多条进同一个控件、逐条可点）。
    const builder = new RangeSetBuilder<Decoration>()
    for (const line of [...byLine.keys()].sort((a, b) => a - b)) {
      const end = state.doc.line(line).to
      builder.add(end, end, Decoration.widget({ widget: new InlineWatchesWidget(byLine.get(line)!), side: 1 }))
    }
    return builder.finish()
  }),
})

// ── 视图注册与推送 ────────────────────────────────────────────────────────────────
// CodeEditor.vue 每次同步执行行都会把 `EditorView` 交给 `syncDebugLine`，顺手登记在这里；
// DebugPanel 拿到新行内值时通过 `setDebugInlineValues` 对登记的视图各派发一次 effect。
// 视图销毁没有回调（CodeEditor 冻结），用 `dom.isConnected` 过滤掉已摘除的 DOM。
const views = new Set<EditorView>()

/**
 * 执行点变化时按设置滚动（上游 `ExecutionPointHighlighter.java:88-90`：
 * `scrollToCenter` 关掉时顶帧用 `ScrollType.MAKE_VISIBLE`，打开时用默认的居中）。
 * CodeMirror 的对应物：`scrollIntoView(..., { y: 'center' })` / `{ y: 'nearest' }`。
 * 只在**行号真的变了**的那一次动手，免得跟用户的滚动抢。
 *
 * 声明顺序不能挪到 `debugLineExtension` 后面：那条是模块求值时构造的数组字面量，
 * 引用后声明的 `const` 会撞 TDZ（`ReferenceError`，整条编辑器调试链一起加载失败）。
 */
export const scrollToCenterExtension: Extension = EditorView.updateListener.of(update => {
  if (!update.docChanged && !update.transactions.some(tr => tr.effects.some(effect => effect.is(setDebugLine)))) return
  const before = update.startState.field(debugLineField)
  const after = update.state.field(debugLineField)
  if (before === after || after < 1 || after > update.state.doc.lines) return
  const from = update.state.doc.line(after).from
  const place = debuggerExtras.scrollToCenter ? 'center' : 'nearest'
  update.view.dispatch({ effects: EditorView.scrollIntoView(from, { y: place }) })
})

/**
 * 供编辑器把它装进扩展表（`debugLineField` 必须在扩展里，否则 `state.field` 会抛）。
 *
 * 2026-10-06 起这条链上多挂了两件事，都为了**不改保留的 CodeEditor.vue**：
 *   · `runToCursorGutterExtension` —— 装订线上的「运行到光标处」手势
 *     （上游 `XDebuggerManagerImpl.java:439-517`；设置格 `runToCursorGestureEnabled`）；
 *     它需要的 DAP 路径口径由 `src/dbgRunToCursorGutter.ts` 自己从 `bridge.ts` 取
 *     （本模块不 import bridge，见文件头）；
 *   · `scrollToCenterExtension` —— 执行点换行时滚到居中（上游
 *     `ExecutionPointHighlighter.java:88-90` 读 `isScrollToCenter()`，
 *     `XDebuggerGeneralSettings.java:16` 默认 false）。
 */
export const debugLineExtension: Extension = [
  debugLineField, inlineValuesField, inlineWatchesField,
  runToCursorGutterExtension({
    // 手势只在对的那个文件里生效的判据（差异 1 见 dbgRunToCursorGutter.ts 模块头）。
    isPausedEditor: view => view.state.field(debugLineField) >= 1,
  }),
  scrollToCenterExtension,
]

/** 同步入口：编辑器挂载时与 `debugLine` 变化时各调一次。 */
export function syncDebugLine(view: EditorView | undefined, line: number): void {
  if (view) views.add(view)
  view?.dispatch({ effects: setDebugLine.of(line) })
}

/** DebugPanel 推行内值（`null` = 清空）。对每个还连在文档里的编辑器视图派发一次。 */
export function setDebugInlineValues(values: InlineValuesState | null): void {
  const next = values ?? EMPTY_INLINE_VALUES
  for (const view of views) {
    if (!view.dom.isConnected) { views.delete(view); continue }
    view.dispatch({ effects: setInlineValues.of(next) })
  }
}

/** DebugPanel 推行内监视（`null` = 清空）。与行内值同一批视图。 */
export function setDebugInlineWatches(watches: InlineWatchState | null): void {
  const next = watches ?? EMPTY_INLINE_WATCHES
  for (const view of views) {
    if (!view.dom.isConnected) { views.delete(view); continue }
    view.dispatch({ effects: setInlineWatches.of(next) })
  }
}
