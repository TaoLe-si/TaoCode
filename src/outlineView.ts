// The language server answers documentSymbol with a nested tree; the structure tool
// window can show it hierarchically or flattened, in document or alphabetical order,
// and with a speed filter that keeps a parent while any descendant still matches.
// Kept out of the component so the reordering rules are checkable without a DOM.
import type { LspDocumentSymbol } from './bridge'

export interface OutlineNode {
  symbol: LspDocumentSymbol
  children: OutlineNode[]
}

export interface OutlineEntry {
  symbol: LspDocumentSymbol
  depth: number
  trail: string
}

export interface OutlineView {
  sort: boolean
  flat: boolean
  filter: string
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
  const ordered = (list: readonly OutlineNode[]) => view.sort
    ? [...list].sort((a, b) => a.symbol.name.localeCompare(b.symbol.name))
    : [...list]
  const matches = (node: OutlineNode): boolean => !needle
    || node.symbol.name.toLowerCase().includes(needle)
    || node.children.some(matches)
  const walk = (list: readonly OutlineNode[], depth: number, trail: string) => {
    for (const node of ordered(list)) {
      if (!matches(node)) continue
      out.push({ symbol: node.symbol, depth: view.flat ? 0 : depth, trail })
      walk(node.children, depth + 1, trail ? `${trail}.${node.symbol.name}` : node.symbol.name)
    }
  }
  walk(tree, 0, '')
  return out
}
