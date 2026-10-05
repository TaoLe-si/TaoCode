// 层级视图的**导出与固定标签页**（上游 `platform/lang-impl/src/com/intellij/ide/hierarchy/`：
// 导出动作 `ExporterToTextFileHierarchy.java:22-48`（根不打印、每行 `缩进 + 高亮文本`、
// 子级缩进四个空格 —— 逐条写在 `exportHierarchyText` 的注释里），钉住 = 把当前那一棵另开一个
// 固定标签页比对。本仓现状：`src/hierarchyView.ts` 有一棵可展开的树（`HierarchyNode`），
// 这个模块给出它的导出文本、剪贴板形式与"要不要再开一个固定标签页"的判定。
//
// 渲染与标签页管理在 `src/hierarchyView.ts`（本模块被它调用，见 `exportCurrentHierarchy`
// 与 `pinCurrentHierarchy`）；App.vue 里只留按钮 —— 接线见
// `docs/wiring-requests-2026-10-06-bucket4.md`。判据：`tests/hierarchy-export.test.mjs`。

/** 导出需要的最小节点形状（与 `src/hierarchyView.ts` 的 `HierarchyNode` 结构兼容）。 */
export interface ExportHierarchyNode {
  item: { name: string; path: string; detail?: string | null; line?: number; character?: number }
  children?: readonly ExportHierarchyNode[] | null
  expanded?: boolean
  recursive?: boolean
}

/** 一个被钉住的层级标签页。 */
export interface PinnedHierarchy {
  id: string
  root: string
  kind: 'call' | 'type'
  direction: string
  path: string
  line: number
}

/** 身份键：同根同方向同位置 = 同一个标签页。 */
export function hierarchyTabKey(kind: 'call' | 'type', direction: string, path: string, line: number, character = 0): string {
  return `${kind}:${direction}:${path}:${line}:${character}`
}

/**
 * 钉住一棵层级：已存在同键标签页就返回原列表（不重复开），否则追加。
 * 返回新数组（不改入参）。
 */
export function pinHierarchy(pinned: readonly PinnedHierarchy[], entry: Omit<PinnedHierarchy, 'id'>): PinnedHierarchy[] {
  const key = hierarchyTabKey(entry.kind, entry.direction, entry.path, entry.line)
  if (pinned.some(tab => tab.id === key)) return [...pinned]
  return [...pinned, { ...entry, id: key }]
}

/** 关掉一个固定标签页（按 id）。 */
export function closePinnedHierarchy(pinned: readonly PinnedHierarchy[], id: string): PinnedHierarchy[] {
  return pinned.filter(tab => tab.id !== id)
}

/**
 * 拍成缩进文本 —— 格式照上游 `ExporterToTextFileHierarchy`
 * （`platform/lang-impl/src/com/intellij/ide/hierarchy/ExporterToTextFileHierarchy.java:22-48`）：
 *   · 根节点不打印（`:32-34`：`node.getParent() == null` 时只把缩进原样传给子节点）；
 *   · 每行 = `indent + descriptor.getHighlightedText().getText()`（`:36`），
 *     而 LSP 那族的高亮文本 = `name` + 可选的 `" : detail"`
 *     （`platform/lsp-impl/src/impl/features/hierarchy/LspHierarchyNodeDescriptor.kt:25-30`）；
 *   · 子级缩进 = `indent + "    "`，**四个空格**（`:33`）；
 *   · 循环节点：本仓的 `recursive` 标记加**在名字之前**（同 `HierarchyNodeDescriptor.java:131-138`
 *     给失效节点加 `getBeginning()` 前缀的位置；上游 call hierarchy 没有专门的递归文本，
 *     递归标记是本仓自己的防环说明，前缀图形 `…` 也是本仓的）。
 * `directionLabel` 作为标题行（「调用方」等），与面板一致。
 */
export function exportHierarchyText(nodes: readonly ExportHierarchyNode[], directionLabel = ''): string {
  const lines: string[] = []
  if (directionLabel) lines.push(`${directionLabel}:`, '')
  const walk = (node: ExportHierarchyNode, depth: number): void => {
    const { item } = node
    const detail = (item.detail ?? '').trim()
    lines.push(`${'    '.repeat(depth)}${node.recursive ? '… ' : ''}${item.name}${detail ? ` : ${detail}` : ''}`)
    for (const child of node.children ?? []) walk(child, depth + 1)
  }
  for (const node of nodes) walk(node, 0)
  return lines.join('\n')
}

/**
 * 剪贴板形式：每行一个位置（不含缩进），去重保序。
 * **这一条不是上游格式** —— 上游的"复制到剪贴板"走的是同一份 `ExporterToTextFileHierarchy`
 * 文本（`ExportToClipboardAction` 那条在本 checkout 里按名字与包路径都搜不到 ⇒ 无法核实）；
 * 本仓加它是为了"贴到聊天里能直接打开文件"，位置列（`path:line`，1 基）与
 * `src/usageViewGrouping.ts` 的 `exportUsagesText` 同一条口径。
 */

/** 剪贴板形式：每行一个位置（不含缩进），去重保序 —— 贴到聊天/issue 里最有用。 */
export function hierarchyClipboardText(nodes: readonly ExportHierarchyNode[]): string {
  const seen = new Set<string>()
  const out: string[] = []
  const walk = (node: ExportHierarchyNode): void => {
    const line = (node.item.line ?? 0) + 1
    const key = `${node.item.path}:${line}`
    if (!seen.has(key)) { seen.add(key); out.push(`${node.item.path}:${line}  ${node.item.name}`) }
    for (const child of node.children ?? []) walk(child)
  }
  for (const node of nodes) walk(node)
  return out.join('\n')
}

/** 摘要：根数 + 节点总数（导出标题与状态栏）。 */
export function hierarchySummary(nodes: readonly ExportHierarchyNode[]): string {
  let total = 0
  const count = (node: ExportHierarchyNode): void => {
    ++total
    for (const child of node.children ?? []) count(child)
  }
  for (const node of nodes) count(node)
  return `${nodes.length} 个根 · ${total} 个节点`
}
