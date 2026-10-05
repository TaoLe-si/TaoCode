// Inlay hints（IDEA 的 `InlayHintsProvider` 一族在本仓的 LSP 等价物：
// `textDocument/inlayHint`）。服务端给的 (行, 列, label) 变成行内的小字。
//
// 从 `CodeEditor.vue` 拆出（那个文件贴着机检上限）：widget 渲染、渲染前归位、
// 去抖调度都是自包含的；宿主只注入「当前视图 / 当前路径 / 语言服务可用与否 / 开关 / 命令回调」。
//
// 上游在 IDEA 里是 `EditorInlayHintsProvider` 的画层；CodeMirror 没有内建 inlay，
// 等价物是 `Decoration.widget`（`InlayWidget`）。
//
// 这一版接上的是三条**此前只有规则、没有消费链路**的东西：
//   ① 渲染前归位（`layoutInlayHints`）：开关过滤 → 排序 → 同位置去重与优先级（参数名 > 类型）。
//      服务器可能在同一位置同时发参数名与类型提示，原来"先到先得"，两个 widget 会叠在一起。
//   ② 悬停说明（`tooltip`）：宿主转发的是 LSP `InlayHint.tooltip`（字符串或 MarkupContent），
//      上游对应物是 declarative sink 的同一对参数
//      （`platform/lang-api/src/com/intellij/codeInsight/hints/declarative/InlayTreeSink.kt:27-31`
//      的 `tooltip: String?` 与 `payloads`）。
//   ③ 点击动作（`command`）：有命令的提示是可点的，按下即执行 `workspace/executeCommand`；
//      没有命令的仍然是只读 span（`inlayHintCommand` 给 null）。
import { RangeSetBuilder, StateEffect, StateField, type Extension } from '@codemirror/state'
import { Decoration, EditorView, WidgetType } from '@codemirror/view'
import { request, type LspInlayHintResult } from './bridge.ts'
import { lspPosition } from './editorDiagnosticMarkers.ts'
import { inlayHintCommand, inlayHintTooltip, DEFAULT_INLAY_HINT_TOGGLES, type InlayHintToggles } from './inlayHints.ts'
import { layoutInlayHints, NO_INLAY_HINT_LINE_LIMIT } from './inlayHintLayout.ts'

interface HintEntry {
  from: number
  text: string
  padLeft: boolean
  padRight: boolean
  /** 有值的提示可点（`inlayHintCommand` 的结果）；`undefined` = 只读。 */
  command?: { command: string; arguments?: unknown[] }
  /** 悬停说明（`inlayHintTooltip`：有 tooltip 用它，否则说清这是参数名/类型提示）。 */
  tooltip: string
}

class InlayWidget extends WidgetType {
  // 不用构造器参数属性：`node --test` 的类型擦除模式不支持它（`ERR_UNSUPPORTED_TYPESCRIPT_SYNTAX`），
  // 判据（`tests/inlay-hint-interaction.test.mjs`）要读这一类的源码。
  readonly entry: HintEntry
  readonly onCommand: (command: string, args?: unknown[]) => void
  constructor(entry: HintEntry, onCommand: (command: string, args?: unknown[]) => void) {
    super()
    this.entry = entry
    this.onCommand = onCommand
  }
  eq(other: InlayWidget) {
    return other.entry.text === this.entry.text
      && other.entry.padLeft === this.entry.padLeft && other.entry.padRight === this.entry.padRight
      && other.entry.command?.command === this.entry.command?.command
  }
  toDOM() {
    const label = `${this.entry.padLeft ? ' ' : ''}${this.entry.text}${this.entry.padRight ? ' ' : ''}`
    const command = this.entry.command
    if (!command) {
      const span = document.createElement('span')
      span.className = 'cm-lsp-inlay'
      span.textContent = label
      // 悬停说明走原生 title：没有可点的命令时这就是这条提示唯一的交互。
      if (this.entry.tooltip) span.title = this.entry.tooltip
      return span
    }
    // 有命令 ⇒ 画成按钮：提示本身是"点一下会发生某件事"的入口（上游 sink 的 payloads 同一件事）。
    const button = document.createElement('button')
    button.type = 'button'
    button.className = 'cm-lsp-inlay cm-lsp-inlay-actionable'
    button.textContent = label
    button.title = this.entry.tooltip
    button.setAttribute('aria-label', this.entry.tooltip)
    button.addEventListener('mousedown', event => {
      // 吃掉这次按下：点击提示是**执行命令**，不该顺手把光标挪到那一列。
      event.preventDefault()
      event.stopPropagation()
      this.onCommand(command.command, command.arguments)
    })
    return button
  }
  // 必须 false：否则 CodeMirror 把点击当编辑器交互吞掉，按钮永远收不到事件（同 codeLensExtension.ts）。
  ignoreEvent() { return false }
}

export const setInlayHints = StateEffect.define<HintEntry[]>()

function hintField(onCommand: (command: string, args?: unknown[]) => void): StateField<HintEntry[]> {
  return StateField.define<HintEntry[]>({
    create: () => [],
    update(value, transaction) {
      for (const effect of transaction.effects) if (effect.is(setInlayHints)) return effect.value
      return value
    },
    provide: f => EditorView.decorations.compute([f], state => {
      const builder = new RangeSetBuilder<Decoration>()
      for (const hint of [...state.field(f)].sort((a, b) => a.from - b.from))
        builder.add(hint.from, hint.from, Decoration.widget({ widget: new InlayWidget(hint, onCommand), side: 1 }))
      return builder.finish()
    }),
  })
}

export interface InlayHintDeps {
  enabled: () => boolean
  path: () => string
  view: () => EditorView | undefined
  /**
   * 三档开关（`src/inlayHints.ts` 的 `InlayHintToggles`）：InlaySettingsConfigurable（`inlay.hints`）
   * 按 provider 勾的那三格，在这里按 LSP `kind` 落地。宿主每次拉取都重新问一遍，
   * 所以设置一改再 `schedule()` 就能生效，不必重建控制器。
   */
  toggles?: () => InlayHintToggles
  /**
   * 点击一条**带命令**的提示 → 执行它（`workspace/executeCommand`）。
   * 没有这个回调时带命令的提示仍然画出来，但点不动（`onCommand` 缺省为 no-op）。
   */
  onCommand?: (command: string, args?: unknown[]) => void
}

const DEBOUNCE_MS = 250

export function createInlayHints(deps: InlayHintDeps) {
  let timer: number | undefined
  let generation = 0

  async function run() {
    const editor = deps.view()
    if (!editor || !deps.enabled()) return
    const current = ++generation
    // 三档开关先取一次：这一拍里用它过滤（InlaySettingsConfigurable 的逐 provider 勾选）。
    const toggles = deps.toggles?.() ?? DEFAULT_INLAY_HINT_TOGGLES
    try {
      const result = await request<LspInlayHintResult>('lsp.request', { kind: 'inlayHint', path: deps.path(), line: 0, character: 0 })
      const target = deps.view()
      if (!target || current !== generation) return
      // 渲染前归位：开关 → 排序 → 同位置去重/优先级（纯规则在 `src/inlayHintLayout.ts`）。
      // 逐行条数**不设上限**：上游的上限是单条提示自己的 presentation 节点预算，不是"一行几条"，
      // 理由与出处见 `NO_INLAY_HINT_LINE_LIMIT`。
      const layout = layoutInlayHints(result.hints, toggles, { maxPerLine: NO_INLAY_HINT_LINE_LIMIT })
      const entries = layout.hints.flatMap(hint => {
        try {
          const from = lspPosition(target.state.doc, hint.line, hint.character)
          return [{
            from,
            text: hint.label,
            padLeft: !!hint.paddingLeft,
            padRight: !!hint.paddingRight,
            command: inlayHintCommand(hint) ?? undefined,
            tooltip: inlayHintTooltip(hint),
          }]
        } catch { return [] }
      })
      target.dispatch({ effects: setInlayHints.of(entries) })
    } catch { /* 服务器忙；下一次编辑再问 */ }
  }

  function schedule() {
    if (!deps.enabled()) return
    if (timer !== undefined) clearTimeout(timer)
    timer = window.setTimeout(() => { timer = undefined; void run() }, DEBOUNCE_MS)
  }

  function clear() {
    ++generation
    deps.view()?.dispatch({ effects: setInlayHints.of([]) })
  }

  function dispose() {
    ++generation
    if (timer !== undefined) clearTimeout(timer)
    timer = undefined
  }

  return {
    extension: [
      hintField((command, args) => deps.onCommand?.(command, args)) as Extension,
      // 样式跟这一个能力走：可点的提示是按钮，要去掉浏览器默认的边框/底色/字号，
      // 才和旁边只读的 `.cm-lsp-inlay`（`src/editorTheme.ts`）看起来一样。
      EditorView.theme({
        '.cm-lsp-inlay-actionable': {
          background: 'transparent', border: 'none', padding: '0', margin: '0',
          font: 'inherit', color: 'inherit', cursor: 'pointer',
        },
        '.cm-lsp-inlay-actionable:hover': { textDecoration: 'underline' },
      }),
    ],
    schedule, clear, dispose,
  }
}
