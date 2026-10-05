// 填充段落（`lp/editor-actions` 判决缺项 ⑥ 点名的 `FillParagraphAction`：把一段散成多行的文字
// 先粘成一整行，再按右边距重新折行）。
//
// 上游坐标（判定基准只有上游源码树）：
//   · 动作：`platform/lang-impl/src/com/intellij/codeInsight/editorActions/fillParagraph/FillParagraphAction.java:20-46`
//     —— 注册在 `platform/lang-impl/resources/intellij.platform.lang.impl.actions.xml:340`；
//     菜单行在 `platform/platform-impl/resources/idea/PlatformActions.xml:494`
//     （`EditSmartGroup` 里紧跟 `EditorJoinLines`（`:492`）与 `EditorDuplicate`（`:493`））。
//     `$default.xml` 里**没有它的键位**（全树只有第三方键位表给了：
//     `platform/platform-resources/src/keymaps/Sublime Text.xml:130`）⇒ 本仓也不挂默认键，菜单到得了就行。
//   · 适用范围（这一条决定本仓的命令什么时候真的动手）：
//     `ParagraphFillHandler.java:208-210` 的 `isAvailableForFile` 只在**纯文本文件**里成立
//     （`psiFile instanceof PsiPlainTextFile`）；全树唯一改了它的实现是 Markdown 插件
//     （`plugins/markdown/core/src/org/intellij/plugins/markdown/editor/MarkdownParagraphFillHandler.kt:27-30`）。
//     `FillParagraphAction.java:43-46` 的 `isValidForFile` 因此在代码文件里就是 false
//     ⇒ **Java/C++/TS 里这个动作是灰的**，本仓的命令在那几种语言下返回 false（不吞键、不改文本），
//     判据用「文档没有配语法（= 纯文本）」这一条可机检的形态。
//   · 前缀/后缀：`ParagraphFillHandler.java:212-218` 两个 getter 都返回 `""`（Markdown 那份也没改）
//     ⇒ 折行时**不补注释前缀**，纯文本进纯文本出。
//   · 粘回去：`:41-53` —— 按 `\n` 切开、逐行 trim、剥前后缀、丢掉空白行、用单个空格接起来。
//     段落边界 `:97-122`（往上走到空行为止，起点取该行第一个非空白字符，`:119-121`）
//     与 `:128-148`（往下走到空行为止，终点取那一行的行尾）。
//   · 重新折行：`:63-70` 调 `LineWrappingUtil.doWrapLongLinesIfNecessary(…, CodeStyle…getRightMargin(language))`，
//     循环体 `platform/platform-impl/src/com/intellij/formatting/LineWrappingUtil.java:118-165`：
//     找不到落点就跳过（`:131-133`）、左边只剩空白就跳过（`:145-150`）、在落点处模拟按一次回车
//     （`:154`，纯文本 = 换行 + 沿用该行缩进），新行落下的内容不比留在原行的部分长就把这次折行撤掉
//     （`:157-158` 的 `shifts[1] - 1 >= wrapOffset - startLineOffset`）。
//   · 右边距默认档：`platform/code-style-api/src/com/intellij/psi/codeStyle/CodeStyleSettings.java:430`
//     `public int RIGHT_MARGIN = 120`。本仓没有逐语言的代码风格设置面 ⇒ 取这个默认档，覆盖留成入参。
//   · **没搬的两条上游支线**（具体卡点写在报告里）：`FormatterTagHandler.getEnabledRanges`
//     （`ParagraphFillHandler.java:63-65`，`// @formatter:off` 标记之间不折行，本仓没有那份标记解析）
//     与 `LanguageLineWrapPositionStrategy`（`LineWrappingUtil.java:103`，按语言的断词策略；
//     纯文本那一档就是「在空白处断」，本模块按空白处断实现）。
import { EditorSelection } from '@codemirror/state'
import { syntaxTree } from '@codemirror/language'
import type { Command, EditorView } from '@codemirror/view'

/** 上游 `CodeStyleSettings.RIGHT_MARGIN` 的默认值（`CodeStyleSettings.java:430`）。 */
export const DEFAULT_PARAGRAPH_MARGIN = 120

/** 光标所在段落的范围：`from` = 首行第一个非空白字符，`to` = 末行的行尾（都是全文偏移）。 */
export interface ParagraphRange { from: number; to: number }

/** 按 `\n` 切出每一行的起始偏移（`\r\n` 的行尾 `\r` 归上一行，与 `src/customFoldingRegions.ts` 同一口径）。 */
function lineStarts(text: string): number[] {
  const starts = [0]
  for (let at = 0; at < text.length; ++at) if (text[at] === '\n') starts.push(at + 1)
  return starts
}

function lineAtOffset(starts: readonly number[], offset: number): number {
  let line = 0
  while (line + 1 < starts.length && starts[line + 1]! <= offset) ++line
  return line
}

/**
 * 光标所在的那一段（`ParagraphFillHandler.java:97-122` 往上 + `:128-148` 往下）：
 * 上下走到**空行**为止。段落只有一行时返回 null（上游那种场合粘回去的结果和原文一样）。
 */
export function paragraphAt(text: string, caret: number): ParagraphRange | null {
  const starts = lineStarts(text)
  const line = lineAtOffset(starts, caret)
  const endOf = (at: number): number => (at + 1 < starts.length ? starts[at + 1]! - 1 : text.length)
  if (!text.slice(starts[line]!, endOf(line)).trim()) return null
  let first = line
  while (first > 0 && text.slice(starts[first - 1]!, endOf(first - 1)).trim()) --first
  let last = line
  while (last + 1 < starts.length && text.slice(starts[last + 1]!, endOf(last + 1)).trim()) ++last
  if (last <= first) return null
  const body = text.slice(starts[first]!, endOf(first))
  const shift = body.length - body.trimStart().length
  return { from: starts[first]! + shift, to: endOf(last) }
}

/**
 * 按右边距折行（`LineWrappingUtil.java:118-165` 的循环，纯文本档 = 在空白处断）。
 * `indent` 是续行的行首空白（`:154` 的 `emulateEnter`：纯文本沿用本行缩进）。
 * 首行不加前缀 —— 它的缩进本来就在被替换的范围之外（`paragraphAt` 的 `from` 跳过了它）。
 */
export function wrapToMargin(line: string, margin: number, indent: string): string {
  if (!(margin > 0) || line.length <= margin) return line
  const out: string[] = []
  let cont = ''                 // 当前行已有的行首前缀（首行为空，之后是 `indent`）
  let current = ''
  let width = 0
  for (const word of line.split(' ')) {
    if (!current) { cont = out.length ? indent : ''; current = word; width = cont.length + word.length; continue }
    if (width + 1 + word.length <= margin) { current += ` ${word}`; width += 1 + word.length; continue }
    // `:145-150` + `:157-158`：留在原行的部分要是比新行的缩进还短，就别折（折了更难看）。
    if (indent.length >= width) { current += ` ${word}`; width += 1 + word.length; continue }
    out.push(`${cont}${current}`)
    cont = indent
    current = word
    width = cont.length + word.length
  }
  if (current) out.push(`${cont}${current}`)
  return out.join('\n')
}

/**
 * 一次「填充段落」：把 `caret` 所在段粘成一整行，再按 `margin` 折回来。
 * 返回 null = 没有可填的段落，或填完和原文一样（命令据此不吞键）。
 * 光标落在段首（上游把光标留在最后一次模拟回车的位置，
 * `LineWrappingUtil.java:154`，本仓没有那一步的等价物 ⇒ 定成段落起点）。
 */
export function fillParagraph(
  text: string, caret: number, margin = DEFAULT_PARAGRAPH_MARGIN,
): { text: string; caret: number; from: number; to: number; filled: string } | null {
  const range = paragraphAt(text, caret)
  if (!range) return null
  const indent = leadingOf(text.slice(0, range.from))
  // `ParagraphFillHandler.java:41-53`：切行、trim、剥前后缀（纯文本两个都是空串）、丢空行、单空格相接。
  const glued = text.slice(range.from, range.to).split('\n')
    .map(part => part.trim()).filter(part => part.length > 0).join(' ')
  if (!glued) return null
  const filled = wrapToMargin(glued, margin, indent)
  const next = `${text.slice(0, range.from)}${filled}${text.slice(range.to)}`
  if (next === text) return null
  return { text: next, caret: range.from, from: range.from, to: range.to, filled }
}

/** 某个偏移之前的行首空白（`range.from` 已经是非空白字符，所以整段都是缩进）。 */
function leadingOf(upto: string): string {
  const line = upto.slice(upto.lastIndexOf('\n') + 1)
  return /^\s*$/.test(line) ? line : ''
}

/**
 * 命令版：只在**没配语法**的文档里动手（= 纯文本，上游 `ParagraphFillHandler.java:208-210`
 * 的 `PsiPlainTextFile` 那一档）。代码文件返回 false ⇒ 不吞键、一个字都不改。
 */
export const fillParagraphCommand: Command = (view: EditorView) => {
  const { state } = view
  if (state.readOnly || state.selection.ranges.length > 1) return false
  if (!isPlainText(state)) return false
  const caret = state.selection.main.head
  const result = fillParagraph(state.doc.toString(), caret)
  if (!result) return false
  view.dispatch({
    changes: { from: result.from, to: result.to, insert: result.filled },
    selection: EditorSelection.cursor(result.caret),
    userEvent: 'input.handleSelection.fillParagraph',
    scrollIntoView: true,
  })
  return true
}

/** 文档有没有被配上语法（纯文本 = 语法树是空的）。 */
export function isPlainText(state: Parameters<typeof syntaxTree>[0]): boolean {
  const tree = syntaxTree(state)
  return !tree.topNode.firstChild
}
