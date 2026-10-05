// 结构视图的两条缺失行为：编辑光标 ↔ 树选中的**互相跟随**，以及**按可见性排序**。
//
// 上游依据：
//   · 跟随编辑器：`StructureViewComponent.java:805-849`（`MyAutoScrollFromSourceHandler`
//     装光标监听 `:819-835`，回调 `scrollToSelectedElement()` `:655`）；两个开关是
//     `StructureViewFactoryImpl.java:49-50` 的 `AUTOSCROLL_MODE`（选中树节点→跳源码，
//     默认 **true**）与 `AUTOSCROLL_FROM_SOURCE`（光标→选中树节点，默认 **false**）。
//     到源码那一侧是 `StructureViewComponent.java:794-802`（`scrollToSource` →
//     `OpenSourceUtil.openSourcesFrom`）。
//   · 可见性排序：`VisibilitySorter.java:34`（`ID = "VISIBILITY_SORTER"`）+
//     `VisibilityComparator.java:23-29`（`accessLevel2 - accessLevel1` = 级别大的在前，
//     同级交给下一个比较器 `:26-27`）+ `PsiUtil.java:223-226`（public 4 > protected 3 >
//     package-local 2 > private 1）+ `PsiUtil.java:623-634`（按修饰符判级别）+
//     `VisibilityComparator.java:16`（判不出来 = `UNKNOWN_ACCESS_LEVEL = -1`，排在最后）。
//
// 本仓的符号来自 LSP `documentSymbol`（`native/lsp_support.cpp:155-183` 的 `collect_symbols`
// 给 name/kind/detail/起止位置），没有 PSI，所以可见性只能从 `detail` 的修饰符词面取；
// 取不到就是上游的 unknown 档 —— **不猜「无修饰符 = public」**，因为 Java 默认包级、Kotlin
// 默认公开，本仓拿不到语言信息去区分这两种。`internal`（Kotlin/Swift）在本仓落到包级档：
// 上游没有这一级，这是架构不等价下的映射决定（模块内可见 = 既非公开也非私有）。
import type { LspDocumentSymbol } from './bridge.ts'

/** `PsiUtil.java:223-226` 的四档 + `VisibilityComparator.java:16` 的 unknown。 */
export const ACCESS_LEVEL = {
  public: 4,
  protected: 3,
  packageLocal: 2,
  private: 1,
  unknown: -1,
} as const

/**
 * 从 `detail` 里判可见性档位，按 `PsiUtil.java:623-634` 的**短路次序**：
 * private → package-local → protected → public，都不认识就是 unknown。
 * `detail` 是语言服务给的声明文本（`void run()` / `private final int` / `class Sample`），
 * 所以要按词切而不是按前缀比；同一段文本里出现多个修饰词时上面的次序赢（与上游一致）。
 */
export function visibilityAccessLevel(detail: string): number {
  // 按**整个词**比（上游比的是修饰符属性，不是子串）：`package-private` 里那个 private
  // 不算 private 修饰符，所以连字符要留在词里。
  const words = (detail.toLowerCase().match(/[a-z0-9_-]+/g) ?? []) as string[]
  if (words.includes('private') || words.includes('fileprivate')) return ACCESS_LEVEL.private
  if (packageLocalMarked(words)) return ACCESS_LEVEL.packageLocal
  if (words.includes('protected')) return ACCESS_LEVEL.protected
  if (words.includes('public') || words.includes('open') || words.includes('export')) return ACCESS_LEVEL.public
  return ACCESS_LEVEL.unknown
}

/** Java 的「包级」写成 package-private / package local；Kotlin/Swift 的 internal 落同一档。 */
function packageLocalMarked(words: readonly string[]): boolean {
  return words.includes('internal') || words.includes('default')
    || words.includes('package-private') || words.includes('package-local')
    || (words.includes('package') && words.includes('local'))
}

/**
 * 符号是否算「包住这个光标」。
 * **起点按行**算：`native/lsp_support.cpp:155-183` 的 `collect_symbols` 把起点取在
 * `selectionRange`（声明名那一列），而 IDEA 的元素范围从 `public` 关键字就开始 ——
 * 光标停在这一行的缩进/关键字上时必须仍然命中这个符号，否则整行都选不中。
 * **终点仍按列**算：同行上越过终点就是越过（否则同一行后面的光标点会同时命中兄弟符号）。
 */
export function symbolContains(symbol: LspDocumentSymbol, line: number, character: number): boolean {
  if (symbol.startLine > line) return false
  if (line > symbol.endLine) return false
  if (line === symbol.endLine && character > symbol.endChar) return false
  return true
}

/** 只看行：符号声明所在行的列可能晚于光标列（缩进/关键字），退化成行级包含。 */
export function symbolLineContains(symbol: LspDocumentSymbol, line: number): boolean {
  return symbol.startLine <= line && symbol.endLine >= line
}

export interface CaretSymbolMatch {
  /** 最深一层包住光标的符号键（= 该选中的那一行）。 */
  key: string
  /** 从根到它**之前**的祖先键，面板据此展开折叠的分支。 */
  ancestors: string[]
  /** true = 只按行命中（符号声明行的列在光标之后时的退化路径）。 */
  lineOnly: boolean
}

// 光标落在哪个符号里（上游 `scrollToSelectedElement()` 的那一步）需要树的折叠键，
// 所以那趟遍历住在 `outlineView.ts` 的 `caretSymbolInTree()` —— 这里只留它用的类型与
// 两个包含判定，避免两个模块互相 import。

/**
 * 「跟随到源码」这一侧：树里选中一个节点才去动编辑器。
 * 上游 `AUTOSCROLL_MODE`（`StructureViewFactoryImpl.java:49`）默认开 —— 关掉时选中节点
 * 只更新选择，不发跳转（`StructureViewComponent.java:794-802` 的 `scrollToSource` 不再触发）。
 */
export function shouldRevealInEditor(autoscrollToSource: boolean, selectedKey: string, previousKey: string): boolean {
  return autoscrollToSource && selectedKey !== '' && selectedKey !== previousKey
}
