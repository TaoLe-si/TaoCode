<script setup lang="ts">
import { nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { basicSetup } from 'codemirror'
import { Compartment, EditorSelection, EditorState, Prec, StateEffect, type Extension, type Text } from '@codemirror/state'
import { EditorView, hoverTooltip, keymap, rectangularSelection, ViewPlugin, type Command } from '@codemirror/view'
import { foldEffect, foldService, foldedRanges, indentUnit, syntaxHighlighting, unfoldEffect } from '@codemirror/language'
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
import { insertedText, smartQuotes } from '../editorTyping'
import { copyToClipboard } from '../clipboard'
import { insertTextAtCaret, pasteChannel, replaceInsertedRange, type PasteEvent } from '../editorPaste'
import { NO_ERRORS_IN_FILE, navigateToError } from '../gotoNextError'
import { clearPullDiagnostics, setPullDiagnostics } from '../bridge'
import { createLspCompletion } from '../lspCompletion'
import { completionUi } from '../completionUi'
import { mergeCompletionResults } from '../completionMerge'
import TargetChooserPopup from './TargetChooserPopup.vue'
import QuickDefinitionPopup from './QuickDefinitionPopup.vue'; import { createQuickDefinitionHost } from '../quickDefinitionHost.ts'; import { type ChooseTargetRow, type TargetLocation } from '../chooseTarget'; import { createChooseTargetHost } from '../chooseTargetHost'
import { createDeclarationNavigation } from '../declarationNavigation'
import { candidates as templateCandidates, expand as expandTemplateAt, defaultTemplateSettings, type PluginTemplateSource, type TemplateSettings } from '../templates'
import { wrapSelection, type SurroundTemplate } from '../surround'
import { applySemanticTokenEdits, decodeSemanticTokens } from '../semanticTokens'
// 语义着色的 decoration 层拆在 src/editorSemanticField.ts（拉取/增量/重试留在这里，与 warmup 生命周期绑一起）。
import { semanticTokensField, setSemanticTokens } from '../editorSemanticField'
// 缩进参考线 / 同符号高亮 / inlay hints 三层的状态机已拆成独立模块（本文件贴着机检上限）。
import { indentGuidesExtension, setIndentGuides } from '../editorIndentGuides'
import { createSymbolHighlight } from '../editorSymbolHighlight'
import { createAnnotatorHighlightLayer } from '../annotatorHighlightLayer'
import { createInlayHints } from '../editorInlayHints'
import { inlayHintToggles, inlayHintTogglesKey } from '../inlayHints'
import { errorMessage } from '../errors.ts'
// 行内调试值（xdebugger dbg/inline，上游 InlineDebugRenderer）：纯规则在 src/inlineDebugValues.ts。
import { createInlineValues } from '../editorInlineValues'
// 彩虹括号（上游 RainbowHighlighter）的等价物；括号配对高亮仍由 basicSetup 的 bracketMatching 承担。
import { angleBraceHighlight, rainbowBrackets } from '../editorBrackets'
// 导入期重试：JDT 大工程导入 ~9.5 分钟里这三条请求全超时，失败要按档退避再试（src/lspWarmup.ts）。
import { LspWarmup } from '../lspWarmup'
import type { InlineCompletionItem, InlineCompletionResult } from '../inlineCompletion'
import { cycleSuggestionIndex, dedupeSuggestions, inlineTriggerKindFor } from '../inlineCompletionNav'
import { inlineCompletionKeymap, inlineDecorationsField, inlineNavigationKeymap, inlineSuggestionField, setInlineSuggestion, suggestionFor } from '../inlineCompletionExtension'
import { describeLink, linkAt, type DocumentLink, type DocumentLinkResult } from '../documentLinks'
import { createQuickEvaluateHint } from '../quickEvaluateHint'
import { createDocumentLinks, linkField } from '../documentLinksExtension'
import { createCodeLens } from '../codeLensExtension'; import type { CodeLensResult } from '../codeLens'
// 调试器悬停快速求值（上游 QuickEvaluateHandler + XDebuggerTextPopup）：装配在 src/quickEvaluateHint.ts，
// 规则在 src/debugQuickEvaluate.ts。**不挂在 lspExtensions() 里** —— 那是语言服务的门，
// 而调试不依赖语言服务；会话可用性由装配层自己按 dapState.paused 判，没会话时压根不返回 tooltip。
const quickEvaluateHint = createQuickEvaluateHint({ path: () => props.path })
import { dapState, lspDiagnostics, request, type DapBreakpoint, type EditorSettings, type LspHighlightResult, type LspDiagnosticReport, type LspFoldingRange, type LspFoldingRangeResult, type LspHoverResult, type LspInlayHintResult, type LspRange, type LspRangeSpan, type LspSelectionRangeResult, type LspSemanticTokensResult } from '../bridge'
// 编辑器内查找栏（上游 `SearchReplaceComponent` + `EditorSearchSession`，不是工程内的 `FindPopupPanel`）：
// 状态/高亮/导航在 src/editorSearchExtension.ts，匹配语义在 src/editorSearch.ts，宿主状态域在 src/editorFindController.ts。
import EditorFindBar from './EditorFindBar.vue'
// 合并冲突导航条（上游 `MergeThreesideViewer` 的按钮在本仓的落点）。
import MergeBar from './MergeBar.vue'
import { createMergeState } from '../editorMergeHost'
import { createFindController, findCommand as findBarCommand } from '../editorFindController'
// 插入/覆盖模式（`EditorToggleInsertStateAction`）：CodeMirror 没有这个能力，用事务过滤还原（见该模块头部）。
import { overwriteExtension, overwriteTheme, toggleOverwrite } from '../editorOverwrite'; import { createHintController } from '../editorHint'; import { createUnwrapCommand } from '../unwrap'; import { IMAGE_PREVIEW_LIMIT, createLiteralPreview } from '../literalPreviewExtension'
import { editorSearchExtension } from '../editorSearchExtension'; import { bidiNotificationExtension } from '../editorBidiNotification'
// 回车家族（上游 `enter/*` 里本仓原先没有的三条：行注释中间回车、未配对左花括号后回车、
// 字符串里回车）与语句级上下移动（`MoveStatementUp`/`MoveStatementDown`）：键位见下面 keymap。
import { smartEnterCommand, smartEnterLanguageFor } from '../enterHandlers'
import { moveStatement } from '../editorStatementMove'
// 自定义折叠区域的列表弹层（上游 `CustomFoldingRegionsPopup` / `GotoCustomRegionAction`，
// 键位 Ctrl+Alt+. = `$default.xml:535-537`）。
import { createCustomRegionsPopup } from '../customFoldingPopup'
// 行注释前缀：语言数据（CodeMirror 的 `commentTokens`）优先，没有语言数据时退回按扩展名的注释标记表。
import { commentStyleFor, commentStyleFromState } from '../commentToggle'
// 大文件模式：阈值/降级清单在 src/largeFileMode.ts；**按字节**判定与大小文案在 src/largeFileBytes.ts；
// 提示条文案与「隐藏/不再显示」持久化在 src/largeFileNotice.ts（上游 LargeFileNotificationProvider）。
import { largeFilePolicyForText, utf8ByteLength } from '../largeFileBytes'
import { dismissLargeFileNotice, isLargeFileNoticeDismissed, largeFileNoticeText } from '../largeFileNotice'
// 按扩展名选语法高亮的动态 import 表拆在 src/editorLanguage.ts。
import { editorLanguageExtension } from '../editorLanguage'

const props = defineProps<{ content: string; path: string; language?: string; theme: Theme; active: boolean; settings: EditorSettings; templates: TemplateSettings; pluginTemplates?: PluginTemplateSource[]; lspEnabled: boolean; readOnly?: boolean; reveal?: { path: string; line: number } | null; breakpoints?: DapBreakpoint[]; debugLine?: number; bookmarks?: number[]; gutterIcons?: GutterIcon[]; blame?: BlameAnnotation[] }>()
const emit = defineEmits<{
  columnMode: [active: boolean]
  selection: [info: { characters: number; lines: number } | null]; cursors: [count: number]
  change: []; cursor: [line: number, column: number]; save: []; error: [message: string]; reveal: [target: { path: string; line: number; column?: number }]; semantic: [payload: { kind: 'rename' | 'references' | 'codeAction' | 'format' | 'signature' | 'implementation' | 'callHierarchy' | 'typeHierarchy' | 'typeDefinition'; path: string; line: number; character: number; range?: LspRange }]; evaluate: [expression: string]; breakpoint: [line1based: number]; surround: []; templateChooser: []; link: [link: DocumentLink]; codeLens: [payload: { command: string; arguments?: unknown[] }]; paste: [payload: PasteEvent]; gutterIcon: [icon: GutterIcon]; gutterIconMiddle: [icon: GutterIcon]; typing: [text: string]; gutterMenu: [at: { line: number; x: number; y: number }]; bidiDirection: [direction: 'contentBased' | 'ltr' | 'rtl']; folded: [line1based: number] }>()
const container = ref<HTMLDivElement>()
const language = new Compartment()
const appearance = new Compartment()
const options = new Compartment()
const lsp = new Compartment()
const indentGuides = new Compartment()
// 彩虹括号的开关（沿用 bracketMatching 设置；配对高亮由 basicSetup 的 bracketMatching 承担）。
const brackets = new Compartment()
let view: EditorView | undefined
// 编辑器内查找栏的宿主侧状态域（上游 `SearchReplaceComponent` + `EditorSearchSession`）。传取值函数而不是 view：view 在 onMounted 才赋值，而控制器在 setup 期就要建好。
const findBar = createFindController(() => view, message => emit('error', message))
// 轻量信息提示（`HintManagerImpl`）：位置/自动消失的规则在 src/editorHint.ts。
const { hint: errorHint, show: showErrorHint, hide: hideErrorHint } = createHintController(() => view, () => container.value)
const findCommand = (backwards: boolean) => findBarCommand(findBar, backwards)
// 自定义折叠区域弹层（上游 `CustomFoldingRegionsPopup`）；扩展挂在 `view.dom` 上，自带收起规则。
const customRegions = createCustomRegionsPopup(() => view)
// 回车：上游那四条先问，都不接管时交回 CodeMirror 的 `insertNewlineAndIndent`。
// 语言词法（行前缀 + 块注释四件套 `JavaCommenter.java:27-28/:32-33/:62-63/:67-68`）在
// src/enterHandlers.ts 的 `smartEnterLanguageFor` 里装配；不给 `block` 等于第②步永远问不到（`EnterInBlockCommentHandler.java:38-39`）。
const smartEnter = smartEnterCommand(() => smartEnterLanguageFor(
  (view ? commentStyleFromState(view.state, view.state.selection.main.head) : null)
    ?? commentStyleFor(undefined, props.path)))
const openFindBar = (replaceMode: boolean) => { findBar.open(replaceMode); nextTick(() => findBarBar.value?.focus?.()) }
const findBarBar = ref<InstanceType<typeof EditorFindBar> | null>(null)
// 光标行（0 基）：合并冲突条的计数要读它。清单与两个动作来自 createMergeState —— 清单取**实时文档**
// （父级 tab.content 只在读盘/存盘时更新，编辑期间是旧的：真机抓到过接受一侧后计数停在 2/2）。
const cursorLine = ref(0)
const { conflicts: mergeConflicts, accept: acceptConflict, jump: jumpConflict, refresh: refreshMerge } = createMergeState(() => view, props.content)
// 大文件模式（降级清单在 src/largeFileMode.ts，上游 `LargeFileEditorProvider` 的等价物）：
// 判定按 **UTF-8 字节数**（src/largeFileBytes.ts —— 上游拿到的是 VFS 长度，本仓只有已解码文本）；
// 关语法高亮、语言服务与自动换行，并且**打开即只读**（上游 `EditorModel.java:1017` 用
// `EditorFactory.createViewer`），点提示条上的「解除只读」才放行编辑；CodeMirror 自身按视口虚拟化。
const large = largeFilePolicyForText(props.content)
const heavy = large.large
const largeBytes = utf8ByteLength(props.content)
const largeNoticeHidden = ref(false)
const largeNoticeDismissed = ref(isLargeFileNoticeDismissed())
let largeProtected = heavy
let diskReadOnly = props.readOnly ?? false
function applyReadOnly() {
  view?.dispatch({ effects: readOnlyMode.reconfigure(diskReadOnly || largeProtected ? EditorState.readOnly.of(true) : []) })
}
function allowLargeEditing() { largeProtected = false; applyReadOnly() }
const literalPreview = createLiteralPreview({ enabled: () => !heavy, documentPath: () => props.path, loadImage: path => request<{ base64: string; kind: string }>('file.readBinary', { path, limit: IMAGE_PREVIEW_LIMIT }).catch(() => null) })  // 字面量预览（IDEA ImageOrColorPreviewService）：Shift + 悬停色块/小图，鼠标侧行为与弹层在 src/literalPreviewExtension.ts

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
let replacing = false, foldedSeen = new Set<number>()   // foldedSeen：上一拍已折起的区间起点（音频提示只报新增，见 updateListener 的 `folded`）
// IDEA's Column Selection Mode: Alt+Shift+Insert. rectangularSelection takes only an eventFilter,
// so reconfiguring the Compartment between "accept every left-drag" and none is what changes behavior.
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
// IDEA's "Show indent guides"：每级缩进一条淡竖线，设置在 src/editorIndentGuides.ts（本文件只组装）。
const editorIndentGuides = indentGuidesExtension(() => props.settings.tabSize, () => props.settings.showIndentGuides)
// 同一符号高亮（LSP `documentHighlight`）：状态机与去抖在 src/editorSymbolHighlight.ts，
// 这里只注入「可用与否 / 当前文件 / 当前视图」。
const symbolHighlight = createSymbolHighlight({ enabled: () => props.lspEnabled && !heavy, path: () => props.path, view: () => view })
// 注解器高亮层（上游 `AnnotatorRunner` + `GeneralHighlightingPass` 那一族）：规则在
// src/annotatorHighlights.ts，调度在 src/annotatorHighlightLayer.ts，这里只注入宿主事实。
// 两处口径说明：
//   · `language` 传 props.language —— 已注册的两个注解器（诊断 tags / 注释里的网页链接）都是
//     `languages: ['*']`（`allForLanguageOrAny` 的 any 部分），所以分派结果与具体语言无关；
//     将来注册语言专属注解器时，这里要改成解析后的语言名。
//   · `dumb` 恒 false —— 本仓没有「索引未就绪」信号，诊断是 LSP `publishDiagnostics` 推来的
//     （那份到达即表示该文件已算完），两个注解器也没有声明 `dumbAware: false`。
const annotatorLayer = createAnnotatorHighlightLayer({
  enabled: () => props.lspEnabled && !heavy,
  path: () => props.path,
  language: () => props.language ?? '',
  view: () => view,
  diagnostics: () => lspDiagnostics.get(props.path) ?? [],
  commentStyle: () => {
    const editor = view
    const style = editor ? commentStyleFromState(editor.state, editor.state.selection.main.head) : null
    return style ?? commentStyleFor(undefined, props.path)
  },
  dumb: () => false,
})
// Inlay hints（LSP `inlayHint`）：widget/渲染前归位/去抖调度在 src/editorInlayHints.ts，
// 三档开关（InlaySettingsConfigurable `inlay.hints` 按 LSP kind 分）在 src/inlayHints.ts。
// 带 `command` 的提示点一下执行 `workspace/executeCommand`（上游 sink 的 payloads 同一件事，
// `InlayTreeSink.kt:27-31`）；路径取**本编辑器**的 path，而不是全局的 activePath ——
// 提示是按这份文档的行列算出来的，命令得对着同一个文档发。
const inlayHints = createInlayHints({
  enabled: () => props.lspEnabled && !heavy,
  path: () => props.path,
  view: () => view,
  toggles: () => inlayHintToggles(props.settings),
  onCommand: (command, args) => {
    void request('lsp.request', { kind: 'executeCommand', path: props.path, line: 0, character: 0, command, ...(args ? { arguments: args } : {}) })
      .catch(error => emit('error', errorMessage(error)))
  },
})
// 行内调试值（xdebugger `dbg/inline`）：拉取当前栈顶帧的 DAP 变量并渲染到行尾
// （纯规则与上限在 src/inlineDebugValues.ts，DAP→装饰在 src/editorInlineValues.ts）。
const inlineValues = createInlineValues({ enabled: () => !heavy && dapState.paused && dapState.currentLocation?.path === props.path, view: () => view })
let inlineTimer: number | undefined
let inlineInFlight = false
// 多建议：这一拍拿到的全部条目与当前下标。上游是「一个 session 里有多个 variant」，
// 切换动作 `SwitchInlineCompletionVariantAction`（`InlineCompletionActions.kt:31-52`；键位
// `alt CLOSE_BRACKET`/`alt OPEN_BRACKET`，intellij.platform.lang.impl.actions.xml:127-132）。
// 纯规则在 src/inlineCompletionNav.ts（去重、绕圈、触发类型），这里只存下标并落进编辑器状态。
let inlineItems: InlineCompletionItem[] = []
let inlineIndex = 0
/** 落第 `index` 条建议（绕圈）；没有可显示的就清掉旧建议。返回是否真的画出来了。 */
function showInlineSuggestion(index: number): boolean {
  const editor = view
  if (!editor || !inlineItems.length) return false
  const at = ((index % inlineItems.length) + inlineItems.length) % inlineItems.length
  const head = editor.state.selection.main.head          // 接受区间与锚点都以光标的 LSP 坐标为准
  const line = editor.state.doc.lineAt(head)
  const suggestion = suggestionFor(inlineItems[at], { line: line.number - 1, char: head - line.from })
  inlineIndex = at
  editor.dispatch({ effects: setInlineSuggestion.of(suggestion) })
  return suggestion !== null
}
function clearInlineSuggestion() {
  inlineItems = []
  inlineIndex = 0
  view?.dispatch({ effects: setInlineSuggestion.of(null) })
}
function scheduleInlineCompletion() {
  if (!props.lspEnabled || heavy) return
  if (inlineTimer !== undefined) clearTimeout(inlineTimer)
  // IDEA 的 `isEnabled(event)` 在打字/停顿后触发；这里同样只在"没有选区"时问 ——
  // 有选区时用户是在选东西，不是在打字。
  const editor = view
  if (editor && !editor.state.selection.main.empty) { clearInlineSuggestion(); return }
  inlineTimer = window.setTimeout(() => { inlineTimer = undefined; void runInlineCompletion() }, 300)
}
async function runInlineCompletion(trigger: 'automatic' | 'explicit' = 'automatic') {
  const editor = view
  if (!editor || !props.lspEnabled || inlineInFlight) return
  const head = editor.state.selection.main.head
  if (head !== editor.state.selection.main.anchor) return
  const line = editor.state.doc.lineAt(head)
  inlineInFlight = true
  try {
    const result = await request<InlineCompletionResult>('lsp.request', {
      kind: 'inlineCompletion', path: props.path, line: line.number - 1, character: head - line.from,
      // 自动（1）/ 显式（2）：Shift+Alt+\ 是 `CallInlineCompletionAction`（actions.xml:115-117），
      // 协议里就是显式索取这一档，服务器据此决定要不要现在就算。规则见 inlineTriggerKindFor。
      triggerKind: inlineTriggerKindFor(trigger),
    })
    // 这期间文档可能已经变了（await 之后位置全变了），所以 dispatch 前重新确认视图没换。
    if (view !== editor) return
    // 服务器重发时列表里可能有重复项，按身份键（range 起点 + 插入文本）去重后整份替换。
    inlineItems = dedupeSuggestions(result.available ? result.items : undefined)
    showInlineSuggestion(0)
  } catch { /* 服务器没有行内补全能力时什么都不显示，不影响编辑 */ }
  finally { inlineInFlight = false }
}
// Alt+] / Alt+[：切到下一条/上一条建议（绕圈，规则在 `cycleSuggestionIndex`）。
// 没有建议时不消费按键 —— 与上游 `isEnabledForCaret` 同一口径（InlineCompletionActions.kt:48-50）。
function cycleInlineSuggestion(editor: EditorView, delta: number) {
  if (editor.state.field(inlineSuggestionField, false) === null) return false
  return showInlineSuggestion(cycleSuggestionIndex(inlineIndex, delta, inlineItems.length))
}
// Shift+Alt+\：显式索取一次（`CallInlineCompletionAction`，actions.xml:115-117）。
function callInlineCompletion() {
  if (!props.lspEnabled || heavy) return false
  if (inlineTimer !== undefined) { clearTimeout(inlineTimer); inlineTimer = undefined }
  void runInlineCompletion('explicit')
  return true
}
// LSP `textDocument/semanticTokens/*`：decoration 层在 src/editorSemanticField.ts
// （上游 daemon 着色路径见 src/semanticTokens.ts 的 `HighlightVisitor`/`Annotator` + `TextAttributesKey`），
// 拉取/增量/delta 合并与导入期重试留在这里（要和 warmup 生命周期绑一起）。
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
  semanticTimer = window.setTimeout(() => { semanticTimer = undefined; void semanticWarmup.start() }, 400)
}
async function runSemanticTokens(): Promise<boolean> {
  const editor = view
  if (!editor || !props.lspEnabled) return true
  try {
    const result = await request<LspSemanticTokensResult>('lsp.request', {
      kind: 'semanticTokens', path: props.path, line: 0, character: 0,
      // 没有 resultId 时**不发这个键**：发空串等于告诉服务器"上一份是空的"，它会走另一条路。
      ...(semanticResultId ? { previousResultId: semanticResultId } : {}),
    })
    // 期间换过文档（视图重建）的话这次答案已经过期，不能 dispatch 到新文档上。
    const target = view
    if (target !== editor) return true
    if (!result.available) { resetSemanticTokens(); target.dispatch({ effects: setSemanticTokens.of([]) }); return true }
    if (result.resultId) semanticResultId = result.resultId
    // 规范允许 `/full/delta` 用整份 `data` 回答（"全部替换"），所以 edits 为空时就用 data。
    const hasEdits = Array.isArray(result.edits) && result.edits.length > 0
    semanticData = result.kind === 'delta' && hasEdits
      ? applySemanticTokenEdits(semanticData, result.edits)
      : [...(result.data ?? [])]
    target.dispatch({ effects: setSemanticTokens.of(decodeSemanticTokens(semanticData, result.legend)) })
    // 非空才算"着色已到位"；空数组还可能是导入期，交给 warmup 退避重试（available: false 则到此为止）。
    return semanticData.length > 0
  } catch { return false }
}
// 折叠调度管道在 src/editorFoldingController.ts（顺序与两个真机坑写在那；宿主只注入依赖）。
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
// `diagnosticProvider` 时由客户端主动来问，`previousResultId` 让它可以回答 `unchanged`。pull 与 push
// 二选一，标记为 pull 的文件不再接受推送（见 bridge 的 `pullManagedFiles`）。
const diagnosticIds = new Map<string, string>()
let pullTimer: number | undefined
function schedulePullDiagnostics() {
  if (!props.lspEnabled || heavy) return
  if (pullTimer !== undefined) clearTimeout(pullTimer)
  pullTimer = window.setTimeout(() => { pullTimer = undefined; void diagnosticWarmup.start() }, 350)
}
async function runPullDiagnostics(): Promise<boolean> {
  if (!props.lspEnabled) return true
  try {
    const previousResultId = diagnosticIds.get(props.path)
    const report = await request<LspDiagnosticReport>('lsp.request',
      { kind: 'diagnostic', path: props.path, line: 0, character: 0, previousResultId })
    // 服务器只推送（或重启后不再声明 diagnosticProvider）：撤掉 pull 标记，让推送通道重新接管 ——
    // 否则它会永远收不到诊断。已有诊断不清空。
    if (!report.supported) { clearPullDiagnostics(props.path); return true }
    if (report.kind === 'unchanged') return true
    if (report.resultId) diagnosticIds.set(props.path, report.resultId)
    setPullDiagnostics(props.path, report.items ?? [])
    // 非空才算"诊断已到位"；空 items 在导入期还可能是没扫到，交给 warmup 退避重试。
    return (report.items ?? []).length > 0
  } catch { return false }
}
// —— 导入期重试（JDT 大工程导入 ~9.5 分钟里这三条请求全超时；规则与退避在 src/lspWarmup.ts）——
// 折叠这条：拿到非空区间后让控制器重新拉取并应用；available: false 视为"能力没有"、不再重试。
async function foldingWarmupRun(): Promise<boolean> {
  if (!props.lspEnabled) return true
  try {
    const result = await request<LspFoldingRangeResult>('lsp.request', { kind: 'foldingRange', path: props.path, line: 0, character: 0 })
    if (!result.available) return true
    if (!(result.ranges ?? []).length) return false
    folding.schedule()
    return true
  } catch { return false }
}
const semanticWarmup = new LspWarmup({ run: runSemanticTokens })
const foldingWarmup = new LspWarmup({ run: foldingWarmupRun })
const diagnosticWarmup = new LspWarmup({ run: runPullDiagnostics })
function cancelWarmups() { semanticWarmup.cancel(); foldingWarmup.cancel(); diagnosticWarmup.cancel() }
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
  setReadOnly: (value: boolean) => { diskReadOnly = value; applyReadOnly() },
})
async function loadLanguage(path: string) {
  if (heavy) return
  try {
    // 语言表在 src/editorLanguage.ts（「关联文件类型」覆盖 / 扩展名启发式都在那儿）。
    const extension = await editorLanguageExtension(path, props.language)
    if (props.path === path) view?.dispatch({ effects: language.reconfigure(extension) })
  } catch { emit('error', `无法加载 ${path} 的语法高亮，文本编辑仍可用。`) }
}
/**
 * IDEA's GotoNextError / GotoPreviousError (GotoNextErrorHandler.java). 挑目标与落进编辑器
 * 都在 src/gotoNextError.ts（navigateToError）；这里只把「有没有视图/LSP」与提示的开关接上。
 */
function goToError(forward: boolean): boolean {
  if (!props.lspEnabled) return false
  const outcome = navigateToError(view, lspDiagnostics.get(props.path) ?? [], forward)
  if (outcome === 'unavailable') return false
  if (outcome === 'no-target') { showErrorHint(NO_ERRORS_IN_FILE); return true }
  hideErrorHint()
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
// Tab / Shift+Tab (IDEA's indent & outdent). basicSetup deliberately omits `indentWithTab`, so the key
// used to fall through to the browser. A selection indents every touched line; a caret inserts one indent
// unit (tab when Editor → "Use tab character" is on, else `tabSize` spaces) — both from the same facet.
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
// One flat action surface for the menus: shared editing commands + editor-local actions (search bar,
// completion, LSP queries the parent renders). A menu item and its key binding resolve to the same function.
const editorActions: Record<string, Command> = {
  ...editingCommands,
  ...clipboardCommands(text => void copyToClipboard(text)), // IDEA EditorCopy/EditorCut：无选区时先选中整行（src/editorClipboard.ts）
  // 查找那一族改走**编辑器内查找栏**（上游 `SearchReplaceComponent`）：`editingCommands` 的 find 族指向
  // CodeMirror 自己的面板（本仓是空操作），整族在此覆盖；`replace.next`/`replace.all` 上游是按钮、一并撤掉。
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
    // Alt+] / Alt+[ 切建议、Shift+Alt+\ 显式索取（键位与上游一致，见 inlineNavigationKeymap 的注释）。
    inlineNavigationKeymap({ cycle: cycleInlineSuggestion, call: () => callInlineCompletion() }),
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
      // $default.xml:658-660 / :679-681 — GotoNextError = F2, GotoPreviousError = shift F2. Both need
      // highlighting to be available (BaseGotoNextErrorAction.isValidForFile:52-54), hence this keymap.
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
  return editorOptionExtensions({ tabSize: props.settings.tabSize, indentUnit: indentUnitText(), wordWrap: props.settings.wordWrap, lineNumbers: props.settings.lineNumbers, showWhitespaces: props.settings.showWhitespaces, lineNumeration: props.settings.lineNumeration }, heavy, whitespaceLayer)
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
          // 移动到配对的括号 = Ctrl+Shift+M（`EditorMatchBrace`，`$default.xml:1146-1148`；Mac 那份 `:642` 也是 shift control M）。
          { key: 'Ctrl-Shift-m', preventDefault: true, run: editingCommands['brace.match']! },
          { key: 'Mod-Shift-u', preventDefault: true, run: editingCommands['case.toggle']! },
          // FindNext/FindPrevious = F3 / Shift+F3（$default.xml:707-708 / :507-508），编辑菜单公布的正是这两条。
          // 必须走查找栏会话：CodeMirror 自带的 findNext/findPrevious 只在它自己的面板打开时才有事做（见 editorSearchExtension.ts）。
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
          // Unwrap（上游 Code 菜单 `UnwrapAction`，$default.xml:917-920 = Ctrl+Shift+Delete）。
          { key: 'Ctrl-Shift-Delete', preventDefault: true, run: editor => createUnwrapCommand(props.settings.tabSize)(editor) },
          // EditorToggleInsertState = INSERT（`$default.xml:457-459`）。
          { key: 'Insert', preventDefault: true, run: editor => { toggleOverwrite(editor); return true } },
          // 回车：上游 `enter/*` 里本仓原先没有的三条（行注释中间续注释、未配对左花括号后补 `}`、
          // 字符串里插 `" + "`）。**排在 basicSetup 之前**，否则 `insertNewlineAndIndent` 先赢；
          // 三条都不认得时本命令返回 false，键继续往 basicSetup 走（成对花括号之间多插一个换行
          // 那一条是 `insertNewlineAndIndent` 自己在做，见 src/enterHandlers.ts 的模块头）。
          { key: 'Enter', preventDefault: true, run: smartEnter },
          // 语句级上下移动（`$default.xml:782-787`：MoveStatementDown = Ctrl+Shift+Down、
          // MoveStatementUp = Ctrl+Shift+Up；Alt+Shift+Up/Down 是 MoveLineUp/Down，上面已挂）。
          { key: 'Ctrl-Shift-ArrowUp', preventDefault: true, run: moveStatement(false) },
          { key: 'Ctrl-Shift-ArrowDown', preventDefault: true, run: moveStatement(true) },
          // GotoCustomRegion = Ctrl+Alt+.（`$default.xml:535-537`）：弹自定义折叠区域列表。
          // 一个区域都没有时给提示，与 `GotoCustomRegionAction.java:65` 一致。
          { key: 'Ctrl-Alt-.', preventDefault: true, run: () => {
            if (customRegions.show()) return true
            showErrorHint('这个文件里没有自定义折叠区域')
            return true
          } },
        ]),
        // Keys the library would otherwise answer with something IDEA does not do. These
        // bindings have to precede basicSetup: a CodeMirror keymap facet is a plain facet, so
        // the extension listed first wins the key.
        keymap.of([
          // $default.xml:849-851 — F8 is Step Over; dapStep runs from the window-level handler, and
          // @codemirror/lint's lintKeymap also binds F8 to nextDiagnostic. Consuming it here shadows only
          // the library binding: the browser default is prevented but the event still reaches the window handler.
          { key: 'F8', preventDefault: true, run: () => true },
          // $default.xml:309-311 / :717-719 — Alt+Left/Right is PreviousTab/NextTab, and
          // TabNavigationActionBase.java:71-78 routes it to the editor's tabs. CodeMirror binds the
          // same chord to cursorSyntaxLeft/Right, so the caret would also jump a syntax unit.
          { key: 'Alt-ArrowLeft', preventDefault: true, run: () => true },
          { key: 'Alt-ArrowRight', preventDefault: true, run: () => true },
        ]),
        basicSetup,
        // 覆盖模式：事务过滤 + 块光标（上游的可见指示就是块光标，没有状态栏组件）。
        overwriteExtension(), overwriteTheme,
        // 自定义折叠区域弹层（上游 `CustomFoldingRegionsPopup`）：文本一变就收起。
        customRegions.extension,
        // 查找栏（上游 `SearchReplaceComponent`）的状态/高亮/F3 会话；排在 basicSetup 之后即可 ——
        // 它自己那两条 F3 键位写在**前面**那张 keymap 里，先赢。双向文本提示挂在同一条链上。
        editorSearchExtension(), bidiNotificationExtension(direction => emit('bidiDirection', direction)),
        EditorState.lineSeparator.of(props.content.includes('\r\n') ? '\r\n' : '\n'),
        language.of([]),
        ...(heavy ? [] : [syntaxHighlighting(syntaxColors)]),
        appearance.of(editorTheme({ fontSize: props.settings.fontSize, lineNumbers: props.settings.lineNumbers, dark: props.theme === 'dark' })),
        options.of(editorOptions()),
        lsp.of(heavy ? [] : lspExtensions()),
        // 调试器值提示：常驻（不进 lsp 门），没挂起的调试会话时它自己返回 null，不弹。
        quickEvaluateHint,
        // Alt+drag always selects a rectangle; the compartment holds the persistent
        // column-selection mode toggled by Alt+Shift+Insert.
        rectangularSelection(),
        columnMode.of([]),
        // IDEA's read-only status table: a locked file edits nowhere. 大文件模式也走这里
        // （上游 `EditorModel.java:1017` 用 viewer 编辑器；「解除只读」按钮撤掉这层保护）。
        readOnlyMode.of(diskReadOnly || largeProtected ? EditorState.readOnly.of(true) : []),
        // Settings → "Show indent guides"（每级缩进一条竖线，实现在 src/editorIndentGuides.ts）。
        indentGuides.of(props.settings.showIndentGuides ? editorIndentGuides : []),
        // 彩虹括号（上游 `RainbowHighlighter`）：本仓自己的开关沿用 `bracketMatching` 设置，
        // 与 basicSetup 的括号配对高亮同一个门（见 tests/editor-brackets.test.mjs 记的口径）。
        brackets.of(props.settings.bracketMatching && !heavy ? rainbowBrackets() : []),
        // 逐语言的引号规则与 Java 泛型 `<>` 的配对高亮：两者都读 `getLanguage()` 的即时语言，常驻一条就够；
        // 不在表里的语言一律返回 false，交回 CodeMirror 的 `closeBrackets`。上游按 fileType 取 handler
        // （`QuoteHandlerEP.java:16-27` + `intellij.platform.lang.impl.xml:405/:408`；尖括号 `JavaPairedBraceMatcher.java:12/:26-34`）。
        smartQuotes(() => props.language), angleBraceHighlight(() => props.language),
        debugLineExtension,
        semanticTokensField,
        // 行内调试值（暂停时在行尾显示当前帧变量值）。
        inlineValues.extension,
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
        codeLens.extension, literalPreview.extension,
        symbolHighlight.extension,
        annotatorLayer.extension,
        inlayHints.extension,
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
          // 每一次内容变更都要通知宿主（书签对账、断点缓存、最近位置、草稿都在 `change` 上；Ctrl+Z 也是带
          // changes 的一次事务 —— history 的 pop 用 state.update 派发，见 @codemirror/commands index.js:548-556）。
          // 宿主侧通知幂等：rememberPlace 按文件+行去重、定时器重排是 clear+set。
          if (update.docChanged && !replacing) { emit('change'); scheduleLspChange(); schedulePullDiagnostics(); scheduleSemanticTokens(); documentLinks.schedule(); codeLens.schedule(); scheduleInlineCompletion(); rangeStack = null; templateStops = []; noteEdit(); inlayHints.schedule(); annotatorLayer.schedule(); if (props.lspEnabled && !heavy) folding.schedule() }
          // 查找栏的计数跟着文档变（改了字，命中数与当前下标都会变）。
          if (update.docChanged || update.selectionSet) findBar.refresh()
          // 冲突条同理：标记被接受/手写进来/删掉都要当场反映。
          if (update.docChanged) refreshMerge(update.state.doc.toString())
          // 宏录制要的是「敲进去的字」（IDEA 的按键级录制在本仓的等价物）
          if (!replacing) { const typed = insertedText(update); if (typed) emit('typing', typed) }
          if (update.selectionSet) scheduleInlineCompletion()
          if (update.selectionSet || update.docChanged) {
            const pos = update.state.selection.main.head, line = update.state.doc.lineAt(pos)
            emit('cursor', line.number, pos - line.from + 1); cursorLine.value = line.number - 1
            // IDEA's PositionPanel switches to "N selected" while a selection exists.
            const range = update.state.selection.main, selected = range.to - range.from
            emit('selection', selected > 0 ? { characters: selected, lines: update.state.doc.lineAt(range.to).number - update.state.doc.lineAt(range.from).number } : null); emit('cursors', update.state.selection.ranges.length)
            if (update.selectionSet) symbolHighlight.schedule()
          }
          // 音频提示的折叠线索（上游 `FoldedCodeAudioCueDetector`）：只报**新折起**的区间（展开不响）。
          if (update.transactions.some(tr => tr.effects.some(effect => effect.is(foldEffect) || effect.is(unfoldEffect)))) {
            const next = new Set<number>(); foldedRanges(update.state).between(0, update.state.doc.length, from => { next.add(from) })
            for (const from of next) if (!foldedSeen.has(from)) emit('folded', update.state.doc.lineAt(from).number)
            foldedSeen = next
          }
        }),
        EditorView.contentAttributes.of({ 'aria-label': `代码编辑器 ${props.path}`, spellcheck: 'false' }),
      ],
    }),
  })
  void loadLanguage(props.path); syncDebugLine(view, props.debugLine ?? 0)
  syncGutter(); syncBlame()
  // HIDE_BY_SCROLLING (HintManagerImpl.java:624): the hint is placed in the container's
  // coordinates and would be left floating over the wrong line once the text moves.
  view.scrollDOM.addEventListener('scroll', hideErrorHint, { passive: true })
  if (props.active) view.focus()
  applyReveal(props.reveal)
  symbolHighlight.schedule()
  annotatorLayer.schedule()
  inlayHints.schedule()
})
// The hint belongs to one file and to the focused tab, so leaving either dismisses it.
watch(() => FOLDING_SETTING_ROWS.map(row => props.settings[row.key]).join(','), () => folding.applyDefaults())
// InlaySettingsConfigurable 的三档开关：关掉一档要把已经画出来的那些收走，打开要重新问一遍语言服务
// （`shouldShowInlayHint` 在拉取时过滤，所以重跑 schedule 是唯一出路）。依赖用拼好的字符串而不是数组
// —— 数组每次都是新引用，会变成「每拍都触发」。
watch(() => inlayHintTogglesKey(inlayHintToggles(props.settings)), () => inlayHints.schedule())
watch(() => props.path, () => { cancelWarmups(); folding.capture(); hideErrorHint(); void loadLanguage(props.path); resetSemanticTokens(); folding.schedule(); foldingWarmup.start(); schedulePullDiagnostics(); scheduleSemanticTokens(); documentLinks.schedule(); codeLens.schedule(); scheduleInlineCompletion(); annotatorLayer.schedule() })
watch(() => props.active, async active => {
  if (active) { await nextTick(); view?.requestMeasure(); view?.focus() }
  else hideErrorHint()
})
watch(() => props.theme, () => view?.dispatch({ effects: appearance.reconfigure(editorTheme({ fontSize: props.settings.fontSize, lineNumbers: props.settings.lineNumbers, dark: props.theme === 'dark' })) }))
watch(() => props.settings, () => view?.dispatch({ effects: [appearance.reconfigure(editorTheme({ fontSize: props.settings.fontSize, lineNumbers: props.settings.lineNumbers, dark: props.theme === 'dark' })), options.reconfigure(editorOptions()), indentGuides.reconfigure(props.settings.showIndentGuides ? editorIndentGuides : []), setIndentGuides.of(props.settings.showIndentGuides), brackets.reconfigure(props.settings.bracketMatching && !heavy ? rainbowBrackets() : [])] }), { deep: true })
watch(() => props.lspEnabled, enabled => {
  view?.dispatch({ effects: lsp.reconfigure(enabled ? lspExtensions() : []) })
  if (!enabled) {
    // 关掉语言服务时语义着色/同符号高亮/inlay hints 都必须撤掉 —— 留着就是没人再更新的旧标记。
    // 行内补全连同它的**建议列表**一起清：列表留着，Alt+] 还能切出一条已经不存在的建议。
    view?.dispatch({ effects: setSemanticTokens.of([]) }); symbolHighlight.clear(); annotatorLayer.clear(); inlayHints.clear(); clearInlineSuggestion(); documentLinks.reset(); codeLens.reset()
    resetSemanticTokens()
    rangeStack = null
    return
  }
  if (view) { forceLinting(view); scheduleLspChange() }
  symbolHighlight.schedule()
  annotatorLayer.schedule()
  inlayHints.schedule()
  folding.schedule(); foldingWarmup.start()
  schedulePullDiagnostics()
  scheduleSemanticTokens()
  documentLinks.schedule()
  codeLens.schedule()
  scheduleInlineCompletion()
})
watch(() => lspDiagnostics.get(props.path), () => { if (view && props.lspEnabled) { forceLinting(view); folding.schedule(); annotatorLayer.schedule() } })
// 行内调试值：会话/停点/线程/当前文件任一变化就重取（暂停时才显示，见 enabled 门）。
watch(() => [dapState.running, dapState.paused, dapState.threadId, dapState.currentLocation?.path, dapState.currentLocation?.line, props.path], () => { void inlineValues.refresh() })
watch(() => props.reveal, target => applyReveal(target))
// The parent already flips EditorState.readOnly through setReadOnly(); watching the
// prop too would re-dispatch the effect on every later re-render.
watch(() => [props.debugLine, props.gutterIcons, props.blame], () => { syncDebugLine(view, props.debugLine ?? 0); syncGutter(); syncBlame() })
onBeforeUnmount(() => { cancelWarmups(); folding.capture(); if (lspTimer !== undefined) clearTimeout(lspTimer); if (pullTimer !== undefined) clearTimeout(pullTimer); if (semanticTimer !== undefined) clearTimeout(semanticTimer); folding.dispose(); documentLinks.dispose(); codeLens.dispose(); symbolHighlight.dispose(); annotatorLayer.dispose(); inlayHints.dispose(); if (inlineTimer !== undefined) clearTimeout(inlineTimer); view?.destroy(); view = undefined })
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
      :preserve-case="findBar.state.preserveCase"
      :history="findBar.state.history"
      @update="findBar.setOptions"
      @query="findBar.setQuery"
      @replace="findBar.setReplace"
      @next="findBar.next"
      @previous="findBar.previous"
      @close="findBar.close"
      @toggle-replace="findBar.toggleReplace"
      @toggle-preserve-case="findBar.togglePreserveCase"
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
    <!-- 大文件提示（上游 `LargeFileNotificationProvider`）：大小 + 只读说明 + 隐藏/不再显示/解除只读。 -->
    <div v-if="large.large && !largeNoticeHidden && !largeNoticeDismissed" class="editor-large-banner" role="status">
      <span>{{ largeFileNoticeText(largeBytes) }}</span>
      <button type="button" class="subtle-button" title="解除只读保护（大文件格式化成普通可编辑缓冲区）" @click="allowLargeEditing">解除只读</button>
      <button type="button" class="subtle-button" title="本次打开期间隐藏这条提示" @click="largeNoticeHidden = true">隐藏</button>
      <button type="button" class="subtle-button" title="以后不再显示大文件提示" @click="largeNoticeDismissed = true; dismissLargeFileNotice()">不再显示</button>
    </div>
    <!-- Teleport 到 body：编辑器容器有 overflow/transform 约束，绝对定位在这里会被裁掉；源位置不影响落点，所以能挪进根 div。 -->
    <Teleport v-if="chooseTarget" to="body">
      <TargetChooserPopup :rows="chooseTarget.rows" :x="chooseTarget.x" :y="chooseTarget.y" title="选择声明" @pick="pickChooseTarget" @close="chooseTarget = null" />
    </Teleport>
    <Teleport v-if="quickDefinition" to="body">
      <QuickDefinitionPopup :source="quickDefinition.source" :x="quickDefinition.x" :y="quickDefinition.y" @close="quickDefinition = null" />
    </Teleport>
  </div>
</template>
