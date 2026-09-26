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
export interface RecentProject {
  name: string;
  path: string;
  lastOpened: string;
  available: boolean;
  // Source: RecentProjectMetaInfo.displayName (RecentProjectsManagerBase.kt:99-101).
  // Falls back to the directory name when missing; RecentProjectListActionProvider
  // builds `projectNameToDisplay` from it.
  displayName?: string;
  // Source: RecentProjectMetaInfo.customProjectName (RecentProjectsManagerBase.kt:108-110)
  // — cached .idea/.name to avoid I/O on non-local paths.
  projectName?: string;
  // Source: RecentProjectMetaInfo.activationTimestamp — epoch seconds used by
  // RecentProjectListActionProvider to sort the recent projects pop-up.
  activationTimestamp?: number;
  // Source: RecentProjectsBranchesProvider.getCurrentBranch — populated by the
  // welcome screen when a branch is known, otherwise undefined.
  branchName?: string;
}
// uiZoomPercent / compactMode / fullPathsInWindowHeader mirror IDEA's
// AppearanceConfigurable (IdeScaleTransformer bounds 50-400, compact mode, full
// paths in the window header). They are appearance state but ride the same
// settings.update channel as the editor flags, so one save covers both pages.
export interface EditorSettings { fontSize: number; tabSize: number; wordWrap: boolean; lineNumbers: boolean; restoreLastProject: boolean; syncOnFocus: boolean; autoSave: boolean; showIndentGuides: boolean; bracketMatching: boolean; tabLimit: number; useTabCharacter: boolean; showWhitespaces: boolean; formatOnSave: boolean; deleteToTrash: boolean; uiZoomPercent: number; compactMode: boolean; fullPathsInWindowHeader: boolean;
  // IDEA AppearanceConfigurable 'Tree Views' group: indent guides and smaller
  // tree indents; FileTree renders both.
  showTreeIndentGuides: boolean; compactTreeIndents: boolean;
  // IDEA 'UI Options' group: smooth scrolling (scroll-behavior on the whole UI)
  // and icons in menu items (the leading icon column of menu rows).
  smoothScrolling: boolean; showIconsInMenus: boolean;
  // IDEA 'Tool Windows' group: remember a size per tool window instead of one
  // shared stripe size, draw the tool window name under its stripe icon, and hide
  // the stripes entirely (UISettings.hideToolStripes / showToolWindowsNames /
  // rememberSizeForEachToolWindow). Defaults follow IDEA: names off, bars shown,
  // per-window size off.
  rememberSizeForEachToolWindow: boolean; showToolWindowNames: boolean; showToolWindowBars: boolean;
  // IDEA "Side-by-side layout on the left" (UISettings.leftHorizontalSplit) shows the
  // project view under the active left tool window; "Widescreen tool window layout"
  // (wideScreenSupport) maximizes vertical tool windows by limiting the height of
  // the bottom one. Both default off, as in IDEA.
  leftSideBySide: boolean; wideScreenSupport: boolean;
  // The same option for the right stripe (UISettings.rightHorizontalSplit).
  rightSideBySide: boolean;
  // IDEA "Show tool window numbers" (UISettings.showToolWindowsNumbers): the stripe
  // buttons carry Alt+1..9 mnemonics and those shortcuts focus the window.
  showToolWindowNumbers: boolean;
  // IDEA "Keep popups open for toggle items" (keepPopupsForToggles): a menu stays
  // open while you flip checkable rows; "Drag-and-drop with Alt pressed only"
  // (dndWithPressedAltOnly) requires Alt to start a tab drag.
  keepPopupsForToggles: boolean; dndWithPressedAltOnly: boolean;
  // IDEA PowerSaveMode (core-api PowerSaveMode.java): while it is on the IDE stops
  // code insight and background work. TaoCode turns off language-service requests
  // and the background polls; the status-bar widget toggles it.
  powerSaveMode: boolean;
  // AppearanceConfigurable, the three items that do have a real consumer here:
  //  - useContrastScrollbars (UISettings) -> high-contrast scrollbars in CSS
  //  - colorBlindness -> an SVG feColorMatrix filter on the root element
  //  - uiFontFamily / uiFontSize -> the UI font stack (editor font is separate)
  useContrastScrollbars: boolean;
  colorBlindness: 'none' | 'deuteranopia' | 'protanopia' | 'tritanopia';
  uiFontFamily: string; uiFontSize: number;
  // IDEA Images.SetBackgroundImage: the spec IDEA stores is
  // "path,opacity,fillType,anchor,keepRatio"; TaoCode keeps the same knobs as
  // separate fields and re-reads the file through app.readImage on startup.
  backgroundImagePath: string; backgroundImageOpacity: number;
  backgroundImageFill: 'scale' | 'tile' | 'center'; backgroundImageKeepRatio: boolean;
  // IDEA presentation mode (UISettingsState.presentationMode + presentationModeFontSize).
  presentationMode: boolean; presentationModeFontSize: number;
  // IDEA UISettingsState.mainMenuDisplayMode: UNDER_HAMBURGER_BUTTON /
  // MERGED_WITH_MAIN_TOOLBAR / SEPARATE_TOOLBAR -> the three top-bar layouts.
  mainMenuDisplayMode: 'hamburger' | 'merged' | 'separate';
  // IDEA GeneralSettings.isSupportScreenReaders: announce notifications to assistive
  // technology and suppress hover tooltips (see the checkbox comment in IDEA).
  supportScreenReaders: boolean }
// IDEA's Run Configuration: a program with arguments, a working directory, an
// environment block and an optional "before launch" task chain. `type` picks the
// runner (shell through cmd.exe vs a direct executable).
export interface RunConfig {
  name: string
  type?: 'shell' | 'application' | 'debug'
  command: string
  program?: string
  args?: string[]
  cwd?: string
  env?: string[]
  // Before-launch build steps, run in order; a non-zero exit aborts the run
  // (IDEA's "Before launch: Build" gate).
  beforeLaunch?: Array<{ name: string; command: string }>
  // The debug adapter key from TaoCode.dap.json. IDEA keeps it in the run
  // configuration's Debugger tab; the Debug panel reads the same field instead of
  // keeping a second, editable copy of the launch settings.
  adapter?: string
}
export interface RunStartParams { command?: string; program?: string; args?: string[]; cwd?: string; env?: string[]; shell?: boolean; label?: string; beforeLaunch?: Array<{ name: string; command: string }> }
// IDEA's TODO index is driven by a list of "pattern -> description" entries, stored
// with the project so a repository carries its own markers.
export interface TodoPattern { pattern: string; description: string }
export interface JavaProjectSettings { jdkHome: string; jdkName: string; sourcePaths: string[]; outputPath: string; referencedLibraries: string[] }
export const defaultJavaProjectSettings: JavaProjectSettings = { jdkHome: '', jdkName: 'JavaSE-17', sourcePaths: [], outputPath: '', referencedLibraries: ['lib/**/*.jar'] }
export interface ProjectSettings { excludedDirs: string[]; runConfigs: RunConfig[]; bookmarks: Bookmark[]; todoPatterns: TodoPattern[]; templates: TemplateSettings; java: JavaProjectSettings; fileAssociations: Record<string, string> }
export interface ProjectForm { parent: string; name: string; template: 'empty' | 'cpp' | 'java' | 'spring-boot' | 'maven' | 'gradle' | 'kotlin' | 'python' | 'node' | 'vue' | 'react'; source: string }
export interface AppState { recentProjects: RecentProject[]; settings: EditorSettings; lastProject: string | null; gitAvailable: boolean; defaultParent: string }
export const defaultEditorSettings: EditorSettings = { fontSize: 14, tabSize: 4, wordWrap: false, lineNumbers: true, restoreLastProject: false, syncOnFocus: true, autoSave: false, showIndentGuides: true, bracketMatching: true, tabLimit: 30, useTabCharacter: false, showWhitespaces: false, formatOnSave: false, deleteToTrash: true, uiZoomPercent: 100, compactMode: false, fullPathsInWindowHeader: false, showTreeIndentGuides: false, compactTreeIndents: false, smoothScrolling: true, showIconsInMenus: true, rememberSizeForEachToolWindow: false, showToolWindowNames: false, showToolWindowBars: true, leftSideBySide: false, wideScreenSupport: false, rightSideBySide: false, showToolWindowNumbers: false, keepPopupsForToggles: false, dndWithPressedAltOnly: false, powerSaveMode: false, useContrastScrollbars: false, colorBlindness: 'none', uiFontFamily: '', uiFontSize: 13, backgroundImagePath: '', backgroundImageOpacity: 100, backgroundImageFill: 'scale', backgroundImageKeepRatio: true, presentationMode: false, presentationModeFontSize: 24, mainMenuDisplayMode: 'merged', supportScreenReaders: false }
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
export type Method = 'app.state' | 'app.quit' | 'dialog.pickDirectory' | 'workspace.open' | 'workspace.close' | 'workspace.list' | 'file.read' | 'file.write' | 'file.create' | 'file.readOnly' | 'file.lineSeparators' | 'file.rename' | 'file.delete' | 'file.copy' | 'file.reveal' | 'shell.reveal' | 'file.readBinary' | 'file.usages' | 'session.save' | 'session.load' | 'session.clear' | 'project.create' | 'project.clone' | 'project.clone.cancel' | 'projects.forget' | 'projects.forgetMany' | 'settings.update' | 'project.settings.get' | 'project.settings.update' | 'lsp.open' | 'lsp.change' | 'lsp.close' | 'lsp.request' | 'lsp.stop' | 'run.start' | 'run.write' | 'run.stop' | 'git.status' | 'git.diff' | 'git.stage' | 'git.unstage' | 'git.commit' | 'git.checkout' | 'git.log' | 'git.logFull' | 'git.pull' | 'git.fetch' | 'git.push' | 'git.rebase' | 'git.cherryPick' | 'git.stash' | 'git.stash.save' | 'git.stash.pop' | 'git.branch.create' | 'git.branch.delete' | 'git.revert' | 'git.reset' | 'git.merge' | 'git.tags' | 'git.tag.create' | 'git.tag.delete' | 'git.ignore' | 'git.user' | 'git.authors' | 'git.aheadBehind' | 'git.blame' | 'git.diffSides' | 'git.diffHunks' | 'git.applyHunks' | 'git.compare' | 'git.fileHistory' | 'git.showCommit' | 'git.worktree.list' | 'git.worktree.add' | 'git.worktree.remove' | 'git.submodules' | 'git.submodule.update' | 'git.cancel' | 'search.run' | 'search.preview' | 'search.replace' | 'search.replaceSelected' | 'search.cancel' | 'dap.start' | 'dap.setBreakpoints' | 'dap.setExceptionBreakpoints' | 'dap.threads' | 'dap.continue' | 'dap.pause' | 'dap.next' | 'dap.stepIn' | 'dap.stepOut' | 'dap.stackTrace' | 'dap.scopes' | 'dap.variables' | 'dap.evaluate' | 'dap.terminate' | 'dap.disconnect' | 'dap.breakpoints' | 'term.create' | 'term.write' | 'term.resize' | 'term.kill' | 'term.list' | 'history.list' | 'history.content' | 'history.diff' | 'history.diffSides' | 'plugin.list' | 'plugin.setEnabled' | 'app.memory' | 'dialog.pickImage' | 'app.readImage'
export interface GitChange { path: string; indexStatus: string; workStatus: string; staged: boolean; untracked: boolean; renameFrom: string }
// The repository's configured author (`git config user.name` / `user.email`), which IDEA's
// CommitAuthorComponent shows above the commit actions and can override per commit.
export interface GitUser { name: string; email: string }
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
// `configured` distinguishes 'no server is set up for this language' from 'the
// server is still starting' — the status bar only reports the latter as indexing.
export interface LspOpenResult { running: boolean; language: string; configured?: boolean }
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
// A preview row: the same coordinates as a match plus the exact text that would be
// replaced and the line as it will read afterwards (regex $1 already applied by the
// native side, so the UI never re-implements substitution).
export interface SearchPreviewMatch extends SearchMatch { before: string; after: string }
// A search the user abandoned: the native walk polls a cancel flag between files, so
// the reply arrives quickly with `cancelled` set instead of blocking to the end.
export interface SearchCancelled { cancelled: true }
export interface SearchOptions { query: string; regex: boolean; caseSensitive: boolean; wholeWord: boolean; include: string; exclude: string }
export interface SearchResult { matches: SearchMatch[]; truncated: boolean; fileCount: number; cancelled?: boolean; skippedNonUtf8?: number }
export interface SearchPreviewResult { matches: SearchPreviewMatch[]; truncated: boolean; fileCount: number; cancelled?: boolean }
// `skippedFiles` counts the files the user ticked that the walk never reached because
// it hit the 100k-file ceiling. A replace that skipped files is NOT a complete
// replace, so it must not be reported as one. `skippedNonUtf8` counts files whose
// bytes survive neither UTF-8 nor GBK decoding — reported, not silently absent.
export interface SearchReplaceResult { files: number; replacements: number; truncated?: boolean; skippedFiles?: number; skippedNonUtf8?: number }
export interface BinaryView { path: string; size: number; truncated: boolean; bytes: number; base64: string; kind: string; readOnly?: boolean }
export interface UsageHit { path: string; line: number; column: number; preview: string }
// `scope`/`kind` are sent by the native side on purpose: usages_of() is a
// workspace-wide TEXT scan, not a language-level Find Usages (no PSI, no scope
// resolution). The UI has to say so, because an empty hit list does not mean "no
// references" and a hit list can contain namesakes.
export interface UsageResult { path: string; symbol: string; scanned: number; truncated: boolean; hits: UsageHit[]; scope?: string; kind?: string }
export interface GitFileHistory { path: string; commits: Array<GitCommit & { paths: string[] }> }
export interface GitShowCommit { revision: string; patch: string; sides: DiffRow[] }
export interface GitWorktree { path: string; branch: string; head?: string; bare: boolean; detached: boolean; locked: boolean; prunable: boolean }
export interface GitWorktrees { worktrees: GitWorktree[] }
export interface GitSubmodule { status: string; commit: string; path: string; describe: string }
export interface GitSubmodules { submodules: GitSubmodule[] }
// IDEA's MemoryUsagePanel text: "NNN of MMM M". The host reports its own process
// memory (the JVM heap has no equivalent here).
export interface ProcessMemory { workingSetMb: number; peakWorkingSetMb: number; privateMb: number; available: boolean }
export interface TerminalInfo { id: number; running: boolean }
export interface TerminalList { terminals: TerminalInfo[] }
// A plugin contributes entry points only — commands point at actions TaoCode already
// owns, templates are validated like any project custom template. No third-party code
// is ever loaded into the host.
export interface PluginCommand { id: string; title: string; action: string; group: string }
export interface PluginTemplate { key: string; body: string; description: string; languages: string[] }
export interface PluginInfo {
  id: string; name: string; version: string; description: string; path: string
  enabled: boolean; error?: string; commands: PluginCommand[]; templates: PluginTemplate[]
}
export interface PluginList { plugins: PluginInfo[] }
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
// `verified` is the adapter's own verdict, sent on the `breakpoint` event: a
// breakpoint the user set on a blank line is unverified until the adapter moves it
// somewhere it can actually bind.
export interface DapBreakpoint { line: number; condition?: string; hitCondition?: string; verified?: boolean }
export interface DapBreakpointNote { line: number; message: string }
export interface DapBreakpointsResult { ok: boolean; path: string; verifiedLines: number[]; deferred?: boolean; messages?: DapBreakpointNote[] }
export interface DapOk { ok: boolean; allThreadsContinuation?: boolean }
export type DapEvent =
  | { event: 'stopped'; reason: string; threadId: number; text?: string }
  | { event: 'output'; category: string; text: string }
  // `id` is the adapter's own handle for the breakpoint, present when it sends one;
  // it is what makes a moved line identifiable across two reports.
  | { event: 'breakpoint'; verified: boolean; line?: number; path?: string; id?: string | number }
  | { event: 'terminated'; restartable?: boolean; connectionClosed?: boolean }
  | { event: 'continued'; threadId?: number }
  // The adapter's thread list changed. Its body is forwarded raw by the native
  // layer (reason: 'started' | 'exited', threadId), so both shapes are read.
  | { event: 'thread'; reason?: string; threadId?: number; body?: { reason?: string; threadId?: number } }
  // The debuggee's own status. Not the same thing as `terminated`, which ends the
  // session: an adapter sends `exited` with the code and may then send `terminated`.
  | { event: 'exited'; exitCode: number }
  // The three DAP progress events (progressStart/Update/End) reach the UI as one
  // shape distinguished by `phase`, so a long adapter startup can show a bar.
  | { event: 'progress'; phase: 'start' | 'update' | 'end'; progressId?: string; requestId?: string; title?: string; message?: string; percentage?: number }
  // A loaded shared library. `path` is workspace-relative; the native layer turns
  // the adapter's absolute path into it before the event is delivered.
  | { event: 'module'; reason: 'new' | 'changed' | 'removed'; module?: { id?: string | number; name?: string; type?: string; sourceReference?: number }; path?: string }
  // A source the adapter has loaded. DAP gives it no id, so the source reference,
  // the path and the name are the identity, in that order.
  | { event: 'loadedSource'; reason: 'new' | 'changed' | 'removed'; source?: { name?: string; sourceReference?: number }; path?: string }
  | { event: string; body?: Record<string, unknown> }
export interface Trace {
  id: number; method: string; target: string; started: string
  status: 'pending' | 'success' | 'error'; durationMs?: number; message?: string; code?: string
}
interface Reply {
  id: number; ok?: boolean; result?: unknown; event?: string; message?: string
  path?: string; paths?: unknown; diagnostics?: unknown; chunk?: string; code?: number; payload?: DapEvent; dataB64?: string
  // A chained run ("Before launch") reports how many steps are still queued, so the
  // console can stay open until the last one exits.
  remaining?: number; aborted?: boolean
  // git.progress: the git worker's live queue depth and running flag.
  running?: boolean; queued?: number
  // term.opened / fs.watchStopped carry a working directory and a stop reason.
  cwd?: string; reason?: string; restarting?: boolean; attempt?: number
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
// Console output arrives as bytes (a build prints in its own code page), so it is
// decoded incrementally: a chunk boundary can split a multi-byte character.
const runDecoder = new TextDecoder('utf-8')
// IDE-03 file watching: the native watcher's debounced batches. `version` bumps on
// every batch so a single watcher can refresh whatever the UI needs; `paths` is
// workspace-relative ('/'-joined), empty meaning "everything changed (overflow)".
export const fsChanges = reactive<{ version: number; paths: string[] }>({ version: 0, paths: [] })
export const runState = reactive<{ running: boolean; exit: number | null }>({ running: false, exit: null })
// IDEA's InfoAndProgressPanel: the git worker reports its real queue depth and
// running flag, so the status bar shows background VCS work exactly when there is
// some. One event, no polling.
export const gitProgress = reactive({ running: false, queued: 0 })
// The host announces three things the UI must react to. They used to be sent and
// dropped on the floor (dead events): a server-driven file write, a terminal opened
// on the adapter's behalf, and a file watcher that died and was restarted.
export const lspEdited = reactive({ path: '', version: 0 })
export const termOpened = reactive({ id: 0, cwd: '', version: 0 })
export const watchStopped = reactive({ reason: '', restarting: false, attempt: 0, version: 0 })
// Local-history snapshot failures reported by file.write (best-effort, never
// blocking the save — but never silent either).
export const historyNotes = reactive<Array<{ path: string; message: string; at: string }>>([])
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
  if (data?.event === 'run.output') {
    // Bytes, not text: a build prints in the console code page and a chunk boundary
    // can fall inside a multi-byte character, so decoding is streamed and flushed
    // when the last step of the run exits.
    const text = typeof data.dataB64 === 'string' ? runDecoder.decode(fromBase64(data.dataB64), { stream: true })
      : typeof data.chunk === 'string' ? data.chunk : null
    if (text === null) return
    if (text) runOutput.push(text)
    if (runOutput.length > 4000) runOutput.splice(0, runOutput.length - 4000)
    return
  }
  if (data?.event === 'run.exit' && typeof data.code === 'number') {
    // A chained run ("Before launch" steps) emits one exit per step; the console
    // stays in the running state until the last step has reported.
    const remaining = typeof data.remaining === 'number' ? data.remaining : 0
    const tail = runDecoder.decode()
    if (tail) runOutput.push(tail)
    if (remaining > 0) { runState.exit = data.code; return }
    runState.running = false
    runState.exit = data.code
    return
  }
  if (data?.event === 'term.exit' && typeof data.id === 'number') {
    emitTermExit(data.id, typeof data.code === 'number' ? data.code : 0)
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
  if (data?.event === 'lsp.edited' && typeof data.path === 'string') {
    lspEdited.path = data.path
    lspEdited.version++
    return
  }
  if (data?.event === 'term.opened' && typeof data.id === 'number') {
    termOpened.id = data.id
    termOpened.cwd = typeof data.cwd === 'string' ? data.cwd : ''
    termOpened.version++
    return
  }
  if (data?.event === 'fs.watchStopped') {
    watchStopped.reason = typeof data.reason === 'string' ? data.reason : ''
    watchStopped.restarting = data.restarting === true
    watchStopped.attempt = typeof data.attempt === 'number' ? data.attempt : 0
    watchStopped.version++
    return
  }
  if (data?.event === 'history.note') {
    // A local-history snapshot failed for one save: non-blocking, but the restore
    // timeline now has a gap the user should know about.
    const path = typeof data.path === 'string' ? data.path : ''
    const message = typeof data.message === 'string' ? data.message : ''
    historyNotes.push({ path, message, at: new Date().toLocaleTimeString('zh-CN', { hour12: false }) })
    if (historyNotes.length > 50) historyNotes.shift()
    return
  }
  if (data?.event === 'git.progress') {
    gitProgress.running = data.running === true
    gitProgress.queued = typeof data.queued === 'number' && data.queued > 0 ? Math.floor(data.queued) : 0
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

export const dapState = reactive<{ running: boolean; paused: boolean; threadId: number; reason: string | null; program: string | null; currentLocation: { path: string; line: number } | null; exitCode: number | null }>(
  { running: false, paused: false, threadId: 1, reason: null, program: null, currentLocation: null, exitCode: null })
export const dapConsole = reactive<Array<{ category: string; text: string }>>([])
export const dapBreakpoints = reactive(new Map<string, DapBreakpoint[]>())  // rel path -> breakpoints
// The three lists below are what the adapter's `progress` / `module` / `loadedSource`
// events build up. They are separate from `dapState` because they are collections
// the panel renders as rows, not fields of the session.
export interface DapProgress { id: string; requestId: string | null; title: string; message: string; percentage: number | null }
export interface DapModule { id: string; name: string; type?: string; sourceReference?: number; path?: string }
export interface DapLoadedSource { key: string; name: string; sourceReference?: number; path?: string }
export const dapProgress = reactive<DapProgress[]>([])
export const dapModules = reactive<DapModule[]>([])
export const dapLoadedSources = reactive<DapLoadedSource[]>([])
// The adapter's thread list can change between two stops. The bridge cannot push
// into a component's own ref, so it bumps this and the panel refetches — the same
// `version` signal the file watcher uses.
export const dapThreadSignal = reactive<{ version: number; reason: string | null; threadId: number | null }>(
  { version: 0, reason: null, threadId: null })
let dapThreadId = 1
const dapCurrentThread = () => dapThreadId
export function dapSetCurrentLocation(location: { path: string; line: number } | null) { dapState.currentLocation = location }

// DAP ids are "string | number" depending on the adapter; every list here is keyed
// by the string form so a numeric and a textual id for the same thing cannot both
// land in the list.
function idKey(raw: unknown): string | null {
  if (typeof raw === 'string') return raw || null
  if (typeof raw === 'number' && Number.isFinite(raw)) return String(raw)
  return null
}
let unnamedProgress = 0
function applyDapProgress(payload: { phase?: unknown; progressId?: unknown; requestId?: unknown; title?: unknown; message?: unknown; percentage?: unknown }) {
  const phase = payload.phase
  if (phase !== 'start' && phase !== 'update' && phase !== 'end') return
  const key = idKey(payload.progressId)
  // DAP makes progressId mandatory. An adapter that leaves it out still describes
  // one operation: a start opens its own row under a synthetic key, while an
  // update/end can only mean the newest operation still in flight.
  const id = key ?? (phase === 'start' ? `progress-${++unnamedProgress}` : dapProgress[dapProgress.length - 1]?.id)
  if (!id) return
  const existing = dapProgress.find(entry => entry.id === id)
  if (phase === 'end') {
    if (existing) dapProgress.splice(dapProgress.indexOf(existing), 1)
    return
  }
  const message = typeof payload.message === 'string' ? payload.message : ''
  const percentage = typeof payload.percentage === 'number' && Number.isFinite(payload.percentage) ? payload.percentage : null
  if (phase === 'update') {
    // A partial update keeps what it does not mention: percentage is often omitted
    // once an operation becomes indeterminate.
    if (!existing) return
    if (message) existing.message = message
    if (percentage !== null) existing.percentage = percentage
    return
  }
  const title = typeof payload.title === 'string' ? payload.title : existing?.title ?? ''
  // 'start' for something already open refreshes it; adapters replay their list
  // after a restart and a second row for one operation would be a lie.
  if (existing) { existing.title = title; existing.message = message; existing.percentage = percentage; return }
  dapProgress.push({ id, requestId: idKey(payload.requestId), title, message, percentage })
}
// The adapter reports what it actually bound, which can differ from what the user
// asked for: a breakpoint dropped on a blank line is moved to the next line the
// adapter can bind. `dapBreakpoints` is what the editor gutter draws from, so
// fixing it here moves the mark without the editor polling for it.
// Where each breakpoint id was last reported. The adapter identifies a breakpoint
// by id across events, so remembering it turns "the line moved" from a guess into
// a fact. Ids are session-scoped, so this is cleared with the session.
const dapBreakpointIds = new Map<string, { path: string; line: number }>()
function applyDapBreakpoint(payload: { verified?: unknown; line?: unknown; path?: unknown; id?: unknown }) {
  const path = typeof payload.path === 'string' ? payload.path : ''
  const line = typeof payload.line === 'number' && Number.isFinite(payload.line) ? Math.trunc(payload.line) : 0
  if (!path || line < 1) return  // nothing to attribute the report to
  const verified = payload.verified === true
  const id = idKey(payload.id)
  // A move is exact when the same id was seen before at a different line of the
  // same file: that row is the one that moved. Read the previous report before it
  // is replaced by this one, otherwise there is nothing to compare against.
  const known = id ? dapBreakpointIds.get(id) : undefined
  const from = known && known.path === path ? known.line : 0
  if (id) dapBreakpointIds.set(id, { path, line })
  const list = dapBreakpoints.get(path) ?? []
  const target = list.find(point => point.line === line)
    ?? (from && from !== line ? list.find(point => point.line === from) : undefined)
    // No id, or this is the first report for it: a verified line that is not in the
    // local list can only be matched by elimination — when exactly one breakpoint
    // of this file is still unconfirmed, that is the one the adapter moved.
    ?? (verified && list.filter(point => point.verified !== true).length === 1
      ? list.find(point => point.verified !== true) : undefined)
  if (!target) {
    // Nothing here is ours: either the adapter is reporting a breakpoint this
    // client never set (another client, a function breakpoint resolved to a line),
    // or it rejected a line nobody asked for. The latter is not worth a row.
    if (!verified) return
    dapBreakpoints.set(path, [...list, { line, verified: true }].sort((a, b) => a.line - b.line))
    return
  }
  if (target.line !== line) {
    target.line = line
    dapBreakpoints.set(path, [...list].sort((a, b) => a.line - b.line))
  }
  target.verified = verified
}
function applyDapThread(payload: { reason?: unknown; threadId?: unknown; body?: { reason?: unknown; threadId?: unknown } }) {
  const body = payload.body
  const reason = typeof payload.reason === 'string' ? payload.reason : typeof body?.reason === 'string' ? body.reason : null
  const raw = typeof payload.threadId === 'number' ? payload.threadId : typeof body?.threadId === 'number' ? body.threadId : null
  dapThreadSignal.reason = reason
  dapThreadSignal.threadId = raw
  // The panel refetches `dap.threads` on this; the bridge does not keep a thread
  // list of its own that could drift from the adapter's.
  dapThreadSignal.version++
}
function applyDapModule(payload: { reason?: unknown; module?: { id?: unknown; name?: unknown; type?: unknown; sourceReference?: unknown }; path?: unknown }) {
  const id = idKey(payload.module?.id)
  if (!id) return
  const existing = dapModules.find(entry => entry.id === id)
  if (payload.reason === 'removed') {
    if (existing) dapModules.splice(dapModules.indexOf(existing), 1)
    return
  }
  const next: DapModule = { id, name: typeof payload.module?.name === 'string' ? payload.module.name : '' }
  const type = typeof payload.module?.type === 'string' ? payload.module.type : ''
  if (type) next.type = type
  const reference = typeof payload.module?.sourceReference === 'number' ? payload.module.sourceReference : 0
  if (reference) next.sourceReference = reference
  if (typeof payload.path === 'string' && payload.path) next.path = payload.path
  // 'new' for something already known is the same as 'changed': adapters replay the
  // whole list after a restart, and a duplicate row would be a lie.
  if (existing) Object.assign(existing, next)
  else dapModules.push(next)
}
function applyDapLoadedSource(payload: { reason?: unknown; source?: { name?: unknown; sourceReference?: unknown }; path?: unknown }) {
  const name = typeof payload.source?.name === 'string' ? payload.source.name : ''
  const path = typeof payload.path === 'string' ? payload.path : ''
  const reference = typeof payload.source?.sourceReference === 'number' ? payload.source.sourceReference : 0
  // No id in the event: the source reference identifies it when the adapter has
  // one, otherwise the path, otherwise the display name.
  const key = reference ? `ref:${reference}` : path ? `path:${path}` : `name:${name}`
  const existing = dapLoadedSources.find(entry => entry.key === key)
  if (payload.reason === 'removed') {
    if (existing) dapLoadedSources.splice(dapLoadedSources.indexOf(existing), 1)
    return
  }
  const next: DapLoadedSource = { key, name }
  if (reference) next.sourceReference = reference
  if (path) next.path = path
  if (existing) Object.assign(existing, next)
  else dapLoadedSources.push(next)
}

export function applyDapEvent(event: DapEvent) {
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
  } else if (event.event === 'exited') {
    // The program ended on its own. This deliberately does not touch `running`:
    // adapters send `terminated` next, and that is the event that ends the
    // session. What is recorded here is the code the UI has to show.
    const raw = (event as { exitCode?: unknown }).exitCode
    dapState.exitCode = typeof raw === 'number' && Number.isFinite(raw) ? Math.trunc(raw) : 0
    dapConsole.push({
      category: dapState.exitCode === 0 ? 'telemetry' : 'stderr',
      text: dapState.exitCode === 0 ? '程序已退出，退出码 0。' : `程序已退出，退出码 ${dapState.exitCode}。`,
    })
  } else if (event.event === 'progress') {
    applyDapProgress(event as { phase?: unknown; progressId?: unknown; requestId?: unknown; title?: unknown; message?: unknown; percentage?: unknown })
  } else if (event.event === 'module') {
    applyDapModule(event as { reason?: unknown; module?: { id?: unknown; name?: unknown; type?: unknown; sourceReference?: unknown }; path?: unknown })
  } else if (event.event === 'loadedSource') {
    applyDapLoadedSource(event as { reason?: unknown; source?: { name?: unknown; sourceReference?: unknown }; path?: unknown })
  } else if (event.event === 'breakpoint') {
    applyDapBreakpoint(event as { verified?: unknown; line?: unknown; path?: unknown; id?: unknown })
  } else if (event.event === 'thread') {
    applyDapThread(event as { reason?: unknown; threadId?: unknown; body?: { reason?: unknown; threadId?: unknown } })
  }
  // Everything else (capability, invalidated, memory, ...) falls through untouched
  // rather than being pushed into state.
}

export async function dapStart(params: DapStartParams): Promise<DapStartResult> {
  const result = await request<DapStartResult>('dap.start', { ...params })
  dapState.running = true; dapState.paused = false; dapState.reason = null; dapState.program = params.program
  // A new session starts from a clean slate: the previous run's exit code, any
  // progress an adapter left open, and the breakpoint ids it handed out before
  // (they are only meaningful inside one session).
  dapState.exitCode = null
  dapProgress.splice(0)
  dapBreakpointIds.clear()
  // The adapter reports which lines it actually bound. A line it moved (an empty line
  // in the source) or has not bound yet is NOT a breakpoint the user removed, so the
  // requested list stays the source of truth and only the `verified` flag is updated —
  // filtering by verifiedLines used to drop the user's breakpoint entirely.
  for (const report of result.breakpoints ?? []) {
    const verified = new Set(report.verifiedLines ?? [])
    const known = dapBreakpoints.get(report.path) ?? []
    if (!known.length) {
      const adopted = (report.verifiedLines ?? []).map(line => ({ line, verified: true }))
      if (adopted.length) dapBreakpoints.set(report.path, adopted)
      continue
    }
    dapBreakpoints.set(report.path, known.map(point => ({ ...point, verified: verified.has(point.line) })))
  }
  return result
}
export async function dapSetBreakpoints(path: string, breakpoints: DapBreakpoint[]): Promise<DapBreakpointsResult> {
  const result = await request<DapBreakpointsResult>('dap.setBreakpoints', { path, breakpoints })
  if (result.deferred) {
    // Session offline: the list is remembered locally and re-applied on start. It is
    // not "verified" by anyone yet, so the flag is cleared rather than invented.
    dapBreakpoints.set(path, breakpoints.map(point => ({ ...point, verified: undefined })))
    return result
  }
  const verified = new Set(result.verifiedLines)
  // Every requested breakpoint is kept (conditions included) and only its verdict is
  // recorded, so a restart re-sends exactly what the user asked for.
  dapBreakpoints.set(path, breakpoints.map(point => ({ ...point, verified: verified.has(point.line) })))
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
// IDEA's "Disconnect" (as opposed to Stop): ask the adapter to detach and then drop
// the session, which is what `dap.disconnect` already does natively.
export const dapDisconnect = () => request<DapOk>('dap.disconnect')
// IDEA's breakpoint view reads the adapter's own remembered list; loading it keeps the
// gutter in step with a session that was started outside this panel.
export async function dapLoadBreakpoints(): Promise<Record<string, DapBreakpoint[]>> {
  const map = await request<Record<string, DapBreakpoint[]>>('dap.breakpoints')
  for (const [path, list] of Object.entries(map ?? {})) {
    if (!Array.isArray(list) || !list.length) continue
    const verified = new Set(list.filter(point => point.verified !== false).map(point => point.line))
    const known = dapBreakpoints.get(path) ?? []
    if (!known.length) { dapBreakpoints.set(path, list.map(point => ({ ...point, verified: true }))); continue }
    dapBreakpoints.set(path, known.map(point => ({ ...point, verified: verified.has(point.line) })))
  }
  return map ?? {}
}
export async function dapTerminate() {
  dapState.running = false; dapState.paused = false; dapState.reason = null; dapState.currentLocation = null
  // Stopping by hand leaves whatever the adapter was reporting in flight; it is no
  // longer true once the session is gone, and the breakpoint ids die with it.
  dapProgress.splice(0)
  dapBreakpointIds.clear()
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
// A shell that exits on its own used to keep its slot forever, so after 64 dead
// sessions the terminal could not be created at all. `term.exit` releases the slot.
const termExitListeners = new Map<number, Set<(code: number) => void>>()
export function subscribeTermExit(id: number, onExit: (code: number) => void): () => void {
  const listeners = termExitListeners.get(id) ?? new Set()
  termExitListeners.set(id, listeners)
  listeners.add(onExit)
  return () => {
    listeners.delete(onExit)
    if (!listeners.size) termExitListeners.delete(id)
  }
}
function emitTermExit(id: number, code: number) {
  const listeners = termExitListeners.get(id)
  if (!listeners?.size) return
  for (const listener of listeners) listener(code)
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
  create: (cols: number, rows: number, cwd?: string) => request<TermCreateResult>('term.create', { cols, rows, cwd }),
  resize: (id: number, cols: number, rows: number) => request<{ ok: true }>('term.resize', { id, cols, rows }),
  kill: (id: number) => request<{ ok: true }>('term.kill', { id }),
  // Keystrokes are fire-and-forget (no per-character Trace entry). The unmatched
  // reply is dropped by the message listener because no pending id exists.
  write: (id: number, data: string | Uint8Array) => {
    if (!webview) throw new BridgeError('DESKTOP_REQUIRED', '浏览器预览没有本地终端。')
    const bytes = typeof data === 'string' ? new TextEncoder().encode(data) : data
    webview.postMessage({ id: ++nextId, method: 'term.write', params: { id, dataB64: toBase64(bytes) } })
  },
  list: () => request<TerminalList>('term.list'),
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
  if (method.startsWith('plugin.')) throw new BridgeError('DESKTOP_REQUIRED', '浏览器预览不能读写本机插件目录，请在桌面端使用。')
  if (method === 'file.create' || method === 'file.rename' || method === 'file.delete' || method === 'file.copy' || method === 'file.reveal' || method === 'shell.reveal' || method === 'file.readOnly' || method === 'file.lineSeparators' || method.startsWith('session.'))
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
    case 'projects.forgetMany': {
      const set = new Set(Array.isArray(params?.paths) ? params.paths as string[] : [])
      previewState.recentProjects = previewState.recentProjects.filter(project => !set.has(project.path))
      return structuredClone(previewState)
    }
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
        const text = (value: unknown, limit: number) => typeof value === 'string' && value.length <= limit
        const list = (value: unknown, limit: number, itemLimit: number) =>
          Array.isArray(value) && value.length <= limit && value.every(entry => text(entry, itemLimit))
        // The whole run-configuration shape is stored, not just name+command: dropping
        // program/args/cwd/env/beforeLaunch is what made the editor decorative.
        const malformed = !Array.isArray(configs) || configs.length > 40 || configs.some((config, index) =>
          !config || typeof config.name !== 'string' || !config.name || typeof config.command !== 'string' || !config.command
          || configs.findIndex(other => other.name === config.name) !== index
          || (config.type !== undefined && config.type !== 'shell' && config.type !== 'application' && config.type !== 'debug')
          || (config.program !== undefined && !text(config.program, 1024))
          || (config.cwd !== undefined && !text(config.cwd, 1024))
          || (config.args !== undefined && !list(config.args, 256, 1024))
          || (config.env !== undefined && !list(config.env, 256, 1024))
          || (config.beforeLaunch !== undefined && (!Array.isArray(config.beforeLaunch) || config.beforeLaunch.length > 16
            || config.beforeLaunch.some((step: unknown) => !step || typeof (step as { name?: unknown }).name !== 'string'
              || !(step as { name?: string }).name || typeof (step as { command?: unknown }).command !== 'string'
              || !(step as { command?: string }).command))))
        if (malformed) throw new BridgeError('INVALID_SETTINGS', '运行配置要写成名字唯一、命令非空的 {name, command, type?, program?, args?, cwd?, env?, beforeLaunch?}，最多 40 个。')
        next.runConfigs = configs.map(config => ({
          name: config.name,
          command: config.command,
          ...(config.type ? { type: config.type } : {}),
          ...(config.program ? { program: config.program } : {}),
          ...(config.args ? { args: [...config.args] } : {}),
          ...(config.cwd ? { cwd: config.cwd } : {}),
          ...(config.env ? { env: [...config.env] } : {}),
          ...(config.beforeLaunch ? { beforeLaunch: config.beforeLaunch.map(step => ({ ...step })) } : {}),
        }))
      }
      previewProjectSettings = next
      return { settings: structuredClone(previewProjectSettings), entries: previewEntries('') }
    }
    case 'settings.update': {
      const patch = params.settings as Record<string, unknown>
      if (!patch || typeof patch !== 'object') throw new BridgeError('INVALID_SETTINGS', '设置必须是对象')
      for (const [key, value] of Object.entries(patch)) {
        const accepted = key === 'fontSize' || key === 'tabSize' || key === 'wordWrap' ||
          key === 'lineNumbers' || key === 'restoreLastProject' || key === 'syncOnFocus' ||
          key === 'autoSave' || key === 'showIndentGuides' || key === 'bracketMatching' || key === 'tabLimit' ||
          key === 'useTabCharacter' || key === 'showWhitespaces' || key === 'formatOnSave' ||
          key === 'uiZoomPercent' || key === 'compactMode' || key === 'fullPathsInWindowHeader' ||
          key === 'showTreeIndentGuides' || key === 'compactTreeIndents' ||
          key === 'smoothScrolling' || key === 'showIconsInMenus' ||
          key === 'rememberSizeForEachToolWindow' || key === 'showToolWindowNames' || key === 'showToolWindowBars' ||
          key === 'leftSideBySide' || key === 'wideScreenSupport' || key === 'rightSideBySide' ||
          key === 'showToolWindowNumbers' ||
          key === 'keepPopupsForToggles' || key === 'dndWithPressedAltOnly' || key === 'powerSaveMode' ||
          key === 'useContrastScrollbars' || key === 'colorBlindness' || key === 'uiFontFamily' || key === 'uiFontSize' ||
          key === 'backgroundImagePath' || key === 'backgroundImageOpacity' || key === 'backgroundImageFill' ||
          key === 'backgroundImageKeepRatio' || key === 'presentationMode' || key === 'presentationModeFontSize' ||
          key === 'mainMenuDisplayMode' || key === 'supportScreenReaders' ||
          key === 'deleteToTrash'
        if (!accepted) throw new BridgeError('INVALID_SETTINGS', `无效设置：${key}`)
        if (key === 'fontSize' ? !Number.isInteger(value) || Number(value) < 10 || Number(value) > 32
          : key === 'tabSize' ? ![2, 4, 8].includes(Number(value)) || typeof value !== 'number'
          : key === 'tabLimit' ? !Number.isInteger(value) || Number(value) < 1 || Number(value) > 100
          : key === 'uiZoomPercent' ? !Number.isInteger(value) || Number(value) < 50 || Number(value) > 400
          : key === 'uiFontSize' ? !Number.isInteger(value) || Number(value) < 9 || Number(value) > 24
          : key === 'backgroundImageOpacity' ? !Number.isInteger(value) || Number(value) < 0 || Number(value) > 100
          : key === 'presentationModeFontSize' ? !Number.isInteger(value) || Number(value) < 12 || Number(value) > 72
          : key === 'backgroundImagePath' ? typeof value !== 'string' || value.length > 512
          : key === 'backgroundImageFill' ? !['scale', 'tile', 'center'].includes(String(value))
          : key === 'mainMenuDisplayMode' ? !['hamburger', 'merged', 'separate'].includes(String(value))
          : key === 'uiFontFamily' ? typeof value !== 'string' || value.length > 120
          : key === 'colorBlindness' ? !['none', 'deuteranopia', 'protanopia', 'tritanopia'].includes(String(value))
          : typeof value !== 'boolean')
          throw new BridgeError('INVALID_SETTINGS', `无效设置：${key}`)
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
