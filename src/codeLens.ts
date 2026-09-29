// LSP `textDocument/codeLens` —— IDEA 的 **Code Vision**（行上方"3 usages / 1 implementation"这类提示）。
//
// IDEA 侧已核实的类与行号：
//   · `CodeVisionProvider`（`platform/lang-impl/src/com/intellij/codeInsight/codeVision/CodeVisionProvider.kt:25`）
//   · 产生条目 `computeForEditor(editor, uiData): List<Pair<TextRange, CodeVisionEntry>>`（`:62`）
//   · 点击行为 `handleClick(editor, textRange, entry)`（`:76`）
//   · 可用性 `isAvailableFor(project)`（`:35`）；锚点偏好 `defaultAnchor`（`:107`）
//
// 这个模块只管**纯规则**（挂到哪一行、点击要发什么命令）；CodeMirror 的渲染与调度在
// `codeLensExtension.ts`。

export interface CodeLensItem {
  /** 显示文字（LSP 把它放在 `command.title` 里）。 */
  title: string
  /** 要执行的命令名 —— 点击时转成 `workspace/executeCommand`。 */
  command: string
  /** 命令参数（可选）。 */
  arguments?: unknown[]
  /** 锚点区间（可选）。 */
  range?: { startLine: number; startChar: number; endLine: number; endChar: number }
}

export interface CodeLensResult {
  available: boolean
  items?: CodeLensItem[]
}

/** 一条挂了锚点的 Code Vision 条目。 */
export interface AnchoredLens {
  line: number
  item: CodeLensItem
}

/**
 * 按行整理成可渲染的列表。
 *
 * **没有 `range` 的条目丢弃**：IDEA 靠 `defaultAnchor` 决定挂在行首还是行尾，而 LSP 用 `range`
 * 表达同一件事 —— 没有它就不知道该挂哪一行，挂到第 0 行是**编造**一个位置。
 * 同一行多条时保持适配器给的顺序（顺序通常带语义）。
 */
export function anchoredLenses(items: readonly CodeLensItem[] | undefined): AnchoredLens[] {
  if (!Array.isArray(items)) return []
  const out: AnchoredLens[] = []
  for (const item of items) {
    const range = item?.range
    if (!range) continue
    if (!Number.isInteger(range.startLine) || range.startLine < 0) continue
    if (typeof item.title !== 'string' || item.title === '') continue
    if (typeof item.command !== 'string' || item.command === '') continue
    out.push({ line: range.startLine, item })
  }
  // 稳定排序（同行的保持原顺序），block widget 必须按位置递增添加。
  return out.map((entry, index) => ({ entry, index }))
    .sort((left, right) => left.entry.line - right.entry.line || left.index - right.index)
    .map(({ entry }) => entry)
}

/** 点击要发什么。缺省 `arguments` 时**不带这个键**（`executeCommand` 里它是可选的）。 */
export function codeLensCommand(item: CodeLensItem | undefined): { command: string; arguments?: unknown[] } | null {
  if (!item || !item.command) return null
  return Array.isArray(item.arguments) ? { command: item.command, arguments: item.arguments } : { command: item.command }
}

/** 悬停提示：告诉用户点一下会发生什么（IDEA 的 Code Vision 也有 tooltip）。 */
export function codeLensTooltip(item: CodeLensItem | undefined): string {
  if (!item) return ''
  return `执行 ${item.command}${item.arguments?.length ? `（${item.arguments.length} 个参数）` : ''}`
}
