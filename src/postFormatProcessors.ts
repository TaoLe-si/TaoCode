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
// 消费链路：`src/semanticActions.ts` 的 `runFormatting` 在套完语言服务的编辑之后跑这一遍。
export type PostFormatSettings = {
  /** 上游 `CommonCodeStyleSettings.LINE_COMMENT_ADD_SPACE_ON_REFORMAT`，默认 false（`:261`）。 */
  lineCommentAddSpaceOnReformat: boolean
  /**
   * 本仓的行注释前缀表（上游是 `Commenter.lineCommentPrefixes`，语言插件提供）。
   * 排序无关 —— 上游 `SingleLineCommentFinder.visitComment`（`:71-75`）是 `find` 第一个命中的前缀。
   */
  lineCommentPrefixes: readonly string[]
}

/** 上游各语言 commenter 用到的行注释前缀（去空白后的形态，对齐 `SingleLineCommentFinder` 的 `:59`）。 */
export const LINE_COMMENT_PREFIXES = ['//', '#', '--', ';', '%'] as const

/** 默认设置：`LINE_COMMENT_ADD_SPACE_ON_REFORMAT` 默认 **false**（`CommonCodeStyleSettings.java:261`）。 */
export const defaultPostFormatSettings: PostFormatSettings = {
  lineCommentAddSpaceOnReformat: false,
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
  const lineStart = range.start
  for (let position = lineStart; position <= range.end; position = nextLineStart(text, position)) {
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

function lineBreakAt(text: string, from: number): number {
  const index = text.indexOf('\n', from)
  return index < 0 ? text.length : index
}

function nextLineStart(text: string, from: number): number {
  if (from >= text.length) return text.length + 1  // 让 for 的条件 `position <= range.end` 收口
  return lineBreakAt(text, from) + 1
}
