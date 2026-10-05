// 粘性作用域行（IDEA `editor.stickyLines`）：从 documentSymbol（扁平列表）里找出**包含当前光标行**的
// **作用域**符号，按 `startLine` 升序取最内层 N 条 —— 外层作用域在上，最内层贴近编辑区顶边。
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
import { stickySymbolAccepted, filterStickySymbols } from './stickyLineProviders.ts'

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

export interface StickyLinesDeps {
  editorSettings: Ref<EditorSettings>
  outline: Ref<LspDocumentSymbol[]>
  /** 当前光标行（1 基）；没打开文件时返回 undefined。 */
  currentLine: () => number | undefined
  /** 当前编辑器的语言（用来选 provider 表）；没有时走通用兜底。 */
  language?: () => string | undefined
  /** 可视区第一行（1 基）。给了就按上游那条「起始行滚出视野」筛；不给退回按光标行判。 */
  firstVisibleLine?: () => number | undefined
}

export function createStickyLines(deps: StickyLinesDeps): { stickyLines: Ref<StickyLine[]> } {
  const stickyLines = computed<StickyLine[]>(() => {
    const limit = deps.editorSettings.value.stickyLinesLimit
    const line = deps.currentLine()
    if (line === undefined || !deps.editorSettings.value.showStickyLines || !(limit > 0)) return []
    return stickyScopes(deps.outline.value, line, deps.language?.(), deps.firstVisibleLine?.())
      .slice(-Math.floor(limit))
  })
  return { stickyLines }
}

/**
 * 点击某条粘性行时的跳转目标（上游 `StickyLine.navigateOffset()` 在本仓的形状：
 * `revealLocation({ path, line })`，`line` 是 **0 基** —— 同一约定见 `src/bookmarkActions.ts:241`）。
 *
 * 订正留痕（2026-10-06 复核 `docs/wiring-requests-2026-10-06-bucket5b.md` W-2）：这里原写
 * 「渲染在 src/App.vue:2169-2171，那个 div 既没有 click 也没有键盘可达（还带 aria-hidden）」——
 * **宿主早就接上了**：现在那一行是 `src/App.vue:2191`，`role="button"` + `tabindex="0"` +
 * `@click="revealLocation(stickyRevealTarget(…))"` + `title` 「跳转到第 N 行」，`aria-hidden` 也已去掉，
 * 判据在 `tests/editor-sticky-navigate.test.mjs`。滚动量那一档（W-5）仍缺宿主透传，见同文件
 * `StickyLinesDeps.firstVisibleLine`：模块与判据齐了，缺的是 `CodeEditor.vue` 的 emit 与 `App.vue` 的实参。
 */
export function stickyRevealTarget(sticky: StickyLine, path: string): { path: string; line: number } {
  return { path, line: sticky.navigateLine }
}
