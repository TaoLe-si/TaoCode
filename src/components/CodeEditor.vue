<script setup lang="ts">
import { nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { basicSetup } from 'codemirror'
import { Compartment, EditorSelection, EditorState, Prec, RangeSetBuilder, StateEffect, StateField, type Extension, type Text } from '@codemirror/state'
import { Decoration, EditorView, hoverTooltip, keymap, rectangularSelection, ViewPlugin, WidgetType, type Command, type DecorationSet, type ViewUpdate } from '@codemirror/view'
import { foldService, foldedRanges, indentUnit, syntaxHighlighting, unfoldEffect } from '@codemirror/language'
import { indentLess, indentMore } from '@codemirror/commands'
import { autocompletion, startCompletion, type CompletionContext, type CompletionResult } from '@codemirror/autocomplete'
import { forceLinting, lintGutter, linter, type Diagnostic } from '@codemirror/lint'
import type { Theme } from '../appearance'
import { editingCommands, runEditorCommand } from '../editorCommands'
import { foldingRanges, lspFoldService } from '../editorFolding'
import { createFoldingController } from '../editorFoldingController'
import { defaultCodeFoldingSettings, FOLDING_SETTING_ROWS, kindOfSetting } from '../editorFoldingSettings'
import { clipboardCommands, copyCutChannel } from '../editorClipboard'
import { gutterContextMenu, gutterIconsExtension, syncGutterIcons, type GutterIcon } from '../editorGutterIcons'
import { blameAnnotationsExtension, syncBlameAnnotations } from '../editorBlameAnnotations'
import type { BlameAnnotation } from '../blameAnnotations'
import { debugLineExtension, syncDebugLine } from '../editorDebugLine'
import { readStyledLines } from '../htmlExportDom'
import { whitespaceLayer } from '../editorWhitespace'
import { diagnosticMarkers, lspPosition } from '../editorDiagnosticMarkers'
import { editorOptionExtensions, editorTheme, syntaxColors } from '../editorTheme'
import { insertedText } from '../editorTyping'
import { copyToClipboard } from '../clipboard'
import { insertTextAtCaret, pasteChannel, replaceInsertedRange, type PasteEvent } from '../editorPaste'
import { NO_ERRORS_IN_FILE, nextErrorTarget } from '../gotoNextError'
import { clearPullDiagnostics, setPullDiagnostics } from '../bridge'
import { createLspCompletion } from '../lspCompletion'
import { completionUi } from '../completionUi'
import { mergeCompletionResults } from '../completionMerge'
import TargetChooserPopup from './TargetChooserPopup.vue'
import QuickDefinitionPopup from './QuickDefinitionPopup.vue'; import { createQuickDefinitionHost } from '../quickDefinitionHost.ts'
import { type ChooseTargetRow, type TargetLocation } from '../chooseTarget'; import { createChooseTargetHost } from '../chooseTargetHost'
import { createDeclarationNavigation } from '../declarationNavigation'
import { candidates as templateCandidates, expand as expandTemplateAt, defaultTemplateSettings, type PluginTemplateSource, type TemplateSettings } from '../templates'
import { wrapSelection, type SurroundTemplate } from '../surround'
import { applySemanticTokenEdits, decodeSemanticTokens, semanticTokenClass, type SemanticToken } from '../semanticTokens'
import type { InlineCompletionResult } from '../inlineCompletion'
import { inlineCompletionKeymap, inlineDecorationsField, inlineSuggestionField, setInlineSuggestion, suggestionFor } from '../inlineCompletionExtension'
import { describeLink, linkAt, type DocumentLink, type DocumentLinkResult } from '../documentLinks'
import { createDocumentLinks, linkField } from '../documentLinksExtension'
import { createCodeLens } from '../codeLensExtension'
import type { CodeLensResult } from '../codeLens'
import { lspDiagnostics, request, type DapBreakpoint, type EditorSettings, type LspHighlightResult, type LspDiagnosticReport, type LspFoldingRange, type LspFoldingRangeResult, type LspHoverResult, type LspInlayHintResult, type LspRange, type LspRangeSpan, type LspSelectionRangeResult, type LspSemanticTokensResult } from '../bridge'
// 编辑器内查找栏（上游 `SearchReplaceComponent` + `EditorSearchSession`，不是工程内的 `FindPopupPanel`）：
// 状态/高亮/导航在 src/editorSearchExtension.ts，匹配语义在 src/editorSearch.ts，宿主状态域在 src/editorFindController.ts。
import EditorFindBar from './EditorFindBar.vue'
// 合并冲突导航条（上游 `MergeThreesideViewer` 的按钮在本仓的落点）。
import MergeBar from './MergeBar.vue'
import { createMergeState } from '../editorMergeHost'
import { createFindController, findCommand as findBarCommand } from '../editorFindController'
// 插入/覆盖模式（`EditorToggleInsertStateAction`）：CodeMirror 没有这个能力，用事务过滤还原。
import { overwriteExtension, overwriteTheme, toggleOverwrite } from '../editorOverwrite'
import { createHintController } from '../editorHint'
import { editorSearchExtension } from '../editorSearchExtension'

const props = defineProps<{ content: string; path: string; language?: string; theme: Theme; active: boolean; settings: EditorSettings; templates: TemplateSettings; pluginTemplates?: PluginTemplateSource[]; lspEnabled: boolean; readOnly?: boolean; reveal?: { path: string; line: number } | null; breakpoints?: DapBreakpoint[]; debugLine?: number; bookmarks?: number[]; gutterIcons?: GutterIcon[]; blame?: BlameAnnotation[] }>()
const emit = defineEmits<{
  columnMode: [active: boolean]
  selection: [info: { characters: number; lines: number } | null]; cursors: [count: number]
  change: []; cursor: [line: number, column: number]; save: []; error: [message: string]; reveal: [target: { path: string; line: number; column?: number }]; semantic: [payload: { kind: 'rename' | 'references' | 'codeAction' | 'format' | 'signature' | 'implementation' | 'callHierarchy' | 'typeHierarchy' | 'typeDefinition'; path: string; line: number; character: number; range?: LspRange }]; evaluate: [expression: string]; breakpoint: [line1based: number]; surround: []; templateChooser: []; link: [link: DocumentLink]; codeLens: [payload: { command: string; arguments?: unknown[] }]; paste: [payload: PasteEvent]; gutterIcon: [icon: GutterIcon]; gutterIconMiddle: [icon: GutterIcon]; typing: [text: string]; gutterMenu: [at: { line: number; x: number; y: number }] }>()
const container = ref<HTMLDivElement>()
const language = new Compartment()
const appearance = new Compartment()
const options = new Compartment()
const lsp = new Compartment()
const indentGuides = new Compartment()
let view: EditorView | undefined
// 编辑器内查找栏的宿主侧状态域（上游 `SearchReplaceComponent` + `EditorSearchSession`）。传取值函数而不是 view：view 在 onMounted 才赋值，而控制器在 setup 期就要建好。
const findBar = createFindController(() => view, message => emit('error', message))
// 轻量信息提示（`HintManagerImpl`）：位置/自动消失的规则在 src/editorHint.ts。
const { hint: errorHint, show: showErrorHint, hide: hideErrorHint } = createHintController(() => view, () => container.value)
const findCommand = (backwards: boolean) => findBarCommand(findBar, backwards)
const openFindBar = (replaceMode: boolean) => { findBar.open(replaceMode); nextTick(() => findBarBar.value?.focus?.()) }
const findBarBar = ref<InstanceType<typeof EditorFindBar> | null>(null)
// 光标行（0 基）：合并冲突条的计数要读它。清单与两个动作来自 createMergeState —— 清单取**实时文档**
// （父级 tab.content 只在读盘/存盘时更新，编辑期间是旧的：真机抓到过接受一侧后计数停在 2/2）。
const cursorLine = ref(0)
const { conflicts: mergeConflicts, accept: acceptConflict, jump: jumpConflict, refresh: refreshMerge } = createMergeState(() => view, props.content)
// Above this many characters the editor drops syntax highlighting, linting, LSP
// and word wrap so a big file stays responsive; CodeMirror itself virtualises the
// document so editing remains smooth. The document is owned by CodeMirror, never
// copied to the parent on every keystroke.
const HEAVY_LIMIT = 5 * 1024 * 1024
const heavy = props.content.length > HEAVY_LIMIT

// LSP `documentLink` / `codeLens` 的渲染与调度在各自模块里（自包含控制器，见那两个文件的头部说明）——
// 这里只做组装与触发。把 20 行"去抖 + 请求 + 转换"乘以八个能力塞回本文件，它就又会顶到机检上限。
const documentLinks = createDocumentLinks({
  query: () => request<DocumentLinkResult>('lsp.request', { kind: 'documentLink', path: props.path, line: 0, character: 0 }),
  enabled: () => props.lspEnabled && !heavy && Boolean(view),
  view: () => view,
})
// Code Vision 的点击 → 执行条目带的命令。复用 `workspace/executeCommand` 那条既有链路，
// 不另造一套"CodeLens 自己的动作通道"。
const codeLens = createCodeLens({
  query: () => request<CodeLensResult>('lsp.request', { kind: 'codeLens', path: props.path, line: 0, character: 0 }),
  enabled: () => props.lspEnabled && !heavy && Boolean(view),
  view: () => view,
  onCommand: (command, args) => emit('codeLens', { command, arguments: args }),
})
let replacing = false
// IDEA's Column Selection Mode: Alt+Shift+Insert toggles a mode where plain drags and
// arrow keys select rectangles. The installed rectangularSelection only takes an
// eventFilter, so "mode on" swaps in a filter that accepts every plain left-drag;
// reconfiguring the Compartment is what actually changes behavior.
const columnMode = new Compartment
let columnActive = false
// ToggleReadOnlyAttributeAction: the compartment holds EditorState.readOnly for the
// buffer, reconfigured when the attribute flips on disk.
const readOnlyMode = new Compartment
function toggleColumnSelection() {
  columnActive = !columnActive
  view?.dispatch({ effects: columnMode.reconfigure(columnActive ? rectangularSelection({ eventFilter: event => event.button === 0 }) : []) })
  // IDEA's ColumnSelectionModePanel shows this state in the status bar, so the mode
  // has to be observable from outside the editor.
  emit('columnMode', columnActive)
}
let lspTimer: number | undefined
function scheduleLspChange() {
  if (!props.lspEnabled || heavy) return
  if (lspTimer !== undefined) clearTimeout(lspTimer)
  lspTimer = window.setTimeout(() => {
    lspTimer = undefined
    const editor = view
    if (editor && props.lspEnabled) void request('lsp.change', { path: props.path, text: editor.state.sliceDoc() }).catch(() => undefined)
  }, 400)
}
// 当前执行行的整行高亮在 src/editorDebugLine.ts（IDEA 的 `ExecutionPointHighlighter`）；
// 断点/书签/诊断的行内标记在 src/editorGutterIcons.ts（IDEA 的 `GutterIconRenderer`）。
function syncGutter() { syncGutterIcons(view, props.gutterIcons ?? []) }
// 追溯注解列（IDEA 的 `TextAnnotationGutterProvider`）：数据由宿主算好，这里只灌进状态。
function syncBlame() { syncBlameAnnotations(view, props.blame ?? []) }
// IDEA's "Show indent guides": a faint vertical rule at each indent level so the
// user can tell which block owns the current line. Toggled by the editor settings.
const setIndentGuides = StateEffect.define<boolean>()
const indentGuideField = StateField.define<boolean>({
  create: () => props.settings.showIndentGuides,
  update(value, tr) {
    for (const e of tr.effects) if (e.is(setIndentGuides)) return e.value
    return value
  },
  provide: f => EditorView.decorations.compute([f, EditorView.scrollMargins], state => {
    if (!state.field(f)) return Decoration.none
    const tabSize = props.settings.tabSize
    const builder = new RangeSetBuilder<Decoration>()
    let lineNo = 1
    let iter = state.doc.iterLines()
    while (true) {
      const next = iter.next()
      if (next.done) break
      const text = next.value
      const indent = text.match(/^[ \t]*/)?.[0] ?? ''
      const cols = Math.floor(indent.replace(/\t/g, ' '.repeat(tabSize)).length / tabSize)
      if (cols > 1) {
        const from = state.doc.line(lineNo).from
        for (let c = 1; c < cols; ++c)
          builder.add(from + c * tabSize - 1, from + c * tabSize, Decoration.widget({ widget: new (class extends WidgetType { toDOM() { const el = document.createElement('span'); el.className = 'cm-indent-guide'; return el } })(), side: -1 }))
      }
      ++lineNo
      iter = next
    }
    return builder.finish()
  }),
})
const indentGuidesExtension = [
  indentGuideField,
  EditorView.theme({
    '& .cm-indent-guide': { display: 'inline-block', width: '1px', height: '1em', background: 'var(--border)', opacity: '0.55' },
  }),
]
// Same-symbol highlighting: on caret move (debounced) ask documentHighlight and mark
// every occurrence. Sorted + non-overlapping so the decoration builder never throws.
const setHighlights = StateEffect.define<{ from: number; to: number }[]>()
const highlightField = StateField.define<{ from: number; to: number }[]>({
  create: () => [],
  update(value, tr) { for (const e of tr.effects) if (e.is(setHighlights)) return e.value; return value },
  provide: f => EditorView.decorations.compute([f], state => {
    const builder = new RangeSetBuilder<Decoration>()
    let last = -1
    for (const r of [...state.field(f)].sort((a, b) => a.from - b.from || a.to - b.to)) {
      if (r.to <= r.from || r.from < last) continue
      builder.add(r.from, r.to, Decoration.mark({ class: 'cm-lsp-highlight' }))
      last = r.to
    }
    return builder.finish()
  }),
})
let highlightTimer: number | undefined
function scheduleHighlight() {
  if (!props.lspEnabled || heavy) return
  if (highlightTimer !== undefined) clearTimeout(highlightTimer)
  highlightTimer = window.setTimeout(() => { highlightTimer = undefined; void runHighlight() }, 160)
}
async function runHighlight() {
  const editor = view
  if (!editor || !props.lspEnabled) return
  const head = editor.state.selection.main.head
  const info = editor.state.doc.lineAt(head)
  try {
    const result = await request<LspHighlightResult>('lsp.request', { kind: 'documentHighlight', path: props.path, line: info.number - 1, character: head - info.from })
    const current = view
    if (!current) return
    const ranges = (result.highlights ?? []).flatMap(item => {
      try { const from = lspPosition(current.state.doc, item.startLine, item.startChar); const to = lspPosition(current.state.doc, item.endLine, item.endChar); return to > from ? [{ from, to }] : [] } catch { return [] }
    })
    current.dispatch({ effects: setHighlights.of(ranges) })
  } catch { /* the server may be mid-shutdown; stale highlights are harmless */ }
}
// Inlay hints render as read-only inline widgets at a doc position.
class InlayWidget extends WidgetType {
  constructor(readonly text: string, readonly padLeft: boolean, readonly padRight: boolean) { super() }
  eq(other: InlayWidget) { return other.text === this.text && other.padLeft === this.padLeft && other.padRight === this.padRight }
  toDOM() { const span = document.createElement('span'); span.className = 'cm-lsp-inlay'; span.textContent = `${this.padLeft ? ' ' : ''}${this.text}${this.padRight ? ' ' : ''}`; return span }
  ignoreEvent() { return false }
}
interface HintEntry { from: number; text: string; padLeft: boolean; padRight: boolean }
const setHints = StateEffect.define<HintEntry[]>()
const hintField = StateField.define<HintEntry[]>({
  create: () => [],
  update(value, tr) { for (const e of tr.effects) if (e.is(setHints)) return e.value; return value },
  provide: f => EditorView.decorations.compute([f], state => {
    const builder = new RangeSetBuilder<Decoration>()
    for (const h of [...state.field(f)].sort((a, b) => a.from - b.from)) builder.add(h.from, h.from, Decoration.widget({ widget: new InlayWidget(h.text, h.padLeft, h.padRight), side: 1 }))
    return builder.finish()
  }),
})

let inlineTimer: number | undefined
let inlineInFlight = false
function scheduleInlineCompletion() {
  if (!props.lspEnabled || heavy) return
  if (inlineTimer !== undefined) clearTimeout(inlineTimer)
  // IDEA 的 `isEnabled(event)` 在打字/停顿后触发；这里同样只在"没有选区"时问 ——
  // 有选区时用户是在选东西，不是在打字。
  const editor = view
  if (editor && !editor.state.selection.main.empty) { editor.dispatch({ effects: setInlineSuggestion.of(null) }); return }
  inlineTimer = window.setTimeout(() => { inlineTimer = undefined; void runInlineCompletion() }, 300)
}
async function runInlineCompletion() {
  const editor = view
  if (!editor || !props.lspEnabled || inlineInFlight) return
  const head = editor.state.selection.main.head
  if (head !== editor.state.selection.main.anchor) return
  const line = editor.state.doc.lineAt(head)
  inlineInFlight = true
  try {
    const result = await request<InlineCompletionResult>('lsp.request', {
      kind: 'inlineCompletion', path: props.path, line: line.number - 1, character: head - line.from,
      triggerKind: 1,
    })
    // 这期间文档可能已经变了（await 之后位置全变了），所以 dispatch 前重新确认视图没换。
    const target = view
    if (target !== editor) return
    const cursor = { line: line.number - 1, char: head - line.from }
    const suggestion = suggestionFor(result.available ? result.items?.[0] : undefined, cursor)
    if (!suggestion) { editor.dispatch({ effects: setInlineSuggestion.of(null) }); return }
    editor.dispatch({ effects: setInlineSuggestion.of(suggestion) })
  } catch { /* 服务器没有行内补全能力时什么都不显示，不影响编辑 */ }
  finally { inlineInFlight = false }
}
let hintTimer: number | undefined
// LSP `textDocument/semanticTokens/*` 的 decoration —— IDEA 的 daemon 着色路径
// （见 `src/semanticTokens.ts` 的模块注释：真实机制是 `HighlightVisitor`/`Annotator` +
//  `TextAttributesKey`，不是网上流传的 "SemanticHighlightingPass"，那个类不存在）。
//
// **文档一变就整份作废**：语义着色依赖精确的 (行, 列)，不像断点行高亮那样能跟着 map 移动 ——
// 把旧 decoration map 到新位置只会把颜色留在错误的 token 上。下一次拉取回来重建。
const setSemanticTokens = StateEffect.define<readonly SemanticToken[]>()
// 越界的行/列直接跳过：服务端的 legend 版本与文档版本都可能和客户端不一致，
// 一个畸形 token 不该把编辑器打挂（更不该抛进 CodeMirror 的 update 里）。
function buildSemanticDecorations(state: EditorState, tokens: readonly SemanticToken[]): DecorationSet {
  const builder = new RangeSetBuilder<Decoration>()
  // `RangeSetBuilder` 要求**按位置升序**添加，所以先排序（服务端的顺序不保证）。
  const ordered = [...tokens].sort((left, right) => left.line - right.line || left.startChar - right.startChar)
  for (const token of ordered) {
    if (token.line < 0 || token.line >= state.doc.lines) continue
    const line = state.doc.line(token.line + 1)
    const from = line.from + Math.max(0, token.startChar)
    const to = Math.min(line.to, from + Math.max(0, token.length))
    if (to <= from) continue
    const classes = semanticTokenClass(token)
    if (!classes) continue
    builder.add(from, to, Decoration.mark({ class: classes }))
  }
  return builder.finish()
}
const semanticTokensField = StateField.define<DecorationSet>({
  create: () => Decoration.none,
  update: (decorations, transaction) => {
    if (transaction.docChanged) return Decoration.none
    for (const effect of transaction.effects)
      if (effect.is(setSemanticTokens)) return buildSemanticDecorations(transaction.state, effect.value)
    return decorations
  },
  provide: field => EditorView.decorations.from(field),
})
let semanticTimer: number | undefined
// `resultId` 与它对应的**压缩数组**必须成对维护：delta 的 `edits` 是作用在这个数组上的整数
// 下标，两者不同源就会把颜色按错误的偏移改掉。
let semanticResultId = ''
let semanticData: number[] = []
function resetSemanticTokens() {
  semanticResultId = ''
  semanticData = []
}
function scheduleSemanticTokens() {
  if (!props.lspEnabled || heavy) return
  if (semanticTimer !== undefined) clearTimeout(semanticTimer)
  // 语义着色跟着编辑走（IDEA 的 daemon 也是每次改动重跑），比补全宽松一点即可。
  semanticTimer = window.setTimeout(() => { semanticTimer = undefined; void runSemanticTokens() }, 400)
}
async function runSemanticTokens() {
  const editor = view
  if (!editor || !props.lspEnabled) return
  try {
    const result = await request<LspSemanticTokensResult>('lsp.request', {
      kind: 'semanticTokens', path: props.path, line: 0, character: 0,
      // 没有 resultId 时**不发这个键**：发空串等于告诉服务器"上一份是空的"，它会走另一条路。
      ...(semanticResultId ? { previousResultId: semanticResultId } : {}),
    })
    // 期间换过文档（视图重建）的话这次答案已经过期，不能 dispatch 到新文档上。
    const target = view
    if (target !== editor) return
    if (!result.available) { resetSemanticTokens(); target.dispatch({ effects: setSemanticTokens.of([]) }); return }
    if (result.resultId) semanticResultId = result.resultId
    // 规范允许 `/full/delta` 用整份 `data` 回答（"全部替换"），所以 edits 为空时就用 data。
    const hasEdits = Array.isArray(result.edits) && result.edits.length > 0
    semanticData = result.kind === 'delta' && hasEdits
      ? applySemanticTokenEdits(semanticData, result.edits)
      : [...(result.data ?? [])]
    target.dispatch({ effects: setSemanticTokens.of(decodeSemanticTokens(semanticData, result.legend)) })
  } catch { /* 服务器没有语义高亮能力时保持词法着色，不影响编辑 */ }
}
// 折叠的调度管道（存 → 装区间 → 按设置折默认 → 清失效 → 恢复）在 src/editorFoldingController.ts ——
// 宿主只注入依赖。顺序与两个真机踩过的坑（先存后折、管道必须串行）都写在那个模块头上。
const folding = createFoldingController({
  path: () => props.path,
  view: () => view,
  foldingKinds: () => FOLDING_SETTING_ROWS.map(row => ({
    kind: kindOfSetting(row.key),
    collapse: props.settings[row.key] ?? defaultCodeFoldingSettings[row.key],
  })),
  fetchRanges: async () => {
    const result = await request<LspFoldingRangeResult>('lsp.request', { kind: 'foldingRange', path: props.path, line: 0, character: 0 })
    return result.available ? result.ranges ?? [] : []
  },
  onError: () => undefined,   // 服务器不给折叠区间时保持内置折叠，不影响编辑
})
// LSP `textDocument/diagnostic`（**pull 模型**，IDEA 的批处理 Inspection）：服务器声明了
// `diagnosticProvider` 时由客户端主动来问，结果写进同一个诊断 store；`previousResultId` 让服务器
// 可以回答 `unchanged`。规范要求 pull 与 push 二选一，所以标记为 pull 的文件不再接受推送
// （见 bridge 的 `pullManagedFiles`）。
const diagnosticIds = new Map<string, string>()
let pullTimer: number | undefined
function schedulePullDiagnostics() {
  if (!props.lspEnabled || heavy) return
  if (pullTimer !== undefined) clearTimeout(pullTimer)
  pullTimer = window.setTimeout(() => { pullTimer = undefined; void runPullDiagnostics() }, 350)
}
async function runPullDiagnostics() {
  if (!props.lspEnabled) return
  try {
    const previousResultId = diagnosticIds.get(props.path)
    const report = await request<LspDiagnosticReport>('lsp.request',
      { kind: 'diagnostic', path: props.path, line: 0, character: 0, previousResultId })
    // 服务器只推送（或重启后不再声明 diagnosticProvider）：撤掉 pull 标记，
    // 让推送通道重新接管这个文件 —— 否则它会永远收不到诊断。已有诊断不清空。
    if (!report.supported) { clearPullDiagnostics(props.path); return }
    if (report.kind === 'unchanged') return
    if (report.resultId) diagnosticIds.set(props.path, report.resultId)
    setPullDiagnostics(props.path, report.items ?? [])
  } catch { /* 拉取失败时保留现有诊断，不影响编辑 */ }
}
function scheduleHints() {
  if (!props.lspEnabled || heavy) return
  if (hintTimer !== undefined) clearTimeout(hintTimer)
  hintTimer = window.setTimeout(() => { hintTimer = undefined; void runHints() }, 250)
}
async function runHints() {
  const editor = view
  if (!editor || !props.lspEnabled) return
  try {
    const result = await request<LspInlayHintResult>('lsp.request', { kind: 'inlayHint', path: props.path, line: 0, character: 0 })
    const current = view
    if (!current) return
    const seen = new Set<number>()
    const entries = (result.hints ?? []).flatMap(hint => {
      try { const from = lspPosition(current.state.doc, hint.line, hint.character); if (seen.has(from)) return []; seen.add(from); return [{ from, text: hint.label, padLeft: !!hint.paddingLeft, padRight: !!hint.paddingRight }] } catch { return [] }
    })
    current.dispatch({ effects: setHints.of(entries) })
  } catch { /* server busy */ }
}
function rangesToDoc(ranges: LspRangeSpan[], doc: Text) {
  const list = ranges.flatMap(r => { try { const from = lspPosition(doc, r.startLine, r.startChar); const to = lspPosition(doc, r.endLine, r.endChar); return to > from ? [{ from, to }] : [] } catch { return [] } })
  list.sort((a, b) => a.from - b.from || b.to - a.to)
  const uniq: { from: number; to: number }[] = []
  for (const r of list) { const last = uniq[uniq.length - 1]; if (!last || last.from !== r.from || last.to !== r.to) uniq.push(r) }
  return uniq
}
let rangeStack: { from: number; to: number }[] | null = null
function selectFromStack(grow: boolean) {
  const editor = view
  if (!editor || !rangeStack?.length) return
  const sel = editor.state.selection.main
  let index = rangeStack.findIndex(r => r.from <= sel.from && r.to >= sel.to)
  if (index < 0) index = grow ? -1 : 0
  const next = grow ? Math.min(rangeStack.length - 1, index + 1) : Math.max(0, index - 1)
  const target = rangeStack[next]
  if (target) editor.dispatch({ selection: { anchor: target.from, head: target.to }, scrollIntoView: true })
}
function adjustSelection(grow: boolean) {
  const editor = view
  if (!editor || !props.lspEnabled || heavy) return false
  if (!rangeStack) {
    const sel = editor.state.selection.main
    const info = editor.state.doc.lineAt(sel.from)
    void request<LspSelectionRangeResult>('lsp.request', { kind: 'selectionRange', path: props.path, line: info.number - 1, character: sel.from - info.from })
      .then(result => { const doc = view?.state.doc; if (doc) rangeStack = rangesToDoc(result.ranges ?? [], doc); selectFromStack(grow) })
      .catch(() => { rangeStack = null })
    return true
  }
  selectFromStack(grow)
  return true
}
defineExpose({
  columnModeActive: () => columnActive,
  toggleColumnSelection,
  command: (name: string) => runEditorCommand(view, editorActions, name),
  // 查找/替换的菜单入口（编辑 › 查找 / 替换）：与 Ctrl+F / Ctrl+R 走同一个控制器。
  openFind: () => findBar.open(false),
  openReplace: () => findBar.open(true),
  // The Live Template Chooser picks a template by key; inserting the trigger at the
  // caret and reusing expandTemplate keeps slot/postfix semantics in one place.
  expandAtCursor: (text: string) => {
    const editor = view
    if (!editor) return false
    const head = editor.state.selection.main.head
    editor.dispatch({ changes: { from: head, insert: text }, selection: { anchor: head + text.length } })
    return expandTemplate(editor)
  },
  text: () => view?.state.doc.toString() ?? '',
  // 导出到 HTML：读已渲染的行（含颜色）与当前选区文本 —— 实现在 src/htmlExportDom.ts。
  exportStyledLines: () => (view ? readStyledLines(view) : []),
  selectionText: () => {
    const range = view?.state.selection.main
    return view && range && !range.empty ? view.state.sliceDoc(range.from, range.to) : ''
  },
  surroundWith,
  // 粘贴通道的实现在 src/editorPaste.ts（纯函数，接收 EditorView）
  insertText: (text: string) => (view ? insertTextAtCaret(view, text) : null),
  replaceRange: (from: number, to: number, text: string) => (view ? replaceInsertedRange(view, from, to, text) : false),
  getCursor: () => {
    if (!view) return { line: 0, ch: 0 }
    const pos = view.state.selection.main.head
    const line = view.state.doc.lineAt(pos)
    return { line: line.number - 1, ch: pos - line.from }
  },
  hasSelection: () => {
    const range = view?.state.selection.main
    return Boolean(range && !range.empty)
  },
  getCursorCoords: () => {
    if (!view) return null
    const coords = view.coordsAtPos(view.state.selection.main.head)
    return coords ? { left: coords.left, top: coords.top, bottom: coords.bottom } : null
  },
  setDraft: (value: string) => {
    const editor = view
    if (!editor || editor.state.doc.toString() === value) return
    replacing = true
    try { editor.dispatch({ changes: { from: 0, to: editor.state.doc.length, insert: value } }) }
    finally { replacing = false }
    if (props.lspEnabled) void request('lsp.change', { path: props.path, text: value }).catch(() => undefined)
  },
  setReadOnly: (value: boolean) => {
    const editor = view
    if (!editor) return
    replacing = true
    try { editor.dispatch({ effects: readOnlyMode.reconfigure(value ? EditorState.readOnly.of(true) : []) }) }
    finally { replacing = false }
  },
})
async function loadLanguage(path: string) {
  if (heavy) return
  try {
    // An "Associate with File Type…" override replaces the extension heuristic;
    // 'other' means plain text on purpose. Without an override, extensions decide.
    let extension = [] as Extension
    const forced = props.language && props.language !== 'other' ? props.language : undefined
    if (props.language === 'other') extension = []
    else if (forced === 'java' || (!forced && /\.java$/i.test(path))) extension = (await import('@codemirror/lang-java')).java()
    else if (forced === 'cpp' || (!forced && /\.(cpp|cc|c|h|hpp|cxx)$/i.test(path))) extension = (await import('@codemirror/lang-cpp')).cpp()
    else if (forced === 'typescript' || (!forced && /\.(ts|tsx|js|jsx|mjs)$/i.test(path)))
      extension = (await import('@codemirror/lang-javascript')).javascript({ typescript: forced ? forced === 'typescript' : /\.tsx?$/.test(path), jsx: /\.[jt]sx$/.test(path) })
    else if (/\.json$/i.test(path)) extension = (await import('@codemirror/lang-json')).json()
    else if (/\.(html|vue)$/i.test(path)) extension = (await import('@codemirror/lang-html')).html()
    else if (/\.css$/i.test(path)) extension = (await import('@codemirror/lang-css')).css()
    if (props.path === path) view?.dispatch({ effects: language.reconfigure(extension) })
  } catch { emit('error', `无法加载 ${path} 的语法高亮，文本编辑仍可用。`) }
}
/**
 * IDEA's GotoNextError / GotoPreviousError (GotoNextErrorHandler.java). The target is picked
 * by src/gotoNextError.ts; this only turns it into an editor transaction.
 *
 * navigateToError() (:165-198) removes the selection and the secondary carets, puts the caret
 * on the highlight and scrolls it to the centre (:172-177), then unfolds a collapsed region
 * hiding it (:178-179). getNavigationPositionFor() (:200-208) navigates to the highlight
 * start plus `navigationShift` — zero for LSP diagnostics, and the after-end-of-line case
 * needs no extra shift either: lspPosition() clamps the character to the line, so an
 * end-of-line highlight already resolves to the offset IDEA would use.
 */
function goToError(forward: boolean): boolean {
  const editor = view
  if (!editor || !props.lspEnabled) return false
  const doc = editor.state.doc
  const head = editor.state.selection.main.head
  const line = doc.lineAt(head)
  const target = nextErrorTarget(
    lspDiagnostics.get(props.path) ?? [],
    { line: line.number - 1, character: head - line.from },
    forward,
  )
  if (!target) { showErrorHint(NO_ERRORS_IN_FILE); return true }
  const pos = lspPosition(doc, target.line, target.character)
  const effects: StateEffect<unknown>[] = [EditorView.scrollIntoView(pos, { y: 'center' })]
  foldedRanges(editor.state).between(0, doc.length, (from, to) => {
    if (from <= pos && pos <= to) effects.push(unfoldEffect.of({ from, to }))
  })
  hideErrorHint()
  editor.dispatch({ selection: { anchor: pos }, effects })
  editor.focus()
  return true
}
const hoverSource = hoverTooltip(async (hovered, pos) => {
  const info = hovered.state.doc.lineAt(pos)
  // 链接**优先于**语言服务 hover：一个位置只显示一个提示，而"这里可以点开"比泛泛的类型信息
  // 更有用。IDEA 侧这两条也是不同通道（`GotoDeclarationHandler` 与 language hover），
  // 用户看到的是一个提示，所以这里明确排个序。
  const link = linkAt(hovered.state.field(linkField, false), info.number - 1, pos - info.from)
  if (link) {
    const text = describeLink(link)
    return { pos, create: () => { const dom = document.createElement('div'); dom.className = 'lsp-hover'; dom.textContent = link.target ? `${text}\n（Ctrl+Click 打开）` : text; dom.style.whiteSpace = 'pre-wrap'; return { dom } } }
  }
  try {
    const result = await request<LspHoverResult>('lsp.request', { kind: 'hover', path: props.path, line: info.number - 1, character: pos - info.from })
    if (!result.available || !result.contents) return null
    const contents = result.contents
    return { pos, create: () => { const dom = document.createElement('div'); dom.className = 'lsp-hover'; dom.textContent = contents; return { dom } } }
  } catch { return null }
}, { hoverTime: 250, hideOnChange: true })
// 转到声明的解析链在 src/declarationNavigation.ts；这里只把"光标在哪、弹层锚点在哪"喂进去。
const { revealDefinition: gotoDefinition } = createDeclarationNavigation({
  enabled: () => props.lspEnabled,
  path: () => props.path,
  request: (method, params) => request(method, params),
  openChooser: async (targets, at) => openChooseTargetHost(targets, at),
  reveal: target => emit('reveal', target),
})
function revealDefinition(pos: number) {
  const editor = view
  if (!editor) return
  const info = editor.state.doc.lineAt(pos)
  const coords = editor.coordsAtPos(pos)
  void gotoDefinition(info.number - 1, pos - info.from, { x: coords?.left, y: coords?.bottom })
}
// 「选择声明」弹层：状态与行内容加载在 src/chooseTargetHost.ts。
const { chooseTarget, open: openChooseTargetHost, close: closeChooseTarget } = createChooseTargetHost({
  path: () => props.path,
  buffer: () => view?.state.doc.toString() ?? props.content, readFile: async path => (await request<{ content: string }>('file.read', { path })).content,
})
function pickChooseTarget(row: ChooseTargetRow) {
  closeChooseTarget()
  emit('reveal', { path: row.path, line: row.line, column: row.character + 1 })
}
// 「快速定义」（QuickImplementations）：状态与解析链在 src/quickDefinitionHost.ts。
const { quickDefinition, command: quickDefinitionCommand } = createQuickDefinitionHost({
  enabled: () => props.lspEnabled,
  path: () => props.path,
  buffer: () => view?.state.doc.toString() ?? props.content,
  coords: pos => view?.coordsAtPos(pos),
  readFile: async path => (await request<{ content: string }>('file.read', { path })).content,
  request: (method, params) => request(method, params),
  librarySource: qualifier => request('file.librarySource', { qualifier }),
  report: message => emit('error', message),
})
// IDEA's "last edit location" ring: the two lines the caret sat on when the buffer
// last changed, so Ctrl+Shift+Backspace toggles between here and there.
let editSpots: number[] = []
function noteEdit() {
  const editor = view
  if (!editor) return
  const line = editor.state.doc.lineAt(editor.state.selection.main.head).number
  if (editSpots[editSpots.length - 1] !== line) editSpots = [...editSpots.slice(-1), line]
}
function lastEditLocation(editor: EditorView) {
  const previous = editSpots.length > 1 ? editSpots[editSpots.length - 2] : 0
  if (!previous) return false
  const current = editor.state.doc.lineAt(editor.state.selection.main.head).number
  editSpots = [current, previous]
  const line = editor.state.doc.line(Math.min(previous, editor.state.doc.lines))
  editor.dispatch({ selection: { anchor: line.from }, scrollIntoView: true })
  return true
}
// Live templates (IDEA's Expand Live Template / postfix completion). The pure rules
// live in src/templates.ts; here they only become editor transactions.
let templateStops: { from: number; to: number }[] = []
function expandTemplate(view: EditorView): boolean {
  const head = view.state.selection.main.head
  const line = view.state.doc.lineAt(head)
  const result = expandTemplateAt(line.text, head - line.from, props.path, props.templates, props.pluginTemplates)
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
// Tab / Shift+Tab (IDEA's indent & outdent). CodeMirror's basicSetup deliberately
// does NOT install `indentWithTab`, so until now the keystroke fell through to the
// browser and only moved focus. A non-empty selection indents every line it touches;
// a bare caret inserts one indent unit — a real tab when Editor → "Use tab character"
// is on, `tabSize` spaces otherwise. Both paths read the same `indentUnit` facet the
// settings compartment writes, so the result always matches the setting.
function indentUnitText() { return props.settings.useTabCharacter ? '\t' : ' '.repeat(props.settings.tabSize) }
function changeIndent(direction: 1 | -1): Command {
  const outdent = direction < 0
  return editor => {
    const state = editor.state
    if (state.readOnly) return false
    if (outdent || state.selection.ranges.some(range => !range.empty)) return (outdent ? indentLess : indentMore)(editor)
    const text = indentUnitText()
    editor.dispatch(state.changeByRange(range => ({
      changes: { from: range.from, to: range.to, insert: text },
      range: EditorSelection.cursor(range.from + text.length),
    })), { scrollIntoView: true, userEvent: 'input.indent' })
    return true
  }
}
const indentCommand = changeIndent(1)
const outdentCommand = changeIndent(-1)
function templateCompletion(context: CompletionContext): CompletionResult | null {
  const info = context.state.doc.lineAt(context.pos)
  const list = templateCandidates(info.text, context.pos - info.from, props.path, props.templates, props.pluginTemplates)
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
        expandTemplate(view)
      },
    })),
  }
}
// One completion controller per editor; resolve caches belong to each result.
const lspCompletion = createLspCompletion({
  enabled: () => props.lspEnabled && !heavy,
  path: () => props.path,
  view: () => view,
  request,
  sync: async state => {
    if (lspTimer !== undefined) { clearTimeout(lspTimer); lspTimer = undefined }
    await request('lsp.change', { path: props.path, text: state.sliceDoc() })
  },
  reportError: message => emit('error', message),
})
/**
 * 一个 lookup、两个 contributor —— IDEA 的补全是**合流**的：`CompletionResultSet` 同时收语义
 * 提案和后置模板提案（`PostfixCompletionProposalAgent`），不存在"谁先给出结果谁独占"。
 * CodeMirror 的 `autocompletion({ override })` 偏偏是"第一个非空即止"，所以合流必须自己做：
 * 先按点位出模板候选（同步、便宜），再等语言服务的成员候选，把两者并成一个结果。
 * 2026-09-29 用户实测"没有代码补全提示"就是这条断的：打完点 `text.` 只剩模板候选，
 * `lspCompletion` 从没被调用 —— 宿主日志里因此一条 `lsp.request:completion` 都没有。
 */
async function mergeCompletion(context: CompletionContext) {
  const templates = templateCompletion(context)
  return mergeCompletionResults(await lspCompletion(context), templates)
}
// IDEA's Evaluate Expression: the selection wins, otherwise the word under the caret.
function emitEvaluate(editor: EditorView) {
  const selection = editor.state.selection.main
  const span = selection.empty ? editor.state.wordAt(selection.head) : { from: selection.from, to: selection.to }
  if (!span || span.to <= span.from) return false
  emit('evaluate', editor.state.sliceDoc(span.from, span.to))
  return true
}
function emitSemantic(kind: 'rename' | 'references' | 'codeAction' | 'format' | 'signature' | 'implementation' | 'callHierarchy' | 'typeHierarchy' | 'typeDefinition') {
  return (editor: EditorView) => {
    const state = editor.state
    const head = state.selection.main.head
    const info = state.doc.lineAt(head)
    const payload: { kind: typeof kind; path: string; line: number; character: number; range?: LspRange } =
      { kind, path: props.path, line: info.number - 1, character: head - info.from }
    // IDEA's reformat honours an active selection: hand the server the range so it
    // answers with rangeFormatting edits instead of re-laying-out the whole file.
    const selection = state.selection.main
    if (kind === 'format' && !selection.empty) {
      const first = state.doc.lineAt(selection.from), last = state.doc.lineAt(selection.to)
      payload.range = {
        start: { line: first.number - 1, character: selection.from - first.from },
        end: { line: last.number - 1, character: selection.to - last.from },
      }
    }
    emit('semantic', payload)
    return true
  }
}
// One flat action surface for the menus: the shared editing commands plus the
// editor-local actions (search panels, completion, and the LSP queries whose result
// the parent has to render). A menu item and its key binding resolve to the same
// function, so neither can advertise something the editor does not do.
const editorActions: Record<string, Command> = {
  ...editingCommands,
  ...clipboardCommands(text => void copyToClipboard(text)), // IDEA EditorCopy/EditorCut：无选区时先选中整行（src/editorClipboard.ts）
  // 查找那一族改走**编辑器内查找栏**（上游 `SearchReplaceComponent`）：`editingCommands` 里的
  // `find` / `find.next` / `find.previous` 指的是 CodeMirror 自己的面板与命令，在本仓是空操作，
  // 所以在这里整族覆盖掉。`replace.next` / `replace.all` 上游不是动作（是栏上的两个按钮），
  // 也一并撤掉，免得 Find Action 里出现两个点了没反应的条目。
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
  'column.select': () => { toggleColumnSelection(); return true },
  'edit.last': lastEditLocation,
  // 切换插入/覆盖（Insert 键与 Code 菜单走同一个实现）。
  'editor.overwrite': editor => { toggleOverwrite(editor); return true },
  // IDEA's Navigate menu: GotoNextError / GotoPreviousError (PlatformActions.xml:612-615).
  'error.next': () => goToError(true),
  'error.previous': () => goToError(false),
}
function surroundWith(template: SurroundTemplate) {
  const editor = view
  if (!editor) return
  const state = editor.state
  const range = state.selection.main
  const first = state.doc.lineAt(range.from)
  const last = state.doc.lineAt(range.to > range.from ? range.to - 1 : range.from)
  const indent = /^\s*/.exec(first.text)![0]
  const wrapped = wrapSelection(template, state.sliceDoc(first.from, last.to), indent, ' '.repeat(props.settings.tabSize))
  editor.dispatch({
    changes: { from: first.from, to: last.to, insert: wrapped.text },
    selection: { anchor: first.from + wrapped.caret },
    scrollIntoView: true,
  })
  editor.focus()
}
function lspExtensions(): Extension[] {
  if (!props.lspEnabled || heavy) return []
  return [
    // Editor | Error highlighting（IDEA 的 `Errors`）两个开关：关掉后不再绘制诊断波浪线与行号旁标记，
    // 语言服务本身照常运行（对应 IDEA 关闭高亮但检查仍在后台）。
    ...(props.settings.showDiagnostics ? [linter(() => (view ? diagnosticMarkers(lspDiagnostics.get(props.path) ?? [], view.state.doc) : []))] : []),
    ...(props.settings.showDiagnostics && props.settings.showErrorStripe ? [lintGutter()] : []),
    hoverSource,
    // 服务端折叠区间（`foldingRange`）叠加在内置折叠之上。
    foldingRanges,
    lspFoldService,
    inlineSuggestionField,
    inlineDecorationsField,
    inlineCompletionKeymap,
    // Completion UI（候选行三列 + 真实图标 + IDEA New UI 配色/几何）在 src/completionUi.ts；
    // Ctrl+Space 的 Basic 补全绑定也在那里（`$default.xml:732-734`），编辑器这里只提供 source。
    completionUi([mergeCompletion]),
    keymap.of([
      // $default.xml: GotoDeclaration Ctrl+B (+ ctrl-click), RenameElement Shift+F6, FindUsages Alt+F7,
      // ParameterInfo Ctrl+P, ReformatCode Ctrl+Alt+L, QuickImplementations Ctrl+Shift+I（:162-164）,
      // GotoImplementation Ctrl+Alt+B, Call/TypeHierarchy Ctrl+Alt+H / Ctrl+Shift+H。
      { key: 'Ctrl-b', preventDefault: true, run: editor => { void revealDefinition(editor.state.selection.main.head); return true } },
      { key: 'Ctrl-Shift-i', preventDefault: true, run: editor => quickDefinitionCommand(editor) },
      { key: 'Shift-f6', preventDefault: true, run: emitSemantic('rename') },
      { key: 'Alt-f7', preventDefault: true, run: emitSemantic('references') },
      { key: 'Alt-Enter', preventDefault: true, run: emitSemantic('codeAction') },
      { key: 'Ctrl-Alt-l', preventDefault: true, run: emitSemantic('format') },
      // IDEA Code menu: 自动缩进 (Auto-Indent, Ctrl+Alt+I).
      { key: 'Ctrl-Alt-i', preventDefault: true, run: editingCommands['indent.selection']! },
      { key: 'Ctrl-Alt-b', preventDefault: true, run: emitSemantic('implementation') },
      { key: 'Ctrl-Alt-h', preventDefault: true, run: emitSemantic('callHierarchy') },
      // IDEA Navigate: 类型层次 = Ctrl+H ($default.xml TypeHierarchy); 方法层次
      // Ctrl+Shift+H has no LSP equivalent, so that chord stays unbound here.
      { key: 'Ctrl-h', preventDefault: true, run: emitSemantic('typeHierarchy') },
      { key: 'Ctrl-Shift-b', preventDefault: true, run: emitSemantic('typeDefinition') },
      { key: 'Alt-F8', preventDefault: true, run: emitEvaluate },
      { key: 'Ctrl-p', preventDefault: true, run: emitSemantic('signature') },
      { key: 'Mod-w', preventDefault: true, run: () => adjustSelection(true) },
      { key: 'Mod-Shift-w', preventDefault: true, run: () => adjustSelection(false) },
      // $default.xml:658-660 GotoNextError = F2, :679-681 GotoPreviousError = shift F2. Both
      // are editor actions that need highlighting to be available
      // (BaseGotoNextErrorAction.isValidForFile:52-54), so they belong to this conditional
      // keymap rather than to the always-on one.
      { key: 'F2', preventDefault: true, run: () => goToError(true) },
      { key: 'Shift-F2', preventDefault: true, run: () => goToError(false) },
    ]),
    EditorView.domEventHandlers({
      mousedown: (event, editor) => {
        if (!event.ctrlKey || event.button !== 0) return false
        const pos = editor.posAtCoords({ x: event.clientX, y: event.clientY })
        if (pos === null) return false
        event.preventDefault()
        void revealDefinition(pos)
        return true
      },
    }),
  ]
}
function applyReveal(target: { path: string; line: number; column?: number } | null | undefined) {
  const editor = view
  if (!editor || !target || target.path !== props.path) return
  const info = editor.state.doc.line(Math.min(Math.max(1, target.line + 1), editor.state.doc.lines))
  // IDEA's Jump to Line/Character places the caret at the requested column too.
  const anchor = Math.min(info.from + Math.max(0, (target.column ?? 1) - 1), info.to)
  editor.dispatch({ selection: { anchor }, scrollIntoView: true })
  editor.focus()
}
// 那几条状态扩展的实现在 src/editorTheme.ts（与主题同族，且那个文件已经拿着编辑器外观）。
// IDEA「Use tab character」（Editor → Code Style）：缩进单位变成真制表符。
function editorOptions() {
  return editorOptionExtensions({ tabSize: props.settings.tabSize, indentUnit: indentUnitText(), wordWrap: props.settings.wordWrap, lineNumbers: props.settings.lineNumbers, showWhitespaces: props.settings.showWhitespaces }, heavy, whitespaceLayer)
}
onMounted(() => {
  view = new EditorView({
    parent: container.value,
    state: EditorState.create({
      doc: props.content,
      extensions: [
        keymap.of([{ key: 'Mod-s', run: () => { emit('save'); return true } }]),
        keymap.of([
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
          { key: 'Mod-Shift-u', preventDefault: true, run: editingCommands['case.toggle']! },
          // FindNext/FindPrevious = F3 / Shift+F3（$default.xml:707-708 / :507-508）；编辑
          // 菜单公布的正是这两条。它们**必须走查找栏的会话**：CodeMirror 自带的
          // findNext/findPrevious 只在它自己的面板打开时才有事做，本仓的栏是自绘的
          // （实现见 src/editorSearchExtension.ts 的 goToMatch）。
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
          { key: 'Ctrl-Alt-Shift-Up', preventDefault: true, run: editingCommands['cursor.above']! },
          { key: 'Ctrl-Alt-Shift-Down', preventDefault: true, run: editingCommands['cursor.below']! },
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
          { key: 'Ctrl-.', preventDefault: true, run: editingCommands['fold.selection']! },
          { key: 'Ctrl-Shift-.', preventDefault: true, run: editingCommands['fold.block']! },
          { key: 'Ctrl-*', preventDefault: true, run: editingCommands['unfold.level1']! },
          { key: 'Alt-Shift-Insert', preventDefault: true, run: () => { toggleColumnSelection(); return true } },
          // IDEA's template keys. Tab only consumes a pending slot; when there is none
          // the command returns false and normal indentation (or accepting a completion)
          // proceeds.
          { key: 'Ctrl-Alt-j', preventDefault: true, run: expandTemplate },
          // InsertLiveTemplate = Ctrl+J ($default.xml:438-440).
          { key: 'Ctrl-j', preventDefault: true, run: () => { emit('templateChooser'); return true } },
          { key: 'Ctrl-Alt-t', preventDefault: true, run: () => { emit('surround'); return true } },
          // Tab first feeds a pending live-template slot; otherwise it indents.
          // (A snippet inserted by a completion owns Tab through @codemirror/autocomplete's
          // own highest-precedence keymap, which runs before this one.)
          { key: 'Tab', preventDefault: true, run: editor => nextTemplateStop(editor) || indentCommand(editor), shift: outdentCommand },
          { key: 'Ctrl-Shift-Backspace', preventDefault: true, run: lastEditLocation },
          // EditorToggleInsertState = INSERT（`$default.xml:457-459`）。
          { key: 'Insert', preventDefault: true, run: editor => { toggleOverwrite(editor); return true } },
        ]),
        // Keys the library would otherwise answer with something IDEA does not do. These
        // bindings have to precede basicSetup: a CodeMirror keymap facet is a plain facet, so
        // the extension listed first wins the key.
        keymap.of([
          // $default.xml:849-851 — F8 is Step Over in the debugger, and dapStep runs from the
          // window-level handler. @codemirror/lint's lintKeymap also binds F8 to
          // nextDiagnostic and would fire for the same press, dragging the caret away
          // mid-step. Consuming the key here shadows only the library binding: CodeMirror
          // prevents the browser default but lets the event through to the window handler.
          { key: 'F8', preventDefault: true, run: () => true },
          // $default.xml:309-311 / :717-719 — Alt+Left/Right is PreviousTab/NextTab, and
          // TabNavigationActionBase.java:71-78 routes it to the editor's tabs. CodeMirror binds the
          // same chord to cursorSyntaxLeft/Right, so the caret would also jump a syntax unit.
          { key: 'Alt-ArrowLeft', preventDefault: true, run: () => true },
          { key: 'Alt-ArrowRight', preventDefault: true, run: () => true },
        ]),
        basicSetup,
        // 查找栏的状态、命中高亮与 F3/Shift+F3 的会话（上游 `SearchReplaceComponent`）。
        // 覆盖模式：事务过滤 + 块光标（上游的可见指示就是块光标，没有状态栏组件）。
        overwriteExtension(),
        overwriteTheme,
        // 排在 basicSetup 之后即可：它自己那两条 F3 键位写在**前面**那张 keymap 里，先赢。
        editorSearchExtension(),
        EditorState.lineSeparator.of(props.content.includes('\r\n') ? '\r\n' : '\n'),
        language.of([]),
        ...(heavy ? [] : [syntaxHighlighting(syntaxColors)]),
        appearance.of(editorTheme({ fontSize: props.settings.fontSize, lineNumbers: props.settings.lineNumbers, dark: props.theme === 'dark' })),
        options.of(editorOptions()),
        lsp.of(heavy ? [] : lspExtensions()),
        // Alt+drag always selects a rectangle; the compartment holds the persistent
        // column-selection mode toggled by Alt+Shift+Insert.
        rectangularSelection(),
        columnMode.of([]),
        // IDEA's read-only status table: a locked file edits nowhere.
        readOnlyMode.of(props.readOnly ? EditorState.readOnly.of(true) : []),
        // Settings → "Show indent guides": the editor draws a thin vertical rule at
        // every column boundary of `indentUnit`. Disabled by default to match the
        // previous look; toggled live by reconfigure(indentGuides).
        indentGuides.of(props.settings.showIndentGuides ? indentGuidesExtension : []),
        debugLineExtension,
        semanticTokensField,
        // 粘贴通道（IDEA 的编辑器粘贴处理器 + REFORMAT_ON_PASTE 后处理）
        pasteChannel(event => emit('paste', event)),
        // 复制/剪切通道（IDEA `EditorCopy`/`EditorCut`：无选区时先选中整行）
        copyCutChannel(text => void copyToClipboard(text)),
        // 行内 gutter 图标层（IDEA `GutterIconRenderer`：错误/警告/断点/书签，可点击）
        gutterIconsExtension({ onClick: icon => emit('gutterIcon', icon), onMiddleClick: icon => emit('gutterIconMiddle', icon) }),
        // 装订线上的右键（`EditorGutterPopupMenu`）：交给宿主弹菜单，见 src/gutterMenu.ts。
        gutterContextMenu((line, x, y) => emit('gutterMenu', { line, x, y })),
        // EditorGutterLayout.createNewUILayout places annotation columns before line numbers.
        Prec.high(blameAnnotationsExtension()),
        documentLinks.extension,
        codeLens.extension,
        highlightField,
        hintField,
        EditorView.domEventHandlers({
          mousedown: (event, editor) => {
            const pos = editor.posAtCoords({ x: event.clientX, y: event.clientY })
            if (!(event.target as HTMLElement).closest('.cm-gutters')) {
              // Ctrl/Cmd+Click 打开文档链接（IDEA 的 `GotoDeclarationHandler` 用户可见行为）。
              // 命中时**吃掉这次按下**：那是导航，不是"把光标放到这里"。
              if (pos !== null && (event.ctrlKey || event.metaKey)) {
                const line = editor.state.doc.lineAt(pos)
                const link = linkAt(editor.state.field(linkField, false), line.number - 1, pos - line.from)
                if (link && link.target) { emit('link', link); return true }
              }
              return false
            }
            if (pos === null) return false
            emit('breakpoint', editor.state.doc.lineAt(pos).number)
            return true
          },
        }),
        EditorView.updateListener.of(update => {
          // HIDE_BY_TEXT_CHANGE (HintManagerImpl.java:624): typing dismisses the hint.
          if (update.docChanged) hideErrorHint()
          // 每一次内容变更都要通知宿主，不能只在"变脏那一拍"发一次：书签对账
          // （BookmarkManager 监听的是每个文档变更）、断点位置缓存失效、最近更改位置、
          // 草稿与自动保存重排都挂在 `change` 上 —— 漏了第二次以后的编辑，撤销就更明显
          // （Ctrl+Z 也是带 changes 的一次事务：CodeMirror history 的 `pop` 用
          //  node_modules/@codemirror/commands/dist/index.js:548-556 的 state.update({changes…})
          //  派发，userEvent 是 "undo"）。宿主侧对重复通知是幂等的（rememberPlace 按
          //  文件+行去重，定时器重排就是 clear+set）。
          if (update.docChanged && !replacing) { emit('change'); scheduleLspChange(); schedulePullDiagnostics(); scheduleSemanticTokens(); documentLinks.schedule(); codeLens.schedule(); scheduleInlineCompletion(); rangeStack = null; templateStops = []; noteEdit(); scheduleHints() }
          // 查找栏的计数跟着文档变（改了字，命中数与当前下标都会变）。
          if (update.docChanged || update.selectionSet) findBar.refresh()
          // 冲突条同理：标记被接受/手写进来/删掉都要当场反映。
          if (update.docChanged) refreshMerge(update.state.doc.toString())
          // 宏录制要的是「敲进去的字」（IDEA 的按键级录制在本仓的等价物）
          if (!replacing) { const typed = insertedText(update); if (typed) emit('typing', typed) }
          if (update.selectionSet) scheduleInlineCompletion()
          if (update.selectionSet || update.docChanged) {
            const pos = update.state.selection.main.head
            const line = update.state.doc.lineAt(pos)
            emit('cursor', line.number, pos - line.from + 1)
            cursorLine.value = line.number - 1
            // IDEA's PositionPanel switches to "N selected" while a selection exists.
            const range = update.state.selection.main
            const selected = range.to - range.from
            emit('selection', selected > 0 ? { characters: selected, lines: update.state.doc.lineAt(range.to).number - update.state.doc.lineAt(range.from).number } : null)
            emit('cursors', update.state.selection.ranges.length)
            if (update.selectionSet) scheduleHighlight()
          }
        }),
        EditorView.contentAttributes.of({ 'aria-label': `代码编辑器 ${props.path}`, spellcheck: 'false' }),
      ],
    }),
  })
  void loadLanguage(props.path)
  syncDebugLine(view, props.debugLine ?? 0)
  syncGutter()
  syncBlame()
  // HIDE_BY_SCROLLING (HintManagerImpl.java:624): the hint is placed in the container's
  // coordinates and would be left floating over the wrong line once the text moves.
  view.scrollDOM.addEventListener('scroll', hideErrorHint, { passive: true })
  if (props.active) view.focus()
  applyReveal(props.reveal)
  scheduleHighlight()
  scheduleHints()
})
// The hint belongs to one file and to the focused tab, so leaving either dismisses it.
watch(() => FOLDING_SETTING_ROWS.map(row => props.settings[row.key]).join(','), () => folding.applyDefaults())
watch(() => props.path, () => { folding.capture(); hideErrorHint(); void loadLanguage(props.path); resetSemanticTokens(); folding.schedule(); schedulePullDiagnostics(); scheduleSemanticTokens(); documentLinks.schedule(); codeLens.schedule(); scheduleInlineCompletion() })
watch(() => props.active, async active => {
  if (active) { await nextTick(); view?.requestMeasure(); view?.focus() }
  else hideErrorHint()
})
watch(() => props.theme, () => view?.dispatch({ effects: appearance.reconfigure(editorTheme({ fontSize: props.settings.fontSize, lineNumbers: props.settings.lineNumbers, dark: props.theme === 'dark' })) }))
watch(() => props.settings, () => view?.dispatch({ effects: [appearance.reconfigure(editorTheme({ fontSize: props.settings.fontSize, lineNumbers: props.settings.lineNumbers, dark: props.theme === 'dark' })), options.reconfigure(editorOptions()), indentGuides.reconfigure(props.settings.showIndentGuides ? indentGuidesExtension : []), setIndentGuides.of(props.settings.showIndentGuides)] }), { deep: true })
watch(() => props.lspEnabled, enabled => {
  view?.dispatch({ effects: lsp.reconfigure(enabled ? lspExtensions() : []) })
  if (!enabled) {
    // 关掉语言服务时语义着色也必须撤掉 —— 留着就是一份没人再更新的旧颜色。
    view?.dispatch({ effects: [setHighlights.of([]), setHints.of([]), setSemanticTokens.of([]), setInlineSuggestion.of(null)] }); documentLinks.reset(); codeLens.reset()
    resetSemanticTokens()
    rangeStack = null
    return
  }
  if (view) { forceLinting(view); scheduleLspChange() }
  scheduleHighlight()
  scheduleHints()
  folding.schedule()
  schedulePullDiagnostics()
  scheduleSemanticTokens()
  documentLinks.schedule()
  codeLens.schedule()
  scheduleInlineCompletion()
})
watch(() => lspDiagnostics.get(props.path), () => { if (view && props.lspEnabled) { forceLinting(view); folding.schedule() } })
watch(() => props.reveal, target => applyReveal(target))
// The parent already flips EditorState.readOnly through setReadOnly(); watching the
// prop too would re-dispatch the effect on every later re-render.
watch(() => [props.debugLine, props.gutterIcons, props.blame], () => { syncDebugLine(view, props.debugLine ?? 0); syncGutter(); syncBlame() })
onBeforeUnmount(() => { folding.capture(); if (lspTimer !== undefined) clearTimeout(lspTimer); if (highlightTimer !== undefined) clearTimeout(highlightTimer); if (pullTimer !== undefined) clearTimeout(pullTimer); if (semanticTimer !== undefined) clearTimeout(semanticTimer); folding.dispose(); documentLinks.dispose(); codeLens.dispose(); if (inlineTimer !== undefined) clearTimeout(inlineTimer); view?.destroy(); view = undefined })
</script>

<template>
  <!-- 根必须唯一：App.vue 用 `v-show` 控制每个文件的显隐，多根 ⇒ 全部渲染 ⇒ 挤成一排假分屏。判据见 tests/sfc-single-root.test.mjs。 -->
  <!-- `rightMargin` 走 class 而不是 theme：CSS 在 src/style.css 里，免得这个文件（贴着机检上限）再涨。 -->
  <div ref="container" class="code-editor" :class="{ 'editor-right-margin': props.settings.rightMargin }">
    <!-- 查找栏（上游 SearchReplaceComponent 挂在 editor 的 headerComponent 上；本仓画在编辑器顶部）。 -->
    <EditorFindBar
      v-if="findBar.state.open"
      ref="findBarBar"
      :query="findBar.state.query"
      :options="findBar.state.options"
      :status="findBar.state.status"
      :invalid="findBar.state.invalid"
      :replace-mode="findBar.state.replaceMode"
      :replace-text="findBar.state.replace"
      :history="findBar.state.history"
      @update="findBar.setOptions"
      @query="findBar.setQuery"
      @replace="findBar.setReplace"
      @next="findBar.next"
      @previous="findBar.previous"
      @close="findBar.close"
      @toggle-replace="findBar.toggleReplace"
      @toggle-in-selection="findBar.toggleInSelection"
      @replace-one="findBar.replaceOne"
      @replace-all="findBar.replaceAll"
    />
    <!-- 合并冲突导航条（有冲突标记才出现）。 -->
    <MergeBar
      :conflicts="mergeConflicts"
      :line="cursorLine"
      @accept="acceptConflict"
      @next="jumpConflict"
    />
    <!-- IDEA anchors the hint above the caret line (HintManagerImpl.java:611 ABOVE); coordinates are taken when it appears because any scroll dismisses it. -->
    <div v-if="errorHint" class="editor-hint" role="status" :style="errorHint.style">{{ errorHint.text }}</div>
    <!-- Teleport 到 body：编辑器容器有 overflow/transform 约束，绝对定位在这里会被裁掉；源位置不影响落点，所以能挪进根 div。 -->
    <Teleport v-if="chooseTarget" to="body">
      <TargetChooserPopup :rows="chooseTarget.rows" :x="chooseTarget.x" :y="chooseTarget.y" title="选择声明" @pick="pickChooseTarget" @close="chooseTarget = null" />
    </Teleport>
    <Teleport v-if="quickDefinition" to="body">
      <QuickDefinitionPopup :source="quickDefinition.source" :x="quickDefinition.x" :y="quickDefinition.y" @close="quickDefinition = null" />
    </Teleport>
  </div>
</template>
