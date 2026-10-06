// 语义高亮的**按特性注册表 + 缓存** —— 上游 `platform/lsp*` 里那两条链的模块侧等价物。
//
// ## 上游坐标（逐条亲自打开核对）
//   · `platform/lsp/src/api/customization/LspSemanticTokensCustomizer.kt:38-62`
//     —— `tokenTypes`：它上面那段注释（`:32-37`）明写这张表**就是** `initialize` 里
//     `semanticTokens.tokenTypes` 的那份声明；`:71-82` 是 `tokenModifiers`。
//     `:23-31` `shouldAskServerForSemanticTokens(psiFile)` —— 按文件决定要不要**发**请求；
//     `:125` `object LspSemanticTokensDisabled` —— 整条特性关掉时用的是**另一个 customizer 对象**，
//     于是下面那条 `as?` 转型失败 ⇒ 不发请求（不是"发了再丢弃"）。
//   · `platform/lsp/src/api/customization/LspSemanticTokensCustomizer.kt:91-122`
//     —— `getTextAttributesKey(tokenType, modifiers): TextAttributesKey?`：**渲染注册表**，
//     `:100` Variable → LOCAL_VARIABLE（默认前景）、`:101-106` Property/EnumMember 按 `static`
//     修饰符换 key、`:113` Keyword → KEYWORD、**`:121` 的 `else -> null`** = 未注册的类型**不高亮**。
//   · `platform/lsp/src/api/LspClientCapabilities.kt:185-201` —— capabilities 里的
//     `tokenTypes`/`tokenModifiers` 是**从上面那张注册表取的**（`:193-194`
//     `tokenTypes = semanticTokensSupport.tokenTypes`），不是另抄一份：
//     **声明与渲染同源，结构上就不可能漂**。
//   · `platform/lsp-impl/src/impl/features/highlighting/LspSemanticTokensCache.kt:29-36`
//     —— `isSupportedForFile`：customizer 不是 `LspSemanticTokensSupport` ⇒ false；
//     `shouldAskServerForSemanticTokens` false ⇒ false；
//     `serverCapabilities?.semanticTokensProvider?.full` 不为 true ⇒ false（**能力没声明就不发请求**）。
//     `:39` 服务端 legend 缺失 ⇒ 直接 `LspPullResult.Failed`。
//   · `platform/lsp-impl/src/impl/features/highlighting/LspSemanticTokensCache.kt:40-41`
//     请求前先记 `document.modificationStamp`；`:51-54` 回来时戳变了 ⇒ **这份答案直接丢**（连解码都不做）；
//     `:102-105` `tokenType` 索引越界 ⇒ warn + `continue`（**整条 token 丢掉**）。
//   · `platform/lsp-impl/src/impl/features/highlightingCommon/LspHighlightingCacheRegistry.kt:23-56`
//     —— **按特性**的缓存注册表：`:26-35` 每条特性一个具名缓存实例，`:37-40` `register()`，
//     `:42-44` `fileEdited` 扇给所有缓存，`:46-48` `clearCache` 整族清，
//     `:54-56` `invalidatePulledResults(file)` 只清**支持 pull 的**那几条、且只清这一个文件。
//
// ## 本仓为什么是"注册表 + 门禁"而不是"一份表"
// 上游声明与渲染同源（见 `LspClientCapabilities.kt:193`）是因为两边都在 Kotlin。本仓的
// capabilities 字面量写在 **C++**（`native/lsp_host_bootstrap.cpp:237-245`），渲染表在 **TS**，
// 跨了语言就没法同源 —— 于是这里的口径是：
//   ① TS 侧的渲染注册表**以声明表为键类型**（`Record<SemanticTokenType, …>`，缺一条就编译不过）；
//   ② 颜色规则是否真的存在、有没有"没人声明的颜色规则"，由 `capabilityRenderDrift()` 在运行期查，
//      判据测试把它钉成恒空（`tests/semantic-highlighting.test.mjs`）；
//      声明表与原生字面量的逐项同序由 `tests/semantic-tokens.test.mjs:86` 钉着。
// 实测本仓确实漂过：`SEMANTIC_TOKEN_TYPES` 声明了 `keyword`，颜色表里的键却写作 `key`
// （`src/editorSemanticColors.ts:26`），而 `semanticTokenClass()` 发的是 `cm-sem-keyword`
// ⇒ 服务端按声明发来 `keyword` 时**整层不着色**。上游是 `Keyword → KEYWORD`
// （`LspSemanticTokensCustomizer.kt:113`），所以这里把 `keyword` 注册到颜色表的 `key`。
//
// ## 缓存的键：文档修订号
// 上游用 `Document.modificationStamp`。本仓编辑器文档（CodeMirror 的 `Text`）是**不可变**的：
// 改一个字就换一个新对象，改选区不换 ⇒ **对象身份就是修订号**（与 `src/docHoverContent.ts:120-130`
// 的 `hoverDocStampOf` 同一套做法）。于是"文档一变即失效"是结构性的，不需要额外比对内容。

import { semanticHighlightStyles } from './editorSemanticColors.ts'
import { lspFeatureRow } from './lspFeatureMatrix.ts'
import { registerLspCache } from './lspPerFileCache.ts'
import { SEMANTIC_TOKEN_MODIFIERS, SEMANTIC_TOKEN_TYPES, type SemanticToken } from './semanticTokens.ts'

/** 客户端声明过的 token 类型（与 `native/lsp_host_bootstrap.cpp` 的 `tokenTypes` 逐项同序）。 */
export type SemanticTokenType = (typeof SEMANTIC_TOKEN_TYPES)[number]
/** 客户端声明过的修饰符（位掩码按索引取，同上）。 */
export type SemanticTokenModifier = (typeof SEMANTIC_TOKEN_MODIFIERS)[number]

/**
 * token 类型 → 颜色表（`src/editorSemanticColors.ts`）里的规则名；`null` = **不高亮**
 * （上游 `getTextAttributesKey` 的 `else -> null`，`LspSemanticTokensCustomizer.kt:121`）。
 * 键类型是 `SemanticTokenType` ⇒ 声明表加一条而这里没登记就直接编译不过。
 */
export const SEMANTIC_TOKEN_RENDER_KEYS: Record<SemanticTokenType, string | null> = {
  namespace: 'namespace',
  type: 'type',
  class: 'class',
  enum: 'enum',
  interface: 'interface',
  struct: 'struct',
  typeParameter: 'typeParameter',
  parameter: 'parameter',
  // 上游 `:100` Variable → LOCAL_VARIABLE：IDEA 的默认局部变量就是不额外着色的前景色。
  variable: null,
  property: 'property',
  enumMember: 'enumMember',
  event: 'event',
  function: 'function',
  method: 'method',
  macro: 'macro',
  // 上游 `:113` Keyword → KEYWORD；本仓颜色表这条规则的名字是 `key`。
  keyword: 'key',
  modifier: 'modifier',
  comment: 'comment',
  string: 'string',
  number: 'number',
  regexp: 'regexp',
  operator: 'operator',
  decorator: 'decorator',
}

/**
 * 修饰符 → 颜色表里的 `mod-*` 规则名；`null` = 无视觉变化。
 * 上游只在 `static` 时换 key（`:102/:105/:110`），其余修饰符不改字形；本仓按
 * `src/semanticTokens.ts:12-13` 记下的视觉惯例（static/abstract 斜体、deprecated 删除线、
 * readonly 虚线下划线）给出四条规则，其余六条如实标 `null`（声明了但没有视觉处置）。
 */
export const SEMANTIC_MODIFIER_RENDER_KEYS: Record<SemanticTokenModifier, string | null> = {
  declaration: null,
  definition: null,
  readonly: 'mod-readonly',
  static: 'mod-static',
  deprecated: 'mod-deprecated',
  abstract: 'mod-abstract',
  async: null,
  modification: null,
  documentation: null,
  defaultLibrary: null,
}

/** 注册过的类型名集合（**服务端 legend 里出现但本仓没注册的类型**在这里查不出来 ⇒ 不高亮）。 */
const registeredTypes = new Set<string>()
for (const [type, renderKey] of Object.entries(SEMANTIC_TOKEN_RENDER_KEYS)) {
  if (renderKey && semanticHighlightStyles[renderKey]) registeredTypes.add(type)
}
const registeredModifiers = new Set<string>()
for (const [modifier, renderKey] of Object.entries(SEMANTIC_MODIFIER_RENDER_KEYS)) {
  if (renderKey && semanticHighlightStyles[renderKey]) registeredModifiers.add(modifier)
}

/** 这个 token 类型会不会真的被着色（未注册 = `false`，与上游 `else -> null` 同口径）。 */
export function semanticTokenTypeRegistered(type: string): boolean {
  return registeredTypes.has(type)
}

/** 这个修饰符有没有视觉处置。 */
export function semanticModifierRegistered(modifier: string): boolean {
  return registeredModifiers.has(modifier)
}

/**
 * token → 装饰类名（**只发注册过的**）。类型未注册时整条为空串 —— 调用方据此跳过这个区间，
 * 也不会只把修饰符（例如 `deprecated` 的删除线）画在一个认不出类型的 token 上：
 * 上游对认不出的类型是先 `continue` 掉整条（`LspSemanticTokensCache.kt:102-105`），
 * 对认得出的类型才走 `getTextAttributesKey`。
 */
export function semanticHighlightClasses(token: { type: string; modifiers?: readonly string[] }): string {
  const classes: string[] = []
  const renderKey = semanticTokenTypeRegistered(token.type) ? SEMANTIC_TOKEN_RENDER_KEYS[token.type as SemanticTokenType] : null
  if (renderKey) classes.push(`cm-sem-${renderKey}`)
  else return ''
  for (const modifier of token.modifiers ?? []) {
    if (!semanticModifierRegistered(modifier)) continue
    classes.push(`cm-sem-${SEMANTIC_MODIFIER_RENDER_KEYS[modifier as SemanticTokenModifier]}`)
  }
  return classes.join(' ')
}

/**
 * 声明表 / 渲染注册表 / 颜色表三者的一致性缺口（**恒空才是对的**）。
 * 三个方向都查，因为漂的方向不止一种：
 *   · `declaredWithoutRegistryEntry` —— 声明了却没登记处置（TS 已拦，这里给 JS 侧兜底）；
 *   · `registryKeyWithoutColorRule` —— 登记了规则名而颜色表里没有那条规则（**就是 `keyword` 那次**）；
 *   · `colorRuleNobodyDeclares` —— 颜色表里有规则而没有任何声明指向它（画不出来的死规则）。
 */
export function capabilityRenderDrift(): {
  declaredWithoutRegistryEntry: string[]
  registryKeyWithoutColorRule: string[]
  colorRuleNobodyDeclares: string[]
} {
  const declaredWithoutRegistryEntry: string[] = [
    ...SEMANTIC_TOKEN_TYPES.filter(type => !(type in SEMANTIC_TOKEN_RENDER_KEYS)),
    ...SEMANTIC_TOKEN_MODIFIERS.filter(modifier => !(modifier in SEMANTIC_MODIFIER_RENDER_KEYS)),
  ]
  const usedKeys = new Set<string>()
  const registryKeyWithoutColorRule: string[] = []
  for (const renderKey of Object.values(SEMANTIC_TOKEN_RENDER_KEYS)) {
    if (!renderKey) continue
    usedKeys.add(renderKey)
    if (!semanticHighlightStyles[renderKey]) registryKeyWithoutColorRule.push(renderKey)
  }
  for (const renderKey of Object.values(SEMANTIC_MODIFIER_RENDER_KEYS)) {
    if (!renderKey) continue
    usedKeys.add(renderKey)
    if (!semanticHighlightStyles[renderKey]) registryKeyWithoutColorRule.push(renderKey)
  }
  const colorRuleNobodyDeclares = Object.keys(semanticHighlightStyles).filter(name => !usedKeys.has(name))
  return { declaredWithoutRegistryEntry, registryKeyWithoutColorRule, colorRuleNobodyDeclares }
}

// ———————————————————————————————— 按特性的语义 token 缓存

/** `LspSemanticTokensCache.kt:51-54` 那一次"答案过期即丢"的裁决结果。 */
export type SemanticPullPlan = 'request' | 'cached' | 'unsupported'

interface SemanticSnapshot {
  /** 这份快照是为哪个文档修订取的。 */
  revision: number
  tokens: readonly SemanticToken[]
}

/** 缓存条数上限（与本仓其它快照同款的 FIFO；上游按文件清，本仓没有"关文件"的钩子）。 */
export const SEMANTIC_SNAPSHOT_LIMIT = 64

/**
 * 语义 token 的**按文档修订**快照缓存：一份文档（对象身份 = 修订号）只有一份结果，
 * 修订一变（换了 `Text` 对象）即查不到 ⇒ 调用方必须重新取。
 *
 * 与 `HighlightingSnapshotCache`（`src/lspHighlightingCache.ts`）的分工：那张管
 * "区间 + 载荷"的平移/裁剪/在途去重（诊断走它）；这一张管语义 token 这种**整份替换**
 * 的结果（上游 `LspSemanticTokensCache` 也是 `LspHighlightingCache` 的一个子类，
 * 只是载荷是 token 列表、区间由解码现算）。两者都自登记进批量作废面（`registerLspCache`）。
 */
export class SemanticHighlightingCache {
  private readonly snapshots = new Map<object, SemanticSnapshot>()
  private readonly order: object[] = []
  /** 服务端/宿主这条特性**声明过不支持**（`LSP_UNSUPPORTED`）—— 记住它，别再发第二次。 */
  private declined = false
  /** 这条缓存在按特性注册表里的特性 id（`registerHighlightingFeature` 用它查能力表）。 */
  readonly featureId: string

  constructor(featureId = 'semanticTokens') {
    this.featureId = featureId
    // 参与批量作废：语言服务重启（`src/lsSessionHost.ts` 的 `resetLspSession()`）或
    // 服务端发 `workspace/semanticTokens/refresh`（`src/lspProgress.ts` 分派）时整族清掉。
    registerLspCache(this)
  }

  /**
   * **capability 没声明就不请求**（上游 `isSupportedForFile`，`LspSemanticTokensCache.kt:29-36`）。
   * 本仓的客户端声明面是 `src/lspFeatureMatrix.ts`（每条特性一行，`provider` 与
   * `native/lsp_support.cpp` 的 `provider_for` 一一对应）：这一条没登记、或登记的 provider 是空、
   * 或宿主已经回过 `LSP_UNSUPPORTED` ⇒ `false`。
   */
  capabilityDeclared(): boolean {
    if (this.declined) return false
    const row = lspFeatureRow(this.featureId)
    return !!row && row.provider !== ''
  }

  /** 宿主回了 `LSP_UNSUPPORTED`（服务器没声明这个 provider）：之后 `plan()` 恒为 `unsupported`。 */
  noteServerDeclined(): void {
    this.declined = true
  }

  /**
   * 这一份文档要不要发请求：同修订已有快照 ⇒ `cached`（不发）；能力没声明 ⇒ `unsupported`（不发）；
   * 否则 `request`（修订变了、或从没取过）。
   */
  plan(document: object | null | undefined, revision: number): SemanticPullPlan {
    if (!document) return 'unsupported'
    if (!this.capabilityDeclared()) return 'unsupported'
    const snapshot = this.snapshots.get(document)
    if (snapshot && snapshot.revision === revision) return 'cached'
    return 'request'
  }

  /**
   * 收下这份结果。同一份文档再来一次就覆盖（本仓的取用点是"整份替换"口径：
   * 语义着色的区间必须与当前文档同源，旧修订的答案由 `src/editorSemanticField.ts` 在派发前
   * 自己挡掉 —— 它只在 `state.doc` 仍是同一对象（同一修订）时才认这份快照）。
   */
  store(document: object, revision: number, tokens: readonly SemanticToken[]): void {
    if (!this.snapshots.has(document) && this.snapshots.size >= SEMANTIC_SNAPSHOT_LIMIT) {
      const oldest = this.order.shift()
      if (oldest) this.snapshots.delete(oldest)
    }
    if (!this.snapshots.has(document)) this.order.push(document)
    this.snapshots.set(document, { revision, tokens })
  }

  /** 取这份文档当前修订的快照；**修订变了就返回 null**（= 失效，调用方重新取）。 */
  tokensFor(document: object | null | undefined, revision: number): readonly SemanticToken[] | null {
    if (!document) return null
    const snapshot = this.snapshots.get(document)
    if (!snapshot || snapshot.revision !== revision) return null
    return snapshot.tokens
  }

  /** 只作废一个文件/一份文档（上游 `invalidatePulledResults(file)` 的粒度，`:54-56`）。 */
  invalidate(document: object): void {
    if (!this.snapshots.delete(document)) return
    const index = this.order.indexOf(document)
    if (index >= 0) this.order.splice(index, 1)
  }

  /**
   * 整族作废时调（服务端 `workspace/semanticTokens/refresh` / 语言服务重启，见
   * `src/lspPerFileCache.ts` 的 `clearAllLspCaches()`）。顺带把「这条能力不支持」的记忆清掉 ——
   * 上游换语言服务客户端时是**新建** `LspClientImpl` 对象（`LspClientImpl.kt:106` 那张注册表跟着新建），
   * 能力要重新问一次；服务端既然发了 refresh，这条能力显然是有的。
   */
  clearCache(): void {
    this.snapshots.clear()
    this.order.length = 0
    this.declined = false
  }

  /** 现在缓存了几份文档的快照（判据/排查用）。 */
  get size(): number {
    return this.snapshots.size
  }
}

// ———————————————————————————————— 按特性的缓存注册表（LspHighlightingCacheRegistry）

interface HighlightingFeature {
  id: string
  /** 这一条的 provider 名（取自 `src/lspFeatureMatrix.ts`，与原生 `provider_for` 同一套）。 */
  provider: string
  cache: { clearCache(): void; invalidate(document: object): void }
}

const highlightingFeatures = new Map<string, HighlightingFeature>()

/**
 * 登记一条按特性的高亮缓存（上游 `LspHighlightingCacheRegistry.kt:37-40` 的 `register()`）。
 * **特性必须在能力表里登记过**才收：没登记 = 客户端没声明这条 capability = 这条链根本不该存在
 * （上游那时 `isSupportedForFile` 直接返回 false，请求不会发出去）。
 * 同一个 id 重复登记会顶掉旧的（本仓的实例都在模块顶层建一次，这里只兜住热重载）。
 */
export function registerHighlightingFeature(cache: SemanticHighlightingCache): boolean {
  const row = lspFeatureRow(cache.featureId)
  if (!row || row.provider === '') return false
  highlightingFeatures.set(cache.featureId, { id: cache.featureId, provider: row.provider, cache })
  return true
}

/** 注册表里的特性 id（判据与「语言服务」功能面板的排查用）。 */
export function highlightingFeatureIds(): string[] {
  return [...highlightingFeatures.keys()]
}

/** 这份文档在每条按特性缓存里作废（上游 `invalidatePulledResults(file)`，`:54-56`）。 */
export function invalidatePulledResults(document: object): number {
  for (const feature of highlightingFeatures.values()) feature.cache.invalidate(document)
  return highlightingFeatures.size
}

/**
 * 生产用的那一份语义 token 缓存（上游注册表里的 `semanticTokensCache`，`:28`）。
 * 消费链路：`src/editorSemanticField.ts` 的装饰层 —— 构建装饰前按文档修订查它，
 * 命中就不重建 `RangeSet`（上游 `LspPullResult.Unchanged` 的"保留内容不重画"），
 * 修订变了必然 miss（`semanticRevisionOf` 换对象即换号）。
 */
export const semanticHighlightingCache = new SemanticHighlightingCache()
registerHighlightingFeature(semanticHighlightingCache)

/**
 * 文档修订号：CodeMirror 的 `Text` 不可变 ⇒ **对象身份就是修订**，这里只把它压成一个稳定整数，
 * 好让缓存的命中判据是"号相同"（与上游 `modificationStamp` 同形），而不是到处传对象引用。
 */
const revisionByDocument = new WeakMap<object, number>()
let revisionSequence = 0

export function semanticRevisionOf(document: object | null | undefined): number {
  if (!document) return -1
  let revision = revisionByDocument.get(document)
  if (revision === undefined) {
    revision = ++revisionSequence
    revisionByDocument.set(document, revision)
  }
  return revision
}
