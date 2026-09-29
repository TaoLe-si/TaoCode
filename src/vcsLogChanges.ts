// View model only: the backend adapter must map its documented response to this type.
// null changes means unavailable/not loaded; [] means a successfully loaded empty commit.
export interface VcsLogChange { path: string; status: string; previousPath?: string }
export interface VcsLogChangeNode { name: string; path: string; children: VcsLogChangeNode[]; change?: VcsLogChange }
export function changeTree(changes: VcsLogChange[]): VcsLogChangeNode[] {
  const roots: VcsLogChangeNode[] = []
  for (const change of changes) {
    const parts = change.path.split('/')
    let siblings = roots
    let path = ''
    parts.forEach((name, index) => {
      path = path ? `${path}/${name}` : name
      let node = siblings.find(item => item.path === path)
      if (!node) { node = { name, path, children: [] }; siblings.push(node) }
      if (index === parts.length - 1) node.change = change
      siblings = node.children
    })
  }
  const sort = (nodes: VcsLogChangeNode[]) => {
    nodes.sort((a, b) => Number(Boolean(a.change)) - Number(Boolean(b.change)) || a.name.localeCompare(b.name))
    nodes.forEach(node => sort(node.children))
  }
  sort(roots)
  return roots
}
