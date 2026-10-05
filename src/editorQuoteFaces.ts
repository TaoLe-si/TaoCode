// 多字符引号（Java 文本块 `"""`）的三个动作 —— 上游 `QuoteHandler` 家族里 `MultiCharQuoteHandler`
// 那一档（`lp/editor-actions` 判决缺项 ① 的引号那一半，逐语言注册表在 `src/editorTyping.ts`）。
//
// 上游坐标（2026-10-06 逐行核对）：
//   · 扩展点本身：`platform/lang-impl/src/com/intellij/codeInsight/editorActions/QuoteHandlerEP.java:16-27`
//     （`BaseKeyedLazyInstance`，按 `fileType` 取一份 handler；EP 名 `com.intellij.quoteHandler` 在 `:18`），
//     XML 声明 `platform/lang-impl/resources/intellij.platform.lang.impl.xml:405`（按文件类型）与
//     `:408`（`com.intellij.lang.quoteHandler`，按语言）。
//   · 接口的四个问法（**订正**：`src/editorTyping.ts` 旧注释里的 `:26-35`/`:37-56`/`:58` 是上一任手抄错的行号）：
//     `platform/lang-impl/src/com/intellij/codeInsight/editorActions/QuoteHandler.java:28` 接口声明、
//     `:40` `isClosingQuote`、`:49` `isOpeningQuote`、`:64` `hasNonClosedLiteral`、`:66` `isInsideLiteral`；
//     类注释 `:10-20` 说明「成对引号由 `CodeInsightSettings#AUTOINSERT_PAIR_QUOTE` 控制」，
//     多字符引号要另外实现 `MultiCharQuoteHandler` 与 `BackspaceHandlerDelegate`（`:18-19`）。
//   · Java 那一份：`java/java-frontback-impl/src/com/intellij/codeInsight/editorActions/JavaQuoteHandler.java:31`
//     （`implements JavaLikeQuoteHandler, MultiCharQuoteHandler`），注册在
//     `java/java-frontback-impl/resource/intellij.java.frontback.impl.xml:74`（`quoteHandler fileType="JAVA"`）。
//     文本块的三条行为分别是：
//       `:58-63` `isClosingQuote`：token 是 TEXT_BLOCK_LITERAL 且 `end - start >= 5` 且
//         `offset >= end - 3` ⇒ 光标落在**收尾那三个引号**里 ⇒ 敲引号只挪光标；
//       `:104-108` `getClosingQuote`：`offset == iterator.getStart() + 3` ⇒ 刚敲完**开引号**那三个 ⇒ 要补配对；
//       `:111-128` `hasNonClosedLiteral`：`[tokenStart, offset+1)` 正好是 `"""` 且后面没有别的 `"""`
//         （`:120-124` 还会处理「解析器把下一段的开引号当本段闭引号」那种歧义，按余下出现次数的奇偶判）；
//       `:134-149` `insertClosingQuote`：插的是 `"\n\"\"\""`（`:136`），随后 reformat 并把光标放到
//         `textBlock.getEndOffset() - 3`（`:148`）—— 也就是**新起那一行的开头**，不是 `"""` 之后。
//     `:130-132` `testBlocksIsAvailable` 还要求语言级别 ≥ TEXT_BLOCKS（Java 15+）——
//     本仓没有项目语言级别这一层 ⇒ 不按语言级别分档，如实记在报告里。
//
// 本仓的等价物（架构不等价 ⇒ 用本仓架构还原用户可见行为）：没有 token 层，所以自己扫全文里
// **非转义的 `"""` 出现位置**，按「奇偶 = 开/收」判（与 `:120-124` 的奇偶判法同一思路）。
// 判不准的场合一律返回 null / 'none'，交回 `src/editorTyping.ts` 的单引号规则与 CodeMirror 的
// `closeBrackets`，不猜。
// 已知差别（照实写，不假装修）：转义在词法层只按「前面反斜杠的个数」判，Java 文本块里的
// `\"""` 这种被转义的整段引号会被算错；真正的判法要 token 流（`:49` 与 `:69` 用的是
// `StringEscapesTokenTypes.STRING_LITERAL_ESCAPES`）。

/** 一个 face（多字符引号）的出现位置表：非转义的起始下标。 */
export function faceOffsets(text: string, face: string): number[] {
  const out: number[] = []
  if (!face) return out
  for (let i = 0; i + face.length <= text.length; ++i) {
    if (text[i] !== face[0]) continue
    if (!text.startsWith(face, i)) continue
    let backslashes = 0
    let at = i - 1
    while (at >= 0 && text[at] === '\\') { ++backslashes; --at }
    if (backslashes % 2 === 1) continue                       // 被转义的那个不算
    out.push(i)
    i += face.length - 1
  }
  return out
}

/**
 * 光标之前（不含正在敲的这个字符）有几处完整的 face —— 奇偶就是「开/收」的判据。
 * `virtualCaret` 传入的是**把要敲的引号算进去之后**的光标位（上游在插入之后才问
 * `hasNonClosedLiteral`，`QuoteHandler.java:51-57` 的类注释写明了这一点）。
 */
export function facesBefore(text: string, caret: number, face: string): number {
  return faceOffsets(text, face).filter(at => at + face.length <= caret).length
}

/** 刚敲完一个**开** face（后面还没有配对的收尾 face）—— `:104-108` + `:111-128`。 */
export function opensFaceHere(text: string, caret: number, face: string): boolean {
  if (!face) return false
  // 敲完这个字符之后，光标前三位正好凑成一个 face。
  if (text.slice(caret - (face.length - 1), caret) !== face.slice(1)) return false
  const withTyped = text.slice(0, caret) + face[0] + text.slice(caret)
  const faceStart = caret - face.length + 1
  const before = faceOffsets(withTyped, face).filter(at => at < faceStart).length
  if (before % 2 === 1) return false                          // 这是某一段的收尾，不是新的一段
  const after = faceOffsets(withTyped, face).filter(at => at >= faceStart + face.length).length
  return after === 0                                          // `:120-121` 后面已经有收尾 ⇒ 不补
}

/**
 * 光标正落在某个**收尾** face 的那几个字符里 —— `:58-63`（`offset >= end - 3`）。
 * 成立时敲引号只把光标往后挪一位。
 */
export function insideClosingFace(text: string, caret: number, face: string): boolean {
  if (!face || caret < 0 || caret >= text.length) return false
  if (text[caret] !== face[0]) return false
  const offsets = faceOffsets(text, face)
  for (let index = 0; index < offsets.length; ++index) {
    if (index % 2 === 0) continue                             // 偶数位是开引号，不算收尾
    const start = offsets[index]!
    if (caret >= start && caret <= start + face.length - 1) return true
  }
  return false
}

/** `insertClosingQuote` 插的字符串（`:136` 的 `"\n\"\"\""`）。 */
export function faceInsertion(face: string): string {
  return `\n${face}`
}

/**
 * 补完配对之后光标该停在哪（相对插入位置的前进量）。上游 `:148` 把光标放到
 * `textBlock.getEndOffset() - 3` —— 也就是换行之后、收尾 face 之前，前进 1 个字符（那个 `\n`）。
 */
export const FACE_CARET_ADVANCE = 1

export type FaceAction = 'open' | 'skip' | null

/** 敲这个引号字符时，face 那一档要不要接管。 */
export function faceAction(text: string, caret: number, face: string, ch: string): FaceAction {
  if (!face || face[0] !== ch) return null
  if (insideClosingFace(text, caret, face)) return 'skip'     // `:58-63`
  if (opensFaceHere(text, caret, face)) return 'open'         // `:104-108`
  return null
}
