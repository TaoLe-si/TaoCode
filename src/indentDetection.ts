// 从文件内容探测缩进 —— 上游 `com.intellij.psi.codeStyle.autodetect` 的可移植内核。
//
// 上游逐条（`platform/lang-impl/src/com/intellij/psi/codeStyle/autodetect/`）：
//   · 入口与总开关 —— `IndentOptionsDetectorImpl.java:57-68`（克隆该文件类型的缩进选项，
//     再让 adjuster 改）；`:70-86`（`calcLineIndentInfo`：行数 < 3 或文件 > 1MB 直接不探测；
//     需要 `LanguageFormatting` 建出 `FormattingModel` 才继续）；`:93-98`（`FileUtilRt.MEGABYTE`）。
//   · 统计 —— `IndentUsageStatisticsImpl.java`：`:47-59`（逐行分派：带制表符的记一次，
//     带普通缩进的进 `handleNormalIndent`）、`:68-92`（`handleNormalIndent`：相对缩进、亲本缩进栈、
//     同级继承上一行的相对缩进、`currentIndent > 0` 才计入「带空格缩进的行数」）、
//     `:32-36`（按「用得多」降序，用得一样多时按缩进宽度降序）、`:39-45`（map 转 list）。
//   · 调整 —— `IndentOptionsAdjusterImpl.java`：`:8-9`（`RATE_THRESHOLD = 0.8`、
//     `MAX_INDENT_TO_DETECT = 8`）、`:18-32`（制表符优先，否则空格）、`:34-42`（`adjustForTabUsage`：
//     已经在用制表符就什么都不改）、`:44-52`（`isTabsUsed` 用严格大于、`isSpacesUsed` 用 0.8 占比）、
//     `:54-76`（`getPositiveIndentSize`：最多常用的那个宽度，为 0 就退到次常用；宽度 ≤ 8 且占比 > 0.8 才认）。
//   · 每行的分类 —— `LineIndentInfo.java:23-37`（只有两种会被统计：`LINE_WITH_TABS` 与
//     `newNormalIndent(宽度)`）+ `FormatterBasedLineIndentInfoBuilder.java:42-61`（带制表符 → 记一次；
//     否则宽度 = 块起点 − 行起点）、`:119-121`（**注释行跳过**）、`:129-131`（`rangeHasTabs`）。
//
// **与上游的差别（如实写清，不是"顺手修正"）**：
//   1. `FormatterBasedLineIndentInfoBuilder` 是从**语法块**取缩进的（本仓没有 PSI），所以它那三档
//      区分 —— 注释行（`LINE_WITH_COMMENT`）、续行缩进（`LINE_WITH_CONTINUATION_INDENT`）、
//      不可计入的缩进（`LINE_WITH_NOT_COUNTABLE_INDENT`）—— 这里**取不到**。本仓按
//      **每一非空行的行首空白**分类：带制表符 → `tabs`，否则 → `normal`（宽度 = 行首空白长度，
//      没有空白时宽度 0，这与上游 `newNormalIndent(0)` 同义 —— `handleNormalIndent` 的
//      `currentIndent > 0` 判断本来就把它排除在「带空格缩进的行数」之外）。
//   2. `rangeHasTabs`（`FormatterBasedLineIndentInfoBuilder.java:130`）写的是 `indexOf(...) > 0`，
//     所以**文件第一行**开头就一个制表符时不会被算成制表符行（偏移 0 不满足 `> 0`）。
//     这里照抄这个口径，不修正，并在测试里钉住。
//   3. 上游还要求 `FormattingModelBuilder` 存在（`:80-83`），即语言没有格式化器就不探测。
//     本仓没有语言概念，改为由调用方决定要不要探测（`detectIndentOptions` 的 `enabled`）。

/** 每行的缩进分类（`LineIndentInfo` 的两个可统计档 + 跳过）。 */
export type LineIndentKind = 'tabs' | 'normal' | 'skip'

export interface LineIndentInfo {
  kind: LineIndentKind
  /** 仅 `normal` 有意义：缩进宽度（`FormatterBasedLineIndentInfoBuilder.java:55` 的块起点 − 行起点）。 */
  indentSize: number
}

/** `FileUtilRt.MEGABYTE`（`IndentOptionsDetectorImpl.java:93-98`）。 */
const MAX_DETECT_LENGTH = 1024 * 1024
/** `IndentOptionsDetectorImpl.java:71` 的 `getLineCount() < 3`。 */
const MIN_LINES = 3

/**
 * 逐行取缩进分类（`FormatterBasedLineIndentInfoBuilder.build` 的文本等价物）。
 * 空行（只有空白）跳过 —— 对应上游的 `LineIndentInfo.EMPTY_LINE` 不进统计。
 */
export function lineIndentInfos(text: string): LineIndentInfo[] {
  const infos: LineIndentInfo[] = []
  for (const line of text.split('\n')) {
    let indentSize = 0
    while (indentSize < line.length && (line[indentSize] === ' ' || line[indentSize] === '\t')) ++indentSize
    if (indentSize >= line.length) continue  // 空行 / 全空白行：EMPTY_LINE
    const indent = line.slice(0, indentSize)
    if (indent.includes('\t')) { infos.push({ kind: 'tabs', indentSize: 0 }); continue }
    infos.push({ kind: 'normal', indentSize })
  }
  return infos
}

/** `IndentUsageInfo`：某个缩进宽度被用了几次。 */
export interface IndentUsageInfo {
  indentSize: number
  timesUsed: number
}

/**
 * `IndentUsageStatisticsImpl`（`:14-127`）的逐行移植。
 * 上游的 `Stack<IndentData>` 亲本缩进栈在这里就是 `myParentIndents` 那段逻辑。
 */
export class IndentUsageStatistics {
  private readonly usages = new Map<number, number>()
  private readonly ranked: IndentUsageInfo[] = []
  private totalLinesWithTabs = 0
  private totalLinesWithWhiteSpaces = 0

  constructor(lineInfos: readonly LineIndentInfo[]) {
    this.build(lineInfos)
    // `:32-36`：用得多优先；用得一样多时**宽的**在前（`o2.getIndentSize() - o1.getIndentSize()`）。
    this.ranked = [...this.usages.entries()]
      .map(([indentSize, timesUsed]) => ({ indentSize, timesUsed }))
      .sort((left, right) => right.timesUsed - left.timesUsed || right.indentSize - left.indentSize)
  }

  /** `buildIndentToUsagesMap`（`:47-59`）分派 + `handleNormalIndent`（`:68-92`）。 */
  private build(lineInfos: readonly LineIndentInfo[]): void {
    let previousLineIndent = 0
    let previousRelativeIndent = 0
    // `myParentIndents`（`:26`）：栈底是 (0, 0)，`findParentIndent`（`:61-66`）只弹出比当前更深的。
    const parents: { indent: number; relativeIndent: number }[] = [{ indent: 0, relativeIndent: 0 }]

    for (const info of lineInfos) {
      if (info.kind === 'tabs') { ++this.totalLinesWithTabs; continue }
      if (info.kind !== 'normal') continue
      const currentIndent = info.indentSize
      let relativeIndent = currentIndent - previousLineIndent
      if (relativeIndent < 0) {
        // `:71-75`：退到最深的那个不比当前深的亲本上，重新算相对缩进。
        while (parents.length !== 1 && parents[parents.length - 1]!.indent > currentIndent) parents.pop()
        const parent = parents[parents.length - 1]!
        previousLineIndent = parent.indent
        previousRelativeIndent = parent.relativeIndent
        relativeIndent = currentIndent - previousLineIndent
      }
      if (relativeIndent === 0) {
        // `:77-79`：回到同一级 ⇒ 继承上一行的相对缩进（这正是「零缩进行」也要计入统计的原因）。
        relativeIndent = previousRelativeIndent
      } else {
        parents.push({ indent: currentIndent, relativeIndent })
      }
      this.usages.set(relativeIndent, (this.usages.get(relativeIndent) ?? 0) + 1)
      previousRelativeIndent = relativeIndent
      previousLineIndent = currentIndent
      if (currentIndent > 0) ++this.totalLinesWithWhiteSpaces
    }
  }

  /** `getTotalLinesWithLeadingTabs`（`:94-97`）。 */
  get totalLinesWithLeadingTabs(): number { return this.totalLinesWithTabs }
  /** `getTotalLinesWithLeadingSpaces`（`:99-102`）。 */
  get totalLinesWithLeadingSpaces(): number { return this.totalLinesWithWhiteSpaces }
  /** `getTotalIndentSizesDetected`（`:114-117`）：map 的键数。 */
  get totalIndentSizesDetected(): number { return this.usages.size }
  /** `getKMostUsedIndentInfo`（`:104-107`）。 */
  kMostUsedIndentInfo(k: number): IndentUsageInfo { return this.ranked[k]! }
}

/** `IndentOptionsAdjusterImpl.adjust`（`:18-32`）会写的那几个字段。 */
export interface DetectableIndentOptions {
  indentSize: number
  continuationIndentSize: number
  tabSize: number
  useTabCharacter: boolean
}

const RATE_THRESHOLD = 0.8     // `IndentOptionsAdjusterImpl.java:8`
const MAX_INDENT_TO_DETECT = 8  // `:9`

/**
 * `IndentOptionsAdjusterImpl`（`:18-76`）的逐行移植：就地改 `options`，返回「有没有改」。
 * 调用方拿到的就是上游 `IndentOptionsDetectorImpl.getIndentOptions`（`:57-68`）的返回值语义。
 */
export function adjustIndentOptions(stats: IndentUsageStatistics, options: DetectableIndentOptions): boolean {
  const tabsUsed = stats.totalLinesWithLeadingTabs > stats.totalLinesWithLeadingSpaces  // `:50-52`
  const spacesUsed = (  // `:44-48`
    stats.totalLinesWithLeadingSpaces
    / (stats.totalLinesWithLeadingSpaces + stats.totalLinesWithLeadingTabs)
  ) > RATE_THRESHOLD

  if (tabsUsed) {
    // `adjustForTabUsage`（`:34-42`）：本来就是制表符则原样返回（保持 INDENT_SIZE 不动）。
    if (options.useTabCharacter) return false
    // INDENT_SIZE 为 0 时续行比按 1 算（上游是整数除法）。
    const continuationRatio = options.indentSize === 0 ? 1 : Math.trunc(options.continuationIndentSize / options.indentSize)
    options.useTabCharacter = true
    options.indentSize = options.tabSize
    options.continuationIndentSize = options.tabSize * continuationRatio
    return true
  }
  // `else if (isSpacesUsed)`（`:29-31`）：`USE_TAB_CHARACTER = false` 是无条件赋值，
  // 只有缩进宽度真的变了才算「改过」。
  if (!spacesUsed) return false
  options.useTabCharacter = false
  const newIndentSize = getPositiveIndentSize(stats)
  if (newIndentSize > 0 && options.indentSize !== newIndentSize) { options.indentSize = newIndentSize; return true }
  return false
}

/** `getPositiveIndentSize`（`:54-76`）：-1 = 没探测出可信的缩进宽度。 */
function getPositiveIndentSize(stats: IndentUsageStatistics): number {
  if (stats.totalIndentSizesDetected === 0) return -1
  let info = stats.kMostUsedIndentInfo(0)
  let size = info.indentSize
  if (size === 0) {
    if (stats.totalIndentSizesDetected < 2) return -1
    info = stats.kMostUsedIndentInfo(1)
    size = info.indentSize
  }
  if (size <= MAX_INDENT_TO_DETECT && info.timesUsed / stats.totalLinesWithLeadingSpaces > RATE_THRESHOLD) return size
  return -1
}

export interface DetectIndentOptionsInput {
  text: string
  options: DetectableIndentOptions
  /** 关掉就完全不动 `options`（对应「不按内容探测」这个用户开关）。 */
  enabled?: boolean
}

/**
 * `IndentOptionsDetectorImpl.getIndentOptions`（`:57-68`）的端到端等价物。
 * 返回 `null` = 上游的「不探测」（`:71-72` 的两个 guard 命中），调用方应保留原设置。
 */
export function detectIndentOptions({ text, options, enabled = true }: DetectIndentOptionsInput): DetectableIndentOptions | null {
  if (!enabled) return null
  if (text.length > MAX_DETECT_LENGTH) return null
  const infos = lineIndentInfos(text)
  if (infos.length < MIN_LINES) return null
  // 上游是 `clone()` 后再 adjust（`:59-64`），所以不污染调用方的对象。
  const adjusted = { ...options }
  adjustIndentOptions(new IndentUsageStatistics(infos), adjusted)
  return adjusted
}
