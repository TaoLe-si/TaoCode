<script setup lang="ts">
import { nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { basicSetup } from 'codemirror'
import { Compartment, EditorSelection, EditorState, RangeSetBuilder, StateEffect, StateField, type Extension, type Text } from '@codemirror/state'
import { Decoration, EditorView, hoverTooltip, keymap, rectangularSelection, crosshairCursor, WidgetType, type Command } from '@codemirror/view'
import { HighlightStyle, bracketMatching, indentUnit, syntaxHighlighting } from '@codemirror/language'
import { autocompletion, startCompletion, type CompletionContext, type CompletionResult } from '@codemirror/autocomplete'
import { forceLinting, lintGutter, linter, type Diagnostic } from '@codemirror/lint'
import { tags } from '@lezer/highlight'
import type { Theme } from '../appearance'
import { editingCommands } from '../editorCommands'
import { candidates as templateCandidates, expand as expandTemplateAt, defaultTemplateSettings, type TemplateSettings } from '../templates'
import { wrapSelection, type SurroundTemplate } from '../surround'
import { lspDiagnostics, request, type DapBreakpoint, type EditorSettings, type LspCompletionResult, type LspDefinitionResult, type LspHighlightResult, type LspHoverResult, type LspInlayHintResult, type LspRange, type LspRangeSpan, type LspSelectionRangeResult } from '../bridge'

const props = defineProps<{ content: string; path: string; language?: string; theme: Theme; active: boolean; settings: EditorSettings; templates: TemplateSettings; lspEnabled: boolean; readOnly?: boolean; reveal?: { path: string; line: number } | null; breakpoints?: DapBreakpoint[]; debugLine?: number; bookmarks?: number[] }>()
const emit = defineEmits<{ change: []; cursor: [line: number, column: number]; save: []; error: [message: string]; reveal: [target: { path: string; line: number }]; semantic: [payload: { kind: 'rename' | 'references' | 'codeAction' | 'format' | 'signature' | 'implementation' | 'callHierarchy' | 'typeHierarchy'; path: string; line: number; character: number; range?: LspRange }]; evaluate: [expression: string]; breakpoint: [line1based: number]; surround: [] }>()
const container = ref<HTMLDivElement>()
const language = new Compartment()
const appearance = new Compartment()
const options = new Compartment()
const lsp = new Compartment()
const indentGuides = new Compartment()
let view: EditorView | undefined
// Above this many characters the editor drops syntax highlighting, linting, LSP
// and word wrap so a big file stays responsive; CodeMirror itself virtualises the
// document so editing remains smooth. The document is owned by CodeMirror, never
// copied to the parent on every keystroke.
const HEAVY_LIMIT = 5 * 1024 * 1024
const heavy = props.content.length > HEAVY_LIMIT
let dirty = false
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
// Breakpoint + current-execution-line markers, rendered as line decorations and
// kept in sync from props (DAP is 1-based). Gutter clicks toggle a breakpoint.
const setBreakDeco = StateEffect.define<{ lines: number[]; debug: number; marks: number[] }>()
const breakField = StateField.define<{ lines: number[]; debug: number; marks: number[] }>({
  create: () => ({ lines: [], debug: 0, marks: [] }),
  update(value, tr) { for (const e of tr.effects) if (e.is(setBreakDeco)) return e.value; return value },
  provide: f => EditorView.decorations.compute([f], state => {
    const data = state.field(f)
    const classes = new Map<number, string[]>()
    const add = (line: number, cls: string) => {
      if (line < 1 || line > state.doc.lines) return
      const from = state.doc.line(line).from
      const list = classes.get(from) ?? []
      list.push(cls)
      classes.set(from, list)
    }
    for (const line of data.marks) add(line, 'cm-has-bookmark')
    for (const line of data.lines) add(line, 'cm-has-breakpoint')
    if (data.debug >= 1) add(data.debug, 'cm-debug-line')
    const builder = new RangeSetBuilder<Decoration>()
    for (const from of [...classes.keys()].sort((a, b) => a - b)) builder.add(from, from, Decoration.line({ class: classes.get(from)!.join(' ') }))
    return builder.finish()
  }),
})
function syncBreakDeco() { view?.dispatch({ effects: setBreakDeco.of({ lines: (props.breakpoints ?? []).map(point => point.line), debug: props.debugLine ?? 0, marks: props.bookmarks ?? [] }) }) }
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
let hintTimer: number | undefined
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
  command: (name: string) => {
    const editor = view
    const run = editorActions[name]
    return editor && run ? run(editor) : false
  },
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
  surroundWith,
  markSaved: () => { dirty = false },
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
    dirty = false
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
function lspPosition(doc: Text, line: number, character: number) {
  const info = doc.line(Math.min(Math.max(1, Math.trunc(line) + 1), doc.lines))
  return Math.min(Math.max(info.from, info.from + Math.max(0, Math.trunc(character))), info.to)
}
function lspMarkers(): Diagnostic[] {
  const editor = view
  if (!editor || !props.lspEnabled) return []
  const doc = editor.state.doc
  const markers: Diagnostic[] = []
  for (const item of lspDiagnostics.get(props.path) ?? []) {
    try {
      const from = lspPosition(doc, item.line, item.character)
      const to = Math.min(Math.max(from, item.endLine === undefined ? from + item.message.length : lspPosition(doc, item.endLine, item.endCharacter ?? 0)), doc.length)
      markers.push({ from, to, severity: item.severity === 1 ? 'error' : item.severity === 2 ? 'warning' : 'info', message: item.message, source: item.source })
    } catch { /* 过期或越界的诊断不影响编辑 */ }
  }
  return markers
}
const hoverSource = hoverTooltip(async (hovered, pos) => {
  const info = hovered.state.doc.lineAt(pos)
  try {
    const result = await request<LspHoverResult>('lsp.request', { kind: 'hover', path: props.path, line: info.number - 1, character: pos - info.from })
    if (!result.available || !result.contents) return null
    const contents = result.contents
    return { pos, create: () => { const dom = document.createElement('div'); dom.className = 'lsp-hover'; dom.textContent = contents; return { dom } } }
  } catch { return null }
}, { hoverTime: 250, hideOnChange: true })
async function revealDefinition(pos: number) {
  const editor = view
  if (!editor || !props.lspEnabled) return
  const info = editor.state.doc.lineAt(pos)
  try {
    const result = await request<LspDefinitionResult>('lsp.request', { kind: 'definition', path: props.path, line: info.number - 1, character: pos - info.from })
    const target = result.locations?.[0]
    if (result.available && target) emit('reveal', { path: target.path, line: target.line })
  } catch { /* 语言服务未就绪时不提示 */ }
}
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
  const result = expandTemplateAt(line.text, head - line.from, props.path, props.templates)
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
function templateCompletion(context: CompletionContext): CompletionResult | null {
  const info = context.state.doc.lineAt(context.pos)
  const list = templateCandidates(info.text, context.pos - info.from, props.path, props.templates)
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
async function lspCompletion(context: CompletionContext): Promise<CompletionResult | null> {
  if (!props.lspEnabled) return null
  const info = context.state.doc.lineAt(context.pos)
  try {
    const result = await request<LspCompletionResult>('lsp.request', { kind: 'completion', path: props.path, line: info.number - 1, character: context.pos - info.from })
    if (!result.available || !result.items?.length) return null
    const word = context.matchBefore(/[A-Za-z_$][\w$]*$/)
    return {
      from: word?.from ?? context.pos,
      options: result.items.map(item => ({ label: item.label, type: item.kind.toLowerCase(), detail: item.detail, info: item.detail, apply: item.apply })),
    }
  } catch { return null }
}
// IDEA's Evaluate Expression: the selection wins, otherwise the word under the caret.
function emitEvaluate(editor: EditorView) {
  const selection = editor.state.selection.main
  const span = selection.empty ? editor.state.wordAt(selection.head) : { from: selection.from, to: selection.to }
  if (!span || span.to <= span.from) return false
  emit('evaluate', editor.state.sliceDoc(span.from, span.to))
  return true
}
function emitSemantic(kind: 'rename' | 'references' | 'codeAction' | 'format' | 'signature' | 'implementation' | 'callHierarchy' | 'typeHierarchy') {
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
  completion: startCompletion,
  definition: editor => { void revealDefinition(editor.state.selection.main.head); return true },
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
  evaluate: emitEvaluate,
  'template.expand': expandTemplate,
  'column.select': () => { toggleColumnSelection(); return true },
  'edit.last': lastEditLocation,
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
    linter(() => lspMarkers()),
    lintGutter(),
    hoverSource,
    autocompletion({ override: [templateCompletion, lspCompletion] }),
    keymap.of([
      // $default.xml: GotoDeclaration Ctrl+B (+ ctrl-click), RenameElement Shift+F6,
      // FindUsages Alt+F7, ParameterInfo Ctrl+P; ReformatCode Ctrl+Alt+L;
      // GotoImplementation Ctrl+Alt+B, Call/TypeHierarchy Ctrl+Alt+H / Ctrl+Shift+H.
      { key: 'Ctrl-b', preventDefault: true, run: editor => { void revealDefinition(editor.state.selection.main.head); return true } },
      { key: 'Shift-f6', preventDefault: true, run: emitSemantic('rename') },
      { key: 'Alt-f7', preventDefault: true, run: emitSemantic('references') },
      { key: 'Alt-Enter', preventDefault: true, run: emitSemantic('codeAction') },
      { key: 'Ctrl-Alt-l', preventDefault: true, run: emitSemantic('format') },
      { key: 'Ctrl-Alt-b', preventDefault: true, run: emitSemantic('implementation') },
      { key: 'Ctrl-Alt-h', preventDefault: true, run: emitSemantic('callHierarchy') },
      { key: 'Ctrl-Shift-h', preventDefault: true, run: emitSemantic('typeHierarchy') },
      { key: 'Alt-F8', preventDefault: true, run: emitEvaluate },
      { key: 'Ctrl-p', preventDefault: true, run: emitSemantic('signature') },
      { key: 'Mod-w', preventDefault: true, run: () => adjustSelection(true) },
      { key: 'Mod-Shift-w', preventDefault: true, run: () => adjustSelection(false) },
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
const colors = HighlightStyle.define([
  { tag: [tags.keyword, tags.modifier, tags.controlKeyword], color: 'var(--syntax-keyword)', fontWeight: '600' },
  { tag: [tags.string, tags.special(tags.string), tags.regexp], color: 'var(--syntax-string)' },
  { tag: tags.comment, color: 'var(--syntax-comment)', fontStyle: 'italic' },
  { tag: [tags.number, tags.bool, tags.null], color: 'var(--syntax-number)' },
  { tag: [tags.typeName, tags.className, tags.namespace, tags.tagName], color: 'var(--syntax-type)' },
  { tag: [tags.function(tags.variableName), tags.function(tags.propertyName)], color: 'var(--syntax-function)' },
  { tag: [tags.propertyName, tags.attributeName, tags.labelName], color: 'var(--syntax-property)' },
  { tag: [tags.operator, tags.punctuation], color: 'var(--syntax-operator)' },
  { tag: [tags.meta, tags.annotation, tags.processingInstruction], color: 'var(--syntax-meta)' },
])
function editorAppearance() {
  return EditorView.theme({
    '&': { height: '100%', color: 'var(--text)', backgroundColor: 'var(--editor)', fontSize: `${props.settings.fontSize}px` },
    '.cm-scroller': { overflow: 'auto', fontFamily: 'var(--font-mono)', lineHeight: '1.7' },
    '.cm-content': { padding: '12px 0', caretColor: 'var(--bright)' },
    '.cm-line': { padding: '0 20px 0 12px' },
    '.cm-gutters': { backgroundColor: 'var(--gutter)', color: 'var(--muted)', border: 'none', minWidth: props.settings.lineNumbers ? '48px' : '16px', cursor: 'pointer' },
    '.cm-activeLineGutter': { backgroundColor: 'var(--active-line)', color: 'var(--secondary)' },
    // CodeMirror draws selection rectangles underneath line backgrounds.
    '.cm-activeLine': { backgroundColor: 'var(--active-line)' },
    '.cm-line.cm-has-breakpoint': { boxShadow: 'inset 4px 0 0 var(--error)' },
    '.cm-line.cm-has-bookmark': { boxShadow: 'inset 4px 0 0 var(--accent)' },
    '.cm-line.cm-debug-line': { backgroundColor: 'var(--debug-line)' },
    '.cm-lsp-highlight': { backgroundColor: 'var(--symbol-highlight)', borderRadius: '2px' },
    '.cm-lsp-inlay': { color: 'var(--muted)', fontStyle: 'italic', fontSize: '0.92em' },
    '.cm-selectionBackground': { backgroundColor: 'var(--selection-inactive)' },
    '&.cm-focused > .cm-scroller > .cm-selectionLayer .cm-selectionBackground': { backgroundColor: 'var(--selection)' },
    '&.cm-focused': { outline: 'none' },
    '.cm-cursor': { borderLeftColor: 'var(--bright)' },
    '.cm-panels': { backgroundColor: 'var(--panel)', color: 'var(--text)' },
    '.cm-searchMatch': { backgroundColor: 'var(--search-match)' },
    '.cm-tooltip': { backgroundColor: 'var(--elevated)', color: 'var(--text)', borderColor: 'var(--line-strong)' },
    '.cm-tooltip-autocomplete > ul > li[aria-selected]': { backgroundColor: 'var(--selected)', color: 'var(--bright)' },
    '.lsp-hover': { padding: '7px 9px', maxWidth: '460px', whiteSpace: 'pre-wrap', fontFamily: 'var(--font-mono)', fontSize: '12px' },
  }, { dark: props.theme === 'dark' })
}
function editorOptions() {
  return [
    EditorState.tabSize.of(props.settings.tabSize),
    indentUnit.of(' '.repeat(props.settings.tabSize)),
    props.settings.wordWrap && !heavy ? EditorView.lineWrapping : [],
    EditorView.theme({ '.cm-lineNumbers': { display: props.settings.lineNumbers ? 'flex' : 'none' } }),
  ]
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
          { key: 'Ctrl-Shift-Up', preventDefault: true, run: editingCommands['line.moveUp']! },
          { key: 'Ctrl-Shift-Down', preventDefault: true, run: editingCommands['line.moveDown']! },
          { key: 'Mod-Shift-j', preventDefault: true, run: editingCommands['line.join']! },
          { key: 'Mod-Shift-u', preventDefault: true, run: editingCommands['case.toggle']! },
          { key: 'Ctrl-Alt-Shift-Up', preventDefault: true, run: editingCommands['cursor.above']! },
          { key: 'Ctrl-Alt-Shift-Down', preventDefault: true, run: editingCommands['cursor.below']! },
          { key: 'Alt-j', preventDefault: true, run: editingCommands['occurrence.next']! },
          { key: 'Ctrl-Shift-Alt-j', preventDefault: true, run: editingCommands['occurrence.select']! },
          { key: 'Ctrl-Shift--', preventDefault: true, run: editingCommands.fold! },
          { key: 'Ctrl-Shift-=', preventDefault: true, run: editingCommands.unfold! },
          { key: 'Ctrl-Shift-Numpad_Subtract', preventDefault: true, run: editingCommands.foldAll! },
          { key: 'Ctrl-Shift-Numpad_Add', preventDefault: true, run: editingCommands.unfoldAll! },
          { key: 'Alt-Shift-Insert', preventDefault: true, run: () => { toggleColumnSelection(); return true } },
          // IDEA's template keys. Tab only consumes a pending slot; when there is none
          // the command returns false and normal indentation (or accepting a completion)
          // proceeds.
          { key: 'Ctrl-Alt-j', preventDefault: true, run: expandTemplate },
          { key: 'Ctrl-Alt-t', preventDefault: true, run: () => { emit('surround'); return true } },
          { key: 'Tab', preventDefault: true, run: nextTemplateStop },
          { key: 'Ctrl-Shift-Backspace', preventDefault: true, run: lastEditLocation },
        ]),
        basicSetup,
        EditorState.lineSeparator.of(props.content.includes('\r\n') ? '\r\n' : '\n'),
        language.of([]),
        ...(heavy ? [] : [syntaxHighlighting(colors)]),
        appearance.of(editorAppearance()),
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
        breakField,
        highlightField,
        hintField,
        EditorView.domEventHandlers({
          mousedown: (event, editor) => {
            if (!(event.target as HTMLElement).closest('.cm-gutters')) return false
            const pos = editor.posAtCoords({ x: event.clientX, y: event.clientY })
            if (pos === null) return false
            emit('breakpoint', editor.state.doc.lineAt(pos).number)
            return true
          },
        }),
        EditorView.updateListener.of(update => {
          if (update.docChanged && !replacing) { if (!dirty) { dirty = true; emit('change') } scheduleLspChange(); rangeStack = null; templateStops = []; noteEdit(); scheduleHints() }
          if (update.selectionSet || update.docChanged) {
            const pos = update.state.selection.main.head
            const line = update.state.doc.lineAt(pos)
            emit('cursor', line.number, pos - line.from + 1)
            if (update.selectionSet) scheduleHighlight()
          }
        }),
        EditorView.contentAttributes.of({ 'aria-label': `代码编辑器 ${props.path}`, spellcheck: 'false' }),
      ],
    }),
  })
  void loadLanguage(props.path)
  syncBreakDeco()
  if (props.active) view.focus()
  applyReveal(props.reveal)
  scheduleHighlight()
  scheduleHints()
})
watch(() => props.path, loadLanguage)
watch(() => props.active, async active => {
  if (active) { await nextTick(); view?.requestMeasure(); view?.focus() }
})
watch(() => props.theme, () => view?.dispatch({ effects: appearance.reconfigure(editorAppearance()) }))
watch(() => props.settings, () => view?.dispatch({ effects: [appearance.reconfigure(editorAppearance()), options.reconfigure(editorOptions()), indentGuides.reconfigure(props.settings.showIndentGuides ? indentGuidesExtension : []), setIndentGuides.of(props.settings.showIndentGuides)] }), { deep: true })
watch(() => props.lspEnabled, enabled => {
  view?.dispatch({ effects: lsp.reconfigure(enabled ? lspExtensions() : []) })
  if (!enabled) { view?.dispatch({ effects: [setHighlights.of([]), setHints.of([])] }); rangeStack = null; return }
  if (view) forceLinting(view)
  scheduleHighlight()
  scheduleHints()
})
watch(() => lspDiagnostics.get(props.path), () => { if (view && props.lspEnabled) forceLinting(view) })
watch(() => props.reveal, target => applyReveal(target))
// The parent already flips EditorState.readOnly through setReadOnly(); watching the
// prop too would re-dispatch the effect on every later re-render.
watch(() => [props.breakpoints, props.debugLine, props.bookmarks], () => syncBreakDeco())
onBeforeUnmount(() => { if (lspTimer !== undefined) clearTimeout(lspTimer); if (highlightTimer !== undefined) clearTimeout(highlightTimer); view?.destroy(); view = undefined })
</script>

<template><div ref="container" class="code-editor" /></template>
