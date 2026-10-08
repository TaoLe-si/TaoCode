// 格式化后的处理器（`PostFormatProcessor`）—— 本仓只落上游两个里唯一不依赖 PSI 的那个。
//
// 上游落点（`platform/code-style-impl/src/com/intellij/formatting/LineCommentAddSpacePostFormatProcessor.kt`）：
//   · 开关 —— `:25-27`：`settings.getCommonSettings(language).LINE_COMMENT_ADD_SPACE_ON_REFORMAT` 为假
//     直接原样返回；默认值 **false**（`platform/code-style-api/.../CommonCodeStyleSettings.java:261`）。
//     设置页文案是「Enforce on reformat」（`platform/ide-core/resources/messages/ApplicationBundle.properties:667`
//     的 `checkbox.line.comment.add.space.on.reformat`）。
//   · 找行注释 —— `:55-84`（`SingleLineCommentFinder`）：前缀取 `Commenter.lineCommentPrefixes` 去掉首尾空白
//     （`:59`），注释文本以其中某个前缀开头才算行注释（`:72-73`）；**空注释不加**（`:74`
//     的 `takeUnless { commentText.length == it }`）；记下「前缀之后那个位置」（`:83`）。
//   · 落笔 —— `:35-49`：只处理落在待重排区间内的位置（`:36` 的 `filter { rangeToReformat.contains(it) }`），
//     升序排序（`:37`），**倒着**逐个 `insertString(it, " ")`（`:44-45` 注释写明是为了保护靠前偏移）。
//
// **与上游的差别（如实写清）**：
//   1. 上游是 `PsiRecursiveElementVisitor` 遍历注释（`:62-66` 的 `visitComment`），本仓没有语法树，
//      所以「哪些行是行注释」按**行首空白之后的第一个非空白字符是不是已知行注释前缀**来判。
//      后果：块中间的 `/* */` 不算、字符串里的 `//` 也会算（后者与 `FormatterTagHandler` 那边
//      「整行文本上匹配」的口径一致，见 `src/formatterTags.ts` 的模块注释第 2 条）。
//   2. `canInsertSpaceInLineComment` 本仓按**接口默认实现**判（`canInsertSpaceInLineComment()`，
//      `platform/code-style-api/src/com/intellij/psi/codeStyle/LanguageCodeStyleProvider.java:77-81`：
//      空白内容不加、首字符不是字母或数字也不加）。2026-10-06 实测全社区树**没有任何语言覆写它**
//      （`grep -r canInsertSpaceInLineComment` 只有这一处 default 与那一处调用点），所以默认实现
//      就是上游用户可见的行为本身 —— 原注释写的「本仓没有，按恒真处理」是**误判**（留痕见下），
//      后果是 `// 已有空格` 会被补成两个空格、`//----` 分节线被拆行。
//      覆写口（Go 的 `//go:generate` 这类编译指令）在语言插件里，本仓的档位表没有这一列，
//      所以按默认实现走；要按语言豁免就得给设置面加字段（`docs/wiring-requests-2026-10-06-refactor.md` R4）。
//   3. 行注释前缀表 `Commenter.lineCommentPrefixes`（`:59`）在语言插件里，本仓用一张固定的小表
//      （`LINE_COMMENT_PREFIXES`），取值就是各语言 commenter 实际用到的 `//` / `#` / `--` / `;` / `%`。
//
// 后处理**只跑启用段**（本轮补，此前整份缓冲一遍扫过去）：
//   · `platform/code-style-impl/src/com/intellij/psi/impl/source/codeStyle/CoreCodeStyleUtil.java:121-129`
//     —— `postProcessText` 先看 `FORMATTER_TAGS_ENABLED`：假才整段处理后处理，真就走
//     `postProcessEnabledRanges`；
//   · 同文件 `:131-142` —— `new FormatterTagHandler(getSettings(file)).getEnabledRanges(node, range)`
//     逐段处理后处理，并因为**文本长度会变**而给后续段累计 `delta` 平移（`:136-140`）；
//   · 开关默认就是「真」：`CodeStyleSettings.FORMATTER_TAGS_ENABLED = true`（`CodeStyleSettings.java:468`）。
//   ⇒ 落在 `// @formatter:off` 段里的行注释**不该**被补空格。本仓此前把 `{start:0, end:全文}` 交给
//   处理器（`src/semanticActions.ts` 那一处），禁用段里的 `//无空格注释` 会被改掉 —— 与「禁用段不参与
//   格式化」这条标记的本意相反。现在两条链路（Ctrl+Alt+L 与保存时格式化）都走
//   `processFormattedText()`，段间偏移按「倒序处理」保持不变（与本仓 `processLineCommentAddSpace`
//   倒着插同一招法；上游是正向 + delta 累加，`CoreCodeStyleUtil.java:136-140`，两种走法对互不相交的
//   启用段等价 —— 每个处理器只动自己那段）。
//
// 空行上限（keep blank lines，本轮新增的本仓第一档空行规则）：
//   · 设置 —— `CommonCodeStyleSettings.java:285` `KEEP_BLANK_LINES_IN_DECLARATIONS = 2`、
//     `:290` `KEEP_BLANK_LINES_IN_CODE = 2`、`:295` `..._BETWEEN_PACKAGE_DECLARATION_AND_HEADER = 2`、
//     `:298` `KEEP_BLANK_LINES_BEFORE_RBRACE = 2`（四个默认值本轮逐行读过，都是 2）；
//   · 生效的那一下 —— `WhiteSpace.arrangeLineFeeds`
//     （`platform/code-style-impl/src/com/intellij/formatting/WhiteSpace.java:387-431`）：
//     `:395-400` `keepBlankLines > 0` 且 `getLineFeeds() >= keep + 1` 时把换行数压到 `keep + 1`
//     （N 个空行 = N+1 个换行 ⇒ 净效果「连续空行最多留 keep 个」）；
//     `:401-410` `keepBlankLines == 0` 那一档看 `shouldKeepLineFeeds()`：保留换行就压到
//     `max(minLineFeeds, 1)`（= 一个空行都不留但**不并行**），否则压到 `minLineFeeds`（可能并行）；
//     `:426-429` 文件最前面那段空白（`isFirst()`，前面没有块因而没有 spacing）换行清 0
//     ⇒ **文件开头的空行整段删掉**；
//   · `SpacingImpl.init`（`SpacingImpl.java:47-51`）还有一条：`minLineFeeds - 1 > keep` 时按
//     `minLineFeeds - 1` 走（必插的空行优先于「最多留几个」）—— 本仓不插空行（`BLANK_LINES_*` 那一族
//     要 PSI 才知道该插在哪），所以这一档在本仓没有对应的输入。
//
// 与上游的差别（如实写）：上游按 PSI 分「声明之间 / 代码里 / 右花括号前」三档各自的 keep，
// 本仓没有语法树判不出「这一处是声明还是语句」⇒ 只落 `KEEP_BLANK_LINES_IN_CODE` 这一档
// （`:290`，默认 2），另三档登记为架构不等价；另外「压到 0 个空行」时本仓**永不并行**
// （并行要语法树判安全性，走的是上游 `shouldKeepLineFeeds()` 为真的那一支 `:403-405`）。
// 空行落在块注释或多行字符串里时不算「代码里的空行」——上游那种空行是 `PsiComment`/`PsiLiteral`
// 的一部分，不是块间空白；本仓用 `nonCodeRanges()` 的区间模型挡掉（同一个模块也用于
// 「在注释和字符串里搜索」，见 `src/nonCodeUsages.ts`）。
//
// 消费链路（两条，都是「语言服务重排完之后补跑一遍」）：
//   · `src/semanticActions.ts` 的 `runFormatting`（Ctrl+Alt+L / 菜单「重新格式化」）；
//   · `src/actionsOnSave.ts` 的 `runActionsOnSave`（保存时格式化，本轮把这条也对齐）。
import { enabledRanges, hasFormatterTags, offsetAt, type FormatRange, type LineColumnEdit, type TextRangeOffsets } from './formatterTags.ts'
import { nonCodeRanges } from './nonCodeUsages.ts'
import type { CommentStyle } from './commentToggle.ts'

export type PostFormatSettings = {
  /** 上游 `CommonCodeStyleSettings.LINE_COMMENT_ADD_SPACE_ON_REFORMAT`，默认 false（`:261`）。 */
  lineCommentAddSpaceOnReformat: boolean
  /**
   * 连续空行最多留几行。上游对应 `CommonCodeStyleSettings.KEEP_BLANK_LINES_IN_CODE`
   * （`CommonCodeStyleSettings.java:290`，默认 **2**）；`0` = 代码里不留空行（仍不并行），
   * 负数按 `0` 处理（上游没有这一档，`SpacingImpl.java:47-51` 只会把它当更小的 keep）。
   */
  keepBlankLines: number
  /**
   * 本仓的行注释前缀表（上游是 `Commenter.lineCommentPrefixes`，语言插件提供）。
   * 排序无关 —— 上游 `SingleLineCommentFinder.visitComment`（`:71-75`）是 `find` 第一个命中的前缀。
   */
  lineCommentPrefixes: readonly string[]
}

/** 上游各语言 commenter 用到的行注释前缀（去空白后的形态，对齐 `SingleLineCommentFinder` 的 `:59`）。 */
export const LINE_COMMENT_PREFIXES = ['//', '#', '--', ';', '%'] as const

/**
 * 默认设置：`LINE_COMMENT_ADD_SPACE_ON_REFORMAT` 默认 **false**（`CommonCodeStyleSettings.java:261`）、
 * `KEEP_BLANK_LINES_IN_CODE` 默认 **2**（同文件 `:290`）。
 */
export const defaultPostFormatSettings: PostFormatSettings = {
  lineCommentAddSpaceOnReformat: false,
  keepBlankLines: 2,
  lineCommentPrefixes: LINE_COMMENT_PREFIXES,
}

export interface PostFormatResult {
  text: string
  /** 实际插了几个空格（上游 `rangeToReformat.grown(commentOffsets.size)`，`:49`）。 */
  inserted: number
}

/**
 * `LineCommentAddSpacePostFormatProcessor.processText`（`:22-50`）的文本等价物。
 * 返回的 `inserted` 就是上游「区间长了多少」的量，调用方用它更新提示。
 */
export function processLineCommentAddSpace(
  text: string,
  range: { start: number; end: number },
  settings: PostFormatSettings = defaultPostFormatSettings,
): PostFormatResult {
  if (!settings.lineCommentAddSpaceOnReformat) return { text, inserted: 0 }
  const offsets = lineCommentInsertOffsets(text, range, settings.lineCommentPrefixes)
  if (!offsets.length) return { text, inserted: 0 }
  // `:44-45`：倒着插 —— 从后往前才不会把靠前的偏移顶偏。
  let next = text
  for (let index = offsets.length - 1; index >= 0; --index) {
    const at = offsets[index]!
    next = next.slice(0, at) + ' ' + next.slice(at)
  }
  return { text: next, inserted: offsets.length }
}

/**
 * `LanguageCodeStyleProvider.canInsertSpaceInLineComment`（`:77-81`）默认实现的等价物：
 *   · 内容整段是空白 → 不加（`if (commentContents.isBlank()) return false`，`:78`）；
 *   · 首字符不是字母或数字 → 不加（`:79`，`isLetterOrDigit(commentContents.charAt(0))`）；
 *   · 其余才加（`:80`）。
 * Java 那边是 `Character.isLetterOrDigit`（Unicode 字母 + 十进制数字），这里用 `\p{L}` 与 `\p{N}` ——
 * 差别只在罗马数字/上标这两个小众数字类上，`//TODO`、`//中文`、`//1 号` 这类实际用例判得一致。
 * 判据用例（本仓旧实现按「恒真」会做错的三件）：`// 已有空格` 不再补成两个空格、
 * `//---- 分节线` 不动、`//   ` 只有空白不动。
 */
export function canInsertSpaceInLineComment(commentContents: string): boolean {
  if (commentContents.trim() === '') return false
  return /[\p{L}\p{N}]/u.test(commentContents.charAt(0))
}

/** `SingleLineCommentFinder.visitComment`（`:68-84`）收集 `commentOffsets` 的文本等价物。 */
function lineCommentInsertOffsets(
  text: string,
  range: { start: number; end: number },
  prefixes: readonly string[],
): number[] {
  const offsets: number[] = []
  // **扫描上界取文本本身，不取调用方的 `range.end`**（行扫描器的根因处，2026-10-06 refactorfix）：
  // 后处理会把文本改短，端点于是可能越过末尾 —— `processFormattedText` 自己钳过，
  // 但 `processLineCommentAddSpace` 是**导出**的入口，任何调用方都能递来一份「按改动前长度算的区间」。
  // 两条教训都在这儿（都可实测复现，判据见 `tests/format-post-ranges.test.mjs` 的「越界区间」两条）：
  //   · 收口值写成常量（`return text.length + 1`，HEAD 那一版）时，`range.end >= text.length + 1`
  //     会让 `position` 停在那个常量上不再动 ⇒ `for (position <= range.end)` **永远出不去**（真无限循环）；
  //   · 只改成「严格前进」（`from + 1`）也不够：越界的每一轮都还要空转一次，`range.end = 1e7`
  //     就是一千万轮 `indexOf`/`slice` —— 名义有限，实际等于挂死。
  // 越界那几轮本来就产不出偏移（`rest` 是空串，任何前缀都匹配不上；`at < range.end` 也够不着内容），
  // 所以钳到 `text.length` 之后**输出逐字节不变**，只是不再为不存在的内容付费。
  const scanEnd = Math.min(range.end, text.length)
  const scanStart = Math.max(0, range.start)
  for (let position = scanStart; position <= scanEnd; position = nextLineStart(text, position)) {
    const lineEnd = lineBreakAt(text, position)
    // 跳过行首空白再找前缀（上游是从 `PsiComment.textRange.startOffset` 起的，注释本身不含前导空白）。
    let cursor = position
    while (cursor < lineEnd && (text[cursor] === ' ' || text[cursor] === '\t')) ++cursor
    const rest = text.slice(cursor, lineEnd)
    const prefix = prefixes.find(item => item && rest.startsWith(item))
    if (!prefix) continue
    // `:71-75` 先挡掉空注释（`takeUnless { commentText.length == it }`），`:79-81` 再由
    // `canInsertSpaceInLineComment` 决定「前缀后面那个位置」到底加不加空格 —— 两件事在同一个
    // 函数里判，顺序与上游一致（先算 contents、再问钩子）。
    if (!canInsertSpaceInLineComment(rest.slice(prefix.length))) continue
    const at = cursor + prefix.length
    // `:36` 的 `filter { rangeToReformat.contains(it) }`：只处理落在待重排区间内的位置。
    if (at >= range.start && at < range.end) offsets.push(at)
  }
  return offsets
}

/** 从 `from` 起这一行的末尾（换行符的位置；没有换行就是文本长度 —— 与上游 `DocumentUtil.getLineEndOffset` 同效）。 */
function lineBreakAt(text: string, from: number): number {
  const index = text.indexOf('\n', from)
  return index < 0 ? text.length : index
}

/**
 * 下一行的行首。**必须严格前进**：`from` 已经在文本外时（区间端点越过被改短的文本），
 * 返回 `text.length + 1` 可能**等于** `from` ⇒ `for (position <= range.end)` 永远出不去（HEAD 的旧写法）。
 * 但「严格前进」只保证会停，不保证停得快 —— 真正的收口在调用处把扫描上界钳到 `text.length`。
 */
function nextLineStart(text: string, from: number): number {
  if (from >= text.length) return from + 1
  return lineBreakAt(text, from) + 1
}

/* ── 启用段：后处理只跑仍可格式化的那几段（CoreCodeStyleUtil.java:121-142）────────── */

/**
 * 后处理要跑的区间 = 「待重排区间」∩「启用段」。
 *
 * 上游那一步（`CoreCodeStyleUtil.postProcessText`，`:121-129`）只有两条分支：
 *   · `FORMATTER_TAGS_ENABLED` 为假 ⇒ 整段交处理器（`postProcessRange`，`:144-151`）；
 *   · 为真（默认，`CodeStyleSettings.java:468`）⇒ `postProcessEnabledRanges`（`:131-142`）
 *     按 `FormatterTagHandler.getEnabledRanges(node, range)` 逐段处理。
 * 本仓没有那套设置面（`FORMATTER_TAGS_ENABLED` 恒为上游默认值「真」），所以「文件里没标记」
 * 与「标记关着」在结果上等价：`enabledRanges()` 无标记时原样返回入参区间（与上游同一净效果）。
 */
export function enabledProcessingRanges(text: string, ranges: readonly TextRangeOffsets[] = []): TextRangeOffsets[] {
  const base = (ranges.length ? ranges : [{ start: 0, end: text.length }])
    .map(range => ({
      start: Math.max(0, Math.min(text.length, range.start)),
      end: Math.max(0, Math.min(text.length, range.end)),
    }))
    .filter(range => range.end > range.start)
  if (!base.length || !hasFormatterTags(text)) return base
  return base.flatMap(range => enabledRanges(text, range))
}

/** 一条已应用编辑在**改动前**文本里的跨度与写进去的新长度。 */
interface EditSpan { start: number; end: number; length: number }

/**
 * 改动前的一个偏移 → 改动后的偏移。
 * 上游不需要换算 —— `RangeFormatInfo` 记的是 `SmartPsiElementPointer`
 * （`CoreCodeStyleUtil.java:153-165`），格式化完再 `getStartOffset()/getEndOffset()` 重取（`:112-114`）；
 * 本仓没有 PSI 指针，等价物就是按已套用的编辑把区间端点平移。
 * 落点在被替换区间内部时夹到该区间起点：那段内容已经不在了，区间跟着它的前缘走。
 */
function mapOffsetThroughEdits(spans: readonly EditSpan[], at: number): number {
  let delta = 0
  for (const span of spans) {
    if (at <= span.start) break
    if (at < span.end) return span.start + delta
    delta += span.length - (span.end - span.start)
  }
  return at + delta
}

/**
 * 把「请求时刻」的区间换算到「套完编辑之后」的文本坐标系（后处理器要跑在改动后的文本上）。
 * `text` 是**编辑之前**的那份文本（语言服务算坐标用的那一份），`edits` 是实际套用的编辑。
 */
export function shiftRangesThroughEdits(
  text: string,
  edits: readonly (LineColumnEdit & { text?: string })[],
  ranges: readonly TextRangeOffsets[],
): TextRangeOffsets[] {
  const spans: EditSpan[] = edits
    .map(edit => {
      const start = offsetAt(text, edit.startLine, edit.startChar)
      const end = Math.max(start, offsetAt(text, edit.endLine, edit.endChar))
      return { start, end, length: edit.text?.length ?? 0 }
    })
    .sort((left, right) => left.start - right.start)
  return ranges
    .map(range => ({ start: mapOffsetThroughEdits(spans, range.start), end: mapOffsetThroughEdits(spans, Math.max(range.start, range.end)) }))
    .filter(range => range.end > range.start)
}

/**
 * `runFormatting` 那一侧的入口：把「请求里的 LSP 区间」（行/字符，改动前坐标系）换算成
 * 后处理要用的偏移区间（改动后坐标系）。`ranges` 为空 = 整份文本重排。
 * 上游不需要这一步（`RangeFormatInfo` 的智能指针自己会跟着文本走，
 * `CoreCodeStyleUtil.java:101-118` + `:153-165`），本仓没有 PSI 就只有这一条换算路。
 */
export function postFormatRegions(
  text: string,
  edits: readonly (LineColumnEdit & { text?: string })[],
  ranges: readonly FormatRange[] = [],
): TextRangeOffsets[] {
  const base: TextRangeOffsets[] = ranges.length
    ? ranges.map(range => ({
      start: offsetAt(text, range.start.line, range.start.character),
      end: offsetAt(text, range.end.line, range.end.character),
    }))
    : [{ start: 0, end: text.length }]
  return shiftRangesThroughEdits(text, edits, base)
}

/* ── 连续空行上限（KEEP_BLANK_LINES_IN_CODE / WhiteSpace.java:387-431）───────────── */

export interface BlankLineOutcome {
  text: string
  /** 删掉的空行数（含文件开头那一档）。 */
  removed: number
  /** 其中属于「文件开头」的几条（上游 `WhiteSpace.java:426-429` 的 `isFirst()` 那一支）。 */
  leading: number
}

/** 一行（不含行尾换行）除了空格/制表/CR 之外什么都没有。 */
function isBlankLineText(text: string, from: number, to: number): boolean {
  for (let index = from; index < to; ++index) {
    const char = text[index]!
    if (char !== ' ' && char !== '\t' && char !== '\r') return false
  }
  return true
}

/**
 * 「连续空行最多留 `keep` 个」的文本等价物（`WhiteSpace.arrangeLineFeeds` 的 `:395-411`）。
 *
 * 三条边界口径（都有上游出处，见文件头）：
 *   · 只处理**两侧都有内容行**的空行段 —— 上游管的是两个块之间的那段空白；
 *     区间末尾（文件结尾）的尾随空行没有「后面的块」，本仓一个字都不动；
 *   · `keep == 0` 时空行段压到零，但**不并行**（对应上游 `shouldKeepLineFeeds()` 为真的
 *     `:403-405`；`minLineFeeds == 0` 那支会合行，需要语法树才安全，本仓不做）；
 *   · `from === 0`（整文件重排）时文件开头的空行整段删掉（`:426-429`）；
 *     选区重排的起始空行**不删** —— 它前面的块不在本次重排范围内。
 *
 * 空行落在块注释 / 多行字符串里时当内容行看待（上游那里不是块间空白，`nonCodeRanges` 同口径）。
 */
export function processKeepBlankLines(
  text: string,
  range: TextRangeOffsets,
  keep: number,
  style: CommentStyle | null = null,
): BlankLineOutcome {
  const from = Math.max(0, Math.min(text.length, range.start))
  const to = Math.max(from, Math.min(text.length, range.end))
  if (to <= from) return { text, removed: 0, leading: 0 }
  // 设置值不是有限数（NaN / undefined / 字符串混进来）时**什么都不做**：
  // 一个坏掉的设置项不该静默删掉用户的空行。负数按 0 处理（上游没有负数这一档）。
  if (!Number.isFinite(keep)) return { text, removed: 0, leading: 0 }
  const allowed = Math.max(0, Math.trunc(keep))

  const comments = nonCodeRanges(text, style)
  let protectedIndex = 0
  const lines: { start: number; end: number; blank: boolean }[] = []
  let cursor = from
  while (cursor < to) {
    const end = lineBreakAt(text, cursor)
    // 这一段是否落在注释/字符串里：`end` 是换行符的位置，取行首偏移判定即可
    while (protectedIndex < comments.length && comments[protectedIndex]!.to <= cursor) ++protectedIndex
    const hit = comments[protectedIndex]
    const inside = Boolean(hit && hit.from <= cursor && cursor < hit.to)
    lines.push({ start: cursor, end, blank: isBlankLineText(text, cursor, end) && !inside })
    // `end + 1` 就是严格前进：这一行没有换行时 `end === text.length`，而 `to` 已在上面钳到
    // `text.length` ⇒ `cursor > to` 自然收口。原来这里多写了一个 `end >= text.length ? text.length + 1 : end + 1`
    // 的分支，两个分支算出来的数是同一个（2026-10-06 refactorfix 顺手删掉，行为一格不变）。
    cursor = end + 1
  }

  const drops: number[] = []
  let leading = 0
  let index = 0
  if (from === 0) {
    while (index < lines.length && lines[index]!.blank) { drops.push(lines[index]!.start); ++leading; ++index }
  }
  while (index < lines.length) {
    if (!lines[index]!.blank) { ++index; continue }
    let runEnd = index
    while (runEnd < lines.length && lines[runEnd]!.blank) ++runEnd
    // 段前必须有内容行（`index > 0`：开头那一档上面已经单独处理过）、
    // 段后也必须有内容行（`runEnd < lines.length`），否则就不是「两个块之间的空白」。
    if (index > 0 && runEnd < lines.length && runEnd - index > allowed) {
      for (let at = index + allowed; at < runEnd; ++at) drops.push(lines[at]!.start)
    }
    index = runEnd
  }
  if (!drops.length) return { text, removed: 0, leading: 0 }

  // 倒着删：每条删除只影响它自己那一行，从后往前就不必先重算前面的行首。
  let next = text
  for (let at = drops.length - 1; at >= 0; --at) {
    const start = drops[at]!
    const end = lineBreakAt(next, start)
    next = next.slice(0, start) + next.slice(Math.min(next.length, end + 1))
  }
  return { text: next, removed: drops.length, leading }
}

/* ── 两条链路的共同入口 ─────────────────────────────────────────────────────────── */

export interface PostFormatOutcome {
  text: string
  /** 补了几个行注释空格（`LineCommentAddSpacePostFormatProcessor` 的 `rangeToReformat.grown(size)`）。 */
  inserted: number
  /** 合并掉几条连续空行（含文件开头那一段）。 */
  collapsed: number
  /** 其中文件开头那几条（提示语要分开说，删开头的空行与「合并空行」是上游两条分支）。 */
  leading: number
}

/**
 * 重排后的本地后处理总入口：按启用段逐段跑「空行上限」与「行注释补空格」。
 * `ranges` 是**待重排区间**（改动后坐标系；不传按整份文本）。
 * 段与段互不相交、处理器只动自己那段 ⇒ 从右往左跑，靠前段的偏移天然不受影响
 * （上游是正向 + `delta` 累加，`CoreCodeStyleUtil.java:136-140`，两种走法等价）。
 */
export function processFormattedText(
  text: string,
  ranges: readonly TextRangeOffsets[] = [],
  settings: PostFormatSettings = defaultPostFormatSettings,
  style: CommentStyle | null = null,
): PostFormatOutcome {
  const regions = enabledProcessingRanges(text, ranges).sort((left, right) => right.start - left.start)
  let next = text
  let inserted = 0
  let collapsed = 0
  let leading = 0
  for (const region of regions) {
    // 段是按**进来时**的文本算的；跑完一段后文本可能变短（合并空行就是删字符）。
    // 后面的段在自己左边 ⇒ 起点不受影响，但终点要夹到当前长度，越界的部分不存在。
    const current = { start: Math.min(region.start, next.length), end: Math.min(region.end, next.length) }
    if (current.end <= current.start) continue
    const blanks = processKeepBlankLines(next, current, settings.keepBlankLines, style)
    if (blanks.removed) { next = blanks.text; collapsed += blanks.removed; leading += blanks.leading }
    // `current` 是按**进来时**的长度算的，而上面那一步正是把文本改短的那一步 —— 直接把 `current`
    // 递给补空格那一族就是「区间越过被改短的文本」。**这就是那条无限循环的真入口**（本轮实测）：
    // `tests/format-post-ranges.test.mjs` 的「多段各自处理」（`keepBlankLines: 0`，第一段并掉空行
    // ⇒ 文本变短）在 HEAD 那版扫描器上直接挂死整个测试文件 —— 不是只有外部调用方才踩得到。
    // 扫描器内部已经钳到 `text.length`（根因处那道闸），这里再把端点按当前长度重算一遍：
    // 两道闸各自独立，拆掉任意一道都不会挂死测试机；被钳掉的那截偏移本来就不存在，输出逐字节不变。
    const spacing = current.end > next.length
      ? { start: Math.min(current.start, next.length), end: next.length }
      : current
    const spaces = processLineCommentAddSpace(next, spacing, settings)
    if (spaces.inserted) { next = spaces.text; inserted += spaces.inserted }
  }
  return { text: next, inserted, collapsed, leading }
}
