// ClassSearchEverywhereContributor.kt:78-87 and ClassSearchEverywhereNavigationHandler.kt:23-42,
// 77-123: search the owner of Foo#member, navigate to a matching direct member, else the class.
// Adaptation: use the existing LSP kind/range data, never infer types or members from source text.
import { scoreCommand } from './commandSearch.ts'
import type { LspDocumentSymbol } from './bridge.ts'
import type { SymbolEntry } from './lspNavigation.ts'

/** LSP Class / Interface / Enum / Struct. Variable (13) is not a class. */
export function isSearchEverywhereClass(kind?: number): boolean {
  return kind === 5 || kind === 11 || kind === 10 || kind === 23
}

export function classSearchPattern(raw: string): { owner: string; member: string | null } {
  const query = raw.trim()
  const separator = query.lastIndexOf('#')
  if (separator <= 0) return { owner: query, member: null }
  return { owner: query.slice(0, separator).trim(), member: query.slice(separator + 1).trim() || null }
}

type DocumentSymbol = LspDocumentSymbol & { selectionEndLine?: number; selectionEndCharacter?: number }
const compare = (line: number, character: number, otherLine: number, otherCharacter: number) => line - otherLine || character - otherCharacter
const inside = (parent: DocumentSymbol, child: DocumentSymbol) =>
  compare(child.startLine, child.startChar, parent.startLine, parent.startChar) > 0 &&
  compare(child.endLine, child.endChar, parent.endLine, parent.endChar) <= 0

/** Native flattens documentSymbol depth-first but preserves declaration ends (lsp_support.cpp:148-181). */
export function classMemberTarget(owner: SymbolEntry, raw: string, symbols: readonly DocumentSymbol[]): SymbolEntry {
  const member = classSearchPattern(raw).member
  if (!member) return owner
  const named = symbols.filter(symbol => isSearchEverywhereClass(symbol.kind) && symbol.name === owner.name)
  const declaration = named.find(symbol => symbol.startLine === owner.line && symbol.startChar === owner.character) ??
    (named.length === 1 ? named[0] : undefined)
  if (!declaration) return owner
  const children = symbols.filter(symbol => inside(declaration, symbol))
  let target: DocumentSymbol | undefined
  let best = 0
  for (const symbol of children) {
    // Only direct children: a flattened nested class/method must not contribute its own members.
    if (children.some(parent => parent !== symbol && inside(parent, symbol))) continue
    const weight = scoreCommand(member, { title: symbol.name })
    if (weight > best) { best = weight; target = symbol }
  }
  if (!target) return owner
  return { name: target.name, kind: target.kind, path: owner.path, line: target.startLine, character: target.startChar,
    endLine: target.selectionEndLine, endCharacter: target.selectionEndCharacter }
}
