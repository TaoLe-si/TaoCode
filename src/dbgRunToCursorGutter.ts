// 装订线上的「运行到光标处」手势 —— 上游 `XDebuggerManagerImpl.GutterUiRunToCursorEditorListener`
// （`platform/xdebugger-impl/src/com/intellij/xdebugger/impl/XDebuggerManagerImpl.java:439-517`）。
//
// 逐条照搬的用户可见行为：
//   · 生效条件 `:443-458`：鼠标在**行号区**（`EditorMouseEventArea.LINE_NUMBERS_AREA`）、
//     是真实文件编辑器、会话**正停着**且非只读，并且设置
//     `isRunToCursorGestureEnabled`（`.../settings/XDebuggerGeneralSettings.java:18`，默认 **true**）；
//   · 悬停反馈 `:473-485`：给那一行加整行高亮（`addLineHighlighter(...)`，
//     画在 `DebuggerColors.EXECUTION_LINE_HIGHLIGHTERLAYER` 那一层）+ 上方气球写动作名
//     （`ActionsBundle.actionText(RunToCursor)`）+ 手型光标；
//   · 离开装订线 `:489-492` / `:494-502`：高亮与气球一起撤；
//   · 左键按下 `:504-516`：对那一行执行 Run to Cursor（`session.runToPosition(position, false)`），
//     并把事件消费掉。
//
// 本仓用同一件事的 CodeMirror 版本承接：整行高亮用 `Decoration.line`（class 走 `src/tokens.css`
// 的令牌，样式由本扩展自带的 baseTheme 提供，不动保留文件 `src/style.css`），动作名用行元素的
// `title`（浏览器原生气球），点击用 `domEventHandlers` 判指针是否落在 `.cm-lineNumbers` 那块。
//
// 两处如实差异（都写在返回判据里，不是隐藏）：
//   1. 上游对**工程里任何一个文件**生效；本仓的编辑器扩展拿不到自己那个文件的绝对路径
//      （`CodeEditor.vue` 是保留文件，`syncDebugLine(view, line)` 也没带 path），
//      所以手势只在**当前停住的那个文件**里生效 —— 判据是宿主传进来的 `isPausedEditor`
//      （= 这个视图的执行行号 > 0，见 `src/editorDebugLine.ts`）；
//   2. 上游的动作走 ActionManager（带快捷键、能作用于任意编辑器）；本仓直接发 DAP
//      `gotoTargets` + `goto` 这两步 —— 与 `src/App.vue:1296-1311` 里 Alt+F9 那条完全同一协议路径，
//      所以也不会出现「手势能点但没有后端」的假控件。
import { Decoration, EditorView } from '@codemirror/view'
import { RangeSetBuilder, StateEffect, StateField, type Extension } from '@codemirror/state'
import { dapCapability, dapConsole, dapGoto, dapGotoTargets, dapState } from './bridge.ts'
import { debuggerExtras } from './debugSettingsStore.ts'
import { breakpointUpdater } from './dbgBreakpointUpdate.ts'

/** 上游动作文案（`ActionsBundle.actionText("RunToCursor")`，`:479`）；本仓中文口径与 App.vue 一致。 */
export const RUN_TO_CURSOR_HINT = '运行到光标处'

/** 没有生效行时用 0（上游的 `myCurrentHighlighter == null`）。 */
export const setRunToCursorLine = StateEffect.define<number>()

export const runToCursorField = StateField.define<number>({
  create: () => 0,
  update(value, tr) {
    let next = value
    for (const effect of tr.effects) if (effect.is(setRunToCursorLine)) next = effect.value
    return next
  },
  provide: field => EditorView.decorations.compute([field], state => {
    const line = state.field(field)
    if (line < 1 || line > state.doc.lines) return Decoration.none
    const from = state.doc.line(line).from
    const builder = new RangeSetBuilder<Decoration>()
    // 整行高亮 + 手型光标 + 原生气球（上游的气球 = 动作名，`:479-483`）。
    builder.add(from, from, Decoration.line({
      class: 'cm-run-to-cursor-line',
      attributes: { title: `${RUN_TO_CURSOR_HINT}（第 ${line} 行；点击行号生效）` },
    }))
    return builder.finish()
  }),
})

/** 上游 `isEnabled` 的那几道门，本仓逐条对上（`:443-458`）。 */
export function runToCursorGestureAllowed(gates: {
  settingEnabled: boolean
  sessionPaused: boolean
  adapterSupportsGoto: boolean
  pointerInLineNumbers: boolean
  isPausedEditor: boolean
}): boolean {
  if (!gates.settingEnabled) return false
  if (!gates.sessionPaused) return false
  if (!gates.adapterSupportsGoto) return false
  if (!gates.isPausedEditor) return false
  return gates.pointerInLineNumbers
}

/** 指针是否落在行号那一列（上游的 `LINE_NUMBERS_AREA` 判据）。 */
export function pointerInLineNumbers(view: EditorView, event: MouseEvent): boolean {
  const gutter = view.dom.querySelector('.cm-lineNumbers')
  if (!gutter) return false
  const box = gutter.getBoundingClientRect()
  const x = event.clientX
  const y = event.clientY
  return x >= box.left && x <= box.right && y >= box.top && y <= box.bottom
}

/** 一次悬停对应的文档行号（1 基）。量不到 ⇒ 0（上游 `getLineNumber` 越界返回 -1 同义）。 */
export function lineAtPointer(view: EditorView, event: MouseEvent): number {
  const pos = view.posAtCoords({ x: event.clientX, y: event.clientY }, false)
  if (pos === null || pos < 0) return 0
  const line = view.state.doc.lineAt(pos).number
  return line >= 1 && line <= view.state.doc.lines ? line : 0
}

/**
 * 手势的宿主面：本扩展只负责「哪一行 + 要不要生效」，真正的两步 DAP 请求在这里发。
 * 返回一句给人看的结果（成功/无目标/不支持），写进调试控制台（`dapConsole` 是面板那块的输出）。
 */
export async function runToCursorAtLine(path: string, line: number): Promise<string> {
  if (!path || line < 1) return `${RUN_TO_CURSOR_HINT}：没有可用的目标行。`
  try {
    const result = await dapGotoTargets(path, line, 0)
    const target = result.targets[0]
    if (!target) return `${RUN_TO_CURSOR_HINT}：第 ${line} 行没有可停的位置。`
    // `goto` 就是「恢复执行」⇒ 先把合并窗里的断点改动冲干净（同 DebugPanel 的继续/单步/反向/重启三处），
    // 否则刚改的条件会排在这次 goto 之后才到适配器。
    await breakpointUpdater.flush()
    await dapGoto(dapState.threadId, target.id)
    return `${RUN_TO_CURSOR_HINT}：第 ${line} 行（目标 ${target.label}）。`
  }
  catch (caught) {
    const code = (caught as { code?: string }).code
    return code === 'DAP_UNSUPPORTED'
      ? `${RUN_TO_CURSOR_HINT}：该调试适配器不支持。`
      : `${RUN_TO_CURSOR_HINT}：${caught instanceof Error ? caught.message : String(caught)}`
  }
}

export interface RunToCursorGutterOptions {
  /** 这个视图是不是当前停住的那个文件（差异 1，见模块头）。 */
  isPausedEditor: (view: EditorView) => boolean
  /**
   * 取当前执行点所在文件（DAP 请求要的路径口径）。
   * 默认读本仓唯一的会话状态 `dapState.currentLocation.path` —— 之所以可以在这里默认：
   * 本模块本来就直接 import `bridge.ts`（手势的门与请求都在这里发），而挂点
   * `src/editorDebugLine.ts` 刻意不碰 bridge（它只 import 编辑器/规则模块），
   * 所以路径口径由本模块提供，编辑器只传 `isPausedEditor`。
   */
  currentPath?: () => string
}

/** 上游 `session.debugProcess` 当前停着的那个文件；没停着 ⇒ 空串（`runToCursorAtLine` 自己判）。 */
export function runToCursorCurrentPath(): string {
  return dapState.currentLocation?.path ?? ''
}

/** 手势扩展：装进 `src/editorDebugLine.ts` 的 `debugLineExtension`（编辑器已在用那条链）。 */
export function runToCursorGutterExtension(options: RunToCursorGutterOptions): Extension {
  const currentPath = options.currentPath ?? runToCursorCurrentPath
  const allowed = (view: EditorView, event: MouseEvent) => runToCursorGestureAllowed({
    // 设置格：`XDebuggerGeneralSettings.isRunToCursorGestureEnabled`（默认 true）。
    settingEnabled: debuggerExtras.runToCursorGestureEnabled,
    sessionPaused: dapState.running && dapState.paused,
    // 上游没有这条门（它有自己的 runToPosition）；本仓不声明能力的适配器会直接报错，
    // 所以这里先按 DAP `supportsGotoTargetsRequest` 收着，避免一个点不动的手势。
    adapterSupportsGoto: dapCapability('supportsGotoTargetsRequest') === true,
    pointerInLineNumbers: pointerInLineNumbers(view, event),
    isPausedEditor: options.isPausedEditor(view),
  })

  const theme: Extension = EditorView.baseTheme({
    // 上游用的是「非顶帧」那一档执行点配色（`DebuggerColors.NOT_TOP_FRAME_ATTRIBUTES`，`:475`），
    // 比当前执行行弱一档 ⇒ 本仓取 `--hover` 这个既有的弱背景令牌，不新造颜色、不写裸色值。
    '& .cm-line.cm-run-to-cursor-line': { background: 'var(--hover)', cursor: 'pointer' },
  })

  const events: Extension = EditorView.domEventHandlers({
    mousemove(event, view) {
      const line = allowed(view, event) ? lineAtPointer(view, event) : 0
      if (view.state.field(runToCursorField) === line) return
      view.dispatch({ effects: setRunToCursorLine.of(line) })
    },
    mouseleave(_event, view) {
      if (view.state.field(runToCursorField) === 0) return
      view.dispatch({ effects: setRunToCursorLine.of(0) })
    },
    mousedown(event, view) {
      if (event.button !== 0) return false
      const line = view.state.field(runToCursorField)
      if (line < 1) return false
      event.preventDefault()
      view.dispatch({ effects: setRunToCursorLine.of(0) })
      const note = runToCursorAtLine(currentPath(), line)
      void Promise.resolve(note).then(text => dapConsole.push({ category: 'console', text }))
      return true
    },
  })

  return [runToCursorField, theme, events]
}
