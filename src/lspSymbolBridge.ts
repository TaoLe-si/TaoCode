// LSP 符号导航的**统一包装层** —— 上游 `platform/lsp-impl/src/impl/features/workspaceSymbol`
// 与 `.../navigation` 一族的可移植子集。
//
// 上游逐类：
//   · `LspWorkspaceSymbolContributor.kt:44-89`：把所有运行中的客户端（一个文件可能由多个
//     语言服务覆盖）的 `workspace/symbol` 结果**并行取回后逐个交给平台**；每个条目要能
//     `findFileByUri` 出文件、要过 `shouldAcceptSymbolKind`，否则丢弃（`:75-87`）。
//   · `LspGoToClassContributor.kt:7-12`：只接受 `SymbolKind.Class/Interface/Enum/Struct`
//     （= 5/10/11/23）—— 这是「转到类」的过滤口径。
//   · `LspGoToSymbolContributor.kt:7-9`：不过滤 kind。
//   · `LspWorkspaceSymbolEqualityProvider.kt:15-25`：Search Everywhere 的去重只看
//     `LspWorkspaceSymbolNavigationItem` 的相等性 —— 本仓的等价物是「符号身份键」。
//   · `converters.kt:12-28`：`SymbolInformation` → `WorkspaceSymbol`（含 `deprecated` 补 tag）。
//   · `LspNavigatableSymbol.kt:26-40,55-68`：符号 → 导航目标（文件 + 选区起点的 offset；
//     目录也能当目标）。本仓的导航目标是 `{path, line, character}`（`src/lspNavigation.ts`
//     的 `revealLocation` 吃这个形状）。
//   · `LspSymbolTypeProvider.kt:19-24`：`typeDefinition` 的结果同样以这个可导航符号返回 ——
//     本仓的 `typeDefinition` 走 `src/lspNavigation.ts` 的同一批导航目标。
//   · `LspNavigationUtil.kt:19-30`：打开文件并落在上面那个 offset。
//   · `LspStructureViewSupport.kt`/`documentSymbol/converters.kt`：documentSymbol 树 → 结构视图
//     元素（本仓的树形在 `src/outlineView.ts`，面包屑符号链在 `src/breadcrumbs.ts`；
//     这里补 documentSymbol → 扁平符号条目这一层，供文件内符号搜索用）。
//
// 与上游的差异（如实）：
//   · 上游一个 URI 由一个客户端解析，本仓的宿主只认 `file:`（`to_path`），所以符号条目直接带
//     工作区相对路径；没有 `LspDynamicFiles` 那套动态文件（`untitled:`/内存文档）映射。
//   · `LspImplicitReferenceProvider` 依附 PSI 的 `Symbol`/`resolveReference` 对象模型，本仓没有
//     PSI，故 `LspSymbolTypeProvider` 只保留「导航目标即类型声明结果」这一层形状。
//
// 消费者：`src/lspNavigation.ts` 的文件内符号搜索（`fileSymbolEntries`）与工作区符号搜索
// （`globalSymbolEntries`），以及「转到符号/类」的过滤与去重。

import { SPEED_SEARCH_STRUCTURE_SEPARATORS, symbolMatchesQuery } from './symbolSearch.ts'

/** 符号条目（与 `src/lspNavigation.ts` 的 `SymbolEntry` 同形；`containerName` 是可选的）。 */
export interface LspSymbolLike {
  name: string
  kind: number
  path: string
  line: number
  character: number
  endLine?: number
  endCharacter?: number
  containerName?: string
  /** 上游 `SymbolTag.Deprecated`（`converters.kt:21-27` 把 deprecated 折进 tags）。 */
  deprecated?: boolean
}

/** LSP `SymbolKind` 的编号 → 名字（规范 3.17；上游用 `org.eclipse.lsp4j.SymbolKind` 枚举）。 */
export const SYMBOL_KIND_NAMES: Record<number, string> = {
  1: 'File', 2: 'Module', 3: 'Namespace', 4: 'Package', 5: 'Class', 6: 'Method', 7: 'Property',
  8: 'Field', 9: 'Constructor', 10: 'Enum', 11: 'Interface', 12: 'Function', 13: 'Variable',
  14: 'Constant', 15: 'String', 16: 'Number', 17: 'Boolean', 18: 'Array', 19: 'Object', 20: 'Key',
  21: 'Null', 22: 'EnumMember', 23: 'Struct', 24: 'Event', 25: 'Operator', 26: 'TypeParameter',
}

/** `LspGoToClassContributor` 接受的四类：Class / Enum / Interface / Struct。 */
export const CLASS_LIKE_SYMBOL_KINDS: ReadonlySet<number> = new Set([5, 10, 11, 23])

export function symbolKindName(kind: number): string {
  return SYMBOL_KIND_NAMES[kind] ?? ''
}

/** 「转到类」过滤：上游只认那四类（**不是**「一切像类型的东西」）。 */
export function isClassLikeSymbol(symbol: LspSymbolLike): boolean {
  return CLASS_LIKE_SYMBOL_KINDS.has(symbol.kind)
}

/** 符号是否可导航：上游要求 URI 能解析出文件（`createNavigationItemFromWorkspaceSymbol:77-80`）。 */
export function isNavigatableSymbol(symbol: LspSymbolLike): boolean {
  return Boolean(symbol.name) && Boolean(symbol.path) && Number.isFinite(symbol.line)
}

/**
 * `LspWorkspaceSymbolEqualityProvider` 的等价物：符号身份键。
 * 同一位置 + 同名 + 同 kind 视为同一条（不同客户端/不同容器重报时去重）。
 */
export function symbolIdentity(symbol: LspSymbolLike): string {
  return [symbol.name, symbol.kind, symbol.path, symbol.line, symbol.character, symbol.containerName ?? ''].join('\u0000')
}

/** 稳定去重（保留先到者；上游把各客户端结果按到达顺序交给平台）。 */
export function dedupeSymbols(symbols: readonly LspSymbolLike[]): LspSymbolLike[] {
  const seen = new Set<string>()
  const out: LspSymbolLike[] = []
  for (const symbol of symbols) {
    const key = symbolIdentity(symbol)
    if (seen.has(key)) continue
    seen.add(key)
    out.push(symbol)
  }
  return out
}

export type SymbolSearchMode = 'symbol' | 'class'

/**
 * 把多个来源（每个语言服务一份）的工作区符号合成一份列表（`LspWorkspaceSymbolContributor`
 * 的等价物）：丢弃不可导航的、按模式过滤 kind、按查询过滤（名称或容器名），去重后排序。
 *
 * 排序口径（本仓补充，上游排序在平台 ChooseByName 里）：精确名 > 名称前缀 > 名称模糊 > 容器命中；
 * 同档按路径、行号稳定；`limit` 默认 200 与既有实现一致。
 */
export function mergeWorkspaceSymbols(
  sources: readonly (readonly LspSymbolLike[])[],
  options: { query?: string; mode?: SymbolSearchMode; limit?: number } = {},
): LspSymbolLike[] {
  const mode = options.mode ?? 'symbol'
  const query = (options.query ?? '').trim()
  const limit = options.limit ?? 200
  const accepted: LspSymbolLike[] = []
  for (const source of sources) {
    for (const symbol of source) {
      if (!isNavigatableSymbol(symbol)) continue
      if (mode === 'class' && !isClassLikeSymbol(symbol)) continue
      if (query && !symbolMatchesQuery(symbol.name, query) && !(symbol.containerName && symbolMatchesQuery(symbol.containerName, query))) continue
      accepted.push(symbol)
    }
  }
  const lowered = query.toLocaleLowerCase()
  const rank = (symbol: LspSymbolLike): number => {
    if (!query) return 3
    const name = symbol.name.toLocaleLowerCase()
    if (name === lowered) return 0
    if (name.startsWith(lowered)) return 1
    if (name.includes(lowered)) return 2
    return 3
  }
  const ordered = accepted
    .map((symbol, index) => ({ symbol, index, rank: rank(symbol) }))
    // 无查询时保持来源顺序（上游把各客户端的条目按到达顺序交给平台）；有查询时按档位，
    // 同档按路径 + 行号稳定。
    .sort((left, right) => query
      ? left.rank - right.rank
        || left.symbol.path.localeCompare(right.symbol.path)
        || left.symbol.line - right.symbol.line
        || left.index - right.index
      : left.index - right.index)
    .map(entry => entry.symbol)
  return dedupeSymbols(ordered).slice(0, limit)
}

/** `documentSymbol` 里本层用到的字段（`LspDocumentSymbol` 与 `NavigationDocumentSymbol` 都能满足）。 */
export interface DocumentSymbolLike {
  name: string
  kind: number
  startLine: number
  startChar: number
  /** 结构视图跳转优先用的选区起点（原生在 selectionRange 单独存在时给这两个字段）。 */
  selectionLine?: number
  selectionChar?: number
  selectionEndLine?: number
  selectionEndCharacter?: number
}

/**
 * `documentSymbol` → 扁平符号条目（`LspStructureViewSupport`/`documentSymbol/converters.kt`
 * 的等价层，供文件内符号搜索用）。`path` 是当前文件；跳转位置优先用 `selectionRange`
 * （结构视图跳的是元素名，不是整段区间），没有就用 `range` 起点。
 * 过滤走 `src/symbolSearch.ts` 的 SpeedSearch 档但**不重排**（行序 = 结构视图顺序）。
 */
export function documentSymbolEntries(
  symbols: readonly DocumentSymbolLike[],
  path: string,
  query = '',
  limit = 200,
): LspSymbolLike[] {
  const out: LspSymbolLike[] = []
  for (const symbol of symbols) {
    if (!query || symbolMatchesQuery(symbol.name, query, SPEED_SEARCH_STRUCTURE_SEPARATORS)) {
      out.push({
        name: symbol.name,
        kind: symbol.kind,
        path,
        line: symbol.selectionLine ?? symbol.startLine,
        character: symbol.selectionChar ?? symbol.startChar,
        ...(symbol.selectionEndLine !== undefined ? { endLine: symbol.selectionEndLine } : {}),
        ...(symbol.selectionEndCharacter !== undefined ? { endCharacter: symbol.selectionEndCharacter } : {}),
      })
    }
    if (out.length >= limit) break
  }
  return out
}

/** `LspNavigatableSymbol`/`LspNavigationUtil` 的等价物：符号 → `revealLocation` 的目标。 */
export function symbolNavigationTarget(symbol: LspSymbolLike, label?: string): { path: string; line: number; kind: '符号'; label: string } | null {
  if (!isNavigatableSymbol(symbol)) return null
  return { path: symbol.path, line: Math.max(0, symbol.line), kind: '符号', label: label ?? symbol.name }
}
