// 差异视图**内部的查找**（上游 `SearchInDiffChangesProvider` + `ToggleSearchInChangesAction`
// 与 `vcs-impl/.../diff/impl/combined/search/` 那一组：
// `CombinedDiffSearchEditorActionHandler` / `CombinedDiffSearchProviderImpl` /
// `CombinedEditorSearchSession` / `CombinedEditorSearchSessionListener`）。
//
// 上游那套是「多编辑器搜索会话」：一个 `FindModel` 同时喂给左/右（以及合成视图里每个文件的）
// 编辑器会话，命中数按**编辑器**汇总，走到当前编辑器没有更后面的命中时就换下一个编辑器；
// `ToggleSearchInChangesAction` 切换 `ENABLE_SEARCH_IN_CHANGES` 标志，开着时
// `SearchInDiffChangesProvider.getSearchArea` 把搜索区收窄到**改动区间**（左右各自的变化范围）。
//
// 本仓把同一套语义折到一份行表上（`DiffRow[]`：左边一列 + 右边一列），全部是纯函数：
//   · `diffSearchCells` 给出每一行每一侧的文本与「这一侧在这行是否改动」；
//   · `collectDiffMatches` 用 `src/editorSearch.ts` 的同一套匹配语义（大小写/全词/正则、
//     坏正则返回空集）收命中，`inChanges` 开着时只收改动那一侧；
//   · 命中上限取 `LivePreviewController.MATCHES_LIMIT`（`:42`）的 10000，与上游一致；
//   · `nextDiffMatchIndex` 走编辑器查找的回绕语义，`highlightPieces` 把「词级高亮」与
//     「查找命中」两套标记合成不重叠的片段（渲染层用）。
//
// **本仓的差别（如实记）**：上游按编辑器（一个文件的两侧是两个编辑器）分别做会话、跨编辑器
// 前进时不回绕；本仓是一份行表、命中统一编号，跳转在整表内回绕 —— 用户可见的差别只在
// 「最后一条再按下一个」：上游停在原地，本仓回到第一条（与编辑器内查找一致）。
import type { DiffRow } from './bridge.ts'
import { buildSearchRegex, collectSearchMatches, type SearchOptions } from './editorSearch.ts'

/** 上游 `LivePreviewController.MATCHES_LIMIT:42`。 */
export const DIFF_SEARCH_MATCHES_LIMIT = 10000

/**
 * 差异视图内的查找选项。前三档与编辑器内查找共用 `FindModel` 语义；
 * `inChanges` 是上游 `ENABLE_SEARCH_IN_CHANGES`（`DiffUserDataKeys.java:71`，
 * 开关动作 `Vcs.Diff.ToggleSearchInChanges`，文案
 * `platform/platform-resources-en/src/messages/ActionsBundle.properties:1422`
 * `action.Vcs.Diff.ToggleSearchInChanges.text=Search In Changes`）。
 */
export interface DiffSearchOptions {
  /** `FindModel.isCaseSensitive`。 */
  caseSensitive: boolean
  /** `FindModel.isWholeWordsOnly`。 */
  wholeWords: boolean
  /** `FindModel.isRegularExpressions`。 */
  regex: boolean
  /** 只在改动的那一侧里找（上游 `SearchInDiffChangesProvider` 的搜索区）。 */
  inChanges: boolean
}

/** 首次使用全关（与编辑器查找同一口径，见 `FindSettingsBase.java:53-64`）。 */
export const DEFAULT_DIFF_SEARCH_OPTIONS: Readonly<DiffSearchOptions> = Object.freeze({
  caseSensitive: false, wholeWords: false, regex: false, inChanges: false,
})

/** 一个可搜的单元格：行下标 + 哪一侧 + 文本 + 这一侧是否改动。 */
export interface DiffSearchCell {
  row: number
  side: 'left' | 'right'
  text: string
  changed: boolean
}

/** 折到编辑器查找的选项形状（差异视图没有「仅在选区内」这一档，恒 false）。 */
function toSearchOptions(options: DiffSearchOptions): SearchOptions {
  return { caseSensitive: options.caseSensitive, wholeWords: options.wholeWords, regex: options.regex, inSelection: false }
}

/** 某一侧在这一行是不是改动（与行号/高亮的判定同源：`insert` 只在右、`delete` 只在左）。 */
export function changedSide(kind: DiffRow['kind'], side: 'left' | 'right'): boolean {
  if (kind === 'change') return true
  if (kind === 'insert') return side === 'right'
  if (kind === 'delete') return side === 'left'
  return false
}

/** 把行表摊成可搜单元格（行序，左后右；空文本的格子不生成 —— 它没有可找的内容）。 */
export function diffSearchCells(rows: readonly DiffRow[]): DiffSearchCell[] {
  const cells: DiffSearchCell[] = []
  rows.forEach((row, index) => {
    // `DiffRow` 的两侧都可以为空（对齐时的占位），只有有文本的一侧才参与。
    for (const side of ['left', 'right'] as const) {
      const cell = row[side]
      if (!cell || !cell.text) continue
      cells.push({ row: index, side, text: cell.text, changed: changedSide(row.kind, side) })
    }
  })
  return cells
}

/** 一处命中（`from`/`to` 是**该单元格文本内**的字符偏移）。 */
export interface DiffSearchMatch {
  row: number
  side: 'left' | 'right'
  from: number
  to: number
}

/**
 * 收集全部命中。查询词为空或坏正则时返回空数组（坏正则由调用方单独判，
 * 与编辑器栏一样画成「错误模式」而不是在这里抛）。
 */
export function collectDiffMatches(
  rows: readonly DiffRow[],
  query: string,
  options: DiffSearchOptions,
  limit: number = DIFF_SEARCH_MATCHES_LIMIT,
): DiffSearchMatch[] {
  if (!query) return []
  const searchOptions = toSearchOptions(options)
  if (buildSearchRegex(query, searchOptions) === null) return []
  const out: DiffSearchMatch[] = []
  for (const cell of diffSearchCells(rows)) {
    if (out.length >= limit) break
    if (options.inChanges && !cell.changed) continue
    for (const found of collectSearchMatches(cell.text, query, searchOptions, limit - out.length)) {
      out.push({ row: cell.row, side: cell.side, from: found.from, to: found.to })
      if (out.length >= limit) return out
    }
  }
  return out
}

/**
 * 下一个/上一个命中的下标，**两端回绕**（编辑器查找的语义；`current < 0` = 还没定位，
 * 向前取第一条、向后取最后一条）。
 */
export function nextDiffMatchIndex(total: number, current: number, forward: boolean): number {
  if (total <= 0) return -1
  if (current < 0 || current >= total) return forward ? 0 : total - 1
  return forward ? (current + 1) % total : (current - 1 + total) % total
}

/** 一个渲染片段：文本 + 它同时属于哪几套标记（词级高亮 / 查找命中 / 当前命中）。 */
export interface DiffTextPiece {
  text: string
  word: boolean
  search: boolean
  current: boolean
}

/**
 * 把「词级高亮的 `[起点, 长度]` 标记」与「查找命中区间」合成**互不重叠**的片段。
 *
 * 词级标记沿用渲染层的既有容错：越界、零长、与前一标记重叠的一律丢掉（见 `DiffView.parts`
 * 的历史实现）。查找命中来自 `collectDiffMatches`，同一单元格里的命中本来就互不重叠。
 */
export function highlightPieces(
  text: string,
  wordMarks: readonly [number, number][] | undefined,
  matches: readonly { from: number; to: number; current?: boolean }[] | undefined,
): DiffTextPiece[] {
  const words: [number, number][] = []
  let cursor = 0
  for (const [start, length] of wordMarks ?? []) {
    if (start < cursor || length <= 0 || start + length > text.length) continue
    words.push([start, length])
    cursor = start + length
  }
  const hits = (matches ?? []).filter(m => m.from >= 0 && m.to > m.from && m.to <= text.length)
  const cuts = new Set<number>([0, text.length])
  for (const [start, length] of words) { cuts.add(start); cuts.add(start + length) }
  for (const hit of hits) { cuts.add(hit.from); cuts.add(hit.to) }
  const points = [...cuts].sort((a, b) => a - b)
  const pieces: DiffTextPiece[] = []
  for (let i = 0; i + 1 < points.length; i++) {
    const from = points[i]!
    const to = points[i + 1]!
    if (to <= from) continue
    const word = words.some(([start, length]) => from >= start && to <= start + length)
    const inside = hits.filter(hit => from >= hit.from && to <= hit.to)
    pieces.push({ text: text.slice(from, to), word, search: inside.length > 0, current: inside.some(hit => hit.current === true) })
  }
  return pieces
}

/**
 * 跳到一个命中时要展开的折叠区（`foldKey`），`null` = 目标行没被任何折叠藏着。
 * 上游折叠状态归编辑器，查找跳进折叠区时编辑器自己会展开；本仓的折叠是查看器状态，得自己管。
 */
export function foldToExpand(
  folds: readonly { hiddenFrom: number; hiddenTo: number; runStart: number }[],
  row: number,
): number | null {
  for (const fold of folds) {
    if (row >= fold.hiddenFrom && row < fold.hiddenTo) return fold.runStart
  }
  return null
}
