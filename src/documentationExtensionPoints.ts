// **快速文档的扩展点**（上游 `platform/lang-impl` 的 `DocumentationActionProvider` /
// `DocumentationCssProvider` / `DocToolWindowManager` / `DocRenderItemUpdateProvider` 一族在本仓的等价物）。
//
// 上游是什么：文档弹层与文档工具窗相邻的四条 EP，id 逐字取自各类的 `ExtensionPointName`：
//   · `com.intellij.documentationActionProvider` —— `DocumentationActionProvider.java:13`，方法面
//     `List<AnAction> additionalActions(Editor, PsiDocCommentBase, String renderedText)`（`:18`）
//     与 `additionalActions(DocumentationComponent)`（`:34`）—— 弹层/面板右上角那排额外动作；
//   · `com.intellij.documentationCssProvider` —— `DocumentationCssProvider.java:12`，方法面
//     `String generateCss(Function<Integer,Integer> scaleFunction, boolean isInlineEditorContext)`（`:20`）
//     —— 文档 HTML 的样式表来源；
//   · `com.intellij.lang.documentationToolWindowManager` —— `DocToolWindowManager.java:48` 的
//     `new ExtensionPointName<>("com.intellij.lang.documentationToolWindowManager")`，
//     按语言给一个**常驻文档工具窗**的管理器；
//   · `com.intellij.codeInsight.documentation.render.itemUpdateProvider` ——
//     `render/DocRenderItemUpdateProvider.kt:13`，方法面 `getItems(editor)`（`:10`），
//     静态入口 `getAllItems(editor)`（`:17-18`）把全部贡献的条目拼起来。
//
// 本仓此前：弹层渲染在 `src/quickDocLayout.ts`（区块/链接/图片）+ `src/quickDocHost.ts`（装配），
// 常驻浏览器模型在 `src/documentationBrowser.ts`，**没有插件 EP 宿主** —— 第三方无法按 id 挂
// 一个「文档额外动作」/「文档 CSS」/「文档 render 条目」。本文件补上那一层：
//   · 四条 EP 用 `src/extensionPoints.ts` 的 `EXTENSIONS.declareExtensionPoint()` 声明；
//   · 贡献形状 = 上游接口的**可移植子集**（本仓没有 Swing `AnAction`/`Editor`/`DocumentationComponent`，
//     换成 `DocActionContribution`（id + 标题 + 可用性谓词 + 处理器）、`DocCssContext`、`DocRenderItem`）；
//   · 本仓内建的「在浏览器中打开」「前进/后退」两条动作 **作为 bundled 贡献**挂进
//     `documentationActionProvider`，让第三方挂的同名面在 EP 里看得见。
//
// 与上游的如实差异：① 上游 `AnAction` 是 Swing 动作，本仓换成 `DocAction`（id/标题/可用/执行 + 可选
// 可用性谓词），与 `src/actionRegistry.ts` 的动作形状同源；② `generateCss` 的 `scaleFunction`
// 在本仓是「令牌名 → px」的映射（本仓样式走设计令牌，不落 hex）；③ `DocRenderItem` 只保留
// 「区间 + 文本 + 令牌类」三格（上游是 `DocRenderItem` 的区间 + 内联元素）。
//
// 纯数据层：不 import vue/DOM/bridge，便于单测。
//
// 判据：`tests/documentation-extension-points.test.mjs`。

import { APPLICATION_SCOPE, EXTENSIONS, type ExtensionHandle, type RegisterExtensionOptions } from './extensionPoints.ts'
// `DocumentationTargetProvider` 一族的其余四条（psi / symbol / lookupElement / linkHandler）：
// 声明、出处与注册面在 `src/documentationTargetExtensionPoints.ts`，这里的 `documentationTargetsFor`
// 是 PSI 那一支的真实消费点（详见该函数注释）。
import { psiDocumentationTargets } from './documentationTargetExtensionPoints.ts'

/** 四条 EP 的 id（逐字取自上游各自的 `ExtensionPointName`，见文件头逐行出处）。 */
export const DOCUMENTATION_ACTION_PROVIDER_EP = 'com.intellij.documentationActionProvider'
export const DOCUMENTATION_CSS_PROVIDER_EP = 'com.intellij.documentationCssProvider'
export const DOC_TOOL_WINDOW_MANAGER_EP = 'com.intellij.lang.documentationToolWindowManager'
export const DOC_RENDER_ITEM_UPDATE_PROVIDER_EP = 'com.intellij.codeInsight.documentation.render.itemUpdateProvider'

// ── 第二批（2026-10-06 epclose-lp）：文档来源的两条上游 EP ────────────────────────────────────
//
// 上游依据（qualifiedName 逐字取自各处的 `ExtensionPointName`）：
//   · `com.intellij.documentationProvider` ——
//     `platform/analysis-api/resources/META-INF/Analysis.analyzer.xml:11`
//     （`interface="com.intellij.lang.documentation.DocumentationProvider"` dynamic="true"）；
//     接口 `platform/analysis-api/src/com/intellij/lang/documentation/DocumentationProvider.java:55`
//     （`EP_NAME` 在 `:59`）；方法面 `getQuickNavigateInfo`（`:70`）/`getUrlFor`（`:86`）/
//     `generateDoc`（`:113`）/`generateHoverDoc`（`:123`，缺省回落 `generateDoc`）/
//     `getCustomDocumentationElement`（`:189`）/`getDocumentationElementForLink`（`:174`）。
//   · `DocumentationTargetProvider` —— `platform/lang-impl/src/com/intellij/platform/backend/documentation/
//     DocumentationTargetProvider.java:24` 的 `EP_NAME = ExtensionPointName.create(
//     "com.intellij.platform.backend.documentation.targetProvider")`（`:25-27`）；方法面
//     `documentationTargets(PsiFile, int offset): List<DocumentationTarget>`（`:33`）。
//     **如实差异**：协调单里写的 `com.intellij.documentationTargetProvider` 在上游**不是 EP**
//     （零命中）—— 真名是这条带 `platform.backend.` 前缀的，故按真名落。
//
// 本仓此前：hover 文档全来自语言服务（`src/docHoverContent.ts` 的 LSP `textDocument/hover`），
// **没有插件 EP 宿主** —— 第三方无法按 id 提供一段文档。本文件补上这一层：两条 EP 声明 +
// 与上游同名的方法面 + consume 函数；消费点是 `src/quickDocHost.ts` 的 `showAt` ——
// 语言服务给不出内容时问一遍登记表（`documentationFor`）。

/** 文档来源的两条 EP id（逐字取自上游，见上）。 */
export const DOCUMENTATION_PROVIDER_EP = 'com.intellij.documentationProvider'
export const DOCUMENTATION_TARGET_PROVIDER_EP = 'com.intellij.platform.backend.documentation.targetProvider'

/** 文档要素（上游 `PsiElement` + `originalElement` 的可移植替代：路径 + 语言 + 文本 + 光标位置）。 */
export interface DocElementInput {
  path: string
  language: string
  /** 当前文档全文。 */
  text: string
  line: number
  character: number
}

/** 一条文档提供方（`DocumentationProvider` 的方法面，名字与上游逐字相同）。 */
export interface DocumentationProviderContribution {
  id: string
  languages?: readonly string[]
  /** `getQuickNavigateInfo(element, originalElement)`。 */
  getQuickNavigateInfo?: (element: DocElementInput) => string | null
  /** `getUrlFor(element, originalElement)` —— 外部文档链接。 */
  getUrlFor?: (element: DocElementInput) => readonly string[] | null
  /** `generateDoc(element, originalElement)` —— 生成文档正文（HTML/纯文本）。 */
  generateDoc: (element: DocElementInput) => string | null
  /** `generateHoverDoc(element, originalElement)`（缺省回落 `generateDoc`）。 */
  generateHoverDoc?: (element: DocElementInput) => string | null
  /** `getCustomDocumentationElement(editor, file, contextElement, targetOffset)`（缺省 = 不拦截）。 */
  getCustomDocumentationElement?: (element: DocElementInput) => DocElementInput | null
  /** `getDocumentationElementForLink(psiManager, link, context)` —— 解析文档里的符号链接。 */
  getDocumentationElementForLink?: (link: string, element: DocElementInput) => DocElementInput | null
}

/** 一个文档目标（上游 `DocumentationTarget` 的可移植子集：位置 + 取内容）。 */
export interface DocumentationTargetLike {
  path: string
  line: number
  character: number
  /** 上游 `computeDocumentation()`；null = 这个目标没有可显示文本。 */
  computeDocumentation: () => string | null
  /** 上游 `computeDocumentationHint()`。 */
  computeDocumentationHint?: () => string | null
}

/** 一条文档目标提供方（`DocumentationTargetProvider.documentationTargets(file, offset)` 的同名方法面）。 */
export interface DocumentationTargetProviderContribution {
  id: string
  languages?: readonly string[]
  documentationTargets: (element: DocElementInput) => readonly DocumentationTargetLike[]
}

function docAcceptsLanguage(contribution: { languages?: readonly string[] }, language: string): boolean {
  const list = contribution.languages
  return !list || list.length === 0 || list.includes(language)
}

/** `DocumentationProvider.EP_NAME.getExtensionList()` 的等价物（按语言过滤）。 */
export function documentationProviderContributions(language: string, scope: string = APPLICATION_SCOPE): DocumentationProviderContribution[] {
  return EXTENSIONS.extensionsOf<DocumentationProviderContribution>(DOCUMENTATION_PROVIDER_EP, scope)
    .filter(contribution => docAcceptsLanguage(contribution, language))
}

/** `DocumentationTargetProvider.EP_NAME` 的等价物（按语言过滤）。 */
export function documentationTargetProviders(language: string, scope: string = APPLICATION_SCOPE): DocumentationTargetProviderContribution[] {
  return EXTENSIONS.extensionsOf<DocumentationTargetProviderContribution>(DOCUMENTATION_TARGET_PROVIDER_EP, scope)
    .filter(contribution => docAcceptsLanguage(contribution, language))
}

/** 全部文档目标（各 provider 的 `documentationTargets` 合并；坏 provider 跳过）。 */
export function documentationTargetsFor(element: DocElementInput, scope: string = APPLICATION_SCOPE): DocumentationTargetLike[] {
  // 第一档是 `com.intellij.platform.backend.documentation.psiTargetProvider`（按**元素**问，
  // 上游 `IdeDocumentationTargetProviderImpl.kt:64-71` 先收这一族的 targets —— 元素级目标比
  // 「文件 + 偏移」更具体，所以排在前面）；第二档才是本文件第二条那支 `targetProvider`
  //（上游 `DocumentationManager` 取 target 的顺序同此）。两条 EP 的声明与出处见
  // `src/documentationTargetExtensionPoints.ts`；没有第三方挂进来时 psi 那一档是空数组
  // （bundled passthrough 恒返回 null / 空表）⇒ 既有行为逐字不变。
  const out: DocumentationTargetLike[] = [...psiDocumentationTargets(element, scope)]
  for (const provider of documentationTargetProviders(element.language, scope)) {
    try { out.push(...provider.documentationTargets(element)) } catch { /* 坏 provider 跳过。 */ }
  }
  return out
}

/** 第一个 `generateDoc` 非空的结果（没有贡献时返回 null）。 */
export function generatedDocumentation(element: DocElementInput, scope: string = APPLICATION_SCOPE): string | null {
  for (const provider of documentationProviderContributions(element.language, scope)) {
    try {
      const doc = provider.generateDoc(element)
      if (doc !== null && doc !== undefined) return doc
    } catch { /* 坏 provider 跳过。 */ }
  }
  return null
}

/** hover 档的文档（`generateHoverDoc` 缺省回落 `generateDoc`，与上游 `:123` 一致）。 */
export function hoverDocumentationFor(element: DocElementInput, scope: string = APPLICATION_SCOPE): string | null {
  for (const provider of documentationProviderContributions(element.language, scope)) {
    try {
      const doc = provider.generateHoverDoc ? provider.generateHoverDoc(element) : provider.generateDoc(element)
      if (doc !== null && doc !== undefined) return doc
    } catch { /* 坏 provider 跳过。 */ }
  }
  return null
}

/** 第一个非空的外部文档链接表。 */
export function documentationUrlsFor(element: DocElementInput, scope: string = APPLICATION_SCOPE): string[] {
  for (const provider of documentationProviderContributions(element.language, scope)) {
    if (typeof provider.getUrlFor !== 'function') continue
    try {
      const urls = provider.getUrlFor(element)
      if (urls && urls.length) return [...urls]
    } catch { /* 坏 provider 跳过。 */ }
  }
  return []
}

/** 第一个非空的 quick-navigate 文本。 */
export function quickNavigateInfoFor(element: DocElementInput, scope: string = APPLICATION_SCOPE): string | null {
  for (const provider of documentationProviderContributions(element.language, scope)) {
    if (typeof provider.getQuickNavigateInfo !== 'function') continue
    try {
      const info = provider.getQuickNavigateInfo(element)
      if (info !== null && info !== undefined) return info
    } catch { /* 坏 provider 跳过。 */ }
  }
  return null
}

/**
 * **文档弹层问的那一问**：先问 `DocumentationTargetProvider`（上游 `DocumentationManager`
 * 优先取 target），取第一个 `computeDocumentation()` 非空的目标；都没有再回落到
 * `DocumentationProvider.generateHoverDoc`。都没有返回 null（调用方照旧说「此处没有文档」）。
 */
export function documentationFor(element: DocElementInput, scope: string = APPLICATION_SCOPE): string | null {
  for (const target of documentationTargetsFor(element, scope)) {
    try {
      const doc = target.computeDocumentation()
      if (doc !== null && doc !== undefined && doc !== '') return doc
    } catch { /* 坏目标跳过。 */ }
  }
  return hoverDocumentationFor(element, scope)
}

/** 声明文档来源的两条 EP（幂等）。 */
export function declareDocumentationSourceExtensionPoints(): void {
  EXTENSIONS.declareExtensionPoint({ id: DOCUMENTATION_PROVIDER_EP, name: '文档提供方', scope: APPLICATION_SCOPE, dynamic: true })
  EXTENSIONS.declareExtensionPoint({ id: DOCUMENTATION_TARGET_PROVIDER_EP, name: '文档目标提供方', scope: APPLICATION_SCOPE, dynamic: true })
}

declareDocumentationSourceExtensionPoints()

/** 注册一条文档提供方（缺省 bundled）。 */
export function registerDocumentationProviderContribution(
  contribution: DocumentationProviderContribution, options: RegisterExtensionOptions = {},
): ExtensionHandle {
  return register(DOCUMENTATION_PROVIDER_EP, contribution, { source: 'bundled', ...options })
}

/** 注册一条文档目标提供方（缺省 bundled）。 */
export function registerDocumentationTargetProvider(
  contribution: DocumentationTargetProviderContribution, options: RegisterExtensionOptions = {},
): ExtensionHandle {
  return register(DOCUMENTATION_TARGET_PROVIDER_EP, contribution, { source: 'bundled', ...options })
}

/** 本仓内建的文档提供方 id（passthrough：本仓的文档来自语言服务，见文件头如实差异）。 */
export const BUNDLED_DOCUMENTATION_PROVIDER_ID = 'taocode.documentationProvider.lsp'

/**
 * 本仓内建的文档提供方：**如实**是一个 passthrough —— 本仓的 hover 文档走语言服务
 * （`src/docHoverContent.ts` 的 LSP `textDocument/hover`），不在这张注册表里生成。
 * 它存在的意义是让 EP 里有一条 bundled 项、并使 `documentationFor` 的回落链成立；
 * 第三方按 id 挂的提供方在语言服务给不出内容时被真实问到（消费点 `src/quickDocHost.ts` 的 `showAt`）。
 */
export function builtinDocumentationProvider(): DocumentationProviderContribution {
  return { id: BUNDLED_DOCUMENTATION_PROVIDER_ID, generateDoc: () => null }
}

registerDocumentationProviderContribution(builtinDocumentationProvider())

/** 弹层/面板上的一个额外动作（上游 `AnAction` 的可移植替代）。 */
export interface DocAction {
  id: string
  title: string
  /** 可用性谓词（缺省恒可用，照上游「无谓词即可用」）。 */
  enabled?: (context: DocActionContext) => boolean
  /** 执行（宿主把宿主侧的能力注入进来）。 */
  run: (context: DocActionContext) => void
}

/** 动作执行/可用性判定的上下文（上游 `Editor`/`DocumentationComponent` 的可移植替代）。 */
export interface DocActionContext {
  /** 当前文档对应的文件路径（可为空：还没解析出目标）。 */
  path: string | null
  /** 渲染出来的 HTML/文本（上游 `renderedText`）。 */
  renderedText: string
  /** 当前页的外部链接（上游 `currentExternalUrl`），决定「在浏览器中打开」可不可点。 */
  externalUrl: string | null
  /** 是不是内联编辑器上下文（上游 `isInlineEditorContext`）。 */
  inlineEditor: boolean
}

/** 上游 `DocumentationActionProvider`（`DocumentationActionProvider.java:12-35`）的可移植子集。 */
export interface DocumentationActionProvider {
  id: string
  /** 支持的语言（空数组 = 任何语言都参与；上游按 `getLanguage()` 过滤）。 */
  languages?: readonly string[]
  /** 给弹层/面板补的额外动作。 */
  additionalActions: (context: DocActionContext) => readonly DocAction[]
}

/** 上游 `Function<Integer,Integer> scaleFunction` 的可移植替代：令牌名 → 像素尺度。 */
export interface DocCssScale {
  (token: string): number
}

/** 上游 `DocumentationCssProvider`（`DocumentationCssProvider.java:9-20`）的可移植子集。 */
export interface DocumentationCssProvider {
  id: string
  /** 生成样式表（本仓样式走令牌类，不落 hex；`scale` 是「令牌 → px」的映射）。 */
  generateCss: (scale: DocCssScale, isInlineEditorContext: boolean) => string
}

/** 上游 `DocRenderItem`（`render/DocRenderItem.kt`）的可移植子集：区间 + 文本 + 令牌类。 */
export interface DocRenderItem {
  /** 文档文本里的字符区间 [start, end)。 */
  start: number
  end: number
  /** 该段文本。 */
  text: string
  /** 令牌类名（本仓不落 hex，交给样式表按令牌上色）。 */
  tokenClass?: string
}

/** 上游 `DocRenderItemUpdateProvider`（`render/DocRenderItemUpdateProvider.kt:9-18`）的可移植子集。 */
export interface DocRenderItemUpdateProvider {
  id: string
  /** 给当前文档切出的可交互条目（上游 `getItems(editor)`）。 */
  getItems: (context: DocActionContext) => readonly DocRenderItem[]
}

/** 上游 `DocToolWindowManager`：按语言给一个常驻文档工具窗的管理器（本仓只保留窗口身份 + 语言）。 */
export interface DocToolWindowManager {
  id: string
  language: string
  /** 工具窗 id（上游 `DocumentationToolWindowManager.TOOL_WINDOW_ID = "documentation.v2"`）。 */
  toolWindowId: string
  /** 这一档是不是打开着（宿主注入的实时状态）。 */
  isOpen?: () => boolean
}

/** 四条 EP 的声明（幂等）。 */
export function declareDocumentationExtensionPoints(): void {
  EXTENSIONS.declareExtensionPoint({ id: DOCUMENTATION_ACTION_PROVIDER_EP, name: '文档额外动作提供方', scope: APPLICATION_SCOPE, dynamic: true })
  EXTENSIONS.declareExtensionPoint({ id: DOCUMENTATION_CSS_PROVIDER_EP, name: '文档 CSS 提供方', scope: APPLICATION_SCOPE, dynamic: true })
  EXTENSIONS.declareExtensionPoint({ id: DOC_TOOL_WINDOW_MANAGER_EP, name: '文档工具窗管理器', scope: APPLICATION_SCOPE, dynamic: true })
  EXTENSIONS.declareExtensionPoint({ id: DOC_RENDER_ITEM_UPDATE_PROVIDER_EP, name: '文档 render 条目提供方', scope: APPLICATION_SCOPE, dynamic: true })
}

declareDocumentationExtensionPoints()

function register<T extends { id: string }>(ep: string, value: T, options: RegisterExtensionOptions): ExtensionHandle {
  return EXTENSIONS.registerExtension(ep, value.id, value, options)
}

export function registerDocumentationActionProvider(value: DocumentationActionProvider, options: RegisterExtensionOptions = {}): ExtensionHandle {
  return register(DOCUMENTATION_ACTION_PROVIDER_EP, value, options)
}
export function registerDocumentationCssProvider(value: DocumentationCssProvider, options: RegisterExtensionOptions = {}): ExtensionHandle {
  return register(DOCUMENTATION_CSS_PROVIDER_EP, value, options)
}
export function registerDocToolWindowManager(value: DocToolWindowManager, options: RegisterExtensionOptions = {}): ExtensionHandle {
  return register(DOC_TOOL_WINDOW_MANAGER_EP, value, options)
}
export function registerDocRenderItemUpdateProvider(value: DocRenderItemUpdateProvider, options: RegisterExtensionOptions = {}): ExtensionHandle {
  return register(DOC_RENDER_ITEM_UPDATE_PROVIDER_EP, value, options)
}

function acceptsLanguage(contribution: { languages?: readonly string[] }, language: string): boolean {
  const list = contribution.languages
  return !list || list.length === 0 || list.includes(language)
}

/** 按语言取全部额外动作提供方。 */
export function documentationActionProviders(language: string, scope: string = APPLICATION_SCOPE): DocumentationActionProvider[] {
  return EXTENSIONS.extensionsOf<DocumentationActionProvider>(DOCUMENTATION_ACTION_PROVIDER_EP, scope)
    .filter(contribution => acceptsLanguage(contribution, language))
}

/**
 * 全部额外动作（上游把 `additionalActions` 的结果逐条加到弹层；本仓合并后按 id 去重，
 * 同 id 取**先出现的那条** —— EP 的排序已决定先后）。
 */
export function documentationActions(
  context: DocActionContext, language: string, scope: string = APPLICATION_SCOPE,
): DocAction[] {
  const out: DocAction[] = []
  for (const provider of documentationActionProviders(language, scope)) {
    out.push(...provider.additionalActions(context))
  }
  return out
}

/** 该动作在上下文里可不可用（没给谓词即可用）。 */
export function docActionEnabled(action: DocAction, context: DocActionContext): boolean {
  return action.enabled ? action.enabled(context) : true
}

/**
 * 拼接全部 CSS 提供方的样式表（上游文档 HTML 把所有 provider 的 CSS 拼一起）。
 * 空结果 = 没有 provider 管这一档，调用方就用内联样式（本仓默认形态）。
 */
export function documentationCss(
  scale: DocCssScale, isInlineEditorContext: boolean, scope: string = APPLICATION_SCOPE,
): string {
  const parts: string[] = []
  for (const provider of EXTENSIONS.extensionsOf<DocumentationCssProvider>(DOCUMENTATION_CSS_PROVIDER_EP, scope)) {
    const css = provider.generateCss(scale, isInlineEditorContext)
    if (css) parts.push(css)
  }
  return parts.join('\n')
}

/** 全部 render 条目（上游 `DocRenderItemUpdateProvider.getAllItems` 的等价物）。 */
export function docRenderItems(context: DocActionContext, scope: string = APPLICATION_SCOPE): DocRenderItem[] {
  const out: DocRenderItem[] = []
  for (const provider of EXTENSIONS.extensionsOf<DocRenderItemUpdateProvider>(DOC_RENDER_ITEM_UPDATE_PROVIDER_EP, scope)) {
    out.push(...provider.getItems(context))
  }
  return out
}

/** 按语言取文档工具窗管理器（上游按语言取管理器；空数组 = 这门语言没有常驻窗）。 */
export function docToolWindowManagers(language: string, scope: string = APPLICATION_SCOPE): DocToolWindowManager[] {
  return EXTENSIONS.extensionsOf<DocToolWindowManager>(DOC_TOOL_WINDOW_MANAGER_EP, scope)
    .filter(manager => manager.language === language)
}

/* ── bundled：本仓内建的两条文档动作 + 一条 CSS ─────────────────────────────────── */

export const BUILTIN_OPEN_IN_BROWSER_ID = 'taocode.docAction.openInBrowser'
export const BUILTIN_DOC_HISTORY_BACK_ID = 'taocode.docAction.historyBack'
export const BUILTIN_DOC_HISTORY_FORWARD_ID = 'taocode.docAction.historyForward'
export const BUILTIN_DOC_CSS_ID = 'taocode.docCss.tokens'
/** 上游 `DocumentationToolWindowManager.TOOL_WINDOW_ID`（`DocToolWindowManager.java:44`）。 */
export const DOCUMENTATION_TOOL_WINDOW_ID = 'documentation.v2'

/**
 * 本仓内建的文档动作提供方：三条动作，可用性按上下文判定（外链为空则「在浏览器中打开」不可点）。
 * `openExternal(url)` / `history(direction)` 由宿主注入，本层只做可用性与派发。
 */
export function builtinDocumentationActionProvider(
  openExternal: (url: string) => void,
  history: (direction: 'back' | 'forward') => void,
  canGo?: (direction: 'back' | 'forward') => boolean,
): DocumentationActionProvider {
  return {
    id: 'taocode.docActionProvider.builtin',
    additionalActions: () => [
      {
        id: BUILTIN_OPEN_IN_BROWSER_ID,
        title: '在浏览器中打开',
        enabled: context => !!context.externalUrl,
        run: context => { if (context.externalUrl) openExternal(context.externalUrl) },
      },
      {
        id: BUILTIN_DOC_HISTORY_BACK_ID,
        title: '后退',
        enabled: () => (canGo ? canGo('back') : true),
        run: () => history('back'),
      },
      {
        id: BUILTIN_DOC_HISTORY_FORWARD_ID,
        title: '前进',
        enabled: () => (canGo ? canGo('forward') : true),
        run: () => history('forward'),
      },
    ],
  }
}

/** 本仓内建的文档 CSS：按令牌尺度生成一小段（不落 hex，颜色由令牌类给）。 */
export function builtinDocumentationCssProvider(): DocumentationCssProvider {
  return {
    id: BUILTIN_DOC_CSS_ID,
    generateCss(scale, inline) {
      const unit = scale('doc.base')
      return [
        `.doc-body { font-size: ${unit}px; }`,
        inline ? '.doc-body--inline { display: inline; }' : '.doc-body--window { display: block; }',
      ].join('\n')
    },
  }
}

/** 把内建两条挂上（返回注销句柄）。重复调用覆盖同 id 旧贡献。 */
export function registerBundledDocumentationContributions(
  openExternal: (url: string) => void,
  history: (direction: 'back' | 'forward') => void,
  canGo?: (direction: 'back' | 'forward') => boolean,
): () => void {
  const options: RegisterExtensionOptions = { source: 'bundled' }
  const handles = [
    registerDocumentationActionProvider(builtinDocumentationActionProvider(openExternal, history, canGo), options),
    registerDocumentationCssProvider(builtinDocumentationCssProvider(), options),
  ]
  return () => { for (const handle of handles) handle.dispose() }
}
