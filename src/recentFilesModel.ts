// 最近文件模型（上游 `platform/recentFiles` 一族的可移植内核）—— 纯函数，无 Vue、无 DOM。
//
// 逐条对照：
//   · `RecentFilesMutableState.kt` 的三个状态与四个事件：本文件用**三个数组**（recentlyOpened /
//     recentlyEdited / recentlyOpenedPinned）承载；`addEvent`（:31-39，batch 整体置顶、旧表里的重复项
//     先删掉）、`updateEvent`（:41-60，`putOnTop` 为真时把命中的旧项按旧表顺序挪到最前，为假时就地
//     替换）、`removeEvent`（:62-70）、`removeAllEvent`（:72-78）。
//   · `chooseStateToWriteTo`（:24-29）：`RECENTLY_OPENED_UNPINNED` 写的是 pinned 那份（上游枚举名与
//     状态名的对调是上游自己的历史遗留，这里照抄，不"修正"）。
//   · `SWITCHER_ELEMENTS_LIMIT = 30`（`FileSwitcherApi.kt:101`）：Switcher 一次最多列 30 条，
//     写入路径也按同一上限截断（本仓 Ctrl+E 面板同口径）。
//   · `isAllowedInRecentFiles`（`RecentFilesExcluder.kt:31-42`）：文件必须 valid，且没有任何
//     `RecentFilesExcluder` 扩展点拒绝它 —— 本仓的"扩展点"就是一个谓词数组。
//   · `RecentFilesVfsListener` 的删除语义：文件从磁盘消失时从表里删掉（本仓用 `removeEvent`）。
//
// 本仓的持久化：整表 JSON 存在 localStorage 的 `taocode.recentFiles`（应用级、跨项目 —— 与上游
// `RecentFilesManager` 的进程级列表同义；工程级那份由 Ctrl+E 面板自己的列表管）。持久化只收
// **工作区相对路径或绝对路径的字符串**，不存对象，坏数据整份丢弃（宁可空表，不要半条乱码）。

/** 最近文件的三个类别（`RecentFileKind`）。 */
export type RecentFileKind = 'recentlyOpened' | 'recentlyEdited' | 'recentlyOpenedUnpinned'

/** `SWITCHER_ELEMENTS_LIMIT`（`FileSwitcherApi.kt:101`）：Switcher / 最近文件面板一次最多 30 条。 */
export const SWITCHER_ELEMENTS_LIMIT = 30

/** 本仓的持久化键（应用级，跨项目）。 */
export const RECENT_FILES_STORAGE_KEY = 'taocode.recentFiles'

/** 三个类别的容器。数组第 0 条 = 最近（上游 state 的 entries 同一顺序）。 */
export interface RecentFilesState {
  recentlyOpened: string[]
  recentlyEdited: string[]
  recentlyOpenedPinned: string[]
}

export function emptyRecentFilesState(): RecentFilesState {
  return { recentlyOpened: [], recentlyEdited: [], recentlyOpenedPinned: [] }
}

/** `chooseStateToWriteTo`（:24-29）：类别 → 容器字段。 */
export function stateKeyForKind(kind: RecentFileKind): keyof RecentFilesState {
  switch (kind) {
    case 'recentlyEdited': return 'recentlyEdited'
    case 'recentlyOpened': return 'recentlyOpened'
    case 'recentlyOpenedUnpinned': return 'recentlyOpenedPinned'
  }
}

/**
 * `addEvent`（:31-39）：`batch + (old - batch)` —— 新条目整体置顶，旧表里的同值条目先全部删掉。
 * 超过上限时从**尾部**截断（最早打开的先丢）。
 */
export function addEvent(entries: readonly string[], batch: readonly string[], limit = SWITCHER_ELEMENTS_LIMIT): string[] {
  if (!batch.length) return [...entries]
  const incoming = new Set(batch)
  const rest = entries.filter(entry => !incoming.has(entry))
  return [...batch, ...rest].slice(0, Math.max(0, limit))
}

/**
 * `updateEvent`（:41-60）：
 *   · `putOnTop` 为真 —— 命中的旧项按**旧表顺序**整体挪到最前（上游 `mapNotNull` 保序），其余保持
 *     旧表相对顺序；
 *   · 为假 —— 就地替换（旧表里同值项换成 batch 里对应的那条），顺序不变。
 * 本仓的值是字符串，替换与不替换同值，所以为假的分支就是原样返回；函数保留完整签名以对齐上游语义。
 */
export function updateEvent(entries: readonly string[], batch: readonly string[], putOnTop: boolean): string[] {
  if (!putOnTop || !batch.length) return [...entries]
  const incoming = new Set(batch)
  const promoted = entries.filter(entry => incoming.has(entry))
  const rest = entries.filter(entry => !incoming.has(entry))
  return [...promoted, ...rest]
}

/** `removeEvent`（:62-70）：删掉 batch 里的全部同值项。 */
export function removeEvent(entries: readonly string[], batch: readonly string[]): string[] {
  if (!batch.length) return [...entries]
  const doomed = new Set(batch)
  return entries.filter(entry => !doomed.has(entry))
}

/** `removeAllEvent`（:72-78）。 */
export function removeAllEvent(): string[] {
  return []
}

/** `isAllowedInRecentFiles`（`RecentFilesExcluder.kt:31-42`）的谓词形态。 */
export type RecentFileExcluder = (kind: RecentFileKind, path: string) => boolean

/**
 * 逐类别判定：任何一条 excluder 说"排除"就不进表。上游还有 `file.isValid`（VirtualFile 有效性）——
 * 本仓磁盘有效性的等价物是"文件清单里还能找到它"，由调用方在 `workspace.files` 上判定后传进
 * `excluded` 参数（不在这里发请求：模型保持纯函数）。
 */
export function isAllowedInRecentFiles(
  kind: RecentFileKind,
  path: string,
  excluders: readonly RecentFileExcluder[] = [],
  excluded = new Set<string>(),
): boolean {
  if (!path || excluded.has(path)) return false
  return !excluders.some(excluder => excluder(kind, path))
}

/**
 * 删除文件时对三个表一起做减法（`RecentFilesVfsListener` 的语义）。
 * 返回新状态；没有任何表包含它时原样返回（调用方可据此跳过写盘）。
 */
export function removeFromAll(state: RecentFilesState, paths: readonly string[]): RecentFilesState {
  const next: RecentFilesState = {
    recentlyOpened: removeEvent(state.recentlyOpened, paths),
    recentlyEdited: removeEvent(state.recentlyEdited, paths),
    recentlyOpenedPinned: removeEvent(state.recentlyOpenedPinned, paths),
  }
  const changed = (next.recentlyOpened.length !== state.recentlyOpened.length)
    || (next.recentlyEdited.length !== state.recentlyEdited.length)
    || (next.recentlyOpenedPinned.length !== state.recentlyOpenedPinned.length)
  return changed ? next : state
}

/** Ctrl+E 面板的行序：最近打开（pinned 那批在前），去重后截到上限。 */
export function recentFilesRows(state: RecentFilesState, kind: RecentFileKind = 'recentlyOpened', limit = SWITCHER_ELEMENTS_LIMIT): string[] {
  const primary = state[stateKeyForKind(kind)]
  const pinned = kind === 'recentlyOpened' ? state.recentlyOpenedPinned : []
  const seen = new Set<string>()
  const rows: string[] = []
  for (const path of [...pinned, ...primary]) {
    if (seen.has(path)) continue
    seen.add(path)
    rows.push(path)
    if (rows.length >= limit) break
  }
  return rows
}

/** 写盘用的 JSON（只序列化三个表，坏数组元素在解析时已被剔除）。 */
export function serializeRecentFiles(state: RecentFilesState): string {
  return JSON.stringify(state)
}

/**
 * 读回一份。任何一层不是字符串数组就丢弃那一条；整体不是对象则返回空状态。
 * 解析失败不抛（localStorage 里可能是上一次版本写的东西）。
 */
export function parseRecentFiles(raw: string | null | undefined): RecentFilesState {
  let parsed: unknown
  try { parsed = raw ? JSON.parse(raw) : null } catch { return emptyRecentFilesState() }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return emptyRecentFilesState()
  const list = (value: unknown): string[] => {
    if (!Array.isArray(value)) return []
    const seen = new Set<string>()
    const out: string[] = []
    for (const item of value) {
      if (typeof item !== 'string' || !item || seen.has(item)) continue
      seen.add(item)
      out.push(item)
    }
    return out.slice(0, SWITCHER_ELEMENTS_LIMIT)
  }
  const source = parsed as Record<string, unknown>
  return {
    recentlyOpened: list(source.recentlyOpened),
    recentlyEdited: list(source.recentlyEdited),
    recentlyOpenedPinned: list(source.recentlyOpenedPinned),
  }
}
