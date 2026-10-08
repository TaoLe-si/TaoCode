// 粘性作用域行（IDEA `editor.stickyLines`）：从 documentSymbol（扁平列表）里找出能当作用域的符号，
// 钉在编辑区顶边 —— 外层作用域在上，最内层贴近编辑区。
// 两条候选路径（同上游）：拿到面板度量时按**可视区**取候选（`stickyWindowScopes`，光标在哪儿无关），
// 拿不到时退回按**光标行**取候选（`stickyScopes`）。
//
// 2026-10-06 `stickyfold` 在本文件补的三条**档位**（逐条对上上游行号，判定见
// `docs/batch-2026-10-06-stickyfold.md` §1）：
//   · `stickyLinesLimit` 的设置页档 = **默认 5 / 最小 1 / 最大 20**（`STICKY_LINES_LIMIT_*`）；
//     模块**不夹**用户存下来的值（上游读取侧也不夹），只把它当唯一真源交给设置页与校验层；
//   · 短面板时按「放得下的那一前缀」出层（`stickyViewRowBudget`），不再因为总条数放不下就整块清空；
//   · 多块面板时**共享的** `firstVisibleLine` 不再参与任一栏的筛选（退化路径 `fallbackScrollTop`）——
//     上游的可视区一份一块面板（`StickyLinesManager.kt:15-34` + `:86-99`），邻居的滚动量筛不出本栏的层。

//
// 从 `App.vue` 抽出来（那一层贴着行数硬上限）：这里只有一条纯规则 + 三个只读依赖，
// 与"设置/结构视图/当前行"三处状态的关系一眼能看完，也便于单测。
//
// IDEA 侧的形状：粘性行由**语言自己的 provider** 给出（它只认作用域节点：类/方法/函数/命名空间…），
// 不是把文档里的每个符号都挂上去 —— 哪一族节点算作用域是 `src/stickyLineProviders.ts` 的
// 「语言 → SymbolKind」表（`StickyLinesProvider` 的 EP 等价物），本模块只管「包含光标行 + 同名行去重 + 截断」。
// 视口滚动那一档（"作用域起始行滚出视野才算粘住"）由 `stickyScopes` 的 `firstVisibleLine` 承接
// （上游 `VisualStickyLines.kt:67-86` 按 `visibleArea` 的顶行算）；本仓的顶边渲染在 `App.vue`、
// 滚动量在 `CodeEditor.vue` 里，两个都是冻结文件 ⇒ 拿不到时退回按**光标行**判：光标行（1 基）落在
// 符号的 0 基区间 `[startLine, endLine]` 内就算一层（起始行本身也算 —— 作用域包含这一行）。
// 视口那一层的**完整判据**（窗口相交而不是包含光标、作用域至少 5 行才算一层、面板放不下就
// 一条都不画、排满上限即停、每个分栏各算各的、新分栏第一次必跑采集）在
// `src/stickyLineViewport.ts`，`createStickyLines` 拿到宿主的 `view`（面板身份 + 度量）就走那条，
// 拿不到时保留上面这份按光标行的退化路径。宿主侧的实参是接线请求（面板身份只有 `App.vue` 有）。
// **多分栏那一档在出口处的形状**（2026-10-06 `stickyprio` 补的缺）：上游的模型挂在**文档**上
// （`StickyLinesModelImpl.java:93-100` 一份文档一份模型）、面板与可视区挂在**每个编辑器**上
// （`StickyLinesManager.kt:15-34` 每 editor 一个 manager、`:86-99` 由自己的 visibleArea 驱动重算）
// ⇒「层是共享的、显示哪些层各算各的」。`createStickyLines` 因此给两份出口：
//   · `stickyLinesByView` —— 每块面板按**自己的**可视区各算一份，键序 = 宿主档位的稳定序（`orderStickyViews`）；
//   · `stickyLines` —— 顶边那一格该显示的那一份 = 排在最前的那块（`primaryStickyView`），
//     一块面板身份都没有时退回上面那条按光标行的路径（现状：`src/App.vue:544` 就是这么调的）。
// 「视图优先级」的**先后本身**在上游无法核实（2026-10-06 `stickyprio` 把两个目录逐行再开一遍：
// `platform/platform-impl/src/com/intellij/openapi/editor/impl/stickyLines/` 与
// `platform/lang-impl/src/com/intellij/codeInsight/stickyLines/` grep `priority` 都**零命中**）
// ⇒ 档位只能由宿主给（`StickyView.priority`），模块只把它落成稳定序，不替宿主编「哪个分栏在上」；
// 能核实的排序只有同一块面板内的层序（`StickyLinesModelImpl.java:287-296`：起始升序、同起点宽的在前）。
// 上游还有一件事本仓原本没做：**粘性行是能点的**。
//   · `platform/platform-impl/src/com/intellij/openapi/editor/impl/stickyLines/StickyLine.kt:36-41`
//     —— `navigateOffset()` 的注释就是「鼠标点击时把光标放到的 offset，通常是元素自己的 textOffset」；
//   · `ui/StickyLineComponent.kt:44-50` 给这条 sticky 行挂了鼠标监听（`:211` 的 debug 串里就叫 `offsetOnClick`）；
//   · LSP 那一侧的取数：`platform/lsp-impl/src/impl/features/documentSymbol/LspFileBreadcrumbsCollector.kt:57-59`
//     先用 `symbol.selectionRange.start`，取不到才退回 `symbol.range.start`。本仓的 `LspDocumentSymbol`
//     （`src/bridge.ts:143`）只有 `range` 那一半 ⇒ `navigateLine` 用 `startLine`（= 上游的退路档）。
//
// 判词订正（`docs/inventory/verdict-platform_rest.md:362`「缺：把 provider 接进 App.vue 的顶边渲染，
// 现路径只过通用表」）：这一条**已经成立地过期了** —— `src/stickyLineProviders.ts` 的语言表接在
// `stickyScopes` 前面（本文件 `filterStickySymbols` 那一行），`src/App.vue:497` 也把当前编辑器语言喂了进来，
// 判据在 `tests/tab-sticky-lines.test.mjs:72-76`；Java 误认 `struct` 那一档已经没了。
// 另外要说清：**上游 LSP 链路本身不按 SymbolKind 过滤**（`LspFileBreadcrumbsCollector.kt:45-64`
// 只是把「包含这个偏移的符号链」逐级取出来映射成 `StickyLineInfo`），它天然拿不到 `struct` 是因为
// PSI/服务器给的层级里没有；本仓拿的是扁平日语列表 ⇒ 「按语言给 kind 白名单」是本仓侧的等价手段，
// 不是上游的逐字移植（留痕）。参与不参与这一层由 provider 决定：
// `StickyLinesLanguageSupport.kt:45-53` 遍历 `BreadcrumbsProvider.EP_NAME.extensionList`，
// LSP 文件走 `LspFileBreadcrumbsCollector.kt:66-71`（要 `documentSymbolCustomizer.breadcrumbsSupport`，
// 默认值 `platform/lsp/src/api/customization/LspDocumentSymbolCustomizer.kt:23` 是 true、`:28` 是 false）；
// 本仓的对应关系是「没有 LSP ⇒ `outline` 是空的 ⇒ 一行都不出」，与上游 `computeStickyLineInfos`
// 那两条 `?: emptyList()` 同一效果。
import { computed, type Ref } from 'vue'
import type { EditorSettings, LspDocumentSymbol } from './bridge.ts'
import { stickySymbolAccepted, filterStickySymbols, stickyLinesShownForLanguage } from './stickyLineProviders.ts'
import { compareStickyScopes, orderStickyViews, primaryStickyView, stickyVisualLines, type StickyView } from './stickyLineViewport.ts'

/**
 * `stickyLinesLimit` 这一项**设置页**的档位（2026-10-06 `stickyfold` 逐行开上游核对）：
 * 上游 `platform/platform-impl/src/com/intellij/openapi/editor/impl/stickyLines/configurable/StickyLinesConfigurableUI.kt:40`
 * 那一格是 `intTextField(UINumericRange(5, 1, 20).asRange())` ⇒ **默认 5、最小 1、最大 20**；
 * 默认值另有一份：`platform/ide-core-impl/src/com/intellij/openapi/editor/ex/EditorSettingsExternalizable.java:94`
 * 的 `public int STICKY_LINES_LIMIT = 5`。
 *
 * ⚠ 这三份数字是**设置页那一格**的档，不是编辑器的档：上游读取侧一律不夹取 ——
 * `EditorSettingsExternalizable.java:549-556` 的 setter 只比 old/new 就赋值、
 * `platform/platform-impl/src/com/intellij/openapi/editor/impl/EditorSettingsState.kt:227` 原样读、
 * `SettingsImpl.kt:729-731` 原样交给编辑器 ⇒ 手改存档写 25 时编辑器就排 25 条。
 * 所以本模块**不拿这三份数字去夹 `limit`**（那会改掉用户存下来的值），只把它作为**唯一真源**
 * 交给设置页与校验层：本仓现在三处都停在 0…10（`src/components/SettingsDialog.vue:910`、
 * `src/previewSettings.ts:70`、`native/settings_schema.cpp:123-126`）⇒ 11…20 这一档用户拿不到，
 * 收口写在 `docs/wiring-requests-2026-10-06-stickyfold.md` R-1。
 */
export const STICKY_LINES_LIMIT_DEFAULT = 5
export const STICKY_LINES_LIMIT_MIN = 1
export const STICKY_LINES_LIMIT_MAX = 20

/**
 * 这一块面板**放得下几行**粘性行（上游 `VisualStickyLines.kt:125-127` + `:144-148` 的
 * 「排到放不下就 `break`」在合成处的落地，2026-10-06 `stickyfold`）：
 * 上游每收一条就问一次 `isPanelTooBig`（`:158-160` = `panelHeight + 2*lineHeight > editorH/2`），
 * 超了就停 ⇒ 短面板时**外层那前几条照样显示**。`stickyVisualLines` 里那份
 * `stickyPanelFits` 判的是**最终条数**（`src/stickyLineViewport.ts:154`），一条都不给就整块清空 ⇒
 * 只靠它，「上限 20 + 面板只放得下 3 行」这一档会一条都不出（用户可见：小分栏里粘性行凭空消失）。
 * 这里按同一个不等式反解出行数预算：`rows*lh + 2*lh <= vh/2` ⇔ `rows <= vh/(2*lh) - 2`。
 * 没有度量（`lineHeight`/`viewportHeight` 任一没给）时**不夹**，与旧行为逐字一致。
 *
 * 登记一条仍存在的差异（不改 `stickyLineViewport.ts`，它不在本 lane 名下）：上游 `break` 发生在
 * `:141-143` **收下那条之后** ⇒ 溢出边界上那一条其实会被留下（如 `vh=200, lh=20, limit>=4`
 * 时上游留 4 条）；本函数按「严格放得下」取 3 条，宁少一条也不多画一行把编辑区顶走。
 */
export function stickyViewRowBudget(view: StickyView, limit: number): number {
  const rows = Math.max(0, Math.floor(limit))
  const lineHeight = view.lineHeight
  const viewportHeight = view.viewportHeight
  if (!lineHeight || lineHeight <= 0 || !viewportHeight || viewportHeight <= 0) return rows
  return Math.min(rows, Math.max(0, Math.floor(viewportHeight / (2 * lineHeight) - 2)))
}


/**
 * 一条粘性行："挂在编辑器顶边的作用域名 + 它的行号区间"。
 * `startLine`/`endLine` 是 0 基（与 `outline`、`revealLocation` 同一口径）；
 * `navigateLine` 是**点击这一条时要落到的行**（上游 `StickyLine.navigateOffset()`，`StickyLine.kt:36-41`），
 * 现在等于 `startLine`（本仓没有 selectionRange，见文件头）。行号同时用于 `App.vue` 的 `:key`。
 */
export interface StickyLine { name: string; startLine: number; endLine: number; navigateLine: number }

/**
 * 这条文档符号能当这个语言的粘性层吗（`filterStickySymbols` 的单条问法）：
 * kind 在**该语言的 provider 表**里、行号合法、名字非空。语言侧与通用兜底的差别见
 * `src/stickyLineProviders.ts`（例如 Java 不认 `struct`，Python/Go 这类不认整文件的 `package` 层）。
 * 语言未定时（编辑器还没判出语言）走通用兜底表。
 */
export function isScopeSymbol(symbol: LspDocumentSymbol, language?: string): boolean {
  return stickySymbolAccepted(symbol, language)
}

/**
 * 包含某一行的作用域，**外层在前**（`startLine` 升序）。
 *
 * `language` 决定哪些 kind 算作用域（`StickyLinesProvider` 表）；先过那一层，再去重与排序。
 *
 * 同一行起头会有多条（`class A { void m() { … } }` 挤在一行时）：`App.vue` 拿 `startLine` 当 key，
 * 留两条会撞 key、两行还会跳到同一个位置 —— 同行只留**最内层**（`endLine` 最小）那条；
 * 区间完全相同（一行的类与方法）时按结构视图给的顺序留最外层那条。
 */
export function stickyScopes(
  outline: readonly LspDocumentSymbol[], line: number, language?: string, firstVisibleLine?: number,
): StickyLine[] {
  const candidates = filterStickySymbols(outline, language)
    .filter(symbol => symbol.startLine < line && line <= symbol.endLine)
    .sort((left, right) => left.startLine - right.startLine || left.endLine - right.endLine)
  // 上游钉的是**起始行已经滚出可视区顶部**的那些作用域：`VisualStickyLines.kt:67-86`
  // 的 `collectLogical` 从 `visibleArea.y` 换算出顶行（`StickyLinesManager.kt:32,86,111`
  // 由 `visibleAreaChanged` 驱动重算），不是光标行。给了 `firstVisibleLine`（1 基）就按这一条筛；
  // 不给时退回按光标行判（顶边渲染在 `App.vue`，滚动量要从 `CodeEditor.vue` 透出来 ⇒ 交接线请求）。
  const scrolledOut = (startLine: number): boolean =>
    firstVisibleLine === undefined || startLine + 1 < firstVisibleLine
  const out: StickyLine[] = []
  for (const symbol of candidates) {
    const previous = out[out.length - 1]
    if (previous && previous.startLine === symbol.startLine) continue
    if (!scrolledOut(symbol.startLine)) continue
    out.push({ name: symbol.name, startLine: symbol.startLine, endLine: symbol.endLine, navigateLine: symbol.startLine })
  }
  return out
}

/**
 * 可视区窗口里的候选作用域（上游 `VisualStickyLines.collectLogical:66-87` 那一层）：
 * **候选不看光标行** —— 模型里是「整篇文档的每一个作用域」
 * （`StickyLinesCollector.kt:104-109` 对**每一行**问一次 provider，与光标在哪儿无关），
 * 面板拿的是「与可视区顶部那一段相交」的那些（`processStickyLines(startOffset, endOffset)`，`:83`）。
 * 本函数只做「起始行已经滚出可视区顶部」这一档过滤（上游在 `setYLocation:128-149` 里用
 * `startY2 < stickyY` 表达：起始行还看得见的层不必再钉一遍），相交/宽度/去重/上限
 * 交给 `stickyVisualLines`。
 *
 * 与 `stickyScopes` 的差别就是**光标**那一条：按光标筛会把「光标不在其中、但正压在可视区顶部」
 * 的那些兄弟层（同一个类里的另一个方法）整族丢掉，而它们是上游会钉出来的行。
 * 保留 `stickyScopes` 是给没有面板度量的退化路径（那条只能按光标行判）。
 */
export function stickyWindowScopes(
  outline: readonly LspDocumentSymbol[], firstVisibleLine: number, language?: string,
): StickyLine[] {
  const out = filterStickySymbols(outline, language)
    .filter(symbol => symbol.startLine + 1 < firstVisibleLine)
    .sort(compareStickyScopes)
    .map(symbol => ({ name: symbol.name, startLine: symbol.startLine, endLine: symbol.endLine, navigateLine: symbol.startLine }))
  return out
}

export interface StickyLinesDeps {
  editorSettings: Ref<EditorSettings>
  outline: Ref<LspDocumentSymbol[]>
  /** 当前光标行（1 基）；没打开文件时返回 undefined。 */
  currentLine: () => number | undefined
  /** 当前编辑器的语言（用来选 provider 表）；没有时走通用兜底。 */
  language?: () => string | undefined
  /**
   * 「哪些语言的粘性行是关着的」那张表（宿主设置里的一份，`EditorSettingsExternalizable` 的
   * `mapLanguageStickyLines:148`，读法是 `areStickyLinesShownFor:520-526`：**没记的语言一律开**）。
   * 本仓还没有这个设置键 ⇒ 不给 = 全部语言都开（与上游默认档一致）。
   * 关掉某一项的入口在上游是弹层动作 `StickyLinesDisableForLangAction.kt:24-29`
   * 与设置页的语言复选框（`StickyLinesConfigurableUI.kt:52-62`），两处都要新键 ⇒ 交接线请求。
   */
  stickyLanguages?: () => Record<string, boolean> | undefined
  /** 可视区第一行（1 基）。给了就按上游那条「起始行滚出视野」筛；不给退回按光标行判。 */
  firstVisibleLine?: () => number | undefined
  /**
   * 这块**面板**的身份与度量（`src/stickyLineViewport.ts` 的 `StickyView`）：
   * 宿主知道自己是哪个分栏、可视区顶行与行高是多少。给了 `firstVisibleLine` 就走上游那一层的
   * 完整判据（窗口相交 + 最小宽度 + 面板放不下就不画 + 从外层起排满上限即停）；
   * 没给时保留下面这条按光标行的退化路径。
   */
  view?: () => StickyView | undefined
  /**
   * **多分栏**：同时开着几块编辑器面板时，一块面板一项
   * （上游 `StickyLinesManager.kt:15-34` 每个 editor 一个 manager + 面板、`:86-99` 各自跟自己的
   * visibleArea；模型挂在**文档**上 `StickyLinesModelImpl.java:93-100` ⇒ 同一个文件开两栏时
   * 层是同一份、显示哪些层各算各的）。
   * 本仓的面板身份 = `Pane`（`src/editorGroups.ts:6` 的 `0 | 1`），只有 `App.vue` 知道 ⇒ 实参是接线请求。
   * `priority` 由宿主给（模块不编「哪个分栏在上」，见文件头那条**无法核实**的留痕）；
   * 没给档位的项排在给过的之后、彼此保持这里的先后。
   * 给了 `views` 就以它为准；只给了上面那个 `view`（单块）时等价于 `views: () => [view]`。
   */
  views?: () => StickyView[]
  /**
   * 每块面板**自己**的光标行（1 基；本仓就是 `groups[pane].activeLine` 那一份，`App.vue` 有）。
   * 「没有面板度量 ⇒ 退回按光标行判」这条退化路径也要**各栏各自的**，否则两栏会显示同一份
   * 按聚焦栏光标算出来的层。没给时各块共用 `currentLine()`（= 现状，不假装各栏一份）。
   */
  currentLineOf?: (viewId: string) => number | undefined
}

/** `createStickyLines` 的两份出口：每块面板各一份 + 顶边那一格该显示的那一份。 */
export interface StickyLinesResult {
  /** 顶边那一格：优先级最前那块面板的结果；一块面板身份都没有时是按光标行的退化路径。 */
  stickyLines: Ref<StickyLine[]>
  /** 每块面板各算一份，**键序 = `orderStickyViews` 的序** ⇒ 渲染层 `stickyLinesByView.get(pane)` 直接取那一份。 */
  stickyLinesByView: Ref<Map<string, StickyLine[]>>
}

export function createStickyLines(deps: StickyLinesDeps): StickyLinesResult {
  // 两道闸门抽在一处，两份出口共用同一份判定 —— 免得「顶边那一格画了，按面板取的那份却是空」
  // 这种两套开关各说各话。「这一语言的粘性行关了吗」（`areStickyLinesShownFor:520-526`）
  // 与全局开关是两条独立的路：上游关掉某个语言只让那个语言的层消失，全局那条 `SHOW_STICKY_LINES` 管全部。
  const gate = computed(() => {
    const settings = deps.editorSettings.value
    const limit = settings.stickyLinesLimit
    if (!settings.showStickyLines || !(limit > 0)) return null
    const language = deps.language?.()
    if (!stickyLinesShownForLanguage(deps.stickyLanguages?.(), language)) return null
    return { limit, language }
  })
  /** 宿主的面板清单：`views` 优先；只给了单块 `view` 时等价于 `[view]`（旧调用方一律不受影响）。 */
  const declaredViews = (): StickyView[] => {
    const many = deps.views?.()
    if (many?.length) return many
    const one = deps.view?.()
    return one ? [one] : []
  }
  /**
   * 「起始行滚出视野才算粘住」这一档在**退化路径**里用的顶行，只能属于这一块面板：
   * 上游 `StickyLinesManager.kt:86-99` 的 `visibleAreaChanged` 把 `activeVisualArea` 存成
   * **本编辑器**的可视区（每个 editor 一个 manager，`:15-34`），候选窗口由它换算
   * （`VisualStickyLines.kt:70-74`）⇒ 一块面板的滚动量筛不出另一块面板的层。
   * `deps.firstVisibleLine` 是一份**共享**的宿主实参（它描述不了几块面板），所以只在宿主
   * 没声明多块面板时当顶行用（一块也没有 = W-5 那条过渡接线，行为逐字不变）；声明了两块以上时
   * 各栏只认自己的 `view.firstVisibleLine`（走到这里就是没有）⇒ 退回纯按光标行判，
   * 不拿邻居的滚动量凑数。
   */
  const fallbackScrollTop = (): number | undefined =>
    declaredViews().length > 1 ? undefined : deps.firstVisibleLine?.()
  /**
   * **这一块**面板该显示哪些层。有它自己的可视区顶行 ⇒ 走上游那一层的完整判据
   * （候选来自可视区而不是光标行 `VisualStickyLines.kt:66-87`；`:134` 的 `startY2 < stickyY`
   * 判的是「起始行滚出了这一块面板的顶边」⇒ 候选池必须按**本栏**的顶行现取，
   * 不能几栏共用一份池子（`stickyLinesPerView` 那个签名收的是共享候选），
   * 否则会把「在本栏里起始行还看得见」的层也钉一遍）。
   * 没有度量 ⇒ 退回按**这一栏**的光标行判（`currentLineOf` 没给时各栏共用 `currentLine()`）。
   * 两条路裁的方向同一个：留最外 `limit` 条、裁掉最内的
   * （`VisualStickyLines.kt:144-148` 排满即 `break` + `VisualStickyLine.kt:21-27` 的 primaryLine 升序
   * = 外层在前；反向会让同一份文件在「有没有面板度量」时给出不同的粘性行，是缺陷不是设计）。
   */
  const linesForView = (view: StickyView, language: string | undefined, limit: number): StickyLine[] => {
    const rows = stickyViewRowBudget(view, limit)
    if (view.firstVisibleLine !== undefined) {
      return stickyVisualLines(stickyWindowScopes(deps.outline.value, view.firstVisibleLine, language), view, rows)
    }
    const line = deps.currentLineOf?.(view.id) ?? deps.currentLine()
    if (line === undefined) return []
    return stickyScopes(deps.outline.value, line, language, fallbackScrollTop()).slice(0, rows)
  }
  const stickyLinesByView = computed<Map<string, StickyLine[]>>(() => {
    const out = new Map<string, StickyLine[]>()
    const ctx = gate.value
    if (!ctx) return out   // 关掉开关 / 上限 0 / 这一语言关着 ⇒ 一块面板都没有，渲染层据此不画那一格
    // 键序 = 宿主档位的稳定序（`orderStickyViews`）⇒ 渲染层直接按这个序往下排，不必再排一遍。
    for (const view of orderStickyViews(declaredViews())) out.set(view.id, linesForView(view, ctx.language, ctx.limit))
    return out
  })
  const stickyLines = computed<StickyLine[]>(() => {
    const ctx = gate.value
    if (!ctx) return []
    // 顶边只有**一个**渲染容器（`src/App.vue:2172` 那一格）⇒ 显示排在最前那块面板的那一份。
    const primary = primaryStickyView(declaredViews())
    if (primary) return stickyLinesByView.value.get(primary.id) ?? []
    // 宿主连一块面板身份都没给（现状 `src/App.vue:544`）⇒ 保持按光标行的退化路径，行为与旧的一致。
    const line = deps.currentLine()
    if (line === undefined) return []
    // 裁的方向与 `linesForView` 那两条同一个（留最外 N 条）⇒ 这里必须是 `slice(0, N)`，改成 `slice(-N)` 就是缺陷。
    return stickyScopes(deps.outline.value, line, ctx.language, deps.firstVisibleLine?.()).slice(0, Math.floor(ctx.limit))
  })
  return { stickyLines, stickyLinesByView }
}

/**
 * 点击某条粘性行时的跳转目标（上游 `StickyLine.navigateOffset()` 在本仓的形状：
 * `revealLocation({ path, line })`，`line` 是 **0 基** —— 同一约定见 `src/bookmarkActions.ts:241`）。
 *
 * 订正留痕（2026-10-06 复核 `docs/wiring-requests-2026-10-06-bucket5b.md` W-2）：这里原写
 * 「渲染在 src/App.vue:2169-2171，那个 div 既没有 click 也没有键盘可达（还带 aria-hidden）」——
 * **宿主早就接上了**：现在那两条是 `src/App.vue:2172`（那一格 `v-if="stickyLines.length && pane === focusedPane"`）
 * 与 `:2173`（`role="button"` + `tabindex="0"` + `@click="revealLocation(stickyRevealTarget(…))"` +
 * `title` 「跳转到第 N 行」，2026-10-06 `stickyprio` 复核磁盘重订的行号，原文写 2191 已经漂了），`aria-hidden` 也已去掉，
 * 判据在 `tests/editor-sticky-navigate.test.mjs`。滚动量那一档（W-5）仍缺宿主透传，见同文件
 * `StickyLinesDeps.firstVisibleLine`：模块与判据齐了，缺的是 `CodeEditor.vue` 的 emit 与 `App.vue` 的实参。
 * 多分栏那一份（`StickyLinesDeps.views` / `currentLineOf` 与出口 `stickyLinesByView`）同样只差宿主实参，
 * 请求写在 `docs/wiring-requests-2026-10-06-stickyprio.md`。
 */
export function stickyRevealTarget(sticky: StickyLine, path: string): { path: string; line: number } {
  return { path, line: sticky.navigateLine }
}
