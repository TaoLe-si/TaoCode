// Live Template / Emmet 的**展开会话**（上游 `ExpandLiveTemplateAction` / `PostfixCompletionProposalAgent` 一族）。
//
// 从 `src/components/CodeEditor.vue` 拆出来（那个文件贴着机检上限，见 tests/module-size.test.mjs 的 REGISTERED）：
// 这里只吃「当前文件路径 + 模板来源」三个取值函数，与组件状态无关 —— 与 `src/editorMergeHost.ts` 同一种拆法。
//
// 分工：
//   · `src/templates.ts`  纯规则（候选表、展开算式、占位符区间）—— 零依赖、可单测；
//   · `src/emmetHtml.ts`  Emmet 缩写展开（纯函数；非法缩写抛 `EmmetHtmlError`）；
//   · 本模块              把上面两层接成三个编辑器动作 + 一个补全源，并自持**待走占位符清单**：
//                         `Tab` 第一档（下一个占位符）、`Tab` 第二档（Emmet 缩写）、
//                         菜单/动作面的 `template.expand` 即时展开，以及模板候选那份补全源。
// 宿主的 `mergeCompletion` 取 `completionSource` 与语言服务成员候选合流（`src/completionMerge.ts`）。

import type { EditorView } from '@codemirror/view'
import type { CompletionContext, CompletionResult } from '@codemirror/autocomplete'
import { candidates as templateCandidates, expand as expandTemplateAt, type PluginTemplateSource, type TemplateSettings } from './templates.ts'
import { EmmetHtmlError, expandEmmetHtml } from './emmetHtml.ts'

/** 宿主注入的事实 —— 传取值函数而不是值：这些 props 在 setup 之后仍会变。 */
export interface TemplateExpansionDeps {
  /** 当前文件路径：模板适用语言与 Emmet 的文件类型门都看它。 */
  path: () => string
  templates: () => TemplateSettings
  pluginTemplates: () => PluginTemplateSource[] | undefined
}

export interface TemplateExpansion {
  /** `Expand Live Template`：光标处的实时模板 / 后置模板展开成编辑器事务。 */
  expand: (view: EditorView) => boolean
  /** `Tab` 的第二档：没有待走占位符时试 Emmet 缩写展开。 */
  nextStopOrExpandEmmet: (view: EditorView) => boolean
  /** 文档变更后清掉待走占位符（宿主 updateListener 在每次 `docChanged` 时调）。 */
  resetStops: () => void
  /** 模板候选的补全源（宿主与语言服务成员候选合流，见 `src/completionMerge.ts`）。 */
  completionSource: (context: CompletionContext) => CompletionResult | null
}

export function createTemplateExpansion(deps: TemplateExpansionDeps): TemplateExpansion {
  // 待走的占位符（`$1`…）：展开时写入，`Tab` 逐个吃掉；文档一变由宿主清空。
  let templateStops: { from: number; to: number }[] = []

  // Live templates (IDEA's Expand Live Template / postfix completion). The pure rules
  // live in src/templates.ts; here they only become editor transactions.
  function expand(view: EditorView): boolean {
    const head = view.state.selection.main.head
    const line = view.state.doc.lineAt(head)
    const result = expandTemplateAt(line.text, head - line.from, deps.path(), deps.templates(), deps.pluginTemplates())
    if (!result) return false
    const from = line.from + result.start, to = line.from + result.end
    const stops = result.stops.map(stop => ({ from: from + stop.start, to: from + stop.end }))
    const first = stops[0]
    view.dispatch({
      changes: { from, to, insert: result.text },
      // IDEA selects the first slot so the very next keystroke replaces it; without a
      // slot the caret goes to $END$.
      selection: first ? { anchor: first.from, head: first.to } : { anchor: from + result.caret },
      scrollIntoView: true,
      userEvent: 'input.template',
    })
    // Assigned after the dispatch: the update listener clears pending stops on any doc
    // change, and this expansion is one.
    templateStops = stops.slice(1)
    return true
  }

  function nextTemplateStop(view: EditorView): boolean {
    if (!templateStops.length) return false
    const head = view.state.selection.main.head
    const remaining = templateStops.filter(stop => stop.from >= head)
    if (!remaining.length) { templateStops = []; return false }
    const [next, ...rest] = remaining
    templateStops = rest
    view.dispatch({ selection: { anchor: next.from, head: next.to }, scrollIntoView: true })
    return true
  }

  function expandEmmet(view: EditorView): boolean {
    const state = view.state
    if (state.readOnly || !/\.(?:html?|vue)$/i.test(deps.path()) || state.selection.ranges.length !== 1) return false
    const selection = state.selection.main
    if (!selection.empty) return false
    const line = state.doc.lineAt(selection.head)
    const prefix = line.text.slice(0, selection.head - line.from)
    const indent = /^\s*/.exec(prefix)?.[0] ?? ''
    const abbreviation = prefix.slice(indent.length)
    if (!abbreviation) return false
    let expanded: string
    try {
      expanded = expandEmmetHtml(abbreviation)
    } catch (error) {
      if (error instanceof EmmetHtmlError) return false
      throw error
    }
    const from = line.from + indent.length
    view.dispatch({
      changes: { from, to: selection.head, insert: expanded },
      selection: { anchor: from + expanded.length },
      scrollIntoView: true,
      userEvent: 'input.emmet',
    })
    return true
  }

  function completionSource(context: CompletionContext): CompletionResult | null {
    const info = context.state.doc.lineAt(context.pos)
    const list = templateCandidates(info.text, context.pos - info.from, deps.path(), deps.templates(), deps.pluginTemplates())
    if (!list.length) return null
    const word = context.matchBefore(/[A-Za-z_$][\w$]*$/)
    return {
      from: word?.from ?? context.pos,
      options: list.map(candidate => ({
        label: candidate.key,
        type: 'snippet',
        detail: candidate.description,
        info: candidate.detail === 'postfix' ? '后置模板：展开时把点号前的表达式作为接收者' : '实时模板',
        apply: (view: EditorView, _completion: unknown, from: number, to: number) => {
          view.dispatch({ changes: { from, to, insert: candidate.key }, selection: { anchor: from + candidate.key.length } })
          expand(view)
        },
      })),
    }
  }

  return {
    expand,
    nextStopOrExpandEmmet: view => nextTemplateStop(view) || expandEmmet(view),
    resetStops: () => { templateStops = [] },
    completionSource,
  }
}
