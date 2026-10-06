import { reactive } from 'vue'
import { normalizeFileColor, normalizeFileColors } from './fileColors.ts'
import { normalizeBookmarkLists, normalizeBookmarks, normalizeBookmarksView } from './bookmarkSettings.ts'
import { errorMessage } from './errors.ts'
// base64（桥上的二进制载荷）与 Gradle 同步通道都拆成了独立模块；这里转出给既有调用方。
import { fromBase64, toBase64 } from './base64.ts'
import { handleGradleEvent } from './gradleEvents.ts'
import { handleSearchChunk } from './searchStream.ts'
import { previewSettingsError } from './previewSettings.ts'
import { normalizeRunConfigurations } from './runConfigurationSchema.ts'
import { validateTodoPatterns } from './todoPatterns.ts'
import { handleLspProgressEvent } from './lspProgress.ts'
import { decodeRunChunk, flushRunDecoder, handleRunExit, handleRunOutput, handleRunStarted } from './runInstances.ts'
import { deliverTermOutput, emitTermExit, subscribeTerm, subscribeTermExit, type TermCreateResult } from './terminalEvents.ts'
export { fromBase64, toBase64 } from './base64.ts'
export { GRADLE_OUTPUT_LIMIT, gradleSync } from './gradleEvents.ts'; export { lspProgressInterrupted, lspProgressTasks, runningLspTasks, type LspProgressTask } from './lspProgress.ts'
export { subscribeTerm, subscribeTermExit, type TermCreateResult } from './terminalEvents.ts'
import { EDITOR_LANGUAGES } from './languages.ts'
import { normalizeTrustedPath } from './trustedProjects.ts'
import type { Bookmark } from './bookmarks'
import type { DapExceptionInfo } from './exceptionInfo'
import type { DapBreakpointLocations } from './breakpointLocations'
import type { DapCompletionsResult } from './debugCompletions'
import type { TemplateSettings } from './templates'
// 构建工具组的项目级状态（`build.tools`）与三档自动重载语义都在 src/gradle.ts —— 只有那一份定义。
import type { AutoReloadType, BuildToolsGradleSettings, BuildToolsSettings } from './gradle'
import { DEFAULT_BUILD_TOOLS } from './gradle.ts'
// 桥接的错误类型与「浏览器预览内存桩」各属一个职责域，都已拆出去（2026-10-05 模块化体检）：
//   · src/bridgeError.ts   —— 桥上的错误类型，桥的两侧（宿主 / 预览桩）都要用；
//   · src/bridgePreview.ts —— 浏览器预览的内存示例（不 postMessage，见那里的说明）。
// BridgeError 原样转出，scratchFiles / DebugPanel / TerminalPanel 的 import 路径不变。
import { BridgeError } from './bridgeError.ts'
import { previewRequest } from './bridgePreview.ts'
export { BridgeError } from './bridgeError.ts'

// 异常信息的类型与判定规则属于 `exceptionInfo.ts`（一个文件一个职责域），
// 这里只做转出，调用方不用记两处路径。
export type { DapExceptionDetails, DapExceptionInfo } from './exceptionInfo'
export type { DapBreakpointLocation, DapBreakpointLocations } from './breakpointLocations'
// `semanticTokens` 的回答形状（含压缩数组与 delta）由 `semanticTokens.ts` 定义，
// 解码规则也只有那一份实现 —— 原生层原样透传整数数组，不解码。
export type { LspSemanticTokensResult, SemanticToken, SemanticTokenEdit } from './semanticTokens'
// 行内补全（IDEA 的 `InlineCompletionProvider`）的显示与接受规则在 `inlineCompletion.ts`。
export type { InlineCompletionItem, InlineCompletionResult } from './inlineCompletion'
// 整工程诊断（IDEA 的 Analyze → Inspect Code）的报告形状与合并规则在 `workspaceDiagnostics.ts`：
// 尤其 `unchanged` 报告不能被当成「这个文件现在没有诊断」—— 那会把一整批诊断抹掉。
export type { WorkspaceDiagnosticReport, WorkspaceDiagnosticsResult } from './workspaceDiagnostics'
// 调试表达式补全（DAP `completions`）的落项规则在 `debugCompletions.ts`。
export type { DapCompletionItem, DapCompletionsResult } from './debugCompletions'

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
// RecentProject 与 EditorSettings 的形状在 src/settingsModel.ts（与项目设置同属"设置的形状"）。
// IDEA GeneralSettings.isSupportScreenReaders moved to GeneralSettingsState: the state lives
// in ide.general.xml and AppearanceConfigurable.kt:363-372 is the row that edits it.
// 项目级设置的类型与默认值在 sr./projectSettings.ts（2026-09-27 拆出，见那边的说明）。
export type {
  AppState, BookmarksViewState, EditorSettings, ExportToHtmlSettings, GeneralSettingsState, JavaProjectSettings,
  NamedScopeSetting, ProcessCloseConfirmation, ProjectForm, ProjectSettings, RecentProject, RunConfig, RunStartParams,
  TodoPattern,
} from './settingsModel.ts'
export { defaultEditorSettings, defaultGeneralSettings, defaultJavaProjectSettings, defaultProjectSettings } from './settingsModel.ts'
import {
  defaultEditorSettings, defaultGeneralSettings, defaultJavaProjectSettings,
  defaultProjectSettings,
  // `defaultExportToHtmlSettings` 与 `ExportToHtmlSettings` 随预览桩一起搬去了 bridgePreview.ts。
  type AppState, type BookmarksViewState, type EditorSettings,
  type GeneralSettingsState, type JavaProjectSettings, type NamedScopeSetting, type ProjectForm,
  type ProjectSettings, type RunConfig, type RunStartParams, type RecentProject, type TodoPattern,
} from './settingsModel.ts'
/** `workspace.files` 的结果：整棵项目树的相对路径清单（作用域编辑器用）。 */
export interface ProjectFileList { files: string[]; truncated: boolean }
// TaoCode 能高亮/索引的语言集合（与模板、文件类型关联用的是同一份）。
// 定义在零依赖的 languages.ts 里，这里再导出给既有的引用点。
export { EDITOR_LANGUAGES } from './languages.ts'

/**
 * `EditorSettingsExternalizable.isBreadcrumbsShownFor`（:459-466）：
 * 表里没有这个语言 → 用默认值；TaoCode 没有 `BreadcrumbsProvider.isShownByDefault()` 的分歧，
 * 一律默认显示（源码里未知语言也走到 `defaultVisible == null || defaultVisible` = true）。
 */
export function breadcrumbsShownFor(settings: Pick<EditorSettings, 'breadcrumbsLanguages'>, languageId: string): boolean {
  return settings.breadcrumbsLanguages?.[languageId] ?? true
}

/**
 * 读盘迁移：早期版本把「不显示」编码进 `breadcrumbsPlacement`（top/bottom/**disabled**），
 * 而源码里位置只有上下两个值、是否显示由 `showBreadcrumbs` 单独管。这里把旧值拆回两个键，
 * 免得旧文件里的 `disabled` 在下次保存时被原生校验拒绝。
 */
export function normalizeEditorSettings(settings: EditorSettings): EditorSettings {
  const placement = settings.breadcrumbsPlacement as string
  if (placement !== 'disabled') return settings
  return { ...settings, showBreadcrumbs: false, breadcrumbsPlacement: 'bottom' }
}

export type Method = 'app.state' | 'app.quit' | 'dialog.pickDirectory' | 'workspace.open' | 'workspace.close' | 'workspace.list' | 'workspace.files' | 'file.read' | 'file.write' | 'file.create' | 'file.readOnly' | 'file.lineSeparators' | 'file.rename' | 'file.delete' | 'file.copy' | 'file.reveal' | 'shell.reveal' | 'shell.openUrl' | 'file.readBinary' | 'file.usages' | 'file.librarySource' | 'file.archiveEntries' | 'session.save' | 'session.load' | 'session.clear' | 'project.create' | 'project.clone' | 'project.clone.cancel' | 'projects.forget' | 'projects.forgetMany' | 'settings.update' | 'settings.general.update' | 'project.settings.get' | 'project.settings.update' | 'lsp.open' | 'lsp.change' | 'lsp.close' | 'lsp.request' | 'lsp.stop' | 'lsp.cancelProgress' | 'run.start' | 'run.write' | 'run.stop' | 'run.instances' | 'git.status' | 'git.diff' | 'git.patch' | 'git.stage' | 'git.unstage' | 'git.commit' | 'git.checkout' | 'git.log' | 'git.logFull' | 'git.commitDetails' | 'git.commitChanges' | 'git.commitFileDiff' | 'git.pull' | 'git.fetch' | 'git.push' | 'git.rebase' | 'git.cherryPick' | 'git.stash' | 'git.stash.save' | 'git.stash.pop' | 'git.branch.create' | 'git.branch.delete' | 'git.revert' | 'git.revertCommit' | 'git.reset' | 'git.merge' | 'git.tags' | 'git.tag.create' | 'git.tag.delete' | 'git.ignore' | 'git.user' | 'git.authors' | 'git.aheadBehind' | 'git.blame' | 'git.diffSides' | 'git.diffHunks' | 'git.applyHunks' | 'git.compare' | 'git.fileHistory' | 'git.showCommit' | 'git.worktree.list' | 'git.worktree.add' | 'git.worktree.remove' | 'git.submodules' | 'git.submodule.update' | 'git.cancel' | 'search.run' | 'search.preview' | 'search.replace' | 'search.replaceSelected' | 'search.cancel' | 'dap.start' | 'dap.setBreakpoints' | 'dap.setExceptionBreakpoints' | 'dap.threads' | 'dap.continue' | 'dap.pause' | 'dap.next' | 'dap.stepIn' | 'dap.stepOut' | 'dap.stackTrace' | 'dap.scopes' | 'dap.variables' | 'dap.evaluate' | 'dap.setVariable' | 'dap.setExpression' | 'dap.restart' | 'dap.gotoTargets' | 'dap.goto' | 'dap.restartFrame' | 'dap.exceptionInfo' | 'dap.breakpointLocations' | 'dap.completions' | 'dap.terminate' | 'dap.disconnect' | 'dap.breakpoints' | 'dap.loadedSources' | 'dap.modules' | 'dap.stepBack' | 'dap.reverseContinue' | 'dap.readMemory' | 'dap.disassemble' | 'term.create' | 'term.write' | 'term.resize' | 'term.kill' | 'term.list' | 'history.list' | 'history.content' | 'history.diff' | 'history.diffSides' | 'plugin.list' | 'plugin.setEnabled' | 'plugin.install' | 'plugin.uninstall' | 'app.memory' | 'app.fullScreen' | 'app.setFullScreen' | 'app.info' | 'app.jdks' | 'app.logPaths' | 'app.internalErrors' | 'app.specialPaths' | 'app.collectLogs' | 'app.troubleshooting' | 'dialog.pickImage' | 'app.readImage' | 'gradle.sync' | 'gradle.cancel' | 'gradle.state' | 'app.exportSettings' | 'app.readSettingsArchive' | 'app.importSettings' | 'app.resetSettings' | 'dialog.pickFile' | 'dialog.saveFile' | 'app.writeExportFiles'
export type { GitChange, GitUser, GitStatus, GitDiff, GitCommit, GitLog, GitRef, GitFullCommit, GitFullLog, GitLogQuery, GitLogSort, GitCommitDetails, GitCommitChange, GitCommitComparison, GitCommitChanges, GitCommitFileDiff, GitStashEntry, GitStash, GitAheadBehind, GitHunk, GitHunks, GitTags, GitCompareFile, GitCompare, GitBlameLine, GitBlame } from './vcsLogTypes'
import type { GitCommit } from './vcsLogTypes'
// One aligned row of the side-by-side viewer. Marks are [start, length] byte ranges
// into that side's own text, so a change highlights only the words that differ.
export interface DiffCell { no: number; text: string }
export interface DiffRow { kind: 'equal' | 'insert' | 'delete' | 'change'; left?: DiffCell; right?: DiffCell; leftMarks?: [number, number][]; rightMarks?: [number, number][] }
export interface DiffSides { rows: DiffRow[]; truncated: boolean }
// `code`/`tags` 由 `native/lsp_support.cpp:148-149` 原样透传（上游靠 `tags` 判 Unnecessary/Deprecated 两档外观，`LspDiagnosticsCustomizer.kt:93-96`）。`code` 两种形状都合法，消费侧用 `String(code)` 归一。
export interface LspDiagnostic { line: number; character: number; endLine?: number; endCharacter?: number; severity: number; message: string; source?: string; code?: string | number; tags?: number[] }
// LSP `textDocument/diagnostic`（pull 模型）：`kind='full'` 带 items（与推送同一套形状），
// `kind='unchanged'` 表示可以沿用上一次的结果；`supported=false` 说明服务器只有推送。
export interface LspDiagnosticReport { available: boolean; supported: boolean; kind?: 'full' | 'unchanged'; resultId?: string; items?: LspDiagnostic[] }
// `configured` distinguishes 'no server is set up for this language' from 'the
// server is still starting' — the status bar only reports the latter as indexing.
export interface LspOpenResult { running: boolean; language: string; configured?: boolean }
export interface LspLocation { path: string; line: number; character: number }
export interface LspHoverResult { available: boolean; contents?: string }
export interface LspDefinitionResult { available: boolean; locations?: LspLocation[] }
export interface LspCompletionItem { label: string; kind: string; detail?: string; apply?: string; documentation?: string; raw?: unknown }
export interface LspCompletionResult { available: boolean; items?: LspCompletionItem[] }
// LSP `completionItem/resolve`：把服务器给的原始项发回去，换回文档与"接受时要一并做的编辑"。
export interface LspCompletionItemResolveResult { available: boolean; supported: boolean; detail?: string; documentation?: string; apply?: string; additionalTextEdits?: LspTextEdit[] }
export interface LspTextEdit { text: string; startLine: number; startChar: number; endLine: number; endChar: number }
export interface LspFileEdits { path: string; textEdits: LspTextEdit[] }
export interface LspRenameResult { available: boolean; edits?: LspFileEdits[] }
// LSP `textDocument/prepareRename`（重命名前预校验）。`supported=false` 表示服务器没声明
// `renameProvider.prepareProvider`，此时前端跳过预校验；`supported=true && available=false`
// 表示"这个位置不能重命名"。
// LSP `textDocument/foldingRange`（IDEA 的 FoldingBuilder）：0 基行号；三列式区间额外带列号与 kind。
export interface LspFoldingRange { startLine: number; endLine: number; startChar?: number; endChar?: number; kind?: string }
export interface LspFoldingRangeResult { available: boolean; ranges?: LspFoldingRange[] }
export interface LspPrepareRenameResult { available: boolean; supported: boolean; startLine?: number; startChar?: number; endLine?: number; endChar?: number; placeholder?: string }
export interface LspReferencesResult { available: boolean; refs?: LspLocation[] }
export interface LspDocumentSymbol { name: string; kind: number; detail: string; startLine: number; startChar: number; endLine: number; endChar: number }
export interface LspWorkspaceSymbol { name: string; kind: number; path: string; line: number; character: number }
export interface LspSymbolsResult { available: boolean; symbols?: Array<{ name: string; kind: number } & Partial<LspDocumentSymbol> & Partial<LspWorkspaceSymbol>> }
export interface LspSignature { label: string; documentation?: string; parameters: Array<{ label: string }> }
export interface LspSignatureHelpResult { available: boolean; signatures?: LspSignature[]; activeSignature?: number; activeParameter?: number }
// `command` means the server attached a Command to this action, so it must be run
// through workspace/executeCommand (IDEA: QuickFixAction -> CommandProcessor).
// `resolvable` means codeAction/resolve may still fill it in. An LSP action can have
// both an edit AND a command, in which case the edit is applied first.
export interface LspCodeAction { title: string; index: number; kind?: string; preferred?: boolean; linkedDiagnostics?: boolean; edits: LspFileEdits[]; resolvable?: boolean; command?: boolean }
export interface LspCodeActionResults { available: boolean; actions?: LspCodeAction[] }
export interface LspFormatResult { available: boolean; edits?: LspFileEdits[]; command?: boolean }
// workspace/executeCommand's reply: `executed` is the whole contract (the protocol
// result is otherwise null); `value` is whatever the server returned, kept for callers
// that want it.
export interface LspExecuteCommandResult { available: boolean; executed?: boolean; value?: unknown }
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
// `command` / `tooltip` are LSP `InlayHint.command` / `InlayHint.tooltip`; the host only forwards
// them after validating the command name and unwrapping MarkupContent tooltips
// (`native/lsp_session_kinds.cpp`, inlayHint branch). Consumers: `src/inlayHints.ts`
// (`inlayHintCommand` / `inlayHintTooltip`) via `src/editorInlayHints.ts`.
export interface LspInlayHint { line: number; character: number; label: string; paddingLeft?: boolean; paddingRight?: boolean; kind?: number; command?: { command: string; arguments?: unknown[] }; tooltip?: string }
export interface LspInlayHintResult { available: boolean; hints?: LspInlayHint[] }
export type LspRequestKind = 'hover' | 'definition' | 'completion' | 'completionItemResolve' | 'diagnostic' | 'workspaceDiagnostic' | 'rename' | 'prepareRename' | 'foldingRange' | 'references' | 'documentSymbol' | 'workspaceSymbol' | 'signatureHelp' | 'codeAction' | 'codeActionResolve' | 'executeCommand' | 'willRenameFiles' | 'formatting' | 'rangeFormatting' | 'implementation' | 'typeDefinition' | 'documentHighlight' | 'selectionRange' | 'inlayHint' | 'semanticTokens' | 'inlineCompletion' | 'prepareCallHierarchy' | 'callHierarchyIncoming' | 'callHierarchyOutgoing' | 'prepareTypeHierarchy' | 'typeHierarchySupertypes' | 'typeHierarchySubtypes'
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
// 插件清单的类型连同它的规则一起放在 src/pluginGroups.ts（分组/类目/搜索语法都在那儿），
// 这里只转出 —— 既有的 `import type { PluginInfo } from './bridge'` 一个都不用改。
export type { PluginCommand, PluginTemplate, PluginInfo, PluginList } from './pluginGroups.ts'
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
  // search.chunk：这一次分块属于哪一次搜索（前端给的 streamId）。
  streamId?: number
  // gradle.started 带回同步用的命令行；gradle.exit 带回"是被取消的吗"。
  command?: string; cancelled?: boolean
  language?: string; token?: string; kind?: string; title?: string; percentage?: number; cancellable?: boolean  // lsp.progress：`$/progress` 的一条报告（整形见 native/lsp_host_bootstrap.cpp）
  // run.* 都带**实例 id**（多实例运行：IDEA 的 Run 工具窗口按实例开标签）。
  instance?: number; label?: string
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
// 运行/构建的**多实例**状态（输出、聚合运行状态、实例清单）在 src/runInstances.ts ——
// 下面这几行是转出，既有 import 路径一行都不用改（见那边的说明）。
export {
  RUN_OUTPUT_LIMIT, activeRunInstance, runOutput, runInstances, runState,
  beginRun, endRun, runInstanceList, focusRunInstance,
} from './runInstances.ts'
// IDE-03 file watching: the native watcher's debounced batches. `version` bumps on
// every batch so a single watcher can refresh whatever the UI needs; `paths` is
// workspace-relative ('/'-joined), empty meaning "everything changed (overflow)".
export const fsChanges = reactive<{ version: number; paths: string[] }>({ version: 0, paths: [] })
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

/**
 * The single entry point for host (native layer) messages. It lives in a named
 * function rather than inline in the listener so the browser tests can feed it
 * events directly — `window.chrome.webview` is undefined in preview, so an inline
 * listener body would be untestable. Returns `true` when an event branch consumed
 * the message (a reply for a pending request counts as consumed too).
 */
export function handleHostEvent(data: Reply | undefined): boolean {
  // 没有消息体就等于没被消费（原来靠 `data?.event === …` 逐个短路，现在统一前置一次）。
  if (!data) return false
  // One switch on the event name. Every arm either consumes the message (`return true`)
  // or explicitly declines it (`return false`) — the difference matters to callers, so
  // it is stated in every case instead of being implied by falling off the chain.
  switch (data.event) {
    case 'fs.changed':
      if (!Array.isArray(data.paths)) return false
      fsChanges.paths = data.paths
      fsChanges.version++
      return true
    case 'lsp.diagnostics':
      if (typeof data.path !== 'string') return false
      // pull 与 push 不能同时喂同一个文件（LSP 规范：客户端用 pull 时就不该再收 push）。
      // 一旦某个文件走了 pull，它的推送事件在这里被忽略 —— 否则两边会来回覆盖。
      applyPushedDiagnostics(data.path, data.diagnostics)
      return true
    // 运行的三种事件都按 `instance` 归属到具体实例（IDEA 的 Run 工具窗口按实例开标签）。
    // 状态与缓冲在 src/runInstances.ts。
    case 'run.started':
      return handleRunStarted(data)
    case 'run.output': {
      // Bytes, not text: a chunk boundary can fall inside a multi-byte character, so decoding is streamed.
      // 解码**按实例**分（上游一条 descriptor 一个 ConsoleView：RunContentManagerImpl.kt:308-312）——
      // 交错输出时不带 id 会把甲的残段拼到乙的下一块前面（内容跑错标签 + 乱码）。
      const text = typeof data.dataB64 === 'string' ? decodeRunChunk(data.dataB64, typeof data.instance === 'number' ? data.instance : undefined)
        : typeof data.chunk === 'string' ? data.chunk : null
      if (text === null) return false
      if (text) handleRunOutput(data.instance, text)
      return true
    }
    case 'run.exit': {
      if (typeof data.code !== 'number') return false
      // A chained run ("Before launch" steps) emits one exit per step; the console
      // stays in the running state until the last step has reported.
      const tail = flushRunDecoder(typeof data.instance === 'number' ? data.instance : undefined)
      if (tail) handleRunOutput(data.instance, tail)
      return handleRunExit(data)
    }
    case 'term.exit':
      if (typeof data.id !== 'number') return false
      emitTermExit(data.id, typeof data.code === 'number' ? data.code : 0)
      return true
    case 'dap.event':
      if (!data.payload) return false
      applyDapEvent(data.payload)
      return true
    // Gradle 同步的三个事件（宿主 native/gradle.cpp 的 SyncSession 推出来）。
    // 状态与解码在 src/gradleEvents.ts；与 run.* 分开：同步不占运行控制台。
    case 'gradle.started':
    case 'gradle.output':
    case 'gradle.exit':
      return handleGradleEvent(data.event, data)
    // 工程内查找的分块（宿主 native/search.cpp 的 preview() 边走边推）：累积逻辑在 src/searchStream.ts。
    case 'search.chunk':
      return handleSearchChunk(data)
    // 终端输出：订阅表与"订阅前的缓冲"都在 src/terminalEvents.ts。
    case 'term.output':
      return deliverTermOutput(data.id, data.dataB64)
    // `$/progress` 的三支语义与"停机就整条收掉"都在 src/lspProgress.ts
    // （上游 LspServerNotificationsHandlerImpl.kt:257-339）。
    case 'lsp.progress': case 'lsp.progressReset': case 'lsp.message':
      return handleLspProgressEvent(data.event, data)
    case 'lsp.edited':
      if (typeof data.path !== 'string') return false
      lspEdited.path = data.path
      lspEdited.version++
      return true
    case 'term.opened':
      if (typeof data.id !== 'number') return false
      termOpened.id = data.id
      termOpened.cwd = typeof data.cwd === 'string' ? data.cwd : ''
      termOpened.version++
      return true
    case 'fs.watchStopped':
      watchStopped.reason = typeof data.reason === 'string' ? data.reason : ''
      watchStopped.restarting = data.restarting === true
      watchStopped.attempt = typeof data.attempt === 'number' ? data.attempt : 0
      watchStopped.version++
      return true
    case 'history.note': {
      // A local-history snapshot failed for one save: non-blocking, but the restore
      // timeline now has a gap the user should know about.
      const path = typeof data.path === 'string' ? data.path : ''
      const message = typeof data.message === 'string' ? data.message : ''
      historyNotes.push({ path, message, at: new Date().toLocaleTimeString('zh-CN', { hour12: false }) })
      if (historyNotes.length > 50) historyNotes.shift()
      return true
    }
    case 'git.progress':''
      gitProgress.running = data.running === true
      gitProgress.queued = typeof data.queued === 'number' && data.queued > 0 ? Math.floor(data.queued) : 0
      return true
    case 'clone.progress':
      if (typeof data.id !== 'number' || typeof data.message !== 'string' || !pending.has(data.id)) return false
      cloneProgress.push(data.message.slice(0, 4096))
      if (cloneProgress.length > 200) cloneProgress.shift()
      return true
    default: {
      // 不是事件 → 只可能是某个待处理请求的回包（id + ok/result）。
      if (typeof data.id !== 'number' || typeof data.ok !== 'boolean') return false
      const request = pending.get(data.id)
      if (!request) return false
      pending.delete(data.id)
      request.resolve(data)
      return true
    }
  }
}

webview?.addEventListener('message', ({ data }) => { handleHostEvent(data) })

export function setNativeDirty(dirty: boolean) {
  webview?.postMessage({ type: 'documentState', dirty })
}

export function setNativeTheme(theme: 'light' | 'dark') {
    webview?.postMessage({ type: 'appearance', theme })
}

// 走 pull 诊断的文件（服务器声明了 `diagnosticProvider` 之后由客户端主动拉取）。
// 这是 `textDocument/diagnostic` 与 `textDocument/publishDiagnostics` 的互斥开关：
// LSP 规范里客户端一旦对某文件采用 pull，就不该再接收它的 push，否则两条通道会互相覆盖。
const pullManagedFiles = new Set<string>()

/** 写入一份**拉取**到的诊断，并把该文件标记为 pull 管理（此后忽略它的推送事件）。 */
export function setPullDiagnostics(path: string, list: LspDiagnostic[]) {
  pullManagedFiles.add(path)
  lspDiagnostics.set(path, list)
}

/** 该文件的诊断是否由 pull 管理（测试与调试用）。 */
export function isPullDiagnostics(path: string) { return pullManagedFiles.has(path) }

/**
 * 收到一条 `textDocument/publishDiagnostics` 推送。走 pull 的文件在这里被丢弃 ——
 * 返回 `false` 表示这次推送被忽略（测试可断言）。空数组也是一次有效的推送
 * （表示「这个文件现在没有问题了」），所以只有 pull 标记会让它短路。
 */
export function applyPushedDiagnostics(path: string, list: unknown): boolean {
  if (pullManagedFiles.has(path)) return false
  lspDiagnostics.set(path, Array.isArray(list) ? list as LspDiagnostic[] : [])
  return true
}

/**
 * 放弃该文件的 pull 标记，让推送重新接管。服务器重启（或能力集变化）后如果不再
 * 声明 `diagnosticProvider`，pull 通道就没了，标记必须一起清掉，否则这个文件会永远
 * 收不到任何诊断。
 */
export function clearPullDiagnostics(path: string) {
  pullManagedFiles.delete(path)
}

export function setLspDiagnostics(path: string, list: LspDiagnostic[]) {
  lspDiagnostics.set(path, list)
}

export function clearLspDiagnostics(path: string) {
  lspDiagnostics.delete(path)
  // 诊断被清空时 pull 标记也一并丢弃：下一次推送应当能重新写进这张表。
  pullManagedFiles.delete(path)
}


export const dapState = reactive<{ running: boolean; paused: boolean; threadId: number; reason: string | null; program: string | null; currentLocation: { path: string; line: number } | null; exitCode: number | null }>(
  { running: false, paused: false, threadId: 1, reason: null, program: null, currentLocation: null, exitCode: null })
export const dapConsole = reactive<Array<{ category: string; text: string }>>([])
export const dapBreakpoints = reactive(new Map<string, DapBreakpoint[]>())  // rel path -> breakpoints
// The three lists below are what the adapter's `progress` / `module` / `loadedSource`
// events build up. They are separate from `dapState` because they are collections
// the panel renders as rows, not fields of the session.
export interface DapProgress { id: string; requestId: string | null; title: string; message: string; percentage: number | null }
export interface DapModule { id: string; name: string; type?: string; sourceReference?: number; path?: string; version?: string; symbolStatus?: string; addressRange?: string; isOptimized?: boolean; isUserCode?: boolean; symbolFilePath?: string; dateTimeStamp?: string }
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
  // One switch on the event name: the shapes are a closed set, and a switch makes
  // an unhandled event obvious (it lands in the default instead of silently
  // falling off the end of an if/else chain).
  switch (event.event) {
    case 'stopped': {
      dapState.paused = true
      const thread = (event as { threadId?: number }).threadId
      if (thread) { dapState.threadId = thread; dapThreadId = thread }
      const reason = (event as { reason?: string }).reason ?? 'stopped'
      const text = (event as { text?: string }).text
      dapState.reason = text ? `${reason}: ${text}` : reason
      return
    }
    case 'continued':
      dapState.paused = false; dapState.reason = null; dapState.currentLocation = null
      return
    case 'output': {
      const output = event as { category?: string; text?: string }
      dapConsole.push({ category: output.category ?? 'console', text: output.text ?? '' })
      if (dapConsole.length > 4000) dapConsole.splice(0, dapConsole.length - 2000)
      return
    }
    case 'terminated': {
      dapState.running = false; dapState.paused = false; dapState.reason = null; dapState.currentLocation = null
      // 会话结束，能力位跟着作废：新入口的门控不能停留在上一个适配器的声明上。
      dapRememberCapabilities(undefined)
      const closed = (event as { connectionClosed?: boolean }).connectionClosed
      if (!closed) { dapConsole.push({ category: 'console', text: '调试会话已结束。' }); }
      return
    }
    case 'exited': {
      // The program ended on its own. This deliberately does not touch `running`:
      // adapters send `terminated` next, and that is the event that ends the
      // session. What is recorded here is the code the UI has to show.
      const raw = (event as { exitCode?: unknown }).exitCode
      dapState.exitCode = typeof raw === 'number' && Number.isFinite(raw) ? Math.trunc(raw) : 0
      dapConsole.push({
        category: dapState.exitCode === 0 ? 'telemetry' : 'stderr',
        text: dapState.exitCode === 0 ? '程序已退出，退出码 0。' : `程序已退出，退出码 ${dapState.exitCode}。`,
      })
      return
    }
    case 'progress':
      applyDapProgress(event as { phase?: unknown; progressId?: unknown; requestId?: unknown; title?: unknown; message?: unknown; percentage?: unknown })
      return
    case 'module':
      applyDapModule(event as { reason?: unknown; module?: { id?: unknown; name?: unknown; type?: unknown; sourceReference?: unknown }; path?: unknown })
      return
    case 'loadedSource':
      applyDapLoadedSource(event as { reason?: unknown; source?: { name?: unknown; sourceReference?: unknown }; path?: unknown })
      return
    case 'breakpoint':
      applyDapBreakpoint(event as { verified?: unknown; line?: unknown; path?: unknown; id?: unknown })
      return
    case 'thread':
      applyDapThread(event as { reason?: unknown; threadId?: unknown; body?: { reason?: unknown; threadId?: unknown } })
      return
    default:
      // Everything else (capability, invalidated, memory, ...) falls through
      // untouched rather than being pushed into state.
      return
  }
}

export async function dapStart(params: DapStartParams): Promise<DapStartResult> {
  const result = await request<DapStartResult>('dap.start', { ...params })
  dapRememberCapabilities(result.capabilities)
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
export function dapSelectThread(threadId: number) { if (Number.isInteger(threadId) && threadId > 0) { dapThreadId = threadId; dapState.threadId = threadId } }
export const dapStackTrace = (threadId = dapCurrentThread()) => request<{ frames: DapFrame[]; totalFrames: number }>('dap.stackTrace', { threadId })
export const dapThreads = () => request<{ threads: DapThread[] }>('dap.threads')
export const dapSetExceptionBreakpoints = (filters: string[]) => request<DapOk>('dap.setExceptionBreakpoints', { filters })
export const dapScopes = (frameId: number) => request<{ scopes: DapScope[] }>('dap.scopes', { frameId })
export const dapVariables = (reference: number) => request<{ variables: DapVariable[] }>('dap.variables', { reference })
// DAP `setVariable` / `setExpression`（IDEA `XValue.setValue` 与 Watches 的「Set Value…」）：
// 响应是同一条变量的新值（规范里没有 variables 数组），字段与 DapVariable 一致。
export const dapSetVariable = (reference: number, name: string, value: string) =>
  request<DapVariable>('dap.setVariable', { reference, name, value })
export const dapSetExpression = (expression: string, value: string, frameId = 0) =>
  request<DapVariable>('dap.setExpression', { expression, value, frameId })
// `evaluate` (IDEA's Evaluate Expression / hover inspect). The body comes back from
// the adapter untouched, so `type` and `variablesReference` are adapter-specific.
export interface DapEvaluateResult { result: string; type?: string; variablesReference?: number }
export const dapEvaluate = (expression: string, context: 'hover' | 'watch' | 'repl', frameId: number) =>
  request<DapEvaluateResult>('dap.evaluate', { expression, context, frameId })
// IDEA's "Disconnect" (as opposed to Stop): ask the adapter to detach and then drop
// the session, which is what `dap.disconnect` already does natively.
// `terminate` = 是否连被调试进程一起结束：true 是 IDEA 的「停止」，false 是「断开但保留进程」
// （远程附加常用）。原生侧对应 DAP `disconnect {terminateDebuggee}`。
export const dapDisconnect = (terminate = true) => request<DapOk>('dap.disconnect', { terminate })
// DAP `restart`（IDEA 的「重新运行」）：适配器没声明 supportsRestartRequest 时会以
// DAP_UNSUPPORTED 失败，调用方据此退化成「停止 + 重新启动」。
export const dapRestart = (args: Record<string, unknown> = {}) => request<DapOk>('dap.restart', { arguments: args })
// DAP `gotoTargets` + `goto`（IDEA 的 Run to Cursor，Alt+F9）：先问这一行能停在哪儿，再跳过去。
// `line` 是 **1 基**（DAP 的行号是 1 基；编辑器里是 0 基，调用方要 +1）。
export const dapGotoTargets = (path: string, line: number, column = 0) =>
  request<{ targets: Array<{ id: number; line: number; label: string; column?: number }> }>('dap.gotoTargets', { path, line, column })
export const dapGoto = (threadId: number, targetId: number) => request<DapOk>('dap.goto', { threadId, targetId })
// DAP `restartFrame`（IDEA Frames 视图的「丢弃帧」）：回滚到该帧重新执行。
export const dapRestartFrame = (frameId: number) => request<DapOk>('dap.restartFrame', { frameId })
// DAP `exceptionInfo`（IDEA 的 `JavaStackFrame.createExceptionNodes`）：异常断点命中时问适配器
// 「停在什么异常上」。规范**没有**对应的能力位，所以不做能力门控 —— 由调用方在 `stopped` 的
// `reason` 是 `exception` 时发。类型与「只在最顶层帧显示」的规则在 `src/exceptionInfo.ts`。
export const dapExceptionInfo = (threadId: number) => request<DapExceptionInfo>('dap.exceptionInfo', { threadId })
// DAP `completions`（调试表达式补全）。`column` 按规范是 **1 基**，缺省是"光标在末尾"。
// 适配器没声明 `supportsCompletionsRequest` 时回 DAP_UNSUPPORTED —— 调用方据此静默不给提示，
// 而不是把"没有候选"当成结论。
// IDEA 的 ToggleFullScreen（View → Appearance → ToggleFullScreenGroup）：
// 宿主侧实现在 `native/window_state.cpp`（去装饰 + 铺满 rcMonitor，退出时恢复原样式与位置）。
export const appFullScreen = () => request<{ fullScreen: boolean }>('app.fullScreen')
export const appSetFullScreen = (fullScreen: boolean) =>
  request<{ fullScreen: boolean; changed: boolean }>('app.setFullScreen', { fullScreen })

export const dapCompletions = (text: string, column: number, frameId = 0, line = 0) =>
  request<DapCompletionsResult>('dap.completions', { text, column: column + 1, frameId, line })
// DAP `breakpointLocations`（IDEA 的 `XLineBreakpointType.canPutAt`）：问适配器「这一行的
// 哪些位置可以放断点」。`endLine`/`column`/`endColumn` 按规范可选，不传就不发那个键。
// 适配器没声明 `supportsBreakpointLocationsRequest` 时会回 DAP_UNSUPPORTED —— 调用方据此
// 跳过校验，而不是把「不能放断点」当成结论。
export const dapBreakpointLocations = (path: string, line: number,
  span?: { endLine?: number; column?: number; endColumn?: number }) =>
  request<DapBreakpointLocations>('dap.breakpointLocations', { path, line, ...span })
// DAP `loadedSources` / `modules` 的**按需重取**：`dapLoadedSources` / `dapModules` 是事件
// （loadedSource/module）喂起来的累计列表，这两个请求拉整份清单把它重同步 —— 规范里那两种事件
// 没有 list 语义，UI 想重取只能再问一次。两个能力位默认 false，没声明回 DAP_UNSUPPORTED。
export interface DapLoadedSourceItem { name?: string; path?: string; sourceReference?: number; origin?: string; presentationHint?: string }
export interface DapModuleItem { id: string | number; name: string; path?: string; type?: string; version?: string; symbolStatus?: string; addressRange?: string; isOptimized?: boolean; isUserCode?: boolean; symbolFilePath?: string; dateTimeStamp?: string }
export const dapLoadedSourcesRequest = () =>
  request<{ available: boolean; sources: DapLoadedSourceItem[] }>('dap.loadedSources')
export const dapModulesRequest = (startModule = 0, moduleCount = 0) =>
  request<{ available: boolean; modules: DapModuleItem[]; totalModules?: number }>('dap.modules', { startModule, moduleCount })
// DAP `stepBack` / `reverseContinue`（反向调试）：共用 `supportsStepBack`（默认 false）。
export const dapStepBack = (threadId = dapCurrentThread()) => request<DapOk>('dap.stepBack', { threadId })
export const dapReverseContinue = (threadId = dapCurrentThread()) => request<DapOk>('dap.reverseContinue', { threadId })
// DAP `readMemory` / `disassemble`（内存与反汇编视图）：能力位默认 false。
// `readMemory` 的字节过桥是 base64（`dataB64`）；十六进制/ASCII 的渲染在 src/debugSources.ts。
export interface DapReadMemoryResult { available: boolean; address?: string; dataB64?: string; offset?: number; unreadableBytes?: number }
export const dapReadMemory = (memoryReference: string, count: number, offset = 0) =>
  request<DapReadMemoryResult>('dap.readMemory', { memoryReference, count, offset })
export interface DapInstruction { address: string; instruction: string; instructionBytes?: string; symbol?: string; path?: string; line?: number; column?: number; endLine?: number; endColumn?: number }
export interface DapDisassembleResult { available: boolean; instructions: DapInstruction[]; offset?: number; unreadableBytes?: number }
export const dapDisassemble = (memoryReference: string, instructionCount: number,
  options: { offset?: number; instructionOffset?: number; resolveSymbols?: boolean } = {}) =>
  request<DapDisassembleResult>('dap.disassemble', { memoryReference, instructionCount, ...options })
// 适配器在 initialize 响应里声明的能力（原样转发）。新增入口全部由能力位门控 ——
// 规范里 supportsStepBack / supportsReadMemoryRequest / supportsDisassembleRequest /
// supportsLoadedSourcesRequest / supportsModulesRequest 都**默认 false**，面板据此不渲染入口。
export const dapCapabilities = reactive<Record<string, unknown>>({})
export const dapCapability = (name: string) => dapCapabilities[name] === true
export function dapRememberCapabilities(capabilities: Record<string, unknown> | undefined) {
  for (const key of Object.keys(dapCapabilities)) delete dapCapabilities[key]
  Object.assign(dapCapabilities, capabilities ?? {})
}
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