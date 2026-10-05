// 按特性逐条的能力降级表（IDEA `LspFeature` 一族在本仓的对应物）。
//
// 上游做法：每种语言特性有一个 `LspFeature` 描述符，能力缺失/被服务端拒绝时由它决定
// 「这个动作还在不在、点了会怎样」；`LspServerDescriptor` 的 capability 表与
// `LspClientImpl` 的 `LSP_UNSUPPORTED` 错误是同一个判断的两端。
//
// 本仓的对应物分两层：
//   · **请求侧**：`native/lsp_support.cpp:201-237` 的 `provider_for()` 把请求 kind 映到
//     capability 键；服务端显式声明 `false`/`null` 时返回 `LSP_UNSUPPORTED`（`lsp_capability_queries.cpp:95-106`）。
//   · **呈现侧**（本模块）：kind → 上游特性名 → 本仓的用户可见落点 → 服务端说「不支持」时
//     用户看到什么/本仓还能做什么（本地回退或隐藏入口）。
//
// 这张表是**声明式的**：`tests/lsp-feature-matrix.test.mjs` 会核对它覆盖了前端会发的所有 kind，
// 并核对每个落点文件真实存在 —— 所以它不是文档，是能被门禁抓住漂移的契约。

/** 一条特性的降级说明。 */
export interface LspFeatureRow {
  /** 特性的规范名（与 `src/bridge.ts` 的 LspRequestKind 同一套名字）。 */
  kind: string
  /** 前端实际会发、同属这一条特性的 kind（缺省 = 只有 `kind` 本身）。 */
  kinds?: readonly string[]
  /** 上游的 capability 键（与 `native/lsp_support.cpp` 的 `provider_for` 一一对应）。 */
  provider: string
  /** 上游的类/包（排查时能对上源码）。 */
  upstream: string
  /** 本仓的用户可见落点（真实文件，门禁核对存在）。 */
  surface: string
  /**
   * 服务端声明不支持时的处置：
   *   · `hide` —— 入口应当隐藏/禁用（点了也没用的控件是谎）；
   *   · `local` —— 本仓有本地等价物，继续可用；
   *   · `notice` —— 入口保留但点了给出明确提示（配置类能力，比如换语言服务器）。
   */
  fallback: 'hide' | 'local' | 'notice'
  /** `fallback` 的具体说明（用户会看到什么 / 本地等价物是什么）。 */
  detail: string
}

/**
 * 表本体。`kind` 覆盖 `src/bridge.ts` 里前端会发的 LSP 请求；
 * 纯 native → 服务端内部的 kind（如 `moniker`）不列在这里。
 */
export const LSP_FEATURES: readonly LspFeatureRow[] = [
  // `surface` 记的是 Ctrl+Q 那一侧（`src/editorFileOps.ts:97` 建 `createQuickDocHost` 并挂 `showQuickDoc`）；
  // 编辑器内的悬停提示是同一 kind 的第二个消费方（`src/components/CodeEditor.vue:497-513` 的 `hoverTooltip`，
  // 250ms、`hoverTime`），它不经过本模块，所以下句说的是**两条都在弹**，不是只有 Ctrl+Q。
  { kind: 'hover', provider: 'hoverProvider', upstream: 'LspHoverFeature', surface: 'src/editorFileOps.ts', fallback: 'hide', detail: '悬停弹提示（编辑器 hoverTooltip，250ms）；Ctrl+Q 走同一条请求并渲染 DocumentationMarkup 布局。服务端不声明 hoverProvider 时两条都不弹。' },
  { kind: 'completion', provider: 'completionProvider', upstream: 'LspCompletionFeature', surface: 'src/lspCompletion.ts', fallback: 'hide', detail: '不弹补全；不退回关键字字典（上游也没有本地回退）。' },
  { kind: 'completionItemResolve', provider: 'completionProvider.resolveProvider', upstream: 'LspCompletionFeature.resolve', surface: 'src/lspCompletion.ts', fallback: 'local', detail: '用补全条目自带的 documentation/detail；自动 import 可能缺失（上游同此）。' },
  { kind: 'definition', provider: 'definitionProvider', upstream: 'LspGotoDeclarationFeature', surface: 'src/lspNavigation.ts', fallback: 'hide', detail: 'Ctrl+B 无跳转；不编造位置。' },
  { kind: 'typeDefinition', provider: 'typeDefinitionProvider', upstream: 'LspGotoTypeDeclarationFeature', surface: 'src/lspNavigation.ts', fallback: 'hide', detail: 'Ctrl+Shift+B 保持禁用。' },
  { kind: 'implementation', provider: 'implementationProvider', upstream: 'LspGotoImplementationFeature', surface: 'src/lspNavigation.ts', fallback: 'hide', detail: 'Ctrl+Alt+B 保持禁用。' },
  { kind: 'references', provider: 'referencesProvider', upstream: 'LspFindUsagesFeature', surface: 'src/lspNavigation.ts', fallback: 'hide', detail: 'Alt+F7 不出现结果视图；不退回文本搜索（那会给出错误的引用集）。' },
  { kind: 'documentHighlight', provider: 'documentHighlightProvider', upstream: 'LspHighlightUsagesFeature', surface: 'src/editorCommands.ts', fallback: 'local', detail: '用编辑器内同词匹配（本仓已有）标出出现处，语义范围可能略宽。' },
  { kind: 'documentSymbol', provider: 'documentSymbolProvider', upstream: 'LspDocumentSymbolFeature', surface: 'src/outlineView.ts', fallback: 'hide', detail: '结构视图显示「该语言服务未提供符号信息」（面板已有这条空态）。' },
  { kind: 'workspaceSymbol', provider: 'workspaceSymbolProvider', upstream: 'LspSymbolSearchFeature', surface: 'src/lspNavigation.ts', fallback: 'hide', detail: '「转到符号」不返回结果。' },
  { kind: 'rename', provider: 'renameProvider', upstream: 'LspRenameFeature', surface: 'src/semanticActions.ts', fallback: 'hide', detail: 'Shift+F6 不进入重命名（不让用户改一半）。' },
  { kind: 'prepareRename', provider: 'renameProvider.prepareProvider', upstream: 'LspRenameFeature.prepare', surface: 'src/semanticActions.ts', fallback: 'hide', detail: '同上；`prepareProvider` 缺失时上游直接就地问名字。' },
  { kind: 'formatting', provider: 'documentFormattingProvider', upstream: 'LspFormattingFeature', surface: 'src/semanticActions.ts', fallback: 'hide', detail: '格式化入口置灰；不退回本地缩进器（会覆盖服务端风格）。' },
  { kind: 'rangeFormatting', provider: 'documentRangeFormattingProvider', upstream: 'LspFormattingFeature.range', surface: 'src/semanticActions.ts', fallback: 'hide', detail: '选区格式化入口置灰。' },
  { kind: 'codeAction', provider: 'codeActionProvider', upstream: 'LspCodeActionFeature', surface: 'src/semanticActions.ts', fallback: 'hide', detail: '快速修复菜单为空；Alt+Enter 不弹层。' },
  { kind: 'codeActionResolve', provider: 'codeActionProvider.resolveProvider', upstream: 'LspCodeActionFeature.resolve', surface: 'src/semanticActions.ts', fallback: 'local', detail: '直接用未解析的 action（edit/command 常已带全）。' },
  { kind: 'executeCommand', provider: 'executeCommandProvider', upstream: 'LspCommandFeature', surface: 'src/semanticActions.ts', fallback: 'notice', detail: '依赖命令的动作（如自动 import）执行时报「服务端未提供该命令」。' },
  { kind: 'signatureHelp', provider: 'signatureHelpProvider', upstream: 'LspParameterInfoFeature', surface: 'src/semanticActions.ts', fallback: 'hide', detail: 'Ctrl+P 不弹参数提示。' },
  { kind: 'inlayHint', provider: 'inlayHintProvider', upstream: 'LspInlayHintsFeature', surface: 'src/inlayHints.ts', fallback: 'hide', detail: '行内提示整族不渲染（设置项保持但无效果，与上游「没有 provider」同）。' },
  { kind: 'foldingRange', provider: 'foldingRangeProvider', upstream: 'LspFoldingFeature', surface: 'src/editorFolding.ts', fallback: 'local', detail: '退回本仓的括号/缩进折叠（src/editorFolding.ts 已有本地分支）。' },
  { kind: 'selectionRange', provider: 'selectionRangeProvider', upstream: 'LspSelectionRangeFeature', surface: 'src/lspNavigation.ts', fallback: 'local', detail: 'Ctrl+W 按本仓的词/括号/行层级扩展（上游同款回退）。' },
  { kind: 'semanticTokens', provider: 'semanticTokensProvider', upstream: 'LspSemanticHighlightingFeature', surface: 'src/semanticTokens.ts', fallback: 'local', detail: '退回 CodeMirror 词法着色（语义着色整层为空是正常降级）；没有 delta 能力时每次取整份（增量只省流，不是能力）。' },
  { kind: 'documentLink', provider: 'documentLinkProvider', upstream: 'LspDocumentLinkFeature', surface: 'src/documentLinks.ts', fallback: 'local', detail: '退回编辑器自带 URL 识别（src/documentLinks.ts 的本地分支）。' },
  { kind: 'inlineCompletion', provider: 'inlineCompletionProvider', upstream: 'LspInlineCompletionFeature', surface: 'src/inlineCompletion.ts', fallback: 'local', detail: '退回本仓的基于补全的单行内联建议。' },
  { kind: 'codeLens', provider: 'codeLensProvider', upstream: 'LspCodeVisionFeature', surface: 'src/codeLens.ts', fallback: 'hide', detail: '行上方不出现 Code Vision（清空已有条目）。' },
  { kind: 'callHierarchy', kinds: ['prepareCallHierarchy', 'callHierarchyIncoming', 'callHierarchyOutgoing'],
    provider: 'callHierarchyProvider', upstream: 'LspCallHierarchyFeature', surface: 'src/hierarchyView.ts', fallback: 'notice', detail: 'Ctrl+Alt+H 打开层级面板并报「该语言服务未提供调用层次」。' },
  { kind: 'typeHierarchy', kinds: ['prepareTypeHierarchy', 'typeHierarchySupertypes', 'typeHierarchySubtypes'],
    provider: 'typeHierarchyProvider', upstream: 'LspTypeHierarchyFeature', surface: 'src/hierarchyView.ts', fallback: 'notice', detail: 'Ctrl+H 同上，提示「未提供类型层次」。' },
  { kind: 'willRenameFiles', provider: 'workspace.fileOperations.willRename', upstream: 'LspFileOperationFeature', surface: 'src/semanticActions.ts', fallback: 'local', detail: '移动文件时不做服务端的引用改写（本仓仍按本地文本规则搬文件，引用修复靠重命名/代码动作）。' },
  { kind: 'diagnostic', provider: 'diagnosticProvider', upstream: 'LspDiagnosticsFeature', surface: 'src/problems.ts', fallback: 'local', detail: '拉取式诊断不可用时保留 push 的 publishDiagnostics 与本地检查（src/junitInspections.ts）。' },
  { kind: 'workspaceDiagnostic', provider: 'diagnosticProvider.workspaceDiagnostics', upstream: 'LspDiagnosticsFeature.workspace', surface: 'src/workspaceDiagnostics.ts', fallback: 'local', detail: '整工程检查退回逐文件诊断（src/workspaceInspection.ts 的逐文件路径）。' },
]

const BY_KIND = new Map<string, LspFeatureRow>()
for (const row of LSP_FEATURES) {
  // 规范名（如 `callHierarchy`）本身也登记：拿特性名查降级处置时和拿请求 kind 一样有效。
  BY_KIND.set(row.kind, row)
  for (const kind of row.kinds ?? []) BY_KIND.set(kind, row)
}

/** 表里登记的全部 kind（前端请求的规范名集合）。 */
export function lspFeatureKinds(): string[] {
  return [...BY_KIND.keys()]
}

/** 查一行；没有登记时返回 null（调用方按「未知能力保持中性」处理）。 */
export function lspFeatureRow(kind: string): LspFeatureRow | null {
  return BY_KIND.get(kind) ?? null
}

/**
 * 服务端说「不支持这个特性」时给用户的说明；kind 没登记时给出中性说明。
 * `language` 是服务端语言 id（如 `java`/`typescript`），只用于文案。
 */
export function unsupportedFeatureMessage(kind: string, language = ''): string {
  const row = lspFeatureRow(kind)
  const who = language ? `${language} 语言服务` : '语言服务'
  if (!row) return `${who}不支持该操作。`
  const subject = row.upstream.replace(/^Lsp/, '').replace(/Feature.*$/, '')
  return `${who}未提供${subject}能力（${row.provider}）：${row.detail}`
}

/**
 * 该特性被拒绝后入口/呈现该怎么处置。未登记的 kind 按 `notice`（保留入口、给出说明），
 * 因为「默默隐藏一个没见过的能力」比提示更难排查。
 */
export function degradationForKind(kind: string): LspFeatureRow['fallback'] {
  return lspFeatureRow(kind)?.fallback ?? 'notice'
}

/** 本地回退是否仍算「功能可用」（`local` 档）—— 状态栏/菜单用它决定禁用态。 */
export function featureUsableWithoutServer(kind: string): boolean {
  return degradationForKind(kind) === 'local'
}
