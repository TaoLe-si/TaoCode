// 本地历史的**跨文件会话视图**（`pv/history` 判词里缺的那一条：Changed Files / 目录历史 /
// 「恢复整个会话」）。
//
// 上游依据（本批把裸文件名补成**整路径**，好让 `tests/source-citations.test.mjs` 真去核它们）：
//   · 目录级历史对话框：`platform/lvcs-impl/src/com/intellij/history/integration/ui/views/DirectoryHistoryDialog.java:52`
//     （类声明）与同文件 `:57` 的 `DirectoryHistoryDialog(Project p, IdeaGateway gw, VirtualFile f)`
//     —— 传的是一个目录，列出该目录下所有有历史的文件；
//     `platform/lvcs-impl/src/com/intellij/history/integration/ui/actions/ShowSelectionHistoryAction.java`
//     是同一件事的选中项入口。
//   · 变更文件的会话：`platform/lvcs-impl/src/com/intellij/history/integration/ui/actions/RecentChangesAction.java:18`
//     （Recent Changes 弹层）与
//     `platform/lvcs-impl/src/com/intellij/history/integration/ui/views/RevisionsList.java:390`
//     （渲染行）与同文件 `:442`（一行会话右侧的「N files」计数，键在
//     `platform/lvcs-impl/resources/messages/LocalHistoryBundle.properties:5` 的 `revisions.table.filesCount`），
//     回滚那一行的动作是同一 bundle `:10` 的 `action.revert`。
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

/**
 * 回滚的**落点**（③：用户可见路径与上游对齐）。
 *
 * 上游的坐标：
 *   `platform/lvcs-impl/src/com/intellij/history/integration/ui/models/DirectoryHistoryDialogModel.java:30-36`
 *   把所选版本的 diffs 整批交给
 *   `platform/lvcs-impl/src/com/intellij/history/integration/revertion/DifferenceReverter.kt:36-47`
 *   （`filesToClearROStatus` 收 diffs 左右两侧所有还能找到的文件）与同文件 `doRevert()`（`:49-52`），
 *   所以目录/会话对话框里那一行 Revert 的作用范围**从来不止活动文件**；
 *   `platform/lvcs-impl/src/com/intellij/history/integration/ui/models/HistoryDialogModel.java:179-189`
 *   的启用条件也只有 `myLeftRevisionIndex != -1`（= 选了版本），没有"必须是当前编辑的那个文件"这一条。
 *
 * 本仓的分档：
 *   · `host` —— 活动文件仍走宿主链（`emit('revert')` → `App.vue` 的 `revertHistory`），
 *     因为只有宿主会重建编辑器缓冲、刷新标签页版本，并把回滚本身再记一版
 *     （`native/main.cpp:976` 在 `file.write` 里记 `save`）。
 *   · `direct` —— 其它**仍在磁盘上**的文件：本面板直接 `history.content` + `file.read` +
 *     `file.write`（`restoreSession()` 早就在走这条路，这里只是把它开放给单行）。
 *   · `none` —— 没选中，或那一行的路径已经不在磁盘上（重命名前身 / 已删除）。上游能复原
 *     删除与重命名是因为它把 `DeleteChange`/`RenameChange` 当事件存着
 *     （`DifferenceReverter.doRevert` 里的 `revertDeletion`/`revertRename`）；本仓宿主按
 *     **当前路径**存快照、没有那两个事件通道，直接往旧路径写会凭空造出一个文件，所以禁掉。
 */
export type RevertRoute = 'host' | 'direct' | 'none'

export function revertRouteFor(
  selected: { path: string } | null, activePath: string, missingFromDisk: ReadonlySet<string>,
): RevertRoute {
  if (!selected) return 'none'
  const path = normalize(selected.path)
  if (path === normalize(activePath)) return 'host'
  return missingFromDisk.has(path) ? 'none' : 'direct'
}

/**
 * 已经不在磁盘上的路径：重命名前身（`renameFrom` —— 旧名字随 rename 一起消失）与删除行
 * （porcelain 的 X/Y 任一位是 `D`，`native/main.cpp:1131` 把这两个字母原样透传）。
 */
export function missingFromDiskPaths(
  changes: readonly Pick<GitChange, 'path' | 'renameFrom' | 'indexStatus' | 'workStatus'>[],
): Set<string> {
  const gone = new Set<string>()
  for (const change of changes) {
    const previous = normalize(change.renameFrom ?? '')
    if (previous) gone.add(previous)
    if ((change.indexStatus ?? '') === 'D' || (change.workStatus ?? '') === 'D') gone.add(normalize(change.path ?? ''))
  }
  gone.delete('')
  return gone
}

/**
 * 回滚跳过的原因。上游只有两档：
 * `platform/lvcs-impl/src/com/intellij/history/integration/revertion/Reverter.kt:24-29`
 * 的 `checkCanRevert()`（唯一检查项是只读，文案 `revert.error.files.are.read.only`）与
 * `platform/lvcs-impl/src/com/intellij/history/integration/ui/views/HistoryDialog.java:381`
 * 那个 `message.error.during.revert`。本仓把"异常"那一档再按宿主错误码分开（`CONFLICT` / `READ_ONLY` /
 * 其余），因为 `restoreSession()` 要逐文件尽力、必须能解释每个文件为什么没动。
 */
export type RevertSkipReason = 'read-only' | 'conflict' | 'unchanged' | 'failed'

/**
 * 前置检查（不传 `code`）= 上游 `checkCanRevert()` 的位置：只读位来自 `file.read` 的 `readOnly`
 * （`native/workspace.cpp:755`），写之前先照它，不去撞宿主那句 `READ_ONLY`
 * （`native/workspace.cpp:933-934`）。catch 里（一定传 `code`）= 错误码分类，永不返回 null。
 */
export function revertSkipFor(input: { readOnly?: boolean; unchanged?: boolean; code?: string | null }): RevertSkipReason | null {
  if (input.unchanged) return 'unchanged'
  if (input.readOnly) return 'read-only'
  if (input.code === undefined) return null
  if (input.code === 'CONFLICT') return 'conflict'
  if (input.code === 'READ_ONLY') return 'read-only'
  return 'failed'
}

/** 四档的展示名（顺序即汇总时的优先级：先说拦路的，再说本来就不用动的）。 */
export const REVERT_SKIP_LABELS: Record<RevertSkipReason, string> = {
  'read-only': '只读',
  conflict: '磁盘已变',
  unchanged: '内容已一致',
  failed: '写不进去',
}

const REVERT_SKIP_ORDER: readonly RevertSkipReason[] = ['read-only', 'conflict', 'unchanged', 'failed']

export function tallyRevertSkips(reasons: readonly RevertSkipReason[]): Partial<Record<RevertSkipReason, number>> {
  const tally: Partial<Record<RevertSkipReason, number>> = {}
  for (const reason of reasons) tally[reason] = (tally[reason] ?? 0) + 1
  return tally
}

/** 「只读 2、磁盘已变 1」——没有原因就返回空串，调用方据此省掉括号。 */
export function describeRevertSkips(tally: Readonly<Partial<Record<RevertSkipReason, number>>>): string {
  return REVERT_SKIP_ORDER
    .filter(reason => (tally[reason] ?? 0) > 0)
    .map(reason => `${REVERT_SKIP_LABELS[reason]} ${tally[reason]}`)
    .join('、')
}

/** 会话回滚的状态行：数字与原因都来自实际结果，不写"大概都好了"这种话。 */
export function sessionRevertReport(done: number, reasons: readonly RevertSkipReason[]): string {
  const detail = describeRevertSkips(tallyRevertSkips(reasons))
  if (!detail) return `会话回滚：已回退 ${done} 个文件。`
  return `会话回滚：已回退 ${done} 个文件，跳过 ${reasons.length} 个（${detail}）。`
}
