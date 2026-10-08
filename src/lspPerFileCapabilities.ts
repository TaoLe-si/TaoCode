// 「这个文件支持哪些语言服务特性」的**按文件 × 按特性表** —— 上游那三道闸在本仓的对应物。
//
// ## 上游是谁在决定「这条请求该不该发」
//   · **读高亮之前先问这一条特性支不支持这个文件**：
//     `platform/lsp-impl/src/impl/features/highlightingCommon/LspHighlightingCache.kt:58`
//     是每条特性的抽象闸 `isSupportedForFile(file)`，而 `:62-63` 就是本模块 `plan()` 的位置 ——
//     `getHighlightings()` 的**第一行**问它，不过就 `return emptyList()`（一份请求都不发）。
//     同一个文件 `:55` 的 `supportsPull` 把「服务端推的那一份」排除在重取之外。
//   · **每条特性自己的闸各查各的**（本轮逐条打开核对）：
//     `LspSemanticTokensCache.kt:29-36`（customizer 不是 `LspSemanticTokensSupport` ⇒ false；
//     `shouldAskServerForSemanticTokens(psiFile)`；`semanticTokensProvider.full` 不为 true ⇒ false）、
//     `LspDocumentLinkCache.kt:18-20`、`LspCodeLensCache.kt:15-20`（多一条
//     `shouldAskServerForCodeLenses(file)`）、`LspFoldingRangeCache.kt:22-24`、
//     `LspInlayHintsCache.kt:18-23`、`LspDocumentColorCache.kt:18-20`、
//     `LspPullDiagnosticsCache.kt:32-37`、`LspPublishDiagnosticsCache.kt:28`（恒 true，因为它不 pull，
//     同文件 `:31` 写的就是 `supportsPull = false`）—— 全在
//     `platform/lsp-impl/src/impl/features/…` 那几份文件里。
//   · **documentHighlight 那一族走的是入口闸**：
//     `platform/lsp-impl/src/impl/features/highlighting/LspHighlightUsagesHandlerFactory.kt:50-55`
//     三条并列（customizer 类型 + `supportsDocumentHighlights(file)` + `shouldAskServerForDocumentHighlights(file)`），
//     一条不满足就 `:24` 返回 null ⇒ **整个用法高亮 handler 不存在**，不是"发了再丢弃"。
//   · **能力本身有两级，上游分开存**（本模块照抄这个粒度，不混）：
//     `platform/lsp-impl/src/impl/LspClientImpl.kt:425-509` 那 17 个 `supports*(file)` 每条都是
//     `serverCapabilities?.X`（**语言服务级**：initialize 回包，客户端对象内不变）**或**
//     `hasDynamicCapabilityToHandleThisFile(file, …)`（**文件级**：注册时的 documentSelector 命中这个文件，
//     实现在同文件 `:612-615` → `:617-620` → `:623-626`，注释 `:622` 写明"没有 selector 的注册 = 匹配任何文件"）。
//   · **不走 LSP 的那一半也是按文件登记的**：
//     `platform/lang-impl/src/com/intellij/codeInsight/daemon/impl/analysis/HighlightingSettingsPerFile.java:45-53`
//     把设置按 URL 存成一张表，`:200-202` 的 `shouldHighlight` 与 `:206-209` 的 `shouldInspect`
//     就是"这个文件要不要跑这些分析"（基类
//     `platform/analysis-impl/src/com/intellij/codeInsight/daemon/impl/analysis/HighlightingLevelManager.java:15-23`）。
//     pass 注册表那一层同样每一趟都问一次工厂：
//     `platform/analysis-impl/src/com/intellij/codeHighlighting/TextEditorHighlightingPassRegistrar.java:18-24`
//     注释原话"Factory will be asked to create the highlighting pass every time IDE tries to highlight the file"，
//     而 LSP 那一个工厂 `platform/lsp-impl/src/impl/features/highlighting/LspHighlightingPassFactory.kt:29-36`
//     的 `createHighlightingPass` 在这个文件这一版不需要重算时**直接返回 null**。
//
// ## 本仓的三道闸分别从哪来（都是实测，不是推测）
//   1. **客户端声明**：`src/lspFeatureMatrix.ts:43-79` 那张表就是本仓的 `LspClientCapabilities` 面
//      （provider 键与宿主的 `native/lsp_support.cpp:208-244` `provider_for()` 一一对应）。
//      没登记的特性名 ⇒ 不发（与 `src/semanticHighlighting.ts:312-317` 的注册口径一致：
//      认不出来的特性名多半是写错的那个）。这一条比宿主**严**：宿主的 `provider_for` 认不出 kind 时
//      是不设闸、照样发（`native/lsp_capability_queries.cpp:95-106` 只在查得到 provider 时才判）。
//   2. **服务器级**：宿主对「服务器显式声明 `false`/`null` 的 provider」回一条
//      `LSP_UNSUPPORTED` 错误（`native/lsp_capability_queries.cpp:95-106`，调用点
//      `native/lsp_session.cpp:145`、`:296`、`:303`），对「嵌套能力没开」回一条
//      `{available:false, supported:false}` **结果**（`native/lsp_session_kinds.cpp:83-85` 的 prepareRename、
//      `:604-608` 的 completionItemResolve）。两条都是**这台服务器**对这个特性的结论，
//      对本机的每个同语言文件都一样 ⇒ 记在**语言**那一格，不记在文件上。
//      键用的语言 id 就是宿主路由用的那一个（`native/lsp_session.cpp:20-38` 的 `language_for`，
//      本模块的 `lspLanguageOfPath` 是它的镜像，判据把两份表逐条比对）。
//   3. **文件级**：本仓真正按文件登记的那份事实是逐文件高亮级别
//      （`src/highlightSettingsPerFile.ts:74-76`，上游就是上面那个 `HighlightingSettingsPerFile`）。
//      级别 `none` 的菜单描述是「不显示该文件的任何高亮与问题」（同文件 `:35`）⇒
//      画在这个文件的编辑器上、且**请求点在本仓可改文件里**的那两族（documentHighlight、inlayHint）
//      对这个文件不再请求。**导航与结构类不在这一档**（`documentSymbol`/`references`/层次/符号是
//      "去哪儿"，不是"这个文件上画什么"），上游的 NONE 也只停高亮与检查、不停结构视图。
//      codeLens / documentLink / semanticTokens 同属装饰那一族，但它们的请求点在冻结的
//      `src/components/CodeEditor.vue` ⇒ 不列进常量当摆设（接线请求 W1 落地时一并加上）。
//
// ## 与已有那两条链的分工（避免同一个闸写三遍）
//   · 语义高亮那条按文档修订的快照与它自带的 capability 闸在
//     `src/semanticHighlighting.ts:225-234`（`capabilityDeclared()` / `noteServerDeclined()`），
//     那份的粒度是**一个客户端对象**（`semanticHighlighting.ts:277-287` 的 `clearCache` 连不支持的记忆一起清）；
//     本模块补的是它没有的两样：**按文件的 `none` 档**与**多语言共存的服务器级记忆**。
//   · 批量作废沿用 `src/lspPerFileCache.ts:39-55` 的注册表（构造时自登记），两个生产触发点是
//     `src/lsSessionHost.ts:163`（语言服务重启 / 换工程）与
//     `src/lspServerMessages.ts:410`（服务器自己发 `workspace/…/refresh`）。
//     粒度如实：这两处清的是**服务器级**那一格；文件级那一道是用户设置，重启**不该**动它
//     （这正是"两种粒度别混"的地方 —— 上游换客户端会连 capabilities 一起换新对象，
//     但 `HighlightingSettingsPerFile` 是工程级持久设置，跟客户端生命周期无关）。
//
// ## 宿主还给不了的那一半（写在接线请求里，不在这里造假数据）
// 上游的**文件级**能力来源是 `client/registerCapability` 的 documentSelector
// （`platform/lsp-impl/src/impl/LspDynamicCapabilities.kt:110-127` 存注册、
// `:155-160` 的 `hasCapability`）。本仓宿主收到这两条请求只是答 null、不登记
// （`native/lsp.cpp:541-542`），前端因此拿不到「这个文件被动态注册了某能力」这条事实；
// 服务器**失败**（`LSP_FAILED`，`native/lsp_capability_queries.cpp:152-160` 把 JSON-RPC 的 code 折成一条
// 通用错误）也分辨不出是不是 `-32601 Method not found`。⇒ 本模块只把**确定的拒绝**记成拒绝。

import { highlightLevelForPath } from './highlightSettingsPerFile.ts'
import { lspFeatureRow } from './lspFeatureMatrix.ts'
import { registerLspCache } from './lspPerFileCache.ts'
import { dynamicRegistrationCovers } from './lspDynamicCapabilities.ts'

/** 一次查询的结论：`ask=false` 时 `skip` 说明是哪一道闸拦的。 */
export type FeatureSkip = 'featureNotDeclared' | 'serverDeclined' | 'fileExcluded'

export interface FeatureDecision {
  ask: boolean
  feature: string
  path: string
  /** 这个文件落在哪台服务器上（`native/lsp_session.cpp:20-38` 的 `language_for`）。 */
  language: string
  skip: FeatureSkip | null
  /** 拦下来时给的话（排查用；不承诺用户可见文案，那条走 `src/lspFeatureMatrix.ts`）。 */
  detail: string
}

/**
 * 一次 `ask()` 的三种结局：
 *   · `{asked:true, ok:true}` —— 表放行、问到了；
 *   · `{asked:true, ok:false}` —— 表放行、发出去了但这一趟失败（调用方沿用原有的吞错口径：旧结果留着）；
 *   · `{asked:false, skip}` —— **表把它拦下了，一次请求都没发**（上游 `LspHighlightingCache.kt:62-63` 的那一支）。
 */
export type FeatureOutcome<T> =
  | { asked: true; ok: true; value: T; skip: null; error: null }
  | { asked: true; ok: false; value: null; skip: null; error: unknown }
  | { asked: false; ok: false; value: null; skip: FeatureSkip; error: null }

/**
 * 文件级那道闸现在**管得住**的那些特性：画在这个文件的编辑器里、且请求点在可改文件里的那两族。
 * 依据是 `src/highlightSettingsPerFile.ts:35` 对 `none` 档的定义（「不显示该文件的任何高亮与问题」）
 * 与上游 `HighlightingSettingsPerFile.java:200-209`（`shouldHighlight` / `shouldInspect`）。
 *
 * `codeLens` / `documentLink` / `semanticTokens` 同属"画在编辑器里"那一族，但它们的请求点在
 * 冻结的 `src/components/CodeEditor.vue`（`:144`、`:151`、`:317-340`），本表在这一档**先不列它们** ——
 * 列了就是没有调用方的摆设（接线请求 W1 落地时一并加进来，判据 `tests/lsp-per-file-capabilities.test.mjs`
 * 的第 2 条会跟着改）。
 */
const FILE_DECORATION_FEATURES: readonly string[] = ['documentHighlight', 'inlayHint']

/**
 * 路径 → 语言 id：`native/lsp_session.cpp:20-38` 的 `Session::language_for` 的镜像
 * （宿主的 `unsupported()` 是按那个语言键查 capabilities 的，记错键就等于没记）。
 * 判据 `tests/lsp-per-file-capabilities.test.mjs` 把两份表逐条比对，漂了就红。
 */
export function lspLanguageOfPath(path: string): string {
  const name = path.replace(/\\/g, '/').split('/').pop() ?? ''
  const dot = name.lastIndexOf('.')
  const extension = dot > 0 ? name.slice(dot + 1).toLowerCase() : ''
  switch (extension) {
    case 'java': return 'java'
    case 'kt': case 'kts': return 'kotlin'
    case 'c': return 'c'
    case 'cpp': case 'cc': case 'cxx': case 'h': case 'hpp': case 'hh': return 'cpp'
    case 'ts': return 'typescript'
    case 'tsx': return 'typescriptreact'
    case 'js': case 'mjs': case 'cjs': return 'javascript'
    case 'jsx': return 'javascriptreact'
    case 'json': return 'json'
    case 'vue': return 'vue'
    case 'html': return 'html'
    case 'css': return 'css'
    case 'rs': return 'rust'
    case 'go': return 'go'
    case 'py': return 'python'
    default: return extension
  }
}

/** 一条拒绝错误：宿主把 `reply.error.code` 放进 `BridgeError.code`（`src/bridge.ts:893`）。 */
function declineCodeOf(error: unknown): string {
  if (typeof error !== 'object' || error === null) return ''
  const code = (error as { code?: unknown }).code
  return typeof code === 'string' ? code : ''
}

/** 一条回包里的显式「这个嵌套能力服务器没开」（`native/lsp_session_kinds.cpp:83-85`、`:604-608`）。 */
function replyDeclaresUnsupported(reply: unknown): boolean {
  if (typeof reply !== 'object' || reply === null) return false
  return (reply as { supported?: unknown }).supported === false
}

/**
 * 按文件 × 按特性的表。两层粒度分开存（见文件头「两级能力」）：
 *   · `declinedByLanguage`：语言 → 被这台服务器显式拒绝的特性（服务器级，跟着客户端生命周期）；
 *   · 文件级不存副本 —— 每次现读用户的逐文件高亮级别（工程级持久设置，重启不该清）。
 */
export class PerFileFeatureTable {
  private readonly declinedByLanguage = new Map<string, Set<string>>()

  constructor() {
    // 参与批量作废：语言服务重启（`src/lsSessionHost.ts:163`）与服务器 `workspace/…/refresh`
    // （`src/lspServerMessages.ts:410`）之后，"这台服务器不支持 X" 必须重新问一次。
    registerLspCache(this)
  }

  /**
   * 这一条请求发不发（上游 `LspHighlightingCache.kt:62-63` 那一句的位置）。
   * 三道闸按「客户端 → 服务器 → 文件」的顺序问，任何一道说不过就不发。
   */
  plan(feature: string, path: string): FeatureDecision {
    const language = lspLanguageOfPath(path)
    const base = { feature, path, language }
    const row = lspFeatureRow(feature)
    if (!row || row.provider === '') {
      return { ...base, ask: false, skip: 'featureNotDeclared', detail: `能力表里没有 ${feature}` }
    }
    if (this.declinedByLanguage.get(language)?.has(feature)) {
      // 上游 `LspClientImpl.kt:425-509` 那 17 个 `supports*(file)` 是**或**：
      // `serverCapabilities?.X != null || hasDynamicCapabilityToHandleThisFile(file, …)`。
      // 静态那一支被服务器显式关掉（本仓记在 `declinedByLanguage`）时，只要这条能力
      // 有一条**命中这个文件**的动态注册，它对这个文件就仍然成立 —— 服务器完全可以
      // 在 initialize 里不声明、随后 `client/registerCapability` 只给某些文件注册。
      // 不补这一支的话，那种服务器的能力会被静态那一格连坐（`dynamicRegistrationCovers`
      // 走 `src/lspDynamicCapabilities.ts` 的 documentSelector 规则）。
      if (!dynamicRegistrationCovers(feature, path, language)) {
        return { ...base, ask: false, skip: 'serverDeclined', detail: `${language} 服务器未声明 ${row.provider}` }
      }
    }
    if (FILE_DECORATION_FEATURES.includes(feature) && path !== '' && highlightLevelForPath(path) === 'none') {
      return { ...base, ask: false, skip: 'fileExcluded', detail: `${path} 的逐文件高亮级别是「无」` }
    }
    return { ...base, ask: true, skip: null, detail: '' }
  }

  /**
   * 发出去，并把**确定的拒绝**记进表。这是本表的唯一出口 —— 与上游同一个位置：
   * `getHighlightings()`（`LspHighlightingCache.kt:62-63`）先问 `isSupportedForFile` 再排请求，
   * 而不是"发了再看回来的是什么"。
   *
   * 只记两条确定的拒绝：`LSP_UNSUPPORTED` 错误（`native/lsp_capability_queries.cpp:95-106`）与
   * `{supported:false}` 回包（`native/lsp_session_kinds.cpp:83-85`、`:604-608`）。
   * `LSP_FAILED`（服务器自己失败）与 `LSP_CLOSED`/`LSP_UNAVAILABLE`（文档没开 / 服务器还没起，
   * 宿主的 `ensure()` 会懒起）**不记** —— 记了就等于一次抖动把这条能力判死到下次重启。
   */
  async ask<T>(feature: string, path: string, execute: () => Promise<T>): Promise<FeatureOutcome<T>> {
    const decision = this.plan(feature, path)
    if (!decision.ask) return { asked: false, ok: false, value: null, skip: decision.skip ?? 'featureNotDeclared', error: null }
    try {
      const value = await execute()
      if (replyDeclaresUnsupported(value)) this.noteServerDeclined(feature, path)
      return { asked: true, ok: true, value, skip: null, error: null }
    } catch (error) {
      if (declineCodeOf(error) === 'LSP_UNSUPPORTED') this.noteServerDeclined(feature, path)
      return { asked: true, ok: false, value: null, skip: null, error }
    }
  }

  /** 记下「这台服务器（= 这个语言）不支持这个特性」。返回是不是新记的一条（`ask()` 是唯一的生产调用方）。 */
  noteServerDeclined(feature: string, path: string): boolean {
    const language = lspLanguageOfPath(path)
    const declined = this.declinedByLanguage.get(language) ?? new Set<string>()
    this.declinedByLanguage.set(language, declined)
    if (declined.has(feature)) return false
    declined.add(feature)
    return true
  }

  /** `LspCache` 的整批作废：换语言服务 = 上游那个客户端对象换新，capabilities 重问一遍。 */
  clearCache(): void {
    this.declinedByLanguage.clear()
  }
}

/** 生产用的那一份表（消费点：`src/editorSymbolHighlight.ts`、`src/editorInlayHints.ts`、`src/cvLocalVision.ts`）。 */
export const lspFileFeatures = new PerFileFeatureTable()
