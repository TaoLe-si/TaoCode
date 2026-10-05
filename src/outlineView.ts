// The language server answers documentSymbol with a nested tree; the structure tool
// window can show it hierarchically or flattened, in document or alphabetical order,
// grouped by symbol kind, and with a speed filter that keeps a parent while any
// descendant still matches. Kept out of the component so the reordering rules are
// checkable without a DOM.
import type { LspDocumentSymbol } from './bridge'
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
}

/**
 * 节点的折叠键：`StructureViewComponent` 的节点是 PSI 元素、天然有身份；LSP 这边
 * 只有位置，所以名字 + 起止位置就是身份（同一位置不会有两个不同符号）。
 */
export function outlineKey(symbol: LspDocumentSymbol): string {
  return `${symbol.name}:${symbol.startLine}:${symbol.startChar}:${symbol.endLine}:${symbol.endChar}`
}

/**
 * 按种类分组的档位（IDEA Structure 视图的 `KindSorter`：类/接口在前，方法随后，
 * 字段与常量最后）。编号是 LSP `SymbolKind` 的 spec 编号（与 native 透传、假服务器
 * 夹具、`navigate-in-file` 的口径一致），不认识的种类归最后一档，档内保持原顺序。
 */
export function symbolKindRank(kind: number): number {
  switch (kind) {
    case 5: case 10: case 11: case 23: case 26: return 0   // 类 / 枚举 / 接口 / 结构体 / 类型参数
    case 6: case 9: case 12: return 1                       // 方法 / 构造器 / 函数
    case 7: case 8: case 13: case 14: case 22: return 2     // 属性 / 字段 / 变量 / 常量 / 枚举成员
    default: return 3
  }
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
  const ordered = (list: readonly OutlineNode[]) => {
    const sorted = [...list]
    if (view.sort) sorted.sort((a, b) => a.symbol.name.localeCompare(b.symbol.name))
    if (view.visibility) {
      sorted.sort((a, b) => visibilityAccessLevel(b.symbol.detail) - visibilityAccessLevel(a.symbol.detail))
    }
    if (view.group) sorted.sort((a, b) => symbolKindRank(a.symbol.kind) - symbolKindRank(b.symbol.kind))
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

function walkCaret(nodes: readonly OutlineNode[], line: number, character: number, lineOnly: boolean,
                   trail: string[] = []): CaretSymbolMatch | null {
  let best: CaretSymbolMatch | null = null
  for (const node of nodes) {
    const own = lineOnly ? symbolLineContains(node.symbol, line) : symbolContains(node.symbol, line, character)
    if (!own) continue
    const key = outlineKey(node.symbol)
    const child = walkCaret(node.children, line, character, lineOnly, [...trail, key])
    best = child ?? { key, ancestors: [...trail], lineOnly }
  }
  return best
}
