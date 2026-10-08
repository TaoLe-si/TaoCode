// The language server answers documentSymbol with a nested tree; the structure tool
// window can show it hierarchically or flattened, in document or alphabetical order,
// grouped by symbol kind, and with a speed filter that keeps a parent while any
// descendant still matches. Kept out of the component so the reordering rules are
// checkable without a DOM.
import type { Component } from 'vue'
import type { LspDocumentSymbol } from './bridge'
import { hierarchyKindIcon } from './hierarchyRenderer.ts'
import { symbolContains, symbolLineContains, visibilityAccessLevel, type CaretSymbolMatch } from './structureFollow.ts'

export interface OutlineNode {
  symbol: LspDocumentSymbol
  children: OutlineNode[]
}

export interface OutlineEntry {
  symbol: LspDocumentSymbol
  depth: number
  trail: string
  /** 稳定的折叠键（名字 + 起止位置）：同名符号在不同位置是不同的节点。 */
  key: string
  /** 过滤/排序后仍有子节点时才画展开箭头（与 IDEA 的树节点 `getChildren().length > 0` 同义）。 */
  hasChildren: boolean
  /** 该行现在是否处于折叠态（子节点被收起）。 */
  collapsed: boolean
}

export interface OutlineView {
  sort: boolean
  flat: boolean
  group: boolean
  filter: string
  /** 已折叠节点的键（`StructureViewComponent` 的展开状态；缺省 = 全部展开）。 */
  collapsed?: ReadonlySet<string>
  /**
   * 按可见性排序（上游 `VisibilitySorter`，`VisibilitySorter.java:34` 的
   * `ID = "VISIBILITY_SORTER"`）：public → protected → 包级 → private，判不出的排最后。
   * 与 `sort`（按名称）同时开时，可见性是主序、名称是同级时的次序 ——
   * 对应 `VisibilityComparator.java:26-27` 的「级别相同交给下一个比较器」。
   */
  visibility?: boolean
  /**
   * 这一趟排序是给**文件结构弹层**（Ctrl+F12）还是给结构工具窗口用的。
   * 上游同一张 `KindSorter` 有两个实例：`KindSorter.java:17-18` 的 `INSTANCE` 与
   * `POPUP_INSTANCE`，差别只有一行 —— `:38` 的 `isPopup ? 53 : 10`：
   * 弹层里「类型」的权重是 53，排在字段（`:54-55` 的 50）之后、匿名类（`:34-35` 的 55）之前，
   * 于是**嵌套类型落在成员下面**；工具窗口里它是 10，排最前。
   * 弹层默认开这一档（`FileStructurePopup.java:938-941` 的 `getDefaultValue` →
   * `hasEnabledStateByDefault` → `KindSorter.java:71-74` 的 `isEnabledByDefault() = true`），
   * 工具窗口默认**不开任何排序器**（`StructureViewFactoryImpl.java:51` 的 `ACTIVE_ACTIONS = ""`
   * + `:140-147` 的 `isActionActive`）⇒ 本仓面板那几档排序出厂全关是对的。
   */
  popup?: boolean
}

/**
 * 节点的折叠键：`StructureViewComponent` 的节点是 PSI 元素、天然有身份；LSP 这边
 * 只有位置，所以名字 + 起止位置就是身份（同一位置不会有两个不同符号）。
 */
export function outlineKey(symbol: LspDocumentSymbol): string {
  return `${symbol.name}:${symbol.startLine}:${symbol.startChar}:${symbol.endLine}:${symbol.endChar}`
}

/**
 * 上游 `KindSorter.java:33-58` 的权重原值（数字照抄，不做二次映射）：
 *   · `:37-39` JavaClassTreeElement → `isPopup ? 53 : 10`
 *   · `:40-41` ClassInitializerTreeElement → 15（`static { }` 块）
 *   · `:43-44` SuperTypeGroup → 20（超类型那一组）
 *   · `:46-49` PsiMethodTreeElement → 构造器 30、方法 35
 *   · `:51-52` PropertyGroup → 40（getter/setter 并出来的属性）
 *   · `:54-55` PsiFieldTreeElement → 50
 *   · `:34-35` JavaAnonymousClassTreeElement → 55
 *   · `:57` 其余 → 60
 * 权重小者在前（`:30` 的 `getWeight(o1) - getWeight(o2)`）。
 *
 * LSP `SymbolKind`（spec 编号，native 原样透传）没有「静态初始化块 / 超类型组 / 匿名类」
 * 这三种元素，也没有「属性 = getter+setter 并出来的组」这回事（`Property` 是服务器自己报的
 * 一种 kind），所以那三档在下面那张映射里**不出现**，原值留在常量里备查。逐类映射是本仓的
 * 决定（`docs/batch-2026-10-06-pvtree5.md` §5 记着哪几条对不上号），但它保住了两条用户看得见
 * 的次序：**构造器在方法之前**（`:46-49`）与**属性在字段之前**（`:51-55`）—— 上一版把这两对
 * 各自压成同一档，于是同名/同档时只能退回文档序。
 * 不认识的种类（含类型参数 26）落 `:57` 的 60：`getWeight` 只认上面那七个 `instanceof` 分支，
 * 类型参数不在其中。
 */
export const KIND_WEIGHT = {
  type: 10, typeInPopup: 53, initializer: 15, superType: 20,
  constructor: 30, method: 35, property: 40, field: 50, anonymous: 55, other: 60,
} as const

/**
 * 按种类分组的档位（IDEA Structure 视图的 `KindSorter`）。`popup` 见上面 `OutlineView.popup`
 * 那条注释 —— 两个实例只有「类型」这一档换权重（`KindSorter.java:38`），其余完全一样。
 */
export function symbolKindRank(kind: number, popup = false): number {
  switch (kind) {
    case 5: case 10: case 11: case 23: return popup ? KIND_WEIGHT.typeInPopup : KIND_WEIGHT.type
    case 9: return KIND_WEIGHT.constructor
    case 6: case 12: return KIND_WEIGHT.method
    case 7: return KIND_WEIGHT.property
    case 8: case 13: case 14: case 22: return KIND_WEIGHT.field
    default: return KIND_WEIGHT.other
  }
}

/**
 * `Sorter.ALPHA_SORTER` 的比较器（`Sorter.java:35-42`）：
 * `SorterUtil.getStringPresentation(o1).compareToIgnoreCase(getStringPresentation(o2))`，
 * 其中 `SorterUtil.java:13-17` 对 `SortableTreeElement` 取的是 **`getAlphaSortKey()`**，
 * 而 Java 那侧的成员元素给的就是**光秃秃的名字**（`JavaVariableBaseTreeElement.java:34-42`
 * 返回 `element.getName()`、取不到给 `""`；只有 `PsiMethodTreeElement.java:116-123` 在名字后面
 * 追加参数类型 —— LSP 的 `detail` 是一整段声明文本、拆不出参数表，故本仓一律只用名字）。
 *
 * `String.compareToIgnoreCase` 比的是 **UTF-16 码元**先按大写折叠、相等再按小写折叠的差值
 * （不是 ICU 的排印序）：`_foo`(95) 对 `Bar`(66) 时上游判 `_foo` 在后，而 JS 的
 * `localeCompare` 会判标点在前 ⇒ 这里自己走一遍码元，不用 localeCompare。
 */
export function compareAlphaKeysIgnoreCase(left: string, right: string): number {
  const length = Math.min(left.length, right.length)
  for (let index = 0; index < length; index++) {
    const folded = codeUnit(left, index, true) - codeUnit(right, index, true)
    if (folded !== 0) return folded
    const lower = codeUnit(left, index, false) - codeUnit(right, index, false)
    if (lower !== 0) return lower
  }
  return left.length - right.length
}

/** `Character.toUpperCase(char)` 的码元口径：折不出别的东西时原样返回那一个码元。 */
function codeUnit(text: string, index: number, upper: boolean): number {
  const unit = text.charCodeAt(index)
  const char = String.fromCharCode(unit)
  const folded = (upper ? char.toUpperCase() : char.toLowerCase()).charCodeAt(0)
  return Number.isNaN(folded) ? unit : folded
}

/**
 * 一行的**显示名**（上游的 presentation text）。
 *
 * 上游结构视图那一行画的不是元素的名字，是 `Presentation.getPresentableText()`，
 * 而 Java 那侧把它拼成了「名字 + 签名」：
 *   · 方法 = `PsiMethodTreeElement.java:64-72` 的
 *     `formatMethod(method, EMPTY, SHOW_NAME | TYPE_AFTER | SHOW_PARAMETERS | SHOW_TYPE, SHOW_TYPE)`
 *     ⇒ `run(): void` 这种形状（dumb 模式下去掉类型那一半，名字与参数仍在）；
 *   · 字段/变量 = `JavaVariableBaseTreeElement.java:24-33` 的
 *     `formatVariable(field, SHOW_NAME | SHOW_TYPE | TYPE_AFTER | SHOW_INITIALIZER, EMPTY)`
 *     ⇒ `count: int = 0`。
 * LSP 的 `DocumentSymbol.detail` 装的正是签名那一半（spec：「a more detail human readable
 * string … for a function the signature」），本仓宿主原样透传（`native/lsp_support.cpp:174`
 * 的 `{"detail", string_at(node, "detail")}`；`structureFollow.ts:35` 判可见性读的就是它）
 * ⇒ presentable text = 名字 + `detail`，服务器没给 `detail` 时只剩名字（不编一段签名出来）。
 */
export function symbolPresentableName(symbol: LspDocumentSymbol): string {
  return `${symbol.name}${symbol.detail ?? ''}`
}

/**
 * 结构视图**每一行的种类图标**。这一支是 `pvclose` 2026-10-06 补的缺口：
 * 上游 `LspStructureViewSupport` 只有三个成员 —— `platform/lsp-impl/src/impl/features/documentSymbol/LspStructureViewSupport.kt`
 * 的 `:19` `getDocumentSymbols`、**`:21` `getIcon`**、`:24-26` `navigate`；判决簿把
 * `src/outlineView.ts` 整族算作它的等价物（`docs/inventory/verdict-platform_rest.md:235`），
 * 但 `getIcon` 那一支盘上从来没有出口（面板一行只有折叠箭头 + 文字种类 + 位置，
 * `src/components/OutlinePanel.vue:154-173` 复核过），族行 `docs/inventory/verdict-projectviews.md:30`
 * 也没把「行图标」列进缺 —— 缺口真实存在但**没登记**。
 *
 * **为什么不写第二张 `SymbolKind → 图标` 表**（本仓同形状已经两份了，见
 * `docs/batch-2026-10-06-pvclose.md` §2）：上游自己就把这一条做成**一个**函数、两边共用 ——
 *   · 结构视图：`LspStructureViewSupport.kt:21` `= …symbolKindCustomizer.getIcon(symbol.kind)`
 *   · 层级视图：`platform/lsp-impl/src/impl/features/hierarchy/LspHierarchyNodeDescriptor.kt:48`
 *     `= …symbolKindCustomizer.getIcon(kind)`
 * 同一条 `symbolKindCustomizer.getIcon(kind)`，两个调用方。本仓的对应物就是
 * `src/hierarchyRenderer.ts:51-64` 那张 `HIERARCHY_KIND_ICONS` 与 `:67-70` 的 `hierarchyKindIcon`
 * （层级侧已按 `tests/hierarchy-renderer.test.mjs` 钉住），这里**只做转发**。
 * 抄第二张表的结果一定是两处漂：层级那张已经被判据钉着，结构侧改哪一份都不完整。
 *
 * 图标形状仍是**本仓自定**（lucide 图形，上游 `AllIcons` 的像素不在可文本比范围内，
 * 与 `src/hierarchyRenderer.ts:26-29` 同一口径）；未识别的 `kind` 返回 `null` ⇒ 模板 `v-if` 掉、
 * **不占图标位**，也不画一个假图标。
 *
 * 与上游的**不等价处**（照实写，本批不做第二半）：`platform/structure-view-impl/src/com/intellij/ide/structureView/impl/common/PsiTreeElementBase.java:50-58`
 * 的 `getIcon(open)` 在元素不是「可读写的文件」时或上 `ICON_FLAG_VISIBILITY`
 * （`platform/util/src/com/intellij/openapi/util/Iconable.java:11` 那一位），也就是**图标本身带可见性档**
 * （private/protected/包级各有图形）。本仓 `:19` 那张表按 `kind` 一个维度出图，没有可见性变体；
 * 本仓**已有的**可见性出口是排序那一档（`structureFollow.ts:36-59` 的 `visibilityAccessLevel`），
 * 硬加一个锁角标就是给上游没有的形状编图形 ⇒ 登记在 `docs/batch-2026-10-06-pvclose.md` §6 作「未做」，
 * 不在本批顺手造。
 */
export function symbolRowIcon(kind: number): Component | null {
  return hierarchyKindIcon(kind)
}

const before = (a: [number, number], b: [number, number]) => a[0] < b[0] || (a[0] === b[0] && a[1] <= b[1])

const covers = (parent: LspDocumentSymbol, child: LspDocumentSymbol) =>
  before([parent.startLine, parent.startChar], [child.startLine, child.startChar]) &&
  before([child.endLine, child.endChar], [parent.endLine, parent.endChar])

// The native layer flattens the tree depth-first, so containment is re-derived from a
// stack of still-open ancestors.
export function treeOf(symbols: readonly LspDocumentSymbol[]): OutlineNode[] {
  const roots: OutlineNode[] = []
  const stack: OutlineNode[] = []
  for (const symbol of symbols) {
    const node: OutlineNode = { symbol, children: [] }
    while (stack.length && !covers(stack[stack.length - 1]!.symbol, symbol)) stack.pop()
    ;(stack.length ? stack[stack.length - 1]!.children : roots).push(node)
    stack.push(node)
  }
  return roots
}

export function arrange(tree: readonly OutlineNode[], view: OutlineView): OutlineEntry[] {
  const needle = view.filter.trim().toLowerCase()
  const out: OutlineEntry[] = []
  // 三趟稳定排序：先按名称（可选），再按可见性档位（可选），最后按种类档位（可选）——
  // 排最后的是主序，前面的次序就是「同级/同档时」的次序（`Array.prototype.sort` 在 V8
  // 里是稳定排序，所以这就是上游 `VisibilityComparator(next)` 那条链的语义）。
  // 链的**先后**照 `JavaFileTreeModel.java:66-72`：`[KindSorter, VisibilitySorter,
  // AnonymousClassesSorter, ALPHA_SORTER]`，第一个是主序 ⇒ 名称档垫底、种类档封顶。
  const ordered = (list: readonly OutlineNode[]) => {
    const sorted = [...list]
    if (view.sort) sorted.sort((a, b) => compareAlphaKeysIgnoreCase(a.symbol.name, b.symbol.name))
    if (view.visibility) {
      sorted.sort((a, b) => visibilityAccessLevel(b.symbol.detail) - visibilityAccessLevel(a.symbol.detail))
    }
    if (view.group) {
      sorted.sort((a, b) => symbolKindRank(a.symbol.kind, view.popup ?? false) - symbolKindRank(b.symbol.kind, view.popup ?? false))
    }
    return sorted
  }
  const matches = (node: OutlineNode): boolean => !needle
    || node.symbol.name.toLowerCase().includes(needle)
    || node.children.some(matches)
  // 过滤生效时**忽略折叠**并把命中的路径展开（IDEA 的 speed search 同样会把结果树展开，
  // 否则用户输入过滤词后可能一行都看不到）。
  const mayCollapse = (key: string): boolean => !view.flat && !needle && (view.collapsed?.has(key) ?? false)
  const walk = (list: readonly OutlineNode[], depth: number, trail: string) => {
    for (const node of ordered(list)) {
      if (!matches(node)) continue
      const children = view.flat ? [] : ordered(node.children).filter(matches)
      const key = outlineKey(node.symbol)
      const collapsed = children.length > 0 && mayCollapse(key)
      out.push({ symbol: node.symbol, depth: view.flat ? 0 : depth, trail, key,
                 hasChildren: !view.flat && children.length > 0, collapsed })
      if (!collapsed) walk(node.children, depth + 1, trail ? `${trail}.${node.symbol.name}` : node.symbol.name)
    }
  }
  walk(tree, 0, '')
  return out
}

/**
 * **文件结构弹层（Ctrl+F12）的默认档位**：把已经按 `documentSymbol` 顺序产出的行，
 * 重排成上游弹层那棵树出厂显示的次序。
 *
 * 上游依据（三条凑齐才是这一档）：
 *   · 弹层给每个 tree action 上的默认值 = `FileStructurePopup.java:750`
 *     （`myTreeActionsOwner.setActionIncluded(action, getDefaultValue(action))`），
 *     `getDefaultValue` 在 `:938-942`：`Sorter.ALPHA_SORTER.equals(action)` **恒真** ⇒ 名称档默认开，
 *     其余看 `hasEnabledStateByDefault`（`:944-946`）⇒ `KindSorter.java:71-74` 的
 *     `isEnabledByDefault() = true` ⇒ 种类档默认开；`VisibilitySorter` 两个接口都不实现
 *     （`VisibilitySorter.java:14` 只 `implements Sorter`）⇒ 默认关，与「弹层不排可见性」一致。
 *   · 用的是**弹层那一份** `KindSorter.POPUP_INSTANCE`（`JavaFileTreeModel.java:68`
 *     `TreeStructureUtil.isInStructureViewPopup(this) ? POPUP_INSTANCE : INSTANCE`）
 *     ⇒ 类型 53 分（`KindSorter.java:38`），**嵌套类型落在成员下面**，不是工具窗口那个 10 分。
 *   · 结构工具窗口**没有**这套默认：`StructureViewFactoryImpl.java:51` 的 `ACTIVE_ACTIONS = ""`
 *     + `:140-147` 的 `isActionActive` ⇒ 出厂一行都不重排（文档序），本仓面板的默认档照此。
 *
 * 每层各自排（上游那是一棵树），所以这里走 `arrange(…, flat: true)` 得到「逐层排好后的
 * 深度序」，再按同一口径把行贴回去。行与符号的对应键 = 名字 + 起止位置里的**起点**：
 * `native/lsp_support.cpp:174-177` 的 `collect_symbols` 把 `startLine/startChar` 就取在
 * `selectionRange` 的起点（`src/lspSymbolBridge.ts` 的 `documentSymbolEntries` 因此恒等于
 * `symbol.selectionLine ?? symbol.startLine`），两端用的是同一份数。
 * 认不到的行（理论上不该有）按原次序留在末尾，稳定排序保证不重复也不丢行。
 */
export function orderFileStructurePopup<T extends { name: string; line: number; character: number }>(
  symbols: readonly LspDocumentSymbol[], rows: readonly T[],
): T[] {
  if (!symbols.length || rows.length < 2) return [...rows]
  const rank = new Map<string, number>()
  const ordered = arrange(treeOf(symbols), { sort: true, group: true, flat: true, filter: '', popup: true })
  ordered.forEach((entry, index) => {
    const key = `${entry.symbol.name}\u0000${entry.symbol.startLine}\u0000${entry.symbol.startChar}`
    if (!rank.has(key)) rank.set(key, index)
  })
  const at = (row: T): number => rank.get(`${row.name}\u0000${row.line}\u0000${row.character}`) ?? Number.MAX_SAFE_INTEGER
  // 先带上原下标再排：`Array.prototype.sort` 稳定，但末尾那批（MAX_SAFE_INTEGER）要按
  // **文档序**留著，显式比一次原下标最省事。
  return rows.map((row, index) => ({ row, index, order: at(row) }))
    .sort((a, b) => a.order - b.order || a.index - b.index)
    .map(entry => entry.row)
}

/**
 * 光标落在哪个符号里 —— 上游 `StructureViewComponent.java:655` 的
 * `scrollToSelectedElement()`（光标移动 → 选中包住它的那个元素并把树滚过去）。
 * 先按（行, 列）严格包含，找不到再退化成按行包含：`collect_symbols` 给的起点是
 * `selectionRange`（声明名那一列），光标停在关键字/缩进上时列判定会落空。
 * 两者都取**最深**的那一层（IDEA 选最具体的元素），祖先键一并给出以便展开折叠的分支。
 */
export function caretSymbolInTree(
  tree: readonly OutlineNode[], line: number, character = 0,
): CaretSymbolMatch | null {
  return walkCaret(tree, line, character, false) ?? walkCaret(tree, line, 0, true)
}

/**
 * 同一层兄弟里挑「光标那一层的符号」。起点按行放宽后（`symbolContains`），`int a; int b;`
 * 这种两个符号同起同止的行里，两个都算「包住」光标。上游按**偏移量**取光标底下的元素
 * （`StructureViewComponent.java:655-661` 的 `scrollToSelectedElement` → 光标 offset 的 PSI 元素），
 * 本仓同一口径：**光标左边最近开始的那个**（`startChar` 最大且不超过光标列）赢；
 * 没有一个从光标左边开始（光标停在缩进/关键字上）时取**文档序第一个**。
 * 原实现（2026-10-06 前）是「后面的兄弟覆盖前面的」，光标在 `a` 上也会选中 `b`，判据
 * `tests/outline-caret-source.test.mjs`「同一行两个符号时选光标包住的那一个」。
 */
function pickCaretCandidate(
  nodes: readonly OutlineNode[], line: number, character: number, lineOnly: boolean,
): OutlineNode | null {
  let first: OutlineNode | null = null
  let anchored: OutlineNode | null = null
  for (const node of nodes) {
    const own = lineOnly ? symbolLineContains(node.symbol, line) : symbolContains(node.symbol, line, character)
    if (!own) continue
    if (!first) first = node
    if (node.symbol.startChar <= character && (!anchored || node.symbol.startChar > anchored.symbol.startChar)) anchored = node
  }
  return anchored ?? first
}

function walkCaret(nodes: readonly OutlineNode[], line: number, character: number, lineOnly: boolean,
                   trail: string[] = []): CaretSymbolMatch | null {
  const node = pickCaretCandidate(nodes, line, character, lineOnly)
  if (!node) return null
  const key = outlineKey(node.symbol)
  const child = walkCaret(node.children, line, character, lineOnly, [...trail, key])
  return child ?? { key, ancestors: [...trail], lineOnly }
}
