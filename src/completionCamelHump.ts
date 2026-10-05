// **驼峰前缀匹配器**（上游 `com.intellij.codeInsight.completion.impl.CamelHumpMatcher` +
// 它背后的 `MinusculeMatcherImpl`）。这是补全弹层「哪条候选留在表里、命中了哪些字符、
// 谁排在前面」的唯一判据 —— 上游的三件事全压在它一个类上：
//   · **过滤**：`CamelHumpMatcher.prefixMatches`（`platform/analysis-impl/src/com/intellij/
//     codeInsight/completion/impl/CamelHumpMatcher.java:80-119`）；
//   · **命中的字符段**：`matchingFragments` → `MinusculeMatcher.match`
//     （`platform/util/text-matching/src/com/intellij/psi/codeStyle/MinusculeMatcher.kt:31-37`、
//     `MinusculeMatcherImpl.kt:112-125`）—— 弹层里把命中片段加粗上色就靠它
//     （`completionUi.ts` 的 `cm-completionMatchedText`）；
//   · **排序档位**：`RealPrefixMatchingWeigher`（同目录 `RealPrefixMatchingWeigher.java:12-27`）
//     把 `prefix` 那一档换成 `-matchingDegree`（**分数越高越靠前**，完全不匹配 → `Integer.MAX_VALUE`），
//     注册点在 `platform/analysis-impl/src/com/intellij/codeInsight/completion/BaseCompletionService.java:215-216`。
//
// 规则来源（逐条对照，本文件不移植的部分在每条后面注明）：
//   · `MinusculeMatcherImpl.kt:46-89` —— pattern 预处理（大小写数组、词分隔符、`myMixedCase`/
//     `myHasSeparators`/`myHasDots`、`myMeaningfulCharacters`）；
//   · `:112-125` —— `match()`：名字太短直接不算、pattern 超 `MAX_CAMEL_HUMP_MATCHING_LENGTH=100`
//     退化成 `matchBySubstring`（`:133-175`，本文件照搬）、字母顺序预筛 `nameContainsAllMeaningfulCharsInOrder`
//     （`MinusculeMatcher.kt:193-228`）；
//   · `:181-226` —— `matchWildcards`：`*` 与空格都是通配（`:458`），尾部通配要落在词尾才算数
//     （`isTrailingSpacePattern`，`:206-214`）；
//   · `:239-299` —— `matchSkippingWords` + `checkForSpecialChars`（打了点就不会跳过别的点，`:295-297`）；
//   · `:301-310` —— `seemsLikeFragmentStart`：大写 pattern 字符要么对大写、要么落在词首，
//     `myMixedCase` 时不再宽容小写起点（除 `MATCH_CASE`）；
//   · `:325-347` —— `maxMatchingFragment` + 「数字夹在两个数字之间不许跳过」（`isSkippingDigitBetweenPatternDigits`）；
//   · `:350-401` —— `matchInsideFragment`/`findLongestMatchingPrefix`：**中间命中（不是词首）的片段至少 3 个字符**
//     （`:356-357`，「避免捞出太多不相干」是原注释的意思）；
//   · `:403-436` —— `improveCamelHumps`：`CU` 对 `CurrentUser` 时优先把 `U` 对到真正的驼峰上；
//   · `:438-448` —— `isFirstCharMatching`：`FIRST_LETTER` 档要求首字母大小写一致；
//   · `:464-494` —— `indexOfWordStart`（混合大小写的 pattern 里，小写字符**不能**去命中词首）与 `indexOfIgnoreCase`；
//   · `:505-507` —— 词分隔符集合：空白 `_ - : + .`；
//   · `MinusculeMatcher.kt:84-161` —— 分数：词首 +1000、跳过的驼峰每个 -10、命中的片段数 -N、
//     起点在名字开头 +1、整名吃完 +1、硬分隔符之后 +0/否则 +2；
//   · `MinusculeMatcher.kt:163-191` —— 大小写奖惩：大写对大写 +50、「用户是按 Shift 打的」；
//     首字母且 `valueStartMatch` +150（Java 里 `String` 与 `string` 就靠这个区分）；
//     驼峰起点 case 不符 -1；跨间隙的小写驼峰起点 -10。
//
// **不移植的部分**（都在报告里如实登记）：
//   · `FixingLayoutMatcher`/`FixingLayoutTypoTolerantMatcher`（键盘布局纠错、`typoTolerant()`，
//     `NameUtil.java:328-331,343-352`）—— 本仓没有键盘布局表，`CamelHumpMatcher(prefix, false, true)`
//     的 typo 档在命令补全那里只影响"打错一个键也能命中"，不做；
//   · `PinyinMatcher`（`NameUtil.java:351`）与 `myMixedCase` 的假名/表意文字分支
//     （`NameUtilCore.kt:112-116`）—— 本仓按拉丁字母处理；
//   · `element.isCaseSensitive()` 那条双匹配器分叉（`CamelHumpMatcher.java:103-119`）——
//     本仓条目一律等价于上游的「大小写不敏感条目」（LSP 条目没有这个属性），
//     于是 `prefixMatchesElement` = `startsWithIgnoreCase || firstLetter.matches || ignoreCase.matches`。

/** `MatchingMode.kt:12/31/40` 的三档（`IGNORE_CASE` / `FIRST_LETTER` / `MATCH_CASE`）。 */
export type MatchingMode = 'ignore-case' | 'first-letter' | 'match-case'

/** `MinusculeMatcherImpl.kt:505-507`：词分隔符。 */
const WORD_SEPARATOR = /[\s_\-:+.]/
/** `MinusculeMatcherImpl.kt:458`：通配符 = 空格与 `*`。 */
const WILDCARD = ' *'
/** `MinusculeMatcherImpl.kt:503`：`MAX_CAMEL_HUMP_MATCHING_LENGTH = 100`。 */
export const MAX_CAMEL_HUMP_MATCHING_LENGTH = 100

export interface MatchedFragment { start: number; end: number }

function isUpper(char: string): boolean { return /\p{Lu}/u.test(char) }
function isLower(char: string): boolean { return /\p{Ll}/u.test(char) }
function isDigit(char: string): boolean { return /\p{N}/u.test(char) }
function isLetter(char: string): boolean { return /\p{L}/u.test(char) }
function isLetterOrDigit(char: string): boolean { return /[\p{L}\p{N}]/u.test(char) }
function isWordSeparatorChar(char: string): boolean { return WORD_SEPARATOR.test(char) }
function isWildcardChar(char: string): boolean { return char === ' ' || char === '*' }
/** `MinusculeMatcherImpl.kt:450-452`：只有字母有"大小写可谈"。 */
function hasCase(char: string): boolean { return isUpper(char) || isLower(char) }

/**
 * `NameUtilCore.kt:95-117` 的 `isWordStart`（拉丁字母分支：表意文字/假名两档不移植，见文件头）。
 * 大写是词首（但全大写词中间不算）；数字是词首；非标点非字母的一律不算；
 * 小写只在「串首」或「前一个不是字母也不是数字」时算词首。
 */
export function isWordStart(name: string, index: number): boolean {
  if (index < 0 || index >= name.length) return false
  const current = name[index]!
  const previous = index > 0 ? name[index - 1] : undefined
  if (isUpper(current)) {
    if (previous !== undefined && isUpper(previous)) {
      const next = index + 1
      return next < name.length && isLower(name[next]!)
    }
    return true
  }
  if (isDigit(current)) return true
  if (!isLetter(current)) return false
  return index === 0 || !isLetterOrDigit(previous!)
}

/** `NameUtilCore.kt:53-92` 的 `nextWord`（逐字符，见文件头「不移植的部分」）。 */
export function nextWord(name: string, start: number): number {
  if (start >= name.length) return name.length
  const first = name[start]!
  if (!isLetterOrDigit(first)) return start + 1
  let i = start
  while (i < name.length && isDigit(name[i]!)) ++i          // 数字自成一个驼峰（:63-68）
  if (i > start) return i
  while (i < name.length && isUpper(name[i]!)) ++i
  if (i > start + 1) {
    // 连续大写自成一驼峰，末尾那个大写留给下一个词（:77-83）
    if (i >= name.length || !isLetter(name[i]!)) return i
    return i - 1
  }
  if (i === start) ++i
  while (i < name.length && isLetter(name[i]!) && !isWordStart(name, i)) ++i
  return i
}

/** `CamelHumpMatcher.java:149-154` + `platform/util/resources/misc/registry.properties:960`
 * （`ide.completion.middle.matching=true` 是默认档）：允许「打在中间」的匹配。 */
export function applyMiddleMatching(prefix: string, middleMatching = true): string {
  if (!middleMatching || prefix.length === 0) return prefix
  return ('*' + prefix.replaceAll('.', '. ')).trim()
}

interface PatternInfo {
  pattern: string
  lower: string[]
  upper: string[]
  isLower: boolean[]
  isUpper: boolean[]
  isSeparator: boolean[]
  /** `MinusculeMatcherImpl.kt:85`：大小写都出现过（且大写不在通配符之后紧跟）才叫 mixedCase。 */
  mixedCase: boolean
  /** `:84`：通配符之后出现过词分隔符。 */
  hasSeparators: boolean
  /** `:83`：pattern 里有点。 */
  hasDots: boolean
  /** `:37,68-72`：小写/大写两两成对的有效字符表。 */
  meaningful: string[]
}

function analyse(pattern: string): PatternInfo {
  const info: PatternInfo = {
    pattern, lower: [], upper: [], isLower: [], isUpper: [], isSeparator: [],
    mixedCase: false, hasSeparators: false, hasDots: false, meaningful: [],
  }
  let seenNonWildcard = false
  let seenLowerCase = false
  let seenUpperCaseAfterWildcard = false
  for (let index = 0; index < pattern.length; index++) {
    const char = pattern[index]!
    const separator = isWordSeparatorChar(char)
    const upper = isUpper(char)
    const lower = isLower(char)
    info.isSeparator[index] = separator
    info.isUpper[index] = upper
    info.isLower[index] = lower
    info.upper[index] = char.toUpperCase()
    info.lower[index] = char.toLowerCase()
    if (lower) seenLowerCase = true
    if (char === '.') info.hasDots = true
    if (seenNonWildcard && upper) seenUpperCaseAfterWildcard = true
    if (!isWildcardChar(char)) {
      seenNonWildcard = true
      info.meaningful.push(char.toLowerCase(), char.toUpperCase())
    }
    if (seenNonWildcard && separator) info.hasSeparators = true
  }
  info.mixedCase = seenLowerCase && seenUpperCaseAfterWildcard
  return info
}

/** `MinusculeMatcher.kt:193-228`：名字里必须按顺序含住所有有效字符（预筛，快路径）。 */
function containsMeaningfulInOrder(name: string, meaningful: readonly string[]): boolean {
  let at = 0
  let nameIndex = 0
  while (at + 1 < meaningful.length) {
    if (nameIndex >= name.length) return false
    const first = meaningful[at]!
    const indexOfFirst = name.indexOf(first, nameIndex)
    if (indexOfFirst === nameIndex) {
      nameIndex = indexOfFirst + 1
    } else {
      const second = meaningful[at + 1]!
      if (first === second) {
        if (indexOfFirst < 0) return false
        nameIndex = indexOfFirst + 1
      } else {
        const indexOfSecond = name.indexOf(second, nameIndex)
        if (indexOfFirst >= 0 && indexOfSecond >= 0) nameIndex = Math.min(indexOfFirst, indexOfSecond) + 1
        else if (indexOfFirst >= 0) nameIndex = indexOfFirst + 1
        else if (indexOfSecond >= 0) nameIndex = indexOfSecond + 1
        else return false
      }
    }
    at += 2
  }
  return true
}

/** `MinusculeMatcherImpl.kt:480-494`：忽略大小写找下一个可用位置。 */
function indexOfIgnoreCase(pattern: PatternInfo, name: string, fromIndex: number, patternIndex: number): number {
  const raw = pattern.pattern[patternIndex]!
  const upper = pattern.upper[patternIndex]!
  const lower = pattern.lower[patternIndex]!
  for (let i = Math.max(0, fromIndex); i < name.length; i++) {
    const char = name[i]!
    if (char === raw || char === upper || char === lower) return i
  }
  return -1
}

/** `MinusculeMatcherImpl.kt:464-478`：从 `startFrom` 起找「下一个能作为片段的起点」。 */
function indexOfWordStart(pattern: PatternInfo, name: string, patternIndex: number, startFrom: number): number {
  const char = pattern.pattern[patternIndex]!
  if (startFrom >= name.length ||
    (pattern.mixedCase && pattern.isLower[patternIndex] && !(patternIndex > 0 && pattern.isSeparator[patternIndex - 1]))) return -1
  const special = !isLetterOrDigit(char)
  for (;;) {
    const found = indexOfIgnoreCase(pattern, name, startFrom, patternIndex)
    if (found < 0) return -1
    if (special || isWordStart(name, found)) return found
    startFrom = found + 1
  }
}

/** `MinusculeMatcherImpl.kt:509-523`：把 `from..length` 这一段并进片段表（相邻就合并）。 */
function appendRange(ranges: MatchedFragment[], from: number, length: number): MatchedFragment[] {
  if (ranges.length === 0) return [{ start: from, end: from + length }]
  const last = ranges[ranges.length - 1]!
  if (last.start === from + length) ranges[ranges.length - 1] = { start: from, end: last.end }
  else ranges.push({ start: from, end: from + length })
  return ranges
}

class Engine {
  // 显式字段，不写参数属性（`constructor(private readonly ...)` 会让 Node 22 的
  // strip-only 擦除整个文件加载失败，见 docs/agent-playbook-parity.md §0.5）。
  private readonly pattern: PatternInfo
  private readonly mode: MatchingMode
  constructor(patternText: string, mode: MatchingMode) {
    this.pattern = analyse(patternText)
    this.mode = mode
  }

  private isWildcardAt(index: number): boolean {
    return index >= 0 && index < this.pattern.pattern.length && isWildcardChar(this.pattern.pattern[index]!)
  }

  private isPatternChar(index: number, char: string): boolean {
    return index >= 0 && index < this.pattern.pattern.length && this.pattern.pattern[index] === char
  }

  private get ignoreCase(): boolean { return this.mode !== 'match-case' }

  /** `MinusculeMatcherImpl.kt:312-314` */
  private charEquals(patternChar: string, patternIndex: number, char: string, ignoreCase: boolean): boolean {
    return patternChar === char
      || (ignoreCase && (this.pattern.lower[patternIndex] === char || this.pattern.upper[patternIndex] === char))
  }

  /** `MinusculeMatcherImpl.kt:438-448` */
  private isFirstCharMatching(name: string, nameIndex: number, patternIndex: number): boolean {
    if (nameIndex >= name.length) return false
    const patternChar = this.pattern.pattern[patternIndex]!
    if (!this.charEquals(patternChar, patternIndex, name[nameIndex]!, this.ignoreCase)) return false
    return !(this.mode === 'first-letter'
      && (patternIndex === 0 || (patternIndex === 1 && this.isWildcardAt(0)))
      && hasCase(patternChar)
      && this.pattern.isUpper[patternIndex] !== isUpper(name[0]!))
  }

  /** `MinusculeMatcherImpl.kt:345-347`：数字夹在两个数字之间时不许跳过。 */
  private skipsDigitBetweenPatternDigits(patternIndex: number, nameChar: string): boolean {
    return isDigit(this.pattern.pattern[patternIndex]!) && isDigit(this.pattern.pattern[patternIndex - 1] ?? '') && isDigit(nameChar)
  }

  /** `MinusculeMatcherImpl.kt:325-343`：从两处起点能连续对上的最长片段长度。 */
  private maxMatchingFragment(name: string, patternIndex: number, nameIndex: number): number {
    if (!this.isFirstCharMatching(name, nameIndex, patternIndex)) return 0
    let i = 1
    while (nameIndex + i < name.length && patternIndex + i < this.pattern.pattern.length) {
      const nameChar = name[nameIndex + i]!
      if (!this.charEquals(this.pattern.pattern[patternIndex + i]!, patternIndex + i, nameChar, this.ignoreCase)) {
        if (this.skipsDigitBetweenPatternDigits(patternIndex + i, nameChar)) return 0
        break
      }
      ++i
    }
    return i
  }

  /** `MinusculeMatcherImpl.kt:301-310` */
  private seemsLikeFragmentStart(name: string, patternIndex: number, occurrence: number): boolean {
    return !this.pattern.isUpper[patternIndex]
      || isUpper(name[occurrence]!)
      || isWordStart(name, occurrence)
      || (!this.pattern.mixedCase && this.mode !== 'match-case')
  }

  /** `MinusculeMatcherImpl.kt:362-365`：通配符之后、且不是词首的命中算「中间命中」。 */
  private isMiddleMatch(name: string, patternIndex: number, nameIndex: number): boolean {
    return this.isPatternChar(patternIndex - 1, '*') && !this.isWildcardAt(patternIndex + 1)
      && isLetterOrDigit(name[nameIndex]!) && !isWordStart(name, nameIndex)
  }

  /** `MinusculeMatcherImpl.kt:286-299`（硬分隔符集合默认空，见文件头）。 */
  private checkForSpecialChars(name: string, start: number, end: number, patternIndex: number): number {
    if (end < 0) return -1
    if (this.pattern.hasDots && !this.isPatternChar(patternIndex - 1, '.') && name.indexOf('.', start) < end) return -1
    return end
  }

  /** `MinusculeMatcherImpl.kt:273-284`：下一个候选起点。 */
  private findNextPatternCharOccurrence(name: string, startAt: number, patternIndex: number): number {
    return !this.isPatternChar(patternIndex - 1, '*') && !this.pattern.isSeparator[patternIndex]
      ? indexOfWordStart(this.pattern, name, patternIndex, startAt)
      : indexOfIgnoreCase(this.pattern, name, startAt, patternIndex)
  }

  /** `MinusculeMatcherImpl.kt:181-226` */
  private matchWildcards(name: string, patternIndex: number, nameIndex: number): MatchedFragment[] | null {
    if (nameIndex < 0) return null
    if (!this.isWildcardAt(patternIndex)) {
      if (patternIndex === this.pattern.pattern.length) return []
      return this.matchFragment(name, patternIndex, nameIndex)
    }
    let index = patternIndex
    do { ++index } while (this.isWildcardAt(index))
    if (index === this.pattern.pattern.length) {
      // 尾部通配：`Foo ` 这类输入要求落在词尾（:206-214）
      if (this.isTrailingSpacePattern && nameIndex !== name.length
        && (index < 2 || !isUpper(this.pattern.pattern[index - 2]!) && !isDigit(this.pattern.pattern[index - 2]!))) {
        const spaceIndex = name.indexOf(' ', nameIndex)
        return spaceIndex >= 0 ? [{ start: spaceIndex, end: spaceIndex + 1 }] : null
      }
      return []
    }
    return this.matchSkippingWords(name, index,
      this.findNextPatternCharOccurrence(name, nameIndex, index), true)
  }

  /** `MinusculeMatcherImpl.kt:228-229` */
  private get isTrailingSpacePattern(): boolean {
    return this.isPatternChar(this.pattern.pattern.length - 1, ' ')
  }

  /** `MinusculeMatcherImpl.kt:239-271` */
  private matchSkippingWords(name: string, patternIndex: number, nameIndex: number, allowSpecialChars: boolean): MatchedFragment[] | null {
    let cursor = nameIndex
    let maxFound = 0
    while (cursor >= 0) {
      const fragmentLength = this.seemsLikeFragmentStart(name, patternIndex, cursor)
        ? this.maxMatchingFragment(name, patternIndex, cursor) : 0
      if (fragmentLength > maxFound || (cursor + fragmentLength === name.length && this.isTrailingSpacePattern)) {
        if (!this.isMiddleMatch(name, patternIndex, cursor)) maxFound = fragmentLength
        const ranges = this.matchInsideFragment(name, patternIndex, cursor, fragmentLength)
        if (ranges !== null) return ranges
      }
      const next = this.findNextPatternCharOccurrence(name, cursor + 1, patternIndex)
      cursor = allowSpecialChars ? next : this.checkForSpecialChars(name, cursor + 1, next, patternIndex)
    }
    return null
  }

  /** `MinusculeMatcherImpl.kt:316-323` */
  private matchFragment(name: string, patternIndex: number, nameIndex: number): MatchedFragment[] | null {
    const fragmentLength = this.maxMatchingFragment(name, patternIndex, nameIndex)
    return fragmentLength === 0 ? null : this.matchInsideFragment(name, patternIndex, nameIndex, fragmentLength)
  }

  /** `MinusculeMatcherImpl.kt:350-360`：中间命中要求片段至少 3 个字符。 */
  private matchInsideFragment(name: string, patternIndex: number, nameIndex: number, fragmentLength: number): MatchedFragment[] | null {
    const minFragment = this.isMiddleMatch(name, patternIndex, nameIndex) ? 3 : 1
    const improved = this.improveCamelHumps(name, patternIndex, nameIndex, fragmentLength, minFragment)
    return improved ?? this.findLongestMatchingPrefix(name, patternIndex, nameIndex, fragmentLength, minFragment)
  }

  /** `MinusculeMatcherImpl.kt:403-436`：`CU` 对 `CurrentUser` —— 大写尽量对到真驼峰上。 */
  private improveCamelHumps(name: string, patternIndex: number, nameIndex: number, maxFragment: number, minFragment: number): MatchedFragment[] | null {
    for (let i = minFragment; i < maxFragment; i++) {
      const patternChar = this.pattern.pattern[patternIndex + i]
      const nameChar = name[nameIndex + i]
      if (patternChar === undefined || nameChar === undefined) break
      if (this.pattern.isUpper[patternIndex + i] && patternChar !== nameChar) {
        const start = indexOfWordStart(this.pattern, name, patternIndex + i, nameIndex + i)
        const ranges = this.matchWildcards(name, patternIndex + i, start)
        if (ranges !== null) return appendRange(ranges, nameIndex, i)
      }
    }
    return null
  }

  /** `MinusculeMatcherImpl.kt:367-401` */
  private findLongestMatchingPrefix(
    name: string, patternIndex: number, nameIndex: number, fragmentLength: number, minFragment: number,
  ): MatchedFragment[] | null {
    if (patternIndex + fragmentLength >= this.pattern.pattern.length) {
      return [{ start: nameIndex, end: nameIndex + fragmentLength }]
    }
    let i = fragmentLength
    while (i >= minFragment || (i > 0 && this.isWildcardAt(patternIndex + i))) {
      let ranges: MatchedFragment[] | null = null
      if (this.isWildcardAt(patternIndex + i)) {
        ranges = this.matchWildcards(name, patternIndex + i, nameIndex + i)
      } else {
        let next = this.findNextPatternCharOccurrence(name, nameIndex + i + 1, patternIndex + i)
        next = this.checkForSpecialChars(name, nameIndex + i, next, patternIndex + i)
        if (next >= 0) ranges = this.matchSkippingWords(name, patternIndex + i, next, false)
      }
      if (ranges !== null) return appendRange(ranges, nameIndex, i)
      --i
    }
    return null
  }

  /** `MinusculeMatcherImpl.kt:156-175`：超长 pattern 的退化匹配（只认连续前缀段）。 */
  private meaningfulCharsMatchAt(name: string, nameIndex: number): number {
    let at = 0
    let pos = nameIndex
    while (pos < name.length && at + 1 < this.pattern.meaningful.length) {
      const char = name[pos]!
      if (char === this.pattern.meaningful[at] || char === this.pattern.meaningful[at + 1]) { at += 2; ++pos } else if (isWildcardChar(char)) { ++pos } else break
    }
    return pos - nameIndex
  }

  /** `MinusculeMatcherImpl.kt:133-154` */
  private matchBySubstring(name: string): MatchedFragment[] | null {
    const count = this.pattern.meaningful.length / 2
    if (name.length < count) return null
    if (this.isPatternChar(0, '*')) {
      for (let i = 0; i + count <= name.length; i++) {
        const length = this.meaningfulCharsMatchAt(name, i)
        if (length !== 0) return [{ start: i, end: i + length }]
      }
      return null
    }
    const length = this.meaningfulCharsMatchAt(name, 0)
    return length !== 0 ? [{ start: 0, end: length }] : null
  }

  /** `MinusculeMatcherImpl.kt:112-125`：返回命中的字符段；`null` = 不匹配。 */
  match(name: string): MatchedFragment[] | null {
    if (name.length < this.pattern.meaningful.length / 2) return null
    if (this.pattern.pattern.length > MAX_CAMEL_HUMP_MATCHING_LENGTH) return this.matchBySubstring(name)
    if (!containsMeaningfulInOrder(name, this.pattern.meaningful)) return null
    const ranges = this.matchWildcards(name, 0, 0)
    // 上游用链表倒着收集，返回前 `asReversed()`（:124）—— 这里同一形状，反转后再给出。
    return ranges === null ? null : [...ranges].reverse()
  }

  matches(name: string): boolean { return this.match(name) !== null }

  /** `MinusculeMatcher.kt:63-81`：首个片段是否贴着名字开头。 */
  isStartMatch(name: string): boolean {
    const fragments = this.match(name)
    return fragments !== null && (fragments.length === 0 || fragments[0]!.start === 0)
  }

  /** `MinusculeMatcher.kt:84-161` + `:163-191` 的分数（`valueStartCaseMatch` 上游在
   * `CamelHumpMatcher.java:200` 处传 `true`）。 */
  matchingDegree(name: string, fragments: MatchedFragment[] | null = this.match(name)): number {
    if (fragments === null) return Number.MIN_SAFE_INTEGER
    if (fragments.length === 0) return 0
    const first = fragments[0]!
    const startMatch = first.start === 0
    let matchingCase = 0
    let p = -1
    let skippedHumps = 0
    let nextHumpStart = 0
    let humpStartMatchedUpperCase = false
    for (let r = 0; r < fragments.length; r++) {
      const range = fragments[r]!
      const afterGapAvailable = r > 0
      for (let i = range.start; i < range.end; i++) {
        const afterGap = i === range.start && afterGapAvailable
        let isHumpStart = false
        while (nextHumpStart <= i) {
          if (nextHumpStart === i) isHumpStart = true
          else if (afterGap) ++skippedHumps
          nextHumpStart = nextHumpStart < name.length && isDigit(name[nextHumpStart]!)
            ? nextHumpStart + 1                     // 每个数字自成一个驼峰（:117-119）
            : nextWord(name, nextHumpStart)
        }
        const char = name[i]!
        p = indexOfIgnoringCaseInPattern(this.pattern.pattern, char, p + 1)
        if (p < 0) break
        if (isHumpStart) humpStartMatchedUpperCase = char === this.pattern.pattern[p] && this.pattern.isUpper[p]
        matchingCase += evaluateCaseMatching(this.pattern, startMatch, p, humpStartMatchedUpperCase, i, afterGap, isHumpStart, char)
      }
    }
    const startIndex = first.start
    const wordStart = startIndex === 0 || (isWordStart(name, startIndex) && !isWordStart(name, startIndex - 1))
    const finalMatch = fragments[fragments.length - 1]!.end === name.length
    // 硬分隔符默认空集（`NameUtil.java:298`）⇒ `afterSeparator` 只在起点为 0 时为 false，
    // 于是上游那个 +2 分支在非零起点时恒成立。
    const afterSeparator = startIndex > 0
    return (wordStart ? 1000 : 0) + matchingCase - fragments.length - skippedHumps * 10
      + (afterSeparator ? 0 : 2) + (startMatch ? 1 : 0) + (finalMatch ? 1 : 0)
  }
}

/** `MinusculeMatcher.kt:126`：在 pattern 里从头往后找这个字符（忽略大小写），返回下标。 */
function indexOfIgnoringCaseInPattern(pattern: string, char: string, from: number): number {
  for (let i = Math.max(0, from); i < pattern.length; i++) {
    const p = pattern[i]!
    if (p === char || p.toLowerCase() === char.toLowerCase()) return i
  }
  return -1
}

/** `MinusculeMatcher.kt:163-191` 的 `evaluateCaseMatching`。 */
function evaluateCaseMatching(
  pattern: PatternInfo, valuedStartMatch: boolean, patternIndex: number, humpStartMatchedUpperCase: boolean,
  nameIndex: number, afterGap: boolean, isHumpStart: boolean, nameChar: string,
): number {
  if (afterGap && isHumpStart && pattern.isLower[patternIndex]) return -10
  if (nameChar === pattern.pattern[patternIndex]) {
    if (pattern.isUpper[patternIndex]) return 50
    if (nameIndex === 0 && valuedStartMatch) return 150
    if (isHumpStart) return 1
    return 0
  }
  if (isHumpStart) return -1
  if (pattern.isLower[patternIndex] && humpStartMatchedUpperCase) return -1
  return 0
}

// Kotlin 的 `List.asReversed()` 是视图，上游在 :124 用它把倒序收集的片段转正；
// 本仓直接 `[...].reverse()`，不碰全局原型。

export interface CamelHumpMatcherOptions {
  /** 默认档 `ide.completion.middle.matching=true`（`registry.properties:960`）可关。 */
  middleMatching?: boolean
  /**
   * `CodeInsightSettings.java:75` 的 `COMPLETION_CASE_SENSITIVE = FIRST_LETTER` 是上游默认档；
   * 传 `'ignore-case'` 等价于把那个设置拨成 `NONE`，`'match-case'` 等价于 `ALL`（`:86-88`）。
   */
  caseSensitiveMode?: MatchingMode
  /**
   * 条目自身区不区分大小写 = 上游 `LookupElement.isCaseSensitive()`（默认 `true`，
   * `platform/analysis-api/src/com/intellij/codeInsight/lookup/LookupElement.java:163-165`）。
   * `true` 时只走严格档（`CamelHumpMatcher.java:104` 那条 `itemCaseInsensitive=false` 的分支），
   * 大小写设置就真的对用户可见；`false` 时按 `:109-116` 追加「忽略大小写的前缀」与宽松档两条放行。
   * LSP 补全条目没有这个属性，本仓按上游**默认值**（区分大小写）处理。
   */
  caseSensitiveItem?: boolean
}

export interface CamelHumpMatcher {
  prefix: string
  /** `CamelHumpMatcher.java:80-119`：留在表里的判据。 */
  matches: (name: string) => boolean
  /** 命中的字符段（`matchingFragments`），弹层高亮与 `getMatch` 用。 */
  fragments: (name: string) => MatchedFragment[] | null
  /** CodeMirror `getMatch` 要的扁平下标对（`[start,end,start,end…]`）。 */
  matchRanges: (name: string) => number[]
  /** `RealPrefixMatchingWeigher.java:21-27`：越大越好；不匹配返回 `Number.MIN_SAFE_INTEGER`。 */
  matchingDegree: (name: string) => number
  isStartMatch: (name: string) => boolean
}

/**
 * 上游的构造入口（`CamelHumpMatcher.java:31-46` + `createMatcher:130-147`）：
 * 一个 pattern 编两把匹配器 —— 严格档走 `CodeInsightSettings` 的档位（默认 `FIRST_LETTER`），
 * 宽松档恒为 `IGNORE_CASE`。条目大小写不敏感时（LSP 条目全是这种）两把都要过一遍。
 */
export function camelHumpMatcher(prefix: string, options: CamelHumpMatcherOptions = {}): CamelHumpMatcher {
  const middle = options.middleMatching !== false
  const mode: MatchingMode = options.caseSensitiveMode ?? 'first-letter'
  const itemCaseSensitive = options.caseSensitiveItem !== false
  const patternText = applyMiddleMatching(prefix, middle)
  const strict = new Engine(patternText, mode)
  const loose = new Engine(patternText, 'ignore-case')
  const matches = (name: string): boolean => {
    if (prefix.length === 0) return true
    if (strict.matches(name)) return true                                 // :87 prefixMatches(name)
    if (itemCaseSensitive) return false                                   // :104 走 itemCaseInsensitive=false 那一支
    if (name.toLowerCase().startsWith(prefix.toLowerCase())) return true   // :109 的 startsWithIgnoreCase
    // :112-116：条目不区分大小写且设置不是 ALL 时，宽松档再放行一次。
    return mode !== 'match-case' && loose.matches(name)
  }
  // `CamelHumpMatcher.java:180-201`：分数走严格档；下划线开头的名字先跳过下划线再看宽松档。
  const matchingDegree = (name: string): number => {
    const fragments = strict.match(name)
    if (fragments === null) return Number.MIN_SAFE_INTEGER
    const underscoreEnd = /^_+/.exec(name)?.[0].length ?? 0
    if (underscoreEnd > 0) {
      const looseFragments = loose.match(name)
      if (looseFragments !== null && looseFragments.length > 0 && looseFragments[0]!.start > 0 && looseFragments[0]!.start <= underscoreEnd) {
        return loose.matchingDegree(name.slice(looseFragments[0]!.start)) - 1
      }
    }
    return strict.matchingDegree(name, fragments)
  }
  return {
    prefix,
    matches,
    // 高亮用的字符段：上游 `matchingFragments` 走严格档（`:184-186`），但严格档在大小写设置
    // 放开时可能根本不算命中（`isFirstCharMatching`，`MinusculeMatcherImpl.kt:445-447`），
    // 于是条目被放行了却没有可加粗的片段 —— 这里退回宽松档，保证「进了表就有命中段」。
    fragments: name => strict.match(name) ?? loose.match(name),
    matchRanges: name => {
      const fragments = strict.match(name) ?? loose.match(name)
      if (fragments === null) return []
      const ranges: number[] = []
      for (const fragment of fragments) ranges.push(fragment.start, fragment.end)
      return ranges
    },
    matchingDegree,
    isStartMatch: name => (itemCaseSensitive ? strict : loose).isStartMatch(name),
  }
}

/**
 * 与上游 `RealPrefixMatchingWeigher.getBestMatchingDegree`（`:21-27`）同口径的**排序键**：
 * 分数取反（越大越靠前），完全不匹配给 `Number.MAX_SAFE_INTEGER`（上游给 `Integer.MAX_VALUE`）。
 */
export function prefixMatchingWeight(matcher: CamelHumpMatcher, name: string): number {
  const degree = matcher.matchingDegree(name)
  return degree === Number.MIN_SAFE_INTEGER ? Number.MAX_SAFE_INTEGER : -degree
}
