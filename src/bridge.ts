import { reactive } from 'vue'
import type { Bookmark } from './bookmarks'
import type { TemplateSettings } from './templates'

export type { Bookmark }
export type { CustomTemplate, TemplateOverride, TemplateSettings } from './templates'

export interface Entry { name: string; path: string; kind: 'directory' | 'file' }
export interface Workspace { name: string; root: string; entries: Entry[] }
// Text encodings the native file layer can read and write. The key is what travels
// over the bridge; the label is what the status bar and dialog show.
export type EncodingKey = 'utf-8' | 'gbk' | 'cp1252' | 'system' | 'utf-16le' | 'utf-16be'
export const encodingLabels: Record<EncodingKey, string> = {
  'utf-8': 'UTF-8', gbk: 'GBK（中文）', cp1252: 'Windows-1252', system: '系统 ANSI', 'utf-16le': 'UTF-16 LE', 'utf-16be': 'UTF-16 BE',
}
export const encodingKeys = Object.keys(encodingLabels) as EncodingKey[]
export interface DocumentData { path: string; content: string; version: string; encoding: EncodingKey; bom: boolean; readOnly?: boolean }
export interface SaveResult { version: string; bytes: number; encoding?: EncodingKey; bom?: boolean }
export interface RecentProject { name: string; path: string; lastOpened: string; available: boolean }
export interface EditorSettings { fontSize: number; tabSize: number; wordWrap: boolean; lineNumbers: boolean; restoreLastProject: boolean; syncOnFocus: boolean; autoSave: boolean; showIndentGuides: boolean; bracketMatching: boolean; tabLimit: number }
export interface RunConfig { name: string; command: string; type?: 'shell' | 'debug' }
// IDEA's TODO index is driven by a list of "pattern -> description" entries, stored
// with the project so a repository carries its own markers.
export interface TodoPattern { pattern: string; description: string }
export interface JavaProjectSettings { jdkHome: string; jdkName: string; sourcePaths: string[]; outputPath: string; referencedLibraries: string[] }
export const defaultJavaProjectSettings: JavaProjectSettings = { jdkHome: '', jdkName: 'JavaSE-17', sourcePaths: [], outputPath: '', referencedLibraries: ['lib/**/*.jar'] }
export interface ProjectSettings { excludedDirs: string[]; runConfigs: RunConfig[]; bookmarks: Bookmark[]; todoPatterns: TodoPattern[]; templates: TemplateSettings; java: JavaProjectSettings; fileAssociations: Record<string, string> }
export interface ProjectForm { parent: string; name: string; template: 'empty' | 'java' | 'spring-boot' | 'maven' | 'gradle' | 'kotlin' | 'python' | 'node' | 'vue' | 'react'; source: string }
export interface AppState { recentProjects: RecentProject[]; settings: EditorSettings; lastProject: string | null; gitAvailable: boolean; defaultParent: string }
export const defaultEditorSettings: EditorSettings = { fontSize: 14, tabSize: 4, wordWrap: false, lineNumbers: true, restoreLastProject: false, syncOnFocus: true, autoSave: false, showIndentGuides: true, bracketMatching: true, tabLimit: 30 }
export const defaultProjectSettings: ProjectSettings = {
  excludedDirs: ['.git', 'node_modules', 'build', 'dist'],
  runConfigs: [],
  bookmarks: [],
  todoPatterns: [
    { pattern: 'TODO', description: '待办' },
    { pattern: 'FIXME', description: '需要修' },
    { pattern: 'XXX', description: '警告' },
    { pattern: 'HACK', description: '临时办法' },
  ],
  templates: { overrides: [], customs: [] },
  java: structuredClone(defaultJavaProjectSettings),
  fileAssociations: {},
}
export type Method = 'app.state' | 'app.quit' | 'dialog.pickDirectory' | 'workspace.open' | 'workspace.close' | 'workspace.list' | 'file.read' | 'file.write' | 'file.create' | 'file.readOnly' | 'file.lineSeparators' | 'file.rename' | 'file.delete' | 'file.copy' | 'file.reveal' | 'session.save' | 'session.load' | 'session.clear' | 'project.create' | 'project.clone' | 'project.clone.cancel' | 'projects.forget' | 'settings.update' | 'project.settings.get' | 'project.settings.update' | 'lsp.open' | 'lsp.change' | 'lsp.close' | 'lsp.request' | 'lsp.stop' | 'run.start' | 'run.write' | 'run.stop' | 'git.status' | 'git.diff' | 'git.stage' | 'git.unstage' | 'git.commit' | 'git.checkout' | 'git.log' | 'git.logFull' | 'git.pull' | 'git.fetch' | 'git.push' | 'git.rebase' | 'git.cherryPick' | 'git.stash' | 'git.stash.save' | 'git.stash.pop' | 'git.branch.create' | 'git.branch.delete' | 'git.merge' | 'git.tags' | 'git.tag.create' | 'git.tag.delete' | 'git.ignore' | 'git.aheadBehind' | 'git.blame' | 'git.diffSides' | 'git.diffHunks' | 'git.applyHunks' | 'git.compare' | 'search.run' | 'search.replace' | 'dap.start' | 'dap.setBreakpoints' | 'dap.setExceptionBreakpoints' | 'dap.threads' | 'dap.continue' | 'dap.pause' | 'dap.next' | 'dap.stepIn' | 'dap.stepOut' | 'dap.stackTrace' | 'dap.scopes' | 'dap.variables' | 'dap.evaluate' | 'dap.terminate' | 'dap.disconnect' | 'dap.breakpoints' | 'term.create' | 'term.write' | 'term.resize' | 'term.kill' | 'history.list' | 'history.content' | 'history.diff' | 'history.diffSides'
export interface GitChange { path: string; indexStatus: string; workStatus: string; staged: boolean; untracked: boolean; renameFrom: string }
export interface GitStatus { available: boolean; head?: string; branches?: string[]; changes?: GitChange[] }
export interface GitDiff { diff: string }
export interface GitCommit { hash: string; shortHash: string; author: string; date: string; subject: string }
export interface GitLog { commits: GitCommit[] }
export interface GitRef { name: string; type: 'local' | 'remote' | 'tag' }
export interface GitFullCommit { hash: string; shortHash: string; author: string; date: string; subject: string; parents: string[]; refs: GitRef[] }
export interface GitFullLog { commits: GitFullCommit[] }
export interface GitStashEntry { ref: string; message: string }
export interface GitStash { entries: GitStashEntry[] }
export interface GitAheadBehind { available: boolean; ahead: number; behind: number }
// One selectable hunk of a unified diff (IDEA's commit-viewer stage/unstage rows).
export interface GitHunk { index: number; header: string; body: string; additions: number; deletions: number }
export interface GitHunks { hunks: GitHunk[]; header: string }
export interface GitTags { tags: string[] }
export interface GitCompareFile { status: string; path: string }
export interface GitCompare { base: string; files: GitCompareFile[] }
export interface GitBlameLine { line: number; hash: string; author: string; content: string }
export interface GitBlame { lines: GitBlameLine[] }
// One aligned row of the side-by-side viewer. Marks are [start, length] byte ranges
// into that side's own text, so a change highlights only the words that differ.
export interface DiffCell { no: number; text: string }
export interface DiffRow { kind: 'equal' | 'insert' | 'delete' | 'change'; left?: DiffCell; right?: DiffCell; leftMarks?: [number, number][]; rightMarks?: [number, number][] }
export interface DiffSides { rows: DiffRow[]; truncated: boolean }
export interface LspDiagnostic { line: number; character: number; endLine?: number; endCharacter?: number; severity: number; message: string; source?: string }
export interface LspOpenResult { running: boolean; language: string }
export interface LspLocation { path: string; line: number; character: number }
export interface LspHoverResult { available: boolean; contents?: string }
export interface LspDefinitionResult { available: boolean; locations?: LspLocation[] }
export interface LspCompletionResult { available: boolean; items?: Array<{ label: string; kind: string; detail?: string; apply?: string }> }
export interface LspTextEdit { text: string; startLine: number; startChar: number; endLine: number; endChar: number }
export interface LspFileEdits { path: string; textEdits: LspTextEdit[] }
export interface LspRenameResult { available: boolean; edits?: LspFileEdits[] }
export interface LspReferencesResult { available: boolean; refs?: LspLocation[] }
export interface LspDocumentSymbol { name: string; kind: number; detail: string; startLine: number; startChar: number; endLine: number; endChar: number }
export interface LspWorkspaceSymbol { name: string; kind: number; path: string; line: number; character: number }
export interface LspSymbolsResult { available: boolean; symbols?: Array<{ name: string; kind: number } & Partial<LspDocumentSymbol> & Partial<LspWorkspaceSymbol>> }
export interface LspSignature { label: string; documentation?: string; parameters: Array<{ label: string }> }
export interface LspSignatureHelpResult { available: boolean; signatures?: LspSignature[]; activeSignature?: number; activeParameter?: number }
export interface LspCodeAction { title: string; index: number; kind?: string; preferred?: boolean; linkedDiagnostics?: boolean; edits: LspFileEdits[]; resolvable?: boolean }
export interface LspCodeActionResults { available: boolean; actions?: LspCodeAction[] }
export interface LspFormatResult { available: boolean; edits?: LspFileEdits[] }
export interface LspHighlight { kind: number; startLine: number; startChar: number; endLine: number; endChar: number }
export interface LspHighlightResult { available: boolean; highlights?: LspHighlight[] }
// An LSP range in wire form: 0-based line and UTF-16 character offsets.
export interface LspRange { start: { line: number; character: number }; end: { line: number; character: number } }
export interface LspRangeSpan { startLine: number; startChar: number; endLine: number; endChar: number }
export interface LspSelectionRangeResult { available: boolean; ranges?: LspRangeSpan[] }
// One node of a call or type hierarchy. `line`/`character` are the declaration,
// `callLine`/`callChar` the call site (calls only), and `raw` the untouched server
// item that the follow-up requests must echo back.
export interface LspHierarchyItem { name: string; kind: number; path: string; detail?: string; line?: number; character?: number; callLine?: number; callChar?: number; raw?: unknown }
export interface LspHierarchyResult { available: boolean; items?: LspHierarchyItem[]; calls?: LspHierarchyItem[] }
export interface LspInlayHint { line: number; character: number; label: string; paddingLeft?: boolean; paddingRight?: boolean; kind?: number }
export interface LspInlayHintResult { available: boolean; hints?: LspInlayHint[] }
export type LspRequestKind = 'hover' | 'definition' | 'completion' | 'rename' | 'references' | 'documentSymbol' | 'workspaceSymbol' | 'signatureHelp' | 'codeAction' | 'codeActionResolve' | 'formatting' | 'rangeFormatting' | 'implementation' | 'typeDefinition' | 'documentHighlight' | 'selectionRange' | 'inlayHint' | 'prepareCallHierarchy' | 'callHierarchyIncoming' | 'callHierarchyOutgoing' | 'prepareTypeHierarchy' | 'typeHierarchySupertypes' | 'typeHierarchySubtypes'
export interface HistoryEntry { id: string; reason: string; bytes: number; timeMillis: number; time: string }
export interface HistoryList { entries: HistoryEntry[] }
export interface HistoryContent { content: string; version: string }
export interface HistoryDiff { diff: string }
// Local history compared in the side-by-side viewer: the same rows as git.diffSides
// plus the snapshot header the native side builds.
export interface HistoryDiffSides extends DiffSides { header?: string }
export interface SearchMatch { path: string; line: number; column: number; preview: string; length: number }
export interface SearchOptions { query: string; regex: boolean; caseSensitive: boolean; wholeWord: boolean; include: string; exclude: string }
export interface SearchResult { matches: SearchMatch[]; truncated: boolean; fileCount: number }
export interface SearchReplaceResult { files: number; replacements: number }
export interface DapStartParams { command: string; args?: string[]; program: string; cwd?: string; kind: string; stopOnEntry?: boolean; env?: Record<string, string> | string[]; configuration?: Record<string, unknown> }
export interface DapFrame { id: number; name: string; line: number; column: number; path?: string; sourceName?: string; sourceReference?: number; presentationHint?: string }
export interface DapScope { name: string; reference: number; variablesReference: number; expensive: boolean }
export interface DapVariable { name: string; value: string; reference: number; named: boolean; type?: string; evaluateName?: string }
export interface DapBreakpointReport { path: string; verifiedLines: number[]; error?: string }
export interface DapStartResult { ok: boolean; capabilities?: Record<string, unknown>; breakpoints?: DapBreakpointReport[] }
// One entry of the adapter's exceptionBreakpointFilters capability: the checkbox
// rows IDEA's breakpoints dialog shows for caught/uncaught exceptions.
export interface DapExceptionFilter { filter: string; label?: string; description?: string; default?: boolean }
export interface DapThread { id: number; name: string }
// A gutter breakpoint: 1-based line plus the optional DAP attributes. `condition` is
// evaluated by the adapter each time the line is reached.
export interface DapBreakpoint { line: number; condition?: string; hitCondition?: string }
export interface DapBreakpointNote { line: number; message: string }
export interface DapBreakpointsResult { ok: boolean; path: string; verifiedLines: number[]; deferred?: boolean; messages?: DapBreakpointNote[] }
export interface DapOk { ok: boolean; allThreadsContinuation?: boolean }
export type DapEvent =
  | { event: 'stopped'; reason: string; threadId: number; text?: string }
  | { event: 'output'; category: string; text: string }
  | { event: 'breakpoint'; verified: boolean; line?: number; path?: string }
  | { event: 'terminated'; restartable?: boolean; connectionClosed?: boolean }
  | { event: 'continued'; threadId?: number }
  | { event: string; body?: Record<string, unknown> }
export interface Trace {
  id: number; method: string; target: string; started: string
  status: 'pending' | 'success' | 'error'; durationMs?: number; message?: string; code?: string
}
interface Reply {
  id: number; ok?: boolean; result?: unknown; event?: string; message?: string
  path?: string; paths?: unknown; diagnostics?: unknown; chunk?: string; code?: number; payload?: DapEvent; dataB64?: string
  error?: { code: string; message: string }; durationMs?: number
}
interface WebView {
  postMessage(message: unknown): void
  addEventListener(event: 'message', listener: (event: MessageEvent<Reply>) => void): void
}
declare global { interface Window { chrome?: { webview?: WebView } } }

const webview = typeof window === 'undefined' ? undefined : window.chrome?.webview
export const isDesktop = Boolean(webview)
export const traces = reactive<Trace[]>([])
export const cloneProgress = reactive<string[]>([])
export const lspDiagnostics = reactive(new Map<string, LspDiagnostic[]>())
export const runOutput = reactive<string[]>([])
// IDE-03 file watching: the native watcher's debounced batches. `version` bumps on
// every batch so a single watcher can refresh whatever the UI needs; `paths` is
// workspace-relative ('/'-joined), empty meaning "everything changed (overflow)".
export const fsChanges = reactive<{ version: number; paths: string[] }>({ version: 0, paths: [] })
export const runState = reactive<{ running: boolean; exit: number | null }>({ running: false, exit: null })
let nextId = 0
const pending = new Map<number, { resolve: (reply: Reply) => void }>()
webview?.addEventListener('message', ({ data }) => {
  if (data?.event === 'fs.changed' && Array.isArray(data.paths)) {
    fsChanges.paths = data.paths
    fsChanges.version++
    return
  }
  if (data?.event === 'lsp.diagnostics' && typeof data.path === 'string') {
    lspDiagnostics.set(data.path, Array.isArray(data.diagnostics) ? data.diagnostics as LspDiagnostic[] : [])
    return
  }
  if (data?.event === 'run.output' && typeof data.chunk === 'string') {
    runOutput.push(data.chunk)
    if (runOutput.length > 4000) runOutput.splice(0, runOutput.length - 4000)
    return
  }
  if (data?.event === 'run.exit' && typeof data.code === 'number') {
    runState.running = false
    runState.exit = data.code
    return
  }
  if (data?.event === 'dap.event' && data.payload) {
    applyDapEvent(data.payload)
    return
  }
  if (data?.event === 'term.output' && typeof data.id === 'number' && typeof data.dataB64 === 'string') {
    const bytes = fromBase64(data.dataB64)
    const listeners = termListeners.get(data.id)
    if (listeners?.size) for (const notify of listeners) notify(bytes)
    else {
      const queue = termPending.get(data.id) ?? []
      queue.push(bytes)
      if (queue.length > 256) queue.shift()
      termPending.set(data.id, queue)
    }
    return
  }
  if (!data || typeof data.id !== 'number') return
  if (data.event === 'clone.progress' && typeof data.message === 'string' && pending.has(data.id)) {
    cloneProgress.push(data.message.slice(0, 4096))
    if (cloneProgress.length > 200) cloneProgress.shift()
    return
  }
  if (typeof data.ok !== 'boolean') return
  const request = pending.get(data.id)
  if (request) { pending.delete(data.id); request.resolve(data) }
})

export function setNativeDirty(dirty: boolean) {
  webview?.postMessage({ type: 'documentState', dirty })
}

export function setNativeTheme(theme: 'light' | 'dark') {
  webview?.postMessage({ type: 'appearance', theme })
}

export function setLspDiagnostics(path: string, list: LspDiagnostic[]) {
  lspDiagnostics.set(path, list)
}

export function clearLspDiagnostics(path: string) {
  lspDiagnostics.delete(path)
}

export function beginRun() {
  runOutput.splice(0)
  runState.running = true
  runState.exit = null
}

export function endRun() {
  runState.running = false
}

export const dapState = reactive<{ running: boolean; paused: boolean; threadId: number; reason: string | null; program: string | null; currentLocation: { path: string; line: number } | null }>(
  { running: false, paused: false, threadId: 1, reason: null, program: null, currentLocation: null })
export const dapConsole = reactive<Array<{ category: string; text: string }>>([])
export const dapBreakpoints = reactive(new Map<string, DapBreakpoint[]>())  // rel path -> breakpoints
let dapThreadId = 1
export const dapCurrentThread = () => dapThreadId
export function dapSetCurrentLocation(location: { path: string; line: number } | null) { dapState.currentLocation = location }

function applyDapEvent(event: DapEvent) {
  if (event.event === 'stopped') {
    dapState.paused = true
    const thread = (event as { threadId?: number }).threadId
    if (thread) { dapState.threadId = thread; dapThreadId = thread }
    const reason = (event as { reason?: string }).reason ?? 'stopped'
    const text = (event as { text?: string }).text
    dapState.reason = text ? `${reason}: ${text}` : reason
  } else if (event.event === 'continued') {
    dapState.paused = false; dapState.reason = null; dapState.currentLocation = null
  } else if (event.event === 'output') {
    const output = event as { category?: string; text?: string }
    dapConsole.push({ category: output.category ?? 'console', text: output.text ?? '' })
    if (dapConsole.length > 4000) dapConsole.splice(0, dapConsole.length - 2000)
  } else if (event.event === 'terminated') {
    dapState.running = false; dapState.paused = false; dapState.reason = null; dapState.currentLocation = null
    const closed = (event as { connectionClosed?: boolean }).connectionClosed
    if (!closed) { dapConsole.push({ category: 'console', text: '调试会话已结束。' }); }
  }
}

export async function dapStart(params: DapStartParams): Promise<DapStartResult> {
  const result = await request<DapStartResult>('dap.start', { ...params })
  dapState.running = true; dapState.paused = false; dapState.reason = null; dapState.program = params.program
  // The adapter decides which lines it could bind; keep exactly those, with the
  // conditions the user set, so a restart re-applies the same list.
  for (const report of result.breakpoints ?? []) {
    const verified = report.verifiedLines ?? []
    const known = dapBreakpoints.get(report.path) ?? []
    const kept = known.length ? known.filter(point => verified.includes(point.line)) : verified.map(line => ({ line }))
    if (kept.length) dapBreakpoints.set(report.path, kept); else dapBreakpoints.delete(report.path)
  }
  return result
}
export async function dapSetBreakpoints(path: string, breakpoints: DapBreakpoint[]): Promise<DapBreakpointsResult> {
  const result = await request<DapBreakpointsResult>('dap.setBreakpoints', { path, breakpoints })
  if (result.deferred) return result  // session offline: keep the client-side list as-is
  const kept = breakpoints.filter(point => result.verifiedLines.includes(point.line))
  if (kept.length) dapBreakpoints.set(path, kept); else dapBreakpoints.delete(path)
  return result
}
export const dapStep = (kind: 'continue' | 'pause' | 'next' | 'stepIn' | 'stepOut', all = false) =>
  request<DapOk>(`dap.${kind}`, all && kind === 'continue' ? { all: true } : { threadId: dapCurrentThread() })
export const dapStackTrace = (threadId = dapCurrentThread()) => request<{ frames: DapFrame[]; totalFrames: number }>('dap.stackTrace', { threadId })
export const dapThreads = () => request<{ threads: DapThread[] }>('dap.threads')
export const dapSetExceptionBreakpoints = (filters: string[]) => request<DapOk>('dap.setExceptionBreakpoints', { filters })
export const dapScopes = (frameId: number) => request<{ scopes: DapScope[] }>('dap.scopes', { frameId })
export const dapVariables = (reference: number) => request<{ variables: DapVariable[] }>('dap.variables', { reference })
// `evaluate` (IDEA's Evaluate Expression / hover inspect). The body comes back from
// the adapter untouched, so `type` and `variablesReference` are adapter-specific.
export interface DapEvaluateResult { result: string; type?: string; variablesReference?: number }
export const dapEvaluate = (expression: string, context: 'hover' | 'watch' | 'repl', frameId: number) =>
  request<DapEvaluateResult>('dap.evaluate', { expression, context, frameId })
export async function dapTerminate() {
  dapState.running = false; dapState.paused = false; dapState.reason = null; dapState.currentLocation = null
  return request<DapOk>('dap.terminate')
}

export interface TermCreateResult { id: number }
const termListeners = new Map<number, Set<(bytes: Uint8Array) => void>>()
const termPending = new Map<number, Uint8Array[]>()
function toBase64(bytes: Uint8Array): string {
  let binary = ''
  for (let offset = 0; offset < bytes.length; offset += 0x8000)
    binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000))
  return btoa(binary)
}
function fromBase64(text: string): Uint8Array {
  const binary = atob(text)
  const bytes = new Uint8Array(binary.length)
  for (let index = 0; index < binary.length; ++index) bytes[index] = binary.charCodeAt(index)
  return bytes
}
// Subscribe to a terminal's raw output; anything buffered before subscribing flushes.
export function subscribeTerm(id: number, onBytes: (bytes: Uint8Array) => void): () => void {
  const listeners = termListeners.get(id) ?? new Set()
  termListeners.set(id, listeners)
  listeners.add(onBytes)
  for (const chunk of termPending.get(id) ?? []) onBytes(chunk)
  termPending.delete(id)
  return () => {
    listeners.delete(onBytes)
    if (!listeners.size) termListeners.delete(id)
  }
}
export const term = {
  create: (cols: number, rows: number) => request<TermCreateResult>('term.create', { cols, rows }),
  resize: (id: number, cols: number, rows: number) => request<{ ok: true }>('term.resize', { id, cols, rows }),
  kill: (id: number) => request<{ ok: true }>('term.kill', { id }),
  // Keystrokes are fire-and-forget (no per-character Trace entry). The unmatched
  // reply is dropped by the message listener because no pending id exists.
  write: (id: number, data: string | Uint8Array) => {
    if (!webview) throw new BridgeError('DESKTOP_REQUIRED', '浏览器预览没有本地终端。')
    const bytes = typeof data === 'string' ? new TextEncoder().encode(data) : data
    webview.postMessage({ id: ++nextId, method: 'term.write', params: { id, dataB64: toBase64(bytes) } })
  },
}

export class BridgeError extends Error {
  code: string
  constructor(code: string, message: string) { super(message); this.code = code }
}

const previewRoot = '内存示例 / 不访问本地磁盘'
const samples = new Map<string, string>([
  ['src/main.cpp', '#include <iostream>\n#include "workspace.hpp"\n\nint main() {\n    taocode::Workspace workspace;\n\n    // 浏览器示例：编辑仅保存在内存，不会写入磁盘。\n    std::cout << "Welcome to TaoCode" << std::endl;\n    return 0;\n}\n'],
  ['src/workspace.hpp', '#pragma once\n\nnamespace taocode {\n\nclass Workspace {\npublic:\n    void open();\n};\n\n}\n'],
  ['CMakeLists.txt', 'cmake_minimum_required(VERSION 3.24)\nproject(taocode_preview LANGUAGES CXX)\n\nset(CMAKE_CXX_STANDARD 20)\nadd_executable(preview src/main.cpp)\n'],
])
const versions = new Map([...samples.keys()].map(path => [path, 1]))
const previewState: AppState = { recentProjects: [{ name: 'TaoCode 内存示例', path: previewRoot, lastOpened: '', available: true }], settings: { ...defaultEditorSettings }, lastProject: null, gitAvailable: false, defaultParent: '' }
let previewProjectSettings: ProjectSettings = structuredClone(defaultProjectSettings)
function previewEntries(path: string): Entry[] {
  const prefix = path ? `${path}/` : ''
  const entries = new Map<string, Entry>()
  for (const file of samples.keys()) {
    if (!file.startsWith(prefix)) continue
    const rest = file.slice(prefix.length)
    const name = rest.split('/')[0]!
    if (rest.includes('/') && previewProjectSettings.excludedDirs.includes(name)) continue
    entries.set(name, { name, path: prefix + name, kind: rest.includes('/') ? 'directory' : 'file' })
  }
  return [...entries.values()].sort((a, b) => Number(b.kind === 'directory') - Number(a.kind === 'directory') || a.name.localeCompare(b.name))
}
async function previewRequest(method: Method, params: Record<string, unknown>): Promise<unknown> {
  if (method.startsWith('lsp.')) throw new BridgeError('LSP_UNAVAILABLE', '浏览器预览无语言服务，请在桌面端使用。')
  if (method.startsWith('run.')) throw new BridgeError('DESKTOP_REQUIRED', '浏览器预览不能运行命令，请在桌面端使用。')
  if (method.startsWith('git.')) throw new BridgeError('DESKTOP_REQUIRED', '浏览器预览不能操作 Git，请在桌面端使用。')
  if (method.startsWith('search.')) throw new BridgeError('DESKTOP_REQUIRED', '浏览器预览不能全局搜索，请在桌面端使用。')
  if (method.startsWith('dap.')) throw new BridgeError('DESKTOP_REQUIRED', '浏览器预览不能启动调试器，请在桌面端使用。')
  if (method.startsWith('term.')) throw new BridgeError('DESKTOP_REQUIRED', '浏览器预览不能开本地终端，请在桌面端使用。')
  if (method.startsWith('history.')) throw new BridgeError('DESKTOP_REQUIRED', '浏览器预览没有本地历史，请在桌面端使用。')
  if (method === 'file.create' || method === 'file.rename' || method === 'file.delete' || method === 'file.copy' || method === 'file.reveal' || method === 'file.readOnly' || method === 'file.lineSeparators' || method.startsWith('session.'))
    throw new BridgeError('DESKTOP_REQUIRED', '浏览器预览不能改动磁盘文件树，请在桌面端使用。')
  const path = String(params.path ?? '')
  switch (method) {
    case 'app.state': return structuredClone(previewState)
    case 'workspace.open': {
      if (path && path !== previewRoot) throw new BridgeError('DESKTOP_REQUIRED', '浏览器只能打开内存示例；请使用桌面端访问本地项目。')
      previewState.lastProject = previewRoot
      previewState.recentProjects = [{ name: 'TaoCode 内存示例', path: previewRoot, lastOpened: new Date().toISOString(), available: true }]
      return { name: 'taocode-preview', root: previewRoot, entries: previewEntries('') }
    }
    case 'workspace.close': previewState.lastProject = null; return { closed: true }
    case 'workspace.list': return previewEntries(path)
    case 'projects.forget': previewState.recentProjects = previewState.recentProjects.filter(project => project.path !== path); return structuredClone(previewState)
    case 'project.settings.get': return structuredClone(previewProjectSettings)
    case 'project.settings.update': {
      const next = { ...previewProjectSettings }
      if (params.excludedDirs !== undefined) {
        const excludedDirs = params.excludedDirs
        if (!Array.isArray(excludedDirs) || excludedDirs.some(name => typeof name !== 'string' || !name || name === '.' || name === '..' || /[\\/:]/.test(name))) throw new BridgeError('INVALID_SETTINGS', '排除项必须是单独的目录名。')
        next.excludedDirs = [...new Set(excludedDirs as string[])]
      }
      if (params.todoPatterns !== undefined) {
        const patterns = params.todoPatterns as TodoPattern[]
        const malformed = !Array.isArray(patterns) || patterns.length > 20 || patterns.some(entry =>
          !entry || typeof entry.pattern !== 'string' || !entry.pattern.trim() || entry.pattern.length > 200 || /[\r\n\u0000-\u001f]/.test(entry.pattern)
          || typeof entry.description !== 'string' || !entry.description.trim() || entry.description.length > 60
          || patterns.some(other => other !== entry && other.pattern === entry.pattern))
        if (malformed) throw new BridgeError('INVALID_SETTINGS', 'TODO 模式要写成非空且不重复的 {pattern, description}，最多 20 条。')
        next.todoPatterns = patterns.map(entry => ({ pattern: entry.pattern.trim(), description: entry.description.trim() }))
      }
      if (params.bookmarks !== undefined) {
        const list = params.bookmarks as Bookmark[]
        const malformed = !Array.isArray(list) || list.length > 200 || list.some(entry =>
          !entry || typeof entry.path !== 'string' || !entry.path || entry.path.startsWith('/') || entry.path.includes('\\') || entry.path.includes('..')
          || !Number.isInteger(entry.line) || entry.line < 1 || entry.line > 1000000
          || (entry.mnemonic !== undefined && (!Number.isInteger(entry.mnemonic) || entry.mnemonic < 0 || entry.mnemonic > 9)))
        if (malformed) throw new BridgeError('INVALID_SETTINGS', '书签要写成 {path, line, mnemonic?}：行号从 1 开始，编号只能是 0-9。')
        next.bookmarks = list.map(entry => (entry.mnemonic === undefined ? { path: entry.path, line: entry.line } : { ...entry }))
      }
      if (params.fileAssociations !== undefined) {
        const value = params.fileAssociations as Record<string, unknown>
        const languages = ['java', 'cpp', 'typescript', 'other']
        const malformed = !value || typeof value !== 'object' || Array.isArray(value) || Object.entries(value).some(([key, language]) =>
          !/^[a-z0-9]{1,16}$/.test(key) || typeof language !== 'string' || !languages.includes(language))
        if (malformed) throw new BridgeError('INVALID_SETTINGS', '文件类型关联要写成 扩展名 -> java/cpp/typescript/other。')
        next.fileAssociations = Object.fromEntries(Object.entries(value).map(([key, language]) => [key, language as string]))
      }
      if (params.templates !== undefined) {
        const value = params.templates as Partial<TemplateSettings>
        const encoder = new TextEncoder()
        const text = (value: unknown, max: number) => typeof value === 'string' && value.length > 0 && encoder.encode(value).length <= max
        const overrides = value?.overrides === undefined ? previewProjectSettings.templates.overrides : value.overrides
        const customs = value?.customs === undefined ? previewProjectSettings.templates.customs : value.customs
        const bad = !value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).some(key => !['overrides', 'customs'].includes(key))
          || !Array.isArray(overrides) || !Array.isArray(customs)
          || overrides.length > 400 || overrides.some(entry => !entry || Object.keys(entry).some(key => !['pattern', 'disabled'].includes(key))
            || !text(entry.pattern, 300) || typeof entry.disabled !== 'boolean')
          || new Set(overrides.map(entry => entry.pattern)).size !== overrides.length
          || customs.length > 100 || customs.some(entry => !entry || Object.keys(entry).some(key => !['key', 'body', 'description', 'languages'].includes(key))
            || typeof entry.key !== 'string' || !/^[A-Za-z][A-Za-z0-9]*$/.test(entry.key)
            || !text(entry.body, 8000) || !text(entry.description, 120)
            || !Array.isArray(entry.languages) || entry.languages.some(language => !['java', 'cpp', 'typescript', 'other'].includes(language)))
          || new Set(customs.map(entry => entry.key)).size !== customs.length
        if (bad) throw new BridgeError('INVALID_SETTINGS', '模板设置要写成 { overrides:[{pattern,disabled}], customs:[{key,body,description,languages}] }。')
        next.templates = {
          overrides: overrides.map(entry => ({ pattern: entry.pattern, disabled: entry.disabled })),
          customs: customs.map(entry => ({ key: entry.key, body: entry.body, description: entry.description, languages: [...entry.languages] })),
        }
      }
      if (params.java !== undefined) {
        const raw = params.java as Partial<JavaProjectSettings> | null | undefined
        const relative = (path: unknown, glob = false) => typeof path === 'string' && path.length > 0 && path.length <= 512 && !path.startsWith('/') &&
          !/[\\:<>"\u0000-\u001f]/.test(path) && (glob || !/[*?]/.test(path)) &&
          path.split('/').every(part => part && part !== '..')
        const parseJava = (): JavaProjectSettings | null => {
          if (!raw || Array.isArray(raw) || Object.keys(raw).some(key => !['jdkHome', 'jdkName', 'sourcePaths', 'outputPath', 'referencedLibraries'].includes(key))) return null
          if (typeof raw.jdkHome !== 'string' || raw.jdkHome.length > 1024 || /[\u0000-\u001f]/.test(raw.jdkHome) ||
            (raw.jdkHome && !/^[A-Za-z]:[\\/]|^\\\\/.test(raw.jdkHome))) return null
          if (typeof raw.jdkName !== 'string' || !/^JavaSE-(1\.8|9|[1-9][0-9])$/.test(raw.jdkName)) return null
          if (typeof raw.outputPath !== 'string' || (raw.outputPath && !relative(raw.outputPath))) return null
          const list = (paths: unknown, glob: boolean) => {
            if (!Array.isArray(paths) || paths.length > 64 || !paths.every(path => relative(path, glob))) return null
            const unique = [...new Set(paths.filter(Boolean))]
            return unique.length === paths.length ? unique as string[] : null
          }
          const sourcePaths = list(raw.sourcePaths, false)
          const libraries = list(raw.referencedLibraries, true)
          return sourcePaths && libraries ? { jdkHome: raw.jdkHome, jdkName: raw.jdkName, sourcePaths, outputPath: raw.outputPath, referencedLibraries: libraries } : null
        }
        const java = parseJava()
        if (!java) throw new BridgeError('INVALID_SETTINGS', 'Java 设置需要绝对 JDK 路径（可留空）、JavaSE 环境名和工作区内路径。')
        next.java = java
      }
      if (params.runConfigs !== undefined) {
        const configs = params.runConfigs as RunConfig[]
        const malformed = !Array.isArray(configs) || configs.length > 40 || configs.some((config, index) =>
          !config || typeof config.name !== 'string' || !config.name || typeof config.command !== 'string' || !config.command
          || configs.findIndex(other => other.name === config.name) !== index)
        if (malformed) throw new BridgeError('INVALID_SETTINGS', '运行配置要写成名字唯一、命令非空的 {name, command}，最多 40 个。')
        next.runConfigs = configs.map(config => ({ name: config.name, command: config.command }))
      }
      previewProjectSettings = next
      return { settings: structuredClone(previewProjectSettings), entries: previewEntries('') }
    }
    case 'settings.update': {
      const patch = params.settings as Record<string, unknown>
      if (!patch || typeof patch !== 'object') throw new BridgeError('INVALID_SETTINGS', '设置必须是对象')
      for (const [key, value] of Object.entries(patch)) {
        if (key === 'fontSize' ? !Number.isInteger(value) || Number(value) < 10 || Number(value) > 32 : key === 'tabSize' ? ![2, 4, 8].includes(Number(value)) || typeof value !== 'number' : !['wordWrap', 'lineNumbers', 'restoreLastProject', 'syncOnFocus', 'autoSave'].includes(key) || typeof value !== 'boolean') throw new BridgeError('INVALID_SETTINGS', `无效设置：${key}`)
      }
      Object.assign(previewState.settings, patch)
      return { ...previewState.settings }
    }
    case 'file.read': {
      if (!samples.has(path)) throw new BridgeError('NOT_FOUND', '示例文件不存在')
      // The in-memory samples are plain text: encoding is reported so the desktop and
      // preview shapes stay interchangeable for the UI.
      return { path, content: samples.get(path), version: String(versions.get(path)), encoding: 'utf-8', bom: false }
    }
    case 'file.write': {
      if (!samples.has(path)) throw new BridgeError('NOT_FOUND', '示例文件不存在')
      if (params.expectedVersion !== String(versions.get(path))) throw new BridgeError('CONFLICT', '文件已改变，请重新打开')
      const content = String(params.content)
      samples.set(path, content)
      const version = versions.get(path)! + 1
      versions.set(path, version)
      return { version: String(version), bytes: new TextEncoder().encode(content).length }
    }
    default: throw new BridgeError('DESKTOP_REQUIRED', '此操作需要 C++ 桌面端，浏览器预览不会创建项目或克隆仓库。')
  }
}

export async function request<T>(method: Method, params: Record<string, unknown> = {}): Promise<T> {
  const id = ++nextId
  if (method === 'project.clone') cloneProgress.splice(0)
  const target = params.path ?? params.name ?? (method === 'workspace.open' ? '选择工作区' : method === 'dialog.pickDirectory' ? '选择目录' : 'TaoCode')
  const trace = reactive<Trace>({ id, method, target: String(target), started: new Date().toLocaleTimeString('zh-CN', { hour12: false }), status: 'pending' })
  traces.unshift(trace)
  if (traces.length > 200) traces.pop()
  const started = performance.now()
  try {
    let result: unknown
    if (webview) {
      const reply = await new Promise<Reply>((resolve, reject) => {
        pending.set(id, { resolve })
        try { webview.postMessage({ id, method, params }) }
        catch (error) { pending.delete(id); reject(error) }
      })
      trace.durationMs = reply.durationMs
      if (!reply.ok) throw new BridgeError(reply.error?.code ?? 'NATIVE_ERROR', reply.error?.message ?? '原生操作失败')
      result = reply.result
    } else result = await previewRequest(method, params)
    trace.status = 'success'
    trace.message = result === null ? '已取消，未更改工作区' : method === 'file.write' ? (isDesktop ? '已写入磁盘' : '已保存到示例内存') : '已完成'
    return result as T
  } catch (error) {
    trace.status = 'error'
    trace.message = error instanceof Error ? error.message : String(error)
    trace.code = error instanceof BridgeError ? error.code : 'ERROR'
    throw error
  } finally { trace.durationMs ??= performance.now() - started }
}
