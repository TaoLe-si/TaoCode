// **结构视图的 EP 消费层**：把 `com.intellij.lang.psiStructureViewFactory` /
// `com.intellij.structureViewBuilder`（折行）与 `com.intellij.lang.structureViewExtension`
// （给某个父符号补子行）两条扩展点接进本仓的结构工具窗口（`src/components/OutlinePanel.vue`）。
//
// 上游是什么：
//   · `PsiStructureViewFactory.getStructureViewBuilder(psiFile)` —— 按**语言**认领一个文件，
//     给出一个 `StructureViewBuilder`；`StructureViewBuilder.createStructureView(fileEditor, project)`
//     折出整棵树。消费点是 `LanguageStructureViewBuilder`（`platform/lang-impl` 那侧）——
//     先问按语言注册的 factory，问不到再退到 `com.intellij.structureViewBuilder` 这条 KeyedFactory EP。
//   · `StructureViewExtension.getType()` / `getChildren(parent)` —— 这不是"换一个构建器"，而是
//     **往已有树上挂子节点**：IDEA 里 Java 的 "Properties" 一档就是靠它把 getter/setter 并出来的
//     （`StructureViewExtensions.EP_NAME`，`lang.impl.xml:234`）；`filterChildren` 让扩展能改写
//     基础行与扩展行的合并方式。
//
// 本仓此前：`OutlinePanel` 直接调 `src/outlineView.ts` 的 `treeOf` + `arrange`，两条 EP 都是死的
// （`structureViewRows` 返回空、`applyStructureViewExtensions` 没人调）。本模块补上那一趟：
//   · `outlineRowsFromProviders(path, symbols, view)` —— 先问 EP 有没有第三方构建器认领这个文件，
//     有就把它的行（`StructureViewRow`）折成面板用的 `OutlineEntry`；没有返回 null ⇒ 面板回落到
//     内建的 `arrange`（这正是 `structureViewRows` 文件头写的那条契约：「没有贡献者时返回空，
//     调用方回落到 src/outlineView.ts 的默认折层」）。
//   · `outlineRowsWithExtensions(path, symbols, rows)` —— 在折好的行上，给每个父符号跑一趟
//     `applyStructureViewExtensions`，把扩展补的子行插在父行之后（缩进一级）。
//
// 与上游的如实差异：本仓没有 PSI/`StructureView` 对象，扩展补的行是 `StructureViewRow`
// （名字 + 种类 + 起止位置），面板把它当**合成的符号**画（`structureViewToSymbol`）。
//
// 纯函数 + 只 import 既有模块，便于 `node --test` 直测。

import type { LspDocumentSymbol } from './bridge.ts'
import { outlineKey, treeOf, type OutlineEntry, type OutlineNode, type OutlineView } from './outlineView.ts'
import {
  applyStructureViewExtensions, structureViewRows,
  type StructureViewRow, type StructureViewSymbol,
} from './ideViewExtensionPoints.ts'

/** 一个 `LspDocumentSymbol`（含子节点树）→ EP 的 `StructureViewSymbol`。 */
export function toStructureViewSymbol(symbol: LspDocumentSymbol, children: readonly StructureViewSymbol[] = []): StructureViewSymbol {
  return {
    name: symbol.name, kind: symbol.kind, detail: symbol.detail,
    startLine: symbol.startLine, startChar: symbol.startChar, endLine: symbol.endLine, endChar: symbol.endChar,
    children: children.length ? children : undefined,
  }
}

function nodeToStructureView(node: OutlineNode): StructureViewSymbol {
  return toStructureViewSymbol(node.symbol, node.children.map(nodeToStructureView))
}

/** 把 LSP `documentSymbol` 的整棵树折成 EP 认的形状（`structureViewRows` 的入参）。 */
export function toStructureViewSymbols(symbols: readonly LspDocumentSymbol[]): StructureViewSymbol[] {
  return treeOf(symbols).map(nodeToStructureView)
}

/**
 * EP 的 `StructureViewRow` → 面板认的 `LspDocumentSymbol`（**合成的符号**）。
 * `detail` 取空串：扩展行没有声明文本可给。
 */
export function structureViewToSymbol(row: StructureViewRow): LspDocumentSymbol {
  return {
    name: row.name, kind: row.kind, detail: '',
    startLine: row.startLine, startChar: row.startChar, endLine: row.endLine, endChar: row.endChar,
  }
}

const entryOf = (symbol: LspDocumentSymbol, depth: number, trail: string, hasChildren = false): OutlineEntry => ({
  symbol, depth, trail, key: outlineKey(symbol), hasChildren, collapsed: false,
})

/**
 * 问 EP 要折好的行。**第三方构建器认领了这个文件**（`structureViewRows` 给出非空）时，把它的行
 * 折成 `OutlineEntry[]`；否则返回 null，调用方回落内建折层。
 *
 * 注意 `structureViewRows` 自己会问 `structureViewBuilderFor`（先 PSI factory 后 builder EP）——
 * 本仓没有 bundled 构建器，所以默认返回空；这条路径是给第三方插件的。
 */
export function outlineRowsFromProviders(
  path: string, symbols: readonly LspDocumentSymbol[], view: OutlineView,
): OutlineEntry[] | null {
  if (!path || !symbols.length) return null
  let rows: readonly StructureViewRow[]
  try {
    rows = structureViewRows({ path, symbols: toStructureViewSymbols(symbols) })
  } catch { return null }
  if (!rows.length) return null
  // view.flat ⇒ 全部摊平到第 0 层（与内建 arrange 的 flat 口径一致）。
  return rows.map(row => entryOf(structureViewToSymbol(row), view.flat ? 0 : row.depth, ''))
}

/**
 * 给折好的行补上 `structureViewExtension` 的子行：对每个有子层级意义的行（非 flat），
 * 把该行符号当父问一圈扩展，扩展给的行插在父行**紧后面**、缩进一级（上游是树，本仓是摊平行）。
 * 没有任何扩展命中时**原样返回入参**（顺序与对象都不变 ⇒ 既有渲染零改动）。
 */
export function outlineRowsWithExtensions(
  path: string, rows: readonly OutlineEntry[], view: OutlineView,
): OutlineEntry[] {
  if (!path || view.flat || !rows.length) return [...rows]
  const out: OutlineEntry[] = []
  for (const row of rows) {
    out.push(row)
    // 折叠着的父行不露出扩展子行（它们也是这个父节点的子树，与 `arrange` 的折叠口径一致）。
    if (row.collapsed) continue
    for (const extra of extensionChildrenOf(path, row)) out.push(extra)
  }
  return out
}

/** 一个父行下的扩展子行。扩展抛错、或没有扩展认领这个父符号时给空表。 */
function extensionChildrenOf(path: string, parent: OutlineEntry): OutlineEntry[] {
  const symbol: StructureViewSymbol = toStructureViewSymbol(parent.symbol)
  let rows: readonly StructureViewRow[]
  try {
    rows = applyStructureViewExtensions([], { path, symbol, depth: parent.depth })
  } catch { return [] }
  if (!rows.length) return []
  return rows.map(row => entryOf(structureViewToSymbol(row), parent.depth + 1, parent.trail))
}
