// IDEA's Todo view builds its tree from the file index: packages (the containing
// directories) hold files, files hold the marked items, and "Group By ▸ Packages" /
// "Flatten Packages" decide how directory levels are shown
// (platform/todo TodoPanelSettings + TodoTreeBuilder). Kept pure so the grouping rules
// are unit-testable (tests/todo-tree.test.mjs).

export interface TodoItem {
  path: string
  line: number
  text: string
  kind: string
  /** 标记在行内的起始列（0 基，`SearchMatch.column`），多行 TODO 用它定续行的列。 */
  column?: number
  /** 多行 TODO 的续行（`src/todoMultiLine.ts` 的判定结果；没开多行时是空）。 */
  additional?: string[]
}
export interface TodoFileNode { kind: 'file'; id: string; label: string; path: string; items: TodoItem[] }
export interface TodoPackageNode { kind: 'package'; id: string; label: string; path: string; children: TodoNode[] }
export type TodoNode = TodoFileNode | TodoPackageNode

export interface TodoTreeOptions { showPackages: boolean; flattenPackages: boolean }
export interface TodoRow { depth: number; node: TodoNode; expanded?: boolean; item?: TodoItem }

const directoryOf = (path: string) => (path.includes('/') ? path.slice(0, path.lastIndexOf('/')) : '')

export function buildTodoTree(items: TodoItem[], options: TodoTreeOptions): TodoNode[] {
  const files = filesByPath(items)
  if (!options.showPackages) return files
  if (options.flattenPackages) {
    // One node per containing directory, labelled with the full path; files that sit in
    // the project root stay at the top level, exactly as IDEA leaves them unpackaged.
    const byDir = new Map<string, TodoNode[]>()
    const loose: TodoNode[] = []
    for (const file of files) {
      const dir = directoryOf(file.path)
      if (!dir) { loose.push(file); continue }
      byDir.set(dir, [...(byDir.get(dir) ?? []), file])
    }
    const groups = [...byDir.entries()]
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([dir, children]) => ({ kind: 'package' as const, id: dir, label: dir, path: dir, children }))
    return [...loose, ...groups]
  }
  const roots: TodoNode[] = []
  const packages = new Map<string, TodoPackageNode>()
  for (const file of files) {
    const segments = file.path.split('/')
    let parentChildren = roots
    let parentPath = ''
    for (const segment of segments.slice(0, -1)) {
      parentPath = parentPath ? `${parentPath}/${segment}` : segment
      let nested = packages.get(parentPath)
      if (!nested) {
        nested = { kind: 'package', id: parentPath, label: segment, path: parentPath, children: [] }
        packages.set(parentPath, nested)
        parentChildren.push(nested)
      }
      parentChildren = nested.children
    }
    parentChildren.push(file)
  }
  return roots
}

function filesByPath(items: TodoItem[]): TodoFileNode[] {
  const byFile = new Map<string, TodoItem[]>()
  for (const item of items) byFile.set(item.path, [...(byFile.get(item.path) ?? []), item])
  return [...byFile.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([path, list]) => ({
      kind: 'file' as const, id: path, label: path.split('/').pop() ?? path, path,
      items: [...list].sort((a, b) => a.line - b.line),
    }))
}

// Packages render only their children once expanded; file rows always show their items.
export function flattenTodoRows(nodes: TodoNode[], expanded: Set<string>, depth = 0): TodoRow[] {
  const rows: TodoRow[] = []
  for (const node of nodes) {
    if (node.kind === 'package') {
      const open = expanded.has(node.id)
      rows.push({ depth, node, expanded: open })
      if (open) rows.push(...flattenTodoRows(node.children, expanded, depth + 1))
      continue
    }
    rows.push({ depth, node })
    for (const item of node.items) rows.push({ depth: depth + 1, node, item })
  }
  return rows
}

export function packageIds(nodes: TodoNode[]): string[] {
  const ids: string[] = []
  for (const node of nodes) if (node.kind === 'package') { ids.push(node.id); ids.push(...packageIds(node.children)) }
  return ids
}

// Previous/Next Occurrence walk the items in tree order, like IDEA's toolbar actions.
export function orderedItems(nodes: TodoNode[]): { path: string; line: number }[] {
  const list: { path: string; line: number }[] = []
  for (const node of nodes) {
    if (node.kind === 'file') for (const item of node.items) list.push({ path: item.path, line: item.line })
    else list.push(...orderedItems(node.children))
  }
  return list
}
