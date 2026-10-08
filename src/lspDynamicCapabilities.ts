// 服务器**动态注册**上来的能力（`client/registerCapability`）在本仓的规则层 —— 上游
// `platform/lsp-impl/src/impl/LspDynamicCapabilities.kt` 的可移植那一半。
//
// 上游那一层的两件事：
//   · `:110-127` 的 `registerCapability` / `unregisterCapability` 按 `method` 分族存
//     `CapabilityInfo(id, registerOptions, lsp4jOptions)`；`:126-130` 的注销按 id 摘。
//   · `:139-145` 的 `hasCapability(method)` 与 `:155-160` 的 `getCapabilityRegistrationOptions`。
//     真正决定「这个文件归这条注册管」的是 `LspClientImpl.kt:638-655` 的
//     `documentSelectorMatches(file)`：`documentSelector == null` ⇒ **匹配任何文件**（`:640`）；
//     否则逐 filter（`scheme` 非空且不是 `file` ⇒ 跳过；`language` 与 `pattern` 都空 ⇒ 跳过；
//     `language` 必须等于该文件的 languageId；`pattern` 走 `globMatcher.pathMatches`；
//     两条都命中 ⇒ true）。
//
// 本仓的分工（与 `src/lspServerMessages.ts` 那张 `lspDynamicRegistrations` 表接起来）：
//   · 宿主已经把 `registrations` 原样转出来了（`native/lsp_host_bootstrap.cpp:113-121`），
//     所以 `registerOptions`（含 `documentSelector`）在前端**拿得到**；
//   · `src/lspServerMessages.ts` 记 `{id, method, language, since}` 那张表负责**账**（注销、停机作废）；
//     本模块负责**规则**（这条注册管不管这个文件），供 `src/lspPerFileCapabilities.ts` 的文件级闸使用。
//
// 本模块是纯函数、零运行时 import（`node --test` 可直接驱动）。

import { globMatches } from './lspGlobMatcher.ts'

/** 协议的一个 document filter（`TextDocumentFilter` 的三字段形态；本仓只认这三条）。 */
export interface LspDocumentFilter {
  language?: string
  scheme?: string
  pattern?: string
}

/** 一条动态注册的规则面（`src/lspServerMessages.ts` 的 `LspDynamicRegistration` 之外的那一半）。 */
export interface LspRegistrationRule {
  id: string
  method: string
  /** `registerOptions.documentSelector`；`null`/缺省 = 匹配任何文件（`LspClientImpl.kt:640`）。 */
  documentSelector?: readonly LspDocumentFilter[] | null
}

/** 形状校验：`documentSelector` 只认对象数组，逐条只留三个字符串字段。 */
export function lspDocumentSelectorsOf(value: unknown): LspDocumentFilter[] | null {
  if (!Array.isArray(value)) return null
  const filters: LspDocumentFilter[] = []
  for (const raw of value) {
    if (!raw || typeof raw !== 'object') continue
    const filter: LspDocumentFilter = {}
    for (const key of ['language', 'scheme', 'pattern'] as const) {
      const field = (raw as Record<string, unknown>)[key]
      if (typeof field === 'string') filter[key] = field
    }
    filters.push(filter)
  }
  return filters
}

/**
 * `LspClientImpl.kt:638-655` 的 `documentSelectorMatches` 的等价物。
 * `path` 按 `/` 归一；`languageId` 是宿主 `Session::language_for` 的那一套
 * （由 `src/lspPerFileCapabilities.ts` 的 `lspLanguageOfPath` 提供）。
 */
export function documentSelectorMatches(
  selector: readonly LspDocumentFilter[] | null | undefined,
  path: string,
  languageId: string,
): boolean {
  if (selector === null || selector === undefined) return true   // `:640`：没有 selector = 匹配任何文件
  for (const filter of selector) {
    if (filter.scheme !== undefined && filter.scheme !== 'file') continue
    if (filter.language === undefined && filter.pattern === undefined) continue
    if (filter.language !== undefined && filter.language !== languageId) continue
    if (filter.pattern !== undefined && !globMatches(path, filter.pattern)) continue
    return true
  }
  return false
}

/**
 * 这条能力有没有**命中这个文件**的动态注册（上游
 * `LspClientImpl.hasDynamicCapabilityToHandleThisFile:612-615` → `getDynamicCapabilityOptionsForFile`）。
 *
 * 语义与上游一致：`hasCapability(method)` 只说「服务器注册过这个方法」，
 * 「管不管这个文件」还要过 documentSelector —— 这两条**不能混**（`ls/platform` 判词里那条）。
 */
export function dynamicCapabilityHandlesFile(
  rules: readonly LspRegistrationRule[],
  method: string,
  path: string,
  languageId: string,
): boolean {
  for (const rule of rules) {
    if (rule.method !== method) continue
    if (documentSelectorMatches(rule.documentSelector, path, languageId)) return true
  }
  return false
}

/**
 * 从宿主原样转出来的 `registrations` 里抽出规则面。
 * 与 `src/lspServerMessages.ts:286-296` 的 `lspRegistrationEntries` 同源但多取
 * `registerOptions.documentSelector`（形状不对的条目按「没有 selector」= 匹配任何文件，
 * 因为协议里 `registerOptions` 可缺省）。
 */
export function lspRegistrationRules(value: unknown): LspRegistrationRule[] {
  if (!Array.isArray(value)) return []
  const rules: LspRegistrationRule[] = []
  for (const raw of value) {
    if (!raw || typeof raw !== 'object') continue
    const id = (raw as { id?: unknown }).id
    const method = (raw as { method?: unknown }).method
    if (typeof id !== 'string' || typeof method !== 'string') continue
    const options = (raw as { registerOptions?: unknown }).registerOptions
    const selector = options && typeof options === 'object'
      ? lspDocumentSelectorsOf((options as { documentSelector?: unknown }).documentSelector)
      : null
    rules.push({ id, method, documentSelector: selector })
  }
  return rules
}

/**
 * 本仓会动到缓存的那一族方法（与 `src/lspServerMessages.ts:308-318` 的
 * `LSP_CACHE_AFFECTING_REGISTRATIONS` 同源）。这张表在这里再列一次是为了让
 * 「按方法查规则」有一个闭集，而不是散落的字符串。
 */
export const LSP_DYNAMIC_METHODS = {
  didChangeWatchedFiles: 'workspace/didChangeWatchedFiles',
  codeAction: 'textDocument/codeAction',
  codeLens: 'textDocument/codeLens',
  completion: 'textDocument/completion',
  definition: 'textDocument/definition',
  documentHighlight: 'textDocument/documentHighlight',
  documentLink: 'textDocument/documentLink',
  documentSymbol: 'textDocument/documentSymbol',
  foldingRange: 'textDocument/foldingRange',
  formatting: 'textDocument/formatting',
  hover: 'textDocument/hover',
  inlayHint: 'textDocument/inlayHint',
  references: 'textDocument/references',
  rename: 'textDocument/rename',
  semanticTokens: 'textDocument/semanticTokens',
  signatureHelp: 'textDocument/signatureHelp',
  diagnostic: 'textDocument/diagnostic',
  workspaceSymbol: 'workspace/symbol',
  executeCommand: 'workspace/executeCommand',
} as const

/**
 * 前端能发的 LSP kind（`src/bridge.ts` 的 `LspRequestKind`）→ 动态注册的 method。
 * 只有两边名字不同的那些要列；同名的一律按同名查（`inlayHint` → `textDocument/inlayHint` 的
 * 常规拼法由 `registrationMethodFor` 兜底）。`diagnostic` 是 pull 的 method（不是
 * `textDocument/publishDiagnostics`），与 `src/lspServerMessages.ts:312` 一致。
 */
const KIND_TO_METHOD: Readonly<Record<string, string>> = {
  diagnostic: 'textDocument/diagnostic',
  workspaceDiagnostic: 'workspace/diagnostic',
  workspaceSymbol: 'workspace/symbol',
  executeCommand: 'workspace/executeCommand',
  codeLens: 'textDocument/codeLens',
  semanticTokens: 'textDocument/semanticTokens',
  inlayHint: 'textDocument/inlayHint',
  documentHighlight: 'textDocument/documentHighlight',
  documentLink: 'textDocument/documentLink',
  documentSymbol: 'textDocument/documentSymbol',
  foldingRange: 'textDocument/foldingRange',
  completion: 'textDocument/completion',
  completionItemResolve: 'textDocument/completion',
  hover: 'textDocument/hover',
  definition: 'textDocument/definition',
  typeDefinition: 'textDocument/typeDefinition',
  implementation: 'textDocument/implementation',
  references: 'textDocument/references',
  rename: 'textDocument/rename',
  prepareRename: 'textDocument/rename',
  formatting: 'textDocument/formatting',
  rangeFormatting: 'textDocument/rangeFormatting',
  codeAction: 'textDocument/codeAction',
  codeActionResolve: 'textDocument/codeAction',
  signatureHelp: 'textDocument/signatureHelp',
  prepareCallHierarchy: 'textDocument/prepareCallHierarchy',
  callHierarchyIncoming: 'textDocument/prepareCallHierarchy',
  callHierarchyOutgoing: 'textDocument/prepareCallHierarchy',
  prepareTypeHierarchy: 'textDocument/prepareTypeHierarchy',
  typeHierarchySupertypes: 'textDocument/prepareTypeHierarchy',
  typeHierarchySubtypes: 'textDocument/prepareTypeHierarchy',
  inlineCompletion: 'textDocument/inlineCompletion',
  selectionRange: 'textDocument/selectionRange',
  willRenameFiles: 'workspace/willRenameFiles',
}

/** 本仓 kind → 动态注册 method；认不出的按 `textDocument/<kind>` 兜底（协议常规拼法）。 */
export function registrationMethodFor(kind: string): string {
  return KIND_TO_METHOD[kind] ?? `textDocument/${kind}`
}

// ── 规则登记表（生产写入方 = `src/lspServerMessages.ts` 的注册处置器）─────────────────────────
//
// 为什么放在这个纯模块里而不是 `src/lspServerMessages.ts` 的 reactive 表里：
// 那张表是**账**（id → {language, since}，注销/停机要按 id 摘），这张表是**规则**（method →
// documentSelector），消费者是 `src/lspPerFileCapabilities.ts` 的文件级闸。放在这里
// 让它保持零运行时 import（`vue` 只在账那一侧），`node --test` 可直接驱动。
let rules: readonly LspRegistrationRule[] = []

/** 整批替换规则（服务器每发一次 `client/registerCapability` 就重算一次整表）。 */
export function setDynamicCapabilityRules(next: readonly LspRegistrationRule[]): void {
  rules = next.map(rule => ({ ...rule }))
}

/** 停机/换工程：整表清空（对应上游「客户端对象换新，`LspDynamicCapabilities` 跟着没了」）。 */
export function clearDynamicCapabilityRules(): void { rules = [] }

export function dynamicCapabilityRules(): readonly LspRegistrationRule[] { return rules }

/**
 * 按 kind 问「有没有命中这个文件的动态注册」—— 上游
 * `LspClientImpl.supportsX(file) = serverCapabilities?.X != null || hasDynamicCapabilityToHandleThisFile(file, …)`
 * 里那个**右支**。静态那一支本仓在宿主侧判（`native/lsp_capability_queries.cpp:95-106`：
 * provider 键**缺失**时不拒绝，只有显式 `false`/`null` 才回 `LSP_UNSUPPORTED`），
 * 所以这里只补动态这一支，两者是**或**的关系。
 */
export function dynamicRegistrationCovers(kind: string, path: string, languageId: string): boolean {
  return dynamicCapabilityHandlesFile(rules, registrationMethodFor(kind), path, languageId)
}