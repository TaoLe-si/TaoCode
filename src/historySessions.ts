// 本地历史的**跨文件会话视图**（`pv/history` 判词里缺的那一条：Changed Files / 目录历史 /
// 「恢复整个会话」）。
//
// 上游依据：
//   · 目录级历史对话框：`DirectoryHistoryDialog.java:52`（类声明）与 `:57`
//     `DirectoryHistoryDialog(Project p, IdeaGateway gw, VirtualFile f)` —— 传的是一个目录，
//     列出该目录下所有有历史的文件；`ShowSelectionHistoryAction.java` 是同一件事的选中项入口。
//   · 变更文件的会话：`RecentChangesAction.java:18`（Recent Changes 弹层）与
//     `RevisionsList.java:390`/`:442`（一行会话右侧的「N files」计数，键
//     `LocalHistoryBundle.properties` 的 `revisions.table.filesCount`），
//     回滚那一行的动作是同一 bundle 里的 `action.revert`。
//
// 架构不等价（本仓怎么承接）：上游的历史库里一条 **session** 记录天生覆盖多个文件；
// 本仓宿主按路径存快照（`native/history.cpp` + `native/history.hpp:35` 的 `list()`，
// 一个路径一条时间线，**没有**跨文件的会话索引，`history.list` 也只收一个 path）。
// 所以会话视图这样还原：候选路径 = 当前文件 + Git 变更列表里的文件（含 `renameFrom` 前身，
// `native/git.cpp:271-292` 已解出）→ 逐路径 `history.list` → 按各自最新快照的时间倒序排，
// 一行一个文件并带上它的快照数（= 上游「N files」那一列的本仓等价物）。
// 「恢复整个会话」= 选定一个时刻，把列表里每个文件回滚到**该时刻之前**的最后一个快照。
import type { GitChange, HistoryEntry } from './bridge.ts'

/**
 * 逐路径 `history.list` 的路径上限。宿主没有跨文件索引，会话视图是 N 次请求；
 * 上限挡住「一个 500 文件的改动集把面板卡死」，超出部分如实显示在面板的状态行里。
 */
export const HISTORY_SESSION_PATH_LIMIT = 32

export interface HistorySessionFile {
  path: string
  /** 该文件最新一次快照的时间（毫秒），用于跨文件排序。 */
  latestMillis: number
  /** 展示用的时间文本（宿主给的 ISO 串，去掉 T/Z 后的形态）。 */
  latestTime: string
  /** 该文件在本地历史里的快照数 —— 上游会话行的「N files」在本仓是「N 个版本」。 */
  versions: number
  entries: HistoryEntry[]
}

const normalize = (path: string) => path.replace(/\\/g, '/')

/**
 * 会话视图的候选路径：当前文件在最前，接着是 Git 变更集里的文件（含重命名前身），
 * 去重后截到 `limit`。非仓库 / Git 不可用时只剩当前文件（`git.status` 给空集）。
 */
export function sessionCandidatePaths(
  changes: readonly Pick<GitChange, 'path' | 'renameFrom'>[], currentPath: string, limit = HISTORY_SESSION_PATH_LIMIT,
): string[] {
  const seen = new Set<string>()
  const paths: string[] = []
  const push = (raw: string | undefined) => {
    const path = normalize(raw ?? '')
    if (!path || seen.has(path)) return
    seen.add(path)
    paths.push(path)
  }
  push(currentPath)
  for (const change of changes) {
    push(change.path)
    push(change.renameFrom)
  }
  return paths.slice(0, Math.max(0, limit))
}

/** 逐路径列到的结果 → 会话行：丢掉没有历史的，按最新快照时间从新到旧。 */
export function buildSessionFiles(
  listed: readonly { path: string; entries: readonly HistoryEntry[] }[],
): HistorySessionFile[] {
  const files: HistorySessionFile[] = []
  for (const item of listed) {
    if (!item.entries.length) continue
    // 宿主的 list() 就是新→旧（native/history.hpp:35），第一条即最新，不需要再扫一遍。
    const newest = item.entries[0]!
    files.push({
      path: normalize(item.path),
      latestMillis: newest.timeMillis,
      latestTime: newest.time,
      versions: item.entries.length,
      entries: [...item.entries],
    })
  }
  return files.sort((a, b) => b.latestMillis - a.latestMillis || a.path.localeCompare(b.path))
}

/**
 * 目录过滤（`DirectoryHistoryDialog` 收的那个目录）：`directory` 为空 = 全部；
 * 否则只留该目录**及其子目录**下的路径。按路径段比，避免 `src/app` 命中 `src/application`。
 */
export function withinDirectory(path: string, directory: string): boolean {
  const dir = normalize(directory).replace(/\/+$/, '')
  if (!dir) return true
  const file = normalize(path)
  return file === dir || file.startsWith(dir + '/')
}

export function filterSessionFiles(files: readonly HistorySessionFile[], directory: string): HistorySessionFile[] {
  if (!normalize(directory)) return [...files]
  return files.filter(file => withinDirectory(file.path, directory))
}

/** 某文件在该时刻**之前**（含同一毫秒）的最后一个快照；没有就返回 null。 */
export function newestSnapshotBefore(entries: readonly HistoryEntry[], boundaryMillis: number): HistoryEntry | null {
  for (const entry of entries) if (entry.timeMillis <= boundaryMillis) return entry
  return null
}

export interface SessionRevertStep {
  path: string
  entry: HistoryEntry
}

/**
 * 「恢复整个会话」的清单：每个文件回滚到边界时刻之前的最后一个快照。
 * 已经是最新快照的文件**不进清单**（上游 `LocalHistoryFacade` 的 revert 也只动真被改过的），
 * 在那个时刻之后才开始有历史的文件同样跳过 —— 没有更早的快照可回。
 */
export function sessionRevertPlan(
  files: readonly { path: string; entries: readonly HistoryEntry[] }[], boundaryMillis: number,
): SessionRevertStep[] {
  const plan: SessionRevertStep[] = []
  for (const file of files) {
    if (!file.entries.length) continue
    const target = newestSnapshotBefore(file.entries, boundaryMillis)
    if (!target || target.id === file.entries[0]!.id) continue
    plan.push({ path: normalize(file.path), entry: target })
  }
  return plan
}
