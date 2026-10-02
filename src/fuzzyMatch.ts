// 模糊匹配：Smith-Waterman 局部序列比对（IDEA 的 `SmithWatermanAlgorithm`）—— 纯函数，零 DOM。
//
// 上游：`platform/lang-impl/src/com/intellij/ide/actions/searcheverywhere/fuzzyMatching/SmithWatermanAlgorithm.kt`
// （打分与回溯）+ `ScoringParameters.kt`（默认分值）+ `AlignmentMatrix.kt`（DP 单元），
// 消费者是「随处搜索」的新分屏实现里那个模糊文件供给者
// `platform/searchEverywhere/backend/src/providers/filesFuzzy/SmithWatermanMatcher.kt`。
//
// 与原版 Smith-Waterman 的差别（照抄上游注释）：大小写不敏感；按位置加花红（首字符、连续、驼峰、分隔符）；
// 回溯给出命中下标（用于高亮）；归一化到 0..1 便于设阈值。
//
// 三条上游口径逐字对上：
//   · 单元格 `computeCell(i,j) = max(0, 对角线 + matchScore, 上 + gapPenalty, 左 + gapPenalty)`，
//     方向在**并列时**按 DIAGONAL > UP > LEFT > ZERO 取（`AlignmentMatrix.kt:50-63`）；
//   · 花红四条（`:122-180`）：首字符 8、连续 6、驼峰 7、分隔符（`/ _ - . 空格`）之后 8；
//   · 归一化 `(maxScore * 100 - target.length) / maxPossibleScore` 截到 0..1，
//     `maxPossibleScore = (match + firstCharBonus + (len-1) * (match + consecutiveBonus)) * 100`（`:167-186`）。
export interface ScoringParameters {
  /** 命中一个字符的分：FZF 默认 16。 */
  matchScore: number
  /** 不匹配时的分：FZF 是"跳过"而不是扣分，默认 0。 */
  mismatchPenalty: number
  /** 空隙惩罚，默认 -1。 */
  gapPenalty: number
  /** 命中目标串首字符的额外分，默认 8。 */
  firstCharBonus: number
  /** 连续命中的额外分，默认 6。 */
  consecutiveBonus: number
  /** 驼峰边界（小写→大写）命中的额外分，默认 7。 */
  camelCaseBonus: number
  /** 分隔符（`/ _ - . 空格`）之后命中的额外分，默认 8。 */
  separatorBonus: number
}

export const DEFAULT_SCORING_PARAMETERS: ScoringParameters = {
  matchScore: 16, mismatchPenalty: 0, gapPenalty: -1,
  firstCharBonus: 8, consecutiveBonus: 6, camelCaseBonus: 7, separatorBonus: 8,
}

export interface FuzzyMatchResult {
  /** 原始分（未归一化；0 表示没命中）。 */
  score: number
  /** 命中在目标串里的下标（升序，用于高亮）。 */
  indices: number[]
  /** 归一分（0..1），用于设阈值与跨来源比较。 */
  normalized: number
}

export const NO_MATCH: FuzzyMatchResult = { score: 0, indices: [], normalized: 0 }

const SEPARATORS = '/_-. '

/** 上游 `SmithWatermanAlgorithm.match`（`:43-98`）。 */
export function fuzzyMatch(pattern: string, target: string, params: ScoringParameters = DEFAULT_SCORING_PARAMETERS): FuzzyMatchResult {
  if (!pattern || !target) return NO_MATCH
  const patternLower = pattern.toLowerCase()
  const targetLower = target.toLowerCase()
  if (pattern.length > target.length) return NO_MATCH

  const rows = pattern.length + 1
  const columns = target.length + 1
  const score = new Int32Array(rows * columns)
  const direction = new Uint8Array(rows * columns)   // 0 空 / 1 对角线 / 2 上 / 3 左
  const at = (i: number, j: number) => i * columns + j

  let maxScore = 0
  let maxRow = 0
  let maxColumn = 0
  for (let i = 1; i <= pattern.length; ++i) {
    for (let j = 1; j <= target.length; ++j) {
      const isMatch = patternLower[i - 1] === targetLower[j - 1]
      const base = isMatch ? params.matchScore : params.mismatchPenalty
      const bonus = isMatch ? bonuses(target, patternLower, targetLower, j - 1, i === 1, score, columns, i, j, params) : 0
      const diagonal = score[at(i - 1, j - 1)]! + base + bonus
      const up = score[at(i - 1, j)]! + params.gapPenalty
      const left = score[at(i, j - 1)]! + params.gapPenalty
      const best = Math.max(0, diagonal, up, left)
      score[at(i, j)] = best
      // 并列时的优先级：对角线 > 上 > 左 > 空（`AlignmentMatrix.kt:59-63`）。
      direction[at(i, j)] = best === 0 ? 0 : best === diagonal ? 1 : best === up ? 2 : 3
      if (best > maxScore) { maxScore = best; maxRow = i; maxColumn = j }
    }
  }
  if (maxScore === 0) return NO_MATCH

  const indices: number[] = []
  for (let i = maxRow, j = maxColumn; i > 0 && j > 0;) {
    const step = direction[at(i, j)]
    if (step === 0) break
    if (step === 1) {
      // 只有**真的命中**才记下标：对角线也走"不匹配但基础分为 0"的情形（那是跳过）。
      if (patternLower[i - 1] === targetLower[j - 1]) indices.push(j - 1)
      i -= 1
      j -= 1
      continue
    }
    if (step === 2) { i -= 1; continue }
    j -= 1
  }
  indices.reverse()

  const maxPossible = (params.matchScore + params.firstCharBonus
    + (pattern.length - 1) * (params.matchScore + params.consecutiveBonus)) * 100
  const adjusted = maxScore * 100 - target.length
  const normalized = maxPossible > 0 ? Math.min(1, Math.max(0, adjusted / maxPossible)) : 0
  return { score: maxScore, indices, normalized }
}

/** 位置花红（上游 `:122-180`）。`previousDiagonal>0` 表示上一格也走在命中路径上（连续匹配）。 */
function bonuses(target: string, patternLower: string, targetLower: string, position: number, firstPatternChar: boolean,
                 score: Int32Array, columns: number, i: number, j: number, params: ScoringParameters): number {
  let bonus = 0
  if (firstPatternChar && position === 0) bonus += params.firstCharBonus
  if (i > 1 && j > 1 && patternLower[i - 2] === targetLower[j - 2] && score[(i - 1) * columns + (j - 1)]! > 0)
    bonus += params.consecutiveBonus
  if (position > 0) {
    const previous = target[position - 1]!
    const current = target[position]!
    if (previous === previous.toLowerCase() && previous !== previous.toUpperCase() && current === current.toUpperCase() && current !== current.toLowerCase())
      bonus += params.camelCaseBonus
    if (SEPARATORS.includes(previous)) bonus += params.separatorBonus
  }
  return bonus
}

/**
 * 文件名的模糊匹配（上游 `SmithWatermanMatcher.kt:33-57`）：模式里带扩展名时先按扩展名过滤，
 * 再拿**去掉扩展名**的名字比对；不带扩展名就拿整个名字比对。
 * 返回 `null` = 没命中（与 `FuzzyMatchResult.NO_MATCH` 同义，调用方直接丢掉这条）。
 */
export function fuzzyMatchFileName(pattern: string, fileName: string, params: ScoringParameters = DEFAULT_SCORING_PARAMETERS): FuzzyMatchResult | null {
  const extension = pattern.includes('.') ? pattern.slice(pattern.lastIndexOf('.') + 1) : ''
  const fileExtension = fileName.includes('.') ? fileName.slice(fileName.lastIndexOf('.') + 1) : ''
  if (extension && fileExtension !== extension) return null
  const normalizedPattern = extension ? pattern.slice(0, pattern.lastIndexOf('.')) : pattern
  const normalizedFileName = extension ? fileName.slice(0, fileName.lastIndexOf('.')) : fileName
  const result = fuzzyMatch(normalizedPattern, normalizedFileName, params)
  return result.score === 0 ? null : result
}

/**
 * 文件名优先、不行再看整条路径（上游 `SmithWatermanMatcher.matchWithPath:58-70`）：
 * 文件名那一档的归一分 > 0.7 就直接用它，否则改比整条路径（用户可能在搜 `src/main` 这样的路径片段）。
 * 注意这一档比的是**原始 pattern**（带扩展名），跟 `match()` 用的去扩展名 pattern 不是一回事；
 * 上游也不在这里回退到文件名那一档 —— 路径那档没命中就是没命中。
 * 返回 `null` 对应上游的 `FuzzyMatchResult.NO_MATCH`（`score == 0`），调用方直接丢掉这条。
 */
export function fuzzyMatchPath(pattern: string, path: string, params: ScoringParameters = DEFAULT_SCORING_PARAMETERS): FuzzyMatchResult | null {
  const name = path.split(/[\\/]/).pop() ?? path
  const byName = fuzzyMatchFileName(pattern, name, params)
  if (byName && byName.normalized > 0.7) return byName
  const byPath = fuzzyMatch(pattern, path, params)
  return byPath.score === 0 ? null : byPath
}

/**
 * 模糊命中的权重上限（上游 `SeFuzzyFileSearchItem.MAX_FUZZY_WEIGHT = 9999`）。
 * 上游注释说明了取值口径：词首命中的权重在 10000 以上（`PreferStartMatchMatcherWrapper.START_MATCH_WEIGHT`），
 * 模糊这一档压在它下面，所以**词首命中的结果永远排在模糊命中之前**。
 */
export const MAX_FUZZY_WEIGHT = 9999

/**
 * 过滤阈值（上游 `SeFuzzyFileSearchProvider.NamesProcessor` 读注册表键
 * `search.everywhere.fuzzy.files.min.score`，默认 6500）。判据是 `normalizedScore * MAX_FUZZY_WEIGHT < minScore` 就丢掉。
 * 6500/9999 ≈ 0.65，也就是归一分不到 0.65 的弱命中不进结果 —— 这正是本地上面对齐会捞出的那类
 * "只有一两个字对得上" 的部分命中（它们分数为正，但被这条阈值滤掉）。
 */
export const FUZZY_FILES_MIN_SCORE = 6500

/** 归一分 → 排序权重（上游 `SeFuzzyFileSearchItem.weight()`：`(normalizedScore * MAX_FUZZY_WEIGHT).toInt()`）。 */
export function fuzzyWeight(normalized: number): number {
  return Math.trunc(normalized * MAX_FUZZY_WEIGHT)
}

/** 是否过阈值（上游 `NamesProcessor.process` 的 `return true` 提前退出那一支）。 */
export function passesFuzzyThreshold(normalized: number): boolean {
  return fuzzyWeight(normalized) >= FUZZY_FILES_MIN_SCORE
}
