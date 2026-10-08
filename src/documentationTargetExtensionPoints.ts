// **文档目标一族（第二批）的扩展点宿主接线** —— `DocumentationTargetProvider` 一族的其余四条：
// `PsiDocumentationTargetProvider` / `SymbolDocumentationTargetProvider` /
// `LookupElementDocumentationTargetProvider` / `DocumentationLinkHandler`。
// （第一条 `com.intellij.platform.backend.documentation.targetProvider` 已由
// `src/documentationExtensionPoints.ts` 声明并消费，见那里的文件头。）
//
// 上游依据（qualifiedName 逐字取自 `platform/lang-impl/resources/intellij.platform.lang.impl.xml`
// 的 `<extensionPoint>` 声明，接口名与 `ExtensionPointName.create` 的串都在下面逐条给出）：
//   · `com.intellij.platform.backend.documentation.psiTargetProvider` —— 同上文件 `:347-348`
//     （`interface="com.intellij.platform.backend.documentation.PsiDocumentationTargetProvider"`）；
//     接口 `platform/lang-impl/src/com/intellij/platform/backend/documentation/PsiDocumentationTargetProvider.java:25`
//     （`EP_NAME` 在 `:26-28`）；方法面 `documentationTarget(element, originalElement)`（`:37`，
//     缺省抛 `IllegalStateException` —— 实现方至少覆写它或下一个）与
//     `documentationTargets(element, originalElement)`（返回列表，**顺序即弹层/工具窗里的顺序**）。
//     消费点（上游）：`IdeDocumentationTargetProviderImpl.kt:64-71` 把各 provider 的 targets 收集起来。
//   · `com.intellij.platform.backend.documentation.symbolTargetProvider` —— 同文件 `:345-346`
//     （`interface="…SymbolDocumentationTargetProvider"`）；接口
//     `…/SymbolDocumentationTargetProvider.java:34`（`EP_NAME` 在 `:36-38`）；方法面
//     `documentationTarget(symbol)`（`:45` 附近，`@Nullable`）。消费点（上游）：
//     `DefaultTargetSymbolDocumentationTargetProvider.kt:35-38` —— 逐个 provider 问 symbol 的 target。
//   · `com.intellij.platform.backend.documentation.lookupElementTargetProvider` —— 同文件 `:349-350`
//     （`interface="…LookupElementDocumentationTargetProvider"`）；接口
//     `…/LookupElementDocumentationTargetProvider.java:25`（`EP_NAME` 在 `:28-30`）；方法面
//     `documentationTarget(psiFile, element, offset)`（`:43`，`@Nullable`）。接口注释写明
//     **这类 provider 给的文档优先于 PSI 那条**（`:20-22`）。消费点（上游）：
//     `IdeDocumentationTargetProviderImpl.kt:48` 在 lookup 里按 `LookupElementDocumentationTargetProvider.EP_NAME`
//     逐个问。
//   · `com.intellij.platform.backend.documentation.linkHandler` —— 同文件 `:353-354`
//     （`interface="…DocumentationLinkHandler"`）；接口
//     `…/DocumentationLinkHandler.java:17`（`EP_NAME` 在 `:21-23`）；方法面
//     `resolveLink(target, url)`（`:33`，缺省 null —— 解不出/不适用）与
//     `contentUpdater(target, url)`（`:44`，缺省 null）。消费点（上游）：文档浏览器点链接时
//     先问这一族，解出来就换成那个 target（`DocumentationBrowser` 的链接激活路径）。
//
// 本仓此前：这一族的等价物**只有一条** —— `src/documentationExtensionPoints.ts` 的
// `DocumentationTargetProvider`（按「文件 + 光标位置」问）。本文件补上其余四条，并把消费点接在
// 真实调用链上（每条的消费点写在各自的 consume 函数注释里）：
//   · `psiDocumentationTargets` / `symbolDocumentationTargets` → `documentationTargetsFor`
//     （`src/documentationExtensionPoints.ts`，弹层 `src/quickDocHost.ts` 取文档时问）；
//   · `documentationTargetForSymbol` → `src/quickDocHost.ts` 的 `showSymbolDoc`
//     （点 `{@link Foo}` 时先问登记表，解不出才落到 LSP 解析 —— 上游那条「symbol → target」链）；
//   · `documentationTargetForLookupElement` → `src/lspCompletion.ts` 的候选文档面板
//     （上游注释：这类 provider 优先于 PSI 那条）；
//   · `resolveDocumentationLinkTarget` → `src/quickDocHost.ts` 的 `followInternalDocLink`
//     （点链接先问 linkHandler，解不出才走本仓既有的两条通道）。
//
// 与上游的如实差异：① 本仓没有 `PsiElement`/`Symbol`/`LookupElement`，三种载具都收成
// 「文档要素输入」（路径 + 语言 + 文本 + 行列）+ 各自的补充字段（`symbol` 名字 / 候选条目的
// label+detail+kind）；② `DocumentationTarget` 的 `computeDocumentation()` 是**异步的**
// （要发 LSP 请求取 hover），所以本仓的目标形状是「位置 + `computeDocumentation`（可同步给串）」
// —— 与 `src/documentationExtensionPoints.ts` 既有的 `DocumentationTargetLike` 同一形状，直接复用，
// 免得两种 target 在弹层里打架；③ `contentUpdater` 与 `LinkResolveResult`（本仓没有内容流式更新
// 那一层）不落：`resolveLink` 只取「解出来的 target 位置」这一格，其余字段登记在报告里。
//
// 纯数据层：只 import `src/extensionPoints.ts` 与（**仅类型**）`src/documentationExtensionPoints.ts`，
// 不 import vue/DOM/bridge，便于 `node --test` 直测。
//
// 判据：`tests/documentation-target-extension-points.test.mjs`。

import { APPLICATION_SCOPE, EXTENSIONS, type ExtensionHandle, type RegisterExtensionOptions } from './extensionPoints.ts'
import type { DocElementInput, DocumentationTargetLike } from './documentationExtensionPoints.ts'

/** 四条 EP 的 id（逐字取自上游 qualifiedName，见文件头逐条出处）。 */
export const PSI_TARGET_PROVIDER_EP = 'com.intellij.platform.backend.documentation.psiTargetProvider'
export const SYMBOL_TARGET_PROVIDER_EP = 'com.intellij.platform.backend.documentation.symbolTargetProvider'
export const LOOKUP_ELEMENT_TARGET_PROVIDER_EP = 'com.intellij.platform.backend.documentation.lookupElementTargetProvider'
export const LINK_HANDLER_EP = 'com.intellij.platform.backend.documentation.linkHandler'

function acceptsLanguage(contribution: { languages?: readonly string[] }, language: string): boolean {
  const list = contribution.languages
  if (!list || list.length === 0) return true
  if (!language || language === 'other') return true
  return list.includes(language)
}

// ── ① `PsiDocumentationTargetProvider`（`…psiTargetProvider`） ────────────────────────────────

/** 一条 PSI 目标提供方（方法名与上游逐字相同）。`originalElement` 在本仓就是同一份输入。 */
export interface PsiDocumentationTargetProviderContribution {
  id: string
  languages?: readonly string[]
  /** `documentationTarget(element, originalElement)`（缺省 = 不认这个元素）。 */
  documentationTarget?: (element: DocElementInput) => DocumentationTargetLike | null
  /** `documentationTargets(element, originalElement)`（缺省 = 空表；顺序即弹层里的顺序）。 */
  documentationTargets?: (element: DocElementInput) => readonly DocumentationTargetLike[]
}

/** `PsiDocumentationTargetProvider.EP_NAME.getExtensionList()` 的等价物（按语言过滤）。 */
export function psiDocumentationTargetProviders(
  language: string, scope: string = APPLICATION_SCOPE,
): PsiDocumentationTargetProviderContribution[] {
  return EXTENSIONS.extensionsOf<PsiDocumentationTargetProviderContribution>(PSI_TARGET_PROVIDER_EP, scope)
    .filter(contribution => acceptsLanguage(contribution, language))
}

/**
 * `IdeDocumentationTargetProviderImpl.kt:64-71` 收集 PSI targets 的等价物：
 * 逐个 provider 先问 `documentationTarget`（非 null 就收这一条、并且按上游 `:37` 的契约
 * **不再问它的** `documentationTargets`），再问 `documentationTargets` 把列表接上。
 * 消费点：`src/documentationExtensionPoints.ts` 的 `documentationTargetsFor`。
 */
export function psiDocumentationTargets(
  element: DocElementInput, scope: string = APPLICATION_SCOPE,
): DocumentationTargetLike[] {
  const out: DocumentationTargetLike[] = []
  for (const provider of psiDocumentationTargetProviders(element.language, scope)) {
    if (typeof provider.documentationTarget === 'function') {
      let single: DocumentationTargetLike | null = null
      try { single = provider.documentationTarget(element) } catch { single = null }
      if (single) { out.push(single); continue }
    }
    if (typeof provider.documentationTargets !== 'function') continue
    try { out.push(...provider.documentationTargets(element)) } catch { /* 坏 provider 跳过。 */ }
  }
  return out
}

// ── ② `SymbolDocumentationTargetProvider`（`…symbolTargetProvider`） ──────────────────────────

/** 问「这个名字的文档目标」的输入（上游 `Symbol` 的可移植替代）。 */
export interface SymbolTargetInput extends DocElementInput {
  /** 符号名（上游 `Symbol.getName()`），例如 `{@link Foo#bar(int)}` 点出来的 `Foo#bar(int)`。 */
  symbol: string
  /** 解析这个符号时所在的文件（上游 provider 手里那个 `PsiFile`）。 */
  originPath?: string
}

/** 一条符号目标提供方（方法名与上游逐字相同）。 */
export interface SymbolDocumentationTargetProviderContribution {
  id: string
  languages?: readonly string[]
  /** `documentationTarget(symbol)`（`@Nullable`）。 */
  documentationTarget: (input: SymbolTargetInput) => DocumentationTargetLike | null
}

/** `SymbolDocumentationTargetProvider.EP_NAME.getExtensionList()` 的等价物（按语言过滤）。 */
export function symbolDocumentationTargetProviders(
  language: string, scope: string = APPLICATION_SCOPE,
): SymbolDocumentationTargetProviderContribution[] {
  return EXTENSIONS.extensionsOf<SymbolDocumentationTargetProviderContribution>(SYMBOL_TARGET_PROVIDER_EP, scope)
    .filter(contribution => acceptsLanguage(contribution, language))
}

/**
 * `DefaultTargetSymbolDocumentationTargetProvider.kt:35-38` 那个循环的等价物：**第一个**给出非 null
 * 目标的 provider 说了算（上游 `for (ext in …extensionList)` 里第一条非空即返回）。
 * 消费点：`src/quickDocHost.ts` 的 `showSymbolDoc`（点 `{@link Foo}` 时先问登记表）。
 */
export function documentationTargetForSymbol(
  input: SymbolTargetInput, scope: string = APPLICATION_SCOPE,
): DocumentationTargetLike | null {
  for (const provider of symbolDocumentationTargetProviders(input.language, scope)) {
    try {
      const target = provider.documentationTarget(input)
      if (target) return target
    } catch { /* 坏 provider 跳过。 */ }
  }
  return null
}

// ── ③ `LookupElementDocumentationTargetProvider`（`…lookupElementTargetProvider`） ────────────

/** 问「这个补全条目的文档目标」的输入（上游 `(PsiFile, LookupElement, int offset)` 的可移植替代）。 */
export interface LookupElementTargetInput extends DocElementInput {
  /** 候选条目的显示文本（上游 `LookupElement.getLookupString()`）。 */
  lookupString: string
  /** 条目的类型档（上游 `LookupElement` 的 `LookupElementPresentation` 里那一格）。 */
  itemKind?: string
  /** 右侧灰字（detail / tail text）。 */
  detail?: string
}

/** 一条候选条目目标提供方（方法名与上游逐字相同）。 */
export interface LookupElementDocumentationTargetProviderContribution {
  id: string
  languages?: readonly string[]
  /** `documentationTarget(psiFile, element, offset)`（`@Nullable`）。 */
  documentationTarget: (input: LookupElementTargetInput) => DocumentationTargetLike | null
}

/** `LookupElementDocumentationTargetProvider.EP_NAME.getExtensionList()` 的等价物（按语言过滤）。 */
export function lookupElementDocumentationTargetProviders(
  language: string, scope: string = APPLICATION_SCOPE,
): LookupElementDocumentationTargetProviderContribution[] {
  return EXTENSIONS.extensionsOf<LookupElementDocumentationTargetProviderContribution>(LOOKUP_ELEMENT_TARGET_PROVIDER_EP, scope)
    .filter(contribution => acceptsLanguage(contribution, language))
}

/**
 * `IdeDocumentationTargetProviderImpl.kt:48` 那个循环的等价物：**第一个**给出非 null 目标的
 * provider 说了算（接口注释 `LookupElementDocumentationTargetProvider.java:20-22` 写明
 * 「这类 provider 给的文档**优先于** PSI 那条」）。
 * 消费点：`src/lspCompletion.ts` 的候选文档面板（`info` 回调里先问这一族）。
 */
export function documentationTargetForLookupElement(
  input: LookupElementTargetInput, scope: string = APPLICATION_SCOPE,
): DocumentationTargetLike | null {
  for (const provider of lookupElementDocumentationTargetProviders(input.language, scope)) {
    try {
      const target = provider.documentationTarget(input)
      if (target) return target
    } catch { /* 坏 provider 跳过。 */ }
  }
  return null
}

// ── ④ `DocumentationLinkHandler`（`…linkHandler`） ──────────────────────────────────────────

/** 问「这条文档链接指向哪里」的输入（上游 `(DocumentationTarget target, String url)`）。 */
export interface DocumentationLinkInput {
  /** 链接的 url（`DocLink.target`：相对路径 / `file:` / 符号名 / 任意 scheme）。 */
  url: string
  /** 当前这一页属于哪个文件（上游 `DocumentationTarget` 的宿主文件）。 */
  path: string
  /** 当前这一页在文档里的位置（0 基）。 */
  line: number
  character: number
  /** 语言 id（未知留空）。 */
  language: string
}

/** 解出来的目标（上游 `LinkResolveResult` 里本仓能兑现的那一格：位置）。 */
export interface ResolvedDocumentationLink {
  /** 工作区相对路径（或绝对路径 —— 由消费方按本仓口径归一）。 */
  path: string
  /** 0 基行号。 */
  line: number
  /** 0 基列号。 */
  character: number
  /** 解出它的贡献 id（诊断用）。 */
  handlerId: string
  /** 可选：这个目标自己的文档正文（给了就不必再去语言服务取 hover）。 */
  documentation?: string
}

/** 一条链接处理器（方法名与上游逐字相同）。 */
export interface DocumentationLinkHandlerContribution {
  id: string
  languages?: readonly string[]
  /** `resolveLink(target, url)` —— 非 null = 这条 url 归它解。 */
  resolveLink?: (input: DocumentationLinkInput) => ResolvedDocumentationLink | null
}

/** `DocumentationLinkHandler.EP_NAME.getExtensionList()` 的等价物（按语言过滤）。 */
export function documentationLinkHandlers(
  language: string, scope: string = APPLICATION_SCOPE,
): DocumentationLinkHandlerContribution[] {
  return EXTENSIONS.extensionsOf<DocumentationLinkHandlerContribution>(LINK_HANDLER_EP, scope)
    .filter(contribution => acceptsLanguage(contribution, language))
}

/**
 * 文档浏览器点一条链接时**先**问的那一遍：**第一个**解出目标的 handler 说了算。
 * 解不出返回 null ⇒ 调用方走本仓既有的两条通道（符号引用 → `resolveDocSymbolTarget`；
 * 带路径链接 → `revealLocation`）。
 * 消费点：`src/quickDocHost.ts` 的 `followInternalDocLink`。
 */
export function resolveDocumentationLinkTarget(
  input: DocumentationLinkInput, scope: string = APPLICATION_SCOPE,
): ResolvedDocumentationLink | null {
  for (const handler of documentationLinkHandlers(input.language, scope)) {
    if (typeof handler.resolveLink !== 'function') continue
    try {
      const resolved = handler.resolveLink(input)
      if (resolved && resolved.path) return { ...resolved, handlerId: handler.id }
    } catch { /* 坏 handler 跳过。 */ }
  }
  return null
}

// ── EP 声明 / 注册 / 注销 ─────────────────────────────────────────────────────────────────

/** 四条 EP 的声明（幂等：重复调用只覆盖同名声明）。 */
export function declareDocumentationTargetExtensionPoints(): void {
  for (const [id, name] of [
    [PSI_TARGET_PROVIDER_EP, 'PSI 文档目标提供方'],
    [SYMBOL_TARGET_PROVIDER_EP, '符号文档目标提供方'],
    [LOOKUP_ELEMENT_TARGET_PROVIDER_EP, '候选条目文档目标提供方'],
    [LINK_HANDLER_EP, '文档链接处理器'],
  ] as const) {
    EXTENSIONS.declareExtensionPoint({ id, name, scope: APPLICATION_SCOPE, dynamic: true })
  }
}

declareDocumentationTargetExtensionPoints()

/** 按 id 注册一条贡献（同 id 覆盖，与宿主同口径）。 */
export function registerDocumentationTargetExtension<T>(
  extensionPoint: string, id: string, value: T, options: RegisterExtensionOptions = {},
): ExtensionHandle {
  return EXTENSIONS.registerExtension(extensionPoint, id, value, options)
}

/** 注销一条贡献（返回是否真的删掉了）。 */
export function unregisterDocumentationTargetExtension(extensionPoint: string, id: string): boolean {
  return EXTENSIONS.unregisterExtension(extensionPoint, id)
}

/** 注册一条 PSI 目标提供方（缺省 bundled）。 */
export function registerPsiDocumentationTargetProvider(
  contribution: PsiDocumentationTargetProviderContribution, options: RegisterExtensionOptions = {},
): ExtensionHandle {
  return registerDocumentationTargetExtension(PSI_TARGET_PROVIDER_EP, contribution.id, contribution, { source: 'bundled', ...options })
}

/** 注册一条符号目标提供方（缺省 bundled）。 */
export function registerSymbolDocumentationTargetProvider(
  contribution: SymbolDocumentationTargetProviderContribution, options: RegisterExtensionOptions = {},
): ExtensionHandle {
  return registerDocumentationTargetExtension(SYMBOL_TARGET_PROVIDER_EP, contribution.id, contribution, { source: 'bundled', ...options })
}

/** 注册一条候选条目目标提供方（缺省 bundled）。 */
export function registerLookupElementDocumentationTargetProvider(
  contribution: LookupElementDocumentationTargetProviderContribution, options: RegisterExtensionOptions = {},
): ExtensionHandle {
  return registerDocumentationTargetExtension(LOOKUP_ELEMENT_TARGET_PROVIDER_EP, contribution.id, contribution, { source: 'bundled', ...options })
}

/** 注册一条文档链接处理器（缺省 bundled）。 */
export function registerDocumentationLinkHandler(
  contribution: DocumentationLinkHandlerContribution, options: RegisterExtensionOptions = {},
): ExtensionHandle {
  return registerDocumentationTargetExtension(LINK_HANDLER_EP, contribution.id, contribution, { source: 'bundled', ...options })
}

// ── bundled：本仓内建的四支（上游这四条 EP 的内建贡献者是各自的 impl 类） ─────────────────────

/** 内建 PSI 目标提供方 id（passthrough：本仓的文档来自语言服务 / `DocumentationProvider`）。 */
export const BUNDLED_PSI_TARGET_PROVIDER_ID = 'taocode.psiTargetProvider.lsp'
/** 内建符号目标提供方 id（passthrough：本仓的符号解析在 `src/docSymbolTarget.ts` 的 LSP 链路）。 */
export const BUNDLED_SYMBOL_TARGET_PROVIDER_ID = 'taocode.symbolTargetProvider.lsp'
/** 内建候选条目目标提供方 id（passthrough：本仓的候选文档来自 `completionItem/resolve`）。 */
export const BUNDLED_LOOKUP_ELEMENT_TARGET_PROVIDER_ID = 'taocode.lookupElementTargetProvider.lsp'
/** 内建链接处理器 id（passthrough：本仓的链接解析在 `src/docSymbolTarget.ts` / `revealLocation`）。 */
export const BUNDLED_LINK_HANDLER_ID = 'taocode.linkHandler.bundled'

/**
 * 内建 PSI 目标提供方 —— **如实**是 passthrough：本仓的文档内容走语言服务
 * （`src/docHoverContent.ts` 的 LSP `textDocument/hover`）与 `DocumentationProvider`
 * （`src/documentationExtensionPoints.ts`），不在这张表里生成。
 * 它存在的意义是让 EP 里有一条 bundled 项、第三方按 id 挂的提供方能被
 * `psiDocumentationTargets` 真实取到。
 */
export function builtinPsiDocumentationTargetProvider(): PsiDocumentationTargetProviderContribution {
  return { id: BUNDLED_PSI_TARGET_PROVIDER_ID, documentationTarget: () => null, documentationTargets: () => [] }
}

/** 内建符号目标提供方 —— passthrough（本仓的 `{@link Foo}` 解析在 `src/docSymbolTarget.ts`）。 */
export function builtinSymbolDocumentationTargetProvider(): SymbolDocumentationTargetProviderContribution {
  return { id: BUNDLED_SYMBOL_TARGET_PROVIDER_ID, documentationTarget: () => null }
}

/** 内建候选条目目标提供方 —— passthrough（本仓的候选文档取 `completionItem/resolve`）。 */
export function builtinLookupElementDocumentationTargetProvider(): LookupElementDocumentationTargetProviderContribution {
  return { id: BUNDLED_LOOKUP_ELEMENT_TARGET_PROVIDER_ID, documentationTarget: () => null }
}

/** 内建链接处理器 —— 不解任何 url（`resolveLink` 恒 null ⇒ 既有两条通道不变）。 */
export function builtinDocumentationLinkHandler(): DocumentationLinkHandlerContribution {
  return { id: BUNDLED_LINK_HANDLER_ID, resolveLink: () => null }
}

/**
 * 登记本仓内建的四支默认贡献（幂等：同 id 覆盖）。
 * 四支都是 passthrough ⇒ 不改变任何既有行为，只让 EP 里看得见、第三方能挂进来。
 */
export function registerBundledDocumentationTargetDefaults(): void {
  registerPsiDocumentationTargetProvider(builtinPsiDocumentationTargetProvider())
  registerSymbolDocumentationTargetProvider(builtinSymbolDocumentationTargetProvider())
  registerLookupElementDocumentationTargetProvider(builtinLookupElementDocumentationTargetProvider())
  registerDocumentationLinkHandler(builtinDocumentationLinkHandler())
}

registerBundledDocumentationTargetDefaults()
