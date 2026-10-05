// 本地历史的**重命名跟踪**（`--follow` 式）—— `pv/history` 族缺的那一条。
//
// 上游 `LocalHistoryImpl` 自己记录重命名（`Change`/`RenameChange` 一族：内容、目录、重命名
// 都是事件），所以换个名字接着看历史是自然的。本仓宿主（`native/history.cpp`）按路径存快照，
// 没有重命名事件通道；跟踪改从 Git 的重命名检测拿路径链：
//   · 工作区里还没提交的重命名：`git.status` 的 `GitChange.renameFrom`（`native/git.cpp`
//     已从 porcelain 的 `R <old> <new>` 解出，见 `:271-292`）；
//   · 已提交的重命名：`git.fileHistory` 的 `--follow` 负责提交历史那一侧，本地历史
//     这一侧按同一条 renameFrom 链跟随。
// 拿到链之后逐段 `history.list`，把旧路径的时间线并到当前路径的列表里（标「重命名前」）。
// 旧路径的差异仍可读（`history.diff` 收 path 参数）；**回滚禁用**——宿主的回退动作按当前
// 路径写入，App.vue 不接受"回滚到另一个路径的快照"。
import type { GitChange, HistoryEntry } from './bridge'

export interface HistoryFollowGroup {
  path: string
  /** true = 这是重命名前的旧路径，条目只是被跟随过来。 */
  followed: boolean
  entries: HistoryEntry[]
}

const normalize = (path: string) => path.replace(/\\/g, '/')

/**
 * 路径的重命名前身链（最近的前身在前面），最多 `limit` 段：
 * `C.txt ← B.txt ← A.txt` 走 `[B.txt, A.txt]`。自环与链上的环都会被截断。
 */
export function renameChain(changes: readonly Pick<GitChange, 'path' | 'renameFrom'>[], path: string, limit = 8): string[] {
  const target = normalize(path)
  const from = new Map<string, string>()
  for (const change of changes) {
    const next = normalize(change.path ?? '')
    const previous = normalize(change.renameFrom ?? '')
    if (next && previous) from.set(next, previous)
  }
  const chain: string[] = []
  const seen = new Set<string>([target])
  let cursor = target
  while (chain.length < limit) {
    const previous = from.get(cursor)
    if (!previous || seen.has(previous)) break
    chain.push(previous)
    seen.add(previous)
    cursor = previous
  }
  return chain
}

/** 当前路径在前、旧路径随后（依次变老），供面板分组渲染。 */
export function mergeHistory(
  currentPath: string, current: readonly HistoryEntry[], ancestors: readonly { path: string; entries: readonly HistoryEntry[] }[],
): HistoryFollowGroup[] {
  const groups: HistoryFollowGroup[] = [{ path: normalize(currentPath), followed: false, entries: [...current] }]
  for (const ancestor of ancestors) groups.push({ path: normalize(ancestor.path), followed: true, entries: [...ancestor.entries] })
  return groups
}
