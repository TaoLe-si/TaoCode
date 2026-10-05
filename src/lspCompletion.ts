import { pickedCompletion, snippetCompletion, type Completion, type CompletionContext, type CompletionResult } from '@codemirror/autocomplete'
import type { EditorState } from '@codemirror/state'
import type { EditorView } from '@codemirror/view'
import type { LspCompletionItem, LspCompletionItemResolveResult, LspCompletionResult, LspTextEdit, LspWorkspaceSymbol } from './bridge.ts'
import { sortCompletions } from './completionSort.ts'
import { camelHumpMatcher } from './completionCamelHump.ts'
import { currentCompletion, expectsTypeNameAt, keepsByExpectedKind, keepsInMode, lookupPlaceholderText, symbolKindToItemKind } from './completionModes.ts'
import { isClassLikeSymbol, symbolKindName } from './lspSymbolBridge.ts'
import { planCompletionTail } from './completionInsertHandlers.ts'
import { lspSnippetTemplate, snippetContextOf } from './completionSnippets.ts'
import { commandCompletionContributor, findCommandInvocation, type CommandInvocation } from './completionCommands.ts'
import { createContributorRegistry, wordCompletionContributor, type ContributorItem } from './completionContributors.ts'
import { registerOpenEditor } from './completionOpenEditors.ts'
import { ACTIONS } from './actionRegistry.ts'
import { keymapKeys } from './keymapBindings.ts'

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

/**
 * 「主编辑 + `additionalTextEdits`」排成**一次 dispatch** 能吃的顺序。上游的契约有三条：
 *   · 只应用**起点不晚于**主编辑的那些附加编辑 —— `handleAdditionalTextEdits`
 *     （`LspCompletionItemInsertHandler.kt:34-48`，`:42-45` 那个 `filter`）的注释说得很直白：
 *     起点在主编辑之后的偏移量「没法和 IJ 平台自己的插入对齐」，先不碰；
 *   · 编辑区间**不许相交** —— 协议原文被引在 `Lsp4jUtil.kt:111-114`
 *     （> Text edits ranges must never overlap.）；相交的后来那条丢掉，不让脏文本进文档；
 *   · **同起点的多个插入按数组顺序落地**（同处 `:113-114`：> the order in the array defines the
 *     order in which the inserted strings appear）。上游先应用附加编辑再由平台插正文
 *     （`LspCompletionItemInsertHandler.kt:24-25`），所以同起点时附加在前、正文在后。
 * CodeMirror 那边同样按数组顺序拼段（`ChangeSet.of`，@codemirror/state `dist/index.js:969-983`），
 * 这个函数就是把那三条顺序契约落成「升序、非相交、同起点附加在前」的一维数组。
 * 主编辑永远保留（它是要写进文档的那一条），相交时丢的是附加编辑。
 */
function sortedChanges(main: Change | null, extras: readonly Change[]): Change[] {
  const ordered = extras
    .filter(extra => !main || extra.from <= main.from)
    .sort((left, right) => left.from - right.from)
  const kept: Change[] = []
  let guard = -1   // 前一条**附加**编辑占到的最右位置（附加编辑互相不许相交）
  for (const extra of ordered) {
    if (extra.from < guard) continue                                   // 与前一条附加编辑相交
    if (main && extra.from < main.to && extra.to > main.from) continue // 与主编辑相交：丢附加、保主
    kept.push(extra)
    if (extra.to > guard) guard = extra.to
  }
  return main ? [...kept, main] : kept
}

/**
 * 命令补全能用的本地动作面。`ACTIONS` 是上游 `ActionManager` 的等价物
 * （`src/actionRegistry.ts` 文件头）：`present()` 给文案与可用性（对上
 * `AbstractActionCompletionCommand.kt:103-117` 的 `isApplicable`），`run()` 执行
 * （对上同文件 `:249-265` 的 `execute`），`keymapKeys()` 给快捷键文本
 * （`additionalInfo`，`:234-241`）。
 */
const localActions = {
  ids: () => ACTIONS.ids(),
  titleOf: (id: string) => ACTIONS.titleOf(id),
  isAvailable: (id: string) => ACTIONS.present(id)?.enabled === true,
  keysOf: (id: string) => keymapKeys(id) || undefined,
}

/**
 * 本地贡献者表：`mode: 'always'` 的（命令补全）与 LSP 条目**并排**出现在一个弹层里
 * （上游 `CommandCompletionProvider.kt:123-139` 先放行别的贡献者的结果、再加命令条目）；
 * `mode: 'fallback'` 的（文档词补全）只在服务端一条都没回时接上
 * （上游是 `LspCompletionContributor.kt:45` 那条 `FORBID_WORD_COMPLETION` 禁令的等价物：
 * 有 LSP 客户端接管这个文件就不掺词补全）。
 */
const localContributors = createContributorRegistry([
  wordCompletionContributor(),
  commandCompletionContributor(localActions),
])

/** 命令条目接受后的动作（上游 `CommandInsertHandler.kt:96-103` + `ActionUtil.performAction`）。 */
function applyCommand(item: ContributorItem) {
  return (editor: EditorView) => {
    if (editor.state.readOnly) return
    const action = item.action
    if (!action) return
    const to = editor.state.selection.main.head
    if (to < action.from) return
    editor.dispatch({
      changes: { from: action.from, to, insert: '' },
      selection: { anchor: action.from },
      userEvent: 'input.complete',
      scrollIntoView: true,
    })
    ACTIONS.run(action.id)
  }
}

/** 词条目接受后：把命中的词插到替换区间上（上游 `WordCompletionContributor` 走普通 LookupElement）。 */
function applyWord(item: ContributorItem) {
  return (editor: EditorView, _completion: unknown, from: number, to: number) => {
    if (editor.state.readOnly) return
    const insert = item.insertText ?? item.label
    editor.dispatch({
      changes: { from, to, insert },
      selection: { anchor: from + insert.length },
      userEvent: 'input.complete',
    })
  }
}

/**
 * 本地条目 → CodeMirror 候选。命令条目的过滤**已经在贡献者里做完**（上游用
 * `CamelHumpMatcher`，`CommandCompletionProvider.kt:237`），所以「别让 CodeMirror 再按
 * `from..pos` 的原文过滤一遍」这件事只能在**结果**上做 —— `filter` 不是 `Completion` 的字段，
 * 它挂在 `CompletionResult` 上（@codemirror/autocomplete `dist/index.d.ts:277`），运行时也只
 * 读结果级的那一个（`dist/index.js:787` 的 `a.result.filter === false`）。见下面的返回处。
 */
function localOption(item: ContributorItem): Completion {
  const command = item.kind === 'command'
  return {
    label: item.label,
    displayLabel: item.label,
    type: command ? 'command' : 'word',
    detail: item.detail,
    apply: command ? applyCommand(item) : applyWord(item),
  }
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
    const path = deps.path()
    // 「现在开着哪些编辑器」这张表在本仓的**生产者**：每个编辑器实例被补全查询经过时登记
    // 自己的路径 + 实时正文的取法。这是上游 `HippieWordCompletionHandler.java:271-277` 那句
    // `FileEditorManager.getAllEditors()` 在本仓能找到的唯一装配点（`CodeEditor.vue` 是保留文件）。
    // 句柄失效（组件卸载后 `deps.view()` 回 undefined）时正文是空串，由
    // `completionOpenEditors.ts` 当下一次查询经过时清掉。
    if (path) registerOpenEditor(path, () => deps.view()?.state.sliceDoc() ?? '')
    if (!deps.enabled()) return null
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
      if (context.aborted || !current()) return null
      const word = context.matchBefore(/[\p{L}\p{N}_$]+$/u)
      // 词补全要扫全文（上游 `WordCompletionContributor` 的 `WordsScanner`），超大文档直接不掺。
      const text = doc.toString()
      const scan = text.length <= 1_000_000
      const contributorContext = { text, offset: context.pos, language: path.slice(path.lastIndexOf('.') + 1) }
      // 命令补全的调用点（`foo.` / `foo..` / 行首）：上游 `CommandCompletionProvider.kt:186`
      // `findCommandCompletionType(...) ?: return`，不是调用点就一条命令都不给。
      const invocation: CommandInvocation | null = scan ? findCommandInvocation(text, context.pos) : null
      // 与语义条目**并排**的本地条目（上游 `CommandCompletionProvider.kt:123-139` 先
      // `runRemainingContributors` 把别人的结果放行，再加命令条目）。
      const commands = invocation ? localContributors.contributeAll(contributorContext, 'always') : []
      const serverItems = result.available && result.items?.length ? result.items : []
      // —— 这一次调用是哪种形态（`$default.xml:732-734` Ctrl+Space、`:909-911` Ctrl+Shift+Space、
      // `:843-845` Ctrl+Alt+Space）—— 键位那一层在 `completionUi.ts` 把模式与「第几次调用」记进
      // `completionModes.ts`（上游那份状态挂在 `CompletionPhase` 上，`CodeCompletionHandlerBase.java:210-213`）。
      const editor = deps.view()
      const call = editor ? currentCompletion(editor) : { mode: 'basic' as const, invocationCount: 1 }
      const typePosition = scan && expectsTypeNameAt(text, context.pos)
      // 类名档把**工程里的类名**也捞进表：上游 `JavaClassNameCompletionContributor.java:69-77` 的
      // `addAllClasses` 走 `allScope(project)`，本仓的等价数据源是 LSP `workspace/symbol`，
      // 类型门照 `platform/lsp-impl/src/impl/features/workspaceSymbol/LspGoToClassContributor.kt:6-8`
      // 的 Class/Interface/Enum/Struct 四类。
      let projectClasses: LspCompletionItem[] = []
      if (call.mode === 'className' && (word?.text.length ?? 0) >= 2) {
        try {
          const symbols = await deps.request<{ available?: boolean; symbols?: LspWorkspaceSymbol[] }>(
            'lsp.request', { kind: 'workspaceSymbol', path, query: word!.text })
          if (!context.aborted && current()) {
            projectClasses = (symbols.available ? symbols.symbols ?? [] : [])
              .filter(symbol => isClassLikeSymbol(symbol))
              .slice(0, 50)
              .map(symbol => ({
                label: symbol.name, kind: symbolKindToItemKind(symbol.kind),
                detail: symbol.path, apply: symbol.name,
              }))
          }
        } catch (error) { report(error) }
      }
      // 模式过滤：类名档只留类型类条目；智能档只在位置明确「在等一个类型」时收窄
      // （卡点见 `src/completionModes.ts` 文件头 —— LSP 没有"期望类型"这个字段）。
      const matchedItems = [...serverItems, ...projectClasses].filter(item =>
        keepsInMode(call.mode, item, call.invocationCount) && keepsByExpectedKind(call.mode, item, typePosition))
      // 服务端一条都没回 → 文档词补全接上（上游是 `LspCompletionContributor.kt:45` 的
      // `FORBID_WORD_COMPLETION` 禁令：有 LSP 客户端接管这个文件就不掺词补全）。
      const words = matchedItems.length || !scan ? [] : localContributors.contributeAll(contributorContext, 'fallback')
      // `..` 只留命令：上游 `supportFiltersWithDoublePrefix()`（`CommandCompletionSuffixProvider.kt:30-36`）
      // 说双点会把非命令条目过滤掉。
      const onlyCommands = invocation?.kind === 'full-suffix'
      // 语言服务没起来时不撒「无建议」这个谎 —— 那是"补全不可用"，不是"没有匹配的建议"
      // （上游空表那行的文案出自 `LangBundle.properties:1`，用点 `LookupImpl.java:702-703`）。
      if (!matchedItems.length && !commands.length && !words.length && !result.available) return null
      lastError = ''
      // 弹层的前缀起点：命令形态下由**命令前缀**决定（上游 `:222` 用命令的 pattern 造前缀匹配器），
      // 没有服务端条目时取两者里靠后的那个（短前缀对 CodeMirror 的过滤更友好）。
      const serverFrom = word?.from ?? context.pos
      const commandFrom = context.pos - (invocation?.pattern.length ?? 0)
      const from = onlyCommands || !matchedItems.length ? Math.min(serverFrom, commandFrom) : serverFrom
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
      // 顺序在交给 CodeMirror 之前排好（src/completionSort.ts：IDEA 排序器链的六档 —— 预选、
      // LSP sortText 相关性、**匹配形状**（打出来的前缀/驼峰命中排在只含关键字的前面）、大小写不敏感、
      // 长度、字母序），它自己的 sortText 排序从此不参与语义；这里只排候选表，`Completion` 对象的形状不变。
      const ordered = sortCompletions(matchedItems
        .map(item => {
          const raw = item.raw as (RawItem & { sortText?: unknown; preselect?: unknown }) | undefined
          // `sortText` 缺省就**留空**（上游 weigher 对没有它的项返回 null → 那一档不参与）。
          return [
            item,
            typeof raw?.sortText === 'string' ? raw.sortText : undefined,
            raw?.preselect === true,
          ] as const
        })
        .map(([item, sortText, preselected]) => ({ item, label: item.label, sortText, preselected, typedPrefix: word?.text })))
      // 本地条目排在服务端候选之后；同名（大小写不敏感）以服务端为准（`completionContributors.ts` 文件头）。
      const taken = new Set(ordered.map(entry => entry.item.label.toLowerCase()))
      const locals = (onlyCommands ? commands : [...commands, ...words])
        .filter(item => !taken.has(item.label.toLowerCase()))
        .map(localOption)
      const serverOptions = onlyCommands ? [] : ordered.map(({ item }) => ({
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
        apply: async (editor: EditorView, completion: Completion, from: number, to: number) => {
          if (!current() || editor.state.readOnly) return
          const selection = editor.state.selection
          try {
            // Enter can beat the async info tooltip. Resolve here as well so
            // accepting a type never silently loses its required import.
            const detail = await resolve(item)
            if (!current() || !editor.state.selection.eq(selection) || editor.state.readOnly) return
            const raw = { ...(item.raw as RawItem ?? {}), ...detail?.raw }
            const state = editor.state
            // 上游的插入顺序（`LspCompletionItemInsertHandler.kt:23-31`）：附加编辑 → 条目自身的
            // 插入处理器 → snippet → command。snippet 那一支（`:50-60` `handleSnippetFormat`）不写
            // 普通文本，改跑 CodeMirror 的 snippet 引擎：插入后光标落在第一个占位符上、Tab 在
            // 字段间跳 —— 就是上游 `TemplateManager.runTemplate` 的实时模板。
            if (raw.insertTextFormat === 2) {
              const template = lspSnippetTemplate(
                raw.insertText ?? detail?.apply ?? item.apply ?? item.label,
                snippetContextOf(state, from, path))
              const extra = sortedChanges(null, extraChanges(state, detail?.additionalTextEdits, raw))
              if (extra.length) editor.dispatch({ changes: state.changes(extra), userEvent: 'input.complete' })
              const option = snippetCompletion(template, { label: item.label, type: 'snippet', detail: item.detail })
              // `Completion.apply` 的类型是 `string | fn | undefined`（@codemirror/autocomplete
              // `dist/index.d.ts:48`），`snippetCompletion` 装的一定是函数（`:525`），先收窄再调。
              const insert = option.apply
              if (typeof insert === 'function') insert(editor, option, from, to)
            } else {
              const main = raw.textEdit
                ? rangeChange(state, raw.textEdit.range, raw.textEdit.newText)
                : { from, to, insert: detail?.apply ?? raw.insertText ?? item.apply ?? item.label }
              // 插入处理器 / 尾类型（`AddSpaceInsertHandler`、`TailType`，见
              // src/completionInsertHandlers.ts）：关键字补一个空格（后继已是空格就
              // 把光标越过去），方法/函数条目补 `()` 并把光标落在括号内。尾文本并进
              // 主编辑的同一次 dispatch，不留下「插入条目」与「补尾」两个 undo 步。
              const tail = planCompletionTail(state.doc.sliceString(main.to, main.to + 2), item.kind, main.insert)
              const changeSet = state.changes(sortedChanges(
                { ...main, insert: main.insert + tail.insert },
                extraChanges(state, detail?.additionalTextEdits, raw)))
              const anchor = changeSet.mapPos(main.to, 1) - (tail.insert.length - tail.caret)
              editor.dispatch({ changes: changeSet,
                selection: { anchor },
                annotations: pickedCompletion.of(completion), userEvent: 'input.complete', scrollIntoView: true })
            }
            if (raw.command?.command) {
              synced = ''
              await deps.sync(editor.state)
              await deps.request('lsp.request', { kind: 'executeCommand', path,
                command: raw.command.command, arguments: raw.command.arguments ?? [] })
            }
          } catch (error) { report(error) }
        },
      }))
      // **弹层的过滤由本仓做**，CodeMirror 那份关掉（`filter: false`，
      // @codemirror/autocomplete `dist/index.d.ts:271-277`）。判据是上游的 `CamelHumpMatcher`：
      // 谁留在表里 = `prefixMatches`（`CamelHumpMatcher.java:80-119`）、命中哪几个字符 =
      // `matchingFragments`（`:184-186`）、谁排在前面 = `RealPrefixMatchingWeigher` 的
      // `-matchingDegree`（`:12-27`，注册点 `BaseCompletionService.java:215-216`）。
      // 移植见 `src/completionCamelHump.ts`。命令形态用**命令前缀**当 pattern
      // （`CommandCompletionProvider.kt:222,237`），否则用光标前那段标识符。
      const pattern = invocation ? invocation.pattern : word?.text ?? ''
      const matcher = camelHumpMatcher(pattern)
      const keeps = (option: Completion): boolean => {
        if (!pattern) return true
        const visible = String(option.displayLabel ?? option.label)
        return matcher.matches(visible) || matcher.matches(String(option.label))
      }
      const options = [...serverOptions, ...locals].filter(keeps)
      // 一行都不剩时不是"不弹层"，而是弹一行占位（`LookupImpl.java:702-703` 塞 `EmptyLookupItem`，
      // 文案 `LangBundle.properties:1`）；占位行**不是条目**：`apply` 什么都不插
      // （`EmptyLookupItem.java:19-22` 那条"must never be inserted into the document"）。
      if (!options.length) {
        return {
          from, filter: false,
          options: [{
            label: lookupPlaceholderText(false), displayLabel: lookupPlaceholderText(false),
            detail: '', type: 'text', apply: () => {},
          } satisfies Completion],
          getMatch: () => [],
        }
      }
      return {
        from,
        // No validFor: every edit requests a fresh semantic result (also handles
        // CompletionList.isIncomplete without reusing an incomplete/stale list).
        // LSP `filterText` 是**过滤键**、不一定是可见文本（别名/缩写就是靠它）⇒ 有 filterText 时
        // 把 label 设成它、可见文本交给 `displayLabel`，`getMatch` 按可见文本算命中段。
        filter: false,
        options,
        getMatch: option => matcher.matchRanges(String(option.displayLabel ?? option.label)),
      }
    } catch (error) { if (!context.aborted && current()) report(error); return null }
  }
}
