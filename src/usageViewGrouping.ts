// 用法/引用视图的**分组与导出**（上游 `platform/lang-impl/src/com/intellij/usageView/`：
// `UsageViewImpl` 的树按 目录/包/文件 分组（`UsageViewTreeStructureProvider` 一族），
// `UsageViewImpl.exportToText` 把整棵树导成文本；`FindUsagesScope` 提供范围收窄）。
//
// 本仓现状：引用面板（`src/referenceContents.ts`）是一张按路径排序的**平表**，没有分组树、
// 没有导出。这个模块补两件纯规则：分组树（目录 → 文件 → 位置）与文本导出的固定格式
// （IDEA 导出的就是 `path:line` 每行一条，带标题头）。
//
// 输入形状与 `src/bridge.ts` 的 `LspLocation` 结构一致（path/line/character），不 import 桥接层。

export interface UsageLocationLike {
  path: string
  /** 0 基行号。 */
  line: number
  character?: number
}

/** 分组树节点：目录或文件。 */
export interface UsageTreeNode {
  kind: 'directory' | 'file'
  /** 展示名（目录/文件名；根节点为工作区名）。 */
  name: string
  /** 该节点下的完整路径（目录用 `/` 结尾）。 */
  path: string
  /** 子树里的引用总数。 */
  count: number
  children: UsageTreeNode[]
  /** 文件节点的位置列表（目录为空数组）。 */
  locations: UsageLocationLike[]
}

function normalize(path: string): string {
  return path.replace(/\\/g, '/').replace(/^\.\//, '')
}

/** 树去重后的插入：目录存在就复用（保持首次出现顺序）。 */
function ensureDirectory(root: UsageTreeNode, segments: readonly string[]): UsageTreeNode {
  let node = root
  let path = ''
  for (const segment of segments) {
    path = path ? `${path}/${segment}` : segment
    let child = node.children.find(entry => entry.kind === 'directory' && entry.name === segment)
    if (!child) {
      child = { kind: 'directory', name: segment, path: `${path}/`, count: 0, children: [], locations: [] }
      node.children.push(child)
    }
    node = child
  }
  return node
}

/**
 * 按目录分组建树：目录层级按路径拆，文件节点里放位置；目录的 count 是子树合计。
 * 同一文件的位置按行号升序（同行的按列号）。
 */
export function buildUsageTree(locations: readonly UsageLocationLike[], rootName = '工作区'): UsageTreeNode {
  const root: UsageTreeNode = { kind: 'directory', name: rootName, path: '', count: 0, children: [], locations: [] }
  for (const location of locations) {
    if (!location || typeof location.path !== 'string' || !location.path) continue
    const normalized = normalize(location.path)
    const segments = normalized.split('/')
    const fileName = segments.pop() ?? normalized
    const directory = ensureDirectory(root, segments)
    let file = directory.children.find(entry => entry.kind === 'file' && entry.name === fileName)
    if (!file) {
      file = { kind: 'file', name: fileName, path: normalized, count: 0, children: [], locations: [] }
      directory.children.push(file)
    }
    file.locations.push({ path: normalized, line: location.line, character: location.character })
    file.count += 1
  }
  const total = (node: UsageTreeNode): number => {
    node.children.sort((left, right) => left.kind === right.kind ? left.name.localeCompare(right.name) : left.kind === 'directory' ? -1 : 1)
    if (node.kind === 'file') {
      node.locations.sort((left, right) => left.line - right.line || (left.character ?? 0) - (right.character ?? 0))
      node.count = node.locations.length
    } else {
      let sum = 0
      for (const child of node.children) sum += total(child)
      node.count = sum
    }
    return node.count
  }
  total(root)
  return root
}

/** 文件的平表分组（引用面板打印 `path (N)` 那一步）。 */
export interface UsageFileGroup {
  path: string
  count: number
  locations: UsageLocationLike[]
}

export function groupUsagesByFile(locations: readonly UsageLocationLike[]): UsageFileGroup[] {
  const groups = new Map<string, UsageFileGroup>()
  for (const location of locations) {
    if (!location || !location.path) continue
    const path = normalize(location.path)
    const group = groups.get(path) ?? { path, count: 0, locations: [] }
    group.locations.push({ ...location, path })
    group.count += 1
    groups.set(path, group)
  }
  return [...groups.values()]
    .map(group => ({ ...group, locations: group.locations.slice().sort((left, right) => left.line - right.line || (left.character ?? 0) - (right.character ?? 0)) }))
    .sort((left, right) => left.path.localeCompare(right.path))
}

/** 摘要：`N 处引用 / M 个文件`。 */
export function usageSummary(locations: readonly UsageLocationLike[]): string {
  const files = new Set(locations.map(location => normalize(location.path)))
  return `${locations.length} 处引用 / ${files.size} 个文件`
}

/**
 * 导出文本（IDEA 的 `exportToText` 格式：标题 + `path:line` 每行一条，按文件分组）。
 * `header` 为空时不加标题行。
 */
export function exportUsagesText(locations: readonly UsageLocationLike[], header = ''): string {
  const lines: string[] = []
  if (header) lines.push(header, '')
  for (const group of groupUsagesByFile(locations)) {
    for (const location of group.locations) lines.push(`${group.path}:${location.line + 1}`)
  }
  return lines.join('\n')
}

/** 剪贴板用的紧凑形式（同文件合并成一行路径 + 行号列表）。 */
export function usagesClipboardText(locations: readonly UsageLocationLike[]): string {
  return groupUsagesByFile(locations)
    .map(group => `${group.path}: ${group.locations.map(location => location.line + 1).join(', ')}`)
    .join('\n')
}
