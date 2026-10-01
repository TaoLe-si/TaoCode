import { pickedCompletion, type CompletionContext, type CompletionResult } from '@codemirror/autocomplete'
import type { EditorState } from '@codemirror/state'
import type { EditorView } from '@codemirror/view'
import type { LspCompletionItem, LspCompletionItemResolveResult, LspCompletionResult, LspTextEdit } from './bridge'
import { sortCompletions } from './completionSort.ts'

interface CompletionDeps {
  enabled: () => boolean
  path: () => string
  view: () => EditorView | undefined
  sync: (state: EditorState) => Promise<unknown>
  request: <T>(method: 'lsp.request', params: Record<string, unknown>) => Promise<T>
  reportError: (message: string) => void
}
type RawItem = { insertText?: string; insertTextFormat?: number; additionalTextEdits?: { newText: string; range: WireRange }[];
  textEdit?: { newText: string; range: WireRange }; command?: { command: string; arguments?: unknown[] } }
type WireRange = { start: { line: number; character: number }; end: { line: number; character: number } }
type ResolvedItem = LspCompletionItemResolveResult & { raw?: RawItem }
type Change = { from: number; to: number; insert: string }

function offset(state: EditorState, line: number, character: number): number {
  if (!Number.isInteger(line) || !Number.isInteger(character) || line < 0 || line >= state.doc.lines || character < 0)
    throw new Error('语言服务器返回了无效的补全编辑位置')
  const info = state.doc.line(line + 1)
  if (character > info.length) throw new Error('语言服务器返回了越界的补全编辑位置')
  return info.from + character
}
function rangeChange(state: EditorState, range: WireRange, insert: string): Change {
  const from = offset(state, range.start.line, range.start.character)
  const to = offset(state, range.end.line, range.end.character)
  if (to < from) throw new Error('语言服务器返回了倒置的补全编辑区间')
  return { from, to, insert }
}
function extraChanges(state: EditorState, edits: LspTextEdit[] | undefined, raw: RawItem): Change[] {
  if (edits) return edits.map(edit => rangeChange(state, {
    start: { line: edit.startLine, character: edit.startChar }, end: { line: edit.endLine, character: edit.endChar },
  }, edit.text))
  return (raw.additionalTextEdits ?? []).map(edit => rangeChange(state, edit.range, edit.newText))
}

/** Java/C++ 语义补全的唯一实现：只发 LSP 请求，没有关键字或字典回退。
 *
 * 三条与 IDEA 对齐的约束（上游坐标）：
 *   · `CodeCompletionHandlerBase.java:339-349` 先 commit 文档再问 contributors，
 *     所以这里在查询**之前**同步 didChange，而不是等 400ms 输入去抖；
 *   · `LspCompletionObject.kt:44` 在接受某一项时才发 `completionItem/resolve`，
 *     Enter 快过 info 提示时也必须在 apply 里补这一次解析（否则自动 import 丢失）；
 *   · `CompletionAutoPopupHandler.java:43-49` 打字即弹，`.`/`@` 之类触发字符也走
 *     同一个入口 —— 所以这里没有"仅在标识符后触发"的过滤。
 *
 * 上游对同一动作的处理见 `JavaTypedHandlerBase.java:148-149`（`#`/`.` 触发成员补全）
 * 与 `:576-584`（关键字后触发）。
 */
export function createLspCompletion(deps: CompletionDeps) {
  let lastError = ''
  let synced = ''
  // Host::request cancels the previous completion when a new one starts
  // (native/lsp_host.cpp is_superseding), and a server may also drop a request it
  // considers obsolete. That is normal typing churn, not a broken dependency, so
  // it must not become a toast on every keystroke.
  const transient = (error: unknown) => /CANCELLED|Request cancelled|content modified/i.test(
    error instanceof Error ? error.message : String(error))
  const report = (error: unknown) => {
    if (transient(error)) return
    const message = `代码补全不可用：${error instanceof Error ? error.message : String(error)}`
    if (message !== lastError) { lastError = message; deps.reportError(message) }
  }
  return async (context: CompletionContext): Promise<CompletionResult | null> => {
    if (!deps.enabled()) return null
    const path = deps.path()
    const doc = context.state.doc
    const current = () => deps.enabled() && deps.path() === path && deps.view()?.state.doc === doc
    // No `validFor` is returned below, so the query must die with the document it
    // was computed against: CodeMirror only honours onDocChange when a listener is
    // registered, and LSP edit ranges are only valid for their own snapshot.
    context.addEventListener('abort', () => {}, { onDocChange: true })
    try {
      // IDEA's daemon has no "debounce before you may look": the document must be
      // committed before the contributors see it, so a request that races the
      // 400ms typing debounce would answer from a stale buffer (CodeCompletionHandlerBase.java:339-349).
      if (synced !== doc.toString()) {
        await deps.sync(context.state)
        synced = doc.toString()
      }
      if (context.aborted || !current()) return null
      const line = doc.lineAt(context.pos)
      const result = await deps.request<LspCompletionResult>('lsp.request', {
        kind: 'completion', path, line: line.number - 1, character: context.pos - line.from,
      })
      if (context.aborted || !current() || !result.available || !result.items?.length) return null
      lastError = ''
      const word = context.matchBefore(/[\p{L}\p{N}_$]+$/u)
      // Cache by item identity within ONE result, not by label across requests:
      // overloads and same-named types can carry different resolve data/imports.
      const resolved = new Map<LspCompletionItem, Promise<ResolvedItem | null>>()
      const resolve = (item: LspCompletionItem) => {
        let pending = resolved.get(item)
        if (!pending) {
          pending = item.raw ? deps.request<ResolvedItem>('lsp.request', {
            kind: 'completionItemResolve', path, line: 0, character: 0, raw: item.raw,
          }).then(value => value.supported && value.available ? value : null) : Promise.resolve(null)
          resolved.set(item, pending)
        }
        return pending
      }
      // 顺序在交给 CodeMirror 之前排好（src/completionSort.ts：IDEA 排序器链的四档 + 预选），
      // 它自己的 sortText 排序从此不参与语义；这里只排候选表，`Completion` 对象的形状不变。
      const ordered = sortCompletions(result.items
        .filter(item => (item.raw as RawItem | undefined)?.insertTextFormat !== 2)
        .map(item => {
          const raw = item.raw as (RawItem & { sortText?: unknown; preselect?: unknown }) | undefined
          return [
            item,
            typeof raw?.sortText === 'string' ? raw.sortText : item.label,
            raw?.preselect === true,
          ] as const
        })
        .map(([item, sortText, preselected]) => ({ item, label: item.label, sortText, preselected })))
      return {
        from: word?.from ?? context.pos,
        // No validFor: every edit requests a fresh semantic result (also handles
        // CompletionList.isIncomplete without reusing an incomplete/stale list).
          // LSP `filterText` 是**过滤键**、不一定是可见文本（别名/缩写就是靠它），而 CodeMirror 的
          // 过滤走 `label` ⇒ 有 filterText 时把 label 设成它、可见文本交给 `displayLabel`；
          // `completionMatch` 会把高亮范围按 displayLabel 里的偏移重算回来（那里记着这条约定）。
          label: typeof (item.raw as (RawItem & { filterText?: unknown }) | undefined)?.filterText === 'string'
            ? (item.raw as RawItem & { filterText: string }).filterText
            : item.label,
          displayLabel: item.label,
          type: item.kind.toLowerCase(), detail: item.detail,
          info: async () => {
            try {
              if (!current()) return null
              const detail = await resolve(item)
              if (!current()) return null
              const text = detail?.documentation ?? item.documentation ?? detail?.detail ?? item.detail ?? ''
              if (!text) return null
              const dom = document.createElement('div')
              dom.className = 'completion-info'
              dom.textContent = text
              return { dom }
            } catch (error) { report(error); return null }
          },
          apply: async (editor, completion, from, to) => {
            if (!current() || editor.state.readOnly) return
            const selection = editor.state.selection
            try {
              // Enter can beat the async info tooltip. Resolve here as well so
              // accepting a type never silently loses its required import.
              const detail = await resolve(item)
              if (!current() || !editor.state.selection.eq(selection) || editor.state.readOnly) return
              const raw = { ...(item.raw as RawItem ?? {}), ...detail?.raw }
              const state = editor.state
              const main = raw.textEdit
                ? rangeChange(state, raw.textEdit.range, raw.textEdit.newText)
                : { from, to, insert: detail?.apply ?? raw.insertText ?? item.apply ?? item.label }
              const changes = [main, ...extraChanges(state, detail?.additionalTextEdits, raw)].sort((a, b) => a.from - b.from || a.to - b.to)
              for (let i = 1; i < changes.length; ++i)
                if (changes[i]!.from < changes[i - 1]!.to) throw new Error('语言服务器返回了重叠的补全编辑')
              const changeSet = state.changes(changes)
              editor.dispatch({ changes: changeSet,
                selection: { anchor: changeSet.mapPos(main.to, 1) },
                annotations: pickedCompletion.of(completion), userEvent: 'input.complete', scrollIntoView: true })
              if (raw.command?.command) {
                synced = ''
                await deps.sync(editor.state)
                await deps.request('lsp.request', { kind: 'executeCommand', path,
                  command: raw.command.command, arguments: raw.command.arguments ?? [] })
              }
            } catch (error) { report(error) }
          },
        })),
      }
    } catch (error) { if (!context.aborted && current()) report(error); return null }
  }
}
