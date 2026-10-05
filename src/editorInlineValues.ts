// 行内调试值的编辑器层（上游 `InlineDebugRenderer` / `XDebuggerInlayUtil` 的等价物）。
//
// 纯规则在 `src/inlineDebugValues.ts`（整词匹配 / 上限 / 拼法）；这里负责：
//   ① 从 DAP 取当前栈顶帧的变量（`dap.stackTrace` → 第一帧 → `dap.scopes` →
//      逐个非 expensive 作用域 `dap.variables`；与 `DebugPanel.vue` 走同一条链路，
//      面板没开/没选中帧也能显示 —— IDEA 的行内值同样不依赖 Variables 视图是否可见）；
//   ② 把条目变成行尾 widget（`.cm-inline-value`，只读小字，鼠标事件不参与）；
//   ③ 继续/结束时清空（`refresh` 在 `dapState` 变化时由宿主重调）。
//
// 数据只有 DAP 这条来源（`native/dap.cpp` 的会话状态），所以本模块直接调 `src/bridge.ts`
// 的三个封装；宿主注入视图与「现在该不该显示」。
import { StateEffect, StateField, type Extension } from '@codemirror/state'
import { Decoration, EditorView, WidgetType, type DecorationSet } from '@codemirror/view'
import { dapScopes, dapStackTrace, dapVariables } from './bridge.ts'
import { collectInlineValues, inlineVariableOf, type InlineValueVariable } from './inlineDebugValues.ts'

class InlineValueWidget extends WidgetType {
  // 显式字段，不写参数属性：`constructor(readonly text: …)` 是类型扩展语法，Node 22 直跑
  // `.ts` 的 strip-only 擦除不支持它，会让 import 到本文件的用例**整个文件**加载失败。
  private readonly text: string
  constructor(text: string) { super(); this.text = text }
  eq(other: InlineValueWidget) { return other.text === this.text }
  toDOM() {
    const span = document.createElement('span')
    span.className = 'cm-inline-value'
    span.textContent = `  ${this.text}`
    return span
  }
  ignoreEvent() { return true }
}

interface InlineValueEntry { line: number; text: string }

export const setInlineValues = StateEffect.define<InlineValueEntry[]>()

const inlineValuesField = StateField.define<DecorationSet>({
  create: () => Decoration.none,
  update(decorations, transaction) {
    if (transaction.docChanged) return Decoration.none
    for (const effect of transaction.effects) {
      if (!effect.is(setInlineValues)) continue
      const marks = effect.value
        .filter(entry => entry.line >= 1 && entry.line <= transaction.state.doc.lines)
        .sort((a, b) => a.line - b.line)
        .map(entry => Decoration.widget({ widget: new InlineValueWidget(entry.text), side: 1 }).range(transaction.state.doc.line(entry.line).to))
      return Decoration.set(marks, true)
    }
    return decorations
  },
  provide: field => EditorView.decorations.from(field),
})

export interface InlineValueDeps {
  /** 只在「暂停且当前文件就是停住的位置」时为真。 */
  enabled: () => boolean
  view: () => EditorView | undefined
}

export function createInlineValues(deps: InlineValueDeps) {
  let generation = 0

  function clear() {
    ++generation
    deps.view()?.dispatch({ effects: setInlineValues.of([]) })
  }

  async function refresh() {
    const current = ++generation
    const editor = deps.view()
    if (!editor || !deps.enabled()) { clear(); return }
    try {
      const frames = (await dapStackTrace()).frames
      const frame = frames[0]
      if (!frame) { if (current === generation) clear(); return }
      const scopes = (await dapScopes(frame.id)).scopes
      const variables: InlineValueVariable[] = []
      for (const scope of scopes) {
        if (scope.expensive) continue
        const result = await dapVariables(scope.reference)
        for (const raw of result.variables) {
          const variable = inlineVariableOf(raw)
          if (variable) variables.push(variable)
        }
      }
      const target = deps.view()
      if (!target || current !== generation) return
      const lines = target.state.doc.toString().split('\n')
      target.dispatch({ effects: setInlineValues.of(collectInlineValues(lines, variables)) })
    } catch {
      // 栈已经结束/适配器不支持：安静清掉，不把调试错误塞进编辑器。
      if (current === generation) clear()
    }
  }

  return { extension: inlineValuesField as Extension, refresh, clear }
}
