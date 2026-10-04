// 行内词级/字符级差异（上游 `ByWordRt` / `ByCharRt` / `LineFragmentSplitter` 的等价物）。
//
// 为什么要有这一层：行级 diff 只能说"这两行不一样"，改一个词和整行重写看起来一样。
// 上游 `ByWordRt.compare`（`platform/util/diff/src/com/intellij/diff/comparison/ByWordRt.kt:33-58`）
// 把两行切成词块、对词块做 diff，再把**不同的词块段**折成 `[起点, 长度]` 区间交给渲染层
// （`DiffFragment`，见 `platform/diff-api/.../fragments/DiffFragment.java`）。
//
// 本仓的 native 侧（`native/history.cpp` 的 `tokenize` + `word_marks`，`git_test.cpp` /
// `history_test.cpp` 各有一条判据）**早就有了**这套；缺的是前端那一份 ——
// `src/diffText.ts` 的 `buildDiffRows`（剪贴板对比 `src/vcsActions.ts:122`、保存冲突预览
// `src/editorFileOps.ts:54` 都走它）从来不填 `leftMarks`/`rightMarks`，
// 所以 `DiffView.vue` 里那段渲染词级高亮的代码一直拿不到数据。
//
// 三档高亮对应上游 `HighlightPolicy`（`platform/diff-impl/.../base/HighlightPolicy.java`）：
//   BY_WORD（**默认**，`TextDiffSettingsHolder.kt` 的 `HIGHLIGHT_POLICY = HighlightPolicy.BY_WORD`）、
//   BY_LINE（只按行，不标词）、BY_CHAR（逐字符，用于词边界不明显的行）。

import { optimizeSpans, wordShift, type MatchSpan } from './diffChunks.ts'

/** 上游 `HighlightPolicy` 的三档（`HighlightPolicy.java`）。 */
export type HighlightPolicy = 'byWord' | 'byLine' | 'byChar'

/** `TextDiffSettingsHolder.kt` 的 `HIGHLIGHT_POLICY` 默认值 = `BY_WORD`。 */
export const DEFAULT_HIGHLIGHT_POLICY: HighlightPolicy = 'byWord'

/** 词级 diff 的 token 上限（对齐 native 的 `diff_cell_budget`：`native/history.cpp:39`）。 */
const TOKEN_CELL_BUDGET = 8_000_000

export interface Token { start: number; text: string }

/**
 * 词法切分 —— 与 `native/history.cpp:809-830` 的 `tokenize` **同一条规则**：
 * 字母数字下划线连成一段、空白连成一段、其余字符各自成一段，并记下起点。
 *
 * 两边必须一致，否则同一个文件在 native 渲染的 diff（Git 变更视图）与前端渲染的
 * diff（剪贴板对比）里会高亮出不同的词 —— 那是同一功能的第二张脸。
 */
export function tokenizeLine(line: string): Token[] {
  const tokens: Token[] = []
  let index = 0
  while (index < line.length) {
    const ch = line[index]!
    const word = /[A-Za-z0-9_]/.test(ch)
    const space = ch === ' ' || ch === '\t'
    let end = index + 1
    if (word || space) {
      while (end < line.length) {
        const next = line[end]!
        const nextWord = /[A-Za-z0-9_]/.test(next)
        const nextSpace = next === ' ' || next === '\t'
        if (word ? !nextWord : !nextSpace) break
        ++end
      }
    }
    tokens.push({ start: index, text: line.slice(index, end) })
    index = end
  }
  return tokens
}

/** `[起点, 长度]` 区间 —— 与 `DiffRow.leftMarks` / `rightMarks` 的形状一致。 */
export type Mark = [number, number]

const isBlankToken = (token: Token) => token.text.length > 0 && (token.text[0] === ' ' || token.text[0] === '\t')

/**
 * 两个 token 序列的最长公共子序列**方向表**，再按方向回放出"不同的连续段"。
 * 与 native 的实现同构（`native/history.cpp:838-891`）：token 不等才算差异，
 * 相邻差异段合并成一段 run，最后换算成字节区间。
 */
function diffRuns(a: Token[], b: Token[]): { a: [number, number][]; b: [number, number][]; matches: MatchSpan[] } {
  const n = a.length
  const m = b.length
  if (!n && !m) return { a: [], b: [], matches: [] }
  // 单元格预算：超了就退化成"整行都标"（上游同样有 maxSize 保护，
  // `ComparisonManagerImpl` 里是 `DiffTooBigException`）。这里退化而不是抛，
  // 因为这一层是渲染用的，宁可粗也不能让界面炸。
  const feasible = n === 0 || m === 0 || n + 1 <= TOKEN_CELL_BUDGET / (m + 1)
  const aRuns: [number, number][] = []
  const bRuns: [number, number][] = []
  if (!feasible) {
    if (n) aRuns.push([0, n])
    if (m) bRuns.push([0, m])
    return { a: aRuns, b: bRuns, matches: [] }
  }
  const direction = new Uint8Array((n + 1) * (m + 1))
  let next = new Uint32Array(m + 1)
  let current = new Uint32Array(m + 1)
  for (let i = n; i-- > 0;) {
    for (let j = m; j-- > 0;) {
      let move = 0
      let length = 0
      if (a[i]!.text === b[j]!.text) { move = 1; length = next[j + 1]! + 1 }
      else if (next[j]! >= current[j + 1]!) { move = 2; length = next[j]! }
      else { move = 3; length = current[j + 1]! }
      direction[i * (m + 1) + j] = move
      current[j] = length
    }
    const swap = next; next = current; current = swap
  }
  let i = 0
  let j = 0
  let aBegin = -1, aEnd = 0, bBegin = -1, bEnd = 0
  // 未更改段（成对）—— `src/diffChunks.ts` 的优化器要的就是这份；改动段由它的补集反推。
  const matches: MatchSpan[] = []
  let matchFrom = -1
  const flush = (runs: [number, number][], begin: number, end: number) => { if (begin >= 0) runs.push([begin, end]) }
  const flushMatch = (to1: number, to2: number) => {
    if (matchFrom >= 0) matches.push({ a: { start: matchFrom, end: to1 }, b: { start: matchFromB, end: to2 } })
    matchFrom = -1
  }
  let matchFromB = -1
  while (i < n && j < m) {
    const move = direction[i * (m + 1) + j]
    if (move === 1) {
      if (matchFrom < 0) { matchFrom = i; matchFromB = j }
      flush(aRuns, aBegin, aEnd); aBegin = -1
      flush(bRuns, bBegin, bEnd); bBegin = -1
      ++i; ++j
    } else if (move === 2) {
      flushMatch(i, j)
      if (aBegin < 0) aBegin = i
      aEnd = i + 1
      ++i
    } else {
      flushMatch(i, j)
      if (bBegin < 0) bBegin = j
      bEnd = j + 1
      ++j
    }
  }
  if (i < n) { if (aBegin < 0) aBegin = i; aEnd = n }
  if (j < m) { if (bBegin < 0) bBegin = j; bEnd = m }
  flushMatch(i, j)
  flush(aRuns, aBegin, aEnd)
  flush(bRuns, bBegin, bEnd)
  return { a: aRuns, b: bRuns, matches }
}

function runsToMarks(runs: [number, number][], tokens: Token[]): Mark[] {
  const marks: Mark[] = []
  for (const [first, last] of runs) {
    if (first >= tokens.length || last > tokens.length || last <= first) continue
    // 只含空白的首/尾 token 从标记里去掉："hello" → "hello world" 只圈住新增的词；
    // 整段都是空白（纯缩进改动）时保持原样，否则用户看不到改动。
    let begin = first
    let stop = last
    while (begin + 1 < stop && isBlankToken(tokens[begin]!)) ++begin
    while (stop - 1 > begin && isBlankToken(tokens[stop - 1]!)) --stop
    const start = tokens[begin]!.start
    const end = tokens[stop - 1]!.start + tokens[stop - 1]!.text.length
    marks.push([start, end - start])
  }
  return marks
}

/**
 * 未更改段 → 两侧的**改动段**（补集）。上游 `DiffIterableUtil.createUnchanged` 的反面。
 */
export function spansToRuns(spans: readonly MatchSpan[], totalA: number, totalB: number): { a: [number, number][]; b: [number, number][] } {
  const aRuns: [number, number][] = []
  const bRuns: [number, number][] = []
  let a = 0
  let b = 0
  for (const span of spans) {
    if (span.a.start > a) aRuns.push([a, span.a.start])
    if (span.b.start > b) bRuns.push([b, span.b.start])
    a = span.a.end
    b = span.b.end
  }
  if (a < totalA) aRuns.push([a, totalA])
  if (b < totalB) bRuns.push([b, totalB])
  return { a: aRuns, b: bRuns }
}

/**
 * 词级差异：左右各返回一组 `[起点, 长度]`（上游 `ByWordRt.compare` 的产物）。
 *
 * **多一步块优化**（`src/diffChunks.ts`，上游 `ChunkOptimizer.WordChunkOptimizer`）：
 * 逐 token 的 LCS 只管"改动最少"，会把改动切在词的中间、或切出很多碎块；
 * 优化器先把能合并的块合并，再按"词边界"把切点挪到空白处。
 */
export function wordMarks(left: string, right: string): { left: Mark[]; right: Mark[] } {
  const a = tokenizeLine(left)
  const b = tokenizeLine(right)
  const runs = diffRuns(a, b)
  const optimized = optimizeSpans(runs.matches, a.length, b.length, (i, j) => a[i]!.text === b[j]!.text, wordShift(a, b, left, right))
  const finalRuns = optimized === runs.matches ? runs : spansToRuns(optimized, a.length, b.length)
  return { left: runsToMarks(finalRuns.a, a), right: runsToMarks(finalRuns.b, b) }
}

/**
 * 字符级差异（上游 `ByCharRt`）：每个字符一个 token，规则同上。
 * 用在词边界不明显的行（长串符号、压缩过的 JS）上 —— 词级会整段标红，字符级能指出改了哪几个字。
 */
export function charMarks(left: string, right: string): { left: Mark[]; right: Mark[] } {
  const a: Token[] = [...left].map((text, start) => ({ start, text }))
  const b: Token[] = [...right].map((text, start) => ({ start, text }))
  const runs = diffRuns(a, b)
  // 字符级不丢空白的首尾：逐字符看，空白也是被改掉的东西。
  const direct = (runsList: [number, number][], tokens: Token[]): Mark[] =>
    runsList.flatMap(([first, last]) => {
      if (first >= tokens.length || last > tokens.length || last <= first) return []
      const start = tokens[first]!.start
      const end = tokens[last - 1]!.start + tokens[last - 1]!.text.length
      return [[start, end - start] as Mark]
    })
  return { left: direct(runs.a, a), right: direct(runs.b, b) }
}

/** 按高亮档取标记。`byLine` 不产生标记（上游 `BY_LINE` 就是"只按行"）。 */
export function marksFor(policy: HighlightPolicy, left: string, right: string): { left: Mark[]; right: Mark[] } {
  if (policy === 'byLine') return { left: [], right: [] }
  if (policy === 'byChar') return charMarks(left, right)
  return wordMarks(left, right)
}
