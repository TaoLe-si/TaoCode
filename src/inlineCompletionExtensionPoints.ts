// **行内补全的扩展点**（上游 `platform/platform-impl/codeinsight-inline` 的
// `InlineCompletionProvider` / `InlineCompletionPartialAcceptHandler` /
// `InlineCompletionSuppressStateSupplier` 一族在本仓的等价物）。
//
// 上游是什么：行内补全那一族有三条 portable 的 EP，id 逐字取自各类的 `ExtensionPointName.create`：
//   · `com.intellij.inline.completion.provider` —— `InlineCompletionProvider.kt:121`，接口方法面
//     `val id: InlineCompletionProviderID`（`:54`）、`fun isEditorTypeSupported(editorType)`（`:70`）、
//     `suspend fun getSuggestion(request): InlineCompletionSuggestion`（`:82`）、
//     `fun isEnabled(event): Boolean`（`:94`）、`fun restartOn(event): Boolean`（`:103`，缺省假）；
//     静态入口 `Extensions.extensions()`（`:122`）返回全部贡献，`InlineCompletionHandler` 按注册序
//     取第一个 `isEnabled` 的（`InlineCompletionHandler.kt:365-379`）。
//   · `com.intellij.inline.completion.partial.accept.handler` ——
//     `suggestion/InlineCompletionPartialAcceptHandler.kt:35` 的 `EP`；方法面
//     `fun getTextLengthToReplace(suggestion, editor): Int` / `fun getTextRangeToReplace(...)`。
//   · `com.intellij.inline.completion.suppress.state.supplier` ——
//     `suppress/InlineCompletionSuppressStateSupplier.kt:19` 的 `EP_NAME`；方法面
//     `fun isSuppressed(editor): Boolean`（`:16`），静态入口 `isSuppressed` 是**任一为真即抑制**（`:21`）。
//
// 本仓此前：幽灵文本/接受区间/局部接受在 `src/inlineCompletion.ts`，多建议循环在
// `src/inlineCompletionNav.ts`，请求与节流**硬编在** `src/components/CodeEditor.vue` 的单条
// `lsp.request` —— **没有插件 EP 宿主**，判词 `pf/inline-completion` 一直挂着「没有插件 EP 宿主」
// 这一条。本文件补上那一层：
//   · 三条 EP 用 `src/extensionPoints.ts` 的 `EXTENSIONS.declareExtensionPoint()` 声明；
//   · 贡献形状 = 上游接口的**可移植子集**（本仓没有 `Editor`/`InlineCompletionRequest`/
//     `InlineCompletionSuggestion` 那些平台对象，换成 `InlineRequest`/`InlineProviderSuggestion`）；
//   · 本仓的 LSP `textDocument/inlineCompletion` 通道**作为一条 bundled 贡献**挂进去，使
//     `selectInlineProvider` 选出来的 provider 在 EP 里看得见、第三方挂的 provider 能排在它前面。
//
// 与上游的如实差异：① `getSuggestion` 是 `suspend` 的，本仓返回 `Promise`（同步/异步都兼容）；
// ② `InlineCompletionSuggestion` 只保留「插入文本 + 替换区间」两格（本仓
// `src/inlineCompletion.ts` 的 `InlineCompletionItem` 同源）；③ `isEditorTypeSupported` 收窄成
// 「支持的文件类型后缀集合」（本仓 `InlineCompletionEditorType` 只有主编辑器一档）。
//
// 纯数据层：不 import vue/DOM/bridge，便于单测。
//
// 判据：`tests/inline-completion-extension-points.test.mjs`。

import { APPLICATION_SCOPE, EXTENSIONS, type ExtensionHandle, type RegisterExtensionOptions } from './extensionPoints.ts'
import type { InlineCompletionItem } from './inlineCompletion.ts'

/** 三条 EP 的 id（逐字取自上游各自的 `ExtensionPointName.create`，见文件头逐行出处）。 */
export const INLINE_COMPLETION_PROVIDER_EP = 'com.intellij.inline.completion.provider'
export const INLINE_PARTIAL_ACCEPT_HANDLER_EP = 'com.intellij.inline.completion.partial.accept.handler'
export const INLINE_SUPPRESS_STATE_SUPPLIER_EP = 'com.intellij.inline.completion.suppress.state.supplier'

/**
 * 触发事件档（上游 `InlineCompletionEvent` 的 portable 子集）：
 * `automatic`（自动弹出，`INLINE_TRIGGER_KINDS.automatic`）、`explicit`（手动触发）、
 * `retrigger`（重触发）。与 `src/inlineCompletion.ts` 的 `INLINE_TRIGGER_KINDS` 同源。
 */
export type InlineTriggerReason = 'automatic' | 'explicit' | 'retrigger'

/** 一次请求（上游 `InlineCompletionRequest` 的可移植替代）。 */
export interface InlineRequest {
  /** 文件路径。 */
  path: string
  /** 语言 id（如 `typescript`）。 */
  language: string
  /** 光标行（0 基）。 */
  line: number
  /** 光标列（0 基）。 */
  character: number
  /** 触发原因。 */
  reason: InlineTriggerReason
  /** 当前行光标前的文本（本仓宿主直接给，上游从 `Editor` 取）。 */
  textBeforeCaret: string
}

/** 一条建议（上游 `InlineCompletionSuggestion` 的可移植子集，与本仓 `InlineCompletionItem` 同源）。 */
export interface InlineSuggestion {
  /** 要插入的文本。 */
  insertText: string
  /** 插入位置（本仓沿用 LSP 的行/列；缺省 = 请求里的光标位置）。 */
  line?: number
  character?: number
}

/** provider 的展示面（上游 `InlineCompletionProviderPresentation` 的最小子集）。 */
export interface InlineProviderPresentation {
  /** 展示名（上游 `getTooltip`；本仓供操作条显示）。 */
  tooltip?: string
}

/** 上游 `InlineCompletionProviderID`（`:133` 的 value class）。 */
export interface InlineProviderId {
  id: string
}

/**
 * 上游 `InlineCompletionProvider`（`InlineCompletionProvider.kt:44-121`）的可移植子集。
 * `getSuggestion` 上游是 `suspend`，本仓返回 `Promise`（也接受同步实现 —— 由 `selectInlineProvider`
 * 统一 `await`）。
 */
export interface InlineCompletionProvider {
  id: InlineProviderId
  presentation?: InlineProviderPresentation
  /** 支持的文件后缀（空/缺省 = 任何主编辑器都支持，照上游 `isEditorTypeSupported` 的缺省档）。 */
  supportedExtensions?: readonly string[]
  /** 这一档在当前事件下启用吗（上游 `isEnabled(event)`，`:94`）。 */
  isEnabled: (request: InlineRequest) => boolean
  /** 该不该在事件后重触发（上游 `restartOn(event)`，`:103`，缺省假）。 */
  restartOn?: (request: InlineRequest) => boolean
  /** 取建议（上游 `suspend getSuggestion(request)`，`:82`）；没建议返回 null。 */
  getSuggestion: (request: InlineRequest) => Promise<InlineSuggestion | null> | InlineSuggestion | null
}

/** 上游 `InlineCompletionPartialAcceptHandler`（`InlineCompletionPartialAcceptHandler.kt:35`）的可移植子集。 */
export interface InlinePartialAcceptHandler {
  id: string
  /** 部分接受要替换掉多长（上游 `getTextLengthToReplace`）。 */
  getTextLengthToReplace: (suggestion: InlineSuggestion, request: InlineRequest) => number
  /** 是不是这一档接手（缺省接手；上游按 `isApplicable`）。 */
  isApplicable?: (suggestion: InlineSuggestion, request: InlineRequest) => boolean
}

/** 上游 `InlineCompletionSuppressStateSupplier`（`InlineCompletionSuppressStateSupplier.kt:9-21`）的可移植子集。 */
export interface InlineSuppressStateSupplier {
  id: string
  /** 当前是不是抑制行内补全（上游 `isSuppressed(editor)`；任一为真即抑制）。 */
  isSuppressed: (request: InlineRequest) => boolean
}

/** 三条 EP 的声明（幂等）。 */
export function declareInlineCompletionExtensionPoints(): void {
  EXTENSIONS.declareExtensionPoint({ id: INLINE_COMPLETION_PROVIDER_EP, name: '行内补全提供方', scope: APPLICATION_SCOPE, dynamic: true })
  EXTENSIONS.declareExtensionPoint({ id: INLINE_PARTIAL_ACCEPT_HANDLER_EP, name: '行内部分接受处理器', scope: APPLICATION_SCOPE, dynamic: true })
  EXTENSIONS.declareExtensionPoint({ id: INLINE_SUPPRESS_STATE_SUPPLIER_EP, name: '行内补全抑制状态提供方', scope: APPLICATION_SCOPE, dynamic: true })
}

declareInlineCompletionExtensionPoints()

function register<T extends { id: string | InlineProviderId }>(ep: string, identity: string, value: T, options: RegisterExtensionOptions): ExtensionHandle {
  return EXTENSIONS.registerExtension(ep, identity, value, options)
}

export function registerInlineCompletionProvider(value: InlineCompletionProvider, options: RegisterExtensionOptions = {}): ExtensionHandle {
  return register(INLINE_COMPLETION_PROVIDER_EP, value.id.id, value, options)
}
export function registerInlinePartialAcceptHandler(value: InlinePartialAcceptHandler, options: RegisterExtensionOptions = {}): ExtensionHandle {
  return register(INLINE_PARTIAL_ACCEPT_HANDLER_EP, value.id, value, options)
}
export function registerInlineSuppressStateSupplier(value: InlineSuppressStateSupplier, options: RegisterExtensionOptions = {}): ExtensionHandle {
  return register(INLINE_SUPPRESS_STATE_SUPPLIER_EP, value.id, value, options)
}

/** 全部行内补全 provider（上游 `InlineCompletionProvider.Extensions.extensions()` 的等价物）。 */
export function inlineCompletionProviders(scope: string = APPLICATION_SCOPE): InlineCompletionProvider[] {
  return EXTENSIONS.extensionsOf<InlineCompletionProvider>(INLINE_COMPLETION_PROVIDER_EP, scope)
}

/** provider 支持该文件吗（`supportedExtensions` 空/缺省 = 支持）。 */
function supportsFile(provider: InlineCompletionProvider, path: string): boolean {
  const list = provider.supportedExtensions
  if (!list || list.length === 0) return true
  const lower = path.toLowerCase()
  return list.some(extension => lower.endsWith(extension.toLowerCase()))
}

/**
 * 选中的 provider（上游 `InlineCompletionHandler.getProvider` 的等价物：按注册序取第一个
 * `isEnabled` 且在编辑器类型里受支持的）。返回 null = 没有 provider 接手。
 */
export function selectInlineProvider(request: InlineRequest, scope: string = APPLICATION_SCOPE): InlineCompletionProvider | null {
  for (const provider of inlineCompletionProviders(scope)) {
    if (!supportsFile(provider, request.path)) continue
    if (!provider.isEnabled(request)) continue
    return provider
  }
  return null
}

/** 取建议（对选中 provider 求值；provider 返回 Promise 也兼容）。 */
export async function inlineSuggestionFor(request: InlineRequest, scope: string = APPLICATION_SCOPE): Promise<InlineSuggestion | null> {
  const provider = selectInlineProvider(request, scope)
  if (!provider) return null
  return await provider.getSuggestion(request)
}

/** 事件后该不该重触发（上游 `restartOn`，缺省假）。 */
export function inlineShouldRestart(request: InlineRequest, scope: string = APPLICATION_SCOPE): boolean {
  const provider = selectInlineProvider(request, scope)
  return provider?.restartOn ? provider.restartOn(request) : false
}

/** 当前是不是抑制状态（上游任一为真即抑制，`InlineCompletionSuppressStateSupplier.kt:21`）。 */
export function inlineSuppressed(request: InlineRequest, scope: string = APPLICATION_SCOPE): boolean {
  for (const supplier of EXTENSIONS.extensionsOf<InlineSuppressStateSupplier>(INLINE_SUPPRESS_STATE_SUPPLIER_EP, scope)) {
    if (supplier.isSuppressed(request)) return true
  }
  return false
}

/**
 * 部分接受要替换的长度（取第一个 applicable 的处理器；没有处理器时退回整条建议文本长度，
 * 与 `src/inlineCompletion.ts` 的 `inlinePartialAcceptLength` 语义互补）。
 */
export function inlinePartialAcceptLengthFor(
  suggestion: InlineSuggestion, request: InlineRequest, scope: string = APPLICATION_SCOPE,
): number {
  for (const handler of EXTENSIONS.extensionsOf<InlinePartialAcceptHandler>(INLINE_PARTIAL_ACCEPT_HANDLER_EP, scope)) {
    if (handler.isApplicable && !handler.isApplicable(suggestion, request)) continue
    return handler.getTextLengthToReplace(suggestion, request)
  }
  return suggestion.insertText.length
}

/* ── bundled：本仓的 LSP 行内补全通道作为一条贡献 ───────────────────────────────── */

export const LSP_INLINE_PROVIDER_ID = 'lsp.inlineCompletion'

/**
 * 本仓 LSP `textDocument/inlineCompletion` 通道的 EP 化：`getSuggestion` 由宿主注入的
 * `request` 回调承担（宿主是 `src/components/CodeEditor.vue` 的 `lsp.request`）。
 *
 * 上游那一条是 `RemDevAggregatorInlineCompletionProvider`/`LspInlineCompletionProvider` 一类的等价物；
 * 本仓只有 LSP 一条供给，所以 `isEnabled` 恒真（请求可发即启用），由宿主在拿到应答后决定要不要显示。
 */
export function lspInlineCompletionProvider(
  requestSuggestions: (request: InlineRequest) => Promise<InlineSuggestion | null> | InlineSuggestion | null,
  supportedExtensions?: readonly string[],
): InlineCompletionProvider {
  return {
    id: { id: LSP_INLINE_PROVIDER_ID },
    presentation: { tooltip: '语言服务行内补全' },
    ...(supportedExtensions ? { supportedExtensions } : {}),
    isEnabled: () => true,
    getSuggestion: request => requestSuggestions(request),
  }
}

/**
 * 把 LSP 那条按 bundled 贡献挂进 EP（返回注销函数）。宿主在拿到请求回调之后调一次即可；
 * 重复调用只覆盖同 id 的旧贡献。
 */
export function registerLspInlineCompletionProvider(
  requestSuggestions: (request: InlineRequest) => Promise<InlineSuggestion | null> | InlineSuggestion | null,
  supportedExtensions?: readonly string[],
): () => void {
  const handle = registerInlineCompletionProvider(
    lspInlineCompletionProvider(requestSuggestions, supportedExtensions), { source: 'bundled' },
  )
  return () => handle.dispose()
}

/** 把一条建议折成本仓的 `InlineCompletionItem`（幽灵文本层的输入）。 */
export function inlineItemOf(suggestion: InlineSuggestion, request: InlineRequest): InlineCompletionItem {
  const line = suggestion.line ?? request.line
  const character = suggestion.character ?? request.character
  return {
    insertText: suggestion.insertText,
    range: { startLine: line, startChar: character, endLine: line, endChar: character },
  }
}
