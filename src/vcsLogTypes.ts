// Git log wire models; re-exported by bridge for existing callers.
import type { DiffSides } from './bridge'
export interface GitChange { path: string; indexStatus: string; workStatus: string; staged: boolean; untracked: boolean; renameFrom: string; /** 被 .gitignore 忽略（只有开着「忽略的文件」那一档才会列出来）。 */ ignored?: boolean }
export interface GitUser { name: string; email: string }
export interface GitStatus { available: boolean; head?: string; branches?: string[]; changes?: GitChange[] }
export interface GitDiff { diff: string }
export interface GitCommit { hash: string; shortHash: string; author: string; date: string; subject: string }
export interface GitLog { commits: GitCommit[] }
export interface GitRef { name: string; type: 'local' | 'remote' | 'tag' | 'head' }
export interface GitFullCommit { hash: string; shortHash: string; author: string; date: string; subject: string; parents: string[]; refs: GitRef[] }
export interface GitFullLog { commits: GitFullCommit[]; offset: number; limit: number; hasMore: boolean }
/** 提交图排序档（`PermanentGraph.SortType`）：`topological` = 拓扑序，`date` = 按提交日期。 */
export type GitLogSort = 'date' | 'topological'
export interface GitLogQuery {
  limit?: number
  offset?: number
  refs?: string[]
  author?: string
  text?: string
  since?: string
  until?: string
  path?: string
  /** `Vcs.Log.EnableFilterByRegexAction`（正则表达式）：`text` 按正则而不是字面量匹配。缺省 false。 */
  textRegex?: boolean
  /** `Vcs.Log.MatchCaseAction`（区分大小写）：缺省 false，即默认忽略大小写。 */
  matchCase?: boolean
  /** 图选项的排序档（`graph.sort.standard` / `graph.sort.off`）。缺省 `date`。 */
  sort?: GitLogSort
  /** `graph.options.first.parent`（第一个父项）。缺省 false。 */
  firstParent?: boolean
  /** `vcs.log.filter.no.merges`（无合并）：只留非合并提交。缺省 false。 */
  noMerges?: boolean
}
export interface GitCommitDetails {
  revision: string; hash: string; shortHash: string; author: string; authorEmail: string; date: string
  committer: string; committerEmail: string; committerDate: string; parents: string[]; message: string; containingBranches: string[]
}
export interface GitCommitChange {
  status: string; path: string; beforePath: string; afterPath: string; revision: string; beforeRevision: string; afterRevision: string
}
export interface GitCommitComparison { parent: string; revision: string; files: GitCommitChange[] }
export interface GitCommitChanges { revision: string; parents: string[]; comparisons: GitCommitComparison[] }
export interface GitCommitFileDiff {
  beforeRevision: string; beforePath: string; afterRevision: string; afterPath: string
  beforeMode: string; afterMode: string; beforeSize: number; afterSize: number; maxBytes: number
  status: 'text' | 'binary' | 'tooLarge' | 'unsupported'; patch: string; sides: DiffSides | null
}
export interface GitStashEntry { ref: string; message: string }
export interface GitStash { entries: GitStashEntry[] }
export interface GitAheadBehind { available: boolean; ahead: number; behind: number }
// One selectable hunk of a unified diff (commit-viewer stage/unstage rows).
export interface GitHunk { index: number; header: string; body: string; additions: number; deletions: number }
export interface GitHunks { hunks: GitHunk[]; header: string }
export interface GitTags { tags: string[] }
export interface GitCompareFile { status: string; path: string }
export interface GitCompare { base: string; files: GitCompareFile[] }
export interface GitBlameLine { line: number; hash: string; author: string; email: string; date: string; summary: string; content: string }
export interface GitBlame { lines: GitBlameLine[] }
