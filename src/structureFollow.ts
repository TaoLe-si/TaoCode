// 结构视图的三条缺失行为：编辑光标 ↔ 树选中的**互相跟随**、**按可见性排序**、
// 以及**折叠态按文件保存/取回**（见文件末尾那一节）。
//
// 上游路径速查（pvtree5 在只读树里逐条 `find` + `sed -n` 复开过；下面引的行号都是这一份的）：
//   · `platform/structure-view-impl/src/com/intellij/ide/structureView/newStructureView/StructureViewComponent.java`
//   · `platform/structure-view-impl/src/com/intellij/ide/structureView/impl/StructureViewFactoryImpl.java`
//   · `platform/structure-view-impl/src/com/intellij/ide/impl/StructureViewWrapperImpl.kt`
//   · `platform/structure-view-impl/src/com/intellij/ide/util/FileStructurePopup.java`
//   · `java/java-structure-view/src/com/intellij/ide/structureView/impl/java/{KindSorter,VisibilitySorter,VisibilityComparator,JavaFileTreeModel,PsiMethodTreeElement,JavaVariableBaseTreeElement}.java`
//   · `platform/editor-ui-api/src/com/intellij/ide/util/treeView/smartTree/{Sorter,SorterUtil}.java`
//   · `java/java-psi-api/src/com/intellij/psi/util/PsiUtil.java`
//   （注意：`StructureViewComponent.java` **不在** `platform/lang-impl/.../util/treeView/` 下，
//   那条路径在上游树里不存在 —— 2026-10-06 有判决按那条路径找过，按这一节订正。）
//
// 上游依据：
//   · 跟随编辑器：`StructureViewComponent.java:804-849`（`MyAutoScrollFromSourceHandler`
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

/** 面板与宿主之间那份**光标源**（`src/App.vue` 的 `todoSource` + 列）。 */
export interface CaretSource { path: string; line: number; character?: number }

/**
 * 给宿主那份只有 `{path, line}` 的光标源补上**列**（`docs/wiring-requests-2026-10-06-welcome2.md`
 * 的 R-1，在**上下文层**落，不要求宿主改 `src/App.vue`）。
 *
 * 为什么这一栏值钱：上游选中的是光标**偏移量**底下那个元素
 * （`StructureViewComponent.java:655` 的 `scrollToSelectedElement()` → `:677` 的
 * `scrollToSelectedElementLater()` → `:690-692` 的 `doFindSelectedElement()` =
 * `myTreeModel.getCurrentEditorElement()`，光标监听装在 `:805-849` 的 `MyAutoScrollFromSourceHandler`
 * 里，`:819-835` 的 `addEditorCaretListener`），只有行没有列时本仓只能退化成
 * 「同一行取文档序第一个」（`src/outlineView.ts:142-154` 的 `pickCaretCandidate`：
 * `startChar <= character` 的那些里挑起点最靠右的，一个都没有就取文档序第一个）——
 * `int alpha; int beta;` 这种同一行两个符号，光标在 `beta` 上亮的却是 `alpha`。
 *
 * 列从哪儿来（都在本仓实测）：宿主 `src/App.vue` 的活动标签页对象带着编辑器给的 1 基列
 * （`@cursor="(line, column) => { tab.line = line; tab.column = column }"`，值来自
 * `src/components/CodeEditor.vue:1022` 的 `emit('cursor', line.number, pos - line.from + 1)`），
 * 与 `todoSource.line` 是**同一个** tab 上的两栏 ⇒ 上下文层（`src/toolViewContext.ts`）
 * 从同一份 `active` 取，不新起第二个数据源、也不改宿主那一行。
 * 宿主没给列时**不写**那个键（面板读到的仍是 `{path, line}` 那一形状，
 * 换算那一步 `caretCharacterInSymbolBasis(undefined) = 0` 自己兜住）；
 * 没有光标源时给 `null` —— 面板据此**不画**「跟随编辑器光标」那个开关（不放假控件）。
 */
export function caretSourceWithCharacter(
  source: { path: string; line: number } | null | undefined, character: number | undefined,
): CaretSource | null {
  if (!source) return null
  return character === undefined ? { path: source.path, line: source.line }
    : { path: source.path, line: source.line, character }
}

/**
 * 编辑器那一侧的列 → 符号区间的 LSP 列。
 *
 * 两套口径（都在本仓实测）：
 *   · 编辑器给的列是 **1 基** —— `src/components/CodeEditor.vue:1022`
 *     `emit('cursor', line.number, pos - line.from + 1)`；
 *   · 符号的 `startChar`/`endChar` 是 **0 基** —— `native/lsp_support.cpp:174-175` 的
 *     `collect_symbols` 把 LSP `documentSymbol` 的 `character` 原样透传（LSP 位置一律 0 基，
 *     本仓的跳转口径也是 0 基：`src/components/CodeEditor.vue:815` 的 `applyReveal`
 *     用的就是 `target.line + 1`）。
 * 宿主还没给列时按 0 处理（= 行首），与 `caretSymbolInTree` 的默认入参同一档：
 * 上游 `scrollToSelectedElement` 的选中只看行包住光标，列只是「同一行里更具体」的加分项。
 */
export function caretCharacterInSymbolBasis(character: number | undefined): number {
  return Math.max(0, (character ?? 1) - 1)
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

// ---------------------------------------------------------------------------
// 折叠态的「按编辑器保存 / 取回」（上游 `StructureViewComponent.java:397-428`）。
// 上一版面板在换文件时把折叠整张清空，于是「把 A 收到只剩顶层 → 切去 B → 切回 A」
// 之后折叠没了 —— 上游这一趟是**保留**的：
//   · `storeState()`：`TreeState.createOn(myTree, new TreePath(root))` 存进
//     **那个 FileEditor** 的 user data（`:400-405`），换编辑器时被调用
//     （`StructureViewWrapperImpl.kt:478` 的 `myStructureView!!.storeState()`）；
//   · `restoreState()`：新编辑器装好后从 user data 取回（`:415-427`，
//     `StructureViewWrapperImpl.kt:552` 调用），**取到就用、同时把那份清掉**
//     （`:426` 的 `editor.putUserData(STRUCTURE_VIEW_STATE_KEY, null)` —— 一次性消费，
//     下一次隐藏时 `storeState()` 会重新写一份）；取不到才按默认深度展开（`:418-421`）。
//
// 本仓架构不等价之处（照实写）：面板只有一个组件实例、没有 `FileEditor` 对象可以挂状态，
// 所以这里按**文件路径**分桶存，并给一个数量上限（超出按先到先丢，Map 保持插入序）。
// 上游那份随编辑器销毁而消失，本仓这份随上限被淘汰 —— 用户可见的行为（切回来还在）一致。
//
// **同形状的两份在前，本模块为什么不复用**（账记在 `docs/batch-2026-10-06-pvclose.md` §2）：
//   · `src/usageViewTreeModel.ts:210-217` 的 `usageTreeRowIds` 与 `:275-315` 的 `carryUsageTreeExpansion`
//     —— 入参是 `UsageTreeRow`（要 `kind/path/line/character/count/collapsible`），做的是**同一棵树
//     重建前后**按行 id 对账；本处不是重建，是**换根**（从 A 文件切到 B 文件），存的是
//     「哪几个键收着」这一张集合，没有行对象可对账 ⇒ 车不上。
//   · `src/hierarchyRows.ts:123-135` 的 `captureHierarchyExpansion` + `:152` 的 `planHierarchyExpansion`
//     —— 同样是**同一棵树刷新前后**（抓展开过的路径、重建后按路径认回来），而且那个文件的文件头
//     `:15-21` 已经替这条规则写过一次「为什么不复用 usage 那两份」；本处要的是**跨文件**按路径分桶
//     + 上界淘汰，那两个函数给不出「按 path 分桶」这一维 ⇒ 也不复用。
//   ⇒ 结论：本模块是这条规则的**第三个实例，但不同维度**（前两个 = 同树重建，本处 = 跨文件换根）。
//     若日后 `usageView*` / `hierarchy*` 的 owner 把「按 path 分桶 + LRU 上界」抽成公共件，
//     这一节应当并过去、别留第三份 —— 已写进 `docs/batch-2026-10-06-pvclose.md` §7 的整理请求。
/** 与「同时最多开着这么多文件的结构视图」等价的本仓上限（上游是「编辑器开几个」）。 */
export const COLLAPSED_MEMORY_LIMIT = 32
const collapsedByPath = new Map<string, ReadonlySet<string>>()

/** 存：换文件时把上一张折叠表挂到那个文件名下（`storeState` 那一跳）。 */
export function rememberCollapsed(path: string, collapsed: ReadonlySet<string>): void {
  if (!path) return
  collapsedByPath.set(path, new Set(collapsed))
  while (collapsedByPath.size > COLLAPSED_MEMORY_LIMIT) {
    const oldest = collapsedByPath.keys().next()
    if (oldest.done) break
    collapsedByPath.delete(oldest.value)
  }
}

/** 取：一次性消费（同 `:426` 把 user data 清空那一手），没有就空表（= 全展开）。 */
export function restoredCollapsed(path: string): ReadonlySet<string> {
  const stored = collapsedByPath.get(path)
  if (!stored) return new Set<string>()
  collapsedByPath.delete(path)
  return stored
}

/** 判据与调试用的只读快照（不参与生产路径）。 */
export function collapsedMemoryPaths(): string[] {
  return [...collapsedByPath.keys()]
}
